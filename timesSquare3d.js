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
import { toNetUnits, fromNetUnits } from './net.js';
import { LAYOUT, LOOP, insideLoop, PLOT_SLOTS, TAXI_STANDS, SKIP_ZONES, NO_PROPS, NO_TREES, FAR_CLUSTERS, LANDMARKS, groundHeight, onStairs, fountainSpot } from './ts3d/layout.js';
import { BALANCE } from './balance.js';
import { kitMaterials } from './ts3d/kit.js';
import { createReflection } from './ts3d/ground.js';
import { createBoards, screenTime } from './ts3d/screens.js';
import { loadNYC, ROAD } from './ts3d/nyc.js';
import { createWorld, FAR_LAYER } from './ts3d/world.js';
import { createTraffic } from './ts3d/traffic.js';
import { buildTimesSquare } from './ts3d/timesq.js';
import { claimRockefeller, buildRockefeller } from './ts3d/rockefeller.js';
import { claimIcons, buildIcons } from './ts3d/icons.js';
import { buildLandmarks } from './ts3d/landmarks.js';
import { createAvatars, EMOTES, REACTIONS, AVATAR_COLORS, speciesId } from './ts3d/avatars.js';
import { THEMES, paintBillboard, makeCanvas, paintGlow, paintBeam, paintMarker, fontsReady, chars, hashStr } from './ts3d/art.js';

export { paintBillboard, THEMES, LAYOUT, PLOT_SLOTS, groundHeight, EMOTES, AVATAR_COLORS };
export const PLAZA = LAYOUT;

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
  scene.fog = new THREE.FogExp2(0x221a40, quality === 'high' ? 0.00125 : quality === 'medium' ? 0.0016 : 0.0024);
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
  const hemi = new THREE.HemisphereLight(0x7486c8, 0x3a1830, low ? 3.6 : 3.1);
  const moon = new THREE.DirectionalLight(0xa8b8ff, 0.7);
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

  // ---- input ----------------------------------------------------------------------------
  const keys = new Set();
  const joy = { x: 0, y: 0 };
  let lastNearKey = '', near = null, lastJump = 0;
  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
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
  canvas.addEventListener('pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY, t: performance.now() }; canvas.style.cursor = 'grabbing'; }, { signal });
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
  {
    const beam = markers.drop.g.children[0];
    beam.geometry.dispose();
    beam.geometry = new THREE.CylinderGeometry(1.6, 1.6, 25, 24, 1, true);
    beam.position.y = 12.5;
    beam.rotation.x = 0;
    beam.material = new THREE.MeshBasicMaterial({ color: 0xffcf5a, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
    beam.layers.enable(0);
  }
  let waypoint = null;
  const job = { phase: 'none', target: null, dest: null, t0: 0, limit: 0, nextAt: 0, startX: 0, startZ: 0 };

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
    job.phase = 'none';
    job.nextAt = clockT + 1.5;
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
    job.phase = 'none';
    markers.pickup.set(null);
    markers.drop.set(null);
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
      if (Math.hypot(x - r.x, z - r.z) > 18) { r.x = x; r.z = z; }
      else { const k = 1 - Math.exp(-dt * 9); r.x += (x - r.x) * k; r.z += (z - r.z) * k; }
      const vx = (r.x - px) / Math.max(dt, 1e-3), vz = (r.z - pz) / Math.max(dt, 1e-3);
      const sp = Math.min(40, Math.hypot(vx, vz));
      r.spd += (sp - r.spd) * (1 - Math.exp(-dt * 7));
      r.y += (groundHeight(r.x, r.z) - r.y) * (1 - Math.exp(-dt * 12));
      const inCar = peer.equip === 'taxi';
      const face = Number(s.face) * DEG;
      let want = r.yaw;
      if (r.spd > 0.5) want = Math.atan2(vx, vz);
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
      beam.layers.set(2);
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
      if (dx * dx + dz * dz < 1.4 && Math.abs(pos.y - groundHeight(c.x, c.z)) < 1.6) opts.onCoin?.(c.i);
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
  function updateWorld(state) {
    for (const row of state?.billboards || []) if (row?.slot_id) updateBillboardTexture(row.slot_id, row, false);
    for (const row of state?.plots || []) if (row?.plot_id) applyPlot(row, false);
  }
  const lightCol = new THREE.Color();
  function refreshLightColors() {
    mainLight.color.set(boards.accentOf('MAIN_S'));
    westLight.color.set(boards.accentOf(low ? 'MAIN_S' : 'SUB_B1'));
    eastLight?.color.set(boards.accentOf('SUB_B4'));
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
    const boosting = input.walk || boostHeld;
    if (boosting && d.v > 8 && t - boostSnd > 1.4) { boostSnd = t; opts.onBoost?.(); }
    const top = boosting ? CAR.boost : CAR.max;
    if (input.f > 0.1) d.v = Math.min(top, d.v + (d.v < 0 ? CAR.brake : CAR.accel) * input.f * dt);
    else if (input.f < -0.1) d.v = Math.max(-CAR.reverse, d.v - (d.v > 0 ? CAR.brake : CAR.accel * 0.6) * -input.f * dt);
    else d.v -= Math.sign(d.v) * Math.min(Math.abs(d.v), CAR.drag * dt);
    if (d.v > top) d.v = Math.max(top, d.v - CAR.brake * dt);
    d.steer += (-input.r - d.steer) * (1 - Math.exp(-dt * 8));
    d.yaw = wrapAngle(d.yaw + d.steer * CAR.steer * clamp(d.v / 7, -1, 1) * dt);
    const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw);
    const travel = d.v * dt, steps = Math.max(1, Math.ceil(Math.abs(travel) / 0.45));
    let cx = d.x, cz = d.z, blocked = 0;
    for (let k = 0; k < steps; k++) {
      const nx = cx + fx * travel / steps, nz = cz + fz * travel / steps;
      const [ax, az] = collide(nx + fx * 1.3, nz + fz * 1.3, CAR.radius, true);
      const [bx, bz] = collide(nx - fx * 1.3, nz - fz * 1.3, CAR.radius, true);
      const fdx = ax - (nx + fx * 1.3), fdz = az - (nz + fz * 1.3), bdx = bx - (nx - fx * 1.3), bdz = bz - (nz - fz * 1.3);
      cx = nx + (Math.abs(fdx) > Math.abs(bdx) ? fdx : bdx);
      cz = nz + (Math.abs(fdz) > Math.abs(bdz) ? fdz : bdz);
      blocked = Math.max(blocked, Math.hypot(cx - nx, cz - nz));
    }
    if (blocked > 0.02) {
      d.v *= Math.max(0, 1 - blocked * 3);
      if (Math.abs(d.v) > 4 && t - lastBump > 0.6) { lastBump = t; opts.onBump?.(); }
    }
    const moved = Math.hypot(cx - d.x, cz - d.z);
    d.odo += moved;
    d.fare = 3 + Math.floor(d.odo / 64) * 0.7;
    vel.set((cx - d.x) / Math.max(dt, 1e-4), 0, (cz - d.z) / Math.max(dt, 1e-4));
    d.x = cx;
    d.z = cz;
    d.y += (groundHeight(cx, cz) - d.y) * (1 - Math.exp(-dt * 10));
    traffic?.driveTaxi(d.i, d.x, d.z, d.yaw, d.v, d.y);
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
  const AD_IDS = ['MAIN_S', 'SUB_B1', 'SUB_B2', 'SUB_B3', 'SUB_B4'];
  for (let i = 1; i <= 20; i++) AD_IDS.push('PLOT_' + i);
  function pickBoardDrop() {
    for (let n = 0; n < 10; n++) {
      const pose = slotPose(AD_IDS[(Math.random() * AD_IDS.length) | 0], 12);
      if (pose && insideLoop(pose.front.x, pose.front.z, 4)) return { point: pose.front, slot: pose.slot, board: pose.board };
    }
    return { point: pickSpot(70, 200, { x: pos.x, z: pos.z }), slot: '', board: null };
  }
  function playIntroSweep() {
    const pose = slotPose('MAIN_S', 28);
    cineFrom.copy(pose?.cam || new THREE.Vector3(LAYOUT.oneTimes.x, 42, LAYOUT.oneTimes.z + 30));
    cineL0.copy(pose?.look || new THREE.Vector3(LAYOUT.oneTimes.x, 26, LAYOUT.oneTimes.z));
    cine = { t0: performance.now(), dur: 2200, hold: false, locked: false };
  }
  function focusSlot(slotId, holdMs = 0) {
    const pose = slotPose(slotId, 18);
    if (!pose) return null;
    cineFrom.copy(camera.position);
    cineL0.copy(controls.target);
    cineTo.copy(pose.cam);
    cineL1.copy(pose.look);
    cine = { t0: performance.now(), dur: 700, hold: !holdMs, locked: true, until: holdMs ? performance.now() + holdMs : 0 };
    burst(pose.look, '#ffcf5a', 80, 1);
    launch(pose.front.x, pose.front.z, pose.look.y, '#ff3d9a', 0.05);
    return pose;
  }
  function updateJob(t) {
    const d = drive;
    if (job.phase === 'none' && t >= job.nextAt) {
      job.target = pickSpot(40, 140, d);
      job.phase = 'pickup';
      markers.pickup.set(job.target);
      opts.onJob?.({ type: 'offer' });
    } else if (job.phase === 'pickup' && Math.hypot(d.x - job.target.x, d.z - job.target.z) < 7 && Math.abs(d.v) < 3) {
      markers.pickup.set(null);
      const drop = pickBoardDrop();
      job.dest = drop.point;
      job.slot = drop.slot;
      job.board = drop.board;
      const dist = Math.hypot(job.dest.x - job.target.x, job.dest.z - job.target.z);
      job.limit = Math.round(dist * 1.4 / 10 + 25);
      job.t0 = t;
      job.phase = 'ride';
      markers.drop.set(job.dest);
      opts.onJob?.({ type: 'board', limit: job.limit, slot: job.slot, title: job.board?.line1 ? `목적지 · ${job.board.line1}` : '목적지 전광판으로 이동' });
    } else if (job.phase === 'ride') {
      const left = job.limit - (t - job.t0);
      if (left <= 0) {
        job.phase = 'none';
        job.nextAt = t + 3;
        markers.drop.set(null);
        opts.onJob?.({ type: 'fail' });
      } else if (Math.hypot(d.x - job.dest.x, d.z - job.dest.z) < 7.5 && Math.abs(d.v) < 3) {
        const fare = clamp(Math.round(6 + 9 * left / job.limit), 6, 15);
        job.phase = 'none';
        job.nextAt = t + 2.5;
        markers.drop.set(null);
        opts.onJob?.({ type: 'done', fare, slot: job.slot, board: job.board, at: screenOf(tmp.set(d.x, 2.4, d.z)) });
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
      if ((cine.until && now >= cine.until) || (u >= 1 && !cine.hold && !cine.until)) cine = null;
    }
    if (markers.drop.g.visible) markers.drop.ring.rotation.z += dt * 1.8;
    sky.position.copy(camera.position);

    // Proximity prompts.
    let nk = null;
    if (!drive) {
      const S = LAYOUT.stall, A = LAYOUT.atm, G = LAYOUT.stage, spot = G.spot, F = fountainSpot();
      const front = { x: spot.x, z: G.z0 - 3.6 };
      if ((pos.x - S.x) ** 2 + (pos.z - S.z) ** 2 < BALANCE.stallR ** 2) nk = { kind: 'cart' };
      else if ((pos.x - A.x) ** 2 + (pos.z - A.z) ** 2 < A.r * A.r) nk = { kind: 'atm' };
      else if ((pos.x - spot.x) ** 2 + (pos.z - spot.z) ** 2 < BALANCE.stageR ** 2 || (pos.x - front.x) ** 2 + (pos.z - front.z) ** 2 < BALANCE.stageFrontR ** 2) nk = { kind: 'stage' };
      else if ((pos.x - F.x) ** 2 + (pos.z - F.z) ** 2 < 4.8 * 4.8) nk = { kind: 'fountain' };
      else {
        const parked = traffic?.nearestTaxi(pos.x, pos.z, BALANCE.taxiParkedR, true);
        if (parked) nk = { kind: 'taxi', i: parked.i };
        else {
          const si = TAXI_STANDS.findIndex(s => Math.hypot(s.x - pos.x, s.z - pos.z) < BALANCE.taxiStandR);
          if (si >= 0) {
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
    boards.update(dt);
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
    lightCol.set(boards.accentOf('MAIN_S'));
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
    endFocus() { cine = null; },
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
    teleport(x, z) {
      if (drive) exitTaxi();
      let tx = clamp(Number(x) || 0, LOOP.x0 + 4, LOOP.x1 - 4), tz = clamp(Number(z) || 0, LOOP.z0 + 4, LOOP.z1 - 4);
      const spot = approachOf(tx, tz);
      if (spot) { tx = spot.x; tz = spot.z; yaw = spot.yaw; }
      if (nyc) [tx, tz] = nyc.freeSpot(tx, tz, RADIUS, 12);
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
      const out = { driving: !!drive, speed: drive ? Math.abs(drive.v) * 3.6 : 0, fare: drive ? drive.fare : 0, job: null, waypoint: null, where: where() };
      if (drive && job.phase !== 'none') {
        const tgt = job.phase === 'pickup' ? job.target : job.dest;
        out.job = { phase: job.phase, dist: Math.hypot(tgt.x - pos.x, tgt.z - pos.z), bearing: bearingTo(tgt.x, tgt.z), left: job.phase === 'ride' ? Math.max(0, job.limit - (clockT - job.t0)) : null, limit: job.limit };
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
  if (opts.autostart !== false) start();
  return api;
}
