// Times Square dressing on the real buildings: the night photos (Wikimedia Commons, see
// assets/times-square/credits.json), animated ad screens and blade signs on every facade facing the
// bowtie — from street level up to the tower tops — MAIN_S wrapped around One Times Square, SUB_B1..4
// on the canyon walls, the New Year's ball, steam stacks, and the K-food blade signs beside the lot pad.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYOUT } from './layout.js?v=202611281741';
import { Kit, cropPlane } from './kit.js?v=202611281741';
import { makeCanvas, paintBlade, paintLabel, paintGlow, THEMES } from './art.js?v=202611281741';
import { addFrame } from './screens.js?v=202611281741';
import { planBowtie, wallsIn, STREET_OLD } from './bowtie.js?v=202611281741';
import { ENV_PHOTOS, envPhotoUrl } from './loadplan.js?v=202611281741';

const ONE = new THREE.Vector3(1, 1, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// Only the four photos the environment map uses are fetched (the facades are ad screens and claimable boards now).
export const PHOTO_FILES = ENV_PHOTOS;

const BLADES = ['K-TOWN', 'BROADWAY', 'THEATRE', 'HOTEL', 'K-POP', '서울식당', '노래방', 'K-BBQ', '치킨', 'CAFE 서울', '포장마차', 'HOTPOT'];
const BLADE_COLORS = ['#ff3d9a', '#ffcf5a', '#3fe6ff', '#ff6a3d', '#b84dff', '#39f58a', '#ffe2a8', '#ff7ac0', '#ffb020', '#3fe6ff', '#ff3d9a', '#ff6a3d'];

export function buildTimesSquare(ctx) {
  const { scene, renderer, manager, kitMats, boards, nyc, quality, colliders, world } = ctx;
  const low = quality === 'low';
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const loader = new THREE.TextureLoader(manager);
  const updaters = [];
  const kit = new Kit();

  // ---- materials ---------------------------------------------------------------------------------------
  const photoTextures = {};
  for (const name of PHOTO_FILES) {
    const t = loader.load(envPhotoUrl(name));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    photoTextures[name] = t;
  }
  const toTex = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = aniso;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const bladeCanvas = makeCanvas(128 * BLADES.length, 1024);
  BLADES.forEach((n, i) => {
    const c = makeCanvas(128, 1024);
    paintBlade(c, n, BLADE_COLORS[i]);
    bladeCanvas.getContext('2d').drawImage(c, i * 128, 0);
  });
  const bladeMat = new THREE.MeshBasicMaterial({ map: toTex(bladeCanvas), color: new THREE.Color(1.05, 1.05, 1.05) });
  // ---- facade helpers -------------------------------------------------------------------------------------------
  const bladeGeos = [];
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
  // AD_1..AD_5: the ad-only screens (bowtie.js planAds, adsale.js). Not claimable: they mount on adScreens, never on boards,
  // and their amber frames go into this file's merged kit like the newer street faces' (one draw call each, the screen).
  const adFaces = [];
  for (const a of ctx.adScreens ? plan.ads : []) {
    const g = new THREE.Group();
    scene.add(g);
    g.position.set(a.x, 0, a.z);
    g.rotation.y = a.yaw;
    ctx.adScreens.mount(a.id, g, { y: a.y, z: 0.2, w: a.w, h: a.h });
    addFrame(kit, a.w, a.h, a.frame, '#ffb020', new THREE.Matrix4().compose(new THREE.Vector3(a.x + a.nx * 0.2, a.y, a.z + a.nz * 0.2), new THREE.Quaternion().setFromAxisAngle(Y_AXIS, a.yaw), ONE));
    adFaces.push({ id: a.id, x: a.x + a.nx * 0.2, y: a.y, z: a.z + a.nz * 0.2, nx: a.nx, nz: a.nz, w: a.w, h: a.h });
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

  // ---- K-food blade signs beside the lot pad ------------------------------------------------------------------------------
  // The K-Town gate that stood on the old lot rows is gone with them: the lots' street has its own arch (landmarks.js).
  // These blades stay where they were, on the walls just outside the pad's fence that look across it (three on today's map).
  {
    const B = { x0: -114, x1: 114, z0: 275, z1: 335, z: 305 };
    const kw = walls(B.x0, B.x1, B.z0, B.z1, 12).filter(w => Math.abs(w.nz) > 0.8 && Math.sign(w.nz) === Math.sign(B.z - w.mz));
    let n = 0;
    for (const w of kw) {
      if (n > 14) break;
      const p = new THREE.Vector3(w.mx + w.nx * 1.55, 0, w.mz + w.nz * 1.55);
      bladeAt(BLADES[5 + (n % 7)], p.x + w.tx * (w.len / 2 - 2.5), 9.5 + (n % 3), p.z + w.tz * (w.len / 2 - 2.5), Math.atan2(w.nx, w.nz) + Math.PI / 2, 9);
      n++;
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
  putMesh(bladeGeos, bladeMat);
  scene.add(kit.build(kitMats));

  function update(dt, t) { for (const u of updaters) u(dt, t); }
  return {
    update, photoTextures, adFaces,
    mainScreenCenter: new THREE.Vector3(OT.x, 25, OT.z - 1.2),
  };
}
