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
const { INVITE, INV_RE, invCode, newCode, inviteFault, inviteWaits, inviteFrom, inviteOn, inviteView, ipWide, withInvite, inviteLine, inviteNews } = await import('../invite.js');
const { wishDay } = await import('../wish.js');
const { EVENT_NAMES } = await import('../plaza-account.js');
const { awayRows } = await import('../ftue.js');

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
    setWebSocketAutoResponse() {}, getWebSockets() { return []; }, getWebSocketAutoResponseTimestamp() { return new Date(); }, acceptWebSocket() {},
  };
}
const stub = (obj) => new Proxy(obj, { get: (t, k) => k === 'fetch' ? (req) => t.fetch(req) : typeof t[k] === 'function' ? async (...a) => structuredClone(await t[k](...structuredClone(a))) : t[k] });
function makeEnv(extra = {}) {
  const meters = new Map(), rooms = new Map();
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ADMIN_KEY: 'admin-test-key-123', INVITE_ON: '1', ASSETS: { fetch: () => new Response('asset', { status: 200 }) }, ...extra }; // the switch on, except in the 'switch off' tests
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new Meter(makeCtx(sql), env) }); } return meters.get(name); };
  env.room = (topic) => { if (!rooms.has(topic)) { const sql = sqliteStorage(); rooms.set(topic, { sql, do: new Room(makeCtx(sql), env) }); } return rooms.get(topic); };
  env.METER = { idFromName: (name) => name, get: (name) => stub(env.meter(name).do) };
  env.ROOM = { idFromName: (topic) => topic, get: (topic) => stub(env.room(topic).do) };
  return env;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
// Fake Supabase. grant_coins pays a wallet in state.wallets; fail5xx answers 500 (unknown outcome); anything else is the clear refusal for a
// missing wallet row (HTTP 200, ok:false).
function fakeNet(state) {
  return async (url, opt = {}) => {
    const u = String(url); state.calls.push({ url: u, body: opt.body });
    if (u.includes('/.well-known/jwks.json')) return json({ keys: state.jwks || [] });
    if (u.includes('/rest/v1/billboards')) return json(state.boards || []);
    if (u.includes('/rest/v1/plots')) return json([]);
    if (u.includes('/rest/v1/wallets')) return json([]);
    if (u.includes('/rpc/plaza_live')) return json({});
    if (u.includes('/rpc/merge_guest_account')) return json({ ok: true, coins: 1, bonus: 0 });
    if (u.includes('/rpc/withdraw_account')) return json({ ok: true });
    if (u.includes('/rpc/ensure_ref_code')) return json('');
    if (u.includes('/rpc/grant_coins')) { const a = JSON.parse(opt.body);
      if (state.fail5xx.has(a.p_actor_id)) return json({ message: 'upstream' }, 500);
      if (!state.wallets.has(a.p_actor_id)) return json({ ok: false, error: 'no wallet' });
      state.paid.push([a.p_actor_id, a.p_amount]); return json({ ok: true, coins: a.p_amount }); }
    if (u.includes('/auth/v1/user')) return json({});
    return new Response('missing', { status: 404 });
  };
}
function harness(env) {
  const waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (path, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + path, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const guest = async () => { const t = (await (await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).token; return { token: t, id: 'guest:' + JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).s }; };
  const post = (path, body, token, ip = '1.1.1.1') => call(path, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const get = (path, token, ip = '1.1.1.1') => call(path, { headers: { 'cf-connecting-ip': ip, ...(token ? { authorization: 'Bearer ' + token } : {}) } });
  const code = async (who, ip = '1.1.1.1') => (await (await post('/rt/invite', {}, who.token, ip)).json()).code;
  const sum = async (who, ip = '1.1.1.1') => (await get('/rt/invite', who.token, ip)).json();
  const wish = async (who, text, inv, ip) => (await post('/rt/wish', { text, nick: '친구', ...(inv ? { inv } : {}) }, who.token, ip)).json();
  return { call, guest, post, get, code, sum, wish };
}
let clockBase = Date.parse('2027-06-01T03:00:00Z');
// Each test runs on its own KST days so isolate caches (gate 15 s, retries once per day) never leak between tests.
function freshClock() { clockBase += 10 * 864e5; let t = clockBase; const orig = Date.now; Date.now = () => t; return { add: (ms) => { t += ms; }, now: () => t, restore: () => { Date.now = orig; } }; }
function setup(extra = {}) {
  const clock = freshClock(), orig = globalThis.fetch, state = { calls: [], paid: [], wallets: new Set(), fail5xx: new Set(), ...extra };
  globalThis.fetch = fakeNet(state); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  return { clock, state, done: () => { globalThis.fetch = orig; clock.restore(); } };
}
// Guests with wallet rows (the profile read on entering makes one).
async function people(h, state, n) { const out = []; for (let i = 0; i < n; i++) { const g = await h.guest(); state.wallets.add(g.id); out.push(g); } return out; }
async function userToken(state, clock, sub) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  state.jwks = [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'invite-kid' }];
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), head = enc({ alg: 'ES256', kid: 'invite-kid' });
  const claims = enc({ sub, exp: Math.floor(clock.now() / 1000) + 600, iss: 'https://yxddhpacuyaffaoutxjn.supabase.co/auth/v1', aud: 'authenticated' });
  return { token: head + '.' + claims + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(head + '.' + claims))).toString('base64url'), id: 'user:' + sub };
}
const hasActor = (s) => /guest:|user:/.test(String(s));
const db = (env) => env.meter('inv').sql.db;

describe('invite rules (invite.js)', () => {
  it('pins the amounts and limits', () => {
    assert.ok(Object.isFrozen(INVITE));
    assert.deepEqual({ ...INVITE }, { inviter: 100, invitee: 100, perDay: 5, total: 50, ipDay: 1, ipTotal: 3, wideDay: 5, dayAll: 40, queueDays: 7, queueMax: 200, passRows: 50, passPairs: 3, payWish: 2, payMax: 3, pushMax: 1, newDays: 7, fromDays: 7, tries: 8, retryMs: 60000, recentMax: 20 });
  });
  it('codes are 8 characters of [0-9a-z], random, and only that shape passes', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) { const c = newCode(); assert.match(c, INV_RE); seen.add(c); }
    assert.equal(seen.size, 200);
  });
  it('drops biased bytes (≥ 252) when making a code', () => {
    let calls = 0;
    const rand = (n) => { calls += 1; return calls === 1 ? new Uint8Array(n).fill(253) : Uint8Array.from({ length: n }, (_, i) => i); };
    assert.equal(newCode(rand), '01234567');
    assert.equal(calls, 2);
  });
  it('invCode accepts the shape only', () => {
    assert.equal(invCode('ab12cd34'), 'ab12cd34');
    for (const bad of ['', 'AB12CD34', 'ab12cd3', 'ab12cd345', '<script>', 'ab12cd3!', null, undefined, {}]) assert.equal(invCode(bad), '', String(bad));
  });
  it('inviteFault names the first rule that fails', () => {
    const ok = { inviter: 'guest:a', invitee: 'guest:b', group: ['guest:b'], ip: 'net-b', inviterIps: ['net-a'] };
    assert.equal(inviteFault(ok), '');
    assert.equal(inviteFault({ ...ok, inviter: '' }), 'code');
    assert.equal(inviteFault({ ...ok, invitee: 'guest:a' }), 'self');
    assert.equal(inviteFault({ ...ok, group: ['guest:b', 'guest:a'] }), 'self');
    assert.equal(inviteFault({ ...ok, seen: true }), 'seen');
    assert.equal(inviteFault({ ...ok, old: true }), 'old');
    assert.equal(inviteFault({ ...ok, ip: 'net-a' }), 'ip');
    assert.equal(inviteFault({ ...ok, ip: '' }), 'ip');
    assert.equal(inviteFault({ ...ok, ipDay: 1 }), 'ipday');
    assert.equal(inviteFault({ ...ok, ipTotal: 3 }), 'ipcap');
    assert.equal(inviteFault({ ...ok, ipTotal: 2 }), '');
    assert.equal(inviteFault({ ...ok, perDay: 5 }), 'capday');
    assert.equal(inviteFault({ ...ok, perDay: 5, total: 50, ipDay: 1 }), 'cap'); // a permanent reason wins over a daily one
    assert.equal(inviteFault({ ...ok, wideDay: 5 }), 'wide');
    assert.deepEqual(['ipday', 'wide', 'capday', 'full', 'cap', 'ipcap', 'ip', 'old', 'seen', 'self', 'code', ''].map(inviteWaits), [true, true, true, true, false, false, false, false, false, false, false, false]);
    assert.equal(inviteFault({ ...ok, perDay: 4, total: 50 }), 'cap');
    assert.equal(inviteFault({ ...ok, perDay: 4, total: 49 }), '');
    assert.equal(inviteFault({ ...ok, dayAll: 39 }), '');
    assert.equal(inviteFault({ ...ok, dayAll: 40 }), 'full');
  });
  it('withInvite adds the code to this site\'s links only', () => {
    const O = ['https://studio.wishboard.workers.dev/', 'http://localhost:8787'];
    assert.equal(withInvite('https://studio.wishboard.workers.dev/rt/w/abcdefghij', 'ab12cd34', O), 'https://studio.wishboard.workers.dev/rt/w/abcdefghij?inv=ab12cd34');
    assert.equal(withInvite('https://studio.wishboard.workers.dev/rt/card/STREET_8?gift=1', 'ab12cd34', O), 'https://studio.wishboard.workers.dev/rt/card/STREET_8?gift=1&inv=ab12cd34');
    assert.equal(withInvite('http://localhost:8787/?tribe=x&inv=zzzzzzzz', 'ab12cd34', O), 'http://localhost:8787/?tribe=x&inv=ab12cd34');
    assert.equal(withInvite('https://evil.example/?a=1', 'ab12cd34', O), 'https://evil.example/?a=1');
    assert.equal(withInvite('https://studio.wishboard.workers.dev/', 'BAD', O), 'https://studio.wishboard.workers.dev/');
    assert.equal(withInvite('not a url', 'ab12cd34', O), 'not a url');
    assert.equal(withInvite('', 'ab12cd34', O), '');
  });
  it('the sheet line shows only with friends; the away row counts payments since last seen', () => {
    assert.equal(inviteLine({ count: 0, earned: 0 }), '');
    assert.equal(inviteLine(null), '');
    assert.equal(inviteLine({ count: 2, earned: 200 }), '초대한 친구 2명 · 받은 코인 200');
    assert.equal(inviteNews({ recent: [] }, 0), null);
    assert.equal(inviteNews({ recent: [100, 200] }, 200), null);
    assert.deepEqual(inviteNews({ recent: [300, 250, 100] }, 200), { kind: 'invite', id: 0, slot: '', text: '초대한 친구 2명이 소원을 걸었어요. +200코인', label: '소원 보기', at: 300 });
  });
  it('awayRows adds the invite row (not for newcomers) and keeps its old shape without one', () => {
    const base = { inbox: [], wish: { mine: null, yesterday: [] }, day: '2027-01-02', now: 5000 };
    assert.deepEqual(awayRows(base), { rows: [], inboxIds: [], wishSeen: null, prizeDay: '' });
    const out = awayRows({ ...base, invite: { recent: [4000, 3000] }, invSeen: 3500 });
    assert.equal(out.rows.length, 1); assert.equal(out.rows[0].kind, 'invite'); assert.equal(out.invSeen, 4000);
    assert.deepEqual(awayRows({ ...base, newbie: true, invite: { recent: [4000] } }).rows, []);
  });
  it('the events are known', () => { for (const n of ['invite_land', 'invite_reward']) assert.ok(EVENT_NAMES.includes(n), n); });
});

describe('invite routes', () => {
  it('happy path: the friend\'s first wish pays both once, and the summary shows counts and times only', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [a, b] = await people(h, state, 2);
      const c = await h.code(a, '1.1.1.1'); assert.match(c, INV_RE);
      assert.equal(await h.code(a, '1.1.1.1'), c); // stable
      const r = await h.wish(b, '같이 합격', c, '2.2.2.2');
      assert.equal(r.ok, true); assert.equal(r.fresh, true); assert.deepEqual(Object.keys(r).sort(), ['fresh', 'ok', 'wish']);
      assert.deepEqual(state.paid.sort(), [[a.id, 100], [b.id, 100]].sort());
      const s = await h.sum(a);
      assert.deepEqual({ ...s, recent: s.recent.length }, { ok: true, code: c, count: 1, today: 1, earned: 100, gift: 0, recent: 1 });
      assert.equal((await h.sum(b, '2.2.2.2')).gift, 100);
      assert.equal(hasActor(JSON.stringify(s)), false);
      // An edit with the code again, and the same code on a later post, pay nothing more.
      clock.add(31000);
      assert.equal((await h.wish(b, '같이 합격 꼭', c, '2.2.2.2')).fresh, false);
      assert.equal(state.paid.length, 2);
    } finally { done(); }
  });
  it('POST makes a code, GET does not; both need a token', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [a] = await people(h, state, 1);
      assert.equal((await h.get('/rt/invite')).status, 401);
      assert.equal((await h.post('/rt/invite', {})).status, 401);
      assert.equal((await h.sum(a)).code, '');
      const c = await h.code(a); assert.equal((await h.sum(a)).code, c);
      assert.equal((await h.call('/rt/invite', { method: 'PUT', headers: { authorization: 'Bearer ' + a.token } })).status, 405);
    } finally { done(); }
  });
  it('refuses the inviter\'s own IP net (code creation, today\'s wish post, IPv6 /64) and self-invites', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [a, b, c2, d, e] = await people(h, state, 5);
      const c = await h.code(a, '2001:db8:1:2::1');
      await h.wish(b, '같은 집', c, '2001:db8:1:2::99'); // same /64
      await h.wish(a, '내 소원', '', '5.5.5.5'); // the inviter posts from another net today
      await h.wish(c2, '카페에서', c, '5.5.5.5');
      await h.wish(a, '', c, '9.9.9.9'); // empty text is refused before anything
      assert.deepEqual(state.paid, []);
      // Own code on one's own first wish: the inviter is the invitee.
      const k = await h.code(d, '7.7.7.7'); await h.wish(d, '나 혼자', k, '8.8.8.8');
      assert.deepEqual(state.paid, []);
      await h.wish(e, '다른 망', c, '6.6.6.6');
      assert.deepEqual(state.paid.sort(), [[a.id, 100], [e.id, 100]].sort());
    } finally { done(); }
  });
  it('an invitee is judged once, ever: a second code or a later day pays nothing', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [a, a2, b, x] = await people(h, state, 4);
      const c = await h.code(a, '1.1.1.1'), c2 = await h.code(a2, '3.3.3.3');
      await h.wish(b, '첫 소원', c, '2.2.2.2'); assert.equal(state.paid.length, 2);
      clock.add(864e5);
      await h.wish(b, '다음 날', c2, '4.4.4.4'); assert.equal(state.paid.length, 2);
      // Refused once (same net as the inviter): tried, so a later try with a good code does not pay either.
      await h.wish(x, '같은 망', c2, '3.3.3.3'); clock.add(864e5);
      await h.wish(x, '다시', c, '8.8.8.8'); assert.equal(state.paid.length, 2);
    } finally { done(); }
  });
  it('a poster with a wish on an earlier day, a board bid for, or a first-seen day over 7 days back is not new', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [a, old, held, free, seen] = await people(h, state, 5);
      const c = await h.code(a, '1.1.1.1');
      await h.wish(old, '어제 소원', '', '2.2.2.2'); clock.add(864e5);
      await h.wish(old, '오늘 소원', c, '2.2.2.2');
      state.boards = [{ slot_id: 'STREET_20', holder_id: held.id, current_bid: 300 }, { slot_id: 'STREET_8', holder_id: free.id, current_bid: 0 }];
      clock.add(16000); await h.get('/rt/world'); // the isolate's world copy, read again once the last one is 15 s old
      await h.wish(held, '전광판 주인', c, '3.3.3.3');
      const ev = env.meter('ev'); ev.do.evInit(); ev.sql.db.prepare('insert into seen(uid, d0) values(?, ?)').run(seen.id, '2020-01-01');
      await h.wish(seen, '예전에 왔던 사람', c, '4.4.4.4');
      assert.deepEqual(state.paid, []);
      await h.wish(free, '무료 칸만', c, '5.5.5.5'); // the free first board (bid 0) does not make one old
      assert.deepEqual(state.paid.sort(), [[a.id, 100], [free.id, 100]].sort());
    } finally { done(); }
  });
  it('caps: 5 friends per inviter per day, 50 in all; one IP net once a day and 3 times in all', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [a] = await people(h, state, 1);
      const c = await h.code(a, '1.1.1.1'), friends = await people(h, state, 6);
      for (let i = 0; i < 6; i++) await h.wish(friends[i], '친구 ' + i, c, '10.0.0.' + (i + 1));
      assert.equal(state.paid.filter(([id]) => id === a.id).length, 5);
      assert.equal(state.paid.some(([id]) => id === friends[5].id), false);
      const m = env.meter('inv').sql.db, ins = m.prepare('insert into ivr(invitee, inviter, day, at, ip) values(?, ?, ?, 0, ?)');
      assert.equal(m.prepare('select count(*) n from ivq where invitee = ?').get(friends[5].id).n, 1); // a daily limit: waits for tomorrow
      // Total: 44 old rewards + 5 today; tomorrow the waiting friend is served first and fills it, the new friends are refused for good.
      clock.add(864e5); state.paid.length = 0;
      for (let i = 0; i < 44; i++) ins.run('guest:old' + i, a.id, '2000-01-01', 'old' + i);
      const more = await people(h, state, 2);
      await h.wish(more[0], '50번째', c, '20.0.0.1'); await h.wish(more[1], '51번째', c, '20.0.0.2');
      assert.deepEqual(state.paid.sort(), [[a.id, 100], [friends[5].id, 100]].sort());
      assert.equal(m.prepare('select tried from ivs where uid = ?').get(more[1].id).tried, 1); // the total cap is final
      // IP net: once a day across inviters (a second friend that day waits), 3 times in all.
      const [p, q] = await people(h, state, 2), cp = await h.code(p, '30.0.0.1'), cq = await h.code(q, '30.0.0.2');
      state.paid.length = 0;
      const net = '40.0.0.9', f = await people(h, state, 5);
      await h.wish(f[0], 'ㄱ', cp, net); await h.wish(f[1], 'ㄴ', cq, net);
      assert.equal(state.paid.length, 2); // only the first that day; f[1] waits
      clock.add(864e5); await h.wish(f[2], 'ㄷ', cq, net); clock.add(864e5); await h.wish(f[3], 'ㄹ', cp, net); clock.add(864e5); await h.wish(f[4], 'ㅁ', cq, net);
      assert.deepEqual(state.paid.filter(([id]) => f.some((x) => x.id === id)).map(([id]) => f.findIndex((x) => x.id === id)), [0, 1, 2]); // 3 rewards on that net in all, one a day
      assert.equal(m.prepare('select count(*) n from ivq').get().n, 0);
    } finally { done(); }
  });
  it('an edit never settles', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [a, b] = await people(h, state, 2), c = await h.code(a, '1.1.1.1');
      await h.wish(b, '처음엔 코드 없이', '', '2.2.2.2'); clock.add(31000);
      const r = await h.wish(b, '고친 소원', c, '2.2.2.2');
      assert.equal(r.ok, true); assert.equal(r.fresh, false); assert.deepEqual(state.paid, []);
    } finally { done(); }
  });
  it('a missing wallet is retried 60 s later and paid once; a 5xx is never retried', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [a] = await people(h, state, 1), b = await h.guest(), c = await h.code(a, '1.1.1.1');
      await h.wish(b, '지갑이 아직', c, '2.2.2.2');
      assert.deepEqual(state.paid, [[a.id, 100]]);
      assert.equal((await h.sum(b, '2.2.2.2')).gift, 0);
      state.wallets.add(b.id);
      clock.add(30000); await h.sum(b, '2.2.2.2'); assert.equal(state.paid.length, 1); // not due yet
      clock.add(31000); await h.sum(b, '2.2.2.2');
      assert.deepEqual(state.paid.sort(), [[a.id, 100], [b.id, 100]].sort());
      assert.equal((await h.sum(b, '2.2.2.2')).gift, 100);
      for (let i = 0; i < 3; i++) { clock.add(61000); await h.sum(b, '2.2.2.2'); await h.get('/rt/wishes'); }
      assert.equal(state.paid.length, 2);
      // 5xx: unknown outcome, stays paid, never handed out again.
      const [p] = await people(h, state, 1), q = await h.guest(), cp = await h.code(p, '3.3.3.3'); state.fail5xx.add(q.id); state.wallets.add(q.id);
      await h.wish(q, '알 수 없음', cp, '4.4.4.4');
      for (let i = 0; i < 3; i++) { clock.add(61000); await h.sum(q, '4.4.4.4'); }
      assert.equal(state.paid.filter(([id]) => id === q.id).length, 0);
      assert.equal(Number(db(env).prepare('select tries from ivp where uid = ?').get(q.id).tries), 1);
    } finally { done(); }
  });
  it('refused retries stop after INVITE.tries attempts', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [a] = await people(h, state, 1), b = await h.guest(), c = await h.code(a, '1.1.1.1');
      await h.wish(b, '지갑 없음', c, '2.2.2.2');
      const grants = () => state.calls.filter((x) => x.url.includes('/rpc/grant_coins') && JSON.parse(x.body).p_actor_id === b.id).length;
      for (let i = 0; i < INVITE.tries + 3; i++) { clock.add(61000); await h.sum(b, '2.2.2.2'); }
      assert.equal(grants(), INVITE.tries);
    } finally { done(); }
  });
  it('at budget level hard the wish post is refused (guard) and no invite payment goes out', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [a, b] = await people(h, state, 2), w = await h.guest(), c = await h.code(a, '1.1.1.1');
      await h.wish(w, '지갑 없음', c, '3.3.3.3'); assert.deepEqual(state.paid, [[a.id, 100]]); // w's gift waits for a retry
      const grants = () => state.calls.filter((x) => x.url.includes('/rpc/grant_coins')).length, g0 = grants();
      env.BUDGET_REQ_DAY = '1'; state.wallets.add(w.id); clock.add(61000); await h.sum(a); // the level is read again (60 s), hard
      const r = await h.wish(b, '예산 끝', c, '2.2.2.2');
      assert.equal(r.ok, false); assert.equal(r.code, 'busy');
      clock.add(61000); await h.sum(a); await h.sum(w, '3.3.3.3');
      assert.equal(grants(), g0); // no retry handed out at hard
      assert.equal(db(env).prepare('select count(*) n from ivs where uid = ?').get(b.id).n, 0); // not judged on the server; the client keeps kts_inv_from only when the post itself was refused
      delete env.BUDGET_REQ_DAY; clock.add(61000); await h.sum(a); clock.add(61000); await h.sum(a);
      assert.deepEqual(state.paid.filter(([id]) => id === w.id), [[w.id, 100]]); // paid once the level drops
    } finally { done(); }
  });
  it('merge moves the code, counts and a pending reward to the user; the old guest cannot then invite itself', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [g, f1, f2] = await people(h, state, 3), u = await userToken(state, clock, '33333333-2222-3333-4444-555555555555');
      const c = await h.code(g, '1.1.1.1');
      await h.wish(f1, '첫 친구', c, '2.2.2.2'); assert.equal(state.paid.length, 2);
      // g was an invitee too, with a payment refused for a missing wallet.
      const [o] = await people(h, state, 1), co = await h.code(o, '7.7.7.7');
      state.wallets.delete(g.id); await h.wish(g, '나도 초대받음', co, '8.8.8.8'); assert.equal(state.paid.length, 3);
      assert.equal((await h.post('/rt/auth/merge', { guest_id: g.id, guest_token: g.token }, u.token)).status, 200);
      const s = await h.sum(u);
      assert.equal(s.code, c); assert.equal(s.count, 1); assert.equal(s.earned, 100);
      assert.equal(db(env).prepare('select count(*) n from ivp where uid = ?').get(g.id).n, 0);
      state.wallets.add(u.id); clock.add(61000); await h.sum(u);
      assert.deepEqual(state.paid.at(-1), [u.id, 100]); // the guest's pending gift reached the user's wallet
      assert.equal((await h.sum(u)).gift, 100);
      // The old code now pays the user; the old guest token on the user's code is a self-invite.
      await h.wish(f2, '두 번째 친구', c, '3.3.3.3');
      assert.deepEqual(state.paid.slice(-2).sort(), [[f2.id, 100], [u.id, 100]].sort());
      const n = state.paid.length; clock.add(864e5);
      const out = env.meter('inv').do.ivPost({ uid: g.id, ip: 'zz', day: wishDay(clock.now()), fresh: true, code: c });
      assert.equal(out.fault, 'self'); assert.equal(state.paid.length, n);
    } finally { done(); }
  });
  it('withdrawal removes codes, nets and payments, and keeps reward rows without ids', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [f] = await people(h, state, 1), u = await userToken(state, clock, '44444444-2222-3333-4444-555555555555');
      state.wallets.add(u.id);
      const c = await h.code(u, '1.1.1.1'); await h.wish(f, '친구', c, '2.2.2.2'); assert.equal(state.paid.length, 2);
      assert.equal((await h.post('/rt/auth/withdraw', {}, u.token)).status, 200);
      const m = db(env);
      for (const [t, col] of [['ivc', 'uid'], ['ivip', 'uid'], ['ivp', 'uid'], ['ivr', 'inviter'], ['ivs', 'uid']]) assert.equal(m.prepare(`select count(*) n from ${t} where ${col} = ?`).get(u.id).n, 0, t);
      assert.equal(m.prepare('select count(*) n from ivr').get().n, 1);
      assert.equal(m.prepare("select count(*) n from ivc where code = ?").get(c).n, 0);
    } finally { done(); }
  });
});

describe('share pages keep ?inv= through their redirect', () => {
  it('/rt/w, /rt/s and /rt/card carry a valid code and drop a malformed one', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [a] = await people(h, state, 1);
      const w = (await h.wish(a, '공유할 소원', '', '1.1.1.1')).wish;
      let html = await (await h.get('/rt/w/' + w.id + '?inv=ab12cd34')).text();
      assert.match(html, new RegExp('content="0;url=/\\?wish=' + w.id + '&amp;inv=ab12cd34"'));
      assert.match(html, new RegExp('location\\.replace\\("/\\?wish=' + w.id + '&inv=ab12cd34"\\)'));
      html = await (await h.get('/rt/w/' + w.id + '?inv=%22%3E%3Cscript%3E')).text();
      assert.doesNotMatch(html, /inv=|<script>alert|%3Cscript/);
      let r = await h.get('/rt/w/zzzzzzzzzz?inv=ab12cd34'); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), 'https://sq.example/?inv=ab12cd34');
      r = await h.get('/rt/w/zzzzzzzzzz?inv=BAD'); assert.equal(r.headers.get('location'), 'https://sq.example/');
      r = await h.get('/rt/s/nothex?inv=ab12cd34'); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), 'https://sq.example/?inv=ab12cd34');
      const jpeg = new Uint8Array(1200); jpeg[0] = 0xff; jpeg[1] = 0xd8;
      const page = (await (await h.call('/rt/snap?wish=' + w.id, { method: 'POST', headers: { authorization: 'Bearer ' + a.token, 'content-type': 'image/jpeg' }, body: jpeg })).json()).page;
      html = await (await h.get(new URL(page).pathname + '?inv=ab12cd34')).text();
      assert.match(html, new RegExp('location\\.replace\\("/\\?wish=' + w.id + '&inv=ab12cd34"\\)'));
      const plain = (await (await h.call('/rt/snap', { method: 'POST', headers: { authorization: 'Bearer ' + a.token, 'content-type': 'image/jpeg' }, body: jpeg })).json()).page;
      html = await (await h.get(new URL(plain).pathname + '?inv=ab12cd34')).text();
      assert.match(html, /location\.replace\("\/\?inv=ab12cd34"\)/);
      html = await (await h.get('/rt/card/STREET_8?gift=1&inv=ab12cd34')).text();
      assert.match(html, /url=\/\?focus=STREET_8&amp;gift=1&amp;inv=ab12cd34"/);
      html = await (await h.get('/rt/card/STREET_8?inv=x%22y')).text();
      assert.doesNotMatch(html, /inv=/);
    } finally { done(); }
  });
});

// Review fixes: the service-wide day cap, the 7-day "new" window, a guest linked before or after its gift, and the reviewer's attack cases.
describe('invite review fixes', () => {
  const seenOn = (env, id, day) => { const ev = env.meter('ev'); ev.do.evInit(); ev.sql.db.prepare('insert into seen(uid, d0) values(?, ?)').run(id, day); };
  it('kts_inv_from is forgotten 7 days after it was kept', () => {
    const now = Date.parse('2027-01-10T00:00:00Z');
    assert.equal(inviteFrom(JSON.stringify({ c: 'ab12cd34', at: now - 7 * 864e5 }), now), 'ab12cd34');
    assert.equal(inviteFrom(JSON.stringify({ c: 'ab12cd34', at: now - 7 * 864e5 - 1 }), now), '');
    for (const bad of ['ab12cd34', JSON.stringify({ c: 'BAD', at: now }), JSON.stringify({ c: 'ab12cd34' }), null, '']) assert.equal(inviteFrom(bad, now), '', String(bad));
  });
  it('coarse prefixes: IPv6 /48, IPv4 /24', () => {
    assert.equal(ipWide('2001:db8:aaaa:1::5'), '2001:db8:aaaa::/48');
    assert.equal(ipWide('2001:DB8:AAAA:ffff:1:2:3:4'), '2001:db8:aaaa::/48');
    assert.equal(ipWide('203.0.113.77'), '203.0.113.0/24');
    assert.equal(ipWide('::ffff:203.0.113.77'), '203.0.113.0/24');
    assert.equal(ipWide(''), 'x');
  });
  it('B1: one /48 farm gets 5 rewards a day, the day is not exhausted, and a real friend elsewhere is paid', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), h = harness(env); let net = 2;
      for (let k = 0; k < 10; k++) { // 10 throwaway inviters × 5 friends, every friend on its own /64 of one /48
        const [inv] = await people(h, state, 1), c = await h.code(inv, '2001:db8:aaaa:1::1'), f = await people(h, state, 5);
        for (let i = 0; i < 5; i++) await h.wish(f[i], '소원' + i, c, '2001:db8:aaaa:' + (net++).toString(16) + '::5');
      }
      assert.equal(state.paid.length, 2 * INVITE.wideDay);
      assert.equal(db(env).prepare('select count(*) n from ivq').get().n, INVITE.wideDay); // the prefix's daily limit: 5 may wait, the other 40 are refused for good
      const [real, friend] = await people(h, state, 2), rc = await h.code(real, '9.9.9.9');
      await h.wish(friend, '진짜 친구', rc, '8.8.8.8');
      assert.deepEqual(state.paid.slice(-2).sort(), [[friend.id, 100], [real.id, 100]].sort());
    } finally { done(); }
  });
  it('a full day queues the 41st pair and pays it first thing the next day, once, even when 40 new pairs arrive', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env);
      const day = async (tag, n) => { for (let k = 0; k < n / 5; k++) { const [inv] = await people(h, state, 1), c = await h.code(inv, `172.${tag}.${k}.1`), f = await people(h, state, 5);
        for (let i = 0; i < 5; i++) await h.wish(f[i], '소원' + tag + k + i, c, `10.${tag}.${k * 5 + i}.1`); } }; // 40 distinct /24s
      await day(1, INVITE.dayAll);
      assert.equal(state.paid.length, 2 * INVITE.dayAll);
      const [p, q] = await people(h, state, 2), cp = await h.code(p, '9.9.9.9');
      await h.wish(q, '마흔한 번째', cp, '11.0.0.1');
      assert.equal(state.paid.length, 2 * INVITE.dayAll);
      assert.equal(db(env).prepare('select count(*) n from ivq where invitee = ?').get(q.id).n, 1);
      assert.equal(db(env).prepare('select tried from ivs where uid = ?').get(q.id).tried, 0); // not final
      clock.add(864e5); state.paid.length = 0;
      await day(2, INVITE.dayAll); // 40 new pairs: the waiting one is served before the first of them
      assert.deepEqual(state.paid.slice(0, 2).sort(), [[p.id, 100], [q.id, 100]].sort());
      assert.equal(state.paid.filter(([id]) => id === q.id).length, 1);
      assert.equal(state.paid.length, 2 * INVITE.dayAll); // 1 queued + 39 new; the 40th new pair waits for tomorrow
      assert.equal(db(env).prepare('select count(*) n from ivq').get().n, 1);
      assert.equal((await h.sum(q, '11.0.0.1')).gift, 100); // what the friend's client reads on its next entry
      assert.equal(db(env).prepare('select day from ivr where invitee = ?').get(q.id).day, wishDay(clock.now()));
    } finally { done(); }
  });
  it('a waiting pair is dropped when its inviter reaches the total cap meanwhile, and after 7 days', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [p, q, p2, q2] = await people(h, state, 4), cp = await h.code(p, '9.9.9.9'), cp2 = await h.code(p2, '9.9.8.8');
      const m = db(env), fill = (d) => { const ins = m.prepare("insert into ivr(invitee, inviter, day, at, ip, wide) values(?, 'guest:filler', ?, 0, ?, ?)"); for (let i = 0; i < INVITE.dayAll; i++) ins.run('guest:f' + d + i, d, 'ip' + d + i, 'w' + d + i); };
      fill(wishDay(clock.now()));
      await h.wish(q, '기다림', cp, '11.0.0.1'); await h.wish(q2, '기다림2', cp2, '12.0.0.1');
      assert.equal(m.prepare('select count(*) n from ivq').get().n, 2);
      const old = m.prepare("insert into ivr(invitee, inviter, day, at, ip, wide) values(?, ?, '2000-01-01', 0, ?, '')"); for (let i = 0; i < INVITE.total; i++) old.run('guest:o' + i, p.id, 'o' + i);
      clock.add(864e5); await h.sum(p, '9.9.9.9'); // a lazy pass: p is over the total cap, p2 is fine
      assert.equal(m.prepare('select count(*) n from ivq').get().n, 0);
      assert.deepEqual(state.paid.sort(), [[p2.id, 100], [q2.id, 100]].sort());
      assert.equal(m.prepare('select tried from ivs where uid = ?').get(q.id).tried, 1);
      // Expiry: a pair that waited more than queueDays is dropped without pay.
      const [r, s] = await people(h, state, 2), cr = await h.code(r, '9.9.7.7'); fill(wishDay(clock.now()));
      await h.wish(s, '오래 기다림', cr, '13.0.0.1'); assert.equal(m.prepare('select count(*) n from ivq').get().n, 1);
      clock.add((INVITE.queueDays + 1) * 864e5); state.paid.length = 0; await h.sum(r, '9.9.7.7');
      assert.equal(m.prepare('select count(*) n from ivq').get().n, 0); assert.deepEqual(state.paid, []);
    } finally { done(); }
  });
  it('merge moves a waiting pair to the user ids; withdrawal deletes it', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [p, q, p2, q2] = await people(h, state, 4), cp = await h.code(p, '9.9.9.9'), cp2 = await h.code(p2, '9.9.8.8'), M = env.meter('inv').do, m = db(env);
      const ins = m.prepare("insert into ivr(invitee, inviter, day, at, ip, wide) values(?, 'guest:filler', ?, 0, ?, ?)"); for (let i = 0; i < INVITE.dayAll; i++) ins.run('guest:f' + i, wishDay(clock.now()), 'ip' + i, 'w' + i);
      await h.wish(q, '기다림', cp, '11.0.0.1'); await h.wish(q2, '기다림2', cp2, '12.0.0.1');
      const up = 'user:77777777-2222-3333-4444-555555555555', uq = 'user:88888888-2222-3333-4444-555555555555';
      M.ivMove(p.id, up); M.ivMove(q.id, uq); state.wallets.add(up); state.wallets.add(uq);
      assert.deepEqual({ ...m.prepare('select invitee, inviter from ivq where inviter = ?').get(up) }, { invitee: uq, inviter: up });
      M.ivForget(p2.id); assert.equal(m.prepare('select count(*) n from ivq where inviter = ? or invitee = ?').get(p2.id, p2.id).n, 0);
      clock.add(864e5); await h.sum(p, '9.9.9.9');
      assert.deepEqual(state.paid.sort(), [[up, 100], [uq, 100]].sort());
    } finally { done(); }
  });
  it('first seen up to 7 days back is still new: land day 1, first wish day 2 pays, day 9 does not (own codes made on day 1 do not count)', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [a, b, l] = await people(h, state, 3), code = await h.code(a, '1.1.1.1');
      seenOn(env, b.id, wishDay(clock.now())); seenOn(env, l.id, wishDay(clock.now()));
      await h.code(b, '2.2.2.2'); await h.code(l, '3.3.3.3'); // the client makes their own codes on day 1
      clock.add(864e5); await h.wish(b, '이튿날', code, '2.2.2.2');
      assert.deepEqual(state.paid.sort(), [[a.id, 100], [b.id, 100]].sort());
      clock.add(7 * 864e5); await h.wish(l, '아흐레째', code, '3.3.3.3');
      assert.equal(state.paid.length, 2);
    } finally { done(); }
  });
  it('own code at 23:59:30 KST and the first wish at 00:00:30 pays', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [a, b] = await people(h, state, 2), c = await h.code(a, '1.1.1.1');
      const kst = (Date.now() + 9 * 36e5) % 864e5; clock.add(864e5 - kst - 30000);
      seenOn(env, b.id, wishDay(clock.now())); await h.code(b, '2.2.2.2'); clock.add(60000);
      await h.wish(b, '자정 넘어', c, '2.2.2.2');
      assert.deepEqual(state.paid.sort(), [[a.id, 100], [b.id, 100]].sort());
    } finally { done(); }
  });
  it('a guest linked before its first wish settles is paid on the user id', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [a, g] = await people(h, state, 2), c = await h.code(a, '1.1.1.1'), u = 'user:55555555-2222-3333-4444-555555555555';
      await env.METER.get('inv').ivMove(g.id, u); state.wallets.delete(g.id); state.wallets.add(u);
      await h.wish(g, '연결 직후', c, '2.2.2.2');
      assert.deepEqual(state.paid.sort(), [[a.id, 100], [u, 100]].sort());
    } finally { done(); }
  });
  it('a gift refused for a guest linked since (ev alias) goes to its user on a later try, once', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [a] = await people(h, state, 1), g = await h.guest(), c = await h.code(a, '1.1.1.1'), u = 'user:66666666-2222-3333-4444-555555555555';
      await h.wish(g, '지갑 없음', c, '2.2.2.2'); assert.deepEqual(state.paid, [[a.id, 100]]);
      env.meter('ev').do.evAlias(g.id, u); state.wallets.add(u);
      for (let i = 0; i < 5; i++) { clock.add(61000); await h.sum(a); }
      assert.deepEqual(state.paid.filter(([id]) => id !== a.id), [[u, 100]]);
    } finally { done(); }
  });
  it('concurrent fresh posts with one code pay once, replays pay nothing, two ivDue at once hand a row out once', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [a, b] = await people(h, state, 2), c = await h.code(a, '1.1.1.1');
      const rs = await Promise.all([h.wish(b, '동시1', c, '2.2.2.2'), h.wish(b, '동시2', c, '2.2.2.2'), h.wish(b, '동시3', c, '2.2.2.2')]);
      assert.equal(rs.filter((r) => r.fresh).length, 1); assert.equal(state.paid.length, 2);
      for (let i = 0; i < 4; i++) { clock.add(31000); await h.wish(b, '재전송' + i, c, '2.2.2.2'); }
      assert.equal(state.paid.length, 2);
      const [p] = await people(h, state, 1), q = await h.guest(), cp = await h.code(p, '3.3.3.3');
      await h.wish(q, '지갑 없음', cp, '4.4.4.4'); clock.add(61000);
      const M = env.METER.get('inv'), [r1, r2] = await Promise.all([M.ivDue(Date.now()), M.ivDue(Date.now())]);
      assert.equal(r1.due.length + r2.due.length, 1);
    } finally { done(); }
  });
  it('hostile inv values never fail a wish post with a 5xx and are never reflected', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [a] = await people(h, state, 1);
      for (const inv of [['ab12cd34'], 'a'.repeat(100000), 'ab12cd34\n', 12345678, { a: 1 }]) assert.ok((await h.post('/rt/wish', { text: '모양', nick: 'n', inv }, a.token, '1.1.1.1')).status < 500);
      for (const p of ['/rt/card/STREET_8?inv=ab12cd34&inv=%3Cx%3E', '/rt/card/STREET_8?inv=%3Cx%3E&inv=ab12cd34', '/rt/s/' + 'a'.repeat(32) + '?inv=ab12cd34%22', '/rt/w/abcdefghij?inv=ab12cd34%0a']) {
        const r = await h.get(p), t = await r.text();
        assert.doesNotMatch(t + String(r.headers.get('location') || ''), /<x>|%3Cx|ab12cd34%22|ab12cd34&quot;|ab12cd34\n|ab12cd34%0a/i, p);
      }
    } finally { done(); }
  });
});
// Round 3: the waiting queue is bounded in what goes in and in what one call does, served round-robin by coarse prefix, and daily refusals wait.
describe('invite queue bounds', () => {
  const today = (clock) => wishDay(clock.now()), yday = (clock) => wishDay(clock.now() - 864e5);
  const fillDay = (m, d, n = INVITE.dayAll) => { const ins = m.prepare("insert into ivr(invitee, inviter, day, at, ip, wide) values(?, 'guest:filler', ?, 0, ?, ?)"); for (let i = 0; i < n; i++) ins.run('guest:fill' + d + i, d, 'fip' + d + i, 'fw' + d + i); };
  const queue = (m, rows) => { const ins = m.prepare("insert into ivq(invitee, inviter, ip, wide, day, at) values(?, ?, ?, ?, ?, ?)"); for (const r of rows) ins.run(r.u, r.i, r.ip, r.w, r.d, r.at); };
  it('B5: admission is bounded: one /48 with one inviter queues 5 a day, 40 prefixes fill the 200 ceiling, the rest are refused for good', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), M = env.meter('inv').do, m = db(env), d = today(clock);
      const [x] = await people(h, state, 1), c = await h.code(x, '6.6.6.6'); fillDay(m, d);
      for (let i = 0; i < 3000; i++) M.ivPost({ uid: 'guest:q' + i, ip: 'n' + Math.floor(i / 20), wide: 'W9', day: d, fresh: true, code: c });
      assert.equal(m.prepare('select count(*) n from ivq').get().n, 5);
      assert.equal(m.prepare('select count(*) n from ivs where tried = 1').get().n, 2995); // the others: refused for good
      for (let k = 0; k < 40; k++) { const ck = M.ivCode('guest:inv' + k, 'iv' + k, d).code;
        for (let i = 0; i < 10; i++) M.ivPost({ uid: 'guest:p' + k + '_' + i, ip: 'pn' + k + '_' + i, wide: 'PW' + k, day: d, fresh: true, code: ck }); }
      assert.equal(m.prepare('select count(*) n from ivq').get().n, INVITE.queueMax); // 5 + 39 prefixes × 5, the 40th prefix hits the ceiling
      const out = M.ivPost({ uid: 'guest:late', ip: 'late', wide: 'LATE', day: d, fresh: true, code: c });
      assert.equal(out.fault, 'full'); assert.equal(out.wait, undefined);
      assert.equal(m.prepare('select tried from ivs where uid = ?').get('guest:late').tried, 1);
    } finally { done(); }
  });
  it('one call looks at 50 waiting pairs at most; a 500-row queue drains over calls, every row handled once', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), M = env.meter('inv').do, m = db(env), y = yday(clock), d = today(clock);
      await people(h, state, 0); M.ivInit();
      const rows = Array.from({ length: 500 }, (_, i) => ({ u: 'guest:w' + i, i: i % 50 === 7 ? 'guest:boss' + (Math.floor(i / 50) % 2) : '', ip: 'ip' + i, w: 'w' + i, d: y, at: i }));
      queue(m, rows); const payable = rows.filter((r) => r.i).map((r) => r.u);
      const paid = [], left = () => m.prepare('select count(*) n from ivq').get().n; let calls = 0, more = true;
      while (more && calls < 100) { const before = left(), r = M.ivDue(clock.now(), d); calls += 1; assert.ok(before - left() <= INVITE.passRows, 'call ' + calls); assert.ok(r.due.length <= INVITE.payMax);
        for (const p of r.due) if (p.side === 'invitee') paid.push(p.uid); more = r.more || r.left > 0; }
      assert.equal(left(), 0); assert.ok(calls >= 10, String(calls));
      assert.deepEqual(paid.sort(), payable.sort());
      assert.equal(m.prepare('select count(*) n from ivr where day = ?').get(d).n, payable.length);
    } finally { done(); }
  });
  it('round-robin by coarse prefix: a friend queued after 30 attacker pairs on 6 prefixes is among the first served', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), M = env.meter('inv').do, m = db(env), y = yday(clock), d = today(clock);
      await people(h, state, 0); M.ivInit(); let at = 0; const rows = [];
      for (let k = 0; k < 6; k++) for (let i = 0; i < 5; i++) rows.push({ u: 'guest:a' + k + i, i: 'guest:atk' + k, ip: 'aip' + k + i, w: 'AW' + k, d: y, at: at++ });
      rows.push({ u: 'guest:friend', i: 'guest:real', ip: 'fip', w: 'FW', d: y, at: at++ }); queue(m, rows);
      const order = []; let more = true;
      while (more) { const r = M.ivDue(clock.now(), d); for (const p of r.due) if (p.side === 'invitee') order.push(p.uid); more = r.more || r.left > 0; }
      assert.equal(order.length, 31);
      assert.equal(order.indexOf('guest:friend'), 6); // after the six attackers' first pairs, before any second (FIFO would make it 31st)
    } finally { done(); }
  });
  it('a waiting pair held back by a daily limit stays and is paid the next day', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), M = env.meter('inv').do, m = db(env);
      await people(h, state, 0); M.ivInit();
      queue(m, [{ u: 'guest:waiter', i: 'guest:busy', ip: 'wip', w: 'WW', d: yday(clock), at: 1 }]);
      const ins = m.prepare("insert into ivr(invitee, inviter, day, at, ip, wide) values(?, 'guest:busy', ?, 0, ?, ?)"); for (let i = 0; i < 5; i++) ins.run('guest:b' + i, today(clock), 'bip' + i, 'bw' + i);
      let r = M.ivDue(clock.now(), today(clock)); assert.equal(r.due.length, 0); assert.equal(r.more, false); // held back: looked at once today
      assert.equal(m.prepare('select td from ivq where invitee = ?').get('guest:waiter').td, today(clock));
      assert.equal(M.ivDue(clock.now(), today(clock)).due.length, 0);
      clock.add(864e5); r = M.ivDue(clock.now(), today(clock));
      assert.deepEqual(r.due.map((p) => p.uid).sort(), ['guest:busy', 'guest:waiter']);
      assert.equal(m.prepare('select count(*) n from ivq').get().n, 0);
    } finally { done(); }
  });
  it('at budget level hard GET /rt/invite answers busy and POST 503 without touching the inv instance', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [a] = await people(h, state, 1); await h.code(a);
      env.BUDGET_REQ_DAY = '1'; clock.add(61000); await h.get('/rt/here'); clock.add(61000);
      const calls = [], real = env.METER.get; env.METER.get = (n) => { const s = real(n); if (n !== 'inv') return s; return new Proxy(s, { get: (t, k) => { calls.push(String(k)); return t[k]; } }); };
      let r = await h.get('/rt/invite', a.token);
      if (!(await r.clone().json()).busy) { clock.add(61000); r = await h.get('/rt/invite', a.token); } // the level is read at most once a minute
      assert.deepEqual(await r.json(), { ok: true, busy: true });
      const p = await h.post('/rt/invite', {}, a.token); assert.equal(p.status, 503); assert.deepEqual(await p.json(), { ok: false, code: 'busy' });
      calls.length = 0; await h.get('/rt/invite', a.token); await h.post('/rt/invite', {}, a.token);
      assert.deepEqual(calls, []);
    } finally { done(); }
  });
});
// Round 4: one invocation pays a bounded few, and the master switch (INVITE_ON) keeps the whole feature dark when it is not '1'.
describe('invite budget per invocation and the master switch', () => {
  const spy = (env) => { const log = { inv: 0, ev: 0, do: 0 }, og = env.METER.get, ogr = env.ROOM.get;
    env.METER.get = (name) => { const s = og(name); return new Proxy(s, { get: (t, k) => { const v = t[k]; return typeof v === 'function' ? (...ar) => { log.do += 1; if (name === 'inv') log.inv += 1; if (name === 'ev') log.ev += 1; return v(...ar); } : v; } }); };
    env.ROOM.get = (name) => { log.do += 1; return ogr(name); }; return log; };
  it('a wish post with a code pays at most 2 and runs no lazy pass; other routes pay at most 3, one push each', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), m = db(env), d = wishDay(clock.now());
      const [a, b] = await people(h, state, 2); env.meter('inv').do.ivInit();
      // 20 due payments and 10 waiting pairs from yesterday, all payable (written before today's first pass)
      for (let i = 0; i < 20; i++) { const uid = 'guest:late' + i; state.wallets.add(uid); m.prepare("insert into ivp(id, uid, side, amount, paid, tries, at) values(?, ?, 'inviter', 100, 0, 1, 0)").run('late' + i, uid); }
      const qi = m.prepare('insert into ivq(invitee, inviter, ip, wide, day, at) values(?, ?, ?, ?, ?, ?)'); for (let i = 0; i < 10; i++) { qi.run('guest:qq' + i, 'guest:qi' + (i % 2), 'qip' + i, 'qw' + i, wishDay(clock.now() - 864e5), i); state.wallets.add('guest:qq' + i); state.wallets.add('guest:qi' + (i % 2)); }
      const c = await h.code(a, '9.9.9.9'); clock.add(61000); const log = spy(env), f0 = state.calls.length, p0 = state.paid.length;
      await h.wish(b, '최악', c, '8.8.8.8');
      const fetches = state.calls.slice(f0).filter((z) => !z.url.includes('jwks')).length;
      assert.ok(state.paid.length - p0 <= INVITE.payWish, String(state.paid.length - p0));
      assert.ok(fetches + log.do <= 25, `fetches ${fetches} + DO calls ${log.do}`);
      for (const route of [() => h.get('/rt/wishes'), () => h.sum(a, '9.9.9.9')]) {
        clock.add(61000); const p1 = state.paid.length; log.do = 0; const f1 = state.calls.length; await route();
        assert.ok(state.paid.length - p1 <= INVITE.payMax); assert.ok(state.calls.length - f1 + log.do <= 25, `${state.calls.length - f1} + ${log.do}`);
      }
      // nothing is lost: later invocations pay the rest, each payment once
      for (let i = 0; i < 40; i++) { clock.add(61000); await h.sum(a, '9.9.9.9'); }
      const ids = state.paid.map(([id]) => id); for (let i = 0; i < 20; i++) assert.equal(ids.filter((x) => x === 'guest:late' + i).length, 1);
      for (let i = 0; i < 10; i++) assert.equal(ids.filter((x) => x === 'guest:qq' + i).length, 1);
      assert.equal(m.prepare('select count(*) n from ivp where done = 0').get().n, 0);
      assert.equal(d, d);
    } finally { done(); }
  });
  it('switch off: no invite flag in /rt/config, /rt/invite is 404 off, wish posts and lists never touch inv, share pages still carry inv', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv({ INVITE_ON: '' }), h = harness(env), [a, b] = await people(h, state, 2);
      const log = spy(env);
      const cfg = await (await h.get('/rt/config')).json(); assert.equal('invite' in cfg, false);
      for (const r of [await h.get('/rt/invite', a.token), await h.post('/rt/invite', {}, a.token)]) { assert.equal(r.status, 404); assert.deepEqual(await r.json(), { ok: false, code: 'off' }); }
      const w = await h.wish(b, '꺼진 동안', 'ab12cd34', '2.2.2.2'); assert.equal(w.ok, true);
      await h.get('/rt/wishes'); await h.get('/rt/wishes', a.token);
      assert.equal(log.inv, 0); assert.equal(log.ev, 0); assert.deepEqual(state.paid, []);
      const html = await (await h.get('/rt/w/' + w.wish.id + '?inv=ab12cd34')).text(); assert.match(html, /&inv=ab12cd34/);
      env.INVITE_ON = '1'; assert.equal((await (await h.get('/rt/config')).json()).invite, true);
    } finally { done(); }
  });
  it('switch off: merge and withdrawal still move and delete invite rows', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [g] = await people(h, state, 1), u = await userToken(state, clock, '99999999-2222-3333-4444-555555555555');
      const c = await h.code(g, '1.1.1.1'); env.INVITE_ON = '';
      assert.equal((await h.post('/rt/auth/merge', { guest_id: g.id, guest_token: g.token }, u.token)).status, 200);
      assert.equal(db(env).prepare('select uid from ivc where code = ?').get(c).uid, u.id);
      assert.equal((await h.post('/rt/auth/withdraw', {}, u.token)).status, 200);
      assert.equal(db(env).prepare('select count(*) n from ivc where code = ?').get(c).n, 0);
    } finally { done(); }
  });
  it('the screen helpers: off shows and sends nothing; on shows the line, the box from one friend, and sends the landing code', () => {
    const sum = { count: 2, earned: 200 };
    assert.deepEqual(inviteView({ on: false, code: 'ab12cd34', sum, from: 'zz12cd34' }), { code: '', line: '', box: '', send: '' });
    assert.deepEqual(inviteView({}), { code: '', line: '', box: '', send: '' });
    assert.deepEqual(inviteView({ on: true, code: 'ab12cd34', sum, from: 'zz12cd34' }), { code: 'ab12cd34', line: '친구가 이 링크로 와서 소원을 걸면 둘 다 100코인', box: '초대한 친구 2명 · 받은 코인 200', send: 'zz12cd34' });
    assert.equal(inviteView({ on: true, sum: { count: 50, earned: 5000 } }).line, '');
    assert.equal(inviteView({ on: true, sum: { count: 0 } }).box, '');
    assert.equal(inviteOn({ INVITE_ON: '1' }), true); for (const v of [undefined, '', '0', 'true', 1]) assert.equal(inviteOn({ INVITE_ON: v }), false, String(v));
  });
});
describe('invite and the wish prize settlement', () => {
  it('a wish post that runs the invite step skips the prize settlement; a post without a code still settles', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), h = harness(env), [a, b, x] = await people(h, state, 3), c = await h.code(a, '9.9.9.9');
      let settles = 0; const og = env.METER.get;
      env.METER.get = (name) => { const s = og(name); return name !== 'wish' ? s : new Proxy(s, { get: (t, k) => k === 'wSettle' ? (...ar) => { settles += 1; return t[k](...ar); } : t[k] }); };
      await h.wish(b, '코드와 함께', c, '8.8.8.8');
      assert.equal(settles, 0); assert.equal(state.paid.length, 2);
      await h.wish(x, '코드 없이', '', '7.7.7.7');
      assert.equal(settles, 1);
    } finally { done(); }
  });
});