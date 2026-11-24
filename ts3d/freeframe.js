// The street-screen card on a desktop window (the welcome board and 오늘 할 일's card, timesSquare3d.js welcome): the board camera
// (slotPose) fits the face to the whole window, but the HUD's left column (about 354 px, taller with the to-do card) and the minimap
// column lie over the window's sides, so the card's left part was under the column. freeFrame keeps the camera where the board camera
// put it (its line of sight to the face is the one slotPose checked) and only turns it about the vertical axis, so the face's centre
// lands in the middle of the free band, widening the lens just enough for the four corners to fall inside that band. Phones and
// tablets do not ask for it (their HUD is laid out around the view). No three.js here: plain numbers, so Node tests can project.

const DEG = Math.PI / 180;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);
const unit = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/** Where p falls in a W x H window for a camera at cam looking at look (world up +Y), vertical FOV vfov degrees.
 *  -> { x, y } in pixels from the top left, or null behind the camera. */
export function projectPx(p, cam, look, vfov, W, H) {
  const f = unit(sub(look, cam));
  const r = unit(cross(f, { x: 0, y: 1, z: 0 }));
  const u = cross(r, f);
  const d = sub(p, cam), z = dot(d, f);
  if (!(z > 1e-6)) return null;
  const t = Math.tan((vfov * DEG) / 2), aspect = W / H;
  const nx = dot(d, r) / (z * t * aspect), ny = dot(d, u) / (z * t);
  return { x: ((nx + 1) / 2) * W, y: ((1 - ny) / 2) * H };
}
/** The face's four corners: centre c, unit right and up vectors, w x h metres. */
export function faceCorners({ c, right, up, w, h }) {
  const out = [];
  for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) out.push({ x: c.x + right.x * w * sx + up.x * h * sy, y: c.y + right.y * w * sx + up.y * h * sy, z: c.z + right.z * w * sx + up.z * h * sy });
  return out;
}
// look turned by b radians about the vertical axis through cam (three.js's rotation about +Y).
function turn(cam, look, b) {
  const dx = look.x - cam.x, dz = look.z - cam.z, c = Math.cos(b), s = Math.sin(b);
  return { x: cam.x + dx * c + dz * s, y: look.y, z: cam.z - dx * s + dz * c };
}

// The look that puts the face's centre on x = target for a camera at cam (turned about the vertical axis only). The centre's x grows
// or falls steadily with the turn, so the range is halved.
function aim(cam, look, c, v, W, H, target) {
  const centreX = (b) => projectPx(c, cam, turn(cam, look, b), v, W, H)?.x;
  let lo = -0.8, hi = 0.8;
  const xl = centreX(lo), xh = centreX(hi);
  if (xl === undefined || xh === undefined) return null;
  const rising = xh > xl;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2, x = centreX(mid);
    if (x === undefined) return null;
    if ((x < target) === rising) lo = mid; else hi = mid;
  }
  return turn(cam, look, (lo + hi) / 2);
}

/**
 * The frame for a face in the part of a W x H window that is not under the HUD's columns.
 * o: { cam, look (the face's centre, as slotPose aims), face: { c, right, up, w, h }, vfov (degrees, the frame's own), W, H,
 *      left (px under the left column, from the left edge), right (px under the right column, from the right edge), pad (px),
 *      back (the camera may step back along its own line to the face, up to this many times its distance), sees(p) (does a camera
 *      at p still see the face: walls, the ground; the world's test), widen (degrees the lens may open at the farthest spot that sees) }
 * The camera steps back first (the board camera's lens, its look turned); where the next step would not see the face it stops and
 * opens the lens instead, a little at most.
 * -> { cam, look, fov } (fov >= vfov), or null when the band is too narrow or nothing fits (the caller keeps its frame).
 */
export function freeFrame({ cam, look, face, vfov = 55, W = 0, H = 0, left = 0, right = 0, pad = 16, back = 2.2, widen = 20, sees = null } = {}) {
  if (!cam || !look || !face || !(W > 0) || !(H > 0)) return null;
  const x0 = left + pad, x1 = W - right - pad;
  if (!(x1 - x0 > W * 0.3)) return null;
  const target = (x0 + x1) / 2;
  const corners = faceCorners(face);
  const spot = (k) => ({ x: face.c.x + (cam.x - face.c.x) * k, y: face.c.y + (cam.y - face.c.y) * k, z: face.c.z + (cam.z - face.c.z) * k });
  const frame = (at, v) => {
    const to = aim(at, look, face.c, v, W, H, target);
    if (!to) return null;
    const fits = corners.every((p) => { const s = projectPx(p, at, to, v, W, H); return s && s.x >= x0 && s.x <= x1 && s.y >= pad && s.y <= H - pad; });
    return fits ? { cam: at, look: to, fov: v } : null;
  };
  let last = cam;
  for (let k = 1; k <= Math.max(1, back) + 1e-9; k += 0.04) {
    const at = k === 1 ? cam : spot(k);
    if (k > 1 && sees && !sees(at)) break;
    last = at;
    const f = frame(at, vfov);
    if (f) return f;
  }
  for (let v = vfov + 0.5; v <= vfov + widen + 1e-9; v += 0.5) {
    const f = frame(last, v);
    if (f) return f;
  }
  return null;
}
