// 홈 화면 추가 유도: when to offer "add to home screen", and with which words. Pure rules, no DOM (test/install.test.mjs); ui.js draws the card.
//
// One offer per browser, ever (kts_a2hs). It needs all of:
//   - an installable browser: Chrome/Edge/Android hand us `beforeinstallprompt` (index.html keeps the event as window.__ktsInstall),
//     or this is iOS Safari, which has no such event, so the card only shows the Share → 홈 화면에 추가 steps;
//   - not already running as an installed app (display-mode standalone, navigator.standalone);
//   - the 2nd day of visiting or later (kts_visits counts KST days, not page loads, so a reload is not a second visit);
//   - the player did something meaningful in this visit: a first wish, a claim, or 3 minutes in the plaza;
//   - a quiet screen (ui.js passes `busy`: a sheet, a celebration, the focus camera, bake/dance ... any of its screenBusy cases), and not a newcomer.
export const A2HS_KEY = 'kts_a2hs'; // set once the card has been shown or the app was installed; never cleared
export const VISITS_KEY = 'kts_visits'; // { n: days visited, last: 'YYYY-MM-DD' }
export const MIN_VISITS = 2;
export const MIN_PLAY_MS = 3 * 60e3;

// Counts the KST day once. A record from an older build (or junk) starts again from one visit.
export function bumpVisits(rec, day) {
  const d = String(day || '');
  const r = rec && typeof rec === 'object' ? rec : {};
  const n = Math.max(0, Math.min(9999, Math.floor(Number(r.n)) || 0));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { n, last: String(r.last || '') };
  if (r.last === d && n > 0) return { n, last: d };
  return { n: n + 1, last: d };
}

// Installed already: the display-mode media query (Chrome, Edge, Android, desktop PWA) or iOS's navigator.standalone.
export function isStandalone(win = typeof window === 'undefined' ? null : window) {
  try {
    if (!win) return false;
    if (win.navigator && win.navigator.standalone === true) return true;
    for (const m of ['standalone', 'fullscreen', 'minimal-ui']) if (win.matchMedia && win.matchMedia(`(display-mode: ${m})`).matches) return true;
  } catch { /* no media queries here */ }
  return false;
}

// iOS Safari itself: an iPhone or iPad (iPadOS says "Macintosh" but has touch points), WebKit, and none of the other browsers or in-app views
// that carry their own idea of Share. The "홈 화면에 추가" steps are only right in Safari.
export function isIosSafari(ua, maxTouchPoints = 0) {
  const s = String(ua || '');
  const ios = /iPhone|iPad|iPod/.test(s) || (/Macintosh/.test(s) && Number(maxTouchPoints) > 1);
  if (!ios || !/Safari\//.test(s) || !/AppleWebKit/.test(s)) return false;
  return !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|GSA\/|KAKAOTALK|NAVER|Instagram|FBAN|FBAV|FB_IAB|Line\/|Daum|Whale|SamsungBrowser/i.test(s);
}

// 'prompt' (a captured beforeinstallprompt event: the 추가 button opens the browser's own dialog), 'ios' (steps only), '' (nothing to offer).
export function installMode({ standalone, event, ios } = {}) {
  if (standalone) return '';
  if (event && typeof event.prompt === 'function') return 'prompt';
  return ios ? 'ios' : '';
}

// Has the player done something worth a "come back easily" card in this visit? act: { wish, claim } (set when they happened), playMs: time since entering.
export function meaningful({ wish, claim, playMs } = {}) {
  return !!wish || !!claim || Number(playMs) >= MIN_PLAY_MS;
}

// Show the card now? done: kts_a2hs has a value. visits: the kts_visits record.
export function installDue({ mode, done, visits, act, playMs, busy, newbie } = {}) {
  if (!mode || done || busy || newbie) return false;
  if (!(Math.floor(Number(visits?.n)) >= MIN_VISITS)) return false;
  return meaningful({ wish: act?.wish, claim: act?.claim, playMs });
}

// The words on the card.
export const INSTALL_COPY = Object.freeze({
  title: '홈 화면에 추가하면 바로 들어올 수 있어요',
  add: '추가',
  later: '나중에',
  ios: '아래 공유 버튼을 누르고 ‘홈 화면에 추가’를 골라 주세요',
  iosSteps: Object.freeze(['Safari의 공유 버튼(네모에 위쪽 화살표) 누르기', '‘홈 화면에 추가’ 고르기', '오른쪽 위 ‘추가’ 누르기']),
  iosOk: '알겠어요',
});
