// Game layout on the real Manhattan street grid. Meters; origin at 7th Ave & W 45th St, north is -Z,
// +X runs crosstown toward the East River (see tools/build-nyc.mjs). Streets and buildings come from
// OpenStreetMap through ts3d/nycmeta.js + /assets/nyc/manhattan.bin; this file pins the hand-placed
// game features onto that map.
import { NYC_META, LANDMARKS as MAP_LANDMARKS } from './nycmeta.js';

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
  // K-POP stage on the Bryant Park lawn, facing north toward W 42nd St.
  stage: { cx: 371.5, x0: 363.5, x1: 379.5, z0: 340, z1: 352, h: 0.75, spot: { x: 371.5, z: 346, r: 3.8 } },
  bryant: { x0: 327, x1: 416, z0: 305, z1: 359 },
  // Koreatown: W 32nd St ("Korea Way") between Broadway and 5th Ave.
  ktown: { z: 1053, x0: 397, step: 11.5, n: 10, depth: 15.5 },
};

export const TAXI_STANDS = [
  { x: 9.4, z: 72, axis: 'z', name: '타임스퀘어' },
  { x: -11.6, z: -40, axis: 'z', name: '더피 스퀘어' },
  { x: 330, z: 260.6, axis: 'x', name: '브라이언트 파크' },
  { x: 452, z: 1046.4, axis: 'x', name: 'K-타운' },
  { x: 880, z: 240.6, axis: 'x', name: '그랜드 센트럴' },
  { x: -11.6, z: 1010, axis: 'z', name: '펜 스테이션' },
  { x: 284.8, z: -350, axis: 'z', name: '록펠러 센터' },
  { x: 150, z: -1116.5, axis: 'x', name: '센트럴 파크' },
];

const K = LAYOUT.ktown;
// rot turns the lot's local +Z (its street front) toward W 32nd St.
export const PLOT_SLOTS = [
  ...Array.from({ length: K.n }, (_, i) => ({ id: i + 1, x: K.x0 + i * K.step, z: K.z - K.depth, rot: 0, side: 'N', scale: 1.25 })),
  ...Array.from({ length: K.n }, (_, i) => ({ id: i + 11, x: K.x0 + i * K.step, z: K.z + K.depth, rot: Math.PI, side: 'S', scale: 1.25 })),
];

/** OpenStreetMap buildings replaced by game structures (K-Town lots, the TKTS booth under the red steps). */
export const SKIP_ZONES = [
  { x0: 384, x1: 514, z0: 1006, z1: 1047 },
  { x0: 384, x1: 514, z0: 1059, z1: 1100 },
  { x0: -30, x1: -12, z0: -145, z1: -123 },
];
/** No auto-generated lamps/trees/subway railings here (hand-built areas). */
export const NO_PROPS = [
  { x0: -30, x1: -12, z0: -146, z1: -118 },
  { x0: 8, x1: 40, z0: 8, z1: 168 },
  { x0: 356, x1: 387, z0: 330, z1: 360 },
  { x0: 384, x1: 514, z0: 1020, z1: 1086 },
];
export const NO_TREES = [{ x0: 327, x1: 416, z0: 305, z1: 359 }];
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
  { id: 'lots', ko: 'K-타운 분양 구역', en: 'Koreatown Lots', x: K.x0 + (K.n - 1) * K.step / 2, z: K.z, g: '🏗️', major: true },
  ...MAP_LANDMARKS.filter(l => !['timessq', 'ktown', 'bryant'].includes(l.id)).map(l => {
    if (l.id === 'rock') return { ...l, ko: '30 록펠러 플라자', en: '30 Rockefeller Plaza', x: 406, z: -328, g: '🏢', major: true };
    const mark = { esb: '🏙️', chrysler: '🏢', flatiron: '🏢', owtc: '🏙️', gct: '🚉', msg: '🏟️', un: '🏛️' }[l.id];
    return mark ? { ...l, g: mark, major: true } : { ...l, g: '📍' };
  }),
  { id: 'bryant', ko: '브라이언트 파크', en: 'Bryant Park', x: 356, z: 300, g: '🌳' },
];

export const PLAZA_CENTER = { x: 16, z: 90 };
