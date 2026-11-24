// Traffic on the real road graph: yellow cabs and cars that keep their lane, stop at the signalized
// intersections (synchronized avenue/street cycle) and keep their distance, spawned around the player.
// Also the player's taxi, taxis called to stands, parked taxis and remote players' taxis.
//
// The rules of the street (test/street-traffic.test.mjs drives them for simulated minutes and reads the result back
// from the instance matrices, so what it checks is what is drawn):
// - a car is on one lane line of one stretch of road, facing along it; corners are arcs between two lane lines;
// - no lane runs through what the game built on the map: the lots' pedestrian street (layout.js NO_ROAD, which holds
//   the lots and the stage) and the red steps; no signal pole and no called cab stands in the way in to that street;
// - a queue keeps RULES.gap between bumpers and stops short of the painted stop line;
// - no step is taken that would bring two cars closer than a hand's width (the hard rule in drive());
// - one direction at a time owns a junction (opposite directions share it when neither turns left);
// - a car that cannot move is not left in the street: it goes around what blocks it if there is room, and after
//   RULES.stuckS it fades out and comes back somewhere else.
import * as THREE from 'three';
import { Kit } from './kit.js?v=202611241127';
import { makeCanvas, paintTaxiSign, paintTaxiDecal } from './art.js?v=202611241127';

// Headlight pool on the road: a wide soft fan (art.js paintBeam is now a narrow core meant for guide beams).
function paintHeadlight(canvas) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const gx = g.createLinearGradient(0, 0, W, 0);
  gx.addColorStop(0, 'rgba(255,255,255,0)');
  gx.addColorStop(0.5, 'rgba(255,255,255,1)');
  gx.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gx;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'destination-in';
  const gy = g.createLinearGradient(0, 0, 0, H);
  gy.addColorStop(0, 'rgba(0,0,0,0)');
  gy.addColorStop(0.7, 'rgba(0,0,0,0.6)');
  gy.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = gy;
  g.fillRect(0, 0, W, H);
  return canvas;
}
import { GROUND_LAYER } from './ground.js?v=202611241127';
import { ROAD } from './nyc.js?v=202611241127';
import { LAYOUT, NO_ROAD } from './layout.js?v=202611241127';

export function signalPhase(t) {
  const c = t % 36;
  if (c < 14) return 'nsG';
  if (c < 17) return 'nsY';
  if (c < 19) return 'red';
  if (c < 31) return 'ewG';
  if (c < 34) return 'ewY';
  return 'red';
}

// Metres and seconds. A car is 4.82 m bumper to bumper and 1.98 m over the wheels (vehicleKits below).
const CAR_HL = 2.41, CAR_HW = 0.99;
export const RULES = {
  len: CAR_HL * 2, wid: CAR_HW * 2,
  gap: 1.8, // between bumpers in a queue
  gapParked: 6.5, // behind a stopped car that is not traffic (a parked or waiting cab): room to pull out around it
  gapWalker: 4.5, // nose to someone standing in the lane
  stopBack: 7.7, // car centre before a junction's edge: the nose stops 0.4 m short of the stop line world.js paints
  turnV: 4.5, // speed through a corner
  stuckS: 12, // blocked this long by something that is not traffic: off the street
  idleS: 80, // not moved for this long, whatever the reason (two signal cycles and more): off the street
  fadeS: 0.35, // a car comes and goes by growing / shrinking for this long
};
const SAFE_L = 0.3, SAFE_W = 0.1; // the hard rule: never closer than 0.6 m nose to tail, 0.2 m side to side
const SIDE = 0.45; // a car is "in my lane" when it comes within this of my side (lanes are 0.9 m and more apart)
const PASS = 0.7; // side room given to what a car goes around
const LOOK = 26; // how far ahead a car looks
const SLEW = 0.6; // metres sideways per metre forward at walking pace (pulling out); a quarter of that at speed
const CORNER = 4.5; // a corner starts and ends this far from the corner point
const KERB = 0.75; // a cab called to a stand sits this far inside the road edge (0.3 m clear of the outside lane)

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const CAR_COLORS = ['#101114', '#e9eaec', '#8e9399', '#2b2f36', '#1c2b4a', '#6b1b1f', '#c2c5ca', '#3a3f45', '#0f2a24', '#5a5e63'].map(c => new THREE.Color(c));
const VMAX = { [ROAD.MOTORWAY]: 21, [ROAD.PRIMARY]: 12.5, [ROAD.SECONDARY]: 12, [ROAD.TERTIARY]: 10.5, [ROAD.STREET]: 8.5, [ROAD.SERVICE]: 4.5, [ROAD.LINK]: 11 };
const wrap = (a) => ((((a % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI);

// What the game built where the map has a car road (x0, x1, z0, z1): the lots' pedestrian street, where world.js draws
// no roadway (it holds the lots and the stage; on the map it is 7th Avenue, with West 41st Street across it), and the
// red steps. A road whose roadway touches one of these is closed to traffic.
function builtZones() {
  const S = LAYOUT.stairs;
  return [NO_ROAD, { x0: S.x0 - 0.4, x1: S.x1 + 0.4, z0: S.back, z1: S.front + 0.2 }];
}
// The way in to the lots' street: the ground between the entrance arch's posts, from the far side of the crossing in
// front of it to the arch. With NO_ROAD itself this is kept clear of signal poles and of cabs called to the stand.
export function streetMouth() {
  const S = LAYOUT.street, half = S.arch.post + S.arch.r;
  return { x0: S.x - half, x1: S.x + half, z0: S.arch.z - 10, z1: S.arch.z };
}

/** Do two car-shaped boxes on the ground overlap? Centre, heading (unit), half length, half width of each. */
function boxesTouch(ax, az, afx, afz, al, aw, bx, bz, bfx, bfz, bl, bw) {
  const dx = bx - ax, dz = bz - az;
  const c = Math.abs(afx * bfx + afz * bfz), s = Math.abs(afx * bfz - afz * bfx);
  if (Math.abs(dx * afx + dz * afz) > al + bl * c + bw * s) return false;
  if (Math.abs(dz * afx - dx * afz) > aw + bl * s + bw * c) return false;
  if (Math.abs(dx * bfx + dz * bfz) > bl + al * c + aw * s) return false;
  if (Math.abs(dz * bfx - dx * bfz) > bw + al * s + aw * c) return false;
  return true;
}

function vehicleKits() {
  const body = new THREE.Shape();
  body.moveTo(-2.3, 0.32);
  body.lineTo(-2.33, 0.84);
  body.quadraticCurveTo(-2.25, 1.0, -1.92, 1.02);
  body.lineTo(1.18, 1.02);
  body.quadraticCurveTo(1.95, 0.98, 2.24, 0.84);
  body.quadraticCurveTo(2.36, 0.7, 2.32, 0.42);
  body.lineTo(2.26, 0.32);
  body.lineTo(-2.3, 0.32);
  const bodyGeo = () => {
    const g = new THREE.ExtrudeGeometry(body, { depth: 1.76, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: 8 });
    g.rotateY(-Math.PI / 2);
    g.translate(0.88, 0, 0);
    return g;
  };
  const cabin = new THREE.Shape();
  cabin.moveTo(-1.62, 1.0);
  cabin.lineTo(-1.08, 1.43);
  cabin.lineTo(0.42, 1.45);
  cabin.lineTo(1.14, 1.0);
  cabin.lineTo(-1.62, 1.0);
  const cabGeo = () => {
    const g = new THREE.ExtrudeGeometry(cabin, { depth: 1.56, bevelEnabled: false });
    g.rotateY(-Math.PI / 2);
    g.translate(0.78, 0, 0);
    return g;
  };
  const make = (taxi) => {
    const kit = new Kit();
    kit.add(bodyGeo(), '#ffffff', { mat: 'paint' });
    kit.add(cabGeo(), '#0b1220', { mat: 'gloss' });
    if (taxi) kit.box(1.5, 0.06, 1.5, '#ffffff', { y: 1.47, z: -0.33, mat: 'paint' });
    kit.box(1.9, 0.2, 0.14, '#16171b', { y: 0.46, z: 2.34, mat: 'metal' });
    kit.box(1.9, 0.2, 0.14, '#16171b', { y: 0.46, z: -2.34, mat: 'metal' });
    kit.box(1.7, 0.1, 4.3, '#101114', { y: 0.27, mat: 'metal' });
    for (const s of [-1, 1]) {
      kit.box(0.34, 0.12, 0.06, '#ffffff', { x: s * 0.62, y: 0.8, z: 2.36, glow: 5 });
      kit.box(0.3, 0.15, 0.06, '#ff1010', { x: s * 0.64, y: 0.84, z: -2.36, glow: 3 });
    }
    return kit.geometries();
  };
  const wheelKit = new Kit();
  wheelKit.cyl(0.34, 0.34, 0.26, '#0b0b0d', { rz: Math.PI / 2, seg: 16, mat: 'metal' });
  wheelKit.cyl(0.2, 0.2, 0.27, '#9aa0a8', { rz: Math.PI / 2, seg: 12, mat: 'metal' });
  return { taxi: make(true), car: make(false), wheel: wheelKit.geometries().get('metal') };
}

// The roof light: one box. Its front and back carry the lettering; the top, bottom and ends show one blank corner
// texel of the same texture (a box with plain UVs repeats the whole sign on all six faces, the top one facing the
// camera, and the old lettering planes sat 1 cm in front of a second copy of themselves).
function taxiSignGeometry() {
  const g = new THREE.BoxGeometry(1.0, 0.25, 0.2).toNonIndexed();
  const uv = g.attributes.uv;
  for (let i = 0; i < 24; i++) uv.setXY(i, 0.012, 0.95); // +x, -x, +y, -y faces
  g.deleteAttribute('normal');
  g.translate(0, 1.66, -0.3);
  return g;
}

// The stripe and lettering on both doors, 2 cm off the side panel (which is at x = ±0.93). The plane is above the
// wheels' tops for the stripe (y 0.69..0.90) and the lettering (y 0.48..0.69) is painted between the axles: the wheels
// stand 6 cm proud of the body, so anything painted over them is cut by the tyre.
function taxiDecalGeometry() {
  const g = new THREE.BufferGeometry();
  const pos = [], uv = [], idx = [];
  for (const s of [1, -1]) {
    const o = pos.length / 3, x = s * 0.95;
    // u runs from the plane's left edge as seen from outside: front to back on the right side, back to front on the left
    pos.push(x, 0.48, s * 1.7, x, 0.48, -s * 1.7, x, 0.90, -s * 1.7, x, 0.90, s * 1.7);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * What each tier pays for the two taxi textures (sign 256 x 64 on every tier; mipmaps and trilinear filtering always):
 * low (phones): the door decal at 512 x 64 (0.17 MB with mipmaps), anisotropy 2;
 * medium: 1024 x 128 (0.68 MB), anisotropy 4; high: 1024 x 128, anisotropy 8. All capped by what the GPU offers.
 */
export function taxiTextureTier(quality, maxAnisotropy = 1) {
  const low = quality === 'low';
  return { decalW: low ? 512 : 1024, decalH: low ? 64 : 128, signW: 256, signH: 64, anisotropy: Math.max(1, Math.min(low ? 2 : quality === 'medium' ? 4 : 8, maxAnisotropy)) };
}

export function createTraffic({ scene, nyc, kitMats, quality, renderer, onHonk }) {
  const low = quality === 'low';
  const N_TAXI = quality === 'high' ? 34 : quality === 'medium' ? 24 : 14;
  const N_CAR = quality === 'high' ? 34 : quality === 'medium' ? 22 : 12;
  const N_SPECIAL = 8, N_REMOTE = 8;
  const N_AI = N_TAXI + N_CAR;
  const SPAWN_R = low ? 260 : 380, DROP_R = SPAWN_R + 90;
  const R = nyc.roads, G = nyc.graph;
  const tier = taxiTextureTier(quality, renderer.capabilities.getMaxAnisotropy());

  const junctionR = new Float32Array(G.nodeX.length);
  for (let nd = 0; nd < G.nodeX.length; nd++) {
    let w = 0;
    for (const e of G.nodeAdj[nd]) w = Math.max(w, R.width[e.road]);
    junctionR[nd] = G.nodeAdj[nd].length >= 3 ? w / 2 : 0;
  }
  const carRoad = (r) => R.cls[r] !== ROAD.PEDESTRIAN && R.cls[r] !== ROAD.SERVICE;

  // ---- lanes ---------------------------------------------------------------------------------------------
  // A lane stretch is one road segment in one direction: seg * 2 + (1 along the polyline, 0 against it).
  const dkey = (seg, dir) => seg * 2 + (dir > 0 ? 1 : 0);
  const lanesOf = (r) => { const n = Math.max(1, R.lanes[r]); return R.oneway[r] ? n : Math.max(1, n >> 1); };
  /** Metres to the right of the centre line for lane k (0 = leftmost of this direction). */
  function laneOffset(r, k) {
    const usable = Math.max(2.6, R.width[r] - 2.4), n = lanesOf(r);
    return R.oneway[r] ? -usable / 2 + (k + 0.5) * usable / n : (k + 0.5) * (usable / 2) / n;
  }
  function nearestLane(r, off) {
    let best = 0, bd = Infinity;
    for (let k = lanesOf(r) - 1; k >= 0; k--) { const d = Math.abs(laneOffset(r, k) - off); if (d < bd) { bd = d; best = k; } }
    return best;
  }
  const segLen = (p) => Math.hypot(R.xs[p + 1] - R.xs[p], R.zs[p + 1] - R.zs[p]);

  // Streets the game has built on. On the map the lots' pedestrian street is 7th Avenue from W 42nd to W 40th St, and
  // West 41st Street crosses it: every segment whose roadway reaches into NO_ROAD is closed (the whole segment, from
  // the junction before it: cars turn off at W 42nd St and at Broadway), and so is any stretch that can only be reached
  // through a closed one or only leads into one.
  const shut = new Uint8Array(R.xs.length * 2);
  {
    const zones = builtZones(), todo = [];
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const q of zones) { bx0 = Math.min(bx0, q.x0); bx1 = Math.max(bx1, q.x1); bz0 = Math.min(bz0, q.z0); bz1 = Math.max(bz1, q.z1); }
    for (let p = 0; p < R.xs.length - 1; p++) {
      const r = R.segRoad[p];
      if (r < 0 || !carRoad(r)) continue;
      const ax = R.xs[p], az = R.zs[p], bx = R.xs[p + 1], bz = R.zs[p + 1];
      const reach = R.width[r] / 2; // the roadway: a car going around something may use all of it
      if (Math.max(ax, bx) < bx0 - reach || Math.min(ax, bx) > bx1 + reach || Math.max(az, bz) < bz0 - reach || Math.min(az, bz) > bz1 + reach) continue;
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5));
      let hit = false;
      for (let i = 0; i <= n && !hit; i++) {
        const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n;
        for (const q of zones) {
          const ex = Math.max(q.x0 - x, 0, x - q.x1), ez = Math.max(q.z0 - z, 0, z - q.z1);
          if (ex * ex + ez * ez < reach * reach) { hit = true; break; }
        }
      }
      if (!hit) continue;
      for (const dir of [1, -1]) { shut[dkey(p, dir)] = 1; todo.push(dkey(p, dir)); }
    }
    const nodeOf = (p) => G.nodeAt(R.xs[p], R.zs[p]);
    const goesOut = (e) => G.canGo(e) && carRoad(e.road) && !shut[dkey(e.seg, e.dir)]; // an open lane leaving the node along e
    const comesIn = (e) => (R.oneway[e.road] === 0 || e.dir === -1) && carRoad(e.road) && !shut[dkey(e.seg, -e.dir)]; // an open lane arriving along e
    while (todo.length) {
      const k = todo.pop(), seg = k >> 1, dir = k & 1 ? 1 : -1;
      const from = nodeOf(dir > 0 ? seg : seg + 1), to = nodeOf(dir > 0 ? seg + 1 : seg);
      if (to != null) for (const e of G.nodeAdj[to]) { // lanes on from here that nothing else feeds
        if (!goesOut(e)) continue;
        let fed = false;
        for (const i of G.nodeAdj[to]) if (i.seg !== e.seg && comesIn(i)) { fed = true; break; }
        if (!fed) { shut[dkey(e.seg, e.dir)] = 1; todo.push(dkey(e.seg, e.dir)); }
      }
      if (from != null) for (const e of G.nodeAdj[from]) { // lanes into here with no other way on
        if (!comesIn(e)) continue;
        let on = false;
        for (const o of G.nodeAdj[from]) if (o.seg !== e.seg && goesOut(o)) { on = true; break; }
        if (!on) { shut[dkey(e.seg, -e.dir)] = 1; todo.push(dkey(e.seg, -e.dir)); }
      }
    }
  }
  /** A road segment a car may be put on (nyc.nearestRoad filter). */
  const openRoad = (r, p) => carRoad(r) && !(R.oneway[r] ? shut[dkey(p, 1)] : shut[dkey(p, 1)] && shut[dkey(p, -1)]);
  // The way in to the lots' street is kept clear, as the street is: of signal poles (POLE_CLEAR metres to each side
  // of it) and of cabs called to the stand in front of it.
  const mouth = streetMouth(), POLE_CLEAR = 1.5;
  const inRect = (q, x, z, pad) => x > q.x0 - pad && x < q.x1 + pad && z > q.z0 - pad && z < q.z1 + pad;
  /** Would a cab standing at (x, z) along (fx, fz), with 0.6 m around it, reach into the rectangle q? */
  function cabInRect(q, x, z, fx, fz) {
    const ex = Math.abs(fx) * CAR_HL + Math.abs(fz) * CAR_HW + 0.6, ez = Math.abs(fz) * CAR_HL + Math.abs(fx) * CAR_HW + 0.6;
    return x + ex > q.x0 && x - ex < q.x1 && z + ez > q.z0 && z - ez < q.z1;
  }

  // ---- vehicles -----------------------------------------------------------------------------------------
  // slots: [0, N_TAXI) AI cabs · [N_TAXI, N_AI) AI cars · [N_AI, +N_SPECIAL) called/parked cabs · then remote cabs
  const total = N_AI + N_SPECIAL + N_REMOTE;
  const veh = [];
  for (let i = 0; i < total; i++) {
    const taxi = i < N_TAXI || i >= N_AI;
    veh.push({
      i, taxi, mode: i < N_AI ? 'ai' : 'off', color: CAR_COLORS[(i * 7) % CAR_COLORS.length], f: 0.85 + ((i * 37) % 30) / 100,
      // on the street: centre, height, yaw, heading (unit), half length, half width (wider while steering), speed
      x: 0, z: 1e6, y: 0, yaw: 0, hx: 0, hz: 1, hl: CAR_HL, hw: CAR_HW, v: 0, vmax: 9,
      // drawn (eased) pose, wheel spin, size while coming or going (0..1)
      rx: 0, rz: 1e6, ryaw: 0, spin: 0, fade: 1, dying: false, honk: 0, parkedAt: 0,
      // the lane stretch: segment, direction, start point, length, direction vector, end node; lane, metres along,
      // metres right of the centre line (and where the lane is), steering angle, metres along at the way in
      seg: -1, dir: 1, ax: 0, az: 0, L: 1, fx: 0, fz: 1, endNode: -1, lane: 0, s: 0, off: 0, laneOff: 0, steer: 0, s0: 0,
      // the corner just taken (in) and the one ahead (out): half length, angle, side (+1 right), old heading, corner point
      iTl: 0, iAng: 0, iSig: 1, iFx: 0, iFz: 1, iPx: 0, iPz: 0, oTl: 0, oAng: 0, oSig: 1,
      // the next stretch: segment (-1: the street ends), direction, lane and its offset, heading, metres along at the way in; where this stretch is left
      nxSeg: -1, nxDir: 1, nxLane: 0, nxOff: 0, nxFx: 0, nxFz: 1, nxS0: 0, sT: 1,
      // the junction ahead: node (-1: none), metres from this stretch's end, heading into it, the lane stretch into it, the way chosen out of it
      jNode: -1, jDist: 0, jFx: 0, jFz: 1, jKey: -1, planSeg: -1, planDir: 1, planLane: 0, planTurn: 0,
      // the junction it owns (box) and the one it is still leaving (boxPrev), each with how it crosses
      box: -1, bKey: -1, bFx: 0, bFz: 1, bTurn: 0, boxPrev: -1, pKey: -1, pFx: 0, pFz: 1, pTurn: 0,
      // going around something, and how long it has been unable to move
      dodge: null, dodgeOff: 0, dodgeEnd: 0, dodgeTry: 0, dodgeSoft: false, nudgeTry: 0, wait: 0, lineWait: 0, idle: 0, markX: 0, markZ: 0,
    });
  }
  const remoteList = [];
  // Someone standing in the lane, as the cars see them.
  const WALKER = { mode: 'walker', x: 0, z: 1e6, hx: 0, hz: 1, hl: 0.5, hw: 0.5, v: 0 };

  const kits = vehicleKits();
  const paintTaxi = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });
  const TAXI_BODY = new THREE.Color(0xffc21a);
  const TAXI_YELLOW = '#fff3a0';
  // A player's own cab in its shop colour (balance.js SHOP kind 'cab' tint): '' is the plain fleet yellow.
  const TINTS = new Map();
  const tintOf = (hex) => { if (!hex) return TAXI_BODY; let c = TINTS.get(hex); if (!c) { c = new THREE.Color(hex); TINTS.set(hex, c); } return c; };
  const paintCar = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.1 });
  // Canvas textures of the cabs: mipmaps with trilinear filtering (a cab at 10 to 40 m shows these 4 to 20 times
  // smaller than they are painted), anisotropy by tier. premultiply: the decal is see-through, and mipmaps of
  // straight alpha average the transparent texels in as black (a dark rim around the stripe and the letters).
  const toTex = (c, premultiply = false) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = tier.anisotropy;
    t.premultiplyAlpha = premultiply;
    return t;
  };
  const nTaxiSlots = N_TAXI + N_SPECIAL + N_REMOTE;
  const mk = (geo, mat, count) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.frustumCulled = false;
    m.count = count;
    scene.add(m);
    return m;
  };
  const signMat = new THREE.MeshBasicMaterial({ map: toTex(paintTaxiSign(makeCanvas(tier.signW, tier.signH))), color: new THREE.Color(1.3, 1.3, 1.2) });
  // The decal's texture is uploaded premultiplied, so it is blended as that: source + what is behind x (1 - alpha).
  // (three's own premultipliedAlpha switch is for straight-alpha textures: its shader would multiply by alpha again.)
  const decalMat = new THREE.MeshBasicMaterial({
    map: toTex(paintTaxiDecal(makeCanvas(tier.decalW, tier.decalH)), true), transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, // units too: a factor alone is nothing on a panel seen face on
  });
  // Fog is the one place the shader has to know: it may only fade what the decal covers (fog colour x alpha), or the
  // clear part of the plane would lay a film of fog over the door.
  decalMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor * gl_FragColor.a, fogFactor );
#endif`);
  };
  const taxiParts = [
    mk(kits.taxi.get('paint'), paintTaxi, nTaxiSlots),
    mk(kits.taxi.get('gloss'), kitMats.gloss, nTaxiSlots),
    mk(kits.taxi.get('metal'), kitMats.metal, nTaxiSlots),
    mk(kits.taxi.get('glow'), kitMats.glow, nTaxiSlots),
    mk(taxiSignGeometry(), signMat, nTaxiSlots),
    mk(taxiDecalGeometry(), decalMat, nTaxiSlots),
  ];
  const carParts = [
    mk(kits.car.get('paint'), paintCar, N_CAR),
    mk(kits.car.get('gloss'), kitMats.gloss, N_CAR),
    mk(kits.car.get('metal'), kitMats.metal, N_CAR),
    mk(kits.car.get('glow'), kitMats.glow, N_CAR),
  ];
  for (let k = 0; k < nTaxiSlots; k++) taxiParts[0].setColorAt(k, TAXI_BODY);
  taxiParts[0].instanceColor.needsUpdate = true;
  for (let k = 0; k < N_CAR; k++) carParts[0].setColorAt(k, veh[N_TAXI + k].color);
  carParts[0].instanceColor.needsUpdate = true;
  const wheels = mk(kits.wheel, kitMats.metal, total * 4);
  const beamTex = new THREE.CanvasTexture(paintHeadlight(makeCanvas(64, 256)));
  const beams = mk(new THREE.PlaneGeometry(2.8, 9).rotateX(-Math.PI / 2).translate(0, 0.05, 6.7), new THREE.MeshBasicMaterial({ map: beamTex, color: new THREE.Color(0.5, 0.46, 0.38), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), total);
  beams.layers.set(GROUND_LAYER);
  const slotAt = (i) => (i < N_TAXI ? { parts: taxiParts, k: i } : i < N_AI ? { parts: carParts, k: i - N_TAXI } : { parts: taxiParts, k: i - N_AI + N_TAXI });
  // place / hide / paintCab run for every vehicle every frame: the { parts, k } of each slot is built once (read only).
  const SLOTS = Array.from({ length: total }, (_, i) => slotAt(i));
  const slotOf = (i) => SLOTS[i] || slotAt(i);
  const WHEELS = [[-0.86, 1.45], [0.86, 1.45], [-0.86, -1.45], [0.86, -1.45]];
  const tq = new THREE.Quaternion(), wq = new THREE.Quaternion(), tm = new THREE.Matrix4(), wm = new THREE.Matrix4();
  const tv = new THREE.Vector3(), wv = new THREE.Vector3(), ts = new THREE.Vector3(1, 1, 1), ws = new THREE.Vector3(1, 1, 1), XA = new THREE.Vector3(1, 0, 0);
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  function place(i, x, z, yaw, spin, y = 0, size = 1) {
    const { parts, k } = slotOf(i);
    tq.setFromAxisAngle(Y_AXIS, yaw);
    tm.compose(tv.set(x, y, z), tq, ts.setScalar(size));
    for (const p of parts) p.setMatrixAt(k, tm);
    beams.setMatrixAt(i, tm);
    wq.setFromAxisAngle(XA, spin);
    for (let w = 0; w < 4; w++) {
      wm.compose(wv.set(WHEELS[w][0], 0.34, WHEELS[w][1]), wq, ws).premultiply(tm);
      wheels.setMatrixAt(i * 4 + w, wm);
    }
  }
  function hide(i) {
    const { parts, k } = slotOf(i);
    for (const p of parts) p.setMatrixAt(k, ZERO);
    beams.setMatrixAt(i, ZERO);
    for (let w = 0; w < 4; w++) wheels.setMatrixAt(i * 4 + w, ZERO);
  }

  // ---- a car on its lane ----------------------------------------------------------------------------------
  /** Puts the car on a lane stretch (its length, direction and end node). */
  function onto(c, seg, dir) {
    const a = dir > 0 ? seg : seg + 1, b = dir > 0 ? seg + 1 : seg;
    const ax = R.xs[a], az = R.zs[a], dx = R.xs[b] - ax, dz = R.zs[b] - az, L = Math.hypot(dx, dz) || 1;
    const n = G.nodeAt(R.xs[b], R.zs[b]);
    c.seg = seg; c.dir = dir; c.ax = ax; c.az = az; c.L = L; c.fx = dx / L; c.fz = dz / L;
    c.endNode = n == null ? -1 : n;
    c.vmax = (VMAX[R.cls[R.segRoad[seg]]] ?? 9) * c.f;
  }
  // A corner is an arc between two lane lines: from tl metres before the corner point (q = -tl) to tl after it (q = tl).
  function arc(c, px, pz, fx, fz, sig, ang, tl, q) {
    const rho = tl / Math.tan(ang / 2), phi = (q + tl) / (2 * tl) * ang * sig; // angle turned so far, + to the right
    const cos = Math.cos(phi), sin = Math.sin(phi);
    const hx = fx * cos - fz * sin, hz = fz * cos + fx * sin;
    c.x = px - fx * tl - fz * sig * rho + hz * sig * rho;
    c.z = pz - fz * tl + fx * sig * rho - hx * sig * rho;
    c.hx = hx; c.hz = hz;
  }
  function pose(c) {
    const fx = c.fx, fz = c.fz;
    let q = c.s - c.s0;
    if (c.iTl > 0 && q < c.iTl) arc(c, c.iPx, c.iPz, c.iFx, c.iFz, c.iSig, c.iAng, c.iTl, q);
    else if (c.oTl > 0 && (q = c.s - c.sT) > -c.oTl) arc(c, c.ax + fx * c.sT - fz * c.off, c.az + fz * c.sT + fx * c.off, fx, fz, c.oSig, c.oAng, c.oTl, q);
    else { c.x = c.ax + fx * c.s - fz * c.off; c.z = c.az + fz * c.s + fx * c.off; c.hx = fx; c.hz = fz; }
    c.yaw = Math.atan2(c.hx, c.hz) - c.steer;
    c.hw = CAR_HW + CAR_HL * Math.abs(Math.sin(c.steer));
  }
  const inCorner = (c) => (c.iTl > 0 && c.s - c.s0 < c.iTl) || (c.oTl > 0 && c.s - c.sT > -c.oTl);

  /** The one lane on from a node that is not a junction (null where the street ends). */
  function onward(node, fromSeg) {
    for (const e of G.nodeAdj[node]) if (e.seg !== fromSeg && G.canGo(e) && carRoad(e.road) && !shut[dkey(e.seg, e.dir)]) return e;
    return null;
  }
  // The way out of junction J for a car arriving on lastSeg (road `road`, heading jFx/jFz). Straight on from any
  // lane; left only from the leftmost lane and right only from the rightmost, so nobody turns across a lane beside
  // them. Where there is no way straight on, the left half of the lanes turns left and the right half right.
  const optE = [], optW = [], optT = [];
  function choose(c, J, lastSeg, road) {
    optE.length = optW.length = optT.length = 0;
    const hx = c.jFx, hz = c.jFz, nx = G.nodeX[J], nz = G.nodeZ[J];
    let straight = false, left = false, right = false;
    for (const e of G.nodeAdj[J]) {
      if (e.seg === lastSeg || !G.canGo(e) || !carRoad(e.road) || shut[dkey(e.seg, e.dir)]) continue;
      const ex = G.nodeX[e.to] - nx, ez = G.nodeZ[e.to] - nz, L = Math.hypot(ex, ez) || 1;
      const dot = (ex * hx + ez * hz) / L;
      if (dot < -0.5) continue;
      const turn = dot > 0.7 ? 0 : ez * hx - ex * hz > 0 ? 1 : -1;
      if (turn === 0) straight = true; else if (turn < 0) left = true; else right = true;
      optE.push(e); optT.push(turn); optW.push(turn === 0 ? 1 : dot > -0.2 ? 0.32 : 0.08);
    }
    const per = lanesOf(road), k = Math.min(c.lane, per - 1);
    let sum = 0;
    for (let i = 0; i < optE.length; i++) {
      const turn = optT[i];
      const ok = turn === 0 || (turn < 0 ? k === 0 || (!straight && (k < per / 2 || !right)) : k === per - 1 || (!straight && (k >= per / 2 || !left)));
      if (!ok) optW[i] = 0;
      sum += optW[i];
    }
    c.planSeg = -1;
    if (sum <= 0) return;
    let pick = Math.random() * sum, at = -1;
    for (let i = 0; i < optE.length; i++) { if (optW[i] <= 0) continue; at = i; pick -= optW[i]; if (pick <= 0) break; }
    const e = optE[at], turn = optT[at], per2 = lanesOf(e.road);
    c.planSeg = e.seg; c.planDir = e.dir; c.planTurn = turn;
    c.planLane = turn === 0 ? nearestLane(e.road, laneOffset(road, k)) : turn < 0 ? (straight ? 0 : Math.min(k, per2 - 1)) : (straight ? per2 - 1 : Math.max(0, per2 - (per - k)));
  }
  /** Finds the junction ahead (through the bends on the way) and picks the way out of it. */
  function lookAhead(c) {
    let seg = c.seg, dir = c.dir, node = c.endNode, dist = 0;
    for (let hops = 0; node >= 0 && junctionR[node] === 0 && hops < 24; hops++) {
      const e = onward(node, seg);
      if (!e) { node = -1; break; }
      dist += segLen(e.seg); seg = e.seg; dir = e.dir; node = e.to;
    }
    c.jDist = dist; c.planSeg = -1; c.planTurn = 0;
    if (node < 0 || junctionR[node] === 0) { c.jNode = -1; return; } // the street ends (or is one long run of bends: looked at again on the next stretch)
    const a = dir > 0 ? seg : seg + 1, b = dir > 0 ? seg + 1 : seg;
    const dx = R.xs[b] - R.xs[a], dz = R.zs[b] - R.zs[a], L = Math.hypot(dx, dz) || 1;
    c.jNode = node; c.jFx = dx / L; c.jFz = dz / L; c.jKey = dkey(seg, dir);
    choose(c, node, seg, R.segRoad[seg]);
  }
  /** The next stretch of lane and the corner into it. */
  function plot(c) {
    let seg = -1, dir = 1, lane = 0;
    if (c.endNode >= 0 && c.endNode === c.jNode) { seg = c.planSeg; dir = c.planDir; lane = c.planLane; }
    else if (c.endNode >= 0 && junctionR[c.endNode] === 0) {
      const e = onward(c.endNode, c.seg);
      if (e) { seg = e.seg; dir = e.dir; lane = nearestLane(e.road, c.laneOff); }
    }
    c.nxSeg = seg; c.oTl = 0; c.sT = c.L;
    if (seg < 0) return;
    const road = R.segRoad[seg], a = dir > 0 ? seg : seg + 1, b = dir > 0 ? seg + 1 : seg;
    const dx = R.xs[b] - R.xs[a], dz = R.zs[b] - R.zs[a], L2 = Math.hypot(dx, dz) || 1, gx = dx / L2, gz = dz / L2;
    const off2 = laneOffset(road, lane);
    const dot = c.fx * gx + c.fz * gz, across = gx * c.fz - gz * c.fx; // across: how fast this lane crosses the next road, + toward its left
    // where this lane line meets the next one (for lines that really cross; a bend is left at the node)
    if (Math.abs(across) > 0.3) c.sT = c.L + Math.max(-12, Math.min(12, (off2 - c.laneOff * dot) / across));
    c.nxDir = dir; c.nxLane = lane; c.nxOff = off2; c.nxFx = gx; c.nxFz = gz;
    c.nxS0 = (c.sT - c.L) * dot - c.laneOff * across;
    const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
    // the corner: no longer than the two stretches allow, and it starts after the corner this car is still in ends
    if (ang > 0.12) { c.oTl = Math.min(CORNER, 0.4 * c.L, 0.4 * L2, Math.max(0, c.sT - c.s0 - c.iTl)); c.oAng = ang; c.oSig = across < 0 ? 1 : -1; }
  }
  /** Onto the next stretch at the corner point: the car's place on the street does not jump. */
  function hop(c) {
    if (c.nxSeg < 0) return false;
    const node = c.endNode, f0x = c.fx, f0z = c.fz, over = c.s - c.sT;
    const px = c.ax + f0x * c.sT - f0z * c.off, pz = c.az + f0z * c.sT + f0x * c.off;
    const through = node === c.jNode;
    c.iTl = c.oTl; c.iAng = c.oAng; c.iSig = c.oSig; c.iFx = f0x; c.iFz = f0z; c.iPx = px; c.iPz = pz;
    onto(c, c.nxSeg, c.nxDir);
    const qx = px - c.ax, qz = pz - c.az;
    c.s0 = qx * c.fx + qz * c.fz;
    c.off = qz * c.fx - qx * c.fz;
    c.s = c.s0 + over;
    c.lane = c.nxLane; c.laneOff = laneOffset(R.segRoad[c.seg], c.lane);
    if (c.iTl > 0) c.dodge = null; // around a corner "across the road" is another direction: the way around ends here
    if (through) { // out the far side: the junction stays this car's until its tail has left it
      c.boxPrev = c.box === node ? node : -1; c.pKey = c.bKey; c.pFx = c.bFx; c.pFz = c.bFz; c.pTurn = c.bTurn;
      c.box = -1;
      lookAhead(c);
    } else {
      c.boxPrev = -1;
      if (c.jNode >= 0) c.jDist -= c.L; else lookAhead(c);
    }
    plot(c);
    return true;
  }

  // ---- junctions -----------------------------------------------------------------------------------------
  // One direction at a time owns a junction. Cars from the same lane stretch share it, and so do the two opposite
  // directions of one street while neither is turning left across the other.
  const agrees = (c, key, hx, hz, turn) => key === c.jKey || (c.jFx * hx + c.jFz * hz < -0.7 && turn !== -1 && c.planTurn !== -1);
  function boxFree(c, J) {
    for (let i = 0; i < N_AI; i++) {
      const o = veh[i];
      if (o === c || o.mode !== 'ai' || o.seg < 0) continue;
      if (o.box === J) { if (!agrees(c, o.bKey, o.bFx, o.bFz, o.bTurn)) return false; }
      else if (o.boxPrev === J && !agrees(c, o.pKey, o.pFx, o.pFz, o.pTurn)) return false;
    }
    return true;
  }
  // Is there room past junction J on the lane this car is taking? Nobody drives in to stand on the crossing. Going
  // straight on, a car that is moving away counts as room; a car that turns waits until the first two car lengths of
  // its lane are empty, so that it never has to stop halfway round the corner behind one that stopped.
  function exitRoom(c, J) {
    const off = laneOffset(R.segRoad[c.planSeg], c.planLane), reach = junctionR[J] + RULES.len * 2 + RULES.gap, slow = c.planTurn === 0 ? 2.5 : 1e9;
    for (let i = 0; i < N_AI; i++) {
      const o = veh[i];
      if (o !== c && o.mode === 'ai' && o.seg === c.planSeg && o.dir === c.planDir && o.v < slow && o.s < reach && Math.abs(o.off - off) < 1.7) return false;
    }
    return true;
  }

  // ---- signals ---------------------------------------------------------------------------------------------
  const sigMats = {};
  for (const k of ['nsRed', 'nsYellow', 'nsGreen', 'ewRed', 'ewYellow', 'ewGreen']) sigMats[k] = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const lampGeo = new THREE.CircleGeometry(0.13, 14);
  const poleKit = new Kit();
  poleKit.cyl(0.1, 0.13, 6.2, '#2b2f33', { y: 3.1, mat: 'metal' });
  poleKit.box(0.12, 0.12, 4.2, '#2b2f33', { y: 6.05, z: 2.1, mat: 'metal' });
  poleKit.box(0.42, 1.12, 0.3, '#e0b21a', { y: 5.45, z: 4.0, mat: 'gloss' });
  const poleGeos = poleKit.geometries();
  const sigGroup = new THREE.Group();
  scene.add(sigGroup);
  const sigPoles = [];
  const ONE = new THREE.Vector3(1, 1, 1);
  let sigAt = { x: 1e9, z: 1e9 };
  function rebuildSignals(px, pz) {
    sigAt = { x: px, z: pz };
    sigGroup.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
    sigGroup.clear();
    sigPoles.length = 0;
    const poles = [], heads = { nsRed: [], nsYellow: [], nsGreen: [], ewRed: [], ewYellow: [], ewGreen: [] };
    const rad = low ? 170 : 260;
    for (let nd = 0; nd < G.nodeX.length; nd++) {
      if (!G.nodeSignal[nd]) continue;
      const nx = G.nodeX[nd], nz = G.nodeZ[nd];
      if (Math.abs(nx - px) > rad || Math.abs(nz - pz) > rad) continue;
      if (inRect(NO_ROAD, nx, nz, 0)) continue; // a crossing inside the lots' street (7th Avenue x W 41st St): no cars, no lights
      const jr = junctionR[nd];
      for (const e of G.nodeAdj[nd]) {
        const r = e.road;
        if (R.cls[r] > ROAD.STREET) continue;
        if (R.oneway[r] && e.dir !== -1) continue;
        if (shut[dkey(e.seg, -e.dir)]) continue; // no light for a lane nobody arrives on
        const ux = G.nodeX[e.to] - nx, uz = G.nodeZ[e.to] - nz, L = Math.hypot(ux, uz) || 1;
        const dx = -ux / L, dz = -uz / L;
        const rx = -dz, rz = dx;
        const w = R.width[r];
        let x = nx + dx * (jr + 1.6) + rx * (w / 2 + 0.9);
        const z = nz + dz * (jr + 1.6) + rz * (w / 2 + 0.9);
        // The poles stand on the far side of a crossing, and the far side of 7th Avenue x W 42nd St is the way in to
        // the lots' street: a pole that would stand between the arch's posts goes just outside the nearer post. Its
        // light still hangs toward the lane it is for, and the crossing works as before.
        if (inRect(mouth, x, z, POLE_CLEAR)) x = x < (mouth.x0 + mouth.x1) / 2 ? mouth.x0 - POLE_CLEAR : mouth.x1 + POLE_CLEAR;
        if (inRect(NO_ROAD, x, z, 0)) continue;
        const yaw = Math.atan2(-rx, -rz);
        poles.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw), ONE));
        sigPoles.push({ x, z });
        const axis = Math.abs(dz) > Math.abs(dx) ? 'ns' : 'ew';
        const hx = x - rx * 4.0, hz = z - rz * 4.0;
        const face = Math.atan2(-dx, -dz);
        const fx = Math.sin(face) * 0.16, fz = Math.cos(face) * 0.16;
        for (const [k, dy] of [['Red', 0.34], ['Yellow', 0], ['Green', -0.34]]) {
          heads[axis + k].push(new THREE.Matrix4().compose(new THREE.Vector3(hx + fx, 5.45 + dy, hz + fz), new THREE.Quaternion().setFromAxisAngle(Y_AXIS, face), ONE));
        }
      }
    }
    const add = (geo, mat, list) => {
      if (!list.length) return;
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((mm, i) => m.setMatrixAt(i, mm));
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      sigGroup.add(m);
    };
    for (const [k, geo] of poleGeos) add(geo, kitMats[k] || kitMats.base, poles);
    for (const [k, list] of Object.entries(heads)) add(lampGeo, sigMats[k], list);
  }
  const BASE = { Red: new THREE.Color(1, 0.08, 0.06), Yellow: new THREE.Color(1, 0.6, 0.05), Green: new THREE.Color(0.1, 1, 0.5) };
  let phase = 'nsG';
  const SIG_ON = 3.4, SIG_OFF = 0.05;
  // [green, yellow, red] lamp materials per axis (painted every frame, so no closure or key strings per call)
  const SIG_NS = [sigMats.nsGreen, sigMats.nsYellow, sigMats.nsRed], SIG_EW = [sigMats.ewGreen, sigMats.ewYellow, sigMats.ewRed];
  function lightAxis(m, green, yellow) {
    m[0].color.copy(BASE.Green).multiplyScalar(green ? SIG_ON : SIG_OFF);
    m[1].color.copy(BASE.Yellow).multiplyScalar(yellow ? SIG_ON : SIG_OFF);
    m[2].color.copy(BASE.Red).multiplyScalar(!green && !yellow ? SIG_ON : SIG_OFF);
  }
  function paintSignals() {
    lightAxis(SIG_NS, phase === 'nsG', phase === 'nsY');
    lightAxis(SIG_EW, phase === 'ewG', phase === 'ewY');
  }

  // ---- coming and going -------------------------------------------------------------------------------------
  const others = [];
  /** Is this vehicle on the street (drawn and solid)? An AI car between two lives is not. */
  const there = (o) => !(o.mode === 'ai' && o.seg < 0);
  /** Off the street at once (no fade): the slot is free and the car comes back somewhere else. */
  function vanish(c) {
    c.seg = -1; c.box = -1; c.boxPrev = -1; c.dying = false; c.dodge = null; c.v = 0;
    c.z = 1e6; c.rz = 1e6;
    hide(c.i);
  }
  /** Off the street cleanly: it shrinks away over RULES.fadeS, then comes back somewhere else. */
  function retire(c) { c.dying = true; }
  /** Would a car put here be on top of (or right in front of / behind) another one? */
  function crowded(c, ahead) {
    for (const o of veh) {
      if (o === c || o.mode === 'off' || !there(o)) continue;
      if (boxesTouch(c.x, c.z, c.hx, c.hz, CAR_HL + ahead, CAR_HW + 0.6, o.x, o.z, o.hx, o.hz, CAR_HL, o.hw)) return true;
    }
    for (const o of remoteList) if (boxesTouch(c.x, c.z, c.hx, c.hz, CAR_HL + ahead, CAR_HW + 0.6, o.x, o.z, Math.sin(o.yaw), Math.cos(o.yaw), CAR_HL, CAR_HW)) return true;
    return false;
  }
  function spawn(c, px, pz, minD = 90) {
    vanish(c);
    c.mode = 'ai';
    for (let tries = 0; tries < 24; tries++) {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (SPAWN_R - minD);
      const hit = nyc.nearestRoad(px + Math.cos(a) * d, pz + Math.sin(a) * d, 40, openRoad);
      if (!hit) continue;
      const r = hit.road;
      const dir = R.oneway[r] || shut[dkey(hit.seg, -1)] ? 1 : shut[dkey(hit.seg, 1)] || Math.random() < 0.5 ? -1 : 1;
      onto(c, hit.seg, dir);
      // on the open stretch between the junctions at its ends: not on a crossing, and with room to stop for the next one
      const from = G.nodeAt(c.ax, c.az);
      const s0 = (from == null ? 0 : junctionR[from]) + CAR_HL + 2, s1 = c.L - (c.endNode < 0 ? 0 : junctionR[c.endNode]) - RULES.stopBack - 3;
      if (s1 - s0 < 1) { c.seg = -1; continue; }
      c.s = s0 + Math.random() * (s1 - s0);
      c.lane = (Math.random() * lanesOf(r)) | 0;
      c.off = c.laneOff = laneOffset(r, c.lane);
      c.steer = 0; c.s0 = 0; c.iTl = 0; c.oTl = 0; c.sT = c.L + 1;
      pose(c);
      if (crowded(c, 7)) { c.seg = -1; continue; }
      lookAhead(c);
      plot(c);
      c.v = c.vmax * 0.5;
      c.rx = c.x; c.rz = c.z; c.ryaw = c.yaw;
      c.fade = 0; c.wait = 0; c.lineWait = 0; c.idle = 0; c.markX = c.x; c.markZ = c.z;
      return true;
    }
    c.z = 1e6;
    return false;
  }

  // ---- driving -------------------------------------------------------------------------------------------------
  // How far ahead on this car's path `o` is (bumper to its near side), or 1e9 when it is not on the path. The path is
  // the rest of this stretch along the car's own line across the road, then the lane it takes after the corner: what
  // lies straight on past a corner the car is turning at is not on it, and neither is a cab at the curb it turns
  // toward. Sets pathSkew (0 for a car in line, 1 for one lying across the lane), pathHere (it is on this stretch)
  // and pathSide (metres between its side and this car's as it passes: under zero it is in the way, up to SIDE it is
  // only close beside the lane, like a cab at the curb).
  let pathSkew = 0, pathHere = false, pathSide = 0;
  function onPath(c, o) {
    const fx = c.fx, fz = c.fz, reach = c.sT - c.s;
    let ex = o.x - c.ax, ez = o.z - c.az, along = ex * fx + ez * fz - c.s;
    if (along > 0.5) {
      const cs = Math.abs(o.hx * fx + o.hz * fz), sn = Math.abs(o.hx * fz - o.hz * fx), deep = o.hl * cs + o.hw * sn;
      const side = Math.abs(ez * fx - ex * fz - c.off) - (o.hl * sn + o.hw * cs + CAR_HW);
      // on this stretch: its near side is before the corner point (a car's nose swings at most 0.4 m past that as it
      // turns: someone standing 2 m beyond the corner, straight on, is not in the way of a car that turns there)
      if (along - deep < reach + 0.5 && side < SIDE) { pathSkew = sn; pathHere = true; pathSide = side; return along - deep - CAR_HL; }
    }
    if (c.nxSeg < 0) return 1e9;
    const gx = c.nxFx, gz = c.nxFz;
    ex = o.x - G.nodeX[c.endNode]; ez = o.z - G.nodeZ[c.endNode]; along = ex * gx + ez * gz - c.nxS0;
    if (along <= 0.5) return 1e9;
    const cs = Math.abs(o.hx * gx + o.hz * gz), sn = Math.abs(o.hx * gz - o.hz * gx);
    const side = Math.abs(ez * gx - ex * gz - c.nxOff) - (o.hl * sn + o.hw * cs + CAR_HW);
    if (side >= SIDE) return 1e9;
    pathSkew = sn; pathHere = false; pathSide = side;
    return reach + along - (o.hl * cs + o.hw * sn) - CAR_HL;
  }
  // Something is on the path past a corner: a car does not drive into the corner to stand in it at an angle. If the
  // place it would stop (run metres on) is in the corner or less than a car length out of it, it waits before it.
  function shortOfCorner(c, run) {
    const pre = c.sT - c.oTl - c.s - 0.3;
    return c.oTl > 0 && pre > 0 && run < pre + 2 * c.oTl + RULES.len && pre < run ? pre : run;
  }
  /** The road beside the car's line, `shift` metres to its right, from 10 m behind it to `reach` ahead: is it empty? */
  function sideFree(c, shift, reach, skip) {
    const fx = c.fx, fz = c.fz;
    for (const o of others) {
      if (o === c || o === skip || !there(o)) continue;
      const ex = o.x - c.ax, ez = o.z - c.az, along = ex * fx + ez * fz - c.s;
      if (along < -10 || along > reach) continue;
      const wide = o.hl * Math.abs(o.hx * fz - o.hz * fx) + o.hw * Math.abs(o.hx * fx + o.hz * fz), lat = ez * fx - ex * fz - c.off;
      if (along < 0 && Math.abs(lat) < wide + CAR_HW) continue; // right behind this car: it follows whatever this one does
      if (Math.abs(lat - shift) < wide + CAR_HW + 0.4) return false;
    }
    return true;
  }
  // Picks a line past `o` (a stopped cab, someone standing in the lane) on whichever side has the road for it:
  // inside the curbs, on this car's side of a two-way street, nobody beside it, and room ahead to get across.
  // `here`: the thing is on this stretch. On the next one it can be gone around only where the street runs straight on
  // (across the road means the same on both stretches then); not around a corner. `soft`: it is only close beside the
  // lane and this is a little extra room, which a real way around something may replace.
  function goAround(c, o, t, here, soft) {
    if (!here && (c.nxSeg < 0 || c.oTl > 0)) return;
    const fx = here ? c.fx : c.nxFx, fz = here ? c.fz : c.nxFz;
    const ex = o.x - (here ? c.ax : G.nodeX[c.endNode]), ez = o.z - (here ? c.az : G.nodeZ[c.endNode]);
    const along = here ? ex * fx + ez * fz - c.s : c.sT - c.s + ex * fx + ez * fz - c.nxS0, at = ez * fx - ex * fz; // metres ahead; metres right of the centre line
    const cs = Math.abs(o.hx * fx + o.hz * fz), sn = Math.abs(o.hx * fz - o.hz * fx);
    const wide = o.hl * sn + o.hw * cs, deep = o.hl * cs + o.hw * sn;
    const road = R.segRoad[here ? c.seg : c.nxSeg], edge = R.width[road] / 2 - CAR_HW - 0.15, inner = R.oneway[road] ? -edge : CAR_HW + 0.2;
    const clear = wide + CAR_HW + PASS, reach = along + deep + CAR_HL + 4;
    const room = (along - deep - CAR_HL - (o === WALKER ? 0.8 : 1.8)) * SLEW; // how far across it can get before its nose is level with the thing
    const l = at - clear, r = at + clear;
    const lOk = l >= inner && l <= edge && c.off - l <= room && sideFree(c, l - c.off, reach, o);
    const rOk = r >= inner && r <= edge && r - c.off <= room && sideFree(c, r - c.off, reach, o);
    if (!lOk && !rOk) return;
    c.dodge = o;
    c.dodgeOff = lOk && (!rOk || Math.abs(l - c.off) <= Math.abs(r - c.off)) ? l : r;
    c.dodgeEnd = t + 25;
    c.dodgeSoft = soft;
  }
  // The hard rule. The car has just stepped from (ox, oz, heading ohx/ohz, half width ohw) to where it is: true if
  // that step brought it within SAFE of another vehicle (a step that only moves two touching cars apart is fine).
  function bumps(c, ox, oz, ohx, ohz, ohw) {
    for (const o of others) {
      if (o === c || !there(o)) continue;
      const dx = o.x - c.x, dz = o.z - c.z;
      if (dx > 8 || dx < -8 || dz > 8 || dz < -8) continue;
      if (!boxesTouch(c.x, c.z, c.hx, c.hz, CAR_HL + SAFE_L, c.hw + SAFE_W, o.x, o.z, o.hx, o.hz, CAR_HL + SAFE_L, o.hw + SAFE_W)) continue;
      const ex = o.x - ox, ez = o.z - oz;
      if (dx * dx + dz * dz >= ex * ex + ez * ez && boxesTouch(ox, oz, ohx, ohz, CAR_HL + SAFE_L, ohw + SAFE_W, o.x, o.z, o.hx, o.hz, CAR_HL + SAFE_L, o.hw + SAFE_W)) continue;
      return true;
    }
    return false;
  }
  // A step that changes stretch touches most of the car's lane state: these are put back if the hard rule refuses it.
  const KEEP = ['seg', 'dir', 'ax', 'az', 'L', 'fx', 'fz', 'endNode', 'vmax', 'lane', 'laneOff', 's0', 'iTl', 'iAng', 'iSig', 'iFx', 'iFz', 'iPx', 'iPz', 'oTl', 'oAng', 'oSig',
    'nxSeg', 'nxDir', 'nxLane', 'nxOff', 'nxFx', 'nxFz', 'nxS0', 'sT', 'jNode', 'jDist', 'jFx', 'jFz', 'jKey', 'planSeg', 'planDir', 'planLane', 'planTurn',
    'box', 'bKey', 'bFx', 'bFz', 'bTurn', 'boxPrev', 'pKey', 'pFx', 'pFz', 'pTurn', 'dodge'];
  const kept = {};
  /** One AI car, one frame: what is ahead, how fast, the step, and whether it is stuck. */
  function drive(c, dt, t, player) {
    if (c.dying) {
      c.fade -= dt / RULES.fadeS;
      if (c.fade <= 0) { vanish(c); return; }
    } else if (c.fade < 1) c.fade = Math.min(1, c.fade + dt / RULES.fadeS);
    const hx = c.hx, hz = c.hz;
    let target = c.dying ? 0 : c.vmax;
    let atLine = false; // waiting at a stop line for the light or the junction

    // -- the junction ahead: the light, who owns the crossing, room on the far side --
    const J = c.jNode, toNode = c.L - c.s + c.jDist;
    if (c.boxPrev >= 0 && c.s > junctionR[c.boxPrev] + CAR_HL + 1.5) c.boxPrev = -1; // the tail is out of the crossing behind
    if (J >= 0) {
      const d = toNode - (junctionR[J] + RULES.stopBack);
      let lit = true, amber = false;
      if (G.nodeSignal[J]) {
        const ns = Math.abs(c.jFz) > Math.abs(c.jFx);
        amber = phase === (ns ? 'nsY' : 'ewY');
        lit = phase === (ns ? 'nsG' : 'ewG') || (amber && d < c.v + 1); // on amber only a car too close to stop goes
      }
      // still short of the line when the light went red, or standing in a queue: the crossing is given back
      if (c.box === J && d > 2 && ((!lit && !amber) || c.v < 0.2)) c.box = -1;
      if (c.box !== J) {
        if (lit && !c.dying && c.planSeg >= 0 && d < c.v * 1.4 + 2.5 && boxFree(c, J) && exitRoom(c, J)) {
          c.box = J; c.bKey = c.jKey; c.bFx = c.jFx; c.bFz = c.jFz; c.bTurn = c.planTurn;
        } else {
          const stop = d > -0.6 ? Math.max(0, d) * 0.85 : 0; // past the line without the crossing: stop where it is
          if (stop < target) target = stop;
          if (d < 1.5) atLine = true;
          if (c.planSeg < 0 && d < 1.5 && c.v < 0.5) retire(c); // no way on from this junction
        }
      }
    } else {
      // the street ends ahead: roll up to the end and leave
      const stop = Math.max(0, toNode - 3) * 0.85;
      if (stop < target) target = stop;
      if (toNode < 6) retire(c);
    }
    // a corner is taken slowly
    if (c.oTl > 0 && c.oAng > 0.5) { const v = RULES.turnV + Math.max(0, c.sT - c.oTl - c.s) * 0.8; if (v < target) target = v; }
    if (c.iTl > 0 && c.iAng > 0.5 && c.s - c.s0 < c.iTl && RULES.turnV < target) target = RULES.turnV;

    // -- whatever is on this car's path: another car, a parked cab, the player's cab, the player --
    let blk = null, blkGap = 1e9, blkWant = 0, blkHere = false;
    const goal = c.dodge ? c.dodgeOff : c.laneOff; // where across the road this car is heading
    for (const o of others) {
      if (o === c || !there(o)) continue;
      if (o.mode === 'ai' && o.seg === c.seg && o.dir === c.dir) {
        // On the same stretch the order along it decides: the car in front goes, the one behind keeps the gap, also
        // while either of them is still moving across (two lanes running into one, a car pulling out).
        const ahead = o.s - c.s;
        if (ahead < 0 || (ahead === 0 && o.i > c.i)) continue;
        const oGoal = o.dodge ? o.dodgeOff : o.laneOff;
        if (Math.min(Math.abs(o.off - c.off), Math.abs(o.off - goal), Math.abs(oGoal - c.off), Math.abs(oGoal - goal)) > RULES.wid + SIDE) continue;
        const gap = ahead - RULES.len;
        if (gap > LOOK) continue;
        const v = Math.max(0, gap - RULES.gap) * 1.2;
        if (v < target) target = v;
        if (gap < blkGap) { blkGap = gap; blk = o; blkWant = RULES.gap; blkHere = true; }
        continue;
      }
      const dx = o.x - c.x, dz = o.z - c.z;
      if (dx > LOOK + 12 || dx < -LOOK - 12 || dz > LOOK + 12 || dz < -LOOK - 12) continue;
      const gap = onPath(c, o);
      if (gap > LOOK) continue;
      const skew = pathSkew, here = pathHere, beside = pathSide >= 0.25;
      // two cars that each have the other on their path (meeting at an angle): the lower number goes first
      if (o.mode === 'ai' && c.i < o.i && onPath(o, c) < LOOK) continue;
      const still = o.mode !== 'ai' && Math.abs(o.v || 0) < 0.5;
      if (still && beside) {
        // A stopped cab close beside the lane (at the curb): nothing to stop for. Past it slowly, with a little more room if there is some.
        if (gap < 12 && target > 5.5) target = 5.5;
        if (!c.dodge && !c.dying && gap < 14 && t - c.nudgeTry > 0.5 && !inCorner(c)) { c.nudgeTry = t; goAround(c, o, t, here, true); }
        continue;
      }
      // Behind a stopped cab that is not traffic: far enough back to pull out around it (further for one left across
      // the lane). While going around it: only as close as the rest of the way across allows.
      const want = !still ? RULES.gap : c.dodge === o ? Math.max(0.8, Math.abs(c.dodgeOff - c.off) / SLEW + 1.2) : RULES.gapParked + CAR_HL * skew / SLEW;
      const run = here ? gap - want : shortOfCorner(c, gap - want);
      const v = Math.max(0, run) * 1.2;
      if (v < target) target = v;
      // (blkWant: the gap at which this car is standing as near as it will get; before a corner that is where it waits)
      if (gap < blkGap) { blkGap = gap; blk = o; blkWant = gap - run; blkHere = here; }
    }
    // a car already on the next stretch, in or moving into the lane this one is taking
    if (c.nxSeg >= 0 && c.sT - c.s < LOOK) {
      for (let i = 0; i < N_AI; i++) {
        const o = veh[i];
        if (o === c || o.mode !== 'ai' || o.seg !== c.nxSeg || o.dir !== c.nxDir || o.s < c.nxS0) continue;
        if (Math.min(Math.abs(o.off - c.nxOff), Math.abs(o.laneOff - c.nxOff)) > RULES.wid + SIDE) continue;
        const gap = c.sT - c.s + o.s - c.nxS0 - RULES.len;
        const v = Math.max(0, shortOfCorner(c, gap - RULES.gap)) * 1.2;
        if (v < target) target = v;
        if (gap < blkGap) { blkGap = gap; blk = o; blkWant = RULES.gap; blkHere = false; }
      }
    }
    // someone on foot in the lane
    if (player && !player.driving) {
      const gap = onPath(c, WALKER);
      if (gap < 16) {
        const want = c.dodge === WALKER ? Math.max(0.4, Math.abs(c.dodgeOff - c.off) / SLEW + 0.4) : RULES.gapWalker;
        const run = pathHere ? gap - want : shortOfCorner(c, gap - want);
        const v = Math.max(0, run) * 0.9;
        if (v < target) target = v;
        if (gap < blkGap) { blkGap = gap; blk = WALKER; blkWant = gap - run; blkHere = pathHere; }
      }
    }
    // a honk for the player (on foot or in a cab) right in front of a moving car
    if (blk && (blk === WALKER || blk.mode === 'driven') && blkGap < 6 && c.v > 1.5 && t - c.honk > 4) { c.honk = t; onHonk?.(); }

    // -- going around what is not traffic --
    if (c.dodge) {
      const o = c.dodge, along = (o.x - c.ax) * c.fx + (o.z - c.az) * c.fz - c.s;
      if (along < -(CAR_HL + o.hl + 1) || along > LOOK + 10 || t > c.dodgeEnd || (o !== WALKER && (o.mode === 'off' || o.mode === 'ai' || Math.abs(o.v || 0) > 1))) c.dodge = null;
      else if (target > 5.5) target = 5.5;
    }
    if ((!c.dodge || (c.dodgeSoft && c.dodge !== blk)) && blk && !c.dying && blkGap < 14 && t - c.dodgeTry > 0.5 && !inCorner(c) && (blk === WALKER ? c.wait > 1.5 : blk.mode !== 'ai' && Math.abs(blk.v || 0) < 0.5)) {
      c.dodgeTry = t;
      goAround(c, blk, t, blkHere, false);
    }

    // -- the step --
    c.v += (target - c.v) * (1 - Math.exp(-dt * (target < c.v ? 5 : 1.2)));
    if (target === 0 && c.v < 0.02) c.v = 0;
    const ds = c.v * dt;
    const ox = c.x, oz = c.z, ohw = c.hw, os = c.s, ooff = c.off, osteer = c.steer;
    const hopping = c.s + ds >= c.sT && c.nxSeg >= 0;
    if (hopping) for (const k of KEEP) kept[k] = c[k];
    let side = 0;
    if (ds > 0 && !inCorner(c)) {
      // across the road: sharply at a crawl, gently at speed, and easing into the line it is heading for
      const want = goal - c.off, far = Math.abs(want);
      const lim = ds * Math.min(SLEW * Math.max(0.25, Math.min(1, 1.3 - c.v / 10)), 0.02 + 0.5 * far);
      side = far <= lim ? want : want > 0 ? lim : -lim;
    }
    // Forward and across; if the hard rule refuses that, forward only (a car can always carry on along its own line
    // when that line is clear); if it refuses that too, the car stays where it is.
    let hard = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      c.s = os + ds; c.off = ooff + side;
      // the nose points along the path: toward the lane it is moving into, and straight again at a crawl
      const lean = ds > 1e-4 ? Math.atan2(side, ds) * Math.min(1, c.v / 1.5) : 0;
      c.steer = osteer + (lean - osteer) * (1 - Math.exp(-dt * 6));
      if (side === 0 && Math.abs(c.steer) < 1e-3) c.steer = 0;
      for (let guard = 0; c.s >= c.sT && guard < 4 && hop(c); guard++) { /* onto the next stretch */ }
      if (c.nxSeg < 0 && c.s > c.L - 0.5) c.s = c.L - 0.5; // the end of the street
      pose(c);
      if ((ds <= 0 && c.steer === osteer) || !bumps(c, ox, oz, hx, hz, ohw)) break;
      if (hopping) for (const k of KEEP) c[k] = kept[k];
      if (attempt === 0 && side !== 0) { side = 0; continue; }
      hard = true;
      c.s = os; c.off = ooff; c.v = 0;
      c.steer = osteer * Math.exp(-dt * 6); // standing still it straightens (that only makes it narrower)
      pose(c);
      break;
    }

    // -- stuck? --
    // Waiting for a light or behind traffic is not being stuck. Standing behind something that is not traffic is,
    // and so is a step the hard rule keeps refusing, or a junction that never comes free under a green light.
    if (atLine && c.v < 0.15 && !(G.nodeSignal[J] && phase !== (Math.abs(c.jFz) > Math.abs(c.jFx) ? 'nsG' : 'ewG'))) c.lineWait += dt; else if (c.v > 0.5) c.lineWait = 0;
    const direct = hard || c.lineWait > 15 || (blk !== null && blk.mode !== 'ai' && blkGap < blkWant + 0.6);
    if (c.v < 0.15 && direct) c.wait += dt; else if (c.v > 0.5) c.wait = 0;
    const mx = c.x - c.markX, mz = c.z - c.markZ;
    if (mx * mx + mz * mz > 2.25) { c.markX = c.x; c.markZ = c.z; c.idle = 0; } else c.idle += dt;
    if (c.wait > RULES.stuckS || c.idle > RULES.idleS) retire(c);
  }

  // ---- simulation ----------------------------------------------------------------------------------------------
  let clockT = 0;
  function update(dt, t, player) {
    clockT = t;
    dt = Math.min(dt, 0.1); // a tab that was away comes back with one long frame: the street does not jump ahead
    phase = signalPhase(t);
    paintSignals();
    const px = player?.x ?? 0, pz = player?.z ?? 0;
    if (Math.hypot(px - sigAt.x, pz - sigAt.z) > 70) rebuildSignals(px, pz);
    WALKER.x = px; WALKER.z = pz;
    others.length = 0;
    for (const o of veh) {
      if (o.mode === 'off') continue;
      if (o.mode !== 'ai') { o.hx = Math.sin(o.yaw); o.hz = Math.cos(o.yaw); o.hw = CAR_HW; }
      others.push(o);
    }
    for (const r of remoteList) { r.hx = Math.sin(r.yaw); r.hz = Math.cos(r.yaw); r.hl = CAR_HL; r.hw = CAR_HW; others.push(r); }
    for (const c of veh) {
      if (c.mode === 'driven') {
        c.spin += c.v * dt / 0.34;
        place(c.i, c.x, c.z, c.yaw, c.spin, c.y || 0);
        paintCab(c.i, c.tint || '');
        continue;
      }
      if (c.mode === 'parked') {
        place(c.i, c.x, c.z, c.yaw, c.spin);
        const far = Math.hypot(px - c.x, pz - c.z) > DROP_R;
        if (far && t - c.parkedAt > 20) { if (c.i < N_AI) spawn(c, px, pz); else { c.mode = 'off'; hide(c.i); } }
        continue;
      }
      if (c.mode === 'off') { hide(c.i); continue; }
      if ((c.seg < 0 || Math.hypot(px - c.x, pz - c.z) > DROP_R) && !spawn(c, px, pz, c.seg < 0 ? 40 : 140)) { hide(c.i); continue; }
      drive(c, dt, t, player);
      if (c.seg < 0) continue; // faded out this frame
      if (Math.hypot(c.x - c.rx, c.z - c.rz) > 12) { c.rx = c.x; c.rz = c.z; c.ryaw = c.yaw; }
      const kk = 1 - Math.exp(-dt * 16);
      c.rx += (c.x - c.rx) * kk;
      c.rz += (c.z - c.rz) * kk;
      c.ryaw += wrap(c.yaw - c.ryaw) * (1 - Math.exp(-dt * 10));
      c.spin += c.v * dt / 0.34;
      place(c.i, c.rx, c.rz, c.ryaw, c.spin, 0, c.fade * c.fade * (3 - 2 * c.fade));
    }
    for (let k = 0; k < N_REMOTE; k++) {
      const rc = remoteList[k];
      const i = N_AI + N_SPECIAL + k;
      if (!rc) { hide(i); continue; }
      rc.spin = (rc.spin || 0) + (rc.v || 0) * dt / 0.34;
      place(i, rc.x, rc.z, rc.yaw, rc.spin);
      paintCab(i, rc.tint || (rc.yellow ? TAXI_YELLOW : ''));
    }
    for (const p of taxiParts) p.instanceMatrix.needsUpdate = true;
    for (const p of carParts) p.instanceMatrix.needsUpdate = true;
    wheels.instanceMatrix.needsUpdate = true;
    beams.instanceMatrix.needsUpdate = true;
  }
  function warm(px, pz) {
    rebuildSignals(px, pz);
    for (let i = 0; i < N_AI; i++) if (veh[i].mode === 'ai') spawn(veh[i], px, pz, 25);
  }

  // ---- player-facing API ---------------------------------------------------------------------------------------------
  function nearestTaxi(x, z, maxD = 4.6, parkedOnly = false) {
    let best = null;
    for (const c of veh) {
      if (!c.taxi || c.mode === 'driven' || c.mode === 'off' || !there(c)) continue;
      if (parkedOnly && c.mode !== 'parked') continue;
      if (!parkedOnly && c.mode !== 'ai' && c.mode !== 'parked') continue;
      const cx = c.mode === 'ai' ? c.rx : c.x, cz = c.mode === 'ai' ? c.rz : c.z;
      const d = Math.hypot(cx - x, cz - z);
      if (d < maxD && (!best || d < best.d)) best = { i: c.i, d, mode: c.mode };
    }
    return best;
  }
  function paintCab(i, tint) {
    const c = veh[i];
    if (!c?.taxi) return;
    const paint = slotOf(i).parts[0];
    paint.setColorAt(slotOf(i).k, tintOf(tint));
    if (paint.instanceColor) paint.instanceColor.needsUpdate = true;
  }
  function setCabTint(i, hex) {
    const c = veh[i];
    if (!c) return;
    c.tint = /^#[0-9a-f]{6}$/i.test(String(hex || '')) ? String(hex).toLowerCase() : '';
    paintCab(i, c.tint);
  }
  const setCabYellow = (i, on) => setCabTint(i, on ? TAXI_YELLOW : '');
  function takeTaxi(i) {
    const c = veh[i];
    if (!c || !c.taxi || c.mode === 'driven' || c.mode === 'off' || !there(c)) return null;
    if (c.mode === 'ai') { c.x = c.rx; c.z = c.rz; c.yaw = c.ryaw; c.box = -1; c.boxPrev = -1; c.dying = false; c.dodge = null; c.fade = 1; }
    c.mode = 'driven';
    c.v = 0;
    c.y = 0;
    return { x: c.x, z: c.z, yaw: c.yaw };
  }
  function driveTaxi(i, x, z, yaw, v, y = 0) {
    const c = veh[i];
    if (!c) return;
    c.x = x; c.z = z; c.yaw = yaw; c.v = v; c.y = y;
  }
  function releaseTaxi(i, x, z, yaw) {
    const c = veh[i];
    if (!c) return;
    c.x = x; c.z = z; c.yaw = yaw; c.v = 0; c.y = 0;
    c.mode = 'parked';
    c.parkedAt = clockT;
  }
  /** Parks a cab at the curb next to a stand, facing the legal direction of the street. */
  function callTaxi(stand) {
    const hit = nyc.nearestRoad(stand.x, stand.z, 30, openRoad);
    if (!hit) return -1;
    const r = hit.road;
    const w = R.width[r];
    const sx = stand.x - hit.px, sz = stand.z - hit.pz;
    const side = sx * -hit.fz + sz * hit.fx >= 0 ? 1 : -1;
    const dir = R.oneway[r] ? 1 : side;
    const tx = hit.fx * dir, tz = hit.fz * dir;
    const right = (sx * -tz + sz * tx) >= 0 ? 1 : -1;
    const off = (w / 2 - KERB) * right;
    let slot = veh.find(c => c.i >= N_AI && c.i < N_AI + N_SPECIAL && c.mode === 'off');
    if (!slot) slot = veh.filter(c => c.i >= N_AI && c.i < N_AI + N_SPECIAL && c.mode === 'parked').sort((a, b) => a.parkedAt - b.parkedAt)[0];
    if (!slot) return -1;
    // along the curb, clear of the crossings at both ends of the block (cars turn through a corner there)
    const p = hit.seg, L = segLen(p), na = G.nodeAt(R.xs[p], R.zs[p]), nb = G.nodeAt(R.xs[p + 1], R.zs[p + 1]);
    const lo = (na == null ? 0 : junctionR[na]) + CAR_HL + 4, hi = L - (nb == null ? 0 : junctionR[nb]) - CAR_HL - 4;
    let s = lo < hi ? Math.max(lo, Math.min(hi, hit.t * L)) : L / 2;
    // and not across the way in to the lots' street (the 건물 구역 stand is right in front of the arch): the nearest
    // place along this curb that leaves the arch's whole span clear, so the cab waits beside the entrance
    const kx = R.xs[p] - tz * off, kz = R.zs[p] + tx * off; // the curb line at the segment's start
    const inWay = (at) => cabInRect(mouth, kx + hit.fx * at, kz + hit.fz * at, tx, tz) || cabInRect(NO_ROAD, kx + hit.fx * at, kz + hit.fz * at, tx, tz);
    if (inWay(s)) {
      for (let d = 0.25; d <= 30; d += 0.25) {
        if (s - d >= lo && !inWay(s - d)) { s -= d; break; }
        if (s + d <= hi && !inWay(s + d)) { s += d; break; }
      }
    }
    slot.x = kx + hit.fx * s;
    slot.z = kz + hit.fz * s;
    slot.yaw = Math.atan2(tx, tz);
    slot.hx = tx; slot.hz = tz; slot.hw = CAR_HW;
    slot.v = 0;
    slot.mode = 'parked';
    slot.parkedAt = clockT;
    // the curb is outside the lanes; a car that happens to be on that spot (going around something) makes room at once
    for (const o of veh) {
      if (o === slot || o.mode !== 'ai' || o.seg < 0) continue;
      if (boxesTouch(slot.x, slot.z, tx, tz, CAR_HL + SAFE_L, CAR_HW + SAFE_W, o.x, o.z, o.hx, o.hz, CAR_HL + SAFE_L, o.hw + SAFE_W)) vanish(o);
    }
    return slot.i;
  }
  function setRemoteTaxis(list) {
    const n = Math.min(list.length, N_REMOTE);
    for (let k = 0; k < n; k++) { list[k].spin = remoteList[k]?.spin || 0; remoteList[k] = list[k]; }
    remoteList.length = n;
  }
  // The point collide is pushing (colX, colZ) and its radius: pushCar moves it. collide runs a few times a frame, so the
  // car test is one function over these instead of a closure (and an axle array) per call.
  let colX = 0, colZ = 0, colR = 0;
  const AXLES = [1.3, -1.3];
  function pushCar(cx, cz, yaw) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    for (let j = 0; j < AXLES.length; j++) {
      const s = AXLES[j];
      const qx = cx + fx * s, qz = cz + fz * s;
      const dx = colX - qx, dz = colZ - qz, rr = colR + 1.0, d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      colX = qx + (dx / d) * rr;
      colZ = qz + (dz / d) * rr;
    }
  }
  /** Pushes a circle out of every car except the one being driven. */
  function collide(x, z, r) {
    colX = x; colZ = z; colR = r;
    for (const c of veh) {
      if (c.mode === 'off' || c.mode === 'driven' || !there(c)) continue;
      const cx = c.mode === 'ai' ? c.rx : c.x, cz = c.mode === 'ai' ? c.rz : c.z;
      if (Math.abs(cx - colX) > 6 || Math.abs(cz - colZ) > 6) continue;
      pushCar(cx, cz, c.mode === 'ai' ? c.ryaw : c.yaw);
    }
    for (const rc of remoteList) if (Math.abs(rc.x - colX) < 6 && Math.abs(rc.z - colZ) < 6) pushCar(rc.x, rc.z, rc.yaw);
    x = colX; z = colZ;
    for (const p of sigPoles) {
      const dx = x - p.x, dz = z - p.z, rr = r + 0.22, d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      x = p.x + (dx / d) * rr;
      z = p.z + (dz / d) * rr;
    }
    return [x, z];
  }
  function positions() {
    const out = [];
    for (const c of veh) {
      if (c.mode === 'off' || !there(c) || (!c.taxi && c.mode !== 'driven')) continue;
      out.push({ x: c.mode === 'ai' ? c.rx : c.x, z: c.mode === 'ai' ? c.rz : c.z, mode: c.mode });
    }
    return out;
  }

  return {
    update, warm, phase: () => phase,
    nearestTaxi, takeTaxi, driveTaxi, releaseTaxi, callTaxi, setRemoteTaxis, setCabYellow, setCabTint, collide, positions,
  };
}
