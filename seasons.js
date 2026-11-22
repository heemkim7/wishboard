// 계절 소원 테마 (launch plan 하1): which holiday theme a KST day has, and the copy and colours that go with it.
// Pure rules shared by the browser, the Worker and the tests (no I/O, no clock: every function takes a KST day 'YYYY-MM-DD').
// The Worker bundles this file, so every import of it is written without a ?v= query.
//
// Where the day comes from: callers use the shared KST helpers (ftue.js kstDay in the browser, wish.js wishDay in tests).
// Where the admin override comes from: the ops calendar (admin.html 운영 달력 -> POST /rt/admin/ops -> ops_events -> plaza_live
// -> /rt/world `ops`). The one event that covers today carries its `theme`; the client hands that to seasonKey as `adminTheme`.
// An admin theme wins over the built-in table, and the admin theme 'none' switches the built-in theme off for those days.

/** Priority order: when two built-in windows cover the same day, the earlier key wins. */
export const SEASON_KEYS = Object.freeze(['csat', 'seollal', 'chuseok', 'xmas', 'newyear', 'valentine', 'pepero', 'children']);
/** What the ops calendar may store as a theme: a season key, or 'none' (no seasonal look, the line still shows). */
export const OPS_THEME_KEYS = Object.freeze([...SEASON_KEYS, 'none']);

// Fixed solar days, KST, inclusive. A window with from > to runs over New Year (12-31 .. 01-02).
const FIXED = Object.freeze({
  xmas: ['12-20', '12-25'],
  newyear: ['12-31', '01-02'],
  valentine: ['02-14', '02-14'],
  pepero: ['11-11', '11-11'],
  children: ['05-05', '05-05'],
});
// Lunar holidays have no formula here: the solar date of the day itself, 2026-2028 (a year that is not listed has no such theme).
// 수능 is the Thursday of the 3rd week of November, so CSAT keeps the same table and csatDay() below covers any other year.
export const LUNAR = Object.freeze({
  seollal: Object.freeze({ 2026: '2026-02-17', 2027: '2027-02-06', 2028: '2028-01-26' }),
  chuseok: Object.freeze({ 2026: '2026-09-25', 2027: '2027-09-15', 2028: '2028-10-03' }),
  csat: Object.freeze({ 2026: '2026-11-19', 2027: '2027-11-18', 2028: '2028-11-16' }),
});
// Days around the day itself: [before, after]. The 수능 run-up (five days, so 빼빼로데이 on 11/11 stays free in 2026 and 2027) up to the day after the test; the holidays from three days before to the day after.
const AROUND = Object.freeze({ csat: [5, 1], seollal: [3, 1], chuseok: [3, 1] });

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');
const toDays = (day) => Math.round(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 864e5);
const fromDays = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
/** day shifted by n whole days (calendar days: no time zone is involved). */
export function addDays(day, n) { return fromDays(toDays(day) + n); }

/** The 수능 day of a year that is not in the table: the one Thursday between Nov 13 and Nov 19 (2021 to 2026 all fall there). */
export function csatDay(year) {
  const y = Math.floor(Number(year));
  if (LUNAR.csat[y]) return LUNAR.csat[y];
  const dow = new Date(Date.UTC(y, 10, 13)).getUTCDay(); // 0 Sunday .. 4 Thursday
  return y + '-11-' + pad(13 + ((4 - dow + 7) % 7));
}

/** The window of a built-in season that starts in `year`: [firstDay, lastDay], or null (a lunar year outside the table). */
export function seasonWindow(key, year) {
  const y = Math.floor(Number(year));
  if (FIXED[key]) {
    const [from, to] = FIXED[key];
    return [y + '-' + from, (to < from ? y + 1 : y) + '-' + to];
  }
  const at = key === 'csat' ? csatDay(y) : LUNAR[key]?.[y];
  if (!at) return null;
  const [before, after] = AROUND[key];
  return [addDays(at, -before), addDays(at, after)];
}

/** The built-in season of a KST day: a key of SEASON_KEYS, or '' (also for anything that is not a 'YYYY-MM-DD'). */
export function builtinSeason(day) {
  if (!DAY_RE.test(String(day))) return '';
  const y = +day.slice(0, 4);
  for (const key of SEASON_KEYS) {
    for (const yr of [y - 1, y]) { // a window that starts last year can still cover early January
      const w = seasonWindow(key, yr);
      if (w && day >= w[0] && day <= w[1]) return key;
    }
  }
  return '';
}

/** The season key of a KST day with the ops calendar on top: adminTheme is the `theme` of the ops event that covers the day
 *  (`ops.theme` of /rt/world). A season key wins over the built-in table, 'none' turns the built-in theme off, anything else
 *  (missing, an unknown word) leaves the built-in table in charge. */
export function seasonKey(day, adminTheme) {
  const a = String(adminTheme || '');
  if (SEASON_KEYS.includes(a)) return a;
  if (a === 'none') return '';
  return builtinSeason(day);
}

/** `?season=<key>` on the address bar: a look-only preview of one theme in this browser ('none' for no theme). undefined when absent or not a key. */
export function seasonPreview(search) {
  let v = '';
  try { v = String(new URLSearchParams(String(search || '')).get('season') || ''); } catch { v = ''; }
  return OPS_THEME_KEYS.includes(v) ? v : undefined;
}

// Per season. chip: the short label on a wish card (with the emoji). header: the line on top of the wish sheet.
// chips: three example wishes (each at most 24 code points, free of links and numbers, so wish.js takes them as they are).
// boot: the optional line on the boot card. accent/accent2: the card's neon pair on the navy panel (white wish text stays on top).
export const SEASONS = Object.freeze({
  csat: Object.freeze({ emoji: '📝', chip: '수능 응원', header: '수능 응원 소원 — 수험생에게 힘이 되는 한 줄을 걸어 주세요', chips: Object.freeze(['수능 대박 나게 해 주세요', '끝까지 침착하게 풀기', '다 끝나면 푹 쉬고 싶어요']), boot: '📝 수능 응원 기간이에요. 수험생에게 힘이 되는 소원 한 줄을 걸어 보세요.', accent: '#ffd84a', accent2: '#ff8a3d' }),
  seollal: Object.freeze({ emoji: '🎎', chip: '설날', header: '설날 소원 — 새해 복과 함께 빌고 싶은 한 줄은?', chips: Object.freeze(['가족 모두 건강하게', '올해는 좋은 일만 가득', '세뱃돈 많이 받게 해 주세요']), boot: '🎎 설 연휴예요. 소원 한 줄 걸고 새해 복 받아 가세요.', accent: '#ff6b81', accent2: '#48d6f0' }),
  chuseok: Object.freeze({ emoji: '🌕', chip: '추석', header: '추석 소원 — 보름달에 빌고 싶은 한 줄은?', chips: Object.freeze(['보름달아 내 소원 들어줘', '온 가족 한자리에 모이길', '연휴가 한 달이면 좋겠다']), boot: '🌕 추석 연휴예요. 보름달에 소원 한 줄 걸어 보세요.', accent: '#ffcf5a', accent2: '#8be28b' }),
  xmas: Object.freeze({ emoji: '🎄', chip: '크리스마스', header: '크리스마스 소원 — 올해 산타에게 빌고 싶은 한 줄은?', chips: Object.freeze(['눈 오는 크리스마스 보내기', '산타가 내 소원 들어주길', '좋아하는 사람이랑 함께']), boot: '🎄 크리스마스 주간이에요. 소원 한 줄 걸어 보세요.', accent: '#ff5a66', accent2: '#3ee08f' }),
  newyear: Object.freeze({ emoji: '🎆', chip: '새해', header: '새해 소원 — 새해에 이루고 싶은 한 줄을 걸어 주세요', chips: Object.freeze(['새해엔 꼭 건강하자', '올해는 꼭 합격', '작년보다 행복한 한 해']), boot: '🎆 새해맞이 소원을 걸어 보세요.', accent: '#ffcf5a', accent2: '#ff4fa3' }),
  valentine: Object.freeze({ emoji: '💝', chip: '발렌타인', header: '발렌타인 소원 — 마음을 전하고 싶은 한 줄은?', chips: Object.freeze(['좋아하는 마음 전하기', '초콜릿 많이 받고 싶다', '우리 오래오래 함께하자']), boot: '💝 발렌타인데이예요. 마음 담은 소원 한 줄 걸어 보세요.', accent: '#ff4fa3', accent2: '#ff9ccf' }),
  pepero: Object.freeze({ emoji: '🍫', chip: '빼빼로데이', header: '빼빼로데이 소원 — 달콤한 한 줄을 걸어 주세요', chips: Object.freeze(['빼빼로 많이 받고 싶어요', '좋아하는 사람이랑 나눠 먹기', '달콤한 하루 보내자']), boot: '🍫 오늘은 빼빼로데이! 달콤한 소원 한 줄 걸어 보세요.', accent: '#ff7a3d', accent2: '#d9a066' }),
  children: Object.freeze({ emoji: '🎈', chip: '어린이날', header: '어린이날 소원 — 마음만은 어린이! 한 줄을 걸어 주세요', chips: Object.freeze(['마음만은 영원한 어린이', '어린이날 선물 받고 싶다', '놀이공원 가고 싶어요']), boot: '🎈 어린이날이에요. 소원 한 줄 걸어 보세요.', accent: '#48d6f0', accent2: '#ffd84a' }),
});

/** The season of a KST day (admin override first) as { key, ...SEASONS[key] }, or null on a day with no theme. */
export function seasonFor(day, adminTheme) {
  const key = seasonKey(day, adminTheme);
  return key ? { key, ...SEASONS[key] } : null;
}
