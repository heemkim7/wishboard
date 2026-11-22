// 명당 rules (primerules.js): who counts, goals, participation, the day's schedule and its fairness when many teams qualify, what a prime
// screen shows at a time, KST day boundaries, team names, and that the module stays pure (no clock, no I/O, no money).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PRIME, SCREENS, HOUR_ORDER, isPrime, kstDay, dayStart, addDays, mdOk, mdOf, goalOf, nextGoal, supportVerdict, rateOf, hottest, byCount, goldPick, planDay, withGold, stripPlan, primeAt, primeKey, teamSlots, slotLine, nameFault, nameKey, cleanName, rankToday, rankWeek, primeCard, primeNotice, supportLine, BOARD_ERR } from '../primerules.js';
import { SLOT_IDS } from '../balance.js';

const id = (n) => 't' + String(n).padStart(7, '0');
const DAY = '2026-12-01', T0 = dayStart(DAY), H = 3600e3;

describe('prime screens', () => {
  it('are the main tower faces and the corner screens, never the street, plot or ad screens', () => {
    const prime = SLOT_IDS.filter(isPrime);
    assert.deepEqual(prime.sort(), [...SCREENS.tower, ...SCREENS.big, ...SCREENS.small].sort());
    assert.equal(prime.length, 13);
    for (const s of ['STREET_1', 'STREET_50', 'PLOT_3', 'AD_1', 'AD_5', '', null]) assert.equal(isPrime(s), false, String(s));
  });
});

describe('KST days', () => {
  it('turn at 00:00 KST (15:00 UTC)', () => {
    assert.equal(kstDay(Date.parse('2026-11-30T14:59:59.999Z')), '2026-11-30');
    assert.equal(kstDay(Date.parse('2026-11-30T15:00:00.000Z')), '2026-12-01');
    assert.equal(dayStart('2026-12-01'), Date.parse('2026-11-30T15:00:00Z'));
    assert.equal(addDays('2026-12-31', 1), '2027-01-01'); assert.equal(addDays('2027-03-01', -1), '2027-02-28');
    assert.equal(mdOf('2027-02-14'), '02-14');
    assert.equal(mdOk('02-29'), true); assert.equal(mdOk('02-30'), false); assert.equal(mdOk('13-01'), false); assert.equal(mdOk('4-1'), false);
  });
});

describe('who counts as a supporter', () => {
  const now = Date.parse('2026-12-01T03:00:00Z');
  it('a linked account at least 3 days old, once a day, one per network per team', () => {
    assert.equal(supportVerdict({ createdAt: now - 3 * 864e5, now }), 'ok');
    assert.equal(supportVerdict({ createdAt: now - 3 * 864e5 + 1, now }), 'young');
    assert.equal(supportVerdict({ guest: true, createdAt: now - 99 * 864e5, now }), 'guest');
    assert.equal(supportVerdict({ anon: true, createdAt: now - 99 * 864e5, now }), 'guest');
    assert.equal(supportVerdict({ createdAt: 0, now }), 'wait', 'an unknown age never counts');
    assert.equal(supportVerdict({ createdAt: now - 9 * 864e5, now, netTaken: true }), 'net');
    assert.equal(supportVerdict({ createdAt: now - 9 * 864e5, now, done: true }), 'done');
    for (const w of ['ok', 'done', 'guest', 'young', 'net', 'wait']) assert.ok(supportLine(w).length > 8, w);
    assert.match(supportLine('young', { from: Date.parse('2026-12-03T06:00:00Z') }), /12월 3일 15시/);
  });
  it('has no input for points or payments', () => {
    const src = fs.readFileSync(new URL('../primerules.js', import.meta.url), 'utf8');
    const sig = /export function supportVerdict\(\{([^}]*)\}/.exec(src)[1];
    assert.doesNotMatch(sig, /coin|point|pay|spent|bid|price/i);
    assert.doesNotMatch(src, /Date\.now\(\)|fetch\(|Math\.random/, 'pure: the caller gives the time');
  });
});

describe('goals and participation', () => {
  it('goals at 30 / 100 / 1,000 distinct supporters', () => {
    assert.equal(goalOf(29), ''); assert.equal(goalOf(30), 'small'); assert.equal(goalOf(99), 'small'); assert.equal(goalOf(100), 'big'); assert.equal(goalOf(999), 'big'); assert.equal(goalOf(1000), 'tower');
    assert.deepEqual(nextGoal(0), { goal: 'small', at: 30, left: 30 }); assert.deepEqual(nextGoal(30), { goal: 'big', at: 100, left: 70 }); assert.equal(nextGoal(1000), null);
  });
  it('participation needs 10 active supporters, so 1 of 1 never wins', () => {
    assert.equal(rateOf(1, 1), null); assert.equal(rateOf(9, 9), null); assert.equal(rateOf(9, 10), 0.9); assert.equal(rateOf(12, 10), 1);
    const hot = hottest([{ id: id(1), n: 1, act: 1 }, { id: id(2), n: 9, act: 10, last: 5 }, { id: id(3), n: 18, act: 20, last: 9 }, { id: id(4), n: 900, act: 2000 }]);
    assert.equal(hot.id, id(3), 'same 90%: more supporters wins'); assert.equal(hot.rate, 0.9);
    assert.equal(hottest([{ id: id(5), n: 10, act: 10, last: 7 }, { id: id(6), n: 10, act: 10, last: 3 }]).id, id(6), 'then whoever got there first');
    assert.equal(hottest([{ id: id(1), n: 3, act: 3 }]), null);
  });
  it('the 9 pm team: most supporters before 21:00, at least 10, ties to the earlier', () => {
    assert.equal(goldPick([{ id: id(1), n: 9 }]), null);
    assert.deepEqual(goldPick([{ id: id(1), n: 12, last: 50 }, { id: id(2), n: 12, last: 40 }, { id: id(3), n: 11 }]), { id: id(2), n: 12 });
    assert.deepEqual(byCount([{ id: 'bad', n: 99 }, { id: id(1), n: 0 }]), [], 'bad ids and zero rows never rank');
  });
});

describe('the day\'s plan', () => {
  const teams = (n, at = 0) => Array.from({ length: n }, (_, i) => ({ id: id(i + 1), name: '팀' + (i + 1), n: at || 1000 + n - i, last: i }));
  it('gives each goal its screens: small corner faces for 30+, big corner faces for 100+, the main tower for 1,000+', () => {
    const p = planDay({ day: DAY, teams: [{ id: id(1), name: 'A', n: 1500 }, { id: id(2), name: 'B', n: 150 }, { id: id(3), name: 'C', n: 31 }, { id: id(4), name: 'D', n: 29 }] });
    assert.deepEqual(p.big, [[id(1)], [id(2)], [], []]);
    assert.deepEqual(p.small, [[id(3)], [], [], []]);
    assert.deepEqual(p.tower, [{ id: id(1), a: 20 * H, b: 21 * H }], 'the best hour first (20:00)');
    assert.equal(p.hot, null); assert.deepEqual(p.annH.filter(Boolean), []);
    assert.equal(JSON.stringify(p).includes(id(4)), false, 'under 30 gets nothing');
  });
  it('keeps SUB_1A for the hottest team all day; the 100+ teams share the other three', () => {
    const p = planDay({ day: DAY, teams: teams(5, 200), hot: { id: id(9), name: 'H', rate: 0.95, n: 12 } });
    assert.deepEqual(p.big[0], [], 'SUB_1A is the hot team\'s'); assert.equal(p.hot.id, id(9));
    assert.deepEqual(p.big.slice(1).map((l) => l.length), [2, 2, 1]);
    assert.equal(primeAt(p, 'SUB_1A', T0 + 10 * H).id, id(9));
    // The hot team that also reached 100 does not take a second big screen.
    const q = planDay({ day: DAY, teams: teams(3, 200), hot: { id: id(1), rate: 1, n: 200 } });
    assert.deepEqual(q.big, [[], [id(2)], [id(3)], []]);
  });
  it('shares a screen in equal one-minute turns by the wall clock (every viewer sees the same team)', () => {
    const p = planDay({ day: DAY, teams: teams(9, 50) });
    assert.deepEqual(p.small.map((l) => l.length), [3, 2, 2, 2], 'round robin by rank: never more than one apart');
    const seen = new Map();
    for (let m = 0; m < 6; m++) { const e = primeAt(p, 'SUB_1B', T0 + 8 * H + m * 60e3 + 5); seen.set(e.id, (seen.get(e.id) || 0) + 1); }
    assert.deepEqual([...seen.values()], [2, 2, 2], 'three teams, two minutes each in six');
    assert.equal(primeAt(p, 'SUB_1B', T0 + 8 * H + 59999).id, primeAt(p, 'SUB_1B', T0 + 8 * H).id);
    assert.notEqual(primeAt(p, 'SUB_1B', T0 + 8 * H + 60000).id, primeAt(p, 'SUB_1B', T0 + 8 * H).id);
  });
  it('splits the main tower evenly when more than 23 teams reach 1,000, never under 5 minutes', () => {
    const p23 = planDay({ day: DAY, teams: teams(23) });
    assert.equal(p23.tower.length, 23); assert.ok(p23.tower.every((s) => s.b - s.a === H));
    assert.equal(p23.tower.some((s) => s.a === 21 * H), false, '21:00-22:00 is the 9 pm slot');
    const p30 = planDay({ day: DAY, teams: teams(30) });
    assert.equal(p30.tower.length, 30); assert.ok(p30.tower.every((s) => s.b - s.a === H / 2), 'all the same length');
    const first = p30.tower.filter((s) => s.a >= 20 * H && s.a < 21 * H).map((s) => s.id);
    assert.deepEqual(first, [id(1), id(2)], 'the top two share the best hour');
    const many = planDay({ day: DAY, teams: teams(400) });
    assert.equal(many.tower.length, 23 * 12); assert.ok(many.tower.every((s) => s.b - s.a === 5 * 60e3));
    assert.equal(many.big.flat().length, 400, 'past the tower\'s room the rest keep their big screen');
    const starts = many.tower.map((s) => s.a).sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 5 * 60e3, 'no overlap');
  });
  it('gives each approved anniversary at least one top-of-the-hour minute, rotating; 23 at most a day', () => {
    const ann = Array.from({ length: 3 }, (_, i) => ({ id: id(50 + i), name: 'A' + i, label: '생일', at: 10 - i }));
    const p = planDay({ day: DAY, teams: [], ann });
    assert.deepEqual(p.ann.map((x) => x.id), [id(52), id(51), id(50)], 'earlier approval first');
    assert.deepEqual(p.ann.map((x) => x.hours.length), [8, 8, 7]);
    assert.equal(p.annH[21], '', 'not in the 9 pm hour');
    assert.equal(p.annH[20], id(52), 'the first approved has 20:00');
    assert.equal(primeAt(p, 'MAIN_LOW', T0 + 20 * H + 59999).why, 'ann'); assert.equal(primeAt(p, 'MAIN_LOW', T0 + 20 * H + 60000), null);
    const lots = planDay({ day: DAY, ann: Array.from({ length: 30 }, (_, i) => ({ id: id(100 + i), at: i })) });
    assert.equal(lots.ann.length, PRIME.annMax); assert.ok(lots.ann.every((x) => x.hours.length === 1));
    assert.deepEqual([...HOUR_ORDER].sort((a, b) => a - b), Array.from({ length: 24 }, (_, h) => h).filter((h) => h !== 21));
  });
  it('the 9 pm hour: waits until the server names the team, then shows it 21:00-22:00; nobody when no team reached 10', () => {
    const p = planDay({ day: DAY, teams: teams(1) });
    assert.deepEqual(primeAt(p, 'MAIN_TOP', T0 + 21 * H + 1000), { id: '', name: '', why: 'gold', n: 0, wait: true });
    const g = withGold(p, { id: id(7), n: 44 }, '골드팀');
    assert.equal(primeAt(g, 'MAIN_TOP', T0 + 21 * H + 1000).name, '골드팀'); assert.equal(primeAt(g, 'MAIN_UP', T0 + 22 * H - 1).why, 'gold');
    assert.equal(primeAt(withGold(p, null), 'MAIN_TOP', T0 + 21 * H + 1000), null);
    assert.equal(primeAt(g, 'SUB_1B', T0 + 21 * H), null, 'only the main tower');
    assert.deepEqual(teamSlots(g, id(7)).map(slotLine), ['밤 9시 메인 타워 · 21:00~22:00']);
  });
  it('belongs to its own day only; hidden teams leave every screen', () => {
    const p = planDay({ day: DAY, teams: teams(2, 150) });
    assert.equal(primeAt(p, 'SUB_1A', T0 - 1), null); assert.equal(primeAt(p, 'SUB_1A', T0 + 24 * H), null);
    assert.equal(primeAt(p, 'SUB_1A', T0).id, id(1));
    const s = stripPlan(p, new Set([id(1)]));
    assert.equal(primeAt(s, 'SUB_1A', T0 + H), null); assert.equal(primeAt(s, 'SUB_2A', T0 + H).id, id(2));
    assert.equal(primeAt(p, 'STREET_3', T0 + H), null, 'never an ordinary board');
  });
  it('page lines, card text and notices', () => {
    const p = planDay({ day: DAY, teams: [{ id: id(1), name: 'A', n: 1200 }, { id: id(2), name: 'B', n: 40 }, { id: id(3), name: 'C', n: 40 }, { id: id(4), name: 'D', n: 40 }, { id: id(5), name: 'E', n: 40 }, { id: id(6), name: 'F', n: 40 }] });
    assert.deepEqual(teamSlots(p, id(1)).map(slotLine), ['메인 타워 · 20:00~21:00', '코너 위 큰 화면 · 하루 종일']);
    assert.deepEqual(teamSlots(p, id(2)).map(slotLine), ['코너 아래 화면 · 하루 종일 2팀이 1분씩 번갈아']);
    const c = primeCard(primeAt(p, 'MAIN_MID', T0 + 20 * H + 120e3));
    assert.equal(c.head, 'A'); assert.equal(c.chip, '1,000명 달성'); assert.match(c.sub, /1,200명/);
    assert.match(primeNotice('MAIN_TOP').line2, /1,000명/); assert.match(primeNotice('SUB_2A').line2, /100명/); assert.match(primeNotice('SUB_2B').line2, /30명/);
    assert.notEqual(primeKey(primeAt(p, 'SUB_1B', T0)), primeKey(primeAt(p, 'SUB_1B', T0 + 60e3)));
  });
});

describe('team names', () => {
  it('are labels: letters, digits, a few marks; no links; the operator\'s words are refused', () => {
    assert.equal(nameFault('방탄 아미'), ''); assert.equal(nameFault('TWICE ONCE ♡'), ''); assert.equal(nameFault('トゥワイス'), '');
    assert.equal(nameFault(''), 'name_empty'); assert.equal(nameFault('가'.repeat(17)), 'name_long');
    assert.equal(nameFault('my.site.com'), 'name_chars'); assert.equal(nameFault('a/b'), 'name_chars'); assert.equal(nameFault('<b>'), 'name_chars');
    assert.equal(nameFault('WISH BOARD 팀'), 'name_blocked'); assert.equal(nameFault('운영자팀'), 'name_blocked');
    assert.equal(nameKey('Aa  Bb!'), nameKey('aabb')); assert.equal(cleanName('  a​  b '), 'a b');
  });
});

describe('rankings', () => {
  it('today by people; participation only for teams with 10+ active supporters; this week by goals reached', () => {
    const r = rankToday([{ id: id(1), name: '큰', n: 300, act: 900 }, { id: id(2), name: '작은', n: 10, act: 10 }, { id: id(3), name: '혼자', n: 1, act: 1 }]);
    assert.deepEqual(r.today.map((x) => x.name), ['큰', '작은', '혼자']); assert.equal(r.today[0].goal, 'big');
    assert.deepEqual(r.rate.map((x) => [x.name, x.rate]), [['작은', 1], ['큰', 1 / 3]]);
    assert.deepEqual(rankWeek([{ id: id(1), name: 'a', k: 2 }, { id: id(2), name: 'b', k: 5 }, { id: id(3), name: 'c', k: 0 }]).map((x) => x.name), ['b', 'a']);
  });
});

describe('claim refusals', () => {
  it('name every closed path', () => {
    for (const k of ['prime', 'held', 'mine', 'tribe', 'air', 'plot', 'relight']) assert.ok(BOARD_ERR[k], k);
    for (const t of Object.values(BOARD_ERR)) assert.doesNotMatch(t, /점령|빼앗|되찾|입찰|탈환|장악/);
  });
});
