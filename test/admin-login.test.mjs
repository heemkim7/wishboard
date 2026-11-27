// 운영자 로그인: /admin and its modules are served only to a browser with a session cookie (worker.js admGate), the key is the
// login's password, the cookie opens the admin API like the x-admin-key header, cookie POSTs must come from the page's own origin,
// ADMIN_RL slows guessing, and the operator store keeps the last 50 login attempts.
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: new URL('./cf-stub.mjs', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});
globalThis.WebSocketRequestResponsePair = class { constructor(req, res) { this.req = req; this.res = res; } };

const W = await import('../worker.js');
const worker = W.default, { Meter } = W;
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ADMIN_HTML = read('admin.html');
const MODULES = ['admin-ops.js', 'admin-ads.js', 'admin-gift.js', 'admin-team.js'];

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
const makeCtx = (sql) => ({ storage: { sql, async getAlarm() { return null; }, async setAlarm() {}, async deleteAlarm() {}, transactionSync(fn) { return fn(); } }, setWebSocketAutoResponse() {}, getWebSockets() { return []; }, acceptWebSocket() {} });
const stub = (obj) => new Proxy(obj, { get: (t, k) => typeof t[k] === 'function' ? async (...a) => structuredClone(await t[k](...structuredClone(a))) : t[k] });

const KEY = 'login-test-key-0123456789'; // made up for this file
const ORIGIN = 'https://admin.test';
// A rate-limit binding like Workers Rate Limiting: n requests per key, then success: false.
const fakeRl = (n = 5) => { const seen = new Map(); return { seen, async limit({ key }) { const c = (seen.get(key) || 0) + 1; seen.set(key, c); return { success: c <= n }; } }; };
function makeEnv(extra = {}) {
  const meters = new Map(), assets = [];
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ADMIN_KEY: KEY, ...extra };
  // What the static assets would answer (wrangler html_handling auto-trailing-slash): /admin is admin.html, /admin.html and /admin/ redirect to /admin.
  env.ASSETS = { fetch: async (req) => { const p = new URL(req.url).pathname; assets.push(p);
    if (p === '/admin') return new Response(ADMIN_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (p === '/admin.html' || p === '/admin/') return new Response(null, { status: 307, headers: { location: '/admin' } });
    const f = p.slice(1); if (MODULES.includes(f)) return new Response(read(f), { headers: { 'content-type': 'text/javascript' } });
    return new Response('asset ' + p, { status: 200 }); } };
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new Meter(makeCtx(sql), env) }); } return meters.get(name); };
  env.METER = { idFromName: (name) => name, get: (name) => stub(env.meter(name).do) };
  env.ROOM = { idFromName: (t) => t, get: () => { throw new Error('no room in these tests'); } };
  return { env, assets };
}
const seen = []; // every answer of this file: the key must be in none of them
const waits = [];
const ctx = { waitUntil(p) { waits.push(Promise.resolve(p).catch(() => {})); } };
const settle = async () => { while (waits.length) await waits.shift(); };
async function call(env, path, init = {}) {
  const res = await worker.fetch(new Request(ORIGIN + path, { redirect: 'manual', ...init, headers: { 'cf-connecting-ip': '203.0.113.7', ...(init.headers || {}) } }), env, ctx);
  const text = await res.clone().text();
  seen.push({ path, text, headers: [...res.headers].map(([k, v]) => k + ': ' + v).join('\n') });
  return Object.assign(res, { text });
}
const login = (env, key, headers = {}) => call(env, '/rt/admin/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN, ...headers }, body: new URLSearchParams({ key }).toString() });
const cookieOf = (res) => (res.headers.get('set-cookie') || '').split(';')[0];
async function session(env) { const r = await login(env, KEY); assert.equal(r.status, 303, r.text); return cookieOf(r); }

// The operator page's own markup and routes: none of it may reach a browser without a session.
const OPERATOR = ['opsRoot', '사진 전광판 검수', 'admin-ops', 'admin-ads', 'admin-gift', 'admin-team', '/rt/admin/photos', '/rt/admin/stats', 'growth.js', 'sessionStorage', '코인 지급'];
const SECURITY = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };
const secured = (res, what) => { for (const [k, v] of Object.entries(SECURITY)) assert.equal(res.headers.get(k), v, what + ': ' + k); };

describe('admin login (worker.js admGate)', { concurrency: false }, () => {
  const realNow = Date.now; let offset = 0;
  Date.now = () => realNow() + offset;
  after(() => { Date.now = realNow; });

  it('logged out: /admin, /admin.html and /admin/ are the login page, with none of the operator page', async () => {
    const { env, assets } = makeEnv();
    for (const p of ['/admin', '/admin.html', '/admin/']) {
      const r = await call(env, p);
      assert.equal(r.status, 200, p); assert.match(r.headers.get('content-type'), /text\/html/);
      for (const s of OPERATOR) assert.equal(r.text.includes(s), false, p + ' carries ' + s);
      assert.match(r.text, /<form method="post" action="\/rt\/admin\/login">/);
      assert.equal((r.text.match(/<input /g) || []).length, 1, 'one field');
      assert.match(r.text, /<input type="password" name="key" autocomplete="off"/);
      assert.match(r.text, /<button type="submit">/);
      assert.equal(/<script/i.test(r.text), false, 'no script');
      assert.equal((r.text.match(/\/rt\/admin\//g) || []).length, 1, 'no admin route but the login');
      assert.match(r.text, /<html lang="ko">/); assert.match(r.text, /운영자 로그인/);
      secured(r, p);
    }
    assert.deepEqual(assets, [], 'the static operator page was never asked for');
  });

  it('logged out: every admin module is 404', async () => {
    const { env, assets } = makeEnv();
    for (const f of MODULES) { const r = await call(env, '/' + f + '?v=202611270945'); assert.equal(r.status, 404, f); secured(r, f); assert.equal(r.text.includes('import'), false); }
    assert.equal((await call(env, '/admin-anything.js')).status, 404);
    assert.deepEqual(assets, []);
  });

  it('a wrong key gives the login page again with a plain message and no cookie', async () => {
    const { env } = makeEnv();
    for (const k of ['wrong-key-wrong-key', '', KEY.slice(0, -1), KEY + 'x']) {
      const r = await login(env, k);
      assert.equal(r.status, 401, k); assert.equal(r.headers.get('set-cookie'), null);
      assert.match(r.text, /키가 맞지 않아요\./); assert.match(r.text, /type="password"/); secured(r, 'fail');
    }
    // no ADMIN_KEY configured: nobody logs in
    const none = makeEnv({ ADMIN_KEY: '' }).env;
    assert.equal((await login(none, '')).status, 401);
  });

  it('the right key sets an HttpOnly, Secure, SameSite=Strict cookie for 12 hours, and /admin then serves the operator page', async () => {
    const { env, assets } = makeEnv();
    const r = await login(env, KEY);
    assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/admin'); secured(r, 'login');
    const sc = r.headers.get('set-cookie');
    assert.match(sc, /^kts_adm=1\.\d{10}\.[\w-]{22}\.[\w-]{43}; /);
    for (const a of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=43200']) assert.ok(sc.split('; ').includes(a), a);
    const exp = Number(cookieOf(r).split('.')[1]); assert.ok(Math.abs(exp - (Math.floor(Date.now() / 1000) + 43200)) <= 2, 'expiry 12 h out');
    const c = cookieOf(r);
    const page = await call(env, '/admin', { headers: { cookie: 'other=1; ' + c } });
    assert.equal(page.status, 200); assert.equal(page.text, ADMIN_HTML); secured(page, 'operator page');
    const mod = await call(env, '/admin-ops.js?v=1', { headers: { cookie: c } });
    assert.equal(mod.status, 200); assert.equal(mod.text, read('admin-ops.js')); secured(mod, 'module');
    const red = await call(env, '/admin.html', { headers: { cookie: c } });
    assert.equal(red.status, 307); assert.equal(red.headers.get('location'), '/admin');
    assert.deepEqual(assets, ['/admin', '/admin-ops.js', '/admin.html']);
  });

  it('the cookie opens the admin API without the header; the header alone works as before', async () => {
    const { env } = makeEnv(); const c = await session(env);
    const a = await call(env, '/rt/admin/errors', { headers: { cookie: c } });
    assert.equal(a.status, 200, a.text); assert.equal(JSON.parse(a.text).ok, true); secured(a, 'api');
    const h = await call(env, '/rt/admin/errors', { headers: { 'x-admin-key': KEY } });
    assert.equal(h.status, 200); secured(h, 'api header');
    const none = await call(env, '/rt/admin/errors');
    assert.equal(none.status, 401); secured(none, 'api 401');
    // a wrong header is not rescued by a good cookie: the header path is the tools' and stays exact
    assert.equal((await call(env, '/rt/admin/errors', { headers: { cookie: c, 'x-admin-key': 'wrong-key-wrong-key' } })).status, 401);
    // the photo preview the review tab loads is an admin read too
    const ph = await call(env, '/rt/photo/' + 'a'.repeat(40) + '.jpg?review=1', { headers: { cookie: c } });
    assert.notEqual(ph.status, 401);
    assert.equal((await call(env, '/rt/photo/' + 'a'.repeat(40) + '.jpg?review=1')).status, 401);
  });

  it('refuses an expired cookie, a changed expiry, a changed signature and one signed under another ADMIN_KEY', async () => {
    const { env } = makeEnv(); const c = await session(env);
    const [name, v] = c.split('='), [ver, exp, rnd, sig] = v.split('.');
    const flip = (s) => s.slice(0, -2) + (s.at(-2) === 'A' ? 'B' : 'A') + s.at(-1);
    const bad = {
      expiry: `${name}=${ver}.${Number(exp) + 3600}.${rnd}.${sig}`,
      signature: `${name}=${ver}.${exp}.${rnd}.${flip(sig)}`,
      random: `${name}=${ver}.${exp}.${flip(rnd)}.${sig}`,
      version: `${name}=2.${exp}.${rnd}.${sig}`,
      garbage: `${name}=x`,
    };
    for (const [why, ck] of Object.entries(bad)) {
      assert.equal((await call(env, '/rt/admin/errors', { headers: { cookie: ck } })).status, 401, why);
      assert.match((await call(env, '/admin', { headers: { cookie: ck } })).text, /type="password"/, why);
    }
    const other = makeEnv({ ADMIN_KEY: 'another-key-another-key' }).env;
    assert.equal((await call(other, '/rt/admin/errors', { headers: { cookie: c } })).status, 401, 'another key');
    assert.match((await call(other, '/admin', { headers: { cookie: c } })).text, /type="password"/);
    assert.equal((await call(env, '/rt/admin/errors', { headers: { cookie: c } })).status, 200, 'the real one still works');
    offset += 12 * 3600e3 + 1000;
    try {
      assert.equal((await call(env, '/rt/admin/errors', { headers: { cookie: c } })).status, 401, 'expired');
      assert.match((await call(env, '/admin', { headers: { cookie: c } })).text, /type="password"/, 'expired');
    } finally { offset -= 12 * 3600e3 + 1000; }
  });

  it('a POST opened by the cookie needs the page’s own Origin; the same POST with the header does not', async () => {
    const { env } = makeEnv(); const c = await session(env);
    const post = (headers) => call(env, '/rt/admin/errors/clear', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });
    for (const [why, o] of [['foreign', { origin: 'https://evil.example' }], ['missing', {}], ['null', { origin: 'null' }], ['other port', { origin: ORIGIN + ':8443' }]]) {
      const r = await post({ cookie: c, ...o });
      assert.equal(r.status, 403, why); assert.equal(JSON.parse(r.text).err, 'origin'); secured(r, why);
    }
    assert.equal((await post({ cookie: c, origin: ORIGIN })).status, 200, 'own origin');
    assert.equal((await post({ 'x-admin-key': KEY, origin: 'https://evil.example' })).status, 200, 'header, foreign origin');
    assert.equal((await post({ 'x-admin-key': KEY })).status, 200, 'header, no origin');
    // GET with the cookie needs no Origin
    assert.equal((await call(env, '/rt/admin/support', { headers: { cookie: c } })).status, 200);
  });

  it('logout clears the cookie and goes back to the login page', async () => {
    const { env } = makeEnv(); await session(env);
    const r = await call(env, '/rt/admin/logout', { method: 'POST', headers: { origin: 'null' } }); // a form POST from a no-referrer page sends Origin: null
    assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/admin'); secured(r, 'logout');
    const sc = r.headers.get('set-cookie');
    assert.match(sc, /^kts_adm=; /);
    for (const a of ['Max-Age=0', 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict']) assert.ok(sc.split('; ').includes(a), a);
    assert.equal((await call(env, '/rt/admin/logout', { method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403);
  });

  it('the sixth attempt inside a minute is 429, wrong header keys count too, and a missing or broken binding does not stop a login', async () => {
    const rl = fakeRl(5), { env } = makeEnv({ ADMIN_RL: rl });
    for (let i = 0; i < 5; i++) assert.equal((await login(env, 'wrong-key-wrong-key')).status, 401, 'try ' + (i + 1));
    const r = await login(env, KEY);
    assert.equal(r.status, 429); assert.match(r.text, /잠시 뒤에 다시 시도해 주세요\./); assert.equal(r.headers.get('set-cookie'), null); secured(r, '429');
    assert.equal(r.headers.get('retry-after'), '60');
    assert.deepEqual([...rl.seen.keys()], ['admin:203.0.113.7']);
    // IPv6 by /64: another address in the same /64 shares the count
    const v6 = fakeRl(5), e6 = makeEnv({ ADMIN_RL: v6 }).env;
    await login(e6, 'x', { 'cf-connecting-ip': '2001:db8:1:2:aaaa::1' }); await login(e6, 'x', { 'cf-connecting-ip': '2001:db8:1:2:bbbb::2' });
    assert.deepEqual([...v6.seen.entries()], [['admin:2001:db8:1:2::/64', 2]]);
    // a wrong x-admin-key is a guess too; the right one is never counted
    const h = fakeRl(5), eh = makeEnv({ ADMIN_RL: h }).env;
    for (let i = 0; i < 3; i++) assert.equal((await call(eh, '/rt/admin/errors', { headers: { 'x-admin-key': KEY } })).status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await call(eh, '/rt/admin/errors', { headers: { 'x-admin-key': 'wrong-key-' + i } })).status, 401);
    const six = await call(eh, '/rt/admin/errors', { headers: { 'x-admin-key': 'wrong-key-6' } });
    assert.equal(six.status, 429); secured(six, 'header 429');
    assert.equal(h.seen.get('admin:203.0.113.7'), 6);
    // no binding (older deploy, tests) and a binding that throws: the login still works
    assert.equal((await login(makeEnv().env, KEY)).status, 303);
    const broken = { async limit() { throw new Error('down'); } };
    assert.equal((await login(makeEnv({ ADMIN_RL: broken }).env, KEY)).status, 303);
  });

  it('keeps the last 50 login attempts in the operator store (time, result, 6 characters of the network hash) and shows them to the admin', async () => {
    const { env } = makeEnv();
    await login(env, 'wrong-key-wrong-key'); await settle();
    await login(env, KEY); await settle();
    const r = await call(env, '/rt/admin/logins', { headers: { 'x-admin-key': KEY } });
    assert.equal(r.status, 200); const d = JSON.parse(r.text);
    assert.equal(d.ok, true); assert.deepEqual(d.items.map((x) => x.ok), [true, false]);
    for (const x of d.items) { assert.deepEqual(Object.keys(x).sort(), ['at', 'net', 'ok']); assert.match(x.net, /^[0-9a-f]{6}$/); assert.ok(Math.abs(x.at - Date.now()) < 5000); }
    assert.equal(r.text.includes('203.0.113'), false, 'no address');
    for (let i = 0; i < 55; i++) { await login(env, 'wrong-' + i + '-wrong-wrong'); await settle(); }
    const all = JSON.parse((await call(env, '/rt/admin/logins', { headers: { 'x-admin-key': KEY } })).text).items;
    assert.equal(all.length, 50); assert.equal(all.every((x) => x.ok === false), true);
    assert.equal(env.meter('ops').sql.db.prepare('select count(*) as c from olog').get().c, 50);
    assert.equal((await call(env, '/rt/admin/logins')).status, 401);
    assert.match(read('admin-ops.js'), /\/rt\/admin\/logins/);
  });

  it('writes no trail at budget hard, and the login still works there', async () => {
    const { env } = makeEnv({ BUDGET_REQ_DAY: '1' });
    offset += 61000; // past the isolate's level copy, so this request reads the guard again
    try {
      await call(env, '/rt/admin/errors', { headers: { 'x-admin-key': KEY } }); await settle(); // a counted DO call: the day is now over its tiny budget
      offset += 61000; await call(env, '/rt/gate'); await settle();
      assert.equal(JSON.parse((await call(env, '/rt/gate')).text).full, true, 'hard');
      const before = env.meter('ops').sql.db.prepare("select count(*) as c from sqlite_master where name = 'olog'").get().c ? env.meter('ops').sql.db.prepare('select count(*) as c from olog').get().c : 0;
      assert.equal((await login(env, KEY)).status, 303); await settle();
      const now = env.meter('ops').sql.db.prepare('select count(*) as c from olog').get().c;
      assert.equal(now, before, 'no login row at hard');
    } finally { offset += 61000; await call(makeEnv().env, '/rt/gate'); await settle(); }
  });

  it('never sends the key to the browser', () => {
    assert.ok(seen.length > 50);
    for (const s of seen) { assert.equal(s.text.includes(KEY), false, s.path); assert.equal(s.headers.includes(KEY), false, s.path); }
  });
});

describe('admin page and modules no longer hold the key', () => {
  it('admin.html: no key field, no sessionStorage, no x-admin-key; a 로그아웃 button; a 401 goes to /admin', () => {
    assert.equal(/id="key"|kts-admin|sessionStorage|x-admin-key|type="password"/.test(ADMIN_HTML), false);
    assert.match(ADMIN_HTML, /<form class="bar" method="post" action="\/rt\/admin\/logout"><button type="submit">로그아웃<\/button><\/form>/);
    assert.match(ADMIN_HTML, /if \(r\.status === 401\) \{ location\.replace\('\/admin'\);/);
  });
  for (const f of MODULES) it(f + ': no sessionStorage key handling, a 401 goes to /admin', () => {
    const s = read(f);
    assert.equal(/kts-admin|sessionStorage|'x-admin-key'|\$\('key'\)|keyOf|getElementById\('save'\)/.test(s), false, f);
    assert.match(s, /if \(r\.status === 401\) \{ location\.replace\('\/admin'\);/, f);
  });
  it('wrangler.jsonc runs the Worker first for /admin* and binds ADMIN_RL (5 a minute, its own namespace)', () => {
    const cfg = read('wrangler.jsonc');
    assert.match(cfg, /"run_worker_first": \["\/rt\/\*", "\/\.env\*", "\/\.git\/\*", "\/admin\*"\]/);
    const m = cfg.match(/\{ "name": "ADMIN_RL", "namespace_id": "(\d+)", "simple": \{ "limit": 5, "period": 60 \} \}/);
    assert.ok(m, 'ADMIN_RL');
    const ids = [...cfg.matchAll(/"namespace_id": "(\d+)"/g)].map((x) => x[1]);
    assert.equal(new Set(ids).size, ids.length, 'namespace ids are unique');
  });
  it('the service worker never answers /admin from a cache', () => {
    const sw = read('sw.js');
    assert.match(sw, /if \(url\.origin !== self\.location\.origin \|\| !url\.pathname\.startsWith\('\/assets\/'\)\) return;/);
    assert.equal(/admin/.test(sw.replace(/^\/\/.*$|\/\*[\s\S]*?\*\//gm, '')), false);
  });
});
