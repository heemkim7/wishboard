// Camera and prompt decisions for timesSquare3d.js, kept free of three.js so node can test them (test/camrig.test.mjs).
// Nothing here reads or writes the network: the camera only decides where the view is, never where the avatar is.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// ---- scripted cameras (focus, lounge tour, intro) -----------------------------------------------------------
// Every scripted camera ends the same way: an ease-out back to the orbit the player left. The orbit itself keeps
// running underneath (camWant is never overwritten by a scripted camera), so the tween target is always live.
export const RETURN_MS = 450;
export const easeOutCubic = (u) => 1 - (1 - clamp(num(u), 0, 1)) ** 3;
export const easeInOutCubic = (u) => { const x = clamp(num(u), 0, 1); return x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2; };
export function tweenU(now, t0, dur) { return dur > 0 ? clamp((now - t0) / dur, 0, 1) : 1; }
/** Point of the return tween at progress u (0 = where the scripted camera was, 1 = exactly the orbit pose). */
export function returnPoint(from, to, u, out = {}) {
  const e = easeOutCubic(u);
  out.x = from.x + (to.x - from.x) * e;
  out.y = from.y + (to.y - from.y) * e;
  out.z = from.z + (to.z - from.z) * e;
  return out;
}
/** focusSlot(slot, n) keeps meaning "hold n ms"; focusSlot(slot, { hold, celebrate }) is the long form. */
export function focusOptions(arg) {
  if (arg && typeof arg === 'object') return { hold: Math.max(0, num(arg.hold)), celebrate: arg.celebrate === true };
  return { hold: Math.max(0, num(arg)), celebrate: false };
}
/**
 * Does input end the scripted camera now? Only a camera that is going to or holding on a board (not one already
 * returning, not the pinned photo frame). `hidden` (own avatar not drawn, as in a taxi) deliberately plays no part.
 * `locked`: input is switched off (a sheet is open), so a key still held or a thumb resting on the stick is not input.
 */
export function cineCancels({ active = false, back = false, pin = false, keys = 0, joy = 0, lounge = false, locked = false } = {}) {
  if (!active || back || pin || locked) return false;
  return keys > 0 || joy > (lounge ? 0.25 : 0.08);
}
/** Orbit pose behind a car: `polar` from straight up, like the driving auto-yaw. */
export function behindCar(follow, yaw, dist, polar = 1.2) {
  const a = yaw + Math.PI, s = Math.sin(polar);
  return { x: follow.x + dist * s * Math.sin(a), y: follow.y + dist * Math.cos(polar), z: follow.z + dist * s * Math.cos(a) };
}

// ---- on-foot follow ------------------------------------------------------------------------------------------
export const FOLLOW = { idleMs: 1500, rate: 1.2 };
/**
 * How fast the on-foot camera turns toward the heading, in rad/s; positive = toward the player's right.
 * f / r are the camera-relative input (forward, right). Nothing while dragging or within idleMs of the last drag,
 * nothing when walking straight back toward the lens, and less the more the input points backward.
 */
export function followYawRate({ f = 0, r = 0, idleMs = 0, dragging = false } = {}) {
  if (dragging || !(idleMs > FOLLOW.idleMs)) return 0;
  const n = Math.hypot(f, r);
  if (!(n >= 0.1)) return 0;
  const side = r / Math.max(1, n);
  const back = f < 0 ? Math.min(1, -f / n) : 0;
  return FOLLOW.rate * side * (1 - back);
}
/** Vertical FOV for the frame: `base` in landscape, `tall` once the frame is clearly portrait, blended in between. */
export function portraitFov(aspect, base, tall = 72) {
  const a = Number(aspect);
  if (!(a > 0) || !(tall > base)) return base;
  return base + (tall - base) * clamp((1 - a) / 0.25, 0, 1);
}
/** Distance that keeps a subject the same size when the vertical FOV changes from fovFrom to fovTo (degrees). */
export function fitDistance(dist, fovFrom, fovTo) {
  const t = (deg) => Math.tan((deg * Math.PI) / 360);
  return dist * t(fovFrom) / t(fovTo);
}

// ---- framing a board -----------------------------------------------------------------------------------------
// One rule for every scripted board camera (보기, the claim focus, the lounge tour, the photo frame): the whole face is
// in the frame with `margin` of the frame left free on each side, for the frame's aspect and its settled vertical FOV.
export const FRAME = { margin: 0.08, max: 48 };
/** Range (m) from which a w x h face fits the frame: the larger of the width fit and the height fit. vfov in degrees. */
export function frameDistance({ w = 0, h = 0, aspect = 1, vfov = 55, margin = FRAME.margin } = {}) {
  const t = Math.tan((clamp(num(vfov, 55), 10, 150) * Math.PI) / 360);
  const a = num(aspect) > 0 ? num(aspect) : 1;
  const keep = 1 - 2 * clamp(num(margin), 0, 0.4);
  return Math.max(Math.max(0, num(w)) / a, Math.max(0, num(h))) / (2 * t * keep);
}
/** The range a board camera uses: the caller's own distance, farther when the face would not fit, never past `max`. */
export function boardRange(dist, fit, max = FRAME.max) {
  const d = Math.max(0, num(dist));
  return Math.max(d, Math.min(num(fit), max));
}

// ---- driving camera ------------------------------------------------------------------------------------------
export const DRIVE_CAM = { swingMin: 3, reverseHold: 1.2 };
/** Seconds spent reversing without a break. */
export function reverseTime(t, v, dt) { return v < -0.3 ? num(t) + dt : 0; }
/** swing: may the camera turn by itself (never under 3 m/s); front: look back over the car (only after 1.2 s in reverse). */
export function driveCamera({ v = 0, reverseT = 0 } = {}) {
  return { swing: Math.abs(v) >= DRIVE_CAM.swingMin, front: v < 0 && reverseT > DRIVE_CAM.reverseHold };
}

// ---- collision -----------------------------------------------------------------------------------------------
/** Camera distance after a wall test: pulled in at once, let back out over about a quarter second. */
export function easeCamDist(prev, want, dt, rate = 12) {
  if (!(prev < want)) return want;
  const next = prev + (want - prev) * (1 - Math.exp(-dt * rate));
  return want - next < 0.01 ? want : next;
}
/**
 * A scripted camera `dist` m in front of a board, with a wall at fraction `frac` of the ray that starts `start` m out
 * (1 = clear): stop `pad` m short of the wall, but never closer than `min`.
 */
export function shortenFocus(dist, frac, { start = 2.5, pad = 0.8, min = 6 } = {}) {
  if (!(frac < 1)) return dist;
  const hit = start + Math.max(0, frac) * (dist - start);
  return Math.max(Math.min(min, dist), Math.min(dist, hit - pad));
}

// ---- board proximity and prompts -----------------------------------------------------------------------------
export const BOARD_NEAR = 12;
/** The board whose front point is nearest, within maxR. fronts: [{ id, x, z, y }]; unmounted boards are just absent. */
export function pickNearBoard(x, z, fronts, maxR = BOARD_NEAR) {
  let best = null, bd = 0;
  for (const f of fronts || []) {
    if (!f || !Number.isFinite(f.x) || !Number.isFinite(f.z)) continue;
    const d = Math.hypot(f.x - x, f.z - z);
    if (d > maxR) continue;
    // Stacked faces share one front point: the lowest one is the one in front of a walker.
    if (!best || d < bd - 0.5 || (d <= bd + 0.5 && num(f.y) < num(best.y))) { best = f; bd = d; }
  }
  return best;
}
export function boardState(board, me, now = Date.now()) {
  const holder = board?.holder_id || '';
  if (holder && me && holder === me) return 'mine';
  const until = board?.lit_until || board?.expires_at;
  if (holder && until && new Date(until).getTime() > now) return 'other';
  return holder ? 'dark' : 'free';
}
/** The E prompt for a board: [title, sub, button]. name is the slot's display name. */
export function boardPrompt({ board, me, now = Date.now(), name = '' } = {}) {
  const state = boardState(board, me, now);
  const who = Array.from(String(board?.holder_name || '익명')).slice(0, 12).join('');
  if (state === 'mine') return { state, who: '', p: ['내 전광판 · 불 켜기/수정', name, '수정'] };
  if (state === 'other') return { state, who, p: [`${who}님의 전광판 · 응원하기`, name, '응원'] };
  return { state, who: '', p: ['빈 전광판 · 소원 걸기', name, '걸기'] };
}
/** Changes whenever the prompt should be redrawn: kind, target, neighbour count, board state and holder. */
export function proximityKey(nk) {
  if (!nk) return '';
  return nk.kind + (nk.id ?? '') + (nk.i ?? '') + (nk.n ? '#' + nk.n : '') + (nk.s ? ':' + nk.s + ':' + (nk.who || '') : '');
}
export const FAR_TAP = { board: 60, atm: 18 };
/**
 * What a tap on a picked object does. 'open' is the old behaviour (sheet / ATM hub); a board beyond 60 m or tapped
 * from a taxi gets the small card; a far ATM (or one tapped from a taxi) gets a waypoint.
 */
export function tapRoute({ kind, dist, driving = false, near = false } = {}) {
  const d = Number(dist);
  if (kind === 'billboard') return driving || d > FAR_TAP.board ? 'card' : 'open';
  if (kind === 'atm') return !near && (driving || d > FAR_TAP.atm) ? 'waypoint' : 'open';
  return 'open';
}

// ---- small rules ---------------------------------------------------------------------------------------------
export const EMOTE_GAP_MS = 700;
export function cooldownOk(now, last, ms) { return !(now - last < ms); }
/** A gift board's first line is "To. name" (ui.js writes it that way). */
export function isGiftBoard(data) { return /^To\.\s*\S/.test(String(data?.line1 || '')); }

export const FIREWORK = { cap: 14, hard: 28, fade: 0.35 };
/** Over the cap: the oldest bursts that are not fading yet start a short fade (fadeAt = their age) instead of vanishing. */
export function fadeOldest(list, cap = FIREWORK.cap) {
  let live = 0;
  for (const f of list) if (!(f.fadeAt >= 0)) live++;
  for (let i = 0; i < list.length && live > cap; i++) {
    if (list[i].fadeAt >= 0) continue;
    list[i].fadeAt = list[i].age;
    live--;
  }
  return list;
}
export function fireworkAlpha(age, life, fadeAt = -1, fade = FIREWORK.fade) {
  const u = age / life;
  const a = 1 - u * u;
  return Math.max(0, fadeAt >= 0 ? a * (1 - (age - fadeAt) / fade) : a);
}
export function fireworkDone(age, life, fadeAt = -1, fade = FIREWORK.fade) {
  return age >= life || (fadeAt >= 0 && age - fadeAt >= fade);
}

// ---- sparks --------------------------------------------------------------------------------------------------
// A spark starts at its burst with velocity v0 and is slowed by drag and pulled down by gravity. Its place t seconds
// later is v0 * sparkGlide(t) with sparkDrop(t) taken off its height: the world draws exactly this, at any frame rate.
export const SPARK = { drag: 1.5, grav: 5.2, life: 2.4 };
/** Metres travelled per m/s of start speed after t s. */
export function sparkGlide(t, drag = SPARK.drag) { return (1 - Math.exp(-drag * t)) / drag; }
/** Metres fallen after t s. */
export function sparkDrop(t, drag = SPARK.drag, grav = SPARK.grav) { return (grav / drag) * (t - sparkGlide(t, drag)); }

// ---- board celebrations --------------------------------------------------------------------------------------
// A claim's fireworks frame the board and never cover it. Positions are in the board's own frame: u along its right
// edge, v up, n along its normal (toward the viewer), origin at the centre of the face. Every burst is a fan in the
// board's plane that opens away from the face: side fans and rockets sit beyond the side edges and only throw outward,
// the top fan sits above the top edge by more than its sparks can fall. So no spark is over the w x h face, and none is
// between the face and a camera in front of it.
export const CELEBRATE_GAP_MS = 4000;
/** One celebration per board per claim: false while the last one on that board is younger than the gap. */
export function celebrationDue(last, now, gap = CELEBRATE_GAP_MS) { return !(now - last < gap); }
/** A face with another claimable face right above it (the main stack, the lower corner board): no fan above its top edge. */
export function faceAbove(slotId) { return /^(MAIN_(LOW|BOT|MID|TOP)|SUB_[1-4]B)$/.test(String(slotId || '')); }
// Celebration sparks hang longer and fall less than the other bursts, and are gone in 1.4 s.
export const PARTY = { drag: 1.8, grav: 1.6, life: 1.4, gain: 1.35, flashGain: 1.1, flat: 0.2, riseT: 0.35 };
/**
 * The bursts for one board. w, h: the face in metres; tier 'S' | 'B' | 'C' sets how many rockets; low: the phone tier;
 * top: false when another face is right above (faceAbove); cheer: the small version for 응원.
 * Returns { size, gain, flashGain, drag, grav, life, rocket, total, end, bursts }. Each burst: { u, v, n } where it
 * goes off, out (unit direction of the fan in the plane) and arc (half-angle, rad), speed (fastest spark, m/s), flat
 * (how far a spark may leave the plane, as a share of its speed), count, flash (sprite width, m), delay (s), hue
 * (0 = the board's colour, 1.. = a palette colour), and for a rocket rise (m climbed below the burst) and riseT (s).
 */
export function celebrationPlan({ w = 0, h = 0, tier = 'C', low = false, top = true, cheer = false } = {}) {
  const H = Math.max(0.5, num(h, 4)), W = Math.max(0.5, num(w, H * 16 / 9));
  const m = clamp(H, 1.5, 14); // everything scales with the height of the face
  const { drag, grav, life, gain, flashGain, flat, riseT } = PARTY;
  const size = clamp(0.085 * m, 0.28, 0.95);
  const gap = clamp(0.16 * m, 0.4, 2.2);
  const small = cheer ? 0.7 : 1;
  const speed = (clamp(0.42 * m, 1.2, 5.5) * small) / sparkGlide(life, drag);
  const flash = 1.6 * gap * small;
  // Above the top edge by more than a spark with no upward speed falls in its life, plus half a sprite.
  const lift = Math.max(gap, sparkDrop(life, drag, grav) + size / 2 + 0.1);
  const share = (low ? 0.6 : 1) * (cheer ? 0.6 : 1);
  const n = (base) => Math.max(6, Math.round(base * share));
  const hw = W / 2, hh = H / 2;
  const bursts = [];
  const fan = (u, v, out, arc, count, delay, hue = 0, rise = 0) => bursts.push({ u, v, n: 0, out, arc, speed, flat, count, flash, delay, hue, rise, riseT: rise ? riseT : 0 });
  // Beyond each side edge, opening outward and upward (from 49° below level to straight up).
  const sideN = n(10 + 1.6 * m + (top || cheer ? 0 : 0.8 * m));
  for (const s of [-1, 1]) fan(s * (hw + gap), hh * 0.2, [s * Math.cos(0.35), Math.sin(0.35)], 1.2, sideN, s < 0 ? 0 : 0.12);
  // Above the top edge, opening upward.
  if (top && !cheer) fan(0, hh + lift, [0, 1], 1.35, n(12 + 2.2 * m), 0.3);
  // Rockets climb beside the board and go off above its top corners, opening outward and upward.
  const pairs = cheer ? 0 : low ? { S: 1, B: 1, C: 0 }[tier] ?? 0 : { S: 2, B: 1, C: 1 }[tier] ?? 1;
  const rise = clamp(H + lift, 2.5, 12);
  const shell = (s, p, delay, hue) => fan(s * (hw + gap * (1 + 1.4 * p)), hh + lift * (1 + 0.8 * p), [s * Math.cos(0.9), Math.sin(0.9)], 0.65, n(12 + 1.7 * m), delay, hue, rise);
  for (let p = 0; p < pairs; p++) for (const s of [-1, 1]) shell(s, p, 0.55 + 0.3 * p + (s > 0 ? 0.08 : 0), 1 + p * 2 + (s > 0 ? 1 : 0));
  if (cheer && !low) shell(1, 0, 0.2, 1);
  let total = 0, end = 0;
  for (const b of bursts) { total += b.count; end = Math.max(end, b.delay + b.riseT + life); }
  return { size, gain, flashGain, drag, grav, life, rocket: clamp(2 * size, 0.45, 0.9), total, end, bursts };
}
/**
 * Start velocity [u, v, n] (m/s) of one spark of a burst. ra, rs, rn are three numbers 0..1 (angle across the fan,
 * speed, depth): the world feeds Math.random(), the tests walk the corners.
 */
export function fanVelocity(b, ra, rs, rn) {
  const a = Math.atan2(b.out[1], b.out[0]) + (ra * 2 - 1) * b.arc;
  const s = b.speed * (0.45 + 0.55 * rs);
  return [Math.cos(a) * s, Math.sin(a) * s, (rn * 2 - 1) * b.flat * s];
}
