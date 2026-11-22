// 주간 돌아보기 카드: on the first entry of a KST ISO week (Monday 00:00 KST), a card with last week's numbers. Pure rules, no DOM (test/recap.test.mjs).
//
// What the browser keeps (localStorage kts_wk): { cur, prev }, one record per KST ISO week (the league's own week id, leagueWeek):
//   { w, days: ['YYYY-MM-DD', ...] days entered, claims: boards claimed, held: boards held when last looked, streak: attendance streak when last entered,
//     hearts: { <wish id>: most hearts seen on it } }
// A week that is over becomes `prev` the first time the browser looks in the next week; anything older than that is dropped, so the card
// only ever talks about last week. The card is for a browser that has a `prev` with something in it (days or claims): the answer to
// "was this player active last week" is known here, so nobody else costs a request. Shown once per week (kts_wk_shown = the week id the card was
// shown in). Only the league row (rank, coins spent) comes from the server (GET /rt/recap, one call, when the card is about to open).
import { leagueWeek } from './league.js';

export const RECAP_KEY = 'kts_wk';
export const RECAP_SHOWN_KEY = 'kts_wk_shown';
const DAYS_MAX = 7, HEARTS_MAX = 14;

export const weekOf = (t = Date.now()) => leagueWeek(t);
export const prevWeekOf = (t = Date.now()) => leagueWeek(t - 7 * 864e5);

const WEEK = /^\d{4}W\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const cnt = (v, max = 9999) => Math.max(0, Math.min(max, Math.floor(Number(v)) || 0));

export function emptyRec(w) { return { w: String(w), days: [], claims: 0, held: 0, streak: 0, hearts: {} }; }
function cleanRec(r) {
  if (!r || typeof r !== 'object' || !WEEK.test(String(r.w || ''))) return null;
  const hearts = {};
  if (r.hearts && typeof r.hearts === 'object') for (const [id, n] of Object.entries(r.hearts).slice(0, HEARTS_MAX)) if (/^[0-9a-z]{10}$/.test(id) && cnt(n) > 0) hearts[id] = cnt(n);
  return { w: r.w, days: [...new Set((Array.isArray(r.days) ? r.days : []).map(String).filter((d) => DAY.test(d)))].sort().slice(-DAYS_MAX), claims: cnt(r.claims), held: cnt(r.held, 99), streak: cnt(r.streak, 3650), hearts };
}

// The stored value (anything) read as { cur, prev } for the week of `now`: cur is this week's record, prev last week's or null.
export function rollWeeks(raw, now = Date.now()) {
  const w = weekOf(now), pw = prevWeekOf(now), s = raw && typeof raw === 'object' ? raw : {};
  let cur = cleanRec(s.cur), prev = cleanRec(s.prev);
  if (cur && cur.w !== w) { prev = cur.w === pw ? cur : prev; cur = null; }
  if (prev && prev.w !== pw) prev = null;
  return { cur: cur || emptyRec(w), prev };
}

// The note functions return the next stored value (a new object), or null when nothing changed (nothing to write).
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function change(raw, now, fn) {
  const before = rollWeeks(raw, now), next = { cur: { ...before.cur, hearts: { ...before.cur.hearts } }, prev: before.prev };
  fn(next.cur);
  next.cur = cleanRec(next.cur);
  // A roll alone (the stored value was last week's) is a change worth writing: it moves last week into `prev`.
  const stored = raw && typeof raw === 'object' ? { cur: cleanRec(raw.cur), prev: cleanRec(raw.prev) } : { cur: null, prev: null };
  return same(next, stored) ? null : next;
}
// A day entered (day = KST 'YYYY-MM-DD'), with the attendance streak as it stands then.
export function noteDay(raw, day, streak, now = Date.now()) {
  return change(raw, now, (c) => { if (DAY.test(String(day || '')) && !c.days.includes(day)) c.days.push(day); c.streak = cnt(streak, 3650) || c.streak; });
}
export function noteClaim(raw, now = Date.now()) { return change(raw, now, (c) => { c.claims = cnt(c.claims + 1); }); }
export function noteHeld(raw, n, now = Date.now()) { return change(raw, now, (c) => { c.held = cnt(n, 99); }); }
// mine: the player's wish of today as the wish board has it ({ id, hearts }). Only the most hearts seen on each wish counts.
export function noteHearts(raw, mine, now = Date.now()) {
  const id = String(mine?.id || ''), n = cnt(mine?.hearts);
  if (!/^[0-9a-z]{10}$/.test(id) || n < 1) return null;
  return change(raw, now, (c) => { if (n > (c.hearts[id] || 0)) c.hearts[id] = n; });
}

export const active = (rec) => !!rec && (rec.days.length > 0 || rec.claims > 0);
export const heartsOf = (rec) => Object.values(rec?.hearts || {}).reduce((a, n) => a + cnt(n), 0);

// Is last week's card due? Returns last week's record, or null. shown: kts_wk_shown. newbie: a newcomer gets no review of a week they did not have.
export function recapDue({ raw, shown, now = Date.now(), newbie } = {}) {
  if (newbie || String(shown || '') === weekOf(now)) return null;
  const { prev } = rollWeeks(raw, now);
  return active(prev) ? prev : null;
}

const n0 = (n) => Math.floor(Number(n) || 0).toLocaleString('en-US');
// The lines of the card. me (GET /rt/recap's row of the retired spend league) is no longer shown: a rank by points spent is a game's league
// (응원 순위 ranks teams by people, docs/prime-screens.md). The argument stays for callers from before.
export function recapLines(rec, me) {
  void me;
  const rows = [];
  if (rec.claims > 0) rows.push({ k: 'claims', label: '건 전광판', value: `${n0(rec.claims)}곳` });
  if (rec.held > 0) rows.push({ k: 'held', label: '내 전광판', value: `${n0(rec.held)}곳` });
  const hearts = heartsOf(rec);
  if (hearts > 0) rows.push({ k: 'hearts', label: '소원에 받은 하트', value: `${n0(hearts)}개` });
  if (rec.streak > 1) rows.push({ k: 'streak', label: '연속 출석', value: `${n0(rec.streak)}일` });
  else if (rec.days.length > 0) rows.push({ k: 'days', label: '들어온 날', value: `${n0(rec.days.length)}일` });
  return rows;
}
// The sentence the share button hands out (with the site link): numbers only, no names.
export function recapShareText(rec, me) {
  const parts = recapLines(rec, me).filter((r) => r.k !== 'held' && r.k !== 'days').map((r) => `${r.label} ${r.value}`);
  return parts.length ? `지난주 모두의 전광판 기록 · ${parts.join(' · ')}` : '지난주 모두의 전광판에 다녀갔어요';
}
