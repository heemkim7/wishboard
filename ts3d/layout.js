// Game layout on the real Manhattan street grid. Meters; origin at 7th Ave & W 45th St, north is -Z,
// +X runs crosstown toward the East River (see tools/build-nyc.mjs). Streets and buildings come from
// OpenStreetMap through ts3d/nycmeta.js + /assets/nyc/manhattan.bin; this file pins the hand-placed
// game features onto that map.
import { NYC_META, LANDMARKS as MAP_LANDMARKS } from './nycmeta.js?v=202611241127';

// Walkable Times Square. The real canyon stays: TKTS, the bowtie, the stall, One Times Square.
// X is the requested width. Z is longer so those landmarks are not cut off.
export const LOOP = { x0: -75, x1: 75, z0: -155, z1: 400 };
export function insideLoop(x, z, pad = 0) {
  return x > LOOP.x0 + pad && x < LOOP.x1 - pad && z > LOOP.z0 + pad && z < LOOP.z1 - pad;
}

// The cleared pad south of One Times Square (its buildings are skipped, see SKIP_ZONES): the lots, their street, the stage.
const PAD = { x0: -70, x1: 70, z0: 255, z1: 395 };
// K-POP stage at the south end of the lots' street, inside the pad and the fence. Its three steps (2.4 m) are on the
// north side, so it faces up the street. trees: [x from cx, z from z0] of the six planters beside it (none in the street).
const STAGE = { cx: 0, x0: -8, x1: 8, z0: 382, z1: 394, h: 0.75, spot: { x: 0, z: 388, r: 3.8 }, trees: [[-15, 4], [15, 4], [-21, 2], [21, 2], [-19, 9], [19, 9]] };
const STAGE_STEPS = 2.4;

/** A lot in its own frame, before its scale (the front is +Z, as buildPlot in ts3d/landmarks.js draws it): the pad, each
 *  level's collider half-sizes [across, deep] (level 0 is walk-through), and the widest piece any level carries (the
 *  tower's 13.4 m roof line). Nothing of a lot reaches past the pad's front edge. */
export const LOT = { w: 8.4, d: 7.6, scale: 0.9, foot: [null, [3.0, 2.2], [3.6, 1.9], [5, 3.4], [4.4, 3.4]], wide: 13.4 };

// 가운데 거리 (WISH STREET): one north-south pedestrian street down the middle of the pad. People arrive at its north end
// (the 건물 구역 taxi stand), walk in under the arch at z0 and reach the stage steps at z1. Nine lots stand on each side at
// x ± lotX, every `step` metres from lot0, and face the street. Inside ± half of the centre line nothing has a collider.
const STREET = { x: 0, z0: 262, z1: STAGE.z0 - STAGE_STEPS, half: 12, lotX: 17, lot0: 272, step: 13, pairs: 9 };
const LOT_BACK = STREET.lotX + (LOT.d / 2) * LOT.scale, LOT_FRONT = STREET.lotX - (LOT.d / 2) * LOT.scale;

export const LAYOUT = {
  bounds: NYC_META.bounds,
  // South bowtie plaza between W 44th and W 45th St, facing One Times Square.
  spawn: { x: 16, z: 28, yaw: 0 },
  plaza: { y: 0 },
  walk: { y: 0 },
  subway: { x: 17, z: 60 },
  stall: { x: 21, z: 118, r: 5.2 },
  atm: { x: 29.5, z: 134, r: 3.2 },
  // TKTS red steps on the real booth in Father Duffy Square (W 46th–47th St).
  stairs: { x0: -29, x1: -13, front: -124, steps: 14, depth: 1.1, rise: 0.34, back: -143.6 },
  // North tip of One Times Square (MAIN_S wraps it) and the tower roof for the ball.
  oneTimes: { x: 17.4, z: 192.9, roof: { x: 21.3, z: 225.6, h: 110.6 } },
  stage: STAGE,
  // The lots' street (see STREET above). entry: where a jump to the lots lands, between the 건물 구역 stand and the arch.
  // mid: the middle pair, for the map pin. arch: the entrance arch's posts at x ± post, each a square of half-size r.
  // pave: the paved strip between the two rows of pads, through to the pad's south edge under the stage.
  street: {
    ...STREET,
    entry: { x: STREET.x, z: 258 },
    mid: { x: STREET.x, z: STREET.lot0 + (STREET.step * (STREET.pairs - 1)) / 2 },
    arch: { z: STREET.z0, post: 13.2, r: 0.45, h: 8.4 },
    pave: { x0: STREET.x - LOT_FRONT, x1: STREET.x + LOT_FRONT, z0: STREET.z0, z1: PAD.z1 },
  },
};

export const TAXI_STANDS = [
  { x: 9.4, z: 72, axis: 'z', name: '타임스퀘어' },
  { x: -11.6, z: -40, axis: 'z', name: '더피 스퀘어' },
  // On the street's centre line at the pad's north edge: the way in to the lots.
  { x: 0, z: 255, axis: 'z', name: '건물 구역' },
];

// Walking in from the entrance (heading south, +Z) the odd numbers are on the left, which is east (+X), and the even
// numbers on the right: pair k is lots 2k+1 (east) and 2k+2 (west). A lot's front is its local +Z and three.js turns it
// by rotation.y = rot to (sin rot, cos rot), so the east row looks along -X and the west row along +X: at the street.
const lot = (id) => {
  const east = id % 2 === 1, k = (id - 1) >> 1;
  return { id, x: STREET.x + (east ? STREET.lotX : -STREET.lotX), z: STREET.lot0 + STREET.step * k, rot: east ? -Math.PI / 2 : Math.PI / 2, side: east ? 'E' : 'W', scale: LOT.scale };
};
/** PLOT_SLOTS[id - 1] is the lot with that id (1..18). */
export const PLOT_SLOTS = Array.from({ length: STREET.pairs * 2 }, (_, i) => lot(i + 1));

/** The way a lot's front looks, as a unit vector on the ground. */
export const lotFacing = (slot) => ({ x: Math.sin(slot.rot), z: Math.cos(slot.rot) });
/** World rectangle of a box centred on a lot, given its half-sizes across and deep in the lot's own frame (before the
 *  lot's scale). A quarter-turned lot swaps the two. */
export function lotRect(slot, across, deep) {
  const sc = slot.scale || 1, swap = Math.abs(Math.sin(slot.rot)) > 0.5;
  const hx = (swap ? deep : across) * sc, hz = (swap ? across : deep) * sc;
  return { x0: slot.x - hx, x1: slot.x + hx, z0: slot.z - hz, z1: slot.z + hz };
}
/** The street's own solid pieces, which ts3d/landmarks.js draws and collides: the entrance arch's two posts ({ arch: -1 | 1 })
 *  and a number post at every lot's street corner, the corner nearer the entrance ({ lot: id }). Each is a square of
 *  half-size r at (x, z), outside the street's clear width. */
export function streetPosts() {
  const S = LAYOUT.street, out = [];
  for (const s of [-1, 1]) out.push({ arch: s, x: S.x + s * S.arch.post, z: S.arch.z, r: S.arch.r });
  for (const slot of PLOT_SLOTS) {
    const f = lotFacing(slot), sc = slot.scale || 1;
    out.push({ lot: slot.id, x: slot.x + f.x * ((LOT.d / 2) * sc + 0.58), z: slot.z - ((LOT.w / 2) * sc + 0.62), r: 0.38 });
  }
  return out;
}

/** OpenStreetMap buildings replaced by game structures (the lots' pad, the TKTS booth under the red steps). */
export const SKIP_ZONES = [
  { x0: -30, x1: -12, z0: -145, z1: -123 },
  // South pad for the 18 lots, their street and the stage. The canyon north of this stays.
  PAD,
];
/** No auto-generated lamps/trees/subway railings here (hand-built areas). The last one is the whole pad and a margin, so
 *  none stands in the lots' street or on a lot. */
export const NO_PROPS = [
  { x0: -30, x1: -12, z0: -146, z1: -118 },
  { x0: 8, x1: 40, z0: 8, z1: 168 },
  { x0: PAD.x0, x1: PAD.x1, z0: PAD.z0 - 5, z1: PAD.z1 + 3 },
];
/** No park trees around the stage (4 m past its floor on every side). */
export const NO_TREES = [{ x0: STAGE.x0 - 4, x1: STAGE.x1 + 4, z0: STAGE.z0 - 4, z1: STAGE.z1 + 4 }];
/** No car road here: ts3d/world.js cuts the asphalt and its paint out of this one rectangle (the lots' street from the arch
 *  to the pad's south edge, as wide as the backs of the two rows of pads), and landmarks.js lays the street's pavers. */
export const NO_ROAD = { x0: STREET.x - LOT_BACK, x1: STREET.x + LOT_BACK, z0: STREET.z0, z1: PAD.z1 };
/** Where the star shower lands: the south bowtie plaza. */
export const STAR_ZONES = [
  { x0: 10.5, x1: 21, z0: 14, z1: 50 },
  { x0: 10.5, x1: 25, z0: 70, z1: 80 },
  { x0: 10.5, x1: 31, z0: 96, z1: 158 },
];
/** Tall clusters across the rivers for the procedural far skyline. */
export const FAR_CLUSTERS = [
  { x: -1950, z: 4950, r: 900, h: 170 },
  { x: -2400, z: 2600, r: 700, h: 70 },
  { x: 2300, z: 600, r: 700, h: 120 },
  { x: 2250, z: 6300, r: 900, h: 140 },
  { x: 2700, z: 3800, r: 800, h: 60 },
  { x: -1300, z: -5600, r: 900, h: 90 },
];

/** Street side of the TKTS steps (south of `front`). Stays inside LOOP. */
export function fountainSpot() {
  const s = LAYOUT.stairs;
  return { x: (s.x0 + s.x1) / 2, z: s.front + 4.6, y: 1.15 };
}

export function onStairs(x, z) {
  const s = LAYOUT.stairs;
  return x >= s.x0 && x <= s.x1 && z <= s.front && z >= s.back;
}

/** Walkable height: TKTS steps and the stage; the streets are flat. */
export function groundHeight(x, z) {
  const s = LAYOUT.stairs;
  if (x >= s.x0 && x <= s.x1 && z <= s.front && z >= s.back) {
    const i = Math.floor((s.front - z) / s.depth);
    return Math.min(s.steps, i + 1) * s.rise;
  }
  const G = LAYOUT.stage;
  if (x >= G.x0 && x <= G.x1) {
    if (z >= G.z0 && z <= G.z1) return G.h;
    if (z >= G.z0 - 2.4 && z < G.z0) return G.h * (Math.floor((z - (G.z0 - 2.4)) / 0.8) + 1) / 4;
  }
  return 0;
}

/** Deterministic star spot (every client derives the same shower from the shared seed). */
export function starSpot(rand) {
  const area = STAR_ZONES.map(q => (q.x1 - q.x0) * (q.z1 - q.z0));
  const total = area.reduce((a, b) => a + b, 0);
  for (let n = 0; n < 16; n++) {
    let pick = rand() * total, i = 0;
    while (pick > area[i] && i < area.length - 1) pick -= area[i++];
    const q = STAR_ZONES[i];
    const x = q.x0 + rand() * (q.x1 - q.x0), z = q.z0 + rand() * (q.z1 - q.z0);
    const S = LAYOUT.stall, Am = LAYOUT.atm, U = LAYOUT.subway;
    if (Math.hypot(x - S.x, z - S.z) < 5.5 || Math.hypot(x - Am.x, z - Am.z) < 2.5 || (Math.abs(x - U.x) < 3 && Math.abs(z - U.z) < 5)) continue;
    return { x, z };
  }
  return { x: 15, z: 40 };
}

/** Map pins: real landmarks plus the game spots. */
export const LANDMARKS = [
  { id: 'tkts', ko: 'TKTS 빨간 계단', en: 'TKTS Red Steps', x: -21, z: -134, g: '🔴', major: true },
  { id: 'onetimes', ko: '원 타임스퀘어', en: 'One Times Square', x: 21, z: 214, g: '🗼', major: true },
  { id: 'stall', ko: '붕어빵 포차', en: 'Bungeo-ppang', x: LAYOUT.stall.x, z: LAYOUT.stall.z, g: '🐟', major: true, side: -1 },
  { id: 'atm', ko: '황금 ATM', en: 'Golden ATM', x: LAYOUT.atm.x, z: LAYOUT.atm.z, g: '💰', major: true, side: 1 },
  { id: 'subway', ko: '타임스퀘어역', en: 'Times Sq Station', x: LAYOUT.subway.x, z: LAYOUT.subway.z, g: '🚇', major: true, side: 1 },
  { id: 'stage', ko: 'K-POP 스테이지', en: 'K-POP Stage', x: LAYOUT.stage.spot.x, z: LAYOUT.stage.spot.z, g: '💃', major: true },
  { id: 'lots', ko: '건물 구역', en: 'Lots', x: LAYOUT.street.mid.x, z: LAYOUT.street.mid.z, g: '🏗️', major: true },
  ...MAP_LANDMARKS.filter(l => !['timessq', 'ktown', 'bryant'].includes(l.id) && insideLoop(l.x, l.z, 0)).map(l => {
    if (l.id === 'rock') return { ...l, ko: '30 록펠러 플라자', en: '30 Rockefeller Plaza', x: 406, z: -328, g: '🏢', major: true };
    const mark = { esb: '🏙️', chrysler: '🏢', flatiron: '🏢', owtc: '🏙️', gct: '🚉', msg: '🏟️', un: '🏛️' }[l.id];
    return mark ? { ...l, g: mark, major: true } : { ...l, g: '📍' };
  }),
];

export const PLAZA_CENTER = { x: 16, z: 90 };
