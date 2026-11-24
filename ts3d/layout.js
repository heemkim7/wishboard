// Game layout on the real Manhattan street grid. Meters; origin at 7th Ave & W 45th St, north is -Z,
// +X runs crosstown toward the East River (see tools/build-nyc.mjs). Streets and buildings come from
// OpenStreetMap through ts3d/nycmeta.js + /assets/nyc/manhattan.bin; this file pins the hand-placed
// game features onto that map.
import { NYC_META, LANDMARKS as MAP_LANDMARKS } from './nycmeta.js?v=202611241625';

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

/** A lot in its own frame, before its scale (the front is +Z, as buildPlot in ts3d/landmarks.js draws it). The numbers
 *  follow the five models (tools/blender/build_props.py, served from assets/models/lots/):
 *  w, d   the pad
 *  foot   each level's collider half-sizes [across, deep] (level 0 is walk-through): the tent with its two masts
 *         (x ± 2.98) and its counter, the stall's cabinet and counter, the shop's 8.0 m body, the tower's lobby
 *  steps  how many axis-aligned boxes stand for a footprint that is turned off the axes (lotBoxes)
 *  tall   how high each level stops the camera (0: it does not): the shop's roof items reach 9 m, the tower 19 m
 *  wide   the widest piece any level carries (the rim of the tower's board, 13.41 m)
 *  reach  how far forward of its centre any level comes: the tower's marquee, 0.7 m over the pad's front edge and
 *         2.6 m up or more, with nothing under it. Everything else of a lot stays on its pad
 *  faces  where each level's billboard and name sign hang: { x, y, z, w, h }, centre and size. The models carry a mount
 *         plate behind each and say the same numbers in their BoardAnchor / SignAnchor nodes, but for the tower's
 *         sign: its plate is on the crown (y 16.3, z 1.2), 2.2 m behind the board's top edge, where nobody in the
 *         street can see it, so the game stands the sign on the board's top rim instead. */
export const LOT = {
  w: 8.4, d: 7.6, scale: 0.9,
  foot: [null, [3.1, 2.35], [3.6, 1.9], [4.1, 3.3], [4.1, 3.6]],
  steps: 6,
  tall: [0, 0, 0, 9, 19],
  wide: 13.42, reach: 4.51,
  faces: [
    { board: { x: 0, y: 2.2, z: 2.72, w: 3.7, h: 2.05 }, sign: { x: 0, y: 3.7, z: 2.6, w: 3.2, h: 0.55 } },
    { board: { x: 0, y: 4.7, z: 0.4, w: 6.2, h: 3.5 }, sign: { x: 0, y: 1.55, z: 2.28, w: 2.8, h: 0.5 } },
    { board: { x: 0, y: 6.4, z: 2.05, w: 6.4, h: 3.6 }, sign: { x: 2.2, y: 2.2, z: 2.05, w: 2.4, h: 0.5 } },
    { board: { x: 0, y: 4.6, z: 3.15, w: 6.6, h: 3.7 }, sign: { x: 0, y: 7.35, z: 1.6, w: 5.2, h: 0.8 } },
    { board: { x: 0, y: 12.6, z: 3.55, w: 12.6, h: 7.1 }, sign: { x: 0, y: 17.1, z: 3.4, w: 6.2, h: 0.9 } },
  ],
};

// 가운데 거리 (WISH STREET): one north-south pedestrian street down the middle of the pad. People arrive at its north end
// (from West 42nd Street; the 위시 스트리트 taxi stand is beside the entrance), walk in under the arch at z0 and reach the stage steps at z1. Nine lots stand on each side at
// x ± lotX, every `step` metres from lot0. Each is turned about its own centre by `turn` toward the entrance, the east
// row one way and the west row the mirror way (a chevron), so every front and billboard faces up the street at the
// people walking in: an upright phone sees a board 31° off its plane instead of 13° edge-on (test/lot-models.test.mjs
// has the measure). turn 0 stands both rows square to the street, front to front; with lotX 17 and half 12 that is the
// street as it was until 2026-11-24. Inside ± half of the centre line nothing has a collider and no part of a lot reaches.
const DEG = Math.PI / 180;
const STREET = { x: 0, z0: 262, z1: STAGE.z0 - STAGE_STEPS, half: 9.5, lotX: 15, lot0: 272, step: 13, pairs: 9, turn: 20 * DEG };

/** Sine and cosine of an angle, exact (0, ±1) at the quarter turns: a lot that stands square to the axes gets exact numbers. */
function turned(rot) {
  const snap = (v) => (Math.abs(v) < 1e-12 ? 0 : Math.abs(Math.abs(v) - 1) < 1e-12 ? Math.sign(v) : v);
  return [snap(Math.sin(rot)), snap(Math.cos(rot))];
}
// How far a pad reaches from its row's line across the street: outward to its back corner, and inward to the corner of
// its front edge that is farther from the street (turned fronts are a sawtooth: the pavers reach into every tooth).
const [TURN_SIN, TURN_COS] = turned(STREET.turn);
const LOT_BACK = STREET.lotX + ((LOT.d / 2) * TURN_COS + (LOT.w / 2) * TURN_SIN) * LOT.scale;
const LOT_FRONT = STREET.lotX - ((LOT.d / 2) * TURN_COS - (LOT.w / 2) * TURN_SIN) * LOT.scale;

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
  // The lots' street (see STREET above). entry: where a jump to the lots lands, 1 m before the arch, facing down the street.
  // mid: the middle pair, for the map pin. arch: the entrance arch's posts at x ± post (1.2 m outside the clear width),
  // each a square of half-size r. pave: the paved strip from one row of pads to the other (into the teeth of turned
  // fronts), through to the pad's south edge under the stage.
  street: {
    ...STREET,
    entry: { x: STREET.x, z: STREET.z0 - 1 },
    mid: { x: STREET.x, z: STREET.lot0 + (STREET.step * (STREET.pairs - 1)) / 2 },
    arch: { z: STREET.z0, post: STREET.half + 1.2, r: 0.45, h: 8.4 },
    pave: { x0: STREET.x - LOT_FRONT, x1: STREET.x + LOT_FRONT, z0: STREET.z0, z1: PAD.z1 },
  },
};

export const TAXI_STANDS = [
  { x: 9.4, z: 72, axis: 'z', name: '타임스퀘어' },
  { x: -11.6, z: -40, axis: 'z', name: '더피 스퀘어' },
  // Beside the way in to the lots: on the pavement south of West 42nd Street (its south curb is at z 258.7), 22.5 m east
  // of the street's centre line, 11.8 m past the arch's east post. The called cab waits at the curb in front of it. Its
  // sign lies along W 42nd St, seen from the crossing in front of the arch and along the curb. It stood on the centre
  // line 2 m before the arch, where its sign filled the view of everyone walking in; and it stays 15.6 m (taxiStandR and
  // a lot's 3.6 m) from lot 1's front, so E there opens the lot. (Before that it stood at z 255, in a lane of W 42nd St.)
  { x: STREET.x + 22.5, z: STREET.z0 - 2, axis: 'x', name: '위시 스트리트' },
];

// Walking in from the entrance (heading south, +Z) the odd numbers are on the left, which is east (+X), and the even
// numbers on the right: pair k is lots 2k+1 (east) and 2k+2 (west). A lot's front is its local +Z and three.js turns it
// by rotation.y = rot to (sin rot, cos rot). Square to the street the east row would look along -X and the west row
// along +X; each is turned by `turn` more, toward -Z: the east row looks north-west, the west row north-east.
/** The lots of a street like LAYOUT.street: [id - 1] is the lot with that id. */
export function streetSlots(street) {
  const turn = Number(street.turn) || 0;
  return Array.from({ length: street.pairs * 2 }, (_, i) => {
    const id = i + 1, east = id % 2 === 1, k = (id - 1) >> 1;
    return { id, x: street.x + (east ? street.lotX : -street.lotX), z: street.lot0 + street.step * k, rot: east ? -(Math.PI / 2 + turn) : Math.PI / 2 + turn, side: east ? 'E' : 'W', scale: LOT.scale };
  });
}
/** PLOT_SLOTS[id - 1] is the lot with that id (1..18). */
export const PLOT_SLOTS = streetSlots(STREET);

/** The way a lot's front looks, as a unit vector on the ground. */
export const lotFacing = (slot) => ({ x: Math.sin(slot.rot), z: Math.cos(slot.rot) });
/** The four corners on the ground, in the world, of a box centred on a lot: [x, z] going round from the back. The box
 *  is given by its half-sizes across and deep in the lot's own frame (before the lot's scale). */
export function lotCorners(slot, across, deep) {
  const sc = slot.scale || 1, [s, c] = turned(slot.rot);
  return [[-across, -deep], [across, -deep], [across, deep], [-across, deep]].map(([x, z]) => [slot.x + (x * c + z * s) * sc, slot.z + (z * c - x * s) * sc]);
}
/** World rectangle around that box: the box itself when the lot stands square to the axes (a quarter-turned lot swaps
 *  its two sides), the axis-aligned box about its four corners when it is turned off them. */
export function lotRect(slot, across, deep) {
  const sc = slot.scale || 1, [s, c] = turned(slot.rot);
  const hx = (across * Math.abs(c) + deep * Math.abs(s)) * sc, hz = (across * Math.abs(s) + deep * Math.abs(c)) * sc;
  return { x0: slot.x - hx, x1: slot.x + hx, z0: slot.z - hz, z1: slot.z + hz };
}
/** Axis-aligned boxes that together hold that box, for the walker's collision and the camera's, which take nothing else.
 *  Square to the axes it is lotRect, one box. Turned off them it is `steps` slabs across the street, each as wide as the
 *  turned box is within it: a staircase along the slanted sides, tight where lotRect would wall off the wedge of
 *  ground before a turned front. */
export function lotBoxes(slot, across, deep, steps = LOT.steps) {
  const r = lotRect(slot, across, deep), [s, c] = turned(slot.rot);
  if (s === 0 || c === 0 || !(steps > 1)) return [r];
  const P = lotCorners(slot, across, deep), out = [];
  for (let k = 0; k < steps; k++) {
    const za = r.z0 + ((r.z1 - r.z0) * k) / steps, zb = r.z0 + ((r.z1 - r.z0) * (k + 1)) / steps;
    let x0 = Infinity, x1 = -Infinity;
    const take = (x) => { if (x < x0) x0 = x; if (x > x1) x1 = x; };
    for (let i = 0; i < 4; i++) {
      const [ax, az] = P[i], [bx, bz] = P[(i + 1) % 4];
      if (az >= za - 1e-9 && az <= zb + 1e-9) take(ax); // a corner inside the slab
      for (const z of [za, zb]) if ((az - z) * (bz - z) < 0) take(ax + ((bx - ax) * (z - az)) / (bz - az)); // a side crossing its edge
    }
    out.push({ x0, x1, z0: za, z1: zb });
  }
  return out;
}
/** A lot's number post: 0.58 m before the lot's front edge and 0.62 m past its side nearer the entrance, in the lot's own
 *  frame, so it turns with the lot and keeps its place by the front. A square of half-size r on the ground: the post's
 *  0.72 m head, turned as the lot is, and 2 cm. */
export function lotPost(slot) {
  const sc = slot.scale || 1, [s, c] = turned(slot.rot), ahead = (LOT.d / 2) * sc + 0.58, aside = (LOT.w / 2) * sc + 0.62;
  const e = s > 0 ? 1 : -1; // the lot's own x looks along (c, -s): this is the sign of it that goes north, toward the entrance
  return { lot: slot.id, x: slot.x + s * ahead + e * c * aside, z: slot.z + c * ahead - e * s * aside, r: 0.38 + 0.36 * (Math.abs(s) + Math.abs(c) - 1) };
}
/** The street's own solid pieces, which ts3d/landmarks.js draws and collides: the entrance arch's two posts ({ arch: -1 | 1 })
 *  and a number post by every lot's front, on the side nearer the entrance ({ lot: id }, lotPost). Each is a square of
 *  half-size r at (x, z), outside the street's clear width. */
export function streetPosts(street = LAYOUT.street, slots = PLOT_SLOTS) {
  const out = [];
  for (const s of [-1, 1]) out.push({ arch: s, x: street.x + s * street.arch.post, z: street.arch.z, r: street.arch.r });
  for (const slot of slots) out.push(lotPost(slot));
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
 *  to the pad's south edge, as wide as the back corners of the two rows of pads), and landmarks.js lays the street's pavers. */
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
  { id: 'lots', ko: '위시 스트리트', en: 'Wish Street', x: LAYOUT.street.mid.x, z: LAYOUT.street.mid.z, g: '🏗️', major: true },
  ...MAP_LANDMARKS.filter(l => !['timessq', 'ktown', 'bryant'].includes(l.id) && insideLoop(l.x, l.z, 0)).map(l => {
    if (l.id === 'rock') return { ...l, ko: '30 록펠러 플라자', en: '30 Rockefeller Plaza', x: 406, z: -328, g: '🏢', major: true };
    const mark = { esb: '🏙️', chrysler: '🏢', flatiron: '🏢', owtc: '🏙️', gct: '🚉', msg: '🏟️', un: '🏛️' }[l.id];
    return mark ? { ...l, g: mark, major: true } : { ...l, g: '📍' };
  }),
];

export const PLAZA_CENTER = { x: 16, z: 90 };
