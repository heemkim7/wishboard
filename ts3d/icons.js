// Named landmarks and the Times Square towers. OSM stores each setback as its own full-height box,
// so the skyline reads as stacked crates. These rebuild the same footprints as tiers, with a
// street-level name, using the measured height of each part.
import * as THREE from 'three';

const SIDE = THREE.DoubleSide;

function partOf(B, i) {
  const pts = [];
  for (let p = B.off[i]; p < B.off[i + 1]; p++) pts.push([B.xs[p], B.zs[p]]);
  const w = B.x1[i] - B.x0[i], d = B.z1[i] - B.z0[i];
  return { h: B.h[i], cx: B.cx[i], cz: B.cz[i], x0: B.x0[i], x1: B.x1[i], z0: B.z0[i], z1: B.z1[i], pts, area: w * d, w, d };
}

function gather(nyc, x, z, r, pred) {
  const B = nyc.buildings;
  const out = [];
  for (let i = 0; i < B.count; i++) {
    if (Math.hypot(B.cx[i] - x, B.cz[i] - z) > r) continue;
    if (pred && !pred(B, i)) continue;
    const part = partOf(B, i);
    if (part.area < 50 || part.h < 8) continue;
    nyc.hideMesh[i] = 1;
    out.push(part);
  }
  return out;
}

// Widest piece is the base. Each smaller, taller piece above it is the next setback.
function setbacks(parts) {
  if (!parts.length) return [];
  const anchor = parts.reduce((a, p) => (p.h > a.h ? p : a), parts[0]);
  const near = parts.filter(p => Math.hypot(p.cx - anchor.cx, p.cz - anchor.cz) < 24);
  const base = near.reduce((a, p) => (p.area > a.area ? p : a), near[0]);
  const tiers = [{ ...base, y0: 0, y1: base.h }];
  let top = base.h, area = base.area;
  const above = near.filter(p => p !== base && p.h > base.h + 2).sort((a, b) => a.h - b.h || b.area - a.area);
  for (const p of above) {
    if (p.h < top + 2 || p.area > area * 1.08) continue;
    tiers.push({ ...p, y0: top, y1: p.h });
    top = p.h;
    area = p.area;
  }
  for (const p of near) {
    if (p === base || p.h > base.h - 1) continue;
    const inside = p.cx > base.x0 && p.cx < base.x1 && p.cz > base.z0 && p.cz < base.z1;
    if (!inside) tiers.push({ ...p, y0: 0, y1: p.h });
  }
  return tiers;
}

function makeTex(paint) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  paint(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function windowTex(stone, glass, lit, cols, rows) {
  return makeTex((g) => {
    g.fillStyle = stone;
    g.fillRect(0, 0, 512, 512);
    const bw = 512 / cols, bh = 512 / rows;
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
      const on = (x * 3 + y * 5) % 7 !== 1;
      g.fillStyle = on ? lit : '#12161c';
      g.fillRect(x * bw + bw * 0.18, y * bh + bh * 0.16, bw * 0.64, bh * 0.62);
      if (on) { g.fillStyle = glass; g.fillRect(x * bw + bw * 0.22, y * bh + bh * 0.2, bw * 0.26, bh * 0.24); }
    }
  });
}

function signTex(title, sub) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#1a120c';
  g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = '#e6c27a';
  g.lineWidth = 12;
  g.strokeRect(18, 18, 988, 220);
  g.fillStyle = '#f3d48a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${sub ? 78 : 92}px "Pretendard Variable", Pretendard, sans-serif`;
  g.fillText(title, 512, sub ? 104 : 128);
  if (sub) {
    g.font = '600 40px "Pretendard Variable", Pretendard, sans-serif';
    g.fillStyle = '#fff6dc';
    g.fillText(sub, 512, 172);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function Geo() {
  const p = [], n = [], u = [], ix = [];
  let v = 0;
  const push = (x, y, z, nx, ny, nz, uu, vv) => { p.push(x, y, z); n.push(nx, ny, nz); u.push(uu, vv); return v++; };
  function quad(a, b, c, d) {
    const ia = push(...a), ib = push(...b), ic = push(...c), id = push(...d);
    ix.push(ia, ib, ic, ia, ic, id);
  }
  function box(x0, y0, z0, x1, y1, z1, win) {
    const s = win ? 1 : 0.02;
    quad([x0, y0, z1, 0, 0, 1, x0 * s / 4.2, y0 * s / 3.6], [x1, y0, z1, 0, 0, 1, x1 * s / 4.2, y0 * s / 3.6], [x1, y1, z1, 0, 0, 1, x1 * s / 4.2, y1 * s / 3.6], [x0, y1, z1, 0, 0, 1, x0 * s / 4.2, y1 * s / 3.6]);
    quad([x1, y0, z0, 0, 0, -1, -x1 * s / 4.2, y0 * s / 3.6], [x0, y0, z0, 0, 0, -1, -x0 * s / 4.2, y0 * s / 3.6], [x0, y1, z0, 0, 0, -1, -x0 * s / 4.2, y1 * s / 3.6], [x1, y1, z0, 0, 0, -1, -x1 * s / 4.2, y1 * s / 3.6]);
    quad([x1, y0, z1, 1, 0, 0, z1 * s / 4.2, y0 * s / 3.6], [x1, y0, z0, 1, 0, 0, z0 * s / 4.2, y0 * s / 3.6], [x1, y1, z0, 1, 0, 0, z0 * s / 4.2, y1 * s / 3.6], [x1, y1, z1, 1, 0, 0, z1 * s / 4.2, y1 * s / 3.6]);
    quad([x0, y0, z0, -1, 0, 0, -z0 * s / 4.2, y0 * s / 3.6], [x0, y0, z1, -1, 0, 0, -z1 * s / 4.2, y0 * s / 3.6], [x0, y1, z1, -1, 0, 0, -z1 * s / 4.2, y1 * s / 3.6], [x0, y1, z0, -1, 0, 0, -z0 * s / 4.2, y1 * s / 3.6]);
    if (!win) {
      quad([x0, y1, z1, 0, 1, 0, 0, 0], [x1, y1, z1, 0, 1, 0, 1, 0], [x1, y1, z0, 0, 1, 0, 1, 1], [x0, y1, z0, 0, 1, 0, 0, 1]);
      if (y0 > 0.4) quad([x0, y0, z0, 0, -1, 0, 0, 0], [x1, y0, z0, 0, -1, 0, 1, 0], [x1, y0, z1, 0, -1, 0, 1, 1], [x0, y0, z1, 0, -1, 0, 0, 1]);
    }
  }
  function prism(pts, y0, y1, win) {
    const s = win ? 1 : 0.02;
    let cx = 0, cz = 0;
    for (const [x, z] of pts) { cx += x; cz += z; }
    cx /= pts.length; cz /= pts.length;
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
      const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz);
      if (L < 0.4) continue;
      let nx = dz / L, nz = -dx / L;
      if ((cx - (x1 + x2) / 2) * nx + (cz - (z1 + z2) / 2) * nz > 0) { nx = -nx; nz = -nz; }
      quad(
        [x1, y0, z1, nx, 0, nz, 0, y0 * s / 3.6],
        [x2, y0, z2, nx, 0, nz, L * s / 4.2, y0 * s / 3.6],
        [x2, y1, z2, nx, 0, nz, L * s / 4.2, y1 * s / 3.6],
        [x1, y1, z1, nx, 0, nz, 0, y1 * s / 3.6],
      );
    }
    const top = pts.map(([x, z]) => [x, y1, z, 0, 1, 0, 0, 0]);
    const c = push(cx, y1, cz, 0, 1, 0, 0.5, 0.5);
    for (let i = 0; i < top.length; i++) {
      const a = push(...top[i]), b = push(...top[(i + 1) % top.length]);
      ix.push(c, a, b);
    }
  }
  function frustum(x, z, y0, y1, w0, d0, w1, d1) {
    const ring = (y, w, d) => [[x - w / 2, y, z - d / 2], [x + w / 2, y, z - d / 2], [x + w / 2, y, z + d / 2], [x - w / 2, y, z + d / 2]];
    const a = ring(y0, w0, d0), b = ring(y1, w1, d1);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      quad([...a[i], 0, 0, 1, 0, y0 / 3.6], [...a[j], 0, 0, 1, 1, y0 / 3.6], [...b[j], 0, 0, 1, 1, y1 / 3.6], [...b[i], 0, 0, 1, 0, y1 / 3.6]);
    }
    quad([...b[0], 0, 1, 0, 0, 0], [...b[1], 0, 1, 0, 1, 0], [...b[2], 0, 1, 0, 1, 1], [...b[3], 0, 1, 0, 0, 1]);
  }
  function mesh(mat) {
    if (!ix.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    g.setIndex(ix);
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  }
  return { box, prism, frustum, mesh };
}

function addSign(group, mat, tier, y) {
  const wideX = tier.w >= tier.d;
  const w = Math.min(wideX ? tier.w : tier.d, 28) * 0.72;
  const h = Math.max(3.2, Math.min(6.2, w * 0.24));
  for (const dir of [1, -1]) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    if (wideX) {
      board.position.set((tier.x0 + tier.x1) / 2, y, dir > 0 ? tier.z1 + 0.6 : tier.z0 - 0.6);
      board.rotation.y = dir > 0 ? 0 : Math.PI;
    } else {
      board.position.set(dir > 0 ? tier.x1 + 0.6 : tier.x0 - 0.6, y, (tier.z0 + tier.z1) / 2);
      board.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    group.add(board);
  }
}

function mats() {
  const lime = windowTex('#c4b29a', 'rgba(255,244,220,0.7)', '#ffd7a1', 4, 4);
  const brick = windowTex('#6e4a3a', 'rgba(255,214,170,0.65)', '#ffcf8a', 4, 4);
  const glass = windowTex('#163044', 'rgba(190,230,255,0.55)', '#9fd4ff', 6, 8);
  const canyon = windowTex('#2a3148', 'rgba(255,180,210,0.5)', '#ffd27a', 4, 5);
  const steel = new THREE.MeshStandardMaterial({ color: 0xd9dde6, roughness: 0.28, metalness: 0.82, emissive: 0x8899aa, emissiveIntensity: 0.18, side: SIDE });
  const stone = new THREE.MeshStandardMaterial({ color: 0xcbb89a, roughness: 0.78, metalness: 0.05, side: SIDE });
  const dress = (map, color, emissive, intensity) => new THREE.MeshStandardMaterial({ map, color, emissive, emissiveIntensity: intensity, roughness: 0.62, metalness: 0.08, side: SIDE });
  return {
    lime: dress(lime, 0xcbb89a, 0xffe2b8, 0.45),
    brick: dress(brick, 0x8a5a42, 0xffc48a, 0.4),
    glass: dress(glass, 0x9ec8e8, 0x8ec6ff, 0.55),
    canyon: dress(canyon, 0xb7c0da, 0xffc48a, 0.5),
    steel, stone,
  };
}

function drawStack(group, mat, tiers, steel) {
  const win = new Geo();
  const plain = new Geo();
  for (const t of tiers) {
    const slim = Math.max(t.w, t.d) < 16;
    const g = slim ? plain : win;
    if (t.forcePts && t.pts.length >= 3) g.prism(t.pts, t.y0, t.y1, !slim);
    else g.box(t.x0, t.y0, t.z0, t.x1, t.y1, t.z1, !slim);
    if (!slim && !t.forcePts && t.y1 - t.y0 > 8) plain.box(t.x0 - 0.35, t.y1 - 0.7, t.z0 - 0.35, t.x1 + 0.35, t.y1 + 0.25, t.z1 + 0.35, false);
  }
  const a = win.mesh(mat), b = plain.mesh(steel);
  if (a) group.add(a);
  if (b) group.add(b);
}

/** Hide the OSM crates before the city mesh is built. */
export function claimIcons(nyc) {
  const jobs = [];
  const stack = (id, x, z, r, opt = {}) => {
    const parts = gather(nyc, x, z, r, opt.pred);
    const tiers = setbacks(parts);
    if (!tiers.length) return;
    jobs.push({ id, tiers, ...opt });
  };
  stack('esb', 502.8, 937.6, 30, { name: 'EMPIRE STATE', ko: '엠파이어 스테이트', mat: 'lime' });
  stack('chrysler', 1095.3, 205.6, 16, { name: 'CHRYSLER', ko: '크라이슬러 빌딩', mat: 'brick', spire: 319 });
  const gct = gather(nyc, 868.7, 209.8, 20, (B, i) => B.h[i] < 80 && B.h[i] > 20);
  if (gct.length) jobs.push({ id: 'gct', tiers: setbacks(gct).map(t => ({ ...t, forcePts: true })), name: 'GRAND CENTRAL', ko: '그랜드 센트럴', mat: 'lime', clock: true });
  const msg = gather(nyc, -184.8, 1052.2, 20, (B, i) => B.h[i] > 30 && B.h[i] < 70 && (B.off[i + 1] - B.off[i]) > 20);
  if (msg.length) jobs.push({ id: 'msg', tiers: setbacks(msg).map(t => ({ ...t, forcePts: true })), name: 'MSG', ko: '매디슨 스퀘어 가든', mat: 'canyon' });
  const flat = gather(nyc, 606, 1817, 18, (B, i) => B.h[i] > 60);
  if (flat.length) jobs.push({ id: 'flatiron', tiers: setbacks(flat).map(t => ({ ...t, forcePts: true })), name: 'FLATIRON', ko: '플랫아이언', mat: 'lime' });
  const un = gather(nyc, 1773.6, 169.6, 30, (B, i) => B.h[i] > 120 && (B.x1[i] - B.x0[i]) * (B.z1[i] - B.z0[i]) > 400);
  if (un.length) jobs.push({ id: 'un', tiers: setbacks(un), name: 'UNITED NATIONS', ko: '유엔 본부', mat: 'glass' });
  const wtc = gather(nyc, 375, 5504, 45, (B, i) => B.h[i] > 300);
  if (wtc.length) jobs.push({ id: 'wtc', kind: 'wtc', parts: wtc, name: 'ONE WTC', ko: '원 월드 트레이드 센터' });

  return jobs;
}

export function buildIcons(jobs, { scene }) {
  if (!jobs?.length) return null;
  const M = mats();
  const group = new THREE.Group();
  const signs = new Map();
  const signFor = (name, ko) => {
    const k = name + ko;
    if (!signs.has(k)) signs.set(k, new THREE.MeshBasicMaterial({ map: signTex(name, ko), color: new THREE.Color(1.15, 1.12, 1), side: SIDE }));
    return signs.get(k);
  };
  for (const job of jobs) {
    if (job.kind === 'wtc') {
      drawWtc(group, M, job);
      continue;
    }
    const mat = M[job.mat] || M.lime;
    drawStack(group, mat, job.tiers, M.steel);
    if (job.name) addSign(group, signFor(job.name, job.ko), job.tiers[0], Math.min(16, job.tiers[0].y1 * 0.45));
    if (job.spire) {
      const top = job.tiers.at(-1);
      const cx = (top.x0 + top.x1) / 2, cz = (top.z0 + top.z1) / 2;
      const h = job.spire - top.y1;
      if (h > 4) {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 2.4, h, 10), M.steel);
        mast.position.set(cx, top.y1 + h / 2, cz);
        group.add(mast);
      }
    }
    if (job.clock) {
      const t = job.tiers[0];
      const face = new THREE.Mesh(new THREE.CircleGeometry(4.2, 24), new THREE.MeshBasicMaterial({ color: 0xf2d48a, side: SIDE }));
      face.position.set((t.x0 + t.x1) / 2, t.y1 * 0.72, t.z1 + 0.8);
      group.add(face);
    }
  }
  scene.add(group);
  return group;
}

function drawWtc(group, M, job) {
  const base = job.parts.reduce((a, p) => (p.area > a.area ? p : a), job.parts[0]);
  const cx = (base.x0 + base.x1) / 2, cz = (base.z0 + base.z1) / 2;
  const g = new Geo();
  g.frustum(cx, cz, 0, 28, base.w, base.d, base.w * 0.96, base.d * 0.96);
  g.frustum(cx, cz, 28, 415, base.w * 0.92, base.d * 0.92, 36, 36);
  g.frustum(cx, cz, 415, 432, 36, 36, 32, 32);
  group.add(g.mesh(M.glass));
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.6, 109, 8), M.steel);
  mast.position.set(cx, 486, cz);
  group.add(mast);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff2c8 }));
  tip.position.set(cx, 541, cz);
  group.add(tip);
  addSign(group, new THREE.MeshBasicMaterial({ map: signTex(job.name, job.ko), color: new THREE.Color(1.15, 1.12, 1), side: SIDE }), base, 14);
}
