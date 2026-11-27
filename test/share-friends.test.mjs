// 공유 보상 (owner, 2026-11-27): a friend who came through the maker's link and reacted pays the maker, on gift board pages, wish links
// (/rt/w/<id> then 💖 within 24 h) and board links (/rt/card/<slot> then 응원 within 24 h, same holder). One network once per maker and KST
// day over all three; account friends +50 (1-10) / +20 (11-30), guests +10, nothing past 30; the maker's network and account never; bots
// and reactions with no link never; budget hard writes nothing; a refused grant is undone; the operator's list sits behind the admin gate;
// "친구 N명이 응원했어요" is the only public word of it. Real DOs on in-memory SQLite, as tower-worker.test.mjs and inbox-room.test.mjs.
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
const W = await import('../worker.js');
const worker = W.default, { Meter, Room, wishIp, viaKeys } = W;
const { kstDay, addDays } = await import('../giftrules.js');
const { giftSeenFlush } = await import('../giftsrv.js');
const { SHARE } = await import('../towerrules.js');

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
// Fake Supabase: RPC calls written down (grant_coins answers from state.grant), billboards from state.boards, claim_billboard lights one.
function fakeNet(state) {
  return async (url, opt = {}) => {
    const u = String(url); state.calls.push(u);
    if (u.includes('/.well-known/jwks.json')) return json({ keys: state.jwks || [] });
    if (u.includes('/rest/v1/billboards')) { const m = /slot_id=eq\.(\w+)/.exec(u); return json(state.boards.filter((x) => !m || x.slot_id === m[1]).map((x) => ({ ...x }))); }
    if (u.includes('/rpc/')) {
      const name = u.split('/rpc/')[1].split('?')[0], body = JSON.parse(opt.body || '{}'); state.rpc.push({ name, ...body });
      if (name === 'grant_coins') return json(state.grant ? state.grant(body) : { ok: true, coins: 1000 });
      if (name === 'claim_billboard') { const until = new Date(Date.now() + 72 * 36e5).toISOString(), row = { slot_id: body.p_slot_id, holder_id: body.p_actor_id, holder_name: body.p_nickname, line1: body.p_line1, line2: '', line3: '', current_bid: body.p_bid, lit_until: until, expires_at: until, photo_id: null };
        state.boards = state.boards.filter((x) => x.slot_id !== body.p_slot_id).concat(row); return json({ ok: true, billboard: { ...row }, remaining_coins: 1000, prev_holder_id: null }); }
      return json({ ok: true });
    }
    if (u.includes('/rest/v1/')) return json([]);
    return new Response('missing', { status: 404 });
  };
}
const grants = (state, uid) => state.rpc.filter((r) => r.name === 'grant_coins' && (!uid || r.p_actor_id === uid)).map((r) => r.p_amount);
const NET = (i) => '10.0.' + Math.floor(i / 250) + '.' + (1 + (i % 250));
const PERSON = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 KAKAOTALK 10.4.0';
function harness(env) {
  const waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (p, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + p, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const guest = async (ip = '1.1.1.1') => { const t = (await (await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: '{}' })).json()).token; return { token: t, id: 'guest:' + JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).s }; };
  // One browser per network here: the kts_via cookie a share page sets goes back with that network's later requests.
  env.jar = env.jar || {};
  const jar = (ip, h) => (env.jar[ip] && !('cookie' in h) ? { cookie: 'kts_via=' + env.jar[ip] } : {});
  const keep = (ip, res) => { const m = /kts_via=([^;]*)/.exec(String(res.headers.get('set-cookie') || '')); if (m) env.jar[ip] = m[1]; return res; };
  const post = (p, body, token, ip = '1.1.1.1', h = {}) => call(p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(token ? { authorization: 'Bearer ' + token } : {}), ...jar(ip, h), ...h }, body: JSON.stringify(body) });
  const get = async (p, { token, ip = '1.1.1.1', ua = PERSON, h = {} } = {}) => keep(ip, await call(p, { headers: { 'cf-connecting-ip': ip, ...(ua ? { 'user-agent': ua } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}), ...jar(ip, h), ...h } }));
  const admin = (p) => call(p, { headers: { 'x-admin-key': env.ADMIN_KEY } });
  return { call, guest, post, get, admin, ctx };
}
let clockBase = Date.parse('2028-03-01T01:00:00Z'); // 10:00 KST
function setup() {
  clockBase += 60 * 864e5; let t = clockBase; const orig = Date.now; Date.now = () => t;
  const prevFetch = globalThis.fetch, state = { calls: [], rpc: [], boards: [] };
  globalThis.fetch = fakeNet(state); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  return { clock: { add: (ms) => { t += ms; }, now: () => t }, state, done: () => { globalThis.fetch = prevFetch; Date.now = orig; } };
}
// Supabase user tokens (linked accounts): one published key, any number of subjects.
async function signer(state, clock) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  state.jwks = [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'share-kid' }];
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), head = enc({ alg: 'ES256', kid: 'share-kid' });
  return async (sub) => {
    const claims = enc({ sub, exp: Math.floor(clock.now() / 1000) + 7 * 86400, iss: 'https://yxddhpacuyaffaoutxjn.supabase.co/auth/v1', aud: 'authenticated' });
    return { token: head + '.' + claims + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(head + '.' + claims))).toString('base64url'), id: 'user:' + sub };
  };
}
const today = () => kstDay(Date.now());
const FORM = (o = {}) => ({ to: '민지', from: '친구들', occ: 'bday', msg: '생일 축하해!', day: today(), at: 'now', ...o });
const gdb = (env) => env.meter('gift').sql.db;
const VIS = (n) => String(n).padStart(16, 'a');
const heart = async (H, env, id, i, ip, token) => { const r = await H.post('/rt/gift/' + id + '/heart', { v: VIS(i) }, token, ip); await giftSeenFlush(env, H.ctx); return r; };
const netOf = (env, ip) => wishIp(env, new Request('https://x/', { headers: { 'cf-connecting-ip': ip } }));
const wishPost = async (H, M, ip) => (await (await H.post('/rt/wish', { text: '합격하게 해 주세요', nick: '나' }, M.token, ip)).json()).wish;
const wishHeart = (H, F, id, ip) => H.post('/rt/wish/heart', { id }, F.token, ip);
const lit = (slot, holder, ms = 864e5) => ({ slot_id: slot, holder_id: holder, holder_name: '주인', line1: '우리 가게', line2: '', line3: '', lit_until: new Date(Date.now() + ms).toISOString(), expires_at: null });
// A plaza socket in room SQ, as the Worker's upgrade leaves it (x-net: the network hash, x-anon: a guest or an anonymous login).
const SQ = 'chapel:square';
async function sock(env, id, ip, guest = true) {
  const room = env.room(SQ).do;
  const ws = { sent: [], send(s) { this.sent.push(JSON.parse(String(s))); }, close() {}, serializeAttachment() {}, deserializeAttachment() { return null; } };
  ws.a = { k: id, an: guest, nt: await netOf(env, ip), via: viaKeys(env.jar?.[ip] ? 'kts_via=' + env.jar[ip] : ''), q: true, v2: true, fl: 0, lob: false, t: Date.now(), ls: Date.now(), m: { x: 1500, y: 1500, fl: 0, name: '친구' } };
  room.socks().set(ws, ws.a);
  return { room, ws };
}
const cheer = async ({ room, ws }, slot) => { ws.a.ls = Date.now(); room.socks().set(ws, ws.a); await room.webSocketMessage(ws, JSON.stringify({ t: 'CHEER', slot, p: 1 })); await room.shareP; return ws.sent.filter((m) => m.t === 'PAY' && m.kind === 'cheer').pop(); };

describe('gift board pages: account vs guest, one network once', { concurrency: false }, () => {
  it('a 💖 with the account token pays +50, one without (or a guest\'s) +10; two devices on one network count once', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), user = await signer(state, clock), U = await user('acct-f1');
      const r = await (await H.post('/rt/gift', FORM(), A.token, '1.1.1.1')).json();
      await heart(H, env, r.id, 1, '2.2.2.2', U.token);
      await heart(H, env, r.id, 2, '3.3.3.3');
      await heart(H, env, r.id, 3, '3.3.3.3'); // the same network, another device: a heart, not a second friend
      const G = await H.guest('4.4.4.4'); await heart(H, env, r.id, 4, '4.4.4.4', G.token);
      assert.deepEqual(grants(state, A.id), [50, 10, 10]);
      assert.equal(gdb(env).prepare('select count(*) n from sf where uid = ?').get(A.id).n, 3);
    } finally { done(); }
  });
  it('the maker\'s own account never counts, from any network', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), user = await signer(state, clock), M = await user('maker-1');
      const r = await (await H.post('/rt/gift', FORM(), M.token, '1.1.1.1')).json();
      await heart(H, env, r.id, 1, '9.9.9.9', M.token);
      assert.deepEqual(grants(state, M.id), []);
    } finally { done(); }
  });
  it('steps: friends 1-10 +50 (account) / +10 (guest), 11-30 +20 / +10, the 31st nothing but still counted', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), user = await signer(state, clock);
      const r = await (await H.post('/rt/gift', FORM(), A.token, '1.1.1.1')).json();
      for (let i = 0; i < 31; i++) await heart(H, env, r.id, i + 1, NET(i), i < 12 || i === 30 ? (await user('f' + i)).token : '');
      assert.deepEqual(grants(state, A.id), [...Array(10).fill(50), 20, 20, ...Array(18).fill(10)]);
      assert.equal(gdb(env).prepare('select count(*) n from sf where uid = ?').get(A.id).n, 31, 'the 31st is counted for the operator');
      clock.add(864e5);
      await heart(H, env, r.id, 99, NET(77), (await user('next-day')).token);
      assert.equal(grants(state, A.id).at(-1), 50, 'a new KST day starts again at +50');
    } finally { done(); }
  });
  it('a grant that fails is undone: unpaid, and its place goes to the next friend', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1');
      const r = await (await H.post('/rt/gift', FORM(), A.token, '1.1.1.1')).json();
      state.grant = () => ({ ok: false, error: '그 지갑을 찾지 못했습니다.' });
      await heart(H, env, r.id, 1, NET(1));
      assert.deepEqual(gdb(env).prepare('select amt, st from sf where uid = ?').all(A.id).map((x) => [x.amt, x.st]), [[0, 'fail']]);
      delete state.grant; await heart(H, env, r.id, 2, NET(2));
      assert.deepEqual(gdb(env).prepare('select amt, st from sf where uid = ? order by at').all(A.id).map((x) => [x.amt, x.st]), [[0, 'fail'], [10, '']]);
      assert.equal(gdb(env).prepare("select n from gd where k = 'tpay_fail'").get()?.n, 1);
    } finally { done(); }
  });
});

describe('wish links', { concurrency: false }, () => {
  it('a human open of /rt/w/<id> then 💖 on that wish pays the author (+50 an account, +10 a guest); a bot open or no open pays nothing', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), M = await H.guest('1.1.1.1'), w = await wishPost(H, M, '1.1.1.1'), user = await signer(state, clock);
      const F1 = await user('wf1'), F2 = await H.guest('2.2.2.2'), F3 = await H.guest('3.3.3.3'), F4 = await H.guest('4.4.4.4');
      assert.equal((await H.get('/rt/w/' + w.id, { ip: '5.5.5.5' })).status, 200);
      assert.equal((await wishHeart(H, F1, w.id, '5.5.5.5')).status, 200);
      await H.get('/rt/w/' + w.id, { ip: '2.2.2.2' }); await wishHeart(H, F2, w.id, '2.2.2.2');
      await H.get('/rt/w/' + w.id, { ip: '3.3.3.3', ua: 'kakaotalk-scrap/1.0' }); await wishHeart(H, F3, w.id, '3.3.3.3'); // only the preview fetcher opened it
      await wishHeart(H, F4, w.id, '4.4.4.4'); // came another way
      assert.deepEqual(grants(state, M.id), [50, 10]);
      assert.equal(gdb(env).prepare("select count(*) n from sl where k = ?").get('w:' + w.id).n, 2, 'the bot open is not kept');
    } finally { done(); }
  });
  it('the author\'s own network never counts (another account on the network the wish was posted from)', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), M = await H.guest('1.1.1.1'), w = await wishPost(H, M, '1.1.1.1'), alt = await H.guest('1.1.1.1');
      await H.get('/rt/w/' + w.id, { ip: '1.1.1.1' }); await wishHeart(H, alt, w.id, '1.1.1.1');
      assert.deepEqual(grants(state, M.id), []);
    } finally { done(); }
  });
  it('one network counts once a day over all the maker\'s things: a gift 💖 and then a wish 💖 from it pay once', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), M = await H.guest('1.1.1.1'), F = await H.guest('6.6.6.6');
      const g = await (await H.post('/rt/gift', FORM(), M.token, '1.1.1.1')).json(), w = await wishPost(H, M, '1.1.1.1');
      await heart(H, env, g.id, 1, '6.6.6.6', F.token);
      await H.get('/rt/w/' + w.id, { ip: '6.6.6.6' }); await wishHeart(H, F, w.id, '6.6.6.6');
      assert.deepEqual(grants(state, M.id), [10]);
      assert.equal(gdb(env).prepare('select count(*) n from sf where uid = ?').get(M.id).n, 1);
      assert.equal(gdb(env).prepare("select count(*) n from sk where k = ?").get('w:' + w.id).n, 1, 'still one of the wish\'s friends');
    } finally { done(); }
  });
  it('the wish page shows "친구 N명이 응원했어요" (per network, nothing at 0) and never an amount', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), M = await H.guest('1.1.1.1'), w = await wishPost(H, M, '1.1.1.1');
      let html = await (await H.get('/rt/w/' + w.id, { ip: '7.7.7.7' })).text();
      assert.equal(html.includes('친구'), false, 'no line at 0');
      const F = await H.guest('7.7.7.7'), F2 = await H.guest('7.7.7.7');
      await wishHeart(H, F, w.id, '7.7.7.7'); await wishHeart(H, F2, w.id, '7.7.7.7'); // two accounts, one network
      W.shareCountDrop?.();
      html = await (await H.get('/rt/w/' + w.id, { ip: '8.8.8.8' })).text();
      assert.ok(html.includes('친구 1명이 응원했어요'), html);
      assert.equal(/포인트|\+50|\+10|손님|계정/.test(html), false, 'only the count');
    } finally { done(); }
  });
  it('budget hard: an open writes nothing and asks the gift store nothing', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), M = await H.guest('1.1.1.1'), w = await wishPost(H, M, '1.1.1.1');
      await H.get('/rt/w/' + w.id, { ip: '9.9.9.9' }); // fills the single-wish copy
      env.BUDGET_REQ_DAY = '1'; clock.add(61000); await H.get('/rt/w/' + w.id, { ip: '9.9.9.8' }); clock.add(61000);
      const calls = [], real = env.METER.get; env.METER.get = (n) => { if (n === 'gift') calls.push(n); return real(n); };
      assert.equal((await H.get('/rt/w/' + w.id, { ip: '9.9.9.7' })).status, 200);
      assert.deepEqual(calls, [], 'no gift DO call at hard');
      assert.equal(gdb(env).prepare("select count(*) n from sl where net = ?").get(await netOf(env, '9.9.9.7')).n, 0);
    } finally { done(); }
  });
});

describe('board (card) links', { concurrency: false }, () => {
  it('a human open of /rt/card/<slot> then 응원 within 24 h pays the holder; after 24 h, or once the board changed hands, nothing', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), M = await H.guest('1.1.1.1'), user = await signer(state, clock), F = await user('cf1'), G2 = await H.guest('2.2.2.2');
      state.boards = [lit('STREET_8', M.id, 5 * 864e5)];
      assert.equal((await H.get('/rt/card/STREET_8', { ip: '5.5.5.5' })).status, 200);
      const s1 = await sock(env, F.id, '5.5.5.5', false);
      assert.ok((await cheer(s1, 'STREET_8')).amount > 0, 'the cheer itself landed');
      assert.deepEqual(grants(state, M.id), [50]);
      await H.get('/rt/card/STREET_8', { ip: '2.2.2.2' }); clock.add(SHARE.windowMs + 1000);
      await cheer(await sock(env, G2.id, '2.2.2.2'), 'STREET_8');
      assert.deepEqual(grants(state, M.id), [50], 'opened more than 24 hours before');
      // Opened while M held it, then N took the board: N's cheer from that network is no link friend of N (the Room's own board copy is
      // the plaza.test.mjs matter; here the store's rule).
      const G3 = await H.guest('3.3.3.3'), N = await H.guest('4.4.4.4');
      await H.get('/rt/card/STREET_8', { ip: '3.3.3.3' });
      const r = await env.METER.get('gift').giftShare({ o: N.id, k: 'c:STREET_8', net: await netOf(env, '3.3.3.3'), uid: G3.id, acct: false }, Date.now());
      assert.equal(r.why, 'link', 'the link was the old holder\'s');
      assert.deepEqual(grants(state, N.id), []);
    } finally { done(); }
  });
  it('the holder\'s claim network never counts; a guest friend pays +10; the card page shows the count only', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), M = await H.guest('1.1.1.1');
      await sock(env, M.id, '1.1.1.1');
      assert.equal((await H.post('/rt/claim-billboard', { topic: SQ, slot_id: 'STREET_9', bid: 300, line1: '우리 가게', nickname: '주인' }, M.token, '1.1.1.1')).status, 200);
      const alt = await H.guest('1.1.1.1'), F = await H.guest('6.6.6.6');
      await H.get('/rt/card/STREET_9', { ip: '1.1.1.1' }); await cheer(await sock(env, alt.id, '1.1.1.1'), 'STREET_9');
      assert.deepEqual(grants(state, M.id), [], 'the network the board was claimed from');
      let html = await (await H.get('/rt/card/STREET_9', { ip: '6.6.6.6' })).text();
      assert.equal(html.includes('친구'), false);
      await cheer(await sock(env, F.id, '6.6.6.6'), 'STREET_9');
      assert.deepEqual(grants(state, M.id), [10]);
      W.shareCountDrop?.();
      html = await (await H.get('/rt/card/STREET_9', { ip: '8.8.8.8' })).text();
      assert.ok(html.includes('친구 1명이 응원했어요'));
      assert.equal(/포인트|\+10|손님|계정/.test(html), false);
    } finally { done(); }
  });
});

describe('the gift page count and the operator list', { concurrency: false }, () => {
  it('a board before its reveal: the count only in the owner\'s read; after it, in the public view too', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1');
      const r = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 12 }), A.token, '1.1.1.1')).json();
      await heart(H, env, r.id, 1, '2.2.2.2'); await heart(H, env, r.id, 2, '2.2.2.2'); await heart(H, env, r.id, 3, '3.3.3.3');
      clock.add(21000); // the isolate's copy of the board (20 s)
      const pub = await (await H.get('/rt/gift/' + r.id, { ip: '9.9.9.9' })).json(), own = await (await H.get('/rt/gift/' + r.id, { token: A.token })).json();
      assert.equal('friends' in pub.gift, false, 'not before the reveal');
      assert.equal(own.mine.friends, 2, 'two networks');
      clock.add(864e5 + 3 * 36e5); // 13:00 the next day: the board is up (a scheduled board reveals at its start)
      const later = await (await H.get('/rt/gift/' + r.id, { ip: '9.9.9.8' })).json();
      assert.equal(later.gift.friends, 2);
      assert.equal(JSON.stringify(later).match(/amt|paid|acct|net/), null, 'no amounts or networks in a public read');
    } finally { done(); }
  });
  it('/rt/admin/gift/share: the last 7 days per maker (friends, account/guest, points, networks), top first; 401 without the admin key', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), B = await H.guest('1.1.1.2'), user = await signer(state, clock);
      const ra = await (await H.post('/rt/gift', FORM(), A.token, '1.1.1.1')).json(), rb = await (await H.post('/rt/gift', FORM({ to: '수아' }), B.token, '1.1.1.2')).json();
      await heart(H, env, ra.id, 1, NET(1), (await user('x1')).token); await heart(H, env, ra.id, 2, NET(2)); await heart(H, env, rb.id, 3, NET(3));
      assert.equal((await H.get('/rt/admin/gift/share')).status, 401);
      const r = await (await H.admin('/rt/admin/gift/share')).json();
      assert.equal(r.ok, true); assert.equal(r.days, 7);
      assert.deepEqual(r.top.map((x) => [x.uid, x.friends, x.acct, x.guest, x.paid, x.nets]), [[A.id, 2, 1, 1, 60, 2], [B.id, 1, 0, 1, 10, 1]]);
      assert.ok(r.top.length <= SHARE.adminTop);
      assert.equal(typeof r.total?.paid, 'number');
      const pub = await (await H.get('/rt/gift/' + ra.id)).text();
      assert.equal(pub.includes(A.id), false);
    } finally { done(); }
  });
});

describe('budget hard and the pages', { concurrency: false }, () => {
  it('a cheer at budget hard asks the gift store nothing and pays nothing', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), M = await H.guest('1.1.1.1'), F = await H.guest('5.5.5.5');
      state.boards = [lit('STREET_8', M.id)];
      await H.get('/rt/card/STREET_8', { ip: '5.5.5.5' });
      const s = await sock(env, F.id, '5.5.5.5'); s.room.lvl = 2; s.room.lastRep = Date.now();
      const calls = [], real = env.METER.get; env.METER.get = (n) => { if (n === 'gift') calls.push(n); return real(n); };
      const pay = await cheer(s, 'STREET_8');
      assert.equal(pay.why, 'wait');
      assert.deepEqual(calls, []); assert.deepEqual(grants(state, M.id), []);
    } finally { done(); }
  });
  it('the gift page sends the signed-in account\'s token with a 💖 (never a guest token) and shows the count as text, nothing at 0', () => {
    const src = fs.readFileSync(new URL('../giftpage.js', import.meta.url), 'utf8');
    const press = src.slice(src.indexOf("fetch('/rt/gift/' + g.id + '/heart'") - 400, src.indexOf("fetch('/rt/gift/' + g.id + '/heart'") + 200);
    assert.match(press, /const acc = sessionToken\(\)/);
    assert.doesNotMatch(press, /await token\(/, 'no guest token is minted or sent for a heart');
    assert.match(src, /function friendsLine\(n\) \{ const t = friendsText\(n\); return t \? h\('p', \{ class: 'sub friends', text: t \}\) : null; \}/);
    assert.match(src, /friendsLine\(extra\?\.friends\)/, 'the owner\'s page');
    assert.match(src, /friendsLine\(g\.friends\)/, 'the recipient page (giftView has it from the reveal only)');
    assert.doesNotMatch(src, /innerHTML/);
  });
  it('the operator view lists 공유 보상 많이 받은 사람 from /rt/admin/gift/share, as text', () => {
    const src = fs.readFileSync(new URL('../admin-gift.js', import.meta.url), 'utf8');
    assert.match(src, /공유 보상 많이 받은 사람/);
    assert.match(src, /api\('\/rt\/admin\/gift\/share'\)/);
    assert.match(src, /x\.unknown/, 'grants with no clear answer'); assert.match(src, /x\.waits/, 'friends the batch cap left unpaid'); assert.match(src, /'tpay_unknown'/);
    assert.doesNotMatch(src, /innerHTML/);
    const wr = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    assert.match(wr, /\/admin\*/, 'the operator page stays behind run_worker_first');
  });
});

describe('account link and withdrawal', { concurrency: false }, () => {
  it('a link moves the guest\'s share rows to the account; a withdrawal deletes every share row of the account', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), M = env.METER.get('gift'), now = Date.now(), n1 = 'a'.repeat(16), n2 = 'b'.repeat(16);
      await M.giftMakerNet('guest:g1', n1, now);
      await M.giftLinkOpen({ k: 'w:abcdefghij', o: 'guest:g1', net: n2 }, now);
      assert.equal((await M.giftShare({ o: 'guest:g1', k: 'w:abcdefghij', net: n2, uid: 'guest:f', acct: false }, now)).pay[0].amt, 10);
      await M.giftMove('guest:g1', 'user:u1');
      const db = gdb(env), rows = (t, c) => db.prepare(`select count(*) n from ${t} where ${c} = ?`);
      assert.deepEqual(['sm|uid', 'sf|uid', 'sfr|uid', 'sl|o', 'sk|o'].map((x) => { const [t, c] = x.split('|'); return [rows(t, c).get('guest:g1').n, rows(t, c).get('user:u1').n]; }), [[0, 1], [0, 1], [0, 1], [0, 1], [0, 1]]);
      await M.giftForget('user:u1', now);
      assert.deepEqual(['sm|uid', 'sf|uid', 'sfr|uid', 'sl|o', 'sk|o'].map((x) => { const [t, c] = x.split('|'); return rows(t, c).get('user:u1').n; }), [0, 0, 0, 0, 0]);
      await M.giftShare({ o: 'user:m2', k: 'w:abcdefghij', net: n1, uid: 'guest:f', acct: false }, now); // (no link: nothing)
      await M.giftForget('guest:f', now);
      assert.equal(db.prepare("select count(*) n from sfr where who = 'a:guest:f'").get().n, 0, 'nor kept as anyone\'s friend');
    } finally { done(); }
  });
});

describe('review fixes (2026-11-27)', { concurrency: false }, () => {
  const spy = (env) => { const calls = [], real = env.METER.get; env.METER.get = (n) => { if (n === 'gift') calls.push(n); return real(n); }; return calls; };
  const sfOf = (env, uid) => gdb(env).prepare('select amt, st from sf where uid = ? order by at, rowid').all(uid).map((x) => [x.amt, x.st]);
  it('1. a person\'s share page sets kts_via (HttpOnly, Secure, Lax, a day; newest first, 8 at most) and is not cached publicly; a bot gets none', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), M = await H.guest('1.1.1.1'), w = await wishPost(H, M, '1.1.1.1');
      const old = Array.from({ length: 9 }, (_, i) => 'c:STREET_' + (i + 1)).join('.');
      const res = await H.get('/rt/w/' + w.id, { ip: '5.5.5.5', h: { cookie: 'a=1; kts_via=' + old + '; b=2' } });
      const sc = String(res.headers.get('set-cookie') || '');
      assert.match(sc, /^kts_via=w:[0-9a-z]{10}(\.c:STREET_\d+){7}; /);
      assert.ok(sc.startsWith('kts_via=w:' + w.id + '.c:STREET_1.'), 'newest first, the old ones after');
      for (const a of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=86400']) assert.ok(sc.includes(a), a);
      assert.equal(res.headers.get('cache-control'), 'private, no-store');
      const bot = await H.get('/rt/w/' + w.id, { ip: '6.6.6.6', ua: 'facebookexternalhit/1.1' });
      assert.equal(bot.headers.get('set-cookie'), null); assert.match(bot.headers.get('cache-control'), /^public/);
      const card = await H.get('/rt/card/STREET_3', { ip: '6.6.6.7' });
      assert.equal(card.headers.get('set-cookie'), null, 'a board nobody holds: nothing to remember');
      assert.deepEqual(viaKeys('x=1; kts_via=w:abcdefghij.c:STREET_8.<script>.c:A B'), ['w:abcdefghij', 'c:STREET_8']);
      assert.deepEqual(viaKeys(''), []);
    } finally { done(); }
  });
  it('1. without the cookie a wish 💖 and a cheer ask the gift store nothing', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), M = await H.guest('1.1.1.1'), w = await wishPost(H, M, '1.1.1.1'), F = await H.guest('5.5.5.5');
      state.boards = [lit('STREET_8', M.id)];
      await H.get('/rt/w/' + w.id, { ip: '5.5.5.5' }); await H.get('/rt/card/STREET_8', { ip: '5.5.5.5' }); delete env.jar['5.5.5.5'];
      const calls = spy(env);
      assert.equal((await wishHeart(H, F, w.id, '5.5.5.5')).status, 200);
      await cheer(await sock(env, F.id, '5.5.5.5'), 'STREET_8');
      assert.deepEqual(calls, []); assert.deepEqual(grants(state, M.id), []);
    } finally { done(); }
  });
  it('1. the /rt/ws upgrade forwards x-via from the cookie and x-net from the address, over anything the client sent', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), G = await H.guest('5.5.5.5'); let got = null;
      env.ROOM = { idFromName: (t) => t, get: () => ({ fetch: async (req) => { got = req; return new Response('ok'); } }) };
      await H.call('/rt/ws?topic=' + encodeURIComponent(SQ), { headers: { upgrade: 'websocket', 'sec-websocket-protocol': 'masil2, at.' + G.token, 'cf-connecting-ip': '5.5.5.5', cookie: 'kts_via=c:STREET_8.w:abcdefghij', 'x-via': 'c:MAIN_UP', 'x-net': 'f'.repeat(16) } });
      assert.equal(got.headers.get('x-via'), 'c:STREET_8.w:abcdefghij');
      assert.equal(got.headers.get('x-net'), await netOf(env, '5.5.5.5'));
      await H.call('/rt/ws?topic=' + encodeURIComponent(SQ), { headers: { upgrade: 'websocket', 'sec-websocket-protocol': 'masil2, at.' + G.token, 'cf-connecting-ip': '5.5.5.5', 'x-via': 'c:MAIN_UP' } });
      assert.equal(got.headers.get('x-via'), '', 'no cookie: the client\'s own header does not pass');
    } finally { done(); }
  });
  it('2. one person counts once a day per maker: an account on a second network, a device (no token) on a second network', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), M = await H.guest('1.1.1.1'), user = await signer(state, clock), F = await user('roamer');
      const g = await (await H.post('/rt/gift', FORM(), M.token, '1.1.1.1')).json(), w = await wishPost(H, M, '1.1.1.1');
      await heart(H, env, g.id, 1, '2.2.2.2', F.token);
      await H.get('/rt/w/' + w.id, { ip: '3.3.3.3' }); await wishHeart(H, F, w.id, '3.3.3.3'); // the same account after airplane mode
      assert.deepEqual(grants(state, M.id), [50]);
      const g2 = await (await H.post('/rt/gift', FORM({ to: '수아' }), M.token, '1.1.1.1')).json();
      await heart(H, env, g2.id, 7, '4.4.4.4'); await heart(H, env, g.id, 7, '4.4.4.5'); // one device (v 7), two networks, no token
      assert.deepEqual(grants(state, M.id), [50, 10]);
      assert.equal(gdb(env).prepare('select count(*) n from sfr where uid = ?').get(M.id).n, 2);
    } finally { done(); }
  });
  it('3. a cheer from the network the holder is on in the room does not count; sharing records the maker\'s network', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), M = await H.guest('1.1.1.1'), F = await H.guest('7.7.7.7');
      state.boards = [lit('STREET_8', M.id)];
      await sock(env, M.id, '7.7.7.7'); // the holder, on the friend's wifi now
      await H.get('/rt/card/STREET_8', { ip: '7.7.7.7' });
      await cheer(await sock(env, F.id, '7.7.7.7'), 'STREET_8');
      assert.deepEqual(grants(state, M.id), []);
      const user = await signer(state, clock), U = await user('sharer');
      assert.equal((await H.post('/rt/event', { name: 'share_link' }, U.token, '8.8.8.8')).status, 200);
      assert.equal((await H.post('/rt/share-bonus', {}, U.token, '8.8.8.9')).status, 200);
      assert.deepEqual(gdb(env).prepare('select net from sm where uid = ? order by net').all(U.id).map((x) => x.net), [await netOf(env, '8.8.8.8'), await netOf(env, '8.8.8.9')].sort());
    } finally { done(); }
  });
  it('4. at budget hard a wish 💖 is 503 and the gift store is not asked', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), M = await H.guest('1.1.1.1'), w = await wishPost(H, M, '1.1.1.1'), F = await H.guest('5.5.5.5');
      await H.get('/rt/w/' + w.id, { ip: '5.5.5.5' });
      env.BUDGET_REQ_DAY = '1'; clock.add(61000); await H.get('/rt/w/' + w.id, { ip: '5.5.5.6' }); clock.add(61000);
      const calls = spy(env);
      assert.equal((await wishHeart(H, F, w.id, '5.5.5.5')).status, 503);
      assert.equal((await H.post('/rt/wish', { text: '다시', nick: '나' }, F.token, '5.5.5.5')).status, 503);
      assert.deepEqual(calls, []);
    } finally { done(); }
  });
  it('5. a grant with no clear answer keeps its place (unk); only a clear refusal frees it (fail)', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1');
      const r = await (await H.post('/rt/gift', FORM(), A.token, '1.1.1.1')).json();
      state.grant = () => { throw new Error('timeout'); };
      await heart(H, env, r.id, 1, NET(1));
      state.grant = () => ({ ok: false, error: '그 지갑을 찾지 못했습니다.' });
      await heart(H, env, r.id, 2, NET(2));
      delete state.grant; await heart(H, env, r.id, 3, NET(3));
      assert.deepEqual(sfOf(env, A.id), [[10, 'unk'], [0, 'fail'], [10, '']]);
      const top = (await (await H.admin('/rt/admin/gift/share')).json()).top[0];
      assert.deepEqual([top.unknown, top.fails, top.paid], [1, 1, 10]);
    } finally { done(); }
  });
  it('6. friends the batch cap left unpaid are "wait", not refused grants', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), ids = [];
      for (const ip of ['1.1.1.1', '1.1.1.2', '1.1.1.3']) { const M = await H.guest(ip); ids.push((await (await H.post('/rt/gift', FORM({ to: '친구' + ip.slice(-1) }), M.token, ip)).json()).id); }
      for (const [b, id] of ids.entries()) for (let i = 0; i < 5; i++) await H.post('/rt/gift/' + id + '/heart', { v: VIS(100 * b + i + 1) }, null, NET(i));
      await giftSeenFlush(env, H.ctx);
      assert.equal(grants(state).length, 10);
      assert.deepEqual(gdb(env).prepare('select st, count(*) n from sf group by st order by st').all().map((x) => [x.st, x.n]), [['', 10], ['wait', 5]]);
      const top = (await (await H.admin('/rt/admin/gift/share')).json()).top;
      assert.equal(top.reduce((s, x) => s + x.waits, 0), 5); assert.equal(top.reduce((s, x) => s + x.fails, 0), 0);
    } finally { done(); }
  });
  it('7. a 💖 pressed before midnight belongs to that KST day even when its batch goes after', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1');
      const r = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 12 }), A.token, '1.1.1.1')).json();
      clock.add(13 * 36e5 + 59 * 60e3 + 50e3); const d0 = today(); // 23:59:50 KST
      await H.post('/rt/gift/' + r.id + '/heart', { v: VIS(1) }, null, '2.2.2.2');
      clock.add(30e3); assert.notEqual(today(), d0);
      await giftSeenFlush(env, H.ctx);
      assert.deepEqual(gdb(env).prepare('select d from sf where uid = ?').all(A.id).map((x) => x.d), [d0]);
    } finally { done(); }
  });
  it('8. a network the maker posted from is no friend on the gift page either (count, tower and reward agree)', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), M = await H.guest('1.1.1.1');
      const g = await (await H.post('/rt/gift', FORM(), M.token, '1.1.1.1')).json(); await wishPost(H, M, '9.9.9.9');
      await heart(H, env, g.id, 1, '9.9.9.9');
      assert.equal(gdb(env).prepare('select count(*) n from gn where g = ?').get(g.id).n, 0);
      assert.deepEqual(grants(state, M.id), []);
    } finally { done(); }
  });
});
