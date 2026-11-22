// Package guard: the Worker's own DO calls in the daily budget, the level on the wish / share / push routes, the contact filter, the taxi fare cap.
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
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
const { WISH_ERR, cleanWish, wishFault, wishNickFault, wishDay } = await import('../wish.js');
const { PAY } = await import('../balance.js');
const toNetUnits = (m) => Math.round(m * 20 + 1500); // net.js toNetUnits (net.js needs a browser to load)

// Same harness as wish.test.mjs: real DOs on in-memory SQLite behind a stub that copies arguments and results like the runtime does.
function sqliteStorage() {
  const db = new DatabaseSync(':memory:');
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
    setWebSocketAutoResponse() {}, getWebSockets() { return []; }, getWebSocketAutoResponseTimestamp() { return new Date(Date.now()); }, acceptWebSocket() {},
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
// Every DO method call that reaches a stub, as 'instance.method', except the 'day' counter itself (Meter.add counts its own call).
function spyDo(env) {
  const log = [];
  for (const ns of [env.METER, env.ROOM]) { const real = ns.get; ns.get = (name) => { const s = real(name); return new Proxy(s, { get: (t, k) => typeof t[k] === 'function' ? (...a) => { if (name !== 'day') log.push(name + '.' + String(k)); return t[k](...a); } : t[k] }); }; }
  return log;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
function fakeSupa(state) {
  return async (url, opt) => {
    const u = String(url); state.calls.push({ url: u, body: opt?.body });
    if (u.includes('/rest/v1/billboards')) return json([{ slot_id: 'MAIN_TOP', line1: 'x' }]);
    if (u.includes('/rest/v1/plots')) return json([]);
    if (u.includes('/rest/v1/wallets')) return json([]);
    if (u.includes('/rpc/')) return json({ ok: true, flushed: 1 });
    return new Response('missing', { status: 404 });
  };
}
function harness(env) {
  const waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (path, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + path, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const guest = async () => { const t = (await (await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).token; return { token: t, id: 'guest:' + JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).s }; };
  const post = (path, body, token, ip = '1.1.1.1') => call(path, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const get = (path, token) => call(path, { headers: token ? { authorization: 'Bearer ' + token } : {} });
  return { call, guest, post, get };
}
let clockBase = Date.parse('2027-03-01T03:00:00Z');
// Each test runs days apart, so the isolate copies (level, tally, wish list, settlement, world) of an earlier test are stale for the next one.
function setup() {
  clockBase += 10 * 864e5; let t = clockBase; const origNow = Date.now, origFetch = globalThis.fetch, state = { calls: [] };
  Date.now = () => t; globalThis.fetch = fakeSupa(state); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  return { clock: { add: (ms) => { t += ms; }, now: () => t }, state, done: () => { Date.now = origNow; globalThis.fetch = origFetch; } };
}
const utcDay = () => new Date().toISOString().slice(0, 10); // Meter.add keys its row by new Date() (the real clock, not the mocked Date.now)
const dayN = (env) => env.meter('day').sql.db.prepare('select n from d where day = ?').get(utcDay())?.n || 0;
const setUsed = (env, n) => env.meter('day').sql.db.prepare('insert into d(day, n) values(?, ?) on conflict(day) do update set n = excluded.n').run(utcDay(), n);
const BUSY = { ok: false, code: 'busy', error: '지금은 광장이 붐벼요. 잠시 뒤에 다시 해 주세요.' };
const JPEG = new Uint8Array(1200).fill(7); JPEG[0] = 0xff; JPEG[1] = 0xd8;

describe('budget tally', { concurrency: false }, () => {
  it('adds the DO calls of HTTP routes to the day estimate in one batch, not one add per request', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), log = spyDo(env), { get, post, guest, call } = harness(env), a = await guest(), b = await guest();
      await get('/rt/wishes'); // the isolate's level is stale on a new day: this add also lands what earlier tests left pending
      const base = dayN(env); assert.ok(log.length > 0, 'the list read and the settlement are DO calls');
      clock.add(2000); await get('/rt/wishes');
      clock.add(2000); const w = (await (await post('/rt/wish', { text: '배치로 세기', nick: '가' }, a.token)).json()).wish;
      clock.add(2000); assert.equal((await (await post('/rt/wish/heart', { id: w.id }, b.token, '2.2.2.2')).json()).ok, true);
      clock.add(2000); await get('/rt/wishes');
      assert.equal(dayN(env), base, 'nothing is added while the batch is younger than 25 s');
      const counted = log.length;
      clock.add(20000); await call('/rt/health'); // 28 s after the last add: this request sends the batch (and makes no DO call itself)
      assert.equal(dayN(env), base + counted + 1, 'every DO call once, plus the add counting itself');
      clock.add(3000); await call('/rt/health'); assert.equal(dayN(env), base + counted + 1, 'an empty tally sends nothing');
    } finally { done(); }
  });
  it('the /rt/gate read carries the pending count', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), log = spyDo(env), { get, call } = harness(env);
      await get('/rt/wishes'); const base = dayN(env), counted = log.length; assert.ok(counted > 0);
      clock.add(1000); const g = await (await call('/rt/gate')).json();
      assert.equal(g.ok, true); assert.equal(g.used, base + counted + 1); assert.equal(dayN(env), base + counted + 1);
    } finally { done(); }
  });
  it('an add that never answers (its request cancelled) does not hold up later requests, and is forgotten after 10 s', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), real = env.METER.get; let hang = true;
      env.METER.get = (n) => { const s = real(n); return n !== 'day' ? s : new Proxy(s, { get: (t, k) => k === 'add' && hang ? () => { hang = false; return new Promise(() => {}); } : t[k] }); };
      const ctx = { waitUntil() {} }, ask = () => worker.fetch(new Request('https://sq.example/rt/wishes'), env, ctx);
      const within = (p, ms) => Promise.race([p.then(() => 'answered'), new Promise((r) => setTimeout(() => r('hung'), ms))]);
      assert.equal(await within(ask(), 150), 'hung', 'the request that started the add waits on its own add');
      assert.equal(await within(ask(), 300), 'answered', 'a later request uses the current level instead of that add');
      setUsed(env, 96000); clock.add(11000);
      const r = await ask(); assert.equal((await r.json()).busy, true, 'after 10 s a new add runs and brings the hard level');
    } finally { done(); }
  });
  it('every stub method runs on the real stub, add included (a workerd-like stub refuses any other receiver)', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), meters = new Map(), log = [];
      const strict = (obj, name) => { let p; const base = Object.create({ fetch(req) { if (this !== p) throw new TypeError('Illegal invocation'); log.push(name + '.fetch'); return obj.fetch(req); } });
        Object.defineProperty(base, 'id', { value: { name }, enumerable: true });
        p = new Proxy(base, { get(t, k, r) { if (k in t) return Reflect.get(t, k, r); if (k === 'then' || typeof k === 'symbol') return undefined;
          return function (...a) { if (this !== p) throw new TypeError('Illegal invocation'); log.push(name + '.' + String(k)); return Promise.resolve().then(async () => structuredClone(await obj[k](...structuredClone(a)))); }; } });
        return p; };
      const ns = (make) => { const o = { idFromName(n) { if (this !== o) throw new TypeError('Illegal invocation'); return { n }; }, get(id) { if (this !== o) throw new TypeError('Illegal invocation'); return make(id.n); } }; return o; };
      env.METER = ns((n) => { if (!meters.has(n)) meters.set(n, env.meter(n).do); return strict(meters.get(n), n); });
      env.ROOM = ns((n) => strict(env.room(n).do, 'room:' + n));
      const { call, get, guest, post } = harness(env), a = await guest();
      const g = await (await call('/rt/gate')).json(); assert.equal(g.ok, true); assert.ok(log.includes('day.add'));
      assert.ok(Array.isArray((await (await get('/rt/wishes')).json()).top));
      assert.equal((await (await post('/rt/wish', { text: '받는 쪽 확인', nick: '가', topic: 'chapel:square' }, a.token)).json()).ok, true);
      assert.ok(log.includes('wish.wPost') && log.includes('room:chapel:square.fetch'));
      const s = await (await call('/rt/admin/stats', { headers: { 'x-admin-key': 'admin-test-key-123' } })).json();
      assert.equal(typeof s.tally.pending, 'number'); assert.equal(typeof s.tally.flushAgeMs, 'number'); assert.equal(typeof s.tally.lvl, 'number');
    } finally { done(); }
  });
});

describe('budget level on the wish, share and push routes', { concurrency: false }, () => {
  it('at lean the fresh wish reaches only the poster room and heart milestones send no push; both come back below 80%', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv({ VAPID_PRIV: 'test-only' }), { get, post, guest } = harness(env), hits = [], due = [];
      let reads = 0; const realRoom = env.ROOM.get, realMeter = env.METER.get;
      env.ROOM.get = (t) => { const s = realRoom(t); return new Proxy(s, { get: (o, k) => k === 'fetch' ? (req) => { if (new URL(req.url).pathname === '/wish') hits.push(t); return o.fetch(req); } : o[k] }); };
      env.METER.get = (n) => { const s = realMeter(n); return new Proxy(s, { get: (o, k) => { if (n === 'acct' && k === 'liveRooms') reads++; if (n === 'push' && k === 'psDue') due.push(1); return o[k]; } }); };
      await env.meter('acct').do.seatNow('p1', 'chapel:square-4', wishDay(clock.now()));
      const [a, b, c, d] = [await guest(), await guest(), await guest(), await guest()];
      await get('/rt/wishes');
      setUsed(env, 85000); clock.add(61000); // 85%: lean, seen once the isolate's level copy is a minute old
      const w = (await (await post('/rt/wish', { text: '조용한 날', nick: '가', topic: 'chapel:square-2' }, a.token)).json()).wish;
      assert.deepEqual(hits, ['chapel:square-2']); assert.equal(reads, 0, 'no seat registry read for a fan-out that is skipped');
      assert.equal((await (await post('/rt/wish/heart', { id: w.id }, b.token, '2.2.2.2')).json()).hearts, 1);
      assert.equal(due.length, 0, 'the first-heart push is skipped at lean');
      setUsed(env, 1000); clock.add(61000);
      assert.equal((await (await post('/rt/wish/heart', { id: w.id }, c.token, '3.3.3.3')).json()).hearts, 2);
      assert.equal((await (await post('/rt/wish/heart', { id: w.id }, d.token, '4.4.4.4')).json()).hearts, 3);
      assert.equal(due.length, 1, 'the third-heart milestone is looked up again below 80%');
      hits.length = 0; await post('/rt/wish', { text: '다시 북적', nick: '다', topic: 'chapel:square-2' }, c.token);
      assert.deepEqual(hits.sort(), ['chapel:square-2', 'chapel:square-4']);
    } finally { done(); }
  });
  it('at hard wish writes and /rt/snap answer 503 busy, lists and the world serve copies, and the wish DO is not called', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), { get, post, guest, call } = harness(env), calls = [], real = env.METER.get;
      env.METER.get = (n) => { const s = real(n); return n !== 'wish' ? s : new Proxy(s, { get: (o, k) => { calls.push(String(k)); return o[k]; } }); };
      const a = await guest(), b = await guest();
      await get('/rt/wishes');
      const w = (await (await post('/rt/wish', { text: '붐비는 날의 소원', nick: '가' }, a.token)).json()).wish; // fills the world copy
      await get('/rt/wishes'); // fills the anonymous list copy
      assert.equal((await get('/rt/w/' + w.id)).status, 200); // fills the single-wish copy
      setUsed(env, 96000); clock.add(61000); calls.length = 0;
      for (const [path, body] of [['/rt/wish', { text: '못 거는 소원', nick: '나' }], ['/rt/wish/heart', { id: w.id }], ['/rt/wish/report', { id: w.id }]]) {
        const r = await post(path, body, b.token); assert.equal(r.status, 503, path); assert.deepEqual(await r.json(), BUSY, path); }
      const snap = await call('/rt/snap?wish=' + w.id, { method: 'POST', headers: { authorization: 'Bearer ' + a.token, 'content-type': 'image/jpeg' }, body: JPEG });
      assert.equal(snap.status, 503); assert.deepEqual(await snap.json(), BUSY);
      for (const tok of [null, b.token]) { const l = await (await get('/rt/wishes', tok)).json(); assert.equal(l.busy, true); assert.deepEqual(l.top.map((x) => x.txt), ['붐비는 날의 소원']); }
      const world = await (await get('/rt/world')).json(); assert.deepEqual(world.wish.board.map((x) => x.txt), ['붐비는 날의 소원']);
      assert.equal((await get('/rt/w/' + w.id)).status, 200, 'a share link at hard: the cached copy of any age');
      assert.equal((await get('/rt/w/zzzzzzzzzz')).status, 302, 'a share link at hard with no cached copy reads as no such wish');
      assert.deepEqual(calls, [], 'no wish-DO call at hard');
      // A new KST day at hard: an empty list, no settlement. The first request after the level drops settles the day before.
      clock.add(864e5); setUsed(env, 99000);
      const empty = await (await get('/rt/wishes')).json(); assert.equal(empty.busy, true); assert.deepEqual([empty.top, empty.recent, empty.mine, empty.count], [[], [], null, 0]);
      assert.deepEqual(calls, []);
      setUsed(env, 10); clock.add(61000);
      const back = await (await get('/rt/wishes')).json(); assert.equal(back.busy, undefined); assert.ok(calls.includes('wSettle'), 'settlement runs once the level is below 95%');
    } finally { done(); }
  });
});

describe('contact filter (wish.js)', () => {
  const REFUSED = ['０１０-１２３４-５６７８', '０１０１２３４５６７８', '공일공 일이삼사 오육칠팔', '공일공일이삼사오육칠팔', '영일영.일이삼사.오육칠팔', '공 일 공 일 이 삼 사 오 육 칠 팔', '공일공 1234 오육칠팔',
    '010_1234_5678', '010/1234/5678', '010·1234·5678', '010•1234•5678', '010,1234,5678', '010~1234~5678', '010*1234*5678', '(010)1234-5678', '(02) 123 4567', '010ㅡ1234ㅡ5678',
    '010​1234​5678', '0⁠1⁠0-1234-5678', '0 1 0 1 2 3 4 5 6 7 8', '＋８２ １０ １２３４ ５６７８', '연락 공일공-일이삼사-오육칠팔 주세요',
    '010-1234-5678', '01012345678', '02-123-4567', '+82 10 1234 5678',
    'ｈｔｔｐ://abc', 'ｈｔｔｐｓ：//abc', 'ｗｗｗ．abc', 'www。naver。com', 'abc．com', 'ab​c.com',
    // the reviewer's next tries: letter O, separators off the list, hangul fillers and blanks, regrouping, keycaps, 빵
    'O1O-1234-5678', 'o1o 1234 5678', '010:1234:5678', '010+1234+5678', '010=1234=5678', '010|1234|5678', '010#1234#5678', "010'1234'5678", '010"1234"5678', '010^1234^5678',
    '010>1234>5678', '010、1234、5678', '010…1234…5678', '010︱1234︱5678', '010ㅤ1234ㅤ5678', '010ﾠ1234ﾠ5678', '010ᅟ1234ᅟ5678', '010⠀1234⠀5678',
    '010-123-45678', '010-12-34-5678', '010 12 34 56 78', '0101-234-5678', '01-0123-45678', '010 1234 56 78', '010 일이 삼사 오육 칠팔', '공일공 일이 삼사 오육 칠팔',
    '0️⃣1️⃣0️⃣-1️⃣2️⃣3️⃣4️⃣-5️⃣6️⃣7️⃣8️⃣', '010-1234-5️⃣6️⃣7️⃣8️⃣', '010-1234-56７８', '빵일빵-일이삼사-오육칠팔', '⓪①⓪-①②③④-⑤⑥⑦⑧', '⁰¹⁰-¹²³⁴-⁵⁶⁷⁸', '𝟎𝟏𝟎-𝟏𝟐𝟑𝟒-𝟓𝟔𝟕𝟖',
    '010 1234 5678 연락', '010-1234-5678 2026', '010 1234 5 6 7 8', '+82-10-1234-5678', '82 10 1234 5678', '8210 1234 5678', '0505-123-4567', '070 1234 5678'];
  const ALLOWED = ['2026.12.25 결혼해요', '시험 100 100 100점', '번호 7 14 21 33 40 45 맞게', '20020531', '２０２６．１２．２５ 결혼해요', '오이 먹고 싶다', '이사 잘 하자', '구일 사오정',
    '사오정 이사 가요', '이사 오이 구일 삼일 사이', '일이삼사오육칠 외우기', '2026-11-21 합격', '3.5 학점 받기', '12345678', '1 2 3 4 5 6 7 8 9', '합격하게 해 주세요 💖',
    // the reviewer's allowed table: lotto lines, money, dates, scores, and words built from o/O and digit syllables
    '로또 03 07 12 25 33 41', '로또 1 2 3 4 5 6 7 당첨', '토익 900점 넘기', '키 180 몸무게 70', '0시 0분 0초 새해', '일요일에 이사 가요', '구구단 다 외우기', '삼일절 태극기', '팔구십 살까지 건강',
    '칠공주 모여라', '영이 생일 축하해', '일 이 삼 사 오 육 칠 팔 구 십', '오늘 공사 끝', '공부 일등', '영영 사랑해', '공일오비 노래 좋아', '일일 일기 쓰기', '이삼일 쉬기', '10,000원 줍기',
    '1,000,000원 모으기', '1,0000,0000 부자', '1004 천사', '0.1초 차이', '02학번 화이팅', '2002 06 25 기억', '06 25 잊지말자', '11/21 합격', '7 7 7 대박', '0 대 1 승리', '삼삼오오 모여',
    '일석이조', '구사일생', '이구동성', '삼사일 남음', '사이사이 쉬기', '이 일 이 사 오', '영일만 친구', '공공 와이파이', '12 34 56 78', '010 미만', '010', '010 1234', 'BTS 0613 데뷔일',
    '0613 0901 생일들', '1년 365일', '24시간 7일', '구구 팔팔 이삼사', '오육 칠팔 년대', '1990 2000 2010 2020', '버스 1002 2002 타기', '2 0 2 6 년 화이팅', '1 0 0 0 일 기념',
    '0 1 2 3 4 5 6', '비번 1 2 3 4', '콘서트 A구역 12열 3번', 'OK 100점', 'o2o 서비스', 'Good 2026 1225', 'No 1 2 3 4 5 6',
    'Hello 2026 1225', 'Woo 2025 0101', 'zoo 1004 2580', 'Me too 2026 1225', 'GT-O1012 3456'];
  it('refuses phone numbers and links behind full-width digits, Korean numerals, other separators and invisible marks', () => {
    for (const s of REFUSED) { assert.equal(wishFault(s), 'link', s); assert.equal(wishNickFault(s), 'nick', s); }
  });
  it('keeps dates, scores, lotto numbers and ordinary words that use digit syllables', () => {
    for (const s of ALLOWED) { assert.equal(wishFault(s), '', s); assert.equal(wishNickFault(s), '', s); }
  });
  it('stores the cleaned original, not the folded copy', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), { post, guest } = harness(env), a = await guest(), b = await guest();
      const r = await (await post('/rt/wish', { text: '２０２６．１２．２５ 결혼해요', nick: 'ｋｉｍ' }, a.token)).json();
      assert.equal(r.ok, true); assert.equal(r.wish.txt, cleanWish('２０２６．１２．２５ 결혼해요')); assert.equal(r.wish.txt, '２０２６．１２．２５ 결혼해요'); assert.equal(r.wish.nick, 'ｋｉｍ');
      assert.equal((await (await post('/rt/wish', { text: '연락 공일공 일이삼사 오육칠팔', nick: '가' }, b.token)).json()).code, 'link');
      assert.equal((await (await post('/rt/wish', { text: '합격', nick: '０１０-１２３４-５６７８' }, b.token)).json()).code, 'nick');
      assert.equal(WISH_ERR.busy, BUSY.error);
    } finally { done(); }
  });
});

describe('taxi fare cap (Room)', () => {
  it('pays PAY.fare.perHour fares in a clock hour, refuses the next one with cap, and pays again the next hour', async () => {
    const { clock, done } = setup();
    try {
      const hour = Math.ceil(clock.now() / 36e5) * 36e5; clock.add(hour - clock.now());
      const env = makeEnv(), room = env.room('chapel:square').do, ws = { sent: [], send(s) { this.sent.push(String(s)); }, close() {}, serializeAttachment() {}, deserializeAttachment() { return null; } };
      room.socks().set(ws, { k: 'guest:driver', q: true, v2: true, fl: 0, lob: false, t: Date.now(), ls: Date.now(), m: { x: 0, y: 0, fl: 0 } });
      let x = 0;
      const ride = async () => {
        clock.add(40000); x += 20;
        await room.webSocketMessage(ws, JSON.stringify({ t: 'p', a: [toNetUnits(x), toNetUnits(0), 0, 'idle', 0, 0, 0] }));
        await room.webSocketMessage(ws, JSON.stringify({ t: 'PICK' }));
        await room.webSocketMessage(ws, JSON.stringify({ t: 'FARE', amount: 25, nick: '기사', slot: 'STREET_1', riders: 1 }));
        return ws.sent.map((s) => JSON.parse(s)).filter((m) => m.t === 'PAY' && m.kind === 'fare').at(-1);
      };
      assert.equal(PAY.fare.perHour, 15);
      for (let i = 0; i < PAY.fare.perHour; i++) { const p = await ride(); assert.ok(p.amount > 0, 'fare ' + (i + 1)); }
      assert.ok(Date.now() - hour < 36e5);
      assert.deepEqual(await ride(), { t: 'PAY', kind: 'fare', amount: 0, why: 'cap' });
      clock.add(hour + 36e5 - Date.now());
      assert.ok((await ride()).amount > 0, 'the next hour pays again');
      await room._fq;
    } finally { done(); }
  });
});
