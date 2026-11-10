// Times Square dressing on the real buildings: the night photos (Wikimedia Commons, see
// assets/times-square/credits.json), animated ad screens and blade signs on every facade facing the
// bowtie — from street level up to the tower tops — MAIN_S wrapped around One Times Square, SUB_B1..4
// on the canyon walls, the New Year's ball, steam stacks, and the Koreatown gate on W 32nd St.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TILE } from './nyc.js';
import { LAYOUT } from './layout.js';
import { Kit, cropPlane, imgCrop } from './kit.js';
import { makeCanvas, paintAdAtlas, paintBlade, paintLabel, paintGlow, paintNeonSign } from './art.js';
import { screenTime } from './screens.js';

const ONE = new THREE.Vector3(1, 1, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const C = {
  m13a: ['night-2013', imgCrop(0, 0.17, 0.24, 0.70), 0.68],
  m13b: ['night-2013', imgCrop(0.69, 0.16, 0.95, 0.66), 0.78],
  m25a: ['night-2025', imgCrop(0.6, 0.08, 1.0, 0.58), 1.2],
  m25b: ['night-2025', imgCrop(0, 0, 0.17, 0.48), 0.53],
  m25c: ['night-2025', imgCrop(0.29, 0.18, 0.43, 0.58), 0.52],
  bbA: ['night-billboards', imgCrop(0.2, 0.05, 1.0, 0.44), 3.6],
  lkA: ['night-lionking', imgCrop(0.52, 0.1, 0.99, 0.68), 1.21],
  lkB: ['night-lionking', imgCrop(0.08, 0.16, 0.17, 0.8), 0.21],
  pnA: ['night-pano', imgCrop(0.38, 0, 0.76, 0.62), 2.72],
  pnB: ['night-pano', imgCrop(0, 0, 0.2, 0.65), 1.36],
  pnC: ['night-pano', imgCrop(0.8, 0, 1.0, 0.72), 1.23],
  cyL: ['night-canyon', imgCrop(0, 0.1, 0.33, 0.72), 1.28],
  cyR: ['night-canyon', imgCrop(0.72, 0, 1.0, 0.72), 0.94],
  stL: ['night-steps', imgCrop(0, 0.02, 0.22, 0.5), 1.22],
  stR: ['night-steps', imgCrop(0.66, 0, 1.0, 0.58), 1.56],
  p2A: ['night-pano2', imgCrop(0, 0, 0.14, 0.72), 0.9],
  p2B: ['night-pano2', imgCrop(0.42, 0.05, 0.62, 0.62), 1.62],
  p2C: ['night-pano2', imgCrop(0.66, 0.15, 0.84, 0.62), 1.77],
};
export const PHOTO_FILES = [...new Set(Object.values(C).map(c => c[0]))];
const PHOTO_KEYS = Object.keys(C);
const TALL_KEYS = PHOTO_KEYS.filter(k => C[k][2] < 1);
const WIDE_KEYS = PHOTO_KEYS.filter(k => C[k][2] >= 1);

const BLADES = ['K-TOWN', 'BROADWAY', 'THEATRE', 'HOTEL', 'K-POP', '서울식당', '노래방', 'K-BBQ', '치킨', 'CAFE 서울', '포장마차', 'HOTPOT'];
const BLADE_COLORS = ['#ff3d9a', '#ffcf5a', '#3fe6ff', '#ff6a3d', '#b84dff', '#39f58a', '#ffe2a8', '#ff7ac0', '#ffb020', '#3fe6ff', '#ff3d9a', '#ff6a3d'];
const ACCENTS = ['#3fe6ff', '#ff3d9a', '#ffcf5a', '#b84dff', '#39f58a', '#ff6a3d'];

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function segPointDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0;
  const qx = ax + dx * t, qz = az + dz * t;
  return [Math.hypot(px - qx, pz - qz), qx, qz];
}

export function buildTimesSquare(ctx) {
  const { scene, renderer, manager, kitMats, boards, nyc, quality, colliders, world } = ctx;
  const low = quality === 'low';
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const loader = new THREE.TextureLoader(manager);
  const updaters = [];
  const kit = new Kit();
  const r = mulberry(4242);
  const B = nyc.buildings;

  // ---- materials ---------------------------------------------------------------------------------------
  const photoMats = {}, photoTextures = {};
  for (const name of PHOTO_FILES) {
    const t = loader.load(`/assets/times-square/${name}${low ? '.m' : ''}.jpg`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    photoTextures[name] = t;
    photoMats[name] = new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(0.92, 0.92, 0.92) });
  }
  const toTex = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = aniso;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const adCanvas = makeCanvas(low ? 1024 : 2048, low ? 1024 : 2048);
  const adCells = paintAdAtlas(adCanvas);
  const adTex = toTex(adCanvas);
  const adMat = new THREE.MeshBasicMaterial({ map: adTex, color: new THREE.Color(1.0, 1.0, 1.0) });
  const bladeCanvas = makeCanvas(128 * BLADES.length, 1024);
  BLADES.forEach((n, i) => {
    const c = makeCanvas(128, 1024);
    paintBlade(c, n, BLADE_COLORS[i]);
    bladeCanvas.getContext('2d').drawImage(c, i * 128, 0);
  });
  const bladeMat = new THREE.MeshBasicMaterial({ map: toTex(bladeCanvas), color: new THREE.Color(1.05, 1.05, 1.05) });
  const slideMat = new THREE.MeshBasicMaterial({ map: adTex, color: new THREE.Color(1.1, 1.1, 1.1) });
  slideMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = screenTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPhase;\nuniform float uTime;\nvarying float vFlip;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
{
  float slot = uTime / 7.0 + aPhase;
  float cell = mod(floor(slot), 16.0);
  float cx = mod(cell, 4.0), cy = floor(cell / 4.0);
  vec2 inset = vec2(0.006) + uv * 0.988;
  vMapUv = vec2((cx + inset.x) / 4.0, 1.0 - (cy + 1.0 - inset.y) / 4.0);
  vFlip = fract(slot);
}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFlip;')
      .replace('#include <map_fragment>', `#include <map_fragment>
diffuseColor.rgb *= 0.2 + 0.8 * smoothstep(0.0, 0.03, vFlip);
diffuseColor.rgb += vec3(0.35, 0.3, 0.45) * (1.0 - smoothstep(0.0, 0.012, vFlip));`);
  };
  slideMat.customProgramCacheKey = () => 'kts-slideshow';

  // ---- facade helpers -------------------------------------------------------------------------------------------
  const photoGeos = {}, adGeos = [], bladeGeos = [], slideMats = [], slidePhase = [];
  const wanted = [];
  const faceM = (w, along, y, out) => {
    const p = new THREE.Vector3(w.mx + w.tx * along + w.nx * out, y, w.mz + w.tz * along + w.nz * out);
    return new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.atan2(w.nx, w.nz)), ONE);
  };
  const framed = (w, h, m, accent) => {
    kit.box(w + 0.5, h + 0.5, 0.35, '#111217', { z: -0.24, mat: 'metal', m });
    kit.box(w + 0.5, 0.08, 0.1, accent || '#ffe2a8', { y: h / 2 + 0.29, z: 0.02, glow: 2.0, m });
  };
  const photoAt = (key, m, h) => {
    const [file, crop, aspect] = C[key];
    const w = h * aspect;
    (photoGeos[file] ||= []).push(cropPlane(w, h, crop).applyMatrix4(m));
    framed(w, h, m);
    return w;
  };
  const adAt = (i, m, s) => {
    adGeos.push(cropPlane(s, s, adCells[i % adCells.length]).applyMatrix4(m));
    framed(s, s, m, '#ff3d9a');
  };
  const slideAt = (m, w, h) => {
    slideMats.push(m.clone().multiply(new THREE.Matrix4().makeScale(w, h, 1)));
    slidePhase.push(r() * 16);
    framed(w, h, m, ACCENTS[(r() * ACCENTS.length) | 0]);
  };
  // Former photo screens become real claimable boards. The biggest 24 mount; the rest stay as cycling ads.
  const wantBoard = (m, w, h, pri = 1) => {
    if (w < 5 || h < 3.2) { slideAt(m, Math.max(w, 4), Math.max(h, 2.4)); return; }
    wanted.push({ m, w, h, pri });
  };
  const mountBoard = (slot, m, w, h) => {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    m.decompose(p, q, s);
    const g = new THREE.Group();
    g.position.copy(p);
    g.quaternion.copy(q);
    scene.add(g);
    boards.mount(slot, g, { x: 0, y: 0, z: 0.05, w, h, frameT: Math.min(0.22, Math.max(0.08, h * 0.035)) });
  };
  const bladeAt = (name, x, y, z, ry, size) => {
    const i = Math.max(0, BLADES.indexOf(name));
    const u0 = (i * 128 + 2) / (128 * BLADES.length), u1 = ((i + 1) * 128 - 2) / (128 * BLADES.length);
    for (const flip of [0, Math.PI]) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(Y_AXIS, ry + flip), ONE);
      bladeGeos.push(cropPlane(2.1, size, [u0, 0, u1, 1]).applyMatrix4(m.multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.09))));
    }
    kit.box(2.4, size + 0.4, 0.16, '#121318', { mat: 'metal', x, y, z, ry });
  };

  /** Building walls (outward normal, tangent, midpoint) inside a rectangle. */
  function walls(x0, x1, z0, z1, minH = 8) {
    const out = [];
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
  const pickWall = (list, ax, az, nx, nz, minLen, minH) => {
    let best = null, bd = Infinity;
    for (const w of list) {
      if (w.len < minLen || w.h < minH || w.nx * nx + w.nz * nz < 0.75) continue;
      const d = Math.hypot(w.mx - ax, w.mz - az);
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  };

  // ---- the bowtie: facades facing the square ----------------------------------------------------------------------
  const AXES = [[-1, -250, -1, 262], [-63.4, -233, 49, 249.7]];
  const facing = walls(-110, 120, -250, 262, 9).filter(w => {
    let best = Infinity, qx = 0, qz = 0;
    for (const [ax, az, bx, bz] of AXES) { const [d, x, z] = segPointDist(w.mx, w.mz, ax, az, bx, bz); if (d < best) { best = d; qx = x; qz = z; } }
    if (best > 95 || best < 4) return false;
    const vx = (qx - w.mx) / best, vz = (qz - w.mz) / best;
    w.dist = best;
    return w.nx * vx + w.nz * vz > (best > 60 ? 0.62 : 0.5);
  });
  const used = new Set();
  // SUB boards on the canyon walls (curved, with tickers).
  const SUB_ANCHORS = { SUB_B1: [-42, -40, 1, 0], SUB_B2: [14, -112, -1, 0], SUB_B3: [-14, 124, 1, 0], SUB_B4: [40, 58, -1, 0] };
  for (const [slot, [ax, az, nx, nz]] of Object.entries(SUB_ANCHORS)) {
    const w = pickWall(facing, ax, az, nx, nz, 13, 26) || pickWall(facing, ax, az, nx, nz, 9, 16);
    const width = w ? Math.min(17, w.len - 1.5) : 15, R = 15, sag = R * (1 - Math.cos(width / R / 2));
    const g = new THREE.Group();
    scene.add(g);
    if (w) {
      used.add(w);
      g.position.set(w.mx + w.nx * (sag + 0.7), 0, w.mz + w.nz * (sag + 0.7));
      g.rotation.y = Math.atan2(w.nx, w.nz);
    } else {
      g.position.set(ax, 0, az);
      g.rotation.y = Math.atan2(nx, nz);
    }
    boards.mount(slot, g, { x: 0, y: 21, z: 0, w: width, h: width * 9 / 16, curve: R, ticker: true, tickerH: 1.0, marquee: !low });
  }
  // Everything else facing the square: street-level screens, mid-height billboards, and screens up the towers.
  for (const w of facing) {
    const L = w.len, H = w.h;
    if (H < 9) continue;
    const reserved = used.has(w) || w.dist > 60;
    // low band, 6–15 m
    if (!reserved && L >= 6) {
      const n = Math.max(1, Math.round(L / 13));
      for (let k = 0; k < n; k++) {
        const along = -L / 2 + (k + 0.5) * L / n;
        const slotW = L / n - 1.2;
        if (slotW < 4) continue;
        const roll = r();
        if (roll < 0.5) {
          const key = WIDE_KEYS[(r() * WIDE_KEYS.length) | 0];
          const ph = Math.min(7.5, slotW / C[key][2]);
          if (ph > 2.5) wantBoard(faceM(w, along, Math.min(H - 1, 6.2 + ph / 2), 0.32), ph * C[key][2], ph, 0);
        } else if (roll < 0.88) {
          const sw = Math.min(slotW, 12), sh = Math.min(7, sw * 9 / 16);
          wantBoard(faceM(w, along, Math.min(H - 1, 6.4 + sh / 2), 0.32), sw, sh, 0);
        } else {
          const s = Math.min(slotW, 6);
          wantBoard(faceM(w, along, 6.4 + s / 2, 0.32), s, s, 0);
        }
      }
    }
    // mid band, 16–40 m
    if (!reserved && H > 22 && L >= 8) {
      const sw = Math.min(L * 0.84, 10 + r() * 12);
      const key = r() < 0.5 ? TALL_KEYS[(r() * TALL_KEYS.length) | 0] : WIDE_KEYS[(r() * WIDE_KEYS.length) | 0];
      const aspect = C[key][2];
      let ph = sw / aspect;
      ph = Math.min(ph, H - 18, 20);
      if (ph > 4 && r() < 0.6) wantBoard(faceM(w, 0, 16 + ph / 2 + r() * 4, 0.32), ph * aspect, ph, 1);
      else if (H > 26) { const sh = Math.min(sw * 9 / 16, H - 20); wantBoard(faceM(w, 0, 17 + sh / 2, 0.32), sh * 16 / 9, sh, 1); }
    }
    // high band: screens up the towers (two side by side on wide walls)
    if (H > 44 && L >= 8) {
      const cols = L > 34 ? [-L / 4, L / 4] : [0];
      for (let y0 = 38; y0 + 10 < Math.min(H - 3, 190); y0 += 24 + r() * 16) {
        for (const cx of cols) {
          if (r() > 0.88) continue;
          const tall = r() < 0.45;
          const room = cols.length > 1 ? L / 2 - 2 : L - 2;
          const sw = Math.min(room * 0.9, tall ? 9 + r() * 6 : 14 + r() * 10);
          const sh = Math.min(tall ? sw * 1.5 : sw * 9 / 16, H - y0 - 3);
          if (sh < 5) continue;
          const along = cx + (r() - 0.5) * Math.max(0, room - sw) * 0.5;
          wantBoard(faceM(w, along, y0 + sh / 2, 0.34), sw, sh, 2);
        }
      }
    }
    // blade signs
    if (L > 14 && H > 18 && w.dist <= 60 && r() < 0.35) {
      const along = (r() < 0.5 ? -1 : 1) * (L / 2 - 2.2);
      const p = new THREE.Vector3(w.mx + w.tx * along + w.nx * 1.55, 0, w.mz + w.tz * along + w.nz * 1.55);
      bladeAt(BLADES[(r() * 5) | 0], p.x, 15, p.z, Math.atan2(w.nx, w.nz) + Math.PI / 2, 12);
    }
  }

  // ---- One Times Square ----------------------------------------------------------------------------------------------
  const OT = LAYOUT.oneTimes;
  const mainW = 20, mainR = 12;
  const mainGroup = new THREE.Group();
  mainGroup.position.set(OT.x, 0, OT.z - 1.2);
  mainGroup.rotation.y = Math.PI;
  scene.add(mainGroup);
  boards.mount('MAIN_S', mainGroup, { x: 0, y: 25, z: 0, w: mainW, h: mainW * 9 / 16, curve: mainR, ticker: true, tickerH: 1.4, marquee: true });
  const tipM = (y, out = 0.6) => new THREE.Matrix4().compose(new THREE.Vector3(OT.x, y, OT.z - out), new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI), ONE);
  let towerN = 0;
  for (const [y, h, aspect] of [[10, 7.5, 0.53], [40.5, 7.4, 1.56], [50.6, 8.2, 1.36], [61.6, 10, 0.78], [73, 8.6, 1.21]]) {
    mountBoard('TOWER_' + (++towerN), tipM(y, 0.6), h * aspect, h);
  }
  const towerFace = (y) => new THREE.Matrix4().compose(new THREE.Vector3(20.2, y, 215.0), new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI), ONE);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(12, 2), new THREE.MeshBasicMaterial({ map: toTex(paintLabel(makeCanvas(1024, 170), 'K-TIMES SQUARE', '#ffe7a3', '#07070d')), color: new THREE.Color(1.1, 1.1, 1.1) }));
  label.applyMatrix4(towerFace(86));
  scene.add(label);
  kit.box(12.6, 2.6, 0.3, '#111217', { mat: 'metal', m: towerFace(86).multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.2)) });
  wantBoard(towerFace(97), 11, 6.2, 0);
  const roof = OT.roof;
  kit.box(1.2, 0.5, 1.2, '#16171c', { x: roof.x, y: roof.h + 0.25, z: roof.z, mat: 'metal' });
  kit.cyl(0.32, 0.45, 15, '#9aa0aa', { x: roof.x, y: roof.h + 7.5, z: roof.z, mat: 'metal' });
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 1), new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xfff0c8, emissiveIntensity: 1.4, roughness: 0.15, metalness: 0.6, flatShading: true }));
  ball.position.set(roof.x, roof.h + 15.5, roof.z);
  scene.add(ball);
  updaters.push((dt) => { ball.rotation.y += dt * 0.3; });

  // ---- Koreatown: neon gate, blade signs, its own big screen -------------------------------------------------------------
  const K = LAYOUT.ktown;
  {
    const gx = K.x0 - 13, z0 = K.z - 7.6, z1 = K.z + 7.6;
    for (const z of [z0, z1]) {
      kit.box(0.9, 9, 0.9, '#7a0d1c', { x: gx, y: 4.5, z, mat: 'gloss' });
      kit.box(1.1, 0.4, 1.1, '#ffcf5a', { x: gx, y: 9.1, z, glow: 1.6 });
      colliders.push({ x0: gx - 0.5, x1: gx + 0.5, z0: z - 0.5, z1: z + 0.5 });
    }
    kit.box(0.7, 1.2, z1 - z0 + 1.6, '#16171c', { x: gx, y: 8.2, z: K.z, mat: 'metal' });
    const c = makeCanvas(1024, 160);
    paintNeonSign(c, 'K-TOWN 코리아타운', '#ff3d9a', 'KOREA WAY · W 32ND ST');
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(z1 - z0 + 1.2, 2.2), new THREE.MeshBasicMaterial({ map: toTex(c), transparent: true, color: new THREE.Color(1.25, 1.25, 1.25) }));
    for (const s of [-1, 1]) {
      const m = sign.clone();
      m.position.set(gx + s * 0.38, 8.2, K.z);
      m.rotation.y = s * Math.PI / 2;
      scene.add(m);
    }
    const kw = walls(K.x0 - 70, K.x0 + (K.n - 1) * K.step + 70, K.z - 30, K.z + 30, 12).filter(w => Math.abs(w.nz) > 0.8 && Math.sign(w.nz) === Math.sign(K.z - w.mz));
    let n = 0;
    for (const w of kw) {
      if (n > 14) break;
      const p = new THREE.Vector3(w.mx + w.nx * 1.55, 0, w.mz + w.nz * 1.55);
      bladeAt(BLADES[5 + (n % 7)], p.x + w.tx * (w.len / 2 - 2.5), 9.5 + (n % 3), p.z + w.tz * (w.len / 2 - 2.5), Math.atan2(w.nx, w.nz) + Math.PI / 2, 9);
      n++;
    }
    const end = walls(K.x0 + K.n * K.step + 8, K.x0 + K.n * K.step + 120, K.z - 14, K.z + 14, 14);
    const sw = pickWall(end, K.x0 + K.n * K.step + 60, K.z, -1, 0, 9, 18);
    if (sw) {
      const g = new THREE.Group();
      g.position.set(sw.mx + sw.nx * 0.5, 0, sw.mz + sw.nz * 0.5);
      g.rotation.y = Math.atan2(sw.nx, sw.nz);
      scene.add(g);
      const ww = Math.min(14, sw.len - 1);
      boards.mount('MAIN_S', g, { x: 0, y: 13, z: 0, w: ww, h: ww * 9 / 16 });
    }
  }

  // ---- steam stacks -----------------------------------------------------------------------------------------------------
  const puffTex = new THREE.CanvasTexture(paintGlow(makeCanvas(64, 64), 'rgba(255,255,255,0.8)'));
  const puffs = [];
  for (const [sx, sz] of [[5.9, 140], [-7.6, -24], [-6.8, -190], [480, 1060.5]]) {
    for (let i = 0; i < 5; i++) kit.cyl(0.42 - i * 0.03, 0.44 - i * 0.03, 0.5, i % 2 ? '#f4f4f0' : '#ff6a1a', { x: sx, y: 0.25 + i * 0.5, z: sz, seg: 16, mat: 'gloss' });
    colliders.push({ x0: sx - 0.5, x1: sx + 0.5, z0: sz - 0.5, z1: sz + 0.5 });
    const n = low ? 6 : 12;
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: 0xd8dce6, transparent: true, depthWrite: false, opacity: 0 }));
      s.layers.set(2);
      s.userData = { age: (i / n) * 3.2, sx, sz };
      scene.add(s);
      puffs.push(s);
    }
  }
  updaters.push((dt) => {
    for (const s of puffs) {
      const a = (s.userData.age += dt);
      const u = (a % 3.2) / 3.2;
      s.position.set(s.userData.sx + Math.sin(a * 1.7) * 0.3 * u + u * 1.2, 2.6 + u * 7, s.userData.sz + Math.cos(a) * 0.3 * u);
      const sc = 0.9 + u * 4.2;
      s.scale.set(sc, sc, 1);
      s.material.opacity = Math.sin(Math.PI * u) * 0.3;
    }
  });

  // ---- commit -----------------------------------------------------------------------------------------------------------
  wanted.sort((a, b) => a.pri - b.pri || b.w * b.h - a.w * a.h);
  let wallN = 0;
  for (const item of wanted) {
    if (wallN < 64) mountBoard('WALL_' + (++wallN), item.m, item.w, item.h);
    else slideAt(item.m, item.w, item.h);
  }
  const putMesh = (geos, mat) => {
    if (!geos.length) return null;
    const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
    geos.forEach(g => g.dispose());
    scene.add(m);
    return m;
  };
  for (const [file, geos] of Object.entries(photoGeos)) putMesh(geos, photoMats[file]);
  putMesh(adGeos, adMat);
  putMesh(bladeGeos, bladeMat);
  if (slideMats.length) {
    const slideGeo = new THREE.PlaneGeometry(1, 1);
    slideGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(slidePhase), 1));
    const slides = new THREE.InstancedMesh(slideGeo, slideMat, slideMats.length);
    slideMats.forEach((m, i) => slides.setMatrixAt(i, m));
    slides.instanceMatrix.needsUpdate = true;
    slides.computeBoundingSphere();
    scene.add(slides);
  }
  scene.add(kit.build(kitMats));

  function update(dt, t) { for (const u of updaters) u(dt, t); }
  return {
    update, photoTextures,
    mainScreenCenter: new THREE.Vector3(OT.x, 25, OT.z - 1.2),
    panels: slideMats.length + Object.values(photoGeos).reduce((a, l) => a + l.length, 0),
  };
}
