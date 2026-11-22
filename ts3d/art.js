import { auctionClosed, live, floorOf, SLOT_IDS } from '../balance.js';
import { nowMs } from '../live.js';
// Canvas painters for every procedural texture in the plaza:
// billboard artwork, LED tickers, neon signs, K-brand ads, facades, decals, name tags.
export const SANS = '"Pretendard Variable", Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
export const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

// Direction A palette. Panels stay dark and quiet; the colour of the scene lives in three sign hues plus white.
const AMBER = '#ffb020', MAGENTA = '#ff4fa3', CYAN = '#48d6f0', WHITE = '#ffffff';
const PANEL = '#0a0e20', PANEL_DIM = '#070a17', STRIP = '#060914';
const TEXT2 = '#b9bfdc', MUTED = '#8f96b8', DIM = '#666d92', DANGER = '#ff5d6c', ON_ACCENT = '#1c1300';

// Board themes a player picks: one restrained accent each (top line, label chip, frame light) on the same dark panel.
// swatch is what the theme button shows: the panel fading into the accent.
export const THEMES = {
  plain: { label: '배경 없음', accent: '#c9cfe8', accent2: '#ffffff', swatch: ['#0a0e20', '#141a2e', '#c9cfe8'] },
  cyber_navy: { label: '사이버 네이비', accent: '#48d6f0', accent2: '#ff4fa3', swatch: ['#0a0e20', '#141a2e', '#48d6f0'] },
  neon_pink: { label: 'K-POP 핑크', accent: '#ff4fa3', accent2: '#ffc2e0', swatch: ['#0a0e20', '#141a2e', '#ff4fa3'] },
  gold_luxury: { label: '골드 럭셔리', accent: '#ffb020', accent2: '#ffe2a8', swatch: ['#0a0e20', '#141a2e', '#ffb020'] },
  matrix_green: { label: '매트릭스', accent: '#3ddc97', accent2: '#c8f7e1', swatch: ['#0a0e20', '#141a2e', '#3ddc97'] },
  sunset_red: { label: '선셋 서울', accent: '#ff7a45', accent2: '#ffd0b0', swatch: ['#0a0e20', '#141a2e', '#ff7a45'] },
  bday_party: { label: '생일', accent: '#ff4fa3', accent2: '#ffb020', swatch: ['#0a0e20', '#141a2e', '#ff4fa3'], gift: true, title: 'HAPPY BIRTHDAY' },
  cheer_exam: { label: '합격 기원', accent: '#3ddc97', accent2: '#ffb020', swatch: ['#0a0e20', '#141a2e', '#3ddc97'], gift: true, title: '합격 · 대박 기원' },
  love_anniv: { label: '기념일', accent: '#ff6fb5', accent2: '#b98cff', swatch: ['#0a0e20', '#141a2e', '#ff6fb5'], gift: true, title: '특별한 기념일' },
  vip_wreath: { label: '경축 화환', accent: '#ff5d6c', accent2: '#ffb020', swatch: ['#0a0e20', '#141a2e', '#ff5d6c'], gift: true, title: '축 발전!', sub: '타임스퀘어가 인정한 슈퍼스타' },
};

export function hashStr(s) {
  let h = 2166136261;
  s = String(s ?? '');
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
export const chars = (s, n) => Array.from(String(s ?? '')).slice(0, n).join('');

function rgbOf(hex) {
  let h = String(hex || '#ffffff').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgba(hex, a) {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function mixHex(hex, to, t) {
  const a = rgbOf(hex), b = rgbOf(to);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
}
export function roundRect(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
function fit(g, text, maxW, size, weight, family, min) {
  let s = size;
  for (;;) {
    g.font = `${weight} ${Math.round(s)}px ${family}`;
    if (g.measureText(text).width <= maxW || s <= min) return Math.round(s);
    s = Math.max(min, s * 0.92);
  }
}
/** Neon lettering that stays legible: a soft halo in the ink color, a dark outline, then a crisp solid fill. */
function neon(g, text, x, y, size, family, weight, color, o = {}) {
  g.save();
  g.font = `${weight} ${size}px ${family}`;
  g.textAlign = o.align || 'left';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const glow = o.glow ?? 1;
  if (glow > 0) {
    g.shadowColor = color;
    g.shadowBlur = size * 0.48 * glow;
    g.fillStyle = color;
    g.fillText(text, x, y);
    g.shadowBlur = 0;
  }
  if (o.stroke !== false) {
    g.lineWidth = Math.max(4, size * 0.18);
    g.strokeStyle = 'rgba(2,2,10,0.92)';
    g.strokeText(text, x, y);
  }
  g.fillStyle = color;
  g.fillText(text, x, y);
  g.restore();
}
function glowDot(g, x, y, r, color, a = 1) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(color, a));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}
/** Flat, centred sign type: fitted to maxW, no glow, no stroke. */
function flatText(g, text, x, y, maxW, size, color, weight = 800, min = size * 0.4, align = 'center') {
  const s = fit(g, text, maxW, size, weight, SANS, min);
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(text, x, y);
  return s;
}
/** The sign family colour nearest to any hex: magenta, cyan or amber, or white for pale and grey inks. */
function signHue(hex) {
  const [r, gg, b] = rgbOf(hex);
  const max = Math.max(r, gg, b), d = max - Math.min(r, gg, b);
  if (!max || d / max < 0.28) return WHITE;
  let h = max === r ? ((gg - b) / d) % 6 : max === gg ? (b - r) / d + 2 : (r - gg) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h >= 8 && h < 75) return AMBER;
  if (h >= 75 && h < 255) return CYAN;
  return MAGENTA;
}
/** Pill label. mode 'soft': 16% fill and coloured text; 'solid': colour fill, dark text; 'quiet': navy fill, coloured text
 *  (over photos). x is the left edge, or the right edge when right. Returns {w, h}. */
function pill(g, x, y, text, color, size, maxW, mode = 'soft', right = false) {
  const s = fit(g, text, Math.max(10, maxW - size * 1.24), size, 700, SANS, size * 0.62);
  const pad = s * 0.62, h = Math.round(s * 1.64);
  const w = Math.min(maxW, g.measureText(text).width + pad * 2);
  const x0 = right ? x - w : x;
  roundRect(g, x0, y, w, h, h / 2);
  g.fillStyle = mode === 'solid' ? color : mode === 'quiet' ? 'rgba(20,26,46,0.92)' : rgba(color, 0.16);
  g.fill();
  g.fillStyle = mode === 'solid' ? ON_ACCENT : color;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(text, x0 + pad, y + h / 2 + s * 0.04, Math.max(1, w - pad * 2));
  return { w, h };
}
/** A drawn heart (no emoji glyph), centred on (cx, cy), about s wide. */
function heart(g, cx, cy, s, color) {
  g.beginPath();
  g.moveTo(cx, cy + s * 0.4);
  g.bezierCurveTo(cx - s * 0.62, cy + s * 0.02, cx - s * 0.48, cy - s * 0.5, cx, cy - s * 0.2);
  g.bezierCurveTo(cx + s * 0.48, cy - s * 0.5, cx + s * 0.62, cy + s * 0.02, cx, cy + s * 0.4);
  g.closePath();
  g.fillStyle = color;
  g.fill();
}
/** The board panel: flat navy, a hairline inner border, and (optionally) one thin accent line along the top edge. */
function boardPanel(g, W, H, k, accent, dim) {
  g.fillStyle = dim ? PANEL_DIM : PANEL;
  g.fillRect(0, 0, W, H);
  const lw = Math.max(1, 2 * k), inset = Math.max(3, 10 * k);
  g.strokeStyle = dim ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.14)';
  g.lineWidth = lw;
  g.strokeRect(inset + lw / 2, inset + lw / 2, W - inset * 2 - lw, H - inset * 2 - lw);
  if (accent) {
    g.fillStyle = accent;
    g.fillRect(0, 0, W, Math.max(2, Math.round(4 * k)));
  }
}
/** The bottom info strip every board shares (screens.js draws its moving strip over exactly this band). */
function infoStrip(g, W, H, h, k, text, color) {
  g.fillStyle = STRIP;
  g.fillRect(0, H - h, W, h);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(0, H - h, W, Math.max(1, Math.round(k)));
  if (!text) return;
  fit(g, text, W - 36 * k, Math.max(13, Math.round(22 * k)), 700, SANS, 11);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, W / 2, H - h / 2 + 1, W - 36 * k);
}
/** Footer row inside the panel: nickname in muted grey on the left, drawn heart and count in amber on the right, and an
 *  optional note (the takeover line) in between. count null: no heart. */
function footRow(g, W, y, k, nick, count, o = {}) {
  const size = Math.max(12, Math.round(30 * k));
  const x0 = 44 * k;
  let right = W - 44 * k;
  g.textBaseline = 'middle';
  const hc = o.dim ? rgba(AMBER, 0.55) : AMBER;
  if (count != null) {
    const txt = Math.max(0, Math.floor(Number(count) || 0)).toLocaleString('en-US');
    g.font = `800 ${size}px ${SANS}`;
    g.textAlign = 'right';
    g.fillStyle = hc;
    g.fillText(txt, right, y);
    const tw = g.measureText(txt).width;
    heart(g, right - tw - size * 0.66, y, size * 0.92, hc);
    right -= tw + size * 1.42;
  }
  let left = x0;
  if (nick) {
    g.font = `700 ${size}px ${SANS}`;
    g.textAlign = 'left';
    g.fillStyle = o.dim ? DIM : MUTED;
    const room = Math.max(1, (right - x0) * (o.note ? 0.5 : 1) - 8 * k);
    g.fillText(nick, x0, y, room);
    left = x0 + Math.min(room, g.measureText(nick).width) + 24 * k;
  }
  if (o.note && right - left > 40 * k) {
    fit(g, o.note, right - left, Math.round(size * 0.8), 700, SANS, 11);
    g.textAlign = 'right';
    g.fillStyle = TEXT2;
    g.fillText(o.note, right - 8 * k, y, right - left);
  }
}
/** Two lines for a long main line: the space nearest the middle (within the middle half), else the middle glyph for
 *  scripts without spaces. Latin text without a space is never cut mid-word. */
function splitTwo(text) {
  const gl = wishGlyphs(text);
  if (gl.length < 4) return [text];
  const mid = gl.length / 2;
  let cut = -1, best = Infinity;
  for (let i = 1; i < gl.length - 1; i++) {
    if (gl[i] !== ' ' || i < gl.length * 0.25 || i > gl.length * 0.75) continue;
    const d = Math.abs(i - mid);
    if (d < best) { best = d; cut = i; }
  }
  if (cut < 0 && /[A-Za-z]/.test(text)) return [text];
  const a = (cut > 0 ? gl.slice(0, cut) : gl.slice(0, Math.ceil(mid))).join('').trim();
  const b = (cut > 0 ? gl.slice(cut + 1) : gl.slice(Math.ceil(mid))).join('').trim();
  return a && b ? [a, b] : [text];
}
const WIDE_MAX = 0.7, WIDE_MIN = 0.35;
/** Grows a one-line main line until it spans WIDE_MIN of the canvas width W (never past cap; the height fit still applies). */
function wideGrow(g, text, s, ew, W, cap) {
  g.font = `800 ${Math.round(s)}px ${SANS}`;
  const w = g.measureText(text).width + ew(s);
  return w > 0 && w < W * WIDE_MIN ? Math.max(s, Math.min(cap, s * (W * WIDE_MIN) / w)) : s;
}
/** The board's text block, left-aligned in [top, bot]: the main line (one or two lines, whichever reads larger) in Pretendard
 *  800 with the player's emoji in front, then line 2 and line 3 in 700. Everything is fitted and scaled to the room. */
function textBlock(g, o) {
  const { k, x0, maxW } = o;
  const avail = Math.max(8, o.bot - o.top);
  const ew = (s) => (o.emo ? s * 1.16 : 0);
  // Main-tower boards (o.wide): a main line ends by WIDE_MAX of the canvas width, and a one-line one spans at least WIDE_MIN.
  const lineW = o.wide ? Math.min(maxW, o.W * WIDE_MAX - x0) : maxW;
  const fitE = (t, cap, min) => {
    let s = cap;
    for (;;) {
      g.font = `800 ${Math.round(s)}px ${SANS}`;
      if (g.measureText(t).width + ew(s) <= lineW || s <= min) return s;
      s = Math.max(min, s * 0.92);
    }
  };
  let s2 = o.l2 ? fit(g, o.l2, maxW, 62 * k, 700, SANS, 22 * k) : 0;
  let s3 = o.l3 ? fit(g, o.l3, maxW, 46 * k, 700, SANS, 18 * k) : 0;
  const LH = 1.14, G2 = 18 * k, G3 = 10 * k;
  const rest = (s2 ? G2 + s2 * 1.25 : 0) + (s3 ? G3 + s3 * 1.25 : 0);
  const eff = (n, s) => Math.min(s, Math.max(1, avail - rest) / (n * LH));
  let main = o.l1 ? [o.l1] : [];
  let s1 = o.l1 ? fitE(o.l1, 150 * k, 36 * k) : 0;
  if (o.l1) {
    const two = splitTwo(o.l1);
    if (two.length === 2) {
      const sa = Math.min(fitE(two[0], 120 * k, 36 * k), fit(g, two[1], lineW, 120 * k, 800, SANS, 36 * k));
      if (eff(2, sa) > eff(1, s1) * 1.12) { main = two; s1 = sa; }
    }
  }
  if (o.wide && main.length === 1) s1 = wideGrow(g, main[0], s1, ew, o.W, 230 * k);
  const total = main.length * s1 * LH + rest;
  const f = total > avail ? avail / total : 1;
  s1 *= f; s2 *= f; s3 *= f;
  let y = o.top + (avail - total * f) / 2;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  main.forEach((t, i) => {
    const yy = y + s1 * LH / 2;
    let x = x0;
    if (i === 0 && o.emo) {
      g.font = `${Math.round(s1 * 0.9)}px ${EMOJI}`;
      g.fillStyle = WHITE;
      g.fillText(o.emo, x, yy);
      x += ew(s1);
    }
    g.font = `800 ${Math.round(s1)}px ${SANS}`;
    g.fillStyle = o.c1;
    g.fillText(t, x, yy, Math.max(1, x0 + maxW - x));
    y += s1 * LH;
  });
  if (s2) {
    y += G2 * f;
    g.font = `700 ${Math.round(s2)}px ${SANS}`;
    g.fillStyle = o.c2;
    g.fillText(o.l2, x0, y + s2 * 0.625, maxW);
    y += s2 * 1.25;
  }
  if (s3) {
    y += G3 * f;
    g.font = `700 ${Math.round(s3)}px ${SANS}`;
    g.fillStyle = o.c3;
    g.fillText(o.l3, x0, y + s3 * 0.625, maxW);
  }
}

export function tierOf(slotId) {
  const s = String(slotId || '');
  return s.startsWith('MAIN') ? 'S' : s.startsWith('SUB') ? 'B' : 'C';
}
/** The small tier label a held board carries in its chip. */
function tierName(slotId) {
  const s = String(slotId || '');
  if (s.startsWith('TOWER')) return 'ONE TIMES SQUARE';
  if (s.startsWith('WALL')) return 'TIMES SQUARE';
  if (s.startsWith('STREET')) return '메인거리';
  if (s.startsWith('PLOT')) return '건물 전광판';
  return { S: '메인 타워', B: '코너 타워', C: '거리 전광판' }[tierOf(s)];
}

// Operator-approved billboard photos, shared by the in-world screens and the editor preview.
const PHOTO_P = new Map(), PHOTO_OK = new Map();
export function boardPhoto(id) {
  if (!/^[0-9a-f]{40}$/.test(String(id || ''))) return Promise.resolve(null);
  let p = PHOTO_P.get(id);
  if (!p) {
    p = new Promise((res) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { if (PHOTO_OK.size > 32) PHOTO_OK.delete(PHOTO_OK.keys().next().value); PHOTO_OK.set(id, img); res(img); };
      img.onerror = () => { setTimeout(() => PHOTO_P.delete(id), 60000); res(null); };
      img.src = `/rt/photo/${id}.jpg`;
    });
    if (PHOTO_P.size > 48) PHOTO_P.delete(PHOTO_P.keys().next().value);
    PHOTO_P.set(id, p);
  }
  return p;
}
export const photoReady = (id) => PHOTO_OK.get(id) || null;

function cover(g, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const s = Math.max(w / iw, h / ih), sw = w / s, sh = h / s;
  g.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

/** Full billboard artwork. data: {slot_id, emoji, bg_theme, text_color, line1..3, holder_name, holder_id}.
 *  opts.photo (image/canvas) replaces the artwork with the photo + line1 caption; opts.pending adds a "사진 검수 중" chip. */
export function linkBadge(url) {
  const u = String(url || '').toLowerCase();
  if (!u) return null;
  if (u.includes('threads.net')) return { label: 'Threads 공식 홍보', color: '#f4f6ff' };
  if (u.includes('youtube.com') || u.includes('youtu.be')) return { label: 'YouTube 채널 바로가기', color: '#ff6b6b' };
  if (u.includes('instagram.com')) return { label: 'Instagram 바로가기', color: '#ff7ac0' };
  if (u.includes('smartstore.naver.com')) return { label: '스토어 특가', color: '#7dffb2' };
  return null;
}

export function paintBillboard(canvas, data = {}, opts = {}) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = W / 1024;
  const theme = THEMES[data.bg_theme] ? data.bg_theme : 'cyber_navy';
  const th = THEMES[theme];
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  const ink = /^#[0-9a-f]{3,8}$/i.test(String(data.text_color || '')) ? data.text_color : '#ffffff';
  const ticker = opts.ticker ? Math.round(44 * k) : 0;
  const statsH = Math.max(28, Math.round(46 * k));
  const body = H - ticker - statsH;
  const vacant = !data.holder_id;
  const raw1 = chars(data.line1, 20).trim();
  // A held board whose light is out: screens.js marks that notice row with unlit (a player's own '불 꺼짐' text stays text).
  const unlit = !vacant && !opts.photo && data.unlit === true;
  // House notices speak in amber; a player's board wears its theme accent.
  const accent = vacant ? AMBER : th.accent;
  const views = Math.max(0, Math.floor(Number(data.views) || 0));
  const cheers = Math.max(0, Math.floor(Number(data.cheers) || 0));
  const pad = 44 * k, cs = Math.max(11, Math.round(26 * k));

  if (opts.photo) {
    // Photo full-bleed, a scrim at the bottom for the footer, and one behind the caption where the owner put it.
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, body);
    cover(g, opts.photo, 0, 0, W, body);
    const lines = [chars(data.line1, 20), chars(data.line2, 24), chars(data.line3, 28)].map(t => String(t || '').trim()).filter((t) => t && !/^To\.\s+/.test(t));
    const weights = [800, 700, 700];
    const caps = [72 * k, 40 * k, 32 * k];
    const mins = [26 * k, 18 * k, 15 * k];
    const sizes = lines.map((t, i) => fit(g, t, W * 0.86, caps[Math.min(i, 2)], weights[Math.min(i, 2)], SANS, mins[Math.min(i, 2)]));
    const gap = 8 * k;
    const block = sizes.reduce((a, s) => a + s * 1.2, 0) + gap * Math.max(0, sizes.length - 1);
    const anchor = Math.min(88, Math.max(12, Number(data.caption_y) || 72)) / 100;
    let y = Math.max(14 * k, Math.min(body - block - 14 * k, body * anchor - block / 2));
    const low = body * 0.6, capTop = y - 70 * k, capBot = y + block + 70 * k;
    const joined = lines.length > 0 && capBot > low;
    const s0 = joined ? Math.max(0, Math.min(low, capTop)) : low;
    let gr = g.createLinearGradient(0, s0, 0, body);
    gr.addColorStop(0, 'rgba(6,9,20,0)');
    gr.addColorStop(Math.min(0.9, Math.max(0.1, joined ? (y - s0) / Math.max(1, body - s0) : 0.5)), 'rgba(6,9,20,0.66)');
    gr.addColorStop(1, 'rgba(6,9,20,0.86)');
    g.fillStyle = gr;
    g.fillRect(0, s0, W, body - s0);
    if (lines.length && !joined) {
      gr = g.createLinearGradient(0, capTop, 0, capBot);
      gr.addColorStop(0, 'rgba(6,9,20,0)');
      gr.addColorStop(0.3, 'rgba(6,9,20,0.7)');
      gr.addColorStop(0.7, 'rgba(6,9,20,0.7)');
      gr.addColorStop(1, 'rgba(6,9,20,0)');
      g.fillStyle = gr;
      g.fillRect(0, capTop, W, capBot - capTop);
    }
    const tones = [ink, mixHex(ink, TEXT2, 0.4), TEXT2];
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((t, i) => {
      const s = sizes[i];
      g.font = `${weights[Math.min(i, 2)]} ${Math.round(s)}px ${SANS}`;
      g.fillStyle = tones[Math.min(i, 2)];
      g.fillText(t, W / 2, y + s * 0.6);
      y += s * 1.2 + gap;
    });
  } else {
    boardPanel(g, W, body, k, unlit ? '' : accent, unlit);
  }

  // Chips, top-left: state or tier, link, photo review, gift recipient. A streak sits top-right.
  let chipY = 30 * k;
  const badge = linkBadge(data.external_url);
  if (!unlit) {
    const mode = opts.photo ? 'quiet' : 'soft';
    const maxC = W * 0.62;
    const label = vacant
      ? (data.soon ? '곧 열려요' : auctionClosed(data.slot_id, nowMs()) ? '밤 9시에 10분만 열려요' : '빈 자리 · 지금 걸 수 있어요')
      : data.holder_id === 'air' ? '전광판 장악' : th.title ? (th.sub ? `${th.title} · ${th.sub}` : th.title) : tierName(data.slot_id);
    chipY += pill(g, pad, chipY, label, accent, cs, maxC, mode).h + 10 * k;
    if (badge) chipY += pill(g, pad, chipY, badge.label, badge.color, cs, maxC, 'quiet').h + 10 * k;
    if (opts.pending && !vacant) chipY += pill(g, pad, chipY, '사진 검수 중', AMBER, cs, maxC, mode).h + 10 * k;
    const to = /^To\.\s*(.+)/.exec(raw1);
    if (to) chipY += pill(g, pad, chipY, `To. ${chars(to[1], 12)}`, AMBER, Math.round(cs * 1.08), maxC, 'solid').h + 10 * k;
    const days = Math.max(0, Math.floor(Number(data.lit_days) || 0));
    if (!vacant && days > 0) pill(g, W - pad, 30 * k, `연속 ${days}일`, AMBER, cs, W * 0.3, mode, true);
  }

  if (!opts.photo) {
    if (unlit) {
      // The same panel, dimmed, with one small centred line.
      const msg = [raw1, chars(data.line2, 24).trim()].filter(Boolean).join(' · ');
      flatText(g, msg, W / 2, body * 0.46, W * 0.8, Math.round(40 * k), MUTED, 700, 14 * k);
    } else {
      let l1 = /^To\.\s+/.test(raw1) ? '' : raw1, l2 = chars(data.line2, 24).trim(), l3 = chars(data.line3, 28).trim();
      if (!l1) { l1 = l2; l2 = l3; l3 = ''; }
      const emo = vacant ? '' : chars(data.emoji || '🔥', 4) || '🔥';
      textBlock(g, {
        k, W, x0: pad, maxW: W - pad * 2, top: Math.max(chipY + 8 * k, 96 * k), bot: body - 86 * k, l1, l2, l3, emo,
        wide: tierOf(data.slot_id) === 'S',
        c1: vacant ? WHITE : ink, c2: vacant ? TEXT2 : mixHex(ink, TEXT2, 0.5), c3: vacant ? AMBER : MUTED,
      });
    }
  }

  footRow(g, W, body - 44 * k, k, vacant ? '' : chars(data.holder_name || '익명', 14), vacant && !cheers ? null : cheers, {
    dim: unlit,
    note: data.taken_from ? `${chars(data.taken_from, 14)}님을 밀어내고 점령` : '',
  });

  if (opts.shield) {
    const y = Math.round(body * 0.86);
    const h = body - y;
    g.fillStyle = 'rgba(36,8,16,0.94)';
    g.fillRect(0, y, W, h);
    g.fillStyle = DANGER;
    g.fillRect(0, y, W, Math.max(2, Math.round(3 * k)));
    flatText(g, String(opts.shield), W / 2, y + h / 2 + 1.5 * k, W * 0.9, Math.round(34 * k), DANGER, 800, 16 * k);
  }

  let label = `${cheers}명이 함께 응원 중`;
  if (unlit) {
    const price = chars(data.line3, 28).trim();
    if (price) label = `${price} · ${label}`;
  }
  const taxi = ` · 택시 ${views}`;
  g.font = `700 ${Math.max(13, Math.round(22 * k))}px ${SANS}`;
  if (views > 0 && g.measureText(label + taxi).width <= W - 36 * k) label += taxi;
  infoStrip(g, W, H, statsH, k, label, MUTED);

  if (ticker) {
    g.fillStyle = STRIP;
    g.fillRect(0, body, W, ticker);
    const ph = Math.max(14, ticker - 14 * k), pw = 88 * k;
    roundRect(g, 16 * k, body + (ticker - ph) / 2, pw, ph, ph / 2);
    g.fillStyle = MAGENTA;
    g.fill();
    g.font = `800 ${Math.max(10, Math.round(20 * k))}px ${SANS}`;
    g.fillStyle = WHITE;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('LIVE', 16 * k + pw / 2, body + ticker / 2 + 1);
    g.textAlign = 'left';
    g.font = `700 ${Math.max(11, Math.round(22 * k))}px ${SANS}`;
    g.fillText(chars(opts.ticker, 60), 124 * k, body + ticker / 2 + 1, W - 140 * k);
  }
  g.restore();
  return canvas;
}

/** Seamless LED ticker: text repeats an integer number of times across the canvas width. Flat type, no glow. */
export function paintTicker(canvas, text, color = AMBER) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = STRIP;
  g.fillRect(0, 0, W, H);
  const size = Math.round(H * 0.56);
  g.font = `800 ${size}px ${SANS}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  const unit = `${text}      ·      `;
  const uw = Math.max(1, g.measureText(unit).width);
  const n = Math.max(1, Math.round(W / uw));
  g.save();
  g.scale(W / (n * uw), 1);
  g.fillStyle = color;
  for (let i = 0; i < n; i++) g.fillText(unit, i * uw, H * 0.54);
  g.restore();
  return canvas;
}

/** Plot sign: dark panel, one flat tube line in the sign's colour, clean type. color is the owner's choice. */
export function paintNeonSign(canvas, text, color = '#00ffcc', sub = '') {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = H / 128;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  roundRect(g, 4 * k, 4 * k, W - 8 * k, H - 8 * k, 16 * k);
  g.fillStyle = PANEL;
  g.fill();
  g.lineWidth = 3 * k;
  g.strokeStyle = color;
  roundRect(g, 12 * k, 12 * k, W - 24 * k, H - 24 * k, 10 * k);
  g.stroke();
  const t = chars(text || '분양 중', 14);
  flatText(g, t, W / 2, sub ? H * 0.43 : H * 0.53, W - 64 * k, Math.round((sub ? 52 : 60) * k), color, 800, 18 * k);
  if (sub) {
    g.font = `700 ${Math.round(20 * k)}px ${SANS}`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(242,244,255,0.72)';
    g.fillText(sub, W / 2, H * 0.76, W - 64 * k);
  }
  return canvas;
}

export function paintStationSign(canvas) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = H / 256;
  g.fillStyle = '#f4f6f8';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#0a2a5e';
  g.fillRect(0, 0, W, 18 * k);
  g.fillRect(0, H - 18 * k, W, 18 * k);
  g.fillStyle = '#0052a4';
  g.beginPath();
  g.arc(128 * k, H / 2, 74 * k, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = `900 ${Math.round(104 * k)}px ${SANS}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('1', 128 * k, H / 2 + 6 * k);
  g.fillStyle = '#111827';
  g.textAlign = 'left';
  g.font = `900 ${Math.round(96 * k)}px ${SANS}`;
  g.fillText('위시보드', 238 * k, H * 0.42);
  g.font = `700 ${Math.round(36 * k)}px ${SANS}`;
  g.fillStyle = '#374151';
  g.fillText('타임스퀘어 1번출구', 242 * k, H * 0.76);
  const bx = W - 220 * k;
  g.fillStyle = '#ffd400';
  roundRect(g, bx, 40 * k, 176 * k, H - 80 * k, 16 * k);
  g.fill();
  g.fillStyle = '#111111';
  g.font = `900 ${Math.round(112 * k)}px ${SANS}`;
  g.textAlign = 'center';
  g.fillText('1', bx + 88 * k, H * 0.46);
  g.font = `900 ${Math.round(30 * k)}px ${SANS}`;
  g.fillText('출구 EXIT', bx + 88 * k, H * 0.8);
  return canvas;
}

export function paintPylon(canvas) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = W / 128;
  g.fillStyle = '#10204a';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#0052a4';
  g.beginPath();
  g.arc(W / 2, 70 * k, 46 * k, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 5 * k;
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `900 ${Math.round(64 * k)}px ${SANS}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('1', W / 2, 74 * k);
  g.font = `900 ${Math.round(58 * k)}px ${SANS}`;
  const word = '위시보드';
  Array.from(word).forEach((ch, i) => g.fillText(ch, W / 2, 168 * k + i * 70 * k));
  g.fillStyle = '#ffd400';
  g.fillRect(14 * k, H - 120 * k, W - 28 * k, 96 * k);
  g.fillStyle = '#111111';
  g.font = `900 ${Math.round(70 * k)}px ${SANS}`;
  g.fillText('1', W / 2, H - 72 * k);
  return canvas;
}

export function paintMenuBoard(canvas) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = W / 512;
  g.fillStyle = '#1d2b22';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#8a5a2b';
  g.lineWidth = 22 * k;
  g.strokeRect(0, 0, W, H);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  neon(g, '황금 붕어빵', W / 2, 92 * k, Math.round(70 * k), SANS, 900, '#ffcf5a', { align: 'center', glow: 0.6 });
  g.font = `${Math.round(70 * k)}px ${EMOJI}`;
  g.fillText('🐟', W / 2, 190 * k);
  const rows = [['팥 붕어빵', '바삭'], ['슈크림 붕어빵', '달콤'], ['황금 붕어빵', '정중앙!']]; // play only: no points
  rows.forEach(([a, b], i) => {
    const y = 290 * k + i * 74 * k;
    g.font = `800 ${Math.round(38 * k)}px ${SANS}`;
    g.textAlign = 'left';
    g.fillStyle = '#f2f5ef';
    g.fillText(a, 48 * k, y);
    g.textAlign = 'right';
    g.fillStyle = i === 2 ? '#ffcf5a' : '#9ef0c2';
    g.fillText(b, W - 48 * k, y);
  });
  g.font = `700 ${Math.round(28 * k)}px ${SANS}`;
  g.textAlign = 'center';
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillText('타이밍 맞춰 바삭하게!', W / 2, H - 70 * k);
  return canvas;
}

export function paintTaxiSign(canvas) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = H / 64;
  g.fillStyle = '#fff6c9';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#1a1a1a';
  g.font = `900 ${Math.round(38 * k)}px ${SANS}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('TAXI  7K42', W / 2, H / 2 + 2 * k);
  return canvas;
}

export function paintTaxiDecal(canvas) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = H / 128;
  g.clearRect(0, 0, W, H);
  for (let i = 0; i < 32; i++) {
    g.fillStyle = i % 2 ? '#111111' : '#f2f2f2';
    g.fillRect(i * W / 32, 0, W / 32, 14 * k);
    g.fillStyle = i % 2 ? '#f2f2f2' : '#111111';
    g.fillRect(i * W / 32, 14 * k, W / 32, 14 * k);
  }
  g.fillStyle = '#111111';
  g.font = `900 ${Math.round(46 * k)}px ${SANS}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillText('NYC', 70 * k, 76 * k);
  g.fillStyle = '#0a3d91';
  g.fillText('TAXI', 172 * k, 76 * k);
  g.fillStyle = '#111111';
  g.font = `800 ${Math.round(26 * k)}px ${SANS}`;
  g.fillText('WISH BOARD', W - 280 * k, 78 * k);
  return canvas;
}

export function paintTKTS(canvas) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = H / 128;
  g.fillStyle = '#c4001d';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffffff';
  g.font = `900 ${Math.round(92 * k)}px ${SANS}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('tkts', W / 2, H * 0.52);
  return canvas;
}

export function paintLabel(canvas, text, color = '#ffffff', bg = null) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, W, H); }
  flatText(g, text, W / 2, H * 0.54, W * 0.92, H * 0.68, color, 800, 10);
  return canvas;
}

/** Vertical blade sign: dark panel, flat caps in one sign hue, stacked letters. Any colour snaps to the sign family. */
export function paintBlade(canvas, text, color) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = W / 128;
  const hue = signHue(color);
  g.fillStyle = PANEL;
  g.fillRect(0, 0, W, H);
  g.fillStyle = hue;
  g.fillRect(0, 0, W, 8 * k);
  g.fillRect(0, H - 8 * k, W, 8 * k);
  g.strokeStyle = rgba(hue, 0.35);
  g.lineWidth = 2 * k;
  g.strokeRect(12 * k, 20 * k, W - 24 * k, H - 40 * k);
  const letters = Array.from(String(text || ''));
  const step = (H - 72 * k) / Math.max(1, letters.length);
  const size = Math.round(Math.min(80 * k, step * 0.84));
  g.font = `800 ${size}px ${SANS}`;
  g.fillStyle = hue;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  letters.forEach((ch, i) => g.fillText(ch, W / 2, 36 * k + step * (i + 0.5), W - 32 * k));
  return canvas;
}

/** Fictional K-brand ad posters packed in a 4×4 atlas of square cells. One family: flat fills in magenta, cyan, amber,
 *  white and the panel navy; simple drawn shapes; clean type. No real brand's mark, colours or slogan. */

/** Soft round glow sprite: bright centre, smooth falloff, nothing at the edge. */
export function paintGlow(canvas, inner = 'rgba(255,255,255,1)') {
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const gr = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.18, 'rgba(255,255,255,0.5)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.13)');
  gr.addColorStop(0.75, 'rgba(255,255,255,0.03)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, W);
  return canvas;
}

/** Beam: a narrow soft core across the width (about a fifth of it reads bright, with a faint halo out to the edges) that
 *  fades toward the top of the canvas. On a quad about 0.75 m wide the bright core is about 0.15 m. */
export function paintBeam(canvas) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  const gx = g.createLinearGradient(0, 0, W, 0);
  for (let i = 0; i <= 16; i++) {
    const u = i / 16, d = Math.abs(u - 0.5);
    const a = 0.72 * Math.exp(-((d / 0.085) ** 2)) + 0.28 * Math.exp(-((d / 0.26) ** 2));
    gx.addColorStop(u, `rgba(255,255,255,${Math.min(1, a).toFixed(3)})`);
  }
  g.fillStyle = gx;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'destination-in';
  const gy = g.createLinearGradient(0, 0, 0, H);
  gy.addColorStop(0, 'rgba(0,0,0,0)');
  gy.addColorStop(0.3, 'rgba(0,0,0,0.12)');
  gy.addColorStop(0.6, 'rgba(0,0,0,0.42)');
  gy.addColorStop(0.85, 'rgba(0,0,0,0.82)');
  gy.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = gy;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  return canvas;
}

/** Tileable puddle mask (wrap-around blobs). */
export function paintPuddles(canvas, seed = 3) {
  const g = canvas.getContext('2d');
  const S = canvas.width;
  const r = rng(seed);
  g.fillStyle = '#000000';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    const x = r() * S, y = r() * S, rad = (0.03 + r() * 0.12) * S, a = 0.25 + r() * 0.55;
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
        gr.addColorStop(0, `rgba(255,255,255,${a})`);
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
      }
    }
  }
  return canvas;
}

/** Name tag: a slim dark pill with white 600 text and no outline. The player's own tag carries a small dot in their
 *  ring colour (color). */
// Name-tag themes from the cosmetics shop (balance.js SHOP kind 'tag'), by cosmetic id. Anything else is the plain dark pill.
// fill: the pill (one colour or a top-to-bottom gradient), text: the name, edge/glow: an outline and its blur, hearts: a heart at each end.
export const TAG_THEMES = Object.freeze({
  tag_gold: Object.freeze({ fill: ['#ffe39a', '#ffb020', '#d98a00'], text: '#1c1300', edge: '#fff2c8' }),
  tag_neon: Object.freeze({ fill: ['rgba(10,14,28,0.9)'], text: '#eaffff', edge: '#48d6f0', glow: '#48d6f0', inner: '#ff4fa3' }),
  tag_heart: Object.freeze({ fill: ['#ff8cc4', '#ff4fa3'], text: '#ffffff', edge: '#ffd6ea', hearts: '#ffffff' }),
});
/** A heart centred on (x, y), r about half its width. */
export function heartPath(g, x, y, r) {
  g.beginPath();
  g.moveTo(x, y + r * 0.9);
  g.bezierCurveTo(x - r * 1.25, y + r * 0.05, x - r * 0.9, y - r * 1.0, x, y - r * 0.38);
  g.bezierCurveTo(x + r * 0.9, y - r * 1.0, x + r * 1.25, y + r * 0.05, x, y + r * 0.9);
  g.closePath();
}
/** theme: a cosmetic id from TAG_THEMES (the wearer's equipped name tag), or '' for the plain one. */
export function paintNameTag(canvas, name, color = '#3fe6ff', mine = false, theme = '') {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = H / 64;
  const T = Object.hasOwn(TAG_THEMES, theme) ? TAG_THEMES[theme] : null; // own keys only: a peer's 'constructor' is the plain pill
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  const text = chars(name || '익명', 12);
  g.font = `${T ? 700 : 600} ${Math.round(24 * k)}px ${SANS}`;
  const heart = T?.hearts ? 7 * k : 0;
  const padX = 15 * k + heart * 1.6, dot = mine ? 5 * k : 0, gap = mine ? 8 * k : 0;
  const tw = Math.max(1, Math.min(W - 12 * k - padX * 2 - dot * 2 - gap, g.measureText(text).width));
  const ph = 36 * k, pw = tw + padX * 2 + dot * 2 + gap;
  const x = (W - pw) / 2, y = (H - ph) / 2;
  roundRect(g, x, y, pw, ph, ph / 2);
  if (T) {
    if (T.fill.length > 1) {
      const gr = g.createLinearGradient(0, y, 0, y + ph);
      T.fill.forEach((c, i) => gr.addColorStop(i / (T.fill.length - 1), c));
      g.fillStyle = gr;
    } else g.fillStyle = T.fill[0];
    g.fill();
    g.save();
    if (T.glow) { g.shadowColor = T.glow; g.shadowBlur = 9 * k; }
    g.lineWidth = (T.glow ? 2.6 : 1.6) * k;
    g.strokeStyle = T.edge;
    g.stroke();
    g.restore();
    if (T.inner) {
      roundRect(g, x + 3.2 * k, y + 3.2 * k, pw - 6.4 * k, ph - 6.4 * k, (ph - 6.4 * k) / 2);
      g.lineWidth = 1 * k;
      g.strokeStyle = T.inner;
      g.stroke();
    }
    if (heart) {
      g.fillStyle = T.hearts;
      heartPath(g, x + 13 * k, H / 2, heart);
      g.fill();
      heartPath(g, x + pw - 13 * k, H / 2, heart);
      g.fill();
    }
  } else {
    g.fillStyle = 'rgba(10,14,28,0.82)';
    g.fill();
  }
  if (mine) {
    g.fillStyle = color;
    g.beginPath();
    g.arc(x + padX + dot, H / 2, dot, 0, Math.PI * 2);
    g.fill();
    if (T && !T.glow) { g.lineWidth = 1.2 * k; g.strokeStyle = 'rgba(10,14,28,0.7)'; g.stroke(); }
  }
  g.save();
  if (T?.glow) { g.shadowColor = T.glow; g.shadowBlur = 6 * k; }
  g.fillStyle = T ? T.text : '#ffffff';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(text, x + padX + dot * 2 + gap, H / 2 + 1 * k, tw);
  g.restore();
  return canvas;
}

// Foot-ring effects from the cosmetics shop (kind 'ring'), by cosmetic id: the texture of a flat square under the avatar, its ring at
// RING_FX_R of the half width (the plain ring's 0.63..0.69 m on a RING_FX_SIZE plane). spin: turns per second in the scene; twinkle:
// the opacity pulses. Painted once per id and shared by every avatar wearing it; the shop sheet paints the same canvas as its preview.
export const RING_FX_SIZE = 1.7;
export const RING_FX_R = 0.66 / (RING_FX_SIZE / 2);
export const RING_FX = Object.freeze({
  ring_rainbow: Object.freeze({ spin: 0.12 }),
  ring_sparkle: Object.freeze({ spin: 0.18, twinkle: true }),
  ring_heart: Object.freeze({ spin: 0.08 }),
});
function star4(g, x, y, r) {
  g.beginPath();
  g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r);
  g.closePath();
}
export function paintRingFx(canvas, id) {
  const g = canvas.getContext('2d');
  const S = canvas.width, c = S / 2, R = c * RING_FX_R, k = S / 256;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, S, S);
  g.lineCap = 'round';
  if (id === 'ring_rainbow') {
    const n = 48;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1.15) / n) * Math.PI * 2;
      g.strokeStyle = `hsl(${Math.round((i / n) * 360)}, 100%, 62%)`;
      g.lineWidth = 11 * k;
      g.beginPath(); g.arc(c, c, R, a0, a1); g.stroke();
    }
    g.globalAlpha = 0.35;
    g.lineWidth = 3 * k;
    g.strokeStyle = '#ffffff';
    g.beginPath(); g.arc(c, c, R + 10 * k, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
  } else if (id === 'ring_sparkle') {
    g.strokeStyle = '#ffe9a8';
    g.lineWidth = 5 * k;
    g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, big = i % 2 === 0;
      g.fillStyle = big ? '#ffffff' : '#ffd36a';
      star4(g, c + Math.cos(a) * R, c + Math.sin(a) * R, (big ? 17 : 10) * k);
      g.fill();
    }
  } else if (id === 'ring_heart') {
    g.strokeStyle = '#ff5fa8';
    g.lineWidth = 4 * k;
    g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      g.fillStyle = i % 3 === 0 ? '#ffffff' : '#ff6fb5';
      heartPath(g, c + Math.cos(a) * R, c + Math.sin(a) * R, 12 * k);
      g.fill();
    }
  }
  return canvas;
}

// Board-frame looks from the cosmetics shop (kind 'frame'), by cosmetic id: the rim colour behind the holder's boards (ts3d/screens.js
// setRim) and how it moves. 'shine' breathes the opacity, 'rainbow' walks the hue.
export const FRAME_FX = Object.freeze({
  frame_streak: Object.freeze({ color: '#ff3d9a', anim: '' }),
  frame_gold: Object.freeze({ color: '#ffc94a', anim: 'shine' }),
  frame_rainbow: Object.freeze({ color: '#ff3d4a', anim: 'rainbow' }),
});
// The rim colour of an animated frame at time t (seconds): the hue walk for 'rainbow', the plain colour otherwise.
export function frameTone(fx, t) {
  if (fx?.anim !== 'rainbow') return fx?.color || '';
  const h = (((t * 0.15) % 1) + 1) % 1;
  return `hsl(${Math.round(h * 360)}, 100%, 60%)`;
}
/** The shop's preview of a frame: a small dark board with the frame around it. */
export function paintFrameSwatch(canvas, id) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = H / 64, fx = Object.hasOwn(FRAME_FX, id) ? FRAME_FX[id] : null;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  const x = 10 * k, y = 8 * k, w = W - 20 * k, h = H - 16 * k;
  if (fx?.anim === 'rainbow') {
    const gr = g.createLinearGradient(x, y, x + w, y + h);
    ['#ff3d4a', '#ffcf5a', '#39f58a', '#3fe6ff', '#b84dff', '#ff7ad9'].forEach((c, i, a) => gr.addColorStop(i / (a.length - 1), c));
    g.fillStyle = gr;
  } else g.fillStyle = fx?.color || '#3a4266';
  roundRect(g, x - 5 * k, y - 5 * k, w + 10 * k, h + 10 * k, 7 * k);
  g.fill();
  g.fillStyle = PANEL;
  roundRect(g, x, y, w, h, 4 * k);
  g.fill();
  g.fillStyle = TEXT2;
  g.fillRect(x + 8 * k, y + h / 2 - 5 * k, w * 0.55, 3 * k);
  g.fillStyle = DIM;
  g.fillRect(x + 8 * k, y + h / 2 + 3 * k, w * 0.35, 3 * k);
  return canvas;
}

/** Reaction bubble: the same quiet dark surface as the name tag, the emoji (content) inside. */
export function paintBubble(canvas, glyph) {
  const g = canvas.getContext('2d');
  const S = canvas.width, k = S / 128;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, S, S);
  g.fillStyle = 'rgba(10,14,28,0.82)';
  roundRect(g, 16 * k, 12 * k, 96 * k, 86 * k, 28 * k);
  g.fill();
  g.beginPath();
  g.moveTo(56 * k, 97 * k);
  g.lineTo(64 * k, 112 * k);
  g.lineTo(72 * k, 97 * k);
  g.closePath();
  g.fill();
  g.font = `${Math.round(56 * k)}px ${EMOJI}`;
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(glyph, 64 * k, 57 * k);
  return canvas;
}

export function paintPlotBadge(canvas, id, level, color) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = H / 128;
  g.clearRect(0, 0, W, H);
  roundRect(g, 6 * k, 6 * k, W - 12 * k, H - 12 * k, 18 * k);
  g.fillStyle = 'rgba(10,14,28,0.88)';
  g.fill();
  g.lineWidth = 2 * k;
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.stroke();
  g.fillStyle = color;
  g.fillRect(6 * k + 18 * k, 6 * k, W - 48 * k, Math.max(2, 3 * k));
  flatText(g, `${id}번 토지`, W / 2, H * 0.42, W - 40 * k, Math.round(50 * k), WHITE, 800, 18 * k);
  flatText(g, level === 0 ? '분양 중 · FOR SALE' : '분양 완료', W / 2, H * 0.74, W - 40 * k, Math.round(24 * k), level === 0 ? color : MUTED, 700, 12 * k);
  return canvas;
}

// Marker glyphs that used to be emoji become drawn shapes: a person waving (pickup), a flag (drop-off), a map pin.
function markShape(g, glyph, c, u, color) {
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const s = String(glyph || '');
  if (s === '🙋' || s === '🙋‍♀️' || s === '🙋‍♂️') {
    g.beginPath(); g.arc(c - 0.1 * u, c - 0.5 * u, 0.26 * u, 0, Math.PI * 2); g.fill();
    roundRect(g, c - 0.55 * u, c - 0.12 * u, 0.9 * u, 0.95 * u, 0.36 * u); g.fill();
    g.lineWidth = 0.2 * u;
    g.beginPath(); g.moveTo(c + 0.22 * u, c + 0.02 * u); g.lineTo(c + 0.62 * u, c - 0.72 * u); g.stroke();
    return true;
  }
  if (s === '🏁' || s === '🚩') {
    g.lineWidth = 0.16 * u;
    g.beginPath(); g.moveTo(c - 0.5 * u, c + 0.9 * u); g.lineTo(c - 0.5 * u, c - 0.85 * u); g.stroke();
    g.beginPath(); g.moveTo(c - 0.42 * u, c - 0.85 * u); g.lineTo(c + 0.72 * u, c - 0.5 * u); g.lineTo(c - 0.42 * u, c - 0.12 * u); g.closePath(); g.fill();
    return true;
  }
  if (s === '📍' || s === '📌') {
    const cy = c - 0.25 * u, r = 0.56 * u;
    g.beginPath(); g.arc(c, cy, r, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(c - r * 0.82, cy + r * 0.5); g.lineTo(c + r * 0.82, cy + r * 0.5); g.lineTo(c, c + 0.95 * u); g.closePath(); g.fill();
    g.fillStyle = 'rgba(10,14,28,0.95)';
    g.beginPath(); g.arc(c, cy, r * 0.38, 0, Math.PI * 2); g.fill();
    return true;
  }
  return false;
}
/** Map/world marker icon. Square canvas: a dark disc with a thin ring and a drawn shape (or short text) in the marker
 *  colour, a faint halo. Wide canvas: a slim pill label with a colour dot. */
export function paintMarker(canvas, glyph, color) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  if (W !== H) {
    const k = H / 96;
    const text = chars(glyph, 8);
    g.font = `700 ${Math.round(40 * k)}px ${SANS}`;
    const dot = 8 * k, padX = 22 * k;
    const tw = Math.min(W - 16 * k - padX * 2 - dot * 3, g.measureText(text).width);
    const ph = 62 * k, pw = tw + padX * 2 + dot * 3, x = (W - pw) / 2, y = (H - ph) / 2;
    roundRect(g, x, y, pw, ph, ph / 2);
    g.fillStyle = 'rgba(10,14,28,0.85)';
    g.fill();
    g.fillStyle = color;
    g.beginPath(); g.arc(x + padX + dot, H / 2, dot, 0, Math.PI * 2); g.fill();
    g.fillStyle = WHITE;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(text, x + padX + dot * 3, H / 2 + 2 * k, Math.max(1, tw));
    return canvas;
  }
  const S = W, c = S / 2;
  glowDot(g, c, c, c, color, 0.2);
  g.beginPath();
  g.arc(c, c, c * 0.6, 0, Math.PI * 2);
  g.fillStyle = 'rgba(10,14,28,0.88)';
  g.fill();
  g.lineWidth = S * 0.03;
  g.strokeStyle = color;
  g.stroke();
  if (!markShape(g, glyph, c, S * 0.24, color)) {
    const s = String(glyph || '');
    // Any other pictograph becomes a plain dot; short text stays text.
    if (!s || /\p{Extended_Pictographic}/u.test(s)) {
      g.fillStyle = color;
      g.beginPath(); g.arc(c, c, S * 0.1, 0, Math.PI * 2); g.fill();
    } else flatText(g, chars(s, 3), c, c * 1.04, S * 0.56, Math.round(S * 0.34), color, 800, S * 0.12);
  }
  return canvas;
}

export function paintTaxiStand(canvas) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = W / 256;
  g.fillStyle = PANEL;
  g.fillRect(0, 0, W, H);
  roundRect(g, 10 * k, 10 * k, W - 20 * k, H * 0.42, 12 * k);
  g.fillStyle = AMBER;
  g.fill();
  flatText(g, 'TAXI', W / 2, 10 * k + H * 0.21, W - 60 * k, Math.round(64 * k), ON_ACCENT, 800);
  flatText(g, '택시 승강장', W / 2, H * 0.64, W - 40 * k, Math.round(38 * k), WHITE, 800);
  flatText(g, 'E 키로 호출', W / 2, H * 0.85, W - 40 * k, Math.round(22 * k), MUTED, 700);
  return canvas;
}

/** Waits for the Pretendard weights the canvases use (and the glyph subsets for `text`). */
export function fontsReady(text = '타임스퀘어 붕어빵 전광판 점령 응원 포인트') {
  if (!document.fonts?.load) return Promise.resolve();
  const sample = String(text || '').slice(0, 80) || 'A';
  return Promise.all([600, 700, 800, 900].map(w => document.fonts.load(`${w} 64px "Pretendard Variable"`, sample))).catch(() => {});
}

// ---- 오늘의 소원 on idle billboards ---------------------------------------------------------------------------
// Pure rules first (no DOM, no three: test/wish-boards.test.mjs imports this file in Node), then the card painter.
// A board that is not live alternates its normal notice with a wish card. Wish text is untrusted: it only reaches fillText.
export const WISH_CYCLE = Object.freeze({ wish: 9000, rest: 5000 });
export const WISH_CYCLE_LOW = Object.freeze({ wish: 15000, rest: 9000 });
// The repaint cadence (screens.js update(): every 8th 0.08 s tick) and the canvases repainted per tick for rotation.
// Demand with all 81 boards idle: 81 * 2 flips per cycle = 7.41 per tick (normal, 14 s), 4.32 (low, 24 s); supply 8 / 5.
export const WISH_TICK_MS = 640, WISH_BUDGET = 8, WISH_BUDGET_LOW = 5;
// Boards ranked among the nearest WISH_NEAR jump the queue by WISH_NEAR_MS; everyone else is first come, first served.
// The nearest WISH_START boards show a card at once when wishes (re)appear; the rest wait for their own next wish phase.
export const WISH_NEAR = 10, WISH_NEAR_MS = 1280, WISH_PINS = 4, WISH_START = 4;
// After the first (possibly empty) list, this long with nothing non-empty and the next new wish counts as freshly posted.
export const WISH_SETTLE_MS = 8000;
const WISH_MAX_CP = 24, WISH_ONE_LINE = 12, WISH_SLOTS = SLOT_IDS.length;
// Phase lane: (order * 13) mod 81, so neighbours sit 13/81 of a cycle apart (no two flip within 2 s of each other).
const WISH_STRIDE = 13;
const WISH_ORD = new Map(SLOT_IDS.map((id, i) => [id, i]));
const WISH_CTRL = /[\u0000-\u001f\u007f-\u009f]/g;
const WISH_INVIS = /[​‌‎‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** Stable order of a claimable slot (0..80); other ids hash into the same range. */
export function wishOrd(slotId) {
  const i = WISH_ORD.get(String(slotId));
  return i ?? hashStr(slotId) % WISH_SLOTS;
}
const wishLane = (ord) => (ord * WISH_STRIDE) % WISH_SLOTS;
/** Rotation step at time ms: even = wish card, odd = normal notice. Changes twice per cycle. No allocation. */
export function wishStep(ord, ms, cyc = WISH_CYCLE) {
  const P = cyc.wish + cyc.rest;
  const u = ms + Math.floor(wishLane(ord) * P / WISH_SLOTS);
  const c = Math.floor(u / P);
  return c * 2 + (u - c * P < cyc.wish ? 0 : 1);
}
/** Which of n wishes a slot shows during a step (-1 when there are none).
 *  idx = ord + C where C = cycle + floor(13*ord/81) is the cycle counted on the unwrapped lane 13*ord/81. Adjacent ords
 *  differ by 13/81 of a cycle on that unwrapped lane, which is less than the notice share (5/14, 8/20), so whenever both are
 *  in the wish phase they are in the same C and their indices differ by exactly 1: never the same wish for n >= 2. */
export function wishIndex(ord, step, n) {
  return n > 0 ? (ord + Math.floor(step / 2) + Math.floor(ord * WISH_STRIDE / WISH_SLOTS)) % n : -1;
}
/** lit_until / expires_at as ms (0 when missing or unparsable). Parse once per row change, not per tick. */
export function rowUntil(row) {
  const until = row?.lit_until || row?.expires_at;
  const ms = until ? new Date(until).getTime() : 0;
  return ms > 0 ? ms : 0;
}
/** True when the slot's screen may rotate wishes: claimable, not live, no photo pending/approved, no air show, and not
 *  a main-tower slot while its 21:00–21:10 window is open. until = rowUntil(row) (same rule as balance.js live()). */
export function wishRotates(slotId, row, air, mainOpen, now = Date.now(), until = rowUntil(row)) {
  if (air || !WISH_ORD.has(String(slotId))) return false;
  if (row?.holder_id && until > now) return false;
  if (row?.holder_id && (row.photo_status === 'pending' || row.photo_status === 'approved')) return false;
  if (mainOpen && String(slotId).startsWith('MAIN_')) return false;
  return true;
}
/** The claim cue the wish card keeps in its bottom strip (same price the house notice uses). */
export function wishStrip(slotId, row, mainOpen) {
  if (row?.holder_id) return '불 꺼짐 · 주인이 다시 켤 수 있어요';
  const price = (floorOf(slotId) || 0).toLocaleString('en-US') + '포인트부터';
  return String(slotId).startsWith('MAIN_') && !mainOpen ? '밤 9시에 10분만 열려요 · ' + price : '빈 자리 · ' + price;
}
/** What a board needs this tick. 'drop': its card must go now (not allowed to rotate, or nothing to show) — never budgeted.
 *  'reset': not allowed and nothing shown. 'none': step already painted. 'quiet': notice phase and the notice is up.
 *  'due': a repaint for the new step, served by wishPick. A board that has painted nothing yet (key -1: first list, or after
 *  a drop) and is not among the nearest waits quietly for its own next wish phase, so a (re)start is no 81-board burst. */
export function wishWork(hasWish, ok, step, key, near = true) {
  if (!ok) return hasWish ? 'drop' : 'reset';
  if (step === key) return 'none';
  if (!hasWish && (step % 2 === 1 || (key === -1 && !near))) return 'quiet';
  return 'due';
}
/** Chooses up to budget of count waiting boards: since[i] = when board i became due (ms), rank[i] = its place in the
 *  nearest-first list. Earliest effective time first, where the nearest WISH_NEAR boards count WISH_NEAR_MS earlier; ties go
 *  to the nearer board. Writes indices into out and returns how many. No allocation. */
export function wishPick(since, rank, count, budget, out) {
  let k = 0;
  out.length = 0;
  while (k < budget) {
    let best = -1, bk = Infinity, br = Infinity;
    for (let i = 0; i < count; i++) {
      let taken = false;
      for (let j = 0; j < k; j++) if (out[j] === i) { taken = true; break; }
      if (taken) continue;
      const key = since[i] - (rank[i] < WISH_NEAR ? WISH_NEAR_MS : 0);
      if (key < bk || (key === bk && rank[i] < br)) { best = i; bk = key; br = rank[i]; }
    }
    if (best < 0) break;
    out[k++] = best;
  }
  return k;
}
// Boards repainted at once when the list changes or a font lands (the nearest ones); the rest are marked (wishDrop) and
// the tick clears up to WISH_DROPS of them per tick, nearest first.
export const WISH_NOW = 10, WISH_DROPS = 8;
function wishClear(s, res) {
  if (s.wish) res.delta--;
  s.wish = null;
  s.wishPin = 0;
  s.wishKey = -1;
  s.wishDue = 0;
  s.wishDrop = false;
}
/** The whole decision loop of one 0.64 s wish tick (screens.js runs exactly this). states: board-like objects in
 *  nearest-first order with {wish, wishKey, wishPin, wishDue, wishDrop, wishOrd}; oks[i]: may board i rotate now.
 *  cfg: {list, now, cyc, budget, drops, since[], rank[], who[], pick[]} (scratch arrays reused, no allocation).
 *  Mutates the states (wish shown, key, due, pin, drop flag), writes the indices to repaint into out and returns how many;
 *  cfg.delta = change in boards showing a card. Per tick: at most budget rotation repaints + drops marked clears +
 *  boards that stopped being allowed since the last tick (those are already repainted by the event that caused it). */
export function wishPlan(states, oks, count, cfg, out) {
  const { list, now, cyc, budget, drops } = cfg;
  const n = list.length;
  let k = 0, c = 0, dropped = 0;
  cfg.delta = 0;
  for (let i = 0; i < count; i++) {
    const s = states[i], ok = oks[i];
    if (s.wishDrop) {
      if (dropped < drops) { dropped++; wishClear(s, cfg); out[k++] = i; }
      continue;
    }
    if (s.wishPin) {
      if (ok && s.wishPin > now) continue;
      s.wishPin = 0;
    }
    const step = ok ? wishStep(s.wishOrd, now, cyc) : -1;
    const work = wishWork(!!s.wish, ok, step, s.wishKey, i < WISH_START);
    if (work === 'none') continue;
    if (work === 'drop') { wishClear(s, cfg); out[k++] = i; continue; }
    if (work === 'reset') { s.wishKey = -1; s.wishDue = 0; continue; }
    if (work === 'quiet') { s.wishKey = step; s.wishDue = 0; continue; }
    if (!s.wishDue) s.wishDue = now;
    if (c < cfg.since.length) { cfg.since[c] = s.wishDue; cfg.rank[c] = i; cfg.who[c] = i; c++; }
  }
  const m = wishPick(cfg.since, cfg.rank, c, budget, cfg.pick);
  for (let j = 0; j < m; j++) {
    const i = cfg.who[cfg.pick[j]], s = states[i];
    const step = wishStep(s.wishOrd, now, cyc);
    const w = step % 2 === 0 ? list[wishIndex(s.wishOrd, step, n)] : null;
    s.wishKey = step;
    s.wishDue = 0;
    if (w && !s.wish) cfg.delta++;
    else if (!w && s.wish) cfg.delta--;
    s.wish = w;
    out[k++] = i;
  }
  return k;
}
/** A new list: boards (nearest-first) whose wish left the list or was edited. The nearest nearN are fixed now (edited →
 *  the new text, gone → the notice) and listed in out; the rest get wishDrop so the tick clears them and no paint shows the
 *  old wish meanwhile. Unchanged wishes swap to the new object (hearts) without a repaint. Returns how many are in out;
 *  res.delta = change in boards showing a card. */
export function wishRelist(states, count, byId, nearN, res, out) {
  let k = 0;
  res.delta = 0;
  for (let i = 0; i < count; i++) {
    const s = states[i];
    if (!s.wish || s.wishDrop) continue;
    const nw = byId.get(s.wish.id);
    const edited = !!nw && (nw.txt !== s.wish.txt || nw.nick !== s.wish.nick);
    if (nw && !edited) { s.wish = nw; continue; }
    if (i < nearN) {
      if (nw) { s.wish = nw; s.wishFontOk = false; } else wishClear(s, res);
      out[k++] = i;
    } else s.wishDrop = true;
  }
  return k;
}
/** When the font for wish w has loaded: which of the nearest nearN boards to repaint (showing exactly w, not yet painted
 *  with the loaded font, not marked for a drop). Farther boards pick the font up at their next step. */
export function wishFontTargets(states, count, w, nearN, out) {
  let k = 0;
  for (let i = 0; i < count && i < nearN; i++) {
    const s = states[i], x = s.wish;
    if (x && !s.wishDrop && !s.wishFontOk && x.id === w.id && x.txt === w.txt && x.nick === w.nick) out[k++] = i;
  }
  return k;
}
/** Boards to pin a wish on: cands in nearest-first order, {ok, pinId, pinUntil}. Up to max boards that may rotate; a board
 *  already pinned to this id (pin not expired) counts but is not repainted. Returns {covered, paint: [indices to paint]}. */
export function wishPinPick(cands, id, now, max = WISH_PINS) {
  const paint = [];
  let covered = 0;
  for (let i = 0; i < cands.length && covered < max; i++) {
    const c = cands[i];
    if (!c.ok) continue;
    covered++;
    if (!(c.pinId === id && c.pinUntil > now)) paint.push(i);
  }
  return { covered, paint };
}
/** pinWish(id): null when id is not in the current list (no-op), otherwise {wish, covered, paint}. */
export function wishPinPlan(list, id, cands, now, max = WISH_PINS) {
  const key = String(id ?? '');
  let wish = null;
  for (const w of list) if (w.id === key) { wish = w; break; }
  if (!wish) return null;
  const r = wishPinPick(cands, key, now, max);
  return { wish, covered: r.covered, paint: r.paint };
}
/** The first wish of next whose id is not in seen, once the initial load is over (loaded). */
export function freshWish(seen, next, loaded) {
  if (!loaded) return null;
  for (const w of next) if (!seen.has(w.id)) return w;
  return null;
}
/** Whether the initial load is over: a non-empty list arrived, or the first list (firstAt, ms) was WISH_SETTLE_MS ago. */
export function wishSettled(firstAt, nonEmptySeen, now) {
  return !!nonEmptySeen || (firstAt > 0 && now - firstAt >= WISH_SETTLE_MS);
}
/** User-perceived characters: code points glued by ZWJ, variation selectors, skin tones, keycaps, tags, combining marks,
 *  and regional-indicator pairs (flags). */
export function wishGlyphs(text) {
  const out = [];
  let glue = false, ri = false;
  for (const ch of String(text ?? '')) {
    const cp = ch.codePointAt(0);
    const isRi = cp >= 0x1f1e6 && cp <= 0x1f1ff;
    const joins = cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x1f3fb && cp <= 0x1f3ff) || cp === 0x20e3 || (cp >= 0xe0020 && cp <= 0xe007f) || (cp >= 0x300 && cp <= 0x36f);
    if (out.length && (joins || glue || (isRi && ri))) {
      out[out.length - 1] += ch;
      ri = false;
    } else {
      out.push(ch);
      ri = isRi;
    }
    glue = cp === 0x200d;
  }
  return out;
}
// Capped first (24 code points never need more than 400 UTF-16 units even with long emoji sequences), control characters
// become spaces so "행복\n하자" keeps its two words, invisible and bidi marks go, whitespace runs collapse.
const wishClean = (text) => String(text ?? '').slice(0, 400).replace(WISH_CTRL, ' ').replace(WISH_INVIS, '').replace(/\s+/g, ' ').trim();
// Up to 24 code points without cutting a glyph, as glyphs.
function wishClip(text) {
  const g = [];
  let n = 0;
  for (const c of wishGlyphs(wishClean(text))) { n += Array.from(c).length; if (n > WISH_MAX_CP) break; g.push(c); }
  while (g.length && g[g.length - 1] === ' ') g.pop();
  return g;
}
/** The wish as 1–2 lines: up to 24 code points (never cutting a glyph), one line up to 12 glyphs, otherwise a break at
 *  the space nearest the middle (within the middle half), else by glyphs. Never an empty line. */
export function wishLines(text) {
  const g = wishClip(text);
  if (!g.length) return [];
  if (g.length <= WISH_ONE_LINE) return [g.join('')];
  const mid = g.length / 2;
  let cut = -1, best = Infinity;
  for (let i = 1; i < g.length - 1; i++) {
    if (g[i] !== ' ' || i < g.length * 0.25 || i > g.length * 0.75) continue;
    const d = Math.abs(i - mid);
    if (d < best) { best = d; cut = i; }
  }
  const a = (cut > 0 ? g.slice(0, cut) : g.slice(0, Math.ceil(mid))).join('').trim();
  const b = (cut > 0 ? g.slice(cut + 1) : g.slice(Math.ceil(mid))).join('').trim();
  return b ? [a, b] : [a];
}
/** setWishes input → at most 24 distinct {id, nick, txt, hearts}; rows without an id or text are dropped. */
export function cleanWishes(list) {
  const out = [], seen = new Set();
  if (!Array.isArray(list)) return out;
  for (const w of list) {
    if (out.length >= 24) break;
    if (!w || w.id == null || w.id === '') continue;
    const id = String(w.id);
    const txt = wishClip(w.txt).join('');
    if (!txt || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, nick: chars(wishClean(w.nick), 16) || '누군가', txt, hearts: Math.max(0, Math.floor(Number(w.hearts) || 0)) });
  }
  return out;
}
/** Same ids, text, names and hearts in the same order: setWishes has nothing to do. */
export function sameWishes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.id !== y.id || x.hearts !== y.hearts || x.txt !== y.txt || x.nick !== y.nick) return false;
  }
  return true;
}

/** 계절 소원 테마 (seasons.js SEASONS[key]) on a wish card: a two-colour top line, an accent hairline over the panel border and the
 *  season's emoji in the top-right corner. The wish itself stays white 800 type on the same navy panel, so a card is as readable
 *  as on any other day; only the chip, the strip text and these three marks change colour. */
function seasonTrim(g, W, body, k, sn, pad) {
  const top = Math.max(3, Math.round(8 * k));
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, sn.accent);
  grad.addColorStop(1, sn.accent2 || sn.accent);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, top);
  const lw = Math.max(1, 2 * k), inset = Math.max(3, 10 * k);
  g.strokeStyle = rgba(sn.accent, 0.55);
  g.lineWidth = lw;
  g.strokeRect(inset + lw / 2, inset + lw / 2, W - inset * 2 - lw, body - inset * 2 - lw);
  const size = Math.max(14, Math.round(64 * k));
  g.font = `${size}px ${EMOJI}`;
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  g.fillStyle = WHITE; // colour emoji ignore it; a text-only fallback glyph stays legible
  g.fillText(sn.emoji, W - pad, 30 * k + size * 0.62);
}
/** Wish card on a billboard canvas. data: {id, nick, txt, hearts}. opts.chip: label chip text, opts.strip: bottom claim
 *  cue, opts.dark: owner's light is out, opts.wide: a main-tower board (a line spans 35–70% of the width), opts.season:
 *  a seasons.js SEASONS entry (chip, strip text and marks take its accent). The same calm panel as every board: amber chip, the wish in large white type,
 *  nickname and a drawn heart below, so forty of them sit quietly next to the live ads. */
export function paintWish(canvas, data = {}, opts = {}) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = W / 1024;
  const statsH = Math.max(28, Math.round(46 * k));
  const body = H - statsH;
  const pad = 44 * k;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  const sn = opts.season && opts.season.accent && opts.season.emoji ? opts.season : null;
  const hue = sn ? sn.accent : AMBER;
  boardPanel(g, W, body, k, hue, false);
  if (sn) seasonTrim(g, W, body, k, sn, pad);
  const chip = String(opts.chip || (sn ? `${sn.emoji} ${sn.chip} 소원` : '오늘의 소원'));
  const ch = pill(g, pad, 30 * k, chip, hue, Math.max(11, Math.round(26 * k)), W * 0.62, 'soft').h;

  const lines = wishLines(data.txt);
  const top = Math.max(30 * k + ch + 18 * k, 96 * k), bottom = body - 86 * k, avail = bottom - top, maxW = W - pad * 2;
  const lineW = opts.wide ? Math.min(maxW, W * WIDE_MAX - pad) : maxW;
  let size = lines.length > 1 ? 120 * k : 150 * k;
  for (const line of lines) size = Math.min(size, fit(g, line, lineW, size, 800, SANS, 30 * k));
  if (opts.wide && lines.length === 1) size = wideGrow(g, lines[0], size, () => 0, W, 230 * k);
  size = Math.round(Math.min(size, avail / (lines.length > 1 ? 2.28 : 1.14)));
  const lh = size * 1.14;
  let y = top + avail / 2 - (lines.length - 1) * lh / 2;
  g.font = `800 ${size}px ${SANS}`;
  g.fillStyle = WHITE;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  for (const line of lines) {
    g.fillText(line, pad, y, maxW);
    y += lh;
  }

  footRow(g, W, body - 44 * k, k, chars(wishClean(data.nick), 16) || '누군가', data.hearts);
  infoStrip(g, W, H, statsH, k, String(opts.strip || '하루 한 줄, 누구나 무료'), opts.dark ? MUTED : hue);
  g.restore();
  return canvas;
}
