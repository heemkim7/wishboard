// Traffic on the real road graph: yellow cabs and cars that keep their lane, stop at the signalized
// intersections (synchronized avenue/street cycle) and keep their distance, spawned around the player.
// Also the player's taxi, taxis called to stands, parked taxis and remote players' taxis.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Kit } from './kit.js';
import { makeCanvas, paintTaxiSign, paintTaxiDecal, paintBeam } from './art.js';
import { GROUND_LAYER } from './ground.js';
import { ROAD } from './nyc.js';

export function signalPhase(t) {
  const c = t % 36;
  if (c < 14) return 'nsG';
  if (c < 17) return 'nsY';
  if (c < 19) return 'red';
  if (c < 31) return 'ewG';
  if (c < 34) return 'ewY';
  return 'red';
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const CAR_COLORS = ['#101114', '#e9eaec', '#8e9399', '#2b2f36', '#1c2b4a', '#6b1b1f', '#c2c5ca', '#3a3f45', '#0f2a24', '#5a5e63'].map(c => new THREE.Color(c));
const VMAX = { [ROAD.MOTORWAY]: 21, [ROAD.PRIMARY]: 12.5, [ROAD.SECONDARY]: 12, [ROAD.TERTIARY]: 10.5, [ROAD.STREET]: 8.5, [ROAD.SERVICE]: 4.5, [ROAD.LINK]: 11 };
const wrap = (a) => ((((a % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI);

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

export function createTraffic({ scene, nyc, kitMats, quality, renderer, onHonk }) {
  const low = quality === 'low';
  const N_TAXI = quality === 'high' ? 34 : quality === 'medium' ? 24 : 14;
  const N_CAR = quality === 'high' ? 34 : quality === 'medium' ? 22 : 12;
  const N_SPECIAL = 8, N_REMOTE = 8;
  const N_AI = N_TAXI + N_CAR;
  const SPAWN_R = low ? 260 : 380, DROP_R = SPAWN_R + 90;
  const R = nyc.roads, G = nyc.graph;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const junctionR = new Float32Array(G.nodeX.length);
  for (let nd = 0; nd < G.nodeX.length; nd++) {
    let w = 0;
    for (const e of G.nodeAdj[nd]) w = Math.max(w, R.width[e.road]);
    junctionR[nd] = G.nodeAdj[nd].length >= 3 ? w / 2 : 0;
  }
  const carRoad = (r) => R.cls[r] !== ROAD.PEDESTRIAN && R.cls[r] !== ROAD.SERVICE;

  // ---- vehicles -----------------------------------------------------------------------------------------
  // slots: [0, N_TAXI) AI cabs · [N_TAXI, N_AI) AI cars · [N_AI, +N_SPECIAL) called/parked cabs · then remote cabs
  const total = N_AI + N_SPECIAL + N_REMOTE;
  const veh = [];
  for (let i = 0; i < total; i++) {
    const taxi = i < N_TAXI || i >= N_AI;
    veh.push({
      i, taxi, mode: i < N_AI ? 'ai' : 'off', seg: -1, dir: 1, s: 0, lane: i % 3, off: 0, v: 0, vmax: 9, f: 0.85 + ((i * 37) % 30) / 100,
      x: 0, z: 1e6, y: 0, yaw: 0, rx: 0, rz: 1e6, ryaw: 0, spin: 0, honk: 0, parkedAt: 0, color: CAR_COLORS[(i * 7) % CAR_COLORS.length],
    });
  }
  const remoteList = [];

  const kits = vehicleKits();
  const paintTaxi = new THREE.MeshPhysicalMaterial({ color: 0xffc21a, roughness: 0.32, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });
  const paintCar = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.1 });
  const toTex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t; };
  const signGeo = (() => {
    const g = [];
    for (const s of [1, -1]) {
      const p = new THREE.PlaneGeometry(0.9, 0.24);
      p.rotateY(s > 0 ? 0 : Math.PI);
      p.translate(0, 1.66, -0.3 + s * 0.11);
      g.push(p);
    }
    const cap = new THREE.BoxGeometry(0.95, 0.28, 0.2).toNonIndexed().translate(0, 1.66, -0.3);
    g.push(cap);
    return mergeGeometries(g.map(x => { const n = x.index ? x.toNonIndexed() : x; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); return n; }), false);
  })();
  const decalGeo = (() => {
    const g = [];
    for (const s of [1, -1]) {
      const p = new THREE.PlaneGeometry(3.4, 0.42);
      p.rotateY(s * Math.PI / 2);
      p.translate(s * 0.95, 0.66, 0.05);
      g.push(p);
    }
    return mergeGeometries(g, false);
  })();
  const nTaxiSlots = N_TAXI + N_SPECIAL + N_REMOTE;
  const mk = (geo, mat, count) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.frustumCulled = false;
    m.count = count;
    scene.add(m);
    return m;
  };
  const taxiParts = [
    mk(kits.taxi.get('paint'), paintTaxi, nTaxiSlots),
    mk(kits.taxi.get('gloss'), kitMats.gloss, nTaxiSlots),
    mk(kits.taxi.get('metal'), kitMats.metal, nTaxiSlots),
    mk(kits.taxi.get('glow'), kitMats.glow, nTaxiSlots),
    mk(signGeo, new THREE.MeshBasicMaterial({ map: toTex(paintTaxiSign(makeCanvas(256, 64))), color: new THREE.Color(1.3, 1.3, 1.2) }), nTaxiSlots),
    mk(decalGeo, new THREE.MeshBasicMaterial({ map: toTex(paintTaxiDecal(makeCanvas(1024, 128))), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), nTaxiSlots),
  ];
  const carParts = [
    mk(kits.car.get('paint'), paintCar, N_CAR),
    mk(kits.car.get('gloss'), kitMats.gloss, N_CAR),
    mk(kits.car.get('metal'), kitMats.metal, N_CAR),
    mk(kits.car.get('glow'), kitMats.glow, N_CAR),
  ];
  for (let k = 0; k < N_CAR; k++) carParts[0].setColorAt(k, veh[N_TAXI + k].color);
  carParts[0].instanceColor.needsUpdate = true;
  const wheels = mk(kits.wheel, kitMats.metal, total * 4);
  const beamTex = new THREE.CanvasTexture(paintBeam(makeCanvas(64, 256)));
  const beams = mk(new THREE.PlaneGeometry(2.8, 9).rotateX(-Math.PI / 2).translate(0, 0.05, 6.7), new THREE.MeshBasicMaterial({ map: beamTex, color: new THREE.Color(0.5, 0.46, 0.38), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), total);
  beams.layers.set(GROUND_LAYER);
  const slotOf = (i) => (i < N_TAXI ? { parts: taxiParts, k: i } : i < N_AI ? { parts: carParts, k: i - N_TAXI } : { parts: taxiParts, k: i - N_AI + N_TAXI });
  const WHEELS = [[-0.86, 1.45], [0.86, 1.45], [-0.86, -1.45], [0.86, -1.45]];
  const tq = new THREE.Quaternion(), wq = new THREE.Quaternion(), tm = new THREE.Matrix4(), wm = new THREE.Matrix4();
  const tv = new THREE.Vector3(), wv = new THREE.Vector3(), XA = new THREE.Vector3(1, 0, 0);
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  function place(i, x, z, yaw, spin, y = 0) {
    const { parts, k } = slotOf(i);
    tq.setFromAxisAngle(Y_AXIS, yaw);
    tm.compose(tv.set(x, y, z), tq, ONE);
    for (const p of parts) p.setMatrixAt(k, tm);
    beams.setMatrixAt(i, tm);
    wq.setFromAxisAngle(XA, spin);
    for (let w = 0; w < 4; w++) {
      wm.compose(wv.set(WHEELS[w][0], 0.34, WHEELS[w][1]), wq, ONE).premultiply(tm);
      wheels.setMatrixAt(i * 4 + w, wm);
    }
  }
  function hide(i) {
    const { parts, k } = slotOf(i);
    for (const p of parts) p.setMatrixAt(k, ZERO);
    beams.setMatrixAt(i, ZERO);
    for (let w = 0; w < 4; w++) wheels.setMatrixAt(i * 4 + w, ZERO);
  }

  // ---- lane geometry ----------------------------------------------------------------------------------------
  function segEnds(c) {
    const p = c.seg;
    const a = c.dir > 0 ? p : p + 1, b = c.dir > 0 ? p + 1 : p;
    return [R.xs[a], R.zs[a], R.xs[b], R.zs[b]];
  }
  function laneOffset(c) {
    const r = R.segRoad[c.seg];
    const w = R.width[r], lanes = Math.max(1, R.lanes[r]);
    const usable = Math.max(2.6, w - 2.4);
    if (R.oneway[r]) {
      const k = c.lane % lanes;
      return -usable / 2 + (k + 0.5) * usable / lanes;
    }
    const per = Math.max(1, lanes >> 1);
    const k = c.lane % per;
    return (k + 0.5) * (usable / 2) / per;
  }
  function pose(c) {
    const [ax, az, bx, bz] = segEnds(c);
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
    const fx = dx / L, fz = dz / L;
    c.L = L; c.fx = fx; c.fz = fz;
    c.x = ax + fx * c.s - fz * c.off;
    c.z = az + fz * c.s + fx * c.off;
    c.yaw = Math.atan2(fx, fz);
    c.endNode = G.nodeAt(bx, bz);
  }

  function spawn(c, px, pz, minD = 90) {
    for (let tries = 0; tries < 24; tries++) {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (SPAWN_R - minD);
      const hit = nyc.nearestRoad(px + Math.cos(a) * d, pz + Math.sin(a) * d, 40, carRoad);
      if (!hit) continue;
      const r = hit.road;
      const one = R.oneway[r];
      c.seg = hit.seg;
      c.dir = one ? 1 : Math.random() < 0.5 ? 1 : -1;
      const [ax, az, bx, bz] = segEnds(c);
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 6) continue;
      c.s = Math.random() * L;
      c.lane = (Math.random() * 4) | 0;
      c.off = laneOffset(c);
      pose(c);
      let clash = false;
      for (const o of veh) if (o !== c && o.mode !== 'off' && Math.abs(o.x - c.x) < 9 && Math.abs(o.z - c.z) < 9) { clash = true; break; }
      if (clash) continue;
      c.vmax = (VMAX[R.cls[r]] ?? 9) * c.f;
      c.v = c.vmax * 0.6;
      c.rx = c.x; c.rz = c.z; c.ryaw = c.yaw;
      c.mode = 'ai';
      return true;
    }
    c.mode = 'ai';
    c.seg = -1;
    return false;
  }
  function nextSegment(c) {
    const node = c.endNode;
    const curSeg = c.seg;
    const opts = [];
    if (node != null) {
      for (const e of G.nodeAdj[node]) {
        if (e.seg === curSeg || !G.canGo(e) || R.cls[e.road] === ROAD.SERVICE) continue;
        const ax = G.nodeX[node], az = G.nodeZ[node], bx = G.nodeX[e.to], bz = G.nodeZ[e.to];
        const L = Math.hypot(bx - ax, bz - az) || 1;
        const dot = ((bx - ax) * c.fx + (bz - az) * c.fz) / L;
        if (dot < -0.5) continue;
        const wgt = dot > 0.85 ? 1 : dot > -0.2 ? 0.32 : 0.08;
        opts.push({ e, wgt });
      }
    }
    if (!opts.length) return false;
    let pick = Math.random() * opts.reduce((a, o) => a + o.wgt, 0);
    let ch = opts[0].e;
    for (const o of opts) { pick -= o.wgt; if (pick <= 0) { ch = o.e; break; } }
    c.s -= c.L;
    c.seg = ch.seg;
    c.dir = ch.dir;
    c.off = laneOffset(c);
    c.vmax = (VMAX[R.cls[ch.road]] ?? 9) * c.f;
    pose(c);
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
      const jr = junctionR[nd];
      for (const e of G.nodeAdj[nd]) {
        const r = e.road;
        if (R.cls[r] > ROAD.STREET) continue;
        if (R.oneway[r] && e.dir !== -1) continue;
        const ux = G.nodeX[e.to] - nx, uz = G.nodeZ[e.to] - nz, L = Math.hypot(ux, uz) || 1;
        const dx = -ux / L, dz = -uz / L;
        const rx = -dz, rz = dx;
        const w = R.width[r];
        const x = nx + dx * (jr + 1.6) + rx * (w / 2 + 0.9), z = nz + dz * (jr + 1.6) + rz * (w / 2 + 0.9);
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
  function paintSignals() {
    const ON = 3.4, OFF = 0.05;
    const light = (grp, green, yellow) => {
      sigMats[grp + 'Green'].color.copy(BASE.Green).multiplyScalar(green ? ON : OFF);
      sigMats[grp + 'Yellow'].color.copy(BASE.Yellow).multiplyScalar(yellow ? ON : OFF);
      sigMats[grp + 'Red'].color.copy(BASE.Red).multiplyScalar(!green && !yellow ? ON : OFF);
    };
    light('ns', phase === 'nsG', phase === 'nsY');
    light('ew', phase === 'ewG', phase === 'ewY');
  }

  // ---- simulation ----------------------------------------------------------------------------------------------
  let clockT = 0;
  const others = [];
  function update(dt, t, player) {
    clockT = t;
    phase = signalPhase(t);
    paintSignals();
    const px = player?.x ?? 0, pz = player?.z ?? 0;
    if (Math.hypot(px - sigAt.x, pz - sigAt.z) > 70) rebuildSignals(px, pz);
    others.length = 0;
    for (const o of veh) if (o.mode !== 'off') others.push(o);
    for (const r of remoteList) others.push(r);
    for (const c of veh) {
      if (c.mode === 'driven') {
        c.spin += c.v * dt / 0.34;
        place(c.i, c.x, c.z, c.yaw, c.spin, c.y || 0);
        continue;
      }
      if (c.mode === 'parked') {
        place(c.i, c.x, c.z, c.yaw, c.spin);
        const far = Math.hypot(px - c.x, pz - c.z) > DROP_R;
        if (far && t - c.parkedAt > 20) { if (c.i < N_AI) spawn(c, px, pz); else { c.mode = 'off'; hide(c.i); } }
        continue;
      }
      if (c.mode === 'off') { hide(c.i); continue; }
      if (c.seg < 0 || Math.hypot(px - c.x, pz - c.z) > DROP_R) {
        spawn(c, px, pz, c.seg < 0 ? 40 : 140);
        if (c.seg < 0) { hide(c.i); continue; }
      }
      let target = c.vmax;
      // signal ahead
      const node = c.endNode;
      if (node != null && G.nodeSignal[node]) {
        const axis = Math.abs(c.fz) > Math.abs(c.fx) ? 'ns' : 'ew';
        const green = phase === axis + 'G', yellow = phase === axis + 'Y';
        const stopAt = c.L - (junctionR[node] + 4.6);
        const d = stopAt - c.s;
        if (!green && d > (yellow ? 6 : -0.6) && d < 40) target = Math.min(target, Math.max(0, d - 0.4) * 0.85);
      }
      // keep distance to whatever is ahead in the lane (cars, parked cabs, remote cabs, the player)
      const rx = -c.fz, rz = c.fx;
      for (const o of others) {
        if (o === c) continue;
        const dx = o.x - c.x, dz = o.z - c.z;
        if (dx > 24 || dx < -24 || dz > 24 || dz < -24) continue;
        const along = dx * c.fx + dz * c.fz, lat = Math.abs(dx * rx + dz * rz);
        if (along > 0 && along < 22 && lat < 1.9) target = Math.min(target, Math.max(0, along - 6.6) * 1.1);
      }
      if (player) {
        const dx = px - c.x, dz = pz - c.z;
        const along = dx * c.fx + dz * c.fz, lat = Math.abs(dx * rx + dz * rz);
        if (along > 0 && along < (player.driving ? 22 : 12) && lat < (player.driving ? 2 : 1.6)) {
          target = Math.min(target, Math.max(0, along - (player.driving ? 6.6 : 3.6)) * 0.9);
          if (along < 8 && c.v > 1.5 && t - c.honk > 4) { c.honk = t; onHonk?.(); }
        }
      }
      const k = target < c.v ? 5 : 1.2;
      c.v += (target - c.v) * (1 - Math.exp(-dt * k));
      c.s += c.v * dt;
      let guard = 0;
      while (c.s > c.L && guard++ < 4) {
        if (!nextSegment(c)) { c.v = 0; c.s = c.L; c.dir = -c.dir; c.s = 0; c.off = laneOffset(c); pose(c); break; }
      }
      pose(c);
      const kk = 1 - Math.exp(-dt * 9);
      if (Math.hypot(c.x - c.rx, c.z - c.rz) > 12) { c.rx = c.x; c.rz = c.z; c.ryaw = c.yaw; }
      c.rx += (c.x - c.rx) * kk;
      c.rz += (c.z - c.rz) * kk;
      c.ryaw += wrap(c.yaw - c.ryaw) * (1 - Math.exp(-dt * 7));
      c.spin += c.v * dt / 0.34;
      place(c.i, c.rx, c.rz, c.ryaw, c.spin);
    }
    for (let k = 0; k < N_REMOTE; k++) {
      const rc = remoteList[k];
      const i = N_AI + N_SPECIAL + k;
      if (!rc) { hide(i); continue; }
      rc.spin = (rc.spin || 0) + (rc.v || 0) * dt / 0.34;
      place(i, rc.x, rc.z, rc.yaw, rc.spin);
    }
    for (const p of [...taxiParts, ...carParts]) p.instanceMatrix.needsUpdate = true;
    wheels.instanceMatrix.needsUpdate = true;
    beams.instanceMatrix.needsUpdate = true;
  }
  function warm(px, pz) {
    rebuildSignals(px, pz);
    for (let i = 0; i < N_AI; i++) spawn(veh[i], px, pz, 25);
  }

  // ---- player-facing API ---------------------------------------------------------------------------------------------
  function nearestTaxi(x, z, maxD = 4.6) {
    let best = null;
    for (const c of veh) {
      if (!c.taxi || (c.mode !== 'ai' && c.mode !== 'parked')) continue;
      const cx = c.mode === 'ai' ? c.rx : c.x, cz = c.mode === 'ai' ? c.rz : c.z;
      const d = Math.hypot(cx - x, cz - z);
      if (d < (c.mode === 'parked' ? maxD + 1.6 : maxD) && (!best || d < best.d)) best = { i: c.i, d };
    }
    return best;
  }
  function takeTaxi(i) {
    const c = veh[i];
    if (!c || !c.taxi || c.mode === 'driven' || c.mode === 'off') return null;
    if (c.mode === 'ai') { c.x = c.rx; c.z = c.rz; c.yaw = c.ryaw; }
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
    const hit = nyc.nearestRoad(stand.x, stand.z, 30, carRoad);
    if (!hit) return -1;
    const r = hit.road;
    const w = R.width[r];
    const sx = stand.x - hit.px, sz = stand.z - hit.pz;
    const side = sx * -hit.fz + sz * hit.fx >= 0 ? 1 : -1;
    const dir = R.oneway[r] ? 1 : side;
    const tx = hit.fx * dir, tz = hit.fz * dir;
    const right = (sx * -tz + sz * tx) >= 0 ? 1 : -1;
    const off = (w / 2 - 1.2) * right;
    let slot = veh.find(c => c.i >= N_AI && c.i < N_AI + N_SPECIAL && c.mode === 'off');
    if (!slot) slot = veh.filter(c => c.i >= N_AI && c.i < N_AI + N_SPECIAL && c.mode === 'parked').sort((a, b) => a.parkedAt - b.parkedAt)[0];
    if (!slot) return -1;
    slot.x = hit.px + -tz * off;
    slot.z = hit.pz + tx * off;
    slot.yaw = Math.atan2(tx, tz);
    slot.v = 0;
    slot.mode = 'parked';
    slot.parkedAt = clockT;
    for (const o of veh) {
      if (o === slot || o.mode !== 'ai') continue;
      if (Math.hypot(o.rx - slot.x, o.rz - slot.z) < 7) { o.seg = -1; }
    }
    return slot.i;
  }
  function setRemoteTaxis(list) {
    const n = Math.min(list.length, N_REMOTE);
    for (let k = 0; k < n; k++) { list[k].spin = remoteList[k]?.spin || 0; remoteList[k] = list[k]; }
    remoteList.length = n;
  }
  /** Pushes a circle out of every car except the one being driven. */
  function collide(x, z, r) {
    const test = (cx, cz, yaw) => {
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      for (const s of [1.3, -1.3]) {
        const qx = cx + fx * s, qz = cz + fz * s;
        const dx = x - qx, dz = z - qz, rr = r + 1.0, d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        x = qx + (dx / d) * rr;
        z = qz + (dz / d) * rr;
      }
    };
    for (const c of veh) {
      if (c.mode === 'off' || c.mode === 'driven') continue;
      const cx = c.mode === 'ai' ? c.rx : c.x, cz = c.mode === 'ai' ? c.rz : c.z;
      if (Math.abs(cx - x) > 6 || Math.abs(cz - z) > 6) continue;
      test(cx, cz, c.mode === 'ai' ? c.ryaw : c.yaw);
    }
    for (const rc of remoteList) if (Math.abs(rc.x - x) < 6 && Math.abs(rc.z - z) < 6) test(rc.x, rc.z, rc.yaw);
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
      if (c.mode === 'off' || (!c.taxi && c.mode !== 'driven')) continue;
      out.push({ x: c.mode === 'ai' ? c.rx : c.x, z: c.mode === 'ai' ? c.rz : c.z, mode: c.mode });
    }
    return out;
  }

  return {
    update, warm, phase: () => phase,
    nearestTaxi, takeTaxi, driveTaxi, releaseTaxi, callTaxi, setRemoteTaxis, collide, positions,
  };
}
