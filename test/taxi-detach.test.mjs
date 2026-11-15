import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyTaxiHardHit, taxiTrainMult } from '../taxiTrain.js';

const dt = 1 / 60;

// 12 m/s at 60fps travels 0.2m. The wall rejects that step (under the old 0.22m
// impulse) but the road snap then reports 1.6m. detachAt 0 must not count as a cooldown.
const intend = 12 * dt;
const wall = applyTaxiHardHit(
  { riders: 3, detachAt: 0 },
  { speed: 12, intend, blocked: intend, held: 0, moved: 1.6, t: 0.5, x: 0, z: 0 },
  [{ x: 0, z: 0, mode: 'driven' }],
);
assert.equal(wall.dropped, true);
assert.equal(wall.riders, 2);
assert.equal(wall.trailers, 1);
assert.equal(wall.mult, 2.2);
assert.equal(taxiTrainMult(2), 2.2);
assert.equal(taxiTrainMult(wall.riders), 2.2);

// Bumper contact is ~3.2m, past the old 2.8m gate, and the shove is 8cm.
const cab = applyTaxiHardHit(
  { riders: 3, detachAt: 0 },
  { speed: 10, intend: 10 * dt, blocked: 0.08, held: 10 * dt, moved: 10 * dt, t: 0.5, x: 0, z: 0 },
  [{ x: 3.2, z: 0, mode: 'ai' }],
);
assert.equal(cab.riders, 2);
assert.equal(cab.trailers, 1);
assert.equal(taxiTrainMult(cab.riders), 2.2);

// A party-speed frame is split into substeps, so one step's impulse stays small while the cab stops.
const partyIntend = 52 * dt;
const party = applyTaxiHardHit(
  { riders: 3, detachAt: 0 },
  { speed: 52, intend: partyIntend, blocked: partyIntend / 3, held: 0, moved: 2, t: 0.5, x: 0, z: 0 },
  [],
);
assert.equal(party.riders, 2);
assert.equal(taxiTrainMult(party.riders), 2.2);

const coast = applyTaxiHardHit(
  { riders: 3, detachAt: 0 },
  { speed: 12, intend, blocked: 0, held: intend, moved: intend, t: 0.5, x: 0, z: 0 },
  [],
);
assert.equal(coast.dropped, false);
assert.equal(coast.riders, 3);

const src = await readFile(new URL('../timesSquare3d.js', import.meta.url), 'utf8');
const heldAt = src.indexOf('const held = Math.hypot(cx - d.x, cz - d.z)');
const snapAt = src.indexOf('nearestRoad?.(cx, cz, 16)');
assert.ok(heldAt > 0 && snapAt > heldAt);
assert.match(src, /applyTaxiHardHit\(/);
assert.match(src, /while \(trailers\.length > n\) scene\.remove\(trailers\.pop\(\)\)/);

const worker = await readFile(new URL('../worker.js', import.meta.url), 'utf8');
assert.match(worker, /trainMult\(uid, riders\) \{[\s\S]*?const table = \[1, 2\.2, 3\.8, 6, 10\]/);
