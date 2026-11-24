// The street as it is drawn (ts3d/traffic.js): cars in their lanes, queues with gaps, nothing through the lots.
//
// 2026-11-24: on a phone by lot 18 a pile of taxis stood in one spot at the W 41st St light, one drawn inside another.
// The second car of a queue counted itself stuck behind the first (only the first knew it was at a light), stepped
// 2.2 m sideways, drove up beside it and was put back into the lane 3.2 s later: on top of it. The same code turned a
// car round on the spot at the dance floor and at a street's end, against the one-way traffic behind it.
//
// These tests run createTraffic without WebGL for simulated minutes and read every vehicle's pose back from the
// instance matrices (one per vehicle on the headlight-beam mesh), so what they check is what a player sees.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { registerHooks } from 'node:module';
import { describe, it, before } from 'node:test';

const VENDOR = new URL('../vendor/three/', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'three') return { url: VENDOR + 'build/three.module.js', shortCircuit: true };
    if (specifier.startsWith('three/addons/')) return { url: VENDOR + 'examples/jsm/' + specifier.slice(13), shortCircuit: true };
    return next(specifier, context);
  },
});
// A canvas that remembers what was painted on it: [kind, text or '', x, y, w, h, fillStyle, font, textAlign].
function canvasStub() {
  const drawn = [];
  const ctx = {
    fillStyle: '', font: '', textAlign: 'left', textBaseline: 'alphabetic', globalCompositeOperation: 'source-over',
    fillRect(x, y, w, h) { drawn.push({ kind: 'rect', x, y, w, h, fill: this.fillStyle }); },
    clearRect() {},
    measureText(s) { return { width: String(s).length * parseFloat(this.font.split(' ')[1]) * 0.62 }; }, // a wide guess for a heavy sans
    fillText(s, x, y) { drawn.push({ kind: 'text', s, x, y, w: this.measureText(s).width, fill: this.fillStyle, font: this.font, align: this.textAlign }); },
    createLinearGradient() { return { addColorStop() {} }; },
  };
  return { width: 0, height: 0, style: {}, drawn, getContext: () => ctx };
}
globalThis.document ||= { createElement: () => canvasStub() };

const THREE = await import('three');
const { createNYC, ROAD } = await import('../ts3d/nyc.js');
const { kitMaterials } = await import('../ts3d/kit.js');
const { createTraffic, signalPhase, RULES, taxiTextureTier } = await import('../ts3d/traffic.js');
const { paintTaxiDecal, paintTaxiSign, TAXI_DECAL } = await import('../ts3d/art.js');
const { LAYOUT, PLOT_SLOTS, TAXI_STANDS } = await import('../ts3d/layout.js');
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const MAP = new URL('../assets/nyc/manhattan.bin', import.meta.url);
const haveMap = existsSync(MAP);
const needsMap = { skip: haveMap ? false : 'assets/nyc/manhattan.bin missing' };
let nyc = null;
const city = () => (nyc ||= createNYC(new Uint8Array(gunzipSync(readFileSync(MAP)))));

// ---- the rig ------------------------------------------------------------------------------------------------------
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const HL = RULES.len / 2, HW = RULES.wid / 2;
const wrap = (a) => ((((a % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
const deg = Math.PI / 180;
function corners(c) {
  const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), rx = -fz, rz = fx;
  return [[c.x + fx * HL + rx * HW, c.z + fz * HL + rz * HW], [c.x + fx * HL - rx * HW, c.z + fz * HL - rz * HW], [c.x - fx * HL - rx * HW, c.z - fz * HL - rz * HW], [c.x - fx * HL + rx * HW, c.z - fz * HL + rz * HW]];
}
/** Do the bodies of two drawn cars (4.82 x 1.98 m boxes) overlap? */
function overlap(a, b) {
  if (Math.abs(a.x - b.x) > 8 || Math.abs(a.z - b.z) > 8) return false;
  const A = corners(a), B = corners(b);
  for (const P of [A, B]) for (let i = 0; i < 2; i++) {
    const nx = P[i + 1][1] - P[i][1], nz = -(P[i + 1][0] - P[i][0]);
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const q of A) { const d = q[0] * nx + q[1] * nz; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const q of B) { const d = q[0] * nx + q[1] * nz; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 <= b0 || b1 <= a0) return false;
  }
  return true;
}
// What the game built on the map: nobody drives here.
const BUILT = [{ n: 'the stage', x0: LAYOUT.stage.x0 - 1, x1: LAYOUT.stage.x1 + 1, z0: LAYOUT.stage.z0 - 3.4, z1: LAYOUT.stage.z1 + 1 },
  ...PLOT_SLOTS.map((s) => ({ n: 'lot ' + s.id, x0: s.x - 4.2, x1: s.x + 4.2, z0: s.z - 3.6, z1: s.z + 3.6 }))];
const builtAt = (c) => BUILT.find((q) => c.x > q.x0 && c.x < q.x1 && c.z > q.z0 && c.z < q.z1)?.n || '';

function world(quality, seed) {
  Math.random = seeded(seed);
  const added = [], honks = { n: 0 };
  const traffic = createTraffic({ scene: { add(...o) { added.push(...o); } }, nyc: city(), kitMats: kitMaterials(), quality, renderer: { capabilities: { getMaxAnisotropy: () => 16 } }, onHonk() { honks.n++; } });
  const inst = added.filter((o) => o.isInstancedMesh);
  const wheels = inst.reduce((a, b) => (b.count > a.count ? b : a));
  const beams = inst.find((o) => o.count * 4 === wheels.count); // one matrix per vehicle: its drawn pose
  const nAI = beams.count - 16; // then 8 called / parked cabs and 8 remote players' cabs
  return { traffic, inst, wheels, beams, nAI, honks };
}
// Every car-road segment whose roadway the point is on.
function roadsAt(x, z) {
  const R = nyc.roads, out = [], seen = new Set();
  for (let k = 0; k < 6; k++) {
    const hit = nyc.nearestRoad(x, z, 14, (r, p) => R.cls[r] !== ROAD.PEDESTRIAN && R.cls[r] !== ROAD.SERVICE && !seen.has(p));
    if (!hit) break;
    seen.add(hit.seg);
    if (hit.d <= R.width[hit.road] / 2 + 0.5) out.push(hit);
  }
  return out;
}

// A car standing in a corner faces somewhere between the lane it came along and the lane it is turning into. How far
// (radians) the car's heading is outside every such turn at the nodes within 9 m of it: a legal way in, a legal way
// out, the short way round. (0 on a lane or partway round a turn; a car facing back up a one-way street is not.)
function cornerOff(c) {
  const R = nyc.roads, G = nyc.graph, car = (r) => R.cls[r] !== ROAD.PEDESTRIAN && R.cls[r] !== ROAD.SERVICE;
  let best = Math.PI;
  const hit = nyc.nearestRoad(c.x, c.z, 14, car);
  if (!hit) return best;
  for (const p of [hit.seg, hit.seg + 1]) {
    const n = G.nodeAt(R.xs[p], R.zs[p]);
    if (n == null || Math.hypot(G.nodeX[n] - c.x, G.nodeZ[n] - c.z) > 16) continue;
    const dirOf = (e) => Math.atan2(G.nodeX[e.to] - G.nodeX[n], G.nodeZ[e.to] - G.nodeZ[n]);
    for (const i of G.nodeAdj[n]) {
      if (!car(i.road) || (R.oneway[i.road] && i.dir !== -1)) continue; // a lane arriving along this edge
      const from = dirOf(i) + Math.PI;
      for (const o of G.nodeAdj[n]) {
        if (o === i || !car(o.road) || !G.canGo(o)) continue;
        const turn = wrap(dirOf(o) - from), at = wrap(c.yaw - from);
        const out = turn >= 0 ? Math.max(0, -at, at - turn) : Math.max(0, at, turn - at);
        if (out < best) best = out;
      }
    }
  }
  return best;
}

/**
 * Runs the street and checks what is drawn after every step. `script(W, t, player, dt)` is the scenario; it may
 * return { dt, jump } for one odd frame (a tab coming back). Returns what went wrong (first few of each kind) and
 * what was seen.
 */
function watch({ quality = 'low', seed, player, minutes, fps = 30, script = null, each = null }) {
  const W = world(quality, seed), R = nyc.roads, dt = 1 / fps;
  W.traffic.warm(player.x, player.z);
  const bad = { overlap: [], built: [], wrongWay: [], askew: [], sideways: [], gap: [], popped: [], cameIn: [] };
  const note = (k, s) => { bad[k].n = (bad[k].n || 0) + 1; if (bad[k].length < 3) bad[k].push(s); };
  const seen = { stillMax: 0, gapMin: Infinity, moved: 0, carSteps: 0, steps: 0 };
  const prev = new Map();
  const f = (c) => `#${c.i} (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) yaw ${(c.yaw / deg).toFixed(0)} size ${c.size.toFixed(2)}`;
  let t = 0;
  for (let k = 0; k < minutes * 60 * fps; k++) {
    const ev = (script && script(W, t, player, dt)) || {};
    t += ev.jump || ev.dt || dt;
    W.traffic.update(ev.dt || dt, t, player);
    const m = W.beams.instanceMatrix.array, cs = [];
    for (let i = 0; i < W.beams.count; i++) {
      const o = i * 16, size = Math.hypot(m[o + 8], m[o + 10]);
      assert.ok(Number.isFinite(m[o + 12] + m[o + 14] + size), 'a finite matrix for vehicle ' + i);
      let p = prev.get(i);
      if (size < 0.02) {
        // gone: an AI car near the player leaves by shrinking, not at full size
        if (p && i < W.nAI && p.size > 0.5 && Math.hypot(p.x - player.x, p.z - player.z) < 200) note('popped', `t=${t.toFixed(1)} ${f(p)}`);
        prev.delete(i);
        continue;
      }
      const c = { i, ai: i < W.nAI, x: m[o + 12], z: m[o + 14], yaw: Math.atan2(m[o + 8], m[o + 10]), size };
      if (p && Math.hypot(c.x - p.x, c.z - p.z) > 6) { if (c.ai && p.size > 0.5 && Math.hypot(p.x - player.x, p.z - player.z) < 200) note('popped', `t=${t.toFixed(1)} ${f(p)}`); p = null; } // the slot came back somewhere else
      if (!p && c.ai && k > 0 && c.size > 0.5) note('cameIn', `t=${t.toFixed(1)} ${f(c)}`); // a new car grows from nothing
      c.vx = p ? (c.x - p.x) / dt : 0; c.vz = p ? (c.z - p.z) / dt : 0; c.speed = Math.hypot(c.vx, c.vz);
      c.still = p && c.speed < 0.05 ? p.still + dt : 0;
      c.age = p ? p.age + dt : 0;
      prev.set(i, c);
      cs.push(c);
    }
    seen.steps++;
    for (let a = 0; a < cs.length; a++) {
      const c = cs[a];
      if (c.ai) {
        seen.carSteps++; seen.moved += c.speed * dt;
        if (c.still > seen.stillMax) seen.stillMax = c.still;
        const where = builtAt(c);
        if (where) note('built', `t=${t.toFixed(1)} in ${where}: ${f(c)}`);
        if (c.still > 2 || (c.speed > 2 && c.age > 1)) {
          const roads = roadsAt(c.x, c.z);
          if (c.still > 2) {
            // at rest: along a lane of a road here (the legal way on a one-way), or partway round a corner from one
            // lane into another (see cornerOff)
            let off = Math.PI;
            for (const h of roads) { const ly = Math.atan2(h.fx, h.fz); off = Math.min(off, Math.abs(wrap(c.yaw - ly)), R.oneway[h.road] ? Math.PI : Math.abs(wrap(c.yaw - ly - Math.PI))); }
            if (off > 0.05) off = cornerOff(c);
            if (off > 0.05) note('askew', `t=${t.toFixed(1)} ${(off / deg).toFixed(0)} deg off any lane: ${f(c)}`);
          } else {
            // moving: not against a one-way, and nose first
            let legal = !roads.length;
            for (const h of roads) { const d = (c.vx * h.fx + c.vz * h.fz) / c.speed; if (d > -0.3 || !R.oneway[h.road]) legal = true; }
            if (!legal) note('wrongWay', `t=${t.toFixed(1)} ${f(c)} on ${roads.map((h) => nyc.roadName(h.road)).join(' / ')}`);
            const slip = Math.abs(wrap(Math.atan2(c.vx, c.vz) - c.yaw));
            if (slip > 0.75) note('sideways', `t=${t.toFixed(1)} moving ${(slip / deg).toFixed(0)} deg off its nose: ${f(c)}`);
          }
        }
      }
      for (let b = a + 1; b < cs.length; b++) {
        const o = cs[b];
        if (overlap(c, o)) note('overlap', `t=${t.toFixed(2)} ${f(c)} and ${f(o)}`);
        else if (c.ai && o.ai && c.still > 1.5 && o.still > 1.5 && Math.abs(wrap(c.yaw - o.yaw)) < 0.05) {
          // two cars at rest one behind the other: the gap between their bumpers
          const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), dx = o.x - c.x, dz = o.z - c.z;
          if (Math.abs(dz * fx - dx * fz) < 1.2) { const g = Math.abs(dx * fx + dz * fz) - RULES.len; if (g < seen.gapMin) seen.gapMin = g; if (g < RULES.gap - 0.3) note('gap', `t=${t.toFixed(1)} ${g.toFixed(2)} m between ${f(c)} and ${f(o)}`); }
        }
      }
    }
    if (each) each(cs, t, W);
  }
  seen.speed = seen.moved / (seen.carSteps * dt);
  return { bad, seen, W };
}
const clean = (r, kinds = Object.keys(r.bad)) => { for (const k of kinds) assert.equal(r.bad[k].n || 0, 0, `${k}: ${r.bad[k].join(' | ')}`); };
// Counts the cars that get from 6 m behind (x, z) to 6 m past it, going along (fx, fz) within `wide` of it.
function passes(x, z, fx, fz, wide = 9) {
  const side = new Map();
  const p = { n: 0, tick(cs) { for (const c of cs) { if (!c.ai) continue; const a = (c.x - x) * fx + (c.z - z) * fz, l = Math.abs((c.z - z) * fx - (c.x - x) * fz); if (l > wide || Math.abs(a) > 40) { side.delete(c.i); continue; } const s = a < -6 ? -1 : a > 6 ? 1 : 0; if (s === 1 && side.get(c.i) === -1) p.n++; if (s) side.set(c.i, s); } } };
  return p;
}
// A cab left at (x, z, yaw) the way a player leaves one: called at a stand, taken, driven there, got out of.
function leaveCab(W, stand, x, z, yaw) {
  const i = W.traffic.callTaxi(stand);
  assert.ok(W.traffic.takeTaxi(i));
  W.traffic.driveTaxi(i, x, z, yaw, 0);
  W.traffic.releaseTaxi(i, x, z, yaw);
  return i;
}
const onFoot = (x, z) => ({ x, y: 0, z, yaw: 0, driving: false });

// ---- the rules -------------------------------------------------------------------------------------------------------
describe('the rules of the street', () => {
  it('the light: 14 s avenues, 3 s amber, 2 s all red, 12 s streets, 3 s amber, 2 s all red', () => {
    const run = [];
    for (let t = 0; t < 72; t += 0.5) { const p = signalPhase(t); if (run.at(-1)?.[0] !== p) run.push([p, 0]); run.at(-1)[1] += 0.5; }
    assert.deepEqual(run, [['nsG', 14], ['nsY', 3], ['red', 2], ['ewG', 12], ['ewY', 3], ['red', 2], ['nsG', 14], ['nsY', 3], ['red', 2], ['ewG', 12], ['ewY', 3], ['red', 2]]);
  });
  it('a car is 4.82 x 1.98 m; a queue keeps 1.8 m; the nose stops short of the painted stop line', () => {
    assert.equal(RULES.len, 4.82); assert.equal(RULES.wid, 1.98); assert.equal(RULES.gap, 1.8);
    // world.js paints the stop line 4.9 to 4.45 m before the junction's edge (the crosswalk is the 3.4 m after it)
    const w = read('ts3d/world.js');
    assert.match(w, /const s0 = end \? L - jr - 0\.6 - 3\.4 : jr \+ 0\.6, s1 = s0 \+ 3\.4;/);
    assert.match(w, /const sl = end \? s0 - 0\.9 : s1 \+ 0\.45;/);
    const nose = RULES.stopBack - RULES.len / 2;
    assert.ok(nose >= 4.9 + 0.3 && nose < 4.9 + 1, `the nose stops ${(nose - 4.9).toFixed(2)} m before the line`);
    // the car that was the pile: 4.6 m + 0.4 m back, its nose 2.6 m from the junction's edge, on the crosswalk
    assert.ok(4.6 + 0.4 - RULES.len / 2 < 4.0);
    assert.ok(RULES.stuckS >= 10 && RULES.stuckS <= 20 && RULES.idleS > 36 * 2 && RULES.fadeS > 0.2 && RULES.fadeS < 1);
    assert.ok(RULES.gapParked > RULES.gap * 3 && RULES.gapWalker > RULES.gap);
  });
  it('the rule that made the pile is gone: no sideways hop, no turning round on the spot', () => {
    const t = read('ts3d/traffic.js');
    assert.equal(/c\.bias|biasFor|corked|c\.uturn|onStage/.test(t), false);
    assert.equal(/c\.dir = -c\.dir/.test(t), false);
    // every step an AI car takes goes through the hard rule
    assert.match(t, /if \(\(ds <= 0 && c\.steer === osteer\) \|\| !bumps\(c, ox, oz, hx, hz, ohw\)\) break;/);
  });
});

// ---- the street ---------------------------------------------------------------------------------------------------
describe('ten minutes by lot 18 on a phone (where the pile was)', needsMap, () => {
  // W 41st St runs west between the lot rows to its light at 7th Avenue: (-2.5, 334.9), the junction 7 m in radius.
  const LIGHT = { x: -2.5, z: 334.9, r: 7 };
  let r = null;
  const queues = [], onSeventh = [], onW41 = { n: 0 };
  before(() => {
    city();
    r = watch({ seed: 14, player: onFoot(8, 337), minutes: 10, each(cs) {
      const q = cs.filter((c) => c.ai && c.still > 1.5 && Math.abs(c.z - LIGHT.z) < 3.5 && c.x > LIGHT.x + LIGHT.r && c.x < LIGHT.x + 50).sort((a, b) => a.x - b.x);
      if (q.length >= 2) queues.push(q.map((c) => ({ x: c.x, z: c.z, yaw: c.yaw })));
      for (const c of cs) {
        if (!c.ai) continue;
        if (Math.abs(c.x + 2) < 8 && c.z > 262 && c.z < 404 && Math.abs(c.z - LIGHT.z) > 6) onSeventh.push(c); // (W 41st St crosses it at the light)
        if (Math.abs(c.z - LIGHT.z) < 3 && Math.abs(c.x) < 60) onW41.n++;
      }
    } });
  });
  it('no two cars are ever drawn overlapping', () => clean(r, ['overlap']));
  it('nobody drives through a lot or the dance floor, or on 7th Avenue between them', () => {
    clean(r, ['built']);
    assert.equal(onSeventh.length, 0, onSeventh[0] && `a car at (${onSeventh[0].x.toFixed(1)}, ${onSeventh[0].z.toFixed(1)})`);
    assert.ok(onW41.n > 500, 'W 41st St between the lot rows still has its traffic: ' + onW41.n);
  });
  it('nobody goes against a one-way street or slides sideways', () => clean(r, ['wrongWay', 'sideways']));
  it('a car at rest stands along its lane', () => clean(r, ['askew']));
  it('cars at rest behind one another keep the gap', () => {
    clean(r, ['gap']);
    assert.ok(r.seen.gapMin > RULES.gap - 0.05 && r.seen.gapMin < RULES.gap + 0.5, 'smallest gap in a queue: ' + r.seen.gapMin);
  });
  it('the queue at the W 41st St light stands in line, behind the stop line', () => {
    assert.ok(queues.length > 300, 'two or more cars waited at the light: ' + queues.length + ' frames');
    assert.ok(queues.filter((q) => q.length >= 3).length > 100, 'and three of them, as in the pile');
    for (const q of queues) {
      const front = q[0];
      assert.ok(front.x - HL >= LIGHT.x + LIGHT.r + 4.9, `the first nose at x ${(front.x - HL).toFixed(2)} is before the stop line`);
      for (let i = 0; i < q.length; i++) {
        assert.ok(Math.abs(wrap(q[i].yaw + 90 * deg)) < 0.03, 'facing west');
        assert.ok(Math.abs(q[i].z - front.z) < 0.15, 'on one line: ' + q.map((c) => c.z.toFixed(2)).join(', '));
        if (i) assert.ok(q[i].x - q[i - 1].x >= RULES.len + RULES.gap - 0.05, 'spaced: ' + q.map((c) => c.x.toFixed(2)).join(', '));
      }
    }
  });
  it('the street keeps moving: nobody stands longer than a red light and a bit', () => {
    assert.ok(r.seen.stillMax < 30, 'longest standstill ' + r.seen.stillMax.toFixed(1) + ' s');
    assert.ok(r.seen.speed > 4, 'mean speed ' + r.seen.speed.toFixed(1) + ' m/s');
    assert.equal(r.W.nAI, 26);
    assert.ok(r.seen.carSteps / r.seen.steps > 25, 'the 26 cars are on the street: ' + (r.seen.carSteps / r.seen.steps).toFixed(1) + ' drawn on average');
  });
  it('cars come and go by growing and shrinking, never at full size near the player', () => clean(r, ['popped', 'cameIn']));
});

describe('other tiers, frame rates and a tab that was away', needsMap, () => {
  before(city);
  it('desktop (68 cars) by lot 18', () => { const r = watch({ quality: 'high', seed: 3, player: onFoot(8, 337), minutes: 4 }); clean(r); assert.ok(r.seen.stillMax < 30); });
  it('medium (46 cars) on the plaza beside 7th Avenue', () => { const r = watch({ quality: 'medium', seed: 5, player: onFoot(12, 120), minutes: 4 }); clean(r); assert.ok(r.seen.stillMax < 30); });
  it('20 frames a second', () => { const r = watch({ seed: 7, player: onFoot(16, 28), minutes: 4, fps: 20 }); clean(r); assert.ok(r.seen.stillMax < 30); });
  it('a tab hidden for ten minutes comes back with one long frame, again and again', () => {
    // the game caps a frame at 50 ms; the street itself must not jump ahead even if it is handed 5 s
    const r = watch({ seed: 8, player: onFoot(16, 28), minutes: 4, script: (W, t) => (Math.floor(t) % 45 === 44 && t % 1 < 0.04 ? { dt: 5, jump: 600 } : null) });
    clean(r); assert.ok(r.seen.stillMax < 30);
  });
  it('the player jumps between the bowtie, the lots and the red steps', () => {
    const spots = [[16, 28], [8, 337], [-21, -118]];
    const r = watch({ seed: 38, player: onFoot(16, 28), minutes: 5, script(W, t, player) {
      const [x, z] = spots[Math.floor(t / 45) % 3];
      if (player.x === x && player.z === z) return;
      const far = Math.hypot(player.x - x, player.z - z) > 300; // as timesSquare3d.js teleport does
      player.x = x; player.z = z;
      if (far) W.traffic.warm(x, z);
    } });
    clean(r, ['overlap', 'built', 'wrongWay', 'askew', 'sideways', 'gap']); // (a jump takes the player away from cars at full size: not "popped")
  });
});

describe('something left in a lane', needsMap, () => {
  before(city);
  const cases = [
    ['a cab left in the second lane of 7th Avenue', 31, onFoot(16, 110), TAXI_STANDS[0], [0.46, 120, 0], [0, 1]],
    ['a cab left in the one lane of W 41st St, between the lot rows', 32, onFoot(8, 337), TAXI_STANDS[2], [30, 334.5, -90 * deg], [-1, 0]],
    ['a cab left across two lanes of 7th Avenue', 33, onFoot(16, 110), TAXI_STANDS[0], [-1.4, 120, 90 * deg], [0, 1]],
  ];
  for (const [name, seed, player, stand, [x, z, yaw], [fx, fz]] of cases) {
    it(name + ': the cars behind go around it', () => {
      const past = passes(x, z, fx, fz, 12);
      let cab = -1;
      const r = watch({ quality: 'medium', seed, player, minutes: 5, script(W) { if (cab < 0) cab = leaveCab(W, stand, x, z, yaw); }, each: (cs) => past.tick(cs) });
      clean(r, ['overlap', 'built', 'wrongWay', 'askew', 'gap']);
      assert.ok(past.n >= 6, past.n + ' cars got past it');
      assert.ok(r.seen.stillMax < 45, 'nobody waits behind it for long: ' + r.seen.stillMax.toFixed(0) + ' s');
    });
  }
  it('the player standing in a lane of 7th Avenue: cars stop short, honk, and go around', () => {
    const past = passes(0.46, 100, 0, 1), near = { min: Infinity };
    const r = watch({ quality: 'medium', seed: 34, player: onFoot(0.46, 100), minutes: 5, each(cs) {
      past.tick(cs);
      for (const c of cs) if (c.ai && c.still > 1 && Math.abs(c.x - 0.46) < 1 && c.z < 100) near.min = Math.min(near.min, 100 - c.z - HL);
    } });
    clean(r, ['overlap', 'wrongWay', 'askew', 'gap']);
    assert.ok(past.n >= 6, past.n + ' cars got past');
    assert.ok(r.W.honks.n >= 1, 'a honk');
    assert.ok(near.min > 3, 'a car that stopped for the player stood ' + near.min.toFixed(1) + ' m away');
  });
  it('the player\'s cab waiting for a fare in a lane, then driving on: the cars behind queue, pass, and do not run into it', () => {
    let cab = -1;
    const player = { x: -3.26, y: 0, z: 60, yaw: 0, driving: true };
    const hit = [];
    const r = watch({ quality: 'medium', seed: 35, player, minutes: 5, script(W, t, p, dt) {
      if (cab < 0) { cab = W.traffic.callTaxi(TAXI_STANDS[0]); W.traffic.takeTaxi(cab); }
      const moving = t % 80 > 40 && p.z < 225; // 40 s at the curb side of the lane, then down the avenue at 6 m/s
      if (moving) p.z += 6 * dt;
      W.traffic.driveTaxi(cab, p.x, p.z, 0, moving ? 6 : 0);
    }, each(cs) {
      // while the cab stands still, nothing may be drawn into it (what it drives into itself is the player's doing)
      const me = cs.find((c) => c.i === cab);
      if (me && me.still > 1) for (const c of cs) if (c.ai && overlap(c, me)) hit.push(c);
    } });
    assert.equal(hit.length, 0);
    clean(r, ['wrongWay', 'askew', 'gap']);
  });
});

describe('what cannot get past is taken off the street', needsMap, () => {
  before(city);
  it('a cab across the one lane of W 41st St: each car waits about 12 s, shrinks away, and the street works again once the cab is gone', () => {
    // across the lane at (30, 334.5): 1.3 m of road on one side of it and 2.1 m on the other, no way around
    const cabs = [{ x: 30, z: 334.5, yaw: 0, v: 0 }];
    const behind = { stillMax: 0, n: 0 }, gone = [], last = new Map();
    const after = passes(30, 334.5, -1, 0, 4);
    const r = watch({ quality: 'medium', seed: 41, player: onFoot(8, 337), minutes: 8, script(W, t) { W.traffic.setRemoteTaxis(t < 240 ? cabs : []); }, each(cs, t) {
      const here = new Set();
      for (const c of cs) {
        if (!c.ai || Math.abs(c.z - 334.5) > 3 || c.x < 32 || c.x > 75) continue;
        here.add(c.i);
        if (t < 240) { if (c.still > behind.stillMax) behind.stillMax = c.still; if (c.still > 3) behind.n++; }
        last.set(c.i, c);
      }
      for (const [i, c] of last) if (!here.has(i)) { last.delete(i); if (c.still > 3) gone.push(c.size); }
      if (t > 230) after.tick(cs); // (from before the cab leaves: whoever is waiting then is the first through)
    } });
    clean(r, ['overlap', 'askew', 'gap', 'popped', 'cameIn', 'wrongWay']);
    assert.ok(behind.n > 0, 'cars did wait behind it');
    assert.ok(behind.stillMax > RULES.stuckS - 3 && behind.stillMax < RULES.stuckS + 10, 'the longest wait behind the cab: ' + behind.stillMax.toFixed(1) + ' s');
    assert.ok(gone.length >= 3, gone.length + ' cars were taken off');
    for (const size of gone) assert.ok(size < 0.2, 'last drawn at size ' + size.toFixed(2));
    assert.ok(after.n >= 3, after.n + ' cars drove through after the cab left');
  });
});

describe('cabs called to the stands', needsMap, () => {
  before(city);
  it('park at the curb within reach of their stand, clear of the lanes, the crossings and the lots; traffic passes them', () => {
    const ids = [], drawn = new Map();
    const r = watch({ quality: 'medium', seed: 36, player: onFoot(16, 90), minutes: 5, script(W) {
      if (ids.length) return;
      for (const s of TAXI_STANDS) {
        const i = W.traffic.callTaxi(s);
        assert.ok(i >= W.nAI && i < W.nAI + 8, 'a called-cab slot');
        ids.push(i);
      }
      assert.equal(W.traffic.callTaxi({ x: 5000, z: 5000 }), -1); // no road within 30 m
    }, each(cs) { for (const c of cs) if (ids.includes(c.i)) drawn.set(c.i, c); } });
    clean(r, ['overlap', 'built', 'wrongWay', 'askew', 'gap', 'sideways']);
    assert.ok(r.seen.stillMax < 30, 'nobody is held up by a cab at the curb: ' + r.seen.stillMax.toFixed(0) + ' s');
    const R = nyc.roads, G = nyc.graph;
    TAXI_STANDS.forEach((s, k) => {
      const c = drawn.get(ids[k]);
      assert.ok(c, s.name);
      assert.ok(Math.hypot(c.x - s.x, c.z - s.z) < 18, `${s.name}: the cab is ${Math.hypot(c.x - s.x, c.z - s.z).toFixed(1)} m from its stand (the game looks within 18 m)`);
      assert.equal(builtAt(c), '', s.name);
      const hit = nyc.nearestRoad(c.x, c.z, 20, (r) => R.cls[r] !== ROAD.PEDESTRIAN && R.cls[r] !== ROAD.SERVICE);
      // beside the road edge, along the road, and not on a crossing
      assert.ok(Math.abs(hit.d - (R.width[hit.road] / 2 - 0.75)) < 0.05, `${s.name}: ${hit.d.toFixed(2)} m from the centre line of a ${R.width[hit.road]} m road`);
      assert.ok(Math.abs(Math.abs(Math.sin(c.yaw) * hit.fx + Math.cos(c.yaw) * hit.fz) - 1) < 1e-3, s.name + ': along the road');
      for (const p of [hit.seg, hit.seg + 1]) {
        const n = G.nodeAt(R.xs[p], R.zs[p]), jr = G.nodeAdj[n].length >= 3 ? Math.max(...G.nodeAdj[n].map((e) => R.width[e.road])) / 2 : 0;
        assert.ok(Math.hypot(c.x - R.xs[p], c.z - R.zs[p]) > jr + HL + 3, s.name + ': clear of the crossing at the end of its block');
      }
    });
  });
  it('the API the game uses is what it was', () => {
    const W = world('low', 1);
    assert.deepEqual(Object.keys(W.traffic).sort(), ['callTaxi', 'collide', 'driveTaxi', 'nearestTaxi', 'phase', 'positions', 'releaseTaxi', 'setCabTint', 'setCabYellow', 'setRemoteTaxis', 'takeTaxi', 'update', 'warm']);
    W.traffic.warm(16, 28);
    for (let k = 0; k < 90; k++) W.traffic.update(1 / 30, k / 30, onFoot(16, 28));
    // a called cab: found from its stand, taken, driven, left where the player got out; the map shows it
    const i = W.traffic.callTaxi(TAXI_STANDS[0]);
    const cab = W.traffic.nearestTaxi(TAXI_STANDS[0].x, TAXI_STANDS[0].z, 18, true);
    assert.equal(cab.i, i); assert.equal(cab.mode, 'parked');
    const at = W.traffic.takeTaxi(i);
    assert.ok(Math.hypot(at.x - TAXI_STANDS[0].x, at.z - TAXI_STANDS[0].z) < 18 && Number.isFinite(at.yaw));
    assert.equal(W.traffic.takeTaxi(i), null, 'already driven');
    W.traffic.driveTaxi(i, 20, 40, 1, 3, 0.2);
    W.traffic.update(1 / 30, 4, { x: 20, y: 0.2, z: 40, yaw: 1, driving: true });
    assert.ok(W.traffic.positions().some((p) => p.mode === 'driven' && p.x === 20 && p.z === 40));
    W.traffic.releaseTaxi(i, 20, 40, 1);
    assert.equal(W.traffic.nearestTaxi(20, 40, 7, true).i, i);
    // someone walking into a parked cab is pushed out of it; far from every car nothing moves
    const [px, pz] = W.traffic.collide(20, 40.2, 0.4);
    assert.ok(Math.hypot(px - 20, pz - 40.2) > 0.05);
    assert.deepEqual(W.traffic.collide(20, 60, 0.4), [20, 60]);
    assert.match(W.traffic.phase(), /^(nsG|nsY|ewG|ewY|red)$/);
  });
});

// ---- the cab's stripe, lettering and roof light --------------------------------------------------------------------
describe('the taxi\'s textures', needsMap, () => {
  before(city);
  const meshes = (quality) => {
    const W = world(quality, 1);
    const mapped = W.inst.filter((m) => m.material.map && m !== W.beams);
    const decal = mapped.find((m) => m.material.transparent), sign = mapped.find((m) => !m.material.transparent);
    const body = W.inst.find((m) => m.material.isMeshPhysicalMaterial && m.count === decal.count);
    return { W, decal, sign, body };
  };
  it('what each tier pays', () => {
    assert.deepEqual(taxiTextureTier('low', 16), { decalW: 512, decalH: 64, signW: 256, signH: 64, anisotropy: 2 });
    assert.deepEqual(taxiTextureTier('medium', 16), { decalW: 1024, decalH: 128, signW: 256, signH: 64, anisotropy: 4 });
    assert.deepEqual(taxiTextureTier('high', 16), { decalW: 1024, decalH: 128, signW: 256, signH: 64, anisotropy: 8 });
    assert.equal(taxiTextureTier('high', 4).anisotropy, 4); assert.equal(taxiTextureTier('low', 1).anisotropy, 1); assert.equal(taxiTextureTier('medium').anisotropy, 1);
    for (const q of ['low', 'medium', 'high']) {
      const { decal, sign } = meshes(q), want = taxiTextureTier(q, 16);
      assert.deepEqual([decal.material.map.image.width, decal.material.map.image.height], [want.decalW, want.decalH]);
      assert.deepEqual([sign.material.map.image.width, sign.material.map.image.height], [256, 64]);
      for (const tex of [decal.material.map, sign.material.map]) {
        assert.equal(tex.generateMipmaps, true); assert.equal(tex.minFilter, THREE.LinearMipmapLinearFilter); assert.equal(tex.magFilter, THREE.LinearFilter);
        assert.equal(tex.anisotropy, want.anisotropy); assert.equal(tex.colorSpace, THREE.SRGBColorSpace);
      }
    }
  });
  it('on a 375 px wide phone the decal is drawn 4 to 20 times smaller than it is painted, so the mipmaps do the work', () => {
    // portrait 375 x 812, vertical field of view 72 degrees (camrig.js portraitFov), device pixel ratio capped at 1.5 on the phone tier
    const pxPerM = (dist, dpr) => (812 * dpr / 2) / (Math.tan(36 * deg) * dist);
    const texPerM = (w) => w / 3.4;
    assert.equal(Math.round(texPerM(1024)), 301); assert.equal(Math.round(texPerM(512)), 151);
    assert.equal(Math.round(pxPerM(10, 1.5)), 84); assert.equal(Math.round(pxPerM(40, 1.5)), 21); assert.equal(Math.round(pxPerM(10, 1)), 56); assert.equal(Math.round(pxPerM(40, 1)), 14);
    for (const [w, d, dpr, lo, hi] of [[1024, 10, 1.5, 3.5, 3.7], [1024, 40, 1, 21, 22], [512, 10, 1.5, 1.7, 1.9], [512, 40, 1, 10.5, 11]]) {
      const ratio = texPerM(w) / pxPerM(d, dpr);
      assert.ok(ratio > lo && ratio < hi, `${w} px at ${d} m, dpr ${dpr}: ${ratio.toFixed(1)} texels per pixel`);
    }
    // a stripe cell on screen at 40 m (CSS pixels): 3.0 x 1.5 now; the old 10.6 x 4.6 cm cell was 1.5 x 0.6
    const cell = [3.4 / TAXI_DECAL.cols, 0.42 * TAXI_DECAL.band / TAXI_DECAL.rows];
    assert.deepEqual(cell.map((m) => +(m * pxPerM(40, 1)).toFixed(1)), [3.0, 1.5]);
    assert.deepEqual([3.4 / 32, 0.42 * 14 / 128].map((m) => +(m * pxPerM(40, 1)).toFixed(1)), [1.5, 0.6]);
  });
  it('the stripe: two rows of cells on power-of-two texels (an exact checker at every mipmap level, then an even grey)', () => {
    for (const [w, h] of [[1024, 128], [512, 64]]) {
      const c = canvasStub(); c.width = w; c.height = h;
      paintTaxiDecal(c);
      const cells = c.drawn.filter((d) => d.kind === 'rect');
      assert.equal(cells.length, TAXI_DECAL.cols * TAXI_DECAL.rows);
      const cw = w / TAXI_DECAL.cols, ch = h * TAXI_DECAL.band / TAXI_DECAL.rows;
      for (const n of [cw, ch]) assert.equal(Math.log2(n) % 1, 0, n + ' texels');
      const at = new Map();
      for (const d of cells) { assert.equal(d.w, cw); assert.equal(d.h, ch); assert.equal(d.x % cw, 0); assert.equal(d.y % ch, 0); at.set(d.x / cw + ',' + d.y / ch, d.fill); }
      for (let i = 0; i < TAXI_DECAL.cols; i++) for (let j = 0; j < TAXI_DECAL.rows; j++) if (i) assert.notEqual(at.get(i + ',' + j), at.get(i - 1 + ',' + j));
      assert.notEqual(at.get('0,0'), at.get('0,1'));
      assert.ok(Math.max(...cells.map((d) => d.y + d.h)) <= h * TAXI_DECAL.band);
    }
  });
  it('the lettering is between the wheels, and the stripe above them', () => {
    const { W, decal, body } = meshes('high');
    decal.geometry.computeBoundingBox(); body.geometry.computeBoundingBox(); W.wheels.geometry.computeBoundingBox();
    const d = decal.geometry.boundingBox, b = body.geometry.boundingBox, wh = W.wheels.geometry.boundingBox;
    // the wheels: 0.34 m radius on axles at z = +-1.45, x = +-0.86, standing 6 cm proud of the body side
    const tyre = { r: wh.max.y, x: 0.86 + wh.max.x, z: 1.45 };
    assert.ok(Math.abs(tyre.r - 0.34) < 1e-6 && tyre.x > b.max.x + 0.05);
    assert.match(read('ts3d/traffic.js'), /const WHEELS = \[\[-0\.86, 1\.45\], \[0\.86, 1\.45\], \[-0\.86, -1\.45\], \[0\.86, -1\.45\]\];/);
    // the plane: a real 2 cm off the side panel (plus a polygon offset), symmetric about the middle of the car
    assert.ok(Math.abs(d.max.x - b.max.x - 0.02) < 1e-6 && Math.abs(d.min.x - b.min.x + 0.02) < 1e-6, `plane at ${d.max.x}, body side at ${b.max.x}`);
    assert.ok(Math.abs(d.max.z + d.min.z) < 1e-6 && Math.abs(d.max.z - 1.7) < 1e-6);
    const m = decal.material;
    assert.equal(m.polygonOffset, true); assert.ok(m.polygonOffsetFactor < 0 && m.polygonOffsetUnits < 0);
    assert.equal(m.transparent, true); assert.equal(m.depthWrite, false);
    assert.equal(m.premultipliedAlpha, true); assert.equal(m.map.premultiplyAlpha, true); // mipmaps of straight alpha darken the edges
    // the stripe (top half) starts above the tyres' tops
    const stripe0 = d.max.y - (d.max.y - d.min.y) * TAXI_DECAL.band;
    assert.ok(stripe0 > 2 * tyre.r, `stripe from ${stripe0.toFixed(2)} m, tyre top ${(2 * tyre.r).toFixed(2)} m`);
    // the lettering: every word inside text0..text1, and that stretch of the door is clear of both tyres at the lettering's height
    const c = m.map.image, words = c.drawn.filter((q) => q.kind === 'text');
    assert.deepEqual(words.map((q) => q.s), ['NYC', 'TAXI', 'WISH BOARD']);
    for (const q of words) {
      const x0 = q.align === 'right' ? q.x - q.w : q.x, x1 = q.align === 'right' ? q.x : q.x + q.w;
      assert.ok(x0 >= c.width * TAXI_DECAL.text0 - 0.5 && x1 <= c.width * TAXI_DECAL.text1 + 0.5, `${q.s}: ${x0.toFixed(0)}..${x1.toFixed(0)} of ${c.width}`);
      assert.ok(q.y > c.height * TAXI_DECAL.band, q.s + ' is under the stripe');
    }
    assert.ok(words[1].x >= words[0].x + words[0].w && words[1].x + words[1].w < words[2].x - words[2].w, 'the words do not run into each other');
    const reach = d.max.z * (1 - 2 * TAXI_DECAL.text0); // how far from the middle of the car the lettering gets
    const low = d.min.y, chord = Math.sqrt(Math.max(0, tyre.r ** 2 - (low - tyre.r) ** 2)); // the tyre's half width at the plane's lower edge
    assert.ok(reach < tyre.z - chord, `lettering to ${reach.toFixed(2)} m, tyre from ${(tyre.z - chord).toFixed(2)} m`);
    // the old plane had 'NYC' at 0.23 m from its end: 1.52 m from the middle, on the tyre
    assert.ok(1.75 - 3.4 * 70 / 1024 > tyre.z - chord);
  });
  it('the roof light is one box: lettering on the two faces across the car, plain on the top and ends', () => {
    const { sign } = meshes('high');
    const g = sign.geometry, pos = g.attributes.position, uv = g.attributes.uv;
    g.computeBoundingBox();
    assert.deepEqual([g.boundingBox.max.x - g.boundingBox.min.x, g.boundingBox.max.y - g.boundingBox.min.y].map((n) => +n.toFixed(3)), [1, 0.25]); // 4 : 1, as the 256 x 64 texture
    assert.equal(pos.count, 36);
    const blank = new Set();
    let lettered = 0;
    for (let t = 0; t < 36; t += 3) {
      const flatZ = pos.getZ(t) === pos.getZ(t + 1) && pos.getZ(t) === pos.getZ(t + 2);
      const us = [0, 1, 2].map((k) => uv.getX(t + k)), vs = [0, 1, 2].map((k) => uv.getY(t + k));
      if (flatZ) { lettered++; assert.ok(Math.max(...us) - Math.min(...us) === 1 && Math.max(...vs) - Math.min(...vs) === 1); }
      else { assert.ok(us.every((u) => u === us[0]) && vs.every((v) => v === vs[0]), 'one texel for the whole face'); blank.add(us[0] + ',' + vs[0]); }
    }
    assert.equal(lettered, 4); assert.equal(blank.size, 1);
    // that texel is plain background: the one word is in the middle of the canvas
    const c = canvasStub(); c.width = 256; c.height = 64;
    paintTaxiSign(c);
    const words = c.drawn.filter((q) => q.kind === 'text');
    assert.deepEqual(words.map((q) => [q.s, q.align, q.x]), [['TAXI', 'center', 128]]);
    const [u, v] = [...blank][0].split(',').map(Number);
    assert.ok(u * 256 < 128 - words[0].w / 2 - 16 && (1 - v) * 64 < 8, `blank texel (${u}, ${v})`);
    assert.ok(c.drawn[0].kind === 'rect' && c.drawn[0].w === 256 && c.drawn[0].h === 64);
  });
  it('every instance of a cab\'s parts shares one matrix (the decal and the light cannot drift off the body)', () => {
    const W = world('low', 1);
    W.traffic.warm(16, 28);
    W.traffic.callTaxi(TAXI_STANDS[0]);
    for (let k = 0; k < 60; k++) W.traffic.update(1 / 30, k / 30, onFoot(16, 28));
    const taxiParts = W.inst.filter((m) => m.count === 14 + 16), carParts = W.inst.filter((m) => m.count === 12);
    assert.equal(taxiParts.length, 6); assert.equal(carParts.length, 4);
    for (const set of [taxiParts, carParts]) for (const m of set) assert.deepEqual(Array.from(m.instanceMatrix.array), Array.from(set[0].instanceMatrix.array));
    // and the beam under cab k is the same matrix
    for (let k = 0; k < 14; k++) assert.deepEqual(Array.from(taxiParts[0].instanceMatrix.array.subarray(k * 16, k * 16 + 16)), Array.from(W.beams.instanceMatrix.array.subarray(k * 16, k * 16 + 16)));
  });
});
