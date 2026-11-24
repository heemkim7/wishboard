// Pure rules for the plaza's interactions and feedback (taxi exit and offers, the floating stick, the touch-device test,
// the bake rounds). No DOM, no three.js: ui.js, main.js and timesSquare3d.js call these, and test/interact.test.mjs pins
// them. None of this play pays 응원 포인트 (balance.js PAY): the ground coins are gone, a taxi fare and a bake are play only.

// ---- taxi ------------------------------------------------------------------------------------------------------
// Leaving a taxi: with riders the first press only warns (EXIT_CONFIRM_MS to press again); above EXIT_SLOW m/s the
// cab brakes first and the player gets out once it is slow.
export const EXIT_SLOW = 3, EXIT_CONFIRM_MS = 3000;
/** { act: 'warn' | 'brake' | 'exit', armedUntil }. speed in m/s (sign ignored), now and armedUntil in ms. */
export function taxiExit({ riders = 0, speed = 0, now = 0, armedUntil = 0 } = {}) {
  const n = Math.max(0, Math.floor(Number(riders) || 0));
  if (n > 0 && !(now < armedUntil)) return { act: 'warn', armedUntil: now + EXIT_CONFIRM_MS };
  return { act: Math.abs(Number(speed) || 0) > EXIT_SLOW ? 'brake' : 'exit', armedUntil: 0 };
}
// Pacing for a fare gap, kept for the world's taxi jobs. No fare is paid any more (main.js onJob sends ev.sent = false), so
// `since` stays null and a new passenger comes OFFER_MIN_S after the last job, with no wait at the drop-off. With a gap:
// a passenger is offered OFFER_RIDE_S before FARE_GAP_S ends, and a cab that arrives early waits there (fareWait).
export const FARE_GAP_S = 40, OFFER_MIN_S = 2.5, OFFER_RIDE_S = 15;
/** Seconds until the next passenger is offered. since: seconds since the last fare was sent (null = none yet). */
export function nextOfferDelay(since, { gap = FARE_GAP_S, min = OFFER_MIN_S, ride = OFFER_RIDE_S } = {}) {
  const s = Number(since);
  if (since == null || !Number.isFinite(s) || s < 0) return min;
  return Math.max(min, gap - s - ride);
}
/** Seconds the passenger still has to wait at the drop-off before a fare would be paid (0 = may get out now). */
export function fareWait(since, gap = FARE_GAP_S) {
  const s = Number(since);
  if (since == null || !Number.isFinite(s) || s < 0) return 0;
  return Math.max(0, gap - s);
}

// ---- touch controls --------------------------------------------------------------------------------------------
// The stick floats: a touch in the lower-left STICK_W x STICK_H of the screen becomes the stick's centre once it moves
// STICK_ENGAGE px; a touch that stays put is a tap and goes on to the world (a board, a plot, the ATM).
export const STICK_W = 0.45, STICK_H = 0.55, STICK_THROW = 56, STICK_ENGAGE = 10;
/** true when a touch at (x, y) on a w x h screen starts in the stick's area. */
export function stickZone(x, y, w, h) {
  if (!(w > 0) || !(h > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  return x >= 0 && x <= w * STICK_W && y >= h * (1 - STICK_H) && y <= h;
}
/** The knob offset (px, at most `max` from the centre) and the stick value (-1..1) for a drag of (dx, dy) px. */
export function stickVec(dx, dy, max = STICK_THROW) {
  let x = Number(dx) || 0, y = Number(dy) || 0;
  const d = Math.hypot(x, y);
  if (d > max) { x *= max / d; y *= max / d; }
  return { ox: x, oy: y, x: x / max, y: y / max };
}
/** The touch layout (html.touch) and the touch controls: a coarse pointer or more than one touch point. */
export function isTouchUI({ coarse = false, points = 0 } = {}) {
  return !!coarse || (Number(points) || 0) > 1;
}

// ---- auto-walk -------------------------------------------------------------------------------------------------
// 길안내 알약의 `자동으로 가기`: the avatar walks to the guide's target by itself. The world plans a route over walkable ground
// (gridPath, with its own collision test as `blocked`), follows it (walkSteer), and gives up when it stops getting nearer
// (walkStall). It is local movement: the same walk step the stick drives, nothing new on the wire. The player's own input
// ends it at once (autoWalkEnds).
//   cell, clear  the grid (m) and how much room a cell's centre needs (radius, m): more than half a cell, so no wall fits
//                between two walkable neighbours
//   snap         a target inside something (a board on its wall, the ATM itself, a tap on a block of the map) ends at the
//                nearest walkable cell within this many cells
//   reach, arrive a corner of the route counts as passed within reach m; the walk is over within arrive m of its end
//   look, turns  the step ahead that is probed for something the plan did not know (a car, a lamp post) and how far the
//                walk steers round it, either side (rad)
//   replan, stuck seconds without getting `gain` m nearer: plan again from here (once), then stop and say so
export const AUTO_WALK = { cell: 1.5, clear: 0.8, snap: 40, maxNodes: 30000, reach: 1.2, arrive: 0.7, look: 1, turns: [0.6, 1.2, 1.8], replan: 0.8, stuck: 2, gain: 1 };
const NEXT = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/**
 * A route over walkable ground from `from` to `to` ({ x, z }, metres), around everything `blocked(x, z)` says a walker
 * cannot stand in. bounds: { x0, x1, z0, z1 }. A* over a grid of `cell` m (8 neighbours, never cutting a blocked corner),
 * then the string is pulled tight, so the route is a few straight legs.
 * -> { points: [{ x, z }, ...] (the first is `from`), exact (the last is `to` itself), cells (how many were tested) }.
 * A `to` nobody can stand on ends at the walkable cell nearest to it, one that cannot be reached at the nearest cell that
 * can; null when no step from where the walker stands gets any nearer.
 */
export function gridPath({ from, to, bounds, blocked, cell = AUTO_WALK.cell, maxNodes = AUTO_WALK.maxNodes } = {}) {
  if (!from || !to || !bounds || typeof blocked !== 'function' || !(cell > 0)) return null;
  const x0 = bounds.x0, z0 = bounds.z0;
  const nx = Math.ceil((bounds.x1 - x0) / cell), nz = Math.ceil((bounds.z1 - z0) / cell), N = nx * nz;
  if (!(nx > 0) || !(nz > 0) || N > 4e6) return null;
  const state = new Uint8Array(N); // 0 not tested yet, 1 walkable, 2 blocked
  let cells = 0;
  const open = (ix, iz) => {
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return false;
    const k = iz * nx + ix;
    if (!state[k]) { cells++; state[k] = blocked(x0 + (ix + 0.5) * cell, z0 + (iz + 0.5) * cell) ? 2 : 1; }
    return state[k] === 1;
  };
  const col = (x) => Math.max(0, Math.min(nx - 1, Math.floor((x - x0) / cell))), row = (z) => Math.max(0, Math.min(nz - 1, Math.floor((z - z0) / cell)));
  const at = (k) => ({ x: x0 + ((k % nx) + 0.5) * cell, z: z0 + (Math.floor(k / nx) + 0.5) * cell });
  const S = row(from.z) * nx + col(from.x);
  state[S] = 1; // the walker is standing there
  let gx = col(to.x), gz = row(to.z), exact = true;
  if (!open(gx, gz)) {
    exact = false;
    let best = -1, bd = Infinity;
    for (let r = 1; r <= AUTO_WALK.snap && best < 0; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !open(gx + dx, gz + dz)) continue;
        const d = Math.hypot(dx, dz);
        if (d < bd) { bd = d; best = (gz + dz) * nx + gx + dx; }
      }
    }
    if (best >= 0) { gx = best % nx; gz = Math.floor(best / nx); }
  }
  const G = gz * nx + gx;
  // A*: cost in cells, an octile estimate weighted 1.2 (a little greedy: fewer cells tested, the pull below straightens the rest)
  const est = (k) => { const dx = Math.abs((k % nx) - gx), dz = Math.abs(Math.floor(k / nx) - gz); return (Math.max(dx, dz) + 0.4142 * Math.min(dx, dz)) * 1.2; };
  const cost = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const hk = [], hf = []; // a binary heap of cells by cost + estimate
  const push = (k, f) => {
    let i = hk.length;
    hk.push(k); hf.push(f);
    while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; hk[i] = hk[p]; hf[i] = hf[p]; i = p; }
    hk[i] = k; hf[i] = f;
  };
  const pop = () => {
    const top = hk[0], k = hk.pop(), f = hf.pop(), n = hk.length;
    if (n) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && hf[c + 1] < hf[c]) c++; if (hf[c] >= f) break; hk[i] = hk[c]; hf[i] = hf[c]; i = c; }
      hk[i] = k; hf[i] = f;
    }
    return top;
  };
  cost[S] = 0;
  push(S, est(S));
  let near = S, nearEst = est(S), found = false, popped = 0;
  while (hk.length) {
    const k = pop();
    if (closed[k]) continue;
    closed[k] = 1;
    if (k === G) { found = true; break; }
    const e = est(k);
    if (e < nearEst) { nearEst = e; near = k; }
    if (++popped > maxNodes) break;
    const ix = k % nx, iz = (k - ix) / nx;
    for (const [ax, az] of NEXT) {
      if (!open(ix + ax, iz + az) || (ax && az && (!open(ix + ax, iz) || !open(ix, iz + az)))) continue;
      const j = (iz + az) * nx + ix + ax, c = cost[k] + (ax && az ? 1.4142 : 1);
      if (closed[j] || !(c < cost[j])) continue;
      cost[j] = c; prev[j] = k;
      push(j, c + est(j));
    }
  }
  const end = found ? G : near;
  exact = exact && found;
  if (end === S && !exact) return null; // no cell that can be reached is nearer than the one the walker stands in
  const chain = [];
  for (let k = end; k >= 0; k = prev[k]) chain.push(k);
  chain.reverse();
  // Pull the string: from each kept cell go straight to the farthest later cell with a clear lane (half a metre either side) to it.
  const see = (a, b) => {
    const ax = a % nx, az = Math.floor(a / nx), bx = b % nx, bz = Math.floor(b / nx), len = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(len * 2), ox = (-(bz - az) / len) * 0.35, oz = ((bx - ax) / len) * 0.35;
    for (let s = 1; s < n; s++) {
      const fx = ax + ((bx - ax) * s) / n, fz = az + ((bz - az) * s) / n;
      if (!open(Math.round(fx), Math.round(fz)) || !open(Math.round(fx + ox), Math.round(fz + oz)) || !open(Math.round(fx - ox), Math.round(fz - oz))) return false;
    }
    return true;
  };
  const kept = [chain[0]];
  for (let i = 0; i < chain.length - 1;) {
    let j = i + 1, step = 1;
    while (j + step < chain.length && see(chain[i], chain[j + step])) { j += step; step *= 2; }
    for (step >>= 1; step >= 1; step >>= 1) if (j + step < chain.length && see(chain[i], chain[j + step])) j += step;
    kept.push(chain[j]);
    i = j;
  }
  const points = kept.map(at);
  points[0] = { x: from.x, z: from.z };
  if (exact) { if (points.length > 1) points[points.length - 1] = { x: to.x, z: to.z }; else points.push({ x: to.x, z: to.z }); }
  return { points, exact, cells };
}
/**
 * Where the auto-walk heads this frame. pos: { x, z }; route: gridPath's points; st: { i, side } (the corner being walked to,
 * and the side last steered round something; kept here). free(x, z): can the walker stand there right now (cars and posts
 * count). Writes into out: dx, dz (a unit heading on the ground; 0, 0 at the end), left (m of route still to walk), done.
 */
export function walkSteer(pos, route, st, free, out = {}) {
  const last = route.length - 1;
  if (st.i < 1) st.i = 1; // the first point is where the walk began
  while (st.i < last && Math.hypot(route[st.i].x - pos.x, route[st.i].z - pos.z) < AUTO_WALK.reach) st.i++;
  if (st.i > last) st.i = last;
  let dx = route[st.i].x - pos.x, dz = route[st.i].z - pos.z;
  const d = Math.hypot(dx, dz);
  out.left = d;
  for (let k = st.i; k < last; k++) out.left += Math.hypot(route[k + 1].x - route[k].x, route[k + 1].z - route[k].z);
  out.done = st.i === last && d < AUTO_WALK.arrive;
  out.dx = 0; out.dz = 0;
  if (out.done || d < 1e-6) return out;
  dx /= d; dz /= d;
  // A heading is clear when the walker could stand half a step and a whole step along it.
  const look = Math.min(AUTO_WALK.look, d);
  const clear = (hx, hz, len) => free(pos.x + hx * len * 0.5, pos.z + hz * len * 0.5) && free(pos.x + hx * len, pos.z + hz * len);
  if (!free || clear(dx, dz, look)) st.side = 0;
  else {
    // Something the plan did not know stands in the next step: steer round it, the side taken last time first.
    const first = st.side < 0 ? -1 : 1;
    scan: for (const a of AUTO_WALK.turns) {
      for (let n = 0; n < 2; n++) {
        const s = n ? -first : first, c = Math.cos(a * s), w = Math.sin(a * s), rx = dx * c + dz * w, rz = dz * c - dx * w;
        if (!clear(rx, rz, AUTO_WALK.look)) continue;
        dx = rx; dz = rz; st.side = s;
        break scan;
      }
    }
  }
  out.dx = dx; out.dz = dz;
  return out;
}
/**
 * Seconds the auto-walk has gone without getting AUTO_WALK.gain m nearer along its route. st: { best, t } (kept here; start
 * with best Infinity). rebase: the route was planned again, so `left` is measured on a new route and the clock runs on.
 */
export function walkStall(st, left, dt, rebase = false) {
  if (rebase) st.best = left;
  else if (!(left > st.best - AUTO_WALK.gain)) { st.best = left; st.t = 0; return 0; }
  st.t += dt;
  return st.t;
}
/** Top speed (m/s) with `left` m of route to go: `run`, easing down to `walk` over the last few metres. */
export function walkPace(left, walk, run) {
  return Math.max(walk, Math.min(run, walk + (left - 1) * 1.5));
}
/** Does the auto-walk end now? The player's own input wins at once: the stick, a movement key, a sheet (input switched off), a taxi; so does a guide that is gone. */
export function autoWalkEnds({ joy = 0, keys = 0, locked = false, driving = false, guide = true } = {}) {
  return joy > 0.08 || keys > 0 || !!locked || !!driving || !guide;
}

// ---- compact phone HUD -----------------------------------------------------------------------------------------
// A phone held upright or on its side (index.html repeats this query for its compact HUD block; tablets and desktop
// windows keep the full left column). On a touch device inside it the left column is one identity + coin row, the next
// goal and the guest warning as slim pills, and the wallet chips move into the wallet sheet.
export const COMPACT_HUD_Q = '(orientation: portrait) and (max-width: 599px), (orientation: landscape) and (max-height: 520px)';

// ---- bake ------------------------------------------------------------------------------------------------------
// One bake is BAKE_FLIPS flips, one every BAKE_ROUND_MS (about 8 s). The result is the best flip. It pays nothing.
export const BAKE_FLIPS = 3, BAKE_ROUND_MS = 2600;
/** 'gold' | 'good' | 'miss' for a needle position 0..1. */
export function bakeFlip(p) {
  const v = Number(p);
  if (v >= 0.47 && v <= 0.53) return 'gold';
  if (v >= 0.38 && v <= 0.62) return 'good';
  return 'miss';
}
/** The best of the flips: 'gold' over 'good' over 'miss'. */
export function bakeBest(flips) {
  const list = Array.isArray(flips) ? flips : [];
  if (list.includes('gold')) return 'gold';
  if (list.includes('good')) return 'good';
  return 'miss';
}
