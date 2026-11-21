// Package U6: the starter guard on account links (/rt/auth/merge). A guest wallet starts with 100 coins nobody earned and merge_guest_account moves
// every coin, so sign-out -> a new guest -> sign-in added 100 a cycle. The same scenarios run against two stand-ins for Supabase:
//   model      the wallet functions of schema.sql rewritten in JS (always runs)
//   schema.sql the real functions in PGlite, when it is installed outside the repo (see test/db.test.mjs for how)
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

// ---- Supabase stand-in 1: schema.sql's wallet functions in JS ---------------------------------------------------------------------------------
// Each function body is one synchronous step, as each RPC is one transaction. Kept to what schema.sql does today: the starting balance is the column
// default (100) for any INSERT that names no coins, coin_batch inserts 100 + delta, spend_plaza takes exactly 30 / 5000 / one ticket, grant_coins
// only adds, merge_guest_account moves every coin and pays 300 while link_bonus is false, withdraw_account deletes the wallet row.
function memDb() {
  const wallets = new Map(), boards = [];
  const row = (id, coins = 100) => { if (!wallets.has(id)) wallets.set(id, { actor_id: id, nickname: '네온손님', coins, vip_tickets: 0, linked: false, link_bonus: false }); return wallets.get(id); };
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
      if (!/^user:[A-Za-z0-9_-]{8,80}$/.test(a.p_user_id)) return { ok: false, error: '계정 정보가 올바르지 않습니다.' };
      if (!/^guest:g-[0-9a-f-]{36}$/.test(a.p_guest_id)) return { ok: false, error: '게스트 정보가 올바르지 않습니다.' };
      if (!wallets.has(a.p_user_id)) wallets.set(a.p_user_id, { actor_id: a.p_user_id, nickname: '네온손님', coins: 0, vip_tickets: 0, linked: true, link_bonus: false });
      const u = wallets.get(a.p_user_id), g = wallets.get(a.p_guest_id); let moved = 0, bonus = 0;
      if (g && g.coins > 0) { moved = g.coins; g.coins = 0; u.coins += moved; }
      if (!u.link_bonus) { u.coins += 300; u.link_bonus = true; bonus = 300; }
      u.linked = true; if (a.p_nickname) u.nickname = String(a.p_nickname).slice(0, 16);
      for (const b of boards) if (b.holder_id === a.p_guest_id) b.holder_id = a.p_user_id;
      return { ok: true, actor_id: a.p_user_id, coins: u.coins, bonus, moved, nickname: u.nickname, linked: true };
    },
    withdraw_account(a) { for (const b of boards) if (b.holder_id === a.p_actor_id) b.holder_id = null; wallets.delete(a.p_actor_id); return { ok: true, actor_id: a.p_actor_id }; },
  };
  return {
    async rpc(name, a) { if (!fns[name]) return { ok: true }; if (a.p_key !== KEY) throw new Error('Unauthorized worker key'); return fns[name](a); },
    async wallet(id) { const w = wallets.get(id); return w ? { ...w } : null; },
    async boards(holder) { return boards.filter((b) => b.holder_id === holder).map((b) => ({ ...b })); },
    async hold(slot, id) { const b = boards.find((x) => x.slot_id === slot); if (b) b.holder_id = id; else boards.push({ slot_id: slot, holder_id: id }); },
    async holder(slot) { return boards.find((x) => x.slot_id === slot)?.holder_id ?? null; },
  };
}

// ---- Supabase stand-in 2: the real schema.sql in PGlite ---------------------------------------------------------------------------------------
async function loadPGlite() {
  for (const d of [process.env.PGLITE_DIR, join(tmpdir(), 'kts-pglite')].filter(Boolean)) {
    try { const req = createRequire(join(d, 'package.json')); return (await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href)).PGlite; } catch { }
  }
  try { return (await import('@electric-sql/pglite')).PGlite; } catch { return null; }
}
const PGlite = await loadPGlite();
if (!PGlite) console.log('# merge-guard.test: PGlite not installed, the schema.sql half is skipped. Install it in ' + join(tmpdir(), 'kts-pglite') + ' (npm i @electric-sql/pglite) or set PGLITE_DIR.');
const REAL = ['profile_read', 'coin_batch', 'spend_plaza', 'grant_coins', 'merge_guest_account', 'withdraw_account'];
async function pgDb() {
  const db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;'); // Supabase gives these; PGlite does not
  await db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
  await db.query('UPDATE public.app_secrets SET key_value = $1 WHERE key_name = $2', [KEY, 'FLUSH_KEY']);
  return {
    async rpc(name, a) { if (!REAL.includes(name)) return { ok: true }; const keys = Object.keys(a);
      const sql = 'SELECT public.' + name + '(' + keys.map((k, i) => k + ' => $' + (i + 1) + (k === 'p_items' ? '::jsonb' : '')).join(', ') + ') AS r';
      return (await db.query(sql, keys.map((k) => (k === 'p_items' ? JSON.stringify(a[k]) : a[k])))).rows[0].r; },
    async wallet(id) { return (await db.query('SELECT actor_id, nickname, coins::float8 AS coins, vip_tickets, linked, link_bonus FROM public.wallets WHERE actor_id = $1', [id])).rows[0] || null; },
    async boards(holder) { return (await db.query('SELECT slot_id, holder_id FROM public.billboards WHERE holder_id = $1', [holder])).rows; },
    async hold(slot, id) { const r = await db.query('UPDATE public.billboards SET holder_id = $1 WHERE slot_id = $2', [id, slot]); assert.equal(r.affectedRows, 1, slot); },
    async holder(slot) { return (await db.query('SELECT holder_id FROM public.billboards WHERE slot_id = $1', [slot])).rows[0]?.holder_id ?? null; },
  };
}

// The Worker's fetch, answered from one of the two. state.rpcs: every RPC as 'name actor amount'. state.fail(name, args) may answer in its place
// (or throw, a network error); state.shape(name, answer) may change an answer (an older function shape).
function fakeNet(state, db) {
  return async (url, opt = {}) => {
    const u = String(url);
    if (u.includes('/.well-known/jwks.json')) return json({ keys: state.jwks || [] });
    if (u.includes('/auth/v1/user')) return json({});
    if (u.includes('/rest/v1/billboards')) { state.reads++; const h = /holder_id=eq\.([^&]+)/.exec(u); return json(h ? await db.boards(decodeURIComponent(h[1])) : []); }
    if (u.includes('/rest/v1/wallets')) { state.reads++; const m = /actor_id=eq\.([^&]+)/.exec(u), w = m ? await db.wallet(decodeURIComponent(m[1])) : null; return json(w ? [w] : []); }
    const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u);
    if (m) { const a = JSON.parse(opt.body || '{}'); state.rpcs.push([m[1], a.p_actor_id || a.p_user_id || '', a.p_coins ?? a.p_amount ?? ''].join(' ').trim());
      const bad = state.fail?.(m[1], a); if (bad) return bad;
      try { const out = await db.rpc(m[1], a); return json(state.shape ? state.shape(m[1], out) : out); } catch (e) { return json({ message: String(e?.message || e) }, 400); } }
    if (u.includes('/rest/v1/')) { state.reads++; return json([]); }
    return new Response('missing', { status: 404 });
  };
}
let clockBase = Date.parse('2029-03-01T03:00:00Z'), kid = 0, seq = 0;
// Each test runs days apart, so the isolate's copies (budget level, tally, world) of an earlier test are stale for the next one.
async function scene(db, extra = {}) {
  clockBase += 10 * 864e5; let t = clockBase; const origNow = Date.now, origFetch = globalThis.fetch, state = { rpcs: [], reads: 0 };
  Date.now = () => t; globalThis.fetch = fakeNet(state, db); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  const env = makeEnv(extra), waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (p, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + p, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const post = (p, body, token) => call(p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const get = (p, token) => call(p, { headers: token ? { authorization: 'Bearer ' + token } : {} });
  // A guest as /rt/guest mints it. No wallet row yet.
  const bare = async () => { const tok = (await (await post('/rt/guest', {})).json()).token; return { token: tok, id: 'guest:' + JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).s }; };
  // A guest that entered the square: the profile read on entering makes its wallet row, with the database's starting balance.
  const guest = async () => { const g = await bare(); assert.equal((await get('/rt/profile', g.token)).status, 200); return g; };
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']), k = 'mg-' + (++kid);
  state.jwks = [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: k }];
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), head = enc({ alg: 'ES256', kid: k });
  const user = async () => { const sub = '5eed0000-0000-4000-8000-' + String(++seq).padStart(12, '0'), claims = enc({ sub, exp: Math.floor(t / 1000) + 86400, iss: 'https://yxddhpacuyaffaoutxjn.supabase.co/auth/v1', aud: 'authenticated' });
    return { id: 'user:' + sub, token: head + '.' + claims + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(head + '.' + claims))).toString('base64url') }; };
  const coins = async (id) => (await db.wallet(id))?.coins ?? null;
  const earn = (id, n) => db.rpc('coin_batch', { p_key: KEY, p_items: [{ actor_id: id, nickname: '', delta: n, reason: 'mine' }] }); // what a room flush does
  const spend30 = async (id) => assert.equal((await db.rpc('spend_plaza', { p_key: KEY, p_actor_id: id, p_coins: 30, p_tickets: 0 })).ok, true); // a sticker
  // The link as net.js sends it. Every answer must be the same plain success, whatever the guard did.
  const link = async (u, g) => { const res = await post('/rt/auth/merge', { guest_id: g.id, guest_token: g.token, nickname: '', topic: 'chapel:square' }, u.token), body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body)); assert.deepEqual(Object.keys(body).sort(), ['actor_id', 'bonus', 'coins', 'linked', 'nickname', 'ok']);
    assert.equal(body.ok, true); assert.equal(body.actor_id, u.id); assert.equal(body.linked, true); return body; };
  // An account that has linked once already: 100 (the first guest's starter) + 300.
  const linked = async () => { const u = await user(), g = await guest(), r = await link(u, g); assert.equal(r.bonus, 300); assert.equal(await coins(u.id), 400); return u; };
  const stp = (id) => env.meter('acct').sql.db.prepare('select v from stp where g = ?').get(id)?.v ?? 0;
  const burns = () => state.rpcs.filter((x) => /^(spend_plaza|grant_coins) /.test(x));
  return { clock: { add: (ms) => { t += ms; } }, state, env, call, post, get, bare, guest, user, coins, earn, spend30, link, linked, stp, burns, done: () => { Date.now = origNow; globalThis.fetch = origFetch; } };
}
const utcDay = () => new Date().toISOString().slice(0, 10); // Meter.add keys its row by new Date() (the real clock, not the mocked Date.now)
const dayN = (env) => env.meter('day').sql.db.prepare('select n from d where day = ?').get(utcDay())?.n || 0;
const setUsed = (env, n) => env.meter('day').sql.db.prepare('insert into d values(?, ?) on conflict(day) do update set n = excluded.n').run(utcDay(), n);

function suite(label, makeDb, skip) {
  describe('starter guard on account links: ' + label, { concurrency: false, skip }, () => {
    let db;
    before(async () => { db = await makeDb(); });

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
      } finally { s.done(); }
    });

    it('first link: everything moves, +300 once, and nothing is taken back', async () => {
      const s = await scene(db);
      try {
        const u = await s.user(), g = await s.guest(); await s.earn(g.id, 40);
        const r = await s.link(u, g);
        assert.equal(r.bonus, 300); assert.equal(r.coins, 440);
        assert.equal(await s.coins(u.id), 440); assert.equal(await s.coins(g.id), 0);
        assert.deepEqual(s.burns(), []); // no spend, no grant
        assert.equal(s.stp(g.id), 100); // this guest's starter is now spoken for
        const again = await s.link(u, g); // the next boot replays the link
        assert.equal(again.bonus, 0); assert.equal(again.coins, 440); assert.equal(await s.coins(u.id), 440);
        assert.deepEqual(s.burns(), []);
      } finally { s.done(); }
    });

    it('second link of an untouched fresh guest adds nothing, however often it is repeated', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked();
        for (let i = 0; i < 6; i++) { // sign out -> a new guest -> sign in
          const g = await s.guest(); assert.equal(await s.coins(g.id), 100);
          const r = await s.link(u, g);
          assert.equal(r.bonus, 0); assert.equal(r.coins, 400, 'cycle ' + i);
          assert.equal(await s.coins(u.id), 400, 'cycle ' + i); assert.equal(await s.coins(g.id), 0);
        }
        assert.equal(s.burns().length, 6 * 5); // per cycle: 30 + 30 + 30, then +20 and 30
      } finally { s.done(); }
    });

    it('a guest that earned 50 over the starter adds 50', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), g = await s.guest(); await s.earn(g.id, 50);
        const r = await s.link(u, g);
        assert.equal(r.bonus, 0); assert.equal(r.coins, 450); assert.equal(await s.coins(u.id), 450); assert.equal(await s.coins(g.id), 0);
      } finally { s.done(); }
    });

    it('a guest that spent 30 of the starter adds nothing and the account loses nothing', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), g = await s.guest(); await s.spend30(g.id); assert.equal(await s.coins(g.id), 70);
        const r = await s.link(u, g);
        assert.equal(r.coins, 400); assert.equal(await s.coins(u.id), 400); assert.equal(await s.coins(g.id), 0);
        assert.deepEqual(s.burns().filter((x) => x.includes(u.id)), ['spend_plaza ' + u.id + ' 30', 'spend_plaza ' + u.id + ' 30', 'grant_coins ' + u.id + ' 20', 'spend_plaza ' + u.id + ' 30']);
      } finally { s.done(); }
    });

    it('any guest balance: the account gains what is above 100, never less than nothing', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(); let have = 400;
        for (const extra of label === 'model' ? [1, 29, 30, 31, 59, 60, 61, 89, 90, 99, 100, 101, 130, 500, 1700] : [29, 60, 100, 101]) { // the guest's balance, built from 100 + earnings - stickers
          const g = await s.guest(); let bal = 100;
          while (bal - 30 >= extra) { await s.spend30(g.id); bal -= 30; }
          for (let need = extra - bal; need > 0; need -= 500) await s.earn(g.id, Math.min(500, need));
          if (extra < bal) { await s.earn(g.id, 30 - (bal - extra)); await s.spend30(g.id); }
          assert.equal(await s.coins(g.id), extra);
          await s.link(u, g); have += Math.max(0, extra - 100);
          assert.equal(await s.coins(u.id), have, 'guest balance ' + extra);
        }
      } finally { s.done(); }
    });

    it('a guest holding a board: the board moves, the starter does not', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), g = await s.guest(); await db.hold('STREET_5', g.id);
        const r = await s.link(u, g);
        assert.equal(await db.holder('STREET_5'), u.id);
        assert.equal(r.coins, 400); assert.equal(await s.coins(u.id), 400);
        const g2 = await s.bare(); await db.hold('STREET_6', g2.id); // a board and no wallet row at all
        await s.link(u, g2);
        assert.equal(await db.holder('STREET_6'), u.id); assert.equal(await s.coins(u.id), 400);
      } finally { s.done(); }
    });

    it('two link requests at once for one guest: one moves, one takes back, both answer success', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), g = await s.guest(); await s.earn(g.id, 50);
        const [a, b] = await Promise.all([s.link(u, g), s.link(u, g)]);
        assert.equal(a.bonus + b.bonus, 0);
        assert.equal(await s.coins(u.id), 450); assert.equal(await s.coins(g.id), 0);
        assert.equal(s.burns().length, 5); // one take-back, not two
      } finally { s.done(); }
    });

    it('many fresh guests into a brand-new account at once or in a row: one first link, one starter', async () => {
      const s = await scene(db);
      try {
        const u = await s.user(), gs = [await s.guest(), await s.guest(), await s.guest(), await s.guest()];
        assert.equal((await s.get('/rt/wallet', u.token)).status, 200); // the signing key is cached before the burst
        const out = await Promise.all(gs.map((g) => s.link(u, g)));
        assert.deepEqual(out.map((r) => r.bonus).sort(), [0, 0, 0, 300]);
        assert.equal(await s.coins(u.id), 400);
        for (let i = 0; i < 3; i++) await s.link(u, await s.guest());
        assert.equal(await s.coins(u.id), 400);
      } finally { s.done(); }
    });

    it('coins that reach an already linked guest later are its earnings', async () => {
      const s = await scene(db);
      try {
        const u = await s.user(), g = await s.guest();
        await s.link(u, g); assert.equal(await s.coins(u.id), 400);
        await s.earn(g.id, 40); // a room flushed its pending coins after the link
        await s.link(u, g); assert.equal(await s.coins(u.id), 440);
        assert.deepEqual(s.burns(), []);
        // A guest that had spent 30 before its first link moved 70 of its 100: of what comes later, the next 30 are still starter.
        const u2 = await s.user(), g2 = await s.guest(); await s.spend30(g2.id);
        await s.link(u2, g2); assert.equal(await s.coins(u2.id), 370); assert.equal(s.stp(g2.id), 70);
        await s.earn(g2.id, 40); await s.link(u2, g2);
        assert.equal(await s.coins(u2.id), 380); assert.equal(s.stp(g2.id), 100);
      } finally { s.done(); }
    });

    it('linking before the wallet row exists does not free the starter for a later link', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), g = await s.bare();
        await s.link(u, g); assert.equal(await s.coins(u.id), 400); assert.equal(s.stp(g.id), 0); // nothing moved, nothing counted
        assert.equal((await s.get('/rt/profile', g.token)).status, 200); assert.equal(await s.coins(g.id), 100);
        await s.link(u, g); assert.equal(await s.coins(u.id), 400);
      } finally { s.done(); }
    });

    it('a replay asks nothing extra: the merge RPC and no stTake', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), g = await s.guest(); await s.link(u, g);
        const log = spyDo(s.env), r0 = s.state.rpcs.length, f0 = s.state.reads;
        await s.link(u, g);
        assert.deepEqual(s.state.rpcs.slice(r0).filter((x) => x !== 'plaza_live'), ['merge_guest_account ' + u.id]); // plaza_live: the world refill every link does
        assert.equal(log.filter((x) => x === 'acct.stTake').length, 0);
        assert.ok(s.state.reads - f0 >= 1);
      } finally { s.done(); }
    });

    it('the acct call is one per link that moved coins, and it is counted against the daily budget', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), g = await s.guest();
        const log = spyDo(s.env);
        s.clock.add(61000); await s.get('/rt/wishes'); // its add lands what earlier requests left pending; its own calls wait for the next one
        const base = dayN(s.env);
        s.clock.add(1000); await s.link(u, g);
        assert.equal(log.filter((x) => x === 'acct.stTake').length, 1);
        const counted = log.length; assert.equal(dayN(s.env), base);
        s.clock.add(30000); await s.call('/rt/health'); // the batch goes out
        assert.equal(dayN(s.env), base + counted + 1);
      } finally { s.done(); }
    });

    it('budget level hard: no stTake call, a later link still gives back the starter and keeps the earnings', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), fresh = await s.guest(), earner = await s.guest(), first = await s.guest(), nu = await s.user(); await s.earn(earner.id, 50);
        setUsed(s.env, 96000); s.clock.add(61000); assert.equal((await (await s.get('/rt/wishes')).json()).busy, true); // the isolate now knows the level
        const log = spyDo(s.env);
        await s.link(u, fresh); assert.equal(await s.coins(u.id), 400);
        await s.link(u, earner); assert.equal(await s.coins(u.id), 450);
        const r = await s.link(nu, first); assert.equal(r.bonus, 300); assert.equal(await s.coins(nu.id), 400); // a first link is untouched at hard too
        assert.equal(log.filter((x) => x === 'acct.stTake').length, 0);
        assert.equal(s.stp(fresh.id), 0);
      } finally { s.done(); }
    });

    it('the acct instance failing: the starter is still given back', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked(), g = await s.guest(); await s.earn(g.id, 50);
        const real = s.env.METER.get; s.env.METER.get = (n) => (n === 'acct' ? new Proxy(real(n), { get: (t, k) => (k === 'stTake' ? async () => { throw new Error('do down'); } : t[k]) }) : real(n));
        await s.link(u, g); assert.equal(await s.coins(u.id), 450);
      } finally { s.done(); }
    });

    it('a refused or failed take-back never costs the account: it keeps the remainder and the link still succeeds', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked();
        let n = 0; s.state.fail = (name) => (name === 'spend_plaza' && ++n === 2 ? json({ message: 'upstream' }, 500) : null); // the second 30 fails
        const r1 = await s.link(u, await s.guest());
        assert.equal(await s.coins(u.id), 440); assert.equal(r1.coins, 440); // 100 moved, 60 taken back, no +20 after a failure
        s.state.fail = (name) => (name === 'grant_coins' ? json({ ok: false, error: 'no' }) : null); // the +20 is refused
        await s.link(u, await s.guest()); assert.equal(await s.coins(u.id), 450); // 90 taken back
        s.state.fail = (name) => { if (name === 'spend_plaza') throw new TypeError('network down'); return null; }; // nothing can be spent
        const r3 = await s.link(u, await s.guest()); assert.equal(await s.coins(u.id), 550); assert.equal(r3.coins, 550);
        n = 0; s.state.fail = (name) => (name === 'spend_plaza' && ++n === 4 ? json({ ok: false, error: '코인이 부족해요.' }) : null); // the last 30, after the +20
        const r4 = await s.link(u, await s.guest()); assert.equal(await s.coins(u.id), 580); assert.equal(r4.coins, 580); // 90 back, +20 kept: the account is ahead, not behind
      } finally { s.done(); }
    });

    it('a merge answer without `moved` (a function that does not say) leaves the link as it was', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked();
        s.state.shape = (name, out) => { if (name !== 'merge_guest_account') return out; const { moved, ...rest } = out; return rest; };
        const log = spyDo(s.env), r = await s.link(u, await s.guest());
        assert.equal(r.coins, 500); assert.equal(await s.coins(u.id), 500); // unguarded: the old behaviour
        assert.deepEqual(s.burns(), []); assert.equal(log.filter((x) => x === 'acct.stTake').length, 0);
      } finally { s.done(); }
    });

    it('withdrawing and linking again: the wallet row and its link_bonus are gone, so 300 is paid again (not closed here)', async () => {
      const s = await scene(db);
      try {
        const u = await s.linked();
        assert.equal((await s.post('/rt/auth/withdraw', {}, u.token)).status, 200);
        assert.equal(await s.coins(u.id), null); // everything the account had is deleted with it
        const r = await s.link(u, await s.guest());
        assert.equal(r.bonus, 300); assert.equal(await s.coins(u.id), 400); // the same 400 a new account gets, never more than that
      } finally { s.done(); }
    });
  });
}
suite('model', async () => memDb(), false);
suite('schema.sql in PGlite', pgDb, PGlite ? false : 'PGlite not installed (see the first lines of this file)');

describe('Meter.stTake', () => {
  it('counts a guest\'s starter once, up to the cap, and ignores bad input', () => {
    const m = new Meter(makeCtx(sqliteStorage()), {});
    assert.equal(m.stTake('guest:a', 70, 100), 70);
    assert.equal(m.stTake('guest:a', 70, 100), 30);
    assert.equal(m.stTake('guest:a', 70, 100), 0);
    assert.equal(m.stTake('guest:b', 1000, 100), 100);
    assert.equal(m.stTake('guest:b', 1, 100), 0);
    for (const bad of [0, -5, NaN, null, undefined, 'x']) assert.equal(m.stTake('guest:c', bad, 100), 0);
    assert.equal(m.stTake('', 50, 100), 0); assert.equal(m.stTake('guest:c', 50, 0), 0);
    assert.equal(m.stTake('guest:c', 50.9, 100), 50);
  });
});
