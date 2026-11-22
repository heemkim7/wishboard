// Pure rules for the plaza's interactions and feedback (ground coins, taxi exit and offers, the floating stick, the
// touch-device test, the bake rounds). No DOM, no three.js: ui.js, main.js and timesSquare3d.js call these, and
// test/interact.test.mjs pins them.

// ---- ground coins ----------------------------------------------------------------------------------------------
// The Room pays one sidewalk coin per MINE and refuses one that comes too soon (worker.js MINE_GAP 2 s). The client
// sends at most one MINE per COIN_GAP_MS and none while one is waiting for its PAY (up to COIN_WAIT_MS), and after an
// hour cap it stops for COIN_CAP_MS. The wallet still changes only when PAY arrives.
export const COIN_GAP_MS = 2100, COIN_WAIT_MS = 3000, COIN_CAP_MS = 60000;
/** true when a MINE may go out now. st: { at: last send (ms), wait: a send is waiting for its PAY, block: no send before (ms) }. */
export function coinGate(st, now) {
  const at = Number(st?.at) || 0;
  if (st?.wait) return false;
  if (now < (Number(st?.block) || 0)) return false;
  return !at || now - at >= COIN_GAP_MS;
}

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
// The Room pays one fare per FARE_GAP_S (PAY.fare.gapMs 40 s, counted from the last paid drop-off). A new passenger
// is offered OFFER_RIDE_S before that gap ends (a ride takes at least that long), never sooner than OFFER_MIN_S after
// the last job; a cab that reaches the drop-off early waits there (fareWait) instead of sending a fare that is refused.
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

// ---- compact phone HUD -----------------------------------------------------------------------------------------
// A phone held upright or on its side (index.html repeats this query for its compact HUD block; tablets and desktop
// windows keep the full left column). On a touch device inside it the left column is one identity + coin row, the next
// goal and the guest warning as slim pills, and the wallet chips move into the wallet sheet.
export const COMPACT_HUD_Q = '(orientation: portrait) and (max-width: 599px), (orientation: landscape) and (max-height: 520px)';
/** The fever gauge as a compact chip: hidden while it is empty and idle. fever: ui.js renderHud's hd.fever (or null). */
export function feverChip(fever) {
  const gauge = Math.max(0, Math.floor(Number(fever?.gauge) || 0));
  const left = Math.max(0, Math.ceil(Number(fever?.left) || 0));
  if (fever?.phase === 'party') return { show: true, text: `2배 ${left}초` };
  if (fever?.phase === 'count') return { show: true, text: `2배까지 ${left}초` };
  return { show: gauge > 0, text: `2배 ${gauge}/20` };
}

// ---- bake ------------------------------------------------------------------------------------------------------
// One bake session is BAKE_FLIPS flips, one every BAKE_ROUND_MS, so the round ends when the Room's 8 s session can
// pay (balance.js PAY.bake.minS). The session result is the best flip.
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
