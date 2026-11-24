// Where the bowtie's claimable faces go: the corner towers, the 50 main-street faces and the blade signs, as plain
// numbers. No three.js: timesq.js mounts what planBowtie returns, and test/board-place.test.mjs runs the same plan on
// the real map (assets/nyc/manhattan.bin) to check that no face overlaps another or sits inside a building.
// Everything here is a pure function of the map, so every client puts every board in the same place.
import { TILE } from './nyc.js?v=202611241625';
import { LAYOUT, PLAZA_CENTER, groundHeight } from './layout.js?v=202611241625';

export const STREET_OLD = 30; // STREET_1..30: chosen by distance to the street axis (unchanged since launch, but for the ones in MOVED)
export const STREET_NEW = 20; // STREET_31..50: the core of the bowtie, picked by planBowtie below
// The core the new faces stay in: the plaza players gather in, from Duffy Square to the foot of One Times Square.
export const CORE = { x: PLAZA_CENTER.x, z: PLAZA_CENTER.z, r: 120, z0: -60, z1: 190 };

// The two avenues' centre lines through the square: 7th Avenue and Broadway.
const AXES = [[-1, -250, -1, 262], [-63.4, -233, 49, 249.7]];

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function segPointDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0;
  const qx = ax + dx * t, qz = az + dz * t;
  return [Math.hypot(px - qx, pz - qz), qx, qz];
}

/** Building walls (outward normal, tangent, midpoint) inside a rectangle. */
export function wallsIn(nyc, x0, x1, z0, z1, minH = 8) {
  const B = nyc.buildings, out = [];
  for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) for (let tz = Math.floor(z0 / TILE); tz <= Math.floor(z1 / TILE); tz++) {
    const t = nyc.tiles.get(nyc.tileKey(tx, tz));
    if (!t) continue;
    for (const b of t.b) {
      if (nyc.skipBuilding[b] || B.h[b] < minH || B.minh[b] > 3) continue;
      for (let p = B.off[b], e = B.off[b + 1]; p < e; p++) {
        const q = p + 1 < e ? p + 1 : B.off[b];
        const ax = B.xs[p], az = B.zs[p], bx = B.xs[q], bz = B.zs[q];
        const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
        if (len < 5) continue;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (mx < x0 || mx > x1 || mz < z0 || mz > z1) continue;
        const nx = dz / len, nz = -dx / len;
        out.push({ b, mx, mz, nx, nz, tx: -nz, tz: nx, len, h: B.h[b] - (B.flags[b] & 1 ? B.roof[b] : 0) });
      }
    }
  }
  return out;
}
export function pickWall(list, ax, az, nx, nz, minLen, minH) {
  let best = null, bd = Infinity;
  for (const w of list) {
    if (w.len < minLen || w.h < minH || w.nx * nx + w.nz * nz < 0.75) continue;
    const d = Math.hypot(w.mx - ax, w.mz - az);
    if (d < bd) { bd = d; best = w; }
  }
  return best;
}

// ---- solids, for the placement checks ------------------------------------------------------------------------------
/** The buildings standing around the bowtie, with their bounds: the placement checks test only these. */
function solids(nyc, x0, x1, z0, z1) {
  const B = nyc.buildings, out = [];
  for (let tx = Math.floor(x0 / TILE) - 1; tx <= Math.floor(x1 / TILE) + 1; tx++) for (let tz = Math.floor(z0 / TILE) - 1; tz <= Math.floor(z1 / TILE) + 1; tz++) {
    const t = nyc.tiles.get(nyc.tileKey(tx, tz));
    if (!t) continue;
    for (const b of t.b) {
      if (nyc.skipBuilding[b]) continue;
      let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
      for (let p = B.off[b], e = B.off[b + 1]; p < e; p++) { const x = B.xs[p], z = B.zs[p]; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (z < bz0) bz0 = z; if (z > bz1) bz1 = z; }
      if (bx1 < x0 || bx0 > x1 || bz1 < z0 || bz0 > z1) continue;
      out.push({ b, x0: bx0, x1: bx1, z0: bz0, z1: bz1, h: B.h[b], minh: B.minh[b] });
    }
  }
  return out;
}
/** True when (x, z) is inside a building that fills any height between y0 and y1. */
function solidAt(nyc, list, x, z, y0, y1) {
  for (const s of list) {
    if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1 || s.h < y0 || s.minh > y1) continue;
    if (nyc.pointIn(nyc.buildings, s.b, x, z)) return true;
  }
  return false;
}
/** Metres from (ax, az) toward (bx, bz) at height y before the first building wall (the full length when clear). */
function clearRun(nyc, list, ax, az, bx, bz, y) {
  const B = nyc.buildings, dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  const lx0 = Math.min(ax, bx), lx1 = Math.max(ax, bx), lz0 = Math.min(az, bz), lz1 = Math.max(az, bz);
  let best = 1;
  for (const s of list) {
    if (s.x1 < lx0 || s.x0 > lx1 || s.z1 < lz0 || s.z0 > lz1 || s.h < y || s.minh > y) continue;
    for (let p = B.off[s.b], e = B.off[s.b + 1]; p < e; p++) {
      const q = p + 1 < e ? p + 1 : B.off[s.b];
      const sx = B.xs[p], sz = B.zs[p], ux = B.xs[q] - sx, uz = B.zs[q] - sz;
      const den = dx * uz - dz * ux;
      if (Math.abs(den) < 1e-9) continue;
      const wx = sx - ax, wz = sz - az;
      const u = (wx * uz - wz * ux) / den, v = (wx * dz - wz * dx) / den;
      if (u >= 0 && u < best && v >= 0 && v <= 1) best = u;
    }
  }
  return best * len;
}

// ---- faces as rectangles in the world --------------------------------------------------------------------------------
// { x, y, z } centre, (nx, nz) the way it faces, (rx, rz) its right, hw / hh half width / height. Blade signs are faces too.
const rect = (x, y, z, nx, nz, hw, hh) => ({ x, y, z, nx, nz, rx: nz, rz: -nx, hw, hh });
// Every face stands upright, so it is a segment on the ground times a height interval, and the gap between two faces
// is exactly hypot(gap between the segments, gap between the intervals).
function pointSeg(px, pz, ax, az, bx, bz) { return segPointDist(px, pz, ax, az, bx, bz)[0]; }
function segSeg(a, b) {
  const [ax, az, bx, bz] = a, [cx, cz, dx, dz] = b;
  const o = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = o(ax, az, bx, bz, cx, cz), d2 = o(ax, az, bx, bz, dx, dz), d3 = o(cx, cz, dx, dz, ax, az), d4 = o(cx, cz, dx, dz, bx, bz);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(pointSeg(ax, az, cx, cz, dx, dz), pointSeg(bx, bz, cx, cz, dx, dz), pointSeg(cx, cz, ax, az, bx, bz), pointSeg(dx, dz, ax, az, bx, bz));
}
const segOf = (r) => [r.x - r.rx * r.hw, r.z - r.rz * r.hw, r.x + r.rx * r.hw, r.z + r.rz * r.hw];
/** Smallest gap (m) between two upright faces; 0 when they touch or cross. */
export function faceGap(a, b) {
  const dy = Math.max(0, Math.abs(a.y - b.y) - a.hh - b.hh);
  return Math.hypot(segSeg(segOf(a), segOf(b)), dy);
}

/**
 * The whole bowtie plan. nyc: createNYC() with skipBuilding already set (world.js does it first).
 * Returns { facing, corners, streets, blades, main } — corners: [{ n, wall, x, z, yaw, w, h, yA, yB }];
 * streets: 50 × { id, n, wall, x, z, nx, nz, yaw, y, w, h, kind } where (x, z) is the mount group's origin (0.7 m off
 * the wall) and the face sits 0.2 m in front of it; blades: [{ name, x, z, ry }] (index into BLADES, height 15, size 12).
 */
export function planBowtie(nyc, { oneTimes = LAYOUT.oneTimes, search = false } = {}) {
  // ---- the bowtie: facades facing the square ----
  const facing = wallsIn(nyc, -110, 120, -250, 262, 9).filter(w => {
    let best = Infinity, qx = 0, qz = 0;
    for (const [ax, az, bx, bz] of AXES) { const [d, x, z] = segPointDist(w.mx, w.mz, ax, az, bx, bz); if (d < best) { best = d; qx = x; qz = z; } }
    if (best > 95 || best < 4) return false;
    const vx = (qx - w.mx) / best, vz = (qz - w.mz) / best;
    w.dist = best;
    return w.nx * vx + w.nz * vz > (best > 60 ? 0.62 : 0.5);
  });
  const used = new Set();
  // Four corner towers, two claimable boards each (upper A, lower B).
  const CORNERS = [['1', -42, -40, 1, 0], ['2', 14, -112, -1, 0], ['3', -14, 124, 1, 0], ['4', 40, 58, -1, 0]];
  const corners = [];
  for (const [n, ax, az, nx, nz] of CORNERS) {
    const w = pickWall(facing, ax, az, nx, nz, 13, 26) || pickWall(facing, ax, az, nx, nz, 9, 16);
    if (w) used.add(w);
    const bw = w ? Math.min(16, Math.max(11, w.len - 1.4)) : 14;
    const bh = bw * 9 / 16;
    corners.push(w
      ? { n, wall: w, x: w.mx + w.nx * 0.8, z: w.mz + w.nz * 0.8, nx: w.nx, nz: w.nz, yaw: Math.atan2(w.nx, w.nz), w: bw, h: bh, yA: 26, yB: 26 - bh - 0.7 }
      : { n, wall: null, x: ax, z: az, nx, nz, yaw: Math.atan2(nx, nz), w: bw, h: bh, yA: 26, yB: 26 - bh - 0.7 });
  }
  // STREET_1..30: about 30 large faces on the buildings that look onto the main street.
  const streetPool = facing
    .filter((w) => !used.has(w) && w.len >= 12 && w.h >= 12 && w.dist < 85 && Math.hypot(w.mx - oneTimes.x, w.mz - oneTimes.z) > 28)
    .sort((a, b) => a.dist - b.dist);
  const streetWalls = [];
  for (const w of streetPool) {
    if (streetWalls.length >= STREET_OLD) break;
    if (streetWalls.some((p) => Math.hypot(p.mx - w.mx, p.mz - w.mz) < 16)) continue;
    streetWalls.push(w);
  }
  for (const w of streetPool) {
    if (streetWalls.length >= STREET_OLD) break;
    if (!streetWalls.includes(w)) streetWalls.push(w);
  }
  const streets = streetWalls.map((w, i) => {
    used.add(w);
    const bw = Math.min(22, Math.max(14, w.len * 0.78));
    const bh = bw * 9 / 16;
    const y = Math.min(w.h - bh / 2 - 1.2, Math.max(bh / 2 + 6, 12));
    return { id: 'STREET_' + (i + 1), n: i + 1, wall: w, along: 0, x: w.mx + w.nx * 0.7, z: w.mz + w.nz * 0.7, nx: w.nx, nz: w.nz, yaw: Math.atan2(w.nx, w.nz), y, w: bw, h: bh, frame: FRAME_T, kind: 'street' };
  });
  // One Times Square's five stacked faces (timesq.js: 24 m wide from y 11, facing north from oneTimes.z - 1.2).
  const faceH = 24 * 9 / 16, mainTop = 11 + 5 * faceH + 4 * 0.5;
  const main = rect(oneTimes.x, (11 + mainTop) / 2, oneTimes.z - 1.2, 0, -1, 12.6, (mainTop - 11) / 2 + 0.6);
  // Every claimable face so far, each grown by its frame: the main stack, the corner pairs, STREET_1..30.
  const taken = [main];
  for (const c of corners) {
    const fx = c.x + c.nx * 0.35, fz = c.z + c.nz * 0.35;
    taken.push(rect(fx, c.yA, fz, c.nx, c.nz, c.w / 2 + 0.2, c.h / 2 + 0.2), rect(fx, c.yB, fz, c.nx, c.nz, c.w / 2 + 0.2, c.h / 2 + 0.2));
  }
  const own = new Map(streets.map((s) => [s, faceOf(s, s.frame)])); // each claimable street face's frame, by board
  taken.push(...own.values());
  // Blade signs: the same draw from the same seed as before the plan moved here (timesq.js builds them). A blade that
  // would stand through a claimable face is left out; the draw goes on unchanged for the rest.
  const r = mulberry(4242), blades = [];
  for (const w of facing) {
    const L = w.len, H = w.h;
    if (L > 14 && H > 18 && w.dist <= 60 && r() < 0.35) {
      const along = (r() < 0.5 ? -1 : 1) * (L / 2 - 2.2);
      const b = { name: (r() * 5) | 0, x: w.mx + w.tx * along + w.nx * 1.55, z: w.mz + w.tz * along + w.nz * 1.55, ry: Math.atan2(w.nx, w.nz) + Math.PI / 2, wall: w };
      b.face = rect(b.x, 15, b.z, w.tx, w.tz, 1.2, 6.2);
      if (taken.every((t) => faceGap(b.face, t) >= 0.05)) blades.push(b);
    }
  }

  // ---- STREET_31..50: the core ----
  for (const b of blades) taken.push(b.face);
  const list = solids(nyc, CORE.x - CORE.r - 60, CORE.x + CORE.r + 60, CORE.z0 - 60, CORE.z1 + 60);
  const extra = planCore(nyc, list, facing, used, streets, taken, own);
  extra.forEach((s, i) => { s.id = 'STREET_' + (STREET_OLD + 1 + i); s.n = STREET_OLD + 1 + i; });
  // ---- the faces nobody on the street could see whole: moved to a clear wall on the square, round by round ----
  // Everything above was placed with them where they first stood, so no other face, blade or STREET_31..50 moves; a
  // round is checked against every face but its own old spots, so a later round never moves an earlier one.
  const all = streets.concat(extra);
  let keep = taken;
  for (const round of MOVE_ROUNDS) {
    const gone = new Set(round.boards.map((n) => own.get(all[n - 1])));
    keep = keep.filter((t) => !gone.has(t));
    for (const n of round.boards) {
      const s = all[n - 1];
      // where the search put it (MOVES), checked against the same rules; the search itself only if the map has changed
      const c = (!search && movedTo(nyc, list, facing, s, MOVES[n], keep, round)) || rehome(nyc, list, facing, s, keep, round);
      if (!c) continue; // never on the shipped map (test/boards.test.mjs pins every move)
      Object.assign(s, c, { id: s.id, n: s.n, moved: { x: s.x, z: s.z, y: s.y, w: s.w } });
      keep.push(faceOf(s, s.frame));
    }
  }
  // ---- AD_1..AD_N: the ad-only screens (not claimable), last, so nothing above moves for them ----
  const ads = planAds(nyc, list, facing, keep, all, corners, search);
  return { facing, corners, streets: all, blades, main, ads };
}

// ---- ad-only screens ---------------------------------------------------------------------------------------------
// AD_1..AD_N carry paid advertising booked by the operator (adsale.js, adsrv.js), never a coin bid or a wish. Same rules
// as a new street face (fits: on its own wall, out of every building, GAP clear of every face, frame and blade, SEE m
// of open street in front; onStreet; inSight: the 보기 camera sees it whole straight back in a tall phone frame), within
// AD_REACH m of the plaza centre (the core is full: 7th Avenue and Broadway up to One Times Square and TKTS, as the second
// move round), from AD_MIN m wide, AD_APART m from each other, and never across the straight-back camera of another
// board, so no claimable board is framed through one. Nearest the walk from the spawn to the bakery stall first.
export const AD_N = 5;
export const AD_IDS = Array.from({ length: AD_N }, (_, i) => 'AD_' + (i + 1));
const AD_MIN = 11, AD_MAX = 17, AD_STEP = 1.5, AD_APART = 26, AD_REACH = 150;
// What adSearch finds on the shipped map: [wall midpoint x, z, metres along the wall, width, height level]. planBowtie
// takes these after checking them against the same rules; test/ad-screens.test.mjs runs the search and checks it lands here.
export const AD_SPOTS = {
  AD_1: [70.85, 112.7, 11, 11, 1], AD_2: [14, 204.45, 2, 17, 2], AD_3: [-26.5, -12, 0, 11, 4], AD_4: [49.75, 203.6, 11, 12.5, 3], AD_5: [13.85, -30.4, 18, 11, 2],
};
const adShape = () => ({ kind: 'ad', frame: FRAME_T, min: AD_MIN, eye: false, low: false }); // FRAME_T is declared further down
const adSlot = (w, along, bw, level) => slotOn(w, along, bw, level, adShape());
// The straight-back camera of every claimable face (the corner pairs, the main stack, STREET_1..50) as segments from
// points on the face to where inSight puts the camera: an ad face may cross none of them.
function viewLines(nyc, streets, corners) {
  const out = [], add = (x, y, z, nx, nz, w, h) => {
    const need = Math.max(w / TALL, h) / (2 * TALL_T), d = Math.max(Math.min(18, Math.max(6, need * 1.7)), Math.min(need, 48));
    const gx = x + nx * d, gz = z + nz * d, gy = Math.max(y * 0.42 + 1.8, groundHeight(gx, gz) + 1.6), rx = nz, rz = -nx;
    for (const [u, v] of [[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) out.push([x + rx * u * w, y + v * h, z + rz * u * w, gx, gy, gz]);
  };
  for (const s of streets) { const f = faceOf(s); add(f.x, s.y, f.z, s.nx, s.nz, s.w, s.h); }
  for (const c of corners) for (const y of [c.yA, c.yB]) add(c.x + c.nx * 0.35, y, c.z + c.nz * 0.35, c.nx, c.nz, c.w, c.h);
  const fh = 24 * 9 / 16, OT = LAYOUT.oneTimes;
  for (let i = 0; i < 5; i++) add(OT.x, 11 + fh / 2 + i * (fh + 0.5), OT.z - 1.2, 0, -1, 24, fh);
  return out;
}
/** True when the segment [ax, ay, az, bx, by, bz] passes through the upright rectangle r. */
export function segThrough(r, [ax, ay, az, bx, by, bz]) {
  const den = (bx - ax) * r.nx + (bz - az) * r.nz;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((r.x - ax) * r.nx + (r.z - az) * r.nz) / den;
  if (t < 0 || t > 1) return false;
  const hx = ax + (bx - ax) * t, hy = ay + (by - ay) * t, hz = az + (bz - az) * t;
  return Math.abs((hx - r.x) * r.rx + (hz - r.z) * r.rz) <= r.hw && Math.abs(hy - r.y) <= r.hh;
}
const inAdReach = (x, z) => Math.hypot(x - CORE.x, z - CORE.z) <= AD_REACH;
const adFits = (nyc, list, c, taken, views, picked) => c.y - c.h / 2 >= EYE_Y0 - 1e-9 && c.y + c.h / 2 + c.frame <= c.wall.h - 1 && Math.abs(c.along) <= room(c.wall, c.w, c.frame) + 1e-9
  && inAdReach(c.x, c.z) && picked.every((p) => Math.hypot(p.x - c.x, p.z - c.z) >= AD_APART)
  && fits(nyc, list, c, taken) && inSight(nyc, list, c) && onStreet(nyc, list, c) && !views.some((v) => segThrough(faceOf(c, c.frame), v));
function planAds(nyc, list, facing, taken, streets, corners, search) {
  const views = viewLines(nyc, streets, corners), keep = taken.slice(), out = [];
  const take = (c, i) => { c.id = AD_IDS[i]; c.n = i + 1; out.push(c); keep.push(faceOf(c, c.frame)); };
  if (!search) {
    AD_IDS.forEach((id, i) => {
      const m = AD_SPOTS[id]; if (!m) return;
      const [mx, mz, along, bw, level] = m, w = facing.find((q) => Math.abs(q.mx - mx) < 0.05 && Math.abs(q.mz - mz) < 0.05);
      if (!w || level >= levels(w, bw, adShape()).length) return;
      const c = adSlot(w, along, bw, level);
      if (adFits(nyc, list, c, keep, views, out)) take(c, out.length);
    });
    if (out.length === AD_N) return out;
    out.length = 0; keep.length = taken.length; // the map changed under the table: search it all again
  }
  const A = LAYOUT.spawn, S = LAYOUT.stall, dx = S.x - A.x, dz = S.z - A.z, L2 = dx * dx + dz * dz;
  const walk = (x, z, y) => { const t = Math.max(0, Math.min(1, ((x - A.x) * dx + (z - A.z) * dz) / L2)); return Math.hypot(x - A.x - dx * t, z - A.z - dz * t, y - 1.6); };
  const cands = [];
  for (const w of facing) {
    for (let bw = AD_MAX, k = 0; bw >= AD_MIN - 1e-9; bw -= AD_STEP, k++) {
      const r = room(w, bw, FRAME_T);
      if (r < 0) continue;
      levels(w, bw, adShape()).forEach((y, level) => {
        const bh = bw * 9 / 16;
        if (y - bh / 2 < EYE_Y0 - 1e-9 || y + bh / 2 + FRAME_T > w.h - 1) return;
        for (let along = -Math.floor(r); along <= r + 1e-9; along += 1) {
          const x = w.mx + w.tx * along + w.nx * 0.7, z = w.mz + w.tz * along + w.nz * 0.7;
          if (inAdReach(x, z)) cands.push({ w, along, bw, level, x, z, y, rank: walk(x, z, y) + k * SHRINK_M });
        }
      });
    }
  }
  cands.sort((a, b) => a.rank - b.rank || a.x - b.x || a.z - b.z || a.y - b.y || b.bw - a.bw);
  for (const k of cands) {
    if (out.length >= AD_N) break;
    const c = adSlot(k.w, k.along, k.bw, k.level);
    if (adFits(nyc, list, c, keep, views, out)) take(c, out.length);
  }
  return out;
}
// The faces nobody on the street could see whole; nobody held them, so they moved before anyone could. Two rounds:
//  1. STREET_1..30 whose face the map puts inside a neighbouring building (overlapping OpenStreetMap outlines). 22 and
//     27 (free first boards) take the best spots first, nearest the walk from the spawn to the bakery stall, in the core.
//  2. STREET_23 and STREET_31..50's 35 and 47, in the Marriott's atrium (the map closes it all round under a 59 m shell),
//     and STREET_26 and 30, in a pocket the map closes north of Duffy Square. No clear wall was left near the walk, so
//     these go nearest the avenues players walk (7th Avenue, Broadway), up to 150 m from the plaza centre (One Times
//     Square's sides, 7th Avenue toward TKTS), 23 (a free first board) first; 35 stays at eye level.
export const MOVE_ROUNDS = [
  { boards: [22, 27, 18, 21, 24, 25, 28, 29], near: 'walk', reach: 0 },
  { boards: [23, 35, 47, 26, 30], near: 'avenue', reach: 150 },
];
export const MOVED = MOVE_ROUNDS.flatMap((r) => r.boards);
// What rehome() finds for them on the shipped map: [wall midpoint x, z, metres along the wall, width, height level].
// planBowtie takes these instead of searching (the search takes ~0.4 s), after checking them against the same rules;
// test/boards.test.mjs runs the search and checks it lands exactly here.
export const MOVES = {
  22: [-16.7, 124.65, -20, 19, 1], 27: [-16.7, 124.65, -22, 14, 3], 18: [-16.7, 124.65, 16, 14, 0], 21: [-16.7, 124.65, -2, 22, 3],
  24: [-16.7, 124.65, 20, 19, 3], 25: [-16.7, 124.65, -22, 14.5, 4], 28: [-16.7, 124.65, -3, 11, 1], 29: [-16.7, 124.65, 15, 11, 3],
  23: [13.35, 225.75, -1, 14, 1], 35: [23.6, 204.05, 2, 11.5, 0], 47: [13.85, -30.4, 20, 11.5, 0], 26: [14, 204.45, -3, 14, 1], 30: [13.35, 225.75, -1, 14, 2],
};
const MOVE_MIN = 10, MOVE_STEP = 1.5, MOVE_TOP = 45, SHRINK_M = 6;
// How a moved face keeps its kind: a STREET_1..30 face stays a framed street face from MOVE_MIN m wide; a STREET_31..50
// eye-level face stays one (from EYE_MIN m wide, its thin frame, on the eye rows), and the bottom one of a pair keeps
// the bottom row (its lower edge EYE_Y0 up), so it stays at eye level.
const shapeOf = (s) => s.kind === 'eye'
  ? { kind: 'eye', frame: EYE_FRAME, min: EYE_MIN, eye: true, low: Math.abs(s.y - s.h / 2 - EYE_Y0) < 1e-6 }
  : { kind: 'street', frame: FRAME_T, min: MOVE_MIN, eye: false, low: false };
// The heights a w-wide moved face may take on wall w: the STREET_1..30 rule first, then rows up from the eye-level one
// (only those rows for an eye-level face, only the first for the bottom one).
function levels(w, bw, sh) {
  const bh = bw * 9 / 16, ys = sh.eye ? [] : [Math.min(w.h - bh / 2 - 1.2, Math.max(bh / 2 + 6, 12))];
  for (let y = EYE_Y0 + bh / 2; y + bh / 2 <= MOVE_TOP; y += bh + 2 * sh.frame + GAP + 0.2) ys.push(y);
  return sh.low ? ys.slice(0, 1) : ys;
}
const slotOn = (w, along, bw, level, sh) => {
  const bh = bw * 9 / 16, y = levels(w, bw, sh)[level];
  return { wall: w, along, x: w.mx + w.tx * along + w.nx * 0.7, z: w.mz + w.tz * along + w.nz * 0.7, nx: w.nx, nz: w.nz, yaw: Math.atan2(w.nx, w.nz), y, w: bw, h: bh, frame: sh.frame, kind: sh.kind, level };
};
const inCore = (x, z) => Math.hypot(x - CORE.x, z - CORE.z) <= CORE.r && z >= CORE.z0 && z <= CORE.z1;
// Where a round's faces may go: the core, or (reach) that many metres round the plaza centre.
const inReach = (round, x, z) => (round.reach ? Math.hypot(x - CORE.x, z - CORE.z) <= round.reach : inCore(x, z));
const room = (w, bw, frame) => w.len / 2 - 0.3 - frame - bw / 2;
const placeable = (nyc, list, c, taken, round) => c.y - c.h / 2 >= EYE_Y0 - 1e-9 && c.y + c.h / 2 + c.frame <= c.wall.h - 1 && Math.abs(c.along) <= room(c.wall, c.w, c.frame) + 1e-9
  && inReach(round, c.x, c.z) && fits(nyc, list, c, taken) && inSight(nyc, list, c) && onStreet(nyc, list, c);
function movedTo(nyc, list, facing, s, m, taken, round) {
  if (!m) return null;
  const sh = shapeOf(s), [mx, mz, along, bw, level] = m, w = facing.find((q) => Math.abs(q.mx - mx) < 0.05 && Math.abs(q.mz - mz) < 0.05);
  if (!w || level >= levels(w, bw, sh).length || bw > s.w || bw < sh.min - 1e-9) return null;
  const c = slotOn(w, along, bw, level, sh);
  return placeable(nyc, list, c, taken, round) ? c : null;
}
/**
 * A clear spot for street board s under the STREET_31..50 rules (fits), as large as it was if it can be, nearest the
 * round's walk (round.near): 'walk', the walk from the spawn to the bakery stall; 'avenue', 7th Avenue or Broadway.
 */
export function rehome(nyc, list, facing, s, taken, round = MOVE_ROUNDS[0]) {
  // counting height too: a face up high is farther from a walker's eye
  const A = LAYOUT.spawn, S = LAYOUT.stall, dx = S.x - A.x, dz = S.z - A.z, L2 = dx * dx + dz * dz;
  const walk = round.near === 'avenue'
    ? (x, z, y) => Math.hypot(Math.min(...AXES.map(([ax, az, bx, bz]) => segPointDist(x, z, ax, az, bx, bz)[0])), y - 1.6)
    : (x, z, y) => { const t = Math.max(0, Math.min(1, ((x - A.x) * dx + (z - A.z) * dz) / L2)); return Math.hypot(x - A.x - dx * t, z - A.z - dz * t, y - 1.6); };
  const sh = shapeOf(s), cands = [];
  for (const w of facing) {
    for (let bw = s.w, k = 0; bw >= sh.min - 1e-9; bw -= MOVE_STEP, k++) {
      const r = room(w, bw, sh.frame);
      if (r < 0) continue;
      levels(w, bw, sh).forEach((y, level) => {
        const bh = bw * 9 / 16;
        if (y - bh / 2 < EYE_Y0 - 1e-9 || y + bh / 2 + sh.frame > w.h - 1) return;
        for (let along = -Math.floor(r); along <= r + 1e-9; along += 1) {
          const x = w.mx + w.tx * along + w.nx * 0.7, z = w.mz + w.tz * along + w.nz * 0.7;
          if (inReach(round, x, z)) cands.push({ w, along, bw, level, x, z, y, rank: walk(x, z, y) + k * SHRINK_M });
        }
      });
    }
  }
  cands.sort((a, b) => a.rank - b.rank || a.x - b.x || a.z - b.z || a.y - b.y || b.bw - a.bw);
  for (const k of cands) { const c = slotOn(k.w, k.along, k.bw, k.level, sh); if (placeable(nyc, list, c, taken, round)) return c; }
  return null;
}
// On a street, not in a courtyard the map closes all round (the Marriott's atrium, say): from 3 m in front of the face,
// at its height, two neighbouring lines 5° apart (so not a crack between two outlines) within 85° of straight out run
// OPEN m without meeting a wall.
const OPEN = 60;
function onStreet(nyc, list, c) {
  const f = faceOf(c), ax = f.x + c.nx * 3, az = f.z + c.nz * 3;
  const clear = (deg) => {
    const a = (deg * Math.PI) / 180, dx = c.nx * Math.cos(a) - c.nz * Math.sin(a), dz = c.nx * Math.sin(a) + c.nz * Math.cos(a);
    return rayRun(nyc, list, ax, c.y, az, ax + dx * OPEN, c.y, az + dz * OPEN) >= 1;
  };
  for (let deg = 0; deg < 85; deg += 5) if ((clear(deg) && clear(deg + 5)) || (clear(-deg) && clear(-deg - 5))) return true;
  return false;
}
// The 보기 camera in a tall phone frame (390 x 844, 72° vertical, 8% margin) stands this far straight back from a w x h
// face (camrig.js frameDistance / boardRange); a moved face must be seen whole from there, so it needs no turn.
const TALL = 390 / 844, TALL_T = Math.tan(36 * Math.PI / 180) * 0.84;
function inSight(nyc, list, c) {
  const need = Math.max(c.w / TALL, c.h) / (2 * TALL_T);
  const d = Math.max(Math.min(18, Math.max(6, need * 1.7)), Math.min(need, 48));
  const f = faceOf(c), gx = f.x + c.nx * d, gz = f.z + c.nz * d;
  const gy = Math.max(c.y * 0.42 + 1.8, groundHeight(gx, gz) + 1.6);
  for (const [u, v] of [[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [-0.5, 0], [0.5, 0]]) {
    const px = f.x + f.rx * u * c.w + c.nx * 0.6, pz = f.z + f.rz * u * c.w + c.nz * 0.6;
    if (rayRun(nyc, list, px, c.y + v * c.h, pz, gx, gy, gz) < 1) return false;
  }
  return true;
}
/** Clear fraction of a sloped segment before a building wall (nyc.rayBlock's rule, on the outlines in list). */
function rayRun(nyc, list, ax, ay, az, bx, by, bz) {
  const B = nyc.buildings, dx = bx - ax, dz = bz - az;
  const lx0 = Math.min(ax, bx), lx1 = Math.max(ax, bx), lz0 = Math.min(az, bz), lz1 = Math.max(az, bz);
  let best = 1;
  for (const s of list) {
    if (s.x1 < lx0 || s.x0 > lx1 || s.z1 < lz0 || s.z0 > lz1) continue;
    for (let p = B.off[s.b], e = B.off[s.b + 1]; p < e; p++) {
      const q = p + 1 < e ? p + 1 : B.off[s.b];
      const sx = B.xs[p], sz = B.zs[p], ux = B.xs[q] - sx, uz = B.zs[q] - sz;
      const den = dx * uz - dz * ux;
      if (Math.abs(den) < 1e-9) continue;
      const wx = sx - ax, wz = sz - az;
      const u = (wx * uz - wz * ux) / den, v = (wx * dz - wz * dx) / den;
      if (u < 0 || u >= best || v < 0 || v > 1) continue;
      const y = ay + (by - ay) * u;
      if (y < s.minh - 0.2 || y > s.h + 0.4) continue;
      best = u;
    }
  }
  return best;
}
/** The face of a street board (mount group 0.7 m off the wall, face 0.2 m further), grown by `pad` for its frame. */
export function faceOf(s, pad = 0) {
  return rect(s.x + s.nx * 0.2, s.y, s.z + s.nz * 0.2, s.nx, s.nz, s.w / 2 + pad, s.h / 2 + pad);
}

// The rules for a new face: inside CORE, on a wall that looks onto the square, GAP clear of every other frame and blade
// sign, wholly on its own wall and out of every neighbouring building, and with SEE m of open street in front of it at
// its own height (people see it, and the 보기 camera can stand back). Two kinds:
//  stack: another face of the same size above a big face on a tall wall, up to three (the real square stacks its screens);
//  eye:   a smaller face low on a wall (bottom edge EYE_Y0), beside a big face on a long wall or on a wall of its own,
//         with a second one above it when the wall is tall enough.
// Candidates go nearest the plaza centre first; at most PER_KIND of either kind, so the square gets both.
export const FRAME_T = 0.45, EYE_FRAME = 0.3;
const GAP = 0.3, SEE = 18, EYE_Y0 = 4.6, PER_KIND = 13, EYE_MIN = 7.5, EYE_MAX = 13;
function planCore(nyc, list, facing, used, streets, taken, own) {
  const cands = [];
  // rank: nearest the plaza centre first; a column's upper faces wait until every lower face had its turn, and a
  // smaller size of the same slot (tried when the full size does not fit) comes right after the full one.
  const add = (wall, along, y, bw, kind, frame, rank) => {
    const bh = bw * 9 / 16;
    const x = wall.mx + wall.tx * along + wall.nx * 0.7, z = wall.mz + wall.tz * along + wall.nz * 0.7;
    if (!inCore(x, z) || y + bh / 2 + frame > wall.h - 1) return;
    cands.push({ wall, along, x, z, nx: wall.nx, nz: wall.nz, yaw: Math.atan2(wall.nx, wall.nz), y, w: bw, h: bh, frame, kind, rank });
  };
  const near = (wall, along) => Math.hypot(wall.mx + wall.tx * along - CORE.x, wall.mz + wall.tz * along - CORE.z);
  // An eye-level slot and the one above it, full size first, then 1.5 m narrower down to EYE_MIN. alongOf(bw): its centre.
  const eyeOn = (wall, alongOf, full) => {
    const base = near(wall, alongOf(full));
    for (let bw = full, k = 0; bw >= EYE_MIN - 1e-9; bw -= 1.5, k++) {
      const bh = bw * 9 / 16, along = alongOf(bw);
      add(wall, along, EYE_Y0 + bh / 2, bw, 'eye', EYE_FRAME, base + k * 1e-3);
      add(wall, along, EYE_Y0 + bh * 1.5 + EYE_FRAME * 2 + GAP + 0.2, bw, 'eye', EYE_FRAME, 1000 + base + k * 1e-3);
    }
  };
  for (const s of streets) {
    const w = s.wall, step = s.h + s.frame * 2 + GAP + 0.2;
    for (let k = 1; k <= 3; k++) add(w, 0, s.y + k * step, s.w, 'stack', s.frame, (k - 1) * 1000 + near(w, 0));
    // beside the big face on a long wall, against its frame
    const inner = s.w / 2 + s.frame + GAP + 0.2 + EYE_FRAME;
    const full = Math.min(EYE_MAX, w.len / 2 - 0.35 - EYE_FRAME - inner);
    if (full >= EYE_MIN) for (const sg of [-1, 1]) eyeOn(w, (bw) => sg * (inner + bw / 2), full);
  }
  for (const w of facing) {
    if (used.has(w)) continue;
    const full = Math.min(EYE_MAX, w.len - 0.8 - EYE_FRAME * 2);
    if (full >= EYE_MIN) eyeOn(w, () => 0, full);
  }
  cands.sort((a, b) => a.rank - b.rank || a.x - b.x || a.z - b.z || a.y - b.y || b.w - a.w);
  const out = [], per = { stack: 0, eye: 0 };
  for (const c of cands) {
    if (out.length >= STREET_NEW) break;
    if (per[c.kind] >= PER_KIND) continue;
    if (!fits(nyc, list, c, taken)) continue;
    out.push(c);
    const f = faceOf(c, c.frame);
    taken.push(f);
    own.set(c, f);
    per[c.kind]++;
  }
  for (const c of out) delete c.rank;
  return out;
}
function fits(nyc, list, c, taken) {
  const w = c.wall;
  // on its own wall; a stack is as wide as the face under it, which may already reach past a short wall's ends
  if (c.kind !== 'stack' && Math.abs(c.along) + c.w / 2 + c.frame > w.len / 2 - 0.3) return false;
  const f = faceOf(c, c.frame);
  for (const t of taken) if (faceGap(f, t) < GAP) return false;
  // out of every building: along the face, just behind and just in front of it, bottom to top
  const y0 = c.y - c.h / 2, y1 = c.y + c.h / 2;
  for (let i = 0; i <= 8; i++) {
    const u = -f.hw + (2 * f.hw * i) / 8;
    for (const out of [0.45, 1.3]) {
      const px = w.mx + w.tx * c.along + w.nx * out + f.rx * u, pz = w.mz + w.tz * c.along + w.nz * out + f.rz * u;
      if (solidAt(nyc, list, px, pz, y0, y1)) return false;
    }
  }
  // open street in front: from the centre and both ends, at the face's height
  for (const u of [0, -f.hw * 0.8, f.hw * 0.8]) {
    const ax = f.x + f.rx * u + c.nx * 1.5, az = f.z + f.rz * u + c.nz * 1.5;
    if (clearRun(nyc, list, ax, az, ax + c.nx * SEE, az + c.nz * SEE, c.y) < SEE - 0.01) return false;
  }
  return true;
}
