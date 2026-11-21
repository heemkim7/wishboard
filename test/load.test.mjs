import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { describe, it } from 'node:test';
import { loadBudget, BUDGET } from '../tools/load-budget.mjs';
import { MODEL_URL, ENV_PHOTOS, envPhotoUrl, modelFor, seesAvatar, SEE_R, prefetchDelay, PREFETCH_MS } from '../ts3d/loadplan.js';

// avatars.js imports 'three' through the page's import map; map it to the vendored copy for this process.
const VENDOR = new URL('../vendor/three/', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === 'three') return { url: ${JSON.stringify(VENDOR + 'build/three.module.js')}, shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: ${JSON.stringify(VENDOR + 'examples/jsm/')} + s.slice(13), shortCircuit: true };
  return n(s, c);
}`));

const CLIPS = ['Idle', 'Walking', 'Running', 'Dance', 'Sitting', 'Wave', 'Jump', 'ThumbsUp', 'Yes', 'No'];
// Material names as shipped before re-encoding. Only the bear has `Main`; Mousey's body is Ch14_Body and the cat has
// no Main at all, so its fur, belly and paws keep their colours.
const MATERIALS = {
  1: ['Ch14_Body'],
  2: ['Black', 'CatEar', 'CatEye', 'CatFur', 'CatMuzzle', 'CatNose', 'CatWhite'],
  3: ['BearEar', 'BearMuzzle', 'BearNose', 'Black', 'EyeWhite', 'Main'],
};
const JOINTS = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  ...['Left', 'Right'].flatMap((s) => [`${s}Shoulder`, `${s}Arm`, `${s}ForeArm`, `${s}Hand`, `${s}UpLeg`, `${s}Leg`, `${s}Foot`, `${s}ToeBase`,
    ...['Thumb', 'Index', 'Middle', 'Ring'].flatMap((f) => [1, 2, 3].map((i) => `${s}Hand${f}${i}`))])]
  .map((n) => 'mixamorig' + n).sort();

function glb(id) {
  const b = readFileSync(new URL('..' + MODEL_URL[id], import.meta.url));
  assert.equal(b.toString('ascii', 0, 4), 'glTF');
  const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.toString('utf8', 20, 20 + jl));
  const bin = b.subarray(20 + jl + 8);
  return { size: b.length, json, bin };
}
function webpSize(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (kind === 'VP8L') { const v = buf.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
  return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
}

describe('first load budget', () => {
  for (const species of [1, 2, 3]) {
    it(`a phone (low tier, species ${species}) enters after at most ${BUDGET.boot / 1e6} MB and has the first minute within ${BUDGET.first / 1e6} MB`, () => {
      const r = loadBudget({ quality: 'low', species });
      assert.deepEqual(r.unclassified, []);
      assert.ok(r.totals.boot.wire <= BUDGET.boot, `boot ${r.totals.boot.wire}`);
      assert.ok(r.totals.first.wire <= BUDGET.first, `first minute ${r.totals.first.wire}`);
      const boot = r.rows.filter((x) => x.phase === 'boot').map((x) => x.file);
      for (const [id, url] of Object.entries(MODEL_URL)) assert.equal(boot.includes(url.slice(1)), Number(id) === species, url);
    });
  }

  it('fetches only the four photos the environment map uses, in one small size for every tier', () => {
    for (const quality of ['low', 'high']) {
      const photos = loadBudget({ quality }).rows.filter((x) => x.file.startsWith('assets/times-square/') && x.file.endsWith('.jpg'));
      assert.deepEqual(photos.map((x) => x.file).sort(), ENV_PHOTOS.map((n) => envPhotoUrl(n).slice(1)).sort());
      assert.ok(photos.every((x) => x.phase === 'boot' && x.raw < 80_000));
    }
    // buildPhotoEnv waits for exactly these four.
    const env = [...readFileSync(new URL('../timesSquare3d.js', import.meta.url), 'utf8').match(/\[('night-[^\]]+)\]\.every/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(env.sort(), [...ENV_PHOTOS].sort());
  });

  it('gives the low tier the 512 px ground maps and the others the 1024 px ones', () => {
    const files = (q) => loadBudget({ quality: q }).rows.filter((x) => x.file.startsWith('assets/textures/')).map((x) => x.file);
    assert.equal(files('low').filter((f) => f.includes('/512/')).length, 6);
    assert.equal(files('high').some((f) => f.includes('/512/')), false);
    assert.equal(files('low').length, 9);
  });

  it('bumps the service worker cache with the new assets', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /register\('\/sw\.js\?v=8'\)/);
  });
});

describe('re-encoded avatar models', () => {
  for (const id of [1, 2, 3]) {
    it(`${MODEL_URL[id]} keeps clips, materials and joints and needs no decoder`, () => {
      const { size, json, bin } = glb(id);
      const clips = json.animations.map((a) => a.name);
      for (const c of CLIPS) assert.ok(clips.includes(c), c);
      assert.deepEqual(json.materials.map((m) => m.name).sort(), MATERIALS[id]);
      assert.equal(json.skins.length, 1);
      assert.deepEqual(json.skins[0].joints.map((j) => json.nodes[j].name).sort(), JOINTS);
      const used = json.extensionsUsed || [];
      assert.deepEqual(used.filter((e) => !['EXT_texture_webp', 'KHR_mesh_quantization', 'KHR_materials_specular'].includes(e)), []);
      for (const img of json.images || []) {
        assert.equal(img.mimeType, 'image/webp');
        const v = json.bufferViews[img.bufferView];
        const [w, h] = webpSize(bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength));
        assert.ok(w <= 1024 && h <= 1024, `${w}x${h}`);
      }
      for (const n of json.nodes) assert.equal(n.extras, undefined);
      // Every channel still points at a joint or node that exists.
      for (const a of json.animations) for (const c of a.channels) assert.ok(json.nodes[c.target.node]);
      assert.ok(size < 1_000_000, `${size} bytes`);
    });
  }
  it('never renames the cat or bear coat to Main and keeps Mousey untinted', () => {
    assert.equal(MATERIALS[2].includes('Main'), false);
    const av = readFileSync(new URL('../ts3d/avatars.js', import.meta.url), 'utf8');
    assert.match(av, /m\.name === 'Main' && o\.name !== 'Ch14_Body'\) m\.name = 'Coat'/);
  });
});

describe('what to fetch when', () => {
  const S = (...a) => new Set(a);
  it('shows a loaded species, waits for one still coming, and falls back when one failed', () => {
    assert.deepEqual(modelFor(2, { loaded: S(2), missing: S() }), { show: 2, need: 0 });
    assert.deepEqual(modelFor(2, { loaded: S(1), missing: S() }), { show: 0, need: 2 });
    assert.deepEqual(modelFor(2, { loaded: S(1), missing: S(2) }), { show: 1, need: 0 });
    assert.deepEqual(modelFor(3, { loaded: S(2), missing: S(3) }), { show: 2, need: 0 });
    assert.deepEqual(modelFor(3, { loaded: S(), missing: S(3) }), { show: 0, need: 1 });
    assert.deepEqual(modelFor(3, { loaded: S(), missing: S(3, 1) }), { show: 0, need: 0 });
    assert.deepEqual(modelFor(2, { loaded: new Map([[3, {}]]), missing: S(2) }), { show: 3, need: 0 });
  });
  it('asks for a remote model only on screen and near', () => {
    assert.equal(seesAvatar(10, true), true);
    assert.equal(seesAvatar(SEE_R, true), true);
    assert.equal(seesAvatar(SEE_R + 1, true), false);
    assert.equal(seesAvatar(10, false), false);
    assert.equal(seesAvatar(NaN, true), false);
  });
  it('prefetches the other species a minute after entering, never on low or Save-Data', () => {
    assert.equal(prefetchDelay({ quality: 'high' }), PREFETCH_MS);
    assert.equal(prefetchDelay({ quality: 'medium', saveData: false }), PREFETCH_MS);
    assert.equal(prefetchDelay({ quality: 'low' }), null);
    assert.equal(prefetchDelay({ quality: 'high', saveData: true }), null);
    assert.ok(PREFETCH_MS >= 60000);
  });
});

describe('avatar system downloads lazily', async () => {
  // Minimal DOM for name tags; GLTFLoader.load is replaced so nothing touches the network.
  const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 40 }) : /Gradient$/.test(k) ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d }) };
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { createAvatars } = await import('../ts3d/avatars.js');
  let calls = [];
  GLTFLoader.prototype.load = function (url, onLoad, _p, onError) { calls.push({ url, onLoad, onError }); };
  const fakeGltf = (mat) => {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial({ name: mat })));
    return { scene, animations: CLIPS.map((n) => new THREE.AnimationClip(n, 1, [])) };
  };
  const finish = (url, ok = true) => { const c = calls.find((x) => x.url === url); calls = calls.filter((x) => x !== c); ok ? c.onLoad(fakeGltf('Main')) : c.onError(new Error('404')); };
  const quiet = console.error; console.error = () => {};

  it('fetches the own species first and nothing else until another species is on screen', () => {
    calls = [];
    const av = createAvatars({ scene: new THREE.Scene(), first: 2 });
    assert.deepEqual(calls.map((c) => c.url), [MODEL_URL[2]]);
    const me = av.create({ id: 'me', local: true, species: 2 });
    assert.equal(me.fallback, true);
    finish(MODEL_URL[2]);
    assert.equal(me.fallback, false);
    assert.equal(me.modelSpecies, 2);
    const bear = av.create({ id: 'p1', species: 3 });
    assert.equal(bear.fallback, true, 'stand-in body while the bear is not wanted');
    assert.deepEqual(calls, []);
    bear.want();
    assert.deepEqual(calls.map((c) => c.url), [MODEL_URL[3]]);
    bear.want();
    assert.equal(calls.length, 1, 'one request per species');
    finish(MODEL_URL[3]);
    assert.equal(bear.fallback, false);
    assert.equal(bear.modelSpecies, 3);
    av.prefetch();
    assert.deepEqual(calls.map((c) => c.url), [MODEL_URL[1]]);
  });

  it('starts only the species picked in the character sheet', () => {
    calls = [];
    const av = createAvatars({ scene: new THREE.Scene(), first: 1 });
    finish(MODEL_URL[1]);
    av.want(3);
    av.want(3);
    assert.deepEqual(calls.map((c) => c.url), [MODEL_URL[3]]);
    const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
    assert.match(ui, /speciesPicker\(species, \(id\) => \{ species = id; hooks\.wantSpecies\?\.\(id\); \}\)/);
    assert.doesNotMatch(ui, /prefetchModels/);
  });

  it('shows Mousey for an avatar whose species failed to load', () => {
    calls = [];
    const av = createAvatars({ scene: new THREE.Scene(), first: 1 });
    av.create({ id: 'me', local: true, species: 1 });
    finish(MODEL_URL[1]);
    const peer = av.create({ id: 'p', species: 2 });
    assert.equal(peer.fallback, true);
    peer.want();
    finish(MODEL_URL[2], false);
    assert.equal(peer.fallback, false);
    assert.equal(peer.modelSpecies, 1);
  });

  it('keeps the current model while a new species loads, swaps when it arrives, and keeps it if the load fails', () => {
    calls = [];
    const av = createAvatars({ scene: new THREE.Scene(), first: 1 });
    const me = av.create({ id: 'me', local: true, species: 1 });
    finish(MODEL_URL[1]);
    const mouse = me.model;
    me.setSpecies(2);
    assert.deepEqual(calls.map((c) => c.url), [MODEL_URL[2]]);
    assert.equal(me.model, mouse, 'no stand-in while the cat downloads');
    assert.equal(me.fallback, false);
    assert.equal(me.modelSpecies, 1);
    finish(MODEL_URL[2]);
    assert.notEqual(me.model, mouse);
    assert.equal(me.modelSpecies, 2);
    const cat = me.model;
    me.setSpecies(3);
    assert.equal(me.model, cat);
    finish(MODEL_URL[3], false);
    assert.equal(me.model, cat, 'a failed bear leaves the cat');
    assert.equal(me.modelSpecies, 2);
    assert.equal(me.fallback, false);
    // A remote on another species keeps its model and fetches the new one only when wanted.
    const peer = av.create({ id: 'p', species: 2 });
    assert.equal(peer.modelSpecies, 2);
    peer.setSpecies(1);
    assert.equal(peer.modelSpecies, 1);
    console.error = quiet;
  });
});
