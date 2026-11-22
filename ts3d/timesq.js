// Times Square dressing on the real buildings: the night photos (Wikimedia Commons, see
// assets/times-square/credits.json), animated ad screens and blade signs on every facade facing the
// bowtie — from street level up to the tower tops — MAIN_S wrapped around One Times Square, SUB_B1..4
// on the canyon walls, the New Year's ball, steam stacks, and the Koreatown gate on W 32nd St.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYOUT } from './layout.js?v=202611221059';
import { Kit, cropPlane, imgCrop } from './kit.js?v=202611221059';
import { makeCanvas, paintAdAtlas, paintBlade, paintLabel, paintGlow, paintNeonSign, THEMES } from './art.js?v=202611221059';
import { screenTime, addFrame } from './screens.js?v=202611221059';
import { planBowtie, wallsIn, pickWall, mulberry, STREET_OLD } from './bowtie.js?v=202611221059';
import { ENV_PHOTOS, envPhotoUrl } from './loadplan.js?v=202611221059';

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
// Only the four photos the environment map uses are fetched (photoAt is not called; the facades are ad screens now).
export const PHOTO_FILES = ENV_PHOTOS;
const PHOTO_KEYS = Object.keys(C);
const TALL_KEYS = PHOTO_KEYS.filter(k => C[k][2] < 1);
const WIDE_KEYS = PHOTO_KEYS.filter(k => C[k][2] >= 1);

const BLADES = ['K-TOWN', 'BROADWAY', 'THEATRE', 'HOTEL', 'K-POP', '서울식당', '노래방', 'K-BBQ', '치킨', 'CAFE 서울', '포장마차', 'HOTPOT'];
const BLADE_COLORS = ['#ff3d9a', '#ffcf5a', '#3fe6ff', '#ff6a3d', '#b84dff', '#39f58a', '#ffe2a8', '#ff7ac0', '#ffb020', '#3fe6ff', '#ff3d9a', '#ff6a3d'];
const ACCENTS = ['#3fe6ff', '#ff3d9a', '#ffcf5a', '#b84dff', '#39f58a', '#ff6a3d'];

export function buildTimesSquare(ctx) {
  const { scene, renderer, manager, kitMats, boards, nyc, quality, colliders, world } = ctx;
  const low = quality === 'low';
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const loader = new THREE.TextureLoader(manager);
  const updaters = [];
  const kit = new Kit();
  const r = mulberry(4242); // slideAt's phases and accents

  // ---- materials ---------------------------------------------------------------------------------------
  const photoMats = {}, photoTextures = {};
  for (const name of PHOTO_FILES) {
    const t = loader.load(envPhotoUrl(name));
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
  // Claimable boards only. WALL_1..500 stay scarce enough to fight over.
  const wantBoard = (m, w, h, pri = 1) => {
    if (w < 6 || h < 3.4) return;
    wanted.push({ m, w, h, pri });
  };
  // Real Times Square faces are a few huge 16:9 screens with a thin joint, not a scatter of posters.
  const coverWall = (w, hole) => {
    const gap = 0.7;
    const span = Math.max(6, w.len - 0.8);
    let cols = Math.max(1, Math.ceil(span / 26));
    let cw = (span - gap * (cols - 1)) / cols;
    if (cw < 11 && cols > 1) { cols = 1; cw = span; }
    const ch = cw * 9 / 16;
    if (ch < 4) return;
    const top = Math.min(w.h - 1, 120);
    let y = 3.2 + ch / 2;
    for (let guard = 0; y + ch / 2 <= top + 0.3 && guard < 16; guard++) {
      const y0 = y - ch / 2, y1 = y + ch / 2;
      if (hole && y1 > hole.y0 && y0 < hole.y1) { y = hole.y1 + gap + ch / 2; continue; }
      for (let c = 0; c < cols; c++) {
        const along = -span / 2 + cw / 2 + c * (cw + gap);
        wantBoard(faceM(w, along, y, 0.55), cw, ch, w.dist);
      }
      y += ch + gap;
    }
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

  const walls = (x0, x1, z0, z1, minH = 8) => wallsIn(nyc, x0, x1, z0, z1, minH);

  // ---- the bowtie: facades facing the square ----------------------------------------------------------------------
  // ts3d/bowtie.js decides every face from the map alone (so all clients agree); this only builds what it lists.
  const plan = planBowtie(nyc, { oneTimes: LAYOUT.oneTimes });
  // Four corner towers, two claimable boards each (upper A, lower B).
  for (const c of plan.corners) {
    const g = new THREE.Group();
    scene.add(g);
    g.position.set(c.x, 0, c.z);
    g.rotation.y = c.yaw;
    boards.mount('SUB_' + c.n + 'A', g, { x: 0, y: c.yA, z: 0.35, w: c.w, h: c.h });
    boards.mount('SUB_' + c.n + 'B', g, { x: 0, y: c.yB, z: 0.35, w: c.w, h: c.h });
  }
  // STREET_1..30 on the walls that look onto the main street; STREET_31..50 stacked above them and low on the walls of
  // the plaza core. The newer faces' frames go into this file's merged kit, so each adds one draw call, its screen.
  for (const st of plan.streets) {
    const g = new THREE.Group();
    scene.add(g);
    g.position.set(st.x, 0, st.z);
    g.rotation.y = st.yaw;
    const bare = st.n > STREET_OLD;
    boards.mount(st.id, g, { x: 0, y: st.y, z: 0.2, w: st.w, h: st.h, frameT: st.frame, bare });
    if (bare) addFrame(kit, st.w, st.h, st.frame, THEMES.cyber_navy?.accent || '#3fe6ff', new THREE.Matrix4().compose(new THREE.Vector3(st.x + st.nx * 0.2, st.y, st.z + st.nz * 0.2), new THREE.Quaternion().setFromAxisAngle(Y_AXIS, st.yaw), ONE));
  }
  // Blade signs on the canyon walls (none through a claimable face).
  for (const b of plan.blades) bladeAt(BLADES[b.name], b.x, 15, b.z, b.ry, 12);

  // ---- One Times Square ----------------------------------------------------------------------------------------------
  const OT = LAYOUT.oneTimes;
  const mainGroup = new THREE.Group();
  mainGroup.position.set(OT.x, 0, OT.z - 1.2);
  mainGroup.rotation.y = Math.PI;
  scene.add(mainGroup);
  const faceW = 24, faceH = faceW * 9 / 16, seam = 0.5;
  const mountMain = (id, y, extra) => boards.mount(id, mainGroup, { x: 0, y, z: 0, w: faceW, h: faceH, frameT: 0.55, ...extra });
  const stack = ['MAIN_LOW', 'MAIN_BOT', 'MAIN_MID', 'MAIN_TOP', 'MAIN_UP'];
  const y0 = 11 + faceH / 2;
  stack.forEach((id, i) => mountMain(id, y0 + i * (faceH + seam), id === 'MAIN_UP' ? { marquee: true } : id === 'MAIN_MID' ? { ticker: true, tickerH: 1.2 } : {}));
  const botY = y0, topY = y0 + (stack.length - 1) * (faceH + seam);
  const span = (topY + faceH / 2) - (botY - faceH / 2);
  const holo = new THREE.Mesh(new THREE.BoxGeometry(faceW + 1.8, span + 1, 1.6), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  holo.position.set(0, (topY + botY) / 2, 0.2);
  holo.visible = false;
  mainGroup.add(holo);
  const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 1.1, 52, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xff4ad8, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
  laser.position.set(0, topY + faceH / 2 + 28, 0);
  laser.visible = false;
  mainGroup.add(laser);
  boards.watchShow(holo, laser);
  const towerFace = (y) => new THREE.Matrix4().compose(new THREE.Vector3(20.2, y, 215.0), new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI), ONE);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(12, 2), new THREE.MeshBasicMaterial({ map: toTex(paintLabel(makeCanvas(1024, 170), 'K-TIMES SQUARE', '#ffe7a3', '#07070d')), color: new THREE.Color(1.1, 1.1, 1.1) }));
  label.applyMatrix4(towerFace(86));
  scene.add(label);
  kit.box(12.6, 2.6, 0.3, '#111217', { mat: 'metal', m: towerFace(86).multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.2)) });
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
