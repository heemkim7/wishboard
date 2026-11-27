// Package U6: the starter guard, and closed transfers.
// Links (/rt/auth/merge): a guest wallet starts with 100 coins nobody earned and is paid the hello bonus 40 on arrival (140 "arrival coins").
// merge_guest_account moves every coin, so sign-out -> a new guest -> sign-in added them a cycle, and many fresh guests linked into one account
// piled up their hello bonuses. Sends (/rt/sell-coins, /rt/tribe/pledge): 응원 포인트 are not transferable at all since the non-game change
// (docs/non-game-plan-2026-11-22.md 4-3); both routes answer 410 code 'off' for everybody, before any check, Durable Object call or RPC.
// The database is changed by hand (migrations/2026-11-22-coins.sql), so the link scenarios run in both states:
//   before  the functions as they were (the Worker takes the arrival coins back after the call): a JS model, and the previous schema.sql
//   after   the functions of schema.sql now (the database guards the link in one step, answer guard: 2): a JS model, and schema.sql
// The PGlite halves run when PGlite is installed outside the repo (see test/db.test.mjs for how). The "before" suites come first on purpose: the
// Worker remembers for the isolate's whole life that the database guards links.
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

const W = await import('../worker.js');
const worker = W.default, { Meter, Room } = W;
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// Same harness as harden.test.mjs: the real Worker, Meter and Room on in-memory SQLite behind a stub that copies arguments like the runtime.
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
// Every Durable Object call that reaches a stub, as 'instance.method', except the 'day' counter itself (Meter.add counts its own call).
function spyDo(env) {
  const log = [];
  for (const ns of [env.METER, env.ROOM]) { const real = ns.get; ns.get = (name) => { const s = real(name); return new Proxy(s, { get: (t, k) => typeof t[k] === 'function' ? (...a) => { if (name !== 'day') log.push(name + '.' + String(k)); return t[k](...a); } : t[k] }); }; }
  return log;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

// ---- Supabase stand-in 1: the wallet functions in JS -----------------------------------------------------------------------------------------
// Each function body is one synchronous step, as each RPC is one transaction. The starting balance is the column default (100) for any INSERT
// that names no coins, coin_batch inserts 100 + delta, spend_plaza takes exactly 30 / 5000 / one ticket, grant_coins only adds, withdraw_account
// deletes the wallet row. guard false: merge_guest_account as it was (moves every coin, pays 300 while link_bonus is false, says `moved`).
// guard true: as schema.sql has it now (starter_taken, withdrawal marks, guard: 2, no `moved`).
function memDb({ guard = false } = {}) {
  const wallets = new Map(), boards = [], tribeOf = new Map(), taken = new Map(), gone = new Set();
  // guard: wallets_need_login too: a user: row made anywhere but the link starts without the 100 (no auth schema here, so no anonymous exception).
  const row = (id, coins = 100) => { if (!wallets.has(id)) wallets.set(id, { actor_id: id, nickname: '네온손님', coins: guard && id.startsWith('user:') ? Math.max(0, coins - 100) : coins, vip_tickets: 0, linked: false, link_bonus: false }); return wallets.get(id); };
  const bad = (a) => (!/^user:[A-Za-z0-9_-]{8,80}$/.test(a.p_user_id || '') ? '계정 정보가 올바르지 않습니다.' : !/^guest:g-[0-9a-f-]{36}$/.test(a.p_guest_id || '') ? '게스트 정보가 올바르지 않습니다.' : '');
  const fns = {
    profile_read(a) { row(a.p_actor_id); return { ok: true, level: 1, reputation: 0, species: 1, equip: [], owned: [], color: null, starter: false, streak: 0, attend_last: null }; },
    coin_batch(a) { for (const it of a.p_items) { const d = Math.min(Math.max(Number(it.delta), 0), 500); if (wallets.has(it.actor_id)) wallets.get(it.actor_id).coins += d; else row(it.actor_id, 100 + d); } return { ok: true, flushed: a.p_items.length }; },
    spend_plaza(a) {
      if (!((a.p_coins === 30 && a.p_tickets === 0) || (a.p_coins === 5000 && a.p_tickets === 0) || (a.p_coins === 0 && a.p_tickets === 1))) return { ok: false, error: '그 금액은 쓸 수 없어요.' };
      const w = wallets.get(a.p_actor_id); if (!w) return { ok: false, error: '지갑을 찾지 못했습니다.' };
      if (a.p_coins > 0 && w.coins < a.p_coins) return { ok: false, error: '코인이 부족해요.' };
      if (a.p_tickets > 0 && w.vip_tickets < a.p_tickets) return { ok: false, error: 'VIP 티켓이 없어요.' };
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
      const nick = () => { u.linked = true; if (a.p_nickname) u.nickname = String(a.p_nickname).slice(0, 16); for (const b of boards) if (b.holder_id === a.p_guest_id) b.holder_id = a.p_user_id; };
      if (!guard) { u.coins += moved; if (!u.link_bonus) { u.coins += 300; u.link_bonus = true; bonus = 300; } nick(); return { ok: true, actor_id: a.p_user_id, coins: u.coins, bonus, moved, nickname: u.nickname, linked: true }; }
      let t = taken.get(a.p_guest_id) || 0, back = 0; const again = !u.link_bonus && gone.has(a.p_user_id);
      if (!u.link_bonus && !again) { bonus = 300; t = Math.max(t, Math.min(140, moved)); } else { back = Math.min(moved, Math.max(0, 140 - t)); t += back; }
      taken.set(a.p_guest_id, t); u.coins += moved - back + bonus; u.link_bonus = true; nick();
      return { ok: true, actor_id: a.p_user_id, coins: u.coins, bonus, moved_in: moved, back, again, nickname: u.nickname, linked: true, guard: 2 };
    },
    sell_coins_to_advertiser(a) { // no clock in the model: a board with a holder is lit
      if (![10, 20, 50].includes(a.p_amount)) return { ok: false, error: '10, 20, 50코인만 팔 수 있어요.' };
      const b = boards.find((x) => x.slot_id === a.p_slot_id); if (!b || !b.holder_id) return { ok: false, error: '지금 그 전광판을 산 광고주가 없어요.' };
      if (b.holder_id === a.p_actor_id) return { ok: false, error: '내 광고에는 코인을 팔 수 없어요.' };
      const w = row(a.p_actor_id); if (w.coins < a.p_amount) return { ok: false, error: '팔 코인이 부족해요.' };
      w.coins -= a.p_amount; const to = wallets.get(b.holder_id); if (to) to.coins += a.p_amount;
      return { ok: true, remaining_coins: w.coins, buyer_name: '주인', buyer_id: b.holder_id, amount: a.p_amount };
    },
    create_tribe(a) { if (tribeOf.has(a.p_actor_id)) return { ok: false, error: 'tribe' }; row(a.p_actor_id); tribeOf.set(a.p_actor_id, a.p_id); return { ok: true, tribe_id: a.p_id, tag: a.p_tag }; },
    pledge_tribe(a) {
      if (![10, 20, 50].includes(a.p_amount)) return { ok: false, error: 'amount' };
      if (!/^[0-9]{4}W[0-9]{2}$/.test(a.p_week)) return { ok: false, error: 'week' };
      const t = tribeOf.get(a.p_actor_id); if (!t) return { ok: false, error: 'tribe' };
      const w = wallets.get(a.p_actor_id); if (!w || w.coins < a.p_amount) return { ok: false, error: '코인이 부족합니다. 붕어빵을 더 구워보세요!' };
      w.coins -= a.p_amount; row('tribe:' + t, 0).coins += a.p_amount; return { ok: true, tribe_id: t, amount: a.p_amount };
    },
    withdraw_account(a) { for (const b of boards) if (b.holder_id === a.p_actor_id) b.holder_id = null; if (wallets.delete(a.p_actor_id) && guard) gone.add(a.p_actor_id); return { ok: true, actor_id: a.p_actor_id }; },
  };
  return {
    guard,
    async rpc(name, a) { if (!fns[name]) return { ok: true }; if (a.p_key !== KEY) throw new Error('Unauthorized worker key'); return fns[name](a); },
    async wallet(id) { const w = wallets.get(id); return w ? { ...w } : null; },
    async taken(id) { return taken.get(id) || 0; },
    async boards(holder) { return boards.filter((b) => b.holder_id === holder).map((b) => ({ ...b })); },
    async hold(slot, id) { const b = boards.find((x) => x.slot_id === slot); if (b) b.holder_id = id; else boards.push({ slot_id: slot, holder_id: id }); },
    async holder(slot) { return boards.find((x) => x.slot_id === slot)?.holder_id ?? null; },
  };
}

// ---- Supabase stand-in 2: a real schema in PGlite --------------------------------------------------------------------------------------------
async function loadPGlite() {
  for (const d of [process.env.PGLITE_DIR, join(tmpdir(), 'kts-pglite')].filter(Boolean)) {
    try { const req = createRequire(join(d, 'package.json')); return (await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href)).PGlite; } catch { }
  }
  try { return (await import('@electric-sql/pglite')).PGlite; } catch { return null; }
}
const PGlite = await loadPGlite();
if (!PGlite) console.log('# merge-guard.test: PGlite not installed, the schema.sql halves are skipped. Install it in ' + join(tmpdir(), 'kts-pglite') + ' (npm i @electric-sql/pglite) or set PGLITE_DIR.');
// schema.sql as it was before migrations/2026-11-22-coins.sql (the parent of the commit that added it).
const OLD_SCHEMA = (() => { try { return execFileSync('git', ['show', 'aef1e9f:schema.sql'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n'); } catch { return null; } })();
const REAL = ['profile_read', 'coin_batch', 'spend_plaza', 'grant_coins', 'merge_guest_account', 'withdraw_account', 'sell_coins_to_advertiser', 'create_tribe', 'pledge_tribe'];
async function pgDb(schemaText, guard) {
  const db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;'); // Supabase gives these; PGlite does not
  await db.exec(schemaText);
  await db.query('UPDATE public.app_secrets SET key_value = $1 WHERE key_name = $2', [KEY, 'FLUSH_KEY']);
  return {
    guard,
    async rpc(name, a) { if (!REAL.includes(name)) return { ok: true }; const keys = Object.keys(a);
      const sql = 'SELECT public.' + name + '(' + keys.map((k, i) => k + ' => $' + (i + 1) + (k === 'p_items' ? '::jsonb' : '')).join(', ') + ') AS r';
      return (await db.query(sql, keys.map((k) => (k === 'p_items' ? JSON.stringify(a[k]) : a[k])))).rows[0].r; },
    async wallet(id) { return (await db.query('SELECT actor_id, nickname, coins::float8 AS coins, vip_tickets, linked, link_bonus FROM public.wallets WHERE actor_id = $1', [id])).rows[0] || null; },
    async taken(id) { return guard ? Number((await db.query('SELECT taken FROM public.starter_taken WHERE guest_id = $1', [id])).rows[0]?.taken ?? 0) : 0; },
    async boards(holder) { return (await db.query('SELECT slot_id, holder_id FROM public.billboards WHERE holder_id = $1', [holder])).rows; },
    async hold(slot, id) { const r = await db.query("UPDATE public.billboards SET holder_id = $1, holder_name = '주인', lit_until = now() + interval '1 day', expires_at = now() + interval '1 day' WHERE slot_id = $2", [id, slot]); assert.equal(r.affectedRows, 1, slot); },
    async holder(slot) { return (await db.query('SELECT holder_id FROM public.billboards WHERE slot_id = $1', [slot])).rows[0]?.holder_id ?? null; },
  };
}
const NO_PG = PGlite ? false : 'PGlite not installed (see the first lines of this file)';
const NO_OLD = NO_PG || (OLD_SCHEMA ? false : 'git show aef1e9f:schema.sql not available');

// The Worker's fetch, answered from one of them. state.rpcs: every RPC as 'name actor amount'. state.fail(name, args) may answer in its place
// (or throw, a network error); state.shape(name, answer) may change an answer (an older function shape). state.failRead(id) does the same for a
// wallet read, and state.slowRead (ms) makes one take real time. state.before(name, args) is awaited before an RPC runs. state.aheads counts the
// link's read ahead (both wallet rows in one read); state.failAhead makes it unreadable.
function fakeNet(state, db) {
  return async (url, opt = {}) => {
    const u = String(url);
    if (u.includes('/.well-known/jwks.json')) return json({ keys: state.jwks || [] });
    if (u.includes('/auth/v1/user')) return json({});
    if (u.includes('/rest/v1/billboards')) { state.reads++; const h = /holder_id=eq\.([^&]+)/.exec(u); return json(h ? await db.boards(decodeURIComponent(h[1])) : []); }
    if (u.includes('/rest/v1/wallets') && u.includes('actor_id=in.(')) { state.reads++; state.aheads++; // the link's read ahead: both rows, or what the test says
      if (state.failAhead) return json({ message: 'upstream' }, 500);
      const ids = decodeURIComponent(/actor_id=in\.\(([^)]*)\)/.exec(u)[1]).split(',').map((x) => x.replace(/^"|"$/g, '')), rows = [];
      for (const id of ids) { const w = await db.wallet(id); if (w) rows.push(w); } return json(rows); }
    if (u.includes('/rest/v1/wallets')) { state.reads++; const m = /actor_id=eq\.([^&]+)/.exec(u), id = m ? decodeURIComponent(m[1]) : ''; if (id) state.wreads.push(id);
      if (id && state.slowRead) await new Promise((r) => setTimeout(r, state.slowRead)); // a real pause, so requests overlap
      const bad = id && state.failRead?.(id); if (bad) return bad; const w = id ? await db.wallet(id) : null; return json(w ? [w] : []); }
    const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u);
    if (m) { const a = JSON.parse(opt.body || '{}'); state.rpcs.push([m[1], a.p_actor_id || a.p_user_id || '', a.p_coins ?? a.p_amount ?? ''].join(' ').trim());
      const bad = state.fail?.(m[1], a); if (bad) return bad;
      if (state.before) await state.before(m[1], a); // a gate: the RPC waits here as long as the test wants
      try { const out = await db.rpc(m[1], a); return json(state.shape ? state.shape(m[1], out) : out); } catch (e) { return json({ message: String(e?.message || e) }, 400); } }
    if (u.includes('/rest/v1/')) { state.reads++; return json([]); }
    return new Response('missing', { status: 404 });
  };
}
let clockBase = Date.parse('2029-03-01T03:00:00Z'), kid = 0, seq = 0;
// Each test runs days apart, so the isolate's copies (budget level, tally, world) of an earlier test are stale for the next one.
async function scene(db, extra = {}) {
  clockBase += 10 * 864e5; let t = clockBase; const origNow = Date.now, origFetch = globalThis.fetch, state = { rpcs: [], reads: 0, wreads: [], aheads: 0 };
  Date.now = () => t; globalThis.fetch = fakeNet(state, db); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  const env = makeEnv(extra), waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (p, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + p, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const post = (p, body, token, ip = '1.1.1.1') => call(p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const get = (p, token) => call(p, { headers: token ? { authorization: 'Bearer ' + token } : {} });
  // The answer alone, without waiting for anybody's waitUntil work: for a request made while another one is deliberately kept open.
  const quick = async (p, body, token) => { const res = await worker.fetch(new Request('https://sq.example' + p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1', authorization: 'Bearer ' + token }, body: JSON.stringify(body) }), env, ctx); return { status: res.status, headers: res.headers, body: await res.json() }; };
  const coins = async (id) => (await db.wallet(id))?.coins ?? null;
  const earn = (id, n) => db.rpc('coin_batch', { p_key: KEY, p_items: [{ actor_id: id, nickname: '', delta: n, reason: 'mine' }] }); // what a room flush does
  const spend30 = async (id) => assert.equal((await db.rpc('spend_plaza', { p_key: KEY, p_actor_id: id, p_coins: 30, p_tickets: 0 })).ok, true); // a sticker
  // A guest as /rt/guest mints it. No wallet row yet.
  const bare = async () => { const tok = (await (await post('/rt/guest', {})).json()).token; return { token: tok, id: 'guest:' + JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).s }; };
  // A guest that entered the square: the profile read on entering makes its wallet row with the starting 100, and the hello bonus pays 40.
  const guest = async () => { const g = await bare(); assert.equal((await get('/rt/profile', g.token)).status, 200); await db.rpc('coin_batch', { p_key: KEY, p_items: [{ actor_id: g.id, nickname: '', delta: 40, reason: 'bonus' }] }); return g; };
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']), k = 'mg-' + (++kid);
  state.jwks = [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: k }];
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), head = enc({ alg: 'ES256', kid: k });
  const sign = async (sub, more) => { const claims = enc({ sub, iat: Math.floor(t / 1000), exp: Math.floor(t / 1000) + 86400, iss: 'https://yxddhpacuyaffaoutxjn.supabase.co/auth/v1', aud: 'authenticated', ...more });
    return head + '.' + claims + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(head + '.' + claims))).toString('base64url'); };
  // A signed-in account (its token carries iat, as Supabase's do); anon: an anonymous sign-in (the same user: id shape, is_anonymous in the token).
  const user = async (anon = false) => { const sub = '5eed0000-0000-4000-8000-' + String(++seq).padStart(12, '0'); return { sub, id: 'user:' + sub, token: await sign(sub, anon ? { is_anonymous: true } : {}) }; };
  // The same account signing in again later (a login that was kept): a fresh token, issued a second on.
  const relogin = async (u) => { t += 1000; return { ...u, token: await sign(u.sub, {}) }; };
  // The link as net.js sends it. Every success is the same plain answer, whatever the guard did (plus again: true for an account that withdrew).
  const link = async (u, g) => { const res = await post('/rt/auth/merge', { guest_id: g.id, guest_token: g.token, nickname: '', topic: 'chapel:square' }, u.token), body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body)); assert.deepEqual(Object.keys(body).filter((x) => x !== 'again').sort(), ['actor_id', 'bonus', 'coins', 'linked', 'nickname', 'ok']);
    assert.equal(body.ok, true); assert.equal(body.actor_id, u.id); assert.equal(body.linked, true); return body; };
  // An account that has linked once already: 140 (the first guest's arrival coins) + 300.
  const linked = async () => { const u = await user(), g = await guest(), r = await link(u, g); assert.equal(r.bonus, 300); assert.equal(await coins(u.id), 440); return u; };
  // An account with `n` coins over the send floor (580): a linked account (440) that earned 140 + n.
  const rich = async (n) => { const u = await linked(); await earn(u.id, 140 + n); return u; };
  const stp = (id) => env.meter('acct').sql.db.prepare("select count(*) n from sqlite_master where name = 'stp'").get().n ? env.meter('acct').sql.db.prepare('select v from stp where g = ?').get(id)?.v ?? 0 : 0;
  const burns = () => state.rpcs.filter((x) => /^(spend_plaza|grant_coins) /.test(x));
  // 광고주에게 코인 보내기, as an older page posted it (closed: 410 off).
  const send = async (who, slot, amount) => { const res = await post('/rt/sell-coins', { topic: 'chapel:square', slot_id: slot, amount, nickname: '손님' }, who.token); return { status: res.status, body: await res.json() }; };
  const sells = () => state.rpcs.filter((x) => x.startsWith('sell_coins_to_advertiser ')).length;
  const acctDb = () => env.meter('acct').sql.db, has = (tb) => acctDb().prepare('select count(*) n from sqlite_master where name = ?').get(tb).n > 0;
  const lease = (id) => (has('lkl') ? acctDb().prepare('select count(*) n from lkl where uid = ?').get(id).n : 0); // links (the send lease went with the sends)
  const gone = () => (has('gone') ? acctDb().prepare('select h from gone').all().map((r) => String(r.h)) : []);
  // A tribe of its own for `who`, and a pledge as an older page posted it (closed: 410 off).
  const tribe = async (who) => assert.equal((await db.rpc('create_tribe', { p_key: KEY, p_actor_id: who.id, p_id: 'tr' + String(++seq).padStart(6, '0'), p_tag: 'T' + seq })).ok, true);
  const pledge = async (who, amount) => { const res = await post('/rt/tribe/pledge', { topic: 'chapel:square', slot: 'STREET_3', amount }, who.token); return { status: res.status, body: await res.json() }; };
  const pledges = () => state.rpcs.filter((x) => x.startsWith('pledge_tribe ')).length;
  const acctCalls = (log, re) => log.filter((x) => x.startsWith('acct.') && re.test(x.slice(5)));
  const hard = async () => { setUsed(env, 96000); t += 61000; assert.equal((await (await get('/rt/wishes')).json()).busy, true); }; // the isolate now knows the level
  const calm = async () => { setUsed(env, 10); t += 61000; await get('/rt/wishes'); };
  return { clock: { add: (ms) => { t += ms; } }, state, env, call, post, get, bare, guest, user, relogin, coins, earn, spend30, link, linked, rich, stp, burns, send, sells, lease, gone, tribe, pledge, pledges, acctCalls, quick, hard, calm, done: () => { Date.now = origNow; globalThis.fetch = origFetch; } };
}
const utcDay = () => new Date().toISOString().slice(0, 10); // Meter.add keys its row by new Date() (the real clock, not the mocked Date.now)
const dayN = (env) => env.meter('day').sql.db.prepare('select n from d where day = ?').get(utcDay())?.n || 0;
const setUsed = (env, n) => env.meter('day').sql.db.prepare('insert into d(day, n) values(?, ?) on conflict(day) do update set n = excluded.n').run(utcDay(), n);
const LINK_HARD = { ok: false, err: 'busy', error: '지금은 광장이 붐벼서 계정을 연결하지 못했어요. 잠시 뒤에 새로고침해 주세요.' };
const GONE = { ok: false, err: 'gone', error: '탈퇴한 계정이에요. 다시 로그인해 주세요.' };

// ---- links ----------------------------------------------------------------------------------------------------------------------------------
function suite(label, makeDb, skip) {
  describe('starter guard on account links: ' + label, { concurrency: false, skip }, () => {
    let db, A; // A: after the migration (the database guards the link)
    before(async () => { db = await makeDb(); A = db.guard; });

    it('the starting balance: 100 from the wallet route for no row, and 100 in the row the database makes', async () => {
      const s = await scene(db);
      try {
        const g = await s.bare();
        assert.equal(await s.coins(g.id), null);
        const none = await (await s.get('/rt/wallet', g.token)).json();
        assert.equal(none.coins, 100); assert.equal(none.exists, false); // the Worker's own answer, nothing in the database
        assert.equal((await s.get('/rt/profile', g.token)).status, 200); // profile_read: INSERT INTO wallets (actor_id), so the column default
        assert.equal(await s.coins(g.id), 100);
        const row = await (await s.get('/rt/wallet', g.token)).json();
        assert.equal(row.coins, 100); assert.equal(row.exists, true);
        const g2 = await s.bare(); await s.earn(g2.id, 7); assert.equal(await s.coins(g2.id), 107); // coin_batch's own INSERT: 100 + delta
        assert.equal(await s.coins((await s.guest()).id), 140); // and the hello bonus a guest gets on arrival
      } finally { s.done(); }
    });

    it('first link: everything moves, +300 once, and nothing is taken back', async () => {
      const s = await scene(db);
      try {
        const u = await s.user(), g = await s.guest(); await s.earn(g.id, 40);
        const r = await s.link(u, g);
        assert.equal(r.bonus, 300); assert.equal(r.coins, 480); assert.equal('again' in r, false);
        assert.equal(await s.coins(u.id), 480); assert.equal(await s.coins(g.id), 0);
        assert.deepEqual(s.burns(), []); // no spend, no grant
        assert.equal(A ? await db.taken(g.id) : s.stp(g.id), 140); // this guest's arrival coins are now spoken for
        const again = await s.link(u, g); // the next boot replays the link
        assert.equal(again.bonus, 0); assert.equal(again.coins, 480); assert.equal(await s.coins(u.id), 480);
        assert.deepEqual(s.burns(), []);
      } finally { s.done(); }
    });

    it('second link of an untouched fresh guest adds nothing, however often it is repeated: its hello bonus stays out too', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked();
        for (let i = 0; i < 6; i++) { // sign out -> a new guest -> sign in
          const g = await s.guest(); assert.equal(await s.coins(g.id), 140);
          const r = await s.link(u, g);
          assert.equal(r.bonus, 0); assert.equal(r.coins, 440, 'cycle ' + i);
          assert.equal(await s.coins(u.id), 440, 'cycle ' + i); assert.equal(await s.coins(g.id), 0);
        }
        assert.equal(s.burns().length, A ? 0 : 6 * 6); // before: per cycle 30 x 4, then +10 and 30; after: one step in the database
      } finally { s.done(); }
    });

    it('a guest that earned 50 over its arrival coins adds 50', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), g = await s.guest(); await s.earn(g.id, 50);
        const r = await s.link(u, g);
        assert.equal(r.bonus, 0); assert.equal(r.coins, 490); assert.equal(await s.coins(u.id), 490); assert.equal(await s.coins(g.id), 0);
      } finally { s.done(); }
    });

    it('a guest that spent 30 of its arrival coins adds nothing and the account loses nothing', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), g = await s.guest(); await s.spend30(g.id); assert.equal(await s.coins(g.id), 110);
        const r = await s.link(u, g);
        assert.equal(r.coins, 440); assert.equal(await s.coins(u.id), 440); assert.equal(await s.coins(g.id), 0);
        assert.deepEqual(s.burns().filter((x) => x.includes(u.id)), A ? [] : ['spend_plaza ' + u.id + ' 30', 'spend_plaza ' + u.id + ' 30', 'spend_plaza ' + u.id + ' 30', 'grant_coins ' + u.id + ' 10', 'spend_plaza ' + u.id + ' 30']);
      } finally { s.done(); }
    });

    it('any guest balance: the account gains what is above 140, never less than nothing', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(); let have = 440;
        for (const extra of label.startsWith('model') ? [1, 29, 30, 31, 59, 60, 61, 89, 90, 99, 100, 101, 139, 140, 141, 170, 500, 1700] : [29, 100, 140, 141]) { // the guest's balance, built from 140 + earnings - stickers
          const g = await s.guest(); let bal = 140;
          while (bal - 30 >= extra) { await s.spend30(g.id); bal -= 30; }
          for (let need = extra - bal; need > 0; need -= 500) await s.earn(g.id, Math.min(500, need));
          if (extra < bal) { await s.earn(g.id, 30 - (bal - extra)); await s.spend30(g.id); }
          assert.equal(await s.coins(g.id), extra);
          await s.link(u, g); have += Math.max(0, extra - 140);
          assert.equal(await s.coins(u.id), have, 'guest balance ' + extra);
        }
      } finally { s.done(); }
    });

    it('a guest holding a board: the board moves, the arrival coins do not', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), g = await s.guest(); await db.hold('STREET_5', g.id);
        const r = await s.link(u, g);
        assert.equal(await db.holder('STREET_5'), u.id);
        assert.equal(r.coins, 440); assert.equal(await s.coins(u.id), 440);
        const g2 = await s.bare(); await db.hold('STREET_6', g2.id); // a board and no wallet row at all
        await s.link(u, g2);
        assert.equal(await db.holder('STREET_6'), u.id); assert.equal(await s.coins(u.id), 440);
      } finally { s.done(); }
    });

    it('two link requests at once for one guest: one moves, one takes back, both answer success', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), g = await s.guest(); await s.earn(g.id, 50);
        const [a, b] = await Promise.all([s.link(u, g), s.link(u, g)]);
        assert.equal(a.bonus + b.bonus, 0);
        assert.equal(await s.coins(u.id), 490); assert.equal(await s.coins(g.id), 0);
        assert.equal(s.burns().length, A ? 0 : 6); // one take-back, not two
      } finally { s.done(); }
    });

    it('many fresh guests into a brand-new account at once or in a row: one first link, one guest\'s arrival coins', async () => {
      const s = await scene(db);
      try {
        const u = await s.user(), gs = [await s.guest(), await s.guest(), await s.guest(), await s.guest()];
        assert.equal((await s.get('/rt/wallet', u.token)).status, 200); // the signing key is cached before the burst
        const out = await Promise.all(gs.map((g) => s.link(u, g)));
        assert.deepEqual(out.map((r) => r.bonus).sort(), [0, 0, 0, 300]);
        assert.equal(await s.coins(u.id), 440);
        for (let i = 0; i < 3; i++) await s.link(u, await s.guest());
        assert.equal(await s.coins(u.id), 440);
      } finally { s.done(); }
    });

    it('coins that reach an already linked guest later are its earnings', async () => {
      const s = await scene(db);
      try {
        const u = await s.user(), g = await s.guest();
        await s.link(u, g); assert.equal(await s.coins(u.id), 440);
        await s.earn(g.id, 40); // a room flushed its pending coins after the link
        await s.link(u, g); assert.equal(await s.coins(u.id), 480);
        assert.deepEqual(s.burns(), []);
        // A guest that had spent 30 before its first link moved 110: those 110 count as moved, and the 30 it spent are held back from what
        // reaches it later (a guest cannot tell earned coins from arrival coins), so of a late 40 the account gets 10.
        const u2 = await s.user(), g2 = await s.guest(); await s.spend30(g2.id);
        await s.link(u2, g2); assert.equal(await s.coins(u2.id), 410); assert.equal(A ? await db.taken(g2.id) : s.stp(g2.id), 110);
        await s.earn(g2.id, 40); await s.link(u2, g2);
        assert.equal(await s.coins(u2.id), 420); assert.equal(A ? await db.taken(g2.id) : s.stp(g2.id), 140); assert.equal(s.burns().length, A ? 0 : 1); // before: one 30 burnt
      } finally { s.done(); }
    });

    it('a first link that moved nothing does not settle the guest: what reaches it afterwards is held back up to its arrival coins', async () => {
      const s = await scene(db);
      try {
        // The guest spent all 140 (a board bid would do the same as these stickers) and holds a board; 40 baked coins are still in a room.
        const u = await s.user(), g = await s.guest(); await db.hold('STREET_7', g.id);
        for (let i = 0; i < 4; i++) await s.spend30(g.id);
        await s.earn(g.id, 10); await s.spend30(g.id); assert.equal(await s.coins(g.id), 0);
        const log = spyDo(s.env), r = await s.link(u, g); // signs up: moved = 0
        assert.equal(r.bonus, 300); assert.equal(await s.coins(u.id), 300); assert.equal(await db.holder('STREET_7'), u.id);
        assert.deepEqual(s.acctCalls(log, /^st/), ['acct.stFirst']); // the withdrawal marks of 'acct' are asked on the rewarded link, in both states
        assert.equal(A ? await db.taken(g.id) : s.stp(g.id), 0); // nothing moved, nothing counted
        await s.earn(g.id, 40); // the room flush lands
        const again = await s.link(u, g); // the next boot replays the link: those 40 are not told apart from arrival coins
        assert.equal(again.coins, 300); assert.equal(await s.coins(u.id), 300); assert.equal(s.burns().length, A ? 0 : 3); // before: 30, +20, 30
      } finally { s.done(); }
    });

    it('a throwaway account that links an empty guest passes nobody its 140: the guest\'s next link holds them back', async () => {
      const s = await scene(db);
      try {
        const main = await s.linked(), throwaway = await s.user(), g = await s.bare(); // the guest has no wallet row yet
        const t = await s.link(throwaway, g); assert.equal(t.bonus, 300); assert.equal(await s.coins(throwaway.id), 300);
        assert.equal((await s.get('/rt/profile', g.token)).status, 200); await s.earn(g.id, 40); assert.equal(await s.coins(g.id), 140); // its row: 100 + hello 40
        const r = await s.link(main, g); assert.equal(r.bonus, 0); assert.equal(r.coins, 440); assert.equal(await s.coins(main.id), 440); assert.equal(await s.coins(g.id), 0);
        // The throwaway account cannot hand its 300 on either: points are never sent.
        await db.hold('STREET_9', main.id); assert.equal((await s.send(throwaway, 'STREET_9', 10)).body.code, 'off'); assert.equal(await s.coins(throwaway.id), 300);
      } finally { s.done(); }
    });

    it('an account row made before the first link: after the migration it starts at 0, before it 100, and none of it can be sent', async () => {
      const s = await scene(db);
      try {
        const u = await s.user(); assert.equal((await s.get('/rt/profile', u.token)).status, 200); assert.equal(await s.coins(u.id), A ? 0 : 100);
        const r = await s.link(u, await s.guest()); assert.equal(r.bonus, 300); assert.equal(await s.coins(u.id), A ? 440 : 540);
        await db.hold('STREET_10', (await s.linked()).id); assert.equal((await s.send(u, 'STREET_10', 10)).body.code, 'off'); // closed in both states
      } finally { s.done(); }
    });

    it('linking before the wallet row exists does not free the arrival coins for a later link', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), g = await s.bare();
        await s.link(u, g); assert.equal(await s.coins(u.id), 440); assert.equal(A ? await db.taken(g.id) : s.stp(g.id), 0); // nothing moved, nothing counted
        assert.equal((await s.get('/rt/profile', g.token)).status, 200); assert.equal(await s.coins(g.id), 100);
        await s.link(u, g); assert.equal(await s.coins(u.id), 440);
      } finally { s.done(); }
    });

    it('a replay asks nothing extra: the merge RPC, no guard call and no hold', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), g = await s.guest(); await s.link(u, g);
        const log = spyDo(s.env), r0 = s.state.rpcs.length, f0 = s.state.reads;
        await s.link(u, g);
        assert.deepEqual(s.state.rpcs.slice(r0).filter((x) => x !== 'plaza_live'), ['merge_guest_account ' + u.id]); // plaza_live: the world refill every link does
        assert.deepEqual(s.acctCalls(log, /^(st|link|sell|gone)/), []); // no guard call and no hold
        assert.ok(s.state.reads - f0 >= 2); // the board read and the read ahead (both wallet rows in one)
      } finally { s.done(); }
    });

    it('a later link that moved coins: before, three acct calls (hold, count, release) counted against the daily budget; after, none', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), g = await s.guest();
        const log = spyDo(s.env);
        s.clock.add(61000); await s.get('/rt/wishes'); // its add lands what earlier requests left pending; its own calls wait for the next one
        const base = dayN(s.env);
        s.clock.add(1000); await s.link(u, g); assert.equal(await s.coins(u.id), 440);
        assert.deepEqual(s.acctCalls(log, /^(st|link|sell|gone)/), A ? [] : ['acct.linkTake', 'acct.stTake', 'acct.linkDone']);
        const counted = log.length; assert.equal(dayN(s.env), base);
        s.clock.add(30000); await s.call('/rt/health'); // the batch goes out
        assert.equal(dayN(s.env), base + counted + 1);
      } finally { s.done(); }
    });

    it('budget level hard: before, a link waits (503, nothing moves); after, the database guards it with no acct call', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), fresh = await s.guest(), earner = await s.guest(), first = await s.guest(), nu = await s.user(); await s.earn(earner.id, 50);
        await s.hard();
        const log = spyDo(s.env), r0 = s.state.rpcs.length;
        if (!A) {
          for (const [who, g] of [[u, fresh], [u, earner], [nu, first]]) {
            const res = await s.post('/rt/auth/merge', { guest_id: g.id, guest_token: g.token, nickname: '', topic: 'chapel:square' }, who.token);
            assert.equal(res.status, 503); assert.deepEqual(await res.json(), LINK_HARD);
          }
          assert.deepEqual(s.state.rpcs.slice(r0), []); // the links a minute ago already showed the old function: no probe, no merge
          s.clock.add(600001); const late = await s.post('/rt/auth/merge', { guest_id: fresh.id, guest_token: fresh.token, nickname: '' }, u.token);
          assert.equal(late.status, 503); assert.deepEqual(s.state.rpcs.slice(r0), ['merge_guest_account probe']); // ten minutes on: asked once, still old
          assert.equal(await s.coins(fresh.id), 140); assert.equal(await s.coins(earner.id), 190); assert.equal(await s.coins(nu.id), null);
          assert.deepEqual(log, []);
          await s.calm(); await s.link(u, earner); assert.equal(await s.coins(u.id), 490); // once the level drops the link goes through
        } else {
          await s.link(u, fresh); assert.equal(await s.coins(u.id), 440);
          await s.link(u, earner); assert.equal(await s.coins(u.id), 490);
          // A first link pays the reward, and the withdrawal marks 'acct' kept from before the migration cannot be read at hard: it waits.
          const res = await s.post('/rt/auth/merge', { guest_id: first.id, guest_token: first.token, nickname: '', topic: 'chapel:square' }, nu.token);
          assert.equal(res.status, 503); assert.deepEqual(await res.json(), LINK_HARD); assert.equal(await s.coins(nu.id), null); assert.equal(await s.coins(first.id), 140);
          assert.deepEqual(s.acctCalls(log, /^(st|link|sell|gone)/), []);
          await s.calm(); const r = await s.link(nu, first); assert.equal(r.bonus, 300); assert.equal(await s.coins(nu.id), 440); // once the level drops
        }
      } finally { s.done(); }
    });

    it('the acct instance failing: the arrival coins are still given back', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), g = await s.guest(); await s.earn(g.id, 50);
        const real = s.env.METER.get; s.env.METER.get = (n) => (n === 'acct' ? new Proxy(real(n), { get: (t, k) => (/^(stTake|linkTake)$/.test(String(k)) ? async () => { throw new Error('do down'); } : t[k]) }) : real(n));
        await s.link(u, g); assert.equal(await s.coins(u.id), 490);
      } finally { s.done(); }
    });

    it('before: a refused or failed take-back never costs the account; it keeps the remainder and the link still succeeds', { skip: false }, async (t) => {
      if (A) { t.skip('after the migration there is no take-back of its own'); return; }
      const s = await scene(db);
      try {
        const u = await s.linked();
        let n = 0; s.state.fail = (name) => (name === 'spend_plaza' && ++n === 2 ? json({ message: 'upstream' }, 500) : null); // the second 30 fails
        const r1 = await s.link(u, await s.guest());
        assert.equal(await s.coins(u.id), 490); assert.equal(r1.coins, 490); // 140 moved, 90 taken back, no +10 after a failure
        s.state.fail = (name) => (name === 'grant_coins' ? json({ ok: false, error: 'no' }) : null); // the +10 is refused
        await s.link(u, await s.guest()); assert.equal(await s.coins(u.id), 510); // 120 taken back
        s.state.fail = (name) => { if (name === 'spend_plaza') throw new TypeError('network down'); return null; }; // nothing can be spent
        const r3 = await s.link(u, await s.guest()); assert.equal(await s.coins(u.id), 650); assert.equal(r3.coins, 650);
        n = 0; s.state.fail = (name) => (name === 'spend_plaza' && ++n === 5 ? json({ ok: false, error: '코인이 부족해요.' }) : null); // the last 30, after the +10
        const r4 = await s.link(u, await s.guest()); assert.equal(await s.coins(u.id), 680); assert.equal(r4.coins, 680); // 120 back, +10 kept: the account is ahead, not behind
      } finally { s.done(); }
    });

    it('before: a merge answer without `moved` (a function that does not say) leaves the link as it was', async (t) => {
      if (A) { t.skip('the new function never says moved; see the rollback test below'); return; }
      const s = await scene(db);
      try {
        const u = await s.linked();
        s.state.shape = (name, out) => { if (name !== 'merge_guest_account') return out; const { moved, ...rest } = out; return rest; };
        const log = spyDo(s.env), r = await s.link(u, await s.guest());
        assert.equal(r.coins, 580); assert.equal(await s.coins(u.id), 580); // unguarded: the old behaviour
        assert.deepEqual(s.burns(), []); assert.equal(log.filter((x) => x === 'acct.stTake').length, 0);
      } finally { s.done(); }
    });

    it('withdrawing and linking again adds only what the guest really earned: no second reward, no arrival coins', async () => {
      const s = await scene(db);
      try {
        let u = await s.linked();
        assert.equal((await s.post('/rt/auth/withdraw', {}, u.token)).status, 200);
        assert.equal(await s.coins(u.id), null); // everything the account had is deleted with it, link_bonus too
        assert.equal(s.gone().length, 1); assert.match(s.gone()[0], /^[0-9a-f]{32}$/); // the mark is a keyed hash, never the id
        u = await s.relogin(u); // the login was kept and its owner signs in again
        const g = await s.guest(); await s.earn(g.id, 25);
        const r = await s.link(u, g); // before: the database pays 300 again and moves 165; after: it pays nothing and leaves 140 out
        assert.equal(r.bonus, 0); assert.equal(r.again, true); assert.equal(r.coins, 25); assert.equal(await s.coins(u.id), 25);
        assert.equal(s.burns().filter((x) => x.includes(u.id)).length, A ? 0 : 16); // before: 440 back, fourteen 30s, +10, one more 30
        // The second cycle, with an untouched guest: nothing at all.
        assert.equal((await s.post('/rt/auth/withdraw', {}, u.token)).status, 200); assert.equal(s.gone().length, 1);
        u = await s.relogin(u);
        const r2 = await s.link(u, await s.guest());
        assert.equal(r2.bonus, 0); assert.equal(r2.coins, 0); assert.equal(await s.coins(u.id), 0);
        // A guest with no row: nothing moves; before, the 300 alone goes back (ten 30s).
        assert.equal((await s.post('/rt/auth/withdraw', {}, u.token)).status, 200);
        u = await s.relogin(u);
        const n0 = s.burns().length, r3 = await s.link(u, await s.bare());
        assert.equal(r3.bonus, 0); assert.equal(await s.coins(u.id), 0); assert.equal(s.burns().length - n0, A ? 0 : 10);
        // From here it is an ordinary linked account again: a later link of a guest that earned 50 adds 50, and says nothing more.
        const g4 = await s.guest(); await s.earn(g4.id, 50); const r4 = await s.link(u, g4); assert.equal(await s.coins(u.id), 50); assert.equal('again' in r4, false);
        // Somebody else's first link is untouched.
        const other = await s.user(), r5 = await s.link(other, await s.guest()); assert.equal(r5.bonus, 300); assert.equal(await s.coins(other.id), 440);
      } finally { s.done(); }
    });

    it('a token from before the withdrawal moves nothing: its link is refused, a fresh sign-in of a kept login is not', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), g = await s.guest();
        s.clock.add(5000); assert.equal((await s.post('/rt/auth/withdraw', {}, u.token)).status, 200);
        const n0 = s.state.rpcs.filter((x) => x.startsWith('merge_guest_account ')).length;
        const res = await s.post('/rt/auth/merge', { guest_id: g.id, guest_token: g.token, nickname: '' }, u.token); // the same token, still valid for an hour
        assert.equal(res.status, 401); assert.deepEqual(await res.json(), GONE);
        assert.equal(s.state.rpcs.filter((x) => x.startsWith('merge_guest_account ')).length, n0); assert.equal(await s.coins(g.id), 140); assert.equal(await s.coins(u.id), null);
        const back = await s.relogin(u), r = await s.link(back, g); assert.equal(r.again, true); assert.equal(await s.coins(u.id), 0);
      } finally { s.done(); }
    });

    it('a withdrawal at budget level hard still leaves its mark; an unreadable mark lets the next link pass as a first one only before', async () => {
      const s = await scene(db);
      try {
        let u = await s.linked(), v = await s.linked(); const g = await s.guest(), g3 = await s.guest();
        await s.hard();
        const log = spyDo(s.env);
        assert.equal((await s.post('/rt/auth/withdraw', {}, u.token)).status, 200);
        assert.equal(s.gone().length, 1); assert.deepEqual(s.acctCalls(log, /^gone/), ['acct.goneSet']); // written at hard too
        await s.calm();
        u = await s.relogin(u); const r = await s.link(u, g); assert.equal(r.bonus, 0); assert.equal(r.again, true); assert.equal(await s.coins(u.id), 0);
        // v withdraws; this time the acct call fails at its next link.
        assert.equal((await s.post('/rt/auth/withdraw', {}, v.token)).status, 200);
        v = await s.relogin(v);
        const real = s.env.METER.get; s.env.METER.get = (n) => (n === 'acct' ? new Proxy(real(n), { get: (t, k) => (/^(stFirst|linkTake)$/.test(String(k)) ? async () => { throw new Error('do down'); } : t[k]) }) : real(n));
        const r3 = await s.link(v, g3);
        if (A) { assert.equal(r3.bonus, 0); assert.equal(await s.coins(v.id), 0); } // the database's own mark decides
        else { assert.equal(r3.bonus, 300); assert.equal(await s.coins(v.id), 440); } // the old guard could not read the mark
      } finally { s.done(); }
    });

    it('an anonymous sign-in cannot be the account of a link', async () => {
      const s = await scene(db);
      try {
        const a = await s.user(true), g = await s.guest(), n0 = s.state.rpcs.length, log = spyDo(s.env);
        const res = await s.post('/rt/auth/merge', { guest_id: g.id, guest_token: g.token, nickname: '', topic: 'chapel:square' }, a.token);
        assert.equal(res.status, 400); assert.deepEqual(await res.json(), { ok: false, error: '로그인한 계정만 연결할 수 있어요.' });
        assert.deepEqual(s.state.rpcs.slice(n0), []); assert.deepEqual(log, []); assert.equal(await s.coins(g.id), 140); assert.equal(await s.coins(a.id), null);
      } finally { s.done(); }
    });

    it('a link that moves coins (before) holds its lease until its take-back is done; nothing can be sent meanwhile or after', async () => {
      const s = await scene(db);
      try {
        const owner = await s.linked(), u = await s.rich(160), g = await s.guest(); await db.hold('STREET_23', owner.id); // u: 740
        let open, at = false; const gate = new Promise((r) => { open = r; }); s.state.before = (name) => (name === 'merge_guest_account' ? ((at = true), gate) : null); // the merge RPC is on its way
        // Wait until the RPC is really at its gate: a fixed 20 ms was too short when the whole suite runs at once.
        const linking = s.link(u, g); for (let i = 0; i < 200 && !at; i++) await new Promise((r) => setTimeout(r, 10));
        assert.ok(at, 'the merge RPC reached its gate');
        if (!A) assert.equal(s.lease(u.id), 1); else assert.equal(s.lease(u.id), 0); // after: the database does the move and its take-back in one step
        const during = await Promise.all([50, 50].map((n) => s.quick('/rt/sell-coins', { topic: 'chapel:square', slot_id: 'STREET_23', amount: n, nickname: '손님' }, u.token)));
        for (const r of during) { assert.equal(r.status, 410); assert.equal(r.body.code, 'off'); }
        open(); s.state.before = null;
        const r = await linking; assert.equal(r.coins, 740); assert.equal(await s.coins(u.id), 740); assert.equal(s.lease(u.id), 0);
        assert.equal((await s.send(u, 'STREET_23', 50)).status, 410); assert.equal(await s.coins(u.id), 740); assert.equal(s.sells(), 0);
      } finally { s.done(); }
    });

    it('before: links of one account share the acct lease, and a link whose request died lets go after the lease time', async (t) => {
      if (A) { t.skip('after the migration a rewarded account\'s link takes no lease'); return; }
      const s = await scene(db);
      try {
        const u = await s.rich(160), g = await s.guest(), M = s.env.meter('acct').do;
        const at = M.linkTake(u.id, 15000); assert.equal(typeof at, 'number'); // another isolate is linking this account
        await s.link(u, g); assert.equal(await s.coins(u.id), 740); // a second link of the account joins the first
        assert.equal(s.lease(u.id), 1); // the first one is still under way
        M.linkDone(u.id, at); assert.equal(s.lease(u.id), 0);
        M.linkTake(u.id, 15000); s.clock.add(15001); const g2 = await s.guest(); await s.link(u, g2); assert.equal(await s.coins(u.id), 740); // that request died: its lease ran out
      } finally { s.done(); }
    });

    it('the read ahead failing holds the sends anyway, and the guard still works', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), g = await s.guest(); s.state.failAhead = true;
        const log = spyDo(s.env); await s.link(u, g);
        assert.equal(await s.coins(u.id), 440); assert.deepEqual(s.acctCalls(log, /^(st|link)/), A ? ['acct.linkTake', 'acct.linkDone'] : ['acct.linkTake', 'acct.stTake', 'acct.linkDone']);
      } finally { s.done(); }
    });

    it('the merge and its take-back are handed to waitUntil before the RPC answers, so a client that leaves does not skip the take-back', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), g = await s.guest();
        let open; const gate = new Promise((r) => { open = r; }); s.state.before = (name) => (name === 'merge_guest_account' ? gate : null);
        const kept = [], ctx = { waitUntil(p) { kept.push(Promise.resolve(p)); } };
        const req = new Request('https://sq.example/rt/auth/merge', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + u.token }, body: JSON.stringify({ guest_id: g.id, guest_token: g.token, nickname: '' }) });
        const answer = worker.fetch(req, s.env, ctx); answer.catch(() => {}); // the client is gone: nobody reads the answer
        // The gate keeps the RPC out for as long as this takes, so waiting cannot hide a late hand-over: 20 ms was too
        // short when the whole suite runs at once.
        for (let i = 0; i < 200 && !kept.length; i++) await new Promise((r) => setTimeout(r, 10));
        const before = kept.length; assert.ok(before >= 1, 'the work is already with waitUntil while the RPC is still out');
        assert.equal(await s.coins(g.id), 140); open(); s.state.before = null;
        await Promise.all(kept.slice(0, before)); // what the runtime keeps alive
        assert.equal(await s.coins(g.id), 0); assert.equal(await s.coins(u.id), 440); assert.equal(s.lease(u.id), 0); // moved, taken back, hold released
        await answer; while (kept.length) await Promise.all(kept.splice(0));
      } finally { s.done(); }
    });
  });
}
// Before the migration first: the Worker remembers a database that guards links for the isolate's whole life.
suite('model, before the migration', async () => memDb({ guard: false }), false);
suite('schema.sql before the migration, in PGlite', () => pgDb(OLD_SCHEMA, false), NO_OLD);
suite('model, after the migration', async () => memDb({ guard: true }), false);
suite('schema.sql in PGlite (after the migration)', () => pgDb(read('schema.sql'), true), NO_PG);

describe('after the migration, an older Worker (rollback) never takes the arrival coins back a second time', { concurrency: false }, () => {
  it('the new answer has no `moved`, and the old guard reads that as "nothing to take back"', async () => {
    const db = memDb({ guard: true }), s = await scene(db);
    try {
      const u = await s.linked(), r = await db.rpc('merge_guest_account', { p_key: KEY, p_user_id: u.id, p_guest_id: (await s.guest()).id, p_nickname: '' });
      assert.equal('moved' in r, false); assert.equal(r.guard, 2); assert.equal(r.back, 140); assert.equal(r.moved_in, 140);
      assert.match(read('worker.js'), /const moved = typeof data\.moved === 'number' \? Math\.max\(0, Math\.floor\(data\.moved\)\) : 0; \/\/ no numeric moved: the function does not say, nothing counts as starter/);
      assert.doesNotMatch(read('schema.sql').slice(read('schema.sql').indexOf('CREATE OR REPLACE FUNCTION public.merge_guest_account(')), /^\s*'moved',/m);
    } finally { s.done(); }
  });
});

// ---- /rt/sell-coins and /rt/tribe/pledge: closed for everybody ---------------------------------------------------------------------------------
const NO_SEND = { ok: false, code: 'off', error: '응원 포인트는 다른 사람에게 보낼 수 없어요.' };
const NO_POOL = { ok: false, code: 'off', error: '소속 모금은 닫혔어요. 응원 포인트는 모아서 보낼 수 없어요.' };
const HARD = { ok: false, code: 'busy', error: '지금은 광장이 붐벼요. 잠시 뒤에 다시 해 주세요.' };
describe('transfers are closed (응원 포인트 are never sent or pooled)', { concurrency: false }, () => {
  const db = memDb();
  it('a guest, an account, an anonymous sign-in, a rich account and no token at all: 410 off, nothing asked, nothing moved', async () => {
    const s = await scene(db);
    try {
      const owner = await s.linked(), u = await s.rich(500), g = await s.guest(), a = await s.user(true); await db.hold('STREET_12', owner.id); await s.tribe(u);
      const log = spyDo(s.env), rpcs = s.state.rpcs.length, had = await s.coins(u.id);
      for (const who of [g, u, a]) for (const n of [10, 20, 50]) {
        const r = await s.send(who, 'STREET_12', n); assert.equal(r.status, 410); assert.deepEqual(r.body, NO_SEND);
        const p = await s.pledge(who, n); assert.equal(p.status, 410); assert.deepEqual(p.body, NO_POOL);
      }
      for (const path of ['/rt/sell-coins', '/rt/tribe/pledge']) {
        const none = await s.call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(none.status, 410); // no token
        const getr = await s.call(path); assert.equal(getr.status, 410); // any method
      }
      await s.hard(); assert.equal((await s.send(u, 'STREET_12', 10)).status, 410); await s.calm(); // budget hard: the same answer
      assert.deepEqual(log.filter((x) => !x.startsWith('wish.')), [], 'no Durable Object call'); // (the wish reads are hard() and calm() setting the level)
      assert.deepEqual(s.state.rpcs.slice(rpcs), [], 'no RPC');
      assert.equal(s.sells() + s.pledges(), 0); assert.equal(await s.coins(u.id), had); assert.equal(await s.coins(owner.id), 440); assert.equal(s.lease(u.id), 0);
    } finally { s.done(); }
  });
  it('the Worker keeps no send path: no floor, no hold, no lease for sends', () => {
    const w = read('worker.js');
    assert.doesNotMatch(w, /SEND_FLOOR|sellTake|sellDone|function floored|function sendHold|sell_coins_to_advertiser',|'pledge_tribe'/);
    assert.match(w, /if \(u\.pathname === '\/rt\/sell-coins'\) return J\(NO_SEND, 410\);/);
    assert.match(w, /if \(u\.pathname === '\/rt\/tribe\/pledge'\) return J\(NO_POOL, 410\);/);
  });
});

// ---- the rest: needs no database of its own -------------------------------------------------------------------------------------------------
describe('the share bonus and the VIP code', { concurrency: false }, () => {
  const db = memDb();

  it('share bonus: accounts only; a guest or an anonymous sign-in is refused with code account before any DO call or RPC', async () => {
    const s = await scene(db);
    try {
      const g = await s.guest(), anon = await s.user(true), log = spyDo(s.env), rpcs = s.state.rpcs.length;
      for (const who of [g, anon]) {
        const res = await s.post('/rt/share-bonus', {}, who.token, '7.7.6.1');
        assert.equal(res.status, 403); assert.deepEqual(await res.json(), { ok: false, code: 'account', error: '계정을 연결하면 공유 보너스 300포인트를 받을 수 있어요.' });
      }
      assert.deepEqual(log, []); assert.equal(s.state.rpcs.length, rpcs); assert.equal(await s.coins(g.id), 140);
      // The refusal takes nothing: the same network's account still gets today's bonus.
      const u = await s.linked(), ok = await s.post('/rt/share-bonus', {}, u.token, '7.7.6.1'); assert.equal(ok.status, 200); assert.equal(await s.coins(u.id), 740);
    } finally { s.done(); }
  });

  // Owner decision 2026-11-27: the account gets the share bonus once, ever (still paid on the share itself); the network stays once a KST day.
  const ONCE = { ok: false, code: 'once', error: '공유 보너스는 계정마다 한 번만 받아요.' };
  const NET = { ok: false, code: 'net', error: '오늘 이 인터넷 연결에서는 이미 공유 보너스를 받았어요. 내일 다시 해 주세요.' };
  it('share bonus: once per account ever and once a KST day per network, remembered in the acct instance, the address hashed', async () => {
    const s = await scene(db);
    try {
      const a = await s.linked(), b = await s.linked(), c = await s.linked(), d = await s.linked(), M = s.env.meter('acct').do, sql = s.env.meter('acct').sql.db, log = spyDo(s.env);
      const claim = async (who, ip) => { const res = await s.post('/rt/share-bonus', {}, who.token, ip); return { status: res.status, body: await res.json() }; };
      const grants = () => s.state.rpcs.filter((x) => x.startsWith('grant_coins ')).length;
      const first = await claim(a, '7.7.7.1'); assert.equal(first.status, 200); assert.equal(first.body.amount, 300); assert.equal(await s.coins(a.id), 740);
      assert.deepEqual(s.acctCalls(log, /^promo/), ['acct.promoTake']);
      const once = sql.prepare('select k, d from prs').all(), rows = sql.prepare('select k, d from prm').all();
      assert.equal(once.length, 1); assert.equal(once[0].k, 's:' + a.id); // the account: a row of its own that is never pruned
      assert.equal(rows.length, 1); assert.match(rows[0].k, /^i:[0-9a-f]{16}$/); assert.equal(JSON.stringify(rows).includes('7.7.7.1'), false); // the network, hashed
      const day = rows[0].d; assert.equal(once[0].d, day);
      // What another isolate would see: this one's memory is not asked, the acct record alone refuses.
      assert.deepEqual(M.promoTake(['s:' + a.id, 'i:someone-else'], day), ['s:' + a.id]); // the account, from another address
      assert.deepEqual(M.promoTake(['s:' + b.id, rows[0].k], day), [rows[0].k]); // another account, from the same address
      assert.equal(M.promoTake(['s:' + b.id, 'i:other'], day), true); // b claimed somewhere else: only the acct instance knows
      const g0 = grants(), no = await claim(b, '7.7.7.2'); assert.equal(no.status, 400); assert.deepEqual(no.body, ONCE); assert.equal(grants(), g0);
      const fam = await claim(d, '7.7.7.1'); assert.equal(fam.status, 400); assert.deepEqual(fam.body, NET); assert.equal(grants(), g0); // a's network, today
      // A grant that fails gives the record back, so the claim can be made again; then it is the account's one.
      s.state.fail = (name) => (name === 'grant_coins' ? json({ message: 'upstream' }, 500) : null);
      const bad = await claim(c, '7.7.7.3'); assert.equal(bad.status, 502); assert.equal(sql.prepare('select count(*) n from prs where k = ?').get('s:' + c.id).n, 0);
      s.state.fail = null; const again = await claim(c, '7.7.7.3'); assert.equal(again.status, 200); assert.equal(await s.coins(c.id), 740);
      assert.deepEqual((await claim(c, '7.7.7.3')).body, ONCE);
      // The next day the networks are open again and yesterday's network rows are gone; the accounts are not open again.
      s.clock.add(864e5);
      for (const ip of ['7.7.7.1', '7.7.7.9']) { const r = await claim(a, ip); assert.equal(r.status, 400); assert.deepEqual(r.body, ONCE); }
      const next = await claim(d, '7.7.7.1'); assert.equal(next.status, 200); assert.equal(await s.coins(d.id), 740); // another account on a's network, the next day
      assert.equal(sql.prepare('select count(*) n from prm where d = ?').get(day).n, 0); assert.equal(sql.prepare('select count(*) n from prs').get().n, 4);
      const day2 = sql.prepare('select d from prm').get().d; assert.notEqual(day2, day);
      assert.deepEqual(M.promoTake(['s:' + a.id, 'i:fresh'], day2), ['s:' + a.id]); // another isolate, the next day: the acct record alone refuses
      assert.equal(await s.coins(a.id), 740); assert.equal(await s.coins(b.id), 440); // a was paid once, b (claimed elsewhere) never here
      // A guest is still refused before anything is asked or counted.
      const g = await s.guest(), gl = spyDo(s.env), gr = await claim(g, '7.7.7.5'); assert.equal(gr.status, 403); assert.equal(gr.body.code, 'account'); assert.deepEqual(gl, []);
      // The address key is the network: another address in the same IPv6 /64 is the same address (one phone cannot walk through its /64).
      const e = await s.linked(), f = await s.linked();
      const v6 = await claim(e, '2001:db8:1:2::10'); assert.equal(v6.status, 200);
      const same = await claim(f, '2001:db8:1:2:ffff::99'); assert.equal(same.status, 400); assert.deepEqual(same.body, NET);
      assert.equal((await claim(f, '2001:db8:1:3::10')).status, 200); // the next /64 is another network
    } finally { s.done(); }
  });

  it('share bonus where the record cannot be asked (budget level hard, or the acct call failing): refused, nothing paid', async () => {
    const s = await scene(db);
    try {
      const a = await s.linked(), b = await s.linked(), grants = () => s.state.rpcs.filter((x) => x.startsWith('grant_coins ')).length;
      const real = s.env.METER.get; s.env.METER.get = (n) => (n === 'acct' ? new Proxy(real(n), { get: (t, k) => (k === 'promoTake' ? async () => { throw new Error('do down'); } : t[k]) }) : real(n));
      const down = await s.post('/rt/share-bonus', {}, a.token, '8.8.8.1'); assert.equal(down.status, 503); assert.deepEqual(await down.json(), HARD);
      s.env.METER.get = real; assert.equal(grants(), 0); assert.equal(await s.coins(a.id), 440);
      await s.hard();
      const log = spyDo(s.env);
      for (const [who, ip] of [[a, '8.8.8.1'], [a, '8.8.8.2'], [b, '8.8.8.1']]) { const r = await s.post('/rt/share-bonus', {}, who.token, ip); assert.equal(r.status, 503); assert.deepEqual(await r.json(), HARD); }
      assert.deepEqual(s.acctCalls(log, /^promo/), []); assert.equal(grants(), 0);
      await s.calm(); assert.equal((await s.post('/rt/share-bonus', {}, a.token, '8.8.8.1')).status, 200); assert.equal(await s.coins(a.id), 740);
    } finally { s.done(); }
  });

  it('redeem code is closed (2026-11-27): 410 off before any token check, acct call or grant, even with VIP_CODES set', async () => {
    const s = await scene(db, { VIP_CODES: 'GOLDCODE1, SILVERCODE2' });
    try {
      const a = await s.guest(), log = spyDo(s.env), before = await s.coins(a.id);
      const redeem = async (who, code) => { const res = await s.post('/rt/redeem-code', { code }, who?.token); return { status: res.status, body: await res.json() }; };
      for (const [who, code] of [[a, 'GOLDCODE1'], [a, 'SILVERCODE2'], [a, 'NOTACODE99'], [null, 'GOLDCODE1']]) {
        const r = await redeem(who, code); assert.equal(r.status, 410); assert.deepEqual(r.body, { ok: false, code: 'off', error: '스폰서 코드는 닫혔어요. 코드로 주는 응원 포인트는 없어요.' });
      }
      assert.deepEqual(s.acctCalls(log, /^code/), []);
      assert.equal(await s.coins(a.id), before);
    } finally { s.done(); }
  });
});

describe('Meter leases, marks and the share-bonus record', () => {
  const clocked = (fn) => { const orig = Date.now; let t = 1e12; Date.now = () => t; try { fn({ add: (ms) => { t += ms; } }); } finally { Date.now = orig; } };
  it('linkTake: links of one account share a lease and count; the coin-send lease is gone', () => clocked((clock) => {
    const m = new Meter(makeCtx(sqliteStorage()), {});
    assert.equal('sellTake' in m, false); assert.equal('sellDone' in m, false);
    const n = () => m.ctx.storage.sql.exec('select coalesce(sum(n), 0) n from lkl').one().n;
    const a1 = m.linkTake('user:a', 15000), a2 = m.linkTake('user:a', 15000); assert.equal(typeof a1, 'number'); assert.equal(a2, a1); assert.equal(n(), 2);
    const b1 = m.linkTake('user:b', 15000); assert.equal(typeof b1, 'number');
    m.linkDone('user:a', a1); assert.equal(n(), 2); // one link of user:a is still under way, and user:b's
    m.linkDone('user:a', a2); m.linkDone('user:b', b1); assert.equal(n(), 0);
    const old = m.linkTake('user:a', 15000); clock.add(15001); const fresh = m.linkTake('user:a', 15000); assert.notEqual(fresh, old); // the first one ran out
    m.linkDone('user:a', old); assert.equal(n(), 1); // a late release of the dead lease does not end the live one
    m.linkDone('user:a', fresh); assert.equal(n(), 0);
    assert.equal(m.linkTake('', 15000), false);
  }));
  it('goneSince: a token issued before the latest withdrawal of any of its marks is gone, a later one or one without iat is not', () => clocked((clock) => {
    const m = new Meter(makeCtx(sqliteStorage()), {});
    const iat = Math.floor(Date.now() / 1000); clock.add(5000);
    assert.equal(m.goneSince(['h-id', 'h-mail'], iat), false); assert.equal(typeof m.linkTake('user:x', 15000, ['h-id'], iat), 'number');
    m.goneSet(['h-id', 'h-mail']);
    assert.equal(m.goneSince(['h-id'], iat), true); assert.equal(m.goneSince(['h-other', 'h-mail'], iat), true); assert.equal(m.goneSince(['h-other'], iat), false);
    assert.equal(m.goneSince(['h-id'], 0), false); assert.equal(m.goneSince(['h-id']), false); // no iat: not held back
    assert.equal(m.linkTake('user:y', 15000, ['h-id'], iat), 'gone');
    clock.add(1000); const later = Math.floor(Date.now() / 1000); assert.equal(m.goneSince(['h-id'], later), false); // signed in after the withdrawal
    clock.add(1000); m.goneSet('h-id'); assert.equal(m.goneSince(['h-id'], later), true); // a second withdrawal moves the mark forward
    assert.equal(m.ctx.storage.sql.exec('select count(*) n from gone').one().n, 2);
  }));
  it('goneSet / stFirst: a real first link counts what it moved (part 0); after a withdrawal the same call also says that part', () => {
    const m = new Meter(makeCtx(sqliteStorage()), {});
    assert.deepEqual(m.stFirst('guest:a', 0, 140, 'hash-1'), { gone: false, part: 0 }); assert.equal(m.stTake('guest:a', 40, 140), 40); // nothing moved: not settled
    assert.deepEqual(m.stFirst('guest:f', 170, 140, ''), { gone: false, part: 0 }); assert.equal(m.stTake('guest:f', 50, 140), 0); // all 140 moved
    assert.deepEqual(m.stFirst('guest:h', 50, 140, ''), { gone: false, part: 0 }); assert.equal(m.stTake('guest:h', 100, 140), 90); // 50 moved, 90 left
    assert.equal(m.goneSet('hash-1'), true); assert.equal(m.goneSet('hash-1'), true); assert.equal(m.goneSet(''), false);
    assert.deepEqual(m.stFirst('guest:b', 170, 140, 'hash-1'), { gone: true, part: 140 }); assert.deepEqual(m.stFirst('guest:c', 0, 140, 'hash-1'), { gone: true, part: 0 });
    assert.equal(m.stTake('guest:c', 60, 140), 60); // not settled by a link that was not a first one
    assert.deepEqual(m.stFirst('guest:d', 70, 140, 'hash-2'), { gone: false, part: 0 }); assert.deepEqual(m.stFirst('guest:e', 70, 140, ''), { gone: false, part: 0 });
  });
  it('promoTake / promoGive: all keys or none; an account key once ever, a network key once a day, older network days dropped', () => {
    const m = new Meter(makeCtx(sqliteStorage()), {}), n = (t) => m.ctx.storage.sql.exec(`select count(*) n from ${t}`).one().n;
    assert.equal(m.promoTake(['s:a', 'i:1'], '2029-01-02'), true); assert.deepEqual(m.promoTake(['s:a', 'i:2'], '2029-01-02'), ['s:a']); assert.deepEqual(m.promoTake(['s:b', 'i:1'], '2029-01-02'), ['i:1']);
    assert.equal(m.promoTake(['s:b', 'i:2'], '2029-01-02'), true); // the refused ones took nothing
    m.promoGive(['s:a', 'i:1'], '2029-01-02'); assert.equal(m.promoTake(['s:a', 'i:1'], '2029-01-02'), true); // a failed grant hands both back
    // The next day the networks are open again, the accounts are not.
    assert.deepEqual(m.promoTake(['s:a', 'i:1'], '2029-01-03'), ['s:a']); assert.deepEqual(m.promoTake(['s:b', 'i:9'], '2029-01-03'), ['s:b']);
    assert.equal(m.promoTake(['s:c', 'i:1'], '2029-01-03'), true);
    assert.deepEqual(m.promoTake(['s:a', 'i:5'], '2030-06-01'), ['s:a']); // a year later too
    assert.equal(n('prs'), 3); assert.equal(m.ctx.storage.sql.exec("select count(*) n from prm where d < '2030-06-01'").one().n, 0);
    m.promoGive(['s:c'], '2029-01-02'); assert.deepEqual(m.promoTake(['s:c', 'i:7'], '2030-06-01'), ['s:c']); // a hand-back names its own day: it never frees an older record
    assert.equal(m.promoTake([], '2029-01-03'), false); assert.equal(m.promoTake(['s:z'], ''), false);
  });
  it('promoTake: the account rows prm kept while the bonus was daily move into prs, and an account row left in prm refuses on any day', () => {
    const m = new Meter(makeCtx(sqliteStorage()), {}), q = m.ctx.storage.sql;
    q.exec('create table prm(k text, d text, primary key(k, d))'); // as the daily version left it on the day of the deploy
    for (const [k, d] of [['s:today', '2029-01-02'], ['i:net', '2029-01-02'], ['s:twice', '2029-01-01'], ['s:twice', '2029-01-02']]) q.exec('insert into prm(k, d) values(?, ?)', k, d);
    assert.deepEqual(m.promoTake(['s:today', 'i:other'], '2029-01-02'), ['s:today']); // got it today, before the change: not paid again
    assert.deepEqual(q.exec('select k, d from prs order by k').toArray().map((r) => [r.k, r.d]), [['s:today', '2029-01-02'], ['s:twice', '2029-01-01']]);
    assert.equal(q.exec("select count(*) n from prm where k like 's:%'").one().n, 0);
    assert.deepEqual(m.promoTake(['s:new', 'i:net'], '2029-01-02'), ['i:net']); // the network row stays a network row for that day
    assert.equal(m.promoTake(['s:new', 'i:net'], '2029-01-03'), true);
    q.exec("insert into prm(k, d) values('s:late', '2029-01-03')"); // a row an older Worker wrote after the move
    assert.deepEqual(m.promoTake(['s:late', 'i:x'], '2029-02-01'), ['s:late']); // pruning keeps it, and it still refuses
    assert.equal(m.promoTake(['s:gone-before', 'i:y'], '2029-02-01'), true); // a record already pruned before the change is not known: paid once more
  });
});

describe('Meter.stTake', () => {
  it('counts a guest\'s arrival coins once, up to the cap, and ignores bad input', () => {
    const m = new Meter(makeCtx(sqliteStorage()), {});
    assert.equal(m.stTake('guest:a', 70, 140), 70);
    assert.equal(m.stTake('guest:a', 50, 140), 50);
    assert.equal(m.stTake('guest:a', 70, 140), 20);
    assert.equal(m.stTake('guest:a', 70, 140), 0);
    assert.equal(m.stTake('guest:b', 1000, 140), 140);
    assert.equal(m.stTake('guest:b', 1, 140), 0);
    for (const bad of [0, -5, NaN, null, undefined, 'x']) assert.equal(m.stTake('guest:c', bad, 140), 0);
    assert.equal(m.stTake('', 50, 140), 0); assert.equal(m.stTake('guest:c', 50, 0), 0);
    assert.equal(m.stTake('guest:c', 50.9, 140), 50);
  });
});
