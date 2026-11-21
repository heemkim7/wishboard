// Animated GLTF characters. Mousey is the Mixamo rig; Cat and Bear reuse its clips.
// One AnimationMixer per avatar; locomotion states cross-fade and emotes play once on top.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { makeCanvas, paintNameTag, paintBubble } from './art.js?v=202611211159';
import { MODEL_URL, modelFor } from './loadplan.js?v=202611211159';

const LOOPS = new Set(['Idle', 'Walking', 'Running', 'Dance', 'Sitting', 'Standing']);
export const EMOTES = {
  1: { anim: 'Pray', glyph: '🙏', label: '대박기원' },
  2: { anim: 'Jump', glyph: '🎆', label: '폭죽발사' },
  3: { anim: 'Cheer', glyph: '🙌', label: '만세' },
  4: { anim: 'Dance', glyph: '💃', label: 'K-댄스', hold: 6 },
};
// Quick reactions: a bubble over the head (plus a short gesture), sent to others as a 'react' broadcast by index.
// Glyphs stay within Emoji 11 so Windows 10's Segoe UI Emoji can draw them.
export const REACTIONS = [
  { g: '👋', anim: 'Wave' }, { g: '😂', anim: 'Yes' }, { g: '😍', anim: 'Yes' }, { g: '😎' }, { g: '🥳', anim: 'Jump' }, { g: '😭', anim: 'No' },
  { g: '😮' }, { g: '🤔', anim: 'No' }, { g: '👍', anim: 'ThumbsUp' }, { g: '👏', anim: 'Yes' }, { g: '🙌', anim: 'Jump' }, { g: '🔥' },
  { g: '💯', anim: 'ThumbsUp' }, { g: '❤️' }, { g: '💖', anim: 'Yes' }, { g: '🎉', anim: 'Jump' }, { g: '✨' }, { g: '🐟', anim: 'ThumbsUp' },
  { g: '🍜' }, { g: '🎶', anim: 'Dance' }, { g: '🗽', anim: 'Wave' }, { g: '🚕' }, { g: '💸', anim: 'Yes' }, { g: '😴', anim: 'No' },
];
export const AVATAR_COLORS = ['#ff3d9a', '#3fe6ff', '#ffcf5a', '#39f58a', '#b84dff', '#ff6a3d', '#f4f6ff', '#4d7cff'];
export const SPECIES = [
  { id: 1, label: '쥐', glyph: '🐭' },
  { id: 2, label: '고양이', glyph: '🐱' },
  { id: 3, label: '곰', glyph: '🐻' },
];
export function speciesId(id) {
  const n = Math.floor(Number(id));
  return n === 2 || n === 3 ? n : 1;
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
  // Foot ring: a thin line (4 cm) in the player's colour.
  sys.ringGeo = new THREE.RingGeometry(0.645, 0.685, 48).rotateX(-Math.PI / 2);
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
      // Coat, Fur, Belly and Paw stay as they are. Mousey's Ch14_Body is not renamed to Main.
      if ((id === 2 || id === 3) && m.name === 'Main' && o.name !== 'Ch14_Body') m.name = 'Coat';
      if (m.name === 'Main') { m.metalness = 0.35; m.roughness = 0.32; }
      else if (m.name === 'Grey') { m.metalness = 0.7; m.roughness = 0.3; m.color.set('#c5cad3'); }
      else if (m.name === 'Black') { m.metalness = 0.45; m.roughness = 0.22; }
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
  // Only the player's own species is fetched up front; others on first sight (Avatar.want) or by prefetch().
  loadId(speciesId(first));

  function create(opts) {
    const a = new Avatar(sys, scene, opts);
    sys.all.add(a);
    return a;
  }
  function prefetch() { for (const key of Object.keys(sources)) loadId(speciesId(key)); }
  return { create, sys, prefetch, want: loadId, get ready() { return sys.species.size > 0; } };
}

// Two-bone aim so the hands meet a world point. The Mixamo clip set has no prayer or cheer.
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qP = new THREE.Quaternion();
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
  const cur = new THREE.Vector3(0, 1, 0).applyQuaternion(_q);
  const want = dir.clone().normalize();
  if (cur.dot(want) < 0.999) _q.premultiply(new THREE.Quaternion().setFromUnitVectors(cur, want));
  b.quaternion.copy(_qP.clone().invert()).multiply(_q);
}
function foldArm(model, side, elbowTarget, handTarget) {
  const bones = poseBones(model);
  const upper = bones[side + 'Arm'];
  const fore = bones[side + 'ForeArm'];
  if (!upper || !fore) return;
  pointY(upper, elbowTarget.clone().sub(boneAt(upper, new THREE.Vector3())));
  pointY(fore, handTarget.clone().sub(boneAt(fore, new THREE.Vector3())));
}
function aimHand(hand, fingerDir, palmDir) {
  const y = fingerDir.clone().normalize();
  const z = palmDir.clone().addScaledVector(y, -palmDir.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  const worldQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  hand.updateWorldMatrix(true, false);
  hand.parent.getWorldQuaternion(_qP);
  hand.quaternion.copy(_qP.clone().invert()).multiply(worldQ);
  hand.traverse((b) => { if (b.isBone && b !== hand) b.quaternion.identity(); });
}
function holdPose(model, pose, t = 1) {
  if (!model) return;
  const bones = poseBones(model);
  const spine = bones.Spine2 || bones.Spine;
  const head = bones.Head;
  if (!spine || !head) return;
  const chest = boneAt(spine, new THREE.Vector3());
  const headP = boneAt(head, new THREE.Vector3());
  model.updateWorldMatrix(true, false);
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()));
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()));
  const up = new THREE.Vector3(0, 1, 0.18);
  if (pose === 'Pray') {
    const meet = chest.clone().addScaledVector(fwd, 0.34).add(new THREE.Vector3(0, 0.08, 0));
    const elbowL = chest.clone().addScaledVector(fwd, 0.06).addScaledVector(right, 0.24);
    const elbowR = chest.clone().addScaledVector(fwd, 0.06).addScaledVector(right, -0.24);
    foldArm(model, 'Left', elbowL, meet);
    foldArm(model, 'Right', elbowR, meet);
    if (bones.LeftHand) aimHand(bones.LeftHand, up, right.clone().multiplyScalar(-1));
    if (bones.RightHand) aimHand(bones.RightHand, up, right);
  } else if (pose === 'Cheer') {
    const leftT = headP.clone().add(new THREE.Vector3(0, 0.48, 0)).addScaledVector(right, 0.62).addScaledVector(fwd, -0.04);
    const rightT = headP.clone().add(new THREE.Vector3(0, 0.48, 0)).addScaledVector(right, -0.62).addScaledVector(fwd, -0.04);
    foldArm(model, 'Left', leftT, leftT);
    foldArm(model, 'Right', rightT, rightT);
    if (bones.LeftHand) aimHand(bones.LeftHand, right.clone().add(new THREE.Vector3(0, 1.2, 0)), fwd);
    if (bones.RightHand) aimHand(bones.RightHand, right.clone().multiplyScalar(-1).add(new THREE.Vector3(0, 1.2, 0)), fwd);
  } else if (pose === 'Throw') {
    // No throw clip in the GLB. Overhand: cock behind the head, then the hand leads forward and up.
    const u = Math.max(0, Math.min(1, t));
    const fire = u < 0.28 ? 0 : Math.min(1, (u - 0.28) / 0.3);
    const elbow = headP.clone().addScaledVector(right, -0.34).addScaledVector(fwd, -0.22).add(new THREE.Vector3(0, 0.12, 0))
      .lerp(headP.clone().addScaledVector(right, -0.08).addScaledVector(fwd, 0.26).add(new THREE.Vector3(0, 0.32, 0)), fire);
    const hand = headP.clone().addScaledVector(right, -0.16).addScaledVector(fwd, -0.42).add(new THREE.Vector3(0, 0.04, 0))
      .lerp(headP.clone().addScaledVector(fwd, 0.62).add(new THREE.Vector3(0, 0.72, 0)), fire);
    foldArm(model, 'Right', elbow, hand);
    if (bones.RightHand) aimHand(bones.RightHand, fwd.clone().add(new THREE.Vector3(0, fire > 0.15 ? 1 : 0.25, 0)), right.clone().multiplyScalar(-1));
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
    this.root = new THREE.Group();
    this.holder = new THREE.Group();
    this.root.add(this.holder);
    this.base = 'Idle';
    this.current = null;
    this.emoteAction = null;
    this.pose = '';
    this.poseUntil = 0;
    this.danceUntil = 0;
    this.speed = 0;
    const shadow = new THREE.Mesh(sys.shadowGeo, sys.shadowMat);
    shadow.position.y = 0.025;
    shadow.layers.set(1);
    this.root.add(shadow);
    if (this.local) {
      this.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(this.color).multiplyScalar(2.2), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
      this.ring = new THREE.Mesh(sys.ringGeo, this.ringMat);
      this.ring.position.y = 0.035;
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
    paintNameTag(this.tagCanvas, this.name, this.color, this.local);
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
    this.cosmetics = src.map((id) => String(id || '').trim()).filter((id) => id && id !== 'taxi').slice(0, 4);
    this.syncHat();
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
    if (speed > 0.35 && this.pose !== 'Throw') this.pose = '';
    const now = performance.now();
    let base = sitting ? 'Sitting' : speed > 4.3 ? 'Running' : speed > 0.35 ? 'Walking' : 'Idle';
    if (base === 'Idle' && this.danceUntil > now) base = 'Dance';
    else if (base !== 'Idle') this.danceUntil = 0;
    if (base !== this.base) {
      this.base = base;
      if (!this.emoteAction) this.fadeTo(base, base === 'Idle' ? 0.35 : 0.2);
    }
    if (this.actions) {
      if (this.actions.Walking) this.actions.Walking.timeScale = clamp(speed / 2.1, 0.6, 1.6);
      if (this.actions.Running) this.actions.Running.timeScale = clamp(speed / 6.4, 0.75, 1.3);
    }
  }

  emote(name, hold = 0) {
    if (name === 'Pray' || name === 'Cheer' || name === 'Throw') {
      this.pose = name;
      this.poseUntil = performance.now() + (name === 'Throw' ? 980 : 2400);
      this.emoteAction = null;
      if (this.current && this.actions?.Idle && this.speed <= 0.35) this.fadeTo('Idle', 0.15);
      return;
    }
    this.pose = '';
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
    this.emoteAction = action;
    this.fadeTo(pick, 0.18, true);
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
    this.ringMat?.color.set(color).multiplyScalar(2.2);
    this.paintTag();
  }

  update(dt, t) {
    this.mixer?.update(dt);
    if (this.pose && performance.now() > this.poseUntil) this.pose = '';
    if (this.pose === 'Throw') {
      const u = 1 - Math.max(0, (this.poseUntil - performance.now()) / 980);
      this.holder.position.y = Math.sin(Math.min(1, u * 1.2) * Math.PI) * 0.75;
      holdPose(this.model, 'Throw', u);
    } else {
      if (this.holder.position.y) this.holder.position.y = 0;
      if (this.pose) holdPose(this.model, this.pose, 1);
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
    if (this.fallback) this.model.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
    else this.mainMat?.dispose();
  }
}
