// Growth funnel for admin.html (성장 퍼널). Pure: no DOM, no network. Input is `days` from GET /rt/admin/stats (newest first, each with `grow`).
// grow[i] counts, per KST day, the accounts (a guest linked to a user counts as the user; sessions without an account count one each) that fired
// a step's events: landing page_landing, enter enter_square, wish wish_post, share wish_share | share_link | share_send,
// land wish_land | focus_enter (arrived by a shared link), back return_visit (entered on a later day than the last attended one).
export const MIN_BASE = 20; // under this many in the base step, a percentage misleads: show a dash
// base: index of the step the percentage is measured against (-1 none). A share does not need a wish, and a return is measured on those who entered.
export const GROW_STEPS = Object.freeze([
  { key: 'landing', label: '방문(부팅)', base: -1 },
  { key: 'enter', label: '입장', base: 0 },
  { key: 'wish', label: '소원 걸기', base: 1 },
  { key: 'share', label: '공유', base: 1 },
  { key: 'land', label: '공유로 들어옴', base: 3 },
  { key: 'back', label: '재방문', base: 1 },
]);
export const dayShift = (day, n) => new Date(Date.parse(day) + n * 864e5).toISOString().slice(0, 10);
const isGrow = (g) => Array.isArray(g) && g.length === GROW_STEPS.length;
const num = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

// One column per calendar day, today first. A day the server has no row for had no events (zeros);
// a day folded before this funnel existed has a row without `grow` (null: unknown, left out of every sum).
export function growDays(days, today, n) {
  const by = new Map((Array.isArray(days) ? days : []).map((d) => [String(d?.day), d]));
  const out = [];
  for (let i = 0; i < n; i++) {
    const day = dayShift(today, -i), row = by.get(day);
    out.push({ day, counts: !row ? GROW_STEPS.map(() => 0) : isGrow(row.grow) ? row.grow.map(num) : null });
  }
  return out;
}
// Sum of the known days among the first n columns: { counts, known } (known = how many days had data).
export function growSum(cols, n) {
  const counts = GROW_STEPS.map(() => 0);
  let known = 0;
  for (const c of cols.slice(0, n)) if (c.counts) { known++; c.counts.forEach((v, i) => { counts[i] += v; }); }
  return { counts, known };
}
// Percentage of step i against its base step, or '—' when there is no base or the base is under MIN_BASE.
export function stepPct(counts, i) {
  const b = GROW_STEPS[i].base;
  if (b < 0) return '';
  const of = num(counts[b]);
  return of < MIN_BASE ? '—' : Math.round(num(counts[i]) / of * 100) + '%';
}

// ---- More per-day rows under the funnel (admin.html renderGrow), read from fields of the same /rt/admin/stats day rows:
// new / act_new (accounts first seen that day, and those of them that posted a wish, gave a heart, cheered a board or lit one),
// start_accounts / claim_accounts (opened the 전광판 걸기 wizard / published a board), links.<kind>.<people|auto> (share pages served),
// cheers.<paid|free> (cheers that landed paying points / after the day's paid cheers). base: the row a percentage is measured against.
export const DAY_ROWS = Object.freeze([
  { key: 'new', label: '신규 계정', base: '' },
  { key: 'act_new', label: '첫 행동 (소원·하트·응원·전광판)', base: 'new' },
  { key: 'start_accounts', label: '전광판 걸기 시작', base: '' },
  { key: 'claim_accounts', label: '전광판 걸기 완료', base: 'start_accounts' },
  { key: 'links.card.people', label: '전광판 카드 링크 열림 · 사람', base: '' },
  { key: 'links.card.auto', label: '전광판 카드 링크 열림 · 자동', base: '' },
  { key: 'links.wish.people', label: '소원 링크 열림 · 사람', base: '' },
  { key: 'links.wish.auto', label: '소원 링크 열림 · 자동', base: '' },
  { key: 'links.shot.people', label: '사진 링크 열림 · 사람', base: '' },
  { key: 'links.shot.auto', label: '사진 링크 열림 · 자동', base: '' },
  { key: 'cheers.paid', label: '응원 · 포인트 지급', base: '' },
  { key: 'cheers.free', label: '응원 · 포인트 없이', base: '' },
]);
// A field of a day row: a day with no row had nothing (0); a row without the field was folded before it existed (null: unknown).
export function dayVal(row, key) {
  if (!row) return 0;
  let v = row;
  for (const p of String(key).split('.')) { if (!v || typeof v !== 'object' || !(p in v)) return null; v = v[p]; }
  return num(v);
}
const dayCell = (v, b) => v == null ? '—' : b == null || num(b) < MIN_BASE ? String(v) : `${v} (${Math.round(v / num(b) * 100)}%)`;
// -> one row of text cells per DAY_ROWS entry: label, base label, the first `show` days (today first), then the 7- and 14-day sums of the known days.
export function dayTable(days, today, show = 7) {
  const by = new Map((Array.isArray(days) ? days : []).map((d) => [String(d?.day), d]));
  const cols = []; for (let i = 0; i < 14; i++) cols.push(by.get(dayShift(today, -i)) || null);
  const sum = (key, n) => { let s = 0, known = 0; for (const r of cols.slice(0, n)) { const v = dayVal(r, key); if (v != null) { s += v; known++; } } return known ? s : null; };
  const label = (key) => DAY_ROWS.find((r) => r.key === key)?.label || '';
  return DAY_ROWS.map((r) => [r.label, r.base ? label(r.base) : '',
    ...cols.slice(0, show).map((row) => dayCell(dayVal(row, r.key), r.base ? dayVal(row, r.base) : null)),
    dayCell(sum(r.key, 7), r.base ? sum(r.base, 7) : null), dayCell(sum(r.key, 14), r.base ? sum(r.base, 14) : null)]);
}

// ---- claim_start: the 전광판 걸기 wizard (ui.js openClaimStep) reports its opening once per open. Each open makes a fresh wizard model
// (ftue.js claimWizard); going back to step 1 with 이전 reuses it and sends nothing. -> the properties to send (the same kind board_claim
// carries: tier, plus kind starter | claim and where it was opened from), or null.
export function claimStarter(tierOf = () => '') {
  const seen = new WeakSet();
  return (model, from = '') => {
    if (!model || typeof model !== 'object' || seen.has(model)) return null;
    seen.add(model);
    const out = { tier: String(tierOf(model.slot) || ''), kind: model.free ? 'starter' : 'claim' };
    if (from) out.from = String(from);
    return out;
  };
}

// ---- return_visit: decided from the day record the browser keeps in kts_daily ({ day, last, back, backSent, ... }).
export const daysBetween = (a, b) => { const n = Math.round((Date.parse(b) - Date.parse(a)) / 864e5); return n > 0 ? Math.min(n, 365) : 0; };
// back/backSent for the day record of `day`, from the stored record `prev`. On a later day than the stored one, back = days since its `last`
// (0 when there is no record, no `last`, or `last` is not before today); on the same day both are carried over (a record from an older build has none: 0).
export function backFields(prev, day) {
  const p = prev && typeof prev === 'object' ? prev : {};
  if (p.day !== day) return { back: daysBetween(p.last, day), backSent: 0 };
  return { back: Number(p.back) > 0 ? Math.min(Math.floor(Number(p.back)), 365) : 0, backSent: p.backSent ? 1 : 0 };
}
// The gap (days) to report as return_visit, or 0 for "send nothing". mine = this tab's record, stored = kts_daily as read just now
// (another tab may have sent today's already), day = today in KST.
export function returnGap(mine, stored, day) {
  if (!mine || !(Number(mine.back) > 0) || mine.backSent) return 0;
  if (stored && typeof stored === 'object' && stored.day === day && stored.backSent) return 0;
  return Math.min(Math.floor(Number(mine.back)), 365);
}
