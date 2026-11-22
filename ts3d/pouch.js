// 복주머니: the pouch a player throws at the balloon, and the balloon itself, as a small lit 3D mesh (it used to be a
// camera-facing sprite of icons/bokjumeoni.png, so it looked like a photo from every side).
//   body  a lathe of the profile below: round silk bottom, a gathered neck with pleats, a ruffled top; one canvas texture
//         paints the red silk, a gold band and two gold medallions (福 in front, 복 behind)
//   gold  the cord around the neck, the knot (two loops and a bead) and a tassel lying on the front, merged into one mesh
// Two meshes, two materials, one geometry each, built once per world and shared by every throw and the balloon.
// make(size) gives a Group the size of the old sprite of that size (the pouch is POUCH_H of it tall, centred).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeCanvas } from './art.js?v=202611230850';

// [radius, height] from the bottom pole to the top pole of a pouch 1 tall; the neck (where the cord sits) is at NECK_Y.
export const POUCH_PROFILE = Object.freeze([
  [0, 0], [0.15, 0.01], [0.26, 0.05], [0.325, 0.11], [0.355, 0.19], [0.36, 0.27], [0.348, 0.36], [0.315, 0.45],
  [0.265, 0.53], [0.205, 0.6], [0.155, 0.655], [0.128, 0.69], [0.13, 0.715], [0.17, 0.76], [0.225, 0.83],
  [0.255, 0.89], [0.245, 0.93], [0.19, 0.955], [0.1, 0.966], [0, 0.962],
]);
export const NECK_Y = 0.7;
export const POUCH_H = 0.86; // the sprite's square held a pouch about 0.86 of its size tall
const PLEATS = 10;
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// The radius at profile point j and angle phi: pleats gather toward the neck, the frill above it ruffles.
export function pouchRadius(r, y, phi) {
  const gather = smooth((y - 0.48) / (NECK_Y - 0.48)) * (1 - smooth((y - NECK_Y) / 0.03));
  const frill = smooth((y - NECK_Y) / 0.12);
  return r + Math.cos(phi * PLEATS) * (0.018 * gather + 0.03 * frill * (r > 0 ? 1 : 0));
}

function bodyGeometry(segments) {
  const P = POUCH_PROFILE.length;
  const pos = [], uv = [], index = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments, phi = (u - 0.25) * Math.PI * 2; // u 0.25 faces +Z (the front medallion)
    for (let j = 0; j < P; j++) {
      const [r0, y0] = POUCH_PROFILE[j];
      const r = r0 > 0 ? pouchRadius(r0, y0, phi) : 0;
      const y = y0 + (y0 > 0.86 && r0 > 0 ? 0.012 * Math.cos(phi * PLEATS) * smooth((y0 - 0.86) / 0.04) : 0);
      pos.push(Math.sin(phi) * r, y, Math.cos(phi) * r);
      uv.push(u, y0);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < P - 1; j++) {
      const a = j + i * P, b = a + P, c = b + 1, d = a + 1;
      index.push(a, b, d, c, d, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  // The seam (first and last column) and the two poles are separate vertices: give them one normal each.
  const n = g.attributes.normal;
  const tmp = new THREE.Vector3(), add = new THREE.Vector3();
  for (let j = 0; j < P; j++) {
    const a = j, b = j + segments * P;
    tmp.fromBufferAttribute(n, a).add(add.fromBufferAttribute(n, b)).normalize();
    n.setXYZ(a, tmp.x, tmp.y, tmp.z);
    n.setXYZ(b, tmp.x, tmp.y, tmp.z);
  }
  for (const j of [0, P - 1]) for (let i = 0; i <= segments; i++) n.setXYZ(j + i * P, 0, j ? 1 : -1, 0);
  return g;
}

// The cord, the knot and the tassel, in the same units (pouch 1 tall, bottom at y 0).
function goldGeometry(low) {
  const parts = [];
  const neckR = POUCH_PROFILE.find(([, y]) => y >= NECK_Y - 0.011)[0];
  parts.push(new THREE.TorusGeometry(neckR + 0.018, 0.022, low ? 5 : 6, low ? 16 : 24).rotateX(Math.PI / 2).translate(0, NECK_Y - 0.005, 0));
  const front = neckR + 0.04;
  for (const s of [-1, 1]) {
    parts.push(new THREE.TorusGeometry(0.036, 0.011, 4, low ? 8 : 10).scale(1, 0.75, 1).rotateZ(s * 0.45).translate(s * 0.04, NECK_Y - 0.002, front));
  }
  parts.push(new THREE.SphereGeometry(0.024, 8, 6).translate(0, NECK_Y - 0.006, front + 0.006));
  // The tassel hangs from the knot and lies along the body below it (tilted 45° forward).
  const tassel = [
    new THREE.CylinderGeometry(0.007, 0.007, 0.07, 5, 1, true).translate(0, -0.035, 0),
    new THREE.SphereGeometry(0.02, 8, 5).translate(0, -0.075, 0),
    new THREE.CylinderGeometry(0.016, 0.042, 0.15, low ? 8 : 10, 1).translate(0, -0.165, 0),
  ];
  const tilt = new THREE.Matrix4().makeRotationX(-0.78).setPosition(0, NECK_Y - 0.03, front + 0.01);
  for (const t of tassel) parts.push(t.applyMatrix4(tilt));
  for (const p of parts) p.deleteAttribute('uv');
  return mergeGeometries(parts);
}

// Red silk with a gold band near the bottom and two gold medallions at the widest part: 福 in front, 복 behind.
function paintSilk(c) {
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  const silk = g.createLinearGradient(0, 0, 0, H);
  silk.addColorStop(0, '#c4122e');
  silk.addColorStop(0.45, '#d81a34');
  silk.addColorStop(1, '#a80c25');
  g.fillStyle = silk;
  g.fillRect(0, 0, W, H);
  // faint vertical sheen, so the lit silk is not one flat red
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(255,190,200,${0.025 + 0.025 * ((i * 7) % 3)})`;
    g.fillRect(((i * 37) % 97) / 97 * W, 0, W / 160, H);
  }
  const v2y = (v) => (1 - v) * H; // texture v (0 bottom, 1 top) to canvas y
  const gold = g.createLinearGradient(0, v2y(0.17), 0, v2y(0.09));
  gold.addColorStop(0, '#ffe08a');
  gold.addColorStop(1, '#c98a1c');
  g.fillStyle = gold;
  g.fillRect(0, v2y(0.165), W, H * 0.012);
  g.fillRect(0, v2y(0.105), W, H * 0.012);
  // little diamonds between the two lines
  const n = 36, y = v2y(0.135), d = H * 0.018;
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n * W;
    g.beginPath();
    g.moveTo(x, y - d); g.lineTo(x + d * 0.8, y); g.lineTo(x, y + d); g.lineTo(x - d * 0.8, y);
    g.closePath();
    g.fill();
  }
  // Medallions: round on the body, so squeezed across by how much wider the texture is than the pouch around there.
  const r = POUCH_PROFILE[5][0], sx = W / (2 * Math.PI * r), sy = H; // pixels per pouch-height unit, across and up
  const R = 0.1;
  for (const [u, glyph] of [[0.25, '福'], [0.75, '복']]) {
    g.save();
    g.translate(u * W, v2y(0.32));
    g.scale(sx / sy, 1);
    const rp = R * sy;
    const disc = g.createRadialGradient(-rp * 0.3, -rp * 0.3, rp * 0.1, 0, 0, rp);
    disc.addColorStop(0, '#fff1b8');
    disc.addColorStop(0.55, '#f2bd45');
    disc.addColorStop(1, '#b97a12');
    g.fillStyle = disc;
    g.beginPath(); g.arc(0, 0, rp, 0, Math.PI * 2); g.fill();
    g.lineWidth = rp * 0.08;
    g.strokeStyle = '#8a5a08';
    g.beginPath(); g.arc(0, 0, rp * 0.84, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#9c0c22';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 ${Math.round(rp * 1.15)}px "Noto Serif KR", "Batang", "AppleMyungjo", "Noto Sans KR", "Malgun Gothic", serif`;
    g.fillText(glyph, 0, rp * 0.06);
    g.restore();
  }
  return c;
}

export function createPouchKit({ quality = 'high' } = {}) {
  const low = quality === 'low';
  const bodyGeo = bodyGeometry(low ? 20 : 30);
  const goldGeo = goldGeometry(low);
  // pouch of size 1: POUCH_H tall, centred on the origin like the sprite was
  const top = POUCH_PROFILE.reduce((m, [, y]) => Math.max(m, y), 0);
  for (const geo of [bodyGeo, goldGeo]) geo.translate(0, -top / 2, 0).scale(POUCH_H, POUCH_H, POUCH_H);
  const tex = new THREE.CanvasTexture(paintSilk(makeCanvas(low ? 512 : 1024, low ? 256 : 512)));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = low ? 1 : 4;
  // Lit by the scene, with a little of its own colour so it reads at night (the sprite was unlit).
  const bodyMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0.05, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3 });
  const goldMat = new THREE.MeshStandardMaterial({ color: '#f0b840', roughness: 0.32, metalness: 0.75, emissive: '#6a4200', emissiveIntensity: 0.7 });
  const triangles = (bodyGeo.index.count + goldGeo.index.count) / 3;
  function make(size = 1) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(bodyGeo, bodyMat), new THREE.Mesh(goldGeo, goldMat));
    g.scale.setScalar(size);
    return g;
  }
  function dispose() {
    bodyGeo.dispose();
    goldGeo.dispose();
    tex.dispose();
    bodyMat.dispose();
    goldMat.dispose();
  }
  return { make, dispose, triangles, bodyGeo, goldGeo, bodyMat, goldMat };
}
