// 같이 춤추기 in the real world (timesSquare3d.js run in Node, the same stub page as test/world-run.test.mjs): my avatar and
// a remote one make the same move on the same bar, the K-댄스 reaction is the only thing sent (now and every RESEND_MS),
// the remote one stops when its signal stops, and moving, 순간이동 and a taxi end mine. The clock (Date.now, which live.js
// nowMs reads) and performance.now are both the test's own.
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

const real = { now: performance.now.bind(performance), dateNow: Date.now, setTimeout: globalThis.setTimeout, random: Math.random };
let clock = 10000, raf = null, seed = 20261125, epoch = 0; // Date.now() = epoch + clock
const timers = [];
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 40 }) : /Gradient$/.test(k) ? () => ({ addColorStop() {} }) : k === 'getImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
const el = (tag, w = 800, h = 600) => ({ tagName: String(tag).toUpperCase(), style: {}, dataset: {}, width: 0, height: 0, clientWidth: w, clientHeight: h, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, getContext: () => ctx2d, addEventListener() {}, removeEventListener() {}, setAttribute() {}, append() {}, appendChild() {}, remove() {}, closest: () => null, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }), getRootNode: () => globalThis.document, setPointerCapture() {}, releasePointerCapture() {} });
const bus = new EventTarget();
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
function page() {
  performance.now = () => clock;
  Date.now = () => epoch + clock;
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  globalThis.setTimeout = (f, ms, ...a) => { const id = real.setTimeout(f, ms, ...a); timers.push(id); return id; };
  globalThis.document = { createElement: (t) => el(t), createElementNS: (ns, t) => el(t), body: el('body'), documentElement: el('html'), hidden: false, addEventListener() {}, removeEventListener() {} };
  globalThis.window = globalThis;
  globalThis.addEventListener = bus.addEventListener.bind(bus);
  globalThis.removeEventListener = bus.removeEventListener.bind(bus);
  globalThis.localStorage = store();
  globalThis.sessionStorage = store();
  globalThis.location = { search: '', href: 'http://localhost/', origin: 'http://localhost', hostname: 'localhost', pathname: '/' };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.innerWidth = 800; globalThis.innerHeight = 600; globalThis.devicePixelRatio = 1;
  globalThis.requestAnimationFrame = (f) => { raf = f; return 1; };
  globalThis.cancelAnimationFrame = () => { raf = null; };
  globalThis.fetch = async (url) => { if (String(url).includes('manhattan.bin')) return new Response(readFileSync(MAP)); throw new Error('no network in this test: ' + url); };
}
const frame = () => { clock += 16; const f = raf; raf = null; f(clock); };
const run = (seconds, each) => { for (let i = 0, n = Math.round(seconds / 0.016); i < n; i++) { frame(); each?.(); } };

let T = null, D = null, L = null, broken = null, skip = existsSync(MAP) ? false : 'assets/nyc/manhattan.bin missing';
if (!skip) {
  try {
    page();
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    GLTFLoader.prototype.load = function (url, onLoad, onProgress, onError) {
      try { const b = readFileSync(new URL('..' + String(url).split('?')[0], import.meta.url)); this.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', onLoad, onError); } catch (e) { onError?.(e); }
    };
    T = { THREE, ...(await import('../timesSquare3d.js')), ...(await import('../net.js')) };
    D = await import('../dance.js');
    L = await import('../ts3d/layout.js');
  } catch (e) { broken = e; }
}
it('the world loads under the stub page', { skip }, () => {
  if (broken) assert.fail('the world did not load under the stub page: ' + (broken?.stack || broken?.message || broken));
});
if (broken) skip = 'the world did not load';
after(() => { for (const id of timers) clearTimeout(id); performance.now = real.now; Date.now = real.dateNow; Math.random = real.random; globalThis.setTimeout = real.setTimeout; });

describe('같이 춤추기 in the world', { skip }, () => {
  let world = null, peerAt = null;
  const sent = [], ended = [], asked = [], handlers = {};
  const started = []; // every clip faded in: { root, clip, t }
  const spot = () => L.LAYOUT.spawn;
  const net = {
    id: 'me',
    peers: new Map([['p2', { name: '친구', av: 1, outfit: '#3fe6ff' }]]),
    sample: () => ({ x: T.toNetUnits(peerAt.x), y: T.toNetUnits(peerAt.z), vx: 0, vy: 0, face: '180', anim: 'idle' }),
    on: (ev, fn) => { handlers[ev] = fn; },
    onWorldUpdate() {},
    tick() {},
    send: (type, body) => sent.push([type, body]),
    sendEmoji: (e) => sent.push(['E', e]),
  };
  // Whose avatar a clip played on: the model's place in the world, next to me or next to the peer.
  const whose = (root) => {
    const p = new T.THREE.Vector3();
    root.getWorldPosition(p);
    const me = world.getPlayer();
    return Math.hypot(p.x - me.x, p.z - me.z) < 1 ? 'me' : Math.hypot(p.x - peerAt.x, p.z - peerAt.z) < 1 ? 'p2' : '?';
  };
  it('boots with one peer 4 m away, in view', async () => {
    // the radio starts a neon bar 0 a moment after the boot (the test's clock, so the same bars every run)
    const list = D.radioList(Date.UTC(2026, 10, 24, 3));
    const cycle = list.reduce((s, t) => s + D.trackMs(t), 0);
    epoch = Math.ceil(Date.UTC(2026, 10, 24, 3) / cycle) * cycle - clock - 400;
    const A = T.THREE.AnimationAction.prototype, fadeIn = A.fadeIn;
    A.fadeIn = function (d) { started.push({ root: this.getRoot(), clip: this.getClip().name, t: clock }); return fadeIn.call(this, d); };
    const canvas = Object.assign(el('canvas', 800, 600), { parentElement: el('div', 800, 600) });
    const errors = [];
    world = T.createTimesSquare(canvas, {
      quality: 'low', autostart: false, name: '시험', species: 1, net,
      onError: (e) => errors.push(e),
      onDanceEnd: (why) => ended.push(why),
      onDancerNear: (id, name) => { asked.push([id, name]); return true; },
    });
    for (let i = 0; i < 400 && !(world.built() && world.mapData()); i++) await new Promise((r) => real.setTimeout(r, 10));
    assert.equal(errors.length, 0, errors[0]?.message);
    world.start();
    const s = spot();
    world.teleport(s.x, s.z);
    peerAt = { x: world.getPlayer().x + 4, z: world.getPlayer().z };
    for (let i = 0; i < 40; i++) { run(0.025); await new Promise((r) => real.setTimeout(r, 15)); } // the models load between frames
    assert.equal(D.radioAt(Date.now()).id, 'neon');
  });
  it('mine and the peer\'s make the same move on the same bar; only K-댄스 goes out, now and every 4 s', () => {
    sent.length = 0;
    assert.equal(world.setDancing(true), true);
    assert.deepEqual(sent, [['E', 4]]);
    handlers.emoji({ id: 'p2', e: 4 }); // the peer is dancing too
    started.length = 0;
    const want = new Map(); // bar key -> the move the radio names
    let peerSent = clock;
    run(9, () => {
      const r = D.radioAt(Date.now());
      want.set(r.key, r.clip);
      if (clock - peerSent >= D.RESEND_MS) { peerSent = clock; handlers.emoji({ id: 'p2', e: 4 }); }
    });
    const moves = [...want.values()].filter((c) => c !== 'Dance');
    assert.ok(moves.length >= 2, 'the bars here have moves: ' + [...want.values()].join());
    for (const who of ['me', 'p2']) {
      const mine = started.filter((s) => whose(s.root) === who && s.clip !== 'Dance' && D.DANCE_CLIPS.includes(s.clip)).map((s) => s.clip);
      assert.deepEqual(mine, moves, who + ' played the radio\'s moves in order');
    }
    // and at the same moment: each move started on both within one frame of each other
    const at = (who, clip) => started.filter((s) => whose(s.root) === who && s.clip === clip).map((s) => s.t);
    for (const clip of new Set(moves)) assert.deepEqual(at('me', clip), at('p2', clip), clip);
    assert.equal(world.danceCount(), 2);
    const out = sent.filter((m) => m[0] !== 'E');
    assert.deepEqual(out, [], 'no other message while dancing');
    assert.equal(sent.length, 1 + Math.floor((9 * 1000 - 16) / D.RESEND_MS), 'K-댄스 every RESEND_MS');
    assert.ok(sent.every((m) => m[1] === 4));
    assert.deepEqual(asked, [], 'no notice while I dance myself');
  });
  it('the peer stops sending: on my screen it stops dancing within DANCER_MS', () => {
    run(D.DANCER_MS / 1000 + 0.5);
    assert.equal(world.danceCount(), 1);
    started.length = 0;
    run(5);
    assert.equal(started.filter((s) => whose(s.root) === 'p2' && D.DANCE_CLIPS.includes(s.clip)).length, 0, started.map((s) => s.clip).join());
  });
  it('moving ends mine and tells the page; so does 순간이동', () => {
    world.setJoystick(0.8, 0);
    run(0.6);
    world.setJoystick(0, 0);
    assert.deepEqual(ended, ['move']);
    const n = sent.length;
    run(5);
    assert.equal(sent.length, n, 'nothing more is sent once it ends');
    assert.equal(world.danceCount(), 0);
    world.setDancing(true);
    world.teleport(spot().x, spot().z + 4);
    assert.deepEqual(ended, ['move', 'teleport']);
    assert.equal(world.setDancing(false), false);
  });
  it('while I stand, a peer who keeps dancing 4 m away is offered once (a single K-댄스 is not)', () => {
    peerAt = { x: world.getPlayer().x + 4, z: world.getPlayer().z };
    run(3); // the peer glides to its new place first (a walking peer is not dancing)
    handlers.emoji({ id: 'p2', e: 4 });
    run(2);
    assert.deepEqual(asked, [], 'one reaction is a K-댄스 tap, not a dance');
    handlers.emoji({ id: 'p2', e: 4 });
    run(2);
    handlers.emoji({ id: 'p2', e: 4 });
    run(0.2);
    assert.deepEqual(asked, [['p2', '친구']]);
    for (let i = 0; i < 3; i++) { run(D.RESEND_MS / 1000); handlers.emoji({ id: 'p2', e: 4 }); }
    assert.deepEqual(asked, [['p2', '친구']], 'once per player');
  });
});
