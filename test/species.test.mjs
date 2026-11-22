// Ten avatar species (presence field av 1..10). The table lives in ts3d/avatars.js (SPECIES) and ts3d/loadplan.js (MODEL_URL); the Worker
// clamps with speciesOf and the database with profiles.species CHECK and save_species. The database is changed by hand
// (migrations/2026-11-22-species.sql), so the Worker is checked in both states: before it (save_species stores 1 for 4..10 and the account
// registry holds the choice) and after it (the database keeps 4..10 and the registry lets go). As in forget-login.test.mjs the routes run
// against a JS model of the functions and, when PGlite is installed outside the repo, the migration runs against the real schema.sql.
import { registerHooks, createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const VENDOR = new URL('../vendor/three/', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: new URL('./cf-stub.mjs', import.meta.url).href, shortCircuit: true };
    if (specifier === 'three') return { url: VENDOR + 'build/three.module.js', shortCircuit: true };
    if (specifier.startsWith('three/addons/')) return { url: VENDOR + 'examples/jsm/' + specifier.slice(13), shortCircuit: true };
    return next(specifier, context);
  },
});
globalThis.WebSocketRequestResponsePair = class { constructor(req, res) { this.req = req; this.res = res; } };

const { SPECIES, SPECIES_MAX, speciesId } = await import('../ts3d/avatars.js');
const { MODEL_URL } = await import('../ts3d/loadplan.js');
const { setSpecies, profileSpecies } = await import('../profile.js');
const W = await import('../worker.js');
const worker = W.default, { Meter, Room } = W;
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MIGRATION = 'migrations/2026-11-22-species.sql';

const TABLE = [
  [1, '쥐', '🐭', 'MouseToy', 'mouse'], [2, '고양이', '🐱', 'CatToy', 'cat'], [3, '곰', '🐻', 'BearToy', 'bear'],
  [4, '토끼', '🐰', 'RabbitToy', 'rabbit'], [5, '강아지', '🐶', 'PuppyToy', 'puppy'], [6, '판다', '🐼', 'PandaToy', 'panda'],
  [7, '여우', '🦊', 'FoxToy', 'fox'], [8, '펭귄', '🐧', 'PenguinToy', 'penguin'], [9, '햄스터', '🐹', 'HamsterToy', 'hamster'],
  [10, '호랑이', '🐯', 'TigerToy', 'tiger'],
];
const GARBAGE = [0, 11, -1, 2.5, NaN, Infinity, null, undefined, '', ' ', 'x', '7a', '0x3', [], {}, true];

describe('the species table', () => {
  it('has ten species with the fixed ids, names, glyphs, models and thumbnails', () => {
    assert.equal(SPECIES_MAX, 10);
    assert.deepEqual(SPECIES.map((s) => [s.id, s.label, s.glyph, s.thumb]), TABLE.map(([id, l, g, , t]) => [id, l, g, `/assets/avatars/${t}.png`]));
    assert.deepEqual(MODEL_URL, Object.fromEntries(TABLE.map(([id, , , m]) => [id, `/assets/models/${m}.glb`])));
    assert.equal(new Set(Object.values(MODEL_URL)).size, 10);
    assert.equal(new Set(SPECIES.map((s) => s.thumb)).size, 10);
    assert.equal(new Set(SPECIES.map((s) => s.glyph)).size, 10);
  });

  it('speciesId and profile.js setSpecies take any input to 1..10, everything else to 1', () => {
    for (const f of [speciesId, setSpecies]) {
      for (let i = 1; i <= 10; i++) { assert.equal(f(i), i); assert.equal(f(String(i)), i); }
      for (const g of GARBAGE) assert.equal(f(g), 1, `${f.name}(${JSON.stringify(g)})`);
    }
  });

  it('the Worker (speciesOf, through the account registry) keeps 1..10 and turns anything else into 1', () => {
    const m = new Meter(makeCtx(sqliteStorage()), {});
    for (let i = 1; i <= 10; i++) assert.equal(m.profilePut('u' + i, i, []).av, i);
    for (const g of GARBAGE) assert.equal(m.profilePut('g', g, []).av, 1, JSON.stringify(g));
    const src = read('worker.js');
    assert.match(src, /const SPECIES_MAX = 10;/);
    assert.doesNotMatch(src, /hit\.av === 1 \|\| hit\.av === 2 \|\| hit\.av === 3/);
    assert.doesNotMatch(src, /n === 2 \|\| n === 3/);
  });

  it('the picker shows ten tiles with a lazy thumbnail that falls back to the glyph, five a row', () => {
    const ui = read('ui.js'), html = read('index.html');
    const pick = ui.slice(ui.indexOf('function speciesPicker('), ui.indexOf('function colorPicker('));
    assert.match(pick, /for \(const s of SPECIES\)/);
    assert.match(pick, /h\('img', \{ src: s\.thumb, alt: '', width: 36, height: 36, loading: 'lazy'/);
    assert.match(pick, /addEventListener\('error', \(\) => pic\.replaceWith\(glyph\(s\)\)/);
    assert.match(pick, /'aria-pressed': String\(s\.id === current\)/);
    assert.match(pick, /setAttribute\('aria-pressed', String\(other === b\)\)/);
    assert.match(pick, /h\('span', \{ class: 'lbl', text: s\.label \}\)/);
    assert.match(html, /\.species-grid \{ display: grid; grid-template-columns: repeat\(5, minmax\(0, 1fr\)\); gap: 6px;/);
    assert.match(html, /\.species-grid button \{[^}]*min-height: 64px;/);
    // 320 px phone: modal 10-12 px each side, sheet content 18 px each side, so about 260 px for five tiles and four gaps.
    const tile = (320 - 2 * 12 - 2 * 18 - 4 * 6) / 5;
    assert.ok(tile >= 44, `tile ${tile} px`);
    // The HUD avatar glyph reads the same table.
    assert.match(ui, /avatarEl\.textContent = \(SPECIES\.find\(\(s\) => s\.id === hooks\.species\(\)\) \|\| SPECIES\[0\]\)\.glyph;/);
  });

  it('the service worker precaches nothing: models and thumbnails are cached as they are fetched, by URL', () => {
    const sw = read('sw.js');
    assert.doesNotMatch(sw, /addAll|\.glb|avatars\//);
    assert.match(sw, /url\.pathname\.startsWith\('\/assets\/'\)/);
    assert.match(sw, /if \(res\.ok\) await cache\.put/); // a 404 for a model not deployed yet is not cached
  });
});

describe('the profile answer and this device', () => {
  it('keeps a local 4..10 only against a 1 the Worker could not check', () => {
    assert.equal(profileSpecies({ species: 1, species_sure: false }, 7), 7);
    assert.equal(profileSpecies({ species: 1, species_sure: false }, '9'), 9);
    assert.equal(profileSpecies({ species: 1 }, 7), 1); // checked: the account really is the mouse (picked on another device)
    assert.equal(profileSpecies({ species: 1, species_sure: true }, 7), 1);
    assert.equal(profileSpecies({ species: 1, species_sure: false }, 2), 1); // 2 and 3 were always stored: the database is right
    assert.equal(profileSpecies({ species: 4, species_sure: false }, 7), 4);
    assert.equal(profileSpecies({ species: 8 }, 1), 8);
    assert.equal(profileSpecies(null, 7), 1);
    const main = read('main.js');
    assert.match(main, /state\.species = profileSpecies\(p, state\.species\);/);
  });
});

// ---- the Worker against a JS model of the database ------------------------------------------------------------------------------------------
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
// Every Durable Object call except the 'day' counter, as 'instance.method'.
function spyDo(env) {
  const log = [];
  for (const ns of [env.METER, env.ROOM]) { const real = ns.get; ns.get = (name) => { const s = real(name); return new Proxy(s, { get: (t, k) => typeof t[k] === 'function' ? (...a) => { if (name !== 'day') log.push(name + '.' + String(k)); return t[k](...a); } : t[k] }); }; }
  return log;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

// state.migrated: has migrations/2026-11-22-species.sql run (save_species keeps 1..10) or not (2 and 3 kept, anything else stored as 1).
function memDb(state) {
  const species = new Map();
  const fns = {
    profile_read(a) { return { ok: true, level: 1, reputation: 0, species: species.get(a.p_actor_id) ?? 1, equip: [], owned: [], color: null, starter: false, streak: 0, attend_last: null }; },
    save_species(a) {
      const n = Number(a.p_species), v = state.migrated ? (Number.isInteger(n) && n >= 1 && n <= 10 ? n : 1) : (n === 2 || n === 3 ? n : 1);
      species.set(a.p_actor_id, v); return { ok: true, species: v };
    },
  };
  return { species, async rpc(name, a) { if (a.p_key !== KEY) throw new Error('Unauthorized worker key'); return fns[name] ? fns[name](a) : { ok: true }; } };
}
function fakeNet(state, db) {
  return async (url, opt = {}) => {
    const u = String(url);
    if (u.includes('/.well-known/jwks.json')) return json({ keys: [] });
    const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u);
    if (m) { const a = JSON.parse(opt.body || '{}'); state.rpcs.push(m[1] + (a.p_species != null ? ' ' + a.p_species : ''));
      if (state.down?.(m[1])) return json({ message: 'down' }, 500);
      try { return json(await db.rpc(m[1], a)); } catch (e) { return json({ message: String(e?.message || e) }, 400); } }
    if (u.includes('/rest/v1/')) return json([]);
    return new Response('missing', { status: 404 });
  };
}
let clockBase = Date.parse('2031-05-01T03:00:00Z');
const utcDay = () => new Date().toISOString().slice(0, 10);
// Each scene runs days apart, so the isolate's copies (budget level, when save_species last clamped) of an earlier one are stale.
async function scene(migrated) {
  clockBase += 10 * 864e5; let t = clockBase; const origNow = Date.now, origFetch = globalThis.fetch;
  const state = { rpcs: [], migrated }, db = memDb(state);
  Date.now = () => t; globalThis.fetch = fakeNet(state, db); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  const env = makeEnv(), waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (p, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + p, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const post = (p, body, token) => call(p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1', authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  const get = (p, token) => call(p, { headers: { authorization: 'Bearer ' + token } });
  const guest = async () => { const tok = (await (await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1' }, body: '{}' })).json()).token;
    return { token: tok, id: 'guest:' + JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).s }; };
  const profile = async (g) => (await get('/rt/profile', g.token)).json();
  const pick = async (g, species) => { const r = await post('/rt/profile', { species }, g.token); return { status: r.status, body: await r.json() }; };
  const held = (id) => { const d = env.meter('acct').sql.db; return d.prepare("select count(*) n from sqlite_master where name = 'held'").get().n ? (d.prepare('select av from held where uid = ?').get(id)?.av ?? null) : null; };
  // A socket opening in a room reads the profile this way (Room.loadProf: the registry's five-minute copy, else the database and then the registry).
  const roomAv = async (id, topic = 'chapel:square') => (await env.room(topic).do.loadProf(id))?.av;
  const forget = (id) => { env.meter('acct').do._prof?.delete(id); }; // the five-minute copy runs out
  const hard = async () => { env.meter('day').sql.db.prepare('insert into d values(?, ?) on conflict(day) do update set n = excluded.n').run(utcDay(), 96000); t += 61000; await call('/rt/wishes'); };
  return { state, db, env, call, clock: { add: (ms) => { t += ms; } }, guest, profile, pick, held, roomAv, forget, hard, done: () => { Date.now = origNow; globalThis.fetch = origFetch; } };
}

describe('before the migration: save_species stores 1 for 4..10', { concurrency: false }, () => {
  it('a fox stays a fox: in the profile answer, in a room, and after the five-minute copy runs out', async () => {
    const s = await scene(false);
    try {
      const g = await s.guest();
      const r = await s.pick(g, 7);
      assert.deepEqual(r, { status: 200, body: { ok: true, species: 7 } });
      assert.equal(s.db.species.get(g.id), 1, 'the database clamped it');
      assert.equal(s.held(g.id), 7, 'the account registry holds the choice');
      const p = await s.profile(g);
      assert.equal(p.species, 7); assert.equal('species_sure' in p, false);
      assert.equal(profileSpecies(p, 7), 7);
      assert.equal(await s.roomAv(g.id), 7, 'other players see the fox');
      s.forget(g.id); s.clock.add(301000);
      assert.equal(await s.roomAv(g.id), 7, 'read from the database, then through the registry');
      assert.equal((await s.profile(g)).species, 7, 'a new device of the same account');
      // Another pick the database can keep drops the held one; mouse and cat are answered as they are.
      assert.deepEqual((await s.pick(g, 2)).body, { ok: true, species: 2 });
      assert.equal(s.held(g.id), null); assert.equal((await s.profile(g)).species, 2); assert.equal(await s.roomAv(g.id), 2);
      await s.pick(g, 10); assert.equal((await s.profile(g)).species, 10);
      await s.pick(g, 1); assert.equal(s.held(g.id), null); assert.equal((await s.profile(g)).species, 1, 'the mouse picked on purpose is the mouse');
      assert.equal(await s.roomAv(g.id), 1);
      // Garbage is the mouse, never an error.
      assert.deepEqual((await s.pick(g, 'tiger')).body, { ok: true, species: 1 });
      assert.deepEqual((await s.pick(g, 11)).body, { ok: true, species: 1 });
    } finally { s.done(); }
  });

  it('the profile read asks the registry only for a database answer of 1, and retries the database for a held choice at most every 10 minutes', async () => {
    const s = await scene(false);
    try {
      const a = await s.guest(), b = await s.guest();
      await s.pick(a, 3); await s.pick(b, 8);
      const log = spyDo(s.env);
      assert.equal((await s.profile(a)).species, 3);
      assert.deepEqual(log, [], 'a bear in the database: no Durable Object call');
      s.state.rpcs.length = 0;
      assert.equal((await s.profile(b)).species, 8);
      assert.deepEqual(log, ['acct.profilePut']);
      // The pick just saw the clamp, so no retry yet; ten minutes on, one try, which still clamps (nothing changes).
      assert.deepEqual(s.state.rpcs, ['profile_read']);
      s.clock.add(600001); s.state.rpcs.length = 0;
      assert.equal((await s.profile(b)).species, 8);
      assert.deepEqual(s.state.rpcs, ['profile_read', 'save_species 8']);
      assert.equal(s.held(b.id), 8);
      s.state.rpcs.length = 0; await s.profile(b);
      assert.deepEqual(s.state.rpcs, ['profile_read'], 'and not again for 10 minutes');
    } finally { s.done(); }
  });

  it('budget level hard: no extra Durable Object call, and the answer says it could not check so this device keeps its choice', async () => {
    const s = await scene(false);
    try {
      const g = await s.guest();
      await s.pick(g, 5);
      await s.hard();
      const log = spyDo(s.env);
      const p = await s.profile(g);
      assert.deepEqual(log, []);
      assert.equal(p.species, 1); assert.equal(p.species_sure, false);
      assert.equal(profileSpecies(p, 5), 5);
      assert.equal(profileSpecies(p, 1), 1);
    } finally { s.done(); }
  });

  it('the device sends its species (?sp=): on 1..3 a database answer of 1 asks no registry; no hint, a bad one or 4..10 asks as before', async () => {
    const s = await scene(false);
    try {
      const g = await s.guest(); await s.pick(g, 1);
      const log = spyDo(s.env), read = async (q) => (await s.call('/rt/profile' + q, { headers: { authorization: 'Bearer ' + g.token } })).json();
      for (const q of ['?sp=1', '?sp=2', '?sp=3']) { const p = await read(q); assert.equal(p.species, 1, q); assert.equal('species_sure' in p, false, q); }
      assert.deepEqual(log, [], 'a device on the mouse, cat or bear costs no Durable Object call');
      for (const q of ['', '?sp=7', '?sp=10', '?sp=abc', '?sp=0']) { log.length = 0; assert.equal((await read(q)).species, 1, q); assert.deepEqual(log, ['acct.profilePut'], q); }
      // A fox picked on another device while this one is on the cat: the database's 1 stands here (that device keeps its fox).
      await s.pick(g, 7); log.length = 0; assert.equal((await read('?sp=2')).species, 1); assert.deepEqual(log, []);
      assert.equal((await read('?sp=7')).species, 7);
      const { readFileSync: rf } = await import('node:fs'), main = rf(new URL('../main.js', import.meta.url), 'utf8'), prof = rf(new URL('../profile.js', import.meta.url), 'utf8');
      assert.match(main, /const p = await loadProfile\(state\.species\);/); assert.match(prof, /fetch\('\/rt\/profile' \+ sp,/);
    } finally { s.done(); }
  });

  it('the heal never overwrites a newer choice: a pick that lands before its save keeps its species', async () => {
    const s = await scene(false);
    try {
      const g = await s.guest(); await s.pick(g, 6); assert.equal(s.held(g.id), 6);
      s.state.migrated = true; s.clock.add(600001);
      // Between the profile read and the heal's save, the player picks the cat on another isolate (save_species 2, the registry drops the 6).
      const M = s.env.meter('acct').do, real = s.env.METER.get;
      s.env.METER.get = (n) => (n === 'acct' ? new Proxy(real(n), { get: (t, k) => (k === 'heldIs' ? async (...a) => { s.db.species.set(g.id, 2); M.profilePut(g.id, 2, [], 2); return t[k](...a); } : t[k]) }) : real(n));
      s.state.rpcs.length = 0; assert.equal((await s.profile(g)).species, 6); // this answer was read before the pick
      s.env.METER.get = real;
      assert.deepEqual(s.state.rpcs, ['profile_read'], 'no save_species 6 after the newer pick');
      assert.equal(s.db.species.get(g.id), 2); assert.equal(s.held(g.id), null); assert.equal((await s.profile(g)).species, 2);
      // heldDrop takes only the value it was given.
      M.profilePut(g.id, 1, [], 9); assert.equal(s.held(g.id), 9); M.heldDrop(g.id, 6); assert.equal(s.held(g.id), 9); M.heldDrop(g.id, 9); assert.equal(s.held(g.id), null);
      assert.equal(M.heldIs(g.id, 9), false);
    } finally { s.done(); }
  });

  it('a registry that cannot be reached: the profile answer is not sure, the pick still shows in the room push', async () => {
    const s = await scene(false);
    try {
      const g = await s.guest();
      const real = s.env.METER.get;
      s.env.METER.get = (name) => (name === 'acct' ? { profilePut: async () => { throw new Error('gone'); }, roomOf: async () => '' } : real(name));
      assert.deepEqual((await s.pick(g, 9)).body, { ok: true, species: 9 });
      const p = await s.profile(g);
      assert.equal(p.species, 1); assert.equal(p.species_sure, false); assert.equal(profileSpecies(p, 9), 9);
    } finally { s.done(); }
  });
});

describe('after the migration: the database keeps 1..10', { concurrency: false }, () => {
  it('a pick goes into the database, the registry holds nothing, and the profile read makes no Durable Object call', async () => {
    const s = await scene(true);
    try {
      const g = await s.guest();
      assert.deepEqual((await s.pick(g, 7)).body, { ok: true, species: 7 });
      assert.equal(s.db.species.get(g.id), 7); assert.equal(s.held(g.id), null);
      const log = spyDo(s.env);
      const p = await s.profile(g);
      assert.equal(p.species, 7); assert.equal('species_sure' in p, false); assert.deepEqual(log, []);
      s.forget(g.id); assert.equal(await s.roomAv(g.id), 7);
      await s.pick(g, 1); assert.equal((await s.profile(g)).species, 1);
    } finally { s.done(); }
  });

  it('a choice held from before the migration goes into the database on the next profile read and the registry lets it go', async () => {
    const s = await scene(false);
    try {
      const g = await s.guest();
      await s.pick(g, 6); assert.equal(s.db.species.get(g.id), 1); assert.equal(s.held(g.id), 6);
      s.state.migrated = true; // the owner runs the migration
      s.clock.add(600001);
      assert.equal((await s.profile(g)).species, 6);
      assert.equal(s.db.species.get(g.id), 6); assert.equal(s.held(g.id), null);
      const log = spyDo(s.env);
      assert.equal((await s.profile(g)).species, 6); assert.deepEqual(log, []);
    } finally { s.done(); }
  });
});

// ---- the migration file ---------------------------------------------------------------------------------------------------------------------
describe('migrations/2026-11-22-species.sql', () => {
  const mig = read(MIGRATION), schema = read('schema.sql');
  it('is re-run safe, touches only the species CHECK and save_species, and ends with one verification SELECT', () => {
    assert.match(mig, /^-- 2026-11-22 캐릭터 열 종/);
    assert.match(mig, /BEGIN;[\s\S]*COMMIT;/);
    assert.match(mig, /pg_get_constraintdef\(oid\) ILIKE '%species%'/);
    assert.match(mig, /EXECUTE format\('ALTER TABLE public\.profiles DROP CONSTRAINT %I', c\.conname\)/);
    assert.match(mig, /ADD CONSTRAINT profiles_species_check CHECK \(species BETWEEN 1 AND 10\)/);
    assert.match(mig, /CREATE OR REPLACE FUNCTION public\.save_species\(p_key TEXT, p_actor_id TEXT, p_species INT\)/);
    assert.match(mig, /v_species := CASE WHEN p_species BETWEEN 1 AND 10 THEN p_species ELSE 1 END;/);
    assert.match(mig, /SECURITY DEFINER\nSET search_path = public/);
    assert.match(mig, /RAISE EXCEPTION 'Unauthorized worker key'/);
    assert.doesNotMatch(mig, /DROP TABLE|DROP FUNCTION|DELETE FROM|TRUNCATE|UPDATE public\./i);
    const body = mig.replace(/^--.*$/gm, '').trim();
    assert.match(body, /SELECT '캐릭터 열 종' AS part,[\s\S]*AS applied,[\s\S]*AS note[\s\S]*;$/);
    assert.equal(body.slice(body.lastIndexOf('COMMIT;')).match(/\bSELECT '/g).length, 1);
  });
  it('is mirrored in schema.sql', () => {
    assert.equal((schema.match(/CHECK \(species BETWEEN 1 AND 3\)/g) || []).length, 0);
    assert.equal((schema.match(/species SMALLINT NOT NULL DEFAULT 1 CHECK \(species BETWEEN 1 AND 10\)/g) || []).length, 2);
    assert.match(schema, /ADD CONSTRAINT profiles_species_check CHECK \(species BETWEEN 1 AND 10\)/);
    assert.match(schema, /v_species := CASE WHEN p_species BETWEEN 1 AND 10 THEN p_species ELSE 1 END;/);
    assert.doesNotMatch(schema, /p_species IN \(2, 3\)/);
  });
});

async function loadPGlite() {
  for (const d of [process.env.PGLITE_DIR, join(tmpdir(), 'kts-pglite')].filter(Boolean)) {
    try { const req = createRequire(join(d, 'package.json')); return (await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href)).PGlite; } catch { }
  }
  try { return (await import('@electric-sql/pglite')).PGlite; } catch { return null; }
}
const PGlite = await loadPGlite();
if (!PGlite) console.log('# species.test: PGlite not installed, the schema.sql half is skipped.');

describe('the migration against schema.sql in PGlite', { skip: PGlite ? false : 'PGlite not installed (see test/db.test.mjs for how)', concurrency: false }, () => {
  // Production today: schema.sql as it was before this change (a 1..3 CHECK, save_species keeping only 2 and 3).
  const before = () => read('schema.sql')
    .replaceAll('CHECK (species BETWEEN 1 AND 10)', 'CHECK (species BETWEEN 1 AND 3)')
    .replace('CASE WHEN p_species BETWEEN 1 AND 10 THEN p_species ELSE 1 END', 'CASE WHEN p_species IN (2, 3) THEN p_species ELSE 1 END');
  const mig = read(MIGRATION), check = mig.slice(mig.lastIndexOf('COMMIT;') + 7);
  async function pg(schemaText) {
    const db = new PGlite();
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    await db.exec(schemaText);
    await db.query('UPDATE public.app_secrets SET key_value = $1 WHERE key_name = $2', [KEY, 'FLUSH_KEY']);
    return db;
  }
  const save = async (db, id, n) => (await db.query('SELECT public.save_species($1, $2, $3) AS r', [KEY, id, n])).rows[0].r;
  const stored = async (db, id) => (await db.query('SELECT species FROM public.profiles WHERE actor_id = $1', [id])).rows[0]?.species;

  it('before: 7 is stored as 1 and the verification row says not applied', async () => {
    const db = await pg(before());
    assert.deepEqual(await save(db, 'guest:a', 7), { ok: true, species: 1 });
    assert.equal(await stored(db, 'guest:a'), 1);
    await assert.rejects(db.query("UPDATE public.profiles SET species = 7 WHERE actor_id = 'guest:a'"), /check constraint/);
    const rows = (await db.exec(check)).at(-1).rows;
    assert.equal(rows.length, 1); assert.equal(rows[0].applied, false); assert.match(rows[0].note, /^안 바뀜: CHECK가 아직/);
  });

  it('after (run twice): 7 persists, 10 persists, 11 and 0 are the mouse, rows from before are untouched', async () => {
    const db = await pg(before());
    await save(db, 'guest:old', 3);
    for (let i = 0; i < 2; i++) {
      const rows = (await db.exec(mig)).at(-1).rows;
      assert.equal(rows.length, 1); assert.equal(rows[0].applied, true, rows[0].note); assert.match(rows[0].note, /^적용됨/);
    }
    assert.equal((await db.query("SELECT count(*)::int n FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%species%'")).rows[0].n, 1);
    assert.equal(await stored(db, 'guest:old'), 3);
    assert.deepEqual(await save(db, 'guest:b', 7), { ok: true, species: 7 });
    assert.equal(await stored(db, 'guest:b'), 7);
    assert.equal((await db.query("SELECT public.profile_read($1, 'guest:b') AS r", [KEY])).rows[0].r.species, 7);
    assert.deepEqual(await save(db, 'guest:b', 10), { ok: true, species: 10 });
    assert.deepEqual(await save(db, 'guest:b', 11), { ok: true, species: 1 });
    assert.deepEqual(await save(db, 'guest:b', 0), { ok: true, species: 1 });
    await assert.rejects(db.query("UPDATE public.profiles SET species = 11 WHERE actor_id = 'guest:b'"), /check constraint/);
    await assert.rejects(save(db, 'guest:b', 7).then(() => db.query('SELECT public.save_species($1, $2, $3)', ['wrong', 'guest:b', 7])), /Unauthorized worker key/);
    const fn = (await db.query("SELECT prosecdef, proconfig::text cfg FROM pg_proc WHERE oid = to_regprocedure('public.save_species(text,text,integer)')")).rows[0];
    assert.equal(fn.prosecdef, true); assert.match(fn.cfg, /search_path=public/);
  });

  it('schema.sql alone (a fresh database, and a re-run over one) already has the ten species', async () => {
    const db = await pg(read('schema.sql'));
    await db.exec(read('schema.sql'));
    assert.deepEqual(await save(db, 'guest:c', 9), { ok: true, species: 9 });
    const rows = (await db.exec(check)).at(-1).rows;
    assert.equal(rows[0].applied, true, rows[0].note);
  });
});
