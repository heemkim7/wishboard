// The modelled cab (assets/models/taxi.glb, built by tools/blender/build_props.py) in place of the box cars.
//
// What is checked: the file is the cab the game was written for (nodes, materials, wheel origins, size); the fleets
// built from it are the instanced meshes and colours they should be on each tier, with no more draw calls on a phone
// than the boxes cost; the boxes are what is drawn before the file is there and when it never comes; the file is not
// on the way to the first screen. ts3d/traffic.js is built in Node with the real three, as test/street-traffic.test.mjs
// does it.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { registerHooks } from 'node:module';
import { describe, it, before } from 'node:test';

const VENDOR = new URL('../vendor/three/', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'three') return { url: VENDOR + 'build/three.module.js', shortCircuit: true };
    if (specifier.startsWith('three/addons/')) return { url: VENDOR + 'examples/jsm/' + specifier.slice(13), shortCircuit: true };
    return next(specifier, context);
  },
});
// A canvas that remembers the text painted on it.
function canvasStub() {
  const drawn = [];
  const ctx = {
    fillStyle: '', font: '', textAlign: 'left', textBaseline: 'alphabetic', globalCompositeOperation: 'source-over',
    fillRect() {}, clearRect() {},
    measureText(s) { return { width: String(s).length * parseFloat(this.font.split(' ')[1]) * 0.62 }; },
    fillText(s, x, y) { drawn.push({ s, x, y, font: this.font, align: this.textAlign }); },
    createLinearGradient() { return { addColorStop() {} }; },
  };
  return { width: 0, height: 0, style: {}, drawn, getContext: () => ctx };
}
globalThis.document ||= { createElement: () => canvasStub() };

const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { createNYC } = await import('../ts3d/nyc.js');
const { kitMaterials } = await import('../ts3d/kit.js');
const { createTraffic, taxiModelKit, loadTaxiModel, RULES, CHECKER_FADE, carPaintTier } = await import('../ts3d/traffic.js');
const { TAXI_URL, MODEL_URL } = await import('../ts3d/loadplan.js');
const { TAXI_STANDS } = await import('../ts3d/layout.js');
const { loadBudget } = await import('../tools/load-budget.mjs');
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const FILE = new URL('..' + TAXI_URL, import.meta.url);
const MAP = new URL('../assets/nyc/manhattan.bin', import.meta.url);
const needsMap = { skip: existsSync(MAP) ? false : 'assets/nyc/manhattan.bin missing' };
let nyc = null;
const city = () => (nyc ||= createNYC(new Uint8Array(gunzipSync(readFileSync(MAP)))));

// ---- the file --------------------------------------------------------------------------------------------------
function glb() {
  const b = readFileSync(FILE);
  assert.equal(b.toString('ascii', 0, 4), 'glTF');
  const jl = b.readUInt32LE(12);
  return { size: b.length, json: JSON.parse(b.toString('utf8', 20, 20 + jl)) };
}
/** The file parsed by the loader the game uses: a new scene each time (useModel does not keep it). */
function parsed() {
  const b = readFileSync(FILE);
  return new Promise((res, rej) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', (g) => res(g.scene), rej));
}
const NODES = ['Body', 'Glass', 'Checker', 'Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR', 'RoofSign', 'HeadLights', 'TailLights'];
const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

describe('assets/models/taxi.glb', () => {
  it('is one small file: under 120 KB, 3,328 triangles, no textures, no texture coordinates, nothing to decode', () => {
    const { size, json } = glb();
    assert.equal(TAXI_URL, '/assets/models/taxi.glb');
    assert.ok(size < 120_000, size + ' bytes');
    assert.equal(statSync(FILE).size, size);
    assert.equal((json.images || []).length + (json.textures || []).length, 0);
    assert.equal((json.skins || []).length + (json.animations || []).length, 0);
    assert.deepEqual((json.extensionsUsed || []).filter((e) => e !== 'KHR_materials_emissive_strength'), []);
    assert.deepEqual(json.extensionsRequired || [], []);
    let n = 0;
    for (const m of json.meshes) for (const p of m.primitives) {
      assert.deepEqual(Object.keys(p.attributes).sort(), ['NORMAL', 'POSITION'], m.name);
      assert.equal(p.mode ?? 4, 4);
      n += json.accessors[p.indices].count / 3;
    }
    assert.equal(n, 3328);
    assert.equal(json.buffers.length, 1);
  });
  it('has the ten nodes and the eight flat materials the game sorts it by', () => {
    const { json } = glb();
    assert.deepEqual(json.scenes[json.scene || 0].nodes.map((i) => json.nodes[i].name), NODES);
    assert.deepEqual(json.materials.map((m) => m.name).sort(), ['Chrome', 'Glass', 'LightFront', 'LightRear', 'Paint', 'RoofSign', 'Trim', 'White']);
    const uses = Object.fromEntries(json.nodes.map((nd) => [nd.name, json.meshes[nd.mesh].primitives.map((p) => json.materials[p.material].name).sort()]));
    assert.deepEqual(uses, {
      Body: ['Chrome', 'Paint', 'Trim', 'White'], Glass: ['Glass'], Checker: ['Trim', 'White'],
      Wheel_FL: ['Chrome', 'Trim'], Wheel_FR: ['Chrome', 'Trim'], Wheel_RL: ['Chrome', 'Trim'], Wheel_RR: ['Chrome', 'Trim'],
      RoofSign: ['RoofSign'], HeadLights: ['LightFront'], TailLights: ['LightRear'],
    });
    for (const m of json.materials) { assert.equal(m.pbrMetallicRoughness.baseColorTexture, undefined, m.name); assert.equal(m.doubleSided || false, false, m.name); }
    // Paint is near-white and neutral: an instance colour is what makes a cab yellow and a car grey or red
    const [r, g, b] = json.materials.find((m) => m.name === 'Paint').pbrMetallicRoughness.baseColorFactor;
    assert.ok(r > 0.85 && r === g && g === b, `Paint ${r} ${g} ${b}`);
    // the lamps and the roof light are lit by themselves
    for (const name of ['LightFront', 'LightRear', 'RoofSign']) {
      const m = json.materials.find((x) => x.name === name);
      assert.ok(Math.max(...m.emissiveFactor) > 0.9 && m.extensions.KHR_materials_emissive_strength.emissiveStrength > 1, name);
    }
  });
  it('the wheels\' origins are on the axles at (+-0.86, 0.40, +-1.45), radius 0.40, left wheels at +x; nothing else is moved, turned or scaled', () => {
    const { json } = glb();
    const at = Object.fromEntries(json.nodes.map((nd) => [nd.name, nd]));
    const want = { Wheel_FL: [0.86, 0.4, 1.45], Wheel_FR: [-0.86, 0.4, 1.45], Wheel_RL: [0.86, 0.4, -1.45], Wheel_RR: [-0.86, 0.4, -1.45] };
    for (const [name, p] of Object.entries(want)) {
      at[name].translation.forEach((v, k) => assert.ok(near(v, p[k], 1e-6), `${name} ${at[name].translation}`));
      // about its own origin the wheel is a turned shape on the x axis: 0.40 up, down, forward and back
      const acc = json.meshes[at[name].mesh].primitives.map((q) => json.accessors[q.attributes.POSITION]);
      const lo = [0, 1, 2].map((k) => Math.min(...acc.map((a) => a.min[k]))), hi = [0, 1, 2].map((k) => Math.max(...acc.map((a) => a.max[k])));
      for (const k of [1, 2]) assert.ok(near(lo[k], -0.4) && near(hi[k], 0.4), `${name} axis ${k}: ${lo[k]}..${hi[k]}`);
      assert.ok(hi[0] - lo[0] < 0.3 && (p[0] > 0 ? hi[0] > -lo[0] : -lo[0] > hi[0]), name + ': the dish faces away from the car');
    }
    for (const nd of json.nodes) {
      assert.equal(nd.rotation, undefined, nd.name); assert.equal(nd.scale, undefined, nd.name);
      if (!want[nd.name]) assert.equal(nd.translation, undefined, nd.name);
    }
  });
  it('stands on the ground, nose toward +z, inside the box the street rules give a car (4.98 x 2.06 m); only the mirrors reach past it', async () => {
    const root = await parsed();
    root.updateMatrixWorld(true);
    const all = new THREE.Box3(), part = {}, v = new THREE.Vector3();
    let mirror = 0;
    root.traverse((o) => {
      if (!o.isMesh) return;
      let node = o; while (node.parent !== root) node = node.parent;
      const b = (part[node.name] ||= new THREE.Box3()), pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        all.expandByPoint(v); b.expandByPoint(v);
        if (Math.abs(v.x) > RULES.wid / 2 + 1e-4) { mirror++; assert.ok(node.name === 'Body' && v.y > 1.05 && v.y < 1.26 && v.z > 0.85 && v.z < 1.1, `past the box at (${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`); }
      }
    });
    assert.ok(mirror > 0);
    const r = (n) => +n.toFixed(3);
    assert.deepEqual([all.min.x, all.max.x, all.min.y, all.max.y, all.min.z, all.max.z].map(r), [-1.11, 1.11, 0, 1.88, -2.46, 2.49]);
    assert.equal(RULES.len, 4.98); assert.equal(RULES.wid, 2.06);
    assert.ok(all.max.z <= RULES.len / 2 + 1e-6 && -all.min.z <= RULES.len / 2 + 1e-6); // the box is the longer end both ways
    assert.ok(part.HeadLights.min.z > 2.3 && part.TailLights.max.z < -2.3);
    // the roof at 1.59 m, the light's box 0.9 x 0.26 x 0.22 on it; the stripe along the doors between the arches
    assert.deepEqual([part.Glass.max.y, part.RoofSign.min.y, part.RoofSign.max.y, part.RoofSign.max.x - part.RoofSign.min.x, part.RoofSign.max.z - part.RoofSign.min.z].map(r), [1.47, 1.62, 1.88, 0.9, 0.22]);
    assert.deepEqual([part.Checker.min.y, part.Checker.max.y, part.Checker.min.z, part.Checker.max.z].map(r), [0.67, 0.93, -0.97, 0.97]);
    assert.ok(part.Checker.max.z < 1.45 - 0.4 && part.Checker.min.y > 0.4, 'the stripe is between the wheels');
  });
});

// ---- the fleets ------------------------------------------------------------------------------------------------
const FLEET = { low: [14, 12], medium: [24, 22], high: [34, 34] }; // AI cabs, AI cars; then 8 called and 8 remote cab slots
const onFoot = (x, z) => ({ x, y: 0, z, yaw: 0, driving: false });
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** A street (the same one every run) with a scene that knows what is in it. `opts` go to createTraffic (loadModel). */
function street(quality, opts = {}, seed = 7) {
  Math.random = seeded(seed);
  const live = new Set(), gone = [];
  const scene = { add(...o) { for (const x of o) live.add(x); }, remove(...o) { for (const x of o) { live.delete(x); gone.push(x); } } };
  const kitMats = kitMaterials();
  const traffic = createTraffic({ scene, nyc: city(), kitMats, quality, renderer: { capabilities: { getMaxAnisotropy: () => 16 } }, ...opts });
  const [nTaxi, nCar] = FLEET[quality], nCab = nTaxi + 16, total = nCab + nCar;
  const inst = () => [...live].filter((o) => o.isInstancedMesh);
  const beams = inst().find((m) => m.material.blending === THREE.AdditiveBlending);
  assert.equal(beams.count, total);
  // the fleets as they are drawn now: the cabs' meshes, the cars' meshes, the stand-in's wheels (or none)
  const now = () => {
    const rest = inst().filter((m) => m !== beams);
    const wheels = rest.filter((m) => m.instanceMatrix.count === total * 4);
    const cabs = rest.filter((m) => m.instanceMatrix.count === nCab), cars = rest.filter((m) => m.instanceMatrix.count === nCar);
    assert.equal(wheels.length + cabs.length + cars.length, rest.length);
    return { cabs, cars, wheels, calls: rest.length + 1 };
  };
  const run = (frames, me = onFoot(16, 28), t0 = 0) => { for (let k = 0; k < frames; k++) traffic.update(1 / 30, t0 + k / 30, me); };
  return { traffic, kitMats, live, gone, beams, now, run, nTaxi, nCar, nCab, total };
}
const mat16 = (m, k) => Array.from(m.instanceMatrix.array.subarray(k * 16, k * 16 + 16));
const col3 = (m, k) => Array.from(m.instanceColor.array.subarray(k * 3, k * 3 + 3));
const rgb = (c) => new THREE.Color(c).toArray().map(Math.fround); // as an instance colour is stored
const YELLOW = rgb(0xffc21a);
// One past the last cab slot with a cab on the street, read from the headlight pools (cab slot k is vehicle k, or k + nCar after the AI cabs).
const lastCab = (S) => { let top = 0; for (let k = 0; k < S.nCab; k++) { const a = mat16(S.beams, k < S.nTaxi ? k : k + S.nCar); if (Math.hypot(a[8], a[10]) > 0) top = k + 1; } return top; };

describe('the fleets, once the model is in', needsMap, () => {
  before(city);
  it('the boxes cost 12 draw calls on every tier; the model 10 on a phone and 12 on medium and high', async () => {
    for (const q of ['low', 'medium', 'high']) {
      const S = street(q);
      const kit = S.now();
      assert.deepEqual([kit.cabs.length, kit.cars.length, kit.wheels.length, kit.calls], [6, 4, 1, 12], q + ' boxes');
      assert.equal(S.traffic.shape(), 'kit');
      assert.equal(S.traffic.useModel(await parsed()), true);
      assert.equal(S.traffic.shape(), 'model');
      const m = S.now();
      const want = q === 'low' ? [5, 4, 0, 10] : [6, 5, 0, 12];
      assert.deepEqual([m.cabs.length, m.cars.length, m.wheels.length, m.calls], want, q + ' model');
      assert.ok(m.calls <= kit.calls, q);
      if (q === 'low') assert.ok(m.cabs.length <= kit.cabs.length && m.cars.length <= kit.cars.length, 'neither fleet costs a phone more than its boxes did');
      // every box mesh has left the scene, and a second file changes nothing
      for (const old of [...kit.cabs, ...kit.cars, ...kit.wheels]) { assert.equal(S.live.has(old), false); assert.ok(S.gone.includes(old)); }
      assert.equal(S.traffic.useModel(await parsed()), true);
      assert.ok(S.now().cabs.every((x, k) => x === m.cabs[k]) && S.now().cars.every((x, k) => x === m.cars[k]));
    }
  });
  it('one instanced mesh per material group, cheapest on a phone: paint, solid, shiny (chrome and glass), glow, sign', async () => {
    for (const q of ['low', 'medium', 'high']) {
      const S = street(q);
      const kitPaint = [S.now().cabs[0].material, S.now().cars[0].material], kitSign = S.now().cabs.find((m) => m.material.map && !m.material.transparent).material;
      S.traffic.useModel(await parsed());
      const { cabs, cars } = S.now();
      const kit = taxiModelKit(await parsed(), q);
      assert.deepEqual(kit.taxi.map(([k]) => k), q === 'low' ? ['paint', 'solid', 'shiny', 'glow', 'sign'] : ['paint', 'solid', 'chrome', 'glass', 'glow', 'sign']);
      assert.deepEqual(kit.car.map(([k]) => k), q === 'low' ? ['paint', 'solid', 'shiny', 'glow'] : ['paint', 'solid', 'chrome', 'glass', 'glow']);
      assert.deepEqual(cabs.map((m) => tris(m.geometry)), kit.taxi.map(([, g]) => tris(g)));
      assert.deepEqual(cars.map((m) => tris(m.geometry)), kit.car.map(([, g]) => tris(g)));
      // paint: the very materials the boxes were painted with (the tier's coat), white under an instance colour
      assert.equal(cabs[0].material, kitPaint[0]); assert.equal(cars[0].material, kitPaint[1]);
      const coat = carPaintTier(q);
      for (const m of [cabs[0], cars[0]]) { assert.equal(!!m.material.isMeshPhysicalMaterial, coat.clearcoat); assert.equal(m.material.vertexColors, false); assert.equal(m.material.color.getHex(), 0xffffff); assert.ok(m.instanceColor); }
      // the rest takes the file's colours from the vertices; only paint has a colour per instance
      const group = (list, names) => Object.fromEntries(names.map((k, i) => [k, list[i]]));
      const C = group(cabs, kit.taxi.map(([k]) => k)), K = group(cars, kit.car.map(([k]) => k));
      for (const f of [C, K]) {
        for (const [k, m] of Object.entries(f)) if (k !== 'paint') assert.equal(m.instanceColor, null, k);
        assert.ok(f.solid.material.isMeshStandardMaterial && !f.solid.material.isMeshPhysicalMaterial && f.solid.material.vertexColors);
        assert.deepEqual([f.solid.material.roughness, f.solid.material.metalness], [S.kitMats.base.roughness, S.kitMats.base.metalness]);
        assert.equal(f.glow.material, S.kitMats.glow); // unlit, and dimmed with the rest of the neon by the glow setting
        if (q === 'low') assert.equal(f.shiny.material, S.kitMats.gloss);
        else { assert.equal(f.chrome.material, S.kitMats.metal); assert.equal(f.glass.material, S.kitMats.gloss); }
      }
      assert.equal(C.solid.material, K.solid.material);
      assert.equal(C.sign.material, kitSign); // the roof light keeps the texture the game paints
      assert.deepEqual([C.sign.material.map.image.width, C.sign.material.map.image.height], [256, 64]);
      // the lamps: the file's colour and strength (3.0 head, 2.2 tail) x 1.35, which is what the boxes' lamps gave under the bloom
      const lamp = C.glow.geometry.attributes.color, reds = new Set();
      for (let i = 0; i < lamp.count; i++) reds.add(+lamp.getX(i).toFixed(2));
      assert.deepEqual([...reds].sort(), [2.97, 4.05]);
      // geometry that is the same for a cab and a car is one object
      for (const k of Object.keys(K)) assert.equal(K[k].geometry === C[k].geometry, k !== 'solid', k);
      // nothing in the model is see-through or blended: the door decal's plane is gone with the boxes
      for (const m of [...cabs, ...cars]) { assert.equal(m.material.transparent, false); assert.equal(m.frustumCulled, false); }
    }
  });
  it('a cab is 3,328 triangles and a car 2,876 (no stripe, no roof light); a full street is 81,104 / 143,144 / 210,936', async () => {
    const full = {};
    for (const q of ['low', 'medium', 'high']) {
      const kit = taxiModelKit(await parsed(), q);
      assert.deepEqual(kit.tris, { taxi: 3328, car: 3328 - 408 - 44 });
      full[q] = FLEET[q][0] * kit.tris.taxi + FLEET[q][1] * kit.tris.car;
    }
    assert.deepEqual(full, { low: 81104, medium: 143144, high: 210936 });
    // the boxes: 456 a cab, 428 a car, 112 a wheel
    const S = street('low'), kit = S.now();
    assert.deepEqual([kit.cabs, kit.cars, kit.wheels].map((l) => l.reduce((a, m) => a + tris(m.geometry), 0)), [456, 428, 112]);
    assert.deepEqual(Object.values(FLEET).map(([a, b]) => a * (456 + 448) + b * (428 + 448)), [23168, 40968, 60520]);
  });
  it('colour by instance as before: every cab yellow, every car its own colour, a shop colour on the player\'s cab', async () => {
    const S = street('low');
    S.traffic.warm(16, 28);
    S.run(30);
    const kit = S.now(), was = { cab: Array.from(kit.cabs[0].instanceColor.array), car: Array.from(kit.cars[0].instanceColor.array) };
    const i = S.traffic.callTaxi(TAXI_STANDS[0]);
    assert.ok(S.traffic.takeTaxi(i));
    S.traffic.setCabTint(i, '#3fe6ff'); // a cab_* item's tint (balance.js SHOP): timesSquare3d.js enterTaxi does this
    S.traffic.useModel(await parsed());
    const { cabs, cars } = S.now(), k = i - S.nCar; // slots: cabs, cars, then the called and remote cabs after the AI cabs
    for (let c = 0; c < S.nCab; c++) assert.deepEqual(col3(cabs[0], c), c === k ? rgb('#3fe6ff') : YELLOW, 'cab slot ' + c);
    assert.deepEqual(Array.from(cars[0].instanceColor.array), was.car);
    assert.ok(new Set(Array.from({ length: S.nCar }, (_, c) => col3(cars[0], c).join())).size >= 8, 'cars of many colours');
    for (let c = 0; c < S.nCar; c++) assert.notDeepEqual(col3(cars[0], c), YELLOW);
    // the tint lives on the model's paint from here on: another colour, then back to yellow when the player gets out
    S.traffic.driveTaxi(i, 20, 40, 0, 0);
    S.run(2, { x: 20, y: 0, z: 40, yaw: 0, driving: true }, 1);
    assert.deepEqual(col3(cabs[0], k), rgb('#3fe6ff'));
    S.traffic.setCabTint(i, '#ff3d9a');
    assert.deepEqual(col3(cabs[0], k), rgb('#ff3d9a'));
    S.traffic.setCabTint(i, 'red'); // not a colour: the fleet yellow
    assert.deepEqual(col3(cabs[0], k), YELLOW);
    S.traffic.setCabTint(i, '#ff3d9a');
    S.traffic.setCabYellow(i, false);
    S.traffic.releaseTaxi(i, 20, 40, 0);
    assert.deepEqual(col3(cabs[0], k), YELLOW);
    // a remote player's cab in their shop colour
    S.traffic.setRemoteTaxis([{ x: 30, z: 40, yaw: 0, v: 0, tint: '#39f58a' }]);
    S.run(1, onFoot(16, 28), 2);
    assert.deepEqual(col3(cabs[0], S.nTaxi + 8), rgb('#39f58a'));
    assert.equal(was.cab.length, S.nCab * 3);
  });
  it('the swap moves nothing: each new mesh starts with the pose the boxes had, and every part of a vehicle shares one matrix afterwards', async () => {
    const S = street('low');
    S.traffic.warm(16, 28);
    S.traffic.callTaxi(TAXI_STANDS[0]);
    S.run(40);
    const kit = S.now(), before = { cab: Array.from(kit.cabs[0].instanceMatrix.array), car: Array.from(kit.cars[0].instanceMatrix.array) };
    S.traffic.useModel(await parsed());
    let m = S.now();
    for (const p of m.cabs) assert.deepEqual(Array.from(p.instanceMatrix.array), before.cab);
    for (const p of m.cars) assert.deepEqual(Array.from(p.instanceMatrix.array), before.car);
    S.run(40, onFoot(16, 28), 40 / 30);
    m = S.now();
    for (const p of m.cabs) assert.deepEqual(Array.from(p.instanceMatrix.array), Array.from(m.cabs[0].instanceMatrix.array));
    for (const p of m.cars) assert.deepEqual(Array.from(p.instanceMatrix.array), Array.from(m.cars[0].instanceMatrix.array));
    // and it is the pose of the headlight pool under it (what test/street-traffic.test.mjs reads the street from)
    let on = 0;
    for (let k = 0; k < S.nTaxi; k++) { assert.deepEqual(mat16(m.cabs[0], k), mat16(S.beams, k)); if (Math.hypot(mat16(S.beams, k)[8], mat16(S.beams, k)[10]) > 0.5) on++; }
    for (let k = 0; k < S.nCar; k++) assert.deepEqual(mat16(m.cars[0], k), mat16(S.beams, S.nTaxi + k));
    assert.ok(on >= S.nTaxi - 2, on + ' cabs on the street');
  });
  it('the model\'s cab meshes stop at the last cab on the street: the 16 slots for called and remote cabs cost nothing while empty', async () => {
    const S = street('low');
    S.traffic.warm(16, 28);
    S.run(30);
    assert.deepEqual(S.now().cabs.map((m) => m.count), Array(6).fill(S.nCab)); // the boxes draw every slot, as they did
    S.traffic.useModel(await parsed());
    S.run(30, onFoot(16, 28), 1);
    assert.equal(lastCab(S), S.nTaxi, 'every AI cab is on the street, and no other');
    assert.deepEqual(S.now().cabs.map((m) => m.count), Array(5).fill(S.nTaxi));
    assert.deepEqual(S.now().cars.map((m) => m.count), Array(4).fill(S.nCar));
    const i = S.traffic.callTaxi(TAXI_STANDS[0]); // the first of the eight called-cab slots
    assert.equal(i, S.nTaxi + S.nCar);
    S.run(1, onFoot(16, 28), 2);
    assert.equal(lastCab(S), S.nTaxi + 1);
    assert.deepEqual(S.now().cabs.map((m) => m.count), Array(5).fill(S.nTaxi + 1));
    assert.notDeepEqual(mat16(S.now().cabs[0], S.nTaxi).slice(0, 3), [0, 0, 0]);
    S.traffic.setRemoteTaxis([{ x: 30, z: 40, yaw: 0, v: 0 }]); // the first remote slot is after the eight called ones
    S.run(1, onFoot(16, 28), 2.1);
    assert.deepEqual(S.now().cabs.map((m) => m.count), Array(5).fill(S.nTaxi + 9));
    S.traffic.setRemoteTaxis([]);
    S.run(1, onFoot(16, 28), 2.2);
    assert.deepEqual(S.now().cabs.map((m) => m.count), Array(5).fill(S.nTaxi + 1));
    assert.equal(S.beams.count, S.total); // (the pools are two triangles a car: all drawn, and read by the street tests)
  });
  it('a minute of the street drawn as the model on a phone: no two vehicles overlap as 4.98 x 2.06 m boxes', async () => {
    const S = street('low'), me = onFoot(0, 370), HL = RULES.len / 2, HW = RULES.wid / 2;
    S.traffic.warm(me.x, me.z);
    S.traffic.useModel(await parsed());
    const corners = (c) => { const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), rx = -fz, rz = fx; return [[c.x + fx * HL + rx * HW, c.z + fz * HL + rz * HW], [c.x + fx * HL - rx * HW, c.z + fz * HL - rz * HW], [c.x - fx * HL - rx * HW, c.z - fz * HL - rz * HW], [c.x - fx * HL + rx * HW, c.z - fz * HL + rz * HW]]; };
    const overlap = (a, b) => {
      if (Math.abs(a.x - b.x) > 8 || Math.abs(a.z - b.z) > 8) return false;
      const A = corners(a), B = corners(b);
      for (const P of [A, B]) for (let i = 0; i < 2; i++) {
        const nx = P[i + 1][1] - P[i][1], nz = -(P[i + 1][0] - P[i][0]);
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (const q of A) { const d = q[0] * nx + q[1] * nz; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
        for (const q of B) { const d = q[0] * nx + q[1] * nz; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
        if (a1 <= b0 || b1 <= a0) return false;
      }
      return true;
    };
    let seen = 0;
    for (let k = 0; k < 60 * 30; k++) {
      S.traffic.update(1 / 30, k / 30, me);
      const { cabs, cars } = S.now(), cs = [];
      const take = (mesh, n) => { for (let j = 0; j < n; j++) { const a = mat16(mesh, j); if (Math.hypot(a[8], a[10]) > 0.02) cs.push({ x: a[12], z: a[14], yaw: Math.atan2(a[8], a[10]) }); } };
      take(cabs[0], cabs[0].count); take(cars[0], cars[0].count);
      seen += cs.length;
      for (let a = 0; a < cs.length; a++) for (let b = a + 1; b < cs.length; b++) assert.equal(overlap(cs[a], cs[b]), false, `t=${(k / 30).toFixed(1)} (${cs[a].x.toFixed(1)}, ${cs[a].z.toFixed(1)}) and (${cs[b].x.toFixed(1)}, ${cs[b].z.toFixed(1)})`);
    }
    assert.ok(seen / (60 * 30) > 24, 'the 26 cars are drawn: ' + (seen / 1800).toFixed(1) + ' on average');
  });
});

// ---- the roof light and the stripe -----------------------------------------------------------------------------
describe('the model\'s roof light and stripe', () => {
  it('the roof light is the file\'s box with the game\'s TAXI on its front and back faces, unsqueezed; the rest is one plain texel', async () => {
    const { paintTaxiSign } = await import('../ts3d/art.js');
    const kit = taxiModelKit(await parsed(), 'low');
    const g = kit.taxi.find(([k]) => k === 'sign')[1], pos = g.attributes.position, uv = g.attributes.uv;
    assert.equal(g.index, null); assert.equal(pos.count, 44 * 3); assert.equal(g.attributes.normal, undefined);
    g.computeBoundingBox();
    const b = g.boundingBox, r = (n) => +n.toFixed(3);
    assert.deepEqual([b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z].map(r), [-0.45, 0.45, 1.62, 1.88, -0.41, -0.19]); // where the file has it
    const blank = new Set();
    const faces = { front: [], back: [] };
    for (let t = 0; t < pos.count; t += 3) {
      const zs = [0, 1, 2].map((k) => pos.getZ(t + k)), flat = zs.every((z) => near(z, b.max.z, 1e-4)) || zs.every((z) => near(z, b.min.z, 1e-4));
      for (let i = t; i < t + 3; i++) {
        if (flat) faces[zs[0] > -0.3 ? 'front' : 'back'].push({ x: pos.getX(i), y: pos.getY(i), u: uv.getX(i), v: uv.getY(i) });
        else blank.add(uv.getX(i) + ',' + uv.getY(i));
      }
    }
    assert.equal(blank.size, 1);
    assert.equal(faces.front.length, 6); assert.equal(faces.back.length, 6); // two triangles each
    const face = g.userData.face;
    assert.deepEqual([r(face.w), r(face.h)], [0.78, 0.14]); // the box's flat faces inside its 6 cm chamfer
    for (const [name, list] of Object.entries(faces)) {
      for (const p of list) {
        const u = (p.x + 0.39) / 0.78;
        assert.ok(near(p.u, name === 'front' ? u : 1 - u, 1e-4), `${name}: read left to right from outside the car`);
        assert.ok(near(p.v, 0.5 + ((p.y - 1.75) / 0.14) * face.band, 1e-4));
      }
      assert.deepEqual([Math.min(...list.map((p) => p.u)), Math.max(...list.map((p) => p.u))].map(r), [0, 1]); // the texture's whole width
    }
    // the band of the 256 x 64 texture the face shows has the face's own shape, so the letters keep theirs
    assert.ok(near(face.band, (0.14 / 0.78) * 4, 1e-4));
    assert.ok(near((face.band * 64) / 256, 0.14 / 0.78, 1e-4));
    // and the one word painted there is inside that band with room to spare: 50 px letters in the 46 px about the middle
    const c = canvasStub(); c.width = 256; c.height = 64;
    paintTaxiSign(c);
    assert.deepEqual(c.drawn.map((q) => [q.s, q.align, q.x]), [['TAXI', 'center', 128]]);
    const px = parseFloat(c.drawn[0].font.split(' ')[1]), capH = px * 0.74, bandPx = face.band * 64;
    assert.equal(px, 50);
    assert.ok(Math.abs(c.drawn[0].y - 32) <= 2 && capH < bandPx - 6, `capitals ${capH.toFixed(0)} px in a band of ${bandPx.toFixed(0)} px`);
    // on the box the capitals are 11 cm tall (14 cm on the stand-in's 0.25 m light)
    assert.equal(+(capH / bandPx * face.h).toFixed(2), 0.11);
    const [bu, bv] = [...blank][0].split(',').map(Number);
    assert.ok(bu * 256 < 128 - c.drawn[0].s.length * px * 0.62 / 2 - 16 && (1 - bv) * 64 < 8, 'the plain texel is a corner of the background');
  });
  it('the stripe is the file\'s geometry; far away its squares and band run into one even tone (the shader averages what no mipmap can)', async () => {
    const kit = taxiModelKit(await parsed(), 'high');
    const solid = (list) => list.find(([k]) => k === 'solid')[1];
    const cab = solid(kit.taxi), car = solid(kit.car);
    assert.equal(tris(cab) - tris(car), 408); // the Checker node: 24 triangles of band, 384 of squares
    const white = new THREE.Color().setRGB(0.838798999786377, 0.8307698965072632, 0.7912979125976562), trim = new THREE.Color().setRGB(0.006995410192757845, 0.00802319310605526, 0.011612244881689548);
    const mean = [0, 1, 2].map((k) => (white.toArray()[k] + trim.toArray()[k]) / 2);
    const count = (g) => {
      const pos = g.attributes.position, col = g.attributes.color, far = g.attributes.fadeTo;
      assert.equal(far.count, pos.count); assert.equal(far.itemSize, 3);
      let stripe = 0;
      for (let i = 0; i < pos.count; i++) {
        const same = [0, 1, 2].every((k) => far.getComponent(i, k) === col.getComponent(i, k));
        if (same) continue;
        stripe++;
        // only the stripe's own vertices change: on the doors, between the arches, 0.67 to 0.93 m up
        assert.ok(Math.abs(pos.getX(i)) > 0.955 && pos.getY(i) > 0.669 && pos.getY(i) < 0.931 && Math.abs(pos.getZ(i)) < 0.971);
        for (let k = 0; k < 3; k++) assert.ok(near(far.getComponent(i, k), mean[k], 1e-6));
      }
      return stripe;
    };
    assert.equal(count(cab), 16 + 256); // every vertex of the band and of the squares
    assert.equal(count(car), 0);
    for (const [k, g] of kit.taxi) if (k !== 'solid') assert.equal(g.attributes.fadeTo, undefined, k);
    // the tone: half band, half squares (16 squares of 12 cm in two rows of sixteen places)
    assert.ok(mean[0] > 0.4 && mean[0] < 0.45);
    // when: a 12 cm square under 4 pixels starts to go, at 1.6 pixels it is gone
    assert.deepEqual(CHECKER_FADE, { near: 0.03, far: 0.075 });
    assert.deepEqual([0.12 / CHECKER_FADE.near, 0.12 / CHECKER_FADE.far].map((n) => +n.toFixed(1)), [4, 1.6]);
    // on a 375 px phone (812 px tall, 72 degree lens) that is from 25 m (dpr 1.5) or 17 m (dpr 1) on; all one tone by 63 m / 42 m
    const mPerPx = (dist, dpr) => (Math.tan(36 * Math.PI / 180) * dist) / (812 * dpr / 2);
    assert.ok(mPerPx(25, 1.5) < CHECKER_FADE.near && mPerPx(26, 1.5) > CHECKER_FADE.near && mPerPx(63, 1.5) > CHECKER_FADE.far && mPerPx(42, 1) > CHECKER_FADE.far && mPerPx(16, 1) < CHECKER_FADE.near);
  });
  it('the shader: the vendored colour chunk with the far tone mixed in by how much of the car\'s side a pixel covers', needsMap, async () => {
    const S = street('medium');
    S.traffic.useModel(await parsed());
    const m = S.now().cabs[1].material;
    assert.notEqual(m, S.kitMats.base); // a copy: nothing else in the city pays for it
    const sh = { vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
    for (const src of [sh.vertexShader, sh.fragmentShader]) assert.equal(src.split('#include <common>').length, 2);
    assert.ok(sh.vertexShader.includes('#include <color_vertex>') && sh.fragmentShader.includes('#include <color_fragment>'));
    m.onBeforeCompile(sh);
    const v = sh.vertexShader.replace(/\r\n/g, '\n'), f = sh.fragmentShader.replace(/\r\n/g, '\n');
    assert.match(v, /#include <common>\nattribute vec3 fadeTo;\nvarying vec3 vFadeTo;\nvarying vec2 vSide;/);
    assert.match(v, /#include <color_vertex>\n\tvFadeTo = fadeTo;\n\tvSide = position\.zy;/);
    assert.match(f, /#include <common>\nvarying vec3 vFadeTo;\nvarying vec2 vSide;/);
    assert.equal(f.includes('#include <color_fragment>'), false);
    assert.match(f, /float sidePerPixel = max\( fwidth\( vSide\.x \), fwidth\( vSide\.y \) \);\n\tdiffuseColor\.rgb \*= mix\( vColor, vFadeTo, smoothstep\( 0\.030, 0\.075, sidePerPixel \) \);/);
    // what it replaces is `diffuseColor.rgb *= vColor;` for a geometry with three-component colours
    assert.match(THREE.ShaderChunk.color_fragment, /#elif defined\( USE_COLOR \)\s+diffuseColor\.rgb \*= vColor;/);
    assert.match(THREE.ShaderChunk.color_pars_fragment, /#elif defined\( USE_COLOR \)\s+varying vec3 vColor;/);
  });
});

// ---- loading ---------------------------------------------------------------------------------------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Runs `f` with console.error collected instead of printed. */
async function quiet(f) {
  const said = [], real = console.error;
  console.error = (...a) => said.push(a);
  try { await f(said); } finally { console.error = real; }
  return said;
}

describe('loading the model', needsMap, () => {
  before(city);
  it('boxes from the first frame; the file is asked for once, after the street has been drawn, and swapped in when it comes', async () => {
    let calls = 0, give = null;
    const S = street('low', { loadModel: () => { calls++; return new Promise((res) => { give = res; }); } });
    S.traffic.warm(16, 28);
    assert.equal(S.traffic.shape(), 'kit'); assert.equal(S.now().calls, 12);
    S.run(2);
    await wait(350);
    assert.equal(calls, 0, 'not before two frames of the street have been drawn');
    S.run(1, onFoot(16, 28), 0.1);
    assert.equal(calls, 0, 'and not inside a frame: when the page has a moment');
    await wait(350);
    assert.equal(calls, 1);
    S.run(60, onFoot(16, 28), 0.2);
    await wait(350);
    assert.equal(calls, 1, 'one request');
    assert.equal(S.traffic.shape(), 'kit'); assert.equal(S.now().wheels.length, 1); // still the boxes while it is on its way
    give(await parsed());
    await wait(20);
    assert.equal(S.traffic.shape(), 'model');
    assert.deepEqual([S.now().cabs.length, S.now().cars.length, S.now().wheels.length], [5, 4, 0]);
    S.run(30, onFoot(16, 28), 3);
    assert.equal(calls, 1);
  });
  it('without a loader nothing is asked for (the street tests run on the boxes)', async () => {
    const S = street('low');
    S.traffic.warm(16, 28);
    S.run(10);
    await wait(300);
    assert.equal(S.traffic.shape(), 'kit'); assert.equal(S.now().calls, 12);
  });
  it('a file that does not come, a loader that throws, a file that is not the cab: the boxes stay and nothing throws', async () => {
    const notCab = new THREE.Group();
    notCab.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    const noPaint = await parsed();
    noPaint.traverse((o) => { if (o.isMesh && o.material.name === 'Paint') o.material = Object.assign(o.material.clone(), { name: 'Coat' }); });
    const cases = {
      'a 404': () => Promise.reject(new Error('404')),
      'a loader that throws': () => { throw new Error('no loader'); },
      'an empty scene': () => Promise.resolve(new THREE.Group()),
      'another model': () => Promise.resolve(notCab),
      'the cab without its Paint': () => Promise.resolve(noPaint),
      'nothing at all': () => Promise.resolve(null),
    };
    for (const [name, loadModel] of Object.entries(cases)) {
      const S = street('low', { loadModel });
      S.traffic.warm(16, 28);
      const said = await quiet(async () => {
        S.run(3);
        await wait(300);
        S.run(30, onFoot(16, 28), 0.1);
        await wait(20);
      });
      assert.equal(said.length, 1, name + ': said once what went wrong');
      assert.equal(said[0][0], '[taxi model]');
      assert.equal(S.traffic.shape(), 'kit', name);
      const kit = S.now();
      assert.deepEqual([kit.cabs.length, kit.cars.length, kit.wheels.length, kit.calls], [6, 4, 1, 12], name);
      assert.equal(S.gone.length, 0, name + ': nothing was taken out of the scene');
      // the street goes on, and the boxes are still the vehicles' poses
      S.run(30, onFoot(16, 28), 2);
      for (let k = 0; k < S.nTaxi; k++) assert.deepEqual(mat16(kit.cabs[0], k), mat16(S.beams, k));
      // a good file handed over later is still taken (nothing is left half swapped)
      assert.equal(S.traffic.useModel(await parsed()), true, name);
      assert.equal(S.now().calls, 10);
    }
  });
  it('useModel says no to a file that is not the cab, by name', async () => {
    const S = street('low');
    for (const drop of ['Checker', 'RoofSign', 'Wheel_RL']) {
      const root = await parsed();
      root.remove(root.children.find((o) => o.name === drop));
      const said = await quiet(() => { assert.equal(S.traffic.useModel(root), false); });
      assert.match(String(said[0][1].message), new RegExp('no node ' + drop));
      assert.throws(() => taxiModelKit(root, 'low'), /taxi model: no node/);
    }
    assert.equal(S.traffic.shape(), 'kit');
  });
  it('loadTaxiModel is one request for loadplan.js TAXI_URL through the GLTF loader, and the world hands it to the traffic', async () => {
    const asked = [], real = GLTFLoader.prototype.load;
    GLTFLoader.prototype.load = function (url, onLoad, onProgress, onError) { // the file from the disk instead of the network
      asked.push(url);
      try { const b = readFileSync(new URL('..' + url, import.meta.url)); this.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', onLoad, onError); } catch (e) { onError(e); }
    };
    try {
      const root = await loadTaxiModel();
      assert.deepEqual(asked, ['/assets/models/taxi.glb']);
      assert.deepEqual(root.children.map((o) => o.name), NODES);
      await assert.rejects(loadTaxiModel('/assets/models/no-such-cab.glb'));
    } finally { GLTFLoader.prototype.load = real; }
    const w = read('timesSquare3d.js'), t = read('ts3d/traffic.js');
    assert.match(w, /import \{ createTraffic, loadTaxiModel \} from '\.\/ts3d\/traffic\.js\?v=[0-9a-z]+';/);
    assert.match(w, /traffic = createTraffic\(\{ scene, nyc, kitMats, quality, renderer, onHonk: \(\) => opts\.onHonk\?\.\(\), loadModel: loadTaxiModel \}\);/);
    assert.match(t, /import \{ TAXI_URL \} from '\.\/loadplan\.js\?v=[0-9a-z]+';/);
    // its own loader: the world's loading manager (which the first screen waits for) never hears of the file
    assert.match(t, /return new GLTFLoader\(\)\.loadAsync\(url\)\.then\(\(gltf\) => gltf\.scene\);/);
    assert.equal(/taxi\.glb|TAXI_URL|loadTaxiModel\(/.test(w), false, 'the world neither names the file nor fetches it itself');
    // asked for from update(), on the third frame, when the page is idle
    assert.match(t, /if \(!asked && \+\+drawn > 2\) \{ asked = true; whenIdle\(askModel\); \}/);
  });
});

describe('the first load', () => {
  it('nothing for the taxi is in the list a phone downloads before it can enter; it is 77 KB of the first minute', () => {
    for (const quality of ['low', 'medium', 'high']) for (const species of [1, 7]) {
      if (!existsSync(new URL('..' + MODEL_URL[species], import.meta.url))) continue;
      const r = loadBudget({ quality, species });
      assert.deepEqual(r.unclassified, []);
      assert.deepEqual(r.missing, []);
      const rows = r.rows.filter((x) => /taxi/i.test(x.file) && x.file.startsWith('assets/'));
      assert.deepEqual(rows.map((x) => [x.file, x.phase]), [['assets/models/taxi.glb', 'first']]);
      assert.ok(rows[0].wire < 120_000 && rows[0].wire === rows[0].raw);
      assert.equal(r.rows.filter((x) => x.phase === 'boot').some((x) => /taxi\.glb/.test(x.file)), false);
    }
  });
  it('the service worker needs no new revision: it caches /assets/* by URL and this is a new one', () => {
    const sw = read('sw.js');
    assert.match(sw, /url\.pathname\.startsWith\('\/assets\/'\)/);
    assert.match(read('index.html'), /register\('\/sw\.js\?v=10'\)/);
    assert.equal(/taxi/.test(sw), false);
    // served: .assetsignore keeps tools/ and out/ (where the build script writes it) back, not assets/models or *.glb
    const kept = read('.assetsignore').split('\n').map((l) => l.trim()).filter(Boolean);
    assert.ok(kept.includes('out') && kept.includes('tools'));
    assert.deepEqual(kept.filter((l) => /glb|^assets\/?$|^assets\/models\/?$|taxi/.test(l)), []);
  });
});

// ---- sizes -----------------------------------------------------------------------------------------------------
describe('what someone on foot runs into', needsMap, () => {
  before(city);
  it('a parked cab is its 4.98 x 2.06 m box with round ends: no walking into the doors, the bumpers are where the model has them', () => {
    const S = street('low'); // (no warm: the only vehicle is the cab)
    const i = S.traffic.callTaxi(TAXI_STANDS[0]);
    assert.ok(S.traffic.takeTaxi(i));
    S.traffic.driveTaxi(i, 20, 40, 0, 0);
    S.traffic.releaseTaxi(i, 20, 40, 0); // nose toward +z
    const R = 0.36, HL = RULES.len / 2, HW = RULES.wid / 2; // RADIUS of someone on foot (timesSquare3d.js)
    const push = (x, z) => { const [px, pz] = S.traffic.collide(20 + x, 40 + z, R); return [+(px - 20).toFixed(3) + 0, +(pz - 40).toFixed(3) + 0]; };
    // beside the doors, anywhere along the body: out to the body's side (the two discs this replaced let x = 0.4 in at the middle)
    for (const z of [0, 0.7, -0.7, 1.4, -1.4]) { assert.deepEqual(push(0.5, z), [+(HW + R).toFixed(3), z]); assert.deepEqual(push(-0.5, z), [-(HW + R).toFixed(3), z]); }
    // in front of the nose and behind the tail: out to the bumpers (the discs ended 2.3 m from the middle)
    assert.deepEqual(push(0.0001, 2.6), [0, +(HL + R).toFixed(3)]);
    assert.deepEqual(push(-0.0001, -2.6), [0, -(HL + R).toFixed(3)]);
    // standing clear of it nothing moves: beside it, ahead of it, and off its rounded corner
    assert.deepEqual(push(HW + R + 0.01, 0), [+(HW + R + 0.01).toFixed(3), 0]);
    assert.deepEqual(push(0, HL + R + 0.01), [0, +(HL + R + 0.01).toFixed(3)]);
    assert.deepEqual(push(1.2, 2.5), [1.2, 2.5]);
    // exactly on its centre line: out to a side, not left inside
    const [cx, cz] = push(0, 0.5);
    assert.ok(near(Math.abs(cx), HW + R) && cz === 0.5);
    // the same for the cab the player drives into one (a 0.82 m disc, timesSquare3d.js stepDrive)
    const [dx] = S.traffic.collide(20 + 1.2, 40, 0.82);
    assert.ok(near(dx - 20, HW + 0.82));
    assert.match(read('ts3d/traffic.js'), /const BODY_A = CAR_HL - CAR_HW;/);
  });
});
