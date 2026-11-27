import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it } from 'node:test';
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
const { WISH_ERR, wishNickFault, wishDay } = await import('../wish.js');
const { slotName } = await import('../balance.js');

// Same harness as wish.test.mjs: real DOs on in-memory SQLite behind a stub that copies arguments and results like the runtime does.
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
function makeEnv(extra = {}) {
  const meters = new Map(), rooms = new Map();
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ADMIN_KEY: 'admin-test-key-123', ASSETS: { fetch: () => new Response('asset', { status: 200 }) }, ...extra };
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new Meter(makeCtx(sql), env) }); } return meters.get(name); };
  env.room = (topic) => { if (!rooms.has(topic)) { const sql = sqliteStorage(); rooms.set(topic, { sql, do: new Room(makeCtx(sql), env) }); } return rooms.get(topic); };
  env.METER = { idFromName: (name) => name, get: (name) => stub(env.meter(name).do) };
  env.ROOM = { idFromName: (topic) => topic, get: (topic) => stub(env.room(topic).do) };
  return env;
}
// Counts calls per method on one Meter instance; `fail` names methods whose next call throws once.
function spyMeter(env, name, fail = new Set()) {
  const calls = {}, real = env.METER.get;
  env.METER.get = (n) => { const m = real(n); if (n !== name) return m;
    return new Proxy(m, { get: (t, k) => typeof t[k] === 'function' ? (...a) => { calls[k] = (calls[k] || 0) + 1; if (fail.has(k)) { fail.delete(k); return Promise.reject(new Error('down')); } return t[k](...a); } : t[k] }); };
  return calls;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const PUSH_HOST = 'https://fcm.googleapis.com/';
// Fake Supabase plus a fake push service. state.push = status for the push service ('throw' throws); state.victim = prev_holder_id of the next claim.
function fakeNet(state) {
  return async (url, opt = {}) => {
    const u = String(url); state.calls.push({ url: u, body: opt.body });
    if (u.startsWith(PUSH_HOST)) { state.pushes.push({ url: u, headers: opt.headers, body: opt.body }); if (state.push === 'throw') throw new Error('push down'); return new Response('', { status: state.push || 201 }); }
    if (u.includes('/.well-known/jwks.json')) return json({ keys: state.jwks || [] });
    if (u.includes('/rest/v1/billboards')) { state.boardReads = (state.boardReads || 0) + 1; const m = /slot_id=eq\.(\w+)/.exec(u); return json((state.boards || []).filter((x) => !m || x.slot_id === m[1])); }
    if (u.includes('/rest/v1/plots')) return json([]);
    if (u.includes('/rest/v1/wallets')) return json([]);
    if (u.includes('/rpc/plaza_live')) return json({});
    if (u.includes('/rpc/push_subscribe')) return state.subFail ? json({ message: 'down' }, 500) : json({ ok: true });
    if (u.includes('/rpc/push_unsubscribe')) return json({ ok: true });
    if (u.includes('/rpc/push_drop')) { state.drops.push(JSON.parse(opt.body).p_endpoint); return json({ ok: true }); }
    if (u.includes('/rpc/inbox_batch')) return json({ ok: true });
    if (u.includes('/rpc/coin_batch')) return json({ ok: true, flushed: 0 });
    if (u.includes('/rpc/grant_coins')) { state.paid.push(JSON.parse(opt.body)); return json({ ok: true, coins: 1 }); }
    if (u.includes('/rpc/merge_guest_account')) return json({ ok: true, coins: 1, bonus: 0 });
    if (u.includes('/rpc/withdraw_account')) return json({ ok: true });
    if (u.includes('/rpc/claim_billboard')) { const a = JSON.parse(opt.body);
      return json({ ok: true, billboard: { slot_id: a.p_slot_id, holder_id: a.p_actor_id, holder_name: a.p_nickname, line1: a.p_line1 }, remaining_coins: 10, prev_holder_id: state.victim || null }); }
    return new Response('missing', { status: 404 });
  };
}
function harness(env) {
  const waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (path, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + path, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const guest = async () => { const t = (await (await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).token; return { token: t, id: 'guest:' + JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).s }; };
  const post = (path, body, token, ip = '1.1.1.1') => call(path, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const get = (path, token) => call(path, { headers: token ? { authorization: 'Bearer ' + token } : {} });
  const snap = (q, token) => call('/rt/snap' + q, { method: 'POST', headers: { 'content-type': 'image/jpeg', authorization: 'Bearer ' + token }, body: JPEG });
  const admin = (body) => call('/rt/admin/wish', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': 'admin-test-key-123' }, body: JSON.stringify(body) });
  return { call, guest, post, get, snap, admin };
}
const JPEG = (() => { const b = new Uint8Array(1200); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return b; })();
let clockBase = Date.parse('2027-03-01T03:00:00Z');
function freshClock() { clockBase += 10 * 864e5; let t = clockBase; const orig = Date.now; Date.now = () => t; return { add: (ms) => { t += ms; }, now: () => t, restore: () => { Date.now = orig; } }; }
function setup(extra = {}) {
  const clock = freshClock(), orig = globalThis.fetch, state = { calls: [], pushes: [], drops: [], paid: [], ...extra };
  globalThis.fetch = fakeNet(state); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  return { clock, state, done: () => { globalThis.fetch = orig; clock.restore(); } };
}
const hasActor = (s) => /guest:|user:/.test(String(s));
const metaOf = (html, attr, name) => { const m = new RegExp('<meta ' + attr + '="' + name + '" content="([^"]*)"').exec(html); return m ? m[1] : null; };

// RFC 8291 receiver side: a subscriber key pair + auth secret, and decryption of an aes128gcm body.
const te = new TextEncoder();
const b64 = (u8) => Buffer.from(u8).toString('base64url');
const cat = (...p) => { const o = new Uint8Array(p.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
async function hkdf(salt, ikm, info, len) { const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8)); }
async function subscriber() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)), auth = crypto.getRandomValues(new Uint8Array(16));
  return { priv: pair.privateKey, pub, auth, endpoint: PUSH_HOST + 'fcm/send/' + crypto.randomUUID(), sub() { return { endpoint: this.endpoint, keys: { p256dh: b64(this.pub), auth: b64(this.auth) } }; } };
}
async function decrypt(body, s) {
  const b = new Uint8Array(body), salt = b.slice(0, 16), idlen = b[20], asPub = b.slice(21, 21 + idlen), ct = b.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, s.priv, 256));
  const ikm = await hkdf(s.auth, shared, cat(te.encode('WebPush: info\0'), s.pub, asPub), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
  let end = pt.length - 1; while (end >= 0 && pt[end] === 0) end--; assert.equal(pt[end], 2, 'last record delimiter');
  return JSON.parse(new TextDecoder().decode(pt.slice(0, end)));
}
async function vapidPriv() { const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']); return JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)); }
const VAPID = await vapidPriv();
const CLAIM = (nick = '까마귀', slot = 'STREET_5') => ({ topic: 'chapel:square', slot_id: slot, bid: 300, line1: '내 자리', nickname: nick });
const pssRows = (env) => env.meter('push').sql.db.prepare('select uid, e from pss order by at').all();

describe('share pages', () => {
  // Boards are set after the guests exist, so a test can make the uploader the holder.
  const board = (slot, holder, name = '나', line1 = '줄') => ({ slot_id: slot, holder_id: holder, holder_name: name, line1 });
  it('upload keeps a slot / wish context only for the holder / author, and answers page next to url', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), { guest, snap, post } = harness(env), a = await guest(), b = await guest();
      state.boards = [board('STREET_5', a.id)];
      const w = (await (await post('/rt/wish', { text: '소원', nick: '가' }, a.token)).json()).wish;
      const r1 = await (await snap('?slot=STREET_5', a.token)).json();
      assert.equal(r1.ok, true); assert.match(r1.url, /^https:\/\/sq\.example\/rt\/snap\/[0-9a-f]{32}$/);
      const id1 = r1.url.slice(-32); assert.equal(r1.page, 'https://sq.example/rt/s/' + id1);
      const id2 = (await (await snap('?wish=' + w.id, a.token)).json()).url.slice(-32);
      // Not entitled: still uploaded, page still there, no context.
      for (const q of ['?slot=STREET_5', '?wish=' + w.id, '?wish=abcde12345', '?slot=STREET_6', '?slot=MAIN_S&wish=AB', '']) {
        const r = await (await snap(q, b.token)).json(); assert.equal(r.ok, true, q); assert.match(r.page, /\/rt\/s\/[0-9a-f]{32}$/);
      }
      const rows = env.meter('snaps').sql.db.prepare('select id, k, r, u from snx').all().map((x) => ({ ...x }));
      assert.deepEqual(rows.sort((x, y) => x.k.localeCompare(y.k)), [{ id: id1, k: 'slot', r: 'STREET_5', u: a.id }, { id: id2, k: 'wish', r: w.id, u: a.id }]);
      assert.equal((await snap('?slot=STREET_5', '')).status, 401);
    } finally { done(); }
  });

  it('slot page: escaped holder + first line, snapshot as og/twitter image, redirect to the slot', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), { guest, snap, get } = harness(env), a = await guest();
      state.boards = [board('STREET_9', a.id, '<script>alert(1)</script>"', '"><img src=x onerror=1>')];
      const id = (await (await snap('?slot=STREET_9', a.token)).json()).url.slice(-32);
      const res = await get('/rt/s/' + id), html = await res.text();
      assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'public, max-age=300'); assert.match(res.headers.get('content-type'), /text\/html/);
      assert.equal(metaOf(html, 'property', 'og:image'), 'https://sq.example/rt/snap/' + id);
      assert.equal(metaOf(html, 'name', 'twitter:image'), 'https://sq.example/rt/snap/' + id);
      assert.equal(metaOf(html, 'name', 'twitter:card'), 'summary_large_image');
      assert.equal(metaOf(html, 'property', 'og:title'), '&lt;script&gt;alert(1) &quot;&gt;&lt;img src=x one'); // both clipped to 16 like the card page
      assert.equal(html.includes('<script>alert'), false); assert.equal(html.includes('<img'), false);
      assert.match(html, /<meta http-equiv="refresh" content="0;url=\/\?focus=STREET_9">/);
      assert.match(html, /location\.replace\("\/\?focus=STREET_9"\)/);
      assert.equal((html.match(/<script>/g) || []).length, 1);
      assert.equal(hasActor(html), false);
    } finally { done(); }
  });

  it('slot page after a takeover: neutral copy, never the new holder name over the old shot', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), { guest, snap, get } = harness(env), a = await guest(), b = await guest();
      state.boards = [board('STREET_10', a.id, '앞주인', '앞 문구')];
      const id = (await (await snap('?slot=STREET_10', a.token)).json()).url.slice(-32);
      state.boards = [board('STREET_10', b.id, '새주인', '새 문구')]; clock.add(61000);
      const html = await (await get('/rt/s/' + id)).text();
      assert.equal(metaOf(html, 'property', 'og:title'), '타임스퀘어 전광판');
      assert.equal(metaOf(html, 'property', 'og:description'), slotName('STREET_10') + ' 전광판에서 찍었어요');
      assert.equal(html.includes('새주인'), false); assert.equal(html.includes('새 문구'), false);
      assert.match(html, /location\.replace\("\/\?focus=STREET_10"\)/);
    } finally { done(); }
  });

  it('wish page: wishShareText escaped, short cache, redirect; hidden wish gives generic copy and image, /', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), { guest, snap, get, post, admin } = harness(env), a = await guest();
      const w = (await (await post('/rt/wish', { text: '<script>x</script>"&', nick: '<b>나</b>' }, a.token)).json()).wish;
      const id = (await (await snap('?wish=' + w.id, a.token)).json()).url.slice(-32);
      const res = await get('/rt/s/' + id), html = await res.text();
      assert.equal(res.headers.get('cache-control'), 'public, max-age=30');
      assert.equal(metaOf(html, 'property', 'og:title'), '&lt;b&gt;나&lt;/b&gt;님의 소원');
      assert.equal(metaOf(html, 'property', 'og:description'), '&quot;&lt;script&gt;x&lt;/script&gt;&quot;&amp;&quot; — 하트 하나만 눌러 주세요');
      assert.equal(html.includes('<script>x'), false);
      assert.match(html, new RegExp('location\\.replace\\("/\\?wish=' + w.id + '"\\)'));
      assert.equal(metaOf(html, 'property', 'og:image'), 'https://sq.example/rt/snap/' + id);
      assert.equal(hasActor(html), false);
      // The wish page itself picks up the author's snapshot.
      const wp = await (await get('/rt/w/' + w.id)).text();
      assert.equal(metaOf(wp, 'property', 'og:image'), 'https://sq.example/rt/snap/' + id);
      await admin({ id: w.id, hide: true });
      const hr = await get('/rt/s/' + id), hid = await hr.text();
      assert.equal(hr.headers.get('cache-control'), 'public, max-age=30');
      assert.equal(metaOf(hid, 'property', 'og:title'), 'WISH BOARD : 모두의 전광판');
      assert.equal(metaOf(hid, 'property', 'og:image'), 'https://sq.example/og.jpg');
      assert.equal(metaOf(hid, 'name', 'twitter:image'), 'https://sq.example/og.jpg');
      assert.match(hid, /location\.replace\("\/"\)/);
    } finally { done(); }
  });

  it('no context: generic title and description, redirect to /; unknown or malformed id → 302 /', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), { guest, snap, get } = harness(env), a = await guest();
      const id = (await (await snap('', a.token)).json()).url.slice(-32);
      const html = await (await get('/rt/s/' + id)).text();
      assert.equal(metaOf(html, 'property', 'og:title'), 'WISH BOARD : 모두의 전광판');
      assert.equal(metaOf(html, 'property', 'og:description'), '생일 축하·응원·소원을 가상 타임스퀘어 전광판에 걸어 보세요!');
      assert.match(html, /content="0;url=\/"/);
      for (const bad of ['0'.repeat(32), 'zz', id + 'a', '%2E%2E%2Fsnap']) {
        const r = await get('/rt/s/' + bad); assert.equal(r.status, 302, bad); assert.equal(new URL(r.headers.get('location')).pathname, '/');
      }
    } finally { done(); }
  });

  it('a refused rate limit sends /rt/s to / before any snapshot or board lookup', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), { guest, snap, get } = harness(env), a = await guest();
      state.boards = [board('STREET_11', a.id)];
      const id = (await (await snap('?slot=STREET_11', a.token)).json()).url.slice(-32);
      const calls = spyMeter(env, 'snaps'), reads = state.boardReads || 0;
      env.EVENT_RL = { limit: async () => ({ success: false }) };
      const r = await get('/rt/s/' + id);
      assert.equal(r.status, 302); assert.equal(new URL(r.headers.get('location')).pathname, '/');
      assert.equal(calls.snapCtx || 0, 0); assert.equal(state.boardReads || 0, reads);
    } finally { done(); }
  });

  it('card page uses the newest snapshot of its current holder only', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), { guest, snap, get, post } = harness(env), a = await guest(), b = await guest(), c = await guest();
      state.boards = [board('STREET_12', a.id), board('STREET_14', b.id)];
      await snap('?slot=STREET_12', a.token);
      const id = (await (await snap('?slot=STREET_12', a.token)).json()).url.slice(-32);
      await snap('?slot=STREET_12', c.token); // not the holder: no context
      const card = await (await get('/rt/card/STREET_12')).text();
      assert.equal(metaOf(card, 'property', 'og:image'), 'https://sq.example/rt/snap/' + id);
      const other = await (await get('/rt/card/STREET_13')).text();
      assert.equal(metaOf(other, 'property', 'og:image'), 'https://studio.wishboard.workers.dev/og.jpg');
      // Somebody else's upload tagged STREET_14 does not reach b's card.
      await snap('?slot=STREET_14', a.token);
      assert.equal(metaOf(await (await get('/rt/card/STREET_14')).text(), 'property', 'og:image'), 'https://studio.wishboard.workers.dev/og.jpg');
      // The board is taken: the old holder's shot no longer previews the new holder's card.
      state.victim = a.id; state.boards = [board('STREET_12', b.id, '새주인', '새 줄')];
      assert.equal((await post('/rt/claim-billboard', { topic: 'chapel:square', slot_id: 'STREET_12', bid: 300, line1: '새 줄', nickname: '새주인' }, b.token)).status, 200);
      clock.add(61000);
      assert.equal(metaOf(await (await get('/rt/card/STREET_12')).text(), 'property', 'og:image'), 'https://studio.wishboard.workers.dev/og.jpg');
    } finally { done(); }
  });

  it('card pages and snapshot images say noindex (X-Robots-Tag) and keep their Open Graph tags; robots.txt still lets previews in', async () => {
    const { done, state } = setup();
    try {
      const env = makeEnv(), { guest, snap, get } = harness(env), a = await guest();
      state.boards = [board('STREET_16', a.id)];
      const url = (await (await snap('?slot=STREET_16', a.token)).json()).url, id = url.slice(-32);
      const card = await get('/rt/card/STREET_16');
      assert.equal(card.status, 200); assert.equal(card.headers.get('x-robots-tag'), 'noindex');
      const html = await card.text();
      assert.equal(metaOf(html, 'property', 'og:image'), 'https://sq.example/rt/snap/' + id);
      assert.ok(metaOf(html, 'property', 'og:title'));
      const img = await get('/rt/snap/' + id);
      assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/jpeg'); assert.equal(img.headers.get('x-robots-tag'), 'noindex');
      const robots = readFileSync(new URL('../robots.txt', import.meta.url), 'utf8').replace(/\r/g, '');
      for (const p of ['/rt/card/', '/rt/snap/']) assert.match(robots, new RegExp('^Allow: ' + p.replace(/\//g, '\\/') + '$', 'm'));
      assert.match(readFileSync(new URL('../worker.js', import.meta.url), 'utf8'), /'content-type': 'image\/png', 'cache-control': 'public, max-age=300', 'x-robots-tag': 'noindex'/);
    } finally { done(); }
  });

  it('wish page ignores snapshots tagged by anyone but the author', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), { guest, snap, get, post } = harness(env), a = await guest(), b = await guest();
      const w = (await (await post('/rt/wish', { text: '소원', nick: '가' }, a.token)).json()).wish;
      await snap('?wish=' + w.id, b.token);
      assert.equal(metaOf(await (await get('/rt/w/' + w.id)).text(), 'property', 'og:image'), 'https://sq.example/og.jpg');
      env.meter('snaps').do.snapPut('c'.repeat(32), JPEG, 'wish', w.id, b.id); // even a row stored for someone else is not used
      clock.add(61000);
      assert.equal(metaOf(await (await get('/rt/w/' + w.id)).text(), 'property', 'og:image'), 'https://sq.example/og.jpg');
    } finally { done(); }
  });

  it('snapshot context is pruned with the snapshot', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), m = env.meter('snaps').do;
      m.snapPut('a'.repeat(32), JPEG, 'slot', 'STREET_7', 'guest:a');
      assert.equal(m.snapFor('slot', 'STREET_7', 'guest:a'), 'a'.repeat(32));
      assert.equal(m.snapFor('slot', 'STREET_7', 'guest:b'), null);
      assert.deepEqual({ ...m.snapCtx('a'.repeat(32)) }, { k: 'slot', r: 'STREET_7', u: 'guest:a' });
      clock.add(8 * 864e5);
      m.snapPut('b'.repeat(32), JPEG, '', '', '');
      assert.equal(m.snapFor('slot', 'STREET_7', 'guest:a'), null);
      assert.equal(m.snapCtx('a'.repeat(32)), null);
      assert.deepEqual({ ...m.snapCtx('b'.repeat(32)) }, { k: '', r: '', u: '' });
      assert.equal(env.meter('snaps').sql.db.prepare('select count(*) n from snx').get().n, 0);
    } finally { done(); }
  });
});

// A push to `who`: a wish of theirs gets its first heart from another guest (the first-heart milestone pushes its author). Takeovers, the
// old trigger of these tests, are gone (no one's board is taken, so nobody is pushed "taken").
async function pushTo(H, who, ip = '7.7.7.7') {
  const wish = (await (await H.post('/rt/wish', { text: '합격 기원', nick: '가' }, who.token)).json()).wish;
  const g = await H.guest(); return H.post('/rt/wish/heart', { id: wish.id }, g.token, ip);
}
describe('immediate push', () => {
  it('a claim on a board whose time ran out pushes nobody: there are no takeovers to tell', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv({ VAPID_PRIV: VAPID }), { guest, post } = harness(env), v = await guest(), a = await guest(), s = await subscriber();
      const sub = await post('/rt/push', { s: s.sub() }, v.token);
      assert.equal(sub.status, 200); assert.deepEqual(await sub.json(), { ok: true });
      assert.deepEqual(pssRows(env).map((r) => ({ ...r })), [{ uid: v.id, e: s.endpoint }]);
      state.victim = v.id; // the RPC names the previous holder of a run-out board
      const res = await post('/rt/claim-billboard', CLAIM('새주인'), a.token);
      assert.equal(res.status, 200); assert.equal((await res.json()).ok, true);
      assert.equal(state.pushes.length, 0);
      // The push itself still works: encrypted { body, url } to the subscriber.
      const h = harness(env); await pushTo(h, v);
      assert.equal(state.pushes.length, 1);
      const p = state.pushes[0]; assert.equal(p.url, s.endpoint); assert.match(p.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
      assert.equal(p.headers['Content-Encoding'], 'aes128gcm');
      assert.equal((await decrypt(p.body, s)).body, '내 소원에 첫 하트가 왔어요');
    } finally { done(); }
  });

  it('no push without VAPID_PRIV or without a subscription; the subscription survives a failing push_subscribe', async () => {
    const { state, done } = setup({ subFail: true });
    try {
      const env = makeEnv(), H = harness(env), v = await H.guest(), s = await subscriber();
      const sub = await H.post('/rt/push', { s: s.sub() }, v.token);
      assert.equal(sub.status, 200); assert.equal((await sub.json()).ok, true);
      assert.equal((await pushTo(H, v)).status, 200);
      assert.equal(state.pushes.length, 0);
      const env2 = makeEnv({ VAPID_PRIV: VAPID }), h2 = harness(env2), v2 = await h2.guest();
      assert.equal((await pushTo(h2, v2)).status, 200);
      assert.equal(state.pushes.length, 0);
    } finally { done(); }
  });

  it('keeps 3 subscriptions per actor (oldest dropped), DELETE removes one, 410 removes it too', async () => {
    const { clock, state, done } = setup({ push: 410 });
    try {
      const env = makeEnv({ VAPID_PRIV: VAPID }), H = harness(env), { guest, post, call } = H, v = await guest();
      const subs = [];
      for (let i = 0; i < 4; i++) { const s = await subscriber(); subs.push(s); await post('/rt/push', { s: s.sub() }, v.token); clock.add(1000); }
      assert.deepEqual(pssRows(env).map((r) => r.e), subs.slice(1).map((s) => s.endpoint));
      const del = await call('/rt/push', { method: 'DELETE', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + v.token }, body: JSON.stringify({ e: subs[1].endpoint }) });
      assert.equal(del.status, 200);
      assert.deepEqual(pssRows(env).map((r) => r.e), subs.slice(2).map((s) => s.endpoint));
      assert.equal((await pushTo(H, v)).status, 200);
      assert.equal(state.pushes.length, 2);
      assert.deepEqual(pssRows(env), []);
      assert.deepEqual(state.drops.sort(), subs.slice(2).map((s) => s.endpoint).sort());
    } finally { done(); }
  });

  it('404 from the push service drops the subscription as well', async () => {
    const { state, done } = setup({ push: 404 });
    try {
      const env = makeEnv({ VAPID_PRIV: VAPID }), H = harness(env), v = await H.guest(), s = await subscriber();
      await H.post('/rt/push', { s: s.sub() }, v.token);
      await pushTo(H, v);
      assert.equal(state.pushes.length, 1); assert.deepEqual(pssRows(env), []); assert.deepEqual(state.drops, [s.endpoint]);
    } finally { done(); }
  });

  it('a full push store refuses new rows instead of evicting other actors', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv({ VAPID_PRIV: VAPID }), { guest, post } = harness(env), v = await guest(), s = await subscriber();
      await post('/rt/push', { s: s.sub() }, v.token); // the oldest row: must survive
      const db = env.meter('push').sql.db, ins = db.prepare('insert into pss(e, uid, p, a, at) values(?, ?, ?, ?, ?)');
      db.exec('BEGIN'); for (let i = 1; i < 50000; i++) ins.run(PUSH_HOST + 'fill/' + i, 'guest:fill-' + i, 'p', 'a', Date.now() + i); db.exec('COMMIT');
      const g = await guest(), t = await subscriber();
      const r = await post('/rt/push', { s: t.sub() }, g.token);
      assert.equal(r.status, 200); assert.equal((await r.json()).ok, true); // the Supabase copy landed
      const count = () => db.prepare('select count(*) n from pss').get().n;
      assert.equal(count(), 50000);
      assert.equal(db.prepare('select uid from pss where e = ?').get(s.endpoint).uid, v.id);
      assert.equal(db.prepare('select count(*) n from pss where uid = ?').get(g.id).n, 0);
      // Re-subscribing an endpoint already stored is an update, not a new row: still allowed.
      assert.equal((await post('/rt/push', { s: s.sub() }, v.token)).status, 200); assert.equal(count(), 50000);
      state.subFail = true;
      const r2 = await post('/rt/push', { s: t.sub() }, g.token);
      assert.equal(r2.status, 502); assert.equal((await r2.json()).ok, false);
    } finally { done(); }
  });

  it('push rows older than 60 days are pruned before the full check; a re-subscribe keeps a row fresh', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv({ VAPID_PRIV: VAPID }), { guest, post } = harness(env), v = await guest(), x = await guest(), s = await subscriber(), sx = await subscriber();
      await post('/rt/push', { s: s.sub() }, v.token); await post('/rt/push', { s: sx.sub() }, x.token);
      const db = env.meter('push').sql.db, ins = db.prepare('insert into pss(e, uid, p, a, at) values(?, ?, ?, ?, ?)'), old = clock.now() - 1;
      db.exec('BEGIN'); for (let i = 2; i < 50000; i++) ins.run(PUSH_HOST + 'fill/' + i, 'guest:fill-' + i, 'p', 'a', old); db.exec('COMMIT');
      const count = () => db.prepare('select count(*) n from pss').get().n; assert.equal(count(), 50000);
      const { call } = harness(env), renew = async (tok) => (await (await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: tok }) })).json()).token;
      clock.add(59 * 864e5);
      assert.equal((await post('/rt/push', { s: s.sub() }, await renew(v.token))).status, 200); // v's browser comes back: refreshed (an update, allowed while full)
      clock.add(2 * 864e5);
      const g = await guest(), t = await subscriber();
      assert.equal((await post('/rt/push', { s: t.sub() }, g.token)).status, 200);
      assert.deepEqual(pssRows(env).map((r) => r.uid).sort(), [g.id, v.id].sort()); // the fillers and x (61 days, never refreshed) are gone
      assert.equal(count(), 2);
    } finally { done(); }
  });

  it('a throwing or failing push service never changes the answer that triggered it', async () => {
    const { state, done } = setup({ push: 'throw' });
    try {
      const env = makeEnv({ VAPID_PRIV: VAPID }), H = harness(env), v = await H.guest(), s = await subscriber();
      await H.post('/rt/push', { s: s.sub() }, v.token);
      const res = await pushTo(H, v), body = await res.json();
      assert.equal(res.status, 200); assert.equal(body.hearts, 1);
      assert.equal(state.pushes.length, 1); assert.equal(pssRows(env).length, 1);
      const env2 = makeEnv({ VAPID_PRIV: '{not json' }), h2 = harness(env2), v2 = await h2.guest();
      await h2.post('/rt/push', { s: s.sub() }, v2.token);
      const r2 = await pushTo(h2, v2);
      assert.equal(r2.status, 200); assert.equal((await r2.json()).hearts, 1);
    } finally { done(); }
  });

  it('heart milestones notify the author at 1 and 3, not 2; responses never carry an actor id', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv({ VAPID_PRIV: VAPID }), { guest, post, get } = harness(env), w = await guest(), s = await subscriber();
      await post('/rt/push', { s: s.sub() }, w.token);
      const wish = (await (await post('/rt/wish', { text: '합격 기원', nick: '가' }, w.token)).json()).wish;
      const hearts = [];
      for (let i = 0; i < 3; i++) { const g = await guest(); const r = await post('/rt/wish/heart', { id: wish.id }, g.token, '9.9.9.' + i); const t = await r.text();
        assert.equal(hasActor(t), false, t); hearts.push(JSON.parse(t)); clock.add(11 * 60000); }
      assert.deepEqual(hearts.map((h) => h.hearts), [1, 2, 3]);
      assert.equal(state.pushes.length, 2);
      assert.deepEqual(await decrypt(state.pushes[0].body, s), { body: '내 소원에 첫 하트가 왔어요', url: '/?wish=' + wish.id });
      assert.deepEqual(await decrypt(state.pushes[1].body, s), { body: '내 소원이 하트 3개를 받았어요', url: '/?wish=' + wish.id });
      assert.equal(hasActor(await (await get('/rt/wishes')).text()), false);
      assert.equal(hasActor(await (await get('/rt/wishes?id=' + wish.id, w.token)).text()), false);
    } finally { done(); }
  });

  it('heart milestones inside the 10 minute gap are skipped', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv({ VAPID_PRIV: VAPID }), { guest, post } = harness(env), w = await guest(), s = await subscriber();
      await post('/rt/push', { s: s.sub() }, w.token);
      const wish = (await (await post('/rt/wish', { text: '합격 기원', nick: '가' }, w.token)).json()).wish;
      for (let i = 0; i < 3; i++) { const g = await guest(); await post('/rt/wish/heart', { id: wish.id }, g.token, '8.8.8.' + i); }
      assert.equal(state.pushes.length, 1);
    } finally { done(); }
  });

  it('a first place pays no wish prize and sends no notice (removed 2026-11-27)', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv({ VAPID_PRIV: VAPID }), { guest, post, get } = harness(env), w = await guest(), s = await subscriber();
      await post('/rt/push', { s: s.sub() }, w.token);
      const wish = (await (await post('/rt/wish', { text: '1등 하자', nick: '가' }, w.token)).json()).wish;
      for (let i = 0; i < 5; i++) { const g = await guest(); await post('/rt/wish/heart', { id: wish.id }, g.token, '7.7.7.' + (i % 3)); }
      state.pushes.length = 0; clock.add(864e5);
      await get('/rt/wishes');
      assert.deepEqual(state.paid, []);
      assert.equal(state.pushes.length, 0);
    } finally { done(); }
  });

  it('account merge moves the guest subscriptions to the user', async () => {
    const { clock, state, done } = setup();
    try {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      state.jwks = [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'share-push-kid' }];
      const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), head = enc({ alg: 'ES256', kid: 'share-push-kid' });
      const claims = enc({ sub: '99999999-2222-3333-4444-555555555555', exp: Math.floor(clock.now() / 1000) + 600, iss: 'https://yxddhpacuyaffaoutxjn.supabase.co/auth/v1', aud: 'authenticated' });
      const userToken = head + '.' + claims + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(head + '.' + claims))).toString('base64url');
      const env = makeEnv({ VAPID_PRIV: VAPID }), { guest, post } = harness(env), g = await guest(), a = await guest(), s = await subscriber();
      await post('/rt/push', { s: s.sub() }, g.token);
      // A shot of the guest's own board, taken before linking.
      state.boards = [{ slot_id: 'STREET_15', holder_id: g.id, holder_name: '나', line1: '줄' }];
      const shot = (await (await harness(env).snap('?slot=STREET_15', g.token)).json()).url.slice(-32);
      const m = await post('/rt/auth/merge', { guest_id: g.id, guest_token: g.token }, userToken);
      assert.equal(m.status, 200);
      const uid = 'user:99999999-2222-3333-4444-555555555555';
      assert.deepEqual(pssRows(env).map((r) => r.uid), [uid]);
      // merge_guest_account moved the board to the user: the shot follows it.
      assert.deepEqual(env.meter('snaps').sql.db.prepare('select u from snx where id = ?').all(shot).map((r) => r.u), [uid]);
      state.boards = [{ slot_id: 'STREET_15', holder_id: uid, holder_name: '나', line1: '줄' }]; clock.add(61000);
      const { get } = harness(env);
      assert.equal(metaOf(await (await get('/rt/card/STREET_15')).text(), 'property', 'og:image'), 'https://sq.example/rt/snap/' + shot);
      assert.equal(metaOf(await (await get('/rt/s/' + shot)).text(), 'property', 'og:title'), '나 줄');
      await pushTo(harness(env), { token: userToken, id: uid });
      assert.equal(state.pushes.length, 1); assert.equal(state.pushes[0].url, s.endpoint);
      void a;
    } finally { done(); }
  });
});

describe('service worker notifications', () => {
  function loadSw() {
    const handlers = {}, shown = [], opened = [], self = {
      location: { href: 'https://sq.example/sw.js?v=7', origin: 'https://sq.example' }, addEventListener: (k, f) => { handlers[k] = f; },
      registration: { showNotification: async (title, opt) => { shown.push({ title, ...opt }); } },
      clients: { list: [], async matchAll() { return this.list; }, async openWindow(u) { opened.push(u); } }, skipWaiting() {},
    };
    vm.runInNewContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), { self, URL, caches: {}, fetch: () => {} });
    const fire = async (k, ev) => { let p; handlers[k]({ ...ev, waitUntil(x) { p = x; } }); await p; };
    return { self, fire, shown, opened };
  }
  const data = (o) => ({ json: () => (typeof o === 'string' ? JSON.parse(o) : o), text: () => (typeof o === 'string' ? o : JSON.stringify(o)) });
  it('shows title (default) and body, keeps body-only payloads working', async () => {
    const sw = loadSw();
    await sw.fire('push', { data: data({ body: '하나' }) });
    await sw.fire('push', { data: data({ title: '제목', body: '둘', url: '/?wish=abcde12345' }) });
    await sw.fire('push', { data: data('not json') });
    assert.deepEqual(sw.shown.map((n) => [n.title, n.body, n.data.url]), [['모두의 전광판', '하나', '/'], ['제목', '둘', '/?wish=abcde12345'], ['모두의 전광판', 'not json', '/']]);
  });
  // An open game tab is told where to go (postMessage) and focused. It is never navigated: that would reboot the game.
  it('opens the payload url on click, same-origin only; an open game tab gets a message and focus, not a reload', async () => {
    const sw = loadSw();
    await sw.fire('notificationclick', { notification: { data: { url: '/?focus=STREET_5' }, close() {} } });
    await sw.fire('notificationclick', { notification: { data: { url: 'https://evil.example/x' }, close() {} } });
    await sw.fire('notificationclick', { notification: { close() {} } });
    assert.deepEqual(sw.opened, ['/?focus=STREET_5', '/', '/']);
    const nav = [], posted = []; let focused = 0;
    sw.self.clients.list = [{ url: 'https://sq.example/', async navigate(u) { nav.push(u); return this; }, postMessage(m) { posted.push(m); }, async focus() { focused++; return this; } }];
    await sw.fire('notificationclick', { notification: { data: { url: '/?wish=abcde12345' }, close() {} } });
    assert.deepEqual(posted.map((m) => [m.t, m.url]), [['push', '/?wish=abcde12345']]); assert.deepEqual(nav, []); assert.equal(focused, 1); assert.equal(sw.opened.length, 3);
    // A tab that cannot be reached falls back to a new window.
    sw.self.clients.list = [{ url: 'https://sq.example/', postMessage() { throw new Error('gone'); }, async focus() { focused++; return this; } }];
    await sw.fire('notificationclick', { notification: { data: { url: '/?focus=STREET_5' }, close() {} } });
    assert.equal(focused, 1); assert.deepEqual(sw.opened.at(-1), '/?focus=STREET_5');
  });
  it('a tab that got the message but could not be focused is not doubled by a new window', async () => {
    const sw = loadSw(), posted = [];
    const deaf = { url: 'https://sq.example/', postMessage() { throw new Error('gone'); }, async focus() { return this; } };
    const shy = { url: 'https://sq.example/index.html', postMessage(m) { posted.push(m.url); }, async focus() { throw new Error('not allowed to focus'); } };
    const next = { url: 'https://sq.example/', postMessage(m) { posted.push('second ' + m.url); }, async focus() { return this; } };
    sw.self.clients.list = [deaf, shy, next]; // the unreachable tab is skipped, the next one is told, and it ends there
    await sw.fire('notificationclick', { notification: { data: { url: '/?wish=abcde12345' }, close() {} } });
    assert.deepEqual(posted, ['/?wish=abcde12345']); assert.deepEqual(sw.opened, []);
  });
  it('protocol-relative, backslash, javascript: and external urls all open /', async () => {
    const sw = loadSw(), bad = ['//evil.com', '/\\evil.com', 'javascript:alert(1)', 'https://evil.example/x', '\\\\evil.com/x'];
    for (const url of bad) await sw.fire('push', { data: data({ body: 'x', url }) });
    assert.deepEqual(sw.shown.map((n) => n.data.url), bad.map(() => '/'));
    for (const url of bad) await sw.fire('notificationclick', { notification: { data: { url }, close() {} } });
    assert.deepEqual(sw.opened, bad.map(() => '/'));
  });
  it('never takes over an admin or other non-game tab', async () => {
    const sw = loadSw(), nav = [];
    const tab = (url) => ({ url, async navigate(u) { nav.push(u); return this; }, postMessage(m) { nav.push(m.url); }, async focus() { return this; } });
    sw.self.clients.list = [tab('https://sq.example/admin.html'), tab('https://sq.example/rt/s/' + 'a'.repeat(32))];
    await sw.fire('notificationclick', { notification: { data: { url: '/?focus=STREET_5' }, close() {} } });
    assert.deepEqual(nav, []); assert.deepEqual(sw.opened, ['/?focus=STREET_5']);
    sw.self.clients.list.push(tab('https://sq.example/index.html?q=low'));
    await sw.fire('notificationclick', { notification: { data: { url: '/?wish=abcde12345' }, close() {} } });
    assert.deepEqual(nav, ['/?wish=abcde12345']); assert.equal(sw.opened.length, 1);
  });
});

describe('wish review fixes', () => {
  it('migrates wish tables made by the earlier build (no et/ed on wsh, no ip on wrp)', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), sql = sqliteStorage();
      sql.db.exec('create table wsh(id text primary key, day text not null, uid text not null, nick text, txt text, at integer, hearts integer not null default 0, rep integer not null default 0, hid integer not null default 0, unique(day, uid))');
      sql.db.exec('create table wrp(wid text, uid text, primary key(wid, uid))');
      const m = new Meter(makeCtx(sql), env), day = wishDay(clock.now()), t0 = clock.now();
      const w = m.wPost('guest:a', '가', '첫 소원', day, t0); assert.equal(w.ok, true);
      assert.equal(m.wPost('guest:a', '가', '고친 소원', day, t0 + 31000).ok, true);
      assert.deepEqual({ ...m.wReport('guest:b', w.wish.id, 'ip1') }, { ok: true, hidden: false });
    } finally { done(); }
  });

  it('an edit or a throttled fresh post does not drop the cached world', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), { guest, post, get } = harness(env), a = await guest(), b = await guest(), c = await guest();
      await post('/rt/wish', { text: '첫 소원', nick: '가' }, a.token);
      clock.add(31000); await get('/rt/world'); const reads = state.boardReads;
      clock.add(1000); assert.equal((await (await post('/rt/wish', { text: '고친 첫 소원', nick: '가' }, a.token)).json()).fresh, false); // edit
      await get('/rt/world'); assert.equal(state.boardReads, reads);
      clock.add(1000); await post('/rt/wish', { text: '둘째', nick: '나' }, b.token); // fresh: one refill
      assert.equal(state.boardReads, reads + 1);
      clock.add(1000); await post('/rt/wish', { text: '셋째', nick: '다' }, c.token); // within 10 s of that refill: throttled
      await get('/rt/world'); assert.equal(state.boardReads, reads + 1);
    } finally { done(); }
  });

  it('a single-wish cache miss is rate limited: share page goes to /, the list leaves out focus', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), { guest, post, get } = harness(env), a = await guest();
      const w = (await (await post('/rt/wish', { text: '소원', nick: '가' }, a.token)).json()).wish;
      const calls = spyMeter(env, 'wish');
      env.EVENT_RL = { limit: async () => ({ success: false }) };
      const page = await get('/rt/w/zzzzzzzzz1'); assert.equal(page.status, 302); assert.equal(new URL(page.headers.get('location')).pathname, '/');
      const list = await (await get('/rt/wishes?id=zzzzzzzzz2')).json(); assert.equal('focus' in list, false); assert.ok(Array.isArray(list.top));
      assert.equal(calls.wOne || 0, 0);
      env.EVENT_RL = { limit: async () => ({ success: true }) };
      assert.equal((await get('/rt/w/' + w.id)).status, 200); assert.equal(calls.wOne, 1);
    } finally { done(); }
  });

  it('a settlement that throws is retried by the same isolate later that day', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), { get } = harness(env), calls = spyMeter(env, 'wish', new Set(['wSettle']));
      await get('/rt/wishes'); assert.equal(calls.wSettle, 1);
      clock.add(30000); await get('/rt/wishes'); assert.equal(calls.wSettle, 1);
      clock.add(31000); await get('/rt/wishes'); assert.equal(calls.wSettle, 2);
      clock.add(61000); await get('/rt/wishes'); assert.equal(calls.wSettle, 2);
    } finally { done(); }
  });

  it('stores the normalised nick and checks staff names without spaces', async () => {
    const { done } = setup();
    try {
      assert.equal(wishNickFault('운 영 자'), 'nick'); assert.equal(wishNickFault('a d m i n'), 'nick');
      const env = makeEnv(), { guest, post } = harness(env), a = await guest(), b = await guest();
      assert.equal((await (await post('/rt/wish', { text: '소원', nick: '운 영 자' }, a.token)).json()).code, 'nick');
      const w = (await (await post('/rt/wish', { text: '소원', nick: 'a‮b​c  d' }, b.token)).json()).wish;
      assert.equal(w.nick, 'abc d');
    } finally { done(); }
  });

  it('the soon copy is true for a first post and for an edit', () => {
    assert.doesNotMatch(WISH_ERR.soon, /^방금 고쳤어요/); assert.match(WISH_ERR.soon, /30초/);
  });
});

// A Supabase user token the Worker accepts (JWKS from the fake net).
async function userToken(state, clock, sub) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  state.jwks = [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'share-push-kid' }];
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), head = enc({ alg: 'ES256', kid: 'share-push-kid' });
  const claims = enc({ sub, exp: Math.floor(clock.now() / 1000) + 600, iss: 'https://yxddhpacuyaffaoutxjn.supabase.co/auth/v1', aud: 'authenticated' });
  return { token: head + '.' + claims + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(head + '.' + claims))).toString('base64url'), id: 'user:' + sub };
}

describe('account withdrawal and merge carry the wish, push and snapshot data', () => {
  it('withdrawal deletes push rows, hides and anonymises wishes, drops hearts and reports, unlinks shots (also for a linked guest)', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv({ VAPID_PRIV: VAPID }), { guest, post, get, snap } = harness(env), o = await guest(), g = await guest(), s = await subscriber(), sg = await subscriber();
      const u = await userToken(state, clock, '11111111-2222-3333-4444-555555555555'), db = (n) => env.meter(n).sql.db;
      await post('/rt/push', { s: s.sub() }, u.token); await post('/rt/push', { s: sg.sub() }, g.token);
      const w = (await (await post('/rt/wish', { text: '탈퇴할 소원', nick: '떠날이' }, u.token)).json()).wish;
      const ow = (await (await post('/rt/wish', { text: '남의 소원', nick: '남' }, o.token)).json()).wish;
      const gw = (await (await post('/rt/wish', { text: '게스트 때 소원', nick: '옛날' }, g.token)).json()).wish;
      await post('/rt/wish/heart', { id: ow.id }, u.token); await post('/rt/wish/report', { id: ow.id }, u.token);
      await post('/rt/wish/heart', { id: w.id }, o.token, '9.9.9.9'); // a heart push: a psg row for the user
      const shot = (await (await snap('?wish=' + w.id, u.token)).json()).url.slice(-32);
      const gshot = (await (await snap('?wish=' + gw.id, g.token)).json()).url.slice(-32), oshot = (await (await snap('?wish=' + ow.id, o.token)).json()).url.slice(-32);
      assert.equal((await get('/rt/s/' + shot)).status, 200); // primes the snapshot context cache
      await env.meter('ev').do.evAlias(g.id, u.id); // linked earlier, from a build that left the guest's data behind
      assert.equal((await get('/rt/w/' + w.id)).status, 200); // primes this isolate's caches
      assert.equal(db('push').prepare('select count(*) n from psg where uid = ?').get(u.id).n, 1);
      const r = await post('/rt/auth/withdraw', {}, u.token);
      assert.equal(r.status, 200);
      assert.equal(db('push').prepare('select count(*) n from pss where uid in (?, ?)').get(u.id, g.id).n, 0);
      assert.equal(db('push').prepare('select count(*) n from psg where uid in (?, ?)').get(u.id, g.id).n, 0);
      const unsubs = state.calls.filter((c) => c.url.includes('/rpc/push_unsubscribe')).map((c) => JSON.parse(c.body)).map((b) => [b.p_actor_id, b.p_endpoint]);
      assert.deepEqual(unsubs.sort(), [[g.id, sg.endpoint], [u.id, s.endpoint]].sort());
      for (const t of ['wsh', 'wht', 'wrp']) assert.equal(db('wish').prepare(`select count(*) n from ${t} where uid in (?, ?)`).get(u.id, g.id).n, 0, t);
      assert.equal(db('wish').prepare("select count(*) n from wsh where txt in ('탈퇴할 소원', '게스트 때 소원') or nick in ('떠날이', '옛날')").get().n, 0);
      assert.equal(db('snaps').prepare('select count(*) n from snx where id = ?').get(shot).n, 0);
      assert.equal(db('snaps').prepare('select count(*) n from snap where id in (?, ?)').get(shot, gshot).n, 0);
      assert.equal(db('snaps').prepare('select count(*) n from snap where id = ?').get(oshot).n, 1); // someone else's shot stays
      assert.equal((await get('/rt/snap/' + shot)).status, 404); assert.equal((await get('/rt/snap/' + gshot)).status, 404); assert.equal((await get('/rt/snap/' + oshot)).status, 200);
      assert.equal((await get('/rt/w/' + w.id)).status, 302); assert.equal((await get('/rt/w/' + gw.id)).status, 302);
      const list = await (await get('/rt/wishes')).json();
      assert.deepEqual(list.top.map((x) => [x.id, x.hearts]), [[ow.id, 0]]);
      assert.equal((await get('/rt/s/' + shot)).status, 302); // the context cache was cleared with the shot
      assert.equal(hasActor(JSON.stringify(list)), false);
    } finally { done(); }
  });

  it('merge moves the guest wish, hearts and stored winner entry to the user; nothing is paid', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), { guest, post, get } = harness(env), g = await guest(), o = await guest();
      const u = await userToken(state, clock, '22222222-2222-3333-4444-555555555555'), m = env.meter('wish').do, day = wishDay(clock.now()), y = wishDay(clock.now() - 864e5);
      const yw = m.wPost(g.id, 'G', '어제 일등', y, 1).wish; for (let i = 0; i < 6; i++) m.wHeart('guest:f' + i, yw.id, 'ip' + (i % 3), y);
      const gw = m.wPost(g.id, 'G', '게스트 소원', day, clock.now()).wish, ow = m.wPost(o.id, 'O', '남의 소원', day, clock.now()).wish;
      m.wHeart(g.id, ow.id, 'ip', day);
      assert.equal((await post('/rt/auth/merge', { guest_id: g.id, guest_token: g.token }, u.token)).status, 200);
      const l = await (await get('/rt/wishes', u.token)).json();
      assert.equal(l.mine.id, gw.id); assert.equal(l.mine.mine, true); assert.deepEqual(l.given, [ow.id]); assert.equal(l.left, 4);
      assert.deepEqual(state.paid, []); assert.deepEqual(l.yesterday.map((x) => [x.rank, x.mine]), [[1, true]]);
      clock.add(31000);
      const again = await (await post('/rt/wish', { text: '고친 소원', nick: 'G' }, u.token)).json();
      assert.equal(again.ok, true); assert.equal(again.fresh, false); assert.equal(again.wish.id, gw.id);
    } finally { done(); }
  });

  it('snapshot upload re-reads the board when the cached holder is not the uploader', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), { guest, snap, get } = harness(env), a = await guest(), b = await guest(), c = await guest();
      const board = (holder) => ({ slot_id: 'STREET_20', holder_id: holder, holder_name: '나', line1: '줄' });
      state.boards = [board(b.id)]; await get('/rt/world'); // this isolate's copy: b holds it
      state.boards = [board(a.id)]; // a claimed it just now
      let reads = state.boardReads;
      const id = (await (await snap('?slot=STREET_20', a.token)).json()).url.slice(-32);
      assert.equal(state.boardReads, reads + 1);
      assert.deepEqual({ ...env.meter('snaps').sql.db.prepare('select k, r, u from snx where id = ?').get(id) }, { k: 'slot', r: 'STREET_20', u: a.id });
      state.boards = [board(b.id)]; reads = state.boardReads;
      await snap('?slot=STREET_20', b.token); assert.equal(state.boardReads, reads); // cached holder is the uploader: no extra read
      await snap('?slot=STREET_20', c.token); assert.equal(state.boardReads, reads + 1); // not the holder either way: one read, no context
      assert.equal(env.meter('snaps').sql.db.prepare('select count(*) n from snx where u = ?').get(c.id).n, 0);
    } finally { done(); }
  });
});
