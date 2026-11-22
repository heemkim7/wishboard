// LED billboard screens: shader-animated materials, curved screens with bezels and
// scrolling news tickers, and the slot registry (MAIN_*, SUB_1A..4B, STREET_1..50, PLOT_1..18).
import * as THREE from 'three';
import { Kit, arcSlab } from './kit.js?v=202611221134';
import { THEMES, makeCanvas, paintBillboard, paintTicker, fontsReady, tierOf, boardPhoto, photoReady, SANS, roundRect, chars, paintWish, wishOrd, wishRotates, wishStrip, cleanWishes, sameWishes, rowUntil, wishPlan, wishRelist, wishFontTargets, wishPinPlan, freshWish, wishSettled, WISH_CYCLE, WISH_CYCLE_LOW, WISH_BUDGET, WISH_BUDGET_LOW, WISH_NOW, WISH_DROPS, frameTone } from './art.js?v=202611221134';
import { askBid } from '../balance.js';
import { floorOf, live, SLOT_RE, isLateSlot } from '../balance.js';
import { auctionClosed } from '../balance.js';
import { nowMs, kingCovers } from '../live.js';
import { ADS, adView, adWorld, linkHost } from '../adsale.js';

export const screenTime = { value: 0 };
// Highest linear luminance a screen pixel may reach (see screenMaterial): just under the default bloom threshold.
const SCREEN_CAP = 0.92;

/** Unlit LED material: dot-matrix pixels up close and a faint light sweep on the nearest boards (no rim chase, grid,
 *  wave or flicker: the artwork carries the board). */
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
  float ledMask = mix(0.8 + 0.2 * cell, 1.0, smoothstep(0.3, 0.85, fw));
  diffuseColor.rgb *= mix(1.0, ledMask, uLed);
  float tt = uTime * uSweep;
  float s = fract(tt * 0.05 + vMapUv.x * 0.5 - vMapUv.y * 0.28);
  float band = smoothstep(0.0, 0.04, s) * (1.0 - smoothstep(0.04, 0.12, s));
  diffuseColor.rgb += band * 0.06 * uSweep * (0.4 + diffuseColor.rgb);
  // Luminance ceiling: the bloom high-pass reads this linear colour before tone mapping (threshold 1.08 - 0.28 * glow,
  // 0.954 at the default glow 0.45). White text and emoji highlights stop at SCREEN_CAP, which NeutralToneMapping at
  // exposure 0.95 shows as about 0.915 (sRGB), so board type stays crisp. Coloured ink sits far below and keeps its gain.
  diffuseColor.rgb *= min(1.0, ${SCREEN_CAP.toFixed(3)} / max(luminance(diffuseColor.rgb), 1e-4));
}
#endif`);
  };
  m.customProgramCacheKey = () => 'kts-led-screen-cap';
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
// soon: a board on the map whose database row has not arrived (STREET_31..50 before their migration) says it opens soon.
function defaultData(slotId, soon = false) {
  const tier = tierOf(slotId);
  const price = (floorOf(slotId) || 0).toLocaleString('en-US') + ' 코인부터';
  let row;
  if (tier === 'S') {
    row = { slot_id: slotId, emoji: '📢', bg_theme: 'cyber_navy', text_color: '#ffffff', line1: '이 자리를 점령하세요', line2: '타임스퀘어 메인 타워', line3: price, holder_id: null };
  } else if (String(slotId).startsWith('STREET_')) {
    const n = Number(String(slotId).slice(7)) || 1;
    row = { slot_id: slotId, emoji: '🌃', bg_theme: 'cyber_navy', text_color: '#ffffff', line1: `${n}번 메인거리`, line2: soon ? '곧 열리는 자리' : '거리 쪽 큰 화면', line3: price, holder_id: null, ...(soon ? { soon: true } : {}) };
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

/** The flat board's frame (four bars, the back plate, the accent line) into `kit`, around a w x h face centred at the
 *  origin of `m` (or of the kit's own space). mount() uses it; a caller with many boards bakes them into one kit. */
export function addFrame(kit, w, h, t, accent, m) {
  kit.box(w + t * 2, t, 0.22, '#1a1c22', { y: h / 2 + t / 2, z: -0.05, mat: 'metal', m });
  kit.box(w + t * 2, t, 0.22, '#1a1c22', { y: -h / 2 - t / 2, z: -0.05, mat: 'metal', m });
  kit.box(t, h, 0.22, '#1a1c22', { x: -w / 2 - t / 2, z: -0.05, mat: 'metal', m });
  kit.box(t, h, 0.22, '#1a1c22', { x: w / 2 + t / 2, z: -0.05, mat: 'metal', m });
  kit.box(w + t * 2, h + t * 2, 0.12, '#0b0c10', { z: -0.16, mat: 'metal', m });
  kit.box(w + t * 2, 0.04, 0.05, accent, { y: h / 2 + t + 0.02, z: 0.03, glow: 3, m });
  return kit;
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
  const planCfg = { list: [], now: 0, cyc: wishCyc, budget: wishBudget, drops: WISH_DROPS, since: new Array(96), rank: new Array(96), who: new Array(96), pick: [], delta: 0 };
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

  const CLAIM = SLOT_RE;
  let air = null;
  let opsLine = '';
  function airOn() { return !!(air && air.until > Date.now()); }
  // 밤 9시 소원왕 (setKing, main.js decides the minute): claimable boards outside the main tower show yesterday's top wish
  // full-face. A live takeover wins. Entering and leaving repaint at most kingBudget boards per 0.08 s tick, nearest first.
  // A wish card gives way only when its board turns (wishOk), so the wish tick never drops every card at once for the king.
  const kingBudget = quality === 'low' ? 1 : 3;
  const KING_CARD = { chip: '어제의 소원왕', strip: '어제 하트를 가장 많이 받은 소원' };
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
    // A player's sticker: the quiet dark pill of the board family, hairline edge, white type. No glow.
    g.save();
    roundRect(g, x, y, bw, bh, bh / 2);
    g.fillStyle = 'rgba(10,14,28,0.88)';
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.lineWidth = Math.max(1, 2 * k);
    g.stroke();
    g.fillStyle = '#f2f4ff';
    g.font = `700 ${Math.max(14, Math.round(22 * k))}px ${SANS}`;
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
    paintWish(b.canvas, b.wish, { strip: b.wishMsg, dark: !!b.row?.holder_id, wide: b.tier === 'S' });
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
    // Street and lot faces are 512 x 288 (0.6 MB each for the canvas, its plate and the texture); on the phone tier 384 x 216,
    // so the 68 of them there take less memory than the 48 did at full size.
    const canvas = tier === 'C' ? (quality === 'low' ? makeCanvas(384, 216) : makeCanvas(512, 288)) : makeCanvas(1024, 576);
    const tex = tune(new THREE.CanvasTexture(canvas));
    const mat = screenMaterial(tex, { gain: tier === 'S' ? 1.16 : tier === 'B' ? 1.12 : 1.06, grid: tier === 'C' ? [128, 72] : [256, 144] });
    b = { slotId, tier, canvas, tex, mat, data: defaultData(slotId, isLateSlot(slotId)), real: false, sig: '', mounts: [], wish: null, wishKey: -1, wishPin: 0, wishDue: 0, wishDrop: false, wishFontOk: false, wishOrd: wishOrd(slotId), wishMsg: '', untilMs: 0 };
    b.sig = sigOf(b.data);
    boards.set(slotId, b);
    paint(b);
    return b;
  }

  /** spec: {x,y,z,ry,w,h,curve,ticker,frame,marquee,bare} — (x,y,z) is the screen center (apex for curved). bare: no
   *  frame here (the caller bakes one with addFrame into a merged kit of its own). */
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
    } else if (!spec.bare) {
      addFrame(kit, w, h, spec.frameT ?? 0.16, accent);
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
  /** The first mount's face in the world: centre, unit right / up / normal, width and height in metres, tier. */
  function face(slotId) {
    const b = boards.get(slotId);
    const m = b?.mounts[0];
    if (!m) return null;
    m.screen.updateWorldMatrix(true, false);
    const e = m.screen.matrixWorld.elements;
    const sx = Math.hypot(e[0], e[1], e[2]) || 1, sy = Math.hypot(e[4], e[5], e[6]) || 1, sz = Math.hypot(e[8], e[9], e[10]) || 1;
    return {
      tier: b.tier, w: m.w * sx, h: m.h * sy,
      pos: new THREE.Vector3(e[12], e[13], e[14]),
      right: new THREE.Vector3(e[0] / sx, e[1] / sx, e[2] / sx),
      up: new THREE.Vector3(e[4] / sy, e[5] / sy, e[6] / sy),
      normal: new THREE.Vector3(e[8] / sz, e[9] / sz, e[10] / sz),
    };
  }

  // b.row keeps what the server said. A live hold shows that ad. A dark hold keeps the owner's name. An empty slot shows the house notice.
  function set(slotId, row, celebrate) {
    const b = ensure(slotId);
    if (row && ('holder_id' in row || 'current_bid' in row)) b.real = true; // a database row (not a repaint with {})
    const soon = !b.real && isLateSlot(slotId);
    b.row = { ...b.row, ...row, slot_id: slotId };
    b.untilMs = rowUntil(b.row);
    const held = !!b.row?.holder_id;
    const next = live(b.row) ? b.row : held ? {
      ...defaultData(slotId, soon),
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
      unlit: true,
    } : { ...defaultData(slotId, soon), views: b.row.views, clicks: b.row.clicks, cheers: b.row.cheers, ...(opsLine && !soon ? { line2: opsLine } : {}) };
    const sig = sigOf(next);
    const changed = sig !== b.sig;
    b.data = next;
    if (!changed) return false;
    b.sig = sig;
    paint(b);
    fontsReady([next.line1, next.line2, next.line3, next.holder_name].join(' ')).then(() => { if (b.sig === sig) paint(b); });
    // The world places the fireworks around the face (face()); this only says which board and in what colour.
    if (celebrate && b.mounts.length) onBurst?.(slotId, THEMES[next.bg_theme]?.accent || '#ffcf5a');
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
    if (text) liveHead = `${text}      ·      WISH BOARD  ·  모두의 전광판  ·  `;
  }

  function repaintAll() {
    for (const b of boards.values()) if (!b.shared) paint(b);
    tickerTex.needsUpdate = true;
  }

  // The nearest boards get a moving info strip over the bottom band of their artwork (the band art.js paints:
  // max(28, 46k) high). State tag on the left, a slow scroll of the board's numbers and the house line. Nothing else moves.
  // The 10 nearest boards every 0.08 s; on the phone tier the 3 nearest every 0.16 s (every other tick: the 0.08 s tick
  // itself stays, so the king and wish cadences that count ticks are the same on every tier).
  const LIVE_HOT = quality === 'low' ? 3 : 10, LIVE_EVERY = quality === 'low' ? 2 : 1;
  const TAGS = { king: ['소원왕', 'rgba(255,176,32,0.16)', '#ffb020'], wish: ['소원', 'rgba(255,176,32,0.16)', '#ffb020'], live: ['LIVE', '#ff4fa3', '#ffffff'], dark: ['꺼짐', '#1c2440', '#8f96b8'], free: ['빈칸', '#1c2440', '#b9bfdc'] };
  function drawLive(b, t) {
    const canvas = b.canvas;
    const plate = plates.get(canvas) || remember(canvas);
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, k = W / 1024;
    const wishOn = !!b.wish, kingOn = !!b.kingOn;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(plate, 0, 0);

    const th = Math.max(28, Math.round(46 * k));
    const body = H - th;
    g.fillStyle = '#060914';
    g.fillRect(0, body, W, th);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, body, W, Math.max(1, Math.round(k)));
    const onAir = live(b.row);
    const held = !!b.row?.holder_id;
    const [tag, tagBg, tagInk] = TAGS[kingOn ? 'king' : wishOn ? 'wish' : onAir ? 'live' : held ? 'dark' : 'free'];
    const ph = Math.max(16, th - 16 * k), pw = 92 * k, px = 12 * k;
    roundRect(g, px, body + (th - ph) / 2, pw, ph, ph / 2);
    g.fillStyle = tagBg;
    g.fill();
    g.fillStyle = tagInk;
    g.font = `800 ${Math.max(11, Math.round(20 * k))}px ${SANS}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(tag, px + pw / 2, body + th / 2 + 1);
    const sx = px + pw + 14 * k;
    g.save();
    g.beginPath();
    g.rect(sx, body, Math.max(1, W - sx), th);
    g.clip();
    g.font = `700 ${Math.max(12, Math.round(22 * k))}px ${SANS}`;
    g.textAlign = 'left';
    g.fillStyle = '#b9bfdc';
    const views = Math.max(0, Math.floor(Number(b.data?.views) || 0));
    const cheers = Math.max(0, Math.floor(Number(b.data?.cheers) || 0));
    const clicks = Math.max(0, Math.floor(Number(b.data?.clicks) || 0));
    const notes = Array.isArray(b.data?.notes) ? b.data.notes.map((t) => chars(String(t || ''), 16)).filter(Boolean).slice(-5) : [];
    const msg = kingOn ? `어제의 소원왕   ·   ${chars(b.kingNick || '', 16)}   ·   ${liveHead}` : wishOn ? `오늘의 소원   ·   ${b.wishMsg}   ·   ${liveHead}` : `택시 정차 ${views}회   ·   응원 ${cheers}회   ·   링크 클릭 ${clicks}회   ·   ${notes.length ? notes.join('   ·   ') + '   ·   ' : ''}${liveHead}`;
    const tw = Math.max(8, g.measureText(msg).width);
    const x0 = sx + 6 * k - ((t * 90) % tw);
    g.fillText(msg, x0, body + th / 2 + 1);
    g.fillText(msg, x0 + tw, body + th / 2 + 1);
    g.restore();

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
  // update()'s nearest-first list, its { b, d } rows, the position it measures with and its two sets are made once and
  // reused every tick. Readers of lastNear (kingStep, fillNear, pinOn) take .b at once and keep no row.
  const nearList = [], nearRows = [], nearAt = new THREE.Vector3(), hotSet = new Set(), seenCanvas = new Set();
  const byDist = (a, b) => a.d - b.d;
  const SHOW_HUES = [0xff3d4a, 0xffcf5a, 0x39f58a, 0x3fe6ff, 0xb84dff, 0xff7ad9];
  function update(dt, cam) {
    tickerTex.offset.x = (tickerTex.offset.x + dt * 0.035) % 1;
    liveAcc += dt;
    if (liveAcc < 0.08) return;
    liveAcc = 0;
    liveTick++;
    const near = nearList;
    near.length = 0;
    for (const b of boards.values()) {
      if (!b.mounts.length) continue;
      const p = worldPos(b.slotId, nearAt);
      const d = cam && p ? cam.distanceToSquared(p) : 0;
      const row = nearRows[near.length] || (nearRows[near.length] = { b: null, d: 0 });
      row.b = b; row.d = d;
      near.push(row);
    }
    for (let i = near.length; i < nearRows.length; i++) nearRows[i].b = null; // no unmounted board kept alive by a spare row
    near.sort(byDist);
    lastNear = near;
    if (kingDirty) kingStep();
    // The strip is a canvas redraw and a texture upload per board: LIVE_HOT boards, every LIVE_EVERY-th tick.
    const draw = liveTick % LIVE_EVERY === 0;
    const hot = hotSet;
    hot.clear();
    for (let i = 0; i < near.length && i < LIVE_HOT; i++) hot.add(near[i].b);
    const seen = seenCanvas;
    seen.clear();
    for (const b of boards.values()) {
      const on = hot.has(b);
      if (b.mat?.userData?.sweep) b.mat.userData.sweep.value = on ? 1 : 0;
      if (!draw || !on || b.shared || seen.has(b.canvas)) continue;
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
        b.rimWarn = warn;
        for (const m of b.mounts) {
          if (!m.rim) continue;
          m.rim.visible = !!text || !!b.rimColor;
          m.rim.material.opacity = warn ? ((liveTick / 8) % 2 < 1 ? 0.62 : 0.16) : (b.rimColor ? 0.85 : 0.4);
          m.rim.material.color.set(warn ? 0xff1a1a : (b.rimColor || 0xffcf5a));
        }
      }
      if (wishes.length || wishShown) wishTick();
      if (showMeshes[1]?.visible) {
        showMeshes[1].material.color.set(SHOW_HUES[(liveTick / 8) % SHOW_HUES.length | 0]);
      }
    }
    if (rimMoving.size) rimStep(); // after the 8-tick pass above, which sets every rim to its plain colour
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

  // Frames that move (art.js FRAME_FX anim): 'rainbow' walks the hue, 'shine' breathes. A shield warning on the board wins.
  const rimMoving = new Set();
  function rimStep() {
    const t = liveTick * 0.08;
    for (const b of rimMoving) {
      if (b.rimWarn || !b.rimColor) continue;
      const tone = frameTone({ color: b.rimColor, anim: b.rimAnim }, t);
      const op = b.rimAnim === 'shine' ? 0.62 + 0.33 * Math.abs(Math.sin(t * 1.7)) : 0.85;
      for (const m of b.mounts) { if (!m.rim) continue; m.rim.material.color.set(tone); m.rim.material.opacity = op; }
    }
  }
  /** color: the rim of a holder's frame ('' none); anim: '' | 'shine' | 'rainbow' (art.js FRAME_FX). */
  function setRim(slotId, color, anim = '') {
    const b = boards.get(slotId);
    if (!b) return;
    b.rimColor = color || '';
    b.rimAnim = b.rimColor ? anim || '' : '';
    if (b.rimAnim) rimMoving.add(b); else rimMoving.delete(b);
    const text = shieldText(b);
    const warn = text.startsWith('방어막');
    for (const m of b.mounts) {
      if (!m.rim) continue;
      m.rim.visible = !!text || !!b.rimColor;
      m.rim.material.opacity = warn ? 0.62 : (b.rimColor ? 0.85 : 0.4);
      m.rim.material.color.set(warn ? 0xff1a1a : (b.rimColor || 0xffcf5a));
    }
  }

  return { boards, ensure, mount, unmount, set, expire, get: (id) => boards.get(id), worldPos, face, setTicker, setOps, repaintAll, update, accentOf, tickerCanvas, watchShow, setShow, setAir, setKing, setDecals, setWishes, pinWish, decalsOf: (id) => (boards.get(id)?.decals || []).slice(), setRim };
}

// ---- ad-only screens AD_1..AD_5 (adsale.js) -------------------------------------------------------------------------
// Paid advertising the operator booked by hand, apart from the coin game: not in the slot registry (no bid, wish card,
// sticker, king card or takeover), picked as { kind: 'adscreen', id }. Every screen with nothing booked shares one canvas
// (the house ad while ADS_ON is on, a quiet city screen while it is off); a booked screen gets its own while its booking
// shows. The state is checked once a second and a canvas is painted only when what it shows changes; no live strip.
const AD_INK = { amber: '#ffb020', navy: '#070a18', text: '#eef0fb', sub: '#b9bfdc', muted: '#7d86ad' };
function adFit(g, text, maxW, size, weight, min) {
  let s = size;
  for (; s > min; s -= 2) { g.font = `${weight} ${Math.round(s)}px ${SANS}`; if (g.measureText(text).width <= maxW) break; }
  g.font = `${weight} ${Math.round(s)}px ${SANS}`;
  return s;
}
/** Paints an ad screen: v = adView()'s { kind: 'ad', ad } | { kind: 'house' } | { kind: 'city' }; host: this site's host for the house ad. */
export function paintAdScreen(canvas, v, host = '') {
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height, k = W / 1024;
  const ad = v?.kind === 'ad' ? v.ad : null, accent = ad ? (THEMES[ad.th]?.accent || '#48d6f0') : AD_INK.amber;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0b1030'); bg.addColorStop(1, v?.kind === 'city' ? '#05070f' : '#140c26');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W * 0.5, H * 0.42, 10, W * 0.5, H * 0.42, W * 0.6);
  glow.addColorStop(0, v?.kind === 'city' ? 'rgba(72,214,240,0.10)' : `${accent}33`); glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const chip = (text, x, y, fill, ink) => {
    g.font = `800 ${Math.round(30 * k)}px ${SANS}`;
    const w = g.measureText(text).width + 34 * k, h = 50 * k;
    roundRect(g, x, y, w, h, 12 * k); g.fillStyle = fill; g.fill();
    g.fillStyle = ink; g.textAlign = 'left'; g.fillText(text, x + 17 * k, y + h / 2 + 1); g.textAlign = 'center';
    return w;
  };
  if (v?.kind === 'city') {
    // Neutral: no offer, no chip. A dim skyline and the square's name.
    g.fillStyle = 'rgba(120,140,200,0.10)';
    for (let i = 0, x = 0; x < W; i++) { const bw = (40 + ((i * 53) % 70)) * k, bh = (90 + ((i * 97) % 220)) * k; g.fillRect(x, H - bh, bw - 6 * k, bh); x += bw; }
    adFit(g, 'TIMES SQUARE', W * 0.8, 96 * k, 900, 40 * k); g.fillStyle = 'rgba(238,240,251,0.82)'; g.fillText('TIMES SQUARE', W / 2, H * 0.42);
    adFit(g, '모두의 전광판 · 뉴욕', W * 0.8, 40 * k, 700, 18 * k); g.fillStyle = AD_INK.muted; g.fillText('모두의 전광판 · 뉴욕', W / 2, H * 0.6);
  } else if (!ad) {
    chip('광고 문의', 40 * k, 34 * k, AD_INK.amber, AD_INK.navy);
    adFit(g, '이 화면에 광고하세요', W * 0.86, 92 * k, 900, 36 * k); g.fillStyle = AD_INK.text; g.fillText('이 화면에 광고하세요', W / 2, H * 0.4);
    adFit(g, '하루 단위 · 생일·응원 광고도 돼요', W * 0.84, 42 * k, 700, 18 * k); g.fillStyle = AD_INK.sub; g.fillText('하루 단위 · 생일·응원 광고도 돼요', W / 2, H * 0.58);
    const where = host + '/ads';
    adFit(g, where, W * 0.8, 48 * k, 800, 20 * k); g.fillStyle = AD_INK.amber; g.fillText(where, W / 2, H * 0.78);
  } else {
    // The disclosure first: every booked creative carries 광고, top left, the same on every screen.
    chip('광고', 40 * k, 34 * k, AD_INK.amber, AD_INK.navy);
    const lines = (ad.l || []).map((t) => chars(String(t || ''), 24)).filter(Boolean);
    const e = chars(ad.e || '', 4);
    let y = H * (lines.length > 2 ? 0.34 : 0.4);
    if (e) { g.font = `${Math.round(70 * k)}px ${SANS}`; g.fillStyle = AD_INK.text; g.fillText(e, W / 2, H * 0.17 + 30 * k); y += 20 * k; }
    const caps = [88, 52, 42], mins = [34, 20, 18], inks = [AD_INK.text, AD_INK.sub, accent];
    lines.forEach((t, i) => { const s = adFit(g, t, W * 0.86, caps[i] * k, i ? 700 : 900, mins[i] * k); g.fillStyle = inks[i]; g.fillText(t, W / 2, y); y += s * 1.25 + 8 * k; });
    const site = ad.u ? linkHost(ad.u) : '';
    if (site) { adFit(g, '↗ ' + site, W * 0.7, 30 * k, 700, 16 * k); g.fillStyle = AD_INK.muted; g.fillText('↗ ' + site, W / 2, H - 44 * k); }
  }
  g.fillStyle = accent; g.fillRect(0, H - 6 * k, W, 6 * k);
  g.restore();
  return canvas;
}
export function createAdScreens({ renderer, pick, quality }) {
  const low = quality === 'low', CW = low ? 512 : 1024, CH = low ? 288 : 576;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const host = typeof location !== 'undefined' ? location.host : '';
  const recs = new Map(), shared = {};
  let ads = { on: false, list: [] }, acc = 1;
  const sampled = Math.random() < ADS.seenRate;
  const seen = new Map(), seenDone = new Set(); // booking id -> seconds in view this session; ids past ADS.seenAfter
  const make = () => {
    const canvas = makeCanvas(CW, CH), tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = aniso; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
    return { canvas, tex, mat: screenMaterial(tex, { gain: 1.08, grid: low ? [128, 72] : [256, 144] }), key: '' };
  };
  function paintOn(surf, v, key) {
    surf.key = key;
    paintAdScreen(surf.canvas, v, host);
    surf.tex.needsUpdate = true;
    const text = v.kind === 'ad' ? (v.ad.l || []).join(' ') : '이 화면에 광고하세요 하루 단위 생일 응원 광고도 돼요 TIMES SQUARE 모두의 전광판';
    fontsReady(text).then(() => { if (surf.key === key) { paintAdScreen(surf.canvas, v, host); surf.tex.needsUpdate = true; } });
  }
  // One canvas per view that more than one screen can show (house, city), made when first needed; booked screens own theirs.
  const sharedOf = (kind) => {
    if (!shared[kind]) { shared[kind] = make(); paintOn(shared[kind], { kind }, kind); }
    return shared[kind];
  };
  function refresh(now) {
    for (const r of recs.values()) {
      const v = adView(ads, r.id, now);
      const key = v.kind === 'ad' ? 'ad:' + v.ad.id + ':' + (v.ad.l || []).join('|') + v.ad.e + v.ad.th + v.ad.u : v.kind;
      if (key === r.key) continue;
      r.key = key; r.view = v;
      if (v.kind === 'ad') { if (!r.own) r.own = make(); if (r.own.key !== key) paintOn(r.own, v, key); r.mesh.material = r.own.mat; }
      else { r.mesh.material = sharedOf(v.kind).mat; if (r.own) { r.own.tex.dispose(); r.own.mat.dispose(); r.own = null; } }
    }
  }
  /** spec: { y, z, w, h } of the face in the parent group (16:9). */
  function mount(id, parent, spec) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spec.w, spec.h), sharedOf('city').mat);
    mesh.position.set(0, spec.y, spec.z || 0);
    mesh.userData.pick = { kind: 'adscreen', id };
    parent.add(mesh);
    pick.push(mesh);
    recs.set(id, { id, mesh, key: '', view: null, own: null, pos: new THREE.Vector3(), normal: new THREE.Vector3() });
    refresh(nowMs());
    return mesh;
  }
  /** /rt/world's `ads` (any shape: adWorld checks it). */
  function set(v) { ads = adWorld(v); refresh(nowMs()); }
  const fr = new THREE.Frustum(), pm = new THREE.Matrix4(), to = new THREE.Vector3();
  /** Once a second: what each screen shows, and (in a sampled session) which booked screens are in view. occluded(a, b): a wall between. */
  function update(dt, camera, occluded) {
    acc += dt;
    if (acc < 1) return;
    const step = Math.min(acc, 2); acc = 0;
    refresh(nowMs());
    if (!sampled || !camera) return;
    let frustumSet = false;
    for (const r of recs.values()) {
      const id = r.view?.kind === 'ad' ? r.view.ad.id : '';
      if (!id || seenDone.has(id)) continue;
      r.mesh.getWorldPosition(r.pos);
      r.normal.set(0, 0, 1).transformDirection(r.mesh.matrixWorld);
      to.copy(camera.position).sub(r.pos);
      const d = to.length();
      if (d > 140 || to.dot(r.normal) < 0.25 * d) continue;
      if (!frustumSet) { fr.setFromProjectionMatrix(pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)); frustumSet = true; }
      if (!fr.containsPoint(r.pos) || occluded?.(r.pos, camera.position)) continue;
      const t = (seen.get(id) || 0) + step;
      seen.set(id, t);
      if (t >= ADS.seenAfter) seenDone.add(id);
    }
  }
  /** The tapped screen: { id, kind, ad } (ad null for the house and city views). */
  function info(id) { const r = recs.get(id); const v = r?.view || adView(ads, id, nowMs()); return { id, kind: v.kind, ad: v.kind === 'ad' ? v.ad : null, on: !!ads.on }; }
  return { mount, set, update, info, seen: () => [...seenDone], sampled: () => sampled, ids: () => [...recs.keys()], front: (id) => recs.get(id)?.mesh || null };
}
