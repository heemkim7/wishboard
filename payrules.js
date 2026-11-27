// 주문·결제 rules: pure data and functions, shared by the Worker (ordersrv.js) and the pages (payclient.js, admin-order.js), so it is
// imported with no ?v= query everywhere (tools/stamp.mjs). Nothing here touches the network, storage or the clock unless handed one.
//
// Sandbox first: no money moves until the owner sets PAY_ON=1 (Worker var) and, for real money, PAY_MODE=live with a live PortOne channel
// (docs/payments-setup.md). The PG is PortOne V2 (REST only, we choose the paymentId = our order id):
//   https://developers.portone.io/opi/ko/integration/ready/readme
//   https://developers.portone.io/opi/ko/integration/start/v2/checkout   (browser SDK, server re-query of GET /payments/{paymentId})
//   https://developers.portone.io/opi/ko/integration/webhook/readme-v2    (Standard Webhooks signatures, retries)

export const PAY = Object.freeze({
  publishTries: 3, // a paid order's publishing is tried this many times (on requests: confirm, webhook, the owner's GET, the admin) before FAILED
  hookToleranceS: 300, // Standard Webhooks: a webhook-timestamp more than 5 minutes away from now is refused
  noteMax: 300, // the operator's reason on a refund or a manual mark
  listMax: 200, // admin order list page size
  csvMax: 5000, // rows in one CSV export
  keepYears: 5, // 전자상거래법 제6조, 시행령 제6조: 대금결제·재화 공급 기록 5년. Orders are never pruned (docs/payments-setup.md: a P1 ledger copy)
  productCacheMs: 60000, // the Worker's copy of the product list, per isolate
});

// ---- the order state machine -----------------------------------------------------------------------------------------------------------
export const ST = Object.freeze({ CREATED: 'CREATED', PAYMENT_PENDING: 'PAYMENT_PENDING', PAID: 'PAID', PUBLISH_PENDING: 'PUBLISH_PENDING', PUBLISHED: 'PUBLISHED', FAILED: 'FAILED', CANCELLED: 'CANCELLED', REFUNDED: 'REFUNDED' });
// Every allowed move. The PG has the last word on money: a payment PortOne reports PAID is PAID even if the order was marked FAILED (a
// failed attempt retried with the same paymentId) or CANCELLED (the buyer closed the sheet while the payment went through); the operator
// then refunds it if it should not stand. FAILED -> PUBLISH_PENDING is the operator's "다시 공개" for a paid order whose publishing failed.
export const MOVES = Object.freeze({
  CREATED: Object.freeze(['PAYMENT_PENDING', 'CANCELLED']),
  PAYMENT_PENDING: Object.freeze(['PAID', 'FAILED', 'CANCELLED']),
  PAID: Object.freeze(['PUBLISH_PENDING', 'REFUNDED']),
  PUBLISH_PENDING: Object.freeze(['PUBLISHED', 'FAILED', 'REFUNDED']),
  PUBLISHED: Object.freeze(['REFUNDED']),
  FAILED: Object.freeze(['PAID', 'PUBLISH_PENDING', 'REFUNDED']),
  CANCELLED: Object.freeze(['PAID']),
  REFUNDED: Object.freeze([]),
});
export const canMove = (from, to) => Object.prototype.hasOwnProperty.call(MOVES, from) && MOVES[from].includes(to);
export const MONEY_STATES = Object.freeze(['PAID', 'PUBLISH_PENDING', 'PUBLISHED']); // money received and not returned (FAILED with a pg_tx too)
export const ST_NAME = Object.freeze({ CREATED: '주문 만듦', PAYMENT_PENDING: '결제 중', PAID: '결제 완료', PUBLISH_PENDING: '공개 준비', PUBLISHED: '공개됨', FAILED: '실패', CANCELLED: '취소', REFUNDED: '환불됨' });

// Funnel counters kept per KST day in the order store, as '<mode>:<event>' (live, test or mock apart).
export const PAY_EVENTS = Object.freeze(['checkout_start', 'pay_success', 'pay_fail', 'publish_ok', 'publish_fail', 'refund']);

// ---- products ------------------------------------------------------------------------------------------------------------------------
// Prices in KRW, VAT included. The gift tiers are the price ladder the gift owner page already shows (giftrules.js TIERS; a test keeps
// them equal). The personal product is a placeholder the owner decides on: off until switched on in the admin products editor.
export const PRODUCTS = Object.freeze([
  Object.freeze({ id: 'gift_big', kind: 'gift', tier: 1, name: '크게 걸기', price: 3900, perks: Object.freeze(['큰 화면에 24시간', '받는 사람 페이지 30일', '광고 없음']), active: true }),
  Object.freeze({ id: 'gift_video', kind: 'gift', tier: 2, name: '축하 영상 세트', price: 7900, perks: Object.freeze(['크게 걸기 전부', '고화질 15초 축하 영상 저장(워터마크 없음)', '롤링페이퍼 (친구 메시지 30개, 그날까지 잠금)', '받는 사람 페이지 1년', '영상·사진 내려받기']), active: true }),
  Object.freeze({ id: 'gift_nine', kind: 'gift', tier: 3, name: '9시 주인공', price: 14900, perks: Object.freeze(['축하 영상 세트 전부', "밤 9시 5분부터 '개인 축하 퍼레이드' 1분 (하루 30자리, 메인 타워와 따로)", '퍼레이드 장면이 담긴 두 번째 영상']), active: true }),
  Object.freeze({ id: 'personal_big', kind: 'personal', tier: 0, name: '내 전광판 크게 걸기', price: 2900, perks: Object.freeze(['내 응원·소원 전광판을 큰 화면에 24시간']), active: false }),
]);
const PRICE_MIN = 100, PRICE_MAX = 10_000_000, PERK_MAX = 80, PERKS_MAX = 8, NAME_MAX = 30;
const pick = (o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
// The stored edits (one JSON per product id) over the defaults. kind and tier are not editable.
export function productList(stored = []) {
  const by = new Map((Array.isArray(stored) ? stored : []).filter((x) => x && typeof x.id === 'string').map((x) => [x.id, x]));
  return PRODUCTS.map((d) => {
    const s = by.get(d.id) || {}, out = { ...d, perks: [...d.perks], arms: [] };
    if (Number.isInteger(s.price) && s.price >= PRICE_MIN && s.price <= PRICE_MAX) out.price = s.price;
    if (typeof s.active === 'boolean') out.active = s.active;
    if (Array.isArray(s.perks) && s.perks.length) out.perks = s.perks.map(String).slice(0, PERKS_MAX);
    if (typeof s.name === 'string' && s.name.trim()) out.name = s.name.trim().slice(0, NAME_MAX);
    if (Array.isArray(s.arms)) out.arms = s.arms.filter((a) => a && a.arm === 'B' && Number.isInteger(a.price) && a.price >= PRICE_MIN && a.price <= PRICE_MAX).slice(0, 1);
    return out;
  });
}
const intOf = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN);
// An admin edit { id, price?, active?, perks?, name?, armB? } -> { ok, v } (v: the fields to store) | { ok: false, error }.
export function productFault(b) {
  const id = String(pick(b, 'id') ?? '');
  if (!PRODUCTS.some((p) => p.id === id)) return { ok: false, error: '그 상품이 없어요.' };
  const v = { id };
  if (pick(b, 'price') !== undefined) { const n = intOf(b.price); if (!Number.isInteger(n) || n < PRICE_MIN || n > PRICE_MAX) return { ok: false, error: '가격은 100원에서 1,000만 원 사이 정수로 적어 주세요.' }; v.price = n; }
  if (pick(b, 'active') !== undefined) v.active = b.active === true || b.active === 'true' || b.active === 1 || b.active === '1';
  if (pick(b, 'perks') !== undefined) {
    const list = (Array.isArray(b.perks) ? b.perks : String(b.perks).split('\n')).map((x) => String(x).trim()).filter(Boolean);
    if (!list.length || list.length > PERKS_MAX || list.some((x) => x.length > PERK_MAX)) return { ok: false, error: '혜택은 1~8줄, 줄마다 80자까지예요.' };
    v.perks = list;
  }
  if (pick(b, 'name') !== undefined) { const n = String(b.name).trim(); if (!n || n.length > NAME_MAX) return { ok: false, error: '이름은 1~30자예요.' }; v.name = n; }
  if (pick(b, 'armB') !== undefined) {
    if (b.armB === '' || b.armB === null) v.arms = [];
    else { const n = intOf(b.armB); if (!Number.isInteger(n) || n < PRICE_MIN || n > PRICE_MAX) return { ok: false, error: 'B안 가격은 100원에서 1,000만 원 사이 정수예요. 비우면 실험을 끕니다.' }; v.arms = [{ arm: 'B', price: n }]; }
  }
  return { ok: true, v };
}

// ---- ids and price arms --------------------------------------------------------------------------------------------------------------
export const ORDER_ID = /^o_[A-Za-z0-9]{20}$/;
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
// 'o_' + 20 characters from 62 (rejection sampling: no bias). It is also the PortOne paymentId.
export function newOrderId(fill = (u8) => crypto.getRandomValues(u8)) {
  let s = 'o_';
  while (s.length < 22) { const b = fill(new Uint8Array(32)); for (const x of b) { if (x < 248 && s.length < 22) s += ALNUM[x % 62]; } }
  return s;
}
// FNV-1a 32-bit: a fixed, synchronous hash so the same buyer always sees the same arm (no storage needed to keep it).
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
// A product with arms [{ arm: 'B', price }] splits buyers between A (the base price) and B by a hash of buyer and product. The order keeps
// the arm and the price that was shown, so the experiment is read from orders alone.
export function armOf(product, uid) {
  const arms = [{ arm: 'A', price: product.price }, ...(Array.isArray(product.arms) ? product.arms : [])];
  return { ...arms[fnv(String(uid) + ':' + product.id) % arms.length] };
}

// ---- refund rules shown before payment (a summary of the terms' 유료 상품의 취소와 환불, legal.js) -------------------------------------
export const REFUND_RULES = Object.freeze({
  before: '전광판이 공개되기 전에는 언제든 취소할 수 있고 낸 금액을 전액 돌려드려요.',
  after: '전광판이 공개된 뒤에는 디지털 콘텐츠 제공이 시작되어 청약철회가 제한돼요(전자상거래법 제17조제2항제5호).',
  lines: Object.freeze([
    '여러 날에 걸친 상품은 아직 제공되지 않은 날을 그 전날까지 취소할 수 있어요.',
    '운영자 쪽 장애로 제공하지 못했거나 설명과 다르게 제공되면 3개월 안에(안 날부터 30일 안에) 돌려드려요.',
    '환불은 설정의 문의하기로 요청하고, 3영업일 안에 결제한 수단으로 돌려드려요.',
    '만 14세 미만은 살 수 없어요.',
  ]),
});
export const TEST_BADGE = '테스트 결제';
export const TEST_NOTE = '테스트 결제예요. 실제로 돈이 나가지 않아요.';

// ---- cost model ------------------------------------------------------------------------------------------------------------------------
// Known: the PG fee, 3.2-3.4% of the price plus 10% VAT on the fee (card, small online merchants; the real rate comes with the contract).
// Unknown (null, shown as 모름): fixed monthly fees, hosting per order, video rendering, support time, income tax.
export const COST = Object.freeze({ pg: Object.freeze({ lo: 0.032, hi: 0.034, vat: 0.1 }), fixed: null, hosting: null, video: null, support: null, tax: null });
export function costOf(amount) {
  const a = Math.max(0, Number(amount) || 0), f = (r) => Math.round(a * r * (1 + COST.pg.vat));
  return { pg: { lo: f(COST.pg.lo), hi: f(COST.pg.hi) }, fixed: null, hosting: null, video: null, support: null, tax: null };
}

// ---- switches ------------------------------------------------------------------------------------------------------------------------
export const payOn = (env) => env?.PAY_ON === '1';
const LOCAL = (h) => { h = String(h || '').toLowerCase(); return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost'); };
// 'live' only when PAY_MODE is exactly live; 'mock' (no network, simulated PortOne) only on a local host; a mock on any other host is
// null: payments are off rather than faked on the real site.
export function payMode(env, host) {
  const m = String(env?.PAY_MODE ?? '');
  if (m === 'live') return 'live';
  if (m === 'mock') return LOCAL(host) ? 'mock' : null;
  return 'test';
}
// Who may see and use checkout. PAY_ALLOW: comma-separated account ids. test: only those (empty list = nobody, so test payments never
// reach the public); live: everyone, or only those while a list is set (a soft launch); mock (local): everyone.
export function payAllowed(env, mode, uid) {
  if (!mode) return false;
  const list = String(env?.PAY_ALLOW || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (mode === 'mock') return true;
  if (mode === 'test') return list.includes(String(uid));
  return !list.length || list.includes(String(uid));
}
// What /rt/config says: nothing at all while off.
export function payPublic(env, host) { if (!payOn(env)) return null; const mode = payMode(env, host); return mode ? { on: true, mode } : null; }

// ---- what PortOne's payment means for an order -------------------------------------------------------------------------------------------
// payment: the body of GET /payments/{paymentId} (status, id, transactionId, amount.total, currency, channel.type). -> { to, why, ... }:
// to is the state to move to, or null (nothing to do: still pending, already there, or not ours to decide).
export function pgVerdict(order, payment) {
  if (!order || !payment || typeof payment !== 'object') return { to: null, why: 'nopay' };
  if (payment.id != null && String(payment.id) !== order.id) return { to: null, why: 'id' };
  const s = String(payment.status || ''), tx = String(payment.transactionId || order.pg_tx || '');
  if (s === 'PAID') {
    if (MONEY_STATES.includes(order.st) || order.st === 'REFUNDED') return { to: null, why: 'already' };
    const total = payment.amount?.total, cur = String(payment.currency || '');
    if (typeof total !== 'number' || total !== order.price || cur !== 'KRW') return { to: 'FAILED', tx, why: 'amount', paid: total, currency: cur };
    return { to: 'PAID', how: payment.channel?.type === 'LIVE' ? 'pg' : 'test', tx, why: 'paid' };
  }
  if (s === 'FAILED') return order.st === 'PAYMENT_PENDING' ? { to: 'FAILED', tx, why: 'pg_failed' } : { to: null, why: 'failed_late' };
  if (s === 'CANCELLED') return MONEY_STATES.includes(order.st) || (order.st === 'FAILED' && order.pg_tx) ? { to: 'REFUNDED', tx, why: 'pg_cancelled' } : { to: null, why: 'cancelled' };
  return { to: null, why: s ? 'status:' + s.slice(0, 30) : 'nostatus' };
}

// ---- revenue (real orders only) ------------------------------------------------------------------------------------------------------
export const kstOf = (ms) => new Date(Number(ms) + 9 * 3600e3).toISOString().slice(0, 10);
export const isReal = (o) => (o?.how === 'pg' || o?.how === 'manual') && o?.paid_at != null;
// rows: the orders paid in the range (any how). firstPaid: uid -> the buyer's first real paid_at ever. picks: gift tier -> picks in the
// range (giftsrv.js 'pick:<t>' counters, E1). funnel: live counters summed over the range.
export function revenueOf(rows, { firstPaid = {}, picks = {}, funnel = {}, d0 = '' } = {}) {
  const real = rows.filter(isReal), days = new Map(), prods = new Map(), buyers = new Map();
  let gross = 0, rn = 0, ramt = 0, refN = 0, refG = 0;
  for (const o of real) {
    const d = kstOf(o.paid_at), day = days.get(d) || { day: d, paid: 0, gross: 0, refunds: 0, refundAmount: 0 }; days.set(d, day);
    const p = prods.get(o.product) || { id: o.product, paid: 0, gross: 0, refunds: 0, arms: {} }; prods.set(o.product, p);
    day.paid++; day.gross += o.price; p.paid++; p.gross += o.price; gross += o.price;
    const a = p.arms[o.arm || 'A'] ||= { paid: 0, gross: 0 }; a.paid++; a.gross += o.price;
    if (o.st === 'REFUNDED') { rn++; ramt += o.price; day.refunds++; day.refundAmount += o.price; p.refunds++; }
    if (o.ref) { refN++; refG += o.price; }
    buyers.set(o.uid, (buyers.get(o.uid) || 0) + 1);
  }
  let fresh = 0;
  for (const uid of buyers.keys()) { const f = firstPaid[uid]; const from = d0 || [...days.keys()].sort()[0] || ''; if (f == null || kstOf(f) >= from) fresh++; }
  const tierOf = new Map(PRODUCTS.map((x) => [x.id, x.tier]));
  const products = [...new Set([...PRODUCTS.map((x) => x.id), ...prods.keys()])].map((id) => {
    const p = prods.get(id) || { id, paid: 0, gross: 0, refunds: 0, arms: {} }, t = tierOf.get(id);
    return { ...p, picks: t ? Number(picks[t]) || 0 : null };
  });
  const rate = (a, b) => (b ? Math.round((a / b) * 1000) / 1000 : null);
  return {
    paid: real.length, gross, net: gross - ramt, aov: real.length ? Math.round(gross / real.length) : 0,
    refunds: { n: rn, amount: ramt, rate: rate(rn, real.length) },
    buyers: { total: buyers.size, new: fresh, repeat: buyers.size - fresh },
    ref: { n: refN, gross: refG },
    days: [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1)), products,
    conversion: { checkout: rate(Number(funnel.pay_success) || 0, Number(funnel.checkout_start) || 0), picks: rate(products.reduce((s, p) => s + (p.picks != null ? p.paid : 0), 0), products.reduce((s, p) => s + (p.picks || 0), 0)) },
    cost: { ...costOf(gross), perOrder: real.length ? costOf(gross / real.length) : null },
    funnel, excluded: rows.filter((o) => !isReal(o) && o.paid_at != null).length,
  };
}

// ---- CSV -----------------------------------------------------------------------------------------------------------------------------
const CSV_COLS = ['id', 'created_kst', 'paid_kst', 'refunded_kst', 'uid', 'kind', 'product', 'price', 'arm', 'st', 'how', 'mode', 'ref', 'ref_board', 'pg_tx', 'note'];
const when = (ms) => (ms == null || ms === '' ? '' : new Date(Number(ms) + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 19));
// A cell that a spreadsheet would run as a formula (=, +, -, @, tab, CR) gets a leading apostrophe; every cell is quoted.
const cellOf = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
export function ordersCsv(rows) {
  const out = [CSV_COLS.join(',')];
  for (const o of rows) out.push([o.id, when(o.created_at), when(o.paid_at), when(o.refunded_at), o.uid, o.kind, o.product, o.price, o.arm, o.st, o.how, o.mode, o.ref, o.ref_board, o.pg_tx, o.note].map(cellOf).join(','));
  return out.join('\r\n') + '\r\n';
}

// ---- messages ----------------------------------------------------------------------------------------------------------------------
export const PAY_ERR = Object.freeze({
  off: '지금은 결제를 받지 않아요.', login: '결제하려면 로그인해 주세요.', allow: '지금은 결제를 열어 둔 계정만 쓸 수 있어요.',
  busy: '지금은 사람이 많아서 결제를 잠시 멈췄어요. 잠시 뒤에 다시 해 주세요.', rate: '너무 빨리 누르고 있어요. 1분 뒤에 다시 해 주세요.',
  product: '그 상품은 지금 살 수 없어요.', price: '가격이 바뀌었어요. 바뀐 가격을 확인하고 다시 눌러 주세요.', board: '내 선물 전광판에만 결제할 수 있어요.',
  nf: '주문을 찾지 못했어요.', state: '이 주문은 지금 그 단계로 갈 수 없어요.', pg: '결제사에 확인하지 못했어요. 잠시 뒤에 다시 확인해 주세요.',
  amount: '결제 금액이 주문과 달라서 결제를 확정하지 않았어요. 운영자가 확인 후 환불해 드려요.', down: '처리하지 못했어요. 잠시 뒤에 다시 해 주세요.',
  note: '이유를 적어 주세요.', keys: '결제 설정이 아직 없어요(운영자).',
});
