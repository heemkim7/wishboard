// QR code (ISO/IEC 18004) for the board holder's shop counter. Browser-only and dependency free: byte mode (UTF-8), error correction M,
// versions 1–10 (up to 213 bytes, plenty for a /rt/card/<slot> link), mask chosen by the standard penalty score.
// qrEncode(text) -> { version, size, mask, rows } where rows[y][x] is true for a dark module. paintQr draws it with a 4-module quiet zone.

// Level M per version: [EC codewords per block, blocks in group 1, data codewords each, blocks in group 2, data codewords each].
const BLOCKS = [null, [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
export const QR_MAX_VERSION = 10;

const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
// Reed–Solomon EC codewords for one block: remainder of data(x)·x^n by the generator (x − α^0)…(x − α^(n−1)).
export function rsEc(data, n) {
  let g = [1];
  for (let i = 0; i < n; i++) { const next = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]); } g = next; }
  const r = new Array(n).fill(0);
  for (const byte of data) { const f = byte ^ r[0]; r.shift(); r.push(0); if (f) for (let j = 0; j < n; j++) r[j] ^= mul(g[j + 1], f); }
  return r;
}
const dataCw = (v) => { const b = BLOCKS[v]; return b[1] * b[2] + b[3] * b[4]; };
// 15 format bits for level M (bits 00) and this mask: BCH(15,5) with 0x537, then XOR 0x5412.
export function formatBits(mask) {
  const data = (0 << 3) | mask; let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
// 18 version bits (versions 7 and up): BCH(18,6) with 0x1f25.
export function versionBits(v) {
  let rem = v;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (v << 12) | rem;
}
const bit = (x, i) => ((x >>> i) & 1) !== 0;
const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

// The final codeword sequence: data split into blocks, EC appended per block, then both interleaved.
function codewords(bytes, v) {
  const cc = v < 10 ? 8 : 16, cap = dataCw(v) * 8, bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, cc); for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap - bits.length)); while (bits.length % 8) bits.push(0);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataCw(v); pad ^= 0xec ^ 0x11) data.push(pad);
  const [ec, n1, d1, n2, d2] = BLOCKS[v], blocks = []; let at = 0;
  for (let i = 0; i < n1 + n2; i++) { const len = i < n1 ? d1 : d2; const d = data.slice(at, at + len); at += len; blocks.push({ d, e: rsEc(d, ec) }); }
  const out = [], most = Math.max(d1, d2);
  for (let i = 0; i < most; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

function grid(v) {
  const size = 17 + 4 * v, dark = [], fn = [];
  for (let y = 0; y < size; y++) { dark.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
  const set = (x, y, on) => { dark[y][x] = on; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= size || y >= size) continue; const d = Math.max(Math.abs(dx), Math.abs(dy)); set(x, y, d !== 2 && d !== 4);
  }
  const al = ALIGN[v], last = al.length - 1;
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  if (v >= 7) { const vb = versionBits(v); for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), b = Math.floor(i / 3); set(a, b, bit(vb, i)); set(b, a, bit(vb, i)); } }
  return { size, dark, fn, set };
}
function drawFormat(g, mask) {
  const f = formatBits(mask), { size, set } = g;
  for (let i = 0; i <= 5; i++) set(8, i, bit(f, i));
  set(8, 7, bit(f, 6)); set(8, 8, bit(f, 7)); set(7, 8, bit(f, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(f, i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(f, i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(f, i));
  set(8, size - 8, true);
}
function place(g, cw) {
  const { size, dark, fn } = g; let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (!fn[y][x] && i < cw.length * 8) { dark[y][x] = bit(cw[i >>> 3], 7 - (i & 7)); i++; }
    }
  }
}
function applyMask(g, m) { const { size, dark, fn } = g, f = MASKS[m]; for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && f(x, y)) dark[y][x] = !dark[y][x]; }

// Penalty score (N1 3, N2 3, N3 40, N4 10), the finder-like run check as in the standard's reference decoder.
export function penalty(rows) {
  const size = rows.length; let score = 0;
  const addRun = (len, hist) => { if (hist[0] === 0) len += size; hist.pop(); hist.unshift(len); };
  const count = (h) => { const n = h[1], core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n; return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0); };
  const line = (get) => {
    let color = false, run = 0; const hist = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < size; i++) {
      if (get(i) === color) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
      else { addRun(run, hist); if (!color) score += count(hist) * 40; color = get(i); run = 1; }
    }
    if (color) { addRun(run, hist); run = 0; } run += size; addRun(run, hist); score += count(hist) * 40;
  };
  for (let y = 0; y < size; y++) line((x) => rows[y][x]);
  for (let x = 0; x < size; x++) line((y) => rows[y][x]);
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (rows[y][x]) dark++;
    if (x < size - 1 && y < size - 1) { const c = rows[y][x]; if (c === rows[y][x + 1] && c === rows[y + 1][x] && c === rows[y + 1][x + 1]) score += 3; }
  }
  const total = size * size; score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

// mask: force one (0–7) for tests; otherwise the lowest penalty wins (ties: the lower mask number).
export function qrEncode(text, mask = -1) {
  const bytes = [...new TextEncoder().encode(String(text ?? ''))];
  let v = 1; while (v <= QR_MAX_VERSION && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > dataCw(v) * 8) v++;
  if (v > QR_MAX_VERSION) throw new Error('qr: too long');
  const g = grid(v); drawFormat(g, 0); place(g, codewords(bytes, v)); // the format area is reserved before the data goes in
  let best = mask;
  if (!(best >= 0 && best <= 7)) {
    let low = Infinity;
    for (let m = 0; m < 8; m++) { applyMask(g, m); drawFormat(g, m); const p = penalty(g.dark); if (p < low) { low = p; best = m; } applyMask(g, m); }
  }
  applyMask(g, best); drawFormat(g, best);
  return { version: v, size: g.size, mask: best, rows: g.dark.map((r) => r.slice()) };
}

// Draws the code (black on white, 4-module quiet zone, `scale` px per module) and an optional one-line caption under it. Sets the canvas size.
export function paintQr(canvas, qr, { scale = 12, caption = '', sub = '' } = {}) {
  const quiet = 4, side = (qr.size + quiet * 2) * scale, capH = caption || sub ? Math.round(scale * 7) : 0;
  canvas.width = side; canvas.height = side + capH;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#000';
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.rows[y][x]) g.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
  if (capH) {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const fit = (text, px, weight) => { let s = px; do { g.font = `${weight} ${s}px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`; s -= 2; } while (s > 10 && g.measureText(text).width > side - scale * 4); };
    if (caption) { fit(caption, Math.round(scale * 2.6), 800); g.fillText(caption, side / 2, side + capH * (sub ? 0.32 : 0.45)); }
    if (sub) { g.fillStyle = '#444'; fit(sub, Math.round(scale * 1.5), 600); g.fillText(sub, side / 2, side + capH * (caption ? 0.74 : 0.45)); }
  }
  return canvas;
}
