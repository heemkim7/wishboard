// Coin amounts and trigger sizes. Map coordinates stay in ts3d/layout.js.
// Claimable screens: 3 main, 8 corners, 30 main-street faces, 18 plot fronts.
export const BALANCE = {
  cooldownMs: 2200,
  stallR: 9,
  stageR: 4.2,
  stageFrontR: 6,
  taxiParkedR: 7,
  taxiStandR: 12,
  taxiStandCabR: 18,
  starR: 2.4,
  coinR: 1.8,
  cheerNear: 8,
  cheerGroup: 8,
  cheerSolo: 2,
  floors: { S: 3000, B: 500, C: 100 },
  starterSlots: ['STREET_8', 'STREET_9', 'STREET_10', 'STREET_11'],
  starterBid: 30,
  firstCoins: 40,
  bakeGold: 15,
  bakeGood: 5,
  starCoin: 6,
  danceShow: 2,
  missionEarn: 30,
  missionReward: 15,
  attend: [10, 12, 15, 20, 30],
  shareShot: 5,
  season: { mission: 20 },
  dance: { bpm: 96, beats: 40, perfect: 0.18, great: 0.32, good: 0.48, window: 0.5 },
  flushAskMs: 8000,
  grantKeepMs: 180000,
};

const plotBid = (n) => 100 + Math.round((n - 1) * 200 / 17);
const streetBid = (n) => 200 + Math.round((n - 1) * 200 / 29);
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
  ...Array.from({ length: 30 }, (_, i) => ({ id: 'STREET_' + (i + 1), tier: 'C', bid: streetBid(i + 1), name: (i + 1) + '번 메인거리' })),
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

export function slotOf(slotId) { return SLOT_BY.get(String(slotId || '')) || null; }
export function floorOf(slotId) { return slotOf(slotId)?.bid || 0; }
export function slotName(slotId) { return slotOf(slotId)?.name || String(slotId || ''); }
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
export function fareCredit(asked, revenge) {
  const n = Math.min(25, Math.floor(Number(asked)));
  if (!Number.isInteger(n) || n < 1) return 0;
  return n * (revenge ? 2 : 1);
}

export const PAY = Object.freeze({
  bake: { miss: 0, good: 6, gold: 16, minS: 8, maxS: 40, perHour: 40, nearM: 12 },
  dance: { minS: 25, maxS: 40, perHour: 6, nearM: 8 },
  cheer: { base: 4, gapMs: 12000, perHour: 30 },
  lounge: { base: 2, gapMs: 20000, perHour: 30 },
  star: { base: 6, perHour: 8 },
  stunt: { base: 8, gapMs: 20000, perHour: 8 },
  hive: { base: 2, gapMs: 15000, perHour: 12 },
  pouch: { base: 20, cap: 30, gapMs: 25000, perHour: 4, perDay: 8 },
  fare: { base: 20, gapMs: 40000, perHour: 15, pickGapMs: 20000, pickMoveM: 15, pickMax: 4 },
  lottery: { hit: 25, sides: 15 },
  attend: 30,
  mission: 15,
  hello: 40,
  quest: { fare: 50, cheer: 30, stunt: 40, all: 100 },
  hourCap: 1200,
  ballHourCap: 1600,
  playFullS: 3600,
  stall: { x: 21, z: 118 },
  stage: { x: 0, z: 366 },
});

export function curveOf(playSeconds) {
  return Number(playSeconds) < PAY.playFullS ? 1 : 0.3;
}
export function ballOpen(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const sec = g('hour') * 3600 + g('minute') * 60 + g('second');
  return sec >= 21 * 3600 && sec < 21 * 3600 + 600;
}
export function auctionClosed(slotId, now = Date.now()) {
  return String(slotId || '').startsWith('MAIN_') && !ballOpen(now);
}
export function feverBall(fever, ball) {
  return Math.min(2, (fever ? 2 : 1) * (ball ? 2 : 1));
}
export function scaledPay(base, state = {}) {
  const scaled = Math.floor(Number(base) * curveOf(state.playSeconds || 0) * feverBall(!!state.fever, !!state.ball));
  const cap = state.ball ? PAY.ballHourCap : PAY.hourCap;
  return Math.max(0, Math.min(scaled, cap - (Number(state.earnedInWindow) || 0)));
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
const PLAY_EARN = new Set(['bake', 'dance', 'lounge', 'fare', 'cheer', 'stunt', 'hive', 'star', 'pouch', 'mine']);
export function countsAsPlay(kind) { return PLAY_EARN.has(kind); }
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
export function fareRaw(riders, revenge, fever, ball) {
  const table = [1, 2.2, 3.8, 6, 10];
  const n = Math.min(5, Math.max(1, Math.floor(Number(riders)) || 1));
  return Math.round(PAY.fare.base * table[n - 1] * (revenge ? 2 : 1) * feverBall(!!fever, !!ball));
}
export function farePay(riders, state = {}) {
  const curved = Math.floor(fareRaw(riders, state.revenge, state.fever, state.ball) * curveOf(state.playSeconds || 0));
  const cap = state.ball ? PAY.ballHourCap : PAY.hourCap;
  return Math.max(0, Math.min(curved, cap - (Number(state.earnedInWindow) || 0)));
}
export function bakeBase(result) {
  if (result === 'gold') return PAY.bake.gold;
  if (result === 'good') return PAY.bake.good;
  return 0;
}
export function danceBase(score) {
  const n = Math.max(0, Math.min(100, Math.floor(Number(score) || 0)));
  if (n >= 90) return 12;
  if (n >= 75) return 8;
  if (n >= 55) return 4;
  return 2;
}
