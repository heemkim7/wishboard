// LED billboard screens: shader-animated materials, curved screens with bezels and
// scrolling news tickers, and the slot registry (MAIN_S, SUB_B1..4, PLOT_1..20).
import * as THREE from 'three';
import { Kit, arcSlab } from './kit.js?v=202611210015';
import { THEMES, makeCanvas, paintBillboard, paintTicker, fontsReady, tierOf, boardPhoto, photoReady, SANS, rgba, chars, paintWish, wishOrd, wishRotates, wishStrip, cleanWishes, sameWishes, rowUntil, wishPlan, wishRelist, wishFontTargets, wishPinPlan, freshWish, wishSettled, WISH_CYCLE, WISH_CYCLE_LOW, WISH_BUDGET, WISH_BUDGET_LOW, WISH_NOW, WISH_DROPS } from './art.js?v=202611210015';
import { askBid } from '../balance.js';
import { floorOf, live } from '../balance.js';
import { auctionClosed } from '../balance.js';
import { nowMs, kingCovers } from '../live.js';

export const screenTime = { value: 0 };

/** Unlit LED material: dot-matrix pixels up close, light sweep, gentle scan flicker. */
export function screenMaterial(map, { gain = 1.6, grid = [208, 117], led = 1, sweep = 1 } = {}) {
  const m = new THREE.MeshBasicMaterial({ map, color: new THREE.Color(gain, gain, gain) });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = screenTime;
    sh.uniforms.uGrid = { value: new THREE.Vector2(grid[0], grid[1]) };
    sh.uniforms.uLed = { value: led };
    sh.uniforms.uSweep = { value: sweep };
    m.userData.sweep = sh.uniforms.uSweep;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec2 uGrid;\nuniform float uLed;\nuniform float uSweep;')
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
{
  vec2 gp = vMapUv * uGrid;
  vec2 f = abs(fract(gp) - 0.5);
  float fw = max(fwidth(gp.x), fwidth(gp.y));
  float cell = 1.0 - smoothstep(0.3, 0.5, max(f.x, f.y));
  float ledMask = mix(0.74 + 0.26 * cell, 1.0, smoothstep(0.3, 0.85, fw));
  diffuseColor.rgb *= mix(1.0, ledMask, uLed);
  float tt = uTime * uSweep;
  float s = fract(tt * 0.06 + vMapUv.x * 0.5 - vMapUv.y * 0.28);
  float band = smoothstep(0.0, 0.03, s) * (1.0 - smoothstep(0.03, 0.1, s));
  diffuseColor.rgb += band * 0.2 * uSweep * (0.5 + diffuseColor.rgb);
  diffuseColor.rgb *= 0.95 + 0.05 * sin(tt * 2.1 + vMapUv.y * 37.0);
  float edge = min(min(vMapUv.x, vMapUv.y), min(1.0 - vMapUv.x, 1.0 - vMapUv.y));
  float rim = 1.0 - smoothstep(0.0, 0.028, edge);
  float around = vMapUv.x;
  if (vMapUv.y > 0.972) around = 1.0 + (1.0 - vMapUv.x);
  else if (vMapUv.x > 0.972) around = 2.0 + (1.0 - vMapUv.y);
  else if (vMapUv.y < 0.028) around = 3.0 + vMapUv.x;
  else if (vMapUv.x < 0.028) around = 4.0 + vMapUv.y;
  float chase = fract(around * 0.25 - tt * 0.35);
  float lamp = smoothstep(0.0, 0.015, chase) * (1.0 - smoothstep(0.015, 0.14, chase));
  diffuseColor.rgb += rim * (0.18 + lamp * 1.35) * vec3(0.45, 0.95, 1.0);
  if (vMapUv.y < 0.42 && vMapUv.y > 0.1) {
    float gx = abs(fract(vMapUv.x * 14.0 - tt * 0.35) - 0.5);
    float gy = abs(fract(vMapUv.y * 9.0 + tt * 0.45) - 0.5);
    float grid = 1.0 - smoothstep(0.0, 0.08, min(gx, gy));
    float wave = 1.0 - smoothstep(0.0, 0.035, abs(vMapUv.y - 0.26 - 0.05 * sin(vMapUv.x * 12.0 + tt * 2.1)));
    diffuseColor.rgb += vec3(0.15, 0.75, 1.0) * grid * 0.28 + vec3(1.0, 0.25, 0.62) * wave * 0.55;
  }
  if (vMapUv.y < 0.085) {
    float slide = fract(vMapUv.x - tt * 0.15);
    float bit = smoothstep(0.0, 0.03, fract(slide * 9.0)) * (1.0 - smoothstep(0.03, 0.11, fract(slide * 9.0)));
    diffuseColor.rgb += vec3(1.0, 0.78, 0.25) * bit * 0.65;
  }
}
#endif`);
  };
  m.customProgramCacheKey = () => 'kts-led-screen';
  return m;
}

/** Cylinder-segment screen whose apex sits at the origin facing +z. */
export function curvedGeometry(w, h, R, seg = 40) {
  const theta = w / R;
  const geo = new THREE.CylinderGeometry(R, R, h, seg, 1, true, -theta / 2, theta);
  geo.translate(0, 0, -R);
  return geo;
}

function scaleU(geo, factor) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * factor);
  return geo;
}

// House notice for a vacant screen (never held, or the hold expired): the slot and its real floor price, never a made-up wish.
function defaultData(slotId) {
  const tier = tierOf(slotId);
  const price = (floorOf(slotId) || 0).toLocaleString('en-US') + ' 코인부터';
  let row;
  if (tier === 'S') {
    row = { slot_id: slotId, emoji: '📢', bg_theme: 'cyber_navy', text_color: '#ffffff', line1: '이 자리를 점령하세요', line2: '타임스퀘어 메인 타워', line3: price, holder_id: null };
  } else if (String(slotId).startsWith('STREET_')) {
    const n = Number(String(slotId).slice(7)) || 1;
    row = { slot_id: slotId, emoji: '🌃', bg_theme: 'cyber_navy', text_color: '#ffffff', line1: `${n}번 메인거리`, line2: '거리 쪽 큰 화면', line3: price, holder_id: null };
  } else if (tier === 'B') {
    const n = Number(String(slotId).replace(/\D/g, '')) || 1;
    const upper = /A$/.test(slotId);
    const theme = ['neon_pink', 'gold_luxury', 'sunset_red', 'matrix_green'][(n - 1) % 4];
    row = { slot_id: slotId, emoji: ['💖', '👑', '🌇', '💎'][(n - 1) % 4], bg_theme: theme, text_color: '#ffffff', line1: `${n}번 코너 ${upper ? '상단' : '하단'}`, line2: '내 이름을 뉴욕 한복판에', line3: price, holder_id: null };
  } else {
    const n = Number(String(slotId).replace(/\D/g, '')) || 1;
    const theme = ['matrix_green', 'neon_pink', 'sunset_red', 'cyber_navy', 'gold_luxury'][n % 5];
    row = { slot_id: slotId, emoji: '🌟', bg_theme: theme, text_color: '#ffffff', line1: `${n}번 분양 전광판`, line2: '건물 앞 큰 화면', line3: price, holder_id: null };
  }
  return row;
}

const sigOf = (d) => [d.line1, d.line2, d.line3, d.emoji, d.bg_theme, d.text_color, d.holder_name, d.holder_id, d.photo_id, d.photo_status, d.external_url, d.views, d.clicks, d.cheers, d.lit_days, d.taken_from, ...(d.notes || [])].join('\u0001');

export function createBoards({ renderer, kitMats, onBurst, pick, quality }) {
  const boards = new Map();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const plates = new WeakMap();
  let liveHead = 'WISH BOARD  ·  모두의 전광판  ·  코인을 모아 이 화면을 점령하세요  ·  ';
  let liveAcc = 0, liveTick = 0, towerOpen = !auctionClosed('MAIN_TOP', nowMs());
  // 오늘의 소원: idle boards alternate their notice with a wish card. Rotation repaints happen only on the 0.64 s cadence
  // (update() → wishPlan): at most wishBudget per tick (nearest first, then oldest waiting) plus WISH_DROPS clears of boards
  // whose wish left the list. A list change or a loaded font repaints at most the WISH_NOW nearest boards in that call.
  // Pins (a just-posted wish, pinWish) repaint at most WISH_PINS boards.
  const wishCyc = quality === 'low' ? WISH_CYCLE_LOW : WISH_CYCLE;
  const wishBudget = quality === 'low' ? WISH_BUDGET_LOW : WISH_BUDGET;
  const wishSeen = new Set(), wishFonts = new Set();
  const wishFontsOk = new Set();
  const planCfg = { list: [], now: 0, cyc: wishCyc, budget: wishBudget, drops: WISH_DROPS, since: new Array(64), rank: new Array(64), who: new Array(64), pick: [], delta: 0 };
  const nearB = [], nearOk = [], planOut = [], relistRes = { delta: 0 };
  let wishes = [], wishShown = 0, wishFirstAt = 0, wishNonEmpty = false, lastNear = [];
  const fontKey = (w) => w.id + '\u0001' + w.txt + '\u0001' + w.nick;
  // The nearest-first boards of the last update() into nearB (reused array); returns how many.
  function fillNear() {
    const near = lastNear;
    for (let i = 0; i < near.length; i++) nearB[i] = near[i].b;
    nearB.length = near.length;
    return near.length;
  }
  function tune(tex) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = aniso;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }
  function remember(canvas) {
    let plate = plates.get(canvas);
    if (!plate || plate.width !== canvas.width || plate.height !== canvas.height) {
      plate = makeCanvas(canvas.width, canvas.height);
      plates.set(canvas, plate);
    }
    plate.getContext('2d').drawImage(canvas, 0, 0);
    return plate;
  }
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 0.38, metalness: 0.85 });
  const backMat = new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.6, metalness: 0.6, side: THREE.DoubleSide });
  const tickerCanvas = makeCanvas(4096, 64);
  paintTicker(tickerCanvas, 'WISH BOARD  ·  모두의 전광판  ·  코인을 모아 이 화면을 점령하세요');
  const tickerTex = new THREE.CanvasTexture(tickerCanvas);
  tickerTex.colorSpace = THREE.SRGBColorSpace;
  tickerTex.wrapS = THREE.RepeatWrapping;
  tickerTex.anisotropy = aniso;
  const tickerMat = screenMaterial(tickerTex, { gain: 1.35, grid: [1400, 22], sweep: 0 });
  const tmp = new THREE.Vector3();

  const vacantCanvas = makeCanvas(512, 288);
  paintBillboard(vacantCanvas, { slot_id: 'WALL_1', emoji: '📢', bg_theme: 'cyber_navy', text_color: '#ffffff', line1: '이 자리를 점령하세요', line2: '타임스퀘어 건물 전광판', line3: '가격은 자리를 누르면', holder_id: null });
  const vacantTex = tune(new THREE.CanvasTexture(vacantCanvas));
  remember(vacantCanvas);
  const vacantMat = screenMaterial(vacantTex, { gain: 1.06, grid: [128, 72] });

  const CLAIM = /^(MAIN_(UP|TOP|MID|BOT|LOW)|SUB_[1-4][AB]|STREET_([1-9]|[12]\d|30)|PLOT_([1-9]|1[0-8]))$/;
  let air = null;
  let opsLine = '';
  function airOn() { return !!(air && air.until > Date.now()); }
  // 밤 9시 소원왕 (setKing, main.js decides the minute): claimable boards outside the main tower show yesterday's top wish
  // full-face. A live takeover wins. Entering and leaving repaint at most kingBudget boards per 0.08 s tick, nearest first.
  // A wish card gives way only when its board turns (wishOk), so the wish tick never drops every card at once for the king.
  const kingBudget = quality === 'low' ? 1 : 3;
  const KING_CARD = { chip: '👑 어제의 소원왕', strip: '👑 어제 하트를 가장 많이 받은 소원' };
  let king = null, kingDirty = false, kingGen = 0;
  function kingFor(b) { return !!king && !b.shared && CLAIM.test(b.slotId) && !String(b.slotId).startsWith('MAIN_') && !airOn() && kingCovers(live(b.row)); } // NINE.overLit
  // b.kingOn: the kingGen whose card this board shows, 0 for none. A board is stale when it differs from kingWant.
  const kingWant = (b) => (kingFor(b) ? kingGen : 0);
  function airRow(b) {
    const glyphs = Array.from(String(air?.line || ''));
    return {
      slot_id: b.slotId, emoji: '📣', bg_theme: 'gold_luxury', text_color: '#fff6d0',
      line1: glyphs.slice(0, 12).join('') || '전광판 장악',
      line2: glyphs.slice(12, 24).join('') || chars(air?.nick || '', 16),
      line3: chars(air?.nick || '', 16),
      holder_name: chars(air?.nick || '', 16),
      holder_id: 'air',
    };
  }
  function drawBadge(g, W, H, d, i) {
    const text = chars(String(d?.g || ''), 12);
    if (!text) return;
    const k = W / 1024;
    const bw = Math.min(W * 0.46, 360 * k);
    const bh = Math.max(26, 46 * k);
    const corner = (Math.floor(Number(d.c) || 0) % 4);
    const stack = Math.floor(i / 4);
    const x = corner % 2 === 0 ? 14 * k : W - bw - 14 * k;
    const y = (corner < 2 ? 14 * k : H * 0.5) + stack * (bh + 6 * k);
    g.save();
    g.fillStyle = 'rgba(10, 6, 24, 0.88)';
    g.strokeStyle = '#ffcf5a';
    g.lineWidth = Math.max(2, 3 * k);
    g.shadowColor = '#ffcf5a';
    g.shadowBlur = 16 * k;
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, bw, bh, 10 * k);
    else g.rect(x, y, bw, bh);
    g.fill();
    g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = '#fff6d0';
    g.font = `800 ${Math.max(14, Math.round(22 * k))}px ${SANS}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, x + bw / 2, y + bh / 2);
    g.restore();
  }
  function applyOverlay(b) {
    if (!b?.canvas || b.shared) return;
    if (airOn()) {
      paintBillboard(b.canvas, airRow(b));
      return;
    }
    const list = b.decals || [];
    // Stickers stay on the notice; a wish card is left clean (corner 0 would cover its chip, the side ones its text).
    if (!list.length || b.wish || b.kingOn) return;
    const g = b.canvas.getContext('2d');
    for (let i = 0; i < list.length; i++) drawBadge(g, b.canvas.width, b.canvas.height, list[i], i);
  }
  function eachClaim(fn) {
    for (const b of boards.values()) if (CLAIM.test(b.slotId) && b.mounts.length && !b.shared) fn(b);
  }
  function setAir(next) {
    air = next && Number(next.until) > Date.now()
      ? { nick: chars(next.nick || '', 16), line: chars(next.line || '', 24), until: Number(next.until) }
      : null;
    if (!air) { repaintAll(); return; }
    eachClaim((b) => paint(b));
  }
  function setDecals(slotId, list) {
    const b = ensure(slotId);
    if (!b || b.shared) return false;
    b.decals = Array.isArray(list) ? list.slice(0, 8).map((d, i) => ({ g: chars(String(d?.g || ''), 12), c: (Math.floor(Number(d?.c) || i) % 4) })).filter((d) => d.g) : [];
    paint(b);
    return true;
  }

  function wishOk(b) { return wishes.length > 0 && !b.shared && b.mounts.length > 0 && wishRotates(b.slotId, b.row, airOn(), towerOpen, Date.now(), b.untilMs) && !kingFor(b); }
  function dropWish(b) {
    if (b.wish) wishShown--;
    b.wish = null;
    b.wishPin = 0;
    b.wishKey = -1;
    b.wishDue = 0;
    b.wishDrop = false;
  }
  // The card replaces only the artwork; b.data (the notice), decals and the click target stay as they are.
  function paintCard(b) {
    b.wishMsg = wishStrip(b.slotId, b.row, towerOpen);
    paintWish(b.canvas, b.wish, { strip: b.wishMsg, dark: !!b.row?.holder_id });
    b.wishFontOk = wishFontsOk.has(fontKey(b.wish));
    remember(b.canvas);
    applyOverlay(b);
    b.tex.needsUpdate = true;
  }
  function paint(b) {
    // A board marked by setWishes (its wish left the list or was edited) paints the notice, never the old wish.
    if (b.wish && (b.wishDrop || !wishOk(b))) dropWish(b);
    if (b.wish) { b.kingOn = 0; paintCard(b); return; }
    b.kingOn = kingWant(b);
    if (b.kingOn) { b.kingNick = king.nick; paintWish(b.canvas, king, KING_CARD); remember(b.canvas); b.tex.needsUpdate = true; return; }
    const d = b.data, id = d.photo_status === 'approved' && d.holder_id ? d.photo_id : null;
    const photo = id ? photoReady(id) : null;
    paintBillboard(b.canvas, d, { photo, pending: d.photo_status === 'pending', shield: b.shield || '' });
    remember(b.canvas);
    applyOverlay(b);
    b.tex.needsUpdate = true;
    if (id && !photo) boardPhoto(id).then((img) => { if (img && b.data.photo_id === id && b.data.photo_status === 'approved') paint(b); });
  }

  function ensure(slotId) {
    let b = boards.get(slotId);
    if (b) return b;
    const tier = tierOf(slotId);
    const share = false && tier === 'C';
    if (share) {
      b = { slotId, tier, canvas: vacantCanvas, tex: vacantTex, mat: vacantMat, data: defaultData(slotId), sig: '', mounts: [], shared: true };
      boards.set(slotId, b);
      return b;
    }
    const canvas = tier === 'C' ? makeCanvas(512, 288) : makeCanvas(1024, 576);
    const tex = tune(new THREE.CanvasTexture(canvas));
    const mat = screenMaterial(tex, { gain: tier === 'S' ? 1.16 : tier === 'B' ? 1.12 : 1.06, grid: tier === 'C' ? [128, 72] : [256, 144] });
    b = { slotId, tier, canvas, tex, mat, data: defaultData(slotId), sig: '', mounts: [], wish: null, wishKey: -1, wishPin: 0, wishDue: 0, wishDrop: false, wishFontOk: false, wishOrd: wishOrd(slotId), wishMsg: '', untilMs: 0 };
    b.sig = sigOf(b.data);
    boards.set(slotId, b);
    paint(b);
    return b;
  }

  /** spec: {x,y,z,ry,w,h,curve,ticker,frame,marquee} — (x,y,z) is the screen center (apex for curved). */
  function mount(slotId, parent, spec) {
    const b = ensure(slotId);
    const group = new THREE.Group();
    group.position.set(spec.x || 0, spec.y || 0, spec.z || 0);
    group.rotation.y = spec.ry || 0;
    // Artwork is 16:9. A taller or wider mesh squishes the letters, so fit inside the slot.
    let { w, h } = spec;
    if (w > 0 && h > 0) {
      if (w / h > 16 / 9) w = h * 16 / 9;
      else h = w * 9 / 16;
    }
    const R = spec.curve || 0;
    const geo = R ? curvedGeometry(w, h, R) : new THREE.PlaneGeometry(w, h);
    const screen = new THREE.Mesh(geo, b.mat);
    screen.userData.pick = { kind: 'billboard', slotId };
    group.add(screen);
    pick.push(screen);
    const kit = new Kit();
    const theta = R ? w / R : 0;
    const accent = THEMES[b.data.bg_theme]?.accent || '#3fe6ff';
    if (R) {
      kit.add(arcSlab(R - 0.6, R + 0.18, theta + 0.02, 0.5, R), '#1a1c22', { y: h / 2, mat: 'metal' });
      kit.add(arcSlab(R - 0.6, R + 0.18, theta + 0.02, 0.5, R), '#1a1c22', { y: -h / 2 - 0.5, mat: 'metal' });
      kit.add(arcSlab(R + 0.16, R + 0.24, theta, 0.07, R), accent, { y: h / 2 + 0.02, glow: 2.2 });
      for (const sgn of [-1, 1]) {
        const a = sgn * theta / 2;
        kit.box(0.5, h + 1.0, 0.8, '#1a1c22', { x: R * Math.sin(a), y: 0, z: R * Math.cos(a) - R - 0.2, ry: a, mat: 'metal' });
      }
      const shell = new THREE.Mesh(curvedGeometry(w + 0.4, h + 1, R - 0.55, 24), backMat);
      shell.position.z = -0.55;
      group.add(shell);
      if (spec.marquee) {
        const n = Math.round(w / 0.7);
        for (let i = 0; i <= n; i++) {
          const a = -theta / 2 + (i / n) * theta;
          kit.sphere(0.09, '#fff1c8', { x: (R + 0.22) * Math.sin(a), y: h / 2 + 0.36, z: (R + 0.22) * Math.cos(a) - R, glow: 3, seg: 6 });
        }
      }
      if (spec.ticker) {
        const th = spec.tickerH || 1.3;
        const tg = curvedGeometry(w, th, R + 0.02, 40);
        scaleU(tg, (w / th) / (4096 / 64));
        const strip = new THREE.Mesh(tg, tickerMat);
        strip.position.y = -h / 2 - 0.5 - th / 2 - 0.12;
        group.add(strip);
        kit.add(arcSlab(R - 0.6, R + 0.18, theta + 0.02, 0.22, R), '#1a1c22', { y: -h / 2 - 0.5 - th - 0.34, mat: 'metal' });
        const back2 = new THREE.Mesh(curvedGeometry(w + 0.4, th + 0.6, R - 0.55, 24), backMat);
        back2.position.set(0, strip.position.y, -0.55);
        group.add(back2);
      }
    } else {
      const t = spec.frameT ?? 0.16;
      kit.box(w + t * 2, t, 0.22, '#1a1c22', { y: h / 2 + t / 2, z: -0.05, mat: 'metal' });
      kit.box(w + t * 2, t, 0.22, '#1a1c22', { y: -h / 2 - t / 2, z: -0.05, mat: 'metal' });
      kit.box(t, h, 0.22, '#1a1c22', { x: -w / 2 - t / 2, z: -0.05, mat: 'metal' });
      kit.box(t, h, 0.22, '#1a1c22', { x: w / 2 + t / 2, z: -0.05, mat: 'metal' });
      kit.box(w + t * 2, h + t * 2, 0.12, '#0b0c10', { z: -0.16, mat: 'metal' });
      kit.box(w + t * 2, 0.04, 0.05, accent, { y: h / 2 + t + 0.02, z: 0.03, glow: 3 });
    }
    const frame = kit.build({ ...kitMats, metal: frameMat });
    group.add(frame);
    const rim = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.7, h + 0.7), new THREE.MeshBasicMaterial({ color: 0xff1a1a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    rim.position.z = -0.01;
    rim.visible = false;
    group.add(rim);
    parent.add(group);
    const rec = { group, screen, w, h, R, rim };
    b.mounts.push(rec);
    if ((b.kingOn || 0) !== kingWant(b)) paint(b);
    return group;
  }

  function unmount(slotId, group) {
    const b = boards.get(slotId);
    if (!b) return;
    b.mounts = b.mounts.filter(m => m.group !== group);
    // Off the map: forget the card so the wish tick can stop, and leave the canvas on the notice for a later mount.
    if (!b.mounts.length && b.wish) { dropWish(b); paint(b); }
    group.traverse(o => {
      const i = pick.indexOf(o);
      if (i >= 0) pick.splice(i, 1);
      if (o.isMesh && o.geometry) o.geometry.dispose();
    });
    group.parent?.remove(group);
  }

  function worldPos(slotId, out = new THREE.Vector3()) {
    const b = boards.get(slotId);
    const m = b?.mounts[0];
    if (!m) return null;
    return m.screen.getWorldPosition(out);
  }

  function ownCanvas(b) {
    const canvas = makeCanvas(512, 288);
    const tex = tune(new THREE.CanvasTexture(canvas));
    b.canvas = canvas;
    b.tex = tex;
    b.mat = screenMaterial(tex, { gain: 1.06, grid: [128, 72] });
    b.shared = false;
    for (const m of b.mounts) m.screen.material = b.mat;
  }

  // b.row keeps what the server said. A live hold shows that ad. A dark hold keeps the owner's name. An empty slot shows the house notice.
  function set(slotId, row, celebrate) {
    const b = ensure(slotId);
    b.row = { ...b.row, ...row, slot_id: slotId };
    b.untilMs = rowUntil(b.row);
    const held = !!b.row?.holder_id;
    const next = live(b.row) ? b.row : held ? {
      ...defaultData(slotId),
      views: b.row.views,
      clicks: b.row.clicks,
      cheers: b.row.cheers,
      notes: b.row.notes,
      holder_id: b.row.holder_id,
      holder_name: b.row.holder_name,
      line1: '불 꺼짐',
      line2: '주인이 다시 켤 수 있어요',
      line3: (floorOf(slotId) || 0).toLocaleString('en-US') + ' 코인부터',
      emoji: '💡',
    } : { ...defaultData(slotId), views: b.row.views, clicks: b.row.clicks, cheers: b.row.cheers, ...(opsLine ? { line2: opsLine } : {}) };
    if (b.shared && !next.holder_id && !opsLine) { b.data = next; b.sig = sigOf(next); return false; }
    if (b.shared) ownCanvas(b);
    const sig = sigOf(next);
    const changed = sig !== b.sig;
    b.data = next;
    if (!changed) return false;
    b.sig = sig;
    paint(b);
    fontsReady([next.line1, next.line2, next.line3, next.holder_name].join(' ')).then(() => { if (b.sig === sig) paint(b); });
    if (celebrate && b.mounts.length) {
      const p = worldPos(slotId, tmp);
      if (p) onBurst?.(p.clone(), THEMES[next.bg_theme]?.accent || '#ffcf5a', b.tier);
    }
    return true;
  }
  /** Puts the house notice back on every screen whose hold has run out. True when a screen changed. */
  function expire() {
    let any = false;
    for (const b of boards.values()) if (b.data.holder_id && b.row && !live(b.row)) any = set(b.slotId, {}) || any;
    return any;
  }

  function setOps(copy) {
    const next = String(copy || '').slice(0, 80);
    if (next === opsLine) return;
    opsLine = next;
    for (const b of boards.values()) set(b.slotId, {}, false);
  }
  function setTicker(text) {
    paintTicker(tickerCanvas, text);
    tickerTex.needsUpdate = true;
    if (text) liveHead = `${text}      ✦      WISH BOARD  ·  모두의 전광판  ·  `;
  }

  function repaintAll() {
    for (const b of boards.values()) if (!b.shared) paint(b);
    tickerTex.needsUpdate = true;
  }

  function perimeterPoint(u, x0, y0, x1, y1) {
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    let d = (((u % 1) + 1) % 1) * 2 * (w + h);
    if (d < w) return { x: x0 + d, y: y0 };
    d -= w;
    if (d < h) return { x: x1, y: y0 + d };
    d -= h;
    if (d < w) return { x: x1 - d, y: y1 };
    d -= w;
    return { x: x0, y: y1 - d };
  }

  function drawLive(b, t) {
    const canvas = b.canvas;
    const plate = plates.get(canvas) || remember(canvas);
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, k = W / 1024;
    const theme = (b.shared ? THEMES.cyber_navy : THEMES[b.data?.bg_theme]) || THEMES.cyber_navy;
    const accent = theme.accent || '#3fe6ff';
    const accent2 = theme.accent2 || '#ff3d9a';
    const photoOn = b.data?.photo_status === 'approved' && b.data?.holder_id && b.data?.photo_id;
    const wishOn = !!b.wish, kingOn = !!b.kingOn;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(plate, 0, 0);

    const th = Math.max(18, Math.round(46 * k));
    const body = H - th;
    if (!photoOn && !wishOn && !kingOn) {
      g.save();
      g.beginPath();
      g.rect(0, H * 0.58, W, body - H * 0.58);
      g.clip();
      g.globalCompositeOperation = 'lighter';
      const gap = 22 * k;
      const shift = (t * 42) % gap;
      g.strokeStyle = rgba(accent, 0.28);
      g.lineWidth = Math.max(1, k);
      for (let x = -gap + shift; x < W; x += gap) {
        g.beginPath();
        g.moveTo(x, H * 0.58);
        g.lineTo(x + gap * 0.35, body);
        g.stroke();
      }
      const vShift = (t * 26) % (16 * k);
      for (let y = H * 0.6 + vShift; y < body; y += 16 * k) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
      }
      g.strokeStyle = rgba(accent2, 0.7);
      g.lineWidth = Math.max(1.5, 2.2 * k);
      g.beginPath();
      for (let x = 0; x <= W; x += 8 * k) {
        const y = H * 0.8 + Math.sin(x * 0.012 / Math.max(k, 0.4) + t * 2.3) * 14 * k + Math.sin(x * 0.004 - t * 1.2) * 6 * k;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.restore();
    }

    g.fillStyle = '#05060f';
    g.fillRect(0, body, W, th);
    g.fillStyle = accent;
    g.fillRect(0, body, W, Math.max(2, 2 * k));
    const onAir = live(b.row);
    const held = !!b.row?.holder_id;
    g.fillStyle = wishOn || kingOn ? '#9a5a24' : onAir ? '#ff2e4d' : held ? '#5c657a' : '#2a6f9e';
    g.fillRect(0, body, 108 * k, th);
    g.fillStyle = '#fff';
    g.font = `900 ${Math.max(11, Math.round(20 * k))}px ${SANS}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(kingOn ? '소원왕' : wishOn ? '소원' : onAir ? 'LIVE' : held ? '꺼짐' : '빈칸', 54 * k, body + th / 2);
    g.save();
    g.beginPath();
    g.rect(112 * k, body, Math.max(1, W - 112 * k), th);
    g.clip();
    g.font = `800 ${Math.max(12, Math.round(22 * k))}px ${SANS}`;
    g.textAlign = 'left';
    g.fillStyle = '#ffcf5a';
    const views = Math.max(0, Math.floor(Number(b.data?.views) || 0));
    const cheers = Math.max(0, Math.floor(Number(b.data?.cheers) || 0));
    const clicks = Math.max(0, Math.floor(Number(b.data?.clicks) || 0));
    const notes = Array.isArray(b.data?.notes) ? b.data.notes.map((t) => chars(String(t || ''), 16)).filter(Boolean).slice(-5) : [];
    const msg = kingOn ? `👑 어제의 소원왕   ·   ${chars(b.kingNick || '', 16)}   ·   ${liveHead}` : wishOn ? `🌠 오늘의 소원   ·   ${b.wishMsg}   ·   ${liveHead}` : `👁 택시 정차 ${views}회   ·   🙌 응원 ${cheers}회   ·   🔗 링크 클릭 ${clicks}회   ·   ${notes.length ? notes.join('   ·   ') + '   ·   ' : ''}${liveHead}`;
    const tw = Math.max(8, g.measureText(msg).width);
    const x0 = 120 * k - ((t * 90) % tw);
    g.fillText(msg, x0, body + th / 2);
    g.fillText(msg, x0 + tw, body + th / 2);
    g.restore();

    const inset = 8 * k;
    const n = 42;
    const head = (t * 0.42) % 1;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      let d = u - head;
      if (d < 0) d += 1;
      const hot = d < 0.14 ? 1 - d / 0.14 : 0.12;
      const p = perimeterPoint(u, inset, inset, W - inset, body - inset);
      g.globalAlpha = 0.35 + hot * 0.65;
      g.fillStyle = hot > 0.72 ? '#fff' : accent;
      g.beginPath();
      g.arc(p.x, p.y, (1.8 + hot * 2.8) * k, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    applyOverlay(b);
    b.tex.needsUpdate = true;
  }

  const showMeshes = [];
  function watchShow(holo, laser) { showMeshes[0] = holo; showMeshes[1] = laser; }
  function setShow(on) { for (const m of showMeshes) if (m) m.visible = !!on; }
  function shieldText(b) {
    const d = b.data;
    if (!d?.holder_id || !d.protected_until) return '';
    const until = d.lit_until || d.expires_at;
    const exp = until ? new Date(until).getTime() : 0;
    if (!(exp > Date.now())) return '';
    const left = new Date(d.protected_until).getTime() - Date.now();
    if (left > 60000) return '';
    if (left > 0) {
      const s = Math.ceil(left / 1000);
      return `방어막 ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }
    const rows = [...boards.values()].map((row) => row.data).filter(Boolean);
    const min = askBid(d, rows, '', '');
    return min > 0 ? `지금 빼기 가능 · ${min.toLocaleString('ko-KR')}코인부터` : '지금 빼기 가능';
  }
  function update(dt, cam) {
    tickerTex.offset.x = (tickerTex.offset.x + dt * 0.035) % 1;
    liveAcc += dt;
    if (liveAcc < 0.08) return;
    liveAcc = 0;
    liveTick++;
    const near = [];
    for (const b of boards.values()) {
      if (!b.mounts.length) continue;
      const p = worldPos(b.slotId);
      const d = cam && p ? cam.distanceToSquared(p) : 0;
      near.push({ b, d });
    }
    near.sort((a, b) => a.d - b.d);
    lastNear = near;
    if (kingDirty) kingStep();
    const hot = new Set(near.slice(0, 10).map((r) => r.b));
    const seen = new Set();
    for (const b of boards.values()) {
      const on = hot.has(b);
      if (b.mat?.userData?.sweep) b.mat.userData.sweep.value = on ? 1 : 0;
      if (!on || b.shared || seen.has(b.canvas)) continue;
      seen.add(b.canvas);
      drawLive(b, screenTime.value);
    }
    if (liveTick % 8 === 0) {
      const open = !auctionClosed('MAIN_TOP', nowMs());
      if (open !== towerOpen) {
        towerOpen = open;
        for (const b of boards.values()) {
          // Vacant ones change their notice; any main board showing a card (held or not) must lose it inside the window.
          if (String(b.slotId).startsWith('MAIN_') && (!b.data?.holder_id || b.wish) && !b.shared) paint(b);
        }
      }
      for (const b of boards.values()) {
        const text = shieldText(b);
        if (text !== (b.shield || '')) { b.shield = text; paint(b); }
        const warn = text.startsWith('방어막');
        for (const m of b.mounts) {
          if (!m.rim) continue;
          m.rim.visible = !!text || !!b.rimColor;
          m.rim.material.opacity = warn ? ((liveTick / 8) % 2 < 1 ? 0.62 : 0.16) : (b.rimColor ? 0.85 : 0.4);
          m.rim.material.color.set(warn ? 0xff1a1a : (b.rimColor || 0xffcf5a));
        }
      }
      if (wishes.length || wishShown) wishTick();
      if (showMeshes[1]?.visible) {
        const hues = [0xff3d4a, 0xffcf5a, 0x39f58a, 0x3fe6ff, 0xb84dff, 0xff7ad9];
        showMeshes[1].material.color.set(hues[(liveTick / 8) % hues.length | 0]);
      }
    }
  }

  // Boards whose king card state is wrong, nearest first, kingBudget per tick; the rest wait for the next tick.
  function kingStep() {
    let left = kingBudget;
    kingDirty = false;
    for (let i = 0; i < lastNear.length; i++) {
      const b = lastNear[i].b;
      if (b.shared || (b.kingOn || 0) === kingWant(b)) continue;
      if (left-- <= 0) { kingDirty = true; return; }
      paint(b);
    }
  }
  /** k: { nick, txt, hearts } for the minute, null to end it. Same card again → no work. Paints nothing in this call. */
  function setKing(k) {
    const next = k && String(k.txt || '') ? { id: 'king', nick: chars(String(k.nick || ''), 16), txt: String(k.txt), hearts: Math.max(0, Math.floor(Number(k.hearts) || 0)) } : null;
    if (next?.nick === king?.nick && next?.txt === king?.txt && next?.hearts === king?.hearts) return false;
    king = next;
    // A new generation: cards already up with other words (or the fallback font) are stale and repaint on the budget.
    kingGen++;
    kingDirty = true;
    if (king) fontsReady(king.txt + ' ' + king.nick).then(() => { if (king === next) { kingGen++; kingDirty = true; } });
    return true;
  }
  // Runs on the 0.64 s cadence only while wishes exist or a card is still up. The decisions are wishPlan's (tested);
  // this only gathers the states and paints what it lists.
  function wishTick() {
    const now = Date.now(), n = wishes.length, air = airOn();
    const count = fillNear();
    for (let i = 0; i < count; i++) {
      const b = nearB[i];
      nearOk[i] = n > 0 && !b.shared && !b.kingOn && b.mounts.length > 0 && wishRotates(b.slotId, b.row, air, towerOpen, now, b.untilMs);
    }
    planCfg.list = wishes;
    planCfg.now = now;
    const k = wishPlan(nearB, nearOk, count, planCfg, planOut);
    wishShown += planCfg.delta;
    for (let j = 0; j < k; j++) paint(nearB[planOut[j]]);
  }
  // Puts wish w on the nearest boards that may rotate (at most WISH_PINS) for one card duration. Unbudgeted, bounded.
  function pinOn(id) {
    const now = Date.now(), air = airOn(), near = lastNear, cands = [];
    for (let i = 0; i < near.length; i++) {
      const b = near[i].b;
      cands.push({ ok: b.mounts.length > 0 && !b.shared && !b.kingOn && wishes.length > 0 && wishRotates(b.slotId, b.row, air, towerOpen, now, b.untilMs), pinId: b.wish?.id ?? null, pinUntil: b.wishPin });
    }
    const plan = wishPinPlan(wishes, id, cands, now);
    if (!plan) return false;
    for (const i of plan.paint) {
      const b = near[i].b;
      if (!b.wish) wishShown++;
      b.wish = plan.wish;
      b.wishPin = now + wishCyc.wish;
      b.wishKey = -2;
      b.wishDue = 0;
      b.wishDrop = false;
      paintCard(b);
    }
    return plan.covered > 0;
  }
  /** Shows the wish with this id (must be in the current list) on up to 4 nearest idle boards now, for one card duration.
   *  Repeated calls inside that time repaint nothing. False when the id is unknown or no board may show it. */
  function pinWish(id) { return pinOn(String(id ?? '')); }
  /** list: 0–24 {id, nick, txt, hearts}. Unchanged list → no work. Boards whose wish left the list or was edited: the
   *  WISH_NOW nearest are repainted in this call, the rest are marked and cleared by the tick (WISH_DROPS per tick). */
  function setWishes(list) {
    const next = cleanWishes(list);
    const now = Date.now();
    const settled = wishSettled(wishFirstAt, wishNonEmpty, now);
    if (Array.isArray(list) && !wishFirstAt) wishFirstAt = now;
    if (sameWishes(wishes, next)) return false;
    const fresh = freshWish(wishSeen, next, settled);
    if (wishSeen.size > 600) wishSeen.clear();
    for (const w of next) wishSeen.add(w.id);
    if (next.length) wishNonEmpty = true;
    wishes = next;
    const byId = new Map(next.map((w) => [w.id, w]));
    // Cards live only on mounted boards (unmount drops them), and lastNear lists every mounted board.
    const count = fillNear();
    const k = wishRelist(nearB, count, byId, WISH_NOW, relistRes, planOut);
    wishShown += relistRes.delta;
    for (let j = 0; j < k; j++) paint(nearB[planOut[j]]);
    // Fonts per wish (the loader samples 80 characters), once per id and text; boards already showing it repaint once.
    if (wishFonts.size > 300) wishFonts.clear();
    for (const w of next) {
      const key = w.id + '\u0001' + w.txt + '\u0001' + w.nick;
      if (wishFonts.has(key)) continue;
      wishFonts.add(key);
      fontsReady(w.txt + ' ' + w.nick).then(() => {
        if (wishFontsOk.size > 300) wishFontsOk.clear();
        wishFontsOk.add(key);
        // The fresh wish goes up on the nearest boards (pinOn no-ops if it already left the list), painted with the font;
        // a font that took longer than one card duration no longer counts as "just posted".
        if (w === fresh && Date.now() - now < wishCyc.wish) pinOn(w.id);
        // Then the nearest boards already showing exactly this wish in the fallback font (pins are skipped: already ok).
        const count = fillNear();
        const k = wishFontTargets(nearB, count, w, WISH_NOW, planOut);
        for (let j = 0; j < k; j++) paint(nearB[planOut[j]]);
      });
    }
    return true;
  }

  function accentOf(slotId) { return THEMES[boards.get(slotId)?.data.bg_theme]?.accent || '#3fe6ff'; }

  function setRim(slotId, color) {
    const b = boards.get(slotId);
    if (!b) return;
    b.rimColor = color || '';
    const text = shieldText(b);
    const warn = text.startsWith('방어막');
    for (const m of b.mounts) {
      if (!m.rim) continue;
      m.rim.visible = !!text || !!b.rimColor;
      m.rim.material.opacity = warn ? 0.62 : (b.rimColor ? 0.85 : 0.4);
      m.rim.material.color.set(warn ? 0xff1a1a : (b.rimColor || 0xffcf5a));
    }
  }

  return { boards, ensure, mount, unmount, set, expire, get: (id) => boards.get(id), worldPos, setTicker, setOps, repaintAll, update, accentOf, tickerCanvas, watchShow, setShow, setAir, setKing, setDecals, setWishes, pinWish, decalsOf: (id) => (boards.get(id)?.decals || []).slice(), setRim };
}
