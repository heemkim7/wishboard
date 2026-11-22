import { registerHooks, createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: new URL('./cf-stub.mjs', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});
globalThis.WebSocketRequestResponsePair = class { constructor(req, res) { this.req = req; this.res = res; } };

const { Room, Meter } = await import('../worker.js');
const worker = (await import('../worker.js')).default;
const { AD, AD_TEMPLATES, adTables, adIngest, adTenure, adRename, adReport, adSums, adBars } = await import('../adreport.js');
const { qrEncode, rsEc, formatBits, versionBits, penalty, paintQr } = await import('../qr.js');
const { blockedText } = await import('../plaza-account.js');
const { claimWizard } = await import('../ftue.js');
const { SLOT_IDS } = await import('../balance.js');
const { cardUrl } = await import('../share.js');

// Same harness as share-push.test.mjs: real DOs on in-memory SQLite behind a stub that copies arguments and results like the runtime does.
function sqliteStorage(db = new DatabaseSync(':memory:')) {
  return {
    db,
    exec(query, ...args) {
      const q = String(query).trim();
      if (!args.length && /^create\b/i.test(q)) { db.exec(q); return { rowsWritten: 0, toArray() { return []; }, one() { return {}; }, [Symbol.iterator]() { return [][Symbol.iterator](); } }; }
      const stmt = db.prepare(q);
      if (/^select\b/i.test(q)) { const rows = stmt.all(...args); return { rowsWritten: 0, toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error('expected one row for ' + q); return rows[0]; }, [Symbol.iterator]: () => rows[Symbol.iterator]() }; }
      const info = stmt.run(...args);
      return { rowsWritten: info.changes, toArray: () => [], one() { throw new Error('one on write'); }, [Symbol.iterator]() { return [][Symbol.iterator](); } };
    },
  };
}
function makeCtx(sql) {
  return {
    storage: { sql, async getAlarm() { return null; }, async setAlarm() {}, transactionSync(fn) { return fn(); } },
    setWebSocketAutoResponse() {}, getWebSockets() { return []; }, getWebSocketAutoResponseTimestamp() { return new Date(); }, acceptWebSocket() {},
  };
}
const stub = (obj) => new Proxy(obj, { get: (t, k) => k === 'fetch' ? (req) => t.fetch(req) : typeof t[k] === 'function' ? async (...a) => structuredClone(await t[k](...structuredClone(a))) : t[k] });
function makeEnv(extra = {}) {
  const meters = new Map(), rooms = new Map();
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ADMIN_KEY: 'admin-test-key-123', ASSETS: { fetch: () => new Response('asset', { status: 200 }) }, ...extra };
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new Meter(makeCtx(sql), env) }); } return meters.get(name); };
  env.room = (topic) => { if (!rooms.has(topic)) { const sql = sqliteStorage(); rooms.set(topic, { sql, do: new Room(makeCtx(sql), env) }); } return rooms.get(topic); };
  env.METER = { idFromName: (name) => name, get: (name) => stub(env.meter(name).do) };
  env.ROOM = { idFromName: (topic) => topic, get: (topic) => stub(env.room(topic).do) };
  return env;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
// Fake Supabase. state.boards: the billboards rows; state.victim: prev_holder_id of the next claim; state.tribes: actor id -> tribe id.
function fakeNet(state) {
  return async (url, opt = {}) => {
    const u = String(url); state.calls.push(u);
    if (u.includes('/.well-known/jwks.json')) return json({ keys: state.jwks || [] });
    // The claim's no-takeover read (worker.js boardFresh, the only billboards read that selects current_bid): free unless state.pre says otherwise.
    // These tests are about the report tenure, so a new holder here is one whose predecessor's time ran out.
    if (u.includes('/rest/v1/billboards') && u.includes('current_bid')) return json(state.pre || []);
    if (u.includes('/rest/v1/billboards')) { state.boardReads = (state.boardReads || 0) + 1; const m = /slot_id=eq\.(\w+)/.exec(u); return json((state.boards || []).filter((x) => !m || x.slot_id === m[1])); }
    if (u.includes('/rest/v1/') && !u.includes('/rpc/')) return json([]);
    if (u.includes('/rpc/my_tribe')) { const a = JSON.parse(opt.body).p_actor_id; return json({ ok: true, tribe_id: state.tribes?.[a] || null }); }
    if (u.includes('/rpc/merge_guest_account')) return json({ ok: true, coins: 1, bonus: 0 });
    if (u.includes('/rpc/claim_billboard')) { const a = JSON.parse(opt.body);
      return json({ ok: true, billboard: { slot_id: a.p_slot_id, holder_id: a.p_actor_id, holder_name: a.p_nickname, line1: a.p_line1 }, remaining_coins: 10, prev_holder_id: state.victim || null }); }
    if (u.includes('/rpc/')) return json({ ok: true });
    return new Response('missing', { status: 404 });
  };
}
function harness(env) {
  const waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (p, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + p, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const guest = async () => { const t = (await (await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).token; return { token: t, id: 'guest:' + JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).s }; };
  const post = (p, body, token) => call(p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const get = (p, token) => call(p, { headers: token ? { authorization: 'Bearer ' + token } : {} });
  const report = async (slot, token) => { const r = await get('/rt/ad-report?slot=' + slot, token); return { status: r.status, body: await r.json() }; };
  return { call, guest, post, get, report };
}
let clockBase = Date.parse('2027-05-01T03:00:00Z'); // 12:00 KST
function freshClock() { clockBase += 60 * 864e5; let t = clockBase; const orig = Date.now; Date.now = () => t; return { add: (ms) => { t += ms; }, now: () => t, restore: () => { Date.now = orig; } }; }
function setup(extra = {}) {
  const clock = freshClock(), orig = globalThis.fetch, state = { calls: [], ...extra };
  globalThis.fetch = fakeNet(state); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  return { clock, state, done: () => { globalThis.fetch = orig; clock.restore(); } };
}
const kst = (t) => new Date(t + 9 * 36e5).toISOString().slice(0, 10);
// A lit board row; boards must be lit or a cheer is refused as 'dark'.
const board = (slot, holder, line1 = '우리 가게') => ({ slot_id: slot, holder_id: holder, holder_name: '주인', line1, lit_until: new Date(Date.now() + 864e5).toISOString() });
const CLAIM = (slot) => ({ topic: 'chapel:square', slot_id: slot, bid: 300, line1: '우리 가게', nickname: '주인' });
function sock(room, id) {
  const ws = { sent: [], send(s) { this.sent.push(String(s)); }, close() {}, serializeAttachment() {}, deserializeAttachment() { return null; } };
  ws.a = { k: id, q: true, v2: true, fl: 0, lob: false, t: Date.now(), ls: Date.now(), m: { x: 1500, y: 1500, fl: 0, name: '손님' } };
  room.socks().set(ws, ws.a);
  return ws;
}
// The room's stale scan drops sockets quiet for 75 s (mocked clock); a test socket stays as if it pinged.
const say = (room, ws, m) => { ws.a.ls = Date.now(); room.socks().set(ws, ws.a); return room.webSocketMessage(ws, JSON.stringify(m)); };
const cheer = (room, ws, slot) => say(room, ws, { t: 'CHEER', slot, p: 1 });
const ride = async (room, ws, slot) => { await say(room, ws, { t: 'PICK' }); await say(room, ws, { t: 'FARE', amount: 20, nick: '기사', slot, riders: 1 }); };
const click = (room, ws, slot) => say(room, ws, { t: 'ADCLICK', nick: '손님', slot });
const SQ = 'chapel:square';
async function userToken(state, clock, sub) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  state.jwks = [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'ads-kid' }];
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), head = enc({ alg: 'ES256', kid: 'ads-kid' });
  const claims = enc({ sub, exp: Math.floor(clock.now() / 1000) + 600, iss: 'https://yxddhpacuyaffaoutxjn.supabase.co/auth/v1', aud: 'authenticated' });
  return { token: head + '.' + claims + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(head + '.' + claims))).toString('base64url'), id: 'user:' + sub };
}

describe('board report', { concurrency: false }, () => {
  it('counts taxi drop-offs, paid link visits, paid cheers and distinct people per day, for the holder only', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), { guest, post, report } = harness(env), A = await guest(), B = await guest();
      state.boards = [board('STREET_5', A.id), board('STREET_6', B.id)]; // STREET_6: a cheer needs a known holder
      assert.equal((await post('/rt/claim-billboard', CLAIM('STREET_5'), A.token)).status, 200);
      clock.add(61000);
      const room = env.room(SQ).do, c = sock(room, 'guest:c'), d = sock(room, 'guest:d'), e = sock(room, 'guest:e');
      await cheer(room, c, 'STREET_5'); clock.add(13000); await cheer(room, c, 'STREET_5'); await cheer(room, c, 'STREET_5'); // the third is inside the 12 s gap
      await cheer(room, d, 'STREET_5');
      await ride(room, e, 'STREET_5');
      clock.add(1000); await click(room, c, 'STREET_5'); await click(room, c, 'STREET_5'); // one paid visit per board per day
      await cheer(room, c, 'STREET_6'); // another board
      // Nothing reaches the report until the room flushes, in the ad_stat_batch rhythm.
      assert.deepEqual((await report('STREET_5', A.token)).body.total, { views: 0, clicks: 0, cheers: 0, people: 0 });
      await room.flushAds();
      clock.add(10001); // past the isolate's 10 s memo of the holder's answer (ADR)
      const r = await report('STREET_5', A.token);
      assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.slot, 'STREET_5');
      const today = kst(clock.now());
      assert.deepEqual(r.body.days, [{ day: today, views: 1, clicks: 1, cheers: 3, people: 3 }]);
      assert.deepEqual(r.body.total, { views: 1, clicks: 1, cheers: 3, people: 3 });
      assert.equal(r.body.today, today); assert.ok(Date.parse(r.body.since) <= clock.now() - 61000);
      // Sent rows leave the room; a second flush sends nothing new.
      assert.equal(env.room(SQ).sql.db.prepare('select count(*) n from adq').get().n, 0);
      assert.equal(env.room(SQ).sql.db.prepare('select count(*) n from adw').get().n, 0);
      await room.flushAds(); clock.add(10001);
      assert.deepEqual((await report('STREET_5', A.token)).body.total, { views: 1, clicks: 1, cheers: 3, people: 3 });
      // The same people again the same day are not counted twice; the ids kept are hashes, not account ids.
      clock.add(13000); await cheer(room, c, 'STREET_5'); await room.flushAds();
      assert.deepEqual((await report('STREET_5', A.token)).body.total, { views: 1, clicks: 1, cheers: 4, people: 3 });
      const ids = env.meter('ad').sql.db.prepare('select u from adu').all().map((x) => x.u);
      assert.equal(ids.length, 4); assert.ok(ids.every((u) => /^[0-9a-f]{16}$/.test(u)));
      // Not the holder: 403. No token: 401. Bad slot: 400. Wrong method: 405.
      const no = await report('STREET_5', B.token);
      assert.equal(no.status, 403); assert.equal(no.body.ok, false); assert.match(no.body.error, /주인만/);
      assert.equal((await report('STREET_5', '')).status, 401);
      assert.equal((await report('MAIN_S', A.token)).status, 400);
      assert.equal((await post('/rt/ad-report?slot=STREET_5', {}, A.token)).status, 405);
      // The holder is read from Supabase, never from the isolate's world copy; a holder's own answer is kept 10 s (no Supabase read, no DO call).
      clock.add(10001); const before = state.boardReads; await report('STREET_5', A.token); assert.equal(state.boardReads, before + 1);
      await report('STREET_5', A.token); assert.equal(state.boardReads, before + 1);
      clock.add(10001); await report('STREET_5', A.token); assert.equal(state.boardReads, before + 2);
    } finally { done(); }
  });

  it('a new holder starts from zero; events from before the claim and the previous holder never show', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), { guest, post, report } = harness(env), A = await guest(), B = await guest();
      state.boards = [board('STREET_9', A.id)];
      await post('/rt/claim-billboard', CLAIM('STREET_9'), A.token);
      clock.add(61000);
      const room = env.room(SQ).do, c = sock(room, 'guest:c2'), d = sock(room, 'guest:d2');
      await cheer(room, c, 'STREET_9'); await room.flushAds();
      assert.equal((await report('STREET_9', A.token)).body.total.cheers, 1);
      // Counted for A but still in the room when B lights the board after A's time ran out (no takeovers: the claim's own read sees it free).
      clock.add(13000); await cheer(room, c, 'STREET_9'); await cheer(room, d, 'STREET_9');
      clock.add(61000);
      state.boards = [board('STREET_9', B.id)]; state.victim = A.id;
      assert.equal((await post('/rt/claim-billboard', CLAIM('STREET_9'), B.token)).status, 200);
      await room.flushAds();
      const r = await report('STREET_9', B.token);
      assert.equal(r.status, 200); assert.deepEqual(r.body.total, { views: 0, clicks: 0, cheers: 0, people: 0 }); assert.deepEqual(r.body.days, []);
      assert.equal(Date.parse(r.body.since), clock.now());
      assert.equal((await report('STREET_9', A.token)).status, 403);
      clock.add(61000); await cheer(room, c, 'STREET_9'); await room.flushAds();
      assert.deepEqual((await report('STREET_9', B.token)).body.total, { views: 0, clicks: 0, cheers: 1, people: 1 });
      // A lights it again after B's time: A's old numbers do not come back either.
      clock.add(61000); state.boards = [board('STREET_9', A.id)]; state.victim = B.id;
      await post('/rt/claim-billboard', CLAIM('STREET_9'), A.token);
      assert.deepEqual((await report('STREET_9', A.token)).body.total, { views: 0, clicks: 0, cheers: 0, people: 0 });
      // An edit by the holder (its board lit) keeps the tenure.
      clock.add(61000); await cheer(room, d, 'STREET_9'); await room.flushAds();
      state.pre = [{ ...board('STREET_9', A.id), current_bid: 228 }];
      assert.equal((await post('/rt/claim-billboard', { ...CLAIM('STREET_9'), mode: 'edit', bid: 0 }, A.token)).status, 200);
      state.pre = null;
      assert.equal((await report('STREET_9', A.token)).body.total.cheers, 1);
    } finally { done(); }
  });

  it('a tenure not named for the reader (unnamed, or someone else whose claim hook was lost) is never adopted by a report', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), { guest, report } = harness(env), A = await guest(), B = await guest();
      // Held from before this feature (or the claim hook never landed): the first counted minute opens a tenure with no holder.
      state.boards = [board('STREET_12', A.id)];
      const room = env.room(SQ).do, c = sock(room, 'guest:c3');
      await cheer(room, c, 'STREET_12'); await room.flushAds();
      assert.equal(env.meter('ad').sql.db.prepare('select holder from adh where slot = ?').get('STREET_12').holder, '');
      // Supabase now says B holds it with no claim seen here: B must not see that minute.
      clock.add(3600e3); state.boards = [board('STREET_12', B.id)];
      let r = await report('STREET_12', B.token);
      assert.deepEqual(r.body.total, { views: 0, clicks: 0, cheers: 0, people: 0 }); assert.equal(Date.parse(r.body.since), clock.now());
      clock.add(61000); await cheer(room, c, 'STREET_12'); await room.flushAds();
      assert.equal((await report('STREET_12', B.token)).body.total.cheers, 1);
      // A gets it back without a hook: B's tenure is closed, A starts at zero.
      clock.add(61000); state.boards = [board('STREET_12', A.id)];
      r = await report('STREET_12', A.token);
      assert.equal(r.body.total.cheers, 0); assert.equal(Date.parse(r.body.since), clock.now());
    } finally { done(); }
  });

  it('a new holder inside a busy minute: the previous holder\'s events in that minute stay out of the new report', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), { guest, post, report } = harness(env), A = await guest(), B = await guest();
      state.boards = [board('STREET_9', A.id)];
      await post('/rt/claim-billboard', CLAIM('STREET_9'), A.token);
      clock.add(120000 - (clock.now() % 60000)); clock.add(5000); // 5 s into a minute
      const room = env.room(SQ).do;
      for (let i = 0; i < 5; i++) await cheer(room, sock(room, 'guest:m' + i), 'STREET_9');
      clock.add(40000); // the new claim, 45 s into the same minute
      state.boards = [board('STREET_9', B.id)]; state.victim = A.id;
      await post('/rt/claim-billboard', CLAIM('STREET_9'), B.token);
      await room.flushAds();
      assert.deepEqual((await report('STREET_9', B.token)).body.total, { views: 0, clicks: 0, cheers: 0, people: 0 });
    } finally { done(); }
  });

  it('a slow ad instance does not hold up a claim: the hook waits at most 0.8 s and finishes in the background', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), { guest } = harness(env), A = await guest();
      state.boards = [board('STREET_15', A.id)];
      const real = env.METER.get;
      env.METER.get = (n) => { const m = real(n); return n === 'ad' ? new Proxy(m, { get: (t, k) => (k === 'adClaim' ? async (...a) => { await new Promise((r) => setTimeout(r, 3000)); return t.adClaim(...a); } : t[k]) }) : m; };
      const waits = [], t = performance.now();
      const res = await worker.fetch(new Request('https://sq.example/rt/claim-billboard', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + A.token }, body: JSON.stringify(CLAIM('STREET_15')) }), env, { waitUntil(p) { waits.push(p); } });
      const took = performance.now() - t;
      assert.equal(res.status, 200); assert.ok(took < 1500, 'claim answered after ' + Math.round(took) + ' ms');
      const db = env.meter('ad').sql.db, tab = db.prepare("select count(*) n from sqlite_master where name = 'adh'").get().n;
      assert.equal(tab ? db.prepare("select count(*) n from adh where slot = 'STREET_15'").get().n : 0, 0); // not yet
      await Promise.all(waits);
      assert.equal(db.prepare("select holder from adh where slot = 'STREET_15'").get().holder, A.id);
    } finally { done(); }
  });

  it('a 503, not a 403, when the holder cannot be read; withdrawal removes the record', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), { guest, post, report } = harness(env), A = await guest();
      state.boards = [board('STREET_5', A.id)];
      await post('/rt/claim-billboard', CLAIM('STREET_5'), A.token);
      const orig = globalThis.fetch;
      globalThis.fetch = async (u, o) => (String(u).includes('/rest/v1/billboards') ? new Response('x', { status: 500 }) : orig(u, o));
      const down = await report('STREET_5', A.token);
      globalThis.fetch = orig;
      assert.equal(down.status, 503); assert.equal(down.body.ok, false);
      state.boards = [];
      assert.equal((await report('STREET_5', A.token)).status, 403); // no row: nobody holds it
      state.boards = [board('STREET_5', A.id)];
      clock.add(61000); const room = env.room(SQ).do; await cheer(room, sock(room, 'guest:w1'), 'STREET_5'); await room.flushAds();
      assert.equal((await report('STREET_5', A.token)).body.total.cheers, 1);
      // Withdrawal (forgetActor) drops the account's tenures and their rows; nothing is left unnamed for the next holder to pick up.
      const U = await userToken(state, clock, '88888888-2222-3333-4444-555555555555');
      state.boards.push(board('STREET_14', U.id));
      await post('/rt/claim-billboard', CLAIM('STREET_14'), U.token);
      clock.add(61000); await cheer(room, sock(room, 'guest:w2'), 'STREET_14'); await room.flushAds();
      const db = env.meter('ad').sql.db, rows = (slot) => ['adh', 'ads', 'adu'].map((t) => db.prepare(`select count(*) n from ${t} where slot = ?`).get(slot).n);
      assert.deepEqual(rows('STREET_14'), [1, 1, 1]);
      assert.equal((await post('/rt/auth/withdraw', {}, U.token)).status, 200);
      assert.deepEqual(rows('STREET_14'), [0, 0, 0]);
      assert.deepEqual(rows('STREET_5'), [1, 1, 1]); // other accounts' boards untouched
    } finally { done(); }
  });

  it('tribe boards report to members only; an account link keeps the guest board report right away', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), { guest, post, report } = harness(env), A = await guest(), B = await guest(), G = await guest();
      state.tribes = { [A.id]: 'abcd1234' };
      state.boards = [board('SUB_1A', 'tribe:abcd1234')];
      assert.equal((await report('SUB_1A', A.token)).body.total.cheers, 0); // opens the tribe's record now
      clock.add(61000);
      const room = env.room(SQ).do, c = sock(room, 'guest:c4');
      await cheer(room, c, 'SUB_1A'); await room.flushAds();
      assert.equal((await report('SUB_1A', A.token)).body.total.cheers, 1);
      assert.equal((await report('SUB_1A', B.token)).status, 403);
      state.tribes = {}; clock.add(10001); assert.equal((await report('SUB_1A', A.token)).status, 403); // left the tribe (once the 10 s memo of A's answer is over)
      // Guest G holds STREET_20, then links to a Google account: merge_guest_account moves the board, the report follows.
      state.boards.push(board('STREET_20', G.id));
      await post('/rt/claim-billboard', CLAIM('STREET_20'), G.token);
      clock.add(61000); await cheer(room, c, 'STREET_20'); await room.flushAds();
      const U = await userToken(state, clock, '77777777-2222-3333-4444-555555555555');
      // No waitUntil drain: the rename is done before the merge answers.
      const res = await worker.fetch(new Request('https://sq.example/rt/auth/merge', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + U.token }, body: JSON.stringify({ guest_id: G.id, guest_token: G.token }) }), env, { waitUntil() {} });
      assert.equal(res.status, 200);
      state.boards = state.boards.map((b) => (b.slot_id === 'STREET_20' ? { ...b, holder_id: U.id } : b));
      assert.equal((await report('STREET_20', U.token)).body.total.cheers, 1);
    } finally { done(); }
  });

  it('keeps the room tallies when the ad instance fails, and sends them on the next flush', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), { guest, post, report } = harness(env), A = await guest();
      state.boards = [board('PLOT_3', A.id)];
      await post('/rt/claim-billboard', CLAIM('PLOT_3'), A.token);
      clock.add(61000);
      const real = env.METER.get; let fail = true;
      env.METER.get = (n) => { const m = real(n); return n === 'ad' && fail ? new Proxy(m, { get: (t, k) => (k === 'adAdd' ? () => Promise.reject(new Error('down')) : t[k]) }) : m; };
      const room = env.room(SQ).do, c = sock(room, 'guest:c5');
      await cheer(room, c, 'PLOT_3'); await room.flushAds();
      assert.equal(env.room(SQ).sql.db.prepare('select count(*) n from adq').get().n, 1);
      assert.equal(room.adDirty, 1);
      fail = false; await room.flushAds();
      assert.equal(env.room(SQ).sql.db.prepare('select count(*) n from adq').get().n, 0);
      assert.deepEqual((await report('PLOT_3', A.token)).body.total, { views: 0, clicks: 0, cheers: 1, people: 1 });
      // A woken room (no memory) still knows it has tallies to send.
      await cheer(room, sock(room, 'guest:c6'), 'PLOT_3');
      const woke = new Room(makeCtx(env.room(SQ).sql), env); woke.tapDb();
      assert.equal(woke.adDirty, 1);
      // While the Meter keeps failing the room's tables stay bounded: people of another day and minutes past 35 days go.
      fail = true; const q = env.room(SQ).sql.db;
      q.prepare("insert into adw(slot, d, uid, b) values('PLOT_3', '2000-01-01', 'guest:old', 1)").run();
      q.prepare("insert into adq(slot, b, v, c, h) values('PLOT_3', 1, 1, 0, 0)").run();
      await room.flushAds();
      assert.equal(q.prepare("select count(*) n from adw where d = '2000-01-01'").get().n, 0);
      assert.equal(q.prepare('select count(*) n from adq where b = 1').get().n, 0);
      assert.equal(q.prepare('select count(*) n from adq').get().n, 1); // today's tally still waits
    } finally { done(); }
  });
});

describe('report storage (adreport.js)', () => {
  const q = () => { const s = sqliteStorage(); adTables(s); return s; };
  const t0 = Date.parse('2027-01-10T03:00:00Z'), min = (t) => Math.floor(t / 60000);
  it('keeps 35 days, reports the last 14, and keeps ids only for today', async () => {
    const s = q();
    adTenure(s, 'STREET_1', 'guest:a', '', t0 - 40 * 864e5);
    for (let i = 0; i < 40; i++) { const t = t0 - i * 864e5; await adIngest(s, [{ s: 'STREET_1', b: min(t), v: 1, c: 0, h: 2 }], [], t0); }
    const days = s.db.prepare('select d from ads order by d').all().map((r) => r.d);
    assert.equal(days.length, AD.keep); assert.equal(days[0], kst(t0 - 34 * 864e5));
    const r = adReport(s, 'STREET_1', 'guest:a', t0);
    assert.equal(r.days.length, 14); assert.equal(r.days[0].day, kst(t0 - 13 * 864e5)); assert.equal(r.days.at(-1).day, kst(t0));
    assert.deepEqual(r.total, { views: 35, clicks: 0, cheers: 70, people: 0 });
    // People: today's only; yesterday's ids are not counted or kept.
    await adIngest(s, [], [{ s: 'STREET_1', d: kst(t0), u: 'guest:x', b: min(t0) }, { s: 'STREET_1', d: kst(t0), u: 'guest:x', b: min(t0) }, { s: 'STREET_1', d: kst(t0 - 864e5), u: 'guest:y', b: min(t0 - 864e5) }], t0);
    assert.equal(adReport(s, 'STREET_1', 'guest:a', t0).total.people, 1);
    await adIngest(s, [], [], t0 + 864e5);
    assert.equal(s.db.prepare('select count(*) n from adu').get().n, 0);
    // Junk is ignored.
    const out = await adIngest(s, [{ s: 'MAIN_S', b: min(t0), v: 5 }, { s: 'STREET_1', b: -1, v: 5 }, { s: 'STREET_1', b: min(t0 + 3 * 864e5), v: 5 }, { s: 'STREET_1', b: min(t0), v: 0 }, null], [{ s: 'STREET_1', d: 'x', u: 'a', b: min(t0) }], t0);
    assert.equal(out.n, 0); assert.equal(out.p, 0);
  });
  it('cuts by claim minute, adopts an unnamed tenure only for the claimer who held it, renames on account link', async () => {
    const s = q(), claim = t0 + 30000;
    await adIngest(s, [{ s: 'STREET_2', b: min(t0) - 2, h: 1 }], [], t0);
    assert.equal(s.db.prepare('select holder from adh').get().holder, '');
    // The same person re-claims (prev is them): the unnamed tenure is theirs.
    assert.deepEqual(adTenure(s, 'STREET_2', 'guest:a', 'guest:a', claim), { ok: true, kept: true });
    assert.equal(adReport(s, 'STREET_2', 'guest:a', claim).total.cheers, 1);
    // Someone else claims: the minutes before, and the claim's own minute (it may hold the previous holder's events), are dropped.
    adTenure(s, 'STREET_2', 'guest:b', 'guest:a', claim);
    await adIngest(s, [{ s: 'STREET_2', b: min(t0) - 1, h: 1 }, { s: 'STREET_2', b: min(claim), h: 1 }, { s: 'STREET_2', b: min(claim) + 1, h: 1 }], [{ s: 'STREET_2', d: kst(claim), u: 'guest:p', b: min(claim) }], claim + 120000);
    assert.deepEqual(adReport(s, 'STREET_2', 'guest:b', claim + 120000).total, { views: 0, clicks: 0, cheers: 1, people: 0 });
    assert.equal(adReport(s, 'STREET_3', 'guest:b', claim).days.length, 0);
    adRename(s, 'guest:b', 'user:b');
    assert.equal(adReport(s, 'STREET_2', 'user:b', claim + 120000).total.cheers, 1);
    // A report never adopts an unnamed tenure: it starts a new one.
    await adIngest(s, [{ s: 'STREET_4', b: min(t0), h: 3 }], [], t0);
    assert.equal(adReport(s, 'STREET_4', 'guest:a', t0 + 1000).total.cheers, 0);
  });
  it('a retake after a lost claim hook does not show the other tenure; an unnamed tenure is adopted only by its own holder', async () => {
    const s = q();
    adTenure(s, 'STREET_3', 'guest:A', '', t0); // A's tenure
    await adIngest(s, [{ s: 'STREET_3', b: min(t0 + 60e3), h: 2 }], [], t0 + 120e3);
    // B took it at t0+1h, but B's adClaim was lost; B's events still land in the A-named tenure.
    await adIngest(s, [{ s: 'STREET_3', b: min(t0 + 2 * 36e5), h: 7 }], [], t0 + 2 * 36e5 + 60e3);
    // A retakes from B: prev is B, so the record (with B's 7) is not A's to keep.
    assert.deepEqual(adTenure(s, 'STREET_3', 'guest:A', 'guest:B', t0 + 3 * 36e5), { ok: true, kept: false });
    assert.deepEqual(adReport(s, 'STREET_3', 'guest:A', t0 + 3 * 36e5 + 1).total, { views: 0, clicks: 0, cheers: 0, people: 0 });
    // Re-claiming one's own board (prev is the claimer): kept.
    await adIngest(s, [{ s: 'STREET_3', b: min(t0 + 3 * 36e5) + 1, h: 1 }], [], t0 + 4 * 36e5);
    assert.equal(adTenure(s, 'STREET_3', 'guest:A', 'guest:A', t0 + 4 * 36e5).kept, true);
    assert.equal(adReport(s, 'STREET_3', 'guest:A', t0 + 4 * 36e5).total.cheers, 1);
    // R1: A named, B's hook lost (B's events land in A's tenure), the board cleared to no holder, A claims again with prev '': fresh.
    const r1 = q(); adTenure(r1, 'STREET_3', 'guest:A', '', t0);
    await adIngest(r1, [{ s: 'STREET_3', b: min(t0 + 2 * 36e5), h: 7 }], [], t0 + 2 * 36e5 + 60e3);
    assert.deepEqual(adTenure(r1, 'STREET_3', 'guest:A', '', t0 + 5 * 36e5), { ok: true, kept: false });
    assert.deepEqual(adReport(r1, 'STREET_3', 'guest:A', t0 + 5 * 36e5 + 1).total, { views: 0, clicks: 0, cheers: 0, people: 0 });
    // Unnamed: adopted by a claimer who held it, wiped for anyone else.
    await adIngest(s, [{ s: 'STREET_6', b: min(t0), h: 1 }, { s: 'STREET_7', b: min(t0), h: 1 }], [], t0);
    assert.equal(adTenure(s, 'STREET_6', 'guest:A', 'guest:A', t0 + 60e3).kept, true);
    assert.equal(adTenure(s, 'STREET_7', 'guest:B', '', t0 + 60e3).kept, false);
    assert.equal(adReport(s, 'STREET_6', 'guest:A', t0 + 60e3).total.cheers, 1);
    assert.equal(adReport(s, 'STREET_7', 'guest:B', t0 + 60e3).total.cheers, 0);
  });
  it('sums today / 7 / 14 days and lays out 14 bars with the days before the tenure marked', () => {
    const today = '2027-01-20', d = (n) => new Date(Date.parse(today) - n * 864e5).toISOString().slice(0, 10);
    const days = [{ day: d(0), views: 1, clicks: 1, cheers: 1, people: 2 }, { day: d(6), views: 2, clicks: 0, cheers: 0, people: 1 }, { day: d(7), views: 4, clicks: 0, cheers: 0, people: 1 }, { day: d(14), views: 99, clicks: 0, cheers: 0, people: 9 }];
    const s = adSums(days, today);
    assert.deepEqual(s.today, { views: 1, clicks: 1, cheers: 1, people: 2 });
    assert.deepEqual(s.d7, { views: 3, clicks: 1, cheers: 1, people: 3 });
    assert.deepEqual(s.d14, { views: 7, clicks: 1, cheers: 1, people: 4 });
    const bars = adBars(days, today, new Date(Date.parse(d(7)) - 9 * 36e5).toISOString());
    assert.equal(bars.length, 14); assert.equal(bars[13].day, today); assert.equal(bars[13].n, 3); assert.equal(bars[6].n, 4);
    assert.deepEqual(bars.map((b) => b.before), bars.map((b, i) => i < 6));
  });
});

describe('claim wizard shop templates', () => {
  it('five templates, three lines each, all pass the wizard checks', () => {
    assert.deepEqual(AD_TEMPLATES.map((t) => t.label), ['가게 홍보', '이벤트', '구인', '축하', '응원']);
    for (const t of AD_TEMPLATES) {
      assert.equal(t.lines.length, 3, t.label);
      for (const line of t.lines) { assert.ok([...line].length <= 16, line); assert.equal(blockedText(line), false, line); assert.doesNotMatch(line, /복권|잭팟/); }
      assert.equal(claimWizard('STREET_8').linesOk(...t.lines), true, t.label);
    }
    assert.deepEqual(AD_TEMPLATES[0].lines.slice(1), ['오늘만 아메리카노 1+1', '골목 안 2층']);
  });
});

// Reads back what the encoder wrote, independently of how it wrote it.
const fmtRead = (rows, copy) => {
  const n = rows.length, at = (x, y) => (rows[y][x] ? 1 : 0); let v = 0;
  const a = copy === 0
    ? [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]]
    : [...Array.from({ length: 8 }, (_, i) => [n - 1 - i, 8]), ...Array.from({ length: 7 }, (_, i) => [8, n - 7 + i])];
  a.forEach(([x, y], i) => { v |= at(x, y) << i; });
  return v;
};
function decoder() {
  const dir = process.env.JSQR_DIR || path.join(os.tmpdir(), 'kts-jsqr', 'node_modules', 'jsqr');
  if (!existsSync(dir)) return null;
  try { return createRequire(import.meta.url)(dir); } catch { return null; }
}
function pixels(qr, scale = 4) {
  const n = (qr.size + 8) * scale, px = new Uint8ClampedArray(n * n * 4).fill(255);
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.rows[y][x]) for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const i = (((y + 4) * scale + dy) * n + (x + 4) * scale + dx) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
  return { px, n };
}

describe('QR encoder (qr.js)', () => {
  it('matches the published reference vectors: RS codewords, format bits, version bits', () => {
    // ISO/IEC 18004 / Thonky "HELLO WORLD" 1-M data codewords and their 10 EC codewords.
    assert.deepEqual(rsEc([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((m) => formatBits(m).toString(2).padStart(15, '0')),
      ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000']);
    assert.equal(versionBits(7).toString(2).padStart(18, '0'), '000111110010010100');
    assert.equal(versionBits(10).toString(2).padStart(18, '0'), '001010010011010011');
  });

  it('draws finder, timing, format and version patterns; picks the lowest-penalty mask; versions 1-10 only', () => {
    const seen = new Set();
    for (const text of ['x', 'https://studio.wishboard.workers.dev/rt/card/STREET_12', 'a'.repeat(100), 'a'.repeat(120), '가'.repeat(60), 'b'.repeat(213)]) {
      const qr = qrEncode(text), n = qr.size; seen.add(qr.version);
      assert.equal(n, 17 + 4 * qr.version);
      for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)); assert.equal(qr.rows[cy + dy][cx + dx], d !== 2, `finder ${cx},${cy} ${dx},${dy}`);
      }
      for (let i = 8; i < n - 8; i++) { assert.equal(qr.rows[6][i], i % 2 === 0); assert.equal(qr.rows[i][6], i % 2 === 0); }
      assert.equal(qr.rows[n - 8][8], true, 'dark module');
      assert.equal(fmtRead(qr.rows, 0), formatBits(qr.mask)); assert.equal(fmtRead(qr.rows, 1), formatBits(qr.mask));
      if (qr.version >= 7) { let v = 0; for (let i = 0; i < 18; i++) v |= (qr.rows[Math.floor(i / 3)][n - 11 + (i % 3)] ? 1 : 0) << i; assert.equal(v, versionBits(qr.version)); }
      const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((m) => penalty(qrEncode(text, m).rows));
      assert.equal(scores[qr.mask], Math.min(...scores));
    }
    assert.deepEqual([...seen].sort((a, b) => a - b), [1, 4, 6, 7, 9, 10]);
    assert.throws(() => qrEncode('b'.repeat(214)), /too long/);
  });

  it('paints a 4-module quiet zone and a caption band', () => {
    const qr = qrEncode('https://studio.wishboard.workers.dev/rt/card/STREET_1'), drawn = [];
    const g = { fillRect: (...a) => drawn.push([g.fillStyle, ...a]), fillText() {}, measureText: () => ({ width: 10 }), set font(v) {}, fillStyle: '' };
    const canvas = { width: 0, height: 0, getContext: () => g };
    paintQr(canvas, qr, { scale: 10, caption: '우리 가게' });
    assert.equal(canvas.width, (qr.size + 8) * 10); assert.equal(canvas.height, canvas.width + 70);
    const dark = drawn.filter((d) => d[0] === '#000');
    assert.ok(dark.length > 0 && dark.every(([, x, y]) => x >= 40 && y >= 40 && x < canvas.width - 40 && y < canvas.width - 40));
  });

  it('scans: an independent decoder (jsQR, test-time only) reads every version and mask back', (t) => {
    const jsQR = decoder();
    if (!jsQR) { t.skip('jsQR not installed: npm install --prefix "%TEMP%/kts-jsqr" jsqr@1.4.0 (or set JSQR_DIR to its package folder)'); return; }
    // One text per version 1–10 (byte capacities at level M: 14 26 42 62 84 106 122 152 180 213), each under every mask.
    const texts = [10, 20, 35, 50, 70, 95, 115, 140, 170, 200].map((n, i) => (i % 2 ? '가게' : 'shop-').repeat(n).slice(0, i % 2 ? Math.floor(n / 3) : n));
    texts.push('https://studio.wishboard.workers.dev/rt/card/STREET_12', '가게 홍보 ' + 'ㅋ'.repeat(40));
    const versions = new Set();
    for (const text of texts) for (const m of [-1, 0, 1, 2, 3, 4, 5, 6, 7]) {
      const qr = qrEncode(text, m); versions.add(qr.version);
      const { px, n } = pixels(qr), got = jsQR(px, n, n);
      assert.equal(got?.data, text, `v${qr.version} mask ${qr.mask}`);
    }
    assert.deepEqual([...versions].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Every board's real card link scans, at screen and print scale.
    for (const slot of SLOT_IDS) {
      const url = cardUrl(slot), qr = qrEncode(url);
      for (const scale of [3, 16]) { const { px, n } = pixels(qr, scale); assert.equal(jsQR(px, n, n)?.data, url, slot + ' x' + scale); }
    }
  });
});
