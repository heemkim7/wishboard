// Times Square K-점령전 — app wiring: realtime net (DO), 3D world, UI, wallet, world state, star shower.
import { errlogCtx } from './errlog.js?v=202611221803'; // first: its error listeners are on before any other module runs
import { Net, CDN, guestToken } from './net.js?v=202611221803';
import { createTimesSquare, STARTER_COLORS, taxiTrainMult } from './timesSquare3d.js?v=202611221803';
import { speciesId } from './ts3d/avatars.js?v=202611221803';
import { equip, unequip, loadShop, loadProfile, profileSpecies, saveColor, saveNick, saveSpecies, setSpecies } from './profile.js?v=202611221803';
import { starSpot, insideLoop } from './ts3d/layout.js?v=202611221803';
import { createUI } from './ui.js?v=202611221803';
import { haptic, startMusic } from './audio.js?v=202611221803';
import { coinGate, COIN_WAIT_MS, COIN_CAP_MS, isTouchUI } from './interact.js?v=202611221803';
import { BALANCE, PAY, chainsOf, live, monopolyOf, slotName, slotOf, takeGrants, cheerCount, countsAsPlay, josa, slotOpen, SLOT_SOON } from './balance.js';
import { auctionClosed, EQUIP_MAX, OWNED_MAX } from './balance.js';
import { trackEvent } from './analytics.js?v=202611221803';
import { adoptHandover, allowedLink, blockedText, handoverHref, isAndroid, isInAppWebView, loginEmail, CHEER_PHRASES, GT_LS, SESSION_LS, slotTier } from './plaza-account.js';
import { authErrorText, cleanAddress, externalRoutes, oauthErrorText, oauthMessage, oauthReturn, sessionDrift, OAUTH_ACK, OAUTH_CHANNEL } from './plaza-account.js';
import { invCode, inviteFrom, inviteView } from './invite.js';
import { saveClip, dropParams } from './share.js?v=202611221803';
import { ftueDue, crowdFacts, kstDay, lockCelebration, startFtue, wishAutoOpen, wishBootLine, awayRows, inboxUnread, seenAdd, liveKey, liveSeenAdd } from './ftue.js?v=202611221803';
import { photoVerdicts } from './ftue.js?v=202611221803';
import { WISH, cleanWish } from './wish.js';
import { seasonFor, seasonPreview } from './seasons.js';
import { applyInboxPush, loadInbox, readInbox, liveOnly, handledRead, liveSeeable } from './inbox.js?v=202611221803';
import { openTribe, pledge, sendCheer } from './tribe.js?v=202611221803';
import { applyOps, ballNotice, sessionEndPlan, nineBanner, kingMinute, clockSkew, clock, nowMs } from './live.js';
import { pushRoute, awayRead } from './overlay.js?v=202611221803';

adoptHandover(location.search, localStorage);
// Back from a full-page sign-in (the fallback when the Google window could not open): read once here, because supabase-js takes
// ?code= out of the address during net.init(). { code, failed, error, errorCode, description }
const ARRIVED = oauthReturn(location.search, location.hash);
// 친구 초대: ?inv=<code> is kept (kts_inv_from, first one wins) only when this browser had no account of its own before this visit,
// and goes out once with the first wish post. kts_inv_code is my own code, kts_inv_seen the newest reward the away sheet showed.
const INV_FROM_KEY = 'kts_inv_from', INV_CODE_KEY = 'kts_inv_code', INV_SEEN_KEY = 'kts_inv_seen', INV_GOT_KEY = 'kts_inv_got', INV_WAIT_KEY = 'kts_inv_wait';
(() => {
  const c = invCode(new URLSearchParams(location.search).get('inv'));
  if (!c) return;
  let kept = 0;
  try {
    const had = localStorage.getItem(GT_LS) || localStorage.getItem(SESSION_LS) || localStorage.getItem(INV_CODE_KEY) || localStorage.getItem('kts_daily');
    if (!had && !inviteFrom(localStorage.getItem(INV_FROM_KEY))) { localStorage.setItem(INV_FROM_KEY, JSON.stringify({ c, at: Date.now() })); kept = 1; } // forgotten after INVITE.fromDays
  } catch { /* private mode: no invite */ }
  trackEvent('invite_land', { kept });
})();

const NICK_KEY = 'kts_nick';
const COLOR_KEY = 'kts_color';
const SPECIES_KEY = 'kts_species';
const GFX_KEY = 'kts_gfx';
const POS_KEY = 'kts_pos';
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
// ?wish=<id> from a shared wish link (/rt/w/<id> redirects here). Read once at load; removed from the address bar after entering.
const WISH_RE = /^[0-9a-z]{10}$/;
const WISH_ID = (() => {
  const w = new URLSearchParams(location.search).get('wish') || '';
  return WISH_RE.test(w) ? w : '';
})();
let bootData = null, bootHere = null, deepWish = null, deepDay = '';
// 계절 소원 테마 (seasons.js): the KST day's theme, with the ops calendar's theme for today (/rt/world `ops.theme`) laid over the built-in table.
// ?season=<key> only previews a theme's look in this browser ('none' for no theme); it sends and stores nothing.
const SEASON_PREVIEW = seasonPreview(location.search);
const seasonNow = (ops) => seasonFor(kstDay(), SEASON_PREVIEW ?? ops?.theme);
// First screen: only what the server reported. A count that is missing or zero is left out, and with no answer the box is hidden.
function paintBootLive(data, here) {
  bootData = data;
  bootHere = here;
  const box = document.getElementById('bootLive');
  const king = document.getElementById('bootKing');
  const stat = document.getElementById('bootStat');
  const wishEl = document.getElementById('bootWish');
  const seasonEl = document.getElementById('bootSeason');
  if (!box || !king || !stat) return;
  const season = seasonNow(data?.ops);
  if (seasonEl) { seasonEl.textContent = season?.boot || ''; seasonEl.hidden = !season?.boot; seasonEl.style.setProperty('--season', season?.accent || ''); }
  // 오늘의 소원: the linked wish, else yesterday's winner, else today's count from its threshold (ftue.js wishBootLine).
  const wishLine = wishBootLine({ deep: deepWish, ...(data?.wish ?? { board: [], king: null, count: 0 }), day: deepDay || kstDay(), focus: !!FOCUS });
  if (wishEl) { wishEl.textContent = wishLine.text; wishEl.hidden = !wishLine.text; }
  ui.boot?.label?.(wishLine.enter);
  if (!Array.isArray(data?.billboards)) {
    box.hidden = !wishLine.text && !season?.boot;
    king.hidden = true;
    stat.hidden = true;
    return;
  }
  box.hidden = false;
  king.hidden = false;
  stat.hidden = false;
  const boards = data.billboards.filter((b) => slotOf(b.slot_id));
  const main = boards.find((b) => b.slot_id === 'MAIN_TOP');
  const open = boards.filter((b) => !b.holder_id && !auctionClosed(b.slot_id, nowMs())).length;
  // Small counts read as an empty plaza, so each one shows only from its threshold (ftue.js PUBLIC_MIN).
  const { visitors, wishes, crowd } = crowdFacts({ visitors: data.today?.visitors, wishes: data.today?.wishes, crowd: here?.live });
  king.textContent = live(main)
    ? `지금 메인 타워의 소원: ${main.holder_name || '익명'} — "${main.line1 || '소원 대기'}"`
    : main?.holder_id
      ? `메인 타워 정상은 불이 꺼져 있어요 — ${main.holder_name || '이전 주인'}`
      : '메인 타워 정상이 비어 있어요 — 첫 소원을 걸 자리';
  stat.textContent = [
    open ? `지금 걸 수 있는 빈 자리 ${open}곳` : '지금은 빈 자리가 없어요',
    visitors ? `오늘 다녀간 사람 ${visitors.toLocaleString('ko-KR')}명` : '',
    wishes && wishLine.kind !== 'count' ? `오늘 걸린 소원 ${wishes.toLocaleString('ko-KR')}개` : '',
    crowd ? `지금 광장 ${crowd}명` : '',
  ].filter(Boolean).join(' · ');
}
// Server clock minus this clock (live.js clock.off) from the boot /rt/world Date header (clockSkew; 0 when unknown or noisy).
const bootSent = Date.now();
Promise.all([
  fetch('/rt/world', { cache: 'no-store' }).then((r) => { clock.off = clockSkew(r.headers.get('date'), bootSent, Date.now()); return r.json(); }).catch(() => null),
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
  color: isColor(recall(COLOR_KEY)) ? recall(COLOR_KEY) : STARTER_COLORS[Math.floor(Math.random() * STARTER_COLORS.length)], // bright only (avatars.js)
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
  // 주간 리그: week = /rt/world's { week, top:[{ nick, spent }] } (null while that week is empty), league = the last GET /rt/league answer.
  week: null,
  league: null,
  // ponytail: session cheers and ticker lines, a column if they must survive refresh
  cheers: {},
  notes: {},
  vipTickets: 0,
  starterUsed: null,
  // 오늘의 소원. board/king/count come with every /rt/world; the rest from GET /rt/wishes (known once that answered).
  wish: { known: false, at: 0, day: '', board: [], king: null, count: 0, mine: null, left: 0, given: [], top: [], recent: [], yesterday: [], focus: null, miss: '' },
  invite: null, // GET/POST /rt/invite summary once read
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
// linkedGuest: the stored guest (guest:<sub>) as it was when this window linked to its account. actorOps / syncAsked / syncing:
// see syncActor (one actor per window).
let linkedGuest = '', actorOps = 0, syncAsked = false, syncing = false, syncTimer = 0;
// 다녀간 사이 / 🔔: inbox ids seen in this browser, my wish's heart count when I last saw it, the day yesterday's prize was shown.
const INBOX_SEEN_KEY = 'kts_inbox_seen', WISH_SEEN_KEY = 'kts_wish_seen', WISH_PRIZE_KEY = 'kts_wish_prize', INBOX_LIVE_KEY = 'kts_inbox_live';
function readJson(key, dflt) { try { const v = JSON.parse(recall(key) || 'null'); return v ?? dflt; } catch { return dflt; } }
let focusedSlot = '', inboxRows = [], inboxHandled = new Set(), liveNews = [];
let introDone = () => {};
const introReady = new Promise((resolve) => { introDone = resolve; });
let linkWishDone = () => {};
const linkWishClosed = new Promise((resolve) => { linkWishDone = resolve; });
function dropDeep(keys) {
  try {
    const next = dropParams(location.href, keys);
    if (next) history.replaceState(history.state, '', next);
  } catch { /* the link just stays */ }
}

// Start the supabase-js download before the scene build ties up the main thread; net.init() reuses it.
const supaLoaded = import(CDN).then((m) => { globalThis.__SUPA_MOD = m; return true; }).catch(() => false);
const net = new Net();
window.G = { net };
// A shared wish is read before entering with no token, so the boot card can show it without making a guest.
if (WISH_ID) net.wishes(WISH_ID, true).then((r) => {
  const w = r?.focus && WISH_RE.test(String(r.focus.id || '')) ? r.focus : null;
  deepWish = w && !w.hidden ? { id: String(w.id), nick: chars(w.nick, 16), txt: cleanWish(w.txt), hearts: Math.max(0, Math.floor(Number(w.hearts) || 0)), day: String(w.day || '') } : null;
  deepDay = String(r?.day || '');
  if (deepWish && !entered) paintBootLive(bootData, bootHere);
}).catch(() => {});
const netReady = (async () => {
  let ready = false;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try { ready = await net.init(); } catch { ready = false; }
  net.onAuth(() => askSync(0)); // a sign-in or sign-out, this window's or another's: see syncActor
  try { await Promise.race([Promise.all([refreshWallet(), refreshWorld()]), wait(3000)]); } catch { /* wallet shows once the guest token answers */ }
  try { await actorOp(bootAccount); } catch { /* login can finish after the plaza is up */ }
  try {
    if (!state.billboards.length && !state.plots.length) {
      const again = readPlaza();
      if (again) applyPlaza(again);
    }
  } catch { /* a bad local plaza cache must not block login */ }
  return ready;
})();

// The tutorial decides "first visit" from kts_daily as it was before this session's attend() writes streak 1.
const DAILY_BEFORE = (() => { try { return JSON.parse(recall('kts_daily') || 'null'); } catch { return null; } })();
const ui = createUI(document.getElementById('ui'), {
  nick: () => state.nick,
  color: () => state.color,
  species: () => state.species,
  wantSpecies: (id) => world?.wantSpecies?.(id),
  profile: () => state.profile,
  starterUsed: () => state.starterUsed,
  wear: (id) => wear(id),
  unwear: (kind) => unwear(kind),
  shop: () => loadShop(),
  buyCosmetic: (id, price) => buyCosmetic(id, price),
  hasSession: () => !!recall(NICK_KEY),
  actorId: () => net.id,
  isGuest: () => accountReady && !sessionUser,
  linked: () => !!sessionUser,
  email: () => sessionUser?.email || '',
  authEnv,
  oauth: (provider) => startOAuth(provider), // synchronous up to window.open: call it straight from the click
  passwordAuth: (kind, id, password) => passwordSign(kind, id, password),
  // An id or e-mail sign-in (Supabase's 'email' provider), not Google: it has a password of its own to change.
  passwordAccount: () => !!sessionUser && (sessionUser.app_metadata?.provider === 'email' || /@id\.wishboard\.dev$/i.test(sessionUser.email || '')),
  changePassword: async (password) => { try { await net.changePassword(password); } catch (e) { throw new Error(authMessage(e)); } },
  withdraw: () => withdrawAccount(),
  forgetKnown: () => net.forget === true, // what the boot config said about the login being deleted on withdrawal
  forgetLogin: () => net.forgetLogin(), // asked again when the withdrawal sheet opens
  signOut: () => signOutAccount(),
  handoverFired: () => handoverFired(),
  mine: (amount, source = 'cart') => grant(amount, source),
  beginBake: () => beginBake(),
  finishBake: (result) => finishBake(result),
  // A good flip pops a fish from the stall (visual only; the coins come with the session's PAY).
  bakeFlip: (result) => world?.bake?.(result === 'gold' ? BALANCE.bakeGold : BALANCE.bakeGood),
  bakeBusy: () => bakeEnding,
  cartScreen: () => world?.screenOf?.('cart') || null,
  baked: () => noteBakePay(),
  claim: (payload) => claim(payload),
  relight: (slot) => relight(slot),
  adReport: (slot) => net.adReport(slot),
  submitClaim: (payload) => claim(payload),
  sticker: (slot, glyph) => buySticker(slot, glyph),
  washSticker: (slot) => washSticker(slot),
  takeover: (payload) => takeover(payload),
  stickerList: (slot) => world?.stickerList?.(slot) || [],
  revenge: () => { if (!net.sendRevenge()) ui.note('광장에 연결된 뒤에 복수 운임을 켤 수 있어요', 'err'); },
  submitPhoto: (payload) => submitPhoto(payload),
  capture: () => world?.capture() || null,
  saveClip: (opts) => saveClip(document.getElementById('view'), opts),
  // The celebration focus (fireworks) for something just bought; ui falls back to focusShot when this is missing.
  celebrateShot: (slot) => { const pose = world?.focusSlot(slot, { celebrate: true }); if (pose) focusedSlot = String(slot || ''); return pose; },
  publishShot: (blob, ctx) => net.publishShot(blob, ctx),
  // The camera's current board (focus or frame), so a photo of my own board links back to it.
  focusedSlot: () => focusedSlot,
  pinWish: (id) => world?.pinWish?.(id),
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
  // Taps on the touch stick's area go on to the world as canvas taps; built: the city and its collision are in.
  tapDown: (x, y) => world?.tapDown?.(x, y),
  tapUp: (x, y) => world?.tapUp?.(x, y),
  built: () => !!world?.built?.(),
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
  league: () => state.league,
  loadLeague: () => loadLeague(),
  recap: () => net.recap(), // last week's league row for the Monday card (recap.js): one request a week, made by ui.js
  interact: () => world?.interact(),
  enter: (p) => enter(p),
  wishData: () => state.wish,
  loadWishes: (id) => loadWishes(id),
  postWish: (text) => postWish(text),
  heartWish: (id) => heartWish(id),
  reportWish: (id) => reportWish(id),
  wishUrl: (id) => location.origin + '/rt/w/' + encodeURIComponent(id),
  inviteOn: () => inviteIsOn(),
  kakaoKey: () => net.kakaoKey(),
  inviteCode: () => inviteView({ on: inviteIsOn(), code: recall(INV_CODE_KEY) }).code,
  inviteSum: () => state.invite,
  ensureInvite: () => ensureInvite(),
  arrive() {
    if (FOCUS) trackEvent('focus_enter', { slot: FOCUS, ref: FOCUS_REF });
    // Used once: a reload must not replay the gift toast or the focus camera (?tribe= goes after joinTribeLink).
    dropDeep(['focus', 'gift', 'ref']);
    dropDeep(['inv']); // already kept at load (kts_inv_from)
    if (!FOCUS) {
      world?.playIntro();
      // Mark the tutorial before ui's enter handler runs maybeStarterToast, so the two do not compete.
      if (ftueDue(recall('kts_ftue'), DAILY_BEFORE, kstDay())) ui.tutorial?.('start');
      // A shared wish link opens that wish instead; a newcomer without a wish gets the wish sheet before the bake tutorial.
      if (WISH_ID) { landWish(); return; }
      setTimeout(() => { introDone(); afterIntro(); }, 3000);
      return;
    }
    // The link says "이 전광판 앞으로": the avatar goes to the board's front first (a local teleport, like the map's), then
    // the camera looks at the board and stays until the player moves. Fireworks only for a gift link.
    // Entered before the city is built: board positions come from the built city, so the link waits for it (whenBuilt).
    whenBuilt(() => {
      world?.goToSlot?.(FOCUS);
      const pose = world?.focusSlot(FOCUS, { hold: 0, celebrate: false });
      if (!pose) { introDone(); return; }
      focusedSlot = FOCUS;
      if (GIFT) {
        world?.giftPop?.(FOCUS, true);
        ui.note('당신을 위해 준비된 타임스퀘어 스페셜 전광판입니다!', 'ok');
      }
      setTimeout(() => { ui.job({ type: 'focus', slot: FOCUS, board: pose.board || {}, fare: 0 }); introDone(); }, 700);
    }, () => introDone());
  },
  focusShot: (slot) => { const pose = world?.focusSlot(slot); if (pose) focusedSlot = String(slot || ''); return pose; },
  endFocus: () => world?.endFocus(),
  cineOn: () => !!world?.cineOn?.(),
  boardView: (slot) => world?.boardView?.(slot) || null,
  setChannel(n) {
    const ch = Math.max(1, Math.min(8, Math.round(Number(n)) || 1));
    net.join(ch === 1 ? 'square' : 'square-' + ch, world?.netState?.());
    ui.setPeople(1, ch);
  },
  slotCard: (id) => world?.slotCard(id),
  frameBillboard: (slot) => { const ok = world?.frameBillboard?.(slot); if (ok) focusedSlot = String(slot || ''); return ok; },
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
  support: (payload) => supportSend(payload),
});

// 문의하기 (ui.js openSupport, POST /rt/support): the account is the one the token proves (the Worker reads it); the nickname, build id, page
// path and device class go with the inquiry so an account or coin question can be looked up. Errors come back in Korean from the Worker.
const BUILD_ID = (() => { try { return new URL(import.meta.url).searchParams.get('v') || ''; } catch { return ''; } })();
function deviceClass() {
  try { if (!matchMedia('(pointer: coarse)').matches) return 'desktop'; return Math.min(screen.width, screen.height) >= 600 ? 'tablet' : 'phone'; } catch { return ''; }
}
function supportSend(p) {
  return net.authed('/rt/support', { kind: p.kind, text: p.text, email: p.email || '', agree: p.agree === true, nick: state.nick || '', build: BUILD_ID, page: location.pathname, dev: deviceClass() });
}

// 점검 (launch plan 상4): /rt/config carries maint { msg, until } while the operator has it on (admin.html 점검). The boot card shows it in place
// of 입장하기 and asks again every 60 s; inside, every 5 minutes while the tab is visible, and a player inside only gets a toast. No bypass for
// players: ?maint=skip opens the card only in a tab where admin.html kept an ADMIN_KEY the Worker accepts (GET /rt/admin/maint answers 200).
const MAINT_SKIP = (() => {
  let k = ''; try { k = new URLSearchParams(location.search).get('maint') === 'skip' ? sessionStorage.getItem('kts-admin') || '' : ''; } catch { k = ''; }
  return k ? fetch('/rt/admin/maint', { headers: { 'x-admin-key': k }, cache: 'no-store' }).then((r) => r.ok).catch(() => false) : Promise.resolve(false);
})();
let maintSkipTold = false, maintTimer = 0;
async function maintShow(m) {
  if (m && await MAINT_SKIP) { if (!maintSkipTold) { maintSkipTold = true; ui.note('점검 중이지만 운영자 키로 열었어요', 'ok'); } m = null; }
  ui.boot.maint(m);
}
function maintTick() {
  clearTimeout(maintTimer);
  maintTimer = setTimeout(async () => {
    if (!document.hidden) { try { await net.loadConfig(); } catch { /* the last answer stands */ } await maintShow(net.maint); }
    maintTick();
  }, ui.boot.entered() ? 300000 : 60000);
}
// kakaoKey settles when net.init's one /rt/config read has finished (net.js loadConfig): maint and operator are known then.
net.kakaoKey().then(() => { ui.setOperator(net.operator); maintShow(net.maint); maintTick(); }).catch(() => {});

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
    // The world also reports through this hook: a notice line, a tap on a far board, a reached waypoint.
    if (kind === 'notice') { ui.note(info?.text || '', info?.tone || '', info?.reload ? () => location.reload() : undefined); return; }
    if (kind === 'board-far') { ui.farBoard?.(id, info); return; }
    if (kind === 'arrive') { ftueApi?.onWaypoint?.(info); return; }
    if (kind === 'cart') {
      if (info?.near === false) ui.note('붕어빵 포차 앞으로 가까이 가면 구울 수 있어요');
      else ui.startBake();
    } else if (kind === 'atm') {
      // A tap on the ATM from across the square (or from a taxi) is a "take me there", not the hub.
      if (info?.far && info.at) { world?.setWaypoint?.(info.at); ui.note('황금 ATM은 앞에 가면 열려요. 길안내를 켰어요', 'ok'); }
      else ui.openHub();
    }
    // E at a board opens what a tap on that board opens.
    else if (kind === 'board') ui.openAd(id);
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
    else if (kind === 'stand') ui.note(info?.ok ? `택시를 불렀어요! 바로 앞에 정차한 택시 옆에서 ${TOUCH ? '탑승 버튼을 누르세요' : 'E를 누르세요'}` : '지금은 빈 택시가 없어요. 잠시 후 다시 불러 주세요', info?.ok ? 'ok' : 'err');
    else if (kind === 'ring') ui.note('황금 링을 지나가면 코인이 들어와요 · 걸어서도, 택시로도 돼요');
    else if (kind === 'fountain') drawFortune();
    else if (kind === 'lounge') setLounge(true);
    else if (kind === 'adscreen') ui.adCard?.({ ...(world?.adInfo?.(id) || {}), id }, openAdLink);
  },
  onProximity: (near) => { ui.setNear(near); if (near?.kind === 'cart') ftueApi?.onArrive?.(); },
  onStarTouch: (i) => takeStar(i),
  onCoin: (i) => takeCoin(i),
  onHonk: () => ui.sfx.honk(),
  onHorn: () => ui.sfx.honk(),
  onBump: () => { ui.sfx.bump(); haptic(20); },
  onBoost: () => ui.sfx.boost(),
  onJump: () => ui.sfx.whoosh(),
  // Getting in starts the engine (it had no sound); getting out is a door whoosh. Music follows the sound setting (audio.js).
  onDrive: (on) => { if (on) ui.sfx.engine(); else ui.sfx.whoosh(); ui.setDriving(on); startMusic(on ? 'drive' : (ballShown ? 'night' : 'plaza')); },
  onStunt: () => {
    const now = Date.now();
    if (now - stuntAt < PAY.stunt.gapMs) { ui.note(`황금 링은 ${Math.ceil((PAY.stunt.gapMs - (now - stuntAt)) / 1000)}초 뒤에 다시 받아요`); return; }
    if (!payBonus('stunt', PAY.stunt.base)) { ui.note('광장에 연결되면 황금 링 코인이 들어와요', 'err'); return; }
    stuntAt = now;
  },
  onHive: () => { if (!payBonus('hive', PAY.hive.base)) ui.note('광장에 연결되면 하이파이브 코인이 들어와요', 'err'); },
  onBalloon: (hp, wait) => {
    ui.balloon(hp, wait);
    // A tick per hit (the 100 hits stay; only the feedback is new), a longer one when it bursts.
    if (hp > 0 && hp < 1000) haptic(8);
    if (hp !== 0) return;
    haptic(40);
    if (payBonus('pouch', PAY.pouch.base)) return;
    ui.note('광장 서버에 연결되면 코인이 기록됩니다', 'err');
  },
  onWish: (line) => ui.note(`🧧 ${line}`, 'ok'),
  onLoungeEnd: () => setLounge(false),
  onFocus: (on) => { if (!on) focusedSlot = ''; ui.focusLock(on); if (!on) armFtue(); },
  onWaypoint: (wp) => ui.setWaypoint(wp),
  onJob(ev) {
    if (ev.type === 'board' || ev.type === 'chain') { try { net.ch?.raw?.({ t: 'PICK' }); } catch { /* the fare still asks */ } }
    if (ev.type === 'done') ev.sent = payFare(ev.slot || '', ev.riders || 1);
    if (ev.type === 'board' || ev.type === 'chain' || ev.type === 'done') haptic(25);
    ui.job(ev);
    if (ev.type === 'board') trackEvent('taxi_pickup');
    if (ev.type === 'fail' || ev.type === 'abandon') { fareStreak = 0; return; }
    if (ev.type !== 'done' || !ev.slot || !ev.sent) return;
    fareStreak += 1;
    trackEvent('taxi_dropoff', { streak: fareStreak });
    // "하차 완료" waits for the Room's PAY (net.on('pay') kind fare), so a refused fare never reads as done.
    fareSent = { riders: ev.riders || 1, streak: fareStreak };
  },
  onFever(ev) {
    if (ev?.phase === 'count') ui.note('크리스탈볼이 내려옵니다', 'ok');
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
errlogCtx({ tier: String(world?.quality || '') });

let ftueApi = null;
let ftueArmed = false;
let bakeGuided = false;
function armFtue() {
  if (ftueArmed || !entered || !world || wishHold) return;
  ftueArmed = true;
  if (!ftueDue(recall('kts_ftue'), DAILY_BEFORE, kstDay())) { keep('kts_ftue', '1'); ui.tutorial?.('skip'); return; }
  // Tutorial lines go to the newcomer card, so other setNextLine callers cannot overwrite them.
  const tutorUi = Object.assign(Object.create(ui), { setNextLine: (t) => ui.setTutorialLine(t) });
  // Tutorial waypoints are remembered by ui, so a tap on the card can put a cleared one back and the free-slot walk can end the tutorial.
  const tutorWorld = { setWaypoint: (p) => { ui.setTutorialWaypoint?.(p); world?.setWaypoint?.(p); }, boardView: (id) => world?.boardView?.(id), slotCard: (id) => world?.slotCard?.(id) };
  ftueApi = startFtue({ ui: tutorUi, world: tutorWorld, net, balance: BALANCE, touch: TOUCH });
  ui.tutorial?.('start');
  if (ui.nearKind?.() === 'cart') ftueApi.onArrive();
  if (bakeGuided) ftueApi.onBakePay();
}
function noteBakePay() {
  if (bakeGuided) return;
  bakeGuided = true;
  keep('kts_ftue', '1');
  // ui marks bake pay before the tutorial points at the free slot, so that waypoint counts as the last walk.
  ui.tutorial?.('bakePay');
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
let fareSent = null; // the last fare sent and not yet answered: { riders, streak }
// The device test html.touch uses (interact.js isTouchUI), for per-device lines.
const TOUCH = isTouchUI({ coarse: matchMedia('(pointer: coarse)').matches, points: navigator.maxTouchPoints });
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
    ui.note('관람을 마쳤어요. 시점이 캐릭터에게 돌아와요.');
    return;
  }
  // The world refuses in a taxi (and says why); nothing else changes then.
  if (world.startLounge() === false) { loungeOn = false; return; }
  loungeSum = 0;
  loungeTold = false;
  ui.lounge(true, 0);
  ui.note('전광판 관람을 켰어요. 캐릭터는 제자리에 있고 카메라만 8초마다 다음 전광판으로 가요. 20초마다 +2 · 움직이면 돌아와요.', 'ok');
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
// 밤 9시 (live.js): the countdown banner 20:50–21:10 and yesterday's wish king on the boards 21:00–21:01, from this clock
// plus clock.off (nowMs). No server call; the banner never opens a sheet by itself.
let kingShown = false;
function tickNine() {
  const t = nowMs();
  ui.setNine?.(nineBanner(t));
  const on = kingMinute(t, state.wish.king);
  if (on || kingShown) { world?.setKing?.(on ? state.wish.king : null); kingShown = on; }
}
setInterval(tickNine, 1000);

// The Room's PAY goes into the wallet here, and only here (with the hello/attend grants above). from: where the coins
// fly from ('me', 'cart'); quiet: no flight, the wallet only bumps (a ground coin already showed its "+1").
function creditNow(n, play = false, from = 'me', quiet = false) {
  const amount = Math.floor(Number(n));
  if (!Number.isInteger(amount) || amount < 1) return 0;
  state.grants.push({ n: amount, at: Date.now() });
  state.pending = pendingSum();
  if (play) state.earned = (state.earned || 0) + amount;
  ui.setWallet(state, { bump: quiet });
  if (!quiet) ui.flyCoins?.(Math.min(amount, 40), world?.screenOf?.(from));
  return amount;
}

function payFare(slot, riders = 1) {
  if (!/^(MAIN_|SUB_|STREET_|PLOT_)/.test(String(slot || ''))) { ui.note('전광판 앞에서 내려야 운임이 들어와요', 'err'); return false; }
  if (!net.sendFare(25, state.nick, slot, riders)) { ui.note('광장 서버에 연결되면 운임이 코인으로 기록됩니다', 'err'); return false; }
  return true;
}

function adClick(slot, url) {
  if (!/^https:\/\//.test(String(url || ''))) return;
  const go = () => {
    trackEvent('outlink_click', { slot: String(slot || '') });
    window.open(url, '_blank', 'noopener');
    if (!net.sendAdClick(state.nick, slot)) { ui.note('링크는 열렸고, 보너스 코인은 광장 연결 후 기록됩니다', 'err'); return; }
  };
  // In-app browsers (KakaoTalk, Instagram, ...) often open the link over the game in the same view. Save where the avatar
  // stands first, and ask with one tappable line; the tap is the gesture that opens it.
  if (isInAppWebView(navigator.userAgent)) {
    savePlace();
    let where = '';
    try { where = new URL(url).hostname.replace(/^www\./, ''); } catch { where = ''; }
    ui.note(`${where || '게임 밖'} 링크로 나가요. 광장 자리는 저장했어요 · 눌러서 열기`, '', go);
    return;
  }
  go();
}

const FORTUNES = [
  '🥠 네온이 네 소원 쪽으로 기울어 있어요.',
  '🥠 빈 명당이 너를 기다리고 있었어요.',
  '🥠 빨간 계단이 잠깐 네 편을 들어요.',
  '🥠 가장 밝은 화면이 네 이름을 연습 중이에요.',
  '🥠 보낸 마음이 전광판보다 먼저 도착해요.',
  '🥠 월요일이 한 박자 늦습니다.',
  '🥠 추첨 번호표가 주머니에서 따뜻해요.',
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
  inboxRows = items;
  // News that came live this session is shown even before the room has stored its row.
  const rows = [...liveOnly(liveNews, items), ...items].map((row) => ({
    id: row.id || 0,
    text: applyInboxPush(row),
    slot: String(row.slot_id || ''),
    from: row.kind === 'cheer' ? String(row.from || '') : '',
  })).filter((row) => row.text);
  // Read is sent in the background: a failed send must not hide the list or keep the 🔔 lit.
  readInbox(items.filter((row) => !row.read).map((row) => row.id)).catch(() => {});
  liveNews = [];
  markInboxSeen(items.map((row) => row.id));
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
    dropDeep(['tribe']); // only once the join went through; a failed one can be retried with a reload
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
    if (kept.length < state.grants.length) ui.note('서버에 기록되지 않은 코인이 지갑에서 빠졌어요. 연결 표시가 초록색일 때 번 코인은 그대로 남아요', 'err');
    state.grants = kept;
    state.confirmed = coins;
    state.vipTickets = Number(w.vip_tickets) || 0;
    state.walletKnown = true;
    state.pending = pendingSum();
    ui.setWallet(state);
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

// Every claim that puts my words on a board gets the one celebration focus (camera on the board, fireworks). The wizard's
// first claim also ends the tutorial and holds other pop-ups back for five seconds; ui.js then shows the proof bar, or only
// a notice when the player has walked on meanwhile.
function celebrateClaim(slot, wizard) {
  if (wizard) {
    // End the tutorial first: graduating with it still on would leave its line on the full HUD.
    ui.tutorial?.('claim');
    ui.graduate?.();
    ui.setQuietBlock(true);
  }
  if (world.focusSlot(slot, { celebrate: true })) focusedSlot = String(slot || '');
  if (!wizard) return;
  const ms = lockCelebration(5000);
  setTimeout(() => ui.setQuietBlock(false), ms);
}

async function claim(payload) {
  // A board without a database row yet (STREET_31..50 before the migration) is never sent: the Worker would refuse it too.
  if (payload?.slot_id && !slotOpen(state.billboards, payload.slot_id)) throw new Error(SLOT_SOON);
  if (blockedText(state.nick) || blockedText(payload?.line1) || blockedText(payload?.line2) || blockedText(payload?.line3)) {
    throw new Error('그 문구는 올릴 수 없어요');
  }
  const link = payload?.external_url ? allowedLink(payload.external_url) : payload?.external_url;
  const res = await net.claimBillboard({ ...payload, external_url: link || '', nickname: state.nick });
  if (res?.review_id) {
    settle(res);
    if (payload?.mode !== 'tribe') leagueSoon();
    ui.setNextLine('검수 대기');
    ui.note('S급은 확인 후 켜집니다. 거절되면 낸 코인이 그대로 돌아와요.', 'ok');
    return res;
  }
  if (res?.data) {
    if (payload?.mode !== 'edit') { res.data.photo_id = null; res.data.photo_status = null; }
    upsert(state.billboards, 'slot_id', res.data);
    haptic(30); // claimed (U5 haptics: behind the sound setting)
    world.updateBillboardTexture(res.data.slot_id || payload.slot_id, res.data, true);
    const paid = Math.floor(Number(payload?.bid)) || 0;
    if (net.id && paid > 0) {
      const row = state.ranks.find((r) => r.actor_id === net.id);
      if (row) row.spent = Number(row.spent) + paid;
      else state.ranks.push({ actor_id: net.id, nickname: state.nick, spent: paid, linked: !!sessionUser });
      state.ranks.sort((a, b) => Number(b.spent) - Number(a.spent));
    }
    if (paid > 0 && payload?.mode !== 'tribe' && payload?.mode !== 'edit') leagueSoon();
  }
  settle(res);
  if (res?.ok !== false && res?.data) {
    trackEvent('board_claim', { tier: slotTier(res.data.slot_id || payload?.slot_id) });
    const mode = payload?.mode;
    // The profile pull that reports starter use comes later; without this the free-slot toast would offer a second one.
    if (mode === 'starter') state.starterUsed = true;
    if (mode !== 'edit') celebrateClaim(res.data.slot_id || payload?.slot_id, mode === 'starter' || mode === 'claim');
    if (mode === 'starter' || mode === 'claim') ui.noteClaim?.(); // the week's record (recap.js) and the home-screen card (install.js)
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
  leagueSoon();
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
  if (pay === 'coins') leagueSoon();
  ui.note('60초 동안 모든 전광판을 장악했어요', 'ok');
  return res;
}

async function submitPhoto(payload) {
  const res = await net.submitBillboardPhoto({ ...payload, nickname: state.nick });
  if (res?.data) {
    upsert(state.billboards, 'slot_id', res.data);
    world.updateBillboardTexture(res.data.slot_id || payload.slot_id, res.data, false);
    photoRemember(res.data);
  }
  settle(res);
  if (res?.data) leagueSoon();
  return res;
}

// Photo review results. The review can come hours later, often while the player is away, so the photo sent from this device
// is remembered (kts_photo_wait, ftue.js photoVerdicts) and the result is told once: a toast that opens the board, the HUD line,
// and the photo row of the billboard sheet. A result seen live (onWorldUpdate) goes the same way.
const PHOTO_WAIT_KEY = 'kts_photo_wait';
const photoSaid = new Set();
function photoRemember(row) {
  if (!row?.slot_id || !row.photo_id || row.photo_status !== 'pending') return;
  const list = readJson(PHOTO_WAIT_KEY, []);
  const rest = (Array.isArray(list) ? list : []).filter((w) => w?.slot !== row.slot_id);
  keep(PHOTO_WAIT_KEY, JSON.stringify([...rest, { slot: row.slot_id, id: row.photo_id, who: net.id, at: Date.now() }].slice(-8)));
}
function tellPhoto(slot, id, kind) {
  const key = `${slot}|${id}|${kind}`;
  if (!slot || photoSaid.has(key)) return;
  photoSaid.add(key);
  const list = readJson(PHOTO_WAIT_KEY, []);
  if (Array.isArray(list)) keep(PHOTO_WAIT_KEY, JSON.stringify(list.filter((w) => !(w?.slot === slot && w?.id === id))));
  const name = slotName(slot);
  const text = kind === 'on' ? `📷 ${name} 사진 광고가 검수를 통과해 송출 중이에요`
    : kind === 'down' ? `${name}에 송출 중이던 사진이 내려갔어요`
      : kind === 'lost' ? `검수 전에 ${name} 주인이 바뀌어 사진이 내려갔어요. 사진 요금은 돌아왔어요`
        : `${name} 사진이 거절됐어요. 사진 요금은 지갑으로 돌아왔어요`;
  ui.photoNews?.(slot, kind, text);
  ui.setNextLine(text);
  // Losing the board has its own notice; the refund line stays on the HUD and in the sheet without a second toast.
  if (kind !== 'lost') ui.note(text, kind === 'on' ? 'ok' : 'err', () => ui.openBillboard(slot));
  if (kind === 'off' || kind === 'lost') refreshWallet();
}
function photoNotice() {
  if (!entered) return;
  const wait = readJson(PHOTO_WAIT_KEY, []);
  if (!Array.isArray(wait) || !wait.length) return;
  const v = photoVerdicts(wait, state.billboards, net.id);
  keep(PHOTO_WAIT_KEY, JSON.stringify(v.wait));
  for (const t of v.told) tellPhoto(t.slot, t.id, t.kind);
}

async function buy(payload) {
  if (blockedText(state.nick) || blockedText(payload?.sign_text)) throw new Error('그 문구는 올릴 수 없어요');
  const res = await net.buyPlot({ ...payload, nickname: state.nick });
  if (res?.data) {
    upsert(state.plots, 'plot_id', res.data);
    world.applyPlot(res.data, true);
  }
  settle(res);
  if (res?.ok !== false && res?.data) { ui.promptLink?.('own'); leagueSoon(); }
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
      ...(j.wish && typeof j.wish === 'object' ? { wish: j.wish } : {}),
      ...(j.league && typeof j.league === 'object' ? { league: j.league } : {}),
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
      ...(remote.wish ? { wish: remote.wish } : {}),
      ...(remote.league ? { league: remote.league } : {}),
    }));
  } catch { /* private mode */ }
}
let chainReady = false, chainSeen = new Set();
function noteChains() {
  const list = chainsOf(state.billboards);
  if (!chainReady) { chainSeen = new Set(list.map((c) => c.id)); chainReady = true; return; }
  for (const c of list) if (!chainSeen.has(c.id)) ui.note(`${c.name}님이 ${josa(c.building, '을', '를')} 완전 점령했습니다. 그 건물 응원은 +${BALANCE.cheerGroup}`, 'ok');
  chainSeen = new Set(list.map((c) => c.id));
}
function applyPlaza(remote) {
  if (!remote) return;
  state.billboards = (remote.billboards || []).filter((b) => slotOf(b.slot_id));
  noteChains();
  state.plots = remote.plots || [];
  if (Array.isArray(remote.ranks)) state.ranks = remote.ranks;
  state.week = remote.league && typeof remote.league === 'object' && Array.isArray(remote.league.top) ? remote.league : null; // a missing key is an empty week
  if (remote.today) state.today = { visitors: Math.max(0, Math.floor(Number(remote.today.visitors) || 0)), wishes: Math.max(0, Math.floor(Number(remote.today.wishes) || 0)) };
  if (typeof remote.roof === 'string') state.roof = remote.roof;
  applyWishWorld(remote.wish);
  const opsCopy = applyOps(remote.ops);
  state.ops = opsCopy ? { copy: opsCopy, theme: String(remote.ops.theme || '') } : null;
  applySeason();
  if (opsCopy) ui.setNextLine(opsCopy);
  for (const row of state.billboards) {
    if (state.cheers[row.slot_id]) row.cheers = state.cheers[row.slot_id];
    if (state.notes[row.slot_id]) row.notes = state.notes[row.slot_id];
  }
  ui.setWorld(state);
  world.updateWorld(state);
  world.setAds?.(remote.ads); // 광고 화면 (adsale.js adWorld checks it; a missing key is off and empty)
  world.setMonopoly?.(!!monopolyOf(state.billboards));
  markMine();
  paintCrown();
  photoNotice();
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// 광고 화면: the link opens at once (in the tap, so no popup blocker), the click is counted behind it. A sampled session
// reports every 2 minutes the bookings it had in view and has not reported yet; nothing is sent while none is booked.
function openAdLink(ad) {
  if (!ad?.u || !ad.id) return;
  try { window.open(ad.u, '_blank', 'noopener,noreferrer'); } catch { /* blocked: nothing to count */ return; }
  net._plazaPost('/rt/ads/click', { b: ad.id }).catch(() => { });
}
// An id counts as reported only once the Worker took the report; a failed one is tried once more 20 s later, then waits for the next round.
const adSent = new Set();
let adSending = false;
async function sendAdSeen(ids, retry) {
  if (!ids.length) return;
  // A 204 (no count: this Worker isolate does not know the booking yet) and the ids in `keep` (a day booking reported in the
  // 9 pm sponsor minute) stay unsent and go again next round; everything else was counted or was already counted today.
  try { const r = await net._plazaPost('/rt/ads/seen', { b: ids }); if (typeof r?.n !== 'number') return; const keep = new Set(Array.isArray(r.keep) ? r.keep : []); for (const id of ids) if (!keep.has(id)) adSent.add(id); }
  catch { if (retry) { await sleep(20000); await sendAdSeen(ids.filter((id) => !adSent.has(id)), false); } }
}
setInterval(() => {
  if (adSending) return;
  const ids = (world?.adSeen?.() || []).filter((id) => !adSent.has(id)).slice(0, 6);
  if (!ids.length) return;
  adSending = true;
  sendAdSeen(ids, true).finally(() => { adSending = false; });
}, 120000);

async function refreshWorld() {
  try {
    const remote = await net.world();
    writePlaza(remote);
    applyPlaza(remote);
  } catch { /* keep the cached plaza */ }
}
// 주간 리그: GET /rt/league when the 🏆 sheet opens and 1.5 s after my own spend (the Worker tallies it in waitUntil). Never on a timer.
// One request at a time; resolves to the fresh answer or null.
let leagueJob = null, leagueT = 0;
function loadLeague() {
  if (leagueJob) return leagueJob;
  leagueJob = net.league().then((r) => { if (r) { state.league = r; ui.setWorld(state); } return r; }).catch(() => null).finally(() => { leagueJob = null; });
  return leagueJob;
}
function leagueSoon() { clearTimeout(leagueT); leagueT = setTimeout(() => { loadLeague(); }, 1500); }

// ---- 오늘의 소원 ------------------------------------------------------------------------
// No timer refetches wishes (daily request budget): /rt/world carries the board, GET /rt/wishes runs once after entering,
// when the sheet opens (5 s cache), and after a post. Hearts and reports patch the local copy from the POST answer.
const wishRow = (w) => (w && typeof w === 'object' && WISH_RE.test(String(w.id || ''))
  ? { ...w, id: String(w.id), nick: chars(w.nick, 16), txt: cleanWish(w.txt), hearts: Math.max(0, Math.floor(Number(w.hearts) || 0)) }
  : null);
const wishRows = (list, max) => (Array.isArray(list) ? list : []).map(wishRow).filter(Boolean).slice(0, max);
// The season is worked out again wherever the wish state is repainted (also after 0시 KST, wishStale), and told only when its key changes.
let seasonKeyNow = '';
function applySeason() {
  const s = seasonNow(state.ops);
  const key = s?.key || '';
  state.season = key;
  ui.setSeason?.(s);
  if (world && key !== seasonKeyNow) { seasonKeyNow = key; world.setSeason?.(key); }
}
function paintWish() {
  applySeason();
  world?.setWishes?.(state.wish.board.map((w) => ({ id: w.id, nick: w.nick, txt: w.txt, hearts: w.hearts })));
  ui.setWish?.(state.wish);
}
function applyWishWorld(src) {
  const w = src ?? { board: [], king: null, count: 0 };
  state.wish.board = wishRows(w.board, WISH.boardMax);
  state.wish.king = w.king?.txt ? { nick: chars(w.king.nick, 16), txt: cleanWish(w.king.txt), hearts: Math.max(0, Math.floor(Number(w.king.hearts) || 0)) } : null;
  state.wish.count = Math.max(0, Math.floor(Number(w.count)) || 0);
  wishStale();
  paintWish();
}
function mergeWishes(r, id) {
  const w = state.wish;
  w.known = true;
  w.busy = r.busy === true; // budget hard: a copy without my wish; the sheet offers no form or hearts
  w.at = Date.now();
  w.day = String(r.day || '');
  w.top = wishRows(r.top, WISH.topMax);
  w.recent = wishRows(r.recent, WISH.recentMax);
  w.mine = r.mine ? wishRow({ ...r.mine, mine: true }) : null;
  w.left = Math.max(0, Math.floor(Number(r.left)) || 0);
  w.given = Array.isArray(r.given) ? r.given.map(String) : [];
  w.yesterday = (Array.isArray(r.yesterday) ? r.yesterday : []).slice(0, 3).map((y) => ({
    id: String(y?.id || ''), rank: Math.floor(Number(y?.rank)) || 0, nick: chars(y?.nick, 16), txt: cleanWish(y?.txt),
    hearts: Math.max(0, Math.floor(Number(y?.hearts) || 0)), prize: Math.max(0, Math.floor(Number(y?.prize) || 0)), mine: !!y?.mine,
  })).filter((y) => y.txt);
  if (Number.isFinite(Number(r.count))) w.count = Math.max(0, Math.floor(Number(r.count)));
  if (id) {
    w.focus = r.focus && !r.focus.hidden ? wishRow(r.focus) : null;
    w.miss = w.focus ? '' : id; // an unknown or hidden linked wish: one line in the sheet, no refetch on every open
  }
  paintWish();
}
// One request in flight per id. A forced reload (after a post) waits for the current one, so it never gets an answer
// that started before the POST. After 0시 KST the copy is stale: it is marked unknown and the next open refetches.
let wishLoad = null, wishLoadId = '';
function wishStale() {
  const w = state.wish;
  if (!w.known || !w.day || w.day === kstDay()) return false;
  Object.assign(w, { known: false, mine: null, given: [], left: 0, top: [], recent: [], yesterday: [], focus: null, miss: '' });
  return true;
}
function loadWishes(id = '', force = false) {
  const w = state.wish;
  if (wishStale()) paintWish();
  const fresh = w.known && Date.now() - w.at < 5000 && (!id || w.focus?.id === id || w.miss === id);
  if (!force && fresh) return Promise.resolve(w);
  if (wishLoad && !force && wishLoadId === id) return wishLoad;
  const before = wishLoad;
  const run = (async () => {
    if (before) await before.catch(() => {});
    const r = await net.wishes(id);
    if (r && Array.isArray(r.top)) mergeWishes(r, id);
    else throw new Error('wishes');
    return state.wish;
  })();
  wishLoad = run;
  wishLoadId = id;
  run.catch(() => {}).finally(() => { if (wishLoad === run) { wishLoad = null; wishLoadId = ''; } });
  return run;
}
function patchWish(id, fields) {
  const w = state.wish;
  for (const list of [w.board, w.top, w.recent]) for (const row of list) if (row.id === id) Object.assign(row, fields);
  if (w.focus?.id === id) Object.assign(w.focus, fields);
  if (w.mine?.id === id) Object.assign(w.mine, fields);
}
// true when the wish is new to this client (the socket and the POST answer both bring my own new wish).
function addWish(row) {
  const w = state.wish;
  if (w.board.some((x) => x.id === row.id) || w.recent.some((x) => x.id === row.id) || w.top.some((x) => x.id === row.id)) { patchWish(row.id, { txt: row.txt, nick: row.nick }); return false; }
  w.board = [row, ...w.board].slice(0, WISH.boardMax);
  w.recent = [{ ...row }, ...w.recent].slice(0, WISH.recentMax);
  w.count += 1;
  return true;
}
let wishSending = '';
async function postWish(text) {
  const line = cleanWish(text);
  wishSending = line;
  let res;
  const inv = inviteView({ on: inviteIsOn(), from: inviteFrom(recall(INV_FROM_KEY)) }).send; // '' once older than 7 days, or while the switch is off (then kept)
  try { res = await (inv ? net.postWishInv(line, state.nick, inv) : net.postWish(line, state.nick)); } finally { wishSending = ''; }
  if (!res?.ok || !res.wish) return res || { ok: false, error: '소원을 걸지 못했어요. 잠시 뒤 다시 해 주세요.' };
  if (inv) { try { localStorage.removeItem(INV_FROM_KEY); } catch { /* private mode */ } if (res.fresh) watchInviteGift(); }
  if (res.fresh) ensureInvite(); // my own link carries my code from the first share on
  const mine = wishRow({ ...res.wish, mine: true });
  if (mine) {
    state.wish.known = true;
    state.wish.mine = mine;
    if (!addWish({ ...mine })) patchWish(mine.id, { txt: mine.txt, mine: true });
    paintWish();
    loadWishes('', true).catch(() => {}); // the rank comes from the list
  }
  return res;
}
// 친구 초대. My code: POST /rt/invite once (one request in flight), cached in kts_inv_code. readInvite: the GET summary; no code there drops the cache.
let invAsk = null;
// The master switch: /rt/config carried invite: true (the Worker's INVITE_ON). Off: no code, no lines, no polls; a landing ?inv= is still kept 7 days.
const inviteIsOn = () => net.inviteOn === true;
function ensureInvite() {
  if (!inviteIsOn()) return Promise.resolve('');
  const have = invCode(recall(INV_CODE_KEY));
  if (have) return Promise.resolve(have);
  if (!invAsk) invAsk = net.invite(true).then((s) => { if (s) state.invite = s; if (invCode(s?.code)) keep(INV_CODE_KEY, s.code); return invCode(s?.code); }).finally(() => { invAsk = null; });
  return invAsk;
}
async function readInvite() {
  if (!inviteIsOn()) return null;
  const s = await net.invite(false);
  if (!s) return null;
  state.invite = s;
  if (invCode(s.code)) keep(INV_CODE_KEY, s.code);
  else if (!invAsk) { try { localStorage.removeItem(INV_CODE_KEY); } catch { /* private mode */ } }
  return s;
}
// The invitee's gift is paid after the post answered (again later when the wallet row was late): look at 8 s, 70 s, 140 s and 280 s. On a full
// day the pair waits for a later day, so until the gift shows (kts_inv_wait, 8 days) each entry looks once more (inviteGiftOnEntry).
function inviteGiftShown(s) {
  const gift = Math.max(0, Math.floor(Number(s?.gift) || 0));
  if (!(gift > 0)) return false;
  try { localStorage.removeItem(INV_WAIT_KEY); } catch { /* private mode */ }
  if (recall(INV_GOT_KEY)) return true;
  keep(INV_GOT_KEY, '1');
  ui.note(`초대 선물 ${gift}코인을 받았어요`, 'ok');
  trackEvent('invite_reward', { side: 'invitee', amount: gift });
  refreshWallet().catch(() => {});
  return true;
}
function watchInviteGift() {
  const at = [8000, 70000, 140000, 280000];
  let i = 0;
  keep(INV_WAIT_KEY, String(Date.now()));
  const look = async () => {
    if (inviteGiftShown(await readInvite().catch(() => null))) return;
    i += 1;
    if (i < at.length) setTimeout(look, at[i] - at[i - 1]);
  };
  setTimeout(look, at[0]);
}
function inviteGiftOnEntry() {
  if (!inviteIsOn()) return;
  const w = Number(recall(INV_WAIT_KEY)) || 0;
  if (!w) return;
  if (Date.now() - w > 8 * 864e5 || recall(INV_GOT_KEY)) { try { localStorage.removeItem(INV_WAIT_KEY); } catch { /* private mode */ } return; }
  setTimeout(() => { readInvite().then(inviteGiftShown).catch(() => {}); }, 6000);
}
async function heartWish(id) {
  const res = await net.heartWish(id);
  if (res?.ok) {
    patchWish(id, { hearts: Math.max(0, Math.floor(Number(res.hearts) || 0)) });
    state.wish.left = Math.max(0, Math.floor(Number(res.left)) || 0);
    if (!state.wish.given.includes(id)) state.wish.given.push(id);
    paintWish();
  }
  return res;
}
async function reportWish(id) {
  const res = await net.reportWish(id);
  if (res?.ok) {
    const w = state.wish;
    w.board = w.board.filter((x) => x.id !== id);
    w.top = w.top.filter((x) => x.id !== id);
    w.recent = w.recent.filter((x) => x.id !== id);
    paintWish();
  }
  return res;
}
function dropWishParam() {
  try {
    const u = new URL(location.href);
    if (!u.searchParams.has('wish')) return;
    u.searchParams.delete('wish');
    history.replaceState(history.state, '', u.pathname + u.search + u.hash);
  } catch { /* the link just stays */ }
}
// While the wish sheet that opened on arrival is up, the bake tutorial waits; it starts once that sheet closes.
let wishHold = false, wishBoot = null;
function releaseWish() { wishHold = false; armFtue(); }
async function landWish() {
  trackEvent('wish_land', { found: deepWish ? 1 : 0 });
  introDone();
  dropWishParam();
  wishHold = true;
  await sleep(1200);
  await Promise.race([wishBoot || loadWishes(WISH_ID, true), sleep(4000)]).catch(() => {});
  if (ui.openWish) ui.openWish({ focus: WISH_ID, from: 'link', onClose: () => { releaseWish(); linkWishDone(); } });
  else { releaseWish(); linkWishDone(); }
}
async function afterIntro() {
  // kts_wish_skip: the wish sheet was closed without a wish earlier this session; it does not open by itself again.
  let skipped = false;
  try { skipped = sessionStorage.getItem('kts_wish_skip') === '1'; } catch { /* private mode: the card still asks */ }
  if (wishAutoOpen({ newbie: ui.isNewbie?.(), known: state.wish.known, mine: !!state.wish.mine, deep: !!(WISH_ID || FOCUS), skipped })) {
    if (!state.wish.known) await Promise.race([wishBoot || loadWishes(), sleep(2500)]).catch(() => {});
    if (!state.wish.mine && !ui.isBusy?.() && ui.openWish) {
      wishHold = true;
      ui.openWish({ from: 'auto', onClose: releaseWish });
      return;
    }
  }
  armFtue();
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
    // Star beams are the amber of coin rewards; the guide is the cyan waypoint, so the line names neither colour.
    headline(`🌠 별똥별 10개 · ${Math.round(STAR_LIFE / 1000)}초 · 별똥별 빛기둥에 서면 +${BALANCE.starCoin}`);
    ui.note(`별똥별 ${Math.round(STAR_LIFE / 1000)}초 · 누르면 가장 가까운 별똥별로 길안내`, 'ok', guideStar);
  }
}

// Ground coins: the world fires onCoin every frame the player stands on a visible coin. One MINE at a time and at most
// one per COIN_GAP_MS (interact.js coinGate). The coin hides at once with a "+1" and a tick; PAY puts the coin in the
// wallet and starts its 20 s respawn; a refusal or no answer in COIN_WAIT_MS puts it back without a word.
const coin = { at: 0, wait: false, i: -1, block: 0, timer: 0, offlineAt: 0 };
function coinBack() {
  clearTimeout(coin.timer);
  if (coin.i >= 0) world?.holdCoin?.(coin.i, false);
  coin.i = -1;
  coin.wait = false;
}
function takeCoin(i) {
  const now = Date.now();
  if (!coinGate(coin, now)) return;
  if (!net.sendMine(1, state.nick)) {
    // Offline: say it once in a while, not every frame.
    if (now - coin.offlineAt > 8000) { coin.offlineAt = now; ui.note('광장에 연결되면 동전을 주울 수 있어요', 'err'); }
    coin.at = now;
    return;
  }
  coin.at = now;
  coin.wait = true;
  coin.i = i;
  const at = world?.holdCoin?.(i, true);
  if (at?.visible !== false) ui.pop?.(1, false, at || undefined);
  ui.sfx.tick();
  haptic(10);
  clearTimeout(coin.timer);
  coin.timer = setTimeout(coinBack, COIN_WAIT_MS);
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

// Stars do not wait for the shared 2.2 s cooldown (bake, cheer, fortune): only an open sheet or game holds them.
function takeStar(i) {
  if (!shower || shower.taken.has(i)) return;
  const told = performance.now() - (takeStar.at || 0) > 1200;
  if (ui.isBusy()) {
    if (told) { takeStar.at = performance.now(); ui.note('별똥별은 지금 동작을 끝내고 주워요'); }
    return;
  }
  if (!payBonus('star', BALANCE.starCoin)) { if (told) { takeStar.at = performance.now(); ui.note('별똥별을 주우려면 광장 서버에 연결되어 있어야 해요', 'err'); } return; }
  shower.taken.add(i);
  haptic(15);
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
    // Refused: the coin comes back quietly. After the hour cap, no MINE for COIN_CAP_MS (one notice a session).
    coinBack();
    if (m.why === 'cap') {
      coin.block = Date.now() + COIN_CAP_MS;
      if (!capTold.has('mine')) { capTold.add('mine'); ui.note('이번 시간에 받을 수 있는 코인을 다 받았어요', 'err'); }
    }
    return;
  }
  if (m?.kind === 'fare' && m?.why) fareSent = null;
  if (m?.why === 'nopick') { ui.note('손님을 태운 뒤에 운임이 들어와요. 손님 기둥에서 속도를 줄이세요', 'err'); return; }
  if (m?.why === 'place') { ui.note('전광판 앞에서 내려야 운임이 들어와요', 'err'); return; }
  if (m?.why === 'dark') { ui.note('켜져 있는 다른 사람 전광판에만 응원할 수 있어요', 'err'); return; }
  if (m?.why === 'wait') { ui.note('잠시 뒤 다시 응원해 주세요', 'err'); return; }
  if (m?.why === 'soon') {
    const wait = {
      fare: `운임은 ${Math.round(PAY.fare.gapMs / 1000)}초에 한 번 들어와요`,
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
  if (m?.kind === 'bake') { bakeEnded(); ui.bakeWait?.(''); }
  const got = creditNow(m?.amount, countsAsPlay(m?.kind), m?.kind === 'bake' ? 'cart' : 'me', m?.kind === 'mine');
  if (m?.kind === 'bake') { noteBakePay(); if (got) ui.note(`붕어빵 +${got}`, 'ok'); }
  if (m?.kind === 'dance' && got) ui.note(`댄스 +${got}`, 'ok');
  if (m?.kind === 'lounge' && got) { loungeSum += got; ui.lounge(true, loungeSum); }
  if (m?.kind === 'shot' && got) { ui.noteShot?.(); ui.note(`공유 +${got}`, 'ok'); }
  if (m?.kind === 'fare' && got) {
    ui.quest?.('fare'); ui.noteFare?.(got); ui.noteLot?.(m.lot); if (m.gauge != null) world?.setFever?.(m.gauge);
    const f = fareSent;
    fareSent = null;
    ui.note(f ? `하차 완료 · ${f.riders}명 · 연속 ${f.streak}명 · 운임 +${got}` : `운임 +${got}`, 'ok');
  }
  if (m?.kind === 'cheer' && got) { ui.quest?.('cheer'); ui.note(`응원 +${got}`, 'ok'); }
  if (m?.kind === 'stunt' && got) { ui.quest?.('stunt'); ui.note(`황금 링 +${got}`, 'ok'); }
  if (m?.kind === 'hive' && got) ui.note(`하이파이브 +${got}`, 'ok');
  if (m?.kind === 'star' && got) ui.note(`별똥별 +${got}`, 'ok');
  if (m?.kind === 'pouch' && got) ui.note(`복주머니 +${got}`, 'ok');
  if (m?.kind === 'mine') {
    // Paid: the coin already showed its "+1"; it now leaves for its 20 s respawn and the wallet bumps.
    clearTimeout(coin.timer);
    if (coin.i >= 0) world?.removeCoin?.(coin.i);
    coin.i = -1;
    coin.wait = false;
  }
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
  if (m && m.ok === false && sessKind === 'bake' && bakeEnding) { bakeEnded(); ui.bakeWait?.(''); }
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
// From the end of the bake rounds until the PAY (or its refusal, or BAKE_PAY_MS): "+6 확인 중" over the cart, and no new
// bake (its SESS start would replace the id this end still needs).
let bakeEnding = false, bakeEndTimer = 0;
const BAKE_PAY_MS = 6000;
function bakeEnded() {
  clearTimeout(bakeEndTimer);
  bakeEnding = false;
}
function finishBake(result) {
  if (!bakeOnline) { ui.note('광장에 연결되어야 붕어빵 코인이 들어와요', 'err'); return false; }
  const started = bakeT || Date.now();
  bakeEnding = true;
  ui.bakeWait?.(`+${result === 'gold' ? BALANCE.bakeGold : BALANCE.bakeGood} 확인 중`);
  const give = () => { bakeEnded(); ui.bakeWait?.(''); };
  const tryEnd = (since) => {
    const plan = sessionEndPlan(bakeId, sessFailed, Date.now() - since, 4000);
    if (plan === 'wait') { setTimeout(() => tryEnd(since), 200); return; }
    if (plan === 'note') { sessFailed = true; give(); ui.note(BAKE_MISS, 'err'); return; }
    if (plan !== 'send') { give(); return; }
    const id = bakeId;
    // The rounds take about 8 s (interact.js BAKE_FLIPS x BAKE_ROUND_MS), so this wait is short; the Room still needs 8 s.
    const rest = Math.max(0, 8600 - (Date.now() - started));
    setTimeout(() => {
      net.sendSess('end', { id, result });
      // No PAY or refusal in time: the chip goes; a late PAY still credits the wallet.
      bakeEndTimer = setTimeout(give, BAKE_PAY_MS);
    }, rest);
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
  if (line) {
    ui.setInboxDot?.(true);
    // Seen live, only when the line could be seen: its stored copy (no id on the socket) will not come back in 다녀간 사이.
    const key = liveSeeable(!!ui.isNewbie?.(), document.visibilityState) ? liveKey(m, Date.now()) : '';
    if (key) keep(INBOX_LIVE_KEY, JSON.stringify(liveSeenAdd(readJson(INBOX_LIVE_KEY, []), key)));
    liveNews = [{ kind: m.kind, slot_id: m.slot_id, phrase: m.phrase, from_name: m.from_name, from: m.from, at: nowMs() }, ...liveNews].slice(0, 10);
  }
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
// Someone posted a new wish (edits are not sent). Mine comes back too: no news line for it.
net.on('wish', (m) => {
  const row = wishRow(m?.w);
  if (!row) return;
  const self = row.id === state.wish.mine?.id || (!!wishSending && row.txt === wishSending);
  if (self) row.mine = true;
  const fresh = addWish(row);
  paintWish();
  if (fresh && !self) ui.news('WISH', { nick: row.nick });
});
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
  // Never a modal: ui queues one tappable notice ("○○님이 △△을 가져갔어요 · 되찾기") until the screen is quiet.
  ui.taken({ slot: m.slot, attacker: m.attacker, price: m.price, line1: m.line1, line2: m.line2, line3: m.line3, emoji: m.emoji });
});
net.on('mono', (m) => { if (m?.name) ui.note(`${m.name}님이 메인 타워 3칸을 모두 독점하여 타임스퀘어를 지배했습니다!`, 'ok'); });
net.on('rev', (m) => {
  const until = Number(m?.until) || 0;
  if (until > Date.now()) { revengeUntil = until; ui.setRevenge?.(until); ui.note('2분 동안 택시 운임이 2배로 들어옵니다', 'ok'); }
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
    ui.note('60초 동안 코인 2배 · 택시 부스트 무제한', 'ok');
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
  if (m.kind === 'views' && row?.holder_id && row.holder_id === net.id && m.by !== net.id) ui.note('방금 다른 유저의 택시가 내 전광판 앞에 손님을 내려줬습니다! (누적 노출 +1)', 'ok');
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
let movedTold = false;
net.on('status', (s) => {
  if (s === 'online') { resync(); movedTold = false; }
  if (queuePos) return;
  if (s === 'online') { ui.setStatus('실시간 연결됨', 'ok'); bindTake(); try { net.ch?.raw?.({ t: 'DRAW_CHECK' }); } catch { /* the next connect asks again */ } }
  else if (s === 'connecting') ui.setStatus('광장 연결 중', 'warn');
  else if (net.ch?.moved) {
    // This account joined from another window, so the room closed this one (net.js keeps it closed until the tab is used again).
    ui.setStatus('다른 창에서 접속 중', 'off');
    if (!movedTold) { movedTold = true; ui.note('다른 창에서 접속해서 이 창은 연결이 끊겼어요', 'err'); }
  }
  else ui.setStatus('혼자 걷는 중', 'off');
});
net.on('gate', (g) => {
  if (g?.ok) errlogCtx({ lean: !!g.lean }); // error reports: one in five while the budget is lean
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
  if (ev?.kind === 'BILLBOARD') photoNotice();
  if (!ev?.kind || ev.replay) return;
  if (sameClaim) {
    // Photos sent from another device are not in kts_photo_wait: the live change tells those (tellPhoto says each once).
    if (ev.data.photo_status === 'approved' && prev.photo_status !== 'approved') {
      headline(`📷 ${chars(ev.data.holder_name || '누군가', 12)}님의 사진 광고 송출 시작!`);
      if (ev.data.holder_id === net.id) tellPhoto(ev.data.slot_id, ev.data.photo_id, 'on');
    } else if (prev.photo_id && !ev.data.photo_id && prev.holder_id === net.id) {
      tellPhoto(ev.data.slot_id, prev.photo_id, prev.photo_status === 'pending' ? 'off' : 'down');
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
  // routes: what to open, in order, to reach the system browser (KakaoTalk's own way out, then the Android intent).
  // routed: this in-app browser has such a way at all, known before the ticket is ready.
  return { inApp, android: isAndroid(ua), handoverUrl: href, routes: href ? externalRoutes(ua, href) : [], routed: inApp && externalRoutes(ua, handoverHref('', '')).length > 0 };
}
function authMessage(e) { return authErrorText(e); }
async function rejoin() {
  const room = net.room;
  const me = world?.netState?.();
  if (!room || !me) return;
  net.room = null;
  try { await net.join(room, me); } catch { /* the socket retries on its own */ }
}
// fresh: the sign-in happened now (a toast says so). echo: it happened in another window and this one only follows (syncActor),
// so it is not counted again.
async function finishLink(session, fresh, echo = false) {
  const user = session?.user;
  if (!user?.id) return null;
  // Already this account here: the same sign-in reached this window twice (its own result and the notice every window gets).
  // sessionUser is set before anything asynchronous below, so a second call can never start a second merge.
  if (sessionUser?.id === user.id) return null;
  sessionUser = user;
  accountReady = true;
  net.id = 'user:' + user.id;
  // The nickname stays the player's own. The provider's profile name (a real name, for Google) is never taken.
  let guest = guestActor();
  if (guest?.id && !guest.token) {
    const issued = await guestToken();
    if (issued?.sub) guest = { id: 'guest:' + issued.sub, token: issued.token || '' };
  }
  linkedGuest = guest?.id || ''; // the stored guest as this account found it (becomeGuest: a new one must not be this one)
  let merged = null;
  const mark = user.id + ':' + (guest?.id || '');
  let mergedMark = '';
  try { mergedMark = sessionStorage.getItem('kts_merged') || ''; } catch { mergedMark = ''; }
  let failed = false;
  if (guest?.id && guest.token && guest.id !== net.id && mergedMark !== mark) {
    try {
      merged = await net.mergeGuest(guest.id, guest.token, state.nick);
      try { sessionStorage.setItem('kts_merged', mark); } catch { /* private mode */ }
    } catch (e) { failed = true; ui.note(authMessage(e), 'err'); } // not kept: the next boot tries again
  }
  if (sessionUser !== user) return merged; // signed out (or another account) while the merge was out: that path paints the window
  ui.setAccount?.({ ready: true, guest: false, linked: true });
  ui.refreshProfile?.();
  try { await refreshWallet(); } catch { /* balance paints on the next sync */ }
  try { await refreshWorld(); } catch { /* boards refresh on the next poll */ }
  if (fresh && !echo) trackEvent('auth_login_success', { method: user.app_metadata?.provider || 'email' });
  if (merged?.bonus) ui.note(`계정을 연결했어요. +${merged.bonus}코인`, 'ok');
  // again: the server's answer on the one link after a withdrawal (no reward, and the guest's start coins stayed out). Said that once.
  else if (merged?.again) ui.note('계정을 연결했어요. 예전에 탈퇴한 계정이라 연결 보상 300코인은 다시 주지 않아요', 'ok');
  else if (fresh && !failed) ui.note('계정을 연결했어요', 'ok'); // after a failed merge the error toast stands alone
  await rejoin();
  return merged;
}
async function bootAccount() {
  const q = new URLSearchParams(location.search);
  let session = null;
  try { session = await net.currentSession(); } catch { session = null; }
  // A handover link (?autologin=google) never starts the sign-in by itself: the sheet opens and the player taps 구글로 계속.
  const resume = q.get('autologin') === 'google' && !session?.user;
  if (session?.user) await finishLink(session, ARRIVED.code); // fresh: this load came back from the full-page sign-in with a code
  else {
    accountReady = true;
    ui.setAccount?.({ ready: true, guest: true, linked: false });
    if (ARRIVED.code && !ARRIVED.failed) ui.note('로그인을 마치지 못했어요. 다시 시도해 주세요.', 'err');
  }
  if (ARRIVED.failed) ui.note(oauthErrorText(ARRIVED), 'err');
  // One-time parameters leave the address: handover, autologin, a code that could not be used, error*.
  try {
    const next = cleanAddress(location.href);
    if (next !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', next);
  } catch { /* the address just stays */ }
  if (resume) ui.openLogin?.({ resume: true });
}

// ---- Google sign-in in a second window -------------------------------------------------------
// startOAuth opens the window inside the click, loads the provider address into it, and waits. The window comes back to /oauth
// (oauth.html), which sends { code } or { error } over BroadcastChannel and window.opener.postMessage. This tab answers, exchanges
// the code (PKCE: the verifier is in localStorage) and finishes the link, so the plaza never unloads.
// One result per attempt; with no attempt pending a message is ignored and oauth.html finishes on its own (/?code=).
const OAUTH_KEEP_MS = 10 * 60000;
let oauthTry = null, oauthChan = null;
// A sign-in error goes on the login sheet's own line. With that sheet closed (the player went on while the Google window was open)
// nobody would read it there, and the sheet clears the line when it opens again: then it is also a toast.
function loginFail(text, more) {
  ui.setLogin?.({ wait: false, text: '', ...more, err: text });
  if (!ui.loginOpen?.()) ui.note?.(text, 'err');
}
// The pending attempt is over without a message from its window (syncActor: the session arrived through another window).
function dropOAuthTry() {
  const t = oauthTry;
  if (!t) return;
  oauthTry = null;
  clearInterval(t.timer);
}
function onOAuthMessage(data, source) {
  const msg = oauthMessage(data);
  const t = oauthTry;
  if (!msg || !t) return;
  oauthTry = null;
  clearInterval(t.timer);
  const ack = { t: OAUTH_ACK };
  try { oauthChan?.postMessage(ack); } catch { /* channel closed */ }
  try { (source || t.w)?.postMessage?.(ack, location.origin); } catch { /* that window is gone */ }
  setTimeout(() => { try { if (!t.w.closed) t.w.close(); } catch { /* it closed itself */ } }, 1500);
  finishOAuth(msg);
}
try { oauthChan = new BroadcastChannel(OAUTH_CHANNEL); oauthChan.onmessage = (e) => onOAuthMessage(e.data, null); } catch { oauthChan = null; }
window.addEventListener('message', (e) => { if (e.origin === location.origin) onOAuthMessage(e.data, e.source); });
// Back from the provider through the browser's back button after the full-page fallback: the button must not stay disabled.
window.addEventListener('pageshow', (e) => { if (e.persisted && !oauthTry) ui.setLogin?.({ wait: false, info: '' }); });
async function finishOAuth(msg) {
  if (msg.error) { loginFail(oauthErrorText(msg)); return; }
  ui.setLogin?.({ wait: true, text: '로그인하는 중…', err: '', info: '' });
  // actorOp: the exchange raises the client's sign-in event in this window too; syncActor waits until this path is done.
  await actorOp(async () => {
    let session = null;
    try { session = await net.exchangeCode(msg.code); }
    catch (e) {
      // The code may have been used already by the window itself (it waited too long for this tab): its session is in shared storage.
      try { session = await net.currentSession(); } catch { session = null; }
      if (!session?.user) { loginFail(authMessage(e)); return; }
    }
    try { await finishLink(session, true); }
    finally { ui.setLogin?.({ wait: false, text: '', err: '', info: '' }); ui.closeLogin?.(); }
  });
}
async function popupOAuth(provider, w) {
  if (oauthTry) clearInterval(oauthTry.timer); // a new attempt replaces the old one (its code verifier is overwritten anyway)
  const t = oauthTry = { w, at: Date.now(), shut: false, timer: 0 };
  ui.setLogin?.({ wait: true, text: '', err: '', info: '' });
  t.timer = setInterval(() => {
    if (oauthTry !== t) { clearInterval(t.timer); return; }
    let closed = false;
    try { closed = !!w.closed; } catch { closed = true; }
    // The player closed the window: the button comes back. The attempt itself stays for a while, because some browsers report a
    // window as closed once it is on another site, and its result can still arrive over BroadcastChannel.
    if (closed && !t.shut) { t.shut = true; ui.setLogin?.({ wait: false, text: '' }); }
    if (Date.now() - t.at > OAUTH_KEEP_MS) { clearInterval(t.timer); oauthTry = null; if (!t.shut) ui.setLogin?.({ wait: false, text: '' }); }
  }, 500);
  try {
    const url = await net.oauthUrl(provider, location.origin + '/oauth');
    if (oauthTry !== t) return;
    w.location = url;
  } catch (e) {
    if (oauthTry === t) { oauthTry = null; clearInterval(t.timer); }
    try { w.close(); } catch { /* already gone */ }
    loginFail(authMessage(e));
  }
}
// The second window was blocked: say so in the sheet, keep the player's place, and let this tab go to the provider (the old path).
async function redirectOAuth(provider) {
  ui.setLogin?.({ wait: true, text: '', err: '', info: '새 창이 막혀 있어 이 화면에서 로그인합니다' });
  savePlace();
  try {
    await sleep(1200); // long enough to read the line
    await net.startOAuth(provider);
    await sleep(8000); // the page should be gone by now; if it is not, the button must not stay disabled
    ui.setLogin?.({ wait: false, text: '', info: '' });
  } catch (e) { loginFail(authMessage(e), { info: '' }); }
}
// Not async: window.open has to run in the same task as the click or the browser blocks it.
function startOAuth(provider) {
  if (provider === 'google' && isInAppWebView(navigator.userAgent)) return; // Google refuses embedded webviews: the sheet hands over instead
  let w = null;
  try { w = window.open('', 'kts_oauth', 'popup,width=480,height=680'); } catch { w = null; }
  if (!w || w.closed) { redirectOAuth(provider); return; }
  try {
    w.document.title = '구글 로그인';
    w.document.body.style.cssText = 'margin:0;height:100vh;display:grid;place-items:center;background:#0a0e1c;color:#f2f4ff;font:500 15px system-ui,sans-serif';
    w.document.body.textContent = '구글 로그인으로 이동하는 중…';
  } catch { /* a reused window that is already on another site */ }
  popupOAuth(provider, w);
}
async function passwordSign(kind, id, password) {
  const email = loginEmail(id);
  if (!email) throw new Error('이메일 또는 아이디를 확인해 주세요');
  if (String(password || '').length < 6) throw new Error('비밀번호는 6자 이상이어야 해요');
  await actorOp(async () => {
    let session;
    try { session = await net.passwordAuth(kind, email, password); }
    catch (e) { throw new Error(authMessage(e)); }
    await finishLink(session, true);
  });
}
// ---- one actor per window ---------------------------------------------------------------------
// The windows of one browser share the Supabase session (localStorage, SESSION_LS) and the stored guest (GT_LS); each window
// keeps its own sessionUser and net.id. When another window changes the shared ones (the Google window became a game window
// and signed in there; 로그아웃 or 탈퇴 in another tab), this window would go on showing the old actor while its requests
// carry the new one's token. syncActor() makes the window follow. It is asked for by the client's sign-in and sign-out
// events (net.onAuth: supabase-js tells every window), by a change of either stored value (the storage event), and whenever
// the page is looked at again.
// actorOp() wraps this window's own paths that change who it is (boot, the Google result, id sign-in, 로그아웃, 탈퇴). While
// one runs, a sync is only noted, and runs once after the last one ended: by then that path has set sessionUser, so the
// event its own sign-in or sign-out raised finds nothing to do. One result per attempt, one merge per sign-in, no loop.
async function actorOp(run) {
  actorOps += 1;
  try { return await run(); }
  finally {
    actorOps -= 1;
    if (!actorOps && syncAsked) askSync(0);
  }
}
function askSync(ms = 300) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncActor, ms);
}
async function syncActor() {
  if (!accountReady || actorOps || syncing) { syncAsked = true; return; }
  syncAsked = false;
  syncing = true;
  try {
    // null: what is stored cannot be told right now (no client, a refresh that failed). Nothing changes here then.
    const stored = await net.storedSession();
    if (actorOps) { syncAsked = true; return; } // a path of this window's own began meanwhile: it decides
    const drift = sessionDrift({ have: sessionUser?.id || '', known: !!stored, user: stored?.session?.user?.id || '' });
    if (drift === 'in' || drift === 'swap') {
      dropOAuthTry(); // the sign-in this window may still be waiting for arrived another way: that attempt is over
      if (drift === 'swap') { sessionUser = null; forgetActor(); }
      try { await finishLink(stored.session, true, true); }
      finally { ui.setLogin?.({ wait: false, text: '', err: '', info: '' }); ui.closeLogin?.(); }
    } else if (drift === 'out') {
      await becomeGuest({ adopt: true });
      ui.note('로그아웃됐어요 · 다시 로그인', '', () => ui.openLogin?.());
    } else if (stored && !sessionUser) {
      // Guests in every window: this one plays as the stored guest. Another window replaced it (its sign-out, a handover it took).
      const g = guestActor();
      if (g?.id && g.token && g.id !== net.id) await becomeGuest({ adopt: true });
    }
  } catch (e) { console.warn('[auth] sync', e?.message || e); }
  finally {
    syncing = false;
    if (syncAsked && !actorOps) askSync(0);
  }
}
window.addEventListener('storage', (e) => { if (e.key === GT_LS || e.key === SESSION_LS || e.key === null) askSync(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') askSync(); });
window.addEventListener('pageshow', (e) => { if (e.persisted) askSync(); }); // back from the page cache: other windows went on meanwhile
// What this window knew about the actor it was until now. The wallet figures go so the next actor's balance is not compared with
// them (coins still pending for the old one would be reported as lost); with them the invite, the league line, the starter
// flag, and in the UI the 소속 chip and the list of boards taken from the old actor.
function forgetActor() {
  walletGen += 1; // a wallet answer still on its way belongs to the old actor
  state.grants = [];
  state.pending = 0;
  state.confirmed = 0;
  state.vipTickets = 0;
  state.walletKnown = false;
  state.invite = null;
  state.league = null;
  state.starterUsed = null;
  inboxRows = []; inboxHandled = new Set(); liveNews = []; // 받은 소식 and its 🔔 dot were the old actor's: the next actor's list is read afresh
  ui.setWallet(state);
  ui.forgetActor?.();
  ui.setInboxDot?.(false);
}
// The new guest another window stored after its sign-out: a stored guest with a token that is not `old` (the one this window's
// account had merged). That window removes the old one first and stores the new one a moment later: up to 3 s of waiting.
async function sharedGuest(old) {
  for (let i = 0; i < 10; i++) {
    let g = null;
    try { g = JSON.parse(localStorage.getItem(GT_LS) || 'null'); } catch { g = null; }
    if (g?.sub && g.token && 'guest:' + g.sub !== old) return g;
    await sleep(300);
  }
  return null;
}
// After a withdrawal or a sign-out this device goes on as a brand-new guest. The stored guest token goes first: that guest was already
// merged into the account, and keeping it would offer the same guest to the next sign-in again. Resolves false when no new guest came.
// adopt: the sign-out happened in another window (syncActor), which makes the new guest; this window takes that one instead of
// making a second, and makes one only when none came. push: false after a withdrawal (its subscriptions were deleted on purpose).
async function becomeGuest({ adopt = false, push = true } = {}) {
  sessionUser = null;
  const old = linkedGuest;
  linkedGuest = '';
  try { sessionStorage.removeItem('kts_merged'); } catch { /* private mode */ }
  forgetActor();
  let g = adopt ? await sharedGuest(old) : null;
  const made = !g;
  if (made) {
    try { localStorage.removeItem(GT_LS); localStorage.removeItem(INV_CODE_KEY); } catch { /* private mode */ }
    g = await guestToken(true);
    if (!g?.sub) { await sleep(1500); g = await guestToken(true); }
  }
  net.id = g?.sub ? 'guest:' + g.sub : Net.cid(); // never keep presenting the account's id
  accountReady = true;
  ui.setAccount?.({ ready: true, guest: true, linked: false });
  ui.refreshProfile?.();
  try { await refreshWallet(); } catch { /* the new guest balance follows */ }
  try { await refreshWorld(); } catch { /* boards clear on the next fetch */ }
  await rejoin();
  if (g?.sub) {
    pullProfile();
    loadWishes('', true).catch(() => {});
    // The browser's push subscription is still bound to the account on the server: post it again as the new guest (POST /rt/push
    // rebinds an endpoint to whoever posts it). An adopted guest was already given it by the window that made it.
    if (made && push) ui.resendPush?.({ force: true });
  }
  return !!g?.sub;
}
// The Worker says whether the login itself was deleted (login: 'deleted') or is still there for the operator to remove ('kept').
async function withdrawAccount() {
  const res = await actorOp(async () => {
    const data = await net.withdrawAccount();
    await becomeGuest({ push: false });
    return data;
  });
  ui.note(res?.login === 'kept' ? '탈퇴했어요. 로그인 정보는 운영자가 확인한 뒤 지웁니다.' : '탈퇴했고, 내 전광판과 토지 소유를 비웠어요', 'ok');
}
// 로그아웃: this device only. Coins, boards and plots stay with the account; signing in again brings them back.
async function signOutAccount() {
  if (!sessionUser) return;
  const ok = await actorOp(async () => {
    try { await net.signOut(); }
    catch (e) { console.warn('[auth] sign-out', e?.message || e); throw new Error('로그아웃하지 못했어요. 연결을 확인하고 다시 해 주세요.'); }
    return becomeGuest();
  });
  ui.note(ok ? '로그아웃했어요. 코인과 전광판은 계정에 남아 있어요' : '로그아웃했어요. 새로고침하면 새 손님으로 이어져요', ok ? 'ok' : 'err');
}
// In-app browser: after the player was sent to the system browser, that browser adopts this guest and links it to an account, which
// moves the coins and boards away. When this page is looked at again, the wallet is read again and, if it was emptied, the player is told.
let handoverAt = 0, handoverHad = null, handoverBusy = false;
function myHoldings() {
  return state.billboards.filter((b) => b.holder_id && b.holder_id === net.id).length + state.plots.filter((p) => p.owner_id && p.owner_id === net.id).length;
}
// What this guest had when the page was last in front (nothing is spent here while it is hidden).
function handoverMark() { handoverHad = { coins: state.walletKnown ? state.confirmed : 0, held: myHoldings() }; }
function handoverFired() {
  handoverAt = Date.now();
  handoverMark();
  savePlace();
}
async function handoverBack() {
  if (!handoverAt || handoverBusy || sessionUser || Date.now() - handoverAt > 30 * 60000) return;
  handoverBusy = true;
  try {
    const had = handoverHad || { coins: 0, held: 0 };
    const read = await refreshWallet();
    await refreshWorld();
    // The link empties the guest wallet and moves every board and plot to the account.
    const moved = read === true && ((had.coins > 0 && state.confirmed === 0) || (had.coins === 0 && had.held > 0 && myHoldings() === 0));
    if (moved) { handoverAt = 0; ui.handoverMoved?.(); }
  } finally { handoverBusy = false; }
}
document.addEventListener('visibilitychange', () => {
  if (!handoverAt) return;
  if (document.visibilityState === 'hidden') handoverMark();
  else handoverBack();
});

// ---- lifecycle ------------------------------------------------------------------------------
function markInboxSeen(ids) {
  keep(INBOX_SEEN_KEY, JSON.stringify(seenAdd(readJson(INBOX_SEEN_KEY, []), ids)));
  syncInboxDot();
}
// Seen here (kts_inbox_seen) or already read on the server from any device (loadInbox marks those read).
function seenIds() { const own = readJson(INBOX_SEEN_KEY, []); return [...(Array.isArray(own) ? own : []), ...inboxRows.filter((row) => row.read).map((row) => row.id)]; }
function syncInboxDot() {
  ui.setInboxDot?.(liveNews.length > 0 || inboxUnread(inboxRows.filter((row) => applyInboxPush(row) && !inboxHandled.has(Math.floor(Number(row.id)))), seenIds()) > 0);
}
// 다녀간 사이: once after entering, after the intro (and after a linked wish sheet closed), never for newcomers.
// Rows come from ftue.js awayRows; ui queues the sheet until no other sheet, celebration or focus camera is up.
async function showAway() {
  try { inboxRows = await loadInbox(); } catch { inboxRows = []; }
  syncInboxDot();
  // Friends who came through my links since last time: only someone who already has a code can have any, so newcomers never ask.
  const inviteRead = !ui.isNewbie?.() && invCode(recall(INV_CODE_KEY)) ? readInvite().catch(() => null) : Promise.resolve(null);
  await Promise.race([wishBoot || Promise.resolve(), sleep(4000)]).catch(() => {});
  const invite = await Promise.race([inviteRead, sleep(3000)]).catch(() => null);
  await Promise.race([introReady, sleep(12000)]);
  if (WISH_ID && !FOCUS) await Promise.race([linkWishClosed, sleep(6000)]);
  const day = kstDay();
  const holderOf = (slot) => state.billboards.find((b) => b.slot_id === slot)?.holder_id || world?.boardView?.(slot)?.holder_id || '';
  const plan = awayRows({
    newbie: !!ui.isNewbie?.(),
    inbox: inboxRows,
    seen: seenIds(),
    copy: applyInboxPush,
    wish: state.wish.known ? state.wish : null,
    wishSeen: readJson(WISH_SEEN_KEY, null),
    prizeDay: recall(WISH_PRIZE_KEY),
    day,
    holder: holderOf,
    me: net.id,
    liveSeen: readJson(INBOX_LIVE_KEY, []),
    invite,
    invSeen: Number(recall(INV_SEEN_KEY)) || 0,
  });
  // Rows already handled (board held again, seen live, folded duplicates) do not light the 🔔 either.
  const shownIds = new Set(plan.rows.map((r) => r.id));
  inboxHandled = new Set(plan.inboxIds.filter((id) => !shownIds.has(id)));
  // Handled rows (not shown, not folded under a shown row) are read here now; only a board I hold again also on the server.
  const onSheet = new Set(plan.rows.flatMap((r) => [r.id, ...(r.also || [])]));
  const done = handledRead(plan.inboxIds.filter((id) => !onSheet.has(id)), inboxRows, holderOf, net.id);
  if (done.server.length) readInbox(done.server).catch(() => {});
  if (done.local.length) markInboxSeen(done.local);
  syncInboxDot();
  if (!plan.rows.length) return;
  // how: { acted, explicit } from ui.js. Closed by the player: every shown row is read. Left by going to look at one row:
  // only the rows acted on (overlay.js awayRead); the others come back next time and stay in 받은 소식.
  ui.openAway?.(plan.rows, (rows, how) => {
    const read = awayRead(plan, how?.acted, how?.explicit !== false);
    if (read.inboxIds.length) {
      readInbox(read.inboxIds).catch(() => {});
      markInboxSeen(read.inboxIds);
    }
    if (read.wishSeen) keep(WISH_SEEN_KEY, JSON.stringify(read.wishSeen));
    if (read.prizeDay) keep(WISH_PRIZE_KEY, read.prizeDay);
    if (read.invSeen) { keep(INV_SEEN_KEY, String(read.invSeen)); trackEvent('invite_reward', { side: 'inviter' }); }
  });
}

async function pullProfile() {
  try {
    const p = await loadProfile(state.species);
    if (!p || p.err || p.species == null) return;
    const reputation = Math.max(0, Math.floor(Number(p.reputation) || 0));
    state.profile = {
      level: Math.min(99, 1 + Math.floor(reputation / 10)),
      reputation,
      equip: Array.isArray(p.equip) ? p.equip.slice(0, EQUIP_MAX) : [],
      owned: Array.isArray(p.owned) ? p.owned.slice(0, OWNED_MAX) : [],
    };
    state.species = profileSpecies(p, state.species);
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
async function unwear(kind) {
  try {
    const res = await unequip(kind);
    if (!res || res.ok === false) {
      ui.note(res?.error === 'soon' ? '꾸미기 상점이 열리면 벗을 수 있어요' : '벗지 못했어요', 'err');
      return false;
    }
    await pullProfile();
    ui.note('벗었어요', 'ok');
    return true;
  } catch {
    ui.note('벗지 못했어요', 'err');
    return false;
  }
}
// 꾸미기 상점: the database charges its own price and equips what was bought. The room's pending coins are settled on the way (like every
// spend), so the answer's remaining_coins is the whole wallet. Not a league spend (no leagueSoon). Throws the server's line on a refusal.
// price: the one the sheet showed; the database refuses the buy when its price is another (code 'price', the live price in e.data.price).
async function buyCosmetic(id, price) {
  const res = await net._plazaPost('/rt/shop/buy', { cosmetic_id: id, ...(Number.isInteger(price) && price > 0 ? { price } : {}) });
  settle(res);
  await pullProfile();
  return res;
}
function applyServerProfile(m) {
  if (!m) return;
  if (m.av != null) {
    state.species = setSpecies(m.av);
    keep(SPECIES_KEY, String(state.species));
    world?.setSpecies(state.species);
  }
  if (Array.isArray(m.equip)) {
    state.profile.equip = m.equip.slice(0, EQUIP_MAX);
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
  world.prefetchAvatars?.();
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
  setTimeout(() => { if (!shower && !ui.isNewbie?.()) startShower(bucketKey(), true); }, 15000);
  let ready = false;
  try { ready = await netReady; } catch { ready = false; }
  // Once, after the guest token exists: my wish today, hearts left, hearts given (and the linked wish).
  wishBoot = loadWishes(WISH_ID, true).catch(() => state.wish);
  // My invite code, lazily: not in a newcomer's first minute (a fresh wish asks for it sooner).
  setTimeout(() => { ensureInvite().catch(() => {}); }, ui.isNewbie?.() ? 90000 : 20000);
  inviteGiftOnEntry(); // a gift that waited for a full day shows on the next entry
  if (ready === false) { ui.setStatus('혼자 걷는 중', 'off'); return; }
  try {
    await net.join('square', world.netState());
    bindTake();
    showAway();
    joinTribeLink();
    ui.resendPush?.();
    if (!queuePos) ui.setStatus(net.status === 'online' ? '실시간 연결됨' : '광장 연결 중', net.status === 'online' ? 'ok' : 'warn');
  } catch { ui.setStatus('혼자 걷는 중', 'off'); }
}

// Run something that needs board positions (a ?focus= link, a clicked notification). They come from the built city, so before
// that the ask is kept and run once world.built() says yes (one ask at a time, the newest wins); after BUILT_WAIT_MS it is
// dropped (giveUp).
const BUILT_WAIT_MS = 20000;
let builtWait = 0, builtDrop = null;
function whenBuilt(run, giveUp) {
  const drop = () => { clearInterval(builtWait); const d = builtDrop; builtDrop = null; d?.(); };
  drop(); // an older ask that still waits is given up
  if (!world?.built || world.built()) { run(); return; }
  const until = Date.now() + BUILT_WAIT_MS;
  builtDrop = giveUp || null;
  builtWait = setInterval(() => {
    if (world.built()) { clearInterval(builtWait); builtDrop = null; run(); }
    else if (Date.now() > until) drop();
  }, 250);
}
// A notification clicked while the game is open: sw.js posts { t: 'push', url } and focuses this tab instead of reloading it.
// /?focus=<slot> moves the focus camera there, /?wish=<id> opens that wish. Before entering it waits for the plaza.
function goPush(r) {
  if (r.kind === 'focus' && slotOf(r.slot)) {
    const look = () => whenBuilt(() => { const pose = world?.focusSlot(r.slot); if (pose) focusedSlot = r.slot; });
    // Under a sheet or a mini-game the camera would move unseen: offer it as a notice the player can take.
    if (ui.isBusy?.()) ui.note(`${slotName(r.slot)} 보러가기`, 'ok', () => { ui.closeSheets?.(); look(); });
    else look();
  } else if (r.kind === 'wish') {
    loadWishes(r.id, true).catch(() => {}).then(() => ui.openWish?.({ focus: r.id, from: 'push' }));
  }
}
// Clicked before the plaza is entered: the newest click waits for 입장, at most PUSH_ENTER_MS (a boot card left open is not
// polled forever, and a click that old no longer moves the camera by surprise).
const PUSH_ENTER_MS = 60000;
let pushWait = 0;
function onPushClick(url) {
  const r = pushRoute(url, location.origin);
  if (r.kind === 'none') return;
  clearInterval(pushWait);
  if (entered) { goPush(r); return; }
  const until = Date.now() + PUSH_ENTER_MS;
  pushWait = setInterval(() => {
    if (!entered) { if (Date.now() > until) clearInterval(pushWait); return; }
    clearInterval(pushWait);
    setTimeout(() => goPush(r), 1500);
  }, 500);
}
try { navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.t === 'push') onPushClick(e.data.url); }); } catch { /* no service worker here */ }

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
    world.setTicker(`🌠 별똥별 ${10 - shower.taken.size}개 남음 · ${left}초 · 별똥별 빛기둥에 서면 +${BALANCE.starCoin}`);
  } else paintCrown();
  ui.setPeople(1 + (net.peers?.size || 0), net.shard || 1);
}, 1000);
setInterval(savePlace, 1000);
window.addEventListener('pagehide', savePlace);
window.addEventListener('beforeunload', savePlace);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') savePlace(); });
setInterval(() => { if (net.status !== 'online' && !document.hidden) resync(); }, 60000);
