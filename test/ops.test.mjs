// 운영 장치 (launch plan 상1–상5): error reports, 문의하기, operator details, maintenance, /rt/health.
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
const ops = await import('../ops.js');
const R = await import('../opsrules.js');
const { createReporter, reportOf, topFrame, installErrlog } = await import('../errlog.js');
const legal = await import('../legal.js');
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

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
    storage: { sql, async getAlarm() { return null; }, async setAlarm() {}, transactionSync(fn) { return fn(); } },
    setWebSocketAutoResponse() {}, getWebSockets() { return []; }, getWebSocketAutoResponseTimestamp() { return new Date(Date.now()); }, acceptWebSocket() {},
  };
}
const stub = (obj) => new Proxy(obj, { get: (t, k) => k === 'fetch' ? (req) => t.fetch(req) : typeof t[k] === 'function' ? async (...a) => structuredClone(await t[k](...structuredClone(a))) : t[k] });
const ADMIN = 'admin-test-key-123';
function makeEnv(extra = {}) {
  const meters = new Map(), rooms = new Map();
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ADMIN_KEY: ADMIN, ASSETS: { fetch: () => new Response('asset', { status: 200 }) }, ...extra };
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
function harness(env) {
  const waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (path, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + path, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const guest = async () => { const t = (await (await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).token; return { token: t, id: 'guest:' + JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).s }; };
  const post = (path, body, { token, ip = '1.1.1.1', admin, raw } = {}) => call(path, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(token ? { authorization: 'Bearer ' + token } : {}), ...(admin ? { 'x-admin-key': admin } : {}) }, body: raw ?? JSON.stringify(body) });
  const get = (path, { token, ip = '1.1.1.1', admin } = {}) => call(path, { headers: { 'cf-connecting-ip': ip, ...(token ? { authorization: 'Bearer ' + token } : {}), ...(admin ? { 'x-admin-key': admin } : {}) } });
  return { call, guest, post, get };
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
let clockBase = Date.parse('2028-01-10T03:00:00Z');
function setup() {
  clockBase += 10 * 864e5; let t = clockBase; const origNow = Date.now, origFetch = globalThis.fetch, state = { calls: [], db: 'ok' };
  const clock = { add: (ms) => { t += ms; }, now: () => t };
  Date.now = () => t;
  globalThis.fetch = async (url) => {
    const u = String(url); state.calls.push(u);
    if (u.includes('/rest/v1/billboards')) { if (state.db === 'down') throw new Error('offline'); if (state.db === 'error') return new Response('no', { status: 500 }); if (state.db === 'slow') t += 1500; return json([{ slot_id: 'MAIN_TOP' }]); }
    if (u.includes('/rest/v1/plots') || u.includes('/rest/v1/wallets')) return json([]);
    if (u.includes('/rpc/')) return json({ ok: true });
    return new Response('missing', { status: 404 });
  };
  globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  ops.opsReset();
  return { clock, state, done: () => { Date.now = origNow; globalThis.fetch = origFetch; ops.opsReset(); } };
}
const utcDay = () => new Date().toISOString().slice(0, 10);
const setUsed = (env, n) => env.meter('day').sql.db.prepare('insert into d(day, n) values(?, ?) on conflict(day) do update set n = excluded.n').run(utcDay(), n);
const opsRows = (env, table) => env.meter('ops').sql.db.prepare('select * from ' + table).all();
const ERR_BODY = { m: 'TypeError: x is undefined', s: 'https://studio.wishboard.workers.dev/ui.js?v=202611221134:12:34', k: 'at f (https://studio.wishboard.workers.dev/ui.js?v=202611221134:12:34)\nat g (https://studio.wishboard.workers.dev/main.js?v=202611221134:5:6)', b: '202611221134', p: '/', q: 'low', t: 1, ua: 'chrome/android' };

describe('opsrules: what a report and an inquiry may carry', () => {
  it('scrubs origins, queries, hashes, e-mails, tokens and long numbers', () => {
    const s = R.scrub('fetch https://x.example/rt/w/abc?inv=QWERTY&t=1#frag failed for kim@example.com with g1.eyJzIjoiZyJ9.c2lnbmF0dXJl and 01012345678');
    assert.doesNotMatch(s, /x\.example|inv=|QWERTY|#frag|kim@|example\.com|g1\.eyJ|01012345678/);
    assert.match(s, /<email>/); assert.match(s, /<token>/); assert.match(s, /<n>/);
    assert.equal(R.srcOf('https://studio.wishboard.workers.dev/ui.js?v=202611221134', 12, 34), 'ui.js:12:34');
    assert.equal(R.srcOf('https://a.b/c/main.js?v=1:5:6'), 'c/main.js:5:6');
    assert.equal(R.pathOf('/rt/w/a1b2c3d4e5?x=1'), '/rt/w/:id');
    assert.equal(R.pathOf('/?wish=abc'), '/');
  });
  it('errRow keeps only the known fields, capped', () => {
    const r = R.errRow({ ...ERR_BODY, m: 'x'.repeat(900), nick: '홍길동', actor: 'guest:abc', email: 'a@b.cd', k: Array.from({ length: 12 }, (_, i) => `at f${i} (https://h/x.js?v=1:${i + 1}:1)`).join('\n') });
    assert.deepEqual(Object.keys(r).sort(), ['build', 'kind', 'msg', 'page', 'src', 'stack', 'tier', 'touch', 'ua']);
    assert.equal(Array.from(r.msg).length, R.ERR.msg);
    assert.equal(r.stack.split('\n').length, 5); assert.ok(r.stack.length <= R.ERR.stack); assert.doesNotMatch(r.stack, /\?v=|https?:/);
    assert.equal(R.errRow({ m: '   ' }), null); assert.equal(R.errRow(null), null);
    const odd = R.errRow({ m: 'x', b: '../../etc', q: 'ultra', ua: 'Mozilla/5.0 (X11)', t: 'yes' });
    assert.equal(odd.build, ''); assert.equal(odd.tier, ''); assert.equal(odd.ua, ''); assert.equal(odd.touch, 0);
  });
  it('uaFamily names a family and a platform, never a version', () => {
    assert.equal(R.uaFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), 'safari/ios');
    assert.equal(R.uaFamily('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'), 'chrome/android');
    assert.equal(R.uaFamily('Mozilla/5.0 (Linux; Android 14) KAKAOTALK 10.4.5'), 'kakao/android');
    assert.equal(R.uaFamily('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120'), 'edge/windows');
  });
  it('supportFault: kind, 10–1000 characters, an optional e-mail that needs the consent', () => {
    const ok = { kind: 'bug', text: '화면이 멈춰요. 입장하기를 눌러도 안 돼요.' };
    assert.equal(R.supportFault(ok), '');
    assert.equal(R.supportFault({ ...ok, kind: 'spam' }), 'kind');
    assert.equal(R.supportFault({ ...ok, text: '짧아요' }), 'short');
    assert.equal(R.supportFault({ ...ok, text: '가'.repeat(1001) }), 'long');
    assert.equal(R.supportFault({ ...ok, text: '가'.repeat(1000) }), '');
    assert.equal(R.supportFault({ ...ok, email: 'not-an-email' }), 'email');
    assert.equal(R.supportFault({ ...ok, email: 'player@example.com' }), 'agree');
    assert.equal(R.supportFault({ ...ok, email: 'player@example.com', agree: true }), '');
    for (const [id] of R.SUPPORT_KINDS) assert.equal(R.supportFault({ ...ok, kind: id }), '');
    assert.deepEqual(R.SUPPORT_KINDS.map(([, l]) => l), ['버그', '계정·코인', '신고', '광고·제휴', '기타']);
  });
  it('operatorOf: known fields only, one line each, capped; bad or empty input is nothing', () => {
    const op = R.operatorOf(JSON.stringify({ name: '  테스트상점\n', ceo: '가나다', biz: '000-00-00000', mail: '제0000-가상-0000호', addr: '가상시 '.repeat(50), email: 'ops@example.test', phone: '000-0000-0000', secret: 'x' }));
    assert.deepEqual(Object.keys(op), ['name', 'ceo', 'biz', 'mail', 'addr', 'email', 'phone']);
    assert.equal(op.name, '테스트상점'); assert.ok(Array.from(op.addr).length <= 120);
    assert.match(R.operatorLine(op), /^상호 테스트상점 · 대표 가나다 · 사업자등록번호 000-00-00000 · 통신판매업 신고번호/);
    for (const bad of [undefined, '', '   ', '{nope', '[1,2]', '"str"', 'null', '{}', JSON.stringify({ other: 1 }), JSON.stringify({ name: '   ' })]) assert.equal(R.operatorOf(bad), null, String(bad));
    assert.equal(R.operatorOf(JSON.stringify({ name: 'A', email: 'nope' })).email, undefined);
  });
  it('maintOf and maintLines: off is null; the end time reads in Korea time', () => {
    assert.equal(R.maintOf(null), null); assert.equal(R.maintOf({ on: false, msg: 'x' }), null);
    assert.deepEqual(R.maintOf({ on: true }), { msg: R.MAINT_DEFAULT, until: 0 });
    const until = Date.parse('2026-11-22T06:05:00Z'); // 15:05 KST
    assert.equal(R.kstWhen(until), '11월 22일 오후 3:05');
    assert.match(R.maintLines({ on: true, msg: '서버 교체', until }, until - 1).end, /11월 22일 오후 3:05\(한국 시간\)에 끝날 예정/);
    assert.match(R.maintLines({ on: true, until }, until + 1).end, /늦어지고/);
    assert.match(R.maintLines({ on: true }).end, /끝나는 대로/);
  });
});

describe('errlog.js: the browser reporter', () => {
  it('sends at most five reports a page load, the same message once, with no personal data', () => {
    const sent = [], rep = createReporter({ send: (j) => sent.push(JSON.parse(j)), page: () => ({ path: '/?wish=abc&nick=홍길동', touch: true, ua: 'safari/ios', build: '202611221134' }) });
    rep.ctx({ tier: 'low' });
    assert.equal(rep.report({ message: 'TypeError: a is null', file: 'https://studio.wishboard.workers.dev/ui.js?v=202611221134', line: 3, col: 9, stack: 'at f (https://studio.wishboard.workers.dev/ui.js?v=202611221134:3:9)' }), true);
    assert.equal(rep.report({ message: 'TypeError: a is null', file: 'https://studio.wishboard.workers.dev/ui.js?v=202611221134', line: 3, col: 9 }), false, 'same message, same place: once');
    for (let i = 0; i < 10; i++) rep.report({ message: 'Error ' + i, file: '/main.js', line: i + 1 });
    assert.equal(sent.length, 5);
    const r = sent[0];
    assert.deepEqual(Object.keys(r).sort(), ['b', 'k', 'm', 'p', 'q', 's', 't', 'ua']);
    assert.deepEqual({ m: r.m, s: r.s, p: r.p, q: r.q, t: r.t, ua: r.ua, b: r.b }, { m: 'TypeError: a is null', s: 'ui.js:3:9', p: '/', q: 'low', t: 1, ua: 'safari/ios', b: '202611221134' });
    assert.doesNotMatch(JSON.stringify(sent), /홍길동|wish=|nick|guest:|studio\.wishboard|\?v=/);
  });
  it('samples one in five while the budget is lean, skips noise and extensions, and never throws', () => {
    let roll = 0.5; const sent = [], rep = createReporter({ send: (j) => sent.push(j), rand: () => roll });
    rep.ctx({ lean: true });
    assert.equal(rep.report({ message: 'A', file: '/a.js', line: 1 }), false);
    roll = 0.1; assert.equal(rep.report({ message: 'B', file: '/a.js', line: 1 }), true);
    rep.ctx({ lean: false }); assert.equal(rep.report({ message: 'C', file: '/a.js', line: 1 }), true);
    for (const m of ['Script error.', 'ResizeObserver loop limit exceeded', 'Unhandled rejection: AbortError: The user aborted a request.']) assert.equal(rep.report({ message: m }), false, m);
    assert.equal(rep.report({ message: 'x', file: 'chrome-extension://abcdef/content.js', line: 1 }), false);
    assert.equal(rep.report({ message: '' }), false);
    const boom = createReporter({ send: () => { throw new Error('offline'); } });
    assert.equal(boom.report({ message: 'D', file: '/a.js' }), false);
    assert.equal(sent.length, 2);
  });
  it('finds the top frame in Chrome and Safari stacks, and installs once on a window', () => {
    assert.deepEqual(topFrame('Error: x\n    at f (https://h/ui.js?v=1:12:34)\n    at g (https://h/main.js?v=1:1:1)'), { file: 'https://h/ui.js?v=1', line: 12, col: 34 });
    assert.deepEqual(topFrame('f@https://h/ts3d/art.js?v=1:7:8'), { file: 'https://h/ts3d/art.js?v=1', line: 7, col: 8 });
    assert.equal(reportOf({ message: 'x', stack: 'f@https://h/ts3d/art.js?v=1:7:8' }).s, 'ts3d/art.js:7:8');
    const seen = [], win = { addEventListener: (k) => seen.push(k) };
    assert.equal(installErrlog(win), true); assert.equal(installErrlog(win), false);
    assert.deepEqual(seen, ['error', 'unhandledrejection']);
  });
  it('main.js imports it first, with the build query like every browser module', () => {
    const main = read('main.js'), firstImport = main.split('\n').find((l) => l.startsWith('import '));
    assert.match(firstImport, /^import \{ errlogCtx \} from '\.\/errlog\.js\?v=\d+';/);
    assert.match(read('errlog.js'), /from '\.\/opsrules\.js';/);
  });
});

describe('POST /rt/err', { concurrency: false }, () => {
  it('validates, caps the body, groups by message and place, and keeps repeats as a count', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), { post, get } = harness(env);
      assert.equal((await get('/rt/err')).status, 405);
      assert.equal((await post('/rt/err', null, { raw: JSON.stringify({ ...ERR_BODY, k: 'x'.repeat(5000) }) })).status, 413);
      assert.equal((await post('/rt/err', null, { raw: 'not json' })).status, 400);
      assert.equal((await post('/rt/err', { m: '' })).status, 400);
      const first = await post('/rt/err', ERR_BODY);
      assert.equal(first.status, 202); assert.equal((await first.json()).kept, 'kept');
      assert.equal((await (await post('/rt/err', ERR_BODY, { ip: '2.2.2.2' })).json()).kept, 'held', 'the same group within 30 s rides along later');
      clock.add(31000);
      await post('/rt/err', { ...ERR_BODY, b: '202611230900' }, { ip: '3.3.3.3' });
      await post('/rt/err', { ...ERR_BODY, s: '/main.js', k: '' }, { ip: '4.4.4.4' });
      const rows = opsRows(env, 'oerr');
      assert.equal(rows.length, 2, 'two places, two groups');
      const g = rows.find((r) => r.src === 'ui.js:12:34');
      assert.equal(g.n, 3); assert.deepEqual(JSON.parse(g.builds), ['202611221134', '202611230900']);
      assert.equal(g.kind, 'client'); assert.doesNotMatch(JSON.stringify(rows), /studio\.wishboard|\?v=|1\.1\.1\.1/);
    } finally { done(); }
  });
  it('limits per IP (isolate count and the OPS_RL binding) and keeps the newest 300 groups', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), { post } = harness(env);
      let last = 0; for (let i = 0; i < 21; i++) last = (await post('/rt/err', { ...ERR_BODY, m: 'E' + i }, { ip: '9.9.9.9' })).status;
      assert.equal(last, 429, 'the 21st report from one IP in a minute');
      clock.add(61000); assert.equal((await post('/rt/err', { ...ERR_BODY, m: 'later' }, { ip: '9.9.9.9' })).status, 202);
      const keys = []; env.OPS_RL = { async limit({ key }) { keys.push(key); return { success: false }; } };
      assert.equal((await post('/rt/err', ERR_BODY, { ip: '8.8.8.8' })).status, 429); assert.deepEqual(keys, ['err:8.8.8.8']);
      const M = env.meter('ops').do;
      for (let i = 0; i < 305; i++) { clock.add(1); M.opsErrPut({ h: 'h' + i, kind: 'client', msg: 'm' + i, src: '', n: 1, stack: '', build: '', page: '/', ua: '', tier: '', touch: 0 }); }
      const list = M.opsErrList(); assert.equal(list.length, 300); assert.equal(list[0].msg, 'm304'); assert.equal(list.some((x) => x.msg === 'm0'), false);
    } finally { done(); }
  });
  it('a full store drops the least recently seen group (not one that just came again) and counts it for the admin; a clear resets the count', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), M = env.meter('ops').do, { get, post } = harness(env);
      const put = (i) => { clock.add(1); M.opsErrPut({ h: 'h' + i, kind: 'client', msg: 'm' + i, src: '', n: 1, stack: '', build: '', page: '/', ua: '', tier: '', touch: 0 }); };
      for (let i = 0; i < 300; i++) put(i);
      assert.equal((await (await get('/rt/admin/errors', { admin: ADMIN })).json()).evicted, 0);
      put(0); // the oldest group is seen again: now the newest
      put(300); put(301);
      const e = await (await get('/rt/admin/errors', { admin: ADMIN })).json();
      assert.equal(e.items.length, 300); assert.equal(e.evicted, 2);
      assert.deepEqual(['m0', 'm1', 'm2', 'm300'].map((m) => e.items.some((x) => x.msg === m)), [true, false, false, true]);
      assert.match(read('admin-ops.js'), /const evicted = Math\.max\(0, Number\(d\.evicted\) \|\| 0\)/);
      assert.deepEqual(await (await post('/rt/admin/errors/clear', {}, { admin: ADMIN })).json(), { ok: true, cleared: 300 });
      assert.equal((await (await get('/rt/admin/errors', { admin: ADMIN })).json()).evicted, 0);
    } finally { done(); }
  });
  it('at budget hard a report is dropped without a DO call', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), log = spyDo(env), { post } = harness(env);
      setUsed(env, 96000); clock.add(61000);
      const r = await post('/rt/err', ERR_BODY);
      assert.equal(r.status, 202); assert.deepEqual(await r.json(), { ok: true, kept: false, busy: true });
      assert.deepEqual(log.filter((x) => x.startsWith('ops.')), []);
    } finally { done(); }
  });
  it('a throw in a route answers 500 and is kept as a server group (tallied DO call)', async () => {
    const { done } = setup();
    try {
      const env = makeEnv({ ASSETS: { fetch: () => { throw new TypeError('assets broke for kim@example.com'); } } }), log = spyDo(env), { call } = harness(env);
      const r = await call('/somewhere/abc123def456?x=1');
      assert.equal(r.status, 500); assert.deepEqual(await r.json(), { err: 'server' });
      const rows = opsRows(env, 'oerr'); assert.equal(rows.length, 1);
      assert.equal(rows[0].kind, 'server'); assert.match(rows[0].msg, /^TypeError: assets broke for <email>$/); assert.match(rows[0].src, /^\/somewhere\/:id/);
      assert.ok(log.includes('ops.opsErrPut'));
    } finally { done(); }
  });
});

describe('POST /rt/support', { concurrency: false }, () => {
  const OK = { kind: 'account', text: '코인이 사라졌어요. 어제 저녁에 확인했어요.', nick: '테스트곰', build: '202611221134', page: '/', dev: 'phone' };
  it('checks the form in Korean, keeps the account from the token, and refuses a fourth in an hour (per account and per network)', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), { post, guest, get } = harness(env), a = await guest();
      assert.equal((await get('/rt/support')).status, 405);
      for (const [bad, code] of [[{ ...OK, kind: 'x' }, 'kind'], [{ ...OK, text: '짧음' }, 'short'], [{ ...OK, email: 'bad' }, 'email'], [{ ...OK, email: 'p@example.com' }, 'agree']]) {
        const r = await post('/rt/support', bad, { token: a.token, ip: '5.5.5.' + code.length }); const j = await r.json();
        assert.equal(r.status, 400); assert.equal(j.code, code); assert.equal(j.error, R.SUPPORT_TEXT[code]);
      }
      assert.equal((await post('/rt/support', null, { raw: JSON.stringify({ ...OK, text: '가'.repeat(9000) }), ip: '5.5.6.1' })).status, 413);
      const r1 = await (await post('/rt/support', { ...OK, email: 'player@example.com', agree: true, actor: 'user:forged' }, { token: a.token, ip: '6.6.6.1' })).json();
      assert.equal(r1.ok, true); assert.match(r1.id, /^[0-9a-f]{12}$/);
      const row = opsRows(env, 'osup')[0];
      assert.equal(row.actor, a.id, 'the token decides the account, not the body'); assert.equal(row.nick, '테스트곰'); assert.equal(row.email, 'player@example.com');
      assert.equal(row.dev, 'phone'); assert.equal(row.build, '202611221134'); assert.equal(row.status, 'open');
      await post('/rt/support', OK, { token: a.token, ip: '6.6.6.2' }); await post('/rt/support', OK, { token: a.token, ip: '6.6.6.3' });
      const r4 = await post('/rt/support', OK, { token: a.token, ip: '6.6.6.4' });
      assert.equal(r4.status, 429); assert.equal((await r4.json()).error, R.SUPPORT_TEXT.rate);
      for (let i = 0; i < 10; i++) assert.equal((await post('/rt/support', OK, { ip: '7.7.7.7' })).status, 200, 'no token: limited by network only, 10 an hour (shared addresses)');
      assert.equal((await post('/rt/support', OK, { ip: '7.7.7.7' })).status, 429);
      clock.add(3600e3 + 1); assert.equal((await post('/rt/support', OK, { token: a.token, ip: '6.6.6.5' })).status, 200, 'an hour later');
      assert.equal(opsRows(env, 'orl').every((x) => !/\d+\.\d+\.\d+\.\d+/.test(x.k)), true, 'the network is kept as a salted hash');
    } finally { done(); }
  });
  it('at budget hard it refuses in Korean without a DO call', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), log = spyDo(env), { post } = harness(env);
      setUsed(env, 96000); clock.add(61000);
      const r = await post('/rt/support', OK);
      assert.equal(r.status, 503); assert.deepEqual(await r.json(), { ok: false, code: 'busy', error: R.SUPPORT_TEXT.busy });
      assert.deepEqual(log.filter((x) => x.startsWith('ops.')), []);
    } finally { done(); }
  });
  const ROW = (id) => ({ id, kind: 'etc', body: 'b ' + id, email: '', actor: '', nick: '', build: '', page: '/', dev: '' });
  it('keeps up to 500: handled ones make room (oldest first), an open one is never dropped (a new one is refused instead), handled ones go a year later', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), M = env.meter('ops').do;
      for (let i = 0; i < 500; i++) { clock.add(31000); assert.equal(M.opsSupPut(ROW('id' + i), ['i:n' + i]).ok, true, String(i)); } // 31 s apart: under 120 an hour
      clock.add(31000);
      assert.deepEqual(M.opsSupPut(ROW('id500'), ['i:x']), { ok: false, code: 'full' }, 'a flood never pushes out an inquiry nobody has read');
      let l = M.opsSupList('all'); assert.equal(l.items.length, 500); assert.equal(l.items[0].id, 'id499'); assert.equal(l.open, 500);
      assert.equal(opsRows(env, 'orl').filter((x) => x.k === 'i:x').length, 0, 'a refused inquiry uses up no limit');
      assert.equal(M.opsSupMark('id499', 'done').ok, true); assert.equal(M.opsSupMark('nope', 'done').ok, false); assert.equal(M.opsSupMark('id499', 'weird').ok, false);
      assert.equal(M.opsSupMark('id10', 'done').ok, true);
      assert.equal(M.opsSupPut(ROW('id500'), ['i:x']).ok, true, 'a handled one makes room');
      l = M.opsSupList('all'); assert.equal(l.items.length, 500); assert.equal(l.items.some((x) => x.id === 'id10'), false, 'the oldest handled one went');
      assert.equal(l.items.some((x) => x.id === 'id0'), true, 'the oldest open one stays'); assert.equal(l.open, 499);
      assert.equal(M.opsSupPut(ROW('id501'), ['i:y']).ok, true); // id499 (handled) makes room
      assert.equal(M.opsSupList('done').items.length, 0); assert.equal(M.opsSupList('open').open, 500);
      assert.equal(M.opsSupPut(ROW('id502'), ['i:z']).code, 'full');
      assert.equal(M.opsSupMark('id0', 'done').ok, true);
      clock.add(366 * 864e5); l = M.opsSupList('all'); assert.equal(l.items.length, 499); assert.equal(l.items.some((x) => x.id === 'id0'), false, 'handled a year ago: gone');
    } finally { done(); }
  });
  it('120 an hour in all, whatever the network; the route answers 429 in Korean for that and for a full store, with no write', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), M = env.meter('ops').do, { post } = harness(env);
      for (let i = 0; i < 120; i++) { clock.add(1000); assert.equal(M.opsSupPut(ROW('g' + i), ['i:n' + i]).ok, true, String(i)); }
      assert.deepEqual(M.opsSupPut(ROW('g120'), ['i:fresh']), { ok: false, code: 'many' });
      const r = await post('/rt/support', OK, { ip: '8.8.4.4' });
      assert.equal(r.status, 429); assert.deepEqual(await r.json(), { ok: false, code: 'many', error: R.SUPPORT_TEXT.many });
      assert.match(R.SUPPORT_TEXT.many, /몰려/); assert.match(R.SUPPORT_TEXT.full, /받을 수 없어요/);
      clock.add(3600e3);
      assert.equal(M.opsSupPut(ROW('g121'), ['i:fresh']).ok, true, 'an hour later');
      assert.equal(opsRows(env, 'osup').length, 121);
    } finally { done(); }
  });
  it('a guest flood that uses up the hourly 120 and fills the store does not shut out a linked account', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), M = env.meter('ops').do;
      for (let i = 0; i < 120; i++) { clock.add(1000); M.opsSupPut(ROW('g' + i), ['i:n' + i]); }
      assert.deepEqual(M.opsSupPut(ROW('g120'), ['i:fresh']), { ok: false, code: 'many' });
      // a linked account (user:, not anonymous) is held only by its own limits
      assert.equal(M.opsSupPut({ ...ROW('u1'), actor: 'user:abc', linked: true }, ['i:fresh2', 'a:user:abc']).ok, true);
      // and the 500 open slots: a linked inquiry still fits above them (OPS.supLinkedExtra)
      const ops = await import('../ops.js');
      assert.ok(ops.OPS.supLinkedExtra >= 100);
    } finally { done(); }
  });
  it('limits by network: IPv6 addresses in one /64 share the hourly 10, another /64 does not; the per-minute count and OPS_RL key on the /64', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), { post } = harness(env);
      for (let i = 0; i < 10; i++) assert.equal((await post('/rt/support', OK, { ip: '2001:db8:aa:1::' + (i + 1).toString(16) })).status, 200, String(i));
      const same = await post('/rt/support', OK, { ip: '2001:DB8:AA:1:ffff:1:2:3' });
      assert.equal(same.status, 429); assert.equal((await same.json()).code, 'rate');
      assert.equal((await post('/rt/support', OK, { ip: '2001:db8:aa:2::1' })).status, 200, 'the next /64 is another network');
      const keys = []; env.OPS_RL = { async limit({ key }) { keys.push(key); return { success: true }; } };
      await post('/rt/err', ERR_BODY, { ip: '2001:db8:aa:3:1:2:3:4' });
      await post('/rt/err', { ...ERR_BODY, m: 'other' }, { ip: '9.8.7.6' });
      assert.deepEqual(keys, ['err:2001:db8:aa:3::/64', 'err:9.8.7.6']);
      let last = 0; delete env.OPS_RL;
      for (let i = 0; i < 21; i++) last = (await post('/rt/err', { ...ERR_BODY, m: 'v6 ' + i }, { ip: '2001:db8:bb:1::' + (i + 1).toString(16) })).status;
      assert.equal(last, 429, 'one /64 walking its addresses is one network for the per-minute count');
    } finally { done(); }
  });
  it('the maintenance read (every isolate, every 5 minutes) also prunes rate rows past an hour and inquiries handled over a year ago', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), M = env.meter('ops').do;
      assert.equal(M.opsSupPut(ROW('m1'), ['i:a', 'a:guest:x']).ok, true);
      assert.equal(M.opsSupPut(ROW('m2'), ['i:b']).ok, true);
      assert.equal(M.opsSupMark('m1', 'done').ok, true);
      assert.equal(opsRows(env, 'orl').length, 5);
      clock.add(3600e3 + 1); M.opsMaintGet();
      assert.equal(opsRows(env, 'orl').length, 0, 'an hour later, with no inquiry written');
      clock.add(366 * 864e5); M.opsMaintGet();
      assert.deepEqual(opsRows(env, 'osup').map((x) => x.id), ['m2'], 'the handled one is gone, the open one stays');
    } finally { done(); }
  });
});

describe('admin routes', { concurrency: false }, () => {
  it('every new admin route needs the ADMIN_KEY', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), { get, post } = harness(env);
      for (const [m, path] of [['GET', '/rt/admin/errors'], ['POST', '/rt/admin/errors/clear'], ['GET', '/rt/admin/support'], ['POST', '/rt/admin/support'], ['GET', '/rt/admin/maint'], ['POST', '/rt/admin/maint']]) {
        for (const admin of [undefined, 'wrong-key-xyz-123', ADMIN.slice(0, -1)]) {
          const r = m === 'GET' ? await get(path, { admin }) : await post(path, { on: true }, { admin });
          assert.equal(r.status, 401, `${m} ${path} ${admin}`);
        }
      }
      const noKey = makeEnv({ ADMIN_KEY: '' }), h2 = harness(noKey);
      assert.equal((await h2.get('/rt/admin/errors', { admin: '' })).status, 401);
    } finally { done(); }
  });
  it('lists and clears errors, lists and marks inquiries, reads and sets the maintenance notice', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), { get, post } = harness(env);
      await post('/rt/err', ERR_BODY);
      const e = await (await get('/rt/admin/errors', { admin: ADMIN })).json();
      assert.equal(e.items.length, 1); assert.equal(e.items[0].n, 1); assert.equal(e.items[0].src, 'ui.js:12:34');
      assert.deepEqual(await (await post('/rt/admin/errors/clear', {}, { admin: ADMIN })).json(), { ok: true, cleared: 1 });
      assert.equal((await (await get('/rt/admin/errors', { admin: ADMIN })).json()).items.length, 0);
      const id = (await (await post('/rt/support', { kind: 'bug', text: '버튼이 눌리지 않아요. 확인 부탁드려요.' })).json()).id;
      const s = await (await get('/rt/admin/support', { admin: ADMIN })).json(); assert.equal(s.open, 1); assert.equal(s.items[0].id, id);
      assert.equal((await post('/rt/admin/support', { id, status: 'done' }, { admin: ADMIN })).status, 200);
      assert.equal((await post('/rt/admin/support', { id: 'zz', status: 'done' }, { admin: ADMIN })).status, 400);
      assert.equal((await (await get('/rt/admin/support?status=done', { admin: ADMIN })).json()).items.length, 1);
      assert.equal((await post('/rt/admin/maint', { on: 'yes' }, { admin: ADMIN })).status, 400);
      assert.equal((await post('/rt/admin/maint', { on: true, until: 'not a date' }, { admin: ADMIN })).status, 400);
      const until = Date.now() + 3600e3;
      const m = await (await post('/rt/admin/maint', { on: true, msg: '서버를 옮기고 있어요', until }, { admin: ADMIN })).json();
      assert.equal(m.maint.on, true); assert.equal(m.maint.msg, '서버를 옮기고 있어요'); assert.equal(m.maint.until, until);
      assert.equal((await (await get('/rt/admin/maint', { admin: ADMIN })).json()).maint.on, true);
      assert.equal((await (await post('/rt/admin/maint', { on: false }, { admin: ADMIN })).json()).maint.on, false);
    } finally { done(); }
  });
});

describe('/rt/config: operator and maint', { concurrency: false }, () => {
  it('operator: the cleaned fields when OPERATOR_INFO is valid JSON, nothing when missing or invalid', async () => {
    const { done } = setup();
    try {
      const fake = { name: '테스트상호', ceo: '홍테스트', biz: '000-00-00000', mail: '제0000-테스트-0000호', addr: '테스트시 가상로 1', email: 'help@example.test', junk: '<b>x</b>' };
      const on = await (await harness(makeEnv({ OPERATOR_INFO: JSON.stringify(fake) })).get('/rt/config')).json();
      const { junk, ...want } = fake; assert.deepEqual(on.operator, want); assert.equal(junk.length > 0, true);
      for (const v of [undefined, '', 'not json', '[]', '{}']) assert.equal('operator' in (await (await harness(makeEnv(v === undefined ? {} : { OPERATOR_INFO: v })).get('/rt/config')).json()), false, String(v));
    } finally { done(); }
  });
  it('maint: carried while on, absent when off; read once every 5 minutes per isolate, behind the response once known', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), log = spyDo(env), { get, post } = harness(env);
      const off = await (await get('/rt/config')).json();
      assert.equal('maint' in off, false); assert.deepEqual(log.filter((x) => x.startsWith('ops.')), ['ops.opsMaintGet'], 'a new isolate reads it once');
      log.length = 0; clock.add(1000); await get('/rt/config'); await get('/rt/config');
      assert.deepEqual(log.filter((x) => x.startsWith('ops.')), [], 'no DO call while the copy is fresh');
      const until = Date.now() + 7200e3;
      await post('/rt/admin/maint', { on: true, msg: '점검 테스트', until }, { admin: ADMIN });
      assert.deepEqual((await (await get('/rt/config')).json()).maint, { msg: '점검 테스트', until }, 'the admin isolate knows at once');
      ops.opsReset(); // another isolate
      env.meter('ops').do.opsMaintPut({ on: true, msg: '다른 isolate', until: 0 });
      assert.deepEqual((await (await get('/rt/config')).json()).maint, { msg: '다른 isolate', until: 0 });
      env.meter('ops').do.opsMaintPut({ on: false });
      log.length = 0; clock.add(240000); assert.equal('maint' in (await (await get('/rt/config')).json()), true, 'still the copy within 5 minutes');
      assert.deepEqual(log.filter((x) => x.startsWith('ops.')), []);
      clock.add(61000); await get('/rt/config'); // stale: served, refreshed behind
      assert.equal('maint' in (await (await get('/rt/config')).json()), false);
    } finally { done(); }
  });
});

describe('/rt/health', { concurrency: false }, () => {
  it('keeps its fields and adds db, budget, maint and build; no-store; db cached 30 s', async () => {
    const { clock, state, done } = setup();
    try {
      const html = '<script type="module" src="./main.js?v=202611221134"></script>';
      const env = makeEnv({ ASSETS: { fetch: (r) => new Response(new URL(r.url).pathname === '/' ? html : 'x') } }), { get } = harness(env);
      const r = await get('/rt/health');
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await r.json(), { hasFlushKey: true, hasGuestKey: true, mode: 'DO', db: 'ok', budget: 0, maint: false, build: '202611221134' });
      const probes = () => state.calls.filter((u) => u.includes('/rest/v1/billboards')).length;
      assert.equal(probes(), 1);
      state.db = 'down'; clock.add(10000); assert.equal((await (await get('/rt/health')).json()).db, 'ok', 'cached'); assert.equal(probes(), 1);
      clock.add(21000); assert.equal((await (await get('/rt/health')).json()).db, 'down');
      state.db = 'error'; clock.add(31000); assert.equal((await (await get('/rt/health')).json()).db, 'down');
      state.db = 'slow'; clock.add(31000); assert.equal((await (await get('/rt/health')).json()).db, 'slow');
      env.meter('ops').do.opsMaintPut({ on: true }); ops.opsReset(); state.db = 'ok';
      const h = await (await get('/rt/health')).json(); assert.equal(h.maint, true);
      setUsed(env, 85000); clock.add(61000); assert.equal((await (await get('/rt/health', { ip: '1.2.3.4' })).json()).budget, 1);
      setUsed(env, 96000); clock.add(61000); assert.equal((await (await get('/rt/health', { ip: '1.2.3.5' })).json()).budget, 2);
      const fixed = await (await harness(makeEnv({ BUILD_ID: '202612010900' })).get('/rt/health', { ip: '1.2.3.6' })).json(); assert.equal(fixed.build, '202612010900');
    } finally { done(); }
  });
  it('over the per-IP limit it answers from what the isolate knows (never 429: the boot reads it), and needs no binding or DO', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), log = spyDo(env), { get } = harness(env);
      for (let i = 0; i < 20; i++) assert.equal((await get('/rt/health', { ip: '4.3.2.1' })).status, 200);
      const probes = state.calls.length; log.length = 0;
      const over = await get('/rt/health', { ip: '4.3.2.1' }), o = await over.json();
      assert.equal(over.status, 200); assert.equal(o.cached, true); assert.equal(o.hasGuestKey, true); assert.equal(o.db, 'ok'); assert.equal(o.maint, false);
      assert.equal(state.calls.length, probes); assert.deepEqual(log, []);
      const bare = await worker.fetch(new Request('https://sq.example/rt/health'), {}, { waitUntil() {} });
      const b = await bare.json(); assert.equal(b.maint, false); assert.equal('build' in b, false); assert.equal(b.mode, 'DO');
    } finally { done(); }
  });
});

describe('privacy policy and terms', () => {
  it('say what an inquiry and an error report keep, and point at 문의하기 without operator details', () => {
    legal.setOperator(null);
    const p = legal.policyDoc('privacy'), t = legal.policyDoc('terms');
    const sec = (d, h) => d.sections.find((s) => s.h === h)?.p || '';
    assert.match(sec(p, '문의하기'), /답장 받을 이메일은 적은 경우에만 저장하고 그 문의의 답장에만 씁니다/);
    assert.match(sec(p, '문의하기'), /처리한 문의는 처리한 뒤 1년 안에 지우고/);
    assert.match(sec(p, '문의하기'), /계정 번호/);
    assert.match(sec(p, '오류 기록'), /계정 번호, 닉네임, 이메일, 주소의 검색어는 보내지 않습니다/);
    assert.match(sec(p, '개인정보 문의'), /설정의 문의하기/); assert.match(sec(t, '운영자'), /설정의 문의하기/);
    assert.match(R.SUPPORT_CONSENT, /답장에만 쓰고, 처리한 뒤 1년 안에 지웁니다/);
  });
  it('show the operator details when OPERATOR_INFO is set', () => {
    legal.setOperator({ name: '테스트상호', ceo: '홍테스트', biz: '000-00-00000', email: 'help@example.test' });
    const t = legal.policyDoc('terms'), p = legal.policyDoc('privacy');
    assert.match(t.sections.find((s) => s.h === '운영자').p, /^상호 테스트상호 · 대표 홍테스트 · 사업자등록번호 000-00-00000 · 이메일 help@example\.test\./);
    assert.match(p.sections.find((s) => s.h === '개인정보 문의').p, /테스트상호에게 합니다/);
    legal.setOperator('not json'); assert.equal(legal.operatorInfo(), null);
    assert.match(legal.policyDoc('terms').sections.find((s) => s.h === '운영자').p, /^문의는 Wishboard 운영자에게 합니다/);
  });
  it('ui.js: 문의하기 in settings, the operator line under the policy links, the maintenance card on the boot card', () => {
    const ui = read('ui.js');
    assert.match(ui, /text: '문의하기', onclick: \(\) => openSupport\(\)/);
    assert.match(ui, /policyLinks\(\),\s*operatorFooter\(\),/);
    assert.match(ui, /href: '\/ads'/);
    assert.match(ui, /if \(maintOn\) \{ maintSaved = bootFields; bootEnter\.replaceChildren\(maintCard\(maintOn\)\); \}/);
    assert.match(read('admin.html'), /<script type="module" src="\.\/admin-ops\.js\?v=\d+"><\/script>/);
    assert.match(read('worker.js'), /^import \* as ops from '\.\/ops\.js';/m);
  });
});
