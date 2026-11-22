// Advertising sales (상6): the ad-only screens AD_1..AD_5 carry advertising the operator sells for money, booked by hand
// (bank transfer or invoice, no card payment), apart from the coin game: they are not claimable slots, take no coin bid
// and show no wish. Pure rules shared by the Worker (adsrv.js) and the browser (ads.html, admin-ads.js, the plaza):
// products, the ADS_PRICES format, request checks, KST dates, booking overlaps and what a screen shows at a given time.
// Bundled by the Worker too, so it is imported with no query.
import { blockedText } from './plaza-account.js';

export const ADS = {
  lineMax: [16, 20, 24], // characters per line of the creative (the screen's three lines)
  nameMax: 40, emailMax: 120, phoneMax: 20, memoMax: 300, linkMax: 200,
  bodyMax: 4000, // bytes of a request body
  daysMax: 30, // days one request may ask for
  bookMax: 90, // days one booking may run
  aheadDays: 180, // how far ahead a request may start
  perIp: 5, // requests per network (IPv6 by /64) per KST day
  perHour: 40, // requests in all per hour (KST clock hour): a flood stops the form for the rest of that hour, not for the day
  hitIpMin: 60, hitActorMin: 10, // /rt/ads/click and /rt/ads/seen per network and per account per minute (per isolate; EVENT_RL / OPS_RL too)
  reportMin: 20, // /rt/ads/report/<token> reads per network per minute that may reach the store (OPS_RL too)
  reportTtl: 60000, reportKeep: 200, // a report read is reused for 60 s per isolate; at most this many tokens are held
  nineLate: 180000, // a 9 pm sponsor's count is taken from 21:00:00 until this long after (a late "seen" report still counts)
  keepDays: 365, // a request (and the contact details in it) is deleted this long after it arrived
  listMax: 300, // requests the admin list shows
  nowDays: 3, // /rt/world carries bookings that run now or start within this many days
  seenRate: 0.5, // share of plaza sessions that report which ad screens they saw (sampled)
  seenAfter: 2, // seconds a screen must be in view before it counts as seen
};

// The screens, as ts3d/bowtie.js AD_SPOTS puts them on the map (test/ad-screens.test.mjs checks the two agree):
// face centre x, z (metres; north is -z, east +x), centre height, width.
export const AD_SCREENS = [
  { id: 'AD_1', name: '광장 동쪽 눈높이 화면', x: 69.9, z: 101.7, y: 7.7, w: 11 },
  { id: 'AD_2', name: '메인 타워 서쪽 큰 화면', x: 13.1, z: 202.4, y: 20.3, w: 17 },
  { id: 'AD_3', name: '7번가 북쪽 높은 화면', x: -25.6, z: -12.2, y: 30.5, w: 11 },
  { id: 'AD_4', name: '메인 타워 건너편 화면', x: 46, z: 193.2, y: 25, w: 12.5 },
  { id: 'AD_5', name: '빨간 계단 가는 길 화면', x: 12.7, z: -48.4, y: 15.3, w: 11 },
];
export const AD_SCREEN_IDS = AD_SCREENS.map((s) => s.id);
export const isAdScreen = (id) => AD_SCREEN_IDS.includes(String(id));
export const adScreenName = (id) => AD_SCREENS.find((s) => s.id === id)?.name || (id === '*' ? '광고 화면 전체' : '');

// Products. 'cheer' is the same booking as 'screen' with a birthday / cheer template. 'sponsor9': every ad screen at once
// from 21:00:00 to 21:01:00 KST on each day of the booking (the claimable boards keep their own 9 pm 소원왕). In that minute a day
// booking on any screen steps aside, and its clicks and sightings are not counted (adsrv.js hit).
export const AD_PRODUCTS = {
  screen: { name: '광고 화면 하루', unit: '1일', desc: '광고 화면 한 곳에 하루 종일(한국 시간 0시부터 24시까지). 밤 9시 스폰서가 있는 날은 21시부터 60초 동안 스폰서 광고가 대신 나가요.' },
  cheer: { name: '생일·응원 패키지', unit: '1일', desc: '광고 화면 한 곳에 하루 종일, 생일·응원 문구 틀로. 밤 9시 스폰서가 있는 날은 21시부터 60초 동안 스폰서 광고가 대신 나가요.' },
  sponsor9: { name: '밤 9시 60초 스폰서', unit: '1회', desc: '잡은 날마다 한국 시간 밤 9시 정각부터 60초 동안 광고 화면 다섯 곳 모두를 차지해요(그 화면의 하루 광고 대신).' },
};
export const AD_PRODUCT_IDS = Object.keys(AD_PRODUCTS);
export const AD_TEMPLATES = {
  screen: ['우리 가게 오픈!', '타임스퀘어에서 만나요', '링크를 눌러 보세요'],
  cheer: ['HAPPY BIRTHDAY', '○○야 생일 축하해', 'From. 팬 일동'],
  sponsor9: ['오늘 밤 9시의 스폰서', '함께해 주셔서 고마워요', '링크를 눌러 보세요'],
};
// Themes the screen paints (ts3d/art.js THEMES keys; this module cannot import the scene) and the emoji a creative may use.
export const AD_THEMES = ['cyber_navy', 'neon_pink', 'gold_luxury', 'matrix_green', 'sunset_red', 'bday_party', 'cheer_exam', 'love_anniv'];
export const AD_EMOJI = ['📢', '🎉', '🎂', '💖', '⭐', '☕', '🛍️', '🎵', '🔥', '🍀', '🏆', '✨'];
export const AD_STATUS = ['new', 'quoted', 'paid', 'scheduled', 'done', 'rejected'];
export const AD_STATUS_NAME = { new: '새 문의', quoted: '견적 보냄', paid: '입금 확인', scheduled: '일정 잡음', done: '끝남', rejected: '거절' };
export const AD_COUNTED = '광장이 센 수'; // every number on the /ads page and in a report is labelled this way, never as guaranteed exposure

const glyphs = (s) => Array.from(String(s ?? ''));
const CTRL = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127, 0x2028, 0x2029) + ']', 'g'); // control characters and line / paragraph separators
export const clean = (s, n) => glyphs(String(s ?? '').replace(CTRL, ' ')).slice(0, n).join('').trim();

// ADS_PRICES (Worker variable, JSON): { "screen": 30000, "cheer": 50000, "sponsor9": 100000, "note": "부가세 별도" }.
// Each product is a whole number of won per unit, 1,000 to 100,000,000; anything else (missing, text, a fraction, the
// variable unset or not JSON) shows that product as '견적 문의'. note: one short line under the prices (optional).
export function adPrices(raw) {
  const out = { screen: null, cheer: null, sponsor9: null, note: '' };
  let o = raw;
  if (typeof raw === 'string') { try { o = raw.trim() ? JSON.parse(raw) : null; } catch { o = null; } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  for (const k of AD_PRODUCT_IDS) { const v = o[k]; if (typeof v === 'number' && Number.isInteger(v) && v >= 1000 && v <= 1e8) out[k] = v; }
  if (typeof o.note === 'string' && !blockedText(o.note)) out.note = clean(o.note, 60);
  return out;
}
export const priceText = (won) => (Number.isInteger(won) && won > 0 ? won.toLocaleString('ko-KR') + '원' : '견적 문의');

// ---- KST days ------------------------------------------------------------------------------------------------------
export const kstDay = (t = Date.now()) => new Date(t + 9 * 36e5).toISOString().slice(0, 10);
export function isDay(s) {
  const t = String(s ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  const ms = Date.parse(t + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === t;
}
export const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
/** Milliseconds of 00:00 KST on day d. */
export const dayStart = (d) => Date.parse(d + 'T00:00:00+09:00');
/** A booking from day `start` to day `end` (both included, KST): [a, b) in ms. */
export const kstRange = (start, end) => ({ a: dayStart(start), b: dayStart(end) + 864e5 });
export const daysBetween = (start, end) => Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 864e5) + 1;
/** True from 21:00:00.000 to 21:00:59.999 KST. */
export const nineOn = (now) => { const s = nineSince(now); return s >= 0 && s < 60000; };
/** Milliseconds since 21:00:00.000 KST today (negative before it). nineSince(now) in [0, ADS.nineLate): a sponsor's count still lands. */
export const nineSince = (now) => (((now + 9 * 36e5) % 864e5) + 864e5) % 864e5 - 21 * 36e5;
/** The KST clock hour, 'YYYY-MM-DDTHH' (sorts after its own day's 'YYYY-MM-DD', before the next day's). */
export const kstHour = (t = Date.now()) => new Date(t + 9 * 36e5).toISOString().slice(0, 13);

// ---- links ---------------------------------------------------------------------------------------------------------
// An advertiser's link: like allowedLink (https, at most 200 characters) but any public host, since the operator reviews
// each one by hand. No user:password, no port, no IP literal or local name, no banned word. '' for empty, null when refused.
export function adLink(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  if (raw.length > ADS.linkMax || !/^https:\/\//i.test(raw) || /[\s<>"'`\\]/.test(raw)) return null;
  let x; try { x = new URL(raw); } catch { return null; }
  const host = x.hostname.toLowerCase();
  if (x.protocol !== 'https:' || x.username || x.password || x.port) return null;
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes('.') || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null;
  if (/^\d+(\.\d+){3}$/.test(host) || /(^|\.)(localhost|local|internal|lan|home|test|invalid|example)$/.test(host)) return null;
  if (blockedText(raw)) return null;
  return x.href.length <= ADS.linkMax ? x.href : null;
}
export const linkHost = (url) => { try { return new URL(url).hostname; } catch { return ''; } };

// ---- the request form ----------------------------------------------------------------------------------------------
const EMAIL = /^[^\s@<>()",;:]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const PHONE = /^[0-9+()\- ]{6,20}$/;
const no = (field, error) => ({ ok: false, field, error });
/** The creative's three lines, emoji and theme: { ok, l, e, th } or a refusal for that field. */
export function adCreative(b) {
  const l = [0, 1, 2].map((i) => clean(Array.isArray(b?.lines) ? b.lines[i] : '', 200));
  for (let i = 0; i < 3; i++) if (glyphs(l[i]).length > ADS.lineMax[i]) return no('lines', `${i + 1}번째 줄은 ${ADS.lineMax[i]}자까지예요.`);
  if (!l[0]) return no('lines', '광고 문구 첫 줄을 적어 주세요.');
  if (l.some((t) => blockedText(t))) return no('lines', '광고 문구에 쓸 수 없는 말이 있어요.');
  const e = String(b?.emoji ?? '');
  if (e && !AD_EMOJI.includes(e)) return no('emoji', '고를 수 있는 그림만 돼요.');
  const th = String(b?.theme ?? '') || 'cyber_navy';
  if (!AD_THEMES.includes(th)) return no('theme', '고를 수 있는 배경만 돼요.');
  return { ok: true, l, e: e || '📢', th };
}
/**
 * A request from the /ads form: { ok: true, v } with the cleaned request, or { ok: false, field, error }. The honeypot
 * (website) is the caller's: a filled one is answered as a success and nothing is stored.
 */
export function adRequestFault(b, now = Date.now()) {
  if (!b || typeof b !== 'object') return no('body', '신청서를 읽지 못했어요.');
  const product = String(b.product ?? '');
  if (!AD_PRODUCT_IDS.includes(product)) return no('product', '상품을 골라 주세요.');
  const start = String(b.start ?? ''), today = kstDay(now);
  if (!isDay(start)) return no('start', '시작 날짜를 골라 주세요.');
  if (start <= today) return no('start', '시작 날짜는 내일부터 고를 수 있어요.');
  if (start > addDays(today, ADS.aheadDays)) return no('start', `시작 날짜는 ${ADS.aheadDays}일 안에서 골라 주세요.`);
  const days = Number(b.days);
  if (!Number.isInteger(days) || days < 1 || days > ADS.daysMax) return no('days', `일수는 1일부터 ${ADS.daysMax}일까지예요.`);
  const screen = product === 'sponsor9' ? '*' : String(b.screen ?? '');
  if (screen !== '*' && screen !== '' && !isAdScreen(screen)) return no('screen', '광고 화면을 골라 주세요.');
  const cr = adCreative(b);
  if (!cr.ok) return cr;
  const link = adLink(b.link);
  if (link === null) return no('link', '링크는 https://로 시작하는 공개 주소만 돼요(200자까지).');
  const company = clean(b.company, 200);
  if (!company) return no('company', '회사 또는 이름을 적어 주세요.');
  if (glyphs(company).length > ADS.nameMax) return no('company', `회사 또는 이름은 ${ADS.nameMax}자까지예요.`);
  const email = String(b.email ?? '').trim();
  if (!email || email.length > ADS.emailMax || !EMAIL.test(email)) return no('email', '답장 받을 이메일을 확인해 주세요.');
  const phone = String(b.phone ?? '').trim();
  if (phone && !PHONE.test(phone)) return no('phone', '전화번호는 숫자와 - 만 써 주세요.');
  const memo = clean(b.memo, 2000);
  if (glyphs(memo).length > ADS.memoMax) return no('memo', `요청 사항은 ${ADS.memoMax}자까지예요.`);
  if (b.agree !== true) return no('agree', '개인정보 수집·이용에 동의해야 신청할 수 있어요.');
  return { ok: true, v: { product, start, days, screen, lines: cr.l, emoji: cr.e, theme: cr.th, link, company, email: email.toLowerCase(), phone, memo } };
}

// ---- bookings ------------------------------------------------------------------------------------------------------
// A booking is { id, p: product, s: screen ('AD_n', or '*' for sponsor9), a, b: [a, b) ms, st: 'live' | 'cancelled', ... }.
// Two live bookings clash when they share a lane (the screen; all sponsor9 bookings share one) and their ranges meet.
export const laneOf = (x) => (x.p === 'sponsor9' ? '*' : String(x.s));
export function adClash(list, cand) {
  for (const x of list || []) {
    if (!x || x.st === 'cancelled' || x.id === cand.id) continue;
    if (laneOf(x) === laneOf(cand) && x.a < cand.b && cand.a < x.b) return x;
  }
  return null;
}
/** The admin's schedule form: { ok, v: { p, s, start, end, a, b } } or a refusal. A booking may not end before today (KST). */
export function adBookFault(b, now = Date.now()) {
  const p = String(b?.product ?? '');
  if (!AD_PRODUCT_IDS.includes(p)) return no('product', '상품이 없어요.');
  const s = p === 'sponsor9' ? '*' : String(b?.screen ?? '');
  if (s !== '*' && !isAdScreen(s)) return no('screen', '광고 화면을 골라 주세요.');
  const start = String(b?.start ?? ''), end = String(b?.end ?? '');
  if (!isDay(start) || !isDay(end)) return no('date', '날짜를 YYYY-MM-DD로 적어 주세요.');
  if (end < start) return no('date', '끝 날짜가 시작 날짜보다 앞이에요.');
  if (end < kstDay(now)) return no('date', '이미 지난 날짜예요.');
  if (daysBetween(start, end) > ADS.bookMax) return no('date', `한 번에 ${ADS.bookMax}일까지 잡을 수 있어요.`);
  return { ok: true, v: { p, s, start, end, ...kstRange(start, end) } };
}
/** The booking a screen shows at `now`: a sponsor9 booking inside its minute covers every screen; else that screen's own. */
export function adShowing(list, screen, now) {
  if (!Array.isArray(list)) return null;
  if (nineOn(now)) for (const x of list) if (x && x.p === 'sponsor9' && x.a <= now && now < x.b) return x;
  for (const x of list) if (x && x.p !== 'sponsor9' && x.s === screen && x.a <= now && now < x.b) return x;
  return null;
}
/**
 * What an ad screen paints: { kind: 'ad', ad } for a booking, { kind: 'house' } (이 화면에 광고하세요 · /ads) while ADS_ON
 * is on, else { kind: 'city' }. Bookings show whether the switch is on or off: the operator scheduled them by hand.
 */
export function adView(ads, screen, now) {
  const ad = adShowing(ads?.list, screen, now);
  if (ad) return { kind: 'ad', ad };
  return { kind: ads?.on ? 'house' : 'city' };
}
/** The public copy of a booking that /rt/world carries (no request, contact or report token). */
export function adPublic(x) {
  return { id: String(x.id), p: String(x.p), s: String(x.s), a: Number(x.a), b: Number(x.b), l: (x.l || []).slice(0, 3).map((t, i) => clean(t, ADS.lineMax[i])), e: String(x.e || '📢'), th: AD_THEMES.includes(x.th) ? x.th : 'cyber_navy', u: adLink(x.u) || '' };
}
/** /rt/world's `ads` as a client reads it: { on, list } with each entry checked; a missing or broken key is off and empty. */
export function adWorld(v) {
  const list = Array.isArray(v?.list) ? v.list.filter((x) => x && /^[0-9a-f]{12}$/.test(String(x.id || '')) && AD_PRODUCT_IDS.includes(x.p) && (x.s === '*' || isAdScreen(x.s)) && Number.isFinite(Number(x.a)) && Number.isFinite(Number(x.b))).slice(0, 40).map(adPublic) : [];
  return { on: v?.on === 1 || v?.on === true, list };
}

// ---- numbers for the /ads page and the reports ---------------------------------------------------------------------
/** rows: [{ d, v }] plaza visitors per KST day (accounts that entered the plaza). The last `n` finished days before today. */
export function adAudience(rows, today, n = 7) {
  const by = new Map((rows || []).map((r) => [String(r.d), Math.max(0, Math.floor(Number(r.v)) || 0)]));
  const days = [];
  for (let i = n; i >= 1; i--) { const d = addDays(today, -i); days.push({ d, visitors: by.get(d) || 0 }); }
  const sum = days.reduce((a, x) => a + x.visitors, 0), known = days.filter((x) => by.has(x.d)).length;
  return { days, sum, avg: known ? Math.round(sum / known) : 0, known };
}
