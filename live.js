export function nextBallUntil(now, open) {
  const kst = new Date(now + 9 * 3600000);
  const y = kst.getUTCFullYear(), m = kst.getUTCMonth(), d = kst.getUTCDate();
  const hour = open ? 21 : 21;
  const minute = open ? 10 : 0;
  let stamp = Date.UTC(y, m, d, hour - 9, minute, 0);
  if (!open && stamp <= now) stamp = Date.UTC(y, m, d + 1, hour - 9, minute, 0);
  return stamp;
}

// 밤 9시 (client only). The main tower is a prime screen (primerules.js): 21:00-22:00 KST it shows the team with the most distinct supporters
// before 21:00 (the 9 pm team). t is the client clock plus the server offset (clockSkew). Banner 20:50-21:10; yesterday's wish king 21:00-21:01
// on the ordinary boards. balance.js ballOpen still names the 21:00-21:10 show (the crystal ball, the hologram).
const DAY_MS = 864e5, H21 = 21 * 3600e3;
// The browser's server offset (main.js sets clock.off once from clockSkew). The Worker never sets it, so nowMs() is Date.now().
export const clock = { off: 0 };
export function nowMs() { return Date.now() + clock.off; }
// overLit: the king's minute also covers boards a holder has lit; false keeps it to boards with no live holder (the owner's switch).
export const NINE = Object.freeze({ pre: H21 - 600e3, open: H21, king: H21 + 60e3, close: H21 + 600e3, overLit: true });
export function kstMsOfDay(t) { return (((Math.floor(Number(t) || 0) + 9 * 3600e3) % DAY_MS) + DAY_MS) % DAY_MS; }
/** 'pre' 20:50:00–20:59:59, 'open' 21:00:00–21:09:59, '' otherwise. */
export function ninePhase(t) { const m = kstMsOfDay(t); return m >= NINE.open && m < NINE.close ? 'open' : m >= NINE.pre && m < NINE.open ? 'pre' : ''; }
export function nineLeft(t) { const m = kstMsOfDay(t), p = ninePhase(t); return p === 'open' ? NINE.close - m : p === 'pre' ? NINE.open - m : 0; }
/** Whole seconds rounded up, so the last second of a phase reads 00:01 and never 00:00. */
export function mmss(ms) { const s = Math.max(0, Math.ceil(Number(ms) / 1000) || 0); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
/** The banner, or null when there is none. Its text changes once a second. who: { lead } before 21:00 (today's leading team so far, /rt/world
 *  teams[0]), { gold } after it (the 9 pm team's name; '' while the server has not named it, null when no team reached 10 supporters). */
export function nineBanner(t, who = {}) {
  const phase = ninePhase(t);
  if (!phase) return null;
  const left = nineLeft(t), name = (v) => Array.from(String(v || '')).slice(0, 12).join('');
  if (phase === 'pre') {
    const lead = name(who?.lead);
    return { phase, left, text: lead ? `밤 9시 메인 타워 주인공 · 지금 1위 ${lead} · ${mmss(left)}` : `밤 9시, 메인 타워 주인공이 정해져요 · ${mmss(left)}` };
  }
  const gold = who?.gold === null ? null : name(who?.gold);
  return { phase, left, text: gold ? `지금 메인 타워 · 9시 주인공 ${gold}` : gold === null ? '오늘 밤 9시는 어제의 소원왕 · 내일 9시 주인공에 도전해요' : `9시 주인공을 정하는 중이에요 · ${mmss(left)}` };
}
/** Yesterday's top wish takes the non-main boards 21:00:00–21:00:59, only when there is one. */
export function kingMinute(t, king) { const m = kstMsOfDay(t); return !!(king && String(king.txt || '')) && m >= NINE.open && m < NINE.king; }
/** Whether the king card may go on a board in that minute: always while NINE.overLit, else only when no holder has it lit. */
export function kingCovers(lit, overLit = NINE.overLit) { return !!overLit || !lit; }
/** Server clock minus client clock from an HTTP Date header (1 s resolution, so +500 ms; sent/got bracket the request).
 *  Under 2 s it is noise and gives 0; more than 12 h is a broken header and gives 0. A round trip over 3 s gives 0 too:
 *  the error can be half of it. */
export function clockSkew(date, sentAt, gotAt) {
  const s = Date.parse(String(date || ''));
  if (!Number.isFinite(s) || !Number.isFinite(sentAt) || !Number.isFinite(gotAt) || gotAt - sentAt > 3000) return 0;
  const skew = Math.round(s + 500 - (sentAt + gotAt) / 2);
  return Math.abs(skew) < 2000 || Math.abs(skew) > 12 * 3600e3 ? 0 : skew;
}
/** A main tower face nobody keeps lit, else the lowest (kept for old callers; the banner now opens the prime screen sheet). */
export function nineSlot(rows, now = Date.now()) {
  const list = Array.isArray(rows) ? rows : [];
  for (const id of ['MAIN_LOW', 'MAIN_BOT', 'MAIN_MID', 'MAIN_TOP', 'MAIN_UP']) {
    const b = list.find((r) => r?.slot_id === id);
    const until = b && Date.parse(b.lit_until || b.expires_at || '');
    if (!b?.holder_id || !(until > now)) return id;
  }
  return 'MAIN_LOW';
}

export function applyBall(msg) {
  if (!msg || msg.t !== 'BALL') return '';
  return msg.open ? '21:10까지 메인 타워가 열려 있어요' : '메인 타워는 밤 9시에 10분 열려요';
}

export function ballNotice(wasOpen, msg) {
  const open = !!msg?.open;
  if (open === !!wasOpen) return '';
  return applyBall(msg);
}

export function applyOps(ops) {
  if (!ops || !ops.copy) return '';
  return String(ops.copy).slice(0, 80);
}
