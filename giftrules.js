// 선물 전광판 (gift billboard): the pure rules shared by the Worker (giftsrv.js), the light pages (giftpage.js), the plaza
// (gift.js, ts3d/screens.js) and the tests. No I/O. The Worker bundles this module, so it is imported with no query everywhere.
//
// A gift board hangs on one ordinary plaza screen for GIFT.hours on a KST day the sender picks (today, or up to GIFT.aheadDays
// ahead). Ordinary screens are the street and lot boards (GIFT_SCREENS): never the main tower (MAIN_*), never the corner towers
// (SUB_*, the prime screens another part owns) and never the ad screens (AD_1..AD_5, not claimable at all).
// Scheduling: each new board goes to the screen with the fewest boards overlapping its window (ties: pool order, the screens
// nearest the plaza first), at most GIFT.perScreen at once on one screen. Boards that share a screen take turns of GIFT.cycleMs
// by the wall clock, so every viewer sees the same board at the same moment and every board gets the same share of the screen.
// A screen a player has lit keeps its own content: the plaza moves that screen's gifts to the least-loaded free screen
// (placeGifts), so a gift is never hidden by a claim and never covers one.
import { wishFault, wishNickFault } from './wish.js';

export const GIFT = Object.freeze({
  hours: 6, // the free tier's 6 hours
  aheadDays: 30, // the day: today or up to 30 days ahead (KST)
  starts: Object.freeze([9, 12, 15, 18]), // the KST hours a later window may start at (18: until midnight)
  nowStep: 600000, // a "지금" window starts at now, rounded down to 10 minutes
  perScreen: 4, // boards on one screen at once
  cycleMs: 9000, // one board's turn on a shared screen
  toMax: 12, fromMax: 12, msgMax: 40, // code points
  dayPerActor: 3, dayPerNet: 10, // new boards per account / per network (IPv6 by /64) and KST day
  liveMax: 160, // boards in /rt/world at once
  keepDays: 7, // the privacy policy: the page, its 롤링페이퍼 and its stored video go 7 days after the day (KST) is over
  optinDays: 60, // "열리면 알림" opt-ins not renewed for 60 days are pruned (the push subscriptions have the same 60 days)
  quiet: Object.freeze([21, 8]), // advertising pushes ("(광고)") are never sent from 21:00 to 08:00 KST
  paper: Object.freeze({ max: 30, perWriter: 3, perNetDay: 10, nickMax: 10, txtMax: 60 }), // 롤링페이퍼: per board, per writer (account or guest), per network and day
  report: 3, // reports from this many networks hide a board or a message
  video: Object.freeze({ max: 8000000, min: 20000, perBoard: 3, perNetDay: 10, ms: 15000 }),
  seenBatch: 25, seenMs: 30000, // beacons kept in an isolate before one DO call
  idLen: 8,
});

export const GIFT_ID = /^[0-9a-z]{8}$/;
export const PAPER_ID = /^[0-9a-z]{6}$/;
export const VISITOR_ID = /^[0-9a-f]{16,32}$/;

// The line a reply board (답장 전광판) starts with; 고마움's hint is the same words.
export const REPLY_MSG = '덕분에 행복했어, 고마워!';
export const OCCASIONS = Object.freeze({
  bday: Object.freeze({ name: '생일', head: '생일 축하해요', emoji: '🎂', th: 'party', hint: '태어나 줘서 고마워!' }),
  anniv: Object.freeze({ name: '기념일', head: '기념일 축하해요', emoji: '💐', th: 'rose', hint: '함께라서 행복해' }),
  pass: Object.freeze({ name: '합격', head: '합격 축하해요', emoji: '🎓', th: 'gold', hint: '고생 많았어, 정말 축하해!' }),
  cheer: Object.freeze({ name: '응원', head: '언제나 응원해요', emoji: '📣', th: 'sky', hint: '넌 할 수 있어!' }),
  just: Object.freeze({ name: '그냥', head: '그냥 생각나서', emoji: '💌', th: 'mint', hint: '오늘도 좋은 하루 보내' }),
  thanks: Object.freeze({ name: '고마움', head: '정말 고마워요', emoji: '🙏', th: 'rose', hint: REPLY_MSG }),
});
export const OCC_KEYS = Object.freeze(Object.keys(OCCASIONS));

// a, b: the gradient; ink: the text; hi: the accent (To. line, chips); deep: the frame.
export const GIFT_THEMES = Object.freeze({
  party: Object.freeze({ name: '파티', a: '#ff4fa3', b: '#5b21ff', ink: '#fff7fb', hi: '#ffe08a', deep: '#22063f' }),
  rose: Object.freeze({ name: '로즈', a: '#ff8a9a', b: '#9d174d', ink: '#fff5f6', hi: '#ffe3a3', deep: '#3a0a1f' }),
  gold: Object.freeze({ name: '골드', a: '#ffd36b', b: '#c2410c', ink: '#fffaf0', hi: '#fff3c4', deep: '#3b1503' }),
  sky: Object.freeze({ name: '하늘', a: '#38bdf8', b: '#4338ca', ink: '#f4fbff', hi: '#fde68a', deep: '#0b1442' }),
  mint: Object.freeze({ name: '민트', a: '#34d399', b: '#0e7490', ink: '#f2fffb', hi: '#fef08a', deep: '#062a2e' }),
  night: Object.freeze({ name: '밤하늘', a: '#312e81', b: '#020617', ink: '#eef2ff', hi: '#facc15', deep: '#01030d' }),
});
export const THEME_KEYS = Object.freeze(Object.keys(GIFT_THEMES));

// E1 (유료 관심): the real planned price ladder, shown on the sender's preview. No payment exists; a paid tier only asks
// "열리면 알려 드릴까요?". Prices include VAT. Tier 3's 9시 parade is its own screen at 21:05, never the main tower's 9 pm show.
export const TIERS = Object.freeze([
  Object.freeze({ t: 0, name: '무료 걸기', price: 0, best: false, tag: '지금 걸린 것', items: Object.freeze(['작은 화면에 6시간', '휴대폰으로 만드는 15초 영상(워터마크)', '받는 사람 페이지 7일', '롤링페이퍼 (무료 시즌 동안)', '결제가 열린 뒤에는 받는 사람 페이지에 작은 광고']) }),
  Object.freeze({ t: 1, name: '크게 걸기', price: 3900, best: false, tag: '커피 한 잔 값', items: Object.freeze(['큰 화면에 24시간', '받는 사람 페이지 30일', '광고 없음']) }),
  Object.freeze({ t: 2, name: '축하 영상 세트', price: 7900, best: true, tag: '추천', items: Object.freeze(['크게 걸기 전부', '고화질 15초 축하 영상 저장(워터마크 없음)', '롤링페이퍼 (친구 메시지 30개, 그날까지 잠금)', '받는 사람 페이지 1년', '영상·사진 내려받기']) }),
  Object.freeze({ t: 3, name: '9시 주인공', price: 14900, best: false, tag: '', items: Object.freeze(['축하 영상 세트 전부', "밤 9시 5분부터 '개인 축하 퍼레이드' 1분 (하루 30자리, 메인 타워와 따로)", '퍼레이드 장면이 담긴 두 번째 영상']) }),
]);
export const TIER_NOTE = '가격은 부가세 포함이에요. 지금은 무료 시즌이라 결제가 없어요. 결제가 열리면 환불 규정과 함께 먼저 알려 드려요.';
export const TIER_ASK = '결제는 준비 중이에요 · 열리면 알려 드릴까요?';
export const won = (n) => (Number(n) || 0) === 0 ? '0원' : Math.round(Number(n)).toLocaleString('ko-KR') + '원';

// Street and lot boards only. The 20 eye-level / stacked streets inside the bowtie (31..50) first: they are nearest the plaza.
export const GIFT_SCREENS = Object.freeze([
  ...Array.from({ length: 20 }, (_, i) => 'STREET_' + (31 + i)),
  ...Array.from({ length: 30 }, (_, i) => 'STREET_' + (1 + i)),
  ...Array.from({ length: 18 }, (_, i) => 'PLOT_' + (1 + i)),
]);
const SCREEN_SET = new Set(GIFT_SCREENS);
export const giftScreen = (s) => SCREEN_SET.has(String(s || ''));

// ---- text -------------------------------------------------------------------------------------------------------------
// The wish rules: control characters, zero-width marks and bidi overrides out, whitespace runs to one space; banned words,
// links and phone numbers refused (wish.js wishFault / wishNickFault on the whole text, before it is cut).
const JUNK = /[\u0000-\u001f\u007f-\u009f​‌‎‏‪-‮⁠-⁤⁦-⁩﻿]/g;
export const norm = (s) => String(s ?? '').replace(/\s/g, ' ').replace(JUNK, '').replace(/\s+/g, ' ').trim();
export const cut = (s, n) => Array.from(norm(s)).slice(0, n).join('').trim();
export const cpLen = (s) => Array.from(String(s ?? '')).length;

export const GIFT_ERR = Object.freeze({
  to: '받는 사람 이름을 적어 주세요.',
  name: '그 이름은 쓸 수 없어요.',
  long: '조금 짧게 적어 주세요.',
  blocked: '그 문구는 걸 수 없어요.',
  link: '전광판에는 링크나 연락처를 넣을 수 없어요.',
  occ: '무슨 날인지 골라 주세요.',
  day: '오늘부터 30일 안의 날짜를 골라 주세요.',
  past: '이미 지난 시간이에요. 다른 시간을 골라 주세요.',
  at: '시간을 골라 주세요.',
  full: '그 시간에는 화면이 모두 찼어요. 다른 시간을 골라 주세요.',
  mine: '오늘은 선물 전광판을 더 걸 수 없어요. 내일 다시 걸어 주세요.',
  net: '이 네트워크에서는 오늘 선물 전광판을 더 걸 수 없어요.',
  gone: '없어졌거나 가려진 선물 전광판이에요.',
  auth: '잠시 뒤에 다시 해 주세요.',
  busy: '지금은 광장이 붐벼요. 잠시 뒤에 다시 해 주세요.',
  rate: '너무 빨라요. 잠시 뒤 다시 해 주세요.',
  down: '처리하지 못했어요. 잠시 뒤 다시 해 주세요.',
  paperFull: '이 롤링페이퍼는 메시지가 가득 찼어요.',
  paperMine: '이 롤링페이퍼에는 메시지를 3개까지 남길 수 있어요.',
  paperNet: '이 네트워크에서는 오늘 메시지를 더 남길 수 없어요.',
  paperEmpty: '메시지를 한 줄 적어 주세요.',
  paperClosed: '메시지를 받는 기간이 끝났어요.',
  nostore: '영상 저장소가 아직 없어요. 영상은 이 기기에 저장해 두세요.',
  vsize: '영상이 너무 커요.',
  vtype: '이 영상 형식은 올릴 수 없어요.',
  vmany: '이 전광판에는 영상을 더 올릴 수 없어요.',
  owner: '이 전광판을 만든 사람만 할 수 있어요.',
  human: '사람인지 확인하지 못했어요. 다시 시도해 주세요.',
});

// A name on the board (to / from): the wish nick rules (no staff names, no banned words, no contacts). '' when fine, else a code.
function nameFault(raw, max, need) {
  const s = norm(raw);
  if (!s) return need ? 'to' : '';
  if (cpLen(s) > max) return 'long';
  return wishNickFault(s) ? 'name' : '';
}
function lineFault(raw, max) {
  const s = norm(raw);
  if (!s) return '';
  if (cpLen(s) > max) return 'long';
  const k = wishFault(s);
  return k === 'empty' ? '' : k;
}

// ---- KST days and windows ---------------------------------------------------------------------------------------------
export const kstDay = (ms = Date.now()) => new Date(ms + 9 * 36e5).toISOString().slice(0, 10);
export const dayStart = (day) => Date.parse(String(day) + 'T00:00:00+09:00');
export const addDays = (day, n) => kstDay(dayStart(day) + n * 864e5 + 36e5); // +1 h: never lands on a boundary
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const validDay = (d) => DAY_RE.test(String(d || '')) && Number.isFinite(dayStart(d)) && kstDay(dayStart(d)) === d;
const two = (n) => String(n).padStart(2, '0');

// [a, b) of a window: at is 'now' (today only) or one of GIFT.starts.
export function windowFor(day, at, now = Date.now()) {
  const a = at === 'now' ? Math.floor(now / GIFT.nowStep) * GIFT.nowStep : Date.parse(day + 'T' + two(at) + ':00:00+09:00');
  return { a, b: a + GIFT.hours * 36e5 };
}
// The start choices of a day: today 'now' and the start hours still ahead; a later day every start hour; outside the range none.
export function startChoices(day, now = Date.now()) {
  const today = kstDay(now);
  if (!validDay(day) || day < today || day > addDays(today, GIFT.aheadDays)) return [];
  const hours = GIFT.starts.filter((h) => day > today || windowFor(day, h, now).a > now);
  return day === today ? ['now', ...hours] : [...hours];
}
// The page's words for a window: '12월 25일 (목) 저녁 6시 ~ 자정'.
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export function hourText(h, exact = true) {
  const n = ((Math.floor(Number(h)) % 24) + 24) % 24;
  if (n === 0) return exact ? '자정' : '밤 12시';
  if (n === 12) return '낮 12시';
  return (n < 6 ? '새벽 ' : n < 12 ? '오전 ' : n < 18 ? '오후 ' : n < 21 ? '저녁 ' : '밤 ') + (n > 12 ? n - 12 : n) + '시';
}
export function dayText(day) {
  const d = new Date(dayStart(day) + 36e5 + 9 * 36e5);
  return (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일 (' + DOW[d.getUTCDay()] + ')';
}
const kstHM = (ms) => { const d = new Date(ms + 9 * 36e5); return { h: d.getUTCHours(), m: d.getUTCMinutes() }; };
export function clockText(ms) { const { h, m } = kstHM(ms); return m ? hourText(h, false) + ' ' + m + '분' : hourText(h); }
// '12월 25일 (금) 저녁 6시 ~ 자정', '11월 23일 (월) 밤 10시 ~ 다음 날 새벽 4시'.
export function windowText(a, b) {
  const end = kstHM(b), same = kstDay(b) === kstDay(a);
  const tail = !same && end.h === 0 && end.m === 0 ? '자정' : (same ? '' : '다음 날 ') + clockText(b);
  return dayText(kstDay(a)) + ' ' + clockText(a) + ' ~ ' + tail;
}

// ---- the form ---------------------------------------------------------------------------------------------------------
// b: { to, from, occ, msg, th, day, at }. -> { ok: true, v } with the cleaned values and the window, or { ok: false, field, code, error }.
export function giftFault(b, now = Date.now()) {
  const no = (field, code) => ({ ok: false, field, code, error: GIFT_ERR[code] || GIFT_ERR.down });
  if (!b || typeof b !== 'object') return no('to', 'to');
  let k = nameFault(b.to, GIFT.toMax, true); if (k) return no('to', k);
  k = nameFault(b.from, GIFT.fromMax, false); if (k) return no('from', k);
  const occ = String(b.occ || 'bday');
  if (!OCCASIONS[occ]) return no('occ', 'occ');
  k = lineFault(b.msg, GIFT.msgMax); if (k) return no('msg', k);
  const th = THEME_KEYS.includes(String(b.th || '')) ? String(b.th) : OCCASIONS[occ].th;
  const today = kstDay(now), day = String(b.day || today);
  if (!validDay(day) || day < today || day > addDays(today, GIFT.aheadDays)) return no('day', 'day');
  const at = b.at === 'now' ? 'now' : Math.floor(Number(b.at));
  if (at === 'now' ? day !== today : !GIFT.starts.includes(at)) return no('at', 'at');
  const w = windowFor(day, at, now);
  if (at !== 'now' && w.a <= now) return no('at', 'past');
  return { ok: true, v: { to: cut(b.to, GIFT.toMax), from: cut(b.from, GIFT.fromMax), occ, msg: cut(b.msg, GIFT.msgMax), th, day, a: w.a, b: w.b } };
}
// A 롤링페이퍼 line: { nick (optional, default 친구), txt }. -> { ok, v: { nick, txt } } or { ok: false, field, code, error }.
export function paperFault(b) {
  const no = (field, code) => ({ ok: false, field, code, error: GIFT_ERR[code] || GIFT_ERR.down });
  let k = nameFault(b?.nick, GIFT.paper.nickMax, false); if (k) return no('nick', k);
  if (!norm(b?.txt)) return no('txt', 'paperEmpty');
  k = lineFault(b?.txt, GIFT.paper.txtMax); if (k) return no('txt', k);
  return { ok: true, v: { nick: cut(b?.nick, GIFT.paper.nickMax) || '친구', txt: cut(b.txt, GIFT.paper.txtMax) } };
}

// ---- scheduling (server) ---------------------------------------------------------------------------------------------
// The most boards that share `scr` at any moment of [a, b), given rows [{ scr, a, b }].
export function screenLoad(rows, scr, a, b) {
  const ev = [];
  for (const r of rows || []) {
    if (r?.scr !== scr) continue;
    const s = Math.max(a, Number(r.a)), e = Math.min(b, Number(r.b));
    if (s < e) ev.push([s, 1], [e, -1]);
  }
  ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let n = 0, top = 0;
  for (const [, d] of ev) { n += d; if (n > top) top = n; }
  return top;
}
// The screen a new board [a, b) goes to: the fewest boards at once over its window, below GIFT.perScreen; ties by pool order.
// '' when every screen is full.
export function pickScreen(rows, a, b, pool = GIFT_SCREENS, per = GIFT.perScreen) {
  let best = '', low = per;
  for (const s of pool) { const n = screenLoad(rows, s, a, b); if (n < low) { low = n; best = s; if (!n) break; } }
  return best;
}
// The next start (of today and the days after, at most 7 days on) whose window still has a screen: a suggestion when 'full'.
export function nextFree(rows, day, now = Date.now()) {
  for (let i = 0; i < 8; i++) {
    const d = addDays(day, i);
    for (const at of startChoices(d, now)) { const w = windowFor(d, at, now); if (pickScreen(rows, w.a, w.b)) return { day: d, at }; }
  }
  return null;
}

// ---- phases and the 롤링페이퍼 lock (E3) ---------------------------------------------------------------------------------
// before: ahead of the day; day: the day has come but the window has not; live: on the plaza now; after: the window is over, the
// page still lives (GIFT.keepDays); gone: past that, or hidden.
// The moment a board and everything of it is deleted: the day (KST) is over, plus GIFT.keepDays.
export const keepUntil = (g) => dayStart(g?.day) + (1 + GIFT.keepDays) * 864e5;
// The newest day a board may have and still be pruned now (boards of that day or before go): today - (keepDays + 1).
export const pruneDay = (now = Date.now()) => addDays(kstDay(now), -(GIFT.keepDays + 1));
export function giftPhase(g, now = Date.now()) {
  if (!g || g.st !== 'live') return 'gone';
  const a = Number(g.a), b = Number(g.b);
  if (!(now < keepUntil(g))) return 'gone';
  if (now >= b) return 'after';
  if (now >= a) return 'live';
  return now >= dayStart(g.day) ? 'day' : 'before';
}
// What ?gb=<id> may do in the plaza (gift.js land): 'live' (hanging now, on its own screen for everyone), 'replay' (the day has come
// or the window is over and the page still lives: pinned on this device only, nobody else sees it), 'wait' (before the day), 'gone'.
// g: the public view ({ day, a, b }); a hidden or deleted board has no public view, so it never gets here.
export function plazaLook(g, now = Date.now()) {
  if (!g || !validDay(g.day)) return 'gone';
  const a = Number(g.a), b = Number(g.b);
  if (!(now < keepUntil(g))) return 'gone';
  if (now >= a && now < b) return 'live';
  return now >= revealAt(g) ? 'replay' : 'wait'; // a ceremony board is not previewed before its lighting
}
// What anyone but the owner sees of a board before revealAt is what they see before its day (the owner's choice, 2026-11-24: a 점등식
// board keeps its message until the lighting, so the lighting is the reveal). A board with a fixed start (cerStart): the start; any other
// board: 00:00 of its day, as before. start: the localhost seam's start (cerDebugStart) in place of the board's own. giftPhase (the
// server's bookkeeping: pruning, the paper, windows) does not change.
export function revealAt(g, start = 0) { return Number(start) > 0 ? Number(start) : cerStart(g) || dayStart(g?.day); }
/** The recipient page's view: 'before' (the countdown and the hidden preview) until revealAt, 'day' (the film) until the window, 'live',
 *  'after'. A ceremony board goes from 'before' straight to 'live'. */
export function pageLook(g, now = Date.now(), start = 0) {
  const t = Number(now);
  if (t >= Number(g?.b)) return 'after';
  if (t >= Number(g?.a)) return 'live';
  return t >= revealAt(g, start) ? 'day' : 'before';
}
/** The words of the page's 'before' view: { label, count, fine, hush } (hush: what the hidden preview says in place of the message).
 *  A board without a fixed start: today's words. A ceremony board: on earlier days the same countdown to the day; on its day the time left
 *  to the lighting, and the time it opens. */
export function hiddenWords(g, now = Date.now(), start = 0) {
  const s = Number(start) > 0 ? Number(start) : cerStart(g);
  if (!s) { const d = dDay(g.day, now); return { label: '그날까지', count: d >= 1 ? 'D-' + d : countdown(dayStart(g.day) - now), fine: dayText(g.day) + '이 되면 축하 영상과 친구들의 메시지가 함께 열려요.', hush: '그날 공개돼요 🤫' }; }
  const day = kstDay(s), d = dDay(day, now), hm = cerHM(s);
  if (d >= 1) return { label: '그날까지', count: 'D-' + d, fine: `${dayText(day)} ${hm}에 전광판이 켜지면 축하 영상이 함께 열려요.`, hush: '그날 공개돼요 🤫' };
  return { label: '켜지기까지', count: countdown(s - now), fine: `오늘 ${hm}에 전광판이 켜지면 축하 영상이 함께 열려요.`, hush: `${hm}에 공개돼요 🤫` };
}
// The recipient page's plaza button by phase (/?gb=<id>); before the day there is none.
export const PLAZA_BTN = Object.freeze({ day: '🗽 광장에서 미리 보기', live: '🗽 직접 가서 보기', after: '🗽 광장에서 다시 보기' });
// The plaza's toast once the board is on a screen: look 'live', or 'replay' (on its day before the window: when it hangs; after: only here).
export function plazaNote(g, look, now = Date.now()) {
  const head = `🎁 ${String(g?.to || '') || '당신'}님을 위한 선물 전광판이에요`;
  if (look !== 'replay') return head + '!';
  return head + ' · ' + (now < Number(g?.a) ? `광장에는 ${clockText(Number(g.a))}에 걸려요` : '이 기기에서만 다시 보여 드려요');
}
// The owner page leads with "광장에서 진짜 영상 만들기" (and asks once before the link is sent without one) only when the Worker stores
// videos (media: the R2 binding), the board has none yet and its window is not over. Otherwise the page is as it always was.
export const videoFirst = ({ media, vid, phase } = {}) => !!media && !vid && phase !== 'after';
// 21:00..08:00 KST: no advertising push goes out (the privacy policy's 알림), and no reply notice either (giftsrv.js make).
export const quietNow = (now = Date.now()) => { const h = new Date(now + 9 * 36e5).getUTCHours(); return h >= GIFT.quiet[0] || h < GIFT.quiet[1]; };
export const AD_LABEL = '(광고) ';
// Messages show from 00:00 KST of the day (or at once on the E3 'open' arm, lk 0).
export const paperOpen = (g, now = Date.now()) => !Number(g?.lk) || now >= dayStart(g?.day) || now >= Number(g?.a);
// Messages are taken until the window ends.
export const paperTakes = (g, now = Date.now()) => giftPhase(g, now) !== 'gone' && now < Number(g?.b);
// E3: with GIFT_E3 = '1' half of the boards (by id) show messages at once; otherwise every board locks them until the day.
export function lockArm(id, split) {
  if (!split) return 1;
  let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 2;
}

// ---- the plaza (client) ----------------------------------------------------------------------------------------------
// gifts: the live list ({ id, scr, a }). ok(slot): the screen may show a gift now (on the map, nobody's lit board, no takeover).
// -> Map slot -> [ids] in turn order. A gift stays on its own screen while that screen is free and has room; otherwise it goes to
// the free pool screen with the fewest gifts (ties: pool order). Gifts that find no room are left out (the server's per-screen
// cap makes that rare: it needs most of the 68 screens lit).
export function placeGifts(gifts, ok, per = GIFT.perScreen, pool = GIFT_SCREENS) {
  const out = new Map(), list = [...(Array.isArray(gifts) ? gifts : [])].filter((g) => g && GIFT_ID.test(String(g.id || '')))
    .sort((x, y) => (Number(x.a) || 0) - (Number(y.a) || 0) || String(x.id).localeCompare(String(y.id)));
  const free = pool.filter((s) => { try { return !!ok(s); } catch { return false; } });
  const n = (s) => (out.get(s) || []).length;
  const put = (s, id) => { if (!out.has(s)) out.set(s, []); out.get(s).push(id); };
  const later = [];
  for (const g of list) { if (giftScreen(g.scr) && free.includes(g.scr) && n(g.scr) < per) put(g.scr, g.id); else later.push(g); }
  for (const g of later) {
    let best = '', low = per;
    for (const s of free) { const k = n(s); if (k < low) { low = k; best = s; if (!k) break; } }
    if (best) put(best, g.id);
  }
  return out;
}
// Which of k boards sharing a screen shows at `now` (the same for every viewer).
export const turnOf = (k, now = Date.now(), cyc = GIFT.cycleMs) => (k > 0 ? Math.floor(now / cyc) % k : 0);

// ---- attribution (E2) -------------------------------------------------------------------------------------------------
// ?ref=<board id> on /gift (the recipient page's "나도 누군가에게 걸어 주기"): kept 7 days on the device (kts_gref) and sent with the
// next board made. -> the id or ''.
export const refOf = (v) => (GIFT_ID.test(String(v || '')) ? String(v) : '');
export const REF_MS = 7 * 864e5;
export function keptRef(raw, now = Date.now()) {
  try { const j = typeof raw === 'string' ? JSON.parse(raw) : raw; return j && refOf(j.id) && now - Number(j.at) < REF_MS && now >= Number(j.at) ? j.id : ''; } catch { return ''; }
}
// 답장 전광판: the maker's values for a reply to board g (its public view): to and from swapped and cut to their limits, 고마움, the
// thanks line. Everything can still be edited and goes through giftFault like any board; a board without a sender leaves `to` empty.
export function replyDraft(g) { return { to: cut(g?.from, GIFT.toMax), from: cut(g?.to, GIFT.fromMax), occ: 'thanks', msg: REPLY_MSG, th: '' }; }
// The recipient page's reply button: by the sender's name when the board has one.
export function replyLabel(g) { const from = cut(g?.from, GIFT.fromMax); return from ? `💌 ${from}님에게 답장 전광판 걸기` : '💌 고마워 전광판 걸기'; }

// ---- what a page shows ---------------------------------------------------------------------------------------------------
// The public view of a stored board (the Worker strips the owner, network and visitor fields before this).
export function giftView(g, now = Date.now()) {
  const phase = giftPhase(g, now), open = paperOpen(g, now);
  return {
    id: String(g.id), to: String(g.to || ''), from: String(g.from || ''), occ: String(g.occ || 'bday'), msg: String(g.msg || ''), th: String(g.th || ''),
    day: String(g.day || ''), a: Number(g.a) || 0, b: Number(g.b) || 0, scr: String(g.scr || ''), phase, lk: Number(g.lk) ? 1 : 0,
    n: Number(g.n) || 0, v: Number(g.v) || 0, vid: g.vid ? { t: String(g.vid.t || ''), at: Number(g.vid.at) || 0 } : null,
    paper: open ? (Array.isArray(g.paper) ? g.paper : []).map((p) => ({ id: String(p.id), nick: String(p.nick || ''), txt: String(p.txt || '') })) : null,
    open: !!open, takes: paperTakes(g, now),
  };
}
// The link preview words.
export function giftShareText(g) {
  const o = OCCASIONS[g?.occ] || OCCASIONS.bday, to = String(g?.to || '') || '당신';
  return {
    title: `${o.emoji} ${to}님을 위한 선물 전광판`,
    text: `뉴욕 타임스퀘어 가상 광장에 ${to}님을 위한 전광판이 걸려요. ${o.head}!`,
  };
}
// Calendar days from today (KST) to the day: 3 for 'D-3'.
export const dDay = (day, now = Date.now()) => Math.round((dayStart(day) - dayStart(kstDay(now))) / 864e5);
// Countdown words: 'D-3', '3시간 12분', '12분 5초'.
export function countdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 2 * 86400) return 'D-' + Math.floor(s / 86400);
  if (s >= 3600) return Math.floor(s / 3600) + '시간 ' + Math.floor((s % 3600) / 60) + '분';
  return Math.floor(s / 60) + '분 ' + (s % 60) + '초';
}

// ---- the 15-second video ------------------------------------------------------------------------------------------------
// The upload's own bytes decide its type: MP4 ('ftyp' at 4) or WebM (EBML header). -> 'mp4' | 'webm' | ''.
export function videoKind(u8) {
  if (!u8 || u8.length < 12) return '';
  if (u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) return 'mp4';
  if (u8[0] === 0x1a && u8[1] === 0x45 && u8[2] === 0xdf && u8[3] === 0xa3) return 'webm';
  return '';
}
export const VIDEO_TYPE = Object.freeze({ mp4: 'video/mp4', webm: 'video/webm' });
// MediaRecorder types to try, MP4 first (it plays on every phone; Chrome 126+ and Safari record it), WebM otherwise.
export const RECORD_TYPES = Object.freeze(['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']);
export function pickRecordType(supported) { for (const t of RECORD_TYPES) { try { if (supported(t)) return t; } catch { /* next */ } } return ''; }
// A Range header -> { offset, length } within size, or null for the whole file; 'bad' when it cannot be served (416).
export function rangeOf(h, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(h || '').trim());
  if (!m || (!m[1] && !m[2]) || !(size > 0)) return null;
  let s, e;
  if (!m[1]) { const n = Math.min(size, Number(m[2])); s = size - n; e = size - 1; } else { s = Number(m[1]); e = m[2] ? Math.min(size - 1, Number(m[2])) : size - 1; }
  if (!(s >= 0) || s > e || s >= size) return 'bad';
  return { offset: s, length: e - s + 1 };
}

// ---- 점등식 (the lighting ceremony, spec ③) -----------------------------------------------------------------------------------
// A board with a fixed start (one of GIFT.starts on its day; never a "지금" board) lights in front of the friends who came by the recipient
// page's button. Nothing tells the devices when: each runs these rules on its own clock plus the server offset (the caller adds it: nowMs()
// in the plaza, the page's own now() on /g/<id>), the way the 9 pm show times itself. No new field on the board: the start is its window's
// `a` when that is a whole start hour of its day. The phases of a start s:
//   early  before s - CER.open             the page's button says when it opens; the plaza sends the link back to the page
//   wait   s - CER.open .. s - CER.count   the teaser card on the board (곧 켜져요, the name, the time left; never the message)
//   count  s - CER.count .. s              the big 10..1
//   lit    s .. s + CER.late               the real card, fireworks, one cheer, the group photo at s + CER.shot; late arrivals get less
//   over   later, or no fixed start, or the board is hidden or gone: the ordinary ?gb= visit
// Every timing function takes a board or a start in ms (the localhost seam, cerDebugStart, passes a number).
export const CER = Object.freeze({
  open: 600000, count: 10000, late: 120000, // the window opens 10 min before; the countdown is the last 10 s; arrivals up to 2 min after
  shot: 8000, pose: 6500, shotSlack: 4000, // the photo at s + 8 s (each avatar turns to the camera at 6.5 s); past s + 12 s it is only offered
  rounds: 6, roundMs: 1200, cheerMs: 5000, // six rounds of fireworks 1.2 s apart; the cheer only in the first 5 s
  hold: 60000, // the pin stays until s + late + hold (at least a minute); by then /rt/world has the board on its own screen
});
// Page beacons (giftsrv.js SEEN_EV; ev:<key> in the daily counters): a device arrived at a ceremony; it saved or shared the group photo.
export const CER_BEACONS = Object.freeze(['cer', 'cershot']);
export const CER_TEXT = Object.freeze({
  early: '10분 전부터 들어올 수 있어요',
  busy: '지금은 광장이 붐벼서 점등식에 들어갈 수 없어요. 잠시 뒤에 다시 해 주세요',
  soon: '곧 켜져요',
  gather: '전광판 앞으로 오면 단체 사진에 같이 찍혀요',
  shotHead: '📸 단체 사진이 나왔어요',
  shotReady: '📸 단체 사진이 나왔어요 · 보기', // a notice when a sheet or the gift frame was up at the shot
  shotTake: '📸 지금 단체 사진 찍기', // late arrivals and a tab back after the shot: offered, never taken by itself
  save: '사진 저장', share: '공유하기', page: '받는 사람 페이지로',
});
const CER_BAND = 'WISH BOARD 가상 광장';

// The fixed start in ms, or 0: a "지금" board (rounded to 10 minutes: a start hour only when made in the first 10 minutes after one, which
// the owner's read tells apart by `at`, its making time; the public view cannot, and such a board is past its lit minutes before anyone
// could gather), a hidden or gone board, a window that is not a start hour of the board's day. /rt/world's rows have no day: `a` decides.
export function cerStart(g) {
  if (!g || (g.st != null && g.st !== 'live') || g.phase === 'gone') return 0;
  const a = Number(g.a);
  if (!Number.isFinite(a) || a <= 0 || a % 36e5 !== 0) return 0; // KST is a whole-hour offset: a start hour is a whole UTC hour
  if (!GIFT.starts.includes(new Date(a + 9 * 36e5).getUTCHours())) return 0;
  if (g.day != null && g.day !== '' && kstDay(a) !== String(g.day)) return 0;
  if (g.at != null && Number(g.at) >= a) return 0; // made at or after its start: a "지금" board
  return a;
}
const startOf = (x) => (typeof x === 'number' ? (Number.isFinite(x) && x > 0 ? x : 0) : cerStart(x));
export function cerPhase(x, now = Date.now()) {
  const s = startOf(x), t = Number(now);
  if (!s || !Number.isFinite(t)) return 'over';
  if (t < s - CER.open) return 'early';
  if (t < s - CER.count) return 'wait';
  if (t < s) return 'count';
  return t < s + CER.late ? 'lit' : 'over';
}
export const cerLeft = (x, now = Date.now()) => { const s = startOf(x); return s ? Math.max(0, s - now) : 0; };
/** The big number: 10..1 exactly while counting (10 from s - 10 s, 1 in the last second), 0 otherwise. */
export function cerDigit(x, now = Date.now()) { const left = cerLeft(x, now); return left > 0 && left <= CER.count ? Math.ceil(left / 1000) : 0; }
/** mm:ss of ms left, rounded up (the last second reads 00:01, never 00:00 while counting). */
export function cerClock(ms) { const s = Math.max(0, Math.ceil(Number(ms) / 1000) || 0); return two(Math.floor(s / 60)) + ':' + two(s % 60); }
const cerHM = (s) => { const d = new Date(s + 9 * 36e5); return two(d.getUTCHours()) + ':' + two(d.getUTCMinutes()); };
/** '12월 25일 18:00' ('' without a start). */
export function cerWhen(x) { const s = startOf(x); if (!s) return ''; const d = new Date(s + 9 * 36e5); return (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일 ' + cerHM(s); }
const cerTo = (g) => cut(g?.to, GIFT.toMax) || '당신';
export const cerUrl = (id) => '/?gb=' + id + '&cer=1';

// ---- the recipient page (giftpage.js) ----
/** The page's ceremony button: { label, act, href } or null (no fixed start, or past the late window). act 'early': before the window, a tap
 *  says CER_TEXT.early and opens the share sheet with cerInvite; 'go': href enters the plaza; 'busy' (budget hard): a tap says CER_TEXT.busy.
 *  start: the localhost seam's start in ms (cerDebugStart) in place of the board's own; 0 (the default) is the board's. */
export function cerButton(g, now = Date.now(), { hard = false, start = 0 } = {}) {
  const x = start || g, p = cerPhase(x, now);
  if (p === 'over') return null;
  if (p === 'early') return { label: '🎆 점등식 같이 보기 · ' + cerWhen(x), act: 'early', href: '' };
  const label = p === 'lit' ? '🎆 방금 켜졌어요 · 점등식 보러 가기' : '🎆 점등식 들어가기 · ' + cerClock(cerLeft(x, now)) + ' 남음';
  return hard ? { label, act: 'busy', href: '' } : { label, act: 'go', href: cerUrl(g.id) };
}
/** The invitation for the share sheet (url: the recipient page), or null without a fixed start. start: as cerButton's. */
export function cerInvite(g, url, start = 0) {
  const when = cerWhen(start || g); if (!when) return null;
  const to = cerTo(g);
  return { title: `🎆 ${to}님 선물 전광판 점등식`, text: `${when}, 뉴욕 타임스퀘어 가상 광장에서 ${to}님의 전광판이 켜져요. 같이 보러 와요! ${CER_TEXT.early} 👉`, url: String(url || '') };
}
/** Added to the owner's share text while the start is ahead (leading space), else ''. */
export function cerShareLine(g, now = Date.now()) { const p = cerPhase(g, now); return p === 'early' || p === 'wait' || p === 'count' ? ` 🎆 점등식 ${cerWhen(g)}에 같이 봐요!` : ''; }
/** The plaza's send-back address and the reason the page reads from it once ('early' | 'busy' | ''). */
export const cerBack = (id, why) => '/g/' + id + '?cer=' + why;
export function cerBackWhy(search) { try { const v = new URLSearchParams(String(search || '')).get('cer'); return v === 'early' || v === 'busy' ? v : ''; } catch { return ''; } }

// ---- the plaza (gift.js, ts3d/screens.js, giftart.js) ----
/** What /?gb=<id>&cer=1 does, decided before the room is joined: 'go' (the ceremony), 'early' / 'busy' (back to the page: cerBack), 'plain'
 *  (no ceremony now: the ordinary ?gb= visit, gift.js land), 'gone'. hard: the gift read said budget hard. start: the localhost seam. */
export function cerArrive(g, now = Date.now(), { hard = false, start = 0 } = {}) {
  if (!g) return 'gone';
  const p = cerPhase(start || g, now);
  if (p === 'over') return 'plain';
  if (p === 'early') return 'early';
  return hard ? 'busy' : 'go';
}
export function cerArriveNote(g, now = Date.now(), start = 0) {
  const s = start || cerStart(g), to = cerTo(g);
  return now < s ? `🎆 ${to}님 선물 전광판 점등식 · ${cerHM(s)}에 켜져요` : `🎆 ${to}님 선물 전광판이 방금 켜졌어요!`;
}
/** The teaser card's fields (giftart.js paintTeaser draws only these): never the message, never the sender. */
export function cerTeaser(g, now = Date.now(), start = 0) {
  const s = start || cerStart(g), o = OCCASIONS[g?.occ] || OCCASIONS.bday;
  return { to: cerTo(g), chip: CER_TEXT.soon, left: cerClock(s ? s - now : 0), when: s ? cerHM(s) : '', emoji: o.emoji, th: THEME_KEYS.includes(String(g?.th || '')) ? String(g.th) : o.th };
}
/** How long the one pin lasts from now: past the late window by CER.hold, at least CER.hold. */
export const cerPinMs = (x, now = Date.now()) => { const s = startOf(x); return Math.max(CER.hold, s ? s + CER.late + CER.hold - now : 0); };
/** The photo's bottom band: 'To. 민지 · 2026.12.25 · WISH BOARD 가상 광장'. */
export function cerBand(g, start = 0) {
  const s = start || cerStart(g), day = s ? kstDay(s) : String(g?.day || '');
  return `To. ${cerTo(g)} · ${day.replace(/-/g, '.')} · ${CER_BAND}`;
}
export const cerPhotoText = (g) => `🎆 ${cerTo(g)}님 선물 전광판 점등식에서 · ${CER_BAND}`;
/**
 * The steps due on this device now, each once. done: what this device already did ({ before, teaser, count, light, cheer, rounds, pose,
 * shot, offer, end }); the caller sets done.before = true whenever the phase was 'wait' or 'count', done[step] = true after each step, and
 * done.rounds = round + 1 after firing a round. A tab that was hidden resumes at the phase it is in now: missed steps are not replayed.
 * -> { phase, teaser, count, light, cheer, round (-1: none), pose, shot, offer, end }.
 *   teaser  pin the board with the teaser (wait, count)      count  the countdown overlay (count)
 *   light   the lit card is up (lit)                         cheer  the avatar's cheer, only in the first CER.cheerMs
 *   round   a fireworks round: for a device here before the start, the round of this moment (missed ones are skipped; back after the
 *           last one, a single round); a late arrival gets one
 *   pose    turn to the photo camera; shot  the automatic photo (only a device here before the start, at s + CER.shot, until shotSlack)
 *   offer   the tappable 📸 notice instead (late arrivals, or the shot's moment passed unseen)
 *   end     once in 'over' after a ceremony ran: put the HUD back, drop the overlay
 */
export function cerSteps(x, now = Date.now(), done = {}) {
  const s = startOf(x), phase = cerPhase(s, now), d = done || {}, t = now - s;
  const out = { phase, teaser: false, count: false, light: false, cheer: false, round: -1, pose: false, shot: false, offer: false, end: false };
  if (phase === 'wait' || phase === 'count') { out.teaser = !d.teaser; out.count = phase === 'count' && !d.count; return out; }
  if (phase !== 'lit') { out.end = !!(d.teaser || d.light) && !d.end; return out; }
  const here = !!d.before, fired = Number(d.rounds) || 0, k = Math.floor(t / CER.roundMs);
  out.light = !d.light;
  out.cheer = !d.cheer && t < CER.cheerMs;
  if (here && k < CER.rounds) { if (k >= fired) out.round = k; } else if (!fired) out.round = 0;
  const shotOn = here && !d.shot && t < CER.shot + CER.shotSlack;
  out.pose = shotOn && !d.pose && t >= CER.pose;
  out.shot = shotOn && t >= CER.shot;
  out.offer = !d.shot && !d.offer && (!here || t >= CER.shot + CER.shotSlack);
  return out;
}
/** The localhost-only seam: ?cerin=<seconds> runs the ceremony of any board against a start that many seconds from now (negative: already
 *  started), on a local development host only (localhost, 127.0.0.1, [::1], *.localhost), within an hour either way. -> the start or 0. */
export function cerDebugStart(search, host, now = Date.now()) {
  const h = String(host || '').toLowerCase();
  if (!(h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost'))) return 0;
  let v = null; try { v = new URLSearchParams(String(search || '')).get('cerin'); } catch { return 0; }
  const n = v == null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) && Math.abs(n) <= 3600 ? now + Math.round(n * 1000) : 0;
}
/** One beacon per board, event and KST day on a device (the recipient page's rule, for the plaza too: the same kts_gseen store).
 *  -> { send, seen } (seen: the store to keep; more than 200 keys drop the oldest 100). */
export function beaconOnce(seen, id, e, day) {
  const next = { ...(seen && typeof seen === 'object' ? seen : {}) }, key = id + ':' + e;
  if (next[key] === day) return { send: false, seen: next };
  const keys = Object.keys(next); if (keys.length > 200) for (const k of keys.slice(0, 100)) delete next[k];
  next[key] = day;
  return { send: true, seen: next };
}
