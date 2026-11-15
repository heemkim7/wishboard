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
  starterSlots: [],
  starterBid: 30,
  firstCoins: 40,
  bakeGold: 15,
  bakeGood: 5,
  starCoin: 8,
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
function live(board, now = Date.now()) {
  if (!board?.holder_id) return false;
  const exp = board.expires_at ? new Date(board.expires_at).getTime() : 0;
  return exp > now;
}
export function buildingOf(slotId) {
  return BUILDINGS.find((b) => b.slots.includes(slotId)) || null;
}
export function chainsOf(boards, now = Date.now()) {
  const out = [];
  for (const bld of BUILDINGS) {
    const rows = bld.slots.map((id) => (boards || []).find((r) => r.slot_id === id));
    if (rows.some((r) => !live(r, now) || String(r.holder_id).startsWith('rival:'))) continue;
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
