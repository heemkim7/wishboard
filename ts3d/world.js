// Manhattan streamed in 200 m tiles from the OpenStreetMap extract (ts3d/nyc.js): night facades with
// procedural windows, wet streets with lane paint and crosswalks, parks and rivers, lamps, trees and
// rooftop water towers — plus the far shores and a skyline layer that stays when tiles unload.
import * as THREE from 'three';
import { TILE, ROAD, AREA } from './nyc.js?v=202611221134';
import { LOOP } from './layout.js?v=202611221134';
import { patchWet, GROUND_LAYER } from './ground.js?v=202611221134';
import { Kit } from './kit.js?v=202611221134';
import { makeCanvas, paintPuddles, paintGlow } from './art.js?v=202611221134';

export const FAR_LAYER = 3;
const SKY_H = 150;

// Wall albedo: one desaturated slate / charcoal family, nearly neutral (the light and the tone map's toe add the
// blue). Under the night lights (hemisphere 2.8 #b4b8c8 / #2c2e36, moon 1.0, see timesSquare3d.js) an unlit wall
// shows as about #0f152b (away from the moon) .. #151b34 (moonlit), centred on #141a33; the fog lifts far walls toward
// #1c1a3a. Each style keeps its own slight hue and value so neighbouring blocks still separate.
const STYLE_COLORS = [
  ['#5a6070', '#5e6474', '#565c6c', '#626878', '#5c6272', '#586070'], // glass towers: cool slate
  ['#606270', '#646674', '#5c5e6c', '#686a78', '#626470'], // office stone: charcoal
  ['#626070', '#666474', '#5e5c6c', '#6a6878', '#646272', '#605e6e'], // old brick: a hint warmer, never red
  ['#686a7a', '#6e707e', '#646676', '#727484', '#6a6c7a'], // limestone: lighter slate
  ['#5e606e', '#585a68', '#62646e'],
  ['#545664', '#5a5c6a', '#505260'],
  ['#5a5c6c', '#5e606e', '#646670'],
].map(list => list.map(c => new THREE.Color(c)));
const FLOOR_H = [3.9, 3.7, 3.1, 3.4, 5.5, 4.6, 3.6];
const ROOF_COLORS = ['#34363e', '#383a44', '#32343c', '#3c3e46', '#36383f'].map(c => new THREE.Color(c));
const CAP_COLOR = new THREE.Color('#5a6274');

const hash1 = (n) => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Growable indexed geometry with position/normal/uv/color (+ optional aWin vec4). */
class Geo {
  constructor(win = false) {
    this.win = win;
    this.cap = 2048;
    this.n = 0;
    this.p = new Float32Array(this.cap * 3);
    this.nm = new Float32Array(this.cap * 3);
    this.uv = new Float32Array(this.cap * 2);
    this.c = new Float32Array(this.cap * 3);
    this.w = win ? new Float32Array(this.cap * 4) : null;
    this.idx = new Uint32Array(6144);
    this.ni = 0;
  }
  grow(v, i) {
    if (this.n + v > this.cap) {
      let cap = this.cap;
      while (this.n + v > cap) cap *= 2;
      const g = (a, k) => { const b = new Float32Array(cap * k); b.set(a); return b; };
      this.p = g(this.p, 3); this.nm = g(this.nm, 3); this.uv = g(this.uv, 2); this.c = g(this.c, 3);
      if (this.w) this.w = g(this.w, 4);
      this.cap = cap;
    }
    if (this.ni + i > this.idx.length) {
      let len = this.idx.length;
      while (this.ni + i > len) len *= 2;
      const b = new Uint32Array(len);
      b.set(this.idx);
      this.idx = b;
    }
  }
  v(x, y, z, nx, ny, nz, u, vv, col, w0 = 0, w1 = 0, w2 = 0, w3 = 0) {
    const n = this.n++;
    this.p[n * 3] = x; this.p[n * 3 + 1] = y; this.p[n * 3 + 2] = z;
    this.nm[n * 3] = nx; this.nm[n * 3 + 1] = ny; this.nm[n * 3 + 2] = nz;
    this.uv[n * 2] = u; this.uv[n * 2 + 1] = vv;
    this.c[n * 3] = col.r; this.c[n * 3 + 1] = col.g; this.c[n * 3 + 2] = col.b;
    if (this.w) { this.w[n * 4] = w0; this.w[n * 4 + 1] = w1; this.w[n * 4 + 2] = w2; this.w[n * 4 + 3] = w3; }
    return n;
  }
  t(a, b, c) { this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c; }
  empty() { return this.ni === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p.slice(0, this.n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nm.slice(0, this.n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, this.n * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.c.slice(0, this.n * 3), 3));
    if (this.w) g.setAttribute('aWin', new THREE.BufferAttribute(this.w.slice(0, this.n * 4), 4));
    g.setIndex(new THREE.BufferAttribute(this.n < 65536 ? new Uint16Array(this.idx.subarray(0, this.ni)) : this.idx.slice(0, this.ni), 1));
    g.computeBoundingSphere();
    return g;
  }
}

const _v2 = [];
function triangulate(xs, zs, a, b) {
  const n = b - a;
  while (_v2.length < n) _v2.push(new THREE.Vector2());
  const contour = [];
  for (let k = 0; k < n; k++) contour.push(_v2[k].set(xs[a + k], zs[a + k]));
  try { return THREE.ShapeUtils.triangulateShape(contour, []); } catch { return []; }
}

/** Facade material: windows, storefront band and glass reflections from the aWin attribute. */
function facadeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.06, envMapIntensity: 0.55 });
  const uWin = { value: 1 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWin = uWin;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aWin;\nflat varying vec4 vWin;\nvarying vec2 vFac;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvWin = aWin;\nvFac = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uWin;
flat varying vec4 vWin;
varying vec2 vFac;
float wHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float sfBand(float x, float a, float b, float w) { return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x)); }
// thin dark line of half-width hw at distance d: crisp when near, and its average stays at its true coverage when far
float sfLine(float d, float hw, float w) { return (1.0 - smoothstep(hw - w, hw + w, d)) * min(1.0, hw / max(w, 1e-4)); }
float gRefl = 0.0;
vec3 gEmit = vec3(0.0);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
if (vWin.z < 0.5) {
  float style = vWin.x, seed = vWin.y, fh = vWin.w;
  float colW = style < 0.5 ? 1.55 : style < 1.5 ? 2.05 : style < 2.5 ? 2.6 : style < 3.5 ? 2.3 : style < 4.5 ? 4.2 : style < 5.5 ? 5.6 : 3.2;
  vec2 cell = vec2(vFac.x / colW, vFac.y / fh);
  vec2 id = floor(cell), f = fract(cell);
  vec2 m = style < 0.5 ? vec2(0.05, 0.1) : style < 1.5 ? vec2(0.16, 0.2) : style < 2.5 ? vec2(0.3, 0.27) : style < 3.5 ? vec2(0.27, 0.24) : style < 4.5 ? vec2(0.36, 0.2) : vec2(0.38, 0.36);
  vec2 fw = fwidth(cell);
  vec2 aa = fw * 1.25 + 1e-4;
  vec2 w2 = smoothstep(m - aa, m + aa, f) * smoothstep(m - aa, m + aa, 1.0 - f);
  float cover = (1.0 - 2.0 * m.x) * (1.0 - 2.0 * m.y);
  float px = max(fw.x, fw.y);
  // window outlines fade to their coverage once a window is under ~8 px
  float shape = clamp(1.0 - (px - 0.07) * 9.0, 0.0, 1.0);
  // lit/unlit per window fades to one even dim glow between 4 px and 2 px per window, so the far field is calm
  float detail = 1.0 - smoothstep(0.25, 0.5, px);
  float win = mix(cover, w2.x * w2.y, shape);
  float street = 1.0 - smoothstep(4.2, 4.5, vFac.y);
  float h = wHash(id + seed * 71.3);
  float h2 = wHash(id.yx * 1.7 + seed * 13.1);
  // lit share: dense styles 0-3 about 10% (8.5% / 8% single windows + 3% of floors fully lit at 85%), sparse 4-6 about 5%
  float ratio = style < 1.5 ? 0.085 : style < 3.5 ? 0.08 : style < 4.5 ? 0.055 : style < 5.5 ? 0.045 : 0.06;
  float dense = step(style, 3.5);
  float fh2 = wHash(vec2(id.y, seed * 9.7));
  float floorLit = step(0.97, fh2) * dense;
  float lit = max(step(h, ratio), floorLit * step(0.15, wHash(id * 0.37 + seed)));
  float share = ratio + (1.0 - ratio) * 0.03 * 0.85 * dense;
  // one warm tint, rgb(255,200,120), for most windows and a cool one, rgb(170,205,255), for about one in eight
  // (linear values below); a fully lit floor shares one tint
  vec3 warm = vec3(1.0, 0.578, 0.188), cool = vec3(0.402, 0.61, 1.0);
  float coolPick = mix(step(0.875, h2), step(0.85, fract(fh2 * 37.0)), floorLit);
  vec3 tint = mix(warm, cool, coolPick);
  // far field: an even dim glow at 40% of the true average (lit dots near the camera also get bloom, the far field
  // does not), tinted a little cooler than the average so distant towers read plum rather than brown
  lit = mix(share * 0.4, lit, detail);
  // a lit room is a little brighter toward its ceiling, so a near window is not one flat cream panel
  float room = mix(1.0, 0.72 + 0.28 * smoothstep(m.y, 1.0 - m.y, f.y), detail * shape);
  vec3 upTint = mix(mix(warm, cool, 0.25), tint, detail) * 2.1;
  float upWin = win * (1.0 - street);
  float glassK = style < 0.5 ? 1.0 : 0.55;
  vec3 glass = style < 0.5 ? vec3(0.026, 0.034, 0.05) : vec3(0.022, 0.024, 0.03);
  diffuseColor.rgb = mix(diffuseColor.rgb, glass, upWin * 0.88);
  gEmit = upTint * upWin * lit * room;
  gRefl = upWin * glassK;

  // ---- street-level storefronts, 6.4 m bays, all in metres along the wall (x) and up (y) ----
  // 0-0.4 plinth, 0.4-3.0 glass in 3-4 panes with a transom at 2.55, 3.0-3.5 fascia with a 0.16 m sign strip,
  // 0.35 m piers between bays. Lines are anti-aliased with fwidth; once a bay is only a few pixels wide the whole
  // band fades to one even dim warm value (no flicker, no bright strip).
  // vFac.y is metres above the street and sf is 0 from 3.55 m up, so only the bottom 3.6 m of a wall runs the
  // storefront maths (the rest of the tower skips it; the result is the same). The pixel footprint is taken outside
  // the branch: a derivative inside non-uniform control flow is undefined.
  float y = vFac.y;
  float sf = street * (1.0 - smoothstep(3.45, 3.55, y));
  vec2 sw = max(fwidth(vFac), vec2(1e-4));
  if (vFac.y < 3.6) {
    float sfFar = smoothstep(0.3, 1.0, max(sw.x, sw.y));
    float aw = sw.x * 0.75, ah = sw.y * 0.75;
    float bayI = floor(vFac.x / 6.4), bx = fract(vFac.x / 6.4) * 6.4;
    float bh = wHash(vec2(bayI, seed * 3.1));
    float shut = step(bh, 0.1);                       // about one bay in ten shuttered
    float on = step(0.1, bh) * step(bh, 0.67);         // about 57% lit, the rest dark glass
    float panes = 3.0 + step(0.5, fract(bh * 7.31));
    float pt = (bx - 0.35) / 5.7 * panes;
    float md = abs(fract(pt + 0.5) - 0.5) * 5.7 / panes;
    float mull = max(sfLine(md, 0.03, aw), sfLine(abs(y - 2.55), 0.03, ah));
    float pane = sfBand(bx, 0.35, 6.05, aw) * sfBand(y, 0.4, 3.0, ah);
    float glassM = pane * (1.0 - mull);
    float strip = sfBand(y, 3.17, 3.33, ah) * sfBand(bx, 0.6, 5.8, aw);
    float slat = sfLine(abs(fract(y / 0.12 + 0.5) - 0.5) * 0.12, 0.012, ah) * (1.0 - smoothstep(0.03, 0.06, sw.y));
    // diffuse: dark frame, plinth and fascia; dark glass; shutters flat dark grey with thin slat lines
    vec3 frame = vec3(0.02, 0.022, 0.028);
    vec3 dGlass = vec3(0.014, 0.018, 0.026);
    vec3 dShut = vec3(0.05, 0.05, 0.055) * (1.0 - 0.55 * slat);
    vec3 nearD = mix(frame, mix(dGlass, dShut, shut), mix(glassM, pane, shut));
    // emission: warm amber glass, brightest in the upper third, about 45% of the old shop band, +-25% per bay
    float fall = mix(0.3, 1.0, smoothstep(0.4, 2.3, y));
    float vary = 0.75 + 0.5 * fract(bh * 13.7);
    vec3 amber = vec3(1.0, 0.6, 0.26);
    vec3 nearE = amber * (0.75 * fall * vary * on) * glassM;
    nearE += vec3(0.012, 0.02, 0.034) * glassM * (1.0 - on) * (1.0 - shut);
    float hue = fract(bh * 29.3);
    vec3 signC = hue < 0.334 ? vec3(1.0, 0.078, 0.366) : hue < 0.667 ? vec3(0.065, 0.672, 0.871) : vec3(1.0, 0.434, 0.014);
    nearE += signC * (2.6 * on * strip);
    // far: one even dim warm value (60% of the average glass glow, strips folded in)
    vec3 farE = amber * 0.13;
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(nearD, frame, sfFar), sf);
    gEmit = mix(gEmit, mix(nearE, farE, sfFar), sf);
    gRefl = mix(gRefl, glassM * (1.0 - shut) * (1.0 - sfFar), sf);
  }
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.38, clamp(gRefl, 0.0, 1.0));`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.22, clamp(gRefl, 0.0, 1.0));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += gEmit * uWin;`);
  };
  mat.customProgramCacheKey = () => 'kts-facade';
  return { mat, uWin };
}

export function createWorld(ctx) {
  const { scene, renderer, manager, nyc, quality, kitMats, reflection, layout } = ctx;
  const low = quality === 'low';
  const RAD = quality === 'high' ? { full: 560, far: 1500 } : quality === 'medium' ? { full: 440, far: 1050 } : { full: 300, far: 680 };
  const REFL_R = quality === 'high' ? 380 : 260;
  const B = nyc.buildings, R = nyc.roads, A = nyc.areas;

  // ---- materials ------------------------------------------------------------------------------------------
  // Ground is flat-shaded and procedural: no photo textures (nothing to download, nothing magnified into blur).
  // Pavement shows as dark neutral concrete (about #1a1d2b) with large low-contrast joints drawn in the wet-street
  // shader (ts3d/ground.js); the road is near-black wet asphalt (about #0b0d16) and glossy enough for the reflection
  // pass on medium/high. Damp darkening (1 - 0.38 * wet) is already folded into those on-screen values.
  // Low has no reflection pass, so its road is a step lighter (about #12131f), its paint 25% stronger, and every tier's
  // road carries a very soft two-octave wet/dry value variation (+-5%, 23 m and 7.7 m) from ts3d/ground.js.
  const puddleTex = new THREE.CanvasTexture(paintPuddles(makeCanvas(512, 512)));
  puddleTex.wrapS = puddleTex.wrapT = THREE.RepeatWrapping;
  const glowTex = new THREE.CanvasTexture(paintGlow(makeCanvas(128, 128)));
  const surface = (color, roughness, o) => patchWet(new THREE.MeshStandardMaterial({
    color, roughness, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: o.po ?? 0, polygonOffsetUnits: (o.po ?? 0) * 2,
  }), reflection, puddleTex, o);
  const mats = {
    land: surface('#565558', 0.8, { wet: 0.55, puddles: 0.5, reflect: 0.75, pave: [1.6, 1.6, 0.26, 0] }),
    asphalt: surface(low ? '#524f50' : '#4c4a4a', 0.62, { wet: 0.82, puddles: 1, reflect: 1, po: -2, vary: 0.05 }),
    pavers: surface('#585658', 0.74, { wet: 0.62, puddles: 0.7, reflect: 0.9, po: -1, pave: [2.0, 1.0, 0.24, 1] }),
    grass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    pool: patchWet(new THREE.MeshStandardMaterial({ color: '#0b1522', roughness: 0.05, metalness: 0.2, envMapIntensity: 1.2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }), reflection, puddleTex, { wet: 1, puddles: 0, reflect: 1.25 }),
    paint: patchWet(new THREE.MeshStandardMaterial({ vertexColors: true, color: new THREE.Color(1, 1, 1).multiplyScalar(low ? 1.25 : 1), roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }), reflection, puddleTex, { wet: 0.55, puddles: 0.6, reflect: 0.35 }),
    river: patchWet(new THREE.MeshStandardMaterial({ color: '#08101c', roughness: 0.04, metalness: 0.15, envMapIntensity: 1.1 }), reflection, puddleTex, { wet: 1, puddles: 0, reflect: 1.35 }),
    wall: new THREE.MeshStandardMaterial({ color: '#3a3b40', roughness: 0.9, metalness: 0.05 }),
    shore: new THREE.MeshStandardMaterial({ color: '#15171c', roughness: 0.95, metalness: 0 }),
    trunk: new THREE.MeshStandardMaterial({ color: '#3b2b20', roughness: 0.95 }),
    leaf: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 }),
  };
  const { mat: facade, uWin } = facadeMaterial();
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });

  const group = new THREE.Group();
  scene.add(group);
  const put = (geo, mat, layer = 0, order = 0, parent = group) => {
    const m = new THREE.Mesh(geo, mat);
    m.layers.set(layer);
    m.renderOrder = order;
    parent.add(m);
    return m;
  };

  // ---- skipped buildings (replaced by game structures) ------------------------------------------------------------
  for (let i = 0; i < B.count; i++) {
    for (const z of layout.SKIP_ZONES) {
      if (B.cx[i] >= z.x0 && B.cx[i] <= z.x1 && B.cz[i] >= z.z0 && B.cz[i] <= z.z1) { nyc.skipBuilding[i] = 1; break; }
    }
  }
  // (The photo-dressed shop south of the stall is gone: it now gets the procedural facade like its neighbours.)

  // ---- building geometry ------------------------------------------------------------------------------------------
  const tmpCol = new THREE.Color();
  function addBuilding(g, i, ox, oz) {
    const a = B.off[i], b = B.off[i + 1], n = b - a;
    const h = B.h[i], mh = B.minh[i], rh = B.roof[i];
    const pyramid = (B.flags[i] & 1) && rh > 0.4;
    const top = pyramid ? h - rh : h;
    if (top - mh < 0.25 && !pyramid) return;
    const seed = hash1(i + 17);
    const style = B.style[i];
    // An OSM building:colour only sets how light the wall is (and a 6% hint of its hue); the palette stays the night one.
    const list = STYLE_COLORS[style] || STYLE_COLORS[1];
    const col = list[Math.floor(seed * list.length)].clone();
    if (B.color[i]) {
      const c = B.color[i];
      tmpCol.setRGB(((c >> 11) & 31) / 31, ((c >> 5) & 63) / 63, (c & 31) / 31, THREE.SRGBColorSpace);
      const luma = (k) => 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b;
      const lum = luma(tmpCol);
      col.lerp(tmpCol.multiplyScalar(luma(col) / Math.max(lum, 1e-3)), 0.06).multiplyScalar(0.82 + 0.36 * Math.sqrt(Math.min(1, lum)));
    } else {
      col.multiplyScalar(0.85 + hash1(i * 7 + 3) * 0.3);
    }
    const fh = FLOOR_H[style] ?? 3.5;
    let u = Math.floor(seed * 9) * 1.1;
    g.grow(n * 4 + n * 3 + 8, n * 6 + n * 6);
    for (let k = 0; k < n; k++) {
      const p = a + k, q = k + 1 < n ? p + 1 : a;
      const x1 = B.xs[p] - ox, z1 = B.zs[p] - oz, x2 = B.xs[q] - ox, z2 = B.zs[q] - oz;
      const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz);
      if (L < 0.05) continue;
      const nx = dz / L, nz = -dx / L;
      const va = g.v(x1, mh, z1, nx, 0, nz, u, mh, col, style, seed, 0, fh);
      const vb = g.v(x2, mh, z2, nx, 0, nz, u + L, mh, col, style, seed, 0, fh);
      const vc = g.v(x2, top, z2, nx, 0, nz, u + L, top, col, style, seed, 0, fh);
      const vd = g.v(x1, top, z1, nx, 0, nz, u, top, col, style, seed, 0, fh);
      g.t(va, vc, vb);
      g.t(va, vd, vc);
      u += L;
    }
    const roofCol = ROOF_COLORS[Math.floor(seed * 97) % ROOF_COLORS.length];
    if (pyramid) {
      let cx = 0, cz = 0;
      for (let k = 0; k < n; k++) { cx += B.xs[a + k]; cz += B.zs[a + k]; }
      cx = cx / n - ox; cz = cz / n - oz;
      const capCol = style === 0 ? CAP_COLOR : roofCol;
      for (let k = 0; k < n; k++) {
        const p = a + k, q = k + 1 < n ? p + 1 : a;
        const x1 = B.xs[p] - ox, z1 = B.zs[p] - oz, x2 = B.xs[q] - ox, z2 = B.zs[q] - oz;
        const ex = x2 - x1, ez = z2 - z1;
        const ux = cx - x1, uy = rh, uz = cz - z1;
        let nx = uy * ez - uz * 0, ny = uz * ex - ux * ez, nz = ux * 0 - uy * ex;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const v0 = g.v(x1, top, z1, nx, ny, nz, 0, 0, capCol, style, seed, 1, fh);
        const v1 = g.v(cx, h, cz, nx, ny, nz, 0, 0, capCol, style, seed, 1, fh);
        const v2 = g.v(x2, top, z2, nx, ny, nz, 0, 0, capCol, style, seed, 1, fh);
        g.t(v0, v1, v2);
      }
    } else {
      const tris = triangulate(B.xs, B.zs, a, b);
      if (tris.length) {
        const base = g.n;
        g.grow(n, tris.length * 3);
        for (let k = 0; k < n; k++) g.v(B.xs[a + k] - ox, top, B.zs[a + k] - oz, 0, 1, 0, 0, 0, roofCol, style, seed, 1, fh);
        for (const [i0, i1, i2] of tris) {
          const ax = B.xs[a + i0], az = B.zs[a + i0];
          const cy = (B.zs[a + i1] - az) * (B.xs[a + i2] - ax) - (B.xs[a + i1] - ax) * (B.zs[a + i2] - az);
          if (cy > 0) g.t(base + i0, base + i1, base + i2); else g.t(base + i0, base + i2, base + i1);
        }
        if (mh > 1.5) {
          const under = g.n;
          g.grow(n, tris.length * 3);
          for (let k = 0; k < n; k++) g.v(B.xs[a + k] - ox, mh, B.zs[a + k] - oz, 0, -1, 0, 0, 0, roofCol, style, seed, 1, fh);
          for (const [i0, i1, i2] of tris) {
            const ax = B.xs[a + i0], az = B.zs[a + i0];
            const cy = (B.zs[a + i1] - az) * (B.xs[a + i2] - ax) - (B.xs[a + i1] - ax) * (B.zs[a + i2] - az);
            if (cy > 0) g.t(under + i0, under + i2, under + i1); else g.t(under + i0, under + i1, under + i2);
          }
        }
      }
    }
  }

  // ---- roads ------------------------------------------------------------------------------------------------------------
  const G = nyc.graph;
  const junctionR = new Float32Array(G.nodeX.length);
  for (let nd = 0; nd < G.nodeX.length; nd++) {
    if (G.nodeAdj[nd].length < 3) continue;
    let w = 0;
    for (const e of G.nodeAdj[nd]) w = Math.max(w, R.width[e.road]);
    junctionR[nd] = w / 2;
  }
  const nodeDeg = (x, z) => { const nd = G.nodeAt(x, z); return nd == null ? 0 : G.nodeAdj[nd].length; };
  const nodeRad = (x, z) => { const nd = G.nodeAt(x, z); return nd == null ? 0 : junctionR[nd]; };
  // Lane paint: off-white rgb(222,225,234) at half strength (#a3a5ac); the centre line is a muted warm grey, not
  // yellow; the curb is only a shade lighter than the pavement.
  const WHITE = new THREE.Color('#a3a5ac'), YELLOW = new THREE.Color('#8e8578'), CURB = new THREE.Color('#5c606c');
  const UP = [0, 1, 0];

  // UVs come from world coordinates so the textures run seamlessly across tiles.
  const uvo = { x: 0, z: 0, k: 1 / 6 };
  function quadAlong(g, ax, az, fx, fz, s0, s1, o0, o1, y, col) {
    const px = -fz, pz = fx;
    const x0 = ax + fx * s0, z0 = az + fz * s0, x1 = ax + fx * s1, z1 = az + fz * s1;
    const k = uvo.k, ux = uvo.x, uz = uvo.z;
    g.grow(4, 6);
    const v = (x, z) => g.v(x, y, z, 0, 1, 0, (x + ux) * k, (z + uz) * k, col);
    const a = v(x0 + px * o0, z0 + pz * o0), b = v(x1 + px * o0, z1 + pz * o0);
    const c = v(x1 + px * o1, z1 + pz * o1), d = v(x0 + px * o1, z0 + pz * o1);
    if ((s1 - s0) * (o1 - o0) < 0) { g.t(a, b, c); g.t(a, c, d); } else { g.t(a, c, b); g.t(a, d, c); }
  }
  function disc(g, cx, cz, r, y, col, seg = 10) {
    const k = uvo.k, ux = uvo.x, uz = uvo.z;
    g.grow(seg + 1, seg * 3);
    const c = g.v(cx, y, cz, 0, 1, 0, (cx + ux) * k, (cz + uz) * k, col);
    const first = g.n;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      g.v(x, y, z, 0, 1, 0, (x + ux) * k, (z + uz) * k, col);
    }
    for (let i = 0; i < seg; i++) g.t(c, first + ((i + 1) % seg), first + i);
  }

  function buildRoads(t, ox, oz, detail) {
    const asphalt = new Geo(), pavers = new Geo(), marks = detail ? new Geo() : null;
    const white = new THREE.Color('#ffffff');
    uvo.x = ox; uvo.z = oz;
    for (const p of t.seg) {
      const r = R.segRoad[p];
      const cls = R.cls[r];
      const w = R.width[r];
      const ax = R.xs[p], az = R.zs[p], bx = R.xs[p + 1], bz = R.zs[p + 1];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L < 0.05) continue;
      const fx = dx / L, fz = dz / L;
      const g = cls === ROAD.PEDESTRIAN ? pavers : asphalt;
      const y = cls === ROAD.PEDESTRIAN ? 0.022 : 0.03;
      uvo.k = cls === ROAD.PEDESTRIAN ? 1 / 4.2 : 1 / 6;
      quadAlong(g, ax - ox, az - oz, fx, fz, 0, L, -w / 2, w / 2, y, white);
      disc(g, ax - ox, az - oz, w / 2, y, white, w > 12 ? 14 : 10);
      if (p + 1 === R.off[r + 1] - 1) disc(g, bx - ox, bz - oz, w / 2, y, white, w > 12 ? 14 : 10);
      if (!marks || cls === ROAD.PEDESTRIAN || cls === ROAD.SERVICE) continue;
      const degA = nodeDeg(ax, az), degB = nodeDeg(bx, bz);
      const jA = degA >= 3 ? nodeRad(ax, az) : 0, jB = degB >= 3 ? nodeRad(bx, bz) : 0;
      const lx = ax - ox, lz = az - oz;
      const lanes = R.lanes[r], one = R.oneway[r];
      const t0 = jA ? jA + 5.2 : 0, t1 = L - (jB ? jB + 5.2 : 0);
      const ym = 0.045;
      // curbs
      const c0 = jA ? jA + 0.4 : 0, c1 = L - (jB ? jB + 0.4 : 0);
      if (c1 - c0 > 1.5 && cls !== ROAD.MOTORWAY) {
        quadAlong(marks, lx, lz, fx, fz, c0, c1, -w / 2, -w / 2 + 0.28, ym + 0.01, CURB);
        quadAlong(marks, lx, lz, fx, fz, c0, c1, w / 2 - 0.28, w / 2, ym + 0.01, CURB);
      }
      if (t1 - t0 > 3) {
        if (!one && lanes >= 2) {
          quadAlong(marks, lx, lz, fx, fz, t0, t1, -0.24, -0.11, ym, YELLOW);
          quadAlong(marks, lx, lz, fx, fz, t0, t1, 0.11, 0.24, ym, YELLOW);
        }
        const usable = w - 2.2;
        const offs = [];
        if (one && lanes >= 2) for (let k = 1; k < lanes; k++) offs.push(-usable / 2 + (k * usable) / lanes);
        else if (!one && lanes >= 4) { const half = lanes >> 1; for (let k = 1; k < half; k++) { const o = (k * usable) / 2 / half; offs.push(o, -o); } }
        for (const o of offs) for (let s = t0 + 1; s + 3 < t1; s += 9) quadAlong(marks, lx, lz, fx, fz, s, s + 3, o - 0.07, o + 0.07, ym, WHITE);
      }
      // crosswalks + stop lines at junction ends
      for (const end of [0, 1]) {
        const jr = end ? jB : jA;
        if (!jr || cls > ROAD.STREET) continue;
        const s0 = end ? L - jr - 0.6 - 3.4 : jr + 0.6, s1 = s0 + 3.4;
        if (s0 < 0 || s1 > L) continue;
        for (let o = -w / 2 + 0.5; o + 0.55 < w / 2 - 0.3; o += 1.15) quadAlong(marks, lx, lz, fx, fz, s0, s1, o, o + 0.55, ym + 0.002, WHITE);
        const incoming = one ? end === 1 : true;
        if (!incoming) continue;
        const sl = end ? s0 - 0.9 : s1 + 0.45;
        const [o0, o1] = one ? [-w / 2 + 0.3, w / 2 - 0.3] : end ? [0.3, w / 2 - 0.3] : [-w / 2 + 0.3, -0.3];
        quadAlong(marks, lx, lz, fx, fz, sl, sl + 0.45, o0, o1, ym + 0.002, WHITE);
      }
    }
    return { asphalt, pavers, marks };
  }

  // ---- street furniture kits (shared geometries) -----------------------------------------------------------------------
  const lampKit = new Kit();
  lampKit.cyl(0.22, 0.28, 0.6, '#1c2028', { y: 0.3, mat: 'metal' });
  lampKit.cyl(0.08, 0.12, 7.6, '#1c2028', { y: 4.1, mat: 'metal' });
  lampKit.box(0.12, 0.12, 2.1, '#1c2028', { y: 7.8, z: 1.0, mat: 'metal' });
  lampKit.box(0.46, 0.2, 0.8, '#22262e', { y: 7.75, z: 2.05, mat: 'metal' });
  lampKit.box(0.38, 0.04, 0.68, '#ffd9a0', { y: 7.62, z: 2.05, glow: 3.0 });
  const lampGeos = lampKit.geometries();
  const treeTrunk = new THREE.CylinderGeometry(0.13, 0.2, 3, 6).translate(0, 1.5, 0);
  const treeTop = new THREE.IcosahedronGeometry(1.9, 1).translate(0, 4.3, 0);
  const towerKit = new Kit();
  towerKit.cyl(2.1, 2.1, 4.2, '#463a34', { y: 3.6, seg: 14 });
  towerKit.cone(2.3, 1.6, '#2e2826', { y: 6.5, seg: 14 });
  for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) towerKit.cyl(0.09, 0.09, 1.6, '#26262a', { x: dx, y: 0.8, z: dz, mat: 'metal', seg: 5 });
  towerKit.box(3.2, 0.12, 3.2, '#26262a', { y: 1.55, mat: 'metal' });
  const towerGeos = towerKit.geometries();
  const subKit = new Kit();
  for (const s of [-1, 1]) {
    subKit.cyl(0.05, 0.06, 2.2, '#1e3328', { x: s * 1.1, y: 1.1, z: -1.6, mat: 'metal', seg: 6 });
    subKit.sphere(0.2, '#46d68a', { x: s * 1.1, y: 2.35, z: -1.6, glow: 2.2, seg: 10 });
    subKit.box(0.06, 1.05, 3.4, '#1c2c24', { x: s * 1.2, y: 0.52, z: 0, mat: 'metal' });
  }
  subKit.box(2.4, 1.05, 0.06, '#1c2c24', { y: 0.52, z: 1.7, mat: 'metal' });
  const subGeos = subKit.geometries();
  const beaconGeo = new THREE.SphereGeometry(0.55, 8, 6);
  const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color('#ffbf80').multiplyScalar(0.2) });
  const kitMat = (key) => kitMats[key] || kitMats.base;

  // ---- props (lamp poles, trunks) collision grid -------------------------------------------------------------------------
  const PC = 12;
  const props = new Map();
  const pkey = (cx, cz) => (cx + 4000) * 10000 + (cz + 4000);
  function addProp(x, z, r, owner) {
    const k = pkey(Math.floor(x / PC), Math.floor(z / PC));
    let l = props.get(k);
    if (!l) props.set(k, (l = []));
    l.push({ x, z, r, owner });
  }
  function dropProps(owner) {
    for (const [k, l] of props) {
      const kept = l.filter(p => p.owner !== owner);
      if (kept.length !== l.length) { if (kept.length) props.set(k, kept); else props.delete(k); }
    }
  }
  function collideProps(x, z, r) {
    const c0x = Math.floor((x - r - 1) / PC), c1x = Math.floor((x + r + 1) / PC), c0z = Math.floor((z - r - 1) / PC), c1z = Math.floor((z + r + 1) / PC);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const l = props.get(pkey(cx, cz));
      if (!l) continue;
      for (const p of l) {
        const dx = x - p.x, dz = z - p.z, rr = r + p.r, d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        x = p.x + (dx / d) * rr;
        z = p.z + (dz / d) * rr;
      }
    }
    return [x, z];
  }

  const inZone = (zones, x, z) => zones.some(q => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1);
  const tileAreas = new Map();
  for (let i = 0; i < A.count; i++) {
    const k = A.kind[i];
    if (k !== AREA.PARK && k !== AREA.WOOD && k !== AREA.WATER && k !== AREA.PLAZA) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let p = A.off[i]; p < A.off[i + 1]; p++) { x0 = Math.min(x0, A.xs[p]); x1 = Math.max(x1, A.xs[p]); z0 = Math.min(z0, A.zs[p]); z1 = Math.max(z1, A.zs[p]); }
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) for (let tz = Math.floor(z0 / TILE); tz <= Math.floor(z1 / TILE); tz++) {
      const key = nyc.tileKey(tx, tz);
      let l = tileAreas.get(key);
      if (!l) tileAreas.set(key, (l = []));
      l.push({ i, x0, x1, z0, z1 });
    }
  }

  const inst = (geo, mat, list, parent, layer = 0) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    for (let i = 0; i < list.length; i++) m.setMatrixAt(i, list[i]);
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    m.layers.set(layer);
    parent.add(m);
    return m;
  };
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), YA = new THREE.Vector3(0, 1, 0);
  const mtx = (x, y, z, yaw = 0, s = 1, sy = s) => M4.compose(V.set(x, y, z), Q.setFromAxisAngle(YA, yaw), S.set(s, sy, s)).clone();

  function buildDetail(t, ox, oz, root, key) {
    const rnd = mulberry(t.key * 2654435761);
    const lamps = [], pools = [], trunks = [], tops = [], topCols = [], towers = [], subs = [], beacons = [];
    for (const p of t.seg) {
      const r = R.segRoad[p];
      const cls = R.cls[r];
      if (cls > ROAD.STREET || cls === ROAD.MOTORWAY) continue;
      const w = R.width[r];
      const ax = R.xs[p], az = R.zs[p], dx = R.xs[p + 1] - ax, dz = R.zs[p + 1] - az, L = Math.hypot(dx, dz);
      if (L < 12) continue;
      const fx = dx / L, fz = dz / L, px = -fz, pz = fx;
      const jA = nodeDeg(ax, az) >= 3 ? nodeRad(ax, az) + 6 : 4, jB = nodeDeg(R.xs[p + 1], R.zs[p + 1]) >= 3 ? nodeRad(R.xs[p + 1], R.zs[p + 1]) + 6 : 4;
      const step = cls <= ROAD.SECONDARY ? 28 : 34;
      for (let s = jA + ((p * 7) % 9); s < L - jB; s += step) {
        for (const side of [-1, 1]) {
          const off = w / 2 + 0.75;
          const x = ax + fx * s + px * off * side, z = az + fz * s + pz * off * side;
          if (nyc.buildingAt(x, z) >= 0 || inZone(layout.NO_PROPS, x, z)) continue;
          const yaw = Math.atan2(-px * side, -pz * side);
          lamps.push(mtx(x - ox, 0, z - oz, yaw));
          pools.push(M4.compose(V.set(x - ox - px * side * 2.05, 0.06, z - oz - pz * side * 2.05), Q.identity(), S.set(10, 1, 10)).clone());
          addProp(x, z, 0.3, key);
        }
      }
      if (cls >= ROAD.TERTIARY && !low) {
        for (let s = jA + 3 + ((p * 5) % 7); s < L - jB; s += 9.5) {
          for (const side of [-1, 1]) {
            if (rnd() < 0.42) continue;
            const off = w / 2 + 1.9;
            const x = ax + fx * s + px * off * side, z = az + fz * s + pz * off * side;
            if (nyc.buildingAt(x, z) >= 0 || inZone(layout.NO_PROPS, x, z)) continue;
            const sc = 0.75 + rnd() * 0.45;
            trunks.push(mtx(x - ox, 0, z - oz, rnd() * 6, sc));
            tops.push(mtx(x - ox, 0, z - oz, rnd() * 6, sc));
            topCols.push(0.6 + rnd() * 0.5);
            addProp(x, z, 0.32, key);
          }
        }
      }
    }
    // park trees
    const parks = tileAreas.get(t.key) || [];
    const waters = parks.filter(a => A.kind[a.i] === AREA.WATER);
    for (const ar of parks) {
      const kind = A.kind[ar.i];
      if (kind !== AREA.PARK && kind !== AREA.WOOD) continue;
      const tx0 = Math.max(ar.x0, ox), tx1 = Math.min(ar.x1, ox + TILE), tz0 = Math.max(ar.z0, oz), tz1 = Math.min(ar.z1, oz + TILE);
      if (tx1 <= tx0 || tz1 <= tz0) continue;
      const dens = kind === AREA.WOOD ? 1 / 55 : 1 / 170;
      const n = Math.min(low ? 120 : 380, Math.round((tx1 - tx0) * (tz1 - tz0) * dens));
      for (let k = 0; k < n; k++) {
        const x = tx0 + rnd() * (tx1 - tx0), z = tz0 + rnd() * (tz1 - tz0);
        if (!nyc.pointIn(A, ar.i, x, z) || inZone(layout.NO_PROPS, x, z) || inZone(layout.NO_TREES, x, z)) continue;
        if (waters.some(wa => x >= wa.x0 && x <= wa.x1 && z >= wa.z0 && z <= wa.z1 && nyc.pointIn(A, wa.i, x, z))) continue;
        const nr = nyc.nearestRoad(x, z, 14);
        if (nr && nr.d < R.width[nr.road] / 2 + 1.2) continue;
        if (nyc.buildingAt(x, z) >= 0) continue;
        const sc = 0.85 + rnd() * 0.75;
        trunks.push(mtx(x - ox, 0, z - oz, rnd() * 6, sc));
        tops.push(mtx(x - ox, 0, z - oz, rnd() * 6, sc * (0.9 + rnd() * 0.3), sc));
        topCols.push(0.5 + rnd() * 0.6);
        addProp(x, z, 0.35 * sc, key);
      }
    }
    // rooftop water towers and aircraft beacons
    for (const i of t.b) {
      if (nyc.skipBuilding[i] || nyc.hideMesh[i]) continue;
      const h = B.h[i];
      const area = (B.x1[i] - B.x0[i]) * (B.z1[i] - B.z0[i]);
      const s = hash1(i * 31 + 5);
      if ((B.style[i] === 2 || B.style[i] === 3) && h > 14 && h < 75 && area > 160 && s < 0.36 && !(B.flags[i] & 1)) {
        const x = B.cx[i] + (hash1(i * 3) - 0.5) * (B.x1[i] - B.x0[i]) * 0.4, z = B.cz[i] + (hash1(i * 5) - 0.5) * (B.z1[i] - B.z0[i]) * 0.4;
        if (nyc.pointIn(B, i, x, z)) towers.push(mtx(x - ox, h, z - oz, s * 6, 0.8 + s));
      }
      if (h > 100 && h < SKY_H) beacons.push(mtx(B.cx[i] - ox, h + 1.2, B.cz[i] - oz));
    }
    for (let k = 0; k < nyc.entrances.count; k++) {
      const x = nyc.entrances.xs[k], z = nyc.entrances.zs[k];
      if (x < ox || x >= ox + TILE || z < oz || z >= oz + TILE) continue;
      if (inZone(layout.NO_PROPS, x, z)) continue;
      const nr = nyc.nearestRoad(x, z, 25);
      const yaw = nr ? Math.atan2(nr.fx, nr.fz) : 0;
      subs.push(mtx(x - ox, 0, z - oz, yaw));
    }
    for (const [k, geo] of lampGeos) inst(geo, kitMat(k), lamps, root);
    const pm = inst(poolGeo, poolMat, pools, root, GROUND_LAYER);
    if (pm) pm.renderOrder = 4;
    inst(treeTrunk, mats.trunk, trunks, root);
    const tm = inst(treeTop, mats.leaf, tops, root);
    if (tm) {
      const c = new THREE.Color();
      topCols.forEach((v, i) => tm.setColorAt(i, c.setRGB(0.06 * v, 0.12 * v, 0.08 * v)));
      tm.instanceColor.needsUpdate = true;
    }
    for (const [k, geo] of towerGeos) inst(geo, kitMat(k), towers, root);
    for (const [k, geo] of subGeos) inst(geo, kitMat(k), subs, root);
    inst(beaconGeo, beaconMat, beacons, root);
  }

  // ---- tiles -------------------------------------------------------------------------------------------------------------
  const live = new Map();
  const queue = [];
  let lastX = 1e9, lastZ = 1e9;
  function disposeGroup(g) {
    if (!g) return;
    g.traverse(o => { if (o.isMesh && o.geometry && !o.isInstancedMesh) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
    g.parent?.remove(g);
  }
  function buildBase(rec) {
    const t = rec.t;
    const ox = t.tx * TILE, oz = t.tz * TILE;
    const root = new THREE.Group();
    root.position.set(ox, 0, oz);
    const g = new Geo(true);
    for (const i of t.b) if (!nyc.skipBuilding[i] && !nyc.hideMesh[i] && B.h[i] < SKY_H) addBuilding(g, i, ox, oz);
    if (!g.empty()) put(g.build(), facade, 0, 0, root);
    const roads = buildRoads(t, ox, oz, false);
    if (!roads.asphalt.empty()) put(roads.asphalt.build(), mats.asphalt, GROUND_LAYER, 1, root);
    if (!roads.pavers.empty()) put(roads.pavers.build(), mats.pavers, GROUND_LAYER, 1, root);
    group.add(root);
    rec.base = root;
  }
  function buildDetailRec(rec) {
    const t = rec.t;
    const ox = t.tx * TILE, oz = t.tz * TILE;
    const root = new THREE.Group();
    root.position.set(ox, 0, oz);
    const roads = buildRoads(t, ox, oz, true);
    if (!roads.marks.empty()) put(roads.marks.build(), mats.paint, GROUND_LAYER, 2, root);
    buildDetail(t, ox, oz, root, rec.key);
    group.add(root);
    rec.detail = root;
  }
  function setLayer(root, layer) { root?.traverse(o => { if (o.isMesh && o.layers.mask !== (1 << GROUND_LAYER)) o.layers.set(layer); }); }

  const tileOn = (t) => {
    const x0 = t.tx * TILE, z0 = t.tz * TILE;
    return x0 < LOOP.x1 + 30 && x0 + TILE > LOOP.x0 - 30 && z0 < LOOP.z1 + 30 && z0 + TILE > LOOP.z0 - 30;
  };
  function plan(x, z) {
    const near = nyc.tilesNear(x, z, RAD.far + 60);
    const want = new Set();
    for (const { t, dist } of near) {
      if (!tileOn(t)) continue;
      want.add(t.key);
      let rec = live.get(t.key);
      if (!rec) { rec = { key: t.key, t, base: null, detail: null, dist, layer: 0 }; live.set(t.key, rec); }
      rec.dist = dist;
    }
    for (const [k, rec] of live) {
      if (!want.has(k) || rec.dist > RAD.far + 150) { disposeGroup(rec.base); disposeGroup(rec.detail); dropProps(k); live.delete(k); continue; }
      if (rec.detail && rec.dist > RAD.full + 90) { disposeGroup(rec.detail); rec.detail = null; dropProps(k); }
      const layer = rec.dist < REFL_R ? 0 : FAR_LAYER;
      if (rec.base && rec.layer !== layer) { setLayer(rec.base, layer); rec.layer = layer; }
    }
    queue.length = 0;
    for (const rec of live.values()) {
      if (!rec.base && rec.dist <= RAD.far) queue.push({ rec, kind: 'base', d: rec.dist });
      if (!rec.detail && rec.dist <= RAD.full) queue.push({ rec, kind: 'detail', d: rec.dist + 30 });
    }
    queue.sort((p, q) => p.d - q.d);
  }
  function work(budgetMs) {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < budgetMs) {
      const job = queue.shift();
      if (!live.has(job.rec.key)) continue;
      if (job.kind === 'base' && !job.rec.base) {
        buildBase(job.rec);
        job.rec.layer = 0;
        if (job.rec.dist >= REFL_R) { setLayer(job.rec.base, FAR_LAYER); job.rec.layer = FAR_LAYER; }
      } else if (job.kind === 'detail' && !job.rec.detail && job.rec.base) buildDetailRec(job.rec);
      else if (job.kind === 'detail' && !job.rec.base) queue.push(job);
    }
  }

  // ---- global layers: land, seawalls, rivers, areas, far shores, skyline -----------------------------------------------------------
  const C = nyc.coast;
  {
    const land = new Geo(), walls = new Geo();
    const white = new THREE.Color('#ffffff');
    for (let c = 0; c < C.count; c++) {
      if (!C.closed[c]) continue;
      const a = C.off[c], b = C.off[c + 1];
      const tris = triangulate(C.xs, C.zs, a, b);
      const base = land.n;
      land.grow(b - a, tris.length * 3);
      for (let p = a; p < b; p++) land.v(C.xs[p], 0, C.zs[p], 0, 1, 0, C.xs[p] / 3, C.zs[p] / 3, white);
      for (const [i0, i1, i2] of tris) {
        const ax = C.xs[a + i0], az = C.zs[a + i0];
        const cy = (C.zs[a + i1] - az) * (C.xs[a + i2] - ax) - (C.xs[a + i1] - ax) * (C.zs[a + i2] - az);
        if (cy > 0) land.t(base + i0, base + i1, base + i2); else land.t(base + i0, base + i2, base + i1);
      }
      for (let p = a; p < b; p++) {
        const q = p + 1 < b ? p + 1 : a;
        const x1 = C.xs[p], z1 = C.zs[p], x2 = C.xs[q], z2 = C.zs[q];
        const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz) || 1;
        walls.grow(4, 12);
        const n0 = walls.v(x1, -1.2, z1, dz / L, 0, -dx / L, 0, 0, white), n1 = walls.v(x2, -1.2, z2, dz / L, 0, -dx / L, 0, 0, white);
        const n2 = walls.v(x2, 0.02, z2, dz / L, 0, -dx / L, 0, 0, white), n3 = walls.v(x1, 0.02, z1, dz / L, 0, -dx / L, 0, 0, white);
        walls.t(n0, n2, n1); walls.t(n0, n3, n2); walls.t(n0, n1, n2); walls.t(n0, n2, n3);
      }
    }
    renderer.localClippingEnabled = true;
    const clips = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -LOOP.x0),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), LOOP.x1),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -LOOP.z0),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), LOOP.z1),
    ];
    for (const m of [mats.land, mats.grass, mats.pavers, mats.pool, mats.river]) m.clippingPlanes = clips;
    put(land.build(), mats.land, GROUND_LAYER, 0);
    put(walls.build(), mats.wall, 0, 0);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000).rotateX(-Math.PI / 2), mats.river);
    water.position.set(0, -0.7, 0);
    water.layers.set(GROUND_LAYER);
    water.renderOrder = -1;
    group.add(water);
  }
  {
    const grass = new Geo(), plaza = new Geo(), pool = new Geo();
    const GREEN = { [AREA.PARK]: '#1f3226', [AREA.WOOD]: '#18281e', [AREA.PITCH]: '#22382a', [AREA.CEMETERY]: '#1f2e22' };
    const pierCol = new THREE.Color('#ffffff');
    for (let i = 0; i < A.count; i++) {
      const kind = A.kind[i];
      const a = A.off[i], b = A.off[i + 1];
      const tris = triangulate(A.xs, A.zs, a, b);
      if (!tris.length) continue;
      const g = kind === AREA.WATER ? pool : kind === AREA.PLAZA || kind === AREA.PIER ? plaza : grass;
      const y = kind === AREA.WATER ? 0.03 : kind === AREA.PLAZA ? 0.016 : kind === AREA.PIER ? 0.012 : 0.012;
      const col = GREEN[kind] ? new THREE.Color(GREEN[kind]).multiplyScalar(0.85 + hash1(i) * 0.3) : pierCol;
      const base = g.n;
      g.grow(b - a, tris.length * 3);
      for (let p = a; p < b; p++) g.v(A.xs[p], y, A.zs[p], 0, 1, 0, A.xs[p] / 4.2, A.zs[p] / 4.2, col);
      for (const [i0, i1, i2] of tris) {
        const ax = A.xs[a + i0], az = A.zs[a + i0];
        const cy = (A.zs[a + i1] - az) * (A.xs[a + i2] - ax) - (A.xs[a + i1] - ax) * (A.zs[a + i2] - az);
        if (cy > 0) g.t(base + i0, base + i1, base + i2); else g.t(base + i0, base + i2, base + i1);
      }
    }
    if (!grass.empty()) put(grass.build(), mats.grass, GROUND_LAYER, 0);
    if (!plaza.empty()) put(plaza.build(), mats.pavers, GROUND_LAYER, 0);
    if (!pool.empty()) put(pool.build(), mats.pool, GROUND_LAYER, 0);
  }
  // Far shores: New Jersey, the Bronx, Brooklyn and Queens as dark land with a low procedural skyline.
  {
    const shore = new Geo(), far = new Geo(true);
    const white = new THREE.Color('#ffffff');
    const rnd = mulberry(1609);
    let mx = 0, mz = 0, mn = 0;
    for (let c = 0; c < C.count; c++) if (C.closed[c]) for (let p = C.off[c]; p < C.off[c + 1]; p += 25) { mx += C.xs[p]; mz += C.zs[p]; mn++; }
    mx /= Math.max(1, mn); mz /= Math.max(1, mn);
    const clusters = layout.FAR_CLUSTERS || [];
    for (let c = 0; c < C.count; c++) {
      if (C.closed[c]) continue;
      const a = C.off[c], b = C.off[c + 1];
      if (b - a < 2) continue;
      let sx = 0, sz = 0, cx = 0, cz = 0;
      for (let p = a; p < b - 1; p++) { const dx = C.xs[p + 1] - C.xs[p], dz = C.zs[p + 1] - C.zs[p]; sx += dz; sz += -dx; cx += C.xs[p]; cz += C.zs[p]; }
      cx /= b - a; cz /= b - a;
      const sign = (sx * (cx - mx) + sz * (cz - mz)) >= 0 ? 1 : -1;
      const W = 2600;
      let prev = null;
      for (let p = a; p < b; p++) {
        const p0 = Math.max(a, p - 1), p1 = Math.min(b - 1, p + 1);
        const dx = C.xs[p1] - C.xs[p0], dz = C.zs[p1] - C.zs[p0], L = Math.hypot(dx, dz) || 1;
        const nx = (dz / L) * sign, nz = (-dx / L) * sign;
        shore.grow(2, 6);
        const i0 = shore.v(C.xs[p], 0.01, C.zs[p], 0, 1, 0, 0, 0, white);
        const i1 = shore.v(C.xs[p] + nx * W, 0.01, C.zs[p] + nz * W, 0, 1, 0, 0, 0, white);
        if (prev) { shore.t(prev[0], prev[1], i1); shore.t(prev[0], i1, i0); shore.t(prev[0], i1, prev[1]); shore.t(prev[0], i0, i1); }
        prev = [i0, i1];
        if ((p - a) % 2 || low && (p - a) % 4) continue;
        const nb = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < nb; k++) {
          const dIn = 60 + rnd() * 900;
          const bx = C.xs[p] + nx * dIn + (rnd() - 0.5) * 60, bz = C.zs[p] + nz * dIn + (rnd() - 0.5) * 60;
          let boost = 0;
          for (const q of clusters) { const dd = Math.hypot(bx - q.x, bz - q.z); if (dd < q.r) boost = Math.max(boost, q.h * (1 - dd / q.r)); }
          const h = 10 + rnd() * 34 + boost * (0.4 + rnd() * 0.6);
          const hw = 9 + rnd() * 16, hd = 9 + rnd() * 16, yaw = Math.atan2(nz, nx) + (rnd() - 0.5) * 0.2;
          const style = h > 80 ? 0 : rnd() < 0.5 ? 2 : 1;
          const list = STYLE_COLORS[style];
          const col = list[Math.floor(rnd() * list.length)];
          const seed = rnd();
          const cs = Math.cos(yaw), sn = Math.sin(yaw);
          const cnr = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [bx + u * cs - v * sn, bz + u * sn + v * cs]);
          let u = 0;
          far.grow(20, 30);
          for (let e = 0; e < 4; e++) {
            const [x1, z1] = cnr[e], [x2, z2] = cnr[(e + 1) % 4];
            const ex = x2 - x1, ez = z2 - z1, L2 = Math.hypot(ex, ez);
            let nx2 = ez / L2, nz2 = -ex / L2;
            const mxp = (x1 + x2) / 2 - bx, mzp = (z1 + z2) / 2 - bz;
            const flip = nx2 * mxp + nz2 * mzp < 0;
            if (flip) { nx2 = -nx2; nz2 = -nz2; }
            const va = far.v(x1, 0, z1, nx2, 0, nz2, u, 0, col, style, seed, 0, FLOOR_H[style]);
            const vb = far.v(x2, 0, z2, nx2, 0, nz2, u + L2, 0, col, style, seed, 0, FLOOR_H[style]);
            const vc = far.v(x2, h, z2, nx2, 0, nz2, u + L2, h, col, style, seed, 0, FLOOR_H[style]);
            const vd = far.v(x1, h, z1, nx2, 0, nz2, u, h, col, style, seed, 0, FLOOR_H[style]);
            if (flip) { far.t(va, vb, vc); far.t(va, vc, vd); } else { far.t(va, vc, vb); far.t(va, vd, vc); }
            u += L2;
          }
          const roof = ROOF_COLORS[0];
          const r0 = far.v(cnr[0][0], h, cnr[0][1], 0, 1, 0, 0, 0, roof, style, seed, 1, 3), r1 = far.v(cnr[1][0], h, cnr[1][1], 0, 1, 0, 0, 0, roof, style, seed, 1, 3);
          const r2 = far.v(cnr[2][0], h, cnr[2][1], 0, 1, 0, 0, 0, roof, style, seed, 1, 3), r3 = far.v(cnr[3][0], h, cnr[3][1], 0, 1, 0, 0, 0, roof, style, seed, 1, 3);
          far.t(r0, r1, r2); far.t(r0, r2, r3); far.t(r0, r2, r1); far.t(r0, r3, r2);
        }
      }
    }
    if (!shore.empty()) put(shore.build(), mats.shore, FAR_LAYER, 0);
    if (!far.empty()) put(far.build(), facade, FAR_LAYER, 0);
  }
  // Skyline: every tower ≥ SKY_H stays loaded so the silhouette reads from anywhere in the city.
  {
    const g = new Geo(true);
    const beacons = [];
    for (let i = 0; i < B.count; i++) {
      if (B.h[i] < SKY_H || nyc.skipBuilding[i] || nyc.hideMesh[i]) continue;
      addBuilding(g, i, 0, 0);
      beacons.push(mtx(B.cx[i], B.h[i] + 1.5, B.cz[i], 0, 1.4));
    }
    if (!g.empty()) put(g.build(), facade, 0, 0);
    inst(beaconGeo, beaconMat, beacons, group, FAR_LAYER);
  }

  // ---- public ------------------------------------------------------------------------------------------------------------------
  let initial = true;
  function update(dt, t, cam) {
    beaconMat.color.setRGB(Math.sin(t * 2.2) > 0.25 ? 4 : 0.12, 0.03, 0.02);
    const moved = Math.hypot(cam.x - lastX, cam.z - lastZ);
    if (moved > 40 || initial) { lastX = cam.x; lastZ = cam.z; plan(cam.x, cam.z); initial = false; }
    work(queue.length > 40 ? 9 : 6);
  }
  /** Synchronously builds everything near a point (boot / teleport). */
  function warm(x, z, radius = 260) {
    lastX = x; lastZ = z;
    plan(x, z);
    const jobs = queue.splice(0);
    for (const job of jobs) {
      if (job.kind !== 'base' || job.d > radius || job.rec.base) continue;
      buildBase(job.rec);
      job.rec.layer = 0;
      if (job.rec.dist >= REFL_R) { setLayer(job.rec.base, FAR_LAYER); job.rec.layer = FAR_LAYER; }
      job.done = true;
    }
    for (const job of jobs) {
      if (job.kind !== 'detail' || job.d - 30 > radius || job.rec.detail || !job.rec.base) continue;
      buildDetailRec(job.rec);
      job.done = true;
    }
    for (const job of jobs) if (!job.done) queue.push(job);
    initial = false;
  }
  function pools(list) {
    if (!list.length) return null;
    const mat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.InstancedMesh(poolGeo, mat, list.length);
    const c = new THREE.Color();
    list.forEach((p, i) => {
      m.setMatrixAt(i, M4.compose(V.set(p.x, (p.y ?? 0) + 0.07, p.z), Q.identity(), S.set(p.r * 2, 1, p.r * 2 * (p.stretch || 1))));
      m.setColorAt(i, c.set(p.color || '#ffb36b').multiplyScalar(p.k ?? 0.5));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.layers.set(GROUND_LAYER);
    m.renderOrder = 4;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  }
  return {
    update, warm, pools, glowTex, puddleTex, collideProps,
    facade, uWin, mats,
    pending: () => queue.length,
  };
}
