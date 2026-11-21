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
 */
export function cineCancels({ active = false, back = false, pin = false, keys = 0, joy = 0, lounge = false } = {}) {
  if (!active || back || pin) return false;
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
