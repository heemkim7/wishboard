// Canvas painters for every procedural texture in the plaza:
// billboard artwork, LED tickers, neon signs, K-brand ads, facades, decals, name tags.
export const SANS = '"Pretendard Variable", Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
export const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

export const THEMES = {
  cyber_navy: { label: '사이버 네이비', accent: '#3fe6ff', accent2: '#ff3d9a', swatch: ['#050b2a', '#3b1170', '#ff3d9a'] },
  neon_pink: { label: 'K-POP 핑크', accent: '#ff3d9a', accent2: '#ffd1f4', swatch: ['#16001e', '#7a0a6a', '#ff6fd0'] },
  gold_luxury: { label: '골드 럭셔리', accent: '#ffcf5a', accent2: '#fff3c4', swatch: ['#0b0702', '#5a3c08', '#ffcf5a'] },
  matrix_green: { label: '매트릭스', accent: '#39f58a', accent2: '#d4ffe6', swatch: ['#010a05', '#06361b', '#39f58a'] },
  sunset_red: { label: '선셋 서울', accent: '#ff6a3d', accent2: '#ffe0b0', swatch: ['#1b0230', '#ff3d3d', '#ffb347'] },
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
function sparkle(g, x, y, s, color) {
  g.save();
  g.fillStyle = color;
  g.shadowColor = color;
  g.shadowBlur = s * 2;
  g.beginPath();
  g.moveTo(x, y - s);
  g.quadraticCurveTo(x, y, x + s, y);
  g.quadraticCurveTo(x, y, x, y + s);
  g.quadraticCurveTo(x, y, x - s, y);
  g.quadraticCurveTo(x, y, x, y - s);
  g.fill();
  g.restore();
}

// Seoul skyline: random blocks, N Seoul Tower on Namsan, Lotte World Tower.
function seoulSkyline(g, W, base, r, k, fill, lit) {
  g.save();
  let x = -10 * k;
  while (x < W) {
    const w = (22 + r() * 44) * k, h = (26 + r() * 100) * k;
    g.fillStyle = fill;
    g.fillRect(x, base - h, w + 1, h + 2);
    if (lit) {
      g.fillStyle = lit;
      for (let wy = base - h + 7 * k; wy < base - 5 * k; wy += 9 * k) {
        for (let wx = x + 4 * k; wx < x + w - 5 * k; wx += 8 * k) if (r() < 0.32) g.fillRect(wx, wy, 3 * k, 4 * k);
      }
    }
    x += w + r() * 5 * k;
  }
  g.fillStyle = fill;
  const tx = W * 0.2;
  g.beginPath();
  g.ellipse(tx, base + 4 * k, 130 * k, 52 * k, 0, Math.PI, 0);
  g.fill();
  const hill = base - 46 * k;
  g.fillRect(tx - 4 * k, hill - 110 * k, 8 * k, 112 * k);
  g.beginPath();
  g.ellipse(tx, hill - 108 * k, 19 * k, 10 * k, 0, 0, Math.PI * 2);
  g.fill();
  g.fillRect(tx - 1.5 * k, hill - 170 * k, 3 * k, 62 * k);
  if (lit) { g.fillStyle = lit; g.fillRect(tx - 15 * k, hill - 110 * k, 30 * k, 3 * k); }
  g.fillStyle = fill;
  const lx = W * 0.84;
  g.beginPath();
  g.moveTo(lx - 24 * k, base);
  g.lineTo(lx - 7 * k, base - 236 * k);
  g.lineTo(lx, base - 258 * k);
  g.lineTo(lx + 7 * k, base - 236 * k);
  g.lineTo(lx + 24 * k, base);
  g.closePath();
  g.fill();
  g.restore();
}

const ART = {
  cyber_navy(g, W, H, r, k) {
    let gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#03051a');
    gr.addColorStop(0.5, '#170f4c');
    gr.addColorStop(0.68, '#45106e');
    gr.addColorStop(0.69, '#0b0326');
    gr.addColorStop(1, '#05010f');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.6})`;
      const s = (r() * 2 + 0.6) * k;
      g.fillRect(r() * W, r() * H * 0.5, s, s);
    }
    const hz = H * 0.68, sx = W * 0.68, sr = H * 0.3;
    glowDot(g, sx, hz - sr * 0.3, sr * 2.1, '#ff3d9a', 0.45);
    g.save();
    g.beginPath();
    g.arc(sx, hz - sr * 0.3, sr, 0, Math.PI * 2);
    g.clip();
    gr = g.createLinearGradient(0, hz - sr * 1.3, 0, hz + sr * 0.7);
    gr.addColorStop(0, '#fff07a');
    gr.addColorStop(0.5, '#ff8a4d');
    gr.addColorStop(1, '#ff2d95');
    g.fillStyle = gr;
    g.fillRect(sx - sr, hz - sr * 1.4, sr * 2, sr * 2.2);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 8; i++) g.fillRect(sx - sr, hz - sr * 0.62 + i * sr * 0.13, sr * 2, (1.5 + i * 1.7) * k);
    g.restore();
    seoulSkyline(g, W, hz + 2 * k, r, k, '#0a0420', 'rgba(63,230,255,0.85)');
    g.save();
    g.strokeStyle = 'rgba(255,61,154,0.85)';
    g.shadowColor = '#ff3d9a';
    g.shadowBlur = 10 * k;
    g.lineWidth = 2.2 * k;
    for (let i = -18; i <= 18; i++) {
      g.beginPath();
      g.moveTo(W / 2 + i * W * 0.018, hz);
      g.lineTo(W / 2 + i * W * 0.17, H);
      g.stroke();
    }
    for (let j = 1; j < 10; j++) {
      const t = j / 10, yy = hz + (H - hz) * t * t;
      g.beginPath();
      g.moveTo(0, yy);
      g.lineTo(W, yy);
      g.stroke();
    }
    g.strokeStyle = '#3fe6ff';
    g.shadowColor = '#3fe6ff';
    g.lineWidth = 3 * k;
    g.beginPath();
    g.moveTo(0, hz);
    g.lineTo(W, hz);
    g.stroke();
    g.restore();
  },
  neon_pink(g, W, H, r, k) {
    let gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#12001c');
    gr.addColorStop(0.55, '#3d0052');
    gr.addColorStop(1, '#8a0c6e');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const x = W * (0.08 + i * 0.14) + (r() - 0.5) * 40 * k;
      const spread = (90 + r() * 120) * k;
      gr = g.createLinearGradient(0, 0, 0, H);
      const col = i % 3 === 0 ? '#3fe6ff' : i % 3 === 1 ? '#ff6fd0' : '#fff2a8';
      gr.addColorStop(0, rgba(col, 0.42));
      gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(x - 6 * k, 0);
      g.lineTo(x + 6 * k, 0);
      g.lineTo(x + spread + (r() - 0.5) * 160 * k, H);
      g.lineTo(x - spread + (r() - 0.5) * 160 * k, H);
      g.closePath();
      g.fill();
    }
    for (let i = 0; i < 28; i++) {
      const col = ['#ff3d9a', '#b84dff', '#3fe6ff', '#ffd1f4'][i % 4];
      glowDot(g, r() * W, r() * H * 0.8, (14 + r() * 46) * k, col, 0.2 + r() * 0.3);
    }
    g.restore();
    const base = H * 0.92;
    g.fillStyle = '#0d0010';
    for (let x = -10 * k; x < W + 20 * k; x += (26 + r() * 10) * k) {
      const hr = (13 + r() * 6) * k;
      g.beginPath();
      g.arc(x, base - hr * 0.2, hr, 0, Math.PI * 2);
      g.fill();
      g.fillRect(x - hr * 1.2, base, hr * 2.4, H - base);
      if (r() < 0.55) {
        const lx = x + (r() - 0.5) * 22 * k, ly = base - (40 + r() * 34) * k;
        g.strokeStyle = '#2a0a2e';
        g.lineWidth = 3 * k;
        g.beginPath();
        g.moveTo(x + 6 * k, base - 4 * k);
        g.lineTo(lx, ly);
        g.stroke();
        glowDot(g, lx, ly, 14 * k, r() < 0.5 ? '#ff6fd0' : '#3fe6ff', 0.95);
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(lx, ly, 3.4 * k, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#0d0010';
      }
    }
    for (let i = 0; i < 14; i++) sparkle(g, r() * W, r() * H * 0.7, (4 + r() * 9) * k, '#ffffff');
  },
  gold_luxury(g, W, H, r, k) {
    let gr = g.createRadialGradient(W * 0.5, H * 0.62, 10, W * 0.5, H * 0.62, W * 0.7);
    gr.addColorStop(0, '#4a3008');
    gr.addColorStop(0.55, '#1a1004');
    gr.addColorStop(1, '#070401');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(W * 0.5, H * 1.02);
    for (let i = 0; i < 36; i++) {
      const a0 = Math.PI + (i / 36) * Math.PI, a1 = a0 + Math.PI / 72;
      g.fillStyle = i % 2 ? 'rgba(255,207,90,0.10)' : 'rgba(255,207,90,0.03)';
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, W, a0, a1);
      g.closePath();
      g.fill();
    }
    g.restore();
    g.save();
    g.strokeStyle = '#d9a93a';
    g.shadowColor = '#ffcf5a';
    g.shadowBlur = 8 * k;
    g.lineWidth = 3 * k;
    g.strokeRect(26 * k, 26 * k, W - 52 * k, H - 52 * k);
    g.lineWidth = 1.4 * k;
    g.strokeRect(38 * k, 38 * k, W - 76 * k, H - 76 * k);
    for (const [cx, cy, sx, sy] of [[38, 38, 1, 1], [W / k - 38, 38, -1, 1], [38, H / k - 38, 1, -1], [W / k - 38, H / k - 38, -1, -1]]) {
      for (let i = 1; i <= 3; i++) {
        g.beginPath();
        g.arc(cx * k, cy * k, i * 16 * k, sx > 0 ? (sy > 0 ? 0 : -Math.PI / 2) : (sy > 0 ? Math.PI / 2 : Math.PI), sx > 0 ? (sy > 0 ? Math.PI / 2 : 0) : (sy > 0 ? Math.PI : Math.PI * 1.5));
        g.stroke();
      }
    }
    g.restore();
    for (let i = 0; i < 220; i++) {
      g.fillStyle = `rgba(255,${200 + r() * 55 | 0},${120 + r() * 80 | 0},${0.2 + r() * 0.7})`;
      const s = (r() * 2.2 + 0.4) * k;
      g.fillRect(r() * W, r() * H, s, s);
    }
    g.save();
    g.globalCompositeOperation = 'lighter';
    gr = g.createLinearGradient(W * 0.2, 0, W * 0.55, H);
    gr.addColorStop(0, 'rgba(255,240,200,0)');
    gr.addColorStop(0.5, 'rgba(255,240,200,0.12)');
    gr.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.restore();
    for (let i = 0; i < 8; i++) sparkle(g, r() * W, r() * H, (4 + r() * 8) * k, '#fff3c4');
  },
  matrix_green(g, W, H, r, k) {
    g.fillStyle = '#010a05';
    g.fillRect(0, 0, W, H);
    const glyphs = '가나다라마바사아자차카타파하ㅋㅎ0123456789붕어빵코인';
    const size = Math.round(20 * k);
    g.font = `700 ${size}px ${SANS}`;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (let x = size * 0.6; x < W; x += size * 1.05) {
      const len = 6 + (r() * 22 | 0), y0 = (r() * 1.2 - 0.3) * H;
      for (let i = 0; i < len; i++) {
        const y = y0 + i * size * 1.08;
        if (y < -size || y > H) continue;
        const t = i / len;
        g.fillStyle = i === len - 1 ? '#e8fff1' : `rgba(57,245,138,${0.12 + t * 0.75})`;
        if (i === len - 1) { g.shadowColor = '#39f58a'; g.shadowBlur = 12 * k; }
        g.fillText(glyphs[(r() * glyphs.length) | 0], x, y);
        g.shadowBlur = 0;
      }
    }
    const gr = g.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.7);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,0.65)');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  },
  sunset_red(g, W, H, r, k) {
    const hz = H * 0.66;
    let gr = g.createLinearGradient(0, 0, 0, hz);
    gr.addColorStop(0, '#16022c');
    gr.addColorStop(0.45, '#6e0d48');
    gr.addColorStop(0.8, '#ff3d3d');
    gr.addColorStop(1, '#ffb347');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, hz);
    const sx = W * 0.56, sr = H * 0.2;
    glowDot(g, sx, hz - sr * 0.4, sr * 2.6, '#ffcf5a', 0.5);
    g.save();
    g.beginPath();
    g.arc(sx, hz - sr * 0.4, sr, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#ffe6a0';
    g.fillRect(sx - sr, hz - sr * 1.5, sr * 2, sr * 2.2);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 6; i++) g.fillRect(sx - sr, hz - sr * 0.5 + i * sr * 0.16, sr * 2, (2 + i * 2) * k);
    g.restore();
    seoulSkyline(g, W, hz + 2 * k, r, k, '#2a0420', 'rgba(255,211,120,0.8)');
    gr = g.createLinearGradient(0, hz, 0, H);
    gr.addColorStop(0, '#3a0a2a');
    gr.addColorStop(1, '#0a0210');
    g.fillStyle = gr;
    g.fillRect(0, hz, W, H - hz);
    for (let i = 0; i < 16; i++) {
      const y = hz + 8 * k + i * (H - hz) / 17, w = sr * (1.8 - i * 0.09) * (0.7 + r() * 0.5);
      g.fillStyle = `rgba(255,${170 + (r() * 60 | 0)},90,${0.75 - i * 0.04})`;
      g.fillRect(sx - w / 2, y, w, 2.4 * k);
    }
    g.strokeStyle = 'rgba(20,0,20,0.9)';
    g.lineWidth = 4 * k;
    for (let i = 0; i < 5; i++) {
      const bx = W * (0.08 + i * 0.2);
      g.beginPath();
      g.arc(bx + W * 0.1, hz + 26 * k, W * 0.1, Math.PI, 0);
      g.stroke();
    }
    g.fillStyle = 'rgba(20,0,20,0.9)';
    g.fillRect(0, hz + 22 * k, W, 6 * k);
  },
};

const TIER_TAG = { S: 'S-CLASS · MAIN TOWER', B: 'B-CLASS · SUB TOWER', C: 'C-CLASS · STREET WALL' };
export function tierOf(slotId) {
  const s = String(slotId || '');
  return s.startsWith('MAIN') ? 'S' : s.startsWith('SUB') ? 'B' : 'C';
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
  const r = rng(hashStr(`${data.slot_id}|${theme}`));
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  const ink = /^#[0-9a-f]{3,8}$/i.test(String(data.text_color || '')) ? data.text_color : '#ffffff';
  const ticker = opts.ticker ? 44 * k : 0;
  const statsH = Math.max(28, 42 * k);
  const body = H - ticker - statsH;

  if (opts.photo) {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, body);
    cover(g, opts.photo, 0, 0, W, body);
    const lines = [chars(data.line1, 20), chars(data.line2, 24), chars(data.line3, 28)].map(t => String(t || '').trim()).filter(Boolean);
    if (lines.length) {
      const weights = [900, 800, 700];
      const caps = [72 * k, 40 * k, 32 * k];
      const mins = [26 * k, 18 * k, 15 * k];
      const sizes = lines.map((t, i) => fit(g, t, W * 0.86, caps[Math.min(i, 2)], weights[Math.min(i, 2)], SANS, mins[Math.min(i, 2)]));
      const gap = 8 * k;
      const block = sizes.reduce((a, s) => a + s * 1.2, 0) + gap * (sizes.length - 1);
      const anchor = Math.min(88, Math.max(12, Number(data.caption_y) || 72)) / 100;
      let y = Math.max(14 * k, Math.min(body - block - 14 * k, body * anchor - block / 2));
      g.fillStyle = 'rgba(2,3,14,0.62)';
      g.fillRect(0, y - 12 * k, W, block + 24 * k);
      lines.forEach((t, i) => {
        const s = sizes[i];
        neon(g, t, W / 2, y + s * 0.55, s, SANS, weights[Math.min(i, 2)], ink, { glow: 0.45, align: 'center' });
        y += s * 1.2 + gap;
      });
    }
  } else {
    ART[theme](g, W, H, r, k);
    const gr = g.createLinearGradient(W * 0.3, 0, W, 0);
    gr.addColorStop(0, 'rgba(2,3,14,0)');
    gr.addColorStop(0.22, 'rgba(2,3,14,0.42)');
    gr.addColorStop(1, 'rgba(2,3,14,0.58)');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, body);

    const cx = W * 0.19, cy = body * 0.56, R = body * 0.25;
    glowDot(g, cx, cy, R * 1.9, th.accent, 0.5);
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fillStyle = 'rgba(5,6,22,0.78)';
    g.fill();
    g.save();
    g.lineWidth = 6 * k;
    g.strokeStyle = th.accent;
    g.shadowColor = th.accent;
    g.shadowBlur = 26 * k;
    g.stroke();
    g.setLineDash([10 * k, 12 * k]);
    g.lineWidth = 3 * k;
    g.strokeStyle = rgba(th.accent2, 0.85);
    g.beginPath();
    g.arc(cx, cy, R * 1.17, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    g.font = `${Math.round(R * 1.12)}px ${EMOJI}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(chars(data.emoji || '🔥', 4) || '🔥', cx, cy + R * 0.07);

    const tx = W * 0.385, maxW = W * 0.575;
    const l1 = chars(data.line1, 20).trim(), l2 = chars(data.line2, 24).trim(), l3 = chars(data.line3, 28).trim();
    const s1 = l1 ? fit(g, l1, maxW, 146 * k, 900, SANS, 44 * k) : 0;
    const s2 = l2 ? fit(g, l2, maxW, 75 * k, 800, SANS, 29 * k) : 0;
    const s3 = l3 ? fit(g, l3, maxW, 57 * k, 700, SANS, 23 * k) : 0;
    const gap = 20 * k;
    const total = (s1 ? s1 * 1.02 : 0) + (s2 ? s2 * 1.15 + gap : 0) + (s3 ? s3 * 1.2 + gap : 0);
    let y = body * 0.56 - total / 2;
    if (s1) { neon(g, l1, tx, y + s1 * 0.5, s1, SANS, 900, ink, { glow: 1 }); y += s1 * 1.02 + gap; }
    if (s2) { neon(g, l2, tx, y + s2 * 0.55, s2, SANS, 800, mixHex(ink, th.accent2, 0.35), { glow: 0.55 }); y += s2 * 1.15 + gap; }
    if (s3) neon(g, l3, tx, y + s3 * 0.55, s3, SANS, 700, th.accent2, { glow: 0.45 });
  }

  const vacant = !data.holder_id;
  const who = vacant ? '✨ 소원 기다리는 중' : `👑 ${chars(data.holder_name || '익명', 14)}`;
  g.font = `800 ${Math.round(34 * k)}px ${SANS}`;
  const pw = g.measureText(who).width + 40 * k;
  roundRect(g, 28 * k, 26 * k, pw, 46 * k, 23 * k);
  g.fillStyle = 'rgba(4,5,18,0.72)';
  g.fill();
  g.lineWidth = 2 * k;
  g.strokeStyle = rgba(th.accent, 0.9);
  g.stroke();
  g.fillStyle = vacant ? '#ffe9a8' : '#ffffff';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(who, 48 * k, 50 * k);
  const badge = linkBadge(data.external_url);
  if (badge) {
    g.font = `800 ${Math.round(22 * k)}px ${SANS}`;
    const bw = g.measureText(badge.label).width + 36 * k;
    const by = vacant ? 26 * k : 82 * k;
    roundRect(g, 28 * k, by, bw, 36 * k, 18 * k);
    g.fillStyle = 'rgba(4,5,18,0.78)';
    g.fill();
    g.strokeStyle = badge.color;
    g.lineWidth = 2 * k;
    g.stroke();
    g.fillStyle = badge.color;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(badge.label, 46 * k, by + 18 * k);
  }
  if (opts.pending && !vacant) {
    const t = '📷 사진 검수 중';
    g.font = `800 ${Math.round(22 * k)}px ${SANS}`;
    roundRect(g, 28 * k, 82 * k, g.measureText(t).width + 34 * k, 38 * k, 19 * k);
    g.fillStyle = 'rgba(4,5,18,0.72)';
    g.fill();
    g.strokeStyle = 'rgba(255,207,90,0.9)';
    g.stroke();
    g.fillStyle = '#ffcf5a';
    g.fillText(t, 45 * k, 101 * k);
  }

  const tag = String(data.slot_id).startsWith('TOWER') ? 'ONE TIMES SQUARE' : String(data.slot_id).startsWith('WALL') ? 'TIMES SQUARE' : TIER_TAG[tierOf(data.slot_id)];
  g.font = `800 ${Math.round(20 * k)}px ${SANS}`;
  g.textAlign = 'right';
  g.fillStyle = rgba('#ffffff', 0.86);
  g.fillText(tag, W - 70 * k, 50 * k);
  g.fillStyle = '#ff2e4d';
  g.shadowColor = '#ff2e4d';
  g.shadowBlur = 12 * k;
  g.beginPath();
  g.arc(W - 48 * k, 50 * k, 8 * k, 0, Math.PI * 2);
  g.fill();
  g.shadowBlur = 0;

  g.strokeStyle = rgba(th.accent, 0.9);
  g.lineWidth = 4 * k;
  const b = 18 * k, L = 46 * k;
  for (const [x, y2, dx, dy] of [[b, b, 1, 1], [W - b, b, -1, 1], [b, body - b, 1, -1], [W - b, body - b, -1, -1]]) {
    g.beginPath();
    g.moveTo(x, y2 + dy * L);
    g.lineTo(x, y2);
    g.lineTo(x + dx * L, y2);
    g.stroke();
  }

  const views = Math.max(0, Math.floor(Number(data.views) || 0));
  const cheers = Math.max(0, Math.floor(Number(data.cheers) || 0));
  g.fillStyle = '#05060f';
  g.fillRect(0, H - statsH, W, statsH);
  g.fillStyle = '#ffcf5a';
  g.font = `800 ${Math.max(14, Math.round(22 * k))}px ${SANS}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let label = `🙏 ${cheers}명이 함께 응원 중`;
  const taxi = ` · 🚕 ${views}`;
  if (views > 0 && g.measureText(label + taxi).width <= W - 36 * k) label += taxi;
  g.fillText(label, W / 2, H - statsH / 2);

  if (ticker) {
    g.fillStyle = '#030308';
    g.fillRect(0, body, W, ticker);
    g.fillStyle = '#ff2e4d';
    g.fillRect(0, body, 120 * k, ticker);
    g.font = `900 ${Math.round(22 * k)}px ${SANS}`;
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.fillText('LIVE', 60 * k, body + ticker / 2);
    g.textAlign = 'left';
    g.fillStyle = '#ffcf5a';
    g.shadowColor = '#ffcf5a';
    g.shadowBlur = 8 * k;
    g.font = `800 ${Math.round(22 * k)}px ${SANS}`;
    g.fillText(chars(opts.ticker, 60), 140 * k, body + ticker / 2 + 1);
    g.shadowBlur = 0;
  }
  g.restore();
  return canvas;
}

/** Seamless LED ticker: text repeats an integer number of times across the canvas width. */
export function paintTicker(canvas, text, color = '#ffcf5a') {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#020205';
  g.fillRect(0, 0, W, H);
  const size = Math.round(H * 0.6);
  g.font = `800 ${size}px ${SANS}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  const unit = `${text}      ✦      `;
  const uw = Math.max(1, g.measureText(unit).width);
  const n = Math.max(1, Math.round(W / uw));
  g.save();
  g.scale(W / (n * uw), 1);
  g.fillStyle = color;
  g.shadowColor = color;
  g.shadowBlur = H * 0.22;
  for (let i = 0; i < n; i++) g.fillText(unit, i * uw, H * 0.54);
  g.restore();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
  return canvas;
}

export function paintNeonSign(canvas, text, color = '#00ffcc', sub = '') {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = H / 128;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  roundRect(g, 4 * k, 4 * k, W - 8 * k, H - 8 * k, 18 * k);
  g.fillStyle = '#07070d';
  g.fill();
  g.save();
  g.lineWidth = 5 * k;
  g.strokeStyle = color;
  g.shadowColor = color;
  g.shadowBlur = 18 * k;
  roundRect(g, 12 * k, 12 * k, W - 24 * k, H - 24 * k, 12 * k);
  g.stroke();
  g.restore();
  const t = chars(text || '분양 중', 14);
  const s = fit(g, t, W - 60 * k, (sub ? 54 : 62) * k, 900, SANS, 18 * k);
  neon(g, t, W / 2, sub ? H * 0.42 : H * 0.53, s, SANS, 900, color, { align: 'center', glow: 0.9 });
  if (sub) {
    g.font = `800 ${Math.round(20 * k)}px ${SANS}`;
    g.textAlign = 'center';
    g.fillStyle = rgba('#ffffff', 0.8);
    g.fillText(sub, W / 2, H * 0.78);
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
  const rows = [['팥 붕어빵', '+5 코인'], ['슈크림 붕어빵', '+5 코인'], ['황금 붕어빵', '+15 코인!']];
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
  g.fillText('타이밍 맞춰 구우면 코인!', W / 2, H - 70 * k);
  return canvas;
}

export function paintTentPrint(canvas) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = H / 128;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.96)';
  g.font = `900 ${Math.round(84 * k)}px ${SANS}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('황금붕어빵', W / 2, H * 0.55);
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
  const s = fit(g, text, W * 0.92, H * 0.72, 900, SANS, 10);
  neon(g, text, W / 2, H * 0.54, s, SANS, 900, color, { align: 'center', glow: 0.8, stroke: false });
  return canvas;
}

/** Vertical blade sign with marquee bulbs. */
export function paintBlade(canvas, text, color) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = W / 128;
  g.fillStyle = '#0b0710';
  g.fillRect(0, 0, W, H);
  g.fillStyle = color;
  g.fillRect(0, 0, W, 6 * k);
  g.fillRect(0, H - 6 * k, W, 6 * k);
  for (let y = 18 * k; y < H - 12 * k; y += 22 * k) {
    for (const x of [12 * k, W - 12 * k]) {
      glowDot(g, x, y, 9 * k, '#ffe7a3', 0.9);
      g.fillStyle = '#fff8e0';
      g.beginPath();
      g.arc(x, y, 3.2 * k, 0, Math.PI * 2);
      g.fill();
    }
  }
  const letters = Array.from(text);
  const step = (H - 60 * k) / letters.length;
  const size = Math.min(84 * k, step * 0.86);
  letters.forEach((ch, i) => neon(g, ch, W / 2, 30 * k + step * (i + 0.5), Math.round(size), SANS, 900, color, { align: 'center', glow: 0.9 }));
  return canvas;
}

/** Fictional K-brand ad posters packed in a 4×2 atlas of 512px cells. */
export function paintAdAtlas(canvas) {
  const g = canvas.getContext('2d');
  const C = canvas.width / 4;
  const k = C / 512;
  const cells = [];
  const ads = [
    (x, y) => {
      let gr = g.createLinearGradient(x, y, x, y + C);
      gr.addColorStop(0, '#e3001b'); gr.addColorStop(1, '#7a000e');
      g.fillStyle = gr; g.fillRect(x, y, C, C);
      for (let i = 0; i < 9; i++) { g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 10 * k; g.beginPath(); g.arc(x + C * 0.5, y + C * 1.3, C * (0.4 + i * 0.12), Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
      roundRect(g, x + C * 0.62, y + C * 0.3, C * 0.24, C * 0.5, 20 * k);
      gr = g.createLinearGradient(x + C * 0.62, 0, x + C * 0.86, 0);
      gr.addColorStop(0, '#9a0010'); gr.addColorStop(0.35, '#ff6b74'); gr.addColorStop(1, '#8a000e');
      g.fillStyle = gr; g.fill();
      g.fillStyle = '#ffffff'; g.font = `900 ${Math.round(40 * k)}px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.save(); g.translate(x + C * 0.74, y + C * 0.55); g.rotate(-Math.PI / 2); g.fillText('SEOUL', 0, 0); g.restore();
      neon(g, 'SEOUL', x + C * 0.32, y + C * 0.33, Math.round(84 * k), SANS, 900, '#ffffff', { align: 'center', glow: 0.3 });
      neon(g, 'COLA', x + C * 0.32, y + C * 0.5, Math.round(84 * k), SANS, 900, '#ffffff', { align: 'center', glow: 0.3 });
      g.font = `800 ${Math.round(30 * k)}px ${SANS}`; g.fillStyle = '#ffe6a0'; g.fillText('Taste the K-Wave', x + C * 0.32, y + C * 0.68);
      g.font = `700 ${Math.round(26 * k)}px ${SANS}`; g.fillStyle = '#ffffff'; g.fillText('짜릿한 서울의 맛', x + C * 0.5, y + C * 0.9);
    },
    (x, y) => {
      const gr = g.createLinearGradient(x, y, x, y + C);
      gr.addColorStop(0, '#0b3d91'); gr.addColorStop(0.6, '#3fa9f5'); gr.addColorStop(1, '#bfe6ff');
      g.fillStyle = gr; g.fillRect(x, y, C, C);
      g.fillStyle = '#ffffff';
      g.save(); g.translate(x + C * 0.55, y + C * 0.42); g.rotate(-0.25);
      g.beginPath(); g.ellipse(0, 0, C * 0.3, C * 0.045, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(-C * 0.05, 0); g.lineTo(-C * 0.16, -C * 0.17); g.lineTo(-C * 0.08, -C * 0.17); g.lineTo(C * 0.06, 0); g.fill();
      g.beginPath(); g.moveTo(-C * 0.05, 0); g.lineTo(-C * 0.16, C * 0.17); g.lineTo(-C * 0.08, C * 0.17); g.lineTo(C * 0.06, 0); g.fill();
      g.beginPath(); g.moveTo(-C * 0.24, 0); g.lineTo(-C * 0.3, -C * 0.09); g.lineTo(-C * 0.26, -C * 0.09); g.lineTo(-C * 0.2, 0); g.fill();
      g.restore();
      neon(g, 'HALLYU AIR', x + C * 0.5, y + C * 0.72, Math.round(64 * k), SANS, 900, '#ffffff', { align: 'center', glow: 0.2 });
      g.font = `800 ${Math.round(30 * k)}px ${SANS}`; g.fillStyle = '#0b2a5e'; g.textAlign = 'center';
      g.fillText('SEOUL ⇄ NEW YORK  14h', x + C * 0.5, y + C * 0.86);
    },
    (x, y) => {
      const gr = g.createLinearGradient(x, y, x + C, y + C);
      gr.addColorStop(0, '#ffd6e8'); gr.addColorStop(1, '#ff8fc0');
      g.fillStyle = gr; g.fillRect(x, y, C, C);
      for (let i = 0; i < 3; i++) {
        const lx = x + C * (0.28 + i * 0.22), h = C * (0.34 + (i % 2) * 0.08);
        roundRect(g, lx - C * 0.06, y + C * 0.62 - h, C * 0.12, h, 10 * k);
        g.fillStyle = ['#c2185b', '#ffffff', '#8e24aa'][i]; g.fill();
        g.fillStyle = '#d4af37'; g.fillRect(lx - C * 0.065, y + C * 0.62 - h * 0.45, C * 0.13, C * 0.04);
      }
      neon(g, 'GLASS SKIN', x + C * 0.5, y + C * 0.76, Math.round(60 * k), SANS, 900, '#ffffff', { align: 'center', glow: 0.4 });
      g.font = `800 ${Math.round(28 * k)}px ${SANS}`; g.fillStyle = '#7a0d45'; g.textAlign = 'center';
      g.fillText('BIBIM BEAUTY · 비빔 뷰티', x + C * 0.5, y + C * 0.9);
      g.font = `900 ${Math.round(34 * k)}px ${SANS}`; g.fillText('K-BEAUTY', x + C * 0.5, y + C * 0.12);
    },
    (x, y) => {
      let gr = g.createLinearGradient(x, y, x, y + C);
      gr.addColorStop(0, '#05010f'); gr.addColorStop(1, '#3a0a5e');
      g.fillStyle = gr; g.fillRect(x, y, C, C);
      for (let i = 0; i < 5; i++) {
        const px = x + C * (0.18 + i * 0.16), py = y + C * 0.62;
        glowDot(g, px, py - C * 0.2, C * 0.16, ['#ff3d9a', '#3fe6ff', '#ffcf5a', '#b84dff', '#39f58a'][i], 0.45);
        g.fillStyle = '#05010f';
        g.beginPath(); g.arc(px, py - C * 0.25, C * 0.045, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.moveTo(px - C * 0.07, py + C * 0.05); g.lineTo(px - C * 0.05, py - C * 0.19); g.lineTo(px + C * 0.05, py - C * 0.19); g.lineTo(px + C * 0.07, py + C * 0.05); g.fill();
      }
      gr = g.createLinearGradient(0, y + C * 0.72, 0, y + C * 0.84);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#c0c8ff'); gr.addColorStop(1, '#ffffff');
      g.font = `900 ${Math.round(70 * k)}px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = '#b84dff'; g.shadowBlur = 20 * k; g.fillStyle = gr;
      g.fillText('NEON TIGERS', x + C * 0.5, y + C * 0.78); g.shadowBlur = 0;
      g.font = `800 ${Math.round(28 * k)}px ${SANS}`; g.fillStyle = '#ffcf5a';
      g.fillText('WORLD TOUR 2026 · MSG', x + C * 0.5, y + C * 0.9);
      g.fillText('네온타이거즈', x + C * 0.5, y + C * 0.1);
    },
    (x, y) => {
      g.fillStyle = '#ffb000'; g.fillRect(x, y, C, C);
      g.fillStyle = '#ff5a00'; g.beginPath(); g.ellipse(x + C * 0.5, y + C * 0.52, C * 0.36, C * 0.2, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e8250c'; g.beginPath(); g.ellipse(x + C * 0.5, y + C * 0.5, C * 0.32, C * 0.16, 0, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 14; i++) {
        const a = i * 0.9, rr = C * (0.05 + (i % 4) * 0.06);
        g.save(); g.translate(x + C * 0.5 + Math.cos(a) * rr * 1.5, y + C * 0.5 + Math.sin(a) * rr * 0.6); g.rotate(a);
        roundRect(g, -C * 0.07, -C * 0.022, C * 0.14, C * 0.044, C * 0.02); g.fillStyle = '#ff7b5c'; g.fill(); g.restore();
      }
      neon(g, '떡볶이 타임', x + C * 0.5, y + C * 0.17, Math.round(70 * k), SANS, 900, '#ffffff', { align: 'center', glow: 0.3 });
      g.font = `900 ${Math.round(32 * k)}px ${SANS}`; g.fillStyle = '#5a1000'; g.textAlign = 'center';
      g.fillText('TTEOKBOKKI TIME 🔥 매운맛 챌린지', x + C * 0.5, y + C * 0.85);
    },
    (x, y) => {
      const gr = g.createLinearGradient(x, y, x, y + C);
      gr.addColorStop(0, '#020a24'); gr.addColorStop(1, '#14306e');
      g.fillStyle = gr; g.fillRect(x, y, C, C);
      glowDot(g, x + C * 0.7, y + C * 0.25, C * 0.25, '#fff3c4', 0.5);
      g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(x + C * 0.7, y + C * 0.25, C * 0.1, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#020a24'; g.beginPath(); g.arc(x + C * 0.66, y + C * 0.22, C * 0.09, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#01040f';
      g.beginPath(); g.arc(x + C * 0.38, y + C * 0.5, C * 0.06, 0, Math.PI * 2); g.fill();
      g.fillRect(x + C * 0.32, y + C * 0.56, C * 0.12, C * 0.2);
      g.beginPath(); g.arc(x + C * 0.55, y + C * 0.52, C * 0.055, 0, Math.PI * 2); g.fill();
      g.fillRect(x + C * 0.5, y + C * 0.575, C * 0.11, C * 0.18);
      neon(g, '달빛 카페', x + C * 0.5, y + C * 0.83, Math.round(64 * k), SANS, 900, '#ffe7a3', { align: 'center', glow: 0.5 });
      g.font = `800 ${Math.round(24 * k)}px ${SANS}`; g.fillStyle = '#9fc4ff'; g.textAlign = 'center';
      g.fillText('K-DRAMA · NOW STREAMING', x + C * 0.5, y + C * 0.94);
    },
    (x, y) => {
      const gr = g.createLinearGradient(x, y, x + C, y);
      gr.addColorStop(0, '#003b1f'); gr.addColorStop(1, '#00843d');
      g.fillStyle = gr; g.fillRect(x, y, C, C);
      for (let i = 0; i < 2; i++) {
        const bx = x + C * (0.32 + i * 0.32), by = y + C * 0.2;
        roundRect(g, bx - C * 0.07, by + C * 0.14, C * 0.14, C * 0.42, 12 * k);
        g.fillStyle = 'rgba(120,255,170,0.75)'; g.fill();
        g.fillStyle = 'rgba(120,255,170,0.75)'; g.fillRect(bx - C * 0.03, by, C * 0.06, C * 0.16);
        g.fillStyle = '#ffffff'; g.fillRect(bx - C * 0.07, by + C * 0.32, C * 0.14, C * 0.1);
        g.fillStyle = '#00843d'; g.font = `900 ${Math.round(22 * k)}px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('소주', bx, by + C * 0.37);
      }
      neon(g, '짠! CHEERS', x + C * 0.5, y + C * 0.8, Math.round(64 * k), SANS, 900, '#ffffff', { align: 'center', glow: 0.3 });
      g.font = `800 ${Math.round(26 * k)}px ${SANS}`; g.fillStyle = '#c6ffd9'; g.fillText('SOJU NIGHT · 한강 감성', x + C * 0.5, y + C * 0.92);
    },
    (x, y) => {
      const gr = g.createRadialGradient(x + C * 0.5, y + C * 0.45, 10, x + C * 0.5, y + C * 0.45, C * 0.7);
      gr.addColorStop(0, '#3a2a06'); gr.addColorStop(1, '#0a0702');
      g.fillStyle = gr; g.fillRect(x, y, C, C);
      for (let s = 0; s < 3; s++) {
        for (let i = 0; i < 5 - s; i++) {
          const cx = x + C * (0.3 + s * 0.2), cy = y + C * (0.6 - i * 0.065);
          g.fillStyle = '#b8860b'; g.beginPath(); g.ellipse(cx, cy + 4 * k, C * 0.09, C * 0.03, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#ffd56a'; g.beginPath(); g.ellipse(cx, cy, C * 0.09, C * 0.03, 0, 0, Math.PI * 2); g.fill();
        }
      }
      neon(g, '한강은행', x + C * 0.5, y + C * 0.18, Math.round(70 * k), SANS, 900, '#ffcf5a', { align: 'center', glow: 0.6 });
      g.font = `800 ${Math.round(28 * k)}px ${SANS}`; g.fillStyle = '#fff3c4'; g.textAlign = 'center';
      g.fillText('HAN RIVER BANK', x + C * 0.5, y + C * 0.8);
      g.fillText('코인 모아 전광판 점령!', x + C * 0.5, y + C * 0.9);
    },
    (x, y) => {
      g.fillStyle = '#c8102e'; g.fillRect(x, y, C, C);
      for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#a50d26' : '#c8102e'; g.beginPath(); g.moveTo(x + C / 2, y + C * 0.55); g.arc(x + C / 2, y + C * 0.55, C, (i / 12) * Math.PI * 2, ((i + 1) / 12) * Math.PI * 2); g.fill(); }
      g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(x + C * 0.3, y + C * 0.35); g.lineTo(x + C * 0.7, y + C * 0.35); g.lineTo(x + C * 0.64, y + C * 0.75); g.lineTo(x + C * 0.36, y + C * 0.75); g.closePath(); g.fill();
      g.fillStyle = '#ffcf5a'; g.fillRect(x + C * 0.3, y + C * 0.33, C * 0.4, C * 0.05);
      g.fillStyle = '#c8102e'; g.font = `900 ${Math.round(46 * k)}px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('辛라면', x + C * 0.5, y + C * 0.55);
      for (let i = 0; i < 3; i++) { g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 6 * k; g.beginPath(); g.moveTo(x + C * (0.42 + i * 0.08), y + C * 0.3); g.bezierCurveTo(x + C * (0.36 + i * 0.08), y + C * 0.22, x + C * (0.48 + i * 0.08), y + C * 0.18, x + C * (0.42 + i * 0.08), y + C * 0.1); g.stroke(); }
      neon(g, 'MEGA RAMEN', x + C * 0.5, y + C * 0.86, Math.round(58 * k), SANS, 900, '#ffffff', { align: 'center', glow: 0.3 });
    },
    (x, y) => {
      const gr = g.createLinearGradient(x, y, x + C, y + C);
      gr.addColorStop(0, '#ffe3ec'); gr.addColorStop(0.5, '#e8d7ff'); gr.addColorStop(1, '#c9f0ff');
      g.fillStyle = gr; g.fillRect(x, y, C, C);
      g.fillStyle = '#ff5c8a'; g.beginPath(); g.moveTo(x + C * 0.5, y + C * 0.2); g.quadraticCurveTo(x + C * 0.2, y + C * 0.55, x + C * 0.26, y + C * 0.78); g.lineTo(x + C * 0.74, y + C * 0.78); g.quadraticCurveTo(x + C * 0.8, y + C * 0.55, x + C * 0.5, y + C * 0.2); g.fill();
      g.fillStyle = '#3b6fd8'; g.fillRect(x + C * 0.38, y + C * 0.24, C * 0.24, C * 0.16);
      g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(x + C * 0.42, y + C * 0.24); g.lineTo(x + C * 0.5, y + C * 0.34); g.lineTo(x + C * 0.58, y + C * 0.24); g.fill();
      g.fillStyle = '#3a1d4a'; g.font = `900 ${Math.round(56 * k)}px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('한복 스트리트', x + C * 0.5, y + C * 0.87);
      g.font = `800 ${Math.round(24 * k)}px ${SANS}`; g.fillText('HANBOK STREET · NEW SEASON', x + C * 0.5, y + C * 0.1);
    },
    (x, y) => {
      g.fillStyle = '#05030f'; g.fillRect(x, y, C, C);
      for (let i = 0; i < 14; i++) { g.strokeStyle = i % 2 ? 'rgba(63,230,255,0.5)' : 'rgba(184,77,255,0.5)'; g.lineWidth = 2 * k; g.beginPath(); g.moveTo(x, y + C * (0.1 + i * 0.065)); g.lineTo(x + C, y + C * (0.05 + i * 0.07)); g.stroke(); }
      g.fillStyle = '#ffcf5a';
      g.beginPath(); g.moveTo(x + C * 0.38, y + C * 0.22); g.lineTo(x + C * 0.62, y + C * 0.22); g.quadraticCurveTo(x + C * 0.62, y + C * 0.5, x + C * 0.5, y + C * 0.52); g.quadraticCurveTo(x + C * 0.38, y + C * 0.5, x + C * 0.38, y + C * 0.22); g.fill();
      g.fillRect(x + C * 0.47, y + C * 0.52, C * 0.06, C * 0.1); g.fillRect(x + C * 0.4, y + C * 0.62, C * 0.2, C * 0.05);
      neon(g, 'K-ESPORTS', x + C * 0.5, y + C * 0.76, Math.round(64 * k), SANS, 900, '#3fe6ff', { align: 'center', glow: 0.9 });
      g.font = `800 ${Math.round(26 * k)}px ${SANS}`; g.fillStyle = '#ffffff'; g.textAlign = 'center';
      g.fillText('월드 결승전 · 오늘 밤 9시', x + C * 0.5, y + C * 0.89);
    },
    (x, y) => {
      g.fillStyle = '#1e3a2a'; g.fillRect(x, y, C, C);
      g.fillStyle = '#2b2b2b'; g.beginPath(); g.ellipse(x + C * 0.5, y + C * 0.5, C * 0.36, C * 0.2, 0, 0, Math.PI); g.fill();
      g.fillStyle = '#f2efe6'; g.beginPath(); g.ellipse(x + C * 0.5, y + C * 0.5, C * 0.36, C * 0.12, 0, 0, Math.PI * 2); g.fill();
      const tops = ['#e8590c', '#2f9e44', '#f08c00', '#c92a2a', '#7950f2', '#ffd43b'];
      tops.forEach((c, i) => { const a = (i / tops.length) * Math.PI * 2; g.fillStyle = c; g.beginPath(); g.ellipse(x + C * 0.5 + Math.cos(a) * C * 0.2, y + C * 0.5 + Math.sin(a) * C * 0.065, C * 0.08, C * 0.035, 0, 0, Math.PI * 2); g.fill(); });
      g.fillStyle = '#ffd43b'; g.beginPath(); g.ellipse(x + C * 0.5, y + C * 0.49, C * 0.05, C * 0.03, 0, 0, Math.PI * 2); g.fill();
      neon(g, '비빔밥 익스프레스', x + C * 0.5, y + C * 0.2, Math.round(50 * k), SANS, 900, '#ffffff', { align: 'center', glow: 0.3 });
      g.font = `800 ${Math.round(28 * k)}px ${SANS}`; g.fillStyle = '#b2f2bb'; g.textAlign = 'center'; g.fillText('BIBIMBAP EXPRESS · 5분 배달', x + C * 0.5, y + C * 0.84);
    },
    (x, y) => {
      g.fillStyle = '#ffffff'; g.fillRect(x, y, C, C);
      g.fillStyle = '#00a651'; g.fillRect(x, y + C * 0.62, C, C * 0.1);
      g.fillStyle = '#0072bc'; g.fillRect(x, y + C * 0.72, C, C * 0.1);
      g.fillStyle = '#ff6a00'; g.fillRect(x, y + C * 0.82, C, C * 0.06);
      neon(g, 'SEOUL', x + C * 0.5, y + C * 0.24, Math.round(86 * k), SANS, 900, '#0072bc', { align: 'center', glow: 0, stroke: false, grad: false });
      neon(g, 'MART 24', x + C * 0.5, y + C * 0.42, Math.round(80 * k), SANS, 900, '#00a651', { align: 'center', glow: 0, stroke: false, grad: false });
      g.font = `900 ${Math.round(28 * k)}px ${SANS}`; g.fillStyle = '#222'; g.textAlign = 'center'; g.fillText('삼각김밥 1+1 · 바나나우유', x + C * 0.5, y + C * 0.55);
    },
    (x, y) => {
      g.fillStyle = '#0a0014'; g.fillRect(x, y, C, C);
      for (let i = 0; i < 16; i++) {
        const hgt = C * (0.12 + Math.abs(Math.sin(i * 1.7)) * 0.38);
        const gr = g.createLinearGradient(0, y + C * 0.72 - hgt, 0, y + C * 0.72);
        gr.addColorStop(0, '#ff3d9a'); gr.addColorStop(1, '#3fe6ff');
        g.fillStyle = gr; g.fillRect(x + C * (0.08 + i * 0.053), y + C * 0.72 - hgt, C * 0.038, hgt);
      }
      neon(g, 'NEON BEATS', x + C * 0.5, y + C * 0.16, Math.round(64 * k), SANS, 900, '#ff7ac0', { align: 'center', glow: 0.9 });
      g.font = `900 ${Math.round(40 * k)}px ${SANS}`; g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.fillText('104.7 FM', x + C * 0.5, y + C * 0.84);
    },
    (x, y) => {
      g.fillStyle = '#fff9db'; g.fillRect(x, y, C, C);
      g.strokeStyle = '#222'; g.lineWidth = 6 * k;
      for (const [px, py, pw, ph] of [[0.06, 0.06, 0.42, 0.4], [0.52, 0.06, 0.42, 0.4], [0.06, 0.5, 0.88, 0.28]]) { g.fillStyle = ['#d0ebff', '#ffe3e3', '#e6fcf5'][Math.round(px * 10) % 3]; g.fillRect(x + C * px, y + C * py, C * pw, C * ph); g.strokeRect(x + C * px, y + C * py, C * pw, C * ph); }
      g.fillStyle = '#ffffff'; roundRect(g, x + C * 0.12, y + C * 0.12, C * 0.3, C * 0.14, 20 * k); g.fill(); g.stroke();
      g.fillStyle = '#222'; g.font = `900 ${Math.round(26 * k)}px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('뉴욕 도착!', x + C * 0.27, y + C * 0.19);
      g.font = `${Math.round(70 * k)}px ${EMOJI}`; g.fillText('🗽', x + C * 0.73, y + C * 0.27); g.fillText('😎', x + C * 0.3, y + C * 0.37);
      neon(g, '오늘의 웹툰', x + C * 0.5, y + C * 0.64, Math.round(60 * k), SANS, 900, '#ff3d9a', { align: 'center', glow: 0.2 });
      g.fillStyle = '#222'; g.font = `800 ${Math.round(26 * k)}px ${SANS}`; g.fillText('PIXEL WEBTOON · 매일 업데이트', x + C * 0.5, y + C * 0.89);
    },
    (x, y) => {
      g.fillStyle = '#111111'; g.fillRect(x, y, C, C);
      roundRect(g, x + C * 0.34, y + C * 0.12, C * 0.32, C * 0.62, 28 * k);
      const gr = g.createLinearGradient(x + C * 0.34, 0, x + C * 0.66, 0);
      gr.addColorStop(0, '#c85a00'); gr.addColorStop(0.4, '#ffb000'); gr.addColorStop(1, '#a04400');
      g.fillStyle = gr; g.fill();
      g.save(); g.clip();
      g.fillStyle = '#111111';
      for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(x + C * 0.34, y + C * (0.18 + i * 0.1)); g.lineTo(x + C * 0.5, y + C * (0.2 + i * 0.1)); g.lineTo(x + C * 0.34, y + C * (0.24 + i * 0.1)); g.fill(); g.beginPath(); g.moveTo(x + C * 0.66, y + C * (0.22 + i * 0.1)); g.lineTo(x + C * 0.52, y + C * (0.25 + i * 0.1)); g.lineTo(x + C * 0.66, y + C * (0.28 + i * 0.1)); g.fill(); }
      g.restore();
      neon(g, 'TIGER', x + C * 0.5, y + C * 0.82, Math.round(70 * k), SANS, 900, '#ffb000', { align: 'center', glow: 0.8 });
      g.font = `800 ${Math.round(24 * k)}px ${SANS}`; g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.fillText('호랑이 에너지 · ENERGY', x + C * 0.5, y + C * 0.93);
    },
  ];
  ads.forEach((fn, i) => {
    const x = (i % 4) * C, y = Math.floor(i / 4) * C;
    if (y + C > canvas.height) return;
    g.save();
    g.beginPath();
    g.rect(x, y, C, C);
    g.clip();
    fn(x, y);
    g.restore();
    const u0 = (x + 2) / canvas.width, u1 = (x + C - 2) / canvas.width;
    const v1 = 1 - (y + 2) / canvas.height, v0 = 1 - (y + C - 2) / canvas.height;
    cells.push([u0, v0, u1, v1]);
  });
  return cells;
}

/** Storefront strip (glowing shop windows and signs), tiles horizontally. */
export function paintStorefronts(canvas) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = H / 256;
  const r = rng(91);
  g.fillStyle = '#0c0b10';
  g.fillRect(0, 0, W, H);
  const shops = [['K-MART', '#ff3d9a'], ['CAFE 서울', '#ffcf5a'], ['GIFTS', '#3fe6ff'], ['치킨&맥주', '#ff6a3d'], ['K-POP STORE', '#b84dff'], ['편의점 24', '#39f58a'], ['PHARMACY', '#ffffff'], ['노래방', '#ff3d9a']];
  const n = shops.length, sw = W / n;
  shops.forEach(([name, col], i) => {
    const x = i * sw;
    const gr = g.createLinearGradient(0, 70 * k, 0, H);
    gr.addColorStop(0, '#fff1d6');
    gr.addColorStop(1, '#f2b46b');
    g.fillStyle = gr;
    g.fillRect(x + 10 * k, 76 * k, sw - 20 * k, H - 86 * k);
    g.fillStyle = 'rgba(40,20,10,0.5)';
    for (let j = 0; j < 5; j++) g.fillRect(x + 18 * k + r() * (sw - 60 * k), 110 * k + r() * 100 * k, 18 * k + r() * 30 * k, 40 * k + r() * 60 * k);
    g.fillStyle = '#16141c';
    g.fillRect(x + sw / 2 - 2 * k, 76 * k, 4 * k, H - 76 * k);
    g.fillStyle = '#111018';
    g.fillRect(x + 4 * k, 8 * k, sw - 8 * k, 60 * k);
    const s = fit(g, name, sw - 30 * k, 40 * k, 900, SANS, 14 * k);
    neon(g, name, x + sw / 2, 40 * k, s, SANS, 900, col, { align: 'center', glow: 0.8, stroke: false });
  });
  return canvas;
}

/** Window grid for tower facades: returns [albedo, emissive] canvases. */
export function paintWindows(kind, seed = 7) {
  const S = 512;
  const a = makeCanvas(S, S), e = makeCanvas(S, S);
  const ga = a.getContext('2d'), ge = e.getContext('2d');
  const r = rng(seed);
  const cols = 12, rows = 20, cw = S / cols, rh = S / rows;
  ga.fillStyle = kind === 'stone' ? '#3a332e' : '#0d1422';
  ga.fillRect(0, 0, S, S);
  ge.fillStyle = '#000000';
  ge.fillRect(0, 0, S, S);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = i * cw, y = j * rh;
      const px = kind === 'stone' ? cw * 0.22 : cw * 0.06, py = kind === 'stone' ? rh * 0.2 : rh * 0.1;
      ga.fillStyle = kind === 'stone' ? '#141820' : (r() < 0.5 ? '#16243a' : '#1b2c46');
      ga.fillRect(x + px, y + py, cw - px * 2, rh - py * 2);
      const lit = r();
      if (lit < 0.3) {
        const warm = r() < 0.65;
        const v = 0.45 + r() * 0.55;
        ge.fillStyle = warm ? `rgba(255,${190 + r() * 40 | 0},${110 + r() * 50 | 0},${v})` : `rgba(${170 + r() * 40 | 0},${210 + r() * 30 | 0},255,${v})`;
        ge.fillRect(x + px, y + py, cw - px * 2, rh - py * 2);
        if (r() < 0.5) { ge.fillStyle = 'rgba(0,0,0,0.5)'; ge.fillRect(x + px, y + py + (rh - py * 2) * 0.55, cw - px * 2, (rh - py * 2) * 0.45); }
      }
    }
  }
  if (kind !== 'stone') {
    ga.fillStyle = '#2a3446';
    for (let i = 0; i <= cols; i++) ga.fillRect(i * cw - 1, 0, 2, S);
    for (let j = 0; j <= rows; j++) ga.fillRect(0, j * rh - 1, S, 2);
  }
  return [a, e];
}

export function paintGlow(canvas, inner = 'rgba(255,255,255,1)') {
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const gr = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, W);
  return canvas;
}

export function paintBeam(canvas) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const gx = g.createLinearGradient(0, 0, W, 0);
  gx.addColorStop(0, 'rgba(255,255,255,0)');
  gx.addColorStop(0.5, 'rgba(255,255,255,1)');
  gx.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gx;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'destination-in';
  const gy = g.createLinearGradient(0, 0, 0, H);
  gy.addColorStop(0, 'rgba(0,0,0,0)');
  gy.addColorStop(0.7, 'rgba(0,0,0,0.6)');
  gy.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = gy;
  g.fillRect(0, 0, W, H);
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

export function paintManhole(canvas) {
  const g = canvas.getContext('2d');
  const S = canvas.width, c = S / 2;
  g.clearRect(0, 0, S, S);
  g.fillStyle = '#26282c';
  g.beginPath();
  g.arc(c, c, c - 2, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#3c3f45';
  g.lineWidth = S * 0.04;
  g.stroke();
  g.save();
  g.beginPath();
  g.arc(c, c, c * 0.84, 0, Math.PI * 2);
  g.clip();
  g.strokeStyle = '#3a3d43';
  g.lineWidth = S * 0.018;
  for (let i = -S; i < S * 2; i += S * 0.07) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S, S); g.stroke();
    g.beginPath(); g.moveTo(i + S, 0); g.lineTo(i, S); g.stroke();
  }
  g.restore();
  g.fillStyle = '#4a4d54';
  g.font = `900 ${Math.round(S * 0.09)}px ${SANS}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('NYC SEWER', c, c);
  return canvas;
}

/** Road paint: dashed lane lines + edge lines on a transparent strip (u across road, v along). */
export function paintLanes(canvas, lanes) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  const line = (u, dashed, color, width) => {
    g.fillStyle = color;
    const x = u * W - width / 2;
    if (!dashed) { g.fillRect(x, 0, width, H); return; }
    for (let y = 0; y < H; y += H / 4) g.fillRect(x, y + H * 0.02, width, H / 8);
  };
  for (const l of lanes) line(l.u, l.dashed, l.color, l.w || 6);
  const r = rng(5);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.6})`;
    g.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3);
  }
  return canvas;
}

export function paintCrosswalk(canvas) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(240,240,236,0.92)';
  const bars = 8;
  for (let i = 0; i < bars; i++) g.fillRect((i + 0.2) * W / bars, 0, W / bars * 0.55, H);
  const r = rng(11);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.7})`;
    g.fillRect(r() * W, r() * H, 1 + r() * 4, 1 + r() * 4);
  }
  return canvas;
}

export function paintNameTag(canvas, name, color = '#3fe6ff', mine = false) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = H / 64;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  const text = chars(name || '익명', 12);
  g.font = `800 ${Math.round(28 * k)}px ${SANS}`;
  const tw = Math.min(W - 60 * k, g.measureText(text).width);
  const pw = tw + 52 * k, x = (W - pw) / 2;
  roundRect(g, x, 8 * k, pw, 46 * k, 23 * k);
  g.fillStyle = mine ? 'rgba(40,24,4,0.82)' : 'rgba(6,8,22,0.74)';
  g.fill();
  g.lineWidth = 2.5 * k;
  g.strokeStyle = mine ? '#ffcf5a' : rgba(color, 0.9);
  g.stroke();
  g.fillStyle = color;
  g.beginPath();
  g.arc(x + 22 * k, 31 * k, 7 * k, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(text, x + 36 * k, 32 * k, tw);
  return canvas;
}

export function paintBubble(canvas, glyph) {
  const g = canvas.getContext('2d');
  const S = canvas.width, k = S / 128;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, S, S);
  roundRect(g, 10 * k, 8 * k, 108 * k, 96 * k, 30 * k);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.fill();
  g.beginPath();
  g.moveTo(54 * k, 100 * k);
  g.lineTo(64 * k, 120 * k);
  g.lineTo(74 * k, 100 * k);
  g.fill();
  g.font = `${Math.round(64 * k)}px ${EMOJI}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(glyph, 64 * k, 58 * k);
  return canvas;
}

export function paintPlotBadge(canvas, id, level, color) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = H / 128;
  g.clearRect(0, 0, W, H);
  roundRect(g, 4 * k, 4 * k, W - 8 * k, H - 8 * k, 16 * k);
  g.fillStyle = 'rgba(8,8,18,0.88)';
  g.fill();
  g.lineWidth = 4 * k;
  g.strokeStyle = color;
  g.stroke();
  g.fillStyle = color;
  g.font = `900 ${Math.round(58 * k)}px ${SANS}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(`${id}번 토지`, W / 2, H * 0.4);
  g.fillStyle = '#ffffff';
  g.font = `800 ${Math.round(26 * k)}px ${SANS}`;
  g.fillText(level === 0 ? '분양 중 · FOR SALE' : '분양 완료', W / 2, H * 0.76);
  return canvas;
}

/** Round map/world marker icon: emoji in a glowing ring. */
export function paintMarker(canvas, glyph, color) {
  const g = canvas.getContext('2d');
  const S = canvas.width, c = S / 2;
  g.clearRect(0, 0, S, S);
  glowDot(g, c, c, c, color, 0.55);
  g.beginPath();
  g.arc(c, c, c * 0.62, 0, Math.PI * 2);
  g.fillStyle = 'rgba(6,8,22,0.88)';
  g.fill();
  g.lineWidth = S * 0.05;
  g.strokeStyle = color;
  g.stroke();
  g.font = `${Math.round(S * 0.5)}px ${EMOJI}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(glyph, c, c * 1.04);
  return canvas;
}

export function paintTaxiStand(canvas) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = W / 256;
  g.fillStyle = '#111114';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffc21a';
  g.fillRect(8 * k, 8 * k, W - 16 * k, H * 0.46);
  g.fillStyle = '#111114';
  g.font = `900 ${Math.round(70 * k)}px ${SANS}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('TAXI', W / 2, H * 0.25);
  g.fillStyle = '#ffc21a';
  g.font = `900 ${Math.round(40 * k)}px ${SANS}`;
  g.fillText('택시 승강장', W / 2, H * 0.66);
  g.font = `700 ${Math.round(22 * k)}px ${SANS}`;
  g.fillStyle = '#ffffff';
  g.fillText('E 키로 호출', W / 2, H * 0.86);
  return canvas;
}

/** Waits for the Pretendard weights the canvases use (and the glyph subsets for `text`). */
export function fontsReady(text = '타임스퀘어 붕어빵 전광판 점령 코인') {
  if (!document.fonts?.load) return Promise.resolve();
  const sample = String(text || '').slice(0, 80) || 'A';
  return Promise.all([700, 800, 900].map(w => document.fonts.load(`${w} 64px "Pretendard Variable"`, sample))).catch(() => {});
}
