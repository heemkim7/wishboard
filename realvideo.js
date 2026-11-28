// 실사 축하 영상: the in-browser compositor and recorder (docs/superpowers/specs/2026-11-27-real-video-design.md §3). Browser only, loaded
// by the owner page (giftpage.js) when a video is made. It ports tools/plates/scene.py + composite.py to one WebGL fragment shader:
//
//   the plate      the scene's 1080x1920 video, uploaded as a texture for each frame it shows (requestVideoFrameCallback where the
//                  browser has it, else requestAnimationFrame and currentTime -> frame)
//   the screens    per screen and frame the four corners from the plate's JSON -> a homography (output pixel -> card uv); the card
//                  (realcard.js) is drawn for that frame's own time, so the card and the plate never drift apart
//   the key        G - max(R, B) of the plate: the card shows only where the plate is screen-green, so fingers, snow and people in
//                  front of a screen stay in front; small phones use a softer key (and fill a tracked phone the key half-sees)
//   despill        green excess within ~8 px outside a screen goes, fading over 45 px (110 px round a phone), put back in the
//                  board's local colour; below ground.y the wet ground's green reflections take the board's average colour, and
//                  any key-green left anywhere else (phones too small to track, a green sign) does too, dimmed
//   the look       LED dots in texture space (one per 3 output pixels at the narrowest edge), a little light wrap at the edge, bloom
//                  (three half-plane blurs of the edge colour) onto the building; a phone: no dots, brighter, a glass reflection
//   corner         with the plate's camera (plate 6): the corner box (out/popout-2026-11-28): a room behind the frame, the card on a
//                  panel in it, no LED dots, and the day's pop-out (realrules.js popVariant: a gift box with balloons, or the
//                  headline's 3D letters) on the music's beats, drawn over the whole frame (it may leave the screen) before the caption.
//                  Without a camera (or a device that cannot compile it): one card split at `split` over two faces and the small gift
//                  box (corner.py GiftPop) laid on the board before the dots
//   caption        "AI 합성" bottom right (about 24 px cap height at 1080 wide, white 70 %, a soft shadow), and on the free video the
//                  'WISH BOARD' watermark left of it (giftrules.js filmMark: none on a board whose paid order is published)
//
// Recording: the WebGL canvas (captureStream) and a WebAudio mix (the plate's own street sound through a high-pass and a gain that
// sits about -34 LUFS and swells around the flash, plus the occasion's music started at the video's own current time) go to one
// MediaRecorder, MP4 first. The video plays in real time from frame 0 to its last frame; the 241 frames set the length.
import { REAL, homography, invert3, quadAt, frameOf, timeOf, screenStats, texSize, ledCols, ledMean, ambBaseDb, ambCurve, keepsUp, popAt, pickRealType, realReason, finishReason,
  cornerRoom, projectRoom, popVariant, beatOf, beatAt, heroLines, HERO_MAX, giftScene, lettersScene, roomLights, roomFlash, sortFarToNear, roomPalette } from './realrules.js?v=202611280944';
import { createRealCard } from './realcard.js?v=202611280944';
import { GIFT_SANS } from './giftart.js?v=202611280944';
import { filmMark } from './giftrules.js';

const MAX = 10; // screen entries the shader takes at most (a corner screen is two)
export const MAX_SCREENS = MAX;
const UNIT = [[0, 0], [1, 0], [1, 1], [0, 1]];

// ---- can this device make it -----------------------------------------------------------------------------------------------
let GL_OK = null;
function glWorks() { // asked once per page; the test context is given back at once
  if (GL_OK !== null) return GL_OK;
  try { const c = document.createElement('canvas'), g = c.getContext('webgl2') || c.getContext('webgl'); GL_OK = !!g; g?.getExtension?.('WEBGL_lose_context')?.loseContext(); } catch { GL_OK = false; }
  return GL_OK;
}
const recWorks = () => { try { return typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream; } catch { return false; } };
/** '' when this device can make the video, else 'record' (no MediaRecorder / canvas capture) or 'webgl'. */
export const realSupport = () => realReason({ rec: recWorks(), gl: glWorks() });

// ---- shaders -----------------------------------------------------------------------------------------------------------------
const VS = 'attribute vec2 aP;void main(){gl_Position=vec4(aP,0.0,1.0);}';
const PREC = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
// The corner box (realrules.js cornerRoom): per pixel of the corner screen a ray from the camera through the frame (rim) into the room
// behind it: the back walls, the ceiling and the floor (a tile grid, darker with depth and in the concave edges, neon along them, gold
// just inside the opening) or the panel standing in it (the card on its front). Shadows of the things popping out (boxes, spheres,
// letters: a ray toward the light), the panel's own on the walls. No LED dots. nb, ns, ng: how many boxes, spheres, letters cast.
const ROOM_GLSL = ({ nb, ns, ng }) => `
#define ROOM
#define NB ${nb}
#define NS ${ns}
#define NG ${ng}
uniform mat3 uMi, uPax;
uniform vec3 uCam, uPc, uPh, uLsun, uWall, uCeil, uNeon, uGold, uRoomAvg;
uniform vec4 uRoom, uFace, uLit; // rx, rz, y0, y1 | wL, wR, rim, rim at the bottom | lights, flash, panel corner radius, -
#if NB > 0
uniform vec3 uBc[NB], uBh[NB];
uniform mat3 uBa[NB];
#endif
#if NS > 0
uniform vec4 uSp[NS];
#endif
#if NG > 0
uniform vec4 uG0[NG], uG1[NG], uG2[NG]; // centre, half width | right (unit), half height | the letter in the shadow atlas
uniform sampler2D uGsh;
#endif
const float BIG = 1e6;
float tPlane(float c, float r, float v) { float t = (v - c) / (abs(r) < 1e-7 ? 1e-7 : r); return t > 0.0 ? t : BIG; }
vec3 safe(vec3 d) { return vec3(abs(d.x) < 1e-7 ? 1e-7 : d.x, abs(d.y) < 1e-7 ? 1e-7 : d.y, abs(d.z) < 1e-7 ? 1e-7 : d.z); }
// a ray against a box (centre c, its axes the columns of A, half sizes h) -> t in, t out
vec2 slab(vec3 o, vec3 d, vec3 c, mat3 A, vec3 h) {
  vec3 lo = (o - c) * A, ld = safe(d * A), t1 = (-h - lo) / ld, t2 = (h - lo) / ld, mn = min(t1, t2), mx = max(t1, t2);
  return vec2(max(max(mn.x, mn.y), mn.z), min(min(mx.x, mx.y), mx.z));
}
float shadowAt(vec3 p) {
  float s = 0.0;
#if NB > 0
  for (int i = 0; i < NB; i++) { if (uBh[i].x <= 0.0) continue; vec2 t = slab(p, uLsun, uBc[i], uBa[i], uBh[i]); if (t.y > 1e-4 && t.x <= t.y) s = max(s, smoothstep(0.0, 0.03, t.y - max(t.x, 0.0))); }
#endif
#if NS > 0
  for (int i = 0; i < NS; i++) { vec4 q = uSp[i]; if (q.w <= 0.0) continue; vec3 oc = q.xyz - p; float tc = dot(oc, uLsun); if (tc <= 0.0) continue; s = max(s, 0.9 * (1.0 - smoothstep(q.w * 0.8, q.w * 1.15, length(oc - tc * uLsun)))); }
#endif
#if NG > 0
  for (int i = 0; i < NG; i++) {
    vec4 g0 = uG0[i], g1 = uG1[i]; if (g0.w <= 0.0) continue;
    vec3 n = vec3(g1.z, 0.0, -g1.x); float den = dot(uLsun, n); if (abs(den) < 1e-5) continue;
    float t = dot(g0.xyz - p, n) / den; if (t <= 1e-4) continue;
    vec3 q = p + t * uLsun - g0.xyz; vec2 uv = vec2(0.5 + dot(q, g1.xyz) / (2.0 * g0.w), 0.5 - q.y / (2.0 * g1.w));
    if (uv != clamp(uv, 0.0, 1.0)) continue;
    s = max(s, texture2D(uGsh, uG2[i].xy + uv * uG2[i].zw).a);
  }
#endif
  return s;
}
vec3 strip(float d, vec3 c, float w, float halo, float k) { return (exp(-(d / w) * (d / w)) * 2.2 + exp(-max(d, 0.0) / halo) * 0.35) * c * k; }
float gridAt(vec2 a) { vec2 g = abs(fract(a / 0.07 + 0.5) - 0.5) * 0.07; return clamp(1.0 - min(g.x, g.y) / 0.0022, 0.0, 1.0); }
vec3 roomCol(vec2 px) {
  vec3 R = uMi * vec3(px, 1.0), C = uCam;
  float tX = tPlane(C.x, R.x, 0.0), tZ = tPlane(C.z, R.z, 0.0), tf = max(tX, tZ);
  if (tf >= BIG) return uRoomAvg;
  vec3 F = C + tf * R;
  bool left = tX >= tZ;
  float uf = left ? F.z : F.x, wf = left ? uFace.x : uFace.y, lit = uLit.x, shk = min(1.0, lit * 1.2);
  float din = min(min(wf - uFace.z - uf, F.y - uFace.w), 1.0 - uFace.z - F.y); // > 0: inside the opening
  vec3 o;
  if (din <= 0.0) { // the frame: dark satin, a thin light on its inner edge
    float e = din / 0.0025;
    o = vec3(0.0103, 0.0065, 0.0212) * (0.55 + 0.45 * clamp(F.y, 0.0, 1.0)) * (1.0 - 0.85 * shadowAt(F) * shk) * lit + exp(-e * e) * vec3(1.0, 0.63, 0.88) * 0.9 * (0.25 + 0.75 * lit);
  } else {
    float rx = uRoom.x, rz = uRoom.y, y0 = uRoom.z, y1 = uRoom.w, tw = BIG, wid = -1.0;
    for (int k = 0; k < 4; k++) {
      float t = k == 0 ? tPlane(C.x, R.x, rx) : k == 1 ? tPlane(C.z, R.z, rz) : k == 2 ? tPlane(C.y, R.y, y1) : tPlane(C.y, R.y, y0);
      vec3 p = C + t * R;
      if (t > tf && t < tw && p.x >= -1e-4 && p.x <= rx + 1e-4 && p.z >= -1e-4 && p.z <= rz + 1e-4 && p.y >= y0 - 1e-4 && p.y <= y1 + 1e-4) { tw = t; wid = float(k); }
    }
    vec2 tp = slab(C, R, uPc, uPax, uPh);
    bool panel = tp.x <= tp.y && tp.x > tf && tp.x < tw;
    vec3 P = C + (panel ? tp.x : tw) * R;
    float sh = shadowAt(P) * shk;
    if (panel) {
      vec3 lo = (P - uPc) * uPax, r = abs(lo) / uPh;
      if (r.z >= r.x && r.z >= r.y && lo.z > 0.0) { // the front: the card, rounded corners, the room's dark behind them
        vec2 uv = vec2(0.5 + lo.x / (2.0 * uPh.x), 0.5 - lo.y / (2.0 * uPh.y));
        vec2 q = abs(vec2(lo.x, lo.y)) - (uPh.xy - uLit.z);
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uLit.z;
        vec3 pan = toLin(texture2D(uCard0, clamp(uv, 0.0, 1.0)).rgb) * 1.05 * (1.0 - 0.45 * sh);
        o = mix(pan, vec3(0.0116, 0.0030, 0.0452) * lit, smoothstep(-0.002, 0.002, d));
      } else {
        vec3 nf = r.x >= r.y && r.x >= r.z ? uPax[0] * sign(lo.x) : r.y >= r.z ? uPax[1] * sign(lo.y) : uPax[2] * sign(lo.z);
        o = vec3(0.913, 0.753, 1.0) * (0.25 + 0.6 * clamp(dot(nf, uLsun), 0.0, 1.0)) * (1.0 - 0.85 * sh) * lit;
      }
    } else {
      vec3 nw = wid < 0.5 ? vec3(-1.0, 0.0, 0.0) : wid < 1.5 ? vec3(0.0, 0.0, -1.0) : wid < 2.5 ? vec3(0.0, -1.0, 0.0) : vec3(0.0, 1.0, 0.0);
      bool ceil = wid > 1.5 && wid < 2.5;
      float dd = max(min(P.x, P.z), 0.0), fall = 0.3 + 0.7 * exp(-dd / 0.2);
      float light = (0.1 + 0.55 * clamp(dot(nw, uLsun), 0.0, 1.0) + 0.3 * clamp(-dot(nw, normalize(vec3(-1.0, 0.15, -1.0))), 0.0, 1.0)) * fall;
      float g = wid < 0.5 ? gridAt(P.zy) : wid < 1.5 ? gridAt(P.xy) : gridAt(P.xz);
      vec3 alb = (ceil ? uCeil : uWall) * (1.0 - 0.45 * g);
      float eb = length(vec2(rx - P.x, rz - P.z)), ec = ceil ? min(rx - P.x, rz - P.z) : y1 - P.y;
      float ao = 1.0 - 0.55 * exp(-min(min(eb, ec), P.y - y0) / 0.045);
      vec3 em = strip(min(P.x, P.z), uGold, 0.003, 0.02, 0.55);
      if (wid < 2.5) em += strip(eb, uNeon, 0.004, 0.035, 1.0);
      if (wid < 1.5) em += strip(y1 - P.y, uNeon, 0.004, 0.035, 0.8);
      if (ceil) em += strip(min(rx - P.x, rz - P.z), uNeon, 0.004, 0.035, 0.8);
      vec2 ps = slab(P, uLsun, uPc, uPax, uPh);
      float st = ps.x <= ps.y && ps.y > 1e-4 ? 0.8 : 0.0;
      o = alb * light * ao * (1.0 - 0.85 * max(sh, st)) * lit + em * (0.25 + 0.75 * lit);
    }
  }
  return o * (1.0 - uLit.y) + uLit.y * 1.4;
}
`;
// The things popping out (realrules.js giftScene / lettersScene): quads in world units through the plate's camera (uPV), drawn far
// to near over the finished frame. A point inside the building shows only through the opening (the frame and the building hide it);
// in front of it nothing clips it: it may cross the frame, the building and the sky. Modes (POP_MODE): a box face (darker toward its
// edges), flat, a letter's face (the atlas), a letter's slice (the atlas's alpha), a balloon (a shaded sphere).
const OBJ_VS = `attribute vec3 aW; attribute vec4 aC; attribute vec4 aT; uniform mat4 uPV; varying vec3 vW; varying vec4 vC; varying vec4 vT;
void main() { vW = aW; vC = aC; vT = aT; gl_Position = uPV * vec4(aW, 1.0); }`;
const OBJ_FS = PREC + `
uniform sampler2D uAtlas; uniform vec3 uCam, uNeon; uniform vec4 uFace; uniform float uFlash, uInLit; // uInLit: the room's light on what is in it
varying vec3 vW; varying vec4 vC; varying vec4 vT;
void main() {
  vec3 rgb = vC.rgb; float a = vC.a, m = vT.z; vec2 uv = vT.xy;
  if (m < 0.5) { float x = clamp(min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)) / 0.18, 0.0, 1.0); rgb *= (0.7 + 0.3 * x * x * (3.0 - 2.0 * x)) * (1.08 - 0.22 * uv.y); }
  else if (m < 1.5) {}
  else if (m < 2.5) { vec4 tx = texture2D(uAtlas, uv); rgb *= pow(tx.rgb, vec3(2.2)); a *= tx.a; }
  else if (m < 3.5) { a *= texture2D(uAtlas, uv).a; }
  else {
    vec2 q = uv * 2.0 - 1.0; q.y = q.y * 0.92 + 0.06;
    float rr = dot(q, q), nz = sqrt(max(1.0 - rr, 0.0)); a *= smoothstep(1.0, 0.95, sqrt(rr));
    vec3 L = normalize(vec3(-0.5, -0.6, 0.7));
    rgb = rgb * (0.25 + 0.85 * clamp(q.x * L.x + q.y * L.y + nz * L.z, 0.0, 1.0)) + vec3(0.9 * exp(-((q.x + 0.38) * (q.x + 0.38) + (q.y + 0.42) * (q.y + 0.42)) / 0.018)) + pow(1.0 - nz, 3.0) * uNeon * 0.6;
  }
  float inside = min(vW.x, vW.z);
  if (inside > 0.0) {
    vec3 R = vW - uCam; float tX = -uCam.x / R.x, tZ = -uCam.z / R.z; vec3 F = uCam + max(tX, tZ) * R;
    bool left = tX >= tZ; float uf = left ? F.z : F.x, wf = left ? uFace.x : uFace.y;
    float din = min(min(wf - uFace.z - uf, F.y - uFace.w), 1.0 - uFace.z - F.y);
    float k = smoothstep(0.0, 0.004, inside);
    a *= 1.0 - k * (1.0 - smoothstep(-0.0008, 0.0008, din));
    rgb *= mix(1.0, uInLit, k);
  }
  if (a <= 0.002) discard;
  gl_FragColor = vec4(pow(max(rgb * (1.0 + 1.5 * uFlash), vec3(0.0)), vec3(1.0 / 2.2)) * a, a);
}`;
// "AI 합성" (and the mark) over everything, the pop-outs too.
const CAP_VS = 'attribute vec2 aP; uniform vec4 uRect; varying vec2 vU; void main() { vU = aP; gl_Position = vec4(mix(uRect.xy, uRect.zw, aP), 0.0, 1.0); }';
const CAP_FS = PREC + 'uniform sampler2D uTex; varying vec2 vU; void main() { vec4 c = texture2D(uTex, vec2(vU.x, 1.0 - vU.y)); gl_FragColor = vec4(c.rgb * c.a, c.a); }';
// The fragment shader for n screen entries: the uniform arrays are only as long as the plate needs (GLES2 promises few uniform vectors).
// room: { nb, ns, ng } for a corner screen drawn as the box (ROOM_GLSL), else null.
export function fragmentSource(n, room = null) {
  const N = Math.max(1, Math.min(MAX, Math.floor(Number(n)) || 0));
  return `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
#define N ${N}
uniform sampler2D uPlate, uCard0, uCard1, uPop, uCap, uBlur0, uBlur1;
uniform vec2 uOut, uSize;
uniform float uScale, uSeed, uLedC, uLedNorm, uGain0;
uniform int uN;
uniform mat3 uHi[N];
uniform vec4 uA[N]; // kind (0 led, 1 phone, 2 small, -1 off), card, u0, u1
uniform vec4 uB[N]; // key level, seen, led cycles across u, led cycles down v (0: no dots)
uniform vec4 uC[N]; // corner 0, corner 1
uniform vec4 uD[N]; // corner 2, corner 3
uniform vec4 uE[N]; // fold edge (-1 none, 1 or 3), gain, spill band px, bloom
uniform vec4 uGround; // y px (< 0: none), tint
uniform vec4 uPopRect, uCapRect;
const float GS = 0.914; // the plate's screen green (245 / 255) in linear light
vec3 toLin(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }
vec3 cardAt(float k, vec2 uv) { return k < 0.5 ? texture2D(uCard0, uv).rgb : texture2D(uCard1, uv).rgb; }
${room ? ROOM_GLSL(room) : ''}
// The board's local colour: a tiny copy of the card (about 12 x 12 texels, drawn down each frame), so it is a wide blur.
vec3 localCol(float k, vec2 t, float u0, float u1) {
  vec2 c = clamp(t, vec2(u0, 0.0), vec2(u1, 1.0));
  return toLin(k < 0.5 ? texture2D(uBlur0, c).rgb : texture2D(uBlur1, c).rgb);
}
vec3 avgCard() {
  vec3 s = vec3(0.0);
  for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) s += toLin(texture2D(uBlur0, vec2(0.17 + 0.33 * float(i), 0.17 + 0.33 * float(j))).rgb);
  return s / 9.0 * uGain0;
}
float edgeD(vec2 p, vec2 a, vec2 b, float o) { vec2 e = b - a; return o * (e.x * (p.y - a.y) - e.y * (p.x - a.x)) / max(length(e), 1e-4); }
// Signed distance to the quad (outside > 0), the fold edge left out; fd: the distance past the fold (> 0: the other face's pixel).
float sdq(vec2 p, vec4 C, vec4 D, float fold, out float fd) {
  vec2 c0 = C.xy, c1 = C.zw, c2 = D.xy, c3 = D.zw;
  float a2 = (c0.x * c1.y - c1.x * c0.y) + (c1.x * c2.y - c2.x * c1.y) + (c2.x * c3.y - c3.x * c2.y) + (c3.x * c0.y - c0.x * c3.y);
  float o = a2 > 0.0 ? -1.0 : 1.0;
  float e0 = edgeD(p, c0, c1, o), e1 = edgeD(p, c1, c2, o), e2 = edgeD(p, c2, c3, o), e3 = edgeD(p, c3, c0, o);
  fd = -1e5;
  if (fold > 0.5 && fold < 2.0) { fd = e1; e1 = -1e5; } else if (fold > 2.0) { fd = e3; e3 = -1e5; }
  return max(max(e0, e1), max(e2, e3));
}
float halfPlane(float d, float s) { return 1.0 / (1.0 + exp(1.702 * d / s)); }
void main() {
  vec2 frag = vec2(gl_FragCoord.x, uOut.y - gl_FragCoord.y);
  vec2 px = frag / uScale;
  vec3 s = texture2D(uPlate, px / uSize).rgb;
  float dk = s.g - max(s.r, s.b);
  vec3 L = toLin(s);
  float band = 0.0; vec3 loc = vec3(0.0); vec3 bloom = vec3(0.0);
  for (int i = 0; i < N; i++) {
    if (i >= uN) break;
    vec4 A = uA[i], B = uB[i], E = uE[i];
    if (A.x < -0.5) continue;
    float fd; float d = sdq(px, uC[i], uD[i], E.x, fd);
    if (fd > 0.0 || d > 2.0 * E.z + 260.0) continue;
    vec3 h = uHi[i] * vec3(px, 1.0);
    if (h.z <= 0.0) continue;
    vec2 cu = clamp(h.xy / h.z, 0.0, 1.0);
    vec3 lc = localCol(A.y, vec2(mix(A.z, A.w, cu.x), cu.y), A.z, A.w) * E.y;
#ifdef ROOM
    if (E.x > 0.0) lc = uRoomAvg;
#endif
    float dist = max(d, 0.0), b;
    if (A.x > 1.5) b = clamp(1.0 - dist / 5.0, 0.0, 1.0);
    else b = max(clamp(1.0 - max(dist - 8.0, 0.0) / E.z, 0.0, 1.0), clamp((dk - 0.1 * B.x) / (0.2 * B.x), 0.0, 1.0) * step(dist, 2.0 * E.z));
    if (b > band) { band = b; loc = lc; }
    if (E.w > 0.0) bloom += lc * E.w * (0.07 * halfPlane(d, 6.0) + 0.065 * halfPlane(d, 22.0) + 0.055 * halfPlane(d, 70.0));
  }
  vec3 col = L;
  float gex = max(L.g - max(L.r, L.b), 0.0) * band;
  col.g -= gex; col += gex * loc / GS;
  float amax = 0.0;
#ifdef ROOM
  bool got = false; vec3 rc = vec3(0.0);
#endif
  for (int i = 0; i < N; i++) {
    if (i >= uN) break;
    vec4 A = uA[i], B = uB[i], E = uE[i];
    if (A.x < -0.5) continue;
    float fd; float d = sdq(px, uC[i], uD[i], E.x, fd);
    if (fd > 0.0 || d > 2.0) continue;
    vec3 h = uHi[i] * vec3(px, 1.0);
    if (h.z <= 0.0) continue;
    vec2 uv = clamp(h.xy / h.z, 0.0, 1.0);
    float lv = B.x, a;
    if (A.x > 1.5) {
      float Q = clamp(2.0 - d, 0.0, 1.0);
      float key = clamp((dk - 0.2 * lv) / (0.5 * lv), 0.0, 1.0);
      float core = clamp(-d - 1.0, 0.0, 1.0) * clamp((dk - 0.04 * lv) / (0.08 * lv), 0.0, 1.0);
      a = Q * max(key, B.y > 0.5 ? core : 0.0);
    } else {
      a = clamp(1.0 - d, 0.0, 1.0) * clamp((dk - 0.3 * lv) / (0.4 * lv), 0.0, 1.0);
    }
    if (a <= 0.0) continue;
#ifdef ROOM
    if (E.x > 0.0) { if (!got) { rc = roomCol(px); got = true; } col = mix(col, mix(rc, col, 0.35 * clamp(1.0 + d / 3.0, 0.0, 1.0)), a); amax = max(amax, a); continue; }
#endif
    vec2 tu = vec2(mix(A.z, A.w, uv.x), uv.y);
    vec3 bd = toLin(cardAt(A.y, tu)) * E.y;
    if (E.x > 0.0 && uPopRect.z > uPopRect.x) {
      vec2 pu = (px - uPopRect.xy) / (uPopRect.zw - uPopRect.xy);
      if (pu == clamp(pu, 0.0, 1.0)) { vec4 pc = texture2D(uPop, pu); bd = mix(bd, toLin(pc.rgb) * E.y, pc.a); }
    }
    if (B.z > 0.0) {
      float gx = 0.5 + 0.5 * cos(6.2831853 * tu.x * B.z), gy = 0.5 + 0.5 * cos(6.2831853 * tu.y * B.w);
      bd *= ((1.0 - uLedC) + uLedC * 2.2 * pow(gx * gy, 0.7)) / uLedNorm;
    }
    if (A.x > 0.5 && A.x < 1.5) bd += exp(-pow(((tu.x * 0.75 + tu.y * 0.45) - 0.42) / 0.10, 2.0)) * 0.045 + pow(1.0 - tu.y, 3.0) * 0.025;
    bd = mix(bd, col, 0.35 * clamp(1.0 + d / 3.0, 0.0, 1.0));
    col = mix(col, bd, a);
    amax = max(amax, a);
  }
  float outside = 1.0 - amax;
  bool ground = uGround.x >= 0.0 && px.y > uGround.x;
  float strong = max(smoothstep(0.12, 0.18, dk), (dk > 0.07 && s.g > 0.27 && s.g > 1.6 * max(s.r, s.b)) ? 1.0 : 0.0) * outside * (1.0 - band);
  if (outside > 0.0 && (ground || strong > 0.0)) {
    vec3 avg = avgCard();
    if (ground) {
      float ramp = clamp((px.y - uGround.x) / 60.0, 0.0, 1.0) * outside;
      float g2 = max(col.g - max(col.r, col.b) * 1.05, 0.0) * ramp;
      col.g -= g2; col += g2 * avg / GS * 0.8;
      float lum = (col.r + col.g + col.b) / 3.0;
      col += clamp(lum * 4.0, 0.0, 1.0) * avg * uGround.y * ramp;
    }
    float g3 = max(col.g - max(col.r, col.b), 0.0) * strong;
    col.g -= g3; col += g3 * avg / GS * 0.8;
  }
  col += bloom;
  float n = fract(sin(dot(frag + uSeed, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  vec3 o = toSrgb(col) + n * (3.2 / 255.0) * clamp(amax + length(bloom) * 8.0, 0.0, 1.0);
  vec2 cp = (frag - uCapRect.xy) / (uCapRect.zw - uCapRect.xy);
  if (cp == clamp(cp, 0.0, 1.0)) { vec4 cc = texture2D(uCap, cp); o = mix(o, cc.rgb, cc.a); }
  gl_FragColor = vec4(clamp(o, 0.0, 1.0), 1.0);
}`;
}

function program(gl, fs, vs = VS, attrs = ['aP']) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Object.assign(new Error('shader: ' + gl.getShaderInfoLog(s)), { reason: 'webgl' }); return s; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a)); // fixed slots: each pass points them at its own buffer
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Object.assign(new Error('link: ' + gl.getProgramInfoLog(p)), { reason: 'webgl' });
  return p;
}
function texture(gl, unit) {
  const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  return t;
}
function upload(gl, unit, t, src) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); }

// "AI 합성" bottom right: composite.py caption_layer pos 'br' (33 px bold, right 36 px, ink bottom 48 px at 1080 wide, white 70 %, shadow).
// mark: the free video's 'WISH BOARD' too, on the same line left of it (the strip is wider then; the shader places it by its size).
function captionCanvas(scale, mark = true) {
  const k = scale, w = Math.ceil((mark ? 620 : 240) * k), h = Math.ceil(90 * k), c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.font = `800 ${Math.round(33 * k)}px ${GIFT_SANS}`; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
  const x = w - 36 * k, y = h - 48 * k;
  g.save(); g.shadowColor = 'rgba(0,0,0,0.67)'; g.shadowBlur = 5 * k; g.shadowOffsetY = 2 * k; g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillText('AI 합성', x, y);
  if (mark) g.fillText('WISH BOARD', x - g.measureText('AI 합성').width - 28 * k, y);
  g.restore();
  return c;
}

// ---- the corner box's letters: an atlas of the headline's characters in the page's font --------------------------------------------
// Each cell: the letter in the board's name colour, flat (realrules.js realTheme l; 2026-11-28, A), over a rim (rim); its alpha is also the shape
// of the extruded slices. shadow: a quarter-size copy (the filter blurs it) for the soft shadows. -> { canvas, shadow, metrics }:
// per character its cell in the atlas (uv) and its cell and advance in font sizes (realrules.js lettersScene).
function glyphAtlas(chars, theme, px = 150) {
  const uniq = [...new Set(chars.filter((c) => c.trim()))], pad = Math.round(px * 0.16), ch = Math.round(px * 1.32) + 2 * pad;
  const probe = document.createElement('canvas').getContext('2d'), font = `900 ${px}px ${GIFT_SANS}`; probe.font = font;
  const cells = uniq.map((c) => { const adv = probe.measureText(c).width || px * 0.9; return { c, adv, w: Math.ceil(adv) + 2 * pad }; });
  const W = Math.min(2048, Math.max(64, cells.reduce((a, x) => a + x.w, 0))), place = []; let x = 0, y = 0;
  for (const c of cells) { if (x + c.w > W) { x = 0; y += ch; } place.push([x, y]); x += c.w; }
  const H = y + ch, canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d'), rim = theme.rim, metrics = {};
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  cells.forEach((c, i) => {
    const [x0, y0] = place[i], cx = x0 + c.w / 2, cy = y0 + ch / 2;
    g.lineWidth = px / 13; g.strokeStyle = `rgb(${rim.join(',')})`; g.strokeText(c.c, cx, cy);
    g.fillStyle = `rgb(${theme.l.join(',')})`; g.fillText(c.c, cx, cy);
    metrics[c.c] = { rect: [x0 / W, y0 / H, (x0 + c.w) / W, (y0 + ch) / H], w: c.w / px, h: ch / px, adv: c.adv / px };
  });
  const shadow = document.createElement('canvas'); shadow.width = Math.max(1, Math.round(W / 4)); shadow.height = Math.max(1, Math.round(H / 4));
  shadow.getContext('2d').drawImage(canvas, 0, 0, shadow.width, shadow.height);
  return { canvas, shadow, metrics };
}

// ---- the corner's gift box (corner.py GiftPop), drawn with the plate's camera (a corner plate without a camera, or no 3D) -------------
function popper(plate, screen, theme) {
  const P = Array.isArray(plate.camera) ? plate.camera : plate.camera?.P; // { P: 3x4 world -> output px, wL, wR, units }
  if (!Array.isArray(P) || P.length !== 3 || !P.every((r) => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite))) return null;
  const M = invert3([P[0][0], P[0][1], P[0][2], P[1][0], P[1][1], P[1][2], P[2][0], P[2][1], P[2][2]]);
  if (!M) return null;
  const C = [0, 1, 2].map((i) => -(M[i * 3] * P[0][3] + M[i * 3 + 1] * P[1][3] + M[i * 3 + 2] * P[2][3])); // the camera centre
  const project = (w) => { const q = [0, 1, 2].map((i) => P[i][0] * w[0] + P[i][1] * w[1] + P[i][2] * w[2] + P[i][3]); return q[2] > 0 ? [q[0] / q[2], q[1] / q[2]] : null; };
  const all = screen.faces.flatMap((f) => quadAt(f.corners, 0));
  const x0 = Math.floor(Math.min(...all.map((p) => p[0]))) - 40, y0 = Math.floor(Math.min(...all.map((p) => p[1]))) - 40;
  const x1 = Math.ceil(Math.max(...all.map((p) => p[0]))) + 40, y1 = Math.ceil(Math.max(...all.map((p) => p[1]))) + 40;
  const k = 0.5, canvas = document.createElement('canvas'); canvas.width = Math.ceil((x1 - x0) * k); canvas.height = Math.ceil((y1 - y0) * k);
  const g = canvas.getContext('2d');
  const hx = (c) => c.map((v) => Math.round(v));
  // the box in the board's colour, its ribbon in the name's (realTheme box, rib: amber and white on a black board)
  const PINK = theme.box, PINK_D = theme.box.map((v) => v * 0.82), GOLD = theme.rib;
  const CONF = [theme.hi, [255, 255, 255], theme.box, [255, 176, 32]];
  const LIGHT = (() => { const v = [-0.45, 0.75, -0.85], n = Math.hypot(...v); return v.map((x) => x / n); })();
  const add = (a, b) => a.map((v, i) => v + b[i]), sub = (a, b) => a.map((v, i) => v - b[i]), mul = (a, s) => a.map((v) => v * s);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const n = Math.hypot(...a) || 1; return a.map((v) => v / n); };
  const rotY = (a) => (v) => [Math.cos(a) * v[0] + Math.sin(a) * v[2], v[1], -Math.sin(a) * v[0] + Math.cos(a) * v[2]];
  const rotAxis = (axis, a) => (v) => { const u = norm(axis), c = Math.cos(a), s = Math.sin(a); return add(add(mul(v, c), mul(cross(u, v), s)), mul(u, dot(u, v) * (1 - c))); };
  // the confetti stream (seeded: always the same)
  let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
  const OUT = [-Math.SQRT1_2, 0, -Math.SQRT1_2];
  const conf = Array.from({ length: 150 }, (_, i) => ({ t0: 2.68 + (i < 100 ? -0.12 * Math.log(Math.max(1e-6, rnd())) : 0.4 + 1.6 * rnd()),
    v: add(add(mul(OUT, 0.25 + 0.5 * rnd()), [0, 0.55 + 0.5 * rnd(), 0]), [gauss() * 0.18, gauss() * 0.18, gauss() * 0.18]),
    size: 0.008 + 0.007 * rnd(), col: CONF[Math.floor(rnd() * CONF.length)], rot: rnd() * 6.28, vr: -8 + 16 * rnd(), axis: [gauss(), gauss(), gauss()], life: 1.6 + rnd(), kind: rnd() < 0.5 ? 1 : 0 }));

  function boxPolys(st) {
    const R = rotY(st.yaw + Math.PI / 4), s = st.s, h = s / 2, c = st.c, polys = [];
    const Pt = (x, y, z) => add(c, R([x, y, z]));
    const quad = (a, b, cc, d, col, ribbon = true, layer = 0) => {
      const n = norm(cross(sub(d, a), sub(b, a)));
      polys.push({ pts: [a, b, cc, d], col, n, layer });
      if (ribbon) { const l = (p, q, t) => add(p, mul(sub(q, p), t)); polys.push({ pts: [l(a, b, 0.42), l(a, b, 0.58), l(d, cc, 0.58), l(d, cc, 0.42)].map((p) => add(p, mul(n, s * 0.004))), col: GOLD, n, layer: 1 }); }
    };
    const bh = h * 0.86, top = -h + 2 * bh;
    quad(Pt(-h, -h, -h), Pt(h, -h, -h), Pt(h, top, -h), Pt(-h, top, -h), PINK);
    quad(Pt(h, -h, -h), Pt(h, -h, h), Pt(h, top, h), Pt(h, top, -h), PINK);
    quad(Pt(h, -h, h), Pt(-h, -h, h), Pt(-h, top, h), Pt(h, top, h), PINK);
    quad(Pt(-h, -h, h), Pt(-h, -h, -h), Pt(-h, top, -h), Pt(-h, top, h), PINK);
    quad(Pt(-h, -h, h), Pt(h, -h, h), Pt(h, -h, -h), Pt(-h, -h, -h), PINK_D, false);
    quad(Pt(-h, top, -h), Pt(h, top, -h), Pt(h, top, h), Pt(-h, top, h), PINK_D.map((v) => v * 0.45), false);
    const lr = h * 1.06, lt = h * 0.28, hinge = Pt(0, top, lr), Rl = rotAxis(R([1, 0, 0]), st.lid);
    const Lp = (x, y, z) => add(hinge, Rl(sub(Pt(x, top + y, z), hinge)));
    quad(Lp(-lr, 0, -lr), Lp(lr, 0, -lr), Lp(lr, lt, -lr), Lp(-lr, lt, -lr), PINK);
    quad(Lp(lr, 0, -lr), Lp(lr, 0, lr), Lp(lr, lt, lr), Lp(lr, lt, -lr), PINK);
    quad(Lp(lr, 0, lr), Lp(-lr, 0, lr), Lp(-lr, lt, lr), Lp(lr, lt, lr), PINK);
    quad(Lp(-lr, 0, lr), Lp(-lr, 0, -lr), Lp(-lr, lt, -lr), Lp(-lr, lt, lr), PINK);
    quad(Lp(-lr, lt, -lr), Lp(lr, lt, -lr), Lp(lr, lt, lr), Lp(-lr, lt, lr), PINK);
    quad(Lp(-lr, 0, lr), Lp(lr, 0, lr), Lp(lr, 0, -lr), Lp(-lr, 0, -lr), PINK_D, false);
    const nt = Rl(R([0, 1, 0])), off = mul(nt, s * 0.005);
    polys.push({ pts: [Lp(-lr, lt, -lr * 0.16), Lp(lr, lt, -lr * 0.16), Lp(lr, lt, lr * 0.16), Lp(-lr, lt, lr * 0.16)].map((p) => add(p, off)), col: GOLD, n: nt, layer: 2 });
    polys.push({ pts: [Lp(-lr * 0.16, lt, -lr), Lp(lr * 0.16, lt, -lr), Lp(lr * 0.16, lt, lr), Lp(-lr * 0.16, lt, lr)].map((p) => add(p, off)), col: GOLD, n: nt, layer: 2 });
    return polys;
  }
  function draw(t) {
    const p = popAt(t);
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
    if (!p) return false;
    g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
    const s = p.size * p.scale, st = { c: add([0, p.y0 + s / 2 + p.bob, 0], mul(OUT, p.out)), s, yaw: p.yaw, lid: p.lid };
    const items = [];
    for (const q of boxPolys(st)) {
      const fc = mul(q.pts.reduce(add, [0, 0, 0]), 0.25);
      if (dot(q.n, sub(C, fc)) <= 0) continue;
      const shade = 0.55 + 0.45 * Math.max(0, dot(q.n, LIGHT));
      items.push({ z: Math.hypot(...sub(fc, C)) - q.layer * 1e-4, pts: q.pts, col: mul(q.col, shade), a: 1 });
    }
    for (const c of conf) {
      const tt = t - c.t0; if (tt <= 0 || tt >= c.life) continue;
      const kk = (1 - Math.exp(-1.4 * tt)) / 1.4;
      const pos = add(add(add(st.c, [0, s * 0.4, 0]), mul(c.v, kk)), [0, (-0.55 * (tt - kk)) / 1.4, 0]);
      const Rk = rotAxis(c.axis, c.rot + c.vr * tt), z = c.size;
      const cs = c.kind ? [[-1.3, -0.45, 0], [1.3, -0.45, 0], [1.3, 0.45, 0], [-1.3, 0.45, 0]] : [[-0.7, -0.7, 0], [0.7, -0.7, 0], [0.7, 0.7, 0], [-0.7, 0.7, 0]];
      const shade = 0.6 + 0.4 * Math.abs(dot(Rk([0, 0, 1]), LIGHT)), fade = 1 - Math.min(1, Math.max(0, (tt - c.life + 0.4) / 0.4));
      items.push({ z: Math.hypot(...sub(pos, C)), pts: cs.map((v) => add(pos, Rk(mul(v, z)))), col: mul(c.col, shade * (0.3 + 0.7 * fade)), a: 1 });
    }
    items.sort((a, b) => b.z - a.z);
    for (const it of items) {
      const pts = it.pts.map(project); if (pts.some((q) => !q)) continue;
      g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath();
      g.fillStyle = `rgb(${hx(it.col.map((v) => Math.max(0, Math.min(255, v)))).join(',')})`; g.fill();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    return true;
  }
  return { canvas, rect: [x0, y0, x1, y1], draw };
}

// ---- the compositor ------------------------------------------------------------------------------------------------------------
// canvas: the output (its size is set here: plate size x scale). Builds the cards (fonts must be ready). draw(f) renders frame f from
// the video element's current picture. levels(video): the key level per screen from the picture now on the video (frame 0: all green).
// The corner box (3D, out/popout-2026-11-28): a corner screen on a plate with a camera is drawn as the room with the card on its
// panel, and the day's pop-out (realrules.js popVariant: the gift box or the headline's letters) on the music's beats over the whole
// frame; flat (or a device that cannot compile it): the card folded over the corner with the small box on it, as before.
export function createCompositor(canvas, plate, gift, { scale = 1, onLost = null, flat = false } = {}) {
  const W = Math.round((plate.w * scale) / 2) * 2, H = Math.round((plate.h * scale) / 2) * 2;
  canvas.width = W; canvas.height = H;
  const cornerS = plate.screens.find((s) => s.layout === 'corner'), room = !flat && cornerS ? cornerRoom(plate.camera) : null;
  const variant = popVariant(gift?.occ), bt = beatOf(gift?.occ), flashT = plate.flash || REAL.flash;
  // The cards: one per big screen (at most two: plate 5's billboard and phone); small phones show the first one, dimmed.
  const cards = [], entries = [];
  let popScreen = null;
  for (const s of plate.screens) {
    const st = screenStats(s), isBox = room && s.layout === 'corner';
    if (s.kind === 'small') { entries.push({ kind: 2, card: 0, track: s.corners, vis: s.vis, gain: 0.75, band: 5, bloom: 0, ledU: 0, ledV: 0, u0: 0, u1: 1, fold: -1 }); continue; }
    const ci = Math.min(cards.length, 1);
    if (cards.length < 2) {
      if (isBox) { // the panel's card: the panel's own proportions, as tall as the panel shows on the output
        const pg = room.panel, a = projectRoom(room, [pg.ctr[0], pg.ctr[1] + pg.half[1], pg.ctr[2]]), b = projectRoom(room, [pg.ctr[0], pg.ctr[1] - pg.half[1], pg.ctr[2]]);
        const ts = texSize(pg.half[0] / pg.half[1], Math.hypot(a[0] - b[0], a[1] - b[1]) * scale);
        cards.push(createRealCard(gift, { w: ts.w, h: ts.h, layout: 'card', flash: flashT, hero: variant !== 'letters', at: { line: beatAt(bt, 1), from: beatAt(bt, 2) } }));
      } else {
        const ts = texSize(s.aspect, st.maxH * scale);
        cards.push(createRealCard(gift, { w: ts.w, h: ts.h, layout: s.layout, phone: s.kind === 'phone', flash: flashT }));
      }
    }
    const card = cards[ci], cols = s.kind === 'phone' || isBox ? 0 : ledCols(st.minW, scale), rows = cols * (card.canvas.height / card.canvas.width);
    const base = { kind: s.kind === 'phone' ? 1 : 0, card: ci, gain: s.kind === 'phone' ? 1.15 : 0.95, band: s.kind === 'phone' ? 110 : 45, bloom: s.kind === 'phone' ? 0.35 : isBox ? 0.6 : 1, ledU: cols, ledV: rows };
    if (s.layout === 'corner') {
      entries.push({ ...base, track: s.faces[0].corners, u0: 0, u1: s.split, fold: 1 }, { ...base, track: s.faces[1].corners, u0: s.split, u1: 1, fold: 3 });
      if (!popScreen && !isBox) popScreen = { s, theme: card.theme };
    } else entries.push({ ...base, track: s.corners, u0: 0, u1: 1, fold: -1 });
  }
  entries.splice(MAX);
  const N = Math.max(1, entries.length);
  // the box's pop-outs have edges: smoothed by the GPU (the full-frame pass has none)
  const opts = { alpha: false, antialias: !!room, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true };
  const gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
  if (!gl) throw Object.assign(new Error('webgl'), { reason: 'webgl' });
  // The letters (B) and what casts shadows; GLES2 promises few uniform vectors: drop the letters' shadows, then all, where too few.
  const hero = room && variant === 'letters' ? heroLines(gift) : [];
  const atlas = hero.length ? glyphAtlas(Array.from(hero.join('')), cards[0].theme) : null;
  const scene = !room ? null : atlas ? lettersScene(room, bt, cards[0].theme, hero, atlas.metrics, { layers: scale >= 0.99 ? 14 : 9 }) : giftScene(room, bt, cards[0].theme);
  let counts = null;
  if (room) {
    const ng = Math.min(HERO_MAX, scene.letters?.length || 0), nb = atlas ? 0 : 2, ns = atlas ? 0 : 3, have = Number(gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)) || 64;
    const need = (c) => 8 * N + 14 + 24 + 5 * c.nb + c.ns + 3 * c.ng;
    counts = [{ nb, ns, ng }, { nb, ns, ng: 0 }, { nb: 0, ns: 0, ng: 0 }].find((c) => need(c) <= have) || null;
    if (!counts) return createCompositor(canvas, plate, gift, { scale, onLost, flat: true });
  }
  // A lost context (the GPU reset, the phone took it back) ends the run; the page tries once more at 720.
  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault?.(); lost = true; try { onLost?.(); } catch { /* the caller's */ } }, { once: true });
  let prog, oprog = null, cprog = null;
  try {
    prog = program(gl, fragmentSource(N, counts));
    if (room) { oprog = program(gl, OBJ_FS, OBJ_VS, ['aW', 'aC', 'aT']); cprog = program(gl, CAP_FS, CAP_VS); }
  } catch (e) {
    if (room) { try { console.warn('realvideo: the corner box is drawn flat:', e?.message); } catch { /* no console */ } return createCompositor(canvas, plate, gift, { scale, onLost, flat: true }); } // this device's GL cannot
    throw e;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aP = 0; gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
  const LOC = {}, U = (n) => (n in LOC ? LOC[n] : (LOC[n] = gl.getUniformLocation(prog, n))); // looked up once each
  const tex = { plate: texture(gl, 0), c0: texture(gl, 1), c1: texture(gl, 2), pop: texture(gl, 3), cap: texture(gl, 4), b0: texture(gl, 5), b1: texture(gl, 6) };
  ['uPlate', 'uCard0', 'uCard1', 'uPop', 'uCap', 'uBlur0', 'uBlur1'].forEach((n, i) => gl.uniform1i(U(n), i));
  // the blurred copies: the card drawn down in two steps (64, then 12 texels across), magnified by the texture filter
  const mid = document.createElement('canvas'), small = document.createElement('canvas'); mid.width = mid.height = 64; small.width = small.height = 12;
  const mg = mid.getContext('2d'), sg = small.getContext('2d');
  const blurOf = (c) => { mg.clearRect(0, 0, 64, 64); mg.drawImage(c, 0, 0, 64, 64); sg.clearRect(0, 0, 12, 12); sg.drawImage(mid, 0, 0, 12, 12); return small; };
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  const pop = popScreen ? popper(plate, popScreen.s, popScreen.theme) : null;
  const level = entries.map(() => 0.7);
  const cap = captionCanvas(W / plate.w, filmMark(gift)); upload(gl, 4, tex.cap, cap);
  const capRect = [W - cap.width, H - cap.height, W, H];
  gl.uniform2f(U('uOut'), W, H); gl.uniform2f(U('uSize'), plate.w, plate.h); gl.uniform1f(U('uScale'), W / plate.w);
  gl.uniform1i(U('uN'), entries.length); gl.uniform1f(U('uLedC'), REAL.ledContrast);
  gl.uniform1f(U('uLedNorm'), 1 - REAL.ledContrast + REAL.ledContrast * 2.2 * ledMean(REAL.ledPow));
  // the ground's reflection and stray green take the board's average: the box is darker than a lit card
  gl.uniform1f(U('uGain0'), room ? 0.45 : entries.find((e) => e.kind !== 2)?.gain || 0.95);
  gl.uniform4f(U('uGround'), plate.ground ? plate.ground.y * plate.h : -1, plate.ground?.tint || 0, 0, 0);
  // with the box the caption is its own pass after the pop-outs (they may cross it): the full-frame pass leaves it out
  gl.uniform4f(U('uCapRect'), ...(room ? [-20, -20, -10, -10] : capRect));
  gl.uniform4f(U('uPopRect'), ...(pop ? pop.rect : [0, 0, 0, 0]));
  gl.viewport(0, 0, W, H);
  const Hi = new Float32Array(9 * N), A = new Float32Array(4 * N), B = new Float32Array(4 * N), Cc = new Float32Array(4 * N), D = new Float32Array(4 * N), E = new Float32Array(4 * N);
  const box = room ? roomPasses(gl, { room, scene, counts, theme: cards[0].theme, atlas, U, tex, plate, W, H, capRect, bt }) : null;

  function draw(video, f) {
    if (lost || gl.isContextLost?.()) return false;
    const t = timeOf(f, plate.fps);
    gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    if (box) { gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2); gl.disable(gl.BLEND); }
    cards.forEach((c, i) => { c.draw(t); upload(gl, 1 + i, i ? tex.c1 : tex.c0, c.canvas); upload(gl, 5 + i, i ? tex.b1 : tex.b0, blurOf(c.canvas)); });
    if (pop && pop.draw(t)) upload(gl, 3, tex.pop, pop.canvas);
    const frame = box ? box.frame(t) : null; // sets the room's uniforms on the full-frame pass
    upload(gl, 0, tex.plate, video);
    Hi.fill(0);
    entries.forEach((e, i) => {
      const q = quadAt(e.track, f), hm = homography(UNIT, q), hi = hm && invert3(hm);
      // column-major for uniformMatrix3fv
      if (hi) [0, 3, 6, 1, 4, 7, 2, 5, 8].forEach((k, j) => { Hi[9 * i + j] = hi[k]; });
      A[4 * i] = hi ? e.kind : -1; A[4 * i + 1] = e.card; A[4 * i + 2] = e.u0; A[4 * i + 3] = e.u1;
      B[4 * i] = level[i]; B[4 * i + 1] = e.vis ? (e.vis[Math.min(f, e.vis.length - 1)] ? 1 : 0) : 1; B[4 * i + 2] = e.ledU; B[4 * i + 3] = e.ledV;
      Cc[4 * i] = q[0][0]; Cc[4 * i + 1] = q[0][1]; Cc[4 * i + 2] = q[1][0]; Cc[4 * i + 3] = q[1][1];
      D[4 * i] = q[2][0]; D[4 * i + 1] = q[2][1]; D[4 * i + 2] = q[3][0]; D[4 * i + 3] = q[3][1];
      E[4 * i] = e.fold; E[4 * i + 1] = e.gain; E[4 * i + 2] = e.band; E[4 * i + 3] = e.bloom;
    });
    gl.uniformMatrix3fv(U('uHi'), false, Hi); gl.uniform4fv(U('uA'), A); gl.uniform4fv(U('uB'), B); gl.uniform4fv(U('uC'), Cc); gl.uniform4fv(U('uD'), D); gl.uniform4fv(U('uE'), E);
    gl.uniform1f(U('uSeed'), (f * 7.31) % 97);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (box) box.over(frame, t, { oprog, cprog });
    return true;
  }
  // The key level of each screen: the median of G - max(R, B) over its inner part on the picture now on the video.
  function levels(video, f = 0) {
    const c = document.createElement('canvas'), k = 0.25; c.width = Math.round(plate.w * k); c.height = Math.round(plate.h * k);
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(video, 0, 0, c.width, c.height);
    let px; try { px = g.getImageData(0, 0, c.width, c.height).data; } catch { return level.slice(); }
    const main = [];
    entries.forEach((e, i) => {
      const hm = homography(UNIT, quadAt(e.track, f)); if (!hm) return;
      const ds = [];
      for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
        const [X, Y] = [0.2 + (0.6 * x) / 8, 0.2 + (0.6 * y) / 8], [u, v] = [hm[0] * X + hm[1] * Y + hm[2], hm[3] * X + hm[4] * Y + hm[5]], w = hm[6] * X + hm[7] * Y + hm[8];
        const ix = Math.round((u / w) * k), iy = Math.round((v / w) * k);
        if (ix < 0 || iy < 0 || ix >= c.width || iy >= c.height) continue;
        const o = (iy * c.width + ix) * 4; ds.push((px[o + 1] - Math.max(px[o], px[o + 2])) / 255);
      }
      ds.sort((a, b) => a - b);
      const m = ds.length ? ds[ds.length >> 1] : 0;
      if (m > 0.2) { level[i] = m; if (e.kind !== 2) main.push(m); }
      else if (e.kind === 2) level[i] = -1; // a phone not green now: the main screen's level (below)
    });
    const fallback = main.length ? main[0] : 0.7;
    entries.forEach((e, i) => { if (level[i] <= 0.2) level[i] = fallback; });
    return level.slice();
  }
  const free = () => { try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* gone anyway */ } };
  return { gl, canvas, draw, levels, free, get lost() { return lost; }, size: { w: W, h: H }, entries: entries.length, cards: cards.length, pop: !!pop || !!box,
    box: box ? { variant: atlas ? 'letters' : 'gift', shadows: counts } : null };
}

// The corner box's GL side: the room's fixed uniforms once; per frame (frame(t)) the lights and the casters for the full-frame pass,
// then (over) the pop-outs, far to near, and the caption.
function roomPasses(gl, { room, scene, counts, theme, atlas, U, tex, plate, W, H, capRect, bt }) {
  const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  const colM = (cols) => { const m = new Float32Array(9); cols.forEach((c, j) => { m[3 * j] = c[0]; m[3 * j + 1] = c[1]; m[3 * j + 2] = c[2]; }); return m; }; // columns
  const Mi = room.Mi, pg = room.panel;
  gl.uniformMatrix3fv(U('uMi'), false, new Float32Array([0, 3, 6, 1, 4, 7, 2, 5, 8].map((k) => Mi[k])));
  gl.uniform3fv(U('uCam'), room.C); gl.uniform4f(U('uRoom'), room.rx, room.rz, room.y0, room.y1); gl.uniform4f(U('uFace'), room.wL, room.wR, room.rim, room.rimb);
  gl.uniform3fv(U('uPc'), pg.ctr); gl.uniformMatrix3fv(U('uPax'), false, colM([pg.rt, pg.up, pg.n])); gl.uniform3fv(U('uPh'), pg.half); gl.uniform3fv(U('uLsun'), room.Lsun);
  const { wall, ceil, neon, gold } = roomPalette(theme);
  gl.uniform3fv(U('uWall'), wall); gl.uniform3fv(U('uCeil'), ceil); gl.uniform3fv(U('uNeon'), neon); gl.uniform3fv(U('uGold'), gold);
  const avg = mix(wall, neon, 0.3).map((v) => v * 0.6);
  // the letters' atlas (the pop-out pass) and its blurred copy (their shadows): units 3 (no flat box canvas now) and 7
  if (atlas) {
    upload(gl, 3, tex.pop, atlas.canvas);
    const ts = texture(gl, 7); upload(gl, 7, ts, atlas.shadow); gl.uniform1i(U('uGsh'), 7);
  }
  const nb = counts.nb, ns = counts.ns, ng = counts.ng;
  const Bc = new Float32Array(3 * Math.max(1, nb)), Bh = new Float32Array(3 * Math.max(1, nb)), Ba = new Float32Array(9 * Math.max(1, nb)), Sp = new Float32Array(4 * Math.max(1, ns));
  const G0 = new Float32Array(4 * Math.max(1, ng)), G1 = new Float32Array(4 * Math.max(1, ng)), G2 = new Float32Array(4 * Math.max(1, ng));
  function frame(t) {
    const fr = scene.at(t), lights = roomLights(t, bt), fl = roomFlash(t, bt);
    gl.uniform4f(U('uLit'), lights, fl, 0.012, 0); gl.uniform3fv(U('uRoomAvg'), avg.map((v) => v * (0.4 + 0.6 * lights)));
    if (nb) { Bh.fill(0); fr.boxes.slice(0, nb).forEach((b, i) => { Bc.set(b.c, 3 * i); Bh.set(b.half, 3 * i); Ba.set(colM(b.axes), 9 * i); }); gl.uniform3fv(U('uBc'), Bc); gl.uniform3fv(U('uBh'), Bh); gl.uniformMatrix3fv(U('uBa'), false, Ba); }
    if (ns) { Sp.fill(0); fr.spheres.slice(0, ns).forEach((s, i) => Sp.set([...s.c, s.r], 4 * i)); gl.uniform4fv(U('uSp'), Sp); }
    if (ng) {
      G0.fill(0);
      fr.glyphs.slice(0, ng).forEach((g, i) => { G0.set([...g.c, g.hw], 4 * i); G1.set([...g.rt, g.hh], 4 * i); G2.set([g.rect[0], g.rect[1], g.rect[2] - g.rect[0], g.rect[3] - g.rect[1]], 4 * i); });
      gl.uniform4fv(U('uG0'), G0); gl.uniform4fv(U('uG1'), G1); gl.uniform4fv(U('uG2'), G2);
    }
    return { items: sortFarToNear(fr.items, room.C), flash: fl, inLit: 0.45 + 0.55 * Math.min(1, lights / 0.55) };
  }
  // world -> clip through the plate's camera (P to output px, px to clip); depth is not tested (the painter's order is)
  const P = room.P, pv = new Float32Array(16);
  for (let c = 0; c < 4; c++) { pv[c * 4] = (2 / plate.w) * P[0][c] - P[2][c]; pv[c * 4 + 1] = P[2][c] - (2 / plate.h) * P[1][c]; pv[c * 4 + 2] = 0; pv[c * 4 + 3] = P[2][c]; }
  const OL = {}, OU = (p, n) => { const k = n + (p === 'c' ? '#c' : ''); return k in OL ? OL[k] : (OL[k] = gl.getUniformLocation(p === 'c' ? cp : op, n)); };
  let op = null, cp = null, inited = false;
  const obuf = gl.createBuffer(), cbuf = gl.createBuffer(), FL = 11, UV = [[0, 0], [1, 0], [1, 1], [0, 1]], TRI = [0, 1, 2, 0, 2, 3];
  let vb = new Float32Array(FL * 6 * 600);
  function over({ items, flash, inLit }, t, { oprog, cprog }) {
    if (!inited) {
      op = oprog; cp = cprog; inited = true;
      gl.useProgram(op); gl.uniformMatrix4fv(OU('o', 'uPV'), false, pv); gl.uniform3fv(OU('o', 'uCam'), room.C); gl.uniform3fv(OU('o', 'uNeon'), neon);
      gl.uniform4f(OU('o', 'uFace'), room.wL, room.wR, room.rim, room.rimb); gl.uniform1i(OU('o', 'uAtlas'), 3);
      gl.useProgram(cp); gl.uniform1i(OU('c', 'uTex'), 4);
      gl.uniform4f(OU('c', 'uRect'), (capRect[0] / W) * 2 - 1, -1, 1, 1 - (capRect[1] / H) * 2);
      gl.bindBuffer(gl.ARRAY_BUFFER, cbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    }
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    let n = 0;
    if (vb.length < items.length * 6 * FL) vb = new Float32Array(items.length * 6 * FL * 2);
    for (const it of items) {
      const r = it.rect, uv = (k) => (r ? [k === 1 || k === 2 ? r[2] : r[0], k >= 2 ? r[3] : r[1]] : UV[k]);
      for (const k of TRI) { const p = it.pts[k], u = uv(k); vb.set([p[0], p[1], p[2], it.col[0], it.col[1], it.col[2], it.a, u[0], u[1], it.mode, 0], n * FL); n++; }
    }
    if (n) {
      gl.useProgram(op); gl.uniform1f(OU('o', 'uFlash'), flash); gl.uniform1f(OU('o', 'uInLit'), inLit);
      gl.bindBuffer(gl.ARRAY_BUFFER, obuf); gl.bufferData(gl.ARRAY_BUFFER, vb.subarray(0, n * FL), gl.DYNAMIC_DRAW);
      for (let i = 0; i < 3; i++) gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, FL * 4, 0); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, FL * 4, 12); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, FL * 4, 28);
      gl.drawArrays(gl.TRIANGLES, 0, n);
      gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
    }
    gl.useProgram(cp); gl.bindBuffer(gl.ARRAY_BUFFER, cbuf); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }
  return { frame, over };
}

// ---- recording ------------------------------------------------------------------------------------------------------------------
const once = (el, ev, ms = 15000) => new Promise((res, rej) => {
  const t = setTimeout(() => { el.removeEventListener(ev, ok); rej(Object.assign(new Error(ev), { reason: 'load' })); }, ms);
  function ok() { clearTimeout(t); res(); }
  el.addEventListener(ev, ok, { once: true });
});
const fontsReady = () => Promise.race([document.fonts?.ready || Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});

/** Called from the button's click (a user gesture): the audio context and the plate's video element, unlocked for sound. url: the plate
 *  mp4 (a blob: URL of the downloaded file); host: an element on screen (the page's 9:16 stage) that takes the video and, over it, the
 *  output canvas: a canvas that is never on screen gives captureStream no frames in some browsers, and a hidden video may not play
 *  smoothly, so both are shown (the canvas is the live preview while it records). -> a run for makeRealVideo. */
export function startRun(url, host = document.body) {
  let ctx = null, src = null;
  try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) { ctx = new AC(); ctx.resume?.().catch(() => {}); } } catch { ctx = null; }
  const v = document.createElement('video');
  v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto'; v.src = url;
  const canvas = document.createElement('canvas');
  for (const el of [v, canvas]) Object.assign(el.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', display: 'block' });
  host.append(v, canvas);
  try { if (ctx?.createMediaElementSource) src = ctx.createMediaElementSource(v); } catch { src = null; }
  // The sound goes into the mix, never to the speakers: an unconnected source is silent, so playing now (inside the tap) only unlocks it.
  const unlocked = v.play().then(() => { v.pause(); return true; }, () => false);
  const run = { v, canvas, ctx, src, unlocked, done() { try { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); run.canvas.remove(); } catch { /* gone */ } try { ctx?.close?.(); } catch { /* closed */ } } };
  return run;
}

/** Makes the video. run: from startRun (its done() closes the audio context and takes the video away: the page calls it when it is
 *  finished, after any retry); plate: its JSON; music: the occasion's m4a as an ArrayBuffer (or null); hi: 1080x1920 (else 720x1280);
 *  signal aborts (the page was hidden or left); onProgress(0..1). -> { blob, type, w, h, drawn, frames, seen, ms }. Throws an Error
 *  with .reason: 'webgl', 'record', 'slow' (this device cannot keep up at 1080: try again at 720), 'tooslow' (not even at 720), 'lost'
 *  (the WebGL context was lost: try again at 720), 'aborted', 'short' (the video stopped before its last frames), 'load', 'fail'.
 *  Whatever happens, everything this call started is stopped before it returns or throws. */
export async function makeRealVideo({ run, plate, gift, music = null, hi = true, signal = null, onProgress = () => {} }) {
  const { v, ctx, src } = run, fps = plate.fps || REAL.fps, frames = plate.frames || REAL.frames, dur = frames / fps;
  const fail = (reason) => Object.assign(new Error(reason), { reason });
  if (!(await run.unlocked)) v.muted = true; // sound refused: the plate plays muted (the music still goes in)
  v.pause();
  if (v.readyState < 2) await once(v, 'loadeddata');
  if (signal?.aborted) throw fail('aborted');
  await fontsReady();
  if (signal?.aborted) throw fail('aborted');
  // a fresh canvas each try (a context lost after a 1080 try cannot be had again), in the place of the last one
  const canvas = document.createElement('canvas'); canvas.style.cssText = run.canvas.style.cssText; run.canvas.replaceWith(canvas); run.canvas = canvas;
  let cancel = null, stopReason = '';
  const comp = createCompositor(canvas, plate, gift, { scale: hi ? 1 : REAL.low.w / plate.w, onLost: () => cancel?.('lost') });
  let stream = null, rec = null, stopped = null, dest = null, musicSrc = null, hp = null, ambGainNode = null, safety = 0, raf = 0, vfc = 0;
  let drawn = 0, last = -1, checked = false, busyMs = 0, seenF = 0, base = null;
  try {
    if (v.currentTime > 0.001) { v.currentTime = 0; await once(v, 'seeked'); }
    comp.levels(v, 0);
    comp.draw(v, 0);
    // the sound: the plate's street sound (high-pass, about -34 LUFS, the swell at the flash) and the music, into the recording only
    if (ctx?.createMediaStreamDestination) {
      try {
        dest = ctx.createMediaStreamDestination();
        if (src) {
          hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = REAL.hp;
          ambGainNode = ctx.createGain(); ambGainNode.gain.value = 10 ** (ambBaseDb(plate.lufs ?? plate.audio?.lufs) / 20);
          src.disconnect(); src.connect(hp); hp.connect(ambGainNode); ambGainNode.connect(dest);
        }
        if (music) {
          const buf = await ctx.decodeAudioData(music.slice(0));
          musicSrc = ctx.createBufferSource(); musicSrc.buffer = buf; musicSrc.connect(dest);
        }
      } catch { /* no mix: picture only, or picture and whatever connected */ }
    }
    stream = canvas.captureStream(30);
    const at = dest?.stream?.getAudioTracks?.()[0]; if (at) stream.addTrack(at);
    const type = pickRealType((t) => MediaRecorder.isTypeSupported(t));
    try { rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: hi ? REAL.bits.hi : REAL.bits.lo, audioBitsPerSecond: REAL.bits.audio }); }
    catch { try { rec = new MediaRecorder(stream); } catch { throw fail('record'); } }
    const chunks = []; rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    stopped = new Promise((r) => { rec.onstop = r; rec.onerror = r; });
    const finish = new Promise((resolve) => {
      const end = (why) => { if (stopReason) return; stopReason = why; resolve(); };
      cancel = end;
      signal?.addEventListener?.('abort', () => end('aborted'), { once: true });
      if (signal?.aborted) end('aborted'); // an abort before the listener never fires it
      if (comp.lost) end('lost');
      v.addEventListener('ended', () => { seenF = Math.max(seenF, frameOf(v.currentTime, fps, frames)); setTimeout(() => end('done'), 120); }, { once: true });
      const onFrame = (mt) => {
        vfc = 0; raf = 0;
        if (stopReason) return;
        const f = frameOf(mt, fps, frames);
        seenF = Math.max(seenF, f);
        if (f !== last) { const a = performance.now(); if (comp.draw(v, f)) drawn++; busyMs += performance.now() - a; last = f; onProgress(Math.min(1, (f + 1) / frames)); }
        // the first second after the start-up (the recorder and the decoder settle in the first quarter second): enough frames drawn?
        if (!base && mt >= 0.25) base = { drawn, f };
        if (base && !checked && mt >= 1.25) { checked = true; if (!keepsUp(drawn - base.drawn, f - base.f, hi ? 0.66 : 0.3)) { end(hi ? 'slow' : 'tooslow'); return; } }
        if (f >= frames - 1) { setTimeout(() => end('done'), 1000 / fps + 80); return; }
        schedule();
      };
      const schedule = () => {
        if (stopReason) return;
        if (v.requestVideoFrameCallback) vfc = v.requestVideoFrameCallback((now, meta) => onFrame(meta?.mediaTime ?? v.currentTime));
        else raf = requestAnimationFrame(() => onFrame(v.currentTime));
      };
      schedule();
    });
    safety = setTimeout(() => cancel?.('fail'), (dur + 4) * 1000); // a video that never reaches its end is a failure, never a short success
    if (!stopReason) {
      rec.start(250);
      try { await v.play(); } catch { v.muted = true; try { await v.play(); } catch { cancel('fail'); } }
    }
    if (!stopReason) {
      const t0 = ctx ? ctx.currentTime : 0, vt = v.currentTime || 0;
      try { musicSrc?.start(t0, vt); } catch { /* no music */ }
      try { if (ambGainNode) { const b = ambBaseDb(plate.lufs ?? plate.audio?.lufs); ambGainNode.gain.setValueCurveAtTime(ambCurve(256, dur - vt, (plate.flash || REAL.flash) - vt, b, b + REAL.ambPeakDb), t0, Math.max(0.1, dur - vt)); } } catch { /* a flat level */ }
    }
    await finish;
    if (rec.state !== 'inactive') { try { rec.stop(); } catch { /* stopped */ } await stopped; }
    const stats = { drawn, frames, seen: seenF + 1, ms: drawn ? +(busyMs / drawn).toFixed(1) : 0 };
    const why = finishReason(stopReason, seenF, frames);
    if (why !== 'done') throw Object.assign(fail(why), stats);
    if (!chunks.length) throw Object.assign(fail('record'), stats);
    const btype = String(rec.mimeType || type || 'video/webm').split(';')[0];
    return { blob: new Blob(chunks, { type: btype }), type: btype, w: canvas.width, h: canvas.height, ...stats };
  } finally {
    // everything this try started, whatever the way out
    if (!stopReason) stopReason = 'fail';
    clearTimeout(safety);
    if (vfc && v.cancelVideoFrameCallback) { try { v.cancelVideoFrameCallback(vfc); } catch { /* fired */ } }
    if (raf) cancelAnimationFrame(raf);
    try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { /* stopped */ }
    v.pause();
    try { musicSrc?.stop(); } catch { /* not started */ }
    for (const n of [musicSrc, hp, ambGainNode, src]) { try { n?.disconnect(); } catch { /* not connected */ } }
    for (const tr of [...(stream?.getTracks?.() || []), ...(dest?.stream?.getTracks?.() || [])]) { try { tr.stop(); } catch { /* ended */ } }
    comp.free();
  }
}

// For a still (the browser check): seek the run's video to frame f and draw it. -> the compositor.
export async function stillFrame(canvas, { v }, plate, gift, f, { scale = 1, comp = null } = {}) {
  if (v.readyState < 2) await once(v, 'loadeddata');
  await fontsReady();
  const c = comp || createCompositor(canvas, plate, gift, { scale });
  if (!comp) { if (v.currentTime > 0.001) { v.currentTime = 0; await once(v, 'seeked'); } c.levels(v, 0); }
  v.currentTime = Math.min(f, (plate.frames || REAL.frames) - 1) / (plate.fps || REAL.fps) + 0.001; await once(v, 'seeked');
  c.draw(v, f);
  return c;
}
