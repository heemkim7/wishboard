// The owner page's checkout (giftpage.js payLadder through payclient.js) and the films' watermark (giftrules.js filmMark): what the page
// shows of a board's orders (ownerOrderLine), the sheet preselecting the tier that was pressed, prices asked for the board's arm, the
// mobile return confirmed on load, the interest flow kept while checkout is closed, and source checks for what needs a browser.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ownerOrderLine, sheetModel, payApi, payAvailable } from '../payclient.js';
import { filmMark, perksOf, giftView, GIFT } from '../giftrules.js';
import { towerCard, towerFault, TOWER } from '../towerrules.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const O = (st, x = {}) => ({ id: 'o_' + 'A'.repeat(20), name: '축하 영상 세트', st, paid_at: ['CREATED', 'PAYMENT_PENDING', 'CANCELLED'].includes(st) ? null : 1, gives: st === 'PUBLISHED' ? ['long', 'clean'] : [], test: true, ...x });

describe('the order line on the owner page', () => {
  it('says 결제 대기 / 결제 완료 / 게시 중 / 게시됨 / 실패 / 환불, and applied only at 게시됨', () => {
    const want = { CREATED: '결제 대기', PAYMENT_PENDING: '결제 대기', PAID: '결제 완료', PUBLISH_PENDING: '게시 중', PUBLISHED: '게시됨', FAILED: '실패', REFUNDED: '환불' };
    for (const [st, label] of Object.entries(want)) {
      const l = ownerOrderLine([O(st)]);
      assert.equal(l.label, label, st); assert.equal(l.active, st === 'PUBLISHED', st);
      if (st !== 'PUBLISHED') { assert.doesNotMatch(l.text, /적용됐어요/, st); assert.deepEqual(l.gives, [], st); }
    }
    assert.match(ownerOrderLine([O('PUBLISHED')]).text, /적용됐어요/); assert.deepEqual(ownerOrderLine([O('PUBLISHED')]).gives, ['long', 'clean']);
    assert.match(ownerOrderLine([O('PUBLISHED')]).text, /테스트 결제/);
  });
  it('locks a second order once money was taken and kept; a cancelled order is skipped; none is null', () => {
    for (const st of ['PAID', 'PUBLISH_PENDING', 'PUBLISHED']) assert.equal(ownerOrderLine([O(st)]).locked, true, st);
    for (const st of ['CREATED', 'PAYMENT_PENDING', 'REFUNDED']) assert.equal(ownerOrderLine([O(st)]).locked, false, st);
    assert.equal(ownerOrderLine([O('FAILED')]).locked, true, 'paid but not published: the operator decides');
    assert.equal(ownerOrderLine([O('FAILED', { paid_at: null })]).locked, false);
    assert.equal(ownerOrderLine([O('CANCELLED'), O('PUBLISHED')]).st, 'PUBLISHED');
    assert.equal(ownerOrderLine([]), null); assert.equal(ownerOrderLine([O('CANCELLED')]), null);
  });
});

describe('the sheet and the prices', () => {
  const R = { ok: true, test: true, products: [{ id: 'gift_long', name: '오래 걸기', price: 3900, perks: ['a'] }, { id: 'gift_video', name: '축하 영상 세트', price: 7900, perks: ['b'] }] };
  it('the tier that was pressed is the one checked', () => {
    assert.deepEqual(sheetModel(R, 'gift_video').rows.map((r) => r.checked), [false, true]);
    assert.deepEqual(sheetModel(R, 'nope').rows.map((r) => r.checked), [true, false]);
  });
  it('the products are asked for the board (its arm) and the kind; the board orders route', async () => {
    const urls = [], api = payApi(async (u) => { urls.push(u); return new Response(JSON.stringify({ ok: true, pay: { on: true, mode: 'mock' }, products: R.products, orders: [] }), { status: 200 }); }, () => 'tok');
    await payAvailable({ kind: 'personal', boardId: 'abcdefgh' }, api); await api.boardOrders('abcdefgh');
    assert.deepEqual(urls, ['/rt/config', '/rt/order/products?kind=personal&board=abcdefgh', '/rt/order/board/abcdefgh']);
  });
});

describe('the owner page (giftpage.js)', () => {
  const src = read('giftpage.js');
  it('loads checkout only on demand, from payclient.js with the build query, with the account session', () => {
    assert.match(src, /import\('\.\/payclient\.js\?v=\d+'\)/); assert.doesNotMatch(src, /^import .*payclient/m);
    assert.match(src, /m\.payApi\(undefined, sessionToken\)/);
  });
  it('keeps the interest flow as the card, and turns it into 결제하기 only when payAvailable answers', () => {
    assert.match(src, /'🔔 열리면 알림 받기'/); assert.match(src, /payLadder\(g, box\)/);
    assert.match(src, /m\.payAvailable\(\{ kind, boardId: g\.id \}, api\)/); assert.match(src, /if \(!avail \|\| !box\.isConnected\) return;/);
    assert.match(src, /`결제하기 · \$\{won\(p\.price\)\}`/); assert.match(src, /m\.openCheckout\(\{ boardId: g\.id, kind, product: p\.id \}, api\)/);
    assert.match(src, /kind = isMe\(g\) \? 'personal' : 'gift'/);
  });
  it('shows the order state, the refund rules and the test badge; applied only by the line (게시됨)', () => {
    assert.match(src, /m\.ownerOrderLine\(orders\)/); assert.match(src, /api\.boardOrders\(g\.id\)/);
    assert.match(src, /'취소와 환불'/); assert.match(src, /avail\.badge/); assert.match(src, /line\.active \? '✓ 이 전광판에 적용됐어요'/);
  });
  it('confirms the mobile return once on load and cleans the address', () => {
    assert.match(src, /m\.resumeCheckout\(payApiOf\(m\)\)/); assert.match(src, /kts_pay=1/); assert.match(src, /history\.replaceState/);
  });
  it('the main tower card books with how paid when the board has the perk', () => {
    assert.match(src, /paid: !!r\.paid/); assert.match(src, /pick\(s, 'paid'\)/);
  });
});

describe('the films without the watermark', () => {
  it('filmMark: yes unless the view says clean; the view has clean only with the clean perk', () => {
    assert.equal(filmMark({}), true); assert.equal(filmMark(null), true); assert.equal(filmMark({ clean: 1 }), false);
    const base = { id: 'abcdefgh', st: 'live', day: '2028-01-10', a: 1, b: 2 };
    assert.equal(giftView({ ...base, pk: '' }).clean, undefined);
    assert.equal(giftView({ ...base, pk: JSON.stringify({ o: { o_x: ['long'] } }) }).clean, undefined);
    assert.equal(giftView({ ...base, pk: JSON.stringify({ o: { o_x: ['long', 'clean'] } }) }).clean, 1);
    assert.equal('pk' in giftView({ ...base, pk: JSON.stringify({ o: { o_x: ['clean'] } }) }), false);
    assert.deepEqual(perksOf('{bad'), []); assert.deepEqual(perksOf({ o: { a: ['tower', 'long', 'x'], b: ['clean'] } }), ['long', 'clean', 'tower']);
    assert.equal(GIFT.paidHours, 12);
  });
  it('the drawn film, the plaza video and the real video ask filmMark; the AI 합성 mark and the virtual-plaza line stay', () => {
    const film = read('giftfilm.js'), plaza = read('gift.js'), real = read('realvideo.js');
    assert.match(film, /if \(filmMark\(gift\)\) \{[^\n]*WISH BOARD · 무료/); assert.match(film, /가상 광장 · 실제 타임스퀘어와 무관/);
    assert.match(plaza, /if \(filmMark\(g\)\) \{[^\n]*WISH BOARD · 무료/); assert.match(plaza, /가상 광장 · 실제 타임스퀘어와 무관/);
    assert.match(real, /captionCanvas\(W \/ plate\.w, filmMark\(gift\)\)/); assert.match(real, /fillText\('AI 합성', x, y\);\n  if \(mark\) g\.fillText\('WISH BOARD · 무료'/);
  });
});

describe('메인 타워 주인공 in the rules', () => {
  const now = Date.parse('2028-01-10T03:00:00Z'), g = { id: 'abcdefgh', uid: 'user:a', st: 'live', day: '2028-01-10', a: now, b: now + 12 * 36e5, phase: 'live' };
  const m = now + 10 * 60e3;
  it('towerFault: paid needs the order; skips friends, points and the one-a-day rule; never the minute rules or the 30', () => {
    const base = { g, uid: 'user:a', how: 'paid', m, now, friends: 0 };
    assert.equal(towerFault(base), 'paid'); assert.equal(towerFault({ ...base, paid: true }), '');
    assert.equal(towerFault({ ...base, paid: true, mine: true }), '', 'one a day per maker does not hold it back');
    assert.equal(towerFault({ ...base, paid: true, dayN: TOWER.perDay }), 'sold');
    assert.equal(towerFault({ ...base, paid: true, m: Date.parse('2028-01-10T04:00:00Z') }), 'minute', 'on the hour is the teams\'');
    assert.equal(towerFault({ ...base, paid: true, boardHas: true }), 'board');
  });
  it('towerCard: with paid the card is open even when this maker has another that day', () => {
    const days = { '2028-01-10': { left: 5, mine: true } };
    assert.equal(towerCard({ g, now, days, taken: [] }).state, 'mine');
    const c = towerCard({ g, now, days, taken: [], paid: true }); assert.equal(c.state, 'open'); assert.equal(c.paid, true); assert.ok(c.minutes.some((x) => x.why === ''));
  });
});
