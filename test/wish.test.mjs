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
const { WISH, WISH_ERR, cleanWish, wishFault, wishRejected, wishNickFault, ipNet, wishDay, rankWishes, prizeFor, boardMix, wishShareText } = await import('../wish.js');

// Same harness as plaza.test.mjs: real DOs on in-memory SQLite behind a stub that copies arguments and results like the runtime does.
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
// A wish instance whose every method throws, behind the real binding for every other name.
function breakWish(env) { const real = env.METER.get; env.METER.get = (name) => name === 'wish' ? new Proxy({}, { get: () => async () => { throw new Error('down'); } }) : real(name); return env; }
function openSock(room, id) {
  const ws = { sent: [], send(s) { this.sent.push(String(s)); }, close() {}, serializeAttachment() {}, deserializeAttachment() { return null; } };
  room.socks().set(ws, { k: id, q: true, v2: true, fl: 0, lob: false, t: Date.now(), ls: Date.now(), m: { x: 0, y: 0, fl: 0 } });
  return ws;
}
const wishMsgs = (ws) => ws.sent.map((s) => JSON.parse(s)).filter((m) => m.t === 'WISH');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
// Fake Supabase: world reads plus grant_coins. A wallet in `wallets` is paid; `throws` makes the fetch throw, `fail5xx` answers 500, anything else
// is the clear refusal grant_coins gives for a missing wallet row (HTTP 200, ok:false).
function fakeSupa(state) {
  state.throws ||= new Set(); state.fail5xx ||= new Set();
  return async (url, opt) => {
    const u = String(url); state.calls.push({ url: u, body: opt?.body });
    if (u.includes('/rest/v1/billboards')) return json([{ slot_id: 'MAIN_TOP', line1: 'x' }]);
    if (u.includes('/rest/v1/plots')) return json([]);
    if (u.includes('/rest/v1/wallets')) return json([]);
    if (u.includes('/rpc/plaza_live')) return json({});
    if (u.includes('/rpc/grant_coins')) { const a = JSON.parse(opt.body);
      if (state.throws.has(a.p_actor_id)) throw new Error('network');
      if (state.fail5xx.has(a.p_actor_id)) return json({ message: 'upstream' }, 500);
      if (!state.wallets.has(a.p_actor_id)) return json({ ok: false, error: 'no wallet' });
      state.paid.push([a.p_actor_id, a.p_amount]); return json({ ok: true, coins: a.p_amount }); }
    return new Response('missing', { status: 404 });
  };
}
function harness(env) {
  const waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (path, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + path, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const guest = async () => { const t = (await (await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).token; return { token: t, id: 'guest:' + JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).s }; };
  const post = (path, body, token, ip = '1.1.1.1') => call(path, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const get = (path, token) => call(path, { headers: token ? { authorization: 'Bearer ' + token } : {} });
  const admin = (body) => call('/rt/admin/wish', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': 'admin-test-key-123' }, body: JSON.stringify(body) });
  return { call, guest, post, get, admin };
}
let clockBase = Date.parse('2026-12-01T03:00:00Z');
// Each test runs on its own KST days so isolate caches (world 15 s, wish list 10 s, settle once per day, world debounce 10 s) never leak between tests.
function freshClock() { clockBase += 10 * 864e5; let t = clockBase; const orig = Date.now; Date.now = () => t; return { set: (v) => { t = v; }, add: (ms) => { t += ms; }, now: () => t, restore: () => { Date.now = orig; } }; }
function setup(stateExtra = {}) {
  const clock = freshClock(), orig = globalThis.fetch, state = { calls: [], paid: [], wallets: new Set(), ...stateExtra };
  globalThis.fetch = fakeSupa(state); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  return { clock, state, done: () => { globalThis.fetch = orig; clock.restore(); } };
}
const D = (t) => wishDay(t);
const hasActor = (s) => /guest:|user:/.test(String(s));

describe('wish rules (wish.js)', () => {
  it('pins the limits', () => {
    assert.ok(Object.isFrozen(WISH));
    assert.deepEqual({ ...WISH, prizes: [...WISH.prizes] }, { maxLen: 24, heartsPerDay: 5, ipHeartsPerWish: 3, reportHide: 3, topMax: 50, recentMax: 20, boardMax: 24, keepDays: 8, prizes: [300, 200, 100], prizeMinHearts: 5, prizeMinIps: 3, editsPerDay: 3, editGapMs: 30000, ipPostsPerDay: 20 });
  });
  it('blocks Korean phone-number shapes in text and nick (not dates, scores or lotto numbers), and links in the nick', () => {
    const PHONES = ['010-1234-5678', '01012345678', '010 1234 5678', '010.1234.5678', '02-123-4567', '+82 10 1234 5678', '연락 0101234 5678', '연락 010-1234-5678 주세요'];
    const FINE = ['2026.12.25 결혼해요', '2026-11-21 합격', '번호 7 14 21 33 40 45 맞게', '시험 100 100 100점', '1등 하게 해 주세요', '2026년 수능 대박', '20020531', '3.5 학점 받기', '2026년 12월 25일', '12345678'];
    for (const s of PHONES) { assert.equal(wishFault(s), 'link', s); assert.equal(wishNickFault(s), 'nick', s); }
    for (const s of FINE) { assert.equal(wishFault(s), '', s); assert.equal(wishNickFault(s), '', s); }
    for (const n of ['www.ad', 'open.kakao.com', 'http://x']) assert.equal(wishNickFault(n), 'nick', n);
    for (const n of ['까마귀2026', '1등', '7번가']) assert.equal(wishNickFault(n), '', n);
    assert.equal(WISH_ERR.ipposts, '이 네트워크에서는 오늘 소원을 더 걸 수 없어요. 내일 다시 걸어 주세요.');
  });
  it('cleans text: control characters out, whitespace collapsed, 24 code points', () => {
    assert.equal(cleanWish('  합격\n\t하게\u0000  해주세요  '), '합격 하게 해주세요');
    assert.equal(cleanWish(null), '');
    const long = '🎉'.repeat(30);
    assert.equal(Array.from(cleanWish(long)).length, 24);
    assert.equal(cleanWish(long), '🎉'.repeat(24));
    assert.equal(cleanWish('가'.repeat(23) + ' 나다'), '가'.repeat(23));
    assert.equal(cleanWish('a‮b​c'), 'abc');
  });
  it('rejects empty, banned words and links with a Korean reason', () => {
    assert.equal(wishRejected('올해는 꼭 취업'), '');
    assert.equal(wishFault('   \n '), 'empty');
    assert.equal(wishFault('씨발 소원'), 'blocked');
    assert.equal(wishFault('FUCK this'), 'blocked');
    for (const s of ['http://a.b', 'https://x.io', 'www.naver', '구경 shop.kr/abc', 'open.kakao.com 오세요', 'my.site.xyz/x']) assert.equal(wishFault(s), 'link', s);
    assert.equal(wishFault('3.5 학점 받기'), '');
    assert.match(wishRejected('www.ad'), /[가-힣]/);
    assert.match(wishRejected(''), /[가-힣]/);
    for (const k of ['empty', 'blocked', 'link', 'nick', 'already', 'hidden', 'soon', 'edits', 'gone', 'closed', 'own', 'dup', 'limit', 'ip', 'auth', 'rate', 'down', 'ipposts']) assert.match(WISH_ERR[k], /[가-힣]/, k);
    assert.match(WISH_ERR.hidden, /신고/);
  });
  it('rejects banned or staff-looking nicknames', () => {
    for (const n of ['운영자', '관리자님', '공식계정', 'ADMIN', 'the Official', '병신']) assert.equal(wishNickFault(n), 'nick', n);
    for (const n of ['까마귀', '', 'adm']) assert.equal(wishNickFault(n), '', n);
  });
  it('groups IPv6 by /64 and leaves IPv4 alone', () => {
    assert.equal(ipNet('2001:db8:1:2:3:4:5:6'), ipNet('2001:db8:1:2::9'));
    assert.equal(ipNet('2001:0db8:0001:0002:ffff::1'), ipNet('2001:db8:1:2::'));
    assert.notEqual(ipNet('2001:db8:1:2::1'), ipNet('2001:db8:1:3::1'));
    assert.equal(ipNet('1.2.3.4'), '1.2.3.4');
    assert.equal(ipNet('::ffff:1.2.3.4'), '1.2.3.4');
    assert.equal(ipNet(''), 'x');
  });
  it('uses the worker KST day format', () => {
    assert.equal(wishDay(Date.parse('2026-11-15T14:59:59Z')), '2026-11-15');
    assert.equal(wishDay(Date.parse('2026-11-15T15:00:00Z')), '2026-11-16');
    assert.match(wishDay(), /^\d{4}-\d{2}-\d{2}$/);
  });
  it('ranks by hearts, then the earlier wish; prizes need rank 1-3, 5 hearts and 3 IP nets', () => {
    const r = rankWishes([{ id: 'a', hearts: 2, at: 5 }, { id: 'b', hearts: 7, at: 9 }, { id: 'c', hearts: 2, at: 1 }]);
    assert.deepEqual(r.map((x) => [x.id, x.rank]), [['b', 1], ['c', 2], ['a', 3]]);
    assert.equal(prizeFor(1, 5, 3), 300); assert.equal(prizeFor(2, 9, 9), 200); assert.equal(prizeFor(3, 5, 3), 100);
    assert.equal(prizeFor(3, 4, 9), 0); assert.equal(prizeFor(4, 99, 99), 0); assert.equal(prizeFor(0, 99, 99), 0);
    assert.equal(prizeFor(1, 50, 2), 0); assert.equal(prizeFor(1, 50), 0);
  });
  it('mixes top and recent without duplicates', () => {
    const t = [{ id: 'a' }, { id: 'b' }, { id: 'c' }], n = [{ id: 'z' }, { id: 'a' }, { id: 'y' }];
    assert.deepEqual(boardMix(t, n, 10).map((x) => x.id), ['a', 'z', 'b', 'c', 'y']);
    assert.deepEqual(boardMix(t, n, 3).map((x) => x.id), ['a', 'z', 'b']);
    assert.deepEqual(boardMix(null, undefined, 5), []);
  });
  it('writes share copy', () => {
    assert.deepEqual(wishShareText({ nick: '까마귀', txt: '합격' }), { title: '까마귀님의 소원', text: '"합격" — 하트 하나만 눌러 주세요' });
  });
});

describe('wish meter (instance wish)', { concurrency: false }, () => {
  const meter = () => makeEnv().meter('wish').do;
  const give = (m, wid, n, day, ips = n) => { for (let i = 0; i < n; i++) assert.equal(m.wHeart('guest:h' + wid + i, wid, 'ip' + (i % ips), day).ok, true); };
  it('keeps one wish per day; edits only with no hearts, 30 s apart, 3 times', () => {
    const m = meter(), day = '2026-11-20', t0 = 1e6;
    const a = m.wPost('guest:a', '가', '첫 소원', day, t0);
    assert.equal(a.ok, true); assert.equal(a.fresh, true); assert.match(a.wish.id, /^[0-9a-z]{10}$/); assert.equal(a.wish.mine, true); assert.equal('uid' in a.wish, false);
    assert.deepEqual(m.wPost('guest:a', '가', '너무 빨리', day, t0 + 29999), { ok: false, error: 'soon' });
    const b = m.wPost('guest:a', '가', '바꾼 소원', day, t0 + 30000);
    assert.equal(b.ok, true); assert.equal(b.fresh, false); assert.equal(b.wish.id, a.wish.id); assert.equal(b.wish.txt, '바꾼 소원'); assert.equal(b.wish.at, t0);
    assert.equal(m.wPost('guest:a', '가', '또 1', day, t0 + 50000).error, 'soon');
    assert.equal(m.wPost('guest:a', '가', '또 2', day, t0 + 60000).ok, true);
    assert.equal(m.wPost('guest:a', '가', '또 3', day, t0 + 90000).ok, true);
    assert.deepEqual(m.wPost('guest:a', '가', '또 4', day, t0 + 900000), { ok: false, error: 'edits' });
    const c = m.wPost('guest:c', '다', '하트 받을 소원', day, t0);
    assert.equal(m.wHeart('guest:b', c.wish.id, 'ip1', day).ok, true);
    assert.deepEqual(m.wPost('guest:c', '다', '바꿈', day, t0 + 900000), { ok: false, error: 'already' });
    assert.equal(m.wOne(c.wish.id).txt, '하트 받을 소원');
    m.wHide(c.wish.id, true);
    assert.deepEqual(m.wPost('guest:c', '다', '바꿈', day, t0 + 900000), { ok: false, error: 'hidden' });
    assert.equal(m.wPost('guest:a', '가', '내일 소원', '2026-11-21', t0 + 1e8).ok, true);
  });
  it('returns every heart error code, a daily limit per actor and an IP cap per wish', () => {
    const m = meter(), day = '2026-11-20';
    const w = m.wPost('guest:a', '가', '소원', day, 1).wish;
    assert.equal(m.wHeart('guest:b', 'nope000000', 'i', day).error, 'gone');
    assert.equal(m.wHeart('guest:b', w.id, 'i', '2026-11-21').error, 'closed');
    assert.equal(m.wHeart('guest:a', w.id, 'i', day).error, 'own');
    assert.deepEqual(m.wHeart('guest:b', w.id, 'i', day), { ok: true, hearts: 1, left: 4, au: 'guest:a' }); // au: the author, kept inside the Worker for the heart push
    assert.equal(m.wHeart('guest:b', w.id, 'i', day).error, 'dup');
    assert.equal(m.wHeart('guest:c', w.id, 'i', day).ok, true);
    assert.equal(m.wHeart('guest:d', w.id, 'i', day).ok, true);
    assert.equal(m.wHeart('guest:e', w.id, 'i', day).error, 'ip');
    assert.deepEqual(m.wHeart('guest:e', w.id, 'j', day), { ok: true, hearts: 4, left: 4, au: 'guest:a' });
    const others = ['p', 'q', 'r', 's', 't', 'u'].map((k, i) => m.wPost('guest:' + k, k, '소원 ' + k, day, 10 + i).wish);
    for (let i = 0; i < 4; i++) assert.equal(m.wHeart('guest:b', others[i].id, 'z' + i, day).ok, true);
    assert.equal(m.wHeart('guest:b', others[4].id, 'z9', day).error, 'limit');
    const l = m.wList(day, 'guest:b');
    assert.equal(l.left, 0); assert.equal(l.given.length, 5); assert.ok(l.given.includes(w.id));
    m.wHide(w.id, true);
    assert.equal(m.wHeart('guest:f', w.id, 'k', day).error, 'gone');
  });
  it('lists today ranked, recent first, mine with rank, and never exposes uid', () => {
    const m = meter(), day = '2026-11-20';
    const a = m.wPost('guest:a', 'A', 'a', day, 100).wish, b = m.wPost('guest:b', 'B', 'b', day, 200).wish, c = m.wPost('guest:c', 'C', 'c', day, 300).wish;
    m.wHeart('guest:x', b.id, '1', day); m.wHeart('guest:y', b.id, '2', day); m.wHeart('guest:x', c.id, '1', day); m.wHeart('guest:y', a.id, '2', day);
    const l = m.wList(day, 'guest:c');
    assert.equal(l.day, day);
    assert.deepEqual(l.top.map((w) => [w.id, w.rank, w.hearts]), [[b.id, 1, 2], [a.id, 2, 1], [c.id, 3, 1]]);
    assert.deepEqual(l.recent.map((w) => w.id), [c.id, b.id, a.id]);
    assert.equal(l.mine.id, c.id); assert.equal(l.mine.rank, 3); assert.equal(l.count, 3);
    assert.equal(hasActor(JSON.stringify(l)), false);
    assert.equal(l.top.find((w) => w.id === c.id).mine, true); assert.equal(l.top.find((w) => w.id === a.id).mine, false);
    const anon = m.wList(day, '');
    assert.equal(anon.mine, null); assert.equal(anon.left, 0); assert.deepEqual(anon.given, []); assert.deepEqual(anon.yesterday, []);
    assert.equal(m.wOne(b.id).rank, 1); assert.equal(m.wOne('zzzzzzzzzz'), null);
  });
  it('hides a wish only when reports come from three distinct IP nets', () => {
    const m = meter(), day = '2026-11-20';
    const w = m.wPost('guest:a', 'A', '광고', day, 1).wish; m.wPost('guest:b', 'B', '착한 소원', day, 2);
    assert.equal(m.wReport('guest:a', w.id, 'n0').error, 'own');
    for (const g of ['guest:s1', 'guest:s2', 'guest:s3', 'guest:s4']) assert.equal(m.wReport(g, w.id, 'same').hidden, false); // one IP minting guests
    assert.equal(m.wReport('guest:s1', w.id, 'other').dup, true);
    assert.equal(m.wReport('guest:r1', w.id, 'n1').hidden, false);
    assert.equal(m.wBoard(day).some((x) => x.id === w.id), true);
    assert.equal(m.wReport('guest:r2', w.id, 'n2').hidden, true);
    assert.equal(m.wList(day, '').top.some((x) => x.id === w.id), false);
    assert.equal(m.wList(day, '').recent.some((x) => x.id === w.id), false);
    assert.equal(m.wBoard(day).some((x) => x.id === w.id), false);
    assert.equal(m.wOne(w.id), null);
    assert.equal(m.wList(day, 'guest:a').mine.hidden, true);
    m.wHide(w.id, false); assert.equal(m.wOne(w.id).id, w.id);
  });
  it('fills a quiet morning board with yesterday and keeps board fields small', () => {
    const m = meter();
    for (let i = 0; i < 8; i++) m.wPost('guest:y' + i, 'Y' + i, '어제 ' + i, '2026-11-19', i);
    m.wPost('guest:t', 'T', '오늘', '2026-11-20', 100);
    const board = m.wBoard('2026-11-20');
    assert.equal(board[0].txt, '오늘'); assert.equal(board.length, 9);
    assert.deepEqual(Object.keys(board[0]).sort(), ['hearts', 'id', 'nick', 'txt']);
    for (let i = 0; i < 30; i++) m.wPost('guest:n' + i, 'N', '새 ' + i, '2026-11-21', 1000 + i);
    const full = m.wBoard('2026-11-21');
    assert.equal(full.length, WISH.boardMax); assert.equal(full.some((x) => x.txt.startsWith('어제')), false);
  });
  it('settles at most once per winner: handed-out winners are marked paid, only a clear refusal hands them out again, 5 attempts', () => {
    const m = meter(), y = '2026-11-19', d = '2026-11-20';
    const w = ['a', 'b', 'c', 'e'].map((k, i) => m.wPost('guest:' + k, k.toUpperCase(), k, y, i).wish);
    give(m, w[0].id, 6, y); give(m, w[1].id, 5, y, 2); give(m, w[2].id, 4, y); give(m, w[3].id, 7, y); // b: third by hearts, but only 2 IP nets
    let due = m.wSettle(d, 1e6);
    assert.deepEqual(due.map((x) => [x.uid, x.rank, x.prize]).sort(), [['guest:a', 2, 200], ['guest:e', 1, 300]]);
    assert.equal(due.every((x) => x.day === y && x.id), true);
    assert.deepEqual(m.wSettle(d, 1e6 + 120000), []); // handed out = paid; a lost answer never pays again
    m.wUnpay(y, w[0].id); // clear refusal (no wallet row)
    assert.deepEqual(m.wSettle(d, 1e6 + 1000), []); // 60 s apart
    for (let i = 2; i <= 5; i++) { assert.deepEqual(m.wSettle(d, 1e6 + i * 120000).map((x) => x.uid), ['guest:a']); m.wUnpay(y, w[0].id); }
    assert.deepEqual(m.wSettle(d, 1e6 + 9 * 120000), []); // five attempts used up
    const l = m.wList(d, 'guest:e');
    assert.deepEqual(l.yesterday.map((x) => [x.rank, x.nick, x.prize, x.mine]), [[1, 'E', 300, true], [2, 'A', 200, false]]);
    assert.equal(hasActor(JSON.stringify(l.yesterday)), false);
    assert.deepEqual(m.wWorld(d).king, { nick: 'E', txt: 'e', hearts: 7 });
  });
  it('drops a winner hidden after settlement from yesterday, king and payment', () => {
    const m = meter(), y = '2026-11-19', d = '2026-11-20';
    const a = m.wPost('guest:a', 'A', 'a', y, 1).wish, b = m.wPost('guest:b', 'B', 'b', y, 2).wish;
    give(m, a.id, 7, y); give(m, b.id, 5, y);
    m.wSettle(d, 1e6); m.wUnpay(y, a.id); m.wUnpay(y, b.id);
    m.wHide(a.id, true);
    assert.equal(m.wWorld(d).king, null); // ranks stay as settled: a hidden first place leaves no king
    assert.deepEqual(m.wList(d, '').yesterday.map((x) => [x.rank, x.nick]), [[2, 'B']]);
    assert.deepEqual(m.wSettle(d, 1e6 + 120000).map((x) => x.uid), ['guest:b']);
    // not settled yet: the live pick skips hidden wishes too
    const m2 = meter(), c = m2.wPost('guest:c', 'C', 'c', y, 1).wish; give(m2, c.id, 6, y); m2.wHide(c.id, true);
    assert.equal(m2.wWorld(d).king, null); assert.deepEqual(m2.wSettle(d, 1e6), []);
  });
  it('settles every missed day inside keepDays, then prunes', () => {
    const m = meter();
    const old = m.wPost('guest:o', 'O', '사흘 전', '2026-11-17', 1).wish, mid = m.wPost('guest:p', 'P', '이틀 전', '2026-11-18', 1).wish;
    give(m, old.id, 5, '2026-11-17'); give(m, mid.id, 6, '2026-11-18');
    assert.deepEqual(m.wSettle('2026-11-20', 1e6).map((x) => [x.day, x.uid, x.prize]), [['2026-11-17', 'guest:o', 300], ['2026-11-18', 'guest:p', 300]]);
    assert.deepEqual(m.wSettle('2026-11-21', 2e6), []);
    assert.deepEqual(m.wSettle('2026-12-05', 1e7), []);
    assert.equal(m.wOne(old.id), null); // pruned after keepDays
  });
  it('caps fresh wishes per IP net per day; edits and other nets do not count', () => {
    const m = meter(), day = '2026-11-20';
    for (let i = 0; i < WISH.ipPostsPerDay; i++) assert.equal(m.wPost('guest:p' + i, 'P', '소원 ' + i, day, 1, 'net1').ok, true);
    assert.deepEqual(m.wPost('guest:late', 'L', '늦은 소원', day, 1, 'net1'), { ok: false, error: 'ipposts' });
    assert.equal(m.wPost('guest:p0', 'P', '고친 소원', day, 1e6, 'net1').ok, true); // an edit is not a fresh wish
    assert.equal(m.wPost('guest:late', 'L', '다른 망', day, 1, 'net2').ok, true);
    assert.equal(m.wPost('guest:next', 'N', '다음 날', '2026-11-21', 1, 'net1').ok, true);
    assert.equal(m.wPost('guest:noip', 'N', '망 없음', day, 1).ok, true); // direct calls without an IP are not counted
  });
  it('moves a guest wish, hearts, reports and stored winners to the user; keeps the user wish when both exist', () => {
    const m = meter(), y = '2026-11-19', d = '2026-11-20', q = (s, ...a) => m.ctx.storage.sql.db.prepare(s).all(...a);
    const gy = m.wPost('guest:g', 'G', '어제 소원', y, 1).wish; give(m, gy.id, 6, y);
    m.wSettle(d, 1e6); m.wUnpay(y, gy.id); // a stored, unpaid winner of the guest
    const g = m.wPost('guest:g', 'G', '오늘 소원', d, 1).wish, other = m.wPost('guest:o', 'O', '남의 소원', d, 2).wish;
    assert.equal(m.wHeart('guest:g', other.id, 'ip', d).ok, true); m.wReport('guest:g', other.id, 'ip');
    assert.deepEqual({ ...m.wMove('guest:g', 'user:u') }, { ok: true });
    assert.equal(m.wList(d, 'user:u').mine.id, g.id); assert.deepEqual(m.wList(d, 'user:u').given, [other.id]); assert.equal(m.wList(d, 'user:u').left, 4);
    assert.equal(q('select count(*) n from wrp where uid = ?', 'user:u')[0].n, 1);
    assert.deepEqual(m.wSettle(d, 1e6 + 120000).map((x) => [x.uid, x.prize]), [['user:u', 300]]);
    assert.equal(m.wPost('user:u', 'G', '두 번째', d, 1e7).fresh, false); // the moved wish is the user's one wish of the day
    // Both had a wish today: the user's stays, the guest's is hidden.
    const u2 = m.wPost('user:v', 'V', '유저 소원', d, 5).wish, g2 = m.wPost('guest:h', 'H', '게스트 소원', d, 6).wish;
    m.wMove('guest:h', 'user:v');
    assert.equal(m.wList(d, 'user:v').mine.id, u2.id); assert.equal(m.wOne(g2.id), null); assert.equal(m.wOne(u2.id).id, u2.id);
    assert.equal(m.wMove('guest:x', 'guest:x').ok, false);
  });
  it('merge drops double hearts and self-hearts and lowers those counts', () => {
    const m = meter(), d = '2026-11-20', q = (s, ...a) => m.ctx.storage.sql.db.prepare(s).all(...a);
    const uw = m.wPost('user:u', 'U', '유저 소원', d, 1).wish, other = m.wPost('guest:o', 'O', '남의 소원', d, 2).wish;
    assert.equal(m.wHeart('user:u', other.id, 'i1', d).ok, true); assert.equal(m.wHeart('guest:g', other.id, 'i2', d).ok, true); // both hearted the same wish
    assert.equal(m.wHeart('guest:g', uw.id, 'i2', d).ok, true); // the guest hearted the user's own wish
    m.wMove('guest:g', 'user:u');
    assert.equal(m.wOne(other.id).hearts, 1); assert.equal(m.wOne(uw.id).hearts, 0);
    assert.deepEqual(q('select wid from wht where uid = ? order by wid', 'user:u').map((r) => r.wid), [other.id]);
    assert.equal(q('select count(*) n from wht where uid = ?', 'guest:g')[0].n, 0);
    // the other way round: the user hearted the guest's wish, which becomes the user's
    const m2 = meter(), gw = m2.wPost('guest:g', 'G', '게스트 소원', d, 1).wish; m2.wHeart('user:u', gw.id, 'i', d); m2.wMove('guest:g', 'user:u');
    assert.equal(m2.wOne(gw.id).hearts, 0); assert.equal(m2.wList(d, 'user:u').given.length, 0); assert.equal(m2.wList(d, 'user:u').mine.id, gw.id);
  });
  it('forgets an actor: wish hidden and anonymised, hearts and reports gone, stored winner entries dropped', () => {
    const m = meter(), y = '2026-11-19', d = '2026-11-20', q = (s, ...a) => m.ctx.storage.sql.db.prepare(s).all(...a);
    const wy = m.wPost('user:z', 'Z', '어제 일등', y, 1).wish; give(m, wy.id, 6, y); m.wSettle(d, 1e6); m.wUnpay(y, wy.id);
    const w = m.wPost('user:z', '제트', '내 소원', d, 1).wish, other = m.wPost('guest:o', 'O', '남의 소원', d, 2).wish;
    m.wHeart('user:z', other.id, 'ip', d); m.wReport('user:z', other.id, 'ip');
    m.wForget('user:z');
    assert.equal(m.wOne(w.id), null); assert.equal(m.wOne(wy.id), null);
    assert.equal(q('select count(*) n from wsh where uid = ? or nick = ? or txt = ?', 'user:z', '제트', '내 소원')[0].n, 0);
    assert.equal(q('select count(*) n from wht where uid = ?', 'user:z')[0].n, 0); assert.equal(q('select count(*) n from wrp where uid = ?', 'user:z')[0].n, 0);
    assert.equal(m.wOne(other.id).hearts, 0);
    assert.equal(q('select j from wst').some((r) => r.j.includes('user:z')), false);
    assert.deepEqual(m.wSettle(d, 1e6 + 120000), []);
    assert.equal(m.wList(d, 'user:z').mine, null);
  });
  it('lists a day for the operator with hidden wishes and report nets, newest first, no actor ids', () => {
    const m = meter(), d = '2026-11-20';
    const a = m.wPost('guest:a', 'A', 'a', d, 1).wish, b = m.wPost('guest:b', 'B', 'b', d, 2).wish;
    m.wReport('guest:r1', a.id, 'n1'); m.wReport('guest:r2', a.id, 'n1'); m.wReport('guest:r3', a.id, 'n2'); m.wHide(b.id, true); m.wHeart('guest:h', a.id, 'i', d);
    const l = m.wAdmin(d);
    assert.deepEqual(l.map((x) => ({ ...x })), [{ id: b.id, nick: 'B', txt: 'b', hearts: 0, reports: 0, hidden: true, gone: false, at: 2 }, { id: a.id, nick: 'A', txt: 'a', hearts: 1, reports: 2, hidden: false, gone: false, at: 1 }]);
    assert.equal(hasActor(JSON.stringify(l)), false); assert.deepEqual(m.wAdmin('2026-11-21'), []);
  });
  it('never unhides a forgotten wish or a merge duplicate, and marks both gone in the operator list', () => {
    const m = meter(), d = '2026-11-20';
    const f = m.wPost('user:f', 'F', '탈퇴', d, 1).wish; m.wForget('user:f');
    const u = m.wPost('user:v', 'V', '유저', d, 2).wish, g = m.wPost('guest:h', 'H', '게스트', d, 3).wish; m.wMove('guest:h', 'user:v');
    const ok = m.wPost('guest:k', 'K', '보통', d, 4).wish; m.wHide(ok.id, true);
    assert.deepEqual({ ...m.wHide(f.id, false) }, { ok: false, locked: true }); assert.deepEqual({ ...m.wHide(g.id, false) }, { ok: false, locked: true });
    assert.equal(m.wOne(f.id), null); assert.equal(m.wOne(g.id), null);
    assert.equal(m.wHide(ok.id, false).ok, true); assert.equal(m.wHide(f.id, true).ok, true); // hiding again is harmless
    const gone = Object.fromEntries(m.wAdmin(d).map((x) => [x.id, x.gone]));
    assert.deepEqual(gone, { [f.id]: true, [g.id]: true, [u.id]: false, [ok.id]: false });
  });
});

describe('wish routes', { concurrency: false }, () => {
  it('rejects anonymous writes and bad text, posts, hearts with Korean errors, and fans out only a new wish', async () => {
    const { clock, state, done } = setup();
    const env = makeEnv(), { post, get, guest } = harness(env);
    try {
      assert.equal((await post('/rt/wish', { text: '소원' })).status, 401);
      assert.equal((await post('/rt/wish/heart', { id: 'aaaaaaaaaa' })).status, 401);
      assert.equal((await post('/rt/wish/report', { id: 'aaaaaaaaaa' })).status, 401);
      const a = await guest(), b = await guest(), c = await guest();
      const sq = openSock(env.room('chapel:square').do, 'x'), s3 = openSock(env.room('chapel:square-3').do, 'y'), qa = openSock(env.room('chapelqa:square').do, 'z');
      for (const [k, room] of [['x', 'chapel:square'], ['y', 'chapel:square-3'], ['z', 'chapelqa:square']]) await env.meter('acct').do.seatNow(k, room, D(clock.now())); // the seat registry the fan-out reads
      const bad = await (await post('/rt/wish', { text: 'https://spam.example', nick: '가' }, a.token)).json();
      assert.equal(bad.ok, false); assert.equal(bad.code, 'link'); assert.match(bad.error, /[가-힣]/);
      assert.equal((await (await post('/rt/wish', { text: '좋은 소원', nick: '병신' }, a.token)).json()).code, 'nick');
      assert.equal((await (await post('/rt/wish', { text: '좋은 소원', nick: '공식 운영자' }, a.token)).json()).code, 'nick');
      assert.equal((await (await post('/rt/wish', { text: '좋은 소원', nick: 'Admin' }, a.token)).json()).code, 'nick');
      const ok = await (await post('/rt/wish', { text: '  합격  기원 ', nick: '까마귀', topic: 'chapel:square-2' }, a.token)).json();
      assert.equal(ok.ok, true); assert.equal(ok.fresh, true); assert.equal(ok.wish.txt, '합격 기원'); assert.equal(ok.wish.nick, '까마귀');
      assert.deepEqual(wishMsgs(sq), [{ t: 'WISH', w: { id: ok.wish.id, nick: '까마귀', txt: '합격 기원', hearts: 0 } }]);
      assert.equal(wishMsgs(s3).length, 1); assert.equal(wishMsgs(qa).length, 0);
      const own = await post('/rt/wish/heart', { id: ok.wish.id }, a.token);
      assert.equal(own.status, 400); const ownB = await own.json(); assert.equal(ownB.code, 'own'); assert.match(ownB.error, /[가-힣]/);
      assert.deepEqual(await (await post('/rt/wish/heart', { id: ok.wish.id }, b.token)).json(), { ok: true, hearts: 1, left: 4 });
      assert.equal((await (await post('/rt/wish/heart', { id: ok.wish.id }, b.token)).json()).code, 'dup');
      const again = await (await post('/rt/wish', { text: '다른 소원', nick: '까마귀' }, a.token)).json();
      assert.equal(again.code, 'already'); assert.match(again.error, /[가-힣]/);
      // A replace (0 hearts, 30 s later) answers but sends no WISH and does no full world refill.
      const cw = await (await post('/rt/wish', { text: '처음', nick: '다', topic: 'chapel:square' }, c.token)).json();
      assert.equal(wishMsgs(sq).length, 2);
      const soon = await (await post('/rt/wish', { text: '바로 바꿈', nick: '다', topic: 'chapel:square' }, c.token)).json();
      assert.equal(soon.code, 'soon'); assert.match(soon.error, /[가-힣]/);
      clock.add(31000);
      const boardsBefore = state.calls.filter((x) => x.url.includes('/billboards')).length;
      const rep = await (await post('/rt/wish', { text: '바꿈', nick: '다', topic: 'chapel:square' }, c.token)).json();
      assert.equal(rep.ok, true); assert.equal(rep.fresh, false); assert.equal(rep.wish.id, cw.wish.id);
      assert.equal(wishMsgs(sq).length, 2);
      assert.equal(state.calls.filter((x) => x.url.includes('/billboards')).length, boardsBefore);
      const mine = await (await get('/rt/wishes', a.token)).json();
      assert.equal(mine.mine.id, ok.wish.id); assert.equal(mine.left, 5); assert.equal(mine.top[0].hearts, 1);
      const theirs = await (await get('/rt/wishes', b.token)).json();
      assert.deepEqual(theirs.given, [ok.wish.id]); assert.equal(theirs.left, 4); assert.equal(theirs.mine, null);
      const anon = await (await get('/rt/wishes?id=' + ok.wish.id)).json();
      assert.equal(anon.mine, null); assert.equal(anon.left, 0); assert.equal(anon.focus.id, ok.wish.id); assert.equal(anon.focus.rank, 1); assert.equal(anon.focus.mine, false);
      assert.equal((await (await get('/rt/wishes?id=' + ok.wish.id, a.token)).json()).focus.mine, true);
      assert.equal(hasActor(JSON.stringify(anon)), false);
      const r = await (await post('/rt/wish/report', { id: ok.wish.id }, b.token)).json();
      assert.equal(r.ok, true); assert.equal(r.hidden, false);
    } finally { done(); }
  });
  it('hides on reports from three IP nets, not from guests minted on one IP; the author then gets code hidden', async () => {
    const { done } = setup();
    const env = makeEnv(), { post, guest, get } = harness(env);
    try {
      const a = await guest(), w = (await (await post('/rt/wish', { text: '소원', nick: '가' }, a.token)).json()).wish;
      for (let i = 0; i < 4; i++) assert.equal((await (await post('/rt/wish/report', { id: w.id }, (await guest()).token, '9.9.9.9')).json()).hidden, false);
      // one IPv6 /64 is one reporter
      assert.equal((await (await post('/rt/wish/report', { id: w.id }, (await guest()).token, '2001:db8:1:2::1')).json()).hidden, false);
      assert.equal((await (await post('/rt/wish/report', { id: w.id }, (await guest()).token, '2001:db8:1:2::ff')).json()).hidden, false);
      assert.equal((await (await post('/rt/wish/report', { id: w.id }, (await guest()).token, '8.8.8.8')).json()).hidden, true);
      assert.equal((await (await get('/rt/wishes')).json()).top.length, 0);
      const again = await post('/rt/wish', { text: '다시', nick: '가' }, a.token);
      assert.equal(again.status, 409); const body = await again.json(); assert.equal(body.code, 'hidden'); assert.equal(body.error, WISH_ERR.hidden);
    } finally { done(); }
  });
  it('limits writes and signed-in reads with EVENT_RL', async () => {
    const { done } = setup();
    let allow = true;
    const env = makeEnv({ EVENT_RL: { limit: async () => ({ success: allow }) } }), { post, get, guest } = harness(env);
    try {
      const a = await guest(), w = (await (await post('/rt/wish', { text: '소원', nick: '가' }, a.token)).json()).wish;
      allow = false;
      for (const [path, body] of [['/rt/wish', { text: '또', nick: '가' }], ['/rt/wish/heart', { id: w.id }], ['/rt/wish/report', { id: w.id }]]) {
        const r = await post(path, body, a.token); assert.equal(r.status, 429, path); const j = await r.json(); assert.equal(j.code, 'rate'); assert.equal(j.error, WISH_ERR.rate);
      }
      const g = await get('/rt/wishes', a.token); assert.equal(g.status, 429); assert.equal((await g.json()).code, 'rate');
      assert.equal((await get('/rt/wishes')).status, 200); // anonymous reads are cached instead
    } finally { done(); }
  });
  it('answers clean JSON when the wish instance throws', async () => {
    const { done } = setup();
    const env = breakWish(makeEnv()), { post, get, guest, call } = harness(env);
    try {
      const a = await guest();
      for (const [path, body] of [['/rt/wish', { text: '소원', nick: '가' }], ['/rt/wish/heart', { id: 'aaaaaaaaaa' }], ['/rt/wish/report', { id: 'aaaaaaaaaa' }]]) {
        const r = await post(path, body, a.token); assert.equal(r.status, 502, path); const j = await r.json(); assert.equal(j.ok, false); assert.equal(j.code, 'down');
      }
      assert.equal((await get('/rt/wishes')).status, 502);
      const page = await call('/rt/w/aaaaaaaaaa', { redirect: 'manual' }); assert.equal(page.status, 302);
    } finally { done(); }
  });
  it('admin hides a wish; the share page escapes user text, is cached, carries no actor id, and redirects', async () => {
    const { done } = setup();
    const env = makeEnv(), { post, get, guest, call, admin } = harness(env);
    let ones = 0; const real = env.METER.get;
    env.METER.get = (name) => { const s = real(name); return name !== 'wish' ? s : new Proxy(s, { get: (t, k) => { if (k === 'wOne') ones++; return t[k]; } }); };
    try {
      const a = await guest();
      const w = (await (await post('/rt/wish', { text: '<script>x</script>"&', nick: '<b>나</b>' }, a.token)).json()).wish;
      const page = await call('/rt/w/' + w.id);
      assert.equal(page.status, 200); assert.match(page.headers.get('content-type'), /text\/html/); assert.equal(page.headers.get('cache-control'), 'public, max-age=30');
      const html = await page.text();
      assert.equal(html.includes('<script>x'), false); assert.equal(html.includes('<b>'), false);
      assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;&quot;&amp;'));
      assert.equal(hasActor(html), false);
      assert.match(html, /<meta property="og:image" content="https:\/\/sq\.example\/og\.jpg">/);
      assert.match(html, /twitter:card/); assert.match(html, /og:title/);
      assert.ok(html.includes('/?wish=' + w.id)); assert.match(html, /location\.replace/); assert.match(html, /http-equiv="refresh"/);
      const n = ones; await call('/rt/w/' + w.id); await get('/rt/wishes?id=' + w.id); assert.equal(ones, n); // one lookup per 10 s per isolate
      await call('/rt/w/zzzzzzzzzz', { redirect: 'manual' }); await call('/rt/w/zzzzzzzzzz', { redirect: 'manual' }); assert.equal(ones, n + 1); // misses are cached too
      const none = await call('/rt/w/zzzzzzzzzz', { redirect: 'manual' });
      assert.ok([301, 302, 303, 307, 308].includes(none.status)); assert.equal(new URL(none.headers.get('location')).pathname, '/');
      assert.equal((await post('/rt/admin/wish', { id: w.id, hide: true }, a.token)).status, 401);
      assert.deepEqual(await (await admin({ id: w.id, hide: true })).json(), { ok: true });
      assert.equal((await (await get('/rt/wishes')).json()).top.length, 0);
      assert.equal((await call('/rt/w/' + w.id, { redirect: 'manual' })).status, 302); // hide drops the cached copy
    } finally { done(); }
  });
  it('/rt/world keeps its keys, adds wish without actor ids, debounces refills, and survives a throwing wish instance', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), { post, get, guest } = harness(env);
      const boards = () => state.calls.filter((x) => x.url.includes('/billboards')).length;
      const a = await guest(), b = await guest();
      await post('/rt/wish', { text: '첫 소원', nick: '가' }, a.token);
      const full = boards();
      const world = await (await get('/rt/world')).json();
      assert.equal(boards(), full); // the post already refilled the cache
      for (const k of ['billboards', 'plots', 'ranks', 'today']) assert.ok(k in world, k);
      assert.equal(world.wish.count, 1); assert.equal(world.wish.king, null);
      assert.deepEqual(world.wish.board.map((x) => x.txt), ['첫 소원']);
      assert.equal(hasActor(JSON.stringify(world.wish)), false);
      clock.add(2000);
      await post('/rt/wish', { text: '둘째 소원', nick: '나' }, b.token);
      assert.equal(boards(), full); // within 10 s: no refill, and the isolate's world copy stays (the 15 s world cache)
      assert.equal((await (await get('/rt/world')).json()).wish.count, 1);
      assert.equal(boards(), full);
      clock.add(15000);
      assert.equal((await (await get('/rt/world')).json()).wish.count, 2);
      assert.equal(boards(), full + 1);
      clock.add(60000);
      const res = await harness(breakWish(makeEnv())).get('/rt/world');
      assert.equal(res.status, 200);
      const body = await res.json();
      for (const k of ['billboards', 'plots', 'ranks', 'today']) assert.ok(k in body, k);
      assert.equal(body.wish, undefined); // an empty or failing wish instance leaves the key out (see IMPLEMENTED.md)
    } finally { done(); }
  });
  it('pays yesterday\'s winners through grant_coins, retries only a clear refusal, never pays twice, drops a winner hidden later', async () => {
    const { clock, state, done } = setup({ wallets: new Set(['guest:win1']) });
    const env = makeEnv(), { get, admin } = harness(env), m = env.meter('wish').do;
    try {
      const y = D(clock.now() - 864e5), t = D(clock.now());
      const w1 = m.wPost('guest:win1', 'W1', '일등', y, 1).wish, w2 = m.wPost('guest:win2', 'W2', '이등', y, 2).wish, lo = m.wPost('guest:lo', 'L', '하트 부족', y, 3).wish;
      for (let i = 0; i < 6; i++) m.wHeart('guest:f' + i, w1.id, 'ip' + i, y);
      for (let i = 0; i < 5; i++) m.wHeart('guest:f' + i, w2.id, 'ip' + i, y);
      for (let i = 0; i < 4; i++) m.wHeart('guest:g' + i, lo.id, 'jp' + i, y);
      const l = await (await get('/rt/wishes')).json();
      assert.equal(l.day, t);
      assert.deepEqual(state.paid, [['guest:win1', 300]]);
      const grants = () => state.calls.filter((c) => c.url.includes('grant_coins'));
      assert.equal(grants().length, 2);
      assert.equal(JSON.parse(grants()[0].body).p_key, 'flush-test-key');
      await get('/rt/wishes'); assert.equal(grants().length, 2); // throttled, not every request
      state.wallets.add('guest:win2'); clock.add(61000);
      await get('/rt/wishes');
      assert.deepEqual(state.paid, [['guest:win1', 300], ['guest:win2', 200]]);
      clock.add(61000); await get('/rt/wishes'); clock.add(864e5); await get('/rt/wishes');
      assert.equal(state.paid.length, 2); assert.equal(grants().length, 3);
      clock.add(-864e5);
      const king = (await (await get('/rt/world')).json()).wish.king;
      assert.deepEqual(king, { nick: 'W1', txt: '일등', hearts: 6 });
      assert.deepEqual(await (await admin({ id: w1.id, hide: true })).json(), { ok: true });
      assert.equal(((await (await get('/rt/world')).json()).wish || {}).king ?? null, null);
      assert.deepEqual((await (await get('/rt/wishes')).json()).yesterday.map((x) => x.nick), ['W2']);
    } finally { done(); }
  });
  it('never retries a payment whose answer was lost (thrown fetch or 5xx)', async () => {
    const { clock, state, done } = setup({ throws: new Set(['guest:t1']), fail5xx: new Set(['guest:t2']) });
    const env = makeEnv(), { get } = harness(env), m = env.meter('wish').do;
    try {
      const y = D(clock.now() - 864e5);
      for (const k of ['t1', 't2']) { const w = m.wPost('guest:' + k, k, k, y, k === 't1' ? 1 : 2).wish; for (let i = 0; i < 6; i++) m.wHeart('guest:f' + k + i, w.id, 'ip' + i, y); }
      await get('/rt/wishes');
      const grants = () => state.calls.filter((c) => c.url.includes('grant_coins')).length;
      assert.equal(grants(), 2);
      state.wallets.add('guest:t1'); state.wallets.add('guest:t2'); state.throws.clear(); state.fail5xx.clear();
      for (let i = 0; i < 4; i++) { clock.add(61000); await get('/rt/wishes'); }
      clock.add(864e5); await get('/rt/wishes');
      assert.equal(grants(), 2); assert.deepEqual(state.paid, []);
      assert.deepEqual(m.wSettle(D(clock.now()), clock.now() + 1e6), []);
    } finally { done(); }
  });
  // Records which rooms receive the internal /wish fan-out.
  const spyWish = (env) => { const hits = [], real = env.ROOM.get;
    env.ROOM.get = (t) => { const s = real(t); return new Proxy(s, { get: (o, k) => k === 'fetch' ? (req) => { if (new URL(req.url).pathname === '/wish') hits.push(t); return o.fetch(req); } : o[k] }); };
    return hits; };
  it('fans a fresh wish out only to the poster room and shards with seated accounts; one registry read per 30 s', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), { post, guest } = harness(env), hits = spyWish(env), day = D(clock.now());
      let reads = 0; const real = env.METER.get; env.METER.get = (n) => { const s = real(n); return n !== 'acct' ? s : new Proxy(s, { get: (t, k) => { if (k === 'liveRooms') reads++; return t[k]; } }); };
      await env.meter('acct').do.seatNow('p1', 'chapel:square-4', day); await env.meter('acct').do.seatNow('p2', 'chapel:square-4', day); await env.meter('acct').do.seatNow('p3', 'chapelqa:square-2', day);
      await env.meter('acct').do.seatNow('old', 'chapel:square-6', '2020-01-01'); // seated long ago, not seen since: no fan-out
      const a = await guest(), b = await guest();
      assert.equal((await (await post('/rt/wish', { text: '첫 소원', nick: '가', topic: 'chapel:square-2' }, a.token)).json()).fresh, true);
      assert.deepEqual(hits.sort(), ['chapel:square-2', 'chapel:square-4']);
      assert.equal(hits.includes('chapel:square-5'), false); assert.equal(env.room('chapel:square-5').do.socks().size, 0);
      hits.length = 0; clock.add(5000);
      await post('/rt/wish', { text: '둘째', nick: '나', topic: 'chapel:square' }, b.token);
      assert.deepEqual(hits.sort(), ['chapel:square', 'chapel:square-4']); assert.equal(reads, 1); // cached per isolate
    } finally { done(); }
  });
  it('falls back to the poster room alone when the seat registry fails', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), { post, guest } = harness(env), hits = spyWish(env), real = env.METER.get;
      env.METER.get = (n) => n === 'acct' ? new Proxy({}, { get: () => async () => { throw new Error('down'); } }) : real(n);
      const a = await guest();
      assert.equal((await (await post('/rt/wish', { text: '소원', nick: '가', topic: 'chapel:square-7' }, a.token)).json()).ok, true);
      assert.deepEqual(hits, ['chapel:square-7']);
    } finally { done(); }
  });
  it('rejects contact details in text and nick over HTTP, and caps fresh wishes per network', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), { post, guest } = harness(env);
      const a = await guest();
      assert.equal((await (await post('/rt/wish', { text: '연락 01012345678', nick: '가' }, a.token)).json()).code, 'link');
      assert.equal((await (await post('/rt/wish', { text: '합격', nick: '010-1234-5678' }, a.token)).json()).code, 'nick');
      assert.equal((await (await post('/rt/wish', { text: '합격', nick: 'shop.kr/abc' }, a.token)).json()).code, 'nick');
      const first = []; for (let i = 0; i < WISH.ipPostsPerDay; i++) { const g = await guest(); first.push(g); assert.equal((await (await post('/rt/wish', { text: '소원 ' + i, nick: '가' }, g.token, '5.5.5.5')).json()).ok, true, String(i)); }
      const late = await guest(), r = await post('/rt/wish', { text: '늦은 소원', nick: '가' }, late.token, '5.5.5.5');
      assert.equal(r.status, 409); const j = await r.json(); assert.equal(j.code, 'ipposts'); assert.equal(j.error, WISH_ERR.ipposts);
      assert.equal((await (await post('/rt/wish', { text: '늦은 소원', nick: '가' }, late.token, '6.6.6.6')).json()).ok, true);
      clock.add(31000);
      assert.equal((await (await post('/rt/wish', { text: '고친 소원', nick: '가' }, first[0].token, '5.5.5.5')).json()).ok, true); // edits do not count
    } finally { done(); }
  });
  it('admin lists a day with hidden wishes, no actor ids; 401 without the key', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), { post, guest, call, admin } = harness(env), a = await guest(), b = await guest(), c = await guest();
      const list = (q = '', key = 'admin-test-key-123') => call('/rt/admin/wishes' + q, { headers: key ? { 'x-admin-key': key } : {} });
      const wa = (await (await post('/rt/wish', { text: '첫째', nick: 'A' }, a.token)).json()).wish; clock.add(1000);
      const wb = (await (await post('/rt/wish', { text: '둘째', nick: 'B' }, b.token)).json()).wish;
      await post('/rt/wish/report', { id: wa.id }, c.token, '7.7.7.7');
      await admin({ id: wb.id, hide: true });
      assert.equal((await list('', '')).status, 401); assert.equal((await list('', 'wrong')).status, 401);
      const r = await list(); assert.equal(r.status, 200); const body = await r.json();
      assert.equal(body.ok, true); assert.equal(body.day, D(clock.now()));
      assert.deepEqual(body.wishes.map((w) => [w.id, w.hidden, w.reports]), [[wb.id, true, 0], [wa.id, false, 1]]);
      assert.deepEqual(Object.keys(body.wishes[0]).sort(), ['at', 'gone', 'hearts', 'hidden', 'id', 'nick', 'reports', 'txt']);
      assert.equal(hasActor(JSON.stringify(body)), false);
      assert.deepEqual((await (await list('?day=2020-01-01')).json()).wishes, []);
      assert.equal((await (await list('?day=bad')).json()).day, D(clock.now()));
      env.meter('wish').do.wForget(a.id);
      const no = await admin({ id: wa.id, hide: false }); assert.equal(no.status, 409);
      assert.deepEqual(await no.json(), { ok: false, code: 'locked', error: '되살릴 수 없는 소원이에요' });
      assert.equal((await admin({ id: 'zzzzzzzzzz', hide: false })).status, 404);
    } finally { done(); }
  });
});
