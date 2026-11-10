// Builds the Manhattan city data from the cached OpenStreetMap extract (see tools/fetch-osm.mjs).
// Map data © OpenStreetMap contributors, available under the Open Database License (ODbL).
//   assets/nyc/manhattan.bin  gzip(binary) decoded by ts3d/nyc.js
//   ts3d/nycmeta.js           projection, landmarks, named street crossings
// Usage: node tools/build-nyc.mjs [cacheDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = process.argv[2] || path.join(os.tmpdir(), 'kts', 'osm');
const OUT_BIN = path.join(ROOT, 'assets', 'nyc', 'manhattan.bin');
const OUT_META = path.join(ROOT, 'ts3d', 'nycmeta.js');
const DEBUG_DIR = path.join(os.tmpdir(), 'kts');
const DEG = Math.PI / 180;

const read = (name) => JSON.parse(fs.readFileSync(path.join(CACHE, name + '.json'), 'utf8')).elements || [];

// ---- projection: local ellipsoidal tangent plane at Times Square, rotated onto the street grid ----------
const LAT0 = 40.7580, LON0 = -73.9855;
const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F);
const S0 = Math.sin(LAT0 * DEG);
const KY = (A * (1 - E2) / Math.pow(1 - E2 * S0 * S0, 1.5)) * DEG;
const KX = (A / Math.sqrt(1 - E2 * S0 * S0)) * Math.cos(LAT0 * DEG) * DEG;
const enu = (lat, lon) => [(lon - LON0) * KX, (lat - LAT0) * KY];
let TH = 29 * DEG, CT = Math.cos(TH), ST = Math.sin(TH);
// Uptown (bearing TH east of north) becomes -z, crosstown east becomes +x.
const proj = (lat, lon) => { const [e, n] = enu(lat, lon); return [e * CT - n * ST, -(e * ST + n * CT)]; };

// ---- geometry helpers -------------------------------------------------------------------------------
const key = (p) => Math.round(p[0] * 10) + ',' + Math.round(p[1] * 10);
const same = (a, b) => key(a) === key(b);
function signedArea(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}
function centroid(pts) {
  let x = 0, z = 0;
  for (const p of pts) { x += p[0]; z += p[1]; }
  return [x / pts.length, z / pts.length];
}
function inside(pt, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}
function simplify(pts, tol, fixed) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  if (fixed) pts.forEach((p, i) => { if (fixed(p)) keep[i] = 1; });
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let best = -1, bd = tol;
    for (let i = i0 + 1; i < i1; i++) {
      if (keep[i]) { best = -2; break; }
      const d = segDist(pts[i], pts[i0], pts[i1]);
      if (d > bd) { bd = d; best = i; }
    }
    if (best === -2) {
      // split at fixed points so they survive
      let prev = i0;
      for (let i = i0 + 1; i <= i1; i++) if (keep[i]) { if (i - prev > 1) stack.push([prev, i]); prev = i; }
      continue;
    }
    if (best > 0) { keep[best] = 1; stack.push([i0, best], [best, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function cleanRing(pts, tol = 0.35) {
  if (pts.length > 1 && same(pts[0], pts[pts.length - 1])) pts = pts.slice(0, -1);
  const out = [];
  for (const p of pts) if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > 0.25) out.push(p);
  if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 0.25) out.pop();
  if (out.length < 3) return null;
  // simplify as a closed ring: split at the farthest point from the first vertex
  let far = 1, fd = 0;
  for (let i = 1; i < out.length; i++) { const d = Math.hypot(out[i][0] - out[0][0], out[i][1] - out[0][1]); if (d > fd) { fd = d; far = i; } }
  const a = simplify(out.slice(0, far + 1), tol), b = simplify(out.slice(far).concat([out[0]]), tol);
  const ring = a.concat(b.slice(1, -1));
  return ring.length >= 3 ? ring : null;
}
/** Joins way chains (arrays of points) end to end into closed rings and leftover open chains. */
function assemble(chains) {
  const pool = chains.filter(c => c.length >= 2).map(c => c.slice());
  const rings = [], open = [];
  const byEnd = new Map();
  const addIdx = (i) => { for (const p of [pool[i][0], pool[i][pool[i].length - 1]]) { const k = key(p); if (!byEnd.has(k)) byEnd.set(k, new Set()); byEnd.get(k).add(i); } };
  const delIdx = (i) => { for (const p of [pool[i][0], pool[i][pool[i].length - 1]]) byEnd.get(key(p))?.delete(i); };
  pool.forEach((_, i) => addIdx(i));
  const used = new Uint8Array(pool.length);
  for (let s = 0; s < pool.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    delIdx(s);
    let cur = pool[s];
    for (let guard = 0; guard < 100000; guard++) {
      if (cur.length > 2 && same(cur[0], cur[cur.length - 1])) break;
      const tail = key(cur[cur.length - 1]);
      const cand = [...(byEnd.get(tail) || [])].find(i => !used[i]);
      if (cand == null) {
        const head = key(cur[0]);
        const c2 = [...(byEnd.get(head) || [])].find(i => !used[i]);
        if (c2 == null) break;
        used[c2] = 1; delIdx(c2);
        const c = pool[c2];
        cur = (key(c[c.length - 1]) === head ? c : c.slice().reverse()).concat(cur.slice(1));
        continue;
      }
      used[cand] = 1; delIdx(cand);
      const c = pool[cand];
      cur = cur.concat((key(c[0]) === tail ? c : c.slice().reverse()).slice(1));
    }
    (cur.length > 3 && same(cur[0], cur[cur.length - 1]) ? rings : open).push(cur);
  }
  return { rings, open };
}
const geomPts = (g) => (g || []).filter(p => p && Number.isFinite(p.lat)).map(p => proj(p.lat, p.lon));
function outerRings(el) {
  if (el.type === 'way') return [geomPts(el.geometry)];
  const outs = (el.members || []).filter(m => m.type === 'way' && (m.role === 'outer' || m.role === '') && m.geometry).map(m => geomPts(m.geometry));
  return assemble(outs).rings;
}
function parseLen(v) {
  if (v == null) return NaN;
  const s = String(v).trim().toLowerCase().replace(',', '.').split(';')[0];
  let m = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)?$/);
  if (m) return +m[1];
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet|')\s*(?:(\d+(?:\.\d+)?)\s*(?:in|")?)?$/);
  if (m) return +m[1] * 0.3048 + (m[2] ? +m[2] * 0.0254 : 0);
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}
const NAMED_COLORS = { white: '#e8e6e0', grey: '#8f9298', gray: '#8f9298', lightgrey: '#b8bbc0', darkgrey: '#55585e', black: '#26272b', red: '#8e3b2e', brown: '#6e4a36', beige: '#cdbf9f', tan: '#b49a76', yellow: '#cfb35a', cream: '#e3d9bd', orange: '#b8653a', blue: '#4d6b8f', green: '#5c7a5a', silver: '#a9adb3', maroon: '#5e2a26', pink: '#c9989b' };
function color565(v) {
  if (!v) return 0;
  let s = String(v).trim().toLowerCase();
  if (NAMED_COLORS[s]) s = NAMED_COLORS[s];
  const m = s.match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/);
  if (!m) return 0;
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return Math.max(1, ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3));
}
let hashSeed = 0;
const idHash = (n) => { let x = (n ^ 0x9e3779b9) >>> 0; x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0; return (x ^ (x >>> 16)) >>> 0; };

// ---- read OSM ---------------------------------------------------------------------------------------------
console.time('read');
const coastRaw = read('coast');
const bRaw = new Map(), misc = new Map();
for (let i = 0; ; i++) {
  if (!fs.existsSync(path.join(CACHE, `buildings-${i}.json`))) break;
  for (const el of read(`buildings-${i}`)) bRaw.set(el.type + el.id, el);
  if (fs.existsSync(path.join(CACHE, `misc-${i}.json`))) for (const el of read(`misc-${i}`)) misc.set(el.type + el.id, el);
}
const HW = /^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|pedestrian)$/;
const roadsRaw = [], areasRaw = [], poisRaw = [];
for (const el of misc.values()) {
  const t = el.tags || {};
  if (el.type === 'node') { poisRaw.push(el); continue; }
  const isArea = t.leisure || t.landuse || t.natural || t.place === 'square' || t.man_made === 'pier' || (t.highway === 'pedestrian' && (t.area === 'yes' || el.type === 'relation'));
  if (isArea) areasRaw.push(el);
  else if (el.type === 'way' && HW.test(t.highway || '')) roadsRaw.push(el);
}
console.timeEnd('read');
console.log('raw', { buildings: bRaw.size, roads: roadsRaw.length, areas: areasRaw.length, coast: coastRaw.length, pois: poisRaw.length });

// ---- grid angle from the numbered avenues ------------------------------------------------------------------------
{
  const AVE = /^((\d+)(st|nd|rd|th) Avenue|Avenue of the Americas|Park Avenue|Madison Avenue|Lexington Avenue|Amsterdam Avenue|Columbus Avenue|West End Avenue)$/i;
  let sx = 0, sy = 0;
  for (const w of roadsRaw) {
    if (!AVE.test(w.tags?.name || '')) continue;
    const g = w.geometry || [];
    for (let i = 0; i + 1 < g.length; i++) {
      const [e1, n1] = enu(g[i].lat, g[i].lon), [e2, n2] = enu(g[i + 1].lat, g[i + 1].lon);
      const de = e2 - e1, dn = n2 - n1, L = Math.hypot(de, dn);
      if (L < 8) continue;
      let b = Math.atan2(de, dn);
      const d = Math.abs(((b - TH + Math.PI / 2) % Math.PI + Math.PI) % Math.PI - Math.PI / 2);
      if (d > 12 * DEG) continue;
      sx += Math.cos(2 * b) * L; sy += Math.sin(2 * b) * L;
    }
  }
  if (sx || sy) { TH = Math.atan2(sy, sx) / 2; if (TH < 0) TH += Math.PI; if (TH > Math.PI / 2) TH -= Math.PI; }
  CT = Math.cos(TH); ST = Math.sin(TH);
  console.log('grid angle', (TH / DEG).toFixed(3));
}

// ---- coastline → land rings + mainland chains --------------------------------------------------------------------
const coast = assemble(coastRaw.filter(w => w.type === 'way').map(w => geomPts(w.geometry)));
const landRings = coast.rings.map(r => cleanRing(r, 1.2)).filter(r => r && Math.abs(signedArea(r)) > 4000);
const mainland = coast.open.map(c => simplify(c, 2.5)).filter(c => c.length >= 2);
console.log('coast', { rings: landRings.length, open: mainland.length, biggest: Math.round(Math.max(...landRings.map(r => Math.abs(signedArea(r)))) / 1e6 * 10) / 10 + ' km²' });

// Land mask (10 m cells, islands + piers) for trimming everything to Manhattan.
const pierRings = [];
for (const el of areasRaw) if (el.tags?.man_made === 'pier') for (const r of outerRings(el)) if (r.length > 3) pierRings.push(r);
const MB = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
for (const r of landRings) for (const [x, z] of r) { MB.x0 = Math.min(MB.x0, x); MB.x1 = Math.max(MB.x1, x); MB.z0 = Math.min(MB.z0, z); MB.z1 = Math.max(MB.z1, z); }
const CELL = 10, MW = Math.ceil((MB.x1 - MB.x0) / CELL) + 2, MH = Math.ceil((MB.z1 - MB.z0) / CELL) + 2;
const mask = new Uint8Array(MW * MH);
function fillMask(rings) {
  const edges = [];
  for (const r of rings) for (let i = 0; i < r.length; i++) edges.push([r[i], r[(i + 1) % r.length]]);
  for (let row = 0; row < MH; row++) {
    const z = MB.z0 + (row + 0.5) * CELL;
    const xs = [];
    for (const [a, b] of edges) if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + (z - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.floor((xs[k] - MB.x0) / CELL)), c1 = Math.min(MW - 1, Math.floor((xs[k + 1] - MB.x0) / CELL));
      for (let c = c0; c <= c1; c++) mask[row * MW + c] = 1;
    }
  }
}
const onLand = (p, pad = 0) => {
  const c = Math.floor((p[0] - MB.x0) / CELL), r = Math.floor((p[1] - MB.z0) / CELL);
  if (c < 0 || r < 0 || c >= MW || r >= MH) return false;
  if (mask[r * MW + c]) return true;
  if (!pad) return false;
  for (let dr = -pad; dr <= pad; dr++) for (let dc = -pad; dc <= pad; dc++) { const cc = c + dc, rr = r + dr; if (cc >= 0 && rr >= 0 && cc < MW && rr < MH && mask[rr * MW + cc]) return true; }
  return false;
};
fillMask(landRings);
fillMask(pierRings.filter(r => r.some(p => onLand(p, 3))));

// ---- buildings -------------------------------------------------------------------------------------------
const LANDMARK_NAMES = new Map();
const buildings = [];
for (const el of bRaw.values()) {
  const t = el.tags || {};
  const isPart = !!t['building:part'] && !t.building;
  const kind = t.building || t['building:part'] || 'yes';
  if (kind === 'no' || kind === 'roof' || t.location === 'underground' || parseFloat(t.layer) < 0 || kind === 'construction' && !t.height) continue;
  const levels = parseFloat(t['building:levels']);
  let h = parseLen(t.height);
  if (!(h > 0)) h = levels > 0 ? levels * 3.4 + 1.2 : (/house|garage|shed|kiosk|hut|toilets|service|transformer/.test(kind) ? 5 : /church|cathedral/.test(kind) ? 22 : /apartments|residential|commercial|office|hotel/.test(kind) ? 22 : 14);
  let mh = parseLen(t.min_height);
  if (!(mh >= 0)) { const ml = parseFloat(t['building:min_level']); mh = ml > 0 ? ml * 3.4 : 0; }
  if (mh >= h - 0.5) mh = 0;
  h = Math.min(h, 560);
  const shape = (t['roof:shape'] || '').toLowerCase();
  let roofKind = 0, roofH = 0;
  if (/pyramid|cone|dome|onion|hipped|spire/.test(shape)) {
    roofKind = 1;
    roofH = parseLen(t['roof:height']);
  }
  const mat = (t['building:material'] || t['building:facade:material'] || '').toLowerCase();
  const id = idHash(el.id);
  let style;
  if (/church|cathedral|chapel|synagogue|mosque|temple|shrine/.test(kind) || t.amenity === 'place_of_worship') style = 4;
  else if (/industrial|warehouse|garage|garages|parking|hangar|shed|service|transformer|storage|train_station|transportation/.test(kind)) style = 5;
  else if (mat.includes('glass') || mat.includes('metal')) style = 0;
  else if (h >= 110) style = 0;
  else if (h < 9) style = 6;
  else if (mat.includes('brick')) style = 2;
  else if (/stone|limestone|sandstone|granite|marble/.test(mat)) style = 3;
  else if (/house|residential|apartments|terrace|dormitory|detached|semidetached/.test(kind)) style = h > 55 ? 1 : (id % 3 ? 2 : 3);
  else if (/commercial|office|retail|hotel|civic|public|government|university|college|school|hospital/.test(kind)) style = h > 60 ? (id % 2 ? 0 : 1) : (id % 3 ? 3 : 2);
  else style = h > 60 ? 1 : id % 3 === 0 ? 3 : 2;
  const color = color565(t['building:colour'] || t['building:color']);
  for (const raw of outerRings(el)) {
    const ring = cleanRing(raw, 0.35);
    if (!ring) continue;
    let area = signedArea(ring);
    if (Math.abs(area) < 9) continue;
    if (area < 0) ring.reverse();
    area = Math.abs(area);
    const c = centroid(ring);
    if (!onLand(c, 1)) continue;
    let rh = roofKind ? (roofH > 0 ? roofH : Math.min(Math.sqrt(area) * 0.35, 12)) : 0;
    rh = Math.min(rh, (h - mh) * 0.9);
    buildings.push({ ring, h, mh, rh, roofKind, style, color, isPart, rel: el.type === 'relation', area, c, name: t.name || '', id: el.id });
    if (t.name) {
      const prev = LANDMARK_NAMES.get(t.name);
      if (!prev || prev.h < h) LANDMARK_NAMES.set(t.name, { x: c[0], z: c[1], h, area });
    }
  }
}
// Outlines whose interior is described by building:part pieces are dropped (Simple 3D Buildings).
{
  const G = 60, grid = new Map();
  buildings.forEach((b, i) => { const k = Math.floor(b.c[0] / G) + ',' + Math.floor(b.c[1] / G); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  const drop = new Uint8Array(buildings.length);
  buildings.forEach((b, i) => {
    if (b.isPart) return;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of b.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    let covered = 0, parts = 0;
    for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++) for (let gz = Math.floor(z0 / G); gz <= Math.floor(z1 / G); gz++) {
      for (const j of grid.get(gx + ',' + gz) || []) {
        if (j === i) continue;
        const o = buildings[j];
        if (!o.isPart && !b.rel) continue;
        if (o.area >= b.area * 0.98) continue;
        if (inside(o.c, b.ring)) { covered += o.area; parts++; }
      }
    }
    if (parts && covered >= b.area * 0.4) drop[i] = 1;
  });
  let n = 0;
  for (let i = buildings.length - 1; i >= 0; i--) if (drop[i]) { buildings.splice(i, 1); n++; }
  console.log('buildings', buildings.length, 'dropped outlines', n);
}

// ---- roads -------------------------------------------------------------------------------------------------
const CLS = { motorway: 0, trunk: 0, primary: 1, secondary: 2, tertiary: 3, unclassified: 4, residential: 4, living_street: 4, service: 5, pedestrian: 6, motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 7, tertiary_link: 7 };
const names = [''];
const nameIdx = new Map([['', 0]]);
const nameId = (s) => { s = (s || '').trim(); if (!nameIdx.has(s)) { nameIdx.set(s, names.length); names.push(s); } return nameIdx.get(s); };
const roadsIn = [];
const useCount = new Map();
for (const w of roadsRaw) {
  const t = w.tags || {};
  const cls = CLS[t.highway];
  if (cls == null) continue;
  if (t.tunnel && t.tunnel !== 'no') continue;
  if (t.covered === 'yes' || t.area === 'yes') continue;
  if (cls === 5 && /parking_aisle|driveway|drive-through/.test(t.service || '')) continue;
  if (t.access === 'no' && cls >= 5) continue;
  let pts = geomPts(w.geometry);
  if (pts.length < 2) continue;
  let oneway = 0;
  const ow = (t.oneway || '').toLowerCase();
  if (ow === 'yes' || ow === '1' || ow === 'true' || t.junction === 'roundabout' || (cls === 0 && ow !== 'no')) oneway = 1;
  if (ow === '-1' || ow === 'reverse') { oneway = 1; pts = pts.reverse(); }
  if (cls === 6) oneway = 0;
  let lanes = parseInt(t.lanes, 10);
  if (!(lanes > 0)) lanes = cls === 0 ? (oneway ? 3 : 4) : cls === 1 ? 4 : cls === 2 ? 3 : cls === 3 ? 2 : cls === 4 ? (oneway ? 1 : 2) : cls === 7 ? 1 : 1;
  lanes = Math.min(lanes, 8);
  let width = parseLen(t.width);
  if (!(width > 2 && width < 60)) width = cls === 6 ? 7 : cls === 5 ? 4.6 : lanes * 3.3 + (cls >= 1 && cls <= 4 ? (oneway && lanes <= 2 ? 5 : 4) : 1.6);
  const flags = (t.bridge && t.bridge !== 'no' ? 1 : 0) | (parseFloat(t.layer) > 0 ? 2 : 0);
  roadsIn.push({ pts, cls, lanes, oneway, flags, width, name: nameId(t.name || t.ref || ''), raw: t.name || '' });
  for (const p of pts) { const k = key(p); useCount.set(k, (useCount.get(k) || 0) + 1); }
}
const roads = [];
for (const r of roadsIn) {
  // split where the way leaves the islands (bridges, ramps over the rivers)
  let cur = [];
  const flush = () => { if (cur.length >= 2) roads.push({ ...r, pts: cur }); cur = []; };
  for (const p of r.pts) { if (onLand(p, 1)) cur.push(p); else flush(); }
  flush();
}
for (const r of roads) r.pts = simplify(r.pts, 0.45, (p) => (useCount.get(key(p)) || 0) > 1);
console.log('roads', roads.length, 'names', names.length);

// ---- areas ---------------------------------------------------------------------------------------------------
const areas = [];
for (const el of areasRaw) {
  const t = el.tags || {};
  let kind = 0;
  if (t.natural === 'water') kind = 2;
  else if (t.highway === 'pedestrian' || t.place === 'square') kind = 3;
  else if (t.natural === 'wood' || t.landuse === 'forest') kind = 4;
  else if (t.man_made === 'pier') kind = 5;
  else if (t.leisure === 'pitch' || t.leisure === 'playground') kind = 6;
  else if (t.landuse === 'cemetery') kind = 7;
  else kind = 1;
  for (const raw of outerRings(el)) {
    const ring = cleanRing(raw, 0.6);
    if (!ring) continue;
    const a = signedArea(ring);
    if (Math.abs(a) < 30) continue;
    if (!onLand(centroid(ring), 2) && !ring.some(p => onLand(p))) continue;
    if (a < 0) ring.reverse();
    areas.push({ kind, ring, name: t.name || '', area: Math.abs(a) });
    if (t.name && (kind === 1 || kind === 3)) {
      const prev = LANDMARK_NAMES.get(t.name);
      const c = centroid(ring);
      if (!prev || prev.area < Math.abs(a)) LANDMARK_NAMES.set(t.name, { x: c[0], z: c[1], h: 0, area: Math.abs(a) });
    }
  }
}
areas.sort((p, q) => q.area - p.area);
console.log('areas', areas.length);

// ---- points: subway entrances, traffic signals ----------------------------------------------------------------
const signals = [], entrances = [];
for (const n of poisRaw) {
  if (n.type !== 'node') continue;
  const p = proj(n.lat, n.lon);
  if (!onLand(p, 1)) continue;
  if (n.tags?.highway === 'traffic_signals') signals.push(p);
  else if (n.tags?.railway === 'subway_entrance') entrances.push(p);
  else if (n.tags?.name && !LANDMARK_NAMES.has(n.tags.name)) LANDMARK_NAMES.set(n.tags.name, { x: p[0], z: p[1], h: 0, area: 0 });
}

// ---- named crossings (for hand-placed game features) -------------------------------------------------------------
const byVertex = new Map();
for (const r of roads) {
  if (!r.raw) continue;
  for (const p of r.pts) { const k = key(p); if (!byVertex.has(k)) byVertex.set(k, { p, names: new Set() }); byVertex.get(k).names.add(r.raw); }
}
const crossings = {};
for (const { p, names: ns } of byVertex.values()) {
  if (ns.size < 2 || Math.hypot(p[0], p[1]) > 4000) continue;
  const list = [...ns].sort();
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const k = list[i] + ' & ' + list[j];
    (crossings[k] ||= []).push([+p[0].toFixed(1), +p[1].toFixed(1)]);
  }
}

// ---- encode ----------------------------------------------------------------------------------------------------
class Out {
  constructor() { this.buf = Buffer.alloc(1 << 22); this.o = 0; }
  need(n) { if (this.o + n > this.buf.length) { const b = Buffer.alloc(Math.max(this.buf.length * 2, this.o + n)); this.buf.copy(b, 0, 0, this.o); this.buf = b; } }
  u8(v) { this.need(1); this.buf.writeUInt8(v, this.o); this.o += 1; }
  i8(v) { this.need(1); this.buf.writeInt8(v, this.o); this.o += 1; }
  u16(v) { this.need(2); this.buf.writeUInt16LE(v, this.o); this.o += 2; }
  i16(v) { this.need(2); this.buf.writeInt16LE(v, this.o); this.o += 2; }
  u32(v) { this.need(4); this.buf.writeUInt32LE(v, this.o); this.o += 4; }
  i32(v) { this.need(4); this.buf.writeInt32LE(v, this.o); this.o += 4; }
  f64(v) { this.need(8); this.buf.writeDoubleLE(v, this.o); this.o += 8; }
  str(s) { const b = Buffer.from(s, 'utf8'); this.u16(b.length); this.need(b.length); b.copy(this.buf, this.o); this.o += b.length; }
  done() { return this.buf.subarray(0, this.o); }
}
/** Points as decimeter int32 start + int16 deltas; long edges are split so deltas fit. */
function densify(pts, closed) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    out.push(a);
    const b = i + 1 < n ? pts[i + 1] : closed ? pts[0] : null;
    if (!b) continue;
    const steps = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / 3000);
    for (let s = 1; s < steps; s++) out.push([a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps]);
  }
  return out;
}
function writePts(o, pts) {
  let px = Math.round(pts[0][0] * 10), pz = Math.round(pts[0][1] * 10);
  o.i32(px); o.i32(pz);
  for (let i = 1; i < pts.length; i++) {
    const x = Math.round(pts[i][0] * 10), z = Math.round(pts[i][1] * 10);
    o.i16(x - px); o.i16(z - pz);
    px = x; pz = z;
  }
}
const dm = (v) => Math.max(0, Math.min(65535, Math.round(v * 10)));
const out = new Out();
out.buf.write('KTS1', 0, 'ascii'); out.o = 4;
out.u32(1);
out.f64(LAT0); out.f64(LON0); out.f64(TH);
out.i32(Math.round(MB.x0 * 10)); out.i32(Math.round(MB.z0 * 10)); out.i32(Math.round(MB.x1 * 10)); out.i32(Math.round(MB.z1 * 10));
out.u32(names.length);
for (const s of names) out.str(s);
// buildings sorted by tile so the client can slice quickly
buildings.sort((a, b) => (Math.floor(a.c[1] / 200) - Math.floor(b.c[1] / 200)) || (Math.floor(a.c[0] / 200) - Math.floor(b.c[0] / 200)));
out.u32(buildings.length);
for (const b of buildings) {
  const pts = densify(b.ring, true);
  out.u16(pts.length); out.u16(dm(b.h)); out.u16(dm(b.mh)); out.u16(dm(b.rh));
  out.u8((b.roofKind ? 1 : 0) | (b.isPart ? 2 : 0)); out.u8(b.style); out.u16(b.color);
  writePts(out, pts);
}
out.u32(roads.length);
for (const r of roads) {
  const pts = densify(r.pts, false);
  out.u16(pts.length); out.u8(r.cls); out.u8(r.lanes); out.i8(r.oneway); out.u8(r.flags);
  out.u8(Math.min(255, Math.round(r.width * 4))); out.u16(r.name);
  writePts(out, pts);
}
out.u32(areas.length);
for (const a of areas) {
  const pts = densify(a.ring, true);
  out.u8(a.kind); out.u32(pts.length);
  writePts(out, pts);
}
const coastOut = [...landRings.map(r => ({ closed: 1, pts: r })), ...mainland.map(c => ({ closed: 0, pts: c }))];
out.u32(coastOut.length);
for (const c of coastOut) {
  const pts = densify(c.pts, !!c.closed);
  out.u8(c.closed); out.u32(pts.length);
  writePts(out, pts);
}
out.u32(signals.length);
for (const p of signals) { out.i32(Math.round(p[0] * 10)); out.i32(Math.round(p[1] * 10)); }
out.u32(entrances.length);
for (const p of entrances) { out.i32(Math.round(p[0] * 10)); out.i32(Math.round(p[1] * 10)); }
const raw = out.done();
const gz = zlib.gzipSync(raw, { level: 9 });
fs.mkdirSync(path.dirname(OUT_BIN), { recursive: true });
fs.writeFileSync(OUT_BIN, gz);
console.log('bin', (raw.length / 1e6).toFixed(2) + 'MB raw', (gz.length / 1e6).toFixed(2) + 'MB gz');

// ---- meta module ------------------------------------------------------------------------------------------------
const LANDMARKS = [
  ['timessq', '타임스퀘어', 'Times Square', ['Times Square', 'Duffy Square', 'Father Duffy Square'], [40.7580, -73.9855]],
  ['esb', '엠파이어 스테이트 빌딩', 'Empire State Building', ['Empire State Building'], [40.7484, -73.9857]],
  ['chrysler', '크라이슬러 빌딩', 'Chrysler Building', ['Chrysler Building'], [40.7516, -73.9755]],
  ['rock', '록펠러 센터', 'Rockefeller Center', ['30 Rockefeller Plaza', 'Comcast Building', 'Rockefeller Center'], [40.7587, -73.9787]],
  ['gct', '그랜드 센트럴 터미널', 'Grand Central Terminal', ['Grand Central Terminal'], [40.7527, -73.9772]],
  ['bryant', '브라이언트 파크', 'Bryant Park', ['Bryant Park'], [40.7536, -73.9832]],
  ['cpark', '센트럴 파크', 'Central Park', ['Central Park'], [40.7812, -73.9665]],
  ['columbus', '콜럼버스 서클', 'Columbus Circle', ['Columbus Circle'], [40.7681, -73.9819]],
  ['msg', '매디슨 스퀘어 가든', 'Madison Square Garden', ['Madison Square Garden'], [40.7505, -73.9934]],
  ['ktown', 'K-타운', 'Koreatown', [], [40.7477, -73.9867]],
  ['flatiron', '플랫아이언 빌딩', 'Flatiron Building', ['Flatiron Building'], [40.7411, -73.9897]],
  ['vessel', '허드슨 야드', 'Hudson Yards', ['Vessel', 'The Vessel'], [40.7538, -74.0022]],
  ['un', '유엔 본부', 'United Nations', ['United Nations Secretariat Building', 'United Nations Headquarters'], [40.7489, -73.9680]],
  ['met', '메트로폴리탄 미술관', 'The Met', ['The Metropolitan Museum of Art', 'Metropolitan Museum of Art'], [40.7794, -73.9632]],
  ['washsq', '워싱턴 스퀘어 파크', 'Washington Square Park', ['Washington Square Park'], [40.7308, -73.9973]],
  ['soho', '소호', 'SoHo', [], [40.7233, -74.0030]],
  ['chinatown', '차이나타운', 'Chinatown', [], [40.7158, -73.9970]],
  ['owtc', '원 월드 트레이드 센터', 'One World Trade Center', ['One World Trade Center', '1 World Trade Center'], [40.7127, -74.0134]],
  ['wallst', '월스트리트', 'Wall Street', ['New York Stock Exchange'], [40.7069, -74.0113]],
  ['bklyn', '브루클린 브리지', 'Brooklyn Bridge', [], [40.7090, -74.0010]],
  ['harlem', '할렘', 'Harlem', [], [40.8116, -73.9465]],
].map(([id, ko, en, keys, ll]) => {
  let hit = null;
  for (const k of keys) { const v = LANDMARK_NAMES.get(k); if (v && (!hit || v.h > hit.h || v.area > hit.area)) hit = v; }
  const p = hit ? [hit.x, hit.z] : proj(ll[0], ll[1]);
  return { id, ko, en, x: +p[0].toFixed(1), z: +p[1].toFixed(1), h: hit ? Math.round(hit.h) : 0 };
});
const near = (lim) => Object.fromEntries(Object.entries(crossings).filter(([, v]) => Math.hypot(v[0][0], v[0][1]) < lim).map(([k, v]) => [k, v[0]]));
const meta = {
  lat0: LAT0, lon0: LON0, theta: +TH.toFixed(8),
  bounds: { x0: Math.round(MB.x0), z0: Math.round(MB.z0), x1: Math.round(MB.x1), z1: Math.round(MB.z1) },
  bytes: gz.length,
  counts: { buildings: buildings.length, roads: roads.length, areas: areas.length, coast: coastOut.length, signals: signals.length, entrances: entrances.length },
};
const metaSrc = `// Generated by tools/build-nyc.mjs from OpenStreetMap data (© OpenStreetMap contributors, ODbL). Do not edit by hand.
export const NYC_META = ${JSON.stringify(meta)};
export const LANDMARKS = ${JSON.stringify(LANDMARKS)};
export const CROSSINGS = ${JSON.stringify(near(2600))};
`;
fs.writeFileSync(OUT_META, metaSrc);
console.log('meta', OUT_META, (metaSrc.length / 1024).toFixed(1) + 'KB');

// ---- debug SVG of the Times Square / Bryant Park / Koreatown area --------------------------------------------------------
function svgArea(name, cx, cz, half, grid = 0) {
  const inView = (pts) => pts.some(([x, z]) => Math.abs(x - cx) < half && Math.abs(z - cz) < half);
  const P = (pts) => pts.map(([x, z]) => `${(x - cx + half).toFixed(1)},${(z - cz + half).toFixed(1)}`).join(' ');
  const s = [`<svg xmlns="http://www.w3.org/2000/svg" width="${half * 2}" height="${half * 2}" viewBox="0 0 ${half * 2} ${half * 2}" style="background:#1b1d26;font-family:sans-serif">`];
  const AC = { 1: '#2f5a35', 2: '#1f3a66', 3: '#5a4a6e', 4: '#24452a', 5: '#555', 6: '#3d6b46', 7: '#3a4a3a' };
  for (const a of areas) if (inView(a.ring)) s.push(`<polygon points="${P(a.ring)}" fill="${AC[a.kind]}" opacity="0.8"/>`);
  for (const r of roads) if (inView(r.pts)) s.push(`<polyline points="${P(r.pts)}" fill="none" stroke="${r.cls === 6 ? '#8a6fb0' : '#4b4f5c'}" stroke-width="${r.width}" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>`);
  for (const b of buildings) if (inView(b.ring)) s.push(`<polygon points="${P(b.ring)}" fill="hsl(${200 + b.style * 20},15%,${Math.min(75, 30 + b.h / 4)}%)" stroke="#000" stroke-width="0.3"/>`);
  for (const b of buildings) if (b.name && inView(b.ring) && b.area > 300) s.push(`<text x="${(b.c[0] - cx + half).toFixed(0)}" y="${(b.c[1] - cz + half).toFixed(0)}" font-size="7" fill="#ffd" text-anchor="middle">${b.name.replace(/&/g, '&amp;').replace(/</g, '')} ${Math.round(b.h)}m</text>`);
  for (const r of roads) if (r.raw && inView(r.pts) && r.cls <= 4) { const m = r.pts[(r.pts.length / 2) | 0]; s.push(`<text x="${(m[0] - cx + half).toFixed(0)}" y="${(m[1] - cz + half).toFixed(0)}" font-size="6" fill="#9cf">${r.raw.replace(/&/g, '&amp;')}</text>`); }
  for (const p of signals) if (Math.abs(p[0] - cx) < half && Math.abs(p[1] - cz) < half) s.push(`<circle cx="${(p[0] - cx + half).toFixed(1)}" cy="${(p[1] - cz + half).toFixed(1)}" r="1.6" fill="#f44"/>`);
  for (let g = -half; g <= half; g += 50) s.push(`<text x="2" y="${(g + half).toFixed(0)}" font-size="7" fill="#777">z${Math.round(cz + g)}</text><text x="${(g + half).toFixed(0)}" y="9" font-size="7" fill="#777">x${Math.round(cx + g)}</text>`);
  if (grid) {
    for (let v = Math.ceil((cx - half) / grid) * grid; v <= cx + half; v += grid) s.push(`<line x1="${v - cx + half}" y1="0" x2="${v - cx + half}" y2="${half * 2}" stroke="${v % 50 ? '#ffffff14' : '#ffffff40'}" stroke-width="0.4"/>${v % 50 ? '' : `<text x="${v - cx + half + 1}" y="${half * 2 - 3}" font-size="5" fill="#bbb">${v}</text>`}`);
    for (let v = Math.ceil((cz - half) / grid) * grid; v <= cz + half; v += grid) s.push(`<line x1="0" y1="${v - cz + half}" x2="${half * 2}" y2="${v - cz + half}" stroke="${v % 50 ? '#ffffff14' : '#ffffff40'}" stroke-width="0.4"/>${v % 50 ? '' : `<text x="${half * 2 - 18}" y="${v - cz + half - 1}" font-size="5" fill="#bbb">${v}</text>`}`);
    for (const a of areas) if (a.kind === 3 && inView(a.ring)) s.push(`<polygon points="${P(a.ring)}" fill="none" stroke="#c9f" stroke-width="0.5"/>`);
  }
  s.push('</svg>');
  fs.writeFileSync(path.join(DEBUG_DIR, `nyc-${name}.svg`), s.join('\n'));
}
svgArea('timessq', 0, 0, 420);
svgArea('bowtie', 0, 50, 160, 10);
svgArea('bryant', 380, 330, 130, 10);
const kt = LANDMARKS.find(l => l.id === 'ktown');
svgArea('ktown', kt.x, kt.z, 300);
console.log('debug svg written to', DEBUG_DIR);
