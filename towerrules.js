// 메인 타워 축하 1분 (docs/superpowers/specs/2026-11-27-main-tower-minute-design.md): the pure rules shared by the Worker (giftsrv.js), the
// gift pages (giftpage.js), the plaza (ts3d/screens.js, main.js, gift.js, ui.js) and the tests. No I/O, no clock of its own: every function
// takes the time it judges. The Worker bundles this module, so it is imported with no query everywhere (tools/stamp.mjs).
//
// A gift board's owner may put it on all five main tower faces (MAIN_*) for one wall-clock minute inside its own window, 30 minutes a KST
// day, first come first served: (A) once 10 different networks reacted on its page (a 💖 with the human check, or a 롤링페이퍼 line), the
// maker's own network never counting, or (B) for 2,000 응원 포인트 (accounts only, once in 30 days). Never on the hour (the anniversary
// teams' minute), never in the 21 o'clock hour (the 9 pm team), never within 5 minutes. Nothing about how a minute was won is ever shown.
import { OCC_KEYS, kstDay, giftPhase } from './giftrules.js';

export const TOWER = Object.freeze({
  perDay: 30,             // minutes a KST day (the day of the minute)
  leadMs: 5 * 60e3,       // a minute must start at least this far ahead (the plaza's copies catch up meanwhile)
  minMs: 60e3,
  friends: 10,            // path A: different networks that reacted on the board's page
  price: 2000,            // path B: 응원 포인트, accounts only
  gapDays: 30,            // path B: once in 30 days per account (from the booking)
  goldHour: 21,
  slots: Object.freeze(['MAIN_UP', 'MAIN_TOP', 'MAIN_MID', 'MAIN_BOT', 'MAIN_LOW']),
  face: 'MAIN_MID',       // where ?gb=<id> takes the camera in that minute
  worldAhead: 26 * 36e5,  // /rt/world carries bookings starting in the next 26 hours
  worldMax: 60,
  payMax: 10,             // share rewards one beacon batch may hand to the Worker (subrequests)
});
// 공유 보상 (owner, 2026-11-27): a friend who came through the maker's link and reacted pays the maker, wherever the link went: a gift board
// page (💖 with the human check, or a 롤링페이퍼 line), a wish link (/rt/w/<id>, then 💖 on that wish within windowMs) or a board link
// (/rt/card/<slot>, then 응원 on that board within windowMs, while the same holder has it). One network counts once per maker and KST day
// over all three; the maker's own network and account never. The n-th friend of the maker's day pays steps' amount: acct when the friend
// is a linked account (not a guest or an anonymous login), guest otherwise; past the last step nothing (still counted).
export const SHARE = Object.freeze({
  steps: Object.freeze([Object.freeze({ upTo: 10, acct: 50, guest: 10 }), Object.freeze({ upTo: 30, acct: 20, guest: 10 })]),
  windowMs: 24 * 36e5,      // a link open counts for a reaction this long
  openKeepMs: 2 * 864e5,    // link opens are kept this long
  dayKeep: 8,               // KST days the per-maker friend rows are kept (the operator's 7-day list)
  contentKeepMs: 7 * 864e5, // friends per wish / board link, for "친구 N명이 응원했어요"
  makerKeepMs: 30 * 864e5,  // the networks a maker made or claimed from (renewed each time)
  adminDays: 7, adminTop: 50,
});
/** What the n-th friend of a maker's KST day pays (0 past the steps or for a non-number). acct: a linked account. */
export function shareAmount(n, acct) {
  if (!Number.isInteger(n) || n < 1) return 0;
  const s = SHARE.steps.find((x) => n <= x.upTo);
  return s ? (acct ? s.acct : s.guest) : 0;
}
/** The most one maker can get in a KST day (every friend an account, or every one a guest). */
export function shareDayMax(acct = true) { let n = 0, from = 0; for (const s of SHARE.steps) { n += (s.upTo - from) * (acct ? s.acct : s.guest); from = s.upTo; } return n; }
/**
 * Why a reaction on a wish or a board does not count as a link friend, or ''. open: the link open from this network ({ o: the owner then,
 * at }) or null; o: { owner (now), net, uid (who reacted), now, makerNets (the maker's own networks) }. 'link': no open of this owner's link
 * from this network; 'late': not within SHARE.windowMs; 'self': the maker's own account or network.
 */
export function linkFault(open, o = {}) {
  const owner = String(o.owner || ''), net = String(o.net || ''), now = Number(o.now);
  if (!owner || !net || !open || String(open.o || '') !== owner) return 'link';
  if (String(o.uid || '') === owner || (Array.isArray(o.makerNets) && o.makerNets.map(String).includes(net))) return 'self';
  const at = Number(open.at);
  if (!(at <= now) || now - at > SHARE.windowMs) return 'late';
  return '';
}
/** The only public word of it: how many friends (uncapped), '' at 0. */
export function friendsText(n) { const k = Math.floor(Number(n)); return k > 0 ? `친구 ${k}명이 응원했어요` : ''; }
// paid: 메인 타워 주인공 (giftrules.js TIERS 3), a board whose paid order is published (no friends, no points, no 30 days between).
export const TOWER_HOW = Object.freeze(['friends', 'points', 'paid']);
// spend_plaza's answer to an amount it does not take (schema.sql). Before migrations/2026-11-27-tower-minute.sql 2,000 is one of them.
export const SPEND_OLD = '그 금액은 쓸 수 없어요.';
export const TOWER_ERR = Object.freeze({
  minute: '고를 수 없는 시간이에요. 다른 1분을 골라 주세요.',
  taken: '방금 다른 사람이 그 1분을 골랐어요. 다른 1분을 골라 주세요.',
  sold: '그날 메인 타워는 매진이에요.',
  board: '이 선물 전광판은 이미 메인 타워 시간을 골랐어요.',
  day: '메인 타워는 하루에 한 번 고를 수 있어요.',
  gap: '포인트로 올리기는 30일에 한 번이에요.',
  friends: '친구 응원 10곳이 모이면 고를 수 있어요.',
  account: '계정을 연결하면 포인트로 올릴 수 있어요.',
  poor: '포인트가 부족해요. 광장에서 방금 받은 포인트는 1분쯤 뒤에 반영돼요.',
  prep: '포인트로 올리기는 준비 중이에요.',
  paid: '메인 타워 주인공 결제가 게시된 전광판만 바로 고를 수 있어요.',
});
// '민지의 생일'. me (내 전광판): '민지의 전광판'. Every OCCASIONS key has its word (test/tower.test.mjs).
export const TOWER_WORD = Object.freeze({ bday: '생일', anniv: '기념일', pass: '합격', cheer: '응원', just: '특별한 날', thanks: '고마운 날', love: '사랑 고백', grad: '졸업·승진', me: '전광판' });

const H = 36e5;
const kstHM = (m) => { const d = new Date(Number(m) + 9 * H); return { h: d.getUTCHours(), mi: d.getUTCMinutes() }; };
const two = (n) => String(n).padStart(2, '0');
const cut = (s, n) => Array.from(String(s ?? '').replace(/\s+/g, ' ').trim()).slice(0, n).join('');
export const minuteStart = (t) => Math.floor(Number(t) / TOWER.minMs) * TOWER.minMs;
/** 'hour' (on the hour: the anniversary teams), 'gold' (the 21 o'clock hour: the 9 pm team) or ''. */
export function minuteBlock(m) { const { h, mi } = kstHM(m); return mi === 0 ? 'hour' : h === TOWER.goldHour ? 'gold' : ''; }
/** '' when minute m of board g (its window [a, b)) may be picked at now, else 'step' | 'window' | 'soon' | 'hour' | 'gold'. */
export function minuteFault(g, m, now) {
  const t = Number(m);
  if (!Number.isFinite(t) || t % TOWER.minMs !== 0) return 'step';
  if (!g || t < Number(g.a) || t + TOWER.minMs > Number(g.b)) return 'window';
  if (t < Number(now) + TOWER.leadMs) return 'soon';
  return minuteBlock(t);
}
/** Every minute of g's window: [{ m, why }] (why '' when it may be picked; 'taken' when another board has it). */
export function towerMinutes(g, now, taken = []) {
  const busy = new Set((Array.isArray(taken) ? taken : []).map(Number)), out = [];
  if (!g || !(Number(g.b) > Number(g.a))) return out;
  for (let m = Math.ceil(Number(g.a) / TOWER.minMs) * TOWER.minMs; m + TOWER.minMs <= Number(g.b); m += TOWER.minMs) out.push({ m, why: minuteFault(g, m, now) || (busy.has(m) ? 'taken' : '') });
  return out;
}
/** The KST days g's window touches (a "지금" board can cross midnight). */
export function towerDays(g) { const a = kstDay(Number(g.a)), b = kstDay(Number(g.b) - 1); return a === b ? [a] : [a, b]; }
/**
 * Why a booking is refused, or ''. o: { g (the stored board), uid (the asker), how, m, now, guest (a guest or an anonymous login),
 * boardHas (this board already has one), taken (minute m has a board), dayN (bookings on m's KST day), mine (this maker has one that day),
 * gap (a points booking of this account in the last TOWER.gapDays), friends (reacting networks), paid (the board's 메인 타워 주인공 order is
 * published, for how 'paid': it skips the friends, the points and the one-a-day-per-maker rule, never the minute rules or the 30 a day) }.
 */
export function towerFault(o = {}) {
  const g = o.g;
  if (!g || giftPhase(g, o.now) === 'gone') return 'gone';
  if (String(g.uid) !== String(o.uid || '')) return 'owner';
  if (!TOWER_HOW.includes(o.how)) return 'minute';
  if (o.boardHas) return 'board';
  if (minuteFault(g, o.m, o.now)) return 'minute';
  if (o.taken) return 'taken';
  if ((Number(o.dayN) || 0) >= TOWER.perDay) return 'sold';
  if (o.how === 'paid') return o.paid ? '' : 'paid';
  if (o.mine) return 'day';
  if (o.how === 'friends' && (Number(o.friends) || 0) < TOWER.friends) return 'friends';
  if (o.how === 'points' && o.guest) return 'account';
  if (o.how === 'points' && o.gap) return 'gap';
  return '';
}
/** A reaction on g's page counts for its friends and the share reward: another network than the maker's (g.ip), not the maker's own
 *  account (a line it wrote), and a person (human: the 💖 check passed, or Turnstile is off). */
export function reactCounts(g, { net = '', uid = '', human = true } = {}) {
  return !!g && !!g.ip && !!human && !!net && String(net) !== String(g.ip) && (!uid || String(uid) !== String(g.uid));
}
/** What the plaza gets of a booking: the board's own words (no owner, no network, no how). */
export const towerEntry = (g, m) => ({ id: String(g.id), m: Number(m), to: cut(g.to, 12), from: cut(g.from, 12), occ: OCC_KEYS.includes(String(g.occ)) ? String(g.occ) : 'bday', msg: cut(g.msg, 40), th: cut(g.th, 12) });
/** A TOWER push or a /rt/world row, cleaned (rooms and browsers both use it): an entry, { id, m, off: 1 }, or null. */
export function towerWire(d) {
  if (!d || typeof d !== 'object' || !/^[0-9a-z]{8}$/.test(String(d.id || '')) || !(Number(d.m) > 0)) return null;
  if (d.off) return { id: String(d.id), m: Number(d.m), off: 1 };
  return towerEntry(d, d.m);
}
/** The entry on the tower at t, or null (an on-the-hour or 21 o'clock entry never shows: those minutes belong to the teams). */
export function towerAt(list, t) {
  for (const e of Array.isArray(list) ? list : []) { const m = Number(e?.m); if (m <= t && t < m + TOWER.minMs && !minuteBlock(m)) return e; }
  return null;
}
export const towerKey = (e) => (e ? String(e.id) + '|' + Number(e.m) : '');
export function towerNews(e) { return `🎉 지금 메인 타워: ${cut(e?.to, 12) || '누군가'}의 ${TOWER_WORD[e?.occ] || TOWER_WORD.bday}`; }
export function towerClock(m) { const { h, mi } = kstHM(m); return two(h) + ':' + two(mi); }
/** 'none' | 'soon' (before the minute) | 'live' (in it) | 'done' (after it). */
export function towerLook(m, now) { const t = Number(m); if (!(t > 0)) return 'none'; return now < t ? 'soon' : now < t + TOWER.minMs ? 'live' : 'done'; }
/**
 * The owner's card. s: { g (the owner's view: phase, a, b), tw ({ m, how } | null), now, days ({ day: { left, mine } }), taken, friends, guest,
 * prep, gap, paid (the board has the 메인 타워 주인공 perk: how 'paid', and one booking a day per maker does not hold it back) }.
 * -> { state, … }: 'booked' | 'live' | 'done' (tw set: m), 'closed' (the window is over or no minute is left ahead), 'sold'
 * (every day of the window is full), 'mine' (this maker already has one on every day still open), 'open' ({ left, friends, need, canFriends,
 * points: 'ok' | 'account' | 'prep' | 'gap', minutes }).
 */
export function towerCard(s = {}) {
  const { g, tw, now } = s;
  if (tw && Number(tw.m) > 0) { const look = towerLook(tw.m, now); return { state: look === 'soon' ? 'booked' : look, m: Number(tw.m) }; }
  if (!g || g.phase === 'after' || g.phase === 'gone') return { state: 'closed' };
  const days = s.days || {}, day = (m) => days[kstDay(m)] || { left: TOWER.perDay, mine: false };
  const ahead = towerMinutes(g, now, s.taken).filter((x) => x.why === '' || x.why === 'taken');
  if (!ahead.some((x) => x.why === '')) return { state: 'closed' };
  const open = ahead.filter((x) => x.why === '' && day(x.m).left > 0);
  if (!open.length) return { state: 'sold' };
  const paid = !!s.paid, free = open.filter((x) => paid || !day(x.m).mine);
  if (!free.length) return { state: 'mine' };
  const minutes = towerMinutes(g, now, s.taken).map((x) => ({ m: x.m, why: x.why || (day(x.m).left <= 0 ? 'sold' : !paid && day(x.m).mine ? 'day' : '') }));
  const friends = Math.max(0, Math.floor(Number(s.friends) || 0));
  return { state: 'open', left: Math.min(...towerDays(g).map((d) => (days[d] ? days[d].left : TOWER.perDay))), friends, need: TOWER.friends, canFriends: friends >= TOWER.friends,
    points: s.guest ? 'account' : s.prep ? 'prep' : s.gap ? 'gap' : 'ok', paid, minutes };
}
