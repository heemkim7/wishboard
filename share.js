import { SLOT_IDS } from './balance.js';
import { SITE } from './plaza-account.js';

export function cardUrl(slot, opts = {}) {
  if (!SLOT_IDS.includes(String(slot || ''))) return '';
  const u = new URL('rt/card/' + slot, SITE);
  if (opts.gift) u.searchParams.set('gift', '1');
  if (opts.ref && /^[a-z0-9]{8}$/.test(opts.ref)) u.searchParams.set('ref', opts.ref);
  return u.toString();
}

// POST /rt/snap context: which board or wish the picture shows. The server keeps it only for that board's holder / that wish's author.
const SNAP_SLOT = /^(MAIN_(UP|TOP|MID|BOT|LOW)|SUB_[1-4][AB]|STREET_([1-9]|[12]\d|30)|PLOT_([1-9]|1[0-8]))$/;
const WISH_ID = /^[0-9a-z]{10}$/;
export function snapQuery(ctx) {
  const slot = String(ctx?.slot || '');
  if (SNAP_SLOT.test(slot)) return '?slot=' + slot;
  const wish = String(ctx?.wish || '');
  return WISH_ID.test(wish) ? '?wish=' + wish : '';
}

// The link the VIP "+300" button hands out: today's wish, else one of my lit boards, else the site.
export function vipShareLink({ origin, wish, boards, me, now = Date.now() } = {}) {
  const base = String(origin || SITE).replace(/\/+$/, '');
  if (wish && WISH_ID.test(String(wish.id || '')) && !wish.hidden) return { kind: 'wish', url: base + '/rt/w/' + wish.id };
  const lit = (Array.isArray(boards) ? boards : []).find((b) => me && b?.holder_id === me && Date.parse(b.lit_until || b.expires_at || '') > now && cardUrl(b.slot_id));
  if (lit) return { kind: 'board', url: cardUrl(lit.slot_id) };
  return { kind: 'site', url: base + '/' };
}

// Deep-link params that must not replay on a reload once used. Returns the new path+search+hash, or '' when nothing changed.
export const DEEP_KEYS = Object.freeze(['focus', 'gift', 'ref', 'tribe']);
export function dropParams(href, keys = DEEP_KEYS) {
  let u;
  try { u = new URL(String(href || '')); } catch { return ''; }
  let hit = false;
  for (const k of keys) if (u.searchParams.has(k)) { u.searchParams.delete(k); hit = true; }
  return hit ? u.pathname + u.search + u.hash : '';
}

export async function copyCard(slot, opts) {
  const url = cardUrl(slot, opts || {});
  if (!url || typeof navigator === 'undefined' || !navigator.clipboard) return false;
  await navigator.clipboard.writeText(url);
  return true;
}

// A phone already in portrait stays as it is. A wide canvas is copied into a live 9:16 frame so the file is vertical.
function portraitCanvas(canvas) {
  const w = Number(canvas.width) || 0;
  const h = Number(canvas.height) || 0;
  if (!w || !h || w * 16 <= h * 9 || typeof document === 'undefined') return { node: canvas, stop() {} };
  const tw = Math.max(2, Math.round(h * 9 / 16));
  const node = document.createElement('canvas');
  node.width = tw;
  node.height = h;
  const g = node.getContext('2d');
  const sx = Math.max(0, Math.round((w - tw) / 2));
  const draw = () => { try { g.drawImage(canvas, sx, 0, tw, h, 0, 0, tw, h); } catch { /* keep the last frame */ } };
  draw();
  const timer = setInterval(draw, 33);
  return { node, stop() { clearInterval(timer); } };
}

export async function saveClip(canvas) {
  if (typeof MediaRecorder === 'undefined' || !canvas?.captureStream) return null;
  const view = portraitCanvas(canvas);
  let stream = null;
  try {
    stream = view.node.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '' });
    const chunks = [];
    rec.ondataavailable = (ev) => { if (ev.data?.size) chunks.push(ev.data); };
    const done = new Promise((resolve) => { rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || 'video/webm' })); });
    rec.start();
    await new Promise((r) => setTimeout(r, 5000));
    rec.stop();
    const blob = await done;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wishboard.webm';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return blob;
  } finally {
    view.stop();
    if (stream) for (const t of stream.getTracks()) t.stop();
  }
}

// ---- 소원 사진: the wish written onto the captured frame before upload, so the shared picture shows it.
// Pure parts (wrapLine, wishCaption) take a measure function and run in Node; composeWishShot needs a browser canvas.
// Text is only ever drawn with fillText.
export function wrapLine(text, maxW, measure, maxLines = 2) {
  const cps = Array.from(String(text ?? ''));
  const lines = [];
  let cur = '';
  for (const ch of cps) {
    const trial = cur + ch;
    if (cur && measure(trial) > maxW) {
      const sp = cur.lastIndexOf(' ');
      if (sp > 0 && ch !== ' ') { lines.push(cur.slice(0, sp)); cur = cur.slice(sp + 1) + ch; }
      else { lines.push(cur); cur = ch === ' ' ? '' : ch; }
    } else cur = trial;
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const out = lines.slice(0, maxLines);
  let last = Array.from(out[maxLines - 1]);
  while (last.length && measure(last.join('') + '…') > maxW) last.pop();
  out[maxLines - 1] = last.join('').trimEnd() + '…';
  return out;
}
// Layout for a w×h frame: a panel across the top third with "🌠 오늘의 소원", the wish (≤ 2 lines, shrunk to fit), "— nick".
// measure(text, size) -> width in px. y values are text middles (textBaseline 'middle'), x is the panel centre.
export function wishCaption({ w, h, text, nick, measure }) {
  const short = Math.min(w, h);
  const pad = Math.round(short * 0.03);
  const panel = { x: pad, y: pad, w: w - 2 * pad, h: Math.round(h / 3 - pad), r: Math.round(short * 0.025) };
  const maxW = panel.w - 2 * Math.round(panel.w * 0.05);
  const headSize = Math.max(12, Math.round(panel.h * 0.13));
  const bySize = Math.max(12, Math.round(panel.h * 0.12));
  const maxSize = Math.max(14, Math.round(panel.h * 0.3));
  const minSize = Math.max(12, Math.round(panel.h * 0.12));
  const block = (n, size) => headSize * 1.3 + n * size * 1.2 + bySize * 1.3;
  let size = minSize;
  let lines = null;
  for (let s = maxSize; s >= minSize; s -= 2) {
    const all = wrapLine(text, maxW, (t) => measure(t, s), Infinity);
    if (all.length <= 2 && block(all.length, s) <= panel.h * 0.92) { size = s; lines = all; break; }
  }
  if (!lines) lines = wrapLine(text, maxW, (t) => measure(t, size), 2);
  const top = panel.y + (panel.h - block(lines.length, size)) / 2;
  return {
    panel, maxW, size,
    x: panel.x + panel.w / 2,
    head: { text: '🌠 오늘의 소원', size: headSize, y: top + headSize * 0.65 },
    lines: lines.map((t, i) => ({ text: t, y: top + headSize * 1.3 + size * 1.2 * (i + 0.5) })),
    by: { text: '— ' + (String(nick || '') || '누군가'), size: bySize, y: top + headSize * 1.3 + lines.length * size * 1.2 + bySize * 0.65 },
  };
}
// The captured JPEG with the caption drawn on top (the brand bar at the bottom stays). Under 900 KB, or null (upload the plain capture).
export async function composeWishShot(blob, { text, nick } = {}) {
  if (!blob || typeof document === 'undefined' || typeof createImageBitmap !== 'function') return null;
  const bmp = await createImageBitmap(blob);
  try {
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const lay = wishCaption({ w: c.width, h: c.height, text, nick, measure: (t, size) => { g.font = `800 ${size}px sans-serif`; return g.measureText(t).width; } });
    const { x, y, w, h, r } = lay.panel;
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r);
    else g.rect(x, y, w, h);
    g.fillStyle = 'rgba(6,8,20,0.82)';
    g.fill();
    g.lineWidth = Math.max(1, Math.round(r / 6));
    g.strokeStyle = 'rgba(255,207,90,0.7)';
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffcf5a';
    g.font = `700 ${lay.head.size}px sans-serif`;
    g.fillText(lay.head.text, lay.x, lay.head.y);
    g.fillStyle = '#fff6d8';
    g.font = `800 ${lay.size}px sans-serif`;
    for (const l of lay.lines) g.fillText(l.text, lay.x, l.y, lay.maxW);
    g.fillStyle = '#c9cde0';
    g.font = `700 ${lay.by.size}px sans-serif`;
    g.fillText(lay.by.text, lay.x, lay.by.y, lay.maxW);
    for (const q of [0.9, 0.8, 0.7, 0.6, 0.5]) {
      const out = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', q));
      if (out && out.size >= 800 && out.size <= 900000) return out;
    }
    return null;
  } finally { bmp.close?.(); }
}
