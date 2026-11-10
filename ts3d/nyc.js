// Manhattan city data (© OpenStreetMap contributors, ODbL) decoded from /assets/nyc/manhattan.bin
// (written by tools/build-nyc.mjs) plus the lookups the game needs: tiles, wall collision,
// camera occlusion, nearest street, map labels and the drivable road graph.
export const TILE = 200;
const CELL = 16;
const RCELL = 40;

export const ROAD = { MOTORWAY: 0, PRIMARY: 1, SECONDARY: 2, TERTIARY: 3, STREET: 4, SERVICE: 5, PEDESTRIAN: 6, LINK: 7 };
export const AREA = { PARK: 1, WATER: 2, PLAZA: 3, WOOD: 4, PIER: 5, PITCH: 6, CEMETERY: 7 };

const tkey = (tx, tz) => (tx + 1000) * 4000 + (tz + 1000);
const ckey = (cx, cz) => (cx + 20000) * 60000 + (cz + 20000);

async function readAll(res, onProgress) {
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export async function loadNYC(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`city data ${res.status}`);
  let bytes = await readAll(res, onProgress);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return createNYC(bytes);
}

function decode(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const td = new TextDecoder();
  if (td.decode(u8.subarray(0, 4)) !== 'KTS1') throw new Error('bad city data');
  let o = 4;
  const u16 = () => { const v = dv.getUint16(o, true); o += 2; return v; };
  const i16 = () => { const v = dv.getInt16(o, true); o += 2; return v; };
  const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
  const i32 = () => { const v = dv.getInt32(o, true); o += 4; return v; };
  const f64 = () => { const v = dv.getFloat64(o, true); o += 8; return v; };
  u32();
  const lat0 = f64(), lon0 = f64(), theta = f64();
  const bounds = { x0: i32() / 10, z0: i32() / 10, x1: i32() / 10, z1: i32() / 10 };
  const names = new Array(u32());
  for (let i = 0; i < names.length; i++) { const n = u16(); names[i] = td.decode(u8.subarray(o, o + n)); o += n; }

  /** Polygon/polyline section: header bytes, offset/width of the point count, per-record header reader. */
  function section(hdr, nAt, wide, onHead) {
    const count = u32();
    const start = o;
    let total = 0;
    for (let i = 0; i < count; i++) {
      const n = wide ? dv.getUint32(o + nAt, true) : dv.getUint16(o + nAt, true);
      total += n;
      o += hdr + 8 + (n - 1) * 4;
    }
    o = start;
    const xs = new Float32Array(total), zs = new Float32Array(total), off = new Uint32Array(count + 1);
    let p = 0;
    for (let i = 0; i < count; i++) {
      const n = wide ? dv.getUint32(o + nAt, true) : dv.getUint16(o + nAt, true);
      onHead(i, o);
      o += hdr;
      let x = i32(), z = i32();
      off[i] = p;
      xs[p] = x / 10; zs[p] = z / 10; p++;
      for (let k = 1; k < n; k++) { x += i16(); z += i16(); xs[p] = x / 10; zs[p] = z / 10; p++; }
    }
    off[count] = p;
    return { count, xs, zs, off };
  }

  let nb = dv.getUint32(o, true);
  const bH = new Float32Array(nb), bMin = new Float32Array(nb), bRoof = new Float32Array(nb);
  const bFlags = new Uint8Array(nb), bStyle = new Uint8Array(nb), bColor = new Uint16Array(nb);
  const B = section(12, 0, false, (i, h) => {
    bH[i] = dv.getUint16(h + 2, true) / 10; bMin[i] = dv.getUint16(h + 4, true) / 10; bRoof[i] = dv.getUint16(h + 6, true) / 10;
    bFlags[i] = dv.getUint8(h + 8); bStyle[i] = dv.getUint8(h + 9); bColor[i] = dv.getUint16(h + 10, true);
  });
  Object.assign(B, { h: bH, minh: bMin, roof: bRoof, flags: bFlags, style: bStyle, color: bColor });

  nb = dv.getUint32(o, true);
  const rCls = new Uint8Array(nb), rLanes = new Uint8Array(nb), rOne = new Int8Array(nb), rFlags = new Uint8Array(nb), rWidth = new Float32Array(nb), rName = new Uint16Array(nb);
  const R = section(9, 0, false, (i, h) => {
    rCls[i] = dv.getUint8(h + 2); rLanes[i] = dv.getUint8(h + 3); rOne[i] = dv.getInt8(h + 4); rFlags[i] = dv.getUint8(h + 5);
    rWidth[i] = dv.getUint8(h + 6) / 4; rName[i] = dv.getUint16(h + 7, true);
  });
  Object.assign(R, { cls: rCls, lanes: rLanes, oneway: rOne, flags: rFlags, width: rWidth, name: rName });

  nb = dv.getUint32(o, true);
  const aKind = new Uint8Array(nb);
  const Ar = section(5, 1, true, (i, h) => { aKind[i] = dv.getUint8(h); });
  Ar.kind = aKind;

  nb = dv.getUint32(o, true);
  const cClosed = new Uint8Array(nb);
  const C = section(5, 1, true, (i, h) => { cClosed[i] = dv.getUint8(h); });
  C.closed = cClosed;

  const pts = () => {
    const n = u32();
    const xs = new Float32Array(n), zs = new Float32Array(n);
    for (let i = 0; i < n; i++) { xs[i] = i32() / 10; zs[i] = i32() / 10; }
    return { count: n, xs, zs };
  };
  const signals = pts();
  const entrances = pts();
  return { lat0, lon0, theta, bounds, names, buildings: B, roads: R, areas: Ar, coast: C, signals, entrances };
}

export function createNYC(bytes) {
  const d = decode(bytes);
  const { buildings: B, roads: R, areas: Ar, coast: C } = d;

  // ---- per-building bounds and tiles -----------------------------------------------------------
  const bcx = new Float32Array(B.count), bcz = new Float32Array(B.count), brad = new Float32Array(B.count);
  const bx0 = new Float32Array(B.count), bx1 = new Float32Array(B.count), bz0 = new Float32Array(B.count), bz1 = new Float32Array(B.count);
  const tiles = new Map();
  const tileOf = (tx, tz) => {
    const k = tkey(tx, tz);
    let t = tiles.get(k);
    if (!t) { t = { tx, tz, key: k, b: [], seg: [] }; tiles.set(k, t); }
    return t;
  };
  for (let i = 0; i < B.count; i++) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, sx = 0, sz = 0;
    const a = B.off[i], b = B.off[i + 1];
    for (let p = a; p < b; p++) {
      const x = B.xs[p], z = B.zs[p];
      sx += x; sz += z;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    bcx[i] = sx / (b - a); bcz[i] = sz / (b - a);
    bx0[i] = x0; bx1[i] = x1; bz0[i] = z0; bz1[i] = z1;
    brad[i] = Math.hypot(x1 - x0, z1 - z0) / 2;
    tileOf(Math.floor(bcx[i] / TILE), Math.floor(bcz[i] / TILE)).b.push(i);
  }
  Object.assign(B, { cx: bcx, cz: bcz, rad: brad, x0: bx0, x1: bx1, z0: bz0, z1: bz1 });

  // ---- road segments: tile lists + nearest-street grid -------------------------------------------
  const segRoad = new Int32Array(R.xs.length).fill(-1);
  const rgrid = new Map();
  for (let r = 0; r < R.count; r++) {
    for (let p = R.off[r]; p < R.off[r + 1] - 1; p++) {
      segRoad[p] = r;
      const mx = (R.xs[p] + R.xs[p + 1]) / 2, mz = (R.zs[p] + R.zs[p + 1]) / 2;
      tileOf(Math.floor(mx / TILE), Math.floor(mz / TILE)).seg.push(p);
      const pad = R.width[r] / 2;
      const cx0 = Math.floor((Math.min(R.xs[p], R.xs[p + 1]) - pad) / RCELL), cx1 = Math.floor((Math.max(R.xs[p], R.xs[p + 1]) + pad) / RCELL);
      const cz0 = Math.floor((Math.min(R.zs[p], R.zs[p + 1]) - pad) / RCELL), cz1 = Math.floor((Math.max(R.zs[p], R.zs[p + 1]) + pad) / RCELL);
      for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
        const k = ckey(cx, cz);
        let l = rgrid.get(k);
        if (!l) rgrid.set(k, (l = []));
        l.push(p);
      }
    }
  }
  R.segRoad = segRoad;

  /** Nearest road segment within maxD: { seg, road, px, pz, d, t, fx, fz }. */
  function nearestRoad(x, z, maxD = 40, filter) {
    let best = null, bd = maxD;
    const c0x = Math.floor((x - maxD) / RCELL), c1x = Math.floor((x + maxD) / RCELL), c0z = Math.floor((z - maxD) / RCELL), c1z = Math.floor((z + maxD) / RCELL);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const l = rgrid.get(ckey(cx, cz));
      if (!l) continue;
      for (const p of l) {
        const r = segRoad[p];
        if (filter && !filter(r, p)) continue;
        const ax = R.xs[p], az = R.zs[p], dx = R.xs[p + 1] - ax, dz = R.zs[p + 1] - az, L2 = dx * dx + dz * dz;
        const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
        const px = ax + dx * t, pz = az + dz * t, dd = Math.hypot(x - px, z - pz);
        if (dd < bd) { bd = dd; const L = Math.sqrt(L2) || 1; best = { seg: p, road: r, px, pz, d: dd, t, fx: dx / L, fz: dz / L }; }
      }
    }
    return best;
  }
  const roadName = (r) => d.names[R.name[r]] || '';

  // ---- wall collision / camera occlusion grid (filled lazily around the player) -----------------------
  let ex1 = new Float32Array(4096), ez1 = new Float32Array(4096), ex2 = new Float32Array(4096), ez2 = new Float32Array(4096), eh = new Float32Array(4096), emh = new Float32Array(4096);
  let stamp = new Uint32Array(4096);
  let nEdges = 0, stampV = 1;
  const egrid = new Map();
  function growEdges() {
    const n = ex1.length * 2;
    const g = (a, T = Float32Array) => { const b = new T(n); b.set(a); return b; };
    ex1 = g(ex1); ez1 = g(ez1); ex2 = g(ex2); ez2 = g(ez2); eh = g(eh); emh = g(emh); stamp = g(stamp, Uint32Array);
  }
  function addEdge(x1, z1, x2, z2, h, mh) {
    if (nEdges >= ex1.length) growEdges();
    const id = nEdges++;
    ex1[id] = x1; ez1[id] = z1; ex2[id] = x2; ez2[id] = z2; eh[id] = h; emh[id] = mh;
    const c0x = Math.floor(Math.min(x1, x2) / CELL), c1x = Math.floor(Math.max(x1, x2) / CELL);
    const c0z = Math.floor(Math.min(z1, z2) / CELL), c1z = Math.floor(Math.max(z1, z2) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      // skip cells the segment does not touch (long diagonal edges)
      if (c1x > c0x && c1z > c0z) {
        const bx0 = cx * CELL, bz0 = cz * CELL;
        if (!segBox(x1, z1, x2, z2, bx0, bz0, bx0 + CELL, bz0 + CELL)) continue;
      }
      const k = ckey(cx, cz);
      let l = egrid.get(k);
      if (!l) egrid.set(k, (l = []));
      l.push(id);
    }
  }
  function segBox(x1, z1, x2, z2, a0, b0, a1, b1) {
    let t0 = 0, t1 = 1;
    const dx = x2 - x1, dz = z2 - z1;
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    return clip(-dx, x1 - a0) && clip(dx, a1 - x1) && clip(-dz, z1 - b0) && clip(dz, b1 - z1);
  }
  // The shoreline is a wall: nobody walks or drives into the rivers.
  for (let c = 0; c < C.count; c++) {
    if (!C.closed[c]) continue;
    const a = C.off[c], b = C.off[c + 1];
    for (let p = a; p < b; p++) {
      const q = p + 1 < b ? p + 1 : a;
      addEdge(C.xs[p], C.zs[p], C.xs[q], C.zs[q], 1e4, -1e4);
    }
  }
  const solidTiles = new Set();
  const skipBuilding = new Uint8Array(B.count);
  const hideMesh = new Uint8Array(B.count); // drawn by a landmark instead; walls still collide
  function solidify(t) {
    if (solidTiles.has(t.key)) return;
    solidTiles.add(t.key);
    for (const i of t.b) {
      if (skipBuilding[i] || B.minh[i] > 2.6) continue;
      const a = B.off[i], b = B.off[i + 1], h = B.h[i];
      for (let p = a; p < b; p++) {
        const q = p + 1 < b ? p + 1 : a;
        addEdge(B.xs[p], B.zs[p], B.xs[q], B.zs[q], h, B.minh[i]);
      }
    }
  }
  let lastSolidX = 1e9, lastSolidZ = 1e9;
  function ensureSolid(x, z, radius = 320) {
    if (Math.abs(x - lastSolidX) < 60 && Math.abs(z - lastSolidZ) < 60) return;
    lastSolidX = x; lastSolidZ = z;
    const r = Math.ceil(radius / TILE);
    const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const t = tiles.get(tkey(tx + i, tz + j));
      if (t) solidify(t);
    }
  }

  /** Pushes a circle out of walls and the shoreline. */
  function collide(x, z, r) {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      stampV++;
      const c0x = Math.floor((x - r) / CELL), c1x = Math.floor((x + r) / CELL), c0z = Math.floor((z - r) / CELL), c1z = Math.floor((z + r) / CELL);
      for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
        const l = egrid.get(ckey(cx, cz));
        if (!l) continue;
        for (let k = 0; k < l.length; k++) {
          const id = l[k];
          if (stamp[id] === stampV) continue;
          stamp[id] = stampV;
          const ax = ex1[id], az = ez1[id], dx = ex2[id] - ax, dz = ez2[id] - az, L2 = dx * dx + dz * dz;
          const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
          const qx = x - (ax + dx * t), qz = z - (az + dz * t), d2 = qx * qx + qz * qz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-10) {
            const dd = Math.sqrt(d2), push = (r - dd) / dd;
            x += qx * push; z += qz * push;
          } else {
            const L = Math.sqrt(L2) || 1;
            x += (-dz / L) * r; z += (dx / L) * r;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    return [x, z];
  }

  /** First wall hit along a segment, as a fraction of its length (1 = clear). */
  function rayBlock(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 0.01) return 1;
    stampV++;
    let best = 1;
    const steps = Math.ceil(len / (CELL * 0.5));
    let lastK = -1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const k = ckey(Math.floor((ax + dx * t) / CELL), Math.floor((az + dz * t) / CELL));
      if (k === lastK) continue;
      lastK = k;
      const l = egrid.get(k);
      if (!l) continue;
      for (let q = 0; q < l.length; q++) {
        const id = l[q];
        if (stamp[id] === stampV) continue;
        stamp[id] = stampV;
        const sx = ex1[id], sz = ez1[id], ux = ex2[id] - sx, uz = ez2[id] - sz;
        const den = dx * uz - dz * ux;
        if (Math.abs(den) < 1e-9) continue;
        const wx = sx - ax, wz = sz - az;
        const u = (wx * uz - wz * ux) / den, v = (wx * dz - wz * dx) / den;
        if (u < 0 || u > best || v < 0 || v > 1) continue;
        const y = ay + (by - ay) * u;
        if (y < emh[id] - 0.2 || y > eh[id] + 0.4) continue;
        best = u;
      }
    }
    return best;
  }

  /** Building index whose footprint contains (x, z), or -1. */
  function buildingAt(x, z) {
    const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const t = tiles.get(tkey(tx + i, tz + j));
      if (!t) continue;
      for (const b of t.b) {
        if (skipBuilding[b] || B.minh[b] > 2.6 || x < B.x0[b] || x > B.x1[b] || z < B.z0[b] || z > B.z1[b]) continue;
        if (pointIn(B, b, x, z)) return b;
      }
    }
    return -1;
  }
  function pointIn(S, i, x, z) {
    let c = false;
    const a = S.off[i], b = S.off[i + 1];
    for (let p = a, q = b - 1; p < b; q = p++) {
      const pz = S.zs[p], qz = S.zs[q];
      if ((pz > z) !== (qz > z) && x < (S.xs[q] - S.xs[p]) * (z - pz) / (qz - pz) + S.xs[p]) c = !c;
    }
    return c;
  }
  const islands = [];
  for (let c = 0; c < C.count; c++) if (C.closed[c]) islands.push(c);
  function onLand(x, z) {
    for (const c of islands) if (pointIn(C, c, x, z)) return true;
    return false;
  }
  /** Closest walkable spot: outside buildings, on land, off the walls. */
  function freeSpot(x, z, r = 0.5) {
    ensureSolid(x, z, 260);
    const ok = (px, pz) => buildingAt(px, pz) < 0 && onLand(px, pz);
    if (ok(x, z)) return collide(x, z, r);
    for (let rad = 3; rad < 160; rad += 3) {
      const n = Math.max(8, Math.round(rad * 1.2));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad;
        if (ok(px, pz)) return collide(px, pz, r);
      }
    }
    return [x, z];
  }

  // ---- drivable road graph ---------------------------------------------------------------------------------
  const nodeOf = new Map();
  const nodeX = [], nodeZ = [], nodeAdj = [];
  const node = (x, z) => {
    const k = Math.round(x * 10) * 400000 + Math.round(z * 10);
    let id = nodeOf.get(k);
    if (id == null) { id = nodeX.length; nodeOf.set(k, id); nodeX.push(x); nodeZ.push(z); nodeAdj.push([]); }
    return id;
  };
  const drivable = (r) => R.cls[r] !== ROAD.PEDESTRIAN;
  // Directed lanes: seg (global point index), dir +1 = along the polyline, -1 = against it.
  for (let r = 0; r < R.count; r++) {
    if (!drivable(r)) continue;
    for (let p = R.off[r]; p < R.off[r + 1] - 1; p++) {
      const a = node(R.xs[p], R.zs[p]), b = node(R.xs[p + 1], R.zs[p + 1]);
      if (a === b) continue;
      nodeAdj[a].push({ seg: p, dir: 1, to: b, road: r });
      nodeAdj[b].push({ seg: p, dir: -1, to: a, road: r });
    }
  }
  const nodeSignal = new Uint8Array(nodeX.length);
  {
    const sg = new Map();
    for (let i = 0; i < d.signals.count; i++) {
      const k = ckey(Math.floor(d.signals.xs[i] / RCELL), Math.floor(d.signals.zs[i] / RCELL));
      let l = sg.get(k);
      if (!l) sg.set(k, (l = []));
      l.push(i);
    }
    for (let n = 0; n < nodeX.length; n++) {
      if (nodeAdj[n].length < 3) continue;
      const x = nodeX[n], z = nodeZ[n];
      let hit = false;
      for (let i = -1; i <= 1 && !hit; i++) for (let j = -1; j <= 1 && !hit; j++) {
        for (const s of sg.get(ckey(Math.floor(x / RCELL) + i, Math.floor(z / RCELL) + j)) || []) {
          if (Math.abs(d.signals.xs[s] - x) < 16 && Math.abs(d.signals.zs[s] - z) < 16) { hit = true; break; }
        }
      }
      nodeSignal[n] = hit ? 1 : 0;
    }
  }
  const graph = {
    nodeX, nodeZ, nodeAdj, nodeSignal,
    nodeAt: (x, z) => nodeOf.get(Math.round(x * 10) * 400000 + Math.round(z * 10)),
    canGo: (e) => { const r = e.road; return R.oneway[r] === 0 || e.dir === 1; },
  };

  // ---- map labels (street names along long runs) ---------------------------------------------------------------
  const labels = [];
  {
    const byName = new Map();
    for (let r = 0; r < R.count; r++) {
      const nm = R.name[r];
      if (!nm || R.cls[r] > ROAD.STREET) continue;
      let len = 0;
      for (let p = R.off[r]; p < R.off[r + 1] - 1; p++) len += Math.hypot(R.xs[p + 1] - R.xs[p], R.zs[p + 1] - R.zs[p]);
      if (!byName.has(nm)) byName.set(nm, []);
      byName.get(nm).push({ r, len });
    }
    for (const [nm, list] of byName) {
      const placed = [];
      list.sort((a, b) => b.len - a.len);
      for (const { r } of list) {
        let acc = 0;
        for (let p = R.off[r]; p < R.off[r + 1] - 1; p++) {
          const dx = R.xs[p + 1] - R.xs[p], dz = R.zs[p + 1] - R.zs[p], L = Math.hypot(dx, dz);
          acc += L;
          if (L < 30 || acc < 60) continue;
          const x = (R.xs[p] + R.xs[p + 1]) / 2, z = (R.zs[p] + R.zs[p + 1]) / 2;
          if (placed.some(q => Math.hypot(q[0] - x, q[1] - z) < 520)) continue;
          placed.push([x, z]);
          let ang = Math.atan2(dz, dx);
          if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
          labels.push({ x, z, ang, name: nm, cls: R.cls[r] });
        }
      }
    }
  }

  function tilesNear(x, z, radius) {
    const out = [];
    const r = Math.ceil(radius / TILE) + 1;
    const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const t = tiles.get(tkey(tx + i, tz + j));
      if (!t) continue;
      const cx = (t.tx + 0.5) * TILE, cz = (t.tz + 0.5) * TILE;
      const dist = Math.max(0, Math.hypot(cx - x, cz - z) - TILE * 0.7071);
      if (dist <= radius) out.push({ t, dist });
    }
    return out;
  }

  return {
    ...d,
    tiles, tilesNear, tileKey: tkey,
    nearestRoad, roadName, drivable,
    collide, rayBlock, ensureSolid, buildingAt, onLand, freeSpot, pointIn,
    skipBuilding, hideMesh,
    graph, labels,
  };
}
