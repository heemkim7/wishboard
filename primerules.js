// 응원 팀과 명당 (docs/prime-screens.md): pure rules shared by the Worker, the browser and the tests. No I/O, no clock of its own (every
// function takes the time it judges). The Worker bundles this module, so it is imported without a ?v= query everywhere.
//
// Prime screens (명당) are the main tower faces (MAIN_*) and the corner screens (SUB_*). They are never claimable with points: they show
// fan-team boards by public rules. A team wins screen time by how many distinct people supported it in a KST day, never by points or money.
//   1. Goals (목표 달성형): 30 distinct supporters in a day -> a small corner screen (SUB_xB) the next day, 100 -> a big corner screen (SUB_xA)
//      the next day, 1,000 -> one hour of the main tower the next day. Any number of teams can reach a goal; screens are shared fairly.
//   2. Anniversary (기념일 보장): a team's admin-approved date gives it the first minute of top-of-the-hour slots on the main tower that day.
//   3. Participation (참여율): supporters today / the team's supporters in the last 7 days (at least 10 of them). The day's top team gets the
//      "가장 뜨거운 팀" big screen (SUB_1A) all of the next day.
//   4. 9 pm (밤 9시 주인공): the team with the most distinct supporters today before 21:00 KST gets the main tower 21:00-22:00 that night.
// Ordinary boards (STREET_*, PLOT_*) stay as they are: lit with points only while free, for a fixed time, never taken from anyone.
import { blockedText } from './plaza-account.js';

export const PRIME = Object.freeze({
  goals: Object.freeze({ small: 30, big: 100, tower: 1000 }),
  minTeam: 10,        // participation is ranked only for teams with at least this many supporters in the last 7 days (so 1 of 1 never wins)
  goldMin: 10,        // the 9 pm main tower needs at least this many distinct supporters before 21:00
  ageDays: 3,         // an account counts as a supporter once it is this many days old (a same-day burst of new accounts does not count)
  activeDays: 7,      // "recently active member": supported the team on one of the last 7 KST days, today included
  turnMs: 60000,      // a shared screen turns every minute by the wall clock, so every viewer sees the same team
  annMax: 23,         // anniversaries approved for one date: each gets at least one top-of-the-hour minute (23 hours; 21:00 is the 9 pm slot)
  towerSplit: 12,     // at most 12 tower slots an hour (5 minutes each) when many teams reach 1,000
  hopMs: 24 * 3600e3, // after leaving a team, another can be joined 24 h later (no hopping to push whichever team is near a goal)
  nameMax: 16,
  labelMax: 16,
  keepDays: 40,       // supporter rows are kept 40 days (the D30 numbers need them), counters and plans longer
  rankN: 20,
});
// The screens, in the order the schedule fills them. hot: the "가장 뜨거운 팀" screen (the first big one).
export const SCREENS = Object.freeze({
  tower: Object.freeze(['MAIN_UP', 'MAIN_TOP', 'MAIN_MID', 'MAIN_BOT', 'MAIN_LOW']),
  big: Object.freeze(['SUB_1A', 'SUB_2A', 'SUB_3A', 'SUB_4A']),
  small: Object.freeze(['SUB_1B', 'SUB_2B', 'SUB_3B', 'SUB_4B']),
  hot: 'SUB_1A',
});
export const PRIME_RE = /^(MAIN_(UP|TOP|MID|BOT|LOW)|SUB_[1-4][AB])$/;
/** A prime screen (명당): never claimable with points. */
export const isPrime = (slot) => PRIME_RE.test(String(slot ?? ''));
// Hours of the main tower, best first. 21 is the 9 pm slot (its own rule), so goals and anniversaries use the other 23.
export const HOUR_ORDER = Object.freeze([20, 22, 19, 18, 23, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 0, 7, 1, 6, 2, 5, 3, 4]);
export const GOLD_HOUR = 21;
const H = 3600e3, D = 864e5;
export const TEAM_ID = /^[a-z0-9]{8}$/;

// ---- KST days ----------------------------------------------------------------------------------------------------------
/** YYYY-MM-DD in KST. */
export const kstDay = (t) => new Date(Math.floor(Number(t) || 0) + 9 * H).toISOString().slice(0, 10);
/** 00:00 KST of that day, epoch ms. */
export const dayStart = (day) => Date.parse(String(day) + 'T00:00:00Z') - 9 * H;
export const addDays = (day, n) => new Date(Date.parse(String(day) + 'T00:00:00Z') + n * D).toISOString().slice(0, 10);
/** 'MM-DD' of a day (anniversaries repeat every year). */
export const mdOf = (day) => String(day).slice(5, 10);
export const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? '')) && kstDay(dayStart(s)) === String(s);
/** A month-day an anniversary may use: 01-01 .. 12-31 (02-29 too: in other years it simply does not come). */
export function mdOk(md) {
  const m = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(String(md ?? ''));
  if (!m) return false;
  return Number(m[2]) <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(m[1]) - 1];
}
export const mdText = (md) => (mdOk(md) ? `${Number(md.slice(0, 2))}월 ${Number(md.slice(3, 5))}일` : '');

// ---- names -------------------------------------------------------------------------------------------------------------
// A team name is a label: idol names, a neighbourhood, a group of friends. Letters and digits of any script, spaces and a few marks.
// No links, no photos or logos (there is nowhere to put one). Reserved words that read as the operator are refused.
const NAME_OK = /^[\p{L}\p{N} _.·&!'♡♥☆★-]+$/u;
const RESERVED = /(wish\s*board|운영자|관리자|admin|공식|official)/i;
const LINKY = /(https?|www\.|\.(com|net|org|kr|io|me|ly|gg|co)\b)/i;
export function cleanName(raw, max = PRIME.nameMax) { return Array.from(String(raw ?? '').normalize('NFKC').replace(/[\u0000-\u001f​-‏⁠-⁤﻿]/g, '').replace(/\s+/g, ' ').trim()).slice(0, max).join('').trim(); }
/** '' when the name may be used, else the refusal code (TEAM_ERR has the copy). */
export function nameFault(raw, max = PRIME.nameMax) {
  const s = cleanName(raw, 999);
  if (!s) return 'name_empty';
  if (Array.from(s).length > max) return 'name_long';
  if (!NAME_OK.test(s) || LINKY.test(s)) return 'name_chars';
  if (RESERVED.test(s) || blockedText(s)) return 'name_blocked';
  return '';
}
/** Two names that read the same are the same team name (case, width, spaces and marks do not count). */
export const nameKey = (raw) => cleanName(raw, 999).toLowerCase().replace(/[\s_.·&!'♡♥☆★-]+/g, '');

// ---- goals -------------------------------------------------------------------------------------------------------------
/** The goal a day's distinct supporters reached: 'tower' | 'big' | 'small' | ''. */
export function goalOf(n) { const v = Math.floor(Number(n) || 0), G = PRIME.goals; return v >= G.tower ? 'tower' : v >= G.big ? 'big' : v >= G.small ? 'small' : ''; }
/** The next goal above n: { goal, at, left } or null past the last one. */
export function nextGoal(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0)), G = PRIME.goals;
  for (const goal of ['small', 'big', 'tower']) if (v < G[goal]) return { goal, at: G[goal], left: G[goal] - v };
  return null;
}
export const GOAL_NAME = Object.freeze({ small: '작은 명당', big: '큰 화면', tower: '메인 타워 1시간', hot: '가장 뜨거운 팀', ann: '기념일 메인 타워', gold: '밤 9시 메인 타워' });
export const GOAL_PRIZE = Object.freeze({ small: '다음 날 코너 아래 화면', big: '다음 날 코너 위 큰 화면', tower: '다음 날 메인 타워 1시간' });

// ---- who counts --------------------------------------------------------------------------------------------------------
// One person, one support a KST day, for the one team they are in. Counted ('ok') only for a linked account at least PRIME.ageDays old,
// and only one counted supporter per network (IPv4 address, IPv6 /64) per team per day. Points never buy support and no payment counts.
//   done: already supported today (any team) · guest: a guest or an anonymous login · wait: the account's age could not be read
//   young: the account is newer than PRIME.ageDays · net: another counted supporter of this team today shares the network
export function supportVerdict({ guest = false, anon = false, createdAt = 0, now = 0, netTaken = false, done = false } = {}) {
  if (done) return 'done';
  if (guest || anon) return 'guest';
  const at = Number(createdAt) || 0;
  if (!(at > 0)) return 'wait';
  if (now - at < PRIME.ageDays * D) return 'young';
  if (netTaken) return 'net';
  return 'ok';
}
/** When a young account starts to count, epoch ms. */
export const countsFrom = (createdAt) => (Number(createdAt) || 0) + PRIME.ageDays * D;
export function supportLine(why, { from = 0 } = {}) {
  switch (why) {
    case 'ok': return '오늘 응원이 세어졌어요. 내일 0시에 다시 응원할 수 있어요';
    case 'done': return '오늘은 이미 응원했어요. 내일 0시(한국 시간)에 다시 할 수 있어요';
    case 'guest': return '손님 응원은 기록만 하고 세지 않아요. 계정을 연결하고 3일이 지나면 세어져요';
    case 'young': { const d = from ? new Date(from + 9 * H) : null; return d ? `가입하고 3일이 지나야 세어져요 · ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${d.getUTCHours()}시부터` : '가입하고 3일이 지나야 세어져요'; }
    case 'net': return '같은 인터넷 연결에서 오늘 이 팀을 응원한 사람이 이미 있어서 세지 않았어요(한 연결에 한 명)';
    case 'wait': return '계정을 확인하지 못해 아직 세지 않았어요. 잠시 뒤 다시 눌러 주세요';
    default: return '';
  }
}

// ---- participation -----------------------------------------------------------------------------------------------------
/** today / active (both counted supporters), or null under PRIME.minTeam active supporters. */
export function rateOf(today, active) { const a = Math.floor(Number(active) || 0), t = Math.floor(Number(today) || 0); return a >= PRIME.minTeam ? Math.min(1, t / a) : null; }
export const pct = (r) => (r == null ? '' : Math.round(r * 100) + '%');
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// The day's "가장 뜨거운 팀": highest rate, then more supporters, then the one that got there first (last = the time of its latest counted
// supporter), then the id. rows: [{ id, n, act, last }].
export function hottest(rows) {
  const list = (Array.isArray(rows) ? rows : []).map((r) => ({ id: String(r?.id || ''), n: Math.floor(Number(r?.n) || 0), act: Math.floor(Number(r?.act) || 0), last: Number(r?.last) || 0 }))
    .filter((r) => TEAM_ID.test(r.id) && r.n > 0).map((r) => ({ ...r, rate: rateOf(r.n, r.act) })).filter((r) => r.rate != null);
  list.sort((a, b) => b.rate - a.rate || b.n - a.n || a.last - b.last || byId(a, b));
  return list[0] ? { id: list[0].id, rate: list[0].rate, n: list[0].n, act: list[0].act } : null;
}
// Most supporters first, then whoever reached that number first, then the id: one order for goals, rankings and the 9 pm slot.
export function byCount(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({ ...r, id: String(r?.id || ''), n: Math.floor(Number(r?.n) || 0), last: Number(r?.last) || 0 }))
    .filter((r) => TEAM_ID.test(r.id) && r.n > 0).sort((a, b) => b.n - a.n || a.last - b.last || byId(a, b));
}
/** The 9 pm team: rows carry the counts before 21:00 ({ id, n, last }). null below PRIME.goldMin. */
export function goldPick(rows) { const top = byCount(rows)[0]; return top && top.n >= PRIME.goldMin ? { id: top.id, n: top.n } : null; }

// ---- the day's schedule ------------------------------------------------------------------------------------------------
// planDay: what the prime screens show on `day`, from the day before (final, so it never changes once made) and the anniversaries.
//   teams: [{ id, name, n, last }] yesterday's counted supporters · hot: hottest() of yesterday · ann: approved anniversaries of this
//   month-day [{ id, name, label, at }] (at: approval time, the earlier first).
// -> { day, names, n, hot, big[4][], small[4][], tower[{ id, a, b }], annH[24], ann[{ id, label, hours }], gold: undefined }
// Fairness: teams that reached a goal share its screens in equal one-minute turns (round robin by rank, so each screen gets the same
// number ±1); the main tower gives each 1,000 team one hour, in the best hours first by rank, and splits every hour equally when more than
// 23 teams reach it (never under 5 minutes; past 276 teams the rest keep their big screen). gold is set after 21:00 by goldPick.
export function planDay({ day, teams = [], hot = null, ann = [] } = {}) {
  const ranked = byCount(teams);
  const names = {}, n = {};
  for (const t of ranked) { names[t.id] = cleanName(t.name) || '응원 팀'; n[t.id] = t.n; }
  const G = PRIME.goals;
  const hotId = hot && TEAM_ID.test(String(hot.id || '')) ? String(hot.id) : '';
  const bigScreens = hotId ? SCREENS.big.length - 1 : SCREENS.big.length;
  const big = SCREENS.big.map(() => []), small = SCREENS.small.map(() => []);
  let bi = 0, si = 0;
  for (const t of ranked) {
    if (t.n >= G.big) { if (t.id !== hotId) { big[(hotId ? 1 : 0) + (bi % bigScreens)].push(t.id); bi++; } }
    else if (t.n >= G.small) { small[si % small.length].push(t.id); si++; }
  }
  const towerTeams = ranked.filter((t) => t.n >= G.tower);
  const hours = HOUR_ORDER.length;
  const per = Math.min(PRIME.towerSplit, Math.max(1, Math.ceil(towerTeams.length / hours)));
  const slotMs = H / per, tower = [];
  towerTeams.slice(0, hours * per).forEach((t, r) => {
    const hour = HOUR_ORDER[Math.floor(r / per)], a = hour * H + (r % per) * slotMs;
    tower.push({ id: t.id, a: Math.round(a), b: Math.round(a + slotMs) });
  });
  // When the tower splits an hour, rank r takes the r-th slot in best-hour order: the top teams get the best hours, all the same length.
  tower.sort((x, y) => x.a - y.a);
  const annList = (Array.isArray(ann) ? ann : []).filter((x) => TEAM_ID.test(String(x?.id || ''))).map((x) => ({ id: String(x.id), name: cleanName(x.name) || '응원 팀', label: cleanName(x.label, PRIME.labelMax), at: Number(x.at) || 0 }))
    .sort((a, b) => a.at - b.at || byId(a, b)).slice(0, PRIME.annMax);
  const annH = Array(24).fill('');
  const annOut = annList.map((x) => ({ id: x.id, label: x.label, hours: [] }));
  if (annOut.length) HOUR_ORDER.forEach((hour, i) => { const k = i % annOut.length; annH[hour] = annOut[k].id; annOut[k].hours.push(hour); });
  for (const x of annList) { names[x.id] = names[x.id] || x.name; }
  for (const x of annOut) x.hours.sort((a, b) => a - b);
  if (hotId) { names[hotId] = names[hotId] || cleanName(hot.name) || '응원 팀'; n[hotId] = n[hotId] || Math.floor(Number(hot.n) || 0); }
  // Only the teams the plan places keep their name and count (the plan goes to every browser in /rt/world).
  const used = new Set([...big.flat(), ...small.flat(), ...tower.map((s) => s.id), ...annOut.map((x) => x.id), ...(hotId ? [hotId] : [])]);
  for (const k of Object.keys(names)) if (!used.has(k)) delete names[k];
  for (const k of Object.keys(n)) if (!used.has(k)) delete n[k];
  return { day: String(day), names, n, hot: hotId ? { id: hotId, rate: Number(hot.rate) || 0, n: Math.floor(Number(hot.n) || 0) } : null, big, small, tower, annH, ann: annOut };
}
/** The plan with the 9 pm team filled in (null: no team reached PRIME.goldMin before 21:00). */
export function withGold(plan, gold, name = '') {
  if (!plan) return plan;
  const g = gold && TEAM_ID.test(String(gold.id || '')) ? { id: String(gold.id), n: Math.floor(Number(gold.n) || 0) } : null;
  const names = { ...(plan.names || {}) };
  if (g) names[g.id] = names[g.id] || cleanName(name) || '응원 팀';
  return { ...plan, names, gold: g };
}
/** Teams named nowhere in the plan any more (hidden by the operator) leave every screen. */
export function stripPlan(plan, hidden) {
  if (!plan || !hidden || !hidden.size) return plan;
  const keep = (id) => !hidden.has(id);
  return { ...plan, hot: plan.hot && keep(plan.hot.id) ? plan.hot : null, big: plan.big.map((l) => l.filter(keep)), small: plan.small.map((l) => l.filter(keep)),
    tower: plan.tower.filter((s) => keep(s.id)), annH: plan.annH.map((id) => (id && keep(id) ? id : '')), ann: plan.ann.filter((x) => keep(x.id)),
    ...(plan.gold !== undefined ? { gold: plan.gold && keep(plan.gold.id) ? plan.gold : null } : {}) };
}
// What a prime screen shows at time t: { id, name, why, n, label } or null (the screen keeps its own notice, a wish card, or a board lit
// before the change until it runs out). why: 'gold' | 'ann' | 'tower' | 'hot' | 'big' | 'small'. During the 9 pm hour before the server
// has named the team (plan.gold undefined) the main tower answers { wait: true, why: 'gold' }.
export function primeAt(plan, slot, t) {
  if (!plan || !isPrime(slot) || plan.day !== kstDay(t)) return null;
  const m = t - dayStart(plan.day), S = String(slot), name = (id) => plan.names?.[id] || '응원 팀';
  const out = (id, why, extra = {}) => ({ id, name: name(id), why, n: Math.floor(Number(plan.n?.[id]) || 0), ...extra });
  if (S.startsWith('MAIN_')) {
    const hour = Math.floor(m / H);
    if (hour === GOLD_HOUR) {
      if (plan.gold === undefined) return { id: '', name: '', why: 'gold', n: 0, wait: true };
      return plan.gold ? out(plan.gold.id, 'gold', { n: plan.gold.n }) : null;
    }
    if (m % H < 60e3 && plan.annH?.[hour]) { const id = plan.annH[hour]; return out(id, 'ann', { label: plan.ann?.find((x) => x.id === id)?.label || '' }); }
    for (const s of plan.tower || []) if (m >= s.a && m < s.b) return out(s.id, 'tower');
    return null;
  }
  if (S === SCREENS.hot && plan.hot) return out(plan.hot.id, 'hot', { rate: plan.hot.rate });
  const bi = SCREENS.big.indexOf(S), si = SCREENS.small.indexOf(S);
  const list = bi >= 0 ? plan.big?.[bi] : si >= 0 ? plan.small?.[si] : null;
  if (!list?.length) return null;
  return out(list[Math.floor(t / PRIME.turnMs) % list.length], bi >= 0 ? 'big' : 'small', { share: list.length });
}
/** A stable key of what primeAt shows (a screen repaints only when it changes). */
export const primeKey = (e) => (e ? [e.why, e.id, e.n, e.label || '', e.wait ? 1 : 0].join('|') : '');
// Where a team shows on that day's plan, for its page: [{ why, slot?, a, b, share }] (a/b: ms of the day; share: teams on that screen).
export function teamSlots(plan, id) {
  if (!plan || !TEAM_ID.test(String(id || ''))) return [];
  const out = [];
  if (plan.gold?.id === id) out.push({ why: 'gold', a: GOLD_HOUR * H, b: (GOLD_HOUR + 1) * H });
  for (const s of plan.tower || []) if (s.id === id) out.push({ why: 'tower', a: s.a, b: s.b });
  const ann = (plan.ann || []).find((x) => x.id === id);
  if (ann) out.push({ why: 'ann', hours: ann.hours.slice(), label: ann.label });
  if (plan.hot?.id === id) out.push({ why: 'hot', slot: SCREENS.hot, a: 0, b: D });
  plan.big?.forEach((l, i) => { if (l.includes(id)) out.push({ why: 'big', slot: SCREENS.big[i], a: 0, b: D, share: l.length }); });
  plan.small?.forEach((l, i) => { if (l.includes(id)) out.push({ why: 'small', slot: SCREENS.small[i], a: 0, b: D, share: l.length }); });
  return out;
}
const hm = (ms) => { const m = Math.round(ms / 60e3); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
/** One line per slot for the team page. */
export function slotLine(s) {
  if (!s) return '';
  if (s.why === 'gold') return '밤 9시 메인 타워 · 21:00~22:00';
  if (s.why === 'tower') return `메인 타워 · ${hm(s.a)}~${hm(s.b)}`;
  if (s.why === 'ann') return `기념일 메인 타워 · ${s.hours.map((h) => h + '시').join(', ')} 정시 1분${s.label ? ' · ' + s.label : ''}`;
  if (s.why === 'hot') return '가장 뜨거운 팀 · 1번 코너 위 큰 화면 하루 종일';
  const where = s.why === 'big' ? '코너 위 큰 화면' : '코너 아래 화면';
  return s.share > 1 ? `${where} · 하루 종일 ${s.share}팀이 1분씩 번갈아` : `${where} · 하루 종일`;
}
export const WHY_CHIP = Object.freeze({ gold: '밤 9시 주인공', ann: '기념일', tower: '1,000명 달성', hot: '가장 뜨거운 팀', big: '100명 달성', small: '30명 달성' });
// The text a prime screen paints for an entry (ts3d draws it; the server never does).
export function primeCard(e, day = '') {
  if (!e) return null;
  if (e.wait) return { chip: '밤 9시 주인공', head: '9시 주인공을 정하는 중', sub: '오늘 9시 전까지 서로 다른 사람이 가장 많이 응원한 팀', foot: '응원 팀 명당 · WISH BOARD' };
  const n = Math.floor(Number(e.n) || 0).toLocaleString('en-US');
  const sub = e.why === 'gold' ? `오늘 9시 전까지 서로 다른 ${n}명이 응원했어요`
    : e.why === 'ann' ? (e.label || '오늘은 이 팀의 기념일') : e.why === 'hot' ? `어제 팀원 ${pct(e.rate)}가 응원했어요`
      : `어제 서로 다른 ${n}명이 응원했어요`;
  return { chip: WHY_CHIP[e.why] || '응원 팀', head: e.name, sub, foot: e.share > 1 ? `응원 팀 명당 · ${e.share}팀이 1분씩 번갈아` : '응원 팀 명당 · 포인트로 살 수 없는 자리' };
}
// The house notice of a prime screen with nothing scheduled: how it is earned. tier: the slot's class.
export function primeNotice(slot) {
  const S = String(slot);
  if (S.startsWith('MAIN_')) return { line1: '응원 팀 명당', line2: '하루에 서로 다른 1,000명', line3: '다음 날 메인 타워 1시간' };
  if (/^SUB_[1-4]A$/.test(S)) return { line1: '응원 팀 명당', line2: '하루에 서로 다른 100명', line3: '다음 날 이 큰 화면' };
  return { line1: '응원 팀 명당', line2: '하루에 서로 다른 30명', line3: '다음 날 이 화면' };
}

// ---- rankings ----------------------------------------------------------------------------------------------------------
// rows: today's counters [{ id, name, n, act, last }]. -> { today: by distinct supporters, rate: by participation (PRIME.minTeam+) }.
export function rankToday(rows, n = PRIME.rankN) {
  const list = byCount(rows);
  const today = list.slice(0, n).map((r, i) => ({ rank: i + 1, id: r.id, name: cleanName(r.name) || '응원 팀', n: r.n, goal: goalOf(r.n) }));
  const rated = list.map((r) => ({ ...r, rate: rateOf(r.n, r.act) })).filter((r) => r.rate != null)
    .sort((a, b) => b.rate - a.rate || b.n - a.n || a.last - b.last || byId(a, b));
  const rate = rated.slice(0, n).map((r, i) => ({ rank: i + 1, id: r.id, name: cleanName(r.name) || '응원 팀', n: r.n, act: r.act, rate: r.rate }));
  return { today, rate };
}
// This week's goals reached: rows [{ id, name, k }] (k: achievements this ISO week). Most first, then the id.
export function rankWeek(rows, n = PRIME.rankN) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({ id: String(r?.id || ''), name: cleanName(r?.name) || '응원 팀', k: Math.floor(Number(r?.k) || 0) }))
    .filter((r) => TEAM_ID.test(r.id) && r.k > 0).sort((a, b) => b.k - a.k || byId(a, b)).slice(0, n).map((r, i) => ({ rank: i + 1, ...r }));
}

// ---- errors ------------------------------------------------------------------------------------------------------------
export const TEAM_ERR = Object.freeze({
  auth: '입장한 뒤에 할 수 있어요.',
  name_empty: '팀 이름을 적어 주세요.',
  name_long: `팀 이름은 ${PRIME.nameMax}자까지예요.`,
  name_chars: '팀 이름에는 글자, 숫자, 띄어쓰기와 _ . · - & ! ♡ ★만 쓸 수 있어요. 링크는 넣을 수 없어요.',
  name_blocked: '그 이름은 쓸 수 없어요.',
  name_taken: '같은 이름의 팀이 이미 있어요. 그 팀에 들어가거나 다른 이름을 골라 주세요.',
  link: '팀은 계정을 연결한 뒤에 만들 수 있어요. 손님도 팀에 들어가고 볼 수는 있어요.',
  member: '이미 팀에 들어가 있어요. 한 번에 한 팀만 응원해요. 지금 팀에서 나온 뒤에 해 주세요.',
  none: '들어간 팀이 없어요. 팀을 만들거나 팀 페이지에서 들어가세요.',
  team: '그 팀을 찾지 못했어요.',
  hop: '팀을 나온 뒤 24시간이 지나야 다른 팀에 들어갈 수 있어요.',
  made: '오늘 이 인터넷 연결에서 만든 팀이 너무 많아요. 내일 다시 해 주세요.',
  owner: '팀을 만든 사람만 할 수 있어요.',
  md: '날짜를 다시 골라 주세요.',
  label: `기념일 이름은 ${PRIME.labelMax}자까지, 글자와 숫자로 적어 주세요.`,
  busy: '지금은 광장이 붐벼요. 잠시 뒤에 다시 해 주세요.',
  rate: '요청이 너무 잦아요. 1분 뒤에 다시 해 주세요.',
  op: '알 수 없는 요청이에요.',
  down: '지금은 팀을 불러오지 못했어요. 잠시 뒤에 다시 해 주세요.',
});
// Refusals of the claim path (worker.js): prime screens, a board someone else has lit, the closed 소속 claim and the 60 s cover.
export const BOARD_ERR = Object.freeze({
  prime: '명당(메인 타워와 코너 화면)은 포인트로 걸 수 없어요. 응원 팀이 목표를 채우면 다음 날 돌아가요.',
  held: '이 전광판은 지금 다른 사람이 걸어 두었어요. 걸린 기간이 끝나면 비고, 그때 걸 수 있어요.',
  mine: '이미 내 전광판이에요. 문구 고치기나 불 켜기를 써 주세요.',
  tribe: '소속 포인트로 걸기는 닫혔어요. 팀은 응원한 사람 수로 명당을 얻어요.',
  air: '모든 전광판에 60초 동안 올리기는 닫혔어요. 다른 사람의 전광판은 가리지 않아요.',
  plot: '이 땅은 지금 다른 사람이 쓰고 있어요. 마지막으로 짓거나 올린 뒤 30일이 지나면 비어요.',
  relight: '명당은 다시 켤 수 없어요. 걸린 기간이 끝나면 응원 팀 명당으로 돌아가요.',
});
/** A plot someone else holds stays theirs this long after its last purchase or upgrade (worker.js checks it before the RPC). */
export const PLOT_HOLD_MS = 30 * D;
