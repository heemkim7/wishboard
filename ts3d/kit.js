// Static-prop builder: parts are baked into one geometry per material bucket with
// per-vertex colors (HDR values in the 'glow' bucket drive the bloom pass).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const KEEP = new Set(['position', 'normal', 'uv', 'color']);

export function kitMaterials() {
  return {
    base: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.12 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.88 }),
    gloss: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, metalness: 0.08 }),
    cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.4, depthWrite: false }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
  };
}

export class Kit {
  constructor() { this.parts = new Map(); }

  add(geo, color, o = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0, o.order || 'XYZ');
    _q.setFromEuler(_e);
    _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    _p.set(o.x || 0, o.y || 0, o.z || 0);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    if (o.m) g.applyMatrix4(o.m);
    const c = new THREE.Color(color);
    if (o.glow) c.multiplyScalar(o.glow);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!KEEP.has(k)) g.deleteAttribute(k);
    g.morphAttributes = {};
    g.clearGroups();
    const key = o.mat || (o.glow ? 'glow' : 'base');
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
    return this;
  }

  box(w, h, d, color, o) { return this.add(new THREE.BoxGeometry(w, h, d), color, o); }
  cyl(rt, rb, h, color, o = {}) { return this.add(new THREE.CylinderGeometry(rt, rb, h, o.seg || 14, 1, !!o.open, o.ts || 0, o.tl || Math.PI * 2), color, o); }
  sphere(r, color, o = {}) { const s = o.seg || 12; return this.add(new THREE.SphereGeometry(r, s, Math.max(6, (s * 0.7) | 0)), color, o); }
  cone(r, h, color, o = {}) { return this.add(new THREE.ConeGeometry(r, h, o.seg || 14, 1, !!o.open), color, o); }
  torus(r, t, color, o = {}) { return this.add(new THREE.TorusGeometry(r, t, o.rs || 6, o.ts || 28, o.arc || Math.PI * 2), color, o); }
  plane(w, h, color, o) { return this.add(new THREE.PlaneGeometry(w, h), color, o); }

  /** Thin tube between two points (rails, cables, poles). */
  rod(a, b, r, color, o = {}) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(r, r, len, o.seg || 8, 1, true);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    return this.add(geo, color, { ...o, m });
  }

  isEmpty() { return this.parts.size === 0; }

  /** Merged geometry per material bucket (for InstancedMesh fleets). */
  geometries() {
    const out = new Map();
    for (const [key, list] of this.parts) {
      if (!list.length) continue;
      const geo = mergeGeometries(list, false);
      list.forEach(x => x.dispose());
      if (geo) { geo.computeBoundingSphere(); out.set(key, geo); }
    }
    this.parts.clear();
    return out;
  }

  build(materials, opts = {}) {
    const group = new THREE.Group();
    for (const [key, list] of this.parts) {
      const mat = materials[key];
      if (!mat || !list.length) continue;
      const geo = mergeGeometries(list, false);
      list.forEach(x => x.dispose());
      if (!geo) continue;
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = key;
      if (opts.layer != null) mesh.layers.set(opts.layer);
      if (key === 'glass') mesh.renderOrder = 2;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}

/** Plane whose UVs cover a crop rectangle [u0, v0, u1, v1] of a texture. */
export function cropPlane(w, h, crop) {
  const geo = new THREE.PlaneGeometry(w, h);
  const [u0, v0, u1, v1] = crop;
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return geo;
}

/** Crop given in image fractions from the top-left: [x0, y0, x1, y1] → UV rect. */
export function imgCrop(x0, y0, x1, y1) { return [x0, 1 - y1, x1, 1 - y0]; }

/** Curved slab (annular sector) standing on y=0..h, apex on +z at radius rOut, recentered so the screen apex is at z=0. */
export function arcSlab(rIn, rOut, theta, h, screenR, seg = 32) {
  const shape = new THREE.Shape();
  const a0 = -Math.PI / 2 - theta / 2, a1 = -Math.PI / 2 + theta / 2;
  shape.absarc(0, 0, rOut, a0, a1, false);
  shape.absarc(0, 0, rIn, a1, a0, true);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: seg });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -screenR);
  return geo;
}

/** Bungeo-ppang silhouette (head toward +x), unit length ≈ 1.25. */
export function fishShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0);
  s.lineTo(-0.64, 0.17);
  s.quadraticCurveTo(-0.52, 0.07, -0.36, 0.09);
  s.bezierCurveTo(-0.1, 0.27, 0.3, 0.27, 0.47, 0.07);
  s.quadraticCurveTo(0.54, 0, 0.47, -0.07);
  s.bezierCurveTo(0.3, -0.25, -0.1, -0.25, -0.36, -0.09);
  s.quadraticCurveTo(-0.52, -0.07, -0.64, -0.17);
  s.lineTo(-0.5, 0);
  return s;
}

export function fishGeometry(depth = 0.12) {
  const geo = new THREE.ExtrudeGeometry(fishShape(), {
    depth, bevelEnabled: true, bevelThickness: depth * 0.45, bevelSize: 0.045, bevelSegments: 3, curveSegments: 14,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}
