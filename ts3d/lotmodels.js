// The plot buildings as models: five GLB files (ts3d/loadplan.js LOT_MODEL_URL, written by tools/blender/build_props.py),
// fetched once and shared by all 18 lots. A file's flat-colour materials are baked into vertex colours and merged into
// at most four geometries, one per kind of surface (LOT_PARTS), so a lot is three or four draw calls whatever the
// file's material count. Every one of them is drawn with a shader the plaza has compiled already (the kit's lit and
// unlit vertex-colour programs, ts3d/kit.js), so nothing compiles when the buildings appear.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LOT_MODEL_URL } from './loadplan.js?v=202611280944';

/** The surfaces a lot is drawn with:
 *   matte   lit, the file's colours (walls, paving, wood, cloth, trim, dark glass)
 *   metal   lit, shinier (the file's `Metal`: steel masts, the stall's cabinet)
 *   glow    unlit, brighter than white where the file says so (neon, lit windows, lanterns): the kit's glow material
 *   accent  the file's `Accent`, which takes the owner's colour: the one material a lot does not share */
export const LOT_PARTS = ['matte', 'metal', 'glow', 'accent'];
/** An empty lot has no owner: its `Accent` (the kerb, two ribbons) is this colour, unlit at this strength, as the box
 *  lot's border was. It goes into the glow part, so an empty lot has no accent part to draw. */
export const EMPTY_ACCENT = '#ffe2a8', EMPTY_GLOW = 0.55;
/** What an owned lot's accent material is set to: the colour, and this much of it as its own light. */
export const ACCENT_GLOW = 0.45;

const GLOW_MIN = 1;      // emissive strength x its brightest channel from which a material is drawn unlit
const METAL_MIN = 0.55;  // metalness above which a lit material goes to `metal`
const WHITE = new THREE.Color(1, 1, 1);
const round = (v) => Math.round(v * 1e4) / 1e4;

function partOf(m) {
  if (m.name === 'Accent') return 'accent';
  const e = m.emissive ? Math.max(m.emissive.r, m.emissive.g, m.emissive.b) * (m.emissiveIntensity ?? 1) : 0;
  if (e >= GLOW_MIN) return 'glow';
  return (m.metalness ?? 0) > METAL_MIN ? 'metal' : 'matte';
}
const under = (o, name) => { for (let p = o; p; p = p.parent) if (p.name === name) return true; return false; };

/** A copy of `src` (position and normal only) moved by `matrix`, every vertex coloured `c`. */
function tinted(src, matrix, c) {
  const g = new THREE.BufferGeometry();
  if (src.index) g.setIndex(src.index.clone());
  g.setAttribute('position', src.attributes.position.clone());
  if (src.attributes.normal) g.setAttribute('normal', src.attributes.normal.clone());
  if (matrix) g.applyMatrix4(matrix);
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const trisOf = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
function share(g) {
  g.userData.shared = true; // ts3d/landmarks.js clearPlot leaves these alone
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/**
 * A loaded GLB as the pieces a lot draws.
 *   parts    Map of LOT_PARTS name -> one merged geometry in the lot's frame (metres, front +Z), with vertex colours
 *   gem      the node `Gem` kept apart so the game can turn it: { geometry, position, material: the file's values } or null
 *   anchors  { board, sign }: the file's BoardAnchor and SignAnchor as { x, y, z, w, h }
 *   tris     triangles in all of it
 * accent: a colour to bake the file's `Accent` into the glow part with (the empty lot), at `accentGlow` strength.
 */
export function prepareLot(gltf, { accent = null, accentGlow = EMPTY_GLOW } = {}) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const lists = new Map(), anchors = {};
  let gem = null;
  root.traverse((o) => {
    if (o.name === 'BoardAnchor' || o.name === 'SignAnchor') {
      anchors[o.name === 'BoardAnchor' ? 'board' : 'sign'] = { x: round(o.position.x), y: round(o.position.y), z: round(o.position.z), w: round(o.scale.x), h: round(o.scale.y) };
      return;
    }
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m) return;
    if (under(o, 'Gem')) {
      if (gem) return;
      gem = {
        geometry: share(tinted(o.geometry, null, WHITE)),
        position: o.getWorldPosition(new THREE.Vector3()),
        material: { color: m.color.clone(), roughness: m.roughness, metalness: m.metalness, emissive: m.emissive.clone(), emissiveIntensity: m.emissiveIntensity ?? 1 },
      };
      return;
    }
    const baked = accent && m.name === 'Accent';
    const part = baked ? 'glow' : partOf(m);
    const c = baked ? new THREE.Color(accent).multiplyScalar(accentGlow)
      : part === 'glow' ? m.emissive.clone().multiplyScalar(m.emissiveIntensity ?? 1)
        : part === 'accent' ? WHITE : m.color;
    if (!lists.has(part)) lists.set(part, []);
    lists.get(part).push(tinted(o.geometry, o.matrixWorld, c));
  });
  const parts = new Map();
  let tris = gem ? trisOf(gem.geometry) : 0;
  for (const name of LOT_PARTS) {
    let list = lists.get(name);
    if (!list) continue;
    if (list.some((g) => !g.index) && list.some((g) => g.index)) list = list.map((g) => (g.index ? g.toNonIndexed() : g));
    const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (!geo) throw new Error('lot model: the ' + name + ' part does not merge');
    if (list.length > 1) for (const g of list) g.dispose();
    parts.set(name, share(geo));
    tris += trisOf(geo);
  }
  if (!parts.size) throw new Error('lot model: no mesh in the file');
  return { parts, gem, anchors, tris };
}

/** Frees what GLTFLoader made for a file once prepareLot has taken its copies. */
function release(gltf) {
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) m.dispose();
  });
}

const fetchGlb = (url) => new Promise((resolve, reject) => { new GLTFLoader().load(url, resolve, undefined, reject); });

/**
 * The five files, asked for once by want() and never again (a file that fails stays missing for the session: the
 * caller's stand-in stays). Nothing here throws into the caller.
 *   urls      level -> URL (LOT_MODEL_URL)
 *   loadGlb   (url) -> Promise of a GLTFLoader result; tests read the file from disk instead
 *   glow      the unlit vertex-colour material to draw the glow part with (kitMaterials().glow)
 *   accept    (level, prepared) -> false to turn a file down (its board mount is not where the game hangs the board)
 *   onLevel   (level) called when that level's model is ready to draw
 */
export function createLotModels({ urls = LOT_MODEL_URL, loadGlb = fetchGlb, glow = null, accept = null, onLevel = null } = {}) {
  const ownGlow = glow ? null : new THREE.MeshBasicMaterial({ vertexColors: true });
  // Roughness and metalness of the files' Body and Metal (PALETTE in tools/blender/build_props.py); the gem takes the
  // file's own values when the empty lot's file is in. All four are the kit's lit vertex-colour program.
  const mats = {
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.65 }),
    glow: glow || ownGlow,
    gem: new THREE.MeshStandardMaterial({ vertexColors: true, color: '#ffcf5a', roughness: 0.18, metalness: 0.3, emissive: '#ffb52e', emissiveIntensity: 1.3 }),
  };
  const ready = new Map(), missing = new Set();
  let started = false, left = 0, settle = null;
  const settledP = new Promise((r) => { settle = r; });

  function arrived(level, gltf) {
    const prep = prepareLot(gltf, level === 0 ? { accent: EMPTY_ACCENT } : {});
    release(gltf);
    if (accept && accept(level, prep) === false) {
      for (const g of prep.parts.values()) g.dispose();
      prep.gem?.geometry.dispose();
      throw new Error('not the model this build expects');
    }
    if (prep.gem) {
      const g = prep.gem.material;
      mats.gem.color.copy(g.color);
      mats.gem.emissive.copy(g.emissive);
      mats.gem.roughness = g.roughness;
      mats.gem.metalness = g.metalness;
      mats.gem.emissiveIntensity = g.emissiveIntensity;
    }
    ready.set(level, prep);
  }

  /** Starts the five downloads. Returns false when they were started before. */
  function want() {
    if (started) return false;
    started = true;
    const levels = Object.keys(urls).map(Number);
    left = levels.length;
    if (!left) settle();
    for (const level of levels) {
      let p;
      try { p = Promise.resolve(loadGlb(urls[level])); } catch (err) { p = Promise.reject(err); }
      p.then((gltf) => arrived(level, gltf))
        .then(() => { try { onLevel?.(level); } catch (err) { console.error('[lots]', err); } },
          (err) => { missing.add(level); console.warn('[lots] ' + urls[level] + ': ' + (err?.message || err) + ' (the box building stays)'); })
        .then(() => { if (--left === 0) settle(); });
    }
    return true;
  }

  return {
    want, mats, missing,
    get started() { return started; },
    /** The prepared model for a level, or null while it is not in (or failed). */
    get: (level) => ready.get(level) || null,
    /** Resolves once every file has arrived or failed (never rejects). */
    settled: () => settledP,
    dispose() {
      for (const prep of ready.values()) { for (const g of prep.parts.values()) g.dispose(); prep.gem?.geometry.dispose(); }
      ready.clear();
      mats.matte.dispose(); mats.metal.dispose(); mats.gem.dispose(); ownGlow?.dispose();
    },
  };
}
