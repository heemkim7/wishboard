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

// ---- the corner box in 3D (out/popout-2026-11-28: NOTES.md, box3d.py, render.py) ------------------------------------------------
// The corner screen shows a room behind its frame (walls darker with depth, a tile grid, neon on the inner edges) with the card on a
// panel standing in it, facing the camera; things pop out of the room on the music's beats and may leave the frame over the building
// and the sky. Everything is solved from the plate's camera (plate.camera: P, 3x4 world -> output px; wL, wR the faces' widths).
// World units: the fold's height = 1, the fold is the Y axis, the right face Z = 0 (X in [0, wR]), the left face X = 0 (Z in [0, wL]),
// the building X > 0 and Z > 0, the viewer at X < 0, Z < 0.
//
// Which pop-out a day gets (the owner, 2026-11-28): the days that feel like a gift a box that rises out of the room and lets balloons
// go ('gift'); the days whose words are the point their headline as 3D letters jumping out ('letters'). A day not listed: 'gift'.
export const POP_VARIANT = Object.freeze({ bday: 'gift', anniv: 'gift', love: 'gift', thanks: 'gift', just: 'gift', cheer: 'letters', pass: 'letters', grad: 'letters', me: 'letters' });
export const popVariant = (occ) => (typeof occ === 'string' && Object.hasOwn(POP_VARIANT, occ) ? POP_VARIANT[occ] : 'gift');
// Each day's music (tools/plates/music.py made them; checked against the files' onsets 2026-11-28): tempo, beats in a bar, and t0 =
// beat 0 = the hit at the flash. A day's stand-in track (MUSIC_BACKUP) plays only while its own is missing; all nine are there.
export const MUSIC_BEAT = Object.freeze(Object.fromEntries(Object.entries({ bday: [108, 3], anniv: [84, 3], pass: [112, 4], cheer: [136, 4], just: [104, 4],
  thanks: [76, 4], love: [70, 4], grad: [108, 4], me: [118, 4] }).map(([k, [bpm, meter]]) => [k, Object.freeze({ bpm, meter, t0: REAL.flash })])));
export function beatOf(occ) { const m = MUSIC_BEAT[occOf(occ)]; return { bpm: m.bpm, meter: m.meter, t0: m.t0, beat: 60 / m.bpm }; }
export const beatAt = (bt, k) => bt.t0 + k * bt.beat;
// The beat nearest t (an index; at least `min`).
export const beatNear = (bt, t, min = 0) => Math.max(min, Math.round((t - bt.t0) / bt.beat));
// A short 0..1..0 bump at each beat time (box3d.py beats_hit).
export function beatPulse(t, times, width = 0.16) {
  let v = 0;
  for (const b of times) { const x = (t - b) / width; if (x > -0.3 && x < 1) v = Math.max(v, Math.exp(-(((x - 0.15) / 0.3) ** 2))); }
  return v;
}
// The room's light: dark before the hit with the heartbeat in it, on at the hit, a lift on every beat after. The flash on the screen.
export function roomLights(t, bt) {
  const b = bt.beat, h = bt.t0;
  if (t < h) return 0.07 + 0.1 * beatPulse(t, [h - 2 * b, h - b, h - b / 2, h - b / 4], 0.2) + 0.08 * smooth01((t - h + 0.3) / 0.3);
  const beats = []; for (let k = 1; beatAt(bt, k) < t + 1; k++) beats.push(beatAt(bt, k));
  return 0.55 + 0.45 * smooth01((t - h) / 0.25) + 0.08 * beatPulse(t, beats, 0.25);
}
export function roomFlash(t, bt) { const h = bt.t0; return t < h - 0.06 ? 0 : Math.exp(-Math.max(0, t - h) / 0.12) * smooth01((t - h + 0.06) / 0.06) * 0.85; }

const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vmul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vnorm = (a) => vmul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1e-12));
const vlerp = (a, b, k) => vadd(a, vmul(vsub(b, a), k));
const mv = (M, v) => [vdot(M[0], v), vdot(M[1], v), vdot(M[2], v)];
const mT = (M) => [0, 1, 2].map((j) => [M[0][j], M[1][j], M[2][j]]);
export const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
export function rotAxis(axis, a) {
  const [x, y, z] = vnorm(axis), c = Math.cos(a), s = Math.sin(a), k = 1 - c;
  return [[c + x * x * k, x * y * k - z * s, x * z * k + y * s], [y * x * k + z * s, c + y * y * k, y * z * k - x * s], [z * x * k - y * s, z * y * k + x * s, c + z * z * k]];
}
const lin = (c) => c.map((v) => (v / 255) ** 2.2);
const easeOutCubic = (t) => 1 - (1 - clamp01(t)) ** 3;
// A seeded stream in [0, 1) (the same confetti every time).
function seq(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

// The room from the plate's camera, or null (no camera, or not one this can use). Mi: the inverse of P's left 3x3 (row-major), C: the
// camera centre (plate 6: about (-0.53, 0, -0.62): level with the screen's lower edge, looking up). The frame (rim) is 0.024 wide
// (0.034 at the bottom); the room behind it; the panel (the card) 0.62 of the way along the room's diagonal, 0.47 tall, facing C.
export function cornerRoom(camera) {
  const P = Array.isArray(camera) ? camera : camera?.P, wL = camera?.wL, wR = camera?.wR;
  if (!Array.isArray(P) || P.length !== 3 || !P.every((r) => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite))) return null;
  if (!(wL > 0.1 && wL < 5 && wR > 0.1 && wR < 5)) return null;
  const Mi = invert3([P[0][0], P[0][1], P[0][2], P[1][0], P[1][1], P[1][2], P[2][0], P[2][1], P[2][2]]);
  if (!Mi) return null;
  const C = [0, 1, 2].map((i) => -(Mi[i * 3] * P[0][3] + Mi[i * 3 + 1] * P[1][3] + Mi[i * 3 + 2] * P[2][3]));
  if (!(C[0] < 0 && C[2] < 0)) return null; // the viewer must be in front of both faces
  const rim = 0.024, rimb = 0.034, rx = wR - rim, rz = wL - rim, y0 = rimb, y1 = 1 - rim;
  const ctr = [rx * 0.62, 0.645, rz * 0.62], up = [0, 1, 0], thick = 0.018;
  const n = vnorm([C[0] - ctr[0], 0, C[2] - ctr[2]]), rt = vnorm(vcross(n, up));
  let hw = 0.5;
  const fits = (h) => [-1, 1].every((sr) => [-1, 1].every((sn) => { const p = vadd(vadd(ctr, vmul(rt, h * sr)), vmul(n, (thick / 2) * sn)); return p[0] > 0.012 && p[0] < rx - 0.012 && p[2] > 0.012 && p[2] < rz - 0.012; }));
  while (hw > 0.05 && !fits(hw)) hw -= 0.005;
  return { P, Mi, C, wL, wR, rim, rimb, rx, rz, y0, y1, panel: { ctr, rt, up, n, half: [hw, 0.235, thick / 2] },
    Lsun: vnorm([-0.74, 0.16, -0.62]), Lobj: vnorm([-0.95, 0.55, -0.15]), glow: vnorm([1, 0.1, 1]), out: vnorm([-1, 0, -1]) };
}
// A world point -> [x, y] output px of the plate and its depth (> 0 in front of the camera).
export function projectRoom(room, w) { const q = room.P.map((r) => r[0] * w[0] + r[1] * w[1] + r[2] * w[2] + r[3]); return [q[0] / q[2], q[1] / q[2], q[2]]; }
// Inside the building (X > 0 and Z > 0) a thing shows only through the opening; in front of it, anywhere.
export function throughOpening(room, p) {
  if (Math.min(p[0], p[2]) <= 0) return true;
  const R = vsub(p, room.C), tX = -room.C[0] / R[0], tZ = -room.C[2] / R[2], tf = Math.max(tX, tZ), f = vadd(room.C, vmul(R, tf));
  const left = tX >= tZ, u = left ? f[2] : f[0], w = left ? room.wL : room.wR;
  return u < w - room.rim && f[1] > room.rimb && f[1] < 1 - room.rim;
}

// The room's colours from the gift's theme (0..255 { a, b, hi, deep }) in linear light: the walls take the theme's dark hue at one
// brightness (the prototype's party room), so every theme keeps the lit card and the neon brighter than the room around them; the
// neon is the theme's accent, or its highlight where the accent is too dark to glow (밤하늘).
export const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
export function roomPalette(theme) {
  const mixc = (x, y, k) => x.map((v, i) => v + (y[i] - v) * k), raw = lin(mixc(theme.deep, theme.b, 0.55)), L = luma(raw);
  // warm walls look brighter than blue ones at the same luminance: the less blue, the darker
  const blue = raw[2] / Math.max(1e-6, raw[0] + raw[1] + raw[2]), target = 0.045 * (0.5 + 0.5 * blue);
  const wall = L > 1e-5 ? raw.map((v) => Math.min(1, (v * target) / L)) : [0.03, 0.03, 0.08], a = lin(theme.a);
  const neon = luma(a) < 0.12 ? lin(theme.hi) : a;
  return { wall, ceil: wall.map((v) => v * 0.6), neon, gold: lin(theme.hi) };
}
// A face's colour (box3d.py shade): the key from the upper left, a fill from the screen on faces turned to it, darker inside the room.
function shade(room, n, base, inside, glow, k = 1) {
  const ndl = Math.max(0, vdot(n, room.Lobj)), ndg = Math.max(0, vdot(n, room.glow)), amb = inside ? 0.22 : 0.3, key = inside ? 0.8 : 1;
  return base.map((b, i) => b * (amb + key * ndl) + glow[i] * ndg ** 1.5 * (inside ? 0.25 : 0.75) * k);
}
// What the GL pass draws: quads (TL, TR, BR, BL) with a linear colour, an alpha and a mode, far to near.
export const POP_MODE = Object.freeze({ face: 0, flat: 1, glyph: 2, side: 3, ball: 4 });
const ins = (p) => Math.min(p[0], p[2]) > 0;
const centre = (pts) => vmul(pts.reduce(vadd, [0, 0, 0]), 1 / pts.length);
// Confetti (render.py Confetti): flat squares and strips, tumbling, slowing in the air, falling.
function confettiCloud(t0, origin, out, cols, { n = 110, seed = 5, speed = [0.25, 0.6], spread = 0.14, up = 0.55 } = {}) {
  const r = seq(seed * 7919 + 17), g = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());
  return Array.from({ length: n }, (_, i) => ({ t0: t0 + (i < n >> 1 ? -0.06 * Math.log(Math.max(1e-9, 1 - r())) : 0.5 * r()),
    v: vadd(vadd(vmul(out, speed[0] + (speed[1] - speed[0]) * r()), [0, up * (0.6 + 0.8 * r()), 0]), [g() * spread, g() * spread, g() * spread]),
    size: 0.006 + 0.005 * r(), col: cols[Math.floor(r() * cols.length) % cols.length], rot: 6.28 * r(), vr: -9 + 18 * r(), axis: [g(), g(), g()], life: 2 + 1.2 * r(), kind: r() < 0.5 ? 1 : 0, o: origin }));
}
function confettiAt(cloud, room, t, items) {
  for (const c of cloud) {
    const tt = t - c.t0; if (tt <= 0 || tt >= c.life) continue;
    const kk = (1 - Math.exp(-1.6 * tt)) / 1.6, pos = vadd(vadd(c.o, vmul(c.v, kk)), [0, (-0.5 * (tt - kk)) / 1.6, 0]);
    const R = rotAxis(c.axis, c.rot + c.vr * tt), cs = c.kind ? [[-1.3, -0.45, 0], [1.3, -0.45, 0], [1.3, 0.45, 0], [-1.3, 0.45, 0]] : [[-0.7, -0.7, 0], [0.7, -0.7, 0], [0.7, 0.7, 0], [-0.7, 0.7, 0]];
    const n = mv(R, [0, 0, 1]), fl = 0.45 + 0.55 * Math.abs(vdot(n, room.Lsun)), k = fl * (ins(pos) ? 0.75 : 1) * 1.25;
    items.push({ pts: cs.map((v) => vadd(pos, mv(R, vmul(v, c.size)))), col: c.col.map((x) => x * k), a: 1 - smooth01((tt - c.life + 0.4) / 0.4), mode: POP_MODE.flat });
  }
}
const confettiCols = (T) => [T.hi, [255, 255, 255], T.a, [255, 209, 234], [185, 246, 255], [255, 170, 90], [190, 150, 255]].map(lin);

// The gift box (box3d.py box_polys): body, ribbons, the lid hinged on its back edge (lidOpen) or flying (lidOff: [offset, rotation]),
// a bow; no lid at all when lidOff is false.
function boxPolys(ctr, s, yaw, lidOpen, lidOff, col, rib) {
  const R = rotY(yaw), h = s / 2, pc = lin(col), pd = pc.map((v) => v * 0.75), rc = lin(rib), polys = [];
  const P = (x, y, z) => vadd(ctr, mv(R, [x, y, z]));
  const quad = (a, b, c, d, colr, ribbon = true) => {
    const n = vnorm(vcross(vsub(d, a), vsub(b, a)));
    polys.push({ pts: [a, b, c, d], col: colr, n, kind: 'face' });
    if (ribbon) polys.push({ pts: [vlerp(a, b, 0.42), vlerp(a, b, 0.58), vlerp(d, c, 0.58), vlerp(d, c, 0.42)].map((p) => vadd(p, vmul(n, s * 0.004))), col: rc, n, kind: 'rib' });
  };
  const top = -h + 2 * h * 0.84;
  quad(P(-h, -h, -h), P(h, -h, -h), P(h, top, -h), P(-h, top, -h), pc);
  quad(P(h, -h, -h), P(h, -h, h), P(h, top, h), P(h, top, -h), pc);
  quad(P(h, -h, h), P(-h, -h, h), P(-h, top, h), P(h, top, h), pc);
  quad(P(-h, -h, h), P(-h, -h, -h), P(-h, top, -h), P(-h, top, h), pc);
  quad(P(-h, -h, h), P(h, -h, h), P(h, -h, -h), P(-h, -h, -h), pd, false);
  quad(P(-h, top, -h), P(h, top, -h), P(h, top, h), P(-h, top, h), pd.map((v) => v * 0.35), false);
  if (lidOff === false) return polys;
  const lr = h * 1.07, lt = h * 0.3;
  let Lp;
  if (!lidOff) { const hinge = P(0, top, lr), Rl = rotAxis(mv(R, [1, 0, 0]), lidOpen); Lp = (x, y, z) => vadd(hinge, mv(Rl, vsub(P(x, top + y, z), hinge))); }
  else { const lc = P(0, top, 0); Lp = (x, y, z) => vadd(vadd(lc, lidOff[0]), mv(lidOff[1], vsub(P(x, top + y, z), lc))); }
  quad(Lp(-lr, 0, -lr), Lp(lr, 0, -lr), Lp(lr, lt, -lr), Lp(-lr, lt, -lr), pc);
  quad(Lp(lr, 0, -lr), Lp(lr, 0, lr), Lp(lr, lt, lr), Lp(lr, lt, -lr), pc);
  quad(Lp(lr, 0, lr), Lp(-lr, 0, lr), Lp(-lr, lt, lr), Lp(lr, lt, lr), pc);
  quad(Lp(-lr, 0, lr), Lp(-lr, 0, -lr), Lp(-lr, lt, -lr), Lp(-lr, lt, lr), pc);
  quad(Lp(-lr, lt, -lr), Lp(lr, lt, -lr), Lp(lr, lt, lr), Lp(-lr, lt, lr), pc, false);
  quad(Lp(-lr, 0, lr), Lp(lr, 0, lr), Lp(lr, 0, -lr), Lp(-lr, 0, -lr), pd, false);
  const [a, b, c, d] = [Lp(-lr, lt, -lr), Lp(lr, lt, -lr), Lp(lr, lt, lr), Lp(-lr, lt, lr)], nt = vnorm(vcross(vsub(d, a), vsub(b, a))), off = vmul(nt, s * 0.006);
  polys.push({ pts: [vlerp(a, d, 0.42), vlerp(b, c, 0.42), vlerp(b, c, 0.58), vlerp(a, d, 0.58)].map((p) => vadd(p, off)), col: rc, n: nt, kind: 'rib' });
  polys.push({ pts: [vlerp(a, b, 0.42), vlerp(a, b, 0.58), vlerp(d, c, 0.58), vlerp(d, c, 0.42)].map((p) => vadd(p, off)), col: rc, n: nt, kind: 'rib' });
  const cen = vadd(vmul(vadd(a, c), 0.5), vmul(nt, s * 0.01)), ax1 = vnorm(vsub(b, a));
  for (const sg of [-1, 1]) {
    const tip = vadd(vadd(cen, vmul(ax1, sg * s * 0.32)), vmul(nt, s * 0.16)), sd = vmul(vcross(nt, ax1), s * 0.1), lift = vmul(nt, s * 0.02);
    polys.push({ pts: [cen, vadd(vsub(tip, vmul(sd, 0.2)), lift), tip, vadd(tip, sd)], col: rc.map((v) => v * 0.9), n: vnorm(vcross(vsub(tip, cen), sd)), kind: 'bow' });
    polys.push({ pts: [cen, vadd(vadd(tip, vmul(sd, 0.2)), lift), tip, vsub(tip, sd)], col: rc.map((v) => v * 0.8), n: vnorm(vcross(sd, vsub(tip, cen))), kind: 'bow' });
  }
  return polys;
}

// A: the gift box (render.py GiftScene) on the day's beats. In the room it hops on beats 1.. before the pop; on the pop beat (the one
// nearest 3.17 s, at least beat 2) the lid flies off, confetti bursts and the box comes out over the frame's lower edge to stand 0.2 in
// front of the fold; three balloons rise out of it (the beat nearest 4.83 s) past the screen's top into the sky; more confetti later.
// theme: { a, b, hi, deep } (0..255). -> { at(t) -> { items, boxes, spheres, glyphs }, times }.
export function giftScene(room, bt, theme) {
  const s = 0.135, out = room.out, p0 = vadd(vmul([room.rx, 0, room.rz], 0.33), [0, room.y0 + s / 2, 0]), p1 = vadd(vmul(out, 0.2), [0, 0.075, 0]);
  const kp = beatNear(bt, 3.17, 2), kb = beatNear(bt, 4.83, kp + 2), kc = beatNear(bt, 6.5, kb + 2);
  const tPop = beatAt(bt, kp), tBal = beatAt(bt, kb), hops = []; for (let k = 1; k < kp && k <= 2; k++) hops.push(beatAt(bt, k));
  const after = []; for (let k = kp + 1; beatAt(bt, k) < 10.5; k++) if (beatAt(bt, k) > tPop + 1.1) after.push(beatAt(bt, k));
  const cols = confettiCols(theme), dark = luma(lin(theme.a)) < 0.12, boxCol = dark ? theme.hi : theme.a, ribCol = dark ? [255, 255, 255] : theme.hi, glow = lin(boxCol);
  const conf = confettiCloud(tPop + 0.02, vadd(p0, [0, s * 0.5, 0]), out, cols, { n: 130, seed: 4, speed: [0.3, 0.7], up: 0.7 });
  const conf2 = confettiCloud(beatAt(bt, kc), vadd(p1, [0, 0.12, 0]), out, cols, { n: 70, seed: 9, speed: [0.2, 0.45], up: 0.8 });
  const bal = [[boxCol, -0.07, 0.04, 0, 0.06, 0], [theme.hi, 0.03, -0.05, 1.7, 0.052, 0.25], [[190, 150, 255], 0.1, 0.02, 3.1, 0.056, 0.12]]
    .map(([c, dx, dz, ph, r, d]) => ({ col: lin(c), dx, dz, ph, r, d }));
  function state(t) {
    const p = (t - tPop) / 1.1;
    if (p <= 0) { const hop = beatPulse(t, hops, 0.2); return { pos: vadd(p0, [0, 0.035 * hop, 0]), yaw: 0.12, sq: 1 - 0.08 * hop }; }
    const e = easeOutBack(p, 1.25), arc = 0.1 * Math.sin(Math.PI * Math.min(p, 1));
    const bob = 0.018 * beatPulse(t, after, 0.3) + 0.008 * Math.sin((2 * Math.PI * (t - 4.5)) / 2.2) * smooth01(p - 1);
    return { pos: vadd(vadd(p0, vmul(vsub(p1, p0), e)), [0, arc + bob, 0]), yaw: 0.12 - 0.55 * smooth01(p) + 0.12 * Math.sin((2 * Math.PI * (t - tPop)) / 4.5) * smooth01(p - 0.6), sq: 1 };
  }
  function at(t) {
    const items = [], boxes = [], spheres = [], C = room.C;
    const { pos, yaw, sq } = state(t);
    let lidOpen = (115 * Math.PI / 180) * easeOutBack((t - tPop) / 0.35, 2), lidOff = null;
    const tl = t - tPop - 0.12;
    if (tl > 0) lidOff = tl > 1.6 ? false : [vadd(vadd(vmul([0.05, 1.5, -0.18], tl), [0, -0.2 * tl * tl, 0]), [0, 0.05, 0]), rotAxis([1, 0.2, -0.6], 1.2 + 5.5 * tl)];
    const k = 1 / Math.sqrt(sq), sqz = (p) => vadd(pos, [(p[0] - pos[0]) * k, (p[1] - pos[1]) * sq, (p[2] - pos[2]) * k]);
    for (const q of boxPolys(pos, s, yaw, lidOpen, lidOff, boxCol, ribCol)) {
      const pts = q.pts.map(sqz), fc = centre(pts);
      if (q.kind !== 'bow' && vdot(q.n, vsub(C, fc)) <= 0) continue;
      items.push({ pts, col: shade(room, q.n, q.col, ins(fc), glow, 1.2), a: 1, mode: q.kind === 'face' ? POP_MODE.face : POP_MODE.flat });
    }
    boxes.push({ c: pos, axes: mT(rotY(yaw)), half: [s / 2, s / 2, s / 2], a: 1 });
    if (lidOff) boxes.push({ c: vadd(vadd(pos, lidOff[0]), [0, s * 0.4, 0]), axes: mT(lidOff[1]), half: [s * 0.55, s * 0.08, s * 0.55], a: 1 });
    confettiAt(conf, room, t, items); confettiAt(conf2, room, t, items);
    if (t > tBal) for (const b of bal) {
      const tt = t - tBal - b.d; if (tt <= 0) continue;
      const rise = 1 - Math.exp(-tt / 1.6), topP = vadd(pos, [b.dx, s * 0.5, b.dz]);
      const c = vadd(vadd(vadd(topP, [0, 0.06 + 0.62 * rise + 0.03 * tt, 0]), vmul(out, 0.06 * rise)), [0.025 * Math.sin(1.9 * tt + b.ph), 0, 0.02 * Math.cos(1.6 * tt + b.ph)]);
      const r = b.r * Math.sqrt(smooth01(tt / 0.25)); if (r <= 0.002) continue;
      const vd = vnorm(vsub(C, c)), rt = vnorm(vcross(vd, [0, 1, 0])), up = vcross(rt, vd), tint = ins(c) ? 0.8 : 1;
      items.push({ pts: [vadd(vsub(c, vmul(rt, r)), vmul(up, r)), vadd(vadd(c, vmul(rt, r)), vmul(up, r)), vsub(vadd(c, vmul(rt, r)), vmul(up, r)), vsub(vsub(c, vmul(rt, r)), vmul(up, r))],
        col: b.col.map((v) => v * tint), a: 1, mode: POP_MODE.ball });
      const knot = vsub(c, vmul(up, r * 0.98)), tail = vadd(topP, [0, 0.01, 0]), wv = vmul(rt, 0.0016);
      items.push({ pts: [vsub(knot, wv), vadd(knot, wv), vadd(tail, wv), vsub(tail, wv)], col: lin([235, 225, 245]).map((v) => v * 0.8), a: 1, mode: POP_MODE.flat });
      spheres.push({ c, r, a: 0.9 });
    }
    return { items, boxes, spheres, glyphs: [] };
  }
  return { at, times: { hops, pop: tPop, balloons: tBal, confetti: beatAt(bt, kc) }, state };
}

// B: the headline's letters (render.py LetterScene). Up to 8 letters in two rows; a longer headline keeps its last line (졸업·승진
// 축하해요! -> 축하해요!). Spaces are not letters.
export const HERO_MAX = 8;
export function heroLines(g) {
  const lines = headOf(g?.occ).map((s) => s.trim()).filter(Boolean), n = (s) => Array.from(s.replace(/\s+/g, '')).length;
  return lines.reduce((a, s) => a + n(s), 0) > HERO_MAX ? [lines[lines.length - 1]] : lines;
}
// glyphs: per character { rect: [u0, v0, u1, v1] in the atlas, w, h: the cell, adv: the advance (all in font sizes) }. Each letter
// starts on the panel where the card's headline would be, jumps out on its beat (beats 1, 2, ...) with a turn that shows its sides and
// lands in front of the fold, 22 % bigger; after landing it bobs on the beats and sways. layers: the extrusion's slices.
export function lettersScene(room, bt, theme, lines, glyphs, { layers = 14 } = {}) {
  const pg = room.panel, out = room.out, glow = lin(theme.a), side = lin([255, 150, 60]), grow = 1.22, maxW = 0.46;
  const rows = lines.length > 1 ? [{ v: 0.398, y: 0.5, em: 0.1 }, { v: 0.562, y: 0.335, em: 0.09 }] : [{ v: 0.48, y: 0.42, em: 0.11 }];
  const L = [];
  lines.slice(0, rows.length).forEach((text, r) => {
    const chars = Array.from(text).filter((ch) => ch.trim() && glyphs[ch]), adv = chars.map((ch) => glyphs[ch].adv), tot = adv.reduce((a, b) => a + b, 0);
    const em = Math.min(rows[r].em, maxW / (grow * Math.max(tot, 1e-6)), (pg.half[0] * 2 * 0.92) / Math.max(tot, 1e-6));
    let x = -tot / 2;
    chars.forEach((ch, i) => {
      const xc = (x + adv[i] / 2) * em; x += adv[i];
      const g = glyphs[ch], start = vadd(vadd(vadd(pg.ctr, vmul(pg.n, 0.05)), vmul(pg.rt, xc)), [0, (0.5 - rows[r].v) * 2 * pg.half[1], 0]);
      const lx = xc * grow, land = vadd(vadd(vadd(vmul(out, 0.12), vmul(pg.rt, lx)), [0, rows[r].y, 0]), vmul(out, 0.025 * Math.max(-1, 1 - Math.abs(lx) / 0.15)));
      L.push({ ch, g, w: g.w * em, h: g.h * em, em, start, land });
    });
  });
  L.forEach((l, i) => { l.k = i; l.t0 = beatAt(bt, 1 + i); });
  const beats = []; for (let k = 1; beatAt(bt, k) < 10.5; k++) beats.push(beatAt(bt, k));
  const cols = confettiCols(theme), from = vadd(vadd(pg.ctr, vmul(pg.n, 0.08)), [0, -0.15, 0]);
  const kc = beatNear(bt, 6.5, L.length + 1), kd = beatNear(bt, 8.17, kc + 2);
  const conf = confettiCloud(beatAt(bt, kc), from, out, cols, { n: 120, seed: 11, speed: [0.3, 0.65], up: 0.7 });
  const conf2 = confettiCloud(beatAt(bt, kd), from, out, cols, { n: 60, seed: 12, speed: [0.2, 0.5], up: 0.8 });
  function letterAt(l, t) {
    const p = (t - l.t0) / 0.62;
    if (p <= 0) { const wig = t > bt.t0 ? beatPulse(t, [l.t0 - bt.beat], 0.2) : 0; return { pos: vadd(l.start, [0, 0.012 * wig, 0]), yaw: 0, k: 1, p: 0 }; }
    const e = easeOutCubic(p), arc = 0.07 * Math.sin(Math.PI * Math.min(p, 1)), settle = smooth01(p - 1);
    const spin = 2 * Math.PI * easeOutCubic(Math.min(p, 1)) * (l.k % 2 ? -1 : 1);
    const bob = 0.012 * beatPulse(t, beats, 0.3) * settle + 0.006 * Math.sin(2 * Math.PI * (t * 0.5 + l.k * 0.17)) * settle;
    const sway = 0.22 * Math.sin(2 * Math.PI * (t * 0.35 + l.k * 0.21)) * settle;
    return { pos: vadd(vadd(l.start, vmul(vsub(l.land, l.start), e)), [0, arc + bob, 0]), yaw: spin + sway, k: 1 + (grow - 1) * smooth01(p), p };
  }
  function at(t) {
    const items = [], glyphsOut = [], C = room.C;
    for (const l of L) {
      const { pos, yaw, k } = letterAt(l, t), R = rotY(yaw), rt = mv(R, pg.rt), up = mv(R, pg.up), n = mv(R, pg.n);
      const w = l.w * k, h = l.h * k, depth = 0.26 * l.em * k, inside = ins(pos);
      const quad = (c) => [vadd(vsub(c, vmul(rt, w / 2)), vmul(up, h / 2)), vadd(vadd(c, vmul(rt, w / 2)), vmul(up, h / 2)), vsub(vadd(c, vmul(rt, w / 2)), vmul(up, h / 2)), vsub(vsub(c, vmul(rt, w / 2)), vmul(up, h / 2))];
      const facing = vdot(n, vsub(C, pos)) > 0, sc = shade(room, vnorm(vadd(vadd(vmul(up, 0.6), vmul(rt, 0.3)), vmul(n, 0.1))), side, inside, glow, 1).map((v) => v * 0.85);
      for (let j = 0; j < layers; j++) { const f = layers > 1 ? j / (layers - 1) : 1; items.push({ pts: quad(vadd(pos, vmul(n, -depth * f))), col: sc.map((v) => v * (0.75 + 0.25 * f)), a: 1, mode: POP_MODE.side, rect: l.g.rect }); }
      if (facing) items.push({ pts: quad(vadd(pos, vmul(n, 0.0008))), col: shade(room, n, [1, 1, 1], inside, glow, 0.8).map((v) => v * 1.25), a: 1, mode: POP_MODE.glyph, rect: l.g.rect });
      else items.push({ pts: quad(vsub(pos, vmul(n, depth + 0.0008))), col: sc, a: 1, mode: POP_MODE.side, rect: l.g.rect });
      glyphsOut.push({ c: vsub(pos, vmul(n, depth / 2)), rt, hw: w / 2, hh: h / 2, rect: l.g.rect, a: 1 });
    }
    confettiAt(conf, room, t, items); confettiAt(conf2, room, t, items);
    return { items, boxes: [], spheres: [], glyphs: glyphsOut };
  }
  return { at, letters: L, times: { letters: L.map((l) => l.t0), confetti: beatAt(bt, kc) }, letterAt };
}
// Far to near from the camera (the painter's order the GL pass draws in).
export function sortFarToNear(items, C) { for (const it of items) { const c = centre(it.pts); it.d = Math.hypot(c[0] - C[0], c[1] - C[1], c[2] - C[2]); } return items.sort((a, b) => b.d - a.d); }

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
