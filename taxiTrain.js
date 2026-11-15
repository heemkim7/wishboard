/** Drop-off pay: 1 rider x1, 2 x2.2, 3 x3.8, 4 x6, 5 x10. */
export function taxiTrainMult(riders) {
  const table = [1, 2.2, 3.8, 6, 10];
  const n = Math.floor(Number(riders));
  if (n >= 1 && n <= 5) return table[n - 1];
  return 1;
}

// Resolved bumper-to-bumper contact is ~3.12m (nose 1.3 + radii 1.82). Same 3.5m the hive uses.
const CAB_M = 3.5;
const DETACH_CD = 1.4;

function taxiNear(hit, taxis) {
  const x = Number(hit?.x), z = Number(hit?.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  for (const c of taxis || []) {
    if (!c || c.mode === 'driven') continue;
    if (Math.hypot((Number(c.x) || 0) - x, (Number(c.z) || 0) - z) < CAB_M) return true;
  }
  return false;
}

/**
 * One hard hit on a taxi train.
 * `held` is how far the cab actually moved in the collision, before the road snap.
 * `moved` is ignored: at 60fps that snap is often longer than the whole frame (v/60 ≈ 0.2m),
 * so a real stop never looked stopped, and the rejected step stayed under the old 0.22m impulse.
 * A bumper that does not fully stop still counts when another cab is within CAB_M and this
 * frame's push is at least 5cm — a 60fps shove, not a 0.22m one.
 */
export function applyTaxiHardHit(job, hit, taxis) {
  const riders = Math.max(0, Math.floor(Number(job?.riders) || 0));
  const keep = { riders, trailers: Math.max(0, riders - 1), mult: taxiTrainMult(riders), dropped: false };
  if (riders < 3 || !hit) return keep;
  const t = Number(hit.t) || 0;
  const detachAt = Number(job.detachAt) || 0;
  if (detachAt > 0 && t - detachAt < DETACH_CD) return keep;
  const speed = Math.abs(Number(hit.speed) || 0);
  if (speed < 8) return keep;
  const intend = Math.abs(Number(hit.intend) || 0);
  const blocked = Math.max(0, Number(hit.blocked) || 0);
  const held = Number(hit.held);
  const rejected = Number.isFinite(held) ? Math.max(0, intend - held) : blocked;
  const stopped = intend > 0 && rejected >= intend * 0.45;
  const cab = taxiNear(hit, taxis) && blocked >= 0.05;
  if (!stopped && !cab) return keep;
  const next = riders - 1;
  return { riders: next, trailers: Math.max(0, next - 1), mult: taxiTrainMult(next), dropped: true };
}
