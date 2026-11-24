// 점등식 in the real world (timesSquare3d.js run in Node on the real map, the harness of test/world-run.test.mjs): where an arrival
// stands (goToSlot spread), the group photo's pose (cerPose) checked from where it stands with three.js rays against everything the
// scene draws (buildings, lots, the arch, number posts, taxi-stand signs, lamps, the other boards), the turn to the camera, and the
// photo itself (capture with my tag and the band). Without the map file the suite is skipped; any other failure to load fails.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { after, describe, it } from 'node:test';

const MAP = new URL('../assets/nyc/manhattan.bin', import.meta.url);
const REAL = new URL('../vendor/three/build/three.module.js', import.meta.url).href;
const ADDONS = new URL('../vendor/three/examples/jsm/', import.meta.url).href;
const STUB_THREE = 'data:text/javascript,' + encodeURIComponent(`
export * from ${JSON.stringify(REAL)};
import { Texture } from ${JSON.stringify(REAL)};
const noop = () => {};
export class WebGLRenderer {
  constructor(o = {}) {
    this.domElement = o.canvas; this.capabilities = { getMaxAnisotropy: () => 1, isWebGL2: true, maxTextureSize: 4096 }; this.info = { render: {}, memory: {} }; this.shadowMap = {}; this.xr = { enabled: false };
    return new Proxy(this, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
  }
  getPixelRatio() { return 1; } getSize(v) { return v.set(800, 600); } getDrawingBufferSize(v) { return v.set(800, 600); } getClearColor(c) { return c; } getClearAlpha() { return 1; } getRenderTarget() { return null; }
  getContext() { return new Proxy({}, { get: () => noop }); }
}
export class PMREMGenerator { fromScene() { return { texture: new Texture(), dispose: noop }; } dispose() {} }
export class TextureLoader { constructor(m) { this.manager = m; } load() { const t = new Texture(); t.image = { width: 0, height: 0 }; return t; } setPath() { return this; } setCrossOrigin() { return this; } setRequestHeader() { return this; } }
`);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'three') return { url: STUB_THREE, shortCircuit: true };
    if (specifier.startsWith('three/addons/')) return { url: ADDONS + specifier.slice(13), shortCircuit: true };
    if (specifier.startsWith('@supabase/')) return { url: 'data:text/javascript,export const createClient = () => ({});', shortCircuit: true };
    return next(specifier, context);
  },
});

const real = { now: performance.now.bind(performance), setTimeout: globalThis.setTimeout, random: Math.random };
let clock = 10000, raf = null, seed = 20261124, calm = false;
const timers = [];
const drawn = []; // what a 2D context was asked to write (the photo's band)
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? (s) => ({ width: String(s).length * 9 }) : k === 'fillText' ? (s) => drawn.push(String(s)) : /Gradient$/.test(k) ? () => ({ addColorStop() {} }) : k === 'getImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
const el = (tag, w = 800, h = 600) => ({ tagName: String(tag).toUpperCase(), style: {}, dataset: {}, width: 0, height: 0, clientWidth: w, clientHeight: h, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, getContext: () => ctx2d, toDataURL: () => 'data:image/jpeg;base64,/9j/', addEventListener() {}, removeEventListener() {}, setAttribute() {}, append() {}, appendChild() {}, remove() {}, closest: () => null, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }), getRootNode: () => globalThis.document, setPointerCapture() {}, releasePointerCapture() {} });
const bus = new EventTarget();
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
function page() {
  performance.now = () => clock;
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  globalThis.setTimeout = (f, ms, ...a) => { const id = real.setTimeout(f, ms, ...a); timers.push(id); return id; };
  globalThis.document = { createElement: (t) => el(t), createElementNS: (ns, t) => el(t), body: el('body'), documentElement: el('html'), hidden: false, addEventListener() {}, removeEventListener() {} };
  globalThis.window = globalThis;
  globalThis.addEventListener = bus.addEventListener.bind(bus);
  globalThis.removeEventListener = bus.removeEventListener.bind(bus);
  globalThis.localStorage = store();
  globalThis.sessionStorage = store();
  globalThis.location = { search: '', href: 'http://localhost/', origin: 'http://localhost', hostname: 'localhost', pathname: '/' };
  globalThis.matchMedia = (q) => ({ matches: calm && /prefers-reduced-motion/.test(q), addEventListener() {}, addListener() {} });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.innerWidth = 800; globalThis.innerHeight = 600; globalThis.devicePixelRatio = 1;
  globalThis.requestAnimationFrame = (f) => { raf = f; return 1; };
  globalThis.cancelAnimationFrame = () => { raf = null; };
  globalThis.fetch = async (url) => { if (String(url).includes('manhattan.bin')) return new Response(readFileSync(MAP)); throw new Error('no network in this test: ' + url); };
}
const frame = () => { clock += 16; const f = raf; raf = null; f(clock); };
const run = (seconds) => { for (let i = 0, n = Math.round(seconds / 0.016); i < n; i++) frame(); };

let T = null, broken = null, skip = existsSync(MAP) ? false : 'assets/nyc/manhattan.bin missing';
async function boot(w, h) {
  const errors = [];
  const canvas = Object.assign(el('canvas', w, h), { parentElement: el('div', w, h) });
  const world = T.createTimesSquare(canvas, { quality: 'low', autostart: false, name: '시험', species: 1, onError: (e) => errors.push(e) });
  for (const until = real.now() + 180000; real.now() < until && !(world.built() && world.mapData());) await new Promise((r) => real.setTimeout(r, 10)); // a busy machine (the whole suite at once) can take a while
  if (errors.length || !world.mapData()) throw new Error('the city did not build: ' + (errors[0]?.message || 'timeout'));
  world.start();
  run(0.1);
  return world;
}
if (!skip) {
  try {
    page();
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    GLTFLoader.prototype.load = function (url, onLoad, onProgress, onError) {
      try { const b = readFileSync(new URL('..' + String(url).split('?')[0], import.meta.url)); this.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', onLoad, onError); } catch (e) { onError?.(e); }
    };
    T = { THREE, ...(await import('../timesSquare3d.js')) };
  } catch (e) { broken = e; }
}
it('the world loads under the stub page', { skip }, () => { if (broken) assert.fail('the world did not load: ' + (broken?.stack || broken)); });
if (broken) skip = 'the world did not load';
after(() => { for (const id of timers) clearTimeout(id); performance.now = real.now; Math.random = real.random; globalThis.setTimeout = real.setTimeout; });

// Everything the camera would draw between it and a point: three.js rays against the scene's meshes (my own avatar, the board's
// own screen, glows, beams, sprites and the moving cars left out), stopping 0.7 m short of the point. -> the names in the way.
function inTheWay(world, from, to) {
  const { THREE } = T, d = new THREE.Vector3().subVectors(to, from), len = d.length();
  const ray = new THREE.Raycaster(from, d.normalize(), 0.3, Math.max(0.3, len - 0.7));
  ray.layers.mask = world.camera.layers.mask; ray.camera = world.camera; // what the camera draws (far tiles are on their own layer)
  world.scene.updateMatrixWorld(true); // the stub renderer never draws, so nothing else brings the world matrices up to date
  const visible = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
  const hits = ray.intersectObjects(world.scene.children, true).filter(({ object: o }) => {
    if (!o.isMesh || o.isSkinnedMesh || !visible(o) || !(o.layers.mask & world.camera.layers.mask)) return false; // avatars are the crowd, not in its way
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (m && (m.blending === THREE.AdditiveBlending || (m.transparent && m.opacity < 0.9) || m.depthWrite === false)) return false;
    if (o.isInstancedMesh && o.count > 0 && o.userData?.traffic) return false;
    return true;
  });
  return hits.map((h) => `${h.object.name || h.object.type}@${h.distance.toFixed(1)}`);
}
const SLOTS = ['STREET_1', 'STREET_20', 'STREET_31', 'STREET_33', 'STREET_40', 'STREET_45', 'PLOT_1', 'PLOT_2', 'PLOT_9', 'PLOT_14', 'PLOT_17', 'PLOT_18'];
// Each size: the boards with the lots as the map builds them (empty, level 0), then the lot boards again with the lots built up.
const SIZES = [[375, 812], [812, 375], [1280, 720]];
for (const [w, h] of SIZES) {
  describe(`the ceremony in the world (${w} x ${h})`, { skip }, () => {
    let world = null;
    it('boots', async () => {
      world = await boot(w, h); // a fresh world: the page has one animation-frame slot, so only the newest world steps
    });
    it('goToSlot with a spread: two seeds, two spots near the board\'s front, both facing it', () => {
      const plain = world.goToSlot('STREET_1');
      assert.ok(plain);
      const a = world.goToSlot('STREET_1', { spread: 0.1 }), b = world.goToSlot('STREET_1', { spread: 0.8 });
      assert.ok(a && b && Math.hypot(a.x - b.x, a.z - b.z) > 2, JSON.stringify({ a, b }));
      for (const p of [a, b]) assert.ok(Math.hypot(p.x - plain.x, p.z - plain.z) < 6, 'within the spread of the front point');
      // By the entrance arch (lot 1): no seed lands on the arch's entry spot (the teleport's approachOf would pull it there, 7 m away).
      const front1 = world.goToSlot('PLOT_1');
      for (let s = 0; s < 1; s += 0.05) { const p = world.goToSlot('PLOT_1', { spread: s }); assert.ok(Math.hypot(p.x - front1.x, p.z - front1.z) < 5.2, `seed ${s.toFixed(2)}: ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`); }
    });
    for (const [built, ids] of [[false, SLOTS], [true, SLOTS.filter((s) => s.startsWith('PLOT_'))]]) {
    if (built) {
      it('builds the lots up (towers and arcades on alternate lots: the tallest things on the street)', async () => {
        for (let id = 1; id <= 18; id++) assert.ok(world.applyPlot({ plot_id: id, level: id % 2 ? 4 : 3, theme_color: '#ff3d9a', sign_text: '시험', owner_name: '시험' }, false));
        for (let i = 0; i < 60; i++) { run(0.05); await new Promise((r) => real.setTimeout(r, 20)); } // the lot models come from the disk
      });
    }
    for (const id of ids) {
      it(`${id}${built ? ' (lots built up)' : ''}: the photo pose sees the whole face, the crowd and my avatar, with nothing in the way`, (t) => {
        const { THREE } = T;
        const at = world.goToSlot(id, { spread: 0.37 });
        if (!at) return; // not on the map in this build (its front outside the fence)
        run(0.2);
        const pose = world.cerPose(id);
        assert.ok(pose, 'the pose is up');
        run(1.2);
        const cam = world.camera.position;
        assert.ok(cam.distanceTo(new THREE.Vector3(pose.cam.x, pose.cam.y, pose.cam.z)) < 0.05, 'the camera is at the pose');
        const F = pose.face, rx = F.nz, rz = -F.nx, me = world.getPlayer();
        const pts = [];
        for (const [u, v] of [[0, 0], [-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) pts.push(['face ' + u + ',' + v, new THREE.Vector3(F.x + rx * u * F.w + F.nx * 0.6, F.y + v * F.h, F.z + rz * u * F.w + F.nz * 0.6)]);
        for (const u of [-3, 0, 3]) pts.push(['crowd ' + u, new THREE.Vector3(pose.front.x + rx * u + F.nx * 1.5, 1.5, pose.front.z + rz * u + F.nz * 1.5)]);
        pts.push(['me', new THREE.Vector3(me.x, me.y + 1.5, me.z)]);
        const blocked = pts.map(([name, p]) => [name, inTheWay(world, cam.clone(), p)]).filter(([, hits]) => hits.length).map(([n, hits]) => n + ': ' + hits.join(' '));
        const off = Math.round(Math.atan2(F.nz * (cam.x - F.x) - F.nx * (cam.z - F.z), F.nx * (cam.x - F.x) + F.nz * (cam.z - F.z)) * 180 / Math.PI);
        t.diagnostic(`${id}${built ? '+built' : ''} ${w}x${h}: ${pose.dist} m out, ${off}° off the normal, camera y ${cam.y.toFixed(1)}, fov ${pose.fov}°, seen ${pose.seen}`);
        assert.deepEqual(blocked, [], `${id} from (${cam.x.toFixed(1)}, ${cam.y.toFixed(1)}, ${cam.z.toFixed(1)}) seen ${pose.seen}, dist ${pose.dist}, fov ${pose.fov}`);
        // In the frame: the face's four corners, my avatar's head and feet (the lens has eased to the pose's).
        world.camera.updateMatrixWorld(); world.camera.updateProjectionMatrix();
        for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
          const q = new THREE.Vector3(F.x + rx * u * F.w, F.y + v * F.h, F.z + rz * u * F.w).project(world.camera);
          assert.ok(Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1 && q.z < 1, `the face corner ${u},${v} is in the frame: ${q.x.toFixed(2)}, ${q.y.toFixed(2)}`);
        }
        for (const y of [0.1, 1.9]) { const q = new THREE.Vector3(me.x, me.y + y, me.z).project(world.camera); assert.ok(Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1, 'my avatar is in the frame'); }
        // My avatar faces the camera (a local turn): its yaw points at it.
        const yaw = Math.atan2(cam.x - me.x, cam.z - me.z), d = Math.atan2(Math.sin(me.yaw - yaw), Math.cos(me.yaw - yaw));
        assert.ok(Math.abs(d) < 0.05, 'facing the camera: ' + d);
        // The photo: my own tag is drawn for it (and off again after), the band carries the ceremony's words.
        drawn.length = 0;
        const blob = world.capture({ me: true, band: 'To. 민지 · 2026.12.25 · WISH BOARD 가상 광장' });
        assert.equal(blob.type, 'image/jpeg');
        assert.ok(drawn.includes('To. 민지 · 2026.12.25 · WISH BOARD 가상 광장'), drawn.join(' | '));
        world.cerEnd();
        run(0.8);
        assert.ok(world.camera.position.distanceTo(new THREE.Vector3(pose.cam.x, pose.cam.y, pose.cam.z)) > 1, 'cerEnd brings the camera back');
      });
    }
    }
    it('capture() with no argument is today\'s: my tag off for the render, the plaza\'s band', () => {
      drawn.length = 0;
      world.capture();
      assert.ok(drawn.includes('WISH BOARD · 모두의 전광판'));
    });
    it('the pose ends by itself if nobody ends it; a board that is not on the map has none', () => {
      world.goToSlot('STREET_31');
      run(0.2);
      assert.ok(world.cerPose('STREET_31'));
      assert.equal(world.cineOn(), true);
      run(10);
      assert.equal(world.cineOn(), false, 'CER_HOLD ran out');
      assert.equal(world.cerPose('NOPE_1'), false, 'a board that is not on the map');
      // In a taxi there is no pose (the source: getting into a cab here takes a taxi ride's worth of setup).
      const src = readFileSync(new URL('../timesSquare3d.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
      assert.match(src, /function cerPose\(slotId\) \{\n    if \(drive\) return false;/);
      assert.match(src, /const pose = cerShotPose\(\{ pos: \{ x: p\.x, y: p\.y, z: p\.z \}, normal: \{ x: nx, z: nz \}, w: face\.w, h: face\.h, front, aspect: camera\.aspect, fov: baseFov/);
      assert.match(src, /startCine\(new THREE\.Vector3\(pose\.cam\.x, pose\.cam\.y, pose\.cam\.z\), new THREE\.Vector3\(pose\.look\.x, pose\.look\.y, pose\.look\.z\), \{ dur: 900, pin: true, fov: pose\.fov, until: performance\.now\(\) \+ CER_HOLD \}\);/, 'pinned, no film: a cut with reduced motion');
    });
  });
}
