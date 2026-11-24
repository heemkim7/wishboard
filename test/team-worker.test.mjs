// 응원 팀과 명당 on the Worker (teamsrv.js through worker.js): making, joining and leaving a team, who counts as a supporter (linked, 3 days old,
// one per network per team per day, guests recorded but not counted), the KST day boundary, the day's plan for the prime screens (goals,
// participation, anniversaries, the 9 pm team), the public page and rankings, the hard budget level, the account flows, and the admin view.
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
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
const { PRIME, kstDay, dayStart, addDays, primeAt } = await import('../primerules.js');
const { teamDb, teamDrop } = await import('../teamsrv.js');

function sqliteStorage(db = new DatabaseSync(':memory:')) {
  return {
    db,
    exec(query, ...args) {
      const q = String(query).trim();
      if (!args.length && /^create\b/i.test(q)) { db.exec(q); return { rowsWritten: 0, toArray() { return []; }, one() { return {}; }, [Symbol.iterator]() { return [][Symbol.iterator](); } }; }
      const stmt = db.prepare(q);
      if (/^select\b/i.test(q)) { const rows = stmt.all(...args); return { rowsWritten: 0, toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error('expected one row for ' + q); return rows[0]; }, [Symbol.iterator]: () => rows[Symbol.iterator]() }; }
      const info = stmt.run(...args);
      return { rowsWritten: info.changes, toArray: () => [], [Symbol.iterator]() { return [][Symbol.iterator](); } };
    },
  };
}
function makeCtx(sql) {
  return { storage: { sql, async getAlarm() { return null; }, async setAlarm() {}, async deleteAlarm() {}, transactionSync(fn) { return fn(); } }, setWebSocketAutoResponse() {}, getWebSockets() { return []; }, getWebSocketAutoResponseTimestamp() { return new Date(); }, acceptWebSocket() {} };
}
const stub = (obj) => new Proxy(obj, { get: (t, k) => k === 'fetch' ? (req) => t.fetch(req) : typeof t[k] === 'function' ? async (...a) => structuredClone(await t[k](...structuredClone(a))) : t[k] });
function makeEnv(extra = {}) {
  const meters = new Map(), rooms = new Map();
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ADMIN_KEY: 'admin-test-key-123', ASSETS: { fetch: () => new Response('asset', { status: 200 }) }, ...extra };
  env.calls = { meter: 0 };
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new Meter(makeCtx(sql), env) }); } return meters.get(name); };
  env.room = (topic) => { if (!rooms.has(topic)) { const sql = sqliteStorage(); rooms.set(topic, { sql, do: new Room(makeCtx(sql), env) }); } return rooms.get(topic); };
  env.METER = { idFromName: (name) => name, get: (name) => { if (name === 'team') env.calls.meter++; return stub(env.meter(name).do); } };
  env.ROOM = { idFromName: (topic) => topic, get: (topic) => stub(env.room(topic).do) };
  return env;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
// Supabase: board rows the test sets (state.boards), the account's creation time (state.created[sub]) for /auth/v1/user, RPC answers.
function fakeNet(state) {
  return async (url, opt = {}) => {
    const u = String(url); state.calls.push(u);
    if (u.includes('/.well-known/jwks.json')) return json({ keys: state.jwks || [] });
    if (u.includes('/auth/v1/user')) { const tok = String(opt.headers?.authorization || '').slice(7), sub = state.subOf?.get(tok); state.ages = (state.ages || 0) + 1; return sub && state.created[sub] ? json({ id: sub, created_at: new Date(state.created[sub]).toISOString() }) : json({ msg: 'no' }, 401); }
    if (u.includes('/rest/v1/billboards')) { const m = /slot_id=eq\.([A-Z_0-9]+)/.exec(u); if (m) return json(state.boards[m[1]] ? [state.boards[m[1]]] : []); return json(Object.values(state.boards)); }
    if (u.includes('/rest/v1/plots')) { const m = /plot_id=eq\.(\d+)/.exec(u); if (m) return json(state.plots[m[1]] ? [state.plots[m[1]]] : []); return json([]); }
    if (u.includes('/rest/v1/') && !u.includes('/rpc/')) return json([]);
    if (u.includes('/rpc/claim_billboard')) { const b = JSON.parse(opt.body); state.claims.push(b); return json({ ok: true, billboard: { slot_id: b.p_slot_id, holder_id: b.p_actor_id, holder_name: b.p_nickname, current_bid: b.p_bid, lit_until: new Date(Date.now() + 72 * 3600e3).toISOString(), line1: b.p_line1 }, remaining_coins: 1 }); }
    if (u.includes('/rpc/buy_or_upgrade_plot')) { const b = JSON.parse(opt.body); state.plotBuys.push(b); return json({ ok: true, plot: { plot_id: b.p_plot_id, owner_id: b.p_actor_id, level: 1, price: 200 }, remaining_coins: 1 }); }
    if (u.includes('/rpc/relight_billboard')) { state.relights = (state.relights || 0) + 1; return json({ ok: true, lit_until: new Date(Date.now() + 72 * 3600e3).toISOString(), lit_days: 1, scored: true }); }
    if (u.includes('/rpc/spend_plaza')) { state.spends = (state.spends || 0) + 1; return json({ ok: true, remaining_coins: 1 }); }
    if (u.includes('/rpc/my_tribe')) return json(state.tribe || { ok: true, tribe_id: null });
    if (u.includes('/rpc/')) return json({ ok: true });
    return new Response('missing', { status: 404 });
  };
}
function harness(env) {
  const waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (p, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + p, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const guest = async (ip = '1.1.1.1') => { const t = (await (await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: '{}' })).json()).token; return { token: t, id: 'guest:' + JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).s }; };
  const post = (p, body, token, ip = '1.1.1.1') => call(p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const get = (p, token, ip = '1.1.1.1') => call(p, { headers: { 'cf-connecting-ip': ip, ...(token ? { authorization: 'Bearer ' + token } : {}) } });
  const admin = (p, body) => call(p, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': env.ADMIN_KEY }, body: JSON.stringify(body) } : { headers: { 'x-admin-key': env.ADMIN_KEY } });
  const team = (body, token, ip) => post('/rt/team', body, token, ip).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  return { call, guest, post, get, admin, team };
}
// Day 2027-03-10 12:00 KST, a new month every setup so the isolate caches of one test never serve another.
let clockBase = Date.parse('2027-03-10T03:00:00Z');
let pair = null;
async function setup() {
  clockBase += 40 * 864e5; let t = clockBase; const orig = Date.now; Date.now = () => t;
  const prevFetch = globalThis.fetch, state = { calls: [], boards: {}, plots: {}, claims: [], plotBuys: [], created: {}, subOf: new Map() };
  if (!pair) pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  state.jwks = [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'team-kid' }];
  globalThis.fetch = fakeNet(state); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  teamDrop('', '', true);
  return { clock: { add: (ms) => { t += ms; }, set: (ms) => { t = ms; }, now: () => t }, state, done: () => { globalThis.fetch = prevFetch; Date.now = orig; } };
}
// A linked account created `ageDays` before now.
async function user(state, clock, sub, ageDays = 10, extra = {}) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), head = enc({ alg: 'ES256', kid: 'team-kid' });
  const claims = enc({ sub, exp: Math.floor(clock.now() / 1000) + 30 * 86400, iss: 'https://yxddhpacuyaffaoutxjn.supabase.co/auth/v1', aud: 'authenticated', ...extra });
  const token = head + '.' + claims + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(head + '.' + claims))).toString('base64url');
  state.created[sub] = clock.now() - ageDays * 864e5; state.subOf.set(token, sub);
  return { token, id: 'user:' + sub };
}
const db = (env) => env.meter('team').sql.db;
const ipOf = (i) => '10.0.' + Math.floor(i / 250) + '.' + (i % 250 + 1);

describe('응원 팀 on the Worker', { concurrency: false }, () => {
  it('a linked account makes a team; a guest may join but not make one; names are unique; one team at a time', async () => {
    const { clock, state, done } = await setup();
    try {
      const env = makeEnv(), H = harness(env), A = await user(state, clock, 'a1'), G = await H.guest('2.2.2.2');
      const made = await H.team({ op: 'create', name: '  우리  아이돌 ♡ ' }, A.token);
      assert.equal(made.status, 200, JSON.stringify(made)); assert.equal(made.team.name, '우리 아이돌 ♡'); assert.equal(made.role, 'owner'); assert.match(made.team.id, /^[a-z0-9]{8}$/);
      assert.equal(JSON.stringify(made).includes(A.id), false, 'no account id in the answer');
      const g = await H.team({ op: 'create', name: '손님팀' }, G.token, '2.2.2.2'); assert.equal(g.code, 'link');
      const B = await user(state, clock, 'b1');
      assert.equal((await H.team({ op: 'create', name: '우리아이돌♡' }, B.token)).code, 'name_taken', 'spaces and marks do not make a new name');
      assert.equal((await H.team({ op: 'create', name: 'https://x.com' }, B.token)).code, 'name_chars');
      assert.equal((await H.team({ op: 'create', name: 'WISH BOARD 공식' }, B.token)).code, 'name_blocked');
      const j = await H.team({ op: 'join', id: made.team.id }, G.token, '2.2.2.2'); assert.equal(j.status, 200); assert.equal(j.role, 'member'); assert.equal(j.team.members, 2);
      const B2 = await H.team({ op: 'create', name: '다른 팀' }, B.token); assert.equal(B2.status, 200);
      assert.equal((await H.team({ op: 'join', id: B2.team.id }, G.token, '2.2.2.2')).code, 'member', 'one team at a time');
      // Leaving: the next join waits 24 h (no hopping to push whichever team is near a goal).
      const left = await H.team({ op: 'leave' }, G.token, '2.2.2.2'); assert.equal(left.status, 200);
      assert.equal((await H.team({ op: 'join', id: B2.team.id }, G.token, '2.2.2.2')).code, 'hop');
      clock.add(PRIME.hopMs + 1000);
      assert.equal((await H.team({ op: 'join', id: B2.team.id }, G.token, '2.2.2.2')).status, 200);
      // The owner leaving passes the team to its next member.
      await H.team({ op: 'join', id: made.team.id }, (await user(state, clock, 'c1')).token);
      assert.equal((await H.team({ op: 'leave' }, A.token)).status, 200);
      assert.equal(db(env).prepare('select owner from tm where id = ?').get(made.team.id).owner, 'user:c1');
    } finally { done(); }
  });

  it('counts a distinct supporter once a KST day: linked, 3 days old, one per network per team; guests and young accounts are recorded, not counted', async () => {
    const { clock, state, done } = await setup();
    try {
      const env = makeEnv(), H = harness(env), O = await user(state, clock, 'own');
      const tid = (await H.team({ op: 'create', name: '카운트 팀' }, O.token)).team.id;
      const ok = await H.team({ op: 'cheer' }, O.token, '3.3.3.3');
      assert.equal(ok.status, 200); assert.equal(ok.why, 'ok'); assert.equal(ok.counted, true); assert.equal(ok.n, 1);
      assert.equal(state.ages, 1, 'the account age is read once from Supabase Auth');
      const again = await H.team({ op: 'cheer' }, O.token, '3.3.3.3'); assert.equal(again.why, 'done'); assert.equal(again.n, 1);
      // A young account (1 day): recorded with its reason, not counted; the line says when it will count.
      const Y = await user(state, clock, 'young', 1); await H.team({ op: 'join', id: tid }, Y.token, '4.4.4.4');
      const y = await H.team({ op: 'cheer' }, Y.token, '4.4.4.4'); assert.equal(y.why, 'young'); assert.equal(y.counted, false); assert.equal(y.n, 1); assert.match(y.line, /3일/);
      // A guest: recorded, never counted.
      const G = await H.guest('5.5.5.5'); await H.team({ op: 'join', id: tid }, G.token, '5.5.5.5');
      const g = await H.team({ op: 'cheer' }, G.token, '5.5.5.5'); assert.equal(g.why, 'guest'); assert.equal(g.counted, false);
      // An anonymous login is a guest too.
      const N = await user(state, clock, 'anon1', 30, { is_anonymous: true }); await H.team({ op: 'join', id: tid }, N.token, '6.6.6.6');
      assert.equal((await H.team({ op: 'cheer' }, N.token, '6.6.6.6')).why, 'guest');
      // Same network (an IPv6 /64), second account of the same team: not counted. Another /64: counted.
      const P = await user(state, clock, 'p1'), Q = await user(state, clock, 'q1'), R = await user(state, clock, 'r1');
      for (const x of [P, Q, R]) await H.team({ op: 'join', id: tid }, x.token, '7.7.7.7');
      assert.equal((await H.team({ op: 'cheer' }, P.token, '2001:db8:1:2::10')).why, 'ok');
      assert.equal((await H.team({ op: 'cheer' }, Q.token, '2001:db8:1:2:ffff::99')).why, 'net');
      const r = await H.team({ op: 'cheer' }, R.token, '2001:db8:1:3::10'); assert.equal(r.why, 'ok'); assert.equal(r.n, 3);
      const row = db(env).prepare("select net from tsd where uid = 'user:p1'").get(); assert.equal(row.net.length, 16); assert.equal(row.net.includes('2001'), false, 'a network hash, not the address');
      // Points never count: nothing here spent or read a wallet.
      assert.equal(state.calls.some((u) => /wallets|spend_plaza|claim_billboard/.test(u)), false);
      // A cheer needs a team.
      const lone = await user(state, clock, 'lone'); assert.equal((await H.team({ op: 'cheer' }, lone.token, '8.8.8.8')).code, 'none');
      // The KST day boundary: 23:59:59 counts for today, 00:00:00 starts a new day (one more support each).
      const d0 = kstDay(clock.now());
      clock.set(dayStart(addDays(d0, 1)) - 1000);
      assert.equal((await H.team({ op: 'cheer' }, O.token, '3.3.3.3')).why, 'done', 'still the same KST day');
      clock.set(dayStart(addDays(d0, 1)));
      const next = await H.team({ op: 'cheer' }, O.token, '3.3.3.3'); assert.equal(next.why, 'ok'); assert.equal(next.n, 1, 'a new day starts from 0');
      const days = db(env).prepare('select d, n from tdc where tid = ? order by d').all(tid);
      assert.deepEqual(days.map((x) => [x.d, x.n]), [[d0, 3], [addDays(d0, 1), 1]]);
    } finally { done(); }
  });

  it('freezes the next day\'s plan from yesterday: goals, participation and an approved anniversary; the 9 pm team after 21:00', async () => {
    const { clock, state, done } = await setup();
    try {
      const env = makeEnv(), H = harness(env);
      // Day -1: team A has 40 supporters. Day 0: 32 of them come back (A: 32 of 40 active, 80%, the small goal); team B's 11 all support
      // (11 of 11, 100%: the hottest, though it reached no goal); team C has 2 (nothing).
      const mk = async (name, sub) => { const o = await user(state, clock, sub); const r = await H.team({ op: 'create', name }, o.token, ipOf(900 + name.length)); return { id: r.team.id, owner: o }; };
      const A = await mk('알파 팀', 'oa'), B = await mk('베타팀', 'ob'), C = await mk('감마', 'oc');
      let i = 0; const people = new Map();
      const crowd = async (tid, n, from = 0) => { for (let k = from; k < from + n; k++) { const key = tid + k; let x = people.get(key); const ip = ipOf(k + (tid === A.id ? 0 : tid === B.id ? 100 : 200));
        if (!x) { x = await user(state, clock, 'u' + (i++)); people.set(key, x); await H.team({ op: 'join', id: tid }, x.token, ip); }
        await H.team({ op: 'cheer' }, x.token, ip); } };
      const dm1 = kstDay(clock.now()); clock.set(dayStart(dm1) + 15 * 3600e3);
      await crowd(A.id, 40);
      clock.set(dayStart(addDays(dm1, 1)) + 15 * 3600e3);
      await crowd(A.id, 32);
      await crowd(B.id, 11);
      await H.team({ op: 'cheer' }, C.owner.token, ipOf(990)); await crowd(C.id, 1);
      // Anniversary: C asks for tomorrow's month-day, the operator approves.
      const d0 = kstDay(clock.now()), d1 = addDays(d0, 1);
      assert.equal(d0, addDays(dm1, 1));
      assert.equal((await H.team({ op: 'anniv', md: d1.slice(5), label: '데뷔 기념일' }, C.owner.token, ipOf(990))).status, 200);
      const stats = await (await H.admin('/rt/admin/teams')).json();
      assert.equal(stats.wait.length, 1); assert.equal(stats.wait[0].label, '데뷔 기념일');
      assert.equal((await (await H.admin('/rt/admin/team', { op: 'ann', id: C.id, ok: true })).json()).st, 'ok');
      // The next day: the plan is made once from day 0 and never changes after.
      clock.set(dayStart(d1) + 10 * 3600e3);
      const p1 = await (await H.get('/rt/prime')).json();
      assert.equal(p1.ok, true); const plan = p1.prime;
      assert.equal(plan.day, d1);
      assert.deepEqual(plan.small.flat(), [A.id], '32 people: a small corner screen');
      assert.equal(plan.hot.id, B.id, 'B: 11 of its 11 active supporters (100%)');
      assert.equal(plan.big.flat().length, 0);
      assert.equal(plan.ann[0].id, C.id); assert.equal(plan.ann[0].label, '데뷔 기념일'); assert.equal(plan.ann[0].hours.length, 23);
      assert.equal(plan.gold, undefined, 'not named before 21:00');
      assert.equal(primeAt(plan, 'SUB_1B', clock.now()).id, A.id);
      assert.equal(primeAt(plan, 'SUB_1A', clock.now()).why, 'hot');
      assert.equal(primeAt(plan, 'MAIN_TOP', dayStart(d1) + 12 * 3600e3 + 30e3).why, 'ann', 'the anniversary owns the first minute of the hour');
      assert.equal(primeAt(plan, 'MAIN_TOP', dayStart(d1) + 12 * 3600e3 + 90e3), null);
      // Achievements were written for day 0 (A small, B hot) and day 1 (C anniversary); the team page shows them.
      const pageA = (await (await H.get('/rt/team?id=' + A.id)).json()).team;
      assert.deepEqual(pageA.past.map((x) => [x.d, x.kind, x.n]), [[d0, 'small', 32], [dm1, 'hot', 100], [dm1, 'small', 40]], 'day -1: 40 of 40; day 0: 32');
      assert.equal(pageA.slots[0].why, 'small'); assert.equal(pageA.yesterday.n, 32);
      // Day 1: A gets 12 supporters before 21:00, B gets 11 after it. At 21:00 the 9 pm team is A (it led before 21:00).
      clock.set(dayStart(d1) + 20 * 3600e3);
      for (let k = 0; k < 12; k++) { const x = await user(state, clock, 'v' + k); await H.team({ op: 'join', id: A.id }, x.token, ipOf(500 + k)); await H.team({ op: 'cheer' }, x.token, ipOf(500 + k)); }
      clock.set(dayStart(d1) + 21 * 3600e3 + 5000);
      for (let k = 0; k < 15; k++) { const x = await user(state, clock, 'w' + k); await H.team({ op: 'join', id: B.id }, x.token, ipOf(600 + k)); await H.team({ op: 'cheer' }, x.token, ipOf(600 + k)); }
      teamDrop('', '', true);
      const p2 = (await (await H.get('/rt/prime')).json()).prime;
      assert.equal(p2.gold.id, A.id, 'counted before 21:00 only'); assert.equal(p2.gold.n, 12);
      assert.equal(primeAt(p2, 'MAIN_MID', clock.now()).why, 'gold');
      // It stays decided (later supporters do not move it).
      clock.add(3600e3); teamDrop('', '', true);
      assert.equal((await (await H.get('/rt/prime')).json()).prime.gold.id, A.id);
      // The world carries the plan, today's leading teams and the roof (the 9 pm team).
      const w = await (await H.get('/rt/world')).json();
      assert.equal(w.prime.day, d1); assert.equal(w.teams[0].id, B.id); assert.equal(w.roof, '알파 팀');
      assert.equal('league' in w, false, 'no spend league in the world any more');
    } finally { done(); }
  });

  it('rankings: today by distinct supporters, participation only for teams with 10+ active supporters; search by name', async () => {
    const { clock, state, done } = await setup();
    try {
      const env = makeEnv(), H = harness(env);
      const owners = [];
      for (const [k, name] of ['큰팀', '작은팀'].entries()) { const o = await user(state, clock, 'r' + k); owners.push({ o, id: (await H.team({ op: 'create', name }, o.token, ipOf(800 + k))).team.id }); }
      let i = 0; for (let k = 0; k < 12; k++) { const x = await user(state, clock, 's' + (i++)); await H.team({ op: 'join', id: owners[0].id }, x.token, ipOf(i)); await H.team({ op: 'cheer' }, x.token, ipOf(i)); }
      await H.team({ op: 'cheer' }, owners[1].o.token, ipOf(801));
      const r = await (await H.get('/rt/teams')).json();
      assert.deepEqual(r.today.map((x) => [x.name, x.n]), [['큰팀', 12], ['작은팀', 1]]);
      assert.deepEqual(r.rate.map((x) => x.name), ['큰팀'], '1 of 1 never ranks');
      assert.equal(JSON.stringify(r).includes('user:'), false);
      const f = await (await H.get('/rt/teams?q=' + encodeURIComponent('작은'))).json();
      assert.deepEqual(f.found.map((x) => x.name), ['작은팀']);
      // The share page names the team and today's count for link previews, then sends people to the plaza with the team open.
      const html = await (await H.get('/t/' + owners[0].id)).text();
      assert.match(html, /큰팀 응원 팀/); assert.match(html, /서로 다른 12명/); assert.match(html, new RegExp('/\\?team=' + owners[0].id));
    } finally { done(); }
  });

  it('at the hard budget level: writes answer busy without a team DO call; reads use the copy', async () => {
    const { clock, state, done } = await setup();
    try {
      const env = makeEnv(), H = harness(env), O = await user(state, clock, 'hard1');
      const tid = (await H.team({ op: 'create', name: '붐빔' }, O.token)).team.id;
      await H.get('/rt/team?id=' + tid);
      // A day budget of 1 DO request: every level read from here on is hard.
      env.BUDGET_REQ_DAY = '1'; clock.add(61000);
      const before = env.calls.meter;
      const c = await H.team({ op: 'cheer' }, O.token); assert.equal(c.status, 503); assert.equal(c.code, 'busy');
      const page = await (await H.get('/rt/team?id=' + tid)).json(); assert.equal(page.ok, true); assert.equal(page.busy, true);
      assert.equal(env.calls.meter, before, 'no team DO call at hard');
    } finally { done(); }
  });

  it('account link moves the membership and supports; withdrawal forgets them and passes an owned team on', async () => {
    const { clock, state, done } = await setup();
    try {
      const env = makeEnv(), H = harness(env), O = await user(state, clock, 'boss');
      const tid = (await H.team({ op: 'create', name: '이동팀' }, O.token)).team.id;
      const G = await H.guest('9.9.9.9'); await H.team({ op: 'join', id: tid }, G.token, '9.9.9.9'); await H.team({ op: 'cheer' }, G.token, '9.9.9.9');
      const q = env.meter('team').sql;
      teamDb.move(q, G.id, 'user:linked');
      assert.equal(db(env).prepare('select tid from tmm where uid = ?').get('user:linked').tid, tid);
      assert.equal(db(env).prepare('select count(*) n from tsd where uid = ?').get(G.id).n, 0);
      teamDb.forget(q, 'user:boss');
      assert.equal(db(env).prepare('select owner from tm where id = ?').get(tid).owner, 'user:linked');
      assert.equal(db(env).prepare("select count(*) n from tsd where uid = 'user:boss'").get().n, 0);
    } finally { done(); }
  });

  it('old pages: /rt/tribe answers moved, /rt/league an empty week, both without a DO call', async () => {
    const { clock, state, done } = await setup();
    try {
      const env = makeEnv(), H = harness(env), O = await user(state, clock, 'old');
      const t = await H.post('/rt/tribe', { look: true }, O.token); assert.equal(t.status, 410); assert.equal((await t.json()).code, 'moved');
      const l = await (await H.get('/rt/league', O.token)).json(); assert.deepEqual(l.top, []); assert.equal(l.off, true);
      assert.equal(env.calls.meter, 0);
    } finally { done(); }
  });

  it('brings an old 소속 over once, with the same id and name', async () => {
    const { clock, state, done } = await setup();
    try {
      const env = makeEnv(), H = harness(env), O = await user(state, clock, 'tribal');
      state.tribe = { ok: true, tribe_id: 'abcd1234', tag: '우리동네', role: 'owner' };
      const me = await (await H.get('/rt/team/me', O.token)).json();
      assert.equal(me.team.id, 'abcd1234'); assert.equal(me.team.name, '우리동네'); assert.equal(me.role, 'owner');
      const n = state.calls.filter((u) => u.includes('my_tribe')).length;
      await H.team({ op: 'leave' }, O.token); teamDrop('', O.id);
      await (await H.get('/rt/team/me', O.token)).json();
      assert.equal(state.calls.filter((u) => u.includes('my_tribe')).length, n, 'looked at once');
    } finally { done(); }
  });

  // The plaza's entry (main.js askTeamToday) peeks: it must not move an account into its old 소속 just by entering (test/review2-hud.test.mjs 5).
  it('?peek=1 answers from the team store: no my_tribe read, no team made, no membership; the sheet\'s read right after still brings it over', async () => {
    const { clock, state, done } = await setup();
    try {
      const env = makeEnv(), H = harness(env), O = await user(state, clock, 'peeker');
      state.tribe = { ok: true, tribe_id: 'beef1234', tag: '옛소속', role: 'owner' };
      const peek = await (await H.get('/rt/team/me?peek=1', O.token)).json();
      assert.equal(peek.ok, true); assert.equal(peek.team, null, 'no team: the to-do row reads 응원 팀 고르기');
      assert.equal(state.calls.filter((u) => u.includes('my_tribe')).length, 0, 'Supabase was not asked');
      assert.equal(db(env).prepare('select count(*) n from tm').get().n, 0, 'no team row');
      assert.equal(db(env).prepare('select count(*) n from tmm').get().n, 0, 'no membership');
      assert.equal(db(env).prepare('select count(*) n from tri').get().n, 0, 'not marked looked');
      const again = await (await H.get('/rt/team/me?peek=1', O.token)).json();
      assert.equal(again.team, null);
      const me = await (await H.get('/rt/team/me', O.token)).json();
      assert.equal(me.team.id, 'beef1234', 'the sheet behaves as before (the peek was not kept in the isolate cache)');
      const after = await (await H.get('/rt/team/me?peek=1', O.token)).json();
      assert.equal(after.team.id, 'beef1234', 'a peek after that sees the team');
      assert.deepEqual(Object.keys(peek).sort(), Object.keys(await (await H.get('/rt/team/me?peek=1', (await user(state, clock, 'other')).token)).json()).sort(), 'the same shape');
    } finally { done(); }
  });
});

describe('no takeovers on the claim path', { concurrency: false }, () => {
  const body = (o) => ({ topic: 'chapel:square', line1: '안녕', line2: '', line3: '', ...o });
  it('a prime screen is never lit with points, whatever the page sends; the 소속 claim and the 60 s cover are closed before the room', async () => {
    const { clock, state, done } = await setup();
    try {
      const env = makeEnv(), H = harness(env), A = await user(state, clock, 'claimer');
      for (const slot of ['MAIN_TOP', 'MAIN_LOW', 'SUB_1A', 'SUB_4B']) {
        const r = await H.post('/rt/claim-billboard', body({ slot_id: slot, bid: 999999 }), A.token);
        const j = await r.json(); assert.equal(r.status, 400); assert.equal(j.code, 'prime', slot);
      }
      const t = await H.post('/rt/claim-billboard', body({ slot_id: 'STREET_5', bid: 300, mode: 'tribe' }), A.token); assert.equal(t.status, 410);
      const air = await H.post('/rt/spend', { topic: 'chapel:square', kind: 'air', line: '모두 보세요' }, A.token); assert.equal(air.status, 410); assert.equal((await air.json()).code, 'off');
      assert.equal(state.claims.length, 0); assert.equal(state.spends || 0, 0);
    } finally { done(); }
  });
  it('a board someone else has lit cannot be taken at any price; a free or run-out board costs its fixed price', async () => {
    const { clock, state, done } = await setup();
    try {
      const env = makeEnv(), H = harness(env), A = await user(state, clock, 'aa'), B = await user(state, clock, 'bb');
      const later = new Date(clock.now() + 3600e3).toISOString(), earlier = new Date(clock.now() - 3600e3).toISOString();
      state.boards.STREET_5 = { slot_id: 'STREET_5', holder_id: B.id, holder_name: 'B', current_bid: 241, lit_until: later };
      const r = await H.post('/rt/claim-billboard', body({ slot_id: 'STREET_5', bid: 100000 }), A.token);
      assert.equal(r.status, 409); assert.equal((await r.json()).code, 'held');
      assert.equal(state.claims.length, 0, 'the database was never asked');
      // My own lit board: claim again is refused (edit or relight instead); an edit keeps the bid (no raise).
      const m = await H.post('/rt/claim-billboard', body({ slot_id: 'STREET_5', bid: 500 }), B.token); assert.equal((await m.json()).code, 'mine');
      const e = await H.post('/rt/claim-billboard', body({ slot_id: 'STREET_5', bid: 9000, mode: 'edit' }), B.token); assert.equal(e.status, 200);
      assert.equal(state.claims.at(-1).p_bid, 241, 'an edit keeps the bid it had'); assert.equal(state.claims.at(-1).p_mode, 'edit');
      // Run out: anyone may light it, at the floor price only.
      state.boards.STREET_5.lit_until = earlier;
      const ok = await H.post('/rt/claim-billboard', body({ slot_id: 'STREET_5', bid: 100000 }), A.token); assert.equal(ok.status, 200);
      assert.equal(state.claims.at(-1).p_bid, 228, 'the floor price of STREET_5, not the 100000 sent');
    } finally { done(); }
  });
  it('a plot in use is not taken; a run-out one may be; relight refuses a prime screen', async () => {
    const { clock, state, done } = await setup();
    try {
      const env = makeEnv(), H = harness(env), A = await user(state, clock, 'pa');
      state.plots['3'] = { plot_id: 3, owner_id: 'user:other', level: 2, updated_at: new Date(clock.now() - 10 * 864e5).toISOString() };
      const r = await H.post('/rt/buy-plot', { topic: 'chapel:square', plot_id: 3, sign_text: '내 가게' }, A.token);
      assert.equal(r.status, 409); assert.equal(state.plotBuys.length, 0);
      state.plots['3'].updated_at = new Date(clock.now() - 31 * 864e5).toISOString();
      assert.equal((await H.post('/rt/buy-plot', { topic: 'chapel:square', plot_id: 3, sign_text: '내 가게' }, A.token)).status, 200);
      const l = await H.post('/rt/relight', { slot_id: 'MAIN_TOP' }, A.token); assert.equal(l.status, 400); assert.equal((await l.json()).code, 'prime');
      assert.equal(state.relights || 0, 0);
    } finally { done(); }
  });
  it('a claim that loses a race (someone lit the board a moment earlier) is refused by the database\'s protection and reads as held; an unreadable board waits', async () => {
    const { clock, state, done } = await setup();
    try {
      const env = makeEnv(), H = harness(env), A = await user(state, clock, 'racer');
      const net = globalThis.fetch;
      globalThis.fetch = async (u, o) => (String(u).includes('/rpc/claim_billboard') ? json({ ok: false, error: '현재 광고의 최소 보장 시간이 남아있습니다.' }) : net(u, o));
      const r = await H.post('/rt/claim-billboard', body({ slot_id: 'STREET_6', bid: 300 }), A.token), j = await r.json();
      assert.equal(r.status, 400); assert.match(j.error, /다른 사람이 걸어 두었어요/);
      globalThis.fetch = async (u, o) => (String(u).includes('/rest/v1/billboards') ? new Response('down', { status: 500 }) : net(u, o));
      const w = await H.post('/rt/claim-billboard', body({ slot_id: 'STREET_6', bid: 300 }), A.token);
      assert.equal(w.status, 503); assert.equal((await w.json()).code, 'busy');
      globalThis.fetch = net;
    } finally { done(); }
  });
  it('the only Supabase Auth read is GET /auth/v1/user with the caller\'s own token and the publishable key', () => {
    const src = readFileSync(new URL('../teamsrv.js', import.meta.url), 'utf8');
    const calls = src.match(/fetch\([^;]*auth\/v1[^;]*;/g) || [];
    assert.equal(calls.length, 1); assert.doesNotMatch(calls[0], /method|service_role|admin/i);
    assert.match(calls[0], /authorization: 'Bearer ' \+ t/);
    assert.equal(/service_role|auth\/v1\/admin/.test(readFileSync(new URL('../worker.js', import.meta.url), 'utf8')), false);
  });
});
