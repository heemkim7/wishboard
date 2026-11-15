// Times Square K-점령전 — app wiring: realtime net (DO), 3D world, UI, wallet, world state, star shower.
import { Net, CDN, guestToken } from './net.js?v=20261114a';
import { createTimesSquare, AVATAR_COLORS, taxiTrainMult } from './timesSquare3d.js?v=20261115b';
import { speciesId } from './ts3d/avatars.js';
import { starSpot, insideLoop } from './ts3d/layout.js?v=20261113b';
import { createUI } from './ui.js?v=20261115b';
import { BALANCE, chainBoost, chainsOf, floorOf, monopolyOf, slotName, slotOf } from './balance.js?v=20261113y';
import { trackEvent } from './analytics.js?v=20261113z';
import { adoptHandover, chromeIntent, handoverHref, isAndroid, isInAppWebView, loginEmail, profileName, GT_LS, slotTier } from './plaza-account.js?v=20261113z';

adoptHandover(location.search, localStorage);

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
  return slotOf(f) ? f : '';
})();
const GIFT = new URLSearchParams(location.search).get('gift') === '1';
let bootLive = false;
function paintBootLive(data, here) {
  const king = document.getElementById('bootKing');
  const stat = document.getElementById('bootStat');
  if (!king || !stat) return;
  const n = Number(here?.live);
  const crowd = Number.isFinite(n) ? `지금 광장 ${n}명` : '지금 광장 인원을 확인하는 중';
  if (!data) {
    if (bootLive) return;
    king.textContent = '👑 지금 메인 타워의 소원: 곧 표시됩니다';
    stat.textContent = crowd;
    return;
  }
  bootLive = true;
  const boards = Array.isArray(data.billboards) ? data.billboards : [];
  const main = boards.find((b) => b.slot_id === 'MAIN_TOP');
  const who = main?.holder_name ? `${main.holder_name} — "${main.line1 || '소원 대기'}"` : '비어 있음 — 첫 소원을 걸 자리';
  const now = Date.now();
  const alive = (b) => {
    const exp = b.expires_at ? new Date(b.expires_at).getTime() : 0;
    return !!b.holder_id && (!exp || exp > now);
  };
  const held = boards.filter(alive).length;
  const expired = boards.filter((b) => b.holder_id && !alive(b)).length;
  const open = boards.length - held;
  king.textContent = `👑 지금 메인 타워의 소원: ${who}`;
  stat.textContent = `전광판 ${boards.length}개 · 점령 ${held} · 만료 ${expired} · 지금 걸 수 있는 자리 ${open} · ${crowd}`;
}
Promise.all([
  fetch('/rt/world', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
  fetch('/rt/here', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
]).then(([data, here]) => paintBootLive(data, here)).catch(() => paintBootLive(null, null));
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
  const me = world.getPlayer?.() || world.minimap?.()?.me;
  if (!me || !Number.isFinite(me.x) || !Number.isFinite(me.z) || !insideLoop(me.x, me.z, 2)) return;
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
  ranks: [],
  // ponytail: session cheers and ticker lines, a column if they must survive refresh
  cheers: {},
  notes: {},
  vipTickets: 0,
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
let sessionUser = null, accountReady = false;

// Start the supabase-js download before the scene build ties up the main thread; net.init() reuses it.
const supaLoaded = import(CDN).then((m) => { globalThis.__SUPA_MOD = m; return true; }).catch(() => false);
const net = new Net();
window.G = { net };
const netReady = (async () => {
  let ready = false;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try { ready = await net.init(); } catch { ready = false; }
  try { await Promise.race([Promise.all([refreshWallet(), refreshWorld()]), wait(3000)]); } catch { /* wallet shows once the guest token answers */ }
  try { await bootAccount(); } catch { /* login can finish after the plaza is up */ }
  try {
    if (!state.billboards.length && !state.plots.length) {
      const again = readPlaza();
      if (again) applyPlaza(again);
    }
  } catch { /* a bad local plaza cache must not block login */ }
  return ready;
})();

const ui = createUI(document.getElementById('ui'), {
  nick: () => state.nick,
  color: () => state.color,
  species: () => state.species,
  hasSession: () => !!recall(NICK_KEY),
  actorId: () => net.id,
  isGuest: () => accountReady && !sessionUser,
  linked: () => !!sessionUser,
  email: () => sessionUser?.email || '',
  authEnv,
  oauth: (provider) => startOAuth(provider),
  passwordAuth: (kind, id, password) => passwordSign(kind, id, password),
  withdraw: () => withdrawAccount(),
  mine: (amount, source = 'cart') => grant(amount, source),
  claim: (payload) => claim(payload),
  sticker: (slot, glyph) => buySticker(slot, glyph),
  washSticker: (slot) => washSticker(slot),
  takeover: (payload) => takeover(payload),
  stickerList: (slot) => world?.stickerList?.(slot) || [],
  revenge: () => { if (net.sendRevenge()) ui.note('복수 운임을 요청했어요', 'ok'); else ui.note('광장에 연결된 뒤에 복수 운임을 켤 수 있어요', 'err'); },
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
  cheer: (slot, msg) => cheer(slot, msg),
  bonus: (kind, amount) => payBonus(kind, amount),
  tickets: (n) => giveTicket(n),
  toggleLounge: () => setLounge(!loungeOn),
  throwPouch: () => world?.throwPouch(),
  syncCrown: () => paintCrown(),
  interact: () => world?.interact(),
  enter: (p) => enter(p),
  arrive() {
    if (!FOCUS) { world?.playIntro(); return; }
    const pose = world?.focusSlot(FOCUS, GIFT ? 4500 : 2500);
    if (!pose) return;
    if (GIFT) {
      world?.giftPop?.(FOCUS);
      ui.note('🎉 당신을 위해 준비된 타임스퀘어 스페셜 전광판입니다!', 'ok');
    }
    setTimeout(() => ui.job({ type: 'focus', slot: FOCUS, board: pose.board || {}, fare: 0 }), GIFT ? 700 : 2500);
  },
  focusShot: (slot) => world?.focusSlot(slot),
  endFocus: () => world?.endFocus(),
  setChannel(n) {
    const ch = Math.max(1, Math.min(8, Math.round(Number(n)) || 1));
    net.join(ch === 1 ? 'square' : 'square-' + ch, world?.netState?.());
    ui.setPeople(1, ch);
  },
  slotCard: (id) => world?.slotCard(id),
  frameBillboard: (slot) => world?.frameBillboard?.(slot),
  giftPop: (slot) => world?.giftPop?.(slot),
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
  onBillboard: (slotId) => ui.openAd(slotId),
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
      else { ui.note(n ? `같이 있어서 +${amount}` : `함성 +${amount}`, 'ok'); ui.mission?.('cheer'); }
    }
    else if (kind === 'stand') ui.note(info?.ok ? '🚕 택시를 불렀어요! 바로 앞에 정차한 택시 옆에서 E를 누르세요' : '지금은 빈 택시가 없어요. 잠시 후 다시 불러 주세요', info?.ok ? 'ok' : 'err');
    else if (kind === 'fountain') drawFortune();
    else if (kind === 'lounge') setLounge(true);
  },
  onProximity: (near) => ui.setNear(near),
  onStarTouch: (i) => takeStar(i),
  onCoin: (i) => takeCoin(i),
  onHonk: () => ui.sfx.honk(),
  onHorn: () => ui.sfx.honk(),
  onBump: () => ui.sfx.bump(),
  onBoost: () => ui.sfx.boost(),
  onJump: () => ui.sfx.whoosh(),
  onDrive: (on) => ui.setDriving(on),
  onStunt: () => {
    const now = Date.now();
    if (now - stuntAt < 15000) { ui.note(`황금 링은 ${Math.ceil((15000 - (now - stuntAt)) / 1000)}초 뒤에 다시 받아요`); return; }
    if (!payBonus('stunt', 10)) return;
    stuntAt = now;
    ui.note('🔥 황금 링 +10', 'ok');
    ui.quest('stunt');
  },
  onHive: () => { if (payBonus('hive', 3)) ui.note('🙌 드라이버 하이파이브! +3', 'ok'); },
  onBalloon: (hp, wait) => {
    ui.balloon(hp, wait);
    if (hp === 0 && grant(30, 'me')) ui.note('🧧 복주머니가 터져 코인 30개가 쏟아졌어요', 'ok');
  },
  onWish: (line) => ui.note(`🧧 ${line}`, 'ok'),
  onLoungeEnd: () => setLounge(false),
  onFocus: (on) => ui.focusLock(on),
  onWaypoint: (wp) => ui.setWaypoint(wp),
  onJob(ev) {
    if (ev.type === 'done') ev.paid = payFare(ev.slot || '', ev.riders || 1);
    if (ev.paid) ev.fare = ev.paid;
    ui.job(ev);
    if (ev.type === 'board') trackEvent('taxi_pickup');
    if (ev.type === 'fail') { fareStreak = 0; return; }
    if (ev.type !== 'done') return;
    giveTicket();
    ui.quest('fare');
    fareStreak += 1;
    trackEvent('taxi_dropoff', { streak: fareStreak });
    if (ev.paid) ui.note(`🚕 하차 완료 · ${ev.riders || 1}명 · 연속 ${fareStreak}명 +${ev.paid}`, 'ok');
  },
  onFever(ev) {
    if (ev?.phase === 'count') ui.note('🔮 크리스탈볼이 내려옵니다', 'ok');
    if (ev?.phase === 'party') {
      feverUntil = Math.max(feverUntil, Date.now() + 60000);
      if (!net.sendFever()) ui.note('부스트는 풀렸고, 2배 코인은 광장에 연결된 뒤에 적용돼요', 'ok');
    }
    if (ev?.done) ui.note('크리스탈볼이 지붕으로 돌아갔어요');
  },
});
window.G.world = world;
window.G.ui = ui;
setInterval(() => {
  if (!state.billboards.length || !world) return;
  fillRivals();
  noteChains();
  ui.setWorld(state);
  world.updateWorld(state);
}, 90000);

// ---- wallet & economy ----------------------------------------------------------------
// The Room DO credits 1–15 coins per mine, at most one mine per 2 s per player. The first visit
// pays 40 once through the hello bonus. The client shows a grant as pending until the balance rises.
const pendingSum = () => state.grants.reduce((a, g) => a + g.n, 0);
function coinMult() { return Date.now() < feverUntil ? 2 : 1; }
function grant(amount, source, wait = true) {
  const n = Math.floor(Number(amount));
  if (!Number.isInteger(n) || n < 1 || n > 15) return false;
  if (wait && ui.cooldownLeft() > 0) return false;
  if (!net.sendMine(n, state.nick)) return false;
  const shown = n * coinMult();
  state.grants.push({ n: shown, at: Date.now() });
  state.pending = pendingSum();
  state.earned = (state.earned || 0) + shown;
  if (wait) ui.armCooldown();
  ui.setWallet(state, { defer: true });
  ui.flyCoins(shown, world.screenOf(source === 'cart' ? 'cart' : 'me'));
  if (source === 'cart') world.bake(n);
  return true;
}

const tickets = [];
let loungeOn = false, loungeSum = 0, loungeTimer = 0, stuntAt = 0, fareStreak = 0, revengeUntil = 0, feverUntil = 0;
let drawSeen = Math.floor(Date.now() / 300000);
function drawNo(bucket) {
  let x = Math.imul((bucket ^ 0x9e3779b9) >>> 0, 0x7feb352d) >>> 0;
  return (x % 15) + 1;
}
function giveTicket(n = 1) {
  for (let i = 0; i < n; i++) tickets.push(1 + ((Math.random() * 15) | 0));
  ui.tickets(tickets.length, 300000 - (Date.now() % 300000));
  if (n === 1) ui.note(`🎟️ 복권 ${tickets[tickets.length - 1]}번`, 'ok');
}
function payBonus(kind, amount) {
  const n = Math.floor(Number(amount));
  if (!Number.isInteger(n) || n < 1) return false;
  if (!net.sendBonus(kind, n, state.nick)) return false;
  const shown = n * coinMult();
  creditNow(shown);
  ui.flyCoins(Math.min(shown, 30), world?.screenOf('me'));
  return true;
}
function setLounge(on) {
  on = !!on;
  if (on === loungeOn) return;
  loungeOn = on;
  if (!loungeOn) {
    clearInterval(loungeTimer);
    world?.stopLounge();
    ui.lounge(false, 0);
    return;
  }
  loungeSum = 0;
  world.startLounge();
  ui.lounge(true, 0);
  ui.note('☕ 전광판 관람을 켰어요. 8초마다 다른 전광판, 10초마다 +3. 움직이면 끝나요.', 'ok');
  clearInterval(loungeTimer);
  loungeTimer = setInterval(() => {
    if (!loungeOn) return;
    if (payBonus('lounge', 3)) { loungeSum += 3; ui.lounge(true, loungeSum); }
  }, 10000);
}
function tickDraw() {
  const left = 300000 - (Date.now() % 300000);
  ui.tickets(tickets.length, left);
  const bucket = Math.floor(Date.now() / 300000);
  if (bucket === drawSeen) return;
  drawSeen = bucket;
  const win = drawNo(bucket);
  const hit = tickets.some((n) => n === win);
  tickets.length = 0;
  ui.sfx.drum();
  setTimeout(() => ui.sfx.jackpot(), 700);
  const pay = hit ? 300 : 25;
  const paid = entered && payBonus('draw', pay);
  ui.showDraw(win, hit, paid ? pay : 0);
  if (!paid) ui.note('광장에 연결된 뒤에 복권 당첨금이 들어옵니다', 'err');
  ui.tickets(0, 300000);
}
setInterval(tickDraw, 1000);

function creditNow(n) {
  const amount = Math.floor(Number(n));
  if (!Number.isInteger(amount) || amount < 1) return false;
  state.grants.push({ n: amount, at: Date.now() });
  state.pending = pendingSum();
  ui.setWallet(state, { defer: true });
  world?.setRank?.(state.confirmed + state.pending);
  return true;
}

function payFare(slot, riders = 1) {
  const shown = Math.max(1, Math.round(25 * taxiTrainMult(riders) * (Date.now() < revengeUntil ? 2 : 1) * coinMult()));
  if (!net.sendFare(25, state.nick, slot, riders)) { ui.note('광장 서버에 연결되면 운임이 코인으로 기록됩니다', 'err'); return 0; }
  creditNow(shown);
  ui.flyCoins(Math.min(shown, 40), world.screenOf('me'));
  return shown;
}

function adClick(slot, url) {
  if (!/^https:\/\//.test(String(url || ''))) return;
  trackEvent('outlink_click', { slot: String(slot || '') });
  window.open(url, '_blank', 'noopener');
  if (!net.sendAdClick(state.nick, slot)) { ui.note('링크는 열렸고, 보너스 코인은 광장 연결 후 기록됩니다', 'err'); return; }
  const shown = 15 * coinMult();
  creditNow(shown);
  ui.flyCoins(shown, world.screenOf('me'));
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
function cheer(slot, msg) {
  if (!slot) return;
  const left = ui.cooldownLeft();
  if (left > 0) { ui.note(`다음 함성까지 ${Math.ceil(left / 1000)}초`); return; }
  const bonus = chainBoost(state.billboards, slot) ? 10 : 5;
  if (!grant(bonus, 'me')) { ui.note('광장 서버에 연결되면 코인이 기록됩니다', 'err'); return; }
  ui.quest('cheer');
  giveTicket();
  world?.cheerAt?.(slot);
  trackEvent('wish_cheer', { slot });
  const n = (state.cheers[slot] || 0) + 1;
  state.cheers[slot] = n;
  const line = chars(String(msg || '').trim(), 15);
  const patch = { cheers: n };
  if (line) {
    const list = state.notes[slot] || (state.notes[slot] = []);
    list.push(line);
    if (list.length > 5) list.splice(0, list.length - 5);
    patch.notes = list.slice();
  }
  const row = state.billboards.find((b) => b.slot_id === slot);
  if (row) Object.assign(row, patch);
  world?.updateBillboardTexture(slot, patch, false);
  ui.setWorld(state);
  paintCrown();
  ui.note(line ? `🙏 ${line} · 보너스 코인 +${bonus}` : `🙏 응원 +1 · 보너스 코인 +${bonus}`, 'ok');
  ui.sfx.hit();
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
    state.vipTickets = Number(w.vip_tickets) || 0;
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
  if (res?.vip_tickets != null) state.vipTickets = Number(res.vip_tickets) || 0;
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
    const paid = Math.floor(Number(payload?.bid)) || 0;
    if (net.id && paid > 0) {
      const row = state.ranks.find((r) => r.actor_id === net.id);
      if (row) row.spent = Number(row.spent) + paid;
      else state.ranks.push({ actor_id: net.id, nickname: state.nick, spent: paid, linked: !!sessionUser });
      state.ranks.sort((a, b) => Number(b.spent) - Number(a.spent));
    }
  }
  settle(res);
  if (res?.ok !== false && res?.data) {
    trackEvent('board_claim', { tier: slotTier(res.data.slot_id || payload?.slot_id) });
    ui.promptLink?.('own');
    world?.bumpFever?.();
  }
  return res;
}

async function buySticker(slot, glyph) {
  const have = state.confirmed + state.pending;
  if (have < 30) throw new Error('스티커는 30코인이에요');
  if ((world?.stickerList?.(slot) || []).length >= 8) throw new Error('이 전광판 스티커가 가득 찼어요');
  const res = await net._plazaPost('/rt/spend', { kind: 'sticker', slot_id: slot, glyph, pay: 'coins' });
  settle(res);
  if (!world?.launchSticker?.(slot, glyph)) throw new Error('스티커를 붙이지 못했어요');
  ui.note(`${glyph} 스티커를 날려 보냈어요`, 'ok');
  return res;
}

function washSticker(slot) {
  const row = state.billboards.find((b) => b.slot_id === slot);
  if (!row || row.holder_id !== net.id) { ui.note('내 전광판만 씻을 수 있어요', 'err'); return; }
  if (!(world?.stickerList?.(slot) || []).length) { ui.note('지울 스티커가 없어요', 'err'); return; }
  if (!grant(15, 'me', false)) { ui.note('광장 서버에 연결되면 15코인이 들어와요', 'err'); return; }
  world.peelSticker(slot);
  ui.note('스티커를 지우고 +15', 'ok');
}

async function takeover(payload) {
  const line = chars(payload?.line || '', 24).trim();
  if (!line) throw new Error('한 줄을 적어 주세요');
  const pay = payload?.pay === 'ticket' ? 'ticket' : 'coins';
  if (pay === 'coins' && state.confirmed + state.pending < 5000) throw new Error('5000코인이 필요해요');
  if (pay === 'ticket' && !(state.vipTickets >= 1)) throw new Error('VIP 티켓이 없어요');
  const res = await net._plazaPost('/rt/spend', { kind: 'air', line, pay });
  settle(res);
  world?.beginAir?.({ nick: res.nick || state.nick, line: res.line || line, until: res.until });
  ui.note('📣 60초 동안 모든 전광판을 장악했어요', 'ok');
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
  if (res?.ok !== false && res?.data) ui.promptLink?.('own');
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
      ranks: Array.isArray(j.ranks) ? j.ranks : [],
    };
  } catch { return null; }
}
function writePlaza(remote) {
  if (!remote) return;
  try {
    localStorage.setItem(PLAZA_KEY, JSON.stringify({
      billboards: remote.billboards || [],
      plots: remote.plots || [],
      ranks: remote.ranks || [],
    }));
  } catch { /* private mode */ }
}
const RIVALS = ['성수동까마귀', '판교불나방', '강남건물주', '홍대버스커', '수지맘', '여의도고래', '을지로프린터', '합정디제이', '건대폭스', '잠실호랑이', '신촌야옹', '망원필름', '성수네온', '한남유리', '이태원밤'];
const DRIPS = [
  ['로또 1등만', '이번 달은', '제발'],
  ['출근길만', '자리 나게', '해주세요'],
  ['월세 말고', '보증금이', '돌아오길'],
  ['오늘 야근', '치킨은', '공짜로'],
  ['카톡 답장', '따뜻한 말로', '오게 해주세요'],
  ['다이어트는', '내일부터', '오늘은 야식'],
];
function rivalOf(slotId, bucket) {
  let h = bucket;
  const s = String(slotId);
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
  const name = RIVALS[h % RIVALS.length];
  const drip = DRIPS[h % DRIPS.length];
  const floor = floorOf(slotId) || 100;
  const bid = floor >= 500 ? floor : 100 + (h % 201);
  return {
    holder_id: 'rival:' + slotId, holder_name: name, emoji: '✨',
    line1: drip[0], line2: drip[1], line3: drip[2], current_bid: bid,
    expires_at: new Date(Date.now() + 36e5).toISOString(),
    protected_until: new Date(Date.now() - 1000).toISOString(),
  };
}
function fillRivals() {
  const bucket = Math.floor(Date.now() / 90000);
  for (const row of state.billboards) {
    if (row.holder_id && !String(row.holder_id).startsWith('rival:')) continue;
    Object.assign(row, rivalOf(row.slot_id, bucket));
  }
}
let chainReady = false, chainSeen = new Set();
function noteChains() {
  const list = chainsOf(state.billboards);
  if (!chainReady) { chainSeen = new Set(list.map((c) => c.id)); chainReady = true; return; }
  for (const c of list) if (!chainSeen.has(c.id)) ui.note(`⚡ ${c.name}님이 ${c.building}을 완전 점령했습니다`, 'ok');
  chainSeen = new Set(list.map((c) => c.id));
}
function applyPlaza(remote) {
  if (!remote) return;
  state.billboards = (remote.billboards || []).filter((b) => slotOf(b.slot_id));
  fillRivals();
  noteChains();
  state.plots = remote.plots || [];
  if (Array.isArray(remote.ranks)) state.ranks = remote.ranks;
  for (const row of state.billboards) {
    if (state.cheers[row.slot_id]) row.cheers = state.cheers[row.slot_id];
    if (state.notes[row.slot_id]) row.notes = state.notes[row.slot_id];
  }
  ui.setWorld(state);
  world.updateWorld(state);
  world.setMonopoly?.(!!monopolyOf(state.billboards));
  paintCrown();
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function refreshWorld() {
  try {
    const remote = await net.world();
    writePlaza(remote);
    applyPlaza(remote);
  } catch { /* keep the cached plaza */ }
}

let crownSig = '';
function paintCrown() {
  if (shower) return;
  const tag = world?.topTeam?.() || '';
  const sig = tag + '|' + headlines.join('|');
  if (sig === crownSig) return;
  crownSig = sig;
  const head = tag ? `👑 현재 타임스퀘어 점령 팀: ${tag}` : 'WISH BOARD · 모두의 전광판';
  world?.setTicker?.([head, ...headlines].join('      ✦      '));
}
function headline(text) {
  headlines.unshift(text);
  headlines.length = Math.min(headlines.length, 4);
  paintCrown();
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
  if (!grant(1, 'coin', false)) return;
  ui.note('동전 +1', 'ok');
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
  const left = ui.cooldownLeft();
  if (left > 0 || ui.isBusy()) {
    if (performance.now() - (takeStar.at || 0) > 1200) { takeStar.at = performance.now(); ui.note(ui.isBusy() ? '별똥별은 지금 동작을 끝내고 주워요' : `별똥별은 ${Math.ceil(left / 1000)}초 뒤에 주울 수 있어요`); }
    return;
  }
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
net.on('take', (m) => {
  if (!m || m.victim !== net.id) return;
  ui.revenge({ slot: m.slot, slotName: m.name || slotName(m.slot), attacker: m.attacker, price: m.price, line1: m.line1, line2: m.line2, line3: m.line3, emoji: m.emoji, theme: m.theme, color: m.color });
});
net.on('mono', (m) => { if (m?.name) ui.note(`👑 ${m.name}님이 메인 타워 3칸을 모두 독점하여 타임스퀘어를 지배했습니다!`, 'ok'); });
net.on('rev', (m) => { if (m?.until) { revengeUntil = Number(m.until) || 0; ui.note('🔥 2분 동안 택시 운임이 2배로 들어옵니다', 'ok'); } });
net.on('fever', (m) => {
  const until = Number(m?.until) || 0;
  if (until > Date.now()) {
    feverUntil = until;
    ui.note('✨ 60초 동안 코인 2배 · 택시 부스트 무제한', 'ok');
  }
});
net.on('air', (m) => { if (m?.line && m?.until) world?.beginAir?.({ nick: m.nick, line: m.line, until: m.until }); });
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
    else if (prev.photo_id && !ev.data.photo_id && prev.holder_id === net.id) {
      if (prev.photo_status === 'pending') {
        ui.note('사진이 거절되었습니다. 사진 요금은 지갑으로 돌아왔어요.', 'err');
        refreshWallet();
      } else ui.note('송출 중이던 사진이 내려갔습니다.', 'err');
    }
    return;
  }
  ui.news(ev.kind, ev.data);
  if (ev.kind === 'BILLBOARD') {
    const stolen = prev?.holder_id && prev.holder_id !== ev.data.holder_id;
    if (stolen) {
      world.strike?.(ev.data.slot_id);
      world.updateBillboardTexture(ev.data.slot_id, { taken_from: prev.holder_name || '이전 주인' }, false);
    }
    world.setMonopoly?.(!!monopolyOf(state.billboards));
    headline(`👑 ${chars(ev.data?.holder_name || '누군가', 12)}님이 ${slotName(ev.data?.slot_id)} 점령!`);
  }
  else if (ev.kind === 'PLOT') headline(`🏗️ ${chars(ev.data?.owner_name || '누군가', 12)}님의 ${ev.data?.plot_id}번 건물 완공`);
});

function guestActor() {
  try {
    const g = JSON.parse(localStorage.getItem(GT_LS) || 'null');
    if (!g?.sub) return null;
    return { id: 'guest:' + g.sub, token: g.token || '' };
  } catch { return null; }
}
function authEnv() {
  const g = guestActor();
  const href = handoverHref(g?.id || '', 'google');
  const ua = navigator.userAgent || '';
  return { inApp: isInAppWebView(ua), android: isAndroid(ua), handoverUrl: g?.id ? href : '', intent: g?.id ? chromeIntent(href) : '' };
}
function authMessage(e) {
  const m = String(e?.message || '');
  if (/invalid login credentials/i.test(m)) return '아이디 또는 비밀번호가 맞지 않아요';
  if (/already registered|already been registered/i.test(m)) return '이미 가입한 아이디예요. 로그인해 주세요.';
  if (/password/i.test(m)) return '비밀번호는 6자 이상이어야 해요';
  return m || '로그인에 실패했어요';
}
async function rejoin() {
  const room = net.room;
  const me = world?.netState?.();
  if (!room || !me) return;
  net.room = null;
  try { await net.join(room, me); } catch { /* the socket retries on its own */ }
}
async function finishLink(session, fresh) {
  const user = session?.user;
  if (!user?.id) return null;
  sessionUser = user;
  accountReady = true;
  net.id = 'user:' + user.id;
  const name = profileName(user);
  if (name) {
    state.nick = chars(name, 16);
    keep(NICK_KEY, state.nick);
    world?.setName(state.nick);
  }
  let guest = guestActor();
  if (guest?.id && !guest.token) {
    const issued = await guestToken();
    if (issued?.sub) guest = { id: 'guest:' + issued.sub, token: issued.token || '' };
  }
  let merged = null;
  const mark = user.id + ':' + (guest?.id || '');
  let mergedMark = '';
  try { mergedMark = sessionStorage.getItem('kts_merged') || ''; } catch { mergedMark = ''; }
  if (guest?.id && guest.token && guest.id !== net.id && mergedMark !== mark) {
    try {
      merged = await net.mergeGuest(guest.id, guest.token, name || state.nick);
      try { sessionStorage.setItem('kts_merged', mark); } catch { /* private mode */ }
    } catch (e) { ui.note(authMessage(e), 'err'); }
  }
  ui.setAccount?.({ ready: true, guest: false, linked: true });
  ui.refreshProfile?.();
  try { await refreshWallet(); } catch { /* balance paints on the next sync */ }
  try { await refreshWorld(); } catch { /* boards refresh on the next poll */ }
  if (fresh) trackEvent('auth_login_success', { method: user.app_metadata?.provider || 'email' });
  if (merged?.bonus) ui.note(`계정을 연결했어요. +${merged.bonus}코인`, 'ok');
  else if (fresh) ui.note('계정을 연결했어요', 'ok');
  await rejoin();
  return merged;
}
async function bootAccount() {
  const q = new URLSearchParams(location.search);
  let session = null;
  try { session = await net.currentSession(); } catch { session = null; }
  if (q.get('autologin') === 'google' && !session?.user && !isInAppWebView(navigator.userAgent)) {
    try { await net.startOAuth('google'); return; } catch (e) { ui.note(authMessage(e), 'err'); }
  }
  if (session?.user) await finishLink(session, q.has('code'));
  else {
    accountReady = true;
    ui.setAccount?.({ ready: true, guest: true, linked: false });
  }
  if (q.has('handover') || q.has('autologin')) {
    q.delete('handover');
    q.delete('autologin');
    const s = q.toString();
    history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash);
  }
}
async function startOAuth(provider) {
  if (provider === 'google' && isInAppWebView(navigator.userAgent)) return;
  await net.startOAuth(provider);
}
async function passwordSign(kind, id, password) {
  const email = loginEmail(id);
  if (!email) throw new Error('이메일 또는 아이디를 확인해 주세요');
  if (String(password || '').length < 6) throw new Error('비밀번호는 6자 이상이어야 해요');
  let session;
  try { session = await net.passwordAuth(kind, email, password); }
  catch (e) { throw new Error(authMessage(e)); }
  await finishLink(session, true);
}
async function withdrawAccount() {
  await net.withdrawAccount();
  sessionUser = null;
  try { localStorage.removeItem(GT_LS); } catch { /* private mode */ }
  const g = await guestToken(true);
  if (g?.sub) net.id = 'guest:' + g.sub;
  accountReady = true;
  ui.setAccount?.({ ready: true, guest: true, linked: false });
  ui.refreshProfile?.();
  try { await refreshWallet(); } catch { /* the new guest balance follows */ }
  try { await refreshWorld(); } catch { /* boards clear on the next fetch */ }
  await rejoin();
  ui.note('탈퇴했고, 내 전광판과 토지 소유를 비웠어요', 'ok');
}

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
  if (!tickets.length) giveTicket();
  if (!recall('kts_hello')) {
    let left = 20;
    const hello = () => {
      if (recall('kts_hello')) return;
      if (!net.sendBonus('hello', BALANCE.firstCoins, state.nick)) { if (--left > 0) setTimeout(hello, 2000); return; }
      keep('kts_hello', '1');
      state.grants.push({ n: BALANCE.firstCoins, at: Date.now() });
      state.pending = pendingSum();
      state.earned = (state.earned || 0) + BALANCE.firstCoins;
      ui.setWallet(state, { defer: true });
      ui.flyCoins(BALANCE.firstCoins, world.screenOf('me'));
      ui.note(`첫 놀이 +${BALANCE.firstCoins}`, 'ok');
    };
    setTimeout(hello, 2500);
  }
  setTimeout(() => { if (!shower) startShower(bucketKey(), true); }, 15000);
  let ready = false;
  try { ready = await netReady; } catch { ready = false; }
  if (ready === false) { ui.setStatus('혼자 걷는 중', 'off'); return; }
  try {
    await net.join('square', world.netState());
    bindTake();
    if (!queuePos) ui.setStatus(net.status === 'online' ? '실시간 연결됨' : '광장 연결 중', net.status === 'online' ? 'ok' : 'warn');
  } catch { ui.setStatus('혼자 걷는 중', 'off'); }
}

ui.setStatus('광장 연결 중', 'warn');
ui.setWallet(state);
try {
  const cached = readPlaza();
  if (cached && (cached.billboards.length || cached.plots.length)) applyPlaza(cached);
} catch { /* a bad local plaza cache must not block login */ }
fetch('/rt/health', { cache: 'no-store' }).then(r => r.json()).then((hl) => {
  state.canSettle = !!hl?.hasFlushKey;
  ui.setWallet(state);
}).catch(() => {});

let lastBucket = bucketKey();
setInterval(() => {
  const b = bucketKey();
  if (b !== lastBucket && entered) { lastBucket = b; startShower(b, true); }
  if (shower && performance.now() - shower.started > STAR_LIFE) { world.clearStars(); shower = null; crownSig = ''; paintCrown(); }
  else if (shower) {
    const left = Math.max(0, Math.ceil((STAR_LIFE - (performance.now() - shower.started)) / 1000));
    world.setTicker(`🌠 별똥별 ${10 - shower.taken.size}개 남음 · ${left}초 · 노란 빛기둥에 서면 +8`);
  } else paintCrown();
  ui.setPeople(1 + (net.peers?.size || 0), net.shard || 1);
}, 1000);
setInterval(refreshWallet, 20000);
setInterval(savePlace, 1000);
window.addEventListener('pagehide', savePlace);
window.addEventListener('beforeunload', savePlace);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') savePlace(); });
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
