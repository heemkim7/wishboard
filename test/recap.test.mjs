// 중5 주간 돌아보기 카드: recap.js rules, GET /rt/recap (auth, last week only, cache, budget), and the wiring in ui.js / main.js / net.js.
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
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
const R = await import('../recap.js');
const { leagueWeek } = await import('../league.js');
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const KST = (s) => Date.parse(s + '+09:00');

// ---- the rules ------------------------------------------------------------------------------------------------------------------------------
describe('recap.js: weeks', () => {
  it('uses the league week id, and Monday 00:00 KST is the boundary', () => {
    assert.equal(R.weekOf(KST('2026-11-22T23:59:59')), '2026W47');
    assert.equal(R.weekOf(KST('2026-11-23T00:00:00')), '2026W48');
    assert.equal(R.prevWeekOf(KST('2026-11-23T00:00:00')), '2026W47');
    assert.equal(R.weekOf(KST('2026-11-23T00:00:00')), leagueWeek(KST('2026-11-23T00:00:00')));
    // The year turn: 2026 has 53 ISO weeks.
    assert.equal(R.prevWeekOf(KST('2027-01-04T09:00:00')), '2026W53');
  });
  it('rolls this week into last week on the first look of the next one, and forgets anything older', () => {
    const raw = { cur: { w: '2026W47', days: ['2026-11-20'], claims: 1, held: 1, streak: 3, hearts: {} }, prev: null };
    const mon = KST('2026-11-23T00:00:01');
    const r = R.rollWeeks(raw, mon);
    assert.equal(r.prev.w, '2026W47'); assert.equal(r.prev.claims, 1);
    assert.deepEqual(r.cur, R.emptyRec('2026W48'));
    // Two weeks on: last week (W48) was never visited, so there is nothing to look back on.
    assert.equal(R.rollWeeks(raw, KST('2026-11-30T10:00:00')).prev, null);
    // The same week: nothing moves.
    assert.equal(R.rollWeeks(raw, KST('2026-11-22T10:00:00')).prev, null);
    assert.equal(R.rollWeeks(raw, KST('2026-11-22T10:00:00')).cur.claims, 1);
    // Junk reads as empty.
    for (const bad of [null, undefined, 5, 'x', { cur: 7 }, { cur: { w: 'bad' } }]) assert.deepEqual(R.rollWeeks(bad, mon), { cur: R.emptyRec('2026W48'), prev: null });
  });
});

describe('recap.js: what is kept', () => {
  const t0 = KST('2026-11-17T12:00:00'); // Tuesday of W47
  it('notes entered days once, with the streak, and writes nothing when nothing changed', () => {
    let s = R.noteDay(null, '2026-11-17', 1, t0);
    assert.deepEqual(s.cur.days, ['2026-11-17']); assert.equal(s.cur.streak, 1);
    assert.equal(R.noteDay(s, '2026-11-17', 1, t0), null);
    s = R.noteDay(s, '2026-11-18', 2, t0 + 864e5);
    assert.deepEqual(s.cur.days, ['2026-11-17', '2026-11-18']); assert.equal(s.cur.streak, 2);
    assert.equal(R.noteDay(s, 'garbage', 2, t0), null);
  });
  it('a first look in a new week writes the roll even when it adds nothing', () => {
    const s = R.noteDay(null, '2026-11-17', 2, t0);
    const next = R.noteDay(s, '2026-11-23', 3, KST('2026-11-23T08:00:00'));
    assert.equal(next.prev.w, '2026W47'); assert.deepEqual(next.cur.days, ['2026-11-23']);
    const rolled = R.noteHeld(s, 0, KST('2026-11-23T08:00:00')); // held 0 is no news, but the roll still is
    assert.equal(rolled.prev.w, '2026W47');
  });
  it('counts claims, the boards held now, and the most hearts seen on each wish', () => {
    let s = R.noteClaim(null, t0); s = R.noteClaim(s, t0);
    assert.equal(s.cur.claims, 2);
    s = R.noteHeld(s, 3, t0); assert.equal(s.cur.held, 3);
    assert.equal(R.noteHeld(s, 3, t0), null);
    s = R.noteHearts(s, { id: 'abcde12345', hearts: 4 }, t0);
    assert.equal(R.noteHearts(s, { id: 'abcde12345', hearts: 4 }, t0), null);
    assert.equal(R.noteHearts(s, { id: 'abcde12345', hearts: 2 }, t0), null, 'fewer hearts than seen: nothing new');
    s = R.noteHearts(s, { id: 'abcde12345', hearts: 6 }, t0); s = R.noteHearts(s, { id: 'zzzzz99999', hearts: 1 }, t0);
    assert.equal(R.heartsOf(s.cur), 7);
    for (const bad of [null, {}, { id: 'short', hearts: 3 }, { id: 'abcde12345', hearts: 0 }, { id: 'ABCDE12345', hearts: 3 }]) assert.equal(R.noteHearts(s, bad, t0), null);
  });
  it('bounds what it stores', () => {
    let s = null;
    for (let i = 0; i < 12; i++) s = R.noteDay(s, `2026-11-${String(10 + i).padStart(2, '0')}`, 1, KST('2026-11-17T12:00:00')) || s;
    assert.ok(s.cur.days.length <= 7);
    let h = s;
    for (let i = 0; i < 30; i++) h = R.noteHearts(h, { id: 'w' + String(1000000000 + i).slice(1), hearts: 1 }, t0) || h;
    assert.ok(Object.keys(h.cur.hearts).length <= 14);
  });
});

describe('recap.js: when the card is due', () => {
  const mon = KST('2026-11-23T09:00:00');
  const week = (extra = {}) => ({ cur: { w: '2026W47', days: ['2026-11-20'], claims: 0, held: 0, streak: 1, hearts: {}, ...extra }, prev: null });
  it('on the first entry of the week, for a browser that was active last week', () => {
    const rec = R.recapDue({ raw: week(), shown: '', now: mon });
    assert.equal(rec.w, '2026W47');
    assert.equal(R.recapDue({ raw: week({ days: [], claims: 2 }), shown: '', now: mon }).claims, 2, 'a claim is activity too');
  });
  it('not for a browser that was not active last week, and nothing else is asked of it', () => {
    assert.equal(R.recapDue({ raw: null, shown: '', now: mon }), null);
    assert.equal(R.recapDue({ raw: week({ days: [] }), shown: '', now: mon }), null);
    assert.equal(R.recapDue({ raw: week(), shown: '', now: KST('2026-11-30T09:00:00') }), null, 'two weeks on: last week was empty');
  });
  it('is not due before Monday 00:00 KST, and is due at it', () => {
    assert.equal(R.recapDue({ raw: week(), shown: '', now: KST('2026-11-22T23:59:59') }), null);
    assert.ok(R.recapDue({ raw: week(), shown: '', now: KST('2026-11-23T00:00:00') }));
  });
  it('is once per week: shown this week ends it, the next week is a new one', () => {
    assert.equal(R.recapDue({ raw: week(), shown: R.weekOf(mon), now: mon }), null);
    assert.equal(R.recapDue({ raw: week(), shown: R.weekOf(mon), now: KST('2026-11-26T20:00:00') }), null, 'later the same week, still none');
    const w48 = { cur: { w: '2026W48', days: ['2026-11-24'], claims: 0, held: 0, streak: 1, hearts: {} }, prev: null };
    assert.ok(R.recapDue({ raw: w48, shown: '2026W48', now: KST('2026-11-30T09:00:00') }), 'W49 is a new week with W48 behind it');
    assert.equal(R.recapDue({ raw: w48, shown: '2026W49', now: KST('2026-11-30T09:00:00') }), null);
  });
  it('is not for a newcomer', () => { assert.equal(R.recapDue({ raw: week(), shown: '', now: mon, newbie: true }), null); });
});

describe('recap.js: the words', () => {
  const rec = { w: '2026W47', days: ['2026-11-17', '2026-11-18'], claims: 2, held: 1, streak: 5, hearts: { abcde12345: 3, zzzzz99999: 2 } };
  it('lists rank, coins, boards, hearts and the streak, skipping what is zero or unknown', () => {
    const rows = R.recapLines(rec, { rank: 3, spent: 1250, players: 40 });
    assert.deepEqual(rows.map((r) => [r.k, r.value]), [['rank', '3위 · 40명 중'], ['spent', '1,250'], ['claims', '2곳'], ['held', '1곳'], ['hearts', '5개'], ['streak', '5일']]);
    assert.deepEqual(R.recapLines({ ...rec, claims: 0, held: 0, hearts: {}, streak: 1 }, null).map((r) => r.k), ['days'], 'no league row, nothing claimed: only the days');
    assert.equal(R.recapLines(rec, { rank: 0, spent: 0, players: 12 }).some((r) => r.k === 'rank' || r.k === 'spent'), false, 'unranked: no rank line');
    assert.equal(R.recapLines(rec, { rank: 1, spent: 10, players: 1 })[0].value, '1위');
  });
  it('shares numbers only: no names, no ids', () => {
    const t = R.recapShareText(rec, { rank: 3, spent: 1250, players: 40 });
    assert.equal(t, '지난주 모두의 전광판 기록 · 주간 리그 3위 · 40명 중 · 쓴 포인트 1,250 · 점령한 전광판 2곳 · 소원에 받은 하트 5개 · 연속 출석 5일');
    assert.equal(/abcde|guest|user:/.test(t), false);
    assert.equal(R.recapShareText({ ...rec, claims: 0, hearts: {}, streak: 1 }, null), '지난주 모두의 전광판에 다녀갔어요');
  });
});

// ---- GET /rt/recap --------------------------------------------------------------------------------------------------------------------------
function sqliteStorage() {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    exec(query, ...args) {
      const q = String(query).trim();
      if (!args.length && /^create\b/i.test(q)) { db.exec(q); return { rowsWritten: 0, toArray() { return []; }, one() { return {}; }, [Symbol.iterator]() { return [][Symbol.iterator](); } }; }
      const stmt = db.prepare(q);
      if (/^select\b/i.test(q)) { const rows = stmt.all(...args); return { rowsWritten: 0, toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() }; }
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
  const meters = new Map(), calls = [];
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ADMIN_KEY: 'admin-test-key-123', ASSETS: { fetch: () => new Response('asset', { status: 200 }) }, ...extra };
  env.calls = calls;
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new Meter(makeCtx(sql), env) }); } return meters.get(name); };
  env.METER = { idFromName: (name) => name, get: (name) => { const s = stub(env.meter(name).do); return new Proxy(s, { get: (t, k) => typeof t[k] === 'function' ? (...a) => { calls.push(name + '.' + String(k)); return t[k](...a); } : t[k] }); } };
  env.ROOM = { idFromName: (t) => t, get: () => ({ async fetch() { return new Response('{}'); }, async stats() { return { live: 0 }; } }) };
  return env;
}
function harness(env) {
  const waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (path, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + path, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const guest = async () => { const t = (await (await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).token; return { token: t, id: 'guest:' + JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).s }; };
  const get = (path, token) => call(path, { headers: token ? { authorization: 'Bearer ' + token } : {} });
  return { call, guest, get };
}
let clockBase = Date.parse('2026-11-18T03:00:00Z') + 400 * 864e5; // a Wednesday, far from the other test files' weeks
function freshClock() { clockBase += 21 * 864e5; let t = clockBase; const orig = Date.now; Date.now = () => t; return { add: (ms) => { t += ms; }, now: () => t, restore: () => { Date.now = orig; } }; }
const recapCalls = (env) => env.calls.filter((c) => c === 'lg.lgMe').length;

describe('GET /rt/recap', () => {
  it('answers with my own row of last week, numbers only, and nothing from this week', async () => {
    const clock = freshClock();
    try {
      const env = makeEnv(), H = harness(env), a = await H.guest(), b = await H.guest(), c = await H.guest();
      const now = clock.now(), last = leagueWeek(now - 7 * 864e5), thisWeek = leagueWeek(now), lg = env.meter('lg').do;
      lg.lgAdd(last, a.id, '가', 1200, now - 6 * 864e5); lg.lgAdd(last, b.id, '나', 5000, now - 6 * 864e5); lg.lgAdd(last, 'guest:bot', '네온봇4', 9999, now - 6 * 864e5);
      lg.lgAdd(thisWeek, c.id, '다', 300, now);
      const ra = await (await H.get('/rt/recap', a.token)).json();
      assert.deepEqual(ra, { ok: true, week: last, me: { rank: 2, spent: 1200, players: 2 } }, 'the bot is not ranked or counted');
      assert.equal(JSON.stringify(ra).includes('guest:'), false);
      assert.deepEqual((await (await H.get('/rt/recap', b.token)).json()).me, { rank: 1, spent: 5000, players: 2 });
      assert.deepEqual((await (await H.get('/rt/recap', c.token)).json()).me, { rank: 0, spent: 0, players: 2 }, 'spent only this week: no row last week');
    } finally { clock.restore(); }
  });
  it('needs a token (401, no Durable Object call) and answers GET only', async () => {
    const clock = freshClock();
    try {
      const env = makeEnv(), H = harness(env), a = await H.guest();
      assert.equal((await H.get('/rt/recap')).status, 401);
      assert.equal((await H.get('/rt/recap', 'not.a.token')).status, 401);
      assert.equal((await H.call('/rt/recap', { method: 'POST', headers: { authorization: 'Bearer ' + a.token }, body: '{}' })).status, 405);
      assert.equal(recapCalls(env), 0);
      assert.equal(env.calls.some((c) => c.startsWith('lg.')), false);
    } finally { clock.restore(); }
  });
  it('is kept 10 minutes per account in the isolate: one lg call, not one per request; a new account asks again', async () => {
    const clock = freshClock();
    try {
      const env = makeEnv(), H = harness(env), a = await H.guest(), b = await H.guest();
      const r1 = await (await H.get('/rt/recap', a.token)).json();
      for (let i = 0; i < 6; i++) assert.deepEqual(await (await H.get('/rt/recap', a.token)).json(), r1);
      assert.equal(recapCalls(env), 1);
      await H.get('/rt/recap', b.token); assert.equal(recapCalls(env), 2);
      clock.add(10 * 60e3 + 1); await H.get('/rt/recap', a.token); assert.equal(recapCalls(env), 3);
    } finally { clock.restore(); }
  });
  it('at the hard budget level only a copy answers: no Durable Object call, 503 otherwise', async () => {
    const clock = freshClock();
    try {
      const env = makeEnv({ BUDGET_REQ_DAY: '1' }), H = harness(env), a = await H.guest();
      env.calls.length = 0;
      const busy = await H.get('/rt/recap', a.token);
      assert.equal(busy.status, 503); assert.deepEqual(await busy.json(), { ok: false, err: 'busy' });
      assert.equal(recapCalls(env), 0);
    } finally { clock.restore(); }
  });
  it('is a route the Worker handles itself, with the league weeks kept (5 weeks reach back to last week)', async () => {
    const w = read('worker.js');
    assert.match(w, /if \(u\.pathname === '\/rt\/recap'\) return recapApi\(req, env\);/);
    assert.match(w, /const now = Date\.now\(\), w = isoWeek\(now - 7 \* 864e5\)/);
    assert.match(w, /if \(\(await lvlNow\(env\)\) >= 2\) return J\(\{ ok: false, err: 'busy' \}, 503\);/);
    assert.match(w, /rateOk\(env\.EVENT_RL, req\)/);
    const { LEAGUE } = await import('../league.js');
    assert.ok(LEAGUE.keepWeeks >= 2);
  });
});

// ---- wiring ---------------------------------------------------------------------------------------------------------------------------------
describe('wiring (ui.js, main.js, net.js)', () => {
  const ui = read('ui.js');
  const block = ui.slice(ui.indexOf('// ---- 주간 돌아보기 (recap.js)'), ui.indexOf('// 다녀간 사이 (main.js builds the rows'));
  it('the request is made once a week, from the card only, after the rules said the card is due', () => {
    assert.ok(block.length > 500);
    assert.match(block, /const rec = recapDue\(\{ raw: recall\(RECAP_KEY, null\), shown: recall\(RECAP_SHOWN_KEY, ''\), newbie: !!newbieOn \}\);\s*if \(!rec\) \{ recapCard\.state = 'done'; return; \}/);
    assert.equal((ui.match(/hooks\.recap\?\.\(\)/g) || []).length, 1, 'one call site');
    assert.match(block, /async function recapFetch\(week\) \{\s*const kept = recall\(RECAP_ME_KEY, null\);\s*if \(kept && kept\.week === week\) return kept\.me \|\| null;/, 'the answer (or the failure) of this week is reused after a reload');
    assert.match(block, /store\(RECAP_ME_KEY, \{ week, me: me \|\| null \}\)/);
    assert.match(block, /recapFetch\(weekOf\(\)\)/);
  });
  it('the card is a sheet, opened only on a quiet screen, once (kts_wk_shown), and it can be shared', () => {
    assert.match(block, /function openRecap\(rec, me\) \{\s*store\(RECAP_SHOWN_KEY, weekOf\(\)\);/);
    assert.match(block, /if \(screenBusy\(\) \|\| awayWant\) return; \/\/ the player did something meanwhile/);
    assert.match(block, /const busy = screenBusy\(\) \|\| !!awayWant \|\| !!pushQueued \|\| Date\.now\(\) < pushHoldUntil \|\| linkWant;/);
    assert.match(block, /sendLink\(\{ kind: 'recap', text: recapShareText\(rec, me\), url: SITE, native: true, into: box \}\)/, 'the existing share flow');
    assert.match(block, /RECAP_DROP_MS/);
  });
  it('the home-screen card yields to the recap card, and both go on the 1 s tick next to the pushes', () => {
    assert.match(ui, /!!recapCard\.rec \|\| recapCard\.state === 'fetching'/);
    assert.match(ui, /homeAt = now; wkTick\(now\); pumpRecap\(\); pumpHome\(now\);/);
  });
  it('the week is recorded on entering, on a claim, and from the boards and wish as they stand', () => {
    assert.match(ui, /wkNoteDay\(d\.streak\);/);
    assert.match(ui, /wkWrite\(noteHeld\(raw, myBoards\(\)\.length\)\)/);
    assert.match(ui, /wkWrite\(noteHearts\(recall\(RECAP_KEY, null\), hooks\.wishData\?\.\(\)\?\.mine\)\)/);
    assert.match(read('main.js'), /recap: \(\) => net\.recap\(\),/);
    assert.match(read('net.js'), /async recap\(\) \{[^\n]*fetch\('\/rt\/recap', \{ cache: 'no-store', headers: \{ authorization: 'Bearer ' \+ tok \}/);
  });
});
