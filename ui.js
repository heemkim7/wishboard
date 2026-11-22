// Plaza UI: glass HUD, wallet, news wire, emote dock, prompts, bungeo-ppang timing game, K-POP rhythm game,
// taxi HUD, city map + minimap, billboard / plot / ATM / settings / credits sheets, onboarding, touch controls, SFX.
import { paintBillboard, paintNeonSign, THEMES, makeCanvas, chars, fontsReady, tierOf, boardPhoto, photoReady, paintNameTag, paintRingFx, paintFrameSwatch } from './ts3d/art.js?v=202611222045';
import { LAYOUT, LOOP, insideLoop, PLOT_SLOTS, TAXI_STANDS, LANDMARKS } from './ts3d/layout.js?v=202611222045';
import { BALANCE, PAY, askBid, auctionClosed, buildingOf, chainBoost, floorOf, nextChainFace, slotName, josa, STREET_N, SLOT_SOON, slotOpen, SHOP_KINDS, shopTiles, shopItem } from './balance.js';
import { claimWizard, crowdFacts, firstStep, graduation, kstDay, newcomer, newcomerKnown, peopleTag, tutorialNext, tutorialTap, silentGrad, wishStep, wishHeart, wishDraft, shareWish, present, msgText, pushAsk, PUSH_WHY } from './ftue.js?v=202611222045';
import { WISH, WISH_ERR, cleanWish, wishRejected, wishShareText } from './wish.js';
import { botNick, leagueLine, leagueWeek, liveSig } from './league.js';
import { backFields, returnGap } from './growth.js?v=202611222045';
import { A2HS_KEY, VISITS_KEY, bumpVisits, isStandalone, isIosSafari, installMode, installDue, INSTALL_COPY, INSTALL_CRAMPED_Q } from './install.js?v=202611222045';
import { RECAP_KEY, RECAP_SHOWN_KEY, noteDay, noteHeld, noteHearts, noteClaim as recapClaim, recapDue, recapLines, recapShareText, weekOf } from './recap.js?v=202611222045';
import { nineSlot, nowMs } from './live.js';
import { cardUrl, vipShareLink, composeWishShot, kakaoFeed, kakaoSend, loadKakao, invited } from './share.js?v=202611222045';
import { inviteView } from './invite.js';
import { TILE, ROAD, AREA } from './ts3d/nyc.js?v=202611222045';
import { EMOTES, REACTIONS, AVATAR_COLORS, AVATAR_COLOR_NAMES, SPECIES } from './ts3d/avatars.js?v=202611222045';
import { trackEvent, statsOff, statsGpc, setStatsOff } from './analytics.js?v=202611222045';
import { CHEER_PHRASES, SITE, accountLabel, allowedLink, blockedText, linkedActor } from './plaza-account.js';
import { codeStart, codeStep, codeView, otpField } from './mailcode.js?v=202611222045';
import { policyDoc } from './legal.js?v=202611222045';
import { setOperator, operatorInfo } from './legal.js?v=202611222045';
import { SUPPORT_KINDS, SUPPORT_TEXT, SUPPORT_CONSENT, SUP, supportFault, textLen, maintOf, maintLines, operatorLine } from './opsrules.js';
import { subscribePush, resendPush } from './push.js?v=202611222045';
import { bindSfx, bindMusic, duckMusic, play, setSound, haptic, musicVisible } from './audio.js?v=202611222045';
import { createBgm } from './bgm.js?v=202611222045';
import { stickVec, isTouchUI, STICK_W, STICK_H, STICK_THROW, STICK_ENGAGE, bakeFlip, bakeBest, BAKE_FLIPS, BAKE_ROUND_MS, COMPACT_HUD_Q, feverChip } from './interact.js?v=202611222045';
import { AD, AD_TEMPLATES, adSums, adBars } from './adreport.js';
import { adScreenName, linkHost } from './adsale.js';
import { qrEncode, paintQr } from './qr.js?v=202611222045';
import { icon } from './uiicons.js?v=202611222045';
import { createBackKeeper, createInputLock, sheetPlan, draftAtRisk, toastMs, toastText, proofOffers, proofPlan, TOAST } from './overlay.js?v=202611222045';
import { linesFault, LINES_ERR, airAsk } from './ftue.js?v=202611222045'; // the board-line and takeover checks

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
  // The same test as index.html's html.touch (interact.js isTouchUI): a coarse pointer or more than one touch point.
  const coarse = isTouchUI({ coarse: matchMedia('(pointer: coarse)').matches, points: navigator.maxTouchPoints });
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
  let dance = null, driving = false, waypoint = null, rideLine = '', offerTold = 0;
  // Movement is locked by owner (overlay.js): 'sheet', 'bake', 'dance', 'proof', 'city' (entered before the city is built).
  // It comes back only when no owner is left. A caller that names no owner shares the 'other' slot; nothing here uses it.
  const inputLock = createInputLock(typeof hooks.lockInput === 'function' ? hooks.lockInput.bind(hooks) : () => {});
  hooks.lockInput = (on, owner) => inputLock.set(owner, !!on);

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
  // The tracks have no files: bgm.js plays them on this context, under the effects (audio.js hands them over).
  const bgm = createBgm(() => (soundOn ? ac() : null), () => audio.master);
  bindMusic(bgm);
  setSound(soundOn); // music and vibration follow the 🔊 setting too (audio.js)
  // In the background the synth ambience and the music stop; they come back with the page (if the sound is on).
  document.addEventListener('visibilitychange', () => {
    const hidden = document.visibilityState === 'hidden';
    musicVisible(!hidden);
    if (!audio.ctx) return;
    if (hidden) audio.ctx.suspend?.().catch?.(() => {});
    else if (soundOn) audio.ctx.resume?.().catch?.(() => {});
  });
  let lofi = false;
  // 멍때리기 plays bgm.js's lounge track over the square's track (it used to be three low sine tones gliding between
  // chords, which sounded like a hum), and the square's track comes back when the player gets up.
  function lofiStart() {
    if (!soundOn || lofi) return;
    lofi = true;
    bgm.over('lounge');
  }
  function lofiStop() {
    if (!lofi) return;
    lofi = false;
    bgm.over(null);
  }
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
      if (!city || bgm.playing) return; // the bell is for a quiet square; the track has its own
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
    h('button', { class: 'btn gold', type: 'button', text: '계정 연결 +300', onclick: (e) => { e.preventDefault(); e.stopPropagation(); openLogin(); } }),
  );
  const nextLineEl = h('p', { class: 'nextline', hidden: true });
  // 밤 9시 banner (main.js setNine, once a second): before 21:00 a tap looks at the main tower, inside the window it opens
  // the claim sheet on a main tower slot. It never opens anything by itself. Hidden for newcomers (index.html).
  let ninePhase = '';
  const nineEl = h('button', { type: 'button', class: 'glass nine', hidden: true, onclick: () => {
    if (ninePhase === 'pre') hooks.focusShot?.('MAIN_TOP');
    else if (ninePhase === 'open') openBillboard(nineSlot(world.billboards), 'tower');
  } });
  // Compact phone HUD (index.html, interact.js COMPACT_HUD_Q): the coin amount rides in the identity row, with a +N badge
  // while coins wait to be settled. Hidden elsewhere; the wallet card above stays the desktop and tablet readout.
  const idAmt = h('span', { class: 'tnum', text: '0' });
  const idPend = h('span', { class: 'pend tnum', hidden: true });
  const idCoin = h('button', { class: 'id-coin', type: 'button', 'aria-label': '내 지갑', title: '지갑 · 정산 안내', onclick: () => openWalletInfo() },
    h('img', { src: 'icons/coin.jpg?v=2', alt: '' }), idAmt, idPend);
  root.append(h('div', { class: 'hud-l' }, h('div', { class: 'glass ident' }, profile, idCoin, channelCard), guestWarn, walletEl, nineEl, nextLineEl, liveBoard));
  const feverText = h('span', { class: 'fl', text: '코인 2배 0/20' });
  // fs: the short text the compact HUD shows (interact.js feverChip); .idle hides the chip there while the gauge is empty.
  const feverShort = h('span', { class: 'fs', text: '2배 0/20' });
  const feverEl = h('button', { type: 'button', class: 'glass fever idle', title: '택시 손님을 내리거나 전광판을 점령하면 1칸. 20칸이 되면 1분 동안 코인이 2배이고 택시 부스트가 무제한입니다.', onclick: () => openToday() }, icon('orb'), feverText, feverShort);
  root.querySelector('.hud-l')?.append(feverEl);
  // Is the compact phone HUD on? Only on a touch device (html.touch) inside COMPACT_HUD_Q; the goal line moves with it.
  const compactMq = matchMedia(COMPACT_HUD_Q);
  const compactNow = () => coarse && compactMq.matches;
  compactMq.addEventListener?.('change', () => placeGoal());

  const soundBtn = h('button', { class: 'btn ghost icon tool-more', type: 'button', 'aria-label': '사운드', title: '사운드', onclick: () => {
    soundOn = !soundOn;
    store('kts_sound', soundOn);
    setSound(soundOn);
    soundBtn.replaceChildren(icon(soundOn ? 'soundOn' : 'soundOff'));
    if (!soundOn) { cityStop(); lofiStop(); stopDanceAudio(); return; } // a dance in progress goes on without its music
    cityStart();
    if (!loungeEl.hidden) lofiStart();
    sfx.click();
  } }, icon(soundOn ? 'soundOn' : 'soundOff'));
  const fsOn = () => document.fullscreenElement || document.webkitFullscreenElement;
  // byUser: the fullscreen button. Without it (entering the plaza) only a touch device goes fullscreen; a desktop window stays
  // as it is. Escape is never locked: it leaves fullscreen the way the browser says it does.
  function askFullscreen(byUser) {
    if (!byUser && !coarse) return;
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req || fsOn()) return;
    try {
      const p = req.call(el, { navigationUI: 'hide' });
      if (p && p.catch) p.catch(() => {});
    } catch {
      try { const p = req.call(el); if (p && p.catch) p.catch(() => {}); } catch { /* this browser keeps its own chrome */ }
    }
  }
  const fsBtn = h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': '전체 화면', title: '전체 화면', onclick: () => {
    if (fsOn()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      const p = exit && exit.call(document);
      if (p && p.catch) p.catch(() => {});
    } else askFullscreen(true);
  } }, icon('fullscreen'));
  const syncFs = () => { fsBtn.replaceChildren(icon(fsOn() ? 'fullscreenExit' : 'fullscreen')); };
  document.addEventListener('fullscreenchange', syncFs); // leaving fullscreen does not end a dance
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
  // 화면만 보기 (compact phone HUD only, index.html): the eye under the map hides the HUD to look around; the joystick, the
  // action buttons and this button stay, and the same button brings the HUD back. Remembered for this tab's session only.
  const viewBtn = h('button', { class: 'glass view-btn', type: 'button', 'aria-label': '화면만 보기', title: '화면만 보기', 'aria-pressed': 'false', onclick: () => setViewOnly(!root.classList.contains('viewonly')) }, icon('eye'));
  function setViewOnly(on) {
    root.classList.toggle('viewonly', !!on);
    viewBtn.setAttribute('aria-pressed', String(!!on));
    viewBtn.setAttribute('aria-label', on ? '화면 다시 보기' : '화면만 보기');
    viewBtn.title = on ? '화면 다시 보기' : '화면만 보기';
    viewBtn.replaceChildren(icon(on ? 'eyeOff' : 'eye'));
    try { sessionStorage.setItem('kts_viewonly', on ? '1' : '0'); } catch { /* private mode */ }
    if (on) { foldTools(false); toggleReacts(false); }
  }
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
        h('button', { class: 'btn icon tool-fold', type: 'button', 'aria-label': '메뉴 더보기', title: '메뉴', 'aria-expanded': 'false', onclick: (e) => foldTools(!e.currentTarget.parentElement.classList.contains('open')) }, icon('more')),
      ),
    ),
    mapEl,
    locPill,
    viewBtn,
  ));
  // The phone ⋯ fold: closed again once one of its items is chosen, or on a tap anywhere outside the capsule.
  const toolsEl = root.querySelector('.tools');
  function foldTools(open) {
    if (!toolsEl) return;
    toolsEl.classList.toggle('open', !!open);
    toolsEl.querySelector('.tool-fold')?.setAttribute('aria-expanded', String(!!open));
  }
  toolsEl?.addEventListener('click', (e) => { if (e.target.closest?.('.tool-more')) foldTools(false); });
  document.addEventListener('pointerdown', (e) => { if (toolsEl?.classList.contains('open') && !e.target.closest?.('.tools')) foldTools(false); });

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
  // Touch: the four actions (1-4 on a keyboard) live in this panel, under a '동작' heading with their names, above the
  // '리액션' emoji. The dock button says '동작' too: as bare line icons in the first emoji row they were not found.
  if (coarse) {
    reactPanel.prepend(h('p', { class: 'rh', text: '동작' }), ...dock.querySelectorAll('.emote:not(.more)'), h('p', { class: 'rh', text: '리액션' }));
    dock.querySelector('.sep')?.remove();
    moreBtn.title = '동작 · 리액션';
    moreBtn.setAttribute('aria-label', '동작 · 리액션');
    const cap = moreBtn.querySelector('.l');
    if (cap) cap.textContent = '동작';
    reactPanel.setAttribute('aria-label', '동작 · 리액션');
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
  // The controls card fades 16 s after entering (helpFade from the boot card's enter), not after the page load.
  const helpFade = () => setTimeout(() => help.classList.add('fade'), 16000);

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
    h('div', { class: 'keys' }, ...(coarse ? ['조이스틱 ↑↓ 가속·후진 · ←→ 핸들 · ', icon('bolt'), ' 부스트 · 택시 내리기 버튼'] : ['W/S 가속·브레이크 · A/D 핸들 · Shift 부스트 · Space 경적 · E 택시 내리기'])),
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
  // A desktop window keeps it over the dock; on touch it joins the floating stack below (index.html "The floating stack").
  if (!coarse) root.append(sponsorEl);
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
  // Touch: a board's card (the focus link's 소원 주인 card, a taxi drop-off) is a piece of the floating stack, so it stays
  // clear of the dock, the pouch and the action buttons, and the toasts climb over it (it used to be 148px up, 8-16px in
  // from both edges, over 멍때리기, 동작 and the pouch).
  if (coarse) toasts.prepend(sponsorEl);

  const needle = h('div', { class: 'needle' });
  // One bake = BAKE_FLIPS flips, one per BAKE_ROUND_MS (interact.js); the best flip is the session's result.
  const BAKE_STOP = coarse ? '버튼을 눌러 뒤집으세요' : 'Space · Enter · 클릭으로 뒤집기';
  const bakeHint = h('span', { class: 'hint', text: BAKE_STOP });
  const bakeMarks = h('span', { class: 'tnum' });
  const bakeBtn = h('button', { class: 'btn gold stop', type: 'button', onclick: () => stopBake(), text: '지금 뒤집기!' });
  const bakeEl = h('div', { class: 'glass bake', role: 'dialog', 'aria-hidden': 'true', 'aria-label': '붕어빵 굽기' },
    h('header', null, h('h3', null, ...withIcon('fish', '황금 붕어빵 굽기')), bakeMarks),
    h('div', { class: 'gauge' },
      h('span', { class: 'lbl side', style: { left: '42.5%' }, text: 'GOOD' }),
      h('span', { class: 'lbl', style: { left: '50%', color: 'var(--on-accent, #1c1300)' }, text: 'GOLD' }),
      h('span', { class: 'lbl side', style: { left: '57.5%' }, text: 'GOOD' }),
      needle),
    h('div', { class: 'row' }, bakeHint, bakeBtn),
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
  // In a taxi the same button is the horn.
  function paintJump() {
    jumpBtn.classList.toggle('honk', driving);
    jumpBtn.setAttribute('aria-label', driving ? '경적' : '점프');
    if (driving) jumpBtn.textContent = '빵!';
    else jumpBtn.replaceChildren(icon('arrowUp'));
  }
  // Floating stick: a touch in the lower-left area (interact.js stickZone, STICK_W x STICK_H) that moves STICK_ENGAGE px
  // becomes the stick, centred where it went down, with STICK_THROW px of throw. The area sits under every other HUD
  // piece (first child of #ui), so their buttons keep their taps; a touch that does not move is handed to the world as
  // a tap (hooks.tapDown / tapUp), so a board or a plot under the area still opens. A mouse never uses it (touch laptops).
  const joyZone = h('div', { class: 'joyzone', 'aria-hidden': 'true', style: { width: `${STICK_W * 100}%`, height: `${STICK_H * 100}%` } });
  if (coarse) {
    root.prepend(joyZone);
    root.append(joy, h('div', { class: 'acts' }, boostBtn, actBtn, jumpBtn));
    let jp = null, origin = null, engaged = false;
    const rest = () => {
      engaged = false;
      joy.classList.remove('live');
      joy.style.left = joy.style.top = joy.style.bottom = '';
      knob.style.transform = '';
    };
    const place = () => {
      const rr = root.getBoundingClientRect();
      const s = joy.offsetWidth || 116;
      joy.style.left = `${origin.x - rr.left - s / 2}px`;
      joy.style.top = `${origin.y - rr.top - s / 2}px`;
      joy.style.bottom = 'auto';
      joy.classList.add('live');
    };
    joyZone.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse' || jp != null) return;
      ev.preventDefault();
      jp = ev.pointerId;
      try { joyZone.setPointerCapture(jp); } catch { /* already gone */ }
      origin = { x: ev.clientX, y: ev.clientY };
      engaged = false;
      hooks.tapDown?.(ev.clientX, ev.clientY);
    });
    joyZone.addEventListener('pointermove', (ev) => {
      if (ev.pointerId !== jp || !origin) return;
      const dx = ev.clientX - origin.x, dy = ev.clientY - origin.y;
      if (!engaged) {
        if (Math.hypot(dx, dy) < STICK_ENGAGE) return;
        engaged = true;
        place();
      }
      const v = stickVec(dx, dy, STICK_THROW);
      knob.style.transform = `translate(${v.ox}px, ${v.oy}px)`;
      hooks.joystick(v.x, v.y);
    });
    const end = (ev) => {
      if (ev.pointerId !== jp) return;
      jp = null;
      // The world decides whether this was a tap (it moved 7 px or less, under 450 ms). A cancelled touch never is, and
      // neither is one that became the stick: a quick flick that ends near where it began must not pick a board.
      if (ev.type === 'pointercancel' || engaged) hooks.tapUp?.(origin.x + 999, origin.y);
      else hooks.tapUp?.(ev.clientX, ev.clientY);
      origin = null;
      if (engaged) hooks.joystick(0, 0);
      rest();
    };
    joyZone.addEventListener('pointerup', end);
    joyZone.addEventListener('pointercancel', end);
    // A touch laptop's mouse drags the camera everywhere: the area stands aside while the mouse is in use.
    window.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse' && jp == null) joyZone.style.pointerEvents = 'none'; }, { passive: true });
    window.addEventListener('pointerdown', (ev) => { if (ev.pointerType !== 'mouse') joyZone.style.pointerEvents = ''; }, { passive: true, capture: true });
  }
  // One-time coach line for touch: how to look around, until the first drag on the city (kts_coach). It is the bottom of the
  // floating stack (the toasts' column, index.html "The floating stack"); its two halves are spans so a narrow column can
  // set them as two lines without the dot.
  const coachEl = h('div', { class: 'coach', role: 'status', hidden: true }, h('span', { text: '끌어서 둘러보기' }), h('span', { class: 'sep', text: ' · ' }), h('span', { text: '두 손가락으로 확대' }));
  if (coarse) toasts.prepend(coachEl);
  let coachTimer = 0;
  function coachDone() {
    clearTimeout(coachTimer);
    if (!coachEl.hidden) coachEl.hidden = true;
  }
  function coachStart() {
    if (!coarse || recall('kts_coach', 0)) return;
    const view = document.getElementById('view');
    let from = null;
    const down = (e) => { if (e.pointerType !== 'mouse') from = { x: e.clientX, y: e.clientY }; };
    const move = (e) => {
      if (!from || Math.hypot(e.clientX - from.x, e.clientY - from.y) < 24) return;
      store('kts_coach', 1);
      coachDone();
      view?.removeEventListener('pointerdown', down);
      view?.removeEventListener('pointermove', move);
    };
    view?.addEventListener('pointerdown', down, { passive: true });
    view?.addEventListener('pointermove', move, { passive: true });
    view?.addEventListener('pointerup', () => { from = null; }, { passive: true });
    coachTimer = setTimeout(() => {
      if (recall('kts_coach', 0)) return;
      coachEl.hidden = false;
      coachTimer = setTimeout(coachDone, 15000);
    }, 4000);
  }

  // ---------------------------------------------------------------- helpers
  function renderPending() {
    pendingChip.hidden = !(wallet.pending > 0);
    idPend.hidden = pendingChip.hidden;
    if (pendingChip.hidden) return;
    const info = hooks.walletInfo?.() || {};
    const age = info.pendingSince ? (Date.now() - info.pendingSince) / 1000 : 0;
    const text = info.canSettle === false ? `+${money(wallet.pending)} 미정산 · 테스트 서버` : age < 40 ? `+${money(wallet.pending)} 정산 중…` : `+${money(wallet.pending)} 정산 대기`;
    if (pendingChip.textContent !== text) pendingChip.textContent = text;
    pendingChip.classList.toggle('warn', info.canSettle === false);
    // The compact identity row: only +N; the long line (정산 중… / 정산 대기 / 테스트 서버) is the wallet sheet's and the tablet chip's.
    const badge = `+${money(wallet.pending)}`;
    if (idPend.textContent !== badge) idPend.textContent = badge;
    idPend.title = text;
    idPend.classList.toggle('warn', info.canSettle === false);
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
      // "다음 목표: " is its own span so the compact pill can swap it for a small 목표 tag (index.html .ng-k).
      const m = goalText.match(/^(다음 목표: )([\s\S]*)$/);
      if (m) nextLine.replaceChildren(h('span', { class: 'ng-k', text: m[1] }), document.createTextNode(m[2]));
      else nextLine.textContent = goalText;
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
    placeGoal();
    if (was && !on) {
      starterToastShown = true;
      root.classList.add('reveal');
      setTimeout(() => root.classList.remove('reveal'), 1600);
      setTutorial('grad');
    }
    renderGoal();
  }
  // Where the goal line sits: the newcomer card above the wallet, the line inside the wallet card, or on the compact
  // phone HUD a pill straight under the identity row (the wallet card is hidden there).
  function placeGoal() {
    if (compactNow()) { if (nextLine.nextElementSibling !== guestWarn) guestWarn.before(nextLine); }
    else if (newbieOn) walletEl.before(nextLine);
    else walletEl.querySelector('.sub')?.append(nextLine);
  }
  function graduate() {
    if (grad) return;
    grad = true;
    store('kts_grad', 1);
    syncNewbie();
  }
  function renderWallet(bump) {
    amtEl.textContent = money(wallet.confirmed + wallet.pending);
    idAmt.textContent = amtEl.textContent;
    renderPending();
    renderGoal();
    if (bump) for (const el of [walletEl, idCoin]) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  }
  let accountView = { ready: false, guest: false, linked: false }, bootLogin = null;
  function renderProfile() {
    nameEl.replaceChildren(document.createTextNode(hooks.nick()));
    if (accountView.linked) nameEl.append(h('i', { class: 'verified', title: '인증 계정' }, icon('check')));
    avatarEl.style.setProperty('--me', hooks.color());
    avatarEl.textContent = (SPECIES.find((s) => s.id === hooks.species()) || SPECIES[0]).glyph;
  }
  function renderAccount() {
    guestWarn.hidden = !(accountView.ready && accountView.guest && !accountView.linked);
    if (bootLogin) bootLogin.hidden = guestWarn.hidden; // the boot card's "이미 계정이 있어요 · 로그인" is for a guest only
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
  // note(text, kind, onClick): how long it stays comes from its length (overlay.js toastMs; a tappable one at least 8 s),
  // a tappable one carries a chevron, and while a sheet or the proof bar is up the stack sits at the top (index.html).
  // opts.ms overrides the time. Returns the toast element.
  function note(text, kind = '', onClick, opts) {
    const say = toastText(text, kind);
    if (!say) return null;
    const click = typeof onClick === 'function' ? onClick : null;
    const t = h(click ? 'button' : 'div', { class: `glass toast ${kind}${click ? ' hit' : ''}`, type: click ? 'button' : null },
      say, click ? h('i', { class: 'go', 'aria-hidden': 'true' }, icon('chevronRight')) : null);
    if (click) t.addEventListener('click', () => { t.remove(); click(); });
    toasts.append(t);
    // Over three: the oldest plain one goes first, so a tappable notice is not pushed out by a burst of coin lines. Only
    // toasts count: the cards in the same column (hint, far-board card, 홈 화면 추가, lottery result, a board's card) are not
    // theirs to drop.
    const shown = () => [...toasts.children].filter((c) => c.classList.contains('toast'));
    for (let list = shown(); list.length > 3; list = shown()) (list.find((c) => c !== t && !c.classList.contains('hit')) || list[0]).remove();
    setTimeout(() => { if (!t.isConnected) return; t.classList.add('out'); setTimeout(() => t.remove(), 320); }, Number(opts?.ms) > 0 ? Number(opts.ms) : toastMs(say, !!click));
    return t;
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
    newsEl.classList.remove('crawl');
    newsEl.classList.add('show');
    // A line longer than the bar crawls once from its start to its end (index.html .news.crawl, about 70px a second after
    // a 1 s pause), and the bar stays up until its end has been read; with reduced motion it keeps the "…" and the 4.4 s.
    const over = Math.ceil(newsText.scrollWidth - newsText.clientWidth);
    const crawl = over > 2 && !matchMedia('(prefers-reduced-motion: reduce)').matches ? Math.min(8000, Math.max(1500, over * 14)) : 0;
    if (crawl) {
      newsText.style.setProperty('--crawl', `${-over}px`);
      newsText.style.setProperty('--crawl-s', `${crawl / 1000}s`);
      newsEl.classList.add('crawl');
    }
    if (item.sound) sfx.news();
    setTimeout(() => {
      newsEl.classList.remove('show', 'go');
      newsEl.dataset.slot = '';
      setTimeout(() => { newsBusy = false; newsEl.classList.remove('crawl'); pumpNews(); }, 600);
    }, Math.max(4400, 1000 + crawl + 1200));
  }
  function cooldownLeft() { return Math.max(0, coolUntil - performance.now()); }
  function armCooldown() { coolUntil = performance.now() + COOLDOWN; }
  setInterval(() => { if (near && (near.kind === 'crowd' || near.kind === 'cart')) renderPrompt(); }, 400);
  // Second line per device: a phone has the round button (and no keys), a keyboard has Space / E.
  const PRESS = coarse ? '버튼을 누르면' : 'Space 또는 E를 누르면';
  const PROMPTS = {
    crowd: ['같이 함성', '옆에 사람이 있어야 해요', '함성'],
    cart: ['붕어빵 굽기', `${PRESS} 시작 · 세 번 뒤집어요`, '굽기!'],
    atm: ['황금 ATM 열기', '전광판 · 토지 거래', 'ATM'],
    stage: ['댄스 시작', `${PRESS} 시작 · 이모지 4번은 게임이 아니에요`, '댄스!'],
    taxi: ['정차한 택시 탑승', '지나가는 택시는 타지 않아요', '탑승'],
    stand: ['택시 호출', '오면 그 자리에서 탑승', '호출'],
    fountain: ['포춘쿠키 뽑기', '빨간 계단 앞 분수', '뽑기'],
    ring: ['황금 링 통과', '걸어서도, 택시로도 링을 지나가면 +8', '통과'],
    lounge: ['빨간 계단에서 멍때리기', '켜 두면 20초마다 +2', '관람'],
    adscreen: ['광고 화면', `${PRESS} 광고 정보가 열려요`, '광고'],
  };
  let focusOn = false, exitLabel = '';
  function renderPrompt() {
    const show = !!near && !baking && !sheet && !dance && !driving && !focusOn;
    promptEl.classList.toggle('show', show);
    actBtn.hidden = driving ? false : !(show && coarse);
    if (driving) { exitLabel = '택시 내리기'; actBtn.textContent = exitLabel; return; }
    exitLabel = '';
    if (!near) return;
    const left = cooldownLeft();
    // A board in front of the player: the world sends the line for its state (빈 전광판 / {이름}님의 전광판 / 내 전광판).
    // A board on the map whose row is not in the database yet (STREET_31..50 before the migration) says so.
    const p = near.kind === 'board'
      ? (!slotOpen(world.billboards, near.id) ? ['곧 열리는 전광판', slotName(near.id), '보기'] : Array.isArray(near.p) ? near.p : ['전광판 열기', slotName(near.id), '전광판'])
      : near.kind === 'crowd'
      ? (near.n
        ? [`같이 함성 · 옆 ${near.n}명`, left > 0 ? `다음 함성까지 ${(left / 1000).toFixed(0)}초` : '옆 사람과 같이', '함성']
        : ['함성', left > 0 ? `다음 함성까지 ${(left / 1000).toFixed(0)}초` : '코인은 전광판 응원에서 들어와요', '함성'])
      : (PROMPTS[near.kind] || [`${near.id}번 건물 · ${levelOf(near.id).t}`, `${PRESS} 분양 정보가 열려요`, '건물']);
    promptText.textContent = p[0];
    promptSub.textContent = p[1];
    actBtn.textContent = p[2];
  }
  // A tap on a board far away (60 m+) or from a taxi: a small card near the bottom instead of a sheet. Nothing is
  // locked and it fades after 4 s. info: { dist, driving, state: 'free' | 'dark' | 'other' | 'mine', who }.
  let farEl = null, farTimer = 0;
  function hideFar() {
    clearTimeout(farTimer);
    const el = farEl;
    farEl = null;
    if (!el) return;
    el.classList.remove('show');
    setTimeout(() => el.remove(), 260);
  }
  function showFarCard(slot, info = {}) {
    if (!slot || sheet || baking || dance) return;
    hideFar();
    const state = info.state || 'free';
    const who = state === 'other' ? `${info.who || '익명'}님의 전광판` : state === 'mine' ? '내 전광판' : '빈 전광판';
    const far = Number.isFinite(info.dist) ? ` · ${Math.round(info.dist)}m` : '';
    const act = (text, fn, cls = '') => h('button', { type: 'button', class: cls, text, onclick: () => { hideFar(); fn(); } });
    const cheerBtn = act('응원', () => hooks.cheer?.(slot, 1));
    cheerBtn.disabled = state !== 'other';
    const el = h('div', { class: 'farcard', role: 'status' },
      h('div', { class: 'where' }, h('b', { text: slotName(slot) }), h('span', { text: who + far })),
      h('div', { class: 'far-acts' }, // not 'acts': that class is the touch button column (absolute, pointer-events: none)
        act('보기', () => hooks.focusShot?.(slot)),
        cheerBtn,
        act(state === 'mine' ? '수정' : '걸기', () => (state === 'mine' ? openAd(slot) : openBillboard(slot)), 'go')));
    toasts.prepend(el); // the bottom of the floating stack: toasts go above it, never on it
    farEl = el;
    requestAnimationFrame(() => el.classList.add('show'));
    farTimer = setTimeout(hideFar, 4000);
  }
  // A tap (or E) on an ad screen AD_1..AD_5 (adsale.js): the same small card, labelled 광고, with the advertiser's link.
  // info: { id, kind: 'ad' | 'house' | 'city', ad }; open(ad): opens the link and counts the click (main.js).
  function showAdCard(info = {}, open) {
    if (!info.id || sheet || baking || dance) return;
    hideFar();
    const ad = info.kind === 'ad' ? info.ad : null, site = ad?.u ? linkHost(ad.u) : '';
    const act = (text, fn, cls = '') => h('button', { type: 'button', class: cls, text, onclick: () => { hideFar(); fn(); } });
    const title = ad ? chars((ad.l || []).filter(Boolean).join(' · '), 40) : info.kind === 'house' ? '이 화면에 광고하세요' : '광고 화면';
    const sub = ad ? `${adScreenName(info.id)}${site ? ' · ' + site : ''}` : info.kind === 'house' ? '하루 단위 · 생일·응원 광고' : `${adScreenName(info.id)} · 지금은 비어 있어요`;
    const acts = [];
    if (ad && site) acts.push(act('링크 열기', () => open?.(ad), 'go'));
    if (!ad && info.kind === 'house') acts.push(act('광고 안내', () => { try { window.open('/ads', '_blank', 'noopener'); } catch { location.href = '/ads'; } }, 'go'));
    acts.push(act('닫기', () => { }));
    const el = h('div', { class: 'farcard adcard', role: 'status' },
      h('div', { class: 'where' }, h('b', {}, h('span', { class: 'adtag', text: '광고' }), document.createTextNode(' ' + title)), h('span', { text: sub })),
      h('div', { class: 'far-acts' }, ...acts));
    toasts.prepend(el);
    farEl = el;
    requestAnimationFrame(() => el.classList.add('show'));
    farTimer = setTimeout(hideFar, 6000);
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
  // One session (SESS start .. end) is BAKE_FLIPS rounds of BAKE_ROUND_MS: one flip per round (a round with no flip
  // burns), the best flip is the result, so the panel closes when the Room's 8 s session can pay. { wait: true } (the
  // tutorial) parks the needle until the first tap, and the session starts with that tap.
  const MARK = { gold: '★', good: '●', miss: '✕' };
  function paintBakeMarks() {
    if (!baking) return;
    const marks = Array.from({ length: BAKE_FLIPS }, (_, i) => MARK[baking.flips[i]] || '○').join(' ');
    bakeMarks.textContent = baking.live ? `${marks} · 가장 잘 구운 판으로 초록 +${BALANCE.bakeGood} · 정중앙 +${BALANCE.bakeGold}` : `${marks} · 세 번 뒤집어요`;
  }
  function bakeRound() {
    baking.held = false;
    baking.pos = Math.random() * 0.2;
    baking.dir = 1;
    baking.speed = 0.42 + Math.random() * 0.12 + baking.flips.length * 0.05;
    needle.style.opacity = '';
  }
  function startBake(o = {}) {
    if (baking || sheet) return false;
    if (near?.kind !== 'cart') { note('붕어빵 포차 앞으로 가까이 가세요', 'err'); return false; }
    const left = cooldownLeft();
    if (left > 0) { note(`붕어빵 틀이 식는 중… ${(left / 1000).toFixed(1)}초`); return false; }
    if (hooks.bakeBusy?.()) { note('방금 구운 붕어빵을 확인하는 중이에요'); return false; }
    baking = { flips: [], pos: 0.08, dir: 1, speed: 0.42, live: false, held: false, roundAt: 0, doneAt: 0 };
    bakeEl.classList.add('show');
    bakeEl.setAttribute('aria-hidden', 'false');
    hooks.lockInput(true, 'bake');
    renderPrompt();
    sfx.click();
    if (o.wait) {
      needle.style.left = `${baking.pos * 100}%`;
      bakeHint.textContent = coarse ? '버튼을 누르면 바늘이 움직여요' : 'Space · Enter · 클릭으로 시작';
      bakeBtn.textContent = '굽기 시작';
      paintBakeMarks();
    } else beginRounds();
    return true;
  }
  function beginRounds() {
    if (!baking || baking.live) return;
    baking.live = true;
    baking.roundAt = performance.now();
    bakeRound();
    bakeHint.textContent = BAKE_STOP;
    bakeBtn.textContent = '지금 뒤집기!';
    paintBakeMarks();
    hooks.beginBake?.();
  }
  function flipBake(burnt) {
    if (!baking?.live || baking.held || baking.doneAt) return;
    baking.held = true;
    const r = burnt ? 'miss' : bakeFlip(baking.pos);
    baking.flips.push(r);
    needle.style.opacity = '0.45';
    paintBakeMarks();
    haptic(12);
    if (r === 'gold') sfx.crit();
    else if (r === 'good') sfx.hit();
    else sfx.miss();
    if (r !== 'miss') hooks.bakeFlip?.(r);
    if (baking.flips.length >= BAKE_FLIPS) baking.doneAt = performance.now() + 600;
  }
  // frame(): needle, burnt rounds, next round, the end.
  function stepBake(now, dt) {
    const b = baking;
    if (!b?.live) return;
    if (b.doneAt) { if (now >= b.doneAt) finishBakeRounds(); return; }
    if (now - b.roundAt >= BAKE_ROUND_MS) {
      if (!b.held) flipBake(true);
      if (baking?.doneAt) return;
      b.roundAt += BAKE_ROUND_MS;
      bakeRound();
      return;
    }
    if (b.held) return;
    b.pos += b.dir * b.speed * dt;
    if (b.pos >= 1) { b.pos = 1; b.dir = -1; }
    if (b.pos <= 0) { b.pos = 0; b.dir = 1; }
    needle.style.left = `${b.pos * 100}%`;
  }
  function closeBake() {
    baking = null;
    needle.style.opacity = '';
    bakeEl.classList.remove('show');
    bakeEl.setAttribute('aria-hidden', 'true');
    hooks.lockInput(false, 'bake');
    renderPrompt();
    if (awayWant) setTimeout(pumpQueued, 1500);
  }
  function finishBakeRounds() {
    const flips = baking.flips.slice();
    closeBake();
    const result = bakeBest(flips);
    missionBump('bake');
    armCooldown();
    if (result === 'miss') { sfx.miss(); showResult('MISS', '앗, 세 판 모두 타버렸어요…', true); note('다음 판', 'ok', () => startBake()); return; }
    if (result === 'gold') { sfx.crit(); showResult('PERFECT!', '황금 붕어빵'); }
    else { sfx.hit(); showResult('GOOD!', '바삭한 붕어빵'); }
    hooks.finishBake?.(result);
  }
  // The stop button, Space / Enter / E and a tap on the panel: start the rounds (tutorial) or flip this round.
  // cancel (Escape, a refused session): close without a result.
  function stopBake(cancel) {
    if (!baking) return;
    if (cancel) { closeBake(); return; }
    if (!baking.live) { beginRounds(); return; }
    flipBake(false);
  }
  // "+6 확인 중" over the cart from the end of the rounds until the PAY (main.js bakeWait / bakePaid).
  let bakeChip = null, bakeChipTimer = 0;
  function bakeWait(text) {
    clearTimeout(bakeChipTimer);
    bakeChip?.remove();
    bakeChip = null;
    if (!text) return;
    bakeChip = h('span', { class: 'chip gold pulse', role: 'status', text, style: { position: 'fixed', left: '0px', top: '0px', zIndex: 31, pointerEvents: 'none', transform: 'translate(-50%, -100%)', visibility: 'hidden' } });
    document.body.append(bakeChip);
    placeBakeChip();
    bakeChipTimer = setTimeout(() => bakeWait(''), 12000);
  }
  function placeBakeChip() {
    if (!bakeChip) return;
    const p = hooks.cartScreen?.();
    const on = !!p && p.visible !== false;
    bakeChip.style.visibility = on ? '' : 'hidden';
    if (on) { bakeChip.style.left = `${Math.round(p.x)}px`; bakeChip.style.top = `${Math.round(p.y - 8)}px`; }
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
    duckMusic(false);
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
    if (dest) { dest.connect(audio.master); danceBus = dest; duckMusic(true); }
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
    hooks.lockInput(true, 'dance');
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
    hooks.lockInput(false, 'dance');
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
  // ---- sheet stack. `sheet` is the top one. A sheet opened from another sheet goes on top and its parent stays alive (hidden,
  // inputs and scroll as they were). backSheet() closes one level (✕, Escape, back, backdrop); closeSheet() closes them all,
  // for when an action is done and the player returns to the plaza. History follows through syncBack (overlay.js).
  const sheets = [];
  let closingAll = false;
  function dropTop(replaced) {
    const top = sheets[sheets.length - 1];
    if (!top) return null;
    replacingSheet = !!replaced;
    try { top.el.remove(); top.cleanup?.(); } finally { replacingSheet = false; }
    sheets.pop();
    sheet = sheets[sheets.length - 1] || null;
    return top;
  }
  function showTop() {
    sheets.forEach((s, i) => {
      const under = i < sheets.length - 1;
      s.el.classList.toggle('under', under);
      s.el.inert = under;
    });
  }
  function afterSheets(gone) {
    showTop();
    hooks.lockInput(sheets.length > 0, 'sheet');
    document.body.classList.toggle('has-sheet', sheets.length > 0);
    renderPrompt();
    syncBack();
    // Focus goes back to what opened the sheet that just closed (a button in the parent sheet, or the HUD).
    const back = gone?.opener;
    if (back && back.isConnected && typeof back.focus === 'function') { try { back.focus({ preventScroll: true }); } catch { /* focus stays where the browser put it */ } }
    if (!sheet && (pushQueued || awayWant)) setTimeout(pumpQueued, 0);
  }
  function backSheet() {
    if (!sheet) return false;
    afterSheets(dropTop(false));
    return true;
  }
  function closeSheet() {
    if (!sheet) return;
    const first = sheets[0];
    closingAll = true;
    try { while (sheets.length) dropTop(false); } finally { closingAll = false; }
    afterSheets(first);
  }
  // The parent of the top sheet, when it is of that kind: "전광판으로 돌아가기" in a child goes back to the live parent.
  function backTo(kind) {
    if (sheets.length < 2 || sheets[sheets.length - 2].kind !== kind) return false;
    return backSheet();
  }
  // A backdrop tap closes a sheet, except one with typing in it: that one asks once, inside the sheet.
  function backdropTap(s) {
    if (s !== sheet) return;
    const values = [...s.box.querySelectorAll('input, textarea')].filter((f) => !f.readOnly && !f.disabled && !/^(checkbox|radio|range|color|file|button|submit|hidden)$/.test(f.type)).map((f) => f.value);
    if (!draftAtRisk(s.typed, values)) { backSheet(); return; }
    if (s.keep?.isConnected) return;
    s.keep = h('div', { class: 'sheet-keep', role: 'alert' },
      h('span', { text: '작성 중인 내용이 있어요. 닫을까요?' }),
      h('button', { class: 'btn ghost', type: 'button', text: '계속 쓰기', onclick: () => s.keep.remove() }),
      h('button', { class: 'btn', type: 'button', text: '닫기', onclick: () => { if (s === sheet) backSheet(); } }));
    s.box.append(s.keep);
  }
  // title: the plain text, or [iconName, text] for a title with a line icon in front.
  // opts.kind: what decides "the same sheet again" (default: the title).
  function openSheet(titleIn, badge, build, narrow, variant, opts) {
    const [titleIcon, title] = Array.isArray(titleIn) ? titleIn : ['', titleIn];
    if (quietBlock && (title === '미션' || title === '계정 연결' || String(title || '').includes('알림'))) return;
    // The proof bar and a sheet are never up together: opening a sheet leaves the bar first (input and history are settled there).
    if (!proof.hidden) leaveProof({ quiet: true });
    const kind = String(opts?.kind || title || '');
    const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    const plan = sheetPlan(sheets.map((s) => s.kind), kind);
    for (let i = 0; i < plan.pop; i++) dropTop(false);
    const old = plan.replace ? dropTop(true) : null;
    const content = h('div', { class: 'content' });
    const x = h('button', { class: 'x', type: 'button', 'aria-label': '닫기', onclick: () => backSheet() }, icon('close'));
    const box = h('div', { class: `glass sheet${narrow ? ' narrow' : ''}${variant ? ' ' + variant : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
      h('header', null, h('h2', null, ...withIcon(titleIcon, title), badge ? h('span', { class: 'badge', text: badge }) : null), x), content);
    const el = h('div', { class: 'modal' }, box);
    document.body.append(el);
    // A re-rendered sheet keeps the opener of the one it replaced; a child remembers the control in its parent.
    const me = { el, box, cleanup: null, title, kind, typed: false, keep: null, opener: old ? old.opener : opener };
    el.addEventListener('click', (e) => { if (e.target === el) backdropTap(me); });
    box.addEventListener('input', (e) => { if (e.isTrusted) me.typed = true; });
    sheets.push(me);
    sheet = me;
    showTop();
    hooks.lockInput(true, 'sheet');
    document.body.classList.add('has-sheet');
    renderPrompt();
    const rawAppend = content.append.bind(content);
    content.append = (...nodes) => rawAppend(...nodes.filter((n) => n != null && n !== false));
    me.cleanup = build(content) || null;
    syncBack();
    // Focus moves into the dialog (the box itself, so a phone does not raise its keyboard), unless the sheet focused a field of its own.
    if (sheet === me && !box.contains(document.activeElement)) { try { box.focus({ preventScroll: true }); } catch { /* not focusable here */ } }
    sfx.click();
  }
  // ---- history (overlay.js createBackKeeper): one entry per open level, one guard entry under them once the plaza is entered.
  // The proof bar is a level from the moment it is asked for: while it waits for the celebration (proofWait) it keeps the
  // entry of the sheet that just closed, so nothing is pushed five seconds later without a tap.
  const backKeeper = createBackKeeper({ hist: history });
  // Entries are pushed only after a real gesture (overlay.js rule 2). pointerup and keydown come before the click they cause.
  addEventListener('pointerup', () => backKeeper.touch(), true);
  addEventListener('keydown', (e) => { if (e.key !== 'Escape') backKeeper.touch(); }, true);
  const proofLevel = () => (!proof.hidden || (proofWait && !proofWait.skip) ? 1 : 0);
  function syncBack() { backKeeper.want(sheets.length + proofLevel()); }
  // Back during the celebration: the bar will not come up, only its notice.
  function skipProofWait() {
    if (!proofWait || proofWait.skip) return false;
    proofWait.skip = true;
    return true;
  }
  addEventListener('popstate', () => {
    const act = backKeeper.pop();
    if (act.back) {
      for (let i = 0; i < act.back; i++) { if (!(sheet ? backSheet() : (leaveProof() || skipProofWait()))) break; }
      syncBack();
    } else if (act.exit) note('한 번 더 누르면 나가요', '', null, { ms: 2000 });
  });
  // Entering the plaza arms the guard after this click has finished (arrive() cleans the address bar first).
  const rawEnter = hooks.enter;
  if (typeof rawEnter === 'function') hooks.enter = (...args) => { const r = rawEnter(...args); setTimeout(() => backKeeper.arm(), 0); return r; };
  const SHARE_TEXT = '붕어빵 구워 뉴욕 타임스퀘어 전광판과 건물을 차지하세요!';
  function countShot() {
    return new Promise((resolve) => {
      // The count is for posing: the overlay lets touches through (the stylesheet's pointer-events: none), input is not
      // locked, so the camera can be turned and emotes fire. body.posing tells the world a tap on a board is not a pick.
      document.body.classList.add('posing');
      const el = h('div', { class: 'countflash', text: '3' });
      document.body.append(el);
      let n = 3;
      const step = () => {
        if (n <= 0) {
          el.textContent = '';
          el.classList.add('flash');
          sfx.shutter();
          let blob = null;
          try { blob = hooks.capture?.() || null; } catch { blob = null; }
          setTimeout(() => { el.remove(); document.body.classList.remove('posing'); resolve(blob); }, 120);
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
    store(VISITS_KEY, bumpVisits(recall(VISITS_KEY, null), d.day)); // days visited, for the home-screen card (install.js)
    wkNoteDay(d.streak); // and the week's record for the Monday card (recap.js)
    a2hs.enteredAt = Date.now();
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
      note(`황금 링 길안내를 시작해요. 걸어서도, 택시로도 링을 지나가면 +${PAY.stunt.base}`, 'ok');
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
    note(`전광판 길안내를 시작해요. 켜진 남의 전광판을 눌러 응원하면 +${PAY.cheer.base}, 멀리서도 돼요`, 'ok');
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
        h('p', { class: 'note', text: `${feverText.textContent}. ${feverEl.title}` }),
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
    const fresh = lost.some((x) => Date.now() - (Number(x.at) || 0) < 600000);
    openSheet('내 전광판', '점령 · 빼앗김', (host) => {
      host.append(h('b', { text: '지금 내 것' }));
      host.append(mine.length ? h('div', { class: 'rows' }, ...mine.map((b) => h('div', { class: 'row', style: { display: 'flex', gap: '8px' } },
        h('button', { class: 'chip', type: 'button', style: { flex: '1' }, text: slotName(b.slot_id) + (boardActive(b) ? ` · ${fmtLeft(lightLeft(b))} 남음` : ' · 불 꺼짐'), onclick: () => openBillboard(b.slot_id) }),
        h('button', { class: 'chip', type: 'button', text: '보기', onclick: () => { closeSheet(); hooks.focusShot?.(b.slot_id); } }),
        h('button', { class: 'chip', type: 'button', text: '링크', onclick: () => copyInvite(b.slot_id) }),
      ))) : h('p', { class: 'note', text: '점령 중인 전광판이 없어요' }));
      host.append(h('b', { text: '빼앗긴 것' }));
      host.append(lost.length ? h('div', { class: 'rows' }, ...lost.map((x) => h('button', { class: 'chip', type: 'button', text: `${slotName(x.slot)} · ${x.by}`, onclick: () => openAd(x.slot) }))) : h('p', { class: 'note', text: '아직 빼앗긴 전광판이 없어요' }));
      // The fare boost the server allows for 10 minutes after a board is taken.
      if (fresh) host.append(h('button', { class: 'btn ghost', type: 'button', onclick: () => hooks.revenge?.() }, ...withIcon('taxi', '되찾을 코인 모으기 · 택시 운임 2배 켜기')));
    }, true, '', { kind: 'holds' });
  }
  // seenHold: slot -> the lines I had on it, so a board that leaves my hands can be offered back with them filled in.
  let seenMe = '';
  function watchHold() {
    const me = hooks.actorId?.() || '';
    if (me !== seenMe) { seenMe = me; seenHold = null; } // another account now: its boards were not taken from anyone
    const now = new Map(myBoards().map((b) => [b.slot_id, { line1: b.line1 || '', line2: b.line2 || '', line3: b.line3 || '', emoji: b.emoji || '' }]));
    if (seenHold) {
      for (const [id, mine] of seenHold) if (!now.has(id)) {
        const b = boardById(id);
        if (b?.holder_id && b.holder_id !== hooks.actorId?.()) queueTaken({ slot: id, attacker: b.holder_name, ...mine });
      }
    }
    seenHold = now;
  }
  // "○○님이 △△을 가져갔어요 · 되찾기". The socket's TAKE and the world update both report the same loss: one notice per board.
  // It waits while the screen is busy (screenBusy, the gates 다녀간 사이 uses) and is dropped after 10 minutes; the news
  // itself is in 받은 소식 either way (the room stores a `taken` inbox row).
  const takenWant = [], takenSeen = new Map();
  let takenQuietAt = 0;
  function queueTaken(ev) {
    const slot = String(ev?.slot || '');
    if (!slot) return;
    const by = chars(ev.attacker || '', 16) || '누군가';
    rememberTake(slot, by);
    const lines = { line1: String(ev.line1 || ''), line2: String(ev.line2 || ''), line3: String(ev.line3 || ''), emoji: String(ev.emoji || '') };
    const price = Math.max(0, Math.floor(Number(ev.price) || 0));
    const waiting = takenWant.find((t) => t.slot === slot);
    if (waiting) {
      if (ev.attacker) waiting.by = by;
      if (lines.line1 || lines.line2 || lines.line3) waiting.lines = lines;
      if (price) waiting.price = price;
      return;
    }
    if (Date.now() - (takenSeen.get(slot) || 0) < 60000) return;
    takenWant.push({ slot, by, lines, price, at: Date.now() });
  }
  function pumpTaken(now = performance.now()) {
    while (takenWant.length && Date.now() - takenWant[0].at > 600000) takenWant.shift();
    if (!takenWant.length) return;
    if (!entered || screenBusy()) { takenQuietAt = 0; return; }
    if (!takenQuietAt) { takenQuietAt = now; return; }
    if (now - takenQuietAt < 1000) return;
    takenQuietAt = 0;
    const t = takenWant.shift();
    if (boardById(t.slot)?.holder_id === hooks.actorId?.()) return; // already mine again
    takenSeen.set(t.slot, Date.now());
    sfx.siren();
    note(`${t.by}님이 ${josa(slotName(t.slot), '을', '를')} 가져갔어요 · 되찾기`, 'err', () => retake(t));
  }
  // The ordinary billboard sheet for that board with my old lines filled in; its priced button is the confirmation.
  function retake(t) {
    openBillboard(t.slot);
    const s = sheet;
    if (!s || s.kind !== '전광판 점령') return;
    const fill = (sel, val) => {
      const f = s.box.querySelector(sel);
      if (!f || !val) return;
      f.value = chars(val, f.maxLength > 0 ? f.maxLength : 16);
      f.dispatchEvent(new Event('input', { bubbles: true }));
    };
    fill('input[placeholder^="메인 문구"]', t.lines.line1);
    fill('input[placeholder^="둘째 줄"]', t.lines.line2);
    fill('input[placeholder^="셋째 줄"]', t.lines.line3);
    fill('input[aria-label="이모지"]', t.lines.emoji);
    const have = wallet.confirmed + wallet.pending;
    const need = t.price || minBid(boardById(t.slot) || { slot_id: t.slot }, world.billboards, hooks.actorId?.());
    if (have < need) note(`코인이 ${money(need - have)} 모자라요 · 택시 운임 2배 켜기`, '', () => hooks.revenge?.());
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
  // One button, one request: the button stays disabled while its own spend is out, so a double tap cannot pay twice.
  async function busyTap(btn, job) {
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try { await job(); } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  }
  function stickerBox(getSlot) {
    const wash = h('button', { type: 'button', class: 'btn ghost', hidden: true, onclick: (ev) => busyTap(ev.currentTarget, async () => { try { await hooks.washSticker?.(getSlot()); } catch (e) { note(e?.message || '스티커를 지우지 못했어요', 'err'); } sync(); }) });
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
      h('div', { class: 'row' }, ...STICKER_GLYPHS.map((g) => h('button', { type: 'button', class: 'btn ghost', text: `${g} 30`, onclick: (ev) => busyTap(ev.currentTarget, async () => {
        try { await hooks.sticker?.(getSlot(), g); sync(); } catch (e) { note(e?.message || '스티커를 붙이지 못했어요', 'err'); }
      }) }))),
      wash,
    );
    box.syncStickers = sync;
    sync();
    return box;
  }
  // The 60-second takeover (VIP sheet only). Choosing coins or a ticket opens a second step in the card that says the price,
  // what is left after it, and that it cannot be undone; only 장악하기 there spends, once, with both buttons off while it runs.
  function airBar() {
    const line = h('input', { class: 'input', maxLength: 24, placeholder: '60초 동안 모든 전광판에 올릴 한 줄', 'aria-label': '장악 문구' });
    const err = h('p', { class: 'note login-err', role: 'alert', hidden: true });
    const fail = (text) => { err.textContent = text || ''; err.hidden = !text; };
    const pick = h('div', null,
      h('button', { class: 'btn ghost', type: 'button', text: '5000코인으로 60초 장악', onclick: () => ask('coins') }),
      h('p', { class: 'note', text: `가진 VIP 티켓 ${Math.max(0, Math.floor(Number(wallet.tickets) || 0))}장` }),
      h('button', { class: 'btn ghost', type: 'button', text: 'VIP 티켓 1장으로 60초 장악', onclick: () => ask('ticket') }));
    const sure = h('div', { class: 'air-sure', hidden: true });
    let busy = false;
    const back = () => { sure.hidden = true; sure.replaceChildren(); pick.hidden = false; };
    const ask = (pay) => {
      if (busy) return;
      const v = airAsk({ line: line.value, pay, have: wallet.confirmed + wallet.pending, tickets: wallet.tickets });
      if (!v.ok) { fail(v.err); if (!line.value.trim()) line.focus(); return; }
      fail('');
      const no = h('button', { class: 'btn ghost', type: 'button', text: '취소', onclick: () => { if (!busy) back(); } });
      const yes = h('button', { class: 'btn ghost', type: 'button', text: '장악하기' });
      yes.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        yes.disabled = no.disabled = line.disabled = true;
        yes.textContent = '장악하는 중…';
        const me = sheet;
        try {
          await hooks.takeover?.({ line: v.text, pay });
          if (sheet === me) closeSheet();
        } catch (e) {
          fail(e?.message || '장악에 실패했어요');
          yes.disabled = no.disabled = false;
          yes.textContent = '장악하기';
        } finally {
          busy = false;
          line.disabled = false;
        }
      });
      sure.replaceChildren(
        h('p', { class: 'air-ask' }, h('b', { class: 'gold', text: v.cost }), `을 쓰고 60초 동안 모든 전광판에 ‘${v.text}’ 문구를 올립니다. 되돌릴 수 없어요.`),
        h('p', { class: 'note', text: v.after }),
        h('div', { class: 'air-row' }, no, yes));
      pick.hidden = true;
      sure.hidden = false;
      try { yes.focus({ preventScroll: true }); } catch { /* focus is a nicety */ }
    };
    // A changed line is a new question: back to the choice.
    line.addEventListener('input', () => { fail(''); if (!busy && !sure.hidden) back(); });
    return h('div', { class: 'vipcard' },
      h('h4', null, ...withIcon('board', '전 전광판 60초 장악')),
      h('p', { text: '5000코인 또는 VIP 티켓 1장. 점령자는 바뀌지 않고, 1분 뒤 원래 화면으로 돌아와요.' }),
      line, pick, sure, err,
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
            backSheet();
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
      sheet.inbox = true; // forgetActor closes it: its rows are the old actor's
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
  // 계절 소원 테마 (seasons.js, main.js applySeason): null on a day with no theme. A theme adds one header line on top of the sheet
  // and swaps the three example chips; the form, the rules and the rest of the sheet are the same.
  let season = null;
  const chipsNow = () => season?.chips || WISH_CHIPS;
  function setSeason(next) {
    const was = season?.key || '';
    season = next && next.key && Array.isArray(next.chips) ? next : null;
    if ((season?.key || '') !== was) wishRepaint?.();
  }
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
      const seasonEl = h('p', { class: 'wish-season', hidden: true });
      host.append(seasonEl, focusBox, mineBox, invBox, h('div', { class: 'wish-tabs', role: 'group', 'aria-label': '소원 목록' }, tabTop, tabNew), leftEl, listBox, yBox, h('p', { class: 'note wish-foot', text: WISH_FOOT }));

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
      function paintSeason() {
        seasonEl.hidden = !season;
        if (!season) return;
        seasonEl.textContent = `${season.emoji} ${season.header}`;
        seasonEl.style.setProperty('--season', season.accent);
      }
      function paint() { paintSeason(); paintFocus(); paintMine(); paintList(); paintYesterday(); const t = inviteView({ on: !!hooks.inviteOn?.(), sum: hooks.inviteSum?.() }).box; invBox.textContent = t; invBox.hidden = !t; }
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
        a2hs.act.wish = true;
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
          input = h('input', { class: 'input wish-in', maxLength: 64, placeholder: `예: ${chipsNow()[0]}`, 'aria-label': '오늘의 소원 한 줄', autocomplete: 'off', enterkeyhint: 'done' });
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
            h('div', { class: 'chips wish-chips' }, ...chipsNow().map((t) => h('button', { type: 'button', text: t, onclick: () => { input.value = t; sync(false); showErr(''); input.focus(); } }))),
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
  // Photo review results main.js told this session (photoNews), by slot: { kind: 'on' | 'off' | 'down' | 'lost', text }.
  // The billboard sheet keeps the last one on that board's photo row until a new photo is sent.
  const photoTold = new Map();
  function photoNews(slot, kind, text) {
    if (!slot || !text) return;
    photoTold.set(String(slot), { kind: String(kind || ''), text: String(text) });
  }
  function openBillboard(slotId = 'MAIN_TOP', zone = '') {
    hooks.refreshWorld?.();
    let slot = slotId;
    openSheet(['board', '전광판 점령'], '점령', (host) => {
      const meSheet = sheet; // a late answer must not close a sheet opened after this one
      const badgeEl = host.parentElement?.querySelector('.badge');
      const paintBadge = () => {
        if (!badgeEl) return;
        const b = boardById(slot);
        const mineLive = !!(b?.holder_id && b.holder_id === hooks.actorId() && boardActive(b));
        badgeEl.textContent = !slotOpen(world.billboards, slot) ? '곧 열림' : !mineLive && auctionClosed(slot, nowMs()) ? '9시 오픈' : !b?.holder_id ? '빈칸' : !boardActive(b) ? '불 꺼짐' : '방송 중';
      };
      const canvas = makeCanvas(1024, 576);
      const seg = h('div', { class: 'seg' });
      const slotOption = (id) => {
        const b = boardById(id);
        const mineRow = b?.holder_id && b.holder_id === hooks.actorId();
        if (!slotOpen(world.billboards, id)) return `${slotName(id)} · 곧 열려요`;
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
      // Inline errors: one line under the field or button they are about (the same class as the sign-in sheet's).
      const errLine = () => h('p', { class: 'note login-err', role: 'alert', hidden: true });
      const linesErr = errLine(), toErr = errLine(), urlErr = errLine(), goErr = errLine();
      const say = (el, text) => { el.textContent = text || ''; el.hidden = !text; };
      const hush = () => { for (const el of [linesErr, toErr, urlErr, goErr]) say(el, ''); };
      const urlField = h('div', { class: 'field' }, h('label', null, '외부 링크', h('span', { text: '인스타·스레드·유튜브·스마트스토어 https 주소만 저장됩니다. 전광판을 누르면 상세보기에서 열 수 있습니다' })), urlIn, urlErr);
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
      const photoErr = errLine();
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
      let photoBusy = false; // the 1 s refresh must not re-enable the button while the fee is being taken
      const refreshPhotoGo = () => {
        if (photoBusy) { photoGo.disabled = true; return; }
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
        const key = [slot, mine, st, b?.photo_id || '', !!pic.img, photoTold.get(slot)?.text || ''].join('|');
        if (!force && key === photoKey) return;
        photoKey = key;
        const head = h('div', { class: 'ph-head' }, h('b', null, ...withIcon('camera', '사진 광고')),
          mine && st === 'pending' ? h('span', { class: 'ph-state', text: '검수 중' }) : mine && st === 'approved' ? h('span', { class: 'ph-state on', text: '송출 중' }) : null,
          h('span', { class: 'ph-fee', text: `${tierOf(slot)}급 +${money(fee())} 코인` }));
        // The last review result told for this board (main.js photoNews), until a new photo is chosen.
        const told = photoTold.get(slot);
        const result = told && told.kind !== 'on' && st !== 'pending' && !pic.img ? h('div', { class: 'callout' }, icon('info'), ' ', told.text) : null;
        if (!mine) {
          const mineDark = b?.holder_id === hooks.actorId() && !boardActive(b);
          photoBox.replaceChildren(...[head, result, h('p', { class: 'note', text: mineDark
            ? '불이 꺼져 있어요. 위쪽 불 켜기를 누르면 사진을 올릴 수 있어요.'
            : '전광판을 점령한 사람만 사진을 올릴 수 있어요. 운영자가 확인한 사진만 광장 전체에 송출되고, 확인 전에는 글자 전광판으로 보여요.' })].filter(Boolean));
          return;
        }
        if (st === 'pending') {
          photoBox.replaceChildren(head, h('div', { class: 'callout warn' }, icon('hourglass'), ' ', h('b', { text: '검수 중' }), ' — 운영자가 확인하면 바로 송출돼요. 거절되면 사진 요금은 전액 환불됩니다. 그동안은 글자 전광판으로 보여요.'));
          return;
        }
        const kids = [head];
        if (result) kids.push(result);
        if (st === 'approved' && !pic.img) kids.push(h('div', { class: 'callout ok' }, icon('checkCircle'), ' ', h('b', { text: '사진 송출 중' }), ' — 새 사진으로 바꾸면 요금이 다시 들고, 검수 동안은 글자 전광판으로 보여요.'));
        kids.push(h('button', { class: 'btn ghost', type: 'button', onclick: () => photoFile.click() }, ...withIcon('image', pic.img ? '다른 사진 고르기' : st === 'approved' ? '사진 바꾸기' : '사진 고르기')));
        if (!pic.img) kids.push(photoErr);
        if (pic.img) {
          kids.push(
            h('div', { class: 'ph-zoom' }, h('span', { text: '확대' }), zoomIn),
            h('p', { class: 'note', text: '미리보기를 드래그해서 사진 위치를 맞추세요. 문구 세 줄은 높이 슬라이더로 옮기고, 점령할 때 함께 저장돼요.' }),
            h('label', { class: 'agree' }, agree, h('span', { text: '직접 찍었거나 사용 권리가 있는 사진이고, 다른 사람의 얼굴·연락처 같은 개인정보나 선정적·혐오 표현이 없어요.' })),
            photoGo, photoErr);
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
        say(photoErr, '');
        if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 20e6) { say(photoErr, 'JPG·PNG·WEBP 사진만, 20MB 이하로 올려 주세요'); return; }
        const url = URL.createObjectURL(f);
        try {
          const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
          let src = img, w = img.naturalWidth, hh = img.naturalHeight;
          if (w < 320 || hh < 180) { say(photoErr, '사진이 너무 작아요. 가로 320px 이상인 사진을 골라 주세요'); return; }
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
          say(photoErr, '이 사진은 열 수 없어요. JPG나 PNG로 올려 주세요');
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
        if (photoBusy || !pic.img || !agree.checked) return;
        photoBusy = true;
        photoGo.disabled = true;
        say(photoErr, '');
        setIconText(photoGo, '', '사진 보내는 중…');
        let failed = '';
        try {
          const blob = await encodePhoto();
          if (!blob) throw new Error('사진을 300KB 아래로 줄이지 못했어요. 다른 사진으로 시도해 주세요');
          const photo = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
          await hooks.submitPhoto({ slot_id: slot, photo });
          pic.img = null;
          agree.checked = false;
          photoTold.delete(slot);
          sfx.hit();
          note('사진을 보냈어요! 운영자가 확인하면 전광판에 송출됩니다', 'ok');
        } catch (e) {
          failed = e?.message || '사진을 보내지 못했어요';
        }
        photoBusy = false;
        renderPhoto(true);
        refreshPhotoGo();
        say(photoErr, failed);
        paint();
      });
      let placing = false; // a claim, edit or tribe claim is out: one request per tap
      const refreshBid = () => {
        paintBadge();
        if (!slotOpen(world.billboards, slot)) {
          go.disabled = true;
          tribeGo.disabled = true;
          setIconText(go, '', '곧 열려요');
          balance.replaceChildren(h('span', { text: SLOT_SOON }));
          return;
        }
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
        // While a claim is out, the 1 s refresh keeps both buttons off and the label on "…중".
        if (placing) { go.disabled = true; tribeGo.disabled = true; return; }
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
        hush();
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
      const hotIds = Array.from({ length: STREET_N }, (_, i) => 'STREET_' + (i + 1));
      const cheapIds = Array.from({ length: 18 }, (_, i) => 'PLOT_' + (i + 1));
      const tipsEl = h('div', { class: 'rows' });
      const pickNote = h('p', { class: 'note', text: '위에 보이는 이름은 이 전광판의 지금 주인입니다. 핸드폰과 컴퓨터가 다른 계정이면, 컴퓨터에서 점령한 이름이 여기 그대로 보입니다.' });
      const tips = () => {
        const me = hooks.actorId?.();
        const have = wallet.confirmed + wallet.pending;
        const scored = [];
        for (const id of [...towerIds, ...hotIds, ...cheapIds]) {
          if (!slotOpen(world.billboards, id)) continue;
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
        const ids = (zone === 'pick' ? tips() : zone === 'tower' ? towerIds : zone === 'hot' ? hotIds : zone === 'cheap' ? cheapIds : mineIds).filter((id) => slotOpen(world.billboards, id));
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
      const toField = h('div', { class: 'field', hidden: true }, h('label', null, '받는 사람'), toName, toErr);
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
        onclick: (ev) => busyTap(ev.currentTarget, async () => {
          try {
            const res = await hooks.pledge?.(slot, n);
            if (!res) { note('10, 20, 50만 모을 수 있어요', 'err'); return; }
            note(`소속 모금 ${n}`, 'ok');
          } catch (e) {
            const msg = e?.message === 'tribe' ? '소속에 들어간 뒤에 모금할 수 있어요' : (e?.message || '모금하지 못했어요');
            note(msg, 'err');
            if (e?.message === 'tribe' || msg.startsWith('소속에 들어간')) openTribeSheet();
          }
        }),
      })));
      const placeBoard = async (mode) => {
        if (placing) return;
        hush();
        if (!slotOpen(world.billboards, slot)) { say(goErr, SLOT_SOON); return; }
        const b = boardById(slot) || { slot_id: slot };
        if (mode !== 'tribe' && b.holder_id === hooks.actorId?.() && !boardActive(b)) {
          say(goErr, '불 켜기로 다시 72시간을 이을 수 있어요');
          return;
        }
        const mineLive = mode !== 'tribe' && boardActive(b) && b.holder_id === hooks.actorId?.();
        if (mineLive) mode = 'edit';
        const bid = Math.floor(Number(bidIn.value) || 0);
        const have = wallet.confirmed + wallet.pending;
        const extra = mode === 'edit' ? Math.max(0, bid - (Number(b.current_bid) || 0)) : bid;
        if (state.gift && !toName.value.trim()) { say(toErr, '받는 사람 이름을 적어 주세요'); toName.focus(); return; }
        const draft = data();
        // A blank board is never posted (it would spend the free slot or the coins on nothing). Editing a board that shows
        // a photo may clear the caption: the photo is the ad.
        const photoOn = b.photo_status === 'approved' || b.photo_status === 'pending';
        if (linesFault(draft.line1, draft.line2, draft.line3) === 'empty' && !(mode === 'edit' && photoOn)) {
          say(linesErr, LINES_ERR.empty);
          lines[0].focus();
          return;
        }
        if (blockedText(draft.line1) || blockedText(draft.line2) || blockedText(draft.line3) || blockedText(hooks.nick?.())) {
          say(linesErr, '그 문구는 올릴 수 없어요');
          return;
        }
        let link = urlIn.value.trim();
        if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
        if (link) {
          const kept = allowedLink(link);
          if (!kept) {
            more.open = true; // the link box lives in the folded block
            say(urlErr, '인스타, 스레드, 유튜브, 스마트스토어 주소만 저장됩니다');
            urlIn.focus();
            return;
          }
          link = kept;
        }
        const floor = minBid(b, world.billboards, hooks.actorId?.(), [lines[0].value, lines[1].value, lines[2].value].join('\n'));
        if (mode !== 'edit' && auctionClosed(slot, nowMs())) { say(goErr, '메인 타워는 밤 9시부터 10분 동안만 점령할 수 있어요'); return; }
        if (mode !== 'tribe' && (have < extra || bid < floor)) {
          say(goErr, have < extra ? `코인이 부족해요. 지금 ${money(have)}, ${money(extra)} 필요` : `최소 ${money(floor)} 코인부터 입찰`);
          refreshBid();
          return;
        }
        if (mode === 'tribe' && bid < floor) { say(goErr, `최소 ${money(floor)} 코인부터 입찰`); return; }
        placing = true;
        go.disabled = true;
        tribeGo.disabled = true;
        setIconText(go, '', mode === 'edit' ? '고치는 중…' : '점령 중…');
        try {
          const d = data();
          const payload = { slot_id: slot, bid, line1: d.line1, line2: d.line2, line3: d.line3, caption_y: d.caption_y, emoji: d.emoji, bg_theme: d.bg_theme, text_color: d.text_color, external_url: link };
          if (mode === 'tribe' || mode === 'edit') payload.mode = mode;
          const res = await hooks.claim(payload);
          if (res?.review_id) {
            placing = false;
            if (sheet === meSheet) closeSheet();
            return;
          }
        } catch (e) {
          placing = false;
          const msg = e?.message === 'tribe' ? '소속에 들어간 뒤에 소속 코인으로 걸 수 있어요' : (e?.message || '점령에 실패했습니다');
          // Both buttons come back before anything else: the 소속 sheet opens on top and this sheet is returned to.
          go.disabled = false;
          tribeGo.disabled = false;
          refreshBid();
          if (msg.startsWith('소속에 들어간')) { note(msg, 'err'); openTribeSheet(); return; }
          say(goErr, msg);
          if (sheet !== meSheet) note(msg, 'err'); // the sheet was closed while the claim was out
          return;
        }
        placing = false;
        const giftName = state.gift ? toName.value.trim() : '';
        if (sheet === meSheet) closeSheet();
        sfx.jackpot();
        note(mode === 'edit' ? '문구를 고쳤어요' : giftName ? `${giftName}님 선물을 걸었습니다` : '전광판에 등록됐습니다', 'ok');
        if (mode === 'edit') return;
        hooks.giftPop?.(slot);
        const up = showProof(slot, giftName);
        const nxt = nextChainFace(slot, world.billboards, hooks.actorId?.());
        if (nxt && up) {
          proofNext = () => openSheet('연속 점령', 'CHAIN', (box) => {
            box.append(
              h('p', { text: nxt.left === 1
                ? `🔥 ${nxt.building}의 ${slotName(nxt.id)}까지 점령하면 이 빌딩 전체가 회원님의 독점 타워로 합체됩니다.`
                : `🔥 ${nxt.building}의 ${josa(slotName(nxt.id), '을', '를')} 이으면 독점에 한 칸 더 가까워집니다.` }),
              h('p', { class: 'note', text: `필요 코인 ${money(nxt.price)}부터` }),
              h('button', { class: 'btn primary', type: 'button', onclick: () => { closeSheet(); openBillboard(nxt.id); } }, ...withIcon('bolt', '연속으로 점령하기')),
            );
          }, true);
        }
      };
      const more = h('details', { class: 'more' },
        h('summary', { text: '배경 · 글자색 · 링크' }),
        h('div', { class: 'field' }, h('label', null, '이모지'), emo),
        h('div', { class: 'field' }, h('label', null, '배경'), themes),
        h('div', { class: 'field' }, h('label', null, '글자색'), inks),
        urlField);
      go.addEventListener('click', () => placeBoard('claim'));
      tribeGo.addEventListener('click', () => placeBoard('tribe'));
      for (const i of lines) i.addEventListener('input', () => say(linesErr, ''));
      toName.addEventListener('input', () => say(toErr, ''));
      urlIn.addEventListener('input', () => say(urlErr, ''));
      bidIn.addEventListener('input', () => say(goErr, ''));
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
          h('div', { class: 'field' }, h('label', null, '내 광고 문구'), h('div', { class: 'lines' }, ...lines), linesErr),
          h('div', { class: 'field' }, h('label', null, '입찰 코인'), h('div', { class: 'bid' }, bidIn, steps), balance),
          go,
          tribeGo,
          goErr,
          h('div', { class: 'field' }, h('label', null, '소속 모금', h('span', { text: '10 · 20 · 50' })), pledgeRow),
          (stickers = stickerBox(() => slot)),
          // The photo ad is its own row, open, with its review state in the head (검수 중 / 송출 중). The 60 s takeover lives in VIP.
          photoBox, capRow, photoFile,
          more,
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
      host.append(body, share, copyBox, h('button', { class: 'btn ghost', type: 'button', text: '전광판으로 돌아가기', onclick: () => { if (!backTo('전광판 점령')) openBillboard(slot); } }));
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
        const kids = [table, chart, h('p', { class: 'note', text: `${md(kstDay(Date.parse(r.since)))}부터 센 숫자예요. 막대는 하루의 택시 손님·응원·링크 방문을 더한 수예요.` }),
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
        h('button', { class: 'btn ghost', type: 'button', text: '전광판으로 돌아가기', onclick: () => { if (!backTo('전광판 점령')) openBillboard(slot); } }));
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
      const me = sheet; // a late answer must not close a sheet opened after this one
      go.addEventListener('click', async () => {
        if (blockedText(signIn.value) || blockedText(hooks.nick?.())) { note('그 간판은 올릴 수 없어요', 'err'); return; }
        if ((wallet.confirmed + wallet.pending) < price) { note(`코인이 부족해요. 지금 ${money(wallet.confirmed + wallet.pending)}, ${money(price)} 필요`, 'err'); return; }
        go.disabled = true;
        setIconText(go, '', '계약 중…');
        try {
          await hooks.buy({ plot_id: id, sign_text: chars(signIn.value, 14), theme_color: color });
          if (sheet === me) closeSheet();
          else setIconText(go, '', '계약 완료'); // still open under another sheet: the button stays off, its price is the old one
          sfx.jackpot();
          note(mine ? '건물이 한 층 더 올라갔습니다!' : '이 땅의 주인이 되었습니다!', 'ok');
          (hooks.celebrateShot || hooks.focusShot)?.('PLOT_' + id);
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
      // The compact phone HUD has no wallet chips: they are these rows at the top of the sheet, with the same labels and
      // the same taps (index.html shows .wal-quick only there). Each opens its sheet over this one.
      const quickRow = (chip, go) => h('button', { class: 'btn ghost', type: 'button', onclick: go }, h('span', { text: chip.textContent }), icon('chevronRight'));
      const quick = h('div', { class: 'wal-quick' });
      const fillQuick = () => quick.replaceChildren(
        quickRow(todayBtn, () => openToday()),
        quickRow(sessionChip, () => openToday()),
        quickRow(holdBtn, () => openHolds()),
        quickRow(tribeBtn, () => openTribeSheet()),
        ...(protectLine.hidden ? [] : [h('button', { class: 'btn ghost wide', type: 'button', onclick: (e) => protectGo(e) }, h('span', { text: protectLine.textContent }), icon('chevronRight'))]),
      );
      const quickSig = () => [todayBtn, sessionChip, holdBtn, tribeBtn, protectLine].map((el) => (el.hidden ? '' : el.textContent)).join('|');
      let quickNow = '';
      const fill = () => {
        if (quickSig() !== quickNow) { quickNow = quickSig(); fillQuick(); }
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
          h('p', { class: 'note', text: '고른 전광판 주인의 지갑으로 내 코인이 그대로 넘어갑니다. 되돌려 받는 금액은 없어요.' }),
          // The send floor (worker.js floored): what the server will refuse, said before the player taps.
          h('p', { class: 'note', text: hooks.isGuest?.() ? '손님은 코인을 보낼 수 없어요. 계정을 연결하면 선물로 받은 코인 580개보다 더 모은 만큼 보낼 수 있어요.' : '선물로 받은 코인 580개까지는 보낼 수 없어요. 그보다 더 모은 만큼만 보낼 수 있어요.' }), pick,
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
        quick,
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
      // 광장 소식: the compact phone HUD has no live board, so its feed list opens from here (index.html .phone-only).
      const feedBtn = h('button', { class: 'btn ghost phone-only', type: 'button', onclick: () => openFeed() }, ...withIcon('board', '광장 소식'));
      host.append(h('div', { class: 'seg' }, tabBtn('week', '이번 주'), tabBtn('spent', '누적'), tabBtn('hot', '실시간 인기 소원'), tabBtn('team', '해시태그')), meEl, list, note, feedBtn);
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
            h('div', { class: 'c' }, h('b', { text: '쥐 · 고양이 · 곰' }), ' — 이 게임에서 만든 모델'),
            h('div', { class: 'c' }, h('b', { text: '캐릭터 동작과 뼈대' }), ' — Adobe Mixamo (걷기·뛰기·춤 등 동작 열 가지)'),
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

  // Ten tiles, five a row (index.html .species-grid): the species' thumbnail, or its glyph while the picture is missing or fails, and its name.
  // The hoodie in each thumbnail wears `color` (the grid's --c, set again by the colour row): the colour multiplied through the
  // species' hoodie mask (SPECIES[].hood), the same hoodie the game paints.
  function speciesPicker(current, onPick, color) {
    const wrap = h('div', { class: 'species-grid', role: 'group', 'aria-label': '캐릭터' });
    if (color) wrap.style.setProperty('--c', color);
    const glyph = (s) => h('span', { class: 'glyph', 'aria-hidden': 'true', text: s.glyph });
    for (const s of SPECIES) {
      let pic = glyph(s);
      if (s.thumb) {
        const img = h('img', { src: s.thumb, alt: '', width: 56, height: 56, loading: 'lazy', decoding: 'async' });
        const hood = s.hood ? h('i', { class: 'hood', 'aria-hidden': 'true', style: { webkitMaskImage: `url(${s.hood})`, maskImage: `url(${s.hood})` } }) : null;
        const box = h('span', { class: 'pic' }, img, hood);
        img.addEventListener('error', () => box.replaceWith(glyph(s)), { once: true });
        pic = box;
      }
      const b = h('button', { type: 'button', class: s.id === current ? 'on' : '', 'aria-pressed': String(s.id === current), onclick: () => {
        for (const other of wrap.children) { other.classList.toggle('on', other === b); other.setAttribute('aria-pressed', String(other === b)); }
        onPick(s.id);
      } }, pic, h('span', { class: 'lbl', text: s.label }));
      wrap.append(b);
    }
    return wrap;
  }

  function colorPicker(current, onPick) {
    const wrap = h('div', { class: 'colors', role: 'group', 'aria-label': '옷 색' });
    for (const c of AVATAR_COLORS) {
      const name = AVATAR_COLOR_NAMES[c] || c;
      const b = h('button', { type: 'button', class: `swatch${c === current ? ' on' : ''}`, style: { background: c, color: c, width: '38px', height: '38px' }, 'aria-label': name, title: name, 'aria-pressed': String(c === current), onclick: () => { for (const s of wrap.children) { s.classList.toggle('on', s === b); s.setAttribute('aria-pressed', String(s === b)); } onPick(c); } });
      wrap.append(b);
    }
    return wrap;
  }

  function openProfile() {
    openSheet(['user', '내 캐릭터'], null, (host) => {
      const input = h('input', { class: 'input', maxLength: 16, value: hooks.nick(), placeholder: '닉네임 (16자)' });
      let color = hooks.color();
      let species = hooks.species();
      const me = sheet; // a late answer must not close a sheet opened after this one
      const save = h('button', { class: 'btn gold cta', type: 'button', text: '저장하기', onclick: async () => {
        if (save.disabled) return;
        const name = chars(input.value, 16).trim() || hooks.nick();
        if (blockedText(name) || botNick(name)) { note('그 이름은 쓸 수 없어요', 'err'); return; }
        save.disabled = true;
        save.textContent = '저장 중…';
        try {
          await Promise.all([hooks.rename(name), hooks.recolor(color), hooks.reshape(species)]);
          renderProfile();
          if (sheet === me) closeSheet();
          else { save.disabled = false; save.textContent = '저장하기'; } // still open under another sheet
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
        h('div', { class: 'field' }, h('label', null, '옷 색', h('span', { text: '후드티 · 발밑 링 · 이름표 점' })), colorPicker(color, (c) => { color = c; grid?.style.setProperty('--c', c); })),
      ];
      const grid = SPECIES.length > 1 ? speciesPicker(species, (id) => { species = id; hooks.wantSpecies?.(id); }, color) : null;
      if (grid) fields.splice(1, 0, h('div', { class: 'field' }, h('label', null, '캐릭터'), grid));
      const prof = hooks.profile?.() || { level: 1, reputation: 0, equip: [], owned: [] };
      const equipped = new Set(Array.isArray(prof.equip) ? prof.equip : []);
      const owned = new Set(Array.isArray(prof.owned) ? prof.owned : []);
      fields.push(h('p', { class: 'note', text: `레벨 ${Math.min(99, Math.max(1, Math.floor(Number(prof.level) || 1)))} · 명성 ${Math.max(0, Math.floor(Number(prof.reputation) || 0))}` }));
      if (hooks.wear) {
        // 꾸미기: what is worn now, and the shop (which is also the locker: owned items are worn or taken off there).
        const worn = [...equipped].map((id) => shopItem(id)?.label).filter(Boolean);
        const mine = [...owned].filter((id) => shopItem(id)).length;
        fields.push(h('div', { class: 'field' }, h('label', null, '꾸미기', h('span', { text: worn.length ? worn.join(' · ') : mine ? `보관함 ${mine}개` : '이름표 · 발밑 링 · 택시 · 테두리' })),
          h('button', { class: 'btn ghost shop-open', type: 'button', onclick: () => openShop() }, icon('gift'), h('span', { text: '꾸미기 상점' }), icon('chevronRight'))));
      }
      host.append(...fields, save);
      setTimeout(() => { if (!coarse) input.focus(); }, 50);
    }, true);
  }

  // ---------------------------------------------------------------- 꾸미기 상점
  // Tabs per kind (balance.js SHOP_KINDS), a tile per item with a live preview (the name tag and foot ring are the same painters the
  // plaza uses, the frame a small board, the taxi and hat a colour swatch), its price and what a tap does now (balance.js shopTiles).
  // A buy takes one confirm (the second tap within 4 s). Before migrations/2026-11-22-shop.sql the shop is shut: '곧 열려요', and only
  // what attendance gave can be worn. Guests are asked to link first: their coins and items live on this device until they do.
  function shopPreview(t) {
    const it = shopItem(t.id);
    if (t.kind === 'tag') {
      const c = makeCanvas(256, 64);
      paintNameTag(c, hooks.nick(), hooks.color(), true, t.id);
      return h('span', { class: 'pv tag' }, c);
    }
    if (t.kind === 'ring') return h('span', { class: 'pv ring' }, paintRingFx(makeCanvas(128, 128), t.id));
    if (t.kind === 'frame') return h('span', { class: 'pv frame' }, paintFrameSwatch(makeCanvas(128, 64), t.id));
    const hex = /^#[0-9a-f]{6}$/i.test(it?.tint || '') ? it.tint : '#ffb020', n = parseInt(hex.slice(1), 16);
    const light = ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) > 140; // dark ink on a light swatch, light ink on a dark one
    return h('span', { class: 'pv tint' }, h('i', { style: { background: hex, color: light ? '#1c1300' : '#f2f4ff' } }, t.kind === 'cab' ? icon('taxi') : icon('gift')));
  }
  const SHOP_ACT = { off: '벗기', worn: '장착 중', wear: '장착', soon: '곧 열려요', short: '코인 부족', buy: '구매' };
  function openShop(startKind) {
    openSheet(['gift', '꾸미기 상점'], `${money(wallet.confirmed + wallet.pending)} 코인`, (host) => {
      let kind = SHOP_KINDS.some((k) => k.kind === startKind) ? startKind : SHOP_KINDS[0].kind;
      let shop = { open: false, items: [], ready: false };
      let armed = '', armTimer = 0, busy = '';
      const me = sheet;
      const grid = h('div', { class: 'shop-grid', role: 'list' });
      const status = h('p', { class: 'note shop-note', text: '상점을 불러오는 중…' });
      const tabs = h('div', { class: 'seg shop-tabs', role: 'tablist', 'aria-label': '꾸미기 종류' });
      for (const k of SHOP_KINDS) {
        tabs.append(h('button', { type: 'button', role: 'tab', class: k.kind === kind ? 'on' : '', 'aria-selected': String(k.kind === kind), text: k.label, onclick: (e) => {
          kind = k.kind; armed = '';
          for (const c of tabs.children) { c.classList.toggle('on', c === e.currentTarget); c.setAttribute('aria-selected', String(c === e.currentTarget)); }
          paint();
        } }));
      }
      const act = async (t) => {
        if (busy) return;
        if (t.act === 'buy' && armed !== t.id) {
          armed = t.id; clearTimeout(armTimer);
          armTimer = setTimeout(() => { if (armed === t.id) { armed = ''; paint(); } }, 4000);
          paint(); return;
        }
        busy = t.id; armed = ''; paint();
        try {
          if (t.act === 'buy') { await hooks.buyCosmetic(t.id, t.price); note(`${josa(t.label, '을', '를')} 샀어요. 바로 장착했어요`, 'ok'); }
          else if (t.act === 'wear') await hooks.wear(t.id);
          else if (t.act === 'off') await hooks.unwear(t.kind);
        } catch (e) {
          note(e?.message || '지금은 살 수 없어요', 'err');
          if (e?.code === 'price') { // the price changed since the list was read: read it again, with the live price the refusal carried for this item
            const live = Math.floor(Number(e.data?.price)) || 0;
            const r = await Promise.resolve(hooks.shop?.()).catch(() => null);
            const fresh = Array.isArray(r?.items) && r.items.length > 0; // a failed reload comes back empty: keep what was shown
            const items = (fresh ? r.items : shop.items).map((it) => (it?.id === t.id && live > 0 ? { ...it, price: live } : it));
            shop = { open: fresh ? !!r.open : shop.open, items, ready: true };
          }
        }
        busy = '';
        if (sheet === me) { const b = me.box.querySelector('h2 .badge'); if (b) b.textContent = `${money(wallet.confirmed + wallet.pending)} 코인`; paint(); }
      };
      const paint = () => {
        const prof = hooks.profile?.() || {};
        const tiles = shopTiles({ kind, open: shop.open, items: shop.items, owned: prof.owned, equip: prof.equip, coins: wallet.confirmed + wallet.pending });
        grid.replaceChildren(...tiles.map((t) => {
          const label = busy === t.id ? '처리 중…' : armed === t.id ? `${money(t.price)}코인 · 한 번 더` : SHOP_ACT[t.act];
          const can = !busy && (t.act === 'buy' || t.act === 'wear' || t.act === 'off');
          return h('div', { class: `shop-item${t.worn ? ' on' : ''}`, role: 'listitem' },
            shopPreview(t),
            h('b', { class: 'nm', text: t.label }),
            h('span', { class: 'pr' }, ...(t.owned ? [t.worn ? '장착 중' : '보관함'] : withIcon('coin', `${money(t.price)} 코인`))),
            h('button', { type: 'button', class: `btn ${t.act === 'buy' ? 'gold' : 'ghost'}${armed === t.id ? ' arm' : ''}`, disabled: !can, text: label, onclick: () => act(t) }));
        }));
        if (!tiles.length) grid.append(h('p', { class: 'note', text: '이 종류는 아직 팔지 않아요.' }));
        status.textContent = !shop.ready ? '상점을 불러오는 중…' : shop.open ? '코인으로만 사요. 종류마다 하나씩 장착하고, 다른 사람에게도 보여요. 주간 리그 지출에는 들어가지 않아요.' : '꾸미기 상점은 곧 열려요. 지금은 출석 7일 보상으로 받은 꾸미기만 장착할 수 있어요.';
      };
      const guest = accountView.ready && accountView.guest && !accountView.linked;
      host.append(
        guest ? h('div', { class: 'callout warn shop-guest', style: { marginTop: 0 } }, '게스트 코인과 꾸미기는 이 기기에만 있어요. 사기 전에 계정을 연결하면 기기를 바꿔도 남고 +300코인도 받아요.',
          h('button', { class: 'btn gold', type: 'button', text: '계정 연결 +300', onclick: () => openLogin() })) : null,
        tabs, grid, status);
      paint();
      Promise.resolve(hooks.shop?.() || { open: false, items: [] }).then((r) => { shop = { open: !!r?.open, items: Array.isArray(r?.items) ? r.items : [], ready: true }; if (sheet === me) paint(); }, () => { shop = { ...shop, ready: true }; if (sheet === me) paint(); });
      return () => clearTimeout(armTimer);
    }, true, '', { kind: '꾸미기 상점' });
  }

  // ---------------------------------------------------------------- boot / onboarding
  // 이용약관 and 개인정보처리방침 unfold inside the sheet that links to them (legal.js policyDoc), so a half-filled form and the game stay.
  // link(kind, text) makes an opener; box is where the text appears and is placed once in that sheet. Tapping the open one folds it.
  function legalFold() {
    const box = h('div', { class: 'legalbox', hidden: true, tabindex: '-1' });
    let shown = '';
    const fold = () => { shown = ''; box.hidden = true; box.replaceChildren(); };
    const show = (kind) => {
      if (shown === kind) { fold(); return; }
      const doc = policyDoc(kind);
      if (!doc) return;
      shown = kind;
      box.replaceChildren(
        h('b', { text: doc.title }),
        ...doc.sections.flatMap((s) => [h('h3', { text: s.h }), h('p', { text: s.p })]),
        h('button', { class: 'btn ghost', type: 'button', text: '닫기', onclick: fold }),
      );
      box.hidden = false;
      box.scrollTop = 0;
      try { box.scrollIntoView({ block: 'nearest' }); box.focus({ preventScroll: true }); } catch { /* older browsers: it is still shown */ }
    };
    const link = (kind, text) => h('button', { type: 'button', class: 'linkbtn', text, onclick: (e) => { e.preventDefault(); e.stopPropagation(); show(kind); } });
    return { box, link };
  }
  function policyLinks() {
    const legal = legalFold();
    return h('div', null, h('p', { class: 'note legal' }, legal.link('terms', '[이용약관]'), ' | ', legal.link('privacy', '[개인정보처리방침]')), legal.box);
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
    showProof(w.slot, w.gift, { waited: true, skip: !!w.skip });
  }
  function openCheerReply(slot, to) {
    if (!slot || !to) return;
    openSheet('답례', null, (host) => {
      host.append(h('p', { class: 'note', text: '정해진 문구만 보낼 수 있어요. 그 사람이 이 채널에 있을 때만 도착해요.' }));
      host.append(h('div', { class: 'chips' }, ...CHEER_PHRASES.map((text, i) => h('button', {
        type: 'button',
        text,
        onclick: () => { if (hooks.replyCheer?.(slot, i + 1, to)) backSheet(); },
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
        // A pick toggles the rows in place (no new sheet): the chosen one tinted with a check, aria-pressed on every row.
        const rows = ids.map((id) => {
          const price = starterOpen(id) ? '무료' : `${money(floorOf(id))}코인`;
          const b = h('button', { class: 'btn pick', type: 'button', onclick: () => { model.choose(id); paintPicks(); } });
          b.dataset.slot = id;
          b.dataset.label = `${slotName(id)} · ${price}`;
          return b;
        });
        const paintPicks = () => {
          for (const b of rows) {
            const on = b.dataset.slot === model.slot;
            b.classList.toggle('on', on);
            b.setAttribute('aria-pressed', String(on));
            setIconText(b, on ? 'check' : '', b.dataset.label);
          }
        };
        paintPicks();
        host.append(...rows);
        host.append(h('div', { class: 'wiz-nav', style: { position: 'sticky', bottom: '0' } },
          h('button', { class: 'btn gold', type: 'button', text: '다음', onclick: () => openClaimStep(2, model) })));
      } else if (n === 2) {
        const names = ['첫째 줄', '둘째 줄', '셋째 줄'];
        const examples = ['올해는 꼭 합격', '우리 가족 건강하게', '#소원'];
        const canvas = makeCanvas(1024, 576);
        const kept = model.lines || ['', '', ''];
        const counts = [0, 1, 2].map(() => h('small', { class: 'count tnum', text: '0/16' }));
        const inputs = [0, 1, 2].map((i) => h('input', { class: 'input', maxLength: 16, placeholder: `${names[i]} · 예: ${examples[i]}`, 'aria-label': names[i], value: chars(kept[i] || '', 16) }));
        const linesErr = h('p', { class: 'note login-err', role: 'alert', hidden: true });
        const linkErr = h('p', { class: 'note login-err', role: 'alert', hidden: true });
        const say = (el, text) => { el.textContent = text || ''; el.hidden = !text; };
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
        inputs.forEach((el) => el.addEventListener('input', () => { say(linesErr, ''); paint(); }));
        host.append(h('div', { class: 'screen' }, canvas));
        host.append(h('p', { class: 'note', text: '전광판에는 이렇게 보여요. 줄마다 16자까지.' }));
        inputs.forEach((el, i) => host.append(h('label', { class: 'claimline' }, el, counts[i])));
        host.append(linesErr);
        // Shop templates and a link: folded for a newcomer (and while that is still undecided), open for everyone else. The filled lines stay editable and pass the same checks.
        const linkIn = h('input', { class: 'input', type: 'url', placeholder: 'https://smartstore.naver.com/...', value: model.link || '', 'aria-label': '가게 링크' });
        linkIn.addEventListener('input', () => say(linkErr, ''));
        const more = h('details', { class: 'more', open: newbieOn === false || !!model.link },
          h('summary', { text: '가게·행사 예시 문구와 링크' }),
          h('div', { class: 'chips' }, ...AD_TEMPLATES.map((t) => h('button', { type: 'button', text: t.label, onclick: () => {
            t.lines.forEach((line, i) => { inputs[i].value = chars(line, 16); });
            say(linesErr, '');
            paint(); inputs[0].focus(); inputs[0].select();
          } }))),
          h('div', { class: 'field' }, h('label', null, '링크', h('span', { text: '인스타·스레드·유튜브·스마트스토어 https 주소만 저장됩니다. 전광판을 누르면 상세보기에서 열 수 있습니다' })), linkIn, linkErr));
        host.append(more);
        paint();
        fontsReady(examples.join(' ') + ' ' + hooks.nick()).then(paint);
        const typed = () => inputs.map((el) => el.value);
        // 이전 keeps what was typed (lines and link) in the model; step 2 fills its boxes from it when it opens again.
        const back = () => { model.keep(...typed()); model.link = linkIn.value.trim(); openClaimStep(1, model); };
        const next = () => {
          const v = typed();
          if (!model.linesOk(...v)) {
            const why = linesFault(...v);
            say(linesErr, LINES_ERR[why] || LINES_ERR.blocked);
            (inputs.find((el) => (why === 'empty' ? true : [...el.value].length > 16 || blockedText(el.value))) || inputs[0]).focus();
            return;
          }
          let link = linkIn.value.trim();
          if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
          if (link && !allowedLink(link)) { more.open = true; say(linkErr, '인스타, 스레드, 유튜브, 스마트스토어 주소만 저장됩니다'); linkIn.focus(); return; }
          model.link = link ? allowedLink(link) : '';
          openClaimStep(3, model);
        };
        host.append(h('div', { class: 'wiz-nav', style: { position: 'sticky', bottom: '0' } },
          h('button', { class: 'btn ghost', type: 'button', text: '이전', onclick: back }),
          h('button', { class: 'btn gold', type: 'button', text: '다음', onclick: next })));
        return () => cancelAnimationFrame(raf);
      } else {
        const free = starterOpen(model.slot);
        const floor = free ? 0 : floorOf(model.slot);
        const label = free ? '무료로 걸기' : '걸기';
        const base = model.payload();
        const me = sheet; // a late answer must not close a sheet opened after this one
        // Summary: the board as it will go up, which slot, the price, and the link when there is one.
        const canvas = makeCanvas(1024, 576);
        const paint = () => paintBillboard(canvas, { slot_id: model.slot, emoji: base.emoji, bg_theme: base.bg_theme, line1: chars(base.line1, 16), line2: chars(base.line2, 16), line3: chars(base.line3, 16), holder_name: hooks.nick(), holder_id: 'preview' });
        paint();
        fontsReady([base.line1, base.line2, base.line3, hooks.nick()].join(' ')).then(paint);
        let host2 = '';
        try { host2 = model.link ? new URL(model.link).hostname.replace(/^www\./, '') : ''; } catch { host2 = ''; }
        const err = h('p', { class: 'note login-err', role: 'alert', hidden: true });
        const say = (text) => { err.textContent = text || ''; err.hidden = !text; };
        const prev = h('button', { class: 'btn ghost', type: 'button', text: '이전', onclick: () => { if (!go.disabled) openClaimStep(2, model); } });
        const go = h('button', { class: 'btn gold', type: 'button', text: label, onclick: () => {
          if (go.disabled) return;
          say('');
          // Step 3 is reached only through step 2's check; this is the last guard before anything is spent.
          if (linesFault(base.line1, base.line2, base.line3)) { say(LINES_ERR[linesFault(base.line1, base.line2, base.line3)]); return; }
          if (!free && (wallet.confirmed + wallet.pending) < floor) { say(`코인이 부족해요. 지금 ${money(wallet.confirmed + wallet.pending)}, ${money(floor)} 필요`); return; }
          const payload = model.payload();
          payload.mode = free ? 'starter' : 'claim';
          payload.bid = free ? 0 : floor;
          if (model.link) payload.external_url = model.link;
          const run = hooks.submitClaim?.(payload);
          if (!run || typeof run.then !== 'function') { say('지금은 걸 수 없어요'); return; }
          go.disabled = prev.disabled = true;
          go.textContent = '거는 중…';
          const slow = setTimeout(() => note('응답이 늦어요. 조금만 기다려 주세요', 'err'), 12000);
          run.then((res) => {
            clearTimeout(slow);
            if (sheet === me) closeSheet();
            if (!res?.review_id && res?.data) showProof(res.data.slot_id || model.slot);
          }).catch((e) => {
            clearTimeout(slow);
            go.disabled = prev.disabled = false;
            go.textContent = label;
            say(e?.message || '점령에 실패했습니다');
            if (sheet !== me) note(e?.message || '점령에 실패했습니다', 'err');
          });
        } });
        host.append(
          h('div', { class: 'screen' }, canvas),
          h('div', { class: 'wiz-sum' },
            h('div', null, h('small', { text: '자리' }), h('b', { text: slotName(model.slot) })),
            h('div', null, h('small', { text: '가격' }), h('b', { class: 'gold', text: free ? '무료' : `${money(floor)}코인` })),
            host2 ? h('div', null, h('small', { text: '링크' }), h('b', { text: host2 })) : null),
          h('p', { class: 'note', text: free ? '첫 칸은 코인이 들지 않아요. 계정마다 한 번이에요.' : `${josa(slotName(model.slot), '은', '는')} ${money(floor)}코인으로 겁니다.` }),
          h('div', { class: 'wiz-nav', style: { position: 'sticky', bottom: '0' } }, prev, go, err));
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
  // Sign-in state main.js reports (setLogin): wait = a Google window is open or a sign-in is finishing (text overrides the button label),
  // err and info = the lines under the Google button. It outlives the sheet, so reopening the sheet shows the same state.
  let loginView = { wait: false, text: '', err: '', info: '' }, loginPaint = null;
  // The code step of an e-mail sign-up (Supabase "Confirm email" on): { v: mailcode.js codeStart/codeStep view, pw: the password the form
  // held }. Kept in memory only, and it outlives the sheet, so closing and reopening the sheet comes back to the code. Gone once linked.
  let codeKeep = null;
  function setLogin(next) {
    loginView = { ...loginView, ...next };
    loginPaint?.();
  }
  function closeLogin() { if (sheet?.login) closeSheet(); }
  // opts.resume: this browser was opened by a handover link, so the sheet says what happens next and the player taps once.
  function openLogin(opts) {
    const env = hooks.authEnv?.() || {};
    const resume = opts?.resume === true && !env.inApp;
    openSheet('계정 연결', '+300', (host) => {
      const me = sheet;
      me.login = true;
      if (!entered) me.el.classList.add('front'); // over the boot card
      loginView = { ...loginView, err: '', info: '' };
      const legal = legalFold();
      // mailOnly: the confirmation is on, so a new account needs a mailbox (an id sign-up could never get its code). inCode: the code step shows.
      let mode = 'in', busy = false, mailOnly = false, inCode = false;
      if (accountView.linked) codeKeep = null;
      const id = h('input', { class: 'input', name: 'username', maxLength: 80, placeholder: '이메일 또는 아이디', autocomplete: 'username', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'next', 'aria-label': '이메일 또는 아이디' });
      const pw = h('input', { class: 'input', name: 'password', type: 'password', maxLength: 72, placeholder: '비밀번호 (6자 이상)', autocomplete: 'current-password', autocapitalize: 'off', enterkeyhint: 'go', 'aria-label': '비밀번호' });
      const agree = h('input', { type: 'checkbox', 'aria-label': '만 14세 이상이며 약관과 개인정보처리방침에 동의' });
      const agreeRow = h('label', { class: 'agree' }, agree, h('span', null, '만 14세 이상이며 ', legal.link('terms', '[이용약관]'), '과 ', legal.link('privacy', '[개인정보처리방침]'), '에 동의합니다.'));
      const formErr = h('p', { class: 'note login-err', role: 'alert', hidden: true });
      // An id has no mailbox behind it (…@id.wishboard.dev), and the game has no reset by e-mail: said before the account is made.
      const idWarn = h('p', { class: 'note', hidden: true, text: '아이디로 만든 계정은 비밀번호를 잊으면 되찾을 수 없어요. 구글로 연결하면 그럴 걱정이 없어요.' });
      const submit = h('button', { class: 'btn gold cta', type: 'submit', text: '로그인' });
      const swap = h('button', { class: 'btn ghost', type: 'button', text: '처음이면 가입' });
      const form = h('form', { class: 'login-form', novalidate: true }, id, pw, agreeRow, idWarn, formErr, submit);
      const fail = (text) => { formErr.textContent = text || ''; formErr.hidden = !text; };
      const sync = () => {
        const up = mode === 'up';
        submit.textContent = busy ? '잠시만요…' : (up ? '가입하고 연결' : '로그인');
        submit.disabled = busy;
        swap.textContent = up ? '이미 계정이 있어요' : '처음이면 가입';
        agreeRow.hidden = !up;
        idWarn.hidden = !up || mailOnly;
        pw.autocomplete = up ? 'new-password' : 'current-password';
        const label = up && mailOnly ? '이메일 주소' : '이메일 또는 아이디';
        id.placeholder = label;
        id.setAttribute('aria-label', label);
        if (up && mailOnly) id.setAttribute('inputmode', 'email'); else id.removeAttribute('inputmode');
      };
      agree.addEventListener('change', () => { if (agree.checked) fail(''); });
      swap.addEventListener('click', () => { mode = mode === 'up' ? 'in' : 'up'; fail(''); sync(); });
      // Enter: id → password, password → submit (the form's own submit).
      id.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); pw.focus(); } });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (busy) return;
        if (mode === 'up' && !agree.checked) { fail('만 14세 이상이고 약관과 개인정보처리방침에 동의해야 가입할 수 있어요'); agree.focus(); return; }
        busy = true;
        fail('');
        sync();
        try {
          // { email, via, wait }: the address needs its mailed code first (the code step below); nothing: signed in and linked.
          const next = await hooks.passwordAuth?.(mode, id.value, pw.value);
          if (next?.email) {
            codeKeep = { v: codeStart(next), pw: pw.value };
            if (sheet === me) showCode(true);
            else away(next.via === 'in' ? '가입 확인이 끝나지 않았어요. 눌러서 메일의 코드를 넣으세요' : '메일로 6자리 코드를 보냈어요. 눌러서 코드를 넣으세요', 'ok');
          } else if (sheet === me) closeSheet();
        } catch (err) {
          const text = err?.message || '로그인에 실패했어요';
          fail(text);
          if (sheet !== me) note(text, 'err'); // the player closed the sheet while it was out: its line would never be read
        } finally {
          busy = false;
          sync();
        }
      });
      // In-app browsers block Google sign-in. The handover link carries this guest into the system browser; it can be empty until it is ready.
      const browser = env.android ? '크롬' : '사파리';
      const google = h('button', { class: 'btn login-google', type: 'button' });
      const gErr = h('p', { class: 'note login-err', role: 'alert', hidden: true });
      const gInfo = h('p', { class: 'note', role: 'status', hidden: true });
      const paint = () => {
        google.disabled = !!loginView.wait;
        google.textContent = loginView.wait ? (loginView.text || '구글 창에서 계속하세요…') : (resume ? '구글로 계속' : 'Google로 계속');
        gInfo.textContent = loginView.info || '';
        gInfo.hidden = !loginView.info || inCode;
        gErr.textContent = loginView.err || '';
        gErr.hidden = !loginView.err || inCode;
      };
      const linkOut = h('input', { class: 'input', readOnly: true, hidden: true, 'aria-label': `${browser}에서 열 링크` });
      const copySaid = h('p', { class: 'note', role: 'status', hidden: true });
      const say = (text) => { copySaid.textContent = text; copySaid.hidden = !text; };
      const copy = h('button', { class: 'btn ghost', type: 'button' }, ...withIcon('link', `${browser}에서 열 링크 복사`));
      copy.addEventListener('click', async () => {
        const url = (hooks.authEnv?.() || {}).handoverUrl || '';
        if (!url) { say('링크를 준비하는 중이에요. 잠시 뒤에 다시 눌러 주세요'); return; }
        try {
          await navigator.clipboard.writeText(url);
          say(`링크를 복사했어요. ${browser} 주소창에 붙여 넣으세요`);
        } catch {
          linkOut.value = url;
          linkOut.hidden = false;
          linkOut.select();
          say('복사가 막혀 있어요. 아래 링크를 길게 눌러 복사하세요');
        }
      });
      // Out of the in-app browser: each route is tried in turn while this page is still in front (the app that takes one hides it).
      const leave = (routes) => {
        const at = Date.now();
        let i = 0, hid = false;
        const onHide = () => { if (document.visibilityState === 'hidden') hid = true; };
        document.addEventListener('visibilitychange', onHide);
        const next = () => {
          if (hid || i >= routes.length || Date.now() - at > 4000) { document.removeEventListener('visibilitychange', onHide); return; }
          const url = routes[i++];
          try { location.href = url; } catch { /* a scheme this webview does not know */ }
          setTimeout(next, 1200);
        };
        next();
      };
      const handOver = () => {
        const now = hooks.authEnv?.() || {};
        if (!now.handoverUrl) { setLogin({ err: '링크를 준비하는 중이에요. 잠시 뒤에 다시 눌러 주세요' }); return; }
        const routes = Array.isArray(now.routes) ? now.routes : [];
        hooks.handoverFired?.();
        loginPaint = null;
        // The instruction stays in the sheet (a toast would be gone by the time the player comes back to this app).
        host.replaceChildren(...[
          h('div', { class: 'callout', style: { marginTop: 0 } }, routes.length
            ? `${browser}에서 이어서 진행 중이에요. 로그인이 끝나면 그 창에서 계속하세요`
            : `이 앱 안에서는 구글 로그인이 열리지 않아요. 아래 링크를 복사해 ${browser} 주소창에 붙여 넣으면, 거기서 이어서 연결됩니다. 로그인이 끝나면 그 창에서 계속하세요`),
          routes.length ? h('p', { class: 'note', text: `${env.android ? '크롬이' : '사파리가'} 열리지 않았다면 아래 링크를 복사해 ${browser} 주소창에 붙여 넣으세요.` }) : null,
          copy, copySaid, linkOut,
          h('button', { class: 'btn ghost', type: 'button', text: '아이디로 로그인', onclick: () => openLogin() }),
        ].filter(Boolean));
        if (routes.length) leave(routes);
        else copy.click();
      };
      google.addEventListener('click', () => {
        if (env.inApp) { handOver(); return; }
        loginView = { ...loginView, err: '', info: '' };
        // Not awaited: main.js opens the Google window in this same task, then reports through setLogin.
        try { hooks.oauth?.('google'); }
        catch (e) { setLogin({ wait: false, err: e?.message || '구글 로그인을 열지 못했어요' }); }
      });
      const kids = [
        resume ? h('div', { class: 'callout', style: { marginTop: 0 } }, '구글 로그인으로 이어서 연결합니다') : null,
        h('p', { class: 'note', style: resume ? null : { marginTop: 0 }, text: '연결하면 전광판과 코인이 남아요. 보상은 계정마다 한 번 +300.' }),
        google,
        gInfo,
        gErr,
        h('p', { class: 'note login-terms' }, 'Google로 계속하면 만 14세 이상이며 ', legal.link('terms', '이용약관'), '과 ', legal.link('privacy', '개인정보처리방침'), '에 동의하는 것으로 봅니다'),
      ];
      if (env.inApp) kids.push(h('p', { class: 'note', text: env.routed ? `이 앱 안에서는 구글 로그인이 열리지 않아, 누르면 ${env.android ? '크롬으로' : '사파리로'} 넘어갑니다.` : `이 앱 안에서는 구글 로그인이 열리지 않아요. 아이디로 가입하거나, ${browser}에서 열 링크를 복사하세요.` }), copy, copySaid, linkOut);
      kids.push(h('div', { class: 'login-or', text: '또는' }), form, swap, legal.box);
      // The code step (Supabase "Confirm email" on). The sign-up mailed a 6-digit code ({{ .Token }} in the template), typed here so this
      // tab's guest, the one with the coins, is the one linked. It takes the place of everything above but the policy box.
      const codeIn = h('input', { class: 'input', name: 'one-time-code', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]*', maxLength: 10, placeholder: '6자리 코드', enterkeyhint: 'go', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': '메일로 받은 6자리 코드', style: { fontSize: '22px', letterSpacing: '0.3em', textAlign: 'center' } });
      const codeTitle = h('div', { class: 'callout', style: { marginTop: 0 } });
      const codeMail = h('p', { class: 'note' });
      const codeLead = h('p', { class: 'note' });
      const codeInfo = h('p', { class: 'note', role: 'status', hidden: true });
      const codeErr = h('p', { class: 'note login-err', role: 'alert', hidden: true });
      const codeGo = h('button', { class: 'btn gold cta', type: 'submit' });
      const codeForm = h('form', { class: 'login-form', novalidate: true }, codeIn, codeInfo, codeErr, codeGo);
      const codeAgain = h('button', { class: 'btn ghost', type: 'button' });
      const codeBack = h('button', { class: 'btn ghost', type: 'button', text: '다른 주소로 하기' });
      const codeNodes = [codeTitle, codeMail, codeLead, codeForm, codeAgain, codeBack];
      for (const n of codeNodes) n.hidden = true;
      const formNodes = kids.filter((n) => n && n !== legal.box);
      let saved = [], tick = 0;
      // A result that arrives after the player closed the sheet: its line would never be read, so it is a toast, and a tap reopens the sheet.
      const away = (text, kind = 'err') => { if (sheet !== me) note(text, kind, () => openLogin()); };
      const paintCode = () => {
        const k = codeKeep;
        if (!k) return;
        const cv = codeView(k.v);
        codeTitle.textContent = cv.title;
        codeMail.replaceChildren(cv.mailLabel + ' ', h('b', { text: cv.email }));
        codeLead.textContent = cv.lead;
        codeGo.textContent = cv.submit;
        codeGo.disabled = cv.submitOff;
        codeIn.disabled = cv.submitOff;
        codeAgain.textContent = cv.resend;
        codeAgain.disabled = cv.resendOff;
        codeBack.disabled = !!k.v.busy;
        codeInfo.textContent = cv.info;
        codeInfo.hidden = !cv.info;
        codeErr.textContent = cv.err;
        codeErr.hidden = !cv.err;
        if (!cv.left && tick) { clearInterval(tick); tick = 0; }
      };
      const ticking = () => { if (!tick && sheet === me) tick = setInterval(paintCode, 1000); };
      const setCode = (ev) => { if (!codeKeep) return null; codeKeep = { ...codeKeep, v: codeStep(codeKeep.v, ev) }; paintCode(); return codeKeep.v; };
      // on: the code step replaces the form (each node's own hidden state comes back with the form).
      const showCode = (on) => {
        if (on !== inCode) {
          inCode = on;
          if (on) { saved = formNodes.map((n) => n.hidden); for (const n of formNodes) n.hidden = true; }
          else formNodes.forEach((n, i) => { n.hidden = saved[i] ?? false; });
          for (const n of codeNodes) n.hidden = !on;
        }
        if (on) { codeIn.value = ''; paintCode(); ticking(); try { codeIn.focus({ preventScroll: true }); } catch { /* not focusable yet */ } }
        else { clearInterval(tick); tick = 0; paint(); sync(); }
      };
      codeIn.addEventListener('input', () => { const d = otpField(codeIn.value); if (d !== codeIn.value) codeIn.value = d; if (codeKeep?.v.err) setCode({ t: 'edit' }); });
      codeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const k = codeKeep;
        if (!k || k.v.busy) return;
        setCode({ t: 'verify' });
        try {
          await hooks.mailCode?.(k.v.email, codeIn.value, k.pw, k.v.via);
          codeKeep = null;
          if (sheet === me) closeSheet();
        } catch (err) {
          const text = err?.message || '코드를 확인하지 못했어요';
          setCode({ t: 'fail', text });
          away(text);
          if (sheet === me) try { codeIn.focus({ preventScroll: true }); codeIn.select(); } catch { /* fine */ }
        }
      });
      codeAgain.addEventListener('click', async () => {
        if (setCode({ t: 'resend' })?.busy !== 'resend') return; // busy, or still counting down
        const email = codeKeep.v.email;
        try {
          await hooks.mailResend?.(email);
          setCode({ t: 'sent' });
          ticking();
        } catch (err) {
          const s = Number(err?.wait) || 0, text = err?.message || '메일을 보내지 못했어요';
          setCode(s ? { t: 'wait', s } : { t: 'fail', text });
          if (s) ticking();
          away(text);
        }
      });
      codeBack.addEventListener('click', () => { codeKeep = null; showCode(false); try { id.focus({ preventScroll: true }); } catch { /* fine */ } });
      host.append(...kids.filter((n) => n && n !== legal.box), ...codeNodes, legal.box);
      loginPaint = paint;
      paint();
      sync();
      if (codeKeep) showCode(true); // back to the code this sheet was showing when it closed
      // Is the confirmation on? One public read per page (net.js mailConfirm), asked as the sheet opens so the sign-up form is right.
      const asked = hooks.mailConfirm?.();
      if (asked?.then) asked.then((s) => { mailOnly = s === 'on'; if (sheet === me && !inCode) sync(); }, () => { /* unknown: the id stays allowed */ });
      return () => { if (loginPaint === paint) loginPaint = null; clearInterval(tick); tick = 0; };
    }, true);
  }
  // In-app browser, back from the system browser: the guest here was linked there and its coins and boards moved (main.js handoverBack).
  function handoverMoved() {
    const browser = (hooks.authEnv?.() || {}).android ? '크롬' : '사파리';
    openSheet('계정으로 옮겼어요', null, (host) => {
      host.append(
        h('div', { class: 'callout', style: { marginTop: 0 } }, `코인과 전광판을 방금 연결한 계정으로 옮겼어요. 그 계정은 ${browser}에서 로그인한 창에 있으니, 거기서 이어서 하세요.`),
        h('p', { class: 'note', text: '이 앱 안의 화면은 코인 0인 손님으로 남아 있어요. 여기서 코인이 0으로 보이는 것은 그 때문이에요.' }),
        h('button', { class: 'btn gold cta', type: 'button', text: '확인', onclick: () => closeSheet() }),
      );
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
  // The enter button comes when the world says the city is built (onReady); after BOOT_FALLBACK_MS it comes anyway, with
  // "도시를 불러오는 중…" kept on the card, and a player who enters before the city's collision is in waits with input
  // locked (lockUntilBuilt) instead of walking through the buildings that are about to appear.
  const BOOT_FALLBACK_MS = 12000;
  function bootReady(early = false) {
    if (!bootEl || entered || bootEnter?.dataset.ready) return;
    clearInterval(tipTimer);
    if (bootEnter) bootEnter.dataset.ready = '1';
    const loading = early && !hooks.built?.();
    if (bootBar && !loading) bootBar.style.width = '100%';
    if (bootMsg) { bootMsg.hidden = !loading; if (loading) bootMsg.textContent = '도시를 불러오는 중…'; }
    if (bootBar?.parentElement && !loading) bootBar.parentElement.hidden = true;
    if (loading) {
      const t = setInterval(() => {
        if (!hooks.built?.() && !entered) return;
        clearInterval(t);
        if (entered) return;
        if (bootBar) bootBar.style.width = '100%';
        if (bootMsg) bootMsg.hidden = true;
        if (bootBar?.parentElement) bootBar.parentElement.hidden = true;
      }, 300);
    }
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
      helpFade();
      coachStart();
      lockUntilBuilt();
    };
    go.addEventListener('click', enter);
    nick.addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });
    // A returning player on a new device signs in before entering; the sheet opens over this card (renderAccount shows it to a guest only).
    bootLogin = h('button', { class: 'linkbtn boot-login', type: 'button', text: '이미 계정이 있어요 · 로그인', hidden: !(accountView.ready && accountView.guest && !accountView.linked), onclick: () => openLogin() });
    const bootFields = known ? [go, bootLogin] : [nick, nickErr, go, bootLogin];
    if (maintOn) { maintSaved = bootFields; bootEnter.replaceChildren(maintCard(maintOn)); }
    else bootEnter.replaceChildren(...bootFields);
    bootEnter.hidden = false;
    if (!coarse && !maintOn) setTimeout(() => go.focus(), 60);
  }
  // 점검 (launch plan 상4, main.js maintShow): while a notice is on, the boot card shows it in place of 입장하기, and the button comes back by
  // itself when it ends. A player already inside is not moved: one toast per notice.
  let maintOn = null, maintSaved = null, maintTold = '';
  function maintCard(m) {
    const t = maintLines(m);
    return h('div', { class: 'bootlive maintcard', role: 'status', 'aria-live': 'polite' },
      h('b', { text: t.title }), h('div', { text: t.msg }), h('div', { text: t.end }), h('div', { class: 'note', text: '1분마다 다시 확인해요. 열리면 이 화면에서 바로 입장할 수 있어요.' }));
  }
  function maintSet(m) {
    const v = maintOf(m);
    if (entered) {
      const key = v ? v.msg + '|' + v.until : '';
      if (v && maintTold !== key) note(`점검 안내: ${v.msg} 지금 하던 것은 그대로 이어서 할 수 있어요.`, '', null, { ms: 8000 });
      maintTold = key;
      maintOn = v;
      return;
    }
    maintOn = v;
    if (!bootEnter?.dataset.ready) return; // bootReady draws whichever it is
    if (v) { if (!maintSaved) maintSaved = [...bootEnter.childNodes]; bootEnter.replaceChildren(maintCard(v)); bootEnter.hidden = false; }
    else if (maintSaved) { bootEnter.replaceChildren(...maintSaved); maintSaved = null; }
  }
  setTimeout(() => bootReady(true), BOOT_FALLBACK_MS);
  // Entered before the city (and its collision) is in: movement waits under its own owner, 'city', and that owner is
  // released as soon as the city is built, whatever else (a sheet, bake, dance) holds a lock of its own at that moment.
  function lockUntilBuilt() {
    if (!hooks.built || hooks.built()) return;
    hooks.lockInput(true, 'city');
    note('도시를 불러오는 중…');
    const t = setInterval(() => {
      if (!hooks.built()) return;
      clearInterval(t);
      hooks.lockInput(false, 'city');
    }, 250);
  }
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
  // ---- proof bar: after a claim or a plot purchase. One way in (showProof), one way out (leaveProof).
  // This moment's "계정 연결 +300" and "알림 받기" are buttons here (overlay.js proofOffers); their sheets do not open for it.
  const proofText = h('p');
  const proofCopy = h('div', { class: 'manual-copy', hidden: true });
  const recText = h('b', { class: 'tnum' });
  const recRow = h('div', { class: 'rec-row', hidden: true }, recText, h('button', { class: 'btn ghost', type: 'button', text: '취소', onclick: () => clipStop?.() }));
  const proofClip = h('button', { class: 'btn ghost', type: 'button', text: '5초 영상 저장', onclick: () => recordClip() });
  const proofLink = h('button', { class: 'btn ghost', type: 'button', text: '계정 연결 +300', hidden: true, onclick: () => { leaveProof({ quiet: true }); openLogin(); } });
  const proofPush = h('button', { class: 'btn ghost', type: 'button', hidden: true, onclick: () => proofPushOn() }, ...withIcon('bell', '빼앗기면 알림 받기'));
  const proof = h('div', { class: 'glass proof', hidden: true },
    proofText,
    proofCopy,
    recRow,
    h('button', { class: 'btn gold', type: 'button', onclick: () => copyInvite(proof.dataset.slot || 'MAIN_TOP', proof.dataset.gift || '', proofCopy) }, ...withIcon('link', '초대 문구 복사하기')),
    h('button', { class: 'btn ghost', type: 'button', text: '사진 찍어 공유', onclick: () => proofShot() }),
    proofClip,
    h('button', { class: 'btn ghost', type: 'button', onclick: () => downloadPaper() }, ...withIcon('news', '신문으로 저장')),
    proofLink,
    proofPush,
    h('button', { class: 'btn ghost', type: 'button', text: '둘러보기', onclick: () => leaveProof() }),
  );
  root.append(proof);
  let proofNext = null, clipStop = null;
  // The one way out. Whatever else happens, input is unlocked, the focus camera ends (keepFocus: a photo frames the board
  // next and ends it itself) and the bar's history entry goes. quiet: something else takes over (a sheet, the photo), so
  // the follow-up that waited for the bar (the chain upsell) is dropped.
  function leaveProof({ keepFocus = false, quiet = false } = {}) {
    if (proof.hidden) return false;
    try {
      clipStop?.();
      proof.hidden = true;
      proof.classList.remove('rec');
      recRow.hidden = true;
      root.classList.remove('proofing');
      document.body.classList.remove('has-proof');
    } finally {
      hooks.lockInput?.(false, 'proof');
      if (!keepFocus) hooks.endFocus?.();
      syncBack();
    }
    const next = proofNext;
    proofNext = null;
    if (next && !quiet) next();
    else if (quiet) setTimeout(pumpQueued, 0);
    else pumpQueued();
    return true;
  }
  // "사진 찍어 공유": leave the bar, frame the board, take the photo and open the photo/share sheet for that board.
  async function proofShot() {
    const slot = proof.dataset.slot;
    leaveProof({ keepFocus: true, quiet: true });
    if (slot) hooks.frameBillboard?.(slot);
    try { await openShot({ slot }); } finally { hooks.endFocus?.(); }
    askShot();
  }
  // "5초 영상 저장": the bar shows "녹화 중 5…1" and a cancel while share.js saveClip records the view.
  const clipOk = () => { try { return typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream; } catch { return false; } };
  async function recordClip() {
    if (clipStop || proof.hidden) return;
    const slot = proof.dataset.slot;
    const ctl = new AbortController();
    let left = 5;
    const paint = () => { recText.textContent = `녹화 중 ${left}`; };
    paint();
    const tick = setInterval(() => { left = Math.max(1, left - 1); paint(); }, 1000);
    clipStop = () => ctl.abort();
    proof.classList.add('rec');
    recRow.hidden = false;
    if (slot) hooks.frameBillboard?.(slot);
    let clip = null;
    try { clip = await hooks.saveClip?.({ signal: ctl.signal }); } catch { clip = null; }
    finally {
      clearInterval(tick);
      clipStop = null;
      proof.classList.remove('rec');
      recRow.hidden = true;
    }
    if (ctl.signal.aborted) { note('녹화를 취소했어요'); return; }
    if (!clip) { note('이 브라우저에서는 영상을 저장할 수 없어요. 사진 찍어 공유를 써 주세요', 'err'); return; }
    note('5초 영상을 기기에 저장했어요', 'ok');
    askShot();
  }
  async function proofPushOn() {
    proofPush.disabled = true;
    try {
      const r = await subscribePush();
      if (r?.ok) {
        trackEvent('push_on');
        proofPush.hidden = true;
        note(msgText(r.hint) || '알림을 켰어요', 'ok');
        return;
      }
      if (r?.hint) note(msgText(r.hint));
      else note('알림 권한이 필요해요', 'err');
    } catch (err) { note(err?.message || '이 브라우저에서는 알림을 켤 수 없어요', 'err'); }
    finally { proofPush.disabled = false; }
  }
  // Push offer moments: 'share' (after a photo share), 'wish' (first wish of the day), 'claim' (only when the proof bar,
  // which carries that ask as a button, was skipped). ftue.js pushAsk decides. holdMs: not before this long from now; the
  // 60 s a queued offer may wait (PUSH_QUEUE_MS) then run from the end of the hold. frame() pumps a waiting offer every second.
  try { pushOffered = sessionStorage.getItem('kts_push_offered') === '1'; } catch { /* private mode: per page */ }
  let pushHoldUntil = 0;
  function queuePushOffer(kind = 'share', holdMs = 0) {
    if (pushOffered) return;
    pushQueued = PUSH_WHY[kind] ? kind : 'share';
    pushHoldUntil = Date.now() + Math.max(0, Number(holdMs) || 0);
    pushQueuedAt = pushHoldUntil;
    pumpQueued();
  }
  function pushSupported() {
    try { return typeof Notification !== 'undefined' && !!navigator.serviceWorker && 'PushManager' in window; } catch { return false; }
  }
  const PUSH_FAIL = '이 브라우저에서는 지금 알림을 켜지 못했어요. 잠시 뒤 다시 누르거나 크롬·사파리 최신 버전에서 해 주세요.';
  function openPushSheet(kind = '', offer = false) {
    let done = false;
    openSheet('알림', null, (host) => {
      const why = PUSH_WHY[kind] || '';
      const hint = h('p', { class: 'note', text: '전광판을 빼앗기거나 내 소원에 하트가 오면 알려 드려요.' });
      host.append(
        why ? h('p', { class: 'push-why', text: why }) : null,
        hint,
        h('button', { class: 'btn gold', type: 'button', text: '알림 받기', onclick: (ev) => busyTap(ev.currentTarget, async () => {
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
          } catch {
            // The browser's own exception text (often English, e.g. a push service error) is not for players.
            hint.textContent = PUSH_FAIL;
          }
        }) }),
        offer ? h('button', { class: 'btn ghost', type: 'button', text: '나중에', onclick: () => backSheet() }) : null,
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
      // Never on top of play (screenBusy: a sheet, a celebration or its bar, the focus camera, bake/dance, a taxi, lounge, the
      // photo countdown), never before 다녀간 사이, and not while a hold runs.
      busy: screenBusy() || !!awayWant || Date.now() < pushHoldUntil,
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
            } catch { pushInlineMsg = PUSH_FAIL; }
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
  // ---- 주간 기록 (recap.js): what this browser saw of the week, kept in kts_wk. Written only when something changed.
  const wkWrite = (next) => { if (next) store(RECAP_KEY, next); };
  function wkNoteDay(streak) { wkWrite(noteDay(recall(RECAP_KEY, null), kstDay(), streak)); }
  let wkAt = 0;
  // Every few seconds, from the 1 s tick: how many boards I hold and the hearts on my wish, as they stand.
  function wkTick(now) {
    if (!entered || now - wkAt < 5000) return;
    wkAt = now;
    const raw = recall(RECAP_KEY, null);
    if (hooks.actorId?.() && world.billboards.length) wkWrite(noteHeld(raw, myBoards().length));
    wkWrite(noteHearts(recall(RECAP_KEY, null), hooks.wishData?.()?.mine));
  }

  // ---- 홈 화면 추가 (install.js): one small card per browser, ever, from the 2nd day of visiting, after something meaningful happened in this visit.
  // Never over a sheet, a celebration or anything else screenBusy() knows; it steps aside while one is up and comes back when the screen is free.
  const a2hs = { act: { wish: false, claim: false }, enteredAt: 0, el: null, mode: '', free: 0, shownMs: 0 };
  const A2HS_SHOW_MS = 25000; // not answered in this long: it goes away on its own (the offer is spent)
  const installNow = () => installMode({ standalone: isStandalone(), event: window.__ktsInstall, ios: isIosSafari(navigator.userAgent, navigator.maxTouchPoints) });
  // True while something that came first (a queued 다녀간 사이, push offer, account prompt, last week's card) or the screen itself is in the way.
  const homeBusy = () => screenBusy() || !!awayWant || !!pushQueued || Date.now() < pushHoldUntil || linkWant || !!recapCard.rec || recapCard.state === 'fetching';
  // A touch screen too short for this card above the bottom-centre controls, or a phone on its side (install.js
  // INSTALL_CRAMPED_Q): it waits like it does for a sheet, and shows once there is room.
  const homeCramped = { ios: matchMedia(INSTALL_CRAMPED_Q.ios), prompt: matchMedia(INSTALL_CRAMPED_Q.prompt) };
  const homeNoRoom = (mode) => coarse && !!mode && homeCramped[mode === 'ios' ? 'ios' : 'prompt'].matches;
  function closeHome(how) {
    if (!a2hs.el) return;
    a2hs.el.remove();
    a2hs.el = null;
    if (how) trackEvent('install_prompt', { how });
  }
  function openHome(mode) {
    store(A2HS_KEY, Date.now()); // shown = spent, whatever the player does with it
    const done = (how) => closeHome(how);
    const body = mode === 'ios'
      ? h('div', { class: 'a2hs-steps' }, h('p', { class: 'a2hs-t', text: INSTALL_COPY.title }), h('ol', null, ...INSTALL_COPY.iosSteps.map((s) => h('li', { text: s }))))
      : h('p', { class: 'a2hs-t', text: INSTALL_COPY.title });
    const add = mode === 'ios'
      ? h('button', { class: 'btn gold', type: 'button', text: INSTALL_COPY.iosOk, onclick: () => done('ios_ok') })
      : h('button', { class: 'btn gold', type: 'button', text: INSTALL_COPY.add, onclick: async (e) => {
        e.currentTarget.disabled = true;
        const ev = window.__ktsInstall;
        window.__ktsInstall = null; // a captured event can be prompted once
        let outcome = '';
        try { await ev.prompt(); outcome = (await ev.userChoice)?.outcome || ''; } catch { outcome = ''; }
        done(outcome === 'accepted' ? 'accept' : 'dismiss');
      } });
    const el = h('div', { class: 'glass a2hs', role: 'region', 'aria-label': '홈 화면에 추가' }, body,
      h('div', { class: 'a2hs-act' }, add, mode === 'ios' ? null : h('button', { class: 'a2hs-later', type: 'button', text: INSTALL_COPY.later, onclick: () => done('later') })));
    toasts.prepend(el); // in the floating stack, under the toasts (index.html .a2hs)
    a2hs.el = el;
    a2hs.mode = mode;
    a2hs.shownMs = 0;
    trackEvent('install_prompt', { how: mode === 'ios' ? 'ios' : 'shown' });
  }
  function pumpHome(now) {
    if (!entered) return;
    if (!a2hs.enteredAt) a2hs.enteredAt = Date.now();
    const mode = a2hs.el ? a2hs.mode : installNow();
    const busy = homeBusy() || homeNoRoom(mode);
    if (a2hs.el) {
      a2hs.el.hidden = busy; // a sheet came up: the card waits behind it, it never sits on top
      if (!busy && (a2hs.shownMs += 1000) >= A2HS_SHOW_MS) closeHome('timeout');
      return;
    }
    // quiet for 3 ticks first, so it never lands on the moment a sheet or a celebration just closed
    a2hs.free = busy ? 0 : a2hs.free + 1;
    if (a2hs.free < 3) return;
    if (installDue({ mode, done: recall(A2HS_KEY, 0), visits: recall(VISITS_KEY, null), act: a2hs.act, playMs: Date.now() - a2hs.enteredAt, busy, newbie: !!newbieOn })) openHome(mode);
  }

  // ---- 주간 돌아보기 (recap.js): the first entry of a KST ISO week, for a browser that was active last week. One request (GET /rt/recap) per week, made
  // only when the card is about to open, and its answer (or its failure) is kept in kts_wk_me so a reload does not ask again.
  const RECAP_ME_KEY = 'kts_wk_me', RECAP_WAIT_MS = 10000, RECAP_DROP_MS = 10 * 60e3;
  const recapCard = { state: '', rec: null, me: null, free: 0, since: 0 };
  async function recapFetch(week) {
    const kept = recall(RECAP_ME_KEY, null);
    if (kept && kept.week === week) return kept.me || null;
    let me = null;
    try { me = await Promise.race([Promise.resolve(hooks.recap?.()), new Promise((r) => setTimeout(() => r(null), 6000))]); } catch { me = null; }
    store(RECAP_ME_KEY, { week, me: me || null });
    return me || null;
  }
  function openRecap(rec, me) {
    store(RECAP_SHOWN_KEY, weekOf());
    trackEvent('week_recap', { how: 'shown' });
    openSheet(['trophy', '지난주 돌아보기'], null, (host) => {
      const rows = recapLines(rec, me);
      const box = h('div');
      host.append(
        h('p', { class: 'note', text: me && me.rank >= 1 ? '지난주 이렇게 보냈어요' : '지난주 다녀가신 기록이에요' }),
        h('div', { class: 'recap-list' }, ...rows.map((r) => h('div', { class: 'recap-row' }, h('span', { text: r.label }), h('b', { class: 'tnum', text: r.value })))),
        h('button', { class: 'btn gold', type: 'button', text: '공유하기', onclick: (e) => busyTap(e.currentTarget, async () => {
          const how = await sendLink({ kind: 'recap', text: recapShareText(rec, me), url: SITE, native: true, into: box });
          if (how && how !== 'cancel' && how !== 'busy') trackEvent('week_recap', { how: 'share' });
        }) }),
        box,
        h('button', { class: 'btn ghost', type: 'button', text: '닫기', onclick: () => backSheet() }),
      );
    }, true, 'recap');
  }
  function pumpRecap() {
    if (!entered || recapCard.state === 'done') return;
    if (!recapCard.state) {
      if (Date.now() - a2hs.enteredAt < RECAP_WAIT_MS) return; // 다녀간 사이 and the intro go first
      // A newcomer's week is not "last week's"; whether this is one is known once the plaza list is in.
      if (newbieOn === null) return;
      const rec = recapDue({ raw: recall(RECAP_KEY, null), shown: recall(RECAP_SHOWN_KEY, ''), newbie: !!newbieOn });
      if (!rec) { recapCard.state = 'done'; return; }
      recapCard.state = 'wait'; recapCard.rec = rec; recapCard.since = Date.now();
    }
    if (recapCard.state === 'wait') {
      if (Date.now() - recapCard.since > RECAP_DROP_MS) { recapCard.state = 'done'; recapCard.rec = null; return; }
      const busy = screenBusy() || !!awayWant || !!pushQueued || Date.now() < pushHoldUntil || linkWant;
      recapCard.free = busy ? 0 : recapCard.free + 1;
      if (recapCard.free < 3) return;
      recapCard.state = 'fetching';
      recapFetch(weekOf()).then((me) => { recapCard.me = me; recapCard.state = 'ready'; });
      return;
    }
    if (recapCard.state === 'ready') {
      if (Date.now() - recapCard.since > RECAP_DROP_MS) { recapCard.state = 'done'; recapCard.rec = null; return; }
      if (screenBusy() || awayWant) return; // the player did something meanwhile: it waits (the answer is kept, no second request)
      const { rec, me } = recapCard;
      recapCard.state = 'done'; recapCard.rec = null;
      openRecap(rec, me);
    }
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
    if (screenBusy()) return false;
    const { rows, onClose } = awayWant;
    awayWant = null;
    openSheet('다녀간 사이', null, (host) => {
      const acted = new Set();
      const go = (r) => {
        acted.add(r);
        if (r.kind === 'taken') { openBillboard(r.slot); return; }
        if (r.kind === 'look') { closeSheet(); hooks.focusShot?.(r.slot); return; }
        openWish({ from: 'away' });
      };
      const lead = rows.findIndex((r) => r.kind === 'taken'); // one amber button: the first board to take back
      host.append(h('div', { class: 'away-list' }, ...rows.map((r, i) => h('div', { class: 'away-row' },
        h('p', { text: msgText(r.text) }),
        h('button', { class: i === lead ? 'btn gold' : 'btn ghost', type: 'button', text: msgText(r.label), onclick: () => go(r) }),
      ))));
      // Closed by the player (✕, back, Escape, backdrop): every row was seen. Closed by going to look at one: only the rows acted on.
      return () => { try { onClose?.(rows, { acted: [...acted], explicit: !closingAll }); } catch { /* the rows just show again next time */ } };
    }, true, 'away');
    return true;
  }
  // The screen is not free for something new: a sheet, a celebration or its proof bar, the focus camera, bake/dance, a taxi,
  // lounge/watch, the photo countdown.
  function screenBusy() {
    return !!(quietBlock || sheet || !proof.hidden || proofWait || focusOn || baking || dance || driving || loungeWatch || shotBusy);
  }
  function pumpQueued() {
    if (maybeAway()) return;
    maybeOfferPush();
    pumpTaken();
  }
  const pushPermission = () => { try { return typeof Notification !== 'undefined' ? Notification.permission : ''; } catch { return ''; } };
  // Returns true when the bar is up or waits for the celebration to end, false when only the notice went out.
  function showProof(slot, giftName = '', opts = {}) {
    if (quietBlock) { proofWait = { slot, gift: giftName || '' }; syncBack(); return true; }
    const offers = proofOffers({ ready: accountView.ready, guest: accountView.guest, linked: accountView.linked, gift: giftName, slot, pushSupported: pushSupported(), permission: pushPermission() });
    // This moment's "계정 연결" ask is the button on the bar (the notice below leads to it too): its sheet stays closed.
    if (offers.link) linkWant = false;
    // The player walked on while the celebration ran (the focus camera is gone), or opened a sheet: nothing is locked and
    // nothing is covered; a tappable notice brings the bar up when they want it (overlay.js proofPlan).
    const plan = proofPlan({ force: opts.force, waited: opts.waited, focus: focusOn, skip: opts.skip, sheet: !!sheet, offers });
    if (!plan.bar) {
      proofNext = null;
      syncBack();
      note('전광판에 등록됐어요 · 친구에게 자랑하기', 'ok', () => showProof(slot, giftName, { force: true }));
      // The bar's "알림 받기" was never on screen: that ask is queued as the push sheet, after the notice has had its time.
      // Tapping the notice brings the bar and its button, which takes the queued sheet back (one push offer per session).
      if (plan.pushLater) queuePushOffer('claim', TOAST.hit + 1000);
      return false;
    }
    if (sheet) closeSheet();
    proof.dataset.slot = slot;
    proof.dataset.gift = giftName || '';
    proofCopy.replaceChildren();
    proofCopy.hidden = true;
    proofText.textContent = giftName
      ? `등록됐습니다. ${giftName}님 선물 문구를 복사해 보내세요.`
      : '등록됐습니다. 지금 전광판 앞에서 폭죽이 터집니다.';
    proofClip.hidden = !clipOk();
    proofLink.hidden = !offers.link;
    proofPush.hidden = !offers.push;
    // Showing "알림 받기" here is this session's push offer: no push sheet follows the bar.
    if (offers.push) {
      pushQueued = false;
      pushOffered = true;
      try { sessionStorage.setItem('kts_push_offered', '1'); } catch { /* private mode */ }
    }
    root.classList.add('proofing');
    document.body.classList.add('has-proof');
    proof.hidden = false;
    hooks.lockInput?.(true, 'proof');
    syncBack();
    return true;
  }
  const SHARE_ACCOUNT = '계정을 연결하면 공유 보너스 300코인을 받을 수 있어요'; // worker.js SHARE_ACCOUNT, the 403 code 'account' answer
  function openVip() {
    trackEvent('vip_modal_open');
    promptLink('vip');
    openSheet(['crown', 'VIP 패스트트랙'], 'SPONSOR', (host) => {
      const code = h('input', { class: 'input', maxLength: 32, placeholder: '8자리 스폰서 코드', 'aria-label': '스폰서 코드' });
      // The share bonus is for accounts (POST /rt/share-bonus answers a guest 403 code 'account'). A guest sees that, a button to the account
      // sheet, and a plain share button that asks for no bonus.
      const shareGuest = accountView.ready && accountView.guest && !accountView.linked;
      const share = h('button', { class: shareGuest ? 'btn ghost' : 'btn gold', type: 'button', text: shareGuest ? '링크만 공유하기' : '링크 복사하고 +300' });
      const shareLink = shareGuest ? h('button', { class: 'btn gold', type: 'button', text: '계정 연결하고 받기', onclick: () => openLogin() }) : null;
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
        if (shareGuest) { share.disabled = false; note(SHARE_ACCOUNT, 'ok', () => openLogin()); return; } // sent, and no bonus asked for
        if (how === 'copied') note('링크를 복사했어요', 'ok');
        try {
          const r = await hooks.shareBonus?.();
          note(r?.coins != null ? `공유 보너스 +300 · 잔액 ${r.coins}` : '공유 보너스를 넣었어요', 'ok');
        } catch (e) {
          share.disabled = false;
          if (e?.code === 'account') note(SHARE_ACCOUNT, 'err', () => openLogin()); // the server sees a guest (an anonymous sign-in too): tap to link
          else note(e?.message || '오늘은 이미 받았거나, 아직 입장 전이에요', 'err');
        }
      });
      const redeem = h('button', { class: 'btn ghost', type: 'button', text: '코드 사용' });
      const me = sheet; // a late answer must not close a sheet opened after this one
      redeem.addEventListener('click', async () => {
        redeem.disabled = true;
        try {
          const r = await hooks.redeemCode?.(code.value);
          note(`+10000 코인 충전 · 잔액 ${r?.coins ?? ''}`, 'ok');
          if (sheet === me) closeSheet();
          else { code.value = ''; redeem.disabled = false; } // still open under another sheet
        } catch (e) { note(e?.message || '코드가 맞지 않아요', 'err'); redeem.disabled = false; }
      });
      // The address is asked for when the sheet opens and shown as a real link: a window.open after an await is a pop-up
      // that Safari blocks. Until it answers there is a status line; no address (or a failed request) says so in place.
      const ask = h('a', { class: 'btn ghost', target: '_blank', rel: 'noopener', hidden: true, text: '스폰서 안내 열기' });
      const askNote = h('p', { class: 'note', role: 'status', text: '안내 주소를 불러오는 중…' });
      Promise.resolve(hooks.sponsorUrl?.()).then((url) => {
        const ok = /^https:\/\//i.test(String(url || ''));
        if (ok) ask.href = url;
        ask.hidden = !ok;
        askNote.textContent = ok ? '' : '스폰서 안내 주소가 아직 없어요. 운영자에게 문의해 주세요';
        askNote.hidden = ok;
      }).catch(() => { askNote.textContent = '안내 주소를 불러오지 못했어요. 창을 닫았다 다시 열어 주세요'; });
      const vipLink = linkCallout();
      host.append(
        h('div', { class: 'hub' },
          vipLink,
          h('div', { class: 'vipcard' }, h('h4', null, ...withIcon('gift', '친구에게 링크 공유하고 +300')),
            h('p', { text: shareGuest ? `${SHARE_ACCOUNT} 하루 한 번, 오늘 내 소원이나 내 전광판 링크를 보내면 바로 들어옵니다.` : '계정 전용, 하루 한 번. 오늘 내 소원이나 내 전광판 링크를 보내면 코인이 바로 들어옵니다.' }),
            shareLink, share, shareBox),
          h('div', { class: 'vipcard' }, h('h4', null, ...withIcon('key', 'VIP 스폰서 코드')), h('p', { text: '코드가 맞으면 10,000코인이 충전됩니다. 메인 타워는 3,000부터 점령할 수 있어요.' }), code, redeem),
          h('div', { class: 'vipcard' }, h('h4', null, ...withIcon('briefcase', '스폰서 안내')), h('p', { text: '현금 결제는 없어요. 안내 페이지만 엽니다.' }), ask, askNote),
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
    // Taxi pins in the beams' "go here" cyan (timesSquare3d.js GO_HERE); the glyph says pick-up or drop-off.
    if (d.job) pin(d.job, '#48d6f0', d.job.kind === 'pickup' ? '🙋' : '🏁');
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

  // 방문 통계 보내지 않기: Google Analytics off for this browser (analytics.js; index.html then never adds the tag). The browser's Global Privacy
  // Control signal turns it off too, and then the box cannot be unticked here.
  function statsField() {
    const gpc = statsGpc();
    const box = h('input', { type: 'checkbox', checked: statsOff(), disabled: gpc, 'aria-label': '방문 통계 보내지 않기' });
    const said = h('p', { class: 'note', role: 'status', text: gpc ? '브라우저의 개인정보 보호 신호(GPC)를 따라 보내지 않아요.' : '켜 두면 이 브라우저에서는 Google 애널리틱스를 불러오지 않아요.' });
    box.addEventListener('change', () => {
      const off = setStatsOff(box.checked);
      said.textContent = off ? '이제 이 브라우저에서는 방문 통계를 보내지 않아요.' : '다음 방문부터 방문 통계를 다시 보내요.';
    });
    return h('div', { class: 'field' }, h('label', { class: 'agree' }, box, h('span', null, '방문 통계 보내지 않기')), said);
  }
  // 비밀번호 바꾸기 for a signed-in password account: the new one twice, then hooks.changePassword (net.js: auth.updateUser on this session).
  function passwordFold() {
    const open = h('button', { class: 'btn ghost', type: 'button', text: '비밀번호 바꾸기' });
    const pw = h('input', { class: 'input', type: 'password', maxLength: 72, placeholder: '새 비밀번호 (6자 이상)', autocomplete: 'new-password', 'aria-label': '새 비밀번호' });
    const pw2 = h('input', { class: 'input', type: 'password', maxLength: 72, placeholder: '새 비밀번호 한 번 더', autocomplete: 'new-password', 'aria-label': '새 비밀번호 확인' });
    const go = h('button', { class: 'btn', type: 'submit', text: '바꾸기' });
    const err = h('p', { class: 'note login-err', role: 'alert', hidden: true });
    const form = h('form', { class: 'login-form', novalidate: true, hidden: true }, pw, pw2, err, go);
    const fail = (text) => { err.textContent = text || ''; err.hidden = !text; };
    open.addEventListener('click', () => { form.hidden = !form.hidden; fail(''); if (!form.hidden) pw.focus(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (go.disabled) return;
      if (pw.value.length < 6) { fail('비밀번호는 6자 이상이어야 해요'); pw.focus(); return; }
      if (pw.value !== pw2.value) { fail('두 비밀번호가 달라요'); pw2.focus(); return; }
      go.disabled = true; fail('');
      try {
        await hooks.changePassword?.(pw.value);
        pw.value = ''; pw2.value = ''; form.hidden = true;
        note('비밀번호를 바꿨어요. 다음 로그인부터 새 비밀번호를 쓰세요', 'ok');
      } catch (x) { fail(x?.message || '비밀번호를 바꾸지 못했어요'); }
      go.disabled = false;
    });
    return h('div', null, open, form);
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
      // An id sign-up has a made-up address (…@id.wishboard.dev): only the id is shown.
      const acct = accountLabel(hooks.email?.());
      const me = sheet;
      // Account block: a guest gets the way in; a linked account gets 로그아웃 (one confirm step) and, below it, withdrawal.
      const account = h('div', { class: 'acct' });
      if (hooks.linked?.()) {
        const out = h('button', { class: 'btn ghost', type: 'button', text: '로그아웃' });
        const yes = h('button', { class: 'btn', type: 'button', text: '로그아웃' });
        const no = h('button', { class: 'btn ghost', type: 'button', text: '취소' });
        const outErr = h('p', { class: 'note login-err', role: 'alert', hidden: true });
        const ask = h('div', { class: 'acct-ask', hidden: true },
          h('p', { class: 'note', text: '로그아웃하면 이 기기는 새 손님으로 이어집니다. 코인·전광판·토지는 계정에 그대로 남고, 다시 로그인하면 돌아와요.' }),
          h('div', { class: 'acct-row' }, no, yes),
          outErr);
        out.addEventListener('click', () => { ask.hidden = false; out.hidden = true; });
        no.addEventListener('click', () => { ask.hidden = true; out.hidden = false; });
        yes.addEventListener('click', async () => {
          yes.disabled = true;
          no.disabled = true;
          outErr.hidden = true;
          try {
            await hooks.signOut?.();
            if (sheet === me) closeSheet();
          } catch (e) {
            outErr.textContent = e?.message || '로그아웃하지 못했어요';
            outErr.hidden = false;
            yes.disabled = false;
            no.disabled = false;
          }
        });
        account.append(out, ask);
        // An id (or e-mail) and password account: a new password for the signed-in session (Supabase updateUser). An id account has no mailbox,
        // so this is the only way to change it; a forgotten one cannot be reset.
        if (hooks.passwordAccount?.()) account.append(passwordFold());
        account.append(h('button', { type: 'button', class: 'linkbtn', text: '[회원 탈퇴 및 데이터 초기화]', onclick: () => openWithdraw() }));
      } else if (hooks.isGuest?.()) {
        account.append(
          h('button', { class: 'btn', type: 'button', text: '계정 연결 · 로그인 (+300)', onclick: () => openLogin() }),
          h('p', { class: 'note', text: '연결하면 창을 닫아도 코인과 전광판이 남아요. 이미 계정이 있으면 여기서 로그인하세요.' }),
        );
      }
      host.append(
        h('div', { class: 'holder', style: { marginTop: 0 } },
          h('div', { class: 'stat' }, h('small', { text: '상태' }), h('b', { text: who })),
          h('div', { class: 'stat' }, h('small', { text: '닉네임' }), h('b', { text: hooks.nick?.() || '—' })),
          h('div', { class: 'stat' }, h('small', { text: acct.kind === 'id' ? '아이디' : '이메일' }), h('b', { text: acct.text || '없음', title: acct.text || null }))),
        account.childNodes.length ? account : null,
        row('네온 글로우', '눈부시면 낮춰 주세요', 0, 100, Math.round(s.glow * 100), v => `${v}%`, v => hooks.setGlow(v / 100)),
        row('화면 밝기', '노출', 60, 130, Math.round(s.exposure * 100), v => `${v}%`, v => hooks.setExposure(v / 100)),
        h('div', { class: 'field' }, h('label', null, '그래픽 품질', h('span', { text: '반사·해상도' })), qSel, qNote),
        h('div', { class: 'field' }, h('label', null, '계정 번호', h('span', { text: '코인 지급은 이 번호로만' })), h('div', { class: 'bid' }, accountBox, copyBtn)),
        h('button', { class: 'btn gold', type: 'button', text: '알림', onclick: () => openPushSheet() }),
        h('button', { class: 'btn ghost', type: 'button', text: '받은 소식', onclick: () => openInboxSheet() }),
        h('button', { class: 'btn ghost', type: 'button', text: '이번 주 코드', onclick: () => openCodeSheet() }),
        h('button', { class: 'btn ghost', type: 'button', text: '문의하기', onclick: () => openSupport() }),
        statsField(),
        h('p', { class: 'note' }, '지도 © ', h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener', text: 'OpenStreetMap' }), ' · ', h('button', { type: 'button', class: 'linkbtn', text: '사진·캐릭터 라이선스', onclick: () => openCredits() })),
        policyLinks(),
        operatorFooter(),
      );
    }, true);
  }
  // One line under the policy links when the Worker has OPERATOR_INFO (legal.js setOperator), nothing otherwise.
  function operatorFooter() {
    const text = operatorLine(operatorInfo());
    return text ? h('p', { class: 'note operator-line', text }) : null;
  }
  // 문의하기 (launch plan 상2): 분류, 내용 10–1000자, 답장 받을 이메일(선택, 적으면 안내에 동의). The account id (from the token, in the
  // Worker), nickname, build, page and device class go along (main.js hooks.support). 광고·제휴 shows the ad page link. The check is
  // opsrules.js supportFault, the same rule the Worker runs.
  function openSupport() {
    openSheet('문의하기', null, (host) => {
      const me = sheet;
      let kind = '';
      const err = h('p', { class: 'note login-err', role: 'alert', hidden: true });
      const kinds = h('div', { class: 'chips', role: 'group', 'aria-label': '분류' });
      const adsLine = h('p', { class: 'note', hidden: true }, '광고 신청은 ', h('a', { href: '/ads', target: '_blank', rel: 'noopener', text: '광고 안내 페이지', style: { color: 'var(--info)', fontWeight: '700' } }), '에서 할 수 있어요. 제휴 문의는 여기에 적어 주세요.');
      for (const [id, label] of SUPPORT_KINDS) {
        const b = h('button', { type: 'button', text: label, 'aria-pressed': 'false', onclick: () => {
          kind = id;
          for (const c of kinds.children) { const on = c === b; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); }
          adsLine.hidden = id !== 'ads';
          err.hidden = true;
        } });
        kinds.append(b);
      }
      const text = h('textarea', { class: 'input support-text', rows: 6, maxLength: SUP.max + 200, placeholder: '무슨 일이 있었는지 적어 주세요. (10자 이상)', 'aria-label': '문의 내용', style: { height: 'auto', minHeight: '132px', padding: '10px 14px', lineHeight: '1.5', resize: 'vertical' } });
      const count = h('span', { class: 'tnum', text: `0 / ${SUP.max}` });
      text.addEventListener('input', () => { count.textContent = `${textLen(text.value.trim())} / ${SUP.max}`; });
      const email = h('input', { class: 'input', type: 'email', maxLength: SUP.email, placeholder: '답장 받을 이메일 (선택)', autocomplete: 'email', 'aria-label': '답장 받을 이메일' });
      const agree = h('input', { type: 'checkbox', 'aria-label': SUPPORT_CONSENT });
      const agreeRow = h('label', { class: 'agree', hidden: true, style: { marginTop: '8px' } }, agree, h('span', { text: SUPPORT_CONSENT }));
      email.addEventListener('input', () => { agreeRow.hidden = !email.value.trim(); });
      const go = h('button', { class: 'btn gold cta', type: 'button', text: '보내기' });
      const fail = (t) => { err.textContent = t; err.hidden = false; };
      go.addEventListener('click', async () => {
        const payload = { kind, text: text.value, email: email.value.trim(), agree: agree.checked };
        const fault = supportFault(payload);
        if (fault) { fail(SUPPORT_TEXT[fault]); return; }
        go.disabled = true;
        err.hidden = true;
        try {
          await hooks.support?.(payload);
          if (sheet === me) closeSheet();
          note(payload.email ? '문의를 보냈어요. 답장은 적은 이메일로 드려요.' : '문의를 보냈어요. 고맙습니다.', 'ok');
        } catch (e) {
          fail(e?.message || SUPPORT_TEXT.down);
          go.disabled = false;
        }
      });
      host.append(
        h('p', { class: 'note', style: { marginTop: 0 }, text: '버그, 계정·코인, 신고, 광고·제휴 무엇이든 적어 주세요. 계정 번호와 기기 종류가 함께 가서 확인이 빨라요.' }),
        h('div', { class: 'field' }, h('label', null, '분류'), kinds, adsLine),
        h('div', { class: 'field' }, h('label', null, '내용', count), text),
        h('div', { class: 'field' }, h('label', null, '답장 받을 이메일', h('span', { text: '선택' })), email, h('div', null, agreeRow)), // wrapped: .field > label is the field's title row
        err,
        go,
      );
    }, true);
  }
  // 회원 탈퇴: its own step. It lists what goes (worker.js /rt/auth/withdraw, forgetActor and schema.sql withdraw_account), 취소 is the
  // big button and goes back to settings, and 탈퇴하기 works only after the word 탈퇴 was typed.
  // The login itself is deleted only when the database has forget_login (hooks.forgetLogin, asked as the sheet opens). Until that is
  // known, and whenever it is not there, the login is not in the list: a note says the operator removes it.
  const WITHDRAW_WORD = '탈퇴';
  function openWithdraw() {
    openSheet('회원 탈퇴', null, (host) => {
      const me = sheet;
      const word = h('input', { class: 'input', maxLength: 8, placeholder: WITHDRAW_WORD, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': `확인하려면 ${WITHDRAW_WORD} 라고 입력` });
      const go = h('button', { class: 'btn ghost gone-go', type: 'button', text: '탈퇴하기', disabled: true });
      const cancel = h('button', { class: 'btn gold cta', type: 'button', text: '취소', onclick: () => openSettings() });
      const err = h('p', { class: 'note login-err', role: 'alert', hidden: true });
      const typed = () => word.value.trim() === WITHDRAW_WORD;
      const loginItem = h('li', { text: '계정 자체 (로그인 정보)' });
      const loginNote = h('p', { class: 'note', text: '로그인 정보(이메일·소셜 로그인 식별자)는 자동으로 지워지지 않아요. 탈퇴 뒤 운영자가 지웁니다.' });
      const showLogin = (deleted) => { loginItem.hidden = !deleted; loginNote.hidden = !!deleted; };
      showLogin(hooks.forgetKnown?.() === true);
      Promise.resolve().then(() => hooks.forgetLogin?.()).then((yes) => { if (sheet === me) showLogin(yes === true); }).catch(() => {});
      word.addEventListener('input', () => { go.disabled = !typed(); });
      go.addEventListener('click', async () => {
        if (!typed()) return;
        go.disabled = true;
        cancel.disabled = true;
        err.hidden = true;
        try {
          await hooks.withdraw?.();
          if (sheet === me) closeSheet();
        } catch (e) {
          err.textContent = e?.message || '탈퇴를 처리하지 못했어요';
          err.hidden = false;
          go.disabled = !typed();
          cancel.disabled = false;
        }
      });
      host.append(
        h('div', { class: 'callout', style: { marginTop: 0 } }, h('b', { class: 'gone-warn', text: '탈퇴하면 아래가 모두 지워지고, 되돌릴 수 없어요.' })),
        h('ul', { class: 'gone-list' },
          loginItem,
          h('li', { text: '지갑 연결과 코인, VIP 티켓' }),
          h('li', { text: '내 전광판과 토지 (건물은 빈 땅으로 돌아가요), 올린 사진' }),
          h('li', { text: '내 소원, 내가 준 하트와 신고' }),
          h('li', { text: '알림 구독' }),
          h('li', { text: '주간 리그 기록, 전광판 리포트, 초대 코드' }),
        ),
        loginNote,
        h('p', { class: 'note', text: '다른 사람의 데이터는 지우지 않아요. 이 기기는 새 손님으로 이어집니다.' }),
        cancel,
        h('div', { class: 'field' }, h('label', null, `정말 탈퇴하려면 아래 칸에 ${WITHDRAW_WORD} 라고 입력하세요`), word),
        go,
        err,
      );
    }, true);
  }

  // ---------------------------------------------------------------- HUD readouts
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  let slowOn = false, slowAnim = null;
  function slowPulse(on) {
    if (slowOn === on) return;
    slowOn = on;
    slowAnim?.cancel();
    slowAnim = null;
    jobTitle.style.color = on ? 'var(--danger)' : '';
    if (on) slowAnim = jobTitle.animate?.([{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], { duration: 600, iterations: Infinity }) || null;
  }
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
        // The beams are cyan ("go here") for both: named by role, and the arrow keeps the beam's colour.
        // Within 20 m and above 40 km/h the line turns into a pulsing "slow down"; at the drop-off before the fare gap
        // has run, it counts the passenger's wait down.
        const fast = hd.job.dist < 20 && hd.speed > 40;
        const wait = Math.ceil(hd.job.wait || 0);
        const title = wait > 0 ? `도착! 손님이 ${wait}초 뒤에 내려요`
          : fast ? '속도를 줄이세요!'
            : hd.job.phase === 'pickup' ? '손님 기둥에서 속도를 줄이세요' : '도착 기둥에서 속도를 줄이세요';
        if (jobTitle.textContent !== title) jobTitle.textContent = title;
        slowPulse(fast && !wait);
        jobDist.textContent = hd.job.dist >= 1000 ? `${(hd.job.dist / 1000).toFixed(1)}km` : `${Math.round(hd.job.dist)}m`;
        jobArrow.style.transform = `rotate(${(-hd.job.bearing * 180) / Math.PI - 90}deg)`;
        jobArrow.style.color = 'var(--info, #48d6f0)';
        jobTime.textContent = hd.job.left != null ? fmtTime(hd.job.left) : '';
        jobTime.classList.toggle('low', hd.job.left != null && hd.job.left < 10);
      } else {
        rideLine = '';
        jobEl.classList.remove('talk');
        slowPulse(false);
        const next = Math.ceil(hd.offerIn || 0);
        jobTitle.textContent = next > 3 ? `다음 손님까지 ${next}초` : hd.hive ? `옆 택시에 붙으면 ${Math.round(PAY.hive.gapMs / 1000)}초마다 +${PAY.hive.base}` : '손님 찾는 중…';
        jobDist.textContent = '-';
        jobTime.textContent = '';
        jobArrow.style.transform = 'rotate(-90deg)';
      }
      const label = hd.exiting ? '멈추는 중…' : hd.exitArmed ? '한 번 더 누르기' : '택시 내리기';
      if (exitLabel && exitLabel !== label) { exitLabel = label; actBtn.textContent = label; }
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
    const chip = feverChip(fever);
    if (feverShort.textContent !== chip.text) feverShort.textContent = chip.text;
    if (feverEl.classList.contains('idle') === chip.show) feverEl.classList.toggle('idle', !chip.show);
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
  let last = performance.now(), mapAt = 0, hudAt = 0, rankAt = 0, homeAt = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (baking) stepBake(now, dt);
    if (bakeChip) placeBakeChip();
    if (dance) drawDance();
    const left = cooldownLeft();
    promptCool.hidden = !(left > 0 && near);
    if (left > 0) coolSvg.fg.setAttribute('stroke-dashoffset', String(69.1 * (left / COOLDOWN)));
    if (now - mapAt > 125 && !document.hidden) { mapAt = now; drawMini(hooks.minimap?.()); }
    if (now - hudAt > 66 && !document.hidden) { hudAt = now; renderHud(hooks.hud?.()); }
    if (now - rankAt > 1000 && !document.hidden) { rankAt = now; paintLive(); renderGoal(); maybeStarterToast(); payDue(); pumpLink(now); pumpTaken(now); if (pushQueued) maybeOfferPush(); }
    if (now - homeAt > 1000 && !document.hidden) { homeAt = now; wkTick(now); pumpRecap(); pumpHome(now); } // the week record, last week's card, the home-screen card
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
      if (!proof.hidden) { leaveProof(); e.preventDefault(); e.stopPropagation(); return; }
      const open = dance || baking || !reactPanel.hidden || !!sheet;
      if (dance) endDance(true);
      else if (!reactPanel.hidden) toggleReacts(false);
      else if (baking) stopBake(true);
      else if (sheet) backSheet();
      if (open) { e.preventDefault(); e.stopPropagation(); }
      else if (fsOn()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) exit.call(document);
      }
      return;
    }
    if (typing) return;
    if (baking && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE')) { e.preventDefault(); stopBake(); return; }
    if (e.code === 'KeyM' && !e.repeat) { if (sheet?.el.querySelector('.map')) backSheet(); else if (!sheet && !baking) openMap(); }
    if (e.code === 'Digit5' && !e.repeat && !sheet && !baking && !driving) toggleReacts();
  }, true);
  bakeEl.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; stopBake(); });

  const loungeEl = h('div', { class: 'stay-lounge', hidden: true });
  const ticketText = h('span', { class: 't' });
  const ticketEl = h('button', { class: 'stay-ticket', type: 'button' }, ticketText);
  const questEl = h('div', { class: 'stay-quest' });
  const balloonEl = h('button', { class: 'stay-balloon', type: 'button', hidden: true, onclick: () => hooks.throwPouch?.() });
  const loungeBtn = h('button', { class: 'stay-lounge-btn', type: 'button', title: '전광판 관람. 8초마다 다른 전광판, 20초마다 +2. 움직이면 끝', onclick: () => hooks.toggleLounge?.() },
    h('span', { class: 'e' }, icon('coffee')), h('span', { class: 'l', text: '멍때리기' }));
  const focusBtn = h('button', { class: 'stay-focus', type: 'button', hidden: true, onclick: () => hooks.endFocus?.() }, '시점 해제');
  dock.prepend(loungeBtn);
  root.querySelector('.hud-l')?.append(questEl);
  root.querySelector('.hud-r')?.append(balloonEl);
  root.append(ticketEl, loungeEl, focusBtn);
  // A title tooltip never shows on a touch screen. Where the tap already means something, a long press says the same
  // text as a notice (and that press does not also count as the tap).
  function holdTip(el, text) {
    if (!coarse) return;
    let timer = 0, fired = false;
    const stop = () => { clearTimeout(timer); timer = 0; };
    el.addEventListener('pointerdown', () => {
      fired = false;
      stop();
      timer = setTimeout(() => { fired = true; note(typeof text === 'function' ? text() : text); }, 550);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, stop);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('click', (e) => {
      if (!fired || !el.contains(e.target)) return;
      fired = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }
  holdTip(feverEl, () => feverEl.title);
  holdTip(loungeBtn, () => loungeBtn.title);
  holdTip(balloonEl, () => balloonEl.title);
  // The pouch balloon shows only a number on a phone: its first tap of the session also says what it is.
  let balloonTold = false;
  balloonEl.addEventListener('click', () => { if (coarse && !balloonTold && balloonEl.title) { balloonTold = true; note(balloonEl.title); } });
  let loungeN = 0;
  let loungeWatch = false;
  const portraitMq = matchMedia('(orientation: portrait)');
  function syncWatchPortrait() { hooks.watchPortrait?.(loungeWatch && portraitMq.matches); }
  portraitMq.addEventListener?.('change', syncWatchPortrait);
  function paintLounge(on, n) {
    loungeEl.hidden = !on;
    // The boards are the view now: the stylesheet moves the left column, the map and the news bar out of the way.
    root.classList.toggle('lounging', !!on);
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
    // In parts: the stylesheet drops .tail, then .odds, then .hk as the line gets narrower (index.html .stay-ticket), so
    // the time is never the part that is cut.
    const time = `추첨까지 ${mm}:${ss}`;
    const tail = inDraw ? ` · 이번 5분 응모함${mine ? ' · ' + mine : ''}` : ' · 택시 하차가 이번 5분의 1장';
    const key = `${time}|${tail}`;
    if (ticketText.dataset.it === key) return;
    ticketText.dataset.it = key;
    ticketText.replaceChildren(icon('ticket'), ' ', h('span', { class: 'hk', text: '다음 ' }), time, h('span', { class: 'tail', text: tail }), h('span', { class: 'odds', text: ' · 1/15, 맞으면 25코인' }));
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
      row('stunt', 2, '길 위 황금 링 통과 2회 +40'),
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
  // The packet icon, then the text in its own span: on touch the button is a circle with the icon and the span is the
  // count badge on its edge (index.html .stay-balloon .bn), so a phone gets the bare count, at most 999+.
  function balloonText(text) {
    const key = `packet|${text}`;
    if (balloonEl.dataset.it === key) return;
    balloonEl.dataset.it = key;
    balloonEl.replaceChildren(icon('packet'), h('span', { class: 'bn', text }));
  }
  function paintBalloon() {
    balloonEl.hidden = false;
    balloonEl.disabled = !(balloonHp > 0);
    if (balloonHp > 0) {
      const left = Math.ceil(balloonHp / 10);
      balloonText(coarse ? (left > 999 ? '999+' : `${left}`) : `${left}번 남음 · 터지면 코인`);
      balloonEl.title = `맞출 때마다 줄어요. 0이 되면 터지고 ${PAY.pouch.base}코인이 나와요`;
      balloonEl.setAttribute('aria-label', balloonEl.title);
    }
    else if (!balloonWaitAt) balloonText('준비');
    else {
      const left = Math.max(0, Math.ceil((balloonWaitAt + (balloonWait || 25000) - Date.now()) / 1000));
      balloonText(`${left}초`);
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
  placeGoal();
  try { if (sessionStorage.getItem('kts_viewonly') === '1') setViewOnly(true); } catch { /* private mode */ }
  renderWallet();
  renderProfile();
  renderStatus();

  return {
    sfx, note, pop, flyCoins, cooldownLeft, armCooldown, showResult,
    startBake, stopBake, bakeWait, startDance, endDance, openBillboard, openAd, openPlot, openHub, openCredits, openMap, openSettings, openWalletInfo, openVip, toggleReacts, showProof,
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
    // A board of mine was taken (socket TAKE): queued as a tappable notice, see queueTaken.
    taken(ev) { queueTaken(ev); },
    closeSheets: () => closeSheet(),
    // A board of mine was just claimed (main.js): the week's record and the home-screen card's "something meaningful".
    noteClaim() { a2hs.act.claim = true; wkWrite(recapClaim(recall(RECAP_KEY, null))); },
    showDraw(win, hit, pay, lot) {
      const mine = Math.floor(Number(lot));
      const who = mine >= 1 && mine <= 15 ? `내 번호 ${mine} · ` : '';
      if (newbieOn && tutorialOn && !(hit && pay > 0)) return;
      const line = hit && pay > 0 ? `${who}${win}번, 맞았어요! +${pay} 코인` : `${who}이번 추첨 번호 ${win}`;
      const el = h('div', { class: 'stay-draw' }, ...withIcon('ticket', line));
      // In the floating stack, above the bottom-centre controls and clear of the side columns (index.html .stay-draw). As a
      // banner 42% down the screen it lay on the left column of a desktop window under 1188px, and on a phone on the pouch.
      toasts.append(el);
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
      if (driving) { toggleReacts(false); coachDone(); }
      if (driving) { closeSheet(); note('운전 시작! 손님 기둥에서 손님을 태우고, 도착 기둥에서 속도를 줄이면 내려요', 'ok'); }
      if (boostBtn) boostBtn.hidden = !driving;
      paintJump();
      renderPrompt();
      if (!driving && awayWant) setTimeout(pumpQueued, 1500);
    },
    job(ev) {
      // The long offer line twice a session; after that the HUD line says it.
      if (ev.type === 'offer') {
        rideLine = '';
        jobTitle.textContent = '손님에게 가세요';
        if (offerTold < 2) { offerTold++; note('진행 방향 도로 위에 손님 기둥이 있어요. 가까이 가서 시속 40 아래로 줄이세요'); }
      }
      else if (ev.type === 'board') {
        rideLine = PASSENGER_LINES[(Math.random() * PASSENGER_LINES.length) | 0];
        sfx.pickup();
        jobTitle.textContent = ev.title || '도착 기둥에서 속도를 줄이세요';
        jobEl.classList.add('talk');
        note(ev.title || '도착 기둥까지 가서 시속 40 아래로 줄이면 손님이 내려요', 'ok');
      }
      else if (ev.type === 'abandon') { rideLine = ''; jobEl.classList.remove('talk'); hideSponsor(); note('손님이 내렸어요 · 운임 없음', 'err'); }
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
    // Another actor plays in this window now (sign-out, withdrawal, another window's sign-out): what was the old one's goes.
    // The 소속 chip showed its #tag; kts_taken and the waiting "…가져갔어요" notices are the boards taken from it.
    forgetActor() {
      tribeBtn.textContent = '소속';
      store('kts_taken', []);
      takenWant.length = 0;
      takenSeen.clear();
      inboxBtn.hidden = true; // 받은 소식 and its 🔔 were the old actor's (main.js forgetActor drops the rows)
      if (sheet?.inbox) closeSheet();
    },
    promptLink,
    openLogin,
    setLogin,
    closeLogin,
    loginOpen: () => !!sheet?.login,
    handoverMoved,
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
    farBoard: showFarCard,
    adCard: showAdCard,
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
      maint: maintSet,
      entered: () => entered,
    },
    setOperator,
    setWish,
    setSeason,
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
    // { force: true }: post the subscription again even if this session already did (the actor changed: main.js becomeGuest).
    resendPush: (opts) => resendPush(opts),
    openClaimStep,
    setNextLine,
    photoNews,
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
        pushNews('BILLBOARD TAKEOVER', [h('em', { text: who }), `님이 ${josa(where, '을', '를')} 점령했습니다! `, data?.line1 ? `“${chars(data.line1, 16)}”` : ''], true, id);
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
