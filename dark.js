// 불 꺼지기 전 알림 without the cron: when a held board's two notices fall due, and their copy. Pure; the Worker's Meter instance 'dark' keeps the
// rows (slot, holder, lit_until, notice flags) and one alarm at the earliest pending notice.
import { slotName } from './balance.js';

export const DARK = Object.freeze({ preMs: 6 * 3600e3, quietFrom: 23, quietTo: 8, retryMs: 30 * 60e3, passMax: 6 }); // passMax: due rows per alarm pass
const KST = 9 * 3600e3, H = 3600e3, D = 864e5;
// t, or the next 08:00 KST when t falls in the quiet hours 23:00–08:00 KST.
export function quietShift(t) { const k = Number(t) + KST, h = new Date(k).getUTCHours(); if (h >= DARK.quietTo && h < DARK.quietFrom) return Number(t);
  return Math.floor(k / D) * D + DARK.quietTo * H + (h >= DARK.quietFrom ? D : 0) - KST; }
// A row { lit, pre, out } -> its next notice { at, stage: 'pre' | 'out' } or null. The 6-hour notice is skipped when quiet hours push it to less than
// an hour before dark (the dark notice would follow right after).
export function darkNext(r) { const lit = Number(r?.lit) || 0; if (!lit) return null; const p = quietShift(lit - DARK.preMs);
  if (!r.pre && lit - p >= H) return { at: p, stage: 'pre' }; if (!r.out) return { at: quietShift(lit), stage: 'out' }; return null; }
// Whole hours left, 1..6 (a 6-hour notice moved to 08:00 says how long is really left).
export const darkHours = (lit, now) => Math.min(6, Math.max(1, Math.ceil((Number(lit) - Number(now)) / H)));
export function darkText(stage, slot, h = 6) { const name = slotName(String(slot || ''));
  return stage === 'out' ? `${name} 불이 꺼졌어요. 다른 사람이 가져가기 전에 다시 켜세요.` : `🕯️ ${name} 불이 ${Math.floor(Number(h)) || 6}시간 뒤에 꺼져요. 지금 켜면 72시간 더 켜져요.`; }
// A billboard row's clock (lit_until, else expires_at) in ms; 0 when it has none.
export const litOf = (b) => { const t = Date.parse(b?.lit_until || b?.expires_at || ''); return Number.isFinite(t) ? t : 0; };
