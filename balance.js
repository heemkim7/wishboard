// 응원 포인트 amounts and trigger sizes. Map coordinates stay in ts3d/layout.js. The points are still called coins inside the code, the database
// (wallets.coins, coin_ledger, coin_batch) and the RPC names; only what a person reads says 응원 포인트.
// Claimable screens: 5 main, 8 corners, 50 main-street faces, 18 plot fronts (81).
// Free first slots: the database owns the list (public.starter_slots()), /rt/config carries it. Until it arrives, these four.
export const STARTER_DEFAULT = Object.freeze(['STREET_8', 'STREET_9', 'STREET_10', 'STREET_11']);
let STARTER = null;
export const BALANCE = {
  cooldownMs: 2200,
  stallR: 9,
  stageR: 4.2,
  stageFrontR: 6,
  taxiParkedR: 7,
  taxiStandR: 12,
  taxiStandCabR: 18,
  starR: 2.4,
  cheerNear: 8,
  cheerGroup: 8,
  floors: { S: 3000, B: 500, C: 100 },
  get starterSlots() { return STARTER || STARTER_DEFAULT; }, // every offer of a free slot reads this one getter
  starterBid: 30,
  firstCoins: 40,
  missionReward: 15,
  attend: [10, 12, 15, 20, 30],
  shareShot: 5,
  season: { mission: 20 },
  dance: { bpm: 96, beats: 40, perfect: 0.18, great: 0.32, good: 0.48, window: 0.5 },
  flushAskMs: 8000,
  grantKeepMs: 180000,
};

const plotBid = (n) => 100 + Math.round((n - 1) * 200 / 17);
// STREET_1..30 run 200..400; STREET_31..50 (the plaza core, added later) are the cheapest street faces, 150..250.
// public.slot_floor() in schema.sql is the same formula.
const streetBid = (n) => (n <= 30 ? 200 + Math.round((n - 1) * 200 / 29) : 150 + Math.round((n - 31) * 100 / 19));
export const STREET_N = 50;
/** The one test for a claimable board id. The Worker, the screens and the share pages all use this. */
export const SLOT_RE = /^(MAIN_(UP|TOP|MID|BOT|LOW)|SUB_[1-4][AB]|STREET_([1-9]|[1-4]\d|50)|PLOT_([1-9]|1[0-8]))$/;
export const isSlotId = (id) => typeof id === 'string' && SLOT_RE.test(id);
// A board is claimable only once its row is in the database (the billboards list /rt/world serves). STREET_31..50 are on
// the map before migrations/2026-11-22-boards.sql adds their rows; until then they show the house notice and this line.
export const SLOT_SOON = '이 전광판은 곧 열려요. 지금은 다른 칸을 골라 주세요';
/** The boards added after launch (their rows come with a migration): the screen says '곧 열려요' until a row arrives. */
export const isLateSlot = (id) => /^STREET_(3[1-9]|4\d|50)$/.test(String(id ?? ''));
/** rows: the world's billboards. An empty or missing list (not loaded yet) does not close anything. */
export function slotOpen(rows, id) {
  if (!isSlotId(id)) return false;
  if (!Array.isArray(rows) || !rows.length) return true;
  return rows.some((r) => r?.slot_id === id);
}
// What claim_billboard answers for an id without a row: the old slot_floor() gives 0 for STREET_31..50 ('그 전광판은 점령할
// 수 없습니다.'), a missing row gives '존재하지 않는 전광판 슬롯입니다.'. Both mean "not open yet" for a real board id.
const NO_ROW = ['그 전광판은 점령할 수 없습니다.', '존재하지 않는 전광판 슬롯입니다.'];
export function soonError(slot, error) { return isSlotId(slot) && NO_ROW.includes(String(error || '')) ? SLOT_SOON : null; }
export const SLOTS = [
  { id: 'MAIN_UP', tier: 'S', bid: 4000, name: '메인 타워 최상단' },
  { id: 'MAIN_TOP', tier: 'S', bid: 3000, name: '메인 타워 정상' },
  { id: 'MAIN_MID', tier: 'S', bid: 2000, name: '메인 타워 중앙' },
  { id: 'MAIN_BOT', tier: 'S', bid: 1500, name: '메인 타워 하단' },
  { id: 'MAIN_LOW', tier: 'S', bid: 1200, name: '메인 타워 최하단' },
  { id: 'SUB_1A', tier: 'B', bid: 800, name: '1번 타워 상단' },
  { id: 'SUB_1B', tier: 'B', bid: 500, name: '1번 타워 하단' },
  { id: 'SUB_2A', tier: 'B', bid: 800, name: '2번 타워 상단' },
  { id: 'SUB_2B', tier: 'B', bid: 500, name: '2번 타워 하단' },
  { id: 'SUB_3A', tier: 'B', bid: 800, name: '3번 타워 상단' },
  { id: 'SUB_3B', tier: 'B', bid: 500, name: '3번 타워 하단' },
  { id: 'SUB_4A', tier: 'B', bid: 800, name: '4번 타워 상단' },
  { id: 'SUB_4B', tier: 'B', bid: 500, name: '4번 타워 하단' },
  ...Array.from({ length: STREET_N }, (_, i) => ({ id: 'STREET_' + (i + 1), tier: 'C', bid: streetBid(i + 1), name: (i + 1) + '번 메인거리' })),
  ...Array.from({ length: 18 }, (_, i) => ({ id: 'PLOT_' + (i + 1), tier: 'C', bid: plotBid(i + 1), name: (i + 1) + '번 분양 전광판' })),
];
export const SLOT_IDS = SLOTS.map((s) => s.id);
const SLOT_BY = new Map(SLOTS.map((s) => [s.id, s]));
const MAINS = ['MAIN_TOP', 'MAIN_MID', 'MAIN_BOT'];
export const BUILDINGS = [
  { id: 'main', name: '메인 타워', slots: ['MAIN_LOW', 'MAIN_BOT', 'MAIN_MID', 'MAIN_TOP', 'MAIN_UP'] },
  { id: 'c1', name: '1번 코너', slots: ['SUB_1B', 'SUB_1A'] },
  { id: 'c2', name: '2번 코너', slots: ['SUB_2B', 'SUB_2A'] },
  { id: 'c3', name: '3번 코너', slots: ['SUB_3B', 'SUB_3A'] },
  { id: 'c4', name: '4번 코너', slots: ['SUB_4B', 'SUB_4A'] },
];
const TAG_RE = /#[0-9A-Za-z가-힣_]{1,16}/g;

/** A starter list from the server: main-street ids only, no repeats, in order. Anything else (or an empty list) is null. */
export function starterList(raw) {
  if (!Array.isArray(raw) || raw.length > 30) return null;
  const out = [];
  for (const id of raw) if (typeof id === 'string' && /^STREET_\d+$/.test(id) && SLOT_BY.has(id) && !out.includes(id)) out.push(id);
  return out.length ? out : null;
}
/** Adopt the server's list; a missing or bad one goes back to STARTER_DEFAULT. */
export function setStarterSlots(raw) { STARTER = starterList(raw); return BALANCE.starterSlots; }
export function slotOf(slotId) { return SLOT_BY.get(String(slotId || '')) || null; }
export function floorOf(slotId) { return slotOf(slotId)?.bid || 0; }
export function slotName(slotId) { return slotOf(slotId)?.name || String(slotId || ''); }
// "5번 메인거리를", "메인 타워 하단을": the particle follows the last sound of a name known only at run time.
// A Hangul syllable with a final consonant takes `closed` (을 · 은 · 이), one without takes `open` (를 · 는 · 가).
// A trailing digit is read aloud (0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔 are closed); anything else takes `open`.
export function josa(word, closed, open) {
  const s = String(word ?? '').trim();
  const ch = s.charCodeAt(s.length - 1);
  let final = false;
  if (ch >= 0xac00 && ch <= 0xd7a3) final = (ch - 0xac00) % 28 !== 0;
  else if (ch >= 48 && ch <= 57) final = '013678'.includes(s[s.length - 1]);
  return s + (final ? closed : open);
}
export function tagsOf(board) {
  const text = [board?.line1, board?.line2, board?.line3].join(' ');
  return new Set(text.match(TAG_RE) || []);
}
export function live(board, now = Date.now()) {
  if (!board?.holder_id) return false;
  const until = board.lit_until || board.expires_at;
  const exp = until ? new Date(until).getTime() : 0;
  return exp > now;
}
export function buildingOf(slotId) {
  return BUILDINGS.find((b) => b.slots.includes(slotId)) || null;
}
export function chainsOf(boards, now = Date.now()) {
  const out = [];
  for (const bld of BUILDINGS) {
    const rows = bld.slots.map((id) => (boards || []).find((r) => r.slot_id === id));
    if (rows.some((r) => !live(r, now))) continue;
    let name = '', holder = '', tag = '';
    if (rows.every((r) => r.holder_id === rows[0].holder_id)) {
      name = rows[0].holder_name || '누군가';
      holder = rows[0].holder_id;
    } else {
      for (const t of tagsOf(rows[0])) {
        if (rows.every((r) => tagsOf(r).has(t))) { tag = t; name = t; break; }
      }
    }
    if (name) out.push({ id: bld.id, building: bld.name, name, holder, tag, slots: bld.slots });
  }
  return out;
}
export function chainBoost(boards, slotId, now = Date.now()) {
  const bld = buildingOf(slotId);
  return !!bld && chainsOf(boards, now).some((c) => c.id === bld.id);
}
export function nextChainFace(slotId, boards, actorId, now = Date.now()) {
  const bld = buildingOf(slotId);
  if (!bld || bld.slots.length < 2) return null;
  const mine = bld.slots.filter((id) => {
    if (id === slotId) return true;
    const row = (boards || []).find((r) => r.slot_id === id);
    return row && row.holder_id === actorId && live(row, now);
  });
  const next = bld.slots.find((id) => !mine.includes(id));
  if (!next) return null;
  return { id: next, left: bld.slots.length - mine.length, building: bld.name, price: floorOf(next) };
}
export function monopolyOf(boards, now = Date.now()) {
  const rows = MAINS.map((id) => (boards || []).find((b) => b.slot_id === id));
  if (rows.some((b) => !live(b, now))) return null;
  if (rows.every((b) => b.holder_id === rows[0].holder_id)) {
    return { name: rows[0].holder_name || '누군가', holder: rows[0].holder_id, tag: '' };
  }
  let shared = '';
  for (const tag of tagsOf(rows[0])) {
    if (rows.every((b) => tagsOf(b).has(tag))) { shared = tag; break; }
  }
  return shared ? { name: shared, holder: '', tag: shared } : null;
}
export function askBid(board, boards, actorId, draft = '', now = Date.now()) {
  const floor = floorOf(board?.slot_id);
  if (!floor) return 0;
  const active = live(board, now);
  if (active && actorId && board?.holder_id === actorId) return Math.max(0, Number(board.current_bid) || 0);
  let min = active ? Math.max(floor, Number(board.current_bid || 0) + 50) : floor;
  const mono = monopolyOf(boards, now);
  if (!mono || !String(board?.slot_id || '').startsWith('MAIN_')) return min;
  const self = mono.holder && actorId && actorId === mono.holder;
  const tagged = mono.tag && tagsOf({ line1: draft, line2: board?.line2, line3: board?.line3 }).has(mono.tag);
  if (!self && !tagged) min = Math.ceil(min * 1.5);
  return min;
}
// 응원 포인트 earned by repetition (docs/non-game-plan-2026-11-22.md 4-3). WISH BOARD is not a game: no controlled play pays (bake, dance,
// taxi fares, stars, rings, high fives, ground coins, the pouch, the lottery are gone from this table), so the hour window, the play-time
// curve and the fever multiplier that only existed for them are gone too. What repeats is watching and cheering: a flat amount, a gap, a
// cap per clock hour on the action and a cap per KST day on the points. The Room DO (worker.js) is the one that pays.
// cheer: a lit board of someone else, 12 s per board; the action stops at perHour, the points at perDay (the cheer still lands after that).
// lounge: 관람 on the red stairs, one pay per gapMs while the tab is visible; nothing after perDay.
export const PAY = Object.freeze({
  cheer: Object.freeze({ base: 4, gapMs: 12000, perHour: 30, perDay: 30 }), // BALANCE.cheerGroup (8) when one side holds the whole building
  lounge: Object.freeze({ base: 2, gapMs: 20000, perHour: 30, perDay: 30 }),
  attend: 30,
  mission: 15,
  hello: 40,
  quest: Object.freeze({ cheer: 30 }),
});
// The plaza's play, without points: only how often a thing may fire again. A ring dims for ring.gapMs after it is passed, a high five
// between cabs waits hive.gapMs, a taxi passenger is picked up at most pick.max at a time (pick.gapMs and pick.moveM apart), and a drop-off is
// counted toward the board's report (worker.js fare: a tally, never a fare) at most once per drop.gapMs. stage.nearM: the dance circle.
export const PLAY = Object.freeze({
  ring: Object.freeze({ gapMs: 20000 }),
  hive: Object.freeze({ gapMs: 15000 }),
  pick: Object.freeze({ gapMs: 20000, moveM: 15, max: 4 }),
  drop: Object.freeze({ gapMs: 15000 }),
  stage: Object.freeze({ nearM: 8 }),
});
// The kinds a client may still send as BONUS (worker.js Room bonus): attendance, missions, the first visit, the share photo and 관람.
// Anything else (stunt, hive, star, pouch from a page that loaded before this change) is answered { amount: 0, why: 'off' } and pays nothing.
export const BONUS_KINDS = Object.freeze(['attend', 'mission', 'hello', 'shot', 'lounge']);
export function ballOpen(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const sec = g('hour') * 3600 + g('minute') * 60 + g('second');
  return sec >= 21 * 3600 && sec < 21 * 3600 + 600;
}
export function auctionClosed(slotId, now = Date.now()) {
  return String(slotId || '').startsWith('MAIN_') && !ballOpen(now);
}
// Pending coins leave in order as the confirmed balance rises. A short server credit shrinks the front grant.
export const STICKER_GLYPHS = Object.freeze(['🔥부럽다!', '👑성지순례', '💖하트폭탄', '👀내자리찜']);
// op add appends one known glyph, pop drops the last, anything else only keeps known glyphs (max 8).
export function stickerNext(list, glyph, op) {
  const cur = [];
  for (const item of Array.isArray(list) ? list : []) {
    const g = typeof item === 'string' ? item : item?.g;
    if (STICKER_GLYPHS.includes(g) && cur.length < 8) cur.push(g);
  }
  if (op === 'pop') return cur.slice(0, -1);
  if (op === 'add' && STICKER_GLYPHS.includes(glyph) && cur.length < 8) return cur.concat(glyph);
  return cur;
}
// Points from watching and cheering (not attendance, the first visit, missions, shares, links or invites): the newcomer mode graduates on
// GRAD_EARN of them a day (ftue.js), and analytics counts the first one.
const ACTIVITY = new Set(['cheer', 'lounge', 'click']);
export function countsAsActivity(kind) { return ACTIVITY.has(kind); }
export function cheerCount(prev, next) {
  const a = Math.max(0, Math.floor(Number(prev)) || 0);
  const b = Math.max(0, Math.floor(Number(next)) || 0);
  return Math.max(a, b);
}
export function takeGrants(grants, gain) {
  const left = (grants || []).map((g) => ({ n: Math.floor(Number(g?.n)) || 0, at: g?.at || 0 })).filter((g) => g.n > 0);
  let rest = Math.max(0, Math.floor(Number(gain)) || 0);
  while (left.length && rest > 0) {
    if (left[0].n <= rest) rest -= left.shift().n;
    else { left[0].n -= rest; rest = 0; }
  }
  return left;
}
export function claimSplit({ mode = 'claim', bid = 0, prevBid = 0, plot = false, landlordId = '', buyerId = '', prevId = '', live = false } = {}) {
  const B = Math.max(0, Math.floor(Number(bid) || 0));
  const prev = Math.max(0, Math.floor(Number(prevBid) || 0));
  if (mode === 'starter') return { charge: 0, refund: 0, landlord: 0, burn: 0 };
  if (mode === 'edit') {
    const delta = Math.max(0, B - prev);
    const landlord = plot && landlordId && landlordId !== buyerId ? Math.floor(delta / 2) : 0;
    return { charge: delta, refund: 0, landlord, burn: delta - landlord };
  }
  if (!live) {
    const landlord = plot && landlordId && landlordId !== buyerId ? Math.floor(B / 2) : 0;
    return { charge: B, refund: 0, landlord, burn: B - landlord };
  }
  const refund = Math.min(B, Math.floor(prev * 80 / 100));
  let landlord = Math.floor((B - refund) / 2);
  if (!(plot && landlordId && landlordId !== buyerId && landlordId !== prevId)) landlord = 0;
  return { charge: B, refund, landlord, burn: B - refund - landlord };
}
// 꾸미기 상점: cosmetics bought with game coins only, never cash. The database holds the price that is charged (cosmetics.price,
// migrations/2026-11-22-shop.sql seeds these same numbers) and buy_cosmetic reads it; this table is what the shop sheet shows (labels,
// order, the price before the migration) and what test/shop.test.mjs holds the seed to. hat_ribbon, cab_yellow and frame_streak still come
// with every 7-day attendance streak too, at the prices in docs/superpowers/specs/2026-11-15-monetize-legal-note.md. One equipped per kind.
// tint: the colour a tile, a taxi or a frame shows for the item (ts3d/art.js paints the name tags and rings by id).
export const SHOP_KINDS = Object.freeze([
  Object.freeze({ kind: 'tag', label: '이름표' }),
  Object.freeze({ kind: 'ring', label: '발밑 링' }),
  Object.freeze({ kind: 'cab', label: '택시' }),
  Object.freeze({ kind: 'frame', label: '테두리' }),
  Object.freeze({ kind: 'hat', label: '모자' }),
]);
export const SHOP = Object.freeze([
  { id: 'tag_heart', kind: 'tag', price: 300, label: '하트 이름표', tint: '#ff6fb5' },
  { id: 'tag_gold', kind: 'tag', price: 500, label: '골드 이름표', tint: '#ffc94a' },
  { id: 'tag_neon', kind: 'tag', price: 700, label: '네온 이름표', tint: '#48d6f0' },
  { id: 'ring_sparkle', kind: 'ring', price: 700, label: '반짝이 링', tint: '#ffe9a8' },
  { id: 'ring_heart', kind: 'ring', price: 800, label: '하트 링', tint: '#ff5fa8' },
  { id: 'ring_rainbow', kind: 'ring', price: 1000, label: '무지개 링', tint: '#b84dff' },
  { id: 'cab_yellow', kind: 'cab', price: 800, label: '노란 택시', tint: '#fff3a0' },
  { id: 'cab_pink', kind: 'cab', price: 900, label: '핑크 택시', tint: '#ff6fb5' },
  { id: 'cab_black', kind: 'cab', price: 1100, label: '블랙 택시', tint: '#23252d' },
  { id: 'frame_streak', kind: 'frame', price: 600, label: '연속 테두리', tint: '#ff3d9a' },
  { id: 'frame_gold', kind: 'frame', price: 1000, label: '골드 테두리', tint: '#ffc94a' },
  { id: 'frame_rainbow', kind: 'frame', price: 1500, label: '무지개 테두리', tint: '#b84dff' },
  { id: 'hat_ribbon', kind: 'hat', price: 400, label: '리본 모자', tint: '#ff3d9a' },
].map((it) => Object.freeze(it)));
const SHOP_BY = new Map(SHOP.map((it) => [it.id, it]));
export const shopItem = (id) => SHOP_BY.get(String(id ?? '')) || null;
// The kind of a cosmetic id: the shop's, else the id's prefix (hat_, cab_, frame_, tag_, ring_), else ''.
export function cosmeticKind(id) {
  const s = String(id ?? '');
  const hit = SHOP_BY.get(s);
  if (hit) return hit.kind;
  const m = /^(hat|cab|frame|tag|ring)_[a-z0-9_]+$/.exec(s);
  return m ? m[1] : '';
}
// The one equipped id of `kind` in an equip list (presence `equip`, GET /rt/profile equip), or ''.
export function equippedOf(equip, kind) {
  const src = Array.isArray(equip) ? equip : String(equip || '').split(',');
  for (const raw of src) { const id = String(raw || '').trim(); if (id && cosmeticKind(id) === kind) return id; }
  return '';
}
// Cosmetic lists on the wire: at most EQUIP_MAX equipped (one per kind, with room for 'emote') and OWNED_MAX owned.
export const EQUIP_MAX = 6, OWNED_MAX = 16;
// The shop sheet's tiles for one kind (or every kind with kind ''). open/items: GET /rt/shop (the database's prices; open false before the
// migration, when SHOP's own prices are shown). owned/equip: GET /rt/profile. coins: the wallet as the HUD shows it.
// act: 'off' (worn; the shop is open so it can be taken off), 'worn' (worn, before the migration), 'wear' (owned), 'soon' (not owned, shop
// closed), 'short' (not enough coins), 'buy'. An item the open database does not sell is left out unless it is owned.
export function shopTiles({ kind = '', open = false, items = [], owned = [], equip = [], coins = 0 } = {}) {
  const dbPrice = new Map();
  for (const it of Array.isArray(items) ? items : []) { const p = Math.floor(Number(it?.price)); if (it && typeof it.id === 'string' && p > 0) dbPrice.set(it.id, p); }
  const have = new Set(Array.isArray(owned) ? owned : []), worn = new Set(Array.isArray(equip) ? equip : []);
  const wallet = Math.max(0, Math.floor(Number(coins) || 0));
  const out = [];
  for (const it of SHOP) {
    if (kind && it.kind !== kind) continue;
    const mine = have.has(it.id) || worn.has(it.id), on = worn.has(it.id);
    if (open && !dbPrice.has(it.id) && !mine) continue;
    const price = open && dbPrice.has(it.id) ? dbPrice.get(it.id) : it.price;
    const act = on ? (open ? 'off' : 'worn') : mine ? 'wear' : !open ? 'soon' : wallet < price ? 'short' : 'buy';
    out.push({ id: it.id, kind: it.kind, label: it.label, tint: it.tint, price, owned: mine, worn: on, act });
  }
  return out;
}
