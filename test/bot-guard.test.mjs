// Bot protection (docs/bot-protection.md): new guests (GUEST_RL by network, Turnstile behind TURNSTILE_SITE + TURNSTILE_SECRET, a day count per
// network), per-account limits (ACT_RL), the room's socket cap and flood guard, the budget-hard event drop, and the client side (net.js
// guestToken, human.js, the VIP share card).
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: new URL('./cf-stub.mjs', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});
globalThis.WebSocketRequestResponsePair = class { constructor(req, res) { this.req = req; this.res = res; } };
// net.js reads these at load (plaza.test.mjs sets the same).
globalThis.window = globalThis;
Object.defineProperty(globalThis, 'navigator', { value: { webdriver: false, onLine: true, userAgent: 'node' }, configurable: true });
globalThis.document = { hidden: false, addEventListener() {} };
globalThis.addEventListener = () => {};
globalThis.localStorage = { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); }, removeItem(k) { this.m.delete(k); } };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = { search: '?rt=do', hostname: 'masil.example.workers.dev', href: 'https://masil.example.workers.dev/', protocol: 'https:', origin: 'https://masil.example.workers.dev' };

const W = await import('../worker.js');
const worker = W.default, { Meter, Room } = W;
const { wishDay } = await import('../wish.js');
const net = await import('../net.js');
const { GT_LS } = await import('../plaza-account.js');
const human = await import('../human.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('worker.js exports', () => {
  // workerd treats every named export of the Worker's main module as an entrypoint ("Incorrect type for map entry ...: the provided value
  // is not of type 'function or ExportedHandler'") and the Worker does not start. Only functions and classes may be exported.
  it('are only functions or classes, plus the default handler', () => {
    for (const [k, v] of Object.entries(W)) {
      if (k === 'default') { assert.equal(typeof v?.fetch, 'function'); continue; }
      assert.equal(typeof v, 'function', k + ' is exported as a ' + typeof v);
    }
  });
});

function sqliteStorage() {
  const db = new DatabaseSync(':memory:');
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
    storage: { sql, async getAlarm() { return null; }, async setAlarm() {}, async deleteAlarm() {}, transactionSync(fn) { return fn(); } },
    setWebSocketAutoResponse() {}, getWebSockets() { return []; }, getWebSocketAutoResponseTimestamp() { return new Date(Date.now()); }, acceptWebSocket() {},
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
function spyDo(env) {
  const log = [];
  for (const ns of [env.METER, env.ROOM]) { const real = ns.get; ns.get = (name) => { const s = real(name); return new Proxy(s, { get: (t, k) => typeof t[k] === 'function' ? (...a) => { if (name !== 'day') log.push(name + '.' + String(k)); return t[k](...a); } : t[k] }); }; }
  return log;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const SITE = '0x4AAAAAAAtestSiteKey', SECRET = 'test-secret-not-real';
// Supabase does not matter here; siteverify answers what state.verify says (default: a pass for the token 'good').
function fakeNet(state) {
  return async (url, opt = {}) => {
    const u = String(url);
    if (u.startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) { const b = JSON.parse(opt.body || '{}'); state.verifies.push(b); return state.verify ? state.verify(b) : json(b.response === 'good' ? { success: true, action: 'guest', hostname: 'localhost' } : { success: false, 'error-codes': ['invalid-input-response'] }); }
    if (u.includes('/rpc/')) return json({ ok: true });
    if (u.includes('/rest/v1/')) return json([]);
    return new Response('missing', { status: 404 });
  };
}
let clockBase = Date.parse('2031-03-01T03:00:00Z');
function setup() {
  clockBase += 10 * 864e5; let t = clockBase; const origNow = Date.now, origFetch = globalThis.fetch, state = { verifies: [], verify: null };
  Date.now = () => t; globalThis.fetch = fakeNet(state); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  return { clock: { add: (ms) => { t += ms; }, now: () => t }, state, done: () => { Date.now = origNow; globalThis.fetch = origFetch; } };
}
function harness(env) {
  const waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (path, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + path, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const post = (path, body, token, ip = '1.1.1.1') => call(path, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const mint = async (body = {}, ip = '1.1.1.1') => { const res = await post('/rt/guest', body, null, ip); return { status: res.status, headers: res.headers, body: await res.json() }; };
  const guest = async (ip = '1.1.1.1', body = {}) => { const r = await mint(body, ip); assert.equal(r.status, 200, JSON.stringify(r.body)); return { token: r.body.token, sub: r.body.sub, id: 'guest:' + r.body.sub }; };
  const get = (path, token, ip = '1.1.1.1') => call(path, { headers: { 'cf-connecting-ip': ip, ...(token ? { authorization: 'Bearer ' + token } : {}) } });
  return { call, post, mint, guest, get };
}
const utcDay = () => new Date().toISOString().slice(0, 10);
const setUsed = (env, n) => env.meter('day').sql.db.prepare('insert into d(day, n) values(?, ?) on conflict(day) do update set n = excluded.n').run(utcDay(), n);
const limiter = (allow = () => true) => { const keys = [], rl = { keys, allow: true, async limit({ key }) { keys.push(key); return { success: rl.allow && !!allow(key, keys) }; } }; return rl; };
const ON = { TURNSTILE_SITE: SITE, TURNSTILE_SECRET: SECRET };
const HUMAN_NO = { err: 'human', code: 'human', site: SITE, error: '사람인지 확인하지 못했어요. 다시 시도해 주세요.' };
const DAY_NO = { err: 'day', code: 'day', error: '오늘 이 인터넷 연결에서 새 손님이 너무 많이 들어왔어요. 계정이 있으면 로그인하거나 내일 다시 와 주세요.' };

describe('new guests: Turnstile behind its two switches', { concurrency: false }, () => {
  it('/rt/config names the site key only when both switches are set and the key has the right shape', async () => {
    const { done } = setup();
    try {
      for (const [extra, want] of [[{}, undefined], [{ TURNSTILE_SITE: SITE }, undefined], [{ TURNSTILE_SECRET: SECRET }, undefined], [ON, SITE], [{ ...ON, TURNSTILE_SITE: 'bad key!' }, undefined], [{ ...ON, TURNSTILE_SITE: '  ' + SITE + ' ' }, SITE]]) {
        const cfg = await (await harness(makeEnv(extra)).get('/rt/config')).json();
        assert.equal(cfg.turnstile, want, JSON.stringify(extra));
      }
      assert.equal(W.humanSite({ TURNSTILE_SITE: SITE, TURNSTILE_SECRET: ' ' }), '');
    } finally { done(); }
  });

  it('switched off (the default): a new guest needs no token and siteverify is never asked', async () => {
    const { state, done } = setup();
    try {
      const { mint } = harness(makeEnv({ TURNSTILE_SITE: SITE }));
      const r = await mint({ ts: 'whatever' }); assert.equal(r.status, 200); assert.match(r.body.token, /^g1\./);
      assert.equal(state.verifies.length, 0);
    } finally { done(); }
  });

  it('switched on: no token or a refused one mints nothing (403 human with the site key); a good token mints; renewals and handovers need none', async () => {
    const { state, done } = setup();
    try {
      const RL = limiter(), env = makeEnv({ ...ON, GUEST_RL: RL }), { mint, call } = harness(env);
      const none = await mint({}, '203.0.113.7'); assert.equal(none.status, 403); assert.deepEqual(none.body, HUMAN_NO);
      assert.equal(state.verifies.length, 0, 'no token: refused without a siteverify call');
      assert.deepEqual(RL.keys, [], 'and without a GUEST_RL count: the page asks again with its token');
      const bad = await mint({ ts: 'forged' }, '203.0.113.7'); assert.equal(bad.status, 403); assert.deepEqual(bad.body, HUMAN_NO);
      assert.deepEqual(RL.keys, ['203.0.113.7'], 'with a token GUEST_RL comes first, before siteverify');
      RL.allow = false; const fast = await mint({ ts: 'good' }, '203.0.113.7'); assert.equal(fast.status, 429); assert.equal(state.verifies.length, 1, 'refused before siteverify'); RL.allow = true;
      assert.equal((await mint({ ts: 'x'.repeat(2049) })).status, 403, 'longer than any Turnstile token');
      const ok = await mint({ ts: 'good' }, '203.0.113.7'); assert.equal(ok.status, 200); assert.match(ok.body.token, /^g1\./);
      assert.deepEqual(state.verifies.at(-1), { secret: SECRET, response: 'good', remoteip: '203.0.113.7' });
      // Another action's token, a spent one (even on a 4xx), a plain refusal: never a mint.
      for (const answer of [json({ success: true, action: 'login' }), json({ success: false, 'error-codes': ['timeout-or-duplicate'] }), json({ success: false, 'error-codes': ['invalid-input-response'] }, 400), json({ success: false })]) {
        state.verify = () => answer.clone(); assert.equal((await mint({ ts: 'good' })).status, 403);
      }
      state.verify = null;
      // The guest's own token (renewal) and a handover ticket: no human check, no siteverify call.
      const n = state.verifies.length;
      const renewed = await mint({ t: ok.body.token }); assert.equal(renewed.status, 200); assert.equal(renewed.body.sub, ok.body.sub);
      const { ticket } = await (await call('/rt/handover', { method: 'POST', headers: { authorization: 'Bearer ' + ok.body.token } })).json();
      const handed = await mint({ h: ticket }); assert.equal(handed.status, 200); assert.equal(handed.body.sub, ok.body.sub);
      assert.equal(state.verifies.length, n);
      // A broken token or a bare id is still a mint, so it needs the check.
      assert.equal((await mint({ t: 'g1.broken.token' })).status, 403);
      assert.equal((await mint({ h: ok.body.sub })).status, 403);
    } finally { done(); }
  });

  it('siteverify that cannot judge (unreachable, 5xx, internal-error, our own secret refused) lets people in, at most 3 a minute and 10 a day per network', async () => {
    const { state, clock, done } = setup(), warn = console.warn, warned = [];
    console.warn = (...a) => warned.push(a.join(' '));
    try {
      const env = makeEnv(ON), { mint } = harness(env);
      const answers = [() => { throw new Error('network'); }, () => json({ message: 'upstream' }, 502), () => json({ success: false, 'error-codes': ['internal-error'] }), () => json({ success: false, 'error-codes': ['invalid-input-secret'] })];
      let ip = 10;
      for (const a of answers) { state.verify = a; const r = await mint({ ts: 'tok' }, '198.51.100.' + (++ip)); assert.equal(r.status, 200, String(a)); }
      assert.equal(warned.length, 4); assert.equal(warned.join(' ').includes(SECRET), false);
      // One network: 3 a minute in this isolate, then 10 a day in the acct instance.
      state.verify = answers[0];
      for (let i = 0; i < 3; i++) assert.equal((await mint({ ts: 'tok' }, '192.0.2.50')).status, 200);
      const fast = await mint({ ts: 'tok' }, '192.0.2.50'); assert.equal(fast.status, 429); assert.deepEqual(fast.body, { err: 'rate' });
      for (let i = 0; i < 7; i++) { if (i % 3 === 0) clock.add(61000); assert.equal((await mint({ ts: 'tok' }, '192.0.2.50')).status, 200, 'open mint ' + (i + 4)); }
      clock.add(61000); const day = await mint({ ts: 'tok' }, '192.0.2.50'); assert.equal(day.status, 429); assert.deepEqual(day.body, DAY_NO);
      // A real pass from that network is still let in: the open count is its own, only the day cap (100) holds it.
      state.verify = null; assert.equal((await mint({ ts: 'good' }, '192.0.2.50')).status, 200);
    } finally { console.warn = warn; done(); }
  });
});

describe('new guests: GUEST_RL and the day count per network', { concurrency: false }, () => {
  it('GUEST_RL is keyed by the network: an IPv6 /64 is one key, IPv4 as it is', async () => {
    const { done } = setup();
    try {
      const RL = limiter(), { mint } = harness(makeEnv({ GUEST_RL: RL }));
      for (const ip of ['2001:db8:5:6::1', '2001:db8:5:6:aaaa:bbbb:cccc:dddd', '2001:db8:5:7::1', '203.0.113.9']) assert.equal((await mint({}, ip)).status, 200);
      assert.deepEqual(RL.keys, ['2001:db8:5:6::/64', '2001:db8:5:6::/64', '2001:db8:5:7::/64', '203.0.113.9']);
    } finally { done(); }
  });

  it('GUEST_DAY new guests per network and KST day in the acct instance, one DO call each; another network, the next day, 0 = off', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv({ GUEST_DAY: '3' }), log = spyDo(env), { mint } = harness(env);
      for (const ip of ['2001:db8:9:9::1', '2001:db8:9:9::2', '2001:db8:9:9::3']) assert.equal((await mint({}, ip)).status, 200);
      const over = await mint({}, '2001:db8:9:9::4'); assert.equal(over.status, 429); assert.deepEqual(over.body, DAY_NO); assert.equal(over.headers.get('retry-after'), '3600');
      assert.equal((await mint({}, '2001:db8:9:a::1')).status, 200, 'the next /64');
      assert.deepEqual(log, Array(5).fill('acct.mintTake'));
      const rows = env.meter('acct').sql.db.prepare('select k, d, n from gmt order by k').all();
      assert.equal(rows.length, 2); for (const r of rows) assert.match(r.k, /^g:[0-9a-f]{16}$/); assert.equal(JSON.stringify(rows).includes('2001'), false);
      // A renewal is never counted.
      const g = (await mint({}, '2001:db8:9:a::1')).body; log.length = 0; assert.equal((await mint({ t: g.token }, '2001:db8:9:9::1')).status, 200); assert.deepEqual(log, []);
      clock.add(864e5); assert.equal((await mint({}, '2001:db8:9:9::9')).status, 200, 'a new KST day');
      assert.equal(env.meter('acct').sql.db.prepare('select count(*) n from gmt where d < ?').get(wishDay(clock.now())).n, 0, 'older days go');
      const off = makeEnv({ GUEST_DAY: '0' }), offLog = spyDo(off), h = harness(off);
      for (let i = 0; i < 5; i++) assert.equal((await h.mint({}, '192.0.2.1')).status, 200);
      assert.deepEqual(offLog, []);
    } finally { done(); }
  });

  it('the default is 100 a day; budget hard or a failing acct call skip the count (open), GUEST_RL still applies', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), { mint } = harness(env);
      for (let i = 0; i < 100; i++) assert.equal((await mint({}, '192.0.2.77')).status, 200);
      assert.equal((await mint({}, '192.0.2.77')).status, 429);
      const real = env.METER.get; env.METER.get = (n) => (n === 'acct' ? new Proxy(real(n), { get: (t, k) => (k === 'mintTake' ? async () => { throw new Error('do down'); } : t[k]) }) : real(n));
      assert.equal((await mint({}, '192.0.2.77')).status, 200, 'the count cannot be asked: open');
      env.METER.get = real; setUsed(env, 96000); clock.add(61000);
      const log = spyDo(env); assert.equal((await mint({}, '192.0.2.77')).status, 200); assert.deepEqual(log, [], 'hard: no acct call');
      const RL = limiter(() => false); env.GUEST_RL = RL; assert.equal((await mint({}, '192.0.2.77')).status, 429);
    } finally { done(); }
  });

  it('Meter.mintTake checks every key before it counts any, and answers the key at its cap', () => {
    const m = new Meter(makeCtx(sqliteStorage()), {});
    assert.equal(m.mintTake([['g:a', 2], ['o:a', 1]], '2031-01-01'), true);
    assert.equal(m.mintTake([['g:a', 2], ['o:a', 1]], '2031-01-01'), 'o:a');
    assert.equal(m.mintTake([['g:a', 2]], '2031-01-01'), true, 'the refused call counted nothing');
    assert.equal(m.mintTake([['g:a', 2]], '2031-01-01'), 'g:a');
    assert.equal(m.mintTake([], '2031-01-01'), false); assert.equal(m.mintTake([['g:a', 0]], '2031-01-01'), false); assert.equal(m.mintTake([['g:a', 2]], ''), false);
    assert.equal(m.mintTake([['g:a', 2]], '2031-01-02'), true);
  });
});

describe('per-account limits (ACT_RL), the snapshot read and the event drop', { concurrency: false }, () => {
  it('socket joins, plaza writes and the other writes are refused per account before any DO call; reads are not limited', async () => {
    const { done } = setup();
    try {
      const RL = limiter(() => false), env = makeEnv(), { guest, call, post, get } = harness(env), g = await guest();
      env.ACT_RL = RL; const log = spyDo(env);
      const ws = await call('/rt/ws?topic=chapel:square', { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'masil2, at.' + g.token } });
      assert.equal(ws.status, 429); assert.equal(ws.headers.get('retry-after'), '60');
      const NO = { ok: false, code: 'rate', error: '요청이 너무 잦아요. 1분 뒤에 다시 해 주세요.' };
      for (const path of ['/rt/claim-billboard', '/rt/buy-plot', '/rt/spend', '/rt/flush-wallet', '/rt/report', '/rt/inbox/read', '/rt/profile', '/rt/equip', '/rt/push']) {
        const r = await post(path, { topic: 'chapel:square', ids: [1], slot: 'STREET_1', reason: 'ad', s: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'aaaaaaaaaa', auth: 'bbbbbbbbbb' } } }, g.token);
        assert.equal(r.status, 429, path); assert.deepEqual(await r.json(), NO, path);
      }
      // Points are not transferable: /rt/sell-coins is closed before any limit, token check or call (worker.js NO_SEND).
      const sell = await post('/rt/sell-coins', { topic: 'chapel:square', slot_id: 'STREET_1', amount: 10 }, g.token);
      assert.equal(sell.status, 410); assert.equal((await sell.json()).code, 'off');
      const grp = await post('/rt/grp', { c: 'ABC234' }, g.token); assert.equal(grp.status, 429);
      const snap = await call('/rt/snap', { method: 'POST', headers: { authorization: 'Bearer ' + g.token, 'content-type': 'image/jpeg' }, body: new Uint8Array(1000) }); assert.equal(snap.status, 429);
      assert.deepEqual(log, [], 'no DO call for any refused one');
      assert.deepEqual([...new Set(RL.keys)].sort(), ['misc:' + g.id, 'plaza:' + g.id, 'ws:' + g.id]);
      RL.keys.length = 0; assert.notEqual((await get('/rt/profile', g.token)).status, 429, 'the profile read on entering is not limited'); assert.deepEqual(RL.keys, []);
    } finally { done(); }
  });

  it('GET /rt/snap/<id> passes EVENT_RL before the snapshot DO; /rt/event drops its count at budget hard', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv({ EVENT_RL: limiter(() => false) }), log = spyDo(env), { get, post } = harness(env);
      const r = await get('/rt/snap/' + 'a'.repeat(32)); assert.equal(r.status, 429); assert.deepEqual(log, []);
      env.EVENT_RL = limiter();
      assert.equal((await get('/rt/snap/' + 'a'.repeat(32))).status, 404); assert.deepEqual(log, ['snaps.snapGet']);
      log.length = 0; assert.deepEqual(await (await post('/rt/event', { name: 'page_landing', sid: 'sess-12345' })).json(), { ok: true }); assert.deepEqual(log, ['ev.evAdd']);
      setUsed(env, 96000); clock.add(61000); log.length = 0;
      const hard = await post('/rt/event', { name: 'page_landing', sid: 'sess-12345' }); assert.equal(hard.status, 200); assert.deepEqual(await hard.json(), { ok: true, kept: false });
      assert.deepEqual(log, []);
    } finally { done(); }
  });
});

describe('a room against one account flooding it', { concurrency: false }, () => {
  const sock = () => ({ sent: [], closed: null, send(s) { this.sent.push(JSON.parse(String(s))); }, close(code) { this.closed = code; }, serializeAttachment() {}, deserializeAttachment() { return null; } });
  const seat = (room, k, t) => { const w = sock(), a = { k, q: true, v2: true, fl: 0, lob: false, t, ls: t, m: { x: 0, y: 0 } }; room.socks().set(w, a); return w; };
  it('an account holds at most 3 sockets in a room: a newer one sends the oldest away (moved, 4005); other accounts stay', () => {
    const room = new Room(makeCtx(sqliteStorage()), makeEnv());
    const a1 = seat(room, 'guest:a', 1), a2 = seat(room, 'guest:a', 2), a3 = seat(room, 'guest:a', 3), b = seat(room, 'guest:b', 0);
    room.crowd('guest:a');
    assert.equal(a1.closed, 4005); assert.deepEqual(a1.sent.at(-1), { t: 'moved' }); assert.equal(room.socks().has(a1), false);
    assert.equal(a2.closed, null); assert.equal(a3.closed, null); assert.equal(b.closed, null);
    room.crowd('guest:b'); assert.equal(b.closed, null);
  });
  it('past 120 messages in 10 s a socket is closed (4008) and its account kept out of the room for 60 s; reactions and presence are capped', async () => {
    const { clock, done } = setup();
    try {
      const room = new Room(makeCtx(sqliteStorage()), makeEnv()), now = clock.now(), me = seat(room, 'guest:f', now), other = seat(room, 'guest:o', now);
      for (let i = 0; i < 30; i++) await room.webSocketMessage(me, JSON.stringify({ t: 'E', e: 1 }));
      await room.webSocketMessage(me, JSON.stringify({ t: 'E', e: 2 }));
      assert.equal(other.sent.filter((m) => m.t === 'E').length, 30, 'reactions: 30 per 10 s');
      for (let i = 0; i < 20; i++) await room.webSocketMessage(me, JSON.stringify({ t: 'tr', m: { name: '봇' + i } }));
      await room.webSocketMessage(me, JSON.stringify({ t: 'tr', m: { name: 'more' } }));
      assert.equal(other.sent.filter((m) => m.t === 'pj').length, 20, 'presence: 20 per 10 s');
      clock.add(10001); await room.webSocketMessage(me, JSON.stringify({ t: 'E', e: 3 })); assert.equal(other.sent.filter((m) => m.t === 'E').length, 31, 'the next window');
      for (let i = 0; i < 119; i++) await room.webSocketMessage(me, JSON.stringify({ t: 'p', a: [1, 2, 's', 'walk', 0, 0, 0] }));
      assert.equal(me.closed, null);
      await room.webSocketMessage(me, JSON.stringify({ t: 'p', a: [1, 2, 's', 'walk', 0, 0, 0] }));
      assert.equal(me.closed, 4008); assert.equal(room.socks().has(me), false); assert.equal(other.closed, null);
      const join = (k) => room.fetch(new Request('https://room.internal/ws?topic=chapel:square', { headers: { 'x-uid': k } }));
      const back = await join('guest:f'); assert.equal(back.status, 429); assert.equal(await back.text(), 'flood');
      clock.add(60001); assert.equal(room.banned('guest:f'), false);
    } finally { done(); }
  });
});

describe('client: a new guest behind the human check (net.js guestToken)', { concurrency: false }, () => {
  const realRun = net.HUMAN.run, realSay = net.HUMAN.say;
  const scene = (answers) => { const posts = []; globalThis.fetch = async (url, opt = {}) => { const body = JSON.parse(opt.body || '{}'); posts.push(body); const a = answers(body, posts.length); return json(a.body, a.status || 200); }; return posts; };
  const reset = () => { localStorage.removeItem(GT_LS); net.HUMAN.run = realRun; net.HUMAN.say = realSay; net.HUMAN.site = ''; net.HUMAN.until = 0; };
  const TOKEN = { token: 'g1.new.sig', sub: 'g-00000000-0000-4000-8000-000000000001', exp: Math.floor(Date.now() / 1000) + 30 * 86400 };
  it('a 403 human runs one check for every caller at once and asks again with its token, which is then stored', async () => {
    const origFetch = globalThis.fetch;
    try {
      reset(); const runs = [], said = [];
      net.HUMAN.run = async (site) => { runs.push(site); await new Promise((r) => setTimeout(r, 5)); return 'ts-token'; }; net.HUMAN.say = (c) => said.push(c);
      const posts = scene((b) => (b.ts ? { body: TOKEN } : { status: 403, body: { err: 'human', code: 'human', site: SITE } }));
      const [x, y] = await Promise.all([net.guestToken(), net.guestToken()]);
      assert.deepEqual(x, TOKEN); assert.deepEqual(y, TOKEN); assert.deepEqual(runs, [SITE]); assert.deepEqual(said, []);
      assert.deepEqual(posts, [{}, {}, { ts: 'ts-token' }]);
      assert.deepEqual(JSON.parse(localStorage.getItem(GT_LS)), TOKEN);
    } finally { globalThis.fetch = origFetch; reset(); }
  });
  it('no token from the check: nothing is asked again; a refused token, the day cap: the card says so; a renewal never runs the check', async () => {
    const origFetch = globalThis.fetch;
    try {
      reset(); let runs = 0; const said = [];
      net.HUMAN.run = async () => { runs++; return ''; }; net.HUMAN.say = (c) => said.push(c);
      let posts = scene(() => ({ status: 403, body: { err: 'human', site: SITE } }));
      assert.equal(await net.guestToken(), null); assert.equal(runs, 1); assert.equal(posts.length, 1);
      net.HUMAN.run = async () => 'ts';
      posts = scene((b) => (b.ts ? { status: 403, body: { err: 'human', site: SITE } } : { status: 403, body: { err: 'human', site: SITE } }));
      assert.equal(await net.guestToken(), null); assert.deepEqual(said, ['human']);
      posts = scene((b) => (b.ts ? { status: 429, body: { err: 'day', code: 'day' } } : { status: 403, body: { err: 'human' } }));
      net.HUMAN.site = SITE; assert.equal(await net.guestToken(), null); assert.deepEqual(said, ['human', 'day'], 'the site from /rt/config when the answer has none');
      // After the day cap this page makes no new guest for 10 minutes: no request, no second card.
      posts = scene(() => ({ body: TOKEN })); assert.equal(await net.guestToken(), null); assert.equal(posts.length, 0); assert.deepEqual(said, ['human', 'day']);
      net.HUMAN.until = 0; posts = scene(() => ({ status: 429, body: { err: 'day', code: 'day' } })); assert.equal(await net.guestToken(), null); assert.deepEqual(said, ['human', 'day', 'day']);
      assert.ok(net.HUMAN.until > Date.now() + 590000); net.HUMAN.until = 0;
      posts = scene(() => ({ status: 429, body: { err: 'rate' } })); assert.equal(await net.guestToken(), null); assert.deepEqual(said, ['human', 'day', 'day'], 'a minute limit stays quiet, as before');
      // A stored token close to its end is renewed with itself; no check.
      runs = 0; net.HUMAN.run = async () => { runs++; return 'ts'; };
      localStorage.setItem(GT_LS, JSON.stringify({ ...TOKEN, exp: Math.floor(Date.now() / 1000) + 3600 }));
      posts = scene((b) => ({ body: { ...TOKEN, renewed: !!b.t } }));
      assert.equal((await net.guestToken()).renewed, true); assert.deepEqual(posts, [{ t: TOKEN.token }]); assert.equal(runs, 0);
    } finally { globalThis.fetch = origFetch; reset(); }
  });
  it('loadConfig keeps the site key from /rt/config (and nothing for a missing or broken one); authed errors carry the server code', async () => {
    const origFetch = globalThis.fetch;
    try {
      const n = new net.Net();
      for (const [cfg, want] of [[{ url: 'https://x.supabase.co', key: 'k', turnstile: SITE }, SITE], [{ url: 'https://x.supabase.co', key: 'k' }, ''], [{ turnstile: 'bad key' }, '']]) {
        globalThis.fetch = async () => json(cfg); await n.loadConfig(); assert.equal(net.HUMAN.site, want);
      }
      globalThis.fetch = async () => json({ ok: false, code: 'account', error: '계정을 연결하면 공유 보너스 300포인트를 받을 수 있어요.' }, 403);
      localStorage.setItem(GT_LS, JSON.stringify(TOKEN));
      await assert.rejects(n.shareBonus(), (e) => e.code === 'account' && e.message === '계정을 연결하면 공유 보너스 300포인트를 받을 수 있어요.');
    } finally { globalThis.fetch = origFetch; reset(); }
  });
});

describe('client: human.js (Turnstile widget, the card)', () => {
  // A small DOM: elements keep their children, the head runs `load` on the script it is given.
  const el = (tag) => ({ tag, children: [], style: {}, attrs: {}, hidden: false, textContent: '', append(...k) { this.children.push(...k); }, setAttribute(k, v) { this.attrs[k] = v; } });
  const page = (load) => { const win = { location: { reload() { win.reloads = (win.reloads || 0) + 1; } } }, doc = { scripts: [], createElement: el, body: el('body'), head: { append(s) { doc.scripts.push(s); queueMicrotask(() => load(s, win)); } } }; return { win, doc, card: () => doc.body.children.find((c) => c.id === 'kts-human') }; };
  const api = (behave) => (s, win) => { win.turnstile = { renders: [], removed: [], render(host, o) { this.renders.push(o); queueMicrotask(() => behave(o)); return 'w' + this.renders.length; }, remove(id) { this.removed.push(id); } }; s.onload(); };
  const visible = (c) => c.style.opacity === '1';
  it('loads the script once from Cloudflare, renders invisibly with the site key and action, and resolves the token', async () => {
    const p = page(api((o) => o.callback('TOKEN-1')));
    assert.equal(await human.humanToken(SITE, p), 'TOKEN-1');
    assert.equal(await human.humanToken(SITE, p), 'TOKEN-1');
    assert.equal(p.doc.scripts.length, 1); assert.equal(p.doc.scripts[0].src, 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    const o = p.win.turnstile.renders[0]; assert.equal(o.sitekey, SITE); assert.equal(o.action, 'guest'); assert.equal(o.appearance, 'interaction-only');
    assert.equal(o.size, 'normal'); const small = page(api((x) => x.callback('T2'))); small.win.innerWidth = 320;
    assert.equal(await human.humanToken(SITE, small), 'T2'); assert.equal(small.win.turnstile.renders[0].size, 'compact', 'the 300 px box does not fit a 320 px phone');
    assert.deepEqual(p.win.turnstile.removed, ['w1', 'w2']); assert.equal(visible(p.card()), false);
    assert.equal(await human.humanToken('', p), '', 'no site: nothing');
  });
  it('a widget error leaves no token, shows the card with a retry that reloads, and is not tried again by itself', async () => {
    const p = page(api((o) => o['error-callback']('600010')));
    assert.equal(await human.humanToken(SITE, p), '');
    const c = p.card(); assert.equal(visible(c), true); assert.equal(c.children[0].textContent, human.HUMAN_TEXT.human);
    const btn = c.children[2]; assert.equal(btn.hidden, false); assert.equal(btn.textContent, '다시 시도'); btn.onclick(); assert.equal(p.win.reloads, 1);
    assert.equal(await human.humanToken(SITE, p), ''); assert.equal(p.win.turnstile.renders.length, 1, 'no second challenge');
  });
  it('the card shows while Cloudflare wants a tap, and hides once the token comes; a blocked script or a silent widget give up', async () => {
    let go; const p = page(api((o) => { o['before-interactive-callback'](); go = () => o.callback('TAPPED'); }));
    const t = human.humanToken(SITE, p); await new Promise((r) => setTimeout(r, 5));
    assert.equal(visible(p.card()), true); assert.equal(p.card().children[0].textContent, human.HUMAN_TEXT.tap);
    go(); assert.equal(await t, 'TAPPED'); assert.equal(visible(p.card()), false);
    const blocked = page((s) => s.onerror()); assert.equal(await human.humanToken(SITE, blocked), ''); assert.equal(visible(blocked.card()), true);
    const silent = page(api(() => {})); assert.equal(await human.humanToken(SITE, { ...silent, ms: { run: 20 } }), '');
  });
  it('humanSay: the day cap and the minute limit get a close button, not a reload', () => {
    const p = page(() => {});
    human.humanSay('day', p); const c = p.card();
    assert.equal(c.children[0].textContent, human.HUMAN_TEXT.day); assert.equal(c.children[2].textContent, '닫기'); c.children[2].onclick(); assert.equal(visible(c), false);
    human.humanSay('rate', p); assert.equal(c.children[0].textContent, human.HUMAN_TEXT.rate); assert.equal(p.win.reloads, undefined);
  });
});

describe('client: the share bonus is for accounts', () => {
  const ui = read('ui.js'), vip = ui.slice(ui.indexOf('function openVip()'), ui.indexOf("const redeem = h('button'"));
  it('a guest sees the account wording, a button to the account sheet and a plain share; the bonus is never asked for a guest', () => {
    assert.match(ui, /const SHARE_ACCOUNT = '계정을 연결하면 공유 보너스 300포인트를 받을 수 있어요';/);
    assert.match(vip, /const shareGuest = accountView\.ready && accountView\.guest && !accountView\.linked;/);
    assert.match(vip, /text: '계정 연결하고 받기', onclick: \(\) => openLogin\(\)/);
    assert.match(vip, /shareGuest \? '링크만 공유하기' : '링크 복사하고 \+300'/);
    const guestOut = vip.indexOf("if (shareGuest) { share.disabled = false; note(SHARE_ACCOUNT, 'ok', () => openLogin()); return; }");
    assert.ok(guestOut > 0 && guestOut < vip.indexOf('hooks.shareBonus?.()'));
    assert.match(vip, /if \(e\?\.code === 'account'\) note\(SHARE_ACCOUNT, 'err', \(\) => openLogin\(\)\);/);
    assert.match(ui, /shareGuest \? `\$\{SHARE_ACCOUNT\} 하루 한 번/);
  });
});
