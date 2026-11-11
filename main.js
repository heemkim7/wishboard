// Times Square K-점령전 — app wiring: realtime net (DO), 3D world, UI, wallet, world state, star shower.
import { Net, CDN } from './net.js';
import { createTimesSquare, AVATAR_COLORS } from './timesSquare3d.js';
import { speciesId } from './ts3d/avatars.js';
import { starSpot, insideLoop } from './ts3d/layout.js';
import { createUI } from './ui.js';
import { BALANCE } from './balance.js';

const NICK_KEY = 'kts_nick';
const COLOR_KEY = 'kts_color';
const SPECIES_KEY = 'kts_species';
const GFX_KEY = 'kts_gfx';
const POS_KEY = 'kts_pos';
const STAR_BONUS = BALANCE.starCoin;
const STAR_LIFE = 60000;
const NICKS = ['뉴욕붕어빵', '네온후드', '브로드웨이곰', '타임스퀘어냥', '옐로캡러버', '빨간계단요정', '전광판헌터', '맨해튼호떡'];
const FOCUS = (() => {
  const f = new URLSearchParams(location.search).get('focus') || '';
  return /^(MAIN_S|SUB_B[1-4]|PLOT_(?:[1-9]|1\d|20))$/.test(f) ? f : '';
})();
let bootLive = false;
function paintBootLive(data) {
  const king = document.getElementById('bootKing');
  const stat = document.getElementById('bootStat');
  if (!king || !stat) return;
  if (!data) {
    if (bootLive) return;
    king.textContent = '👑 현재 메인 타워 점령 중: 곧 표시됩니다';
    stat.textContent = '🚕 지금까지 도착한 소원 손님과 빈 명당은 곧 보여요';
    return;
  }
  bootLive = true;
  const boards = Array.isArray(data.billboards) ? data.billboards : [];
  const plots = Array.isArray(data.plots) ? data.plots : [];
  const main = boards.find((b) => b.slot_id === 'MAIN_S');
  const who = main?.holder_name ? `${main.holder_name} — "${main.line1 || ''}"` : '비어 있음 — 지금 들어가면 첫 이름';
  const views = boards.reduce((a, b) => a + (Number(b.views) || 0), 0);
  const free = Math.max(0, 20 - plots.filter((p) => p.owner_id).length);
  king.textContent = `👑 현재 메인 타워 점령 중: ${who}`;
  stat.textContent = `🚕 지금까지 도착한 소원 손님: ${views}명 | 🏙️ 주인을 기다리는 명당 빌딩: ${free}곳`;
}
fetch('/rt/world', { cache: 'no-store' }).then((r) => r.json()).then(paintBootLive).catch(() => paintBootLive(null));
setTimeout(() => paintBootLive(null), 2500);

const chars = (s, n) => Array.from(String(s ?? '')).slice(0, n).join('');
const isColor = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ''));
function recall(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
function keep(key, v) { try { localStorage.setItem(key, v); } catch { /* private mode */ } }
function savedPlace() {
  try {
    const p = JSON.parse(recall(POS_KEY) || 'null');
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || !insideLoop(p.x, p.z, 2)) return null;
    return { x: p.x, z: p.z, yaw: Number.isFinite(p.yaw) ? p.yaw : 0 };
  } catch { return null; }
}
function savePlace() {
  if (!entered || !world) return;
  const me = world.minimap?.()?.me;
  if (!me || !insideLoop(me.x, me.z, 2)) return;
  keep(POS_KEY, JSON.stringify({ x: me.x, z: me.z, yaw: me.yaw || 0 }));
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const bucketKey = (ms = Date.now()) => Math.floor(ms / 600000);

const state = {
  nick: chars(recall(NICK_KEY), 16) || `${NICKS[Math.floor(Math.random() * NICKS.length)]}${Math.floor(10 + Math.random() * 90)}`,
  color: isColor(recall(COLOR_KEY)) ? recall(COLOR_KEY) : AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
  species: speciesId(recall(SPECIES_KEY)),
  confirmed: 0,
  pending: 0,
  grants: [],
  earned: 0,
  walletKnown: false,
  canSettle: null,
  billboards: [],
  plots: [],
  // ponytail: session cheers, a column if it must survive refresh
  cheers: {},
};
const gfx = (() => {
  try {
    const g = JSON.parse(recall(GFX_KEY) || '{}');
    return { glow: Number.isFinite(g.glow) ? g.glow : 0.45, exposure: Number.isFinite(g.exposure) ? g.exposure : 0.95, quality: ['auto', 'high', 'medium', 'low'].includes(g.quality) ? g.quality : 'auto' };
  } catch { return { glow: 0.45, exposure: 0.95, quality: 'auto' }; }
})();
const saveGfx = () => keep(GFX_KEY, JSON.stringify(gfx));
const headlines = [];
let world = null;
let entered = false, queuePos = 0, walletGen = 0, shower = null;

// Start the supabase-js download before the scene build ties up the main thread; net.init() reuses it.
const supaLoaded = import(CDN).then((m) => { globalThis.__SUPA_MOD = m; return true; }).catch(() => false);
const net = new Net();
window.G = { net };

const ui = createUI(document.getElementById('ui'), {
  nick: () => state.nick,
  color: () => state.color,
  species: () => state.species,
  hasSession: () => !!recall(NICK_KEY),
  actorId: () => net.id,
  mine: (amount, source = 'cart') => grant(amount, source),
  claim: (payload) => claim(payload),
  submitPhoto: (payload) => submitPhoto(payload),
  capture: () => world?.capture() || null,
  publishShot: (blob) => net.publishShot(blob),
  buy: (payload) => buy(payload),
  sell: (payload) => sellCoins(payload),
  rename(name) {
    state.nick = chars(name, 16) || state.nick;
    keep(NICK_KEY, state.nick);
    world?.setName(state.nick);
  },
  recolor(color) {
    if (!isColor(color)) return;
    state.color = color;
    keep(COLOR_KEY, color);
    world?.setColor(color);
  },
  reshape(id) {
    state.species = speciesId(id);
    keep(SPECIES_KEY, String(state.species));
    world?.setSpecies(state.species);
  },
  react: (id) => world?.playEmote(id),
  reactEmoji: (i) => world?.playReaction(i),
  walletInfo: () => ({ canSettle: state.canSettle, pendingSince: state.grants[0]?.at || 0 }),
  refreshWallet: () => refreshWallet(),
  refreshWorld: () => refreshWorld(),
  lockInput: (locked) => world?.setInputEnabled(!locked),
  joystick: (x, y) => world?.setJoystick(x, y),
  jump: () => { if (world?.isDriving()) ui.sfx.honk(); else world?.jump(); },
  boost: (on) => world?.setBoost?.(on),
  adClick: (slot, url) => adClick(slot, url),
  cheer: (slot) => cheer(slot),
  interact: () => world?.interact(),
  enter: (p) => enter(p),
  arrive() {
    if (!FOCUS) { world?.playIntro(); return; }
    const pose = world?.focusSlot(FOCUS, 2500);
    if (!pose) return;
    setTimeout(() => ui.job({ type: 'focus', slot: FOCUS, board: pose.board || {}, fare: 0 }), 2500);
  },
  focusShot: (slot) => world?.focusSlot(slot),
  endFocus: () => world?.endFocus(),
  shareBonus: async () => { const r = await net.shareBonus(); refreshWallet(); return r; },
  redeemCode: async (code) => { const r = await net.redeemCode(code); refreshWallet(); return r; },
  sponsorUrl: () => net.sponsorUrl(),
  minimap: () => world?.minimap(),
  hud: () => world?.hud(),
  setWaypoint: (p) => world?.setWaypoint(p),
  teleport: (x, z) => {
    if (!insideLoop(Number(x), Number(z), 0)) { ui.note('울타리 밖으로는 갈 수 없어요', 'err'); return; }
    world?.teleport(x, z);
  },
  mapData: () => world?.mapData(),
  onLand: (x, z) => world?.onLand(x, z) ?? true,
  danceStart: () => world?.setDancing(true),
  danceEnd: () => world?.setDancing(false),
  settings: () => ({ ...gfx }),
  setGlow(v) { gfx.glow = v; world?.setGlow(v); saveGfx(); },
  setExposure(v) { gfx.exposure = v; world?.setExposure(v); saveGfx(); },
  setQuality(q) { gfx.quality = q; saveGfx(); },
});

world = createTimesSquare(document.getElementById('view'), {
  net,
  name: state.nick,
  color: state.color,
  species: state.species,
  glow: gfx.glow,
  exposure: gfx.exposure,
  quality: gfx.quality === 'auto' ? undefined : gfx.quality,
  start: savedPlace(),
  actorId: () => net.id,
  onProgress: (p) => ui.boot.progress(p),
  onReady: () => ui.boot.ready(),
  onError: () => ui.note('뉴욕 지도 데이터를 불러오지 못했어요. 새로고침해 주세요', 'err'),
  onBillboard: (slotId) => ui.openBillboard(slotId),
  onPlot: (id) => ui.openPlot(id),
  onInteract(kind, id, info) {
    if (kind === 'cart') {
      if (info?.near === false) ui.note('붕어빵 포차 앞으로 가까이 가면 구울 수 있어요');
      else ui.startBake();
    } else if (kind === 'atm') ui.openHub();
    else if (kind === 'plot') ui.openPlot(id);
    else if (kind === 'stage') ui.startDance();
    else if (kind === 'crowd') {
      const n = info?.n || 0;
      const amount = n ? BALANCE.cheerGroup : BALANCE.cheerSolo;
      const left = ui.cooldownLeft();
      if (left > 0) ui.note(`다음 함성까지 ${(left / 1000).toFixed(0)}초`);
      else if (!grant(amount, 'me')) ui.note('광장 서버에 연결되면 코인이 기록됩니다', 'err');
      else ui.note(n ? `같이 있어서 +${amount}` : `함성 +${amount}`, 'ok');
    }
    else if (kind === 'stand') ui.note(info?.ok ? '🚕 택시를 불렀어요! 바로 앞에 정차한 택시 옆에서 E를 누르세요' : '지금은 빈 택시가 없어요. 잠시 후 다시 불러 주세요', info?.ok ? 'ok' : 'err');
    else if (kind === 'fountain') drawFortune();
  },
  onProximity: (near) => ui.setNear(near),
  onStarTouch: (i) => takeStar(i),
  onCoin: (i) => takeCoin(i),
  onHonk: () => ui.sfx.honk(),
  onHorn: () => ui.sfx.honk(),
  onBump: () => ui.sfx.bump(),
  onBoost: () => ui.sfx.boost(),
  onDrive: (on) => ui.setDriving(on),
  onWaypoint: (wp) => ui.setWaypoint(wp),
  onJob(ev) {
    ui.job(ev);
    if (ev.type !== 'done') return;
    setTimeout(() => {
      const fare = Math.floor(Number(ev.fare)) || 0;
      if (fare >= 1 && grant(fare, 'taxi')) ui.note(`택시 요금 +${fare} 코인`, 'ok');
      else ui.note('광장 서버에 연결되면 요금이 코인으로 기록됩니다', 'err');
    }, ui.cooldownLeft() + 60);
  },
});
window.G.world = world;
window.G.ui = ui;

// ---- wallet & economy ----------------------------------------------------------------
// The Room DO credits 1–15 coins per grant, at most one grant per 2 s per player. The client shows
// a grant as pending until the wallet balance actually rises by that amount.
const pendingSum = () => state.grants.reduce((a, g) => a + g.n, 0);
function grant(amount, source) {
  const n = Math.floor(Number(amount));
  if (!Number.isInteger(n) || n < 1 || n > 15) return false;
  if (ui.cooldownLeft() > 0) return false;
  if (!net.sendMine(n, state.nick)) return false;
  state.grants.push({ n, at: Date.now() });
  state.pending = pendingSum();
  state.earned = (state.earned || 0) + n;
  ui.armCooldown();
  ui.setWallet(state, { defer: true });
  ui.flyCoins(n, world.screenOf(source === 'cart' ? 'cart' : 'me'));
  if (source === 'cart') world.bake(n);
  return true;
}

function creditNow(n) {
  const amount = Math.floor(Number(n));
  if (!Number.isInteger(amount) || amount < 1) return false;
  state.grants.push({ n: amount, at: Date.now() });
  state.pending = pendingSum();
  ui.setWallet(state, { defer: true });
  world?.setRank?.(state.confirmed + state.pending);
  return true;
}

function payFare(slot) {
  if (!net.sendFare(25, state.nick, slot)) { ui.note('광장 서버에 연결되면 운임이 코인으로 기록됩니다', 'err'); return false; }
  creditNow(25);
  ui.flyCoins(25, world.screenOf('me'));
  return true;
}

function adClick(slot, url) {
  if (!/^https:\/\//.test(String(url || ''))) return;
  window.open(url, '_blank', 'noopener');
  if (!net.sendAdClick(state.nick, slot)) { ui.note('링크는 열렸고, 보너스 코인은 광장 연결 후 기록됩니다', 'err'); return; }
  creditNow(15);
  ui.flyCoins(15, world.screenOf('me'));
  ui.note('🔗 작성자 공간 +15 코인', 'ok');
}

const FORTUNES = [
  '🥠 네온이 네 소원 쪽으로 기울어 있어요.',
  '🥠 빈 명당이 너를 기다리고 있었어요.',
  '🥠 빨간 계단이 잠깐 네 편을 들어요.',
  '🥠 가장 밝은 화면이 네 이름을 연습 중이에요.',
  '🥠 보낸 마음이 전광판보다 먼저 도착해요.',
  '🥠 월요일이 한 박자 늦습니다. +15 코인',
  '🥠 로또 영수증이 주머니에서 따뜻해요. +15 코인',
  '🥠 택시가 초록불에 걸리는 날이에요. +15 코인',
];
function drawFortune() {
  const left = ui.cooldownLeft();
  if (left > 0) { ui.note(`다음 보너스까지 ${(left / 1000).toFixed(0)}초`); return; }
  if ((state.confirmed + state.pending) < 10) { ui.note('코인 10개가 있어야 포춘쿠키를 뽑을 수 있어요', 'err'); return; }
  // ponytail: fountain does not debit the wallet, a spend RPC if coins must actually drop
  world?.fountainSplash?.();
  const line = FORTUNES[(Math.random() * FORTUNES.length) | 0];
  ui.note(line, 'ok');
  if (line.includes('+15') && grant(15, 'me')) return;
  if (line.includes('+15')) ui.note('광장 서버에 연결되면 보너스 코인이 기록됩니다', 'err');
  ui.armCooldown();
}
function cheer(slot) {
  if (!slot) return;
  const left = ui.cooldownLeft();
  if (left > 0) { ui.note(`다음 보너스까지 ${(left / 1000).toFixed(0)}초`); return; }
  if (!grant(5, 'me')) { ui.note('광장 서버에 연결되면 코인이 기록됩니다', 'err'); return; }
  world?.cheerAt?.(slot);
  const n = (state.cheers[slot] || 0) + 1;
  state.cheers[slot] = n;
  world?.updateBillboardTexture(slot, { cheers: n }, false);
  ui.note('🙏 응원 +1 · 보너스 코인 +5', 'ok');
}

async function refreshWallet() {
  const gen = ++walletGen;
  try {
    const w = await net.wallet();
    if (gen !== walletGen) return;
    const coins = Number(w.coins) || 0;
    if (state.walletKnown && coins > state.confirmed) {
      let gain = coins - state.confirmed;
      while (state.grants.length && state.grants[0].n <= gain) gain -= state.grants.shift().n;
    }
    const now = Date.now();
    state.grants = state.grants.filter(g => now - g.at < BALANCE.grantKeepMs);
    state.confirmed = coins;
    state.walletKnown = true;
    state.pending = pendingSum();
    ui.setWallet(state);
    world?.setRank?.(state.confirmed);
  } catch { /* keep the last balance */ }
}

function upsert(list, key, row) {
  const i = list.findIndex(item => String(item[key]) === String(row[key]));
  if (i >= 0) list[i] = { ...list[i], ...row };
  else list.push(row);
}

function settle(res) {
  if (res?.remaining_coins != null) {
    state.confirmed = Number(res.remaining_coins) || 0;
    state.grants = [];
    state.pending = 0;
    ui.setWallet(state, { bump: true });
  } else refreshWallet();
  ui.setWorld(state);
}

async function claim(payload) {
  const res = await net.claimBillboard({ ...payload, nickname: state.nick });
  if (res?.data) {
    upsert(state.billboards, 'slot_id', res.data);
    world.updateBillboardTexture(res.data.slot_id || payload.slot_id, res.data, true);
  }
  settle(res);
  return res;
}

async function submitPhoto(payload) {
  const res = await net.submitBillboardPhoto({ ...payload, nickname: state.nick });
  if (res?.data) {
    upsert(state.billboards, 'slot_id', res.data);
    world.updateBillboardTexture(res.data.slot_id || payload.slot_id, res.data, false);
  }
  settle(res);
  return res;
}

async function buy(payload) {
  const res = await net.buyPlot({ ...payload, nickname: state.nick });
  if (res?.data) {
    upsert(state.plots, 'plot_id', res.data);
    world.applyPlot(res.data, true);
  }
  settle(res);
  return res;
}

const PLAZA_KEY = 'kts_plaza_cache';
function readPlaza() {
  try {
    const j = JSON.parse(localStorage.getItem(PLAZA_KEY) || 'null');
    if (!j || typeof j !== 'object') return null;
    return {
      billboards: Array.isArray(j.billboards) ? j.billboards : [],
      plots: Array.isArray(j.plots) ? j.plots : [],
    };
  } catch { return null; }
}
function writePlaza(remote) {
  if (!remote) return;
  try {
    localStorage.setItem(PLAZA_KEY, JSON.stringify({
      billboards: remote.billboards || [],
      plots: remote.plots || [],
    }));
  } catch { /* private mode */ }
}
function applyPlaza(remote) {
  if (!remote) return;
  state.billboards = remote.billboards || [];
  state.plots = remote.plots || [];
  ui.setWorld(state);
  world.updateWorld(remote);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function refreshWorld() {
  try {
    const remote = await net.world();
    writePlaza(remote);
    applyPlaza(remote);
  } catch { /* keep the cached plaza */ }
}

function headline(text) {
  headlines.unshift(text);
  headlines.length = Math.min(headlines.length, 4);
  world.setTicker(['WISH BOARD · 모두의 전광판', ...headlines].join('      ✦      '));
}

// ---- star shower ------------------------------------------------------------------------
function starsFor(seed) {
  const rand = mulberry32(seed || 1);
  const list = [];
  for (let i = 0; i < 10; i++) {
    const { x, z } = starSpot(rand);
    list.push({ i, x, z, delay: i * 240, drift: (rand() - 0.5) * 8 });
  }
  return list;
}

function startShower(seed, announce) {
  const key = seed >>> 0;
  if (shower?.seed === key) return;
  shower = { seed: key, started: performance.now(), taken: new Set() };
  world.startStars(starsFor(key));
  if (announce) { ui.news('STAR'); headline(`🌠 별똥별 10개 · ${Math.round(STAR_LIFE / 1000)}초 · 노란 빛기둥에 서면 +8`); }
}

function takeCoin(i) {
  if (ui.cooldownLeft() > 0) return;
  if (!grant(1, 'coin')) return;
  world.removeCoin(i);
}

async function sellCoins({ slot_id, amount }) {
  const n = Math.floor(Number(amount));
  if (!Number.isInteger(n) || n < 10) return null;
  const res = await net.sellCoins({ slot_id, amount: n, nickname: state.nick });
  if (res?.remaining_coins != null) {
    state.confirmed = Number(res.remaining_coins) || 0;
    state.grants = [];
    state.pending = 0;
    ui.setWallet(state, { bump: true });
  } else await refreshWallet();
  return res;
}

function takeStar(i) {
  if (!shower || shower.taken.has(i)) return;
  if (ui.cooldownLeft() > 0 || ui.isBusy()) return;
  if (!grant(STAR_BONUS, 'star')) { ui.note('별똥별을 주우려면 광장 서버에 연결되어 있어야 해요', 'err'); return; }
  shower.taken.add(i);
  ui.sfx.star();
  ui.note('별똥별 +8', 'ok');
  world.removeStar(i, true);
  try { net.send('take', { seed: shower.seed, i }); } catch { /* solo */ }
}

function bindTake() {
  const ch = net.ch;
  if (!ch || ch.__stars) return;
  ch.__stars = true;
  ch.on('broadcast', { event: 'take' }, (msg) => {
    const p = msg?.payload;
    if (!p || !shower || p.seed !== shower.seed || shower.taken.has(p.i)) return;
    shower.taken.add(p.i);
    world.removeStar(p.i, false);
  });
  ch.on('broadcast', { event: 'react' }, (msg) => {
    const p = msg?.payload;
    if (p && Number.isInteger(p.r)) world.showReaction(p.id, p.r);
  });
}

// ---- network events -----------------------------------------------------------------------
net.on('wallet', () => refreshWallet());
net.on('ad', (m) => {
  if (!m?.slot) return;
  const row = state.billboards.find((b) => b.slot_id === m.slot);
  if (row) { row.views = m.views; row.clicks = m.clicks; }
  else state.billboards.push({ slot_id: m.slot, views: m.views, clicks: m.clicks });
  world.updateBillboardTexture(m.slot, { views: m.views, clicks: m.clicks }, false);
  ui.setWorld(state);
  if (m.kind === 'views' && row?.holder_id && row.holder_id === net.id && m.by !== net.id) ui.note('🚕 방금 다른 유저의 택시가 내 전광판 앞에 손님을 내려줬습니다! (누적 노출 +1)', 'ok');
});
net.on('status', (s) => {
  if (queuePos) return;
  if (s === 'online') { ui.setStatus('실시간 연결됨', 'ok'); bindTake(); }
  else if (s === 'connecting') ui.setStatus('광장 연결 중', 'warn');
  else ui.setStatus('혼자 걷는 중', 'off');
});
net.on('gate', (g) => {
  if (g?.pos) { queuePos = g.pos; ui.setStatus(`입장 대기 ${g.pos}번째`, 'warn'); }
  if (g?.ok || g?.down) queuePos = 0;
  if (g?.down) ui.setStatus('오늘 광장 정원이 찼어요', 'off');
});
net.onWorldUpdate((ev) => {
  const prev = ev?.kind === 'BILLBOARD' && ev.data ? state.billboards.find(b => b.slot_id === ev.data.slot_id) : null;
  const sameClaim = !!prev && prev.holder_id === ev.data.holder_id && String(prev.expires_at) === String(ev.data.expires_at) && Number(prev.current_bid) === Number(ev.data.current_bid);
  if (ev?.kind === 'BILLBOARD' && ev.data) upsert(state.billboards, 'slot_id', ev.data);
  if (ev?.kind === 'PLOT' && ev.data) upsert(state.plots, 'plot_id', ev.data);
  ui.setWorld(state);
  if (!ev?.kind || ev.replay) return;
  if (sameClaim) {
    if (ev.data.photo_status === 'approved' && prev.photo_status !== 'approved') headline(`📷 ${chars(ev.data.holder_name || '누군가', 12)}님의 사진 광고 송출 시작!`);
    return;
  }
  ui.news(ev.kind, ev.data);
  if (ev.kind === 'BILLBOARD') headline(`👑 ${chars(ev.data?.holder_name || '누군가', 12)}님이 ${ev.data?.slot_id === 'MAIN_S' ? '메인 타워' : ev.data?.slot_id} 점령!`);
  else if (ev.kind === 'PLOT') headline(`🏗️ ${chars(ev.data?.owner_name || '누군가', 12)}님의 ${ev.data?.plot_id}번 건물 완공`);
});

// ---- lifecycle ------------------------------------------------------------------------------
async function enter({ nick, color, species }) {
  if (entered) return;
  entered = true;
  state.nick = chars(nick, 16) || state.nick;
  if (isColor(color)) state.color = color;
  if (species != null) state.species = speciesId(species);
  keep(NICK_KEY, state.nick);
  keep(COLOR_KEY, state.color);
  keep(SPECIES_KEY, String(state.species));
  world.setName(state.nick);
  world.setColor(state.color);
  world.setSpecies(state.species);
  ui.refreshProfile();
  ui.news('WELCOME', { nick: state.nick });
  setTimeout(() => { if (!shower) startShower(bucketKey(), true); }, 15000);
  const ready = await netReady;
  if (ready === false) { ui.setStatus('혼자 걷는 중', 'off'); return; }
  try {
    await net.join('square', world.netState());
    bindTake();
    if (!queuePos) ui.setStatus(net.status === 'online' ? '실시간 연결됨' : '광장 연결 중', net.status === 'online' ? 'ok' : 'warn');
  } catch { ui.setStatus('혼자 걷는 중', 'off'); }
}

ui.setStatus('광장 연결 중', 'warn');
ui.setWallet(state);
{
  const cached = readPlaza();
  if (cached && (cached.billboards.length || cached.plots.length)) applyPlaza(cached);
}
fetch('/rt/health', { cache: 'no-store' }).then(r => r.json()).then((hl) => {
  state.canSettle = !!hl?.hasFlushKey;
  ui.setWallet(state);
}).catch(() => {});
const netReady = (async () => {
  let ready = false;
  await Promise.race([supaLoaded, sleep(3000)]);
  try { ready = await net.init(); } catch { ready = false; }
  const sync = Promise.all([refreshWorld(), refreshWallet()]);
  await Promise.race([sync, sleep(3000)]);
  if (!state.billboards.length && !state.plots.length) {
    const again = readPlaza();
    if (again) applyPlaza(again);
  }
  return ready;
})();

let lastBucket = bucketKey();
setInterval(() => {
  const b = bucketKey();
  if (b !== lastBucket && entered) { lastBucket = b; startShower(b, true); }
  if (shower && performance.now() - shower.started > STAR_LIFE) { world.clearStars(); shower = null; world.setTicker('WISH BOARD · 모두의 전광판'); }
  else if (shower) {
    const left = Math.max(0, Math.ceil((STAR_LIFE - (performance.now() - shower.started)) / 1000));
    world.setTicker(`🌠 별똥별 ${10 - shower.taken.size}개 남음 · ${left}초 · 노란 빛기둥에 서면 +8`);
  }
  ui.setPeople(1 + (net.peers?.size || 0));
}, 1000);
setInterval(refreshWallet, 20000);
setInterval(savePlace, 4000);
window.addEventListener('pagehide', savePlace);
function applyFlush(res) {
  const coins = Number(res?.coins);
  if (!Number.isFinite(coins)) return;
  const rose = coins > state.confirmed;
  if (rose || Number(res.flushed) > 0) { state.grants = []; state.pending = 0; }
  state.confirmed = coins;
  state.walletKnown = true;
  state.pending = pendingSum();
  ui.setWallet(state, { bump: rose });
}
setInterval(() => {
  const g = state.grants[0];
  if (!g || Date.now() - g.at < BALANCE.flushAskMs) return;
  net.flushWallet?.().then((res) => { applyFlush(res); return refreshWallet(); }).catch(() => {});
}, 5000);
setInterval(refreshWorld, 20000);
