// Bot protection for the coin rewards (docs/bot-protection.md): with Turnstile on (TURNSTILE_SITE + TURNSTILE_SECRET), the rewards a scripted
// account could farm need a fresh human check of their own action. The link reward +300 ('link') is held back from the link and claimed at
// /rt/link-reward; the link itself never waits and never fails because of Turnstile. The share bonus ('bonus') and a VIP code ('code') need a
// token in the call. siteverify that cannot judge: nothing is paid unverified, and nothing is lost (the held reward stays to be claimed).
// The link runs in both database states (migrations/2026-11-22-coins.sql before and after), as a JS model and, when PGlite is installed, in a
// real schema (see test/merge-guard.test.mjs for how).
import { registerHooks, createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
// No browser globals here (PGlite does not start under them): the page's side is test/reward-client.test.mjs.

const W = await import('../worker.js');
const worker = W.default, { Meter, Room } = W;
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

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
function makeEnv(extra = {}) {
  const meters = new Map(), rooms = new Map();
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: KEY, ADMIN_KEY: 'admin-test-key-123', ASSETS: { fetch: () => new Response('asset', { status: 200 }) }, ...extra };
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
// One acct method throwing (the DO unreachable), the rest as they are.
function breakAcct(env, method) { const real = env.METER.get; env.METER.get = (n) => (n === 'acct' ? new Proxy(real(n), { get: (t, k) => (k === method ? async () => { throw new Error('do down'); } : t[k]) }) : real(n)); return () => { env.METER.get = real; }; }
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const SITE = '0x4AAAAAAAtestSiteKey', SECRET = 'test-secret-not-real', ON = { TURNSTILE_SITE: SITE, TURNSTILE_SECRET: SECRET };
const HUMAN_NO = { ok: false, err: 'human', code: 'human', site: SITE, error: '사람인지 확인하지 못했어요. 다시 시도해 주세요.' };
const BUSY = { ok: false, code: 'busy', error: '지금은 광장이 붐벼요. 잠시 뒤에 다시 해 주세요.' };

// ---- Supabase stand-ins (as in merge-guard.test.mjs) -----------------------------------------------------------------------------------------
function memDb({ guard = false } = {}) {
  const wallets = new Map(), boards = [], taken = new Map(), gone = new Set();
  const row = (id, coins = 100) => { if (!wallets.has(id)) wallets.set(id, { actor_id: id, nickname: '네온손님', coins: guard && id.startsWith('user:') ? Math.max(0, coins - 100) : coins, vip_tickets: 0, linked: false, link_bonus: false }); return wallets.get(id); };
  const bad = (a) => (!/^user:[A-Za-z0-9_-]{8,80}$/.test(a.p_user_id || '') ? '계정 정보가 올바르지 않습니다.' : !/^guest:g-[0-9a-f-]{36}$/.test(a.p_guest_id || '') ? '게스트 정보가 올바르지 않습니다.' : '');
  const fns = {
    profile_read(a) { row(a.p_actor_id); return { ok: true, level: 1, reputation: 0, species: 1, equip: [], owned: [], color: null, starter: false, streak: 0, attend_last: null }; },
    coin_batch(a) { for (const it of a.p_items) { const d = Math.min(Math.max(Number(it.delta), 0), 500); if (wallets.has(it.actor_id)) wallets.get(it.actor_id).coins += d; else row(it.actor_id, 100 + d); } return { ok: true, flushed: a.p_items.length }; },
    spend_plaza(a) {
      if (!((a.p_coins === 30 && a.p_tickets === 0) || (a.p_coins === 5000 && a.p_tickets === 0) || (a.p_coins === 0 && a.p_tickets === 1))) return { ok: false, error: '그 금액은 쓸 수 없어요.' };
      const w = wallets.get(a.p_actor_id); if (!w) return { ok: false, error: '지갑을 찾지 못했습니다.' };
      if (a.p_coins > 0 && w.coins < a.p_coins) return { ok: false, error: '코인이 부족해요.' };
      w.coins -= a.p_coins; w.vip_tickets -= a.p_tickets; return { ok: true, remaining_coins: w.coins, vip_tickets: w.vip_tickets };
    },
    grant_coins(a) {
      if (!(a.p_amount >= 1 && a.p_amount <= 1000000)) return { ok: false, error: '1에서 100만 코인까지 지급할 수 있어요.' };
      const w = wallets.get(a.p_actor_id); if (!w) return { ok: false, error: '그 지갑을 찾지 못했습니다.' };
      w.coins += a.p_amount; return { ok: true, actor_id: w.actor_id, nickname: w.nickname, coins: w.coins };
    },
    merge_guest_account(a) {
      const no = bad(a); if (no) return guard ? { ok: false, error: no, guard: 2 } : { ok: false, error: no };
      if (!wallets.has(a.p_user_id)) wallets.set(a.p_user_id, { actor_id: a.p_user_id, nickname: '네온손님', coins: 0, vip_tickets: 0, linked: true, link_bonus: false });
      const u = wallets.get(a.p_user_id), g = wallets.get(a.p_guest_id); let moved = 0, bonus = 0;
      if (g && g.coins > 0) { moved = g.coins; g.coins = 0; }
      const nick = () => { u.linked = true; for (const b of boards) if (b.holder_id === a.p_guest_id) b.holder_id = a.p_user_id; };
      if (!guard) { u.coins += moved; if (!u.link_bonus) { u.coins += 300; u.link_bonus = true; bonus = 300; } nick(); return { ok: true, actor_id: a.p_user_id, coins: u.coins, bonus, moved, nickname: u.nickname, linked: true }; }
      let t = taken.get(a.p_guest_id) || 0, back = 0; const again = !u.link_bonus && gone.has(a.p_user_id);
      if (!u.link_bonus && !again) { bonus = 300; t = Math.max(t, Math.min(140, moved)); } else { back = Math.min(moved, Math.max(0, 140 - t)); t += back; }
      taken.set(a.p_guest_id, t); u.coins += moved - back + bonus; u.link_bonus = true; nick();
      return { ok: true, actor_id: a.p_user_id, coins: u.coins, bonus, moved_in: moved, back, again, nickname: u.nickname, linked: true, guard: 2 };
    },
    withdraw_account(a) { for (const b of boards) if (b.holder_id === a.p_actor_id) b.holder_id = null; if (wallets.delete(a.p_actor_id) && guard) gone.add(a.p_actor_id); return { ok: true, actor_id: a.p_actor_id }; },
  };
  return {
    guard,
    async rpc(name, a) { if (!fns[name]) return { ok: true }; if (a.p_key !== KEY) throw new Error('Unauthorized worker key'); return fns[name](a); },
    async wallet(id) { const w = wallets.get(id); return w ? { ...w } : null; },
    async boards(holder) { return boards.filter((b) => b.holder_id === holder).map((b) => ({ ...b })); },
    async hold(slot, id) { const b = boards.find((x) => x.slot_id === slot); if (b) b.holder_id = id; else boards.push({ slot_id: slot, holder_id: id }); },
  };
}
async function loadPGlite() {
  for (const d of [process.env.PGLITE_DIR, join(tmpdir(), 'kts-pglite')].filter(Boolean)) {
    try { const req = createRequire(join(d, 'package.json')); return (await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href)).PGlite; } catch { }
  }
  try { return (await import('@electric-sql/pglite')).PGlite; } catch { return null; }
}
const PGlite = await loadPGlite();
if (!PGlite) console.log('# reward-guard.test: PGlite not installed, the schema.sql halves are skipped (see test/merge-guard.test.mjs).');
const OLD_SCHEMA = (() => { try { return execFileSync('git', ['show', 'aef1e9f:schema.sql'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n'); } catch { return null; } })();
const REAL = ['profile_read', 'coin_batch', 'spend_plaza', 'grant_coins', 'merge_guest_account', 'withdraw_account'];
async function pgDb(schemaText, guard) {
  const db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(schemaText);
  await db.query('UPDATE public.app_secrets SET key_value = $1 WHERE key_name = $2', [KEY, 'FLUSH_KEY']);
  return {
    guard,
    async rpc(name, a) { if (!REAL.includes(name)) return { ok: true }; const keys = Object.keys(a);
      const sql = 'SELECT public.' + name + '(' + keys.map((k, i) => k + ' => $' + (i + 1) + (k === 'p_items' ? '::jsonb' : '')).join(', ') + ') AS r';
      return (await db.query(sql, keys.map((k) => (k === 'p_items' ? JSON.stringify(a[k]) : a[k])))).rows[0].r; },
    async wallet(id) { return (await db.query('SELECT actor_id, nickname, coins::float8 AS coins, vip_tickets, linked, link_bonus FROM public.wallets WHERE actor_id = $1', [id])).rows[0] || null; },
    async boards(holder) { return (await db.query('SELECT slot_id, holder_id FROM public.billboards WHERE holder_id = $1', [holder])).rows; },
    async hold(slot, id) { const r = await db.query("UPDATE public.billboards SET holder_id = $1, holder_name = '주인', lit_until = now() + interval '1 day', expires_at = now() + interval '1 day' WHERE slot_id = $2", [id, slot]); assert.equal(r.affectedRows, 1, slot); },
  };
}
const NO_PG = PGlite ? false : 'PGlite not installed (see the first lines of this file)';
const NO_OLD = NO_PG || (OLD_SCHEMA ? false : 'git show aef1e9f:schema.sql not available');

// The Worker's fetch: Supabase from `db`, siteverify from state.verify (default: a pass of the action 'link' for the token 'good',
// any other token refused). state.verifies: every siteverify body. state.fail(name, args) may answer an RPC in its place.
function fakeNet(state, db) {
  return async (url, opt = {}) => {
    const u = String(url);
    if (u.startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) { const b = JSON.parse(opt.body || '{}'); state.verifies.push(b);
      return state.verify ? state.verify(b) : json(b.response === 'good' ? { success: true, action: state.action || 'link', hostname: 'localhost' } : { success: false, 'error-codes': ['invalid-input-response'] }); }
    if (u.includes('/.well-known/jwks.json')) return json({ keys: state.jwks || [] });
    if (u.includes('/auth/v1/user')) return json({});
    if (u.includes('/rest/v1/billboards')) { const h = /holder_id=eq\.([^&]+)/.exec(u); return json(h ? await db.boards(decodeURIComponent(h[1])) : []); }
    if (u.includes('/rest/v1/wallets') && u.includes('actor_id=in.(')) { const ids = decodeURIComponent(/actor_id=in\.\(([^)]*)\)/.exec(u)[1]).split(',').map((x) => x.replace(/^"|"$/g, '')), rows = [];
      for (const id of ids) { const w = await db.wallet(id); if (w) rows.push(w); } return json(rows); }
    if (u.includes('/rest/v1/wallets')) { const m = /actor_id=eq\.([^&]+)/.exec(u), id = m ? decodeURIComponent(m[1]) : ''; const w = id ? await db.wallet(id) : null; return json(w ? [w] : []); }
    const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u);
    if (m) { const a = JSON.parse(opt.body || '{}'); state.rpcs.push([m[1], a.p_actor_id || a.p_user_id || '', a.p_coins ?? a.p_amount ?? ''].join(' ').trim());
      const bad = state.fail?.(m[1], a); if (bad) return bad;
      try { return json(await db.rpc(m[1], a)); } catch (e) { return json({ message: String(e?.message || e) }, 400); } }
    if (u.includes('/rest/v1/')) return json([]);
    return new Response('missing', { status: 404 });
  };
}
let clockBase = Date.parse('2033-03-01T03:00:00Z'), kid = 0, seq = 0;
const utcDay = () => new Date().toISOString().slice(0, 10);
const setUsed = (env, n) => env.meter('day').sql.db.prepare('insert into d(day, n) values(?, ?) on conflict(day) do update set n = excluded.n').run(utcDay(), n);
async function scene(db, extra = {}) {
  clockBase += 10 * 864e5; let t = clockBase; const origNow = Date.now, origFetch = globalThis.fetch, state = { rpcs: [], verifies: [], verify: null, action: '' };
  Date.now = () => t; globalThis.fetch = fakeNet(state, db); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  const env = makeEnv(extra), waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (p, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + p, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const post = async (p, body, token, ip = '1.1.1.1') => { const res = await call(p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() }; };
  const get = (p, token) => call(p, { headers: token ? { authorization: 'Bearer ' + token } : {} });
  const coins = async (id) => (await db.wallet(id))?.coins ?? null;
  const earn = (id, n) => db.rpc('coin_batch', { p_key: KEY, p_items: [{ actor_id: id, nickname: '', delta: n, reason: 'mine' }] });
  // A guest that entered: the profile read makes its row with 100 and the hello bonus pays 40. Minted while Turnstile is off (a renewal or a
  // handover would need none either); the tests here are about the rewards, not the mint.
  const guest = async () => { const was = env.TURNSTILE_SECRET; delete env.TURNSTILE_SECRET; const tok = (await post('/rt/guest', {})).body.token; if (was) env.TURNSTILE_SECRET = was;
    const g = { token: tok, id: 'guest:' + JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).s };
    assert.equal((await get('/rt/profile', g.token)).status, 200); await db.rpc('coin_batch', { p_key: KEY, p_items: [{ actor_id: g.id, nickname: '', delta: 40, reason: 'bonus' }] }); return g; };
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']), k = 'rg-' + (++kid);
  state.jwks = [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: k }];
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), head = enc({ alg: 'ES256', kid: k });
  const sign = async (sub, more) => { const claims = enc({ sub, iat: Math.floor(t / 1000), exp: Math.floor(t / 1000) + 86400, iss: 'https://yxddhpacuyaffaoutxjn.supabase.co/auth/v1', aud: 'authenticated', ...more });
    return head + '.' + claims + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(head + '.' + claims))).toString('base64url'); };
  const user = async (anon = false) => { const sub = '7eed0000-0000-4000-8000-' + String(++seq).padStart(12, '0'); return { sub, id: 'user:' + sub, token: await sign(sub, anon ? { is_anonymous: true } : {}) }; };
  const relogin = async (u) => { t += 1000; return { ...u, token: await sign(u.sub, {}) }; };
  // The link as net.js sends it (no token: the link never asks for one).
  const link = async (u, g, more = {}) => { const r = await post('/rt/auth/merge', { guest_id: g.id, guest_token: g.token, nickname: '', topic: 'chapel:square', ...more }, u.token);
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.ok, true); assert.equal(r.body.linked, true);
    assert.deepEqual(Object.keys(r.body).filter((x) => x !== 'again' && x !== 'held').sort(), ['actor_id', 'bonus', 'coins', 'linked', 'nickname', 'ok']); return r.body; };
  const claim = (u, ts, ip) => post('/rt/link-reward', ts === undefined ? {} : { ts }, u.token, ip);
  const owed = (id) => { const q = env.meter('acct').sql.db; return q.prepare("select count(*) n from sqlite_master where name = 'lrw'").get().n ? (q.prepare('select n from lrw where u = ?').get(id)?.n ?? null) : null; };
  const grants = () => state.rpcs.filter((x) => x.startsWith('grant_coins '));
  const burns = () => state.rpcs.filter((x) => x.startsWith('spend_plaza '));
  const hard = async () => { setUsed(env, 96000); t += 61000; assert.equal((await (await get('/rt/wishes')).json()).busy, true); };
  const calm = async () => { setUsed(env, 10); t += 61000; await get('/rt/wishes'); };
  return { state, env, call, post, get, coins, earn, guest, user, relogin, link, claim, owed, grants, burns, hard, calm, clock: { add: (ms) => { t += ms; } }, done: () => { Date.now = origNow; globalThis.fetch = origFetch; } };
}

// ---- the link reward ---------------------------------------------------------------------------------------------------------------------------
function linkSuite(label, makeDb, skip) {
  describe('link reward behind Turnstile: ' + label, { concurrency: false, skip }, () => {
    let db;
    before(async () => { db = await makeDb(); });

    it('switched off: the link pays +300 at once, asks siteverify nothing, keeps nothing back, and the claim route has nothing to give', async () => {
      const s = await scene(db, { TURNSTILE_SITE: SITE });
      try {
        const u = await s.user(), g = await s.guest(), r = await s.link(u, g, { ts: 'good' });
        assert.equal(r.bonus, 300); assert.equal('held' in r, false); assert.equal(r.coins, 440); assert.equal(await s.coins(u.id), 440);
        assert.equal(s.state.verifies.length, 0); assert.deepEqual(s.burns(), []); assert.equal(s.owed(u.id), null);
        const c = await s.claim(u); assert.equal(c.status, 200); assert.deepEqual(c.body, { ok: true, amount: 0 }); assert.equal(s.state.verifies.length, 0);
      } finally { s.done(); }
    });

    it('switched on: the link moves everything without a token and without siteverify; the +300 is held, then paid once with a link token', async () => {
      const s = await scene(db, ON);
      try {
        const u = await s.user(), g = await s.guest(); await s.earn(g.id, 60); await db.hold('STREET_1', g.id);
        const r = await s.link(u, g);
        assert.equal(r.bonus, 0); assert.equal(r.held, 300); assert.equal(r.coins, 200, 'the guest\'s 200 moved, the 300 waits');
        assert.equal(await s.coins(u.id), 200); assert.equal(await s.coins(g.id), 0); assert.deepEqual((await db.boards(u.id)).map((b) => b.slot_id), ['STREET_1']);
        assert.equal(s.state.verifies.length, 0, 'the link never asks Cloudflare'); assert.equal(s.owed(u.id), 300); assert.equal(s.burns().length, 10);
        // No token, a refused one, a token for another action: 403 human, nothing taken, nothing paid.
        const none = await s.claim(u); assert.equal(none.status, 403); assert.deepEqual(none.body, HUMAN_NO); assert.equal(s.state.verifies.length, 0);
        assert.equal((await s.claim(u, 'forged')).status, 403);
        s.state.action = 'bonus'; assert.deepEqual((await s.claim(u, 'good')).body, HUMAN_NO); s.state.action = '';
        assert.equal(s.owed(u.id), 300); assert.deepEqual(s.grants().filter((x) => x.includes(u.id)), []);
        // siteverify that cannot judge: 503 busy, the reward still waits.
        for (const v of [() => { throw new Error('network'); }, () => json({ message: 'upstream' }, 502), () => json({ success: false, 'error-codes': ['internal-error'] })]) {
          s.state.verify = v; const warn = console.warn; console.warn = () => {}; const down = await s.claim(u, 'good'); console.warn = warn;
          assert.equal(down.status, 503); assert.deepEqual(down.body, BUSY); assert.equal(s.owed(u.id), 300);
        }
        s.state.verify = null;
        const ok = await s.claim(u, 'good', '203.0.113.5'); assert.equal(ok.status, 200); assert.deepEqual(ok.body, { ok: true, coins: 500, amount: 300 });
        assert.deepEqual(s.state.verifies.at(-1), { secret: SECRET, response: 'good', remoteip: '203.0.113.5' });
        assert.equal(await s.coins(u.id), 500); assert.equal(s.owed(u.id), 0);
        assert.deepEqual((await s.claim(u, 'good')).body, { ok: true, amount: 0 }, 'once: a second claim has nothing to give');
        assert.equal(await s.coins(u.id), 500);
      } finally { s.done(); }
    });

    it('a claim that failed is offered again: the next link replay says held (one acct call), on any guest; paid, the replay says nothing', async () => {
      const s = await scene(db, ON);
      try {
        const u = await s.user(), g = await s.guest(); assert.equal((await s.link(u, g)).held, 300);
        const log = spyDo(s.env);
        const again = await s.link(await s.relogin(u), g); assert.equal(again.held, 300); assert.equal(again.bonus, 0); assert.equal(again.coins, 140);
        assert.deepEqual(log.filter((x) => x.startsWith('acct.lr')), ['acct.lrOwed']);
        const other = await s.link(u, await s.guest()); assert.equal(other.held, 300, 'a new guest on another device'); assert.equal(other.coins, 140);
        assert.equal((await s.claim(u, 'good')).body.amount, 300);
        const after = await s.link(u, g); assert.equal('held' in after, false); assert.equal(after.coins, 440);
      } finally { s.done(); }
    });

    it('the link never fails because of Turnstile: a junk token in the body, siteverify down, a take-back or acct that fail all still link', async () => {
      const s = await scene(db, ON), warn = console.warn; console.warn = () => {};
      try {
        s.state.verify = () => { throw new Error('network'); };
        const a = await s.user(), r1 = await s.link(a, await s.guest(), { ts: 'junk' }); assert.equal(r1.held, 300); assert.equal(s.state.verifies.length, 0);
        // The take-back refused: the account keeps the reward as before (paid, nothing held).
        s.state.fail = (name) => (name === 'spend_plaza' ? json({ message: 'upstream' }, 500) : null);
        const b = await s.user(), r2 = await s.link(b, await s.guest()); assert.equal(r2.bonus, 300); assert.equal('held' in r2, false); assert.equal(await s.coins(b.id), 440); assert.equal(s.owed(b.id), null);
        s.state.fail = null;
        // acct cannot keep it: the coins are handed back, never lost.
        const fix = breakAcct(s.env, 'lrOwe'); const c = await s.user(), r3 = await s.link(c, await s.guest()); fix();
        assert.equal(r3.bonus, 300); assert.equal('held' in r3, false); assert.equal(r3.coins, 440); assert.equal(await s.coins(c.id), 440);
        assert.ok(s.grants().includes('grant_coins ' + c.id + ' 300'));
        // The replay's read failing: the link still answers, only without held.
        const fix2 = breakAcct(s.env, 'lrOwed'); const r4 = await s.link(a, await s.guest()); fix2(); assert.equal('held' in r4, false);
      } finally { console.warn = warn; s.done(); }
    });

    it('a grant that fails at the claim puts the reward back; budget hard waits without a DO call; guests and anonymous sign-ins have none', async () => {
      const s = await scene(db, ON);
      try {
        const u = await s.user(); assert.equal((await s.link(u, await s.guest())).held, 300);
        s.state.fail = (name) => (name === 'grant_coins' ? json({ message: 'upstream' }, 500) : null);
        const bad = await s.claim(u, 'good'); assert.equal(bad.status, 502); assert.equal(s.owed(u.id), 300); s.state.fail = null;
        await s.hard(); const log = spyDo(s.env);
        const busy = await s.claim(u, 'good'); assert.equal(busy.status, 503); assert.deepEqual(busy.body, BUSY); assert.deepEqual(log.filter((x) => x.startsWith('acct.')), []);
        if (db.guard) { // before the migration every link waits at hard (merge-guard.test.mjs); after it, a replay links without asking acct
          const replay = await s.link(u, await s.guest()); assert.equal('held' in replay, false, 'no acct read at hard'); assert.deepEqual(log.filter((x) => x.startsWith('acct.lr')), []); }
        await s.calm(); assert.equal((await s.claim(u, 'good')).body.amount, 300); assert.equal(await s.coins(u.id), 440);
        const g = await s.guest(), anon = await s.user(true);
        for (const who of [g, anon]) { const r = await s.claim(who, 'good'); assert.equal(r.status, 403); assert.equal(r.body.code, 'account'); }
      } finally { s.done(); }
    });

    it('an account that withdrew: its held reward goes with it; signing in again (again) holds nothing and pays nothing', async () => {
      const s = await scene(db, ON), warn = console.warn;
      try {
        const u = await s.user(); assert.equal((await s.link(u, await s.guest())).held, 300);
        console.warn = () => {}; // forget_login has no stand-in here: 'login kept'
        s.clock.add(1000); const w = await s.post('/rt/auth/withdraw', {}, u.token); assert.equal(w.status, 200, JSON.stringify(w.body)); console.warn = warn;
        const back = await s.relogin(u);
        assert.deepEqual((await s.claim(back, 'good')).body, { ok: true, amount: 0 }); assert.equal(s.owed(u.id), 0);
        const r = await s.link(back, await s.guest()); assert.equal(r.bonus, 0); assert.equal('held' in r, false);
        assert.deepEqual((await s.claim(back, 'good')).body, { ok: true, amount: 0 });
      } finally { console.warn = warn; s.done(); }
    });
  });
}
linkSuite('model, before the coins migration', async () => memDb({ guard: false }));
linkSuite('model, after the coins migration', async () => memDb({ guard: true }));
linkSuite('schema.sql before the coins migration (PGlite)', async () => pgDb(OLD_SCHEMA, false), NO_OLD);
linkSuite('schema.sql (PGlite)', async () => pgDb(read('schema.sql'), true), NO_PG);

// ---- the share bonus and VIP codes -------------------------------------------------------------------------------------------------------------
describe('share bonus and VIP codes behind Turnstile', { concurrency: false }, () => {
  it('share bonus, switched off: no token needed, siteverify never asked (as before)', async () => {
    const db = memDb({ guard: true }), s = await scene(db, { TURNSTILE_SITE: SITE });
    try {
      const u = await s.user(); await s.link(u, await s.guest());
      const r = await s.post('/rt/share-bonus', {}, u.token, '9.9.9.1'); assert.equal(r.status, 200); assert.equal(r.body.amount, 300); assert.equal(s.state.verifies.length, 0);
    } finally { s.done(); }
  });

  it('share bonus, switched on: no token or a refused one is 403 human before any DO call or RPC; siteverify down is busy; a bonus token pays', async () => {
    const db = memDb({ guard: true }), s = await scene(db, ON), warn = console.warn;
    try {
      const u = await s.user(); await s.link(u, await s.guest()); assert.equal((await s.claim(u, 'good')).status, 200); // 440
      const g = await s.guest(), log = spyDo(s.env), rpcs = s.state.rpcs.length;
      const gr = await s.post('/rt/share-bonus', {}, g.token, '9.9.8.1'); assert.equal(gr.status, 403); assert.equal(gr.body.code, 'account', 'a guest is told about the account first');
      const none = await s.post('/rt/share-bonus', {}, u.token, '9.9.8.1'); assert.equal(none.status, 403); assert.deepEqual(none.body, HUMAN_NO);
      const bad = await s.post('/rt/share-bonus', { ts: 'forged' }, u.token, '9.9.8.1'); assert.equal(bad.status, 403); assert.deepEqual(bad.body, HUMAN_NO);
      s.state.action = 'link'; assert.deepEqual((await s.post('/rt/share-bonus', { ts: 'good' }, u.token, '9.9.8.1')).body, HUMAN_NO, 'the link token is not a bonus token');
      console.warn = () => {};
      for (const v of [() => { throw new Error('network'); }, () => json({ message: 'upstream' }, 503), () => json({ success: false, 'error-codes': ['invalid-input-secret'] })]) {
        s.state.verify = v; const r = await s.post('/rt/share-bonus', { ts: 'good' }, u.token, '9.9.8.1'); assert.equal(r.status, 503); assert.deepEqual(r.body, BUSY);
      }
      console.warn = warn; s.state.verify = null;
      assert.deepEqual(log.filter((x) => x.startsWith('acct.promo')), [], 'nothing counted for any refusal'); assert.equal(s.state.rpcs.length, rpcs, 'and nothing paid');
      s.state.action = 'bonus'; const ok = await s.post('/rt/share-bonus', { ts: 'good' }, u.token, '9.9.8.1');
      assert.equal(ok.status, 200); assert.equal(ok.body.amount, 300); assert.equal(await s.coins(u.id), 740); assert.deepEqual(s.state.verifies.at(-1), { secret: SECRET, response: 'good', remoteip: '9.9.8.1' });
      // Already had today: refused as before, a second token does not help.
      assert.equal((await s.post('/rt/share-bonus', { ts: 'good' }, u.token, '9.9.8.1')).status, 400);
    } finally { console.warn = warn; s.done(); }
  });

  it('VIP code, switched on: a token of the action code before the code is even compared; guests still may; siteverify down is busy and uses nothing', async () => {
    const db = memDb({ guard: true }), s = await scene(db, { ...ON, VIP_CODES: 'GOLDCODE1' }), warn = console.warn;
    try {
      const g = await s.guest(), redeem = (code, ts) => s.post('/rt/redeem-code', ts === undefined ? { code } : { code, ts }, g.token);
      assert.equal((await redeem('short')).status, 400, 'the shape is checked first, for free');
      assert.deepEqual((await redeem('WRONGCODE9')).body, HUMAN_NO, 'no token: not even told whether the code is right');
      assert.deepEqual((await redeem('GOLDCODE1', 'forged')).body, HUMAN_NO);
      s.state.action = 'bonus'; assert.deepEqual((await redeem('GOLDCODE1', 'good')).body, HUMAN_NO); s.state.action = 'code';
      const log = spyDo(s.env); s.state.verify = () => { throw new Error('network'); }; console.warn = () => {};
      const down = await redeem('GOLDCODE1', 'good'); assert.equal(down.status, 503); assert.deepEqual(down.body, BUSY); assert.deepEqual(log.filter((x) => x.startsWith('acct.code')), []);
      console.warn = warn; s.state.verify = null;
      assert.deepEqual((await redeem('WRONGCODE9', 'good')).body, { ok: false, error: '코드가 맞지 않아요.' });
      const ok = await redeem('GOLDCODE1', 'good'); assert.equal(ok.status, 200); assert.equal(ok.body.amount, 10000); assert.equal(await s.coins(g.id), 10140);
      assert.deepEqual((await redeem('GOLDCODE1', 'good')).body, { ok: false, error: '이미 사용한 코드예요.' });
    } finally { console.warn = warn; s.done(); }
  });

  it('VIP code, switched off: no token, no siteverify (as before)', async () => {
    const db = memDb({ guard: true }), s = await scene(db, { VIP_CODES: 'GOLDCODE1' });
    try {
      const g = await s.guest(), ok = await s.post('/rt/redeem-code', { code: 'GOLDCODE1' }, g.token);
      assert.equal(ok.status, 200); assert.equal(s.state.verifies.length, 0);
    } finally { s.done(); }
  });
});

describe('Meter: the held link rewards (lrw)', () => {
  const clocked = (fn) => { const orig = Date.now; let t = 1e12; Date.now = () => t; try { fn({ add: (ms) => { t += ms; } }); } finally { Date.now = orig; } };
  it('lrOwe adds, lrTake hands over the whole amount once, lrGive puts a failed grant back; a withdrawal after the coins were kept drops them', () => clocked((clock) => {
    const m = new Meter(makeCtx(sqliteStorage()), {});
    assert.equal(m.lrOwed('user:a'), 0); assert.equal(m.lrTake('user:a'), 0);
    assert.equal(m.lrOwe('user:a', 300), 300); assert.equal(m.lrOwed('user:a'), 300);
    assert.equal(m.lrTake('user:a', ['h-a']), 300); assert.equal(m.lrTake('user:a', ['h-a']), 0);
    assert.equal(m.lrGive('user:a', 300), 300); assert.equal(m.lrTake('user:a'), 300);
    assert.equal(m.lrOwe('user:a', 120), 120); assert.equal(m.lrOwe('user:a', 180), 300, 'what the database paid again is kept too');
    for (const bad of [0, -5, NaN, 'x']) assert.equal(m.lrOwe('user:b', bad), 0); assert.equal(m.lrOwe('', 300), 0); assert.equal(m.lrOwed('user:b'), 0);
    // A mark older than the kept coins does not drop them (a login that came back after an old withdrawal); a later one does.
    m.goneSet(['h-c']); clock.add(1000); m.lrOwe('user:c', 300); assert.equal(m.lrOwed('user:c', ['h-c']), 300);
    clock.add(1000); m.goneSet(['h-c']); assert.equal(m.lrOwed('user:c', ['h-c']), 0); assert.equal(m.lrOwed('user:c', ['h-other']), 300);
    assert.equal(m.lrTake('user:c', ['h-c']), 0); assert.equal(m.lrOwed('user:c'), 0, 'dropped for good');
  }));
});
