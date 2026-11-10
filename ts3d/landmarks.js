// Plaza landmarks: TKTS red stairs, Times Square Station exit 1, the golden bungeo-ppang pocha,
// the Golden ATM and the 20 plot buildings (levels 0–4).
import * as THREE from 'three';
import { LAYOUT, PLOT_SLOTS, TAXI_STANDS } from './layout.js';
import { Kit, fishGeometry } from './kit.js';
import {
  makeCanvas, paintStationSign, paintPylon, paintMenuBoard, paintTKTS, paintNeonSign,
  paintBeam, paintPlotBadge, paintLabel, paintTaxiStand, SANS, EMOJI,
} from './art.js';

const tex = (canvas, aniso = 4) => {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
};
const catenary = (a, b, sag, n) => {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  return pts;
};

export function buildLandmarks(ctx) {
  const { scene, kitMats, boards, ground, colliders, blockers, pick, quality } = ctx;
  const low = quality === 'low';
  const updaters = [];
  const glowTex = ground.glowTex;

  // ===== TKTS red stairs =====================================================
  {
    const S = LAYOUT.stairs;
    const W = S.x1 - S.x0, cx = (S.x0 + S.x1) / 2;
    const kit = new Kit();
    const mass = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: '#ff1238', emissiveIntensity: 0.16, roughness: 0.18, metalness: 0.35 });
    const tread = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: '#ff1238', emissiveIntensity: 0.55, roughness: 0.1, metalness: 0.1, envMapIntensity: 1.3 });
    for (let i = 0; i < S.steps; i++) {
      const zf = S.front - i * S.depth;
      const top = (i + 1) * S.rise;
      const depth = i === S.steps - 1 ? zf - S.back : S.depth;
      kit.box(W, top - 0.06, depth, '#3a0610', { x: cx, y: (top - 0.06) / 2, z: zf - depth / 2, mat: 'mass' });
      kit.box(W, 0.06, depth, '#c40a24', { x: cx, y: top - 0.03, z: zf - depth / 2, mat: 'tread' });
      kit.box(W - 0.1, S.rise * 0.62, 0.03, '#ff1a3c', { x: cx, y: top - S.rise * 0.52, z: zf + 0.012, glow: 2.4 });
      kit.box(W, 0.035, 0.05, '#ffd0d6', { x: cx, y: top + 0.002, z: zf - 0.03, glow: 1.6 });
    }
    const n0 = new THREE.Vector3(0, S.rise + 1.05, S.front), n1 = new THREE.Vector3(0, S.steps * S.rise + 1.05, S.front - (S.steps - 1) * S.depth);
    const slope = Math.atan2(n1.y - n0.y, n0.z - n1.z);
    const len = n0.distanceTo(n1);
    for (const x of [S.x0 - 0.05, S.x1 + 0.05]) {
      kit.box(0.05, 1.05, len, '#cfe6ff', { x, y: (n0.y + n1.y) / 2 - 0.52, z: (n0.z + n1.z) / 2, rx: slope, mat: 'glass' });
      kit.box(0.05, 1.05, n1.z - S.back, '#cfe6ff', { x, y: n1.y - 0.52, z: (n1.z + S.back) / 2, mat: 'glass' });
      kit.rod(new THREE.Vector3(x, n0.y, n0.z), new THREE.Vector3(x, n1.y, n1.z), 0.035, '#d9dde3', { mat: 'metal' });
      kit.rod(new THREE.Vector3(x, n1.y, n1.z), new THREE.Vector3(x, n1.y, S.back), 0.035, '#d9dde3', { mat: 'metal' });
      kit.rod(new THREE.Vector3(x, n0.y - 1.05, n0.z), new THREE.Vector3(x, n1.y - 1.05, n1.z), 0.02, '#ff4060', { glow: 3 });
    }
    kit.box(W + 0.1, 1.05, 0.05, '#cfe6ff', { x: cx, y: n1.y - 0.52, z: S.back, mat: 'glass' });
    kit.rod(new THREE.Vector3(S.x0, n1.y, S.back), new THREE.Vector3(S.x1, n1.y, S.back), 0.035, '#d9dde3', { mat: 'metal' });
    kit.box(W, S.steps * S.rise - 0.5, 0.08, '#160308', { x: cx, y: (S.steps * S.rise - 0.5) / 2, z: S.back - 0.05, mat: 'mass' });
    kit.box(W - 2, 2.2, 0.06, '#ffe8c8', { x: cx, y: 1.3, z: S.back - 0.1, glow: 1.4 });
    const g = kit.build({ ...kitMats, mass, tread });
    scene.add(g);
    const tk = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshBasicMaterial({ map: tex(paintTKTS(makeCanvas(512, 128))), color: new THREE.Color(1.5, 1.5, 1.5) }));
    tk.position.set(cx, 3.2, S.back - 0.1);
    tk.rotation.y = Math.PI;
    scene.add(tk);
    for (const s of [-1, 1]) {
      const side = tk.clone();
      side.position.set(cx + s * (W / 2 + 0.12), 2.2, S.back + 2.2);
      side.rotation.y = s * Math.PI / 2;
      scene.add(side);
    }
    colliders.push({ x0: S.x0 - 0.45, x1: S.x0, z0: S.back - 0.3, z1: S.front });
    colliders.push({ x0: S.x1, x1: S.x1 + 0.45, z0: S.back - 0.3, z1: S.front });
    colliders.push({ x0: S.x0 - 0.45, x1: S.x1 + 0.45, z0: S.back - 0.5, z1: S.back });
    blockers.push(new THREE.Box3(new THREE.Vector3(S.x0, 0, S.back), new THREE.Vector3(S.x1, S.steps * S.rise * 0.5, S.front - 6)));
    ground.pools([{ x: cx, z: S.front + 3, r: 9, color: '#ff1a3c', k: 0.42, stretch: 0.45 }]);
  }

  // ===== Times Square Station, exit 1 ======================================
  {
    const { x: sx, z: sz } = LAYOUT.subway;
    const kit = new Kit();
    const z0 = sz - 3.4, z1 = sz + 4.2, granite = '#5d6068';
    for (const s of [-1, 1]) kit.box(0.3, 4.4, z1 - z0 + 0.4, granite, { x: sx + s * 2.05, y: -1.1, z: (z0 + z1) / 2 });
    kit.box(4.4, 4.4, 0.3, granite, { x: sx, y: -1.1, z: z1 + 0.2 });
    const steps = 10, depth = (z1 - z0) / steps;
    for (let i = 0; i < steps; i++) {
      const top = -(i + 1) * 0.32;
      kit.box(3.8, 0.3, depth, '#7d8089', { x: sx, y: top - 0.15, z: z0 + (i + 0.5) * depth });
      kit.box(3.8, 0.03, 0.08, '#ffd400', { x: sx, y: top + 0.012, z: z0 + i * depth + 0.06, glow: 1.2 });
    }
    kit.box(3.6, 1.6, 0.05, '#e9fff2', { x: sx, y: -2.2, z: z1 + 0.04, glow: 1.8 });
    for (const s of [-1, 1]) {
      kit.rod(new THREE.Vector3(sx + s * 1.78, 0.95, z0), new THREE.Vector3(sx + s * 1.78, -2.25, z1), 0.035, '#cfd3da', { mat: 'metal' });
      kit.box(0.34, 0.12, z1 - z0 + 0.6, '#1d7a45', { x: sx + s * 2.05, y: 1.16, z: (z0 + z1) / 2, mat: 'metal' });
    }
    const R = 2.42, L = z1 - z0 + 0.8;
    for (let i = 0; i <= 6; i++) {
      const z = z0 - 0.4 + (i / 6) * L;
      kit.add(new THREE.TorusGeometry(R, i === 0 || i === 6 ? 0.1 : 0.055, 6, 28, Math.PI), '#1d8a4c', { x: sx, y: 1.2, z, mat: 'metal' });
    }
    kit.box(0.12, 0.05, L, '#d8ffe9', { x: sx, y: 1.2 + R - 0.08, z: (z0 + z1) / 2, glow: 3.2 });
    const g = kit.build(kitMats);
    scene.add(g);
    const canopyGeo = new THREE.CylinderGeometry(R, R, L, 28, 1, true, Math.PI / 2, Math.PI);
    canopyGeo.rotateX(Math.PI / 2);
    const canopy = new THREE.Mesh(canopyGeo, new THREE.MeshStandardMaterial({
      color: '#22b863', transparent: true, opacity: 0.42, roughness: 0.06, metalness: 0.3,
      emissive: '#0f7a3d', emissiveIntensity: 0.4, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.4,
    }));
    canopy.position.set(sx, 1.2, (z0 + z1) / 2);
    canopy.renderOrder = 2;
    scene.add(canopy);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.35), new THREE.MeshBasicMaterial({ map: tex(paintStationSign(makeCanvas(1024, 256)), 8), color: new THREE.Color(1.25, 1.25, 1.25) }));
    sign.position.set(sx, 1.2 + R + 0.95, z0 - 0.56);
    sign.rotation.y = Math.PI;
    scene.add(sign);
    const back = sign.clone();
    back.position.z = z0 - 0.39;
    back.rotation.y = 0;
    scene.add(back);
    const frame = new Kit();
    frame.box(5.6, 1.55, 0.06, '#1d8a4c', { x: sx, y: 1.2 + R + 0.95, z: z0 - 0.475, mat: 'metal' });
    frame.cyl(0.07, 0.07, 1.0, '#1d8a4c', { x: sx - 2.3, y: 1.2 + R + 0.1, z: z0 - 0.47, mat: 'metal' });
    frame.cyl(0.07, 0.07, 1.0, '#1d8a4c', { x: sx + 2.3, y: 1.2 + R + 0.1, z: z0 - 0.47, mat: 'metal' });
    const px = sx + 3.6, pz = z0 - 1.2;
    frame.box(0.82, 3.6, 0.34, '#10204a', { x: px, y: 0.12 + 1.8, z: pz, mat: 'metal' });
    frame.box(0.9, 0.12, 0.42, '#c8ccd4', { x: px, y: 0.12 + 3.66, z: pz, mat: 'metal' });
    scene.add(frame.build(kitMats));
    const pylonMat = new THREE.MeshBasicMaterial({ map: tex(paintPylon(makeCanvas(128, 512))), color: new THREE.Color(1.25, 1.25, 1.25) });
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 3.5), pylonMat);
      p.position.set(px, 0.12 + 1.8, pz + s * 0.175);
      p.rotation.y = s > 0 ? 0 : Math.PI;
      scene.add(p);
    }
    colliders.push({ x0: sx - 2.35, x1: sx + 2.35, z0: z0 - 0.3, z1: z1 + 0.5 });
    colliders.push({ x0: px - 0.5, x1: px + 0.5, z0: pz - 0.3, z1: pz + 0.3 });
    blockers.push(new THREE.Box3(new THREE.Vector3(sx - 2.5, 0, z0), new THREE.Vector3(sx + 2.5, 3.6, z1)));
    ground.pools([{ x: sx, z: z0 - 2.2, r: 4.5, color: '#3dff9a', k: 0.25 }]);
  }

  // ===== K-golden bungeo-ppang pocha =========================================
  const stall = (() => {
    const { x: ox, z: oz } = LAYOUT.stall;
    const y0 = LAYOUT.plaza.y;
    const root = new THREE.Group();
    root.position.set(ox, y0, oz);
    scene.add(root);
    const kit = new Kit();
    kit.box(3.6, 0.9, 1.4, '#c4161c', { y: 0.45, mat: 'gloss' });
    kit.box(3.8, 0.08, 1.62, '#c8ccd2', { y: 0.94, mat: 'metal' });
    kit.box(3.62, 0.08, 0.04, '#ffd9a0', { y: 0.78, z: 0.72, glow: 2.4 });
    kit.box(2.7, 0.14, 0.95, '#18181c', { y: 1.05, mat: 'metal' });
    kit.box(2.6, 0.03, 0.85, '#ff6a1a', { y: 0.99, glow: 2.8 });
    for (let i = 0; i < 8; i++) kit.cyl(0.26, 0.28, 0.06, '#0f0f12', { x: -0.96 + (i % 4) * 0.64, y: 1.14, z: i < 4 ? -0.22 : 0.22, sz: 0.62, mat: 'metal', seg: 16 });
    for (const [x, z] of [[-2.15, -1.5], [2.15, -1.5], [-2.15, 1.5], [2.15, 1.5]]) kit.cyl(0.045, 0.045, 2.6, '#b8bcc4', { x, y: 1.3, z, mat: 'metal' });
    kit.box(4.5, 0.05, 0.05, '#b8bcc4', { y: 2.6, z: 1.5, mat: 'metal' });
    kit.box(4.5, 0.05, 0.05, '#b8bcc4', { y: 2.6, z: -1.5, mat: 'metal' });
    // String lights: front eave and two swags to the corner poles.
    const strings = [];
    strings.push([new THREE.Vector3(-2.2, 2.55, 1.62), new THREE.Vector3(2.2, 2.55, 1.62), 0.18]);
    for (const s of [-1, 1]) {
      kit.cyl(0.05, 0.06, 2.9, '#2a2c30', { x: s * 4.3, y: 1.45, z: 3.4, mat: 'metal' });
      strings.push([new THREE.Vector3(s * 2.2, 2.6, 1.6), new THREE.Vector3(s * 4.3, 2.85, 3.4), 0.25]);
      strings.push([new THREE.Vector3(s * 2.2, 2.6, -1.6), new THREE.Vector3(s * 4.3, 2.85, 3.4), 0.42]);
    }
    for (const [a, b, sag] of strings) {
      const pts = catenary(a, b, sag, 14);
      for (let i = 0; i < pts.length - 1; i++) kit.rod(pts[i], pts[i + 1], 0.008, '#1a1a1a', { mat: 'metal', seg: 4 });
      pts.forEach((p, i) => kit.sphere(0.05, i % 3 === 0 ? '#ffb070' : '#fff0c8', { x: p.x, y: p.y - 0.05, z: p.z, glow: 2.6, seg: 6 }));
    }
    // Pocha tables and plastic stools.
    for (const [tx, tz] of [[3.4, 0.6], [-3.5, -0.4]]) {
      kit.cyl(0.55, 0.55, 0.05, '#ff7a1a', { x: tx, y: 0.72, z: tz, seg: 18, mat: 'gloss' });
      kit.cyl(0.05, 0.08, 0.7, '#c8ccd2', { x: tx, y: 0.36, z: tz, mat: 'metal' });
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + tx;
        kit.cyl(0.19, 0.16, 0.42, k % 2 ? '#2f6fe0' : '#e03030', { x: tx + Math.cos(a) * 0.95, y: 0.21, z: tz + Math.sin(a) * 0.95, mat: 'gloss', seg: 12 });
      }
    }
    // A-frame menu board legs.
    kit.box(0.06, 1.3, 0.06, '#5a3a1e', { x: -2.95, y: 0.62, z: 2.65, rx: 0.18 });
    kit.box(0.06, 1.3, 0.06, '#5a3a1e', { x: -2.05, y: 0.62, z: 2.65, rx: 0.18 });
    kit.box(0.92, 1.25, 0.04, '#3d2a16', { x: -2.5, y: 0.62, z: 2.2, rx: -0.18 });
    root.add(kit.build(kitMats));

    const fishGeo = fishGeometry(0.1);
    const brown = new THREE.MeshStandardMaterial({ color: '#c9862b', roughness: 0.45, metalness: 0.05, emissive: '#5a2a00', emissiveIntensity: 0.25 });
    const goldMat = new THREE.MeshStandardMaterial({ color: '#ffcf5a', roughness: 0.22, metalness: 1, emissive: '#8a5a00', emissiveIntensity: 0.6, envMapIntensity: 1.6 });
    const molds = new THREE.InstancedMesh(fishGeo, brown, 8);
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    for (let i = 0; i < 8; i++) {
      m4.compose(new THREE.Vector3(-0.96 + (i % 4) * 0.64, 1.19, i < 4 ? -0.22 : 0.22), qq, new THREE.Vector3(0.38, 0.38, 0.6));
      molds.setMatrixAt(i, m4);
    }
    root.add(molds);
    const roofR = 2.2, roofTheta = 1.62, roofLen = 4.7;
    const roofGeo = new THREE.CylinderGeometry(roofR, roofR, roofLen, 24, 1, true, Math.PI / 2 - roofTheta / 2, roofTheta);
    roofGeo.rotateZ(Math.PI / 2);
    const tarp = new THREE.MeshStandardMaterial({ color: '#ff7a1a', emissive: '#ff5a00', emissiveIntensity: 0.55, roughness: 0.8, side: THREE.DoubleSide, envMapIntensity: 0.4 });
    const roof = new THREE.Mesh(roofGeo, tarp);
    roof.position.y = 2.62 - roofR * Math.cos(roofTheta / 2);
    root.add(roof);
    const flapC = makeCanvas(1024, 128);
    {
      const g = flapC.getContext('2d');
      g.fillStyle = '#ff7a1a';
      g.fillRect(0, 0, 1024, 128);
      g.fillStyle = '#ffffff';
      g.font = `900 84px ${SANS}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('황금 붕어빵', 512, 70);
      for (let x = 0; x < 1024; x += 64) { g.fillStyle = '#e8590c'; g.beginPath(); g.arc(x + 32, 128, 30, Math.PI, 0); g.fill(); }
    }
    const flapMat = new THREE.MeshStandardMaterial({ map: tex(flapC), emissive: '#ffffff', emissiveMap: tex(flapC), emissiveIntensity: 0.6, roughness: 0.8, side: THREE.DoubleSide });
    for (const s of [1, -1]) {
      const flap = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.58), flapMat);
      flap.position.set(0, 2.32, s * 1.62);
      if (s < 0) flap.rotation.y = Math.PI;
      root.add(flap);
    }
    const curtain = new THREE.MeshStandardMaterial({ color: '#ffd2a8', transparent: true, opacity: 0.18, roughness: 0.1, metalness: 0.2, emissive: '#ff8a3a', emissiveIntensity: 0.25, side: THREE.DoubleSide, depthWrite: false });
    for (const s of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 1.3), curtain);
      c.position.set(s * 2.18, 1.95, 0);
      c.rotation.y = Math.PI / 2;
      c.renderOrder = 2;
      root.add(c);
    }
    const menu = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.18), new THREE.MeshBasicMaterial({ map: tex(paintMenuBoard(makeCanvas(512, 704))), color: new THREE.Color(1.1, 1.1, 1.1) }));
    menu.position.set(-2.5, 0.64, 2.24);
    menu.rotation.x = -0.18;
    root.add(menu);
    const sign = new THREE.Group();
    sign.position.set(0, 3.95, 0);
    const bigFish = new THREE.Mesh(fishGeometry(0.22), goldMat);
    bigFish.scale.setScalar(1.55);
    sign.add(bigFish);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: '#111' }));
    for (const s of [1, -1]) { const e = eye.clone(); e.position.set(0.48, 0.07, s * 0.27); sign.add(e); }
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(1.1, 0.75, 0.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.set(2.8, 2, 1);
    halo.position.z = -0.3;
    halo.layers.set(2);
    sign.add(halo);
    root.add(sign);
    const steamTex = ground.glowTex;
    const steam = [];
    for (let i = 0; i < (low ? 8 : 14); i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, color: 0xf2f2f2, transparent: true, depthWrite: false, opacity: 0 }));
      s.layers.set(2);
      s.userData.age = i * 0.19;
      s.userData.x = -1 + (i % 4) * 0.66;
      root.add(s);
      steam.push(s);
    }
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.2, 0.3), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(new THREE.RingGeometry(LAYOUT.stall.r - 0.12, LAYOUT.stall.r, 64).rotateX(-Math.PI / 2), ringMat);
    ring.position.y = 0.03;
    ring.layers.set(1);
    root.add(ring);
    const pops = [];
    updaters.push((dt, t) => {
      sign.rotation.y = Math.sin(t * 0.7) * 0.6;
      sign.position.y = 3.95 + Math.sin(t * 1.6) * 0.06;
      for (const s of steam) {
        const a = (s.userData.age += dt) % 2.6, u = a / 2.6;
        s.position.set(s.userData.x + Math.sin(t + s.userData.x * 3) * 0.12 * u, 1.25 + u * 1.9, Math.cos(t * 0.8 + s.userData.x) * 0.1);
        const sc = 0.25 + u * 0.9;
        s.scale.set(sc, sc, 1);
        s.material.opacity = Math.sin(Math.PI * u) * 0.22;
      }
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i];
        p.age += dt;
        const u = p.age / 1.2;
        p.mesh.position.set(p.x, 1.3 + Math.sin(Math.min(1, u) * Math.PI) * 2.2 + u * 0.6, 0.3 + u * 1.4);
        p.mesh.rotation.set(-Math.PI / 2 + u * 6, u * 3, 0);
        p.mesh.scale.setScalar(0.42 * (1 + u * 0.6));
        if (p.age > 1.2) { const at = p.mesh.getWorldPosition(new THREE.Vector3()); root.remove(p.mesh); pops.splice(i, 1); ctx.onFishLanded?.(at, p.gold); }
      }
    });
    const bodyPick = new THREE.Mesh(new THREE.BoxGeometry(4.6, 3.4, 3.4), new THREE.MeshBasicMaterial({ visible: false }));
    bodyPick.position.y = 1.7;
    bodyPick.userData.pick = { kind: 'cart' };
    root.add(bodyPick);
    pick.push(bodyPick);
    colliders.push({ x0: ox - 2.35, x1: ox + 2.35, z0: oz - 1.65, z1: oz + 1.65 });
    for (const [tx, tz] of [[3.4, 0.6], [-3.5, -0.4]]) colliders.push({ x0: ox + tx - 0.6, x1: ox + tx + 0.6, z0: oz + tz - 0.6, z1: oz + tz + 0.6 });
    colliders.push({ x0: ox - 3.05, x1: ox - 1.95, z0: oz + 2.0, z1: oz + 2.9 });
    for (const s of [-1, 1]) colliders.push({ x0: ox + s * 4.3 - 0.15, x1: ox + s * 4.3 + 0.15, z0: oz + 3.25, z1: oz + 3.55 });
    blockers.push(new THREE.Box3(new THREE.Vector3(ox - 2.3, 0, oz - 1.6), new THREE.Vector3(ox + 2.3, 3.2, oz + 1.6)));
    ground.pools([{ x: ox, z: oz + 1, r: 7, color: '#ff8a2a', k: 0.2 }]);
    return {
      root,
      setNear(v, t) { ringMat.opacity = v ? 0.55 + Math.sin(t * 5) * 0.2 : Math.max(0, ringMat.opacity - 0.05); },
      popFish(gold) {
        const mesh = new THREE.Mesh(fishGeo, gold ? goldMat : brown);
        root.add(mesh);
        pops.push({ mesh, age: 0, x: -0.96 + Math.floor(Math.random() * 4) * 0.64, gold });
      },
      world: new THREE.Vector3(ox, y0, oz),
    };
  })();

  // ===== Golden ATM ===========================================================
  const atm = (() => {
    const { x: ax, z: az } = LAYOUT.atm;
    const root = new THREE.Group();
    root.position.set(ax, LAYOUT.plaza.y, az);
    scene.add(root);
    const gold = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 1, envMapIntensity: 1.7 });
    const kit = new Kit();
    kit.box(1.3, 2.3, 0.95, '#ffcf5a', { y: 1.15, mat: 'gold' });
    kit.box(1.42, 0.14, 1.06, '#b8860b', { y: 2.36, mat: 'gold' });
    kit.box(1.36, 0.1, 1.0, '#b8860b', { y: 0.05, mat: 'gold' });
    kit.box(1.0, 0.2, 0.16, '#18181c', { y: 0.95, z: 0.5, rx: -0.5, mat: 'metal' });
    for (let i = 0; i < 9; i++) kit.box(0.14, 0.04, 0.1, i === 8 ? '#39f58a' : '#ffe9a8', { x: -0.2 + (i % 3) * 0.2, y: 0.99 + Math.floor(i / 3) * 0.02, z: 0.5 + Math.floor(i / 3) * -0.03, rx: -0.5, glow: 1.6 });
    kit.box(0.6, 0.06, 0.08, '#111', { y: 0.7, z: 0.48, mat: 'metal' });
    kit.cyl(0.07, 0.07, 0.5, '#b8860b', { y: 2.65, mat: 'gold' });
    root.add(kit.build({ ...kitMats, gold }));
    const sc = makeCanvas(512, 384);
    {
      const g = sc.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 384);
      gr.addColorStop(0, '#2a1a02');
      gr.addColorStop(1, '#0a0602');
      g.fillStyle = gr;
      g.fillRect(0, 0, 512, 384);
      g.strokeStyle = '#ffcf5a';
      g.lineWidth = 8;
      g.strokeRect(10, 10, 492, 364);
      g.fillStyle = '#ffcf5a';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `900 64px ${SANS}`;
      g.fillText('황금 ATM', 256, 82);
      g.font = `90px ${EMOJI}`;
      g.fillText('💰', 256, 196);
      g.font = `800 34px ${SANS}`;
      g.fillStyle = '#fff3c4';
      g.fillText('전광판 · 토지 거래소', 256, 300);
    }
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.74), new THREE.MeshBasicMaterial({ map: tex(sc), color: new THREE.Color(1.5, 1.5, 1.5) }));
    screen.position.set(0, 1.6, 0.48);
    screen.userData.pick = { kind: 'atm' };
    root.add(screen);
    pick.push(screen);
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.09, 32), new THREE.MeshStandardMaterial({ color: '#ffd56a', metalness: 1, roughness: 0.18, emissive: '#7a5200', emissiveIntensity: 0.7 }));
    coin.rotation.x = Math.PI / 2;
    coin.position.y = 3.25;
    root.add(coin);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(1.1, 0.8, 0.25), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.set(1.7, 1.7, 1);
    halo.position.y = 3.25;
    halo.layers.set(2);
    root.add(halo);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.6, 1.1), new THREE.MeshBasicMaterial({ visible: false }));
    body.position.y = 1.3;
    body.userData.pick = { kind: 'atm' };
    root.add(body);
    pick.push(body);
    updaters.push((dt, t) => { coin.rotation.z = t * 2.2; coin.position.y = 3.25 + Math.sin(t * 2) * 0.08; });
    colliders.push({ x0: ax - 0.8, x1: ax + 0.8, z0: az - 0.6, z1: az + 0.6 });
    ground.pools([{ x: ax, z: az + 0.6, r: 3, color: '#ffcf5a', k: 0.24 }]);
    return { root, world: new THREE.Vector3(ax, LAYOUT.plaza.y, az) };
  })();

  // ===== K-POP stage park ========================================================
  const stage = (() => {
    const G = LAYOUT.stage, X = G.cx;
    const y0 = 0, top = G.h;
    const cz = (G.z0 + G.z1) / 2;
    const kit = new Kit();
    const root = new THREE.Group();
    root.position.x = X;
    scene.add(root);
    const box = (x0, x1, z0, z1) => colliders.push({ x0: x0 + X, x1: x1 + X, z0, z1 });
    kit.box(G.x1 - G.x0, G.h, G.z1 - G.z0, '#14141c', { x: 0, y: y0 + G.h / 2, z: cz, mat: 'gloss' });
    kit.box(G.x1 - G.x0, 0.06, 0.08, '#ff3d9a', { x: 0, y: top - 0.08, z: G.z0 + 0.02, glow: 2.4 });
    for (let k = 0; k < 3; k++) {
      const h = G.h * (k + 1) / 4;
      kit.box(G.x1 - G.x0, h, 0.8, '#1c1c26', { x: 0, y: y0 + h / 2, z: G.z0 - 2.4 + 0.8 * k + 0.4, mat: 'gloss' });
      kit.box(G.x1 - G.x0, 0.03, 0.06, '#3fe6ff', { x: 0, y: y0 + h + 0.005, z: G.z0 - 2.4 + 0.8 * k + 0.03, glow: 1.6 });
    }
    const truss = '#3a3d45';
    for (const sx of [-1, 1]) {
      for (const tz of [G.z0 + 0.4, G.z1 - 0.2]) {
        const x = sx * 8.6;
        for (const [dx, dz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) kit.cyl(0.04, 0.04, 10, truss, { x: x + dx, y: y0 + 5, z: tz + dz, mat: 'metal', seg: 6 });
        for (let yy = 1; yy < 10; yy += 1.2) kit.box(0.55, 0.04, 0.55, truss, { x, y: y0 + yy, z: tz, mat: 'metal' });
        box(x - 0.35, x + 0.35, tz - 0.35, tz + 0.35);
      }
      kit.box(1.6, 3.2, 1.4, '#0b0b0e', { x: sx * 10.6, y: y0 + 1.6, z: G.z0 + 1.2, mat: 'base' });
      for (const yy of [0.8, 1.9, 2.8]) kit.cyl(0.45, 0.45, 0.05, '#25262d', { x: sx * 10.6, y: y0 + yy, z: G.z0 + 0.49, rx: Math.PI / 2, seg: 18, mat: 'metal' });
      box(sx * 10.6 - 0.85, sx * 10.6 + 0.85, G.z0 + 0.45, G.z0 + 1.95);
    }
    kit.box(17.6, 0.5, 0.5, truss, { x: 0, y: y0 + 10, z: G.z0 + 0.4, mat: 'metal' });
    kit.box(17.6, 0.5, 0.5, truss, { x: 0, y: y0 + 10, z: G.z1 - 0.2, mat: 'metal' });
    kit.box(17.6, 10, 0.4, '#0d0d12', { x: 0, y: top + 5, z: G.z1 + 0.5, mat: 'metal' });
    box(-8.6, 8.6, G.z1 + 0.2, G.z1 + 0.9);
    const trees = [[-14, G.z0 - 12], [14, G.z0 - 12], [-14, G.z0 - 26], [14, G.z0 - 26], [-15, G.z0 + 4], [15, G.z0 + 4]];
    for (const [tx, tz] of trees) {
      kit.cyl(0.6, 0.6, 0.5, '#4a4d55', { x: tx, y: y0 + 0.25, z: tz, seg: 12 });
      kit.cyl(0.14, 0.2, 3.2, '#4a3324', { x: tx, y: y0 + 1.9, z: tz, seg: 8 });
      kit.sphere(1.7, '#1d4a2c', { x: tx, y: y0 + 4.4, z: tz, seg: 10 });
      kit.sphere(1.25, '#24603a', { x: tx + 0.6, y: y0 + 5.4, z: tz - 0.3, seg: 10 });
      for (let k = 0; k < 10; k++) {
        const a = k * 0.63;
        kit.sphere(0.05, k % 2 ? '#fff0c8' : '#ff9ad5', { x: tx + Math.cos(a) * 1.75, y: y0 + 4.1 + (k % 3) * 0.5, z: tz + Math.sin(a) * 1.75, glow: 2.2, seg: 5 });
      }
      box(tx - 0.65, tx + 0.65, tz - 0.65, tz + 0.65);
    }
    root.add(kit.build(kitMats));
    const floorC = makeCanvas(256, 256);
    {
      const g = floorC.getContext('2d');
      const cols = ['#ff3d9a', '#3fe6ff', '#ffcf5a', '#b84dff'];
      for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
        g.fillStyle = cols[(i + j * 3) % 4];
        g.fillRect(i * 256 / 6 + 3, j * 64 + 3, 256 / 6 - 6, 58);
      }
    }
    const floorMat = new THREE.MeshBasicMaterial({ map: tex(floorC), color: new THREE.Color(0.5, 0.5, 0.5) });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 8).rotateX(-Math.PI / 2), floorMat);
    floor.position.set(0, top + 0.01, cz);
    floor.layers.set(1);
    root.add(floor);
    const wall = new THREE.Group();
    wall.position.set(0, top + 5.4, G.z1 + 0.25);
    wall.rotation.y = Math.PI;
    root.add(wall);
    boards.mount('MAIN_S', wall, { x: 0, y: 0, z: 0, w: 15.6, h: 8.78 });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.6), new THREE.MeshBasicMaterial({ map: tex(paintLabel(makeCanvas(1024, 136), 'K-POP STAGE · 댄스 챌린지', '#ff7ac0', '#07070d')), color: new THREE.Color(1.05, 1.05, 1.05) }));
    sign.position.set(0, top + 10.9, G.z0 + 0.1);
    sign.rotation.y = Math.PI;
    root.add(sign);
    const back = sign.clone();
    back.rotation.y = 0;
    back.position.z = G.z0 - 0.1;
    root.add(back);
    const beamTex2 = new THREE.CanvasTexture(paintBeam(makeCanvas(64, 256)));
    const spots = [];
    ['#ff3d9a', '#3fe6ff', '#ffcf5a', '#b84dff'].forEach((col, k) => {
      const beam = new THREE.Mesh(new THREE.ConeGeometry(2.2, 14, 18, 1, true).translate(0, -7, 0), new THREE.MeshBasicMaterial({ map: beamTex2, color: new THREE.Color(col).multiplyScalar(0.45), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      const pivot = new THREE.Group();
      pivot.position.set(-6 + k * 4, top + 9.6, G.z0 + 0.4);
      pivot.add(beam);
      beam.layers.set(2);
      root.add(pivot);
      spots.push(pivot);
    });
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.4, 1.2), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(new THREE.RingGeometry(G.spot.r - 0.12, G.spot.r, 64).rotateX(-Math.PI / 2), ringMat);
    ring.position.set(G.spot.x, top + 0.03, G.spot.z);
    ring.layers.set(1);
    scene.add(ring);
    updaters.push((dt, t) => {
      spots.forEach((p, k) => p.rotation.set(Math.sin(t * 0.8 + k) * 0.5 + 0.35, 0, Math.cos(t * 0.6 + k * 1.7) * 0.6));
      floorMat.color.setScalar(0.35 + 0.25 * (0.5 + 0.5 * Math.sin(t * 4.1)));
    });
    ground.pools([{ x: X - 4, z: G.z0 - 6, r: 6, color: '#ff3d9a', k: 0.22 }, { x: X + 4, z: G.z0 - 6, r: 6, color: '#3fe6ff', k: 0.22 }]);
    return {
      setNear(v, t) { ringMat.opacity = v ? 0.55 + Math.sin(t * 5) * 0.2 : Math.max(0, ringMat.opacity - 0.05); },
      world: new THREE.Vector3(G.spot.x, top, G.spot.z),
    };
  })();

  // ===== Taxi stand signs =========================================================
  {
    const mat = new THREE.MeshBasicMaterial({ map: tex(paintTaxiStand(makeCanvas(256, 192))), color: new THREE.Color(1.05, 1.05, 1.05) });
    const poleKit = new Kit();
    for (const s of TAXI_STANDS) {
      const alongZ = s.axis === 'z';
      poleKit.cyl(0.07, 0.07, 3.2, '#2a2c30', { x: s.x, y: 1.6, z: s.z, mat: 'metal' });
      colliders.push({ x0: s.x - 0.2, x1: s.x + 0.2, z0: s.z - 0.2, z1: s.z + 0.2 });
      for (const flip of [0, Math.PI]) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.9), mat);
        p.position.set(s.x, 2.8, s.z);
        p.rotation.y = (alongZ ? 0 : Math.PI / 2) + flip;
        p.translateZ(0.03);
        scene.add(p);
      }
    }
    scene.add(poleKit.build(kitMats));
  }

  // ===== Plots ===================================================================
  const plots = new Map();
  const plotMats = {
    tower: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0.9, envMapIntensity: 1.5 }),
  };
  const beamTex = new THREE.CanvasTexture(paintBeam(makeCanvas(64, 256)));

  function plotSign(text, color, sub) {
    const c = makeCanvas(512, 128);
    paintNeonSign(c, text, color, sub);
    return new THREE.MeshBasicMaterial({ map: tex(c), transparent: true, color: new THREE.Color(1.35, 1.35, 1.35) });
  }

  function buildPlot(slot, data) {
    const level = Math.max(0, Math.min(4, Number(data?.level) || 0));
    const color = /^#[0-9a-f]{3,8}$/i.test(String(data?.theme_color || '')) ? data.theme_color : '#00ffcc';
    const group = new THREE.Group();
    const sc = slot.scale || 1;
    group.position.set(slot.x, LAYOUT.walk.y, slot.z);
    group.rotation.y = slot.rot;
    group.scale.setScalar(sc);
    const kit = new Kit();
    const own = [];
    const anim = [];
    kit.box(8.4, 0.08, 7.6, '#2e3138', { y: 0.04 });
    for (const [w, d, x, z] of [[8.4, 0.08, 0, 3.8], [8.4, 0.08, 0, -3.8], [0.08, 7.6, -4.2, 0], [0.08, 7.6, 4.2, 0]]) kit.box(w, 0.06, d, level ? color : '#ffe2a8', { x, y: 0.1, z, glow: level ? 1.4 : 0.55 });
    let board = null, signSpec = null, foot = null;
    if (level === 0) {
      for (const s of [-1, 1]) kit.box(0.1, 3.4, 0.1, '#2a2c30', { x: s * 1.95, y: 1.7, z: -2.6, mat: 'metal' });
      board = { x: 0, y: 3.1, z: -2.52, w: 3.6, h: 2.02 };
      for (const s of [-1, 1]) kit.box(0.08, 1.4, 0.08, '#2a2c30', { x: s * 1.2, y: 0.7, z: 2.9, mat: 'metal' });
      signSpec = { x: 0, y: 1.35, z: 2.96, w: 2.6, h: 0.65, text: '분양 중', sub: `PLOT ${slot.id} · FOR SALE` };
      for (const [cx2, cz] of [[-3.2, 3], [3.2, 3], [3.3, -2.8]]) {
        kit.cone(0.22, 0.7, '#ff6a1a', { x: cx2, y: 0.38, z: cz, seg: 12, mat: 'gloss' });
        kit.cyl(0.13, 0.17, 0.12, '#f4f4f0', { x: cx2, y: 0.42, z: cz, seg: 12, glow: 1.2 });
      }
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.36), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffcf5a').multiplyScalar(1.7) }));
      gem.position.set(0, 1.7, 0.4);
      own.push(gem);
      anim.push((dt, t) => { gem.rotation.y = t * 1.4; gem.position.y = 1.7 + Math.sin(t * 2 + slot.id) * 0.15; });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 6, 16, 1, true), new THREE.MeshBasicMaterial({ map: beamTex, color: new THREE.Color('#ffcf5a').multiplyScalar(0.3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      beam.position.set(0, 3.1, 0.4);
      beam.rotation.x = Math.PI;
      beam.layers.set(2);
      own.push(beam);
    } else if (level === 1) {
      kit.add(new THREE.ConeGeometry(2.7, 2.5, 4, 1, true), '#f2e6d0', { y: 1.33, ry: Math.PI / 4, mat: 'cloth' });
      kit.add(new THREE.CylinderGeometry(2.2, 2.74, 0.5, 4, 1, true), color, { y: 0.33, ry: Math.PI / 4, mat: 'cloth' });
      const corners = [[1.91, 1.91], [-1.91, 1.91], [-1.91, -1.91], [1.91, -1.91]];
      corners.forEach(([x, z], i) => {
        const a = new THREE.Vector3(x, 0.1, z), b = new THREE.Vector3(0, 2.55, 0);
        for (let k = 1; k < 7; k++) { const p = a.clone().lerp(b, k / 7); kit.sphere(0.05, i % 2 ? '#fff0c8' : color, { x: p.x * 1.02, y: p.y, z: p.z * 1.02, glow: 4, seg: 6 }); }
      });
      kit.cyl(0.12, 0.12, 0.32, '#ffb070', { x: 0.9, y: 0.32, z: 2.4, glow: 3 });
      kit.cyl(0.42, 0.42, 0.05, '#7a4a2a', { x: -1.6, y: 0.55, z: 2.7, seg: 14 });
      kit.cyl(0.05, 0.05, 0.52, '#2a2c30', { x: -1.6, y: 0.28, z: 2.7, mat: 'metal' });
      board = { x: 2.6, y: 2.2, z: 2.6, w: 2.6, h: 1.46, posts: true };
      signSpec = { x: -2.4, y: 1.8, z: 3.2, w: 2.4, h: 0.6, posts: true };
      foot = [2.3, 2.3];
    } else if (level === 2) {
      kit.box(4.4, 0.9, 1.2, '#7a4a2a', { y: 0.45, z: 0.6 });
      for (const [x, z] of [[-2.2, -1.6], [2.2, -1.6], [-2.2, 1.6], [2.2, 1.6]]) kit.cyl(0.05, 0.05, 2.5, '#b8bcc4', { x, y: 1.25, z, mat: 'metal' });
      for (const [tx, tz] of [[-1.2, -0.6], [1.3, -0.7]]) {
        kit.cyl(0.5, 0.5, 0.05, color, { x: tx, y: 0.7, z: tz, seg: 16, mat: 'gloss' });
        kit.cyl(0.05, 0.06, 0.68, '#c8ccd2', { x: tx, y: 0.34, z: tz, mat: 'metal' });
        for (let k = 0; k < 2; k++) kit.cyl(0.17, 0.15, 0.4, k ? '#2f6fe0' : '#e03030', { x: tx + (k ? 0.8 : -0.8), y: 0.2, z: tz, seg: 10, mat: 'gloss' });
      }
      const pts = catenary(new THREE.Vector3(-2.2, 2.45, 1.7), new THREE.Vector3(2.2, 2.45, 1.7), 0.2, 10);
      pts.forEach(p => kit.sphere(0.05, '#fff0c8', { x: p.x, y: p.y - 0.05, z: p.z, glow: 5, seg: 6 }));
      const roofGeo = new THREE.CylinderGeometry(2.2, 2.2, 4.6, 20, 1, true, Math.PI / 2 - 0.82, 1.64);
      roofGeo.rotateZ(Math.PI / 2);
      roofGeo.translate(0, 2.5 - 2.2 * Math.cos(0.82), 0);
      const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.8, side: THREE.DoubleSide }));
      own.push(roof);
      board = { x: 0, y: 1.45, z: -1.5, w: 2.4, h: 1.35 };
      signSpec = { x: 0, y: 2.3, z: 1.72, w: 3.4, h: 0.85 };
      foot = [2.4, 1.8];
    } else if (level === 3) {
      kit.box(6.6, 5.8, 5.6, '#1b1d24', { y: 2.9, z: -0.6 });
      kit.box(5.8, 2.2, 0.06, '#ffe2b8', { y: 1.35, z: 2.22, glow: 0.95 });
      kit.box(5.9, 0.1, 0.1, '#16171c', { y: 2.48, z: 2.25, mat: 'metal' });
      for (let i = 0; i < 4; i++) kit.box(1.1, 1.4, 0.06, '#a8d8ff', { x: -2.25 + i * 1.5, y: 4.3, z: 2.22, glow: 0.65 });
      kit.box(6.7, 0.18, 0.18, color, { y: 3.05, z: 2.25, glow: 3 });
      kit.box(6.8, 0.2, 5.8, color, { y: 5.9, z: -0.6, glow: 2.6 });
      kit.add(new THREE.BoxGeometry(5.8, 0.08, 1.4), color, { y: 2.62, z: 2.85, rx: 0.32, mat: 'cloth' });
      signSpec = { x: 0, y: 6.75, z: 2.0, w: 4.6, h: 1.15, posts: true };
      board = { x: 2.2, y: 4.3, z: 2.32, w: 2.2, h: 1.24 };
      foot = [3.4, 3.4];
    } else {
      kit.box(6.2, 18, 5.6, '#0d1a33', { y: 9, z: -0.6, mat: 'tower' });
      for (const [x, z] of [[-3.1, 2.2], [3.1, 2.2], [-3.1, -3.4], [3.1, -3.4]]) kit.box(0.14, 18, 0.14, color, { x, y: 9, z, glow: 3 });
      for (let fy = 3; fy < 18; fy += 3) kit.box(6.24, 0.06, 0.06, color, { y: fy, z: 2.22, glow: 1.2 });
      kit.box(5.4, 2.4, 0.06, '#ffe2b8', { y: 1.3, z: 2.22, glow: 0.95 });
      kit.box(6.6, 0.5, 6.0, '#16171c', { y: 18.25, z: -0.6, mat: 'metal' });
      kit.box(6.7, 0.12, 6.1, color, { y: 18.5, z: -0.6, glow: 3.4 });
      signSpec = { x: 0, y: 19.8, z: 1.2, w: 5.2, h: 1.3, posts: true };
      board = { x: 0, y: 9.5, z: 2.26, w: 4.6, h: 2.6 };
      foot = [3.3, 3.4];
      for (const s of [-1, 1]) {
        const beam = new THREE.Mesh(new THREE.ConeGeometry(1.6, 34, 20, 1, true), new THREE.MeshBasicMaterial({ map: beamTex, color: new THREE.Color(color).multiplyScalar(0.55), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
        beam.geometry.translate(0, -17, 0);
        const pivot = new THREE.Group();
        pivot.position.set(s * 1.8, 18.6, -0.6);
        beam.rotation.x = Math.PI;
        pivot.add(beam);
        beam.layers.set(2);
        own.push(pivot);
        anim.push((dt, t) => { pivot.rotation.set(Math.sin(t * 0.6 + s) * 0.35, 0, Math.cos(t * 0.5 + s * 2) * 0.35); });
      }
    }
    if (board?.posts) for (const s of [-1, 1]) kit.box(0.08, board.y, 0.08, '#2a2c30', { x: board.x + s * (board.w / 2 - 0.2), y: board.y / 2, z: board.z - 0.12, mat: 'metal' });
    if (signSpec?.posts && level < 3) for (const s of [-1, 1]) kit.box(0.07, signSpec.y, 0.07, '#2a2c30', { x: signSpec.x + s * (signSpec.w / 2 - 0.2), y: signSpec.y / 2, z: signSpec.z - 0.08, mat: 'metal' });
    const built = kit.build({ ...kitMats, ...plotMats });
    built.traverse(o => { if (o.isMesh) { o.userData.pick = { kind: 'plot', plotId: slot.id }; pick.push(o); } });
    group.add(built);
    own.forEach(o => group.add(o));
    const label = data?.sign_text || (level === 0 ? '분양 중' : data?.owner_name || `${slot.id}번 토지`);
    const sMat = plotSign(level === 0 ? signSpec.text : label, color, level === 0 ? signSpec.sub : (data?.owner_name ? `OWNER · ${String(data.owner_name).slice(0, 10)}` : ''));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(signSpec.w, signSpec.h), sMat);
    sign.position.set(signSpec.x, signSpec.y, signSpec.z);
    sign.userData.pick = { kind: 'plot', plotId: slot.id };
    group.add(sign);
    pick.push(sign);
    const badgeC = makeCanvas(256, 128);
    paintPlotBadge(badgeC, slot.id, level, color);
    const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(badgeC), transparent: true, depthWrite: false }));
    badge.scale.set(1.2, 0.6, 1);
    badge.position.set(-3.4, level >= 3 ? 1.2 : 3.0, 3.4);
    badge.layers.set(2);
    group.add(badge);
    scene.add(group);
    const slotId = 'PLOT_' + slot.id;
    const boardGroup = boards.mount(slotId, group, { x: board.x, y: board.y, z: board.z, w: board.w, h: board.h });
    const box = [];
    if (foot) {
      const swap = Math.abs(Math.sin(slot.rot)) > 0.5;
      const cx = slot.x, cz = slot.z, hx = (swap ? foot[1] : foot[0]) * sc, hz = (swap ? foot[0] : foot[1]) * sc;
      box.push({ x0: cx - hx, x1: cx + hx, z0: cz - hz, z1: cz + hz, plot: slot.id });
      colliders.push(box[0]);
      if (level >= 3) blockers.push(Object.assign(new THREE.Box3(new THREE.Vector3(cx - hx, 0, cz - hz), new THREE.Vector3(cx + hx, (level === 4 ? 19 : 6) * sc, cz + hz)), { plot: slot.id }));
    }
    return { id: slot.id, level, color, data: data || { plot_id: slot.id, level }, group, boardGroup, anim, sMat, signSpec, sign };
  }

  function clearPlot(rec) {
    boards.unmount('PLOT_' + rec.id, rec.boardGroup);
    rec.group.traverse(o => {
      const i = pick.indexOf(o);
      if (i >= 0) pick.splice(i, 1);
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material !== kitMats.base) {
        for (const m of [].concat(o.material)) {
          if (Object.values(kitMats).includes(m) || Object.values(plotMats).includes(m)) continue;
          if (m.map && m.map !== beamTex && m.map !== glowTex) m.map.dispose();
          m.dispose();
        }
      }
    });
    scene.remove(rec.group);
    for (let i = colliders.length - 1; i >= 0; i--) if (colliders[i].plot === rec.id) colliders.splice(i, 1);
    for (let i = blockers.length - 1; i >= 0; i--) if (blockers[i].plot === rec.id) blockers.splice(i, 1);
  }

  function applyPlot(data) {
    const id = Number(data?.plot_id);
    const slot = PLOT_SLOTS[id - 1];
    if (!slot) return null;
    const prev = plots.get(id);
    const level = Math.max(0, Math.min(4, Number(data.level) || 0));
    const merged = { ...(prev?.data || {}), ...data };
    const color = merged.theme_color || '#00ffcc';
    if (prev && prev.level === level && prev.color === color && prev.data.sign_text === merged.sign_text && prev.data.owner_name === merged.owner_name) {
      prev.data = merged;
      return { rec: prev, changed: false };
    }
    if (prev) clearPlot(prev);
    const rec = buildPlot(slot, merged);
    plots.set(id, rec);
    return { rec, changed: !!prev, levelUp: prev ? level > prev.level : false };
  }

  for (const slot of PLOT_SLOTS) plots.set(slot.id, buildPlot(slot, { plot_id: slot.id, level: 0, theme_color: '#00ffcc' }));

  function update(dt, t) {
    for (const u of updaters) u(dt, t);
    for (const rec of plots.values()) for (const a of rec.anim) a(dt, t);
  }

  function plotFront(id, out = new THREE.Vector3()) {
    const slot = PLOT_SLOTS[id - 1];
    if (!slot) return null;
    const d = 5.4 * (slot.scale || 1);
    return out.set(slot.x + Math.sin(slot.rot) * d, LAYOUT.walk.y, slot.z + Math.cos(slot.rot) * d);
  }

  return { update, stall, atm, stage, plots, applyPlot, plotFront };
}
