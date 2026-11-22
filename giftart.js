// 선물 전광판 artwork on a 2D canvas: the plaza screen (ts3d/screens.js), the light pages' live preview and film (giftpage.js,
// giftfilm.js) and the link-preview card (1200 x 630). Browser only (no three.js, no fonts of its own: the system stack is enough on a
// phone and the plaza's Pretendard is used when it is there). Text is only ever drawn with fillText.
import { OCCASIONS, GIFT_THEMES } from './giftrules.js';

export const GIFT_SANS = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
const arr = (s) => Array.from(String(s ?? ''));

function rr(g, x, y, w, h, r) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + k, y); g.arcTo(x + w, y, x + w, y + h, k); g.arcTo(x + w, y + h, x, y + h, k); g.arcTo(x, y + h, x, y, k); g.arcTo(x, y, x + w, y, k);
  g.closePath();
}
// The biggest size from `size` down to `min` at which text fits maxW.
export function fitSize(g, text, maxW, size, min, weight = 800) {
  let s = Math.round(size);
  for (; s > min; s -= Math.max(1, Math.round(s * 0.06))) { g.font = `${weight} ${s}px ${GIFT_SANS}`; if (g.measureText(text).width <= maxW) return s; }
  return Math.round(min);
}
// At most `lines` lines that fit maxW (words kept whole when they can be), the last one cut with an ellipsis.
export function wrapText(text, maxW, measure, lines = 2) {
  const out = []; let cur = '';
  for (const ch of arr(text)) {
    const t = cur + ch;
    if (cur && measure(t) > maxW) {
      const sp = cur.lastIndexOf(' ');
      if (sp > 0 && ch !== ' ') { out.push(cur.slice(0, sp)); cur = cur.slice(sp + 1) + ch; } else { out.push(cur); cur = ch === ' ' ? '' : ch; }
    } else cur = t;
  }
  if (cur) out.push(cur);
  if (out.length <= lines) return out;
  const keep = out.slice(0, lines); let last = arr(keep[lines - 1]);
  while (last.length && measure(last.join('') + '…') > maxW) last.pop();
  keep[lines - 1] = last.join('').trimEnd() + '…';
  return keep;
}
// A small seeded generator, so one board always gets the same confetti.
export function seeded(seed) { let h = 2166136261 >>> 0; for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return () => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0; return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }

export function themeOf(g) { return GIFT_THEMES[g?.th] || GIFT_THEMES[OCCASIONS[g?.occ]?.th] || GIFT_THEMES.party; }

// g: { id, to, from, occ, msg, th, n, lk }. opts: { strip: a bottom line, chip: false to drop the "선물 전광판" chip, brand: the card's
// bottom bar, glow: 0..1 (the film pulses it) }.
export function paintGift(canvas, g = {}, opts = {}) {
  const c = canvas.getContext('2d'), W = canvas.width, H = canvas.height, k = Math.min(W / 1024, H / 576);
  const T = themeOf(g), O = OCCASIONS[g.occ] || OCCASIONS.bday, rnd = seeded(g.id || g.to || 'gift');
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  // Ground: the theme's two colours across the face, a soft light from the top left, a darker frame.
  const bg = c.createLinearGradient(0, 0, W, H); bg.addColorStop(0, T.a); bg.addColorStop(1, T.b);
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  const glow = c.createRadialGradient(W * 0.28, H * 0.18, 0, W * 0.28, H * 0.18, W * 0.75);
  glow.addColorStop(0, `rgba(255,255,255,${0.22 + 0.12 * (opts.glow || 0)})`); glow.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = glow; c.fillRect(0, 0, W, H);
  const vig = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.72); vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.38)');
  c.fillStyle = vig; c.fillRect(0, 0, W, H);
  // Confetti: dots and short ribbons, kept off the middle where the words sit.
  for (let i = 0; i < 46; i++) {
    const x = rnd() * W, y = rnd() * H, mid = Math.abs(x - W / 2) < W * 0.34 && Math.abs(y - H * 0.52) < H * 0.3;
    if (mid) continue;
    c.globalAlpha = 0.35 + rnd() * 0.45;
    c.fillStyle = [T.hi, '#ffffff', T.a, '#ffd1ea', '#b9f6ff'][i % 5];
    if (i % 3) { c.beginPath(); c.arc(x, y, (2 + rnd() * 5) * k, 0, Math.PI * 2); c.fill(); }
    else { c.save(); c.translate(x, y); c.rotate(rnd() * Math.PI); c.fillRect(-9 * k, -2.5 * k, 18 * k, 5 * k); c.restore(); }
  }
  c.globalAlpha = 1;
  const pad = 30 * k;
  rr(c, pad * 0.5, pad * 0.5, W - pad, H - pad, 26 * k); c.lineWidth = Math.max(2, 5 * k); c.strokeStyle = T.hi; c.globalAlpha = 0.8; c.stroke(); c.globalAlpha = 1;
  c.textBaseline = 'middle';
  // Chips: "🎁 선물 전광판" left, the day's words right.
  const chip = (text, x, y, right, bgc, ink) => {
    c.font = `800 ${Math.round(26 * k)}px ${GIFT_SANS}`;
    const w = c.measureText(text).width + 34 * k, h = 46 * k, x0 = right ? x - w : x;
    rr(c, x0, y, w, h, h / 2); c.fillStyle = bgc; c.fill();
    c.fillStyle = ink; c.textAlign = 'center'; c.fillText(text, x0 + w / 2, y + h / 2 + 1);
  };
  if (opts.chip !== false) chip('🎁 선물 전광판', pad * 1.3, pad * 1.25, false, 'rgba(8,6,28,0.55)', '#ffffff');
  chip(O.emoji + ' ' + O.head, W - pad * 1.3, pad * 1.25, true, T.hi, T.deep);
  // To. name: the biggest line. Then the message (two lines at most), then From.
  const to = 'To. ' + (String(g.to || '').trim() || '당신');
  c.textAlign = 'center';
  const ts = fitSize(c, to, W - pad * 4, 118 * k, 46 * k, 900);
  c.font = `900 ${ts}px ${GIFT_SANS}`;
  c.lineWidth = Math.max(3, ts * 0.09); c.strokeStyle = 'rgba(10,4,30,0.35)'; c.strokeText(to, W / 2, H * 0.4);
  c.fillStyle = T.hi; c.fillText(to, W / 2, H * 0.4);
  const msg = String(g.msg || '').trim() || O.hint;
  let ms = 54 * k; c.font = `800 ${Math.round(ms)}px ${GIFT_SANS}`;
  let lines = wrapText(msg, W - pad * 4, (t) => c.measureText(t).width, 2);
  if (lines.length > 1) { ms = 46 * k; c.font = `800 ${Math.round(ms)}px ${GIFT_SANS}`; lines = wrapText(msg, W - pad * 4, (t) => c.measureText(t).width, 2); }
  c.fillStyle = T.ink;
  const y0 = H * 0.62 - ((lines.length - 1) * ms * 1.18) / 2;
  lines.forEach((l, i) => c.fillText(l, W / 2, y0 + i * ms * 1.18));
  c.font = `700 ${Math.round(32 * k)}px ${GIFT_SANS}`; c.globalAlpha = 0.92;
  const from = String(g.from || '').trim();
  const bottom = opts.brand ? H * 0.9 - pad * 1.1 : H - pad * 1.55;
  if (opts.strip) { c.textAlign = 'center'; c.fillText(opts.strip, W / 2, bottom); }
  else {
    if (from) { c.textAlign = 'left'; c.fillText('From. ' + from, pad * 1.4, bottom); }
    const n = Math.max(0, Math.floor(Number(g.n) || 0));
    if (n) { c.textAlign = from ? 'right' : 'center'; c.fillText('💌 친구 메시지 ' + n + '개', from ? W - pad * 1.4 : W / 2, bottom); }
  }
  c.globalAlpha = 1;
  if (opts.brand) {
    const bh = Math.round(H * 0.1);
    c.fillStyle = 'rgba(5,6,16,0.78)'; c.fillRect(0, H - bh, W, bh);
    c.fillStyle = '#ffe7a8'; c.textAlign = 'left'; c.font = `800 ${Math.round(bh * 0.4)}px ${GIFT_SANS}`;
    c.fillText('WISH BOARD · 뉴욕 타임스퀘어 가상 광장', bh * 0.5, H - bh / 2);
  }
  c.restore();
}

// The link-preview card (og:image): 1200 x 630 JPEG, under 300 KB. -> Blob | null.
export async function giftCardJpeg(g) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 630;
  paintGift(cv, g, { brand: true });
  for (const q of [0.86, 0.76, 0.66]) {
    const b = await new Promise((r) => { try { cv.toBlob(r, 'image/jpeg', q); } catch { r(null); } });
    if (b && b.size <= 290000) return b;
  }
  return null;
}
