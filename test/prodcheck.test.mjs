import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
const worker = W.default, { Meter, resolveActor } = W;
// The Room from a second copy of worker.js: like a Durable Object in its own isolate, it never sees the Worker's per-isolate world copy (PC).
const { Room } = await import('../worker.js?isolate=room');
const E = await import('../tools/prod-e2e.mjs');
const C = await import('../tools/prod-check.mjs');
const { SLOTS, BALANCE, floorOf } = await import('../balance.js');
const { wishFault, wishNickFault, cleanWish } = await import('../wish.js');
const { blockedText } = await import('../plaza-account.js');

describe('prod-e2e pure helpers', () => {
  it('parses arguments and refuses a missing or odd origin', () => {
    const st = path.join(os.tmpdir(), 'kts-x.json');
    const a = E.parseArgs(['https://studio.wishboard.workers.dev/', '--only=wish,board', '--keep', '--state=' + st]);
    assert.deepEqual(a.errors, []);
    assert.equal(a.origin, 'https://studio.wishboard.workers.dev');
    assert.deepEqual([...a.only], ['wish', 'board']);
    assert.equal(a.keep, true); assert.equal(a.state, path.resolve(st)); assert.equal(a.fresh, false);
    assert.match(E.parseArgs([]).errors[0], /origin is required/);
    assert.match(E.parseArgs(['https://x.example/rt']).errors[0], /must look like/);
    assert.match(E.parseArgs(['ftp://x.example']).errors[0], /must be https/);
    // plain http only for a local host
    assert.match(E.parseArgs(['http://studio.wishboard.workers.dev']).errors[0], /must be https/);
    for (const o of ['http://localhost:8787', 'http://127.0.0.1:8790', 'http://[::1]:8787']) assert.deepEqual(E.parseArgs([o]).errors, [], o);
    // live tokens never land in the working tree
    assert.match(E.parseArgs(['https://x.example', '--state=prod-state.json']).errors[0], /must be under/);
    assert.match(E.parseArgs(['https://x.example', '--state=' + path.join(os.tmpdir(), '..', 'x.json')]).errors[0], /must be under/);
    assert.notEqual(E.stateFault(os.tmpdir()), ''); // the directory itself is not a file under it
    assert.match(E.parseArgs(['https://x.example', '--only=wsh']).errors[0], /unknown step/);
    assert.match(E.parseArgs(['https://x.example', '--bogus']).errors[0], /unknown option/);
  });
  it('plans the named steps with what they need, plus admin and cleanup', () => {
    assert.deepEqual(E.planSteps(null), [...E.STEP_NAMES]);
    assert.deepEqual(E.planSteps(new Set(['share'])), ['admin', 'guests', 'wish', 'share', 'cleanup']);
    assert.deepEqual(E.planSteps(new Set(['board'])), ['admin', 'guests', 'enter', 'coins', 'board', 'cleanup']);
    assert.deepEqual(E.planSteps(new Set(['cleanup'])), ['admin', 'cleanup']);
    assert.deepEqual(E.planSteps(new Set(['push'])), ['admin', 'push', 'cleanup']);
  });
  it('reads .dev.vars lines', () => {
    const v = E.parseDevVars('# c\nADMIN_KEY=abc123def456\nexport GUEST_KEY="q w"\n\nBAD LINE\nFLUSH_KEY = \'z\'\r\n');
    assert.deepEqual(v, { ADMIN_KEY: 'abc123def456', GUEST_KEY: 'q w', FLUSH_KEY: 'z' });
  });
  it('masks ids and strips tokens, subs and secrets from log text', () => {
    assert.equal(E.mask('g-1234-abcd'), '…abcd'); assert.equal(E.mask(''), '-');
    const sub = 'g-0123abcd-0000-4000-8000-0123456789ab', s = E.sanitize(`{"token":"g1.eyJzIjoi.c2ln-_x","sub":"${sub}","h":"h1.a.b","k":"super-secret-key"}`, ['super-secret-key']);
    assert.ok(!s.includes('eyJzIjoi') && !s.includes(sub) && !s.includes('super-secret-key'), s);
    assert.match(s, /g1\.<token>/); assert.match(s, /g-…89ab/); assert.match(s, /h1\.<ticket>/);
  });
  it('reads meta tags the way worker.js writes them', () => {
    const html = '<meta property="og:title" content="점검1님의 소원"><meta property="og:description" content="&quot;a&amp;b&lt;"><meta name="twitter:card" content="summary_large_image">';
    assert.equal(E.metaContent(html, 'og:title'), '점검1님의 소원');
    assert.equal(E.metaContent(html, 'og:description'), '"a&b<');
    assert.equal(E.metaContent(html, 'twitter:card'), 'summary_large_image');
    assert.equal(E.metaContent(html, 'og:image'), null);
    assert.equal(E.pathOf('https://h.example/rt/snap/ab?x=1', 'https://o.example'), '/rt/snap/ab?x=1');
  });
  it('picks the cheapest empty board that is not main, not a starter slot and not an owned plot front', () => {
    const boards = SLOTS.map((s) => ({ slot_id: s.id, holder_id: null, plot_id: s.id.startsWith('PLOT_') ? Number(s.id.slice(5)) : null }));
    let c = E.slotCandidates({ billboards: boards, plots: [{ plot_id: 1, owner_id: 'guest:landlord' }, { plot_id: 3, owner_id: null }] });
    assert.equal(c[0].slot, 'PLOT_2'); assert.equal(c[0].bid, floorOf('PLOT_2'));
    assert.ok(!c.some((x) => x.slot.startsWith('MAIN_') || BALANCE.starterSlots.includes(x.slot) || x.slot === 'PLOT_1'));
    assert.ok(c.some((x) => x.slot === 'PLOT_3'));
    for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].bid <= c[i].bid);
    boards.forEach((b) => { if (b.slot_id !== 'STREET_30' && b.slot_id !== 'STREET_8') b.holder_id = 'guest:someone'; });
    c = E.slotCandidates({ billboards: boards, plots: [] });
    assert.deepEqual(c.map((x) => x.slot), ['STREET_30']); // one left: the step then refuses to take it
    assert.deepEqual(E.slotCandidates(null), []);
    // the free-first list from GET /rt/config is excluded on top of BALANCE.starterSlots
    boards.forEach((b) => { b.holder_id = null; });
    const st = E.starterOf({ starter: ['STREET_1', 'STREET_2', 'STREET_1', 7] });
    assert.deepEqual(st, [...BALANCE.starterSlots, 'STREET_1', 'STREET_2']);
    assert.deepEqual(E.starterOf(null), [...BALANCE.starterSlots]);
    c = E.slotCandidates({ billboards: boards.filter((b) => b.slot_id.startsWith('STREET_')), plots: [] }, st);
    assert.equal(c[0].slot, 'STREET_3'); assert.ok(!c.some((x) => st.includes(x.slot)));
  });
  it('uses copy the server accepts, and refusal copy it refuses as link', () => {
    assert.equal(wishFault(E.WISH_TEXT), ''); assert.equal(wishFault(E.WISH_EDIT), '');
    assert.equal(cleanWish(E.WISH_TEXT), E.WISH_TEXT);
    assert.equal(wishFault(E.WISH_LINK), 'link'); assert.equal(wishFault(E.WISH_PHONE), 'link');
    for (const n of E.NICKS) { assert.equal(wishNickFault(n), ''); assert.equal(blockedText(n), false); }
    for (const l of [...E.BOARD_LINES, ...E.NEUTRAL_LINES]) { assert.equal(blockedText(l), false); assert.ok(Array.from(l).length <= 16, l); }
  });
  it('counts a summary table', () => {
    const s = E.summaryTable([{ step: 'a', status: 'PASS' }, { step: 'a', status: 'FAIL' }, { step: 'b', status: 'SKIP' }]);
    assert.equal(s.PASS, 1); assert.equal(s.FAIL, 1); assert.equal(s.SKIP, 1); assert.match(s.text, /total\s+1\s+1\s+1/);
    assert.equal(E.kstDay(Date.parse('2026-11-21T15:30:00Z')), '2026-11-22');
    assert.equal(E.kstMinutesToMidnight(Date.parse('2026-11-21T14:50:00Z')), 10);
  });
});

describe('prod-check ignore list comes from .assetsignore', () => {
  const rules = C.parseIgnore(readFileSync(new URL('../.assetsignore', import.meta.url), 'utf8'));
  it('drops what wrangler does not upload and keeps the game files', () => {
    for (const p of ['worker.js', 'AGENTS.md', 'docs/pending/x.md', 'tools/prod-e2e.mjs', 'test/wish.test.mjs', 'schema.sql', '.dev.vars', '.env.local', 'cf_release.py', 'assets/models/Mousey.fbx', 'tools/blender/src/Mousey.glb', 'tools/blender/build_animal.py', '.git/HEAD', '.claude/worktrees/a/index.html', 'node_modules/x/y.js', 'out/a.png', 'wrangler.jsonc', 'a.pem'])
      assert.equal(C.ignoredBy(rules, p), true, p);
    for (const p of ['index.html', 'main.js', 'ts3d/screens.js', 'assets/models/CatToy.glb', 'og.jpg', 'sw.js', 'vendor/three.module.js', 'admin.html', 'oauth.html'])
      assert.equal(C.ignoredBy(rules, p), false, p);
    assert.equal(C.ignoredBy(rules, 'tools', true), true); assert.equal(C.ignoredBy(rules, 'ts3d', true), false);
    assert.equal(C.ignoredBy(C.parseIgnore('out/\n!keep.md\n*.md'), 'out', false), false); // dir-only rule, a file named out
    assert.equal(C.ignoredBy(C.parseIgnore('*.md\n!keep.md'), 'keep.md'), false);
  });
});

// ---------- a dry run of the whole script against the real Worker, Meter and Room in memory ----------
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
    storage: { sql, async getAlarm() { return null; }, async setAlarm() {}, transactionSync(fn) { return fn(); } },
    setWebSocketAutoResponse() {}, getWebSockets() { return []; }, getWebSocketAutoResponseTimestamp() { return new Date(); }, acceptWebSocket() {},
  };
}
const stub = (obj) => new Proxy(obj, { get: (t, k) => k === 'fetch' ? (req) => t.fetch(req) : typeof t[k] === 'function' ? async (...a) => structuredClone(await t[k](...structuredClone(a))) : t[k] });
const ADMIN = 'admin-test-key-123';
function makeEnv() {
  const meters = new Map(), rooms = new Map();
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ADMIN_KEY: ADMIN, ASSETS: { fetch: () => new Response('asset', { status: 200 }) } };
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new Meter(makeCtx(sql), env) }); } return meters.get(name); };
  env.room = (topic) => { if (!rooms.has(topic)) { const sql = sqliteStorage(); rooms.set(topic, { sql, do: new Room(makeCtx(sql), env) }); } return rooms.get(topic); };
  env.METER = { idFromName: (name) => name, get: (name) => stub(env.meter(name).do) };
  env.ROOM = { idFromName: (topic) => topic, get: (topic) => stub(env.room(topic).do) };
  return env;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const kst = () => new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);
// Supabase with just enough state for the routes the script touches (wallets, boards, inbox), shaped like schema.sql answers.
function fakeSupa(db) {
  const rpc = {
    plaza_live: () => ({}),
    coin_batch: (a) => { for (const it of a.p_items) { const w = db.wallets.get(it.actor_id); if (w) { w.coins += it.delta; w.nickname = it.nickname || w.nickname; } else db.wallets.set(it.actor_id, { nickname: it.nickname, coins: 100 + it.delta }); } return { ok: true, flushed: a.p_items.length }; },
    grant_coins: (a) => { const w = db.wallets.get(a.p_actor_id); if (!w) return { ok: false, error: '그 지갑을 찾지 못했습니다.' }; w.coins += a.p_amount; return { ok: true, actor_id: a.p_actor_id, nickname: w.nickname, coins: w.coins }; },
    claim_billboard: (a) => {
      const b = db.boards.get(a.p_slot_id); if (!b) return { ok: false, error: 'slot' };
      if (a.p_mode === 'edit') { // schema.sql: holder only, live, bid >= current_bid, charge the difference, clock and holder unchanged
        if (db.refuseEdit || b.holder_id !== a.p_actor_id || !(Date.parse(b.lit_until || 0) > Date.now()) || a.p_bid < b.current_bid) return { ok: false, error: 'edit' };
        db.edits.push(a); Object.assign(b, { line1: a.p_line1, line2: a.p_line2, line3: a.p_line3, emoji: a.p_emoji });
        return { ok: true, billboard: { ...b }, remaining_coins: db.wallets.get(a.p_actor_id).coins, prev_holder_id: b.holder_id };
      }
      if (!db.wallets.has(a.p_actor_id)) db.wallets.set(a.p_actor_id, { nickname: a.p_nickname, coins: 100 });
      const w = db.wallets.get(a.p_actor_id), live = b.holder_id && Date.parse(b.lit_until || 0) > Date.now(), min = live ? Math.max(floorOf(b.slot_id), b.current_bid + 50) : floorOf(b.slot_id);
      if (a.p_bid < min) return { ok: false, error: '최소 ' + min + ' 코인 이상 입찰해야 합니다.' };
      if (w.coins < a.p_bid) return { ok: false, error: '코인이 부족합니다. 붕어빵을 더 구워보세요!' };
      const prev = b.holder_id, until = new Date(Date.now() + 72 * 36e5).toISOString();
      w.coins -= a.p_bid; db.claims.push(a);
      Object.assign(b, { holder_id: a.p_actor_id, holder_name: a.p_nickname, line1: a.p_line1, line2: a.p_line2, line3: a.p_line3, emoji: a.p_emoji, bg_theme: a.p_bg_theme, text_color: a.p_text_color, current_bid: a.p_bid, protected_until: new Date(Date.now() + 30 * 60000).toISOString(), expires_at: until, lit_until: until, lit_days: 1, lit_on: kst() });
      return { ok: true, billboard: { ...b }, remaining_coins: w.coins, prev_holder_id: prev || null };
    },
    relight_billboard: (a) => { const b = db.boards.get(a.p_slot_id); if (!b || b.holder_id !== a.p_actor_id) return { ok: false, error: 'holder' }; if (b.lit_on === kst()) return { ok: true, lit_until: b.lit_until, lit_days: b.lit_days };
      b.lit_until = b.expires_at = new Date(Date.now() + 72 * 36e5).toISOString(); b.lit_on = kst(); b.lit_days += 1; return { ok: true, lit_until: b.lit_until, lit_days: b.lit_days, scored: true }; },
    takedown_billboard: (a) => { const b = db.boards.get(a.p_slot_id); if (!b) return { ok: false, error: 'slot' }; Object.assign(b, { line1: '운영자가 내렸습니다', line2: '', line3: '', external_url: null }); db.takedowns.push(a.p_slot_id); return { ok: true, billboard: { ...b } }; },
    inbox_batch: (a) => { db.inboxSent.push(...a.p_items); for (const it of a.p_items) { const to = it.actor_id || it.to; if (!to) continue; db.inbox.push({ id: ++db.seq, actor_id: to, kind: it.kind, slot_id: it.slot_id || null, phrase: it.phrase ?? null, from_name: it.from_name || null, from_id: it.from || null, created_at: new Date(Date.now()).toISOString(), read_at: null }); } return { ok: true }; },
    inbox_list: (a) => ({ items: db.inbox.filter((r) => r.actor_id === a.p_actor_id).sort((x, y) => (x.read_at ? 1 : 0) - (y.read_at ? 1 : 0) || y.id - x.id).slice(0, 20).map((r) => ({ id: r.id, kind: r.kind, slot_id: r.slot_id, phrase: r.phrase, from_name: r.from_name, from: r.from_id, created_at: r.created_at, ...(db.readFlag ? { read: !!r.read_at } : {}) })) }), // readFlag: the optional migration
    starter_slot_list: () => (db.starter ? { ok: true, slots: db.starter } : { ok: false }),
    inbox_read: (a) => { for (const r of db.inbox) if (r.actor_id === a.p_actor_id && a.p_ids.includes(r.id)) r.read_at ||= new Date().toISOString(); return { ok: true }; },
  };
  return async (url, opt = {}) => {
    const u = new URL(String(url));
    if (u.hostname !== 'yxddhpacuyaffaoutxjn.supabase.co') throw new Error('unexpected network target ' + u.host);
    if (u.pathname === '/rest/v1/billboards' && db.boardsDown) return json({ message: 'down' }, 503);
    if (u.pathname === '/rest/v1/billboards') { const eq = u.searchParams.get('slot_id') || ''; const rows = [...db.boards.values()].filter((b) => !eq.startsWith('eq.') || b.slot_id === eq.slice(3)); return json(rows.map((b) => ({ ...b }))); }
    if (u.pathname === '/rest/v1/plots') return json(db.plots);
    if (u.pathname === '/rest/v1/wallets') { const eq = u.searchParams.get('actor_id') || ''; if (!eq.startsWith('eq.')) return json([]); const id = eq.slice(3), w = db.wallets.get(id);
      return json(w ? [{ actor_id: id, nickname: w.nickname, coins: w.coins, vip_tickets: 0, updated_at: '', linked: false }] : []); }
    const m = /^\/rest\/v1\/rpc\/(\w+)$/.exec(u.pathname);
    if (m) { const f = rpc[m[1]]; return f ? json(f(JSON.parse(opt.body || '{}'))) : json({ ok: true }); }
    return new Response('missing', { status: 404 });
  };
}
function makeDb() {
  const boards = new Map(SLOTS.map((s) => [s.id, { slot_id: s.id, tier: s.tier, holder_id: null, holder_name: null, line1: '', line2: '', line3: '', emoji: '✨', bg_theme: 'cyber_navy', text_color: '#ffffff', current_bid: 0, protected_until: null, expires_at: null, lit_until: null, lit_on: null, lit_days: 0, plot_id: s.id.startsWith('PLOT_') ? Number(s.id.slice(5)) : null, photo_id: null, photo_status: null }]));
  return { boards, plots: [{ plot_id: 1, owner_id: 'guest:g-11111111-1111-4111-8111-111111111111', stage: 1 }], wallets: new Map(), claims: [], edits: [], takedowns: [], inbox: [], inboxSent: [], seq: 0 };
}
// What /rt/ws does (topic list, masil2 + at.<token> subprotocols, resolveActor, the Room's seat and admit), wired to the real Room's message handler.
function fakeWebSocket(env) {
  return class FakeWS {
    constructor(url, protocols) {
      this.readyState = 0; const u = new URL(url);
      setImmediate(async () => {
        const topic = u.searchParams.get('topic') || '', at = (protocols.find((x) => x.startsWith('at.')) || '').slice(3);
        if (u.protocol !== 'wss:' || u.pathname !== '/rt/ws' || !/^chapel(qa)?:square(-[2-8])?$/.test(topic) || !protocols.includes('masil2') || u.search.includes('g1.')) return this.fail(400);
        const actor = await resolveActor(env, at); if (!actor) return this.fail(401);
        const room = env.room(topic).do; room.topicName = topic;
        const sf = await room.sit(actor.id, topic); if (sf < 0) return this.fail(429);
        this.server = { send: (d) => setImmediate(() => this.onmessage?.({ data: d })), close() {}, serializeAttachment() {}, deserializeAttachment() { return null; } };
        const a = { k: actor.id, an: true, m: null, q: false, t: Date.now(), ls: Date.now(), lob: false, v2: true, fl: 0, sf, prof: null };
        room.socks().set(this.server, a); this.room = room; this.readyState = 1; this.onopen?.({}); room.admit(this.server, a);
      });
    }
    send(d) { if (this.readyState !== 1) throw new Error('not open'); if (d === 'ping') { setImmediate(() => this.onmessage?.({ data: 'pong' })); return; } this.room.webSocketMessage(this.server, d).catch((e) => { throw e; }); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.room?.webSocketClose(this.server, 1000); setImmediate(() => this.onclose?.({ code: 1000, reason: '' })); }
    fail(code) { this.readyState = 3; this.onclose?.({ code: 1006, reason: 'http ' + code }); }
  };
}
function harness() {
  const env = makeEnv(), db = makeDb(), calls = [];
  const ctx = { waitUntil(p) { Promise.resolve(p).catch(() => {}); } };
  // drop: [{ key: 'POST /rt/wish', has: 'text' }] loses the answer of the next matching request after the Worker has handled it (a cut connection)
  const drop = [];
  const appFetch = async (url, init) => { const req = new Request(url, init), key = req.method + ' ' + new URL(req.url).pathname, body = init?.body instanceof Uint8Array ? '<jpeg>' : init?.body;
    calls.push({ method: req.method, path: new URL(req.url).pathname, body });
    const res = await worker.fetch(req, env, ctx), i = drop.findIndex((d) => d.key === key && String(body || '').includes(d.has || ''));
    if (i >= 0) { drop.splice(i, 1); throw new TypeError('fetch failed'); } return res; };
  return { env, db, calls, drop, appFetch, WS: fakeWebSocket(env) };
}

describe('prod-e2e dry run (in-memory Worker, Meter, Room; fake Supabase)', { concurrency: false }, () => {
  const jpeg = new Uint8Array(readFileSync(new URL('../og.jpg', import.meta.url)));
  const ORIGIN = 'https://prodcheck.test';
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kts-prodcheck-'));
  const realFetch = globalThis.fetch, realNow = Date.now;
  // Isolate caches (world 15 s, gate 15 s, wish list 10 s) are module state shared by every harness in this file; each case moves the clock past them.
  let offset = 0; const bump = (ms = 31000) => { offset += ms; };
  Date.now = () => realNow() + offset;
  after(() => { Date.now = realNow; globalThis.fetch = realFetch; rmSync(dir, { recursive: true, force: true }); });
  const setup = () => { bump(); const h = harness(); globalThis.fetch = fakeSupa(h.db); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } }; return h; };
  const fails = (r) => r.out.filter((l) => l.startsWith('FAIL'));
  const readState = (f = 'state.json') => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  const go = async (h, extra = {}) => { const out = []; const code = await E.run({ origin: ORIGIN, adminKey: ADMIN, fetch: h.appFetch, WebSocket: h.WS, jpeg, statePath: path.join(dir, 'state.json'), log: (s) => out.push(s), timeScale: 0.01, ...extra }); return { code, out, text: out.join('\n') }; };

  it('runs every step against the real routes without a FAIL, cleans up, and a second run reuses the guests', async () => {
    const h = setup();
    {
      const r1 = await go(h);
      assert.deepEqual(fails(r1), [], r1.text);
      assert.equal(r1.code, 0, r1.text);
      for (const step of ['admin', 'guests', 'enter', 'coins', 'wish', 'share', 'push', 'board', 'moderation', 'cleanup']) assert.ok(r1.out.some((l) => l.startsWith('PASS') && l.slice(6).startsWith(step)), 'no PASS for ' + step);
      const state = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8'));
      assert.equal(state.guests.length, 3);
      // nothing secret in the log: tokens, full guest subs, the operator key
      for (const g of state.guests) { assert.ok(!r1.text.includes(g.token), 'token printed'); assert.ok(!r1.text.includes(g.sub), 'sub printed'); }
      assert.ok(!r1.text.includes(ADMIN), 'admin key printed');
      // the board: cheapest empty, not PLOT_1 (its plot has an owner), not main, not starter; claimed at the floor, then edited to neutral lines (no takedown)
      const g1 = 'guest:' + state.guests[0].sub;
      assert.equal(h.db.claims.length, 1); assert.equal(h.db.claims[0].p_slot_id, 'PLOT_2'); assert.equal(h.db.claims[0].p_bid, floorOf('PLOT_2'));
      assert.equal(h.db.claims[0].p_line1, '점검 중'); assert.equal(h.db.claims[0].p_mode, 'claim');
      assert.deepEqual(h.db.takedowns, []); assert.equal(h.db.boards.get('PLOT_2').holder_id, g1);
      assert.equal(h.db.edits.length, 1); assert.equal(h.db.edits[0].p_bid, floorOf('PLOT_2')); assert.equal(h.db.edits[0].p_actor_id, g1);
      assert.deepEqual([1, 2, 3].map((n) => h.db.boards.get('PLOT_2')['line' + n]), [...E.NEUTRAL_LINES]);
      assert.match(r1.text, /PASS {2}cleanup +edit PLOT_2 to neutral lines as its holder/);
      assert.match(r1.text, /boards edited to "여기도 소원 자리예요 \/ 불이 꺼지면 \/ 누구나 걸 수 있어요", still held by a test guest for 72 h from the claim: PLOT_2/);
      assert.match(r1.text, /80% of the test bid back to the test wallet/); assert.match(r1.text, /state file holds live guest tokens/); assert.match(r1.text, /new wishes for its KST day/);
      assert.equal(h.db.boards.get('PLOT_1').holder_id, null);
      for (const s of [...BALANCE.starterSlots, 'MAIN_UP', 'MAIN_TOP', 'MAIN_MID', 'MAIN_BOT', 'MAIN_LOW']) assert.equal(h.db.boards.get(s).holder_id, null, s);
      // wallets: 100 start + 40 hello for all, +3000 grant - bid for guest 1, + cheer for guest 2
      assert.equal(h.db.wallets.get(g1).coins, 140 + 3000 - floorOf('PLOT_2'));
      assert.ok(h.db.wallets.get('guest:' + state.guests[1].sub).coins > 140);
      assert.equal(h.db.wallets.get('guest:' + state.guests[2].sub).coins, 140);
      // one wish, hidden; guest 3 never got one; the cheer row reached guest 1's inbox and was read
      const wishes = h.env.meter('wish').sql.db.prepare('select id, uid, hid, hearts from wsh').all();
      assert.equal(wishes.length, 1); assert.equal(wishes[0].uid, g1); assert.equal(wishes[0].hid, 1); assert.equal(wishes[0].hearts, 1);
      assert.deepEqual(state.wishes.map((w) => w.hidden), [true]); assert.deepEqual(state.slots.map((s) => s.status), ['neutral']);
      const row = h.db.inbox.find((x) => x.actor_id === g1 && x.kind === 'cheer');
      assert.ok(row && row.slot_id === 'PLOT_2' && row.read_at, JSON.stringify(h.db.inbox));
      // the Room runs without the Worker's world copy (its own isolate), and still knows the holder right after the claim
      for (const what of ['guest 2 cheers the board and gets a PAY', 'guest 1 gets the cheer live (INBOX)', "guest 1's /rt/inbox has the cheer row", 'POST /rt/inbox/read marks it read'])
        assert.ok(r1.out.some((l) => l.startsWith('PASS') && l.includes(what)), 'no PASS for ' + what);
      assert.match(r1.text, /SKIP {2}board +the read flag is visible {2}\(GET \/rt\/inbox has no read flag/);
      assert.ok(h.db.inboxSent.length >= 1 && h.db.inboxSent.every((it) => it.to), 'an inbox row without a recipient: ' + JSON.stringify(h.db.inboxSent));
      assert.equal(state.snaps.length, 2);
      assert.match(r1.text, /Left behind/); assert.match(r1.text, /wallet 점검1 …\w{4} {2}\d+ coins/);

      const mints = () => h.calls.filter((c) => c.method === 'POST' && c.path === '/rt/guest' && c.body === '{}').length;
      assert.equal(mints(), 3);
      const r2 = await go(h);
      assert.deepEqual(r2.out.filter((l) => l.startsWith('FAIL')), [], r2.text);
      assert.equal(r2.code, 0); assert.equal(mints(), 3, 'a second run must not mint more guests');
      assert.match(r2.text, /hello is not paid twice/);
      assert.match(r2.text, /SKIP {2}wish +post, edit, hearts, focus, board {2}\(guest 1's wish/);
      assert.match(r2.text, /PASS {2}wish +the refusals did not use guest 3's wish for today/);
      assert.equal(h.db.claims.length, 2); assert.equal(h.db.claims[1].p_slot_id, 'PLOT_3'); assert.deepEqual(h.db.takedowns, []);
      // the grant only tops up a wallet under 1000 coins
      assert.match(r2.text, /SKIP {2}coins +operator grant to 점검1 …\w{4} {2}\(the wallet already has \d+ coins/);
      assert.equal(h.calls.filter((c) => c.path === '/rt/admin/coins').length, 1);
      // --fresh: three new guests, the old ones are kept in the state file for the wallet list and cleanup.
      // The scaled polls last well under a second here; on the live site they outlast the isolate's 15 s world copy, which the hide in
      // run 1 left in place (one world refill per 10 s per isolate). Move the clock past it as real time would.
      bump();
      const r3 = await go(h, { fresh: true });
      assert.deepEqual(fails(r3), [], r3.text);
      assert.equal(r3.code, 0); assert.equal(mints(), 6);
      const s3 = readState();
      assert.equal(s3.guests.length, 3); assert.equal(s3.retired.length, 3);
      assert.match(r3.text, /PASS {2}wish +guest 1 posts a wish/);
      assert.equal((r3.text.match(/^ {2}wallet /gm) || []).length, 6);
      assert.ok(s3.wishes.every((w) => w.hidden) && s3.slots.every((s) => s.status === 'neutral'));
      assert.deepEqual(h.db.claims.map((x) => x.p_slot_id), ['PLOT_2', 'PLOT_3', 'PLOT_4']);
      if (process.env.PRODCHECK_SHOW) console.log(r1.text + '\n\n' + r2.text + '\n\n' + r3.text);
    }
  });

  it('checks the read flag when GET /rt/inbox carries it, and stays off every free-first slot /rt/config lists', async () => {
    const h = setup(); h.db.readFlag = true;
    // every plot front is taken by a player, so the cheapest empty boards are STREET_1, STREET_2, ...; the database lists STREET_1 and STREET_2 as free-first
    for (const b of h.db.boards.values()) if (b.slot_id.startsWith('PLOT_')) Object.assign(b, { holder_id: 'guest:g-33333333-3333-4333-8333-333333333333', holder_name: '손님' });
    h.db.starter = ['STREET_1', 'STREET_2']; bump(61000); await W.starterSlots(h.env); // the Worker's 10-minute copy of starter_slot_list
    const r = await go(h, { statePath: path.join(dir, 'flag.json') });
    assert.deepEqual(fails(r), [], r.text); assert.equal(r.code, 0, r.text);
    assert.deepEqual(h.db.claims.map((x) => x.p_slot_id), ['STREET_3']);
    assert.match(r.text, /PASS {2}board +the row was unread before/); assert.match(r.text, /PASS {2}board +GET \/rt\/inbox shows it read/);
    assert.ok(!/the read flag is visible/.test(r.text));
    // config unreadable: the board step stops before any claim
    const h2 = setup(); h2.drop.push({ key: 'GET /rt/config' });
    const r2 = await go(h2, { statePath: path.join(dir, 'noconfig.json'), only: new Set(['board']) });
    assert.match(r2.text, /FAIL {2}board +step stopped {2}\(cannot read the free-first slots from \/rt\/config/); assert.deepEqual(h2.db.claims, []);
    // the Worker keeps that list for 10 minutes; later cases still claim PLOT_2 (no STREET_ board is the cheapest there)
  });

  it('falls back to the operator takedown only when the holder edit is refused', async () => {
    const h = setup(); h.db.refuseEdit = true;
    const r = await go(h, { statePath: path.join(dir, 'refuse.json') });
    assert.equal(r.code, 1, r.text); // the refused edit is a FAIL line
    assert.deepEqual(fails(r).map((l) => l.replace(/ +\(.*/, '')), ['FAIL  cleanup     edit PLOT_2 to neutral lines as its holder']);
    assert.deepEqual(h.db.takedowns, ['PLOT_2']); assert.equal(h.db.boards.get('PLOT_2').line1, E.TAKEDOWN_LINE);
    assert.deepEqual(readState('refuse.json').slots.map((s) => s.status), ['down']);
    assert.match(r.text, /boards taken down \("운영자가 내렸습니다"\), still held by a test guest for 72 h from the claim: PLOT_2/);
    assert.ok(!/boards edited to/.test(r.text));
  });

  it('leaves a board for a person unless a fresh world read shows our guest holding it inside the protection window', async () => {
    const h = setup(), file = 'guard.json';
    const r0 = await go(h, { statePath: path.join(dir, file), only: new Set(['enter']) }); // three guests with wallets, nothing else
    assert.equal(r0.code, 0, r0.text);
    const st = readState(file), g1 = 'guest:' + st.guests[0].sub, now = Date.now(), until = new Date(now + 72 * 36e5).toISOString();
    const hold = (slot, holder) => Object.assign(h.db.boards.get(slot), { holder_id: holder, holder_name: 'x', line1: '점검 중', current_bid: 100, lit_until: until, expires_at: until });
    hold('PLOT_5', g1); hold('PLOT_6', 'guest:g-22222222-2222-4222-8222-222222222222'); hold('PLOT_7', g1);
    st.slots.push({ slot: 'PLOT_5', by: st.guests[0].sub, at: now - 40 * 60000, until: now - 10 * 60000, status: 'held' }, // older than the window
      { slot: 'PLOT_6', by: st.guests[0].sub, at: now, until: now + 30 * 60000, status: 'held' }, // a real player holds it
      { slot: 'PLOT_7', by: st.guests[0].sub, at: now, until: now + 30 * 60000, status: 'held', down: true }); // an old "down" flag must not count as done
    writeFileSync(path.join(dir, file), JSON.stringify(st));
    bump(1000);
    const r = await go(h, { statePath: path.join(dir, file), only: new Set(['cleanup']) });
    assert.match(r.text, /handle by hand: PLOT_5 \(the claim is older than its 30-minute protection/);
    assert.match(r.text, /handle by hand: PLOT_6 \(someone else holds it now\)/);
    assert.match(r.text, /PASS {2}cleanup +edit PLOT_7 to neutral lines as its holder/);
    assert.deepEqual(h.db.edits.map((e) => e.p_slot_id), ['PLOT_7']); assert.deepEqual(h.db.takedowns, []);
    assert.equal(h.db.boards.get('PLOT_5').line1, '점검 중'); assert.equal(h.db.boards.get('PLOT_6').line1, '점검 중');
    assert.deepEqual(readState(file).slots.map((s) => s.status), ['held', 'held', 'neutral']);
    // the world cannot be read: nothing is touched, and the board stays pending
    const st2 = readState(file); st2.slots.push({ slot: 'PLOT_8', by: st.guests[0].sub, at: Date.now(), until: Date.now() + 30 * 60000, status: 'held' }); hold('PLOT_8', g1);
    writeFileSync(path.join(dir, file), JSON.stringify(st2));
    bump(); h.db.boardsDown = true;
    const r2 = await go(h, { statePath: path.join(dir, file), only: new Set(['cleanup']) });
    assert.match(r2.text, /handle by hand: PLOT_8 \(\/rt\/world could not be read\)/);
    assert.deepEqual(h.db.edits.map((e) => e.p_slot_id), ['PLOT_7']); assert.deepEqual(h.db.takedowns, []);
    assert.match(r2.text, /^ {2}handle by hand: PLOT_5/m); assert.match(r2.text, /^ {2}handle by hand: PLOT_8/m);
  });

  it('keeps a claim and a wish whose answers were lost, so cleanup still reaches them', async () => {
    const h = setup(); h.drop.push({ key: 'POST /rt/claim-billboard', has: '점검 중' }, { key: 'POST /rt/wish', has: E.WISH_TEXT });
    const r = await go(h, { statePath: path.join(dir, 'lost.json') });
    assert.equal(r.code, 1);
    assert.match(r.text, /FAIL {2}wish +guest 1 posts a wish {2}\(no answer, but the wish \w{10} went up \(kept for cleanup\)/);
    assert.match(r.text, /FAIL {2}board +guest 1 claims PLOT_2 {2}\(no answer, but guest 1 holds it now \(kept for cleanup\)/);
    const st = readState('lost.json');
    assert.deepEqual(st.slots.map((s) => [s.slot, s.status]), [['PLOT_2', 'neutral']]);
    assert.equal(st.wishes.length, 1); assert.equal(st.wishes[0].hidden, true);
    assert.equal(h.env.meter('wish').sql.db.prepare('select hid from wsh').get().hid, 1);
    assert.deepEqual(h.db.edits.map((e) => e.p_slot_id), ['PLOT_2']);
  });

  it('stops with exit 2 before creating anything: wrong key, closed budget gate, corrupt state', async () => {
    let h = setup();
    let r = await go(h, { adminKey: 'wrong-key-wrong-key!', statePath: path.join(dir, 'other.json') });
    assert.equal(r.code, 2);
    assert.match(r.text, /operator key in \.dev\.vars is not the production key/);
    assert.equal(h.calls.filter((c) => c.path === '/rt/guest').length, 0);
    assert.ok(!r.text.includes('wrong-key-wrong-key!'));
    h = setup(); h.env.BUDGET_REQ_DAY = '1'; // the day meter is over its hard level: /rt/gate answers full
    r = await go(h, { statePath: path.join(dir, 'gate.json') });
    assert.equal(r.code, 2, r.text); assert.match(r.text, /budget gate is not open/);
    assert.equal(h.calls.filter((c) => c.path === '/rt/guest').length, 0);
    h = setup(); writeFileSync(path.join(dir, 'bad.json'), '{"v":1,"origin":"https://prodcheck.test","slots":[{"slot":"PLO');
    r = await go(h, { statePath: path.join(dir, 'bad.json') });
    assert.equal(r.code, 2); assert.match(r.text, /corrupt/); assert.equal(h.calls.length, 0);
    r = await go(h, { statePath: path.join(process.cwd(), 'prod-state.json') });
    assert.equal(r.code, 2); assert.match(r.text, /must be under/); assert.equal(h.calls.length, 0);
  });
});
