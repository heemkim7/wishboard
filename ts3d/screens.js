// LED billboard screens: shader-animated materials, curved screens with bezels and
// scrolling news tickers, and the slot registry (MAIN_S, SUB_B1..4, PLOT_1..20).
import * as THREE from 'three';
import { Kit, arcSlab } from './kit.js';
import { THEMES, makeCanvas, paintBillboard, paintTicker, fontsReady, tierOf, boardPhoto, photoReady, SANS, rgba } from './art.js';

export const screenTime = { value: 0 };

/** Unlit LED material: dot-matrix pixels up close, light sweep, gentle scan flicker. */
export function screenMaterial(map, { gain = 1.6, grid = [208, 117], led = 1, sweep = 1 } = {}) {
  const m = new THREE.MeshBasicMaterial({ map, color: new THREE.Color(gain, gain, gain) });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = screenTime;
    sh.uniforms.uGrid = { value: new THREE.Vector2(grid[0], grid[1]) };
    sh.uniforms.uLed = { value: led };
    sh.uniforms.uSweep = { value: sweep };
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
  float s = fract(uTime * 0.06 + vMapUv.x * 0.5 - vMapUv.y * 0.28);
  float band = smoothstep(0.0, 0.03, s) * (1.0 - smoothstep(0.03, 0.1, s));
  diffuseColor.rgb += band * 0.2 * uSweep * (0.5 + diffuseColor.rgb);
  diffuseColor.rgb *= 0.95 + 0.05 * sin(uTime * 2.1 + vMapUv.y * 37.0);
  float edge = min(min(vMapUv.x, vMapUv.y), min(1.0 - vMapUv.x, 1.0 - vMapUv.y));
  float rim = 1.0 - smoothstep(0.0, 0.028, edge);
  float around = vMapUv.x;
  if (vMapUv.y > 0.972) around = 1.0 + (1.0 - vMapUv.x);
  else if (vMapUv.x > 0.972) around = 2.0 + (1.0 - vMapUv.y);
  else if (vMapUv.y < 0.028) around = 3.0 + vMapUv.x;
  else if (vMapUv.x < 0.028) around = 4.0 + vMapUv.y;
  float chase = fract(around * 0.25 - uTime * 0.35);
  float lamp = smoothstep(0.0, 0.015, chase) * (1.0 - smoothstep(0.015, 0.14, chase));
  diffuseColor.rgb += rim * (0.18 + lamp * 1.35) * vec3(0.45, 0.95, 1.0);
  if (vMapUv.y < 0.42 && vMapUv.y > 0.1) {
    float gx = abs(fract(vMapUv.x * 14.0 - uTime * 0.35) - 0.5);
    float gy = abs(fract(vMapUv.y * 9.0 + uTime * 0.45) - 0.5);
    float grid = 1.0 - smoothstep(0.0, 0.08, min(gx, gy));
    float wave = 1.0 - smoothstep(0.0, 0.035, abs(vMapUv.y - 0.26 - 0.05 * sin(vMapUv.x * 12.0 + uTime * 2.1)));
    diffuseColor.rgb += vec3(0.15, 0.75, 1.0) * grid * 0.28 + vec3(1.0, 0.25, 0.62) * wave * 0.55;
  }
  if (vMapUv.y < 0.085) {
    float slide = fract(vMapUv.x - uTime * 0.15);
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

const WISHES = [
  { emoji: '🙏', line1: '로또 1등 당첨 기원', line2: '1일차', line3: '명당에서 비는 중' },
  { emoji: '😴', line1: '내일 눈 떴을 때', line2: '토요일 아침이게', line3: '해주세요' },
  { emoji: '📈', line1: '내가 산 주식만', line2: '파란불에서 구조되길', line3: '📈' },
  { emoji: '🏠', line1: '올해는 꼭', line2: '내 집 마련', line3: '건강 기원!' },
  { emoji: '✨', line1: '타임스퀘어 명당', line2: '기운 받아갑니다', line3: '✨' },
  { emoji: '☕', line1: '월요일이 오면', line2: '네온 아래로', line3: '도망칠게요' },
  { emoji: '💌', line1: '보낸 카톡에', line2: '따뜻한 답장이', line3: '오게 해주세요' },
  { emoji: '🍗', line1: '다이어트는 내일부터', line2: '치킨은 지금', line3: '🍗' },
  { emoji: '🚇', line1: '출근길 지하철에', line2: '빈자리가 나게', line3: '해주세요' },
  { emoji: '💘', line1: '올해 연애는', line2: '버그 없이', line3: '업데이트' },
];
function wishSlot(slotId) {
  return slotId === 'MAIN_S' || /^SUB_B[1-4]$/.test(slotId) || /^PLOT_([1-9]|1\d|20)$/.test(slotId);
}
function wishIndex(slotId) {
  let h = 0;
  for (let i = 0; i < slotId.length; i++) h = (Math.imul(h, 33) + slotId.charCodeAt(i)) >>> 0;
  return h % WISHES.length;
}
function vacantWish(row) {
  if (!row || row.holder_id || !wishSlot(row.slot_id)) return row;
  const w = WISHES[wishIndex(row.slot_id)];
  return { ...row, emoji: w.emoji, line1: w.line1, line2: w.line2, line3: w.line3 };
}

function defaultData(slotId) {
  const tier = tierOf(slotId);
  let row;
  if (tier === 'S') row = { slot_id: slotId, emoji: '📢', bg_theme: 'cyber_navy', text_color: '#ffffff', line1: '이 자리를 점령하세요', line2: '타임스퀘어 메인 타워 · S급', line3: '3,000 코인부터 입찰 가능', holder_id: null };
  else if (tier === 'B') {
    const n = Number(String(slotId).slice(-1)) || 1;
    const theme = ['neon_pink', 'gold_luxury', 'sunset_red', 'matrix_green'][(n - 1) % 4];
    row = { slot_id: slotId, emoji: ['💖', '👑', '🌇', '💎'][(n - 1) % 4], bg_theme: theme, text_color: '#ffffff', line1: `서브 전광판 B${n}`, line2: '내 이름을 뉴욕 한복판에', line3: '500 코인부터 점령', holder_id: null };
  } else {
    const wall = String(slotId).startsWith('WALL_'), tower = String(slotId).startsWith('TOWER_');
    const n = Number(String(slotId).replace(/\D/g, '')) || 1;
    const theme = ['matrix_green', 'neon_pink', 'sunset_red', 'cyber_navy', 'gold_luxury'][n % 5];
    const line1 = tower ? `${n}번 타워 전광판` : wall ? `${n}번 광장 전광판` : `${n}번 거리 전광판`;
    const line2 = tower ? '원 타임스퀘어' : wall ? '타임스퀘어 거리' : '건물 외벽 · C급';
    row = { slot_id: slotId, emoji: tower ? '🗽' : '🌟', bg_theme: theme, text_color: '#ffffff', line1, line2, line3: '100 코인부터', holder_id: null };
  }
  return vacantWish(row);
}

const sigOf = (d) => [d.line1, d.line2, d.line3, d.emoji, d.bg_theme, d.text_color, d.holder_name, d.holder_id, d.photo_id, d.photo_status, d.external_url, d.views, d.clicks, d.cheers].join('\u0001');

export function createBoards({ renderer, kitMats, onBurst, pick }) {
  const boards = new Map();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const plates = new WeakMap();
  let liveHead = 'WISH  1,248 ▲2.4%      ·      소원 코인 +8      ·      붕어빵 +15      ·      NYSE ✦ LIVE      ·      타임스퀘어 점령전      ·      ';
  let liveAcc = 0, liveTick = 0;
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
  paintBillboard(vacantCanvas, { slot_id: 'WALL_1', emoji: '📢', bg_theme: 'cyber_navy', text_color: '#ffffff', line1: '이 자리를 점령하세요', line2: '타임스퀘어 건물 전광판', line3: '100 코인부터', holder_id: null });
  const vacantTex = tune(new THREE.CanvasTexture(vacantCanvas));
  remember(vacantCanvas);
  const vacantMat = screenMaterial(vacantTex, { gain: 1.06, grid: [128, 72] });

  function paint(b) {
    const d = b.data, id = d.photo_status === 'approved' && d.holder_id ? d.photo_id : null;
    const photo = id ? photoReady(id) : null;
    paintBillboard(b.canvas, d, { photo, pending: d.photo_status === 'pending' });
    remember(b.canvas);
    b.tex.needsUpdate = true;
    if (id && !photo) boardPhoto(id).then((img) => { if (img && b.data.photo_id === id && b.data.photo_status === 'approved') paint(b); });
  }

  function ensure(slotId) {
    let b = boards.get(slotId);
    if (b) return b;
    const tier = tierOf(slotId);
    const share = tier === 'C' && String(slotId).startsWith('WALL_');
    if (share) {
      b = { slotId, tier, canvas: vacantCanvas, tex: vacantTex, mat: vacantMat, data: defaultData(slotId), sig: '', mounts: [], shared: true };
      boards.set(slotId, b);
      return b;
    }
    const canvas = tier === 'C' ? makeCanvas(512, 288) : makeCanvas(1024, 576);
    const tex = tune(new THREE.CanvasTexture(canvas));
    const mat = screenMaterial(tex, { gain: tier === 'S' ? 1.16 : tier === 'B' ? 1.12 : 1.06, grid: tier === 'C' ? [128, 72] : [256, 144] });
    b = { slotId, tier, canvas, tex, mat, data: defaultData(slotId), sig: '', mounts: [] };
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
    const { w, h } = spec;
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
    parent.add(group);
    const rec = { group, screen, w, h, R };
    b.mounts.push(rec);
    return group;
  }

  function unmount(slotId, group) {
    const b = boards.get(slotId);
    if (!b) return;
    b.mounts = b.mounts.filter(m => m.group !== group);
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

  function set(slotId, row, celebrate) {
    const b = ensure(slotId);
    const next = vacantWish({ ...b.data, ...row, slot_id: slotId });
    if (b.shared && !next.holder_id) { b.data = next; b.sig = sigOf(next); return false; }
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

  function setTicker(text) {
    paintTicker(tickerCanvas, text);
    tickerTex.needsUpdate = true;
    if (text) liveHead = `${text}      ✦      WISH  1,248 ▲2.4%      ·      소원 코인      ·      붕어빵 +15      ·      `;
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
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(plate, 0, 0);

    const th = Math.max(18, Math.round(46 * k));
    const body = H - th;
    if (!photoOn) {
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
    g.fillStyle = '#ff2e4d';
    g.fillRect(0, body, 108 * k, th);
    g.fillStyle = '#fff';
    g.font = `900 ${Math.max(11, Math.round(20 * k))}px ${SANS}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('LIVE', 54 * k, body + th / 2);
    g.save();
    g.beginPath();
    g.rect(112 * k, body, Math.max(1, W - 112 * k), th);
    g.clip();
    g.font = `800 ${Math.max(12, Math.round(22 * k))}px ${SANS}`;
    g.textAlign = 'left';
    g.fillStyle = '#ffcf5a';
    const views = Math.max(0, Math.floor(Number(b.data?.views) || 0));
    const clicks = Math.max(0, Math.floor(Number(b.data?.clicks) || 0));
    const msg = `👁 택시 정차 ${views}회   ·   🔗 링크 클릭 ${clicks}회   ·   ${liveHead}`;
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
    b.tex.needsUpdate = true;
  }

  function update(dt) {
    tickerTex.offset.x = (tickerTex.offset.x + dt * 0.035) % 1;
    liveAcc += dt;
    if (liveAcc < 0.05) return;
    liveAcc = 0;
    liveTick++;
    const t = screenTime.value;
    const seen = new Set();
    for (const b of boards.values()) {
      if (!b.mounts.length || seen.has(b.canvas)) continue;
      seen.add(b.canvas);
      const hero = b.slotId === 'MAIN_S' || b.shared;
      if (!hero) continue;
      if (b.shared && (liveTick % 2) !== 0) continue;
      drawLive(b, t);
    }
  }

  function accentOf(slotId) { return THEMES[boards.get(slotId)?.data.bg_theme]?.accent || '#3fe6ff'; }

  return { boards, ensure, mount, unmount, set, get: (id) => boards.get(id), worldPos, setTicker, repaintAll, update, accentOf, tickerCanvas };
}
