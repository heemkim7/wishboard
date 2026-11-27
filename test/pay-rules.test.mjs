// 주문·결제 rules (payrules.js): products, the order state machine, ids, price arms, refund rules shown before payment, the cost
// model, the switches (PAY_ON, PAY_MODE, PAY_ALLOW), what PortOne's answer means for an order, revenue and the CSV.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ST, MOVES, canMove, PRODUCTS, PRODUCT_KINDS, PRODUCT_FIXED, productId, givesOf, kindOfBoard, productList, productFault, newOrderId, ORDER_ID, armOf, REFUND_RULES, COST, costOf,
  payOn, payMode, payAllowed, payPublic, pgVerdict, channelFault, revenueOf, ordersCsv, PAY_EVENTS, PAY, isReal, kstOf,
} from '../payrules.js';
import { TIERS, ladderArm } from '../giftrules.js';

describe('the order state machine', () => {
  it('has the eight states and an explicit transition table', () => {
    assert.deepEqual(Object.keys(ST).sort(), ['CANCELLED', 'CREATED', 'FAILED', 'PAID', 'PAYMENT_PENDING', 'PUBLISHED', 'PUBLISH_PENDING', 'REFUNDED']);
    for (const s of Object.keys(ST)) assert.ok(Array.isArray(MOVES[s]), s);
    assert.deepEqual(MOVES.REFUNDED, []);
  });
  it('the happy path moves one step at a time', () => {
    const path = ['CREATED', 'PAYMENT_PENDING', 'PAID', 'PUBLISH_PENDING', 'PUBLISHED'];
    for (let i = 0; i < path.length - 1; i++) assert.ok(canMove(path[i], path[i + 1]), path[i]);
    assert.equal(canMove('CREATED', 'PAID'), false, 'no payment without its pending step');
    assert.equal(canMove('CREATED', 'PUBLISHED'), false);
    assert.equal(canMove('PAYMENT_PENDING', 'PUBLISHED'), false, 'nothing is published before PAID');
  });
  it('refunds come from money states only, and REFUNDED is the end', () => {
    for (const s of ['PAID', 'PUBLISH_PENDING', 'PUBLISHED', 'FAILED']) assert.ok(canMove(s, 'REFUNDED'), s);
    for (const s of ['CREATED', 'PAYMENT_PENDING', 'CANCELLED']) assert.equal(canMove(s, 'REFUNDED'), false, s);
    for (const s of Object.keys(ST)) assert.equal(canMove('REFUNDED', s), false, s);
  });
  it('the PG has the last word: a FAILED or CANCELLED order can still become PAID', () => {
    assert.ok(canMove('FAILED', 'PAID')); assert.ok(canMove('CANCELLED', 'PAID'));
  });
  it('unknown states never move', () => { assert.equal(canMove('X', 'PAID'), false); assert.equal(canMove('PAID', 'X'), false); assert.equal(canMove('PAID', 'PAID'), false); });
});

describe('products', () => {
  it('gift products match the price ladder the owner page shows (giftrules.js TIERS)', () => {
    for (const p of PRODUCTS.filter((x) => x.kind === 'gift')) {
      const t = TIERS.find((x) => x.t === p.tier); assert.ok(t, p.id);
      assert.equal(p.price, t.price, p.id); assert.equal(p.name, t.name, p.id);
    }
  });
  it('derived from TIERS: one product per paid tier and kind (gift, personal for 내 전광판), the tier lines as perks, its perk keys', () => {
    const paid = TIERS.filter((t) => t.t > 0);
    assert.equal(PRODUCTS.length, paid.length * 2);
    for (const kind of PRODUCT_KINDS) for (const t of paid) {
      const p = PRODUCTS.find((x) => x.kind === kind && x.tier === t.t); assert.ok(p, kind + t.t);
      assert.equal(p.id, kind + '_' + t.key); assert.equal(productId(kind, t.t), p.id);
      assert.deepEqual([...p.perks], [...t.items]); assert.deepEqual([...p.gives], [...t.gives]); assert.equal(p.price, t.price); assert.equal(p.active, true);
    }
    assert.deepEqual(PRODUCTS.filter((p) => p.kind === 'gift').map((p) => p.id), ['gift_long', 'gift_video', 'gift_tower']);
    assert.equal(productId('gift', 0), '', 'the free tier is no product'); assert.equal(productId('nope', 1), '');
    assert.deepEqual(givesOf(['gift_long']), ['long']); assert.deepEqual(givesOf(['personal_tower']).sort(), ['clean', 'long', 'tower']); assert.deepEqual(givesOf(['zzz']), []);
    assert.equal(kindOfBoard({ occ: 'me' }), 'personal'); assert.equal(kindOfBoard({ occ: 'bday' }), 'gift');
  });
  it('every product has an id, a kind, a price in KRW with VAT, perks and an active flag', () => {
    const ids = new Set();
    for (const p of PRODUCTS) {
      assert.match(p.id, /^[a-z][a-z0-9_]{2,30}$/); assert.ok(!ids.has(p.id)); ids.add(p.id);
      assert.ok(p.kind === 'gift' || p.kind === 'personal'); assert.ok(Number.isInteger(p.price) && p.price >= 100);
      assert.ok(Array.isArray(p.perks) && p.perks.length); assert.equal(typeof p.active, 'boolean');
    }
  });
  it('stored switches: only active is read; an older store\'s price, name or perks edits are never used; unknown ids are dropped', () => {
    const list = productList([{ id: 'gift_long', price: 4900, active: false, perks: ['큰 화면'], name: '크게!', arms: [{ arm: 'B', price: 5900 }] }, { id: 'zzz', price: 1 }]);
    const p = list.find((x) => x.id === 'gift_long');
    assert.equal(p.active, false); assert.equal(p.price, 3900); assert.equal(p.name, '오래 걸기'); assert.deepEqual(p.perks, [...TIERS[1].items]); assert.equal(p.kind, 'gift');
    assert.equal(list.length, PRODUCTS.length); assert.ok(!list.find((x) => x.id === 'zzz'));
  });
  it('an admin edit can only switch a product on or off', () => {
    assert.deepEqual(productFault({ id: 'gift_long', active: 'false' }), { ok: true, v: { id: 'gift_long', active: false } });
    assert.deepEqual(productFault({ id: 'gift_long', active: true }).v, { id: 'gift_long', active: true });
    assert.equal(productFault({ id: 'nope', active: true }).ok, false);
    assert.equal(productFault({ id: 'gift_long' }).ok, false, 'nothing to change');
    for (const k of ['price', 'perks', 'name', 'armB']) { const r = productFault({ id: 'gift_long', active: true, [k]: '4900' }); assert.equal(r.ok, false, k); assert.equal(r.error, PRODUCT_FIXED); }
  });
});

describe('ids and price arms', () => {
  it('order ids are o_ and 20 random letters or digits', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) { const id = newOrderId(); assert.match(id, ORDER_ID); seen.add(id); }
    assert.equal(seen.size, 200);
    assert.match(newOrderId(), /^o_[A-Za-z0-9]{20}$/);
  });
  it('the price is the board arm\'s (giftrules.js ladderArm over GIFT_ARMS), the same the owner page shows', () => {
    const p = PRODUCTS.find((x) => x.id === 'gift_video');
    assert.deepEqual(armOf(p, null), { arm: 'A', price: 7900 }, 'no ladder: arm A at the tier price');
    assert.deepEqual(armOf(p, ladderArm('abcdefgh')), { arm: 'A', price: 7900 });
    const spec = 'A:3900/7900/14900;B:2900/5900/11900', n = { A: 0, B: 0 };
    for (let i = 0; i < 300; i++) { const id = 'b' + String(i).padStart(7, '0'), l = ladderArm(id, spec), a = armOf(p, l); assert.deepEqual(armOf(p, ladderArm(id, spec)), a, 'same board, same arm'); n[a.arm]++; assert.equal(a.price, l.p[2]); assert.equal(a.price, a.arm === 'A' ? 7900 : 5900); }
    assert.ok(n.A > 90 && n.B > 90, JSON.stringify(n));
    assert.deepEqual(armOf(p, { a: 'B', p: [0, 1, 2] }), { arm: 'A', price: 7900 }, 'a ladder that does not read');
  });
});

describe('refund rules, costs', () => {
  it('the refund rules say what happens before and after publishing', () => {
    assert.match(REFUND_RULES.before, /공개되기 전/); assert.match(REFUND_RULES.before, /전액/);
    assert.match(REFUND_RULES.after, /공개된 뒤/); assert.match(REFUND_RULES.after, /제17조/);
    assert.ok(REFUND_RULES.lines.length >= 3);
  });
  it('the PG fee is known as a range; everything else is null (모름)', () => {
    assert.equal(COST.pg.lo, 0.032); assert.equal(COST.pg.hi, 0.034); assert.equal(COST.pg.vat, 0.1);
    for (const k of ['fixed', 'hosting', 'video', 'support', 'tax']) assert.equal(COST[k], null, k);
    const c = costOf(10000);
    assert.equal(c.pg.lo, 352); assert.equal(c.pg.hi, 374); assert.equal(c.fixed, null);
  });
});

describe('switches', () => {
  const local = 'localhost', prod = 'studio.wishboard.workers.dev';
  it('PAY_ON must be exactly 1', () => {
    for (const v of [undefined, '', '0', 'true', ' 1', 1, 'on']) assert.equal(payOn({ PAY_ON: v }), false, String(v));
    assert.equal(payOn({ PAY_ON: '1' }), true);
  });
  it('PAY_MODE is test unless live; mock only on a local host, otherwise nothing', () => {
    assert.equal(payMode({}, prod), 'test'); assert.equal(payMode({ PAY_MODE: 'live' }, prod), 'live'); assert.equal(payMode({ PAY_MODE: 'LIVE' }, prod), 'test');
    assert.equal(payMode({ PAY_MODE: 'mock' }, local), 'mock'); assert.equal(payMode({ PAY_MODE: 'mock' }, '127.0.0.1'), 'mock'); assert.equal(payMode({ PAY_MODE: 'mock' }, 'a.localhost'), 'mock');
    assert.equal(payMode({ PAY_MODE: 'mock' }, prod), null, 'mock on the real host turns payments off');
  });
  it('PAY_ALLOW: test mode needs the account on the list; live mode is everyone unless a list is set; mock is everyone', () => {
    assert.equal(payAllowed({}, 'test', 'user:a'), false);
    assert.equal(payAllowed({ PAY_ALLOW: 'user:a, user:b' }, 'test', 'user:b'), true);
    assert.equal(payAllowed({ PAY_ALLOW: 'user:a' }, 'test', 'user:c'), false);
    assert.equal(payAllowed({}, 'live', 'user:c'), true);
    assert.equal(payAllowed({ PAY_ALLOW: 'user:a' }, 'live', 'user:c'), false);
    assert.equal(payAllowed({}, 'mock', 'user:c'), true);
    assert.equal(payAllowed({}, null, 'user:c'), false);
  });
  it('the public config says nothing while off', () => {
    assert.equal(payPublic({}, prod), null);
    assert.equal(payPublic({ PAY_ON: '1', PAY_MODE: 'mock' }, prod), null);
    assert.deepEqual(payPublic({ PAY_ON: '1' }, prod), { on: true, mode: 'test' });
    assert.deepEqual(payPublic({ PAY_ON: '1', PAY_MODE: 'live' }, prod), { on: true, mode: 'live' });
  });
});

describe("what PortOne's answer means (pgVerdict)", () => {
  const o = (st, x = {}) => ({ id: 'o_' + 'a'.repeat(20), st, price: 7900, mode: 'test', pg_tx: '', ...x });
  const K = 'channel-key-test', C = { chan: K };
  const paid = (x = {}) => ({ status: 'PAID', id: 'o_' + 'a'.repeat(20), transactionId: 'tx1', amount: { total: 7900 }, currency: 'KRW', channel: { type: 'TEST', key: K }, ...x });
  it('PAID with the right amount and KRW: PAID; how follows the channel type', () => {
    assert.deepEqual(pgVerdict(o('PAYMENT_PENDING'), paid(), C), { to: 'PAID', how: 'test', tx: 'tx1', why: 'paid' });
    assert.equal(pgVerdict(o('PAYMENT_PENDING', { mode: 'live' }), paid({ channel: { type: 'LIVE', key: K } }), C).how, 'pg');
  });
  it('the channel: a live order only on a LIVE channel with our key; a test order only on our key; mock has none', () => {
    const live = o('PAYMENT_PENDING', { mode: 'live' });
    const v = pgVerdict(live, paid(), C); assert.equal(v.to, 'FAILED'); assert.equal(v.why, 'channel', 'a live order paid on a TEST channel gets nothing');
    assert.deepEqual(v.channel, { type: 'TEST', key: K }); assert.equal(v.tx, 'tx1');
    assert.equal(pgVerdict(live, paid({ channel: { type: 'LIVE', key: 'channel-key-other' } }), C).why, 'channel', 'another LIVE channel');
    assert.equal(pgVerdict(live, paid({ channel: { type: 'LIVE', key: K } }), { chan: '' }).why, 'channel', 'no key configured: nothing is trusted');
    assert.equal(pgVerdict(o('PAYMENT_PENDING'), paid({ channel: { type: 'TEST', key: 'channel-key-other' } }), C).why, 'channel', 'a test order on another channel');
    assert.equal(pgVerdict(o('PAYMENT_PENDING'), paid(), {}).why, 'channel');
    assert.equal(pgVerdict(o('PAYMENT_PENDING', { mode: 'mock' }), paid({ channel: { type: 'TEST' } })).to, 'PAID', 'mock: no channel to check');
    assert.equal(channelFault(o('X', { mode: 'live' }), paid({ channel: { type: 'LIVE', key: K } }), K), '');
    for (const st of ['CREATED', 'CANCELLED']) assert.equal(pgVerdict(o(st, { mode: 'live' }), paid(), C).to, 'FAILED', st);
  });
  it('a wrong amount or currency is never PAID', () => {
    assert.deepEqual(pgVerdict(o('PAYMENT_PENDING'), paid({ amount: { total: 100 } }), C), { to: 'FAILED', tx: 'tx1', why: 'amount', paid: 100, currency: 'KRW' });
    assert.equal(pgVerdict(o('PAYMENT_PENDING'), paid({ currency: 'USD' }), C).why, 'amount');
    assert.equal(pgVerdict(o('PAYMENT_PENDING'), paid({ amount: { total: '7900' } }), C).why, 'amount', 'a string is not the number');
    assert.ok(canMove('CANCELLED', 'FAILED'), 'a wrong payment after the sheet was closed is kept as FAILED');
  });
  it('an order already past PAID stays where it is (idempotent); a paid order that failed later is never re-opened', () => {
    for (const s of ['PAID', 'PUBLISH_PENDING', 'PUBLISHED']) assert.equal(pgVerdict(o(s), paid(), C).to, null, s);
    assert.deepEqual(pgVerdict(o('FAILED', { paid_at: 1 }), paid(), C), { to: null, why: 'already' });
    assert.equal(pgVerdict(o('FAILED', { paid_at: null }), paid(), C).to, 'PAID', 'a failed attempt retried with the same paymentId');
  });
  it('FAILED from the PG fails a pending order; CANCELLED refunds a paid one', () => {
    assert.equal(pgVerdict(o('PAYMENT_PENDING'), { status: 'FAILED' }).to, 'FAILED');
    assert.equal(pgVerdict(o('PAID'), { status: 'FAILED' }).to, null);
    assert.equal(pgVerdict(o('PUBLISHED'), { status: 'CANCELLED', transactionId: 'tx1' }).to, 'REFUNDED');
    assert.equal(pgVerdict(o('PAYMENT_PENDING'), { status: 'CANCELLED' }).to, null);
    for (const s of ['READY', 'PENDING', 'PAY_PENDING', 'VIRTUAL_ACCOUNT_ISSUED', 'PARTIAL_CANCELLED', 'WHATEVER']) assert.equal(pgVerdict(o('PAYMENT_PENDING'), { status: s }).to, null, s);
    assert.equal(pgVerdict(o('PAYMENT_PENDING'), null).to, null);
  });
  it('the payment must be this order', () => { assert.equal(pgVerdict(o('PAYMENT_PENDING'), paid({ id: 'o_' + 'b'.repeat(20) })).why, 'id'); });
});

describe('revenue', () => {
  const T0 = Date.parse('2027-01-10T03:00:00Z'); // 12:00 KST
  const ord = (i, x = {}) => ({ id: 'o_' + String(i).padStart(20, '0'), uid: 'user:' + (x.u ?? i), kind: 'gift', product: 'gift_video', price: 7900, arm: 'A', st: 'PUBLISHED', created_at: T0, paid_at: T0, refunded_at: null, how: 'pg', mode: 'live', ref: '', ...x });
  it('test and mock orders are left out; refunds, AOV, buyers, ref, PG cost', () => {
    const rows = [ord(1), ord(2, { u: 1, paid_at: T0 + 864e5 }), ord(3, { st: 'REFUNDED', refunded_at: T0 + 3600e3 }), ord(4, { how: 'test', mode: 'test' }), ord(5, { how: 'manual', product: 'gift_long', price: 3900, ref: 'abcdefgh' }), ord(6, { st: 'PAYMENT_PENDING', paid_at: null })];
    const r = revenueOf(rows, { firstPaid: { 'user:1': T0, 'user:3': T0, 'user:5': T0 - 30 * 864e5 }, picks: { 1: 10, 2: 20, 3: 0 }, funnel: { checkout_start: 8, pay_success: 4 } });
    assert.equal(r.paid, 4); assert.equal(r.gross, 7900 * 3 + 3900); assert.equal(r.refunds.n, 1); assert.equal(r.refunds.amount, 7900); assert.equal(r.net, r.gross - 7900);
    assert.equal(r.aov, Math.round(r.gross / 4));
    assert.deepEqual(r.buyers, { total: 3, new: 2, repeat: 1 }, 'user:1 twice, user:3 new, user:5 bought before the range');
    assert.deepEqual(r.ref, { n: 1, gross: 3900 });
    assert.equal(r.days.find((d) => d.day === '2027-01-10').paid, 3); assert.equal(r.days.find((d) => d.day === '2027-01-11').paid, 1);
    const v = r.products.find((p) => p.id === 'gift_video'); assert.equal(v.paid, 3); assert.equal(v.picks, 20); assert.equal(r.products.find((p) => p.id === 'gift_long').picks, 10); assert.equal(r.products.find((p) => p.id === 'personal_long').picks, null, 'picks shown once per tier');
    assert.equal(r.conversion.picks, Math.round((4 / 30) * 1000) / 1000, 'every paid order of a tier (both kinds) against the picks');
    assert.equal(r.conversion.checkout, 0.5);
    assert.equal(r.cost.pg.lo, Math.round(r.gross * 0.032 * 1.1)); assert.equal(r.cost.fixed, null);
    assert.equal(r.excluded, 1, 'the test order is counted apart');
  });
  it('isReal: pg or manual, paid', () => {
    assert.ok(isReal(ord(1))); assert.ok(!isReal(ord(1, { how: 'test' }))); assert.ok(!isReal(ord(1, { paid_at: null })));
  });
  it('kstOf gives the KST day', () => { assert.equal(kstOf(Date.parse('2027-01-10T15:30:00Z')), '2027-01-11'); });
});

describe('CSV', () => {
  it('quotes, escapes and defuses formulas', () => {
    const csv = ordersCsv([{ id: 'o_1', uid: 'user:x', product: 'gift_long', price: 3900, st: 'PAID', how: 'pg', mode: 'live', created_at: 0, paid_at: 0, note: '=HYPERLINK("x"), "hi"\nthere', ref: '', ref_board: '', pg_tx: '', arm: 'A', kind: 'gift', refunded_at: null }]);
    const [head, line] = csv.split('\r\n');
    assert.match(head, /^id,created_kst,paid_kst,/);
    assert.ok(line.includes('"\'=HYPERLINK(""x""), ""hi""\nthere"'), line);
    assert.ok(csv.startsWith('﻿') === false && head.startsWith('id'));
  });
});

describe('funnel names', () => {
  it('six events', () => { assert.deepEqual([...PAY_EVENTS], ['checkout_start', 'pay_success', 'pay_fail', 'publish_ok', 'publish_fail', 'refund']); assert.equal(PAY.publishTries, 3); });
});
