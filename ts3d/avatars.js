// Animated GLTF characters: ten toy species (SPECIES below, presence field `av` 1..10) from tools/blender/build_animal.py.
// Every species sits on the same Mixamo rig (46 joints) and carries the same ten Mixamo clips. A model that is not on the
// server yet (or fails) shows another species' body instead (loadplan.js modelFor), so a new id never breaks a room.
// One AnimationMixer per avatar; locomotion states cross-fade and emotes play once on top.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeCanvas, paintNameTag, paintBubble, paintRingFx, TAG_THEMES, RING_FX, RING_FX_SIZE } from './art.js?v=202611231200';
import { MODEL_URL, modelFor } from './loadplan.js?v=202611231200';
import { GESTURES, REACTIONS, gestureWeight, pulses, ease } from './gestures.js?v=202611231200';

const LOOPS = new Set(['Idle', 'Walking', 'Running', 'Dance', 'Sitting', 'Standing']);
export const EMOTES = {
  1: { anim: 'Pray', glyph: '🙏', label: '대박기원' },
  2: { anim: 'Jump', glyph: '🎆', label: '폭죽발사' },
  3: { anim: 'Cheer', glyph: '🙌', label: '만세' },
  4: { anim: 'Dance', glyph: '💃', label: 'K-댄스', hold: 6 },
};
// Quick reactions (24 glyphs, each with its own gesture) live in ts3d/gestures.js with the gesture table; sent to others
// as a 'react' broadcast by index, so every client plays the same gesture.
export { REACTIONS };
// Hoodie colours: the player's one colour paints the hoodie (material Main), the foot ring and the name-tag dot. Sixteen, in
// picker order; the eight from before (pink, sky, amber, green, purple, orange, white, blue) are all still here, so a saved one
// stays valid. Any #rrggbb is accepted by the server; this list is what the picker offers.
export const AVATAR_COLOR_NAMES = Object.freeze({
  '#ff3d9a': '핑크', '#ffa3c7': '연분홍', '#ff4a4a': '빨강', '#ff6a3d': '주황', '#ffcf5a': '호박', '#ffe94a': '노랑',
  '#9cff57': '연두', '#39f58a': '초록', '#2dd4bf': '청록', '#3fe6ff': '하늘', '#4d7cff': '파랑', '#b84dff': '보라',
  '#c9a7ff': '라벤더', '#8b5a3c': '갈색', '#2b2f3a': '먹색', '#f4f6ff': '흰색',
});
export const AVATAR_COLORS = Object.freeze(Object.keys(AVATAR_COLOR_NAMES));
// A newcomer's random colour, and a peer's when its presence has none: bright ones only. White, brown and charcoal are
// there to choose, but on a white rabbit or at night they read as "no colour".
export const STARTER_COLORS = Object.freeze(AVATAR_COLORS.filter((c) => !['#f4f6ff', '#8b5a3c', '#2b2f3a'].includes(c)));
// The foot ring glows (additive): a dark colour is lifted to at least 62% lightness first so the ring still shows.
export function ringTone(color) {
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  if (hsl.l < 0.62) c.setHSL(hsl.h, hsl.s, 0.62);
  return c.multiplyScalar(2.2);
}
// thumb: the picker's tile picture (ui.js speciesPicker); the glyph stands in while it is missing or fails. hood: the hoodie's
// coverage in the same frame (tools/blender/render_animal.py --hoods): the picker multiplies the chosen colour through it.
export const SPECIES = [
  { id: 1, label: '쥐', glyph: '🐭', thumb: '/assets/avatars/mouse.png', hood: '/assets/avatars/mouse-hood.png' },
  { id: 2, label: '고양이', glyph: '🐱', thumb: '/assets/avatars/cat.png', hood: '/assets/avatars/cat-hood.png' },
  { id: 3, label: '곰', glyph: '🐻', thumb: '/assets/avatars/bear.png', hood: '/assets/avatars/bear-hood.png' },
  { id: 4, label: '토끼', glyph: '🐰', thumb: '/assets/avatars/rabbit.png', hood: '/assets/avatars/rabbit-hood.png' },
  { id: 5, label: '강아지', glyph: '🐶', thumb: '/assets/avatars/puppy.png', hood: '/assets/avatars/puppy-hood.png' },
  { id: 6, label: '판다', glyph: '🐼', thumb: '/assets/avatars/panda.png', hood: '/assets/avatars/panda-hood.png' },
  { id: 7, label: '여우', glyph: '🦊', thumb: '/assets/avatars/fox.png', hood: '/assets/avatars/fox-hood.png' },
  { id: 8, label: '펭귄', glyph: '🐧', thumb: '/assets/avatars/penguin.png', hood: '/assets/avatars/penguin-hood.png' },
  { id: 9, label: '햄스터', glyph: '🐹', thumb: '/assets/avatars/hamster.png', hood: '/assets/avatars/hamster-hood.png' },
  { id: 10, label: '호랑이', glyph: '🐯', thumb: '/assets/avatars/tiger.png', hood: '/assets/avatars/tiger-hood.png' },
];
export const SPECIES_MAX = 10;
// Any input to a species id: an integer 1..SPECIES_MAX, anything else (0, 11, 2.5, '7a', null) is the mouse.
export function speciesId(id) {
  const n = typeof id === 'number' ? id : typeof id === 'string' && /^\s*\d{1,2}\s*$/.test(id) ? Number(id) : NaN; // a number, or digits from storage or JSON
  return Number.isInteger(n) && n >= 1 && n <= SPECIES_MAX ? n : 1;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createAvatars({ scene, urls, models, first, height = 1.8 }) {
  const sources = { ...MODEL_URL, ...(models || (urls?.[0] ? { 1: urls[0] } : {})) };
  const sys = { species: new Map(), missing: new Set(), pending: 0, waiting: new Set(), all: new Set(), height };
  const loader = new GLTFLoader();
  const started = new Set();

  const shadowC = makeCanvas(128, 128);
  {
    const g = shadowC.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    // Tighter and darker than before so a character sits on the near-black ground.
    gr.addColorStop(0, 'rgba(0,0,0,0.78)');
    gr.addColorStop(0.45, 'rgba(0,0,0,0.46)');
    gr.addColorStop(0.8, 'rgba(0,0,0,0.1)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  }
  sys.shadowGeo = new THREE.PlaneGeometry(1.25, 1.25).rotateX(-Math.PI / 2);
  sys.shadowMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowC), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  // Foot ring: a thin line (6 cm, so its near and far arcs stay at least a pixel wide from the follow camera on a
  // low-tier phone) in the player's colour.
  sys.ringGeo = new THREE.RingGeometry(0.63, 0.69, 48).rotateX(-Math.PI / 2);
  // Shop ring effects (art.js RING_FX): one flat square and one painted texture per effect, shared by every avatar wearing it.
  sys.ringFxGeo = new THREE.PlaneGeometry(RING_FX_SIZE, RING_FX_SIZE).rotateX(-Math.PI / 2);
  const ringFx = new Map();
  sys.ringFxTex = (id) => {
    let t = ringFx.get(id);
    if (!t) {
      t = new THREE.CanvasTexture(paintRingFx(makeCanvas(256, 256), id));
      t.colorSpace = THREE.SRGBColorSpace;
      ringFx.set(id, t);
    }
    return t;
  };
  const bubbles = new Map();
  sys.bubbleTex = (glyph) => {
    let t = bubbles.get(glyph);
    if (!t) {
      t = new THREE.CanvasTexture(paintBubble(makeCanvas(128, 128), glyph));
      t.colorSpace = THREE.SRGBColorSpace;
      bubbles.set(glyph, t);
    }
    return t;
  };
  // Gesture props (ts3d/gestures.js `prop`): built the first time any avatar needs one, shared by all (each avatar holds
  // its own Object3D clones of the same geometry and materials).
  let props = null;
  sys.props = () => (props ||= buildProps());

  function prepare(id, gltf) {
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true);
    const h = box.max.y - box.min.y;
    const scale = h > 0.01 && h < 1000 ? height / h : 0.4;
    const foot = -box.min.y * scale;
    model.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (!m) return;
      // Main is the hoodie in every species and the only material that takes the player colour (see attach).
      // Fur, Muzzle, Eye and Accent keep the colours in the file. The hoodie is cloth: no metal, fairly rough.
      if (m.name === 'Main') { m.metalness = 0; m.roughness = 0.6; }
      m.envMapIntensity = 1.25;
    });
    sys.species.set(id, { gltf, scale, foot });
  }

  // Avatars on the stand-in: attach once their model (or the fallback model) is in; drop the ones nothing will come for.
  function flush() {
    for (const a of [...sys.waiting]) {
      const p = sys.plan(a.species);
      if (p.show) { sys.waiting.delete(a); a.attach(); }
      else if (!p.need) sys.waiting.delete(a);
      else if (a.asked) loadId(p.need);
    }
  }
  sys.plan = (id) => modelFor(id, { loaded: sys.species, missing: sys.missing });

  function loadId(id) {
    const url = sources[id] || MODEL_URL[id];
    if (!url || started.has(id)) return;
    started.add(id);
    sys.pending++;
    loader.load(url, (gltf) => {
      prepare(id, gltf);
      sys.pending--;
      flush();
    }, undefined, (err) => {
      console.error('[avatar]', url, err);
      sys.missing.add(id);
      sys.pending--;
      flush();
    });
  }
  sys.load = loadId;
  // Only the player's own species is fetched up front; others on first sight (Avatar.want) or by prefetch(ids).
  loadId(speciesId(first));

  function create(opts) {
    const a = new Avatar(sys, scene, opts);
    sys.all.add(a);
    return a;
  }
  // Idle prefetch: only the species in `ids` (those the room's other players wear), never the whole table.
  function prefetch(ids) { for (const id of new Set(ids || [])) loadId(speciesId(id)); }
  return { create, sys, prefetch, want: loadId, get ready() { return sys.species.size > 0; } };
}

// The things a gesture holds. Each kind has a part per hand (L, R), in the hand's frame as aimHand leaves it: +Y along
// the fingers, +Z out of the palm, metres. `fly` parts hang under the avatar's holder (the bills that fly off).
// A few hundred triangles in all; geometry and materials are shared by every avatar.
function buildProps() {
  const std = (color, o) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o });
  const part = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
  const group = (...kids) => { const g = new THREE.Group(); g.add(...kids); return g; };
  // 붕어빵: a flat golden body with a tail fin, lying across the palm
  const crust = std('#e8a346', { roughness: 0.5, emissive: '#5a3008', emissiveIntensity: 0.5 });
  const body = new THREE.SphereGeometry(1, 12, 8).scale(0.12, 0.07, 0.034);
  const tail = new THREE.ConeGeometry(0.06, 0.09, 4).rotateZ(-Math.PI / 2).scale(1, 1, 0.35).translate(-0.155, 0, 0);
  const fin = new THREE.ConeGeometry(0.028, 0.05, 3).scale(1, 1, 0.4).translate(0.015, 0.075, 0);
  const fishGeo = mergeGeometries([body.toNonIndexed(), tail.toNonIndexed(), fin.toNonIndexed()]);
  const fishEye = new THREE.SphereGeometry(0.008, 6, 4);
  const dark = std('#3a2414', { roughness: 0.4 });
  const fish = group(part(fishGeo, crust), part(fishEye, dark, 0.08, 0.018, 0.031), part(fishEye, dark, 0.08, 0.018, -0.031));
  fish.position.set(0, 0.08, 0.045);
  // 라면: a red bowl of noodles on the left palm, chopsticks in the right hand
  const bowlGeo = new THREE.LatheGeometry([[0, 0], [0.06, 0], [0.095, 0.02], [0.12, 0.06], [0.13, 0.088], [0.123, 0.09]].map(([x, y]) => new THREE.Vector2(x, y)), 14).rotateX(Math.PI / 2);
  const noodleGeo = new THREE.CircleGeometry(0.118, 14).translate(0, 0, 0.075);
  const bowl = group(part(bowlGeo, std('#e0442f', { roughness: 0.35, side: THREE.DoubleSide, emissive: '#3a0800' })), part(noodleGeo, std('#f6d77e', { roughness: 0.8, emissive: '#4a3a10' })));
  bowl.position.set(0, 0.06, 0.035);
  const stickGeo = new THREE.CylinderGeometry(0.005, 0.008, 0.3, 5);
  const wood = std('#e2bd82', { roughness: 0.5 });
  const sticks = group(part(stickGeo, wood, -0.01, 0, 0), part(stickGeo, wood, 0.01, 0, 0));
  sticks.position.set(0, 0.14, 0.03);
  // 횃불: a gold handle and cup with a glowing flame, along the fingers (the arm holds it straight up)
  const gold = std('#e0a83a', { metalness: 0.6, roughness: 0.35, emissive: '#4a2c00' });
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.3, 0.35) });
  const torch = group(
    part(new THREE.CylinderGeometry(0.028, 0.02, 0.3, 6), gold, 0, 0.06, 0),
    part(new THREE.CylinderGeometry(0.065, 0.035, 0.06, 8), gold, 0, 0.24, 0),
    part(new THREE.ConeGeometry(0.058, 0.18, 6), flameMat, 0, 0.36, 0),
  );
  torch.position.set(0, 0.04, 0.035);
  // 돈: a stack of bills on the left palm, five bills that fly off the right hand
  const bill = std('#86d97f', { roughness: 0.7, side: THREE.DoubleSide, emissive: '#123a10' });
  const stack = part(new THREE.BoxGeometry(0.17, 0.085, 0.04), bill, 0, 0.06, 0.04);
  const billGeo = new THREE.PlaneGeometry(0.17, 0.085);
  const fly = new THREE.Group();
  for (let i = 0; i < 5; i++) fly.add(part(billGeo, bill));
  return {
    fish: { R: fish },
    noodles: { L: bowl, R: sticks },
    torch: { R: torch },
    money: { L: stack, fly },
  };
}

// Two-bone aim so the hands meet a world point. The Mixamo clip set has no prayer or cheer.
// A held pose runs every frame for each avatar that holds it, so the vectors below are module temporaries, not new objects
// per call. None outlives a call. pointY, foldArm and aimHand each write only their own temporaries, and read their
// arguments first. holdPose builds its targets in _t1.._t5 and hands them to foldArm and aimHand.
const _q = new THREE.Quaternion();
const _qP = new THREE.Quaternion();
const _qI = new THREE.Quaternion(); // _qP inverted
const _qU = new THREE.Quaternion(); // pointY's turn
const _qM = new THREE.Quaternion(); // the model's world rotation
const _qW = new THREE.Quaternion(); // aimHand's world rotation
const _mB = new THREE.Matrix4();
const _cur = new THREE.Vector3(), _want = new THREE.Vector3(); // pointY
const _bone = new THREE.Vector3(), _aim = new THREE.Vector3(); // foldArm
const _hx = new THREE.Vector3(), _hy = new THREE.Vector3(), _hz = new THREE.Vector3(); // aimHand
const _chest = new THREE.Vector3(), _headP = new THREE.Vector3(), _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _off = new THREE.Vector3();
const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _t3 = new THREE.Vector3(), _t4 = new THREE.Vector3(), _t5 = new THREE.Vector3();
const POSE_UP = new THREE.Vector3(0, 1, 0.18); // read only
const UPPER_ARM = { Left: 'LeftArm', Right: 'RightArm' }, FORE_ARM = { Left: 'LeftForeArm', Right: 'RightForeArm' };
// The reaction poses (POSES below) work in a frame of model axes and two body anchors, all module temporaries too:
// _fwd forward, _right the character's left (model +X), UP; the chest (Spine2) and head anchors carried through bend().
const HAND = { Left: 'LeftHand', Right: 'RightHand' }, THUMB = { Left: 'LeftHandThumb1', Right: 'RightHandThumb1' };
const SIDES = ['Left', 'Right'];
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0); // read only
const _c0 = new THREE.Vector3(), _h0 = new THREE.Vector3(); // chest and head before the bends
const _mC = new THREE.Matrix4(), _mH = new THREE.Matrix4(); // chest and head: before the bends inverted, then before → after
const _sh = new THREE.Vector3(), _el = new THREE.Vector3(), _wr = new THREE.Vector3(), _n = new THREE.Vector3(), _pole = new THREE.Vector3(); // reach
const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(); // handTo
const _t6 = new THREE.Vector3(), _t7 = new THREE.Vector3();
// The bones a pose may turn. Their clip rotations are kept (per avatar) before the pose: with a weight under 1 each
// bone ends between the two (slerp), so a gesture blends in and out instead of snapping, and the next frame puts the kept
// rotations back before the mixer runs (Avatar.unpose). The mixer only writes a bone whose clip value changed since its
// last write, so without that a held clip key would keep last frame's pose and the bends would pile up.
const BLEND = ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head'];
for (const s of SIDES) BLEND.push(s + 'Shoulder', s + 'Arm', s + 'ForeArm', s + 'Hand', s + 'HandThumb1', s + 'HandThumb2', s + 'HandThumb3', s + 'HandMiddle1');
const _qB = new THREE.Quaternion();
// What a pose asks of the avatar besides bones, read by Avatar.update right after holdPose: hop (holder up, m), step
// (model forward, m), spin (model turn, rad) and fly (seconds into the flying bills, -1 none).
const POSE_FX = { hop: 0, step: 0, spin: 0, fly: -1 };
const _propScale = new THREE.Vector3();
function poseBones(model) {
  if (!model.userData.poseBones) {
    const found = {};
    model.traverse((o) => { if (o.isBone) found[o.name.replace(/^mixamorig:?/, '')] = o; });
    model.userData.poseBones = found;
  }
  return model.userData.poseBones;
}
function boneAt(b, out) {
  b.updateWorldMatrix(true, false);
  return out.setFromMatrixPosition(b.matrixWorld);
}
function pointY(b, dir) {
  b.updateWorldMatrix(true, false);
  b.parent.getWorldQuaternion(_qP);
  b.getWorldQuaternion(_q);
  const cur = _cur.set(0, 1, 0).applyQuaternion(_q);
  const want = _want.copy(dir).normalize();
  if (cur.dot(want) < 0.999) _q.premultiply(_qU.setFromUnitVectors(cur, want));
  b.quaternion.copy(_qI.copy(_qP).invert()).multiply(_q);
}
function foldArm(model, side, elbowTarget, handTarget) {
  const bones = poseBones(model);
  const upper = bones[UPPER_ARM[side]];
  const fore = bones[FORE_ARM[side]];
  if (!upper || !fore) return;
  pointY(upper, _aim.copy(elbowTarget).sub(boneAt(upper, _bone)));
  pointY(fore, _aim.copy(handTarget).sub(boneAt(fore, _bone)));
}
const identityBone = (b) => { if (b.isBone) b.quaternion.identity(); };
function aimHand(hand, fingerDir, palmDir) {
  const y = _hy.copy(fingerDir).normalize();
  const z = _hz.copy(palmDir).addScaledVector(y, -palmDir.dot(y)).normalize();
  const x = _hx.crossVectors(y, z).normalize();
  const worldQ = _qW.setFromRotationMatrix(_mB.makeBasis(x, y, z));
  hand.updateWorldMatrix(true, false);
  hand.parent.getWorldQuaternion(_qP);
  hand.quaternion.copy(_qI.copy(_qP).invert()).multiply(worldQ);
  // every bone under the hand (the fingers) back to rest; the hand itself keeps the aim
  for (let i = 0; i < hand.children.length; i++) hand.children[i].traverse(identityBone);
}
// ---- reaction poses (ts3d/gestures.js REACTIONS) -------------------------------------------------------------------
// Turn a bone about the model's axes on top of what the clip gave it this frame: pitch > 0 bows forward, roll > 0 tilts
// toward the character's left, yaw > 0 turns to the left (radians).
function bend(b, pitch, roll = 0, yaw = 0) {
  if (!b) return;
  b.parent.getWorldQuaternion(_qP);
  b.getWorldQuaternion(_q);
  if (pitch) _q.premultiply(_qU.setFromAxisAngle(_right, pitch));
  if (roll) _q.premultiply(_qU.setFromAxisAngle(_fwd, -roll));
  if (yaw) _q.premultiply(_qU.setFromAxisAngle(UP, yaw));
  b.quaternion.copy(_qI.copy(_qP).invert()).multiply(_q);
}
// After the bends: how far the chest and head anchors moved (before → after), so cp/hp follow a bowed or leaning body.
let _chestB = null, _headB = null;
function settle() {
  _chestB.updateWorldMatrix(true, false);
  _mC.premultiply(_chestB.matrixWorld);
  _headB.updateWorldMatrix(true, false);
  _mH.premultiply(_headB.matrixWorld);
}
// A point x (character's left) / y (up) / z (forward) metres from the chest or the head as they stood before the bends.
function cp(out, x, y, z) { return out.copy(_c0).addScaledVector(_right, x).addScaledVector(UP, y).addScaledVector(_fwd, z).applyMatrix4(_mC); }
function hp(out, x, y, z) { return out.copy(_h0).addScaledVector(_right, x).addScaledVector(UP, y).addScaledVector(_fwd, z).applyMatrix4(_mH); }
// Two-bone reach: the wrist goes to `target` (or as near as the arm allows), the elbow bends toward the pole. The pole is
// in model axes with x mirrored per side (x > 0 is outward), like every arm and hand number below.
function reach(B, side, target, px, py, pz) {
  const upper = B[UPPER_ARM[side]], fore = B[FORE_ARM[side]], hand = B[HAND[side]];
  if (!upper || !fore || !hand) return;
  const sg = side === 'Left' ? 1 : -1;
  boneAt(upper, _sh);
  const a = boneAt(fore, _el).distanceTo(_sh), b = boneAt(hand, _wr).distanceTo(_el);
  _n.copy(target).sub(_sh);
  const d = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-4, _n.length()));
  _n.normalize();
  _pole.copy(_right).multiplyScalar(px * sg).addScaledVector(UP, py).addScaledVector(_fwd, pz);
  _pole.addScaledVector(_n, -_pole.dot(_n));
  if (_pole.lengthSq() < 1e-8) _pole.copy(_fwd).addScaledVector(_n, -_fwd.dot(_n));
  _pole.normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _el.copy(_sh).addScaledVector(_n, a * cosA).addScaledVector(_pole, a * sinA);
  _wr.copy(_sh).addScaledVector(_n, d);
  pointY(upper, _aim.copy(_el).sub(_sh));
  pointY(fore, _aim.copy(_wr).sub(boneAt(fore, _bone)));
}
function armC(B, side, x, y, z, px, py, pz) { reach(B, side, cp(_t6, side === 'Left' ? x : -x, y, z), px, py, pz); }
function armH(B, side, x, y, z, px, py, pz) { reach(B, side, hp(_t6, side === 'Left' ? x : -x, y, z), px, py, pz); }
// Fingers along (fx, fy, fz), palm facing (px, py, pz), x outward.
function handTo(B, side, fx, fy, fz, px, py, pz) {
  const h = B[HAND[side]];
  if (!h) return;
  const sg = side === 'Left' ? 1 : -1;
  aimHand(h, _d1.copy(_right).multiplyScalar(fx * sg).addScaledVector(UP, fy).addScaledVector(_fwd, fz), _d2.copy(_right).multiplyScalar(px * sg).addScaledVector(UP, py).addScaledVector(_fwd, pz));
}
// The mitten's thumb along (x, y, z), x outward (after handTo, which puts the fingers back to rest).
function thumbTo(B, side, x, y, z) {
  if (B[THUMB[side]]) pointY(B[THUMB[side]], _d1.copy(_right).multiplyScalar(side === 'Left' ? x : -x).addScaledVector(UP, y).addScaledVector(_fwd, z));
}

// One function per gesture: s is seconds since it began (the weight blends it in and out, see holdPose). Each bends the
// spine and head first, then settle(), then places the arms on the moved body. Numbers are metres and radians; the toy
// body is the same in every species (only heads differ), so one set fits all ten.
const POSES = {
  // The head is most of the toy's height and the arms reach about 0.37 m, so hands near the face hide behind it from the
  // front: the poses below keep the hands in front of the chest, beside the jaw, or well out to the sides.
  Laugh(B, s) {
    const ha = pulses(s, 0.15, 1.95, 9), slap = pulses(s, 0.2, 1.9, 4);
    bend(B.Spine, -0.14, 0.06 * Math.sin(s * 3));
    bend(B.Spine1, -0.1 - 0.08 * ha);
    bend(B.Head, -0.3 - 0.1 * ha);
    settle();
    armC(B, 'Left', 0.1, -0.17, 0.22, 1, -0.6, 0);
    handTo(B, 'Left', -0.8, 0.35, 0.2, 0, 0, -1);
    armC(B, 'Right', 0.26, -0.3 + 0.16 * slap, 0.14, 1, 0, -0.4);
    handTo(B, 'Right', 0.1, -1, 0.3, -1, 0, 0);
    POSE_FX.hop = 0.03 * ha;
  },
  Smitten(B, s) {
    const sway = Math.sin(s * 4.6);
    bend(B.Spine, 0, 0.08 * sway);
    bend(B.Spine2, 0.03, 0.04 * sway);
    bend(B.Head, 0.04, 0.2 * sway);
    settle();
    for (let k = 0; k < 2; k++) {
      cp(_t1, 0.06 * sway + (k ? -0.045 : 0.045), 0.16, 0.3);
      reach(B, SIDES[k], _t1, 1, -1, 0);
      handTo(B, SIDES[k], -0.2, 0.75, 0.6, -1, 0, 0);
    }
    POSE_FX.hop = 0.03 * Math.abs(sway);
  },
  Cool(B, s) {
    const nod = pulses(s, 1.0, 1.6, 1);
    bend(B.Spine, -0.08, 0, 0.14);
    bend(B.Spine2, -0.04);
    bend(B.Head, -0.12 + 0.2 * nod, 0.14, -0.1);
    settle();
    armC(B, 'Left', -0.11, 0.0, 0.22, 1, -0.4, 0);
    handTo(B, 'Left', -1, 0.1, -0.3, 0, 0, -1);
    armC(B, 'Right', -0.11, 0.05, 0.17, 1, -0.4, 0);
    handTo(B, 'Right', -1, 0.1, -0.3, 0, 0, -1);
  },
  Party(B, s) {
    const beat = pulses(s, 0.2, 1.95, 4);
    bend(B.Spine, 0, 0.05 * Math.sin(s * 7));
    bend(B.Head, -0.06 + 0.12 * beat);
    settle();
    for (let k = 0; k < 2; k++) {
      armC(B, SIDES[k], 0.48, 0.18 + 0.12 * beat, 0.2, 1, -1, 0);
      handTo(B, SIDES[k], -0.6, 0.25, 0.3, 0, 1, 0);
    }
    POSE_FX.hop = 0.06 * beat;
  },
  Sob(B, s) {
    const heave = pulses(s, 0.3, 2.2, 7), rub = Math.sin(s * 10);
    bend(B.Spine, 0.1);
    bend(B.Spine1, 0.06 + 0.05 * heave);
    bend(B.Head, 0.12 + 0.06 * heave, 0.07 * Math.sin(s * 9));
    settle();
    for (let k = 0; k < 2; k++) {
      armH(B, SIDES[k], 0.29, -0.04 + (k ? -0.035 : 0.035) * rub, 0.22, 1, -1, 0);
      handTo(B, SIDES[k], -0.45, 1, 0.15, -0.6, 0, -0.8);
    }
  },
  Gasp(B, s) {
    const jolt = ease(s, 0, 0.18), shake = 0.012 * Math.sin(s * 30) * (1 - ease(s, 0.6, 1.2));
    bend(B.Spine, -0.12 * jolt);
    bend(B.Head, -0.12 * jolt + shake);
    settle();
    for (let k = 0; k < 2; k++) {
      armC(B, SIDES[k], 0.42, 0.16, 0.18, 1, -1, -0.2);
      handTo(B, SIDES[k], 0.35, 1, 0.1, 0, 0, 1);
    }
    POSE_FX.step = -0.14 * jolt * (1 - ease(s, 1.0, 1.55));
    POSE_FX.hop = 0.06 * pulses(s, 0, 0.32, 1);
  },
  Think(B, s) {
    const tap = 0.015 * pulses(s, 0.7, 2.1, 3);
    bend(B.Spine, 0, 0.04);
    bend(B.Head, -0.05, -0.18, 0.12);
    settle();
    reach(B, 'Right', hp(_t1, -0.03, -0.06 + tap, 0.28), 1, -1, 0);
    handTo(B, 'Right', -0.3, 1, 0.3, -0.2, 0, -1);
    armC(B, 'Left', -0.06, -0.06, 0.2, 1, -1, 0);
    handTo(B, 'Left', -1, 0.1, 0, 0, 1, 0);
  },
  Clap(B, s) {
    const gap = s < 0.2 ? 0.12 : 0.012 + 0.11 * (0.5 + 0.5 * Math.cos((s - 0.2) * 3.2 * TAU));
    bend(B.Head, 0.08);
    settle();
    for (let k = 0; k < 2; k++) {
      armC(B, SIDES[k], gap / 2 + 0.035, -0.04, 0.24, 1, -1, 0);
      handTo(B, SIDES[k], -0.25, 0.7, 0.6, -1, 0, 0);
    }
  },
  Hooray(B, s) {
    const pump = pulses(s, 0.15, 1.8, 2);
    bend(B.Spine, -0.04);
    bend(B.Head, -0.12);
    settle();
    for (let k = 0; k < 2; k++) {
      armC(B, SIDES[k], 0.5, 0.22 + 0.14 * pump, 0.05, 1, 0, -0.3);
      handTo(B, SIDES[k], 0.5, 1, 0, 0, 0, 1);
    }
    POSE_FX.hop = 0.07 * pump;
  },
  FistPump(B, s) {
    const p = pulses(s, 0.2, 1.75, 3);
    bend(B.Spine, 0.05 * p, 0, -0.1);
    bend(B.Head, 0.1 * p);
    settle();
    armC(B, 'Right', 0.48, 0.04 + 0.3 * p, 0.18, 1, -0.4, 0);
    handTo(B, 'Right', -0.2, 1, 0.2, -1, 0, 0);
    armC(B, 'Left', 0.2, -0.24, 0.12, 1, 0, -0.5);
    handTo(B, 'Left', 0, -0.2, 1, -1, 0, 0);
    POSE_FX.hop = 0.035 * p;
  },
  Hundred(B, s) {
    const push = pulses(s, 0.25, 1.7, 2);
    bend(B.Spine, 0.06 * push);
    bend(B.Head, 0.08 * push);
    settle();
    for (let k = 0; k < 2; k++) {
      armC(B, SIDES[k], 0.13, 0.04, 0.27 + 0.08 * push, 1, -1, 0);
      handTo(B, SIDES[k], -1, 0, 0.15, 0, 0, -1);
      thumbTo(B, SIDES[k], 0, 1, 0);
    }
  },
  BigHeart(B, s) {
    const sway = Math.sin(s * 4);
    bend(B.Spine, 0, 0.06 * sway);
    bend(B.Head, 0, 0.08 * sway);
    settle();
    for (let k = 0; k < 2; k++) {
      armH(B, SIDES[k], 0.46, 0.14, 0.14, 1, 0.5, 0);
      handTo(B, SIDES[k], -0.6, 1, 0, -1, 0, 0);
    }
  },
  SmallHeart(B, s) {
    // a hand heart held out in front of the chest: wrists apart, fingertips together on top, thumbs together below;
    // pushed out twice
    const push = pulses(s, 0.3, 1.9, 2);
    bend(B.Spine, 0.05 * push);
    bend(B.Head, 0.06, 0.16);
    settle();
    for (let k = 0; k < 2; k++) {
      armC(B, SIDES[k], 0.1, 0.0, 0.3 + 0.06 * push, 1, -1, 0);
      handTo(B, SIDES[k], -0.8, 0.6, 0.15, 0, 0, -1);
      thumbTo(B, SIDES[k], -0.6, -1, 0.1);
    }
  },
  CheerJump(B) {
    bend(B.Head, -0.1);
    settle();
    for (let k = 0; k < 2; k++) {
      armC(B, SIDES[k], 0.5, 0.34, 0.05, 1, 0, -0.3);
      handTo(B, SIDES[k], 0.5, 1, 0, 0, 0, 1);
    }
  },
  Twirl(B, s) {
    bend(B.Head, -0.08);
    settle();
    for (let k = 0; k < 2; k++) {
      armC(B, SIDES[k], 0.5, 0.12, 0.02, 0, -1, -0.3);
      handTo(B, SIDES[k], 1, 0.3, 0, 0, -1, 0.2);
    }
    POSE_FX.spin = TAU * ease(s, 0.15, 1.35);
    POSE_FX.hop = 0.05 * pulses(s, 0.15, 1.35, 1);
  },
  FishBread(B, s) {
    const toMouth = ease(s, 0.85, 1.2), bite = pulses(s, 1.25, 2.35, 2);
    bend(B.Head, 0.12 * bite - 0.08 * (1 - toMouth), -0.12 * (1 - toMouth));
    settle();
    cp(_t1, -0.42, 0.22, 0.24).lerp(hp(_t2, -0.15 + 0.04 * bite, -0.1, 0.3 + 0.03 * bite), toMouth);
    reach(B, 'Right', _t1, 1, -1, 0);
    handTo(B, 'Right', -0.2, 1, 0, 0, 0, 1);
    armC(B, 'Left', 0.1, -0.14, 0.22, 1, -0.6, 0);
    handTo(B, 'Left', -0.8, 0.35, 0.2, 0, 0, -1);
  },
  Noodles(B, s) {
    const lift = pulses(s, 0.35, 2.3, 2);
    bend(B.Spine, 0.08);
    bend(B.Head, 0.15 + 0.08 * lift);
    settle();
    armC(B, 'Left', 0.05, -0.07, 0.3, 1, -1, 0);
    handTo(B, 'Left', -0.5, 0, 1, 0, 1, 0);
    cp(_t1, -0.12, 0.08, 0.3).lerp(hp(_t2, -0.12, -0.1, 0.3), lift);
    reach(B, 'Right', _t1, 1, -1, 0);
    handTo(B, 'Right', -0.4 - 0.2 * lift, -0.8 + 1.5 * lift, 0.5 - 0.2 * lift, 0, 1 - lift, -lift);
  },
  Torch(B, s) {
    bend(B.Spine, -0.04, 0.03 * Math.sin(s * 2));
    bend(B.Head, -0.12);
    settle();
    armC(B, 'Right', 0.5, 0.36, 0.08, 1, 0, -0.3);
    handTo(B, 'Right', 0, 1, 0, -1, 0, 0);
    armC(B, 'Left', 0.0, 0.02, 0.24, 1, -1, 0);
    handTo(B, 'Left', -1, 0.4, 0, 0, 0, -1);
  },
  Taxi(B, s) {
    const lean = ease(s, 0.1, 0.4);
    // leans toward the street on the raised side, the other hand on the hip
    bend(B.Spine, 0.04 * lean, -0.14 * lean, -0.12 * lean);
    bend(B.Head, -0.05, 0.08 * lean, -0.15 * lean);
    settle();
    armC(B, 'Right', 0.5, 0.36, 0.12, 1, 0, -0.3);
    handTo(B, 'Right', -0.6 * Math.sin(s * 13), 1, 0.1, 0, 0, 1);
    armC(B, 'Left', 0.24, -0.22, 0.02, 1, 0.3, -0.6);
    handTo(B, 'Left', -0.3, -1, 0.2, -1, 0, 0);
    POSE_FX.hop = 0.03 * lean;
  },
  MoneyRain(B, s) {
    const f = pulses(s, 0.2, 1.45, 5);
    bend(B.Spine, 0, 0, -0.1);
    bend(B.Head, 0.04);
    settle();
    armC(B, 'Left', 0.12, -0.02, 0.26, 1, -1, 0);
    handTo(B, 'Left', -0.4, 0, 1, 0, 1, 0);
    cp(_t1, 0.0, 0.03, 0.28).lerp(cp(_t2, -0.38, 0.16, 0.3), f);
    reach(B, 'Right', _t1, 1, -1, 0);
    handTo(B, 'Right', -1 + 1.3 * f, 0.3, 1, 0, 1 - 0.7 * f, 0.3 * f);
    POSE_FX.fly = s;
  },
  Doze(B, s) {
    const droop = ease(s, 0, 1.1) * (1 - ease(s, 1.15, 1.3)) + 0.8 * ease(s, 1.45, 2.3), jerk = pulses(s, 1.15, 1.6, 1);
    bend(B.Spine, 0.1 * droop);
    bend(B.Spine1, 0.05 * droop);
    bend(B.Head, 0.45 * droop - 0.1 * jerk, 0.1 * droop);
  },
};

// Lay a held pose over the clip's pose this frame. t: 0..1 through the gesture, s: seconds since it began, w: its
// weight (gestures.js gestureWeight), kept: one quaternion per BLEND bone, filled with the clip's rotations. Writes
// POSE_FX for the caller; true when it turned bones (kept is then valid).
function holdPose(model, pose, t, s, w, kept) {
  POSE_FX.hop = pose === 'Throw' ? Math.sin(Math.min(1, t * 1.2) * Math.PI) * 0.75 : 0;
  POSE_FX.step = 0;
  POSE_FX.spin = 0;
  POSE_FX.fly = -1;
  if (!model || !(w > 0)) return false;
  const bones = poseBones(model);
  const spine = bones.Spine2 || bones.Spine;
  const head = bones.Head;
  if (!spine || !head) return false;
  for (let i = 0; i < BLEND.length; i++) { const b = bones[BLEND[i]]; if (b) kept[i].copy(b.quaternion); }
  const chest = boneAt(spine, _chest);
  const headP = boneAt(head, _headP);
  model.updateWorldMatrix(true, false);
  model.getWorldQuaternion(_qM);
  const fwd = _fwd.set(0, 0, 1).applyQuaternion(_qM);
  const right = _right.set(1, 0, 0).applyQuaternion(_qM);
  if (Object.hasOwn(POSES, pose)) {
    _chestB = spine;
    _headB = head;
    _c0.copy(chest);
    _mC.copy(spine.matrixWorld).invert();
    _h0.copy(headP);
    _mH.copy(head.matrixWorld).invert();
    POSES[pose](bones, s);
  } else if (pose === 'Pray') {
    const meet = _t1.copy(chest).addScaledVector(fwd, 0.34).add(_off.set(0, 0.08, 0));
    const elbowL = _t2.copy(chest).addScaledVector(fwd, 0.06).addScaledVector(right, 0.24);
    const elbowR = _t3.copy(chest).addScaledVector(fwd, 0.06).addScaledVector(right, -0.24);
    foldArm(model, 'Left', elbowL, meet);
    foldArm(model, 'Right', elbowR, meet);
    if (bones.LeftHand) aimHand(bones.LeftHand, POSE_UP, _t4.copy(right).multiplyScalar(-1));
    if (bones.RightHand) aimHand(bones.RightHand, POSE_UP, right);
  } else if (pose === 'Cheer') {
    const leftT = _t1.copy(headP).add(_off.set(0, 0.48, 0)).addScaledVector(right, 0.62).addScaledVector(fwd, -0.04);
    const rightT = _t2.copy(headP).add(_off.set(0, 0.48, 0)).addScaledVector(right, -0.62).addScaledVector(fwd, -0.04);
    foldArm(model, 'Left', leftT, leftT);
    foldArm(model, 'Right', rightT, rightT);
    if (bones.LeftHand) aimHand(bones.LeftHand, _t3.copy(right).add(_off.set(0, 1.2, 0)), fwd);
    if (bones.RightHand) aimHand(bones.RightHand, _t3.copy(right).multiplyScalar(-1).add(_off.set(0, 1.2, 0)), fwd);
  } else if (pose === 'Throw') {
    // No throw clip in the GLB. Overhand: cock behind the head, then the hand leads forward and up.
    const u = Math.max(0, Math.min(1, t));
    const fire = u < 0.28 ? 0 : Math.min(1, (u - 0.28) / 0.3);
    // each .add(_off.set(...)) finishes before the next _off.set: the receiver of .lerp is evaluated before its argument
    const elbow = _t1.copy(headP).addScaledVector(right, -0.34).addScaledVector(fwd, -0.22).add(_off.set(0, 0.12, 0))
      .lerp(_t2.copy(headP).addScaledVector(right, -0.08).addScaledVector(fwd, 0.26).add(_off.set(0, 0.32, 0)), fire);
    const hand = _t3.copy(headP).addScaledVector(right, -0.16).addScaledVector(fwd, -0.42).add(_off.set(0, 0.04, 0))
      .lerp(_t4.copy(headP).addScaledVector(fwd, 0.62).add(_off.set(0, 0.72, 0)), fire);
    foldArm(model, 'Right', elbow, hand);
    if (bones.RightHand) aimHand(bones.RightHand, _t2.copy(fwd).add(_off.set(0, fire > 0.15 ? 1 : 0.25, 0)), _t5.copy(right).multiplyScalar(-1));
  }
  if (w < 1) for (let i = 0; i < BLEND.length; i++) { const b = bones[BLEND[i]]; if (b) { _qB.copy(b.quaternion); b.quaternion.copy(kept[i]).slerp(_qB, w); } }
  POSE_FX.hop *= w;
  POSE_FX.step *= w;
  return true;
}

// MoneyRain's bills: one leaves the right hand at each of the five flicks, arcs out and down, spinning, and shrinks away
// before the gesture ends. Holder space (the avatar's facing); s < 0 hides them.
function flyBills(group, s) {
  group.visible = s >= 0;
  for (let i = 0; i < group.children.length; i++) {
    const b = group.children[i], a = s - (0.325 + i * 0.25);
    b.visible = s >= 0 && a >= 0 && a <= 0.85;
    if (!b.visible) continue;
    b.position.set(-0.36 - (0.35 + 0.2 * (i % 3)) * a, 0.95 + (1.5 + 0.25 * (i % 2)) * a - 1.6 * a * a, 0.36 + (0.9 + 0.15 * ((i + 1) % 3)) * a);
    b.rotation.set(a * 7 + i, a * 5, a * 3);
    b.scale.setScalar(Math.max(0.01, Math.min(1, a / 0.08, (0.85 - a) / 0.2)));
  }
}

class Avatar {
  constructor(sys, scene, { id, name, color, local, species }) {
    this.sys = sys;
    this.scene = scene;
    this.id = id;
    this.local = !!local;
    this.species = speciesId(species);
    this.modelSpecies = 0;
    this.name = name || '익명';
    this.color = color || '#3fe6ff';
    this.cosmetics = [];
    this.tagTheme = '';
    this.fxId = '';
    this.fx = null;
    this.root = new THREE.Group();
    this.holder = new THREE.Group();
    this.root.add(this.holder);
    this.base = 'Idle';
    this.current = null;
    this.emoteAction = null;
    this.emoteStops = false; // the playing clip is a reaction gesture: moving ends it
    this.pose = '';
    this.poseAt = 0;
    this.poseUntil = 0;
    this.propSet = null; // gesture props on this model: kind -> [{ obj, key, base }]
    this.propKind = '';
    this.kept = null; // the clip's rotations of the BLEND bones under the last held pose (holdPose)
    this.keptOn = false;
    this.danceUntil = 0;
    this.speed = 0;
    const shadow = new THREE.Mesh(sys.shadowGeo, sys.shadowMat);
    shadow.position.y = 0.025;
    shadow.layers.set(1);
    this.root.add(shadow);
    if (this.local) {
      // The wet-street ground (ts3d/world.js) is drawn with a polygon offset (pavers -1, asphalt -2, road paint -4) that
      // pulls it a few centimetres toward the camera at the follow camera's low angle, more than this ring's 2 cm of
      // height above the plaza: without an offset of its own the ring failed the depth test and vanished. -6 keeps it in
      // front of every ground layer; renderOrder 1 draws it after the dark shadow blob so the blob cannot dim it.
      this.ringMat = new THREE.MeshBasicMaterial({ color: ringTone(this.color), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 });
      this.ring = new THREE.Mesh(sys.ringGeo, this.ringMat);
      this.ring.position.y = 0.035;
      this.ring.renderOrder = 1;
      this.ring.layers.set(1);
      this.root.add(this.ring);
    }
    this.tagCanvas = makeCanvas(256, 64);
    this.tagTex = new THREE.CanvasTexture(this.tagCanvas);
    this.tagTex.colorSpace = THREE.SRGBColorSpace;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tagTex, transparent: true, depthWrite: false }));
    this.tag.scale.set(1.9, 0.475, 1);
    this.tag.position.y = sys.height + 0.42;
    this.tag.renderOrder = 10;
    this.tag.layers.set(2);
    this.root.add(this.tag);
    this.paintTag();
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    this.bubble.visible = false;
    this.bubble.renderOrder = 11;
    this.bubble.layers.set(2);
    this.root.add(this.bubble);
    this.bubbleT = 0;
    scene.add(this.root);
    this.attach();
  }

  spec() {
    const p = this.sys.plan(this.species);
    return p.show ? this.sys.species.get(p.show) : null;
  }

  // Fetch the model this avatar needs (the local player always; remotes once they are on screen).
  want() {
    this.asked = true;
    const p = this.sys.plan(this.species);
    if (p.need) this.sys.load(p.need);
  }

  detachModel() {
    if (!this.model) return;
    this.endPose();
    this.keptOn = false;
    for (const kind in this.propSet || {}) for (const p of this.propSet[kind]) p.obj.removeFromParent(); // shared geometry: nothing to dispose
    this.propSet = null;
    this.mixer?.stopAllAction();
    this.holder.remove(this.model);
    if (this.fallback) this.model.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    else this.model.traverse((o) => o.skeleton?.dispose());
    this.mainMat?.dispose();
    this.mainMat = null;
    this.hat?.geometry?.dispose();
    this.hat?.material?.dispose();
    this.hat = null;
    this.model = null;
    this.mixer = null;
    this.actions = null;
    this.current = null;
    this.emoteAction = null;
    this.fallback = false;
    this.modelSpecies = 0;
  }

  setSpecies(id) {
    id = speciesId(id);
    if (id === this.species) return;
    this.species = id;
    this.asked = false;
    this.attach();
  }

  paintTag() {
    paintNameTag(this.tagCanvas, this.name, this.color, this.local, this.tagTheme);
    this.tagTex.needsUpdate = true;
  }

  attach() {
    if (this.disposed) return;
    const p = this.sys.plan(this.species);
    // A real model stays until this species' own model is in (a species change never drops to the stand-in).
    if (this.model && !this.fallback) {
      if (p.show !== this.species) {
        if (p.need) this.sys.waiting.add(this);
        if (this.local) this.want();
        return;
      }
      if (this.modelSpecies === this.species) return;
      this.detachModel();
    }
    const spec = p.show ? this.sys.species.get(p.show) : null;
    if (!spec) {
      if (!this.fallback) this.attachFallback();
      if (p.need) this.sys.waiting.add(this);
      if (this.local) this.want();
      return;
    }
    if (this.fallback) this.detachModel();
    const sys = this.sys;
    const model = cloneSkinned(spec.gltf.scene);
    model.scale.setScalar(spec.scale);
    model.position.y = spec.foot;
    model.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material?.name === 'Main') {
        this.mainMat ||= o.material.clone();
        this.mainMat.color.set(this.color);
        o.material = this.mainMat;
      }
    });
    this.holder.add(model);
    this.model = model;
    this.modelSpecies = p.show;
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const clip of spec.gltf.animations) {
      const action = this.mixer.clipAction(clip);
      if (!LOOPS.has(clip.name)) { action.clampWhenFinished = true; action.loop = THREE.LoopOnce; }
      this.actions[clip.name] = action;
    }
    this.mixer.addEventListener('finished', (e) => {
      if (e.action !== this.emoteAction) return;
      this.emoteAction = null;
      this.fadeTo(this.base, 0.3, true);
    });
    this.fadeTo(this.base, 0, true);
    this.syncHat();
  }

  setEquip(ids) {
    const src = Array.isArray(ids) ? ids : String(ids || '').split(',');
    const next = src.map((id) => String(id || '').trim()).filter((id) => id && id !== 'taxi').slice(0, 6);
    if (next.join(',') === this.cosmetics.join(',')) return; // a peer's presence repeats its list every frame
    this.cosmetics = next;
    this.syncHat();
    const theme = next.find((id) => Object.hasOwn(TAG_THEMES, id)) || ''; // own keys only: ids come from peers
    if (theme !== this.tagTheme) { this.tagTheme = theme; this.paintTag(); }
    this.syncRingFx(next.find((id) => Object.hasOwn(RING_FX, id)) || '');
  }

  // The shop's foot-ring effect: a flat painted square under the avatar (anyone's, so others see it), in place of the local plain ring.
  syncRingFx(id) {
    if (id === this.fxId) return;
    this.fxId = id;
    if (this.fx) { this.fx.removeFromParent(); this.fx.material.dispose(); this.fx = null; }
    if (this.ring) this.ring.visible = !id;
    if (!id) return;
    const mat = new THREE.MeshBasicMaterial({ map: this.sys.ringFxTex(id), transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 });
    const fx = new THREE.Mesh(this.sys.ringFxGeo, mat);
    fx.position.y = 0.036;
    fx.renderOrder = 1;
    fx.layers.set(1);
    this.root.add(fx);
    this.fx = fx;
  }

  syncHat() {
    if (this.hat) {
      this.hat.removeFromParent();
      this.hat.geometry?.dispose();
      this.hat.material?.dispose();
      this.hat = null;
    }
    if (!this.cosmetics.includes('hat_ribbon') || !this.model || this.fallback) return;
    const head = poseBones(this.model).Head;
    if (!head) return;
    const unit = 1 / (this.model.scale?.x || 1);
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.16 * unit, 0.035 * unit, 8, 16),
      new THREE.MeshStandardMaterial({ color: '#ff3d9a', roughness: 0.45, metalness: 0.05, name: 'Ribbon' }),
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = 0.12 * unit;
    head.add(mesh);
    this.hat = mesh;
  }

  attachFallback() {
    if (this.model || this.disposed) return;
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: this.color, metalness: 0.35, roughness: 0.3 });
    this.mainMat = paint;
    const dark = new THREE.MeshStandardMaterial({ color: '#16181f', metalness: 0.5, roughness: 0.25 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.55, 6, 14), paint);
    body.position.y = 0.85;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14), paint);
    head.position.y = 1.5;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.12), dark);
    visor.position.set(0, 1.52, 0.24);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.02), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.2, 2.6) }));
    eye.position.set(0, 1.52, 0.31);
    g.add(body, head, visor, eye);
    this.holder.add(g);
    this.model = g;
    this.fallback = true;
  }

  fadeTo(name, dur = 0.25, force = false) {
    const next = this.actions?.[name];
    if (!next) return;
    if (next === this.current && !force) return;
    const prev = this.current;
    next.enabled = true;
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(dur).play();
    if (prev && prev !== next) prev.fadeOut(dur);
    this.current = next;
  }

  /** speed in m/s; sitting picks the seated loop. */
  setMotion(speed, sitting = false) {
    this.speed = speed;
    // Moving ends a held pose (not the pouch throw) and a reaction clip; a jump or the dock's clips play out as before.
    const moving = speed > 0.35;
    if (moving && this.pose && !GESTURES[this.pose]?.keep) this.endPose();
    const stop = moving && this.emoteStops && !!this.emoteAction;
    if (stop) { this.emoteAction = null; this.emoteStops = false; }
    const now = performance.now();
    let base = sitting ? 'Sitting' : speed > 4.3 ? 'Running' : moving ? 'Walking' : 'Idle';
    if (base === 'Idle' && this.danceUntil > now) base = 'Dance';
    else if (base !== 'Idle') this.danceUntil = 0;
    if (base !== this.base || stop) {
      this.base = base;
      if (!this.emoteAction) this.fadeTo(base, base === 'Idle' ? 0.35 : 0.2);
    }
    if (this.actions) {
      if (this.actions.Walking) this.actions.Walking.timeScale = clamp(speed / 2.1, 0.6, 1.6);
      if (this.actions.Running) this.actions.Running.timeScale = clamp(speed / 6.4, 0.75, 1.3);
    }
  }

  // name: a GESTURES key (ts3d/gestures.js: the reactions, Pray, Cheer, Throw) or a clip (Jump, Dance with hold seconds).
  emote(name, hold = 0) {
    const g = Object.hasOwn(GESTURES, name) ? GESTURES[name] : null;
    if (g?.dance) { name = g.clip; hold = g.ms / 1000; }
    else if (g) { this.gesture(name, g); return; }
    this.endPose();
    this.emoteStops = false;
    if (name === 'Dance') {
      this.danceUntil = performance.now() + (hold || 6) * 1000;
      if (this.speed <= 0.35) {
        this.base = 'Dance';
        this.emoteAction = null;
        this.fadeTo('Dance', 0.3);
      }
      return;
    }
    const pick = name === 'Jump' && this.speed > 0.35 && this.actions?.WalkJump ? 'WalkJump' : name;
    const action = this.actions?.[pick];
    if (!action) return;
    action.setLoop(THREE.LoopOnce, 1);
    this.emoteAction = action;
    this.fadeTo(pick, 0.18, true);
  }

  // A gesture from the table: its clip (once, `reps` times, at `rate`) and/or its pose for `ms`. A pose alone keeps the
  // base loop under it (idle, sitting); a dance stops for it.
  gesture(name, g) {
    const now = performance.now();
    this.endPose();
    if (g.pose) {
      this.pose = name;
      this.poseAt = now;
      this.poseUntil = now + g.ms;
    }
    this.emoteStops = false;
    const action = g.clip ? this.actions?.[g.clip] : null;
    if (action) {
      action.setLoop(g.reps > 1 ? THREE.LoopRepeat : THREE.LoopOnce, g.reps || 1);
      this.emoteAction = action;
      this.emoteStops = !g.keep;
      this.fadeTo(g.clip, 0.18, true);
      action.setEffectiveTimeScale(g.rate || 1);
      return;
    }
    this.emoteAction = null;
    if (this.base === 'Dance') { this.base = 'Idle'; this.danceUntil = 0; }
    const want = this.speed > 0.35 ? '' : this.base;
    if (want && this.current && this.actions?.[want] && this.current !== this.actions[want]) this.fadeTo(want, 0.15);
  }

  // The clip's rotations back on the bones the last held pose turned (before the mixer runs, and when a pose ends).
  unpose() {
    if (!this.keptOn) return;
    this.keptOn = false;
    if (!this.model || this.fallback) return;
    const B = poseBones(this.model);
    for (let i = 0; i < BLEND.length; i++) { const b = B[BLEND[i]]; if (b) b.quaternion.copy(this.kept[i]); }
  }

  // Ends the held pose now: the body, hop, step and turn back to the clip, props hidden.
  endPose() {
    if (this.propKind) this.hideProp();
    this.unpose();
    if (!this.pose) return;
    this.pose = '';
    this.holder.position.y = 0;
    if (this.model && !this.fallback) { this.model.position.z = 0; this.model.rotation.y = 0; }
  }

  // The gesture's prop parts, made for this model the first time: hand parts under the hand bone (scaled back to metres),
  // the flying bills under the holder. w: the gesture's weight (the prop pops in and out with it), s: its seconds.
  showProp(kind, w, s) {
    if (!this.model || this.fallback) return;
    if (this.propKind && this.propKind !== kind) this.hideProp();
    let set = this.propSet?.[kind];
    if (!set) {
      const src = this.sys.props()[kind];
      if (!src) return;
      const bones = poseBones(this.model);
      set = [];
      for (const key of Object.keys(src)) {
        const obj = src[key].clone();
        if (key === 'fly') { this.holder.add(obj); set.push({ obj, key, base: 1 }); continue; }
        const hand = bones[key === 'L' ? 'LeftHand' : 'RightHand'];
        if (!hand) continue;
        const wrap = new THREE.Group();
        const base = 1 / (hand.getWorldScale(_propScale).x || 1);
        wrap.add(obj);
        hand.add(wrap);
        set.push({ obj: wrap, key, base });
      }
      (this.propSet ||= {})[kind] = set;
    }
    this.propKind = kind;
    const k = Math.min(1, w * 1.6);
    for (let i = 0; i < set.length; i++) {
      const p = set[i];
      if (p.key === 'fly') { flyBills(p.obj, POSE_FX.fly); continue; }
      p.obj.visible = k > 0.01;
      p.obj.scale.setScalar(p.base * Math.max(0.01, k));
    }
    if (kind === 'torch') { const flame = set[0]?.obj.children[0]?.children[2]; if (flame) flame.scale.set(1 + 0.12 * Math.sin(s * 23), 1 + 0.2 * Math.sin(s * 17), 1 + 0.12 * Math.sin(s * 19)); }
  }

  hideProp() {
    for (const p of this.propSet?.[this.propKind] || []) p.obj.visible = false;
    this.propKind = '';
  }

  say(glyph) {
    this.bubble.material.map = this.sys.bubbleTex(glyph);
    this.bubble.material.needsUpdate = true;
    this.bubble.visible = true;
    this.bubbleT = 0;
  }

  setName(name) {
    if (name === this.name) return;
    this.name = name || '익명';
    this.paintTag();
  }

  setColor(color) {
    if (!color || color === this.color) return;
    this.color = color;
    this.mainMat?.color.set(color);
    this.ringMat?.color.copy(ringTone(color));
    this.paintTag();
  }

  update(dt, t) {
    this.unpose();
    this.mixer?.update(dt);
    const now = performance.now();
    if (this.pose && now > this.poseUntil) this.endPose();
    if (this.pose) {
      const g = GESTURES[this.pose], len = Math.max(1, this.poseUntil - this.poseAt), s = (now - this.poseAt) / 1000;
      const w = gestureWeight(s, len / 1000, g);
      this.kept ||= BLEND.map(() => new THREE.Quaternion());
      this.keptOn = holdPose(this.model, this.pose, Math.min(1, (now - this.poseAt) / len), s, w, this.kept);
      const seated = this.base === 'Sitting' && this.pose !== 'Throw'; // a seated avatar gestures without hopping, stepping or turning
      this.holder.position.y = seated ? 0 : POSE_FX.hop;
      if (this.model && !this.fallback) { this.model.position.z = seated ? 0 : POSE_FX.step; this.model.rotation.y = seated ? 0 : POSE_FX.spin; }
      if (g.prop) this.showProp(g.prop, w, s);
    }
    if (this.fallback) this.model.position.y = this.speed > 0.35 ? Math.abs(Math.sin(t * 9)) * 0.08 : Math.sin(t * 2) * 0.02;
    if (this.bubble.visible) {
      const b = (this.bubbleT += dt);
      const pop = b < 0.22 ? 1 + Math.sin((b / 0.22) * Math.PI) * 0.35 : 1;
      const s = Math.min(1, b / 0.12) * pop * 0.95;
      this.bubble.scale.set(s, s, 1);
      this.bubble.position.y = this.sys.height + 1.05 + Math.min(0.35, b * 0.25);
      this.bubble.material.opacity = b > 2.3 ? Math.max(0, 1 - (b - 2.3) / 0.5) : 1;
      if (b > 2.8) this.bubble.visible = false;
    }
    if (this.ring) {
      const p = 1 + Math.sin(t * 3.2) * 0.05;
      this.ring.scale.set(p, 1, p);
    }
    if (this.fx) {
      const look = Object.hasOwn(RING_FX, this.fxId) ? RING_FX[this.fxId] : null, p = 1 + Math.sin(t * 3.2) * 0.04;
      this.fx.scale.set(p, 1, p);
      this.fx.rotation.y = (t * (look?.spin || 0) * Math.PI * 2) % (Math.PI * 2);
      if (look?.twinkle) this.fx.material.opacity = 0.7 + 0.3 * Math.abs(Math.sin(t * 4.1));
    }
  }

  dispose() {
    this.disposed = true;
    this.sys.waiting.delete(this);
    this.sys.all.delete(this);
    this.mixer?.stopAllAction();
    this.scene.remove(this.root);
    this.tagTex.dispose();
    this.tag.material.dispose();
    this.bubble.material.dispose();
    this.ringMat?.dispose();
    this.fx?.material.dispose();
    if (this.fallback) this.model.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
    else this.mainMat?.dispose();
  }
}
