// 오늘 할 일 (docs/superpowers/specs/2026-11-24-today-todo-design.md): the day's list built from the signals the plaza already has
// (kts_daily, the wish state, the team state, the pays), its progress, the next row, the phone pill, the notice words, the week's
// stamps and the once-a-day "all done" moment. No DOM, no storage, no clock: ui.js and main.js hand in the day (KST 'YYYY-MM-DD')
// and draw. It adds no point source: the values are the pays that already exist (BONUS attend/mission, QUEST cheer).

export const TODO = Object.freeze({
  cheerNeed: 3,    // 전광판 응원 3번 (QUEST cheer)
  cheerPts: 45,    // 15 on the first cheer (BONUS mission) + 30 on the third (QUEST cheer): today's pays, unchanged
  wishPts: 15,     // BONUS mission
  heartPts: 15,    // BONUS mission
  nameMax: 12,     // the card's name, in code points (as the welcome card)
  keepDays: 14,    // stamps kept on the device
  cardMs: 8000,    // the card on a street screen (as the welcome card)
  payWaitMs: 10000, // a finished row's notice waits this long at most for its pay (QUEST cheer, BONUS mission); then it says no points
});
export const TODO_TEXT = Object.freeze({
  title: '오늘 할 일',
  sub: '매일 0시에 새로 시작해요',
  week: '이번 주 도장',
  gift: '이번 주 · 친구에게 선물 전광판 걸어 주기',
  chip: '🎉 오늘 할 일 완료',
  bye: '내일 또 만나요',
  teamValue: '팀 기록',
  cheerWait: '지금은 응원할 전광판이 없어요', // the cheer row while nobody else's board is lit (todoList cheerOpen false)
  cheerNone: '지금은 켜진 남의 전광판이 없어요. 누가 전광판을 켜면 응원할 수 있어요', // its tap: no waypoint (ui.js guideQuest)
});
const WD = ['월', '화', '수', '목', '금', '토', '일'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const int = (n) => Math.max(0, Math.floor(Number(n) || 0));
const cut = (s, n) => Array.from(String(s ?? '').trim()).slice(0, n).join('').trim();

// ---- days (KST 'YYYY-MM-DD', computed in UTC so the host's zone never matters) ----------------------------------------------
export function dayAdd(day, n) {
  if (!DAY_RE.test(String(day))) return '';
  const [y, m, d] = String(day).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + Math.trunc(Number(n) || 0))).toISOString().slice(0, 10);
}
/** The Monday of day's week (KST weeks run Monday to Sunday). */
export function weekStart(day) {
  if (!DAY_RE.test(String(day))) return '';
  const [y, m, d] = String(day).split('-').map(Number);
  return dayAdd(day, -((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7));
}

// ---- the list ---------------------------------------------------------------------------------------------------------------
/** s: { attendPts, cheer (today's landed cheers), cheerDone (qPaid.cheer, the server's qc), cheerOpen (false: no lit board of someone
 *  else to cheer now, the only cheer worker.js Room.cheer counts; null while the boards are not in; left out: open), wish / heart (true,
 *  false, or null when not known yet), team (null while it is being decided, false when teams are not usable now, else { has: a team of
 *  mine, done: today's cheer for it is on record }) }. -> rows in the spec's order: { id, name, label, value, pts, done, known, wait?,
 *  why?, n?, need? }. team is a row only when { has, done } came: without it N is 4. A cheer row not done while cheerOpen is false waits
 *  (wait, why): it stays on the list with its pays, is not counted in n/N, is never the next row and is not known (no notice). */
export function todoList(s = {}) {
  const n = Math.min(TODO.cheerNeed, int(s.cheer));
  const cheerDone = !!s.cheerDone || n >= TODO.cheerNeed;
  const cheerWait = s.cheerOpen === false && !cheerDone;
  const rows = [
    { id: 'attend', name: '출석', value: `+${int(s.attendPts)}`, pts: int(s.attendPts), done: true, known: true },
    { id: 'cheer', name: '전광판 응원 3번', value: `+${TODO.cheerPts}`, pts: TODO.cheerPts, done: cheerDone, known: !cheerWait, n: cheerDone ? TODO.cheerNeed : n, need: TODO.cheerNeed, ...(cheerWait ? { wait: true, why: TODO_TEXT.cheerWait } : {}) },
    { id: 'wish', name: '소원 한 줄 걸기', value: `+${TODO.wishPts}`, pts: TODO.wishPts, done: s.wish === true, known: s.wish === true || s.wish === false },
    { id: 'heart', name: '소원에 하트 1개', value: `+${TODO.heartPts}`, pts: TODO.heartPts, done: s.heart === true, known: s.heart === true || s.heart === false },
  ];
  if (s.team && typeof s.team === 'object') rows.push({ id: 'team', name: s.team.has ? '우리 팀 응원하기' : '응원 팀 고르기', value: TODO_TEXT.teamValue, pts: 0, done: !!(s.team.has && s.team.done), known: true });
  for (const r of rows) r.label = r.id === 'cheer' && !r.done && r.n > 0 ? `${r.name} (${r.n}/${r.need})` : r.name;
  return rows;
}
/** Every signal is in: the team was decided (in or out), the wish rows are known and the boards are in (cheerOpen not null). Only
 *  then can "all done" be said. */
export function todoSettled(s = {}) {
  return s.team !== null && s.team !== undefined && (s.wish === true || s.wish === false) && (s.heart === true || s.heart === false) && s.cheerOpen !== null;
}
/** n / N over the rows that can be done now: a waiting row (the cheer row with nothing to cheer) is not counted. */
export function todoProgress(list = []) {
  const rows = list.filter((r) => !r.wait);
  const N = rows.length, n = rows.filter((r) => r.done).length;
  return { n, N, all: N > 0 && n === N, frac: N ? n / N : 0 };
}
/** The next row to do: the first one not done and not waiting (the card's highlighted row, the pill, the notice's 다음). */
export function todoNext(list = []) { return list.find((r) => !r.done && !r.wait) || null; }

// ---- what changed ------------------------------------------------------------------------------------------------------------
/** { id: true (done) | false (known, not done) | null (not known) } for todoDiff. */
export function todoSnap(list = []) {
  const o = {};
  for (const r of list) o[r.id] = r.done ? true : r.known ? false : null;
  return o;
}
/** Rows finished between two snapshots: only a row seen not done and now done. A row that comes in already done (the wish list
 *  answering late, the team decided, a reload) was not finished just now and says nothing. */
export function todoDiff(prev = {}, next = {}) {
  return Object.keys(next).filter((id) => prev[id] === false && next[id] === true);
}
/** The whole-list moment is due: all rows done with every signal in, not yet had today on this device, and some row was seen open
 *  in this session (all done on arrival, e.g. finished on another device, is a gold stamp and no moment). */
export function allDue({ list = [], settled = false, day = '', allDay = '', sawOpen = false } = {}) {
  return !!day && settled && sawOpen && allDay !== day && todoProgress(list).all;
}
/** The card and the camera wait while something else has the screen: a lighting ceremony, a gift film being recorded, the lounge,
 *  a taxi ride, a bake round, the claim's proof bar, a sheet or a layer, a board focus or the photo frame (focus), an auto-walk (walk),
 *  the entry intro (intro), any scripted camera (cine: a focus link, a tour). 같이 춤추기 does not hold it. The notice and the stamp never wait. */
export function momentHold(o = {}) {
  return !!(o.cer || o.rec || o.lounge || o.driving || o.busy || o.baking || o.proof || o.focus || o.walk || o.intro || o.cine);
}

// ---- words ------------------------------------------------------------------------------------------------------------------
/** A finished row: '✓ 소원 한 줄 걸기 · +15 포인트 · 다음: 소원에 하트 1개'. pts: the points that arrived for it (the pays' own amounts),
 *  never the row's nominal value: a row finished with no pay (refused, paid on another device, offline, the team row) says none.
 *  No 다음 when nothing is left. */
export function itemNote(row, next, pts = 0) {
  if (!row) return '';
  return `✓ ${row.name}` + (int(pts) > 0 ? ` · +${int(pts)} 포인트` : '') + (next ? ` · 다음: ${next.name}` : '');
}
export function allNote(streak) { return `🎉 오늘 할 일을 다 했어요 · 출석 ${Math.max(1, int(streak))}일`; }
/** The day's attendance pay (PAY attend): '출석 3일 · +15 포인트 · 다음: 전광판 응원 3번'. */
export function attendNote(streak, pts, next) {
  return `출석 ${Math.max(1, int(streak))}일` + (int(pts) > 0 ? ` · +${int(pts)} 포인트` : '') + (next ? ` · 다음: ${next.name}` : '');
}
/** The line under the card and the sheet's list. */
export function footLine({ all = false, streak = 0, tomorrow = 0 } = {}) {
  return all ? `오늘 할 일을 다 했어요 · 내일 오면 +${int(tomorrow)}` : `출석 ${int(streak)}일 · 내일 오면 +${int(tomorrow)}`;
}
/** The street-screen card: the welcome card's chip, name and bottom line (giftart.js paintWelcome) and the near screen's strip. */
export function cardText(nick, streak) {
  const name = cut(nick, TODO.nameMax);
  return { chip: TODO_TEXT.chip, name, line: `출석 ${Math.max(1, int(streak))}일째 · ${TODO_TEXT.bye}`, strip: `${name || '오늘'}님, 오늘 할 일을 다 했어요` };
}
/** The phone's goal pill, in the spec's order: (1) no board and a free slot open: the first board comes first (the goal's own words);
 *  (2) rows left: '할 일 n/N · <next>'; (3) all done: '오늘 할 일 완료 · 출석 N일' for the session it was done in (doneHere), else the goal.
 *  known: the goal line may be decided (overlay.js goalKnown); before that nothing shows. -> { kind: 'none'|'goal'|'todo'|'done', text, tag, rest }. */
export function pillPlan({ known = false, held = 0, freeOpen = false, goal = '', list = [], doneHere = false, streak = 0 } = {}) {
  const none = { kind: 'none', text: '', tag: '', rest: '' };
  if (!known) return none;
  const g = String(goal || '');
  const asGoal = () => (g ? { kind: 'goal', text: g, tag: '', rest: g } : none);
  if (!(held > 0) && freeOpen) return asGoal();
  const p = todoProgress(list), next = todoNext(list);
  if (next) { const rest = `${p.n}/${p.N} · ${next.name}`; return { kind: 'todo', text: `할 일 ${rest}`, tag: '할 일', rest }; }
  if (p.all && doneHere) { const rest = `완료 · 출석 ${Math.max(1, int(streak))}일`; return { kind: 'done', text: `오늘 할 일 ${rest}`, tag: '오늘 할 일', rest }; }
  return asGoal();
}

// ---- the week's stamps (kept on the device, next to kts_daily) --------------------------------------------------------------
/** stamps: { 'YYYY-MM-DD': 1 attended | 2 all done }, cut to the last TODO.keepDays days up to `day` (nothing later, nothing malformed). */
export function keepStamps(stamps, day) {
  const out = {}, from = dayAdd(day, -(TODO.keepDays - 1));
  if (!from || !stamps || typeof stamps !== 'object') return out;
  for (const [d, v] of Object.entries(stamps)) {
    const lv = int(v);
    if (DAY_RE.test(d) && d >= from && d <= day && lv > 0) out[d] = Math.min(2, lv);
  }
  return out;
}
/** stamps with day raised to level (never lowered). */
export function markStamp(stamps, day, level) {
  const out = keepStamps(stamps, day);
  if (DAY_RE.test(String(day))) out[day] = Math.max(out[day] || 0, Math.min(2, int(level)));
  return out;
}
/** Seven cells, Monday to Sunday of day's week: { day, wd, state } with state 'all' (gold: all done), 'attend' (pale: attended),
 *  'today' (dashed: today, not all done yet), 'none' (a past day without a visit) or 'later'. Days before the stamps were kept come
 *  from the attendance streak (last and the streak-1 days before it). */
export function stampRow({ day = '', stamps = {}, streak = 0, last = '' } = {}) {
  const mon = weekStart(day);
  if (!mon) return [];
  const kept = keepStamps(stamps, day), run = int(streak), lastOk = DAY_RE.test(String(last)) ? String(last) : '';
  const first = lastOk && run > 0 ? dayAdd(lastOk, -(run - 1)) : '';
  return WD.map((wd, i) => {
    const d = dayAdd(mon, i);
    const lv = Math.max(kept[d] || 0, first && d >= first && d <= lastOk ? 1 : 0);
    const state = d > day ? 'later' : lv >= 2 ? 'all' : d === day ? 'today' : lv >= 1 ? 'attend' : 'none';
    return { day: d, wd, state };
  });
}
/** A cell's name for a screen reader: '월요일 · 다 했어요'. */
export function stampName(c) {
  const what = { all: '오늘 할 일을 다 했어요', attend: '출석했어요', today: '오늘', none: '오지 않았어요', later: '아직' }[c?.state] || '';
  return `${c?.wd || ''}요일${what ? ' · ' + what : ''}`;
}

// ---- the week's gift suggestion (not counted in n/N) ------------------------------------------------------------------------
/** mine: kts_gmine as the gift pages keep it (newest first, ids only, no dates). seen: the ids this plaza saw before, or null on the
 *  first look (then nothing is new: a board made before is no board made this week). -> { seen, fresh } with fresh true when a board
 *  appeared since. */
export function giftSeen(seen, mine) {
  const ids = (Array.isArray(mine) ? mine : []).map(String).filter((x) => /^[0-9a-z]{8}$/.test(x)).slice(0, 30);
  if (!Array.isArray(seen)) return { seen: ids, fresh: false };
  const had = new Set(seen.map(String));
  return { seen: ids, fresh: ids.some((x) => !had.has(x)) };
}
/** The suggestion is ticked: a gift board was made on this device this week (gw: the Monday of the week it was last seen made). */
export function giftDone(gw, day) { return !!gw && gw === weekStart(day); }

// ---- what kts_daily keeps across days for this list -------------------------------------------------------------------------
export function todoKeep(prev, day) {
  const p = prev && typeof prev === 'object' ? prev : {};
  return {
    stamps: keepStamps(p.stamps, day),
    allDay: String(p.allDay || '') === day ? day : '',   // the day the whole-list moment was said (notice and stamp)
    cardDay: String(p.cardDay || '') === day ? day : '', // the day its street-screen card was shown
    gw: DAY_RE.test(String(p.gw || '')) ? String(p.gw) : '',
    gs: Array.isArray(p.gs) ? p.gs.map(String).slice(0, 30) : null,
  };
}
