// Times Square K-점령전 — app wiring: realtime net (DO), 3D world, UI, wallet, world state, star shower.
import { Net, CDN, guestToken } from './net.js?v=20261122w';
import { createTimesSquare, AVATAR_COLORS, taxiTrainMult } from './timesSquare3d.js?v=20261124f';
import { speciesId } from './ts3d/avatars.js?v=20261116g';
import { equip, loadProfile, saveColor, saveNick, saveSpecies, setSpecies } from './profile.js?v=20261122v';
import { starSpot, insideLoop } from './ts3d/layout.js?v=20261113b';
import { createUI } from './ui.js?v=20261124f';
import { haptic, startMusic } from './audio.js?v=20261116j';
import { BALANCE, PAY, chainsOf, live, monopolyOf, slotName, slotOf, takeGrants, cheerCount, countsAsPlay } from './balance.js?v=20261118d';
import { auctionClosed } from './balance.js?v=20261124f';
import { trackEvent } from './analytics.js?v=20261116f';
import { adoptHandover, allowedLink, blockedText, chromeIntent, handoverHref, isAndroid, isInAppWebView, loginEmail, profileName, CHEER_PHRASES, GT_LS, slotTier } from './plaza-account.js?v=20261116f';
import { saveClip } from './share.js?v=20261116f';
import { ftueStillDue, lockCelebration, startFtue } from './ftue.js?v=20261123u';
import { applyInboxPush, loadInbox, readInbox } from './inbox.js?v=20261118h';
import { openTribe, pledge, sendCheer } from './tribe.js?v=20261116h';
import { applyOps, ballNotice, sessionEndPlan } from './live.js?v=20261121w';

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
const FOCUS_REF = (() => {
  const r = new URLSearchParams(location.search).get('ref') || '';
  return /^[a-z0-9]{8}$/.test(r) ? r : '';
})();
// First screen: only what the server reported. A count that is missing or zero is left out, and with no answer the box is hidden.
function paintBootLive(data, here) {
  const box = document.getElementById('bootLive');
  const king = document.getElementById('bootKing');
  const stat = document.getElementById('bootStat');
  if (!box || !king || !stat) return;
  if (!Array.isArray(data?.billboards)) { box.hidden = true; return; }
  const boards = data.billboards.filter((b) => slotOf(b.slot_id));
  const main = boards.find((b) => b.slot_id === 'MAIN_TOP');
  const open = boards.filter((b) => !b.holder_id && !auctionClosed(b.slot_id)).length;
  const count = (v) => Math.max(0, Math.floor(Number(v)) || 0);
  const visitors = count(data.today?.visitors), wishes = count(data.today?.wishes), crowd = count(here?.live);
  king.textContent = live(main)
    ? `👑 지금 메인 타워의 소원: ${main.holder_name || '익명'} — "${main.line1 || '소원 대기'}"`
    : main?.holder_id
      ? `👑 메인 타워 정상은 불이 꺼져 있어요 — ${main.holder_name || '이전 주인'}`
      : '👑 메인 타워 정상이 비어 있어요 — 첫 소원을 걸 자리';
  stat.textContent = [
    open ? `지금 걸 수 있는 빈 자리 ${open}곳` : '지금은 빈 자리가 없어요',
    visitors ? `오늘 다녀간 사람 ${visitors.toLocaleString('ko-KR')}명` : '',
    wishes ? `오늘 걸린 소원 ${wishes.toLocaleString('ko-KR')}개` : '',
    crowd ? `지금 광장 ${crowd}명` : '',
  ].filter(Boolean).join(' · ');
}
Promise.all([
  fetch('/rt/world', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
  fetch('/rt/here', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
]).then(([data, here]) => {
  paintBootLive(data, here);
  ui.setCrowd(here?.live);
}).catch(() => paintBootLive(null, null));

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
  profile: { level: 1, reputation: 0, equip: [] },
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
  starterUsed: null,
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
  profile: () => state.profile,
  starterUsed: () => state.starterUsed,
  wear: (id) => wear(id),
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
  beginBake: () => beginBake(),
  finishBake: (result) => finishBake(result),
  baked: () => noteBakePay(),
  claim: (payload) => claim(payload),
  relight: (slot) => relight(slot),
  submitClaim: (payload) => claim(payload),
  sticker: (slot, glyph) => buySticker(slot, glyph),
  washSticker: (slot) => washSticker(slot),
  takeover: (payload) => takeover(payload),
  stickerList: (slot) => world?.stickerList?.(slot) || [],
  revenge: () => { if (!net.sendRevenge()) ui.note('광장에 연결된 뒤에 복수 운임을 켤 수 있어요', 'err'); },
  submitPhoto: (payload) => submitPhoto(payload),
  capture: () => world?.capture() || null,
  saveClip: () => saveClip(document.getElementById('view')),
  publishShot: (blob) => net.publishShot(blob),
  buy: (payload) => buy(payload),
  sell: (payload) => sellCoins(payload),
  rename(name) {
    state.nick = chars(name, 16) || state.nick;
    keep(NICK_KEY, state.nick);
    world?.setName(state.nick);
    const row = state.ranks.find((r) => r.actor_id === net.id);
    if (row) row.nickname = state.nick;
    ui.setWorld(state);
    return saveNick(state.nick).then(() => refreshWorld());
  },
  recolor(color) {
    if (!isColor(color)) return;
    state.color = color;
    keep(COLOR_KEY, color);
    world?.setColor(color);
    return saveColor(color);
  },
  reshape(id) {
    state.species = setSpecies(id);
    keep(SPECIES_KEY, String(state.species));
    world?.setSpecies(state.species);
    return saveSpecies(state.species);
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
  createTribe: (tag) => createTribe(tag),
  myTribe: () => myTribe(),
  inbox: () => openInbox(),
  report: (slot, reason) => reportBoard(slot, reason),
  joinCode: (code) => joinCode(code),
  weekCodes: () => weekCodes(),
  pledge: (slot, amount) => pledgeSlot(slot, amount),
  replyCheer: (slot, phraseId, to) => replyCheer(slot, phraseId, to),
  bonus: (kind, amount) => payBonus(kind, amount),
  claimQuest: (key) => !!(net.status === 'online' && net.ch?.raw?.({ t: 'QUEST', key })),
  tickets: (n) => giveTicket(n),
  toggleLounge: () => setLounge(!loungeOn),
  watchPortrait: (on) => world?.setWatchPortrait?.(!!on),
  throwPouch: () => world?.throwPouch(),
  syncCrown: () => paintCrown(),
  interact: () => world?.interact(),
  enter: (p) => enter(p),
  arrive() {
    if (FOCUS) trackEvent('focus_enter', { slot: FOCUS, ref: FOCUS_REF });
    if (!FOCUS) {
      world?.playIntro();
      setTimeout(armFtue, 3000);
      return;
    }
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
  cineOn: () => !!world?.cineOn?.(),
  boardView: (slot) => world?.boardView?.(slot) || null,
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
  danceStart: () => { world?.setDancing(true); beginDance(); },
  danceEnd: (score) => { world?.setDancing(false); return score == null ? false : finishDance(score); },
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
      const left = ui.cooldownLeft();
      if (left > 0) ui.note(`다음 함성까지 ${(left / 1000).toFixed(0)}초`);
      else {
        const mates = info?.n || 0;
        ui.armCooldown();
        world?.playEmote?.(3);
        ui.note(mates ? `같이 함성을 질렀어요 · 옆 ${mates}명` : '함성을 질렀어요', 'ok');
      }
    }
    else if (kind === 'stand') ui.note(info?.ok ? '🚕 택시를 불렀어요! 바로 앞에 정차한 택시 옆에서 E를 누르세요' : '지금은 빈 택시가 없어요. 잠시 후 다시 불러 주세요', info?.ok ? 'ok' : 'err');
    else if (kind === 'ring') ui.note('황금 링 안으로 걸어 들어가면 코인이 들어와요');
    else if (kind === 'fountain') drawFortune();
    else if (kind === 'lounge') setLounge(true);
  },
  onProximity: (near) => { ui.setNear(near); if (near?.kind === 'cart') ftueApi?.onArrive?.(); },
  onStarTouch: (i) => takeStar(i),
  onCoin: (i) => takeCoin(i),
  onHonk: () => ui.sfx.honk(),
  onHorn: () => ui.sfx.honk(),
  onBump: () => ui.sfx.bump(),
  onBoost: () => ui.sfx.boost(),
  onJump: () => ui.sfx.whoosh(),
  onDrive: (on) => { ui.setDriving(on); startMusic(on ? 'drive' : (ballShown ? 'night' : 'plaza')); },
  onStunt: () => {
    const now = Date.now();
    if (now - stuntAt < PAY.stunt.gapMs) { ui.note(`황금 링은 ${Math.ceil((PAY.stunt.gapMs - (now - stuntAt)) / 1000)}초 뒤에 다시 받아요`); return; }
    if (!payBonus('stunt', PAY.stunt.base)) { ui.note('광장에 연결되면 황금 링 코인이 들어와요', 'err'); return; }
    stuntAt = now;
  },
  onHive: () => { if (!payBonus('hive', PAY.hive.base)) ui.note('광장에 연결되면 하이파이브 코인이 들어와요', 'err'); },
  onBalloon: (hp, wait) => {
    ui.balloon(hp, wait);
    if (hp !== 0) return;
    if (payBonus('pouch', PAY.pouch.base)) return;
    ui.note('광장 서버에 연결되면 코인이 기록됩니다', 'err');
  },
  onWish: (line) => ui.note(`🧧 ${line}`, 'ok'),
  onLoungeEnd: () => setLounge(false),
  onFocus: (on) => { ui.focusLock(on); if (!on) armFtue(); },
  onWaypoint: (wp) => ui.setWaypoint(wp),
  onJob(ev) {
    if (ev.type === 'board' || ev.type === 'chain') { try { net.ch?.raw?.({ t: 'PICK' }); } catch { /* the fare still asks */ } }
    if (ev.type === 'done') ev.sent = payFare(ev.slot || '', ev.riders || 1);
    ui.job(ev);
    if (ev.type === 'board') trackEvent('taxi_pickup');
    if (ev.type === 'fail') { fareStreak = 0; return; }
    if (ev.type !== 'done' || !ev.slot || !ev.sent) return;
    fareStreak += 1;
    trackEvent('taxi_dropoff', { streak: fareStreak });
    ui.note(`🚕 하차 완료 · ${ev.riders || 1}명 · 연속 ${fareStreak}명`, 'ok');
  },
  onFever(ev) {
    if (ev?.phase === 'count') ui.note('🔮 크리스탈볼이 내려옵니다', 'ok');
    if (ev?.phase === 'party') {
      if (!net.sendFever()) {
        feverUntil = 0;
        world?.rejectFever?.();
        ui.note('부스트는 풀렸고, 2배 코인은 광장에 연결된 뒤에 적용돼요', 'ok');
      }
    }
    if (ev?.done) ui.note('크리스탈볼이 지붕으로 돌아갔어요');
  },
});
window.G.world = world;
window.G.ui = ui;

let ftueApi = null;
let ftueArmed = false;
let bakeGuided = false;
function armFtue() {
  if (ftueArmed || !entered || !world) return;
  ftueArmed = true;
  let daily = null;
  try { daily = JSON.parse(recall('kts_daily') || 'null'); } catch { daily = null; }
  if (!ftueStillDue(recall('kts_ftue'), daily)) { keep('kts_ftue', '1'); return; }
  ftueApi = startFtue({ ui, world, net, balance: BALANCE });
  if (ui.nearKind?.() === 'cart') ftueApi.onArrive();
  if (bakeGuided) ftueApi.onBakePay();
}
function noteBakePay() {
  if (bakeGuided) return;
  bakeGuided = true;
  keep('kts_ftue', '1');
  ftueApi?.onBakePay();
}

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
let loungeOn = false, loungeSum = 0, loungeTimer = 0, loungeTold = false, stuntAt = 0, fareStreak = 0, revengeUntil = 0, feverUntil = 0;
let drawSeen = Math.floor(Date.now() / 300000);
function giveTicket() {
  ui.tickets(0, 300000 - (Date.now() % 300000));
}
function payBonus(kind, amount) {
  const n = Math.floor(Number(amount));
  if (!Number.isInteger(n) || n < 1) return false;
  if (!net.sendBonus(kind, n, state.nick)) return false;
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
  loungeTold = false;
  world.startLounge();
  ui.lounge(true, 0);
  ui.note('☕ 전광판 관람을 켰어요. 8초마다 다른 전광판, 20초마다 +2. 움직이면 끝나요.', 'ok');
  clearInterval(loungeTimer);
  loungeTimer = setInterval(() => {
    if (!loungeOn) return;
    if (!payBonus('lounge', PAY.lounge.base) && !loungeTold) { loungeTold = true; ui.note('광장에 연결되어야 관람 코인이 들어와요', 'err'); }
  }, PAY.lounge.gapMs);
}
function tickDraw() {
  const left = 300000 - (Date.now() % 300000);
  ui.tickets(tickets.length, left);
  const bucket = Math.floor(Date.now() / 300000);
  if (bucket === drawSeen) return;
  drawSeen = bucket;
  tickets.length = 0;
  ui.tickets(0, 300000);
}
setInterval(tickDraw, 1000);

function creditNow(n, play = false) {
  const amount = Math.floor(Number(n));
  if (!Number.isInteger(amount) || amount < 1) return 0;
  state.grants.push({ n: amount, at: Date.now() });
  state.pending = pendingSum();
  if (play) state.earned = (state.earned || 0) + amount;
  ui.setWallet(state);
  ui.flyCoins?.(Math.min(amount, 40), world?.screenOf?.('me'));
  world?.setRank?.(state.confirmed + state.pending);
  return amount;
}

function payFare(slot, riders = 1) {
  if (!/^(MAIN_|SUB_|STREET_|PLOT_)/.test(String(slot || ''))) { ui.note('전광판 앞에서 내려야 운임이 들어와요', 'err'); return false; }
  if (!net.sendFare(25, state.nick, slot, riders)) { ui.note('광장 서버에 연결되면 운임이 코인으로 기록됩니다', 'err'); return false; }
  return true;
}

function adClick(slot, url) {
  if (!/^https:\/\//.test(String(url || ''))) return;
  trackEvent('outlink_click', { slot: String(slot || '') });
  window.open(url, '_blank', 'noopener');
  if (!net.sendAdClick(state.nick, slot)) { ui.note('링크는 열렸고, 보너스 코인은 광장 연결 후 기록됩니다', 'err'); return; }
}

const FORTUNES = [
  '🥠 네온이 네 소원 쪽으로 기울어 있어요.',
  '🥠 빈 명당이 너를 기다리고 있었어요.',
  '🥠 빨간 계단이 잠깐 네 편을 들어요.',
  '🥠 가장 밝은 화면이 네 이름을 연습 중이에요.',
  '🥠 보낸 마음이 전광판보다 먼저 도착해요.',
  '🥠 월요일이 한 박자 늦습니다.',
  '🥠 로또 영수증이 주머니에서 따뜻해요.',
  '🥠 택시가 초록불에 걸리는 날이에요.',
];
function drawFortune() {
  const left = ui.cooldownLeft();
  if (left > 0) { ui.note(`다음 포춘쿠키까지 ${(left / 1000).toFixed(0)}초`); return; }
  world?.fountainSplash?.();
  const line = FORTUNES[(Math.random() * FORTUNES.length) | 0];
  ui.note(line, 'ok');
  ui.armCooldown();
}
function cheer(slot, phraseId) {
  const msg = sendCheer(slot, phraseId);
  if (!msg) return;
  const { p } = msg;
  const row = state.billboards.find((b) => b.slot_id === slot);
  if (row && (!live(row) || row.holder_id === net.id)) {
    ui.note('켜져 있는 다른 사람 전광판에만 응원할 수 있어요');
    return;
  }
  const wait = PAY.cheer.gapMs - (Date.now() - (cheerAt.get(slot) || 0));
  if (wait > 0) { ui.note(`다음 응원까지 ${Math.ceil(wait / 1000)}초`); return; }
  if (!net.ch?.raw?.(msg)) { ui.note('광장 서버에 연결되면 응원이 기록됩니다', 'err'); return; }
  cheerAt.set(slot, Date.now());
  world?.cheerAt?.(slot);
  trackEvent('wish_cheer', { slot });
  paintCrown();
  ui.note(`🙏 ${CHEER_PHRASES[p - 1]}`, 'ok');
  ui.sfx.hit();
}
const cheerAt = new Map();

async function openInbox() {
  const items = await loadInbox();
  const rows = items.map((row) => ({
    id: row.id,
    text: applyInboxPush(row),
    slot: String(row.slot_id || ''),
    from: row.kind === 'cheer' ? String(row.from || '') : '',
  })).filter((row) => row.text);
  await readInbox(rows.map((row) => row.id));
  return rows;
}
async function joinCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(c)) throw new Error('코드는 6자리예요');
  return net.authed('/rt/grp', { c });
}
async function weekCodes() {
  const r = await fetch('/rt/grp', { cache: 'no-store' });
  return r.json().catch(() => ({ top: [] }));
}
async function reportBoard(slot, reason) {
  return net.authed('/rt/report', { slot, reason });
}
async function myTribe() {
  return net.authed('/rt/tribe', { look: true });
}
async function createTribe(tag) {
  const made = openTribe().create(tag);
  if (!made.tag) throw new Error('태그를 적어 주세요');
  return net.authed('/rt/tribe', { tag: made.tag });
}
async function pledgeSlot(slot, amount) {
  const body = pledge(slot, amount);
  if (!body) return null;
  const res = await net.authed('/rt/tribe/pledge', { ...body, topic: net.topic || '' });
  refreshWallet();
  return res;
}
function replyCheer(slot, phraseId, to) {
  const p = Math.floor(Number(phraseId));
  if (p < 1 || p > 12 || !to) {
    ui.note('방금 온 응원에만 답할 수 있어요', 'err');
    return false;
  }
  if (!net.ch?.raw?.({ t: 'REPLY', slot, p, to })) {
    ui.note('광장 서버에 연결되면 답례가 전달됩니다', 'err');
    return false;
  }
  return true;
}
async function joinTribeLink() {
  let id = '';
  try { id = new URLSearchParams(location.search).get('tribe') || ''; } catch { id = ''; }
  if (!/^[a-z0-9]{8}$/.test(id)) return;
  try {
    const res = await net.authed('/rt/tribe', { id });
    if (res?.tag) ui.note(`#${res.tag} 소속에 들어왔어요`, 'ok');
  } catch (e) {
    ui.note(e?.message || '소속에 들어가지 못했어요', 'err');
  }
}

async function refreshWallet() {
  const gen = ++walletGen;
  try {
    const w = await net.wallet();
    if (gen !== walletGen) return;
    const coins = Number(w.coins) || 0;
    if (state.walletKnown && coins > state.confirmed) state.grants = takeGrants(state.grants, coins - state.confirmed);
    const now = Date.now();
    const kept = state.grants.filter(g => now - g.at < BALANCE.grantKeepMs);
    if (kept.length < state.grants.length) ui.note('정산에 안 들어온 코인이 빠져 나갔어요', 'err');
    state.grants = kept;
    state.confirmed = coins;
    state.vipTickets = Number(w.vip_tickets) || 0;
    state.walletKnown = true;
    state.pending = pendingSum();
    ui.setWallet(state);
    world?.setRank?.(state.confirmed);
    return true;
  } catch { return false; }
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

function markMine(prefer) {
  if (!world?.setMyBeacon) return;
  const mine = state.billboards.filter((b) => b.holder_id && b.holder_id === net.id);
  const rows = mine.filter(live);
  let best = prefer ? rows.find((b) => b.slot_id === prefer) : null;
  if (!best) {
    for (const b of rows) if (!best || (Number(b.lit_days) || 0) > (Number(best.lit_days) || 0)) best = b;
  }
  const id = best ? best.slot_id : null;
  world.setMyBeacon(id);
  const held = prefer && mine.some((b) => b.slot_id === prefer) ? prefer : (mine[0]?.slot_id || null);
  world.pinSlot?.(id || held);
}

async function relight(slot) {
  const data = await net.authed('/rt/relight', { slot, topic: net.topic || '' });
  const row = state.billboards.find((b) => b.slot_id === slot);
  if (row && data && data.ok !== false) {
    if (data.lit_until) {
      row.lit_until = data.lit_until;
      row.expires_at = data.lit_until;
    }
    if (data.lit_days != null) row.lit_days = data.lit_days;
    world.updateBillboardTexture(slot, row, false);
    ui.setWorld(state);
  }
  if (data?.scored === true) {
    const reputation = Math.max(0, Math.floor(Number(state.profile.reputation) || 0)) + 1;
    state.profile = { ...state.profile, reputation, level: Math.min(99, 1 + Math.floor(reputation / 10)) };
    ui.note('명성 +1', 'ok');
  }
  markMine(slot);
  trackEvent('relight', { slot });
  return data;
}

function celebrateClaim(slot) {
  ui.setQuietBlock(true);
  world.focusSlot(slot);
  const ms = lockCelebration(5000);
  setTimeout(() => ui.setQuietBlock(false), ms);
}

async function claim(payload) {
  if (blockedText(state.nick) || blockedText(payload?.line1) || blockedText(payload?.line2) || blockedText(payload?.line3)) {
    throw new Error('그 문구는 올릴 수 없어요');
  }
  const link = payload?.external_url ? allowedLink(payload.external_url) : payload?.external_url;
  const res = await net.claimBillboard({ ...payload, external_url: link || '', nickname: state.nick });
  if (res?.review_id) {
    settle(res);
    ui.setNextLine('검수 대기');
    ui.note('S급은 확인 후 켜집니다. 거절되면 낸 코인이 그대로 돌아와요.', 'ok');
    return res;
  }
  if (res?.data) {
    if (payload?.mode !== 'edit') { res.data.photo_id = null; res.data.photo_status = null; }
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
    const mode = payload?.mode;
    if (mode === 'starter' || mode === 'claim') celebrateClaim(res.data.slot_id || payload?.slot_id);
    ui.promptLink?.('own');
    if (res.fever != null) world?.setFever?.(res.fever);
  }
  return res;
}

async function buySticker(slot, glyph) {
  const have = state.confirmed + state.pending;
  if (have < 30) throw new Error('스티커는 30코인이에요');
  if ((world?.stickerList?.(slot) || []).length >= 8) throw new Error('이 전광판 스티커가 가득 찼어요');
  const res = await net._plazaPost('/rt/spend', { kind: 'sticker', slot_id: slot, glyph, pay: 'coins' });
  settle(res);
  world?.applyStk?.({ slot, list: res.list || [] });
  world?.launchSticker?.(slot, glyph);
  ui.note(`${glyph} 스티커를 날려 보냈어요`, 'ok');
  return res;
}

async function washSticker(slot) {
  const row = state.billboards.find((b) => b.slot_id === slot);
  if (!row || row.holder_id !== net.id) throw new Error('내 전광판만 씻을 수 있어요');
  if (!(world?.stickerList?.(slot) || []).length) throw new Error('지울 스티커가 없어요');
  const res = await net._plazaPost('/rt/spend', { kind: 'wash', slot_id: slot });
  world?.applyStk?.({ slot, list: res.list || [] });
  ui.note('스티커를 지웠어요', 'ok');
  return res;
}

async function takeover(payload) {
  const line = chars(payload?.line || '', 24).trim();
  if (!line) throw new Error('한 줄을 적어 주세요');
  if (blockedText(line) || blockedText(state.nick)) throw new Error('그 문구는 올릴 수 없어요');
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
  if (blockedText(state.nick) || blockedText(payload?.sign_text)) throw new Error('그 문구는 올릴 수 없어요');
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
      ...(typeof j.roof === 'string' ? { roof: j.roof } : {}),
      ...(j.ops && j.ops.copy ? { ops: j.ops } : {}),
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
      ...(typeof remote.roof === 'string' ? { roof: remote.roof } : {}),
      ...(remote.ops ? { ops: remote.ops } : {}),
    }));
  } catch { /* private mode */ }
}
let chainReady = false, chainSeen = new Set();
function noteChains() {
  const list = chainsOf(state.billboards);
  if (!chainReady) { chainSeen = new Set(list.map((c) => c.id)); chainReady = true; return; }
  for (const c of list) if (!chainSeen.has(c.id)) ui.note(`⚡ ${c.name}님이 ${c.building}을 완전 점령했습니다. 그 건물 응원은 +${BALANCE.cheerGroup}`, 'ok');
  chainSeen = new Set(list.map((c) => c.id));
}
function applyPlaza(remote) {
  if (!remote) return;
  state.billboards = (remote.billboards || []).filter((b) => slotOf(b.slot_id));
  noteChains();
  state.plots = remote.plots || [];
  if (Array.isArray(remote.ranks)) state.ranks = remote.ranks;
  if (remote.today) state.today = { visitors: Math.max(0, Math.floor(Number(remote.today.visitors) || 0)), wishes: Math.max(0, Math.floor(Number(remote.today.wishes) || 0)) };
  if (typeof remote.roof === 'string') state.roof = remote.roof;
  const opsCopy = applyOps(remote.ops);
  state.ops = opsCopy ? { copy: opsCopy } : null;
  if (opsCopy) ui.setNextLine(opsCopy);
  for (const row of state.billboards) {
    if (state.cheers[row.slot_id]) row.cheers = state.cheers[row.slot_id];
    if (state.notes[row.slot_id]) row.notes = state.notes[row.slot_id];
  }
  ui.setWorld(state);
  world.updateWorld(state);
  world.setMonopoly?.(!!monopolyOf(state.billboards));
  markMine();
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
let welcomeUntil = 0;
let welcomeTimer = 0;
function paintCrown() {
  if (shower || Date.now() < welcomeUntil) return;
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

function guideStar() {
  const d = world?.minimap?.() || {};
  const me = d.me;
  let best = { x: 16, z: 32 }, dist = Infinity;
  for (const s of d.stars || []) {
    const dd = me ? (s.x - me.x) ** 2 + (s.z - me.z) ** 2 : 0;
    if (dd < dist) { dist = dd; best = s; }
  }
  world?.setWaypoint?.({ x: best.x, z: best.z });
}
function startShower(seed, announce) {
  const key = seed >>> 0;
  if (shower?.seed === key) return;
  shower = { seed: key, started: performance.now(), taken: new Set() };
  world.startStars(starsFor(key));
  if (announce) {
    ui.news('STAR');
    headline(`🌠 별똥별 10개 · ${Math.round(STAR_LIFE / 1000)}초 · 노란 빛기둥에 서면 +${BALANCE.starCoin}`);
    ui.note(`별똥별 ${Math.round(STAR_LIFE / 1000)}초 · 누르면 노란 기둥으로 안내`, 'ok', guideStar);
  }
}

let coinWait = -1;
function takeCoin(i) {
  if (coinWait >= 0) return;
  if (!net.sendMine(1, state.nick)) { ui.note('광장에 연결되면 동전을 주울 수 있어요', 'err'); return; }
  coinWait = i;
  setTimeout(() => { if (coinWait === i) { coinWait = -1; ui.note('동전을 지금 기록하지 못했어요', 'err'); } }, 3000);
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
  if (!payBonus('star', BALANCE.starCoin)) { ui.note('별똥별을 주우려면 광장 서버에 연결되어 있어야 해요', 'err'); return; }
  shower.taken.add(i);
  ui.sfx.star();
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
const capTold = new Set();
net.on('pay', (m) => {
  if (m?.why === 'pouchday') {
    if (!capTold.has('pouchday')) { capTold.add('pouchday'); ui.note(`오늘 복주머니는 ${PAY.pouch.perDay}번까지예요`, 'err'); }
    return;
  }
  if (m?.kind === 'mine' && m?.why) {
    coinWait = -1;
    if (m.why === 'soon') ui.note('동전은 잠깐 쉬었다가 다시 주워요', 'err');
    else if (!capTold.has('mine')) { capTold.add('mine'); ui.note('이번 시간에 받을 수 있는 코인을 다 받았어요', 'err'); }
    return;
  }
  if (m?.why === 'nopick') { ui.note('손님을 태운 뒤에 운임이 들어와요. 초록 기둥에서 속도를 줄이세요', 'err'); return; }
  if (m?.why === 'place') { ui.note('전광판 앞에서 내려야 운임이 들어와요', 'err'); return; }
  if (m?.why === 'dark') { ui.note('켜져 있는 다른 사람 전광판에만 응원할 수 있어요', 'err'); return; }
  if (m?.why === 'soon') {
    const wait = {
      fare: '손님을 태운 뒤 40초가 지나야 운임이 들어와요',
      lounge: `관람 코인은 ${Math.round(PAY.lounge.gapMs / 1000)}초마다 들어와요`,
      stunt: `황금 링은 ${Math.round(PAY.stunt.gapMs / 1000)}초 뒤에 다시 받아요`,
      hive: `하이파이브는 ${Math.round(PAY.hive.gapMs / 1000)}초마다 들어와요`,
      pouch: `복주머니는 ${Math.round(PAY.pouch.gapMs / 1000)}초 뒤에 다시 터져요`,
      cheer: `같은 전광판 응원은 ${Math.round(PAY.cheer.gapMs / 1000)}초 뒤에 다시 받아요`,
    }[m.kind] || '조금 뒤에 다시 받을 수 있어요';
    ui.note(wait, 'err');
    return;
  }
  if (m?.why === 'cap' || m?.why === 'day') {
    const key = m.why + ':' + String(m.why === 'day' ? (m.key || m.kind || '') : (m.kind || ''));
    if (!capTold.has(key)) { capTold.add(key); ui.note(m.why === 'day' ? '링크 보너스는 칸마다 하루에 한 번, 하루 5칸까지예요' : '이번 시간에 받을 수 있는 코인을 다 받았어요', 'err'); }
    return;
  }
  const got = creditNow(m?.amount, countsAsPlay(m?.kind));
  if (m?.kind === 'bake') { noteBakePay(); if (got) ui.note(`붕어빵 +${got}`, 'ok'); }
  if (m?.kind === 'dance' && got) ui.note(`댄스 +${got}`, 'ok');
  if (m?.kind === 'lounge' && got) { loungeSum += got; ui.lounge(true, loungeSum); }
  if (m?.kind === 'shot' && got) { ui.noteShot?.(); ui.note(`공유 +${got}`, 'ok'); }
  if (m?.kind === 'fare' && got) { ui.quest?.('fare'); ui.noteFare?.(got); ui.noteLot?.(m.lot); if (m.gauge != null) world?.setFever?.(m.gauge); ui.note(`운임 +${got}`, 'ok'); }
  if (m?.kind === 'cheer' && got) { ui.quest?.('cheer'); ui.note(`응원 +${got}`, 'ok'); }
  if (m?.kind === 'stunt' && got) { ui.quest?.('stunt'); ui.note(`황금 링 +${got}`, 'ok'); }
  if (m?.kind === 'hive' && got) ui.note(`하이파이브 +${got}`, 'ok');
  if (m?.kind === 'star' && got) ui.note(`별똥별 +${got}`, 'ok');
  if (m?.kind === 'pouch' && got) ui.note(`복주머니 +${got}`, 'ok');
  if (m?.kind === 'mine' && got) { ui.note(`동전 +${got}`, 'ok'); if (coinWait >= 0) { world?.removeCoin?.(coinWait); coinWait = -1; } }
  if (m?.kind === 'click' && got) ui.note(`링크 +${got}`, 'ok');
  if (m?.kind === 'quest' && got) { ui.markQuest?.(m.key); ui.note(m.key === 'all' ? `오늘 미션을 모두 끝냈어요 +${got}` : `미션 완료 +${got}`, 'ok'); }
  if (m?.kind === 'mission' && got) ui.markDaily?.(got);
  if (m?.kind === 'hello') { keep('kts_hello', '1'); if (got) ui.note(`첫 놀이 +${got}`, 'ok'); }
  if (m?.kind === 'attend') {
    ui.noteAttend?.(m?.key);
    if (got) ui.note(`출석 +${got}`, 'ok');
    const streak = Math.floor(Number(m?.key));
    if (streak > 0 && streak % 7 === 0) {
      pullProfile();
      ui.note('리본 모자, 노란 택시, 연속 테두리를 프로필에서 장착할 수 있어요', 'ok');
    }
  }
});
let bakeId = '', bakeT = 0, bakeOnline = false, danceId = '', danceT = 0, danceOnline = false, sessKind = '', sessFailed = false;
const BAKE_MISS = '붕어빵 코인이 기록되지 않았어요. 포차 앞에서 조금 더 구워 주세요';
const DANCE_MISS = '댄스로 번 코인이 기록되지 않았어요. 무대에서 한 곡을 끝까지 춰 주세요';
net.on('sess', (m) => {
  if (m?.ok && m.id) {
    if (sessKind === 'dance') danceId = m.id;
    else bakeId = m.id;
    return;
  }
  if (m && m.ok === false && !sessFailed) {
    sessFailed = true;
    ui.note(m.why === 'cap' ? '이번 시간에 받을 수 있는 코인을 다 받았어요' : m.why === 'place' ? (sessKind === 'dance' ? '무대 원 안에서 시작해야 댄스 코인이 기록돼요' : '포차 앞에서 시작해야 붕어빵 코인이 기록돼요') : m.why === 'time' ? '시간이 맞지 않아 코인이 기록되지 않았어요' : (sessKind === 'dance' ? DANCE_MISS : BAKE_MISS), 'err');
    if (sessKind === 'dance') ui.endDance?.(true);
    else ui.stopBake?.(true);
  }
});
function placeNow() {
  const st = world?.netState?.();
  if (!st || !net.ch || net.status !== 'online') return;
  net.me = st;
  const pkt = typeof net.state === 'function' ? net.state() : st;
  net.ch.send({ type: 'broadcast', event: 'pos', payload: pkt });
}
function sessStart(kind) {
  const st = world?.netState?.();
  placeNow();
  return !!net.sendSess?.('start', { kind, a: st ? [st.x, st.y] : undefined });
}
function beginBake() {
  bakeId = '';
  sessFailed = false;
  bakeT = Date.now();
  sessKind = 'bake';
  bakeOnline = sessStart('bake');
  setTimeout(() => { if (!bakeId && !sessFailed && sessKind === 'bake') sessStart('bake'); }, 600);
}
function finishBake(result) {
  if (!bakeOnline) { ui.note('광장에 연결되어야 붕어빵 코인이 들어와요', 'err'); return false; }
  const started = bakeT || Date.now();
  const tryEnd = (since) => {
    const plan = sessionEndPlan(bakeId, sessFailed, Date.now() - since, 4000);
    if (plan === 'wait') { setTimeout(() => tryEnd(since), 200); return; }
    if (plan === 'note') { sessFailed = true; ui.note(BAKE_MISS, 'err'); return; }
    if (plan !== 'send') return;
    const id = bakeId;
    const rest = Math.max(0, 8600 - (Date.now() - started));
    setTimeout(() => net.sendSess('end', { id, result }), rest);
  };
  tryEnd(Date.now());
  return true;
}
function beginDance() {
  danceId = '';
  sessFailed = false;
  danceT = Date.now();
  sessKind = 'dance';
  danceOnline = sessStart('dance');
  setTimeout(() => { if (!danceId && !sessFailed && sessKind === 'dance') sessStart('dance'); }, 600);
}
function finishDance(score) {
  if (!danceOnline) { ui.note('광장에 연결되어야 댄스로 번 코인이 들어와요', 'err'); return false; }
  const started = danceT || Date.now();
  const n = Math.max(0, Math.min(100, Math.floor(Number(score) || 0)));
  const tryEnd = (since) => {
    const plan = sessionEndPlan(danceId, sessFailed, Date.now() - since, 4000);
    if (plan === 'wait') { setTimeout(() => tryEnd(since), 200); return; }
    if (plan === 'note') { sessFailed = true; ui.note(DANCE_MISS, 'err'); return; }
    if (plan !== 'send') return;
    const id = danceId;
    const rest = Math.max(0, 25600 - (Date.now() - started));
    setTimeout(() => net.sendSess('end', { id, kind: 'dance', result: String(n) }), rest);
  };
  tryEnd(Date.now());
  return true;
}
net.on('inbox', (m) => {
  if (m?.kind === 'reply_ack') {
    const phrase = CHEER_PHRASES[Math.floor(Number(m.phrase)) - 1] || '답례';
    ui.note(m.ok ? `🙏 ${phrase}` : '그 사람은 지금 이 채널에 없어요', m.ok ? 'ok' : 'err');
    return;
  }
  const line = applyInboxPush(m);
  const reply = m?.kind === 'cheer' && m.from && m.slot_id ? { slot: m.slot_id, to: m.from } : '';
  if (line) ui.setNextLine(line, reply);
});
let ballShown = false;
net.on('ball', (m) => {
  ui.setBall?.(!!m?.open, m?.until);
  const line = ballNotice(ballShown, m);
  if (line) ui.setNextLine(line);
  if (m?.open) {
    if (!ballShown) {
      ballShown = true;
      world?.openPlaza?.();
      haptic(60);
    }
    if (!world?.isDriving?.()) startMusic('night');
  } else {
    ballShown = false;
    if (!world?.isDriving?.()) startMusic('plaza');
  }
});
net.on('ghost', (m) => world?.showGhost?.(m));
net.on('draw', (m) => {
  creditNow(m?.amount);
  ui.showDraw?.(m?.win, !!m?.hit, Math.floor(Number(m?.amount)) || 0, m?.lot);
  tickets.length = 0;
  ui.tickets?.(0, 300000);
});
net.on('profile', (m) => applyServerProfile(m));
net.on('welcome', (m) => {
  if (!m?.name) return;
  ui.news('WELCOME', { nick: m.name });
  welcomeUntil = Date.now() + 8000;
  world?.setTicker?.('방금 도착: ' + m.name);
  clearTimeout(welcomeTimer);
  welcomeTimer = setTimeout(() => {
    welcomeUntil = 0;
    world?.setTicker?.('');
    crownSig = '';
    paintCrown();
  }, 8000);
});
net.on('take', (m) => {
  if (!m || m.victim !== net.id) return;
  ui.revenge({ slot: m.slot, slotName: m.name || slotName(m.slot), attacker: m.attacker, price: m.price, line1: m.line1, line2: m.line2, line3: m.line3, emoji: m.emoji, theme: m.theme, color: m.color });
});
net.on('mono', (m) => { if (m?.name) ui.note(`👑 ${m.name}님이 메인 타워 3칸을 모두 독점하여 타임스퀘어를 지배했습니다!`, 'ok'); });
net.on('rev', (m) => {
  const until = Number(m?.until) || 0;
  if (until > Date.now()) { revengeUntil = until; ui.setRevenge?.(until); ui.note('🔥 2분 동안 택시 운임이 2배로 들어옵니다', 'ok'); }
  else ui.note('복수 운임은 전광판을 빼앗긴 뒤 10분 안에만 켜져요', 'err');
});
net.on('fever', (m) => {
  if (m?.sync) {
    world?.setFever?.(m.gauge, m.until);
    const until = Number(m.until) || 0;
    if (until > Date.now()) feverUntil = until;
    ui.setRevenge?.(Number(m.revenge) || 0);
    return;
  }
  const until = Number(m?.until) || 0;
  if (until > Date.now()) {
    feverUntil = until;
    ui.note('✨ 60초 동안 코인 2배 · 택시 부스트 무제한', 'ok');
  } else {
    feverUntil = 0;
    world?.rejectFever?.();
    ui.note('2배 코인은 점령과 택시 하차가 20번 쌓인 뒤에 켜져요', 'err');
  }
});
net.on('lot', (m) => ui.noteLot?.(m?.n));
net.on('air', (m) => { if (m?.line && m?.until) world?.beginAir?.({ nick: m.nick, line: m.line, until: m.until }); });
net.on('stk', (m) => world?.applyStk?.(m));
net.on('cheer', (m) => {
  const apply = (slot, n, phrase) => {
    if (!slot) return;
    const text = CHEER_PHRASES[Math.floor(Number(phrase)) - 1] || '';
    const patch = {};
    if (text) {
      const list = state.notes[slot] || (state.notes[slot] = []);
      list.push(text);
      if (list.length > 5) list.splice(0, list.length - 5);
      patch.notes = list.slice();
    }
    const next = cheerCount(state.cheers[slot], n);
    if (next >= 1 && next !== state.cheers[slot]) {
      state.cheers[slot] = next;
      patch.cheers = next;
    }
    if (!patch.cheers && !patch.notes) return;
    const board = state.billboards.find((b) => b.slot_id === slot);
    if (board) Object.assign(board, patch);
    world?.updateBillboardTexture(slot, patch, false);
  };
  if (Array.isArray(m?.all)) { for (const row of m.all) apply(row?.slot, row?.n); }
  else apply(m?.slot, m?.n, m?.p);
  ui.setWorld(state);
});
net.on('ad', (m) => {
  if (!m?.slot) return;
  const row = state.billboards.find((b) => b.slot_id === m.slot);
  if (row) { row.views = m.views; row.clicks = m.clicks; }
  else state.billboards.push({ slot_id: m.slot, views: m.views, clicks: m.clicks });
  world.updateBillboardTexture(m.slot, { views: m.views, clicks: m.clicks }, false);
  ui.setWorld(state);
  if (m.kind === 'views' && row?.holder_id && row.holder_id === net.id && m.by !== net.id) ui.note('🚕 방금 다른 유저의 택시가 내 전광판 앞에 손님을 내려줬습니다! (누적 노출 +1)', 'ok');
});
// Wallet and world arrive over the socket: WALLET_SYNC after every settle (the Room DO settles pending coins within 30 s on its own)
// and WORLD_UPDATE on every board or plot change. HTTP only fills the gaps: once when the socket (re)connects, and every 60 s while it is down.
let syncedAt = 0;
function resync() {
  if (Date.now() - syncedAt < 15000) return;
  syncedAt = Date.now();
  refreshWallet();
  refreshWorld();
}
net.on('status', (s) => {
  if (s === 'online') resync();
  if (queuePos) return;
  if (s === 'online') { ui.setStatus('실시간 연결됨', 'ok'); bindTake(); try { net.ch?.raw?.({ t: 'DRAW_CHECK' }); } catch { /* the next connect asks again */ } }
  else if (s === 'connecting') ui.setStatus('광장 연결 중', 'warn');
  else ui.setStatus('혼자 걷는 중', 'off');
});
net.on('gate', (g) => {
  if (g?.pos) { queuePos = g.pos; ui.setStatus(`입장 대기 ${g.pos}번째`, 'warn'); }
  if (g?.ok || g?.down) queuePos = 0;
  if (g?.down) ui.setStatus('오늘 광장 정원이 찼어요', 'off');
  if (g && g.live != null) ui.setCrowd(g.live);
});
net.onWorldUpdate((ev) => {
  // No kind: the world changed in bulk (an account was withdrawn). Refetch, spread over 3 s so a full room does not ask at once.
  if (!ev?.kind) { if (!ev?.replay) setTimeout(refreshWorld, Math.random() * 3000); return; }
  if (Array.isArray(ev.ranks) && !ev.replay) state.ranks = ev.ranks;
  const prev = ev?.kind === 'BILLBOARD' && ev.data ? state.billboards.find(b => b.slot_id === ev.data.slot_id) : null;
  const sameHold = !!prev && !!prev.holder_id && prev.holder_id === ev.data.holder_id && Number(prev.current_bid) === Number(ev.data.current_bid);
  const sameClaim = sameHold && String(prev.expires_at) === String(ev.data.expires_at) && String(prev.lit_until || '') === String(ev.data.lit_until || '');
  if (ev?.kind === 'BILLBOARD' && ev.data) upsert(state.billboards, 'slot_id', ev.data);
  if (ev?.kind === 'PLOT' && ev.data) upsert(state.plots, 'plot_id', ev.data);
  ui.setWorld(state);
  if (ev?.kind === 'BILLBOARD') markMine();
  world.updateWorld?.(state);
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
  if (ev.kind === 'BILLBOARD' && sameHold) return;
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
// The handover link carries a short-lived ticket instead of the public guest id (net.handoverTicket). Both strings stay empty until one is ready.
function authEnv() {
  const ua = navigator.userAgent || '';
  const inApp = isInAppWebView(ua);
  const ticket = inApp ? net.handoverTicket() : '';
  const href = ticket ? handoverHref(ticket, 'google') : '';
  return { inApp, android: isAndroid(ua), handoverUrl: href, intent: href ? chromeIntent(href) : '' };
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
async function showAwayInbox() {
  try {
    const items = await loadInbox();
    const shown = items.filter((row) => applyInboxPush(row)).slice(0, 3);
    const line = shown.map((row) => applyInboxPush(row)).join(' · ');
    const cheerRow = shown.find((row) => row.kind === 'cheer' && row.slot_id && row.from);
    if (line) ui.setNextLine(line, cheerRow ? { slot: cheerRow.slot_id, to: cheerRow.from } : '');
  } catch { /* the square still opens when the inbox is down */ }
}

async function pullProfile() {
  try {
    const p = await loadProfile();
    if (!p || p.err || p.species == null) return;
    const reputation = Math.max(0, Math.floor(Number(p.reputation) || 0));
    state.profile = {
      level: Math.min(99, 1 + Math.floor(reputation / 10)),
      reputation,
      equip: Array.isArray(p.equip) ? p.equip.slice(0, 4) : [],
      owned: Array.isArray(p.owned) ? p.owned.slice(0, 12) : [],
    };
    state.species = setSpecies(p.species);
    keep(SPECIES_KEY, String(state.species));
    if (isColor(p.color)) {
      state.color = p.color;
      keep(COLOR_KEY, state.color);
      world?.setColor(state.color);
    }
    world?.setSpecies(state.species);
    world?.setEquip(state.profile.equip);
    state.starterUsed = p.starter === true;
    ui.noteServerAttend?.(p.streak, p.attend_last);
    ui.refreshProfile();
  } catch { /* the square still opens when the profile is down */ }
}
async function wear(id) {
  try {
    const res = await equip(id);
    if (!res || res.ok === false) {
      ui.note(res?.error === 'missing' ? '아직 없는 꾸미기예요' : '장착하지 못했어요', 'err');
      return false;
    }
    await pullProfile();
    ui.note('장착했어요', 'ok');
    return true;
  } catch {
    ui.note('장착하지 못했어요', 'err');
    return false;
  }
}
function applyServerProfile(m) {
  if (!m) return;
  if (m.av != null) {
    state.species = setSpecies(m.av);
    keep(SPECIES_KEY, String(state.species));
    world?.setSpecies(state.species);
  }
  if (Array.isArray(m.equip)) {
    state.profile.equip = m.equip.slice(0, 4);
    world?.setEquip(state.profile.equip);
  }
  ui.refreshProfile();
}
async function enter({ nick, color, species }) {
  if (entered) return;
  entered = true;
  startMusic(ballShown ? 'night' : 'plaza');
  state.nick = chars(nick, 16) || state.nick;
  if (isColor(color)) state.color = color;
  if (species != null) state.species = speciesId(species);
  keep(NICK_KEY, state.nick);
  keep(COLOR_KEY, state.color);
  keep(SPECIES_KEY, String(state.species));
  world.setName(state.nick);
  world.setColor(state.color);
  world.setSpecies(state.species);
  pullProfile();
  ui.refreshProfile();
  if (!recall('kts_hello')) {
    let left = 8;
    const hello = () => {
      if (recall('kts_hello') || left <= 0) return;
      left -= 1;
      net.sendBonus('hello', BALANCE.firstCoins, state.nick);
      if (left > 0) setTimeout(hello, 2000);
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
    showAwayInbox();
    joinTribeLink();
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
  else if (shower && Date.now() >= welcomeUntil) {
    const left = Math.max(0, Math.ceil((STAR_LIFE - (performance.now() - shower.started)) / 1000));
    world.setTicker(`🌠 별똥별 ${10 - shower.taken.size}개 남음 · ${left}초 · 노란 빛기둥에 서면 +${BALANCE.starCoin}`);
  } else paintCrown();
  ui.setPeople(1 + (net.peers?.size || 0), net.shard || 1);
}, 1000);
setInterval(savePlace, 1000);
window.addEventListener('pagehide', savePlace);
window.addEventListener('beforeunload', savePlace);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') savePlace(); });
setInterval(() => { if (net.status !== 'online' && !document.hidden) resync(); }, 60000);
