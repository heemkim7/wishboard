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
const { DARK } = await import('../dark.js');
const { wishDay } = await import('../wish.js');

// Package harden: the limits and memos that keep one person (or one IP) from burning the daily Durable Object budget. Same harness as inbox-room.test.mjs:
// real DOs on in-memory SQLite behind a stub that copies arguments like the runtime, plus a DO alarm the test can read.
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
function makeEnv(extra = {}) {
  const meters = new Map(), rooms = new Map();
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ADMIN_KEY: 'admin-test-key-123', ASSETS: { fetch: () => new Response('asset', { status: 200 }) }, ...extra };
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new Meter(makeCtx(sql), env) }); } return meters.get(name); };
  env.room = (topic) => { if (!rooms.has(topic)) { const sql = sqliteStorage(), ctx = makeCtx(sql); rooms.set(topic, { sql, ctx, do: new Room(ctx, env) }); } return rooms.get(topic); };
  env.METER = { idFromName: (name) => name, get: (name) => stub(env.meter(name).do) };
  env.ROOM = { idFromName: (topic) => topic, get: (topic) => stub(env.room(topic).do) };
  return env;
}
// Every Durable Object method call from here on, as 'meter:<instance>.<method>' / 'room:<topic>.<method or fetch path>'.
function spyDo(env) {
  const calls = [], rm = env.METER.get, rr = env.ROOM.get;
  const wrap = (s, tag) => new Proxy(s, { get: (t, k) => typeof t[k] === 'function' ? (...a) => { calls.push(tag + '.' + (k === 'fetch' ? new URL(a[0].url).pathname : String(k))); return t[k](...a); } : t[k] });
  env.METER.get = (n) => wrap(rm(n), 'meter:' + n); env.ROOM.get = (t) => wrap(rr(t), 'room:' + t);
  return calls;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
// Fake Supabase. state.boards: billboards rows.
function fakeNet(state) {
  return async (url, opt = {}) => {
    const u = String(url); state.calls.push(u);
    if (u.includes('/.well-known/jwks.json')) return json({ keys: state.jwks || [] });
    if (u.includes('/rest/v1/billboards')) { state.boardReads++; const m = /slot_id=eq\.(\w+)/.exec(u), h = /holder_id=eq\.([^&]+)/.exec(u);
      return json(state.boards.filter((x) => (!m || x.slot_id === m[1]) && (!h || x.holder_id === decodeURIComponent(h[1]))).map((x) => ({ ...x }))); }
    if (u.includes('/rest/v1/') && !u.includes('/rpc/')) return json([]);
    if (u.includes('/rpc/claim_billboard')) { const a = JSON.parse(opt.body), until = new Date(Date.now() + 72 * 36e5).toISOString();
      const row = { slot_id: a.p_slot_id, holder_id: a.p_actor_id, holder_name: a.p_nickname, line1: a.p_line1, current_bid: a.p_bid, lit_until: until, expires_at: until, photo_id: null };
      state.claims.push(a); state.boards = state.boards.filter((x) => x.slot_id !== a.p_slot_id).concat(row);
      return json({ ok: true, billboard: { ...row }, remaining_coins: 1000, prev_holder_id: null }); }
    if (u.includes('/rpc/relight_billboard')) { const a = JSON.parse(opt.body), day = wishDay(Date.now()), r = state.relit.get(a.p_slot_id); state.relights++; // schema.sql: once per KST day,
      if (r && r.day === day) return json({ ok: true, lit_until: r.until, lit_days: r.n }); // and a repeat leaves the clock and has no scored key
      const n = { day, until: new Date(Date.now() + 72 * 36e5).toISOString(), n: (r?.n || 1) + 1 }; state.relit.set(a.p_slot_id, n); for (const x of state.boards) if (x.slot_id === a.p_slot_id) x.lit_until = x.expires_at = n.until; // state.oldDb: a function that never says scored
      return json({ ok: true, lit_until: n.until, lit_days: n.n, ...(state.oldDb ? {} : { scored: true }) }); }
    if (u.includes('/rpc/grant_coins')) { state.paid.push(JSON.parse(opt.body)); return json({ ok: true, coins: 1 }); }
    if (u.includes('/rpc/add_tribe_score')) { state.tribe.push(JSON.parse(opt.body)); return json({ ok: true }); }
    if (u.includes('/rpc/merge_guest_account')) return json({ ok: true, coins: 1, bonus: 0 });
    if (u.includes('/rpc/')) return json({ ok: true });
    return new Response('missing', { status: 404 });
  };
}
function harness(env) {
  const waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (p, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + p, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const guest = async (ip = '9.9.9.9') => { const r = await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: '{}' }); if (r.status !== 200) return { status: r.status };
    const t = (await r.json()).token; return { status: 200, token: t, id: 'guest:' + JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).s }; };
  const post = (p, body, token, ip = '1.1.1.1') => call(p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const get = (p, token, ip = '1.1.1.1') => call(p, { headers: { 'cf-connecting-ip': ip, ...(token ? { authorization: 'Bearer ' + token } : {}) } });
  return { call, guest, post, get };
}
// One signing key for the whole test, many accounts (the Worker caches the JWKS by kid).
async function signer(state, clock, kid) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  state.jwks = [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid }];
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), head = enc({ alg: 'ES256', kid });
  return async (sub) => { const claims = enc({ sub, exp: Math.floor(clock.now() / 1000) + 3600, iss: 'https://yxddhpacuyaffaoutxjn.supabase.co/auth/v1', aud: 'authenticated' });
    return { token: head + '.' + claims + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(head + '.' + claims))).toString('base64url'), id: 'user:' + sub }; };
}
// The real binding's shape: { limit({ key }) } -> { success }, 10 a minute per key.
function limiter(clock) { const hits = new Map(); return { hits, async limit({ key }) { const m = Math.floor(clock.now() / 60000), h = hits.get(key); const n = h && h.m === m ? h.n + 1 : 1; hits.set(key, { m, n }); return { success: n <= 10 }; } }; }
let clockBase = Date.parse('2028-02-01T03:00:00Z'); // 12:00 KST
function freshClock() { clockBase += 60 * 864e5; let t = clockBase; const orig = Date.now; Date.now = () => t; return { add: (ms) => { t += ms; }, now: () => t, restore: () => { Date.now = orig; } }; }
function setup() {
  const clock = freshClock(), orig = globalThis.fetch, state = { calls: [], boards: [], claims: [], paid: [], tribe: [], boardReads: 0, relit: new Map(), relights: 0 };
  globalThis.fetch = fakeNet(state); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  return { clock, state, done: () => { globalThis.fetch = orig; clock.restore(); } };
}
const CLAIM = (slot = 'STREET_5', bid = 300) => ({ topic: 'chapel:square', slot_id: slot, bid, line1: '우리 가게', nickname: '주인' });
const uuid = (i) => '1234abcd-0000-4000-8000-' + String(i).padStart(12, '0');
const RATE = (error) => ({ ok: false, err: 'rate', error });

describe('account link and withdrawal limits', { concurrency: false }, () => {
  it('20 signed-in people on one IP each link once, and the IP can still mint guests', async () => {
    const { clock, state, done } = setup();
    try {
      const RL = limiter(clock), env = makeEnv({ GUEST_RL: RL }), { guest, post } = harness(env), user = await signer(state, clock, 'harden-a');
      const pairs = [];
      for (let i = 0; i < 20; i++) pairs.push({ g: await guest('10.0.0.' + i), u: await user(uuid(i)) }); // each guest from its own home network
      for (const { g, u } of pairs) { const r = await post('/rt/auth/merge', { guest_id: g.id, guest_token: g.token }, u.token, '5.5.5.5'); assert.equal(r.status, 200, u.id); }
      assert.equal(RL.hits.has('5.5.5.5'), false, 'a link never counts against the IP');
      for (let i = 0; i < 10; i++) assert.equal((await guest('5.5.5.5')).status, 200, 'mint ' + (i + 1)); // the café's new visitors still get in
      assert.equal((await guest('5.5.5.5')).status, 429); // and the mint limit itself still holds
    } finally { done(); }
  });

  it('one account replaying a link is refused from the 11th call in a minute, before any Durable Object call or fetch', async () => {
    const { clock, state, done } = setup();
    try {
      const RL = limiter(clock), env = makeEnv({ GUEST_RL: RL }), { guest, post } = harness(env), user = await signer(state, clock, 'harden-b');
      const g = await guest(), u = await user(uuid(101)), other = await user(uuid(102)), g2 = await guest('9.9.9.8');
      for (let i = 0; i < 10; i++) assert.equal((await post('/rt/auth/merge', { guest_id: g.id, guest_token: g.token }, u.token, '6.6.6.' + i)).status, 200);
      const calls = spyDo(env), f0 = state.calls.length;
      const no = await post('/rt/auth/merge', { guest_id: g.id, guest_token: g.token }, u.token, '7.7.7.7');
      assert.equal(no.status, 429); assert.equal(no.headers.get('retry-after'), '60');
      assert.deepEqual(await no.json(), RATE('계정을 연결하지 못했어요. 잠시 뒤 다시 해 주세요.'));
      assert.deepEqual(calls, []); assert.equal(state.calls.length, f0);
      assert.equal((await post('/rt/auth/merge', { guest_id: g2.id, guest_token: g2.token }, other.token, '7.7.7.7')).status, 200); // another account, same IP
      clock.add(60000); assert.equal((await post('/rt/auth/merge', { guest_id: g.id, guest_token: g.token }, u.token)).status, 200); // the next minute
    } finally { done(); }
  });

  it('one account replaying withdraw is refused from the 11th call in a minute, before any Durable Object call or RPC', async () => {
    const { clock, state, done } = setup();
    try {
      const RL = limiter(clock), env = makeEnv({ GUEST_RL: RL }), { post } = harness(env), user = await signer(state, clock, 'harden-c'), u = await user(uuid(201)), v = await user(uuid(202));
      let calls = spyDo(env);
      assert.equal((await post('/rt/auth/withdraw', {}, u.token)).status, 200);
      assert.ok(calls.length > 16, 'one withdrawal is many DO calls: ' + calls.length); // forgetActor and the 16-room fan-out: why it is limited
      for (let i = 1; i < 10; i++) assert.equal((await post('/rt/auth/withdraw', {}, u.token, '8.8.8.' + i)).status, 200, 'call ' + (i + 1));
      calls.length = 0; const f0 = state.calls.length;
      const no = await post('/rt/auth/withdraw', {}, u.token);
      assert.equal(no.status, 429); assert.equal(no.headers.get('retry-after'), '60');
      assert.deepEqual(await no.json(), RATE('탈퇴를 처리하지 못했어요. 잠시 뒤 다시 해 주세요.'));
      assert.deepEqual(calls, []); assert.equal(state.calls.length, f0, 'no withdraw_account RPC');
      assert.equal((await post('/rt/auth/withdraw', {}, v.token)).status, 200); // another account
      assert.deepEqual([...RL.hits.keys()].sort(), ['withdraw:' + u.id, 'withdraw:' + v.id].sort());
    } finally { done(); }
  });
});

describe('memos in front of Durable Object reads', { concurrency: false }, () => {
  it('GET /rt/league with a token: one lg call per account per 10 s, fresh right after my own spend', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), { guest, post, get } = harness(env), a = await guest(), b = await guest();
      const calls = spyDo(env), lgTop = () => calls.filter((c) => c === 'meter:lg.lgTop').length;
      const r1 = await (await get('/rt/league', a.token)).json(); assert.equal(r1.ok, true); assert.equal(r1.me.rank, 0);
      for (let i = 0; i < 5; i++) assert.deepEqual(await (await get('/rt/league', a.token)).json(), r1);
      assert.equal(lgTop(), 1);
      await get('/rt/league', b.token); assert.equal(lgTop(), 2); // per account
      clock.add(10001); await get('/rt/league', a.token); assert.equal(lgTop(), 3);
      // My own spend clears it: the read 1.5 s later (leagueSoon) shows the new rank.
      assert.equal((await post('/rt/claim-billboard', CLAIM('STREET_5', 300), a.token)).status, 200);
      clock.add(1500); const r2 = await (await get('/rt/league', a.token)).json();
      assert.equal(lgTop(), 4); assert.deepEqual([r2.me.rank, r2.me.spent], [1, 300]);
    } finally { done(); }
  });

  it('GET /rt/ad-report: one Supabase read and one ad call per account and slot per 10 s', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), { guest, get } = harness(env), a = await guest(), b = await guest();
      state.boards = [{ slot_id: 'STREET_5', holder_id: a.id }, { slot_id: 'STREET_6', holder_id: a.id }];
      const calls = spyDo(env), reads = () => calls.filter((c) => c === 'meter:ad.adRead').length;
      const r1 = await get('/rt/ad-report?slot=STREET_5', a.token); assert.equal(r1.status, 200); const body = await r1.json(); assert.equal(body.ok, true);
      const b0 = state.boardReads;
      for (let i = 0; i < 5; i++) assert.deepEqual(await (await get('/rt/ad-report?slot=STREET_5', a.token)).json(), body);
      assert.equal(reads(), 1); assert.equal(state.boardReads, b0);
      assert.equal((await get('/rt/ad-report?slot=STREET_6', a.token)).status, 200); assert.equal(reads(), 2); // per slot
      assert.equal((await get('/rt/ad-report?slot=STREET_5', b.token)).status, 403); assert.equal((await get('/rt/ad-report?slot=STREET_5', b.token)).status, 403); // a refusal is not kept: the holder is read each time
      assert.equal(reads(), 2);
      clock.add(10001); await get('/rt/ad-report?slot=STREET_5', a.token); assert.equal(reads(), 3);
    } finally { done(); }
  });

  it('GET /rt/here: one room call per 5 s', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), { get } = harness(env), calls = spyDo(env), stats = () => calls.filter((c) => c === 'room:chapel:square.stats').length;
      for (let i = 0; i < 20; i++) assert.deepEqual(await (await get('/rt/here', null, '2.2.2.' + i)).json(), { live: 0 });
      assert.equal(stats(), 1);
      clock.add(5001); await get('/rt/here'); assert.equal(stats(), 2);
    } finally { done(); }
  });
});

describe('board edits are spaced per account', { concurrency: false }, () => {
  it('one edit per account per 3 s, refused before any Durable Object call; claims are never slowed', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), { guest, post } = harness(env), a = await guest(), b = await guest();
      assert.equal((await post('/rt/claim-billboard', CLAIM('STREET_5'), a.token)).status, 200);
      assert.equal((await post('/rt/claim-billboard', CLAIM('STREET_6'), a.token)).status, 200); // a second paid claim right away
      const edit = { ...CLAIM('STREET_5'), mode: 'edit', line1: '고친 줄' };
      assert.equal((await post('/rt/claim-billboard', { ...edit, topic: 'nowhere' }, a.token)).status, 400); // a free refusal does not start the gap
      assert.equal((await post('/rt/claim-billboard', edit, a.token)).status, 200);
      const calls = spyDo(env), f0 = state.calls.length, c0 = state.claims.length;
      for (const body of [edit, { ...edit, bid: 400 }]) { // a raise of one's own bid is an edit too
        const no = await post('/rt/claim-billboard', body, a.token);
        assert.equal(no.status, 429); assert.deepEqual(await no.json(), { ok: false, error: '조금만 천천히요. 3초 뒤에 다시 해 주세요.' }); }
      assert.deepEqual(calls, []); assert.equal(state.calls.length, f0); assert.equal(state.claims.length, c0);
      assert.equal((await post('/rt/claim-billboard', CLAIM('STREET_7'), a.token)).status, 200); // a claim inside the gap
      assert.equal((await post('/rt/claim-billboard', { ...CLAIM('STREET_8'), mode: 'edit' }, b.token)).status, 200); // another account
      clock.add(3000); assert.equal((await post('/rt/claim-billboard', edit, a.token)).status, 200);
    } finally { done(); }
  });

  // oldDb: relight_billboard never answers scored (production's function may predate schema.sql); the moved clock is then read from lit_until.
  for (const oldDb of [false, true]) it(`relight${oldDb ? ' (a database without scored)' : ''}: one per account per 3 s before the RPC and any DO call; the day's first relight reads the board, updates the dark registry and tells the rooms; a later same-day repeat does none of that`, async () => {
    const { clock, state, done } = setup(); state.oldDb = oldDb;
    try {
      const env = makeEnv(), { guest, post } = harness(env), a = await guest(), RL = { slot: 'STREET_5', topic: 'chapel:square' };
      assert.equal((await post('/rt/claim-billboard', CLAIM('STREET_5'), a.token)).status, 200);
      const litOf = () => env.meter('dark').sql.db.prepare("select lit from dk where slot = 'STREET_5'").get()?.lit;
      const lit0 = litOf(); assert.ok(lit0 > 0);
      clock.add(3600e3); // an hour after the claim, the same KST day
      const calls = spyDo(env), told = () => calls.filter((c) => /^room:.*\.\/world$/.test(c)).length, b0 = state.boardReads;
      const first = await (await post('/rt/relight', RL, a.token)).json(); assert.equal(first.ok, true); assert.equal(first.scored, !oldDb);
      assert.equal(told(), 8); assert.equal(state.relights, 1); assert.ok(state.boardReads > b0, 'the board row (and the world refill) is read');
      assert.equal(litOf(), Date.parse(first.lit_until)); assert.ok(litOf() > lit0, 'the dark registry has the new clock');
      calls.length = 0; const f0 = state.calls.length;
      for (let i = 0; i < 10; i++) { const no = await post('/rt/relight', RL, a.token); assert.equal(no.status, 429); assert.deepEqual(await no.json(), { ok: false, error: '조금만 천천히요. 3초 뒤에 다시 해 주세요.' }); }
      assert.deepEqual(calls, []); assert.equal(state.calls.length, f0); assert.equal(state.relights, 1);
      // Within 2 minutes of the first, a repeat still looks moved (lit_until ~ now + 72 h) and is told again: bounded by the gap, once a day.
      clock.add(3000); assert.equal((await post('/rt/relight', RL, a.token)).status, 200); assert.equal(told(), 8);
      clock.add(600000); calls.length = 0; const b1 = state.boardReads;
      const again = await (await post('/rt/relight', RL, a.token)).json();
      assert.deepEqual([again.ok, again.scored, again.lit_days], [true, false, 2]);
      assert.equal(state.relights, 3); assert.deepEqual(calls.filter((c) => c !== 'meter:day.add'), [], '10 minutes later: no DO call (day.add is the batched budget report any request may carry)'); assert.equal(state.boardReads, b1, 'and no board read');
      assert.equal(litOf(), Date.parse(first.lit_until));
      clock.add(864e5); calls.length = 0; const next = await (await post('/rt/relight', RL, a.token)).json(); // the next KST day
      assert.deepEqual([next.scored, next.lit_days], [!oldDb, 3]); assert.equal(told(), 8); assert.equal(litOf(), Date.parse(next.lit_until));
    } finally { done(); }
  });
});

describe('subrequest caps', { concurrency: false }, () => {
  it('the dark alarm handles at most 6 rows a pass', () => { assert.equal(DARK.passMax, 6); });

  it('wish prizes: at most 3 paid per settlement run, the rest on the next run 60 s later, each once', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), { get } = harness(env), m = env.meter('wish').do, now = clock.now(), want = [];
      for (const back of [2, 1]) { const day = wishDay(now - back * 864e5);
        for (let k = 0; k < 3; k++) { const uid = `guest:win${back}${k}`, w = m.wPost(uid, '가', '소원 ' + back + k, day, now - back * 864e5 + k).wish; want.push(uid);
          for (let i = 0; i < 8 - k; i++) assert.equal(m.wHeart(`guest:h${back}${k}${i}`, w.id, 'ip' + i, day).ok, true); } }
      await get('/rt/wishes'); assert.equal(state.paid.length, 3);
      clock.add(30000); await get('/rt/wishes'); assert.equal(state.paid.length, 3, 'not again inside 60 s');
      clock.add(31000); await get('/rt/wishes'); assert.equal(state.paid.length, 6);
      clock.add(61000); await get('/rt/wishes'); clock.add(61000); await get('/rt/wishes');
      assert.deepEqual(state.paid.map((p) => p.p_actor_id).sort(), want.sort(), 'every winner once, nobody twice');
      assert.deepEqual(state.paid.map((p) => p.p_amount).sort(), [100, 100, 200, 200, 300, 300]);
    } finally { done(); }
  });

  it('the Room sends at most 20 tribe scores per flush, keeps the rest for the next, loses none, and arms its alarm as before', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv({ FLUSH_KEY: 'harden-flush-key' }), yday = wishDay(clock.now() - 864e5);
      const seed = (R, n) => { R.do.tapDb(); for (let i = 0; i < n; i++) R.sql.exec("insert into ag(uid, k, d, v) values(?, 'ts', ?, 1)", 'guest:t' + i, yday); };
      const sent = (R) => R.sql.db.prepare("select count(*) n from ag where k = 'tso'").get().n;
      const R = env.room('chapel:square'); seed(R, 25);
      await R.do.alarm(); assert.equal(state.tribe.length, 20); assert.equal(sent(R), 20);
      assert.equal(R.ctx.alarms, 0, 'nobody there: the alarm is released, as before');
      await R.do.flushTribeScores(); assert.equal(state.tribe.length, 25); assert.equal(sent(R), 25);
      await R.do.flushTribeScores(); assert.equal(state.tribe.length, 25);
      assert.deepEqual(state.tribe.map((x) => x.p_actor_id).sort(), Array.from({ length: 25 }, (_, i) => 'guest:t' + i).sort());
      // With someone in the room the alarm is armed IDLE_SCAN ahead whether or not scores are waiting.
      const at = (R2) => { const ws = { send() {}, close() {}, serializeAttachment() {}, deserializeAttachment() { return null; } };
        R2.do.socks().set(ws, { k: 'guest:here', q: true, v2: true, fl: 0, lob: false, t: Date.now(), ls: Date.now(), m: { x: 1, y: 1, fl: 0, name: '손님' } }); return R2.do.alarm().then(() => R2.ctx.alarm - Date.now()); };
      const busy = env.room('chapel:square-2'); seed(busy, 30);
      assert.equal(await at(busy), await at(env.room('chapel:square-3')));
      assert.equal(await at(env.room('chapel:square-4')), 60000);
    } finally { done(); }
  });
});

describe('budget hard: no shard fan-out', { concurrency: false }, () => {
  const told = (calls) => calls.filter((c) => /^room:.*\.\/world$/.test(c));
  it('below hard a claim tells every shard', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), { guest, post } = harness(env), a = await guest(), calls = spyDo(env);
      assert.equal((await post('/rt/claim-billboard', CLAIM('STREET_5'), a.token)).status, 200);
      assert.equal(told(calls).length, 8); // chapel:square and -2 … -8
    } finally { done(); }
  });
  it('at hard the claim, the edit and the relight still answer and refill the world, but no room is told', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv({ BUDGET_REQ_DAY: '1' }), { guest, post } = harness(env), a = await guest(), calls = spyDo(env);
      const claim = await post('/rt/claim-billboard', CLAIM('STREET_5'), a.token); assert.equal(claim.status, 200); assert.equal((await claim.json()).broadcast, false);
      clock.add(3000); assert.equal((await post('/rt/claim-billboard', { ...CLAIM('STREET_5'), mode: 'edit' }, a.token)).status, 200);
      const w0 = state.calls.filter((u) => u.includes('/rest/v1/billboards?select=*')).length;
      assert.equal((await post('/rt/relight', { slot: 'STREET_5', topic: 'chapel:square' }, a.token)).status, 200);
      assert.deepEqual(told(calls), []);
      assert.ok(state.calls.filter((u) => u.includes('/rest/v1/billboards?select=*')).length > w0, 'the relight still reads the board row');
    } finally { done(); }
  });
});
