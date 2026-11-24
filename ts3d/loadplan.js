// What the plaza downloads, and when. Pure: no three.js, so tests and tools/load-budget.mjs read the same table.
// Own species model and the city load at boot; another species loads the first time an avatar of it is on screen
// (the stand-in body shows meanwhile), or in an idle prefetch a while after entering, and then only the species the
// room's other players wear (prefetchIds): ten models of ~0.8 MB each are never fetched blind. The plot buildings load
// when the player nears their street (LOT_MODEL_URL below).
// New model files get new names: sw.js serves /assets/* cache-first by URL, so a file replaced under the same name
// stays stale for returning players until the sw.js?v= revision changes.
export const MODEL_URL = {
  1: '/assets/models/MouseToy.glb',
  2: '/assets/models/CatToy.glb',
  3: '/assets/models/BearToy.glb',
  4: '/assets/models/RabbitToy.glb',
  5: '/assets/models/PuppyToy.glb',
  6: '/assets/models/PandaToy.glb',
  7: '/assets/models/FoxToy.glb',
  8: '/assets/models/PenguinToy.glb',
  9: '/assets/models/HamsterToy.glb',
  10: '/assets/models/TigerToy.glb',
};

// The plot buildings, one file per level (0 empty lot, 1 tent, 2 stall, 3 shop, 4 tower), from tools/blender/build_props.py.
// None is fetched at boot: ts3d/landmarks.js asks for all five, each once, the first time the camera or the player is
// within LOTS_R of the lots' street (a link that lands on a plot puts the player there on its first frame), and shows
// its box buildings until they are in, or for good when a file fails. The same rule as above for a changed file: a new name.
export const LOT_MODEL_URL = {
  0: '/assets/models/lots/lot0_empty.glb',
  1: '/assets/models/lots/lot1_tent.glb',
  2: '/assets/models/lots/lot2_pocha.glb',
  3: '/assets/models/lots/lot3_shop.glb',
  4: '/assets/models/lots/lot4_tower.glb',
};
export const LOTS_R = 150;
// Whether (x, z) is within `r` metres of the street's centre line (street: { x, z0, z1 }, ts3d/layout.js LAYOUT.street).
export function nearLots(x, z, street, r = LOTS_R) {
  if (!street || !Number.isFinite(x) || !Number.isFinite(z)) return false;
  const dz = z < street.z0 ? street.z0 - z : z > street.z1 ? z - street.z1 : 0;
  return Math.hypot(x - street.x, dz) <= r;
}

// The real night photos only light the PMREM environment (cube faces are 256 px), so one small copy serves every tier.
export const ENV_PHOTOS = ['night-2025', 'night-pano', 'night-steps', 'night-canyon'];
export const envPhotoUrl = (name) => `/assets/times-square/${name}.env.jpg`;
export const TAXI_URL = '/assets/models/taxi.glb'; // the cab and car model: ts3d/traffic.js asks for it once the street is on screen (the box cars stand in until it is there)

// A remote avatar still on the stand-in asks for its model once it is in the view frustum and this close (m).
export const SEE_R = 90;
export const seesAvatar = (dist, inView) => !!inView && Number.isFinite(dist) && dist <= SEE_R;

// Which model shows for an avatar of species `id`, and which one to fetch for it.
// loaded / missing: Sets (or Maps keyed by species id) of GLBs that arrived / failed.
export function modelFor(id, { loaded, missing }) {
  if (loaded.has(id)) return { show: id, need: 0 };
  if (!missing.has(id)) return { show: 0, need: id };
  if (loaded.has(1)) return { show: 1, need: 0 };
  for (const k of loaded.keys()) return { show: k, need: 0 };
  return missing.has(1) ? { show: 0, need: 0 } : { show: 0, need: 1 };
}

// Idle prefetch of the other species after entering: ms to wait, or null to skip (low tier, Save-Data).
export const PREFETCH_MS = 60000;
export function prefetchDelay({ quality, saveData } = {}) {
  return quality === 'low' || saveData ? null : PREFETCH_MS;
}
// Which models that prefetch asks for: the species worn by the room's other players (`peers`, their `av` values),
// minus the ones already loaded or failed, at most PREFETCH_MAX of them, most worn first. Unknown ids are dropped.
export const PREFETCH_MAX = 3;
export function prefetchIds(peers, { loaded, missing } = {}) {
  const n = new Map();
  for (const v of peers || []) {
    const id = Number(v);
    if (!Number.isInteger(id) || !MODEL_URL[id] || loaded?.has(id) || missing?.has(id)) continue;
    n.set(id, (n.get(id) || 0) + 1);
  }
  return [...n].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, PREFETCH_MAX).map(([id]) => id);
}
