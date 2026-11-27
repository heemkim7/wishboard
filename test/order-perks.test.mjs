// Paid perks delivered (giftrules.js TIERS gives, payrules.js PRODUCTS, ordersrv.js publish, giftsrv.js perkFit / perkOn / perkOff), end to
// end with the mock provider (PAY_MODE=mock on a local host): order -> pay -> mock window -> signed webhook -> confirm -> PUBLISHED -> the
// perk on the board, and a refund taking it off. 오래 걸기: the window is 12 hours (scheduling, /rt/world, screen capacity); 축하 영상 세트:
// the films without the watermark (the view's clean); 메인 타워 주인공: the main tower minute booked with how 'paid' (no friends, no points),
// within the 30 a day and the minute rules, never paid back as points. Also: nothing shows before PUBLISHED, one paid order per board, a
// board that cannot take a perk is refused before anyone pays, and 내 전광판 has its own (personal) products.
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: new URL('./cf-stub.mjs', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});
globalThis.WebSocketRequestResponsePair = class { constructor(req, res) { this.req = req; this.res = res; } };
const { Meter, Room } = await import('../worker.js');
const worker = (await import('../worker.js')).default;
const { kstDay, GIFT, GIFT_SCREENS, perksOf } = await import('../giftrules.js');
const { giftDb, giftWorld, giftDrop } = await import('../giftsrv.js');
const { orderCacheDrop } = await import('../ordersrv.js');
const { TOWER } = await import('../towerrules.js');

function sqliteStorage(db = new DatabaseSync(':memory:')) {
  return {
    db,
    exec(query, ...args) {
      const q = String(query).trim();
      if (!args.length && /^(create|alter)\b/i.test(q)) { db.exec(q); return { rowsWritten: 0, toArray() { return []; }, one() { return {}; }, [Symbol.iterator]() { return [][Symbol.iterator](); } }; }
      const stmt = db.prepare(q);
      if (/^select\b/i.test(q)) { const rows = stmt.all(...args); return { rowsWritten: 0, toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error('expected one row for ' + q); return rows[0]; }, [Symbol.iterator]: () => rows[Symbol.iterator]() }; }
      const info = stmt.run(...args);
      return { rowsWritten: info.changes, toArray: () => [], one() { throw new Error('one on write'); }, [Symbol.iterator]() { return [][Symbol.iterator](); } };
    },
  };
}
function makeCtx(sql) {
  return { storage: { sql, async getAlarm() { return null; }, async setAlarm() {}, async deleteAlarm() {}, transactionSync(fn) { return fn(); } }, setWebSocketAutoResponse() {}, getWebSockets() { return []; }, getWebSocketAutoResponseTimestamp() { return new Date(); }, acceptWebSocket() {} };
}
const stub = (obj) => new Proxy(obj, { get: (t, k) => k === 'fetch' ? (req) => t.fetch(req) : typeof t[k] === 'function' ? async (...a) => structuredClone(await t[k](...structuredClone(a))) : t[k] });
function makeEnv(extra = {}) {
  const meters = new Map(), rooms = new Map();
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ADMIN_KEY: 'admin-test-key-123', PAY_ON: '1', PAY_MODE: 'mock', ASSETS: { fetch: () => new Response('asset', { status: 200 }) }, ...extra };
  env.meters = meters;
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new Meter(makeCtx(sql), env) }); } return meters.get(name); };
  env.room = (topic) => { if (!rooms.has(topic)) { const sql = sqliteStorage(); rooms.set(topic, { sql, do: new Room(makeCtx(sql), env) }); } return rooms.get(topic); };
  env.METER = { idFromName: (name) => name, get: (name) => stub(env.meter(name).do) };
  env.ROOM = { idFromName: (topic) => topic, get: (topic) => stub(env.room(topic).do) };
  return env;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
function fakeNet(state) {
  return async (url, opt = {}) => {
    const u = String(url); state.calls.push(u);
    if (u.startsWith('https://api.portone.io/payments/')) { // a fake api.portone.io: payments by id in state.pg, a cancel flips one to CANCELLED
      const m = /^https:\/\/api\.portone\.io\/payments\/([^/?]+)(\/cancel)?/.exec(u), p = state.pg.get(decodeURIComponent(m[1]));
      if (m[2]) { if (!p) return json({ type: 'PAYMENT_NOT_FOUND' }, 404); p.status = 'CANCELLED'; return json({ cancellation: { status: 'SUCCEEDED' } }); }
      return p ? json(p) : json({ type: 'PAYMENT_NOT_FOUND' }, 404);
    }
    if (u.includes('/.well-known/jwks.json')) return json({ keys: state.jwks || [] });
    if (u.includes('/rest/v1/')) return json([]);
    if (u.includes('/rpc/')) return json({ ok: true });
    return new Response('missing', { status: 404 });
  };
}
const LOCAL = 'http://localhost:8787';
function harness(env) {
  const waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (p, opt = {}) => { const res = await worker.fetch(new Request(LOCAL + p, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const post = (p, body, token) => call(p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body ?? {}) });
  const get = (p, token) => call(p, { headers: { 'cf-connecting-ip': '1.1.1.1', ...(token ? { authorization: 'Bearer ' + token } : {}) } });
  const admin = (p, body) => call(p, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': env.ADMIN_KEY }, body: JSON.stringify(body) } : { headers: { 'x-admin-key': env.ADMIN_KEY } });
  return { call, post, get, admin, ctx };
}
let clockBase = Date.parse('2028-03-01T03:00:00Z'); // 12:00 KST
function setup() {
  clockBase += 60 * 864e5; let t = clockBase; const orig = Date.now; Date.now = () => t;
  const prevFetch = globalThis.fetch, state = { calls: [], pg: new Map() };
  globalThis.fetch = fakeNet(state); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  orderCacheDrop();
  return { clock: { add: (ms) => { t += ms; }, now: () => t }, state, done: () => { globalThis.fetch = prevFetch; Date.now = orig; } };
}
let KEYS = null;
async function userToken(state, clock, sub) {
  if (!KEYS) KEYS = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  state.jwks = [{ ...(await crypto.subtle.exportKey('jwk', KEYS.publicKey)), kid: 'perk-kid' }];
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), head = enc({ alg: 'ES256', kid: 'perk-kid' });
  const claims = enc({ sub, exp: Math.floor(clock.now() / 1000) + 30 * 3600, iss: 'https://yxddhpacuyaffaoutxjn.supabase.co/auth/v1', aud: 'authenticated' });
  return { token: head + '.' + claims + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, KEYS.privateKey, Buffer.from(head + '.' + claims))).toString('base64url'), id: 'user:' + sub };
}
const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222';
const FORM = (o = {}) => ({ to: '민지', from: '친구들', occ: 'bday', msg: '생일 축하해!', day: kstDay(Date.now()), at: 'now', ...o });
async function board(H, token, o = {}) { const r = await H.post('/rt/gift', FORM(o), token); assert.equal(r.status, 200, 'gift board'); return (await r.json()).id; }
// The buyer's whole flow with the mock provider. -> the order as the owner reads it after confirm.
async function buy(H, token, bid, product) {
  const list = await (await H.get('/rt/order/products?board=' + bid, token)).json();
  const p = list.products.find((x) => x.id === product); assert.ok(p, product);
  const c = await (await H.post('/rt/order', { product, boardId: bid, shown: p.price }, token)).json(); assert.equal(c.ok, true, JSON.stringify(c));
  const id = c.order.id;
  await H.post('/rt/order/' + id + '/pay', {}, token);
  const mid = await (await H.get('/rt/gift/' + bid, token)).json();
  assert.deepEqual(mid.mine.perks, [], 'nothing before PUBLISHED'); assert.equal(mid.gift.clean, undefined);
  assert.deepEqual(await (await H.post('/rt/order/' + id + '/mock', { result: 'paid' }, token)).json(), { ok: true, hook: 200 });
  const conf = await (await H.post('/rt/order/' + id + '/confirm', {}, token)).json();
  assert.equal(conf.order.st, 'PUBLISHED'); assert.equal(conf.order.perksActive, true); assert.equal(conf.order.ownerSt, '게시됨');
  return conf.order;
}
const owner = async (H, token, bid) => (await (await H.get('/rt/gift/' + bid, token)).json());
const firstMinute = (a, now) => { let m = Math.ceil((Math.max(a, now) + TOWER.leadMs) / 60e3) * 60e3; while (new Date(m + 9 * 36e5).getUTCMinutes() === 0 || new Date(m + 9 * 36e5).getUTCHours() === TOWER.goldHour) m += 60e3; return m; };

describe('오래 걸기: the window becomes 12 hours once the order is published', () => {
  it('scheduling, the owner read, /rt/world and the admin refund (back to 6 hours)', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await userToken(state, clock, U1), bid = await board(H, A.token);
      const g0 = (await owner(H, A.token, bid)).gift; assert.equal(g0.b - g0.a, GIFT.hours * 36e5);
      const o = await buy(H, A.token, bid, 'gift_long');
      assert.deepEqual(o.gives, ['long']);
      const g1 = await owner(H, A.token, bid);
      assert.equal(g1.gift.b - g1.gift.a, GIFT.paidHours * 36e5); assert.deepEqual(g1.mine.perks, ['long']); assert.equal(g1.gift.clean, undefined, 'no clean films in 오래 걸기');
      const mine = await (await H.get('/rt/order/board/' + bid, A.token)).json(); assert.equal(mine.orders[0].ownerSt, '게시됨'); assert.equal(mine.orders[0].perksActive, true);
      // the plaza: past the free 6 hours it still hangs
      clock.add(7 * 36e5); giftDrop(bid);
      const w = await giftWorld(env, { lvlNow: async () => 0 }); assert.ok(w?.gifts?.some((x) => x.id === bid), '/rt/world carries it at hour 7');
      // refunded: its perks come off; past the free 6 hours it comes down now
      const rf = await (await H.admin('/rt/admin/order/' + o.id + '/refund', { note: '고객 요청' })).json(); assert.equal(rf.order.st, 'REFUNDED');
      const g2 = await owner(H, A.token, bid); assert.deepEqual(g2.mine.perks, []); assert.equal(g2.gift.b, clock.now(), 'down now'); assert.equal(g2.gift.phase, 'after');
      const again = await (await H.get('/rt/order/board/' + bid, A.token)).json(); assert.equal(again.orders[0].ownerSt, '환불'); assert.equal(again.orders[0].perksActive, false);
    } finally { done(); }
  });
  it('refused before paying: a board that is over, someone else\'s board, a second paid order; screens counted with the 12 hours', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await userToken(state, clock, U1), B = await userToken(state, clock, U2);
      const bid = await board(H, A.token), other = await board(H, B.token);
      assert.equal((await H.post('/rt/order', { product: 'gift_long', boardId: other }, A.token)).status, 403);
      await buy(H, A.token, bid, 'gift_long');
      const second = await H.post('/rt/order', { product: 'gift_video', boardId: bid }, A.token); assert.equal(second.status, 409); assert.equal((await second.json()).code, 'have');
      // B's board after 12 hours and a bit: too late for any perk
      clock.add(12 * 36e5 + 60e3);
      const late = await H.post('/rt/order', { product: 'gift_video', boardId: other }, B.token); assert.equal(late.status, 409); assert.equal((await late.json()).code, 'late');
      // the extended window counts on its screen: a 13th-hour board elsewhere does not change it, and the 12 hours are in the store
      const row = env.meter('gift').sql.db.prepare('select a, b from gb where id = ?').get(bid); assert.equal(row.b - row.a, 12 * 36e5);
    } finally { done(); }
  });
  it('the store: its own screen when there is room, another screen when not, refused when none has (perkFit full)', () => {
    const q = sqliteStorage(), now = Date.parse('2028-01-10T03:00:00Z'), a = now, b = a + 6 * 36e5;
    giftDb.tables(q);
    const put = (id, scr, a0, b0) => q.db.prepare("insert into gb(id, at, uid, ip, day, a, b, scr, st, j) values(?, ?, ?, ?, ?, ?, ?, ?, 'live', '{}')").run(id, now, id === 'mine0001' ? 'user:a' : 'user:x', 'n', kstDay(a0), a0, b0, scr);
    put('mine0001', GIFT_SCREENS[0], a, b);
    // four later boards fill its screen from hour 6 to 12
    for (let i = 0; i < 4; i++) put('late000' + i, GIFT_SCREENS[0], b, b + 6 * 36e5);
    assert.deepEqual(giftDb.perkFit(q, 'mine0001', 'user:a', ['long'], now), { ok: true, kind: 'gift', ref: '' });
    const r = giftDb.perkOn(q, 'mine0001', 'user:a', 'o_' + 'a'.repeat(20), ['long'], now);
    assert.equal(r.ok, true); assert.equal(r.moved, true); assert.equal(r.scr, GIFT_SCREENS[1]); assert.equal(r.b, a + 12 * 36e5);
    assert.deepEqual(giftDb.perkOn(q, 'mine0001', 'user:a', 'o_' + 'a'.repeat(20), ['long'], now).again, true, 'the same order again changes nothing');
    assert.deepEqual(perksOf(q.db.prepare('select pk from gb where id = ?').get('mine0001').pk), ['long']);
    // every screen full in hours 6..12: nowhere to go
    put('mine0002', GIFT_SCREENS[0], a, b);
    for (const s of GIFT_SCREENS) for (let i = 0; i < 4; i++) put(('f' + GIFT_SCREENS.indexOf(s)).padEnd(6, 'x') + i + 'z', s, b, b + 6 * 36e5);
    q.db.prepare("update gb set uid = 'user:a' where id = 'mine0002'").run();
    assert.deepEqual(giftDb.perkFit(q, 'mine0002', 'user:a', ['long'], now), { ok: false, code: 'full' });
    assert.equal(giftDb.perkOn(q, 'mine0002', 'user:a', 'o_' + 'b'.repeat(20), ['long'], now).why, 'full');
    assert.deepEqual(giftDb.perkFit(q, 'mine0002', 'user:a', ['clean'], now).ok, true, 'a perk without hours does not need a screen');
  });
});

describe('축하 영상 세트: the films without the watermark', () => {
  it('clean in the public view only from PUBLISHED; 내 전광판 has its own products; a refund puts the watermark back', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await userToken(state, clock, U1);
      const me = await board(H, A.token, { occ: 'me', from: '', to: '하늘' });
      assert.equal((await H.post('/rt/order', { product: 'gift_video', boardId: me }, A.token)).status, 400, 'a gift product on a 내 전광판');
      const o = await buy(H, A.token, me, 'personal_video');
      assert.equal(o.kind, 'personal'); assert.deepEqual(o.gives, ['long', 'clean']);
      const pub = await (await H.get('/rt/gift/' + me)).json(); assert.equal(pub.gift.clean, 1, 'the recipient page and the plaza read it');
      assert.equal('pk' in pub.gift, false); assert.equal('perks' in pub.gift, false, 'nothing else of the order is public');
      const rf = await (await H.admin('/rt/admin/order/' + o.id + '/refund', { note: '고객 요청' })).json(); assert.equal(rf.order.st, 'REFUNDED');
      giftDrop(me); assert.equal((await (await H.get('/rt/gift/' + me)).json()).gift.clean, undefined);
    } finally { done(); }
  });
});

describe('메인 타워 주인공: the minute booked directly', () => {
  it('how paid needs the published order; books within the minute rules and the 30; a refund lets it go without points', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await userToken(state, clock, U1), bid = await board(H, A.token);
      const g = (await owner(H, A.token, bid)).gift, m = firstMinute(g.a, clock.now());
      const early = await H.post('/rt/gift/' + bid + '/tower', { m, how: 'paid' }, A.token); assert.equal(early.status, 403); assert.equal((await early.json()).code, 'paid', 'not before the order is published');
      assert.equal((await (await H.get('/rt/gift/' + bid + '/tower', A.token)).json()).paid, undefined);
      const o = await buy(H, A.token, bid, 'gift_tower'); assert.deepEqual(o.gives, ['long', 'clean', 'tower']);
      const card = await (await H.get('/rt/gift/' + bid + '/tower', A.token)).json(); assert.equal(card.paid, true); assert.equal(card.friends, 0);
      // the minute rules still hold: on the hour is the teams'
      const hour = Math.ceil((clock.now() + 36e5) / 36e5) * 36e5;
      assert.equal((await H.post('/rt/gift/' + bid + '/tower', { m: hour, how: 'paid' }, A.token)).status, 400);
      const spends = state.calls.filter((u) => u.includes('/rpc/spend_plaza')).length; // the card's read asks spend_plaza once with a probe wallet (towerPrep)
      const ok = await (await H.post('/rt/gift/' + bid + '/tower', { m, how: 'paid' }, A.token)).json();
      assert.equal(ok.ok, true, JSON.stringify(ok)); assert.deepEqual(ok.tw, { m, how: 'paid' });
      assert.equal(state.calls.filter((u) => u.includes('/rpc/spend_plaza')).length, spends, 'no points spent');
      assert.equal((await H.post('/rt/gift/' + bid + '/tower', { m: m + 60e3, how: 'paid' }, A.token)).status, 409, 'one minute a board');
      // refunded before the minute: the minute is let go, and nothing comes back as points
      const rf = await (await H.admin('/rt/admin/order/' + o.id + '/refund', { note: '고객 요청' })).json(); assert.equal(rf.order.st, 'REFUNDED');
      assert.equal(env.meter('gift').sql.db.prepare('select count(*) n from gt where g = ?').get(bid).n, 0);
      assert.equal(state.calls.filter((u) => u.includes('/rpc/grant_coins')).length, 0, 'a paid booking is never refunded as points');
      const g2 = await owner(H, A.token, bid); assert.deepEqual(g2.mine.perks, []); assert.equal(g2.gift.b - g2.gift.a, GIFT.hours * 36e5, 'before hour 6: back to 6 hours');
    } finally { done(); }
  });
  it('a full day: perkFit refuses the tower product before paying', () => {
    const q = sqliteStorage(), now = Date.parse('2028-01-10T09:00:00Z'); // 18:00 KST: 12 hours reach into the next day
    giftDb.tables(q);
    q.db.prepare("insert into gb(id, at, uid, ip, day, a, b, scr, st, j) values('tw000001', ?, 'user:a', 'n', ?, ?, ?, 'STREET_31', 'live', '{}')").run(now, kstDay(now), now, now + 6 * 36e5);
    const day = kstDay(now), dayEnd = Date.parse(day + 'T00:00:00+09:00') + 864e5;
    for (let i = 0; i < TOWER.perDay; i++) q.db.prepare("insert into gt(m, day, g, how, uid, at, hold) values(?, ?, ?, 'friends', 'user:x', ?, 0)").run(dayEnd - (i + 1) * 120e3, day, 'x' + String(i).padStart(7, '0'), now);
    // the 12-hour window crosses midnight: the next day still has places
    assert.equal(giftDb.perkFit(q, 'tw000001', 'user:a', ['long', 'clean', 'tower'], now).ok, true);
    assert.deepEqual(giftDb.perkFit(q, 'tw000001', 'user:a', ['clean', 'tower'], now), { ok: false, code: 'tower' }, 'within its own 6 hours the day is sold out');
  });
});

// ---- the payment review (2026-11-28) -------------------------------------------------------------------------------------------------
const odb = (env) => env.meter('order').sql.db;
const PG = (env) => ({ PORTONE_STORE_ID: 'store-1', PORTONE_CHANNEL_KEY: 'ck-mine', PORTONE_API_SECRET: 'api-secret-test', ...env });
const pgPaid = (id, price, channel, x = {}) => ({ id, status: 'PAID', transactionId: 'tx-' + id.slice(2, 8), amount: { total: price }, currency: 'KRW', channel, ...x });
const order = async (H, token, bid, product, shown) => (await (await H.post('/rt/order', { product, boardId: bid, ...(shown ? { shown } : {}) }, token)).json()).order;

describe('review: the channel a payment came through', () => {
  it('a live order paid on a TEST channel (or another channel) is FAILED channel, flagged for refund, with no perk; refundable', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(PG({ PAY_MODE: 'live' })), H = harness(env), A = await userToken(state, clock, U1), bid = await board(H, A.token);
      const o = await order(H, A.token, bid, 'gift_long'); await H.post('/rt/order/' + o.id + '/pay', {}, A.token);
      state.pg.set(o.id, pgPaid(o.id, 3900, { type: 'TEST', key: 'ck-mine' }));
      const c = await H.post('/rt/order/' + o.id + '/confirm', {}, A.token), cj = await c.json();
      assert.equal(c.status, 409); assert.equal(cj.code, 'channel'); assert.equal(cj.order.st, 'FAILED'); assert.equal(cj.order.refundDue, true); assert.equal(cj.order.perksActive, false);
      assert.deepEqual((await owner(H, A.token, bid)).mine.perks, [], 'no perk');
      const row = odb(env).prepare('select pg_tx, flags, note from orders where id = ?').get(o.id); assert.equal(row.pg_tx, 'tx-' + o.id.slice(2, 8)); assert.ok(row.flags & 2); assert.match(row.note, /환불 필요/);
      const rf = await (await H.admin('/rt/admin/order/' + o.id + '/refund', { note: '채널 불일치' })).json(); assert.equal(rf.order.st, 'REFUNDED');
      // test mode: only our configured key
      env.PAY_MODE = ''; env.PAY_ALLOW = A.id;
      const b2 = await board(H, A.token), t = await order(H, A.token, b2, 'gift_long'); await H.post('/rt/order/' + t.id + '/pay', {}, A.token);
      state.pg.set(t.id, pgPaid(t.id, 3900, { type: 'TEST', key: 'ck-someone-else' }));
      assert.equal((await (await H.post('/rt/order/' + t.id + '/confirm', {}, A.token)).json()).code, 'channel');
      state.pg.set(t.id, pgPaid(t.id, 3900, { type: 'TEST', key: 'ck-mine' }));
      const ok = (await (await H.post('/rt/order/' + t.id + '/confirm', {}, A.token)).json()).order; assert.equal(ok.st, 'PUBLISHED', 'FAILED without paid_at can still be paid (a retried attempt)'); assert.equal(ok.refundDue, undefined);
    } finally { done(); }
  });
});

describe('review: payments that cannot stand', () => {
  it('a wrong amount from CREATED or CANCELLED is kept as FAILED with its transaction and refunded by the operator', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await userToken(state, clock, U1), bid = await board(H, A.token);
      const c = await order(H, A.token, bid, 'gift_long'); // CREATED: the sheet never asked to pay
      await H.post('/rt/order/' + c.id + '/mock', { result: 'amount' }, A.token);
      let row = odb(env).prepare('select st, pg_tx, flags from orders where id = ?').get(c.id); assert.equal(row.st, 'FAILED'); assert.ok(row.pg_tx); assert.ok(row.flags & 2);
      assert.equal((await (await H.admin('/rt/admin/order/' + c.id + '/refund', { note: '금액 불일치' })).json()).order.st, 'REFUNDED');
      const x = await order(H, A.token, bid, 'gift_long'); await H.post('/rt/order/' + x.id + '/pay', {}, A.token); await H.post('/rt/order/' + x.id + '/cancel', {}, A.token);
      await H.post('/rt/order/' + x.id + '/mock', { result: 'amount' }, A.token);
      row = odb(env).prepare('select st, pg_tx from orders where id = ?').get(x.id); assert.equal(row.st, 'FAILED'); assert.ok(row.pg_tx);
      assert.equal((await (await H.admin('/rt/admin/order/' + x.id + '/refund', { note: '금액 불일치' })).json()).order.st, 'REFUNDED');
    } finally { done(); }
  });
  it('a paid order that failed to publish is not re-opened by a replayed webhook or another confirm', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await userToken(state, clock, U1), bid = await board(H, A.token);
      const o = await order(H, A.token, bid, 'gift_long'); await H.post('/rt/order/' + o.id + '/pay', {}, A.token);
      env.meter('gift').sql.db.prepare('update gb set uid = ? where id = ?').run('user:other', bid); // the board is no longer the buyer's
      await H.post('/rt/order/' + o.id + '/mock', { result: 'paid' }, A.token);
      for (let i = 0; i < 3; i++) await H.get('/rt/order/' + o.id, A.token);
      assert.equal(odb(env).prepare('select st from orders where id = ?').get(o.id).st, 'FAILED');
      env.meter('gift').sql.db.prepare('update gb set uid = ? where id = ?').run(A.id, bid);
      await H.post('/rt/order/' + o.id + '/confirm', {}, A.token); await H.post('/rt/order/' + o.id + '/mock', { result: 'paid' }, A.token);
      assert.equal(odb(env).prepare('select st from orders where id = ?').get(o.id).st, 'FAILED', 'still the operator\'s call');
      assert.equal(odb(env).prepare("select count(*) n from order_events where order_id = ? and to_st = 'PAID'").get(o.id).n, 1);
    } finally { done(); }
  });
  it('two orders paid on one board: the second is refused at pay; one paid anyway stays PAID, unpublished, flagged, and the buyer is told', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await userToken(state, clock, U1), bid = await board(H, A.token);
      const o1 = await order(H, A.token, bid, 'gift_long'), o2 = await order(H, A.token, bid, 'gift_video');
      await H.post('/rt/order/' + o1.id + '/pay', {}, A.token); await H.post('/rt/order/' + o2.id + '/pay', {}, A.token);
      await H.post('/rt/order/' + o1.id + '/mock', { result: 'paid' }, A.token);
      const again = await H.post('/rt/order/' + o2.id + '/pay', {}, A.token); assert.equal(again.status, 409); assert.equal((await again.json()).code, 'have');
      await H.post('/rt/order/' + o2.id + '/mock', { result: 'paid' }, A.token); // the second window was already open and went through
      const c = await H.post('/rt/order/' + o2.id + '/confirm', {}, A.token), cj = await c.json();
      assert.equal(c.status, 409); assert.equal(cj.code, 'twice'); assert.equal(cj.order.st, 'PAID'); assert.equal(cj.order.refundDue, true);
      assert.deepEqual((await owner(H, A.token, bid)).mine.perks, ['long'], 'only the first order\'s perks');
      assert.ok(odb(env).prepare('select detail from order_events where order_id = ?').all(o2.id).some((e) => /refund_due/.test(e.detail)));
      assert.equal((await (await H.admin('/rt/admin/order/' + o2.id + '/refund', { note: '중복 결제' })).json()).order.st, 'REFUNDED');
      assert.deepEqual((await owner(H, A.token, bid)).mine.perks, ['long'], 'refunding the second leaves the first');
    } finally { done(); }
  });
});

describe('review: perks and refunds, the operator\'s tools', () => {
  it('a revoke that fails is recorded and the operator retries it; a refund during perkOn takes the perks off', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await userToken(state, clock, U1), bid = await board(H, A.token);
      const o = await buy(H, A.token, bid, 'gift_long');
      const gdo = env.meter('gift').do, off = gdo.giftPerkOff; gdo.giftPerkOff = () => { throw new Error('down'); };
      assert.equal((await (await H.admin('/rt/admin/order/' + o.id + '/refund', { note: '고객 요청' })).json()).order.st, 'REFUNDED');
      assert.ok(odb(env).prepare('select flags from orders where id = ?').get(o.id).flags & 4);
      assert.ok(odb(env).prepare('select detail from order_events where order_id = ?').all(o.id).some((e) => /revoke_fail/.test(e.detail)));
      assert.deepEqual((await owner(H, A.token, bid)).mine.perks, ['long'], 'still on the board');
      gdo.giftPerkOff = off;
      const r = await H.admin('/rt/admin/order/' + o.id + '/revoke', {}); assert.equal(r.status, 200);
      assert.equal(odb(env).prepare('select flags from orders where id = ?').get(o.id).flags & 4, 0); giftDrop(bid);
      assert.deepEqual((await owner(H, A.token, bid)).mine.perks, []);
      // refunded while the perks went on
      const b2 = await board(H, A.token), p = await order(H, A.token, b2, 'gift_long'); await H.post('/rt/order/' + p.id + '/pay', {}, A.token);
      const on = gdo.giftPerkOn.bind(gdo);
      gdo.giftPerkOn = (...a) => { const res = on(...a); env.meter('order').do.ordOp('refunded', { id: p.id, note: '동시 환불', by: 'admin', via: 'pg' }, Date.now()); return res; };
      await H.post('/rt/order/' + p.id + '/mock', { result: 'paid' }, A.token);
      gdo.giftPerkOn = on; giftDrop(b2);
      assert.equal(odb(env).prepare('select st from orders where id = ?').get(p.id).st, 'REFUNDED'); assert.deepEqual((await owner(H, A.token, b2)).mine.perks, [], 'taken off again');
    } finally { done(); }
  });
  it('the operator restarts a publish stuck at its last try; 손으로 환불했음 only for orders the PG did not take', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await userToken(state, clock, U1), bid = await board(H, A.token);
      const o = await order(H, A.token, bid, 'gift_long'); await H.post('/rt/order/' + o.id + '/pay', {}, A.token);
      const gdo = env.meter('gift').do, on = gdo.giftPerkOn; gdo.giftPerkOn = () => { throw new Error('down'); };
      await H.post('/rt/order/' + o.id + '/mock', { result: 'paid' }, A.token); gdo.giftPerkOn = on;
      odb(env).prepare("update orders set st = 'PUBLISH_PENDING', tries = 3 where id = ?").run(o.id); // stuck: the last try never answered
      assert.equal((await (await H.get('/rt/order/' + o.id, A.token)).json()).order.st, 'PUBLISH_PENDING', 'reads do not try past the limit');
      assert.equal((await (await H.admin('/rt/admin/order/' + o.id + '/publish', {})).json()).order.st, 'PUBLISHED');
      const m = await H.admin('/rt/admin/order/' + o.id + '/manual', { op: 'refunded', note: '손으로' }); assert.equal(m.status, 409); assert.equal((await m.json()).code, 'pgref');
    } finally { done(); }
  });
  it('the owner\'s board read asks PortOne again about a payment pending for over a minute (once a minute)', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await userToken(state, clock, U1), bid = await board(H, A.token);
      const o = await order(H, A.token, bid, 'gift_long'); await H.post('/rt/order/' + o.id + '/pay', {}, A.token);
      env.meter('order').do.ordOp('mockSet', { pid: o.id, j: { id: o.id, status: 'PAID', transactionId: 'mock-x', amount: { total: 3900 }, currency: 'KRW', channel: { type: 'TEST' } } }, Date.now()); // paid, but no webhook and no confirm
      assert.equal((await (await H.get('/rt/order/board/' + bid, A.token)).json()).orders[0].st, 'PAYMENT_PENDING', 'not within the first minute');
      clock.add(61000);
      const r = await (await H.get('/rt/order/board/' + bid, A.token)).json(); assert.equal(r.orders[0].st, 'PUBLISHED'); assert.equal(r.orders[0].ownerSt, '게시됨');
    } finally { done(); }
  });
  it('a paid tower booking is refused without a DO call while payments are off; server-only payment files are not static assets', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv({ PAY_ON: '' }), H = harness(env), A = await userToken(state, clock, U1), bid = await board(H, A.token);
      const r = await H.post('/rt/gift/' + bid + '/tower', { m: firstMinute(Date.now(), Date.now()), how: 'paid' }, A.token);
      assert.equal(r.status, 403); assert.equal((await r.json()).code, 'paid'); assert.equal(env.meters.has('order'), false, 'the order store was never called');
      const ignore = readFileSync(new URL('../.assetsignore', import.meta.url), 'utf8').split(/\r?\n/).map((l) => l.trim());
      for (const f of ['ordersrv.js', 'sharepage.js', 'giftsrv.js']) assert.ok(ignore.includes(f), f);
      assert.ok(!ignore.includes('payrules.js') && !ignore.includes('payclient.js'), 'shared with the pages: served');
    } finally { done(); }
  });
});
