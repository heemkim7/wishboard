// Package db: the free first-slot list the database owns, the Worker's copy of it, and the two SQL files.
// The SQL half runs the real schema in PGlite when it is installed outside the repo (no dependency here):
//   cd %TEMP%\kts-pglite && npm i @electric-sql/pglite      (or set PGLITE_DIR to a folder whose node_modules has it)
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

const { Room, Meter } = await import('../worker.js');
const worker = (await import('../worker.js')).default;
const { BALANCE, STARTER_DEFAULT, starterList, setStarterSlots, SLOT_SOON } = await import('../balance.js');
const { claimWizard } = await import('../ftue.js');

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n'); // a Windows checkout has CRLF
const MIGRATION = 'migrations/2026-11-21-mid.sql';
const CLEANUP = 'migrations/2026-11-21-cleanup-preview.sql';
const TWELVE = ['STREET_20', 'STREET_23', 'STREET_28', 'STREET_19', 'STREET_27', 'STREET_16', 'STREET_22', 'STREET_7', 'STREET_11', 'STREET_9', 'STREET_8', 'STREET_10'];
// migrations/2026-11-22-boards.sql: the twelve, then the eight new core faces nearest the bakery walk (test/boards.test.mjs).
const BOARDS = 'migrations/2026-11-22-boards.sql';
const TWENTY = [...TWELVE, 'STREET_32', 'STREET_37', 'STREET_31', 'STREET_44', 'STREET_43', 'STREET_36', 'STREET_33', 'STREET_45'];
const CLAIM_SIG = 'public.claim_billboard(text,text,text,text,bigint,text,text,text,text,text,text,text,integer,text)';

// The last CREATE OR REPLACE of a function wins in Postgres; take that one, from its head to the closing $$.
function fnBlock(sql, name) {
  const at = sql.lastIndexOf('CREATE OR REPLACE FUNCTION public.' + name + '(');
  if (at < 0) return null;
  const end = sql.indexOf('\n$$', sql.indexOf('AS $$', at));
  return sql.slice(at, end + 3);
}
// Top-level text: no function bodies, no DO blocks, no comment lines.
const topLevel = (sql) => sql.replace(/AS \$\$[\s\S]*?\n\$\$;/g, '').replace(/DO (\$\w*\$)[\s\S]*?\1;/g, '').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

describe('starter list in balance.js', () => {
  it('keeps the old four until a server list arrives, and every offer reads the one getter live', () => {
    assert.deepEqual([...BALANCE.starterSlots], ['STREET_8', 'STREET_9', 'STREET_10', 'STREET_11']);
    assert.equal(BALANCE.starterSlots, STARTER_DEFAULT);
    const open = claimWizard('STREET_20'); // opened before the list arrives
    assert.equal(open.free, false);
    try {
      assert.deepEqual(setStarterSlots(TWELVE), TWELVE);
      assert.deepEqual(BALANCE.starterSlots, TWELVE);
      assert.equal(open.free, true);
      assert.equal(open.mode, 'starter');
      assert.equal(open.payload().bid, 0);
      assert.equal(claimWizard('STREET_1').mode, 'claim');
    } finally { setStarterSlots(null); }
    assert.equal(BALANCE.starterSlots, STARTER_DEFAULT);
    assert.equal(open.mode, 'claim');
  });
  it('takes only main-street ids from the server, once each, in order', () => {
    assert.deepEqual(starterList(['STREET_20', 'MAIN_TOP', 'SUB_1A', 'PLOT_3', 'STREET_51', 'STREET_20', 7, 'STREET_9', 'STREET_40']), ['STREET_20', 'STREET_9', 'STREET_40']);
    for (const bad of [null, undefined, 'STREET_8', {}, [], ['MAIN_TOP'], Array(31).fill('STREET_1')]) assert.equal(starterList(bad), null);
    setStarterSlots(['PLOT_1']);
    assert.equal(BALANCE.starterSlots, STARTER_DEFAULT);
  });
  it('the claim wizard shows at most four open free slots, plus the one asked for', () => {
    assert.match(read('ui.js'), /free >= 4 && id !== model\.slot/);
    assert.match(read('net.js'), /setStarterSlots\(j\?\.starter\)/);
  });
});

// ---- Worker: /rt/config carries the list, the starter claim checks it --------------------------------------------
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
    storage: { sql, async getAlarm() { return null; }, async setAlarm() {}, transactionSync(fn) { sql.db.exec('BEGIN'); try { const out = fn(); sql.db.exec('COMMIT'); return out; } catch (e) { sql.db.exec('ROLLBACK'); throw e; } } },
    setWebSocketAutoResponse() {}, getWebSockets() { return []; }, getWebSocketAutoResponseTimestamp() { return new Date(); }, acceptWebSocket() {},
  };
}
const stub = (obj) => new Proxy(obj, { get: (t, k) => k === 'fetch' ? (req) => t.fetch(req) : typeof t[k] === 'function' ? async (...a) => structuredClone(await t[k](...structuredClone(a))) : t[k] });
function makeEnv() {
  const meters = new Map(), rooms = new Map();
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ASSETS: { fetch: () => new Response('asset', { status: 200 }) } };
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new Meter(makeCtx(sql), env) }); } return meters.get(name); };
  env.room = (topic) => { if (!rooms.has(topic)) { const sql = sqliteStorage(); rooms.set(topic, { sql, do: new Room(makeCtx(sql), env) }); } return rooms.get(topic); };
  env.METER = { idFromName: (name) => name, get: (name) => stub(env.meter(name).do) };
  env.ROOM = { idFromName: (topic) => topic, get: (topic) => stub(env.room(topic).do) };
  return env;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
// state.list: what starter_slot_list answers ('missing' = the function is not there yet, 'hang' = no answer).
// state.db: the slots claim_billboard accepts in starter mode (the database is the judge).
function fakeNet(state) {
  return async (url, opt = {}) => {
    const u = String(url); state.calls.push({ url: u, body: opt.body });
    if (u.includes('/rpc/starter_slot_list')) {
      if (state.list === 'missing') return json({ code: 'PGRST202', message: 'Could not find the function public.starter_slot_list(p_key) in the schema cache' }, 404);
      if (state.list === 'hang') return new Promise(() => {});
      return json({ ok: true, slots: state.list });
    }
    if (u.includes('/rest/v1/billboards')) return json([]);
    if (u.includes('/rest/v1/plots') || u.includes('/rest/v1/wallets')) return json([]);
    if (u.includes('/rpc/coin_batch')) return json({ ok: true, flushed: 0 });
    if (u.includes('/rpc/inbox_list')) return json({ items: state.inbox || [] });
    if (u.includes('/rpc/claim_billboard')) {
      const a = JSON.parse(opt.body);
      if (state.throwClaim) throw new TypeError('network down');
      if (state.claimErr) return json({ ok: false, error: state.claimErr });
      if (a.p_mode === 'starter' && !state.db.includes(a.p_slot_id)) return json({ ok: false, error: 'starter' });
      return json({ ok: true, billboard: { slot_id: a.p_slot_id, holder_id: a.p_actor_id, holder_name: a.p_nickname, line1: a.p_line1 }, remaining_coins: 100 });
    }
    return json({ ok: true });
  };
}
let clockBase = Date.parse('2027-05-01T03:00:00Z'); // 12:00 KST, main tower closed
function setup(list, db = [...STARTER_DEFAULT]) {
  clockBase += 864e5; let t = clockBase; const origNow = Date.now, origFetch = globalThis.fetch;
  Date.now = () => t;
  const state = { calls: [], list, db };
  globalThis.fetch = fakeNet(state);
  globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  const env = makeEnv(), waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const settle = async () => { while (waits.length) await Promise.all(waits.splice(0)); };
  const call = async (path, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + path, opt), env, ctx); await settle(); return res; };
  const asks = () => state.calls.filter((c) => c.url.includes('/rpc/starter_slot_list')).length;
  const raw = (path) => worker.fetch(new Request('https://sq.example' + path), env, ctx);
  return { env, state, call, raw, settle, asks, add: (ms) => { t += ms; }, done: () => { Date.now = origNow; globalThis.fetch = origFetch; } };
}
const config = async (h) => (await h.call('/rt/config')).json();
async function helloGuest(h) {
  const t = (await (await h.call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).token;
  const id = 'guest:' + JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).s;
  const room = h.env.room('chapel:square').do;
  await room.sit(id, 'chapel:square');
  const ws = { sent: [], send(s) { this.sent.push(String(s)); }, close() {}, serializeAttachment() {}, deserializeAttachment() { return null; } };
  room.socks().set(ws, { k: id, q: true, v2: true, fl: 0, lob: false, t: Date.now(), ls: Date.now(), m: { x: 0, y: 0, fl: 0 } });
  await room.webSocketMessage(ws, JSON.stringify({ t: 'BONUS', kind: 'hello', amount: 40, nick: '새' }));
  assert.equal(await room.hasHello(id), true);
  return t;
}
const starter = (h, token, slot, ip) => h.call('/rt/claim-billboard', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, 'cf-connecting-ip': ip }, body: JSON.stringify({ topic: 'chapel:square', slot_id: slot, bid: 0, mode: 'starter', line1: '첫 칸', nickname: '새' }) });
const claims = (h) => h.state.calls.filter((c) => c.url.includes('/rpc/claim_billboard')).map((c) => JSON.parse(c.body));

// Order matters: the list cache lives in the worker module, like an isolate. The first case runs before any good list was seen.
describe('worker starter list', { concurrency: false }, () => {
  it('before the migration: /rt/config gives the old four at once, and the database alone judges a starter slot', async () => {
    const h = setup('missing');
    try {
      const c = await config(h);
      assert.equal(c.url, 'https://yxddhpacuyaffaoutxjn.supabase.co');
      assert.equal(typeof c.key, 'string');
      assert.deepEqual(c.starter, ['STREET_8', 'STREET_9', 'STREET_10', 'STREET_11']);
      assert.equal(h.asks(), 1);
      assert.equal(JSON.parse(h.state.calls.find((x) => x.url.includes('starter_slot_list')).body).p_key, 'flush-test-key');
      await config(h); h.add(59e3); await config(h);
      assert.equal(h.asks(), 1); // the miss is kept for 60 s
      const token = await helloGuest(h);
      const off = await starter(h, token, 'STREET_20', '3.3.3.3'); // fallback list: the shape passes, claim_billboard refuses
      assert.equal(off.status, 400);
      assert.match((await off.json()).error, /무료 칸은 계정당 한 번이고/);
      assert.equal((await starter(h, token, 'SUB_1A', '3.3.3.3')).status, 400); // not a street slot: refused in the Worker
      assert.equal((await starter(h, token, 'STREET_9', '3.3.3.3')).status, 200);
      assert.deepEqual(claims(h).map((a) => a.p_slot_id), ['STREET_20', 'STREET_9']);
    } finally { h.done(); }
  });
  it('/rt/config never waits for Supabase: a stale or missing list goes out at once and refreshes behind the response', async () => {
    const h = setup('hang');
    try {
      h.add(61e3);
      const t0 = performance.now();
      const res = await h.raw('/rt/config');
      assert.ok(performance.now() - t0 < 500);
      assert.deepEqual((await res.json()).starter, [...STARTER_DEFAULT]);
      await h.settle(); // the refresh gives up after 1.5 s and keeps the old four
      h.state.list = TWELVE; h.add(61e3);
      assert.deepEqual((await config(h)).starter, [...STARTER_DEFAULT]); // served stale, refreshed behind it
      assert.deepEqual((await config(h)).starter, TWELVE);
    } finally { h.done(); }
  });
  it('keeps a good list for 10 minutes, and keeps it through a failed refresh', async () => {
    const h = setup(TWELVE, TWELVE);
    try {
      await config(h); // warm
      const n = h.asks();
      h.state.list = ['STREET_1', 'STREET_2'];
      h.add(9 * 6e4); assert.deepEqual((await config(h)).starter, TWELVE);
      assert.equal(h.asks(), n);
      h.state.list = 'missing'; h.add(61e3);
      await config(h);
      assert.deepEqual((await config(h)).starter, TWELVE);
      assert.equal(h.asks(), n + 1);
      h.state.list = ['STREET_1', 'STREET_2']; h.add(61e3);
      await config(h);
      assert.deepEqual((await config(h)).starter, ['STREET_1', 'STREET_2']);
      h.state.list = ['MAIN_TOP', 'PLOT_2']; h.add(11 * 6e4); // a list with no street slot is a failure too
      await config(h);
      assert.deepEqual((await config(h)).starter, ['STREET_1', 'STREET_2']);
    } finally { h.done(); }
  });
  it('with a good list the Worker checks it: a new slot passes, a slot outside it never reaches the database', async () => {
    const h = setup(TWELVE, TWELVE);
    try {
      h.add(11 * 6e4); await config(h);
      const token = await helloGuest(h);
      const off = await starter(h, token, 'STREET_1', '2.2.2.2');
      assert.equal(off.status, 400);
      assert.match((await off.json()).error, /무료 칸은 계정당 한 번이고/);
      assert.equal(claims(h).length, 0);
      const on = await starter(h, token, 'STREET_20', '2.2.2.2');
      assert.equal(on.status, 200);
      assert.deepEqual(claims(h).map((a) => [a.p_slot_id, a.p_mode, a.p_bid]), [['STREET_20', 'starter', 0]]);
    } finally { h.done(); }
  });
  it('the per-IP limit is one atomic take, given back when the database refuses the claim', async () => {
    const h = setup(TWELVE, []);
    try {
      const acct = h.env.meter('acct').do;
      assert.deepEqual([acct.sipTake('ip-a', 'd', 3), acct.sipTake('ip-a', 'd', 3), acct.sipTake('ip-a', 'd', 3), acct.sipTake('ip-a', 'd', 3)], [true, true, true, false]);
      assert.equal(acct.sipGive('ip-a', 'd'), 2);
      assert.equal(acct.sipTake('ip-a', 'd', 3), true);
      assert.equal(acct.sipGive('ip-none', 'd'), 0);
      h.add(11 * 6e4); await config(h);
      const token = await helloGuest(h);
      for (let i = 0; i < 4; i++) assert.equal((await starter(h, token, 'STREET_20', '4.4.4.4')).status, 400); // refused by the database each time
      assert.equal(claims(h).length, 4); // never stopped by the IP limit: every refusal gave its take back
      h.state.throwClaim = true;
      for (let i = 0; i < 4; i++) { try { await starter(h, token, 'STREET_20', '4.4.4.4'); } catch { /* the network error may surface */ } }
      h.state.throwClaim = false;
      assert.equal(claims(h).length, 8); // a thrown RPC gives the take back as well
      assert.equal((await starter(h, token, 'STREET_20', '4.4.4.4')).status, 400);
      assert.equal(claims(h).length, 9);
      h.state.calls.splice(0); // keep the counts below simple
      h.state.db = TWELVE;
      const many = await Promise.all(['STREET_20', 'STREET_23', 'STREET_28', 'STREET_19'].map((s) => starter(h, token, s, '5.5.5.5')));
      assert.deepEqual(many.map((r) => r.status).sort(), [200, 200, 200, 400]);
      assert.equal(claims(h).length, 3);
    } finally { h.done(); }
  });
  it('a board on the map without a database row yet (STREET_31..50 before the boards migration) is refused as "곧 열려요"', async () => {
    const h = setup(TWELVE, TWELVE);
    try {
      const token = await helloGuest(h);
      const paid = (slot) => h.call('/rt/claim-billboard', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ topic: 'chapel:square', slot_id: slot, bid: 197, line1: '첫 칸', nickname: '새' }) });
      for (const err of ['그 전광판은 점령할 수 없습니다.', '존재하지 않는 전광판 슬롯입니다.']) { // the old slot_floor(), and a missing row
        h.state.claimErr = err;
        const r = await paid('STREET_40');
        assert.equal(r.status, 400);
        assert.equal((await r.json()).error, SLOT_SOON);
      }
      h.state.claimErr = '최소 197 코인 이상 입찰해야 합니다.'; // any other refusal is passed on as before
      assert.equal((await (await paid('STREET_40')).json()).error, '최소 197 코인 이상 입찰해야 합니다.');
      h.state.claimErr = null;
      assert.equal((await paid('STREET_51')).status, 400); // not a board: refused in the Worker
      assert.equal(claims(h).filter((a) => a.p_slot_id === 'STREET_51').length, 0);
      assert.equal((await paid('STREET_40')).status, 200); // after the migration: an ordinary street board
    } finally { h.done(); }
  });
  it('/rt/inbox passes the read flag through when the database sends it, and leaves it out otherwise', async () => {
    const h = setup(TWELVE);
    try {
      const token = await helloGuest(h);
      h.state.inbox = [{ id: 2, kind: 'cheer', slot_id: 'STREET_1', created_at: 'b', read: false }, { id: 1, kind: 'taken', slot_id: 'STREET_2', created_at: 'a', read: true }, { id: 0, kind: 'taken', created_at: 'z' }];
      const items = (await (await h.call('/rt/inbox', { headers: { authorization: 'Bearer ' + token } })).json()).items;
      assert.deepEqual(items.map((r) => r.read), [false, true, undefined]);
      assert.equal('read' in items[2], false);
    } finally { h.done(); }
  });
});

// ---- SQL files, read as text -----------------------------------------------------------------------------------
describe('SQL files', () => {
  const schema = read('schema.sql'), mig = read(MIGRATION), clean = read(CLEANUP);
  it('the migration restates only the small functions, with exactly the schema.sql text, and patches the big ones in place', () => {
    for (const name of ['starter_slot_list', 'award_tribe_roof']) {
      const a = fnBlock(schema, name), b = fnBlock(mig, name);
      assert.ok(a && b, name);
      assert.equal(b, a, name);
    }
    // its twelve-slot list was superseded by the boards migration, which restates the twenty exactly as schema.sql has them
    assert.deepEqual(/ARRAY\[([^\]]+)\]/.exec(fnBlock(mig, 'starter_slots'))[1].match(/STREET_\d+/g), TWELVE);
    for (const name of ['starter_slots', 'starter_slot_list', 'slot_floor']) assert.equal(fnBlock(read(BOARDS), name), fnBlock(schema, name), name);
    for (const name of ['claim_billboard', 'withdraw_account', 'inbox_list']) assert.equal(mig.includes('CREATE OR REPLACE FUNCTION public.' + name), false, name);
    assert.match(fnBlock(schema, 'claim_billboard'), /NOT \(p_slot_id = ANY \(public\.starter_slots\(\)\)\)/);
    assert.equal(schema.includes("'STREET_8','STREET_9','STREET_10','STREET_11'"), false);
    assert.match(mig, /중단: 운영 DB의 claim_billboard에서 바꿀 줄을 %번 찾았습니다\(1번이어야 함\)\. 이 부분은 바뀌지 않았습니다\./);
    assert.match(mig, /destructive operation/);
  });
  it('the migration is four BEGIN … COMMIT parts with nothing destructive at top level, ending on the status table', () => {
    const top = topLevel(mig).replace('CREATE TEMP TABLE IF NOT EXISTS kts_mid (part INT PRIMARY KEY, why TEXT);', ''); // the only top-level CREATE: a session temp table for refusal reasons
    assert.equal((top.match(/^BEGIN;$/gm) || []).length, 4);
    assert.equal((top.match(/^COMMIT;$/gm) || []).length, 4);
    assert.doesNotMatch(top, /\b(DROP|DELETE|TRUNCATE|ALTER|UPDATE|INSERT|CREATE)\b/i);
    assert.ok(mig.lastIndexOf('COMMIT;') < mig.lastIndexOf('SELECT n ||'));
    assert.match(mig.trim().split('\n').at(-1), /^ORDER BY n;$/);
  });
  it('the cleanup preview: part 1 reads only, part 2 is all comment and takes explicit guest ids', () => {
    const cut = clean.indexOf('-- 2부. 지우기');
    assert.ok(cut > 0);
    const p1 = clean.slice(0, cut), p2 = clean.slice(cut);
    assert.doesNotMatch(topLevel(p1), /\b(DELETE|UPDATE|INSERT|DROP|TRUNCATE|ALTER|CREATE)\b/i);
    for (const l of p2.split('\n')) if (l.trim()) assert.match(l, /^--/, l);
    assert.match(p2, /^-- BEGIN;$/m);
    assert.match(p2, /^-- COMMIT;$/m);
    assert.doesNotMatch(p2, /nickname/); // part 2 never picks targets by name
    assert.match(p2, /NOT LIKE 'guest:%'/);
    assert.match(clean, /되돌릴 수 없다/);
    assert.match(clean, /골라|선택/);
  });
  it('the database list and the Worker fallback agree on the old four', () => {
    const list = /ARRAY\[([^\]]+)\]/.exec(fnBlock(schema, 'starter_slots'))[1].match(/STREET_\d+/g);
    assert.deepEqual(list, TWENTY);
    for (const id of STARTER_DEFAULT) assert.ok(list.includes(id), id);
    assert.deepEqual(starterList(list), list);
  });
});

// ---- SQL, executed in PGlite -----------------------------------------------------------------------------------
async function loadPGlite() {
  const dirs = [process.env.PGLITE_DIR, join(tmpdir(), 'kts-pglite')].filter(Boolean);
  for (const d of dirs) {
    try { const req = createRequire(join(d, 'package.json')); return (await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href)).PGlite; } catch { }
  }
  try { return (await import('@electric-sql/pglite')).PGlite; } catch { return null; }
}
const PGlite = await loadPGlite();
if (!PGlite) console.log('# db.test: PGlite not installed, SQL execution skipped. Install it in ' + join(tmpdir(), 'kts-pglite') + ' (npm i @electric-sql/pglite) or set PGLITE_DIR.');
// Supabase gives these; PGlite does not. Only stand-ins, never part of schema.sql.
const STANDINS = 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;';
const KEY = 'pglite-key';
async function fresh(schemaText) {
  const db = new PGlite();
  await db.exec(STANDINS);
  await db.exec(schemaText);
  await db.query('UPDATE public.app_secrets SET key_value = $1 WHERE key_name = $2', [KEY, 'FLUSH_KEY']);
  return db;
}
const claimSql = 'SELECT public.claim_billboard($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL, 72, $12) AS r';
const claimArgs = (actor, slot, bid, mode) => [KEY, actor, '새', slot, bid, '첫 칸', '', '', '✨', 'cyber_navy', '#ffffff', mode];
const claimIn = async (db, actor, slot, bid = 0, mode = 'starter') => (await db.query(claimSql, claimArgs(actor, slot, bid, mode))).rows[0].r;
const OLD = (() => { try { return execFileSync('git', ['show', 'df5a739:schema.sql'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n'); } catch { return null; } })();
const statusRows = async (db) => (await db.exec(read(MIGRATION))).at(-1).rows;
const status = async (db) => Object.fromEntries((await statusRows(db)).map((r) => [r.part.slice(0, 1), r.applied]));
const PATCHED = ['claim_billboard', 'withdraw_account', 'inbox_list', 'award_tribe_roof'];
const procs = async (db) => (await db.query(`SELECT proname, prosrc, prosecdef, proconfig::text AS cfg, proacl::text AS acl, pg_get_functiondef(oid) AS def FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace AND proname = ANY ($1) AND (proname <> 'claim_billboard' OR oid = '${CLAIM_SIG}'::regprocedure) ORDER BY proname`, [PATCHED])).rows;
// What production may have done by hand: a comment line somewhere else in each patched function.
async function hotfix(db) {
  await db.exec(`DO $x$ DECLARE d text; BEGIN
    d := pg_get_functiondef('${CLAIM_SIG}'::regprocedure); EXECUTE replace(d, 'v_mono_before := public.monopoly_name();', 'v_mono_before := public.monopoly_name(); -- PROD HOTFIX');
    d := pg_get_functiondef('public.withdraw_account(text,text)'::regprocedure); EXECUTE replace(d, 'DELETE FROM public.wallets', '-- PROD HOTFIX' || E'\\n  ' || 'DELETE FROM public.wallets');
    d := pg_get_functiondef('public.inbox_list(text,text)'::regprocedure); EXECUTE replace(d, 'LIMIT 20', 'LIMIT 20 -- PROD HOTFIX');
  END $x$;`);
}

describe('SQL in PGlite', { skip: PGlite ? false : 'PGlite not installed (see the first line of this file)', concurrency: false }, () => {
  let db;
  before(async () => { db = await fresh(read('schema.sql')); });

  it('starter_slot_list answers the 20 slots with the worker key and refuses any other key', async () => {
    const r = (await db.query('SELECT public.starter_slot_list($1) AS r', [KEY])).rows[0].r;
    assert.deepEqual(r, { ok: true, slots: TWENTY });
    await assert.rejects(db.query('SELECT public.starter_slot_list($1)', ['wrong']), /Unauthorized worker key/);
    assert.equal((await db.query("SELECT provolatile FROM pg_proc WHERE proname = 'starter_slots'")).rows[0].provolatile, 'i');
  });
  it('a starter claim works on a newly free slot, once per account, empty and bid 0 only', async () => {
    const a = await claimIn(db, 'guest:a', 'STREET_20');
    assert.equal(a.ok, true, JSON.stringify(a));
    assert.equal(a.billboard.holder_id, 'guest:a');
    assert.equal(a.billboard.current_bid, 0);
    assert.equal((await db.query("SELECT starter_slot FROM public.profiles WHERE actor_id = 'guest:a'")).rows[0].starter_slot, 'STREET_20');
    assert.equal((await db.query("SELECT count(*)::int n FROM public.coin_ledger WHERE actor_id = 'guest:a' AND reason = 'starter' AND delta = 0")).rows[0].n, 1);
    assert.deepEqual(await claimIn(db, 'guest:a', 'STREET_23'), { ok: false, error: 'starter' }); // second one for the same account
    assert.deepEqual(await claimIn(db, 'guest:b', 'STREET_1'), { ok: false, error: 'starter' }); // not in the list
    assert.deepEqual(await claimIn(db, 'guest:b', 'SUB_1B'), { ok: false, error: 'starter' });
    assert.deepEqual(await claimIn(db, 'guest:b', 'STREET_20'), { ok: false, error: 'starter' }); // lit by guest:a
    assert.deepEqual(await claimIn(db, 'guest:b', 'STREET_23', 5), { ok: false, error: 'starter' }); // bid must be 0
    assert.equal((await claimIn(db, 'guest:b', 'STREET_8')).ok, true); // the old four are still in
    await db.query("INSERT INTO public.wallets (actor_id, nickname, coins) VALUES ('guest:c', 'c', 1000)");
    const paid = await claimIn(db, 'guest:c', 'STREET_23', 352, 'claim'); // a paid claim on a starter slot is unchanged
    assert.equal(paid.ok, true, JSON.stringify(paid));
    assert.equal(paid.remaining_coins, 648);
  });
  it('withdraw_account removes that account\'s push_subs rows, leaves the others, and can run twice', async () => {
    const me = 'user:aaaaaaaa-1111', other = 'user:bbbbbbbb-2222';
    await db.query("INSERT INTO public.wallets (actor_id, nickname) VALUES ($1, 'a'), ($2, 'b')", [me, other]);
    await db.query("INSERT INTO public.push_subs (endpoint, actor_id, p256dh, auth_key) VALUES ('https://p/1', $1, 'k', 'a'), ('https://p/2', $1, 'k', 'a'), ('https://p/3', $2, 'k', 'a')", [me, other]);
    assert.deepEqual((await db.query('SELECT public.withdraw_account($1, $2) AS r', [KEY, me])).rows[0].r, { ok: true, actor_id: me });
    assert.deepEqual((await db.query('SELECT endpoint, actor_id FROM public.push_subs ORDER BY endpoint')).rows, [{ endpoint: 'https://p/3', actor_id: other }]);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.wallets WHERE actor_id = $1', [me])).rows[0].n, 0);
    assert.deepEqual((await db.query('SELECT public.withdraw_account($1, $2) AS r', [KEY, me])).rows[0].r, { ok: true, actor_id: me });
    assert.equal((await db.query('SELECT count(*)::int n FROM public.push_subs')).rows[0].n, 1);
  });
  it('inbox_list gives a read flag per row, unread first', async () => {
    await db.exec(`INSERT INTO public.inbox (actor_id, kind, slot_id, created_at, read_at) VALUES
      ('guest:in', 'cheer', 'STREET_1', now() - interval '3 minutes', now()), ('guest:in', 'taken', 'STREET_2', now() - interval '2 minutes', NULL),
      ('guest:in', 'cheer', 'STREET_3', now() - interval '1 minute', now())`);
    const items = (await db.query('SELECT public.inbox_list($1, $2) AS r', [KEY, 'guest:in'])).rows[0].r.items;
    assert.deepEqual(items.map((r) => [r.slot_id, r.read]), [['STREET_2', false], ['STREET_3', true], ['STREET_1', true]]);
  });
  it('award_tribe_roof: a finished week once, then done; the current week is open; ties and empty weeks as before', async () => {
    const award = async (week) => (await db.query('SELECT public.award_tribe_roof($1, $2) AS r', [KEY, week])).rows[0].r;
    const now = (await db.query(`SELECT to_char(timezone('Asia/Seoul', now()), 'IYYY"W"IW') AS w`)).rows[0].w;
    await db.exec(`INSERT INTO public.tribes (id, tag, name, created_by) VALUES ('bbbbbbbb', 'B', 'b', 'guest:x'), ('aaaaaaaa', 'A', 'a', 'guest:y'), ('cccccccc', 'C', 'c', 'guest:z');
      INSERT INTO public.tribe_scores (tribe_id, week, points) VALUES ('bbbbbbbb', '2020W10', 9), ('aaaaaaaa', '2020W10', 9), ('cccccccc', '2020W10', 3),
        ('cccccccc', '2020W09', 5), ('aaaaaaaa', '${now}', 50);
      UPDATE public.tribes SET roof_until = now() + interval '1 day' WHERE id = 'cccccccc';`);
    const roofs = async () => (await db.query("SELECT id FROM public.tribes WHERE roof_until > now() ORDER BY id")).rows.map((r) => r.id);
    assert.deepEqual(await award('2020W1'), { ok: false, error: 'week' });
    for (const w of ['2025W77', '2025W00', '2025W54']) assert.deepEqual(await award(w), { ok: false, error: 'week' }, w);
    assert.deepEqual(await roofs(), ['cccccccc']); // a bad week number clears nothing
    assert.deepEqual(await award(now), { ok: false, error: 'open' });
    assert.deepEqual(await award('2999W01'), { ok: false, error: 'open' });
    assert.equal((await db.query('SELECT count(*)::int n FROM public.tribe_roofs')).rows[0].n, 0);
    assert.deepEqual(await award('2020W10'), { ok: true, tribe_id: 'aaaaaaaa' }); // tie on points: the smaller id, as before
    assert.deepEqual(await roofs(), ['aaaaaaaa']); // the old roof is cleared
    const until = (await db.query("SELECT roof_until - now() > interval '6 days 23 hours' AS ok FROM public.tribes WHERE id = 'aaaaaaaa'")).rows[0].ok;
    assert.equal(until, true);
    assert.deepEqual(await award('2020W10'), { ok: true, done: true });
    assert.deepEqual(await award('2020W11'), { ok: true, roof: '' }); // nobody scored: recorded, roofs cleared as before
    assert.deepEqual(await roofs(), []);
    assert.deepEqual(await award('2020W11'), { ok: true, done: true });
    assert.deepEqual(await award('2020W09'), { ok: true, done: true }); // late older week: recorded, the newer result stands
    assert.deepEqual(await roofs(), []);
    assert.deepEqual((await db.query('SELECT week, tribe_id FROM public.tribe_roofs ORDER BY week')).rows,
      [{ week: '2020W09', tribe_id: 'cccccccc' }, { week: '2020W10', tribe_id: 'aaaaaaaa' }, { week: '2020W11', tribe_id: null }]);
    assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tribe_roofs'::regclass")).rows[0].relrowsecurity, true);
  });
  it('the migration on the full schema: twice, nothing changes, every part reports applied', async () => {
    const before = await procs(db);
    for (let i = 0; i < 2; i++) assert.deepEqual(await status(db), { 1: true, 2: true, 3: true, 4: true });
    assert.deepEqual(await procs(db), before);
    assert.equal((await claimIn(db, 'guest:d', 'STREET_28')).ok, true);
  });
  it('old schema + migration = new schema.sql: every public function, ACL, column and RLS flag', { skip: OLD ? false : 'git show df5a739:schema.sql not available' }, async () => {
    const shape = async (d) => ({
      fns: (await d.query("SELECT p.oid::regprocedure::text AS sig, pg_get_functiondef(p.oid) AS def, p.proacl::text AS acl FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1")).rows,
      cols: (await d.query("SELECT table_name, column_name, data_type, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, 2")).rows,
      rls: (await d.query("SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1")).rows,
    });
    const old = await fresh(OLD);
    // Before the migration: today's rules. STREET_20 is not free, STREET_8 is, the Worker's read fails, Sunday-only roof.
    assert.deepEqual(await claimIn(old, 'guest:o', 'STREET_20'), { ok: false, error: 'starter' });
    assert.equal((await claimIn(old, 'guest:o', 'STREET_8')).ok, true);
    await assert.rejects(old.query('SELECT public.starter_slot_list($1)', [KEY]));
    assert.deepEqual(await status(old), { 1: true, 2: true, 3: true, 4: true });
    // The later migration adds forget_login (test/forget-login.test.mjs runs it for real). PGlite has no auth.users, so its own check reports that
    // the function exists but cannot delete: not applied.
    const forget = (await old.exec(read('migrations/2026-11-22-forget-login.sql'))).at(-1).rows;
    assert.equal(forget.length, 1); assert.equal(forget[0].applied, false); assert.match(forget[0].note, /함수는 있지만 지우지 못합니다/);
    // And the twenty new street boards (test/boards.test.mjs runs it on its own, before and after).
    const boards = (await old.exec(read(BOARDS))).at(-1).rows;
    assert.equal(boards.length, 1); assert.equal(boards[0].applied, true, boards[0].note);
    const neu = await fresh(read('schema.sql'));
    const [a, b] = [await shape(old), await shape(neu)];
    assert.deepEqual(a.cols, b.cols);
    assert.deepEqual(a.rls, b.rls);
    assert.deepEqual(a.fns.map((f) => f.sig), b.fns.map((f) => f.sig));
    for (let i = 0; i < a.fns.length; i++) { assert.equal(a.fns[i].def, b.fns[i].def, a.fns[i].sig); assert.equal(a.fns[i].acl, b.fns[i].acl, a.fns[i].sig); }
    assert.equal((await claimIn(old, 'guest:o2', 'STREET_20')).ok, true);
    await old.close(); await neu.close();
  });
  it('a hand-fix elsewhere in a patched function survives; definer, search_path and ACL stay', { skip: OLD ? false : 'no old schema' }, async () => {
    const d = await fresh(OLD);
    try {
      await hotfix(d);
      const before = await procs(d);
      assert.deepEqual(await status(d), { 1: true, 2: true, 3: true, 4: true });
      assert.deepEqual(await status(d), { 1: true, 2: true, 3: true, 4: true });
      const after = await procs(d);
      for (const [i, p] of after.entries()) {
        assert.equal(p.prosecdef, true, p.proname);
        assert.equal(p.cfg, before[i].cfg, p.proname);
        assert.equal(p.acl, before[i].acl, p.proname);
        if (p.proname !== 'award_tribe_roof') assert.match(p.prosrc, /PROD HOTFIX/, p.proname);
      }
      const src = Object.fromEntries(after.map((p) => [p.proname, p.prosrc]));
      assert.match(src.claim_billboard, /NOT \(p_slot_id = ANY \(public\.starter_slots\(\)\)\)/);
      assert.equal((src.withdraw_account.match(/DELETE FROM public\.push_subs/g) || []).length, 1);
      assert.equal((src.inbox_list.match(/'read', \(s\.read_at IS NOT NULL\)/g) || []).length, 1);
      assert.match(src.award_tribe_roof, /tribe_roofs/);
    } finally { await d.close(); }
  });
  it('a part whose needle is not found exactly once is refused alone; the others still apply', { skip: OLD ? false : 'no old schema' }, async () => {
    const d = await fresh(OLD);
    try {
      await d.exec(`DO $x$ DECLARE d text; BEGIN
        d := pg_get_functiondef('${CLAIM_SIG}'::regprocedure); EXECUTE replace(d, $q$('STREET_8','STREET_9','STREET_10','STREET_11')$q$, $q$('STREET_8','STREET_9')$q$);
        d := pg_get_functiondef('public.award_tribe_roof(text,text)'::regprocedure); EXECUTE replace(d, '<> 0 THEN', '<> 6 THEN');
      END $x$;`);
      const before = await procs(d);
      const rows = await statusRows(d);
      assert.deepEqual(rows.map((r) => r.applied), [false, true, true, false]);
      assert.match(rows[0].note, /^안 바뀜: 중단: 운영 DB의 claim_billboard에서 바꿀 줄을 0번 찾았습니다/); // the reason, where the editor shows it
      assert.match(rows[3].note, /award_tribe_roof가 예상한 모양이 아닙니다/);
      assert.doesNotMatch(rows[1].note, /안 바뀜/);
      const after = await procs(d);
      assert.equal(after[0].prosrc, before[0].prosrc); // award_tribe_roof untouched
      assert.equal(after[1].prosrc, before[1].prosrc); // claim_billboard untouched
      assert.equal((await d.query("SELECT count(*)::int n FROM pg_proc WHERE proname IN ('starter_slots', 'starter_slot_list')")).rows[0].n, 0); // part 1 rolled back whole
      assert.equal((await d.query("SELECT to_regclass('public.tribe_roofs') IS NULL AS gone")).rows[0].gone, true);
      assert.deepEqual(await claimIn(d, 'guest:r', 'STREET_10'), { ok: false, error: 'starter' }); // the hand-made rule still rules
      // Put the expected lines back and run again in the same session: both parts apply and their old reasons are gone.
      await d.exec(`DO $x$ DECLARE d text; BEGIN
        d := pg_get_functiondef('${CLAIM_SIG}'::regprocedure); EXECUTE replace(d, $q$('STREET_8','STREET_9')$q$, $q$('STREET_8','STREET_9','STREET_10','STREET_11')$q$);
        d := pg_get_functiondef('public.award_tribe_roof(text,text)'::regprocedure); EXECUTE replace(d, '<> 6 THEN', '<> 0 THEN');
      END $x$;`);
      const again = await statusRows(d);
      assert.deepEqual(again.map((r) => r.applied), [true, true, true, true]);
      for (const r of again) assert.doesNotMatch(r.note, /안 바뀜|중단/, r.part);
      assert.equal((await d.query('SELECT count(*)::int n FROM kts_mid')).rows[0].n, 0);
    } finally { await d.close(); }
  });
  it('cleanup preview: part 1 is one table and changes nothing; part 2 takes explicit guest ids only', async () => {
    const d = await fresh(read('schema.sql'));
    try {
      await d.exec(`
        INSERT INTO public.wallets (actor_id, nickname, coins, spent) VALUES
          ('guest:bot1', '네온봇1', 500, 300), ('guest:bot2', '네온봇12', 90, 0), ('guest:chk', '점검3', 100, 0), ('user:chk', '점검4', 100, 0),
          ('user:named', '네온봇7', 100, 0), ('guest:real', '네온봇팬', 100, 0), ('guest:tester', '하늘', 100, 0);
        INSERT INTO public.profiles (actor_id) VALUES ('guest:bot1');
        INSERT INTO public.coin_ledger (actor_id, delta, reason) VALUES ('guest:bot1', 10, 'mine'), ('guest:real', 5, 'mine');
        INSERT INTO public.push_subs (endpoint, actor_id, p256dh, auth_key) VALUES ('https://p/bot', 'guest:bot1', 'k', 'a'), ('https://p/real', 'guest:real', 'k', 'a');
        INSERT INTO public.inbox (actor_id, kind, slot_id) VALUES ('guest:bot2', 'taken', 'STREET_2');
        INSERT INTO public.tribes (id, tag, name, created_by) VALUES ('t0t0t0t0', 'T', 't', 'guest:bot1');
        INSERT INTO public.tribe_members (tribe_id, actor_id, role) VALUES ('t0t0t0t0', 'guest:bot1', 'owner');
        UPDATE public.plots SET owner_id = 'guest:bot1', owner_name = '네온봇1', level = 2 WHERE plot_id = 4;
        UPDATE public.billboards SET holder_id = 'guest:bot2', holder_name = '네온봇12', line1 = '네온봇12', line2 = '샀다', line3 = '#네온봇', lit_until = now() + interval '1 day', expires_at = now() + interval '1 day' WHERE slot_id = 'STREET_2';
        UPDATE public.billboards SET holder_id = 'guest:tester', holder_name = '하늘', line1 = '테스트 중', line2 = 'ㅁㄴㅇㄹ', line3 = '', external_url = 'https://instagram.com/x', lit_until = now() + interval '1 day', expires_at = now() + interval '1 day' WHERE slot_id = 'STREET_3';
        UPDATE public.billboards SET holder_id = 'guest:real', holder_name = '네온봇팬', line1 = '좋은 하루', lit_until = now() + interval '1 day', expires_at = now() + interval '1 day' WHERE slot_id = 'STREET_4';
        INSERT INTO public.billboard_photos (photo_id, slot_id, actor_id, jpeg, status) VALUES (repeat('a', 40), 'STREET_3', 'guest:tester', '\\x00'::bytea, 'approved');
        UPDATE public.billboards SET photo_id = repeat('a', 40), photo_status = 'approved' WHERE slot_id = 'STREET_3';`);
      const counts = async () => (await d.query(`SELECT (SELECT count(*) FROM public.wallets)::int w, (SELECT count(*) FROM public.billboard_history)::int h,
        (SELECT count(*) FROM public.billboards WHERE holder_id IS NOT NULL)::int b, (SELECT count(*) FROM public.push_subs)::int p`)).rows[0];
      const text = read(CLEANUP);
      const block = (from, to) => { const a = text.indexOf(from); return text.slice(a, text.indexOf(to, a)); };
      const p1 = block('-- 1부. 읽기 전용', '-- 1부-선택. '), p1b = block('-- 1부-선택. ', '-- 2부. 지우기');
      const before = await counts();
      const one = await d.exec(p1);
      assert.equal(one.filter((r) => r.fields.length).length, 1); // one table: the editor shows only the last result
      assert.deepEqual(one.at(-1).rows.map((r) => [r.kind, r.id, r.guest, r.tribe_owner, r.holder]), [
        ['봇 지갑', 'guest:bot1', true, true, null], ['봇 지갑', 'guest:bot2', true, false, null], ['봇 지갑', 'user:named', false, false, null],
        ['점검 지갑', 'guest:chk', true, false, null],
        ['테스트 같은 칸', 'STREET_2', null, null, 'guest:bot2'], ['테스트 같은 칸', 'STREET_3', null, null, 'guest:tester']]);
      const n = Object.fromEntries((await d.exec(p1b)).at(-1).rows.map((r) => [r.what, Number(r.n)]));
      assert.equal(n.wallets, 3); assert.equal(n.push_subs, 1); assert.equal(n.coin_ledger, 1); assert.equal(n['plots owned'], 1);
      assert.deepEqual(await counts(), before);

      const part2 = (bots, slots) => text.slice(text.indexOf('\n-- BEGIN;') + 1).split('\n').map((l) => (l.startsWith('-- ') ? l.slice(3) : l === '--' ? '' : l)).join('\n')
        .replace('ARRAY[]::TEXT[]', `ARRAY[${bots.map((x) => `'${x}'`).join(',')}]::TEXT[]`).replace('ARRAY[]::TEXT[]', `ARRAY[${slots.map((x) => `'${x}'`).join(',')}]::TEXT[]`);
      await assert.rejects(d.exec(part2(['guest:bot1', 'user:named'], [])), /guest:로 시작하지 않는 id/);
      await d.exec('ROLLBACK').catch(() => {});
      assert.deepEqual(await counts(), before);
      const res = await d.exec(part2(['guest:bot1', 'guest:bot2', 'guest:chk'], ['STREET_3']));
      assert.deepEqual(res.filter((r) => r.fields.length).at(-1).rows, [{ slots_released: 2, wallets_deleted: 3 }]);
      assert.deepEqual((await d.query('SELECT actor_id FROM public.wallets ORDER BY 1')).rows.map((r) => r.actor_id), ['guest:real', 'guest:tester', 'user:chk', 'user:named']);
      assert.equal((await d.query("SELECT count(*)::int n FROM public.profiles WHERE actor_id = 'guest:bot1'")).rows[0].n, 0);
      assert.deepEqual((await d.query('SELECT endpoint FROM public.push_subs')).rows, [{ endpoint: 'https://p/real' }]);
      assert.deepEqual((await d.query('SELECT owner_id, level, sign_text FROM public.plots WHERE plot_id = 4')).rows, [{ owner_id: null, level: 0, sign_text: '분양 대기중' }]);
      assert.deepEqual((await d.query("SELECT id, created_by FROM public.tribes")).rows, [{ id: 't0t0t0t0', created_by: 'guest:bot1' }]); // left ownerless
      assert.equal((await d.query('SELECT count(*)::int n FROM public.tribe_members')).rows[0].n, 0);
      const s3 = (await d.query("SELECT holder_id, holder_name, line1, line2, external_url, photo_id, (COALESCE(lit_until, expires_at) <= now()) AS dark FROM public.billboards WHERE slot_id = 'STREET_3'")).rows[0];
      assert.deepEqual(s3, { holder_id: null, holder_name: 'K-TIMES SQUARE', line1: '운영자가 내렸습니다', line2: '', external_url: null, photo_id: null, dark: true });
      assert.equal((await d.query("SELECT status FROM public.billboard_photos WHERE photo_id = repeat('a', 40)")).rows[0].status, 'removed');
      assert.deepEqual((await d.query('SELECT slot_id, holder_id, event FROM public.billboard_history')).rows, [{ slot_id: 'STREET_3', holder_id: 'guest:tester', event: 'takedown' }]);
      assert.equal((await d.query("SELECT holder_id FROM public.billboards WHERE slot_id = 'STREET_2'")).rows[0].holder_id, null);
      assert.equal((await d.query("SELECT holder_id FROM public.billboards WHERE slot_id = 'STREET_4'")).rows[0].holder_id, 'guest:real');
      assert.equal((await d.query('SELECT count(*)::int n FROM public.inbox')).rows[0].n, 0);
    } finally { await d.close(); }
  });
});
