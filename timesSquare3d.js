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
import { toNetUnits, fromNetUnits } from './net.js?v=202611221134';
import { walkerPoints } from './ts3d/walkers.js';
import { LAYOUT, LOOP, insideLoop, PLOT_SLOTS, TAXI_STANDS, SKIP_ZONES, NO_PROPS, NO_TREES, FAR_CLUSTERS, LANDMARKS, groundHeight, onStairs, fountainSpot } from './ts3d/layout.js?v=202611221134';
import { BALANCE, PAY, chainsOf, slotName } from './balance.js';
import { isSlotId, STREET_N, shopItem, equippedOf, EQUIP_MAX } from './balance.js';
import { kitMaterials } from './ts3d/kit.js?v=202611221134';
import { createReflection } from './ts3d/ground.js?v=202611221134';
import { createBoards, screenTime } from './ts3d/screens.js?v=202611221134';
import { loadNYC, ROAD } from './ts3d/nyc.js?v=202611221134';
import { createWorld, FAR_LAYER } from './ts3d/world.js?v=202611221134';
import { createTraffic } from './ts3d/traffic.js?v=202611221134';
import { buildTimesSquare } from './ts3d/timesq.js?v=202611221134';
import { claimRockefeller, buildRockefeller } from './ts3d/rockefeller.js?v=202611221134';
import { claimIcons, buildIcons } from './ts3d/icons.js?v=202611221134';
import { buildLandmarks } from './ts3d/landmarks.js?v=202611221134';
import { createAvatars, EMOTES, REACTIONS, AVATAR_COLORS, STARTER_COLORS, speciesId } from './ts3d/avatars.js?v=202611221134';
import { seesAvatar, prefetchDelay, prefetchIds } from './ts3d/loadplan.js?v=202611221134';
import { THEMES, paintBillboard, makeCanvas, paintGlow, paintBeam, paintMarker, paintLabel, fontsReady, chars, hashStr, FRAME_FX } from './ts3d/art.js?v=202611221134';
import { taxiTrainMult, applyTaxiHardHit } from './taxiTrain.js?v=202611221134';
import { taxiExit, EXIT_SLOW, nextOfferDelay, fareWait } from './interact.js?v=202611221134';
import { RETURN_MS, easeOutCubic, easeInOutCubic, tweenU, focusOptions, cineCancels, behindCar, followYawRate, portraitFov, fitDistance, reverseTime, driveCamera, easeCamDist, shortenFocus, pickNearBoard, boardPrompt, proximityKey, tapRoute, EMOTE_GAP_MS, cooldownOk, isGiftBoard, FIREWORK, fadeOldest, fireworkAlpha, fireworkDone, SPARK, sparkGlide, sparkDrop, celebrationDue, faceAbove, celebrationPlan, fanVelocity, frameDistance, boardRange, boardVantage, facesBlock } from './camrig.js?v=202611221134';

export { paintBillboard, THEMES, LAYOUT, PLOT_SLOTS, groundHeight, EMOTES, AVATAR_COLORS, STARTER_COLORS, taxiTrainMult, applyTaxiHardHit };
export const PLAZA = LAYOUT;
const STICKER_GLYPHS = ['🔥부럽다!', '👑성지순례', '💖하트폭탄', '👀내자리찜'];

const RUN = 6.2, WALK = 2.4, RADIUS = 0.36, DEG = Math.PI / 180, EYE = 1.9, CAR_EYE = 2.5;
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
export const colorFor = (id) => STARTER_COLORS[hashStr(id) % STARTER_COLORS.length];

// NeutralToneMapping pulls the darkest channel of a dim colour toward zero (its toe), so a dark sRGB target fed in
// directly comes out darker and more saturated. This returns the linear pre-tone-map colour that shows as `hex`
// on screen (exact while the colour's darkest channel stays under the toe, which holds for every sky/fog value here).
function shownColor(hex, exposure) {
  const t = new THREE.Color(hex);
  const lo = Math.min(t.r, t.g, t.b);
  const off = 0.4 * Math.sqrt(lo) - lo;
  return t.setRGB((t.r + off) / exposure, (t.g + off) / exposure, (t.b + off) / exposure);
}
const GO_HERE = '#48d6f0', REWARD = '#ffb020';

export function createTimesSquare(canvas, opts = {}) {
  if (!canvas) throw new Error('canvas');
  const net = opts.net || null;
  const quality = opts.quality || detectQuality();
  const low = quality === 'low';
  const ac = new AbortController();
  const { signal } = ac;

  // ---- renderer / scene / camera ---------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = clamp(Number(opts.exposure) || 0.95, 0.5, 1.5);
  const dprCap = quality === 'high' ? 1.75 : quality === 'medium' ? 1.25 : 1.5;
  let dpr = Math.min(window.devicePixelRatio || 1, dprCap);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  const shown = (hex) => shownColor(hex, renderer.toneMappingExposure);
  // Fog matches the low sky band (#1c1a3a on screen); densities per tier are unchanged.
  scene.fog = new THREE.FogExp2(shown('#1c1a3a'), quality === 'high' ? 0.0009 : quality === 'medium' ? 0.00115 : 0.0015);
  // Diffuse + specular image light from the room env (0.25) and later the photo env (0.5): kept low so walls stay dark.
  scene.environmentIntensity = 0.25;
  const baseFov = low ? 62 : 55;
  const camera = new THREE.PerspectiveCamera(baseFov, 1, 0.2, 5200);
  camera.layers.enable(1);
  camera.layers.enable(2);
  camera.layers.enable(FAR_LAYER);

  const walkerPts = walkerPoints(12);
  const walkerMesh = new THREE.InstancedMesh(
    new THREE.CapsuleGeometry(0.18, 0.62, 2, 6),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.04 }),
    walkerPts.length,
  );
  walkerMesh.frustumCulled = false;
  const walkerDummy = new THREE.Object3D();
  const walkerTint = [0xb8bfd0, 0xc9a66a, 0xc08aa0, 0x8fb0a0, 0x95a4cc, 0xc4a088];
  for (let i = 0; i < walkerPts.length; i++) walkerMesh.setColorAt(i, new THREE.Color(walkerTint[i % walkerTint.length]));
  scene.add(walkerMesh);
  function stepWalkers(t) {
    for (let i = 0; i < walkerPts.length; i++) {
      const p = walkerPts[i];
      const bob = Math.abs(Math.sin(t * 3.1 + i)) * 0.05;
      walkerDummy.position.set(p.x, groundHeight(p.x, p.z) + 0.55 + bob, p.z);
      walkerDummy.rotation.set(0, i * 0.9 + t * 0.15, 0);
      walkerDummy.updateMatrix();
      walkerMesh.setMatrixAt(i, walkerDummy.matrix);
    }
    walkerMesh.instanceMatrix.needsUpdate = true;
  }
  stepWalkers(0);

  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => { mgrProgress = total ? loaded / total : 1; reportProgress(); };

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  let envRT = pmrem.fromScene(room, 0.04);
  room.dispose();
  scene.environment = envRT.texture;

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    // Colours are on-screen targets run back through the tone map (shownColor), so the sky shows #060917 at the
    // zenith, #131a3c in the middle and #2a2050 at the horizon. No cloud noise: a plain gradient is cheaper and calmer.
    uniforms: {
      uTime: screenTime,
      uZen: { value: shown('#060917') }, uMid: { value: shown('#131a3c') }, uHor: { value: shown('#2a2050') },
      uHaze: { value: shown('#3d2248') }, uFog: { value: scene.fog.color },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir; uniform float uTime; uniform vec3 uZen, uMid, uHor, uHaze, uFog;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 c = mix(uHor, uMid, smoothstep(0.0, 0.24, h));
  c = mix(c, uZen, smoothstep(0.24, 0.78, h));
  // faint warm-pink city glow low on the horizon, strongest along the bowtie (north-south, the Broadway axis)
  vec2 az = normalize(d.xz + vec2(1e-4));
  float haze = (0.55 + 0.45 * abs(az.y)) * (1.0 - smoothstep(0.0, 0.14, max(h, 0.0)));
  c = mix(c, uHaze, haze * 0.6);
  c = mix(uFog, c, smoothstep(-0.04, 0.01, h));
  // few, small stars, only high up
  // (the divisor is clamped: at d.y = -0.05 it was a division by zero, and bloom spread that one NaN pixel)
  vec2 sp = floor(d.xz / max(d.y + 0.05, 1e-3) * 420.0);
  float s = h21(sp);
  c += step(0.99975, s) * smoothstep(0.45, 0.8, h) * (0.16 + 0.08 * sin(uTime * 1.7 + fract(s * 977.0) * 40.0));
  gl_FragColor = vec4(c, 1.0);
}`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4800, 32, 16), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);

  // ---- lights (constant count: toggling would recompile every material) -----------
  // Night: the ambient terms are low and only slightly cool, so walls (dark albedo, see ts3d/world.js) sit in the dark
  // while the avatars, whose albedo is several times higher, keep their own colours. Signs, shop bands and the
  // coloured point lights do the rest of the lighting.
  // Both hemisphere colours are close to neutral: the tone map's toe already turns a dim grey-blue into navy, and a
  // blue sky term plus a plum ground term pushed the walls to violet.
  const hemi = new THREE.HemisphereLight(0xb4b8c8, 0x2c2e36, low ? 3.2 : 2.8);
  const moon = new THREE.DirectionalLight(0xd0dcff, 1.0);
  moon.position.set(-40, 90, 30);
  scene.add(hemi, moon);
  const MAIN_I = 820;
  const mainLight = new THREE.PointLight(0x3fe6ff, MAIN_I, 95, 2);
  mainLight.position.set(LAYOUT.oneTimes.x, 18, LAYOUT.oneTimes.z - 26);
  const stallLight = new THREE.PointLight(0xff8a2a, 40, 16, 2);
  stallLight.position.set(LAYOUT.stall.x, 2.3, LAYOUT.stall.z + 0.4);
  // magenta wash kept at its old strength (it covers most of the bowtie and tinted the walls violet when raised)
  const westLight = new THREE.PointLight(0xff3d9a, low ? 760 : 520, 85, 2);
  westLight.position.set(low ? 16 : -22, 16, low ? 60 : -40);
  scene.add(mainLight, stallLight, westLight);
  let eastLight = null;
  if (!low) {
    eastLight = new THREE.PointLight(0x3fe6ff, 700, 85, 2);
    eastLight.position.set(30, 16, 95);
    const stageLight = new THREE.PointLight(0xff3d9a, 210, 30, 2);
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
  const boards = createBoards({ renderer, kitMats, pick, quality, onBurst: (slotId, color) => celebrateBoard(slotId, color) });
  const avatars = createAvatars({ scene, first: opts.species });
  {
    const S = LAYOUT.stairs, G = LAYOUT.stage;
    carColliders.push({ x0: S.x0 - 0.4, x1: S.x1 + 0.4, z0: S.back, z1: S.front + 0.2 });
    carColliders.push({ x0: G.x0, x1: G.x1, z0: G.z0 - 2.4, z1: G.z1 });
  }

  // The city streams in from /assets/nyc/manhattan.bin; everything below tolerates it not being there yet.
  let nyc = null, world = null, traffic = null, tsq = null, marks = null;
  let cityProgress = 0, mgrProgress = 0, pendingPlots = [], cityFailed = false;
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
    cityFailed = true; // built() stops waiting: nothing more is coming (onError asks for a reload)
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
  let color = COLOR_RE.test(opts.color || '') ? opts.color : STARTER_COLORS[0];
  let species = speciesId(opts.species);
  let myEquip = [];
  let peerFrameSig = '', frameSig = '';
  // The cab colour an equip list asks for (balance.js SHOP kind 'cab' tint), '' for the plain fleet yellow.
  const cabTint = (list) => shopItem(equippedOf(list, 'cab'))?.tint || '';
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
  let lounge = false, loungeI = 0, loungeAt = 0, hopped = 0, hiveAt = 0, hiveHint = false, shake = 0;
  let watchPortrait = false;
  // Scripted cameras (focus, lounge tour, intro) never write camWant: the orbit keeps running underneath, homePos / homeLook
  // are its pose this frame, and every ending eases back to it (endCine). hidMe: frameBillboard hid my avatar, which is
  // not the same thing as sitting in a taxi.
  const homePos = camera.position.clone(), homeLook = follow.clone(), viewLook = follow.clone();
  let hidMe = false, clipDist = Infinity, reverseT = 0, lastEmote = -1e9, stuntAt = -1e9, ringDim = false, boardAt = 0, boardNear = null;
  // The world has one free-form line to the HUD: onInteract('notice', null, { text, tone }).
  const tell = (text, tone = '', extra = null) => opts.onInteract?.('notice', null, { text, tone, ...extra });

  // ---- input ----------------------------------------------------------------------------
  const keys = new Set();
  const joy = { x: 0, y: 0 };
  let lastNearKey = '', near = null, lastJump = 0;
  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    if (e.code === 'Escape') { endCine(true); return; }
    if (MOVE_CODES.has(e.code)) {
      // Not while input is switched off: auto-repeat would refill the set that setInputEnabled(false) just emptied.
      // A key still held when input comes back counts again on its next repeat.
      if (inputEnabled) keys.add(e.code);
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
  const pickPoint = new THREE.Vector3();
  const pickAt = (ev) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    ray.far = 260;
    const hit = ray.intersectObjects(pick, false).find(h => h.object.userData.pick);
    if (hit) pickPoint.copy(hit.point);
    return hit ? hit.object.userData.pick : null;
  };
  // The touch stick's area (ui.js) lies over the canvas and hands its taps here (tapDown / tapUp), so a board or a plot
  // under it still opens; these two are the canvas's own pointerdown / pointerup.
  const onDown = (ev) => {
    // A touch that ends a scripted camera is spent on that: it does not also pick what is under it (see pointerup).
    const cut = !!(cine && !cine.back && !cine.pin);
    if (cut) endCine();
    down = { x: ev.clientX, y: ev.clientY, t: performance.now(), cut }; canvas.style.cursor = 'grabbing';
  };
  canvas.addEventListener('pointerdown', onDown, { signal });
  canvas.addEventListener('pointerup', (ev) => onUp(ev), { signal });
  const onUp = (ev) => {
    canvas.style.cursor = 'grab';
    if (!down) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    const quick = performance.now() - down.t < 450;
    const cut = down.cut;
    down = null;
    if (moved > 7 || !quick || !inputEnabled || cut) return;
    // During the photo countdown (ui.js countShot) a tap is part of posing, not a pick.
    if (document.body.classList.contains('posing')) return;
    const info = pickAt(ev);
    if (!info) return;
    // Far boards (and any board from a taxi) get a small card instead of a sheet; a far ATM gets a waypoint.
    const dist = pickPoint.distanceTo(tmp.set(pos.x, pos.y + 1, pos.z));
    const route = tapRoute({ kind: info.kind, dist, driving: !!drive, near: near?.kind === info.kind });
    if (info.kind === 'billboard') {
      if (route === 'card') {
        const bp = boardPrompt({ board: boards.get(info.slotId)?.data, me: opts.actorId?.() || '', name: slotName(info.slotId) });
        opts.onInteract?.('board-far', info.slotId, { clicked: true, dist, driving: !!drive, state: bp.state, who: bp.who });
      } else opts.onBillboard?.(info.slotId);
    }
    else if (info.kind === 'plot') opts.onPlot?.(info.plotId);
    else if (info.kind === 'atm' && route === 'waypoint') opts.onInteract?.('atm', null, { clicked: true, near: false, far: true, at: { x: LAYOUT.atm.x, z: LAYOUT.atm.z } });
    else opts.onInteract?.(info.kind, null, { clicked: true, near: near?.kind === info.kind });
  };
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
      { x: G.spot.x, z: G.spot.z - 5, yaw: 0 },
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
  /**
   * One burst of sparks at `at`. o: { count, size, gain, flash, flashGain, life, drag, grav } and vel(i, v), which
   * writes spark i's start velocity into v[i * 3..]. A spark's place is its start velocity times sparkGlide(age), less
   * sparkDrop(age) in height (step()), so a burst's reach is known before it is fired (camrig.js celebrationPlan).
   */
  function spawnBurst(at, hex, o) {
    const count = o.count;
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3), c = new Float32Array(count * 3), v = new Float32Array(count * 3);
    const base = new THREE.Color(hex), alt = new THREE.Color();
    for (let i = 0; i < count; i++) {
      o.vel(i, v);
      alt.copy(i % 4 === 0 ? new THREE.Color(PALETTE[i % PALETTE.length]) : base).multiplyScalar(o.gain);
      c[i * 3] = alt.r; c[i * 3 + 1] = alt.g; c[i * 3 + 2] = alt.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const mat = new THREE.PointsMaterial({ size: o.size, map: sparkTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    pts.position.copy(at);
    pts.frustumCulled = false;
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: base.clone().multiplyScalar(o.flashGain), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    flash.position.copy(at);
    flash.userData.max = o.flash;
    scene.add(pts, flash);
    fireworks.push({ pts, flash, v, age: 0, life: o.life, drag: o.drag, grav: o.grav, fadeAt: -1 });
    // Over the cap the oldest fades out over a third of a second; only a runaway pile is cut outright.
    fadeOldest(fireworks, FIREWORK.cap);
    while (fireworks.length > FIREWORK.hard) dropFirework(0);
  }
  /** The round burst (rings, coins, the fountain, emote rockets, the ball, gifts): sparks in every direction. */
  function burst(at, hex, n = 70, power = 1) {
    spawnBurst(at, hex, {
      count: Math.max(12, Math.round(n * (low ? 0.6 : 1))),
      size: (power >= 1 ? 1.45 : 1.05) * Math.max(0.6, power), gain: 2.6, flash: 7 * power, flashGain: 2.2,
      life: SPARK.life, drag: SPARK.drag, grav: SPARK.grav,
      vel(i, v) {
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        const sp = (7 + Math.random() * 6) * power;
        v[i * 3] = Math.cos(a) * s * sp; v[i * 3 + 1] = u * sp + 2 * power; v[i * 3 + 2] = Math.sin(a) * s * sp;
      },
    });
  }
  // A rocket climbs from y to y1 and goes off there. o: { y0, speed, size, shot } for the ones a board plan places
  // (a short climb beside the board, then shot() fires the planned fan); y0 === y1 is a timed burst with no climb.
  const rockets = [];
  function launch(x, z, y1, hex, delay = 0, o = null) {
    rockets.push({ x, z, y: o ? o.y0 : groundHeight(x, z), y1, hex, delay, sprite: null, speed: o?.speed || 26, size: o?.size || 0.9, shot: o?.shot || null });
  }
  // Fireworks around a board, never on it: camrig.js celebrationPlan gives the bursts in the board's own frame
  // (beyond the side edges, above the top edge, fans that open away from the face) and boards.face() gives that frame
  // in the world (the real normal, right and up of the mount and its size), so every size and facing is framed.
  const celebratedAt = new Map();
  const fanV = new THREE.Vector3();
  function boardFireworks(slotId, hex, o = {}) {
    const face = boards.face(slotId);
    if (!face) return false;
    const plan = celebrationPlan({ w: face.w, h: face.h, tier: face.tier, low, top: !faceAbove(slotId), cheer: !!o.cheer });
    const alt = o.alt || PALETTE;
    for (const b of plan.bursts) {
      const at = face.pos.clone().addScaledVector(face.right, b.u).addScaledVector(face.up, b.v).addScaledVector(face.normal, b.n);
      const tint = b.hue ? alt[(b.hue - 1) % alt.length] : hex;
      const shot = () => spawnBurst(at, tint, {
        count: b.count, size: plan.size, gain: plan.gain, flash: b.flash, flashGain: plan.flashGain, life: plan.life, drag: plan.drag, grav: plan.grav,
        vel(i, v) {
          const [vu, vv, vn] = fanVelocity(b, Math.random(), Math.random(), Math.random());
          fanV.set(0, 0, 0).addScaledVector(face.right, vu).addScaledVector(face.up, vv).addScaledVector(face.normal, vn);
          v[i * 3] = fanV.x; v[i * 3 + 1] = fanV.y; v[i * 3 + 2] = fanV.z;
        },
      });
      // A rocket never starts under the street; a fan with no climb is just a timed burst.
      const y0 = b.rise ? Math.max(groundHeight(at.x, at.z), at.y - b.rise) : at.y;
      launch(at.x, at.z, at.y, tint, b.delay, { y0, speed: b.rise ? b.rise / b.riseT : 26, size: plan.rocket, shot });
    }
    return true;
  }
  /** The claim fireworks, once per board per claim: a board that celebrated in the last few seconds adds nothing. */
  function celebrateBoard(slotId, hex) {
    const now = performance.now();
    if (!celebrationDue(celebratedAt.get(slotId), now)) return false;
    if (!boardFireworks(slotId, hex)) return false;
    celebratedAt.set(slotId, now);
    return true;
  }
  function cheerAt(slotId) {
    return boardFireworks(slotId, '#ff3d9a', { cheer: true, alt: ['#ffcf5a'] });
  }
  function fountainSplash() {
    const f = fountainSpot();
    burst(new THREE.Vector3(f.x, f.y, f.z), '#7fd4ff', 42, 0.6);
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
  // Guide beams: two crossed soft quads (core about 0.15 m) instead of a fat cylinder, alpha .25, additive.
  // Cyan = go here (waypoint, taxi pickup / drop-off, my board); amber = coin rewards only.
  const beamTex = new THREE.CanvasTexture(paintBeam(makeCanvas(64, 256)));
  const BEAM_W = 0.75;
  // paintBeam (art.js) is a narrow soft core about a fifth of the texture wide, fading toward v = 1, painted for a flat
  // quad: two crossed quads 0.75 m wide give a core of about 0.15 m from every side. v runs .2 -> 0 -> 1 up the beam,
  // so it is fully bright at 45% of its height (above the roofs, where it guides from afar) and fades out at the top.
  function crossBeamGeo(w, h) {
    const x = w / 2, pos = [], uv = [], idx = [];
    for (const [ax, az] of [[x, 0], [0, x]]) {
      const b = pos.length / 3;
      for (const [y, v] of [[0, 0.2], [h * 0.45, 0], [h, 1]]) {
        pos.push(-ax, y, -az, ax, y, az);
        uv.push(0, v, 1, v);
      }
      idx.push(b, b + 1, b + 3, b, b + 3, b + 2, b + 2, b + 3, b + 5, b + 2, b + 5, b + 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
  const beamMat = (hex, opacity = 0.25) => new THREE.MeshBasicMaterial({ map: beamTex, color: new THREE.Color(hex), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const thinRing = (r, hex, opacity) => new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  function makeMarker(colorHex, glyph, height, reflect) {
    const g = new THREE.Group();
    const beam = new THREE.Mesh(crossBeamGeo(BEAM_W, height), beamMat(colorHex));
    const ring = thinRing(1.45, colorHex, 0.75);
    ring.position.y = 0.05;
    ring.layers.set(1);
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(paintMarker(makeCanvas(128, 128), glyph, colorHex)), transparent: true, depthWrite: false }));
    icon.scale.set(2.6, 2.6, 1);
    icon.position.y = 6;
    icon.layers.set(2);
    beam.layers.set(2);
    if (reflect) beam.layers.enable(0);
    g.add(beam, ring, icon);
    g.visible = false;
    scene.add(g);
    return { g, ring, icon, set(p) { g.visible = !!p; if (p) g.position.set(p.x, groundHeight(p.x, p.z), p.z); } };
  }
  const markers = { pickup: makeMarker(GO_HERE, '🙋', 40, true), drop: makeMarker(GO_HERE, '🏁', 25, true), way: makeMarker(GO_HERE, '📍', 70, false) };
  const passenger = new THREE.Group();
  {
    const cloth = new THREE.MeshStandardMaterial({ color: '#c9a25a', roughness: 0.55 });
    const skin = new THREE.MeshStandardMaterial({ color: '#ffd2ad', roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.62, 4, 8), cloth);
    body.position.y = 0.9;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skin);
    head.position.y = 1.62;
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(paintMarker(makeCanvas(256, 96), '손님', GO_HERE)), transparent: true, depthWrite: false }));
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
  let waypoint = null;
  const job = { phase: 'none', target: null, dest: null, t0: 0, limit: 0, nextAt: 0, startX: 0, startZ: 0, riders: 0, extra: null, extraAt: 0, extraReach: 0, detachAt: 0, wait: 0 };
  // fareAt: clock time (s) of the last fare sent this session (null = none). SLOW_V: pick-up and drop-off below 40 km/h.
  let fareAt = null;
  const SLOW_V = 40 / 3.6;

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
    // One cooldown for all four: a held key or a mashed button is one emote (and one room message, one rocket) per 0.7 s.
    const at = performance.now();
    if (!cooldownOk(at, lastEmote, EMOTE_GAP_MS)) return false;
    lastEmote = at;
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
    exitArmed = 0;
    // The next passenger waits for the Room's fare gap (interact.js nextOfferDelay), counted from the last fare sent.
    job.nextAt = clockT + nextOfferDelay(fareAt == null ? null : clockT - fareAt, { min: 0.4 });
    netState.equip = 'taxi';
    traffic?.setCabTint(i, cabTint(myEquip));
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
    // Riders still on board get out with the player and pay nothing (askExit has warned once).
    const left = job.phase === 'ride' ? job.riders || 0 : 0;
    traffic?.setCabYellow(drive.i, false);
    traffic?.releaseTaxi(drive.i, x, z, cy);
    drive = null;
    exitArmed = 0;
    if (left > 0) opts.onJob?.({ type: 'abandon', riders: left });
    pos.set(out[0], groundHeight(out[0], out[1]), out[1]);
    yaw = cy;
    me.root.visible = true;
    me.root.position.copy(pos);
    eye = EYE;
    follow.set(pos.x, pos.y + eye, pos.z);
    rescaleOrbit(8.5);
    // The driving FOV eases back in step() (fovGoal); nothing snaps here.
    clearRide();
    netState.equip = '';
    opts.onDrive?.(false);
  }
  // 택시 내리기 (E or the round button): with riders the first press warns and a second one within 3 s gets out;
  // above walking pace the cab brakes first and the player gets out when it is slow (stepDrive, drive.exiting).
  let exitArmed = 0;
  function askExit() {
    if (!drive || drive.exiting) return;
    const riders = job.phase === 'ride' ? job.riders || 0 : 0;
    const now = performance.now();
    const r = taxiExit({ riders, speed: drive.v, now, armedUntil: exitArmed });
    exitArmed = r.armedUntil;
    if (r.act === 'warn') { tell(`손님 ${riders}명이 타고 있어요. 한 번 더 누르면 내려요`, 'err'); return; }
    if (r.act === 'brake') { drive.exiting = true; return; }
    exitTaxi();
  }
  function interact() {
    if (drive) { askExit(); return; }
    // The board in front is looked up four times a second: right after a teleport (or a step) E can come before that look,
    // so an empty answer is checked once more here instead of doing nothing.
    if (!near) { boardAt = performance.now(); boardNear = nearBoard(); near = boardNear; }
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
  const seeFrustum = new THREE.Frustum(), seeM = new THREE.Matrix4(), seeP = new THREE.Vector3();
  function syncRemotes(dt, t) {
    remoteCars.length = 0;
    frameSig = '';
    if (!net?.peers) { traffic?.setRemoteTaxis(remoteCars); return; }
    const seen = new Set();
    seeFrustum.setFromProjectionMatrix(seeM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
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
      const cosmetics = Array.isArray(peer.equip) ? peer.equip : (peer.equip && peer.equip !== 'taxi' ? String(peer.equip).split(',') : []);
      let r = remotes.get(id);
      if (!r) {
        r = { av: avatars.create({ id, name: chars(peer.name || '익명', 12), color: col, species: kind }), x, z, y: groundHeight(x, z), yaw: 0, spd: 0 };
        remotes.set(id, r);
      }
      r.av.setSpecies(kind);
      r.av.setEquip(cosmetics);
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
      const inCar = peer.equip === 'taxi' || peer.seat === 'taxi';
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
      // Another species' GLB is fetched the first time one of its avatars is on screen; the stand-in shows until then.
      if (r.av.modelSpecies !== r.av.species && !r.av.asked && !inCar && seesAvatar(camera.position.distanceTo(r.av.root.position), seeFrustum.containsPoint(seeP.set(r.x, r.y + 1, r.z)))) r.av.want();
      r.av.holder.rotation.y = r.yaw;
      r.av.setMotion(inCar ? 0 : Math.min(r.spd, 9), !inCar && s.anim === 'sit' && r.spd < 0.3);
      r.av.update(dt, t);
      if (inCar) remoteCars.push({ x: r.x, z: r.z, yaw: r.yaw, v: r.spd, tint: cabTint(cosmetics) });
      const fr = equippedOf(cosmetics, 'frame');
      if (fr && FRAME_FX[fr]) frameSig += id + '=' + fr + ';';
    }
    for (const [id, r] of remotes) if (!seen.has(id)) { r.av.dispose(); remotes.delete(id); }
    traffic?.setRemoteTaxis(remoteCars);
    if (frameSig !== peerFrameSig) { peerFrameSig = frameSig; paintMyFrames(); } // a holder in the room put on, changed or took off a frame
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
        const sameHold = old && old.holder_id === ev.data.holder_id && Number(old.current_bid) === Number(ev.data.current_bid);
        const photoOn = ev.data.photo_status === 'approved' && old?.photo_status !== 'approved';
        updateBillboardTexture(ev.data.slot_id, ev.data, !ev.replay && (!sameHold || photoOn));
      }
      else if (ev.kind === 'PLOT') applyPlot(ev.data, !ev.replay);
    });
  }

  // ---- stars ---------------------------------------------------------------------------------
  const stars = new Map();
  const starGeo = new THREE.OctahedronGeometry(0.42, 0);
  const starMat = new THREE.MeshStandardMaterial({ color: '#ffd56a', emissive: '#ffb020', emissiveIntensity: 2, metalness: 0.8, roughness: 0.2 });
  const starBeamGeo = crossBeamGeo(BEAM_W, 16);
  const starBeamMat = beamMat(REWARD);
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
      const pad = new THREE.Mesh(new THREE.RingGeometry(BALANCE.starR - 0.12, BALANCE.starR, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: REWARD, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
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
  const coinBeamMat = beamMat(REWARD);
  const coinBeamGeo = crossBeamGeo(BEAM_W, 8);
  const coins = COIN_HOME.map(([x, z], i) => {
    const mesh = new THREE.Mesh(coinGeo, coinMat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, 0.9, z);
    const beam = new THREE.Mesh(coinBeamGeo, coinBeamMat);
    beam.position.set(x, 0, z);
    scene.add(mesh, beam);
    return { i, x, z, mesh, beam, back: 0 };
  });
  // A picked coin hides at once (holdCoin) while its MINE waits; PAY removes it for 20 s (removeCoin), a refusal or a
  // timeout puts it back (holdCoin false). Only a visible coin fires onCoin.
  function removeCoin(i) {
    const c = coins[i];
    if (!c) return;
    c.mesh.visible = false;
    if (c.beam) c.beam.visible = false;
    c.held = false;
    c.back = performance.now() + 20000;
  }
  function holdCoin(i, on) {
    const c = coins[i];
    if (!c) return null;
    if (on) {
      if (!c.mesh.visible) return null;
      c.mesh.visible = false;
      if (c.beam) c.beam.visible = false;
      c.held = true;
      c.back = 0;
      return screenOf(tmp.set(c.x, groundHeight(c.x, c.z) + 1.1, c.z));
    }
    if (!c.held) return null;
    c.held = false;
    c.mesh.visible = true;
    if (c.beam) c.beam.visible = true;
    return null;
  }
  const STUNTS = [
    { x: 16, z: 52 },
    { x: 16, z: 90 },
  ];
  const ringMat = new THREE.MeshBasicMaterial({ color: REWARD });
  const ringBeamMat = beamMat(REWARD);
  const ringBeamGeo = crossBeamGeo(BEAM_W, 24);
  for (const s of STUNTS) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.28, 10, 28), ringMat);
    ring.position.set(s.x, 2.3, s.z);
    const beam = new THREE.Mesh(ringBeamGeo, ringBeamMat);
    beam.position.set(s.x, 0, s.z);
    scene.add(ring, beam);
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
    opts.onBalloon?.(0, 25000);
    opts.onWish?.(WISH_LINES[(Math.random() * WISH_LINES.length) | 0]);
  }
  function hitBalloon() {
    if (!balloon || balloon.hp <= 0) return;
    balloon.hp -= 10;
    if (balloon.hp <= 0) { popBalloon(); return; }
    const s = 16 + 12 * (balloon.hp / 1000);
    balloon.mesh.scale.set(s, s, 1);
    opts.onBalloon?.(balloon.hp);
  }
  // One throw per THROW_GAP_MS (a held or mashed button is not 30 throws a second). The balloon floats 58 m up, out of
  // the usual view: the first throw of the session tilts the camera up to it for a moment (on foot, no other camera).
  const THROW_GAP_MS = 250;
  let lastThrow = -1e9, balloonSeen = false;
  function throwPouch() {
    if (!balloon || balloon.hp <= 0) return false;
    const now = performance.now();
    if (now - lastThrow < THROW_GAP_MS) return false;
    lastThrow = now;
    if (!balloonSeen && !drive && !cine) {
      balloonSeen = true;
      startCine(camera.position.clone(), viewLook.clone().lerp(balloon.mesh.position, 0.8), { dur: 600, until: now + 1500 });
    }
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
        if (c.back && now >= c.back) { c.mesh.visible = true; if (c.beam) c.beam.visible = true; c.back = 0; }
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
  // The holder's frame (art.js FRAME_FX, shop kind 'frame') around its boards: mine from my equip, another holder's from its presence while it
  // is in this room (peerFrameSig, built in syncRemotes). A holder who is away shows the plain board.
  function paintMyFrames() {
    const mine = opts.actorId?.() || '';
    const peerFrame = new Map();
    for (const part of peerFrameSig.split(';')) { const at = part.indexOf('='); if (at > 0) peerFrame.set(part.slice(0, at), part.slice(at + 1)); }
    const myFrame = equippedOf(myEquip, 'frame');
    for (const [id, b] of boards.boards) {
      const holder = String(b.data?.holder_id || '');
      const fx = FRAME_FX[holder && holder === mine ? myFrame : holder ? peerFrame.get(holder) || '' : ''];
      boards.setRim(id, fx ? fx.color : '', fx ? fx.anim : '');
    }
  }
  function updateBillboardTexture(slotId, data, celebrate = true) {
    if (!slotId) return false;
    const changed = boards.set(slotId, data, celebrate);
    if (changed) refreshLightColors();
    paintMyFrames();
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
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    sign.scale.set(18, 4.5, 1);
    sign.position.y = 10;
    sign.renderOrder = 20;
    g.add(sign);
    g.userData.tex = tex;
    g.userData.title = title;
    scene.add(g);
    return g;
  }
  let chainRows = [];
  function syncChains(list = chainRows) {
    chainRows = list || [];
    const on = new Set();
    for (const c of chainsOf(chainRows)) {
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
      g.position.set(x, y + 8, z);
      g.visible = true;
    }
    for (const [id, g] of chainMarks) if (!on.has(id)) g.visible = false;
  }
  let paintRoof = (name) => { paintRoof.pending = String(name || '').slice(0, 16); };
  function updateWorld(state) {
    boards.setOps?.(state?.ops?.copy || '');
    for (const row of state?.billboards || []) if (row?.slot_id && isSlotId(row.slot_id)) updateBillboardTexture(row.slot_id, row, false);
    for (const row of state?.plots || []) if (row?.plot_id) applyPlot(row, false);
    syncChains(state?.billboards);
    if (typeof state?.roof === 'string') paintRoof(state.roof);
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
    scene.environmentIntensity = 0.5;
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
    // While a scripted camera runs (or eases back) the stick is read against the orbit the player will return to.
    if (cine) fwd.subVectors(homeLook, homePos); else camera.getWorldDirection(fwd);
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
    // Fever (party) is unlimited boost, not a faster car: the same boost top speed, without holding the button.
    const boosting = party || input.walk || boostHeld;
    if (boosting && d.v > 8 && t - boostSnd > 1.4) { boostSnd = t; opts.onBoost?.(); }
    const top = boosting ? CAR.boost : CAR.max;
    if (d.exiting) d.v -= Math.sign(d.v) * Math.min(Math.abs(d.v), CAR.brake * dt); // 택시 내리기 at speed: brake, then out
    else if (input.f > 0.1) d.v = Math.min(top, d.v + (d.v < 0 ? CAR.brake : CAR.accel) * input.f * dt);
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
    updateJob(t);
    if (d.exiting && Math.abs(d.v) <= EXIT_SLOW) exitTaxi();
  }

  // `level`: camera at the board's own height (the straight-on photo frame) instead of the low street view.
  // `clear`: a scripted camera will sit at `cam`. It stands at `dist`, or farther when the whole face would not be in
  // the frame from there (camrig.js frameDistance: the mount's real width and height, this frame's aspect and the FOV
  // the frame settles on, at most FRAME.max). When a building stands between, camrig.js boardVantage turns the camera
  // along the street and lifts it until it sees the face again, and pulls it in as far as it must.
  function slotPose(slotId, dist, clear = false, level = false) {
    const p = boards.worldPos(slotId);
    if (!p) return null;
    const screen = boards.get(slotId)?.mounts[0]?.screen;
    const q = new THREE.Quaternion();
    if (screen) screen.getWorldQuaternion(q);
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    f.y = 0;
    if (f.lengthSq() < 1e-4) f.set(0, 0, 1);
    f.normalize();
    const face = clear ? boards.face(slotId) : null;
    const vfov = portraitFov(camera.aspect, baseFov);
    const look = p.clone();
    const cam = new THREE.Vector3();
    let fov = 0; // 0: the frame's own FOV; more when the vantage had to open the lens
    if (face && nyc) {
      // Walls are only loaded around the player; load the ones around this board (as taxiCanSit does) before testing.
      nyc.ensureSolid(p.x, p.z, 60);
      // The other boards within reach stand in the way too (a neighbour's frame in front of a turned view).
      const others = [];
      for (const b of boards.boards.values()) {
        if (b.slotId === slotId || !b.mounts.length) continue;
        const o = boards.face(b.slotId);
        if (o && o.pos.distanceToSquared(p) < 6400) others.push(o);
      }
      const hitFace = facesBlock(others);
      const block = (ax, ay, az, bx, by, bz) => Math.min(nyc.rayBlock(ax, ay, az, bx, by, bz), hitFace(ax, ay, az, bx, by, bz));
      const v = boardVantage({ face: { x: p.x, y: p.y, z: p.z, nx: f.x, nz: f.z, w: face.w, h: face.h }, dist, aspect: camera.aspect, vfov, block, ground: groundHeight, level });
      cam.set(v.x, v.y, v.z);
      if (v.fov > vfov + 0.5) fov = v.fov;
    } else {
      if (face) dist = boardRange(dist, frameDistance({ w: face.w, h: face.h, aspect: camera.aspect, vfov }));
      cam.copy(p).addScaledVector(f, dist);
      if (!level) cam.y = Math.max(look.y * 0.42 + 1.8, groundHeight(cam.x, cam.z) + 1.6);
    }
    return { look, cam, fov, front: { x: p.x + f.x * 9, z: p.z + f.z * 9 }, board: boards.get(slotId)?.data || null, slot: slotId };
  }
  const AD_IDS = ['MAIN_TOP', 'MAIN_MID', 'MAIN_BOT', 'SUB_1A', 'SUB_1B', 'SUB_2A', 'SUB_2B', 'SUB_3A', 'SUB_3B', 'SUB_4A', 'SUB_4B'];
  for (let i = 1; i <= STREET_N; i++) AD_IDS.push('STREET_' + i);
  for (let i = 1; i <= 18; i++) AD_IDS.push('PLOT_' + i);
  // Every claimable board, for the proximity prompt. A board that is not on the map yet is simply not a candidate;
  // front points are cached per mount (a lot's board is mounted again when the lot levels up).
  const BOARD_IDS = ['MAIN_LOW', 'MAIN_UP', ...AD_IDS];
  const frontCache = new Map(), frontList = [];
  function nearBoard() {
    frontList.length = 0;
    for (const id of BOARD_IDS) {
      const m = boards.get(id)?.mounts[0] || null;
      let c = frontCache.get(id);
      if (!c || c.m !== m) {
        const pose = m ? slotPose(id, 9) : null;
        c = { m, f: pose ? { id, x: pose.front.x, z: pose.front.z, y: pose.look.y } : null };
        frontCache.set(id, c);
      }
      if (c.f) frontList.push(c.f);
    }
    const hit = pickNearBoard(pos.x, pos.z, frontList);
    if (!hit) return null;
    const bp = boardPrompt({ board: boards.get(hit.id)?.data, me: opts.actorId?.() || '', name: slotName(hit.id) });
    return { kind: 'board', id: hit.id, s: bp.state, who: bp.who, p: bp.p };
  }
  const crown = new THREE.Group();
  const beam = new THREE.Mesh(crossBeamGeo(BEAM_W, 90), beamMat('#ffe8c0', 0.2));
  beam.position.y = 3;
  const hat = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.22, 8, 20), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
  hat.rotation.x = Math.PI / 2;
  hat.position.y = 3.2;
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), new THREE.MeshBasicMaterial({ color: 0xfff6c8 }));
  gem.position.y = 4.6;
  crown.add(beam, hat, gem);
  crown.visible = false;
  scene.add(crown);
  let crownAt = 0;
  function boardLit(d) {
    const until = d?.lit_until || d?.expires_at;
    return !!(d?.holder_id && until && new Date(until).getTime() > Date.now());
  }
  function placeCrown() {
    let best = '', score = 0;
    for (const id of AD_IDS) {
      const d = boards.get(id)?.data;
      if (!boardLit(d)) continue;
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
      if (!boardLit(d)) continue;
      const tags = new Set([d.line1, d.line2, d.line3, d.holder_name].join(' ').match(re) || []);
      const s = (Number(d.views) || 0) + (Number(d.cheers) || 0);
      for (const tag of tags) map.set(tag, (map.get(tag) || 0) + s);
    }
    let best = '', n = 0;
    for (const [tag, s] of map) if (s > n) { best = tag; n = s; }
    return best;
  }
  // Gift fireworks only. `sure` is the ?gift=1 link; otherwise the board itself must read as a gift ("To. name"),
  // so the plain claim flow that still calls this stays quiet.
  function giftPop(slotId, sure = false) {
    if (!sure && !isGiftBoard(boards.get(slotId)?.data)) return;
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
    const pose = slotPose('MAIN_LOW', 12) || slotPose('STREET_1', 12);
    if (pose && insideLoop(pose.front.x, pose.front.z, 4)) return { point: pose.front, slot: pose.slot, board: pose.board };
    return { point: pickSpot(70, 200, { x: pos.x, z: pos.z }), slot: '', board: null };
  }
  // ---- scripted cameras ------------------------------------------------------------------------------------------
  // cine = { t0, dur, back, ease, tell, until, pin }. back: easing to the orbit pose (the intro and every ending);
  // otherwise going to / holding on cineTo. pin: input does not end it (the photo frame). tell: say onFocus(false) when
  // the return lands (the intro, which never said onFocus(true)).
  function playIntroSweep() {
    const pose = slotPose('MAIN_TOP', 28);
    cineFrom.copy(pose?.cam || new THREE.Vector3(LAYOUT.oneTimes.x, 42, LAYOUT.oneTimes.z + 30));
    cineL0.copy(pose?.look || new THREE.Vector3(LAYOUT.oneTimes.x, 26, LAYOUT.oneTimes.z));
    cine = { t0: performance.now(), dur: 2200, back: true, ease: 'inout', tell: true };
  }
  /** Fly from wherever the view is now to `cam` looking at `look`, then hold (chains board to board without a cut). */
  function startCine(cam, look, o = {}) {
    cineFrom.copy(camera.position);
    cineL0.copy(viewLook);
    cineTo.copy(cam);
    cineL1.copy(look);
    cine = { t0: performance.now(), dur: o.dur || 700, back: false, until: o.until || 0, pin: !!o.pin, fov: o.fov || 0 };
  }
  /**
   * The one way out of a scripted camera: movement, a tap, Escape, a timed hold running out, 시점 해제, the lounge
   * stopping. Starts a 0.45 s ease-out back to the orbit; input is live from this call on, and a return that is already
   * running is left alone (force, from Escape, only cuts the long intro short).
   */
  function endCine(force = false) {
    if (hidMe) { hidMe = false; if (!drive) me.root.visible = true; }
    const wasLounge = lounge;
    lounge = false;
    const now = performance.now();
    if (cine && !cine.back) {
      if (drive) {
        // In a car the view comes back behind it, at the distance the orbit already had.
        const d = clamp(tmp.subVectors(camWant, follow).length() || 11.5, controls.minDistance, controls.maxDistance);
        const p = behindCar(follow, drive.yaw, d);
        camWant.set(p.x, p.y, p.z);
      }
      cineFrom.copy(camera.position);
      cineL0.copy(viewLook);
      cine = { t0: now, dur: RETURN_MS, back: true, ease: 'out', tell: false };
      opts.onFocus?.(false);
    } else if (cine && force && cine.t0 + cine.dur - now > RETURN_MS) {
      cineFrom.copy(camera.position);
      cineL0.copy(viewLook);
      cine = { t0: now, dur: RETURN_MS, back: true, ease: 'out', tell: cine.tell };
    }
    if (wasLounge) opts.onLoungeEnd?.();
  }
  function focusSlot(slotId, holdMsOrOpts = 0) {
    const o = focusOptions(holdMsOrOpts);
    // Chosen rule: no focus camera from a moving taxi (the car would drive blind).
    if (drive) { tell('운전 중에는 내린 뒤에 볼 수 있어요'); return null; }
    const pose = slotPose(slotId, 18, true);
    if (!pose) return null;
    if (hidMe) { hidMe = false; me.root.visible = true; }
    startCine(pose.cam, pose.look, { dur: 700, until: o.hold ? performance.now() + o.hold : 0, fov: pose.fov });
    // Fireworks around the board, and only when asked (a claim): a plain 보기 leaves it clear. When boards.set already
    // set them off for this claim, this call adds nothing.
    if (o.celebrate) celebrateBoard(slotId, '#ffcf5a');
    opts.onFocus?.(true);
    return pose;
  }
  // The straight-on frame: from 8 m (15.8 m in the tall 9:16 watch frame) for a small board; slotPose moves it out
  // until the whole face is in the frame, so a wide board fills the width less the margin instead of being cropped.
  function framePose(slotId) {
    const d = watchPortrait ? fitDistance(22, baseFov, portraitFov(9 / 16, baseFov)) : 8;
    return slotPose(slotId, d, true, true);
  }
  function frameBillboard(slotId) {
    if (drive) return false;
    const pose = framePose(slotId);
    if (!pose) return false;
    // A cut, not a flight: the photo is taken right away. Pinned: a drag or a step must not drop the frame.
    startCine(pose.cam, pose.look, { dur: 1, pin: true });
    cineFrom.copy(pose.cam);
    cineL0.copy(pose.look);
    camera.position.copy(pose.cam);
    camera.lookAt(pose.look);
    viewLook.copy(pose.look);
    me.root.visible = false;
    hidMe = true;
    opts.onFocus?.(true);
    return true;
  }
  const LOUNGE_IDS = ['MAIN_TOP', 'MAIN_MID', 'MAIN_BOT', 'SUB_1A', 'SUB_2A', 'SUB_3A', 'SUB_4A'];
  /** 멍때리기: the camera glides from the board it is on to the next one. The avatar stays where it is. */
  function tourNext() {
    // A photo is being framed: no glide under it. The tour does not pick up again afterwards: the photo's endFocus goes
    // through endCine, which ends the lounge (onLoungeEnd), so the player starts it again by hand.
    if (cine?.pin) return false;
    for (let k = 0; k < LOUNGE_IDS.length; k++) {
      const id = LOUNGE_IDS[loungeI++ % LOUNGE_IDS.length];
      const pose = watchPortrait ? framePose(id) : slotPose(id, 18, true);
      if (!pose) continue;
      const first = !cine || cine.back;
      startCine(pose.cam, pose.look, { dur: first ? 1100 : 1800, fov: pose.fov });
      // A low arc keeps the glide above the street furniture between two boards.
      cine.arc = first ? 0 : Math.min(14, cineFrom.distanceTo(cineTo) * 0.12);
      if (first) opts.onFocus?.(true);
      return true;
    }
    return false;
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
    job.wait = 0;
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
    job.extraAt = t + PAY.fare.pickGapMs / 1000;
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
      if (pd < 8 && pd + 10 < job.reach && Math.abs(d.v) < SLOW_V) {
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
        job.extraAt = t + PAY.fare.pickGapMs / 1000;
        job.phase = 'ride';
        markers.drop.set(job.dest);
        syncTrailers();
        opts.onJob?.({ type: 'board', limit: job.limit, slot: job.slot, riders: 1, mult: 1, title: drop.slot ? `도착 기둥 · ${slotName(drop.slot)} 앞에서 속도를 줄이세요` : '도착 기둥까지 가서 속도를 줄이세요' });
      }
    } else if (job.phase === 'ride') {
      offerExtra(d, t);
      if (job.extra) {
        const pd = Math.hypot(d.x - job.extra.x, d.z - job.extra.z);
        if (pd < 8 && pd + 10 < (job.extraReach || 0) && Math.abs(d.v) < SLOW_V) boardExtra(t);
      }
      const left = job.limit - (t - job.t0);
      const dd = job.dest ? Math.hypot(d.x - job.dest.x, d.z - job.dest.z) : 999;
      const there = dd < 12 && dd + 12 < (job.dropReach || 0);
      // At the drop-off before the Room's fare gap has run: the passenger waits in the cab (hud job.wait) instead of
      // getting out into a fare the Room would refuse.
      job.wait = there ? fareWait(fareAt == null ? null : t - fareAt) : 0;
      if (left <= 0) {
        clearRide();
        job.nextAt = t + nextOfferDelay(fareAt == null ? null : t - fareAt, { min: 3 });
        opts.onJob?.({ type: 'fail' });
      } else if (there && !job.wait && Math.abs(d.v) < SLOW_V) {
        const fare = clamp(Math.round(6 + 9 * left / job.limit), 6, 15);
        const riders = job.riders || 1;
        const slot = job.slot;
        const board = job.board;
        clearRide();
        const ev = { type: 'done', fare, riders, mult: taxiTrainMult(riders), slot, board, at: screenOf(tmp.set(d.x, 2.4, d.z)) };
        opts.onJob?.(ev);
        // main.js sets ev.sent when the fare went out; only then does the Room's 40 s gap start again.
        if (ev.sent !== false) fareAt = t;
        job.nextAt = t + nextOfferDelay(fareAt == null ? null : t - fareAt);
      }
    }
  }

  function step(dt, t, now) {
    clockT = t;
    screenTime.value = t;
    const input = readInput();
    // Movement ends a held scripted camera before this frame's step, so the first step already uses the orbit basis.
    // A scripted camera cannot start from a taxi; one that was running when the player got in ends here too.
    // While input is switched off (a sheet is open) a held key or a thumb resting on the stick does not count.
    if (cine && !cine.back && (drive || cineCancels({ active: true, pin: cine.pin, keys: keys.size, joy: Math.hypot(joy.x, joy.y), lounge, locked: !inputEnabled }))) endCine();
    else if (lounge && drive) endCine();
    let sitting = false;
    if (drive) stepDrive(dt, input, t);
    else sitting = stepWalk(dt, input);
    reverseT = drive ? reverseTime(reverseT, drive.v, dt) : 0;
    // The rings share one 20 s reward gap (main.js pays through onStunt): dim while it runs, and no shake or burst.
    const ringWait = now - stuntAt < PAY.stunt.gapMs + 250;
    if (ringWait !== ringDim) {
      ringDim = ringWait;
      ringMat.color.set(REWARD).multiplyScalar(ringDim ? 0.28 : 1);
      ringBeamMat.opacity = ringDim ? 0.07 : 0.25;
    }
    for (const s of STUNTS) {
      const nearRing = Math.hypot(pos.x - s.ry.position.x, pos.z - s.ry.position.z) < 1.7;
      if (nearRing && !s.inside) {
        s.inside = true;
        if (ringWait) continue;
        stuntAt = now;
        shake = 0.35;
        burst(s.ry.position.clone(), '#ffcf5a', 28, 0.6);
        opts.onStunt?.();
      } else if (!nearRing) s.inside = false;
    }
    if (drive) {
      let close = 99;
      const pay = performance.now() - hiveAt > PAY.hive.gapMs;
      for (const c of traffic?.positions?.() || []) {
        if (c.mode === 'driven') continue;
        const d = Math.hypot(c.x - drive.x, c.z - drive.z);
        if (d < close) close = d;
        if (pay && d < 3.5) { hiveAt = performance.now(); opts.onHive?.(); break; }
      }
      hiveHint = close < 14;
    } else hiveHint = false;
    ensureBalloon(performance.now());
    updateThrows(dt);
    if (balloon && balloon.hp > 0) {
      balloon.mesh.position.y = 58 + Math.sin(t * 0.6) * 1.6;
    }
    if (lounge && inputEnabled && (keys.size || Math.hypot(joy.x, joy.y) > 0.25)) endCine();
    else if (lounge && performance.now() - loungeAt > 8000) {
      loungeAt = performance.now();
      tourNext();
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
    // FOV: wider in a portrait frame, wider again with speed in a taxi; every change (rotation, getting out) is eased.
    // A board camera that had to open the lens to fit the face (boardVantage) holds that FOV until it heads back.
    const fovGoal = (cine && !cine.back && cine.fov) || portraitFov(camera.aspect, baseFov) + (drive ? clamp(Math.abs(drive.v) / 30, 0, 1) * 10 : 0);
    if (Math.abs(camera.fov - fovGoal) > 0.05) { camera.fov += (fovGoal - camera.fov) * (1 - Math.exp(-dt * (drive ? 4 : 6))); camera.updateProjectionMatrix(); }
    const driveCam = drive ? driveCamera({ v: drive.v, reverseT }) : null;
    if (drive && !orbiting && now - orbitEnd > 1500 && driveCam.swing) {
      off.subVectors(camera.position, follow);
      const r = off.length();
      const theta = Math.atan2(off.x, off.z);
      const phi = Math.acos(clamp(off.y / r, -1, 1));
      // Behind the car, also for a short reverse (steering stays car-relative); in front only after 1.2 s of reversing.
      const want = driveCam.front ? drive.yaw : drive.yaw + Math.PI;
      const nt = dampAngle(theta, want, 2.4, dt);
      const np = phi + (1.2 - phi) * (1 - Math.exp(-dt * 1.2));
      camera.position.set(follow.x + r * Math.sin(np) * Math.sin(nt), follow.y + r * Math.cos(np), follow.z + r * Math.sin(np) * Math.cos(nt));
    } else if (!drive && !(cine && !cine.back)) {
      // On foot the view turns gently toward where the stick steers, so a turn does not need a second finger.
      const turn = followYawRate({ f: input.f, r: input.r, idleMs: now - orbitEnd, dragging: orbiting });
      if (turn) {
        off.subVectors(camera.position, follow).applyAxisAngle(UP, -turn * dt);
        camera.position.copy(follow).add(off);
      }
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
        // A wall pulls the camera in at once; when it clears, the camera eases back out over about a quarter second.
        clipDist = easeCamDist(clipDist, best < dd ? Math.max(0.7, best - 0.35) : dd, dt);
        if (clipDist < dd - 0.01) {
          const tilted = !look.equals(follow);
          const shift = tmp2.copy(look).sub(camera.position);
          camera.position.copy(follow).addScaledVector(dir, clipDist);
          if (tilted) look.copy(camera.position).add(shift);
        }
      }
      const floor = groundHeight(camera.position.x, camera.position.z) + 0.3;
      if (camera.position.y < floor) camera.position.y = floor;
      camera.lookAt(look);
      me.tag.visible = camera.position.distanceTo(follow) > 2.4;
    }
    // The orbit pose above is where the player's own camera is this frame. A scripted camera only overrides what is
    // drawn; camWant and controls.target are left to the orbit, so the way back is always known.
    homePos.copy(camera.position);
    homeLook.copy(look);
    if (cine) {
      const u = tweenU(now, cine.t0, cine.dur);
      if (cine.back) {
        const e = cine.ease === 'inout' ? easeInOutCubic(u) : easeOutCubic(u);
        camera.position.lerpVectors(cineFrom, homePos, e);
        look.lerpVectors(cineL0, homeLook, e);
        camera.lookAt(look);
        if (u >= 1) {
          const done = cine;
          cine = null;
          if (done.tell) opts.onFocus?.(false);
        }
      } else {
        const e = easeInOutCubic(u);
        camera.position.lerpVectors(cineFrom, cineTo, e);
        if (cine.arc) camera.position.y += Math.sin(Math.PI * e) * cine.arc;
        look.lerpVectors(cineL0, cineL1, e);
        camera.lookAt(look);
        // On a board the player's own name tag would lie over the board's text (the orbit block shows it again).
        me.tag.visible = false;
        if (cine.until && now >= cine.until) endCine();
      }
    }
    viewLook.copy(look);
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake * 0.6;
      shake = Math.max(0, shake - dt * 1.4);
    }
    if (markers.drop.g.visible) markers.drop.ring.rotation.z += dt * 1.8;
    sky.position.copy(camera.position);
    hat.rotation.y += dt;
    gem.rotation.y += dt * 2;
    if (now - crownAt > 800) {
      crownAt = now;
      // A hold that just ran out: the screen is back on the house notice, so the lights and tower marks follow.
      if (boards.expire()) { refreshLightColors(); syncChains(); }
      placeCrown();
    }

    // Proximity prompts.
    let nk = null;
    if (!drive) {
      const S = LAYOUT.stall, A = LAYOUT.atm, spot = LAYOUT.stage.spot, F = fountainSpot();
      if ((pos.x - S.x) ** 2 + (pos.z - S.z) ** 2 < BALANCE.stallR ** 2) nk = { kind: 'cart' };
      else if ((pos.x - A.x) ** 2 + (pos.z - A.z) ** 2 < A.r * A.r) nk = { kind: 'atm' };
      else if ((pos.x - spot.x) ** 2 + (pos.z - spot.z) ** 2 < PAY.dance.nearM ** 2) nk = { kind: 'stage' };
      else if ((pos.x - F.x) ** 2 + (pos.z - F.z) ** 2 < 4.8 * 4.8) nk = { kind: 'fountain' };
      else if (pos.x > -34 && pos.x < -8 && pos.z > -122 && pos.z < -102) nk = { kind: 'lounge' };
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
      // The board in front of the player (front point within 12 m), looked up four times a second. Above ring and crowd.
      if (now - boardAt > 250) { boardAt = now; boardNear = nearBoard(); }
      if (!nk && boardNear) nk = boardNear;
      if (!nk) {
        for (const s of STUNTS) {
          if (Math.hypot(pos.x - s.x, pos.z - s.z) < 5) { nk = { kind: 'ring' }; break; }
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
        // 함성 only with someone within cheerNear (8 m); alone there is no prompt at all.
        if (mates > 0) nk = { kind: 'crowd', n: mates };
      }
    }
    // The key carries the neighbour count and the board's state, so "옆 N명" and the board line stay current.
    const key = proximityKey(nk);
    if (key !== lastNearKey) { lastNearKey = key; near = nk; opts.onProximity?.(nk); }
    marks?.stall.setNear(near?.kind === 'cart', t);
    marks?.stage.setNear(near?.kind === 'stage', t);
    if (waypoint && Math.hypot(pos.x - waypoint.x, pos.z - waypoint.z) < 7) {
      // Reached (not cleared by hand): the tutorial opens the claim wizard from this.
      const at = waypoint;
      setWaypoint(null);
      opts.onInteract?.('arrive', null, { x: at.x, z: at.z, driving: !!drive });
    }
    for (const m of Object.values(markers)) if (m.g.visible) { m.icon.position.y = 6 + Math.sin(t * 2.4) * 0.4; m.ring.scale.setScalar(1 + Math.sin(t * 3) * 0.06); }

    syncRemotes(dt, t);
    stepWalkers(t);
    stepGhosts(now);
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
      if (r.y < r.y1) {
        if (!r.sprite) {
          r.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: new THREE.Color(r.hex).multiplyScalar(r.shot ? 1.6 : 3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
          r.sprite.scale.set(r.size, r.size, 1);
          scene.add(r.sprite);
        }
        r.y += dt * r.speed;
        // A planned rocket climbs dead straight: it is half a sprite from the board's edge.
        r.sprite.position.set(r.x + (r.shot ? 0 : Math.sin(r.y) * 0.08), Math.min(r.y, r.y1), r.z);
      }
      if (r.y >= r.y1) {
        if (r.sprite) { scene.remove(r.sprite); r.sprite.material.dispose(); }
        if (r.shot) r.shot(); else burst(new THREE.Vector3(r.x, r.y1, r.z), r.hex, 80, 1.05);
        rockets.splice(i, 1);
      }
    }
    for (let i = fireworks.length - 1; i >= 0; i--) {
      const f = fireworks[i];
      f.age += dt;
      // Closed form (camrig.js sparkGlide / sparkDrop): start velocity times the glide, less the drop.
      const p = f.pts.geometry.attributes.position.array, v = f.v;
      const glide = sparkGlide(f.age, f.drag), drop = sparkDrop(f.age, f.drag, f.grav);
      for (let j = 0; j < p.length; j += 3) {
        p[j] = v[j] * glide; p[j + 1] = v[j + 1] * glide - drop; p[j + 2] = v[j + 2] * glide;
      }
      f.pts.geometry.attributes.position.needsUpdate = true;
      f.pts.material.opacity = fireworkAlpha(f.age, f.life, f.fadeAt);
      const fl = Math.min(1, f.age / 0.5);
      f.flash.scale.setScalar(f.flash.userData.max * (0.3 + fl * 0.7));
      f.flash.material.opacity = Math.max(0, 1 - fl) * (f.fadeAt >= 0 ? Math.max(0, 1 - (f.age - f.fadeAt) / FIREWORK.fade) : 1);
      if (fireworkDone(f.age, f.life, f.fadeAt)) dropFirework(i);
    }

    const pulse = 0.85 + Math.sin(t * 1.7) * 0.15;
    mainLight.intensity = MAIN_I * pulse;
    lightCol.set(boards.accentOf('MAIN_TOP'));
    mainLight.color.lerp(lightCol, 0.05);
  }

  // ---- sizing / quality ---------------------------------------------------------------------------------
  let width = 1, height = 1;
  function resize() {
    const p = canvas.parentElement;
    width = Math.max(1, canvas.clientWidth || p?.clientWidth || innerWidth);
    height = Math.max(1, canvas.clientHeight || p?.clientHeight || innerHeight);
    const liveAspect = width / Math.max(1, height);
    camera.aspect = watchPortrait ? (Math.abs(liveAspect - 9 / 16) < 0.08 ? liveAspect : 9 / 16) : liveAspect;
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
  // Start at the FOV this frame shape wants (about 72° in portrait); later changes are eased in step().
  camera.fov = portraitFov(camera.aspect, baseFov);
  camera.updateProjectionMatrix();

  // ---- WebGL context loss -------------------------------------------------------------------------------------
  // The browser may take the context away (tab in the background, GPU reset). three.js re-uploads geometry and
  // textures after a restore, but render-target contents are gone: the environment map is rebuilt and the boards
  // are painted again. If the context is not back in 4 s the player gets a tap-to-reload notice.
  let ctxLost = false, ctxTimer = 0;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    ctxLost = true;
    tell('화면을 다시 불러오는 중…');
    clearTimeout(ctxTimer);
    ctxTimer = setTimeout(() => { if (ctxLost) tell('화면이 돌아오지 않아요. 여기를 눌러 새로고침해 주세요', 'err', { reload: true }); }, 4000);
  }, { signal });
  canvas.addEventListener('webglcontextrestored', () => {
    ctxLost = false;
    clearTimeout(ctxTimer);
    try {
      const room2 = new RoomEnvironment();
      const next = pmrem.fromScene(room2, 0.04);
      room2.dispose();
      envRT.dispose();
      envRT = next;
      scene.environment = envRT.texture;
      scene.environmentIntensity = 0.25;
      buildPhotoEnv();
      boards.repaintAll();
      resize();
    } catch (err) { console.error('[context]', err); }
  }, { signal });

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
    if (beaconSlot && !beaconGroup) placeBeacon();
    step(dt, elapsed, performance.now());
    if (ctxLost) return; // the world (and presence) keeps stepping; nothing can be drawn until the context is back
    reflection.update(scene, camera);
    composer.render();
    adapt(dt);
  }
  function start() { if (running) return; running = true; clock.getDelta(); raf = requestAnimationFrame(frame); }
  function stop() { running = false; cancelAnimationFrame(raf); }
  function dispose() {
    stop();
    clearTimeout(ctxTimer);
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
  let roofShown = '';
  let roofSprite = null;
  const pendingRoof = paintRoof.pending;
  paintRoof = function (name) {
    const text = String(name || '').slice(0, 16);
    if (text === roofShown && (text ? roofSprite : !roofSprite)) return;
    roofShown = text;
    if (roofSprite) {
      scene.remove(roofSprite);
      roofSprite.material.map?.dispose();
      roofSprite.material.dispose();
      roofSprite = null;
    }
    if (!text) return;
    const canvas = makeCanvas(512, 96);
    paintLabel(canvas, text, '#ffe7a3', '#07070d');
    const map = new THREE.CanvasTexture(canvas);
    roofSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false }));
    roofSprite.position.set(roof.x, roof.h + 40, roof.z);
    roofSprite.scale.set(16, 3, 1);
    scene.add(roofSprite);
  };
  if (pendingRoof != null) paintRoof(pendingRoof);
  function hideStockBall() {
    scene.traverse((o) => {
      if (!o.isMesh || o.geometry?.parameters?.radius !== 2.4) return;
      if (Math.hypot(o.position.x - roof.x, o.position.z - roof.z) < 2) o.visible = false;
    });
  }
  const fever = { gauge: 0, phase: 'idle', until: 0, confetti: 0 };
  const night = { phase: 'idle', until: 0 };
  function openPlaza() {
    if (night.phase === 'drop' || fever.phase !== 'idle') return;
    night.phase = 'drop';
    night.until = performance.now() + 10000;
  }
  function feverLive() { return fever.phase === 'party' && performance.now() < fever.until; }
  function rejectFever() {
    if (fever.phase !== 'party' && fever.phase !== 'count') return;
    fever.phase = 'idle';
    fever.gauge = Math.min(19, fever.gauge);
    fever.until = 0;
    lasers.visible = false;
  }
  function feverHud() {
    const left = fever.phase === 'idle' ? 0 : Math.max(0, (fever.until - performance.now()) / 1000);
    return { gauge: fever.gauge, phase: fever.phase, left };
  }
  function setFever(gauge, untilMs) {
    const end = Number(untilMs) || 0;
    if (end > Date.now()) {
      fever.phase = 'party';
      fever.gauge = 20;
      fever.until = performance.now() + (end - Date.now());
      return fever.gauge;
    }
    if (fever.phase !== 'idle') return fever.gauge;
    const n = Math.max(0, Math.min(20, Math.floor(Number(gauge)) || 0));
    fever.gauge = n;
    if (n >= 20) {
      fever.phase = 'count';
      fever.until = performance.now() + 10000;
      opts.onFever?.({ phase: 'count', gauge: 20, left: 10 });
    }
    return fever.gauge;
  }
  function bumpFever() { return setFever((fever.gauge || 0) + 1); }
  function stepFever(t) {
    const now = performance.now();
    ball.rotation.y += 0.01;
    glowBall.scale.setScalar(1 + Math.sin(t * 3) * 0.04);
    if (fever.phase === 'idle' && night.phase === 'drop') {
      const u = Math.min(1, 1 - Math.max(0, night.until - now) / 10000);
      const y = crystalHome + (crystalLow - crystalHome) * (u * u);
      ball.position.y = y;
      glowBall.position.y = y;
      lasers.visible = true;
      lasers.rotation.y = t;
      lasers.position.y = ball.position.y - 14;
      if (now >= night.until) {
        night.phase = 'idle';
        burst(crystal.position.clone().setY(roof.h + y), '#ffe7a3', 80, 1.1);
        lasers.visible = false;
      }
      return;
    }
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
    const to = boards.worldPos(slot);
    if (!to) return false;
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
      burst(s.to.clone(), '#ffcf5a', 28, 0.45);
      shots.splice(i, 1);
    }
  }
  function glyphList(list) {
    const out = [];
    for (const item of Array.isArray(list) ? list : []) {
      const g = typeof item === 'string' ? item : item?.g;
      if (STICKER_GLYPHS.includes(g) && out.length < 8) out.push({ g, c: out.length % 4 });
    }
    return out;
  }
  function putStickers(slot, list) {
    if (!list.length) stickerMap.delete(slot);
    else stickerMap.set(slot, list);
    boards.setDecals(slot, list);
  }
  function applyStk(msg) {
    if (Array.isArray(msg?.all)) {
      const keep = new Set();
      for (const row of msg.all) {
        const slot = String(row?.slot || '');
        if (!slot) continue;
        keep.add(slot);
        putStickers(slot, glyphList(row.list));
      }
      for (const slot of [...stickerMap.keys()]) if (!keep.has(slot)) putStickers(slot, []);
    } else if (msg?.slot) putStickers(String(msg.slot), glyphList(msg.list));
    saveStickers();
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

  let beaconSlot = null;
  let beaconGroup = null;
  let mapPin = null;
  function clearBeaconMesh() {
    if (!beaconGroup) return;
    scene.remove(beaconGroup);
    beaconGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    beaconGroup = null;
  }
  function placeBeacon() {
    if (!beaconSlot) {
      clearBeaconMesh();
      mapPin = null;
      return;
    }
    const p = boards.worldPos(beaconSlot);
    if (!p) return;
    mapPin = { slot: beaconSlot, x: p.x, z: p.z };
    if (!beaconGroup) {
      const beam = new THREE.Mesh(crossBeamGeo(BEAM_W, 70), beamMat(GO_HERE));
      beaconGroup = new THREE.Group();
      beaconGroup.add(beam);
      scene.add(beaconGroup);
    }
    beaconGroup.visible = true;
    beaconGroup.position.set(p.x, groundHeight(p.x, p.z), p.z);
  }
  function setMyBeacon(slotId) {
    beaconSlot = slotId || null;
    if (!beaconSlot) {
      clearBeaconMesh();
      mapPin = null;
      return;
    }
    placeBeacon();
  }
  function pinSlot(slotId) {
    if (!slotId) {
      mapPin = null;
      return;
    }
    const p = boards.worldPos(slotId);
    mapPin = p ? { slot: slotId, x: p.x, z: p.z } : null;
    if (slotId !== beaconSlot) return;
    placeBeacon();
  }
  const ghostMarks = [];
  const GHOST_MS = 10 * 60 * 1000;
  function dropGhost(i) {
    const g = ghostMarks[i];
    scene.remove(g.sprite);
    g.sprite.material.map?.dispose();
    g.sprite.material.dispose();
    ghostMarks.splice(i, 1);
  }
  function showGhost(msg) {
    if (msg.k && opts.actorId?.() === msg.k) return;
    const name = chars(String(msg?.name || ''), 12);
    if (!name) return;
    const x = fromNetUnits(msg.x);
    const z = fromNetUnits(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const label = makeCanvas(256, 64);
    paintLabel(label, name, '#d7e4ff');
    const map = new THREE.CanvasTexture(label);
    map.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, opacity: 0.78 }));
    sprite.position.set(x, groundHeight(x, z) + 2.05, z);
    sprite.scale.set(2.2, 0.55, 1);
    scene.add(sprite);
    ghostMarks.push({ sprite, until: performance.now() + GHOST_MS });
    while (ghostMarks.length > 8) dropGhost(0);
  }
  function stepGhosts(now) {
    for (let i = ghostMarks.length - 1; i >= 0; i--) if (now >= ghostMarks[i].until) dropGhost(i);
  }
  function setWatchPortrait(on) {
    watchPortrait = !!on;
    resize();
  }

  let prefetchArmed = false;
  const api = {
    canvas, scene, camera, renderer, quality,
    start, stop, dispose, resize,
    updateWorld, updateBillboardTexture, applyPlot,
    playEmote, playEmoji: playEmote, playReaction, showReaction, jump, interact, cheerAt, fountainSplash,
    setJoystick(x, y) { joy.x = clamp(Number(x) || 0, -1, 1); joy.y = clamp(Number(y) || 0, -1, 1); },
    // A touch on the stick's area that may be a tap: the same rules as a tap on the canvas (moved <= 7 px, under 450 ms).
    tapDown(x, y) { onDown({ clientX: x, clientY: y }); },
    tapUp(x, y) { onUp({ clientX: x, clientY: y }); },
    // The city is built and its collision is in: until then the player is not let loose (ui.js enter fallback).
    built: () => !!(nyc && world) || cityFailed,
    setInputEnabled(v) { inputEnabled = !!v; if (!inputEnabled) { keys.clear(); joy.x = 0; joy.y = 0; } },
    setName(n) { name = chars(n || '네온손님', 16) || '네온손님'; me.setName(name); },
    setColor(c) { if (!COLOR_RE.test(c || '')) return; color = c; me.setColor(c); },
    setSpecies(id) { species = speciesId(id); me.setSpecies(species); netState.av = species; },
    // A species picked in the character sheet: start its download now so saving swaps sooner.
    wantSpecies(id) { avatars.want(speciesId(id)); },
    // After entering: a minute later, while idle, fetch the species the room's other players wear (most worn first, a few at
    // most), so a peer walking into view already has its body. Skipped on low tier and Save-Data; on-sight want() covers the rest.
    prefetchAvatars() {
      const ms = prefetchDelay({ quality, saveData: !!navigator.connection?.saveData });
      if (ms == null || prefetchArmed) return;
      prefetchArmed = true;
      const run = () => avatars.prefetch(prefetchIds([...remotes.values()].map((r) => r.av.species), { loaded: avatars.sys.species, missing: avatars.sys.missing }));
      setTimeout(() => (window.requestIdleCallback || ((f) => setTimeout(f, 0)))(run, { timeout: 15000 }), ms);
    },
    setEquip(ids) {
      myEquip = (Array.isArray(ids) ? ids : []).map((id) => String(id || '')).filter((id) => id && id !== 'taxi').slice(0, EQUIP_MAX);
      me.setEquip(myEquip);
      paintMyFrames();
      if (drive) traffic?.setCabTint(drive.i, cabTint(myEquip));
    },
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
    boardView: (id) => boards.get(id)?.data || null,
    setMonopoly(on) { boards.setShow?.(!!on); },
    // A board taken from its holder: the claim fireworks in gold, unless that claim already set them off.
    strike(slotId) { celebrateBoard(slotId, '#ffcf5a'); },
    giftPop,
    topTeam,
    endFocus() {
      if (!cine) { if (hidMe || lounge) endCine(); opts.onFocus?.(false); return; }
      endCine();
    },
    // Deep links and QR codes: put the avatar at the board's front point (the same local teleport the map uses; the
    // position still comes only from this client) facing the board. Returns the point, or null when the board is not
    // on the map or its front is outside the fence.
    goToSlot(slotId) {
      const pose = slotPose(slotId, 18);
      if (!pose || !insideLoop(pose.front.x, pose.front.z, 0)) return null;
      api.teleport(pose.front.x, pose.front.z);
      const dx = pose.look.x - pos.x, dz = pose.look.z - pos.z;
      if (dx * dx + dz * dz > 1) {
        yaw = Math.atan2(dx, dz);
        me.holder.rotation.y = yaw;
        camWant.set(pos.x - Math.sin(yaw) * 8.2, pos.y + eye + 1.4, pos.z - Math.cos(yaw) * 8.2);
        camera.position.copy(camWant);
      }
      // The view was cut to the new place: a camera move that starts now must not swing in from the old one.
      viewLook.copy(follow);
      camera.lookAt(follow);
      return { x: pos.x, z: pos.z };
    },
    cineOn: () => !!cine || lounge,
    setBoost(on) { boostHeld = !!on; },
    setWaypoint,
    getPlayer() { return playerInfo; },
    netState() { return netState; },
    near() { return near; },
    isDriving: () => !!drive,
    exitTaxi,
    startStars, removeStar, clearStars, removeCoin, holdCoin,
    capture() {
      // The picture is taken without my own name tag (the frame loop decides its visibility again on the next frame).
      const tagOn = me.tag.visible;
      me.tag.visible = false;
      try { composer.render(); } finally { me.tag.visible = tagOn; }
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
    // 오늘의 소원 on every screen that is not live: list is 0–24 {id, nick, txt, hearts}; [] or missing turns it off.
    setWishes(list) { boards.setWishes(list); },
    // Shows that wish (must be in the current list) on up to 4 nearest idle boards now, for one card duration; true if shown.
    pinWish(id) { return boards.pinWish(id); },
    // 밤 9시 소원왕: {nick, txt, hearts} puts yesterday's top wish on every claimable board but the main tower; null ends it.
    setKing(k) { boards.setKing(k); },
    showGhost,
    setWatchPortrait,
    // 멍때리기: only the camera tours the boards (tourNext, every 8 s); the avatar stays where it stands.
    // false when it cannot start (in a taxi).
    startLounge() {
      if (drive) { tell('운전 중에는 내린 뒤에 볼 수 있어요'); return false; }
      lounge = true;
      loungeAt = 0;
      loungeI = 0;
      return true;
    },
    stopLounge() {
      const had = !!cine && !cine.back;
      endCine();
      if (!had) opts.onFocus?.(false);
    },
    throwPouch,
    bumpFever, setFever, rejectFever,
    openPlaza,
    setRoof: (name) => paintRoof(name),
    launchSticker,
    applyStk,
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
      boardAt = 0; // the next frame looks for the board in front of the new spot at once
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
      const out = { driving: !!drive, speed: drive ? Math.abs(drive.v) * 3.6 : 0, fare: drive ? drive.fare : 0, job: null, waypoint: null, where: where(), train: null, fever: feverHud(), hive: hiveHint };
      if (drive && job.phase === 'ride' && job.riders > 0) out.train = { riders: job.riders, mult: taxiTrainMult(job.riders) };
      if (drive && job.phase !== 'none') {
        const aim = job.phase === 'pickup' ? job.target : job.dest;
        if (aim) out.job = { phase: job.phase, dist: Math.hypot(aim.x - pos.x, aim.z - pos.z), bearing: bearingTo(aim.x, aim.z), left: job.phase === 'ride' ? Math.max(0, job.limit - (clockT - job.t0)) : null, limit: job.limit, riders: job.riders || 0, wait: job.wait || 0 };
      }
      // offerIn: seconds until the next passenger (the fare gap); exitArmed: the 택시 내리기 warning is waiting for a second press.
      if (drive && job.phase === 'none') out.offerIn = Math.max(0, job.nextAt - clockT);
      if (drive) out.exitArmed = exitArmed > performance.now();
      if (drive?.exiting) out.exiting = true;
      if (waypoint) out.waypoint = { dist: Math.hypot(waypoint.x - pos.x, waypoint.z - pos.z), bearing: bearingTo(waypoint.x, waypoint.z) };
      return out;
    },
    setMyBeacon,
    pinSlot,
    minimap() {
      const peers = [];
      for (const r of remotes.values()) peers.push({ x: r.x, z: r.z, color: r.av.color });
      const st = [];
      for (const s of stars.values()) if (s.g.visible) st.push({ x: s.x, z: s.z });
      const coinDots = [];
      for (const c of coins) if (c.mesh.visible) coinDots.push({ x: c.x, z: c.z });
      const lv = [];
      for (const rec of marks?.plots.values() || []) lv.push({ id: rec.id, level: rec.level, color: rec.color, mine: !!rec.data?.owner_id && rec.data.owner_id === opts.actorId?.() });
      const cd = camera.getWorldDirection(tmp);
      const jobTarget = drive && job.phase !== 'none' ? (job.phase === 'pickup' ? { ...job.target, kind: 'pickup' } : { ...job.dest, kind: 'drop' }) : null;
      return { me: { x: pos.x, z: pos.z, yaw }, camYaw: Math.atan2(cd.x, cd.z), peers, stars: st, coins: coinDots, plots: lv, taxis: traffic?.positions() || [], driving: !!drive, job: jobTarget, waypoint, pin: mapPin };
    },
  };
  loadStickers();
  if (opts.autostart !== false) start();
  return api;
}
