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
    if (p === '/admin') return new Response(env.page ?? ADMIN_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', ...(env.etag ? { etag: env.etag } : {}) } });
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
  const res = await worker.fetch(new Request(/^https?:/.test(path) ? path : ORIGIN + path, { redirect: 'manual', ...init, headers: { 'cf-connecting-ip': '203.0.113.7', ...(init.headers || {}) } }), env, ctx);
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
    assert.match(sc, /^__Host-kts_adm=1\.\d{10}\.[\w-]{22}\.[\w-]{43}; /);
    for (const a of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=43200']) assert.ok(sc.split('; ').includes(a), a);
    const exp = Number(cookieOf(r).split('.')[1]); assert.ok(Math.abs(exp - (Math.floor(Date.now() / 1000) + 43200)) <= 2, 'expiry 12 h out');
    const c = cookieOf(r);
    const page = await call(env, '/admin', { headers: { cookie: 'other=1; ' + c } });
    assert.equal(page.status, 200); assert.equal(page.text, ADMIN_HTML); secured(page, 'operator page');
    assert.match(page.headers.get('content-security-policy'), /^default-src 'none'; script-src 'self' 'sha256-/);
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
    assert.match(sc, /^__Host-kts_adm=; /);
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
    // fifty-five failures do not push out the real login: failures keep their newest 50, successes their newest 20, apart
    for (let i = 0; i < 55; i++) { await login(env, 'wrong-' + i + '-wrong-wrong'); await settle(); }
    const logins = async () => JSON.parse((await call(env, '/rt/admin/logins', { headers: { 'x-admin-key': KEY } })).text).items;
    let all = await logins();
    assert.equal(all.filter((x) => !x.ok).length, 50); assert.equal(all.filter((x) => x.ok).length, 1, 'the success survives the flood');
    assert.equal(env.meter('ops').sql.db.prepare('select count(*) as c from olog').get().c, 51);
    for (let i = 0; i < 25; i++) { offset += 1; await login(env, KEY); await settle(); }
    all = await logins();
    assert.equal(all.filter((x) => x.ok).length, 20); assert.equal(all.filter((x) => !x.ok).length, 50, 'successes do not push out failures either');
    assert.equal(all.length, 70);
    for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].at >= all[i].at, 'newest first');
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

  it('refuses a login or logout the browser marks as from elsewhere, before it counts as an attempt; null Origin from our own page still works', async () => {
    const rl = fakeRl(5), { env } = makeEnv({ ADMIN_RL: rl });
    for (const s of ['cross-site', 'same-site']) {
      const r = await login(env, KEY, { origin: 'null', 'sec-fetch-site': s });
      assert.equal(r.status, 403, s); assert.equal(r.headers.get('set-cookie'), null); secured(r, s);
      const out = await call(env, '/rt/admin/logout', { method: 'POST', headers: { origin: 'null', 'sec-fetch-site': s } });
      assert.equal(out.status, 403, 'logout ' + s); assert.equal(out.headers.get('set-cookie'), null);
    }
    assert.equal(rl.seen.size, 0, 'no attempt counted'); await settle();
    assert.equal(JSON.parse((await call(env, '/rt/admin/logins', { headers: { 'x-admin-key': KEY } })).text).items.length, 0, 'no trail row');
    for (const s of ['same-origin', 'none']) assert.equal((await login(env, KEY, { origin: 'null', 'sec-fetch-site': s })).status, 303, s);
    assert.equal((await login(env, KEY, { origin: 'null' })).status, 303, 'no Sec-Fetch-Site: as before');
    assert.equal((await call(env, '/rt/admin/logout', { method: 'POST', headers: { origin: 'null', 'sec-fetch-site': 'same-origin' } })).status, 303);
    assert.equal((await login(env, KEY, { origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' })).status, 403, 'a foreign Origin is still refused');
  });

  it('a wrong x-admin-key stays 401 even with a valid cookie', async () => {
    const { env } = makeEnv(); const c = await session(env);
    for (const [m, p] of [['GET', '/rt/admin/errors'], ['GET', '/rt/admin/logins'], ['POST', '/rt/admin/errors/clear']]) {
      const r = await call(env, p, { method: m, headers: { cookie: c, origin: ORIGIN, 'x-admin-key': 'wrong-key-wrong-key', ...(m === 'POST' ? { 'content-type': 'application/json' } : {}) }, ...(m === 'POST' ? { body: '{}' } : {}) });
      assert.equal(r.status, 401, p);
    }
  });

  it('names the cookie __Host-kts_adm on https and kts_adm on http, and takes only the name of the request\'s scheme', async () => {
    const { env } = makeEnv();
    const LOCAL = 'http://localhost:8787';
    const sec = await session(env), sv = sec.split('=')[1];
    assert.match(sec, /^__Host-kts_adm=/);
    const r = await call(env, LOCAL + '/rt/admin/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: LOCAL }, body: 'key=' + encodeURIComponent(KEY) });
    assert.equal(r.status, 303); const plain = cookieOf(r), pv = plain.split('=')[1];
    assert.match(plain, /^kts_adm=1\./); assert.ok(r.headers.get('set-cookie').split('; ').includes('Secure'));
    assert.equal((await call(env, LOCAL + '/rt/admin/errors', { headers: { cookie: plain } })).status, 200, 'http, plain name');
    assert.equal((await call(env, LOCAL + '/rt/admin/errors', { headers: { cookie: '__Host-kts_adm=' + pv } })).status, 401, 'http, prefixed name');
    assert.equal((await call(env, '/rt/admin/errors', { headers: { cookie: 'kts_adm=' + sv } })).status, 401, 'https, plain name');
    assert.equal((await call(env, '/rt/admin/errors', { headers: { cookie: sec } })).status, 200, 'https, prefixed name');
    // junk under the plain name cannot starve the prefixed one on https
    assert.equal((await call(env, '/rt/admin/errors', { headers: { cookie: 'kts_adm=x; kts_adm=y; kts_adm=z; ' + sec } })).status, 200);
    const out = await call(env, LOCAL + '/rt/admin/logout', { method: 'POST', headers: { origin: LOCAL } });
    assert.match(out.headers.get('set-cookie'), /^kts_adm=; Max-Age=0; /);
    assert.match((await call(env, LOCAL + '/admin', { headers: { cookie: plain } })).text, /opsRoot/, 'the page opens on http with the plain name');
  });

  it('refuses a login body over 4 KB, by content-length before reading and while reading without one', async () => {
    const rl = fakeRl(100), { env } = makeEnv({ ADMIN_RL: rl });
    const big = 'key=' + encodeURIComponent(KEY) + '&pad=' + 'x'.repeat(4200);
    let r = await login(env, KEY, { 'content-length': '5000' });
    assert.equal(r.status, 413); assert.equal(r.headers.get('set-cookie'), null);
    const stream = (s) => new ReadableStream({ start(c) { const b = new TextEncoder().encode(s); for (let i = 0; i < b.length; i += 1000) c.enqueue(b.slice(i, i + 1000)); c.close(); } });
    r = await call(env, '/rt/admin/login', { method: 'POST', duplex: 'half', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN }, body: stream(big) });
    assert.equal(r.status, 413, 'no content-length, too long'); assert.equal(r.headers.get('set-cookie'), null);
    r = await call(env, '/rt/admin/login', { method: 'POST', duplex: 'half', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN }, body: stream('key=' + encodeURIComponent(KEY) + '&pad=' + 'x'.repeat(3000)) });
    assert.equal(r.status, 303, 'no content-length, short enough');
  });

  it('sends a Content-Security-Policy with the hash of the page\'s inline script, the same for CRLF and LF copies, cached by etag', async () => {
    const { createHash } = await import('node:crypto');
    const inline = ADMIN_HTML.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
    const want = "'sha256-" + createHash('sha256').update(inline).digest('base64') + "'";
    for (const page of [ADMIN_HTML, ADMIN_HTML.replace(/\n/g, '\r\n')]) {
      const { env } = makeEnv(); env.page = page; const c = await session(env);
      const r = await call(env, '/admin', { headers: { cookie: c } });
      assert.equal(r.text, page, 'the page itself unchanged');
      const csp = r.headers.get('content-security-policy');
      assert.equal(csp, `default-src 'none'; script-src 'self' ${want}; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src https://cdn.jsdelivr.net; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`);
    }
    // the etag keys the cache: a new page under a new etag gets its own hash
    const { env } = makeEnv(); const c = await session(env);
    env.etag = '"a1"'; const h1 = (await call(env, '/admin', { headers: { cookie: c } })).headers.get('content-security-policy');
    env.page = ADMIN_HTML.replaceAll('?v=202611270945', '?v=209912312359'); env.etag = '"a2"';
    const h2 = (await call(env, '/admin', { headers: { cookie: c } })).headers.get('content-security-policy');
    assert.notEqual(h1, h2);
    // what the policy leaves out: the page must not need it
    assert.equal(/\son[a-z]+\s*=/i.test(ADMIN_HTML), false, 'no inline on…= handler attributes');
    assert.deepEqual([...new Set(ADMIN_HTML.match(/https?:\/\/[^\s"')]+/g))], ['https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css']);
    assert.equal((ADMIN_HTML.match(/<script\b(?![^>]*\bsrc=)[^>]*>/g) || []).length, 1, 'one inline script');
    for (const f of MODULES) { const s = read(f); assert.equal(/https?:\/\/[^\s'"]|\bon[a-z]+\s*=\s*["']|eval\(|new Function|import\(/.test(s.replace(/^\s*\/\/.*$/gm, '')), false, f); }
  });

  it('GET /rt/health says whether ADMIN_RL is bound', async () => {
    const real = globalThis.fetch; globalThis.fetch = async () => new Response('[]', { headers: { 'content-type': 'application/json' } }); // the database probe stays off the network
    try {
    assert.equal(JSON.parse((await call(makeEnv({ ADMIN_RL: fakeRl() }).env, '/rt/health')).text).hasAdminRl, true);
    assert.equal(JSON.parse((await call(makeEnv().env, '/rt/health')).text).hasAdminRl, false);
    } finally { globalThis.fetch = real; }
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
  it('main.js: ?maint=skip asks GET /rt/admin/maint with the session cookie, never a stored key', () => {
    const m = read('main.js'), fn = m.slice(m.indexOf('const MAINT_SKIP'), m.indexOf('let maintSkipTold'));
    assert.ok(fn.includes("fetch('/rt/admin/maint', { cache: 'no-store', credentials: 'same-origin' })"), fn);
    assert.equal(/sessionStorage|kts-admin|x-admin-key/.test(fn), false);
    assert.equal(/kts-admin/.test(m), false);
  });
  it('the service worker never answers /admin from a cache', () => {
    const sw = read('sw.js');
    assert.match(sw, /if \(url\.origin !== self\.location\.origin \|\| !url\.pathname\.startsWith\('\/assets\/'\)\) return;/);
    assert.equal(/admin/.test(sw.replace(/^\/\/.*$|\/\*[\s\S]*?\*\//gm, '')), false);
  });
});
