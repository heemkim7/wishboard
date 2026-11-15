// Times Square K-점령전 — 3D engine.
// Renderer + bloom, photo-lit environment, OrbitControls follow camera (with look-up tilt), camera-relative WASD,
// collisions/stairs, GLTF avatars, drivable taxis + passenger jobs, waypoints, billboards, plots, fireworks, stars.
// The local player is driven only by local input; net.js samples are applied to remote avatars only.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toNetUnits, fromNetUnits } from './net.js?v=20261114a';
import { LAYOUT, LOOP, insideLoop, PLOT_SLOTS, TAXI_STANDS, SKIP_ZONES, NO_PROPS, NO_TREES, FAR_CLUSTERS, LANDMARKS, groundHeight, onStairs, fountainSpot } from './ts3d/layout.js?v=20261113b';
import { BALANCE, chainsOf, slotName } from './balance.js?v=20261113y';
import { kitMaterials } from './ts3d/kit.js';
import { createReflection } from './ts3d/ground.js';
import { createBoards, screenTime } from './ts3d/screens.js?v=20261114a';
import { loadNYC, ROAD } from './ts3d/nyc.js';
import { createWorld, FAR_LAYER } from './ts3d/world.js';
import { createTraffic } from './ts3d/traffic.js?v=20261113j';
import { buildTimesSquare } from './ts3d/timesq.js?v=20261113h';
import { claimRockefeller, buildRockefeller } from './ts3d/rockefeller.js';
import { claimIcons, buildIcons } from './ts3d/icons.js';
import { buildLandmarks } from './ts3d/landmarks.js?v=20261114i';
import { createAvatars, EMOTES, REACTIONS, AVATAR_COLORS, speciesId } from './ts3d/avatars.js?v=20261114q';
import { THEMES, paintBillboard, makeCanvas, paintGlow, paintBeam, paintMarker, fontsReady, chars, hashStr } from './ts3d/art.js?v=20261113b';
import { taxiTrainMult, applyTaxiHardHit } from './taxiTrain.js?v=20261114d';

export { paintBillboard, THEMES, LAYOUT, PLOT_SLOTS, groundHeight, EMOTES, AVATAR_COLORS, taxiTrainMult, applyTaxiHardHit };
export const PLAZA = LAYOUT;
const STICKER_GLYPHS = ['🔥부럽다!', '👑성지순례', '💖하트폭탄', '👀내자리찜'];

const RUN = 6.2, WALK = 2.4, RADIUS = 0.36, DEG = Math.PI / 180, EYE = 1.9, CAR_EYE = 2.5;
const MODELS = { 1: '/assets/models/Mousey.glb', 2: '/assets/models/Cat.glb', 3: '/assets/models/Bear.glb' };
const CAR = { max: 22, boost: 31, accel: 9, brake: 20, reverse: 7, drag: 4.5, steer: 1.9, radius: 1.05 };
const MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
const COLOR_RE = /^#[0-9a-f]{6}$/i;

// Height fog: street-level haze thins out with altitude so the towers read across the whole city.
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying float vFogHeight;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogHeight = ( transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) ).y;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = '#ifdef USE_FOG\n\tuniform vec3 fogColor;\n\tvarying float vFogDepth;\n\tvarying float vFogHeight;\n\t#ifdef FOG_EXP2\n\t\tuniform float fogDensity;\n\t#else\n\t\tuniform float fogNear;\n\t\tuniform float fogFar;\n\t#endif\n#endif';
THREE.ShaderChunk.fog_fragment = '#ifdef USE_FOG\n\t#ifdef FOG_EXP2\n\t\tfloat fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth * exp( - max( vFogHeight, 0.0 ) / 150.0 ) );\n\t#else\n\t\tfloat fogFactor = smoothstep( fogNear, fogFar, vFogDepth );\n\t#endif\n\tgl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );\n#endif';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = (a) => ((((a % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
function dampAngle(a, b, lambda, dt) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
}
function isTyping(e) {
  const t = e.target;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
export function detectQuality() {
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'low' || q === 'medium' || q === 'high') return q;
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (coarse || Math.min(innerWidth, innerHeight) < 600 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return 'low';
  if ((navigator.deviceMemory || 8) <= 4 || (navigator.hardwareConcurrency || 8) <= 4) return 'medium';
  return 'high';
}
export const colorFor = (id) => AVATAR_COLORS[hashStr(id) % AVATAR_COLORS.length];

export function createTimesSquare(canvas, opts = {}) {
  if (!canvas) throw new Error('canvas');
  const net = opts.net || null;
  const quality = opts.quality || detectQuality();
  const low = quality === 'low';
  const ac = new AbortController();
  const { signal } = ac;

  // ---- renderer / scene / camera ---------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = clamp(Number(opts.exposure) || 0.95, 0.5, 1.5);
  const dprCap = quality === 'high' ? 1.75 : quality === 'medium' ? 1.25 : 1.5;
  let dpr = Math.min(window.devicePixelRatio || 1, dprCap);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x2a2248, quality === 'high' ? 0.0009 : quality === 'medium' ? 0.00115 : 0.0015);
  scene.environmentIntensity = 0.4;
  const baseFov = low ? 62 : 55;
  const camera = new THREE.PerspectiveCamera(baseFov, 1, 0.2, 5200);
  camera.layers.enable(1);
  camera.layers.enable(2);
  camera.layers.enable(FAR_LAYER);

  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => { mgrProgress = total ? loaded / total : 1; reportProgress(); };

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  let envRT = pmrem.fromScene(room, 0.04);
  room.dispose();
  scene.environment = envRT.texture;

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: screenTime },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir; uniform float uTime;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * vn(p); p *= 2.03; a *= 0.5; } return v; }
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  vec3 zen = vec3(0.006, 0.008, 0.03), mid = vec3(0.03, 0.022, 0.085), hor = vec3(0.16, 0.06, 0.2), warm = vec3(0.34, 0.12, 0.13);
  vec3 c = mix(mid, zen, smoothstep(0.1, 0.75, h));
  c = mix(hor, c, smoothstep(0.0, 0.2, h));
  c = mix(warm, c, smoothstep(-0.03, 0.07, h));
  vec2 uv = d.xz / max(0.06, d.y + 0.1) * 0.8 + vec2(uTime * 0.006, uTime * 0.0025);
  float n = fbm(uv * 1.2);
  float cl = smoothstep(0.48, 0.86, n) * smoothstep(0.02, 0.22, h) * (1.0 - smoothstep(0.5, 0.95, h));
  c += mix(vec3(0.3, 0.09, 0.28), vec3(0.42, 0.2, 0.14), n) * cl * 0.5;
  vec2 sp = floor(d.xz / (d.y + 0.02) * 260.0);
  c += step(0.9988, h21(sp)) * smoothstep(0.4, 0.85, h) * 0.5;
  gl_FragColor = vec4(c, 1.0);
}`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4800, 32, 16), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);

  // ---- lights (constant count: toggling would recompile every material) -----------
  const hemi = new THREE.HemisphereLight(0xb7c6ff, 0x6a3048, low ? 5.4 : 4.6);
  const moon = new THREE.DirectionalLight(0xd0dcff, 1.25);
  moon.position.set(-40, 90, 30);
  scene.add(hemi, moon);
  const mainLight = new THREE.PointLight(0x3fe6ff, 600, 95, 2);
  mainLight.position.set(LAYOUT.oneTimes.x, 18, LAYOUT.oneTimes.z - 26);
  const stallLight = new THREE.PointLight(0xff8a2a, 30, 16, 2);
  stallLight.position.set(LAYOUT.stall.x, 2.3, LAYOUT.stall.z + 0.4);
  const westLight = new THREE.PointLight(0xff3d9a, low ? 760 : 520, 85, 2);
  westLight.position.set(low ? 16 : -22, 16, low ? 60 : -40);
  scene.add(mainLight, stallLight, westLight);
  let eastLight = null;
  if (!low) {
    eastLight = new THREE.PointLight(0x3fe6ff, 520, 85, 2);
    eastLight.position.set(30, 16, 95);
    const stageLight = new THREE.PointLight(0xff3d9a, 160, 30, 2);
    stageLight.position.set(LAYOUT.stage.cx, 7, LAYOUT.stage.z0 - 2);
    scene.add(eastLight, stageLight);
  }

  // ---- postprocessing --------------------------------------------------------------
  const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: quality === 'high' ? 4 : 0 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.4, low ? 0.32 : 0.4, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const reflection = createReflection(renderer, { enabled: !low, scale: quality === 'high' ? 0.5 : 0.36 });

  // ---- world -------------------------------------------------------------------------
  const kitMats = kitMaterials();
  const colliders = [];
  const carColliders = [];
  const blockers = [];
  const pick = [];
  const fireworks = [];
  const sparkTex = new THREE.CanvasTexture(paintGlow(makeCanvas(64, 64)));
  const boards = createBoards({ renderer, kitMats, pick, onBurst: (p, color, tier) => celebrateAt(p, color, tier) });
  const avatars = createAvatars({ scene, models: MODELS, first: opts.species });
  {
    const S = LAYOUT.stairs, G = LAYOUT.stage;
    carColliders.push({ x0: S.x0 - 0.4, x1: S.x1 + 0.4, z0: S.back, z1: S.front + 0.2 });
    carColliders.push({ x0: G.x0, x1: G.x1, z0: G.z0 - 2.4, z1: G.z1 });
  }

  // The city streams in from /assets/nyc/manhattan.bin; everything below tolerates it not being there yet.
  let nyc = null, world = null, traffic = null, tsq = null, marks = null;
  let cityProgress = 0, mgrProgress = 0, pendingPlots = [];
  const reportProgress = () => opts.onProgress?.(Math.min(0.99, cityProgress * 0.45 + mgrProgress * 0.55));
  loadNYC('/assets/nyc/manhattan.bin', (p) => { cityProgress = p; reportProgress(); }).then((data) => {
    nyc = data;
    const rock = claimRockefeller(nyc);
    const icons = claimIcons(nyc);
    world = createWorld({ scene, renderer, manager, nyc, quality, kitMats, reflection, layout: { SKIP_ZONES, NO_PROPS, NO_TREES, FAR_CLUSTERS } });
    buildRockefeller(rock, { scene });
    buildIcons(icons, { scene });
    tsq = buildTimesSquare({ scene, renderer, manager, kitMats, boards, nyc, quality, colliders });
    hideStockBall();
    marks = buildLandmarks({ scene, kitMats, boards, ground: world, colliders, blockers, pick, quality, onFishLanded: (p, gold) => burst(p, gold ? '#ffcf5a' : '#ffb070', gold ? 70 : 34, gold ? 0.8 : 0.5) });
    traffic = createTraffic({ scene, nyc, kitMats, quality, renderer, onHonk: () => opts.onHonk?.() });
    nyc.ensureSolid(pos.x, pos.z, 360);
    world.warm(pos.x, pos.z, low ? 220 : 320);
    traffic.warm(pos.x, pos.z);
    for (const row of pendingPlots.splice(0)) applyPlot(row, false);
    refreshLightColors();
    applyGlow();
    cityProgress = 1;
    maybeReady();
  }).catch((err) => {
    console.error('[city]', err);
    opts.onError?.(err);
    maybeReady(true);
  });

  // Global neon level: bloom strength + kit glow dimmer.
  let glow = clamp(opts.glow ?? 0.45, 0, 1);
  function applyGlow() {
    bloom.strength = 0.08 + 0.62 * glow;
    bloom.threshold = 1.08 - 0.28 * glow;
    kitMats.glow.color.setScalar(0.5 + 0.7 * glow);
    if (world) world.uWin.value = 0.55 + 0.45 * glow;
  }
  applyGlow();

  // ---- local player -------------------------------------------------------------------
  const pos0 = opts.start && Number.isFinite(opts.start.x) ? opts.start : LAYOUT.spawn;
  const pos = new THREE.Vector3(pos0.x, groundHeight(pos0.x, pos0.z), pos0.z);
  const vel = new THREE.Vector3();
  let yaw = Number.isFinite(pos0.yaw) ? pos0.yaw : LAYOUT.spawn.yaw, animSpeed = 0, sitTimer = 0, inputEnabled = true, dancing = false, danceAt = 0;
  let name = chars(opts.name || '네온손님', 16);
  let color = COLOR_RE.test(opts.color || '') ? opts.color : AVATAR_COLORS[0];
  let species = speciesId(opts.species);
  const me = avatars.create({ id: 'me', name, color, local: true, species });
  me.root.position.copy(pos);
  me.holder.rotation.y = yaw;
  const netState = { name, outfit: color, av: species, equip: '', x: toNetUnits(pos.x), y: toNetUnits(pos.z), face: String(Math.round(yaw / DEG)), anim: 'idle', fl: 0, vx: 0, vy: 0 };
  let drive = null;
  let lastBump = 0;

  // ---- camera rig ------------------------------------------------------------------------
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.enablePan = false;
  controls.rotateSpeed = low ? 0.85 : 0.6;
  controls.enableZoom = false;
  controls.minDistance = 2.8;
  controls.maxDistance = 26;
  controls.minPolarAngle = 0.18;
  controls.maxPolarAngle = Math.PI - 0.12;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
  let orbiting = false, orbitEnd = 0;
  canvas.addEventListener('wheel', (e) => {
    if (e.target.closest?.('.modal, .minimap, .mapzoom, input, textarea, select')) return;
    e.preventDefault();
    const off = camWant.clone().sub(follow);
    const len = off.length() || 8;
    const next = clamp(len * (e.deltaY > 0 ? 1.12 : 0.88), controls.minDistance, controls.maxDistance);
    camWant.copy(follow).add(off.setLength(next));
    camera.position.copy(camWant);
    controls.update();
  }, { signal, passive: false });
  let pinch = null;
  const onCanvas = (list) => [...list].filter((t) => t.target === canvas);
  canvas.addEventListener('touchstart', (e) => {
    const v = onCanvas(e.touches);
    if (v.length < 2) { pinch = null; return; }
    pinch = { d: Math.hypot(v[0].clientX - v[1].clientX, v[0].clientY - v[1].clientY) || 1, len: camWant.clone().sub(follow).length() || 8 };
  }, { signal, passive: true });
  canvas.addEventListener('touchmove', (e) => {
    const v = onCanvas(e.touches);
    if (v.length < 2 || !pinch) return;
    e.preventDefault();
    const d = Math.hypot(v[0].clientX - v[1].clientX, v[0].clientY - v[1].clientY) || 1;
    const off = camWant.clone().sub(follow);
    const next = clamp((pinch.len * pinch.d) / d, controls.minDistance, controls.maxDistance);
    camWant.copy(follow).add(off.setLength(next));
    camera.position.copy(camWant);
    controls.update();
  }, { signal, passive: false });
  canvas.addEventListener('touchend', () => { pinch = null; }, { signal });
  controls.addEventListener('start', () => { orbiting = true; });
  controls.addEventListener('end', () => { orbiting = false; orbitEnd = performance.now(); });
  let eye = EYE;
  const follow = new THREE.Vector3(pos.x, pos.y + eye, pos.z);
  controls.target.copy(follow);
  camera.position.set(pos.x - Math.sin(yaw) * 8.2, pos.y + eye + 1.25, pos.z - Math.cos(yaw) * 8.2);
  controls.update();
  const camWant = camera.position.clone();
  const cineFrom = new THREE.Vector3(), cineTo = new THREE.Vector3(), cineL0 = new THREE.Vector3(), cineL1 = new THREE.Vector3();
  let cine = null, boostHeld = false, boostSnd = 0;
  let lounge = false, loungeI = 0, loungeAt = 0, hopped = 0, hiveAt = 0, shake = 0;

  // ---- input ----------------------------------------------------------------------------
  const keys = new Set();
  const joy = { x: 0, y: 0 };
  let lastNearKey = '', near = null, lastJump = 0;
  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    if (e.code === 'Escape') { clearCine(); return; }
    if (MOVE_CODES.has(e.code)) {
      keys.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault();
    }
    if (!inputEnabled || e.repeat) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (drive) opts.onHorn?.();
      else if (near && (near.kind === 'cart' || near.kind === 'stage')) interact();
      else jump();
    }
    else if (e.code === 'KeyE' || e.code === 'KeyF') interact();
    else if (!drive && /^Digit[1-4]$/.test(e.code)) playEmote(Number(e.code.slice(5)));
  }, { signal });
  window.addEventListener('keyup', (e) => keys.delete(e.code), { signal });
  window.addEventListener('blur', () => keys.clear(), { signal });

  const ray = new THREE.Raycaster();
  ray.layers.enableAll();
  const ndc = new THREE.Vector2();
  let down = null, hoverAt = 0;
  const pickAt = (ev) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    ray.far = 260;
    const hit = ray.intersectObjects(pick, false).find(h => h.object.userData.pick);
    return hit ? hit.object.userData.pick : null;
  };
  canvas.addEventListener('pointerdown', (ev) => {
    if (cine?.locked && me.root.visible) clearCine();
    down = { x: ev.clientX, y: ev.clientY, t: performance.now() }; canvas.style.cursor = 'grabbing';
  }, { signal });
  canvas.addEventListener('pointerup', (ev) => {
    canvas.style.cursor = 'grab';
    if (!down) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    const quick = performance.now() - down.t < 450;
    down = null;
    if (moved > 7 || !quick || !inputEnabled) return;
    const info = pickAt(ev);
    if (!info) return;
    if (info.kind === 'billboard') opts.onBillboard?.(info.slotId);
    else if (info.kind === 'plot') opts.onPlot?.(info.plotId);
    else opts.onInteract?.(info.kind, null, { clicked: true, near: near?.kind === info.kind });
  }, { signal });
  canvas.addEventListener('pointermove', (ev) => {
    if (down || ev.pointerType !== 'mouse') return;
    const now = performance.now();
    if (now - hoverAt < 90) return;
    hoverAt = now;
    canvas.style.cursor = pickAt(ev) ? 'pointer' : 'grab';
  }, { signal });
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault(), { signal });
  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';

  // ---- helpers --------------------------------------------------------------------------
  const pushOut = (x, z, r, list) => {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (x < c.x0 - r || x > c.x1 + r || z < c.z0 - r || z > c.z1 + r) continue;
      const nx = clamp(x, c.x0, c.x1), nz = clamp(z, c.z0, c.z1);
      const dx = x - nx, dz = z - nz, d2 = dx * dx + dz * dz;
      if (d2 > r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = nx + (dx / d) * r;
        z = nz + (dz / d) * r;
      } else {
        const l = x - c.x0, rr = c.x1 - x, b = z - c.z0, f = c.z1 - z, m = Math.min(l, rr, b, f);
        if (m === l) x = c.x0 - r; else if (m === rr) x = c.x1 + r; else if (m === b) z = c.z0 - r; else z = c.z1 + r;
      }
    }
    return [x, z];
  };
  /** Landmark boxes, cars, street props, then building walls and the shoreline (the city data). */
  function collide(x, z, r, withCars) {
    for (let pass = 0; pass < 2; pass++) {
      [x, z] = pushOut(x, z, r, colliders);
      if (withCars) [x, z] = pushOut(x, z, r, carColliders);
      if (traffic) [x, z] = traffic.collide(x, z, r);
      if (world) [x, z] = world.collideProps(x, z, r);
      if (nyc) [x, z] = nyc.collide(x, z, r);
    }
    return [clamp(x, LOOP.x0 + 1.4, LOOP.x1 - 1.4), clamp(z, LOOP.z0 + 1.4, LOOP.z1 - 1.4)];
  }
  function approachOf(x, z) {
    const S = LAYOUT.stall, G = LAYOUT.stage;
    const spots = [
      { x: S.x, z: S.z + 4.4, yaw: Math.PI },
      { x: G.spot.x, z: G.z0 - 3.6, yaw: 0 },
      ...TAXI_STANDS.map((s) => ({ x: s.x, z: s.z, yaw: s.axis === 'x' ? Math.PI / 2 : 0 })),
    ];
    let best = null;
    for (const s of spots) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < 18 && (!best || d < best.d)) best = { ...s, d };
    }
    return best;
  }

  const PALETTE = ['#ff3d9a', '#3fe6ff', '#ffcf5a', '#39f58a', '#b84dff', '#ffffff'];
  function burst(at, hex, n = 70, power = 1) {
    const count = Math.max(12, Math.round(n * (low ? 0.6 : 1)));
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3), c = new Float32Array(count * 3), v = new Float32Array(count * 3);
    const base = new THREE.Color(hex), alt = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const sp = (7 + Math.random() * 6) * power;
      v[i * 3] = Math.cos(a) * s * sp; v[i * 3 + 1] = u * sp + 2 * power; v[i * 3 + 2] = Math.sin(a) * s * sp;
      alt.copy(i % 4 === 0 ? new THREE.Color(PALETTE[i % PALETTE.length]) : base).multiplyScalar(2.6);
      c[i * 3] = alt.r; c[i * 3 + 1] = alt.g; c[i * 3 + 2] = alt.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const mat = new THREE.PointsMaterial({ size: (power >= 1 ? 1.45 : 1.05) * Math.max(0.6, power), map: sparkTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    pts.position.copy(at);
    pts.frustumCulled = false;
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: base.clone().multiplyScalar(2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    flash.position.copy(at);
    flash.userData.max = 7 * power;
    scene.add(pts, flash);
    fireworks.push({ pts, flash, v, age: 0, life: 2.4 });
    while (fireworks.length > 14) dropFirework(0);
  }
  const rockets = [];
  function launch(x, z, y1, hex, delay = 0) {
    rockets.push({ x, z, y: groundHeight(x, z), y1, hex, delay, sprite: null });
  }
  function cheerAt(slotId) {
    const p = boards.worldPos(slotId);
    if (!p) return false;
    burst(p.clone(), '#ff3d9a', 46, 0.65);
    launch(p.x, p.z, p.y + 3, '#ffcf5a', 0.04);
    launch(p.x + 1.2, p.z, p.y + 7, '#ffffff', 0.12);
    return true;
  }
  function fountainSplash() {
    const f = fountainSpot();
    burst(new THREE.Vector3(f.x, f.y, f.z), '#7fd4ff', 42, 0.6);
  }
  function celebrateAt(p, hex, tier) {
    const big = tier === 'S' ? 4 : tier === 'B' ? 3 : 2;
    burst(p, hex, tier === 'S' ? 140 : 90, tier === 'S' ? 1.5 : 1);
    for (let i = 0; i < big; i++) {
      const ox = p.x + (Math.random() - 0.5) * 16, oz = p.z + 6 + Math.random() * 8;
      launch(ox, oz, p.y + 4 + Math.random() * 8, PALETTE[(i + 1) % PALETTE.length], 0.15 + i * 0.35);
    }
  }
  function dropFirework(i) {
    const f = fireworks[i];
    scene.remove(f.pts, f.flash);
    f.pts.geometry.dispose();
    f.pts.material.dispose();
    f.flash.material.dispose();
    fireworks.splice(i, 1);
  }

  // ---- markers (taxi pickup / drop-off / waypoint) ------------------------------------------
  const beamTex = new THREE.CanvasTexture(paintBeam(makeCanvas(64, 256)));
  function makeMarker(colorHex, glyph) {
    const g = new THREE.Group();
    const col = new THREE.Color(colorHex);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.6, 70, 20, 1, true).translate(0, 35, 0), new THREE.MeshBasicMaterial({ map: beamTex, color: col.clone().multiplyScalar(0.55), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.rotation.x = Math.PI;
    beam.position.y = 70;
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 3, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.6), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.position.y = 0.05;
    ring.layers.set(1);
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(paintMarker(makeCanvas(128, 128), glyph, colorHex)), transparent: true, depthWrite: false }));
    icon.scale.set(2.6, 2.6, 1);
    icon.position.y = 6;
    icon.layers.set(2);
    beam.layers.set(2);
    g.add(beam, ring, icon);
    g.visible = false;
    scene.add(g);
    return { g, ring, icon, set(p) { g.visible = !!p; if (p) g.position.set(p.x, groundHeight(p.x, p.z), p.z); } };
  }
  const markers = { pickup: makeMarker('#39f58a', '🙋'), drop: makeMarker('#ffcf5a', '🏁'), way: makeMarker('#3fe6ff', '📍') };
  const passenger = new THREE.Group();
  {
    const cloth = new THREE.MeshStandardMaterial({ color: '#ffcf5a', roughness: 0.55 });
    const skin = new THREE.MeshStandardMaterial({ color: '#ffd2ad', roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.62, 4, 8), cloth);
    body.position.y = 0.9;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skin);
    head.position.y = 1.62;
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(paintMarker(makeCanvas(256, 96), '손님', '#39f58a')), transparent: true, depthWrite: false }));
    tag.position.y = 2.25;
    tag.scale.set(3.4, 1.28, 1);
    passenger.add(body, head, tag);
    passenger.visible = false;
    scene.add(passenger);
  }
  function showPassenger(p) {
    passenger.visible = !!p;
    if (p) passenger.position.set(p.x, groundHeight(p.x, p.z), p.z);
  }
  {
    const beam = markers.drop.g.children[0];
    beam.geometry.dispose();
    beam.geometry = new THREE.CylinderGeometry(1.6, 1.6, 25, 24, 1, true);
    beam.position.y = 12.5;
    beam.rotation.x = 0;
    beam.material = new THREE.MeshBasicMaterial({ color: 0xffcf5a, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
    beam.layers.enable(0);
  }
  {
    const beam = markers.pickup.g.children[0];
    beam.geometry.dispose();
    beam.geometry = new THREE.CylinderGeometry(1.2, 2.4, 40, 16, 1, true);
    beam.position.y = 20;
    beam.rotation.x = 0;
    beam.material = new THREE.MeshBasicMaterial({ color: 0x39f58a, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    beam.layers.enable(0);
  }
  let waypoint = null;
  const job = { phase: 'none', target: null, dest: null, t0: 0, limit: 0, nextAt: 0, startX: 0, startZ: 0, riders: 0, extra: null, extraAt: 0, extraReach: 0, detachAt: 0 };

  /** A curbside spot on a real street, minD..maxD meters from `from`. */
  function pickSpot(minD, maxD, from) {
    const street = (r) => nyc.roads.cls[r] >= ROAD.PRIMARY && nyc.roads.cls[r] <= ROAD.STREET;
    for (let tries = 0; nyc && tries < 40; tries++) {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
      const hit = nyc.nearestRoad(from.x + Math.cos(a) * d, from.z + Math.sin(a) * d, 45, street);
      if (!hit) continue;
      const w = nyc.roads.width[hit.road], side = Math.random() < 0.5 ? 1 : -1;
      const x = hit.px - hit.fz * (w / 2 - 1.4) * side, z = hit.pz + hit.fx * (w / 2 - 1.4) * side;
      if (nyc.onLand(x, z) && insideLoop(x, z, 8)) return { x, z };
    }
    return { x: clamp(from.x, LOOP.x0 + 12, LOOP.x1 - 12), z: clamp(from.z + 40, LOOP.z0 + 12, LOOP.z1 - 12) };
  }

  // ---- emotes / actions -----------------------------------------------------------------------
  function playEmote(id, send = true) {
    const e = EMOTES[id];
    if (!e || drive) return false;
    me.emote(e.anim, e.hold);
    me.say(e.glyph);
    if (id === 2) launch(pos.x, pos.z, pos.y + 9, PALETTE[(Math.random() * PALETTE.length) | 0], 0.25);
    if (send) { try { net?.sendEmoji?.(id); } catch { /* offline */ } }
    opts.onEmote?.(id);
    return true;
  }
  let lastReact = 0;
  function playReaction(i, send = true) {
    const r = REACTIONS[i];
    const now = performance.now();
    if (!r || now - lastReact < 700) return false;
    lastReact = now;
    me.say(r.g);
    if (r.anim && !drive) me.emote(r.anim, r.anim === 'Dance' ? 3 : 0);
    if (send) { try { net?.send?.('react', { r: i }); } catch { /* offline */ } }
    return true;
  }
  function showReaction(id, i) {
    const r = REACTIONS[i];
    const av = remoteFor(id);
    if (!r || !av) return;
    av.say(r.g);
    if (r.anim) av.emote(r.anim, r.anim === 'Dance' ? 3 : 0);
  }
  function jump() {
    const now = performance.now();
    if (now - lastJump < 900 || drive) return;
    lastJump = now;
    me.emote('Jump');
    opts.onJump?.();
    try { net?.send?.('jump', {}); } catch { /* offline */ }
  }
  function rescaleOrbit(dist) {
    const off = camWant.clone().sub(follow);
    if (off.lengthSq() < 1e-6) return;
    camWant.copy(follow).add(off.setLength(dist));
  }
  function enterTaxi(i) {
    const t = traffic?.takeTaxi(i);
    if (!t) return false;
    drive = { i, x: t.x, z: t.z, y: groundHeight(t.x, t.z), yaw: t.yaw, v: 0, steer: 0, odo: 0, fare: 3 };
    me.root.visible = false;
    vel.set(0, 0, 0);
    pos.set(t.x, 0, t.z);
    eye = CAR_EYE;
    follow.set(pos.x, eye, pos.z);
    rescaleOrbit(11.5);
    clearRide();
    job.nextAt = clockT + 0.4;
    netState.equip = 'taxi';
    opts.onDrive?.(true);
    return true;
  }
  function exitTaxi() {
    if (!drive) return;
    const { x, z, yaw: cy } = drive;
    const rx = -Math.cos(cy), rz = Math.sin(cy);
    let out = null;
    for (const s of [1, -1, 0]) {
      const ex = x + rx * 2.4 * s, ez = z + rz * 2.4 * s;
      const [cx, cz] = collide(ex, ez, RADIUS, false);
      if (Math.hypot(cx - ex, cz - ez) < 0.05 || s === 0) { out = [cx, cz]; break; }
    }
    traffic?.releaseTaxi(drive.i, x, z, cy);
    drive = null;
    pos.set(out[0], groundHeight(out[0], out[1]), out[1]);
    yaw = cy;
    me.root.visible = true;
    me.root.position.copy(pos);
    eye = EYE;
    follow.set(pos.x, pos.y + eye, pos.z);
    rescaleOrbit(8.5);
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
    clearRide();
    netState.equip = '';
    opts.onDrive?.(false);
  }
  function interact() {
    if (drive) { exitTaxi(); return; }
    if (!near) return;
    if (near.kind === 'taxi') { enterTaxi(near.i); return; }
    if (near.kind === 'stand') {
      const stand = TAXI_STANDS[near.id];
      const i = traffic ? traffic.callTaxi(stand) : -1;
      opts.onInteract?.('stand', near.id, { near: true, ok: i >= 0 });
      return;
    }
    opts.onInteract?.(near.kind, near.id, { near: true, n: near.n || 0 });
  }

  // ---- remote avatars -----------------------------------------------------------------------
  const remotes = new Map();
  const remoteCars = [];
  function remoteFor(id) { return remotes.get(id)?.av || null; }
  function syncRemotes(dt, t) {
    remoteCars.length = 0;
    if (!net?.peers) { traffic?.setRemoteTaxis(remoteCars); return; }
    const seen = new Set();
    for (const [id, peer] of net.peers) {
      if (!peer || id === net.id) continue;
      const s = net.sample(peer);
      if (!s || s.x == null || s.y == null) continue;
      const x = fromNetUnits(s.x), z = fromNetUnits(s.y);
      const BB = LAYOUT.bounds;
      if (!Number.isFinite(x) || !Number.isFinite(z) || x < BB.x0 - 100 || x > BB.x1 + 100 || z < BB.z0 - 100 || z > BB.z1 + 100) continue;
      seen.add(id);
      const col = COLOR_RE.test(peer.outfit || '') ? peer.outfit : colorFor(id);
      const kind = speciesId(peer.av);
      let r = remotes.get(id);
      if (!r) {
        r = { av: avatars.create({ id, name: chars(peer.name || '익명', 12), color: col, species: kind }), x, z, y: groundHeight(x, z), yaw: 0, spd: 0 };
        remotes.set(id, r);
      }
      r.av.setSpecies(kind);
      r.av.setName(chars(peer.name || '익명', 12));
      r.av.setColor(col);
      const px = r.x, pz = r.z;
      const wishX = (Number(s.vx) || 0) / 20, wishZ = (Number(s.vy) || 0) / 20, wish = Math.hypot(wishX, wishZ);
      const err = Math.hypot(x - r.x, z - r.z);
      if (err > 18) { r.x = x; r.z = z; }
      else {
        const k = 1 - Math.exp(-dt * (err > 2.5 ? 2.2 : 8));
        r.x += (x - r.x) * k; r.z += (z - r.z) * k;
      }
      const movedX = (r.x - px) / Math.max(dt, 1e-3), movedZ = (r.z - pz) / Math.max(dt, 1e-3);
      const sp = Math.min(9, wish > 0.25 ? wish : Math.hypot(movedX, movedZ));
      r.spd += (sp - r.spd) * (1 - Math.exp(-dt * 4));
      r.y += (groundHeight(r.x, r.z) - r.y) * (1 - Math.exp(-dt * 12));
      const inCar = peer.equip === 'taxi';
      const face = Number(s.face) * DEG;
      let want = r.yaw;
      if (wish > 0.35) want = Math.atan2(wishX, wishZ);
      else if (r.spd > 0.5) want = Math.atan2(movedX, movedZ);
      else if (s.anim === 'sit') want = 0;
      else if (Number.isFinite(face)) want = face;
      if (inCar && Number.isFinite(face) && Math.cos(want - face) < 0) want = face;
      r.yaw = dampAngle(r.yaw, want, 9, dt);
      r.av.holder.visible = !inCar;
      r.av.root.position.set(r.x, r.y, r.z);
      r.av.holder.rotation.y = r.yaw;
      r.av.setMotion(inCar ? 0 : Math.min(r.spd, 9), !inCar && s.anim === 'sit' && r.spd < 0.3);
      r.av.update(dt, t);
      if (inCar) remoteCars.push({ x: r.x, z: r.z, yaw: r.yaw, v: r.spd });
    }
    for (const [id, r] of remotes) if (!seen.has(id)) { r.av.dispose(); remotes.delete(id); }
    traffic?.setRemoteTaxis(remoteCars);
  }
  if (net) {
    net.on?.('emoji', (p) => {
      if (!p || p.replay) return;
      const av = remoteFor(p.id);
      const e = EMOTES[p.e];
      if (!av || !e) return;
      av.emote(e.anim, e.hold);
      av.say(e.glyph);
      if (p.e === 2) { const r = remotes.get(p.id); launch(r.x, r.z, r.y + 9, PALETTE[(Math.random() * PALETTE.length) | 0], 0.25); }
    });
    net.on?.('jump', (p) => { remoteFor(p?.id)?.emote('Jump'); });
    net.onWorldUpdate?.((ev) => {
      if (!ev?.data) return;
      if (ev.kind === 'BILLBOARD') {
        const old = boards.get(ev.data.slot_id)?.data;
        const photoOnly = old && old.holder_id === ev.data.holder_id && String(old.expires_at) === String(ev.data.expires_at);
        updateBillboardTexture(ev.data.slot_id, ev.data, !ev.replay && (!photoOnly || (ev.data.photo_status === 'approved' && old.photo_status !== 'approved')));
      }
      else if (ev.kind === 'PLOT') applyPlot(ev.data, !ev.replay);
    });
  }

  // ---- stars ---------------------------------------------------------------------------------
  const stars = new Map();
  const starGeo = new THREE.OctahedronGeometry(0.42, 0);
  const starMat = new THREE.MeshStandardMaterial({ color: '#ffd56a', emissive: '#ffb020', emissiveIntensity: 2, metalness: 0.8, roughness: 0.2 });
  const starBeamTex = new THREE.CanvasTexture(paintGlow(makeCanvas(64, 64)));
  const starBeamGeo = new THREE.CylinderGeometry(0.12, 0.3, 16, 12, 1, true).translate(0, 8, 0);
  const starBeamMat = new THREE.MeshBasicMaterial({ map: starBeamTex, color: new THREE.Color(1.1, 0.8, 0.22), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  function startStars(list) {
    clearStars();
    const now = performance.now();
    for (const s of list) {
      const g = new THREE.Group();
      const gem = new THREE.Mesh(starGeo, starMat);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: new THREE.Color(1.3, 0.9, 0.26), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.set(1.5, 1.5, 1);
      halo.layers.set(2);
      const beam = new THREE.Mesh(starBeamGeo, starBeamMat);
      beam.visible = false;
      beam.layers.enable(0);
      const pad = new THREE.Mesh(new THREE.RingGeometry(1.15, BALANCE.starR, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffcf5a, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
      pad.visible = false;
      g.add(gem, halo, beam, pad);
      g.visible = false;
      scene.add(g);
      stars.set(s.i, { ...s, g, gem, halo, beam, pad, born: now + (s.delay || 0), touched: 0 });
    }
  }
  function removeStar(i, mine) {
    const s = stars.get(i);
    if (!s) return false;
    if (s.g.visible) burst(s.g.position.clone(), '#ffcf5a', mine ? 60 : 30, mine ? 0.7 : 0.45);
    scene.remove(s.g);
    s.halo.material.dispose();
    stars.delete(i);
    return true;
  }
  function clearStars() { for (const i of [...stars.keys()]) removeStar(i, false); }
  // Sidewalk coins in the bowtie, in front of the spawn. Walk over one for +1.
  const COIN_HOME = [[14, 38], [21, 44], [11, 50], [23, 56], [16, 64], [8, 47], [27, 52], [18, 74]];
  const coinMat = new THREE.MeshStandardMaterial({ color: '#ffd56a', emissive: '#ffb020', emissiveIntensity: 1.4, metalness: 0.85, roughness: 0.25 });
  const coinGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.08, 16);
  const coins = COIN_HOME.map(([x, z], i) => {
    const mesh = new THREE.Mesh(coinGeo, coinMat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, 0.9, z);
    scene.add(mesh);
    return { i, x, z, mesh, back: 0 };
  });
  function removeCoin(i) {
    const c = coins[i];
    if (!c || !c.mesh.visible) return;
    c.mesh.visible = false;
    c.back = performance.now() + 20000;
  }
  const STUNTS = [
    { x: 16, z: 52 },
    { x: 16, z: 90 },
  ];
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffcf5a' });
  for (const s of STUNTS) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.16, 10, 28), ringMat);
    ring.position.set(s.x, 2.3, s.z);
    scene.add(ring);
    s.ry = ring;
    s.inside = false;
  }
  let balloon = null;
  const pouchThrows = [];
  const WISH_LINES = [
    '복주머니가 열렸어요. 올해 소원, 이루어지세요.',
    '금복이 터졌어요. 바라는 일이 당신 쪽으로 옵니다.',
    '주머니 속 소원이 하늘로 올라갔어요. 지금 빈 마음이면 닿습니다.',
    '붉은 복이 쏟아졌어요. 이름 석 자가 빛나는 해가 옵니다.',
    '던져 연 복주머니입니다. 전광판에 걸린 소원도 같이 열리세요.',
  ];
  let pouchMat = null;
  function pouchMaterial() {
    if (pouchMat) return pouchMat;
    const map = new THREE.TextureLoader(manager).load('/icons/bokjumeoni.png');
    map.colorSpace = THREE.SRGBColorSpace;
    pouchMat = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, alphaTest: 0.12 });
    return pouchMat;
  }
  function makePouch(size) {
    const s = new THREE.Sprite(pouchMaterial());
    s.scale.set(size, size, 1);
    return s;
  }
  function popBalloon() {
    if (!balloon || balloon.hp < 0) return;
    balloon.hp = -1;
    balloon.next = performance.now() + 25000;
    const p = balloon.mesh.position.clone();
    for (const t of pouchThrows) scene.remove(t.mesh);
    pouchThrows.length = 0;
    burst(p, '#ff3d4a', 120, 1.8);
    burst(p, '#ffcf5a', 90, 1.4);
    burst(p, '#fff6d0', 60, 1);
    for (let i = 1; i <= 5; i++) setTimeout(() => burst(p.clone().setY(p.y - i * 9), i % 2 ? '#ffcf5a' : '#ff3d9a', 48, 1.2), i * 140);
    scene.remove(balloon.mesh);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const x = p.x + Math.cos(a) * 7, z = p.z + Math.sin(a) * 7;
      const mesh = new THREE.Mesh(coinGeo, coinMat);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(x, 1.2, z);
      scene.add(mesh);
      coins.push({ i: coins.length, x, z, mesh, back: 0 });
    }
    opts.onBalloon?.(0, 25000);
    opts.onWish?.(WISH_LINES[(Math.random() * WISH_LINES.length) | 0]);
  }
  function hitBalloon() {
    if (!balloon || balloon.hp <= 0) return;
    balloon.hp -= 10;
    const s = 16 + 12 * (Math.max(0, balloon.hp) / 1000);
    balloon.mesh.scale.set(s, s, 1);
    opts.onBalloon?.(balloon.hp);
    if (balloon.hp <= 0) popBalloon();
  }
  function throwPouch() {
    if (!balloon || balloon.hp <= 0) return false;
    const from = new THREE.Vector3(pos.x, (pos.y || 0) + 1.5, pos.z);
    const mesh = makePouch(1.8);
    mesh.position.copy(from);
    scene.add(mesh);
    pouchThrows.push({ mesh, from, t: 0 });
    me?.emote?.('Throw');
    return true;
  }
  function updateThrows(dt) {
    for (let i = pouchThrows.length - 1; i >= 0; i--) {
      const p = pouchThrows[i];
      p.t += dt / 0.65;
      const u = Math.min(1, p.t);
      const target = balloon?.mesh?.position || p.from;
      p.mesh.position.lerpVectors(p.from, target, u);
      p.mesh.position.y += Math.sin(u * Math.PI) * 8;
      if (u < 1) continue;
      scene.remove(p.mesh);
      pouchThrows.splice(i, 1);
      hitBalloon();
    }
  }
  function ensureBalloon(now) {
    if (balloon && balloon.hp > 0) return;
    if (balloon && now < (balloon.next || 0)) return;
    if (balloon?.mesh) scene.remove(balloon.mesh);
    const mesh = makePouch(22);
    mesh.position.set(16, 58, 42);
    scene.add(mesh);
    balloon = { hp: 1000, mesh, next: 0 };
    opts.onBalloon?.(1000);
  }
  function updateCoins(now, t) {
    for (const c of coins) {
      if (!c.mesh.visible) {
        if (c.back && now >= c.back) { c.mesh.visible = true; c.back = 0; }
        continue;
      }
      const gy = groundHeight(c.x, c.z) + 0.85 + Math.sin(t * 2.2 + c.i) * 0.12;
      c.mesh.position.y = gy;
      c.mesh.rotation.z = t * 1.4;
      if (drive) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z;
      if (dx * dx + dz * dz < BALANCE.coinR * BALANCE.coinR) opts.onCoin?.(c.i);
    }
  }
  function updateStars(now, t) {
    for (const s of stars.values()) {
      const u = (now - s.born) / 1800;
      if (u < 0) continue;
      s.g.visible = true;
      const gy = groundHeight(s.x, s.z) + 0.95;
      const landed = u >= 1;
      const y = landed ? gy + Math.sin(t * 2.2 + s.i) * 0.14 : 34 + (gy - 34) * u * u;
      s.g.position.set(s.x + (landed ? 0 : (s.drift || 0) * (1 - u)), y, s.z);
      s.gem.rotation.y = t * 2.4;
      s.gem.rotation.x = Math.sin(t + s.i) * 0.3;
      s.beam.visible = landed;
      s.beam.position.y = -0.95;
      s.pad.visible = landed;
      s.pad.position.y = gy - y;
      if (landed && !drive) {
        const dx = pos.x - s.x, dz = pos.z - s.z;
        if (dx * dx + dz * dz < BALANCE.starR * BALANCE.starR) opts.onStarTouch?.(s.i);
      }
    }
  }

  // ---- billboards / plots API -----------------------------------------------------------------------
  function updateBillboardTexture(slotId, data, celebrate = true) {
    if (!slotId) return false;
    const changed = boards.set(slotId, data, celebrate);
    if (changed) refreshLightColors();
    return changed;
  }
  function applyPlot(data, celebrate = true) {
    if (!marks) { if (data?.plot_id) pendingPlots.push(data); return false; }
    const res = marks.applyPlot(data);
    if (!res) return false;
    const slotId = 'PLOT_' + res.rec.id;
    boards.ensure(slotId);
    if (celebrate && res.changed) {
      const slot = PLOT_SLOTS[res.rec.id - 1];
      const top = (res.rec.level >= 4 ? 19 : res.rec.level >= 3 ? 7 : 3.4) * (slot.scale || 1);
      burst(new THREE.Vector3(slot.x, top, slot.z), res.rec.color, 80, 1);
      launch(slot.x + Math.sin(slot.rot) * 6, slot.z + Math.cos(slot.rot) * 6, top + 8, res.rec.color, 0.2);
    }
    return true;
  }
  const chainMarks = new Map();
  function chainMark(title) {
    const g = new THREE.Group();
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#14081c'; ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#ffcf5a'; ctx.lineWidth = 8; ctx.strokeRect(10, 10, 492, 108);
    ctx.fillStyle = '#ffe9a0'; ctx.font = '700 40px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(title.slice(0, 18), 256, 64);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sign.scale.set(12, 3, 1); sign.position.y = 8;
    const pole = new THREE.MeshBasicMaterial({ color: 0x3fe6ff });
    for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.35, 14, 0.35), pole);
      box.position.set(x, 0, z);
      g.add(box);
    }
    g.add(sign);
    g.userData.tex = tex;
    g.userData.title = title;
    scene.add(g);
    return g;
  }
  function syncChains(list) {
    const on = new Set();
    for (const c of chainsOf(list || [])) {
      on.add(c.id);
      let g = chainMarks.get(c.id);
      const title = `👑 ${c.name} 독점 타워`;
      if (!g) { g = chainMark(title); chainMarks.set(c.id, g); }
      else if (g.userData.title !== title) {
        const ctx = g.userData.tex.image.getContext('2d');
        ctx.fillStyle = '#14081c'; ctx.fillRect(0, 0, 512, 128);
        ctx.strokeStyle = '#ffcf5a'; ctx.lineWidth = 8; ctx.strokeRect(10, 10, 492, 108);
        ctx.fillStyle = '#ffe9a0'; ctx.font = '700 40px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(title.slice(0, 18), 256, 64);
        g.userData.tex.needsUpdate = true;
        g.userData.title = title;
      }
      const pts = c.slots.map((id) => boards.worldPos(id)).filter(Boolean);
      if (!pts.length) { g.visible = false; continue; }
      const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const z = pts.reduce((s, p) => s + p.z, 0) / pts.length;
      const y = Math.max(...pts.map((p) => p.y));
      g.position.set(x, y, z);
      g.visible = true;
    }
    for (const [id, g] of chainMarks) if (!on.has(id)) g.visible = false;
  }
  function updateWorld(state) {
    for (const row of state?.billboards || []) if (row?.slot_id && /^(MAIN_(UP|TOP|MID|BOT|LOW)|SUB_[1-4][AB]|STREET_([1-9]|[12]\d|30)|PLOT_([1-9]|1[0-8]))$/.test(row.slot_id)) updateBillboardTexture(row.slot_id, row, false);
    for (const row of state?.plots || []) if (row?.plot_id) applyPlot(row, false);
    syncChains(state?.billboards);
  }
  const lightCol = new THREE.Color();
  function refreshLightColors() {
    mainLight.color.set(boards.accentOf('MAIN_TOP'));
    westLight.color.set(boards.accentOf(low ? 'MAIN_TOP' : 'SUB_1A'));
    eastLight?.color.set(boards.accentOf('SUB_4A'));
  }
  refreshLightColors();
  if (opts.world) updateWorld(opts.world);

  // ---- environment from the real photos ------------------------------------------------------------
  function buildPhotoEnv() {
    const T = tsq?.photoTextures;
    if (!T) return;
    const ok = (t) => t?.image && (t.image.width || t.image.naturalWidth);
    if (!['night-canyon', 'night-steps', 'night-2025', 'night-pano'].every(k => ok(T[k]))) return;
    const env = new THREE.Scene();
    const mat = (t, k = 1) => new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, color: new THREE.Color(k, k, k) });
    const box = new THREE.Mesh(new THREE.BoxGeometry(100, 50, 100), [
      mat(T['night-2025'], 1.1), mat(T['night-pano'], 1.1),
      new THREE.MeshBasicMaterial({ color: '#070917', side: THREE.BackSide }),
      new THREE.MeshBasicMaterial({ color: '#15131b', side: THREE.BackSide }),
      mat(T['night-steps'], 1.1), mat(T['night-canyon'], 1.1),
    ]);
    box.position.y = 18;
    env.add(box);
    const next = pmrem.fromScene(env, 0.035);
    envRT.dispose();
    envRT = next;
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.8;
    box.geometry.dispose();
    box.material.forEach(m => m.dispose());
  }
  // Ready once the city is built and every texture it queued has arrived (or after a grace period).
  let readyFired = false, mgrIdle = false;
  function maybeReady(force) {
    if (readyFired || (!force && (!world || !mgrIdle))) return;
    readyFired = true;
    buildPhotoEnv();
    opts.onProgress?.(1);
    opts.onReady?.();
  }
  manager.onStart = () => { mgrIdle = false; };
  manager.onLoad = () => { mgrIdle = true; if (readyFired) buildPhotoEnv(); else maybeReady(); };
  setTimeout(() => maybeReady(!!world), 20000);
  setTimeout(() => maybeReady(true), 40000);
  fontsReady().then(() => {
    boards.repaintAll();
    me.paintTag();
    for (const r of remotes.values()) r.av.paintTag();
  });

  // ---- frame update -----------------------------------------------------------------------------------
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), wish = new THREE.Vector3();
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), prevFollow = new THREE.Vector3(), dir = new THREE.Vector3(), hitP = new THREE.Vector3();
  const look = new THREE.Vector3(), off = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const camRay = new THREE.Ray();
  const playerInfo = { x: pos.x, y: pos.y, z: pos.z, yaw, driving: false };
  let clockT = 0;

  function readInput() {
    if (!inputEnabled) return { f: 0, r: 0, walk: false, joy: false };
    let f = 0, r = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) r += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) r -= 1;
    const usingJoy = Math.hypot(joy.x, joy.y) > 0.08;
    if (usingJoy) { r += joy.x; f -= joy.y; }
    return { f: clamp(f, -1, 1), r: clamp(r, -1, 1), walk: keys.has('ShiftLeft') || keys.has('ShiftRight'), joy: usingJoy };
  }

  function stepWalk(dt, input) {
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    right.set(-fwd.z, 0, fwd.x);
    wish.set(0, 0, 0).addScaledVector(fwd, input.f).addScaledVector(right, input.r);
    const mag = Math.min(1, wish.length());
    if (mag > 1e-4) wish.normalize();
    const top = input.walk ? WALK : input.joy ? WALK + (RUN - WALK) * clamp((mag - 0.45) / 0.45, 0, 1) : RUN;
    const moving = mag > 0.08;
    const k = 1 - Math.exp(-dt * (moving ? 10 : 13));
    vel.x += ((moving ? wish.x * top : 0) - vel.x) * k;
    vel.z += ((moving ? wish.z * top : 0) - vel.z) * k;
    const [nx, nz] = collide(pos.x + vel.x * dt, pos.z + vel.z * dt, RADIUS, false);
    const actual = Math.hypot(nx - pos.x, nz - pos.z) / Math.max(dt, 1e-4);
    pos.x = nx;
    pos.z = nz;
    pos.y += (groundHeight(pos.x, pos.z) - pos.y) * (1 - Math.exp(-dt * 16));
    animSpeed += (Math.min(actual, top + 0.5) - animSpeed) * (1 - Math.exp(-dt * 12));
    if (Math.hypot(vel.x, vel.z) > 0.3 && moving) { yaw = dampAngle(yaw, Math.atan2(vel.x, vel.z), 13, dt); if (dancing) setDancing(false); }
    if (onStairs(pos.x, pos.z) && !moving && animSpeed < 0.2) sitTimer += dt; else sitTimer = 0;
    const sitting = sitTimer > 1.2 && !dancing;
    if (sitting) yaw = dampAngle(yaw, 0, 5, dt);
    me.root.position.copy(pos);
    me.holder.rotation.y = yaw;
    me.setMotion(animSpeed, sitting);
    return sitting;
  }

  function stepDrive(dt, input, t) {
    const d = drive;
    const party = feverLive();
    const boosting = party || input.walk || boostHeld;
    if (boosting && d.v > 8 && t - boostSnd > 1.4) { boostSnd = t; opts.onBoost?.(); }
    const top = party ? 52 : (boosting ? CAR.boost : CAR.max);
    if (input.f > 0.1) d.v = Math.min(top, d.v + (d.v < 0 ? CAR.brake : CAR.accel) * input.f * dt);
    else if (input.f < -0.1) d.v = Math.max(-CAR.reverse, d.v - (d.v > 0 ? CAR.brake : CAR.accel * 0.6) * -input.f * dt);
    else d.v -= Math.sign(d.v) * Math.min(Math.abs(d.v), CAR.drag * dt);
    if (d.v > top) d.v = Math.max(top, d.v - CAR.brake * dt);
    d.steer += (-input.r - d.steer) * (1 - Math.exp(-dt * 8));
    const steerV = Math.abs(d.v) < 1.6 ? (d.v < 0 ? -1.6 : 1.6) : d.v;
    d.yaw = wrapAngle(d.yaw + d.steer * CAR.steer * clamp(steerV / 7, -1, 1) * dt);
    const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw);
    const impactSpeed = d.v;
    const travel = d.v * dt, steps = Math.max(1, Math.ceil(Math.abs(travel) / 0.35));
    let cx = d.x, cz = d.z, blocked = 0;
    for (let k = 0; k < steps; k++) {
      const step = travel / steps;
      let nx = cx + fx * step, nz = cz + fz * step;
      const [ax, az] = collide(nx, nz, 0.82, true);
      const pdx = ax - nx, pdz = az - nz, push = Math.hypot(pdx, pdz);
      if (push > 0.004) {
        const ndx = pdx / push, ndz = pdz / push, into = fx * ndx + fz * ndz;
        if (into < -0.12) {
          const sx = fx - ndx * into, sz = fz - ndz * into, sl = Math.hypot(sx, sz) || 1;
          const [bx, bz] = collide(cx + (sx / sl) * step, cz + (sz / sl) * step, 0.82, true);
          nx = bx; nz = bz;
        } else { nx = ax; nz = az; }
        blocked = Math.max(blocked, push);
      }
      cx = nx; cz = nz;
    }
    const held = Math.hypot(cx - d.x, cz - d.z);
    const hitX = cx, hitZ = cz;
    if (blocked > 0.04 && Math.abs(input.f) > 0.15) {
      const hit = nyc?.nearestRoad?.(cx, cz, 16);
      if (hit && hit.d > 0.3 && hit.d < 10) {
        const [rx, rz] = collide(cx + (hit.px - cx) * 0.4, cz + (hit.pz - cz) * 0.4, 0.7, true);
        cx = rx; cz = rz;
      }
      d.v *= 0.94;
      if (Math.abs(d.v) > 4 && t - lastBump > 0.6) { lastBump = t; opts.onBump?.(); }
    } else if (blocked > 0.25) d.v *= 0.82;
    const moved = Math.hypot(cx - d.x, cz - d.z);
    d.odo += moved;
    d.fare = 3 + Math.floor(d.odo / 64) * 0.7;
    vel.set((cx - d.x) / Math.max(dt, 1e-4), 0, (cz - d.z) / Math.max(dt, 1e-4));
    d.x = cx;
    d.z = cz;
    d.y += (groundHeight(cx, cz) - d.y) * (1 - Math.exp(-dt * 10));
    traffic?.driveTaxi(d.i, d.x, d.z, d.yaw, d.v, d.y);
    maybeDetach(t, { blocked, intend: travel, moved, held, speed: impactSpeed, x: hitX, z: hitZ });
    pos.set(d.x, d.y, d.z);
    yaw = d.yaw;
    animSpeed = Math.abs(d.v);
    const fov = baseFov + clamp(Math.abs(d.v) / 30, 0, 1) * 10;
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * 4)); camera.updateProjectionMatrix(); }
    updateJob(t);
  }

  function slotPose(slotId, dist) {
    const p = boards.worldPos(slotId);
    if (!p) return null;
    const screen = boards.get(slotId)?.mounts[0]?.screen;
    const q = new THREE.Quaternion();
    if (screen) screen.getWorldQuaternion(q);
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    f.y = 0;
    if (f.lengthSq() < 1e-4) f.set(0, 0, 1);
    f.normalize();
    const look = p.clone();
    const cam = p.clone().addScaledVector(f, dist);
    cam.y = Math.max(look.y * 0.42 + 1.8, groundHeight(cam.x, cam.z) + 1.6);
    return { look, cam, front: { x: p.x + f.x * 9, z: p.z + f.z * 9 }, board: boards.get(slotId)?.data || null, slot: slotId };
  }
  const AD_IDS = ['MAIN_TOP', 'MAIN_MID', 'MAIN_BOT', 'SUB_1A', 'SUB_1B', 'SUB_2A', 'SUB_2B', 'SUB_3A', 'SUB_3B', 'SUB_4A', 'SUB_4B'];
  for (let i = 1; i <= 30; i++) AD_IDS.push('STREET_' + i);
  for (let i = 1; i <= 18; i++) AD_IDS.push('PLOT_' + i);
  const crown = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 1.4, 90, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffcf5a, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 48;
  const hat = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.22, 8, 20), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
  hat.rotation.x = Math.PI / 2;
  hat.position.y = 3.2;
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), new THREE.MeshBasicMaterial({ color: 0xfff6c8 }));
  gem.position.y = 4.6;
  crown.add(beam, hat, gem);
  crown.visible = false;
  scene.add(crown);
  let crownAt = 0;
  function placeCrown() {
    let best = '', score = 0;
    for (const id of AD_IDS) {
      const d = boards.get(id)?.data;
      if (!d?.holder_id) continue;
      const s = (Number(d.views) || 0) + (Number(d.cheers) || 0);
      if (s > score) { score = s; best = id; }
    }
    const p = best ? boards.worldPos(best) : null;
    crown.visible = !!p;
    if (p) crown.position.set(p.x, p.y + 1.5, p.z);
  }
  function topTeam() {
    const map = new Map();
    const re = /#[0-9A-Za-z가-힣_]{1,16}/g;
    for (const id of AD_IDS) {
      const d = boards.get(id)?.data;
      if (!d?.holder_id) continue;
      const tags = new Set([d.line1, d.line2, d.line3, d.holder_name].join(' ').match(re) || []);
      const s = (Number(d.views) || 0) + (Number(d.cheers) || 0);
      for (const tag of tags) map.set(tag, (map.get(tag) || 0) + s);
    }
    let best = '', n = 0;
    for (const [tag, s] of map) if (s > n) { best = tag; n = s; }
    return best;
  }
  function giftPop(slotId) {
    const pose = slotPose(slotId, 18);
    if (!pose) return;
    ['#ffcf5a', '#ff3d9a', '#39f58a', '#b84dff'].forEach((hex, i) => {
      setTimeout(() => {
        burst(pose.look.clone(), hex, 100, 1.3);
        launch(pose.front.x + (i - 1.5) * 3, pose.front.z, pose.look.y + 8, hex, 0);
      }, i * 700);
    });
  }
  function pickBoardDrop() {
    const owned = new Set();
    for (const c of chainsOf(AD_IDS.map((id) => boards.get(id)?.data).filter(Boolean))) for (const id of c.slots) owned.add(id);
    const pool = [];
    for (const id of AD_IDS) for (let i = 0; i < (owned.has(id) ? 5 : 2); i++) pool.push(id);
    for (let n = 0; n < 10; n++) {
      const pose = slotPose(pool[(Math.random() * pool.length) | 0], 12);
      if (pose && insideLoop(pose.front.x, pose.front.z, 4)) return { point: pose.front, slot: pose.slot, board: pose.board };
    }
    return { point: pickSpot(70, 200, { x: pos.x, z: pos.z }), slot: '', board: null };
  }
  function playIntroSweep() {
    const pose = slotPose('MAIN_TOP', 28);
    cineFrom.copy(pose?.cam || new THREE.Vector3(LAYOUT.oneTimes.x, 42, LAYOUT.oneTimes.z + 30));
    cineL0.copy(pose?.look || new THREE.Vector3(LAYOUT.oneTimes.x, 26, LAYOUT.oneTimes.z));
    cine = { t0: performance.now(), dur: 2200, hold: false, locked: false };
  }
  function clearCine() {
    const had = !!cine || !me.root.visible;
    cine = null;
    if (lounge) { lounge = false; opts.onLoungeEnd?.(); }
    if (!drive) me.root.visible = true;
    if (had) opts.onFocus?.(false);
  }
  function focusSlot(slotId, holdMs = 0) {
    const pose = slotPose(slotId, 18);
    if (!pose) return null;
    cineFrom.copy(camera.position);
    cineL0.copy(controls.target);
    cineTo.copy(pose.cam);
    cineL1.copy(pose.look);
    cine = { t0: performance.now(), dur: 700, hold: !holdMs, locked: true, until: holdMs ? performance.now() + holdMs : 0 };
    if (!lounge) {
      const here = camera.position.clone().lerp(pose.look, 0.35);
      burst(here, '#ffcf5a', 90, 1.4);
      burst(pose.look, '#ff3d9a', 80, 1);
      launch(pose.front.x, pose.front.z, pose.look.y, '#ffcf5a', 0.05);
    }
    opts.onFocus?.(true);
    return pose;
  }
  function frameBillboard(slotId) {
    const pose = slotPose(slotId, 10);
    if (!pose) return false;
    const dir = pose.cam.clone().sub(pose.look);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const cam = pose.look.clone().addScaledVector(dir, 8);
    cineFrom.copy(cam);
    cineTo.copy(cam);
    cineL0.copy(pose.look);
    cineL1.copy(pose.look);
    cine = { t0: performance.now(), dur: 1, hold: true, locked: true, until: 0 };
    camera.position.copy(cam);
    controls.target.copy(pose.look);
    camera.lookAt(pose.look);
    camWant.copy(cam);
    me.root.visible = false;
    opts.onFocus?.(true);
    return true;
  }
  function taxiCanSit(x, z) {
    if (!nyc || !insideLoop(x, z, 6) || !nyc.onLand(x, z) || nyc.buildingAt(x, z) >= 0) return false;
    nyc.ensureSolid(x, z, 36);
    const [cx, cz] = collide(x, z, 0.9, false);
    return Math.hypot(cx - x, cz - z) < 0.45;
  }
  function taxiSpotNear(x, z) {
    if (!nyc) return null;
    const filters = [
      (r) => nyc.roads.cls[r] >= ROAD.PRIMARY && nyc.roads.cls[r] <= ROAD.STREET,
      (r) => nyc.roads.cls[r] !== ROAD.PEDESTRIAN,
    ];
    for (const filter of filters) {
      const hit = nyc.nearestRoad(x, z, 56, filter);
      if (!hit) continue;
      const tryAt = (px, pz) => (taxiCanSit(px, pz) ? { x: px, z: pz } : null);
      for (const side of [1.8, -1.8, 3.4, -3.4]) {
        const p = tryAt(hit.px - hit.fz * side, hit.pz + hit.fx * side);
        if (p) return p;
      }
      for (const along of [12, -12, 26, -26, 42, -42]) {
        for (const side of [1.8, -1.8]) {
          const p = tryAt(hit.px + hit.fx * along - hit.fz * side, hit.pz + hit.fz * along + hit.fx * side);
          if (p) return p;
        }
      }
    }
    return null;
  }
  function placeAhead(d, dist) {
    for (const extra of [0, 28, 56, 90]) {
      const spot = taxiSpotNear(d.x + Math.sin(d.yaw) * (dist + extra), d.z + Math.cos(d.yaw) * (dist + extra));
      if (spot && Math.hypot(spot.x - d.x, spot.z - d.z) >= 18) return spot;
    }
    return taxiSpotNear(d.x + Math.sin(d.yaw) * dist, d.z + Math.cos(d.yaw) * dist)
      || { x: d.x + Math.sin(d.yaw) * dist, z: d.z + Math.cos(d.yaw) * dist };
  }
  function clearRide() {
    job.phase = 'none';
    job.riders = 0;
    job.extra = null;
    job.target = null;
    job.dest = null;
    markers.pickup.set(null);
    markers.drop.set(null);
    showPassenger(null);
    syncTrailers();
  }
  function offerExtra(d, t) {
    if (job.riders >= 5 || job.extra || t < (job.extraAt || 0)) return;
    let spot = placeAhead(d, 34 + job.riders * 7);
    if (job.dest && Math.hypot(spot.x - job.dest.x, spot.z - job.dest.z) < 18) {
      const road = taxiSpotNear(spot.x + Math.cos(d.yaw) * 22, spot.z - Math.sin(d.yaw) * 22);
      if (road) spot = road;
    }
    job.extra = spot;
    job.extraReach = Math.hypot(d.x - spot.x, d.z - spot.z);
    markers.pickup.set(spot);
    showPassenger(spot);
  }
  function boardExtra(t) {
    job.riders = Math.min(5, (job.riders || 1) + 1);
    job.extra = null;
    job.extraAt = t + 1.6;
    markers.pickup.set(null);
    showPassenger(null);
    syncTrailers();
    opts.onJob?.({ type: 'chain', riders: job.riders, mult: taxiTrainMult(job.riders) });
  }
  function updateJob(t) {
    const d = drive;
    if (job.phase === 'none' && t >= job.nextAt) {
      job.riders = 0;
      job.extra = null;
      job.target = placeAhead(d, 38);
      job.reach = Math.hypot(d.x - job.target.x, d.z - job.target.z);
      job.phase = 'pickup';
      markers.pickup.set(job.target);
      showPassenger(job.target);
      opts.onJob?.({ type: 'offer' });
    } else if (job.phase === 'pickup') {
      const pd = Math.hypot(d.x - job.target.x, d.z - job.target.z);
      if (pd < 8 && pd + 10 < job.reach && Math.abs(d.v) < 12) {
        markers.pickup.set(null);
        showPassenger(null);
        const drop = pickBoardDrop();
        const curb = drop.point ? taxiSpotNear(drop.point.x, drop.point.z) : null;
        job.dest = curb && Math.hypot(curb.x - d.x, curb.z - d.z) >= 30 ? curb : placeAhead(d, 85);
        job.dropReach = Math.hypot(d.x - job.dest.x, d.z - job.dest.z);
        job.slot = drop.slot;
        job.board = drop.board;
        job.limit = 150;
        job.t0 = t;
        job.riders = 1;
        job.extra = null;
        job.extraAt = t + 2;
        job.phase = 'ride';
        markers.drop.set(job.dest);
        syncTrailers();
        opts.onJob?.({ type: 'board', limit: job.limit, slot: job.slot, riders: 1, mult: 1, title: drop.slot ? `노란 기둥 · ${slotName(drop.slot)} 앞에서 속도를 줄이세요` : '노란 기둥까지 가서 속도를 줄이세요' });
      }
    } else if (job.phase === 'ride') {
      offerExtra(d, t);
      if (job.extra) {
        const pd = Math.hypot(d.x - job.extra.x, d.z - job.extra.z);
        if (pd < 8 && pd + 10 < (job.extraReach || 0) && Math.abs(d.v) < 12) boardExtra(t);
      }
      const left = job.limit - (t - job.t0);
      const dd = job.dest ? Math.hypot(d.x - job.dest.x, d.z - job.dest.z) : 999;
      if (left <= 0) {
        clearRide();
        job.nextAt = t + 3;
        opts.onJob?.({ type: 'fail' });
      } else if (dd < 12 && dd + 12 < (job.dropReach || 0) && Math.abs(d.v) < 12) {
        const fare = clamp(Math.round(6 + 9 * left / job.limit), 6, 15);
        const riders = job.riders || 1;
        const slot = job.slot;
        const board = job.board;
        clearRide();
        job.nextAt = t + 2.5;
        bumpFever('drop');
        opts.onJob?.({ type: 'done', fare, riders, mult: taxiTrainMult(riders), slot, board, at: screenOf(tmp.set(d.x, 2.4, d.z)) });
      }
    }
  }

  function step(dt, t, now) {
    clockT = t;
    screenTime.value = t;
    const input = readInput();
    let sitting = false;
    if (drive) stepDrive(dt, input, t);
    else sitting = stepWalk(dt, input);
    for (const s of STUNTS) {
      const nearRing = Math.hypot(pos.x - s.ry.position.x, pos.z - s.ry.position.z) < 1.7;
      if (nearRing && !s.inside) {
        s.inside = true;
        shake = 0.35;
        burst(s.ry.position.clone(), '#ffcf5a', 28, 0.6);
        opts.onStunt?.();
      } else if (!nearRing) s.inside = false;
    }
    if (drive) {
      if (performance.now() - hiveAt > 5000) {
        for (const c of traffic?.positions?.() || []) {
          if (c.mode === 'driven') continue;
          if (Math.hypot(c.x - drive.x, c.z - drive.z) < 3.5) { hiveAt = performance.now(); opts.onHive?.(); break; }
        }
      }
    }
    ensureBalloon(performance.now());
    updateThrows(dt);
    if (balloon && balloon.hp > 0) {
      balloon.mesh.position.y = 58 + Math.sin(t * 0.6) * 1.6;
    }
    if (lounge && (keys.size || Math.hypot(joy.x, joy.y) > 0.25)) clearCine();
    else if (lounge && performance.now() - loungeAt > 8000) {
      loungeAt = performance.now();
      const ids = ['MAIN_TOP', 'MAIN_MID', 'MAIN_BOT', 'SUB_1A', 'SUB_2A', 'SUB_3A', 'SUB_4A'];
      focusSlot(ids[loungeI++ % ids.length], 7600);
    }
    if (!drive) me.update(dt, t);
    playerInfo.x = pos.x; playerInfo.y = pos.y; playerInfo.z = pos.z; playerInfo.yaw = yaw; playerInfo.driving = !!drive;

    // Network projection: meters → wire units (5 cm grid). Never read back into the local player.
    netState.x = toNetUnits(pos.x);
    netState.y = toNetUnits(pos.z);
    netState.vx = Math.round(vel.x * 20);
    netState.vy = Math.round(vel.z * 20);
    netState.face = String(Math.round(yaw / DEG / 15) * 15);
    netState.anim = sitting ? 'sit' : animSpeed > 0.35 ? 'walk' : 'idle';
    netState.name = name;
    netState.outfit = color;
    netState.av = species;
    if (net) { try { net.tick(netState); } catch { /* transport hiccup */ } }
    if (dancing && now - danceAt > 6000) { danceAt = now; try { net?.sendEmoji?.(4); } catch { /* offline */ } }

    // Camera: OrbitControls drives a wanted orbit; past the floor the view tilts upward instead.
    prevFollow.copy(follow);
    tmp.set(pos.x, pos.y + eye, pos.z);
    follow.lerp(tmp, 1 - Math.exp(-dt * (drive ? 10 : 14)));
    camera.position.copy(camWant).add(tmp2.subVectors(follow, prevFollow));
    if (drive && !orbiting && now - orbitEnd > 1500 && Math.abs(drive.v) > 2) {
      off.subVectors(camera.position, follow);
      const r = off.length();
      const theta = Math.atan2(off.x, off.z);
      const phi = Math.acos(clamp(off.y / r, -1, 1));
      const want = drive.v >= 0 ? drive.yaw + Math.PI : drive.yaw;
      const nt = dampAngle(theta, want, 2.4, dt);
      const np = phi + (1.2 - phi) * (1 - Math.exp(-dt * 1.2));
      camera.position.set(follow.x + r * Math.sin(np) * Math.sin(nt), follow.y + r * Math.cos(np), follow.z + r * Math.sin(np) * Math.cos(nt));
    }
    controls.target.copy(follow);
    controls.update();
    camWant.copy(camera.position);
    off.subVectors(camWant, follow);
    const dist = off.length();
    look.copy(follow);
    if (dist > 0.01) {
      const floorY = groundHeight(camWant.x, camWant.z) + 0.35;
      const rise = follow.y - floorY;
      const phi = Math.acos(clamp(off.y / dist, -1, 1));
      const phiC = Math.PI / 2 + Math.asin(clamp(rise / dist, -1, 1));
      if (phi > phiC) {
        const hd = Math.sqrt(Math.max(0.25, dist * dist - rise * rise));
        tmp2.set(off.x, 0, off.z).normalize();
        camera.position.set(follow.x + tmp2.x * hd, floorY, follow.z + tmp2.z * hd);
        const tilt = Math.min(1.25, (phi - phiC) * 1.15);
        dir.subVectors(follow, camera.position).normalize();
        tmp2.copy(UP).addScaledVector(dir, -dir.dot(UP)).normalize();
        dir.multiplyScalar(Math.cos(tilt)).addScaledVector(tmp2, Math.sin(tilt));
        look.copy(camera.position).addScaledVector(dir, 10);
      }
      dir.subVectors(camera.position, follow);
      const dd = dir.length();
      if (dd > 0.01) {
        dir.divideScalar(dd);
        camRay.set(follow, dir);
        let best = dd;
        for (const b of blockers) {
          if (camRay.intersectBox(b, hitP)) { const d2 = hitP.distanceTo(follow); if (d2 < best) best = d2; }
        }
        if (nyc) {
          const f = nyc.rayBlock(follow.x, follow.y, follow.z, camera.position.x, camera.position.y, camera.position.z);
          if (f < 1) best = Math.min(best, f * dd);
        }
        if (best < dd) {
          const tilted = !look.equals(follow);
          const shift = tmp2.copy(look).sub(camera.position);
          camera.position.copy(follow).addScaledVector(dir, Math.max(0.7, best - 0.35));
          if (tilted) look.copy(camera.position).add(shift);
        }
      }
      const floor = groundHeight(camera.position.x, camera.position.z) + 0.3;
      if (camera.position.y < floor) camera.position.y = floor;
      camera.lookAt(look);
      me.tag.visible = camera.position.distanceTo(follow) > 2.4;
    }
    if (cine && cine.locked && me.root.visible && (keys.size || joy.x || joy.y)) clearCine();
    if (cine) {
      const u = Math.min(1, (now - cine.t0) / cine.dur);
      const e = u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2;
      if (!cine.locked) {
        cineTo.set(pos.x - Math.sin(yaw) * 8.2, pos.y + eye + 1.25, pos.z - Math.cos(yaw) * 8.2);
        cineL1.copy(follow);
      }
      look.lerpVectors(cineL0, cineL1, e);
      controls.target.copy(look);
      controls.update();
      camera.position.lerpVectors(cineFrom, cineTo, e);
      camera.lookAt(look);
      camWant.copy(camera.position);
      if ((cine.until && now >= cine.until)) {
        cine = null;
        if (!lounge) { if (!drive) me.root.visible = true; opts.onFocus?.(false); }
      } else if (u >= 1 && !cine.hold && !cine.until) clearCine();
    }
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake * 0.6;
      shake = Math.max(0, shake - dt * 1.4);
    }
    if (markers.drop.g.visible) markers.drop.ring.rotation.z += dt * 1.8;
    sky.position.copy(camera.position);
    hat.rotation.y += dt;
    gem.rotation.y += dt * 2;
    if (now - crownAt > 800) { crownAt = now; placeCrown(); }

    // Proximity prompts.
    let nk = null;
    if (!drive) {
      const S = LAYOUT.stall, A = LAYOUT.atm, G = LAYOUT.stage, spot = G.spot, F = fountainSpot();
      const front = { x: spot.x, z: G.z0 - 3.6 };
      if ((pos.x - S.x) ** 2 + (pos.z - S.z) ** 2 < BALANCE.stallR ** 2) nk = { kind: 'cart' };
      else if ((pos.x - A.x) ** 2 + (pos.z - A.z) ** 2 < A.r * A.r) nk = { kind: 'atm' };
      else if ((pos.x - spot.x) ** 2 + (pos.z - spot.z) ** 2 < BALANCE.stageR ** 2 || (pos.x - front.x) ** 2 + (pos.z - front.z) ** 2 < BALANCE.stageFrontR ** 2) nk = { kind: 'stage' };
      else if (pos.x > -34 && pos.x < -8 && pos.z > -122 && pos.z < -102) nk = { kind: 'lounge' };
      else if ((pos.x - F.x) ** 2 + (pos.z - F.z) ** 2 < 4.8 * 4.8) nk = { kind: 'fountain' };
      else {
        const parked = traffic?.nearestTaxi(pos.x, pos.z, BALANCE.taxiParkedR, true);
        if (parked) nk = { kind: 'taxi', i: parked.i };
        else {
          const si = TAXI_STANDS.findIndex(s => Math.hypot(s.x - pos.x, s.z - pos.z) < BALANCE.taxiStandR);
          if (si >= 0) {
            if (!traffic?.nearestTaxi(TAXI_STANDS[si].x, TAXI_STANDS[si].z, BALANCE.taxiStandCabR, true)) traffic?.callTaxi(TAXI_STANDS[si]);
            const cab = traffic?.nearestTaxi(TAXI_STANDS[si].x, TAXI_STANDS[si].z, BALANCE.taxiStandCabR, true);
            nk = cab ? { kind: 'taxi', i: cab.i } : { kind: 'stand', id: si };
          } else if (marks) {
            for (const slot of PLOT_SLOTS) {
              const p = marks.plotFront(slot.id, tmp);
              if ((pos.x - p.x) ** 2 + (pos.z - p.z) ** 2 < 3.6 * 3.6) { nk = { kind: 'plot', id: slot.id }; break; }
            }
          }
        }
      }
      if (!nk) {
        let mates = 0;
        if (net?.peers) {
          for (const [id, peer] of net.peers) {
            if (!peer || id === net.id) continue;
            const s = net.sample(peer);
            if (!s || s.x == null) continue;
            const x = fromNetUnits(s.x), z = fromNetUnits(s.y);
            if (Math.hypot(x - pos.x, z - pos.z) < BALANCE.cheerNear) mates++;
          }
        }
        nk = { kind: 'crowd', n: mates };
      }
    }
    const key = nk ? nk.kind + (nk.id ?? '') + (nk.i ?? '') : '';
    if (key !== lastNearKey) { lastNearKey = key; near = nk; opts.onProximity?.(nk); }
    marks?.stall.setNear(near?.kind === 'cart', t);
    marks?.stage.setNear(near?.kind === 'stage', t);
    if (waypoint && Math.hypot(pos.x - waypoint.x, pos.z - waypoint.z) < 7) setWaypoint(null);
    for (const m of Object.values(markers)) if (m.g.visible) { m.icon.position.y = 6 + Math.sin(t * 2.4) * 0.4; m.ring.scale.setScalar(1 + Math.sin(t * 3) * 0.06); }

    syncRemotes(dt, t);
    if (nyc) nyc.ensureSolid(pos.x, pos.z);
    world?.update(dt, t, camera.position);
    traffic?.update(dt, t, playerInfo);
    tsq?.update(dt, t);
    marks?.update(dt, t);
    boards.update(dt, camera.position);
    stepPlaza(dt, t);
    updateStars(now, t);
    updateCoins(now, t);

    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.delay -= dt;
      if (r.delay > 0) continue;
      if (!r.sprite) {
        r.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: new THREE.Color(r.hex).multiplyScalar(3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        r.sprite.scale.set(0.9, 0.9, 1);
        scene.add(r.sprite);
      }
      r.y += dt * 26;
      r.sprite.position.set(r.x + Math.sin(r.y) * 0.08, r.y, r.z);
      if (r.y >= r.y1) {
        scene.remove(r.sprite);
        r.sprite.material.dispose();
        burst(new THREE.Vector3(r.x, r.y1, r.z), r.hex, 80, 1.05);
        rockets.splice(i, 1);
      }
    }
    for (let i = fireworks.length - 1; i >= 0; i--) {
      const f = fireworks[i];
      f.age += dt;
      const p = f.pts.geometry.attributes.position.array, v = f.v;
      const drag = Math.exp(-dt * 1.5);
      for (let j = 0; j < p.length; j += 3) {
        v[j] *= drag; v[j + 1] = v[j + 1] * drag - 5.2 * dt; v[j + 2] *= drag;
        p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      }
      f.pts.geometry.attributes.position.needsUpdate = true;
      const u = f.age / f.life;
      f.pts.material.opacity = 1 - u * u;
      const fl = Math.min(1, f.age / 0.5);
      f.flash.scale.setScalar(f.flash.userData.max * (0.3 + fl * 0.7));
      f.flash.material.opacity = Math.max(0, 1 - fl);
      if (f.age >= f.life) dropFirework(i);
    }

    const pulse = 0.85 + Math.sin(t * 1.7) * 0.15;
    mainLight.intensity = 600 * pulse;
    lightCol.set(boards.accentOf('MAIN_TOP'));
    mainLight.color.lerp(lightCol, 0.05);
  }

  // ---- sizing / quality ---------------------------------------------------------------------------------
  let width = 1, height = 1;
  function resize() {
    const p = canvas.parentElement;
    width = Math.max(1, canvas.clientWidth || p?.clientWidth || innerWidth);
    height = Math.max(1, canvas.clientHeight || p?.clientHeight || innerHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(dpr);
    composer.setSize(width, height);
    bloom.setSize(Math.round(width * dpr * (low ? 0.5 : 0.75)), Math.round(height * dpr * (low ? 0.5 : 0.75)));
    reflection.setSize(width * dpr, height * dpr);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement || canvas);
  resize();

  let frames = 0, acc = 0, slow = 0;
  function adapt(dt) {
    frames++;
    acc += dt;
    if (acc < 2) return;
    const ms = (acc / frames) * 1000;
    frames = 0;
    acc = 0;
    if (ms > 25) slow++; else slow = Math.max(0, slow - 1);
    if (slow < 2) return;
    slow = 0;
    if (reflection.enabled) { reflection.setEnabled(false); return; }
    if (dpr > 0.8) { dpr = Math.max(0.75, dpr - 0.25); resize(); }
  }

  // ---- loop ---------------------------------------------------------------------------------------------
  const clock = new THREE.Clock();
  let running = false, raf = 0, elapsed = 0;
  function frame() {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    if (document.hidden) return;
    elapsed += dt;
    step(dt, elapsed, performance.now());
    reflection.update(scene, camera);
    composer.render();
    adapt(dt);
  }
  function start() { if (running) return; running = true; clock.getDelta(); raf = requestAnimationFrame(frame); }
  function stop() { running = false; cancelAnimationFrame(raf); }
  function dispose() {
    stop();
    ac.abort();
    ro.disconnect();
    controls.dispose();
    for (const r of remotes.values()) r.av.dispose();
    me.dispose();
    scene.traverse((o) => {
      o.geometry?.dispose?.();
      for (const m of [].concat(o.material || [])) { m.map?.dispose?.(); m.dispose?.(); }
    });
    reflection.dispose();
    envRT.dispose();
    pmrem.dispose();
    composer.dispose();
    renderer.dispose();
  }

  const projV = new THREE.Vector3();
  function screenOf(p) {
    projV.copy(p).project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (projV.x * 0.5 + 0.5) * r.width, y: r.top + (-projV.y * 0.5 + 0.5) * r.height, visible: projV.z < 1 };
  }
  function bearingTo(x, z) {
    camera.getWorldDirection(tmp);
    const camYaw = Math.atan2(tmp.x, tmp.z);
    return wrapAngle(Math.atan2(x - pos.x, z - pos.z) - camYaw);
  }
  function setWaypoint(p) {
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z) && !insideLoop(p.x, p.z, 0)) p = null;
    waypoint = p && Number.isFinite(p.x) && Number.isFinite(p.z) ? { x: p.x, z: p.z } : null;
    markers.way.set(waypoint);
    opts.onWaypoint?.(waypoint);
  }
  function setDancing(on) {
    if (on === dancing || drive) return;
    dancing = on;
    if (on) {
      me.emote('Dance', 600);
      danceAt = performance.now();
      try { net?.sendEmoji?.(4); } catch { /* offline */ }
    } else me.danceUntil = 0;
  }

  // Street names for the HUD: the street underfoot and the nearest cross street.
  let whereAt = 0, whereVal = null;
  function where() {
    const now = performance.now();
    if (!nyc || now - whereAt < 400) return whereVal;
    whereAt = now;
    const R = nyc.roads;
    const a = nyc.nearestRoad(pos.x, pos.z, 70, (r) => !!R.name[r]);
    if (!a) {
      let best = null, bd = 900;
      for (const l of LANDMARKS) { const d = Math.hypot(l.x - pos.x, l.z - pos.z); if (d < bd) { bd = d; best = l; } }
      whereVal = { a: '', b: '', area: best ? best.ko : '맨해튼' };
      return whereVal;
    }
    const nameA = nyc.roadName(a.road);
    const b = nyc.nearestRoad(pos.x, pos.z, 160, (r, p) => {
      if (!R.name[r] || R.name[r] === R.name[a.road]) return false;
      const dx = R.xs[p + 1] - R.xs[p], dz = R.zs[p + 1] - R.zs[p], L = Math.hypot(dx, dz) || 1;
      return Math.abs((dx * a.fx + dz * a.fz) / L) < 0.55;
    });
    whereVal = { a: nameA, b: b ? nyc.roadName(b.road) : '', area: '' };
    return whereVal;
  }

  const roof = LAYOUT.oneTimes.roof;
  const crystalHome = 26;
  const crystalLow = 4.2;
  const crystal = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 24, 12), new THREE.MeshStandardMaterial({ color: '#d7dde8', metalness: 0.72, roughness: 0.28, emissive: '#8fd7ff', emissiveIntensity: 0.35 }));
  pole.position.y = 12;
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(4.4, 1), new THREE.MeshStandardMaterial({ color: '#f4fbff', emissive: '#9af7ff', emissiveIntensity: 1.8, roughness: 0.12, metalness: 0.45, flatShading: true }));
  ball.position.y = 26;
  const glowBall = new THREE.Mesh(new THREE.SphereGeometry(5.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0xbff9ff, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }));
  glowBall.position.y = 26;
  const lasers = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.45, 36, 8, 1, true), new THREE.MeshBasicMaterial({ color: [0xff4ad8, 0xffcf5a, 0x39f58a, 0x3fe6ff, 0xb84dff, 0xffffff][i], transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    beam.position.y = 16;
    beam.rotation.z = 0.55;
    beam.rotation.y = (i / 6) * Math.PI * 2;
    lasers.add(beam);
  }
  lasers.visible = false;
  crystal.add(pole, ball, glowBall, lasers);
  crystal.position.set(roof.x, roof.h, roof.z);
  scene.add(crystal);
  function hideStockBall() {
    scene.traverse((o) => {
      if (!o.isMesh || o.geometry?.parameters?.radius !== 2.4) return;
      if (Math.hypot(o.position.x - roof.x, o.position.z - roof.z) < 2) o.visible = false;
    });
  }
  const fever = { gauge: 0, phase: 'idle', until: 0, confetti: 0 };
  function feverLive() { return fever.phase === 'party' && performance.now() < fever.until; }
  function feverHud() {
    const left = fever.phase === 'idle' ? 0 : Math.max(0, (fever.until - performance.now()) / 1000);
    return { gauge: fever.gauge, phase: fever.phase, left };
  }
  function bumpFever() {
    if (fever.phase !== 'idle') return fever.gauge;
    fever.gauge = Math.min(20, fever.gauge + 1);
    if (fever.gauge >= 20) {
      fever.phase = 'count';
      fever.until = performance.now() + 10000;
      opts.onFever?.({ phase: 'count', gauge: 20, left: 10 });
    } else opts.onFever?.({ phase: 'gauge', gauge: fever.gauge });
    return fever.gauge;
  }
  function stepFever(t) {
    const now = performance.now();
    ball.rotation.y += 0.01;
    glowBall.scale.setScalar(1 + Math.sin(t * 3) * 0.04);
    if (fever.phase === 'count') {
      const u = 1 - Math.max(0, fever.until - now) / 10000;
      const y = crystalHome + (crystalLow - crystalHome) * (u * u);
      ball.position.y = y;
      glowBall.position.y = y;
      lasers.visible = true;
      lasers.rotation.y = t;
      if (now >= fever.until) {
        fever.phase = 'party';
        fever.until = now + 60000;
        opts.onFever?.({ phase: 'party', gauge: 20, left: 60 });
      }
    } else if (fever.phase === 'party') {
      ball.position.y = crystalLow + Math.sin(t * 2) * 0.4;
      glowBall.position.y = ball.position.y;
      lasers.visible = true;
      lasers.rotation.y = t * 1.4;
      if (t - fever.confetti > 0.85) {
        fever.confetti = t;
        burst(crystal.position.clone().setY(roof.h + ball.position.y), PALETTE[(fever.gauge + (t * 3) | 0) % PALETTE.length], 36, 0.7);
      }
      if (now >= fever.until) {
        fever.phase = 'idle';
        fever.gauge = 0;
        fever.until = 0;
        lasers.visible = false;
        opts.onFever?.({ phase: 'idle', gauge: 0, done: true });
      }
    } else {
      const target = crystalHome + Math.sin(t * 0.8) * 0.35;
      ball.position.y += (target - ball.position.y) * 0.08;
      glowBall.position.y = ball.position.y;
      lasers.visible = false;
    }
    lasers.position.y = ball.position.y - 14;
  }

  const trailers = [];
  const fallen = [];
  function miniRider(hex) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.42, 4, 8), new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.55, roughness: 0.4 }));
    body.position.y = 0.55;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshStandardMaterial({ color: '#ffd2ad', emissive: '#ffcf5a', emissiveIntensity: 0.2 }));
    head.position.y = 1.15;
    const link = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 2.6), new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.85 }));
    link.position.set(0, 0.7, 1.3);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: new THREE.Color(hex).multiplyScalar(2.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.position.y = 0.9;
    halo.scale.set(1.7, 2.3, 1);
    g.add(body, head, link, halo);
    g.visible = false;
    scene.add(g);
    return g;
  }
  function syncTrailers() {
    const n = drive && job.phase === 'ride' ? Math.max(0, (job.riders || 0) - 1) : 0;
    const colors = ['#ffcf5a', '#ff3d9a', '#39f58a', '#3fe6ff'];
    while (trailers.length < n) trailers.push(miniRider(colors[trailers.length % colors.length]));
    while (trailers.length > n) scene.remove(trailers.pop());
    for (let i = 0; i < trailers.length; i++) {
      const g = trailers[i];
      const on = i < n && !!drive;
      g.visible = on;
      if (!on) continue;
      const back = (i + 1) * 3.15;
      const x = drive.x - Math.sin(drive.yaw) * back;
      const z = drive.z - Math.cos(drive.yaw) * back;
      g.position.set(x, groundHeight(x, z), z);
      g.rotation.y = drive.yaw;
    }
  }
  function maybeDetach(t, hit) {
    if (!drive || job.phase !== 'ride' || !hit) return;
    const next = applyTaxiHardHit(
      { riders: job.riders, detachAt: job.detachAt },
      { speed: hit.speed, intend: hit.intend, blocked: hit.blocked, held: hit.held, t, x: hit.x, z: hit.z },
      traffic?.positions?.() || [],
    );
    if (!next.dropped) return;
    job.detachAt = t;
    job.riders = next.riders;
    const back = next.riders * 3.15;
    const x = drive.x - Math.sin(drive.yaw) * back + (Math.random() - 0.5) * 1.2;
    const z = drive.z - Math.cos(drive.yaw) * back + (Math.random() - 0.5) * 1.2;
    const mesh = miniRider('#ff6a3d');
    mesh.visible = true;
    mesh.position.set(x, groundHeight(x, z) + 1.4, z);
    fallen.push({ mesh, y: mesh.position.y, vy: 1.2, age: 0, x, z });
    drive.v *= 0.55;
    syncTrailers();
    opts.onJob?.({ type: 'detach', riders: next.riders, mult: next.mult });
  }
  function stepFallen(dt) {
    for (let i = fallen.length - 1; i >= 0; i--) {
      const f = fallen[i];
      f.age += dt;
      f.vy -= 9 * dt;
      f.y += f.vy * dt;
      const floor = groundHeight(f.x, f.z);
      if (f.y < floor) { f.y = floor; f.vy = 0; }
      f.mesh.position.y = f.y;
      f.mesh.rotation.z = Math.min(1.2, f.age * 2);
      if (f.age > 2.8) {
        scene.remove(f.mesh);
        fallen.splice(i, 1);
      }
    }
  }

  const STICKER_KEY = 'kts_stickers';
  const stickerMap = new Map();
  const shots = [];
  function saveStickers() {
    const o = {};
    for (const [k, v] of stickerMap) if (v?.length) o[k] = v;
    try { localStorage.setItem(STICKER_KEY, JSON.stringify(o)); } catch { /* private mode */ }
  }
  function loadStickers() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STICKER_KEY) || 'null'); } catch { raw = null; }
    if (!raw || typeof raw !== 'object') return;
    for (const [id, list] of Object.entries(raw)) {
      if (!Array.isArray(list)) continue;
      const kept = list.filter((d) => STICKER_GLYPHS.includes(d?.g)).slice(0, 8);
      if (!kept.length) continue;
      stickerMap.set(id, kept);
      boards.setDecals(id, kept);
    }
  }
  function commitSticker(slot, glyph) {
    if (!STICKER_GLYPHS.includes(glyph)) return false;
    const list = stickerMap.get(slot) || [];
    if (list.length >= 8) return false;
    list.push({ g: glyph, c: list.length % 4 });
    stickerMap.set(slot, list);
    saveStickers();
    boards.setDecals(slot, list);
    return true;
  }
  function launchSticker(slot, glyph) {
    if (!STICKER_GLYPHS.includes(glyph)) return false;
    const list = stickerMap.get(slot) || [];
    if (list.length >= 8) return false;
    const to = boards.worldPos(slot);
    if (!to) return commitSticker(slot, glyph);
    const from = new THREE.Vector3(drive ? drive.x : pos.x, (drive ? drive.y : pos.y) + 1.5, drive ? drive.z : pos.z);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: new THREE.Color('#ffcf5a').multiplyScalar(2.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sprite.scale.set(1.4, 1.4, 1);
    sprite.position.copy(from);
    scene.add(sprite);
    shots.push({ sprite, from, to: to.clone(), t: 0, slot, glyph });
    return true;
  }
  function stepShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.t += dt / 0.9;
      const u = Math.min(1, s.t);
      s.sprite.position.lerpVectors(s.from, s.to, u);
      s.sprite.position.y += Math.sin(Math.min(1, u) * Math.PI) * 6;
      if (u < 1) continue;
      scene.remove(s.sprite);
      s.sprite.material.dispose();
      commitSticker(s.slot, s.glyph);
      burst(s.to.clone(), '#ffcf5a', 28, 0.45);
      shots.splice(i, 1);
    }
  }
  function peelSticker(slot) {
    const list = stickerMap.get(slot);
    if (!list?.length) return false;
    list.pop();
    if (!list.length) stickerMap.delete(slot);
    saveStickers();
    boards.setDecals(slot, list);
    return true;
  }

  let airShow = null;
  const blimp = new THREE.Group();
  const blimpBody = new THREE.Mesh(new THREE.SphereGeometry(7.5, 18, 12), new THREE.MeshStandardMaterial({ color: '#ffcf5a', emissive: '#ffbf3a', emissiveIntensity: 0.7, metalness: 0.35, roughness: 0.28 }));
  blimpBody.scale.set(2.1, 0.72, 0.72);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.2, 2.2), new THREE.MeshStandardMaterial({ color: '#ffe08a', emissive: '#ffcf5a', emissiveIntensity: 0.4 }));
  fin.position.set(-14, 1.2, 0);
  const blimpCanvas = makeCanvas(768, 192);
  const blimpTex = new THREE.CanvasTexture(blimpCanvas);
  blimpTex.colorSpace = THREE.SRGBColorSpace;
  const blimpSign = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), new THREE.MeshBasicMaterial({ map: blimpTex, transparent: true, side: THREE.DoubleSide }));
  blimpSign.position.set(0, -2.4, 0);
  blimp.add(blimpBody, fin, blimpSign);
  blimp.visible = false;
  scene.add(blimp);
  function paintBlimp(nick, line) {
    const g = blimpCanvas.getContext('2d');
    g.clearRect(0, 0, 768, 192);
    g.fillStyle = '#1a1204';
    g.fillRect(0, 0, 768, 192);
    g.strokeStyle = '#ffcf5a';
    g.lineWidth = 8;
    g.strokeRect(8, 8, 752, 176);
    g.fillStyle = '#fff6d0';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '800 42px sans-serif';
    g.fillText(chars(nick || '', 16), 384, 62);
    g.font = '700 36px sans-serif';
    g.fillText(chars(line || '', 24), 384, 124);
    blimpTex.needsUpdate = true;
  }
  function beginAir(info) {
    const until = Number(info?.until) || 0;
    const line = chars(info?.line || '', 24);
    if (!line || until <= Date.now()) { endAir(); return false; }
    airShow = { nick: chars(info.nick || name, 16), line, until };
    boards.setAir(airShow);
    paintBlimp(airShow.nick, airShow.line);
    blimp.visible = true;
    return true;
  }
  function endAir() {
    if (!airShow && !blimp.visible) return;
    airShow = null;
    blimp.visible = false;
    boards.setAir(null);
  }
  function stepBlimp(t) {
    if (!airShow) return;
    if (Date.now() >= airShow.until) { endAir(); return; }
    const ang = t * 0.28;
    const cx = LAYOUT.oneTimes.x, cz = LAYOUT.oneTimes.z;
    blimp.position.set(cx + Math.cos(ang) * 52, 74, cz + Math.sin(ang) * 52);
    blimp.rotation.y = -ang + Math.PI / 2;
  }
  function stepPlaza(dt, t) {
    stepFever(t);
    stepFallen(dt);
    stepShots(dt);
    stepBlimp(t);
    if (drive && job.phase === 'ride') syncTrailers();
  }

  const api = {
    canvas, scene, camera, renderer, quality,
    start, stop, dispose, resize,
    updateWorld, updateBillboardTexture, applyPlot,
    playEmote, playEmoji: playEmote, playReaction, showReaction, jump, interact, cheerAt, fountainSplash,
    setJoystick(x, y) { joy.x = clamp(Number(x) || 0, -1, 1); joy.y = clamp(Number(y) || 0, -1, 1); },
    setInputEnabled(v) { inputEnabled = !!v; if (!inputEnabled) { keys.clear(); joy.x = 0; joy.y = 0; } },
    setName(n) { name = chars(n || '네온손님', 16) || '네온손님'; me.setName(name); },
    setColor(c) { if (!COLOR_RE.test(c || '')) return; color = c; me.setColor(c); },
    setSpecies(id) { species = speciesId(id); me.setSpecies(species); },
    setGlow(v) { glow = clamp(Number(v) || 0, 0, 1); applyGlow(); },
    setExposure(v) { renderer.toneMappingExposure = clamp(Number(v) || 0.95, 0.5, 1.5); },
    setDancing,
    playIntro: playIntroSweep,
    focusSlot,
    slotCard(id) {
      const p = boards.worldPos(id);
      const mainName = { MAIN_UP: '맨 위 · 가장 비쌈', MAIN_TOP: '위에서 둘째', MAIN_MID: '한가운데', MAIN_BOT: '아래에서 둘째', MAIN_LOW: '가장 아래 · 길에서 잘 보임' };
      if (String(id).startsWith('MAIN_')) return { title: '원 타임스퀘어 북쪽 면', line: mainName[id] || '메인 타워', x: p?.x, y: p?.y, z: p?.z };
      if (!p) return { title: slotName(id), line: '아직 지도에 없습니다' };
      const dx = p.x - LAYOUT.oneTimes.x, dz = p.z - LAYOUT.oneTimes.z;
      const dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? '동쪽' : '서쪽') : (dz > 0 ? '남쪽' : '북쪽');
      const kind = String(id).startsWith('SUB_') ? '교차로 코너 빌딩' : String(id).startsWith('PLOT_') ? '분양 구역 상가 정면' : '메인거리를 보는 건물 벽';
      const h = p.y < 14 ? '길에서 바로 보이는 높이' : p.y < 30 ? '중간 층' : '높은 층';
      return { title: kind, line: `원 타임스퀘어에서 ${dir} ${Math.round(Math.hypot(dx, dz))}m · ${h}`, x: p.x, y: p.y, z: p.z };
    },
    frameBillboard,
    setMonopoly(on) { boards.setShow?.(!!on); },
    strike(slotId) {
      const p = boards.worldPos(slotId);
      if (!p) return;
      burst(p.clone(), '#ffcf5a', 110, 1.5);
      launch(p.x, p.z, p.y + 8, '#fff6c8', 0);
    },
    giftPop,
    topTeam,
    endFocus() { clearCine(); },
    setBoost(on) { boostHeld = !!on; },
    setWaypoint,
    getPlayer() { return playerInfo; },
    netState() { return netState; },
    near() { return near; },
    isDriving: () => !!drive,
    exitTaxi,
    startStars, removeStar, clearStars, removeCoin,
    capture() {
      composer.render();
      const maxW = 1280;
      const scale = Math.min(1, maxW / Math.max(1, canvas.width));
      const out = document.createElement('canvas');
      out.width = Math.max(2, Math.round(canvas.width * scale));
      out.height = Math.max(2, Math.round(canvas.height * scale));
      const g = out.getContext('2d');
      g.drawImage(canvas, 0, 0, out.width, out.height);
      const bar = Math.round(Math.max(36, out.height * 0.07));
      g.fillStyle = 'rgba(5,6,16,0.78)';
      g.fillRect(0, out.height - bar, out.width, bar);
      g.textBaseline = 'middle';
      g.fillStyle = '#ffe7a8';
      g.font = `800 ${Math.max(15, Math.round(bar * 0.4))}px sans-serif`;
      g.fillText('WISH BOARD · 모두의 전광판', 16, out.height - bar * 0.62);
      const raw = out.toDataURL('image/jpeg', 0.9).split(',')[1] || '';
      const bin = atob(raw);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: 'image/jpeg' });
    },
    bake(amount) { marks?.stall.popFish(amount >= 15); },
    setTicker(text) { boards.setTicker(text); },
    startLounge() {
      lounge = true;
      loungeAt = 0;
      loungeI = 0;
      teleport(-21, -112);
      yaw = 0;
      me.holder.rotation.y = 0;
    },
    stopLounge() { lounge = false; cine = null; if (!drive) me.root.visible = true; },
    throwPouch,
    bumpFever,
    launchSticker,
    peelSticker,
    stickerList: (slot) => (stickerMap.get(slot) || []).slice(),
    beginAir,
    feverOn: feverLive,
    balloonUp: () => !!(balloon && balloon.hp > 0),
    teleport(x, z) {
      if (drive) exitTaxi();
      let tx = clamp(Number(x) || 0, LOOP.x0 + 4, LOOP.x1 - 4), tz = clamp(Number(z) || 0, LOOP.z0 + 4, LOOP.z1 - 4);
      const spot = approachOf(tx, tz);
      if (spot) { tx = spot.x; tz = spot.z; yaw = spot.yaw; }
      if (nyc) {
        const [fx, fz] = nyc.freeSpot(tx, tz, RADIUS, 6);
        if (Math.hypot(fx - tx, fz - tz) < 3 && groundHeight(fx, fz) < 0.8) { tx = fx; tz = fz; }
      }
      for (let rad = 0; rad <= 8 && groundHeight(tx, tz) > 0.8; rad += 1.5) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const px = tx + Math.cos(a) * rad, pz = tz + Math.sin(a) * rad;
          if (insideLoop(px, pz, 2) && groundHeight(px, pz) < 0.5) { tx = px; tz = pz; break; }
        }
      }
      tx = clamp(tx, LOOP.x0 + 2, LOOP.x1 - 2);
      tz = clamp(tz, LOOP.z0 + 2, LOOP.z1 - 2);
      const [nx, nz] = collide(tx, tz, RADIUS, false);
      const dx = nx - pos.x, dz = nz - pos.z;
      pos.set(nx, groundHeight(nx, nz), nz);
      vel.set(0, 0, 0);
      const back = spot ? yaw + Math.PI : Math.atan2(camWant.x - follow.x, camWant.z - follow.z);
      follow.set(pos.x, pos.y + eye, pos.z);
      camWant.set(pos.x + Math.sin(back) * 8.2, pos.y + eye + 1.4, pos.z + Math.cos(back) * 8.2);
      controls.target.copy(follow);
      camera.position.copy(camWant);
      if (world) world.warm(pos.x, pos.z, low ? 200 : 260);
      if (traffic && Math.hypot(dx, dz) > 300) traffic.warm(pos.x, pos.z);
    },
    screenOf(kind) {
      if (kind === 'cart' && marks) return screenOf(tmp.copy(marks.stall.world).setY(2.2));
      if (kind === 'atm' && marks) return screenOf(tmp.copy(marks.atm.world).setY(2.6));
      return screenOf(tmp.set(pos.x, pos.y + (drive ? 2.2 : 2.2), pos.z));
    },
    mapData: () => nyc,
    onLand: (x, z) => (nyc ? nyc.onLand(x, z) : true),
    where,
    hud() {
      const out = { driving: !!drive, speed: drive ? Math.abs(drive.v) * 3.6 : 0, fare: drive ? drive.fare : 0, job: null, waypoint: null, where: where(), train: null, fever: feverHud() };
      if (drive && job.phase === 'ride' && job.riders > 0) out.train = { riders: job.riders, mult: taxiTrainMult(job.riders) };
      if (drive && job.phase !== 'none') {
        const aim = job.phase === 'pickup' ? job.target : job.dest;
        if (aim) out.job = { phase: job.phase, dist: Math.hypot(aim.x - pos.x, aim.z - pos.z), bearing: bearingTo(aim.x, aim.z), left: job.phase === 'ride' ? Math.max(0, job.limit - (clockT - job.t0)) : null, limit: job.limit, riders: job.riders || 0 };
      }
      if (waypoint) out.waypoint = { dist: Math.hypot(waypoint.x - pos.x, waypoint.z - pos.z), bearing: bearingTo(waypoint.x, waypoint.z) };
      return out;
    },
    minimap() {
      const peers = [];
      for (const r of remotes.values()) peers.push({ x: r.x, z: r.z, color: r.av.color });
      const st = [];
      for (const s of stars.values()) if (s.g.visible) st.push({ x: s.x, z: s.z });
      const lv = [];
      for (const rec of marks?.plots.values() || []) lv.push({ id: rec.id, level: rec.level, color: rec.color, mine: !!rec.data?.owner_id && rec.data.owner_id === opts.actorId?.() });
      const cd = camera.getWorldDirection(tmp);
      const jobTarget = drive && job.phase !== 'none' ? (job.phase === 'pickup' ? { ...job.target, kind: 'pickup' } : { ...job.dest, kind: 'drop' }) : null;
      return { me: { x: pos.x, z: pos.z, yaw }, camYaw: Math.atan2(cd.x, cd.z), peers, stars: st, plots: lv, taxis: traffic?.positions() || [], driving: !!drive, job: jobTarget, waypoint };
    },
  };
  loadStickers();
  if (opts.autostart !== false) start();
  return api;
}
