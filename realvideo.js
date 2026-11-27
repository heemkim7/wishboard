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
//   corner         one card split at `split` over two faces (the fold edge is not an edge); the gift box (corner.py GiftPop) is
//                  drawn with the plate's camera into the output view and laid on the board before the dots (anamorphic)
//   caption        "AI 합성" bottom right (about 24 px cap height at 1080 wide, white 70 %, a soft shadow), and on the free video the
//                  'WISH BOARD · 무료' watermark left of it (giftrules.js filmMark: none on a board whose paid order is published)
//
// Recording: the WebGL canvas (captureStream) and a WebAudio mix (the plate's own street sound through a high-pass and a gain that
// sits about -34 LUFS and swells around the flash, plus the occasion's music started at the video's own current time) go to one
// MediaRecorder, MP4 first. The video plays in real time from frame 0 to its last frame; the 241 frames set the length.
import { REAL, homography, invert3, quadAt, frameOf, timeOf, screenStats, texSize, ledCols, ledMean, ambBaseDb, ambCurve, keepsUp, popAt, pickRealType, realReason, finishReason } from './realrules.js?v=202611272230';
import { createRealCard } from './realcard.js?v=202611272230';
import { GIFT_SANS } from './giftart.js?v=202611272230';
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
// The fragment shader for n screen entries: the uniform arrays are only as long as the plate needs (GLES2 promises few uniform vectors).
export function fragmentSource(n) {
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

function program(gl, fs) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Object.assign(new Error('shader: ' + gl.getShaderInfoLog(s)), { reason: 'webgl' }); return s; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
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
// mark: the free video's 'WISH BOARD · 무료' too, on the same line left of it (the strip is wider then; the shader places it by its size).
function captionCanvas(scale, mark = true) {
  const k = scale, w = Math.ceil((mark ? 620 : 240) * k), h = Math.ceil(90 * k), c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.font = `800 ${Math.round(33 * k)}px ${GIFT_SANS}`; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
  const x = w - 36 * k, y = h - 48 * k;
  g.save(); g.shadowColor = 'rgba(0,0,0,0.67)'; g.shadowBlur = 5 * k; g.shadowOffsetY = 2 * k; g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillText('AI 합성', x, y);
  if (mark) g.fillText('WISH BOARD · 무료', x - g.measureText('AI 합성').width - 28 * k, y);
  g.restore();
  return c;
}

// ---- the corner's gift box (corner.py GiftPop), drawn with the plate's camera ------------------------------------------------------
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
  // the box in the theme's first colour (the sample's pink on the party theme), its ribbon in the accent
  const PINK = theme.a, PINK_D = theme.a.map((v) => v * 0.82), GOLD = theme.hi;
  const CONF = [theme.hi, [255, 255, 255], theme.a, [255, 209, 234], [185, 246, 255], [255, 170, 90], [190, 150, 255]];
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
export function createCompositor(canvas, plate, gift, { scale = 1, onLost = null } = {}) {
  const W = Math.round((plate.w * scale) / 2) * 2, H = Math.round((plate.h * scale) / 2) * 2;
  canvas.width = W; canvas.height = H;
  // The cards: one per big screen (at most two: plate 5's billboard and phone); small phones show the first one, dimmed.
  const cards = [], entries = [];
  let popScreen = null;
  for (const s of plate.screens) {
    const st = screenStats(s);
    if (s.kind === 'small') { entries.push({ kind: 2, card: 0, track: s.corners, vis: s.vis, gain: 0.75, band: 5, bloom: 0, ledU: 0, ledV: 0, u0: 0, u1: 1, fold: -1 }); continue; }
    const ci = Math.min(cards.length, 1);
    if (cards.length < 2) {
      const ts = texSize(s.aspect, st.maxH * scale);
      cards.push(createRealCard(gift, { w: ts.w, h: ts.h, layout: s.layout, phone: s.kind === 'phone', flash: plate.flash || REAL.flash }));
    }
    const card = cards[ci], cols = s.kind === 'phone' ? 0 : ledCols(st.minW, scale), rows = cols * (card.canvas.height / card.canvas.width);
    const base = { kind: s.kind === 'phone' ? 1 : 0, card: ci, gain: s.kind === 'phone' ? 1.15 : 0.95, band: s.kind === 'phone' ? 110 : 45, bloom: s.kind === 'phone' ? 0.35 : 1, ledU: cols, ledV: rows };
    if (s.layout === 'corner') {
      entries.push({ ...base, track: s.faces[0].corners, u0: 0, u1: s.split, fold: 1 }, { ...base, track: s.faces[1].corners, u0: s.split, u1: 1, fold: 3 });
      if (!popScreen) popScreen = { s, theme: card.theme };
    } else entries.push({ ...base, track: s.corners, u0: 0, u1: 1, fold: -1 });
  }
  entries.splice(MAX);
  const N = Math.max(1, entries.length);
  const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true };
  const gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
  if (!gl) throw Object.assign(new Error('webgl'), { reason: 'webgl' });
  // A lost context (the GPU reset, the phone took it back) ends the run; the page tries once more at 720.
  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault?.(); lost = true; try { onLost?.(); } catch { /* the caller's */ } }, { once: true });
  const prog = program(gl, fragmentSource(N)); gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aP = gl.getAttribLocation(prog, 'aP'); gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
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
  gl.uniform1f(U('uGain0'), entries.find((e) => e.kind !== 2)?.gain || 0.95);
  gl.uniform4f(U('uGround'), plate.ground ? plate.ground.y * plate.h : -1, plate.ground?.tint || 0, 0, 0);
  gl.uniform4f(U('uCapRect'), ...capRect);
  gl.uniform4f(U('uPopRect'), ...(pop ? pop.rect : [0, 0, 0, 0]));
  gl.viewport(0, 0, W, H);
  const Hi = new Float32Array(9 * N), A = new Float32Array(4 * N), B = new Float32Array(4 * N), Cc = new Float32Array(4 * N), D = new Float32Array(4 * N), E = new Float32Array(4 * N);

  function draw(video, f) {
    if (lost || gl.isContextLost?.()) return false;
    const t = timeOf(f, plate.fps);
    cards.forEach((c, i) => { c.draw(t); upload(gl, 1 + i, i ? tex.c1 : tex.c0, c.canvas); upload(gl, 5 + i, i ? tex.b1 : tex.b0, blurOf(c.canvas)); });
    if (pop && pop.draw(t)) upload(gl, 3, tex.pop, pop.canvas);
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
  return { gl, canvas, draw, levels, free, get lost() { return lost; }, size: { w: W, h: H }, entries: entries.length, cards: cards.length, pop: !!pop };
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
