const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = new Uint8Array(4 + data.length);
  body.set(new TextEncoder().encode(type), 0);
  body.set(data, 4);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc(body));
  return out;
}
export async function renderCardPng(card) {
  const w = 600, h = 315;
  const raw = new Uint8Array((w * 3 + 1) * h);
  const gold = card?.tier === 'S';
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1);
    raw[o] = 0;
    for (let x = 0; x < w; x++) {
      const i = o + 1 + x * 3;
      const bar = y < 28;
      raw[i] = bar ? (gold ? 245 : 126) : 18;
      raw[i + 1] = bar ? (gold ? 193 : 224) : 24;
      raw[i + 2] = bar ? (gold ? 108 : 255) : 44;
    }
  }
  const text = [card?.name, card?.line1, card?.line2, card?.line3].map((s) => String(s || '')).join('\n');
  let i = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const gx = 16 + (i % 24) * 10;
    const gy = 48 + Math.floor(i / 24) * 10;
    for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) {
      if (((code >> ((dx + dy) % 15)) & 1) === 0) continue;
      const x = gx + dx, y = gy + dy;
      if (x >= w || y >= h) continue;
      const p = y * (w * 3 + 1) + 1 + x * 3;
      raw[p] = 255; raw[p + 1] = 255; raw[p + 2] = 255;
    }
    i += 1;
  }
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
  const z = new Uint8Array(await new Response(stream).arrayBuffer());
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w); iv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array())];
  const len = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(len);
  let at = 0;
  for (const p of parts) { png.set(p, at); at += p.length; }
  if (png.length > 40000) throw new Error('card png over 40KB');
  return png;
}
