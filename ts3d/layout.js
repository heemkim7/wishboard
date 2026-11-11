// Game layout on the real Manhattan street grid. Meters; origin at 7th Ave & W 45th St, north is -Z,
// +X runs crosstown toward the East River (see tools/build-nyc.mjs). Streets and buildings come from
// OpenStreetMap through ts3d/nycmeta.js + /assets/nyc/manhattan.bin; this file pins the hand-placed
// game features onto that map.
import { NYC_META, LANDMARKS as MAP_LANDMARKS } from './nycmeta.js';

// Walkable Times Square. The real canyon stays: TKTS, the bowtie, the stall, One Times Square.
// X is the requested width. Z is longer so those landmarks are not cut off.
export const LOOP = { x0: -75, x1: 75, z0: -155, z1: 400 };
export function insideLoop(x, z, pad = 0) {
  return x > LOOP.x0 + pad && x < LOOP.x1 - pad && z > LOOP.z0 + pad && z < LOOP.z1 - pad;
}

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
  // Dance floor in the south lot pad, inside the fence. The Bryant Park lawn is outside the playable square.
  stage: { cx: 0, x0: -8, x1: 8, z0: 360, z1: 372, h: 0.75, spot: { x: 0, z: 366, r: 3.8 } },
  bryant: { x0: -12, x1: 12, z0: 356, z1: 376 },
  // Lot rows sit in the cleared pad south of One Times Square.
  ktown: { z: 305, x0: -44, step: 22, n: 5, depth: 12 },
};

export const TAXI_STANDS = [
  { x: 9.4, z: 72, axis: 'z', name: '타임스퀘어' },
  { x: -11.6, z: -40, axis: 'z', name: '더피 스퀘어' },
  { x: 0, z: 255, axis: 'z', name: '분양 구역' },
];

const lot = (id, i, z, rot) => ({ id, x: -44 + i * 22, z, rot, side: rot ? 'S' : 'N', scale: 0.9 });
export const PLOT_SLOTS = [
  ...[1, 2, 3, 4, 5].map((id, i) => lot(id, i, 268, 0)),
  ...[6, 7, 8, 9, 10].map((id, i) => lot(id, i, 292, Math.PI)),
  ...[11, 12, 13, 14, 15].map((id, i) => lot(id, i, 318, 0)),
  ...[16, 17, 18, 19, 20].map((id, i) => lot(id, i, 342, Math.PI)),
];

/** OpenStreetMap buildings replaced by game structures (K-Town lots, the TKTS booth under the red steps). */
export const SKIP_ZONES = [
  { x0: -30, x1: -12, z0: -145, z1: -123 },
  // South pad for the 20 lots and the dance floor. The canyon north of this stays.
  { x0: -70, x1: 70, z0: 255, z1: 395 },
];
/** No auto-generated lamps/trees/subway railings here (hand-built areas). */
export const NO_PROPS = [
  { x0: -30, x1: -12, z0: -146, z1: -118 },
  { x0: 8, x1: 40, z0: 8, z1: 168 },
  { x0: -70, x1: 70, z0: 250, z1: 398 },
];
export const NO_TREES = [{ x0: -12, x1: 12, z0: 356, z1: 376 }];
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

export function inZones(zones, x, z) {
  for (const q of zones) if (x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1) return true;
  return false;
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
  { id: 'lots', ko: '분양 구역', en: 'Lots', x: 0, z: 305, g: '🏗️', major: true },
  ...MAP_LANDMARKS.filter(l => !['timessq', 'ktown', 'bryant'].includes(l.id) && insideLoop(l.x, l.z, 0)).map(l => {
    if (l.id === 'rock') return { ...l, ko: '30 록펠러 플라자', en: '30 Rockefeller Plaza', x: 406, z: -328, g: '🏢', major: true };
    const mark = { esb: '🏙️', chrysler: '🏢', flatiron: '🏢', owtc: '🏙️', gct: '🚉', msg: '🏟️', un: '🏛️' }[l.id];
    return mark ? { ...l, g: mark, major: true } : { ...l, g: '📍' };
  }),
];

export const PLAZA_CENTER = { x: 16, z: 90 };
