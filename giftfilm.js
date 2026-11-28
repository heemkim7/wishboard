// The drawn 15-second 축하 영상 (browser only, a 2D canvas, no three.js): a night fly-through down a neon street canyon to the gift
// board at its end, then fireworks, confetti and a cheering crowd of the plaza's mice, cats and bears. It is what the recipient page
// plays when no recorded video is stored (or the browser cannot play the stored one), the sender's instant preview, and what
// "영상 저장" records on a phone that has no stored video. Every frame is a pure function of time (draw(t)), so it can be replayed,
// sought and recorded the same way each time; the scene is seeded by the board id.
// recordCanvas is shared with the plaza's 3D recording (gift.js): MP4 where MediaRecorder makes it, WebM otherwise.
import { OCCASIONS, pickRecordType, isMe, toLine, filmMark } from './giftrules.js';
import { paintGift, seeded, GIFT_SANS, fitSize } from './giftart.js?v=202611281741';

export const FILM_MS = 15000;
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const clamp01 = (u) => Math.max(0, Math.min(1, u));
const NEON = ['#ff3d9a', '#3fe6ff', '#ffcf5a', '#39f58a', '#b84dff', '#ff7a3d', '#ffffff'];
const FUR = [['#d9d3e6', '#ffb3c7'], ['#f4b25f', '#ffd9a8'], ['#9a6a47', '#d8b08c']]; // mouse, cat, bear: fur, inner ear
const HOODIE = ['#ff4fa3', '#3fe6ff', '#ffcf5a', '#39f58a', '#b84dff', '#ff7a3d', '#ffffff', '#5b8cff'];

// The street: buildings on both sides of a 9 m half-width street from z 10 to the end building at Z_END, which carries the board.
const HALF = 9, Z_END = 300, BOARD = { w: 16, h: 9, y: 19 };
function buildScene(seed) {
  const r = seeded('film:' + seed), side = [];
  for (const s of [-1, 1]) {
    let z = 8 + r() * 6;
    while (z < Z_END - 24) {
      const d = 9 + r() * 14, h = 22 + r() * 70, w = 8 + r() * 10;
      const boards = [];
      const nb = r() < 0.75 ? 1 + (r() < 0.4 ? 1 : 0) : 0;
      for (let i = 0; i < nb; i++) { const bz = z + 1 + r() * Math.max(1, d - 7), bh = 4 + r() * 7, by = 5 + r() * Math.max(2, h - bh - 8); boards.push({ z0: bz, z1: bz + 3.5 + r() * 3.5, y0: by, y1: by + bh, c: NEON[(r() * NEON.length) | 0], c2: NEON[(r() * NEON.length) | 0], ph: r() * 6 }); }
      const win = []; for (let i = 0; i < 40; i++) win.push(r() < 0.42);
      side.push({ s, z0: z, z1: z + d, h, w, tint: 0.07 + r() * 0.06, boards, win });
      z += d + 1.5 + r() * 3;
    }
  }
  side.sort((a, b) => b.z0 - a.z0); // far first
  const endWin = []; for (let x = -38; x <= 38; x += 3.2) for (let y = 3; y < 88; y += 3.6) { if (Math.abs(x) < 11.5 && y > 12 && y < 27) continue; if (r() < 0.33) endWin.push({ x, y, a: 0.45 + r() * 0.5 }); }
  const stars = Array.from({ length: 110 }, () => ({ x: r(), y: r() * 0.5, s: 0.6 + r() * 1.6, p: r() * 6 }));
  const sky = Array.from({ length: 26 }, () => ({ x: r(), w: 0.03 + r() * 0.07, h: 0.04 + r() * 0.12, c: r() }));
  const bursts = [];
  const times = [8.6, 9.3, 10.0, 10.6, 11.3, 11.9, 12.6, 13.2, 13.9, 14.4];
  for (const t0 of times) bursts.push({ t0, u: (r() - 0.5) * 1.5, v: -0.35 - r() * 0.7, c: NEON[(r() * 6) | 0], c2: NEON[(r() * 6) | 0], n: 46 + ((r() * 20) | 0), sp: 0.16 + r() * 0.1, rot: r() * 6 });
  const confetti = Array.from({ length: 90 }, () => ({ x: r(), t0: 9.4 + r() * 4.5, sp: 0.18 + r() * 0.22, sw: 0.02 + r() * 0.04, ph: r() * 6, rs: 2 + r() * 6, c: NEON[(r() * 6) | 0], w: 0.6 + r() * 0.8 }));
  const crowd = Array.from({ length: 7 }, (_, i) => ({ x: (i + 0.5) / 7 + (r() - 0.5) * 0.05, row: i % 2, sp: (i % 3) % 3, ph: r() * 6, f: 2.2 + r() * 1.6, hood: HOODIE[(r() * HOODIE.length) | 0], arm: r() < 0.5 }));
  return { side, stars, sky, bursts, confetti, crowd, endWin };
}

// The camera: forward down the street (ease in and out over 0..9.2 s), rising from street level to the board's height, then a slow
// drift while the party runs. Returns { z, y, x }.
function cam(t, W, f) {
  const zEnd = Z_END - f * BOARD.w / (0.86 * W);
  const u = ease(clamp01(t / 9.2));
  return { z: -6 + (zEnd + 6) * u + Math.max(0, t - 9.2) * 0.35, y: 2.2 + (BOARD.y - 2.2) * ease(clamp01((t - 1.2) / 8)), x: Math.sin(t * 0.6) * 0.6 * (1 - u) };
}

export function createFilm(canvas, gift, opts = {}) {
  const g = canvas.getContext('2d'), scene = buildScene(gift?.id || gift?.to || 'gift');
  const board = document.createElement('canvas'); board.width = 1024; board.height = 576;
  paintGift(board, gift);
  const O = OCCASIONS[gift?.occ] || OCCASIONS.bday;
  let raf = 0, t0 = 0, playing = false, ended = false;
  const ends = new Set(); if (opts.onEnd) ends.add(opts.onEnd);

  function draw(t) {
    const W = canvas.width, H = canvas.height, f = H * 0.92, hy = H * 0.4, cx = W / 2;
    const C = cam(t, W, f);
    const P = (x, y, z) => { const dz = Math.max(0.5, z - C.z); return [cx + f * (x - C.x) / dz, hy - f * (y - C.y) / dz, f / dz]; };
    // Sky, stars, the far skyline.
    // 2026-11-28 (A. LED 전광판): the night is black, no purple in it; the colour is the screens'.
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#000000'); sky.addColorStop(0.42, '#08090c'); sky.addColorStop(0.62, '#121317'); sky.addColorStop(1, '#000000');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    for (const s of scene.stars) { g.globalAlpha = 0.35 + 0.35 * Math.sin(t * 2 + s.p); g.fillStyle = '#fff'; g.fillRect(s.x * W, s.y * H, s.s, s.s); }
    g.globalAlpha = 1;
    const sk = hy - H * 0.02;
    for (const b of scene.sky) { g.fillStyle = `rgb(${14 + b.c * 10},${14 + b.c * 10},${16 + b.c * 12})`; g.fillRect(b.x * W - b.w * W / 2, sk - b.h * H, b.w * W, b.h * H + 2); }
    // The street floor and its lane lines, wet with the neon.
    const fl = g.createLinearGradient(0, hy, 0, H); fl.addColorStop(0, '#141416'); fl.addColorStop(1, '#030303'); g.fillStyle = fl; g.fillRect(0, hy, W, H - hy);
    g.strokeStyle = 'rgba(255,207,90,0.5)'; g.lineWidth = 2;
    for (let z = Math.ceil((C.z + 2) / 8) * 8; z < Z_END; z += 8) { const [x0, y0] = P(0, 0, z), [x1, y1] = P(0, 0, z + 3.5); if (y0 > H) continue; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
    // The end building and its board.
    { const [x0, y0] = P(-40, 92, Z_END), [x1, y1] = P(40, 0, Z_END);
      g.fillStyle = '#0e0e10'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.fillStyle = '#ffd68c'; for (const w of scene.endWin) { const p = P(w.x, w.y, Z_END - 0.05), s = Math.max(1, p[2] * 0.8); g.globalAlpha = w.a * 0.8; g.fillRect(p[0] - s / 2, p[1] - s * 1.3, s, s * 1.3); } g.globalAlpha = 1;
      const [bx0, by0, sc] = P(-BOARD.w / 2, BOARD.y + BOARD.h / 2, Z_END - 0.2), [bx1, by1] = P(BOARD.w / 2, BOARD.y - BOARD.h / 2, Z_END - 0.2);
      for (let i = 0; i < 6; i++) { const [px0, py0] = P(-34 + i * 11.5, 60, Z_END - 0.1), [px1, py1] = P(-27 + i * 11.5, 40, Z_END - 0.1); if (i === 2 || i === 3) continue; g.fillStyle = NEON[i % NEON.length]; g.globalAlpha = 0.55 + 0.25 * Math.sin(t * 3 + i); g.fillRect(px0, py0, px1 - px0, py1 - py0); }
      g.globalAlpha = 1;
      const pad = sc * 0.6;
      g.fillStyle = '#000000'; g.fillRect(bx0 - pad, by0 - pad, bx1 - bx0 + pad * 2, by1 - by0 + pad * 2); // the board's black frame (no glow: A. LED 전광판, 2026-11-28)
      g.drawImage(board, bx0, by0, bx1 - bx0, by1 - by0);
    }
    // The side buildings, far to near: the face along the street (a trapezoid), its windows and neon boards, then its front.
    for (const b of scene.side) {
      if (b.z1 < C.z + 0.6) continue;
      const z0 = Math.max(b.z0, C.z + 0.6), xs = b.s * HALF, xo = b.s * (HALF + b.w);
      const a = P(xs, 0, z0), bb = P(xs, b.h, z0), c = P(xs, b.h, b.z1), d = P(xs, 0, b.z1);
      const shade = Math.round(255 * b.tint);
      g.fillStyle = `rgb(${shade + 4},${shade + 4},${shade + 8})`;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(bb[0], bb[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath(); g.fill();
      // windows: 4 columns along the face, a row every 3.6 m
      g.fillStyle = 'rgba(255,214,140,0.75)';
      let k = 0;
      for (let i = 0; i < 4; i++) {
        const wz = b.z0 + (i + 0.5) * (b.z1 - b.z0) / 4; if (wz < C.z + 0.8) continue;
        for (let y = 3; y < b.h - 2; y += 3.6) { if (!b.win[(k++) % b.win.length]) continue; const p = P(xs, y, wz), s = Math.max(1, p[2] * 0.7); g.fillRect(p[0] - s * 0.5, p[1] - s, s, s * 1.2); }
      }
      for (const n of b.boards) {
        if (n.z1 < C.z + 0.8) continue;
        const q0 = P(xs * 0.995, n.y0, Math.max(n.z0, C.z + 0.8)), q1 = P(xs * 0.995, n.y1, Math.max(n.z0, C.z + 0.8)), q2 = P(xs * 0.995, n.y1, n.z1), q3 = P(xs * 0.995, n.y0, n.z1);
        const gr = g.createLinearGradient(q0[0], q1[1], q2[0], q3[1]); gr.addColorStop(0, n.c); gr.addColorStop(1, n.c2);
        g.globalAlpha = 0.72 + 0.28 * Math.sin(t * 3.1 + n.ph); g.fillStyle = gr;
        g.beginPath(); g.moveTo(q0[0], q0[1]); g.lineTo(q1[0], q1[1]); g.lineTo(q2[0], q2[1]); g.lineTo(q3[0], q3[1]); g.closePath(); g.fill();
        g.globalAlpha = 1;
      }
      if (b.z0 >= C.z + 0.6) { const f0 = P(xs, b.h, b.z0), f1 = P(xo, 0, b.z0); g.fillStyle = `rgb(${shade},${shade},${shade + 4})`; g.fillRect(Math.min(f0[0], f1[0]), f0[1], Math.abs(f1[0] - f0[0]), f1[1] - f0[1]); }
    }
    // The party: fireworks (additive), confetti, the crowd.
    const [bx0, by0] = P(-BOARD.w / 2, BOARD.y + BOARD.h / 2, Z_END), [bx1, by1] = P(BOARD.w / 2, BOARD.y - BOARD.h / 2, Z_END);
    const bcx = (bx0 + bx1) / 2, bcy = (by0 + by1) / 2, bw = bx1 - bx0;
    g.save(); g.globalCompositeOperation = 'lighter';
    for (const s of scene.bursts) {
      const age = t - s.t0; if (age < 0 || age > 2.2) continue;
      const ox = bcx + s.u * bw * 0.62, oy = bcy + s.v * bw * 0.7, life = 1 - age / 2.2, R = W * s.sp, glide = (1 - Math.exp(-2.4 * age)) / 2.4;
      if (age < 0.18) { g.fillStyle = s.c; g.globalAlpha = 1 - age / 0.18; g.beginPath(); g.arc(ox, oy, W * 0.05 * (age / 0.18 + 0.3), 0, Math.PI * 2); g.fill(); }
      for (let i = 0; i < s.n; i++) {
        const an = s.rot + (i / s.n) * Math.PI * 2, sp = R * (0.75 + 0.25 * Math.sin(i * 7.1)) * 2.4;
        const x = ox + Math.cos(an) * sp * glide, y = oy + Math.sin(an) * sp * glide + H * 0.05 * age * age;
        g.globalAlpha = life * life; g.fillStyle = i % 4 ? s.c : s.c2; g.fillRect(x - 2.2, y - 2.2, 4.4, 4.4);
      }
    }
    g.restore(); g.globalAlpha = 1;
    for (const p of scene.confetti) {
      const age = t - p.t0; if (age < 0) continue;
      const y = -20 + age * p.sp * H, x = p.x * W + Math.sin(age * 3 + p.ph) * p.sw * W; if (y > H) continue;
      g.save(); g.translate(x, y); g.rotate(age * p.rs); g.fillStyle = p.c; g.fillRect(-6 * p.w, -3, 12 * p.w, 6); g.restore();
    }
    drawCrowd(g, scene.crowd, t, W, H);
    // Words: the opening line, then the day's words; the watermark on the free film (giftrules.js filmMark: not on a board whose
    // 축하 영상 세트 or 메인 타워 주인공 order is published, its view's clean).
    const title = clamp01((t - 0.3) / 0.6) * (1 - clamp01((t - 3.6) / 0.6));
    if (title > 0) {
      g.globalAlpha = title; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffb020';
      g.font = `700 ${Math.round(W * 0.042)}px ${GIFT_SANS}`; g.fillText('오늘 밤, 뉴욕 타임스퀘어', W / 2, H * 0.12);
      const line = (String(gift?.to || '').trim() || '당신') + (isMe(gift) ? '님의 전광판이 켜졌어요' : '님을 위한 전광판이 켜졌어요'); // 내 전광판: no "for"
      g.fillStyle = '#ffffff'; g.font = `800 ${fitSize(g, line, W * 0.86, W * 0.062, W * 0.04, 800)}px ${GIFT_SANS}`; g.fillText(line, W / 2, H * 0.17);
      g.globalAlpha = 1;
    }
    const outro = clamp01((t - 10.2) / 0.8);
    if (outro > 0) {
      g.globalAlpha = outro; g.textAlign = 'center'; g.textBaseline = 'middle';
      const big = isMe(gift) ? toLine(gift) : (String(gift?.to || '').trim() || '당신') + '님, ' + O.head;
      g.font = `900 ${fitSize(g, big, W * 0.9, W * 0.075, W * 0.045, 900)}px ${GIFT_SANS}`;
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, H * 0.565, W, H * 0.13); // a flat black band under the words (no outline, no glow)
      g.fillStyle = '#ffb020'; g.fillText(big, W / 2, H * 0.62);
      const from = isMe(gift) ? '' : String(gift?.from || '').trim();
      if (from) { g.font = `700 ${Math.round(W * 0.042)}px ${GIFT_SANS}`; g.fillStyle = '#ffffff'; g.fillText('From. ' + from, W / 2, H * 0.67); }
      g.globalAlpha = 1;
    }
    if (opts.watermark !== false) { // the line that it is a virtual plaza stays on a clean film; only the free mark goes
      g.textBaseline = 'alphabetic';
      if (filmMark(gift)) { g.textAlign = 'right'; g.font = `800 ${Math.round(W * 0.03)}px ${GIFT_SANS}`; g.fillStyle = 'rgba(255,255,255,0.72)'; g.fillText('WISH BOARD', W - W * 0.04, H - H * 0.022); }
      g.textAlign = 'left'; g.font = `600 ${Math.round(W * 0.022)}px ${GIFT_SANS}`; g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillText('가상 광장 · 실제 타임스퀘어와 무관', W * 0.04, H - H * 0.022);
    }
    // Fade in and the last half second's fade to black, so a loop or the end card does not jump.
    const fade = Math.max(1 - clamp01(t / 0.5), clamp01((t - 14.5) / 0.5) * 0.85);
    if (fade > 0) { g.fillStyle = `rgba(0,0,0,${fade})`; g.fillRect(0, 0, W, H); }
  }
  function frame(now) {
    if (!playing) return;
    const t = (now - t0) / 1000;
    draw(Math.min(t, FILM_MS / 1000));
    if (t >= FILM_MS / 1000) { playing = false; ended = true; draw(12.6); for (const f of ends) { try { f(); } catch { /* the page's */ } } return; }
    raf = requestAnimationFrame(frame);
  }
  return {
    canvas, draw,
    play() { cancelAnimationFrame(raf); ended = false; playing = true; t0 = performance.now(); raf = requestAnimationFrame(frame); },
    stop() { playing = false; cancelAnimationFrame(raf); },
    still(t = 12.4) { this.stop(); draw(t); },
    onEnd(fn) { ends.add(fn); return () => ends.delete(fn); },
    get playing() { return playing; }, get ended() { return ended; },
  };
}

// The crowd along the bottom: hooded mice, cats and bears that bob and throw their arms up (front row bigger, in front).
function drawCrowd(g, crowd, t, W, H) {
  const rise = ease(clamp01((t - 8.2) / 1.2));
  if (rise <= 0) return;
  for (const row of [1, 0]) for (const m of crowd) {
    if (m.row !== row) continue;
    const s = W * (row ? 0.105 : 0.13), x = m.x * W, base = H + s * 0.15 - rise * (row ? s * 2.05 : s * 1.75);
    const hop = Math.abs(Math.sin(t * m.f + m.ph)) * s * 0.28, y = base - hop;
    const [fur, inner] = FUR[m.sp];
    // arms (behind the body): up and waving
    const up = Math.sin(t * m.f * 1.3 + m.ph) * 0.35;
    g.strokeStyle = m.hood; g.lineCap = 'round'; g.lineWidth = s * 0.2;
    for (const side of [-1, 1]) { const ax = x + side * s * 0.42, ay = y + s * 0.25; g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + side * s * (0.35 + (m.arm ? up : -up) * side * 0.2), ay - s * (0.75 + up * side)); g.stroke(); g.fillStyle = fur; g.beginPath(); g.arc(ax + side * s * (0.35 + (m.arm ? up : -up) * side * 0.2), ay - s * (0.75 + up * side), s * 0.13, 0, Math.PI * 2); g.fill(); }
    // body (the hoodie) and head
    g.fillStyle = m.hood; g.beginPath(); g.ellipse(x, y + s * 0.55, s * 0.52, s * 0.62, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x - s * 0.06, y + s * 0.15, s * 0.12, s * 0.5);
    // ears by species
    g.fillStyle = fur;
    if (m.sp === 0) { for (const e of [-1, 1]) { g.beginPath(); g.arc(x + e * s * 0.38, y - s * 0.32, s * 0.27, 0, Math.PI * 2); g.fill(); g.fillStyle = inner; g.beginPath(); g.arc(x + e * s * 0.38, y - s * 0.32, s * 0.15, 0, Math.PI * 2); g.fill(); g.fillStyle = fur; } }
    else if (m.sp === 1) { for (const e of [-1, 1]) { g.beginPath(); g.moveTo(x + e * s * 0.12, y - s * 0.34); g.lineTo(x + e * s * 0.42, y - s * 0.62); g.lineTo(x + e * s * 0.42, y - s * 0.12); g.closePath(); g.fill(); } }
    else { for (const e of [-1, 1]) { g.beginPath(); g.arc(x + e * s * 0.33, y - s * 0.3, s * 0.16, 0, Math.PI * 2); g.fill(); } }
    g.beginPath(); g.arc(x, y - s * 0.02, s * 0.42, 0, Math.PI * 2); g.fill();
    // face: eyes (happy arcs), cheeks, a muzzle
    g.strokeStyle = '#1a1020'; g.lineWidth = s * 0.06;
    for (const e of [-1, 1]) { g.beginPath(); g.arc(x + e * s * 0.15, y - s * 0.04, s * 0.07, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
    g.fillStyle = 'rgba(255,120,150,0.55)'; for (const e of [-1, 1]) { g.beginPath(); g.arc(x + e * s * 0.25, y + s * 0.08, s * 0.07, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#2a1820'; g.beginPath(); g.arc(x, y + s * 0.1, s * 0.05, 0, Math.PI * 2); g.fill();
  }
}

// ---- recording -----------------------------------------------------------------------------------------------------------
export function recorderType() {
  try { return typeof MediaRecorder === 'undefined' ? '' : pickRecordType((t) => MediaRecorder.isTypeSupported(t)); } catch { return ''; }
}
export const canRecord = () => { try { return typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream; } catch { return false; } };
// Records `canvas` (something else keeps drawing it) for ms. -> Blob (type without codecs) or null when aborted or impossible.
export async function recordCanvas(canvas, ms, { signal, fps = 30, bitrate = 1800000 } = {}) {
  if (!canvas?.captureStream || typeof MediaRecorder === 'undefined') return null;
  const type = recorderType();
  let stream = null;
  try {
    stream = canvas.captureStream(fps);
    const rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: bitrate });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    const stopped = new Promise((r) => { rec.onstop = r; rec.onerror = r; });
    rec.start(1000);
    await new Promise((r) => { const t = setTimeout(r, ms); signal?.addEventListener?.('abort', () => { clearTimeout(t); r(); }, { once: true }); });
    try { rec.stop(); } catch { /* already stopped */ }
    await stopped;
    if (signal?.aborted || !chunks.length) return null;
    return new Blob(chunks, { type: String(rec.mimeType || type || 'video/webm').split(';')[0] });
  } catch { return null; }
  finally { if (stream) for (const tr of stream.getTracks()) tr.stop(); }
}
export const fileName = (gift, blob) => 'wishboard-' + (gift?.id || 'gift') + (String(blob?.type || '').includes('mp4') ? '.mp4' : '.webm');
// Saves a Blob as a file: the share sheet with the file where the phone takes it (so it can go straight to a story), else a download.
export async function saveBlob(blob, name) {
  try {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return 'shared'; }
  } catch (e) { if (e?.name === 'AbortError') return 'cancel'; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  return 'saved';
}
