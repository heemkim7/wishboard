// 실사 축하 영상 (docs/superpowers/specs/2026-11-27-real-video-design.md): the pure rules the in-browser compositor (realvideo.js), its
// card (realcard.js) and the owner page (giftpage.js) share, and the tests. No DOM, no I/O. Browser only (the Worker never composes a
// video), so it is imported as ./realrules.js?v=BUILD; it imports giftrules.js, which the Worker bundles, with no query.
//
// The plates are AI-made Times-Square-like night scenes with green screens (tools/plates/ makes them into assets/plates/): per scene a
// 1080x1920 24 fps mp4 of 241 frames, a small preview jpg and a JSON with each screen's four corners per frame (TL, TR, BR, BL in
// output pixels), its kind (led: a big LED board; phone: a phone held up, glass, no dots; small: a far phone, dim) and its card
// layout (card, banner, wide, corner: a board wrapped round a building corner, two faces split at `split`).
import { OCCASIONS, REAL_BEACONS, toLine, isMe } from './giftrules.js';

export { REAL_BEACONS };
export const REAL = Object.freeze({
  fps: 24, frames: 241, flash: 1.5, w: 1080, h: 1920, low: Object.freeze({ w: 720, h: 1280 }),
  ambLufs: -34, ambDefaultDb: -10, ambPeakDb: 10, hp: 110, // the street sound under the music (music.py mix: -20 LU under, -10 at the flash)
  bits: Object.freeze({ hi: 8000000, lo: 5000000, audio: 128000 }),
  ledPx: 3, ledContrast: 0.14, ledPow: 0.7, // composite.py led_grid: one LED per 3 output pixels at the narrowest edge
});
export const REAL_DIR = '/assets/plates/';
// The seven scenes in the owner's order; index.json may rename them, this is the fallback and the file-name source.
export const SCENES = Object.freeze(['정면 밤', '타워', '비 오는 밤', '연말 군중', '내 손 휴대폰', '코너 입체', '블루아워']
  .map((name, i) => Object.freeze({ id: String(i + 1).padStart(2, '0'), name })));
// A scene's files. e: its index.json entry: the sizes are its version, so a re-made plate gets new addresses and its video and corner track
// always come as a pair (the same ?v= on both); without one the bare names.
export function plateUrls(id, e = null) {
  const pair = e?.mp4Bytes > 0 && e?.jsonBytes > 0 ? '?v=' + e.mp4Bytes + '-' + e.jsonBytes : '', jv = e?.jpgBytes > 0 ? '?v=' + e.jpgBytes : '';
  return { mp4: REAL_DIR + 'plate-' + id + '.mp4' + pair, jpg: REAL_DIR + 'plate-' + id + '.jpg' + jv, json: REAL_DIR + 'plate-' + id + '.json' + pair };
}
const occOf = (occ) => (typeof occ === 'string' && Object.hasOwn(OCCASIONS, occ) ? occ : 'bday'); // own keys only: not 'constructor'
export const musicUrl = (occ) => REAL_DIR + 'music-' + occOf(occ) + '.m4a';
// The days added 2026-11-27 (사랑, 졸업·승진, 내 전광판) get their own tracks from tools/plates/music.py; until a track is in assets/plates/,
// the page plays this stand-in (a day with a track of its own). The page asks musicUrls in order and keeps the first that answers.
export const MUSIC_BACKUP = Object.freeze({ love: 'anniv', grad: 'pass', me: 'cheer' });
export const musicUrls = (occ) => { const k = occOf(occ), b = Object.hasOwn(MUSIC_BACKUP, k) ? MUSIC_BACKUP[k] : ''; return b ? [musicUrl(k), musicUrl(b)] : [musicUrl(k)]; };

// ---- geometry ------------------------------------------------------------------------------------------------------------
// The 3x3 homography (row-major, h8 = 1) taking the four src points onto the four dst points; null when the quad is degenerate.
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  if (!h) return null;
  const H = [...h, 1];
  const scale = Math.max(...H.map(Math.abs));
  return Math.abs(det3(H)) <= 1e-10 * scale ** 3 ? null : H;
}
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
const det3 = (m) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
export function invert3(m) {
  const d = det3(m), scale = Math.max(...m.map(Math.abs)) || 1;
  if (!Number.isFinite(d) || Math.abs(d) <= 1e-12 * scale ** 3) return null;
  const r = [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]];
  return r.map((v) => v / d);
}
export function applyH(H, [x, y]) { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; }

// ---- time ------------------------------------------------------------------------------------------------------------------
// A media time -> the frame on screen (a frame's own timestamp, even rounded down a hair by the container, is that frame).
export function frameOf(t, fps, frames) { if (!Number.isFinite(t)) return 0; return Math.max(0, Math.min(frames - 1, Math.floor(t * fps + 0.01))); }
export const timeOf = (f, fps) => f / fps;

// ---- the corner track --------------------------------------------------------------------------------------------------------
const isPt = (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const isQuad = (q) => Array.isArray(q) && q.length === 4 && q.every(isPt);
// corners: one quad (a locked-off shot) or one per frame. f may be fractional (linear between frames); clamped to the clip.
export function quadAt(corners, f) {
  if (isQuad(corners)) return corners;
  const n = corners.length, g = Math.max(0, Math.min(n - 1, f)), i = Math.floor(g), j = Math.min(i + 1, n - 1), a = g - i;
  if (!a) return corners[i];
  return corners[i].map((p, k) => [p[0] + (corners[j][k][0] - p[0]) * a, p[1] + (corners[j][k][1] - p[1]) * a]);
}
const framesOf = (c) => (isQuad(c) ? [c] : c);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// The screen's size on the output over the clip: the narrowest top or bottom edge (LED pitch), the tallest side (texture size),
// the median width over height (a screen whose JSON has no aspect). A corner screen counts both faces together.
export function screenStats(s) {
  const per = [];
  if (s.layout === 'corner' && Array.isArray(s.faces) && s.faces.length === 2) {
    const L = framesOf(s.faces[0].corners), R = framesOf(s.faces[1].corners), n = Math.max(L.length, R.length);
    for (let f = 0; f < n; f++) {
      const l = quadAt(s.faces[0].corners, f), r = quadAt(s.faces[1].corners, f);
      const top = dist(l[0], l[1]) + dist(r[0], r[1]), bot = dist(l[3], l[2]) + dist(r[3], r[2]);
      const hs = [dist(l[0], l[3]), dist(l[1], l[2]), dist(r[0], r[3]), dist(r[1], r[2])];
      per.push({ w: Math.min(top, bot), h: Math.max(...hs), a: (top + bot) / 2 / ((hs[0] + hs[3]) / 2) });
    }
  } else {
    for (const q of framesOf(s.corners || [])) {
      const top = dist(q[0], q[1]), bot = dist(q[3], q[2]), l = dist(q[0], q[3]), r = dist(q[1], q[2]);
      per.push({ w: Math.min(top, bot), h: Math.max(l, r), a: (top + bot) / (l + r) });
    }
  }
  if (!per.length) return { minW: 0, maxH: 0, aspect: 0.7 };
  const as = per.map((p) => p.a).sort((x, y) => x - y);
  return { minW: Math.min(...per.map((p) => p.w)), maxH: Math.max(...per.map((p) => p.h)), aspect: as[as.length >> 1] };
}

// ---- the plate JSON ---------------------------------------------------------------------------------------------------------
export const KINDS = Object.freeze(['led', 'phone', 'small']);
export const LAYOUTS = Object.freeze(['card', 'banner', 'wide', 'corner']);
const okTrack = (c, n) => isQuad(c) || (Array.isArray(c) && c.length === n && c.every(isQuad));
// '' when the compositor can draw it, else the first thing wrong ('json', 'v', 'fps', 'frames', 'size', 'ground', 'screens', 'kind',
// 'layout', 'aspect', 'faces', 'split', 'corners', 'vis').
export function plateFault(j) {
  if (!j || typeof j !== 'object') return 'json';
  if (j.v !== 1) return 'v';
  if (!(j.fps > 0)) return 'fps';
  if (!(Number.isInteger(j.frames) && j.frames > 0)) return 'frames';
  if (!(j.w > 0 && j.h > 0)) return 'size';
  if (j.ground != null && !(j.ground.y > 0 && j.ground.y < 1 && (j.ground.tint == null || Number.isFinite(j.ground.tint)))) return 'ground';
  if (!Array.isArray(j.screens) || !j.screens.length) return 'screens';
  for (const s of j.screens) {
    if (!s || !KINDS.includes(s.kind)) return 'kind';
    if (!LAYOUTS.includes(s.layout)) return 'layout';
    if (!(s.aspect > 0) || !Number.isFinite(s.aspect)) return 'aspect';
    if (s.layout === 'corner') {
      if (!Array.isArray(s.faces) || s.faces.length !== 2 || !s.faces.every((f) => f && okTrack(f.corners, j.frames))) return 'faces';
      if (!(s.split > 0 && s.split < 1)) return 'split';
    } else if (!okTrack(s.corners, j.frames)) return 'corners';
    if (s.vis != null && !(Array.isArray(s.vis) && s.vis.length === j.frames)) return 'vis';
  }
  return '';
}

// ---- the card (card.py layout_for) -------------------------------------------------------------------------------------------
// y: fractions of the card's height (centres); sizes: fractions of its width. head.fit / line.fit: the widest a line may be (of W);
// line.room: the height (of H) a wrapped line may take, centred on line.y, clear of the headline and From.
export function layoutFor(name, aspect) {
  const a = aspect > 0 ? aspect : 0.7;
  if (name === 'corner') {
    const k = (v, cap) => Math.min(v, cap / a); // sizes are fractions of W; on a wide wrap keep them in H terms
    return { name: 'corner', inset: 0.035, radius: 0.05, lw: 0.008, badge: { y: 0.075, size: k(0.075, 0.05) }, to: { y: 0.165, size: k(0.1, 0.055) },
      head: { ys: [0.275, 0.395], size: k(0.22, 0.12), fit: 0.84 }, line: { y: 0.49, size: k(0.07, 0.04), fit: 0.84, maxLines: 2, room: 0.085 },
      frm: { y: 0.552, size: k(0.052, 0.03) }, brand: { y: 0.955, size: k(0.032, 0.02) }, burst: 0.78 };
  }
  if (name === 'wide' || (!LAYOUTS.includes(name) && a >= 1.05)) {
    return { name: 'wide', inset: 0.03, radius: 0.035, lw: 0.006, badge: { y: 0.115, size: 0.048 }, to: { y: 0.255, size: 0.062 },
      head: { ys: [0.47], size: 0.14, fit: 0.82 }, line: { y: 0.675, size: 0.05, fit: 0.7, maxLines: 2, room: 0.17 },
      frm: { y: 0.79, size: 0.038 }, brand: { y: 0.915, size: 0.022 }, burst: 0.5 };
  }
  if (name === 'card' || (!LAYOUTS.includes(name) && a >= 0.55)) {
    return { name: 'card', inset: 0.035, radius: 0.05, lw: 0.008, badge: { y: 0.095, size: 0.07 }, to: { y: 0.225, size: 0.115 },
      head: { ys: [0.398, 0.562], size: 0.25, fit: 0.8 }, line: { y: 0.715, size: 0.078, fit: 0.8, maxLines: 2, room: 0.12 },
      frm: { y: 0.81, size: 0.06 }, brand: { y: 0.925, size: 0.034 }, burst: 0.5 };
  }
  return { name: 'banner', inset: 0.05, radius: 0.07, lw: 0.012, badge: { y: 0.08, size: 0.095 }, to: { y: 0.195, size: 0.2 },
    head: { ys: [0.365, 0.47], size: 0.3, fit: 0.84 }, line: { y: 0.643, size: 0.13, fit: 0.8, maxLines: 3, room: 0.2 },
    frm: { y: 0.78, size: 0.09 }, brand: { y: 0.925, size: 0.05 }, burst: 0.5 };
}

const cps = (s) => Array.from(String(s ?? ''));
// Greedy lines between words; a word wider than the line is broken between letters.
function wrapWords(text, maxW, w) {
  const out = []; let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const t = cur ? cur + ' ' + word : word;
    if (w(t) <= maxW) { cur = t; continue; }
    if (cur) out.push(cur);
    cur = '';
    for (const ch of cps(word)) { if (cur && w(cur + ch) > maxW) { out.push(cur); cur = ch; } else cur += ch; }
  }
  if (cur) out.push(cur);
  return out;
}
// The biggest size from `size` down to `min` at which text fits maxW: first one line (down to 80 % of size), then up to maxLines,
// then at min the last line cut with an ellipsis. measure(text, size) -> width. -> { size, lines }.
export function fitLines(text, measure, maxW, size, min, maxLines = 2) {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return { size: Math.round(size), lines: [] };
  const sizes = []; for (let s = Math.round(size); s > min; s -= Math.max(1, Math.round(s * 0.04))) sizes.push(s);
  sizes.push(Math.round(min));
  for (const s of sizes) { if (s < 0.8 * size) break; if (measure(t, s) <= maxW) return { size: s, lines: [t] }; }
  for (const s of sizes) { const lines = wrapWords(t, maxW, (x) => measure(x, s)); if (lines.length <= maxLines) return { size: s, lines }; }
  const s = Math.round(min), lines = wrapWords(t, maxW, (x) => measure(x, s)).slice(0, maxLines);
  let last = cps(lines[maxLines - 1]);
  while (last.length && measure(last.join('') + '…', s) > maxW) last.pop();
  lines[maxLines - 1] = last.join('').trimEnd() + '…';
  return { size: s, lines };
}

// The occasion's headline in two lines ('생일 축하해요' -> 생일 / 축하해요!): a wish ending in 요 gets its exclamation mark.
export function headOf(occ) {
  const words = OCCASIONS[occOf(occ)].head.split(' '), last = words.pop();
  return [words.join(' '), /요$/.test(last) ? last + '!' : last];
}
// The words on the card for a gift (to, from, occ, msg): no emoji anywhere (the badge draws its own icon).
export function cardWords(g) {
  const key = occOf(g?.occ), O = OCCASIONS[key];
  const to = String(g?.to ?? '').trim(), from = String(g?.from ?? '').trim(), msg = String(g?.msg ?? '').trim();
  // 내 전광판: the name with "by" and no sender (toLine)
  return { key, to: toLine({ occ: key, to }), occ: O.name, head: headOf(key), line: msg || O.hint, from: from && !isMe({ occ: key }) ? 'From. ' + from : '', brand: 'WISH BOARD' };
}

// ---- the corner's gift box (corner.py GiftPop.state) -------------------------------------------------------------------------
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth01 = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
export const easeOutBack = (t, s = 1.70158) => { const u = clamp01(t) - 1; return u * u * ((s + 1) * u + s) + 1; };
// null before 1.58 s; out: along the outward diagonal in fold heights (-0.22 inside the building .. 0.05 in front), lid: radians open.
export function popAt(t) {
  const p = (t - 1.58) / 0.75;
  if (p <= 0) return null;
  const e = easeOutBack(p, 1.4);
  return { p, out: -0.22 + 0.27 * e, scale: 0.55 + 0.45 * Math.min(1, p * 1.3),
    yaw: 0.9 * (1 - smooth01(p)) + 0.16 * Math.sin(2 * Math.PI * (t - 1.6) / 5) * smooth01((t - 2.2) / 1),
    bob: 0.012 * Math.sin(2 * Math.PI * (t - 2.3) / 2.4) * smooth01((t - 2.3) / 0.8),
    lid: (118 * Math.PI / 180) * easeOutBack((t - 2.55) / 0.42, 2.0), size: 0.11, y0: 0.07 };
}

// ---- sound -------------------------------------------------------------------------------------------------------------------
const smoothstep = (a, b, x) => smooth01((x - a) / (b - a));
// The plate's street sound gain (dB) that brings it to about REAL.ambLufs; a plate whose loudness is not given gets the default.
export function ambBaseDb(lufs) { return Number.isFinite(lufs) ? Math.max(-40, Math.min(12, REAL.ambLufs - lufs)) : REAL.ambDefaultDb; }
// music.py ambience_gain: base dB, rising to peak dB around the flash and back. -> linear gain.
export function ambGain(t, flash, baseDb, peakDb) {
  const w = smoothstep(flash - 0.45, flash - 0.15, t) * (1 - smoothstep(flash + 0.6, flash + 1.05, t));
  return 10 ** ((baseDb + (peakDb - baseDb) * w) / 20);
}
export function ambCurve(n, dur, flash, baseDb, peakDb) { const c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = ambGain((i * dur) / (n - 1), flash, baseDb, peakDb); return c; }

// ---- the LED look, the texture, the device ------------------------------------------------------------------------------------
// Mean of the raised-cosine dot grid ((gx * gy) ** p over a period), so dividing by it keeps the board's brightness.
export function ledMean(p = REAL.ledPow) { let s = 0; const n = 4096; for (let i = 0; i < n; i++) s += (0.5 + 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / n)) ** p; return (s / n) ** 2; }
export const ledCols = (minW, scale = 1) => Math.max(40, Math.floor((minW * scale) / REAL.ledPx));
// The card texture: about 1.3 texture pixels per output pixel of the screen's height, 320..1280 tall, at most 2048 wide.
export function texSize(aspect, hPx) { let h = Math.max(320, Math.min(1280, Math.round(hPx * 1.3))); if (h * aspect > 2048) h = Math.floor(2048 / aspect); return { w: Math.round(h * aspect), h }; }
// After the first second: did the device draw enough of the frames the video showed? At 1080: two thirds (else 720x1280); at 720 a
// third (else this device is too slow for it: the drawn film is offered instead).
export const keepsUp = (drawn, expected, min = 0.66) => !(expected > 0) || drawn >= min * expected;
// What MediaRecorder is asked for, picture and sound together: MP4 (H.264 + AAC; it plays on every phone) first, WebM otherwise.
export const REAL_TYPES = Object.freeze(['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,opus',
  'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']);
export function pickRealType(supported) { for (const t of REAL_TYPES) { try { if (supported(t)) return t; } catch { /* next */ } } return ''; }
// The end of a run: 'done' only when the video reached its last two frames (else 'short': the safety timer or an early stop is not a
// video); any other reason as it is, none at all 'fail'.
export function finishReason(why, lastFrame, frames) { return !why ? 'fail' : why === 'done' && lastFrame < frames - 2 ? 'short' : why; }
// This device made it only at 720 within the last week (kts_reallo holds that time; the old flag '1' has none and has expired).
export const LOW_MS = 7 * 864e5;
export function lowFor(saved, now) { const t = Number(saved); return Number.isFinite(t) && t > 1e12 && t <= now && now - t < LOW_MS; }
// An app's own browser (KakaoTalk, Instagram, Facebook, LINE, NAVER, Daum, 에브리타임): no share sheet and blob downloads go nowhere.
export function inAppBrowser(ua) { return /KAKAOTALK|Instagram|FBAN|FBAV|\bLine\/|NAVER\(inapp|DaumApps|everytimeApp/i.test(String(ua || '')); }
// Scenes kept in memory, oldest first: all but the last two go (the one in hand and the one before).
export const scenesToDrop = (order) => order.slice(0, Math.max(0, order.length - 2));
export function realReason({ rec, gl }) { return !rec ? 'record' : !gl ? 'webgl' : ''; }
// wishboard-<받는 사람>-<장면>.mp4: control characters and direction marks go, what a file system refuses (and spaces) become _, at
// most 40 code points each (never half of an emoji's pair).
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
export function realFileName(g, scene, type) {
  const clean = (s, d) => Array.from(String(s ?? '').replace(INVISIBLE, '').trim().replace(/[\\/:*?"<>|\s]+/g, '_')).slice(0, 40).join('') || d;
  return 'wishboard-' + clean(g?.to, 'gift') + '-' + clean(scene, 'video') + (String(type || '').includes('webm') ? '.webm' : '.mp4');
}
