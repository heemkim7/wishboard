// Plaza UI: glass HUD, wallet, news wire, emote dock, prompts, bungeo-ppang timing game, K-POP rhythm game,
// taxi HUD, city map + minimap, billboard / plot / ATM / settings / credits sheets, onboarding, touch controls, SFX.
import { paintBillboard, paintNeonSign, THEMES, makeCanvas, chars, fontsReady, tierOf, boardPhoto, photoReady } from './ts3d/art.js?v=202611211159';
import { LAYOUT, LOOP, insideLoop, PLOT_SLOTS, TAXI_STANDS, LANDMARKS } from './ts3d/layout.js?v=202611211159';
import { BALANCE, PAY, askBid, auctionClosed, buildingOf, chainBoost, floorOf, nextChainFace, slotName } from './balance.js';
import { claimWizard, crowdFacts, firstStep, graduation, kstDay, newcomer, newcomerKnown, peopleTag, tutorialNext, tutorialTap, silentGrad, wishStep, wishHeart, wishDraft, shareWish, present, msgText, pushAsk, PUSH_WHY } from './ftue.js?v=202611211159';
import { WISH, WISH_ERR, cleanWish, wishRejected, wishShareText } from './wish.js';
import { botNick, leagueLine, leagueWeek, liveSig } from './league.js';
import { backFields, returnGap } from './growth.js?v=202611211159';
import { nineSlot, nowMs } from './live.js';
import { cardUrl, vipShareLink, composeWishShot, kakaoFeed, kakaoSend, loadKakao, invited } from './share.js?v=202611211159';
import { inviteView } from './invite.js';
import { TILE, ROAD, AREA } from './ts3d/nyc.js?v=202611211159';
import { EMOTES, REACTIONS, AVATAR_COLORS, SPECIES } from './ts3d/avatars.js?v=202611211159';
import { trackEvent } from './analytics.js?v=202611211159';
import { CHEER_PHRASES, allowedLink, blockedText, linkedActor } from './plaza-account.js';
import { subscribePush, resendPush } from './push.js?v=202611211159';
import { bindSfx, play } from './audio.js?v=202611211159';
import { AD, AD_TEMPLATES, adSums, adBars } from './adreport.js';
import { qrEncode, paintQr } from './qr.js?v=202611211159';
import { icon } from './uiicons.js?v=202611211159';

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
// A line icon (uiicons.js) in front of a label, as h() children: h('b', null, ...withIcon('trophy', '실시간 순위')).
const withIcon = (name, text) => (name ? [icon(name), ' ' + text] : [String(text)]);
// Icon + text for a label that is rewritten later; touches the DOM only when either changes (some HUD lines repaint every frame).
function setIconText(el, name, text) {
  const key = `${name || ''}|${text}`;
  if (el.dataset.it === key) return;
  el.dataset.it = key;
  el.replaceChildren(...withIcon(name, text));
}
function minBid(board, boards, actorId, draft = '') {
  const text = draft || [board?.line1, board?.line2, board?.line3].filter(Boolean).join('\n');
  const [line1, line2, line3] = String(text).split('\n');
  return askBid({ ...board, line1: line1 || board?.line1, line2: line2 ?? board?.line2, line3: line3 ?? board?.line3 }, boards, actorId, line1 || '');
}
function lightLeft(board) {
  const until = board?.lit_until || board?.expires_at;
  if (!until || !board?.holder_id) return 0;
  return Math.max(0, new Date(until).getTime() - Date.now());
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
  '방금 추첨 번호 받았는데 기운 좋은 명당 빌딩 앞에 내려주세요!',
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
  // Newcomer focus mode (#ui.newbie): kts_grad is set once and never cleared. tutorialOn holds back the starter toast and the draw popup.
  let grad = !!recall('kts_grad', 0), newbieOn = null, newbieReady = false, tutorialOn = false, tutorialLine = '';
  // tutorialWp: the last waypoint the tutorial set. tutorialBaked: bake pay done; tutorialWalk: walking to the free slot it pointed at.
  let tutorialWp = null, tutorialBaked = false, tutorialWalk = false;
  // 오늘의 소원 as main.js last reported it (ui.setWish). wishSkipped: the sheet was closed without a wish this browser session.
  let wishView = { known: false, day: '', board: [], king: null, count: 0, mine: null, left: 0, given: [], top: [], recent: [], yesterday: [], focus: null };
  let wishSkipped = (() => { try { return sessionStorage.getItem('kts_wish_skip') === '1'; } catch { return false; } })();
  let wishRepaint = null;
  let quietBlock = false, proofWait = null, pushQueued = false, pushOffered = false, replacingSheet = false, awayWant = null, pushQueuedAt = 0, pushInline = '';
  const PUSH_ASK_KEY = 'kts_push_ask'; // when the push offer was closed without subscribing (3-day back-off)
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
    boost: () => tone(play('boost') ? [] : [{ f: 160, to: 640, d: 0.3, type: 'sawtooth', g: 0.04 }, { f: 1175, d: 0.16, type: 'sine', g: 0.03, at: 0.1 }]),
    jackpot: () => tone([{ f: 523 }, { f: 659 }, { f: 784 }, { f: 1047, d: 0.45 }, { f: 1319, d: 0.35, at: 0.36 }, { f: 1568, d: 0.5, at: 0.5, type: 'sine', g: 0.05 }], { gap: 0.09, type: 'square', g: 0.05 }),
    drum: () => tone([{ f: 90, d: 0.12, type: 'sine', g: 0.08 }, { f: 110, d: 0.12, at: 0.14, type: 'sine', g: 0.08 }, { f: 130, d: 0.4, at: 0.28, type: 'triangle', g: 0.06 }]),
    siren: () => tone([{ f: 740, d: 0.16, type: 'sawtooth', g: 0.06 }, { f: 460, d: 0.16, type: 'sawtooth', g: 0.06, at: 0.18 }, { f: 740, d: 0.16, type: 'sawtooth', g: 0.05, at: 0.36 }, { f: 460, d: 0.22, type: 'sawtooth', g: 0.05, at: 0.54 }]),
  };
  bindSfx(sfx);
  let lofi = null;
  function lofiStart() {
    if (!soundOn) return;
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
  const avatarEl = h('div', { class: 'avatar' }, icon('user'));
  const nameEl = h('span');
  const statusDot = h('i', { class: 'live-dot warn' });
  const statusEl = h('span', { text: '연결 중' });
  const peopleEl = h('span', { class: 'tnum', text: '', title: '이 채널에 있는 사람' });
  const profile = h('button', { class: 'profile', type: 'button', 'aria-label': '프로필 편집', onclick: () => openProfile() },
    avatarEl,
    h('div', { class: 'who' }, h('div', { class: 'name' }, nameEl), h('div', { class: 'status' }, statusDot, statusEl, peopleEl)),
  );
  const channelEl = h('span', { class: 'tnum', text: '1채널' });
  const channelCard = h('button', { class: 'channel-card', type: 'button', title: '채널 바꾸기', hidden: true, onclick: () => openChannels() }, channelEl);
  const amtEl = h('span', { class: 'amt tnum', text: '0' });
  const coinIcon = h('div', { class: 'coin-icon', 'aria-hidden': 'true' }, h('img', { src: 'icons/coin.jpg?v=2', alt: '' }));
  const pendingChip = h('span', { class: 'chip gold pulse', hidden: true });
  const sessionChip = h('button', { type: 'button', class: 'chip', title: '오늘 놀이로 번 코인. 누르면 미션', text: `놀이 0/${money(BALANCE.missionEarn)}`, onclick: (e) => { e.stopPropagation(); openToday(); } });
  const protectLine = h('button', { type: 'button', class: 'protect', hidden: true, onclick: (e) => protectGo(e) });
  const nextLine = h('button', { type: 'button', class: 'nextgoal', onclick: (e) => { e.stopPropagation(); goTask(); } });
  const todayBtn = h('button', { class: 'chip', type: 'button', text: '미션', onclick: (e) => { e.stopPropagation(); openToday(); } });
  const holdBtn = h('button', { class: 'chip', type: 'button', text: '내 점령', onclick: (e) => { e.stopPropagation(); openHolds(); } });
  const tribeBtn = h('button', { class: 'chip', type: 'button', text: '소속', onclick: (e) => { e.stopPropagation(); openTribeSheet(); } });
  const walletEl = h('div', { class: 'glass wallet', role: 'button', tabindex: '0', title: '지갑 · 정산 안내', onclick: () => openWalletInfo(), onkeydown: (e) => { if (e.key === 'Enter') openWalletInfo(); } }, coinIcon,
    h('div', null, h('div', null, amtEl, h('span', { class: 'unit', text: 'COIN' })), h('div', { class: 'sub' }, h('span', { class: 'sub-fixed' }, todayBtn, holdBtn, tribeBtn), h('span', { class: 'sub-live' }, sessionChip, pendingChip, protectLine), nextLine)));
  const rankRows = h('div', { class: 'rows' });
  const feedRows = h('div', { class: 'feed' });
  const liveBoard = h('div', { class: 'glass liveboard' },
    h('button', { class: 'livehead', type: 'button', onclick: () => openRanks() }, h('b', null, ...withIcon('trophy', '실시간 순위')), h('span', { text: '이번 주' })),
    rankRows,
    h('button', { class: 'livehead feedhead', type: 'button', onclick: () => openFeed() }, h('b', null, ...withIcon('board', '광장 소식'))),
    feedRows,
  );
  feedRows.append(h('p', { class: 'empty', text: '점령·분양 소식이 여기 남아요' }));
  const guestWarn = h('div', { class: 'guestwarn', hidden: true },
    h('p', { text: '닫으면 코인이 사라질 수 있어요' }),
    h('button', { class: 'btn gold', type: 'button', text: '+300', onclick: (e) => { e.preventDefault(); e.stopPropagation(); openLogin(); } }),
  );
  const nextLineEl = h('p', { class: 'nextline', hidden: true });
  // 밤 9시 banner (main.js setNine, once a second): before 21:00 a tap looks at the main tower, inside the window it opens
  // the claim sheet on a main tower slot. It never opens anything by itself. Hidden for newcomers (index.html).
  let ninePhase = '';
  const nineEl = h('button', { type: 'button', class: 'glass nine', hidden: true, onclick: () => {
    if (ninePhase === 'pre') hooks.focusShot?.('MAIN_TOP');
    else if (ninePhase === 'open') openBillboard(nineSlot(world.billboards), 'tower');
  } });
  root.append(h('div', { class: 'hud-l' }, h('div', { class: 'glass ident' }, profile, channelCard), guestWarn, walletEl, nineEl, nextLineEl, liveBoard));
  const feverText = h('span', { text: '코인 2배 0/20' });
  const feverEl = h('button', { type: 'button', class: 'glass fever', title: '택시 손님을 내리거나 전광판을 점령하면 1칸. 20칸이 되면 1분 동안 코인이 2배이고 택시 부스트가 무제한입니다.', onclick: () => openToday() }, icon('orb'), feverText);
  root.querySelector('.hud-l')?.append(feverEl);

  const soundBtn = h('button', { class: 'btn ghost icon tool-more', type: 'button', 'aria-label': '사운드', title: '사운드', onclick: () => {
    soundOn = !soundOn;
    store('kts_sound', soundOn);
    soundBtn.replaceChildren(icon(soundOn ? 'soundOn' : 'soundOff'));
    if (!soundOn) { cityStop(); lofiStop(); if (dance) endDance(true); return; }
    cityStart();
    if (!loungeEl.hidden) lofiStart();
    sfx.click();
  } }, icon(soundOn ? 'soundOn' : 'soundOff'));
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
  const fsBtn = h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': '전체 화면', title: '전체 화면', onclick: () => {
    if (fsOn()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      const p = exit && exit.call(document);
      if (p && p.catch) p.catch(() => {});
    } else askFullscreen();
  } }, icon('fullscreen'));
  const syncFs = () => { fsBtn.replaceChildren(icon(fsOn() ? 'fullscreenExit' : 'fullscreen')); };
  document.addEventListener('fullscreenchange', () => { syncFs(); if (!fsOn() && dance) endDance(true); });
  document.addEventListener('webkitfullscreenchange', syncFs);
  const mapCanvas = h('canvas', { width: 368, height: 368 });
  const locText = h('span', { text: '맨해튼' });
  const locPill = h('div', { class: 'glass locpill', title: '지금 있는 거리' }, h('i', null, icon('pin')), locText);
  const mapEl = h('button', { class: 'glass minimap', type: 'button', 'aria-label': '뉴욕 지도 크게 보기 (M)', title: '클릭해서 지도 크게 보기 (M)', onclick: () => openMap() }, mapCanvas, h('div', { class: 'tag', text: 'MAP · M' }), h('div', { class: 'zoom' }, icon('expand')));
  fsBtn.classList.add('tool-more');
  // 오늘의 소원: shown to everyone (newcomers and phones too, never behind ⋯). The dot stays while I have no wish today.
  const wishDot = h('i', { class: 'wish-dot', 'aria-hidden': 'true', hidden: true });
  const wishBtn = h('button', { class: 'btn icon tool-wish', type: 'button', 'aria-label': '오늘의 소원', title: '오늘의 소원', onclick: () => openWish({ from: 'hud' }) }, icon('wish'), wishDot);
  // 받은 소식: in the bar only while there is something unread (main.js setInboxDot), on phones too, never in newcomer mode.
  const inboxBtn = h('button', { class: 'btn icon tool-inbox', type: 'button', 'aria-label': '받은 소식', title: '받은 소식', hidden: true, onclick: () => openInboxSheet() }, icon('bell'), h('i', { class: 'inbox-dot', 'aria-hidden': 'true' }));
  root.append(h('div', { class: 'hud-r' },
    h('div', { class: 'bar' },
      h('div', { class: 'glass tools' },
        h('button', { class: 'btn icon', type: 'button', 'aria-label': '전광판 점령', title: '전광판 점령', onclick: () => {
          const slot = firstOpenStarter();
          if (slot && !myBoards().length) openClaimStep(1, claimWizard(slot));
          else openBillboard(slot || 'MAIN_TOP');
        } }, icon('board')),
        wishBtn,
        inboxBtn,
        h('button', { class: 'btn icon tool-more tool-adv', type: 'button', 'aria-label': 'VIP 메뉴', title: 'VIP 메뉴', onclick: () => openVip() }, icon('crown')),
        h('button', { class: 'btn icon tool-more', type: 'button', 'aria-label': '사진 찍어 공유', title: '사진 찍어 공유', onclick: () => openShot() }, icon('camera')),
        h('button', { class: 'btn icon', type: 'button', 'aria-label': '점령 순위', title: '점령 순위', onclick: () => openRanks() }, icon('trophy')),
        h('button', { class: 'btn icon tool-more tool-adv', type: 'button', 'aria-label': '토지 분양', title: '토지 분양', onclick: () => openHub() }, icon('building')),
        soundBtn,
        fsBtn,
        h('button', { class: 'btn ghost icon tool-more', type: 'button', 'aria-label': '설정', title: '설정', onclick: () => openSettings() }, icon('gear')),
        h('button', { class: 'btn icon tool-fold', type: 'button', 'aria-label': '메뉴 더보기', title: '메뉴', onclick: (e) => e.currentTarget.parentElement.classList.toggle('open') }, icon('more')),
      ),
    ),
    mapEl,
    locPill,
  ));

  const newsKick = h('div', { class: 'kick' }, h('b', { text: '속보' }), 'LIVE');
  const newsSmall = h('small');
  const newsText = h('strong');
  const newsEl = h('div', { class: 'glass news', role: 'status' }, newsKick, h('div', { class: 'body' }, newsSmall, newsText));
  newsEl.addEventListener('click', () => { const slot = newsEl.dataset.slot || ''; if (slot) hooks.focusShot?.(slot); });
  root.append(newsEl);

  const coolSvg = (() => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 26 26');
    const bg = document.createElementNS(ns, 'circle');
    Object.entries({ cx: 13, cy: 13, r: 11, fill: 'none', stroke: 'rgba(255,255,255,.12)', 'stroke-width': 3 }).forEach(([k, v]) => bg.setAttribute(k, v));
    const fg = document.createElementNS(ns, 'circle');
    Object.entries({ cx: 13, cy: 13, r: 11, fill: 'none', stroke: '#ffb020', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-dasharray': '69.1', 'stroke-dashoffset': '0' }).forEach(([k, v]) => fg.setAttribute(k, v));
    fg.style.stroke = 'var(--accent, #ffb020)';
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
  // The dock face is a line icon; the emote other players see (bubble over the head) is still e.glyph.
  const EMOTE_ICONS = { 1: 'pray', 2: 'firework', 3: 'cheer', 4: 'dance' };
  for (const [id, e] of Object.entries(EMOTES)) {
    const b = h('button', { class: 'emote', type: 'button', title: `${e.label} (${id})`, onclick: () => { react(Number(id)); } },
      h('span', { class: 'e' }, EMOTE_ICONS[id] ? icon(EMOTE_ICONS[id]) : e.glyph), h('span', { class: 'l', text: e.label }), h('span', { class: 'k', text: id }));
    b.dataset.id = id;
    dock.append(b);
  }
  const moreBtn = h('button', { class: 'emote more', type: 'button', title: '리액션 이모지 (5)', 'aria-expanded': 'false', onclick: () => toggleReacts() },
    h('span', { class: 'e' }, icon('smile')), h('span', { class: 'l', text: '리액션' }), h('span', { class: 'k', text: '5' }));
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
    h('span', null, h('kbd', { text: 'M' })), h('span', null, '뉴욕 지도 · ', icon('bolt'), ' 순간이동'),
    h('span', null, h('kbd', { text: '1-4' })), h('span', { text: '감정 표현' }),
  );
  if (!coarse) {
    root.append(help);
    const tools = root.querySelector('.tools');
    const keyBtn = h('button', { class: 'btn ghost icon tool-desk', type: 'button', 'aria-label': '조작 안내', title: '조작 안내', onclick: () => help.classList.toggle('fade') }, icon('keyboard'));
    const fold = tools?.querySelector('.tool-fold');
    if (fold) tools.insertBefore(keyBtn, fold);
    else tools?.append(keyBtn);
  }
  setTimeout(() => help.classList.add('fade'), 16000);

  // taxi HUD + waypoint pill
  const spdEl = h('b', { class: 'tnum', text: '0' });
  const fareEl = h('b', { class: 'tnum', text: '0' });
  const jobArrow = h('i', { class: 'arrow' }, icon('navigate'));
  const jobTitle = h('small', { text: '손님 찾는 중' });
  const jobDist = h('b', { class: 'tnum', text: '-' });
  const jobTime = h('span', { class: 'time tnum' });
  const jobEl = h('div', { class: 'job' }, jobArrow, h('div', null, jobTitle, jobDist), jobTime);
  const trainEl = h('div', { class: 'keys', hidden: true });
  const taxiHud = h('div', { class: 'glass taxihud', hidden: true },
    h('div', { class: 'spd' }, spdEl, h('span', { text: 'km/h' })),
    h('div', { class: 'meter' }, h('small', { text: '승객' }), fareEl),
    jobEl,
    trainEl,
    h('div', { class: 'keys' }, ...(coarse ? ['조이스틱 ↑↓ 가속·후진 · ←→ 핸들 · ', icon('bolt'), ' 부스트 · 하차 버튼'] : ['W/S 가속·브레이크 · A/D 핸들 · Shift 부스트 · Space 경적 · E 하차'])),
  );
  root.append(taxiHud);
  const sponsorTitle = h('h3');
  const sponsorBody = h('p');
  const sponsorPay = h('b', { class: 'gold' });
  let phraseSlot = '';
  const phraseRow = h('div', { class: 'chips' }, ...CHEER_PHRASES.map((text, i) => h('button', {
    type: 'button',
    text,
    onclick: () => { if (phraseSlot) hooks.cheer?.(phraseSlot, i + 1); },
  })));
  const sponsorLink = h('button', { class: 'btn ghost link', type: 'button', text: '작성자 링크' });
  const sponsorActs = h('div', { class: 'row' }, sponsorLink);
  const sponsorEl = h('div', { class: 'glass sponsor', hidden: true }, sponsorTitle, sponsorBody, phraseRow, sponsorPay, sponsorActs);
  root.append(sponsorEl);
  let sponsorTimer = 0;
  function hideSponsor() { sponsorEl.hidden = true; document.body.classList.remove('has-sponsor'); clearTimeout(sponsorTimer); }
  function showSponsor(ev) {
    const b = ev.board || {};
    const lines = [b.line1, b.line2, b.line3].map((t) => String(t || '').trim()).filter(Boolean);
    if (b.holder_name) setIconText(sponsorTitle, 'crown', `소원 주인 · ${b.holder_name}`);
    else setIconText(sponsorTitle, '', '빈 전광판 앞 도착');
    sponsorBody.textContent = lines.join(' · ') || '이 자리를 점령하세요';
    sponsorPay.hidden = ev.type !== 'done' || ev.sent === false;
    sponsorPay.textContent = ev.type === 'done' && ev.sent !== false ? '운임은 확인되면 지갑에 들어와요' : '';
    const url = allowedLink(b.external_url) || '';
    const until = b.lit_until || b.expires_at;
    const exp = until ? new Date(until).getTime() : 0;
    const live = !!b.holder_id && exp > Date.now();
    const mine = live && b.holder_id === hooks.actorId?.();
    phraseSlot = ev.slot && live && !mine ? ev.slot : '';
    phraseRow.hidden = !phraseSlot;
    sponsorLink.hidden = !url;
    sponsorLink.onclick = () => { if (url) hooks.adClick?.(ev.slot, url); };
    sponsorEl.hidden = false;
    document.body.classList.add('has-sponsor');
    clearTimeout(sponsorTimer);
    sponsorTimer = setTimeout(hideSponsor, phraseSlot || url || ev.type === 'done' ? 12000 : 4200);
  }
  const wayArrow = h('i', { class: 'arrow' }, icon('navigate'));
  const wayText = h('span', { class: 'tnum' });
  const wayPill = h('button', { class: 'glass waypill', type: 'button', hidden: true, title: '목적지 지우기', onclick: () => hooks.setWaypoint(null) }, icon('pin'), wayArrow, wayText, h('small', null, icon('close')));
  root.append(wayPill);

  const toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
  document.body.append(toasts);

  const needle = h('div', { class: 'needle' });
  const bakeHint = h('span', { class: 'hint', text: coarse ? '버튼을 눌러 굽기를 멈추세요' : 'Space · Enter · 클릭으로 멈추기' });
  const bakeEl = h('div', { class: 'glass bake', role: 'dialog', 'aria-hidden': 'true', 'aria-label': '붕어빵 굽기' },
    h('header', null, h('h3', null, ...withIcon('fish', '황금 붕어빵 굽기')), h('span', { text: '초록 +6 · 금색 정중앙 +16' })),
    h('div', { class: 'gauge' },
      h('span', { class: 'lbl side', style: { left: '42.5%' }, text: 'GOOD' }),
      h('span', { class: 'lbl', style: { left: '50%', color: 'var(--on-accent, #1c1300)' }, text: 'GOLD' }),
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
  const rhythmEl = h('div', { class: 'glass rhythm', role: 'dialog', 'aria-hidden': 'true', 'aria-label': 'K-POP 댄스 챌린지' },
    h('header', null, h('h3', null, ...withIcon('music', 'K-POP 댄스 챌린지')), h('div', { class: 'acc' }, rhythmCombo, rhythmScore, h('button', { class: 'x', type: 'button', text: '그만두기', onclick: () => endDance(true) }))),
    rhythmCanvas,
    coarse ? lanePads : h('p', { class: 'hint', text: '쉬움 · 55% 미만 +2 · 55% +4 · 75% +8 · 90% +12 · ←↓↑→ 또는 D F J K' }),
  );
  root.append(rhythmEl);

  // touch controls
  const knob = h('div', { class: 'knob' });
  const joy = h('div', { class: 'joy', 'aria-hidden': 'true' }, knob);
  const tap = (fn) => (ev) => { ev.preventDefault(); ev.stopPropagation(); fn(); };
  const actBtn = h('button', { class: 'act big', type: 'button', hidden: true, onpointerdown: tap(() => hooks.interact()) });
  const boostBtn = h('button', { class: 'act boost', type: 'button', hidden: true, 'aria-label': '부스트' }, icon('bolt'));
  boostBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); hooks.boost?.(true); });
  const boostOff = () => hooks.boost?.(false);
  boostBtn.addEventListener('pointerup', boostOff);
  boostBtn.addEventListener('pointercancel', boostOff);
  boostBtn.addEventListener('pointerleave', boostOff);
  const jumpBtn = h('button', { class: 'glass act jump', type: 'button', 'aria-label': '점프', onpointerdown: tap(() => hooks.jump()) }, icon('arrowUp'));
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
    const earned = Math.max(0, Math.floor(Number(today().earn) || 0));
    const goal = `놀이 ${money(earned)}/${money(BALANCE.missionEarn)}`;
    if (sessionChip.textContent !== goal) sessionChip.textContent = goal;
    const left = soonestProtect();
    const held = myBoards();
    const lit = held.filter(boardActive).length;
    if (lit && left > 0) {
      const text = fmtProtect(left);
      protectLine.hidden = false;
      if (protectLine.textContent !== text) protectLine.textContent = text;
    } else if (lit) {
      protectLine.hidden = false;
      if (protectLine.textContent !== '보호 끝 · 빼앗길 수 있어요') protectLine.textContent = '보호 끝 · 빼앗길 수 있어요';
    } else if (held.length) {
      protectLine.hidden = false;
      if (protectLine.textContent !== '불 꺼짐 · 다시 켤 수 있어요') protectLine.textContent = '불 꺼짐 · 다시 켤 수 있어요';
    } else if (!protectLine.hidden) {
      protectLine.hidden = true;
      protectLine.textContent = '';
    }
    syncNewbie();
    const goalText = nextGoal().text;
    if (newbieOn) {
      const task = newcomerTask()?.text || '';
      if (nextLine.dataset.task !== task) {
        nextLine.dataset.task = task;
        nextLine.replaceChildren(h('small', { text: '지금 할 일' }), h('span', { text: task }), h('i', { 'aria-hidden': 'true' }, icon('chevronRight')));
      }
    } else if (nextLine.dataset.task || nextLine.textContent !== goalText) {
      delete nextLine.dataset.task;
      nextLine.textContent = goalText;
    }
  }
  // Newcomer card: the first of NEWCOMER_STEPS that returns { text, go } wins. Put a new step in front to take over the card.
  // Order: today's wish (until posted, or the sheet was closed once) → tutorial line (until the first claim) → next goal.
  const NEWCOMER_STEPS = [
    () => { const text = wishStep({ known: wishView.known, mine: !!wishView.mine, skipped: wishSkipped, busy: wishView.busy }); return text ? { text, go: () => openWish({ from: 'card' }) } : null; },
    () => (tutorialOn && tutorialLine ? { text: tutorialLine, go: tutorialGo } : null),
    () => ({ text: nextGoal().text.replace(/^다음 목표: /, ''), go: nextGoalGo }),
  ];
  function newcomerTask() { return firstStep(NEWCOMER_STEPS); }
  function goTask() {
    if (newbieOn) (newcomerTask()?.go || nextGoalGo)();
    else nextGoalGo();
  }
  // The tutorial's own step: bake when at the cart, put back a waypoint the pill tap cleared, point at the pill, else the next goal.
  function tutorialGo() {
    const act = tutorialTap({ atCart: near?.kind === 'cart' && !baking && !sheet, waypoint, tutorialWp });
    if (act === 'bake') { startBake(); return; }
    if (act === 'waypoint') { hooks.setWaypoint?.(tutorialWp); return; }
    if (act === 'goal') { nextGoalGo(); return; }
    wayPill.classList.remove('nudge');
    void wayPill.offsetWidth;
    wayPill.classList.add('nudge');
  }
  function setTutorialWaypoint(p) {
    tutorialWp = p && Number.isFinite(p.x) && Number.isFinite(p.z) ? { x: p.x, z: p.z } : null;
    if (tutorialOn && tutorialBaked && tutorialWp) tutorialWalk = true;
  }
  function setTutorial(ev) {
    if (ev === 'bakePay') tutorialBaked = true;
    const on = tutorialNext(tutorialOn, ev);
    if (on === tutorialOn) return;
    tutorialOn = on;
    if (!on) {
      // A .nextline that still shows the tutorial text (copied there on graduation) goes with it.
      if (tutorialLine && nextLineEl.textContent === tutorialLine) setNextLine('');
      tutorialLine = '';
      tutorialWp = null;
      tutorialWalk = false;
    }
    renderGoal();
  }
  function setTutorialLine(text) {
    tutorialLine = String(text || '');
    if (newbieOn) renderGoal();
    else setNextLine(tutorialLine);
  }
  function syncNewbie() {
    if (!newbieReady) return;
    const held = myBoards().length;
    if (!grad && graduation({ grad, held, earn: today().earn })) { grad = true; store('kts_grad', 1); }
    if (!grad && !newcomerKnown({ plazaReady, actor: hooks.actorId?.() })) return;
    const on = newcomer({ grad, held });
    if (on === newbieOn) return;
    const was = newbieOn;
    newbieOn = on;
    root.classList.toggle('newbie', on);
    nextLine.classList.toggle('task', on);
    if (on) walletEl.before(nextLine);
    else walletEl.querySelector('.sub')?.append(nextLine);
    if (was && !on) {
      starterToastShown = true;
      root.classList.add('reveal');
      setTimeout(() => root.classList.remove('reveal'), 1600);
      setTutorial('grad');
    }
    renderGoal();
  }
  function graduate() {
    if (grad) return;
    grad = true;
    store('kts_grad', 1);
    syncNewbie();
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
    if (accountView.linked) nameEl.append(h('i', { class: 'verified', title: '인증 계정' }, icon('check')));
    avatarEl.style.setProperty('--me', hooks.color());
    avatarEl.textContent = (SPECIES.find((s) => s.id === hooks.species()) || SPECIES[0]).glyph;
  }
  function renderAccount() {
    guestWarn.hidden = !(accountView.ready && accountView.guest && !accountView.linked);
    renderProfile();
  }
  function renderStatus() {
    const ok = statusKind === 'ok';
    statusEl.hidden = ok;
    statusEl.textContent = ok ? '' : statusText;
    peopleEl.hidden = !ok || !peopleEl.textContent;
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
  function pushNews(kicker, text, sound = true, slot = '') {
    newsQueue.push({ kicker, text, sound, slot: String(slot || '') });
    if (newsQueue.length > 6) newsQueue.shift();
    pumpNews();
  }
  function pumpNews() {
    if (newsBusy || !newsQueue.length) return;
    newsBusy = true;
    const item = newsQueue.shift();
    const slot = item.slot;
    const line = h(slot ? 'button' : 'div', { class: 'f', type: slot ? 'button' : null, onclick: slot ? () => hooks.focusShot?.(slot) : null });
    if (slot) line.dataset.slot = slot;
    for (const part of item.text) line.append(part?.nodeType ? part.cloneNode(true) : document.createTextNode(String(part ?? '')));
    for (const n of [...feedRows.querySelectorAll('.empty')]) n.remove();
    feedRows.prepend(line);
    while (feedRows.children.length > 4) feedRows.lastChild.remove();
    newsSmall.textContent = item.kicker;
    newsText.replaceChildren(...item.text);
    newsEl.dataset.slot = slot;
    newsEl.classList.toggle('go', !!slot);
    newsEl.classList.add('show');
    if (item.sound) sfx.news();
    setTimeout(() => {
      newsEl.classList.remove('show', 'go');
      newsEl.dataset.slot = '';
      setTimeout(() => { newsBusy = false; pumpNews(); }, 600);
    }, 4400);
  }
  function cooldownLeft() { return Math.max(0, coolUntil - performance.now()); }
  function armCooldown() { coolUntil = performance.now() + COOLDOWN; }
  setInterval(() => { if (near && (near.kind === 'crowd' || near.kind === 'cart')) renderPrompt(); }, 400);
  const PROMPTS = {
    crowd: ['같이 함성', '옆에 사람이 있어야 해요', '함성'],
    cart: ['붕어빵 굽기', 'Space 또는 E · 포차 앞에 서면 열려요', '굽기!'],
    atm: ['황금 ATM 열기', '전광판 · 토지 거래', 'ATM'],
    stage: ['댄스 시작', 'Space 또는 E · 이모지 4번은 게임이 아니에요', '댄스!'],
    taxi: ['정차한 택시 탑승', '지나가는 택시는 타지 않아요', '탑승'],
    stand: ['택시 호출', '오면 그 자리에서 탑승', '호출'],
    fountain: ['포춘쿠키 뽑기', '빨간 계단 앞 분수', '뽑기'],
    ring: ['황금 링 통과', '링 안으로 걸어 들어가면 +8', '통과'],
    lounge: ['빨간 계단에서 멍때리기', '켜 두면 20초마다 +2', '관람'],
  };
  let focusOn = false;
  function renderPrompt() {
    const show = !!near && !baking && !sheet && !dance && !driving && !focusOn;
    promptEl.classList.toggle('show', show);
    actBtn.hidden = driving ? false : !(show && coarse);
    if (driving) { actBtn.textContent = '하차'; return; }
    if (!near) return;
    const left = cooldownLeft();
    const p = near.kind === 'crowd'
      ? (near.n
        ? [`같이 함성 · 옆 ${near.n}명`, left > 0 ? `다음 함성까지 ${(left / 1000).toFixed(0)}초` : '옆 사람과 같이', '함성']
        : ['함성', left > 0 ? `다음 함성까지 ${(left / 1000).toFixed(0)}초` : '코인은 전광판 응원에서 들어와요', '함성'])
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
    baking = { pos: Math.random() * 0.2, dir: 1, speed: 0.42 + Math.random() * 0.12 };
    hooks.beginBake?.();
    bakeEl.classList.add('show');
    bakeEl.setAttribute('aria-hidden', 'false');
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
    bakeEl.setAttribute('aria-hidden', 'true');
    hooks.lockInput(false);
    renderPrompt();
    if (awayWant) setTimeout(pumpQueued, 1500);
    if (cancel) return;
    let amount = 0;
    if (p >= 0.47 && p <= 0.53) amount = BALANCE.bakeGold;
    else if (p >= 0.38 && p <= 0.62) amount = BALANCE.bakeGood;
    if (!amount) { armCooldown(); sfx.miss(); showResult('MISS', '앗, 붕어빵이 타버렸어요…', true); missionBump('bake'); note('다음 판', 'ok', () => startBake()); return; }
    const result = amount >= 15 ? 'gold' : 'good';
    missionBump('bake');
    if (amount >= 15) { sfx.crit(); showResult('PERFECT!', '황금 붕어빵'); }
    else { sfx.hit(); showResult('GOOD!', '바삭한 붕어빵'); }
    hooks.finishBake?.(result);
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
    rhythmEl.setAttribute('aria-hidden', 'false');
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
    rhythmEl.setAttribute('aria-hidden', 'true');
    hooks.lockInput(false);
    danceCool = performance.now() + 2500;
    renderPrompt();
    if (awayWant) setTimeout(pumpQueued, 1500);
    if (cancel) { hooks.danceEnd?.(null); return; }
    const acc = d.score / (d.notes.length * 100);
    const pct = Math.round(acc * 100);
    hooks.danceEnd?.(pct);
    sfx.crit();
    showResult(acc >= 0.9 ? 'ALL KILL!' : acc >= 0.75 ? 'GREAT!' : 'NICE!', `정확도 ${pct}% · 최대 ${d.max}콤보`);
    note('한 곡 더', 'ok', () => startDance());
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
    if (pushQueued || awayWant) setTimeout(pumpQueued, 0);
  }
  // title: the plain text, or [iconName, text] for a title with a line icon in front.
  function openSheet(titleIn, badge, build, narrow, variant) {
    const [titleIcon, title] = Array.isArray(titleIn) ? titleIn : ['', titleIn];
    if (quietBlock && (title === '미션' || title === '계정 연결' || String(title || '').includes('알림'))) return;
    const nested = !!sheet;
    replacingSheet = true;
    closeSheet(true);
    replacingSheet = false;
    const content = h('div', { class: 'content' });
    const x = h('button', { class: 'x', type: 'button', 'aria-label': '닫기', onclick: closeSheet }, icon('close'));
    const box = h('div', { class: `glass sheet${narrow ? ' narrow' : ''}${variant ? ' ' + variant : ''}`, role: 'dialog', 'aria-label': title },
      h('header', null, h('h2', null, ...withIcon(titleIcon, title), badge ? h('span', { class: 'badge', text: badge }) : null), x), content);
    const el = h('div', { class: 'modal', onclick: (e) => { if (e.target === el) closeSheet(); } }, box);
    document.body.append(el);
    sheet = { el, cleanup: null, title };
    hooks.lockInput(true);
    renderPrompt();
    const rawAppend = content.append.bind(content);
    content.append = (...nodes) => rawAppend(...nodes.filter((n) => n != null && n !== false));
    sheet.cleanup = build(content) || null;
    if (!nested) history.pushState({ ...(history.state || {}), ktsSheet: 1 }, '');
    sfx.click();
  }
  addEventListener('popstate', () => {
    if (sheet) closeSheet(true);
    else if (!proof.hidden) dismissProof(true);
  });
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
  // ctx.slot: the board just claimed (proof bar). Otherwise the board the camera is on, if it is mine. The server keeps the
  // context only for that board's holder; the shared link is always the preview page (`page`), never the raw JPEG.
  async function openShot(ctx = {}) {
    if (shotBusy) return;
    shotBusy = true;
    try {
    const focused = String(hooks.focusedSlot?.() || '');
    const own = focused && boardById(focused)?.holder_id && boardById(focused).holder_id === hooks.actorId?.() ? focused : '';
    const slot = String(ctx.slot || '') || own;
    const blob = await countShot();
    if (!blob) { note('지금 화면을 담지 못했어요', 'err'); return; }
    const url = URL.createObjectURL(blob);
    const file = new File([blob], 'wishboard.jpg', { type: 'image/jpeg' });
    let page = '';
    // A hanging upload gives up after 15 s and lands in the failure branch below.
    const published = Promise.race([
      Promise.resolve(hooks.publishShot?.(blob, slot ? { slot } : undefined)),
      new Promise((r) => setTimeout(() => r(null), 15000)),
    ])
      .then((r) => { page = typeof r?.page === 'string' && /^https?:\/\//.test(r.page) ? r.page : ''; return page; })
      .catch(() => '');
    openSheet(['camera', '타임스퀘어 사진'], null, (host) => {
      const save = h('button', { class: 'btn ghost', type: 'button', text: '이미지 저장', onclick: () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'wishboard.jpg';
        a.click();
        askShot();
      } });
      const status = h('p', { class: 'note', text: '공유 링크를 만드는 중…' });
      const copyBox = h('div', { class: 'manual-copy', hidden: true });
      const copy = h('button', { class: 'btn ghost', type: 'button', text: '공유 링크 복사', disabled: true, onclick: async () => {
        if (!page || shareBusy) return;
        const how = await sendLink({ kind: 'shot', text: SHARE_TEXT, url: page, into: copyBox });
        if (how === 'copied') { note('공유 링크를 복사했어요', 'ok'); askShot(); }
      } });
      const share = h('button', { class: 'btn gold', type: 'button', text: '공유하기', disabled: true, onclick: async () => {
        if (!page || shareBusy) return;
        const payload = { title: 'WISH BOARD : 모두의 전광판', text: SHARE_TEXT, url: invited(page, hooks.inviteCode?.()) };
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
          shareBusy = true;
          try {
            await navigator.share({ ...payload, files: [file] });
            trackEvent('share_link', { kind: 'shot', how: 'native' });
            askShot();
            return;
          } catch (err) { if (err?.name === 'AbortError') return; }
          finally { shareBusy = false; }
        }
        const how = await sendLink({ kind: 'shot', native: true, title: payload.title, text: SHARE_TEXT, url: page, into: copyBox });
        if (how === 'copied') note('공유 링크를 복사했어요', 'ok');
        if (how === 'shared' || how === 'copied') askShot();
      } });
      const kakao = kakaoButton(async () => {
        if (!page || shareBusy) return;
        const words = { kind: 'shot', title: 'WISH BOARD : 모두의 전광판', text: SHARE_TEXT, url: page };
        const how = (await sendKakao(words)) || (await sendLink({ ...words, native: true, into: copyBox }));
        if (how === 'busy') return;
        if (how === 'copied') note('공유 링크를 복사했어요', 'ok');
        if (how === 'kakao' || how === 'shared' || how === 'copied') askShot();
      }, { disabled: true });
      const row = h('div', { class: 'shot-row' }, save, copy, share, kakao);
      host.append(
        h('img', { class: 'shot-preview', src: url, alt: '타임스퀘어 스냅샷' }),
        status,
        row,
        copyBox,
      );
      published.then((link) => {
        if (!status.isConnected) return;
        if (link) {
          status.textContent = '링크를 열면 이 사진이 미리 보이고, 누르면 바로 광장으로 들어와요.';
          copy.disabled = false;
          share.disabled = false;
          kakao.disabled = false;
          return;
        }
        // No link: say so and keep only the save button, so nothing dead or raw gets copied.
        status.textContent = '공유 링크를 만들지 못했어요. 이미지를 저장해서 보내 주세요.';
        status.classList.add('err');
        copy.remove();
        share.remove();
        kakao.remove();
      });
      return () => URL.revokeObjectURL(url);
    }, true);
    } finally { shotBusy = false; }
  }
  // Every link the player hands out goes here: share sheet (when native) → clipboard → the link in a box to copy by hand.
  // Returns shareWish's answer: 'shared' | 'copied' | 'manual' | 'cancel', or 'busy' while another share is still open
  // (a second tap during an open share sheet must not fall through to the clipboard or pay twice).
  let shareBusy = false;
  async function sendLink({ kind, text = '', url = '', title = 'WISH BOARD : 모두의 전광판', native = false, into = null }) {
    if (shareBusy) return 'busy';
    shareBusy = true;
    url = invited(url, hooks.inviteCode?.()); // every link is also my invite
    let how;
    try { how = await shareWish({ nav: native ? navigator : null, clip: writeClip, data: { title, text, url } }); }
    finally { shareBusy = false; }
    if (how === 'cancel') return how;
    trackEvent('share_link', { kind, how: how === 'shared' ? 'native' : how === 'copied' ? 'copy' : 'manual' });
    if (how === 'manual') showManual(url || text, into);
    return how;
  }
  // 카카오톡으로 보내기: the button exists only when GET /rt/config carries a Kakao key. 'kakao' when the SDK took the share, '' on any failure
  // (the caller then uses sendLink, so a blocked SDK looks like an ordinary link share).
  async function sendKakao({ kind, title, text, url }) {
    if (shareBusy) return 'busy';
    shareBusy = true;
    let ok = false;
    try { ok = await kakaoSend(await kakaoKey(), kakaoFeed({ title, text, url: invited(url, hooks.inviteCode?.()), origin: location.origin })); } catch { ok = false; } // the cached code only: no wait here
    finally { shareBusy = false; }
    if (ok) trackEvent('share_link', { kind, how: 'kakao' });
    return ok ? 'kakao' : '';
  }
  const kakaoKey = () => Promise.resolve(hooks.kakaoKey?.() || '').catch(() => ''); // the key net.js kept from /rt/config: no request of its own
  function kakaoButton(onTap, { disabled = false } = {}) {
    const b = h('button', { class: 'btn ghost kakao', type: 'button', text: '카카오톡으로 보내기', hidden: true, disabled, onclick: () => onTap(b) });
    kakaoKey().then((k) => { if (k) { b.hidden = false; loadKakao(k).catch(() => {}); } }).catch(() => {});
    return b;
  }
  // The manual-copy fallback: a read-only, selected input. Inside `into` when given (and still on screen), else a small sheet.
  function manualCopy(value) {
    const out = h('input', { class: 'input', readOnly: true, value: String(value || ''), 'aria-label': '복사할 링크' });
    const pick = () => { try { out.focus(); out.select(); out.setSelectionRange(0, out.value.length); } catch { /* the box still shows the link */ } };
    out.addEventListener('focus', () => { try { out.select(); out.setSelectionRange(0, out.value.length); } catch { /* nothing */ } });
    return { nodes: [out, h('p', { class: 'note', text: '길게 눌러 복사하세요' })], pick };
  }
  function showManual(value, into) {
    const m = manualCopy(value);
    if (into?.isConnected) {
      into.replaceChildren(...m.nodes);
      into.hidden = false;
      m.pick();
      return;
    }
    openSheet('링크 복사', null, (host) => {
      host.append(h('div', { class: 'manual-copy' }, ...m.nodes));
      setTimeout(m.pick, 30);
    }, true);
  }
  const boardById = (id) => world.billboards.find(b => b.slot_id === id) || null;
  function boardActive(b) {
    if (!b?.holder_id) return false;
    const until = b.lit_until || b.expires_at;
    const exp = until ? new Date(until).getTime() : 0;
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
    return world.billboards.filter((b) => b.holder_id === me);
  }
  function nextGoal() {
    const have = wallet.confirmed + wallet.pending;
    const held = myBoards();
    const liveHeld = held.filter(boardActive);
    if (!liveHeld.length && held.length) return { text: '다음 목표: 불 꺼진 칸을 다시 켜세요', slot: held[0].slot_id, relight: true };
    const has = (prefix) => liveHeld.some((b) => String(b.slot_id).startsWith(prefix));
    let slot = 'PLOT_1';
    let price = floorOf('PLOT_1');
    let name = '분양 전광판';
    if (!liveHeld.length && firstOpenStarter()) { slot = firstOpenStarter(); price = 0; name = '무료 거리 칸'; }
    else if (has('PLOT_') && !has('STREET_') && !has('SUB_') && !has('MAIN_')) { slot = 'STREET_1'; price = floorOf('STREET_1'); name = '메인거리'; }
    else if ((has('STREET_') || has('PLOT_')) && !has('SUB_') && !has('MAIN_')) { slot = 'SUB_1B'; price = floorOf('SUB_1B'); name = '코너 전광판'; }
    else if (has('SUB_') || has('MAIN_')) { slot = 'MAIN_LOW'; price = floorOf('MAIN_LOW'); name = '메인 타워'; }
    const left = Math.max(0, price - have);
    return { text: left ? `다음 목표: ${name}까지 ${money(left)}코인` : `다음 목표: ${name}에 이름을 올리세요`, slot, free: price === 0, name, left };
  }
  function protectGo(e) {
    e.stopPropagation();
    const held = myBoards();
    const live = held.filter(boardActive);
    let slot = held[0]?.slot_id || '';
    if (live.length) {
      let best = null;
      let bestLeft = 0;
      for (const b of live) {
        const left = protectedLeft(b);
        if (left > 0 && (!best || left < bestLeft)) { best = b; bestLeft = left; }
      }
      slot = (best || live[0]).slot_id;
    }
    if (slot) openBillboard(slot);
  }
  function nextGoalGo() {
    const g = nextGoal();
    if (g.relight || !g.free) { openBillboard(g.slot); return; }
    openClaimStep(1, claimWizard(g.slot));
  }
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
      fare: fresh ? 0 : (prev.fare || 0),
      stunt: fresh ? 0 : (prev.stunt || 0),
      paid: fresh ? {} : (prev.paid || {}),
      qPaid: fresh ? {} : (prev.qPaid || {}),
      streak: prev.streak || 0,
      last: prev.last || '',
      ...backFields(prev, day), // back: days since the last attended day on a later day; backSent: return_visit already went out today
      score: prev.week === week ? (prev.score || 0) : 0,
      play: prev.week === week ? (Number.isFinite(Number(prev.play)) ? Number(prev.play) : (Number(prev.earn) || 0)) : 0,
    };
    return dayState;
  }
  const today = () => (dayState && dayState.day === kstDay() ? dayState : loadDay());
  function saveDay(d) { dayState = d; store('kts_daily', d); }
  function missionBump(key, n = 1) {
    const d = today();
    d[key] = (d[key] || 0) + n;
    if (key === 'earn') d.play = (Number(d.play) || 0) + n;
    saveDay(d);
  }
  function attend() {
    const d = today();
    const gap = returnGap(d, recall('kts_daily', {}), d.day); // read before saveDay below: another tab may already have sent today's return_visit
    if (d.last !== d.day) {
      const prev = kstDay(Date.now() - 864e5);
      d.streak = d.last === prev ? (d.streak || 0) + 1 : 1;
      d.last = d.day;
      saveDay(d);
    }
    if (d.streak > 0) todayBtn.textContent = `미션 · ${d.streak}일`;
    if (d.back > 0 && !d.backSent) { d.backSent = 1; saveDay(d); if (gap) trackEvent('return_visit', { gap }); } // once per KST day across tabs, only for a browser that attended on an earlier day
  }
  // Attendance and finished missions pay over the room socket. A reward is marked paid only once its send went out,
  // so one that came due before the room was joined stays due and goes out later. One payout per call, 3 s apart.
  const MISSION_NEED = { earn: BALANCE.missionEarn, bake: 1, cheer: 1 };
  let dueAt = 0, attendTries = 0, missionWait = '', missionTries = 0;
  function payDue() {
    if (!entered || performance.now() < dueAt) return;
    const d = today();
    const paid = d.paid || (d.paid = {});
    if (missionWait) {
      if (missionTries >= 3) {
        paid[missionWait] = 1;
        missionWait = '';
        saveDay(d);
        note('이 미션 보상은 오늘 이미 받았거나, 지금 광장에 연결되지 않았어요', 'err');
      } else missionWait = '';
      dueAt = performance.now() + 3000;
      return;
    }
    if (d.last === d.day && !paid.attend && attendTries < 3) {
      const coins = BALANCE.attend[Math.min((d.streak || 1) - 1, BALANCE.attend.length - 1)];
      if (!hooks.bonus?.('attend', coins)) return;
      attendTries += 1;
      dueAt = performance.now() + 8000;
      return;
    }
    const key = Object.keys(MISSION_NEED).find((k) => !paid[k] && (d[k] || 0) >= MISSION_NEED[k]);
    if (!key || !hooks.bonus?.('mission', BALANCE.missionReward)) return;
    missionWait = key;
    missionTries += 1;
    dueAt = performance.now() + 8000;
  }
  function markDaily(amount) {
    const d = today();
    const key = missionWait;
    missionWait = '';
    missionTries = 0;
    if (!key) return;
    d.paid = d.paid || {};
    d.paid[key] = 1;
    d.score = (d.score || 0) + BALANCE.season.mission;
    saveDay(d);
    note(`오늘 미션 +${Math.max(0, Math.floor(Number(amount) || 0))}`, 'ok');
  }
  function attendWeek(streak) {
    const n = Math.max(0, Math.floor(Number(streak) || 0));
    const filled = n <= 0 ? 0 : ((n - 1) % 7) + 1;
    const row = h('div', { class: 'attend-week' });
    for (let i = 1; i <= 7; i++) row.append(h('span', { class: 'attend-day' + (i <= filled ? ' on' : ''), text: String(i) }));
    return row;
  }
  function askShot() {
    queuePushOffer();
    const d = today();
    if (d.paid?.shot) return;
    hooks.bonus?.('shot', BALANCE.shareShot);
  }
  function noteShot() {
    const d = today();
    d.paid = d.paid || {};
    d.paid.shot = 1;
    saveDay(d);
  }
  function noteServerAttend(streak, last) {
    const d = today();
    const n = Math.floor(Number(streak));
    const day = String(last || '').slice(0, 10);
    if (!Number.isInteger(n) || n < 1 || day !== d.day) return;
    d.streak = n;
    d.last = d.day;
    d.paid = d.paid || {};
    d.paid.attend = 1;
    saveDay(d);
    todayBtn.textContent = `미션 · ${n}일`;
  }
  function noteAttend(streak) {
    const d = today();
    const n = Math.floor(Number(streak));
    if (!Number.isInteger(n) || n < 1) return;
    d.streak = n;
    d.last = d.day;
    d.paid = d.paid || {};
    d.paid.attend = 1;
    saveDay(d);
    todayBtn.textContent = `미션 · ${n}일`;
  }
  const RINGS = [{ x: 16, z: 52 }, { x: 16, z: 90 }];
  function nearestSpot(list) {
    const me = hooks.minimap?.()?.me;
    let best = list[0], dist = Infinity;
    for (const p of list) {
      const d = me ? (p.x - me.x) ** 2 + (p.z - me.z) ** 2 : 0;
      if (d < dist) { dist = d; best = p; }
    }
    return best;
  }
  function guideQuest(key) {
    if (key === 'bake') {
      hooks.setWaypoint?.({ x: LAYOUT.stall.x, z: LAYOUT.stall.z + 4.4 });
      note('붕어빵 포차 길안내를 시작해요', 'ok');
      return;
    }
    if (key === 'fare') {
      const s = nearestSpot(TAXI_STANDS);
      hooks.setWaypoint?.({ x: s.x, z: s.z });
      note(`${s.name} 승강장 길안내를 시작해요`, 'ok');
      return;
    }
    if (key === 'stunt') {
      const s = nearestSpot(RINGS);
      hooks.setWaypoint?.({ x: s.x, z: s.z - 4 });
      note('황금 링 길안내를 시작해요. 노란 기둥 안으로 걸어 들어가면 +8', 'ok');
      return;
    }
    if (key !== 'cheer') return;
    const rows = (world.billboards || []).filter(boardActive);
    const pool = rows.length ? rows : (world.billboards || []);
    const me = hooks.minimap?.()?.me;
    let best = null, dist = Infinity;
    for (const b of pool) {
      const card = hooks.slotCard?.(b.slot_id);
      if (!Number.isFinite(card?.x) || !Number.isFinite(card?.z)) continue;
      const d = me ? (card.x - me.x) ** 2 + (card.z - me.z) ** 2 : 0;
      if (d < dist) { dist = d; best = { x: card.x, z: card.z }; }
    }
    if (!best) { note('길안내할 전광판이 없어요', 'err'); return; }
    hooks.setWaypoint?.(best);
    note('전광판 길안내를 시작해요. 가까이서 응원하면 받아요', 'ok');
  }
  function openToday() {
    if (quietBlock) return;
    const d = today();
    const row = (done, text) => h('p', { class: 'note' }, ...withIcon(done ? 'checkCircle' : 'todo', text));
    const go = (key, done, text) => h('button', { type: 'button', class: 'note', onclick: () => { closeSheet(); guideQuest(key); } }, ...withIcon(done ? 'checkCircle' : 'todo', text));
    const tomorrow = BALANCE.attend[Math.min(d.streak, BALANCE.attend.length - 1)];
    openSheet('미션', '매일 0시', (host) => {
      host.append(attendWeek(d.streak || 0));
    host.append(
        row(d.earn >= BALANCE.missionEarn, `놀이로 번 코인 ${BALANCE.missionEarn}개 (${Math.min(d.earn, BALANCE.missionEarn)}/${BALANCE.missionEarn})`),
        go('bake', d.bake >= 1, '붕어빵 1판 (성공이든 실패든)'),
        go('fare', !!(d.qPaid || {}).fare, `손님 내리기 (${Math.min(d.fare || 0, 3)}/3) +50`),
        go('cheer', !!(d.qPaid || {}).cheer, `전광판 응원 (${Math.min(d.cheer || 0, 3)}/3) +30`),
        go('stunt', !!(d.qPaid || {}).stunt, `황금 링 통과 (${Math.min(d.stunt || 0, 2)}/2) +40`),
        h('p', { class: 'note' }, ...withIcon((d.qPaid || {}).all ? 'gift' : 'todo', `택시·응원·링을 모두 끝내면 +${PAY.quest.all}`)),
        h('p', { class: 'note', text: `출석 ${d.streak || 0}일 · 내일 접속하면 +${tomorrow}` }),
        h('p', { class: 'note', text: todayFacts(d) }),
        h('p', { class: 'note', text: `${feverEl.textContent}. 20이 되면 잠시 코인이 2배입니다.` }),
      );
    }, true);
  }
  // Each crowd number shows only from its threshold (ftue.js PUBLIC_MIN); the weekly play total always stays.
  function todayFacts(d) {
    const f = crowdFacts({ crowd: people, visitors: world.today?.visitors, wishes: world.today?.wishes });
    return [
      `이번 주 놀이로 번 코인 ${money(Math.max(0, Math.floor(Number(d.play) || 0)))}`,
      f.crowd ? `지금 광장 ${f.crowd}명` : '',
      f.visitors ? `오늘 다녀간 ${money(f.visitors)}명` : '',
      f.wishes ? `오늘 걸린 소원 ${money(f.wishes)}개` : '',
    ].filter(Boolean).join(' · ');
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
      host.append(mine.length ? h('div', { class: 'rows' }, ...mine.map((b) => h('div', { class: 'row', style: { display: 'flex', gap: '8px' } },
        h('button', { class: 'chip', type: 'button', style: { flex: '1' }, text: slotName(b.slot_id) + (boardActive(b) ? ` · ${fmtLeft(lightLeft(b))} 남음` : ' · 불 꺼짐'), onclick: () => openBillboard(b.slot_id) }),
        h('button', { class: 'chip', type: 'button', text: '보기', onclick: () => { closeSheet(); hooks.focusShot?.(b.slot_id); } }),
        h('button', { class: 'chip', type: 'button', text: '링크', onclick: () => copyInvite(b.slot_id) }),
      ))) : h('p', { class: 'note', text: '점령 중인 전광판이 없어요' }));
      host.append(h('b', { text: '빼앗긴 것' }));
      host.append(lost.length ? h('div', { class: 'rows' }, ...lost.map((x) => h('button', { class: 'chip', type: 'button', text: `${slotName(x.slot)} · ${x.by}`, onclick: () => openAd(x.slot) }))) : h('p', { class: 'note', text: '아직 빼앗긴 전광판이 없어요' }));
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
    for (const id of BALANCE.starterSlots) if (starterOpen(id)) return id;
    return '';
  }
  function maybeStarterToast() {
    if (starterToastShown || !plazaReady || !entered) return;
    if (newbieOn) return;
    if (hooks.starterUsed?.() == null && performance.now() < 8000) return;
    if (hooks.starterUsed?.() === true) { starterToastShown = true; return; }
    const id = firstOpenStarter();
    if (!id) return;
    starterToastShown = true;
    note('거리 무료 칸이 비어 있어요', 'ok', () => openClaimStep(1, claimWizard(id)));
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
    note(`${label} 길안내를 시작해요 · 하늘색 빛기둥을 따라가세요`, 'ok');
  }
  function goTeleport(p, label) {
    if (!insideLoop(p.x, p.z, 0)) { note('울타리 밖으로는 갈 수 없어요', 'err'); return; }
    closeSheet();
    hooks.teleport(p.x, p.z);
    sfx.fanfare();
    note(`${label} 도착!`, 'ok');
  }
  function placeRow(slot) {
    const p = plotFront(slot);
    return h('div', { class: 'place' },
      h('div', { class: 'where' },
        h('b', null, ...withIcon('pin', '타임스퀘어 순환로 분양 건물')),
        h('span', { text: `${slot.id}번 필지 · 순환 도로 바로 바깥` })),
      h('div', { class: 'go' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => goWaypoint(p, `${slot.id}번 토지`) }, ...withIcon('pin', '길안내')),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { hooks.setWaypoint(p); openMap(p); } }, ...withIcon('map', '지도')),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => goTeleport(p, `${slot.id}번 토지`) }, ...withIcon('bolt', '바로 가기'))));
  }

  const STICKER_GLYPHS = ['🔥부럽다!', '👑성지순례', '💖하트폭탄', '👀내자리찜'];
  function stickerBox(getSlot) {
    const wash = h('button', { type: 'button', class: 'btn ghost', hidden: true, onclick: async () => { try { await hooks.washSticker?.(getSlot()); } catch (e) { note(e?.message || '스티커를 지우지 못했어요', 'err'); } sync(); } });
    const sync = () => {
      const id = getSlot();
      const b = boardById(id);
      const mine = !!b?.holder_id && b.holder_id === hooks.actorId?.();
      const n = (hooks.stickerList?.(id) || []).length;
      wash.hidden = !(mine && n > 0);
      wash.textContent = `내 스티커 씻기${n > 1 ? ` · ${n}장` : ''}`;
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
      h('h4', null, ...withIcon('board', '전 전광판 60초 장악')),
      h('p', { text: '5000코인 또는 VIP 티켓 1장. 점령자는 바뀌지 않고, 1분 뒤 원래 화면으로 돌아와요.' }),
      line,
      h('button', { class: 'btn ghost', type: 'button', text: '5000코인으로 60초 장악', onclick: () => go('coins') }),
      h('p', { class: 'note', text: `가진 VIP 티켓 ${Math.max(0, Math.floor(Number(wallet.tickets) || 0))}장` }),
      h('button', { class: 'btn ghost', type: 'button', text: 'VIP 티켓 1장으로 60초 장악', onclick: () => go('ticket') }),
    );
  }

  function openReport(slotId) {
    const reasons = [['abuse', '욕설·괴롭힘'], ['ad', '스팸 광고'], ['impersonation', '사칭'], ['other', '기타']];
    openSheet('신고', null, (host) => {
      host.append(h('p', { class: 'note', text: '같은 칸은 하루에 한 번만 접수됩니다.' }));
      host.append(h('div', { class: 'chips' }, ...reasons.map(([id, label]) => h('button', {
        type: 'button', text: label, onclick: async () => {
          try {
            await hooks.report?.(slotId, id);
            note('신고를 접수했어요', 'ok');
            closeSheet();
          } catch (e) { note(e?.message || '신고를 접수하지 못했어요', 'err'); }
        },
      }))));
    }, true);
  }
  function openCodeSheet() {
    openSheet('이번 주 코드', null, (host) => {
      const box = h('div');
      const input = h('input', { class: 'input', maxLength: 6, placeholder: '6자리', 'aria-label': '이번 주 코드' });
      host.append(
        h('p', { class: 'note', text: '같은 코드를 입력한 사람이 이번 주 출석으로 모입니다. 하루 한 번.' }),
        input,
        h('button', { class: 'btn gold', type: 'button', text: '코드 기록', onclick: async () => {
          try {
            const res = await hooks.joinCode?.(input.value);
            note(res?.dup ? '오늘은 이미 기록했어요' : '이번 주 코드에 이름을 올렸어요', 'ok');
            load();
          } catch (e) { note(e?.message || '코드를 기록하지 못했어요', 'err'); }
        } }),
        box,
      );
      const load = () => {
        box.replaceChildren(h('p', { class: 'note', text: '순위를 불러오는 중…' }));
        Promise.resolve(hooks.weekCodes?.()).then((data) => {
          const rows = Array.isArray(data?.top) ? data.top : [];
          box.replaceChildren(...(rows.length
            ? rows.map((row, i) => h('div', { class: 'rank' }, h('span', { class: 'n', text: String(i + 1) }), h('b', { text: String(row[0] || '') }), h('span', { class: 'pts tnum', text: String(row[1] || 0) })))
            : [h('p', { class: 'note', text: '이번 주 기록이 없어요' })]));
        }).catch(() => box.replaceChildren(h('p', { class: 'note', text: '순위를 불러오지 못했어요' })));
      };
      load();
    }, true);
  }
  function openInboxSheet() {
    openSheet('받은 소식', null, (host) => {
      const box = h('div');
      host.append(box);
      box.append(h('p', { class: 'note', text: '소식을 불러오는 중…' }));
      Promise.resolve(hooks.inbox?.()).then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        box.replaceChildren(...(list.length
          ? list.map((row) => h('p', { class: 'note' }, [
            row.text,
            row.slot && row.from ? h('button', { type: 'button', class: 'chip', text: '답례', onclick: () => openCheerReply(row.slot, row.from) }) : null,
            row.slot && !row.from ? h('button', { type: 'button', class: 'chip', text: '보러가기', onclick: () => { closeSheet(); hooks.focusShot?.(row.slot); } }) : null,
          ]))
          : [h('p', { class: 'note', text: '받은 소식이 없어요' })]));
      }).catch((e) => {
        box.replaceChildren(h('p', { class: 'note', text: e?.message || '소식을 불러오지 못했어요' }));
      });
    }, true);
  }
  // ---------------------------------------------------------------- 오늘의 소원
  // Wish text and nicknames are other people's words: they reach the DOM only through `text:` (textContent).
  const WISH_FOOT = '매일 0시에 새로 시작해요. 여러 사람에게서 하트 5개 이상 받은 1~3위는 다음 날 300·200·100코인.';
  const WISH_CHIPS = ['올해는 꼭 합격', '우리 가족 건강하게', '월급 오르게 해 주세요'];
  const quote = (t) => `“${String(t ?? '')}”`;
  function setWish(next) {
    const n = next || {};
    const rows = (list) => (Array.isArray(list) ? list : []).filter((w) => w && w.id).map((w) => ({ ...w }));
    wishView = {
      known: !!n.known,
      day: String(n.day || ''),
      board: rows(n.board),
      king: n.king || null,
      count: Math.max(0, Math.floor(Number(n.count)) || 0),
      mine: n.mine ? { ...n.mine, mine: true } : null,
      left: Math.max(0, Math.floor(Number(n.left)) || 0),
      given: Array.isArray(n.given) ? n.given.map(String) : [],
      top: rows(n.top),
      recent: rows(n.recent),
      yesterday: (Array.isArray(n.yesterday) ? n.yesterday : []).filter((y) => y && y.txt).map((y) => ({ ...y })),
      focus: n.focus ? { ...n.focus } : null,
      miss: String(n.miss || ''),
      busy: n.busy === true,
    };
    wishDot.hidden = !(wishView.known && !wishView.mine && !wishView.busy);
    renderGoal();
    wishRepaint?.();
  }
  // replaceChildren turns a null child into the text "null": every optional child goes through present() first.
  const fill = (el, ...nodes) => { el.replaceChildren(...present(nodes)); return el; };
  // Picture links made for a wish in this tab (memory only): id -> { page, at }, and the one upload in flight.
  const wishPics = new Map();
  let wishPicRun = null;
  const WISH_PIC_MS = 10 * 60000;
  function wishPicture(m) {
    const id = m.id;
    const hit = wishPics.get(id);
    if (hit && Date.now() - hit.at < WISH_PIC_MS) return Promise.resolve(hit.page);
    if (wishPicRun?.id === id) return wishPicRun.p;
    if (wishPicRun) return Promise.resolve('');
    const p = (async () => {
      hooks.pinWish?.(id); // uploaded either way: the caption below carries the wish even if no board shows it
      await new Promise((r) => setTimeout(r, 900));
      const blob = await hooks.capture?.();
      if (!blob) return '';
      let shot = null;
      try { shot = await composeWishShot(blob, { text: m.txt, nick: m.nick }); } catch { shot = null; }
      const res = await hooks.publishShot?.(shot || blob, { wish: id });
      const page = typeof res?.page === 'string' && /^https?:\/\//.test(res.page) ? res.page : '';
      if (page) wishPics.set(id, { page, at: Date.now() });
      return page;
    })().catch(() => '').finally(() => { if (wishPicRun?.p === p) wishPicRun = null; });
    wishPicRun = { id, p };
    return p;
  }
  function openWish(opts = {}) {
    const focusId = String(opts.focus || '');
    const from = String(opts.from || 'hud');
    trackEvent('wish_view', { from });
    openSheet(['wish', '오늘의 소원'], null, (host) => {
      let tab = 'top', editing = false, justPosted = false, thanks = '', mineSig = '', settled = false, postedFresh = false;
      let input = null, counter = null, errEl = null, sendBtn = null, shareBox = null, composing = false, rankEl = null, heartsEl = null;
      // One amber button in the sheet: the heart for a linked wish while it can still be sent, else my own wish's button.
      let focusLead = false, leadBtn = null;
      const syncLead = () => { if (leadBtn) { leadBtn.classList.toggle('gold', !focusLead); leadBtn.classList.toggle('ghost', focusLead); } };
      // Survive repaints (socket WISH, world refresh): hearts still in flight, the armed report, rows reported here, an open copy box.
      const pending = new Set();
      const removed = new Set();
      let armed = '', armTimer = 0, manualLink = '';
      const focusBox = h('div', { class: 'wish-card wish-focus', hidden: true });
      const mineBox = h('div', { class: 'wish-mine' });
      const tabTop = h('button', { type: 'button', class: 'wish-tab', text: '인기', onclick: () => { tab = 'top'; paintList(); } });
      const tabNew = h('button', { type: 'button', class: 'wish-tab', text: '최신', onclick: () => { tab = 'recent'; paintList(); } });
      const leftEl = h('p', { class: 'note wish-left' });
      const listBox = h('div', { class: 'wish-list' });
      const yBox = h('div', { class: 'wish-y', hidden: true });
      const invBox = h('p', { class: 'note wish-inv-n', hidden: true }); // 초대한 친구 n명 · 받은 코인 m, only once n > 0
      host.append(focusBox, mineBox, invBox, h('div', { class: 'wish-tabs', role: 'group', 'aria-label': '소원 목록' }, tabTop, tabNew), leftEl, listBox, yBox, h('p', { class: 'note wish-foot', text: WISH_FOOT }));

      const isOwn = (w) => !!(w?.mine || (wishView.mine && w?.id === wishView.mine.id));
      // The view = the last server state plus the hearts still in flight (never written into wishView, so a failed one
      // just leaves the set and newer left/given from the server stay as they are).
      const extra = (id) => (pending.has(id) && !wishView.given.includes(id) ? 1 : 0);
      const heartsOf = (w) => Math.max(0, Math.floor(Number(w?.hearts) || 0)) + extra(w?.id);
      const givenNow = () => [...wishView.given, ...[...pending].filter((id) => !wishView.given.includes(id))];
      const leftNow = () => Math.max(0, wishView.left - [...pending].filter((id) => !wishView.given.includes(id)).length);
      const heartOf = (w) => wishHeart({ wish: { ...w, mine: isOwn(w) }, given: givenNow(), left: leftNow(), day: wishView.day });
      const rankOf = (m) => {
        if (Number(m?.rank) > 0) return Math.floor(Number(m.rank));
        const i = wishView.top.findIndex((x) => x.id === m?.id);
        return i < 0 ? 0 : Math.floor(Number(wishView.top[i].rank)) || i + 1;
      };
      function paint() { paintFocus(); paintMine(); paintList(); paintYesterday(); const t = inviteView({ on: !!hooks.inviteOn?.(), sum: hooks.inviteSum?.() }).box; invBox.textContent = t; invBox.hidden = !t; }
      async function sendHeart(id) {
        if (pending.has(id)) return false;
        pending.add(id);
        paint();
        let res = null;
        try { res = await hooks.heartWish?.(id); } catch { res = null; }
        pending.delete(id);
        if (res?.ok) { paint(); trackEvent('wish_heart', { from: id === focusId ? 'link' : tab }); return true; }
        paint();
        note(res?.error || '하트를 보내지 못했어요. 잠시 뒤 다시 해 주세요.', 'err');
        return false;
      }
      function focusInput() {
        mineBox.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        input?.focus();
      }
      function paintFocus() {
        if (focusId && settled && wishView.miss === focusId) {
          focusBox.hidden = false;
          fill(focusBox, h('p', { class: 'note', text: '없어졌거나 가려진 소원이에요' }));
          focusLead = false; syncLead();
          return;
        }
        const f = focusId && wishView.focus?.id === focusId ? wishView.focus : null;
        focusBox.hidden = !f;
        if (!f) { fill(focusBox); focusLead = false; syncLead(); return; }
        const st = heartOf(f);
        focusLead = !thanks && !!st.ok;
        syncLead();
        const btn = thanks && !wishView.mine
          ? h('button', { class: 'btn ghost wish-go', type: 'button', text: '나도 소원 걸기', onclick: () => focusInput() })
          : h('button', { class: focusLead ? 'btn gold wish-go' : 'btn ghost wish-go', type: 'button', disabled: !st.ok || pending.has(f.id) || wishView.busy, onclick: async () => {
            if (await sendHeart(f.id)) { thanks = '하트를 보냈어요. 고마워요!'; paintFocus(); }
          } }, ...withIcon('heart', thanks ? '보냈어요' : '하트 보내기'));
        fill(focusBox,
          h('p', { class: 'wish-quote', text: quote(f.txt) }),
          h('p', { class: 'wish-by', text: `— ${f.nick || '누군가'}` }),
          h('p', { class: 'wish-hearts tnum' }, ...withIcon('heart', String(heartsOf(f)))),
          btn,
          thanks ? h('p', { class: 'note ok', text: thanks }) : (!st.ok && st.why ? h('p', { class: 'note', text: st.why }) : null),
        );
      }
      function showErr(text) { if (!errEl) return; errEl.textContent = msgText(text); errEl.hidden = !msgText(text); }
      async function submit() {
        if (!input || !sendBtn || sendBtn.disabled) return;
        const raw = input.value;
        const bad = wishRejected(raw);
        if (bad) { showErr(bad); return; }
        const text = cleanWish(raw);
        const wasEdit = editing;
        sendBtn.disabled = true;
        showErr('');
        let res = null;
        try { res = await hooks.postWish?.(text); } catch { res = null; }
        if (sendBtn) sendBtn.disabled = false;
        if (!res?.ok) { showErr(res?.error || '소원을 걸지 못했어요. 잠시 뒤 다시 해 주세요.'); return; }
        trackEvent('wish_post', { fresh: res.fresh ? 1 : 0, from });
        editing = false;
        justPosted = !!res.fresh;
        if (res.fresh) { postedFresh = true; sfx.cash(); showResult('소원을 걸었어요', '빈 전광판에 차례로 떠요'); }
        else if (wasEdit) note('소원을 고쳐 걸었어요', 'ok');
        paintMine(true);
        paintFocus();
        renderGoal();
      }
      const rankLine = (m) => {
        const rank = rankOf(m);
        return rank ? `지금 ${rank}위 · 오늘 소원 ${Math.max(rank, wishView.count)}개` : '';
      };
      function rememberSeen(m) {
        const hearts = Math.max(0, Math.floor(Number(m.hearts) || 0));
        const seen = recall('kts_wish_seen', null);
        if (!seen || seen.id !== m.id || seen.hearts !== hearts) store('kts_wish_seen', { id: m.id, hearts });
      }
      function paintMine(force) {
        const m = wishView.mine;
        // The count of other people's wishes is not in the signature: it only changes the rank line, in place.
        const sig = !wishView.known && !settled ? 'wait' : wishView.busy ? 'busy' : editing ? 'edit' : m ? [m.id, m.txt, Number(m.hearts) > 0 ? 1 : 0, m.hidden ? 1 : 0].join('|') : 'none';
        if (m && sig !== 'wait' && wishView.known) rememberSeen(m);
        if (!force && sig === mineSig) {
          if (m && rankEl) { const line = rankLine(m); rankEl.textContent = line; rankEl.hidden = !line; }
          if (m && heartsEl) setIconText(heartsEl, 'heart', String(Math.max(0, Math.floor(Number(m.hearts) || 0))));
          syncLead();
          return;
        }
        mineSig = sig;
        input = null; counter = null; errEl = null; sendBtn = null; shareBox = null; rankEl = null; heartsEl = null; leadBtn = null;
        if (sig === 'wait') { fill(mineBox, h('p', { class: 'note', text: '내 소원을 확인하는 중…' })); return; }
        if (sig === 'busy') { fill(mineBox, h('p', { class: 'note wish-busy', text: WISH_ERR.busy })); return; } // the server is saving its budget: no form
        if (!m || editing) {
          input = h('input', { class: 'input wish-in', maxLength: 64, placeholder: '예: 올해는 꼭 합격', 'aria-label': '오늘의 소원 한 줄', autocomplete: 'off', enterkeyhint: 'done' });
          if (editing && m) input.value = m.txt;
          counter = h('span', { class: 'wish-n tnum', 'aria-hidden': 'true' });
          errEl = h('p', { class: 'note err wish-err', hidden: true, role: 'alert' });
          // Korean IME: while a syllable is being composed the box is never rewritten; the cut waits for compositionend.
          const sync = (busy) => {
            const d = wishDraft(input.value);
            if (!busy && d.value !== input.value) input.value = d.value;
            counter.textContent = `${d.n}/${WISH.maxLen}`;
          };
          input.addEventListener('compositionstart', () => { composing = true; });
          input.addEventListener('compositionend', () => { composing = false; sync(false); });
          input.addEventListener('input', (e) => { showErr(''); sync(composing || !!e.isComposing); });
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && !composing && e.keyCode !== 229) { e.preventDefault(); submit(); } });
          sendBtn = h('button', { class: 'btn gold wish-go', type: 'button', text: editing ? '고친 소원 걸기' : '소원 걸기 (무료)', onclick: () => submit() });
          leadBtn = sendBtn;
          syncLead();
          fill(mineBox,
            h('h3', { text: editing ? '내 소원 고쳐 쓰기' : '내 소원 한 줄' }),
            h('div', { class: 'wish-field' }, input, counter),
            h('div', { class: 'chips wish-chips' }, ...WISH_CHIPS.map((t) => h('button', { type: 'button', text: t, onclick: () => { input.value = t; sync(false); showErr(''); input.focus(); } }))),
            errEl,
            sendBtn,
            editing ? h('button', { class: 'btn ghost wish-edit', type: 'button', text: '그대로 두기', onclick: () => { editing = false; paintMine(true); } }) : null,
          );
          sync(false);
          return;
        }
        heartsEl = h('p', { class: 'wish-hearts tnum' });
        setIconText(heartsEl, 'heart', String(Math.max(0, Math.floor(Number(m.hearts) || 0))));
        const kids = [
          h('p', { class: 'wish-tag', text: '내 소원' }),
          h('p', { class: 'wish-quote', text: quote(m.txt) }),
          heartsEl,
        ];
        if (m.hidden) kids.push(h('p', { class: 'note err', text: '신고가 쌓여 가려졌어요' }));
        else {
          const line = rankLine(m);
          rankEl = h('p', { class: 'note', text: line, hidden: !line });
          kids.push(rankEl);
          const share = h('button', { class: 'btn gold wish-go', type: 'button', text: '친구에게 하트 부탁하기', onclick: () => shareMine(m, share) });
          leadBtn = share;
          syncLead();
          kids.push(share, kakaoButton((b) => shareMine(m, b, true)));
          const invLine = inviteView({ on: !!hooks.inviteOn?.(), sum: hooks.inviteSum?.() }).line; if (invLine) kids.push(h('p', { class: 'note wish-inv', text: invLine }));
          if (!(Number(m.hearts) > 0)) kids.push(h('button', { class: 'btn ghost wish-edit', type: 'button', text: '고쳐 쓰기', onclick: () => { editing = true; paintMine(true); input?.focus(); } }));
          if (justPosted) { justPosted = false; setTimeout(() => { if (share.isConnected) share.focus(); }, 80); }
          kids.push(pushRow());
          shareBox = h('div', { class: 'wish-share', hidden: true });
          if (manualLink) { const mc = manualCopy(manualLink); fill(shareBox, ...mc.nodes); shareBox.hidden = false; }
          kids.push(shareBox);
        }
        fill(mineBox, h('div', { class: 'wish-card mine' }, ...kids));
      }
      // A picture link first: the wish goes up on the boards near the camera, the frame is uploaded with { wish },
      // and the preview page is shared. Over ~4 s or on any failure, the plain /rt/w/<id> link. No coin for sharing a wish.
      async function shareMine(m, btn, viaKakao = false) {
        if (btn?.disabled || shareBusy) return;
        const plain = hooks.wishUrl?.(m.id) || (location.origin + '/rt/w/' + encodeURIComponent(m.id));
        const label = btn?.textContent || '친구에게 하트 부탁하기';
        if (btn) { btn.disabled = true; btn.textContent = '전광판에 올리는 중…'; }
        // My code if it is not cached yet; never waited for on the Kakao path (its 1 s tap budget): that sends the cached code or none.
        const code = viaKakao ? null : Promise.race([Promise.resolve(hooks.ensureInvite?.()), new Promise((r) => setTimeout(() => r(''), 1500))]).catch(() => '');
        let pic = '';
        try { pic = await Promise.race([wishPicture(m), new Promise((r) => setTimeout(() => r(''), 4000)), ...(viaKakao ? [new Promise((r) => setTimeout(() => r(''), 1000))] : [])]); } catch { pic = ''; } // Kakao's popup needs the tap still fresh: ~1 s at most for the picture
        if (code) await code;
        if (btn) { btn.disabled = false; btn.textContent = label; }
        const url = pic || plain;
        const { title, text } = wishShareText(m);
        const how = (viaKakao && (await sendKakao({ kind: 'wish', title, text, url }))) || (await sendLink({ kind: 'wish', native: true, title, text, url, into: shareBox }));
        if (how === 'cancel' || how === 'busy') return;
        trackEvent('wish_share', { how, pic: pic ? 1 : 0 });
        if (how === 'copied') note('링크를 복사했어요. 친구에게 붙여 넣어 보내세요.', 'ok');
        if (how === 'manual') manualLink = invited(url, hooks.inviteCode?.());
      }
      function armReport(id) {
        if (armed === id) {
          clearTimeout(armTimer);
          armed = '';
          removed.add(id);
          paintList();
          Promise.resolve(hooks.reportWish?.(id))
            .then((res) => {
              if (!res?.ok) { removed.delete(id); paintList(); }
              note(res?.ok ? '신고했어요. 고마워요.' : (res?.error || '신고하지 못했어요.'), res?.ok ? 'ok' : 'err');
            })
            .catch(() => { removed.delete(id); paintList(); note('신고하지 못했어요.', 'err'); });
          return;
        }
        clearTimeout(armTimer);
        armed = id;
        paintList();
        armTimer = setTimeout(() => { if (armed === id) { armed = ''; paintList(); } }, 4000);
      }
      function wishRowEl(w, i) {
        const own = isOwn(w);
        const st = heartOf(w);
        const who = w.nick || '누군가';
        const busy = pending.has(w.id) || wishView.busy;
        const short = String(st.short || '');
        const heart = h('button', { class: 'wish-heart', type: 'button', disabled: !st.ok || busy, title: st.why || '하트 보내기', 'aria-label': st.ok ? `${who}님의 소원에 하트 보내기` : `${who}님의 소원 · ${st.why || st.short}`, onclick: () => sendHeart(w.id) },
          ...(short.startsWith('♥ ') ? withIcon('heart', short.slice(2)) : [short]));
        const rep = own ? null : h('button', { class: 'wish-report' + (armed === w.id ? ' arm' : ''), type: 'button', text: armed === w.id ? '한 번 더 누르면 신고' : '신고', onclick: () => armReport(w.id) });
        return h('div', { class: 'wish-row' + (own ? ' mine' : '') },
          tab === 'top' ? h('span', { class: 'n tnum', text: String(Math.floor(Number(w.rank)) || i + 1) }) : null,
          h('div', { class: 'wt' }, h('b', { text: quote(w.txt) }), h('small', { text: who + (own ? ' · 나' : '') })),
          h('span', { class: 'wh tnum' }, ...withIcon('heart', String(heartsOf(w)))),
          h('div', { class: 'wa' }, heart, rep));
      }
      function paintList() {
        for (const [b, on] of [[tabTop, tab === 'top'], [tabNew, tab === 'recent']]) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
        leftEl.hidden = !wishView.known || wishView.busy;
        const left = leftNow();
        leftEl.textContent = !wishView.known ? '' : left > 0 ? `오늘 줄 수 있는 하트 ${left}개` : '오늘 하트를 다 썼어요. 내일 다시 5개가 생겨요.';
        if (!wishView.known) {
          fill(listBox, h('p', { class: 'note', text: settled ? '목록을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.' : '소원을 불러오는 중…' }));
          return;
        }
        const keep = (list) => list.filter((w) => !removed.has(w.id));
        const top = keep(wishView.top), recent = keep(wishView.recent);
        if (!top.length && !recent.length) { fill(listBox, h('p', { class: 'note wish-empty', text: '오늘 첫 소원을 걸어 보세요' })); return; }
        const list = tab === 'top' ? top : recent;
        fill(listBox, ...list.map((w, i) => wishRowEl(w, i)));
      }
      function paintYesterday() {
        const ys = wishView.yesterday.slice(0, 3);
        yBox.hidden = !ys.length;
        if (!ys.length) { fill(yBox); return; }
        const me = ys.find((y) => y.mine);
        // Seen here, so the 다녀간 사이 sheet does not repeat it today.
        if (me) { try { localStorage.setItem('kts_wish_prize', kstDay()); } catch { /* private mode */ } }
        fill(yBox,
          h('h3', { text: '어제의 소원' }),
          ...ys.map((y) => h('p', { class: 'wish-yrow', text: `${y.rank}위 ${quote(y.txt)} — ${y.nick || '누군가'} · ♥ ${y.hearts}${y.prize ? ` · +${y.prize}` : ''}` })),
          me ? h('p', { class: 'note ok', text: me.prize ? `내 소원이 어제 ${me.rank}위였어요. +${me.prize}코인이 들어와요.` : `내 소원이 어제 ${me.rank}위였어요.` }) : null,
        );
      }

      // Across 0시 KST main.js marks the copy unknown: reload the list instead of showing the load-failed line.
      let wasKnown = wishView.known;
      const reload = () => {
        settled = false;
        paint();
        Promise.resolve(hooks.loadWishes?.(focusId)).catch(() => null).finally(() => { settled = true; if (wishRepaint) paint(); });
      };
      wishRepaint = () => {
        if (!wishView.known && wasKnown) { wasKnown = false; reload(); return; }
        wasKnown = wishView.known;
        paint();
      };
      paint();
      // net.wishes gives up after 8 s; this one-shot guard only makes sure the sheet never waits forever.
      const giveUp = setTimeout(() => { if (!settled) { settled = true; if (wishRepaint) paint(); } }, 10000);
      Promise.resolve(hooks.loadWishes?.(focusId)).catch(() => null).finally(() => { clearTimeout(giveUp); settled = true; if (wishRepaint) paint(); });
      return () => {
        wishRepaint = null;
        clearTimeout(armTimer);
        clearTimeout(giveUp);
        // Closed without a wish by the player (not replaced by another sheet): the newcomer card moves on for this session.
        if (!replacingSheet && !wishView.mine && !wishSkipped) {
          wishSkipped = true;
          try { sessionStorage.setItem('kts_wish_skip', '1'); } catch { /* private mode */ }
        }
        renderGoal();
        try { opts.onClose?.(); } catch { /* the tutorial can still start from other paths */ }
        // The first wish of the day: now "하트가 오면 알려 드릴까요?" makes sense.
        if (postedFresh) queuePushOffer('wish');
      };
    }, true, 'wish');
  }
  function openAd(slotId) {
    const b = boardById(slotId);
    if (!boardActive(b)) { openBillboard(slotId); return; }
    const mine = b.holder_id === hooks.actorId();
    const url = /^https:\/\//.test(String(b.external_url || '')) ? b.external_url : '';
    const canvas = makeCanvas(1024, 576);
    paintBillboard(canvas, b);
    const card = hooks.slotCard?.(slotId);
    const daysNote = h('p', { class: 'note' });
    const inviteBox = h('div', { class: 'manual-copy', hidden: true });
    const viewEl = h('b', { text: '0' });
    const cheerEl = h('b', { text: '0' });
    const clickEl = h('b', { text: '0' });
    const paintStats = () => {
      const row = boardById(slotId) || b;
      viewEl.textContent = String(Math.floor(Number(row.views) || 0));
      cheerEl.textContent = String(Math.floor(Number(row.cheers) || 0));
      clickEl.textContent = String(Math.floor(Number(row.clicks) || 0));
      const n = Math.max(0, Math.floor(Number(row.lit_days) || 0));
      daysNote.hidden = n <= 0;
      daysNote.textContent = n > 0 ? `연속 ${n}일` : '';
    };
    paintStats();
    openSheet(mine ? '내 전광판' : '걸린 전광판', mine ? 'MINE' : 'AD', (host) => {
      host.append(
        card ? h('div', { class: 'place' }, h('div', { class: 'where' }, h('b', { text: card.title }), h('span', { text: card.line }))) : null,
        h('div', { class: 'screen' }, canvas),
        h('p', { class: 'note', text: `${b.holder_name || '익명'}님이 걸어 둔 화면입니다.` }),
        chainBoost(world.billboards, slotId) ? h('p', { class: 'note', text: `이 건물을 한 쪽이 다 가지고 있어요. 응원하면 +${BALANCE.cheerGroup}` }) : null,
        daysNote,
        !mine && protectedLeft(b) > 0 ? h('p', { class: 'note', text: `보호 ${fmtLeft(protectedLeft(b))} · 그 전에는 빼앗을 수 없어요` }) : null,
        !mine && protectedLeft(b) <= 0 ? h('p', { class: 'note', text: '보호가 끝났어요. 지금 입찰보다 높게 걸면 빼앗을 수 있어요.' }) : null,
        mine ? h('button', { type: 'button', class: 'btn ghost', text: '불 켜기', onclick: async () => {
          const beforeUntil = b.lit_until || b.expires_at;
          try {
            const data = await hooks.relight?.(slotId);
            if (data?.lit_days != null) b.lit_days = data.lit_days;
            if (data?.lit_until) b.lit_until = data.lit_until;
            paintStats();
            const again = data?.lit_until && beforeUntil && new Date(data.lit_until).getTime() <= new Date(beforeUntil).getTime() + 60000;
            const left = fmtLeft(lightLeft({ ...b, lit_until: data?.lit_until || beforeUntil }));
            note(again ? `오늘은 이미 켰어요. ${left} 남음` : `72시간 연장. ${left} 남음`, 'ok');
          } catch (e) { note(e?.message || '불을 켜지 못했어요', 'err'); }
        } }) : null,
        h('div', { class: 'holder' },
          h('div', { class: 'stat' }, h('small', { text: '택시 정차' }), viewEl),
          h('div', { class: 'stat' }, h('small', { text: '응원' }), cheerEl),
          h('div', { class: 'stat' }, h('small', { text: '링크 클릭' }), clickEl),
        ),
        mine ? null : h('div', { class: 'chips' }, ...CHEER_PHRASES.map((text, i) => h('button', {
          type: 'button',
          text,
          onclick: () => hooks.cheer?.(slotId, i + 1),
        }))),
        h('div', { class: 'row' },
          url ? h('button', { type: 'button', class: 'btn ghost', text: '링크 열기', onclick: () => hooks.adClick?.(slotId, url) }) : null,
          card ? h('button', { type: 'button', class: 'btn ghost', text: '이 전광판 보기', onclick: () => { closeSheet(); hooks.focusShot?.(slotId); } }) : null,
          h('button', { type: 'button', class: 'btn primary', text: mine ? '문구 수정' : '이 자리 빼앗기', onclick: () => openBillboard(slotId) }),
          mine ? h('button', { type: 'button', class: 'btn ghost', text: '초대 링크 복사', onclick: () => copyInvite(slotId, '', inviteBox) }) : h('button', { type: 'button', class: 'btn ghost', text: '신고', onclick: () => openReport(slotId) }),
        ),
        inviteBox,
        stickerBox(() => slotId),
      );
      adRefresh = paintStats;
      return () => { adRefresh = null; };
    }, true);
  }
  function openBillboard(slotId = 'MAIN_TOP', zone = '') {
    hooks.refreshWorld?.();
    let slot = slotId;
    openSheet(['board', '전광판 점령'], '점령', (host) => {
      const badgeEl = host.parentElement?.querySelector('.badge');
      const paintBadge = () => {
        if (!badgeEl) return;
        const b = boardById(slot);
        const mineLive = !!(b?.holder_id && b.holder_id === hooks.actorId() && boardActive(b));
        badgeEl.textContent = !mineLive && auctionClosed(slot, nowMs()) ? '9시 오픈' : !b?.holder_id ? '빈칸' : !boardActive(b) ? '불 꺼짐' : '방송 중';
      };
      const canvas = makeCanvas(1024, 576);
      const seg = h('div', { class: 'seg' });
      const slotOption = (id) => {
        const b = boardById(id);
        const mineRow = b?.holder_id && b.holder_id === hooks.actorId();
        const who = !b?.holder_id ? '비어 있음' : !boardActive(b) ? (mineRow ? '불 꺼짐' : `불 꺼짐 · ${b.holder_name || '익명'}`) : mineRow ? '내 것' : (b.holder_name || '점령');
        return `${slotName(id)} · ${who}`;
      };
      const pick = h('select', { class: 'input slot-pick', 'aria-label': '전광판 자리' });
      let slotLock = 0;
      pick.addEventListener('change', () => {
        if (slotLock) return;
        choose(pick.value);
        sfx.click();
      });
      const stHolder = h('b'), stBid = h('b', { class: 'gold' }), stProt = h('b'), stScore = h('b', { class: 'gold' }), stStreak = h('b', { class: 'gold' });
      const chainNote = h('p', { class: 'note' });
      const relightBtn = h('button', { class: 'btn ghost', type: 'button', text: '불 켜기', hidden: true });
      // The holder's own tools: the report since the claim, and a QR of the board's share page for the shop counter.
      const ownRow = h('div', { hidden: true, style: { gridColumn: '1 / -1', display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => openAdReport(slot) }, ...withIcon('chart', '내 전광판 리포트')),
        h('button', { class: 'btn ghost', type: 'button', text: 'QR 코드 받기', onclick: () => openAdQr(slot) }));
      const emojiIn = h('input', { class: 'input', maxLength: 4, 'aria-label': '이모지' });
      const emo = h('div', { class: 'emo' });
      const themes = h('div', { class: 'themes' });
      const inks = h('div', { class: 'swatches' });
      const inkIn = h('input', { type: 'color', 'aria-label': '글자색 직접 선택' });
      const lines = [0, 1, 2].map(i => h('input', { class: 'input', maxLength: 16, placeholder: ['메인 문구 (16자)', '둘째 줄 (16자)', '셋째 줄 (16자)'][i] }));
      const urlIn = h('input', { class: 'input', type: 'url', placeholder: 'https://threads.net/...' });
      const urlField = h('div', { class: 'field' }, h('label', null, '외부 링크', h('span', { text: '인스타·스레드·유튜브·스마트스토어 https 주소만 저장됩니다. 전광판을 누르면 상세보기에서 열 수 있습니다' })), urlIn);
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
      const photoGo = h('button', { class: 'btn ghost cta', type: 'button' });
      const holds = (b) => {
        if (!b?.holder_id || b.holder_id !== hooks.actorId()) return false;
        const until = b.lit_until || b.expires_at;
        return !until || new Date(until).getTime() > Date.now();
      };
      relightBtn.addEventListener('click', async () => {
        relightBtn.disabled = true;
        try {
          const beforeUntil = boardById(slot)?.lit_until || boardById(slot)?.expires_at;
          const data = await hooks.relight?.(slot);
          const days = Math.max(0, Math.floor(Number(data?.lit_days) || 0));
          stStreak.textContent = `연속 ${days}일`;
          note(data?.lit_until && beforeUntil && new Date(data.lit_until).getTime() <= new Date(beforeUntil).getTime() + 60000
            ? `오늘은 이미 켰어요. ${fmtLeft(lightLeft({ lit_until: data.lit_until, holder_id: 'x' }))} 남음`
            : `72시간 연장. ${fmtLeft(lightLeft({ lit_until: data.lit_until || beforeUntil, holder_id: 'x' }))} 남음`, 'ok');
        } catch (e) {
          note(e?.message || '불을 켜지 못했어요', 'err');
        }
        relightBtn.disabled = false;
        fillStats();
        renderPhoto(true);
        refreshBid();
      });

      const data = () => ({
        slot_id: slot, emoji: chars(emojiIn.value || state.emoji, 4) || '🔥', bg_theme: state.theme, text_color: state.ink,
        line1: state.gift ? chars('To. ' + toName.value.trim(), 16) : chars(lines[0].value, 16), line2: chars(lines[1].value, 16), line3: chars(lines[2].value, 16),
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
          else if (boardActive(b) && b.photo_status === 'approved' && b.photo_id) {
            photo = photoReady(b.photo_id);
            if (!photo) boardPhoto(b.photo_id).then((img) => { if (img && boardById(slot)?.photo_id === b.photo_id) paint(); });
          }
          // Someone else's dark slot shows the plaza notice. My dark slot shows the ad that comes back when I relight.
          const mineNow = !!(b?.holder_id && b.holder_id === hooks.actorId?.());
          const shown = state.gift || drafting || (mine && pic.img) ? data() : (b?.holder_id ? b : (hooks.boardView?.(slot) || data()));
          paintBillboard(canvas, shown, { ticker: !state.gift && mine && !drafting && boardActive(b) ? `👑 ${hooks.nick()}님의 광고가 지금 타임스퀘어에 송출됩니다` : '', photo: state.gift || drafting ? null : photo, pending: !state.gift && !drafting && b?.photo_status === 'pending' });
          canvas.parentElement?.classList.toggle('cropping', mine && !!pic.img);
        });
      };
      let drafting = false;
      const fee = () => ({ S: 1000, B: 300, C: 100 })[tierOf(slot)];
      const refreshPhotoGo = () => {
        const need = fee(), have = wallet.confirmed + wallet.pending;
        photoGo.disabled = !pic.img || !agree.checked || have < need;
        if (have < need) setIconText(photoGo, '', `사진 요금 ${money(need)} 코인이 필요해요`);
        else if (!agree.checked) setIconText(photoGo, '', '아래 안내를 확인하고 체크해 주세요');
        else setIconText(photoGo, 'camera', `${money(need)} 코인으로 사진 검수 신청`);
      };
      let photoKey = '';
      const renderPhoto = (force) => {
        const b = boardById(slot), mine = holds(b), st = mine ? b.photo_status || '' : '';
        capRow.hidden = !(mine && (pic.img || st === 'approved' || st === 'pending'));
        const key = [slot, mine, st, b?.photo_id || '', !!pic.img].join('|');
        if (!force && key === photoKey) return;
        photoKey = key;
        const head = h('div', { class: 'ph-head' }, h('b', null, ...withIcon('camera', '사진 광고')), h('span', { class: 'ph-fee', text: `${tierOf(slot)}급 +${money(fee())} 코인` }));
        if (!mine) {
          const mineDark = b?.holder_id === hooks.actorId() && !boardActive(b);
          photoBox.replaceChildren(head, h('p', { class: 'note', text: mineDark
            ? '불이 꺼져 있어요. 위쪽 불 켜기를 누르면 사진을 올릴 수 있어요.'
            : '전광판을 점령한 사람만 사진을 올릴 수 있어요. 운영자가 확인한 사진만 광장 전체에 송출되고, 확인 전에는 글자 전광판으로 보여요.' }));
          return;
        }
        if (st === 'pending') {
          photoBox.replaceChildren(head, h('div', { class: 'callout warn' }, icon('hourglass'), ' ', h('b', { text: '검수 중' }), ' — 운영자가 확인하면 바로 송출돼요. 거절되면 사진 요금은 전액 환불됩니다. 그동안은 글자 전광판으로 보여요.'));
          return;
        }
        const kids = [head];
        if (st === 'approved' && !pic.img) kids.push(h('div', { class: 'callout ok' }, icon('checkCircle'), ' ', h('b', { text: '사진 송출 중' }), ' — 새 사진으로 바꾸면 요금이 다시 들고, 검수 동안은 글자 전광판으로 보여요.'));
        kids.push(h('button', { class: 'btn ghost', type: 'button', onclick: () => photoFile.click() }, ...withIcon('image', pic.img ? '다른 사진 고르기' : st === 'approved' ? '사진 바꾸기' : '사진 고르기')));
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
        setIconText(photoGo, '', '사진 보내는 중…');
        try {
          const blob = await encodePhoto();
          if (!blob) throw new Error('사진을 300KB 아래로 줄이지 못했어요. 다른 사진으로 시도해 주세요');
          const photo = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
          await hooks.submitPhoto({ slot_id: slot, photo });
          pic.img = null;
          agree.checked = false;
          sfx.hit();
          note('사진을 보냈어요! 운영자가 확인하면 전광판에 송출됩니다', 'ok');
        } catch (e) {
          note(e?.message || '사진을 보내지 못했어요', 'err');
        }
        renderPhoto(true);
        refreshPhotoGo();
        paint();
      });
      const refreshBid = () => {
        paintBadge();
        const b = boardById(slot) || { slot_id: slot };
        const min = minBid(b, world.billboards, hooks.actorId?.(), [lines[0].value, lines[1].value, lines[2].value].join('\n'));
        const bid = Math.floor(Number(bidIn.value) || 0);
        const have = wallet.confirmed + wallet.pending;
        const mine = b.holder_id && b.holder_id === hooks.actorId();
        const mineLive = boardActive(b) && mine;
        if (mine && !mineLive) {
          go.disabled = true;
          setIconText(go, '', '위쪽 불 켜기로 다시 72시간');
          return;
        }
        const extra = mineLive ? Math.max(0, bid - (Number(b.current_bid) || 0)) : bid;
        const after = have - extra;
        balance.replaceChildren(h('span', null, '보유 ', h('b', { text: `${money(have)} 코인` })), h('span', null, mineLive ? '고친 뒤 ' : '점령 후 ', h('b', { class: after < 0 ? 'neg' : '', text: `${after < 0 ? '-' : ''}${money(Math.abs(after))} 코인` })));
        const locked = protectedLeft(b) > 0 && !mine;
        const closed = !mineLive && auctionClosed(slot, nowMs());
        const short = have < extra;
        go.disabled = locked || closed || bid < min || short;
        const label = mineLive ? (extra > 0 ? `문구 고치기 · 추가 ${money(extra)}` : '문구 고치기') : `${money(bid)} 코인으로 점령하기`;
        setIconText(go, !closed && locked ? 'lock' : '', closed ? '메인 타워는 밤 9시에 10분 열려요' : locked ? `보호 중 · ${fmtLeft(protectedLeft(b))} 후 입찰 가능` : short ? '코인이 부족해요' : bid < min ? `최소 ${money(min)} 코인부터 입찰` : label);
      };
      const fillStats = () => {
        const b = boardById(slot);
        const on = !!b?.holder_id;
        const active = boardActive(b);
        const pl = active ? protectedLeft(b) : 0;
        const ll = active ? lightLeft(b) : 0;
        const mineNow = b?.holder_id && b.holder_id === hooks.actorId?.();
        stHolder.textContent = !on ? '비어 있음 · 첫 주인이 될 자리' : !active ? (mineNow ? '내 칸 · 불 꺼짐' : `불 꺼짐 · ${b.holder_name || '익명'}`) : mineNow ? `내 점령 · ${fmtLeft(ll)} 남음` : `지금 주인 · ${b.holder_name || '익명'}`;
        stBid.textContent = active ? `${money(b.current_bid)} 코인` : `${money(minBid(b?.slot_id ? b : { slot_id: slot }, world.billboards, hooks.actorId?.()))} 코인부터`;
        stProt.textContent = !on ? '점령하면 72시간' : !active ? '불 꺼짐 · 다시 켜면 72시간' : mineNow ? `점령 남은 ${fmtLeft(ll)}` : pl > 0 ? `보호 ${fmtLeft(pl)} · 탈환 불가` : `보호 끝 · ${money(minBid(b, world.billboards, hooks.actorId?.()))}코인부터`;
        stProt.className = pl > 0 ? 'red' : '';
        const days = Math.max(0, Math.floor(Number(b?.lit_days) || 0));
        stStreak.textContent = days > 0 ? `연속 ${days}일` : '';
        relightBtn.hidden = !mineNow;
        ownRow.hidden = !mineNow;
        stScore.textContent = `택시 ${Math.floor(Number(b?.views) || 0)} · 응원 ${Math.floor(Number(b?.cheers) || 0)} · 링크 ${Math.floor(Number(b?.clicks) || 0)}`;
        const boost = chainBoost(world.billboards, slot);
        chainNote.hidden = !boost;
        chainNote.textContent = boost ? `이 건물을 한 쪽이 다 가지고 있어요. 응원하면 +${BALANCE.cheerGroup}` : '';
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
        const keep = !!b.holder_id;
        state.theme = keep && THEMES[b.bg_theme] ? b.bg_theme : 'cyber_navy';
        state.ink = keep && isColor(b.text_color) ? b.text_color : '#ffffff';
        emojiIn.value = keep && b.emoji ? b.emoji : '🔥';
        for (const btn of emoRow.querySelectorAll('button')) btn.classList.toggle('on', btn.textContent === emojiIn.value);
        lines[0].value = keep ? (b.line1 || '') : '';
        lines[1].value = keep ? (b.line2 || '') : '';
        lines[2].value = keep ? (b.line3 || '') : '';
        pic.img = null;
        state.capY = Math.min(88, Math.max(12, Number(b.caption_y) || 72));
        capIn.value = String(state.capY);
        capLabel.textContent = capWord(state.capY);
        urlField.hidden = false;
        urlIn.value = keep ? (b.external_url || '') : '';
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
        tipsEl.replaceChildren(...(zone === 'pick' ? list.map((id) => h('button', { class: 'chip', type: 'button', onclick: () => choose(id) }, ...withIcon('target', slotOption(id)))) : []));
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
      const giftTags = ['#스레드 품앗이', '#유튜브 대박', '#오늘생일', '#추첨명당'];
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
      for (const i of [emojiIn, ...lines]) i.addEventListener('input', () => { drafting = true; paint(); refreshBid(); });
      capIn.addEventListener('input', () => { state.capY = Number(capIn.value); capLabel.textContent = capWord(state.capY); paint(); });
      bidIn.addEventListener('input', refreshBid);
      const steps = h('div', { class: 'steps' },
        ...[50, 100, 500].map(n => h('button', { type: 'button', text: `+${n}`, onclick: () => { bidIn.value = String((Math.floor(Number(bidIn.value)) || 0) + n); refreshBid(); } })),
        h('button', { type: 'button', text: '최소', onclick: () => { bidIn.value = String(minBid(boardById(slot) || { slot_id: slot }, world.billboards, hooks.actorId?.())); refreshBid(); } }));
      const tribeGo = h('button', { class: 'btn ghost', type: 'button', text: '소속 코인으로 걸기' });
      const pledgeRow = h('div', { class: 'row' }, ...[10, 20, 50].map((n) => h('button', {
        type: 'button', class: 'btn ghost', text: `모금 ${n}`,
        onclick: async () => {
          try {
            const res = await hooks.pledge?.(slot, n);
            if (!res) { note('10, 20, 50만 모을 수 있어요', 'err'); return; }
            note(`소속 모금 ${n}`, 'ok');
          } catch (e) {
            const msg = e?.message === 'tribe' ? '소속에 들어간 뒤에 모금할 수 있어요' : (e?.message || '모금하지 못했어요');
            note(msg, 'err');
            if (e?.message === 'tribe' || msg.startsWith('소속에 들어간')) openTribeSheet();
          }
        },
      })));
      const placeBoard = async (mode) => {
        const b = boardById(slot) || { slot_id: slot };
        if (mode !== 'tribe' && b.holder_id === hooks.actorId?.() && !boardActive(b)) {
          note('불 켜기로 다시 72시간을 이을 수 있어요', 'err');
          return;
        }
        const mineLive = mode !== 'tribe' && boardActive(b) && b.holder_id === hooks.actorId?.();
        if (mineLive) mode = 'edit';
        const bid = Math.floor(Number(bidIn.value) || 0);
        const have = wallet.confirmed + wallet.pending;
        const extra = mode === 'edit' ? Math.max(0, bid - (Number(b.current_bid) || 0)) : bid;
        if (state.gift && !toName.value.trim()) { note('받는 사람 이름을 적어 주세요', 'err'); return; }
        const draft = data();
        if (blockedText(draft.line1) || blockedText(draft.line2) || blockedText(draft.line3) || blockedText(hooks.nick?.())) {
          note('그 문구는 올릴 수 없어요', 'err');
          return;
        }
        const floor = minBid(b, world.billboards, hooks.actorId?.(), [lines[0].value, lines[1].value, lines[2].value].join('\n'));
        if (mode !== 'edit' && auctionClosed(slot, nowMs())) { note('메인 타워는 밤 9시부터 10분 동안만 점령할 수 있어요', 'err'); return; }
        if (mode !== 'tribe' && (have < extra || bid < floor)) {
          note(have < extra ? `코인이 부족해요. 지금 ${money(have)}, ${money(extra)} 필요` : `최소 ${money(floor)} 코인부터 입찰`, 'err');
          refreshBid();
          return;
        }
        if (mode === 'tribe' && bid < floor) { note(`최소 ${money(floor)} 코인부터 입찰`, 'err'); return; }
        go.disabled = true;
        tribeGo.disabled = true;
        setIconText(go, '', mode === 'edit' ? '고치는 중…' : '점령 중…');
        let link = urlIn.value.trim();
        if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
        if (link) {
          const kept = allowedLink(link);
          if (!kept) {
            note('인스타, 스레드, 유튜브, 스마트스토어 주소만 저장됩니다', 'err');
            refreshBid();
            tribeGo.disabled = false;
            return;
          }
          link = kept;
        }
        try {
          const d = data();
          const payload = { slot_id: slot, bid, line1: d.line1, line2: d.line2, line3: d.line3, caption_y: d.caption_y, emoji: d.emoji, bg_theme: d.bg_theme, text_color: d.text_color, external_url: link };
          if (mode === 'tribe' || mode === 'edit') payload.mode = mode;
          const res = await hooks.claim(payload);
          if (res?.review_id) {
            closeSheet();
            return;
          }
        } catch (e) {
          const msg = e?.message === 'tribe' ? '소속에 들어간 뒤에 소속 코인으로 걸 수 있어요' : (e?.message || '점령에 실패했습니다');
          note(msg, 'err');
          if (msg.startsWith('소속에 들어간')) openTribeSheet();
          refreshBid();
          go.disabled = false;
          tribeGo.disabled = false;
          return;
        }
        const giftName = state.gift ? toName.value.trim() : '';
        closeSheet();
        sfx.jackpot();
        note(mode === 'edit' ? '문구를 고쳤어요' : giftName ? `${giftName}님 선물을 걸었습니다` : '전광판에 등록됐습니다', 'ok');
        if (mode === 'edit') return;
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
              h('button', { class: 'btn primary', type: 'button', onclick: () => openBillboard(nxt.id) }, ...withIcon('bolt', '연속으로 점령하기')),
            );
          }, true);
        }
      };
      go.addEventListener('click', () => placeBoard('claim'));
      tribeGo.addEventListener('click', () => placeBoard('tribe'));
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
          placeEl,
          h('div', { class: 'screen' }, canvas),
          h('div', { class: 'holder' },
            h('div', { class: 'stat' }, h('small', { text: '현재 점령자' }), stHolder),
            h('div', { class: 'stat' }, h('small', { text: '현재 입찰가' }), stBid),
            h('div', { class: 'stat' }, h('small', { text: '보호 시간' }), stProt),
            h('div', { class: 'stat' }, h('small', { text: '연속' }), stStreak),
            h('div', { class: 'stat' }, h('small', { text: '반응' }), stScore),
            relightBtn,
            ownRow,
            chainNote),
        ),
        h('div', null,
          h('div', { class: 'seg' }, wishBtn, giftBtn),
          toField,
          tagRow,
          h('div', { class: 'field' }, h('label', null, '내 광고 문구'), h('div', { class: 'lines' }, ...lines)),
          h('div', { class: 'field' }, h('label', null, '입찰 코인'), h('div', { class: 'bid' }, bidIn, steps), balance),
          go,
          tribeGo,
          h('div', { class: 'field' }, h('label', null, '소속 모금', h('span', { text: '10 · 20 · 50' })), pledgeRow),
          (stickers = stickerBox(() => slot)),
          airBar(),
          h('details', { class: 'more' },
            h('summary', { text: '배경 · 글자색 · 링크' }),
            h('div', { class: 'field' }, h('label', null, '이모지'), emo),
            h('div', { class: 'field' }, h('label', null, '배경'), themes),
            h('div', { class: 'field' }, h('label', null, '글자색'), inks),
            urlField,
            photoBox, capRow, photoFile),
        ),
      ));
      showZone(zone || (slotId && slotId !== 'MAIN_TOP' ? (towerIds.includes(slotId) ? 'tower' : String(slotId).startsWith('STREET_') ? 'hot' : 'cheap') : 'pick'), slotId);
      fontsReady('타임스퀘어 전광판 점령 ' + hooks.nick()).then(paint);
      return () => { clearInterval(timer); cancelAnimationFrame(raf); };
    }, false, 'bill');
  }
  // The holder's report (GET /rt/ad-report through hooks.adReport). Only real counts since this holder's claim; no estimates.
  function openAdReport(slot) {
    openSheet(['chart', '내 전광판 리포트'], slotName(slot), (host) => {
      const body = h('div', null, h('p', { class: 'note', text: '불러오는 중…' }));
      const copyBox = h('div', { class: 'manual-copy', hidden: true });
      const share = h('button', { class: 'btn gold', type: 'button', text: '이 전광판 링크 공유하기', onclick: async () => {
        if (await sendLink({ kind: 'invite', url: cardUrl(slot), native: true, into: copyBox }) === 'copied') note('링크를 복사했어요', 'ok');
      } });
      host.append(body, share, copyBox, h('button', { class: 'btn ghost', type: 'button', text: '전광판으로 돌아가기', onclick: () => openBillboard(slot) }));
      let alive = true;
      const md = (day) => `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일`;
      const render = (r) => {
        const s = adSums(r.days, r.today), bars = adBars(r.days, r.today, r.since), top = Math.max(1, ...bars.map((b) => b.n));
        const cell = (text, head) => h(head ? 'small' : 'b', { class: head ? '' : 'tnum', text: String(text), style: { textAlign: head ? 'left' : 'right' } });
        const rows = [['', '오늘', '7일', '14일'], ['택시 손님', s.today.views, s.d7.views, s.d14.views], ['응원', s.today.cheers, s.d7.cheers, s.d14.cheers], ['링크 방문', s.today.clicks, s.d7.clicks, s.d14.clicks], ['반응한 사람', s.today.people, s.d7.people, s.d14.people]];
        const table = h('div', { style: { display: 'grid', gridTemplateColumns: 'auto repeat(3, 1fr)', gap: '6px 12px', alignItems: 'baseline', marginTop: '6px' } },
          ...rows.flatMap((row, i) => row.map((v, j) => (i === 0 ? h('small', { text: v, style: { textAlign: j ? 'right' : 'left' } }) : j === 0 ? cell(v, true) : cell(money(v))))));
        const chart = h('div', { role: 'img', 'aria-label': `14일 동안 하루 반응 수: ${bars.map((b) => (b.before ? '-' : b.n)).join(', ')}`, style: { display: 'flex', alignItems: 'flex-end', gap: '3px', height: '96px', marginTop: '14px' } },
          ...bars.map((b) => h('div', { title: `${md(b.day)} · ${b.before ? '기록 전' : b.n}`, style: { flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', height: '100%', minWidth: '0' } },
            h('div', { style: { width: '100%', height: b.before ? '2px' : b.n ? `${Math.max(4, Math.round(b.n / top * 72))}px` : '2px', borderRadius: '3px 3px 0 0', background: b.before ? 'var(--surface-2)' : b.n ? 'var(--accent)' : 'var(--muted)' } }),
            h('small', { class: 'tnum', text: String(Number(b.day.slice(8, 10))), style: { fontSize: '12px', marginTop: '3px', color: 'var(--muted)', opacity: b.before ? '.4' : '1' } }))));
        const kids = [table, chart, h('p', { class: 'note', text: `${md(new Date(Date.parse(r.since) + 9 * 36e5).toISOString().slice(0, 10))}부터 센 숫자예요. 막대는 하루의 택시 손님·응원·링크 방문을 더한 수예요.` }),
          h('p', { class: 'note', text: '택시 손님은 이 전광판 앞에 내린 택시, 링크 방문은 코인이 들어간 방문, 반응한 사람은 그날 셋 중 하나라도 한 계정 수예요. 사람 수는 하루마다 따로 세어 더해요.' })];
        if (s.d14.views + s.d14.cheers + s.d14.clicks < AD.small) kids.unshift(h('div', { class: 'callout warn', text: '아직 본 사람이 적어요. 링크를 공유하면 늘어요' }));
        body.replaceChildren(...kids);
      };
      Promise.resolve(hooks.adReport?.(slot)).then((r) => {
        if (!alive) return;
        if (!r?.ok || !Array.isArray(r.days)) throw new Error('리포트를 불러오지 못했어요. 잠시 뒤 다시 해 주세요.');
        render(r);
      }).catch((e) => { if (alive) body.replaceChildren(h('p', { class: 'note', text: e?.message || '리포트를 불러오지 못했어요' })); });
      return () => { alive = false; };
    }, true);
  }
  // A QR of the board's share page (/rt/card/<slot>) with the first line under it, as a PNG to print for the counter.
  function openAdQr(slot) {
    const url = cardUrl(slot), b = boardById(slot);
    openSheet('QR 코드', slotName(slot), (host) => {
      let qr = null; try { qr = qrEncode(url); } catch { qr = null; }
      if (!qr) { host.append(h('p', { class: 'note', text: 'QR 코드를 만들지 못했어요' })); return; }
      const caption = chars(String(b?.line1 || '').trim(), 16) || slotName(slot);
      const canvas = paintQr(makeCanvas(1, 1), qr, { scale: 16, caption, sub: '찍으면 타임스퀘어의 이 전광판으로 가요' });
      Object.assign(canvas.style, { display: 'block', width: '100%', maxWidth: '300px', margin: '6px auto 0', borderRadius: '10px', background: '#fff', imageRendering: 'pixelated' });
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${slotName(slot)} 전광판으로 가는 QR 코드`);
      const save = h('button', { class: 'btn gold', type: 'button', text: 'PNG로 저장', onclick: () => {
        canvas.toBlob((blob) => {
          if (!blob) { note('저장하지 못했어요', 'err'); return; }
          const a = document.createElement('a'), href = URL.createObjectURL(blob);
          a.href = href; a.download = `wishboard-qr-${slot}.png`; a.click();
          setTimeout(() => URL.revokeObjectURL(href), 4000);
        }, 'image/png');
      } });
      host.append(canvas, h('p', { class: 'note', text: '계산대 옆에 붙여 두세요. 휴대폰 카메라로 찍으면 이 전광판 앞으로 바로 와요.' }), h('p', { class: 'note', text: url }), save,
        h('button', { class: 'btn ghost', type: 'button', text: '전광판으로 돌아가기', onclick: () => openBillboard(slot) }));
    }, true);
  }

  function openPlot(plotId) {
    const id = Number(plotId);
    const slot = PLOT_SLOTS[id - 1];
    if (!slot) return;
    openSheet(['building', `${id}번 토지`], `K-타운 · 32번가 ${slot.side === 'N' ? '북쪽' : '남쪽'}`, (host) => {
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
      const holdMs = plot.updated_at ? new Date(plot.updated_at).getTime() + 7 * 86400000 - Date.now() : 0;
      const busy = owned && !mine && level > 0 && holdMs > 0;
      const holdLabel = holdMs > 86400000 ? `${Math.ceil(holdMs / 86400000)}일 뒤 인수할 수 있어요` : `${Math.max(1, Math.ceil(holdMs / 3600000))}시간 뒤 인수할 수 있어요`;
      const [labelIcon, label] = level >= 4 && mine ? ['building', '최고층 타워 완성!'] : mine ? ['arrowUp', `${LEVELS[target].t}로 증축 · ${money(price)} 코인`] : busy ? ['', holdLabel] : owned ? ['coin', `인수 시도 · ${money(price)} 코인`] : ['building', `분양받기 · ${money(price)} 코인`];
      if (level >= 4 && mine) signIn.disabled = true;
      const go = h('button', { class: 'btn gold cta', type: 'button', disabled: (level >= 4 && mine) || busy });
      setIconText(go, labelIcon, label);
      go.addEventListener('click', async () => {
        if (blockedText(signIn.value) || blockedText(hooks.nick?.())) { note('그 간판은 올릴 수 없어요', 'err'); return; }
        if ((wallet.confirmed + wallet.pending) < price) { note(`코인이 부족해요. 지금 ${money(wallet.confirmed + wallet.pending)}, ${money(price)} 필요`, 'err'); return; }
        go.disabled = true;
        setIconText(go, '', '계약 중…');
        try {
          await hooks.buy({ plot_id: id, sign_text: chars(signIn.value, 14), theme_color: color });
          closeSheet();
          sfx.jackpot();
          note(mine ? '건물이 한 층 더 올라갔습니다!' : '이 땅의 주인이 되었습니다!', 'ok');
          hooks.focusShot?.('PLOT_' + id);
          showProof('PLOT_' + id);
        } catch (e) {
          note(e?.message || '분양에 실패했습니다', 'err');
          go.disabled = false;
          setIconText(go, labelIcon, label);
        }
      });
      const board = boardById('PLOT_' + id);
      host.append(
        placeRow(slot),
        levels,
        h('div', { class: 'holder' },
          h('div', { class: 'stat' }, h('small', { text: '건물주' }), h('b', null, ...(owned ? withIcon('crown', `${plot.owner_name || '익명'}${linkedActor(plot.owner_id) ? ' ✓' : ''}${mine ? ' (나)' : ''}`) : ['주인 없음']))),
          h('div', { class: 'stat' }, h('small', { text: owned ? '다음 증축가' : '분양가' }), h('b', { class: 'gold', text: `${money(price)} 코인` })),
          h('div', { class: 'stat' }, h('small', { text: '외벽 전광판' }), h('b', { text: boardActive(board) ? `광고 중 · ${board.holder_name || ''}` : (board?.holder_id ? `불 꺼짐 · ${board.holder_name || ''}` : '광고 모집 중') }))),
        h('button', { class: 'btn ghost', type: 'button', text: boardActive(board) ? '외벽 전광판 열기' : (board?.holder_id === hooks.actorId() ? '내 전광판 다시 켜기' : '외벽 전광판에 소원 걸기'), onclick: () => openAd('PLOT_' + id) }),
        h('div', { class: 'callout' }, h('b', null, ...withIcon('coin', '건물주 패시브 수익')), ' — 이 건물 외벽 전광판(', h('b', { text: `PLOT_${id}` }), ')에 다른 유저가 광고를 걸 때마다 입찰 코인의 ', h('b', { text: '50%' }), '가 내 지갑으로 자동 입금됩니다.'),
        h('div', { class: 'field' }, h('label', null, '네온 간판', h('span', { text: level >= 4 && mine ? '최고층이라 간판은 고정이에요' : '미리보기 · 계약하면 광장에 붙어요' })), signIn, prev),
        h('div', { class: 'field' }, h('label', null, '네온 컬러'), sw),
        go,
        h('p', { class: 'note', text: '빈 땅이거나 건물주가 7일 동안 비운 건물만 인수할 수 있어요. 증축할수록 건물이 커지고 간판과 전광판이 더 높이 올라갑니다.' }),
      );
      paint();
      fontsReady(signIn.value).then(paint);
    }, true);
  }

  function openHub() {
    openSheet(['coin', '황금 ATM'], 'EXCHANGE', (host) => {
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
          h('b', null, ...withIcon('pin', '토지는 K-타운 분양 구역에 있어요')),
          h('span', { text: 'W 32nd St (코리아웨이) · 브로드웨이와 5번가 사이 · 타임스퀘어에서 남쪽으로 약 1km' })),
        h('div', { class: 'go' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => goWaypoint(lotCenter, 'K-타운 분양 구역') }, ...withIcon('pin', '길안내')),
          h('button', { class: 'btn gold', type: 'button', onclick: () => goTeleport(lotCenter, 'K-타운 분양 구역') }, ...withIcon('bolt', '바로 가기'))),
        mine.length ? h('div', { class: 'mine' }, h('small', { text: '내 건물' }), ...mine.map(s => h('button', { class: 'chip-btn', type: 'button', onclick: () => goTeleport(plotFront(s), `내 건물(${s.id}번)`) }, icon('building'), ` ${s.id}번 `, icon('bolt')))) : null);
      host.append(
        h('div', { class: 'holder' },
          h('div', { class: 'stat' }, h('small', { text: '내 지갑' }), h('b', { class: 'gold', text: `${money(wallet.confirmed + wallet.pending)} 코인` })),
          h('div', { class: 'stat' }, h('small', { text: '내 건물' }), h('b', { text: `${world.plots.filter(p => p.owner_id && p.owner_id === hooks.actorId()).length}채` })),
          h('div', { class: 'stat' }, h('small', { text: '내 전광판' }), h('b', { text: `${myBoards().length}개` }))),
        h('div', { class: 'hub', style: { marginTop: '14px' } },
          h('button', { type: 'button', onclick: () => openBillboard('MAIN_TOP') }, h('img', { class: 'big', src: 'icons/board.jpg?v=4', alt: '', draggable: 'false' }), h('h4', { text: '전광판 점령' }), h('p', { text: 'S급 메인 타워부터 거리 전광판까지. 내 문구가 광장 모두의 화면에 송출돼요.' })),
          h('button', { type: 'button', onclick: () => openPlot(PLOT_SLOTS.find(s => !plotById(s.id)?.owner_id)?.id || 1) }, h('img', { class: 'big', src: LEVELS[4].src, alt: '', draggable: 'false' }), h('h4', { text: '토지 분양 · 증축' }), h('p', { text: '텐트에서 타워까지 5단계. 외벽 광고 수익의 50%는 건물주 몫!' }))),
        where,
        h('div', { class: 'field' }, h('label', null, 'K-타운 토지 현황', h('span', { text: '1~18번 · 번호를 눌러 상세 보기' })), plots),
      );
    });
  }

  function openWalletInfo() {
    openSheet(['coin', '내 지갑'], 'COINS', (host) => {
      const stat = (label, el) => h('div', { class: 'stat' }, h('small', { text: label }), el);
      const doneEl = h('b', { class: 'gold tnum' }), waitEl = h('b', { class: 'tnum' }), sumEl = h('b', { class: 'tnum' }), ticketEl = h('b', { class: 'tnum' });
      const fill = () => {
        doneEl.textContent = `${money(wallet.confirmed)} 코인`;
        waitEl.textContent = `+${money(wallet.pending)} 코인`;
        sumEl.textContent = `${money(wallet.confirmed + wallet.pending)} 코인`;
        ticketEl.textContent = `${Math.max(0, Math.floor(Number(wallet.tickets) || 0))}장`;
      };
      fill();
      const timer = setInterval(fill, 1000);
      const now = Date.now();
      const buyers = world.billboards.filter((b) => {
        if (!b.holder_id || b.holder_id === hooks.actorId()) return false;
        const until = b.lit_until || b.expires_at;
        const exp = until ? new Date(until).getTime() : 0;
        return exp > now;
      });
      const pick = h('select', { class: 'slot-pick', 'aria-label': '코인을 받을 사람' });
      for (const b of buyers) pick.append(h('option', { value: b.slot_id, text: `${b.holder_name || '익명'} · ${slotName(b.slot_id)}` }));
      const sellBox = buyers.length
        ? h('div', { class: 'field' }, h('label', null, '광고주에게 코인 보내기', h('span', { text: '정산된 코인 · 10 / 20 / 50' })),
          h('p', { class: 'note', text: '고른 전광판 주인의 지갑으로 내 코인이 그대로 넘어갑니다. 되돌려 받는 금액은 없어요.' }), pick,
          h('div', { class: 'steps', style: { marginTop: '8px' } }, ...[10, 20, 50].map((n) => {
            const btn = h('button', { class: 'btn ghost', type: 'button', text: `${n}코인 보내기` });
            btn.addEventListener('click', async () => {
              if (wallet.confirmed < n) { note(`정산된 코인이 부족해요. 지금 ${money(wallet.confirmed)}`, 'err'); return; }
              btn.disabled = true;
              try {
                const res = await hooks.sell?.({ slot_id: pick.value, amount: n });
                fill();
                if (res?.ok) note(`${res.buyer_name || '광고주'}에게 ${n}코인을 보냈어요`, 'ok');
                else note(res?.error || '아직 보낼 수 없어요. 정산이 끝난 코인인지 확인해 주세요', 'err');
              } catch (e) {
                note(e?.message || '코인을 보내지 못했어요', 'err');
              }
              btn.disabled = false;
            });
            return btn;
          })))
        : h('p', { class: 'note', text: '지금 전광판을 가진 다른 사람이 없어요. 생기면 여기서 코인을 보낼 수 있어요.' });
      const info = hooks.walletInfo?.() || {};
      const refresh = h('button', { class: 'btn ghost cta', type: 'button' }, ...withIcon('refresh', '잔액 새로고침'));
      refresh.addEventListener('click', async () => {
        refresh.disabled = true;
        try {
          const ok = await hooks.refreshWallet?.();
          fill();
          note(ok === false ? '잔액을 불러오지 못했어요' : '잔액을 새로 불러왔어요', ok === false ? 'err' : 'ok');
        } catch (e) {
          note(e?.message || '잔액을 불러오지 못했어요', 'err');
        }
        refresh.disabled = false;
      });
      host.append(
        h('div', { class: 'holder', style: { marginTop: 0 } }, stat('정산 완료', doneEl), stat('정산 대기', waitEl), stat('합계', sumEl), stat('VIP 티켓', ticketEl)),
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
    openSheet(['board', '광장 소식'], null, (host) => {
      host.append(items.length
        ? h('div', { class: 'ranks board' }, ...items.map((n) => {
          const slot = n.dataset.slot || '';
          return h(slot ? 'button' : 'div', { type: slot ? 'button' : null, class: 'rank', text: n.textContent, onclick: slot ? () => { closeSheet(); hooks.focusShot?.(slot); } : null });
        }))
        : h('p', { class: 'note', text: '아직 소식이 없어요.' }));
    }, true);
  }
  function bestLiveSlot(actorId) {
    let live = null;
    let dark = null;
    for (const b of world.billboards) {
      if (b.holder_id !== actorId) continue;
      const bid = Number(b.current_bid) || 0;
      if (boardActive(b)) {
        if (!live || bid > Number(live.current_bid)) live = b;
      } else if (!dark || bid > Number(dark.current_bid)) dark = b;
    }
    return (live || dark)?.slot_id || '';
  }
  // 주간 리그: /rt/world's top 10 of this KST week (a cached copy of an older week counts as empty) and my last /rt/league answer.
  function weekRows() { const wk = world.week; return wk && wk.week === leagueWeek() && Array.isArray(wk.top) ? wk.top : []; }
  function myLeague() { const lg = hooks.league?.(); return lg && lg.week === leagueWeek() ? lg : null; }
  let liveSigNow = '';
  function paintLive() {
    if (newbieOn) return; // hidden by newcomer mode (#ui.newbie .liveboard): the first tick after graduation paints it
    const rows = weekRows().slice(0, 5);
    const me = myLeague()?.me || null;
    const sig = liveSig(rows, me);
    if (sig === liveSigNow) return; // nothing changed: no DOM write
    liveSigNow = sig;
    const rankButtons = rows.length ? rows.map((r, i) => h('button', { type: 'button', class: 'rank' + (me && me.rank === i + 1 ? ' me' : ''), title: '순위 열기', onclick: () => openRanks() },
      h('span', { class: 'n', text: String(i + 1) }),
      h('b', { text: String(r.nick || '네온손님') }),
      h('span', { class: 'pts tnum', text: money(Number(r.spent) || 0) }))) : [h('p', { class: 'empty', text: '이번 주는 아직 비어 있어요' })];
    if (me && me.rank >= 1) rankButtons.push(h('p', { class: 'empty', text: leagueLine(me) }));
    rankRows.replaceChildren(...rankButtons);
  }
  let rankRefresh = null;
  let adRefresh = null;
  const TAG_RE = /#[0-9A-Za-z가-힣_]{1,16}/g;
  function liveBoards() {
    const now = Date.now();
    return world.billboards.filter((b) => {
      if (!b.holder_id) return false;
      const until = b.lit_until || b.expires_at;
      return !!(until && new Date(until).getTime() > now);
    });
  }
  function hotBoards() {
    return liveBoards()
      .map((b) => ({ ...b, heat: (Number(b.views) || 0) + (Number(b.cheers) || 0) }))
      .sort((a, b) => b.heat - a.heat);
  }
  function teamBoards() {
    const map = new Map();
    for (const b of world.billboards) {
      if (!b.holder_id) continue;
      const heat = (Number(b.views) || 0) + (Number(b.cheers) || 0);
      const tags = new Set([b.line1, b.line2, b.line3, b.holder_name].join(' ').match(TAG_RE) || []);
      for (const tag of tags) {
        const row = map.get(tag) || { tag, heat: 0, n: 0, slot: b.slot_id, best: -1 };
        row.heat += heat;
        row.n += 1;
        if (heat >= row.best) { row.slot = b.slot_id; row.best = heat; }
        map.set(tag, row);
      }
    }
    return [...map.values()].sort((a, b) => b.heat - a.heat || b.n - a.n).slice(0, 5);
  }
  function openRanks() {
    openSheet(['trophy', '소원 랭킹'], 'NOW', (host) => {
      const list = h('div', { class: 'ranks' });
      const note = h('p', { class: 'note' });
      const meEl = h('p', { class: 'note' });
      let tab = 'week', weekState = 'wait';
      Promise.resolve(hooks.loadLeague?.()).then((r) => { weekState = r ? 'ok' : 'fail'; }, () => { weekState = 'fail'; }).then(() => { if (rankRefresh === paint) paint(); });
      const go = (slot) => { closeSheet(); hooks.focusShot?.(slot); };
      const linkBtn = (b) => {
        const url = /^https:\/\//.test(String(b.external_url || '')) ? b.external_url : '';
        return url ? h('button', { type: 'button', class: 'mini', text: '링크 열기', onclick: () => hooks.adClick?.(b.slot_id, url) }) : null;
      };
      const paint = () => {
        hooks.syncCrown?.();
        meEl.hidden = tab !== 'week';
        if (tab === 'week') {
          // The /rt/league answer once it is here (my row marked), the world's top 10 until then.
          const lg = myLeague(), rows = lg ? lg.top : weekRows().map((r, i) => ({ rank: i + 1, nick: r.nick, spent: r.spent, mine: false }));
          list.replaceChildren(...(rows.length ? rows.map((r) => h('div', { class: 'rank' + (r.mine ? ' me' : '') },
            h('span', { class: 'n', text: String(r.rank) }),
            h('b', { text: String(r.nick || '네온손님') }),
            h('span', { class: 'pts tnum', text: money(Number(r.spent) || 0) }))) : [h('p', { class: 'note', text: '이번 주에는 아직 코인을 쓴 사람이 없어요.' })]));
          meEl.textContent = lg?.me ? leagueLine(lg.me) : weekState === 'wait' ? '내 순위를 불러오는 중…' : weekState === 'fail' ? '내 순위를 불러오지 못했어요' : '';
          note.textContent = '월요일 0시(한국 시간)부터 이번 주에 전광판·분양·사진·스티커·장악에 쓴 코인이에요. 빼앗기거나 거절되어 돌려받은 코인은 그 코인을 쓴 주에서 빠져요.';
          return;
        }
        if (tab === 'spent') {
          const held = (id) => bestLiveSlot(id);
          const rows = standings().slice(0, 20);
          list.replaceChildren(...(rows.length ? rows.map((r, i) => {
            const slot = held(r.id);
            return h('div', { class: 'rank' + (r.id === hooks.actorId?.() ? ' me' : '') },
              h('span', { class: 'n', text: String(i + 1) }),
              h('b', { text: r.name }),
              r.linked ? h('i', { class: 'verified', title: '인증 계정' }, icon('check')) : null,
              h('span', { class: 'pts tnum', text: money(r.score) }),
              slot ? h('button', { type: 'button', class: 'mini', text: '보러가기', onclick: () => go(slot) }) : null);
          }) : [h('p', { class: 'note', text: '아직 전광판에 넣은 금액이 없어요.' })]));
          note.textContent = '점령에 낸 코인입니다. 만료되거나 빼앗겨도 빠지지 않습니다.';
          return;
        }
        if (tab === 'team') {
          const rows = teamBoards();
          list.replaceChildren(...(rows.length ? rows.map((r, i) => h('div', { class: 'rank' },
            h('span', { class: 'n', text: String(i + 1) }),
            h('b', { text: `${r.tag} · ${r.n}곳` }),
            h('span', { class: 'pts tnum', text: String(r.heat) }),
            h('button', { type: 'button', class: 'mini', text: '열기', onclick: () => openAd(r.slot) }),
            h('button', { type: 'button', class: 'mini', text: '보러가기', onclick: () => go(r.slot) }))) : [h('p', { class: 'note', text: '아직 해시태그가 없어요. 문구에 #스레드 처럼 넣어 보세요.' })]));
          note.textContent = '문구에 넣은 #태그입니다. 메인 타워 지붕은 한 주 동안 소속 점수 1위였던 소속에게 가요.';
          return;
        }
        const rows = hotBoards().slice(0, 10);
        list.replaceChildren(...(rows.length ? rows.map((b, i) => h('div', { class: 'rank' },
          h('span', { class: 'n', text: String(i + 1) }),
          h('b', { text: [b.line1, b.line2, b.line3].map((s) => String(s || '').trim()).filter(Boolean).join(' · ') || b.holder_name || b.slot_id }),
          h('span', { class: 'pts tnum', text: String(b.heat) }),
          h('button', { type: 'button', class: 'mini', text: '열기', onclick: () => openAd(b.slot_id) }),
          h('button', { type: 'button', class: 'mini', text: '보러가기', onclick: () => go(b.slot_id) }),
          linkBtn(b))) : [h('p', { class: 'note', text: '아직 걸린 소원이 없어요.' })]));
        note.textContent = '응원 수와 택시가 선 횟수를 더합니다. 1위 전광판 위로 황금 빛기둥이 섭니다.';
      };
      const tabBtn = (id, text) => h('button', { type: 'button', class: id === tab ? 'on' : '', text, onclick: (e) => { tab = id; for (const c of e.currentTarget.parentElement.children) c.classList.toggle('on', c === e.currentTarget); paint(); } });
      rankRefresh = paint;
      paint();
      host.append(h('div', { class: 'seg' }, tabBtn('week', '이번 주'), tabBtn('spent', '누적'), tabBtn('hot', '실시간 인기 소원'), tabBtn('team', '해시태그')), meEl, list, note);
      return () => { rankRefresh = null; };
    }, false, 'steady');
  }
  function openCredits() {
    openSheet(['info', '정보 · 출처'], null, (host) => {
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
    openSheet(['user', '내 캐릭터'], null, (host) => {
      const input = h('input', { class: 'input', maxLength: 16, value: hooks.nick(), placeholder: '닉네임 (16자)' });
      let color = hooks.color();
      let species = hooks.species();
      const save = h('button', { class: 'btn gold cta', type: 'button', text: '저장하기', onclick: async () => {
        if (save.disabled) return;
        const name = chars(input.value, 16).trim() || hooks.nick();
        if (blockedText(name) || botNick(name)) { note('그 이름은 쓸 수 없어요', 'err'); return; }
        save.disabled = true;
        save.textContent = '저장 중…';
        try {
          await Promise.all([hooks.rename(name), hooks.recolor(color), hooks.reshape(species)]);
          renderProfile();
          closeSheet();
          note('프로필을 저장했어요', 'ok');
        } catch (e) {
          note(e?.message || '프로필을 저장하지 못했어요', 'err');
          save.disabled = false;
          save.textContent = '저장하기';
        }
      } });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
      const fields = [
        h('div', { class: 'field' }, h('label', null, '닉네임'), input),
        h('div', { class: 'field' }, h('label', null, '발밑 링 색', h('span', { text: '캐릭터 색이 아니라, 발밑 동그라미입니다' })), colorPicker(color, (c) => { color = c; })),
      ];
      if (SPECIES.length > 1) fields.splice(1, 0, h('div', { class: 'field' }, h('label', null, '캐릭터'), speciesPicker(species, (id) => { species = id; hooks.wantSpecies?.(id); })));
      const prof = hooks.profile?.() || { level: 1, reputation: 0, equip: [], owned: [] };
      const equipped = new Set(Array.isArray(prof.equip) ? prof.equip : []);
      const owned = new Set(Array.isArray(prof.owned) ? prof.owned : []);
      fields.push(h('p', { class: 'note', text: `레벨 ${Math.min(99, Math.max(1, Math.floor(Number(prof.level) || 1)))} · 명성 ${Math.max(0, Math.floor(Number(prof.reputation) || 0))}` }));
      if (hooks.wear) {
        const catalog = [['hat_ribbon', '리본 모자'], ['cab_yellow', '노란 택시'], ['frame_streak', '연속 테두리']].filter(([id]) => owned.has(id));
        if (!catalog.length) fields.push(h('p', { class: 'note', text: '출석 7일마다 리본 모자, 노란 택시, 연속 테두리가 열립니다.' }));
        else {
          const wearRow = h('div', { class: 'species' });
          for (const [id, label] of catalog) {
            const b = h('button', { type: 'button', class: equipped.has(id) ? 'on' : '', text: label, onclick: async () => { if (await hooks.wear(id)) b.classList.add('on'); } });
            wearRow.append(b);
          }
          fields.push(h('div', { class: 'field' }, h('label', null, '보관함'), wearRow));
        }
      }
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
  function openLinkPrompt() {
    if (quietBlock) return;
    openSheet('계정 연결', '+300', (host) => {
      host.append(
        h('div', { class: 'callout warn', style: { marginTop: 0 } }, '창을 닫기 전에 계정을 연결하면 전광판과 수익이 남아요. 연결하면 +300코인.'),
        h('button', { class: 'btn gold cta', type: 'button', text: '계정 연결 +300', onclick: () => openLogin() }),
        h('button', { class: 'btn ghost', type: 'button', text: '나중에', onclick: () => closeSheet() }),
      );
    }, true);
  }
  // The prompt is only queued here. pumpLink opens it once per session, after the screen has been quiet for a moment,
  // so it never lands on a claim celebration, the proof bar, an intro or focus camera, or an arrival card.
  let linkWant = false, linkQuietAt = 0, linkAsked = false;
  try { linkAsked = sessionStorage.getItem('kts_link_asked') === '1'; } catch { /* private mode */ }
  function promptLink(reason) {
    if (linkAsked || reason === 'vip') return;
    if (!accountView.ready || !accountView.guest || accountView.linked) return;
    if (reason === 'coins' && (!entered || (wallet.confirmed + wallet.pending) < 100)) return;
    linkWant = true;
  }
  function setQuietBlock(on) {
    quietBlock = !!on;
    if (!quietBlock) pumpQueued();
    if (quietBlock || !proofWait) return;
    const w = proofWait;
    proofWait = null;
    showProof(w.slot, w.gift);
  }
  function openCheerReply(slot, to) {
    if (!slot || !to) return;
    openSheet('답례', null, (host) => {
      host.append(h('p', { class: 'note', text: '정해진 문구만 보낼 수 있어요. 그 사람이 이 채널에 있을 때만 도착해요.' }));
      host.append(h('div', { class: 'chips' }, ...CHEER_PHRASES.map((text, i) => h('button', {
        type: 'button',
        text,
        onclick: () => { if (hooks.replyCheer?.(slot, i + 1, to)) closeSheet(); },
      }))));
    }, true);
  }
  function setNextLine(text, reply) {
    if (!nextLineEl) return;
    const slot = reply && typeof reply === 'object' ? String(reply.slot || '') : '';
    const to = reply && typeof reply === 'object' ? String(reply.to || '') : '';
    nextLineEl.replaceChildren();
    if (text) nextLineEl.append(document.createTextNode(String(text)));
    if (slot && to) {
      nextLineEl.append(' ');
      nextLineEl.append(h('button', { type: 'button', class: 'chip', text: '답례', onclick: (e) => { e.stopPropagation(); openCheerReply(slot, to); } }));
    }
    nextLineEl.hidden = !text && !(slot && to);
  }
  function openTribeSheet() {
    openSheet('소속', null, (host) => {
      const box = h('div');
      host.append(box);
      const showMine = (mine) => {
        const href = 'https://studio.wishboard.workers.dev/?tribe=' + mine.tribe_id;
        const members = Array.isArray(mine.members) ? mine.members : [];
        tribeBtn.textContent = mine.tag ? `#${mine.tag}` : '소속';
        const copyBox = h('div', { class: 'manual-copy', hidden: true });
        box.replaceChildren(
          h('p', { class: 'note', text: `#${mine.tag} · 소속 코인 ${money(mine.coins)} · 이번 주 ${Math.max(0, Math.floor(Number(mine.points) || 0))}점` }),
          h('p', { class: 'note', text: href }),
          h('button', { class: 'btn gold', type: 'button', text: '초대 링크 복사', onclick: () => copyTribe(href, copyBox) }),
          copyBox,
          h('p', { class: 'note', text: members.length ? '팀원' : '아직 팀원이 없어요' }),
          ...members.map((m) => h('div', { class: 'rank' },
            h('b', { text: `${m.me ? '나 · ' : ''}${m.name || '익명'}` }),
            h('span', { class: 'pts', text: m.role === 'owner' ? '만든 사람' : '팀원' }),
          )),
        );
        return copyBox;
      };
      const copyTribe = async (href, into) => {
        if (await sendLink({ kind: 'tribe', url: href, into }) === 'copied') note('초대 링크를 복사했어요', 'ok');
      };
      const showCreate = () => {
        tribeBtn.textContent = '소속';
        const tag = h('input', { class: 'input', maxLength: 16, placeholder: '#태그', 'aria-label': '소속 태그' });
        box.replaceChildren(
          h('p', { class: 'note', text: '계정당 소속은 하나예요. 초대 링크로 가입해요.' }),
          tag,
          h('button', { class: 'btn gold', type: 'button', text: '소속 만들기', onclick: async () => {
            try {
              const res = await hooks.createTribe?.(tag.value);
              if (!res?.tribe_id) { note('소속을 만들지 못했어요', 'err'); return; }
              const into = showMine({ tribe_id: res.tribe_id, tag: res.tag || tag.value.replace(/^#/, ''), coins: 0, members: [{ name: hooks.nick(), role: 'owner', me: true }] });
              await copyTribe('https://studio.wishboard.workers.dev/?tribe=' + res.tribe_id, into);
            } catch (e) { note(e?.message || '소속을 만들지 못했어요', 'err'); }
          } }),
        );
      };
      box.append(h('p', { class: 'note', text: '소속을 확인하는 중…' }));
      Promise.resolve(hooks.myTribe?.()).then((mine) => {
        if (mine?.tribe_id) showMine(mine);
        else showCreate();
      }).catch((e) => {
        box.replaceChildren(h('p', { class: 'note', text: e?.message || '소속을 불러오지 못했어요' }));
      });
    }, true);
  }
  function starterOpen(id) {
    if (hooks.starterUsed?.() === true) return false;
    const b = boardById(id);
    return BALANCE.starterSlots.includes(id) && !b?.holder_id;
  }
  function openClaimStep(n, model) {
    if (!model) return;
    openSheet('전광판 걸기', n + '/3', (host) => {
      if (n === 1) {
        // Only what can be taken now: open starter slots, and the slot asked for when it is not a taken starter.
        // The server list can hold 12; show the first four open ones (nearest first) so the step stays as short as before.
        const ids = [];
        let free = 0;
        for (const id of [...BALANCE.starterSlots, model.slot]) {
          if (!id || ids.includes(id)) continue;
          if (BALANCE.starterSlots.includes(id) && (!starterOpen(id) || (free >= 4 && id !== model.slot))) continue;
          if (BALANCE.starterSlots.includes(id)) free += 1;
          ids.push(id);
        }
        if (ids.length && !ids.includes(model.slot)) model.choose(ids[0]);
        if (!ids.length) {
          host.append(h('p', { class: 'note', text: '지금 비어 있는 무료 칸이 없어요. 코인으로 걸 수 있는 칸을 골라 보세요.' }));
          host.append(h('button', { class: 'btn gold', type: 'button', text: '전광판 고르기', onclick: () => openBillboard('PLOT_1') }));
          return;
        }
        host.append(h('p', { class: 'note', text: '이름을 걸 칸을 고르세요' }));
        for (const id of ids) {
          const on = id === model.slot;
          const price = starterOpen(id) ? '무료' : `${money(floorOf(id))}코인`;
          host.append(h('button', { class: on ? 'btn pick on' : 'btn pick', type: 'button', 'aria-pressed': String(on), onclick: () => { model.choose(id); openClaimStep(1, model); } }, ...withIcon(on ? 'check' : '', `${slotName(id)} · ${price}`)));
        }
        host.append(h('button', { class: 'btn gold', type: 'button', text: '다음', style: { position: 'sticky', bottom: '0' }, onclick: () => openClaimStep(2, model) }));
      } else if (n === 2) {
        const names = ['첫째 줄', '둘째 줄', '셋째 줄'];
        const examples = ['올해는 꼭 합격', '우리 가족 건강하게', '#소원'];
        const canvas = makeCanvas(1024, 576);
        const counts = [0, 1, 2].map(() => h('small', { class: 'count tnum', text: '0/16' }));
        const inputs = [0, 1, 2].map((i) => h('input', { class: 'input', maxLength: 16, placeholder: `${names[i]} · 예: ${examples[i]}`, 'aria-label': names[i] }));
        let raf = 0;
        const paint = () => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            const base = model.payload();
            inputs.forEach((el, i) => { counts[i].textContent = `${[...el.value].length}/16`; });
            const typed = inputs.some((el) => el.value.trim());
            const line = (i) => (typed ? chars(inputs[i].value, 16) : examples[i]);
            paintBillboard(canvas, { slot_id: model.slot, emoji: base.emoji, bg_theme: base.bg_theme, line1: line(0), line2: line(1), line3: line(2), holder_name: hooks.nick(), holder_id: 'preview' });
          });
        };
        inputs.forEach((el) => el.addEventListener('input', paint));
        host.append(h('div', { class: 'screen' }, canvas));
        host.append(h('p', { class: 'note', text: '전광판에는 이렇게 보여요. 줄마다 16자까지.' }));
        inputs.forEach((el, i) => host.append(h('label', { class: 'claimline' }, el, counts[i])));
        // Shop templates and a link: folded for a newcomer (and while that is still undecided), open for everyone else. The filled lines stay editable and pass the same checks.
        const linkIn = h('input', { class: 'input', type: 'url', placeholder: 'https://smartstore.naver.com/...', value: model.link || '', 'aria-label': '가게 링크' });
        host.append(h('details', { class: 'more', open: newbieOn === false },
          h('summary', { text: '가게·행사 예시 문구와 링크' }),
          h('div', { class: 'chips' }, ...AD_TEMPLATES.map((t) => h('button', { type: 'button', text: t.label, onclick: () => {
            t.lines.forEach((line, i) => { inputs[i].value = chars(line, 16); });
            paint(); inputs[0].focus(); inputs[0].select();
          } }))),
          h('div', { class: 'field' }, h('label', null, '링크', h('span', { text: '인스타·스레드·유튜브·스마트스토어 https 주소만 저장됩니다. 전광판을 누르면 상세보기에서 열 수 있습니다' })), linkIn)));
        paint();
        fontsReady(examples.join(' ') + ' ' + hooks.nick()).then(paint);
        host.append(h('button', { class: 'btn gold', type: 'button', text: '다음', style: { position: 'sticky', bottom: '0' }, onclick: () => {
          if (!model.linesOk(inputs[0].value, inputs[1].value, inputs[2].value)) { note('쓸 수 없는 문구예요', 'err'); return; }
          let link = linkIn.value.trim();
          if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
          if (link && !allowedLink(link)) { note('인스타, 스레드, 유튜브, 스마트스토어 주소만 저장됩니다', 'err'); return; }
          model.link = link ? allowedLink(link) : '';
          openClaimStep(3, model);
        } }));
      } else {
        const free = starterOpen(model.slot);
        const floor = free ? 0 : floorOf(model.slot);
        const label = free ? '무료로 걸기' : '걸기';
        const go = h('button', { class: 'btn gold cta', type: 'button', text: label, style: { position: 'sticky', bottom: '0' }, onclick: () => {
          if (go.disabled) return;
          if (!free && (wallet.confirmed + wallet.pending) < floor) { note(`코인이 부족해요. 지금 ${money(wallet.confirmed + wallet.pending)}, ${money(floor)} 필요`, 'err'); return; }
          const payload = model.payload();
          payload.mode = free ? 'starter' : 'claim';
          payload.bid = free ? 0 : floor;
          if (model.link) payload.external_url = model.link;
          const run = hooks.submitClaim?.(payload);
          if (!run || typeof run.then !== 'function') { note('지금은 걸 수 없어요', 'err'); return; }
          go.disabled = true;
          go.textContent = '거는 중…';
          const slow = setTimeout(() => note('응답이 늦어요. 조금만 기다려 주세요', 'err'), 12000);
          run.then((res) => {
            clearTimeout(slow);
            closeSheet();
            if (!res?.review_id && res?.data) showProof(res.data.slot_id || model.slot);
          }).catch((e) => {
            clearTimeout(slow);
            note(e?.message || '점령에 실패했습니다', 'err');
            go.disabled = false;
            go.textContent = label;
          });
        } });
        host.append(h('p', { class: 'note', text: free ? '첫 칸은 코인이 들지 않아요' : `${slotName(model.slot)}은 ${money(floor)}코인으로 겁니다.` }));
        host.append(go);
      }
    }, true);
  }
  function pumpLink(now) {
    if (quietBlock) return;
    if (!linkWant) return;
    if (linkAsked || !accountView.guest || accountView.linked) { linkWant = false; return; }
    const quiet = entered && !sheet && !baking && !dance && !driving && proof.hidden && sponsorEl.hidden && !hooks.cineOn?.();
    if (!quiet) { linkQuietAt = 0; return; }
    if (!linkQuietAt) linkQuietAt = now;
    if (now - linkQuietAt < 1500) return;
    linkWant = false;
    linkAsked = true;
    try { sessionStorage.setItem('kts_link_asked', '1'); } catch { /* private mode */ }
    openLinkPrompt();
  }
  function linkCallout() {
    if (!accountView.ready || !accountView.guest || accountView.linked) return null;
    return h('div', { class: 'callout warn' },
      h('b', { text: '계정을 연결하면 전광판과 수익이 남아요. ' }),
      '창을 닫기 전에 연결하세요. 연결하면 +300코인. ',
      h('button', { class: 'btn ghost', type: 'button', text: '계정 연결', onclick: () => openLogin() }),
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
      // In-app browsers block Google sign-in. The handover link carries this guest into the system browser; it can be empty until it is ready.
      const browser = env.android ? '크롬' : '사파리';
      const google = h('button', { class: 'btn', type: 'button', text: 'Google로 계속' });
      google.addEventListener('click', async () => {
        const intent = env.inApp && env.android ? (hooks.authEnv?.() || {}).intent : '';
        if (intent) { location.href = intent; return; }
        if (env.inApp) { note(`이 앱 안에서는 구글 로그인이 열리지 않아요. 아래에서 이메일로 가입하거나, ${browser} 링크를 복사하세요.`, 'err'); return; }
        try { await hooks.oauth?.('google'); }
        catch (e) { note(e?.message || '구글 로그인을 열지 못했어요', 'err'); }
      });
      const linkOut = h('input', { class: 'input', readOnly: true, hidden: true, 'aria-label': `${browser}에서 열 링크` });
      const copy = h('button', { class: 'btn ghost', type: 'button' }, ...withIcon('link', `${browser}에서 열 링크 복사`));
      copy.addEventListener('click', async () => {
        const url = (hooks.authEnv?.() || {}).handoverUrl || '';
        if (!url) { note('링크를 준비하는 중이에요. 잠시 뒤에 다시 눌러 주세요', 'err'); return; }
        try {
          await navigator.clipboard.writeText(url);
          note(`링크를 복사했어요. ${browser} 주소창에 붙여 넣으세요`, 'ok');
        } catch {
          linkOut.value = url;
          linkOut.hidden = false;
          linkOut.select();
          note('복사가 막혀 있어요. 아래 링크를 길게 눌러 복사하세요', 'err');
        }
      });
      const kids = [
        h('p', { class: 'note', text: '연결하면 전광판과 코인이 남아요. 보상은 계정마다 한 번 +300.' }),
        google,
      ];
      if (env.inApp) kids.push(h('p', { class: 'note', text: env.android ? '이 앱 안에서는 구글 로그인을 열지 않고, 크롬으로 넘어갑니다.' : '이 앱 안에서는 구글 로그인을 열지 않아요. 이메일로 가입하거나 사파리 링크를 여세요.' }), copy, linkOut);
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
  // main.js paintBootLive relabels the enter button for a shared wish link ('' = the normal label).
  let bootLabel = '', bootGo = null;
  function bootLabelSet(text) {
    bootLabel = String(text || '');
    if (bootGo) bootGo.textContent = bootLabel || '입장하기';
  }
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
    const go = h('button', { class: 'btn enter-go pulse', type: 'button', text: bootLabel || '입장하기' });
    const nickErr = h('p', { class: 'note', role: 'alert', hidden: true }); // on the boot card: a toast would sit under it
    bootGo = go;
    const enter = () => {
      if (entered) return;
      // 네온봇N is the seeded bots' name: a typed one is refused here, a stored one is dropped for the default.
      const name = chars(known ? hooks.nick() : nick.value, 16).trim() || hooks.nick();
      if (botNick(name) && !known) { nickErr.textContent = '그 이름은 쓸 수 없어요'; nickErr.hidden = false; nick.focus?.(); return; }
      entered = true;
      trackEvent('enter_square', { load_ms: Math.round(performance.now()) });
      ac();
      sfx.engine();
      cityStart();
      askFullscreen();
      hooks.enter({ nick: botNick(name) ? '네온손님' : name, color, species });
      renderProfile();
      hooks.arrive?.();
      attend();
      bootEl.classList.add('gone');
      setTimeout(() => bootEl.remove(), 900);
      maybeStarterToast();
    };
    go.addEventListener('click', enter);
    nick.addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });
    const bootFields = known ? [go] : [nick, nickErr, go];
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
  async function writeClip(text) {
    if (!text || !navigator.clipboard?.writeText) return false;
    try {
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 1200)),
      ]);
      return true;
    } catch { return false; }
  }
  // into: a box on the current screen for the manual-copy fallback (else a small sheet opens).
  async function copyInvite(slot, who = '', into = null) {
    const opts = who ? { gift: true } : {};
    const link = cardUrl(slot, opts);
    if (!link) { note('이 칸은 초대 링크를 만들 수 없어요', 'err'); return; }
    const line = who
      ? `🎁 ${who}님! ${hooks.nick?.() || '친구'}님이 뉴욕 타임스퀘어 전광판에 당신만을 위한 깜짝 메시지를 걸었습니다! 지금 바로 링크를 눌러 타임스퀘어 한복판을 확인해 보세요 👉`
      : '뉴욕 타임스퀘어 전광판에 내 광고 걸었습니다! 링크 누르면 내 전광판 앞으로 바로 이동합니다 👉';
    const how = await sendLink({ kind: 'invite', text: line, url: link, into });
    if (how === 'copied') {
      trackEvent('share_send', { slot });
      note('초대 문구를 복사했어요', 'ok');
    }
  }
  const proofText = h('p');
  const proofCopy = h('div', { class: 'manual-copy', hidden: true });
  const proof = h('div', { class: 'glass proof', hidden: true },
    proofText,
    proofCopy,
    h('button', { class: 'btn gold', type: 'button', onclick: () => copyInvite(proof.dataset.slot || 'MAIN_TOP', proof.dataset.gift || '', proofCopy) }, ...withIcon('link', '초대 문구 복사하기')),
    h('button', { class: 'btn ghost', type: 'button', text: '사진 찍어 공유', onclick: async () => {
      const slot = proof.dataset.slot;
      proof.hidden = true;
      root.classList.remove('proofing');
      if (slot) hooks.frameBillboard?.(slot);
      try {
        let clip = null;
        try { clip = await hooks.saveClip?.(); } catch { clip = null; }
        if (clip) note('5초 영상을 기기에 저장했어요', 'ok');
        else await openShot({ slot });
      } finally { hooks.endFocus?.(); }
      askShot();
    } }),
    h('button', { class: 'btn ghost', type: 'button', onclick: () => downloadPaper() }, ...withIcon('news', '신문으로 저장')),
    h('button', { class: 'btn ghost', type: 'button', text: '둘러보기', onclick: () => dismissProof() }),
  );
  root.append(proof);
  let proofHist = false;
  function dismissProof(fromPop) {
    if (proof.hidden) return false;
    proof.hidden = true;
    root.classList.remove('proofing');
    hooks.lockInput?.(false);
    hooks.endFocus?.();
    if (!fromPop && proofHist) {
      proofHist = false;
      history.back();
    } else proofHist = false;
    // Right after a board claim's celebration: the moment "빼앗기면 알려 드릴까요?" makes sense. Plots cannot be taken.
    // Not after a gift (the board went to someone else) or a plot.
    if (proof.dataset.gift || String(proof.dataset.slot || '').startsWith('PLOT_')) pumpQueued();
    else queuePushOffer('claim');
    return true;
  }
  // Push offer moments: 'share' (after a photo share), 'wish' (first wish of the day), 'claim'. ftue.js pushAsk decides.
  try { pushOffered = sessionStorage.getItem('kts_push_offered') === '1'; } catch { /* private mode: per page */ }
  function queuePushOffer(kind = 'share') {
    if (pushOffered) return;
    pushQueued = PUSH_WHY[kind] ? kind : 'share';
    pushQueuedAt = Date.now();
    pumpQueued();
  }
  function pushSupported() {
    try { return typeof Notification !== 'undefined' && !!navigator.serviceWorker && 'PushManager' in window; } catch { return false; }
  }
  function openPushSheet(kind = '', offer = false) {
    let done = false;
    openSheet('알림', null, (host) => {
      const why = PUSH_WHY[kind] || '';
      const hint = h('p', { class: 'note', text: '전광판을 빼앗기거나 내 소원에 하트가 오면 알려 드려요.' });
      host.append(
        why ? h('p', { class: 'push-why', text: why }) : null,
        hint,
        h('button', { class: 'btn gold', type: 'button', text: '알림 받기', onclick: async () => {
          try {
            const r = await subscribePush();
            if (r?.ok) {
              done = true;
              trackEvent('push_on');
              hint.textContent = msgText(r.hint) || '알림을 켰어요';
              note('알림을 켰어요', 'ok');
              return;
            }
            if (r?.hint) { hint.textContent = msgText(r.hint); return; }
            note('알림 권한이 필요해요', 'err');
          } catch (e) { note(e?.message || '이 브라우저에서는 알림을 켤 수 없어요', 'err'); }
        } }),
        offer ? h('button', { class: 'btn ghost', type: 'button', text: '나중에', onclick: () => closeSheet() }) : null,
      );
      // Closed without subscribing: do not offer again for 3 days.
      // Replaced by another sheet is not a "no".
      return () => { if (offer && !done && !replacingSheet) store(PUSH_ASK_KEY, Date.now()); };
    }, true);
  }
  function maybeOfferPush() {
    if (!pushQueued || pushOffered) return;
    let permission = '';
    try { permission = typeof Notification !== 'undefined' ? Notification.permission : ''; } catch { permission = ''; }
    const v = pushAsk({
      supported: pushSupported(),
      permission,
      offered: pushOffered,
      dismissedAt: recall(PUSH_ASK_KEY, 0),
      now: Date.now(),
      busy: quietBlock || !!sheet || !proof.hidden || !!proofWait || !!awayWant || focusOn,
      newbie: !!newbieOn,
      queuedAt: pushQueuedAt,
    });
    if (v === 'wait') return;
    const kind = pushQueued;
    pushQueued = false;
    if (v !== 'open') return;
    pushOffered = true;
    try { sessionStorage.setItem('kts_push_offered', '1'); } catch { /* private mode */ }
    openPushSheet(kind, true);
  }
  // The inline offer in the my-wish card. Not a pop-up, so newcomers get it too; showing it is this session's offer.
  let pushInlineMsg = '';
  function pushRow() {
    if (!pushInline) {
      let permission = '';
      try { permission = typeof Notification !== 'undefined' ? Notification.permission : ''; } catch { permission = ''; }
      const v = pushAsk({ supported: pushSupported(), permission, offered: pushOffered, dismissedAt: recall(PUSH_ASK_KEY, 0), now: Date.now(), placement: 'inline' });
      if (v !== 'open') return null;
      pushInline = 'shown';
      pushOffered = true;
      pushQueued = false;
      try { sessionStorage.setItem('kts_push_offered', '1'); } catch { /* private mode */ }
    }
    if (pushInline === 'later') return null;
    const row = h('div', { class: 'wish-push' });
    const paintRow = () => {
      if (pushInline === 'later') { row.remove(); return; }
      if (pushInline === 'done') { fill(row, h('p', { class: 'note ok', text: msgText(pushInlineMsg) })); return; }
      fill(row,
        h('p', { class: 'wish-push-q', text: '🔔 하트가 오면 바로 알려 드릴까요?' }),
        h('div', { class: 'wish-push-act' },
          h('button', { class: 'btn ghost', type: 'button', text: '알림 켜기', onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              const r = await subscribePush();
              if (r?.ok) { pushInline = 'done'; pushInlineMsg = msgText(r.hint) || '알림을 켰어요'; trackEvent('push_on'); }
              else pushInlineMsg = msgText(r?.hint) || '알림 권한이 필요해요';
            } catch (err) { pushInlineMsg = err?.message || '이 브라우저에서는 알림을 켤 수 없어요'; }
            btn.disabled = false;
            paintRow();
          } }),
          h('button', { class: 'wish-push-later', type: 'button', text: '나중에', onclick: () => { store(PUSH_ASK_KEY, Date.now()); pushInline = 'later'; paintRow(); } })),
        pushInlineMsg ? h('p', { class: 'note', text: msgText(pushInlineMsg) }) : null,
      );
    };
    paintRow();
    return row;
  }
  // 다녀간 사이 (main.js builds the rows with ftue.js awayRows). Queued like the push offer; it goes first.
  function openAway(rows, onClose) {
    if (!Array.isArray(rows) || !rows.length) return;
    awayWant = { rows: rows.slice(0, 6), onClose, at: Date.now() };
    pumpQueued();
  }
  function maybeAway() {
    if (!awayWant) return false;
    if (newbieOn || Date.now() - awayWant.at > 120000) { awayWant = null; return false; }
    // Never on top of play: a sheet (claim wizard included), a celebration, the focus camera, bake/dance, a taxi, lounge/watch.
    if (quietBlock || sheet || !proof.hidden || proofWait || focusOn || baking || dance || driving || loungeWatch) return false;
    const { rows, onClose } = awayWant;
    awayWant = null;
    openSheet('다녀간 사이', null, (host) => {
      const go = (r) => {
        if (r.kind === 'taken') { openBillboard(r.slot); return; }
        if (r.kind === 'look') { closeSheet(); hooks.focusShot?.(r.slot); return; }
        openWish({ from: 'away' });
      };
      const lead = rows.findIndex((r) => r.kind === 'taken'); // one amber button: the first board to take back
      host.append(h('div', { class: 'away-list' }, ...rows.map((r, i) => h('div', { class: 'away-row' },
        h('p', { text: msgText(r.text) }),
        h('button', { class: i === lead ? 'btn gold' : 'btn ghost', type: 'button', text: msgText(r.label), onclick: () => go(r) }),
      ))));
      return () => { try { onClose?.(rows); } catch { /* the rows just show again next time */ } };
    }, true, 'away');
    return true;
  }
  function pumpQueued() {
    if (maybeAway()) return;
    maybeOfferPush();
  }
  function showProof(slot, giftName = '') {
    if (quietBlock) { proofWait = { slot, gift: giftName || '' }; return; }
    proof.dataset.slot = slot;
    proof.dataset.gift = giftName || '';
    proofCopy.replaceChildren();
    proofCopy.hidden = true;
    proofText.textContent = giftName
      ? `등록됐습니다. ${giftName}님 선물 문구를 복사해 보내세요.`
      : '등록됐습니다. 지금 전광판 앞에서 폭죽이 터집니다.';
    root.classList.add('proofing');
    proof.hidden = false;
    hooks.lockInput?.(true);
    if (!proofHist) {
      proofHist = true;
      history.pushState({ ...(history.state || {}), ktsProof: 1 }, '');
    }
  }
  function openVip() {
    trackEvent('vip_modal_open');
    promptLink('vip');
    openSheet(['crown', 'VIP 패스트트랙'], 'SPONSOR', (host) => {
      const code = h('input', { class: 'input', maxLength: 32, placeholder: '8자리 스폰서 코드', 'aria-label': '스폰서 코드' });
      const share = h('button', { class: 'btn gold', type: 'button', text: '링크 복사하고 +300' });
      const shareBox = h('div', { class: 'manual-copy', hidden: true });
      share.addEventListener('click', async () => {
        if (share.disabled) return;
        // The most useful link: today's wish, else one of my lit boards, else the site. The bonus only after it really went out.
        const pick = vipShareLink({ origin: location.origin, wish: wishView.mine, boards: world.billboards, me: hooks.actorId?.(), now: Date.now() });
        const words = pick.kind === 'wish' ? wishShareText(wishView.mine)
          : pick.kind === 'board' ? { title: 'WISH BOARD : 모두의 전광판', text: '뉴욕 타임스퀘어 전광판에 내 자리를 걸었어요. 같이 보러 와요 👉' }
            : { title: 'WISH BOARD : 모두의 전광판', text: SHARE_TEXT };
        share.disabled = true;
        const how = await sendLink({ kind: 'vip', native: true, title: words.title, text: words.text, url: pick.url, into: shareBox });
        if (how !== 'shared' && how !== 'copied') {
          share.disabled = false;
          if (how === 'manual') note('복사가 안 돼서 보너스는 넣지 않았어요. 아래 링크를 길게 눌러 복사해 보내 주세요.', 'err');
          return;
        }
        if (how === 'copied') note('링크를 복사했어요', 'ok');
        try {
          const r = await hooks.shareBonus?.();
          note(r?.coins != null ? `공유 보너스 +300 · 잔액 ${r.coins}` : '공유 보너스를 넣었어요', 'ok');
        } catch (e) { note(e?.message || '오늘은 이미 받았거나, 아직 입장 전이에요', 'err'); share.disabled = false; }
      });
      const redeem = h('button', { class: 'btn ghost', type: 'button', text: '코드 사용' });
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
          h('div', { class: 'vipcard' }, h('h4', null, ...withIcon('gift', '친구에게 링크 공유하고 +300')), h('p', { text: '하루 한 번. 오늘 내 소원이나 내 전광판 링크를 보내면 코인이 바로 들어옵니다.' }), share, shareBox),
          h('div', { class: 'vipcard' }, h('h4', null, ...withIcon('key', 'VIP 스폰서 코드')), h('p', { text: '코드가 맞으면 10,000코인이 충전됩니다. 메인 타워는 3,000부터 점령할 수 있어요.' }), code, redeem),
          h('div', { class: 'vipcard' }, h('h4', null, ...withIcon('briefcase', '스폰서 안내')), h('p', { text: '현금 결제는 없어요. 안내 페이지만 엽니다.' }), ask),
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
  const FOUNTAIN = { ko: '🥠 분수', x: (LAYOUT.stairs.x0 + LAYOUT.stairs.x1) / 2, z: LAYOUT.stairs.front + 4.6 };
  const MAP_PINS = LANDMARKS.concat([
    { ko: '포춘 분수', g: '🥠', x: FOUNTAIN.x, z: FOUNTAIN.z, major: true },
    ...RINGS.map((p) => ({ ko: '황금 링', g: '💍', x: p.x, z: p.z, major: true })),
  ]);
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
    for (const l of MAP_PINS) {
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
    for (const c of d.coins || []) dot(c.x, c.z, 2.4 * ui, '#ffd56a');
    if (d.pin && Number.isFinite(d.pin.x) && Number.isFinite(d.pin.z)) {
      dot(d.pin.x, d.pin.z, 6 * ui, '#062028');
      dot(d.pin.x, d.pin.z, 4.2 * ui, '#7cf6ff');
    }
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

  // Quick-jump chips on the big map: a line icon (ico) and a plain label.
  const QUICK = [
    { ico: 'fish', ko: '붕어빵', x: LAYOUT.stall.x, z: LAYOUT.stall.z + 4.4 },
    { ico: 'fountain', ko: '분수', x: FOUNTAIN.x, z: FOUNTAIN.z },
    { ico: 'ring', ko: '황금 링', x: RINGS[0].x, z: RINGS[0].z - 4 },
    { ico: 'coin', ko: '바닥 코인', x: 16, z: 61 },
    { ico: 'taxi', ko: '승강장', x: TAXI_STANDS[0].x, z: TAXI_STANDS[0].z },
    { ico: 'music', ko: 'K-POP 스테이지', x: LAYOUT.stage.spot.x, z: LAYOUT.stage.spot.z - 5 },
    { ico: 'building', ko: '분양 구역', x: 0, z: 305 },
    ...['esb', 'rock', 'cpark', 'gct', 'owtc', 'flatiron', 'vessel', 'washsq', 'bklyn', 'harlem'].map(id => LANDMARKS.find(l => l.id === id)).filter(Boolean).map(l => ({ ko: l.ko, x: l.x, z: l.z })),
  ].filter((q) => insideLoop(q.x, q.z, 0));
  function starQuick() {
    const d = hooks.minimap?.();
    const stars = d?.stars || [];
    if (!stars.length) return null;
    const me = d.me;
    let best = stars[0], dist = Infinity;
    for (const s of stars) {
      const dd = me ? (s.x - me.x) ** 2 + (s.z - me.z) ** 2 : 0;
      if (dd < dist) { dist = dd; best = s; }
    }
    return { ico: 'wish', ko: '별똥별', x: best.x, z: best.z };
  }
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
    openSheet(['map', '뉴욕 지도'], 'MANHATTAN', (host) => {
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
        note('목적지를 표시했어요 · ⚡ 버튼으로 순간이동도 돼요', 'ok');
      };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinch = null; drag = null; });
      const zoomBtns = h('div', { class: 'mapzoom' },
        h('button', { type: 'button', 'aria-label': '확대', onclick: () => { view.scale = Math.min(MAX, view.scale * 1.4); } }, icon('plus')),
        h('button', { type: 'button', 'aria-label': '축소', onclick: () => { view.scale = Math.max(MIN, view.scale / 1.4); } }, icon('minus')),
        h('button', { type: 'button', title: '내 위치', onclick: () => { const d = hooks.minimap?.(); if (d?.me) { view.cx = d.me.x; view.cz = d.me.z; } } }, icon('locate')),
        h('button', { type: 'button', title: '목적지로 순간이동', onclick: () => {
          const d = hooks.minimap?.();
          if (!d?.waypoint) { note('먼저 지도를 눌러 목적지를 정하세요', 'err'); return; }
          if (!insideLoop(d.waypoint.x, d.waypoint.z, 0)) { note('울타리 밖으로는 갈 수 없어요', 'err'); return; }
          hooks.teleport(d.waypoint.x, d.waypoint.z);
          closeSheet();
          sfx.fanfare();
          note('순간이동 완료!', 'ok');
        } }, icon('bolt')),
        h('button', { type: 'button', title: '목적지 지우기', onclick: () => hooks.setWaypoint(null) }, icon('pinOff')));
      wrap.append(zoomBtns);
      const chips = h('div', { class: 'quick' }, ...[starQuick(), ...QUICK].filter(Boolean).map(q => h('button', { type: 'button', onclick: () => {
        if (!insideLoop(q.x, q.z, 0)) return;
        view.cx = q.x; view.cz = q.z; view.scale = Math.max(view.scale, 0.9 * dprM);
        hooks.setWaypoint({ x: q.x, z: q.z });
        sfx.click();
      } }, ...withIcon(q.ico || '', q.ko))));
      host.append(
        h('p', { class: 'note' }, coarse ? '탭: 목적지 · 드래그: 이동 · 두 손가락: 확대 · ' : '클릭: 목적지 · 드래그: 이동 · 휠: 확대 · ', icon('bolt'), ' 순간이동'),
        chips, wrap, h('div', { class: 'legend' },
        h('span', null, '🔴 TKTS'), h('span', null, '🐟 붕어빵'), h('span', null, '🥠 포춘 분수'), h('span', null, '💍 황금 링'), h('span', null, '💃 K-POP 스테이지'), h('span', null, '🏗️ K-타운 분양'), h('span', null, '🚕 택시 승강장'),
        h('span', null, h('i', { style: { background: '#ffc21a' } }), '택시'), h('span', null, h('i', { style: { background: '#3fe6ff' } }), '목적지'),
        h('a', { class: 'osm', href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener', text: '© OpenStreetMap contributors' })));
      requestAnimationFrame(() => { size(); draw(); });
      const ro = new ResizeObserver(size);
      ro.observe(wrap);
      return () => { cancelAnimationFrame(raf); ro.disconnect(); };
    }, false, 'map');
  }

  function openSettings() {
    openSheet(['gear', '설정'], null, (host) => {
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
        h('button', { class: 'btn gold', type: 'button', text: '알림', onclick: () => openPushSheet() }),
        h('button', { class: 'btn ghost', type: 'button', text: '받은 소식', onclick: () => openInboxSheet() }),
        h('button', { class: 'btn ghost', type: 'button', text: '이번 주 코드', onclick: () => openCodeSheet() }),
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
      fareEl.textContent = String(hd.train?.riders || 0);
      if (hd.job) {
        const riding = hd.job.phase === 'ride';
        if (riding && !rideLine) rideLine = PASSENGER_LINES[(Math.random() * PASSENGER_LINES.length) | 0];
        if (!riding) rideLine = '';
        jobEl.classList.toggle('talk', riding && !!rideLine);
        jobTitle.textContent = hd.job.phase === 'pickup' ? '초록 기둥에서 속도를 줄이세요' : '노란 기둥에서 속도를 줄이세요';
        jobDist.textContent = hd.job.dist >= 1000 ? `${(hd.job.dist / 1000).toFixed(1)}km` : `${Math.round(hd.job.dist)}m`;
        jobArrow.style.transform = `rotate(${(-hd.job.bearing * 180) / Math.PI - 90}deg)`;
        jobArrow.style.color = hd.job.phase === 'pickup' ? 'var(--ok, #3ddc97)' : 'var(--accent, #ffb020)';
        jobTime.textContent = hd.job.left != null ? fmtTime(hd.job.left) : '';
        jobTime.classList.toggle('low', hd.job.left != null && hd.job.left < 10);
      } else {
        rideLine = '';
        jobEl.classList.remove('talk');
        jobTitle.textContent = hd.hive ? `옆 택시에 붙으면 ${Math.round(PAY.hive.gapMs / 1000)}초마다 +${PAY.hive.base}` : '손님 찾는 중…';
        jobDist.textContent = '-';
        jobTime.textContent = '';
        jobArrow.style.transform = 'rotate(-90deg)';
      }
      if (hd.train && hd.train.riders > 0) {
        trainEl.hidden = false;
        setIconText(trainEl, 'taxi', `현재 택시 기차: ${hd.train.riders}명 탑승 중 (x${hd.train.mult}배) | 지금 내릴까, 한 명 더 태울까?`);
      } else trainEl.hidden = true;
    } else trainEl.hidden = true;
    const fever = hd.fever;
    if (fever) {
      let ft = fever.phase === 'count' ? `크리스탈볼 ${Math.ceil(fever.left)}초 뒤 드롭 · 열기 ${fever.gauge}/20`
        : fever.phase === 'party' ? `2배 코인 · 부스트 무제한 ${Math.ceil(fever.left)}초 · 열기 20/20`
          : `코인 2배 ${fever.gauge}/20`;
      const revLeft = Math.ceil((revengeUntil - Date.now()) / 1000);
      if (revLeft > 0) ft += ` · 복수 운임 ${revLeft}초`;
      const ballLeft = ballUntil - Date.now();
      if (ballOpenFlag && ballLeft > 0) ft += ` · 타워 ${Math.max(1, Math.ceil(ballLeft / 60000))}분`;
      else if (!ballOpenFlag && ballLeft > 0 && ballLeft <= 3600000) ft += ` · 타워까지 ${Math.max(1, Math.ceil(ballLeft / 60000))}분`;
      if (feverText.textContent !== ft) feverText.textContent = ft;
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
    if (now - rankAt > 1000 && !document.hidden) { rankAt = now; paintLive(); renderGoal(); maybeStarterToast(); payDue(); pumpLink(now); }
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
      if (!proof.hidden) { dismissProof(); e.preventDefault(); e.stopPropagation(); return; }
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
  const loungeBtn = h('button', { class: 'stay-lounge-btn', type: 'button', title: '전광판 관람. 8초마다 다른 전광판, 20초마다 +2. 움직이면 끝', onclick: () => hooks.toggleLounge?.() },
    h('span', { class: 'e' }, icon('coffee')), h('span', { class: 'l', text: '멍때리기' }));
  const focusBtn = h('button', { class: 'stay-focus', type: 'button', hidden: true, onclick: () => hooks.endFocus?.() }, '시점 해제');
  dock.prepend(loungeBtn);
  root.querySelector('.hud-l')?.append(questEl);
  root.querySelector('.hud-r')?.append(balloonEl);
  root.append(ticketEl, loungeEl, focusBtn);
  let loungeN = 0;
  let loungeWatch = false;
  const portraitMq = matchMedia('(orientation: portrait)');
  function syncWatchPortrait() { hooks.watchPortrait?.(loungeWatch && portraitMq.matches); }
  portraitMq.addEventListener?.('change', syncWatchPortrait);
  function paintLounge(on, n) {
    loungeEl.hidden = !on;
    loungeBtn.classList.toggle('on', !!on);
    const label = loungeBtn.querySelector('.l');
    if (label) label.textContent = on ? '그만' : '멍때리기';
    loungeN = n || 0;
    if (on) setIconText(loungeEl, 'coffee', `야경 감상 중. 전광판은 8초마다 알아서 바뀝니다. (20초마다 +2 | 누적 +${loungeN})`);
  }
  let lotBucket = -1, lotNum = 0, ballOpenFlag = false, ballUntil = 0;
  let revengeUntil = 0;
  function paintTickets(count, ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    const inDraw = lotBucket === Math.floor(Date.now() / 300000);
    const mine = inDraw && lotNum ? `내 번호 ${lotNum}` : '';
    setIconText(ticketEl, 'ticket', inDraw
      ? `다음 추첨까지 ${mm}:${ss} · 이번 5분 응모함${mine ? ' · ' + mine : ''} · 1/15, 맞으면 25코인`
      : `다음 추첨까지 ${mm}:${ss} · 택시 하차가 이번 5분의 1장 · 1/15, 맞으면 25코인`);
  }
  ticketEl.addEventListener('click', () => {
    const inDraw = lotBucket === Math.floor(Date.now() / 300000);
    const mine = inDraw ? lotNum : 0;
    const me = hooks.minimap?.()?.me;
    let stand = TAXI_STANDS[0];
    if (me) {
      let best = Infinity;
      for (const s of TAXI_STANDS) {
        const d = (s.x - me.x) ** 2 + (s.z - me.z) ** 2;
        if (d < best) { best = d; stand = s; }
      }
    }
    openSheet('5분 추첨', null, (host) => {
      host.append(
        h('p', { class: 'note', text: mine ? `내 번호 ${mine}. 이번 5분이 끝나면 추첨하고, 맞으면 25코인이에요.` : '택시에서 손님을 내리면 이번 5분의 번호 1장이 나와요. 1부터 15 중 하나고, 맞으면 25코인이에요.' }),
        h('button', { class: 'btn gold', type: 'button', text: `${stand.name} 승강장으로 안내`, onclick: () => {
          closeSheet();
          hooks.setWaypoint?.({ x: stand.x, z: stand.z });
          note(`${stand.name} 승강장 길안내를 시작해요`, 'ok');
        } }),
      );
    }, true);
  });
  function noteFare(amount) {
    const n = Math.floor(Number(amount));
    if (!n || sponsorEl.hidden) return;
    sponsorPay.hidden = false;
    sponsorPay.textContent = `운임 +${n} 코인`;
  }
  function noteLot(n) {
    const num = Math.floor(Number(n));
    if (num >= 1 && num <= 15) lotNum = num;
    lotBucket = Math.floor(Date.now() / 300000);
    paintTickets(0, 300000 - (Date.now() % 300000));
  }
  function paintQuests() {
    const d = today();
    const paid = d.qPaid || {};
    const row = (key, need, label) => {
      const done = !!paid[key];
      return h('button', { type: 'button', class: done ? 'ok' : '', onclick: () => guideQuest(key) }, ...withIcon(done ? 'checkCircle' : 'todo', `${label} (${Math.min(d[key] || 0, need)}/${need})`));
    };
    questEl.replaceChildren(
      h('b', { text: '오늘의 드라이버' }),
      row('fare', 3, '택시 타고 손님 3명 내리기 +50'),
      row('cheer', 3, '전광판 응원 3회 +30'),
      row('stunt', 2, '길 위 황금 링을 걸어 통과 2회 +40'),
      h('div', { class: paid.all ? 'ok' : '' }, ...withIcon(paid.all ? 'gift' : 'todo', `3개 완료 시 +${PAY.quest.all}`)),
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
    if (!hooks.claimQuest?.(key)) note('광장에 연결되면 미션 보상이 들어와요', 'err');
  }
  let balloonHp = 0, balloonWait = 25000, balloonWaitAt = 0;
  function paintBalloon() {
    balloonEl.hidden = false;
    balloonEl.disabled = !(balloonHp > 0);
    if (balloonHp > 0) {
      const left = Math.ceil(balloonHp / 10);
      setIconText(balloonEl, 'packet', coarse ? `${left}` : `${left}번 남음 · 터지면 코인`);
      balloonEl.title = `맞출 때마다 줄어요. 0이 되면 터지고 ${PAY.pouch.base}코인이 나와요`;
      balloonEl.setAttribute('aria-label', balloonEl.title);
    }
    else if (!balloonWaitAt) setIconText(balloonEl, 'packet', '준비');
    else {
      const left = Math.max(0, Math.ceil((balloonWaitAt + (balloonWait || 25000) - Date.now()) / 1000));
      setIconText(balloonEl, 'packet', `${left}초`);
    }
  }
  setInterval(paintBalloon, 1000);
  paintQuests();
  paintTickets(0, 300000);

  // Someone who played on an earlier day keeps the full HUD; read before this session's attend().
  // kts_ftue is set for every earlier player (the old tutorial bug) and for a new one only after the bake step.
  if (!grad && silentGrad({ ftue: recall('kts_ftue', ''), daily: recall('kts_daily', null), day: kstDay() })) { grad = true; store('kts_grad', 1); }
  root.querySelector('.hud-l')?.append(h('button', { class: 'newbie-more', type: 'button', text: '메뉴 모두 보기', onclick: (e) => { e.stopPropagation(); graduate(); } }));
  newbieReady = true;
  renderWallet();
  renderProfile();
  renderStatus();

  return {
    sfx, note, pop, flyCoins, cooldownLeft, armCooldown, showResult,
    startBake, stopBake, startDance, endDance, openBillboard, openAd, openPlot, openHub, openCredits, openMap, openSettings, openWalletInfo, openVip, toggleReacts, showProof,
    mission(kind) { if (kind === 'cheer' || kind === 'bake') missionBump(kind); },
    quest: questBump,
    markDaily,
    markQuest(key) {
      const d = today();
      d.qPaid = d.qPaid || {};
      if (key === 'all') d.qPaid.all = 1;
      else if (key === 'fare' || key === 'cheer' || key === 'stunt') d.qPaid[key] = 1;
      saveDay(d);
      paintQuests();
    },
    tickets: paintTickets,
    noteFare,
    noteLot,
    lounge(on, n) { paintLounge(on, n); loungeWatch = !!on; syncWatchPortrait(); if (on) lofiStart(); else lofiStop(); if (!on && awayWant) setTimeout(pumpQueued, 0); },
    focusLock(on) { focusOn = !!on; focusBtn.hidden = !on; renderPrompt(); if (!on) setTimeout(pumpQueued, 0); },
    revenge(ev) {
      sfx.siren();
      const have = (wallet.confirmed || 0) + (wallet.pending || 0);
      const price = Math.floor(Number(ev.price) || 0);
      const short = have < price;
      rememberTake(ev.slot, ev.attacker);
      openSheet('전광판을 빼앗겼어요', ev.slotName || slotName(ev.slot), (host) => {
        host.append(
          h('p', { text: `🚨 방금 ${ev.attacker || '누군가'}님이 회원님의 ${ev.slotName || slotName(ev.slot)}을 빼앗았습니다!` }),
          h('button', { class: 'btn gold', type: 'button', onclick: async () => {
            closeSheet();
            try {
              await hooks.claim({ slot_id: ev.slot, bid: price, line1: ev.line1 || '', line2: ev.line2 || '', line3: ev.line3 || '', emoji: ev.emoji || '⚔️', bg_theme: ev.theme || 'cyber_navy', text_color: ev.color || '#ffffff' });
              note('되찾았습니다', 'ok');
            } catch (e) { note(e?.message || '되찾지 못했어요', 'err'); }
          } }, ...withIcon('flag', `즉시 되찾아오기 (필요 코인: ${money(price)})`)),
          short ? h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); hooks.revenge?.(); } }, ...withIcon('taxi', '복수 자금 모으러 2배 보상 긴급 손님 태우기!')) : null,
        );
      });
    },
    showDraw(win, hit, pay, lot) {
      const mine = Math.floor(Number(lot));
      const who = mine >= 1 && mine <= 15 ? `내 번호 ${mine} · ` : '';
      if (newbieOn && tutorialOn && !(hit && pay > 0)) return;
      const line = hit && pay > 0 ? `${who}${win}번, 맞았어요! +${pay} 코인` : `${who}이번 추첨 번호 ${win}`;
      const el = h('div', { class: 'stay-draw' }, ...withIcon('ticket', line));
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
      if (driving) { closeSheet(); note('운전 시작! 초록 기둥에서 손님을 태우고, 노란 기둥에서 속도를 줄이면 내립니다', 'ok'); }
      if (boostBtn) boostBtn.hidden = !driving;
      renderPrompt();
      if (!driving && awayWant) setTimeout(pumpQueued, 1500);
    },
    job(ev) {
      if (ev.type === 'offer') { rideLine = ''; jobTitle.textContent = '손님에게 가세요'; note('진행 방향 도로 위에 손님과 초록 기둥이 있어요. 가까이 가서 속도를 줄이세요'); }
      else if (ev.type === 'board') {
        rideLine = PASSENGER_LINES[(Math.random() * PASSENGER_LINES.length) | 0];
        sfx.pickup();
        jobTitle.textContent = ev.title || '노란 기둥에서 속도를 줄이세요';
        jobEl.classList.add('talk');
        note(ev.title || '노란 기둥까지 가서 시속 40 아래로 줄이면 손님이 내립니다', 'ok');
      }
      else if (ev.type === 'chain') { sfx.pickup(); note(`${ev.riders}명째 탑승 · x${ev.mult}배`, 'ok'); }
      else if (ev.type === 'detach') { sfx.bump(); note('맨 뒤 손님이 도로로 떨어졌어요', 'err'); }
      else if (ev.type === 'fail') { rideLine = ''; jobEl.classList.remove('talk'); sfx.miss(); jobTitle.textContent = '손님 찾는 중'; hideSponsor(); note('시간 초과… 손님이 내렸어요', 'err'); }
      else if (ev.type === 'done') { rideLine = ''; jobEl.classList.remove('talk'); sfx.cash(); jobTitle.textContent = '손님 찾는 중'; showSponsor(ev); }
      else if (ev.type === 'focus') showSponsor(ev);
    },
    setWaypoint(wp) {
      waypoint = wp || null;
      wayPill.hidden = !waypoint;
      // The walk to the free slot ends when that waypoint is reached or cleared.
      if (!waypoint && tutorialWalk) { tutorialWalk = false; setTutorial('walkDone'); }
    },
    setTutorialWaypoint,
    setWallet(next, { bump = false, defer = false } = {}) {
      wallet = {
        confirmed: Math.max(0, Number(next.confirmed) || 0),
        pending: Math.max(0, Number(next.pending) || 0),
        earned: Math.max(0, Number(next.earned) || 0),
        tickets: Math.max(0, Math.floor(Number(next.vipTickets) || 0)),
      };
      const gain = wallet.earned - earnedSeen;
      earnedSeen = wallet.earned;
      if (gain > 0) missionBump('earn', gain);
      if (defer) renderGoal();
      else renderWallet(bump);
      maybeStarterToast();
    },
    setAccount(next) {
      accountView = { ready: next?.ready !== false, guest: !!next?.guest, linked: !!next?.linked };
      renderAccount();
    },
    promptLink,
    openLogin,
    setRevenge(until) { revengeUntil = Number(until) || 0; },
    setBall(open, until) { ballOpenFlag = !!open; ballUntil = Number(until) || 0; },
    setCrowd(n) {
      const live = Math.max(0, Math.floor(Number(n)) || 0);
      channelCard.hidden = live < 40;
    },
    setPeople(n, channel = 1) {
      const next = Math.max(1, Number(n) || 1);
      const ch = Math.max(1, Number(channel) || 1);
      if (next === people && ch === peopleCh) return;
      people = next;
      peopleCh = ch;
      peopleEl.textContent = peopleTag(next);
      renderStatus();
    },
    setStatus(text, kind = 'warn') { statusText = text || ''; statusKind = kind; renderStatus(); },
    setNear(v) { near = v || null; renderPrompt(); },
    setWorld(next) {
      world = { billboards: next?.billboards || [], plots: next?.plots || [], ranks: next?.ranks || [], today: next?.today || null, week: next?.week || null };
      plazaReady = true;
      renderPrompt();
      rankRefresh?.();
      adRefresh?.();
      paintLive();
      renderGoal();
      maybeStarterToast();
      watchHold();
    },
    refreshProfile: renderProfile,
    boot: {
      progress(p) { if (bootBar && !entered) bootBar.style.width = `${Math.round(Math.max(0.06, Math.min(1, p)) * 92)}%`; },
      ready: bootReady,
      label: bootLabelSet,
    },
    setWish,
    openWish,
    openAway,
    // 🔔 받은 소식 shows only while something is unread.
    setInboxDot(on) { inboxBtn.hidden = !on; },
    // b: live.js nineBanner(t) or null. Writes the DOM only when the text changes.
    setNine(b) {
      const text = b?.text || '';
      ninePhase = text ? b.phase : '';
      if (nineEl.hidden !== !text) nineEl.hidden = !text;
      if (text && nineEl.textContent !== text) nineEl.textContent = text;
      nineEl.classList.toggle('open', ninePhase === 'open');
    },
    resendPush: () => resendPush(),
    openClaimStep,
    setNextLine,
    nextGoal,
    isNewbie: () => !!newbieOn,
    graduate,
    setTutorialLine,
    tutorial: setTutorial,
    nearKind() { return near?.kind || ''; },
    setQuietBlock,
    noteAttend,
    noteServerAttend,
    noteShot,
    news(kind, data) {
      if (kind === 'BILLBOARD') {
        const who = (data?.holder_name || '누군가') + (linkedActor(data?.holder_id, data?.linked) ? ' ✓' : '');
        const id = data?.slot_id || '';
        const where = slotName(id);
        pushNews('BILLBOARD TAKEOVER', [h('em', { text: who }), `님이 ${where}을 점령했습니다! `, data?.line1 ? `“${chars(data.line1, 16)}”` : ''], true, id);
      } else if (kind === 'PLOT') {
        const who = (data?.owner_name || '누군가') + (linkedActor(data?.owner_id) ? ' ✓' : '');
        const lv = LEVELS[Math.max(0, Math.min(4, Number(data?.level) || 0))];
        pushNews('REAL ESTATE', [h('em', { text: who }), `님의 ${data?.plot_id}번 토지에 ${lv.t}가 올라갔습니다`], true, data?.plot_id ? 'PLOT_' + data.plot_id : '');
      } else if (kind === 'STAR') pushNews('EVENT · STARFALL', [h('em', { text: '별똥별 코인 샤워' }), ' 시작! 먼저 닿는 사람이 +6 코인']);
      else if (kind === 'WISH') pushNews('TODAY’S WISH', [h('em', { text: chars(data?.nick || '누군가', 16) }), '님이 소원을 걸었어요'], false);
      else if (kind === 'WELCOME') pushNews('WELCOME', [h('em', { text: data?.nick || '' }), '님, 위시보드에 오신 걸 환영해요!'], false);
    },
  };
}
