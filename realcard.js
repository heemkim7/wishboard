// 실사 축하 영상: the gift card that plays on the plate's green screen, a canvas-2D port of tools/plates/card.py (same layouts and
// timeline), in the gift's own theme and words. Browser only. draw(t) paints the card at time t (seconds from the clip's start) into
// its canvas, which realvideo.js uploads as the screen's texture each frame. Words are only ever drawn with fillText; no emoji (the
// occasion badge draws its own small icon).
//
// Timeline (flash = 1.5 s): standby (dark, a breathing glow in the theme colours, twinkles), charge-up from 0.95 s, the white flash,
// then the card: badge, To., the headline pop, the line, From., the WISH BOARD footer, a confetti burst, falling confetti, twinkles
// and sheen passes, settling to a calm card by the end.
import { layoutFor, fitLines, cardWords } from './realrules.js?v=202611280944';
import { themeOf, seeded, GIFT_SANS } from './giftart.js?v=202611280944';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOutBack = (t, s = 1.70158) => { const u = clamp01(t) - 1; return u * u * ((s + 1) * u + s) + 1; };
const easeOutCubic = (t) => 1 - (1 - clamp01(t)) ** 3;
const hex = (h) => { const n = parseInt(String(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const font = (size, weight = 800) => `${weight} ${Math.max(4, Math.round(size))}px ${GIFT_SANS}`;
const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };

function rrect(g, x, y, w, h, r) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath(); g.moveTo(x + k, y); g.arcTo(x + w, y, x + w, y + h, k); g.arcTo(x + w, y + h, x, y + h, k); g.arcTo(x, y + h, x, y, k); g.arcTo(x, y, x + w, y, k); g.closePath();
}

// A text line as a sprite: a soft drop shadow, a coloured glow, an optional stroke, then the fill. body: the letters alone (white), for
// the sheen. tracking: extra space between letters, a fraction of the size.
function textSprite(text, size, o = {}) {
  const probe = canvasOf(1, 1).getContext('2d'); probe.font = font(size, o.weight);
  const chars = Array.from(text), tr = (o.tracking || 0) * size;
  const widths = tr ? chars.map((c) => probe.measureText(c).width) : null;
  const tw = tr ? widths.reduce((a, b) => a + b, 0) + tr * (chars.length - 1) : probe.measureText(text).width;
  const pad = Math.ceil(Math.max(o.glow?.r || 0, o.shadow?.r || 0) * 3 + Math.abs(o.shadow?.dy || 0) + (o.stroke || 0) + 8);
  const W = Math.ceil(tw) + 2 * pad, H = Math.ceil(size * 1.45) + 2 * pad, cy = H / 2;
  const c = canvasOf(W, H), g = c.getContext('2d'), body = canvasOf(W, H), b = body.getContext('2d');
  const put = (ctx, how) => {
    ctx.font = font(size, o.weight); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    if (!tr) { how(ctx, text, pad); return; }
    let x = pad; chars.forEach((ch, i) => { how(ctx, ch, x); x += widths[i] + tr; });
  };
  const fill = (ctx, s, x) => ctx.fillText(s, x, cy);
  if (o.shadow) { g.save(); g.shadowColor = rgba(o.shadow.c, o.shadow.a); g.shadowBlur = o.shadow.r * 2; g.shadowOffsetY = o.shadow.dy || 0; g.fillStyle = rgba(o.fill); put(g, fill); g.restore(); }
  if (o.glow) { g.save(); g.shadowColor = rgba(o.glow.c, o.glow.a); g.shadowBlur = o.glow.r * 2; g.fillStyle = rgba(o.fill); put(g, fill); g.restore(); }
  if (o.stroke) { g.save(); g.lineJoin = 'round'; g.lineWidth = o.stroke * 2; g.strokeStyle = rgba(o.strokeFill); put(g, (ctx, s, x) => ctx.strokeText(s, x, cy)); g.restore(); }
  g.fillStyle = rgba(o.fill); put(g, fill);
  b.fillStyle = '#fff'; put(b, fill);
  return { c, body, w: W, h: H };
}

// The occasion's icon (no emoji font needed): a cake for a birthday, a star for a pass, a cheer or 졸업·승진, a four-point sparkle for a
// board of one's own (내 전광판), a heart for the rest (사랑 among them).
function icon(g, key, x, y, s, col) {
  g.save(); g.fillStyle = col; g.strokeStyle = col; g.translate(x, y);
  if (key === 'me') {
    g.beginPath();
    for (let i = 0; i < 8; i++) { const r = i % 2 ? s * 0.14 : s * 0.55, a = -Math.PI / 2 + (i * Math.PI) / 4; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath(); g.fill();
  } else if (key === 'bday') {
    rrect(g, -s * 0.5, -s * 0.05, s, s * 0.45, s * 0.08); g.fill();
    rrect(g, -s * 0.36, -s * 0.3, s * 0.72, s * 0.3, s * 0.06); g.fill();
    g.fillRect(-s * 0.04, -s * 0.52, s * 0.08, s * 0.22);
    g.beginPath(); g.ellipse(0, -s * 0.6, s * 0.07, s * 0.1, 0, 0, Math.PI * 2); g.fill();
  } else if (key === 'pass' || key === 'cheer' || key === 'grad') {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.22 : s * 0.52, a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath(); g.fill();
  } else {
    g.beginPath(); g.moveTo(0, s * 0.45);
    g.bezierCurveTo(-s * 0.7, -s * 0.05, -s * 0.35, -s * 0.6, 0, -s * 0.22);
    g.bezierCurveTo(s * 0.35, -s * 0.6, s * 0.7, -s * 0.05, 0, s * 0.45); g.fill();
  }
  g.restore();
}
// The occasion pill: gold, deep ink, the icon and the name, a soft gold glow.
function badgeSprite(size, words, T) {
  const probe = canvasOf(1, 1).getContext('2d'); probe.font = font(size);
  const tw = probe.measureText(words.occ).width, ew = size * 0.95, gap = size * 0.3, pw = size * 0.85;
  const h = Math.round(size * 1.62), w = Math.round(ew + gap + tw + 2 * pw), pad = Math.round(size * 0.6);
  const c = canvasOf(w + 2 * pad, h + 2 * pad), g = c.getContext('2d');
  g.save(); g.shadowColor = rgba(T.hi, 0.55); g.shadowBlur = size * 0.5; g.fillStyle = rgba(T.hi); rrect(g, pad, pad, w, h, h / 2); g.fill(); g.restore();
  g.fillStyle = 'rgba(255,255,255,0.18)'; rrect(g, pad + 3, pad + 3, w - 6, h * 0.5 - 3, h / 2); g.fill();
  const cy = pad + h / 2;
  icon(g, words.key, pad + pw + ew / 2, cy, size * 0.95, rgba(T.deep));
  g.fillStyle = rgba(T.deep); g.font = font(size); g.textBaseline = 'middle'; g.fillText(words.occ, pad + pw + ew + gap, cy);
  return { c, w: c.width, h: c.height };
}
// A 4-point twinkle: a bright core, two thin rays and a halo, white on transparent (tinted by colour), drawn additively.
function sparkSprite(r, col) {
  const n = r * 2 + 1, c = canvasOf(n, n), g = c.getContext('2d'), img = g.createImageData(n, n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i - r) / r, y = (j - r) / r;
    const core = Math.exp(-(x * x + y * y) / 0.012), halo = Math.exp(-(x * x + y * y) / 0.08) * 0.35;
    const rays = Math.exp(-(y * y) / 0.0012) * clamp01(1 - Math.abs(x)) ** 2 + Math.exp(-(x * x) / 0.0012) * clamp01(1 - Math.abs(y)) ** 2;
    const s = Math.min(1, core + rays * 0.9 + halo), k = (j * n + i) * 4;
    img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = Math.round(s * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}

// gift: { id, to, from, occ, msg, th }. opts: { w, h, layout, phone (a phone screen: the card inside a dark app margin), flash, hero
// (false: no headline: the corner box's 3D letters are it), at ({ line, from }: when they come in: the music's beats on the corner box) }.
export function createRealCard(gift, { w, h, layout = '', phone = false, flash = 1.5, hero = true, at = null } = {}) {
  const canvas = canvasOf(w, h), out = canvas.getContext('2d');
  // A phone screen: the card in an inner box with rounded corners, a dark margin round it (scene.py phone_dressing).
  const ins = phone ? Math.round(0.045 * w) : 0, W = w - 2 * ins, H = h - 2 * ins;
  const inner = phone ? canvasOf(W, H) : canvas, g = inner.getContext('2d');
  const T0 = themeOf(gift), T = { a: hex(T0.a), b: hex(T0.b), ink: hex(T0.ink), hi: hex(T0.hi), deep: hex(T0.deep) };
  const words = cardWords(gift), L = layoutFor(layout, W / H), rnd = seeded('real:' + (gift?.id || gift?.to || 'gift'));
  const gauss = () => { const u = Math.max(1e-9, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const uni = (a, b) => a + (b - a) * rnd();

  // ---- static layers
  const ground = canvasOf(W, H); {
    const q = ground.getContext('2d'), gx = 0.45 / W, gy = 0.55 / H, n2 = gx * gx + gy * gy;
    const lg = q.createLinearGradient(0, 0, gx / n2, gy / n2); lg.addColorStop(0, rgba(T.a)); lg.addColorStop(1, rgba(T.b));
    q.fillStyle = lg; q.fillRect(0, 0, W, H);
    q.save(); q.globalCompositeOperation = 'lighter';
    const rl = q.createRadialGradient(W * 0.28, H * 0.16, 0, W * 0.28, H * 0.16, W * 0.9);
    rl.addColorStop(0, 'rgba(255,255,255,0.2)'); rl.addColorStop(0.35, 'rgba(255,255,255,0.12)'); rl.addColorStop(0.7, 'rgba(255,255,255,0.03)'); rl.addColorStop(1, 'rgba(255,255,255,0)');
    q.fillStyle = rl; q.fillRect(0, 0, W, H); q.restore();
    q.save(); q.translate(W / 2, H / 2); q.scale(W * 0.62, H * 0.62);
    const vg = q.createRadialGradient(0, 0, 0, 0, 0, 1.15); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(0.55 / 1.15, 'rgba(0,0,0,0)'); vg.addColorStop(0.85 / 1.15, 'rgba(0,0,0,0.17)'); vg.addColorStop(1, 'rgba(0,0,0,0.34)');
    q.fillStyle = vg; q.fillRect(-1, -1, 2, 2); q.restore();
  }
  const lw = Math.max(2, Math.round(L.lw * W)), fi = L.inset * W, frad = L.radius * W;
  const frameLayer = canvasOf(W, H); {
    const q = frameLayer.getContext('2d'); q.strokeStyle = rgba(T.hi); q.lineWidth = lw;
    q.save(); q.shadowColor = rgba(T.hi, 0.9); q.shadowBlur = lw * 4.4; rrect(q, fi, fi, W - 2 * fi, H - 2 * fi, frad); q.stroke(); q.stroke(); q.restore();
    rrect(q, fi, fi, W - 2 * fi, H - 2 * fi, frad); q.stroke();
  }
  const standby = canvasOf(W, H); {
    const q = standby.getContext('2d'), sg = q.createLinearGradient(0, 0, 0, H);
    sg.addColorStop(0, rgba(T.deep.map((v) => Math.round(v * 0.8))));
    sg.addColorStop(1, rgba(T.deep.map((v) => Math.round(v * 0.8 * 0.55))));
    q.fillStyle = sg; q.fillRect(0, 0, W, H);
  }
  const ws = Math.max(18, Math.round(W * 0.055));
  const wordmark = textSprite(words.brand, ws, { fill: T.hi, tracking: 0.22, glow: { c: T.a, r: ws * 0.5, a: 0.9 } });

  // ---- words
  const probe = canvasOf(1, 1).getContext('2d');
  const measure = (s, size) => { probe.font = font(size); return probe.measureText(s).width; };
  const badge = badgeSprite(W * L.badge.size, words, T);
  const toFit = fitLines(words.to, measure, W * 0.84, W * L.to.size, W * 0.05, 1);
  const to = textSprite(toFit.lines[0] || '', toFit.size, { fill: T.ink, shadow: { c: T.deep, r: toFit.size * 0.08, a: 0.55, dy: toFit.size * 0.04 }, glow: { c: [255, 255, 255], r: toFit.size * 0.18, a: 0.25 } });
  const headWords = L.head.ys.length === 1 ? [words.head.filter(Boolean).join(' ')] : words.head;
  const hs = Math.min(...headWords.map((t) => fitLines(t, measure, W * L.head.fit, W * L.head.size, W * 0.08, 1).size));
  const head = headWords.map((t, i) => ({ ...textSprite(t, hs, { fill: T.hi, stroke: Math.max(2, Math.round(hs * 0.035)), strokeFill: [120, 24, 92],
    shadow: { c: T.deep, r: hs * 0.06, a: 0.75, dy: hs * 0.045 }, glow: { c: [255, 190, 120], r: hs * 0.16, a: 0.55 } }), y: L.head.ys[i] }));
  // the line: one line if it fits, else wrapped, and then no bigger than its room (layoutFor line.room) allows; centred on line.y
  let lf = fitLines(words.line, measure, W * L.line.fit, W * L.line.size, W * 0.04, L.line.maxLines);
  const cap = (L.line.room * H) / (Math.max(1, lf.lines.length) * 1.22);
  if (lf.lines.length > 1 && lf.size > cap) lf = fitLines(words.line, measure, W * L.line.fit, cap, Math.min(W * 0.04, cap), L.line.maxLines);
  const lgap = (lf.size * 1.22) / H, ly0 = L.line.y - (Math.max(0, lf.lines.length - 1) * lgap) / 2;
  const line = lf.lines.map((t, i) => ({ ...textSprite(t, lf.size, { fill: T.ink, shadow: { c: T.deep, r: lf.size * 0.1, a: 0.6, dy: lf.size * 0.05 } }), y: ly0 + i * lgap }));
  const ff = words.from ? fitLines(words.from, measure, W * 0.8, W * L.frm.size, W * 0.03, 1) : null;
  const frm = ff ? textSprite(ff.lines[0], ff.size, { fill: T.ink, shadow: { c: T.deep, r: ff.size * 0.1, a: 0.55, dy: ff.size * 0.05 } }) : null;
  const bsz = W * L.brand.size;
  const brand = textSprite('★  ' + words.brand + '  ★', bsz, { fill: T.hi, tracking: 0.16, shadow: { c: T.deep, r: bsz * 0.15, a: 0.5, dy: bsz * 0.05 } });
  const TW = [T.hi, [255, 255, 255], [255, 209, 234]];
  const spark = TW.map((c) => sparkSprite(Math.max(8, Math.round(W * 0.035)), c)), sparkS = TW.map((c) => sparkSprite(Math.max(5, Math.round(W * 0.018)), c));

  // ---- particles (seeded by the board, the same each time)
  const COLS = [T.hi, [255, 255, 255], T.a, [255, 209, 234], [185, 246, 255], [255, 170, 90], [190, 150, 255]];
  const burst = Array.from({ length: 170 }, () => {
    const ang = uni(-Math.PI, 0) + gauss() * 0.25, sp = uni(0.5, 1.6) * H * 0.85;
    return { x0: W * 0.5 + gauss() * W * 0.08, y0: H * L.burst + gauss() * H * 0.05, vx: Math.cos(ang) * sp * (W / H) * 1.6, vy: Math.sin(ang) * sp,
      rot: uni(0, 6.28), vr: uni(-9, 9), flip: uni(4, 11), size: uni(0.016, 0.03) * W, kind: Math.floor(rnd() * 3), col: COLS[Math.floor(rnd() * COLS.length)], life: uni(2.6, 4.6) };
  });
  const fall = Array.from({ length: 120 }, () => ({ t0: uni(2.2, 9.2), keep: rnd() }))
    .filter((p) => p.keep < 1 - 0.75 * smoothstep(5.5, 9.2, p.t0))
    .map((p) => ({ t0: p.t0, x0: uni(0.04, 0.96) * W, vy: uni(0.07, 0.14) * H, sway: uni(0.01, 0.03) * W, sw: uni(1.5, 3.5), ph: uni(0, 6.28),
      rot: uni(0, 6.28), vr: uni(-4, 4), flip: uni(3, 8), size: uni(0.014, 0.026) * W, kind: Math.floor(rnd() * 3), col: COLS[Math.floor(rnd() * COLS.length)] }));
  const twk = Array.from({ length: 70 }, () => ({ x: uni(0.06, 0.94) * W, y: uni(0.04, 0.96) * H, per: uni(1.2, 2.8), ph: rnd(), big: rnd() < 0.25, col: Math.floor(rnd() * 3) }));
  const tmp = canvasOf(8, 8), tg = tmp.getContext('2d');

  function blit(sp, cx, cy, scale = 1, alpha = 1, sheen = null) {
    if (alpha <= 0.002 || scale <= 0.01) return;
    const dw = sp.w * scale, dh = sp.h * scale, x = cx - dw / 2, y = cy - dh / 2;
    g.globalAlpha = Math.min(1, alpha); g.drawImage(sp.c, x, y, dw, dh); g.globalAlpha = 1;
    if (!sheen || !sp.body) return;
    // the sheen band over the letters only: the body mask, the band laid over it, added on top
    const tw = Math.ceil(dw), th = Math.ceil(dh);
    if (tmp.width < tw || tmp.height < th) { tmp.width = Math.max(tmp.width, tw); tmp.height = Math.max(tmp.height, th); }
    tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, tmp.width, tmp.height); tg.drawImage(sp.body, 0, 0, dw, dh);
    tg.globalCompositeOperation = 'source-in'; tg.fillStyle = sheen(-x, -y); tg.fillRect(0, 0, tw, th);
    g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = Math.min(1, alpha) * 0.95; g.drawImage(tmp, 0, 0, tw, th, x, y, tw, th); g.restore();
  }
  function confetti(x, y, rot, flip, s, kind, col, a) {
    if (a <= 0.01 || x < -s || y < -s || x > W + s || y > H + s) return;
    const shade = 0.65 + 0.35 * Math.abs(Math.cos(flip));
    g.globalAlpha = a; g.fillStyle = rgba(col.map((v) => Math.round(v * shade)));
    if (kind === 0) { g.beginPath(); g.arc(x, y, s * 0.45, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; return; }
    const [lw2, lh0] = kind === 1 ? [s * 1.3, s * 0.42] : [s * 0.7, s * 0.7], lh = lh0 * Math.max(0.15, Math.abs(Math.cos(flip)));
    g.save(); g.translate(x, y); g.rotate(rot); g.fillRect(-lw2 / 2, -lh / 2, lw2, lh); g.restore(); g.globalAlpha = 1;
  }
  function twinkles(t, gain, standbyMode) {
    const burstK = standbyMode ? 0 : Math.exp(-Math.max(0, t - flash - 0.1) / 1.5), calm = standbyMode ? 1 : 1 - 0.45 * smoothstep(6.5, 9.5, t);
    g.save(); g.globalCompositeOperation = 'lighter';
    twk.forEach((k, i) => {
      if (standbyMode && i % 2) return;
      const ph = ((t / k.per) + k.ph) % 1, a = Math.max(0, Math.sin(ph * Math.PI)) ** 3 * gain * calm * (0.7 + 0.8 * burstK);
      if (a < 0.02) return;
      const sp = (k.big ? spark : sparkS)[k.col]; g.globalAlpha = Math.min(1, a); g.drawImage(sp, k.x - sp.width / 2, k.y - sp.height / 2);
    });
    g.restore();
  }
  const sheenBand = (pos, amp) => (ox, oy) => {
    // u = (0.8 x + 0.21 y) / W; a gaussian band of width 0.07 around pos, as a gradient across it (offset into the sheen canvas)
    const dx = 0.8 / W, dy = 0.21 / W, n2 = dx * dx + dy * dy, at = (u) => [(dx * u) / n2 + ox, (dy * u) / n2 + oy];
    const [x0, y0] = at(pos - 0.18), [x1, y1] = at(pos + 0.18), gr = g.createLinearGradient(x0, y0, x1, y1);
    for (let i = 0; i <= 12; i++) { const u = -0.18 + (0.36 * i) / 12; gr.addColorStop(i / 12, `rgba(255,255,255,${(Math.exp(-((u / 0.07) ** 2)) * amp).toFixed(4)})`); }
    return gr;
  };

  function drawCard(t) {
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    if (t < flash) {
      const br = 0.5 + 0.5 * Math.sin((t * 2 * Math.PI) / 1.6 - 1.2), charge = smoothstep(0.95, flash, t);
      g.drawImage(standby, 0, 0);
      const s1 = 0.5 + 0.5 * Math.sin(t * 1.7), glow = T.a.map((v, i) => Math.round(v * s1 + T.b[i] * (1 - s1)));
      const k = Math.min(1, 0.24 + 0.12 * br + 0.55 * charge);
      g.save(); g.globalCompositeOperation = 'lighter'; g.translate(W / 2, H / 2); g.scale(W * 0.55, W * 0.55);
      const rg = g.createRadialGradient(0, 0, 0, 0, 0, 1.6); rg.addColorStop(0, rgba(glow, k)); rg.addColorStop(0.42, rgba(glow, k * 0.68)); rg.addColorStop(0.75, rgba(glow, k * 0.25)); rg.addColorStop(1, rgba(glow, 0));
      g.fillStyle = rg; g.fillRect(-1, -H / W / 0.55, 2, (2 * H) / W / 0.55); g.restore();
      g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = Math.min(1, 0.3 + 0.25 * br + 0.6 * charge); g.drawImage(frameLayer, 0, 0); g.restore();
      blit(wordmark, W / 2, H / 2, 1 + 0.04 * charge, 0.45 + 0.25 * br + 0.3 * charge);
      twinkles(t, 0.55 + 0.6 * charge, true);
      const fl = smoothstep(1.36, flash, t) ** 2;
      if (fl > 0.002) { g.fillStyle = `rgba(255,247,251,${fl})`; g.fillRect(0, 0, W, H); }
      return;
    }
    const tt = t - flash;
    g.drawImage(ground, 0, 0);
    const calm = 1 - 0.6 * smoothstep(6.5, 9.5, t), breathe = 0.5 + 0.5 * Math.sin((t * 2 * Math.PI) / 3.2), lit = 0.96 + 0.05 * breathe * calm;
    if (lit < 1) { g.fillStyle = `rgba(0,0,0,${(1 - lit).toFixed(4)})`; g.fillRect(0, 0, W, H); }
    g.save(); g.globalCompositeOperation = 'lighter';
    if (lit > 1) { g.fillStyle = `rgba(255,255,255,${(lit - 1).toFixed(4)})`; g.fillRect(0, 0, W, H); }
    const lx = 0.3 + 0.4 * Math.sin(t * 0.45);
    g.save(); g.translate(lx * W, 0.35 * H); g.scale(0.5 * W, 0.4 * H);
    const ml = g.createRadialGradient(0, 0, 0, 0, 0, 2); ml.addColorStop(0, 'rgba(255,255,255,0.06)'); ml.addColorStop(0.5, 'rgba(255,255,255,0.022)'); ml.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = ml; g.fillRect(-2, -2, 4, 4); g.restore();
    g.globalAlpha = Math.min(1, 0.9 * (0.8 + 0.2 * breathe)); g.drawImage(frameLayer, 0, 0);
    g.restore();
    // the burst, then the falling confetti (behind the words)
    const tb = tt - 0.02;
    if (tb > 0) {
      const drag = 1.6, k = (1 - Math.exp(-drag * tb)) / drag, gr = H * 0.55;
      for (const b of burst) confetti(b.x0 + b.vx * k, b.y0 + b.vy * k + (gr * (tb - k)) / drag, b.rot + b.vr * tb, b.flip * tb, b.size, b.kind, b.col, 1 - smoothstep(b.life - 0.8, b.life, tb));
    }
    for (const f of fall) {
      const tf = t - f.t0; if (tf <= 0) continue;
      const y = -0.03 * H + f.vy * tf;
      confetti(f.x0 + f.sway * Math.sin(f.sw * tf + f.ph), y, f.rot + f.vr * tf, f.flip * tf, f.size, f.kind, f.col, 0.9 * (1 - smoothstep(0.85, 1.02, y / H)));
    }
    const appear = (t0, dur) => (t - t0) / dur;
    let p = appear(1.62 - 1.5 + flash, 0.5);
    if (p > 0) { const e = easeOutBack(p); blit(badge, W / 2, H * L.badge.y - (1 - e) * H * 0.05, 0.8 + 0.2 * e, Math.min(1, p * 2.2)); }
    p = appear(1.72 - 1.5 + flash, 0.5);
    if (p > 0) blit(to, W / 2, H * L.to.y, 0.78 + 0.22 * easeOutBack(p), Math.min(1, p * 2));
    let sheen = null, sheenAmp = 0, sheenPos = 0;
    for (const [ts, amp] of [[3.0, 0.85], [6.1, 0.65], [8.6, 0.4]]) { const q = (t - ts) / 0.9; if (q >= 0 && q <= 1) { sheenPos = -0.4 + 1.8 * q; sheenAmp = amp; sheen = sheenBand(sheenPos, amp); } }
    if (hero) head.forEach((sp, i) => {
      const q = appear(1.8 - 1.5 + flash + 0.1 * i, 0.45);
      if (q <= 0) return;
      const e = easeOutBack(q, 2.2), s = (1.2 - 0.2 * e) * (1 + 0.012 * Math.sin((t * 2 * Math.PI) / 2.4 + i) * calm);
      blit(sp, W / 2, H * sp.y, s, Math.min(1, q * 3.5), sheen);
    });
    const tLine = Number.isFinite(at?.line) ? at.line : 2.35 - 1.5 + flash, tFrom = Number.isFinite(at?.from) ? at.from : 2.65 - 1.5 + flash;
    line.forEach((sp, i) => { const q = appear(tLine + 0.1 * i, 0.55); if (q > 0) blit(sp, W / 2, H * sp.y + (1 - easeOutCubic(q)) * H * 0.03, 1, Math.min(1, q * 1.6)); });
    p = appear(tFrom, 0.55);
    if (p > 0 && frm) blit(frm, W / 2, H * L.frm.y + (1 - easeOutCubic(p)) * H * 0.025, 1, Math.min(1, p * 1.6));
    p = appear(2.9 - 1.5 + flash, 0.6);
    if (p > 0) blit(brand, W / 2, H * L.brand.y, 1, 0.9 * Math.min(1, p * 1.5));
    if (sheen) { g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = sheenBand(sheenPos, sheenAmp * 0.08)(0, 0); g.fillRect(0, 0, W, H); g.restore(); }
    twinkles(t, 1, false);
    const fl = tt < 1.2 ? Math.exp(-Math.max(0, tt) / 0.16) : 0;
    if (fl > 0.002) { g.fillStyle = `rgba(255,247,251,${fl})`; g.fillRect(0, 0, W, H); }
  }
  // The phone's app margin (the card's deep colour, dimmed) round the card in its rounded box.
  const margin = rgba(T.deep.map((v) => Math.round(v * 0.79)));
  function draw(t) {
    drawCard(t);
    if (!phone) return;
    out.globalCompositeOperation = 'source-over'; out.globalAlpha = 1;
    out.fillStyle = margin; out.fillRect(0, 0, w, h);
    out.save(); rrect(out, ins, ins, W, H, 0.07 * w); out.clip(); out.drawImage(inner, ins, ins); out.restore();
  }
  return { canvas, draw, layout: L.name, theme: T };
}
