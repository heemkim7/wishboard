// Reaction gestures (ts3d/gestures.js, posed by ts3d/avatars.js) and the 3D lucky pouch (ts3d/pouch.js).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { describe, it } from 'node:test';

const VENDOR = new URL('../vendor/three/', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'three') return { url: VENDOR + 'build/three.module.js', shortCircuit: true };
    if (specifier.startsWith('three/addons/')) return { url: VENDOR + 'examples/jsm/' + specifier.slice(13), shortCircuit: true };
    return next(specifier, context);
  },
});
// Name tags and the pouch texture paint on a canvas: a do-nothing 2D context is enough here.
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 40 }) : /Gradient$/.test(k) ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
globalThis.document ||= { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d }) };

const THREE = await import('three');
const { GESTURES, REACTIONS, CLIPS, gestureMs, gestureWeight, pulses, ease, THROW, throwSwing, throwHop, throwSize } = await import('../ts3d/gestures.js');
const AV = await import('../ts3d/avatars.js');
const { createPouchKit, POUCH_H, POUCH_PROFILE, NECK_Y } = await import('../ts3d/pouch.js');
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// The reaction order is the wire format ({ t:'b', e:'react', p:{ r: index } }): these are the 24 glyphs as they were sent
// before the gestures existed, code point for code point.
const WIRE = ['1f44b', '1f602', '1f60d', '1f60e', '1f973', '1f62d', '1f62e', '1f914', '1f44d', '1f44f', '1f64c', '1f525',
  '1f4af', '2764 fe0f', '1f496', '1f389', '2728', '1f41f', '1f35c', '1f3b6', '1f5fd', '1f695', '1f4b8', '1f634'];
const cps = (s) => [...s].map((c) => c.codePointAt(0).toString(16)).join(' ');

// Clip lengths (s) straight from the model file, so a rate or a repeat count cannot drift from the real clip.
function clipSeconds(file) {
  const buf = readFileSync(new URL('../' + file, import.meta.url));
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  return Object.fromEntries(json.animations.map((a) => [a.name, Math.max(...a.samplers.map((s) => json.accessors[s.input].max[0]))]));
}

describe('reaction gesture table', () => {
  it('keeps the 24 glyphs in their wire order, each with its own gesture', () => {
    assert.equal(REACTIONS.length, 24);
    assert.deepEqual(REACTIONS.map((r) => cps(r.g)), WIRE);
    assert.deepEqual(AV.REACTIONS, REACTIONS, 'avatars.js re-exports the table (ui.js and timesSquare3d.js import it there)');
    const names = REACTIONS.map((r) => r.anim);
    assert.equal(new Set(names).size, 24, 'no two glyphs share a gesture');
    for (const n of names) assert.ok(Object.hasOwn(GESTURES, n), n);
    // none of the old stand-ins: a nod for laughing, a head shake for crying or thinking, nothing at all
    const by = Object.fromEntries(REACTIONS.map((r) => [cps(r.g), r.anim]));
    for (const cp of ['1f602', '1f62d', '1f914', '1f634', '1f4b8', '1f41f']) assert.ok(!['Yes', 'No', 'ThumbsUp'].includes(by[cp]), cp);
    for (const g of ['Yes', 'No']) assert.equal(names.includes(g), false, g);
  });

  it('runs every reaction for 1.2 to 2.5 s, and each clip fits the time it is given', () => {
    const clips = clipSeconds('assets/models/MouseToy.glb');
    for (const { g, anim } of REACTIONS) {
      const spec = GESTURES[anim];
      assert.ok(spec.ms >= 1200 && spec.ms <= 2500, `${g} ${anim} ${spec.ms}`);
      assert.equal(gestureMs(anim), spec.ms);
      assert.ok(spec.pose || spec.clip, anim);
      if (!spec.clip) continue;
      assert.ok(CLIPS.includes(spec.clip), spec.clip);
      if (spec.dance) continue; // the Dance loop is the base state for ms
      const len = (clips[spec.clip] * (spec.reps || 1)) / (spec.rate || 1);
      assert.ok(len <= spec.ms / 1000 + 0.05, `${anim}: clip ${len.toFixed(2)} s in ${spec.ms} ms`);
      if (!spec.pose) assert.ok(len >= spec.ms / 1000 - 0.1, `${anim}: a clip-only gesture lasts as long as its clip`);
    }
    for (const name of ['Pray', 'Cheer', 'Throw']) assert.ok(GESTURES[name]?.pose, name);
    assert.equal(GESTURES.Throw.ms, 700);
    assert.equal(GESTURES.Throw.keep, true, 'the pouch throw goes on while walking');
    assert.equal(gestureMs('nope'), 0);
  });

  it('blends a pose in and out', () => {
    const spec = { fadeIn: 0.2, fadeOut: 0.3 };
    assert.equal(gestureWeight(0, 2, spec), 0);
    assert.equal(gestureWeight(1, 2, spec), 1);
    assert.equal(gestureWeight(2, 2, spec), 0);
    assert.equal(gestureWeight(-0.1, 2, spec), 0);
    assert.equal(gestureWeight(2.1, 2, spec), 0);
    assert.equal(gestureWeight(NaN, 2, spec), 0);
    let prev = -1;
    for (let s = 0; s <= 0.2; s += 0.02) { const w = gestureWeight(s, 2, spec); assert.ok(w >= prev); prev = w; }
    for (let s = 1.7; s <= 2; s += 0.03) { const w = gestureWeight(s, 2, spec); assert.ok(w <= prev + 1e-9); prev = w; }
    // the throw is in by the time the arm starts to swing, and gives the arm back over a quarter second
    assert.equal(gestureWeight(0, 0.7, GESTURES.Throw), 0);
    for (const s of [THROW.wind + 0.01, THROW.release, 0.45]) assert.equal(gestureWeight(s, 0.7, GESTURES.Throw), 1);
    assert.ok(gestureWeight(0.6, 0.7, GESTURES.Throw) < 1 && gestureWeight(0.6, 0.7, GESTURES.Throw) > 0);
    // defaults: 0.2 in, 0.3 out
    assert.equal(gestureWeight(0.1, 2), 0.5);
  });

  it('pulses count and ease clamp', () => {
    let peaks = 0, last = 0, rising = true;
    for (let s = 0; s <= 2; s += 0.001) {
      const p = pulses(s, 0.2, 1.8, 4);
      assert.ok(p >= 0 && p <= 1);
      if (rising && p < last) { peaks++; rising = false; } else if (!rising && p > last) rising = true;
      last = p;
    }
    assert.equal(peaks, 4);
    assert.equal(pulses(0.1, 0.2, 1.8, 4), 0);
    assert.equal(pulses(1.9, 0.2, 1.8, 4), 0);
    assert.equal(ease(0, 0.2, 1), 0);
    assert.equal(ease(1.5, 0.2, 1), 1);
    assert.ok(Math.abs(ease(0.6, 0.2, 1) - 0.5) < 1e-9);
  });

  it('poses every pose gesture in avatars.js, and the world plays the table for me and for others', () => {
    const av = read('ts3d/avatars.js');
    const poses = av.slice(av.indexOf('const POSES = {'), av.indexOf('\n};', av.indexOf('const POSES = {')));
    for (const [name, spec] of Object.entries(GESTURES)) {
      if (!spec.pose || ['Pray', 'Cheer', 'Throw'].includes(name)) continue;
      assert.match(poses, new RegExp(`\\n  ${name}\\(B[,)]`), name);
    }
    const w = read('timesSquare3d.js');
    const react = w.slice(w.indexOf('function playReaction('), w.indexOf('  function jump() {'));
    assert.match(react, /if \(!drive\) me\.emote\(r\.anim\);/);
    assert.match(react, /av\.emote\(r\.anim\);/);
    assert.match(react, /net\?\.send\?\.\('react', \{ r: i \}\)/, 'still sent by index');
    assert.match(react, /now - lastReact < 700/, 'same cooldown');
    assert.doesNotMatch(react, /'Dance' \? 3/);
    assert.match(read('main.js'), /if \(p && Number\.isInteger\(p\.r\)\) world\.showReaction\(p\.id, p\.r\);/);
  });
});

// A toy rig with the Mixamo bone names, each bone's +Y toward its child like the real ones, and an Idle clip that writes
// every bone each frame (as the real clips do), so the poses run end to end on it.
function toyRig() {
  const bones = {};
  const bone = (name, parent, x, y, z, rotZ = 0) => {
    const b = new THREE.Bone();
    b.name = 'mixamorig' + name;
    b.position.set(x, y, z);
    b.rotation.z = rotZ;
    if (parent) bones[parent].add(b);
    bones[name] = b;
    return b;
  };
  bone('Hips', null, 0, 0.46, 0);
  bone('Spine', 'Hips', 0, 0.09, 0);
  bone('Spine1', 'Spine', 0, 0.11, 0);
  bone('Spine2', 'Spine1', 0, 0.13, 0);
  bone('Neck', 'Spine2', 0, 0.14, 0);
  bone('Head', 'Neck', 0, 0.1, 0);
  for (const [s, sg] of [['Left', 1], ['Right', -1]]) {
    bone(s + 'Shoulder', 'Spine2', sg * 0.07, 0.11, 0, -sg * 1.4);
    bone(s + 'Arm', s + 'Shoulder', 0, 0.12, 0, -sg * 1.4);
    bone(s + 'ForeArm', s + 'Arm', 0, 0.118, 0);
    bone(s + 'Hand', s + 'ForeArm', 0, 0.256, 0);
    bone(s + 'HandThumb1', s + 'Hand', 0.02, 0.03, 0.02);
    bone(s + 'HandThumb2', s + 'HandThumb1', 0, 0.03, 0);
    bone(s + 'HandThumb3', s + 'HandThumb2', 0, 0.03, 0);
    bone(s + 'HandMiddle1', s + 'Hand', 0, 0.1, 0);
    bone(s + 'UpLeg', 'Hips', sg * 0.14, -0.06, 0, Math.PI);
  }
  const scene = new THREE.Group();
  scene.add(bones.Hips);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.4), new THREE.MeshStandardMaterial({ name: 'Main' }));
  box.position.y = 0.9;
  scene.add(box);
  const rest = (b) => new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', [0, 1], [...b.quaternion.toArray(), ...b.quaternion.toArray()]);
  const tracks = Object.values(bones).map(rest);
  const animations = CLIPS.map((n) => new THREE.AnimationClip(n, n === 'Wave' ? 0.533 : n === 'ThumbsUp' ? 4.167 : n === 'Jump' ? 0.933 : 1, tracks));
  return { scene, animations };
}

describe('gestures on a rig', async () => {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  let pending = [];
  GLTFLoader.prototype.load = function (url, onLoad) { pending.push(onLoad); };
  let now = 1000;
  const realNow = performance.now.bind(performance);
  const tick = (a, ms) => { now += ms; a.update(ms / 1000, now / 1000); };
  const bonesOf = (a) => { const out = {}; a.model.traverse((o) => { if (o.isBone) out[o.name.replace('mixamorig', '')] = o; }); return out; };
  const at = (b) => { b.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(b.matrixWorld); };
  const make = () => {
    pending = [];
    const sys = AV.createAvatars({ scene: new THREE.Scene(), first: 1 });
    pending.forEach((f) => f(toyRig()));
    const a = sys.create({ id: 'me', local: true, species: 1 });
    a.setMotion(0);
    tick(a, 16);
    return a;
  };

  it('plays each of the 24 for its length, moves the arms, and gives the body back', () => {
    performance.now = () => now;
    try {
      for (const { anim } of REACTIONS) {
        const a = make();
        const B = bonesOf(a);
        const restL = at(B.LeftHand), restR = at(B.RightHand), restHead = B.Head.getWorldQuaternion(new THREE.Quaternion());
        a.emote(anim);
        const spec = GESTURES[anim];
        let moved = 0, finite = true;
        for (let t = 0; t < spec.ms; t += 50) {
          tick(a, 50);
          const l = at(B.LeftHand), r = at(B.RightHand);
          finite &&= [l.x, l.y, l.z, r.x, r.y, r.z].every(Number.isFinite);
          moved = Math.max(moved, l.distanceTo(restL), r.distanceTo(restR), B.Head.getWorldQuaternion(new THREE.Quaternion()).angleTo(restHead));
        }
        assert.ok(finite, anim);
        if (spec.pose) assert.ok(moved > 0.05, `${anim} moves the hands or the head (${moved.toFixed(3)})`);
        tick(a, 400);
        assert.equal(a.pose, '', anim);
        assert.equal(a.holder.position.y, 0, anim);
        assert.equal(a.model.rotation.y, 0, anim);
        assert.equal(a.model.position.z, 0, anim);
        assert.equal(a.propKind, '', anim);
        assert.ok(at(B.LeftHand).distanceTo(restL) < 1e-6 && at(B.RightHand).distanceTo(restR) < 1e-6, `${anim}: hands back at rest`);
      }
    } finally { performance.now = realNow; }
  });

  it('clap: the hands meet five times; twirl: one full turn', () => {
    performance.now = () => now;
    try {
      let a = make(), B = bonesOf(a);
      a.emote('Clap');
      let meets = 0, apart = true;
      for (let t = 0; t < GESTURES.Clap.ms; t += 10) {
        tick(a, 10);
        const d = at(B.LeftHand).distanceTo(at(B.RightHand));
        if (apart && d < 0.1) { meets++; apart = false; } else if (d > 0.14) apart = true;
      }
      assert.equal(meets, 5);
      a = make();
      a.emote('Twirl');
      let most = 0;
      for (let t = 0; t < GESTURES.Twirl.ms; t += 20) { tick(a, 20); most = Math.max(most, a.model.rotation.y); }
      assert.ok(Math.abs(most - Math.PI * 2) < 0.05, String(most));
    } finally { performance.now = realNow; }
  });

  it('moving ends a reaction (pose or clip) but not the pouch throw; clips repeat and speed up as the table says', () => {
    performance.now = () => now;
    try {
      let a = make();
      a.emote('Laugh');
      tick(a, 300);
      assert.equal(a.pose, 'Laugh');
      a.setMotion(2);
      assert.equal(a.pose, '');
      assert.equal(a.holder.position.y, 0);
      a = make();
      a.emote('Throw');
      a.setMotion(2);
      assert.equal(a.pose, 'Throw');
      a = make();
      a.emote('Wave');
      assert.equal(a.emoteAction, a.actions.Wave);
      assert.equal(a.actions.Wave.loop, THREE.LoopRepeat);
      assert.equal(a.actions.Wave.repetitions, 3);
      a.setMotion(2);
      assert.equal(a.emoteAction, null);
      assert.equal(a.current, a.actions.Walking);
      a = make();
      a.emote('ThumbsUp');
      assert.equal(a.actions.ThumbsUp.getEffectiveTimeScale(), GESTURES.ThumbsUp.rate);
      a.emote('Jump'); // the jump button: once, at normal speed, not stopped by moving
      assert.equal(a.actions.Jump.loop, THREE.LoopOnce);
      a.setMotion(2);
      assert.equal(a.emoteAction, a.actions.Jump);
      a = make();
      a.emote('Groove');
      assert.equal(a.base, 'Dance');
      assert.equal(a.danceUntil, now + GESTURES.Groove.ms);
      a = make();
      a.emote('CheerJump');
      assert.equal(a.emoteAction, a.actions.Jump);
      assert.equal(a.pose, 'CheerJump', 'arms up over the jump clip');
    } finally { performance.now = realNow; }
  });

  it('holds its prop only while the gesture plays, and the bills fly', () => {
    performance.now = () => now;
    try {
      for (const anim of ['FishBread', 'Noodles', 'Torch', 'MoneyRain']) {
        const a = make();
        a.emote(anim);
        tick(a, 1000);
        const kind = GESTURES[anim].prop;
        assert.equal(a.propKind, kind);
        const set = a.propSet[kind];
        assert.ok(set.length >= 1);
        for (const p of set) if (p.key !== 'fly') assert.equal(p.obj.visible, true, anim);
        if (anim === 'MoneyRain') assert.ok(set.find((p) => p.key === 'fly').obj.children.some((b) => b.visible));
        tick(a, GESTURES[anim].ms);
        for (const p of set) assert.equal(p.obj.visible, false, anim);
      }
    } finally { performance.now = realNow; }
  });
});

describe('the 3D lucky pouch', () => {
  it('is a small lit mesh: two shared geometries and materials, a few hundred triangles per tier', () => {
    const high = createPouchKit({ quality: 'high' }), low = createPouchKit({ quality: 'low' });
    assert.ok(high.triangles < 2000 && high.triangles > 800, String(high.triangles));
    assert.ok(low.triangles < high.triangles && low.triangles < 1400, String(low.triangles));
    for (const m of [high.bodyMat, high.goldMat]) assert.equal(m.type, 'MeshStandardMaterial');
    assert.ok(high.bodyMat.map && high.bodyMat.emissiveMap === high.bodyMat.map);
    const a = high.make(1.8), b = high.make(1.8);
    assert.equal(a.children.length, 2);
    assert.equal(a.children[0].geometry, b.children[0].geometry);
    assert.equal(a.children[0].material, b.children[0].material);
    assert.equal(a.children[1].geometry, b.children[1].geometry);
    assert.equal(a.scale.x, 1.8);
    // the size of the old sprite: POUCH_H of it tall, centred on its position
    const box = new THREE.Box3().setFromObject(a);
    assert.ok(Math.abs(box.max.y - box.min.y - POUCH_H * 1.8 * Math.max(...POUCH_PROFILE.map(([, y]) => y))) < 0.05, `${box.min.y} ${box.max.y}`);
    assert.ok(Math.abs(box.max.y + box.min.y) < 0.05);
    high.dispose();
    low.dispose();
  });

  it('faces its normals out, and has a gathered neck and a ruffled top', () => {
    const kit = createPouchKit({ quality: 'high' });
    const g = kit.bodyGeo, p = g.attributes.position, n = g.attributes.normal;
    const v = new THREE.Vector3(), nn = new THREE.Vector3();
    let out = 0, all = 0;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      if (Math.hypot(v.x, v.z) < 0.05) continue;
      nn.fromBufferAttribute(n, i);
      all++;
      if (nn.x * v.x + nn.z * v.z > 0) out++;
    }
    assert.ok(out / all > 0.9, `${out}/${all}`);
    // radius around the neck varies (pleats), and the top flares out past the neck: vertex j + i * P is profile point j
    const P = POUCH_PROFILE.length;
    const ring = (y0) => {
      const j = POUCH_PROFILE.findIndex(([, y]) => y === y0), r = [];
      for (let i = j; i < p.count; i += P) { v.fromBufferAttribute(p, i); r.push(Math.hypot(v.x, v.z)); }
      return r;
    };
    const below = ring(0.655), neck = ring(0.69), frill = ring(0.89);
    assert.ok(NECK_Y - 0.69 < 0.02);
    assert.ok(Math.max(...below) - Math.min(...below) > 0.01, 'pleats');
    assert.ok(Math.min(...frill) > Math.max(...neck), 'the frill is wider than the neck');
    assert.ok(Math.max(...frill) - Math.min(...frill) > 0.02, 'ruffled');
    kit.dispose();
  });

  it('replaces the camera-facing sprite in the world: shared kit, tumbling throws, same arc, timing and balloon size', () => {
    const w = read('timesSquare3d.js');
    assert.doesNotMatch(w, /bokjumeoni\.png|pouchMat/);
    assert.match(w, /pouchKit \|\|= createPouchKit\(\{ quality \}\);/);
    assert.match(w, /balloon\.mesh\.scale\.setScalar\(s\);/);
    assert.match(w, /const mesh = makePouch\(1\.8\);/);
    assert.match(w, /const mesh = makePouch\(22\);/);
    const up = w.slice(w.indexOf('function updateThrows(dt) {'), w.indexOf('function ensureBalloon('));
    assert.match(up, /p\.t \+= dt \/ 0\.65;/);
    assert.match(up, /p\.mesh\.position\.y \+= Math\.sin\(u \* Math\.PI\) \* 8;/);
    assert.match(up, /p\.mesh\.rotation\.x = /);
    assert.match(up, /scene\.remove\(p\.mesh\);/);
    assert.match(w, /pouchKit\?\.dispose\(\);/);
  });

  it('starts in the throwing hand, leaves it at the top of the swing and grows to its flying size on the way up', () => {
    const w = read('timesSquare3d.js');
    const toss = w.slice(w.indexOf('function throwPouch() {'), w.indexOf('function updateThrows(dt) {'));
    assert.match(toss, /const held = !drive && !!me\.holdPoint\(from\);/);
    assert.match(toss, /mesh\.scale\.setScalar\(1\.8 \* throwSize\(0\)\);/);
    assert.match(toss, /t: held \? -THROW\.release \/ 0\.65 : 0,/); // the flight is still 0.65 s, from the release
    const up = w.slice(w.indexOf('function updateThrows(dt) {'), w.indexOf('function ensureBalloon('));
    assert.match(up, /if \(inHand && !drive && me\.holdPoint\(p\.from\) && p\.t < 0\) \{ p\.mesh\.position\.copy\(p\.from\); continue; \}/);
    assert.match(up, /p\.mesh\.scale\.setScalar\(1\.8 \* throwSize\(u\)\);/);
    // the pouch is placed after the avatar is posed for this frame
    const step = w.slice(w.indexOf('  function step(dt, t, now) {'), w.indexOf('// Network projection'));
    assert.ok(step.indexOf('updateThrows(dt);') > step.indexOf('if (!drive) me.update(dt, t);'));
    assert.equal(step.match(/updateThrows\(dt\)/g).length, 1);
    // in the hand it is a fifth of its flying size (0.31 m tall), and full size a quarter of the way up
    assert.equal(throwSize(0), THROW.inHand);
    assert.ok(Math.abs(1.8 * POUCH_H * Math.max(...POUCH_PROFILE.map(([, y]) => y)) * THROW.inHand - 0.3) < 0.02);
    assert.equal(throwSize(THROW.grow), 1);
    assert.equal(throwSize(1), 1);
    assert.ok(throwSize(0.1) > THROW.inHand && throwSize(0.1) < 1);
  });
});

// The owner on a phone (2026-11-24): "던지기 할때도 던지는 손이 그래픽이 잘리는 이슈가있고 제대로 손이 안보이는 현상".
// The old throw aimed the hand at points behind and above the head bone. The shoulder sits right under a head 0.8 m wide
// and the arm is 0.37 m: measured on the models, the whole hand was inside the head from 0.35 s to the end (0 of its 276
// vertices seen from behind, in front or either side), and behind it from the front before that. A tapped button started
// the 0.98 s pose again every 250 ms, so the arm never left the wind-up, and the hop (0.75 m) dropped back each time.
describe('the pouch throw', async () => {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const MODELS = ['MouseToy', 'CatToy', 'BearToy', 'RabbitToy', 'PuppyToy', 'PandaToy', 'FoxToy', 'PenguinToy', 'HamsterToy', 'TigerToy'];
  const realNow = performance.now.bind(performance);
  let now = 5000;
  /** An avatar on the real model file (no textures in them, so the loader parses it in Node), posed in Idle. */
  async function real(file) {
    const buf = readFileSync(new URL(`../assets/models/${file}.glb`, import.meta.url));
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
    const load = GLTFLoader.prototype.load;
    GLTFLoader.prototype.load = function (url, onLoad) { onLoad(gltf); };
    try {
      const scene = new THREE.Scene();
      const a = AV.createAvatars({ scene, first: 1 }).create({ id: 'me', local: true, species: 1 });
      const skins = [];
      a.model.traverse((o) => { if (o.isSkinnedMesh) skins.push(o); });
      const tick = (ms) => { now += ms; a.update(ms / 1000, now / 1000); scene.updateMatrixWorld(true); };
      a.setMotion(0);
      tick(16);
      return { a, skins, tick };
    } finally { GLTFLoader.prototype.load = load; }
  }
  /** Every vertex in the world with the bone that moves it most, and the triangles. */
  function shot(skins) {
    const P = [], T = [], v = new THREE.Vector3();
    for (const m of skins) {
      const g = m.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, base = P.length;
      for (let i = 0; i < g.attributes.position.count; i++) {
        let best = 0, bw = -1;
        for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
        m.getVertexPosition(i, v);
        P.push({ p: v.clone().applyMatrix4(m.matrixWorld), bone: m.skeleton.bones[best].name.replace(/^mixamorig:?/, '') });
      }
      for (let i = 0; i < g.index.count; i += 3) T.push([base + g.index.getX(i), base + g.index.getX(i + 1), base + g.index.getX(i + 2)]);
    }
    return { P, T };
  }
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), hh = new THREE.Vector3(), ss = new THREE.Vector3(), qq = new THREE.Vector3(), dir = new THREE.Vector3();
  /** Is the point seen from the camera, with nothing of the body but the throwing arm itself in between? */
  function seen(s, cam, point) {
    dir.subVectors(point, cam);
    const len = dir.length();
    dir.divideScalar(len);
    for (const t of s.T) {
      if (/^Right(Hand|ForeArm|Arm)/.test(s.P[t[0]].bone)) continue;
      const A = s.P[t[0]].p;
      e1.subVectors(s.P[t[1]].p, A); e2.subVectors(s.P[t[2]].p, A); hh.crossVectors(dir, e2);
      const det = e1.dot(hh);
      if (Math.abs(det) < 1e-12) continue;
      ss.subVectors(cam, A);
      const u = ss.dot(hh) / det;
      if (u < 0 || u > 1) continue;
      qq.crossVectors(ss, e1);
      const w = dir.dot(qq) / det;
      if (w < 0 || u + w > 1) continue;
      const d = e2.dot(qq) / det;
      if (d > 1e-6 && d < len - 0.004) return false;
    }
    return true;
  }
  /** The share of the throwing hand's vertices (every `skip`-th) that the camera sees. */
  function handSeen(s, cam, skip = 1) {
    let n = 0, vis = 0;
    for (let i = 0; i < s.P.length; i += skip) { if (!/^RightHand/.test(s.P[i].bone)) continue; n++; if (seen(s, cam, s.P[i].p)) vis++; }
    return vis / n;
  }
  // the follow camera's place behind the avatar (8.2 m back, 3.15 m up), and the same from the front and from its right
  const CAMS = { behind: new THREE.Vector3(0, 3.15, -8.2), front: new THREE.Vector3(0, 3.15, 8.2), right: new THREE.Vector3(-8.2, 3.15, 0) };

  it('is short enough to play whole between two throws, with a hop that is back down when the next one starts', () => {
    const gap = Number(read('timesSquare3d.js').match(/const THROW_GAP_MS = (\d+);/)[1]) / 1000;
    assert.equal(gap, 0.25);
    assert.ok(THROW.swing <= gap && THROW.release < THROW.swing && THROW.wind < THROW.release);
    assert.equal(throwSwing(0), 0);
    assert.equal(throwSwing(THROW.wind), 0);
    assert.equal(throwSwing(THROW.swing), 1);
    assert.equal(throwSwing(0.6), 1);
    assert.ok(throwSwing(THROW.release) > 0.6 && throwSwing(THROW.release) < 0.9, 'the pouch leaves while the hand is still rising');
    assert.equal(THROW.hopS, gap);
    assert.equal(throwHop(0), 0);
    assert.equal(throwHop(gap), 0);
    assert.equal(throwHop(0.4), 0);
    assert.ok(Math.abs(throwHop(gap / 2) - THROW.hop) < 1e-9);
    assert.ok(THROW.hop <= 0.3, 'a small hop: the old one was 0.75 m and snapped back at every tap');
    const av = read('ts3d/avatars.js');
    // and the name tag rides it, so the head never comes up over the avatar's own name
    assert.match(av, /this\.tag\.position\.y = this\.sys\.height \+ 0\.42 \+ this\.holder\.position\.y;/);
    assert.match(av, /POSE_FX\.hop = pose === 'Throw' \? throwHop\(s\) : 0;/);
    assert.equal(/foldArm\(model, 'Right', elbow, hand\)|headP\)\.addScaledVector\(fwd, 0\.62\)/.test(av), false, 'the overhand throw is gone');
    assert.match(av, /\n  Throw\(B, s\) \{\r?\n\s+const u = throwSwing\(s\);/);
  });

  it('keeps the whole throwing hand in sight from behind, from the front and from its side, on all ten bodies', async () => {
    performance.now = () => now;
    try {
      for (const file of MODELS) {
        const { a, skins, tick } = await real(file);
        const hand = new THREE.Vector3();
        a.emote('Throw');
        let t = 0, low = null, high = null;
        for (const at of [100, 150, 200, 300, 450]) {
          tick(at - t); t = at;
          const s = shot(skins);
          assert.ok(a.holdPoint(hand), file);
          if (at === 100) low = hand.clone().setY(hand.y - a.holder.position.y); // without the hop
          if (at === 300) high = hand.clone().setY(hand.y - a.holder.position.y);
          for (const [name, cam] of Object.entries(CAMS)) {
            // where the pouch rides, and the hand itself (every 9th vertex here; all of them on three bodies below)
            assert.ok(seen(s, cam, hand), `${file} ${at} ms: the pouch's place in the hand is hidden from ${name}`);
            const share = handSeen(s, cam, 9);
            assert.ok(share >= 0.9, `${file} ${at} ms from ${name}: ${(share * 100).toFixed(0)}% of the hand`);
          }
        }
        // wound up beside the hip, then up and forward: the hand rises 0.4 m and more (the rabbit, the smallest, 0.37) and ends out beside the head
        assert.ok(high.y - low.y > 0.35 && high.z > low.z, `${file}: ${low.y.toFixed(2)} -> ${high.y.toFixed(2)}`);
        assert.ok(Math.abs(high.x) > 0.4, `${file}: ${high.x.toFixed(2)} m out from the middle of the body`); // the rabbit is the smallest: 0.44
        tick(400);
        assert.equal(a.pose, '', file);
        assert.equal(a.holder.position.y, 0, file);
        a.dispose();
      }
    } finally { performance.now = realNow; }
  });

  it('every vertex of the hand, on the bodies with the biggest ears, the widest cheeks and the shortest arm', async () => {
    performance.now = () => now;
    try {
      for (const file of ['MouseToy', 'HamsterToy', 'RabbitToy']) {
        const { a, skins, tick } = await real(file);
        a.emote('Throw');
        tick(150);
        const release = shot(skins);
        tick(150);
        const top = shot(skins);
        for (const [name, cam] of Object.entries(CAMS)) {
          assert.ok(handSeen(release, cam) >= 0.97, `${file} at the release from ${name}`);
          assert.ok(handSeen(top, cam) >= 0.97, `${file} at the top from ${name}`);
        }
        a.dispose();
      }
    } finally { performance.now = realNow; }
  });

  it('a tapped button throws again and again: each throw swings from the hip to the top, and the hop never drops', async () => {
    performance.now = () => now;
    try {
      const { a, tick } = await real('MouseToy');
      const hand = new THREE.Vector3();
      let drops = 0;
      for (let n = 0; n < 4; n++) {
        a.emote('Throw'); // 250 ms apart, the fastest the world lets them come
        let lo = Infinity, hi = -Infinity, last = 0;
        for (let t = 0; t < 250; t += 10) {
          tick(10);
          a.holdPoint(hand);
          const y = hand.y - a.holder.position.y;
          lo = Math.min(lo, y); hi = Math.max(hi, y);
          if (a.holder.position.y < last - 0.05) drops++;
          last = a.holder.position.y;
        }
        assert.ok(hi - lo > 0.4, `throw ${n + 1}: the hand travels ${(hi - lo).toFixed(2)} m`);
        assert.ok(a.holder.position.y < 0.02, `throw ${n + 1}: on the ground when the next one starts`);
      }
      assert.equal(drops, 0);
      a.dispose();
    } finally { performance.now = realNow; }
  });

  it('draws or culls the body as one: a single bounding sphere that holds every pose', async () => {
    performance.now = () => now;
    try {
      for (const file of ['MouseToy', 'RabbitToy', 'TigerToy']) {
        const { a, skins, tick } = await real(file);
        assert.ok(skins.length >= 4, file);
        const first = skins[0].boundingSphere.clone().applyMatrix4(skins[0].matrixWorld);
        for (const m of skins) {
          const s = m.boundingSphere.clone().applyMatrix4(m.matrixWorld);
          assert.ok(s.center.distanceTo(first.center) < 1e-4 && Math.abs(s.radius - first.radius) < 1e-4, `${file} ${m.material.name}: its own sphere`);
        }
        assert.ok(first.radius > 1.2 && first.radius < 2.2, `${file}: ${first.radius.toFixed(2)} m`);
        const v = new THREE.Vector3();
        let worst = -Infinity;
        for (const name of ['Throw', 'Hooray', 'Jump', 'Dance', 'Torch']) {
          a.emote(name);
          for (let t = 0; t < 1000; t += 100) {
            tick(100);
            for (const m of skins) {
              const s = m.boundingSphere.clone().applyMatrix4(m.matrixWorld);
              for (let i = 0; i < m.geometry.attributes.position.count; i += 11) { m.getVertexPosition(i, v); worst = Math.max(worst, v.applyMatrix4(m.matrixWorld).distanceTo(s.center) - s.radius); }
            }
          }
        }
        assert.ok(worst < -0.2, `${file}: a vertex ${worst.toFixed(2)} m from the sphere's edge`);
        a.dispose();
      }
      assert.match(read('ts3d/avatars.js'), /this\.modelSpecies = p\.show;\r?\n\s+wholeBodySphere\(model\);/);
    } finally { performance.now = realNow; }
  });

  it('the stand-in body has no hand: the pouch leaves from the old place at once', () => {
    const load = GLTFLoader.prototype.load;
    GLTFLoader.prototype.load = function () { /* the model never arrives */ };
    try {
      const a = AV.createAvatars({ scene: new THREE.Scene(), first: 1 }).create({ id: 'me', local: true, species: 1 });
      assert.equal(a.fallback, true);
      assert.equal(a.holdPoint(new THREE.Vector3()), null);
      a.emote('Throw'); // still hops
      a.dispose();
    } finally { GLTFLoader.prototype.load = load; }
  });
});
