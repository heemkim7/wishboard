// Camera and prompt decisions for timesSquare3d.js, kept free of three.js so node can test them (test/camrig.test.mjs).
// Nothing here reads or writes the network: the camera only decides where the view is, never where the avatar is.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const wrap = (a) => ((((a % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI);

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
// Keys (WASD and the arrows, with a mouse for the view): the view turns with the sideways keys.
export const FOLLOW = { idleMs: 1500, rate: 1.2 };
/**
 * How fast the on-foot camera turns toward the heading under the keys, in rad/s; positive = toward the player's right.
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
// The touch stick and the auto-walk (interact.js): the view comes round behind the direction of travel and stays there, so a
// walk needs no second finger on the view. The stick used the rule above: it turns only by the stick's sideways part, so the
// heading stays as far off the view's axis as the thumb is off straight up. An upright phone shows 37° across (72° tall), so
// any push more than 18° off straight up walked out of the frame (straight sideways: 2.7 m of ground ahead), and a walk back
// never turned the view at all.
//   holdMs    a drag of the view wins: nothing for this long after one
//   gain/max  the turn is gain x the angle left (rad/s per rad), at most max rad/s (103°/s): a walk 90° to the side has the
//             view within 5° of straight behind in 1.3 s, a walk straight back (after backMs) in 2.8 s
//   backAngle a walk back toward the lens (more than this off the view) turns only once it has lasted backMs: a few steps
//             back from a board keep the board in view
export const CHASE = { holdMs: 2500, gain: 2.5, max: 1.8, dead: 0.02, backAngle: 2.1, backMs: 600 };
/**
 * How fast the view turns toward the direction of travel, in rad/s of heading (+ = counter-clockwise seen from above).
 * err: the travel heading minus the view's heading (rad, wrapped). idleMs: since the last drag of the view ended.
 * scripted: a scripted camera (a board focus, the lounge tour, the photo frame) is on. backMs: how long the walk has been
 * pointing back toward the lens.
 */
export function chaseYawRate({ err = 0, idleMs = Infinity, dragging = false, scripted = false, backMs = Infinity } = {}) {
  if (scripted || dragging || !(idleMs > CHASE.holdMs)) return 0;
  const e = num(err), a = Math.abs(e);
  if (!(a > CHASE.dead)) return 0;
  if (a > CHASE.backAngle && !(backMs >= CHASE.backMs)) return 0;
  return Math.sign(e) * Math.min(CHASE.max, CHASE.gain * a);
}
// The stick is read against the view as it was before the chase turned it: `lag` is how far the chase has turned the view
// since the thumb last moved. A thumb held still therefore walks one straight line while the view comes round behind it
// (read against the live view, the heading would turn with the view and the walk would never stop circling). Moving the
// thumb takes the lag back out: a move under `dead` is steering on the line being walked, a move of `full` or more reads the
// stick against the live view again, in between a share of the lag stays.
export const STICK_FRAME = { dead: 0.14, full: Math.PI / 4 };
/**
 * One frame of the stick's frame. st: { ref, lag } (ref null: the stick was at rest; this function writes it).
 * angle: where the thumb points now (rad from straight up), null at rest. Returns st.
 */
export function stickFrame(st, angle) {
  if (angle == null || !Number.isFinite(angle)) { st.ref = null; st.lag = 0; return st; }
  if (st.ref == null) { st.ref = angle; st.lag = 0; return st; }
  const d = Math.abs(wrap(angle - st.ref));
  if (d <= STICK_FRAME.dead) return st;
  st.ref = angle;
  st.lag *= Math.max(0, 1 - d / STICK_FRAME.full);
  return st;
}
// A touch on the view that did not turn it (a tap on a board) is not a drag: it does not hold the follow rules above off.
export const DRAG_MIN = 0.035;
/** Did a touch turn the view? dYaw, dPolar: how far the orbit moved between its start and its end (rad). */
export function viewDragged(dYaw, dPolar) {
  return Math.abs(wrap(num(dYaw))) > DRAG_MIN || Math.abs(num(dPolar)) > DRAG_MIN;
}
/** 0 in a landscape or square frame, 1 once the frame is clearly upright (0.75 wide to 1 tall or narrower), blended in between. */
export function tallness(aspect) {
  const a = Number(aspect);
  return a > 0 ? clamp((1 - a) / 0.25, 0, 1) : 0;
}
/** Vertical FOV for the frame: `base` in landscape, `tall` once the frame is clearly portrait, blended in between. */
export function portraitFov(aspect, base, tall = 72) {
  if (!(tall > base)) return base;
  return base + (tall - base) * tallness(aspect);
}
/** Distance that keeps a subject the same size when the vertical FOV changes from fovFrom to fovTo (degrees). */
export function fitDistance(dist, fovFrom, fovTo) {
  const t = (deg) => Math.tan((deg * Math.PI) / 360);
  return dist * t(fovFrom) / t(fovTo);
}

// ---- framing a board -----------------------------------------------------------------------------------------
// One rule for every scripted board camera (보기, the claim focus, the lounge tour, the photo frame): the whole face is
// in the frame with `margin` of the frame left free on each side, for the frame's aspect and its settled vertical FOV.
// A small face must not end up as a far, empty frame either: the caller's own distance counts only up to `loose` times
// the fit (never under `near`), so a lot board is about half the frame wide instead of a quarter.
export const FRAME = { margin: 0.08, max: 48, loose: 1.7, near: 6 };
/** Range (m) from which a w x h face fits the frame: the larger of the width fit and the height fit. vfov in degrees. */
export function frameDistance({ w = 0, h = 0, aspect = 1, vfov = 55, margin = FRAME.margin } = {}) {
  const t = Math.tan((clamp(num(vfov, 55), 10, 150) * Math.PI) / 360);
  const a = num(aspect) > 0 ? num(aspect) : 1;
  const keep = 1 - 2 * clamp(num(margin), 0, 0.4);
  return Math.max(Math.max(0, num(w)) / a, Math.max(0, num(h))) / (2 * t * keep);
}
/**
 * The range a board camera uses: the caller's own distance, farther when the face would not fit (up to `max`), and
 * nearer when the face would be lost in the frame from there (the caller's distance is cut to `loose` x the fit).
 */
export function boardRange(dist, fit, max = FRAME.max) {
  const d = Math.max(0, num(dist));
  const f = num(fit);
  if (!(f > 0)) return d;
  const far = Math.max(FRAME.near, f * FRAME.loose);
  return Math.max(Math.min(d, far), Math.min(f, max));
}
/**
 * Range from which a w x h face seen `yaw` radians off its normal fits the frame: the near edge is the one that
 * matters (it is wider and taller on screen than the far one). yaw 0 is frameDistance.
 */
export function angledFit({ w = 0, h = 0, aspect = 1, vfov = 55, margin = FRAME.margin, yaw = 0 } = {}) {
  const tv = Math.tan((clamp(num(vfov, 55), 10, 150) * Math.PI) / 360) * (1 - 2 * clamp(num(margin), 0, 0.4));
  const th = tv * (num(aspect) > 0 ? num(aspect) : 1);
  const c = Math.abs(Math.cos(num(yaw))), s = Math.abs(Math.sin(num(yaw)));
  const hw = Math.max(0, num(w)) / 2, hh = Math.max(0, num(h)) / 2;
  return Math.max((hw * c) / th, hh / tv) + hw * s;
}
// ---- a clear vantage on a board ----------------------------------------------------------------------------
// The scripted board camera stands in front of the face. When a building is in the way (a face on a narrow street, or
// one a portrait frame needs 40 m for), it looks for a better spot: turned up to 72° along the street, raised to the
// face's height or above it, and with the lens opened by up to `widen` degrees, keeping the one that sees the most of
// the face with the least cut. Buildings and the other boards' faces both count as in the way (facesBlock). A clear
// straight shot is taken at once, so a board that framed well before frames exactly as before (same spot, same FOV).
export const VANTAGE = { yaws: [0, 15, -15, 30, -30, 45, -45, 60, -60, 72, -72], start: 2.5, widen: 12, snug: 0.92 };
/**
 * face: { x, y, z, nx, nz, w, h } (centre, horizontal unit normal, size in m). dist: the caller's own range.
 * aspect, vfov (deg): the frame. block(ax, ay, az, bx, by, bz): clear fraction of that segment (1 = clear; nyc.rayBlock).
 * ground(x, z): floor height. level: the camera at the face's own height (the straight-on photo frame).
 * Returns { x, y, z, dist, yaw, fov, fit, seen }: fov the vertical FOV to frame it with (vfov unless it had to open up);
 * fit 1 = the whole face in that frame with the margin (0.84 = edge to edge); seen = the share of seven points on the
 * face (centre, the four corners and the two side edges, 4% in) with nothing between them and the camera.
 */
export function boardVantage({ face, dist = 18, aspect = 1, vfov = 55, block = () => 1, ground = () => 0, level = false } = {}) {
  const f = face || {};
  const fx = num(f.x), fy = num(f.y), fz = num(f.z), w = Math.max(0, num(f.w)), h = Math.max(0, num(f.h));
  let nx = num(f.nx), nz = num(f.nz, 1);
  const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
  const rx = nz, rz = -nx; // the face's right, on the ground
  const pts = [[0, 0], [-0.46, -0.4], [0.46, -0.4], [-0.46, 0.4], [0.46, 0.4], [-0.46, 0], [0.46, 0]].map(([u, v]) => [fx + rx * u * w + nx * 0.6, fy + v * h, fz + rz * u * w + nz * 0.6]);
  const S = VANTAGE.start, v0 = clamp(num(vfov, 55), 10, 150);
  let best = null;
  for (const deg of VANTAGE.yaws) {
    const a = (deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const dx = nx * ca - nz * sa, dz = nx * sa + nz * ca;
    const need = angledFit({ w, h, aspect, vfov: v0, yaw: a });
    const d = boardRange(dist, need);
    const gx = fx + dx * d, gz = fz + dz * d;
    const low = level ? fy : Math.max(fy * 0.42 + 1.8, num(ground(gx, gz)) + 1.6);
    for (const [k, y0] of [low, fy, fy + 0.35 * d, fy + 0.8 * d].entries()) {
      if (k === 1 && Math.abs(y0 - low) < 0.5) continue; // level is the low one already
      const sy = fy + (y0 - fy) * (S / d);
      const clear = d > S ? num(block(fx + dx * S, sy, fz + dz * S, gx, y0, gz), 1) : 1;
      const stand = shortenFocus(d, clear, { start: S });
      const cx = fx + dx * stand, cz = fz + dz * stand;
      const cy = k === 0 && !level ? Math.max(fy * 0.42 + 1.8, num(ground(cx, cz)) + 1.6) : y0;
      let n = 0;
      for (const [px, py, pz] of pts) if (!(num(block(px, py, pz, cx, cy, cz), 1) < 0.999)) n++;
      const seen = n / pts.length;
      // Pulled in short of the fit: open the lens a degree at a time until the face is snug again (or `widen` is used up).
      let fov = v0, fit = need > 0 ? Math.min(1, stand / need) : 1;
      while (fit < VANTAGE.snug && fov < v0 + VANTAGE.widen) { fov++; fit = Math.min(1, stand / angledFit({ w, h, aspect, vfov: fov, yaw: a })); }
      // A turned view shows the face narrower and lets a neighbour's frame in: it has to see clearly more to win.
      const score = seen * fit - 0.08 * (Math.abs(deg) / 60) - 0.03 * k - 0.02 * ((fov - v0) / VANTAGE.widen);
      const c = { x: cx, y: cy, z: cz, dist: stand, yaw: a, fov, fit, seen, score };
      if (!best || score > best.score + 1e-9) best = c;
      // A clear straight shot from far enough back: the same pose as before this search existed.
      if (deg === 0 && k === 0 && seen === 1 && stand >= Math.min(need, FRAME.max) - 1e-6) return c;
    }
  }
  return best;
}

/**
 * A block() for boardVantage from other boards' faces: the clear fraction of a segment before it passes through one of
 * them. faces: [{ pos, right, up, normal, w, h }] (screens.js face(): vectors with x, y, z; unit right / up / normal).
 */
export function facesBlock(faces) {
  const list = (faces || []).filter((f) => f && f.pos && f.normal && f.right && f.up);
  return (ax, ay, az, bx, by, bz) => {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    let best = 1;
    for (const f of list) {
      const n = f.normal, den = dx * n.x + dy * n.y + dz * n.z;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((f.pos.x - ax) * n.x + (f.pos.y - ay) * n.y + (f.pos.z - az) * n.z) / den;
      if (!(t > 0 && t < best)) continue;
      const px = ax + dx * t - f.pos.x, py = ay + dy * t - f.pos.y, pz = az + dz * t - f.pos.z;
      if (Math.abs(px * f.right.x + py * f.right.y + pz * f.right.z) <= f.w / 2 && Math.abs(px * f.up.x + py * f.up.y + pz * f.up.z) <= f.h / 2) best = t;
    }
    return best;
  };
}

// ---- driving camera ------------------------------------------------------------------------------------------
// The view is fixed to the car: behind it, turning with it, at any speed (it used to wait for 3 m/s and for 1.5 s after a
// touch, then close the gap at 2.4 / s: in a full-lock turn, 1.9 rad/s, the view trailed the car by 45°, and an upright phone
// shows only 18.5° either side, so the road the car was turning into was off the screen).
//   ride       the share of the car's own turn the view takes at once; the rest of the way to "straight behind" closes at
//              gain / s, at most max rad/s. A full-lock turn trails by (1 - ride) x 1.9 / gain = 0.114 rad (6.5°).
//   holdMs     a drag looks around; this long after it ends the view starts back. From 180° off it is within 5° in
//              about 1.1 s (60° off: 0.6 s).
//   polar      the orbit's angle from straight up (1.2: 21° above the car). An upright frame is narrow and tall, so there
//              the view stands higher and farther back (polarTall, distTall) and the lens opens widenTall° more.
//   reverse    the view stays behind the car, so the stick steers the way the screen shows; after reverseHold s in reverse
//              it rises to reversePolar and shows the ground behind the car instead of swinging round to its nose.
export const DRIVE_CAM = { ride: 0.7, gain: 5, max: 5, holdMs: 250, polar: 1.2, polarTall: 1.08, polarRate: 3, dist: 11.5, distTall: 13, widenTall: 6, speedWiden: 10, speedTop: 30, reverseHold: 0.6, reversePolar: 0.8 };
/** Seconds spent reversing without a break. */
export function reverseTime(t, v, dt) { return v < -0.3 ? num(t) + dt : 0; }
/** Where the orbit sits behind a car in a frame of this shape: dist (set on getting in; a pinch may change it) and polar. */
export function driveView({ aspect = 1, reverseT = 0 } = {}) {
  const k = tallness(aspect), C = DRIVE_CAM;
  return { dist: C.dist + (C.distTall - C.dist) * k, polar: reverseT > C.reverseHold ? C.reversePolar : C.polar + (C.polarTall - C.polar) * k };
}
/** Degrees the lens opens while driving, on top of the frame's own FOV: for an upright frame, and with speed (m/s). */
export function driveWiden(aspect, speed = 0) {
  return DRIVE_CAM.widenTall * tallness(aspect) + clamp(Math.abs(num(speed)) / DRIVE_CAM.speedTop, 0, 1) * DRIVE_CAM.speedWiden;
}
/**
 * One frame of the driving orbit. theta: the heading from the car to the camera, phi: its angle from straight up (rad).
 * yaw: the car's heading now, turned: how far the car turned this frame. idleMs: since the last drag ended.
 * Writes the new theta and phi into out. While dragging (and for holdMs after) the view only rides the car's turn.
 */
export function driveCamera({ theta = 0, phi = DRIVE_CAM.polar, yaw = 0, turned = 0, dt = 0, idleMs = Infinity, dragging = false, aspect = 1, reverseT = 0 } = {}, out = {}) {
  const ride = DRIVE_CAM.ride * num(turned);
  out.theta = theta + ride;
  out.phi = phi;
  if (dragging || !(idleMs > DRIVE_CAM.holdMs) || !(dt > 0)) return out;
  const left = wrap(yaw + Math.PI - out.theta);
  const pull = clamp(DRIVE_CAM.gain * left, -DRIVE_CAM.max, DRIVE_CAM.max) * dt;
  out.theta += Math.abs(pull) > Math.abs(left) ? left : pull;
  out.phi = phi + (driveView({ aspect, reverseT }).polar - phi) * (1 - Math.exp(-dt * DRIVE_CAM.polarRate));
  return out;
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
