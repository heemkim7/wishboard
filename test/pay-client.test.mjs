// 결제 sheet, client side (payclient.js): what it shows before paying, the flow against a fake API (mock window, PortOne SDK answers,
// a price that moved), the mobile return, and source checks for what needs a browser (the SDK only from its CDN and only on pay, no HTML sinks).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sheetModel, payLabel, resultLine, runCheckout, resumeCheckout, payAvailable, PORTONE_SDK } from '../payclient.js';
import { REFUND_RULES } from '../payrules.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PRODUCTS = { ok: true, mode: 'test', test: true, products: [{ id: 'gift_long', name: '크게 걸기', price: 3900, perks: ['큰 화면에 24시간'] }, { id: 'gift_video', name: '축하 영상 세트', price: 7900, perks: ['영상'] }] };
const ID = 'o_' + 'A'.repeat(20);
function fakeApi(over = {}) {
  const calls = [];
  const ok = (x) => ({ ok: true, status: 200, ...x });
  const api = {
    config: async () => ({ on: true, mode: 'test' }), products: async () => PRODUCTS,
    create: async (b) => { calls.push(['create', b]); return ok({ order: { id: ID, st: 'CREATED' } }); },
    pay: async (id) => { calls.push(['pay', id]); return ok({ order: { id, st: 'PAYMENT_PENDING' }, sdk: { storeId: 's', channelKey: 'c', paymentId: id, orderName: '크게 걸기', totalAmount: 3900, currency: 'CURRENCY_KRW', payMethod: 'CARD' } }); },
    confirm: async (id) => { calls.push(['confirm', id]); return ok({ order: { id, st: 'PUBLISHED' } }); },
    fail: async (id, code) => { calls.push(['fail', id, code]); return ok({}); },
    mock: async (id, r) => { calls.push(['mock', id, r]); return ok({}); },
    ...over,
  };
  return { api, calls };
}
function fakeUi(mockAnswer = 'paid') { const seen = []; return { seen, busy: (t) => seen.push(['busy', t]), error: (t) => seen.push(['error', t]), price: (n) => seen.push(['price', n]), mockWindow: async () => mockAnswer, done: (o) => seen.push(['done', o?.st]) }; }

describe('what the sheet shows before paying', () => {
  it('prices with VAT, perks not active, the refund rules, the test badge in test mode', () => {
    const m = sheetModel(PRODUCTS);
    assert.equal(m.badge, '테스트 결제'); assert.match(m.testNote, /실제로 돈이 나가지 않아요/);
    assert.deepEqual(m.rows.map((r) => [r.priceText, r.active, r.checked]), [['3,900원', false, true], ['7,900원', false, false]]);
    assert.deepEqual(m.refund.slice(0, 2), [REFUND_RULES.before, REFUND_RULES.after]);
    assert.match(m.afterPay, /공개된 뒤에 적용/); assert.match(m.vat, /부가세 포함/);
    assert.equal(sheetModel({ ...PRODUCTS, test: false }).badge, '', 'no badge for live');
    assert.equal(payLabel(14900), '14,900원 결제하기');
  });
  it('the result line never calls a perk active before PUBLISHED', () => {
    assert.match(resultLine({ st: 'PUBLISHED' }).text, /혜택이 적용됐어요/);
    for (const st of ['CREATED', 'PAYMENT_PENDING', 'PAID', 'PUBLISH_PENDING', 'FAILED', 'CANCELLED', 'REFUNDED']) assert.doesNotMatch(resultLine({ st }).text, /적용됐어요/, st);
    assert.equal(resultLine({ st: 'PAYMENT_PENDING' }).tone, 'wait');
  });
  it('payAvailable is null when /rt/config has no pay or nothing is on sale', async () => {
    assert.equal(await payAvailable({}, { config: async () => null, products: async () => PRODUCTS }), null);
    assert.equal(await payAvailable({}, { config: async () => ({ on: true }), products: async () => ({ ok: false, status: 403 }) }), null);
    assert.equal(await payAvailable({}, { config: async () => ({ on: true }), products: async () => ({ ok: true, products: [] }) }), null);
    assert.equal((await payAvailable({}, { config: async () => ({ on: true }), products: async () => PRODUCTS })).products.length, 2);
  });
});

describe('the flow', () => {
  it('mock: create with the shown price, pay, the fake window, confirm', async () => {
    const { api, calls } = fakeApi(), ui = fakeUi('paid');
    const r = await runCheckout({ api, ui, mode: 'mock', boardId: 'abcdefgh', kind: 'gift', ref: '', product: 'gift_long', shown: 3900 });
    assert.equal(r.ok, true);
    assert.deepEqual(calls.map((c) => c[0]), ['create', 'pay', 'mock', 'confirm']);
    assert.deepEqual(calls[0][1], { product: 'gift_long', kind: 'gift', boardId: 'abcdefgh', ref: '', shown: 3900 });
  });
  it('mock window closed: reported as a failure, nothing confirmed', async () => {
    const { api, calls } = fakeApi(), ui = fakeUi(null);
    assert.equal((await runCheckout({ api, ui, mode: 'mock', product: 'gift_long', shown: 3900 })).code, 'closed');
    assert.deepEqual(calls.map((c) => c[0]), ['create', 'pay', 'fail']);
  });
  it('PortOne: the SDK gets what /pay returned plus the return address; an SDK error is reported and not confirmed', async () => {
    const { api, calls } = fakeApi(), ui = fakeUi(); let got = null;
    const r = await runCheckout({ api, ui, mode: 'test', product: 'gift_long', shown: 3900, redirectUrl: 'https://x.example/g?kts_pay=1', requestPayment: async (sdk) => { got = sdk; return { paymentId: sdk.paymentId }; } });
    assert.equal(r.ok, true); assert.equal(got.storeId, 's'); assert.equal(got.redirectUrl, 'https://x.example/g?kts_pay=1'); assert.equal(got.totalAmount, 3900);
    const b = fakeApi(), ui2 = fakeUi();
    const bad = await runCheckout({ api: b.api, ui: ui2, mode: 'test', product: 'gift_long', shown: 3900, requestPayment: async () => ({ code: 'FAILURE_TYPE_PG', message: '카드 거절' }) });
    assert.equal(bad.ok, false); assert.deepEqual(b.calls.map((c) => c[0]), ['create', 'pay', 'fail']); assert.deepEqual(ui2.seen.at(-1), ['error', '카드 거절']);
  });
  it('a price that moved: the new price is shown and nothing is paid', async () => {
    const { api, calls } = fakeApi({ create: async () => ({ ok: false, status: 409, code: 'price', price: 4900, error: '가격이 바뀌었어요.' }) }), ui = fakeUi();
    const r = await runCheckout({ api, ui, mode: 'test', product: 'gift_long', shown: 3900 });
    assert.equal(r.code, 'price'); assert.deepEqual(ui.seen.filter((x) => x[0] === 'price'), [['price', 4900]]); assert.equal(calls.length, 0);
  });
  it('the mobile return: paymentId confirms, a code is a failure, other pages do nothing', async () => {
    const { api, calls } = fakeApi();
    assert.equal(await resumeCheckout(api, { search: '?x=1' }), null);
    assert.equal(await resumeCheckout(api, { search: '?paymentId=' + ID }), null, 'not our return');
    assert.equal((await resumeCheckout(api, { search: '?kts_pay=1&paymentId=' + ID })).order.st, 'PUBLISHED');
    assert.equal((await resumeCheckout(api, { search: '?kts_pay=1&paymentId=' + ID + '&code=FAILURE_TYPE_PG&message=x' })).ok, false);
    assert.deepEqual(calls.map((c) => c[0]), ['confirm', 'fail']);
  });
});

describe('source checks', () => {
  const src = read('payclient.js');
  it('loads the PortOne SDK only from its CDN and only from loadSdk (on pay)', () => {
    assert.equal(PORTONE_SDK, 'https://cdn.portone.io/v2/browser-sdk.js');
    assert.equal(src.match(/cdn\.portone\.io/g).length, 1);
    assert.match(src, /requestPayment: async \(sdk\) => \(await loadSdk\(doc\)\)\.requestPayment\(sdk\)/);
    assert.doesNotMatch(src, /^loadSdk\(/m, 'not at load time');
  });
  it('no HTML sinks; shared modules without a query', () => {
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    assert.match(src, /from '\.\/payrules\.js';/); assert.match(src, /from '\.\/plaza-account\.js';/);
  });
});

describe('the operator section (admin-order.js)', () => {
  const src = read('admin-order.js'), html = read('admin.html');
  it('is one module line in admin.html, served behind the login like the other admin-*.js', () => {
    assert.match(html, /<script type="module" src="\.\/admin-order\.js\?v=\d+"><\/script>/);
  });
  it('talks only to the operator routes, writes text only, and needs a reason for refunds and manual marks', () => {
    for (const m of src.matchAll(/api\('([^']+)'/g)) assert.match(m[1], /^\/rt\/admin\/(order|orders)/, m[1]);
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    assert.match(src, /이유를 적어 주세요/); assert.match(src, /from '\.\/payrules\.js';/);
  });
  it('shows WAU in the 지표 section', () => { assert.match(html, /d\.wau\.map/); });
});

describe('terms and privacy: prepared payment clauses that do not claim payments exist', () => {
  it('terms: 결제 방법(준비 중) right after the refund section', async () => {
    const { policyDoc } = await import('../legal.js');
    const t = policyDoc('terms').sections, i = t.findIndex((s) => s.h === '결제 방법(준비 중)');
    assert.equal(t[i - 1].h, '유료 상품의 취소와 환불');
    for (const w of ['지금은 결제를 받지 않습니다', '결제대행사', '다시 확인', '테스트 결제', '5년']) assert.ok(t[i].p.includes(w), w);
    const p = policyDoc('privacy').sections, j = p.findIndex((s) => s.h === '결제(준비 중)');
    assert.equal(p[j + 1].h, '처리 위탁과 국외 이전');
    for (const w of ['지금은 결제를 받지 않아', '카드 번호나 계좌 번호', '5년', '3년', '포트원(PortOne)', '결제를 열 때 확정']) assert.ok(p[j].p.includes(w), w);
  });
});
