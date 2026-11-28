// 선물 전광판 on the Worker (giftsrv.js through worker.js): making boards, limits, the 롤링페이퍼 lock, visitor counts, the price-ladder
// interest (E1) and its advertising notice, reports, the R2 video (optional), the link card and the recipient page, the world, pruning
// 7 days after the day, and the account flows the privacy policy names: withdrawal deletes, an account link moves.
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
function fakeNet(state) {
  return async (url, opt = {}) => {
    const u = String(url); state.calls.push(u);
    if (u.startsWith(PUSH_HOST)) { state.pushes.push({ url: u, body: opt.body }); return new Response('', { status: 201 }); } // the push service
    if (u.includes('/.well-known/jwks.json')) return json({ keys: state.jwks || [] });
    if (u.includes('/rest/v1/billboards')) return json([]);
    if (u.includes('/rest/v1/plots')) return json([]);
    if (u.includes('/rest/v1/')) return json([]);
    if (u.includes('/rpc/merge_guest_account')) return json({ ok: true, coins: 1, bonus: 0 });
    if (u.includes('/rpc/')) return json({ ok: true });
    return new Response('missing', { status: 404 });
  };
}
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
// gb as it was before the reply column (2026-11-23): a store made then must keep working.
const OLD_GB = "create table gb(id text primary key, at integer not null, uid text not null, ip text not null, day text not null, a integer not null, b integer not null, scr text not null, st text not null, lk integer not null default 1, ref text not null default '', n integer not null default 0, v integer not null default 0, vd integer not null default 0, kids integer not null default 0, rp integer not null default 0, vid text not null default '', j text not null)";

describe('선물 전광판 on the Worker', { concurrency: false }, () => {
  it('makes a board with a guest token; the public view has no owner data; the token owns it', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const res = await H.post('/rt/gift', FORM(), A.token), r = await res.json();
      assert.equal(res.status, 200, JSON.stringify(r));
      assert.match(r.url, /^https:\/\/sq\.example\/g\/[0-9a-z]{8}$/);
      assert.equal(r.gift.scr, 'STREET_31'); assert.equal(r.gift.phase, 'live'); assert.equal(r.gift.to, '민지');
      const pub = await (await H.get('/rt/gift/' + r.id)).json();
      assert.equal(pub.own, false); assert.equal('mine' in pub, false);
      assert.equal(JSON.stringify(pub).includes(A.id), false, 'no owner id');
      const mine = await (await H.get('/rt/gift/' + r.id, A.token)).json();
      assert.equal(mine.own, true); assert.equal(mine.media, false);
      const B = await H.guest('2.2.2.2'), r2 = await (await H.post('/rt/gift', FORM({ to: '지우' }), B.token, '2.2.2.2')).json();
      assert.equal(r2.gift.scr, 'STREET_32', 'the next board gets its own screen');
      const row = db(env).prepare('select uid, ip, day, scr, lk from gb where id = ?').get(r.id);
      assert.equal(row.uid, A.id); assert.equal(row.ip.length, 16); assert.notEqual(row.ip, '1.1.1.1', 'a network hash, not the address'); assert.equal(row.lk, 1);
      assert.equal(db(env).prepare("select n from gd where k = 'made'").get().n, 2);
    } finally { done(); }
  });

  it('refuses no token, a bad form (with its field), and writes nothing at the hard budget level', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest();
      assert.equal((await H.post('/rt/gift', FORM())).status, 401);
      const bad = await H.post('/rt/gift', FORM({ msg: '010-1234-5678로 연락' }), A.token), b = await bad.json();
      assert.equal(bad.status, 400); assert.equal(b.field, 'msg'); assert.equal(b.code, 'link');
      assert.equal((await H.post('/rt/gift', 'x'.repeat(4000), A.token)).status, 413);
      env.BUDGET_REQ_DAY = '1'; clock.add(61000);
      const busy = await H.post('/rt/gift', FORM(), A.token);
      assert.equal(busy.status, 503); assert.equal((await busy.json()).code, 'busy');
      assert.equal(db(env).prepare("select count(*) n from sqlite_master where name = 'gb'").get().n, 0, 'the gift DO was never called');
    } finally { done(); }
  });

  it('limits new boards per account and per network each KST day', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest();
      for (let i = 0; i < GIFT.dayPerActor; i++) assert.equal((await H.post('/rt/gift', FORM({ to: '친구' + i }), A.token)).status, 200, 'board ' + i);
      const more = await H.post('/rt/gift', FORM(), A.token);
      assert.equal(more.status, 429); assert.equal((await more.json()).code, 'mine');
      let made = GIFT.dayPerActor;
      while (made < GIFT.dayPerNet) { const G = await H.guest(); for (let i = 0; i < GIFT.dayPerActor && made < GIFT.dayPerNet; i++, made++) assert.equal((await H.post('/rt/gift', FORM(), G.token)).status, 200); clock.add(61000); }
      const net = await H.post('/rt/gift', FORM(), (await H.guest()).token);
      assert.equal(net.status, 429); assert.equal((await net.json()).code, 'net');
      assert.equal((await H.post('/rt/gift', FORM(), (await H.guest('9.9.9.9')).token, '9.9.9.9')).status, 200, 'another network still goes');
      clock.add(864e5);
      assert.equal((await H.post('/rt/gift', FORM(), A.token)).status, 200, 'the next day again');
    } finally { done(); }
  });

  it('롤링페이퍼: a token, locked until the day, per-writer cap, the writer id kept and never shown', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest(), F = await H.guest('3.3.3.3');
      const day = addDays(today(), 2), r = await (await H.post('/rt/gift', FORM({ day, at: 18 }), A.token)).json();
      assert.equal(r.gift.phase, 'before');
      assert.equal((await H.post('/rt/gift/' + r.id + '/paper', { nick: '수아', txt: '생일 축하해!' })).status, 401, 'a token is needed');
      const ok = await (await H.post('/rt/gift/' + r.id + '/paper', { nick: '수아', txt: '생일 축하해!' }, F.token, '3.3.3.3')).json();
      assert.equal(ok.ok, true); assert.equal(ok.n, 1);
      for (let i = 1; i < GIFT.paper.perWriter; i++) assert.equal((await H.post('/rt/gift/' + r.id + '/paper', { txt: '또 축하 ' + i }, F.token, '3.3.3.3')).status, 200);
      const cap = await H.post('/rt/gift/' + r.id + '/paper', { txt: '하나 더' }, F.token, '3.3.3.3');
      assert.equal(cap.status, 409); assert.equal((await cap.json()).code, 'paperMine');
      assert.equal((await (await H.post('/rt/gift/' + r.id + '/paper', { txt: '전화 01012345678' }, A.token)).json()).code, 'link');
      assert.equal(db(env).prepare('select uid from gm limit 1').get().uid, F.id, 'the writer is kept');
      const before = await (await H.get('/rt/gift/' + r.id)).json();
      assert.equal(before.gift.paper, null); assert.equal(before.gift.n, 3); assert.equal(before.gift.open, false);
      clock.add(2 * 864e5 - 12 * 36e5 + 1000); // 00:00 of the day
      const open = await (await H.get('/rt/gift/' + r.id)).json();
      assert.equal(open.gift.phase, 'day'); assert.equal(open.gift.paper.length, 3); assert.equal(open.gift.paper[0].nick, '수아');
      assert.equal(JSON.stringify(open).includes(F.id), false, 'no writer id in what anyone sees');
      clock.add(24 * 36e5);
      assert.equal((await (await H.post('/rt/gift/' + r.id + '/paper', { txt: '늦었어' }, A.token)).json()).code, 'paperClosed');
    } finally { done(); }
  });

  it('counts distinct visitors per board (and on its day, returning ones) with one DO call per batch; nothing at hard', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 9 }), A.token)).json();
      const seen = (v, e = 'open') => H.post('/rt/gift/' + r.id + '/seen', { v: VIS(v), e });
      assert.equal((await seen(1)).status, 204); await seen(2); await seen(1); await seen(1, 'done'); await seen(1, 'bogus');
      await giftSeenFlush(env, H.ctx);
      let row = db(env).prepare('select v, vd from gb where id = ?').get(r.id);
      assert.deepEqual({ ...row }, { v: 2, vd: 0 });
      clock.add(864e5); await seen(1); await seen(3); await giftSeenFlush(env, H.ctx);
      row = db(env).prepare('select v, vd from gb where id = ?').get(r.id);
      assert.deepEqual({ ...row }, { v: 3, vd: 2 });
      const d = Object.fromEntries(db(env).prepare('select k, n from gd where d = ?').all(today()).map((x) => [x.k, x.n]));
      assert.equal(d.view_day, 2); assert.equal(d.return_day, 1, 'visitor 1 came back on the day');
      env.BUDGET_REQ_DAY = '1'; clock.add(61000); await seen(4); await giftSeenFlush(env, H.ctx);
      assert.equal(db(env).prepare('select v from gb where id = ?').get(r.id).v, 3, 'dropped at hard');
    } finally { done(); }
  });

  it('E1: the ladder interest is the owner\'s, anonymous daily totals; notify needs consent; the notice is labelled and never at night', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest(), B = await H.guest('4.4.4.4');
      const r = await (await H.post('/rt/gift', FORM(), A.token)).json(), p = '/rt/gift/' + r.id + '/interest';
      assert.equal((await H.post(p, { act: 'view' }, B.token, '4.4.4.4')).status, 403, 'not the owner');
      assert.equal((await H.post(p, { act: 'view' }, A.token)).status, 200);
      assert.equal((await H.post(p, { act: 'pick', t: 2 }, A.token)).status, 200);
      assert.equal((await H.post(p, { act: 'pick', t: 9 }, A.token)).status, 400);
      const noOk = await H.post(p, { act: 'notify', t: 2 }, A.token);
      assert.equal(noOk.status, 400); assert.equal((await noOk.json()).code, 'consent');
      assert.equal((await H.post(p, { act: 'notify', t: 2, consent: true }, A.token)).status, 200);
      assert.equal((await H.post(p, { act: 'notify', t: 2, consent: true }, A.token)).status, 200, 'again renews, counts once');
      const d = Object.fromEntries(db(env).prepare('select k, n from gd where d = ?').all(today()).map((x) => [x.k, x.n]));
      assert.equal(d.ladder, 1); assert.equal(d['pick:2'], 1); assert.equal(d['notify:2'], 1);
      const cols = db(env).prepare('pragma table_info(gb)').all().map((c) => c.name);
      assert.equal(cols.includes('tp'), false, 'no pick kept against a board or account');
      assert.equal(db(env).prepare('select count(*) n from gi').get().n, 1);
      // 21:00..08:00 KST: refused; at noon it goes once per account, "(광고)" in front
      clock.add(9 * 36e5);
      const quiet = await H.admin('/rt/admin/gift/notify', { text: '결제가 열렸어요' });
      assert.equal(quiet.status, 409); assert.equal((await quiet.json()).code, 'quiet');
      clock.add(15 * 36e5);
      // No VAPID key here, so pushNow returns at once; the (광고) rule on the text is checked in worker.js below.
      const sent = await (await H.admin('/rt/admin/gift/notify', { text: '결제가 열렸어요' })).json();
      assert.equal(sent.sent, 1); assert.equal(sent.left, 0);
      assert.equal((await (await H.admin('/rt/admin/gift/notify', { text: '결제가 열렸어요' })).json()).sent, 0, 'once per account');
      const W = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
      assert.match(W, /row\?\.kind === 'giftopen'\) return \/\^\\\(광고\\\) \//, 'the push text must start with (광고)');
      clock.add(61 * 864e5); await H.post('/rt/gift', FORM(), (await H.guest('5.5.5.5')).token, '5.5.5.5');
      assert.equal(db(env).prepare('select count(*) n from gi').get().n, 0, 'not renewed for 60 days: pruned');
    } finally { done(); }
  });

  it('three networks\' reports hide a board; a line can be reported and hidden apart', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM({ day: today(), at: 'now' }), A.token)).json();
      const line = await (await H.post('/rt/gift/' + r.id + '/paper', { txt: '나쁜 말' }, A.token)).json();
      for (const ip of ['6.6.6.1', '6.6.6.2', '6.6.6.3']) await H.post('/rt/gift/' + r.id + '/report', { m: line.id }, null, ip);
      assert.equal(db(env).prepare('select st from gm where id = ?').get(line.id).st, 'hidden');
      assert.equal((await H.post('/rt/gift/' + r.id + '/report', {}, null, '7.7.7.1')).status, 200);
      await H.post('/rt/gift/' + r.id + '/report', {}, null, '7.7.7.1'); // the same network again counts once
      await H.post('/rt/gift/' + r.id + '/report', {}, null, '7.7.7.2');
      assert.equal(db(env).prepare('select st from gb where id = ?').get(r.id).st, 'live');
      const third = await (await H.post('/rt/gift/' + r.id + '/report', {}, null, '7.7.7.3')).json();
      assert.equal(third.hidden, true);
      assert.equal((await H.get('/rt/gift/' + r.id)).status, 404);
      assert.equal((await H.admin('/rt/admin/gift/hide', { id: r.id, hide: false })).status, 200);
      assert.equal((await H.get('/rt/gift/' + r.id)).status, 200, 'the admin brings it back');
    } finally { done(); }
  });

  it('video: 501 without R2; with R2 the owner uploads MP4/WebM only, it is served with ranges, at most 3 per board', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest(), B = await H.guest('8.8.8.8');
      const r = await (await H.post('/rt/gift', FORM(), A.token)).json();
      const up = (u8, tok, ip = '1.1.1.1') => H.call('/rt/gift/' + r.id + '/video', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'video/mp4', 'cf-connecting-ip': ip }, body: u8 });
      const none = await up(MP4(), A.token);
      assert.equal(none.status, 501); assert.equal((await none.json()).code, 'nostore');
      env.MEDIA = fakeR2();
      assert.equal((await up(MP4(), B.token, '8.8.8.8')).status, 403, 'not the owner');
      assert.equal((await up(JPEG().slice(0, 4000), A.token)).status, 400);
      const junk = new Uint8Array(30000); junk[0] = 1; assert.equal((await up(junk, A.token)).status, 415);
      const ok = await (await up(MP4(), A.token)).json();
      assert.equal(ok.ok, true); assert.equal(ok.t, 'mp4');
      assert.equal(env.MEDIA.m.get(vidKey(r.id)).ct, 'video/mp4');
      const part = await H.get('/rt/gift/' + r.id + '/video', null, { range: 'bytes=4-11' });
      assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), 'bytes 4-11/30000');
      assert.equal(new TextDecoder().decode(new Uint8Array(await part.arrayBuffer())), 'ftypisom');
      const all = await H.get('/rt/gift/' + r.id + '/video');
      assert.equal(all.status, 200); assert.equal(all.headers.get('accept-ranges'), 'bytes'); assert.equal((await all.arrayBuffer()).byteLength, 30000);
      assert.equal((await (await H.get('/rt/gift/' + r.id, A.token)).json()).gift.vid.t, 'mp4');
      const big = await H.call('/rt/gift/' + r.id + '/video', { method: 'POST', headers: { authorization: 'Bearer ' + A.token, 'content-length': String(GIFT.video.max + 1) }, body: MP4() });
      assert.equal(big.status, 413);
      const many = await up(MP4(), A.token); // the 4th attempt (the junk and the small one counted too)
      assert.equal(many.status, 429); assert.equal((await many.json()).code, 'vmany');
    } finally { done(); }
  });

  it('the link card and the recipient page: preview meta, noindex, the public JSON inline, no room and no 3D', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM({ to: '<b>민지</b>' }), A.token)).json();
      const og = await H.get('/rt/gift/' + r.id + '/card.jpg');
      assert.equal(og.status, 302); assert.match(og.headers.get('location'), /\/og\.jpg$/);
      assert.equal((await H.call('/rt/gift/' + r.id + '/card', { method: 'POST', headers: { authorization: 'Bearer ' + A.token, 'content-type': 'image/jpeg' }, body: JPEG() })).status, 200);
      const jpg = await H.get('/rt/gift/' + r.id + '/card.jpg');
      assert.equal(jpg.status, 200); assert.equal(jpg.headers.get('content-type'), 'image/jpeg');
      const page = await H.get('/g/' + r.id), html = await page.text();
      assert.equal(page.status, 200); assert.match(page.headers.get('x-robots-tag'), /noindex/);
      assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
      assert.match(html, /og:title" content="🎂 &lt;b&gt;민지&lt;\/b&gt;님을 위한 선물 전광판"/, 'escaped');
      assert.match(html, new RegExp('og:image" content="https://sq\\.example/rt/gift/' + r.id + '/card\\.jpg"'));
      assert.equal((html.match(/<title>/g) || []).length, 1, 'one title');
      const data = JSON.parse(/<script id="gift-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
      assert.equal(data.gift.id, r.id); assert.equal(JSON.stringify(data).includes(A.id), false);
      assert.equal(html.includes('<b>민지'), false, 'no raw markup from the name');
      assert.equal(/three|timesSquare3d|\/rt\/ws/.test(html), false);
      assert.equal((await H.get('/g/zzzzzzzz')).status, 404);
      const bad = await H.get('/g/BAD'); assert.equal(bad.status, 302); assert.match(bad.headers.get('location'), /\/gift$/);
    } finally { done(); }
  });

  it('the world carries the boards up now and nothing else', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const later = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 9 }), A.token)).json();
      let w = await (await H.get('/rt/world')).json();
      assert.equal('gifts' in w, false, 'no key while none is up');
      const now = await (await H.post('/rt/gift', FORM({ to: '지금' }), A.token)).json();
      clock.add(61000);
      w = await (await H.get('/rt/world')).json();
      assert.deepEqual(w.gifts.map((g) => g.id), [now.id]);
      assert.deepEqual(Object.keys(w.gifts[0]).sort(), ['a', 'b', 'from', 'id', 'msg', 'n', 'occ', 'scr', 'th', 'to']);
      void later;
    } finally { done(); }
  });

  it('a board, its lines, card and video go 7 days after its day', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv({ MEDIA: fakeR2() }), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM(), A.token)).json();
      await H.post('/rt/gift/' + r.id + '/paper', { txt: '축하' }, A.token);
      await H.call('/rt/gift/' + r.id + '/video', { method: 'POST', headers: { authorization: 'Bearer ' + A.token }, body: MP4() });
      clock.add(7 * 864e5 + 11 * 36e5); // the 7th day after, 23:00 KST: still there
      assert.equal((await H.get('/rt/gift/' + r.id)).status, 200);
      await H.post('/rt/gift', FORM(), (await H.guest('5.5.5.6')).token, '5.5.5.6');
      assert.equal(db(env).prepare('select count(*) n from gb where id = ?').get(r.id).n, 1);
      clock.add(36e5 + 1000); // 00:00: gone
      assert.equal((await H.get('/rt/gift/' + r.id)).status, 404);
      await H.post('/rt/gift', FORM(), (await H.guest('5.5.5.7')).token, '5.5.5.7');
      assert.equal(db(env).prepare('select count(*) n from gb where id = ?').get(r.id).n, 0);
      assert.equal(db(env).prepare('select count(*) n from gm where g = ?').get(r.id).n, 0);
      assert.deepEqual(env.MEDIA.deleted, [vidKey(r.id)]);
    } finally { done(); }
  });

  it('withdrawal deletes the account\'s boards with every line on them, the lines it wrote elsewhere, its videos and opt-ins', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv({ MEDIA: fakeR2() }), H = harness(env), U = await userToken(state, clock, '11111111-2222-3333-4444-555555555555'), O = await H.guest('2.2.2.9');
      const mine = await (await H.post('/rt/gift', FORM(), U.token)).json();
      await H.call('/rt/gift/' + mine.id + '/video', { method: 'POST', headers: { authorization: 'Bearer ' + U.token }, body: MP4() });
      await H.post('/rt/gift/' + mine.id + '/paper', { txt: '다른 사람이 쓴 것' }, O.token, '2.2.2.9');
      await H.post('/rt/gift/' + mine.id + '/interest', { act: 'notify', t: 1, consent: true }, U.token);
      const other = await (await H.post('/rt/gift', FORM({ to: '남' }), O.token, '2.2.2.9')).json();
      await H.post('/rt/gift/' + other.id + '/paper', { txt: '내가 남의 판에' }, U.token);
      await H.post('/rt/gift/' + other.id + '/paper', { txt: '남이 쓴 것' }, O.token, '2.2.2.9');
      assert.equal((await H.post('/rt/auth/withdraw', {}, U.token)).status, 200);
      assert.equal(db(env).prepare('select count(*) n from gb where uid = ?').get(U.id).n, 0);
      assert.equal(db(env).prepare('select count(*) n from gm where g = ?').get(mine.id).n, 0, 'lines others wrote on it go with the board');
      assert.equal(db(env).prepare('select count(*) n from gm where uid = ?').get(U.id).n, 0, 'its own lines elsewhere go');
      assert.deepEqual(db(env).prepare('select txt from gm where g = ?').all(other.id).map((x) => x.txt), ['남이 쓴 것'], 'other people\'s stay');
      assert.equal(db(env).prepare('select n from gb where id = ?').get(other.id).n, 1, 'the count follows');
      assert.equal(db(env).prepare('select count(*) n from gi where uid = ?').get(U.id).n, 0);
      assert.deepEqual(env.MEDIA.deleted, [vidKey(mine.id)]);
      assert.equal((await H.get('/rt/gift/' + mine.id)).status, 404);
    } finally { done(); }
  });

  it('an account link moves a guest\'s boards, lines and opt-ins to the account; running it again changes nothing', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), G = await H.guest(), U = await userToken(state, clock, '99999999-2222-3333-4444-555555555555');
      const b = await (await H.post('/rt/gift', FORM(), G.token)).json();
      await H.post('/rt/gift/' + b.id + '/paper', { txt: '게스트가 쓴 것' }, G.token);
      await H.post('/rt/gift/' + b.id + '/interest', { act: 'notify', t: 3, consent: true }, G.token);
      const link = () => H.post('/rt/auth/merge', { guest_id: G.id, guest_token: G.token }, U.token);
      assert.equal((await link()).status, 200);
      assert.equal(db(env).prepare('select uid from gb where id = ?').get(b.id).uid, U.id);
      assert.equal(db(env).prepare('select uid from gm where g = ?').get(b.id).uid, U.id);
      assert.deepEqual(db(env).prepare('select uid, t from gi').all().map((x) => [x.uid, x.t]), [[U.id, 3]]);
      assert.equal((await (await H.get('/rt/gift/' + b.id, U.token)).json()).own, true, 'the account owns it now');
      assert.equal((await link()).status, 200);
      assert.equal(db(env).prepare('select count(*) n from gb where uid = ?').get(U.id).n, 1);
      assert.equal(db(env).prepare('select count(*) n from gm where uid = ?').get(U.id).n, 1);
      assert.equal(db(env).prepare('select count(*) n from gi').get().n, 1);
    } finally { done(); }
  });

  it('admin: list and stats need the key; stats split by the lock arm (E3) and count boards that led to another (E2)', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest(), B = await H.guest('3.3.3.4');
      const first = await (await H.post('/rt/gift', FORM(), A.token)).json();
      await H.post('/rt/gift', { ...FORM({ to: '다음' }), ref: first.id }, B.token, '3.3.3.4');
      await H.post('/rt/gift', { ...FORM({ to: '셀프' }), ref: first.id }, A.token); // its own board does not count
      assert.equal((await H.get('/rt/admin/gift')).status, 401);
      const list = await (await H.admin('/rt/admin/gift')).json();
      assert.equal(list.boards.length, 3); assert.equal(list.boards.some((g) => 'uid' in g || 'ip' in g), false);
      const st = await (await H.admin('/rt/admin/gift/stats')).json();
      assert.equal(st.days.find((d) => d.d === today()).made, 3);
      assert.equal(st.days.find((d) => d.d === today()).made_ref, 1);
      assert.equal(st.arms.reduce((s, a) => s + a.kids, 0), 1);
    } finally { done(); }
  });
});

describe('답장 전광판 on the Worker', { concurrency: false }, () => {
  const REPLY = (to, o = {}) => ({ ...FORM({ to: '지수', from: '민지', occ: 'thanks', msg: REPLY_MSG, ...o }), ref: to, re: 1 });
  const reOf = (env, id) => db(env).prepare('select re from gb where id = ?').get(id).re;

  it('keeps the first reply on the answered board: only another account\'s reply counts, a second one changes nothing, and only the owner reads it', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv({ VAPID_PRIV: VAPID }), H = harness(env), A = await H.guest(), B = await H.guest('2.2.2.2'), C = await H.guest('3.3.3.3'), s = await subscriber();
      assert.equal((await H.post('/rt/push', { s: s.sub() }, A.token)).status, 200, 'the sender has web push on');
      const first = await (await H.post('/rt/gift', FORM({ to: '민지', from: '지수' }), A.token)).json();
      // Not a reply: one's own board, a board that is not there, no board named, an ordinary board made from the page (ref without re).
      assert.equal((await H.post('/rt/gift', REPLY(first.id, { to: '셀프' }), A.token)).status, 200);
      assert.equal((await H.post('/rt/gift', REPLY('zzzzzzzz'), B.token, '2.2.2.2')).status, 200);
      assert.equal((await H.post('/rt/gift', { ...REPLY(''), ref: undefined }, B.token, '2.2.2.2')).status, 200);
      assert.equal((await H.post('/rt/gift', { ...FORM({ to: '다음' }), ref: first.id }, C.token, '3.3.3.3')).status, 200);
      assert.equal(reOf(env, first.id), ''); assert.equal(state.pushes.length, 0); assert.equal('reply' in dayCounts(env), false);
      assert.equal('re' in (await (await H.get('/rt/gift/' + first.id, A.token)).json()).mine, false);
      // The reply: an ordinary board whose ref is the answered one.
      const res = await H.post('/rt/gift', REPLY(first.id), B.token, '2.2.2.2'), reply = await res.json();
      assert.equal(res.status, 200, JSON.stringify(reply));
      assert.deepEqual([reply.gift.to, reply.gift.from, reply.gift.occ, reply.gift.msg, reply.gift.th], ['지수', '민지', 'thanks', REPLY_MSG, 'night']);
      assert.equal('reply' in reply, false); assert.equal(JSON.stringify(reply).includes(A.id), false, 'the answer never names the answered board\'s owner');
      assert.equal(reOf(env, first.id), reply.id);
      assert.equal(db(env).prepare('select ref from gb where id = ?').get(reply.id).ref, first.id);
      assert.equal(state.pushes.length, 1, 'one notice to the answered board\'s owner');
      assert.equal(state.pushes[0].url, s.endpoint);
      assert.deepEqual(await decrypt(state.pushes[0].body, s), { body: '민지님이 답장 전광판을 걸었어요', url: '/g/' + first.id + '?o=1' }); // ?o=1: opened as the owner on whichever device gets it
      // A second reply (minutes later, another account) leaves the first and tells nobody.
      clock.add(5 * 60000);
      assert.equal((await H.post('/rt/gift', REPLY(first.id, { from: '수아' }), C.token, '3.3.3.3')).status, 200);
      assert.equal(reOf(env, first.id), reply.id); assert.equal(state.pushes.length, 1);
      await H.post('/rt/gift/' + first.id + '/seen', { v: VIS(1), e: 'reply' }); await giftSeenFlush(env, H.ctx);
      const d = dayCounts(env);
      assert.equal(d.reply, 1, 'boards that got their first reply'); assert.equal(d.made_ref, 3, 'every board made from the page still counts for K');
      assert.equal(d['ev:reply'], 1, 'the reply button, per device and day');
      assert.equal((await (await H.admin('/rt/admin/gift/stats')).json()).days.find((x) => x.d === today()).reply, 1, 'the admin table reads it by key');
      assert.ok(/\['made_ref', '페이지에서 와서 만든'\], \['reply', '답장'\], /.test(fs.readFileSync(new URL('../admin-gift.js', import.meta.url), 'utf8')), 'admin-gift.js: one column 답장, next to made_ref');
      assert.equal(db(env).prepare('select kids from gb where id = ?').get(first.id).kids, 3);
      // Only the owner's read says a reply came; nobody else's read, the page or the world does.
      const mine = await (await H.get('/rt/gift/' + first.id, A.token)).json();
      assert.equal(mine.own, true); assert.equal(mine.mine.re, reply.id);
      const pub = await (await H.get('/rt/gift/' + first.id)).json(), other = await (await H.get('/rt/gift/' + first.id, B.token)).json();
      assert.equal(JSON.stringify(pub).includes(reply.id), false); assert.equal('mine' in other, false); assert.equal(JSON.stringify(other).includes(reply.id), false);
      assert.equal((await (await H.get('/g/' + first.id)).text()).includes(reply.id), false, 'the page anyone opens does not carry it');
      const theirs = await (await H.get('/rt/gift/' + reply.id)).json();
      assert.equal(JSON.stringify(theirs).includes(first.id), false, 'a reply\'s public view does not say what it answers');
      clock.add(61000);
      const w = await (await H.get('/rt/world')).json();
      assert.deepEqual(Object.keys(w.gifts.find((g) => g.id === first.id)).sort(), ['a', 'b', 'from', 'id', 'msg', 'n', 'occ', 'scr', 'th', 'to']);
      // Taken down by its maker: the mark goes with it, at once for the owner.
      assert.equal((await H.post('/rt/gift/' + reply.id + '/delete', {}, B.token, '2.2.2.2')).status, 200);
      assert.equal(reOf(env, first.id), '');
      assert.equal('re' in (await (await H.get('/rt/gift/' + first.id, A.token)).json()).mine, false);
      // Hung again (a typo fixed, or someone pinging the owner by reply, delete, reply): the place is taken again, the owner is not told
      // again and the board is not counted again. Once per answered board, for good.
      clock.add(61000);
      const D = await H.guest('4.4.4.4'), again = await (await H.post('/rt/gift', REPLY(first.id, { from: '다시' }), D.token, '4.4.4.4')).json();
      assert.equal(again.ok, true); assert.equal(reOf(env, first.id), again.id);
      assert.equal((await (await H.get('/rt/gift/' + first.id, A.token)).json()).mine.re, again.id, 'the owner sees the reply that is there now');
      assert.equal(state.pushes.length, 1, 'no second notice'); assert.equal(dayCounts(env).reply, 1, 'no second count');
    } finally { done(); }
  });

  it('sends no reply notice from 21:00 to 08:00 KST (the owner page still shows it); without a name the notice says so', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv({ VAPID_PRIV: VAPID }), H = harness(env), A = await H.guest(), B = await H.guest('2.2.2.2'), s = await subscriber();
      await H.post('/rt/push', { s: s.sub() }, A.token);
      clock.add(10 * 36e5); // 22:00 KST
      const night = await (await H.post('/rt/gift', FORM(), A.token)).json();
      const r1 = await (await H.post('/rt/gift', REPLY(night.id), B.token, '2.2.2.2')).json();
      assert.equal(reOf(env, night.id), r1.id); assert.equal(state.pushes.length, 0, 'never at night');
      assert.equal((await (await H.get('/rt/gift/' + night.id, A.token)).json()).mine.re, r1.id, 'seen the next time the owner opens the page');
      clock.add(10 * 36e5); // 08:00 KST the next morning
      const day = await (await H.post('/rt/gift', FORM({ at: 9 }), A.token)).json();
      const r2 = await (await H.post('/rt/gift', REPLY(day.id, { from: '' }), B.token, '2.2.2.2')).json();
      assert.equal(reOf(env, day.id), r2.id); assert.equal(state.pushes.length, 1);
      assert.deepEqual(await decrypt(state.pushes[0].body, s), { body: '답장 전광판이 도착했어요', url: '/g/' + day.id + '?o=1' });
    } finally { done(); }
  });

  it('a hidden board is not answered: no mark and no notice until it is back (the reply is still a board of its own)', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv({ VAPID_PRIV: VAPID }), H = harness(env), A = await H.guest(), B = await H.guest('2.2.2.2'), C = await H.guest('3.3.3.3'), s = await subscriber();
      await H.post('/rt/push', { s: s.sub() }, A.token);
      const first = await (await H.post('/rt/gift', FORM(), A.token)).json();
      await H.admin('/rt/admin/gift/hide', { id: first.id });
      assert.equal((await H.post('/rt/gift', REPLY(first.id), B.token, '2.2.2.2')).status, 200);
      assert.equal(reOf(env, first.id), ''); assert.equal(state.pushes.length, 0); assert.equal('reply' in dayCounts(env), false);
      await H.admin('/rt/admin/gift/hide', { id: first.id, hide: false });
      const r = await (await H.post('/rt/gift', REPLY(first.id), C.token, '3.3.3.3')).json();
      assert.equal(reOf(env, first.id), r.id); assert.equal(state.pushes.length, 1); assert.equal(dayCounts(env).reply, 1);
    } finally { done(); }
  });

  it('a reply is a write: at the hard budget level it answers 503 with no call to the gift object', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv({ VAPID_PRIV: VAPID }), H = harness(env), A = await H.guest(), B = await H.guest('2.2.2.2'), s = await subscriber();
      await H.post('/rt/push', { s: s.sub() }, A.token);
      const first = await (await H.post('/rt/gift', FORM(), A.token)).json();
      const calls = spyGift(env);
      env.BUDGET_REQ_DAY = '1'; clock.add(61000);
      const busy = await H.post('/rt/gift', REPLY(first.id), B.token, '2.2.2.2');
      assert.equal(busy.status, 503); assert.equal((await busy.json()).code, 'busy');
      assert.deepEqual(calls, [], 'no DO call'); assert.equal(reOf(env, first.id), ''); assert.equal(state.pushes.length, 0);
      assert.equal(db(env).prepare('select count(*) n from gb').get().n, 1);
      delete env.BUDGET_REQ_DAY; clock.add(61000); // the budget is back: the same reply is one call and one notice
      assert.equal((await H.post('/rt/gift', REPLY(first.id), B.token, '2.2.2.2')).status, 200);
      assert.deepEqual(calls, ['giftMake']); assert.notEqual(reOf(env, first.id), ''); assert.equal(state.pushes.length, 1);
    } finally { done(); }
  });

  it('a store made before the reply column gains it on first use and keeps its boards', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest(), B = await H.guest('2.2.2.2');
      const now = Date.now(), a = Math.floor(now / GIFT.nowStep) * GIFT.nowStep, cols = () => db(env).prepare('pragma table_info(gb)').all().map((c) => c.name);
      db(env).exec(OLD_GB);
      db(env).prepare("insert into gb(id, at, uid, ip, day, a, b, scr, st, kids, j) values(?, ?, ?, ?, ?, ?, ?, 'STREET_31', 'live', 2, ?)").run('oldboard', now, A.id, 'f'.repeat(16), today(), a, a + GIFT.hours * 36e5, JSON.stringify({ to: '옛날', from: '친구', occ: 'bday', msg: '그대로', th: 'party' }));
      assert.equal(cols().includes('re'), false, 'the table as it was');
      const read = await (await H.get('/rt/gift/oldboard', A.token)).json();
      assert.equal(read.own, true); assert.deepEqual([read.gift.to, read.gift.msg, read.mine.kids], ['옛날', '그대로', 2]); assert.equal('re' in read.mine, false);
      assert.equal(cols().includes('re'), true, 'added in code, no migration');
      assert.equal(reOf(env, 'oldboard'), '');
      assert.deepEqual(db(env).prepare("select name from sqlite_master where type = 'index' and tbl_name = 'gb' and name like 'gb|_%' escape '|' order by name").all().map((x) => x.name), ['gb_b', 'gb_day', 'gb_uid'], 'the lookups by day, end and owner keep their indexes');
      const reply = await (await H.post('/rt/gift', REPLY('oldboard'), B.token, '2.2.2.2')).json();
      assert.equal(reply.ok, true); assert.equal(reOf(env, 'oldboard'), reply.id);
      // The object starts again (a deploy, an eviction): the column is there, nothing is lost.
      const again = new Meter(makeCtx(env.meter('gift').sql), env);
      assert.equal(again.giftGet('oldboard', Date.now()).re, reply.id);
      assert.equal(cols().filter((c) => c === 're').length, 1);
      assert.equal(db(env).prepare('select count(*) n from gb').get().n, 2);
    } finally { done(); }
  });

  it('withdrawal and the 7-day prune take a reply\'s mark with the reply board', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest(), U = await userToken(state, clock, '77777777-2222-3333-4444-555555555555'), B = await H.guest('2.2.2.2');
      const mine = await (await H.post('/rt/gift', FORM(), A.token)).json();
      const later = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 3), at: 18 }), A.token)).json();
      const byUser = await (await H.post('/rt/gift', REPLY(mine.id), U.token, '4.4.4.4')).json();
      const byGuest = await (await H.post('/rt/gift', REPLY(later.id), B.token, '2.2.2.2')).json();
      assert.equal(reOf(env, mine.id), byUser.id); assert.equal(reOf(env, later.id), byGuest.id);
      assert.equal((await H.post('/rt/auth/withdraw', {}, U.token)).status, 200);
      assert.equal(reOf(env, mine.id), '', 'no mark left pointing at a deleted board');
      assert.equal('re' in (await (await H.get('/rt/gift/' + mine.id, A.token)).json()).mine, false);
      assert.equal(reOf(env, later.id), byGuest.id, 'other replies stay');
      // The reply (today's board) is past its 7 days while the board it answered (3 days later) still lives.
      clock.add(8 * 864e5 + 36e5);
      assert.equal('re' in (await (await H.get('/rt/gift/' + later.id, A.token)).json()).mine, false, 'a reply that is gone is not offered');
      assert.equal((await H.post('/rt/gift', FORM(), A.token)).status, 200); // any new board prunes
      assert.equal(db(env).prepare('select count(*) n from gb where id = ?').get(byGuest.id).n, 0);
      assert.equal(reOf(env, later.id), '');
      // A hidden reply is not offered either, and comes back with the board.
      clock.add(61000);
      const again = await (await H.post('/rt/gift', REPLY(later.id), B.token, '2.2.2.2')).json();
      assert.equal(reOf(env, later.id), again.id);
      await H.admin('/rt/admin/gift/hide', { id: again.id });
      clock.add(21000);
      assert.equal('re' in (await (await H.get('/rt/gift/' + later.id, A.token)).json()).mine, false);
      await H.admin('/rt/admin/gift/hide', { id: again.id, hide: false });
      clock.add(21000);
      assert.equal((await (await H.get('/rt/gift/' + later.id, A.token)).json()).mine.re, again.id);
      // Hidden again: a reply nobody can open does not keep the place, the next one takes it.
      await H.admin('/rt/admin/gift/hide', { id: again.id });
      const C = await H.guest('3.3.3.3'), real = await (await H.post('/rt/gift', REPLY(later.id, { from: '진짜' }), C.token, '3.3.3.3')).json();
      assert.equal(reOf(env, later.id), real.id);
      await H.admin('/rt/admin/gift/hide', { id: again.id, hide: false });
      assert.equal(reOf(env, later.id), real.id, 'and keeps it');
      assert.equal((await (await H.get('/rt/gift/' + later.id, A.token)).json()).mine.re, real.id);
    } finally { done(); }
  });
});

describe('점등식 on the Worker: two beacon keys and the hard flag on the two reads', () => {
  const dataOf = (html) => JSON.parse(/<script id="gift-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
  it('takes the beacons cer and cershot as daily counts (an unknown key is still dropped); at hard a cer beacon is dropped', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 18 }), A.token)).json();
      const seen = (v, e) => H.post('/rt/gift/' + r.id + '/seen', { v: VIS(v), e });
      assert.equal((await seen(1, 'cer')).status, 204); await seen(2, 'cer'); await seen(1, 'cershot'); await seen(1, 'cerx');
      await giftSeenFlush(env, H.ctx);
      let d = dayCounts(env);
      assert.equal(d['ev:cer'], 2); assert.equal(d['ev:cershot'], 1); assert.equal('ev:cerx' in d, false, 'an unknown key is dropped');
      env.BUDGET_REQ_DAY = '1'; clock.add(61000);
      assert.equal((await seen(3, 'cer')).status, 204); await giftSeenFlush(env, H.ctx);
      d = dayCounts(env); assert.equal(d['ev:cer'], 2, 'dropped at hard');
    } finally { done(); }
  });
  it('takes the 실사 축하 영상 beacons (real_pick, real_made, real_save, real_share, real_fail) as daily counts', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 18 }), A.token)).json();
      const seen = (v, e) => H.post('/rt/gift/' + r.id + '/seen', { v: VIS(v), e });
      for (const e of ['real_pick', 'real_made', 'real_save', 'real_share', 'real_fail', 'real_x']) assert.equal((await seen(1, e)).status, 204);
      await seen(2, 'real_pick');
      await giftSeenFlush(env, H.ctx);
      const d = dayCounts(env);
      assert.deepEqual(['real_pick', 'real_made', 'real_save', 'real_share', 'real_fail'].map((e) => d['ev:' + e]), [2, 1, 1, 1, 1]);
      assert.equal('ev:real_x' in d, false, 'an unknown key is dropped');
    } finally { done(); }
  });
  it('GET /rt/gift/<id> and the /g/<id> page data say hard: true at level 2 only, with no more DO calls than at level 0', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 18 }), A.token)).json();
      const pub = await (await H.get('/rt/gift/' + r.id)).json();
      assert.equal(pub.ok, true); assert.equal('hard' in pub, false, 'no hard at level 0');
      assert.equal('hard' in dataOf(await (await H.get('/g/' + r.id)).text()), false, 'nor in the page data');
      const calls = spyGift(env);
      await H.get('/rt/gift/' + r.id); const base = calls.length; // a cached board: what a level-0 read costs now
      env.BUDGET_REQ_DAY = '1'; clock.add(61000);
      calls.length = 0;
      const hard = await (await H.get('/rt/gift/' + r.id)).json();
      assert.equal(hard.ok, true); assert.equal(hard.hard, true); assert.equal(hard.gift.id, r.id);
      assert.ok(calls.length <= base, `the level-2 read made ${calls.length} gift DO calls, the level-0 read ${base}`);
      const own = await (await H.get('/rt/gift/' + r.id, A.token)).json();
      assert.equal(own.own, true); assert.equal(own.hard, true, 'the owner\'s read too');
      const page = await H.get('/g/' + r.id);
      assert.equal(page.status, 200); assert.equal(dataOf(await page.text()).hard, true);
      assert.equal((await H.get('/rt/gift/zzzzzzzz')).status, 404, 'the 404 is unchanged');
      delete env.BUDGET_REQ_DAY; clock.add(61000);
      assert.equal('hard' in (await (await H.get('/rt/gift/' + r.id)).json()), false, 'back at level 0');
    } finally { done(); }
  });
});

// ---- the loop's gaps (2026-11-27): the visitor's 공유하기, 💖, creation start, link hits, makers ---------------------------------------
describe('the gift loop: reshare, hearts, starts, link hits and makers on the Worker', { concurrency: false }, () => {
  const dataOf = (html) => JSON.parse(/<script id="gift-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
  // The isolate's batch is shared by every env in this file: what earlier tests left goes to a throwaway store first.
  const drain = async () => { const e = makeEnv(); await giftSeenFlush(e, { waitUntil() {} }); };
  const heart = (H, id, v, ip = '7.7.7.7') => H.post('/rt/gift/' + id + '/heart', { v: VIS(v) }, null, ip);

  it('a visitor\'s 공유하기 counts under ev:reshare, apart from the owner\'s ev:share', async () => {
    const { done } = setup();
    try {
      await drain();
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM(), A.token)).json();
      const seen = (v, e) => H.post('/rt/gift/' + r.id + '/seen', { v: VIS(v), e });
      assert.equal((await seen(1, 'reshare')).status, 204); await seen(2, 'reshare');
      await giftSeenFlush(env, H.ctx);
      let d = dayCounts(env);
      assert.equal(d['ev:reshare'], 2); assert.equal('ev:share' in d, false, 'the owner\'s key does not move');
      await seen(3, 'share'); await giftSeenFlush(env, H.ctx);
      d = dayCounts(env); assert.equal(d['ev:share'], 1); assert.equal(d['ev:reshare'], 2);
    } finally { done(); }
  });

  it('💖: one per device and board, in every read of the board once revealed, the owner\'s too; gone with the board', async () => {
    const { clock, done } = setup();
    try {
      await drain();
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM(), A.token)).json();
      assert.equal(r.gift.hearts, 0, 'a "지금" board is revealed at once: the count is there, at 0');
      for (const v of [1, 1, 2, 1]) assert.equal((await heart(H, r.id, v)).status, 200);
      await giftSeenFlush(env, H.ctx);
      assert.equal(db(env).prepare('select hr from gb where id = ?').get(r.id).hr, 2, 'two devices, one heart each');
      assert.equal(dayCounts(env).heart, 2);
      assert.equal(db(env).prepare('select v from gb where id = ?').get(r.id).v, 2, 'a heart before its open beacon counts the device as a visitor once');
      await H.post('/rt/gift/' + r.id + '/seen', { v: VIS(1), e: 'open' }); await giftSeenFlush(env, H.ctx);
      assert.equal(db(env).prepare('select v from gb where id = ?').get(r.id).v, 2, 'and its open later adds nothing');
      const cols = db(env).prepare('pragma table_info(gv)').all().map((c) => c.name);
      assert.deepEqual(cols, ['g', 'v', 'at', 'dd', 'h'], 'the heart is a flag on the visitor row (the device hash a view keeps); the network mark for the cap is in gr, for the day');
      clock.add(25000); // past the isolate's 20 s copy
      assert.equal((await (await H.get('/rt/gift/' + r.id)).json()).gift.hearts, 2);
      assert.equal(dataOf(await (await H.get('/g/' + r.id)).text()).gift.hearts, 2, 'in the page data');
      assert.equal((await (await H.get('/rt/gift/' + r.id, A.token)).json()).gift.hearts, 2, 'the owner reads it');
      assert.ok(db(env).prepare("select count(*) n from gr where k like 'h:%'").get().n >= 1);
      assert.equal((await H.post('/rt/gift/' + r.id + '/delete', {}, A.token)).status, 200);
      assert.equal(db(env).prepare('select count(*) n from gv where g = ?').get(r.id).n, 0);
      assert.equal(db(env).prepare("select count(*) n from gr where k like 'h:%'").get().n, 0, 'the per-network marks go with it');
      assert.equal((await H.get('/rt/gift/' + r.id)).status, 404);
    } finally { done(); }
  });

  it('💖 is hidden before the board is revealed but kept (the friends of the main tower minute count before the day)', async () => {
    const { clock, done } = setup();
    try {
      await drain();
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 9 }), A.token)).json();
      assert.equal('hearts' in r.gift, false);
      await heart(H, r.id, 1); await giftSeenFlush(env, H.ctx);
      assert.equal(db(env).prepare('select hr from gb where id = ?').get(r.id).hr, 1, 'kept before the reveal');
      assert.equal('hearts' in (await (await H.get('/rt/gift/' + r.id)).json()).gift, false, 'no count in the public read');
      clock.add(21 * 36e5 + 60000); // 09:01 the next day: lit
      await heart(H, r.id, 1); await giftSeenFlush(env, H.ctx);
      assert.equal(db(env).prepare('select hr from gb where id = ?').get(r.id).hr, 1, 'the same device is still one');
      assert.equal((await (await H.get('/rt/gift/' + r.id)).json()).gift.hearts, 1);
    } finally { done(); }
  });

  it('💖 is rate-limited per network: 20 a minute at the door, GIFT.heartNet per board and day in the store', async () => {
    const { clock, done } = setup();
    try {
      await drain();
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM(), A.token)).json();
      const codes = []; for (let i = 1; i <= 21; i++) codes.push((await heart(H, r.id, i, '8.8.8.8')).status);
      assert.deepEqual([codes.filter((c) => c === 200).length, codes.at(-1)], [20, 429]);
      assert.equal((await (await heart(H, r.id, 21, '8.8.8.8')).json()).code, 'rate');
      for (let i = 22; i <= 40; i++) { if (i === 22 || i === 35) clock.add(61000); await heart(H, r.id, i, '8.8.8.8'); }
      await giftSeenFlush(env, H.ctx);
      assert.equal(db(env).prepare('select hr from gb where id = ?').get(r.id).hr, GIFT.heartNet, 'at most ' + GIFT.heartNet + ' from one network');
      await heart(H, r.id, 99, '9.9.9.9'); await giftSeenFlush(env, H.ctx);
      assert.equal(db(env).prepare('select hr from gb where id = ?').get(r.id).hr, GIFT.heartNet + 1, 'another network still can');
      assert.equal((await H.post('/rt/gift/' + r.id + '/heart', { v: 'nope' }, null, '6.6.6.6')).status, 400, 'a device id or nothing');
    } finally { done(); }
  });

  it('💖 at budget hard: 503 busy with no gift DO call, nothing kept', async () => {
    const { clock, done } = setup();
    try {
      await drain();
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM(), A.token)).json();
      env.BUDGET_REQ_DAY = '1'; clock.add(61000);
      const calls = spyGift(env);
      const res = await heart(H, r.id, 1);
      assert.equal(res.status, 503); assert.equal((await res.json()).code, 'busy');
      assert.deepEqual(calls, []);
      delete env.BUDGET_REQ_DAY; clock.add(61000);
      await giftSeenFlush(env, H.ctx);
      assert.equal(db(env).prepare('select hr from gb where id = ?').get(r.id).hr, 0);
    } finally { done(); }
  });

  it('the maker form shown: start, and start_ref when it came from another board; nothing at hard', async () => {
    const { clock, done } = setup();
    try {
      await drain();
      const env = makeEnv(), H = harness(env);
      assert.equal((await H.post('/rt/gift/start', {})).status, 204);
      await H.post('/rt/gift/start', { r: 1 }); await H.post('/rt/gift/start', { r: 'x' });
      await giftSeenFlush(env, H.ctx);
      let d = dayCounts(env); assert.equal(d.start, 3); assert.equal(d.start_ref, 1);
      env.BUDGET_REQ_DAY = '1'; clock.add(61000);
      await H.post('/rt/gift/start', { r: 1 }); await giftSeenFlush(env, H.ctx);
      d = dayCounts(env); assert.equal(d.start, 3, 'dropped at hard');
    } finally { done(); }
  });

  it('link hits: each GET of /g/<id> counted as a person or an automated fetcher, with no DO call of its own; not at hard', async () => {
    const { clock, done } = setup();
    try {
      await drain();
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM(), A.token)).json();
      const page = (ua, method = 'GET') => H.call('/g/' + r.id, { method, headers: { 'cf-connecting-ip': '5.5.5.5', ...(ua == null ? {} : { 'user-agent': ua }) } });
      const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.0';
      await page(PHONE); // the board's copy is now in the isolate
      const calls = spyGift(env);
      for (const ua of [PHONE, 'facebookexternalhit/1.1', 'kakaotalk-scrap/1.0', null, 'Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)']) assert.equal((await page(ua)).status, 200);
      await page(PHONE, 'HEAD');
      assert.deepEqual(calls, [], 'the page answers from the copy: the counts add no call');
      await giftSeenFlush(env, H.ctx);
      assert.deepEqual(calls, ['giftSeen'], 'they ride on the beacon batch');
      let d = dayCounts(env); assert.equal(d.hit, 2, 'two people (HEAD is not a hit)'); assert.equal(d.hitbot, 4);
      assert.equal(JSON.stringify(db(env).prepare('select * from gd').all()).includes('5.5.5.5'), false);
      env.BUDGET_REQ_DAY = '1'; clock.add(61000);
      await page(PHONE); await giftSeenFlush(env, H.ctx);
      d = dayCounts(env); assert.equal(d.hit, 2, 'not counted at hard');
    } finally { done(); }
  });

  it('botAgent: link previews, crawlers and no User-Agent are automated; phones and in-app browsers are people', () => {
    for (const ua of ['kakaotalk-scrap/1.0; +https://devtalk.kakao.com/', 'facebookexternalhit/1.1', 'Twitterbot/1.0', 'Slackbot-LinkExpanding 1.0', 'Mozilla/5.0 (compatible; Discordbot/2.0)', 'TelegramBot (like TwitterBot)',
      'WhatsApp/2.23.20.0', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'Mozilla/5.0 (compatible; Yeti/1.1)', 'Mozilla/5.0 (compatible; Daumoa/4.0)', 'Daumoa', 'kakaotalk-scrap/1.0', 'LinkedInBot/1.0', 'SomeCrawler/1', 'my-spider', 'Link Preview', '', '   ', null, undefined]) assert.equal(botAgent(ua), true, String(ua));
    for (const ua of ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 KAKAOTALK 10.8.0', 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.10.4)',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36 DaumApps/5.8.1 DaumDevice/mobile', 'DaumApps/5.8.1', 'KAKAOTALK 10.4.5']) assert.equal(botAgent(ua), false, ua);
    // The plaza's link counts (worker.js LINK_BOT, linkWho) split the same way: the two lists are one list.
    const re = (f, name) => { const m = new RegExp('const ' + name + ' = (/[^\\n]*?/i);').exec(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n')); assert.ok(m, f); return m[1]; };
    assert.equal(re('giftrules.js', 'BOT_UA'), re('worker.js', 'LINK_BOT'));
  });

  // The gift DO's giftSeen held until released, or made to fail: what the isolate does with its batch then.
  const gate = (env) => {
    const real = env.METER.get, ctl = { fail: 0, hold: null, sizes: [] };
    env.METER.get = (n) => { const m = real(n); return n !== 'gift' ? m : new Proxy(m, { get: (t, k) => (k !== 'giftSeen' ? t[k] : async (items, now) => {
      ctl.sizes.push(items.length); if (ctl.hold) await ctl.hold; if (ctl.fail > 0) { ctl.fail--; throw new Error('slow'); } return t.giftSeen(items, now);
    }) }); };
    return ctl;
  };
  const raw = (env, p, body, ip) => worker.fetch(new Request('https://sq.example' + p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body) }), env, { waitUntil() {} });

  it('the batch: at most 200 items a call, the rest wait for the next; nothing past the cap is lost to a slow call', async () => {
    const { done } = setup();
    try {
      await drain();
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM(), A.token)).json();
      const ctl = gate(env); let open; ctl.hold = new Promise((ok) => { open = ok; });
      for (let i = 1; i <= 25; i++) await raw(env, '/rt/gift/' + r.id + '/seen', { v: VIS(i), e: 'open' }, '10.0.0.1'); // the 25th starts a call that hangs
      assert.equal(giftSeenState().busy, true);
      for (let i = 26; i <= 275; i++) await raw(env, '/rt/gift/' + r.id + '/seen', { v: VIS(i), e: 'open' }, '10.0.' + Math.ceil(i / 100) + '.2');
      await raw(env, '/rt/gift/' + r.id + '/heart', { v: VIS(500) }, '10.9.9.9');
      assert.equal(giftSeenState().list, 251, 'kept while the call is out');
      open(); ctl.hold = null; await giftSeenFlush(env, H.ctx); // waits for the call that was out
      assert.equal(giftSeenState().list, 251);
      await giftSeenFlush(env, H.ctx); assert.equal(giftSeenState().list, 51, '200 went, the rest wait');
      await giftSeenFlush(env, H.ctx); assert.equal(giftSeenState().list, 0);
      assert.deepEqual(ctl.sizes, [25, 200, 51]);
      const row = db(env).prepare('select v, hr from gb where id = ?').get(r.id);
      assert.deepEqual({ ...row }, { v: 276, hr: 1 }, 'every device and the heart counted');
    } finally { done(); }
  });

  it('a failed call puts its items back once: the heart counts on the next call; a second failure drops them', async () => {
    const { done } = setup();
    try {
      await drain();
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM(), A.token)).json();
      const ctl = gate(env);
      await heart(H, r.id, 1, '11.1.1.1'); await H.post('/rt/gift/' + r.id + '/seen', { v: VIS(2), e: 'open' }, null, '11.1.1.1');
      ctl.fail = 1; await giftSeenFlush(env, H.ctx);
      assert.equal(giftSeenState().list, 2, 'back in the isolate');
      await giftSeenFlush(env, H.ctx);
      assert.deepEqual({ ...db(env).prepare('select v, hr from gb where id = ?').get(r.id) }, { v: 2, hr: 1 });
      await heart(H, r.id, 3, '11.1.1.1');
      ctl.fail = 2; await giftSeenFlush(env, H.ctx); assert.equal(giftSeenState().list, 1); await giftSeenFlush(env, H.ctx);
      assert.equal(giftSeenState().list, 0, 'put back once only');
      assert.equal(db(env).prepare('select hr from gb where id = ?').get(r.id).hr, 1);
    } finally { done(); }
  });

  it('the hits\' budget check and call run after the answer: a request does not wait for a slow budget level', async () => {
    const { clock, done } = setup();
    try {
      await drain();
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM(), A.token)).json();
      await H.call('/g/' + r.id, { headers: { 'cf-connecting-ip': '14.1.1.1', 'user-agent': 'Twitterbot/1.0' } });
      clock.add(GIFT.seenMs);
      let release, asked = 0; const late = new Promise((ok) => { release = ok; });
      const k = { lvlNow: () => (++asked === 1 ? late.then(() => 0) : Promise.resolve(0)), tokenOf: () => '', resolveActor: async () => null, ipHash: async () => 'n', adminOk: () => false };
      const waits = [], ctx = { waitUntil(p) { waits.push(p); } };
      const req = new Request('https://sq.example/rt/gift/' + r.id, { headers: { 'cf-connecting-ip': '14.1.1.1' } });
      const res = await Promise.race([giftApi(req, env, ctx, new URL(req.url), k), new Promise((ok) => setTimeout(() => ok('waited'), 300))]);
      assert.notEqual(res, 'waited', 'the answer came while the budget level was still out');
      assert.equal(res.status, 200); assert.equal(asked >= 1, true, 'the check was asked, in waitUntil');
      assert.equal(dayCounts(env).hitbot, undefined, 'nothing sent yet');
      release(); await Promise.all(waits); await Promise.all(waits);
      assert.equal(dayCounts(env).hitbot, 1, 'sent once the level came back');
    } finally { done(); }
  });

  it('link hits that no beacon took go by themselves once they waited: one DO call per interval per isolate, not at hard; only for a board that is there', async () => {
    const { clock, done } = setup();
    try {
      await drain();
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM(), A.token)).json();
      const page = (id = r.id) => H.call('/g/' + id, { headers: { 'cf-connecting-ip': '12.1.1.1', 'user-agent': 'facebookexternalhit/1.1' } });
      await page(); const calls = spyGift(env), seenOf = () => calls.filter((c) => c === 'giftSeen');
      await page(); assert.deepEqual(seenOf(), [], 'not due yet');
      clock.add(GIFT.seenMs);
      await page(); assert.deepEqual(seenOf(), ['giftSeen'], 'due: one call, the next request in this isolate');
      assert.equal(dayCounts(env).hitbot, 3);
      clock.add(1000); await page(); clock.add(GIFT.seenMs - 2000); await H.get('/rt/gift/' + r.id);
      assert.deepEqual(seenOf(), ['giftSeen'], 'not again within the interval');
      clock.add(2000); await H.get('/rt/gift/' + r.id);
      assert.deepEqual(seenOf(), ['giftSeen', 'giftSeen'], 'giftApi sends them too'); assert.equal(dayCounts(env).hitbot, 4);
      assert.equal((await page('zzzzzzzz')).status, 404);
      clock.add(GIFT.seenMs + 1000); await page(); calls.length = 0; await giftSeenFlush(env, H.ctx);
      assert.equal(dayCounts(env).hitbot, 5, 'a board that is not there is no hit');
      await page(); env.BUDGET_REQ_DAY = '1'; clock.add(61000); calls.length = 0;
      await H.get('/rt/gift/' + r.id); await page();
      assert.deepEqual(calls, [], 'not at hard'); assert.equal(giftSeenState().hits, 1, 'kept for later');
    } finally { done(); }
  });

  it('the hearts\' network marks go the next day on the beacon path (once a day), not only on a make or an admin call', async () => {
    const { clock, done } = setup();
    try {
      await drain();
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM(), A.token)).json();
      await heart(H, r.id, 1, '13.1.1.1'); await giftSeenFlush(env, H.ctx);
      const marks = () => db(env).prepare("select count(*) n from gr where k >= 'h:' and k < 'h;'").get().n;
      assert.equal(marks(), 1, 'today: kept for the cap');
      clock.add(864e5);
      await H.post('/rt/gift/' + r.id + '/seen', { v: VIS(2), e: 'open' }, null, '13.1.1.1'); await giftSeenFlush(env, H.ctx);
      assert.equal(marks(), 0, 'the next day: gone');
      assert.equal(db(env).prepare("select n from gr where k = 'hprune' and d = ?").get(today()).n, 1, 'once a day');
    } finally { done(); }
  });

  it('makers in the admin statistics: distinct this KST week (from Monday), one board or two and more over 30 days; made_again', async () => {
    const { clock, done } = setup();
    try {
      await drain();
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), B = await H.guest('2.2.2.2'), C = await H.guest('3.3.3.3');
      await H.post('/rt/gift', FORM(), A.token, '1.1.1.1'); await H.post('/rt/gift', FORM({ to: '수아' }), A.token, '1.1.1.1');
      await H.post('/rt/gift', FORM(), B.token, '2.2.2.2'); await H.post('/rt/gift', FORM(), C.token, '3.3.3.3');
      let st = await (await H.admin('/rt/admin/gift/stats')).json();
      const dow = (new Date(today() + 'T00:00:00Z').getUTCDay() + 6) % 7;
      assert.deepEqual(st.makers.week, { from: addDays(today(), -dow), n: 3 });
      assert.equal(new Date(st.makers.week.from + 'T00:00:00Z').getUTCDay(), 1, 'a Monday');
      assert.deepEqual(st.makers.d30, { one: 2, more: 1 });
      assert.equal(st.days.find((x) => x.d === today()).made_again, 1, 'A\'s second board');
      clock.add(7 * 864e5); // the same weekday next week: last week's makers are not this week's
      st = await (await H.admin('/rt/admin/gift/stats')).json();
      assert.equal(st.makers.week.n, 0); assert.deepEqual(st.makers.d30, { one: 2, more: 1 }, 'still in the 30 days (and still kept)');
      await H.post('/rt/gift', FORM(), B.token, '2.2.2.2');
      st = await (await H.admin('/rt/admin/gift/stats')).json();
      assert.equal(st.makers.week.n, 1); assert.deepEqual(st.makers.d30, { one: 1, more: 2 });
    } finally { done(); }
  });
});

// B2C free season (2026-11-27): 내 전광판 and the new days through the Worker, the owner's DISCOVER switch (off by default, only the
// owner, only then in /rt/world), the ladder's arm-tagged counts with the price shown, and the account nudge's beacons.
describe('B2C: 내 전광판, DISCOVER opt-in, ladder arms', () => {
  it('a board of one\'s own is made like a gift, keeps no sender, and the new days are taken; old days unchanged', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const me = await (await H.post('/rt/gift', FORM({ occ: 'me', to: '민지', from: '누군가', msg: '올해는 꼭 해낸다!' }), A.token)).json();
      assert.equal(me.ok, true, JSON.stringify(me)); assert.equal(me.gift.occ, 'me'); assert.equal(me.gift.from, ''); assert.equal(me.gift.th, 'night');
      for (const occ of ['love', 'grad']) assert.equal((await (await H.post('/rt/gift', FORM({ occ, to: occ }), A.token)).json()).ok, true, occ);
      const bad = await (await H.post('/rt/gift', FORM({ occ: 'me', to: '' }), A.token)).json();
      assert.equal(bad.code, 'me'); assert.equal(bad.field, 'to');
      assert.equal((await (await H.post('/rt/gift', FORM({ occ: 'constructor' }), A.token)).json()).code, 'occ');
      const page = await (await H.get('/g/' + me.id)).text();
      assert.match(page, /민지님의 전광판/); assert.equal(page.includes('민지님을 위한'), false);
    } finally { done(); }
  });

  it('DISCOVER: off until the owner turns it on, only the owner, shown in the world entry only while on', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest(), B = await H.guest('4.4.4.4');
      const r = await (await H.post('/rt/gift', FORM(), A.token)).json(), p = '/rt/gift/' + r.id + '/discover';
      assert.equal(r.mine.dc, 0, 'off by default');
      clock.add(61000);
      let w = await (await H.get('/rt/world')).json();
      assert.equal('dc' in w.gifts[0], false);
      assert.equal((await H.post(p, { on: true }, B.token, '4.4.4.4')).status, 403, 'not the owner');
      assert.equal((await H.post(p, { on: true })).status, 401);
      assert.equal((await H.post(p, { on: 'yes' }, A.token)).status, 400);
      const on = await H.post(p, { on: true }, A.token); assert.equal(on.status, 200); assert.deepEqual(await on.json(), { ok: true, dc: 1 });
      assert.equal((await (await H.get('/rt/gift/' + r.id, A.token)).json()).mine.dc, 1);
      assert.equal('dc' in (await (await H.get('/rt/gift/' + r.id)).json()).gift, false, 'the public read does not carry the switch');
      clock.add(61000);
      w = await (await H.get('/rt/world')).json();
      assert.equal(w.gifts.find((g) => g.id === r.id).dc, 1);
      assert.equal(dayCounts(env).discover_on, 1);
      assert.deepEqual(await (await H.post(p, { on: false }, A.token)).json(), { ok: true, dc: 0 });
      w = await (await H.get('/rt/world')).json(); // no wait: turning it off drops this isolate's world copies at once (a privacy action)
      assert.equal('dc' in w.gifts.find((g) => g.id === r.id), false);
      assert.equal((await H.post(p, { on: true }, A.token)).status, 200);
      env.BUDGET_REQ_DAY = '1'; clock.add(61000); await H.get('/rt/world'); clock.add(61000);
      let calls = spyGift(env);
      const busy = await H.post(p, { on: true }, A.token);
      assert.equal(busy.status, 503); assert.equal(calls.includes('giftDiscover'), false, 'turning it on: no DO call at hard');
      const off = await H.post(p, { on: false }, A.token);
      assert.equal(off.status, 200, 'turning it off goes through at hard'); assert.deepEqual(await off.json(), { ok: true, dc: 0 });
      assert.deepEqual(calls.filter((c) => c === 'giftDiscover'), ['giftDiscover'], 'one DO call');
      calls = null;
    } finally { done(); }
  });

  it('the ladder counts per arm and kind with the price that arm showed; the old keys stay', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const g = await (await H.post('/rt/gift', FORM(), A.token)).json(), m = await (await H.post('/rt/gift', FORM({ occ: 'me' }), A.token)).json();
      assert.deepEqual(g.mine.ladder, { a: 'A', p: [0, 3900, 7900, 14900] });
      for (const [id, body] of [[g.id, { act: 'view' }], [g.id, { act: 'pick', t: 2 }], [m.id, { act: 'view' }], [m.id, { act: 'pick', t: 3 }], [g.id, { act: 'notify', t: 2, consent: true }]]) assert.equal((await H.post('/rt/gift/' + id + '/interest', body, A.token)).status, 200, JSON.stringify(body));
      const d = dayCounts(env);
      assert.equal(d.ladder, 2); assert.equal(d['pick:2'], 1); assert.equal(d['pick:3'], 1); assert.equal(d['notify:2'], 1);
      assert.equal(d['ladder:A:g'], 1); assert.equal(d['ladder:A:me'], 1);
      assert.equal(d['pick:2:A:g:7900'], 1); assert.equal(d['pick:3:A:me:14900'], 1); assert.equal(d['notify:2:A:g:7900'], 1);
    } finally { done(); }
  });

  it('GIFT_ARMS splits boards between arms by id; the owner\'s read names the board\'s arm and the counts carry its price', async () => {
    const { done } = setup();
    try {
      const env = makeEnv({ GIFT_ARMS: 'A:3900/7900/14900;B:2900/5900/11900' }), H = harness(env);
      let hit = null;
      for (let i = 0; i < 24 && !hit; i++) { // three boards a guest and day: a new guest every three (1 in 2^24 to see no B)
        const ip = '9.9.' + Math.floor(i / 3) + '.1', G = i % 3 === 0 ? (H.cur = await H.guest(ip)) : H.cur;
        const r = await (await H.post('/rt/gift', FORM({ to: '친구' + i }), G.token, ip)).json();
        assert.equal(r.ok, true, JSON.stringify(r));
        if (r.mine.ladder.a === 'B') hit = { r, G, ip };
      }
      assert.ok(hit, 'some board lands in B');
      assert.deepEqual(hit.r.mine.ladder.p, [0, 2900, 5900, 11900]);
      assert.equal((await H.post('/rt/gift/' + hit.r.id + '/interest', { act: 'pick', t: 2 }, hit.G.token, hit.ip)).status, 200);
      assert.equal(dayCounts(env)['pick:2:B:g:5900'], 1);
    } finally { done(); }
  });

  it('before the reveal nobody but the owner reads the line or the sender: page data, the public read, the link card; after it, all of it', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest(), B = await H.guest('4.4.4.4');
      const r = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 18, msg: '비밀 메시지', from: '지수' }), A.token)).json();
      assert.equal(r.gift.msg, '비밀 메시지', 'the maker\'s own answer is whole');
      const html = await (await H.get('/g/' + r.id)).text();
      const data = JSON.parse(/<script id="gift-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
      assert.equal(data.gift.msg, ''); assert.equal(data.gift.from, ''); assert.equal(data.gift.hide, 1); assert.equal(data.gift.to, '민지');
      assert.equal(html.includes('비밀 메시지') || html.includes('지수'), false, 'nowhere in the page');
      assert.match(html, new RegExp('og:image" content="https://sq\\.example/rt/gift/' + r.id + '/card\\.jpg\\?t=1"'), 'the teaser card before the reveal');
      const pub = await (await H.get('/rt/gift/' + r.id, B.token)).json();
      assert.equal(pub.own, false); assert.equal(pub.gift.msg, ''); assert.equal(pub.gift.from, ''); assert.equal(pub.gift.hide, 1);
      assert.equal((await (await H.get('/rt/gift/' + r.id)).json()).gift.msg, '', 'no token: the same');
      const mine = await (await H.get('/rt/gift/' + r.id, A.token)).json();
      assert.equal(mine.own, true); assert.equal(mine.gift.msg, '비밀 메시지'); assert.equal(mine.gift.from, '지수'); assert.equal('hide' in mine.gift, false);
      // The cards: the full one waits for the reveal; the teaser is its own upload.
      const card = (q = '') => H.get('/rt/gift/' + r.id + '/card.jpg' + q);
      const put = (q, body) => H.call('/rt/gift/' + r.id + '/card' + q, { method: 'POST', headers: { authorization: 'Bearer ' + A.token, 'content-type': 'image/jpeg' }, body });
      const full = JPEG(), teaser = JPEG(); teaser[100] = 7;
      assert.equal((await put('', full)).status, 200); assert.equal((await put('?t=1', teaser)).status, 200);
      const early = await card();
      assert.equal(early.status, 302); assert.match(early.headers.get('location'), new RegExp('/rt/gift/' + r.id + '/card\\.jpg\\?t=1$')); assert.equal(early.headers.get('cache-control'), 'no-store');
      const t = await card('?t=1'); assert.equal(t.status, 200); assert.equal(new Uint8Array(await t.arrayBuffer())[100], 7, 'the teaser');
      clock.add(30 * 36e5); // past 18:00 tomorrow: revealed
      const html2 = await (await H.get('/g/' + r.id)).text();
      const data2 = JSON.parse(/<script id="gift-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html2)[1]);
      assert.equal(data2.gift.msg, '비밀 메시지'); assert.equal(data2.gift.from, '지수'); assert.equal('hide' in data2.gift, false);
      assert.match(html2, new RegExp('og:image" content="https://sq\\.example/rt/gift/' + r.id + '/card\\.jpg"'));
      assert.equal((await (await H.get('/rt/gift/' + r.id, B.token)).json()).gift.msg, '비밀 메시지');
      const late = await card(); assert.equal(late.status, 200); assert.equal(new Uint8Array(await late.arrayBuffer())[100], 0, 'the full card');
    } finally { done(); }
  });

  it('the account nudge and the card save are counted page beacons', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM(), A.token)).json();
      for (const e of ['signup_nudge', 'signup_from_gift', 'card_save']) await H.post('/rt/gift/' + r.id + '/seen', { v: VIS(3), e });
      await giftSeenFlush(env, H.ctx);
      const d = dayCounts(env);
      assert.deepEqual([d['ev:signup_nudge'], d['ev:signup_from_gift'], d['ev:card_save']], [1, 1, 1]);
    } finally { done(); }
  });
});
