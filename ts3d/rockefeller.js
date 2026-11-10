// 30 Rockefeller Plaza, built on the real OSM lot (the stacked parts are hidden and replaced).
// Massing follows the measured footprint: a low podium, the narrow 260 m shaft, then the stepped crown.
import * as THREE from 'three';

const STONE = new THREE.Color('#cbb89a');
const STONE_DARK = new THREE.Color('#8d7b64');
const BRONZE = new THREE.Color('#5c4632');

function rockParts(nyc) {
  const B = nyc.buildings;
  const parts = [];
  for (let i = 0; i < B.count; i++) {
    if (Math.hypot(B.cx[i] - 400, B.cz[i] + 351.5) > 42) continue;
    if (B.h[i] < 45 || B.x1[i] - B.x0[i] < 60) continue;
    nyc.hideMesh[i] = 1;
    parts.push({ h: B.h[i], x0: B.x0[i], x1: B.x1[i], z0: B.z0[i], z1: B.z1[i] });
  }
  let base = null, shaft = null;
  for (const p of parts) {
    const area = (p.x1 - p.x0) * (p.z1 - p.z0);
    if (!base || area > base.area) base = { ...p, area };
    if (!shaft || p.h > shaft.h) shaft = p;
  }
  if (!base || !shaft) return null;
  // Lower OSM blocks whose center sits on this lot would hide the podium.
  for (let i = 0; i < B.count; i++) {
    if (B.cx[i] > base.x0 && B.cx[i] < base.x1 && B.cz[i] > base.z0 && B.cz[i] < base.z1) nyc.hideMesh[i] = 1;
  }
  return { base, shaft };
}

function facadeTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#c4b29a';
  g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(80,60,40,${Math.random() * 0.15})`;
    g.fillRect((Math.random() * 1024) | 0, (Math.random() * 1024) | 0, 2, 2);
  }
  const bay = 256, floor = 256;
  for (let x = 0; x < 4; x++) {
    g.fillStyle = '#efe2cf';
    g.fillRect(x * bay, 0, 18, 1024);
    g.fillStyle = '#6d5c48';
    g.fillRect(x * bay + bay - 10, 0, 10, 1024);
    for (let y = 0; y < 4; y++) {
      const px = x * bay + 36, py = y * floor + 28;
      const lit = (x * 3 + y * 5) % 7 !== 1;
      g.fillStyle = '#8d7b64';
      g.fillRect(px - 6, py - 6, 196, 210);
      g.fillStyle = lit ? ((x + y) % 3 === 0 ? '#ffe6b8' : '#ffd08a') : '#141820';
      g.fillRect(px, py, 184, 196);
      if (lit) {
        g.fillStyle = 'rgba(255,244,220,0.45)';
        g.fillRect(px + 8, py + 8, 70, 80);
      }
      g.fillStyle = '#5c4c3c';
      g.fillRect(px + 88, py, 6, 196);
      g.fillRect(px, py + 96, 184, 6);
    }
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const e = document.createElement('canvas');
  e.width = 1024;
  e.height = 1024;
  const eg = e.getContext('2d');
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, 1024, 1024);
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) {
    if ((x * 3 + y * 5) % 7 === 1) continue;
    eg.fillStyle = (x + y) % 3 === 0 ? '#ffd7a1' : '#e8a050';
    eg.fillRect(x * 256 + 42, y * 256 + 34, 172, 180);
  }
  const emissive = new THREE.CanvasTexture(e);
  emissive.colorSpace = THREE.SRGBColorSpace;
  emissive.wrapS = emissive.wrapT = THREE.RepeatWrapping;
  emissive.anisotropy = 8;
  return { map, emissive };
}

function signTexture(title, sub) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#24180f';
  g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = '#e6c27a';
  g.lineWidth = 10;
  g.strokeRect(16, 16, 992, 224);
  g.fillStyle = '#f0d48a';
  g.font = '700 92px "Pretendard Variable", Pretendard, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(title, 512, sub ? 108 : 128);
  if (sub) {
    g.font = '600 40px "Pretendard Variable", Pretendard, sans-serif';
    g.fillStyle = '#fff4d2';
    g.fillText(sub, 512, 176);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function Builder() {
  const p = [], n = [], u = [], ix = [];
  let v = 0;
  const push = (x, y, z, nx, ny, nz, uu, vv) => { p.push(x, y, z); n.push(nx, ny, nz); u.push(uu, vv); return v++; };
  function quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz, u0, v0, u1, v1) {
    const a = push(ax, ay, az, nx, ny, nz, u0, v0);
    const b = push(bx, by, bz, nx, ny, nz, u1, v0);
    const c = push(cx, cy, cz, nx, ny, nz, u1, v1);
    const d = push(dx, dy, dz, nx, ny, nz, u0, v1);
    ix.push(a, b, c, a, c, d);
  }
  // Window UVs are in bays (4.2 m) and floors (3.7 m), so the texture repeats instead of stretching.
  function slab(x0, y0, z0, x1, y1, z1, windows) {
    const s = windows ? 1 : 0.02;
    quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, x0 * s / 4.2, y0 * s / 3.7, x1 * s / 4.2, y1 * s / 3.7);
    quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, -x1 * s / 4.2, y0 * s / 3.7, -x0 * s / 4.2, y1 * s / 3.7);
    quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, z1 * s / 4.2, y0 * s / 3.7, z0 * s / 4.2, y1 * s / 3.7);
    quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, -z0 * s / 4.2, y0 * s / 3.7, -z1 * s / 4.2, y1 * s / 3.7);
    if (!windows) {
      quad(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 1, 0, 0, 0, 1, 1);
      if (y0 > 0.2) quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, -1, 0, 0, 0, 1, 1);
    }
  }
  function geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    g.setIndex(ix);
    return g;
  }
  return { slab, geo };
}

/** Hide the OSM boxes and remember the lot. Call before the city mesh is built. */
export function claimRockefeller(nyc) {
  return rockParts(nyc);
}

export function buildRockefeller(info, { scene }) {
  if (!info) return null;
  const { base, shaft } = info;
  const tex = facadeTexture();
  const wallMat = new THREE.MeshStandardMaterial({ map: tex.map, emissiveMap: tex.emissive, emissive: 0xffe2b8, emissiveIntensity: 0.55, color: STONE, roughness: 0.62, metalness: 0.08, side: THREE.DoubleSide });
  const stoneMat = new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.78, metalness: 0.04, side: THREE.DoubleSide });
  const darkMat = new THREE.MeshStandardMaterial({ color: STONE_DARK, roughness: 0.7, metalness: 0.08, side: THREE.DoubleSide });
  const bronzeMat = new THREE.MeshStandardMaterial({ color: BRONZE, roughness: 0.45, metalness: 0.55, side: THREE.DoubleSide });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2836, roughness: 0.12, metalness: 0.7, envMapIntensity: 1.1, side: THREE.DoubleSide });
  const win = new Builder();
  const stone = new Builder();
  const yP = 22;
  stone.slab(base.x0, 0, base.z0, base.x1, 7, base.z1, false);
  win.slab(base.x0, 7, base.z0, base.x1, yP, base.z1, true);
  win.slab(shaft.x0, yP, shaft.z0, shaft.x1, 236, shaft.z1, true);
  const steps = [[236, 248, 1.5], [248, 256, 3.2], [256, 262, 5.1]];
  for (const [y0, y1, inset] of steps) stone.slab(shaft.x0 + inset, y0, shaft.z0 + inset * 0.6, shaft.x1 - inset, y1, shaft.z1 - inset * 0.6, false);
  // Cornices at the podium and each setback, so the steps read from the street.
  stone.slab(base.x0 - 0.7, yP - 0.8, base.z0 - 0.7, base.x1 + 0.7, yP + 0.35, base.z1 + 0.7, false);
  stone.slab(shaft.x0 - 0.45, 235.2, shaft.z0 - 0.45, shaft.x1 + 0.45, 236.5, shaft.z1 + 0.45, false);
  // Vertical limestone fins on the long faces.
  const fins = new Builder();
  const span = shaft.x1 - shaft.x0;
  for (let i = 1; i < 8; i++) {
    const x = shaft.x0 + span * i / 8;
    fins.slab(x - 0.28, yP, shaft.z1, x + 0.28, 236, shaft.z1 + 0.55, false);
    fins.slab(x - 0.28, yP, shaft.z0 - 0.55, x + 0.28, 236, shaft.z0, false);
  }
  const group = new THREE.Group();
  const add = (builder, mat) => group.add(new THREE.Mesh(builder.geo(), mat));
  add(win, wallMat);
  add(stone, stoneMat);
  add(fins, stoneMat);
  const cx = (shaft.x0 + shaft.x1) / 2, cz = (shaft.z0 + shaft.z1) / 2;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 18, 8), bronzeMat);
  mast.position.set(cx, 271, cz);
  group.add(mast);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
  beacon.position.set(cx, 280.4, cz);
  group.add(beacon);
  // Ground floor: glass lobby and a marquee on both long sides, centered on the tower.
  for (const dir of [1, -1]) {
    const z = dir > 0 ? base.z1 + 0.15 : base.z0 - 0.15;
    const lobby = new THREE.Mesh(new THREE.BoxGeometry(18, 6.2, 0.35), glassMat);
    lobby.position.set(cx, 3.4, z);
    group.add(lobby);
    const door = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.4, 0.5), bronzeMat);
    door.position.set(cx, 1.8, z + dir * 0.15);
    group.add(door);
    const marquee = new THREE.Mesh(new THREE.BoxGeometry(20, 0.45, 2.2), darkMat);
    marquee.position.set(cx, 6.7, z + dir * 1.1);
    group.add(marquee);
    const bulbs = new THREE.Mesh(new THREE.BoxGeometry(19, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0xffe1a8 }));
    bulbs.position.set(cx, 6.35, z + dir * 2.1);
    group.add(bulbs);
  }
  const plaque = new THREE.MeshBasicMaterial({ map: signTexture('30 ROCKEFELLER', '록펠러 센터'), color: new THREE.Color(1.15, 1.15, 1.15) });
  for (const dir of [1, -1]) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(26, 6.5), plaque);
    board.position.set(cx, 13.2, dir > 0 ? base.z1 + 0.4 : base.z0 - 0.4);
    board.rotation.y = dir > 0 ? 0 : Math.PI;
    group.add(board);
    const end = new THREE.Mesh(new THREE.PlaneGeometry(12, 3.4), plaque);
    end.position.set(dir > 0 ? Math.max(base.x1, shaft.x1) + 0.5 : Math.min(base.x0, shaft.x0) - 0.5, 16, cz);
    end.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(end);
  }
  const high = new THREE.MeshBasicMaterial({ map: signTexture('30 ROCK', ''), color: new THREE.Color(1.2, 1.15, 1) });
  for (const dir of [1, -1]) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), high);
    board.position.set(cx, 52, dir > 0 ? shaft.z1 + 0.7 : shaft.z0 - 0.7);
    board.rotation.y = dir > 0 ? 0 : Math.PI;
    group.add(board);
  }
  scene.add(group);
  return group;
}
