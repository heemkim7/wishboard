// 주문·결제 on the Worker (ordersrv.js through worker.js): the switches (off = invisible), accounts and PAY_ALLOW, the budget guard, the mock
// end to end (create -> pay -> mock window -> signed webhook -> confirm -> publish -> refund), Standard Webhooks signatures (good, bad,
// replayed, old), the amount check, PortOne test mode against a fake api.portone.io, publishing retries, the operator routes behind the
// admin gate (list, detail, refund, manual marks, products editor, revenue, CSV), and the operator/test-traffic flag on the daily stats.
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
const { Meter, Room } = await import('../worker.js');
const worker = (await import('../worker.js')).default;
const { kstDay, ladderArm } = await import('../giftrules.js');
const { giftSeenFlush } = await import('../giftsrv.js');
const { hookSign, hookVerify, MOCK_HOOK_SECRET, orderCacheDrop, testTraffic } = await import('../ordersrv.js');

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
  return { storage: { sql, async getAlarm() { return null; }, async setAlarm() {}, async deleteAlarm() {}, transactionSync(fn) { return fn(); } }, setWebSocketAutoResponse() {}, getWebSockets() { return []; }, getWebSocketAutoResponseTimestamp() { return new Date(); }, acceptWebSocket() {} };
}
const stub = (obj) => new Proxy(obj, { get: (t, k) => k === 'fetch' ? (req) => t.fetch(req) : typeof t[k] === 'function' ? async (...a) => structuredClone(await t[k](...structuredClone(a))) : t[k] });
const ADMIN_HTML = '<!doctype html><title>admin</title><main></main>';
function makeEnv(extra = {}) {
  const meters = new Map(), rooms = new Map();
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ADMIN_KEY: 'admin-test-key-123', ASSETS: { fetch: (req) => { const p = new URL(req.url).pathname; return p === '/admin' ? new Response(ADMIN_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', etag: '"a1"' } }) : new Response('asset', { status: 200 }); } }, ...extra };
  env.meters = meters;
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new Meter(makeCtx(sql), env) }); } return meters.get(name); };
  env.room = (topic) => { if (!rooms.has(topic)) { const sql = sqliteStorage(); rooms.set(topic, { sql, do: new Room(makeCtx(sql), env) }); } return rooms.get(topic); };
  env.METER = { idFromName: (name) => name, get: (name) => stub(env.meter(name).do) };
  env.ROOM = { idFromName: (topic) => topic, get: (topic) => stub(env.room(topic).do) };
  return env;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
// A fake api.portone.io: payments by id in state.pg, cancels flip them to CANCELLED. Every call is recorded with its Authorization.
function fakeNet(state) {
  return async (url, opt = {}) => {
    const u = String(url); state.calls.push(u);
    if (u.startsWith('https://api.portone.io/payments/')) {
      const h = new Headers(opt.headers || {}); state.pgAuth.push(h.get('authorization'));
      const m = /^https:\/\/api\.portone\.io\/payments\/([^/?]+)(\/cancel)?/.exec(u), pid = decodeURIComponent(m[1]);
      const p = state.pg.get(pid);
      if (m[2]) { state.cancels.push({ pid, body: JSON.parse(opt.body), key: h.get('idempotency-key') }); if (!p) return json({ type: 'PAYMENT_NOT_FOUND' }, 404); if (p.status === 'CANCELLED') return json({ type: 'PAYMENT_ALREADY_CANCELLED', message: 'already' }, 409); p.status = 'CANCELLED'; return json({ cancellation: { status: 'SUCCEEDED', id: 'c1', totalAmount: p.amount.total } }); }
      return p ? json(p) : json({ type: 'PAYMENT_NOT_FOUND' }, 404);
    }
    if (u.includes('/.well-known/jwks.json')) return json({ keys: state.jwks || [] });
    if (u.includes('/rest/v1/')) return json([]);
    if (u.includes('/rpc/')) return json({ ok: true });
    return new Response('missing', { status: 404 });
  };
}
const LOCAL = 'http://localhost:8787', PROD = 'https://studio.wishboard.workers.dev';
function harness(env, base = PROD) {
  const waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (p, opt = {}) => { const res = await worker.fetch(new Request((p.startsWith('http') ? '' : base) + p, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const guest = async (ip = '1.1.1.1') => { const t = (await (await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: '{}' })).json()).token; return { token: t, id: 'guest:' + JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).s }; };
  const post = (p, body, token, h = {}) => call(p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1', ...(token ? { authorization: 'Bearer ' + token } : {}), ...h }, body: typeof body === 'string' ? body : JSON.stringify(body ?? {}) });
  const get = (p, token, h = {}) => call(p, { headers: { 'cf-connecting-ip': '1.1.1.1', ...(token ? { authorization: 'Bearer ' + token } : {}), ...h } });
  const admin = (p, body) => call(p, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': env.ADMIN_KEY }, body: JSON.stringify(body) } : { headers: { 'x-admin-key': env.ADMIN_KEY } });
  return { call, guest, post, get, admin, ctx };
}
let clockBase = Date.parse('2027-09-01T03:00:00Z'); // 12:00 KST
function setup() {
  clockBase += 60 * 864e5; let t = clockBase; const orig = Date.now; Date.now = () => t;
  const prevFetch = globalThis.fetch, state = { calls: [], pg: new Map(), pgAuth: [], cancels: [] };
  globalThis.fetch = fakeNet(state); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  orderCacheDrop();
  return { clock: { add: (ms) => { t += ms; }, now: () => t }, state, done: () => { globalThis.fetch = prevFetch; Date.now = orig; } };
}
let KEYS = null;
async function userToken(state, clock, sub) {
  if (!KEYS) KEYS = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  state.jwks = [{ ...(await crypto.subtle.exportKey('jwk', KEYS.publicKey)), kid: 'order-kid' }];
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), head = enc({ alg: 'ES256', kid: 'order-kid' });
  const claims = enc({ sub, exp: Math.floor(clock.now() / 1000) + 3600, iss: 'https://yxddhpacuyaffaoutxjn.supabase.co/auth/v1', aud: 'authenticated' });
  return { token: head + '.' + claims + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, KEYS.privateKey, Buffer.from(head + '.' + claims))).toString('base64url'), id: 'user:' + sub };
}
const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222';
const FORM = (o = {}) => ({ to: '민지', from: '친구들', occ: 'bday', msg: '생일 축하해!', day: kstDay(Date.now()), at: 'now', ...o });
const odb = (env) => env.meter('order').sql.db;
async function board(H, token) { const r = await H.post('/rt/gift', FORM(), token); assert.equal(r.status, 200, 'gift board'); return (await r.json()).id; }
async function signed(H, secret, body, o = {}) {
  const id = o.id || 'msg_' + Math.random().toString(36).slice(2), ts = String(o.ts ?? Math.floor(Date.now() / 1000)), text = typeof body === 'string' ? body : JSON.stringify(body);
  const sig = o.sig || await hookSign(secret, id, ts, text);
  return H.call('/rt/pay/hook', { method: 'POST', headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': sig }, body: text });
}
const hookBody = (pid, type = 'Transaction.Paid', store = 'store-1') => ({ type, timestamp: new Date().toISOString(), data: { storeId: store, paymentId: pid, transactionId: 'tx-' + pid.slice(2, 8) } });

describe('switches: off means invisible', () => {
  it('without PAY_ON every buyer route answers 404 off, /rt/config says nothing, and no order store is made', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv({ PAY_MODE: 'mock' }), H = harness(env, LOCAL), A = await userToken(state, clock, U1);
      const cfg = await (await H.get('/rt/config')).json(); assert.equal('pay' in cfg, false);
      for (const [m, p] of [['GET', '/rt/order/products'], ['POST', '/rt/order'], ['POST', '/rt/order/o_' + 'a'.repeat(20) + '/pay'], ['GET', '/rt/order/o_' + 'a'.repeat(20)], ['POST', '/rt/pay/hook']]) {
        const r = m === 'GET' ? await H.get(p, A.token) : await H.post(p, {}, A.token);
        assert.equal(r.status, 404, p); assert.equal((await r.json()).code, 'off', p);
      }
      for (const v of ['0', 'true', ' 1']) { env.PAY_ON = v; assert.equal((await H.get('/rt/order/products', A.token)).status, 404, v); }
      assert.equal(env.meters.has('order'), false, 'the order store was never called');
    } finally { done(); }
  });
  it('PAY_MODE=mock on the real host is off too; PAY_ON=1 shows { on, mode } in /rt/config', async () => {
    const { done } = setup();
    try {
      const env = makeEnv({ PAY_ON: '1', PAY_MODE: 'mock' }), H = harness(env, PROD);
      assert.equal('pay' in (await (await H.get('/rt/config')).json()), false);
      assert.equal((await H.get('/rt/order/products')).status, 404);
      delete env.PAY_MODE; assert.deepEqual((await (await H.get('/rt/config')).json()).pay, { on: true, mode: 'test' });
      env.PAY_MODE = 'live'; assert.deepEqual((await (await H.get('/rt/config')).json()).pay, { on: true, mode: 'live' });
    } finally { done(); }
  });
  it('needs a signed-in account; test mode only for PAY_ALLOW accounts', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv({ PAY_ON: '1' }), H = harness(env), G = await H.guest(), A = await userToken(state, clock, U1);
      assert.equal((await H.get('/rt/order/products')).status, 401);
      const g = await H.get('/rt/order/products', G.token); assert.equal(g.status, 401); assert.equal((await g.json()).code, 'login');
      const no = await H.get('/rt/order/products', A.token); assert.equal(no.status, 403); assert.equal((await no.json()).code, 'allow');
      env.PAY_ALLOW = 'user:x, ' + A.id;
      const ok = await (await H.get('/rt/order/products', A.token)).json();
      assert.equal(ok.ok, true); assert.equal(ok.test, true); assert.equal(ok.badge, '테스트 결제'); assert.match(ok.refund.before, /전액/);
      assert.ok(ok.products.every((p) => p.kind && p.price > 0 && p.perks.length)); assert.equal(ok.products.length, 6, 'three tiers for gift boards and three for 내 전광판');
      assert.deepEqual((await (await H.get('/rt/order/products?kind=personal', A.token)).json()).products.map((p) => p.id), ['personal_long', 'personal_video', 'personal_tower']);
      assert.equal(ok.sdk, 'https://cdn.portone.io/v2/browser-sdk.js');
      assert.equal((await H.post('/rt/order/o_' + 'a'.repeat(20) + '/mock', { result: 'paid' }, A.token)).status, 404, 'no fake payment window outside mock');
    } finally { done(); }
  });
  it('at the hard budget level a new order answers 503 before any order-store call', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv({ PAY_ON: '1', PAY_MODE: 'mock' }), H = harness(env, LOCAL), A = await userToken(state, clock, U1);
      env.BUDGET_REQ_DAY = '1'; clock.add(61000);
      const r = await H.post('/rt/order', { product: 'gift_long', boardId: 'abcdefgh' }, A.token);
      assert.equal(r.status, 503); assert.equal((await r.json()).code, 'busy');
      assert.equal(env.meters.has('order'), false);
      assert.equal(env.meters.has('gift'), false, 'nor the gift store');
    } finally { done(); }
  });
});

describe('mock: the whole flow without keys', () => {
  it('create -> pay -> mock window -> webhook -> confirm -> PUBLISHED -> refund, with history and counters', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv({ PAY_ON: '1', PAY_MODE: 'mock' }), H = harness(env, LOCAL), A = await userToken(state, clock, U1), B = await userToken(state, clock, U2);
      const other = await board(H, B.token), bid = (await (await H.post('/rt/gift', FORM({ ref: other }), A.token)).json()).id; // A's board made from B's page
      const list = await (await H.get('/rt/order/products?kind=gift', A.token)).json();
      const video = list.products.find((p) => p.id === 'gift_video'); assert.equal(video.price, 7900); assert.equal(list.sdk, null, 'no SDK in mock');
      assert.equal((await H.post('/rt/order', { product: 'gift_video', boardId: other, shown: 7900 }, A.token)).status, 403, "someone else's board");
      const moved = await H.post('/rt/order', { product: 'gift_video', boardId: bid, shown: 6900 }, A.token);
      assert.equal(moved.status, 409); assert.deepEqual(await moved.json(), { ok: false, code: 'price', error: '가격이 바뀌었어요. 바뀐 가격을 확인하고 다시 눌러 주세요.', price: 7900 });
      assert.equal((await H.post('/rt/order', { product: 'personal_long', kind: 'personal' }, A.token)).status, 400, 'every product is for a board');
      assert.equal((await H.post('/rt/order', { product: 'personal_long', boardId: bid }, A.token)).status, 400, 'a 내 전광판 product on a gift board');
      const c = await (await H.post('/rt/order', { product: 'gift_video', boardId: bid, shown: 7900, ref: 'zzzzzzzz' }, A.token)).json(); // the page's own ref is not taken
      assert.equal(c.ok, true); assert.match(c.order.id, /^o_[A-Za-z0-9]{20}$/); assert.equal(c.order.st, 'CREATED'); assert.equal(c.order.perksActive, false); assert.equal(c.order.test, true);
      const id = c.order.id;
      assert.equal((await H.get('/rt/order/' + id, B.token)).status, 404, 'only the owner reads it');
      const pay = await (await H.post('/rt/order/' + id + '/pay', {}, A.token)).json();
      assert.equal(pay.order.st, 'PAYMENT_PENDING'); assert.deepEqual(pay.sdk, { mock: true, paymentId: id, orderName: '축하 영상 세트', totalAmount: 7900, currency: 'CURRENCY_KRW' });
      assert.equal((await (await H.post('/rt/order/' + id + '/pay', {}, A.token)).json()).order.st, 'PAYMENT_PENDING', 'pay again: same');
      const pend = await (await H.get('/rt/order/' + id, A.token)).json(); assert.equal(pend.order.perksActive, false, 'no perk before PAID');
      const mk = await (await H.post('/rt/order/' + id + '/mock', { result: 'paid' }, A.token)).json(); assert.deepEqual(mk, { ok: true, hook: 200 });
      const after = await (await H.get('/rt/order/' + id, A.token)).json();
      assert.equal(after.order.st, 'PUBLISHED'); assert.equal(after.order.perksActive, true); assert.equal(after.order.board, bid); assert.ok(after.order.paid_at && after.order.published_at);
      const conf = await (await H.post('/rt/order/' + id + '/confirm', {}, A.token)).json(); assert.equal(conf.order.st, 'PUBLISHED', 'confirm after the webhook: idempotent');
      const ev = odb(env).prepare('select from_st, to_st, by from order_events where order_id = ? order by rowid').all(id).map((r) => r.from_st + '>' + r.to_st + '@' + r.by);
      assert.deepEqual(ev.filter((x) => !x.startsWith('PUBLISHED>PUBLISHED')), ['>CREATED@buyer', 'CREATED>PAYMENT_PENDING@buyer', 'PAYMENT_PENDING>PAID@pg:hook', 'PAID>PUBLISH_PENDING@system', 'PUBLISH_PENDING>PUBLISHED@system']);
      // the same webhook again (PortOne's retry): dup, nothing moves
      const body = hookBody(id, 'Transaction.Paid', 'store-mock'), hid = 'msg_replay_1';
      assert.equal((await signed(H, MOCK_HOOK_SECRET, body, { id: hid })).status, 200);
      const rep = await signed(H, MOCK_HOOK_SECRET, body, { id: hid }); assert.equal(rep.status, 200); assert.equal((await rep.json()).dup, true);
      // refund through the (mock) PG
      assert.equal((await H.admin('/rt/admin/order/' + id + '/refund', { note: '' })).status, 400, 'a reason is required');
      const rf = await (await H.admin('/rt/admin/order/' + id + '/refund', { note: '고객 요청' })).json(); assert.equal(rf.order.st, 'REFUNDED');
      const again = await (await H.admin('/rt/admin/order/' + id + '/refund', { note: '고객 요청' })).json(); assert.equal(again.already, true);
      const det = await (await H.admin('/rt/admin/order/' + id)).json(); assert.equal(det.order.st, 'REFUNDED'); assert.equal(det.events.at(-1).to, 'REFUNDED'); assert.equal(det.order.ref, other, 'attribution from the gift store: the board it was made from');
      const days = Object.fromEntries(odb(env).prepare('select k, n from order_days').all().map((r) => [r.k, r.n]));
      assert.deepEqual(days, { 'mock:checkout_start': 1, 'mock:pay_success': 1, 'mock:publish_ok': 1, 'mock:refund': 1 });
      // revenue leaves mock out
      const rev = await (await H.admin('/rt/admin/order-revenue')).json(); assert.equal(rev.revenue.paid, 0); assert.equal(rev.revenue.excluded, 1);
    } finally { done(); }
  });
  it('a failed window counts pay_fail once; a wrong amount is never PAID; an amount-failed order can be refunded', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv({ PAY_ON: '1', PAY_MODE: 'mock' }), H = harness(env, LOCAL), A = await userToken(state, clock, U1), bid = await board(H, A.token);
      const mk = async () => (await (await H.post('/rt/order', { product: 'gift_long', boardId: bid, shown: 3900 }, A.token)).json()).order.id;
      const f = await mk(); await H.post('/rt/order/' + f + '/pay', {}, A.token);
      await H.post('/rt/order/' + f + '/fail', { code: 'USER_CANCEL' }, A.token);
      await H.post('/rt/order/' + f + '/mock', { result: 'failed' }, A.token);
      assert.equal((await (await H.get('/rt/order/' + f, A.token)).json()).order.st, 'FAILED');
      const a = await mk(); await H.post('/rt/order/' + a + '/pay', {}, A.token); await H.post('/rt/order/' + a + '/mock', { result: 'amount' }, A.token);
      const conf = await H.post('/rt/order/' + a + '/confirm', {}, A.token); const cj = await conf.json();
      assert.equal(cj.order.st, 'FAILED'); assert.notEqual(cj.order.perksActive, true);
      assert.equal(odb(env).prepare("select count(*) n from order_events where order_id = ? and to_st = 'PAID'").get(a).n, 0);
      const why = JSON.parse(odb(env).prepare("select detail from order_events where order_id = ? and to_st = 'FAILED'").get(a).detail); assert.equal(why.why, 'amount'); assert.equal(why.paid, 3800);
      assert.equal((await (await H.admin('/rt/admin/order/' + a + '/refund', { note: '금액 불일치' })).json()).order.st, 'REFUNDED');
      assert.equal(odb(env).prepare("select n from order_days where k = 'mock:pay_fail'").get().n, 2, 'f once (window + PG), a once');
    } finally { done(); }
  });
  it('the buyer can cancel before paying; a cancelled order the PG later reports PAID becomes PAID', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv({ PAY_ON: '1', PAY_MODE: 'mock' }), H = harness(env, LOCAL), A = await userToken(state, clock, U1), bid = await board(H, A.token);
      const id = (await (await H.post('/rt/order', { product: 'gift_long', boardId: bid }, A.token)).json()).order.id;
      await H.post('/rt/order/' + id + '/pay', {}, A.token);
      assert.equal((await (await H.post('/rt/order/' + id + '/cancel', {}, A.token)).json()).order.st, 'CANCELLED');
      await H.post('/rt/order/' + id + '/mock', { result: 'paid' }, A.token);
      assert.equal((await (await H.get('/rt/order/' + id, A.token)).json()).order.st, 'PUBLISHED');
    } finally { done(); }
  });
});

describe('webhook signatures (Standard Webhooks)', () => {
  it('hookVerify: good, bad, wrong secret, old and future timestamps, missing headers, several signatures', async () => {
    const sec = 'whsec_' + Buffer.from('a-test-secret-of-24-bytes').toString('base64'), now = 1_800_000_000, body = '{"a":1}';
    const h = (o) => new Headers({ 'webhook-id': 'msg_1', 'webhook-timestamp': String(now), ...o });
    const sig = await hookSign(sec, 'msg_1', String(now), body);
    assert.match(sig, /^v1,[A-Za-z0-9+/]+=*$/);
    assert.deepEqual(await hookVerify(sec, h({ 'webhook-signature': sig }), body, now), { ok: true, id: 'msg_1' });
    assert.deepEqual(await hookVerify(sec.slice(6), h({ 'webhook-signature': sig }), body, now), { ok: true, id: 'msg_1' }, 'without the prefix');
    assert.equal((await hookVerify(sec, h({ 'webhook-signature': 'v1,AAAA v2,x ' + sig }), body, now)).ok, true, 'one of several');
    assert.equal((await hookVerify(sec, h({ 'webhook-signature': sig }), body + ' ', now)).why, 'sig', 'a changed body');
    assert.equal((await hookVerify('whsec_' + Buffer.from('other').toString('base64'), h({ 'webhook-signature': sig }), body, now)).why, 'sig');
    assert.equal((await hookVerify(sec, h({ 'webhook-signature': sig.replace('v1,', 'v2,') }), body, now)).why, 'sig');
    assert.equal((await hookVerify(sec, h({ 'webhook-signature': sig }), body, now + 301)).why, 'time', 'more than 5 minutes old');
    assert.equal((await hookVerify(sec, h({ 'webhook-signature': sig }), body, now - 301)).why, 'time', 'from the future');
    assert.equal((await hookVerify(sec, h({ 'webhook-signature': sig }), body, now + 299)).ok, true);
    assert.equal((await hookVerify(sec, new Headers({ 'webhook-signature': sig }), body, now)).why, 'headers');
    assert.equal((await hookVerify('', h({ 'webhook-signature': sig }), body, now)).why, 'secret');
  });
  it('the route: 400 for a bad or old signature (nothing stored), 200 ignored for other types, dup on replay, 503 without a secret', async () => {
    const { clock, state, done } = setup();
    try {
      const SEC = 'whsec_' + Buffer.from('portone-test-webhook-secret').toString('base64');
      const env = makeEnv({ PAY_ON: '1', PORTONE_STORE_ID: 'store-1', PORTONE_CHANNEL_KEY: 'channel-key-test', PORTONE_API_SECRET: 'api-secret-test' }), H = harness(env), A = await userToken(state, clock, U1);
      assert.equal((await signed(H, SEC, hookBody('o_' + 'a'.repeat(20)))).status, 503, 'no PORTONE_WEBHOOK_SECRET yet');
      env.PORTONE_WEBHOOK_SECRET = SEC; env.PAY_ALLOW = A.id;
      const bid = await board(H, A.token), id = (await (await H.post('/rt/order', { product: 'gift_long', boardId: bid }, A.token)).json()).order.id;
      await H.post('/rt/order/' + id + '/pay', {}, A.token);
      state.pg.set(id, { id, status: 'PAID', transactionId: 'tx-1', amount: { total: 3900 }, currency: 'KRW', channel: { type: 'TEST', key: 'channel-key-test' }, storeId: 'store-1' });
      assert.equal((await signed(H, SEC, hookBody(id), { sig: 'v1,' + Buffer.from('nope').toString('base64') })).status, 400);
      assert.equal((await signed(H, 'whsec_' + Buffer.from('wrong').toString('base64'), hookBody(id))).status, 400);
      assert.equal((await signed(H, SEC, hookBody(id), { ts: Math.floor(Date.now() / 1000) - 600 })).status, 400, 'old');
      assert.equal(odb(env).prepare('select count(*) n from webhooks').get().n, 0);
      assert.equal((await (await H.get('/rt/order/' + id, A.token)).json()).order.st, 'PAYMENT_PENDING', 'nothing moved');
      assert.equal((await (await signed(H, SEC, { type: 'BillingKey.Issued', data: { storeId: 'store-1', billingKey: 'b' } })).json()).ignored, 'type');
      assert.equal((await (await signed(H, SEC, hookBody(id, 'Transaction.Paid', 'store-other'))).json()).ignored, 'store');
      const ok = await signed(H, SEC, hookBody(id), { id: 'msg_good' }); assert.equal(ok.status, 200);
      assert.equal((await (await H.get('/rt/order/' + id, A.token)).json()).order.st, 'PUBLISHED');
      const dup = await signed(H, SEC, hookBody(id), { id: 'msg_good' }); assert.equal((await dup.json()).dup, true);
      assert.ok(state.pgAuth.every((x) => x === 'PortOne api-secret-test'), 'every PortOne call carries the API secret');
      assert.ok(state.calls.some((x) => x === 'https://api.portone.io/payments/' + id + '?storeId=store-1'));
    } finally { done(); }
  });
});

describe('PortOne test and live modes (fake api.portone.io)', () => {
  it('pay hands the SDK what it needs; confirm re-queries; a TEST channel is test money; live + LIVE channel is revenue; refund cancels', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv({ PAY_ON: '1' }), H = harness(env), A = await userToken(state, clock, U1); env.PAY_ALLOW = A.id;
      const bid = await board(H, A.token);
      const id = (await (await H.post('/rt/order', { product: 'gift_tower', boardId: bid, shown: 14900 }, A.token)).json()).order.id;
      const nokeys = await H.post('/rt/order/' + id + '/pay', {}, A.token); assert.equal(nokeys.status, 503); assert.equal((await nokeys.json()).code, 'keys');
      Object.assign(env, { PORTONE_STORE_ID: 'store-1', PORTONE_CHANNEL_KEY: 'channel-key-test' });
      const pay = await (await H.post('/rt/order/' + id + '/pay', {}, A.token)).json();
      assert.deepEqual(pay.sdk, { storeId: 'store-1', channelKey: 'channel-key-test', paymentId: id, orderName: '메인 타워 주인공', totalAmount: 14900, currency: 'CURRENCY_KRW', payMethod: 'CARD' });
      assert.equal((await H.post('/rt/order/' + id + '/confirm', {}, A.token)).status, 503, 'no API secret');
      env.PORTONE_API_SECRET = 'api-secret-test';
      const early = await (await H.post('/rt/order/' + id + '/confirm', {}, A.token)).json(); assert.equal(early.pending, true, 'PortOne does not know it yet');
      state.pg.set(id, { id, status: 'PAID', transactionId: 'tx-9', amount: { total: 14900 }, currency: 'KRW', channel: { type: 'TEST', key: 'channel-key-test' } });
      const conf = await (await H.post('/rt/order/' + id + '/confirm', {}, A.token)).json(); assert.equal(conf.order.st, 'PUBLISHED'); assert.equal(conf.order.test, true);
      const rf = await (await H.admin('/rt/admin/order/' + id + '/refund', { note: '테스트 환불' })).json(); assert.equal(rf.order.st, 'REFUNDED');
      assert.deepEqual(state.cancels, [{ pid: id, body: { storeId: 'store-1', reason: '테스트 환불' }, key: 'refund-' + id }]);
      // live
      env.PAY_MODE = 'live'; delete env.PAY_ALLOW;
      const L = (await (await H.post('/rt/order', { product: 'gift_long', boardId: bid, shown: 3900 }, A.token)).json()).order.id; await H.post('/rt/order/' + L + '/pay', {}, A.token);
      state.pg.set(L, { id: L, status: 'PAID', transactionId: 'tx-L', amount: { total: 3900 }, currency: 'KRW', channel: { type: 'LIVE', key: 'channel-key-test' } });
      assert.equal((await (await H.post('/rt/order/' + L + '/confirm', {}, A.token)).json()).order.test, false);
      const rev = (await (await H.admin('/rt/admin/order-revenue')).json()).revenue;
      assert.equal(rev.paid, 1); assert.equal(rev.gross, 3900); assert.equal(rev.excluded, 1, 'the test-channel order'); assert.deepEqual(rev.buyers, { total: 1, new: 1, repeat: 0 });
      assert.equal(rev.products.find((p) => p.id === 'gift_long').picks, 0, 'picks read from the gift counters');
      assert.equal(rev.cost.pg.lo, Math.round(3900 * 0.032 * 1.1)); assert.equal(rev.cost.fixed, null);
      // a cancel made in the PortOne console reaches the order through its webhook
      env.PORTONE_WEBHOOK_SECRET = 'whsec_' + Buffer.from('k').toString('base64'); state.pg.get(L).status = 'CANCELLED';
      await signed(H, env.PORTONE_WEBHOOK_SECRET, hookBody(L, 'Transaction.Cancelled'));
      assert.equal((await (await H.get('/rt/order/' + L, A.token)).json()).order.st, 'REFUNDED');
    } finally { done(); }
  });
});

describe('publishing', () => {
  it('a board that went away: tries on later reads, FAILED after 3, the operator can try again or refund', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv({ PAY_ON: '1', PAY_MODE: 'mock' }), H = harness(env, LOCAL), A = await userToken(state, clock, U1), bid = await board(H, A.token);
      const id = (await (await H.post('/rt/order', { product: 'gift_long', boardId: bid }, A.token)).json()).order.id;
      await H.post('/rt/order/' + id + '/pay', {}, A.token);
      env.meter('gift').sql.db.prepare('update gb set uid = ? where id = ?').run('user:someone-else', bid);
      await H.post('/rt/order/' + id + '/mock', { result: 'paid' }, A.token);
      const st = async () => (await (await H.get('/rt/order/' + id, A.token)).json()).order;
      let o = await st(); // the read itself is try 2
      assert.equal(o.st, 'PUBLISH_PENDING'); assert.equal(o.perksActive, false);
      o = await st(); assert.equal(o.st, 'FAILED', 'try 3 failed');
      o = await st(); assert.equal(o.st, 'FAILED', 'no more tries on reads');
      assert.equal(odb(env).prepare("select n from order_days where k = 'mock:publish_fail'").get().n, 3);
      env.meter('gift').sql.db.prepare('update gb set uid = ? where id = ?').run(A.id, bid);
      const again = await (await H.admin('/rt/admin/order/' + id + '/publish', {})).json(); assert.equal(again.order.st, 'PUBLISHED');
    } finally { done(); }
  });
});

describe('the operator routes', () => {
  it('sit behind the admin gate; list with filters; manual marks need a reason; products editor with a log; CSV', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv({ PAY_ON: '1', PAY_MODE: 'mock' }), H = harness(env, LOCAL), A = await userToken(state, clock, U1), bid = await board(H, A.token);
      for (const p of ['/rt/admin/orders', '/rt/admin/order-products', '/rt/admin/order-revenue', '/rt/admin/orders.csv', '/rt/admin/order/o_' + 'a'.repeat(20)]) assert.equal((await H.get(p)).status, 401, p);
      const a = (await (await H.post('/rt/order', { product: 'gift_long', boardId: bid }, A.token)).json()).order.id;
      clock.add(1000);
      const b = (await (await H.post('/rt/order', { product: 'gift_video', boardId: bid }, A.token)).json()).order.id;
      const all = await (await H.admin('/rt/admin/orders')).json(); assert.deepEqual(all.orders.map((o) => o.id), [b, a]); assert.equal(all.sw.on, true); assert.equal(all.sw.mode, 'mock');
      assert.deepEqual((await (await H.admin('/rt/admin/orders?product=gift_long')).json()).orders.map((o) => o.id), [a]);
      assert.deepEqual((await (await H.admin('/rt/admin/orders?st=PAID')).json()).orders, []);
      assert.equal((await (await H.admin('/rt/admin/orders?mode=test')).json()).orders.length, 2);
      assert.equal((await H.admin('/rt/admin/order/' + a + '/manual', { op: 'paid' })).status, 400, 'no reason');
      const mp = await (await H.admin('/rt/admin/order/' + a + '/manual', { op: 'paid', note: '계좌 입금 확인' })).json();
      assert.equal(mp.order.st, 'PUBLISHED'); assert.equal(mp.order.how, 'test', 'mock mode stays test');
      const mr = await (await H.admin('/rt/admin/order/' + a + '/refund', { note: 'x2' })).json(); assert.equal(mr.code, 'manual', 'a hand-paid order is not refunded through the PG');
      assert.equal((await (await H.admin('/rt/admin/order/' + a + '/manual', { op: 'refunded', note: '계좌로 돌려줌' })).json()).order.st, 'REFUNDED');
      // products
      // products: names, lines and prices come from giftrules.js TIERS (and GIFT_ARMS); the operator only switches one on or off
      const bad = await H.admin('/rt/admin/order-products', { id: 'gift_long', price: 4900 }); assert.equal(bad.status, 400); assert.match((await bad.json()).error, /TIERS/);
      const ed = await (await H.admin('/rt/admin/order-products', { id: 'gift_long', active: false })).json(); assert.equal(ed.ok, true);
      assert.equal(ed.products.find((p) => p.id === 'gift_long').active, false); assert.equal(ed.products.find((p) => p.id === 'gift_long').price, 3900);
      assert.ok(!(await (await H.get('/rt/order/products', A.token)).json()).products.some((p) => p.id === 'gift_long'), 'switched off: not listed');
      assert.equal((await H.post('/rt/order', { product: 'gift_long', boardId: bid }, A.token)).status, 400, 'nor sold');
      await H.admin('/rt/admin/order-products', { id: 'gift_long', active: true });
      const log = (await (await H.admin('/rt/admin/order-products')).json()).log; assert.equal(log.length, 2); assert.deepEqual(log.map((l) => l.after.active).sort(), [false, true]);
      // the price arm is the board's (GIFT_ARMS, the arm its owner page showed)
      env.GIFT_ARMS = 'A:3900/7900/14900;B:2900/5900/11900';
      const arm = ladderArm(bid, env.GIFT_ARMS), shown = (await (await H.get('/rt/order/products?board=' + bid, A.token)).json()).products.find((p) => p.id === 'gift_long');
      assert.equal(shown.arm, arm.a); assert.equal(shown.price, arm.p[1]);
      const c = await (await H.post('/rt/order', { product: 'gift_long', boardId: bid, shown: shown.price }, A.token)).json(); assert.equal(c.order.price, shown.price, 'the order keeps the shown arm price');
      assert.equal(odb(env).prepare('select arm from orders where id = ?').get(c.order.id).arm, arm.a);
      // CSV
      const csv = await H.admin('/rt/admin/orders.csv');
      assert.match(csv.headers.get('content-type'), /^text\/csv; charset=utf-8/); assert.match(csv.headers.get('content-disposition'), /attachment; filename="orders-/);
      const raw = new Uint8Array(await csv.arrayBuffer()); assert.deepEqual([...raw.slice(0, 3)], [0xef, 0xbb, 0xbf], 'a UTF-8 BOM for spreadsheet apps');
      const text = new TextDecoder().decode(raw); assert.ok(text.startsWith('id,created_kst,'));
      assert.equal(text.trim().split('\r\n').length, 4, 'header + 3 orders');
      assert.ok(text.includes('"' + a + '"'));
    } finally { done(); }
  });
});

describe('operator and test traffic leave the daily stats', () => {
  it('testTraffic: the header, the staff cookie', () => {
    const r = (h) => new Request('https://x.example/', { headers: h });
    assert.equal(testTraffic(r({})), false); assert.equal(testTraffic(r({ 'x-kts-test': '1' })), true); assert.equal(testTraffic(r({ 'x-kts-test': '0' })), false);
    assert.equal(testTraffic(r({ cookie: 'a=1; kts_staff=1' })), true); assert.equal(testTraffic(r({ cookie: 'kts_staff=10' })), false); assert.equal(testTraffic(r({ cookie: 'xkts_staff=1' })), false);
  });
  it('/rt/event and the gift seen beacon drop them; a successful admin login marks the device, its logout clears it', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), G = await H.guest();
      const evs = () => { try { return env.meter('ev').sql.db.prepare('select count(*) n from evt').get().n; } catch { return 0; } };
      assert.equal((await H.post('/rt/event', { name: 'page_landing', sid: 'sess-12345' }, G.token, { 'x-kts-test': '1' })).status, 200);
      await H.post('/rt/event', { name: 'page_landing', sid: 'sess-12345' }, G.token, { cookie: 'kts_staff=1' });
      assert.equal(evs(), 0, 'not stored');
      await H.post('/rt/event', { name: 'page_landing', sid: 'sess-12345' }, G.token); assert.equal(evs(), 1);
      const A = await userToken(state, clock, U1), bid = await board(H, A.token);
      const views = () => Number(env.meter('gift').sql.db.prepare("select sum(n) n from gd where k = 'view'").get().n) || 0;
      await H.post('/rt/gift/' + bid + '/seen', { v: 'a'.repeat(16), e: 'open' }, null, { 'x-kts-test': '1' }); await giftSeenFlush(env, H.ctx);
      assert.equal(views(), 0, 'test traffic is not a visitor');
      await H.post('/rt/gift/' + bid + '/seen', { v: 'b'.repeat(16), e: 'open' }); await giftSeenFlush(env, H.ctx);
      assert.equal(views(), 1);
      // the operator's device: opening /admin (the login form) or a wrong key marks nothing; the right key does; logout clears it
      const form = await H.call('/admin'); assert.equal(form.status, 200); assert.equal(form.headers.get('set-cookie'), null, 'the login form marks nothing');
      const wrong = await H.call('/rt/admin/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: PROD }, body: 'key=wrong-key-000000' });
      assert.equal(wrong.status, 401); assert.equal(wrong.headers.get('set-cookie'), null);
      const login = await H.call('/rt/admin/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: PROD }, body: 'key=' + env.ADMIN_KEY });
      const set = login.headers.getSetCookie(), c = set[0].split(';')[0];
      assert.match(c, /kts_adm=/); assert.ok(set.includes('kts_staff=1; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Lax'), 'marked at login');
      const page = await H.call('/admin', { headers: { cookie: c } });
      assert.equal(page.status, 200); assert.equal(page.headers.get('set-cookie'), null, 'the page itself sets nothing');
      const out = await H.call('/rt/admin/logout', { method: 'POST', headers: { origin: PROD, cookie: c + '; kts_staff=1' } });
      assert.equal(out.status, 303); assert.ok(out.headers.getSetCookie().includes('kts_staff=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax'), 'cleared at logout');
    } finally { done(); }
  });
  it('WAU: distinct accounts over the last 7 KST days, guests folded into their user', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), G1 = await H.guest('1.1.1.1'), G2 = await H.guest('2.2.2.2');
      const ev = (t) => H.post('/rt/event', { name: 'page_landing', sid: 'sess-' + t.slice(-8) }, t);
      await ev(G1.token); await ev(G2.token); clock.add(864e5); await ev(G1.token); clock.add(6 * 864e5); await ev(G1.token);
      const s = await (await H.admin('/rt/admin/stats?days=8')).json();
      assert.equal(s.wau[0].day, kstDay(Date.now())); assert.equal(s.wau[0].n, 1, 'day 7: only G1 within the window');
      assert.equal(s.wau.find((x) => x.day === kstDay(Date.now() - 6 * 864e5)).n, 2);
    } finally { done(); }
  });
});
