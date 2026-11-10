// Plaza UI: glass HUD, wallet, news wire, emote dock, prompts, bungeo-ppang timing game, K-POP rhythm game,
// taxi HUD, city map + minimap, billboard / plot / ATM / settings / credits sheets, onboarding, touch controls, SFX.
import { paintBillboard, paintNeonSign, THEMES, makeCanvas, chars, fontsReady, tierOf, boardPhoto, photoReady } from './ts3d/art.js';
import { LAYOUT, PLOT_SLOTS, TAXI_STANDS, LANDMARKS } from './ts3d/layout.js';
import { TILE, ROAD, AREA } from './ts3d/nyc.js';
import { EMOTES, REACTIONS, AVATAR_COLORS, SPECIES } from './ts3d/avatars.js';

const LEVELS = [
  { i: '🟫', t: '빈 땅' }, { i: '⛺', t: '텐트' }, { i: '🏮', t: '포차' }, { i: '🏬', t: '네온상가' }, { i: '🏙️', t: '타워' },
];
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
const COOLDOWN = 2000;

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
function minBid(board) {
  const t = tierOf(board?.slot_id);
  const floor = TIERS[t].floor;
  const exp = board?.expires_at ? new Date(board.expires_at).getTime() : 0;
  if (!board?.holder_id || !exp || exp <= Date.now()) return floor;
  return Math.max(floor, Number(board.current_bid || 0) + 50);
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
function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* private mode */ } }
function recall(key, dflt) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? dflt; } catch { return dflt; } }

export function createUI(root, hooks) {
  root.replaceChildren();
  const coarse = matchMedia('(pointer: coarse)').matches;
  let wallet = { confirmed: 0, pending: 0 };
  let people = 1, statusKind = 'warn', statusText = '연결 중';
  let near = null, world = { billboards: [], plots: [] };
  let coolUntil = 0, baking = null, sheet = null, soundOn = recall('kts_sound', true);
  let dance = null, driving = false, waypoint = null;

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
    news: () => tone([{ f: 784, type: 'sine', d: 0.12, g: 0.05 }, { f: 1175, type: 'sine', d: 0.25, g: 0.05 }], { gap: 0.09 }),
    bump: () => tone([{ f: 110, to: 46, d: 0.2, type: 'sine', g: 0.14 }]),
  };

  // ---------------------------------------------------------------- HUD
  const avatarEl = h('div', { class: 'avatar', text: '🤖' });
  const nameEl = h('span');
  const statusDot = h('i', { class: 'live-dot warn' });
  const statusEl = h('span', { text: '연결 중' });
  const profile = h('button', { class: 'glass profile', type: 'button', 'aria-label': '프로필 편집', onclick: () => openProfile() },
    avatarEl,
    h('div', { class: 'who' }, h('div', { class: 'name' }, nameEl), h('div', { class: 'status' }, statusDot, statusEl)),
    h('span', { class: 'edit', text: '편집' }),
  );
  const amtEl = h('span', { class: 'amt tnum', text: '0' });
  const coinIcon = h('div', { class: 'coin-icon', 'aria-hidden': 'true' });
  const pendingChip = h('span', { class: 'chip gold pulse', hidden: true });
  const tierChip = h('span', { class: 'chip', text: '붕어빵 코인' });
  const walletEl = h('div', { class: 'glass wallet', role: 'button', tabindex: '0', title: '지갑 · 정산 안내', onclick: () => openWalletInfo(), onkeydown: (e) => { if (e.key === 'Enter') openWalletInfo(); } }, coinIcon,
    h('div', null, h('div', null, amtEl, h('span', { class: 'unit', text: 'COIN' })), h('div', { class: 'sub' }, tierChip, pendingChip)));
  root.append(h('div', { class: 'hud-l' }, profile, walletEl));

  const peopleEl = h('span', { class: 'tnum', text: '1' });
  const soundBtn = h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': '사운드', text: soundOn ? '🔊' : '🔇', onclick: () => { soundOn = !soundOn; store('kts_sound', soundOn); soundBtn.textContent = soundOn ? '🔊' : '🔇'; if (soundOn) sfx.click(); } });
  const mapCanvas = h('canvas', { width: 368, height: 368 });
  const locText = h('span', { text: '맨해튼' });
  const locPill = h('div', { class: 'glass locpill', title: '지금 있는 거리' }, h('i', { text: '📍' }), locText);
  const mapEl = h('button', { class: 'glass minimap', type: 'button', 'aria-label': '뉴욕 지도 크게 보기 (M)', title: '클릭해서 지도 크게 보기 (M)', onclick: () => openMap() }, mapCanvas, h('div', { class: 'tag', text: 'MAP · M' }), h('div', { class: 'zoom', text: '⤢' }));
  root.append(h('div', { class: 'hud-r' },
    h('div', { class: 'bar' },
      h('div', { class: 'glass pill', title: '지금 광장에 있는 사람' }, h('i', { class: 'live-dot' }), h('span', null, '광장 ', peopleEl, '명')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => openBillboard('MAIN_S') }, '📢', h('span', { class: 'wide', text: '전광판 점령' })),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => openHub() }, '🏗️', h('span', { class: 'wide', text: '토지 분양' })),
      soundBtn,
      h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': '설정', text: '⚙️', onclick: () => openSettings() }),
      h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': '정보 및 출처', text: 'ⓘ', onclick: () => openCredits() }),
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
  root.append(reactPanel);
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
  const taxiHud = h('div', { class: 'glass taxihud', hidden: true },
    h('div', { class: 'spd' }, spdEl, h('span', { text: 'km/h' })),
    h('div', { class: 'meter' }, h('small', { text: 'NYC TAXI METER' }), fareEl),
    jobEl,
    h('div', { class: 'keys', text: coarse ? '조이스틱 ↑↓ 가속·후진 · ←→ 핸들 · 하차 버튼' : 'W/S 가속·브레이크 · A/D 핸들 · Shift 부스트 · Space 경적 · E 하차' }),
  );
  root.append(taxiHud);
  const wayArrow = h('i', { class: 'arrow', text: '➤' });
  const wayText = h('span', { class: 'tnum' });
  const wayPill = h('button', { class: 'glass waypill', type: 'button', hidden: true, title: '목적지 지우기', onclick: () => hooks.setWaypoint(null) }, '📍', wayArrow, wayText, h('small', { text: '✕' }));
  root.append(wayPill);

  const toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
  root.append(toasts);

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
    h('header', null, h('h3', { text: '💃 K-POP 댄스 챌린지' }), h('div', { class: 'acc' }, rhythmCombo, rhythmScore)),
    rhythmCanvas,
    coarse ? lanePads : h('p', { class: 'hint', text: '← ↓ ↑ → 또는 D F J K · 노트가 선에 닿을 때 눌러요 · Esc 그만두기' }),
  );
  root.append(rhythmEl);

  // touch controls
  const knob = h('div', { class: 'knob' });
  const joy = h('div', { class: 'joy', 'aria-hidden': 'true' }, knob);
  const actBtn = h('button', { class: 'act big', type: 'button', hidden: true, onclick: () => hooks.interact() });
  const jumpBtn = h('button', { class: 'glass act', type: 'button', 'aria-label': '점프', text: '⤒', onclick: () => hooks.jump() });
  if (coarse) {
    root.append(joy, h('div', { class: 'acts' }, actBtn, jumpBtn));
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
  function renderWallet(bump) {
    amtEl.textContent = money(wallet.confirmed + wallet.pending);
    renderPending();
    if (bump) { walletEl.classList.remove('bump'); void walletEl.offsetWidth; walletEl.classList.add('bump'); }
  }
  function renderProfile() {
    nameEl.textContent = hooks.nick();
    avatarEl.style.setProperty('--me', hooks.color());
    avatarEl.textContent = (SPECIES.find((s) => s.id === hooks.species()) || SPECIES[0]).glyph;
  }
  const narrow = matchMedia('(max-width: 640px)');
  function renderStatus() {
    statusEl.textContent = narrow.matches && statusKind === 'ok' ? `${statusText} · ${people}명` : statusText;
    statusDot.className = 'live-dot' + (statusKind === 'ok' ? '' : statusKind === 'off' ? ' off' : ' warn');
  }
  function note(text, kind = '') {
    if (!text) return;
    const t = h('div', { class: `glass toast ${kind}`, text });
    toasts.append(t);
    while (toasts.children.length > 3) toasts.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2800);
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
    newsSmall.textContent = item.kicker;
    newsText.replaceChildren(...item.text);
    newsEl.classList.add('show');
    if (item.sound) sfx.news();
    setTimeout(() => {
      newsEl.classList.remove('show');
      setTimeout(() => { newsBusy = false; pumpNews(); }, 600);
    }, 4400);
  }
  function cooldownLeft() { return Math.max(0, coolUntil - performance.now()); }
  function armCooldown() { coolUntil = performance.now() + COOLDOWN; }
  const PROMPTS = {
    cart: ['붕어빵 굽기', '타이밍 미니게임', '굽기!'],
    atm: ['황금 ATM 열기', '전광판 · 토지 거래', 'ATM'],
    stage: ['K-POP 댄스 챌린지', '리듬 미니게임 · 최대 +15', '댄스!'],
    taxi: ['택시 타기', '직접 운전 · 손님 태우기 알바', '탑승'],
    stand: ['택시 부르기', '택시 승강장', '호출'],
  };
  function renderPrompt() {
    const show = !!near && !baking && !sheet && !dance && !driving;
    promptEl.classList.toggle('show', show);
    actBtn.hidden = !(show || driving);
    if (driving) { actBtn.textContent = '하차'; return; }
    if (!near) return;
    const p = PROMPTS[near.kind] || [`${near.id}번 토지 보기`, levelOf(near.id).t, '토지'];
    promptText.textContent = p[0];
    promptSub.textContent = p[1];
    actBtn.textContent = p[2];
  }
  function levelOf(id) {
    const p = world.plots.find(x => Number(x.plot_id) === Number(id));
    return LEVELS[Math.max(0, Math.min(4, Number(p?.level) || 0))];
  }

  function react(id) {
    const b = dock.querySelector(`[data-id="${id}"]`);
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
    armCooldown();
    let amount = 0;
    if (p >= 0.47 && p <= 0.53) amount = 15;
    else if (p >= 0.38 && p <= 0.62) amount = 5;
    if (!amount) { sfx.miss(); showResult('MISS', '앗, 붕어빵이 타버렸어요…', true); return; }
    const ok = hooks.mine(amount, 'cart');
    if (amount === 15) { sfx.crit(); showResult('PERFECT!', '황금 붕어빵 +15 코인'); }
    else { sfx.hit(); showResult('GOOD!', '바삭한 붕어빵 +5 코인'); }
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
  function drum(ctx, t, kind) {
    const g = ctx.createGain();
    g.connect(audio.master);
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
  function synth(ctx, t, freq, dur, type, vol, cutoff) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    let node = o;
    if (cutoff) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; o.connect(f); node = f; }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g);
    g.connect(audio.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function startDance() {
    if (dance || sheet || baking || driving) return false;
    if (near?.kind !== 'stage') { note('K-POP 스테이지 위 핑크 원 안으로 올라가세요', 'err'); return false; }
    if (performance.now() < danceCool) { note('숨 고르는 중… 잠시 후 다시 도전해요'); return false; }
    const bpm = 120, beat = 60 / bpm, lead = 4, beats = 24;
    const notes = [];
    let last = -1;
    for (let b = 0; b < beats; b++) {
      let lane = (Math.random() * 4) | 0;
      if (lane === last) lane = (lane + 1 + ((Math.random() * 3) | 0)) % 4;
      last = lane;
      notes.push({ t: (lead + b) * beat, lane, hit: null });
      if (b > 3 && b % 2 === 1 && Math.random() < 0.5) notes.push({ t: (lead + b + 0.5) * beat, lane: (lane + 2) % 4, hit: null });
    }
    const delay = 0.25;
    const ctx = soundOn ? ac() : null;
    if (ctx) {
      const t0 = ctx.currentTime + delay;
      const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
      for (let b = 0; b < lead + beats + 2; b++) {
        const t = t0 + b * beat;
        if (b < lead) { synth(ctx, t, b === lead - 1 ? 1320 : 880, 0.09, 'square', 0.05); continue; }
        drum(ctx, t, 'kick');
        if (b % 2 === 1) drum(ctx, t, 'snare');
        drum(ctx, t, 'hat');
        drum(ctx, t + beat / 2, 'hat');
        const ch = chords[Math.floor((b - lead) / 4) % 4];
        synth(ctx, t, midi(ch[0] - 24), beat * 0.9, 'sawtooth', 0.11, 520);
        synth(ctx, t + beat / 2, midi(ch[b % 3] + 12), beat * 0.42, 'square', 0.03);
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
    const [label, pts] = a <= 0.06 ? ['PERFECT', 100] : a <= 0.12 ? ['GREAT', 75] : a <= 0.18 ? ['GOOD', 45] : ['MISS', 0];
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
      if (n.hit || n.lane !== lane || Math.abs(now - n.t) > 0.2) continue;
      if (!best || Math.abs(now - n.t) < Math.abs(now - best.t)) best = n;
    }
    if (best) judge(best, now - best.t);
  }
  function endDance(cancel) {
    if (!dance) return;
    const d = dance;
    dance = null;
    rhythmEl.classList.remove('show');
    hooks.lockInput(false);
    hooks.danceEnd?.();
    danceCool = performance.now() + 2500;
    renderPrompt();
    if (cancel) return;
    const acc = d.score / (d.notes.length * 100);
    const pct = Math.round(acc * 100);
    const amount = acc >= 0.9 ? 15 : acc >= 0.75 ? 10 : acc >= 0.55 ? 5 : acc >= 0.3 ? 2 : 0;
    if (!amount) { sfx.miss(); showResult('TRY AGAIN', `정확도 ${pct}% · 조금만 더 연습해요!`, true); return; }
    const ok = hooks.mine(amount, 'stage');
    sfx.crit();
    showResult(acc >= 0.9 ? 'ALL KILL!' : acc >= 0.75 ? 'GREAT!' : 'NICE!', `정확도 ${pct}% · 최대 ${d.max}콤보 · +${amount} 코인`);
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
    for (const n of d.notes) if (!n.hit && now - n.t > 0.2) judge(n, 1);
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
  function closeSheet() {
    if (!sheet) return;
    sheet.el.remove();
    sheet.cleanup?.();
    sheet = null;
    hooks.lockInput(false);
    renderPrompt();
  }
  function openSheet(title, badge, build, narrow, variant) {
    closeSheet();
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
    sfx.click();
  }
  const boardById = (id) => world.billboards.find(b => b.slot_id === id) || null;
  const plotById = (id) => world.plots.find(p => Number(p.plot_id) === Number(id)) || null;
  const myPlots = () => world.plots.filter(p => p.owner_id && p.owner_id === hooks.actorId()).map(p => PLOT_SLOTS[Number(p.plot_id) - 1]).filter(Boolean);
  /** Sidewalk spot in front of a lot (where the player stands to open it). */
  function plotFront(slot) {
    const d = 5.4 * (slot.scale || 1) + 2.4;
    return { x: slot.x + Math.sin(slot.rot) * d, z: slot.z + Math.cos(slot.rot) * d };
  }
  function goWaypoint(p, label) {
    hooks.setWaypoint(p);
    closeSheet();
    note(`📍 ${label} 길안내를 시작해요 · 하늘색 빛기둥을 따라가세요`, 'ok');
  }
  function goTeleport(p, label) {
    closeSheet();
    hooks.teleport(p.x, p.z);
    sfx.fanfare();
    note(`⚡ ${label} 도착!`, 'ok');
  }
  function placeRow(slot) {
    const p = plotFront(slot);
    const n = slot.side === 'N' ? slot.id : slot.id - 10;
    return h('div', { class: 'place' },
      h('div', { class: 'where' },
        h('b', { text: '📍 K-타운 분양 구역 · W 32nd St (코리아웨이)' }),
        h('span', { text: `${slot.side === 'N' ? '북쪽' : '남쪽'} ${n}번째 필지 · 타임스퀘어에서 남쪽으로 약 1km` })),
      h('div', { class: 'go' },
        h('button', { class: 'btn ghost', type: 'button', text: '📍 길안내', onclick: () => goWaypoint(p, `${slot.id}번 토지`) }),
        h('button', { class: 'btn ghost', type: 'button', text: '🗺️ 지도', onclick: () => { hooks.setWaypoint(p); openMap(p); } }),
        h('button', { class: 'btn gold', type: 'button', text: '⚡ 바로 가기', onclick: () => goTeleport(p, `${slot.id}번 토지`) })));
  }

  function openBillboard(slotId = 'MAIN_S') {
    let slot = slotId;
    openSheet('📢 전광판 점령', 'LIVE AUCTION', (host) => {
      const canvas = makeCanvas(1024, 576);
      const seg = h('div', { class: 'seg' });
      const chipsEl = h('div', { class: 'chips' });
      const stHolder = h('b'), stBid = h('b', { class: 'gold' }), stProt = h('b');
      const emojiIn = h('input', { class: 'input', maxLength: 4, 'aria-label': '이모지' });
      const emo = h('div', { class: 'emo' });
      const themes = h('div', { class: 'themes' });
      const inks = h('div', { class: 'swatches' });
      const inkIn = h('input', { type: 'color', 'aria-label': '글자색 직접 선택' });
      const lines = [0, 1, 2].map(i => h('input', { class: 'input', maxLength: [16, 20, 24][i], placeholder: ['메인 문구 (16자)', '둘째 줄 (20자)', '셋째 줄 (24자)'][i] }));
      const urlIn = h('input', { class: 'input', type: 'url', placeholder: 'https:// (S급 전용 링크)' });
      const urlField = h('div', { class: 'field' }, h('label', null, '외부 링크', h('span', { text: 'S급 전용' })), urlIn);
      const bidIn = h('input', { class: 'input tnum', type: 'number', min: '1', step: '10', 'aria-label': '입찰 코인' });
      const balance = h('div', { class: 'balance' });
      const go = h('button', { class: 'btn primary cta', type: 'button' });
      const state = { theme: 'cyber_navy', ink: '#ffffff', emoji: '🔥' };
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
        line1: chars(lines[0].value, 16), line2: chars(lines[1].value, 20), line3: chars(lines[2].value, 24),
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
          const b = boardById(slot), mine = holds(b);
          let photo = null;
          if (mine && pic.img && b.photo_status !== 'pending') { drawCrop(pic.prev); photo = pic.prev; }
          else if (mine && b.photo_status === 'approved') photo = photoReady(b.photo_id);
          paintBillboard(canvas, data(), { ticker: `👑 ${hooks.nick()}님의 광고가 지금 타임스퀘어에 송출됩니다`, photo, pending: mine && !pic.img && b.photo_status === 'pending' });
          canvas.parentElement?.classList.toggle('cropping', mine && !!pic.img);
        });
      };
      const fee = () => ({ S: 1000, B: 300, C: 100 })[tierOf(slot)];
      const refreshPhotoGo = () => {
        const need = fee(), have = wallet.confirmed + wallet.pending;
        photoGo.disabled = !pic.img || !agree.checked || have < need;
        photoGo.textContent = have < need ? `사진 요금 ${money(need)} 코인이 필요해요` : !agree.checked ? '아래 안내를 확인하고 체크해 주세요' : `📷 ${money(need)} 코인으로 사진 검수 신청`;
      };
      let photoKey = '';
      const renderPhoto = (force) => {
        const b = boardById(slot), mine = holds(b), st = mine ? b.photo_status || '' : '';
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
            h('p', { class: 'note', text: '미리보기를 드래그해서 위치를 맞추세요. 사진이 송출되면 메인 문구(첫 줄)만 사진 아래 자막으로 나와요.' }),
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
        const min = minBid(b);
        const bid = Math.floor(Number(bidIn.value) || 0);
        const have = wallet.confirmed + wallet.pending;
        const after = have - bid;
        balance.replaceChildren(h('span', null, '보유 ', h('b', { text: `${money(have)} 코인` })), h('span', null, '점령 후 ', h('b', { class: after < 0 ? 'neg' : '', text: `${after < 0 ? '-' : ''}${money(Math.abs(after))} 코인` })));
        const mine = b.holder_id && b.holder_id === hooks.actorId();
        const locked = protectedLeft(b) > 0 && !mine;
        go.disabled = locked || bid < min;
        go.textContent = locked ? `🔒 보호 중 · ${fmtLeft(protectedLeft(b))} 후 입찰 가능` : bid < min ? `최소 ${money(min)} 코인부터 입찰` : `💥 ${money(bid)} 코인으로 점령하기`;
      };
      const fillStats = () => {
        const b = boardById(slot);
        const vacant = !b?.holder_id || (b.expires_at && new Date(b.expires_at).getTime() < Date.now());
        stHolder.textContent = vacant ? '비어 있음' : `👑 ${b.holder_name || '익명'}`;
        stBid.textContent = vacant ? '-' : `${money(b.current_bid)} 코인`;
        const pl = protectedLeft(b);
        stProt.textContent = vacant ? '즉시 가능' : pl > 0 ? `보호 ${fmtLeft(pl)}` : '입찰 가능';
        stProt.className = pl > 0 && !vacant ? 'red' : '';
      };
      const choose = (id) => {
        slot = id;
        const b = boardById(id) || {};
        state.theme = THEMES[b.bg_theme] ? b.bg_theme : state.theme;
        state.ink = isColor(b.text_color) ? b.text_color : state.ink;
        emojiIn.value = b.emoji || state.emoji;
        for (const btn of emoGrid.children) btn.classList.toggle('on', btn.textContent === emojiIn.value);
        lines[0].value = b.holder_id === hooks.actorId() ? b.line1 || '' : lines[0].value;
        lines[1].value = b.holder_id === hooks.actorId() ? b.line2 || '' : lines[1].value;
        lines[2].value = b.holder_id === hooks.actorId() ? b.line3 || '' : lines[2].value;
        urlField.hidden = tierOf(id) !== 'S';
        bidIn.value = String(minBid(b.slot_id ? b : { slot_id: id }));
        for (const c of chipsEl.children) c.classList.toggle('on', c.dataset.slot === id);
        for (const c of themes.children) c.classList.toggle('on', c.dataset.theme === state.theme);
        for (const c of inks.querySelectorAll('.swatch')) c.classList.toggle('on', c.dataset.ink === state.ink);
        inkIn.value = state.ink;
        fillStats();
        refreshBid();
        renderPhoto(true);
        if (holds(b) && b.photo_status === 'approved') boardPhoto(b.photo_id).then(paint);
        paint();
      };
      const showTier = (t) => {
        for (const b of seg.children) b.classList.toggle('on', b.dataset.tier === t);
        chipsEl.replaceChildren();
        const ids = t === 'S' ? ['MAIN_S'] : t === 'B' ? ['SUB_B1', 'SUB_B2', 'SUB_B3', 'SUB_B4'] : t === 'W'
          ? [...[1, 2, 3, 4, 5].map(n => 'TOWER_' + n), ...(String(slot).startsWith('WALL_') ? [slot] : [])]
          : PLOT_SLOTS.map(p => 'PLOT_' + p.id);
        for (const id of ids) {
          const b = boardById(id);
          const owned = b?.holder_id && (!b.expires_at || new Date(b.expires_at).getTime() > Date.now());
          const label = t === 'S' ? '메인 타워' : t === 'B' ? id.replace('SUB_', '') : id.startsWith('TOWER_') ? '타워' + id.slice(6) : id.startsWith('WALL_') ? '광장' + id.slice(5) : id.replace('PLOT_', '') + '번';
          const c = h('button', { type: 'button', class: owned ? 'owned' : '', text: label, onclick: () => { choose(id); sfx.click(); } });
          c.dataset.slot = id;
          chipsEl.append(c);
        }
        choose(ids.includes(slot) ? slot : ids[0]);
      };
      for (const [t, label] of [['S', 'S급 메인'], ['B', 'B급 서브'], ['C', 'C급 거리'], ['W', '광장']]) {
        const b = h('button', { type: 'button', text: label, onclick: () => showTier(t) });
        b.dataset.tier = t;
        seg.append(b);
      }
      const emoTabs = h('div', { class: 'emo-tabs' });
      const emoGrid = h('div', { class: 'emo-grid' });
      const pickEmoji = (g) => {
        emojiIn.value = g;
        state.emoji = g;
        for (const b of emoGrid.children) b.classList.toggle('on', b.textContent === g);
        paint();
      };
      const showSet = (k) => {
        for (const t of emoTabs.children) t.classList.toggle('on', Number(t.dataset.k) === k);
        emoGrid.replaceChildren(...EMOJI_SETS[k][1].map(g => h('button', { type: 'button', text: g, class: g === (emojiIn.value || state.emoji) ? 'on' : '', onclick: () => pickEmoji(g) })));
      };
      EMOJI_SETS.forEach(([name], k) => {
        const t = h('button', { type: 'button', text: name, onclick: () => showSet(k) });
        t.dataset.k = String(k);
        emoTabs.append(t);
      });
      emo.append(emoTabs, emoGrid, h('div', { class: 'emo-own' }, h('span', { text: '직접 입력' }), emojiIn));
      showSet(0);
      for (const [key, th] of Object.entries(THEMES)) {
        const b = h('button', { type: 'button', class: 'theme', text: th.label, style: { background: `linear-gradient(135deg, ${th.swatch[0]}, ${th.swatch[1]} 55%, ${th.swatch[2]})` }, onclick: () => { state.theme = key; for (const c of themes.children) c.classList.toggle('on', c === b); paint(); } });
        b.dataset.theme = key;
        themes.append(b);
      }
      for (const c of INK) {
        const b = h('button', { type: 'button', class: 'swatch', 'aria-label': c, style: { background: c, color: c }, onclick: () => { state.ink = c; inkIn.value = c; for (const s of inks.querySelectorAll('.swatch')) s.classList.toggle('on', s === b); paint(); } });
        b.dataset.ink = c;
        inks.append(b);
      }
      inks.append(inkIn);
      inkIn.addEventListener('input', () => { state.ink = inkIn.value; for (const s of inks.querySelectorAll('.swatch')) s.classList.remove('on'); paint(); });
      for (const i of [emojiIn, ...lines]) i.addEventListener('input', paint);
      bidIn.addEventListener('input', refreshBid);
      const steps = h('div', { class: 'steps' },
        ...[50, 100, 500].map(n => h('button', { type: 'button', text: `+${n}`, onclick: () => { bidIn.value = String((Math.floor(Number(bidIn.value)) || 0) + n); refreshBid(); } })),
        h('button', { type: 'button', text: '최소', onclick: () => { bidIn.value = String(minBid(boardById(slot) || { slot_id: slot })); refreshBid(); } }));
      go.addEventListener('click', async () => {
        const b = boardById(slot) || { slot_id: slot };
        const bid = Math.floor(Number(bidIn.value) || 0);
        if (bid < minBid(b)) { note(`최소 ${money(minBid(b))} 코인이 필요합니다`, 'err'); return; }
        go.disabled = true;
        go.textContent = '⏳ 점령 중…';
        try {
          const d = data();
          await hooks.claim({ slot_id: slot, bid, line1: d.line1, line2: d.line2, line3: d.line3, emoji: d.emoji, bg_theme: d.bg_theme, text_color: d.text_color, external_url: tierOf(slot) === 'S' ? urlIn.value.trim() : '' });
          sfx.fanfare();
          note('🎉 전광판을 점령했습니다! 원하면 아래에서 사진 광고도 신청할 수 있어요', 'ok');
          fillStats();
          renderPhoto(true);
          paint();
          photoBox.classList.remove('flash');
          void photoBox.offsetWidth;
          photoBox.classList.add('flash');
          photoBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } catch (e) {
          note(e?.message || '점령에 실패했습니다', 'err');
        }
        refreshBid();
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
          seg, chipsEl,
          h('div', { class: 'screen' }, canvas),
          h('div', { class: 'holder' },
            h('div', { class: 'stat' }, h('small', { text: '현재 점령자' }), stHolder),
            h('div', { class: 'stat' }, h('small', { text: '현재 입찰가' }), stBid),
            h('div', { class: 'stat' }, h('small', { text: '보호 시간' }), stProt)),
          h('p', { class: 'note', text: '점령하면 보호 시간 동안은 아무도 빼앗을 수 없어요. 보호가 끝나면 +50 코인 이상 더 높은 입찰로 탈환할 수 있습니다. 타임스퀘어 건물 전광판은 그 화면을 직접 클릭해서 고르세요.' })),
        h('div', null,
          h('div', { class: 'field' }, h('label', null, '이모지'), emo),
          h('div', { class: 'field' }, h('label', null, '배경 아트워크'), themes),
          h('div', { class: 'field' }, h('label', null, '네온 글자색'), inks),
          h('div', { class: 'field' }, h('label', null, '광고 문구', h('span', { text: '욕설·광고성 링크는 제재될 수 있어요' })), h('div', { class: 'lines' }, ...lines)),
          urlField,
          h('div', { class: 'field' }, h('label', null, '입찰 코인'), h('div', { class: 'bid' }, bidIn, steps), balance),
          go, photoBox, photoFile),
      ));
      showTier(String(slotId).startsWith('WALL') || String(slotId).startsWith('TOWER') ? 'W' : tierOf(slotId));
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
      const levels = h('div', { class: 'levels' }, ...LEVELS.map((L, i) => h('div', { class: `lv${i < level ? ' done' : ''}${i === level ? ' cur' : ''}${i === target && (mine || !owned) && level < 4 ? ' next' : ''}` }, h('div', { class: 'i', text: L.i }), h('div', { class: 't', text: L.t }))));
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
          sfx.fanfare();
          note(mine ? '🏗️ 건물이 한 층 더 올라갔습니다!' : '🎉 이 땅의 주인이 되었습니다!', 'ok');
          hooks.setWaypoint(plotFront(slot));
          note('📍 내 건물은 K-타운(32번가)에 있어요 · 하늘색 빛기둥을 따라가세요', 'ok');
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
          h('div', { class: 'stat' }, h('small', { text: '건물주' }), h('b', { text: owned ? `👑 ${plot.owner_name || '익명'}${mine ? ' (나)' : ''}` : '주인 없음' })),
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
        const b = h('button', { type: 'button', class: `plot${mineIds.has(s.id) ? ' mine' : ''}`, title: p?.owner_name ? `${s.id}번 · ${p.owner_name}` : `${s.id}번 · 분양 중`, style: col ? { borderColor: col, color: col, boxShadow: `inset 0 0 18px -8px ${col}` } : null, onclick: () => openPlot(s.id) },
          String(s.id), h('span', { class: 'l', text: LEVELS[lv].i }));
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
          h('button', { type: 'button', onclick: () => openBillboard('MAIN_S') }, h('div', { class: 'big', text: '📢' }), h('h4', { text: '전광판 점령' }), h('p', { text: 'S급 메인 타워부터 거리 전광판까지. 내 문구가 광장 모두의 화면에 송출돼요.' })),
          h('button', { type: 'button', onclick: () => openPlot(PLOT_SLOTS.find(s => !plotById(s.id)?.owner_id)?.id || 1) }, h('div', { class: 'big', text: '🏗️' }), h('h4', { text: '토지 분양 · 증축' }), h('p', { text: '텐트에서 타워까지 5단계. 외벽 광고 수익의 50%는 건물주 몫!' }))),
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
        h('div', { class: 'callout' }, h('b', { text: '정산은 자동이에요' }), ' — 붕어빵·K-POP 댄스·택시·별똥별로 번 코인은 먼저 “정산 대기”에 쌓이고, 광장 서버가 약 30초마다 모아서 지갑에 입금해요. 따로 누를 버튼은 없어요.'),
        h('p', { class: 'note', text: '전광판 점령이나 토지 분양을 하면 그 순간 대기 코인부터 정산되므로, 대기 중인 코인도 바로 쓸 수 있어요. 화면 왼쪽 위 큰 숫자는 대기 코인까지 합친 금액이에요.' }),
        info.canSettle === false ? h('div', { class: 'callout warn' }, h('b', { text: '⚠️ 이 서버는 정산이 꺼져 있어요' }), ' — 로컬 테스트 서버에는 정산용 비밀키(FLUSH_KEY)가 없어서 대기 코인이 지갑으로 넘어가지 않아요. 배포된 게임 서버에서는 자동으로 정산돼요.') : null,
        refresh,
      );
      return () => clearInterval(timer);
    }, true);
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
      host.append(
        h('div', { class: 'field' }, h('label', null, '닉네임'), input),
        h('div', { class: 'field' }, h('label', null, '캐릭터', h('span', { text: '쥐 · 고양이 · 곰' })), speciesPicker(species, (id) => { species = id; })),
        h('div', { class: 'field' }, h('label', null, '이름표 색', h('span', { text: '다른 사람에게도 보여요' })), colorPicker(color, (c) => { color = c; })),
        save,
      );
      setTimeout(() => input.focus(), 50);
    }, true);
  }

  // ---------------------------------------------------------------- boot / onboarding
  const bootEl = document.getElementById('boot');
  const bootBar = document.getElementById('bootBar');
  const bootMsg = document.getElementById('bootMsg');
  const bootEnter = document.getElementById('bootEnter');
  const tips = ['뉴욕 타임스퀘어로 이동하는 중…', '붕어빵 틀을 데우는 중…', '전광판 전원을 켜는 중…', '노란 택시를 부르는 중…', '빨간 계단을 닦는 중…'];
  let tipI = 0;
  const tipTimer = setInterval(() => { if (bootMsg) bootMsg.textContent = tips[++tipI % tips.length]; }, 1600);
  let entered = false;
  function bootReady() {
    if (!bootEl || entered) return;
    clearInterval(tipTimer);
    bootBar.style.width = '100%';
    bootMsg.textContent = '준비 완료! 닉네임과 이름표 색을 정하고 입장하세요';
    let color = hooks.color();
    let species = hooks.species();
    const nick = h('input', { class: 'input', maxLength: 16, value: hooks.nick(), placeholder: '닉네임', 'aria-label': '닉네임' });
    const go = h('button', { class: 'btn primary', type: 'button', text: '🗽 타임스퀘어 입장하기' });
    const enter = () => {
      if (entered) return;
      entered = true;
      ac();
      hooks.enter({ nick: chars(nick.value, 16).trim() || hooks.nick(), color, species });
      renderProfile();
      bootEl.classList.add('gone');
      setTimeout(() => bootEl.remove(), 900);
      sfx.fanfare();
    };
    go.addEventListener('click', enter);
    nick.addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });
    bootEnter.replaceChildren(nick, speciesPicker(species, (id) => { species = id; }), colorPicker(color, (c) => { color = c; }), go);
    bootEnter.hidden = false;
    if (!coarse) setTimeout(() => go.focus(), 60);
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
    pin(d.waypoint, '#3fe6ff', '📍');
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
  const mctx = mapCanvas.getContext('2d');
  const miniBase = document.createElement('canvas');
  let miniSig = '';
  function drawMini(d) {
    if (!d?.me) return;
    const S = mapCanvas.width;
    const view = { cx: d.me.x, cz: d.me.z, scale: S / 230 };
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
    { ko: '타임스퀘어', x: LAYOUT.spawn.x, z: LAYOUT.spawn.z },
    { ko: '💃 K-POP 스테이지', x: LAYOUT.stage.spot.x, z: LAYOUT.stage.z0 - 8 },
    { ko: '🏗️ K-타운 분양', x: LAYOUT.ktown.x0 + 52, z: LAYOUT.ktown.z },
    ...['esb', 'rock', 'cpark', 'gct', 'owtc', 'flatiron', 'vessel', 'washsq', 'bklyn', 'harlem'].map(id => LANDMARKS.find(l => l.id === id)).filter(Boolean).map(l => ({ ko: l.ko, x: l.x, z: l.z })),
  ];
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
      const MIN = 0.022 * dprM, MAX = 8 * dprM;
      let drag = null, raf = 0, sig = '';
      const draw = () => {
        raf = requestAnimationFrame(draw);
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
        const before = toWorld(e);
        view.scale = Math.max(MIN, Math.min(MAX, view.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
        const after = toWorld(e);
        view.cx += before.x - after.x;
        view.cz += before.z - after.z;
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
          hooks.teleport(d.waypoint.x, d.waypoint.z);
          closeSheet();
          sfx.fanfare();
          note('⚡ 순간이동 완료!', 'ok');
        } }),
        h('button', { type: 'button', text: '✕📍', title: '목적지 지우기', onclick: () => hooks.setWaypoint(null) }));
      wrap.append(zoomBtns);
      const chips = h('div', { class: 'quick' }, ...QUICK.map(q => h('button', { type: 'button', text: q.ko, onclick: () => {
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
      host.append(
        row('네온 글로우', '눈부시면 낮춰 주세요', 0, 100, Math.round(s.glow * 100), v => `${v}%`, v => hooks.setGlow(v / 100)),
        row('화면 밝기', '노출', 60, 130, Math.round(s.exposure * 100), v => `${v}%`, v => hooks.setExposure(v / 100)),
        h('div', { class: 'field' }, h('label', null, '그래픽 품질', h('span', { text: '반사·해상도' })), qSel, qNote),
      );
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
        jobTitle.textContent = hd.job.phase === 'pickup' ? '🙋 손님에게 가세요' : '🏁 목적지로 모셔다 드리세요';
        jobDist.textContent = hd.job.dist >= 1000 ? `${(hd.job.dist / 1000).toFixed(1)}km` : `${Math.round(hd.job.dist)}m`;
        jobArrow.style.transform = `rotate(${(-hd.job.bearing * 180) / Math.PI - 90}deg)`;
        jobArrow.style.color = hd.job.phase === 'pickup' ? '#39f58a' : '#ffcf5a';
        jobTime.textContent = hd.job.left != null ? fmtTime(hd.job.left) : '';
        jobTime.classList.toggle('low', hd.job.left != null && hd.job.left < 10);
      } else {
        jobTitle.textContent = '손님 찾는 중…';
        jobDist.textContent = '-';
        jobTime.textContent = '';
        jobArrow.style.transform = 'rotate(-90deg)';
      }
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
  let last = performance.now(), mapAt = 0, hudAt = 0;
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
    promptCool.hidden = !(left > 0 && near?.kind === 'cart');
    if (left > 0) coolSvg.fg.setAttribute('stroke-dashoffset', String(69.1 * (left / COOLDOWN)));
    if (now - mapAt > 125 && !document.hidden) { mapAt = now; drawMini(hooks.minimap?.()); }
    if (now - hudAt > 66 && !document.hidden) { hudAt = now; renderHud(hooks.hud?.()); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (dance) {
      if (e.key === 'Escape') { endDance(true); return; }
      if (e.code in DANCE_KEYS) { e.preventDefault(); if (!e.repeat) danceHit(DANCE_KEYS[e.code]); }
      return;
    }
    if (e.key === 'Escape') { if (!reactPanel.hidden) toggleReacts(false); else if (baking) stopBake(true); else closeSheet(); return; }
    if (typing) return;
    if (baking && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE')) { e.preventDefault(); stopBake(); return; }
    if (e.code === 'KeyM' && !e.repeat) { if (sheet?.el.querySelector('.map')) closeSheet(); else if (!sheet && !baking) openMap(); }
    if (e.code === 'Digit5' && !e.repeat && !sheet && !baking && !driving) toggleReacts();
  }, true);
  bakeEl.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; stopBake(); });

  renderWallet();
  renderProfile();
  renderStatus();

  return {
    sfx, note, pop, flyCoins, cooldownLeft, armCooldown, showResult,
    startBake, stopBake, startDance, openBillboard, openPlot, openHub, openCredits, openMap, openSettings, openWalletInfo, toggleReacts,
    isBusy: () => !!sheet || !!baking || !!dance,
    setDriving(on) {
      driving = !!on;
      taxiHud.hidden = !driving;
      dock.hidden = driving;
      if (driving) toggleReacts(false);
      if (driving) { closeSheet(); note('🚕 운전 시작! 초록 빛기둥의 손님을 태워 목적지까지 모셔다 드리면 요금(코인)을 받아요', 'ok'); }
      renderPrompt();
    },
    job(ev) {
      if (ev.type === 'offer') note('🙋 새 손님 호출! 초록 빛기둥을 따라가세요');
      else if (ev.type === 'board') { sfx.coin(); note(`🚖 손님 탑승! ${ev.limit}초 안에 금색 깃발로 모셔다 드리세요`, 'ok'); }
      else if (ev.type === 'fail') { sfx.miss(); note('⏰ 시간 초과… 손님이 내렸어요', 'err'); }
      else if (ev.type === 'done') { sfx.fanfare(); showResult('FARE!', `손님 도착 · +${ev.fare} 코인`); }
    },
    setWaypoint(wp) { waypoint = wp || null; wayPill.hidden = !waypoint; },
    setWallet(next, { bump = false, defer = false } = {}) {
      wallet = { confirmed: Math.max(0, Number(next.confirmed) || 0), pending: Math.max(0, Number(next.pending) || 0) };
      if (!defer) renderWallet(bump);
    },
    setPeople(n) {
      const next = Math.max(1, Number(n) || 1);
      if (next === people) return;
      people = next;
      peopleEl.textContent = String(people);
      renderStatus();
    },
    setStatus(text, kind = 'warn') { statusText = text || ''; statusKind = kind; renderStatus(); },
    setNear(v) { near = v || null; renderPrompt(); },
    setWorld(next) { world = { billboards: next?.billboards || [], plots: next?.plots || [] }; renderPrompt(); },
    refreshProfile: renderProfile,
    boot: {
      progress(p) { if (bootBar && !entered) bootBar.style.width = `${Math.round(Math.max(0.06, Math.min(1, p)) * 92)}%`; },
      ready: bootReady,
    },
    news(kind, data) {
      if (kind === 'BILLBOARD') {
        const who = data?.holder_name || '누군가';
        const id = data?.slot_id || '';
        const where = id === 'MAIN_S' ? '메인 타워' : id.startsWith('SUB_') ? `서브 전광판 ${id.slice(4)}` : `${id.replace('PLOT_', '')}번 거리 전광판`;
        pushNews('BILLBOARD TAKEOVER', [h('em', { text: who }), `님이 ${where}을 점령했습니다! `, data?.line1 ? `“${chars(data.line1, 16)}”` : '']);
      } else if (kind === 'PLOT') {
        const who = data?.owner_name || '누군가';
        const lv = LEVELS[Math.max(0, Math.min(4, Number(data?.level) || 0))];
        pushNews('REAL ESTATE', [h('em', { text: who }), `님의 ${data?.plot_id}번 토지에 ${lv.i} ${lv.t}가 올라갔습니다`]);
      } else if (kind === 'STAR') pushNews('EVENT · STARFALL', ['🌠 ', h('em', { text: '별똥별 코인 샤워' }), ' 시작! 먼저 닿는 사람이 +8 코인']);
      else if (kind === 'WELCOME') pushNews('WELCOME', ['🗽 ', h('em', { text: data?.nick || '' }), '님, 타임스퀘어에 오신 걸 환영해요!'], false);
    },
  };
}
