// A withdrawal deletes the login too. Supabase Auth has no route for a user to delete itself, so the Worker calls public.forget_login after
// withdraw_account (schema.sql, migrations/2026-11-22-forget-login.sql). The database is changed by hand, so everything here is checked in both
// states: before the migration (the function is missing: PostgREST answers 404) and after it. As in merge-guard.test.mjs the routes run against
// a JS model of the functions and, when PGlite is installed outside the repo, against the real schema.sql with a small stand-in for auth.users.
// The "before" tests come first on purpose: the Worker remembers a yes for the isolate's whole life.
import { registerHooks, createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, before } from 'node:test';
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
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MIGRATION = 'migrations/2026-11-22-forget-login.sql';

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
    storage: { sql, async getAlarm() { return null; }, async setAlarm() {}, async deleteAlarm() {}, transactionSync(fn) { return fn(); } },
    setWebSocketAutoResponse() {}, getWebSockets() { return []; }, getWebSocketAutoResponseTimestamp() { return new Date(Date.now()); }, acceptWebSocket() {},
  };
}
const stub = (obj) => new Proxy(obj, { get: (t, k) => k === 'fetch' ? (req) => t.fetch(req) : typeof t[k] === 'function' ? async (...a) => structuredClone(await t[k](...structuredClone(a))) : t[k] });
const KEY = 'flush-test-key';
function makeEnv() {
  const meters = new Map(), rooms = new Map();
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: KEY, ADMIN_KEY: 'admin-test-key-123', ASSETS: { fetch: () => new Response('asset', { status: 200 }) } };
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new Meter(makeCtx(sql), env) }); } return meters.get(name); };
  env.room = (topic) => { if (!rooms.has(topic)) { const sql = sqliteStorage(); rooms.set(topic, { sql, do: new Room(makeCtx(sql), env) }); } return rooms.get(topic); };
  env.METER = { idFromName: (name) => name, get: (name) => stub(env.meter(name).do) };
  env.ROOM = { idFromName: (topic) => topic, get: (topic) => stub(env.room(topic).do) };
  return env;
}
// Every Durable Object call that reaches a stub, as 'instance.method', except the 'day' counter itself.
function spyDo(env) {
  const log = [];
  for (const ns of [env.METER, env.ROOM]) { const real = ns.get; ns.get = (name) => { const s = real(name); return new Proxy(s, { get: (t, k) => typeof t[k] === 'function' ? (...a) => { if (name !== 'day') log.push(name + '.' + String(k)); return t[k](...a); } : t[k] }); }; }
  return log;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const UUID = /^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---- Supabase stand-in 1: the functions this needs, in JS. logins = auth.users. ---------------------------------------------------------------
function memDb() {
  const wallets = new Map(), logins = new Map();
  const row = (id, coins = 100) => { if (!wallets.has(id)) wallets.set(id, { actor_id: id, nickname: '네온손님', coins, vip_tickets: 0, linked: false, link_bonus: false }); return wallets.get(id); };
  const fns = {
    profile_read(a) { row(a.p_actor_id); return { ok: true, level: 1, reputation: 0, species: 1, equip: [], owned: [], color: null, starter: false, streak: 0, attend_last: null }; },
    coin_batch(a) { for (const it of a.p_items) { const d = Math.min(Math.max(Number(it.delta), 0), 500); if (wallets.has(it.actor_id)) wallets.get(it.actor_id).coins += d; else row(it.actor_id, 100 + d); } return { ok: true, flushed: a.p_items.length }; },
    spend_plaza(a) { const w = wallets.get(a.p_actor_id); if (a.p_coins !== 30 || !w || w.coins < 30) return { ok: false, error: '코인이 부족해요.' }; w.coins -= 30; return { ok: true, remaining_coins: w.coins, vip_tickets: 0 }; },
    grant_coins(a) { const w = wallets.get(a.p_actor_id); if (!w) return { ok: false, error: '그 지갑을 찾지 못했습니다.' }; w.coins += a.p_amount; return { ok: true, actor_id: w.actor_id, nickname: w.nickname, coins: w.coins }; },
    merge_guest_account(a) {
      if (!wallets.has(a.p_user_id)) wallets.set(a.p_user_id, { actor_id: a.p_user_id, nickname: '네온손님', coins: 0, vip_tickets: 0, linked: true, link_bonus: false });
      const u = wallets.get(a.p_user_id), g = wallets.get(a.p_guest_id); let moved = 0, bonus = 0;
      if (g && g.coins > 0) { moved = g.coins; g.coins = 0; u.coins += moved; }
      if (!u.link_bonus) { u.coins += 300; u.link_bonus = true; bonus = 300; }
      u.linked = true; return { ok: true, actor_id: a.p_user_id, coins: u.coins, bonus, moved, nickname: u.nickname, linked: true };
    },
    withdraw_account(a) { wallets.delete(a.p_actor_id); return { ok: true, actor_id: a.p_actor_id }; },
    forget_login(a) { // schema.sql: only user:<uuid>, never while a wallet row exists
      if (typeof a.p_actor_id !== 'string' || !UUID.test(a.p_actor_id)) return { ok: false, error: 'id' };
      if (wallets.has(a.p_actor_id)) return { ok: false, error: 'wallet' };
      return { ok: true, deleted: logins.delete(a.p_actor_id.slice(5)) ? 1 : 0 };
    },
  };
  return {
    async rpc(name, a) { if (!fns[name]) return { ok: true }; if (a.p_key !== KEY) throw new Error('Unauthorized worker key'); return fns[name](a); },
    async wallet(id) { const w = wallets.get(id); return w ? { ...w } : null; },
    async addLogin(uuid, email) { logins.set(uuid, email || null); },
    async hasLogin(uuid) { return logins.has(uuid); },
  };
}

// ---- Supabase stand-in 2: the real schema.sql in PGlite, with the least of Supabase's auth schema that forget_login touches --------------------
async function loadPGlite() {
  for (const d of [process.env.PGLITE_DIR, join(tmpdir(), 'kts-pglite')].filter(Boolean)) {
    try { const req = createRequire(join(d, 'package.json')); return (await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href)).PGlite; } catch { }
  }
  try { return (await import('@electric-sql/pglite')).PGlite; } catch { return null; }
}
const PGlite = await loadPGlite();
const NO_PG = PGlite ? false : 'PGlite not installed (see test/db.test.mjs for how)';
if (!PGlite) console.log('# forget-login.test: PGlite not installed, the schema.sql half is skipped.');
const ROLES = 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;'; // Supabase gives these; PGlite does not
const AUTH = `CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE TABLE auth.identities (id bigserial PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);
  CREATE TABLE auth.sessions (id bigserial PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);`;
async function pgRaw(schemaText, auth = true) {
  const db = new PGlite(); await db.exec(ROLES); if (auth) await db.exec(AUTH); await db.exec(schemaText);
  await db.query('UPDATE public.app_secrets SET key_value = $1 WHERE key_name = $2', [KEY, 'FLUSH_KEY']); return db;
}
const REAL = ['profile_read', 'coin_batch', 'spend_plaza', 'grant_coins', 'merge_guest_account', 'withdraw_account', 'forget_login', 'save_species', 'set_nickname', 'set_ring_color'];
async function pgDb() {
  const db = await pgRaw(read('schema.sql'));
  return {
    db, pg: true,
    async rpc(name, a) { if (!REAL.includes(name)) return { ok: true }; const keys = Object.keys(a);
      const sql = 'SELECT public.' + name + '(' + keys.map((k, i) => k + ' => $' + (i + 1) + (k === 'p_items' ? '::jsonb' : '')).join(', ') + ') AS r';
      return (await db.query(sql, keys.map((k) => (k === 'p_items' ? JSON.stringify(a[k]) : a[k])))).rows[0].r; },
    async wallet(id) { return (await db.query('SELECT actor_id, nickname, coins::float8 AS coins, vip_tickets, linked, link_bonus FROM public.wallets WHERE actor_id = $1', [id])).rows[0] || null; },
    async addLogin(uuid, email) { await db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [uuid, email || null]); await db.query('INSERT INTO auth.identities (user_id) VALUES ($1)', [uuid]); await db.query('INSERT INTO auth.sessions (user_id) VALUES ($1)', [uuid]); },
    async hasLogin(uuid) { return (await db.query('SELECT count(*)::int n FROM auth.users WHERE id = $1', [uuid])).rows[0].n > 0; },
  };
}

// The Worker's fetch. state.installed: is forget_login in the database (false = the answer PostgREST gives for a missing function).
// state.fail(name, args) may answer in an RPC's place, or throw (a network error). state.rpcs: every RPC as 'name actor'.
const MISSING = { code: 'PGRST202', details: 'Searched for the function public.forget_login with parameters p_actor_id, p_key', hint: null, message: 'Could not find the function public.forget_login(p_actor_id, p_key) in the schema cache' };
function fakeNet(state, db) {
  return async (url, opt = {}) => {
    const u = String(url);
    if (u.includes('/.well-known/jwks.json')) return json({ keys: state.jwks || [] });
    if (u.includes('/auth/v1/')) { state.authCalls.push(u); return json({ msg: 'no such route' }, 405); }
    if (u.includes('/rest/v1/wallets')) { const one = /actor_id=eq\.([^&]+)/.exec(u), many = /actor_id=in\.\(([^)]*)\)/.exec(u), rows = [];
      const ids = one ? [decodeURIComponent(one[1])] : many ? decodeURIComponent(many[1]).split(',').map((x) => x.replace(/^"|"$/g, '')) : [];
      for (const id of ids) { const w = await db.wallet(id); if (w) rows.push(w); } return json(rows); }
    const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u);
    if (m) { const a = JSON.parse(opt.body || '{}'); state.rpcs.push((m[1] + ' ' + (a.p_actor_id || a.p_user_id || '')).trim());
      if (state.slow && state.slow(m[1], a)) { await new Promise((r) => setTimeout(r, 30)); state.slowDone = (state.slowDone || 0) + 1; } // a real pause, counted when it is over
      const bad = state.fail?.(m[1], a); if (bad) return bad;
      if (m[1] === 'forget_login' && !state.installed) return json(MISSING, 404);
      try { return json(await db.rpc(m[1], a)); } catch (e) { return json({ message: String(e?.message || e) }, 400); } }
    if (u.includes('/rest/v1/')) return json([]);
    return new Response('missing', { status: 404 });
  };
}
let clockBase = Date.parse('2030-03-01T03:00:00Z'), kid = 0, seq = 0;
// Each test runs days apart: the isolate's copies (budget level, a remembered "no") of an earlier test are stale for the next one.
async function scene(db, installed) {
  clockBase += 10 * 864e5; let t = clockBase; const origNow = Date.now, origFetch = globalThis.fetch, origWarn = console.warn;
  const state = { rpcs: [], authCalls: [], warns: [], installed };
  Date.now = () => t; globalThis.fetch = fakeNet(state, db); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  console.warn = (...a) => { state.warns.push(a.join(' ')); };
  const env = makeEnv(), waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (p, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + p, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const post = (p, body, token) => call(p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const get = (p, token) => call(p, { headers: token ? { authorization: 'Bearer ' + token } : {} });
  const guest = async () => { const tok = (await (await post('/rt/guest', {})).json()).token, g = { token: tok, id: 'guest:' + JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).s }; assert.equal((await get('/rt/profile', g.token)).status, 200); return g; };
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']), k = 'fl-' + (++kid);
  state.jwks = [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: k }];
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), head = enc({ alg: 'ES256', kid: k });
  // A signed-in account with a login row; email: the e-mail claim of its token (none: a sign-in without one).
  const user = async (email) => { const uuid = 'f0e1d2c3-0000-4000-8000-' + String(++seq).padStart(12, '0'), claims = enc({ sub: uuid, iat: Math.floor(t / 1000), exp: Math.floor(t / 1000) + 86400, iss: 'https://yxddhpacuyaffaoutxjn.supabase.co/auth/v1', aud: 'authenticated', ...(email ? { email } : {}) });
    await db.addLogin(uuid, email);
    return { uuid, id: 'user:' + uuid, token: head + '.' + claims + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(head + '.' + claims))).toString('base64url') }; };
  const coins = async (id) => (await db.wallet(id))?.coins ?? null;
  const earn = (id, n) => db.rpc('coin_batch', { p_key: KEY, p_items: [{ actor_id: id, nickname: '', delta: n, reason: 'mine' }] });
  const link = async (u, g) => { const res = await post('/rt/auth/merge', { guest_id: g.id, guest_token: g.token, nickname: '', topic: 'chapel:square' }, u.token), body = await res.json(); assert.equal(res.status, 200, JSON.stringify(body)); return body; };
  const withdraw = async (u) => { const res = await post('/rt/auth/withdraw', {}, u.token); return { status: res.status, body: await res.json() }; };
  const config = async (q = '') => (await get('/rt/config' + q)).json();
  // The answer as it leaves the Worker, before any waitUntil work is waited for; drain() then lets that work finish.
  const raw = async (p) => (await worker.fetch(new Request('https://sq.example' + p), env, ctx)).json(), drain = async () => { while (waits.length) await Promise.all(waits.splice(0)); };
  const probes = () => state.rpcs.filter((x) => x === 'forget_login probe').length;
  const marks = () => { const d = env.meter('acct').sql.db; return d.prepare("select count(*) n from sqlite_master where name = 'gone'").get().n ? d.prepare('select h from gone').all().map((r) => String(r.h)) : []; };
  return { clock: { add: (ms) => { t += ms; } }, state, env, call, post, get, guest, user, coins, earn, link, withdraw, config, raw, drain, probes, marks, done: () => { Date.now = origNow; globalThis.fetch = origFetch; console.warn = origWarn; } };
}
const utcDay = () => new Date().toISOString().slice(0, 10);
const setUsed = (env, n) => env.meter('day').sql.db.prepare('insert into d values(?, ?) on conflict(day) do update set n = excluded.n').run(utcDay(), n);

// ---- before the migration ---------------------------------------------------------------------------------------------------------------------
describe('withdrawal before the migration: forget_login is not in the database', { concurrency: false }, () => {
  const db = memDb();

  it('/rt/config carries no `forget`; the Worker asks once, with an id the function would refuse, and keeps the no for 10 minutes', async () => {
    const s = await scene(db, false);
    try {
      const log = spyDo(s.env);
      const first = await s.config(); assert.equal('forget' in first, false); assert.equal(s.probes(), 1); // asked behind the first answer
      assert.equal('forget' in (await s.config()), false); assert.equal('forget' in (await s.config('?forget=1')), false); assert.equal(s.probes(), 1);
      s.clock.add(599000); await s.config(); assert.equal(s.probes(), 1);
      s.clock.add(1001); await s.config(); assert.equal(s.probes(), 2); // 10 minutes on: asked again
      // The boot path never waits for the database; the withdrawal sheet's ?forget=1 does.
      s.state.slow = (name) => name === 'forget_login'; s.state.slowDone = 0;
      s.clock.add(600001); await s.raw('/rt/config'); assert.equal(s.state.slowDone, 0); await s.drain(); assert.equal(s.state.slowDone, 1);
      s.clock.add(600001); await s.raw('/rt/config?forget=1'); assert.equal(s.state.slowDone, 2); await s.drain(); assert.equal(s.probes(), 4);
      s.state.slow = null;
      assert.deepEqual(log.filter((x) => x !== 'ops.opsMaintGet'), []); // no Durable Object call for any of it (but the maintenance notice, ops.js: once a minute per isolate)
      assert.deepEqual([...new Set(s.state.rpcs.filter((x) => x.startsWith('forget_login')))], ['forget_login probe']); assert.equal(UUID.test('probe'), false); // only ever with an id no account can have
    } finally { s.done(); }
  });

  it('the withdrawal still succeeds and says the login was kept; the missing function is a logged line, not an error', async () => {
    const s = await scene(db, false);
    try {
      const u = await s.user('Kept.Person@Example.com'), g = await s.guest(); await s.link(u, g); assert.equal(await s.coins(u.id), 400);
      const r = await s.withdraw(u);
      assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, login: 'kept' });
      assert.equal(await s.coins(u.id), null); assert.equal(await db.hasLogin(u.uuid), true); // the account's data is gone, the login is not
      assert.deepEqual(s.state.authCalls, []); // the old DELETE /auth/v1/user, which did nothing, is not sent any more
      assert.equal(s.state.warns.length, 1); assert.match(s.state.warns[0], /^forget_login 404 login kept: Could not find the function/);
      for (const secret of [u.uuid, 'kept.person', KEY]) assert.equal(s.state.warns[0].toLowerCase().includes(secret.toLowerCase()), false, secret);
      assert.equal(s.marks().length, 2); // both marks are written whether or not the login can be deleted
    } finally { s.done(); }
  });

  it('a call that fails, gets no answer or is refused never turns the withdrawal into an error', async () => {
    const s = await scene(db, true);
    try {
      const fails = [
        [() => json({ message: 'upstream' }, 500), /^forget_login 500 login kept: upstream/],
        [() => { throw new TypeError('network down'); }, /^forget_login 0 login kept: no answer/],
        [() => json({ ok: false, error: 'wallet' }), /^forget_login 200 login kept: wallet/], // a wallet row came back in between: the function refuses
        [() => json({ ok: true, deleted: 0 }), /^forget_login 200 login kept: deleted 0/], // nothing was there to delete, or the function could not see it
        [() => json({ message: 'permission denied for table users' }, 403), /^forget_login 403 login kept: permission denied/], // owned by the wrong role
      ];
      for (const [how, line] of fails) {
        const u = await s.user(), g = await s.guest(); await s.link(u, g);
        s.state.fail = (name, a) => (name === 'forget_login' && a.p_actor_id !== 'probe' ? how() : null); s.state.warns.length = 0;
        const r = await s.withdraw(u); assert.deepEqual(r, { status: 200, body: { ok: true, login: 'kept' } });
        assert.equal(await s.coins(u.id), null); assert.equal(await db.hasLogin(u.uuid), true); assert.match(s.state.warns[0], line);
      }
    } finally { s.done(); }
  });
});

// ---- after the migration ----------------------------------------------------------------------------------------------------------------------
function after(label, makeDb, skip) {
  describe('withdrawal after the migration: ' + label, { concurrency: false, skip }, () => {
    let db;
    before(async () => { db = await makeDb(); });

    it('/rt/config carries forget: true, the sheet\'s ?forget=1 waits for the answer, and a yes is never asked again', async () => {
      const s = await scene(db, true);
      try {
        const n0 = s.probes(), log = spyDo(s.env);
        assert.equal((await s.config('?forget=1')).forget, true); // the remembered no of the tests above is days old: asked now, and waited for
        assert.equal((await s.config()).forget, true);
        s.clock.add(3600000); assert.equal((await s.config()).forget, true); s.state.installed = false; assert.equal((await s.config('?forget=1')).forget, true);
        assert.ok(s.probes() - n0 <= 1); assert.deepEqual(log.filter((x) => x !== 'ops.opsMaintGet'), []); // the maintenance notice (ops.js) is the only DO read, once a minute per isolate
      } finally { s.done(); }
    });

    it('the withdrawal deletes the login and says so; what the function touches goes with it', async () => {
      const s = await scene(db, true);
      try {
        const u = await s.user('gone.person@example.com'), other = await s.user('stays@example.com'), g = await s.guest(); await s.link(u, g); await s.link(other, await s.guest());
        const r = await s.withdraw(u);
        assert.deepEqual(r, { status: 200, body: { ok: true, login: 'deleted' } });
        assert.equal(await s.coins(u.id), null); assert.equal(await db.hasLogin(u.uuid), false);
        assert.equal(await db.hasLogin(other.uuid), true); assert.equal(await s.coins(other.id), 400); // nobody else's
        assert.deepEqual(s.state.warns, []); assert.deepEqual(s.state.authCalls, []);
        assert.deepEqual(s.state.rpcs.filter((x) => /^(withdraw_account|forget_login) user:/.test(x)), ['withdraw_account ' + u.id, 'forget_login ' + u.id]); // in that order
        // The token still verifies for a while. A second withdrawal finds no login: it says kept rather than claim a deletion it did not make.
        const again = await s.withdraw(u); assert.deepEqual(again.body, { ok: true, login: 'kept' }); assert.match(s.state.warns[0], /deleted 0/);
      } finally { s.done(); }
    });

    it('a live account is never deleted: with a wallet row the function refuses, whoever calls it', async () => {
      const s = await scene(db, true);
      try {
        const u = await s.user('alive@example.com'); await s.link(u, await s.guest());
        assert.deepEqual(await db.rpc('forget_login', { p_key: KEY, p_actor_id: u.id }), { ok: false, error: 'wallet' });
        assert.equal(await db.hasLogin(u.uuid), true); assert.equal(await s.coins(u.id), 400);
      } finally { s.done(); }
    });

    it('the mark survives the login: a new id made with the same e-mail is not paid the reward again; another e-mail is a first link', async () => {
      const s = await scene(db, true);
      try {
        const a = await s.user('Same.Person@Example.com'); assert.equal((await s.link(a, await s.guest())).bonus, 300); assert.equal(await s.coins(a.id), 400);
        assert.deepEqual((await s.withdraw(a)).body, { ok: true, login: 'deleted' }); assert.equal(await db.hasLogin(a.uuid), false);
        const marks = s.marks(); assert.equal(marks.length, 2); // the id and the e-mail, both as keyed hashes
        for (const h of marks) { assert.match(h, /^[0-9a-f]{32}$/); }
        assert.equal(JSON.stringify(marks).includes('@'), false); assert.equal(JSON.stringify(marks).includes(a.uuid), false);
        // Signs up again with the same Google account or e-mail: a new id (written differently, as providers do).
        const b = await s.user('same.person@EXAMPLE.com'); assert.notEqual(b.id, a.id);
        const g = await s.guest(); await s.earn(g.id, 65); // 100 + its hello 40 + 25 it really earned
        const r = await s.link(b, g); // before coins.sql the database pays 300 and the Worker takes 440 back; after it, the database pays nothing and leaves 140 out
        assert.equal(r.bonus, 0); assert.equal(r.again, true); assert.equal(r.coins, 25); assert.equal(await s.coins(b.id), 25);
        // Somebody else, and a sign-in whose token has no e-mail at all: first links.
        const c = await s.user('someone.else@example.com'); assert.equal((await s.link(c, await s.guest())).bonus, 300); assert.equal(await s.coins(c.id), 400);
        const d = await s.user(); assert.equal((await s.link(d, await s.guest())).bonus, 300);
        assert.deepEqual((await s.withdraw(d)).body, { ok: true, login: 'deleted' }); assert.equal(s.marks().length, 3); // one mark only: its id
        const e = await s.user(); assert.equal((await s.link(e, await s.guest())).bonus, 300); // a new id with no e-mail matches nothing
      } finally { s.done(); }
    });

    it('budget level hard: the mark is still written (one acct call), and the login is still deleted', async () => {
      const s = await scene(db, true);
      try {
        const a = await s.user('hard.day@example.com'); await s.link(a, await s.guest());
        setUsed(s.env, 96000); s.clock.add(61000); assert.equal((await (await s.get('/rt/wishes')).json()).busy, true);
        const log = spyDo(s.env);
        assert.deepEqual((await s.withdraw(a)).body, { ok: true, login: 'deleted' }); assert.equal(await db.hasLogin(a.uuid), false);
        assert.deepEqual(log.filter((x) => /^acct\.(gone|st)/.test(x)), ['acct.goneSet']); assert.equal(s.marks().length, 2);
      } finally { s.done(); }
    });

    it('after the withdrawal its token (still valid for up to an hour) gets no wallet back in the database and moves no coins', async () => {
      const s = await scene(db, true);
      try {
        const a = await s.user('token.after@example.com'); await s.link(a, await s.guest());
        s.clock.add(5000); assert.deepEqual((await s.withdraw(a)).body, { ok: true, login: 'deleted' });
        const prof = await s.get('/rt/profile', a.token);
        // wallets_need_login: no login, no row. The profile functions say so ({ ok: false, error: 'login' }) and the Worker answers a plain 401
        // gone, not a 502 (they used to fail on the profiles foreign key). The model keeps no logins, so this part is the database's.
        const GONE = { ok: false, err: 'gone', error: '탈퇴한 계정이에요. 다시 로그인해 주세요.' };
        if (db.pg) { assert.equal(prof.status, 401); assert.deepEqual(await prof.json(), GONE); assert.equal(await s.coins(a.id), null); await s.earn(a.id, 300); assert.equal(await s.coins(a.id), null);
          for (const body of [{ species: 2 }, { nickname: '돌아온이름' }, { color: '#112233' }]) { const r = await s.post('/rt/profile', body, a.token); assert.equal(r.status, 401, JSON.stringify(body)); assert.deepEqual(await r.json(), GONE); }
          assert.equal(await s.coins(a.id), null); }
        const g = await s.guest(), res = await s.post('/rt/auth/merge', { guest_id: g.id, guest_token: g.token, nickname: '' }, a.token);
        assert.equal(res.status, 401); assert.equal((await res.json()).err, 'gone'); assert.equal(await s.coins(g.id), 100);
      } finally { s.done(); }
    });
  });
}
after('model', async () => memDb(), false);
after('schema.sql in PGlite', pgDb, NO_PG);

// ---- the function itself, and the file that installs it ---------------------------------------------------------------------------------------
describe('forget_login in PGlite', { skip: NO_PG, concurrency: false }, () => {
  let db;
  const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222';
  const call = async (key, id) => (await db.query('SELECT public.forget_login($1, $2) AS r', [key, id])).rows[0].r;
  const logins = async () => (await db.query('SELECT (SELECT count(*) FROM auth.users)::int u, (SELECT count(*) FROM auth.identities)::int i, (SELECT count(*) FROM auth.sessions)::int s')).rows[0];
  before(async () => { db = await pgRaw(read('schema.sql'));
    for (const id of [U1, U2]) { await db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id, id.slice(0, 4) + '@example.com']); await db.query('INSERT INTO auth.identities (user_id) VALUES ($1), ($1)', [id]); await db.query('INSERT INTO auth.sessions (user_id) VALUES ($1)', [id]); } });

  it('needs the Worker key, and takes only user:<uuid>', async () => {
    await assert.rejects(call('wrong', 'user:' + U1), /Unauthorized worker key/); await assert.rejects(call(null, 'user:' + U1), /Unauthorized worker key/);
    for (const bad of ['probe', '', null, U1, 'user:nope', 'guest:g-' + U1, 'user:AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', 'user:' + U1 + ' ', "user:' OR 1=1 --", 'user:%']) assert.deepEqual(await call(KEY, bad), { ok: false, error: 'id' }, String(bad));
    assert.deepEqual(await logins(), { u: 2, i: 4, s: 2 });
  });
  it('refuses while the wallet row exists; without it the login goes, with its identities and sessions, once', async () => {
    await db.query('INSERT INTO public.wallets (actor_id) VALUES ($1)', ['user:' + U1]);
    assert.deepEqual(await call(KEY, 'user:' + U1), { ok: false, error: 'wallet' }); assert.deepEqual(await logins(), { u: 2, i: 4, s: 2 });
    assert.equal((await db.query('SELECT public.withdraw_account($1, $2) AS r', [KEY, 'user:' + U1])).rows[0].r.ok, true);
    assert.deepEqual(await call(KEY, 'user:' + U1), { ok: true, deleted: 1 }); assert.deepEqual(await logins(), { u: 1, i: 2, s: 1 });
    assert.deepEqual(await call(KEY, 'user:' + U1), { ok: true, deleted: 0 }); assert.deepEqual(await logins(), { u: 1, i: 2, s: 1 });
    assert.deepEqual(await call(KEY, 'user:00000000-0000-0000-0000-000000000000'), { ok: true, deleted: 0 }); // the migration's own check
  });
  it('runs as its owner with search_path public, and has the grants of spend_plaza', async () => {
    const rows = (await db.query("SELECT proname, prosecdef, proconfig::text cfg, proacl::text acl FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('forget_login', 'spend_plaza') ORDER BY proname")).rows;
    assert.equal(rows.length, 2); assert.equal(rows[0].prosecdef, true); assert.equal(rows[0].cfg, '{search_path=public}'); assert.equal(rows[0].acl, rows[1].acl);
    assert.doesNotMatch(rows[0].acl, /(^|[{,])=X/); // not PUBLIC
  });
});

const fnText = (sql) => { const at = sql.lastIndexOf('CREATE OR REPLACE FUNCTION public.forget_login('); return at < 0 ? null : sql.slice(at, sql.indexOf('\n$$;', at) + 4); };
const lastSelect = (sql) => sql.slice(sql.lastIndexOf('\nSELECT ') + 1);
describe('the migration file', { concurrency: false }, () => {
  const mig = read(MIGRATION), schema = read('schema.sql');
  it('restates the function exactly as schema.sql has it, replaces no other function, and says how to run and check it', () => {
    assert.ok(fnText(mig)); assert.equal(fnText(mig), fnText(schema));
    assert.deepEqual([...mig.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1]), ['forget_login']); // withdraw_account is not replaced
    for (const said of ['postgres', 'SECURITY DEFINER', 'destructive operation', '몇 번을 실행해도', 'kts_forget', "'user:00000000-0000-0000-0000-000000000000'", 'Authentication > Users']) assert.ok(mig.includes(said), said);
    assert.match(mig, /REVOKE ALL ON FUNCTION public\.forget_login\(TEXT, TEXT\) FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION public\.forget_login\(TEXT, TEXT\) TO anon, authenticated, service_role;/);
    assert.ok(schema.includes('REVOKE ALL ON FUNCTION public.forget_login(TEXT, TEXT) FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION public.forget_login(TEXT, TEXT) TO anon, authenticated, service_role;'));
    const top = mig.replace(/AS \$\$[\s\S]*?\n\$\$;/g, '').replace(/DO (\$\w*\$)[\s\S]*?\1;/g, '').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n'); // outside function bodies, DO blocks and comments
    assert.doesNotMatch(top, /\b(DROP|DELETE|TRUNCATE|ALTER|UPDATE|INSERT)\b/i);
    assert.equal(/eyJ|sb_secret|service_role key/i.test(mig), false); // no key of any kind
  });
  it('installs the function on a database that lacks it, reports the state in its last SELECT, and can be run again', { skip: NO_PG }, async () => {
    const neu = await pgRaw(schema), old = await pgRaw(schema);
    await old.exec('DROP FUNCTION public.forget_login(text, text);'); // production today
    await old.query("INSERT INTO auth.users (id, email) VALUES ('33333333-3333-4333-8333-333333333333', 'here@example.com')");
    await old.exec('CREATE TEMP TABLE IF NOT EXISTS kts_forget (k TEXT PRIMARY KEY, v TEXT);');
    const before = (await old.query(lastSelect(mig))).rows; // the status table alone, before anything is installed
    assert.equal(before.length, 1); assert.equal(before[0].applied, false); assert.match(before[0].note, /forget_login\(text,text\)이 없습니다/);
    const def = async (d) => (await d.query("SELECT pg_get_functiondef(p.oid) def, p.proacl::text acl, p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure('public.forget_login(text,text)')")).rows;
    for (const round of [1, 2, 3]) {
      const rows = (await old.exec(mig)).at(-1).rows;
      assert.equal(rows.length, 1, 'round ' + round); assert.equal(rows[0].applied, true); assert.equal(rows[0].part, '탈퇴 때 로그인 정보 지우기'); assert.match(rows[0].note, /^적용됨\. 주인 \S+\. 없는 계정으로 시험 호출해 0줄 삭제를 확인했습니다$/);
      assert.deepEqual(await def(old), await def(neu)); // the same function, definer and grants as a database made from schema.sql
    }
    assert.equal((await old.query('SELECT count(*)::int n FROM auth.users')).rows[0].n, 1); // the check deleted nobody
    assert.equal((await old.query('SELECT count(*)::int n FROM public.wallets')).rows[0].n, (await neu.query('SELECT count(*)::int n FROM public.wallets')).rows[0].n); // and left nothing behind
    // A function that cannot delete (here: no auth.users at all) is reported as not applied, with the reason.
    const bare = await pgRaw(schema, false), rows = (await bare.exec(mig)).at(-1).rows;
    assert.equal(rows[0].applied, false); assert.match(rows[0].note, /함수는 있지만 지우지 못합니다\(주인 \S+\): .*auth\.users/);
    await neu.close(); await old.close(); await bare.close();
  });
});

// ---- the screens say what will happen, in both states (source pins) ---------------------------------------------------------------------------
describe('withdrawal screens', () => {
  const ui = read('ui.js'), main = read('main.js'), net = read('net.js'), legal = read('legal.js'), wk = read('worker.js');
  const between = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a); return s.slice(i + a.length, j); };
  it('the sheet lists the login only when the Worker says it will be deleted; otherwise a note says the operator removes it', () => {
    const w = between(ui, '  function openWithdraw() {', '\n  // ---------------------------------------------------------------- HUD readouts');
    assert.match(w, /const loginItem = h\('li', \{ text: '계정 자체 \(로그인 정보\)' \}\);/);
    assert.match(w, /const loginNote = h\('p', \{ class: 'note', text: '로그인 정보\(이메일·소셜 로그인 식별자\)는 자동으로 지워지지 않아요\. 탈퇴 뒤 운영자가 지웁니다\.' \}\);/);
    assert.match(w, /const showLogin = \(deleted\) => \{ loginItem\.hidden = !deleted; loginNote\.hidden = !!deleted; \};/);
    assert.match(w, /showLogin\(hooks\.forgetKnown\?\.\(\) === true\);/); // what is known when the sheet opens; unknown reads as "not deleted"
    assert.match(w, /hooks\.forgetLogin\?\.\(\)\)\.then\(\(yes\) => \{ if \(sheet === me\) showLogin\(yes === true\); \}\)/); // then asked afresh
    const list = between(w, "h('ul', { class: 'gone-list' },", '),\n        loginNote,'); assert.match(list, /^\s*loginItem,/); assert.equal(list.includes('자동으로 지워지지'), false); // the note is not in the "모두 지워지고" list
    assert.equal((w.match(/계정 자체/g) || []).length, 1);
  });
  it('main.js picks the toast from the answer, and net.js hands the answer on and asks the Worker with ?forget=1', () => {
    const fn = between(main, 'async function withdrawAccount() {', '// 로그아웃');
    assert.match(fn, /const data = await net\.withdrawAccount\(\);\s+await becomeGuest\(\{ push: false \}\);\s+return data;/);
    assert.match(fn, /ui\.note\(res\?\.login === 'kept' \? '탈퇴했어요\. 로그인 정보는 운영자가 확인한 뒤 지웁니다\.' : '탈퇴했고, 내 전광판과 토지 소유를 비웠어요', 'ok'\);/);
    assert.match(main, /forgetKnown: \(\) => net\.forget === true,/); assert.match(main, /forgetLogin: \(\) => net\.forgetLogin\(\),/);
    assert.match(net, /async forgetLogin\(\) \{ try \{ const r = await fetch\('\/rt\/config\?forget=1', \{ cache: 'no-store' \}\); const j = r\.ok \? await r\.json\(\) : null; this\.forget = j\?\.forget === true; \} catch \{ this\.forget = false; \} return this\.forget; \}/);
    assert.match(net, /this\.forget = j\?\.forget === true;/);
    assert.match(between(net, '  async withdrawAccount() {', '\n'), /return data; \}$/);
  });
  it('the privacy text is true in both states and says what is kept after a withdrawal', () => {
    const privacy = between(legal, 'function privacy()', 'function terms()'), keep = between(privacy, "{ h: '보유 기간', p: `", '` },');
    assert.match(keep, /^회원 탈퇴 시 삭제합니다\./);
    assert.match(keep, /로그인 정보\(이메일 또는 소셜 로그인 식별자\)는 탈퇴와 함께 지웁니다\./);
    assert.match(keep, /자동으로 지워지지 않는다고 안내한 경우에는 운영자가 확인한 뒤 지우며, \$\{CONTACT\}에게 요청하면 지웁니다\./); // before the migration
    assert.match(keep, /연결 보상이 다시 지급되는 것을 막으려고, 계정으로 되돌릴 수 없는 값\(계정 식별자와 이메일을 각각 해시한 값\)만 보관합니다\./);
    assert.match(privacy, /Google 애널리틱스/); // the section metrics.test.mjs pins is still there
  });
  it('the Worker no longer sends the DELETE that did nothing, and holds no service key', () => {
    assert.equal(wk.includes('/auth/v1/user'), false); assert.equal(/auth\/v1\/admin/.test(wk), false);
    assert.equal(/service_role/.test(wk), false);
    assert.match(wk, /return J\(\{ ok: true, login \}\);/);
  });
});
