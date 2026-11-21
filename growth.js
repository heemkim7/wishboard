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
