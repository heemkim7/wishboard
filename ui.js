// Plaza UI: glass HUD, wallet, news wire, emote dock, prompts, bungeo-ppang timing game, K-POP rhythm game,
// taxi HUD, city map + minimap, billboard / plot / ATM / settings / credits sheets, onboarding, touch controls, SFX.
import { paintBillboard, paintNeonSign, THEMES, makeCanvas, chars, fontsReady, tierOf, boardPhoto, photoReady } from './ts3d/art.js?v=20261113b';
import { LAYOUT, LOOP, insideLoop, PLOT_SLOTS, TAXI_STANDS, LANDMARKS } from './ts3d/layout.js?v=20261113b';
import { BALANCE, askBid, buildingOf, floorOf, nextChainFace, slotName } from './balance.js?v=20261113y';
import { TILE, ROAD, AREA } from './ts3d/nyc.js';
import { EMOTES, REACTIONS, AVATAR_COLORS, SPECIES } from './ts3d/avatars.js?v=20261113o';
import { trackEvent } from './analytics.js?v=20261113z';
import { linkedActor } from './plaza-account.js?v=20261113z';

const LEVELS = [
  { src: 'icons/lot.jpg', t: '빈 땅' },
  { src: 'icons/tent.jpg', t: '텐트' },
  { src: 'icons/pocha.jpg', t: '포차' },
  { src: 'icons/shop.jpg', t: '네온상가' },
  { src: 'icons/tower.jpg', t: '타워' },
];
const levelImg = (L) => h('img', { class: 'i', src: L.src, alt: L.t, draggable: 'false' });
const TIERS = { S: { floor: 3000, label: 'S급 메인 타워' }, B: { floor: 500, label: 'B급 서브 타워' }, C: { floor: 100, label: 'C급 거리 전광판' } };
// Billboard emoji palette. Every viewer's own emoji font draws it, so stay within Emoji 11 (Windows 10) and skip flags.
const EMOJI_SETS = [
  ['인기', ['🔥', '✨', '👑', '💖', '💎', '🚀', '🌃', '🎉', '💯', '⭐', '🌟', '💥']],
  ['K-컬처', ['🐟', '🍜', '🍗', '🍺', '🍶', '🍙', '🍡', '🥟', '🎤', '🎶', '💃', '🕺', '📺', '🎬', '🎧', '🎨']],
  ['뉴욕', ['🗽', '🏙️', '🌆', '🌃', '🚕', '🌉', '🍎', '🍕', '🌭', '🥯', '☕', '🎭', '🚇', '🎡']],
  ['감정', ['😍', '😎', '🤩', '🥳', '😂', '🥰', '😭', '🤯', '😇', '🤗', '😜', '🙈', '😤', '🤔']],
  ['응원', ['💪', '👏', '🙌', '🙏', '👍', '✌️', '🏆', '🥇', '🎯', '📢', '💸', '💰', '🎁', '🍀']],
  ['사랑', ['❤️', '💕', '💘', '💌', '🌹', '🌸', '💐', '🧡', '💛', '💚', '💙', '💜']],
  ['동물', ['🐶', '🐱', '🐻', '🐼', '🐰', '🦄', '🐯', '🐧', '🐥', '🦊', '🐹', '🐳']],
  ['자연', ['🌈', '☀️', '🌙', '⚡', '🌊', '❄️', '🌻', '🍁', '🎮', '⚽', '🎸', '🌋']],
];
const INK = ['#ffffff', '#ffe9a8', '#3fe6ff', '#ff7ac0', '#ff6a3d', '#39f5a0'];
const NEON = ['#00ffcc', '#ffcf5a', '#ff3d9a', '#3fe6ff', '#b84dff', '#ff6a3d'];
const COOLDOWN = BALANCE.cooldownMs;

const money = (n) => Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('ko-KR');
const isColor = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ''));
function h(tag, props, ...kids) {
  const n = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k in n && typeof v !== 'string') n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
function minBid(board, boards, actorId, draft = '') {
  const text = draft || [board?.line1, board?.line2, board?.line3].filter(Boolean).join('\n');
  const [line1, line2, line3] = String(text).split('\n');
  return askBid({ ...board, line1: line1 || board?.line1, line2: line2 ?? board?.line2, line3: line3 ?? board?.line3 }, boards, actorId, line1 || '');
}
function protectedLeft(board) {
  if (!board?.protected_until || !board.holder_id) return 0;
  return Math.max(0, new Date(board.protected_until).getTime() - Date.now());
}
function fmtLeft(ms) {
  const s = Math.ceil(ms / 1000);
  if (s >= 3600) return `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분`;
  if (s >= 60) return `${Math.floor(s / 60)}분 ${s % 60}초`;
  return `${s}초`;
}
function fmtProtect(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m ? `보호 ${h}시간 ${m}분` : `보호 ${h}시간`;
  }
  if (s >= 60) return `보호 ${Math.floor(s / 60)}분`;
  return `보호 ${Math.max(1, s)}초`;
}
function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* private mode */ } }
function recall(key, dflt) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? dflt; } catch { return dflt; } }

const PASSENGER_LINES = [
  '기사님! 저기 전광판에 제 소원 걸렸는데 구경하러 빨리 가요!',
  '월요일이 오고 있어요... 저기 가장 밝은 네온사인 앞으로 도망쳐요!',
  '방금 로또 샀는데 기운 좋은 명당 빌딩 앞에 내려주세요!',
  '붕어빵 식기 전에 저기 메인 타워 앞까지 풀악셀 밟아주세요!',
  '오늘 고백 문구를 전광판에 올렸거든요. 반짝이는 쪽으로 가 주세요!',
  '친구 생일 응원 걸었어요. 그 화면이 제일 잘 보이는 데로요!',
  '출근은 내일 생각할게요. 지금은 가장 시끄러운 불빛 앞으로!',
  '주식 앱 끄고 나왔어요. 파란불 기운 나는 건물 앞에 세워 주세요.',
  '포춘쿠키 먹다가 소원이 생겼어요. 빈 전광판만 아니면 어디든 좋아요!',
  '엄마한테 보여줄 사진 찍게 메인 타워 정면으로 가 주세요!',
  '야근 끝났어요. 네온이 제일 두꺼운 골목으로 도망가게 해 주세요.',
  '첫 소원 올리는 날이에요. 예쁘게 보이는 쪽에 세워 주세요.',
  '택시 안에서 소원 고르는 중이에요. 일단 밝은 쪽으로 직진!',
  '고양이 사진 올릴 자리 찾고 있어요. 귀여운 불빛 앞으로 가 주세요.',
  '시험 끝나서 기분이 좋아요. 축하 네온 있는 데로 질러 주세요!',
  '배고파요. 붕어빵 냄새 나기 전에 전광판만 보고 갈게요!',
  '심야 라디오 같은 문장 올렸어요. 조용한 명당이면 더 좋아요.',
  '친구랑 내기했어요. 내 이름이 걸린 화면 앞에서 내릴 거예요!',
  '오늘따라 운이 필요해요. 제일 환한 간판 앞으로 가 주세요.',
  '소원 주인 찾으러 가는 길이에요. 그 전광판이 손짓하는 쪽으로!',
  '비 온 뒤 네온이 더 예뻐요. 바닥이 거울인 골목으로 가 주세요.',
  '잠깐만 세우면 안 돼요. 소원 읽는 동안은 천천히 굴러 주세요.',
  '뉴욕은 처음이에요. 제일 큰 전광판이 코앞에 오게 해 주세요!',
  '코인 모아서 올 소원이에요. 아직 빈 명당이면 거기 앞에 세워 주세요.',
  '기사님 센스 좋으시네요. 저기 반짝이는 소원부터 구경할게요!',
];

export function createUI(root, hooks) {
  root.replaceChildren();
  const coarse = matchMedia('(pointer: coarse)').matches;
  let wallet = { confirmed: 0, pending: 0, earned: 0 };
  let earnedSeen = 0;
  let plazaReady = false, starterToastShown = false;
  let people = 1, peopleCh = 1, statusKind = 'warn', statusText = '연결 중';
  let near = null, world = { billboards: [], plots: [] };
  let coolUntil = 0, baking = null, sheet = null, soundOn = recall('kts_sound', true);
  let dance = null, driving = false, waypoint = null, rideLine = '';

  // ---------------------------------------------------------------- audio
  const audio = { ctx: null, master: null };
  function ac() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audio.ctx) {
      audio.ctx = new Ctx();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = 0.55;
      audio.master.connect(audio.ctx.destination);
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
    return audio.ctx;
  }
  function tone(steps, base = {}) {
    if (!soundOn) return;
    const ctx = ac();
    if (!ctx) return;
    const now = ctx.currentTime;
    steps.forEach((s, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = s.type || base.type || 'triangle';
      o.frequency.setValueAtTime(s.f, now);
      if (s.to) o.frequency.exponentialRampToValueAtTime(s.to, now + (s.at ?? i * (base.gap ?? 0.07)) + (s.d || 0.18));
      const t0 = now + (s.at ?? i * (base.gap ?? 0.07));
      const d = s.d || base.d || 0.18;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(s.g || base.g || 0.08, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g);
      g.connect(audio.master);
      o.start(t0);
      o.stop(t0 + d + 0.02);
    });
  }
  const sfx = {
    click: () => tone([{ f: 880, d: 0.05, g: 0.04 }], { type: 'sine' }),
    hit: () => tone([{ f: 523 }, { f: 659 }, { f: 784, d: 0.3 }], { type: 'triangle' }),
    crit: () => tone([{ f: 659 }, { f: 880 }, { f: 1109 }, { f: 1319, d: 0.5, g: 0.09 }, { f: 1760, d: 0.6, g: 0.05, at: 0.32, type: 'sine' }], { gap: 0.065 }),
    miss: () => tone([{ f: 196, to: 98, d: 0.35, type: 'sawtooth', g: 0.05 }]),
    star: () => tone([{ f: 1319, type: 'sine' }, { f: 1760, type: 'sine', d: 0.35 }, { f: 2637, type: 'sine', d: 0.4, g: 0.03 }], { gap: 0.06 }),
    coin: () => tone([{ f: 988, d: 0.08, type: 'square', g: 0.03 }, { f: 1319, d: 0.35, type: 'square', g: 0.03 }], { gap: 0.07 }),
    fanfare: () => tone([{ f: 523 }, { f: 659 }, { f: 784 }, { f: 1047, d: 0.5 }, { f: 784, at: 0.42, d: 0.5, g: 0.05 }, { f: 659, at: 0.42, d: 0.5, g: 0.05 }], { gap: 0.1, type: 'square', g: 0.05 }),
    honk: () => tone([{ f: 392, d: 0.22, type: 'square', g: 0.035, at: 0 }, { f: 494, d: 0.22, type: 'square', g: 0.03, at: 0 }, { f: 392, d: 0.3, type: 'square', g: 0.035, at: 0.28 }, { f: 494, d: 0.3, type: 'square', g: 0.03, at: 0.28 }]),
    tick: () => tone([{ f: 660, d: 0.07, type: 'sine', g: 0.06 }]),
    shutter: () => tone([{ f: 1400, to: 180, d: 0.09, type: 'square', g: 0.08 }, { f: 2400, d: 0.04, type: 'sine', g: 0.04 }]),
    news: () => tone([{ f: 784, type: 'sine', d: 0.12, g: 0.05 }, { f: 1175, type: 'sine', d: 0.25, g: 0.05 }], { gap: 0.09 }),
    bump: () => tone([{ f: 110, to: 46, d: 0.2, type: 'sine', g: 0.14 }]),
    engine: () => tone([{ f: 90, to: 220, d: 0.45, type: 'sawtooth', g: 0.05 }, { f: 1319, d: 0.22, type: 'sine', g: 0.05, at: 0.12 }, { f: 1760, d: 0.28, type: 'sine', g: 0.04, at: 0.22 }]),
    pickup: () => tone([{ f: 880, d: 0.12, type: 'sine', g: 0.07 }, { f: 1175, d: 0.28, type: 'sine', g: 0.06 }], { gap: 0.12 }),
    cash: () => tone([{ f: 988, d: 0.07, type: 'square', g: 0.04 }, { f: 1319, d: 0.08, type: 'square', g: 0.04 }, { f: 1568, d: 0.22, type: 'square', g: 0.035 }, { f: 2093, d: 0.18, type: 'sine', g: 0.03, at: 0.2 }]),
    whoosh: () => tone([{ f: 320, to: 880, d: 0.22, type: 'sine', g: 0.05 }, { f: 660, d: 0.12, type: 'triangle', g: 0.03, at: 0.04 }]),
    jackpot: () => tone([{ f: 523 }, { f: 659 }, { f: 784 }, { f: 1047, d: 0.45 }, { f: 1319, d: 0.35, at: 0.36 }, { f: 1568, d: 0.5, at: 0.5, type: 'sine', g: 0.05 }], { gap: 0.09, type: 'square', g: 0.05 }),
    drum: () => tone([{ f: 90, d: 0.12, type: 'sine', g: 0.08 }, { f: 110, d: 0.12, at: 0.14, type: 'sine', g: 0.08 }, { f: 130, d: 0.4, at: 0.28, type: 'triangle', g: 0.06 }]),
    siren: () => tone([{ f: 740, d: 0.16, type: 'sawtooth', g: 0.06 }, { f: 460, d: 0.16, type: 'sawtooth', g: 0.06, at: 0.18 }, { f: 740, d: 0.16, type: 'sawtooth', g: 0.05, at: 0.36 }, { f: 460, d: 0.22, type: 'sawtooth', g: 0.05, at: 0.54 }]),
  };
  let lofi = null;
  function lofiStart() {
    const ctx = ac();
    if (!ctx || lofi) return;
    const g = ctx.createGain();
    g.gain.value = 0.045;
    g.connect(audio.master);
    const oscs = [0, 1, 2].map(() => { const o = ctx.createOscillator(); o.type = 'sine'; const og = ctx.createGain(); og.gain.value = 0.5; o.connect(og); og.connect(g); o.start(); return o; });
    const chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 196, 246.9]];
    let i = 0;
    const play = () => { const c = chords[i++ % chords.length]; oscs.forEach((o, k) => o.frequency.setTargetAtTime(c[k] / 2, ctx.currentTime, 0.12)); };
    play();
    const timer = setInterval(play, 3200);
    lofi = { stop() { clearInterval(timer); oscs.forEach((o) => { try { o.stop(); } catch { /* already stopped */ } }); g.disconnect(); lofi = null; } };
  }
  function lofiStop() { lofi?.stop(); }
  let city = null;
  function cityStop() { city?.stop(); }
  function cityStart() {
    const ctx = ac();
    if (!ctx || city || !soundOn) return;
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(audio.master);
    master.gain.linearRampToValueAtTime(0.03, ctx.currentTime + 1.6);
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 240;
    const ng = ctx.createGain();
    ng.gain.value = 0.22;
    noise.connect(low); low.connect(ng); ng.connect(master); noise.start();
    const bass = ctx.createOscillator();
    bass.type = 'sine';
    bass.frequency.value = 55;
    const bg = ctx.createGain();
    bg.gain.value = 0.4;
    bass.connect(bg); bg.connect(master); bass.start();
    const bell = ctx.createOscillator();
    bell.type = 'triangle';
    bell.frequency.value = 523;
    const bellg = ctx.createGain();
    bellg.gain.value = 0.0001;
    bell.connect(bellg); bellg.connect(master); bell.start();
    const notes = [523, 659, 784, 659, 880, 784];
    let k = 0;
    const timer = setInterval(() => {
      if (!city) return;
      bell.frequency.setTargetAtTime(notes[k++ % notes.length], ctx.currentTime, 0.04);
      bellg.gain.setValueAtTime(0.0001, ctx.currentTime);
      bellg.gain.exponentialRampToValueAtTime(0.035, ctx.currentTime + 0.06);
      bellg.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.5);
    }, 3200);
    city = { stop() { clearInterval(timer); try { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.3); } catch { /* closed */ } setTimeout(() => { try { noise.stop(); bass.stop(); bell.stop(); master.disconnect(); } catch { /* already stopped */ } }, 400); city = null; } };
  }

  // ---------------------------------------------------------------- HUD
  const avatarEl = h('div', { class: 'avatar', text: '🤖' });
  const nameEl = h('span');
  const statusDot = h('i', { class: 'live-dot warn' });
  const statusEl = h('span', { text: '연결 중' });
  const profile = h('button', { class: 'profile', type: 'button', 'aria-label': '프로필 편집', onclick: () => openProfile() },
    avatarEl,
    h('div', { class: 'who' }, h('div', { class: 'name' }, nameEl), h('div', { class: 'status' }, statusDot, statusEl)),
  );
  const peopleEl = h('span', { class: 'tnum', text: '1' });
  const channelEl = h('span', { class: 'tnum', text: '1채널' });
  const channelCard = h('button', { class: 'channel-card', type: 'button', title: '채널 바꾸기', onclick: () => openChannels() }, channelEl);
  const amtEl = h('span', { class: 'amt tnum', text: '0' });
  const coinIcon = h('div', { class: 'coin-icon', 'aria-hidden': 'true' }, h('img', { src: 'icons/coin.jpg?v=2', alt: '' }));
  const pendingChip = h('span', { class: 'chip gold pulse', hidden: true });
  const sessionChip = h('span', { class: 'chip', text: `0/${money(BALANCE.starterBid)}` });
  const protectLine = h('span', { class: 'protect', hidden: true });
  const nextLine = h('span', { class: 'nextgoal' });
  const todayBtn = h('button', { class: 'chip', type: 'button', text: '미션', onclick: (e) => { e.stopPropagation(); openToday(); } });
  const holdBtn = h('button', { class: 'chip', type: 'button', text: '내 점령', onclick: (e) => { e.stopPropagation(); openHolds(); } });
  const walletEl = h('div', { class: 'glass wallet', role: 'button', tabindex: '0', title: '지갑 · 정산 안내', onclick: () => openWalletInfo(), onkeydown: (e) => { if (e.key === 'Enter') openWalletInfo(); } }, coinIcon,
    h('div', null, h('div', null, amtEl, h('span', { class: 'unit', text: 'COIN' })), h('div', { class: 'sub' }, h('span', { class: 'sub-fixed' }, todayBtn, holdBtn), h('span', { class: 'sub-live' }, sessionChip, pendingChip, protectLine), nextLine)));
  const rankRows = h('div', { class: 'rows' });
  const feedRows = h('div', { class: 'feed' });
  const liveBoard = h('div', { class: 'glass liveboard' },
    h('button', { class: 'livehead', type: 'button', onclick: () => openRanks() }, h('b', { text: '🏆 실시간 순위' }), h('span', { text: '전체' })),
    rankRows,
    h('button', { class: 'livehead feedhead', type: 'button', onclick: () => openFeed() }, h('b', { text: '📢 광장 소식' })),
    feedRows,
  );
  feedRows.append(h('p', { class: 'empty', text: '점령·분양 소식이 여기 남아요' }));
  const guestWarn = h('div', { class: 'guestwarn', hidden: true },
    h('p', { text: '닫으면 코인이 사라질 수 있어요' }),
    h('button', { class: 'btn gold', type: 'button', text: '+300', onclick: (e) => { e.preventDefault(); e.stopPropagation(); openLogin(); } }),
  );
  root.append(h('div', { class: 'hud-l' }, h('div', { class: 'glass ident' }, profile, channelCard), guestWarn, walletEl, liveBoard));
  const feverEl = h('div', { class: 'glass fever', title: '택시 하차와 전광판 점령으로 쌓입니다. 20이 되면 잠시 코인이 2배가 되고 택시 부스트가 무제한입니다.', text: '🔮 광장 열기 0/20' });
  root.querySelector('.hud-l')?.append(feverEl);

  const soundBtn = h('button', { class: 'btn ghost icon tool-more', type: 'button', 'aria-label': '사운드', title: '사운드', text: soundOn ? '🔊' : '🔇', onclick: () => {
    soundOn = !soundOn;
    store('kts_sound', soundOn);
    soundBtn.textContent = soundOn ? '🔊' : '🔇';
    if (!soundOn) { cityStop(); if (dance) endDance(true); return; }
    cityStart();
    sfx.click();
  } });
  const fsOn = () => document.fullscreenElement || document.webkitFullscreenElement;
  function askFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req || fsOn()) return;
    try {
      const p = req.call(el, { navigationUI: 'hide' });
      const lockKeys = () => { if (navigator.keyboard?.lock) navigator.keyboard.lock(['Escape']).catch(() => {}); };
      if (p && p.then) p.then(lockKeys).catch(() => {});
      else lockKeys();
    } catch {
      try { const p = req.call(el); if (p && p.catch) p.catch(() => {}); } catch { /* this browser keeps its own chrome */ }
    }
  }
  const fsBtn = h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': '전체 화면', title: '전체 화면', text: '⛶', onclick: () => {
    if (fsOn()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      const p = exit && exit.call(document);
      if (p && p.catch) p.catch(() => {});
    } else askFullscreen();
  } });
  const syncFs = () => { fsBtn.textContent = fsOn() ? '✕' : '⛶'; };
  document.addEventListener('fullscreenchange', () => { syncFs(); if (!fsOn() && dance) endDance(true); });
  document.addEventListener('webkitfullscreenchange', syncFs);
  const mapCanvas = h('canvas', { width: 368, height: 368 });
  const locText = h('span', { text: '맨해튼' });
  const locPill = h('div', { class: 'glass locpill', title: '지금 있는 거리' }, h('i', { text: '📍' }), locText);
  const mapEl = h('button', { class: 'glass minimap', type: 'button', 'aria-label': '뉴욕 지도 크게 보기 (M)', title: '클릭해서 지도 크게 보기 (M)', onclick: () => openMap() }, mapCanvas, h('div', { class: 'tag', text: 'MAP · M' }), h('div', { class: 'zoom', text: '⤢' }));
  fsBtn.classList.add('tool-desk');
  root.append(h('div', { class: 'hud-r' },
    h('div', { class: 'bar' },
      h('div', { class: 'glass tools' },
        h('button', { class: 'btn icon', type: 'button', 'aria-label': '전광판 점령', title: '전광판 점령', text: '📢', onclick: () => openBillboard('MAIN_TOP') }),
        h('button', { class: 'btn icon tool-more', type: 'button', 'aria-label': 'VIP 메뉴', title: 'VIP 메뉴', text: '👑', onclick: () => openVip() }),
        h('button', { class: 'btn icon tool-desk', type: 'button', 'aria-label': '사진 찍어 공유', title: '사진 찍어 공유', text: '📸', onclick: () => openShot() }),
        h('button', { class: 'btn icon', type: 'button', 'aria-label': '점령 순위', title: '점령 순위', text: '🏆', onclick: () => openRanks() }),
        h('button', { class: 'btn icon tool-more', type: 'button', 'aria-label': '토지 분양', title: '토지 분양', text: '🏗️', onclick: () => openHub() }),
        soundBtn,
        fsBtn,
        h('button', { class: 'btn ghost icon tool-more', type: 'button', 'aria-label': '설정', title: '설정', text: '⚙️', onclick: () => openSettings() }),
        h('button', { class: 'btn icon tool-fold', type: 'button', 'aria-label': '메뉴 더보기', title: '메뉴', text: '⋯', onclick: (e) => e.currentTarget.parentElement.classList.toggle('open') }),
      ),
    ),
    mapEl,
    locPill,
  ));

  const newsKick = h('div', { class: 'kick' }, h('b', { text: '속보' }), 'LIVE');
  const newsSmall = h('small');
  const newsText = h('strong');
  const newsEl = h('div', { class: 'glass news', role: 'status' }, newsKick, h('div', { class: 'body' }, newsSmall, newsText));
  root.append(newsEl);

  const coolSvg = (() => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 26 26');
    const bg = document.createElementNS(ns, 'circle');
    Object.entries({ cx: 13, cy: 13, r: 11, fill: 'none', stroke: 'rgba(255,255,255,.12)', 'stroke-width': 3 }).forEach(([k, v]) => bg.setAttribute(k, v));
    const fg = document.createElementNS(ns, 'circle');
    Object.entries({ cx: 13, cy: 13, r: 11, fill: 'none', stroke: '#ffcf5a', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-dasharray': '69.1', 'stroke-dashoffset': '0' }).forEach(([k, v]) => fg.setAttribute(k, v));
    svg.append(bg, fg);
    return { svg, fg };
  })();
  const promptKey = h('span', { class: 'keycap', text: coarse ? '탭' : 'E' });
  const promptText = h('span');
  const promptSub = h('span', { class: 'sub' });
  const promptCool = h('span', { class: 'cool', hidden: true }, coolSvg.svg);
  const promptBtn = h('button', { class: 'glass', type: 'button', onclick: () => hooks.interact() }, promptKey, h('span', null, promptText, ' ', promptSub), promptCool);
  const promptEl = h('div', { class: 'prompt' }, promptBtn);
  root.append(promptEl);

  const dock = h('div', { class: 'glass dock', role: 'toolbar', 'aria-label': '감정 표현' });
  for (const [id, e] of Object.entries(EMOTES)) {
    const b = h('button', { class: 'emote', type: 'button', title: `${e.label} (${id})`, onclick: () => { react(Number(id)); } },
      h('span', { class: 'e', text: e.glyph }), h('span', { class: 'l', text: e.label }), h('span', { class: 'k', text: id }));
    b.dataset.id = id;
    dock.append(b);
  }
  const moreBtn = h('button', { class: 'emote more', type: 'button', title: '리액션 이모지 (5)', 'aria-expanded': 'false', onclick: () => toggleReacts() },
    h('span', { class: 'e', text: '😀' }), h('span', { class: 'l', text: '리액션' }), h('span', { class: 'k', text: '5' }));
  dock.append(h('div', { class: 'sep' }), moreBtn);
  root.append(dock);
  const reactPanel = h('div', { class: 'glass reacts', hidden: true, role: 'menu', 'aria-label': '리액션 이모지' },
    ...REACTIONS.map((r, i) => h('button', { type: 'button', text: r.g, 'aria-label': r.g, onclick: () => { hooks.reactEmoji(i); toggleReacts(false); } })));
  if (coarse) {
    reactPanel.prepend(...dock.querySelectorAll('.emote:not(.more)'));
    dock.querySelector('.sep')?.remove();
  }
  root.append(reactPanel);
  document.addEventListener('pointerdown', (e) => {
    if (reactPanel.hidden) return;
    if (e.target.closest?.('.reacts, .emote.more')) return;
    toggleReacts(false);
  });
  function toggleReacts(force) {
    const open = force ?? reactPanel.hidden;
    reactPanel.hidden = !open;
    moreBtn.classList.toggle('on', open);
    moreBtn.setAttribute('aria-expanded', String(open));
    if (open) sfx.click();
  }

  const help = h('div', { class: 'glass help' },
    h('span', null, h('kbd', { text: 'W A S D' })), h('span', { text: '이동 (카메라 기준)' }),
    h('span', null, h('kbd', { text: '드래그' }), ' ', h('kbd', { text: '휠' })), h('span', { text: '시점 회전 · 줌 (위로 끌면 하늘)' }),
    h('span', null, h('kbd', { text: 'Shift' })), h('span', { text: '천천히 걷기 · 택시 부스트' }),
    h('span', null, h('kbd', { text: 'Space' })), h('span', { text: '점프 · 택시 경적' }),
    h('span', null, h('kbd', { text: 'E' })), h('span', { text: '상호작용 · 택시 타기/내리기' }),
    h('span', null, h('kbd', { text: 'M' })), h('span', { text: '뉴욕 지도 · ⚡ 순간이동' }),
    h('span', null, h('kbd', { text: '1-4' })), h('span', { text: '감정 표현' }),
  );
  if (!coarse) root.append(help);
  setTimeout(() => help.classList.add('fade'), 16000);

  // taxi HUD + waypoint pill
  const spdEl = h('b', { class: 'tnum', text: '0' });
  const fareEl = h('b', { class: 'tnum', text: '$3.00' });
  const jobArrow = h('i', { class: 'arrow', text: '➤' });
  const jobTitle = h('small', { text: '손님 찾는 중' });
  const jobDist = h('b', { class: 'tnum', text: '-' });
  const jobTime = h('span', { class: 'time tnum' });
  const jobEl = h('div', { class: 'job' }, jobArrow, h('div', null, jobTitle, jobDist), jobTime);
  const trainEl = h('div', { class: 'keys', hidden: true });
  const taxiHud = h('div', { class: 'glass taxihud', hidden: true },
    h('div', { class: 'spd' }, spdEl, h('span', { text: 'km/h' })),
    h('div', { class: 'meter' }, h('small', { text: 'NYC TAXI METER' }), fareEl),
    jobEl,
    trainEl,
    h('div', { class: 'keys', text: coarse ? '조이스틱 ↑↓ 가속·후진 · ←→ 핸들 · ⚡ 부스트 · 하차 버튼' : 'W/S 가속·브레이크 · A/D 핸들 · Shift 부스트 · Space 경적 · E 하차' }),
  );
  root.append(taxiHud);
  const sponsorTitle = h('h3');
  const sponsorBody = h('p');
  const sponsorPay = h('b', { class: 'gold' });
  const sponsorShout = h('input', { class: 'input', maxLength: 15, placeholder: '한 줄 응원, 15자', 'aria-label': '응원 한 줄' });
  const sponsorGo = h('button', { class: 'btn gold go', type: 'button', text: '기운 보태기 +5' });
  const sponsorLink = h('button', { class: 'btn ghost link', type: 'button', text: '작성자 링크' });
  const sponsorActs = h('div', { class: 'row' }, sponsorGo, sponsorLink);
  const sponsorEl = h('div', { class: 'glass sponsor', hidden: true }, sponsorTitle, sponsorBody, sponsorShout, sponsorPay, sponsorActs);
  root.append(sponsorEl);
  let sponsorTimer = 0;
  function hideSponsor() { sponsorEl.hidden = true; document.body.classList.remove('has-sponsor'); clearTimeout(sponsorTimer); }
  function showSponsor(ev) {
    const b = ev.board || {};
    const lines = [b.line1, b.line2, b.line3].map((t) => String(t || '').trim()).filter(Boolean);
    sponsorTitle.textContent = b.holder_name ? `👑 소원 주인 · ${b.holder_name}` : '빈 전광판 앞 도착';
    sponsorBody.textContent = lines.join(' · ') || '이 자리를 점령하세요';
    sponsorPay.hidden = !ev.fare;
    sponsorPay.textContent = ev.fare ? `운임 +${ev.fare} 코인` : '';
    const url = /^https:\/\//.test(String(b.external_url || '')) ? b.external_url : '';
    sponsorShout.hidden = !ev.slot;
    sponsorGo.hidden = !ev.slot;
    sponsorGo.onclick = () => { if (ev.slot) hooks.cheer?.(ev.slot, sponsorShout.value); sponsorShout.value = ''; };
    sponsorLink.hidden = !url;
    sponsorLink.onclick = () => { if (url) hooks.adClick?.(ev.slot, url); };
    sponsorEl.hidden = false;
    document.body.classList.add('has-sponsor');
    clearTimeout(sponsorTimer);
    sponsorTimer = setTimeout(hideSponsor, ev.slot || url ? 12000 : 4200);
  }
  const wayArrow = h('i', { class: 'arrow', text: '➤' });
  const wayText = h('span', { class: 'tnum' });
  const wayPill = h('button', { class: 'glass waypill', type: 'button', hidden: true, title: '목적지 지우기', onclick: () => hooks.setWaypoint(null) }, '📍', wayArrow, wayText, h('small', { text: '✕' }));
  root.append(wayPill);

  const toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
  document.body.append(toasts);

  const needle = h('div', { class: 'needle' });
  const bakeHint = h('span', { class: 'hint', text: coarse ? '버튼을 눌러 굽기를 멈추세요' : 'Space · Enter · 클릭으로 멈추기' });
  const bakeEl = h('div', { class: 'glass bake', role: 'dialog', 'aria-label': '붕어빵 굽기' },
    h('header', null, h('h3', { text: '🐟 황금 붕어빵 굽기' }), h('span', { text: '초록 +5 · 금색 정중앙 +15' })),
    h('div', { class: 'gauge' },
      h('span', { class: 'lbl side', style: { left: '42.5%' }, text: 'GOOD' }),
      h('span', { class: 'lbl', style: { left: '50%', color: '#2a1800' }, text: 'GOLD' }),
      h('span', { class: 'lbl side', style: { left: '57.5%' }, text: 'GOOD' }),
      needle),
    h('div', { class: 'row' }, bakeHint, h('button', { class: 'btn gold stop', type: 'button', onclick: () => stopBake(), text: '지금 뒤집기!' })),
  );
  root.append(bakeEl);
  const resultB = h('b'), resultS = h('span');
  const resultEl = h('div', { class: 'result' }, resultB, resultS);
  root.append(resultEl);

  const rhythmCanvas = h('canvas', { width: 960, height: 560 });
  const rhythmScore = h('b', { class: 'tnum', text: '0%' });
  const rhythmCombo = h('span', { class: 'tnum' });
  const lanePads = h('div', { class: 'pads' }, ...['←', '↓', '↑', '→'].map((t, i) => h('button', { type: 'button', text: t, onpointerdown: (e) => { e.preventDefault(); danceHit(i); } })));
  const rhythmEl = h('div', { class: 'glass rhythm', role: 'dialog', 'aria-label': 'K-POP 댄스 챌린지' },
    h('header', null, h('h3', { text: '💃 K-POP 댄스 챌린지' }), h('div', { class: 'acc' }, rhythmCombo, rhythmScore, h('button', { class: 'x', type: 'button', text: '그만두기', onclick: () => endDance(true) }))),
    rhythmCanvas,
    coarse ? lanePads : h('p', { class: 'hint', text: '쉬움 · 0%도 +2 · 55% +5 · 75% +10 · 90% +15 · ←↓↑→ 또는 D F J K' }),
  );
  root.append(rhythmEl);

  // touch controls
  const knob = h('div', { class: 'knob' });
  const joy = h('div', { class: 'joy', 'aria-hidden': 'true' }, knob);
  const tap = (fn) => (ev) => { ev.preventDefault(); ev.stopPropagation(); fn(); };
  const actBtn = h('button', { class: 'act big', type: 'button', hidden: true, onpointerdown: tap(() => hooks.interact()) });
  const boostBtn = h('button', { class: 'act boost', type: 'button', hidden: true, 'aria-label': '부스트', text: '⚡' });
  boostBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); hooks.boost?.(true); });
  const boostOff = () => hooks.boost?.(false);
  boostBtn.addEventListener('pointerup', boostOff);
  boostBtn.addEventListener('pointercancel', boostOff);
  boostBtn.addEventListener('pointerleave', boostOff);
  const jumpBtn = h('button', { class: 'glass act jump', type: 'button', 'aria-label': '점프', text: '↑', onpointerdown: tap(() => hooks.jump()) });
  if (coarse) {
    root.append(joy, h('div', { class: 'acts' }, boostBtn, actBtn, jumpBtn));
    let jp = null;
    const setJoy = (ev) => {
      const r = joy.getBoundingClientRect();
      let dx = ev.clientX - (r.left + r.width / 2), dy = ev.clientY - (r.top + r.height / 2);
      const max = r.width * 0.36, d = Math.hypot(dx, dy);
      if (d > max) { dx *= max / d; dy *= max / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      hooks.joystick(dx / max, dy / max);
    };
    joy.addEventListener('pointerdown', (ev) => { jp = ev.pointerId; joy.setPointerCapture(ev.pointerId); setJoy(ev); });
    joy.addEventListener('pointermove', (ev) => { if (ev.pointerId === jp) setJoy(ev); });
    const end = (ev) => { if (ev.pointerId !== jp) return; jp = null; knob.style.transform = ''; hooks.joystick(0, 0); };
    joy.addEventListener('pointerup', end);
    joy.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------------------- helpers
  function renderPending() {
    pendingChip.hidden = !(wallet.pending > 0);
    if (pendingChip.hidden) return;
    const info = hooks.walletInfo?.() || {};
    const age = info.pendingSince ? (Date.now() - info.pendingSince) / 1000 : 0;
    const text = info.canSettle === false ? `+${money(wallet.pending)} 미정산 · 테스트 서버` : age < 40 ? `+${money(wallet.pending)} 정산 중…` : `+${money(wallet.pending)} 정산 대기`;
    if (pendingChip.textContent !== text) pendingChip.textContent = text;
    pendingChip.classList.toggle('warn', info.canSettle === false);
  }
  function renderGoal() {
    const earned = Math.max(0, Math.floor(Number(wallet.earned) || 0));
    const goal = `${money(earned)}/${money(BALANCE.starterBid)}`;
    if (sessionChip.textContent !== goal) sessionChip.textContent = goal;
    const left = soonestProtect();
    const held = myBoards().length;
    if (held && left > 0) {
      const text = fmtProtect(left);
      protectLine.hidden = false;
      if (protectLine.textContent !== text) protectLine.textContent = text;
    } else if (held) {
      protectLine.hidden = false;
      if (protectLine.textContent !== '보호 끝 · 빼앗길 수 있어요') protectLine.textContent = '보호 끝 · 빼앗길 수 있어요';
    } else if (!protectLine.hidden) {
      protectLine.hidden = true;
      protectLine.textContent = '';
    }
    const goalText = nextGoalText();
    if (nextLine.textContent !== goalText) nextLine.textContent = goalText;
  }
  function renderWallet(bump) {
    amtEl.textContent = money(wallet.confirmed + wallet.pending);
    renderPending();
    renderGoal();
    if (bump) { walletEl.classList.remove('bump'); void walletEl.offsetWidth; walletEl.classList.add('bump'); }
  }
  let accountView = { ready: false, guest: false, linked: false };
  function renderProfile() {
    nameEl.replaceChildren(document.createTextNode(hooks.nick()));
    if (accountView.linked) nameEl.append(h('i', { class: 'verified', title: '인증 계정', text: '✓' }));
    avatarEl.style.setProperty('--me', hooks.color());
    avatarEl.textContent = (SPECIES.find((s) => s.id === hooks.species()) || SPECIES[0]).glyph;
  }
  function renderAccount() {
    guestWarn.hidden = !(accountView.ready && accountView.guest && !accountView.linked);
    renderProfile();
  }
  function renderStatus() {
    statusEl.textContent = statusKind === 'ok' ? `${people}명` : statusText;
    if (channelEl) channelEl.textContent = peopleCh + '채널';
    statusDot.className = 'live-dot' + (statusKind === 'off' ? ' off' : statusKind === 'ok' ? '' : ' warn');
  }
  function note(text, kind = '', onClick) {
    if (!text) return;
    const click = typeof onClick === 'function' ? onClick : null;
    const t = h(click ? 'button' : 'div', { class: `glass toast ${kind}${click ? ' hit' : ''}`, type: click ? 'button' : null, text });
    if (click) t.addEventListener('click', () => { click(); t.remove(); });
    toasts.append(t);
    while (toasts.children.length > 3) toasts.firstChild.remove();
    setTimeout(() => { if (!t.isConnected) return; t.classList.add('out'); setTimeout(() => t.remove(), 320); }, click ? 8000 : 2800);
  }
  const newsQueue = [];
  let newsBusy = false;
  function pushNews(kicker, text, sound = true) {
    newsQueue.push({ kicker, text, sound });
    if (newsQueue.length > 6) newsQueue.shift();
    pumpNews();
  }
  function pumpNews() {
    if (newsBusy || !newsQueue.length) return;
    newsBusy = true;
    const item = newsQueue.shift();
    const line = h('div', { class: 'f' });
    for (const part of item.text) line.append(part?.nodeType ? part.cloneNode(true) : document.createTextNode(String(part ?? '')));
    for (const n of [...feedRows.querySelectorAll('.empty')]) n.remove();
    feedRows.prepend(line);
    while (feedRows.children.length > 4) feedRows.lastChild.remove();
    newsSmall.textContent = item.kicker;
    newsText.replaceChildren(...item.text);
    newsEl.classList.add('show');
    if (item.sound) sfx.news();
    setTimeout(() => {
      newsEl.classList.remove('show');
      setTimeout(() => { newsBusy = false; pumpNews(); }, 600);
    }, 4400);
  }
  setInterval(() => { if (near && (near.kind === 'crowd' || near.kind === 'cart')) renderPrompt(); }, 400);
  function cooldownLeft() { return Math.max(0, coolUntil - performance.now()); }
  function armCooldown() { coolUntil = performance.now() + COOLDOWN; }
  setInterval(() => { if (near && (near.kind === 'crowd' || near.kind === 'cart')) renderPrompt(); }, 400);
  const PROMPTS = {
    crowd: ['같이 함성', '옆에 사람이 있어야 해요', '함성'],
    cart: ['Space / E — 붕어빵 굽기', '원 안에 서면 시작', '굽기!'],
    atm: ['황금 ATM 열기', '전광판 · 토지 거래', 'ATM'],
    stage: ['Space — 댄스 시작', '이모지 4번은 게임이 아니에요', '댄스!'],
    taxi: ['E — 정차한 택시 탑승', '지나가는 택시는 타지 않아요', '탑승'],
    stand: ['E — 택시 호출', '오면 그 자리에서 탑승', '호출'],
    fountain: ['10코인으로 포춘쿠키', '빨간 계단 앞 분수', '뽑기'],
    lounge: ['E — 빨간 계단에서 멍때리기', '켜 두면 10초마다 +3', '관람'],
  };
  function renderPrompt() {
    const show = !!near && !baking && !sheet && !dance && !driving;
    promptEl.classList.toggle('show', show);
    actBtn.hidden = !(show || driving);
    if (driving) { actBtn.textContent = '하차'; return; }
    if (!near) return;
    const left = cooldownLeft();
    const p = near.kind === 'crowd'
      ? (near.n
        ? [`같이 함성 · 옆 ${near.n}명`, left > 0 ? `다음 함성까지 ${(left / 1000).toFixed(0)}초` : `+${BALANCE.cheerGroup} 코인`, '함성']
        : ['함성', left > 0 ? `다음 함성까지 ${(left / 1000).toFixed(0)}초` : `혼자여도 +${BALANCE.cheerSolo}`, '함성'])
      : (PROMPTS[near.kind] || [`${near.id}번 건물 · ${levelOf(near.id).t}`, '붕어빵 포차와는 다른 자리예요', '건물']);
    promptText.textContent = p[0];
    promptSub.textContent = p[1];
    actBtn.textContent = p[2];
  }
  function levelOf(id) {
    const p = world.plots.find(x => Number(x.plot_id) === Number(id));
    return LEVELS[Math.max(0, Math.min(4, Number(p?.level) || 0))];
  }

  function react(id) {
    const b = dock.querySelector(`[data-id="${id}"]`) || reactPanel.querySelector(`[data-id="${id}"]`);
    if (b) { b.classList.remove('fire'); void b.offsetWidth; b.classList.add('fire'); }
    hooks.react(id);
  }

  function pop(amount, crit, at) {
    const p = at || (() => { const r = coinIcon.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top }; })();
    const el = h('div', { class: 'plus', text: `${crit ? '🌟 ' : ''}+${amount}`, style: { left: `${p.x}px`, top: `${p.y}px` } });
    document.body.append(el);
    setTimeout(() => el.remove(), 1150);
  }

  function flyCoins(amount, from) {
    const r = coinIcon.getBoundingClientRect();
    const tx = r.left + r.width / 2, ty = r.top + r.height / 2;
    const fx = from?.x ?? innerWidth / 2, fy = from?.y ?? innerHeight / 2;
    pop(amount, amount >= 15, { x: fx, y: fy - 20 });
    const n = Math.min(9, 2 + Math.ceil(amount / 3));
    for (let i = 0; i < n; i++) {
      const c = h('div', { class: 'coin-fly' });
      document.body.append(c);
      const sx = fx + (Math.random() - 0.5) * 60, sy = fy + (Math.random() - 0.5) * 30;
      const mx = (sx + tx) / 2 + (Math.random() - 0.5) * 160, my = Math.min(sy, ty) - 80 - Math.random() * 90;
      const a = c.animate([
        { transform: `translate(${sx}px, ${sy}px) scale(.4)`, opacity: 0 },
        { transform: `translate(${mx}px, ${my}px) scale(1.1)`, opacity: 1, offset: 0.4 },
        { transform: `translate(${tx}px, ${ty}px) scale(.55)`, opacity: 0.9 },
      ], { duration: 780 + i * 40, delay: i * 55, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'both' });
      a.onfinish = () => {
        c.remove();
        if (i === n - 1) { renderWallet(true); sfx.coin(); }
      };
    }
  }

  function showResult(big, small, miss) {
    resultB.textContent = big;
    resultS.textContent = small;
    resultEl.classList.toggle('miss', !!miss);
    resultEl.classList.remove('go');
    void resultEl.offsetWidth;
    resultEl.classList.add('go');
  }

  // ---------------------------------------------------------------- bake minigame
  function startBake() {
    if (baking || sheet) return false;
    if (near?.kind !== 'cart') { note('붕어빵 포차 앞으로 가까이 가세요', 'err'); return false; }
    const left = cooldownLeft();
    if (left > 0) { note(`붕어빵 틀이 식는 중… ${(left / 1000).toFixed(1)}초`); return false; }
    baking = { pos: Math.random() * 0.2, dir: 1, speed: 1.05 + Math.random() * 0.4 };
    bakeEl.classList.add('show');
    hooks.lockInput(true);
    renderPrompt();
    sfx.click();
    return true;
  }
  function stopBake(cancel) {
    if (!baking) return;
    const p = baking.pos;
    baking = null;
    bakeEl.classList.remove('show');
    hooks.lockInput(false);
    renderPrompt();
    if (cancel) return;
    let amount = 0;
    if (p >= 0.47 && p <= 0.53) amount = BALANCE.bakeGold;
    else if (p >= 0.38 && p <= 0.62) amount = BALANCE.bakeGood;
    if (!amount) { armCooldown(); sfx.miss(); showResult('MISS', '앗, 붕어빵이 타버렸어요…', true); missionBump('bake'); note('다음 판', 'ok', () => startBake()); return; }
    const ok = hooks.mine(amount, 'cart');
    missionBump('bake');
    if (amount === 15) { sfx.crit(); showResult('PERFECT!', '황금 붕어빵 +15 코인'); }
    else { sfx.hit(); showResult('GOOD!', '바삭한 붕어빵 +5 코인'); }
    note('다음 판', 'ok', () => startBake());
    if (!ok) note('광장 서버에 연결되면 코인이 기록됩니다', 'err');
  }

  // ---------------------------------------------------------------- K-POP rhythm game
  const LANE_COLORS = ['#ff3d9a', '#3fe6ff', '#39f58a', '#ffcf5a'];
  const DANCE_KEYS = { ArrowLeft: 0, KeyD: 0, ArrowDown: 1, KeyF: 1, ArrowUp: 2, KeyJ: 2, ArrowRight: 3, KeyK: 3 };
  const flashLane = [0, 0, 0, 0];
  let danceCool = 0, noiseBuf = null;
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  function noise(ctx) {
    if (noiseBuf) return noiseBuf;
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }
  function drum(ctx, t, kind, dest) {
    const g = ctx.createGain();
    g.connect(dest || audio.master);
    if (kind === 'kick') {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      g.gain.setValueAtTime(0.8, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.3);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = kind === 'snare' ? 'bandpass' : 'highpass';
    f.frequency.value = kind === 'snare' ? 1800 : 7000;
    g.gain.setValueAtTime(kind === 'snare' ? 0.45 : 0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'snare' ? 0.18 : 0.05));
    src.connect(f);
    f.connect(g);
    src.start(t);
    src.stop(t + 0.25);
  }
  function synth(ctx, t, freq, dur, type, vol, cutoff, dest) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    let node = o;
    if (cutoff) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; o.connect(f); node = f; }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g);
    g.connect(dest || audio.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  let danceBus = null;
  function stopDanceAudio() {
    const bus = danceBus;
    danceBus = null;
    if (!bus) return;
    try { bus.gain.setValueAtTime(0, audio.ctx?.currentTime || 0); bus.disconnect(); } catch { /* already stopped */ }
  }
  function startDance() {
    if (sheet || baking || driving) return false;
    if (dance) { endDance(true); return false; }
    if (near?.kind !== 'stage') { note('K-POP 스테이지 위 핑크 원 안으로 올라가세요', 'err'); return false; }
    if (performance.now() < danceCool) { note('숨 고르는 중… 잠시 후 다시 도전해요'); return false; }
    stopDanceAudio();
    const D = BALANCE.dance;
    const bpm = D.bpm, beat = 60 / bpm, lead = 4, beats = D.beats;
    const notes = [];
    let last = -1;
    for (let b = 0; b < beats; b++) {
      let lane = (Math.random() * 4) | 0;
      if (lane === last) lane = (lane + 1 + ((Math.random() * 3) | 0)) % 4;
      last = lane;
      notes.push({ t: (lead + b) * beat, lane, hit: null });
    }
    const delay = 0.25;
    const ctx = soundOn ? ac() : null;
    const dest = ctx ? ctx.createGain() : null;
    if (dest) { dest.connect(audio.master); danceBus = dest; }
    if (ctx && dest) {
      const t0 = ctx.currentTime + delay;
      const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
      for (let b = 0; b < lead + beats + 2; b++) {
        const t = t0 + b * beat;
        if (b < lead) { synth(ctx, t, b === lead - 1 ? 1320 : 880, 0.09, 'square', 0.05, 0, dest); continue; }
        drum(ctx, t, 'kick', dest);
        if (b % 2 === 1) drum(ctx, t, 'snare', dest);
        drum(ctx, t, 'hat', dest);
        drum(ctx, t + beat / 2, 'hat', dest);
        const ch = chords[Math.floor((b - lead) / 4) % 4];
        synth(ctx, t, midi(ch[0] - 24), beat * 0.9, 'sawtooth', 0.11, 520, dest);
        synth(ctx, t + beat / 2, midi(ch[b % 3] + 12), beat * 0.42, 'square', 0.03, 0, dest);
      }
    }
    dance = { notes, beat, lead, t0: performance.now() + delay * 1000, end: (lead + beats + 1) * beat, judge: '', judgeAt: 0, combo: 0, max: 0, score: 0 };
    rhythmEl.classList.add('show');
    hooks.lockInput(true);
    hooks.danceStart?.();
    renderPrompt();
    return true;
  }
  const danceNow = () => (performance.now() - dance.t0) / 1000;
  function judge(n, err) {
    const a = Math.abs(err);
    const [label, pts] = a <= BALANCE.dance.perfect ? ['PERFECT', 100] : a <= BALANCE.dance.great ? ['GREAT', 75] : a <= BALANCE.dance.good ? ['GOOD', 45] : ['MISS', 0];
    n.hit = label;
    dance.score += pts;
    dance.combo = pts ? dance.combo + 1 : 0;
    dance.max = Math.max(dance.max, dance.combo);
    dance.judge = label;
    dance.judgeAt = performance.now();
    if (pts) tone([{ f: [523, 659, 784, 1047][n.lane], d: 0.07, g: 0.03, type: 'sine' }]);
  }
  function danceHit(lane) {
    if (!dance) return;
    flashLane[lane] = performance.now();
    const now = danceNow();
    let best = null;
    for (const n of dance.notes) {
      if (n.hit || n.lane !== lane || Math.abs(now - n.t) > BALANCE.dance.window) continue;
      if (!best || Math.abs(now - n.t) < Math.abs(now - best.t)) best = n;
    }
    if (best) judge(best, now - best.t);
  }
  function endDance(cancel) {
    if (!dance) { stopDanceAudio(); return; }
    const d = dance;
    dance = null;
    stopDanceAudio();
    rhythmEl.classList.remove('show');
    hooks.lockInput(false);
    hooks.danceEnd?.();
    danceCool = performance.now() + 2500;
    renderPrompt();
    if (cancel) return;
    const acc = d.score / (d.notes.length * 100);
    const pct = Math.round(acc * 100);
    const amount = acc >= 0.9 ? 15 : acc >= 0.75 ? 10 : acc >= 0.55 ? 5 : BALANCE.danceShow;
    const ok = hooks.mine(amount, 'stage');
    sfx.crit();
    showResult(acc >= 0.9 ? 'ALL KILL!' : acc >= 0.75 ? 'GREAT!' : 'NICE!', `정확도 ${pct}% · 최대 ${d.max}콤보 · +${amount} 코인`);
    note('한 곡 더', 'ok', () => startDance());
    if (!ok) note('광장 서버에 연결되면 코인이 기록됩니다', 'err');
  }
  const rctx = rhythmCanvas.getContext('2d');
  function drawArrow(g, x, y, lane, color, s, hollow) {
    g.save();
    g.translate(x, y);
    g.rotate([-Math.PI / 2, Math.PI, 0, Math.PI / 2][lane]);
    g.beginPath();
    g.moveTo(0, -s);
    g.lineTo(s * 0.9, 0);
    g.lineTo(s * 0.38, 0);
    g.lineTo(s * 0.38, s * 0.85);
    g.lineTo(-s * 0.38, s * 0.85);
    g.lineTo(-s * 0.38, 0);
    g.lineTo(-s * 0.9, 0);
    g.closePath();
    if (hollow) { g.lineWidth = 4; g.strokeStyle = color; g.stroke(); }
    else { g.shadowColor = color; g.shadowBlur = 18; g.fillStyle = color; g.fill(); g.shadowBlur = 0; g.lineWidth = 3; g.strokeStyle = '#ffffff'; g.stroke(); }
    g.restore();
  }
  function drawDance() {
    const d = dance, g = rctx, W = rhythmCanvas.width, H = rhythmCanvas.height;
    const now = danceNow();
    for (const n of d.notes) if (!n.hit && now - n.t > BALANCE.dance.window) judge(n, 1);
    g.clearRect(0, 0, W, H);
    const lw = W / 4, hitY = H - 90, speed = 520;
    for (let i = 0; i < 4; i++) {
      const x = i * lw;
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(1, LANE_COLORS[i] + '30');
      g.fillStyle = gr;
      g.fillRect(x + 6, 0, lw - 12, H);
      const fl = Math.max(0, 1 - (performance.now() - flashLane[i]) / 180);
      if (fl > 0) { g.globalAlpha = fl * 0.55; g.fillStyle = LANE_COLORS[i]; g.fillRect(x + 6, hitY - 44, lw - 12, 88); g.globalAlpha = 1; }
      drawArrow(g, x + lw / 2, hitY, i, 'rgba(255,255,255,0.4)', 34, true);
    }
    for (const n of d.notes) {
      if (n.hit && n.hit !== 'MISS') continue;
      const y = hitY - (n.t - now) * speed;
      if (y < -60 || y > H + 60) continue;
      drawArrow(g, n.lane * lw + lw / 2, y, n.lane, n.hit === 'MISS' ? 'rgba(120,120,140,0.55)' : LANE_COLORS[n.lane], 34, false);
    }
    const age = (performance.now() - d.judgeAt) / 1000;
    if (d.judge && age < 0.6) {
      g.save();
      g.globalAlpha = 1 - age / 0.6;
      g.font = `900 ${Math.round(70 - age * 24)}px "Pretendard Variable", Pretendard, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = d.judge === 'PERFECT' ? '#ffe9a8' : d.judge === 'GREAT' ? '#3fe6ff' : d.judge === 'GOOD' ? '#39f58a' : '#ff6b81';
      g.shadowColor = g.fillStyle;
      g.shadowBlur = 24;
      g.fillText(d.judge, W / 2, H * 0.36);
      g.restore();
    }
    if (now < d.lead * d.beat) {
      const n = Math.ceil(d.lead - now / d.beat);
      g.font = '900 120px "Pretendard Variable", Pretendard, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = 'rgba(255,255,255,0.88)';
      g.fillText(n > 1 ? String(n - 1) : 'GO!', W / 2, H * 0.42);
    }
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(0, 0, W, 6);
    g.fillStyle = '#ff3d9a';
    g.fillRect(0, 0, W * Math.min(1, now / d.end), 6);
    const judged = d.notes.filter(n => n.hit).length;
    rhythmScore.textContent = `${judged ? Math.round(d.score / judged) : 100}%`;
    rhythmCombo.textContent = d.combo > 1 ? `${d.combo} COMBO` : '';
    if (now > d.end) endDance(false);
  }

  // ---------------------------------------------------------------- sheets
  function openChannels() {
    openSheet('채널', null, (host) => {
      const row = h('div', { class: 'channel-grid' });
      for (let n = 1; n <= 8; n++) {
        row.append(h('button', {
          class: 'btn' + (n === peopleCh ? ' gold' : ''),
          type: 'button',
          text: n === peopleCh ? n + '채널 · 지금' : n + '채널로 이동',
          onclick: () => { closeSheet(); hooks.setChannel?.(n); },
        }));
      }
      host.append(row);
    }, true);
  }
  function closeSheet(fromPop) {
    if (!sheet) return;
    sheet.el.remove();
    sheet.cleanup?.();
    sheet = null;
    hooks.lockInput(false);
    renderPrompt();
    if (!fromPop && history.state?.ktsSheet) history.back();
  }
  function openSheet(title, badge, build, narrow, variant) {
    const nested = !!sheet;
    closeSheet(true);
    const content = h('div', { class: 'content' });
    const x = h('button', { class: 'x', type: 'button', 'aria-label': '닫기', text: '×', onclick: closeSheet });
    const box = h('div', { class: `glass sheet${narrow ? ' narrow' : ''}${variant ? ' ' + variant : ''}`, role: 'dialog', 'aria-label': title },
      h('header', null, h('h2', null, title, badge ? h('span', { class: 'badge', text: badge }) : null), x), content);
    const el = h('div', { class: 'modal', onclick: (e) => { if (e.target === el) closeSheet(); } }, box);
    document.body.append(el);
    sheet = { el, cleanup: null };
    hooks.lockInput(true);
    renderPrompt();
    sheet.cleanup = build(content) || null;
    if (!nested) history.pushState({ ...(history.state || {}), ktsSheet: 1 }, '');
    sfx.click();
  }
  addEventListener('popstate', () => { if (sheet) closeSheet(true); });
  const SHARE_TEXT = '붕어빵 구워 뉴욕 타임스퀘어 전광판과 건물을 차지하세요!';
  function countShot() {
    return new Promise((resolve) => {
      hooks.lockInput?.(true);
      const el = h('div', { class: 'countflash', text: '3', style: { pointerEvents: 'auto' } });
      document.body.append(el);
      let n = 3;
      const step = () => {
        if (n <= 0) {
          el.textContent = '';
          el.classList.add('flash');
          sfx.shutter();
          let blob = null;
          try { blob = hooks.capture?.() || null; } catch { blob = null; }
          setTimeout(() => { el.remove(); hooks.lockInput?.(false); resolve(blob); }, 120);
          return;
        }
        el.textContent = String(n);
        sfx.tick();
        n -= 1;
        setTimeout(step, 700);
      };
      step();
    });
  }
  let shotBusy = false;
  async function openShot() {
    if (shotBusy) return;
    shotBusy = true;
    try {
    const blob = await countShot();
    if (!blob) { note('지금 화면을 담지 못했어요', 'err'); return; }
    const url = URL.createObjectURL(blob);
    const file = new File([blob], 'wishboard.jpg', { type: 'image/jpeg' });
    let imageUrl = '';
    const published = hooks.publishShot?.(blob).then((u) => { imageUrl = u || ''; return imageUrl; }).catch(() => '');
    openSheet('📸 타임스퀘어 사진', null, (host) => {
      const save = h('button', { class: 'btn ghost', type: 'button', text: '이미지 저장', onclick: () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'wishboard.jpg';
        a.click();
      } });
      const copy = h('button', { class: 'btn ghost', type: 'button', text: '사진 주소 복사', onclick: async () => {
        await published;
        if (!imageUrl) { note('사진 주소를 만들지 못했어요', 'err'); return; }
        try { await navigator.clipboard.writeText(imageUrl); note('사진 주소를 복사했어요', 'ok'); }
        catch { note(imageUrl); }
      } });
      const share = h('button', { class: 'btn gold', type: 'button', text: '공유하기', onclick: async () => {
        await published;
        const payload = { title: 'WISH BOARD : 모두의 전광판', text: SHARE_TEXT, url: imageUrl || location.href };
        try {
          if (imageUrl && navigator.canShare?.({ files: [file] })) await navigator.share({ ...payload, files: [file] });
          else if (navigator.share) await navigator.share(payload);
          else if (imageUrl) {
            await navigator.clipboard.writeText(imageUrl);
            note('이 브라우저는 공유 창이 없어요. 사진 주소를 복사했어요', 'ok');
          } else note('사진 주소를 만들지 못했어요', 'err');
        } catch (err) {
          if (err?.name === 'AbortError') return;
          if (imageUrl) {
            try { await navigator.clipboard.writeText(imageUrl); note('공유 창이 거절됐어요. 사진 주소를 복사했어요', 'ok'); return; } catch { /* fall through */ }
          }
          note('공유하지 못했어요. 이미지 저장을 이용해 주세요', 'err');
        }
      } });
      host.append(
        h('img', { class: 'shot-preview', src: url, alt: '타임스퀘어 스냅샷' }),
        h('p', { class: 'note', text: '사진 주소는 이 사진 파일입니다. 스레드·카카오톡에는 그 주소를 붙여 넣으세요.' }),
        h('div', { class: 'shot-row' }, save, copy, share),
      );
      return () => URL.revokeObjectURL(url);
    }, true);
    } finally { shotBusy = false; }
  }
  const boardById = (id) => world.billboards.find(b => b.slot_id === id) || null;
  function boardActive(b) {
    if (!b?.holder_id) return false;
    const exp = b.expires_at ? new Date(b.expires_at).getTime() : 0;
    return exp > Date.now();
  }
  function soonestProtect() {
    const me = hooks.actorId?.();
    if (!me) return 0;
    let best = 0;
    for (const b of world.billboards) {
      if (!boardActive(b) || b.holder_id !== me) continue;
      const left = protectedLeft(b);
      if (left > 0 && (!best || left < best)) best = left;
    }
    return best;
  }
  function myBoards() {
    const me = hooks.actorId?.();
    if (!me) return [];
    return world.billboards.filter((b) => b.holder_id === me && boardActive(b));
  }
  function nextGoalText() {
    const have = wallet.confirmed + wallet.pending;
    const held = myBoards();
    const has = (prefix) => held.some((b) => String(b.slot_id).startsWith(prefix));
    let price = floorOf('PLOT_1');
    let name = '분양 전광판';
    if (!held.length && firstOpenStarter()) { price = BALANCE.starterBid; name = '신규 전광판'; }
    else if (has('PLOT_') && !has('STREET_') && !has('SUB_') && !has('MAIN_')) { price = floorOf('STREET_1'); name = '메인거리'; }
    else if ((has('STREET_') || has('PLOT_')) && !has('SUB_') && !has('MAIN_')) { price = floorOf('SUB_1B'); name = '코너 전광판'; }
    else if (has('SUB_') || has('MAIN_')) { price = floorOf('MAIN_LOW'); name = '메인 타워'; }
    const left = Math.max(0, price - have);
    return left ? `다음 목표: ${name}까지 ${money(left)}코인` : `다음 목표: ${name}에 이름을 올리세요`;
  }
  const kstDay = () => new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);
  function kstWeek() {
    const d = new Date(Date.now() + 9 * 36e5);
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dn = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - dn + 3);
    const y = t.getUTCFullYear();
    const f = new Date(Date.UTC(y, 0, 4));
    const w = 1 + Math.round(((t - f) / 864e5 - 3 + ((f.getUTCDay() + 6) % 7)) / 7);
    return `${y}-W${String(w).padStart(2, '0')}`;
  }
  let dayState = null;
  function loadDay() {
    const day = kstDay();
    const week = kstWeek();
    const prev = recall('kts_daily', {}) || {};
    const fresh = prev.day !== day;
    dayState = {
      day, week,
      earn: fresh ? 0 : (prev.earn || 0),
      bake: fresh ? 0 : (prev.bake || 0),
      cheer: fresh ? 0 : (prev.cheer || 0),
      paid: fresh ? {} : (prev.paid || {}),
      streak: prev.streak || 0,
      last: prev.last || '',
      score: prev.week === week ? (prev.score || 0) : 0,
    };
    return dayState;
  }
  const today = () => (dayState && dayState.day === kstDay() ? dayState : loadDay());
  function saveDay(d) { dayState = d; store('kts_daily', d); }
  function missionBump(key, n = 1) {
    const d = today();
    d[key] = (d[key] || 0) + n;
    const need = key === 'earn' ? BALANCE.missionEarn : 1;
    if (d[key] >= need && !d.paid?.[key]) {
      d.paid = d.paid || {};
      d.paid[key] = 1;
      d.score = (d.score || 0) + BALANCE.season.mission;
      saveDay(d);
      if (hooks.mine?.(BALANCE.missionReward, 'me')) note(`오늘 미션 +${BALANCE.missionReward}`, 'ok');
      return;
    }
    saveDay(d);
  }
  function attend() {
    const d = today();
    if (d.last === d.day) return;
    const prev = new Date(Date.now() + 9 * 36e5 - 864e5).toISOString().slice(0, 10);
    d.streak = d.last === prev ? (d.streak || 0) + 1 : 1;
    d.last = d.day;
    saveDay(d);
    const coins = BALANCE.attend[Math.min(d.streak - 1, BALANCE.attend.length - 1)];
    if (hooks.mine?.(coins, 'me')) note(`출석 ${d.streak}일 +${coins}`, 'ok');
    todayBtn.textContent = `미션 · ${d.streak}일`;
  }
  function openToday() {
    const d = today();
    const row = (done, text) => h('p', { class: 'note', text: `${done ? '✅' : '☐'} ${text}` });
    const tomorrow = BALANCE.attend[Math.min(d.streak, BALANCE.attend.length - 1)];
    openSheet('미션', '매일 0시', (host) => {
      host.append(
        row(d.earn >= BALANCE.missionEarn, `코인 ${BALANCE.missionEarn}개 모으기 (${Math.min(d.earn, BALANCE.missionEarn)}/${BALANCE.missionEarn})`),
        row(d.bake >= 1, '붕어빵 1판 (성공이든 실패든)'),
        row(!!(d.qPaid || {}).fare, `손님 내리기 (${Math.min(d.fare || 0, 3)}/3) +50`),
        row(!!(d.qPaid || {}).cheer, `전광판 응원 (${Math.min(d.cheer || 0, 3)}/3) +30`),
        row(!!(d.qPaid || {}).stunt, `황금 링 통과 (${Math.min(d.stunt || 0, 2)}/2) +40`),
        h('p', { class: 'note', text: `출석 ${d.streak || 0}일 · 내일 접속하면 +${tomorrow}` }),
        h('p', { class: 'note', text: `이번 주 내 점수 ${d.score || 0} · 지금 광장 ${people}명` }),
        h('p', { class: 'note', text: `${feverEl.textContent}. 20이 되면 잠시 코인이 2배입니다.` }),
      );
    }, true);
  }
  let seenHold = null;
  function rememberTake(slot, by) {
    if (!slot) return;
    const list = (recall('kts_taken', []) || []).filter((x) => x?.slot && x.slot !== slot);
    store('kts_taken', [{ slot, by: chars(by || '누군가', 16), at: Date.now() }, ...list].slice(0, 12));
  }
  function openHolds() {
    const mine = myBoards();
    const lost = (recall('kts_taken', []) || []).filter((x) => x?.slot);
    openSheet('내 전광판', '점령 · 빼앗김', (host) => {
      host.append(h('b', { text: '지금 내 것' }));
      host.append(mine.length ? h('div', { class: 'rows' }, ...mine.map((b) => h('button', { class: 'chip', type: 'button', text: slotName(b.slot_id), onclick: () => { closeSheet(); openBillboard(b.slot_id); } }))) : h('p', { class: 'note', text: '점령 중인 전광판이 없어요' }));
      host.append(h('b', { text: '빼앗긴 것' }));
      host.append(lost.length ? h('div', { class: 'rows' }, ...lost.map((x) => h('button', { class: 'chip', type: 'button', text: `${slotName(x.slot)} · ${x.by}`, onclick: () => { closeSheet(); openAd(x.slot); } }))) : h('p', { class: 'note', text: '아직 빼앗긴 전광판이 없어요' }));
    }, true);
  }
  function watchHold() {
    const now = new Set(myBoards().map((b) => b.slot_id));
    if (seenHold) {
      for (const id of seenHold) if (!now.has(id)) {
        const b = boardById(id);
        if (b?.holder_id && b.holder_id !== hooks.actorId?.()) {
          rememberTake(id, b.holder_name);
          note(`${slotName(id)}을 ${b.holder_name || '누군가'}님이 빼앗았어요`, 'err', () => openBillboard(id));
        }
      }
    }
    seenHold = now;
  }
  function firstOpenStarter() {
    for (const id of BALANCE.starterSlots) {
      if (!boardActive(boardById(id))) return id;
    }
    return '';
  }
  function maybeStarterToast() {
    if (starterToastShown || !plazaReady || !entered) return;
    if (wallet.confirmed + wallet.pending < BALANCE.starterBid) return;
    const slot = firstOpenStarter();
    if (!slot) return;
    starterToastShown = true;
    const show = () => note(`${money(BALANCE.starterBid)}코인으로 빈 거리 전광판에 이름을 올릴 수 있어요`, 'ok', () => openBillboard(slot));
    if (document.getElementById('boot')) setTimeout(show, 950);
    else show();
  }
  const plotById = (id) => world.plots.find(p => Number(p.plot_id) === Number(id)) || null;
  const myPlots = () => world.plots.filter(p => p.owner_id && p.owner_id === hooks.actorId()).map(p => PLOT_SLOTS[Number(p.plot_id) - 1]).filter(Boolean);
  /** Sidewalk spot in front of a lot (where the player stands to open it). */
  function plotFront(slot) {
    const d = 5.4 * (slot.scale || 1) + 2.4;
    return { x: slot.x + Math.sin(slot.rot) * d, z: slot.z + Math.cos(slot.rot) * d };
  }
  function goWaypoint(p, label) {
    if (!insideLoop(p.x, p.z, 0)) { note('울타리 밖으로는 갈 수 없어요', 'err'); return; }
    hooks.setWaypoint(p);
    closeSheet();
    note(`📍 ${label} 길안내를 시작해요 · 하늘색 빛기둥을 따라가세요`, 'ok');
  }
  function goTeleport(p, label) {
    if (!insideLoop(p.x, p.z, 0)) { note('울타리 밖으로는 갈 수 없어요', 'err'); return; }
    closeSheet();
    hooks.teleport(p.x, p.z);
    sfx.fanfare();
    note(`⚡ ${label} 도착!`, 'ok');
  }
  function placeRow(slot) {
    const p = plotFront(slot);
    return h('div', { class: 'place' },
      h('div', { class: 'where' },
        h('b', { text: '📍 타임스퀘어 순환로 분양 건물' }),
        h('span', { text: `${slot.id}번 필지 · 순환 도로 바로 바깥` })),
      h('div', { class: 'go' },
        h('button', { class: 'btn ghost', type: 'button', text: '📍 길안내', onclick: () => goWaypoint(p, `${slot.id}번 토지`) }),
        h('button', { class: 'btn ghost', type: 'button', text: '🗺️ 지도', onclick: () => { hooks.setWaypoint(p); openMap(p); } }),
        h('button', { class: 'btn gold', type: 'button', text: '⚡ 바로 가기', onclick: () => goTeleport(p, `${slot.id}번 토지`) })));
  }

  const STICKER_GLYPHS = ['🔥부럽다!', '👑성지순례', '💖하트폭탄', '👀내자리찜'];
  function stickerBox(getSlot) {
    const wash = h('button', { type: 'button', class: 'btn gold', hidden: true, onclick: () => { hooks.washSticker?.(getSlot()); sync(); } });
    const sync = () => {
      const id = getSlot();
      const b = boardById(id);
      const mine = !!b?.holder_id && b.holder_id === hooks.actorId?.();
      const n = (hooks.stickerList?.(id) || []).length;
      wash.hidden = !(mine && n > 0);
      wash.textContent = `내 스티커 씻기 +15${n > 1 ? ` · ${n}장` : ''}`;
    };
    const box = h('div', { class: 'field' },
      h('label', null, '네온 스티커', h('span', { text: '30코인 · 모서리에 남아요' })),
      h('div', { class: 'row' }, ...STICKER_GLYPHS.map((g) => h('button', { type: 'button', class: 'btn ghost', text: `${g} 30`, onclick: async () => {
        try { await hooks.sticker?.(getSlot(), g); sync(); } catch (e) { note(e?.message || '스티커를 붙이지 못했어요', 'err'); }
      } }))),
      wash,
    );
    box.syncStickers = sync;
    sync();
    return box;
  }
  function airBar() {
    const line = h('input', { class: 'input', maxLength: 24, placeholder: '60초 동안 모든 전광판에 올릴 한 줄', 'aria-label': '장악 문구' });
    const go = async (pay) => {
      const text = line.value.trim();
      if (!text) { note('한 줄을 적어 주세요', 'err'); return; }
      try { await hooks.takeover?.({ line: text, pay }); closeSheet(); }
      catch (e) { note(e?.message || '장악에 실패했어요', 'err'); }
    };
    return h('div', { class: 'vipcard' },
      h('h4', { text: '📣 전 전광판 60초 장악' }),
      h('p', { text: '5000코인 또는 VIP 티켓 1장. 점령자는 바뀌지 않고, 1분 뒤 원래 화면으로 돌아와요.' }),
      line,
      h('button', { class: 'btn gold', type: 'button', text: '5000코인으로 60초 장악', onclick: () => go('coins') }),
      h('button', { class: 'btn ghost', type: 'button', text: 'VIP 티켓 1장으로 60초 장악', onclick: () => go('ticket') }),
    );
  }

  function openAd(slotId) {
    const b = boardById(slotId);
    if (!b?.holder_id) { openBillboard(slotId); return; }
    const mine = b.holder_id === hooks.actorId();
    const url = /^https:\/\//.test(String(b.external_url || '')) ? b.external_url : '';
    const canvas = makeCanvas(1024, 576);
    paintBillboard(canvas, b);
    const card = hooks.slotCard?.(slotId);
    openSheet(mine ? '내 전광판' : '걸린 전광판', mine ? 'MINE' : 'AD', (host) => {
      host.append(
        card ? h('div', { class: 'place' }, h('div', { class: 'where' }, h('b', { text: card.title }), h('span', { text: card.line }))) : null,
        h('div', { class: 'screen' }, canvas),
        h('p', { class: 'note', text: `${b.holder_name || '익명'}님이 걸어 둔 화면입니다.` }),
        h('div', { class: 'holder' },
          h('div', { class: 'stat' }, h('small', { text: '택시 정차' }), h('b', { text: String(Math.floor(Number(b.views) || 0)) })),
          h('div', { class: 'stat' }, h('small', { text: '응원' }), h('b', { text: String(Math.floor(Number(b.cheers) || 0)) })),
          h('div', { class: 'stat' }, h('small', { text: '링크' }), h('b', { text: url ? '있음' : '없음' })),
        ),
        h('div', { class: 'row' },
          url ? h('button', { type: 'button', class: 'btn gold', text: '링크 열기', onclick: () => hooks.adClick?.(slotId, url) }) : null,
          card ? h('button', { type: 'button', class: 'btn ghost', text: '이 전광판 보기', onclick: () => { closeSheet(); hooks.focusShot?.(slotId); } }) : null,
          h('button', { type: 'button', class: 'btn primary', text: mine ? '문구 수정' : '이 자리 빼앗기', onclick: () => openBillboard(slotId) }),
        ),
        stickerBox(() => slotId),
      );
    }, true);
  }
  function openBillboard(slotId = 'MAIN_TOP') {
    hooks.refreshWorld?.();
    let slot = slotId;
    openSheet('📢 전광판 점령', 'LIVE AUCTION', (host) => {
      const canvas = makeCanvas(1024, 576);
      const seg = h('div', { class: 'seg' });
      const slotOption = (id) => {
        const b = boardById(id);
        const who = !b?.holder_id ? '비어 있음' : b.holder_id === hooks.actorId() ? '내 것' : (b.holder_name || '점령');
        return `${slotName(id)} · ${who}`;
      };
      const pick = h('select', { class: 'input slot-pick', 'aria-label': '전광판 자리' });
      let slotLock = 0;
      pick.addEventListener('change', () => {
        if (slotLock) return;
        choose(pick.value);
        sfx.click();
      });
      const stHolder = h('b'), stBid = h('b', { class: 'gold' }), stProt = h('b'), stScore = h('b', { class: 'gold' });
      const emojiIn = h('input', { class: 'input', maxLength: 4, 'aria-label': '이모지' });
      const emo = h('div', { class: 'emo' });
      const themes = h('div', { class: 'themes' });
      const inks = h('div', { class: 'swatches' });
      const inkIn = h('input', { type: 'color', 'aria-label': '글자색 직접 선택' });
      const lines = [0, 1, 2].map(i => h('input', { class: 'input', maxLength: [16, 20, 24][i], placeholder: ['메인 문구 (16자)', '둘째 줄 (20자)', '셋째 줄 (24자)'][i] }));
      const urlIn = h('input', { class: 'input', type: 'url', placeholder: 'https://threads.net/...' });
      const urlField = h('div', { class: 'field' }, h('label', null, '외부 링크', h('span', { text: 'https 주소만 저장됩니다. 전광판을 누르면 상세보기에서 열 수 있습니다' })), urlIn);
      const bidIn = h('input', { class: 'input tnum', type: 'number', min: '1', step: '10', 'aria-label': '입찰 코인' });
      const balance = h('div', { class: 'balance' });
      const go = h('button', { class: 'btn primary cta', type: 'button' });
      const state = { theme: 'cyber_navy', ink: '#ffffff', emoji: '🔥', capY: 72, gift: false };
      const toName = h('input', { class: 'input', maxLength: 12, placeholder: '받는 사람 이름', 'aria-label': '받는 사람' });
      const capIn = h('input', { type: 'range', class: 'range', min: '12', max: '88', value: '72', 'aria-label': '사진에서 글자 높이' });
      const capLabel = h('b', { class: 'tnum', text: '글자 아래쪽' });
      const capWord = (n) => n < 40 ? '글자 위쪽' : n > 60 ? '글자 아래쪽' : '글자 가운데';
      const capRow = h('div', { class: 'rangerow', hidden: true, style: { marginTop: '8px' } }, h('span', { text: '사진에서 글자 높이' }), capIn, capLabel);
      // Photo ad: only the current holder may submit; the crop is re-encoded here so EXIF never leaves the device.
      const pic = { img: null, w: 0, h: 0, zoom: 1, cx: 0.5, cy: 0.5, prev: makeCanvas(1280, 720) };
      const photoBox = h('div', { class: 'photo-card' });
      const photoFile = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true });
      const zoomIn = h('input', { type: 'range', min: '1', max: '4', step: '0.01', value: '1', 'aria-label': '사진 확대' });
      const agree = h('input', { type: 'checkbox' });
      const photoGo = h('button', { class: 'btn gold cta', type: 'button' });
      const holds = (b) => !!b?.holder_id && b.holder_id === hooks.actorId() && (!b.expires_at || new Date(b.expires_at).getTime() > Date.now());

      const data = () => ({
        slot_id: slot, emoji: chars(emojiIn.value || state.emoji, 4) || '🔥', bg_theme: state.theme, text_color: state.ink,
        line1: state.gift ? chars('To. ' + toName.value.trim(), 16) : chars(lines[0].value, 16), line2: chars(lines[1].value, 20), line3: chars(lines[2].value, 24),
        caption_y: state.capY,
        holder_name: hooks.nick(), holder_id: 'preview',
      });
      const drawCrop = (c) => {
        const g = c.getContext('2d'), W = c.width, H = c.height, iw = pic.w, ih = pic.h;
        const s = Math.max(W / iw, H / ih) * pic.zoom, sw = W / s, sh = H / s;
        pic.cx = Math.min(1 - sw / iw / 2, Math.max(sw / iw / 2, pic.cx));
        pic.cy = Math.min(1 - sh / ih / 2, Math.max(sh / ih / 2, pic.cy));
        g.fillStyle = '#000';
        g.fillRect(0, 0, W, H);
        g.drawImage(pic.img, pic.cx * iw - sw / 2, pic.cy * ih - sh / 2, sw, sh, 0, 0, W, H);
      };
      let raf = 0;
      const paint = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const b = boardById(slot);
          const mine = holds(b);
          let photo = null;
          if (mine && pic.img && b?.photo_status !== 'pending') { drawCrop(pic.prev); photo = pic.prev; }
          else if (b?.photo_status === 'approved' && b.photo_id) {
            photo = photoReady(b.photo_id);
            if (!photo) boardPhoto(b.photo_id).then((img) => { if (img && boardById(slot)?.photo_id === b.photo_id) paint(); });
          }
          const shown = state.gift || drafting || (mine && pic.img) ? data() : (b || data());
          paintBillboard(canvas, shown, { ticker: !state.gift && mine && !drafting ? `👑 ${hooks.nick()}님의 광고가 지금 타임스퀘어에 송출됩니다` : '', photo: state.gift || drafting ? null : photo, pending: !state.gift && !drafting && b?.photo_status === 'pending' });
          canvas.parentElement?.classList.toggle('cropping', mine && !!pic.img);
        });
      };
      let drafting = false;
      const fee = () => ({ S: 1000, B: 300, C: 100 })[tierOf(slot)];
      const refreshPhotoGo = () => {
        const need = fee(), have = wallet.confirmed + wallet.pending;
        photoGo.disabled = !pic.img || !agree.checked || have < need;
        photoGo.textContent = have < need ? `사진 요금 ${money(need)} 코인이 필요해요` : !agree.checked ? '아래 안내를 확인하고 체크해 주세요' : `📷 ${money(need)} 코인으로 사진 검수 신청`;
      };
      let photoKey = '';
      const renderPhoto = (force) => {
        const b = boardById(slot), mine = holds(b), st = mine ? b.photo_status || '' : '';
        capRow.hidden = !(mine && (pic.img || st === 'approved' || st === 'pending'));
        const key = [slot, mine, st, b?.photo_id || '', !!pic.img].join('|');
        if (!force && key === photoKey) return;
        photoKey = key;
        const head = h('div', { class: 'ph-head' }, h('b', { text: '📷 사진 광고' }), h('span', { class: 'ph-fee', text: `${tierOf(slot)}급 +${money(fee())} 코인` }));
        if (!mine) {
          photoBox.replaceChildren(head, h('p', { class: 'note', text: '전광판을 점령한 사람만 사진을 올릴 수 있어요. 운영자가 확인한 사진만 광장 전체에 송출되고, 확인 전에는 글자 전광판으로 보여요.' }));
          return;
        }
        if (st === 'pending') {
          photoBox.replaceChildren(head, h('div', { class: 'callout warn' }, '⏳ ', h('b', { text: '검수 중' }), ' — 운영자가 확인하면 바로 송출돼요. 거절되면 사진 요금은 전액 환불됩니다. 그동안은 글자 전광판으로 보여요.'));
          return;
        }
        const kids = [head];
        if (st === 'approved' && !pic.img) kids.push(h('div', { class: 'callout ok' }, '✅ ', h('b', { text: '사진 송출 중' }), ' — 새 사진으로 바꾸면 요금이 다시 들고, 검수 동안은 글자 전광판으로 보여요.'));
        kids.push(h('button', { class: 'btn ghost', type: 'button', text: pic.img ? '🖼️ 다른 사진 고르기' : st === 'approved' ? '🖼️ 사진 바꾸기' : '🖼️ 사진 고르기', onclick: () => photoFile.click() }));
        if (pic.img) {
          kids.push(
            h('div', { class: 'ph-zoom' }, h('span', { text: '확대' }), zoomIn),
            h('p', { class: 'note', text: '미리보기를 드래그해서 사진 위치를 맞추세요. 문구 세 줄은 높이 슬라이더로 옮기고, 점령할 때 함께 저장돼요.' }),
            h('label', { class: 'agree' }, agree, h('span', { text: '직접 찍었거나 사용 권리가 있는 사진이고, 다른 사람의 얼굴·연락처 같은 개인정보나 선정적·혐오 표현이 없어요.' })),
            photoGo);
          refreshPhotoGo();
        } else {
          kids.push(h('p', { class: 'note', text: 'JPG·PNG 사진을 16:9로 잘라 올려요. 위치 정보(EXIF)는 지워지고, 운영자 확인 후 송출돼요. 거절되면 사진 요금은 환불되고, 다른 사람이 전광판을 탈환하면 사진도 함께 내려가요.' }));
        }
        photoBox.replaceChildren(...kids);
      };
      photoFile.addEventListener('change', async () => {
        const f = photoFile.files?.[0];
        photoFile.value = '';
        if (!f) return;
        if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 20e6) { note('JPG·PNG·WEBP 사진만, 20MB 이하로 올려 주세요', 'err'); return; }
        const url = URL.createObjectURL(f);
        try {
          const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
          let src = img, w = img.naturalWidth, hh = img.naturalHeight;
          if (w < 320 || hh < 180) { note('사진이 너무 작아요. 가로 320px 이상인 사진을 골라 주세요', 'err'); return; }
          const m = Math.max(w, hh);
          if (m > 2560) {
            const c = makeCanvas(Math.round(w * 2560 / m), Math.round(hh * 2560 / m));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            src = c; w = c.width; hh = c.height;
          }
          Object.assign(pic, { img: src, w, h: hh, zoom: 1, cx: 0.5, cy: 0.5 });
          zoomIn.value = '1';
          agree.checked = false;
          renderPhoto(true);
          paint();
        } catch {
          note('이 사진은 열 수 없어요. JPG나 PNG로 올려 주세요', 'err');
        } finally {
          URL.revokeObjectURL(url);
        }
      });
      zoomIn.addEventListener('input', () => { pic.zoom = Number(zoomIn.value) || 1; paint(); });
      agree.addEventListener('change', refreshPhotoGo);
      let drag = null;
      canvas.addEventListener('pointerdown', (e) => {
        if (!pic.img || !holds(boardById(slot))) return;
        drag = { x: e.clientX, y: e.clientY };
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!drag || !pic.img) return;
        const r = canvas.getBoundingClientRect(), s = Math.max(1280 / pic.w, 720 / pic.h) * pic.zoom;
        pic.cx -= (e.clientX - drag.x) / r.width * (1280 / s / pic.w);
        pic.cy -= (e.clientY - drag.y) / r.height * (720 / s / pic.h);
        drag = { x: e.clientX, y: e.clientY };
        paint();
      });
      const endDrag = () => { drag = null; };
      canvas.addEventListener('pointerup', endDrag);
      canvas.addEventListener('pointercancel', endDrag);
      canvas.addEventListener('wheel', (e) => {
        if (!pic.img || !holds(boardById(slot))) return;
        e.preventDefault();
        pic.zoom = Math.min(4, Math.max(1, pic.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
        zoomIn.value = String(pic.zoom);
        paint();
      }, { passive: false });
      const encodePhoto = async () => {
        const [OW, OH] = tierOf(slot) === 'C' ? [800, 450] : [1280, 720];
        for (const scale of [1, 0.75]) {
          const c = makeCanvas(Math.round(OW * scale), Math.round(OH * scale));
          drawCrop(c);
          for (const q of [0.86, 0.78, 0.7, 0.62]) {
            const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', q));
            if (blob && blob.size <= 280000) return blob;
          }
        }
        return null;
      };
      photoGo.addEventListener('click', async () => {
        if (!pic.img || !agree.checked) return;
        photoGo.disabled = true;
        photoGo.textContent = '⏳ 사진 보내는 중…';
        try {
          const blob = await encodePhoto();
          if (!blob) throw new Error('사진을 300KB 아래로 줄이지 못했어요. 다른 사진으로 시도해 주세요');
          const photo = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
          await hooks.submitPhoto({ slot_id: slot, photo });
          pic.img = null;
          agree.checked = false;
          sfx.hit();
          note('📷 사진을 보냈어요! 운영자가 확인하면 전광판에 송출됩니다', 'ok');
        } catch (e) {
          note(e?.message || '사진을 보내지 못했어요', 'err');
        }
        renderPhoto(true);
        refreshPhotoGo();
        paint();
      });
      const refreshBid = () => {
        const b = boardById(slot) || { slot_id: slot };
        const min = minBid(b, world.billboards, hooks.actorId?.(), [lines[0].value, lines[1].value, lines[2].value].join('\n'));
        const bid = Math.floor(Number(bidIn.value) || 0);
        const have = wallet.confirmed + wallet.pending;
        const after = have - bid;
        balance.replaceChildren(h('span', null, '보유 ', h('b', { text: `${money(have)} 코인` })), h('span', null, '점령 후 ', h('b', { class: after < 0 ? 'neg' : '', text: `${after < 0 ? '-' : ''}${money(Math.abs(after))} 코인` })));
        const mine = b.holder_id && b.holder_id === hooks.actorId();
        const locked = protectedLeft(b) > 0 && !mine;
        const short = have < bid || have < min;
        go.disabled = locked || bid < min || short;
        go.textContent = locked ? `🔒 보호 중 · ${fmtLeft(protectedLeft(b))} 후 입찰 가능` : short ? '코인이 부족해요' : bid < min ? `최소 ${money(min)} 코인부터 입찰` : `💥 ${money(bid)} 코인으로 점령하기`;
      };
      const fillStats = () => {
        const b = boardById(slot);
        const on = !!b?.holder_id;
        const active = boardActive(b);
        const pl = active ? protectedLeft(b) : 0;
        stHolder.textContent = !on ? '비어 있음 · 첫 주인이 될 자리' : !active ? `만료된 이름 · ${b.holder_name || '익명'} · 지금 걸 수 있음` : (b.holder_id === hooks.actorId() ? `내 점령 · ${b.holder_name || '나'}` : `지금 주인 · ${b.holder_name || '익명'}`);
        stBid.textContent = active ? `${money(b.current_bid)} 코인` : `${money(minBid(b?.slot_id ? b : { slot_id: slot }, world.billboards, hooks.actorId?.()))} 코인부터`;
        stProt.textContent = !on ? '시작 가격으로 점령' : pl > 0 ? `보호 ${fmtLeft(pl)} · 탈환 불가` : active ? '보호 끝 · +50이면 탈환' : '만료 · 시작 가격';
        stProt.className = pl > 0 ? 'red' : '';
        stScore.textContent = `택시 ${Math.floor(Number(b?.views) || 0)}번 · 링크 ${Math.floor(Number(b?.clicks) || 0)}번`;
        for (const o of pick.options) {
          const text = slotOption(o.value);
          if (o.text !== text) o.text = text;
        }
      };
      const placeEl = h('div', { class: 'place' });
      const paintPlace = () => {
        const card = hooks.slotCard?.(slot) || { title: slotName(slot), line: '위치를 불러오는 중' };
        placeEl.replaceChildren(
          h('div', { class: 'where' }, h('b', { text: card.title }), h('span', { text: card.line })),
          h('div', { class: 'go' },
            h('button', { class: 'btn ghost', type: 'button', text: '이 전광판 보기', onclick: () => { closeSheet(); hooks.focusShot?.(slot); } }),
            card.x != null ? h('button', { class: 'btn ghost', type: 'button', text: '길안내', onclick: () => goWaypoint({ x: card.x, z: card.z }, card.title) }) : null,
          ),
        );
      };
      const choose = (id) => {
        slot = id;
        const b = boardById(id) || {};
        const alive = !!b.holder_id && (!b.expires_at || new Date(b.expires_at).getTime() > Date.now());
        state.theme = alive && THEMES[b.bg_theme] ? b.bg_theme : 'cyber_navy';
        state.ink = alive && isColor(b.text_color) ? b.text_color : '#ffffff';
        emojiIn.value = alive && b.emoji ? b.emoji : '🔥';
        for (const btn of emoRow.querySelectorAll('button')) btn.classList.toggle('on', btn.textContent === emojiIn.value);
        lines[0].value = alive ? (b.line1 || '') : '';
        lines[1].value = alive ? (b.line2 || '') : '';
        lines[2].value = alive ? (b.line3 || '') : '';
        pic.img = null;
        state.capY = Math.min(88, Math.max(12, Number(b.caption_y) || 72));
        capIn.value = String(state.capY);
        capLabel.textContent = capWord(state.capY);
        urlField.hidden = false;
        urlIn.value = alive ? (b.external_url || '') : '';
        drafting = false;
        bidIn.value = String(minBid(b.slot_id ? b : { slot_id: id }, world.billboards, hooks.actorId?.()));
        slotLock++;
        pick.value = id;
        slotLock--;
        for (const c of themes.children) c.classList.toggle('on', c.dataset.theme === state.theme);
        for (const c of inks.querySelectorAll('.swatch')) c.classList.toggle('on', c.dataset.ink === state.ink);
        inkIn.value = state.ink;
        fillStats();
        refreshBid();
        paintPlace();
        renderPhoto(true);
        if (holds(b) && b.photo_status === 'approved') boardPhoto(b.photo_id).then(paint);
        if (state.gift) setGift(true);
        else paint();
        syncStickers();
      };
      let syncStickers = () => {};
      let stickers;
      const towerIds = ['MAIN_UP', 'MAIN_TOP', 'MAIN_MID', 'MAIN_BOT', 'MAIN_LOW', 'SUB_1A', 'SUB_1B', 'SUB_2A', 'SUB_2B', 'SUB_3A', 'SUB_3B', 'SUB_4A', 'SUB_4B'];
      const hotIds = Array.from({ length: 30 }, (_, i) => 'STREET_' + (i + 1));
      const cheapIds = Array.from({ length: 18 }, (_, i) => 'PLOT_' + (i + 1));
      const tipsEl = h('div', { class: 'rows' });
      const pickNote = h('p', { class: 'note', text: '위에 보이는 이름은 이 전광판의 지금 주인입니다. 핸드폰과 컴퓨터가 다른 계정이면, 컴퓨터에서 점령한 이름이 여기 그대로 보입니다.' });
      const tips = () => {
        const me = hooks.actorId?.();
        const have = wallet.confirmed + wallet.pending;
        const scored = [];
        for (const id of [...towerIds, ...hotIds, ...cheapIds]) {
          const b = boardById(id);
          const left = protectedLeft(b);
          const min = minBid(b || { slot_id: id }, world.billboards, me);
          let score = 0;
          if (b?.holder_id && left > 0 && left <= 60000) score += 100;
          else if (b?.holder_id && !left) score += 70;
          if (min <= have) score += 30 + Math.min(40, floorOf(id) / 100);
          const bld = buildingOf(id);
          if (bld && me) {
            const owned = bld.slots.filter((s) => s === slot || boardById(s)?.holder_id === me).length;
            if (owned === bld.slots.length - 1 && boardById(id)?.holder_id !== me) score += 120;
          }
          if (score > 0) scored.push({ id, score });
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, 4).map((r) => r.id);
      };
      const showZone = (zone, focus) => {
        for (const b of seg.children) b.classList.toggle('on', b.dataset.tier === zone);
        const mineIds = myBoards().map((b) => b.slot_id);
        const ids = zone === 'pick' ? tips() : zone === 'tower' ? towerIds : zone === 'hot' ? hotIds : zone === 'cheap' ? cheapIds : mineIds;
        const list = ids.length ? ids.slice() : ['MAIN_TOP'];
        if (focus && !list.includes(focus)) list.unshift(focus);
        const next = focus && list.includes(focus) ? focus : list.includes(slot) ? slot : list[0];
        tipsEl.replaceChildren(...(zone === 'pick' ? list.map((id) => h('button', { class: 'chip', type: 'button', text: `🎯 ${slotOption(id)}`, onclick: () => choose(id) })) : []));
        pickNote.hidden = zone !== 'pick';
        slotLock++;
        pick.replaceChildren(...list.map((id) => h('option', { value: id, text: slotOption(id) })));
        choose(next);
        slotLock--;
      };
      for (const [t, label] of [['pick', '꿀자리'], ['tower', '메인/코너'], ['hot', '중심가'], ['cheap', '입문'], ['mine', '내 것']]) {
        const b = h('button', { type: 'button', text: label, onclick: () => showZone(t) });
        b.dataset.tier = t;
        seg.append(b);
      }
      const emoRow = h('div', { class: 'emo-row' });
      const pickEmoji = (g) => {
        emojiIn.value = g;
        state.emoji = g;
        for (const b of emoRow.querySelectorAll('button')) b.classList.toggle('on', b.textContent === g);
        drafting = true;
        paint();
      };
      emoRow.append(
        ...EMOJI_SETS[0][1].map((g) => h('button', { type: 'button', text: g, class: g === state.emoji ? 'on' : '', onclick: () => pickEmoji(g) })),
        emojiIn,
      );
      emo.append(emoRow);
      for (const [key, th] of Object.entries(THEMES)) {
        const b = h('button', { type: 'button', class: 'theme', text: th.label, style: { background: `linear-gradient(135deg, ${th.swatch[0]}, ${th.swatch[1]} 55%, ${th.swatch[2]})` }, onclick: () => { state.theme = key; drafting = true; for (const c of themes.children) c.classList.toggle('on', c === b); paint(); } });
        b.dataset.theme = key;
        b.hidden = !!th.gift;
        themes.append(b);
      }
      for (const c of INK) {
        const b = h('button', { type: 'button', class: 'swatch', 'aria-label': c, style: { background: c, color: c }, onclick: () => { state.ink = c; inkIn.value = c; drafting = true; for (const s of inks.querySelectorAll('.swatch')) s.classList.toggle('on', s === b); paint(); } });
        b.dataset.ink = c;
        inks.append(b);
      }
      inks.append(inkIn);
      inkIn.addEventListener('input', () => { state.ink = inkIn.value; drafting = true; for (const s of inks.querySelectorAll('.swatch')) s.classList.remove('on'); paint(); });
      const giftTags = ['#스레드 품앗이', '#유튜브 대박', '#오늘생일', '#로또명당'];
      const tagRow = h('div', { class: 'chips' }, ...giftTags.map((tag) => h('button', { type: 'button', text: tag, onclick: () => { lines[1].value = chars(`${lines[1].value} ${tag}`.trim(), 16); paint(); } })));
      const toField = h('div', { class: 'field', hidden: true }, h('label', null, '받는 사람'), toName);
      const setGift = (on) => {
        state.gift = on;
        wishBtn.classList.toggle('on', !on);
        giftBtn.classList.toggle('on', on);
        toField.hidden = !on;
        lines[0].hidden = on;
        for (const c of themes.children) c.hidden = on ? !THEMES[c.dataset.theme]?.gift : !!THEMES[c.dataset.theme]?.gift;
        const first = [...themes.children].find((c) => !c.hidden);
        if (first) first.click();
      };
      const wishBtn = h('button', { type: 'button', class: 'on', text: '내 소원 걸기', onclick: () => setGift(false) });
      const giftBtn = h('button', { type: 'button', text: '선물하기', onclick: () => setGift(true) });
      toName.addEventListener('input', () => { drafting = true; paint(); });
      for (const i of [emojiIn, ...lines]) i.addEventListener('input', () => { drafting = true; paint(); });
      capIn.addEventListener('input', () => { state.capY = Number(capIn.value); capLabel.textContent = capWord(state.capY); paint(); });
      bidIn.addEventListener('input', refreshBid);
      const steps = h('div', { class: 'steps' },
        ...[50, 100, 500].map(n => h('button', { type: 'button', text: `+${n}`, onclick: () => { bidIn.value = String((Math.floor(Number(bidIn.value)) || 0) + n); refreshBid(); } })),
        h('button', { type: 'button', text: '최소', onclick: () => { bidIn.value = String(minBid(boardById(slot) || { slot_id: slot }, world.billboards, hooks.actorId?.())); refreshBid(); } }));
      go.addEventListener('click', async () => {
        const b = boardById(slot) || { slot_id: slot };
        const bid = Math.floor(Number(bidIn.value) || 0);
        const have = wallet.confirmed + wallet.pending;
        if (state.gift && !toName.value.trim()) { note('받는 사람 이름을 적어 주세요', 'err'); return; }
        if (have < bid || bid < minBid(b, world.billboards, hooks.actorId?.(), [lines[0].value, lines[1].value, lines[2].value].join('\n'))) return;
        go.disabled = true;
        go.textContent = '⏳ 점령 중…';
        let link = urlIn.value.trim();
        if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
        if (link) {
          try { link = new URL(link).protocol === 'https:' ? new URL(link).toString() : ''; }
          catch { link = ''; }
        }
        if (urlIn.value.trim() && !link) {
          note('링크는 https 주소만 저장됩니다. 예: https://threads.net/이름', 'err');
          go.disabled = false;
          return;
        }
        try {
          const d = data();
          await hooks.claim({ slot_id: slot, bid, line1: d.line1, line2: d.line2, line3: d.line3, caption_y: d.caption_y, emoji: d.emoji, bg_theme: d.bg_theme, text_color: d.text_color, external_url: link });
        } catch (e) {
          note(e?.message || '점령에 실패했습니다', 'err');
          refreshBid();
          go.disabled = false;
          return;
        }
        const giftName = state.gift ? toName.value.trim() : '';
        closeSheet();
        sfx.jackpot();
        note(giftName ? `🎁 ${giftName}님 선물을 걸었습니다` : '🎉 전광판에 등록됐습니다', 'ok');
        hooks.focusShot?.(slot);
        hooks.giftPop?.(slot);
        showProof(slot, giftName);
        const nxt = nextChainFace(slot, world.billboards, hooks.actorId?.());
        if (nxt) {
          openSheet('연속 점령', 'CHAIN', (box) => {
            box.append(
              h('p', { text: nxt.left === 1
                ? `🔥 ${nxt.building}의 ${slotName(nxt.id)}까지 점령하면 이 빌딩 전체가 회원님의 독점 타워로 합체됩니다.`
                : `🔥 ${nxt.building}의 ${slotName(nxt.id)}를 이으면 독점에 한 칸 더 가까워집니다.` }),
              h('p', { class: 'note', text: `필요 코인 ${money(nxt.price)}부터` }),
              h('button', { class: 'btn primary', type: 'button', text: '⚡ 연속으로 점령하기', onclick: () => openBillboard(nxt.id) }),
            );
          }, true);
        }
      });
      const timer = setInterval(() => {
        fillStats();
        refreshBid();
        const key = photoKey;
        renderPhoto();
        if (photoKey !== key) paint();
        if (pic.img) refreshPhotoGo();
      }, 1000);
      host.append(h('div', { class: 'grid2 bb' },
        h('div', null,
          pickNote, tipsEl, seg, pick,
          h('div', { class: 'screen' }, canvas),
          h('div', { class: 'holder' },
            h('div', { class: 'stat' }, h('small', { text: '현재 점령자' }), stHolder),
            h('div', { class: 'stat' }, h('small', { text: '현재 입찰가' }), stBid),
            h('div', { class: 'stat' }, h('small', { text: '보호 시간' }), stProt)),
        ),
        h('div', null,
          h('div', { class: 'field' }, h('label', null, '내 광고 문구'), h('div', { class: 'lines' }, ...lines)),
          h('div', { class: 'field' }, h('label', null, '입찰 코인'), h('div', { class: 'bid' }, bidIn, steps), balance),
          go,
          (stickers = stickerBox(() => slot)),
          airBar(),
          h('details', { class: 'more' },
            h('summary', { text: '배경 · 글자색 · 링크' }),
            h('div', { class: 'field' }, h('label', null, '이모지'), emo),
            h('div', { class: 'field' }, h('label', null, '배경'), themes),
            h('div', { class: 'field' }, h('label', null, '글자색'), inks),
            urlField,
            photoBox, photoFile),
        ),
      ));
      showZone(slotId && slotId !== 'MAIN_TOP' ? (towerIds.includes(slotId) ? 'tower' : String(slotId).startsWith('STREET_') ? 'hot' : 'cheap') : 'pick', slotId);
      fontsReady('타임스퀘어 전광판 점령 ' + hooks.nick()).then(paint);
      return () => { clearInterval(timer); cancelAnimationFrame(raf); };
    });
  }

  function openPlot(plotId) {
    const id = Number(plotId);
    const slot = PLOT_SLOTS[id - 1];
    if (!slot) return;
    openSheet(`🏗️ ${id}번 토지`, `K-타운 · 32번가 ${slot.side === 'N' ? '북쪽' : '남쪽'}`, (host) => {
      const plot = plotById(id) || { plot_id: id, level: 0, price: 500, theme_color: '#00ffcc' };
      const level = Math.max(0, Math.min(4, Number(plot.level) || 0));
      const mine = !!plot.owner_id && plot.owner_id === hooks.actorId();
      const owned = !!plot.owner_id;
      const price = Number(plot.price) || 500;
      const target = !owned ? Math.max(1, level) : Math.min(4, level + 1);
      const levels = h('div', { class: 'levels' }, ...LEVELS.map((L, i) => h('div', { class: `lv${i < level ? ' done' : ''}${i === level ? ' cur' : ''}${i === target && (mine || !owned) && level < 4 ? ' next' : ''}` }, levelImg(L), h('div', { class: 't', text: L.t }))));
      const signIn = h('input', { class: 'input', maxLength: 14, placeholder: '간판 이름 (14자)', value: plot.sign_text && plot.sign_text !== '분양 대기중' ? plot.sign_text : `${hooks.nick()}네 가게` });
      let color = isColor(plot.theme_color) ? plot.theme_color : '#00ffcc';
      const prev = makeCanvas(512, 128);
      prev.className = 'signprev';
      const paint = () => paintNeonSign(prev, chars(signIn.value, 14) || '분양 중', color, `PLOT ${id} · ${hooks.nick()}`);
      const sw = h('div', { class: 'swatches' });
      const colorIn = h('input', { type: 'color', value: color, 'aria-label': '네온 컬러 직접 선택' });
      for (const c of NEON) {
        const b = h('button', { type: 'button', class: `swatch${c === color ? ' on' : ''}`, style: { background: c, color: c }, 'aria-label': c, onclick: () => { color = c; colorIn.value = c; for (const s of sw.querySelectorAll('.swatch')) s.classList.toggle('on', s === b); paint(); } });
        sw.append(b);
      }
      sw.append(colorIn);
      colorIn.addEventListener('input', () => { color = colorIn.value; for (const s of sw.querySelectorAll('.swatch')) s.classList.remove('on'); paint(); });
      signIn.addEventListener('input', paint);
      const label = level >= 4 && mine ? '🏙️ 최고층 타워 완성!' : mine ? `⬆️ ${LEVELS[target].t}로 증축 · ${money(price)} 코인` : owned ? `💰 인수 시도 · ${money(price)} 코인` : `🏗️ 분양받기 · ${money(price)} 코인`;
      const go = h('button', { class: 'btn gold cta', type: 'button', text: label, disabled: level >= 4 && mine });
      go.addEventListener('click', async () => {
        go.disabled = true;
        go.textContent = '⏳ 계약 중…';
        try {
          await hooks.buy({ plot_id: id, sign_text: chars(signIn.value, 14), theme_color: color });
          closeSheet();
          sfx.jackpot();
          note(mine ? '🏗️ 건물이 한 층 더 올라갔습니다!' : '🎉 이 땅의 주인이 되었습니다!', 'ok');
          hooks.focusShot?.('PLOT_' + id);
          showProof('PLOT_' + id);
        } catch (e) {
          note(e?.message || '분양에 실패했습니다', 'err');
          go.disabled = false;
          go.textContent = label;
        }
      });
      const board = boardById('PLOT_' + id);
      host.append(
        placeRow(slot),
        levels,
        h('div', { class: 'holder' },
          h('div', { class: 'stat' }, h('small', { text: '건물주' }), h('b', { text: owned ? `👑 ${plot.owner_name || '익명'}${linkedActor(plot.owner_id) ? ' ✓' : ''}${mine ? ' (나)' : ''}` : '주인 없음' })),
          h('div', { class: 'stat' }, h('small', { text: owned ? '다음 증축가' : '분양가' }), h('b', { class: 'gold', text: `${money(price)} 코인` })),
          h('div', { class: 'stat' }, h('small', { text: '외벽 전광판' }), h('b', { text: board?.holder_id ? `광고 중 · ${board.holder_name || ''}` : '광고 모집 중' }))),
        h('div', { class: 'callout' }, h('b', { text: '💸 건물주 패시브 수익' }), ' — 이 건물 외벽 전광판(', h('b', { text: `PLOT_${id}` }), ')에 다른 유저가 광고를 걸 때마다 입찰 코인의 ', h('b', { text: '50%' }), '가 내 지갑으로 자동 입금됩니다.'),
        h('div', { class: 'field' }, h('label', null, '네온 간판', h('span', { text: '광장에 실시간 반영' })), signIn, prev),
        h('div', { class: 'field' }, h('label', null, '네온 컬러'), sw),
        go,
        h('p', { class: 'note', text: '빈 땅이거나 건물주가 7일 동안 비운 건물만 인수할 수 있어요. 증축할수록 건물이 커지고 간판과 전광판이 더 높이 올라갑니다.' }),
      );
      paint();
      fontsReady(signIn.value).then(paint);
    }, true);
  }

  function openHub() {
    openSheet('💰 황금 ATM', 'EXCHANGE', (host) => {
      const plots = h('div', { class: 'plots' });
      const mineIds = new Set(myPlots().map(s => s.id));
      for (const s of PLOT_SLOTS) {
        const p = plotById(s.id);
        const lv = Math.max(0, Math.min(4, Number(p?.level) || 0));
        const col = isColor(p?.theme_color) && lv ? p.theme_color : null;
        const b = h('button', { type: 'button', class: `plot${mineIds.has(s.id) ? ' mine' : ''}`, title: p?.owner_name ? `${s.id}번 · ${p.owner_name}` : `${s.id}번 · 분양 중`, style: col ? { borderColor: col, boxShadow: `inset 0 0 18px -8px ${col}` } : null, onclick: () => openPlot(s.id) },
          h('img', { src: LEVELS[lv].src, alt: LEVELS[lv].t, draggable: 'false' }), h('span', { class: 'n', text: String(s.id) }));
        plots.append(b);
      }
      const lotCenter = { x: LAYOUT.ktown.x0 + (LAYOUT.ktown.n - 1) * LAYOUT.ktown.step / 2, z: LAYOUT.ktown.z };
      const mine = myPlots();
      const where = h('div', { class: 'place' },
        h('div', { class: 'where' },
          h('b', { text: '📍 토지는 K-타운 분양 구역에 있어요' }),
          h('span', { text: 'W 32nd St (코리아웨이) · 브로드웨이와 5번가 사이 · 타임스퀘어에서 남쪽으로 약 1km' })),
        h('div', { class: 'go' },
          h('button', { class: 'btn ghost', type: 'button', text: '📍 길안내', onclick: () => goWaypoint(lotCenter, 'K-타운 분양 구역') }),
          h('button', { class: 'btn gold', type: 'button', text: '⚡ 바로 가기', onclick: () => goTeleport(lotCenter, 'K-타운 분양 구역') })),
        mine.length ? h('div', { class: 'mine' }, h('small', { text: '내 건물' }), ...mine.map(s => h('button', { class: 'chip-btn', type: 'button', text: `🏙️ ${s.id}번 ⚡`, onclick: () => goTeleport(plotFront(s), `내 건물(${s.id}번)`) }))) : null);
      host.append(
        h('div', { class: 'holder' },
          h('div', { class: 'stat' }, h('small', { text: '내 지갑' }), h('b', { class: 'gold', text: `${money(wallet.confirmed + wallet.pending)} 코인` })),
          h('div', { class: 'stat' }, h('small', { text: '내 건물' }), h('b', { text: `${world.plots.filter(p => p.owner_id && p.owner_id === hooks.actorId()).length}채` })),
          h('div', { class: 'stat' }, h('small', { text: '내 전광판' }), h('b', { text: `${world.billboards.filter(b => b.holder_id && b.holder_id === hooks.actorId()).length}개` }))),
        h('div', { class: 'hub', style: { marginTop: '14px' } },
          h('button', { type: 'button', onclick: () => openBillboard('MAIN_TOP') }, h('img', { class: 'big', src: 'icons/board.jpg?v=4', alt: '', draggable: 'false' }), h('h4', { text: '전광판 점령' }), h('p', { text: 'S급 메인 타워부터 거리 전광판까지. 내 문구가 광장 모두의 화면에 송출돼요.' })),
          h('button', { type: 'button', onclick: () => openPlot(PLOT_SLOTS.find(s => !plotById(s.id)?.owner_id)?.id || 1) }, h('img', { class: 'big', src: LEVELS[4].src, alt: '', draggable: 'false' }), h('h4', { text: '토지 분양 · 증축' }), h('p', { text: '텐트에서 타워까지 5단계. 외벽 광고 수익의 50%는 건물주 몫!' }))),
        where,
        h('div', { class: 'field' }, h('label', null, 'K-타운 토지 현황', h('span', { text: '1~10 북쪽 · 11~20 남쪽 · 번호를 눌러 상세 보기' })), plots),
      );
    });
  }

  function openWalletInfo() {
    openSheet('💰 내 지갑', 'COINS', (host) => {
      const stat = (label, el) => h('div', { class: 'stat' }, h('small', { text: label }), el);
      const doneEl = h('b', { class: 'gold tnum' }), waitEl = h('b', { class: 'tnum' }), sumEl = h('b', { class: 'tnum' });
      const fill = () => {
        doneEl.textContent = `${money(wallet.confirmed)} 코인`;
        waitEl.textContent = `+${money(wallet.pending)} 코인`;
        sumEl.textContent = `${money(wallet.confirmed + wallet.pending)} 코인`;
      };
      fill();
      const timer = setInterval(fill, 1000);
      const now = Date.now();
      const buyers = world.billboards.filter((b) => {
        if (!b.holder_id || b.holder_id === hooks.actorId()) return false;
        const exp = b.expires_at ? new Date(b.expires_at).getTime() : 0;
        return !exp || exp > now;
      });
      const pick = h('select', { class: 'slot-pick', 'aria-label': '코인을 받을 사람' });
      for (const b of buyers) pick.append(h('option', { value: b.slot_id, text: `${b.holder_name || '익명'} · ${slotName(b.slot_id)}` }));
      const sellBox = buyers.length
        ? h('div', { class: 'field' }, h('label', null, '광고주에게 코인 보내기', h('span', { text: '정산된 코인 · 10 / 20 / 50' })),
          h('p', { class: 'note', text: '고른 전광판 주인의 지갑으로 내 코인이 그대로 넘어갑니다. 되돌려 받는 금액은 없어요.' }), pick,
          h('div', { class: 'steps', style: { marginTop: '8px' } }, ...[10, 20, 50].map((n) => {
            const btn = h('button', { class: 'btn gold', type: 'button', text: `${n}코인 보내기` });
            btn.addEventListener('click', async () => {
              btn.disabled = true;
              const res = await hooks.sell?.({ slot_id: pick.value, amount: n });
              btn.disabled = false;
              fill();
              if (res?.ok) note(`${res.buyer_name || '광고주'}에게 ${n}코인을 보냈어요`, 'ok');
              else note(res?.error || '아직 팔 수 없어요. 정산이 끝난 코인인지 확인해 주세요', 'err');
            });
            return btn;
          })))
        : h('p', { class: 'note', text: '지금 전광판을 가진 다른 사람이 없어요. 생기면 여기서 코인을 보낼 수 있어요.' });
      const info = hooks.walletInfo?.() || {};
      const refresh = h('button', { class: 'btn ghost cta', type: 'button', text: '🔄 잔액 새로고침' });
      refresh.addEventListener('click', async () => {
        refresh.disabled = true;
        await hooks.refreshWallet?.();
        fill();
        refresh.disabled = false;
        note('잔액을 새로 불러왔어요', 'ok');
      });
      host.append(
        h('div', { class: 'holder', style: { marginTop: 0 } }, stat('정산 완료', doneEl), stat('정산 대기', waitEl), stat('합계', sumEl)),
        h('div', { class: 'callout' }, h('b', { text: '코인은 점령에 쓰는 돈이에요' }), ' — 바닥 동전, 택시, 붕어빵, 댄스에서 모읍니다. 아래는 이미 전광판을 가진 사람에게 코인을 넘겨 주는 자리입니다.'),
        sellBox,
        h('div', { class: 'callout' }, h('b', { text: '정산은 자동이에요' }), ' — 동전·붕어빵·댄스·택시·별똥별 코인은 먼저 “정산 대기”에 쌓이고, 광장 서버가 약 30초마다 지갑에 입금해요.'),
        h('p', { class: 'note', text: '전광판 점령이나 토지 분양을 하면 그 순간 대기 코인부터 정산되므로, 대기 중인 코인도 바로 쓸 수 있어요. 화면 왼쪽 위 큰 숫자는 대기 코인까지 합친 금액이에요.' }),
        refresh,
      );
      return () => clearInterval(timer);
    }, true);
  }

  function standings() {
    return (world.ranks || [])
      .map((r) => ({ id: r.actor_id, name: r.nickname || '익명', score: Number(r.spent) || 0, linked: linkedActor(r.actor_id, r.linked) }))
      .filter((r) => r.id && r.score > 0)
      .sort((a, b) => b.score - a.score);
  }
  function openFeed() {
    const items = [...feedRows.querySelectorAll('.f')];
    openSheet('📢 광장 소식', null, (host) => {
      host.append(items.length
        ? h('div', { class: 'ranks board' }, ...items.map((n) => h('div', { class: 'rank' }, h('b', { text: n.textContent }))))
        : h('p', { class: 'note', text: '아직 소식이 없어요.' }));
    }, true);
  }
  function paintLive() {
    const rows = standings().slice(0, 5);
    const me = hooks.actorId?.();
    rankRows.replaceChildren(...(rows.length ? rows.map((r, i) => h('button', { type: 'button', class: 'rank' + (r.id === me ? ' me' : ''), onclick: () => openRanks() },
      h('span', { class: 'n', text: String(i + 1) }),
      h('b', { text: r.name }),
      r.linked ? h('i', { class: 'verified', title: '인증 계정', text: '✓' }) : null,
      h('span', { class: 'pts tnum', text: money(r.score) }))) : [h('p', { class: 'empty', text: '아직 점령한 사람이 없어요' })]));
  }
  let rankRefresh = null;
  const TAG_RE = /#[0-9A-Za-z가-힣_]{1,16}/g;
  function liveBoards() {
    const now = Date.now();
    return world.billboards.filter((b) => b.holder_id && (!b.expires_at || new Date(b.expires_at).getTime() > now));
  }
  function hotBoards() {
    return liveBoards()
      .map((b) => ({ ...b, heat: (Number(b.views) || 0) + (Number(b.cheers) || 0) }))
      .sort((a, b) => b.heat - a.heat);
  }
  function teamBoards() {
    const map = new Map();
    for (const b of hotBoards()) {
      const tags = new Set([b.line1, b.line2, b.line3, b.holder_name].join(' ').match(TAG_RE) || []);
      for (const tag of tags) {
        const row = map.get(tag) || { tag, heat: 0, n: 0, slot: b.slot_id };
        row.heat += b.heat;
        row.n += 1;
        if (b.heat >= (map.get(tag)?.best || 0)) { row.slot = b.slot_id; row.best = b.heat; }
        map.set(tag, row);
      }
    }
    return [...map.values()].sort((a, b) => b.heat - a.heat).slice(0, 5);
  }
  function openRanks() {
    openSheet('🏆 소원 랭킹', 'NOW', (host) => {
      const list = h('div', { class: 'ranks' });
      const note = h('p', { class: 'note' });
      let tab = 'spent';
      const go = (slot) => { closeSheet(); hooks.focusShot?.(slot); };
      const linkBtn = (b) => {
        const url = /^https:\/\//.test(String(b.external_url || '')) ? b.external_url : '';
        return url ? h('button', { type: 'button', class: 'mini', text: '채널 방문', onclick: () => hooks.adClick?.(b.slot_id, url) }) : null;
      };
      const paint = () => {
        hooks.syncCrown?.();
        if (tab === 'spent') {
          const rows = standings().slice(0, 20);
          list.replaceChildren(...(rows.length ? rows.map((r, i) => h('div', { class: 'rank' + (r.id === hooks.actorId?.() ? ' me' : '') },
            h('span', { class: 'n', text: String(i + 1) }),
            h('b', { text: r.name }),
            r.linked ? h('i', { class: 'verified', title: '인증 계정', text: '✓' }) : null,
            h('span', { class: 'pts tnum', text: money(r.score) }))) : [h('p', { class: 'note', text: '아직 전광판에 넣은 금액이 없어요.' })]));
          note.textContent = '점령에 낸 코인입니다. 만료되거나 빼앗겨도 빠지지 않습니다.';
          return;
        }
        if (tab === 'team') {
          const rows = teamBoards();
          list.replaceChildren(...(rows.length ? rows.map((r, i) => h('div', { class: 'rank' },
            h('span', { class: 'n', text: String(i + 1) }),
            h('b', { text: `${r.tag} · ${r.n}곳` }),
            h('span', { class: 'pts tnum', text: String(r.heat) }),
            h('button', { type: 'button', class: 'mini', text: '보러가기', onclick: () => go(r.slot) }))) : [h('p', { class: 'note', text: '아직 해시태그가 없어요. 문구에 #스레드 처럼 넣어 보세요.' })]));
          note.textContent = rows[0] ? `1위 소속 ${rows[0].tag}이 메인 타워 지붕에 올라갑니다.` : '같은 태그의 응원과 택시 정차를 더합니다.';
          return;
        }
        const rows = hotBoards().slice(0, 10);
        list.replaceChildren(...(rows.length ? rows.map((b, i) => h('div', { class: 'rank' },
          h('span', { class: 'n', text: String(i + 1) }),
          h('b', { text: [b.line1, b.line2, b.line3].map((s) => String(s || '').trim()).filter(Boolean).join(' · ') || b.holder_name || b.slot_id }),
          h('span', { class: 'pts tnum', text: String(b.heat) }),
          h('button', { type: 'button', class: 'mini', text: '보러가기', onclick: () => go(b.slot_id) }),
          linkBtn(b))) : [h('p', { class: 'note', text: '아직 걸린 소원이 없어요.' })]));
        note.textContent = '응원 수와 택시가 선 횟수를 더합니다. 1위 전광판 위로 황금 빛기둥이 섭니다. 채널 방문은 +15 코인입니다.';
      };
      const tabBtn = (id, text) => h('button', { type: 'button', class: id === 'spent' ? 'on' : '', text, onclick: (e) => { tab = id; for (const c of e.currentTarget.parentElement.children) c.classList.toggle('on', c === e.currentTarget); paint(); } });
      rankRefresh = paint;
      paint();
      host.append(h('div', { class: 'seg' }, tabBtn('spent', '누적 점령'), tabBtn('hot', '실시간 인기 소원'), tabBtn('team', '소속 총공 순위')), list, note);
      return () => { rankRefresh = null; };
    }, false, 'steady');
  }
  function openCredits() {
    openSheet('ⓘ 정보 · 출처', null, (host) => {
      const list = h('div', { class: 'credits' });
      host.append(
        h('div', { class: 'callout', style: { marginTop: 0 } }, h('b', { text: '조작법' }), ' — WASD/방향키: 카메라 기준 이동 · 마우스 드래그: 시점 회전 · 휠: 줌 · Shift: 걷기 · Space: 점프 · E: 상호작용 · 1~4: 감정 표현'),
        h('div', { class: 'field' }, h('label', null, '뉴욕 지도 데이터'),
          h('div', { class: 'credits' },
            h('div', { class: 'c' }, h('b', { text: '맨해튼 건물 · 도로 · 공원 · 해안선' }), ' — © ',
              h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener', text: 'OpenStreetMap contributors' }), ' · ODbL'))),
        h('div', { class: 'field' }, h('label', null, '실사 사진 (Wikimedia Commons)'), list),
        h('div', { class: 'field' }, h('label', null, '3D 에셋'),
          h('div', { class: 'credits' },
            h('div', { class: 'c' }, h('b', { text: 'Mousey' }), ' — Adobe Mixamo'),
            h('div', { class: 'c' }, h('b', { text: '고양이 · 곰' }), ' — 이 게임에서 만든 모델. 걷고 뛰는 동작은 Mousey(Adobe Mixamo)'),
            h('div', { class: 'c' }, h('b', { text: 'Asphalt 01 · Large Grey Tiles · Concrete Pavement' }), ' — Poly Haven · CC0'),
            h('div', { class: 'c' }, h('b', { text: 'three.js' }), ' — MIT License'))),
      );
      fetch('/assets/times-square/credits.json').then(r => r.json()).then((rows) => {
        for (const c of rows) {
          list.append(h('div', { class: 'c' },
            h('b', { text: c.title.replace(/\.(jpe?g|png)$/i, '') }), ` — ${c.author || 'Unknown'} · `,
            h('a', { href: c.license_url || c.source, target: '_blank', rel: 'noopener', text: c.license || 'license' }), ' · ',
            h('a', { href: c.source, target: '_blank', rel: 'noopener', text: '원본' })));
        }
      }).catch(() => list.append(h('div', { class: 'c', text: '출처 목록을 불러오지 못했습니다.' })));
    }, true);
  }

  function speciesPicker(current, onPick) {
    const wrap = h('div', { class: 'species' });
    for (const s of SPECIES) {
      const b = h('button', { type: 'button', class: s.id === current ? 'on' : '', text: `${s.glyph} ${s.label}`, onclick: () => { for (const other of wrap.children) other.classList.toggle('on', other === b); onPick(s.id); } });
      wrap.append(b);
    }
    return wrap;
  }

  function colorPicker(current, onPick) {
    const wrap = h('div', { class: 'colors' });
    for (const c of AVATAR_COLORS) {
      const b = h('button', { type: 'button', class: `swatch${c === current ? ' on' : ''}`, style: { background: c, color: c, width: '38px', height: '38px' }, 'aria-label': c, onclick: () => { for (const s of wrap.children) s.classList.toggle('on', s === b); onPick(c); } });
      wrap.append(b);
    }
    return wrap;
  }

  function openProfile() {
    openSheet('🤖 내 캐릭터', null, (host) => {
      const input = h('input', { class: 'input', maxLength: 16, value: hooks.nick(), placeholder: '닉네임 (16자)' });
      let color = hooks.color();
      let species = hooks.species();
      const save = h('button', { class: 'btn gold cta', type: 'button', text: '저장하기', onclick: () => {
        hooks.rename(chars(input.value, 16).trim() || hooks.nick());
        hooks.recolor(color);
        hooks.reshape(species);
        renderProfile();
        closeSheet();
        note('프로필을 저장했어요', 'ok');
      } });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
      const fields = [
        h('div', { class: 'field' }, h('label', null, '닉네임'), input),
        h('div', { class: 'field' }, h('label', null, '발밑 링 색', h('span', { text: '캐릭터 색이 아니라, 발밑 동그라미입니다' })), colorPicker(color, (c) => { color = c; })),
      ];
      if (SPECIES.length > 1) fields.splice(1, 0, h('div', { class: 'field' }, h('label', null, '캐릭터'), speciesPicker(species, (id) => { species = id; })));
      host.append(...fields, save);
      setTimeout(() => { if (!coarse) input.focus(); }, 50);
    }, true);
  }

  // ---------------------------------------------------------------- boot / onboarding
  function policyLinks() {
    return h('p', { class: 'note legal' },
      h('a', { href: './?policy=terms', target: '_blank', rel: 'noopener', text: '[이용약관]' }),
      ' | ',
      h('a', { href: './?policy=privacy', target: '_blank', rel: 'noopener', text: '[개인정보처리방침]' }),
    );
  }
  const prompted = new Set();
  function openLinkPrompt() {
    openSheet('계정 연결', '+300', (host) => {
      host.append(
        h('div', { class: 'callout warn', style: { marginTop: 0 } }, '창을 닫기 전에 계정을 연결하면 전광판과 수익이 남아요. 연결하면 +300코인.'),
        h('button', { class: 'btn gold cta', type: 'button', text: '계정 연결 +300', onclick: () => openLogin() }),
        h('button', { class: 'btn ghost', type: 'button', text: '나중에', onclick: () => closeSheet() }),
      );
    }, true);
  }
  function promptLink(reason) {
    if (!accountView.ready || !accountView.guest || accountView.linked) return;
    if (prompted.has(reason)) return;
    if (reason === 'coins' && (!entered || (wallet.confirmed + wallet.pending) < 100)) return;
    prompted.add(reason);
    if (reason === 'vip') return;
    setTimeout(() => { if (accountView.guest && !accountView.linked) openLinkPrompt(); }, reason === 'coins' ? 1200 : 0);
  }
  function linkCallout() {
    if (!accountView.ready || !accountView.guest || accountView.linked) return null;
    return h('div', { class: 'callout warn' },
      h('b', { text: '계정을 연결하면 전광판과 수익이 남아요. ' }),
      '창을 닫기 전에 연결하세요. 연결하면 +300코인. ',
      h('button', { class: 'btn gold', type: 'button', text: '계정 연결', onclick: () => openLogin() }),
    );
  }
  function openLogin() {
    const env = hooks.authEnv?.() || {};
    openSheet('계정 연결', '+300', (host) => {
      let mode = 'in';
      const id = h('input', { class: 'input', maxLength: 80, placeholder: '이메일 또는 아이디', autocomplete: 'username', 'aria-label': '이메일 또는 아이디' });
      const pw = h('input', { class: 'input', type: 'password', maxLength: 72, placeholder: '비밀번호 (6자 이상)', autocomplete: 'current-password', 'aria-label': '비밀번호' });
      const agree = h('input', { type: 'checkbox', 'aria-label': '만 14세 이상이며 약관과 개인정보처리방침에 동의' });
      const agreeRow = h('label', { class: 'agree' }, agree, '만 14세 이상이며 ', h('a', { href: './?policy=terms', target: '_blank', rel: 'noopener', text: '[이용약관]' }), '과 ', h('a', { href: './?policy=privacy', target: '_blank', rel: 'noopener', text: '[개인정보처리방침]' }), '에 동의합니다.');
      const submit = h('button', { class: 'btn gold cta', type: 'button', text: '로그인' });
      const swap = h('button', { class: 'btn ghost', type: 'button', text: '처음이면 가입' });
      const sync = () => {
        const up = mode === 'up';
        submit.textContent = up ? '가입하고 연결' : '로그인';
        swap.textContent = up ? '이미 계정이 있어요' : '처음이면 가입';
        agreeRow.hidden = !up;
        submit.disabled = up && !agree.checked;
        id.autocomplete = up ? 'username' : 'username';
        pw.autocomplete = up ? 'new-password' : 'current-password';
      };
      agree.addEventListener('change', sync);
      swap.addEventListener('click', () => { mode = mode === 'up' ? 'in' : 'up'; sync(); });
      submit.addEventListener('click', async () => {
        if (mode === 'up' && !agree.checked) { note('만 14세 이상이고 약관과 개인정보처리방침에 동의해야 가입할 수 있어요', 'err'); return; }
        submit.disabled = true;
        try {
          await hooks.passwordAuth?.(mode, id.value, pw.value);
          closeSheet();
        } catch (e) {
          note(e?.message || '로그인에 실패했어요', 'err');
          sync();
        }
      });
      const google = h('button', { class: 'btn', type: 'button', text: 'Google로 계속' });
      google.addEventListener('click', async () => {
        if (env.inApp && env.android && env.intent) { location.href = env.intent; return; }
        if (env.inApp) { note('이 앱 안에서는 구글 로그인이 열리지 않아요. 아래에서 이메일로 가입하거나, 사파리 링크를 복사하세요.', 'err'); return; }
        try { await hooks.oauth?.('google'); }
        catch (e) { note(e?.message || '구글 로그인을 열지 못했어요', 'err'); }
      });
      const kids = [
        h('p', { class: 'note', text: '연결하면 전광판과 코인이 남아요. 보상은 계정마다 한 번 +300.' }),
        google,
      ];
      if (env.inApp) kids.push(h('p', { class: 'note', text: env.android ? '이 앱 안에서는 구글 로그인을 열지 않고, 크롬으로 넘어갑니다.' : '이 앱 안에서는 구글 로그인을 열지 않아요. 이메일로 가입하거나 사파리 링크를 여세요.' }), copy);
      kids.push(id, pw, agreeRow, submit, swap, policyLinks());
      host.append(...kids);
    }, true);
  }
  const bootEl = document.getElementById('boot');
  const bootBar = document.getElementById('bootBar');
  const bootMsg = document.getElementById('bootMsg');
  const bootEnter = document.getElementById('bootEnter');
  const tips = ['타임스퀘어 전광판에 불을 켜는 중…', '오늘의 명당을 고르는 중…', '남의 소원을 읽는 중…', '빼앗길 자리를 비추는 중…', '이름을 전광판에 올리는 중…'];
  let tipI = 0;
  const tipTimer = setInterval(() => { if (bootMsg) bootMsg.textContent = tips[++tipI % tips.length]; }, 1600);
  let entered = false;
  function bootReady() {
    if (!bootEl || entered || bootEnter?.dataset.ready) return;
    clearInterval(tipTimer);
    if (bootEnter) bootEnter.dataset.ready = '1';
    if (bootBar) bootBar.style.width = '100%';
    if (bootMsg) bootMsg.hidden = true;
    if (bootBar?.parentElement) bootBar.parentElement.hidden = true;
    let color = hooks.color();
    let species = hooks.species();
    const known = hooks.hasSession?.();
    const nick = h('input', { class: 'input', maxLength: 16, value: hooks.nick(), placeholder: '닉네임', 'aria-label': '닉네임' });
    const go = h('button', { class: 'btn enter-go pulse', type: 'button', text: '입장하기' });
    const enter = () => {
      if (entered) return;
      entered = true;
      trackEvent('enter_square', { load_ms: Math.round(performance.now()) });
      ac();
      sfx.engine();
      cityStart();
      askFullscreen();
      hooks.enter({ nick: chars(known ? hooks.nick() : nick.value, 16).trim() || hooks.nick(), color, species });
      renderProfile();
      hooks.arrive?.();
      attend();
      bootEl.classList.add('gone');
      setTimeout(() => bootEl.remove(), 900);
      maybeStarterToast();
    };
    go.addEventListener('click', enter);
    nick.addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });
    const bootFields = known ? [go] : [nick, go];
    bootEnter.replaceChildren(...bootFields);
    bootEnter.hidden = false;
    if (!coarse) setTimeout(() => go.focus(), 60);
  }
  setTimeout(bootReady, 2500);
  if (!window.__ktsLand && !new URLSearchParams(location.search).get('policy')) {
    window.__ktsLand = 1;
    trackEvent('page_landing');
  }

  function wrapPaper(g, text, x, y, maxW, lineH) {
    const glyphs = Array.from(text);
    let line = '', yy = y;
    for (const ch of glyphs) {
      const trial = line + ch;
      if (g.measureText(trial).width > maxW && line) { g.fillText(line, x, yy); line = ch; yy += lineH; }
      else line = trial;
    }
    if (line) g.fillText(line, x, yy);
  }
  async function downloadPaper() {
    const slot = proof.dataset.slot || 'MAIN_TOP';
    const nick = hooks.nick?.() || '손님';
    const c = document.createElement('canvas');
    c.width = 1080;
    c.height = 1350;
    c.hidden = true;
    const g = c.getContext('2d');
    g.fillStyle = '#f3ecdf';
    g.fillRect(0, 0, 1080, 1350);
    g.fillStyle = '#1a1208';
    g.fillRect(0, 0, 1080, 150);
    g.fillStyle = '#fff8e8';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 28px sans-serif';
    g.fillText('THE NEW YORK WISH TIMES - BREAKING NEWS', 540, 62);
    g.font = '700 22px sans-serif';
    g.fillText('TIMES SQUARE  ·  WISH BOARD', 540, 112);
    const board = boardById(slot) || { slot_id: slot, emoji: '🔥', bg_theme: 'gold_luxury', text_color: '#fff6d0', line1: nick, holder_name: nick, holder_id: 'preview' };
    const art = makeCanvas(960, 540);
    paintBillboard(art, board);
    g.drawImage(art, 60, 190, 960, 420);
    try {
      const blob = await hooks.capture?.();
      if (blob) {
        const bmp = await createImageBitmap(blob);
        g.drawImage(bmp, 60, 630, 960, 300);
        bmp.close?.();
      }
    } catch { /* the plaza view can be busy; the masthead and board still save */ }
    g.fillStyle = '#1a1208';
    g.textAlign = 'center';
    g.font = '900 36px sans-serif';
    wrapPaper(g, `속보: ${nick}, 뉴욕 타임스퀘어 명당 전광판 전격 점령!`, 540, 980, 960, 46);
    g.font = '700 24px sans-serif';
    g.fillText('지금 게임을 열고 타임스퀘어에서 이 전광판을 확인하세요', 540, 1220);
    g.font = '600 20px sans-serif';
    g.fillText('https://studio.wishboard.workers.dev', 540, 1280);
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = 'new-york-wish-times.png';
    a.click();
    note('신문을 저장했어요', 'ok');
  }
  const proofText = h('p');
  const proof = h('div', { class: 'glass proof', hidden: true },
    proofText,
    h('button', { class: 'btn gold', type: 'button', text: '🔗 초대 문구 복사하기', onclick: async () => {
      const slot = proof.dataset.slot || 'MAIN_TOP';
      const who = proof.dataset.gift || '';
      const link = `https://studio.wishboard.workers.dev/?focus=${slot}${who ? '&gift=1' : ''}`;
      const line = who
        ? `🎁 ${who}님! ${hooks.nick?.() || '친구'}님이 뉴욕 타임스퀘어 전광판에 당신만을 위한 깜짝 메시지를 걸었습니다! 지금 바로 링크를 눌러 타임스퀘어 한복판을 확인해 보세요 👉 ${link}`
        : `뉴욕 타임스퀘어 전광판에 내 광고 걸었습니다! 링크 누르면 내 전광판 앞으로 바로 이동합니다 👉 ${link}`;
      try { await navigator.clipboard.writeText(line); note('초대 문구를 복사했어요', 'ok'); }
      catch { note(line, 'err'); }
    } }),
    h('button', { class: 'btn ghost', type: 'button', text: '사진 찍어 공유', onclick: async () => {
      const d = today();
      const slot = proof.dataset.slot;
      proof.hidden = true;
      root.classList.remove('proofing');
      if (slot) hooks.frameBillboard?.(slot);
      try { await openShot(); } finally { hooks.endFocus?.(); }
      if (!d.paid?.shot) {
        d.paid = d.paid || {};
        d.paid.shot = 1;
        saveDay(d);
        if (hooks.mine?.(BALANCE.shareShot, 'me')) note(`공유 +${BALANCE.shareShot}`, 'ok');
      }
    } }),
    h('button', { class: 'btn ghost', type: 'button', text: '📰 신문으로 저장', onclick: () => downloadPaper() }),
    h('button', { class: 'btn ghost', type: 'button', text: '둘러보기', onclick: () => endProof() }),
  );
  root.append(proof);
  function endProof() {
    proof.hidden = true;
    root.classList.remove('proofing');
    hooks.lockInput?.(false);
    hooks.endFocus?.();
  }
  function showProof(slot, giftName = '') {
    proof.dataset.slot = slot;
    proof.dataset.gift = giftName || '';
    proofText.textContent = giftName
      ? `등록됐습니다. ${giftName}님 선물 문구를 복사해 보내세요.`
      : '등록됐습니다. 지금 전광판 앞에서 폭죽이 터집니다.';
    root.classList.add('proofing');
    proof.hidden = false;
    hooks.lockInput?.(true);
  }
  function openVip() {
    trackEvent('vip_modal_open');
    promptLink('vip');
    openSheet('👑 VIP 패스트트랙', 'SPONSOR', (host) => {
      const code = h('input', { class: 'input', maxLength: 32, placeholder: '8자리 스폰서 코드', 'aria-label': '스폰서 코드' });
      const share = h('button', { class: 'btn gold', type: 'button', text: '링크 복사하고 +300' });
      share.addEventListener('click', async () => {
        const line = '뉴욕 타임스퀘어 전광판에 내 자리를 걸었어요. 같이 보러 와요 👉 https://studio.wishboard.workers.dev/';
        try { await navigator.clipboard.writeText(line); } catch { note(line, 'err'); }
        share.disabled = true;
        try {
          const r = await hooks.shareBonus?.();
          note(r?.coins != null ? `공유 보너스 +300 · 잔액 ${r.coins}` : '공유 보너스를 넣었어요', 'ok');
        } catch (e) { note(e?.message || '오늘은 이미 받았거나, 아직 입장 전이에요', 'err'); share.disabled = false; }
      });
      const redeem = h('button', { class: 'btn gold', type: 'button', text: '코드 사용' });
      redeem.addEventListener('click', async () => {
        redeem.disabled = true;
        try {
          const r = await hooks.redeemCode?.(code.value);
          note(`+10000 코인 충전 · 잔액 ${r?.coins ?? ''}`, 'ok');
          closeSheet();
        } catch (e) { note(e?.message || '코드가 맞지 않아요', 'err'); redeem.disabled = false; }
      });
      const ask = h('button', { class: 'btn ghost', type: 'button', text: '스폰서 안내 열기' });
      ask.addEventListener('click', async () => {
        const url = await hooks.sponsorUrl?.();
        if (!url) { note('스폰서 안내 주소가 아직 없어요. 운영자에게 문의해 주세요', 'err'); return; }
        window.open(url, '_blank', 'noopener');
      });
      const vipLink = linkCallout();
      host.append(
        h('div', { class: 'hub' },
          vipLink,
          h('div', { class: 'vipcard' }, h('h4', { text: '🎁 친구에게 링크 공유하고 +300' }), h('p', { text: '하루 한 번. 홍보 문구와 사이트 링크가 복사되고, 코인이 바로 들어옵니다.' }), share),
          h('div', { class: 'vipcard' }, h('h4', { text: '🔑 VIP 스폰서 코드' }), h('p', { text: '코드가 맞으면 10,000코인이 충전됩니다. 메인 타워는 3,000부터 점령할 수 있어요.' }), code, redeem),
          h('div', { class: 'vipcard' }, h('h4', { text: '💼 스폰서 안내' }), h('p', { text: '현금 결제는 없어요. 안내 페이지만 엽니다.' }), ask),
          airBar(),
          h('p', { class: 'note', text: '현금 결제는 없어요. 코인과 초대 코드만 씁니다.' }),
        ),
      );
    });
  }

  // ---------------------------------------------------------------- city map (minimap + full map)
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  const KO_STREETS = {
    Broadway: '브로드웨이', 'Park Avenue': '파크 애비뉴', 'Park Avenue South': '파크 애비뉴', 'Madison Avenue': '매디슨 애비뉴', 'Lexington Avenue': '렉싱턴 애비뉴',
    'Avenue of the Americas': '6번가', 'Central Park West': '센트럴파크 웨스트', 'Central Park South': '센트럴파크 사우스', 'FDR Drive': 'FDR 드라이브',
    'Franklin D. Roosevelt East River Drive': 'FDR 드라이브', 'West Side Highway': '웨스트사이드 하이웨이', 'Joe DiMaggio Highway': '웨스트사이드 하이웨이',
    'Wall Street': '월스트리트', 'Canal Street': '커낼 스트리트', 'Houston Street': '휴스턴 스트리트', 'East Houston Street': '휴스턴 스트리트',
    'West Houston Street': '휴스턴 스트리트', Bowery: '바워리', 'Riverside Drive': '리버사이드 드라이브', 'Amsterdam Avenue': '암스테르담 애비뉴',
    'Columbus Avenue': '콜럼버스 애비뉴', 'West End Avenue': '웨스트엔드 애비뉴', 'Delancey Street': '딜런시 스트리트', 'Fifth Avenue': '5번가',
    'Seventh Avenue': '7번가', 'Eighth Avenue': '8번가', 'Malcolm X Boulevard': '레녹스 애비뉴', 'Lenox Avenue': '레녹스 애비뉴',
    'Frederick Douglass Boulevard': '8번가', 'Adam Clayton Powell Jr. Boulevard': '7번가', 'Harlem River Drive': '할렘리버 드라이브',
    'Henry Hudson Parkway': '헨리허드슨 파크웨이', 'Columbus Circle': '콜럼버스 서클', 'Times Square': '타임스퀘어',
  };
  const shortEn = (s) => s.replace(/\bStreet\b/, 'St').replace(/\bAvenue\b/, 'Ave').replace(/\bBoulevard\b/, 'Blvd').replace(/\bDrive\b/, 'Dr').replace(/\bPlace\b/, 'Pl').replace(/^West /, 'W ').replace(/^East /, 'E ');
  function streetLabel(name, short = false) {
    if (!name) return '';
    const m = name.match(/^(?:(West|East)\s+)?(\d+)(st|nd|rd|th)\s+(Street|Avenue)$/i);
    const ko = m ? `${m[2]}번가` : KO_STREETS[name];
    if (!ko) return shortEn(name);
    return short ? ko : `${ko} · ${shortEn(name)}`;
  }
  let paths = null;
  /** Cached Path2D layers in world meters: islands, far shores, and lazily built per-tile parks/roads/buildings. */
  function cityPaths(nyc) {
    if (paths?.nyc === nyc) return paths;
    const C = nyc.coast, A = nyc.areas;
    const land = new Path2D(), shore = new Path2D();
    let mx = 0, mz = 0, mn = 0;
    for (let c = 0; c < C.count; c++) if (C.closed[c]) for (let p = C.off[c]; p < C.off[c + 1]; p += 25) { mx += C.xs[p]; mz += C.zs[p]; mn++; }
    mx /= Math.max(1, mn); mz /= Math.max(1, mn);
    for (let c = 0; c < C.count; c++) {
      const a = C.off[c], b = C.off[c + 1];
      if (C.closed[c]) {
        land.moveTo(C.xs[a], C.zs[a]);
        for (let p = a + 1; p < b; p++) land.lineTo(C.xs[p], C.zs[p]);
        land.closePath();
        continue;
      }
      let sx = 0, sz = 0, cx = 0, cz = 0;
      for (let p = a; p < b - 1; p++) { sx += C.zs[p + 1] - C.zs[p]; sz -= C.xs[p + 1] - C.xs[p]; cx += C.xs[p]; cz += C.zs[p]; }
      cx /= b - a; cz /= b - a;
      const sign = sx * (cx - mx) + sz * (cz - mz) >= 0 ? 1 : -1;
      for (let p = a; p < b - 1; p++) {
        const dx = C.xs[p + 1] - C.xs[p], dz = C.zs[p + 1] - C.zs[p], L = Math.hypot(dx, dz) || 1;
        const nx = (dz / L) * sign * 4000, nz = (-dx / L) * sign * 4000;
        shore.moveTo(C.xs[p], C.zs[p]);
        shore.lineTo(C.xs[p + 1], C.zs[p + 1]);
        shore.lineTo(C.xs[p + 1] + nx, C.zs[p + 1] + nz);
        shore.lineTo(C.xs[p] + nx, C.zs[p] + nz);
        shore.closePath();
      }
    }
    const tileAreas = new Map();
    for (let i = 0; i < A.count; i++) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let p = A.off[i]; p < A.off[i + 1]; p++) { x0 = Math.min(x0, A.xs[p]); x1 = Math.max(x1, A.xs[p]); z0 = Math.min(z0, A.zs[p]); z1 = Math.max(z1, A.zs[p]); }
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) for (let tz = Math.floor(z0 / TILE); tz <= Math.floor(z1 / TILE); tz++) {
        const key = nyc.tileKey(tx, tz);
        let l = tileAreas.get(key);
        if (!l) tileAreas.set(key, (l = []));
        l.push(i);
      }
    }
    paths = { nyc, land, shore, tileAreas, tiles: new Map() };
    return paths;
  }
  function tilePaths(P, key) {
    let t = P.tiles.get(key);
    if (t) return t;
    const nyc = P.nyc, T = nyc.tiles.get(key);
    t = { b: new Path2D(), roads: new Map(), park: new Path2D(), water: new Path2D(), plaza: new Path2D(), any: false };
    if (T) {
      const B = nyc.buildings, R = nyc.roads;
      for (const i of T.b) {
        if (nyc.skipBuilding[i]) continue;
        const a = B.off[i], b = B.off[i + 1];
        t.b.moveTo(B.xs[a], B.zs[a]);
        for (let p = a + 1; p < b; p++) t.b.lineTo(B.xs[p], B.zs[p]);
        t.b.closePath();
      }
      for (const p of T.seg) {
        const r = R.segRoad[p], cls = R.cls[r];
        const kind = cls === ROAD.PEDESTRIAN ? 'ped' : cls === ROAD.SERVICE ? 'svc' : cls <= ROAD.SECONDARY ? 'major' : 'minor';
        const w = Math.round(R.width[r]);
        const k = kind + w;
        let e = t.roads.get(k);
        if (!e) t.roads.set(k, (e = { path: new Path2D(), w, kind }));
        e.path.moveTo(R.xs[p], R.zs[p]);
        e.path.lineTo(R.xs[p + 1], R.zs[p + 1]);
      }
      t.any = true;
    }
    const A = nyc.areas;
    for (const i of P.tileAreas.get(key) || []) {
      const k = A.kind[i];
      const path = k === AREA.WATER ? t.water : k === AREA.PLAZA || k === AREA.PIER ? t.plaza : t.park;
      path.moveTo(A.xs[A.off[i]], A.zs[A.off[i]]);
      for (let p = A.off[i] + 1; p < A.off[i + 1]; p++) path.lineTo(A.xs[p], A.zs[p]);
      path.closePath();
      t.any = true;
    }
    P.tiles.set(key, t);
    return t;
  }
  const ROAD_STYLE = { major: '#5d6584', minor: '#444b63', ped: '#5a4a80', svc: '#323849' };
  function drawBase(g, W, H, view, o = {}) {
    const nyc = hooks.mapData?.();
    const k = view.scale;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0a1424';
    g.fillRect(0, 0, W, H);
    if (!nyc) {
      g.fillStyle = 'rgba(205,215,245,0.7)';
      g.font = `800 ${Math.round(13 * (o.ui || 1))}px "Pretendard Variable", sans-serif`;
      g.textAlign = 'center';
      g.fillText('지도 불러오는 중…', W / 2, H / 2);
      return;
    }
    const P = cityPaths(nyc);
    const x0 = view.cx - W / 2 / k, x1 = view.cx + W / 2 / k, z0 = view.cz - H / 2 / k, z1 = view.cz + H / 2 / k;
    g.setTransform(k, 0, 0, k, W / 2 - view.cx * k, H / 2 - view.cz * k);
    g.fillStyle = '#141a27';
    g.fill(P.shore);
    g.fillStyle = '#1c2232';
    g.fill(P.land);
    const tiles = [];
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) for (let tz = Math.floor(z0 / TILE); tz <= Math.floor(z1 / TILE); tz++) {
      const key = nyc.tileKey(tx, tz);
      if (!nyc.tiles.has(key) && !P.tileAreas.has(key)) continue;
      tiles.push(tilePaths(P, key));
    }
    g.fillStyle = '#1e3b28';
    for (const t of tiles) g.fill(t.park);
    g.fillStyle = '#342d4a';
    for (const t of tiles) g.fill(t.plaza);
    g.fillStyle = '#13294a';
    for (const t of tiles) g.fill(t.water);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const kind of ['svc', 'ped', 'minor', 'major']) {
      if (kind === 'svc' && k < 0.6) continue;
      if (kind === 'minor' && k < 0.07) continue;
      if (kind === 'ped' && k < 0.25) continue;
      g.strokeStyle = ROAD_STYLE[kind];
      for (const t of tiles) for (const e of t.roads.values()) {
        if (e.kind !== kind) continue;
        g.lineWidth = Math.max(e.w, (kind === 'major' ? 1.8 : 1.1) / k);
        g.stroke(e.path);
      }
    }
    if (k > 0.3) {
      g.fillStyle = k > 0.9 ? '#2c3350' : '#262c42';
      for (const t of tiles) g.fill(t.b);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    const X = (x) => W / 2 + (x - view.cx) * k, Z = (z) => H / 2 + (z - view.cz) * k;
    const ui = o.ui || 1;
    // K-Town lots with their owners' colors
    if (k > 0.45) {
      const lv = new Map((o.plots || []).map(p => [p.id, p]));
      for (const s of PLOT_SLOTS) {
        const p = lv.get(s.id);
        const sz = 10.5 * k;
        g.fillStyle = p?.level ? p.color : 'rgba(255,233,168,0.3)';
        g.fillRect(X(s.x) - sz / 2, Z(s.z) - sz / 2, sz, sz);
        if (p?.mine) { g.strokeStyle = '#ffffff'; g.lineWidth = 2 * ui; g.strokeRect(X(s.x) - sz / 2, Z(s.z) - sz / 2, sz, sz); }
      }
    }
    if (o.labels) {
      const placed = [];
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const L of nyc.labels) {
        if (L.x < x0 - 50 || L.x > x1 + 50 || L.z < z0 - 50 || L.z > z1 + 50) continue;
        const major = L.cls <= ROAD.SECONDARY;
        if (k < (major ? 0.11 : 0.5)) continue;
        const sx = X(L.x), sy = Z(L.z);
        if (placed.some(([px, py]) => Math.abs(px - sx) < 130 * ui && Math.abs(py - sy) < 26 * ui)) continue;
        placed.push([sx, sy]);
        const text = streetLabel(nyc.names[L.name], k < 0.35);
        g.save();
        g.translate(sx, sy);
        g.rotate(L.ang);
        g.font = `800 ${Math.round((major ? 11.5 : 10.5) * ui)}px "Pretendard Variable", sans-serif`;
        g.lineWidth = 3 * ui;
        g.strokeStyle = 'rgba(10,14,26,0.85)';
        g.strokeText(text, 0, 0);
        g.fillStyle = major ? 'rgba(220,228,255,0.92)' : 'rgba(190,200,232,0.78)';
        g.fillText(text, 0, 0);
        g.restore();
      }
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const l of LANDMARKS) {
      const sx = X(l.x), sy = Z(l.z);
      if (sx < -40 || sy < -40 || sx > W + 40 || sy > H + 40) continue;
      if (!l.major && k > 2.5) continue;
      if (!l.major && !o.labels && k < 0.4) continue;
      g.font = `${Math.round((l.major ? 15 : 13) * ui)}px ${EMOJI_FONT}`;
      g.fillText(l.g, sx, sy);
      if (!o.labels || (!l.major && k < 0.08)) continue;
      g.font = `800 ${Math.round(11 * ui)}px "Pretendard Variable", sans-serif`;
      g.lineWidth = 3 * ui;
      g.strokeStyle = 'rgba(10,14,26,0.9)';
      if (l.side) {
        g.textAlign = l.side > 0 ? 'left' : 'right';
        g.strokeText(l.ko, sx + l.side * 11 * ui, sy);
        g.fillStyle = '#ffffff';
        g.fillText(l.ko, sx + l.side * 11 * ui, sy);
        g.textAlign = 'center';
      } else {
        g.strokeText(l.ko, sx, sy + 15 * ui);
        g.fillStyle = l.major ? '#ffffff' : '#ffe9a8';
        g.fillText(l.ko, sx, sy + 15 * ui);
      }
    }
    if (k > 0.5) {
      g.font = `${Math.round(11 * ui)}px ${EMOJI_FONT}`;
      for (const s of TAXI_STANDS) g.fillText('🚕', X(s.x), Z(s.z));
    }
    const fx = X(LOOP.x0), fy = Z(LOOP.z0), fw = X(LOOP.x1) - fx, fh = Z(LOOP.z1) - fy;
    g.save();
    g.beginPath();
    g.rect(0, 0, W, H);
    g.rect(fx, fy, fw, fh);
    g.fillStyle = 'rgba(4, 6, 14, 0.55)';
    g.fill('evenodd');
    g.strokeStyle = '#ffcf5a';
    g.lineWidth = Math.max(2, 2.2 * ui);
    g.setLineDash([8 * ui, 5 * ui]);
    g.strokeRect(fx, fy, fw, fh);
    g.restore();
  }
  function drawOverlay(g, W, H, view, d, o = {}) {
    if (!d) return;
    const k = view.scale, ui = o.ui || 1;
    const X = (x) => W / 2 + (x - view.cx) * k, Z = (z) => H / 2 + (z - view.cz) * k;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (o.taxis) {
      for (const t of d.taxis || []) {
        g.fillStyle = t.mode === 'driven' ? '#ffffff' : '#ffc21a';
        g.fillRect(X(t.x) - 1.8 * ui, Z(t.z) - 1.8 * ui, 3.6 * ui, 3.6 * ui);
      }
    }
    const dot = (x, z, rr, c) => { g.fillStyle = c; g.beginPath(); g.arc(X(x), Z(z), rr, 0, Math.PI * 2); g.fill(); };
    const tt = performance.now() / 300;
    for (const s of d.stars || []) dot(s.x, s.z, (3.5 + Math.sin(tt) * 1.2) * ui, '#ffe9a8');
    for (const p of d.peers || []) { dot(p.x, p.z, 4.6 * ui, '#0b0d18'); dot(p.x, p.z, 3.4 * ui, p.color); }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const pin = (p, color, glyph) => {
      if (!p) return;
      let px = X(p.x), py = Z(p.z);
      const m = 14 * ui;
      if (px < m || px > W - m || py < m || py > H - m) {
        const cx = W / 2, cy = H / 2, dx = px - cx, dy = py - cy;
        const s = Math.min((W / 2 - m) / Math.abs(dx || 1e-6), (H / 2 - m) / Math.abs(dy || 1e-6));
        px = cx + dx * s;
        py = cy + dy * s;
        g.save();
        g.translate(px, py);
        g.rotate(Math.atan2(dy, dx));
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(9 * ui, 0);
        g.lineTo(-6 * ui, 6 * ui);
        g.lineTo(-6 * ui, -6 * ui);
        g.closePath();
        g.fill();
        g.restore();
        return;
      }
      g.fillStyle = color;
      g.beginPath();
      g.arc(px, py, 9 * ui, 0, Math.PI * 2);
      g.globalAlpha = 0.35 + 0.25 * Math.sin(tt * 2);
      g.fill();
      g.globalAlpha = 1;
      g.font = `${Math.round(14 * ui)}px ${EMOJI_FONT}`;
      g.fillText(glyph, px, py);
    };
    pin(d.waypoint && insideLoop(d.waypoint.x, d.waypoint.z, 0) ? d.waypoint : null, '#3fe6ff', '📍');
    if (d.job) pin(d.job, d.job.kind === 'pickup' ? '#39f58a' : '#ffcf5a', d.job.kind === 'pickup' ? '🙋' : '🏁');
    const me = d.me;
    if (me) {
      g.save();
      g.translate(X(me.x), Z(me.z));
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, 60 * ui, Math.PI / 2 - d.camYaw - 0.5, Math.PI / 2 - d.camYaw + 0.5);
      g.closePath();
      g.fill();
      g.rotate(-me.yaw);
      g.fillStyle = d.driving ? '#ffc21a' : '#ffffff';
      g.shadowColor = hooks.color();
      g.shadowBlur = 12;
      g.beginPath();
      g.moveTo(0, 11 * ui);
      g.lineTo(7 * ui, -7 * ui);
      g.lineTo(0, -3 * ui);
      g.lineTo(-7 * ui, -7 * ui);
      g.closePath();
      g.fill();
      g.restore();
    }
  }
  let miniSpan = 230;
  mapEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 180 : e.deltaY;
    if (!dy) return;
    miniSpan = Math.min(680, Math.max(110, miniSpan * Math.exp(dy * 0.0014)));
    miniSig = '';
  }, { passive: false });
  const mctx = mapCanvas.getContext('2d');
  const miniBase = document.createElement('canvas');
  let miniSig = '';
  function drawMini(d) {
    if (!d?.me) return;
    const S = mapCanvas.width;
    const view = { cx: d.me.x, cz: d.me.z, scale: S / miniSpan };
    const ui = S / 184;
    const sig = `${Math.round(view.cx * 2)},${Math.round(view.cz * 2)},${hooks.mapData?.() ? 1 : 0},${(d.plots || []).map(p => p.level + p.color).join('')}`;
    if (sig !== miniSig) {
      miniSig = sig;
      if (miniBase.width !== S) { miniBase.width = S; miniBase.height = S; }
      drawBase(miniBase.getContext('2d'), S, S, view, { ui, plots: d.plots });
    }
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.drawImage(miniBase, 0, 0);
    drawOverlay(mctx, S, S, view, d, { taxis: true, ui });
    mctx.fillStyle = 'rgba(255,255,255,0.6)';
    mctx.font = '800 18px "Pretendard Variable", sans-serif';
    mctx.textAlign = 'center';
    mctx.fillText('N', S / 2, 20);
    mctx.fillStyle = 'rgba(255,255,255,0.38)';
    mctx.font = '700 13px "Pretendard Variable", sans-serif';
    mctx.textAlign = 'left';
    mctx.fillText('© OSM', 10, S - 10);
  }

  const QUICK = [
    { ko: '🐟 붕어빵', x: LAYOUT.stall.x, z: LAYOUT.stall.z + 4.4 },
    { ko: '🚕 승강장', x: TAXI_STANDS[0].x, z: TAXI_STANDS[0].z },
    { ko: '💃 K-POP 스테이지', x: LAYOUT.stage.spot.x, z: LAYOUT.stage.z0 - 8 },
    { ko: '🏗️ 분양 구역', x: 0, z: 305 },
    ...['esb', 'rock', 'cpark', 'gct', 'owtc', 'flatiron', 'vessel', 'washsq', 'bklyn', 'harlem'].map(id => LANDMARKS.find(l => l.id === id)).filter(Boolean).map(l => ({ ko: l.ko, x: l.x, z: l.z })),
  ].filter((q) => insideLoop(q.x, q.z, 0));
  function clampLoopView(view, w, h) {
    const pad = 20;
    const worldW = LOOP.x1 - LOOP.x0 + pad * 2, worldH = LOOP.z1 - LOOP.z0 + pad * 2;
    const minScale = Math.min(w / worldW, h / worldH) * 0.75;
    if (view.scale < minScale) view.scale = minScale;
    const hx = w / view.scale / 2, hz = h / view.scale / 2;
    const x0 = LOOP.x0 - pad + hx, x1 = LOOP.x1 + pad - hx;
    const z0 = LOOP.z0 - pad + hz, z1 = LOOP.z1 + pad - hz;
    view.cx = x0 > x1 ? (LOOP.x0 + LOOP.x1) / 2 : Math.min(x1, Math.max(x0, view.cx));
    view.cz = z0 > z1 ? (LOOP.z0 + LOOP.z1) / 2 : Math.min(z1, Math.max(z0, view.cz));
  }
  function openMap(focus) {
    openSheet('🗺️ 뉴욕 지도', 'MANHATTAN', (host) => {
      const wrap = h('div', { class: 'bigmap' });
      const cv = h('canvas');
      wrap.append(cv);
      const dprM = Math.min(2, window.devicePixelRatio || 1);
      const base = document.createElement('canvas');
      const size = () => {
        const r = wrap.getBoundingClientRect();
        cv.width = Math.max(200, Math.round(r.width * dprM));
        cv.height = Math.max(200, Math.round(r.height * dprM));
        base.width = cv.width;
        base.height = cv.height;
        sig = '';
      };
      const g = cv.getContext('2d');
      const d0 = hooks.minimap?.();
      const view = { cx: focus?.x ?? d0?.me?.x ?? 0, cz: focus?.z ?? d0?.me?.z ?? 0, scale: 0.75 * dprM };
      const MIN = 0.35 * dprM, MAX = 8 * dprM;
      let drag = null, raf = 0, sig = '';
      const draw = () => {
        raf = requestAnimationFrame(draw);
        clampLoopView(view, cv.width, cv.height);
        const d = hooks.minimap?.();
        const ui = dprM * Math.max(0.9, Math.min(1.5, 1));
        const s = `${view.cx.toFixed(1)},${view.cz.toFixed(1)},${view.scale.toFixed(4)},${cv.width},${hooks.mapData?.() ? 1 : 0},${(d?.plots || []).map(p => p.level + p.color).join('')}`;
        if (s !== sig) { sig = s; drawBase(base.getContext('2d'), base.width, base.height, view, { labels: true, ui, plots: d?.plots }); }
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(base, 0, 0);
        drawOverlay(g, cv.width, cv.height, view, d, { taxis: true, ui });
      };
      const toWorld = (ev) => {
        const r = cv.getBoundingClientRect();
        const px = (ev.clientX - r.left) * dprM, py = (ev.clientY - r.top) * dprM;
        return { x: view.cx + (px - cv.width / 2) / view.scale, z: view.cz + (py - cv.height / 2) / view.scale };
      };
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * cv.clientHeight : e.deltaY;
        if (!dy) return;
        const before = toWorld(e);
        view.scale = Math.max(MIN, Math.min(MAX, view.scale * Math.exp(-dy * 0.0016)));
        clampLoopView(view, cv.width, cv.height);
        const after = toWorld(e);
        view.cx += before.x - after.x;
        view.cz += before.z - after.z;
        clampLoopView(view, cv.width, cv.height);
      }, { passive: false });
      const pointers = new Map();
      let pinch = null;
      cv.addEventListener('pointerdown', (e) => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        cv.setPointerCapture(e.pointerId);
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
          drag = null;
        } else drag = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz, moved: 0 };
      });
      cv.addEventListener('pointermove', (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          view.scale = Math.max(MIN, Math.min(MAX, pinch.scale * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.d)));
          return;
        }
        if (!drag) return;
        const dx = (e.clientX - drag.x) * dprM, dy = (e.clientY - drag.y) * dprM;
        drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
        view.cx = drag.cx - dx / view.scale;
        view.cz = drag.cz - dy / view.scale;
      });
      const up = (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
        if (!drag) return;
        const click = drag.moved < 6;
        drag = null;
        if (!click) return;
        const p = toWorld(e);
        if (!insideLoop(p.x, p.z, 0)) { note('울타리 밖으로는 갈 수 없어요', 'err'); return; }
        if (!hooks.onLand?.(p.x, p.z)) { note('강 위에는 표시할 수 없어요', 'err'); return; }
        hooks.setWaypoint({ x: p.x, z: p.z });
        sfx.click();
        note('📍 목적지를 표시했어요 · ⚡ 버튼으로 순간이동도 돼요', 'ok');
      };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinch = null; drag = null; });
      const zoomBtns = h('div', { class: 'mapzoom' },
        h('button', { type: 'button', text: '＋', onclick: () => { view.scale = Math.min(MAX, view.scale * 1.4); } }),
        h('button', { type: 'button', text: '－', onclick: () => { view.scale = Math.max(MIN, view.scale / 1.4); } }),
        h('button', { type: 'button', text: '◎', title: '내 위치', onclick: () => { const d = hooks.minimap?.(); if (d?.me) { view.cx = d.me.x; view.cz = d.me.z; } } }),
        h('button', { type: 'button', text: '⚡', title: '목적지로 순간이동', onclick: () => {
          const d = hooks.minimap?.();
          if (!d?.waypoint) { note('먼저 지도를 눌러 목적지를 정하세요', 'err'); return; }
          if (!insideLoop(d.waypoint.x, d.waypoint.z, 0)) { note('울타리 밖으로는 갈 수 없어요', 'err'); return; }
          hooks.teleport(d.waypoint.x, d.waypoint.z);
          closeSheet();
          sfx.fanfare();
          note('⚡ 순간이동 완료!', 'ok');
        } }),
        h('button', { type: 'button', text: '✕📍', title: '목적지 지우기', onclick: () => hooks.setWaypoint(null) }));
      wrap.append(zoomBtns);
      const chips = h('div', { class: 'quick' }, ...QUICK.map(q => h('button', { type: 'button', text: q.ko, onclick: () => {
        if (!insideLoop(q.x, q.z, 0)) return;
        view.cx = q.x; view.cz = q.z; view.scale = Math.max(view.scale, 0.9 * dprM);
        hooks.setWaypoint({ x: q.x, z: q.z });
        sfx.click();
      } })));
      host.append(chips, wrap, h('div', { class: 'legend' },
        h('span', null, '🔴 TKTS'), h('span', null, '🐟 붕어빵'), h('span', null, '💃 K-POP 스테이지'), h('span', null, '🏗️ K-타운 분양'), h('span', null, '🚕 택시 승강장'),
        h('span', null, h('i', { style: { background: '#ffc21a' } }), '택시'), h('span', null, h('i', { style: { background: '#3fe6ff' } }), '목적지'),
        h('span', { class: 'tip', text: coarse ? '탭: 목적지 · 드래그: 이동 · 두 손가락: 확대 · ⚡ 순간이동' : '클릭: 목적지 · 드래그: 이동 · 휠: 확대 · ⚡ 순간이동' }),
        h('a', { class: 'osm', href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener', text: '© OpenStreetMap contributors' })));
      requestAnimationFrame(() => { size(); draw(); });
      const ro = new ResizeObserver(size);
      ro.observe(wrap);
      return () => { cancelAnimationFrame(raf); ro.disconnect(); };
    }, false, 'map');
  }

  function openSettings() {
    openSheet('⚙️ 설정', null, (host) => {
      const s = hooks.settings();
      const row = (label, hint, min, max, value, fmt, onInput) => {
        const out = h('b', { class: 'tnum', text: fmt(value) });
        const input = h('input', { type: 'range', min: String(min), max: String(max), value: String(value), class: 'range' });
        input.addEventListener('input', () => { out.textContent = fmt(Number(input.value)); onInput(Number(input.value)); });
        return h('div', { class: 'field' }, h('label', null, label, h('span', { text: hint })), h('div', { class: 'rangerow' }, input, out));
      };
      const qSel = h('div', { class: 'seg' });
      for (const [q, label] of [['auto', '자동'], ['high', '높음'], ['medium', '중간'], ['low', '낮음']]) {
        const b = h('button', { type: 'button', text: label, class: s.quality === q ? 'on' : '', onclick: () => { for (const c of qSel.children) c.classList.toggle('on', c === b); hooks.setQuality(q); qNote.hidden = false; } });
        qSel.append(b);
      }
      const qNote = h('div', { class: 'note', hidden: true }, '품질 변경은 새로고침 후 적용돼요 · ', h('button', { type: 'button', class: 'linkbtn', text: '지금 새로고침', onclick: () => location.reload() }));
      const accountId = String(hooks.actorId() || '');
      const accountBox = h('input', { class: 'input', readOnly: true, value: accountId || '입장하면 발급됩니다', 'aria-label': '계정 번호' });
      const copyBtn = h('button', { class: 'btn ghost', type: 'button', text: '복사', style: { height: '44px', padding: '0 14px' }, onclick: async () => {
        if (!accountId) return;
        accountBox.select();
        try { await navigator.clipboard.writeText(accountId); note('계정 번호를 복사했어요', 'ok'); }
        catch { note('길게 눌러 계정 번호를 선택하세요', 'err'); }
      } });
      const who = hooks.linked?.() ? '인증 계정' : (hooks.isGuest?.() ? '임시 게스트' : '입장 전');
      host.append(
        h('div', { class: 'holder', style: { marginTop: 0 } },
          h('div', { class: 'stat' }, h('small', { text: '상태' }), h('b', { text: who })),
          h('div', { class: 'stat' }, h('small', { text: '닉네임' }), h('b', { text: hooks.nick?.() || '—' })),
          h('div', { class: 'stat' }, h('small', { text: '이메일' }), h('b', { text: hooks.email?.() || '없음' }))),
        row('네온 글로우', '눈부시면 낮춰 주세요', 0, 100, Math.round(s.glow * 100), v => `${v}%`, v => hooks.setGlow(v / 100)),
        row('화면 밝기', '노출', 60, 130, Math.round(s.exposure * 100), v => `${v}%`, v => hooks.setExposure(v / 100)),
        h('div', { class: 'field' }, h('label', null, '그래픽 품질', h('span', { text: '반사·해상도' })), qSel, qNote),
        h('div', { class: 'field' }, h('label', null, '계정 번호', h('span', { text: '코인 지급은 이 번호로만' })), h('div', { class: 'bid' }, accountBox, copyBtn)),
        h('p', { class: 'note' }, '지도 © ', h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener', text: 'OpenStreetMap' }), ' · ', h('button', { type: 'button', class: 'linkbtn', text: '사진·캐릭터 라이선스', onclick: () => openCredits() })),
        policyLinks(),
      );
      if (hooks.linked?.()) {
        const confirm = h('div', { hidden: true });
        const go = h('button', { class: 'btn', type: 'button', text: '탈퇴하기' });
        const cancel = h('button', { class: 'btn ghost', type: 'button', text: '취소', onclick: () => { confirm.hidden = true; } });
        go.addEventListener('click', async () => {
          go.disabled = true;
          try { await hooks.withdraw?.(); closeSheet(); }
          catch (e) { note(e?.message || '탈퇴를 처리하지 못했어요', 'err'); go.disabled = false; }
        });
        confirm.append(h('p', { class: 'note', text: '내 지갑 연결과 내 전광판·토지 소유만 지웁니다. 다른 사람의 데이터는 지우지 않아요.' }), cancel, go);
        host.append(
          h('button', { type: 'button', class: 'linkbtn', text: '[회원 탈퇴 및 데이터 초기화]', onclick: () => { confirm.hidden = false; } }),
          confirm,
        );
      }
    }, true);
  }

  // ---------------------------------------------------------------- HUD readouts
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function renderHud(hd) {
    renderPending();
    if (!hd) return;
    if (hd.driving) {
      spdEl.textContent = String(Math.round(hd.speed));
      fareEl.textContent = `$${hd.fare.toFixed(2)}`;
      if (hd.job) {
        const riding = hd.job.phase === 'ride';
        if (riding && !rideLine) rideLine = PASSENGER_LINES[(Math.random() * PASSENGER_LINES.length) | 0];
        if (!riding) rideLine = '';
        jobEl.classList.toggle('talk', riding && !!rideLine);
        jobTitle.textContent = hd.job.phase === 'pickup' ? '🙋 초록 기둥에서 속도를 줄이세요' : '🏁 노란 기둥에서 속도를 줄이세요';
        jobDist.textContent = hd.job.dist >= 1000 ? `${(hd.job.dist / 1000).toFixed(1)}km` : `${Math.round(hd.job.dist)}m`;
        jobArrow.style.transform = `rotate(${(-hd.job.bearing * 180) / Math.PI - 90}deg)`;
        jobArrow.style.color = hd.job.phase === 'pickup' ? '#39f58a' : '#ffcf5a';
        jobTime.textContent = hd.job.left != null ? fmtTime(hd.job.left) : '';
        jobTime.classList.toggle('low', hd.job.left != null && hd.job.left < 10);
      } else {
        rideLine = '';
        jobEl.classList.remove('talk');
        jobTitle.textContent = '손님 찾는 중…';
        jobDist.textContent = '-';
        jobTime.textContent = '';
        jobArrow.style.transform = 'rotate(-90deg)';
      }
      if (hd.train && hd.train.riders > 0) {
        trainEl.hidden = false;
        trainEl.textContent = `🔥 현재 택시 기차: ${hd.train.riders}명 탑승 중 (x${hd.train.mult}배) | 지금 내릴까, 한 명 더 태울까?`;
      } else trainEl.hidden = true;
    } else trainEl.hidden = true;
    const fever = hd.fever;
    if (fever) {
      if (fever.phase === 'count') feverEl.textContent = `🔮 크리스탈볼 ${Math.ceil(fever.left)}초 뒤 드롭 · 열기 ${fever.gauge}/20`;
      else if (fever.phase === 'party') feverEl.textContent = `✨ 2배 코인 · 부스트 무제한 ${Math.ceil(fever.left)}초 · 열기 20/20`;
      else feverEl.textContent = `🔮 광장 열기 ${fever.gauge}/20`;
    }
    wayPill.hidden = !hd.waypoint;
    if (hd.waypoint) {
      const m = hd.waypoint.dist;
      wayText.textContent = m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
      wayArrow.style.transform = `rotate(${(-hd.waypoint.bearing * 180) / Math.PI - 90}deg)`;
    }
    const w = hd.where;
    const text = w ? [w.a, w.b].filter(Boolean).map(n => streetLabel(n, true)).filter((v, i, arr) => arr.indexOf(v) === i).join(' × ') || w.area || '맨해튼' : '맨해튼';
    if (locText.textContent !== text) locText.textContent = text;
  }

  // ---------------------------------------------------------------- loop & keys
  let last = performance.now(), mapAt = 0, hudAt = 0, rankAt = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (baking) {
      baking.pos += baking.dir * baking.speed * dt;
      if (baking.pos >= 1) { baking.pos = 1; baking.dir = -1; }
      if (baking.pos <= 0) { baking.pos = 0; baking.dir = 1; }
      needle.style.left = `${baking.pos * 100}%`;
    }
    if (dance) drawDance();
    const left = cooldownLeft();
    promptCool.hidden = !(left > 0 && near);
    if (left > 0) coolSvg.fg.setAttribute('stroke-dashoffset', String(69.1 * (left / COOLDOWN)));
    if (now - mapAt > 125 && !document.hidden) { mapAt = now; drawMini(hooks.minimap?.()); }
    if (now - hudAt > 66 && !document.hidden) { hudAt = now; renderHud(hooks.hud?.()); }
    if (now - rankAt > 1000 && !document.hidden) { rankAt = now; paintLive(); renderGoal(); maybeStarterToast(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (dance) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endDance(true); return; }
      if (e.code in DANCE_KEYS) { e.preventDefault(); if (!e.repeat) danceHit(DANCE_KEYS[e.code]); }
      return;
    }
    if (e.key === 'Escape') {
      const open = dance || baking || !reactPanel.hidden || !!sheet;
      if (dance) endDance(true);
      else if (!reactPanel.hidden) toggleReacts(false);
      else if (baking) stopBake(true);
      else if (sheet) closeSheet();
      if (open) { e.preventDefault(); e.stopPropagation(); }
      else if (fsOn()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) exit.call(document);
      }
      return;
    }
    if (typing) return;
    if (baking && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE')) { e.preventDefault(); stopBake(); return; }
    if (e.code === 'KeyM' && !e.repeat) { if (sheet?.el.querySelector('.map')) closeSheet(); else if (!sheet && !baking) openMap(); }
    if (e.code === 'Digit5' && !e.repeat && !sheet && !baking && !driving) toggleReacts();
  }, true);
  bakeEl.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; stopBake(); });

  const loungeEl = h('div', { class: 'stay-lounge', hidden: true });
  const ticketEl = h('button', { class: 'stay-ticket', type: 'button' });
  const questEl = h('div', { class: 'stay-quest' });
  const balloonEl = h('button', { class: 'stay-balloon', type: 'button', hidden: true, onclick: () => hooks.throwPouch?.() });
  const loungeBtn = h('button', { class: 'stay-lounge-btn', type: 'button', title: '전광판 관람. 8초마다 다른 전광판, 10초마다 +3. 움직이면 끝', onclick: () => hooks.toggleLounge?.() },
    h('span', { class: 'e', text: '☕' }), h('span', { class: 'l', text: '멍때리기' }));
  const focusBtn = h('button', { class: 'stay-focus', type: 'button', hidden: true, onclick: () => hooks.endFocus?.() }, '시점 해제');
  dock.prepend(loungeBtn);
  root.querySelector('.hud-l')?.append(questEl);
  root.querySelector('.hud-r')?.append(balloonEl);
  root.append(ticketEl, loungeEl, focusBtn);
  let loungeN = 0;
  function paintLounge(on, n) {
    loungeEl.hidden = !on;
    loungeBtn.classList.toggle('on', !!on);
    const label = loungeBtn.querySelector('.l');
    if (label) label.textContent = on ? '그만' : '멍때리기';
    loungeN = n || 0;
    if (on) loungeEl.textContent = `☕ 야경 감상 중. 전광판은 8초마다 알아서 바뀝니다. (10초마다 +3 | 누적 +${loungeN})`;
  }
  function paintTickets(count, ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    ticketEl.textContent = `🎟️ 내 보유 복권: ${count}장 | 다음 잭팟 추첨까지 ${mm}:${ss} · 창을 닫으면 복권은 사라집니다`;
  }
  function paintQuests() {
    const d = today();
    const paid = d.qPaid || {};
    const row = (key, need, label) => {
      const done = !!paid[key];
      return h('div', { class: done ? 'ok' : '', text: `${done ? '✅' : '☐'} ${label} (${Math.min(d[key] || 0, need)}/${need})` });
    };
    questEl.replaceChildren(
      h('b', { text: '오늘의 드라이버' }),
      row('fare', 3, '택시 타고 손님 3명 내리기 +50 · 복권 2장'),
      row('cheer', 3, '전광판 기운 3회 +30'),
      row('stunt', 2, '길 위 황금 링을 걸어 통과 2회 +40'),
      h('div', { class: paid.all ? 'ok' : '', text: `${paid.all ? '🎁' : '☐'} 3개 완료 시 소형 전광판 등록비 100코인` }),
    );
  }
  function questBump(key) {
    const d = today();
    const need = { fare: 3, cheer: 3, stunt: 2 }[key];
    if (!need) return;
    d.qPaid = d.qPaid || {};
    if (d.qPaid[key]) return;
    d[key] = (d[key] || 0) + 1;
    saveDay(d);
    paintQuests();
    if (d[key] < need) return;
    d.qPaid[key] = 1;
    saveDay(d);
    const pay = { fare: 50, cheer: 30, stunt: 40 }[key];
    hooks.bonus?.('quest', pay);
    if (key === 'fare') hooks.tickets?.(2);
    note(`미션 완료 +${pay}`, 'ok');
    paintQuests();
    if (d.qPaid.fare && d.qPaid.cheer && d.qPaid.stunt && !d.qPaid.all) {
      d.qPaid.all = 1;
      saveDay(d);
      hooks.bonus?.('quest', 100);
      note('🎁 소형 전광판 등록비 100코인을 넣었어요', 'ok');
      paintQuests();
    }
  }
  let balloonHp = 0, balloonWait = 25000, balloonWaitAt = 0;
  function paintBalloon() {
    balloonEl.hidden = false;
    balloonEl.disabled = !(balloonHp > 0);
    if (balloonHp > 0) balloonEl.textContent = `🧧${Math.ceil(balloonHp / 10)}`;
    else if (!balloonWaitAt) balloonEl.textContent = '🧧 준비';
    else {
      const left = Math.max(0, Math.ceil((balloonWaitAt + (balloonWait || 25000) - Date.now()) / 1000));
      balloonEl.textContent = `🧧 ${left}초`;
    }
  }
  setInterval(paintBalloon, 1000);
  paintQuests();
  paintTickets(0, 300000);

  renderWallet();
  renderProfile();
  renderStatus();

  return {
    sfx, note, pop, flyCoins, cooldownLeft, armCooldown, showResult,
    startBake, stopBake, startDance, openBillboard, openAd, openPlot, openHub, openCredits, openMap, openSettings, openWalletInfo, openVip, toggleReacts, showProof,
    mission(kind) { if (kind === 'cheer' || kind === 'bake') missionBump(kind); },
    quest: questBump,
    tickets: paintTickets,
    lounge(on, n) { paintLounge(on, n); if (on) lofiStart(); else lofiStop(); },
    focusLock(on) { focusBtn.hidden = !on; },
    revenge(ev) {
      sfx.siren();
      const have = (wallet.confirmed || 0) + (wallet.pending || 0);
      const price = Math.floor(Number(ev.price) || 0);
      const short = have < price;
      rememberTake(ev.slot, ev.attacker);
      openSheet('전광판을 빼앗겼어요', ev.slotName || slotName(ev.slot), (host) => {
        host.append(
          h('p', { text: `🚨 방금 ${ev.attacker || '누군가'}님이 회원님의 ${ev.slotName || slotName(ev.slot)}을 빼앗았습니다!` }),
          h('button', { class: 'btn gold', type: 'button', text: `⚔️ 즉시 되찾아오기 (필요 코인: ${money(price)})`, onclick: async () => {
            closeSheet();
            try {
              await hooks.claim({ slot_id: ev.slot, bid: price, line1: ev.line1 || '', line2: ev.line2 || '', line3: ev.line3 || '', emoji: ev.emoji || '⚔️', bg_theme: ev.theme || 'cyber_navy', text_color: ev.color || '#ffffff' });
              note('되찾았습니다', 'ok');
            } catch (e) { note(e?.message || '되찾지 못했어요', 'err'); }
          } }),
          short ? h('button', { class: 'btn', type: 'button', text: '🔥 복수 자금 모으러 2배 보상 긴급 손님 태우기!', onclick: () => { closeSheet(); hooks.revenge?.(); } }) : null,
        );
      });
    },
    showDraw(win, hit, pay) {
      const line = pay > 0 ? (hit ? `🎰 당첨 번호 ${win}! +${pay} 코인` : `🎰 당첨 번호 ${win} · 참가 +${pay} 코인`) : `🎰 당첨 번호 ${win}`;
      const el = h('div', { class: 'stay-draw', text: line });
      root.append(el);
      setTimeout(() => el.remove(), 6500);
    },
    balloon(hp, wait) {
      balloonHp = hp;
      if (!(hp > 0)) { balloonWait = wait || 25000; balloonWaitAt = Date.now(); }
      paintBalloon();
    },
    isBusy: () => !!sheet || !!baking || !!dance,
    setDriving(on) {
      driving = !!on;
      taxiHud.hidden = !driving;
      dock.hidden = driving;
      if (driving) toggleReacts(false);
      if (driving) { closeSheet(); note('🚕 운전 시작! 초록 기둥에서 손님을 태우고, 노란 기둥에서 속도를 줄이면 내립니다', 'ok'); }
      if (boostBtn) boostBtn.hidden = !driving;
      renderPrompt();
    },
    job(ev) {
      if (ev.type === 'offer') { rideLine = ''; jobTitle.textContent = '손님에게 가세요'; note('🙋 진행 방향 도로 위에 손님과 초록 기둥이 있어요. 가까이 가서 속도를 줄이세요'); }
      else if (ev.type === 'board') {
        rideLine = PASSENGER_LINES[(Math.random() * PASSENGER_LINES.length) | 0];
        sfx.pickup();
        jobTitle.textContent = ev.title || '노란 기둥에서 속도를 줄이세요';
        jobEl.classList.add('talk');
        note(ev.title || '노란 기둥까지 가서 시속 40 아래로 줄이면 손님이 내립니다', 'ok');
      }
      else if (ev.type === 'chain') { sfx.pickup(); note(`🚕 ${ev.riders}명째 탑승 · x${ev.mult}배`, 'ok'); }
      else if (ev.type === 'detach') { sfx.bump(); note('💥 맨 뒤 손님이 도로로 떨어졌어요', 'err'); }
      else if (ev.type === 'fail') { rideLine = ''; jobEl.classList.remove('talk'); sfx.miss(); jobTitle.textContent = '손님 찾는 중'; hideSponsor(); note('⏰ 시간 초과… 손님이 내렸어요', 'err'); }
      else if (ev.type === 'done') { rideLine = ''; jobEl.classList.remove('talk'); sfx.cash(); jobTitle.textContent = '손님 찾는 중'; showSponsor(ev); }
      else if (ev.type === 'focus') showSponsor(ev);
    },
    setWaypoint(wp) { waypoint = wp || null; wayPill.hidden = !waypoint; },
    setWallet(next, { bump = false, defer = false } = {}) {
      wallet = {
        confirmed: Math.max(0, Number(next.confirmed) || 0),
        pending: Math.max(0, Number(next.pending) || 0),
        earned: Math.max(0, Number(next.earned) || 0),
      };
      if (defer) renderGoal();
      else renderWallet(bump);
      const gain = wallet.earned - earnedSeen;
      earnedSeen = wallet.earned;
      if (gain > 0) missionBump('earn', gain);
      maybeStarterToast();
      promptLink('coins');
    },
    setAccount(next) {
      accountView = { ready: next?.ready !== false, guest: !!next?.guest, linked: !!next?.linked };
      renderAccount();
    },
    promptLink,
    openLogin,
    setPeople(n, channel = 1) {
      const next = Math.max(1, Number(n) || 1);
      const ch = Math.max(1, Number(channel) || 1);
      if (next === people && ch === peopleCh) return;
      people = next;
      peopleCh = ch;
      peopleEl.textContent = String(people);
      renderStatus();
    },
    setStatus(text, kind = 'warn') { statusText = text || ''; statusKind = kind; renderStatus(); },
    setNear(v) { near = v || null; renderPrompt(); },
    setWorld(next) {
      world = { billboards: next?.billboards || [], plots: next?.plots || [], ranks: next?.ranks || [] };
      plazaReady = true;
      renderPrompt();
      rankRefresh?.();
      paintLive();
      renderGoal();
      maybeStarterToast();
      watchHold();
    },
    refreshProfile: renderProfile,
    boot: {
      progress(p) { if (bootBar && !entered) bootBar.style.width = `${Math.round(Math.max(0.06, Math.min(1, p)) * 92)}%`; },
      ready: bootReady,
    },
    news(kind, data) {
      if (kind === 'BILLBOARD') {
        const who = (data?.holder_name || '누군가') + (linkedActor(data?.holder_id, data?.linked) ? ' ✓' : '');
        const id = data?.slot_id || '';
        const where = slotName(id);
        pushNews('BILLBOARD TAKEOVER', [h('em', { text: who }), `님이 ${where}을 점령했습니다! `, data?.line1 ? `“${chars(data.line1, 16)}”` : '']);
      } else if (kind === 'PLOT') {
        const who = (data?.owner_name || '누군가') + (linkedActor(data?.owner_id) ? ' ✓' : '');
        const lv = LEVELS[Math.max(0, Math.min(4, Number(data?.level) || 0))];
        pushNews('REAL ESTATE', [h('em', { text: who }), `님의 ${data?.plot_id}번 토지에 ${lv.t}가 올라갔습니다`]);
      } else if (kind === 'STAR') pushNews('EVENT · STARFALL', ['🌠 ', h('em', { text: '별똥별 코인 샤워' }), ' 시작! 먼저 닿는 사람이 +8 코인']);
      else if (kind === 'WELCOME') pushNews('WELCOME', ['🗽 ', h('em', { text: data?.nick || '' }), '님, 위시보드에 오신 걸 환영해요!'], false);
    },
  };
}
