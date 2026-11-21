import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: new URL('./cf-stub.mjs', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});
globalThis.WebSocketRequestResponsePair = class { constructor(req, res) { this.req = req; this.res = res; } };

const W = await import('../worker.js');
const worker = W.default, { Meter, Room } = W;
// A second copy of worker.js: its Room is a Durable Object in another isolate and never sees the Worker's per-isolate world copy (the live bug).
const { Room: IsoRoom } = await import('../worker.js?isolate=inbox-room');

// Same harness as ads.test.mjs (real DOs on in-memory SQLite), plus a DO alarm the test can read (ctx.alarm) and fire.
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
  const c = {
    alarm: null, alarms: 0,
    storage: { sql, async getAlarm() { return c.alarm; }, async setAlarm(t) { c.alarm = Number(t); c.alarms++; }, async deleteAlarm() { c.alarm = null; }, transactionSync(fn) { return fn(); } },
    setWebSocketAutoResponse() {}, getWebSockets() { return []; }, getWebSocketAutoResponseTimestamp() { return new Date(Date.now()); }, acceptWebSocket() {},
  };
  return c;
}
const stub = (obj) => new Proxy(obj, { get: (t, k) => k === 'fetch' ? (req) => t.fetch(req) : typeof t[k] === 'function' ? async (...a) => structuredClone(await t[k](...structuredClone(a))) : t[k] });
function makeEnv(RoomClass) {
  const meters = new Map(), rooms = new Map();
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ADMIN_KEY: 'admin-test-key-123', ASSETS: { fetch: () => new Response('asset', { status: 200 }) } };
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new Meter(makeCtx(sql), env) }); } return meters.get(name); };
  env.room = (topic) => { if (!rooms.has(topic)) { const sql = sqliteStorage(), ctx = makeCtx(sql); rooms.set(topic, { sql, ctx, do: new RoomClass(ctx, env) }); } return rooms.get(topic); };
  env.METER = { idFromName: (name) => name, get: (name) => stub(env.meter(name).do) };
  env.ROOM = { idFromName: (topic) => topic, get: (topic) => stub(env.room(topic).do) };
  return env;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
// Fake Supabase. state.boards: billboards rows (full rows, as row_to_json gives them). state.lag: the world read (select=*) answers with the rows as they
// were before the last claim. state.boardsDown: the Room's own board read answers 500; state.boardsHang: it never answers; state.slow: a promise the read
// waits for. state.inboxDown: inbox_batch 500.
const BOARD_READ = 'select=slot_id,holder_id,holder_name,line1';
function fakeNet(state) {
  return async (url, opt = {}) => {
    const u = String(url); state.calls.push(u);
    if (u.includes('/.well-known/jwks.json')) return json({ keys: state.jwks || [] });
    if (u.includes('/rest/v1/billboards')) {
      if (u.includes(BOARD_READ)) { state.roomReads++; if (state.boardsHang) return new Promise(() => {}); if (state.slow) await state.slow; if (state.boardsDown) return json({ message: 'down' }, 500); }
      const rows = u.includes('select=*') && state.lag ? state.before : state.boards, m = /slot_id=eq\.(\w+)/.exec(u), h = /holder_id=eq\.([^&]+)/.exec(u);
      return json(rows.filter((x) => (!m || x.slot_id === m[1]) && (!h || x.holder_id === decodeURIComponent(h[1]))).map((x) => ({ ...x })));
    }
    if (u.includes('/rest/v1/') && !u.includes('/rpc/')) return json([]);
    if (u.includes('/rpc/claim_billboard')) { const a = JSON.parse(opt.body), until = new Date(Date.now() + 72 * 36e5).toISOString();
      state.before = state.boards.map((x) => ({ ...x }));
      const row = { slot_id: a.p_slot_id, holder_id: a.p_actor_id, holder_name: a.p_nickname, line1: a.p_line1, line2: a.p_line2, line3: a.p_line3, current_bid: a.p_bid, lit_until: until, expires_at: until, photo_id: null };
      state.boards = state.boards.filter((x) => x.slot_id !== a.p_slot_id).concat(row);
      return json({ ok: true, billboard: { ...row }, remaining_coins: 1000, prev_holder_id: null }); }
    if (u.includes('/rpc/coin_batch')) { const a = JSON.parse(opt.body); state.coins.push(...a.p_items); return json({ ok: true, flushed: a.p_items.length }); }
    if (u.includes('/rpc/inbox_batch')) { if (state.inboxDown) return new Response('down', { status: 500 }); const a = JSON.parse(opt.body); state.batches.push(a.p_items); return json({ ok: true }); }
    if (u.includes('/rpc/')) return json({ ok: true });
    return new Response('missing', { status: 404 });
  };
}
function harness(env) {
  const waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (p, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + p, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const guest = async () => { const t = (await (await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).token; return { token: t, id: 'guest:' + JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).s }; };
  const post = (p, body, token) => call(p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  return { call, guest, post };
}
// A Supabase user token the Worker accepts (as in ads.test.mjs): an ES256 key published through the fake JWKS.
async function userToken(state, clock, sub) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  state.jwks = [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'inbox-kid' }];
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), head = enc({ alg: 'ES256', kid: 'inbox-kid' });
  const claims = enc({ sub, exp: Math.floor(clock.now() / 1000) + 600, iss: 'https://yxddhpacuyaffaoutxjn.supabase.co/auth/v1', aud: 'authenticated' });
  return { token: head + '.' + claims + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(head + '.' + claims))).toString('base64url'), id: 'user:' + sub };
}
let clockBase = Date.parse('2027-09-01T03:00:00Z'); // 12:00 KST
function freshClock() { clockBase += 60 * 864e5; let t = clockBase; const orig = Date.now; Date.now = () => t; return { add: (ms) => { t += ms; }, to: (v) => { t = v; }, now: () => t, restore: () => { Date.now = orig; } }; }
function setup() {
  const clock = freshClock(), orig = globalThis.fetch, state = { calls: [], boards: [], before: [], coins: [], batches: [], roomReads: 0 };
  globalThis.fetch = fakeNet(state); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  return { clock, state, done: () => { globalThis.fetch = orig; clock.restore(); } };
}
function sock(room, id) {
  const ws = { sent: [], send(s) { this.sent.push(JSON.parse(String(s))); }, close() {}, serializeAttachment() {}, deserializeAttachment() { return null; } };
  ws.a = { k: id, q: true, v2: true, fl: 0, lob: false, t: Date.now(), ls: Date.now(), m: { x: 1500, y: 1500, fl: 0, name: '손님' } };
  room.socks().set(ws, ws.a);
  return ws;
}
const say = (room, ws, m) => { ws.a.ls = Date.now(); room.socks().set(ws, ws.a); return room.webSocketMessage(ws, JSON.stringify(m)); };
const cheer = async (room, ws, slot) => { const n = ws.sent.length; await say(room, ws, { t: 'CHEER', slot, p: 1 }); return ws.sent.slice(n).find((m) => m.t === 'PAY' && m.kind === 'cheer'); };
const inboxOf = (ws) => ws.sent.filter((m) => m.t === 'INBOX' && m.kind === 'cheer');
const ibq = (r) => r.sql.db.prepare('select it from ibq order by id').all().map((x) => JSON.parse(x.it));
const coinOf = (r, uid) => r.sql.db.prepare('select delta from coin where uid = ?').get(uid)?.delta || 0;
const lit = (slot, holder, ms = 864e5) => ({ slot_id: slot, holder_id: holder, holder_name: '주인', line1: '우리 가게', line2: '', line3: '', lit_until: new Date(Date.now() + ms).toISOString(), expires_at: null });
const CLAIM = (slot) => ({ topic: 'chapel:square', slot_id: slot, bid: 300, line1: '우리 가게', nickname: '주인' });
const SQ = 'chapel:square';
const sent = (state) => state.batches.flat();

describe('a cheer reaches the board holder', { concurrency: false }, () => {
  it('right after a claim, in a Room whose isolate has no world copy: live INBOX, the stored row has the holder, paid once', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(IsoRoom), { guest, post } = harness(env), A = await guest(), B = await guest();
      const R = env.room(SQ), room = R.do, a = sock(room, A.id), b = sock(room, B.id);
      assert.equal((await post('/rt/claim-billboard', CLAIM('PLOT_9'), A.token)).status, 200);
      const reads = state.roomReads, pay = await cheer(room, b, 'PLOT_9');
      assert.equal(pay.amount, 4);
      assert.equal(state.roomReads, reads, "the claim's WORLD_UPDATE row was enough: no board read");
      assert.deepEqual(inboxOf(a).map((m) => [m.slot_id, m.from, m.phrase]), [['PLOT_9', B.id, 1]]);
      assert.deepEqual(inboxOf(b), []);
      assert.deepEqual(ibq(R).map((x) => [x.to, x.from, x.slot_id]), [[A.id, B.id, 'PLOT_9']]);
      clock.add(30000); await room.flush();
      assert.deepEqual(sent(state).map((x) => [x.kind, x.to, x.from, x.slot_id, x.phrase]), [['cheer', A.id, B.id, 'PLOT_9', 1]]);
      assert.deepEqual(state.coins.filter((x) => x.actor_id === B.id).map((x) => x.delta), [4]);
      assert.deepEqual(ibq(R), []);
      await room.flush(); clock.add(60000); await room.flush();
      assert.equal(state.batches.length, 1, 'flushed once');
      // The other shards got the same row: a cheer there knows the holder too.
      const R2 = env.room('chapel:square-2'), c = sock(R2.do, 'guest:c'), a2 = sock(R2.do, A.id);
      assert.equal((await cheer(R2.do, c, 'PLOT_9')).amount, 4); assert.equal(inboxOf(a2).length, 1); assert.equal(state.roomReads, reads);
    } finally { done(); }
  });

  it("when the isolate's world copy predates the claim, the Room's own row wins", async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(Room), { call, guest, post } = harness(env), A = await guest(), B = await guest();
      state.boards = [{ ...lit('PLOT_10', null), holder_id: null, holder_name: null, lit_until: null }];
      assert.equal((await call('/rt/world')).status, 200);
      state.lag = true; // the claim refills the isolate copy from a read that does not show it yet
      assert.equal((await post('/rt/claim-billboard', CLAIM('PLOT_10'), A.token)).status, 200);
      const w = await (await call('/rt/world')).json();
      assert.equal(w.billboards.find((x) => x.slot_id === 'PLOT_10').holder_id, null, 'the copy is stale');
      const room = env.room(SQ).do, a = sock(room, A.id), b = sock(room, B.id);
      assert.equal((await cheer(room, b, 'PLOT_10')).amount, 4);
      assert.equal(inboxOf(a).length, 1); assert.deepEqual(ibq(env.room(SQ)).map((x) => x.to), [A.id]);
    } finally { done(); }
  });

  it('refuses and pays nothing when the holder cannot be told; reads the board once when it can', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(IsoRoom), { guest } = harness(env), A = await guest();
      state.boards = [lit('STREET_7', A.id), lit('STREET_9', 'tribe:abcd1234'), lit('STREET_12', A.id, -1000)];
      const R = env.room(SQ), room = R.do, a = sock(room, A.id), b = sock(room, 'guest:b'), c = sock(room, 'guest:c');
      // No WORLD_UPDATE ever reached this room, and Supabase fails: no guess, 'wait' (not 'dark': the board may well be lit).
      state.boardsDown = true;
      let pay = await cheer(room, b, 'STREET_7');
      assert.deepEqual([pay.amount, pay.why], [0, 'wait']);
      // The failure is remembered for 10 s: 30 more cheers (and a reply) in that time make no read.
      const r0 = state.roomReads;
      for (let i = 0; i < 30; i++) assert.equal((await cheer(room, sock(room, 'guest:x' + i), 'STREET_7')).why, 'wait');
      await say(room, a, { t: 'REPLY', slot: 'STREET_7', p: 1, to: 'guest:b' });
      assert.equal(state.roomReads, r0);
      // Supabase never answers: refused after the short limit (2.5 s).
      state.boardsDown = false; state.boardsHang = true; clock.add(13000);
      const t0 = performance.now(); pay = await cheer(room, b, 'STREET_7');
      assert.deepEqual([pay.amount, pay.why], [0, 'wait']); assert.ok(performance.now() - t0 < 4000);
      assert.equal(coinOf(R, 'guest:b'), 0); assert.deepEqual(ibq(R), []); assert.deepEqual(inboxOf(a), []);
      // Supabase answers: paid, delivered, and the row is kept, so the next cheer reads nothing.
      state.boardsHang = false; clock.add(13000);
      const reads = state.roomReads;
      assert.equal((await cheer(room, b, 'STREET_7')).amount, 4); assert.equal(state.roomReads, reads + 1);
      assert.equal(inboxOf(a).length, 1);
      assert.equal((await cheer(room, c, 'STREET_7')).amount, 4); assert.equal(state.roomReads, reads + 1); assert.equal(inboxOf(a).length, 2);
      // After BRD_TTL (5 min) the room reads again.
      clock.add(301000); assert.equal((await cheer(room, c, 'STREET_7')).amount, 4); assert.equal(state.roomReads, reads + 2);
      // Unchanged refusals: own board, dark board, a board with no row (nobody holds it).
      pay = await cheer(room, a, 'STREET_7'); assert.equal(pay.why, 'dark');
      pay = await cheer(room, b, 'STREET_12'); assert.equal(pay.why, 'dark');
      pay = await cheer(room, b, 'STREET_20'); assert.equal(pay.why, 'dark');
      // A tribe holder keeps today's behaviour: the row goes to tribe:<id>.
      assert.equal((await cheer(room, b, 'STREET_9')).amount, 4);
      assert.equal(ibq(R).at(-1).to, 'tribe:abcd1234');
      assert.ok(ibq(R).every((x) => x.to), 'no row without a recipient');
      await room.flush(); assert.ok(sent(state).length === 4 && sent(state).every((x) => x.to), JSON.stringify(sent(state)));
    } finally { done(); }
  });

  it('a stale room row is replaced by the next WORLD_UPDATE; a bulk update makes the room read again', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(IsoRoom), { guest, post } = harness(env), A = await guest(), B = await guest();
      const room = env.room(SQ).do, a = sock(room, A.id), b = sock(room, B.id), c = sock(room, 'guest:c');
      await post('/rt/claim-billboard', CLAIM('STREET_14'), A.token);
      assert.equal((await cheer(room, c, 'STREET_14')).amount, 4); assert.equal(inboxOf(a).length, 1);
      clock.add(61000); await post('/rt/claim-billboard', CLAIM('STREET_14'), B.token); // B takes it over
      assert.equal((await cheer(room, c, 'STREET_14')).amount, 4); assert.equal(inboxOf(a).length, 1); assert.equal(inboxOf(b).length, 1);
      const reads = state.roomReads;
      await room.fetch(new Request('https://room.internal/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"t":"WORLD_UPDATE"}' }));
      clock.add(13000); assert.equal((await cheer(room, c, 'STREET_14')).amount, 4); assert.equal(state.roomReads, reads + 1);
      // A row without holder and clock (a partial row) is not kept: the room reads that board again.
      await room.fetch(new Request('https://room.internal/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: 'WORLD_UPDATE', kind: 'BILLBOARD', data: { slot_id: 'STREET_14', line1: 'x' } }) }));
      clock.add(13000); assert.equal((await cheer(room, c, 'STREET_14')).amount, 4); assert.equal(state.roomReads, reads + 2);
    } finally { done(); }
  });

  it('the chain bonus reads the whole building from the same sources', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(IsoRoom), { guest, post } = harness(env), A = await guest();
      const room = env.room(SQ).do, c = sock(room, 'guest:c'), d = sock(room, 'guest:d');
      state.boards = [lit('SUB_1B', A.id)]; // the other half of corner 1, held before this room started
      await post('/rt/claim-billboard', CLAIM('SUB_1A'), A.token);
      assert.equal((await cheer(room, c, 'SUB_1A')).amount, 8); // both halves lit by A: a chain
      assert.equal((await cheer(room, d, 'SUB_1B')).amount, 8);
    } finally { done(); }
  });

  it('queued rows survive hibernation and leave once; a failed inbox_batch keeps them; the alarm is armed and released as before', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(IsoRoom), { guest, post } = harness(env), A = await guest();
      const R = env.room(SQ), room = R.do;
      await post('/rt/claim-billboard', CLAIM('PLOT_12'), A.token);
      R.ctx.alarm = null;
      const b = sock(room, 'guest:b');
      assert.equal((await cheer(room, b, 'PLOT_12')).amount, 4);
      assert.equal(R.ctx.alarm, clock.now() + 5000, 'pending coins arm the fast alarm (SCAN)');
      room.socks().delete(b); // the last person leaves right after the cheer
      // Hibernation: a new instance over the same storage, nothing in memory.
      const woke = new IsoRoom(R.ctx, env);
      clock.to(R.ctx.alarm); R.ctx.alarm = null; await woke.alarm();
      assert.equal(R.ctx.alarm, clock.now() + 30000, 'coins still pending: re-armed for FLUSH_MS');
      assert.equal(state.batches.length, 0);
      clock.to(R.ctx.alarm); R.ctx.alarm = null; await woke.alarm();
      assert.deepEqual(sent(state).map((x) => [x.to, x.slot_id]), [[A.id, 'PLOT_12']]);
      assert.equal(R.ctx.alarm, null, 'nothing pending and nobody here: the alarm is released');
      clock.add(60000); await woke.alarm(); await woke.flush(); assert.equal(state.batches.length, 1, 'sent once');
      // inbox_batch fails after the coins went out: the rows stay, the alarm is still released (no new alarm for the inbox)...
      state.inboxDown = true; const c = new IsoRoom(R.ctx, env), s = sock(c, 'guest:c');
      clock.add(13000); assert.equal((await cheer(c, s, 'PLOT_12')).amount, 4); c.socks().delete(s);
      clock.add(31000); R.ctx.alarm = null; await c.alarm();
      assert.equal(ibq(R).length, 1); assert.equal(coinOf(R, 'guest:c'), 0); assert.equal(R.ctx.alarm, null);
      // ...and they go out with the next flush or an alarm while someone is here.
      state.inboxDown = false; const d = sock(c, 'guest:d'); clock.add(31000); await c.alarm();
      assert.equal(R.ctx.alarm, clock.now() + 60000, 'a connected socket keeps the slow scan (IDLE_SCAN)');
      assert.deepEqual(ibq(R), []); assert.equal(sent(state).length, 2); assert.ok(sent(state).every((x) => x.to === A.id));
      d.a.ls = Date.now();
    } finally { done(); }
  });

  it('a late read still lands; a read never ties an update relayed meanwhile; budget hard refuses before any read', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(IsoRoom), { guest } = harness(env), A = await guest(), N = await guest();
      state.boards = [lit('STREET_7', A.id)];
      const R = env.room(SQ), room = R.do, b = sock(room, 'guest:b'), c = sock(room, 'guest:c');
      // Slower than 2.5 s: this cheer gives up, the answer still goes into brd, and the next cheer needs no read.
      let open; state.slow = new Promise((r) => { open = r; });
      assert.equal((await cheer(room, b, 'STREET_7')).why, 'wait');
      open(); await new Promise((r) => setTimeout(r, 10)); state.slow = null;
      const reads = state.roomReads; assert.equal((await cheer(room, c, 'STREET_7')).amount, 4); assert.equal(state.roomReads, reads);
      // A read that starts in the same millisecond as a takeover's WORLD_UPDATE (mocked clock: no time passes) does not undo it.
      room.ctx.storage.sql.exec('delete from brd');
      state.slow = new Promise((r) => { open = r; });
      const p = cheer(room, sock(room, 'guest:d'), 'STREET_7');
      await new Promise((r) => setTimeout(r, 5));
      await room.fetch(new Request('https://room.internal/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: 'WORLD_UPDATE', kind: 'BILLBOARD', data: lit('STREET_7', N.id) }) }));
      open(); await p; state.slow = null;
      assert.equal(JSON.parse(R.sql.db.prepare("select b from brd where slot = 'STREET_7'").get().b).holder_id, N.id);
      assert.equal(ibq(R).at(-1).to, N.id);
      // Budget hard: 'wait' before the board is read (not 'cap': the hourly limit was not reached).
      room.ctx.storage.sql.exec('delete from brd'); room.lvl = 2; clock.add(13000);
      const r1 = state.roomReads; assert.deepEqual([(await cheer(room, c, 'STREET_7')).why, state.roomReads], ['wait', r1]);
    } finally { done(); }
  });

  it('a failing shard does not keep the claim from the shards after it', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(IsoRoom), { guest, post } = harness(env), G = await guest();
      const real = env.ROOM.get; env.ROOM.get = (t) => (t === 'chapel:square-2' ? { fetch: () => Promise.reject(new Error('down')) } : real(t));
      assert.equal((await post('/rt/claim-billboard', CLAIM('STREET_5'), G.token)).status, 200);
      env.ROOM.get = real;
      for (const t of ['chapel:square', 'chapel:square-3', 'chapel:square-8']) assert.equal(JSON.parse(env.room(t).sql.db.prepare("select b from brd where slot = 'STREET_5'").get().b).holder_id, G.id, t);
      assert.equal(state.roomReads, 0);
    } finally { done(); }
  });

  it('an account link tells only the live rooms, only when a board moved, and is rate-limited per account before any DO call', async () => {
    const { clock, state, done } = setup();
    try {
      const hits = new Map(), GUEST_RL = { async limit({ key }) { hits.set(key, (hits.get(key) || 0) + 1); return { success: hits.get(key) <= 10 }; } };
      const env = makeEnv(IsoRoom); env.GUEST_RL = GUEST_RL;
      const { guest, post, call } = harness(env), G = await guest();
      assert.equal((await post('/rt/claim-billboard', CLAIM('STREET_5'), G.token)).status, 200); // every chapel: shard keeps G's row
      await env.room('chapel:square-3').do.sit('guest:z', 'chapel:square-3'); // someone seated in shard 3 today: a live room
      // Count Durable Object calls and the rooms told from here on.
      const realR = env.ROOM.get, realM = env.METER.get, told = []; let doCalls = 0;
      env.ROOM.get = (t) => { doCalls++; const r = realR(t); return new Proxy(r, { get: (o, k) => (k === 'fetch' ? (req) => { if (new URL(req.url).pathname === '/world') told.push(t); return o.fetch(req); } : o[k]) }); };
      env.METER.get = (n) => { doCalls++; return realM(n); };
      const U = await userToken(state, clock, '99999999-2222-3333-4444-555555555555');
      const merge = (ip = '2.2.2.2') => call('/rt/auth/merge', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, authorization: 'Bearer ' + U.token }, body: JSON.stringify({ guest_id: G.id, guest_token: G.token, topic: SQ }) });
      // First link: G holds a board, so the caller's shard and the live shard drop their rows. The others keep theirs until BRD_TTL.
      assert.equal((await merge()).status, 200);
      assert.deepEqual(told.sort(), ['chapel:square', 'chapel:square-3']);
      assert.equal(env.room(SQ).sql.db.prepare('select count(*) n from brd').get().n, 0);
      assert.equal(env.room('chapel:square-3').sql.db.prepare('select count(*) n from brd').get().n, 0);
      assert.equal(env.room('chapel:square-5').sql.db.prepare('select count(*) n from brd').get().n, 1);
      state.boards = state.boards.map((x) => (x.slot_id === 'STREET_5' ? { ...x, holder_id: U.id } : x)); // what merge_guest_account did
      const room = env.room(SQ).do, u = sock(room, U.id), g = sock(room, G.id), c = sock(room, 'guest:c');
      assert.equal((await cheer(room, u, 'STREET_5')).why, 'dark'); // the user's own board now
      assert.equal((await cheer(room, c, 'STREET_5')).amount, 4); assert.equal(inboxOf(u).length, 1); assert.equal(inboxOf(g).length, 0);
      // A replay moves nothing: no room is fetched at all.
      told.length = 0; const r0 = env.ROOM.get; let roomGets = 0; env.ROOM.get = (t) => { roomGets++; return r0(t); };
      assert.equal((await merge()).status, 200);
      assert.equal(roomGets, 0); assert.deepEqual(told, []);
      env.ROOM.get = r0;
      // One account, 11 calls in a minute (the two above count): the 11th is refused before any Durable Object call or RPC, from any network.
      for (let i = 2; i < 10; i++) assert.equal((await merge('3.3.3.3')).status, 200, 'call ' + (i + 1));
      const d0 = doCalls, rpc0 = state.calls.filter((x) => x.includes('/rpc/')).length, f0 = state.calls.length;
      const no = await merge('3.3.3.3');
      assert.equal(no.status, 429); assert.equal(no.headers.get('retry-after'), '60');
      assert.deepEqual(await no.json(), { ok: false, err: 'rate', error: '계정을 연결하지 못했어요. 잠시 뒤 다시 해 주세요.' });
      assert.equal(doCalls, d0); assert.equal(state.calls.filter((x) => x.includes('/rpc/')).length, rpc0); assert.equal(state.calls.length, f0);
      assert.equal((await merge('4.4.4.4')).status, 429); // keyed by account, not by network
      assert.deepEqual([...hits.keys()].filter((k) => k !== 'x'), ['merge:' + U.id]); // ('x': the guest mint above, no IP header) never the client IP, so a shared IP's signed-in boots do not use up its guest mints
    } finally { done(); }
  });

  it('a sticker wash checks the holder in Supabase, not a stale isolate copy', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(Room), { call, guest, post } = harness(env), A = await guest(), B = await guest(), C = await guest();
      state.boards = [lit('STREET_15', A.id)];
      assert.equal((await call('/rt/world')).status, 200); // this isolate's copy: A holds it
      state.boards = [lit('STREET_15', B.id)]; // B took it over; the copy above does not know
      const spend = (who, body) => post('/rt/spend', { topic: SQ, nickname: '손님', ...body }, who.token);
      assert.equal((await spend(C, { kind: 'sticker', slot_id: 'STREET_15', glyph: '🔥부럽다!' })).status, 200);
      const no = await spend(A, { kind: 'wash', slot_id: 'STREET_15' });
      assert.equal(no.status, 400); assert.match((await no.json()).error, /내 전광판만/);
      const yes = await spend(B, { kind: 'wash', slot_id: 'STREET_15' });
      assert.equal(yes.status, 200); assert.deepEqual((await yes.json()).list, []);
    } finally { done(); }
  });

  it('keeps the queue bounded: rows past 7 days or the newest 500 are dropped', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(IsoRoom), R = env.room(SQ), room = R.do; room.tapDb();
      const ins = R.sql.db.prepare('insert into ibq(it, at) values(?, ?)');
      ins.run(JSON.stringify({ kind: 'cheer', to: 'guest:old', slot_id: 'STREET_1', phrase: 1 }), clock.now() - 8 * 864e5);
      for (let i = 0; i < 520; i++) ins.run(JSON.stringify({ kind: 'cheer', to: 'guest:n' + i, slot_id: 'STREET_1', phrase: 1 }), clock.now());
      state.inboxDown = true; await room.flushInbox();
      assert.equal(R.sql.db.prepare('select count(*) n from ibq').get().n, 500);
      assert.equal(R.sql.db.prepare("select count(*) n from ibq where it like '%guest:old%'").get().n, 0);
      state.inboxDown = false; for (let i = 0; i < 6; i++) await room.flushInbox();
      assert.equal(R.sql.db.prepare('select count(*) n from ibq').get().n, 0);
      assert.equal(sent(state).length, 500); assert.equal(Math.max(...state.batches.map((x) => x.length)), 100);
      assert.equal(new Set(sent(state).map((x) => x.to)).size, 500);
    } finally { done(); }
  });
});
