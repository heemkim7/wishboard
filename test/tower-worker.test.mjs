// 메인 타워 축하 1분 on the Worker (giftsrv.js through worker.js): friends' reactions per network, the share reward (towerrules.js SHARE steps; share-friends.test.mjs has the rest), 💖 before
// the day, the human check on 💖 (theart); then bookings, the points path before and after the migration, refunds, /rt/world and the
// rooms' TOWER push. The helpers are gift-worker.test.mjs's (lines 4-128) but fakeNet, which writes down the RPC calls.
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: new URL('./cf-stub.mjs', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});
globalThis.WebSocketRequestResponsePair = class { constructor(req, res) { this.req = req; this.res = res; } };
const { Meter, Room } = await import('../worker.js');
const worker = (await import('../worker.js')).default;
const { GIFT, REPLY_MSG, kstDay, addDays, botAgent } = await import('../giftrules.js');
const { giftSeenFlush, giftSeenState, giftApi, vidKey } = await import('../giftsrv.js');

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
  return { storage: { sql, async getAlarm() { return null; }, async setAlarm() {}, async deleteAlarm() {}, transactionSync(fn) { return fn(); } }, setWebSocketAutoResponse() {}, getWebSockets() { return []; }, getWebSocketAutoResponseTimestamp() { return new Date(); }, acceptWebSocket() {} };
}
const stub = (obj) => new Proxy(obj, { get: (t, k) => k === 'fetch' ? (req) => t.fetch(req) : typeof t[k] === 'function' ? async (...a) => structuredClone(await t[k](...structuredClone(a))) : t[k] });
const SHELL = fs.readFileSync(new URL('../gift.html', import.meta.url), 'utf8');
function fakeR2() {
  const m = new Map(), deleted = [];
  return { m, deleted,
    async put(k, v, o) { m.set(k, { u8: new Uint8Array(v), ct: o?.httpMetadata?.contentType }); },
    async head(k) { const x = m.get(k); return x ? { size: x.u8.length, httpMetadata: { contentType: x.ct }, httpEtag: '"e1"' } : null; },
    async get(k, o) { const x = m.get(k); if (!x) return null; const r = o?.range; const part = r ? x.u8.slice(r.offset, r.offset + r.length) : x.u8; return { size: x.u8.length, body: new Blob([part]).stream() }; },
    async delete(keys) { for (const k of [].concat(keys)) { deleted.push(k); m.delete(k); } },
  };
}
function makeEnv(extra = {}) {
  const meters = new Map(), rooms = new Map();
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ADMIN_KEY: 'admin-test-key-123', ASSETS: { fetch: (req) => new Response(new URL(req.url).pathname === '/gift' ? SHELL : 'asset', { status: 200 }) }, ...extra };
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new Meter(makeCtx(sql), env) }); } return meters.get(name); };
  env.room = (topic) => { if (!rooms.has(topic)) { const sql = sqliteStorage(); rooms.set(topic, { sql, do: new Room(makeCtx(sql), env) }); } return rooms.get(topic); };
  env.METER = { idFromName: (name) => name, get: (name) => stub(env.meter(name).do) };
  env.ROOM = { idFromName: (topic) => topic, get: (topic) => stub(env.room(topic).do) };
  return env;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const PUSH_HOST = 'https://fcm.googleapis.com/';
const { TOWER } = await import('../towerrules.js');
const { HOLD_MS } = await import('../giftsrv.js');
const SITE = '0x4AAAAAAAtowerSITEkey', SECRET = 'tower-secret';
// RPC calls are written down; spend_plaza, grant_coins and siteverify answer from the test's state.
function fakeNet(state) {
  state.rpc = []; state.verify = state.verify || ((b) => ({ success: b.response === 'good', action: state.action || 'theart' }));
  return async (url, opt = {}) => {
    const u = String(url); state.calls.push(u);
    if (u.startsWith(PUSH_HOST)) { state.pushes.push({ url: u, body: opt.body }); return new Response('', { status: 201 }); }
    if (u.startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) return json(state.verify(JSON.parse(opt.body || '{}')));
    if (u.includes('/.well-known/jwks.json')) return json({ keys: state.jwks || [] });
    if (u.includes('/rest/v1/rpc/')) {
      const name = u.split('/rpc/')[1], body = JSON.parse(opt.body || '{}'); state.rpc.push({ name, ...body });
      if (name === 'spend_plaza') return json(state.spend ? state.spend(body) : { ok: false, error: '그 금액은 쓸 수 없어요.' });
      if (name === 'grant_coins') return json(state.grant ? state.grant(body) : { ok: true, coins: 1000 });
      if (name === 'merge_guest_account') return json({ ok: true, coins: 1, bonus: 0 });
      return json({ ok: true });
    }
    if (u.includes('/rest/v1/')) return json([]);
    return new Response('missing', { status: 404 });
  };
}
const grants = (state, uid) => state.rpc.filter((r) => r.name === 'grant_coins' && (!uid || r.p_actor_id === uid));
const NET = (i) => '10.0.' + Math.floor(i / 250) + '.' + (1 + (i % 250)); // a different IPv4 network per i
function harness(env) {
  const waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (p, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + p, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const guest = async (ip = '1.1.1.1') => { const t = (await (await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: '{}' })).json()).token; return { token: t, id: 'guest:' + JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).s }; };
  const post = (p, body, token, ip = '1.1.1.1', h = {}) => call(p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(token ? { authorization: 'Bearer ' + token } : {}), ...h }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const get = (p, token, h = {}) => call(p, { headers: { 'cf-connecting-ip': '1.1.1.1', ...(token ? { authorization: 'Bearer ' + token } : {}), ...h } });
  const admin = (p, body) => call(p, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': env.ADMIN_KEY }, body: JSON.stringify(body) } : { headers: { 'x-admin-key': env.ADMIN_KEY } });
  return { call, guest, post, get, admin, ctx };
}
let clockBase = Date.parse('2027-05-01T03:00:00Z'); // 12:00 KST
function setup() {
  clockBase += 60 * 864e5; let t = clockBase; const orig = Date.now; Date.now = () => t;
  const prevFetch = globalThis.fetch, state = { calls: [], pushes: [] };
  globalThis.fetch = fakeNet(state); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  return { clock: { add: (ms) => { t += ms; }, now: () => t }, state, done: () => { globalThis.fetch = prevFetch; Date.now = orig; } };
}
async function userToken(state, clock, sub) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  state.jwks = [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'gift-kid' }];
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), head = enc({ alg: 'ES256', kid: 'gift-kid' });
  const claims = enc({ sub, exp: Math.floor(clock.now() / 1000) + 3600, iss: 'https://yxddhpacuyaffaoutxjn.supabase.co/auth/v1', aud: 'authenticated' });
  return { token: head + '.' + claims + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(head + '.' + claims))).toString('base64url'), id: 'user:' + sub };
}
const today = () => kstDay(Date.now());
const FORM = (o = {}) => ({ to: '민지', from: '친구들', occ: 'bday', msg: '생일 축하해!', day: today(), at: 'now', ...o });
const db = (env) => env.meter('gift').sql.db;
const VIS = (n) => String(n).padStart(16, 'a');
const MP4 = () => { const u8 = new Uint8Array(30000); u8.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]); return u8; };
const JPEG = () => { const u8 = new Uint8Array(5000); u8[0] = 0xff; u8[1] = 0xd8; return u8; };
// The gift DO's methods as the Worker calls them, in order (a write refused at the hard level must add none).
function spyGift(env) {
  const calls = [], real = env.METER.get;
  env.METER.get = (n) => { const m = real(n); return n !== 'gift' ? m : new Proxy(m, { get: (t, k) => (typeof t[k] === 'function' ? (...a) => { calls.push(k); return t[k](...a); } : t[k]) }); };
  return calls;
}
const dayCounts = (env) => Object.fromEntries(db(env).prepare('select k, n from gd where d = ?').all(today()).map((x) => [x.k, x.n]));
// Web push as a browser receives it (RFC 8291, aes128gcm): a subscriber key pair and auth secret, and the decrypted { body, url }.
const te = new TextEncoder(), b64 = (u8) => Buffer.from(u8).toString('base64url');
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
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
  let end = pt.length - 1; while (end >= 0 && pt[end] === 0) end--; assert.equal(pt[end], 2, 'last record delimiter');
  return JSON.parse(new TextDecoder().decode(pt.slice(0, end)));
}
const VAPID = JSON.stringify(await crypto.subtle.exportKey('jwk', (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])).privateKey));

const heart = (H, id, i, ip, ts) => H.post('/rt/gift/' + id + '/heart', { v: VIS(i), ...(ts ? { ts } : {}) }, null, ip);
const drain = async (env, H) => { await giftSeenFlush(env, H.ctx); };

describe('friends on a gift board page', { concurrency: false }, () => {
  it('a 💖 before the day is kept (the count still hidden) and counts one network once; the maker\'s network never', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1');
      const r = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 2), at: 9 }), A.token, '1.1.1.1')).json();
      await heart(H, r.id, 1, '1.1.1.1'); await heart(H, r.id, 2, '2.2.2.2'); await heart(H, r.id, 3, '2.2.2.2'); await drain(env, H);
      assert.equal(db(env).prepare('select hr from gb where id = ?').get(r.id).hr, 3, 'every device\'s heart is kept before the day');
      assert.equal('hearts' in (await (await H.get('/rt/gift/' + r.id)).json()).gift, false, 'not shown before the reveal');
      assert.deepEqual(db(env).prepare('select count(*) n from gn where g = ?').get(r.id).n, 1, 'one network (2.2.2.2); the maker\'s network is not a friend');
    } finally { done(); }
  });
  it('Turnstile on: only a checked 💖 counts as a friend (an unchecked one is still a heart); a 2 KB token fits', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1');
      const r = await (await H.post('/rt/gift', FORM(), A.token, '1.1.1.1')).json();
      // switched on after the guest and the board were made (humanSite reads env on every request; the tallied env inherits it)
      env.TURNSTILE_SITE = SITE; env.TURNSTILE_SECRET = SECRET;
      assert.ok((await (await H.get('/g/' + r.id)).text()).includes('"site":"' + SITE + '"'), 'the page data carries the public site key');
      assert.equal((await heart(H, r.id, 1, '3.3.3.3')).status, 200, 'no token: still a heart');
      state.verify = (b) => ({ success: b.response.startsWith('good'), action: 'theart' });
      assert.equal((await heart(H, r.id, 2, '4.4.4.4', 'good'.padEnd(2048, 'x'))).status, 200, 'the body takes a whole token');
      assert.equal((await heart(H, r.id, 3, '5.5.5.5', 'good')).status, 200);
      assert.equal((await heart(H, r.id, 4, '6.6.6.6', 'bad')).status, 200, 'a refused token: still a heart');
      await drain(env, H);
      assert.equal(db(env).prepare('select hr from gb where id = ?').get(r.id).hr, 4);
      assert.deepEqual(db(env).prepare('select net from gn where g = ?').all(r.id).length, 2, 'the two checked ones (4.4.4.4, 5.5.5.5)');
    } finally { done(); }
  });
  it('a 롤링페이퍼 line from another network counts; the maker\'s own line from another network does not', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), B = await H.guest('6.6.6.6');
      const r = await (await H.post('/rt/gift', FORM(), A.token, '1.1.1.1')).json();
      assert.equal((await H.post('/rt/gift/' + r.id + '/paper', { nick: '친구', txt: '축하해!' }, B.token, '6.6.6.6')).status, 200);
      assert.equal((await H.post('/rt/gift/' + r.id + '/paper', { nick: '나', txt: '내가 씀' }, A.token, '7.7.7.7')).status, 200);
      assert.equal(db(env).prepare('select count(*) n from gn where g = ?').get(r.id).n, 1);
    } finally { done(); }
  });
});

describe('the share reward', { concurrency: false }, () => {
  it('the maker (a guest id too) is paid per friend: a 💖 sent without an account token is a guest friend (+10); the next day pays again', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1');
      const r = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 12 }), A.token, '1.1.1.1')).json();
      for (let i = 0; i < 6; i++) await heart(H, r.id, i + 1, NET(i));
      await drain(env, H);
      assert.deepEqual(grants(state, A.id).map((g) => g.p_amount), [10, 10, 10, 10, 10, 10]);
      assert.equal(db(env).prepare('select sum(paid) n from gn where g = ?').get(r.id).n, 6);
      clock.add(864e5);
      await heart(H, r.id, 99, NET(50)); await drain(env, H);
      assert.equal(grants(state, A.id).length, 7, 'a new day');
    } finally { done(); }
  });
  it('a grant that fails (no wallet yet) is undone: that friend pays nothing, the day keeps its room', async () => {
    const { state, done } = setup();
    try {
      state.grant = () => ({ ok: false, error: '그 지갑을 찾지 못했습니다.' });
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1');
      const r = await (await H.post('/rt/gift', FORM(), A.token, '1.1.1.1')).json();
      await heart(H, r.id, 1, NET(1)); await drain(env, H);
      assert.equal(db(env).prepare('select paid from gn where g = ?').get(r.id).paid, 0);
      assert.deepEqual(db(env).prepare('select amt, st from sf where uid = ?').all(A.id).map((x) => [x.amt, x.st]), [[0, 'fail']], 'unpaid; its place goes to the next friend');
      delete state.grant; await heart(H, r.id, 2, NET(2)); await drain(env, H);
      assert.equal(grants(state, A.id).length, 2, 'the next friend is paid');
      assert.equal(db(env).prepare('select sum(paid) n from gn where g = ?').get(r.id).n, 1);
    } finally { done(); }
  });
  it('the 10th friend sends the maker one push (not advertising), once per board', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv({ VAPID_PRIV: VAPID }), H = harness(env), A = await H.guest('1.1.1.1'), s = await subscriber();
      assert.equal((await H.post('/rt/push', { s: s.sub() }, A.token, '1.1.1.1')).status, 200, 'the maker has web push on'); // as gift-worker.test.mjs's reply notice test
      const r = await (await H.post('/rt/gift', FORM(), A.token, '1.1.1.1')).json();
      for (let i = 0; i < 11; i++) await heart(H, r.id, i + 1, NET(i));
      await drain(env, H);
      const got = await Promise.all(state.pushes.map((p) => decrypt(p.body, s)));
      assert.deepEqual(got.map((x) => [x.body, x.url]), [['친구 응원 10곳이 모였어요. 메인 타워 1분을 고르세요', '/g/' + r.id + '?o=1']]);
    } finally { done(); }
  });
  it('one beacon batch hands at most TOWER.payMax rewards to the Worker; the rest stay friends, unpaid', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), ids = [];
      for (const ip of ['1.1.1.1', '1.1.1.2', '1.1.1.3']) { const M = await H.guest(ip); ids.push((await (await H.post('/rt/gift', FORM({ to: '친구' + ip.slice(-1) }), M.token, ip)).json()).id); }
      for (const [b, id] of ids.entries()) for (let i = 0; i < 5; i++) await heart(H, id, 100 * b + i + 1, NET(i));
      await drain(env, H);
      assert.equal(grants(state).length, TOWER.payMax, 'three makers, five friends each: ' + TOWER.payMax + ' rewards in one batch');
      assert.equal(db(env).prepare('select count(*) n from gn').get().n, 15);
      assert.equal(db(env).prepare('select sum(paid) n from gn').get().n, TOWER.payMax);
    } finally { done(); }
  });
  it('at budget hard a 💖 is 503 and nobody is paid', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1');
      const r = await (await H.post('/rt/gift', FORM(), A.token, '1.1.1.1')).json();
      env.BUDGET_REQ_DAY = '1'; clock.add(61000);
      assert.equal((await heart(H, r.id, 1, NET(1))).status, 503);
      delete env.BUDGET_REQ_DAY; clock.add(61000); await drain(env, H);
      assert.equal(grants(state).length, 0);
    } finally { done(); }
  });
});

const KMIN = (day, hm) => Date.parse(day + 'T' + hm + ':00+09:00');
// A board 18:00-24:00 (tomorrow unless form.day says) by A on A.ip (default 1.1.1.1), with n friends' hearts (Turnstile off: every heart
// is a person). netBase keeps the friends of two boards on different networks.
async function boardWithFriends(H, env, A, n, { netBase = 0, ...form } = {}) {
  const r = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 18, ...form }), A.token, A.ip || '1.1.1.1')).json();
  for (let i = 0; i < n; i++) await heart(H, r.id, 500 + netBase + i, NET(100 + netBase + i));
  await drain(env, H);
  return r;
}
const book = (H, id, body, token, ip = '1.1.1.1') => H.post('/rt/gift/' + id + '/tower', body, token, ip);
const towerOf = async (H, id, token) => (await H.get('/rt/gift/' + id + '/tower', token)).json();
// What the rooms were sent: [[room, body]] (the tallied env reaches env.ROOM.get on each call, so a swapped get sees giftsrv's pushes).
function roomSpy(env) { const told = [], real = env.ROOM.get; env.ROOM.get = (n) => { const s = real(n); return { fetch: async (req) => { try { told.push([n, JSON.parse(await req.clone().text())]); } catch { /* no body */ } return s.fetch(req); } }; }; return told; }
const towerTold = (told) => told.filter(([n, b]) => n === 'chapel:square' && b?.kind === 'TOWER').map(([, b]) => b.data); // one base's room (each push goes to both)
const PROBE_OK = (more) => (b) => (b.p_actor_id === 'probe:tower' ? { ok: false, error: '지갑을 찾지 못했습니다.' } : more(b));
// A board revealed now: today, "지금" (12:00 KST, setup's clock), its window 12:00-18:00.
const NOWM = () => KMIN(today(), '14:30');

describe('booking a main tower minute', { concurrency: false }, () => {
  it('the owner\'s read: places left, friends, taken minutes; nobody else', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), B = await H.guest('2.2.2.2');
      const r = await boardWithFriends(H, env, A, 3);
      assert.equal((await H.get('/rt/gift/' + r.id + '/tower')).status, 401);
      assert.equal((await H.get('/rt/gift/' + r.id + '/tower', B.token)).status, 403);
      const t = await towerOf(H, r.id, A.token);
      assert.deepEqual([t.friends, t.need, t.tw, t.guest, t.days[addDays(today(), 1)].left], [3, 10, null, true, 30]);
    } finally { done(); }
  });
  it('friends: refused under 10, booked at 10; the minute, the board and the maker\'s day are each taken once', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), day = addDays(today(), 1), m = KMIN(day, '20:30');
      const r = await boardWithFriends(H, env, A, 9);
      let res = await book(H, r.id, { m, how: 'friends' }, A.token); assert.equal(res.status, 409); assert.equal((await res.json()).code, 'friends');
      await heart(H, r.id, 900, NET(900)); await drain(env, H);
      res = await book(H, r.id, { m, how: 'friends' }, A.token); assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
      assert.deepEqual((await res.json()).tw, { m, how: 'friends' });
      assert.equal((await (await H.get('/rt/gift/' + r.id)).json()).gift.tw, m, 'the public read has the minute');
      assert.equal(JSON.stringify(await (await H.get('/rt/gift/' + r.id)).json()).includes('friends'), false, 'never how');
      assert.deepEqual((await (await H.get('/rt/gift/' + r.id, A.token)).json()).mine.tw, { m, how: 'friends' }, 'the owner read has how');
      assert.equal((await (await book(H, r.id, { m: m + 60000, how: 'friends' }, A.token)).json()).code, 'board');
      const r2 = await boardWithFriends(H, env, A, 10, { to: '둘째', netBase: 200 });
      assert.equal((await (await book(H, r2.id, { m: m + 60000, how: 'friends' }, A.token)).json()).code, 'day', 'one a day per maker');
      const C = await H.guest('3.3.3.3'); C.ip = '3.3.3.3';
      const r3 = await boardWithFriends(H, env, C, 10, { to: '셋째', netBase: 400 });
      const busy = await book(H, r3.id, { m, how: 'friends' }, C.token, '3.3.3.3'), b = await busy.json();
      assert.equal(busy.status, 409); assert.equal(b.code, 'taken'); assert.deepEqual(b.taken, [m]);
      assert.equal((await (await book(H, r3.id, { m: KMIN(day, '21:15'), how: 'friends' }, C.token, '3.3.3.3')).json()).code, 'minute');
      assert.equal((await (await book(H, r3.id, { m: KMIN(day, '22:00'), how: 'friends' }, C.token, '3.3.3.3')).json()).code, 'minute');
    } finally { done(); }
  });
  it('two at once for one minute: exactly one gets it', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), C = await H.guest('3.3.3.3'); C.ip = '3.3.3.3';
      const ra = await boardWithFriends(H, env, A, 10), rc = await boardWithFriends(H, env, C, 10, { to: '다른', netBase: 300 });
      const m = KMIN(addDays(today(), 1), '20:31');
      const codes = (await Promise.all([book(H, ra.id, { m, how: 'friends' }, A.token), book(H, rc.id, { m, how: 'friends' }, C.token, '3.3.3.3')])).map((x) => x.status).sort();
      assert.deepEqual(codes, [200, 409]);
    } finally { done(); }
  });
  it('the 31st of a day is refused (sold)', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), day = addDays(today(), 1);
      const r = await boardWithFriends(H, env, A, 10);
      for (let i = 0; i < 30; i++) db(env).prepare('insert into gt(m, day, g, how, uid, at) values(?, ?, ?, ?, ?, ?)').run(KMIN(day, '19:' + String(1 + i).padStart(2, '0')), day, 'zz' + String(i).padStart(6, '0'), 'friends', 'guest:x' + i, 1);
      const res = await book(H, r.id, { m: KMIN(day, '20:30'), how: 'friends' }, A.token);
      assert.equal(res.status, 409); assert.equal((await res.json()).code, 'sold');
      assert.equal((await towerOf(H, r.id, A.token)).days[day].left, 0);
    } finally { done(); }
  });
});

describe('the points path before and after the migration', { concurrency: false }, () => {
  it('before: the read says prep (one probe per isolate per 10 minutes), a press is 503 prep and spends nothing; after: 2,000 once', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), U = await userToken(state, clock, 'tower-1'), day = addDays(today(), 1), m = KMIN(day, '20:30');
      const r = await (await H.post('/rt/gift', FORM({ day, at: 18 }), U.token)).json();
      const t = await towerOf(H, r.id, U.token);
      assert.deepEqual([t.guest, t.prep], [false, true]);
      const probes = state.rpc.filter((x) => x.name === 'spend_plaza'); assert.equal(probes.length, 1); assert.equal(probes[0].p_actor_id, 'probe:tower'); assert.equal(probes[0].p_coins, 2000);
      const res = await book(H, r.id, { m, how: 'points' }, U.token);
      assert.equal(res.status, 503); assert.equal((await res.json()).code, 'prep');
      assert.equal(db(env).prepare('select count(*) n from gt').get().n, 0);
      assert.equal(state.rpc.filter((x) => x.name === 'spend_plaza' && x.p_actor_id === U.id).length, 0, 'nothing spent while it is known to be off');
      state.spend = (b) => (b.p_actor_id === 'probe:tower' ? { ok: false, error: '지갑을 찾지 못했습니다.' } : { ok: true, remaining_coins: 3000 });
      clock.add(600001);
      assert.equal((await towerOf(H, r.id, U.token)).prep, false);
      const ok = await book(H, r.id, { m, how: 'points' }, U.token), o = await ok.json();
      assert.equal(ok.status, 200, JSON.stringify(o)); assert.equal(o.coins, 3000);
      assert.deepEqual(state.rpc.filter((x) => x.name === 'spend_plaza' && x.p_actor_id === U.id).map((x) => [x.p_coins, x.p_tickets]), [[2000, 0]]);
    } finally { done(); }
  });
  it('a guest is refused (account); Turnstile on needs a tower token; too few points spends nothing', async () => {
    const { state, clock, done } = setup();
    try {
      state.spend = (b) => (b.p_actor_id === 'probe:tower' ? { ok: false, error: '지갑을 찾지 못했습니다.' } : { ok: false, error: '코인이 부족해요.' });
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), U = await userToken(state, clock, 'tower-2');
      const day = addDays(today(), 1), m = KMIN(day, '20:30');
      const ra = await (await H.post('/rt/gift', FORM({ day, at: 18 }), A.token)).json();
      const ru = await (await H.post('/rt/gift', FORM({ day, at: 18, to: '계정' }), U.token, '2.2.2.2')).json();
      env.TURNSTILE_SITE = SITE; env.TURNSTILE_SECRET = SECRET; // on from here
      assert.equal((await (await book(H, ra.id, { m, how: 'points' }, A.token)).json()).code, 'account');
      assert.equal((await book(H, ru.id, { m, how: 'points' }, U.token, '2.2.2.2')).status, 403, 'no token: human');
      state.action = 'tower';
      const poor = await book(H, ru.id, { m, how: 'points', ts: 'good' }, U.token, '2.2.2.2'), p = await poor.json();
      assert.equal(poor.status, 400); assert.equal(p.code, 'poor'); assert.match(p.error, /포인트가 부족해요/); assert.equal(/코인/.test(p.error), false);
      assert.equal(db(env).prepare('select count(*) n from gt').get().n, 0);
    } finally { done(); }
  });
  it('the hold lapsed while spending and someone else took the minute: the 2,000 comes back and the answer is 409 with the fresh list', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), U = await userToken(state, clock, 'tower-3'), day = addDays(today(), 1), m = KMIN(day, '20:30');
      const r = await (await H.post('/rt/gift', FORM({ day, at: 18 }), U.token)).json();
      state.spend = PROBE_OK(() => { clock.add(HOLD_MS + 1000); db(env).prepare('delete from gt where m = ? and hold > 0').run(m); db(env).prepare('insert into gt(m, day, g, how, uid, at) values(?, ?, ?, ?, ?, ?)').run(m, day, 'other123', 'friends', 'guest:o', 1); return { ok: true, remaining_coins: 1 }; });
      const res = await book(H, r.id, { m, how: 'points' }, U.token), b = await res.json();
      assert.equal(res.status, 409); assert.equal(b.code, 'taken'); assert.deepEqual(b.taken, [m]);
      assert.deepEqual(grants(state, U.id).map((x) => x.p_amount), [2000]);
      assert.equal(db(env).prepare('select count(*) n from ga').get().n, 0);
    } finally { done(); }
  });
  it('while spend_plaza runs the minute is held for this account: it counts in the day and nobody else can take it; then it is booked', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), U = await userToken(state, clock, 'tower-3b'), day = addDays(today(), 1), m = KMIN(day, '20:30');
      const r = await (await H.post('/rt/gift', FORM({ day, at: 18 }), U.token)).json();
      const seen = [];
      state.spend = PROBE_OK(() => { const row = db(env).prepare('select hold, uid from gt where m = ?').get(m); seen.push(row.hold > Date.now() && row.uid === U.id); return { ok: true, remaining_coins: 5 }; });
      assert.equal((await book(H, r.id, { m, how: 'points' }, U.token)).status, 200);
      assert.deepEqual(seen, [true]);
      assert.equal(db(env).prepare('select hold from gt where m = ?').get(m).hold, 0, 'booked');
      // a second account's board in the same hours sees the minute taken
      const C = await H.guest('3.3.3.3'); C.ip = '3.3.3.3';
      const rc = await boardWithFriends(H, env, C, 10, { to: '다른', netBase: 300 });
      assert.equal((await (await book(H, rc.id, { m, how: 'friends' }, C.token, '3.3.3.3')).json()).code, 'taken');
    } finally { done(); }
  });
  it('nothing spent (too few points) lets the hold go at once; a spend with no answer books anyway and pays nothing back', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), U = await userToken(state, clock, 'tower-3c'), day = addDays(today(), 1), m = KMIN(day, '20:30');
      const r = await (await H.post('/rt/gift', FORM({ day, at: 18 }), U.token)).json();
      state.spend = PROBE_OK(() => ({ ok: false, error: '코인이 부족해요.' }));
      assert.equal((await book(H, r.id, { m, how: 'points' }, U.token)).status, 400);
      assert.equal(db(env).prepare('select count(*) n from gt').get().n, 0, 'the hold went with the refusal');
      state.spend = PROBE_OK(() => { throw new Error('connection lost'); });
      const res = await book(H, r.id, { m, how: 'points' }, U.token);
      assert.equal(res.status, 200, 'it may have been spent: booked, never left spent and unbooked');
      assert.equal(db(env).prepare('select hold from gt where m = ?').get(m).hold, 0);
      assert.equal(grants(state, U.id).length, 0, 'and never paid back blind');
    } finally { done(); }
  });
  it('the booking call fails after it wrote: the owner read says booked, nothing is paid back; it fails before: 2,000 back, 503', async () => {
    const { state, clock, done } = setup();
    try {
      state.spend = PROBE_OK(() => ({ ok: true, remaining_coins: 7 }));
      const env = makeEnv(), H = harness(env), U = await userToken(state, clock, 'tower-3d'), d1 = addDays(today(), 1);
      const r1 = await (await H.post('/rt/gift', FORM({ day: d1, at: 18 }), U.token)).json();
      let mode = 'after'; const real = env.METER.get;
      env.METER.get = (n) => { const x = real(n); return n !== 'gift' ? x : new Proxy(x, { get: (t, k) => (k === 'giftTowerConfirm' ? async (...a) => { if (mode === 'after') await t[k](...a); mode = ''; throw new Error('lost'); } : t[k]) }); };
      assert.equal((await book(H, r1.id, { m: KMIN(d1, '20:30'), how: 'points' }, U.token)).status, 200);
      assert.equal(grants(state, U.id).length, 0);
      mode = 'before'; clock.add(31 * 864e5); // past the 30 days, so the second points booking is allowed
      const U2 = await userToken(state, clock, 'tower-3d'), r3 = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 18 }), U2.token)).json();
      const res = await book(H, r3.id, { m: KMIN(addDays(today(), 1), '20:30'), how: 'points' }, U2.token);
      assert.equal(res.status, 503);
      assert.deepEqual(grants(state, U.id).map((x) => x.p_amount), [2000]);
    } finally { done(); }
  });
  it('points once in 30 days per account', async () => {
    const { state, clock, done } = setup();
    try {
      state.spend = (b) => (b.p_actor_id === 'probe:tower' ? { ok: false, error: '지갑을 찾지 못했습니다.' } : { ok: true, remaining_coins: 9000 });
      const env = makeEnv(), H = harness(env); let U = await userToken(state, clock, 'tower-4');
      const r1 = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 18 }), U.token)).json();
      assert.equal((await book(H, r1.id, { m: KMIN(addDays(today(), 1), '20:30'), how: 'points' }, U.token)).status, 200);
      clock.add(10 * 864e5); U = await userToken(state, clock, 'tower-4'); // the same account, a token of the new day
      const r2 = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 18 }), U.token)).json();
      assert.equal((await (await book(H, r2.id, { m: KMIN(addDays(today(), 1), '20:30'), how: 'points' }, U.token)).json()).code, 'gap');
      clock.add(21 * 864e5); U = await userToken(state, clock, 'tower-4');
      const r3 = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 18 }), U.token)).json();
      assert.equal((await book(H, r3.id, { m: KMIN(addDays(today(), 1), '20:30'), how: 'points' }, U.token)).status, 200);
    } finally { done(); }
  });
});

describe('a booking lets go', { concurrency: false }, () => {
  it('reports hide the board: the minute is free again, points come back, the rooms are told (the board was revealed)', async () => {
    const { state, clock, done } = setup();
    try {
      state.spend = PROBE_OK(() => ({ ok: true, remaining_coins: 9000 }));
      const env = makeEnv(), H = harness(env), U = await userToken(state, clock, 'tower-5'), m = NOWM();
      const r = await (await H.post('/rt/gift', FORM(), U.token)).json();
      assert.equal((await book(H, r.id, { m, how: 'points' }, U.token)).status, 200);
      const told = roomSpy(env);
      for (const ip of ['7.7.7.1', '7.7.8.1', '7.7.9.1']) await H.post('/rt/gift/' + r.id + '/report', {}, null, ip);
      assert.equal(db(env).prepare('select count(*) n from gt').get().n, 0);
      assert.equal(db(env).prepare('select count(*) n from ga').get().n, 0, 'the 30 days and the day are given back');
      assert.deepEqual(grants(state, U.id).map((x) => x.p_amount), [2000]);
      assert.deepEqual(towerTold(told), [{ id: r.id, m, off: 1 }]);
    } finally { done(); }
  });
  it('hidden or deleted during its own minute: the rooms drop it, nothing comes back, the aired minute still counts in its day', async () => {
    const { state, clock, done } = setup();
    try {
      state.spend = PROBE_OK(() => ({ ok: true, remaining_coins: 9000 }));
      const env = makeEnv(), H = harness(env), U = await userToken(state, clock, 'tower-5b'), m = NOWM(), m2 = KMIN(today(), '15:30');
      const r = await (await H.post('/rt/gift', FORM(), U.token)).json();
      assert.equal((await book(H, r.id, { m, how: 'points' }, U.token)).status, 200);
      const A = await H.guest('2.2.2.2'); A.ip = '2.2.2.2';
      const ra = await boardWithFriends(H, env, A, 10, { day: today(), at: 'now', to: '둘째', netBase: 600 });
      assert.equal((await book(H, ra.id, { m: m2, how: 'friends' }, A.token, '2.2.2.2')).status, 200);
      const told = roomSpy(env);
      clock.add(m - Date.now() + 10000); // 14:30:10, on the tower now
      assert.equal((await H.admin('/rt/admin/gift/hide', { id: r.id })).status, 200);
      assert.deepEqual(towerTold(told), [{ id: r.id, m, off: 1 }]);
      assert.equal(grants(state, U.id).length, 0, 'a minute that started keeps its points');
      clock.add(m2 - Date.now() + 10000);
      const A2 = A; assert.equal((await H.post('/rt/gift/' + ra.id + '/delete', {}, A2.token, '2.2.2.2')).status, 200);
      assert.deepEqual(towerTold(told).at(-1), { id: ra.id, m: m2, off: 1 });
      assert.equal(db(env).prepare('select count(*) n from gt where day = ?').get(today()).n, 2, 'both aired minutes still count in the day\'s 30');
      // once the day is over and the boards are gone, prune lets them go
      clock.add(864e5); const B = await H.guest('4.4.4.4'); await H.post('/rt/gift', FORM(), B.token, '4.4.4.4');
      assert.equal(db(env).prepare('select count(*) n from gt where g = ?').get(ra.id).n, 0);
    } finally { done(); }
  });
  it('the owner\'s delete and the admin\'s hide let go the same way and give the 30 days back; a minute that started keeps its points', async () => {
    const { state, clock, done } = setup();
    try {
      state.spend = (b) => (b.p_actor_id === 'probe:tower' ? { ok: false, error: '지갑을 찾지 못했습니다.' } : { ok: true, remaining_coins: 9000 });
      const env = makeEnv(), H = harness(env), U = await userToken(state, clock, 'tower-6'), d1 = addDays(today(), 1), d2 = addDays(today(), 2);
      const r1 = await (await H.post('/rt/gift', FORM({ day: d1, at: 18 }), U.token)).json();
      assert.equal((await book(H, r1.id, { m: KMIN(d1, '20:30'), how: 'points' }, U.token)).status, 200);
      assert.equal((await H.post('/rt/gift/' + r1.id + '/delete', {}, U.token)).status, 200);
      assert.deepEqual(grants(state, U.id).map((x) => x.p_amount), [2000]);
      assert.equal(db(env).prepare("select count(*) n from ga where how = 'points'").get().n, 0, 'the 30 days are given back');
      const r2 = await (await H.post('/rt/gift', FORM({ day: d2, at: 18 }), U.token)).json();
      assert.equal((await book(H, r2.id, { m: KMIN(d2, '20:30'), how: 'points' }, U.token)).status, 200, 'so points can be used again at once');
      assert.equal((await H.admin('/rt/admin/gift/hide', { id: r2.id })).status, 200);
      assert.deepEqual(grants(state, U.id).map((x) => x.p_amount), [2000, 2000]);
      const r3 = await (await H.post('/rt/gift', FORM({ day: today(), at: 18 }), U.token)).json(), m3 = KMIN(today(), '18:30');
      assert.equal((await book(H, r3.id, { m: m3, how: 'points' }, U.token)).status, 200);
      clock.add(m3 - Date.now() + 1000); // the minute has started
      for (const ip of ['7.7.7.1', '7.7.8.1', '7.7.9.1']) await H.post('/rt/gift/' + r3.id + '/report', {}, null, ip);
      assert.equal(grants(state, U.id).length, 2, 'nothing back for a minute that started');
    } finally { done(); }
  });
  it('a withdrawal deletes the bookings and the maker\'s record without paying back; an account link moves them', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), G = await H.guest('1.1.1.1'), U = await userToken(state, clock, 'aaaaaaaa-2222-3333-4444-555555555555');
      const r = await boardWithFriends(H, env, G, 10);
      assert.equal((await book(H, r.id, { m: KMIN(addDays(today(), 1), '20:30'), how: 'friends' }, G.token)).status, 200);
      assert.equal((await H.post('/rt/auth/merge', { guest_id: G.id, guest_token: G.token }, U.token)).status, 200);
      assert.deepEqual([db(env).prepare('select uid from gt').get().uid, db(env).prepare('select uid from ga').get().uid], [U.id, U.id]);
      assert.equal((await H.post('/rt/auth/withdraw', {}, U.token)).status, 200);
      assert.deepEqual([db(env).prepare('select count(*) n from gt').get().n, db(env).prepare('select count(*) n from ga').get().n], [0, 0]);
      assert.equal(grants(state, U.id).filter((x) => x.p_amount === 2000).length, 0);
    } finally { done(); }
  });
  it('a withdrawal tells the rooms to drop its revealed minutes; an aired minute stays in the day\'s count with no account on it', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), U = await userToken(state, clock, 'bbbbbbbb-2222-3333-4444-555555555555'); U.ip = '1.1.1.1';
      const r = await boardWithFriends(H, env, U, 10, { day: today(), at: 'now' }), m = NOWM();
      const r2 = await boardWithFriends(H, env, U, 10, { day: today(), at: 'now', to: '둘째', netBase: 700 });
      assert.equal((await book(H, r.id, { m, how: 'friends' }, U.token)).status, 200);
      db(env).prepare('insert into gt(m, day, g, how, uid, at) values(?, ?, ?, ?, ?, ?)').run(Date.now() - 120000, today(), r2.id, 'friends', U.id, 1); // one that aired two minutes ago
      const told = roomSpy(env);
      assert.equal((await H.post('/rt/auth/withdraw', {}, U.token)).status, 200);
      assert.deepEqual(towerTold(told), [{ id: r.id, m, off: 1 }]);
      assert.deepEqual(db(env).prepare('select g, uid from gt').all().map((x) => [x.g, x.uid]), [[r2.id, '']], 'the aired one keeps its place in the day, not the account');
    } finally { done(); }
  });
  it('an account link keeps both accounts\' records of a day, so a points booking\'s 30 days survive it', () => {
    const env = makeEnv(), M = env.meter('gift').do, q = db(env);
    M.giftI();
    q.prepare('insert into ga(uid, day, how, at, g) values(?, ?, ?, ?, ?)').run('user:from', '2027-01-01', 'points', 5, 'aaaa1111');
    q.prepare('insert into ga(uid, day, how, at, g) values(?, ?, ?, ?, ?)').run('user:to', '2027-01-01', 'friends', 6, 'bbbb2222');
    M.giftMove('user:from', 'user:to');
    assert.deepEqual(q.prepare('select uid, how from ga order by g').all().map((x) => [x.uid, x.how]), [['user:to', 'points'], ['user:to', 'friends']]);
  });
  it('at budget hard: a booking is 503 busy with no gift DO call; the read answers from the copy with hard: true', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1');
      const r = await boardWithFriends(H, env, A, 10);
      await H.get('/rt/gift/' + r.id); // the board is in this isolate's copy
      env.BUDGET_REQ_DAY = '1'; clock.add(61000);
      const calls = spyGift(env);
      const res = await book(H, r.id, { m: KMIN(addDays(today(), 1), '20:30'), how: 'friends' }, A.token);
      assert.equal(res.status, 503); assert.equal((await res.json()).code, 'busy');
      const t = await towerOf(H, r.id, A.token);
      assert.equal(t.hard, true);
      assert.deepEqual(calls, []);
    } finally { done(); }
  });
});

describe('the plaza learns of a booking', { concurrency: false }, () => {
  it('/rt/world carries tower (next 26 h) only once the board is revealed, with the board\'s words only; none: no key; a hidden board is left out', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), m = KMIN(today(), '20:30'); // today: within the 26 hours
      let w = await (await H.get('/rt/world')).json(); assert.equal('tower' in w, false);
      const r = await boardWithFriends(H, env, A, 10, { day: today() }); // 18:00-24:00: revealed at its lighting, 18:00
      assert.equal((await book(H, r.id, { m, how: 'friends' }, A.token)).status, 200);
      clock.add(121000);
      w = await (await H.get('/rt/world')).json(); assert.equal('tower' in w, false, 'not before the reveal: nobody but the owner learns of the board');
      clock.add(KMIN(today(), '18:00') - Date.now() + 20000); // 18:00:20: the copy is read again at the reveal, not 2 minutes later
      w = await (await H.get('/rt/world')).json();
      assert.deepEqual(w.tower.map((e) => [e.id, e.m]), [[r.id, m]]);
      assert.deepEqual(Object.keys(w.tower[0]).sort(), ['from', 'id', 'm', 'msg', 'occ', 'th', 'to']);
      await H.admin('/rt/admin/gift/hide', { id: r.id }); clock.add(121000);
      w = await (await H.get('/rt/world')).json(); assert.equal('tower' in w, false);
    } finally { done(); }
  });
  it('a booking on a revealed board goes to the rooms as WORLD_UPDATE TOWER at once; a room takes TOWER and refuses a bad one', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), m = NOWM();
      const r = await boardWithFriends(H, env, A, 10, { day: today(), at: 'now' });
      const told = roomSpy(env);
      assert.equal((await book(H, r.id, { m, how: 'friends' }, A.token)).status, 200);
      assert.ok(told.some(([n, b]) => n === 'chapel:square' && b.kind === 'TOWER'));
      assert.deepEqual(towerTold(told), [{ id: r.id, m, to: '민지', from: '친구들', occ: 'bday', msg: '생일 축하해!', th: 'party' }]);
      const room = env.room('chapel:square').do, post = (data) => room.fetch(new Request('https://room.internal/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: 'WORLD_UPDATE', kind: 'TOWER', data }) }));
      assert.equal((await post({ id: 'x', m })).status, 400);
      assert.equal((await post({ id: r.id, m, off: 1 })).status, 200);
    } finally { done(); }
  });
  it('PRIVACY: a board not revealed yet is never pushed at booking nor dropped by name; the dark alarm tells the rooms at its reveal', async () => {
    const { state, clock, done } = setup();
    try {
      state.spend = PROBE_OK(() => ({ ok: true, remaining_coins: 9000 }));
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), day = addDays(today(), 1), m = KMIN(day, '20:30');
      const r = await boardWithFriends(H, env, A, 10); // tomorrow 18:00-24:00, revealed at 18:00 tomorrow
      const told = roomSpy(env);
      assert.equal((await book(H, r.id, { m, how: 'friends' }, A.token)).status, 200);
      assert.deepEqual(towerTold(told), [], 'nothing about the board reaches the rooms before its reveal');
      const dark = env.meter('dark');
      assert.deepEqual(dark.sql.db.prepare('select g, m, at from dtw').all().map((x) => [x.g, x.m, x.at]), [[r.id, m, KMIN(day, '18:00')]], 'only its id and minute wait in the dark instance');
      await dark.do.alarm(); assert.deepEqual(towerTold(told), [], 'not due yet');
      clock.add(KMIN(day, '18:00') - Date.now() + 1000);
      await dark.do.alarm();
      assert.deepEqual(towerTold(told), [{ id: r.id, m, to: '민지', from: '친구들', occ: 'bday', msg: '생일 축하해!', th: 'party' }]);
      assert.equal(dark.sql.db.prepare('select count(*) n from dtw').get().n, 0, 'told once');
      // a points booking on a board not yet revealed, then reported: points back, the rooms hear nothing (they never knew of it)
      const U = await userToken(state, clock, 'tower-priv'), d3 = addDays(today(), 2), m3 = KMIN(d3, '20:30');
      const ru = await (await H.post('/rt/gift', FORM({ day: d3, at: 18, to: '셋째' }), U.token, '5.5.5.5')).json();
      assert.equal((await book(H, ru.id, { m: m3, how: 'points' }, U.token, '5.5.5.5')).status, 200);
      for (const ip of ['7.7.7.1', '7.7.8.1', '7.7.9.1']) await H.post('/rt/gift/' + ru.id + '/report', {}, null, ip);
      assert.deepEqual(grants(state, U.id).map((x) => x.p_amount), [2000]);
      assert.equal(towerTold(told).some((d) => d.id === ru.id), false);
      clock.add(KMIN(d3, '18:00') - Date.now() + 1000); await dark.do.alarm();
      assert.equal(towerTold(told).some((d) => d.id === ru.id), false, 'a released booking is not told at its reveal either');
    } finally { done(); }
  });
  it('at budget hard the admin hide still lets go and pays back (in waitUntil), but no room is told', async () => {
    const { state, clock, done } = setup();
    try {
      state.spend = (b) => (b.p_actor_id === 'probe:tower' ? { ok: false, error: '지갑을 찾지 못했습니다.' } : { ok: true, remaining_coins: 9000 });
      const env = makeEnv(), H = harness(env), U = await userToken(state, clock, 'tower-7'), day = addDays(today(), 1);
      const r = await (await H.post('/rt/gift', FORM({ day, at: 18 }), U.token)).json();
      assert.equal((await book(H, r.id, { m: KMIN(day, '20:30'), how: 'points' }, U.token)).status, 200);
      const told = []; const real = env.ROOM.get; env.ROOM.get = (n) => { const s = real(n); return { fetch: async (req) => { told.push(await req.clone().text()); return s.fetch(req); } }; };
      env.BUDGET_REQ_DAY = '1'; clock.add(61000);
      assert.equal((await H.admin('/rt/admin/gift/hide', { id: r.id })).status, 200);
      assert.deepEqual(grants(state, U.id).map((x) => x.p_amount), [2000]);
      assert.equal(db(env).prepare('select count(*) n from gt').get().n, 0);
      assert.equal(told.filter((t) => t.includes('"TOWER"')).length, 0);
    } finally { done(); }
  });
  it('schema.sql and the migration take 2,000 and keep the refusal words; giftsrv.js knows the words', () => {
    const sql = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'), mig = fs.readFileSync(new URL('../migrations/2026-11-27-tower-minute.sql', import.meta.url), 'utf8');
    for (const s of [sql, mig]) { assert.match(s, /\(p_coins = 2000 AND p_tickets = 0\)/); assert.match(s, /'그 금액은 쓸 수 없어요\.'/); assert.match(s, /\(p_coins = 30 AND p_tickets = 0\)/); assert.match(s, /\(p_coins = 5000 AND p_tickets = 0\)/); }
    assert.match(mig, /GRANT EXECUTE ON FUNCTION public\.spend_plaza\(TEXT, TEXT, INT, INT\) TO anon, authenticated, service_role;/);
    const src = fs.readFileSync(new URL('../giftsrv.js', import.meta.url), 'utf8');
    assert.match(src, /SPEND_OLD/, 'the Worker knows the database before the migration');
  });
  it('a refund grant_coins does not take leaves a row for the operator: in the admin gift view only, marked paid there', async () => {
    const { state, clock, done } = setup();
    try {
      state.spend = PROBE_OK(() => ({ ok: true, remaining_coins: 9000 }));
      const env = makeEnv(), H = harness(env), U = await userToken(state, clock, 'tower-8'), day = addDays(today(), 1), m = KMIN(day, '20:30');
      const r = await (await H.post('/rt/gift', FORM({ day, at: 18 }), U.token)).json();
      assert.equal((await book(H, r.id, { m, how: 'points' }, U.token)).status, 200);
      state.grant = () => ({ ok: false, error: '그 지갑을 찾지 못했습니다.' });
      assert.equal((await H.post('/rt/gift/' + r.id + '/delete', {}, U.token)).status, 200);
      const list = await (await H.admin('/rt/admin/gift')).json();
      assert.deepEqual(list.refunds.map((x) => [x.uid, x.m, x.g, x.why, x.amount, x.done]), [[U.id, m, r.id, 'off', 2000, 0]]);
      assert.equal((await H.get('/rt/admin/gift')).status, 401, 'never without the operator\'s key');
      assert.equal(JSON.stringify(await (await H.get('/rt/world')).json()).includes(U.id), false);
      assert.equal((await H.admin('/rt/admin/gift/refund', { k: list.refunds[0].k })).status, 200);
      assert.equal((await (await H.admin('/rt/admin/gift')).json()).refunds[0].done, 1);
      assert.match(fs.readFileSync(new URL('../admin-gift.js', import.meta.url), 'utf8'), /\/rt\/admin\/gift\/refund/, 'the admin page lists them and marks them');
    } finally { done(); }
  });
  it('a minute far outside any date is 400 minute (not 503); a 429 carries Retry-After as a header', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1');
      const r = await boardWithFriends(H, env, A, 10);
      for (const m of [8.7e15, 9007199254740991]) { const res = await book(H, r.id, { m, how: 'friends' }, A.token); assert.equal(res.status, 400); assert.equal((await res.json()).code, 'minute'); }
      let last = null; for (let i = 0; i < 12; i++) last = await book(H, r.id, { m: 1, how: 'friends' }, A.token, '9.9.9.9');
      assert.equal(last.status, 429); assert.equal(last.headers.get('retry-after'), '60'); assert.equal((await last.json())['retry-after'], '60');
    } finally { done(); }
  });
});
