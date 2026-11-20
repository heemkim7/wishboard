export function walkerPoints(n) {
  const count = Math.max(0, Math.min(24, Math.floor(Number(n) || 0)));
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ x: -70 + (i * 11) % 140, z: -140 + (i * 37) % 520 });
  }
  return out;
}

export function ghostPacket(src) {
  const pkt = { t: 'GHOST', name: String(src?.name || '').slice(0, 12), x: Number(src?.x) || 0, y: Number(src?.y) || 0 };
  if (src?.k) pkt.k = String(src.k).slice(0, 80);
  return pkt;
}
