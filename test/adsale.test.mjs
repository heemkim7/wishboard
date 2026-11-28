// 광고 판매 (상6): the rules (adsale.js), the Worker routes and the 'ads' store (adsrv.js), the switches ADS_ON / ADS_PRICES
// and the legal text. The placement of the screens is test/ad-screens.test.mjs.
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

const { Room, Meter } = await import('../worker.js');
const worker = (await import('../worker.js')).default;
const S = await import('../adsale.js');
const { adsOn, reportHtml, adsWorldDrop, adsWorld, adsDb, ADS_ERR } = await import('../adsrv.js');
const { policyDoc } = await import('../legal.js');
const { SLOT_IDS, SLOT_RE } = await import('../balance.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ---- harness (as test/ads.test.mjs: real DOs on in-memory SQLite, arguments and results copied like the runtime) ----
function sqliteStorage(db = new DatabaseSync(':memory:')) {
  return {
    db,
    exec(query, ...args) {
      const q = String(query).trim();
      if (!args.length && /^create\b/i.test(q)) { db.exec(q); return { rowsWritten: 0, toArray() { return []; }, one() { return {}; }, [Symbol.iterator]() { return [][Symbol.iterator](); } }; }
      const stmt = db.prepare(q);
      if (/^select\b/i.test(q)) { const rows = stmt.all(...args); return { rowsWritten: 0, toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() }; }
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
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ADMIN_KEY: 'admin-test-key-123', ASSETS: { fetch: () => new Response('asset', { status: 200 }) }, ...extra };
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new Meter(makeCtx(sql), env) }); } return meters.get(name); };
  env.room = (topic) => { if (!rooms.has(topic)) { const sql = sqliteStorage(); rooms.set(topic, { sql, do: new Room(makeCtx(sql), env) }); } return rooms.get(topic); };
  env.METER = { idFromName: (name) => name, get: (name) => stub(env.meter(name).do) };
  env.ROOM = { idFromName: (topic) => topic, get: (topic) => stub(env.room(topic).do) };
  return env;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const fakeNet = (state) => async (url) => { const u = String(url); state.calls.push(u); if (u.includes('/.well-known/jwks.json')) return json({ keys: state.jwks || [] }); if (u.includes('/rest/v1/') && !u.includes('/rpc/')) return json([]); if (u.includes('/rpc/')) return json({ ok: true }); return new Response('missing', { status: 404 }); };
let clockBase = Date.parse('2027-09-01T03:00:00Z'); // 12:00 KST
function setup() {
  clockBase += 400 * 864e5; let t = clockBase; const origNow = Date.now, origFetch = globalThis.fetch, state = { calls: [] };
  Date.now = () => t; globalThis.fetch = fakeNet(state); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  return { state, clock: { add: (ms) => { t += ms; }, to: (ms) => { t = ms; }, now: () => t }, done: () => { Date.now = origNow; globalThis.fetch = origFetch; } };
}
function harness(env) {
  const waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (p, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + p, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const post = (p, body, h = {}) => call(p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1', ...h }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const admin = (p, body, key = env.ADMIN_KEY) => (body === undefined ? call(p, { headers: { 'x-admin-key': key } }) : post(p, body, { 'x-admin-key': key }));
  const guest = async () => { const t = (await (await post('/rt/guest', {}, { 'cf-connecting-ip': '9.9.9.' + Math.floor(Math.random() * 200) })).json()).token; return t; };
  return { call, post, admin, guest, get: (p, h = {}) => call(p, { headers: h }) };
}
const day = (t, n = 0) => S.addDays(S.kstDay(t), n);
const FORM = (t, extra = {}) => ({ product: 'screen', start: day(t, 3), days: 2, screen: 'AD_1', lines: ['우리 가게 오픈', '타임스퀘어에서 만나요', ''], emoji: '🎉', theme: 'gold_luxury', link: 'https://shop.example.co.kr/open', company: '꽃집 하루', email: 'Owner@Shop.co.kr', phone: '010-1234-5678', memo: '', agree: true, website: '', ...extra });

describe('ADS_PRICES and ADS_ON', () => {
  it('a missing, broken or odd ADS_PRICES shows 견적 문의; whole won from 1,000 to 100,000,000 shows the price', () => {
    for (const raw of [undefined, '', 'nope', '[1,2]', 'null', '"30000"', '{"screen":"30000"}', '{"screen":30000.5}', '{"screen":-5}', '{"screen":999}', '{"screen":200000000}']) {
      const p = S.adPrices(raw);
      assert.deepEqual([p.screen, p.cheer, p.sponsor9], [null, null, null], String(raw));
      assert.equal(S.priceText(p.screen), '견적 문의');
    }
    const p = S.adPrices('{"screen":30000,"cheer":50000,"sponsor9":100000,"note":"부가세 별도","extra":1}');
    assert.deepEqual(p, { screen: 30000, cheer: 50000, sponsor9: 100000, note: '부가세 별도' });
    assert.equal(S.priceText(p.screen), '30,000원');
    assert.deepEqual(S.adPrices('{"cheer":50000}'), { screen: null, cheer: 50000, sponsor9: null, note: '' }); // one product priced, the rest 견적 문의
  });
  it('ADS_ON is on only for exactly "1"', () => {
    assert.equal(adsOn({ ADS_ON: '1' }), true);
    for (const v of [undefined, '', '0', 'true', 'on', ' 1', '1 ', 'yes', '11']) assert.equal(adsOn({ ADS_ON: v }), false, String(v));
  });
});

describe('the request form rules', () => {
  const now = Date.parse('2027-03-09T14:30:00Z'); // 23:30 KST on the 9th
  it('takes a full request and cleans it', () => {
    const r = S.adRequestFault(FORM(now), now);
    assert.equal(r.ok, true);
    assert.deepEqual(r.v.lines, ['우리 가게 오픈', '타임스퀘어에서 만나요', '']);
    assert.equal(r.v.email, 'owner@shop.co.kr');
    assert.equal(r.v.link, 'https://shop.example.co.kr/open');
    assert.equal(S.adRequestFault(FORM(now, { product: 'sponsor9', screen: 'AD_2' }), now).v.screen, '*'); // the sponsor takes every screen
    assert.equal(S.adRequestFault(FORM(now, { screen: '' }), now).v.screen, ''); // anywhere
  });
  it('dates in KST: tomorrow at the earliest, at most 180 days ahead, 1 to 30 days', () => {
    assert.equal(S.adRequestFault(FORM(now, { start: '2027-03-09' }), now).field, 'start'); // today (KST)
    assert.equal(S.adRequestFault(FORM(now, { start: '2027-03-10' }), now).ok, true); // tomorrow, though UTC is still the 9th
    assert.equal(S.adRequestFault(FORM(now, { start: S.addDays('2027-03-09', 180) }), now).ok, true);
    assert.equal(S.adRequestFault(FORM(now, { start: S.addDays('2027-03-09', 181) }), now).field, 'start');
    for (const bad of ['2027-02-30', '2027-3-10', '', 'tomorrow']) assert.equal(S.adRequestFault(FORM(now, { start: bad }), now).field, 'start', bad);
    for (const d of [0, 31, 1.5, 'x', -1, null]) assert.equal(S.adRequestFault(FORM(now, { days: d }), now).field, 'days', String(d));
  });
  it('refuses each bad field with its own message', () => {
    const f = (x) => S.adRequestFault(FORM(now, x), now);
    assert.equal(f({ product: 'slot' }).field, 'product');
    assert.equal(f({ screen: 'STREET_5' }).field, 'screen'); // a claimable board is never an ad screen
    assert.equal(f({ lines: ['', 'a', 'b'] }).field, 'lines');
    assert.equal(f({ lines: ['가'.repeat(17), '', ''] }).field, 'lines');
    assert.equal(f({ lines: ['좋아요', '가'.repeat(21), ''] }).field, 'lines');
    assert.equal(f({ lines: ['좋아요', '', '가'.repeat(25)] }).field, 'lines');
    assert.equal(f({ lines: ['shit sale', '', ''] }).field, 'lines'); // blockedText
    assert.equal(f({ emoji: '💣' }).field, 'emoji');
    assert.equal(f({ theme: 'hacker' }).field, 'theme');
    for (const link of ['http://shop.co.kr', 'https://127.0.0.1/', 'https://localhost/x', 'https://user:pw@shop.co.kr/', 'https://shop.co.kr:8443/', 'javascript:alert(1)', 'https://shop', 'https://a.co.kr/' + 'x'.repeat(200), 'https://shop.co.kr/"><script>']) assert.equal(f({ link }).field, 'link', link);
    assert.equal(f({ company: '' }).field, 'company');
    assert.equal(f({ company: '가'.repeat(41) }).field, 'company');
    for (const email of ['', 'no-at', 'a@b', 'a b@c.kr', 'x'.repeat(115) + '@a.kr']) assert.equal(f({ email }).field, 'email', email);
    assert.equal(f({ phone: '전화해요' }).field, 'phone');
    assert.equal(f({ memo: '가'.repeat(301) }).field, 'memo');
    assert.equal(f({ agree: false }).field, 'agree');
    assert.equal(f({ agree: 'yes' }).field, 'agree');
    assert.equal(S.adRequestFault(null, now).ok, false);
  });
  it('control characters never reach the screen', () => {
    const r = S.adRequestFault(FORM(now, { lines: ['우리' + String.fromCharCode(10) + '가게', '', ''] }), now);
    assert.equal(r.v.lines[0], '우리 가게');
  });
});

describe('bookings: overlaps and what each screen shows (KST)', () => {
  const B = (id, p, s, start, end) => ({ id, p, s, st: 'live', ...S.kstRange(start, end) });
  it('one screen holds one booking at a time; other screens and cancelled bookings do not clash; all sponsors share one lane', () => {
    const list = [B('a00000000001', 'screen', 'AD_1', '2027-03-10', '2027-03-12'), { ...B('a00000000002', 'screen', 'AD_2', '2027-03-10', '2027-03-12'), st: 'cancelled' }, B('a00000000003', 'sponsor9', '*', '2027-03-11', '2027-03-11')];
    assert.equal(S.adClash(list, B('', 'cheer', 'AD_1', '2027-03-12', '2027-03-14'))?.id, 'a00000000001'); // the last day meets
    assert.equal(S.adClash(list, B('', 'screen', 'AD_1', '2027-03-13', '2027-03-14')), null); // the day after
    assert.equal(S.adClash(list, B('', 'screen', 'AD_1', '2027-03-01', '2027-03-09')), null);
    assert.equal(S.adClash(list, B('', 'screen', 'AD_2', '2027-03-10', '2027-03-12')), null); // only a cancelled one there
    assert.equal(S.adClash(list, B('', 'screen', 'AD_3', '2027-03-11', '2027-03-11')), null); // a sponsor does not block a screen
    assert.equal(S.adClash(list, B('', 'sponsor9', '*', '2027-03-11', '2027-03-15'))?.id, 'a00000000003');
  });
  it('the schedule form: a screen, real dates in order, not over, at most 90 days', () => {
    const now = Date.parse('2027-03-09T03:00:00Z');
    assert.equal(S.adBookFault({ product: 'screen', screen: 'AD_1', start: '2027-03-09', end: '2027-03-09' }, now).ok, true);
    assert.deepEqual(S.adBookFault({ product: 'sponsor9', screen: 'AD_4', start: '2027-03-10', end: '2027-03-10' }, now).v.s, '*');
    assert.equal(S.adBookFault({ product: 'screen', screen: 'MAIN_TOP', start: '2027-03-10', end: '2027-03-10' }, now).field, 'screen');
    assert.equal(S.adBookFault({ product: 'screen', screen: 'AD_1', start: '2027-03-11', end: '2027-03-10' }, now).field, 'date');
    assert.equal(S.adBookFault({ product: 'screen', screen: 'AD_1', start: '2027-03-01', end: '2027-03-08' }, now).field, 'date');
    assert.equal(S.adBookFault({ product: 'screen', screen: 'AD_1', start: '2027-03-10', end: S.addDays('2027-03-10', 90) }, now).field, 'date');
  });
  it('a day booking runs from 00:00 KST on its first day to 24:00 KST on its last', () => {
    const list = [B('b00000000001', 'screen', 'AD_1', '2027-03-10', '2027-03-11')];
    const at = (iso) => S.adShowing(list, 'AD_1', Date.parse(iso))?.id || null;
    assert.equal(at('2027-03-09T14:59:59.999Z'), null); // 23:59:59.999 KST on the 9th
    assert.equal(at('2027-03-09T15:00:00.000Z'), 'b00000000001'); // 00:00 KST on the 10th
    assert.equal(at('2027-03-11T14:59:59.999Z'), 'b00000000001');
    assert.equal(at('2027-03-11T15:00:00.000Z'), null);
    assert.equal(S.adShowing(list, 'AD_2', Date.parse('2027-03-10T03:00:00Z')), null); // only its own screen
  });
  it('the 9 pm sponsor covers every screen for exactly 60 seconds of each of its days, then the screens go back', () => {
    const list = [B('c00000000001', 'screen', 'AD_1', '2027-03-10', '2027-03-10'), B('c00000000002', 'sponsor9', '*', '2027-03-10', '2027-03-10')];
    const at = (iso, s = 'AD_1') => S.adShowing(list, s, Date.parse(iso))?.id || null;
    assert.equal(at('2027-03-10T11:59:59.999Z'), 'c00000000001'); // 20:59:59.999 KST
    for (const s of S.AD_SCREEN_IDS) assert.equal(at('2027-03-10T12:00:00.000Z', s), 'c00000000002', s); // 21:00:00 KST
    assert.equal(at('2027-03-10T12:00:59.999Z', 'AD_5'), 'c00000000002');
    assert.equal(at('2027-03-10T12:01:00.000Z'), 'c00000000001');
    assert.equal(at('2027-03-10T12:01:00.000Z', 'AD_5'), null);
    assert.equal(at('2027-03-11T12:00:30.000Z', 'AD_2'), null); // the day after: over
  });
  it('ADS_ON off: an empty screen is a quiet city screen; on: the house ad; a booking shows either way', () => {
    const now = Date.parse('2027-03-10T03:00:00Z'), list = [B('d00000000001', 'screen', 'AD_1', '2027-03-10', '2027-03-10')];
    assert.deepEqual(S.adView({ on: false, list: [] }, 'AD_1', now), { kind: 'city' });
    assert.deepEqual(S.adView({ on: true, list: [] }, 'AD_1', now), { kind: 'house' });
    assert.deepEqual(S.adView(undefined, 'AD_1', now), { kind: 'city' });
    assert.equal(S.adView({ on: false, list }, 'AD_1', now).ad.id, 'd00000000001');
    assert.equal(S.adView({ on: true, list }, 'AD_2', now).kind, 'house');
  });
  it('the client keeps only well-formed public entries from /rt/world', () => {
    const good = { id: 'e00000000001', p: 'screen', s: 'AD_1', a: 1, b: 2, l: ['a', 'b', 'c', 'd'], e: '🎉', th: 'neon_pink', u: 'javascript:x', tok: 'secret', email: 'x@y.kr' };
    const w = S.adWorld({ on: 1, list: [good, { ...good, id: 'zz' }, { ...good, s: 'STREET_1' }, { ...good, p: 'slot' }, null] });
    assert.equal(w.on, true);
    assert.deepEqual(w.list, [{ id: 'e00000000001', p: 'screen', s: 'AD_1', a: 1, b: 2, l: ['a', 'b', 'c'], e: '🎉', th: 'neon_pink', u: '' }]);
    assert.deepEqual(S.adWorld(null), { on: false, list: [] });
  });
  it('the ad screens are not claimable boards', () => {
    for (const id of S.AD_SCREEN_IDS) { assert.equal(SLOT_RE.test(id), false, id); assert.equal(SLOT_IDS.includes(id), false, id); }
    assert.equal(S.AD_SCREEN_IDS.length, 5);
  });
});

describe('the Worker: /rt/ads/*', { concurrency: false }, () => {
  it('ADS_ON off: stats says off, the form is refused, nothing is stored', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env);
      const st = await (await H.get('/rt/ads/stats')).json();
      assert.deepEqual(st, { ok: true, on: false });
      const r = await H.post('/rt/ads/request', FORM(Date.now()));
      assert.equal(r.status, 403); assert.equal((await r.json()).code, 'off');
      const off2 = makeEnv({ ADS_ON: 'true' });
      assert.equal((await harness(off2).post('/rt/ads/request', FORM(Date.now()))).status, 403);
      assert.equal(env.meter('ads').sql.db.prepare("select count(*) n from sqlite_master where name = 'ad_req'").get().n, 0);
    } finally { done(); }
  });
  it('ADS_ON on: prices from ADS_PRICES (or 견적 문의), the plaza visitors of the last 7 finished days, labelled as the game\'s own count', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv({ ADS_ON: '1', ADS_PRICES: '{"screen":30000}' }), H = harness(env), today = S.kstDay(Date.now());
      const acct = env.meter('acct');
      acct.do.acInit();
      for (const [n, v] of [[-1, 40], [-2, 20], [-7, 9], [-8, 1000], [0, 77]]) acct.sql.db.prepare("insert into tal(d, k, n) values(?, 'v', ?)").run(S.addDays(today, n), v);
      clock.add(601000); // past another test's 10-minute isolate copy
      const d = await (await H.get('/rt/ads/stats')).json();
      assert.equal(d.on, true);
      assert.deepEqual([d.prices.screen, d.prices.cheer, d.prices.sponsor9], [30000, null, null]);
      assert.equal(d.counted, '광장이 센 수');
      assert.equal(d.stats.sum, 69); // today and day -8 are outside the window
      assert.equal(d.stats.known, 3); assert.equal(d.stats.avg, 23);
      assert.equal(d.stats.days.length, 7);
    } finally { done(); }
  });
  it('a request is checked, stored, limited per network per day, refused when too big and at the hard budget level; the honeypot stores nothing', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv({ ADS_ON: '1' }), H = harness(env), db = () => env.meter('ads').sql.db;
      const ok = await H.post('/rt/ads/request', FORM(Date.now()));
      const okBody = await ok.json();
      assert.equal(ok.status, 200); assert.match(okBody.id, /^[0-9a-f]{12}$/);
      const row = db().prepare('select * from ad_req where id = ?').get(okBody.id);
      assert.equal(row.st, 'new'); assert.equal(row.ip, ''); // the network's hash is not kept with the request
      const j = JSON.parse(row.j);
      assert.deepEqual([j.email, j.company, j.ok, j.lines[0]], ['owner@shop.co.kr', '꽃집 하루', false, '우리 가게 오픈']);
      // the honeypot: told it worked, nothing kept
      const hp = await H.post('/rt/ads/request', FORM(Date.now(), { website: 'http://spam' }));
      assert.equal(hp.status, 200); assert.equal((await hp.json()).ok, true);
      assert.equal(db().prepare('select count(*) n from ad_req').get().n, 1);
      // a bad field
      const bad = await H.post('/rt/ads/request', FORM(Date.now(), { email: 'nope' }));
      assert.equal(bad.status, 400); assert.deepEqual(await bad.json(), { ok: false, code: 'field', field: 'email', error: '답장 받을 이메일을 확인해 주세요.' });
      // size caps: a long body, a lying content-length, not JSON
      assert.equal((await H.post('/rt/ads/request', { ...FORM(Date.now()), memo: 'x'.repeat(5000) })).status, 413);
      assert.equal((await H.call('/rt/ads/request', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '999999' }, body: '{}' })).status, 413);
      assert.equal((await H.post('/rt/ads/request', 'not json')).status, 400);
      // per network per KST day: five in all from 1.1.1.1, then 429; another network still goes
      for (let i = 0; i < 4; i++) assert.equal((await H.post('/rt/ads/request', FORM(Date.now()))).status, 200, String(i));
      const six = await H.post('/rt/ads/request', FORM(Date.now()));
      assert.equal(six.status, 429); assert.equal((await six.json()).code, 'rate');
      assert.equal((await H.post('/rt/ads/request', FORM(Date.now()), { 'cf-connecting-ip': '2.2.2.2' })).status, 200);
      assert.equal(db().prepare('select count(*) n from ad_req').get().n, 6);
      // the next KST day the network may ask again
      clock.add(864e5);
      assert.equal((await H.post('/rt/ads/request', FORM(Date.now()))).status, 200);
      // the hard budget level: refused before the store is asked
      env.BUDGET_REQ_DAY = '1'; clock.add(61000);
      const busy = await H.post('/rt/ads/request', FORM(Date.now()), { 'cf-connecting-ip': '3.3.3.3' });
      assert.equal(busy.status, 503); assert.equal((await busy.json()).code, 'busy');
      assert.equal(db().prepare('select count(*) n from ad_req').get().n, 7);
      delete env.BUDGET_REQ_DAY; clock.add(61000);
      // a request is deleted a year after it arrived
      clock.add(366 * 864e5);
      assert.equal((await H.post('/rt/ads/request', FORM(Date.now()), { 'cf-connecting-ip': '4.4.4.4' })).status, 200);
      assert.equal(db().prepare('select count(*) n from ad_req').get().n, 1);
    } finally { done(); }
  });
  it('every admin route needs the admin key', async () => {
    const { done } = setup();
    try {
      const env = makeEnv({ ADS_ON: '1' }), H = harness(env);
      for (const key of ['', 'wrong-key-123456789', env.ADMIN_KEY.slice(0, -1) + 'x']) {
        assert.equal((await H.admin('/rt/admin/ads', undefined, key)).status, 401, 'list ' + key);
        for (const p of ['/rt/admin/ads/edit', '/rt/admin/ads/book', '/rt/admin/ads/cancel']) assert.equal((await H.admin(p, { id: 'x' }, key)).status, 401, p + ' ' + key);
      }
      assert.equal((await H.call('/rt/admin/ads')).status, 401); // no header at all
      const noKey = makeEnv({ ADS_ON: '1', ADMIN_KEY: '' });
      assert.equal((await harness(noKey).admin('/rt/admin/ads', undefined, '')).status, 401); // no ADMIN_KEY on the Worker: closed
      assert.equal((await H.admin('/rt/admin/ads')).status, 200);
    } finally { done(); }
  });
  it('the admin approves, books without overlaps, the plaza learns it through /rt/world, clicks and sightings count once a day, the report link shows numbers only', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv({ ADS_ON: '1' }), H = harness(env), t0 = Date.now();
      const id = (await (await H.post('/rt/ads/request', FORM(t0))).json()).id;
      const id2 = (await (await H.post('/rt/ads/request', FORM(t0, { company: '두번째', email: 'b@b.kr' }))).json()).id;
      const start = day(t0, 1), end = day(t0, 2);
      // not before the creative is approved
      let r = await H.admin('/rt/admin/ads/book', { rq: id, screen: 'AD_1', start, end });
      assert.equal(r.status, 400); assert.match((await r.json()).error, /승인/);
      // edit and approve; an edit after the approval asks for it again
      r = await (await H.admin('/rt/admin/ads/edit', { id, approve: true, st: 'quoted', price: '2일 60,000원' })).json();
      assert.equal(r.request.ok, true); assert.equal(r.request.st, 'quoted');
      r = await (await H.admin('/rt/admin/ads/edit', { id, lines: ['봄꽃 할인 오픈', '타임스퀘어에서 만나요', '링크를 눌러요'] })).json();
      assert.equal(r.request.ok, false);
      assert.equal((await H.admin('/rt/admin/ads/edit', { id, lines: ['shit', '', ''] })).status, 400); // the same word list as the form
      assert.equal((await H.admin('/rt/admin/ads/edit', { id, st: 'sold' })).status, 400);
      await H.admin('/rt/admin/ads/edit', { id, approve: true, st: 'paid' });
      await H.admin('/rt/admin/ads/edit', { id: id2, approve: true });
      // book; the same screen on a meeting day is refused, another screen is fine
      r = await H.admin('/rt/admin/ads/book', { rq: id, screen: 'AD_1', start, end });
      const bk = (await r.json()).booking;
      assert.equal(r.status, 200); assert.match(bk.id, /^[0-9a-f]{12}$/); assert.match(bk.tok, /^[0-9a-f]{32}$/);
      r = await H.admin('/rt/admin/ads/book', { rq: id2, screen: 'AD_1', start: end, end: day(t0, 4) });
      assert.equal(r.status, 400); assert.match((await r.json()).error, /이미 있어요/);
      const bk2 = (await (await H.admin('/rt/admin/ads/book', { rq: id2, screen: 'AD_3', start: end, end: day(t0, 4) })).json()).booking;
      assert.notEqual(bk2.tok, bk.tok); assert.notEqual(bk2.tok.slice(0, 12), bk2.id);
      const list = await (await H.admin('/rt/admin/ads')).json();
      assert.equal(list.requests.find((x) => x.id === id).st, 'scheduled');
      assert.deepEqual(list.bookings.map((b) => b.s), ['AD_1', 'AD_3']);
      // /rt/world carries the public copy: no token, request, contact
      const w = await (await H.get('/rt/world')).json();
      assert.equal(w.ads.on, 1);
      assert.deepEqual(w.ads.list.map((x) => x.id), [bk.id, bk2.id]);
      const text = JSON.stringify(w.ads);
      for (const secret of [bk.tok, bk2.tok, 'owner@shop.co.kr', '꽃집 하루', '010-1234-5678', id]) assert.equal(text.includes(secret), false, secret);
      assert.deepEqual(w.ads.list[0].l, ['봄꽃 할인 오픈', '타임스퀘어에서 만나요', '링크를 눌러요']);
      // clicks and sightings: a token is needed; before the booking starts nothing counts; then once per account per day
      const g1 = await H.guest(), g2 = await H.guest(), auth = (t) => ({ authorization: 'Bearer ' + t });
      assert.equal((await H.post('/rt/ads/click', { b: bk.id })).status, 401);
      assert.equal((await H.post('/rt/ads/click', { b: bk.id }, auth(g1))).status, 204); // not started: no DO call either
      clock.to(S.dayStart(start) + 3600e3);
      for (let i = 0; i < 3; i++) await H.post('/rt/ads/click', { b: bk.id }, auth(g1));
      assert.equal((await (await H.post('/rt/ads/click', { b: bk.id }, auth(g2))).json()).n, 1);
      assert.equal((await (await H.post('/rt/ads/seen', { b: [bk.id, bk2.id, 'nope'] }, auth(g1))).json()).n, 1); // bk2 starts tomorrow
      clock.add(864e5); // the next KST day
      await H.post('/rt/ads/click', { b: bk.id }, auth(g1));
      await H.post('/rt/ads/seen', { b: [bk.id, bk2.id] }, auth(g2));
      // the report behind the token: numbers per day, no personal data
      const rep = await H.get('/rt/ads/report/' + bk.tok);
      assert.equal(rep.status, 200); assert.match(rep.headers.get('content-type'), /text\/html/); assert.equal(rep.headers.get('x-robots-tag'), 'noindex');
      const html = await rep.text();
      assert.match(html, /광고 리포트/); assert.match(html, /광장이 센 수/); assert.match(html, /보장된 노출이 아니에요/);
      const cells = (...a) => a.map((x) => '<td>' + x + '</td>').join(''); // day, visitors, clicks (all, linked, guests), seen (all, linked, guests)
      assert.ok(html.includes(cells(start, 0, 2, 0, 2, 1, 0, 1)), 'guests only');
      assert.ok(html.includes(cells(end, 0, 1, 0, 1, 1, 0, 1)));
      for (const secret of ['owner@shop.co.kr', '꽃집 하루<', '010-1234-5678', 'guest:', id]) assert.equal(html.includes(secret), false, secret);
      assert.equal((await H.get('/rt/ads/report/' + bk.tok.slice(0, 31) + (bk.tok.endsWith('0') ? '1' : '0'))).status, 404); // a different last digit
      assert.equal((await H.get('/rt/ads/report/' + bk.id)).status, 404);
      assert.equal((await H.get('/rt/ads/report/../admin/ads')).status, 404);
      // cancel: off the plaza at once
      assert.equal((await H.admin('/rt/admin/ads/cancel', { id: bk.id })).status, 200);
      assert.equal((await H.admin('/rt/admin/ads/cancel', { id: bk.id })).status, 400);
      const w2 = await (await H.get('/rt/world')).json();
      assert.deepEqual(w2.ads.list.map((x) => x.id), [bk2.id]);
      // the cancelled booking's screen is free again
      assert.equal((await H.admin('/rt/admin/ads/book', { rq: id, screen: 'AD_1', start: day(Date.now(), 0), end: day(Date.now(), 1) })).status, 200);
    } finally { done(); }
  });
  it('ADS_ON off: the scheduled bookings still go out in /rt/world; with nothing booked the key is left out', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv({ ADS_ON: '1' }), H = harness(env), t0 = Date.now();
      adsWorldDrop(); // another test's copy of the bookings (the isolate's 5 min memo)
      const w0 = await (await H.get('/rt/world')).json();
      assert.deepEqual(w0.ads, { on: 1, list: [] });
      const id = (await (await H.post('/rt/ads/request', FORM(t0))).json()).id;
      await H.admin('/rt/admin/ads/edit', { id, approve: true });
      await H.admin('/rt/admin/ads/book', { rq: id, screen: 'AD_2', start: day(t0, 0), end: day(t0, 0) });
      env.ADS_ON = '0'; clock.add(301000); // past the isolate's world (15 s) and ad (5 min) copies
      const w1 = await (await H.get('/rt/world')).json();
      assert.equal(w1.ads.on, 0);
      assert.equal(w1.ads.list.length, 1); // the operator's booking still shows
      assert.equal(w1.ads.list[0].s, 'AD_2');
      // off and nothing booked (the booking is over): the key is left out
      clock.add(2 * 864e5);
      const w2 = await (await H.get('/rt/world')).json();
      assert.equal('ads' in w2, false);
      assert.equal((await H.get('/rt/ads/stats').then((r) => r.json())).on, false);
    } finally { done(); }
  });
  it('the report page escapes the creative and says what the numbers are', () => {
    const html = reportHtml({ p: 'cheer', s: 'AD_4', start: '2020-01-01', end: '2020-01-02', st: 'live', l: ['<img src=x>', '', ''], e: '🎂', u: 'https://shop.co.kr/a?b=<x>', days: [] }, []);
    assert.equal(html.includes('<img'), false);
    assert.match(html, /&lt;img src=x&gt;/);
    assert.match(html, /사람이나 기기 수가 아니라 계정 수/);
  });
});

describe('wiring and copy', () => {
  it('worker.js: one import, the dispatch beside /rt/sponsor, one Meter block before profilePut, the world fold', () => {
    const w = read('worker.js');
    assert.match(w, /^import \{ adsApi, adsDb, adsWorld \} from '\.\/adsrv\.js';$/m);
    const sponsor = w.indexOf("if (u.pathname === '/rt/sponsor'"), ads = w.indexOf("if (u.pathname.startsWith('/rt/ads/')"), admin = w.indexOf("u.pathname.startsWith('/rt/admin/')) return photos(");
    assert.ok(sponsor > 0 && ads > sponsor && ads - sponsor < 200 && admin > ads, 'the ad routes go before the /rt/admin/ catch-all');
    assert.ok(w.indexOf('  adsI() {') < w.indexOf('  profilePut(uid, av, equip, chose) {') && w.indexOf('  profilePut(uid, av, equip, chose) {') - w.indexOf('  adsTal(d0, d1)') < 200);
    assert.match(w, /Promise\.resolve\(\)\.then\(\(\) => adsWorld\(env, \{ lvlNow \}\)\)\.catch\(\(\) => null\)/);
    assert.match(w, /if \(ads\) world\.ads = ads;/);
    assert.equal(/\bcrons?\b|scheduled\s*\(|PLAN/.test(read('adsrv.js').replace(/\/\/.*$/gm, '')), false); // no cron: the world read and the requests do the work
  });
  it('the plaza: the world hands /rt/world\'s ads to the screens, a tap opens the card, the link opens in the tap and the click is counted', () => {
    const m = read('main.js'), w = read('timesSquare3d.js'), ui = read('ui.js');
    assert.match(m, /world\.setAds\?\.\(paidAds\(remote\.ads, net\.payOn\)\);/); // the house ad only with PAY_ON (overlay.js paidAds)
    assert.match(m, /else if \(kind === 'adscreen'\) ui\.adCard\?\.\(/);
    assert.match(m, /window\.open\(ad\.u, '_blank', 'noopener,noreferrer'\);[\s\S]{0,140}net\._plazaPost\('\/rt\/ads\/click', \{ b: ad\.id \}\)/);
    assert.match(w, /else if \(info\.kind === 'adscreen'\) opts\.onInteract\?\.\('adscreen', info\.id,/);
    assert.match(ui, /h\('span', \{ class: 'adtag', text: '광고' \}\)/);
    assert.match(ui, /adCard: showAdCard,/);
  });
  it('the /ads page: served (not hidden by .assetsignore), one module under the build id, the form posts to /rt/ads/request with a honeypot and the consent box', () => {
    const html = read('ads.html'), js = read('adspage.js'), ignore = read('.assetsignore');
    assert.match(html, /<script type="module" src="\.\/adspage\.js\?v=\d{12}"><\/script>/);
    for (const f of ['ads.html', 'adspage.js', 'admin-ads.js', 'adsale.js']) assert.equal(ignore.split('\n').includes(f), false, f);
    assert.equal(/^\*\.html$|^\*\*\/\*\.html$|^\*\.js$/m.test(ignore), false);
    assert.match(js, /fetch\('\/rt\/ads\/request'/);
    assert.match(js, /input\('website'/);
    assert.match(js, /개인정보 수집·이용 동의 \(필수\)/);
    assert.match(js, /보유 기간: 문의일로부터 1년/);
    assert.match(js, /준비 중이에요/);
    assert.match(js, /노출 보장/);
    assert.match(js, /카드 결제는 받지 않아요/);
    for (const f of [js, read('adsrv.js'), read('adsale.js'), read('admin-ads.js')]) assert.equal(/stripe|tosspayments|iamport|portone|kakaopay|card_?number|카드 ?번호|pg\.js/i.test(f), false); // no card payment code
    assert.match(read('admin.html'), /^<script type="module" src="\.\/admin-ads\.js\?v=\d{12}"><\/script>$/m);
  });
  it('the terms and the privacy policy carry the ad sections, before 시행일', () => {
    const t = policyDoc('terms'), p = policyDoc('privacy');
    const heads = ['광고 서비스', '광고 기준', '광고 취소와 환불'], at = heads.map((h) => t.sections.findIndex((s) => s.h === h));
    assert.ok(at.every((i) => i > 0), String(at)); assert.deepEqual(at, [at[0], at[0] + 1, at[0] + 2]); // in this order, together
    const ad = { p: at.map((i) => t.sections[i].p).join(' ') }, pr = p.sections.find((s) => s.h === '광고 문의');
    assert.ok(pr);
    assert.equal(t.sections.at(-1).h, '시행일'); assert.equal(p.sections.at(-1).h, '시행일'); assert.equal(at[2], t.sections.length - 2);
    for (const s of ['광고 전용 화면', '거절하거나', '보장하지 않', '돌려드립니다', '날수만큼 나누어', '‘광고’ 표시', '전광판·명당·응원 포인트를 얻지 않고', '광장이 센 수']) assert.ok(ad.p.includes(s), s);
    for (const s of ['회사 또는 이름', '이메일', '1년 뒤 지웁니다', '되돌릴 수 없는 값', '날짜별 합계']) assert.ok(pr.p.includes(s), s);
    for (const s of t.sections.concat(p.sections)) assert.equal(/[<>]/.test(s.p), false, s.h);
  });
  it('the ad terms after the 2026-11-22 review: contract on payment, refunds by law, ad rules, minors; privacy keeps the legal records apart', () => {
    const t = policyDoc('terms'), sec = (h) => t.sections.find((s) => s.h === h)?.p || '';
    const sale = sec('광고 서비스'), rules = sec('광고 기준'), refund = sec('광고 취소와 환불');
    assert.match(sale, /입금하고 운영자가 그 입금을 확인하면 계약이 이루어집니다/); assert.match(sale, /신청서를 보내는 것만으로는 계약이 이루어지지 않고 돈이 나가지 않습니다/);
    assert.match(sale, /부가가치세 포함 여부/); assert.match(sale, /카드 결제는 받지 않습니다/);
    assert.equal(/계좌이체 또는 세금계산서/.test(sale + rules + refund), false); // 세금계산서 is a tax invoice, not a way to pay
    assert.match(rules, /청소년에게 해로운 광고/); assert.match(rules, /그 이유를 광고주에게 알리고 광고를 내릴 수 있습니다/); assert.match(rules, /운영자의 고의나 과실로 생긴 손해는 운영자가 책임집니다/);
    assert.match(refund, /아직 송출되지 않은 날을 그 전날까지 취소할 수 있고/); assert.match(refund, /3영업일 안에/); assert.match(refund, /연 15%의 지연이자/);
    assert.match(refund, /만 19세 미만인 사람이 법정대리인의 동의 없이/); assert.match(refund, /광고주에게 유리한 쪽을 따릅니다/);
    assert.equal(/따로 정한 내용에 따릅니다/.test(refund), false); // the old open-ended carve-out is gone
    const pr = policyDoc('privacy').sections.find((s) => s.h === '광고 문의').p;
    assert.match(pr, /광고나 홍보 메일을 보내는 데 쓰지 않습니다/); assert.match(pr, /기록은 5년/); assert.match(pr, /3년\(전자상거래법\)/); assert.match(pr, /5년\(국세기본법\)/); assert.match(pr, /만 14세 미만은 광고를 신청할 수 없습니다/);
    assert.match(t.sections.find((s) => s.h === '응원 포인트').p, /돈이나 다른 재산을 받고 사고팔거나 빌려줄 수 없고/); // 코인 became 응원 포인트 on 2026-11-23
    assert.match(t.sections.find((s) => s.h === '운영자').p, /호스팅 서비스는 Cloudflare, Inc\.가 제공합니다/);
  });
  it('/ads shows the refund rules, minors and the seller details before a request, and never calls an invoice a way to pay', () => {
    const js = read('adspage.js');
    assert.match(js, /^import \{ operatorLine, operatorOf \} from '\.\/opsrules\.js';$/m); // bundled by the Worker too: no query
    assert.match(js, /h\('h2', \{ text: '취소와 환불' \}\), refundCard\(\),\s*h\('h2', \{ text: '광고 신청' \}\), form\(\)/);
    assert.match(js, /만 19세 미만이 법정대리인의 동의 없이 산 광고는 본인이나 법정대리인이 취소할 수 있어요/);
    assert.match(js, /만 14세 미만은 신청할 수 없어요/);
    assert.match(js, /function operatorFooter\(cfg\)/); assert.match(js, /호스팅 Cloudflare, Inc\./); assert.match(js, /open\(d, cfg\)/);
    assert.match(js, /가상 타임스퀘어의 광고 화면에 광고하세요/);
    assert.equal(/계좌이체 또는 세금계산서/.test(js), false);
  });
  it('the 9 pm sponsor is said to take all five screens for 60 seconds at 21:00 KST on its days, in the products and the terms', () => {
    const ad = policyDoc('terms').sections.find((s) => s.h === '광고 서비스').p; // the products and the 9 pm minute stay in the first ad section
    assert.ok(ad.includes('한국 시간 21시 정각부터 60초 동안 광고 화면 다섯 곳 모두를 차지'), ad);
    assert.ok(ad.includes('링크 클릭과 화면 봄도 세지 않습니다'));
    assert.match(S.AD_PRODUCTS.sponsor9.desc, /밤 9시 정각부터 60초 동안 광고 화면 다섯 곳 모두/);
    for (const k of ['screen', 'cheer']) assert.match(S.AD_PRODUCTS[k].desc, /밤 9시 스폰서가 있는 날은 21시부터 60초 동안 스폰서 광고가 대신 나가요/, k);
    assert.ok(policyDoc('privacy').sections.find((s) => s.h === '광고 문의').p.includes('연결된 계정과 게스트를 나눈 수'));
  });
});

// ---- the fixes after the fifth-round review ---------------------------------------------------------------------------------------
function spyDo(env) {
  const log = [];
  for (const ns of [env.METER, env.ROOM]) { const real = ns.get; ns.get = (name) => { const s = real(name); return new Proxy(s, { get: (t, k) => typeof t[k] === 'function' ? (...a) => { if (name !== 'day') log.push(name + '.' + String(k)); return t[k](...a); } : t[k] }); }; }
  return log;
}
async function userToken(state, clock, sub) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  state.jwks = [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'adsale-kid' }];
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), head = enc({ alg: 'ES256', kid: 'adsale-kid' });
  const claims = enc({ sub, exp: Math.floor(clock.now() / 1000) + 36000, iss: 'https://yxddhpacuyaffaoutxjn.supabase.co/auth/v1', aud: 'authenticated' });
  return head + '.' + claims + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(head + '.' + claims))).toString('base64url');
}
const randTok = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
// A request approved and booked by the admin: the booking.
async function booked(H, t0, { product = 'screen', screen = 'AD_1', start = day(t0, 0), end = day(t0, 1), ip = '1.1.1.1' } = {}) {
  const id = (await (await H.post('/rt/ads/request', FORM(t0, { product }), { 'cf-connecting-ip': ip })).json()).id;
  await H.admin('/rt/admin/ads/edit', { id, approve: true });
  return (await (await H.admin('/rt/admin/ads/book', { rq: id, product, screen, start, end })).json()).booking;
}

describe('review fixes: limits before DO calls, guest and linked counts, the 9 pm minute, the report cache, the hard level', { concurrency: false }, () => {
  it('a request: a per-network count before any DO call, 5 a day per network (IPv6 by /64), 40 an hour in all (then the next hour opens)', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv({ ADS_ON: '1' }), H = harness(env), log = spyDo(env), asks = () => log.filter((x) => x === 'ads.adsAsk').length;
      let last = null;
      for (let i = 0; i < 21; i++) last = await H.post('/rt/ads/request', FORM(Date.now()), { 'cf-connecting-ip': '5.5.5.5' });
      assert.equal(last.status, 429); assert.deepEqual(await last.json(), { ok: false, code: 'rate', error: ADS_ERR.fast });
      assert.equal(asks(), 20, 'the 21st in a minute never reached the store');
      clock.add(61000);
      // one /64 is one network: five a day across its addresses
      for (let i = 1; i <= 5; i++) assert.equal((await H.post('/rt/ads/request', FORM(Date.now()), { 'cf-connecting-ip': '2001:db8:5:1::' + i })).status, 200, String(i));
      const v6 = await H.post('/rt/ads/request', FORM(Date.now()), { 'cf-connecting-ip': '2001:db8:5:1:abcd:1:2:3' });
      assert.equal(v6.status, 429); assert.equal((await v6.json()).code, 'rate');
      assert.equal((await H.post('/rt/ads/request', FORM(Date.now()), { 'cf-connecting-ip': '2001:db8:5:2::1' })).status, 200, 'the next /64');
      // 5 (5.5.5.5) + 5 + 1 so far this hour; 29 more networks make 40, the 41st waits for the next hour
      for (let i = 0; i < 29; i++) assert.equal((await H.post('/rt/ads/request', FORM(Date.now()), { 'cf-connecting-ip': '10.0.1.' + i })).status, 200, String(i));
      const full = await H.post('/rt/ads/request', FORM(Date.now()), { 'cf-connecting-ip': '10.0.2.1' });
      assert.equal(full.status, 429); assert.deepEqual(await full.json(), { ok: false, code: 'hour', error: ADS_ERR.hour }); assert.equal(full.headers.get('retry-after'), '3600');
      clock.add(3600e3);
      assert.equal((await H.post('/rt/ads/request', FORM(Date.now()), { 'cf-connecting-ip': '10.0.2.1' })).status, 200, 'a flood blocks an hour, not the day');
      assert.equal(S.ADS.perHour, 40); assert.equal('perDay' in S.ADS, false);
    } finally { done(); }
  });

  it('clicks and sightings: limited per network and per account before the store, unknown or idle ids make no DO call, linked accounts apart from guests', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv({ ADS_ON: '1' }), H = harness(env), t0 = Date.now(), auth = (t) => ({ authorization: 'Bearer ' + t });
      adsWorldDrop();
      const bk = await booked(H, t0);
      const g = await H.guest(), u = await userToken(state, clock, 'aaaaaaaa-0000-4000-8000-00000000000a');
      await H.get('/rt/world'); // this isolate learns the bookings
      const log = spyDo(env), hits = () => log.filter((x) => x === 'ads.adsHit').length;
      const r0 = await H.post('/rt/ads/click', { b: 'abcdefabcdef' }, auth(g));
      assert.equal(r0.status, 204); assert.equal(hits(), 0, 'an id no running booking has: no DO call');
      assert.equal((await (await H.post('/rt/ads/click', { b: bk.id }, auth(g))).json()).n, 1);
      assert.equal((await (await H.post('/rt/ads/click', { b: bk.id }, auth(u))).json()).n, 1);
      assert.equal((await (await H.post('/rt/ads/seen', { b: [bk.id] }, auth(u))).json()).n, 1);
      assert.equal((await (await H.post('/rt/ads/seen', { b: [bk.id] }, auth(g))).json()).n, 1);
      assert.equal(hits(), 4);
      const row = env.meter('ads').sql.db.prepare('select c, v from ad_dayu where bk = ?').get(bk.id);
      assert.deepEqual({ ...row }, { c: 1, v: 1 }, 'the linked account, apart');
      const b = (await (await H.admin('/rt/admin/ads')).json()).bookings.find((x) => x.id === bk.id);
      assert.deepEqual([b.c, b.cu, b.v, b.vu], [2, 1, 2, 1]);
      const html = await (await H.get('/rt/ads/report/' + bk.tok)).text();
      assert.ok(html.includes('<td>' + day(t0, 0) + '</td><td>0</td><td>2</td><td>1</td><td>1</td><td>2</td><td>1</td><td>1</td>'));
      assert.match(html, /계정 1 · 게스트 1/); assert.match(html, /게스트 숫자는 계정 숫자보다 약한/);
      // per account: 10 a minute (g has sent 3), then 429 before the store
      for (let i = 0; i < 7; i++) assert.notEqual((await H.post('/rt/ads/seen', { b: [bk.id] }, auth(g))).status, 429, String(i));
      const n0 = hits(), over = await H.post('/rt/ads/seen', { b: [bk.id] }, auth(g));
      assert.equal(over.status, 429); assert.equal(hits(), n0);
      // per network: 60 a minute, whichever accounts send them
      clock.add(61000);
      const many = []; for (let i = 0; i < 7; i++) many.push(await H.guest());
      let last = 0, sent = 0;
      for (const t of many) for (let i = 0; i < 9 && sent < 61; i++, sent++) last = (await H.post('/rt/ads/click', { b: 'abcdefabcdef' }, { ...auth(t), 'cf-connecting-ip': '6.6.6.6' })).status;
      assert.equal(last, 429, 'the 61st from one network in a minute');
      assert.match(read('adsrv.js'), /opsRate\(env, req, 'adhit', ADS\.hitIpMin, env\.EVENT_RL\)/);
    } finally { done(); }
  });

  it('a day booking reported in the sponsor minute is handed back in keep, and counted when it comes again after it', () => {
    const src = readFileSync(new URL('../adsrv.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    assert.match(src, /if \(b\.p === 'sponsor9' \? !late : preempt\) \{ if \(b\.p !== 'sponsor9'\) keep\.push\(b\.id\); continue; \}/);
    assert.match(src, /return \{ ok: true, n, keep \};/);
    assert.match(src, /\.\.\.\(Array\.isArray\(r\?\.keep\) && r\.keep\.length \? \{ keep: r\.keep\.map\(String\) \} : \{\}\)/);
  });
  it('the 9 pm minute: a sponsor counts from 21:00:00 until 21:03:00 KST (late reports too); the day booking it covers is not counted in its minute', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv({ ADS_ON: '1' }), H = harness(env), t0 = Date.now(), auth = (t) => ({ authorization: 'Bearer ' + t });
      adsWorldDrop();
      const sp = await booked(H, t0, { product: 'sponsor9', screen: '*', start: day(t0, 0), end: day(t0, 0) });
      const sc = await booked(H, t0, { screen: 'AD_2', start: day(t0, 0), end: day(t0, 0), ip: '1.1.1.2' });
      const nine = S.dayStart(day(t0, 0)) + 21 * 3600e3, g = [await H.guest(), await H.guest(), await H.guest(), await H.guest()];
      const hit = async (p, id, t) => { const r = await H.post(p, { b: [id] }, auth(t)); return r.status === 204 ? 'none' : (await r.json()).n; };
      clock.to(nine - 60000); await H.get('/rt/world');
      assert.equal(await hit('/rt/ads/click', sp.id, g[0]), 0, '20:59: the sponsor is not on yet');
      clock.to(nine + 30000);
      assert.equal(await hit('/rt/ads/click', sc.id, g[0]), 0, '21:00:30: the day booking is off the screens');
      assert.equal(await hit('/rt/ads/click', sp.id, g[0]), 1);
      clock.to(nine + 150000);
      assert.equal(await hit('/rt/ads/seen', sp.id, g[1]), 1, '21:02:30: a late "seen" report still lands');
      assert.equal(await hit('/rt/ads/seen', sc.id, g[1]), 1, 'after the minute the day booking counts again');
      clock.to(nine + 180000);
      assert.equal(await hit('/rt/ads/seen', sp.id, g[2]), 0, '21:03:00: too late');
      // the minute of a cancelled sponsor does not take the screen
      assert.equal((await H.admin('/rt/admin/ads/cancel', { id: sp.id })).status, 200);
      clock.to(S.dayStart(day(t0, 0)) + 21 * 3600e3 + 20000);
      assert.equal(await hit('/rt/ads/click', sc.id, g[3]), 1, 'no live sponsor: the day booking counts in that minute');
      // the client marks ids as reported only once a report went through, and tries a failed one once more
      const m = read('main.js');
      // only ids the Worker counted (or had already counted) are marked; a 204 or the ids in `keep` go again next round
      assert.match(m, /try \{ const r = await net\._plazaPost\('\/rt\/ads\/seen', \{ b: ids \}\); if \(typeof r\?\.n !== 'number'\) return; const keep = new Set\(Array\.isArray\(r\.keep\) \? r\.keep : \[\]\); for \(const id of ids\) if \(!keep\.has\(id\)\) adSent\.add\(id\); \}/);
      assert.match(m, /catch \{ if \(retry\) \{ await sleep\(20000\); await sendAdSeen\(ids\.filter\(\(id\) => !adSent\.has\(id\)\), false\); \} \}/);
      assert.doesNotMatch(m, /for \(const id of ids\) adSent\.add\(id\);\n\s*net\._plazaPost/);
    } finally { done(); }
  });

  it('the report page: one read per token per minute per isolate, a per-network limit before the store, at hard a static page with no DO call', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv({ ADS_ON: '1' }), H = harness(env), t0 = Date.now(), ip = { 'cf-connecting-ip': '3.3.3.3' };
      const bk = await booked(H, t0);
      const log = spyDo(env), reads = () => log.filter((x) => x === 'ads.adsRead' || x === 'acct.adsTal').length;
      assert.equal((await H.get('/rt/ads/report/' + bk.tok, ip)).status, 200); assert.equal(reads(), 2);
      assert.equal((await H.get('/rt/ads/report/' + bk.tok, ip)).status, 200); assert.equal(reads(), 2, 'a refresh within a minute costs nothing');
      const junk = randTok();
      assert.equal((await H.get('/rt/ads/report/' + junk, ip)).status, 404); assert.equal((await H.get('/rt/ads/report/' + junk, ip)).status, 404);
      assert.equal(reads(), 3, 'an unknown token is remembered too');
      for (let i = 0; i < 18; i++) await H.get('/rt/ads/report/' + randTok(), ip); // 19 reads of the store from 3.3.3.3 this minute... plus the first = 20
      const n = reads(), over = await H.get('/rt/ads/report/' + randTok(), ip);
      assert.equal(over.status, 429); assert.equal(reads(), n); assert.match(await over.text(), /잠시 뒤에 다시 열어 주세요/);
      assert.equal(over.headers.get('cache-control'), 'no-store');
      assert.equal((await H.get('/rt/ads/report/' + bk.tok, { 'cf-connecting-ip': '3.3.3.4' })).status, 200, 'cached: no limit spent');
      // hard: no DO call; a token read before still shows, a new one gets the static page
      env.BUDGET_REQ_DAY = '1'; clock.add(61000);
      const before = reads();
      const busy = await H.get('/rt/ads/report/' + randTok(), { 'cf-connecting-ip': '3.3.3.5' });
      assert.equal(busy.status, 503); assert.match(await busy.text(), /잠시 뒤에 다시/);
      const old = await H.get('/rt/ads/report/' + bk.tok, { 'cf-connecting-ip': '3.3.3.5' });
      assert.equal(old.status, 200); assert.match(await old.text(), /광고 리포트/);
      assert.equal(reads(), before, 'no DO call at hard');
      delete env.BUDGET_REQ_DAY; clock.add(61000);
      assert.equal((await H.get('/rt/ads/report/' + bk.tok, { 'cf-connecting-ip': '3.3.3.6' })).status, 200); assert.equal(reads(), before + 2, 'read again after the minute');
      assert.ok(S.ADS.reportKeep <= 500 && S.ADS.reportTtl === 60000);
    } finally { done(); }
  });

  it('the ad part of /rt/world: at hard with no copy no DO call and a 5-minute pause; a failed read pauses a minute, not every world read', async () => {
    const { clock, done } = setup();
    try {
      let lvl = 2, fail = false; const calls = [];
      const env = { ADS_ON: '1', METER: { idFromName: (n) => n, get: () => ({ adsNow: async () => { calls.push(Date.now()); if (fail) throw new Error('down'); return []; } }) } }, k = { lvlNow: async () => lvl };
      adsWorldDrop();
      assert.deepEqual(await adsWorld(env, k), { on: 1, list: [] }); assert.equal(calls.length, 0);
      assert.equal(await adsWorld({ ...env, ADS_ON: '0' }, k), null);
      lvl = 0; await adsWorld(env, k); assert.equal(calls.length, 0, 'the pause holds after the level drops');
      clock.add(300001); await adsWorld(env, k); assert.equal(calls.length, 1);
      adsWorldDrop(); fail = true;
      assert.deepEqual(await adsWorld(env, k), { on: 1, list: [] }); assert.equal(calls.length, 2);
      await adsWorld(env, k); clock.add(30000); await adsWorld(env, k); assert.equal(calls.length, 2, 'no retry on every world read');
      clock.add(31000); fail = false; await adsWorld(env, k); assert.equal(calls.length, 3, 'tried again after a minute');
    } finally { done(); }
  });

  it('the store prunes requests older than a year on the 5-minute world read, with no new request and no alarm', () => {
    const sql = sqliteStorage(), now = Date.parse('2030-03-01T03:00:00Z');
    adsDb.tables(sql);
    sql.exec("insert into ad_req(id, at, ip, st, j) values('old', ?, '', 'new', '{}')", now - 366 * 864e5);
    sql.exec("insert into ad_req(id, at, ip, st, j) values('new', ?, '', 'new', '{}')", now - 10 * 864e5);
    adsDb.now(sql, now);
    assert.deepEqual(sql.db.prepare('select id from ad_req').all().map((r) => r.id), ['new']);
  });
});
