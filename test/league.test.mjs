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
// A second module instance is a second isolate: its own memory (caches, settlement memo), the same Durable Objects.
const worker2 = (await import('../worker.js?isolate=2')).default;
const { LEAGUE, BOT_NICK, botNick, leagueWeek, weekEnds, leagueCut, leagueBoard, leagueLine } = await import('../league.js');
const { wishNickFault } = await import('../wish.js');

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
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ADMIN_KEY: 'admin-test-key-123', ASSETS: { fetch: () => new Response('asset', { status: 200 }) }, ...extra };
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new Meter(makeCtx(sql), env) }); } return meters.get(name); };
  env.room = (topic) => { if (!rooms.has(topic)) { const sql = sqliteStorage(); rooms.set(topic, { sql, do: new Room(makeCtx(sql), env) }); } return rooms.get(topic); };
  env.METER = { idFromName: (name) => name, get: (name) => stub(env.meter(name).do) };
  env.ROOM = { idFromName: (topic) => topic, get: (topic) => stub(env.room(topic).do) };
  return env;
}
function openSock(room, id) {
  const ws = { sent: [], send(s) { this.sent.push(String(s)); }, close() {}, serializeAttachment() {}, deserializeAttachment() { return null; } };
  room.socks().set(ws, { k: id, q: true, v2: true, fl: 0, lob: false, t: Date.now(), ls: Date.now(), m: { x: 0, y: 0, fl: 0 } });
  return ws;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
// Fake Supabase. claim_billboard keeps one holder per slot and hands the previous holder 80% of the old bid, like the SQL.
function fakeSupa(state) {
  state.boards ||= new Map(); state.ranks ||= []; state.fail ||= new Set();
  return async (url, opt) => {
    const u = String(url), a = opt?.body ? JSON.parse(opt.body) : {}; state.calls.push({ url: u, body: a });
    const rpc = (/\/rpc\/(\w+)/.exec(u) || [])[1] || '';
    if (state.fail.has(rpc)) return json({ message: 'upstream' }, 500);
    if (state.missing?.has(rpc)) return json({ code: 'PGRST202', message: 'Could not find the function public.' + rpc + ' in the schema cache' }, 404);
    if (u.includes('/rest/v1/billboards') && u.includes('select=current_bid')) { const slot = decodeURIComponent(u.split('slot_id=eq.')[1] || ''); return json([{ current_bid: state.boards.get(slot)?.bid ?? 0 }]); }
    // One board (the claim's no-takeover read) or all of them; a held board is lit for a day (a claim lights it).
    if (u.includes('/rest/v1/billboards')) { const one = /slot_id=eq\.(\w+)/.exec(u)?.[1]; return json([...state.boards.entries()].filter(([slot_id]) => !one || slot_id === one).map(([slot_id, b]) => ({ slot_id, holder_id: b.holder, current_bid: b.bid, lit_until: new Date(Date.now() + 864e5).toISOString() }))); }
    if (u.includes('/rest/v1/plots')) return json([]);
    if (u.includes('/rest/v1/wallets')) return json(u.includes('spent=gt.0') ? state.ranks : []);
    if (rpc === 'plaza_live' || rpc === 'coin_batch') return json({ ok: true });
    if (rpc === 'claim_billboard') {
      const cur = state.boards.get(a.p_slot_id), prev = cur?.holder || null, refund = prev && a.p_mode !== 'edit' ? Math.floor(cur.bid * 80 / 100) : 0;
      state.boards.set(a.p_slot_id, { holder: a.p_actor_id, bid: a.p_bid });
      return json({ ok: true, billboard: { slot_id: a.p_slot_id, holder_id: a.p_actor_id, current_bid: a.p_bid, line1: a.p_line1 }, remaining_coins: 0, prev_holder_id: prev, refund });
    }
    if (rpc === 'buy_or_upgrade_plot') return json({ ok: true, plot: { plot_id: a.p_plot_id, level: 1, price: 600 }, remaining_coins: 0 }); // charged 300, the RPC doubles the price
    if (rpc === 'spend_plaza') return json({ ok: true, remaining_coins: 0, vip_tickets: 0 });
    if (rpc === 'set_nickname') return json({ ok: true, nickname: a.p_nickname });
    if (rpc === 'refund_tribe_week') { state.refunds.push(a.p_week); return json({ ok: true, rows: 0 }); }
    if (rpc === 'award_tribe_roof') { // 'new' = the db package's migration (finished weeks, once), 'old' = schema.sql today (Sundays only)
      const now = Date.now();
      if (state.roofSql === 'old') { if (new Date(now + 9 * 36e5).getUTCDay() !== 0) return json({ ok: true, skipped: true }); state.roofs.push(a.p_week); return json({ ok: true, tribe_id: 'abcd1234' }); }
      if (a.p_week >= leagueWeek(now)) return json({ ok: false, error: 'open' });
      if (state.roofs.includes(a.p_week)) return json({ ok: true, done: true });
      state.roofs.push(a.p_week); return json({ ok: true, tribe_id: 'abcd1234' });
    }
    if (rpc === 'my_tribe') return json({ ok: true, tribe_id: null });
    return new Response('missing', { status: 404 });
  };
}
function harness(env, w = worker) {
  const waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (path, opt = {}) => { const res = await w.fetch(new Request('https://sq.example' + path, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const guest = async () => { const t = (await (await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).token; return { token: t, id: 'guest:' + JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).s }; };
  const post = (path, body, token) => call(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const get = (path, token) => call(path, { headers: token ? { authorization: 'Bearer ' + token } : {} });
  const claim = (g, slot, bid, nickname, extra = {}) => post('/rt/claim-billboard', { topic: 'chapel:square', slot_id: slot, bid, line1: '내 칸', nickname, ...extra }, g.token);
  return { call, guest, post, get, claim };
}
// Each test runs in its own KST weeks, so isolate memory (world 15 s, league 60 s, settlement memo) never leaks between tests.
// The base is a Wednesday 12:00 KST; +7 days per test keeps it Wednesday.
let clockBase = Date.parse('2026-11-18T03:00:00Z');
function freshClock() { clockBase += 21 * 864e5; let t = clockBase; const orig = Date.now; Date.now = () => t; return { set: (v) => { t = v; }, add: (ms) => { t += ms; }, now: () => t, restore: () => { Date.now = orig; } }; }
function setup(extra = {}) {
  const clock = freshClock(), orig = globalThis.fetch, state = { calls: [], refunds: [], roofs: [], ...extra };
  globalThis.fetch = fakeSupa(state); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  return { clock, state, done: () => { globalThis.fetch = orig; clock.restore(); } };
}
const hasActor = (s) => /guest:|user:/.test(String(s));
const rpcs = (state, name) => state.calls.filter((c) => c.url.includes('/rpc/' + name));
// Monday 00:00 KST of the week that contains t.
const mondayOf = (t) => weekEnds(t) - 7 * 864e5;

describe('league rules (league.js)', () => {
  it('pins the limits and the bot name shape', () => {
    assert.ok(Object.isFrozen(LEAGUE));
    assert.deepEqual({ ...LEAGUE }, { top: 20, world: 10, keepWeeks: 5 });
    assert.equal(String(BOT_NICK), String(/^네온봇\p{Nd}+$/u));
    for (const n of ['네온봇1', '네온봇12', ' 네온봇 7 ', '네온봇01', '네온봇１', '네온봇٣', '네온봇​1']) assert.equal(botNick(n), true, n);
    for (const n of ['네온봇', '네온봇a', '네온봇1호', 'ㄴ네온봇1', '네온후드', '봇', '', null]) assert.equal(botNick(n), false, String(n));
    assert.equal(wishNickFault('네온봇7'), 'nick');
    assert.equal(wishNickFault('네온후드'), '');
  });
  it('counts KST ISO weeks: Monday 00:00 KST starts one, a 53-week year rolls over', () => {
    assert.equal(leagueWeek(Date.parse('2026-11-15T14:59:59Z')), '2026W46'); // Sunday 23:59:59 KST
    assert.equal(leagueWeek(Date.parse('2026-11-15T15:00:00Z')), '2026W47'); // Monday 00:00 KST
    assert.equal(weekEnds(Date.parse('2026-11-18T03:00:00Z')), Date.parse('2026-11-22T15:00:00Z'));
    assert.equal(weekEnds(Date.parse('2026-11-15T15:00:00Z')), Date.parse('2026-11-22T15:00:00Z'));
    assert.equal(weekEnds(Date.parse('2026-11-22T14:59:59Z')), Date.parse('2026-11-22T15:00:00Z'));
    assert.equal(leagueWeek(Date.parse('2027-01-01T03:00:00Z')), '2026W53');
    assert.equal(leagueWeek(Date.parse('2027-01-03T15:00:00Z')), '2027W01');
    assert.equal(leagueCut(Date.parse('2026-11-18T03:00:00Z')), '2026W42');
  });
  it('ranks by spent, then who got there first; gaps pass the account above; unranked gaps enter the list', () => {
    const rows = [
      { uid: 'guest:a', nick: 'A', spent: 100, at: 5 }, { uid: 'guest:b', nick: 'B', spent: 100, at: 3 }, { uid: 'guest:c', nick: 'C', spent: 50, at: 1 },
      { uid: 'guest:z', nick: 'Z', spent: 0, at: 0 }, { uid: 'guest:bot', nick: '네온봇3', spent: 9000, at: 0 },
    ];
    const all = leagueBoard(rows, 'guest:a');
    assert.deepEqual(all.top, [{ rank: 1, nick: 'B', spent: 100, mine: false }, { rank: 2, nick: 'A', spent: 100, mine: true }, { rank: 3, nick: 'C', spent: 50, mine: false }]);
    assert.deepEqual(all.me, { rank: 2, spent: 100, next: { rank: 1, gap: 1 } }); // a tie: one coin passes B
    assert.deepEqual(leagueBoard(rows, 'guest:b').me, { rank: 1, spent: 100, next: null });
    assert.deepEqual(leagueBoard(rows, 'guest:c').me, { rank: 3, spent: 50, next: { rank: 2, gap: 51 } });
    assert.deepEqual(leagueBoard(rows, 'guest:new').me, { rank: 0, spent: 0, next: { rank: 4, gap: 1 } });
    assert.deepEqual(leagueBoard(rows, 'guest:z').me, { rank: 0, spent: 0, next: { rank: 4, gap: 1 } }); // a refunded row is not ranked
    const two = leagueBoard(rows, 'guest:c', 2);
    assert.equal(two.top.length, 2);
    assert.deepEqual(two.me, { rank: 3, spent: 50, next: { rank: 2, gap: 51 } }); // below the list still has its rank
    assert.deepEqual(leagueBoard(rows, 'guest:new', 2).me, { rank: 0, spent: 0, next: { rank: 2, gap: 101 } });
    assert.equal(leagueBoard(rows).me, null);
    assert.equal(hasActor(JSON.stringify(all.top)), false);
  });
  it('writes my line: rank and gap, first place alone, or the fixed unranked copy', () => {
    assert.equal(leagueLine({ rank: 3, spent: 50, next: { rank: 2, gap: 1251 } }), '이번 주 3위 · 1,251포인트 더 쓰면 2위');
    assert.equal(leagueLine({ rank: 1, spent: 900, next: null }), '이번 주 1위');
    assert.equal(leagueLine({ rank: 0, spent: 0, next: { rank: 4, gap: 1 } }), '이번 주 순위는 0에서 시작했어요 · 포인트를 쓰면 순위에 올라요');
    assert.equal(leagueLine(null), '');
  });
});

describe('weekly tally (Meter lg)', () => {
  it('adds, refunds down to zero, merges a guest into its user, forgets a withdrawn account, prunes old weeks', () => {
    const env = makeEnv(), m = env.meter('lg').do, w = '2026W47', w2 = '2026W48';
    m.lgAdd(w, 'guest:a', '가', 100, 10); m.lgAdd(w, 'guest:a', '', 50, 20);
    assert.deepEqual(m.lgTop(w, 'guest:a').me, { rank: 1, spent: 150, next: null });
    assert.equal(m.lgTop(w).top[0].nick, '가'); // an empty nick keeps the stored one
    m.lgAdd(w, 'guest:a', '', -30, 30);
    assert.equal(m.lgTop(w, 'guest:a').me.spent, 120);
    m.lgAdd(w, 'guest:nobody', '', -30, 30);
    assert.equal(m.lgRows(w).length, 1); // a refund creates nothing
    m.lgAdd(w, 'guest:b', '나', 40, 40); m.lgAdd(w, 'guest:b', '', -500, 50);
    assert.deepEqual(m.lgTop(w, 'guest:b').me, { rank: 0, spent: 0, next: { rank: 2, gap: 1 } }); // never below 0, and 0 is unranked
    // Merge: the guest's rows are summed into the user's; the user's nick stays; the guest's rows go.
    m.lgAdd(w, 'user:u', '유저', 10, 60); m.lgAdd(w, 'guest:g', '손님', 25, 70); m.lgAdd(w2, 'guest:g', '손님', 5, 80);
    m.lgMove('guest:g', 'user:u');
    assert.deepEqual(m.lgTop(w, 'user:u').me, { rank: 2, spent: 35, next: { rank: 1, gap: 86 } });
    assert.equal(m.lgTop(w).top.find((r) => r.spent === 35).nick, '유저');
    assert.deepEqual(m.lgTop(w2, 'user:u').me, { rank: 1, spent: 5, next: null });
    assert.equal(m.lgRows(w).some((r) => r.uid === 'guest:g') || m.lgRows(w2).some((r) => r.uid === 'guest:g'), false);
    m.lgNick(w, 'user:u', '새이름');
    assert.equal(m.lgTop(w).top.find((r) => r.spent === 35).nick, '새이름');
    m.lgForget('user:u');
    assert.equal(m.lgTop(w, 'user:u').me.rank, 0);
    assert.equal(m.lgRows(w2).length, 0);
    // Prune: the first write of a week drops the weeks before the cut.
    m.lgAdd('2026W40', 'guest:old', '옛', 9, 1);
    m.lgAdd('2026W49', 'guest:a', '', 1, 90, '2026W44');
    assert.equal(m.lgRows('2026W40').length, 0);
    assert.equal(m.lgRows(w).length, 1);
    assert.deepEqual(m.lgWorld(w), [{ nick: '가', spent: 120 }]);
  });
  it('claims a once-a-week job for one caller; a failed run frees it, a stale claim expires after 2 minutes', () => {
    const m = makeEnv().meter('lg').do;
    assert.equal(m.lgOnce('refund:2026W47', 1000), 'mine');
    assert.equal(m.lgOnce('refund:2026W47', 2000), 'busy');
    m.lgFree('refund:2026W47');
    assert.equal(m.lgOnce('refund:2026W47', 3000), 'mine');
    assert.equal(m.lgOnce('refund:2026W47', 3000 + 120000), 'mine'); // the first claimer died
    m.lgDone('refund:2026W47', 200000);
    assert.equal(m.lgOnce('refund:2026W47', 300000), 'done');
    m.lgFree('refund:2026W47');
    assert.equal(m.lgOnce('refund:2026W47', 300000), 'done'); // a done marker is never freed
  });
});

// The spend league is retired (2026-11-23, docs/prime-screens.md): 응원 순위 ranks teams by people (teamsrv.js). Nothing a person spends is
// tallied any more; /rt/league answers an empty week with no DO call so a page opened before the change shows an empty list; the 'lg'
// rows left from before still follow an account link and a withdrawal.
describe('the retired spend league', () => {
  it('claims, edits, plots and stickers add nothing; /rt/league is an empty week without a DO call; /rt/world has no league key', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), { guest, post, get, claim } = harness(env), lg = env.meter('lg').do, calls = [];
      for (const k of ['lgAdd', 'lgBoard', 'lgTop', 'lgWorld', 'lgBack', 'lgApprove']) { const f = lg[k].bind(lg); lg[k] = (...a) => { calls.push(k); return f(...a); }; }
      const a = await guest(), b = await guest();
      assert.equal((await claim(a, 'STREET_3', 300, '까마귀')).status, 200);
      clock.add(1000);
      assert.equal((await claim(a, 'STREET_3', 400, '까마귀', { mode: 'edit' })).status, 200);
      assert.equal((await post('/rt/buy-plot', { topic: 'chapel:square', plot_id: 2, nickname: '참새' }, b.token)).status, 200);
      assert.equal((await post('/rt/spend', { topic: 'chapel:square', kind: 'sticker', slot_id: 'STREET_3', glyph: '🔥부럽다!', nickname: '참새' }, b.token)).status, 200);
      assert.equal((await post('/rt/spend', { topic: 'chapel:square', kind: 'air', line: '안녕', pay: 'coins', nickname: '까마귀' }, a.token)).status, 410);
      const lb = await (await get('/rt/league', a.token)).json();
      assert.deepEqual(lb, { ok: true, off: true, week: leagueWeek(clock.now()), ends: weekEnds(clock.now()), top: [], me: null });
      clock.add(61000);
      const world = await (await get('/rt/world')).json();
      assert.equal('league' in world, false);
      assert.deepEqual(calls, []);
      assert.equal((await post('/rt/league', {}, a.token)).status, 405);
      // The edit kept the bid the board had (no raise), whatever the page sent.
      assert.equal(rpcs(state, 'claim_billboard').at(-1).body.p_bid, rpcs(state, 'claim_billboard')[0].body.p_bid);
    } finally { done(); }
  });
  it('merge moves the guest week to the user; withdrawal clears it', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), m = env.meter('lg').do, w = leagueWeek(clock.now());
      m.lgAdd(w, 'guest:g-1', '손님', 70, 1); m.lgAdd(w, 'user:abcdefgh', '', 30, 2);
      m.lgMove('guest:g-1', 'user:abcdefgh');
      assert.deepEqual(m.lgTop(w, 'user:abcdefgh').me, { rank: 1, spent: 100, next: null });
      m.lgForget('user:abcdefgh');
      assert.deepEqual(m.lgTop(w).top, []);
    } finally { done(); }
  });
});

describe('bots out of the ranking', () => {
  it('filters 네온봇N from /rt/world ranks and the ranks a claim pushes, and refuses that name for players', async () => {
    const { clock, state, done } = setup({ ranks: [
      { actor_id: 'guest:b1', nickname: '네온봇1', spent: 9000, linked: false }, { actor_id: 'guest:p', nickname: '힘킴', spent: 800, linked: false },
      { actor_id: 'guest:b2', nickname: '네온봇12', spent: 700, linked: false }, { actor_id: 'guest:q', nickname: '네온봇 팬', spent: 600, linked: false },
    ] });
    try {
      const env = makeEnv(), { guest, get, post, claim } = harness(env);
      const world = await (await get('/rt/world')).json();
      assert.deepEqual(world.ranks.map((r) => r.nickname), ['힘킴', '네온봇 팬']);
      assert.ok(state.calls.some((c) => c.url.includes('spent=gt.0') && c.url.includes('limit=60')));
      const g = await guest();
      const room = env.room('chapel:square').do; const sf = await room.sit(g.id, 'chapel:square'); const ws = openSock(room, g.id); room.socks().get(ws).sf = sf;
      assert.equal((await claim(g, 'STREET_20', 300, '참새')).status, 200);
      const update = ws.sent.map((s) => JSON.parse(s)).find((x) => x.t === 'WORLD_UPDATE');
      assert.deepEqual(update.ranks.map((r) => r.nickname), ['힘킴', '네온봇 팬']);
      const before = rpcs(state, 'claim_billboard').length;
      for (const nickname of ['네온봇5', '네온봇 77', '네온봇１']) {
        const r = await claim(g, 'STREET_21', 300, nickname);
        assert.equal(r.status, 400); assert.equal((await r.json()).error, '그 이름은 쓸 수 없어요. 프로필에서 이름을 바꿔 주세요.');
      }
      assert.equal((await post('/rt/buy-plot', { topic: 'chapel:square', plot_id: 4, nickname: '네온봇5' }, g.token)).status, 400);
      assert.equal(rpcs(state, 'claim_billboard').length, before);
      assert.equal(rpcs(state, 'buy_or_upgrade_plot').length, 0);
      assert.equal(rpcs(state, 'spend_plaza').length, 0);
      const named = await post('/rt/profile', { nickname: '네온봇2' }, g.token);
      assert.equal(named.status, 400); assert.equal((await named.json()).error, '그 이름은 쓸 수 없어요');
      assert.equal(rpcs(state, 'set_nickname').length, 0);
      assert.equal((await post('/rt/profile', { nickname: '참새' }, g.token)).status, 200);
      const wish = await post('/rt/wish', { text: '소원', nick: '네온봇9' }, g.token);
      assert.equal(wish.status, 400); assert.equal((await wish.json()).code, 'nick');
      clock.add(1000);
    } finally { done(); }
  });
  // The wish rule (wish.js STAFF, spaces ignored) for plaza nicknames: the profile save, a claim, a plot. An ordinary name still passes.
  it('refuses staff-like plaza nicknames (운영자, 공 식, Official팀) on the profile, claim and plot paths', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), { guest, post, claim } = harness(env);
      const g = await guest();
      for (const nickname of ['운영자', '공 식', 'Official팀']) {
        const named = await post('/rt/profile', { nickname }, g.token);
        assert.equal(named.status, 400, nickname); assert.equal((await named.json()).error, '그 이름은 쓸 수 없어요');
        const reads = state.calls.filter((c) => c.url.includes('/rest/v1/billboards')).length;
        const r = await claim(g, 'STREET_21', 300, nickname);
        assert.equal(r.status, 400, nickname); assert.equal((await r.json()).error, '그 이름은 쓸 수 없어요. 프로필에서 이름을 바꿔 주세요.');
        assert.equal((await claim(g, 'STREET_22', 0, nickname, { mode: 'starter' })).status, 400, nickname);
        assert.equal(state.calls.filter((c) => c.url.includes('/rest/v1/billboards')).length, reads, 'refused before any board read');
        assert.equal((await post('/rt/buy-plot', { topic: 'chapel:square', plot_id: 4, nickname }, g.token)).status, 400, nickname);
      }
      assert.equal(rpcs(state, 'set_nickname').length, 0);
      assert.equal(rpcs(state, 'claim_billboard').length, 0);
      assert.equal(rpcs(state, 'buy_or_upgrade_plot').length, 0);
      assert.equal((await post('/rt/profile', { nickname: '참새' }, g.token)).status, 200);
      assert.equal((await claim(g, 'STREET_21', 300, '참새')).status, 200);
      clock.add(1000);
    } finally { done(); }
  });
});

describe('lazy tribe settlement', () => {
  it('refunds last week once per week across isolates from /rt/world; the 소속 roof is never awarded; no other cron job runs', async () => {
    const { clock, state, done } = setup({ roofSql: 'new' });
    try {
      const env = makeEnv(), one = harness(env), two = harness(env, worker2);
      clock.set(mondayOf(clock.now()) + 7 * 864e5 + 3600000); // Monday 01:00 KST
      const prev = leagueWeek(clock.now() - 7 * 864e5);
      await one.get('/rt/world');
      assert.deepEqual(state.refunds, [prev]);
      assert.equal(rpcs(state, 'refund_tribe_week')[0].body.p_key, 'flush-test-key');
      clock.add(61000); await one.get('/rt/world');
      clock.add(61000); await two.get('/rt/world'); // another isolate: the durable marker says done
      assert.deepEqual(state.refunds, [prev]);
      // The old 소속 sheet's route answers moved (410) and settles nothing.
      const g = await two.guest();
      clock.add(61000); assert.equal((await two.post('/rt/tribe', { look: true }, g.token)).status, 410);
      assert.deepEqual(state.refunds, [prev]);
      // Sunday night and the rollover: no roof call on either kind of function.
      clock.set(mondayOf(clock.now()) + 6 * 864e5 + 21 * 3600000 + 60000); await one.get('/rt/world');
      clock.add(864e5); await one.get('/rt/world');
      assert.equal(rpcs(state, 'award_tribe_roof').length, 0); assert.deepEqual(state.roofs, []);
      for (const job of ['clear_dark_boards', 'inbox_ball', 'push_ball', 'push_due']) assert.equal(rpcs(state, job).length, 0, job);
      // The next week's refund still runs.
      assert.deepEqual(state.refunds, [prev, leagueWeek(clock.now() - 7 * 864e5)]);
    } finally { done(); }
  });
  it('retries a failed refund a minute later, at most once a minute per isolate', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), { get } = harness(env);
      clock.set(mondayOf(clock.now()) + 7 * 864e5 + 7200000);
      state.fail.add('refund_tribe_week');
      await get('/rt/world'); await get('/rt/world');
      assert.equal(rpcs(state, 'refund_tribe_week').length, 1);
      state.fail.delete('refund_tribe_week');
      clock.add(30000); await get('/rt/world');
      assert.equal(rpcs(state, 'refund_tribe_week').length, 1);
      clock.add(31000); await get('/rt/world');
      assert.equal(rpcs(state, 'refund_tribe_week').length, 2);
      assert.deepEqual(state.refunds, [leagueWeek(clock.now() - 7 * 864e5)]);
      clock.add(61000); await get('/rt/world');
      assert.equal(rpcs(state, 'refund_tribe_week').length, 2);
    } finally { done(); }
  });
  it('backs off to once an hour after 3 failures in a row; a function PostgREST does not know is done for the week', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv(), one = harness(env), two = harness(env, worker2);
      clock.set(mondayOf(clock.now()) + 7 * 864e5 + 7200000);
      state.fail.add('refund_tribe_week');
      for (let i = 0; i < 360; i++) { clock.add(10000); await one.get('/rt/world'); await two.get('/rt/world'); } // one hour, two isolates
      const n = rpcs(state, 'refund_tribe_week').length;
      assert.ok(n >= 6 && n <= 8, String(n)); // 3 a minute apart per isolate, then the next an hour later
      state.fail.delete('refund_tribe_week'); clock.add(3600000); await one.get('/rt/world'); await two.get('/rt/world');
      assert.equal(state.refunds.length, 1); // the success clears the backoff; the other isolate finds it done
      // Next week the function is missing: one call per isolate, then nothing for the rest of the week.
      clock.add(7 * 864e5); state.missing = new Set(['refund_tribe_week']); const before = rpcs(state, 'refund_tribe_week').length;
      for (let i = 0; i < 30; i++) { clock.add(600000); await one.get('/rt/world'); await two.get('/rt/world'); }
      assert.equal(rpcs(state, 'refund_tribe_week').length - before, 2);
    } finally { done(); }
  });
});

describe('budget hard (lvlNow 2)', () => {
  it('no lg calls for /rt/world, /rt/league or a claim, and no tribe settlement', async () => {
    const { clock, state, done } = setup();
    try {
      const env = makeEnv({ BUDGET_REQ_DAY: '1' }), H = harness(env), m = env.meter('lg').do, reads = [];
      for (const k of ['lgWorld', 'lgTop', 'lgOnce', 'lgAdd', 'lgBoard']) { const f = m[k].bind(m); m[k] = (...a) => { reads.push(k); return f(...a); }; }
      clock.set(mondayOf(clock.now()) + 7 * 864e5 + 3600000); // Monday: a refund would be due
      const lb = await (await H.get('/rt/league')).json();
      assert.deepEqual(lb.top, []);
      const world = await (await H.get('/rt/world')).json();
      assert.equal('league' in world, false);
      const a = await H.guest();
      assert.equal((await H.claim(a, 'STREET_5', 300, '가')).status, 200);
      assert.deepEqual(reads, []);
      assert.equal(rpcs(state, 'refund_tribe_week').length + rpcs(state, 'award_tribe_roof').length, 0);
    } finally { done(); }
  });
});
