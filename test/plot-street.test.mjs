// 가운데 거리 (WISH STREET): the 18 lots on one north-south street, the stage at its south end. The layout's rules are
// worked out from ts3d/layout.js, which ts3d/landmarks.js builds from, with source checks that the builders really read
// those numbers. Then landmarks.js itself is built in Node (the real three, the real board registry, no renderer) for
// what the boards' cameras read and what the street costs, and the map checks run on the real OpenStreetMap extract.
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { register } from 'node:module';
import * as THREE from '../vendor/three/build/three.module.js';
import {
  LAYOUT, LOOP, LOT, PLOT_SLOTS, SKIP_ZONES, NO_PROPS, NO_TREES, NO_ROAD, TAXI_STANDS, LANDMARKS,
  lotFacing, lotRect, streetPosts, groundHeight, insideLoop,
} from '../ts3d/layout.js';
import { createNYC, ROAD } from '../ts3d/nyc.js';
import { boardVantage, facesBlock, portraitFov } from '../camrig.js';

register(new URL('./nine-three-hook.mjs', import.meta.url)); // 'three' -> the vendored build, so ts3d/landmarks.js loads in Node

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const S = LAYOUT.street, G = LAYOUT.stage, PAD = SKIP_ZONES[1];
const EPS = 1e-9;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} vs ${b}`);
/** Two rectangles share more than an edge. */
const overlap = (a, b) => a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS;
const inside = (r, o) => r.x0 >= o.x0 - EPS && r.x1 <= o.x1 + EPS && r.z0 >= o.z0 - EPS && r.z1 <= o.z1 + EPS;
const square = (p) => ({ x0: p.x - p.r, x1: p.x + p.r, z0: p.z - p.r, z1: p.z + p.r });
// The fence: LOOP's rails are 1.2 m thick (ts3d/landmarks.js rail()).
const FENCE = { x0: LOOP.x0 + 1.2, x1: LOOP.x1 - 1.2, z0: LOOP.z0 + 1.2, z1: LOOP.z1 - 1.2 };
// The part of the street that must stay free: its clear width, from the arch to the foot of the stage steps.
const STRIP = { x0: S.x - S.half, x1: S.x + S.half, z0: S.z0, z1: S.z1 };

const pad = (slot) => lotRect(slot, LOT.w / 2, LOT.d / 2);
/** The widest a lot gets along the street at any level (the tower's roof line), as deep as its pad. */
const widest = (slot) => lotRect(slot, LOT.wide / 2, LOT.d / 2);
const LEVELS = [1, 2, 3, 4];
const foot = (slot, level) => lotRect(slot, LOT.foot[level][0], LOT.foot[level][1]);
/** A lot's group as buildPlot makes it: at the slot, turned by rotation.y = rot, scaled. */
function lotObject(slot) {
  const o = new THREE.Object3D();
  o.position.set(slot.x, 0, slot.z);
  o.rotation.y = slot.rot;
  o.scale.setScalar(slot.scale || 1);
  o.updateMatrixWorld(true);
  return o;
}
/** The stage's colliders as ts3d/landmarks.js pushes them (the source check below holds the two together), plus its
 *  floor and steps (groundHeight lifts the walker there; a car is stopped by the same box in timesSquare3d.js). */
function stageBoxes() {
  const X = G.cx, out = [{ x0: G.x0, x1: G.x1, z0: G.z0 - 2.4, z1: G.z1, part: 'floor' }];
  for (const sx of [-1, 1]) {
    for (const tz of [G.z0 + 0.4, G.z1 - 0.2]) out.push({ x0: X + sx * 8.6 - 0.35, x1: X + sx * 8.6 + 0.35, z0: tz - 0.35, z1: tz + 0.35, part: 'truss' });
    out.push({ x0: X + sx * 10.6 - 0.85, x1: X + sx * 10.6 + 0.85, z0: G.z0 + 0.45, z1: G.z0 + 1.95, part: 'speaker' });
  }
  out.push({ x0: X - 8.6, x1: X + 8.6, z0: G.z1 + 0.2, z1: G.z1 + 0.9, part: 'back wall' });
  for (const [tx, dz] of G.trees) out.push({ x0: X + tx - 0.65, x1: X + tx + 0.65, z0: G.z0 + dz - 0.65, z1: G.z0 + dz + 0.65, part: 'tree' });
  return out;
}

describe('가운데 거리: eighteen lots on one north-south street', () => {
  it('ids 1..18 in order, and PLOT_SLOTS[id - 1] is the lot with that id', () => {
    assert.equal(PLOT_SLOTS.length, 18);
    assert.deepEqual(PLOT_SLOTS.map((s) => s.id), Array.from({ length: 18 }, (_, i) => i + 1));
    for (let id = 1; id <= 18; id++) assert.equal(PLOT_SLOTS[id - 1].id, id);
    for (const s of PLOT_SLOTS) assert.equal(s.scale, 0.9, 'lot ' + s.id);
  });
  it('nine on each side: pair k is lots 2k+1 (east, x = +17) and 2k+2 (west, x = -17) at z = 272 + 13 k', () => {
    assert.deepEqual([S.x, S.lotX, S.lot0, S.step, S.pairs], [0, 17, 272, 13, 9]);
    const east = PLOT_SLOTS.filter((s) => s.x > S.x), west = PLOT_SLOTS.filter((s) => s.x < S.x);
    assert.equal(east.length, 9);
    assert.equal(west.length, 9);
    for (const s of PLOT_SLOTS) {
      const k = (s.id - 1) >> 1, odd = s.id % 2 === 1;
      assert.equal(s.x, odd ? 17 : -17, 'lot ' + s.id);
      assert.equal(s.z, 272 + 13 * k, 'lot ' + s.id);
      assert.equal(s.side, odd ? 'E' : 'W', 'lot ' + s.id);
    }
    assert.deepEqual(east.map((s) => s.z), [272, 285, 298, 311, 324, 337, 350, 363, 376]);
    assert.deepEqual(west.map((s) => s.z), east.map((s) => s.z));
    // the old rows' letters are gone
    assert.equal(PLOT_SLOTS.some((s) => s.side === 'N' || s.side === 'S'), false);
  });
  it('walking in from the entrance (heading south) the odd numbers are on the left and the even numbers on the right', () => {
    const heading = new THREE.Vector3(0, 0, 1); // south is +Z
    const left = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), heading);
    assert.deepEqual([left.x, left.y, left.z], [1, 0, 0]); // which is east
    for (const s of PLOT_SLOTS) assert.equal(Math.sign((s.x - S.x) * left.x), s.id % 2 === 1 ? 1 : -1, 'lot ' + s.id);
    // and the numbers grow away from the entrance
    for (const s of PLOT_SLOTS.slice(2)) assert.ok(s.z > PLOT_SLOTS[s.id - 3].z, 'lot ' + s.id);
    assert.ok(PLOT_SLOTS[0].z - S.z0 < S.z1 - PLOT_SLOTS[0].z); // lot 1 is at the entrance end
  });
  it('every front faces the street: three.js turns the lot\'s local +Z by rotation.y = rot', () => {
    for (const s of PLOT_SLOTS) {
      const front = new THREE.Vector3(0, 0, 1).transformDirection(lotObject(s).matrixWorld);
      const toStreet = Math.sign(S.x - s.x);
      near(front.x, toStreet, 'lot ' + s.id + ' front.x');
      near(front.z, 0, 'lot ' + s.id + ' front.z');
      near(front.y, 0);
      assert.equal(s.rot, s.x > S.x ? -Math.PI / 2 : Math.PI / 2, 'lot ' + s.id);
      // the builders' own formula (landmarks.js plotFront, ui.js plotFront, the claim rocket in timesSquare3d.js)
      const f = lotFacing(s);
      near(f.x, front.x);
      near(f.z, front.z);
      // so the board, which buildPlot hangs at a positive local z, is on the street side of the lot's centre
      const board = new THREE.Vector3(0, 2.2, 2.72).applyMatrix4(lotObject(s).matrixWorld);
      assert.ok(Math.abs(board.x - S.x) < Math.abs(s.x - S.x), 'lot ' + s.id);
      near(board.z, s.z);
    }
    const lm = read('ts3d/landmarks.js'), ui = read('ui.js'), w = read('timesSquare3d.js');
    assert.match(lm, /group\.rotation\.y = slot\.rot;/);
    assert.match(lm, /return out\.set\(slot\.x \+ Math\.sin\(slot\.rot\) \* d, LAYOUT\.walk\.y, slot\.z \+ Math\.cos\(slot\.rot\) \* d\);/);
    assert.match(ui, /return \{ x: slot\.x \+ Math\.sin\(slot\.rot\) \* d, z: slot\.z \+ Math\.cos\(slot\.rot\) \* d \};/);
    assert.match(w, /launch\(slot\.x \+ Math\.sin\(slot\.rot\) \* 6, slot\.z \+ Math\.cos\(slot\.rot\) \* 6,/);
    // every board in buildPlot is at a local z between the lot's centre and the pad's front edge
    const zs = [...lm.matchAll(/board = \{ x: 0, y: [\d.]+, z: ([\d.]+),/g)].map((m) => Number(m[1]));
    assert.equal(zs.length, 5);
    for (const z of zs) assert.ok(z > 0 && z < LOT.d / 2, String(z));
  });
  it('a quarter-turned lot swaps its footprint: lotRect is the box three.js would give', () => {
    const turned = [...PLOT_SLOTS, { id: 0, x: 3, z: -4, rot: 0, scale: 1 }, { id: 0, x: 3, z: -4, rot: Math.PI, scale: 0.9 }];
    for (const s of turned) {
      for (const [a, d] of [[LOT.w / 2, LOT.d / 2], ...LEVELS.map((l) => LOT.foot[l]), [LOT.wide / 2, LOT.d / 2]]) {
        const m = lotObject(s).matrixWorld, box = new THREE.Box3();
        for (const [x, z] of [[-a, -d], [a, -d], [-a, d], [a, d]]) box.expandByPoint(new THREE.Vector3(x, 0, z).applyMatrix4(m));
        const r = lotRect(s, a, d);
        near(r.x0, box.min.x); near(r.x1, box.max.x); near(r.z0, box.min.z); near(r.z1, box.max.z);
      }
    }
    // on the street the long side of a lot runs along the street
    const p = pad(PLOT_SLOTS[0]);
    near(p.x1 - p.x0, LOT.d * 0.9);
    near(p.z1 - p.z0, LOT.w * 0.9);
    // buildPlot takes its pad, its colliders and its camera blockers from the same numbers
    const lm = read('ts3d/landmarks.js');
    assert.match(lm, /kit\.box\(LOT\.w, 0\.08, LOT\.d, '#2e3138', \{ y: 0\.04 \}\);/);
    assert.match(lm, /const foot = LOT\.foot\[level\];/);
    assert.match(lm, /const r = lotRect\(slot, foot\[0\], foot\[1\]\);\n\s*box\.push\(\{ \.\.\.r, plot: slot\.id \}\);\n\s*colliders\.push\(box\[0\]\);/);
    assert.equal(/Math\.abs\(Math\.sin\(slot\.rot\)\) > 0\.5/.test(lm), false); // the swap lives in lotRect only
    assert.equal(LOT.foot[0], null); // an empty lot is walk-through
    // level 1's collider reaches the two posts of its board (x ± (6.2 / 2 - 0.2), 0.08 thick)
    assert.ok(LOT.foot[1][0] >= 6.2 / 2 - 0.2 + 0.04);
    // the tower's footprint covers its 8.4 x 6.4 body, which sits 0.2 back from the lot's centre
    assert.ok(LOT.foot[4][0] >= 8.4 / 2 && LOT.foot[4][1] >= 6.4 / 2 + 0.2 - EPS);
    assert.ok(LOT.foot[3][0] >= 9.6 / 2 && LOT.foot[3][1] >= 6.2 / 2 + 0.3 - EPS);
  });
  it('no two lots overlap: not their pads, not their colliders at any level, not the widest level\'s roof line', () => {
    for (const a of PLOT_SLOTS) for (const b of PLOT_SLOTS) {
      if (a.id >= b.id) continue;
      assert.equal(overlap(pad(a), pad(b)), false, `pads ${a.id} ${b.id}`);
      assert.equal(overlap(widest(a), widest(b)), false, `widest ${a.id} ${b.id}`);
      for (const la of LEVELS) for (const lb of LEVELS) assert.equal(overlap(foot(a, la), foot(b, lb)), false, `colliders ${a.id}@${la} ${b.id}@${lb}`);
    }
    // neighbours on one side: 13 m apart, 12.06 m at the widest (the tower's 13.4 m roof line at scale 0.9)
    near(S.step - LOT.wide * 0.9, 0.94);
    assert.ok(LOT.wide >= Math.max(LOT.w, ...LEVELS.map((l) => LOT.foot[l][0] * 2)));
    // the two rows are 27.16 m apart pad to pad, and no collider comes nearer the centre line than a pad does
    near(pad(PLOT_SLOTS[0]).x0 - pad(PLOT_SLOTS[1]).x1, 27.16);
    for (const s of PLOT_SLOTS) for (const l of LEVELS) assert.ok(inside(foot(s, l), { ...widest(s), x0: pad(s).x0, x1: pad(s).x1 }), `lot ${s.id}@${l}`);
  });
  it('every lot is inside the pad and the fence, at every level', () => {
    assert.deepEqual(PAD, { x0: -70, x1: 70, z0: 255, z1: 395 });
    assert.ok(inside(PAD, FENCE));
    for (const s of PLOT_SLOTS) {
      for (const r of [pad(s), widest(s), ...LEVELS.map((l) => foot(s, l))]) {
        assert.ok(inside(r, PAD), 'lot ' + s.id);
        assert.ok(inside(r, FENCE), 'lot ' + s.id);
      }
      assert.ok(insideLoop(s.x, s.z, 4), 'lot ' + s.id);
    }
  });
});

describe('the stage at the street\'s south end', () => {
  it('x -8..8, z 382..394, spot at (0, 388): inside the pad and the fence with its wings, its back wall and its trees', () => {
    assert.deepEqual([G.cx, G.x0, G.x1, G.z0, G.z1, G.h], [0, -8, 8, 382, 394, 0.75]);
    assert.deepEqual(G.spot, { x: 0, z: 388, r: 3.8 });
    near(G.spot.z, (G.z0 + G.z1) / 2);
    assert.equal(G.cx, S.x);
    for (const b of stageBoxes()) {
      assert.ok(inside(b, PAD), b.part);
      assert.ok(inside(b, FENCE), b.part);
    }
  });
  it('it is past the last pair: its floor starts south of every pad and every collider, and nothing of it is under a lot', () => {
    const last = PLOT_SLOTS.slice(-2);
    assert.deepEqual(last.map((s) => s.z), [376, 376]);
    for (const s of PLOT_SLOTS) {
      assert.ok(G.z0 - 2.4 > s.z, 'lot ' + s.id); // the steps start south of every lot's centre
      assert.ok(G.z0 > pad(s).z1 + 2, 'lot ' + s.id);
      for (const l of LEVELS) assert.ok(G.z0 > foot(s, l).z1 + 1, `lot ${s.id}@${l}`);
      for (const b of stageBoxes()) {
        assert.equal(overlap(b, pad(s)), false, `${b.part} on pad ${s.id}`);
        assert.equal(overlap(b, widest(s)), false, `${b.part} under lot ${s.id}`);
      }
    }
    // the last towers' roof line (15 m up, 15 m east and west of the centre line) ends level with the stage's front edge
    near(widest(last[0]).z1 - G.z0, 0.03);
    assert.ok(pad(last[0]).x0 - (G.cx + 10.6 + 0.85) > 2); // 2.1 m between the speakers and the last pads' street edge
  });
  it('it faces north, up the street: three 0.8 m steps on its north side, the floor behind them, flat street before them', () => {
    near(S.z1, G.z0 - 2.4);
    for (let z = S.z0 - 6; z < S.z1 - 0.01; z += 0.5) for (const x of [-S.half, -6, 0, 6, S.half]) assert.equal(groundHeight(x, z), 0, `${x},${z}`);
    near(groundHeight(0, G.z0 - 2.0), G.h / 4);
    near(groundHeight(0, G.z0 - 1.2), G.h / 2);
    near(groundHeight(0, G.z0 - 0.4), (G.h * 3) / 4);
    near(groundHeight(0, G.z0 + 0.1), G.h);
    near(groundHeight(G.spot.x, G.spot.z), G.h);
    near(groundHeight(0, G.z1 + 0.1), 0); // no steps on the south side: the back wall is there
    for (const s of PLOT_SLOTS) near(groundHeight(s.x, s.z), 0);
    // the sign over the floor looks north (rotation pi), the back wall is on the south edge, the steps before z0
    const lm = read('ts3d/landmarks.js');
    const st = lm.slice(lm.indexOf('// ===== K-POP stage park'), lm.indexOf('// ===== Taxi stand signs'));
    assert.match(st, /sign\.position\.set\(0, top \+ 10\.9, G\.z0 \+ 0\.1\);\n\s*sign\.rotation\.y = Math\.PI;/);
    assert.match(st, /kit\.box\(17\.6, 10, 0\.4, '#0d0d12', \{ x: 0, y: top \+ 5, z: G\.z1 \+ 0\.5, mat: 'metal' \}\);/);
    assert.match(st, /z: G\.z0 - 2\.4 \+ 0\.8 \* k \+ 0\.4, mat: 'gloss'/);
    // the colliders stageBoxes() mirrors
    for (const line of [
      'const x = sx * 8.6;',
      'box(x - 0.35, x + 0.35, tz - 0.35, tz + 0.35);',
      'box(sx * 10.6 - 0.85, sx * 10.6 + 0.85, G.z0 + 0.45, G.z0 + 1.95);',
      'box(-8.6, 8.6, G.z1 + 0.2, G.z1 + 0.9);',
      'for (const [tx, dz] of G.trees) {',
      'box(tx - 0.65, tx + 0.65, tz - 0.65, tz + 0.65);',
    ]) assert.ok(st.includes(line), line);
    assert.match(st, /for \(const tz of \[G\.z0 \+ 0\.4, G\.z1 - 0\.2\]\) \{/);
    // the walker's and the car's box of the stage, and the stage light, come from LAYOUT.stage
    const w = read('timesSquare3d.js');
    assert.match(w, /carColliders\.push\(\{ x0: G\.x0, x1: G\.x1, z0: G\.z0 - 2\.4, z1: G\.z1 \}\);/);
    assert.match(w, /stageLight\.position\.set\(LAYOUT\.stage\.cx, 7, LAYOUT\.stage\.z0 - 2\);/);
  });
  it('its six trees stand beside it: south of every lot, outside the street, none before a board', () => {
    assert.equal(G.trees.length, 6);
    const trees = stageBoxes().filter((b) => b.part === 'tree');
    for (const t of trees) {
      const tx = (t.x0 + t.x1) / 2, tz = (t.z0 + t.z1) / 2;
      // the crown reaches 2.3 m from the trunk (a 1.7 m ball and a 1.25 m ball 0.6 m off it), 6.7 m up at most
      for (const s of PLOT_SLOTS) {
        assert.ok(tz - 2.3 > pad(s).z1, 'lot ' + s.id);
        for (const l of LEVELS) assert.ok(tz - 2.3 > foot(s, l).z1, `lot ${s.id}@${l}`);
      }
      assert.ok(tz - 2.3 > S.z1); // south of the street's end, so before no lot's board
      assert.ok(Math.abs(tx - S.x) - 2.3 > S.half);
      assert.ok(Math.abs(tx - G.cx) - 2.3 > 10.6 + 0.85); // clear of the speakers
    }
  });
});

describe('the street is free from the entrance to the stage', () => {
  it('runs along x = 0 from the arch at z 262 to the foot of the stage steps, 24 m clear between the posts', () => {
    assert.deepEqual([S.x, S.z0, S.half], [0, 262, 12]);
    near(S.z1, 379.6);
    assert.ok(S.z0 < pad(PLOT_SLOTS[0]).z0 && S.z0 < widest(PLOT_SLOTS[0]).z0); // the arch is before the first pair, at any level
    assert.ok(inside(STRIP, PAD));
    // the paved strip is exactly the gap between the two rows of pads, from the arch to the pad's south edge
    const P = S.pave;
    near(P.x1, pad(PLOT_SLOTS[0]).x0);
    near(P.x0, pad(PLOT_SLOTS[1]).x1);
    assert.deepEqual([P.z0, P.z1], [S.z0, PAD.z1]);
    assert.ok(inside(STRIP, P));
    assert.ok(inside(P, PAD));
  });
  it('no collider stands in it: no lot at any level, no number post, no arch post, no part of the stage, no taxi stand', () => {
    const all = [];
    for (const s of PLOT_SLOTS) {
      all.push({ ...pad(s), what: 'pad ' + s.id }, { ...widest(s), what: 'widest ' + s.id });
      for (const l of LEVELS) all.push({ ...foot(s, l), what: `lot ${s.id}@${l}` });
    }
    for (const p of streetPosts()) all.push({ ...square(p), what: p.arch ? 'arch post' : 'number post ' + p.lot });
    for (const b of stageBoxes()) all.push({ ...b, what: 'stage ' + b.part });
    for (const t of TAXI_STANDS) all.push({ x0: t.x - 0.2, x1: t.x + 0.2, z0: t.z - 0.2, z1: t.z + 0.2, what: 'stand ' + t.name });
    assert.equal(all.length, 18 * 6 + 20 + 14 + 3);
    for (const r of all) assert.equal(overlap(r, STRIP), false, r.what);
    // beside the street nothing is nearer the centre line than the clear half-width
    for (const r of all) if (r.z1 > STRIP.z0 && r.z0 < STRIP.z1) assert.ok(Math.min(Math.abs(r.x0 - S.x), Math.abs(r.x1 - S.x)) >= S.half, r.what);
  });
  it('the entrance arch: two posts either side of the street at its north end', () => {
    const posts = streetPosts().filter((p) => p.arch);
    assert.deepEqual(posts.map((p) => [p.arch, p.x, p.z]), [[-1, -13.2, 262], [1, 13.2, 262]]);
    for (const p of posts) {
      assert.ok(Math.abs(p.x - S.x) - p.r > S.half);
      assert.ok(inside(square(p), PAD));
      for (const s of PLOT_SLOTS) assert.equal(overlap(square(p), widest(s)), false);
    }
    // north of it: the 건물 구역 stand on the centre line at the pad's edge, and the point a jump to the lots aims at
    const stand = TAXI_STANDS.find((t) => t.name === '건물 구역');
    assert.deepEqual([stand.x, stand.z], [S.x, PAD.z0]);
    assert.equal(S.entry.x, S.x);
    assert.ok(S.entry.z > stand.z && S.entry.z < S.z0);
    assert.ok(Math.hypot(S.entry.x - stand.x, S.entry.z - stand.z) <= 4);
    assert.ok(insideLoop(S.entry.x, S.entry.z, 4));
  });
  it('a number post at each lot\'s street corner, the corner nearer the entrance: outside the clear width, off the pads', () => {
    const posts = streetPosts().filter((p) => p.lot);
    assert.deepEqual(posts.map((p) => p.lot), PLOT_SLOTS.map((s) => s.id));
    for (const p of posts) {
      const s = PLOT_SLOTS[p.lot - 1], r = square(p), own = pad(s);
      // on the lot's side of the street, between the clear width and the pad's street edge
      assert.equal(Math.sign(p.x - S.x), Math.sign(s.x - S.x), 'lot ' + s.id);
      assert.ok(Math.abs(p.x - S.x) - p.r > S.half, 'lot ' + s.id);
      assert.ok(Math.abs(p.x - S.x) + p.r < Math.abs((s.x > S.x ? own.x0 : own.x1) - S.x), 'lot ' + s.id);
      // before the lot as one walks in, and nearer this lot than the one before it
      assert.ok(r.z1 < own.z0, 'lot ' + s.id);
      assert.ok(own.z0 - p.z < 1, 'lot ' + s.id);
      assert.ok(p.z > S.z0 + 4, 'lot ' + s.id);
      // off every pad, and before every building line (a level 3 shop front is 2.96 forward of the lot's centre)
      for (const o of PLOT_SLOTS) {
        assert.equal(overlap(r, pad(o)), false, `post ${s.id} on pad ${o.id}`);
        assert.equal(overlap(r, lotRect(o, LOT.wide / 2, 3.0)), false, `post ${s.id} in lot ${o.id}`);
      }
      // the spot where a visitor stands to open the lot (5.4 forward of its centre, 3.6 m around) stays free
      const f = lotFacing(s), spot = { x: s.x + f.x * 5.4 * s.scale, z: s.z + f.z * 5.4 * s.scale };
      assert.ok(Math.hypot(p.x - spot.x, p.z - spot.z) > 3.6 + p.r, 'lot ' + s.id);
      assert.ok(Math.abs(spot.x - S.x) > 8 && Math.abs(spot.x - S.x) < Math.abs(own.x0 + own.x1) / 2, 'lot ' + s.id);
    }
  });
  it('a board\'s front point is in the street, and the last pair\'s is 8.4 m from the spot on the stage\'s edge', () => {
    // timesSquare3d.js slotPose: front = the face's centre + 9 m along its normal. buildPlot hangs every board between the
    // lot's centre and the pad's front edge, so the front point is 9..12.42 m before the centre line of the lot's row.
    const edge = { x: G.spot.x, z: G.spot.z - 5 }; // approachOf's spot for the stage
    const stand = TAXI_STANDS.find((t) => t.name === '건물 구역');
    let toStage = Infinity, toStand = Infinity;
    for (const s of PLOT_SLOTS) for (const t of [0, (LOT.d / 2) * s.scale]) {
      const f = lotFacing(s), p = { x: s.x + f.x * (t + 9), z: s.z + f.z * (t + 9) };
      assert.ok(Math.abs(p.x - S.x) < S.half && p.z > S.z0 && p.z < S.z1, 'lot ' + s.id);
      assert.ok(insideLoop(p.x, p.z, 4));
      toStage = Math.min(toStage, Math.hypot(p.x - edge.x, p.z - edge.z));
      toStand = Math.min(toStand, Math.hypot(p.x - stand.x, p.z - stand.z));
    }
    // approachOf moves a jump that lands within its radius of one of its spots onto that spot: a radius under 8 m
    // leaves every lot's front point alone
    assert.ok(toStage > 8.3 && toStage < 8.4, String(toStage));
    assert.ok(toStand > 17.5 && toStand < 17.7, String(toStand));
    const w = read('timesSquare3d.js');
    assert.match(w, /\{ x: G\.spot\.x, z: G\.spot\.z - 5, yaw: 0 \},/);
    assert.match(w, /front: \{ x: p\.x \+ f\.x \* 9, z: p\.z \+ f\.z \* 9 \}/);
  });
  it('landmarks.js builds the street from these numbers, as one kit', () => {
    const lm = read('ts3d/landmarks.js');
    const st = lm.slice(lm.indexOf('// ===== 가운데 거리 (WISH STREET)'), lm.indexOf("g.fillText('🚧  [다음 오픈 예정]'"));
    assert.ok(st.length > 1000);
    assert.equal((st.match(/new Kit\(\)/g) || []).length, 1);
    assert.equal((st.match(/kit\.build\(/g) || []).length, 1);
    assert.match(st, /for \(const p of streetPosts\(\)\) \{\n\s*colliders\.push\(\{ x0: p\.x - p\.r, x1: p\.x \+ p\.r, z0: p\.z - p\.r, z1: p\.z \+ p\.r \}\);/);
    assert.equal((st.match(/colliders\.push\(/g) || []).length, 1); // nothing else of the street collides
    assert.match(st, /paintNeonSign\(makeCanvas\(AW, SH\), 'WISH STREET', PINK,/);
    assert.match(st, /paintLabel\(makeCanvas\(CELL, CELL\), String\(slot\.id\), sideColor\(slot\), NIGHT\)/);
    assert.match(st, /for \(const ry of \[slot\.rot, 0, Math\.PI\]\) kit\.add\(cropPlane\(/); // toward the street, and both ways along it
    // the pavers and the centre line are in the ground stack, under avatar shadows (0.025 with their own depth offset)
    assert.match(st, /kit\.plane\(P\.x1 - P\.x0, P\.z1 - P\.z0, '#ffffff', \{ mat: 'pave', rx: -Math\.PI \/ 2, x: \(P\.x0 \+ P\.x1\) \/ 2, y: 0\.022, z: \(P\.z0 \+ P\.z1\) \/ 2 \}\);/);
    assert.match(st, /pave: ground\.mats\.street, line: lineMat, faces \}\);/);
    assert.match(st, /if \(m\.name === 'pave' \|\| m\.name === 'line'\) \{ m\.layers\.set\(GROUND_LAYER\);/);
    // the name plate hangs 6.4 m over the street; nothing else of the street is taller than a number post (1.77 m)
    assert.ok(S.arch.h - 0.5 - 1.5 > 6);
    const tall = [...st.matchAll(/kit\.box\([\d.]+, ([\d.]+), [\d.]+, [^\n]*?y: ([\d.]+),/g)].map((m) => Number(m[2]) + Number(m[1]) / 2);
    assert.ok(tall.length >= 3 && Math.max(...tall) < 1.8, String(tall));
  });
});

describe('zones and the map follow the street', () => {
  it('no auto lamp, tree or subway railing in the pad; no park tree by the stage', () => {
    const zone = NO_PROPS.find((q) => inside(PAD, q));
    assert.ok(zone, 'no NO_PROPS zone over the pad');
    for (const s of PLOT_SLOTS) assert.ok(inside(widest(s), zone));
    for (const p of streetPosts()) assert.ok(inside(square(p), zone));
    for (const b of stageBoxes()) assert.ok(inside(b, zone), b.part);
    assert.ok(inside({ x0: S.x - S.half, x1: S.x + S.half, z0: PAD.z0, z1: PAD.z1 }, zone));
    assert.deepEqual(NO_TREES, [{ x0: G.x0 - 4, x1: G.x1 + 4, z0: G.z0 - 4, z1: G.z1 + 4 }]);
    const w = read('ts3d/world.js');
    assert.equal((w.match(/inZone\(layout\.NO_PROPS, x, z\)/g) || []).length, 4); // lamps, street trees, park trees, subway railings
  });
  it('no car road under the street and its lots: world.js cuts the asphalt and its paint out of NO_ROAD', () => {
    near(NO_ROAD.x0, pad(PLOT_SLOTS[1]).x0);
    near(NO_ROAD.x1, pad(PLOT_SLOTS[0]).x1);
    assert.deepEqual([NO_ROAD.z0, NO_ROAD.z1], [S.z0, PAD.z1]);
    assert.ok(inside(NO_ROAD, PAD));
    assert.ok(inside(S.pave, NO_ROAD));
    for (const s of PLOT_SLOTS) assert.ok(inside(pad(s), NO_ROAD), 'lot ' + s.id);
    const w = read('ts3d/world.js');
    assert.match(w, /import \{ LOOP, NO_ROAD \} from '\.\/layout\.js\?v=[0-9a-z]+';/);
    assert.match(w, /for \(const m of \[mats\.asphalt, mats\.paint\]\) \{ m\.clippingPlanes = hole; m\.clipIntersection = true; \}/);
    // the street's own surface is one of the ground's wet materials (same shader, fence clip and depth offset as the pavers)
    assert.match(w, /street: surface\('#[0-9a-f]{6}', 0\.\d+, \{ wet: 0\.\d+, puddles: 0\.\d+, reflect: 1, po: -1, pave: \[2\.4, 1\.2, 0\.\d+, 1\] \}\),/);
    assert.match(w, /for \(const m of \[mats\.land, mats\.grass, mats\.pavers, mats\.street, mats\.pool, mats\.river\]\) m\.clippingPlanes = clips;/);
    // each plane is negative inside the rectangle (three.js clips where the distance is negative, and with
    // clipIntersection only where every plane clips)
    const planes = [
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), NO_ROAD.x0), new THREE.Plane(new THREE.Vector3(1, 0, 0), -NO_ROAD.x1),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), NO_ROAD.z0), new THREE.Plane(new THREE.Vector3(0, 0, 1), -NO_ROAD.z1),
    ];
    for (const [nx, nz, c] of [[-1, 0, 'NO_ROAD.x0'], [1, 0, '-NO_ROAD.x1'], [0, -1, 'NO_ROAD.z0'], [0, 1, '-NO_ROAD.z1']]) {
      assert.ok(w.includes(`new THREE.Plane(new THREE.Vector3(${nx}, 0, ${nz}), ${c}),`), c);
    }
    const cut = (x, z) => planes.every((p) => p.distanceToPoint(new THREE.Vector3(x, 0.03, z)) < 0);
    assert.equal(cut(0, 300), true);
    assert.equal(cut(17, 337), true);
    assert.equal(cut(-20, 394), true);
    for (const [x, z] of [[0, 261], [0, 396], [21, 300], [-21, 300], [0, 255], [16, 90]]) assert.equal(cut(x, z), false, `${x},${z}`);
    // the road itself is not raised or re-cut: the paint stays 0.045 up and avatar shadows keep their place above the ground
    assert.match(w, /const y = cls === ROAD\.PEDESTRIAN \? 0\.022 : 0\.03;/);
    assert.match(w, /const ym = 0\.045;/);
    assert.match(read('ts3d/avatars.js'), /shadow\.position\.y = 0\.025;/);
  });
  it('the map pins and the two jumps in ui.js point at the street, from LAYOUT', () => {
    const lots = LANDMARKS.find((l) => l.id === 'lots'), stage = LANDMARKS.find((l) => l.id === 'stage');
    assert.deepEqual([lots.x, lots.z], [S.x, 324]);
    assert.deepEqual(S.mid, { x: 0, z: 324 });
    assert.equal(lots.z, PLOT_SLOTS[8].z); // the middle pair
    assert.deepEqual([stage.x, stage.z], [G.spot.x, G.spot.z]);
    const ui = read('ui.js');
    assert.match(ui, /const lotCenter = \{ x: LAYOUT\.street\.entry\.x, z: LAYOUT\.street\.entry\.z \};/);
    assert.match(ui, /\{ ico: 'building', ko: '건물 구역', x: LAYOUT\.street\.entry\.x, z: LAYOUT\.street\.entry\.z \},/);
    assert.match(ui, /\{ ico: 'music', ko: 'K-POP 스테이지', x: LAYOUT\.stage\.spot\.x, z: LAYOUT\.stage\.spot\.z - 5 \},/);
    assert.equal(/z: 305\b/.test(ui), false);
    // nothing reads the old rows any more
    for (const f of ['ui.js', 'main.js', 'timesSquare3d.js', 'ts3d/layout.js', 'ts3d/landmarks.js', 'ts3d/timesq.js', 'ts3d/world.js', 'ts3d/traffic.js']) {
      const src = read(f);
      assert.equal(/LAYOUT\.ktown|LAYOUT\.bryant|\bK\.x0\b/.test(src), false, f);
    }
    assert.equal('ktown' in LAYOUT, false);
    assert.equal('bryant' in LAYOUT, false);
    const tq = read('ts3d/timesq.js');
    assert.equal(/K-TOWN 코리아타운|paintNeonSign|pickWall/.test(tq), false); // the old rows' gate went with them
  });
});

// ---- the built world -------------------------------------------------------------------------------------------------
// ts3d/landmarks.js run in Node with the real three and the real board registry (ts3d/screens.js), on a 2D context that
// only records text (the harness of test/welcome.test.mjs). What focusSlot, goToSlot and slotPose read is boards.face().
const canvases = [];
function fakeDom() {
  const ctx = () => {
    const words = [];
    return new Proxy({ words }, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'measureText') return (s) => ({ width: String(s).length * 10 });
        if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
        if (k === 'fillText') return (s) => { words.push(String(s)); };
        if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
        return () => {};
      },
      set(t, k, v) { t[k] = v; return true; },
    });
  };
  globalThis.document = { createElement: () => { let g = null; const c = { width: 0, height: 0, getContext() { return g || (g = ctx()); } }; canvases.push(c); return c; } };
}
async function buildWorld(quality = 'high') {
  fakeDom();
  canvases.length = 0;
  const { createBoards } = await import('../ts3d/screens.js');
  const { buildLandmarks } = await import('../ts3d/landmarks.js');
  const { kitMaterials } = await import('../ts3d/kit.js');
  const scene = new THREE.Scene(), colliders = [], blockers = [], pick = [], pools = [];
  const kitMats = kitMaterials();
  const boards = createBoards({ renderer: { capabilities: { getMaxAnisotropy: () => 4 } }, kitMats, pick, quality });
  const pavers = new THREE.MeshStandardMaterial(); // stands in for world.js mats.street
  const ground = { glowTex: new THREE.Texture(), pools: (list) => { pools.push(...list); return null; }, mats: { street: pavers } };
  const marks = buildLandmarks({ scene, kitMats, boards, ground, colliders, blockers, pick, quality });
  scene.updateMatrixWorld(true);
  return { scene, colliders, blockers, boards, marks, pavers, pools, kitMats, words: canvases.map((c) => ({ w: c.width, h: c.height, words: c.getContext('2d').words.slice() })) };
}
const inStrip = (c) => overlap(c, STRIP);

describe('the built street (ts3d/landmarks.js with the real three)', () => {
  let W = null;
  before(async () => { W = await buildWorld(); });
  it('at every level each lot\'s board faces the street, on the lot\'s own line, between its centre and its pad\'s front edge', () => {
    const across = []; // from the east row's face to the west row's, per level
    for (let level = 0; level <= 4; level++) {
      if (level) for (const s of PLOT_SLOTS) assert.ok(W.marks.applyPlot({ plot_id: s.id, level, theme_color: '#ff3d9a', owner_name: '테스트' }));
      W.scene.updateMatrixWorld(true);
      for (const s of PLOT_SLOTS) {
        const f = W.boards.face('PLOT_' + s.id), tag = `PLOT_${s.id}@${level}`;
        assert.ok(f, tag);
        const toStreet = Math.sign(S.x - s.x);
        near(f.normal.x, toStreet, tag);
        near(f.normal.z, 0, tag);
        near(f.normal.y, 0, tag);
        near(f.up.y, 1, tag);
        // seen from the street the text runs left to right: right x up = normal
        near(new THREE.Vector3().crossVectors(f.right, f.up).dot(f.normal), 1, tag);
        near(f.pos.z, s.z, tag);
        const off = (f.pos.x - s.x) * toStreet; // how far the face is before the lot's centre
        assert.ok(off > 0 && off < (LOT.d / 2) * s.scale, `${tag} ${off}`);
        assert.ok(f.w / 2 <= (LOT.wide / 2) * s.scale, tag);
        // slotPose's front point (9 m before the face) is in the street, and the face is not behind a neighbour
        const front = { x: f.pos.x + f.normal.x * 9, z: f.pos.z + f.normal.z * 9 };
        assert.ok(Math.abs(front.x - S.x) < S.half && front.z > S.z0 && front.z < S.z1, tag);
        assert.equal(W.boards.get('PLOT_' + s.id).mounts.length, 1, tag);
      }
      // the colliders buildPlot pushed are lotRect's, and none is in the street
      const lots = W.colliders.filter((c) => c.plot);
      assert.equal(lots.length, level ? 18 : 0);
      for (const c of lots) {
        const r = foot(PLOT_SLOTS[c.plot - 1], level);
        near(c.x0, r.x0); near(c.x1, r.x1); near(c.z0, r.z0); near(c.z1, r.z1);
      }
      assert.deepEqual(W.colliders.filter(inStrip), [], 'level ' + level);
      across.push(W.boards.face('PLOT_1').pos.x - W.boards.face('PLOT_2').pos.x);
      // the board camera (camrig.js boardVantage, as slotPose calls it for 보기): with every other lot's face in the way it
      // still frames the whole board straight on, from inside the street, on a desktop window and on a phone held upright
      const faces = new Map(PLOT_SLOTS.map((s) => [s.id, W.boards.face('PLOT_' + s.id)]));
      for (const [aspect, baseFov] of [[16 / 9, 55], [9 / 19.5, 62]]) for (const s of PLOT_SLOTS) {
        const f = faces.get(s.id), tag = `PLOT_${s.id}@${level} ${aspect.toFixed(2)}`;
        const block = facesBlock([...faces.values()].filter((o) => o !== f));
        const v = boardVantage({ face: { x: f.pos.x, y: f.pos.y, z: f.pos.z, nx: f.normal.x, nz: f.normal.z, w: f.w, h: f.h }, dist: 18, aspect, vfov: portraitFov(aspect, baseFov), block, ground: groundHeight });
        assert.equal(v.yaw, 0, tag);
        assert.ok(v.fit >= 0.999 && v.seen >= 0.999, `${tag} fit ${v.fit} seen ${v.seen}`);
        assert.ok(Math.abs(v.x - S.x) < S.half && Math.abs(v.z - s.z) < 1e-6, `${tag} cam ${v.x},${v.z}`);
        assert.ok((v.x - f.pos.x) * f.normal.x > 5.9, tag); // before the face (camrig.js FRAME.near is 6 m to its centre)
      }
      for (const s of PLOT_SLOTS.slice(2)) near(Math.abs(W.boards.face('PLOT_' + s.id).pos.x), Math.abs(W.boards.face('PLOT_1').pos.x), 'lot ' + s.id);
    }
    // the street between the two rows of faces: 29.1 m before empty lots, 27.6 m between two towers (33.3, 30.3 and 28.3 m between)
    assert.deepEqual(across.map((d) => Math.round(d * 1000) / 1000), [29.104, 33.28, 30.31, 28.33, 27.61]);
    assert.ok(Math.min(...across) > 2 * S.half);
    // back to empty lots: the colliders and the camera blockers of the buildings go with them
    for (const s of PLOT_SLOTS) W.marks.applyPlot({ plot_id: s.id, level: 0, theme_color: '#00ffcc', owner_name: '' });
    assert.equal(W.colliders.filter((c) => c.plot).length, 0);
    assert.equal(W.blockers.filter((b) => b.plot).length, 0);
  });
  it('plotFront(id) is the spot before lot id, on its side of the street', () => {
    for (const s of PLOT_SLOTS) {
      const p = W.marks.plotFront(s.id);
      near(p.x, s.x + Math.sign(S.x - s.x) * 5.4 * 0.9, 'lot ' + s.id);
      near(p.z, s.z, 'lot ' + s.id);
      assert.equal(W.colliders.some((c) => p.x > c.x0 - 0.34 && p.x < c.x1 + 0.34 && p.z > c.z0 - 0.34 && p.z < c.z1 + 0.34), false, 'lot ' + s.id);
    }
    assert.equal(W.marks.plotFront(19), null);
  });
  it('the stage\'s colliders, its spot and its light pools follow LAYOUT.stage', () => {
    assert.deepEqual(W.marks.stage.world.toArray(), [G.spot.x, G.h, G.spot.z]);
    const rect = (c) => [c.x0, c.x1, c.z0, c.z1].map((v) => Math.round(v * 100) / 100);
    const have = new Set(W.colliders.map((c) => rect(c).join()));
    for (const b of stageBoxes()) if (b.part !== 'floor') assert.ok(have.has(rect(b).join()), b.part + ' ' + rect(b));
    // nothing is left where the stage was (z 360..372 on the centre line): that is the street now
    assert.deepEqual(W.colliders.filter((c) => c.x0 < 12 && c.x1 > -12 && c.z0 < 376 && c.z1 > 263), []);
    assert.deepEqual(W.pools.filter((p) => p.z > PAD.z0).map((p) => [p.x, p.z]), [[-4, G.z0 - 6], [4, G.z0 - 6]]);
  });
  it('the street\'s dressing is one group of five meshes and 908 triangles; its pavers and line lie in the ground stack', () => {
    const street = W.scene.getObjectByName('wish-street');
    assert.ok(street);
    assert.deepEqual(street.children.map((m) => m.name), ['pave', 'line', 'metal', 'glow', 'faces']);
    const tris = Object.fromEntries(street.children.map((m) => [m.name, m.geometry.attributes.position.count / 3]));
    assert.deepEqual(tris, { pave: 2, line: 2, metal: 480, glow: 312, faces: 112 });
    const by = (n) => street.children.find((m) => m.name === n);
    // the pavers: the ground's own wet street material, on the ground layer at a pedestrian road's height, over S.pave
    assert.equal(by('pave').material, W.pavers);
    for (const n of ['pave', 'line']) assert.equal(by(n).layers.mask, 1 << 1, n); // ts3d/ground.js GROUND_LAYER: not in the mirror pass
    for (const n of ['metal', 'glow', 'faces']) assert.equal(by(n).layers.mask, 1, n);
    assert.equal(by('metal').material, W.kitMats.metal);
    assert.equal(by('glow').material, W.kitMats.glow);
    const box = (n) => { const g = by(n).geometry; g.computeBoundingBox(); return g.boundingBox; };
    const P = S.pave, pb = box('pave');
    near(pb.min.x, P.x0); near(pb.max.x, P.x1); near(pb.min.z, P.z0); near(pb.max.z, P.z1);
    near(pb.min.y, 0.022); near(pb.max.y, 0.022);
    // the lit centre line: 14 cm wide on x = 0, at the road paint's height with its depth offset, from the arch to the stage
    const lb = box('line');
    near(lb.min.x, S.x - 0.07); near(lb.max.x, S.x + 0.07); near(lb.max.y, 0.045);
    assert.ok(lb.min.z > S.z0 && lb.min.z < S.z0 + 2 && lb.max.z < S.z1 && lb.max.z > S.z1 - 6);
    assert.equal(by('line').material.polygonOffsetFactor, -4);
    assert.ok(Math.max(...by('line').geometry.attributes.color.array) > 1); // lit: brighter than white for the bloom pass
    // nothing solid stands in the clear width: every post and the arch keep outside it, and only the name plate (6.4 m up) spans it
    const pos = by('metal').geometry.attributes.position;
    let plateZ = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getX(i) - S.x) >= S.half - 1e-6) continue;
      assert.ok(pos.getY(i) >= 6.4 - 1e-6, `${pos.getX(i)},${pos.getY(i)},${pos.getZ(i)}`);
      plateZ = Math.max(plateZ, Math.abs(pos.getZ(i) - S.arch.z));
    }
    // the faces: the name toward the entrance and toward the street, and each number toward the street and both ways along it
    const nrm = by('faces').geometry.attributes.normal, count = { '1,0': 0, '-1,0': 0, '0,1': 0, '0,-1': 0 };
    for (let i = 0; i < nrm.count; i += 3) count[`${Math.round(nrm.getX(i))},${Math.round(nrm.getZ(i))}`]++;
    assert.deepEqual(count, { '1,0': 18, '-1,0': 18, '0,1': 38, '0,-1': 38 });
    const fp = by('faces').geometry.attributes.position, posts = streetPosts().filter((p) => p.lot);
    for (let i = 0; i < fp.count; i++) {
      const x = fp.getX(i), y = fp.getY(i), z = fp.getZ(i);
      if (Math.abs(nrm.getX(i)) > 0.5) assert.equal(Math.sign(nrm.getX(i)), Math.sign(S.x - x)); // a west lot's number looks east, an east lot's west
      if (y > 6) {
        // the name: before the plate and the beam on both sides, over the middle of the street
        assert.ok(Math.abs(z - S.arch.z) > plateZ + 0.03 && Math.abs(x - S.x) < 5.4, `${x},${y},${z}`);
        continue;
      }
      // a number: at head height on its own post, 3 cm off the post's head (0.72 m across) so it never flickers into it
      const p = posts.find((q) => Math.hypot(x - q.x, z - q.z) < 0.6);
      assert.ok(p && y > 1 && y < 1.72, `${x},${y},${z}`);
      assert.ok(Math.abs((x - p.x) * nrm.getX(i) + (z - p.z) * nrm.getZ(i) - 0.39) < 1e-3); // vertices are 32-bit floats
    }
    assert.ok(Math.abs(plateZ - 0.35) < 1e-3);
    // one atlas: the name and the numbers 1..18 were painted, each number once
    const words = W.words.flatMap((c) => c.words);
    assert.ok(words.includes('WISH STREET'));
    for (let id = 1; id <= 18; id++) assert.equal(W.words.filter((c) => c.w === 112 && c.h === 112 && c.words.join() === String(id)).length, 1, String(id));
    assert.equal(by('faces').material.map.image.width, 1024);
    assert.equal(by('faces').material.map.image.height, 256 + 2 * 112);
  });
  it('the phone tier builds the same street on a half-size atlas', async () => {
    const low = await buildWorld('low');
    const street = low.scene.getObjectByName('wish-street');
    assert.deepEqual(street.children.map((m) => [m.name, m.geometry.attributes.position.count / 3]), [['pave', 2], ['line', 2], ['metal', 480], ['glow', 312], ['faces', 112]]);
    const map = street.children.find((m) => m.name === 'faces').material.map.image;
    assert.deepEqual([map.width, map.height], [512, 240]);
    assert.deepEqual(low.colliders.filter(inStrip), []);
  });
});

// ---- the real map --------------------------------------------------------------------------------------------------
const MAP = new URL('../assets/nyc/manhattan.bin', import.meta.url);
describe('the street on the real map', { skip: !existsSync(MAP) }, () => {
  let nyc = null;
  const load = () => {
    if (nyc) return nyc;
    nyc = createNYC(new Uint8Array(gunzipSync(readFileSync(MAP))));
    const B = nyc.buildings;
    for (let i = 0; i < B.count; i++) for (const z of SKIP_ZONES) if (B.cx[i] >= z.x0 && B.cx[i] <= z.x1 && B.cz[i] >= z.z0 && B.cz[i] <= z.z1) { nyc.skipBuilding[i] = 1; break; } // as world.js does
    return nyc;
  };
  it('no building that still stands reaches the street, a lot or the stage', () => {
    const B = load().buildings;
    const keep = { x0: NO_ROAD.x0 - 5, x1: NO_ROAD.x1 + 5, z0: PAD.z0, z1: PAD.z1 };
    let skipped = 0;
    for (let i = 0; i < B.count; i++) {
      if (nyc.skipBuilding[i]) { skipped++; continue; }
      assert.equal(overlap({ x0: B.x0[i], x1: B.x1[i], z0: B.z0[i], z1: B.z1[i] }, keep), false, 'building ' + i);
    }
    assert.ok(skipped >= 30, String(skipped));
  });
  it('the car roads that cross the street are 7th Avenue, down its whole length, and West 41st Street, across it', () => {
    const R = load().roads;
    const names = new Map();
    for (let p = 0; p < R.segRoad.length; p++) {
      const r = R.segRoad[p];
      if (r == null || r < 0 || R.cls[r] === ROAD.PEDESTRIAN || R.cls[r] === ROAD.SERVICE) continue;
      const ax = R.xs[p], az = R.zs[p], bx = R.xs[p + 1], bz = R.zs[p + 1];
      if (Math.max(ax, bx) < STRIP.x0 || Math.min(ax, bx) > STRIP.x1 || Math.max(az, bz) < STRIP.z0 || Math.min(az, bz) > STRIP.z1) continue;
      let hit = 0;
      for (let k = 0; k <= 400; k++) {
        const x = ax + ((bx - ax) * k) / 400, z = az + ((bz - az) * k) / 400;
        if (!(x > STRIP.x0 && x < STRIP.x1 && z > STRIP.z0 && z < STRIP.z1)) continue;
        hit++;
        // wherever a car road's centre line is inside the street, its asphalt is cut out
        assert.ok(x > NO_ROAD.x0 && x < NO_ROAD.x1 && z >= NO_ROAD.z0 && z < NO_ROAD.z1);
      }
      if (hit) names.set(nyc.roadName(r), (names.get(nyc.roadName(r)) || 0) + 1);
    }
    assert.deepEqual([...names.keys()].sort(), ['7th Avenue', 'West 41st Street']);
    // 7th Avenue is the street: its centre line is within 3 m of x = 0 all the way, and the stand's road too
    const hit = nyc.nearestRoad(S.x, S.mid.z, 30, (r) => R.cls[r] !== ROAD.PEDESTRIAN && R.cls[r] !== ROAD.SERVICE);
    assert.equal(nyc.roadName(hit.road), '7th Avenue');
    assert.ok(hit.d < 3, String(hit.d));
  });
});
