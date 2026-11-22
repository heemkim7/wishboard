// 꾸미기 상점: cosmetics bought with game coins only (balance.js SHOP, migrations/2026-11-22-shop.sql, Worker GET /rt/shop and
// POST /rt/shop/buy, POST /rt/equip { kind, off }). The database is changed by hand, so the Worker is checked in both states: before the
// migration (shop_list, buy_cosmetic and unequip_cosmetic are missing: PostgREST answers 404 PGRST202) and after it. The routes run against
// a JS model of the functions and, when PGlite is installed outside the repo (see test/db.test.mjs), against the real schema before this
// change (git show 4ce0ab3:schema.sql) and then the migration, with real buys.
import { registerHooks, createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, before, after } from 'node:test';
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
const { SHOP, SHOP_KINDS, shopItem, cosmeticKind, equippedOf, shopTiles, EQUIP_MAX, OWNED_MAX } = await import('../balance.js');
const ART = await import('../ts3d/art.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MIG = 'migrations/2026-11-22-shop.sql';

// ---- the table -------------------------------------------------------------------------------------------------------------------------------
describe('the shop table (balance.js SHOP)', () => {
  it('has thirteen items over five kinds, coin prices 200..1,500, the three attendance items at the legal note prices', () => {
    assert.equal(SHOP.length, 13);
    assert.equal(new Set(SHOP.map((it) => it.id)).size, 13);
    assert.deepEqual(SHOP_KINDS.map((k) => k.kind), ['tag', 'ring', 'cab', 'frame', 'hat']);
    for (const it of SHOP) {
      assert.ok(SHOP_KINDS.some((k) => k.kind === it.kind), it.id);
      assert.ok(Number.isInteger(it.price) && it.price >= 200 && it.price <= 1500, it.id);
      assert.match(it.tint, /^#[0-9a-f]{6}$/, it.id);
      assert.ok(it.id.startsWith(it.kind + '_'), it.id);
      assert.ok(it.label.length >= 3, it.id);
      assert.ok(Object.isFrozen(it));
    }
    for (const k of SHOP_KINDS) assert.ok(SHOP.some((it) => it.kind === k.kind), k.kind);
    assert.deepEqual(['hat_ribbon', 'cab_yellow', 'frame_streak'].map((id) => shopItem(id).price), [400, 800, 600]);
    const note = read('docs/superpowers/specs/2026-11-15-monetize-legal-note.md');
    for (const [id, p] of [['hat_ribbon', 400], ['cab_yellow', 800], ['frame_streak', 600]]) assert.match(note, new RegExp('`' + id + '`[^\\n]*\\| ' + p + ' \\|'));
    assert.equal(shopItem('nope'), null);
    assert.equal(EQUIP_MAX >= SHOP_KINDS.length, true);
    assert.equal(OWNED_MAX >= SHOP.length, true);
  });

  it('the migration seeds the same ids, kinds and prices; the attendance three keep grant_via attend7; schema.sql has the same seed', () => {
    const seed = (sql) => [...sql.matchAll(/\('([a-z_]+)', '([a-z]+)', '(shop|attend7)', (\d+)\)/g)].map((m) => ({ id: m[1], kind: m[2], via: m[3], price: Number(m[4]) }));
    const mig = seed(read(MIG)), sch = seed(read('schema.sql'));
    assert.deepEqual(mig, sch);
    assert.deepEqual(mig.map(({ id, kind, price }) => ({ id, kind, price })), SHOP.map(({ id, kind, price }) => ({ id, kind, price })));
    assert.deepEqual(mig.filter((r) => r.via === 'attend7').map((r) => r.id).sort(), ['cab_yellow', 'frame_streak', 'hat_ribbon']);
  });

  it('cosmeticKind and equippedOf: one id per kind out of any equip list', () => {
    assert.equal(cosmeticKind('ring_heart'), 'ring');
    assert.equal(cosmeticKind('tag_future'), 'tag'); // a later item the client does not know yet still has a kind
    assert.equal(cosmeticKind('taxi'), '');
    assert.equal(cosmeticKind(''), '');
    assert.equal(equippedOf(['hat_ribbon', 'tag_gold', 'ring_rainbow'], 'tag'), 'tag_gold');
    assert.equal(equippedOf('cab_pink,frame_gold', 'frame'), 'frame_gold');
    assert.equal(equippedOf(['taxi'], 'cab'), '');
    assert.equal(equippedOf(null, 'cab'), '');
  });

  it('shopTiles: closed shows the table with soon; open shows the database prices; owned, worn, short and buy', () => {
    const closed = shopTiles({ kind: 'cab', open: false, owned: ['cab_yellow'], equip: ['cab_yellow'], coins: 99999 });
    assert.deepEqual(closed.map((t) => [t.id, t.act, t.price]), [['cab_yellow', 'worn', 800], ['cab_pink', 'soon', 900], ['cab_black', 'soon', 1100]]);
    const items = [{ id: 'cab_yellow', kind: 'cab', price: 800 }, { id: 'cab_pink', kind: 'cab', price: 950 }]; // cab_black not sold by the database
    const open = shopTiles({ kind: 'cab', open: true, items, owned: ['cab_yellow'], equip: [], coins: 900 });
    assert.deepEqual(open.map((t) => [t.id, t.act, t.price, t.owned]), [['cab_yellow', 'wear', 800, true], ['cab_pink', 'short', 950, false]]);
    const rich = shopTiles({ kind: 'cab', open: true, items, owned: ['cab_yellow'], equip: ['cab_yellow'], coins: 950 });
    assert.deepEqual(rich.map((t) => t.act), ['off', 'buy']);
    assert.equal(shopTiles({}).length, 13);
    assert.ok(shopTiles({ open: false }).every((t) => t.act === 'soon'));
  });
});

// ---- the painters (pure canvas calls, recorded) -------------------------------------------------------------------------------------------
function fakeCanvas(w, h) {
  const calls = [];
  const g = new Proxy({ calls }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return (s) => ({ width: String(s).length * 12 });
      if (k === 'createLinearGradient') return (...a) => { calls.push(['grad', ...a]); return { addColorStop: (o, c) => calls.push(['stop', o, c]) }; };
      return (...a) => calls.push([k, ...a]);
    },
    set(t, k, v) { calls.push(['=' + String(k), v]); t[k] = v; return true; },
  });
  return { width: w, height: h, getContext: () => g, calls };
}
describe('the cosmetic painters (ts3d/art.js)', () => {
  it('a name tag without a theme is the plain dark pill; each shop theme paints its own look', () => {
    const plain = fakeCanvas(256, 64); ART.paintNameTag(plain, '네온', '#ff3d9a', true);
    assert.ok(plain.calls.some((c) => c[0] === '=fillStyle' && c[1] === 'rgba(10,14,28,0.82)'));
    assert.ok(!plain.calls.some((c) => c[0] === 'grad'));
    const gold = fakeCanvas(256, 64); ART.paintNameTag(gold, '네온', '#ff3d9a', false, 'tag_gold');
    assert.ok(gold.calls.some((c) => c[0] === 'grad'));
    assert.ok(gold.calls.some((c) => c[0] === '=fillStyle' && c[1] === '#1c1300'), 'dark text on gold');
    const neon = fakeCanvas(256, 64); ART.paintNameTag(neon, '네온', '#ff3d9a', false, 'tag_neon');
    assert.ok(neon.calls.some((c) => c[0] === '=shadowColor' && c[1] === '#48d6f0'));
    const heart = fakeCanvas(256, 64); ART.paintNameTag(heart, '네온', '#ff3d9a', false, 'tag_heart');
    assert.equal(heart.calls.filter((c) => c[0] === 'bezierCurveTo').length, 4, 'a heart at each end');
    const odd = fakeCanvas(256, 64), bare = fakeCanvas(256, 64);
    ART.paintNameTag(odd, '네온', '#ff3d9a', false, 'tag_unknown'); ART.paintNameTag(bare, '네온', '#ff3d9a', false);
    assert.deepEqual(odd.calls, bare.calls, 'an unknown theme is the plain tag');
    for (const it of SHOP.filter((x) => x.kind === 'tag')) assert.ok(ART.TAG_THEMES[it.id], it.id);
  });

  it('ring effects: every shop ring has one, rainbow walks 48 hues, sparkle has stars, heart has hearts; the ring sits where the plain one does', () => {
    for (const it of SHOP.filter((x) => x.kind === 'ring')) assert.ok(ART.RING_FX[it.id], it.id);
    assert.ok(Math.abs(ART.RING_FX_R * ART.RING_FX_SIZE / 2 - 0.66) < 1e-9);
    const rb = fakeCanvas(256, 256); ART.paintRingFx(rb, 'ring_rainbow');
    assert.equal(new Set(rb.calls.filter((c) => c[0] === '=strokeStyle' && String(c[1]).startsWith('hsl(')).map((c) => c[1])).size, 48);
    const sp = fakeCanvas(256, 256); ART.paintRingFx(sp, 'ring_sparkle');
    assert.equal(sp.calls.filter((c) => c[0] === 'quadraticCurveTo').length, 40);
    const ht = fakeCanvas(256, 256); ART.paintRingFx(ht, 'ring_heart');
    assert.equal(ht.calls.filter((c) => c[0] === 'bezierCurveTo').length, 18);
    const none = fakeCanvas(256, 256); ART.paintRingFx(none, 'ring_x');
    assert.deepEqual(none.calls.filter((c) => c[0] === 'stroke' || c[0] === 'fill'), []);
  });

  it('frames: every shop frame has a look; the streak frame keeps its pink; the rainbow walks the hue, the others hold their colour', () => {
    for (const it of SHOP.filter((x) => x.kind === 'frame')) assert.ok(ART.FRAME_FX[it.id], it.id);
    assert.equal(ART.FRAME_FX.frame_streak.color, '#ff3d9a');
    assert.equal(ART.frameTone(ART.FRAME_FX.frame_gold, 3), '#ffc94a');
    assert.notEqual(ART.frameTone(ART.FRAME_FX.frame_rainbow, 0), ART.frameTone(ART.FRAME_FX.frame_rainbow, 2));
    assert.match(ART.frameTone(ART.FRAME_FX.frame_rainbow, 1.3), /^hsl\(\d+, 100%, 60%\)$/);
    assert.equal(ART.frameTone(null, 1), '');
  });

  it('ids from peers that name Object.prototype keys (constructor, __proto__, toString) paint the plain looks and never throw', () => {
    const bare = fakeCanvas(256, 64); ART.paintNameTag(bare, '네온', '#ff3d9a', false);
    const frameX = fakeCanvas(128, 64); ART.paintFrameSwatch(frameX, 'frame_x');
    for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf']) {
      const tag = fakeCanvas(256, 64);
      assert.doesNotThrow(() => ART.paintNameTag(tag, '네온', '#ff3d9a', false, id), id);
      assert.deepEqual(tag.calls, bare.calls, id + ': the plain name tag');
      const fr = fakeCanvas(128, 64);
      assert.doesNotThrow(() => ART.paintFrameSwatch(fr, id), id);
      assert.deepEqual(fr.calls, frameX.calls, id + ': the plain frame swatch');
      const ring = fakeCanvas(256, 256);
      assert.doesNotThrow(() => ART.paintRingFx(ring, id), id);
      assert.deepEqual(ring.calls.filter((c) => c[0] === 'stroke' || c[0] === 'fill'), [], id + ': no ring effect');
    }
    // Every lookup of these tables by an id goes through Object.hasOwn (the render loop and the Room's peers send any string).
    for (const f of ['ts3d/art.js', 'ts3d/avatars.js', 'timesSquare3d.js']) {
      for (const line of read(f).split('\n')) for (const t of ['TAG_THEMES', 'RING_FX', 'FRAME_FX']) {
        if (line.includes(t + '[')) assert.ok(line.includes(`Object.hasOwn(${t}, `), f + ': ' + line.trim());
      }
    }
  });

  it('the plaza wires each kind for everyone: tag and ring on any avatar, the cab tint for remote cabs, frames of holders in the room', () => {
    const av = read('ts3d/avatars.js'), ts = read('timesSquare3d.js'), tr = read('ts3d/traffic.js'), sc = read('ts3d/screens.js');
    assert.match(av, /paintNameTag\(this\.tagCanvas, this\.name, this\.color, this\.local, this\.tagTheme\)/);
    assert.match(av, /this\.syncRingFx\(next\.find\(\(id\) => Object\.hasOwn\(RING_FX, id\)\) \|\| ''\)/);
    assert.match(av, /if \(next\.join\(','\) === this\.cosmetics\.join\(','\)\) return;/); // a peer's list every frame rebuilds nothing
    assert.match(ts, /remoteCars\.push\(\{ x: r\.x, z: r\.z, yaw: r\.yaw, v: r\.spd, tint: cabTint\(cosmetics\) \}\)/);
    assert.match(ts, /traffic\?\.setCabTint\(i, cabTint\(myEquip\)\)/);
    assert.match(ts, /if \(frameSig !== peerFrameSig\) \{ peerFrameSig = frameSig; paintMyFrames\(\); \}/);
    assert.match(ts, /boards\.setRim\(id, fx \? fx\.color : '', fx \? fx\.anim : ''\)/);
    assert.match(tr, /function setCabTint\(i, hex\)/);
    assert.match(sc, /function setRim\(slotId, color, anim = ''\)/);
    assert.match(sc, /if \(rimMoving\.size\) rimStep\(\);/);
  });
});

// ---- the Worker -------------------------------------------------------------------------------------------------------------------------------
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
function spyDo(env) {
  const log = [];
  for (const ns of [env.METER, env.ROOM]) { const real = ns.get; ns.get = (name) => { const s = real(name); return new Proxy(s, { get: (t, k) => typeof t[k] === 'function' ? (...a) => { if (name !== 'day') log.push(name + '.' + String(k)); return t[k](...a); } : t[k] }); }; }
  return log;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const MISSING = { code: 'PGRST202', message: 'Could not find the function in the schema cache' };

// The functions as a JS model. state.migrated: has the shop migration run.
function memDb(state) {
  const wallets = new Map(), inv = new Map(); // inv: actor -> Map(id -> equipped)
  const kinds = new Map(SHOP.map((it) => [it.id, it.kind])), prices = new Map(SHOP.map((it) => [it.id, it.price]));
  const box = (a) => { if (!inv.has(a)) inv.set(a, new Map()); return inv.get(a); };
  const fns = {
    profile_read(a) { const b = box(a.p_actor_id); const eq = [...b].filter(([, on]) => on).map(([id]) => id).sort(), ow = [...b.keys()].sort();
      return { ok: true, level: 1, reputation: 0, species: 1, equip: eq.slice(0, state.migrated ? 6 : 4), owned: ow.slice(0, state.migrated ? 16 : 12), color: null, starter: false, streak: 0, attend_last: null }; },
    equip_cosmetic(a) { const b = box(a.p_actor_id), k = kinds.get(a.p_cosmetic_id); if (!k || !b.has(a.p_cosmetic_id)) return { ok: false, error: 'missing' };
      for (const id of b.keys()) if (kinds.get(id) === k) b.set(id, id === a.p_cosmetic_id); return { ok: true }; },
    shop_list: 1, buy_cosmetic: 1, unequip_cosmetic: 1, move_cosmetics: 1,
  };
  const after = {
    shop_list() { return { ok: true, items: SHOP.map(({ id, kind }) => ({ id, kind, price: prices.get(id) })) }; },
    buy_cosmetic(a) { const k = kinds.get(a.p_cosmetic_id), p = prices.get(a.p_cosmetic_id); if (!k) return { ok: false, error: 'item' };
      if (a.p_price != null && a.p_price !== p) return { ok: false, error: 'price', price: p };
      if (!wallets.has(a.p_actor_id)) return { ok: false, error: 'coins', coins: 0, price: p };
      const b = box(a.p_actor_id), c = wallets.get(a.p_actor_id); if (b.has(a.p_cosmetic_id)) return { ok: false, error: 'owned', coins: c };
      if (c < p) return { ok: false, error: 'coins', coins: c, price: p };
      wallets.set(a.p_actor_id, c - p); for (const id of b.keys()) if (kinds.get(id) === k) b.set(id, false); b.set(a.p_cosmetic_id, true);
      return { ok: true, cosmetic_id: a.p_cosmetic_id, kind: k, price: p, coins: c - p }; },
    unequip_cosmetic(a) { const b = box(a.p_actor_id); let n = 0; for (const [id, on] of b) if (on && kinds.get(id) === a.p_kind) { b.set(id, false); n++; } return { ok: true, n }; },
    move_cosmetics() { return { ok: true, moved: 0 }; },
  };
  return {
    wallets, inv, prices, grant: (a, id) => box(a).set(id, false),
    async rpc(name, a) {
      if (a.p_key !== KEY) return json({ message: 'Unauthorized worker key' }, 400);
      if (after[name]) return state.migrated ? json(after[name](a)) : json(MISSING, 404);
      return json(fns[name] ? fns[name](a) : { ok: true });
    },
  };
}
// The real database in PGlite, through the same door: /rest/v1/rpc/<name> with named arguments, a missing function as PostgREST's 404.
async function loadPGlite() {
  for (const d of [process.env.PGLITE_DIR, join(tmpdir(), 'kts-pglite')].filter(Boolean)) {
    try { const req = createRequire(join(d, 'package.json')); return (await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href)).PGlite; } catch { }
  }
  try { return (await import('@electric-sql/pglite')).PGlite; } catch { return null; }
}
const PGlite = await loadPGlite();
const OLD = (() => { try { return execFileSync('git', ['show', '4ce0ab3:schema.sql'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n'); } catch { return null; } })();
const SQL_SKIP = !PGlite ? 'PGlite not installed (see test/db.test.mjs)' : !OLD ? 'git show 4ce0ab3:schema.sql not available' : false;
async function pgDb(schemaText) {
  const pg = new PGlite();
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await pg.exec(schemaText);
  await pg.query('UPDATE public.app_secrets SET key_value = $1 WHERE key_name = $2', [KEY, 'FLUSH_KEY']);
  const one = async (sql, args = []) => (await pg.query(sql, args)).rows[0];
  return {
    pg, one,
    call: async (name, a) => (await one('SELECT public.' + name + '(' + Object.keys(a).map((k, i) => k + ' => $' + (i + 1)).join(', ') + ') AS r', Object.values(a))).r,
    coins: async (id) => { const r = await one('SELECT coins::int c FROM public.wallets WHERE actor_id = $1', [id]); return r ? r.c : null; },
    async rpc(name, a) {
      try { return json(await this.call(name, a)); }
      catch (e) { const m = String(e?.message || e); return /does not exist/.test(m) && /function/.test(m) ? json(MISSING, 404) : json({ message: m }, 400); }
    },
  };
}
function fakeNet(state, db) {
  return async (url, opt = {}) => {
    const u = String(url);
    if (u.includes('/.well-known/jwks.json')) return json({ keys: [] });
    const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u);
    if (m) { const a = JSON.parse(opt.body || '{}'); state.rpcs.push(m[1]); return db.rpc(m[1], a); }
    if (u.includes('/rest/v1/')) return json([]);
    return new Response('missing', { status: 404 });
  };
}
let clockBase = Date.parse('2031-07-01T03:00:00Z');
async function scene(db, state) {
  clockBase += 10 * 864e5; let t = clockBase; const origNow = Date.now, origFetch = globalThis.fetch;
  Date.now = () => t; globalThis.fetch = fakeNet(state, db); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  const env = makeEnv(), waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (p, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + p, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const post = async (p, body, token) => { const r = await call(p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1', authorization: 'Bearer ' + token }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const get = async (p, token) => { const r = await call(p, token ? { headers: { authorization: 'Bearer ' + token } } : {}); return { status: r.status, body: await r.json() }; };
  const guest = async () => { const tok = (await (await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1' }, body: '{}' })).json()).token;
    return { token: tok, id: 'guest:' + JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).s }; };
  const buy = (g, id) => post('/rt/shop/buy', { cosmetic_id: id, topic: 'chapel:square' }, g.token);
  const roomEquip = async (id) => { env.meter('acct').do._prof?.delete(id); return (await env.room('chapel:square').do.loadProf(id))?.equip; };
  return { env, call, post, get, guest, buy, roomEquip, clock: { add: (ms) => { t += ms; } }, done: () => { Date.now = origNow; globalThis.fetch = origFetch; } };
}

describe('the Worker before and after the shop migration (JS model)', { concurrency: false }, () => {
  it('before: the shop is listed shut, a buy and a take-off answer soon, wearing what attendance gave still works', async () => {
    const state = { rpcs: [], migrated: false }, db = memDb(state), s = await scene(db, state);
    try {
      const g = await s.guest();
      assert.deepEqual(await s.get('/rt/shop'), { status: 200, body: { ok: true, open: false, items: [] } });
      state.rpcs.length = 0;
      assert.deepEqual((await s.get('/rt/shop')).body.open, false);
      assert.deepEqual(state.rpcs, [], 'the no is kept: the next sheet asks nothing');
      const log = spyDo(s.env);
      const b = await s.buy(g, 'tag_gold');
      assert.equal(b.status, 503); assert.equal(b.body.code, 'soon'); assert.match(b.body.error, /곧 열려요/);
      assert.deepEqual(log, [], 'refused before any Durable Object call (no settle)');
      const off = await s.post('/rt/equip', { kind: 'tag', off: true }, g.token);
      assert.deepEqual(off, { status: 503, body: { ok: false, error: 'soon' } });
      db.grant(g.id, 'hat_ribbon');
      assert.deepEqual(await s.post('/rt/equip', { cosmetic_id: 'hat_ribbon' }, g.token), { status: 200, body: { ok: true } });
      assert.deepEqual((await s.get('/rt/profile', g.token)).body.equip, ['hat_ribbon']);
      // The migration runs: within two minutes this isolate asks again and the shop opens.
      state.migrated = true;
      assert.equal((await s.get('/rt/shop')).body.open, false);
      s.clock.add(121000);
      const open = (await s.get('/rt/shop')).body;
      assert.equal(open.open, true);
      assert.deepEqual(open.items.map((it) => it.id).sort(), SHOP.map((it) => it.id).sort());
    } finally { s.done(); }
  });

  it('after: price from the database, not enough coins, a buy settles first and equips, owned, unknown, one per kind, take off, presence', async () => {
    const state = { rpcs: [], migrated: true }, db = memDb(state), s = await scene(db, state);
    try {
      const g = await s.guest();
      const poor = await s.buy(g, 'tag_gold');
      assert.equal(poor.status, 400); assert.equal(poor.body.code, 'coins'); assert.match(poor.body.error, /코인이 부족해요\. 500코인이 필요해요\./);
      db.wallets.set(g.id, 10000);
      s.clock.add(4000);
      const log = spyDo(s.env); state.rpcs.length = 0;
      const ok = await s.buy(g, 'tag_gold');
      assert.deepEqual(ok, { status: 200, body: { ok: true, cosmetic_id: 'tag_gold', kind: 'tag', price: 500, remaining_coins: 9500 } });
      assert.ok(log.includes('chapel:square.fetch'), 'the room settles its pending coins first');
      assert.equal(log.some((x) => x.startsWith('lg.')), false, 'not a league spend');
      assert.deepEqual(state.rpcs, ['buy_cosmetic', 'profile_read'], 'the buy, then the profile the room is told');
      const again = await s.buy(g, 'tag_gold');
      assert.equal(again.status, 429, 'a second buy within 3 s is spaced');
      s.clock.add(4000);
      assert.deepEqual((await s.buy(g, 'tag_gold')).body, { ok: false, code: 'owned', error: '이미 가진 꾸미기예요.' });
      s.clock.add(4000);
      assert.equal((await s.buy(g, 'tag_rocket')).body.code, 'item');
      assert.equal((await s.buy(g, 'TAG GOLD')).body.code, 'item');
      for (const id of ['tag_neon', 'ring_rainbow', 'cab_black', 'frame_rainbow', 'hat_ribbon']) { s.clock.add(4000); assert.equal((await s.buy(g, id)).status, 200, id); }
      const p = (await s.get('/rt/profile', g.token)).body;
      assert.deepEqual(p.equip, ['cab_black', 'frame_rainbow', 'hat_ribbon', 'ring_rainbow', 'tag_neon'], 'one per kind: neon replaced gold');
      assert.equal(p.owned.length, 6);
      assert.deepEqual(await s.roomEquip(g.id), ['cab_black', 'frame_rainbow', 'hat_ribbon', 'ring_rainbow', 'tag_neon'], 'others see all five kinds');
      assert.deepEqual(await s.post('/rt/equip', { cosmetic_id: 'tag_gold' }, g.token), { status: 200, body: { ok: true } });
      assert.deepEqual(await s.post('/rt/equip', { kind: 'ring', off: true }, g.token), { status: 200, body: { ok: true } });
      assert.deepEqual((await s.get('/rt/profile', g.token)).body.equip, ['cab_black', 'frame_rainbow', 'hat_ribbon', 'tag_gold']);
      assert.equal((await s.post('/rt/equip', { kind: 'shoe', off: true }, g.token)).status, 400);
      assert.equal(db.wallets.get(g.id), 10000 - 500 - 700 - 1000 - 1100 - 1500 - 400);
      // No topic: refused before the room is asked, as every spend is.
      s.clock.add(4000);
      assert.equal((await s.post('/rt/shop/buy', { cosmetic_id: 'cab_pink' }, g.token)).status, 400);
      assert.equal((await s.post('/rt/shop/buy', { cosmetic_id: 'cab_pink', topic: 'chapel:square' }, 'bad')).status, 401);
    } finally { s.done(); }
  });

  it('a price shown from an older list buys nothing: refused as price with the live one, nothing charged, the next list is read again', async () => {
    const state = { rpcs: [], migrated: true }, db = memDb(state), s = await scene(db, state);
    try {
      const g = await s.guest(); db.wallets.set(g.id, 5000);
      const gold = async () => (await s.get('/rt/shop')).body.items.find((it) => it.id === 'tag_gold').price;
      assert.equal(await gold(), 500);
      db.prices.set('tag_gold', 650); // the operator raises it; this isolate's list still says 500 for up to 10 minutes
      state.rpcs.length = 0;
      assert.equal(await gold(), 500); assert.deepEqual(state.rpcs, [], 'the cached list');
      const r = await s.post('/rt/shop/buy', { cosmetic_id: 'tag_gold', topic: 'chapel:square', price: 500 }, g.token);
      assert.deepEqual(r, { status: 409, body: { ok: false, code: 'price', error: '가격이 바뀌었어요. 다시 확인해 주세요.', price: 650 } });
      assert.equal(db.wallets.get(g.id), 5000, 'nothing charged');
      assert.equal(db.inv.get(g.id)?.has('tag_gold') || false, false, 'nothing given');
      state.rpcs.length = 0;
      assert.equal(await gold(), 650, 'the sheet refreshes and this isolate asks the database again');
      assert.deepEqual(state.rpcs, ['shop_list']);
      s.clock.add(4000);
      const ok = await s.post('/rt/shop/buy', { cosmetic_id: 'tag_gold', topic: 'chapel:square', price: 650 }, g.token);
      assert.equal(ok.status, 200); assert.equal(ok.body.remaining_coins, 4350);
      // A page from before this change sends no price: charged the database's price, as before.
      s.clock.add(4000);
      assert.equal((await s.buy(g, 'ring_heart')).body.price, 800);
      // A price that is not a whole positive number is not passed on (and so not compared).
      s.clock.add(4000);
      assert.equal((await s.post('/rt/shop/buy', { cosmetic_id: 'cab_pink', topic: 'chapel:square', price: '1' }, g.token)).status, 200);
      // The sheet: the price it showed goes with the buy, a refusal 'price' reads the list again.
      const ui = read('ui.js'), main = read('main.js');
      assert.match(ui, /await hooks\.buyCosmetic\(t\.id, t\.price\)/);
      assert.match(ui, /if \(e\?\.code === 'price'\)/);
      assert.match(main, /net\._plazaPost\('\/rt\/shop\/buy', \{ cosmetic_id: id, \.\.\.\(Number\.isInteger\(price\) && price > 0 \? \{ price \} : \{\}\) \}\)/);
      assert.match(read('net.js'), /throw Object\.assign\(new Error\(data\.error \|\| data\.err \|\| '요청을 처리하지 못했습니다\.'\), \{ code: data\.code \|\| '', data \}\)/);
    } finally { s.done(); }
  });
});

describe('the Room relays only known cosmetics for a socket with no database profile', { concurrency: false }, () => {
  it("drops 'constructor', '__proto__' and made-up ids from a presence's equip; keeps the shop's ids, '' and 'taxi'", async () => {
    const env = makeEnv(), room = env.room('chapel:square').do;
    const ws = { sent: [], send(x) { this.sent.push(String(x)); }, close() {}, serializeAttachment() {}, deserializeAttachment() { return null; } };
    ws.a = { k: 'guest:peer', q: true, v2: true, fl: 0, lob: false, t: Date.now(), ls: Date.now(), m: { x: 1500, y: 1500, fl: 0, name: '손님' } };
    room.socks().set(ws, ws.a);
    const tr = async (equip) => { ws.a.ls = Date.now(); room.socks().set(ws, ws.a); await room.webSocketMessage(ws, JSON.stringify({ t: 'tr', m: { name: '손님', x: 1500, y: 1500, equip } })); return room.socks().get(ws).m.equip; };
    assert.deepEqual(await tr(['constructor', 'tag_gold', '__proto__', 'toString', 'ring_fake', 'hat_ribbon']), ['tag_gold', 'hat_ribbon']);
    assert.deepEqual(await tr('constructor,__proto__'), []);
    assert.deepEqual(await tr({ constructor: 1 }), []);
    assert.equal(await tr('taxi'), 'taxi');
    assert.equal(await tr(''), '');
    // With a profile from the database the Room keeps using that one.
    ws.a.prof = { av: 2, equip: ['cab_pink'] };
    assert.deepEqual(await tr(['constructor']), ['cab_pink']);
  });
});

describe('the presence lists', () => {
  it('the account registry and the room keep up to EQUIP_MAX equipped ids; the profile answer up to OWNED_MAX owned', () => {
    const m = new Meter(makeCtx(sqliteStorage()), {});
    const eq = ['cab_pink', 'frame_gold', 'hat_ribbon', 'ring_heart', 'tag_neon', 'emote_x', 'extra_y'];
    assert.deepEqual(m.profilePut('u', 1, eq).equip, eq.slice(0, EQUIP_MAX));
    const src = read('worker.js');
    assert.match(src, /owned: equipList\(rpc\.data\.owned, OWNED_MAX\)/);
    assert.match(read('main.js'), /equip: Array\.isArray\(p\.equip\) \? p\.equip\.slice\(0, EQUIP_MAX\) : \[\],\n\s+owned: Array\.isArray\(p\.owned\) \? p\.owned\.slice\(0, OWNED_MAX\) : \[\],/);
    assert.match(read('ts3d/avatars.js'), /\.slice\(0, 6\);/);
  });
});

describe('the weekly league leaves the shop out', () => {
  it('the buy route never adds to the league; the buy itself does not touch wallets.spent', () => {
    const src = read('worker.js');
    const route = src.slice(src.indexOf('async function shopApi('), src.indexOf('async function inboxList('));
    assert.doesNotMatch(route, /leagueAdd|lgM\(|lgAdd|lgBoard/);
    const main = read('main.js'), fn = main.slice(main.indexOf('async function buyCosmetic('), main.indexOf('function applyServerProfile('));
    assert.doesNotMatch(fn, /leagueSoon/);
    const sql = read(MIG), buy = sql.slice(sql.indexOf('FUNCTION public.buy_cosmetic'), sql.indexOf('FUNCTION public.unequip_cosmetic'));
    assert.doesNotMatch(buy, /spent/);
  });
});

// ---- the database for real ---------------------------------------------------------------------------------------------------------------
describe('the shop migration in PGlite (schema before it, then the file)', { skip: SQL_SKIP, concurrency: false }, () => {
  let d;
  before(async () => { d = await pgDb(OLD); });
  after(async () => { await d?.pg.close(); });

  it('before: no shop functions, attendance still grants the three, the old CHECKs refuse the new kind and reason', async () => {
    await assert.rejects(d.call('shop_list', { p_key: KEY }), /does not exist/);
    await assert.rejects(d.call('buy_cosmetic', { p_key: KEY, p_actor_id: 'guest:x', p_cosmetic_id: 'hat_ribbon' }), /does not exist/);
    await assert.rejects(d.pg.query("INSERT INTO public.cosmetics (id, kind, grant_via) VALUES ('ring_x', 'ring', 'shop')"), /check/i);
    await assert.rejects(d.pg.query("INSERT INTO public.coin_ledger (actor_id, delta, reason) VALUES ('guest:x', -1, 'shop')"), /check/i);
    // A hand-added reason on production must survive the file: add one the way an operator would.
    const def = (await d.one("SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'public.coin_ledger'::regclass AND contype = 'c'"));
    await d.pg.exec(`ALTER TABLE public.coin_ledger DROP CONSTRAINT ${def.conname}; ALTER TABLE public.coin_ledger ADD CONSTRAINT ${def.conname} ${def.def.replace("'starter'::text", "'starter'::text, 'handfix'::text")}`);
  });

  it('applies in one go with one Korean result row, runs again without change, keeps hand-added values', async () => {
    const run = async () => (await d.pg.exec(read(MIG))).at(-1).rows;
    const r1 = await run();
    assert.equal(r1.length, 1); assert.deepEqual(Object.keys(r1[0]), ['applied', 'note']);
    assert.equal(r1[0].applied, true, r1[0].note); assert.match(r1[0].note, /^적용됨\./);
    const defs = async () => (await d.pg.query("SELECT p.proname, pg_get_functiondef(p.oid) def, p.proacl::text acl FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1, 2")).rows;
    const cons = async () => (await d.pg.query("SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid IN ('public.cosmetics'::regclass, 'public.coin_ledger'::regclass) ORDER BY 1")).rows;
    const [f1, c1] = [await defs(), await cons()];
    const r2 = await run(); assert.equal(r2[0].applied, true);
    assert.deepEqual(await defs(), f1); assert.deepEqual(await cons(), c1);
    const ledger = c1.find((c) => /reason/.test(c.def)).def;
    assert.match(ledger, /'handfix'::text/); assert.match(ledger, /'shop'::text/);
    assert.match(c1.find((c) => /kind/.test(c.def)).def, /'emote'::text, 'tag'::text, 'ring'::text/);
    assert.equal((await d.one('SELECT count(*)::int n FROM public.cosmetics WHERE price IS NOT NULL')).n, 13);
    const list = await d.call('shop_list', { p_key: KEY });
    assert.equal(list.ok, true);
    assert.deepEqual(list.items.map((it) => [it.id, it.price]).sort(), SHOP.map((it) => [it.id, it.price]).sort());
    await assert.rejects(d.call('shop_list', { p_key: 'wrong' }), /Unauthorized worker key/);
  });

  it('buy: unknown item, no wallet, not enough coins, a buy (ledger shop, spent untouched, equipped), already owned', async () => {
    const buy = (a, id, key = KEY) => d.call('buy_cosmetic', { p_key: key, p_actor_id: a, p_cosmetic_id: id });
    await assert.rejects(buy('guest:a', 'tag_gold', 'wrong'), /Unauthorized worker key/);
    assert.deepEqual(await buy('guest:a', 'tag_rocket'), { ok: false, error: 'item' });
    await d.pg.query("INSERT INTO public.cosmetics (id, kind, grant_via) VALUES ('hat_free', 'hat', 'season')");
    assert.deepEqual(await buy('guest:a', 'hat_free'), { ok: false, error: 'item' }, 'no price: not sold');
    assert.deepEqual(await buy('guest:a', 'tag_gold'), { ok: false, error: 'coins', coins: 0, price: 500 }, 'no wallet row: nothing is made');
    assert.equal(await d.coins('guest:a'), null);
    await d.pg.query("INSERT INTO public.wallets (actor_id, coins, spent) VALUES ('guest:a', 499, 7)");
    assert.deepEqual(await buy('guest:a', 'tag_gold'), { ok: false, error: 'coins', coins: 499, price: 500 });
    await d.pg.query("UPDATE public.wallets SET coins = 1200 WHERE actor_id = 'guest:a'");
    assert.deepEqual(await buy('guest:a', 'tag_gold'), { ok: true, cosmetic_id: 'tag_gold', kind: 'tag', price: 500, coins: 700 });
    assert.deepEqual(await d.one("SELECT coins::int, spent::int FROM public.wallets WHERE actor_id = 'guest:a'"), { coins: 700, spent: 7 });
    assert.deepEqual((await d.pg.query("SELECT delta::int, reason, ref FROM public.coin_ledger WHERE actor_id = 'guest:a'")).rows, [{ delta: -500, reason: 'shop', ref: 'tag_gold' }]);
    assert.deepEqual(await buy('guest:a', 'tag_gold'), { ok: false, error: 'owned', coins: 700 });
    assert.equal(await d.coins('guest:a'), 700);
  });

  it('buy with the price the player was shown: another price buys nothing; the same price, or none, buys', async () => {
    const buy = (a, id, p_price) => d.call('buy_cosmetic', { p_key: KEY, p_actor_id: a, p_cosmetic_id: id, ...(p_price === undefined ? {} : { p_price }) });
    await d.pg.query("INSERT INTO public.wallets (actor_id, coins) VALUES ('guest:p', 3000)");
    assert.deepEqual(await buy('guest:p', 'tag_neon', 600), { ok: false, error: 'price', price: 700 });
    assert.equal(await d.coins('guest:p'), 3000);
    assert.equal((await d.one("SELECT count(*)::int n FROM public.coin_ledger WHERE actor_id = 'guest:p'")).n, 0);
    assert.equal((await buy('guest:p', 'tag_neon', 700)).ok, true);
    assert.equal((await buy('guest:p', 'ring_heart', null)).ok, true, 'null is no price shown');
    assert.equal((await buy('guest:p', 'cab_pink')).ok, true, 'three arguments still work (the Worker sends three when the page sent no price)');
    assert.equal(await d.coins('guest:p'), 3000 - 700 - 800 - 900);
    assert.equal((await d.one("SELECT count(*)::int n FROM pg_proc WHERE proname = 'buy_cosmetic'")).n, 1, 'one buy_cosmetic: the three-argument draft is gone');
    assert.match(read(MIG), /DROP FUNCTION IF EXISTS public\.buy_cosmetic\(TEXT, TEXT, TEXT\);/);
  });

  it('two buys of one item at once: one wins, the other is owned, the wallet is charged once', async () => {
    await d.pg.query("INSERT INTO public.wallets (actor_id, coins) VALUES ('guest:b', 2000)");
    const buy = () => d.call('buy_cosmetic', { p_key: KEY, p_actor_id: 'guest:b', p_cosmetic_id: 'frame_rainbow' });
    const rs = await Promise.all([buy(), buy()]);
    assert.deepEqual(rs.map((r) => r.ok).sort(), [false, true]);
    assert.equal(rs.find((r) => !r.ok).error, 'owned');
    assert.equal(await d.coins('guest:b'), 500);
    assert.equal((await d.one("SELECT count(*)::int n FROM public.coin_ledger WHERE actor_id = 'guest:b' AND reason = 'shop'")).n, 1);
    // The table itself refuses a second row too, and the wallet never goes below 0.
    await assert.rejects(d.pg.query("INSERT INTO public.inventory (actor_id, cosmetic_id) VALUES ('guest:b', 'frame_rainbow')"), /duplicate key/);
    assert.deepEqual(await d.call('buy_cosmetic', { p_key: KEY, p_actor_id: 'guest:b', p_cosmetic_id: 'frame_gold' }), { ok: false, error: 'coins', coins: 500, price: 1000 });
  });

  it('one per kind: buying, equipping and taking off; profile_read gives all five kinds and every owned item', async () => {
    const a = 'guest:c';
    await d.pg.query('INSERT INTO public.wallets (actor_id, coins) VALUES ($1, 20000)', [a]);
    for (const it of SHOP) assert.equal((await d.call('buy_cosmetic', { p_key: KEY, p_actor_id: a, p_cosmetic_id: it.id })).ok, true, it.id);
    let p = await d.call('profile_read', { p_key: KEY, p_actor_id: a });
    assert.deepEqual(p.equip, ['cab_black', 'frame_rainbow', 'hat_ribbon', 'ring_rainbow', 'tag_neon'], 'the last bought of each kind');
    assert.equal(p.owned.length, 13);
    assert.deepEqual(await d.call('equip_cosmetic', { p_key: KEY, p_actor_id: a, p_cosmetic_id: 'tag_heart' }), { ok: true });
    assert.deepEqual(await d.call('unequip_cosmetic', { p_key: KEY, p_actor_id: a, p_kind: 'ring' }), { ok: true, n: 1 });
    assert.deepEqual(await d.call('unequip_cosmetic', { p_key: KEY, p_actor_id: a, p_kind: 'ring' }), { ok: true, n: 0 });
    p = await d.call('profile_read', { p_key: KEY, p_actor_id: a });
    assert.deepEqual(p.equip, ['cab_black', 'frame_rainbow', 'hat_ribbon', 'tag_heart']);
    assert.equal(await d.coins(a), 20000 - SHOP.reduce((n, it) => n + it.price, 0));
  });

  it('attendance still grants the three (and a later buy of one is refused as owned); a guest locker moves into its account', async () => {
    const g = 'guest:d', u = 'user:dddddddd-0000-4000-8000-000000000001';
    await d.pg.query("INSERT INTO public.wallets (actor_id, coins) VALUES ($1, 3000), ($2, 0)", [g, u]);
    await d.pg.query("INSERT INTO public.profiles (actor_id, attend_streak, attend_last) VALUES ($1, 6, (timezone('Asia/Seoul', now()))::date - 1)", [g]);
    assert.equal((await d.call('touch_attend', { p_key: KEY, p_actor_id: g })).streak, 7);
    assert.deepEqual(await d.call('buy_cosmetic', { p_key: KEY, p_actor_id: g, p_cosmetic_id: 'cab_yellow' }), { ok: false, error: 'owned', coins: 3000 });
    assert.equal((await d.call('buy_cosmetic', { p_key: KEY, p_actor_id: g, p_cosmetic_id: 'ring_heart' })).ok, true);
    await d.pg.query("INSERT INTO public.inventory (actor_id, cosmetic_id, equipped) VALUES ($1, 'ring_sparkle', true), ($1, 'hat_ribbon', false)", [u]);
    assert.deepEqual(await d.call('move_cosmetics', { p_key: KEY, p_from: u, p_to: g }), { ok: false, error: 'actor' });
    assert.deepEqual(await d.call('move_cosmetics', { p_key: KEY, p_from: g, p_to: 'user:none' }), { ok: false, error: 'actor' });
    assert.deepEqual(await d.call('move_cosmetics', { p_key: KEY, p_from: g, p_to: u }), { ok: true, moved: 3 }); // hat_ribbon was the account's already
    const rows = (await d.pg.query('SELECT cosmetic_id, equipped FROM public.inventory WHERE actor_id = $1 ORDER BY 1', [u])).rows;
    assert.deepEqual(rows, [{ cosmetic_id: 'cab_yellow', equipped: false }, { cosmetic_id: 'frame_streak', equipped: false }, { cosmetic_id: 'hat_ribbon', equipped: false },
      { cosmetic_id: 'ring_heart', equipped: false }, { cosmetic_id: 'ring_sparkle', equipped: true }], "the account's own ring stays the one worn");
    assert.equal((await d.one('SELECT count(*)::int n FROM public.inventory WHERE actor_id = $1', [g])).n, 0);
    assert.deepEqual(await d.call('move_cosmetics', { p_key: KEY, p_from: g, p_to: u }), { ok: true, moved: 0 });
  });
});

describe('the Worker on the real database (PGlite): before, then after the migration', { skip: SQL_SKIP, concurrency: false }, () => {
  it('shut, then open after the file; a real buy through the route; the room sees the new kinds', async () => {
    const d = await pgDb(OLD), state = { rpcs: [] }, s = await scene(d, state);
    try {
      const g = await s.guest();
      assert.equal((await s.get('/rt/shop')).body.open, false);
      assert.equal((await s.buy(g, 'ring_heart')).body.code, 'soon');
      assert.deepEqual(await s.post('/rt/equip', { kind: 'ring', off: true }, g.token), { status: 503, body: { ok: false, error: 'soon' } });
      await d.pg.exec(read(MIG));
      s.clock.add(121000);
      const open = (await s.get('/rt/shop')).body;
      assert.equal(open.open, true); assert.equal(open.items.length, 13);
      assert.deepEqual(open.items.find((it) => it.id === 'frame_rainbow'), { id: 'frame_rainbow', kind: 'frame', price: 1500 });
      await d.pg.query('INSERT INTO public.wallets (actor_id, coins) VALUES ($1, 2000)', [g.id]);
      const b = await s.buy(g, 'ring_heart');
      assert.deepEqual(b, { status: 200, body: { ok: true, cosmetic_id: 'ring_heart', kind: 'ring', price: 800, remaining_coins: 1200 } });
      s.clock.add(4000);
      assert.equal((await s.buy(g, 'tag_neon')).status, 200);
      assert.deepEqual(await s.roomEquip(g.id), ['ring_heart', 'tag_neon']);
      assert.deepEqual(await s.post('/rt/equip', { kind: 'ring', off: true }, g.token), { status: 200, body: { ok: true } });
      assert.deepEqual((await s.get('/rt/profile', g.token)).body.equip, ['tag_neon']);
      assert.equal(await d.coins(g.id), 500);
    } finally { s.done(); await d.pg.close(); }
  });
});
