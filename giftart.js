// 선물 전광판 artwork on a 2D canvas: the plaza screen (ts3d/screens.js), the light pages' live preview and film (giftpage.js,
// giftfilm.js) and the link-preview card (1200 x 630). Browser only (no three.js, no fonts of its own: the system stack is enough on a
// phone and the plaza's Pretendard is used when it is there). Text is only ever drawn with fillText.
// 2026-11-28 (A. LED 전광판, the owner: no LED dot texture): a board is one flat colour (giftrules.js GIFT_THEMES f) in a black frame,
// its words left-aligned in the theme's two inks (k, t), the day's line icon (uiicons.js, the same set as the pages) and a black ticker
// band along the foot with the amber words (From · 친구 메시지 · WISH BOARD). No gradient, light, vignette, confetti or emoji.
import { OCCASIONS, GIFT_THEMES, CER_TEXT, toLine, isMe } from './giftrules.js';
import { ICONS } from './uiicons.js?v=202611280944';

export const GIFT_SANS = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
export const TICKER = Object.freeze({ bg: '#000000', ink: '#ffb020' }); // the band along a board's foot: black, the marquee amber
const arr = (s) => Array.from(String(s ?? ''));

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
// A small seeded generator: the same seed, the same numbers (the film's scene is seeded by the board id).
export function seeded(seed) { let h = 2166136261 >>> 0; for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return () => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0; return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }

export function themeOf(g) { return GIFT_THEMES[g?.th] || GIFT_THEMES[OCCASIONS[g?.occ]?.th] || GIFT_THEMES.party; }

// A chip's words without a leading emoji (callers such as todo.js still pass '🎉 오늘 할 일 완료'; a board shows words and line icons only).
export const plainWords = (s) => String(s ?? '').replace(/^(?:[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}][\u{FE0F}\u{200D}\p{Extended_Pictographic}]*\s*)+/u, '').trim();

// The ground the plaza cards share (paintGift, paintWelcome, paintTeaser): a black frame and the theme's one flat colour inside it, with a
// hairline so the black board (밤하늘) still reads as a board. The context is
// saved here and left with textBaseline 'middle': the painter draws its words and restores it. -> { c, W, H, k, pad, x0, x1 }: x0..x1 the
// words' left and right edges.
function paintGround(canvas, T) {
  const c = canvas.getContext('2d'), W = canvas.width, H = canvas.height, k = Math.min(W / 1024, H / 576);
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#000000'; c.fillRect(0, 0, W, H);
  const pad = 30 * k, e = pad * 0.5;
  c.fillStyle = T.f; c.fillRect(e, e, W - 2 * e, H - 2 * e);
  c.lineWidth = Math.max(1, 2 * k); c.strokeStyle = 'rgba(255,255,255,0.16)'; c.strokeRect(e, e, W - 2 * e, H - 2 * e);
  c.textBaseline = 'middle';
  return { c, W, H, k, pad, x0: e + 40 * k, x1: W - e - 40 * k };
}
// A line icon of uiicons.js at (x, y) (its top left), size px square, stroked in ink. Nothing where Path2D is missing (the tests' node).
function paintIcon(c, name, x, y, size, ink) {
  const shapes = ICONS[name];
  if (!shapes || typeof Path2D !== 'function') return;
  c.save(); c.translate(x, y); c.scale(size / 24, size / 24);
  c.strokeStyle = ink; c.lineWidth = 2; c.lineCap = 'round'; c.lineJoin = 'round';
  for (const s of shapes) {
    if (typeof s === 'string') { c.stroke(new Path2D(s)); continue; }
    const [tag, a, b, w, h, r] = s; c.beginPath();
    if (tag === 'circle') c.arc(a, b, w, 0, Math.PI * 2);
    else if (tag === 'ellipse') c.ellipse(a, b, w, h, 0, 0, Math.PI * 2);
    else if (tag === 'rect') { if (c.roundRect) c.roundRect(a, b, w, h, r || 0); else c.rect(a, b, w, h); }
    c.stroke();
  }
  c.restore();
}
// A label in a top corner: words (no pill), the day's icon before them when `ico`; its left edge at x, or its right edge when `right`.
function paintLabel(c, k, text, x, y, right, ink, ico = '') {
  const words = plainWords(text);
  c.font = `800 ${Math.round(28 * k)}px ${GIFT_SANS}`;
  const s = Math.round(32 * k), gap = ico ? s + 10 * k : 0, w = c.measureText(words).width + gap, x0 = right ? x - w : x;
  if (ico) paintIcon(c, ico, x0, y - s / 2, s, ink);
  c.fillStyle = ink; c.textAlign = 'left'; c.fillText(words, x0 + gap, y + 1);
}
// The ticker band along the foot: black, amber words from the left (cut with an ellipsis when long). -> its top.
function paintBand(c, W, H, k, pad, words) {
  const e = pad * 0.5, bh = Math.round(66 * k), top = H - e - bh;
  c.fillStyle = TICKER.bg; c.fillRect(e, top, W - 2 * e, bh);
  c.fillStyle = TICKER.ink; c.textAlign = 'left'; c.font = `800 ${Math.round(28 * k)}px ${GIFT_SANS}`;
  const maxW = W - 2 * e - 80 * k; let t = String(words);
  if (c.measureText(t).width > maxW) { const a = Array.from(t); while (a.length && c.measureText(a.join('') + '…').width > maxW) a.pop(); t = a.join('').trimEnd() + '…'; }
  c.fillText(t, e + 40 * k, top + bh / 2 + 1);
  return top;
}

// g: { id, to, from, occ, msg, th, n, lk }. opts: { strip: the band's words in place of From and the count, chip: false to drop the
// "선물 전광판" label, brand: the link card's band (adds the virtual plaza's name), glow: kept for old callers, draws nothing }.
export function paintGift(canvas, g = {}, opts = {}) {
  const T = themeOf(g), O = OCCASIONS[g.occ] || OCCASIONS.bday;
  const { c, W, H, k, pad, x0, x1 } = paintGround(canvas, T);
  const top = pad * 0.5 + 52 * k;
  // Labels: "선물 전광판" left, the day's icon and words right.
  if (opts.chip !== false) paintLabel(c, k, isMe(g) ? '내 전광판' : '선물 전광판', x0, top, false, T.t);
  paintLabel(c, k, O.head, x1, top, true, T.t, O.icon);
  // To. name (by name on a board of one's own, giftrules.js toLine): the biggest line. Then the message (two lines at most).
  const to = toLine(g);
  c.textAlign = 'left';
  const ts = fitSize(c, to, x1 - x0, 124 * k, 46 * k, 900);
  c.font = `900 ${ts}px ${GIFT_SANS}`; c.fillStyle = T.k; c.fillText(to, x0, H * 0.4);
  const msg = String(g.msg || '').trim() || O.hint;
  let ms = 52 * k; c.font = `800 ${Math.round(ms)}px ${GIFT_SANS}`;
  let lines = wrapText(msg, x1 - x0, (t) => c.measureText(t).width, 2);
  if (lines.length > 1) { ms = 44 * k; c.font = `800 ${Math.round(ms)}px ${GIFT_SANS}`; lines = wrapText(msg, x1 - x0, (t) => c.measureText(t).width, 2); }
  c.fillStyle = T.t;
  const y0 = H * 0.4 + ts * 0.5 + ms * 0.95;
  lines.forEach((l, i) => c.fillText(l, x0, y0 + i * ms * 1.18));
  // The band: From, the count, WISH BOARD (or the caller's strip), the plaza's name on the link card.
  const from = isMe(g) ? '' : String(g.from || '').trim(), n = Math.max(0, Math.floor(Number(g.n) || 0));
  const parts = opts.strip ? [String(opts.strip)] : [from ? 'From. ' + from : '', n ? (isMe(g) ? '응원 메시지 ' : '친구 메시지 ') + n + '개' : '', 'WISH BOARD'];
  if (opts.brand) parts.push('뉴욕 타임스퀘어 가상 광장');
  paintBand(c, W, H, k, pad, parts.filter(Boolean).join('  ·  '));
  c.restore();
}

// 어디에 걸리나 (giftpage.js: the maker's live preview, the owner page's head): the board as one screen on the virtual street, laid in
// perspective on the right-hand wall over a capture of the 3D plaza's street at night (icons/street.jpg, og.jpg's ground and the boot
// card's on a wide screen). img: that picture once it has loaded, or null (then a black street of its own, the board in the same place, so nothing jumps).
// The quad is a fraction of the canvas: x0..x1, the far (left) edge's top and bottom, the near (right) edge's. The board's own drawing
// (paintGift) is laid on it in strips with a perspective-correct step, so the far side is the narrower one.
export const STREET_QUAD = Object.freeze({ x0: 0.3, x1: 0.985, l: Object.freeze([0.15, 0.76]), r: Object.freeze([0.05, 0.87]) });
let BOARD_CV = null;
export function paintStreet(canvas, g = {}, img = null, opts = {}) {
  const c = canvas.getContext('2d'), W = canvas.width, H = canvas.height, Q = STREET_QUAD;
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  if (img && img.width) { // cover, a little lower than the middle (the street's vanishing point stays in sight)
    const s = Math.max(W / img.width, H / img.height), w = img.width * s, h = img.height * s;
    c.drawImage(img, (W - w) / 2, (H - h) * 0.45, w, h);
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, 0, W, H);
  } else { // a black street of its own: a few dark towers, so nothing jumps when the picture comes
    c.fillStyle = '#000000'; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 5; i++) { c.fillStyle = ['#141414', '#1c1c1c', '#121212', '#202020', '#161616'][i]; c.fillRect(W * (0.02 + i * 0.05), H * (0.18 + i * 0.07), W * 0.045, H * (0.32 - i * 0.04)); }
  }
  // the board, drawn once at its own size, then laid on the wall
  if (typeof document !== 'undefined' && document.createElement) {
    if (!BOARD_CV) { BOARD_CV = document.createElement('canvas'); BOARD_CV.width = 1024; BOARD_CV.height = 576; }
    paintGift(BOARD_CV, g, opts);
    const X0 = Q.x0 * W, X1 = Q.x1 * W, lt = Q.l[0] * H, lb = Q.l[1] * H, rt = Q.r[0] * H, rb = Q.r[1] * H, hl = lb - lt, hr = rb - rt;
    c.beginPath(); c.moveTo(X0, lt); c.lineTo(X1, rt); c.lineTo(X1, rb); c.lineTo(X0, lb); c.closePath(); c.fillStyle = '#000000'; c.fill();
    const N = 96, sw = BOARD_CV.width / N, at = (u) => (u * hr) / ((1 - u) * hl + u * hr); // screen fraction of board fraction u
    for (let i = 0; i < N; i++) {
      const t0 = at(i / N), t1 = at((i + 1) / N), tm = (t0 + t1) / 2;
      const x = X0 + (X1 - X0) * t0, w = (X1 - X0) * (t1 - t0) + 0.8, top = lt + (rt - lt) * tm, bot = lb + (rb - lb) * tm;
      c.drawImage(BOARD_CV, i * sw, 0, sw, BOARD_CV.height, x, top, w, bot - top);
    }
    c.beginPath(); c.moveTo(X0, lt); c.lineTo(X1, rt); c.lineTo(X1, rb); c.lineTo(X0, lb); c.closePath();
    c.lineWidth = Math.max(3, 9 * (W / 1024)); c.strokeStyle = '#000000'; c.stroke();
    c.lineWidth = Math.max(1, 2 * (W / 1024)); c.strokeStyle = 'rgba(255,255,255,0.22)'; c.stroke();
  }
  c.restore();
}

// 환영 전광판 (ts3d/screens.js pinWelcome): the newcomer's own name on a plaza screen, drawn on their device only. name is cut to 12 code
// points here; line is the fixed words under it (ftue.js WELCOME.line). The gift board's ground, labels and fonts, in the 밤하늘 theme.
// chip: the top-left label (the 오늘 할 일 card's '오늘 할 일 완료', todo.js cardText; a leading emoji is not drawn); without one it is the welcome's own.
export function paintWelcome(canvas, { name, line, chip } = {}) {
  const T = GIFT_THEMES.night, who = arr(name).slice(0, 12).join('').trim();
  const { c, W, H, k, x0, x1, pad } = paintGround(canvas, T);
  const top = pad * 0.5 + 52 * k;
  paintLabel(c, k, String(chip || '어서 와요'), x0, top, false, T.t);
  paintLabel(c, k, 'WISH BOARD', x1, top, true, T.k);
  const big = who ? who + ' 님' : '환영해요';
  c.textAlign = 'left';
  const ts = fitSize(c, big, x1 - x0, 124 * k, 46 * k, 900);
  c.font = `900 ${ts}px ${GIFT_SANS}`; c.fillStyle = T.k; c.fillText(big, x0, H * 0.45);
  const sub = String(line ?? '').trim();
  if (sub) { c.font = `800 ${fitSize(c, sub, x1 - x0, 50 * k, 26 * k)}px ${GIFT_SANS}`; c.fillStyle = T.t; c.fillText(sub, x0, H * 0.68); }
  c.restore();
}

// 점등식 teaser (ts3d/screens.js pinGift with cer, before the start): t is giftrules.js cerTeaser's fields and nothing else is read, so the
// message and the sender never reach this canvas. The gift board's ground in the board's theme, the label (곧 켜져요) left, WISH BOARD
// right, 'To. name' big (12 code points), '18:00에 켜져요' and the time left (mm:ss) under it (the day's emoji is not drawn).
export function paintTeaser(canvas, t = {}) {
  const T = GIFT_THEMES[t?.th] || GIFT_THEMES.party, to = arr(t?.to).slice(0, 12).join('').trim() || '당신';
  const { c, W, H, k, x0, x1, pad } = paintGround(canvas, T);
  const top = pad * 0.5 + 52 * k;
  paintLabel(c, k, String(t?.chip || CER_TEXT.soon), x0, top, false, T.t);
  paintLabel(c, k, 'WISH BOARD', x1, top, true, T.t);
  const big = (t?.by ? 'by ' : 'To. ') + to; // by: a board of one's own (cerTeaser)
  c.textAlign = 'left';
  const ts = fitSize(c, big, x1 - x0, 112 * k, 46 * k, 900);
  c.font = `900 ${ts}px ${GIFT_SANS}`; c.fillStyle = T.k; c.fillText(big, x0, H * 0.37);
  const when = String(t?.when || '');
  if (when) {
    const line = when + '에 켜져요';
    c.font = `800 ${fitSize(c, line, x1 - x0, 50 * k, 26 * k)}px ${GIFT_SANS}`; c.fillStyle = T.t; c.fillText(line, x0, H * 0.58);
  }
  const left = String(t?.left || '');
  if (left) { c.font = `900 ${Math.round(92 * k)}px ${GIFT_SANS}`; c.fillStyle = T.k; c.fillText(left, x0, H * 0.78); }
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
