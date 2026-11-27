// 주문·결제 on the Worker: the /rt/order* routes, the PortOne webhook /rt/pay/hook, the operator routes /rt/admin/order*, and the Meter
// instance 'order' that keeps orders, their history, webhook ids, product edits and the funnel counters. worker.js imports this with no
// query, sends those paths here and hands over what it owns (k): adminOk, lvlNow, resolveActor, tokenOf, actOk, and the gift side's perk
// hooks perkFit, perkOn, perkOff (giftsrv.js: whether a board can take an order's perks, putting them on it, taking them off). Rules and data are in
// payrules.js. Sandbox first: every buyer route answers 404 { code: 'off' } until PAY_ON is exactly '1', and real money needs PAY_MODE=live
// with a live channel (docs/payments-setup.md). PAY_MODE=mock (local hosts only) simulates PortOne with no network: its payments live in
// table mock_pay and its webhooks are signed with MOCK_HOOK_SECRET and go through the same verification as PortOne's.
//
// PortOne V2 (https://developers.portone.io/opi/ko/integration/ready/readme):
//   paymentId = our order id. The browser SDK (https://cdn.portone.io/v2/browser-sdk.js) takes storeId, channelKey, paymentId, orderName,
//   totalAmount, currency 'CURRENCY_KRW', payMethod (https://developers.portone.io/opi/ko/integration/start/v2/checkout).
//   Server truth: GET https://api.portone.io/payments/{paymentId} with 'Authorization: PortOne <PORTONE_API_SECRET>'; status PAID, amount.total
//   equal to the order's price and currency KRW, or the order is not paid. Cancel: POST /payments/{paymentId}/cancel { storeId, reason }.
//   Webhooks (https://developers.portone.io/opi/ko/integration/webhook/readme-v2) follow Standard Webhooks (https://www.standardwebhooks.com):
//   headers webhook-id, webhook-timestamp (unix s), webhook-signature 'v1,<base64 HMAC-SHA256 of id.timestamp.body>' (several, space
//   separated); the key is the base64 after 'whsec_'. PortOne retries a failed delivery up to 5 times; unknown types are ignored. We never
//   trust the webhook body: it only names a paymentId, which is re-queried.
//
// Budget: new orders, paying and the buyer's reads answer 503 at the hard level before any DO call. Confirm, the webhook and refunds go on
// at hard (money has already moved; a handful of calls), and every DO call goes through the tallied env worker.js hands in.
// Storage (instance 'order'), kept indefinitely (전자상거래법: 대금결제 기록 5년; a Supabase ledger copy is a P1 in docs/payments-setup.md):
//   orders(id, uid, kind, product, price, arm, st, ref_board, created_at, paid_at, published_at, refunded_at, pg, pg_tx, how, mode, ref,
//          name, perks, tries, flags, note)
//   order_events(order_id, at, from_st, to_st, by, detail)     every move and mark; detail JSON
//   webhooks(webhook_id primary key, at)                         dedup of delivered webhooks (kept 30 days)
//   products(id, json, updated_at, by) + product_log(at, id, by, before, after)   the operator's edits over payrules.js PRODUCTS
//   order_days(d, k, n)                                          funnel counters '<mode>:<event>' per KST day
//   mock_pay(pid, j, at)                                         PAY_MODE=mock only: the simulated PortOne payments
import { ST, canMove, MONEY_STATES, PAY, PAY_EVENTS, PAY_ERR, ORDER_ID, newOrderId, armOf, productList, productFault, givesOf, payOn, payMode, payAllowed, pgVerdict, revenueOf, ordersCsv, kstOf, REFUND_RULES, TEST_BADGE, TEST_NOTE, ST_NAME, OWNER_ST, costOf } from './payrules.js';
import { GIFT_ID, ladderArm } from './giftrules.js';

const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...h } });
const orderM = (env) => env.METER.get(env.METER.idFromName('order'));
const giftM = (env) => env.METER.get(env.METER.idFromName('gift'));
export const PORTONE_API = 'https://api.portone.io';
export const PORTONE_SDK = 'https://cdn.portone.io/v2/browser-sdk.js';
// The mock's own signing secret: public on purpose (mock runs only on local hosts, payrules.js payMode).
export const MOCK_HOOK_SECRET = 'whsec_' + btoa('kts-mock-webhook-secret-not-for-production');

// ---- operator / test traffic ------------------------------------------------------------------------------------------------------------
// A request from the operator's device (kts_staff=1, HttpOnly, set by a successful /admin login and cleared by its logout) or from
// tools/prod-e2e.mjs (x-kts-test: 1). The
// main daily stats leave these out (/rt/event, the gift seen beacons). Anyone can send the header: it only removes their own counts.
export const STAFF_COOKIE = 'kts_staff=1; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Lax';
export const STAFF_CLEAR = 'kts_staff=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax';
export const testTraffic = (req) => { try { return req.headers.get('x-kts-test') === '1' || /(?:^|;\s*)kts_staff=1(?:\s*;|\s*$)/.test(req.headers.get('cookie') || ''); } catch { return false; } };

// ---- the store ---------------------------------------------------------------------------------------------------------------------
const js = (v) => { try { return JSON.parse(v); } catch { return null; } };
const orderOf = (r) => (r ? { id: String(r.id), uid: String(r.uid), kind: String(r.kind), product: String(r.product), price: Number(r.price), arm: String(r.arm), st: String(r.st), ref_board: String(r.ref_board || ''),
  created_at: Number(r.created_at), paid_at: r.paid_at == null ? null : Number(r.paid_at), published_at: r.published_at == null ? null : Number(r.published_at), refunded_at: r.refunded_at == null ? null : Number(r.refunded_at),
  pg: String(r.pg || ''), pg_tx: String(r.pg_tx || ''), how: String(r.how), mode: String(r.mode), ref: String(r.ref || ''), name: String(r.name || ''), perks: js(r.perks) || [], tries: Number(r.tries) || 0, flags: Number(r.flags) || 0, note: String(r.note || '') } : null);
const D_EVENT = { PAID: 'pay_success', PUBLISHED: 'publish_ok', REFUNDED: 'refund' };
// orders.flags: 1 the pay_fail counter counted this order; 2 the operator must refund it (money taken that we keep no product for: a wrong
// amount or channel, or a second paid order on one board); 4 taking its perks off the board after a refund failed (the admin retries).
export const FLAG = Object.freeze({ failCounted: 1, refundDue: 2, revokeFail: 4 });
const MONEY_SQL = "(st in ('PAID', 'PUBLISH_PENDING', 'PUBLISHED') or (st = 'FAILED' and paid_at is not null))";
// Another order on o's board that took money and kept it (the one paid order a board may have).
const otherMoney = (q, o) => !!(o?.ref_board && q.exec('select 1 from orders where ref_board = ? and id <> ? and ' + MONEY_SQL + ' limit 1', o.ref_board, o.id).toArray()[0]);
export const orderDb = {
  tables(q) {
    q.exec("create table if not exists orders(id text primary key, uid text not null, kind text not null, product text not null, price integer not null, arm text not null, st text not null, ref_board text not null default '', created_at integer not null, paid_at integer, published_at integer, refunded_at integer, pg text not null default '', pg_tx text not null default '', how text not null, mode text not null, ref text not null default '', name text not null default '', perks text not null default '[]', tries integer not null default 0, flags integer not null default 0, note text not null default '')");
    q.exec('create index if not exists orders_uid on orders(uid, created_at)');
    q.exec('create index if not exists orders_paid on orders(paid_at)');
    q.exec('create index if not exists orders_created on orders(created_at)');
    q.exec("create table if not exists order_events(order_id text not null, at integer not null, from_st text not null, to_st text not null, by text not null, detail text not null default '')");
    q.exec('create index if not exists order_events_o on order_events(order_id, at)');
    q.exec('create table if not exists webhooks(webhook_id text primary key, at integer not null)');
    q.exec('create table if not exists products(id text primary key, json text not null, updated_at integer not null, by text not null)');
    q.exec('create table if not exists product_log(at integer not null, id text not null, by text not null, before text not null, after text not null)');
    q.exec('create table if not exists order_days(d text not null, k text not null, n integer not null, primary key(d, k))');
    q.exec('create table if not exists mock_pay(pid text primary key, j text not null, at integer not null)');
  },
  one(q, id) { return orderOf(q.exec('select * from orders where id = ?', String(id || '')).toArray()[0]); },
  note(q, id, from, to, by, detail, now) { q.exec('insert into order_events(order_id, at, from_st, to_st, by, detail) values(?, ?, ?, ?, ?, ?)', id, now, from, to, String(by).slice(0, 40), detail ? JSON.stringify(detail).slice(0, 2000) : ''); },
  bump(q, mode, ev, now, n = 1) { q.exec('insert into order_days(d, k, n) values(?, ?, ?) on conflict(d, k) do update set n = n + excluded.n', kstOf(now), String(mode) + ':' + ev, n); },
  // The one way an order changes state: only from the state the caller saw, only along MOVES; set: other columns in the same update.
  move(q, id, from, to, by, detail = null, now = Date.now(), set = {}) {
    if (!canMove(from, to)) return false;
    const cols = Object.keys(set).filter((c) => /^(paid_at|published_at|refunded_at|pg|pg_tx|how|perks|tries|flags|note)$/.test(c));
    const n = q.exec('update orders set st = ?' + cols.map((c) => ', ' + c + ' = ?').join('') + ' where id = ? and st = ?', to, ...cols.map((c) => set[c]), id, from).rowsWritten;
    if (!n) return false;
    this.note(q, id, from, to, by, detail, now);
    const o = this.one(q, id), ev = D_EVENT[to];
    if (ev) this.bump(q, o.mode, ev, now);
    if (to === 'FAILED' && from === 'PAYMENT_PENDING') this.failOnce(q, o, now);
    return true;
  },
  // A PAID order starts publishing (PAID -> PUBLISH_PENDING, try 1), unless another order of its board already took money: then it stays
  // PAID, flagged for the operator's refund, and is not published (why 'have').
  afterPaid(q, id, now) {
    const o = this.one(q, id);
    if (otherMoney(q, o)) {
      q.exec('update orders set flags = flags | ? where id = ?', FLAG.refundDue, o.id); this.note(q, o.id, o.st, o.st, 'system', { refund_due: 'have' }, now);
      return { ok: true, order: this.one(q, o.id), why: 'have' };
    }
    const pub = this.move(q, o.id, 'PAID', 'PUBLISH_PENDING', 'system', { try: 1 }, now, { tries: 1 });
    return { ok: true, order: this.one(q, o.id), publish: pub };
  },
  failOnce(q, o, now) { if (o.flags & 1) return; q.exec('update orders set flags = flags | 1 where id = ?', o.id); this.bump(q, o.mode, 'pay_fail', now); },
  products(q) { return productList(q.exec('select json from products').toArray().map((r) => js(r.json)).filter(Boolean)); },
  run(q, op, a = {}, now = Date.now()) {
    if (op === 'create') {
      const p = this.products(q).find((x) => x.id === a.product);
      if (!p || !p.active || (a.kind && p.kind !== a.kind)) return { ok: false, code: 'product' };
      // One paid order per board: another that took money (and was not given back) keeps a second one out.
      if (a.board && q.exec('select 1 from orders where ref_board = ? and ' + MONEY_SQL + ' limit 1', String(a.board)).toArray()[0]) return { ok: false, code: 'have' };
      const { arm, price } = armOf(p, a.ladder);
      if (a.shown != null && Number(a.shown) !== price) return { ok: false, code: 'price', price };
      const id = newOrderId(), how = a.mode === 'live' ? 'pg' : 'test';
      q.exec("insert into orders(id, uid, kind, product, price, arm, st, ref_board, created_at, pg, how, mode, ref, name, perks) values(?, ?, ?, ?, ?, ?, 'CREATED', ?, ?, 'portone', ?, ?, ?, ?, ?)",
        id, String(a.uid), p.kind, p.id, price, arm, String(a.board || ''), now, how, String(a.mode), String(a.ref || ''), p.name, JSON.stringify(p.perks));
      this.note(q, id, '', 'CREATED', 'buyer', { price, arm, shown: a.shown ?? null }, now);
      this.bump(q, a.mode, 'checkout_start', now);
      return { ok: true, order: this.one(q, id) };
    }
    const o = a.id ? this.one(q, a.id) : null;
    const mine = () => o && (a.uid == null || o.uid === String(a.uid));
    if (op === 'get') return o && mine() ? { ok: true, order: o, events: a.events ? q.exec('select at, from_st, to_st, by, detail from order_events where order_id = ? order by at asc, rowid asc', o.id).toArray().map((r) => ({ at: Number(r.at), from: String(r.from_st), to: String(r.to_st), by: String(r.by), detail: js(r.detail) })) : undefined } : { ok: false, code: 'nf' };
    if (op === 'pay') {
      if (!mine()) return { ok: false, code: 'nf' };
      if (otherMoney(q, o)) return { ok: false, code: 'have', order: o }; // another order of this board was paid meanwhile
      if (o.st === 'CREATED') this.move(q, o.id, 'CREATED', 'PAYMENT_PENDING', 'buyer', null, now);
      const x = this.one(q, o.id); return x.st === 'PAYMENT_PENDING' ? { ok: true, order: x } : { ok: false, code: 'state', order: x };
    }
    if (op === 'cancel') {
      if (!mine()) return { ok: false, code: 'nf' };
      if (o.st === 'CANCELLED') return { ok: true, order: o };
      return this.move(q, o.id, o.st, 'CANCELLED', 'buyer', null, now) ? { ok: true, order: this.one(q, o.id) } : { ok: false, code: 'state', order: o };
    }
    if (op === 'fail') { // the buyer's page says the payment window failed or was closed: counted once, the state waits for PortOne
      if (!mine()) return { ok: false, code: 'nf' };
      this.note(q, o.id, o.st, o.st, 'buyer', { fail: String(a.code || '').slice(0, 60) }, now); this.failOnce(q, o, now);
      return { ok: true };
    }
    if (op === 'hookSeen') return { seen: !!q.exec('select 1 from webhooks where webhook_id = ?', String(a.hook || '')).toArray()[0] };
    // PortOne's payment (re-queried by the Worker) applied to the order. hook: the webhook id, recorded in the same call (a replay is dup).
    // A PAID order starts publishing at once (PAID -> PUBLISH_PENDING, try 1): publish true tells the Worker to run the publisher.
    if (op === 'apply') {
      if (a.hook) {
        if (q.exec('select 1 from webhooks where webhook_id = ?', String(a.hook)).toArray()[0]) return { ok: true, dup: true, order: o };
        q.exec('insert into webhooks(webhook_id, at) values(?, ?)', String(a.hook).slice(0, 120), now);
        if (Math.random() < 0.05) q.exec('delete from webhooks where at < ?', now - 30 * 864e5);
      }
      if (!o) return { ok: false, code: 'nf' };
      const v = pgVerdict(o, a.payment, { chan: a.chan }), by = String(a.by || 'pg');
      if (!v.to) { if (v.why !== 'already') this.note(q, o.id, o.st, o.st, by, { seen: v.why }, now); return { ok: true, order: this.one(q, o.id), why: v.why }; }
      if (v.to === 'PAID') {
        let from = o.st; if (from === 'CREATED' && this.move(q, o.id, 'CREATED', 'PAYMENT_PENDING', by, null, now)) from = 'PAYMENT_PENDING';
        if (!this.move(q, o.id, from, 'PAID', by, { tx: v.tx, how: v.how }, now, { paid_at: now, pg_tx: v.tx, how: v.how, flags: o.flags & ~FLAG.refundDue })) return { ok: true, order: this.one(q, o.id), why: 'raced' }; // a payment that now stands needs no refund
        return this.afterPaid(q, o.id, now);
      }
      if (v.to === 'FAILED') {
        // Money the PG took that we do not accept (a wrong amount or channel) is kept as FAILED with its transaction and a note, flagged for
        // the operator's refund, from whatever state the order was in (CREATED steps through PAYMENT_PENDING; an order already FAILED only
        // gets the transaction and the flag). A plain failed payment (pg_failed) moved no money.
        const money = v.why === 'amount' || v.why === 'channel', tx = v.tx || (money ? o.id : ''), detail = { why: v.why, paid: v.paid, currency: v.currency, ...(v.channel ? { channel: v.channel } : {}) };
        const set = { ...(tx ? { pg_tx: tx } : {}), ...(money ? { flags: o.flags | FLAG.refundDue, note: v.why === 'amount' ? '결제 금액이 주문과 다름: 환불 필요' : '결제 채널이 이 모드의 채널이 아님: 환불 필요' } : {}) };
        let from = o.st; if (from === 'CREATED' && this.move(q, o.id, 'CREATED', 'PAYMENT_PENDING', by, null, now)) from = 'PAYMENT_PENDING';
        if (!this.move(q, o.id, from, 'FAILED', by, detail, now, set) && money) { // already FAILED (or a state that cannot fail): keep what the PG said
          q.exec('update orders set flags = flags | ?' + (tx ? ', pg_tx = ?' : '') + ' where id = ?', FLAG.refundDue, ...(tx ? [tx] : []), o.id); this.note(q, o.id, from, from, by, detail, now);
        }
        return { ok: true, order: this.one(q, o.id), why: v.why };
      }
      if (v.to === 'REFUNDED') { const moved = this.move(q, o.id, o.st, 'REFUNDED', by, { why: v.why }, now, { refunded_at: now }); return { ok: true, order: this.one(q, o.id), why: v.why, revoke: moved }; }
      return { ok: true, order: o };
    }
    // The publisher's answer for the current try. revoke: the order was refunded while its perks went on (take them off again).
    if (op === 'published') {
      if (!o || o.st !== 'PUBLISH_PENDING') return { ok: false, code: 'state', order: o, revoke: !!(o && o.st === 'REFUNDED' && a.ok) };
      if (a.ok) { this.move(q, o.id, 'PUBLISH_PENDING', 'PUBLISHED', 'system', { board: o.ref_board || null }, now, { published_at: now, ...(Array.isArray(a.perks) ? { perks: JSON.stringify(a.perks) } : {}) }); return { ok: true, order: this.one(q, o.id) }; }
      this.bump(q, o.mode, 'publish_fail', now);
      if (o.tries >= PAY.publishTries) this.move(q, o.id, 'PUBLISH_PENDING', 'FAILED', 'system', { why: String(a.why || 'publish'), tries: o.tries }, now);
      else this.note(q, o.id, o.st, o.st, 'system', { publish_fail: String(a.why || ''), try: o.tries }, now);
      return { ok: true, order: this.one(q, o.id) };
    }
    // Another try: on the owner's read (PUBLISH_PENDING under the limit), or the operator's 다시 공개 (FAILED with money: tries start over).
    if (op === 'publishAgain') {
      if (!o) return { ok: false, code: 'nf' };
      if (o.st === 'PUBLISH_PENDING' && a.admin) { q.exec('update orders set tries = 1 where id = ? and st = ?', o.id, 'PUBLISH_PENDING'); this.note(q, o.id, o.st, o.st, 'admin', { try: 1, reset: o.tries }, now); return { ok: true, publish: true, order: this.one(q, o.id) }; } // a publish stuck at its last try
      if (o.st === 'PUBLISH_PENDING' && o.tries < PAY.publishTries) { q.exec('update orders set tries = tries + 1 where id = ? and st = ?', o.id, 'PUBLISH_PENDING'); this.note(q, o.id, o.st, o.st, String(a.by || 'system'), { try: o.tries + 1 }, now); return { ok: true, publish: true, order: this.one(q, o.id) }; }
      if (o.st === 'FAILED' && a.admin && o.paid_at != null) return this.move(q, o.id, 'FAILED', 'PUBLISH_PENDING', 'admin', { try: 1, again: true }, now, { tries: 1 }) ? { ok: true, publish: true, order: this.one(q, o.id) } : { ok: false, code: 'state', order: o };
      return { ok: true, publish: false, order: o };
    }
    if (op === 'refunded') { // the PG confirmed the cancel (or the operator returned a bank transfer by hand: manual)
      if (!o) return { ok: false, code: 'nf' };
      if (o.st === 'REFUNDED') return { ok: true, order: o, already: true };
      if (!(MONEY_STATES.includes(o.st) || (o.st === 'FAILED' && (o.pg_tx || o.paid_at != null)))) return { ok: false, code: 'state', order: o };
      return this.move(q, o.id, o.st, 'REFUNDED', String(a.by || 'admin'), { note: String(a.note || '').slice(0, PAY.noteMax), via: a.via || 'pg', key: a.key || null }, now, { refunded_at: now, note: String(a.note || '').slice(0, PAY.noteMax) }) ? { ok: true, order: this.one(q, o.id), revoke: true } : { ok: false, code: 'state', order: this.one(q, o.id) };
    }
    if (op === 'mark') { if (!o) return { ok: false, code: 'nf' }; this.note(q, o.id, o.st, o.st, String(a.by || 'admin'), a.detail || null, now); return { ok: true, order: o }; }
    // A bank transfer or a payment the operator confirmed by hand: CREATED / PAYMENT_PENDING / FAILED / CANCELLED -> PAID (how manual in
    // live mode, test otherwise), then publishing as for a PG payment.
    if (op === 'manualPaid') {
      if (!o) return { ok: false, code: 'nf' };
      let from = o.st; const note = String(a.note || '').slice(0, PAY.noteMax), how = o.mode === 'live' ? 'manual' : 'test';
      if (from === 'CREATED' && this.move(q, o.id, 'CREATED', 'PAYMENT_PENDING', 'admin', { note }, now)) from = 'PAYMENT_PENDING';
      if (!this.move(q, o.id, from, 'PAID', 'admin', { note, manual: true }, now, { paid_at: now, how, note })) return { ok: false, code: 'state', order: this.one(q, o.id) };
      return this.afterPaid(q, o.id, now);
    }
    // The operator's flags (FLAG): set and clear bits, with a note in the history.
    if (op === 'flag') {
      if (!o) return { ok: false, code: 'nf' };
      q.exec('update orders set flags = (flags | ?) & ~? where id = ?', Number(a.set) || 0, Number(a.clear) || 0, o.id);
      this.note(q, o.id, o.st, o.st, String(a.by || 'system'), a.detail || null, now);
      return { ok: true, order: this.one(q, o.id) };
    }
    if (op === 'list') {
      const w = [], args = [];
      if (a.st && ST[a.st]) { w.push('st = ?'); args.push(a.st); }
      if (a.product) { w.push('product = ?'); args.push(String(a.product)); }
      if (a.mode === 'real') w.push("how in ('pg', 'manual')"); else if (a.mode === 'test') w.push("how = 'test'"); else if (a.mode) { w.push('mode = ?'); args.push(String(a.mode)); }
      if (a.uid) { w.push('uid = ?'); args.push(String(a.uid)); }
      if (Number(a.before) > 0) { w.push('created_at < ?'); args.push(Number(a.before)); }
      const lim = Math.max(1, Math.min(PAY.listMax, Math.floor(Number(a.limit)) || 50));
      return { ok: true, orders: q.exec('select * from orders' + (w.length ? ' where ' + w.join(' and ') : '') + ' order by created_at desc limit ?', ...args, lim).toArray().map(orderOf) };
    }
    if (op === 'range') { // orders paid (or, csv, created) between two KST days; the buyers' first real payment ever; the funnel counters
      const lo = Date.parse(a.d0 + 'T00:00:00+09:00'), hi = Date.parse(a.d1 + 'T00:00:00+09:00') + 864e5, col = a.by === 'created' ? 'created_at' : 'paid_at';
      if (!(lo < hi)) return { ok: false, code: 'range' };
      const rows = q.exec('select * from orders where ' + col + ' >= ? and ' + col + ' < ? order by ' + col + ' asc limit ?', lo, hi, PAY.csvMax).toArray().map(orderOf);
      const uids = [...new Set(rows.map((r) => r.uid))].slice(0, 2000), firstPaid = {};
      for (let i = 0; i < uids.length; i += 200) { const part = uids.slice(i, i + 200);
        for (const r of q.exec("select uid, min(paid_at) f from orders where how in ('pg', 'manual') and paid_at is not null and uid in (" + part.map(() => '?').join(',') + ') group by uid', ...part).toArray()) firstPaid[String(r.uid)] = Number(r.f); }
      const days = {};
      for (const r of q.exec('select d, k, n from order_days where d >= ? and d <= ? order by d', a.d0, a.d1).toArray()) (days[String(r.d)] ||= {})[String(r.k)] = Number(r.n) || 0;
      return { ok: true, rows, firstPaid, days };
    }
    if (op === 'products') return { ok: true, products: this.products(q), log: a.log ? q.exec('select at, id, by, before, after from product_log order by at desc limit 50').toArray().map((r) => ({ at: Number(r.at), id: String(r.id), by: String(r.by), before: js(r.before), after: js(r.after) })) : undefined };
    if (op === 'productPut') {
      const v = a.v || {}; if (!v.id) return { ok: false, code: 'product' };
      const old = js(q.exec('select json from products where id = ?', v.id).toArray()[0]?.json) || { id: v.id }, next = { ...old, ...v };
      q.exec('insert into products(id, json, updated_at, by) values(?, ?, ?, ?) on conflict(id) do update set json = excluded.json, updated_at = excluded.updated_at, by = excluded.by', v.id, JSON.stringify(next), now, String(a.by || 'admin'));
      q.exec('insert into product_log(at, id, by, before, after) values(?, ?, ?, ?, ?)', now, v.id, String(a.by || 'admin'), JSON.stringify(old), JSON.stringify(next));
      return { ok: true, products: this.products(q) };
    }
    if (op === 'perks') { // what the product side asks: a board's published orders, their perks text and perk keys (gives), and who bought them
      const rows = q.exec("select perks, product, uid from orders where ref_board = ? and st = 'PUBLISHED'", String(a.board || '')).toArray();
      const products = [...new Set(rows.map((r) => String(r.product)))];
      return { ok: true, products, perks: [...new Set(rows.flatMap((r) => js(r.perks) || []))], gives: givesOf(products), uids: [...new Set(rows.map((r) => String(r.uid)))] };
    }
    if (op === 'board') { // the owner page: this buyer's orders for one board, newest first
      return { ok: true, orders: q.exec('select * from orders where ref_board = ? and uid = ? order by created_at desc limit 10', String(a.board || ''), String(a.uid || '')).toArray().map(orderOf) };
    }
    if (op === 'mockSet') { q.exec('insert into mock_pay(pid, j, at) values(?, ?, ?) on conflict(pid) do update set j = excluded.j, at = excluded.at', String(a.pid), JSON.stringify(a.j || {}), now); return { ok: true }; }
    if (op === 'mockGet') return { ok: true, payment: js(q.exec('select j from mock_pay where pid = ?', String(a.pid || '')).toArray()[0]?.j) };
    return { ok: false, code: 'op' };
  },
};

// ---- the PG: PortOne V2, or the mock ---------------------------------------------------------------------------------------------------
// -> { ok: true, payment } | { ok: false, code: 'keys' | 'nf' | 'pg', status? }
async function portoneGet(env, pid) {
  const secret = String(env.PORTONE_API_SECRET || ''); if (!secret) return { ok: false, code: 'keys' };
  const store = String(env.PORTONE_STORE_ID || '');
  let r; try { r = await fetch(PORTONE_API + '/payments/' + encodeURIComponent(pid) + (store ? '?storeId=' + encodeURIComponent(store) : ''), { headers: { authorization: 'PortOne ' + secret, accept: 'application/json' }, signal: AbortSignal.timeout(10000) }); } catch { return { ok: false, code: 'pg', status: 0 }; }
  if (r.status === 404) return { ok: false, code: 'nf', status: 404 };
  if (!r.ok) return { ok: false, code: 'pg', status: r.status };
  try { return { ok: true, payment: await r.json() }; } catch { return { ok: false, code: 'pg', status: r.status }; }
}
// -> { ok: true, how: 'done' | 'requested' | 'already' } | { ok: false, code, status? }. key goes as Idempotency-Key; PortOne answers an
// already-cancelled payment with an error type, read as 'already', and the order state check before the call is our own guard.
async function portoneCancel(env, pid, { reason, key }) {
  const secret = String(env.PORTONE_API_SECRET || ''); if (!secret) return { ok: false, code: 'keys' };
  const store = String(env.PORTONE_STORE_ID || '');
  let r; try { r = await fetch(PORTONE_API + '/payments/' + encodeURIComponent(pid) + '/cancel', { method: 'POST', headers: { authorization: 'PortOne ' + secret, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify({ ...(store ? { storeId: store } : {}), reason: String(reason || '환불').slice(0, 200) }), signal: AbortSignal.timeout(15000) }); } catch { return { ok: false, code: 'pg', status: 0 }; }
  let b = null; try { b = await r.json(); } catch { b = null; }
  if (r.ok) { const s = String(b?.cancellation?.status || ''); return s === 'SUCCEEDED' ? { ok: true, how: 'done' } : s === 'FAILED' ? { ok: false, code: 'pg', status: r.status } : { ok: true, how: 'requested' }; }
  if (/ALREADY_CANCELLED|AlreadyCancelled/i.test(String(b?.type || ''))) return { ok: true, how: 'already' };
  return { ok: false, code: 'pg', status: r.status, type: String(b?.type || '').slice(0, 60) };
}
function provider(env, mode) {
  if (mode !== 'mock') return { get: (pid) => portoneGet(env, pid), cancel: (pid, o) => portoneCancel(env, pid, o) };
  return {
    async get(pid) { const r = await orderM(env).ordOp('mockGet', { pid }); return r?.payment ? { ok: true, payment: r.payment } : { ok: false, code: 'nf', status: 404 }; },
    async cancel(pid) { const r = await orderM(env).ordOp('mockGet', { pid }); const p = r?.payment; if (!p) return { ok: false, code: 'nf' }; if (p.status === 'CANCELLED') return { ok: true, how: 'already' };
      await orderM(env).ordOp('mockSet', { pid, j: { ...p, status: 'CANCELLED' } }); return { ok: true, how: 'done' }; },
  };
}

// ---- Standard Webhooks ---------------------------------------------------------------------------------------------------------------
const b64bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytesB64 = (u8) => { let s = ''; for (const x of u8) s += String.fromCharCode(x); return btoa(s); };
async function hookMac(secret, id, ts, body) {
  const raw = String(secret || ''), k = b64bytes(raw.startsWith('whsec_') ? raw.slice(6) : raw);
  const key = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bytesB64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(id + '.' + ts + '.' + body))));
}
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
export async function hookSign(secret, id, ts, body) { return 'v1,' + (await hookMac(secret, id, ts, body)); }
// headers: a Headers. -> { ok: true, id } | { ok: false, why: 'secret' | 'headers' | 'time' | 'sig' }
export async function hookVerify(secret, headers, body, nowS = Math.floor(Date.now() / 1000)) {
  if (!secret) return { ok: false, why: 'secret' };
  const id = String(headers.get('webhook-id') || ''), ts = String(headers.get('webhook-timestamp') || ''), sig = String(headers.get('webhook-signature') || '');
  if (!id || id.length > 120 || !ts || !sig) return { ok: false, why: 'headers' };
  if (!/^\d{1,12}$/.test(ts) || Math.abs(nowS - Number(ts)) > PAY.hookToleranceS) return { ok: false, why: 'time' };
  let mac; try { mac = await hookMac(secret, id, ts, body); } catch { return { ok: false, why: 'secret' }; }
  for (const part of sig.split(' ').slice(0, 8)) { const i = part.indexOf(','); if (i > 0 && part.slice(0, i) === 'v1' && same(part.slice(i + 1), mac)) return { ok: true, id }; }
  return { ok: false, why: 'sig' };
}

// ---- publishing --------------------------------------------------------------------------------------------------------------------
// What "published" means: the order's perks are put on its board (ref_board, a gift board or a 내 전광판, still there and the buyer's) by
// the gift side (k.perkOn, giftsrv.js giftPerkOn: 오래 걸기 makes the window GIFT.paidHours, the films lose the watermark, the main tower
// minute can be booked with how 'paid'), and only then is the order PUBLISHED. A board that cannot take them (gone, someone else's, no
// screen for 12 hours) is a failed try (PAY.publishTries, then FAILED for the operator: 다시 공개 or a refund). KIT: the kit of the request
// that came last (the Worker's perk hooks); without one (this file alone) only the board's owner is checked.
let KIT = null;
async function boardPublisher(env, o, ctx) {
  if (!GIFT_ID.test(o.ref_board)) return { ok: false, why: 'board' };
  if (KIT?.perkOn) { const r = await KIT.perkOn(env, ctx, { board: o.ref_board, uid: o.uid, order: o.id, gives: givesOf([o.product]) }); return r?.ok ? { ok: true, perks: o.perks } : { ok: false, why: String(r?.why || 'perk') }; }
  const g = await giftM(env).giftGet(o.ref_board, Date.now());
  if (!g) return { ok: false, why: 'gone' };
  return String(g.uid) === o.uid ? { ok: true, perks: o.perks } : { ok: false, why: 'owner' };
}
export const PUBLISHERS = { gift: boardPublisher, personal: boardPublisher };
async function publish(env, o, ctx = null) {
  let r; try { r = await (PUBLISHERS[o.kind] || (async () => ({ ok: false, why: 'kind' })))(env, o, ctx); } catch { r = { ok: false, why: 'error' }; }
  const x = await orderM(env).ordOp('published', { id: o.id, ok: !!r?.ok, perks: r?.perks, why: r?.why }, Date.now());
  if (x?.revoke) await revoke(env, x.order, ctx); // refunded while the perks went on
  return x?.order || o;
}
// A refund takes the order's perks off its board again (k.perkOff, giftsrv.js giftPerkOff: the window back to GIFT.hours, or to now when
// that is already past; the films carry the watermark again; a paid main tower minute that has not started is let go, never as points).
// Never throws: the order is REFUNDED whatever the board says. A failure is kept on the order (FLAG.revokeFail, 'revoke_fail' in its
// history) for the operator's 혜택 다시 떼기 (POST /rt/admin/order/<id>/revoke); a later success clears it. -> true when the perks are off.
async function revoke(env, o, ctx = null) {
  if (!o || o.st !== 'REFUNDED' || !GIFT_ID.test(o.ref_board)) return true;
  let r = null; try { r = KIT?.perkOff ? await KIT.perkOff(env, ctx, { board: o.ref_board, order: o.id }) : null; } catch { r = null; }
  const ok = !!r?.ok;
  if (!ok || (o.flags & FLAG.revokeFail)) { try { await orderM(env).ordOp('flag', ok ? { id: o.id, clear: FLAG.revokeFail, detail: { revoked: true } } : { id: o.id, set: FLAG.revokeFail, detail: { revoke_fail: String(r?.why || (KIT?.perkOff ? 'error' : 'nohook')) } }, Date.now()); } catch { /* the next try records it */ } }
  return ok;
}
// The perks a board's published orders carry (for the product side; one DO call): { ok, products, perks (text), gives (perk keys), uids }.
export async function orderPerks(env, board) { try { return await orderM(env).ordOp('perks', { board }); } catch { return { ok: false, products: [], perks: [], gives: [], uids: [] }; } }

// ---- the routes --------------------------------------------------------------------------------------------------------------------
export const orderPath = (p) => p === '/rt/order' || p.startsWith('/rt/order/') || p === '/rt/pay/hook' || p === '/rt/admin/orders' || p === '/rt/admin/orders.csv' || p.startsWith('/rt/admin/order/') || p === '/rt/admin/order-products' || p === '/rt/admin/order-revenue';
const no = (code, s, extra = {}) => J({ ok: false, code, error: PAY_ERR[code] || PAY_ERR.down, ...extra }, s);
const OFF = () => no('off', 404);
async function body(req, max = 4000) {
  const n = Number(req.headers.get('content-length') || 0); if (n > max) return null;
  let t = ''; try { t = await req.text(); } catch { return null; } if (t.length > max) return null; if (!t) return {};
  try { const b = JSON.parse(t); return b && typeof b === 'object' && !Array.isArray(b) ? b : null; } catch { return null; }
}
const hardOf = async (k, env) => { try { return (await k.lvlNow(env)) >= 2; } catch { return false; } };
// The buyer's view of an order: no account ids of others, perks marked active only once PUBLISHED.
export function orderView(o) {
  return { id: o.id, kind: o.kind, product: o.product, name: o.name, price: o.price, st: o.st, stName: ST_NAME[o.st] || o.st, ownerSt: OWNER_ST[o.st] || o.st, board: o.ref_board || null,
    created_at: o.created_at, paid_at: o.paid_at, published_at: o.published_at, refunded_at: o.refunded_at, perks: o.perks, perksActive: o.st === 'PUBLISHED', gives: o.st === 'PUBLISHED' ? givesOf([o.product]) : [], test: o.how === 'test',
    ...(o.flags & FLAG.refundDue && o.st !== 'REFUNDED' ? { refundDue: true } : {}) }; // refundDue: money we keep no product for; the operator refunds it
}
let PCACHE = { at: 0, list: null };
async function productsCached(env, now = Date.now()) {
  if (PCACHE.list && now - PCACHE.at < PAY.productCacheMs && now >= PCACHE.at) return PCACHE.list;
  const r = await orderM(env).ordOp('products', {}); PCACHE = { at: now, list: r.products }; return r.products;
}
export const orderCacheDrop = () => { PCACHE = { at: 0, list: null }; }; // tests and admin edits
// The products by id with their defaults (kind, tier, gives); whether one is on sale is the store's (create).
let PBY = null; const productsBy = () => (PBY ||= new Map(productList().map((x) => [x.id, x])));
// Without the gift side's hook (this file alone): the board must be the buyer's; its kind from its occasion.
async function ownBoard(env, board, uid) {
  const g = await giftM(env).giftGet(board, Date.now());
  return g && String(g.uid) === uid ? { ok: true, kind: String(g.occ) === 'me' ? 'personal' : 'gift', ref: String(g.ref || '') } : { ok: false, code: 'board' };
}

export async function orderApi(req, env, ctx, u, k) {
  const p = u.pathname; KIT = k;
  if (p.startsWith('/rt/admin/')) return adminApi(req, env, ctx, u, k);
  const mode = payMode(env, u.hostname);
  if (!payOn(env) || !mode) return OFF();
  if (p === '/rt/pay/hook') return hookApi(req, env, ctx, mode);
  const actor = await k.resolveActor(env, k.tokenOf(req));
  if (!actor || actor.guest || actor.anon || !String(actor.id).startsWith('user:')) return no('login', 401);
  if (!payAllowed(env, mode, actor.id)) return no('allow', 403);
  if (p === '/rt/order/products') {
    if (req.method !== 'GET') return J({ err: 'get' }, 405);
    if (!(PCACHE.list && Date.now() - PCACHE.at < PAY.productCacheMs) && (await hardOf(k, env))) return no('busy', 503);
    let list; try { list = await productsCached(env); } catch { return no('down', 503); }
    // board: the board the page is for; its arm sets the prices (the ones its owner page showed). Without one, arm A.
    const kind = u.searchParams.get('kind') || '', bd = u.searchParams.get('board') || '', ladder = GIFT_ID.test(bd) ? ladderArm(bd, env.GIFT_ARMS) : null;
    const products = list.filter((x) => x.active && (!kind || x.kind === kind)).map((x) => { const a = armOf(x, ladder); return { id: x.id, kind: x.kind, tier: x.tier, name: x.name, price: a.price, arm: a.arm, perks: x.perks, gives: x.gives }; });
    return J({ ok: true, mode, test: mode !== 'live', badge: mode !== 'live' ? TEST_BADGE : '', testNote: mode !== 'live' ? TEST_NOTE : '', refund: REFUND_RULES, products, sdk: mode === 'mock' ? null : PORTONE_SDK });
  }
  const bm = /^\/rt\/order\/board\/([0-9a-z]{8})$/.exec(p);
  if (bm) { // GET /rt/order/board/<board id>: the owner page's order states for that board (this buyer's only); a publish still pending gets its next try
    if (req.method !== 'GET') return J({ err: 'get' }, 405);
    if (await hardOf(k, env)) return no('busy', 503);
    let r; try { r = await orderM(env).ordOp('board', { board: bm[1], uid: actor.id }); } catch { return no('down', 503); }
    const orders = []; let asked = 0;
    for (let o of r?.orders || []) {
      // A payment still pending a minute after the order was made (the buyer closed the page before confirm, and no webhook came): PortOne
      // is asked again here, at most once a minute per order in this isolate and two orders a read (no cron).
      if (o.st === 'PAYMENT_PENDING' && Date.now() - o.created_at > PEND_MS && asked < 2 && pendDue(o.id)) { asked++; try { const s = await settle(env, ctx, mode, o, 'pg:owner'); if (s.order) o = s.order; } catch { /* the next read asks again */ } }
      if (o.st === 'PUBLISH_PENDING') { try { const a = await orderM(env).ordOp('publishAgain', { id: o.id, by: 'buyer' }, Date.now()); if (a?.publish) o = await publish(env, a.order, ctx); } catch { /* the next read tries again */ } }
      orders.push(orderView(o));
    }
    return J({ ok: true, orders, refund: REFUND_RULES });
  }
  if (req.method !== 'POST' && !(req.method === 'GET' && ORDER_ID.test(p.slice('/rt/order/'.length)))) return J({ err: 'method' }, 405);
  if (p === '/rt/order') {
    if (await hardOf(k, env)) return no('busy', 503); // before any DO call
    if (!(await k.actOk(env, 'misc', actor.id))) return no('rate', 429, {});
    const b = await body(req); if (!b) return no('down', 400);
    // Every product is for a board: a gift board (kind gift) or a 내 전광판 (kind personal), the buyer's own. The board decides the kind,
    // its arm the price (the one its page showed), and the gift side whether its perks can be delivered (the window not over, a screen
    // for 12 hours, a main tower place left): one gift DO call (k.perkFit), so nobody pays for a perk the board cannot get.
    const product = String(b.product || ''), board = String(b.boardId || '');
    if (!GIFT_ID.test(board)) return no('board', 400);
    const want = productsBy().get(product); if (!want || (b.kind && b.kind !== want.kind)) return no('product', 400);
    let fit = null;
    try { fit = k.perkFit ? await k.perkFit(env, { board, uid: actor.id, gives: want.gives }) : await ownBoard(env, board, actor.id); } catch { return no('down', 503); }
    if (!fit?.ok) return !fit || fit.code === 'board' ? no('board', 403) : no(fit.code, 409);
    if (fit.kind !== want.kind) return no('product', 400);
    // ref (받는 사람 페이지에서 온 주문): the board this one was made from, as the gift store keeps it (another account's board, set when it
    // was made). The buyer's own b.ref is not taken: revenue attribution never comes from what a page sends.
    const ref = GIFT_ID.test(String(fit.ref || '')) && fit.ref !== board ? String(fit.ref) : '';
    let r; try { r = await orderM(env).ordOp('create', { uid: actor.id, product, kind: want.kind, board, ref, mode, ladder: ladderArm(board, env.GIFT_ARMS), shown: b.shown == null ? null : Number(b.shown) }, Date.now()); } catch { return no('down', 503); }
    if (!r?.ok) return r?.code === 'price' ? no('price', 409, { price: r.price }) : r?.code === 'have' ? no('have', 409) : no(r?.code === 'product' ? 'product' : 'down', r?.code === 'product' ? 400 : 503);
    return J({ ok: true, order: orderView(r.order) });
  }
  const m = /^\/rt\/order\/(o_[A-Za-z0-9]{20})(?:\/(pay|confirm|fail|cancel|mock))?$/.exec(p);
  if (!m) return J({ err: 'not found' }, 404);
  const id = m[1], sub = m[2] || '';
  if (sub === 'mock' && mode !== 'mock') return J({ err: 'not found' }, 404); // the fake payment window exists only in mock (local hosts)
  if (!sub) { // GET /rt/order/<id>: the owner's read; a publish still pending gets its next try here
    if (await hardOf(k, env)) return no('busy', 503);
    let r; try { r = await orderM(env).ordOp('get', { id, uid: actor.id }); } catch { return no('down', 503); }
    if (!r?.ok) return no('nf', 404);
    let o = r.order;
    if (o.st === 'PUBLISH_PENDING') { try { const a = await orderM(env).ordOp('publishAgain', { id, by: 'buyer' }, Date.now()); if (a?.publish) o = await publish(env, a.order, ctx); } catch { /* the next read tries again */ } }
    return J({ ok: true, order: orderView(o), refund: REFUND_RULES });
  }
  if (sub !== 'confirm' && sub !== 'mock' && (await hardOf(k, env))) return no('busy', 503);
  if (!(await k.actOk(env, 'misc', actor.id))) return no('rate', 429);
  const b = (await body(req)) || {};
  if (sub === 'pay') {
    const store = String(env.PORTONE_STORE_ID || ''), chan = String(env.PORTONE_CHANNEL_KEY || '');
    if (mode !== 'mock' && (!store || !chan)) return no('keys', 503);
    let r; try { r = await orderM(env).ordOp('pay', { id, uid: actor.id }, Date.now()); } catch { return no('down', 503); }
    if (!r?.ok) return r?.code === 'nf' ? no('nf', 404) : r?.code === 'have' ? no('have', 409) : no('state', 409, { order: r.order ? orderView(r.order) : null });
    const o = r.order;
    const sdk = mode === 'mock' ? { mock: true, paymentId: o.id, orderName: o.name, totalAmount: o.price, currency: 'CURRENCY_KRW' }
      : { storeId: store, channelKey: chan, paymentId: o.id, orderName: o.name, totalAmount: o.price, currency: 'CURRENCY_KRW', payMethod: 'CARD' };
    return J({ ok: true, mode, order: orderView(o), sdk });
  }
  if (sub === 'cancel' || sub === 'fail') {
    let r; try { r = await orderM(env).ordOp(sub, { id, uid: actor.id, code: b.code }, Date.now()); } catch { return no('down', 503); }
    if (!r?.ok) return r?.code === 'nf' ? no('nf', 404) : no('state', 409);
    return J({ ok: true, ...(r.order ? { order: orderView(r.order) } : {}) });
  }
  // confirm and mock: the owner's order first
  let g; try { g = await orderM(env).ordOp('get', { id, uid: actor.id }); } catch { return no('down', 503); }
  if (!g?.ok) return no('nf', 404);
  if (sub === 'mock') { // the simulated payment window (mock only): the payment, then PortOne's webhook, signed and verified like the real one
    const result = ['paid', 'failed', 'amount'].includes(b.result) ? b.result : 'paid', o = g.order;
    const payment = { id: o.id, status: result === 'failed' ? 'FAILED' : 'PAID', transactionId: 'mock-' + o.id.slice(2, 12), amount: { total: result === 'amount' ? o.price - 100 : o.price }, currency: 'KRW', channel: { type: 'TEST' }, storeId: 'store-mock' };
    await orderM(env).ordOp('mockSet', { pid: o.id, j: payment }, Date.now());
    const hook = await mockHook(env, ctx, u, 'Transaction.' + (result === 'failed' ? 'Failed' : 'Paid'), o.id);
    return J({ ok: true, hook: hook.status });
  }
  return confirm(env, ctx, mode, g.order, 'pg:confirm');
}

// The channel key a payment must have come through (payrules.js channelFault): the configured one; mock has none.
const chanOf = (env, mode) => (mode === 'mock' ? '' : String(env.PORTONE_CHANNEL_KEY || ''));
// PortOne asked about order o and its answer applied, then published or its perks taken off. -> { order, why } | { code } (keys, nf, pg, down).
async function settle(env, ctx, mode, o, by) {
  const got = await provider(env, mode).get(o.id);
  if (!got.ok) return { code: got.code, order: o };
  let r; try { r = await orderM(env).ordOp('apply', { id: o.id, payment: got.payment, by, chan: chanOf(env, mode) }, Date.now()); } catch { return { code: 'down', order: o }; }
  if (!r?.ok) return { code: 'gone', order: o };
  let x = r.order; if (r.publish) x = await publish(env, x, ctx); if (r.revoke) await revoke(env, x, ctx);
  return { order: x, why: r.why };
}
const PEND_MS = 60000, PEND = new Map(); // order id -> when this isolate last asked PortOne about it from the owner's read
const pendDue = (id, now = Date.now()) => { const at = PEND.get(id); if (at && now - at < PEND_MS && now >= at) return false; PEND.delete(id); if (PEND.size >= 500) PEND.delete(PEND.keys().next().value); PEND.set(id, now); return true; };
async function confirm(env, ctx, mode, o, by) {
  const s = await settle(env, ctx, mode, o, by);
  if (s.code) return s.code === 'keys' ? no('keys', 503) : s.code === 'nf' ? J({ ok: true, order: orderView(o), pending: true }) : s.code === 'gone' ? no('nf', 404) : s.code === 'down' ? no('down', 503) : no('pg', 502);
  const x = s.order;
  if (s.why === 'amount' || s.why === 'channel') return J({ ok: false, code: s.why, error: PAY_ERR[s.why], order: orderView(x) }, 409);
  if (s.why === 'have' || (x.st === 'PAID' && x.flags & FLAG.refundDue)) return J({ ok: false, code: 'twice', error: PAY_ERR.twice, order: orderView(x) }, 409); // also when the webhook got there first
  return J({ ok: true, order: orderView(x) });
}

// POST /rt/pay/hook: verify, dedup, re-query, apply. 400 for a bad signature (PortOne shows it failed), 503 when PortOne could not be asked
// (it retries), 200 otherwise (also for types and payments that are not ours).
async function hookApi(req, env, ctx, mode, raw = null) {
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const text = raw ?? await (async () => { const n = Number(req.headers.get('content-length') || 0); if (n > 65536) return null; try { const t = await req.text(); return t.length > 65536 ? null : t; } catch { return null; } })();
  if (text == null) return J({ ok: false, why: 'size' }, 413);
  const secret = mode === 'mock' ? MOCK_HOOK_SECRET : String(env.PORTONE_WEBHOOK_SECRET || '');
  if (!secret) return J({ ok: false, why: 'keys' }, 503);
  const v = await hookVerify(secret, req.headers, text);
  if (!v.ok) return J({ ok: false, why: v.why }, 400);
  let b = null; try { b = JSON.parse(text); } catch { return J({ ok: false, why: 'json' }, 400); }
  const pid = String(b?.data?.paymentId || '');
  if (!String(b?.type || '').startsWith('Transaction.') || !ORDER_ID.test(pid)) return J({ ok: true, ignored: 'type' });
  if (mode !== 'mock' && env.PORTONE_STORE_ID && b?.data?.storeId && String(b.data.storeId) !== String(env.PORTONE_STORE_ID)) return J({ ok: true, ignored: 'store' });
  try { if ((await orderM(env).ordOp('hookSeen', { hook: v.id }))?.seen) return J({ ok: true, dup: true }); } catch { return J({ ok: false }, 503); }
  const got = await provider(env, mode).get(pid);
  if (!got.ok) return got.code === 'nf' ? J({ ok: true, ignored: 'payment' }) : J({ ok: false, why: got.code }, 503);
  let r; try { r = await orderM(env).ordOp('apply', { id: pid, payment: got.payment, by: 'pg:hook', hook: v.id, chan: chanOf(env, mode) }, Date.now()); } catch { return J({ ok: false }, 503); }
  if (r?.dup) return J({ ok: true, dup: true });
  if (!r?.ok) return J({ ok: true, ignored: 'order' });
  if (r.publish) await publish(env, r.order, ctx);
  if (r.revoke) await revoke(env, r.order, ctx);
  return J({ ok: true });
}
// The mock's webhook: a signed Standard Webhooks delivery handed to the same handler.
async function mockHook(env, ctx, u, type, pid) {
  const id = 'msg_mock_' + newOrderId().slice(2), ts = String(Math.floor(Date.now() / 1000)), text = JSON.stringify({ type, timestamp: new Date().toISOString(), data: { storeId: 'store-mock', paymentId: pid, transactionId: 'mock-' + pid.slice(2, 12) } });
  const h = new Headers({ 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': await hookSign(MOCK_HOOK_SECRET, id, ts, text) });
  return hookApi(new Request(new URL('/rt/pay/hook', u).href, { method: 'POST', headers: h, body: text }), env, ctx, 'mock', text);
}

// ---- the operator's routes (behind the admin session, adminOk); they work whether PAY_ON is on or off ----------------------------------
const KST_DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayIn = (v, dflt) => (KST_DAY.test(String(v || '')) ? String(v) : dflt);
const shift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
async function adminApi(req, env, ctx, u, k) {
  if (!k.adminOk(env, req)) return J({ err: 'admin' }, 401);
  const p = u.pathname, M = orderM(env), now = Date.now(), mode = payMode(env, u.hostname);
  const sw = { on: payOn(env), mode, allow: String(env.PAY_ALLOW || '').split(',').map((x) => x.trim()).filter(Boolean).length, keys: { store: !!env.PORTONE_STORE_ID, channel: !!env.PORTONE_CHANNEL_KEY, api: !!env.PORTONE_API_SECRET, hook: !!env.PORTONE_WEBHOOK_SECRET } };
  try {
    if (p === '/rt/admin/orders' && req.method === 'GET') {
      const s = u.searchParams, r = await M.ordOp('list', { st: s.get('st') || '', product: s.get('product') || '', mode: s.get('mode') || '', uid: s.get('uid') || '', before: Number(s.get('before')) || 0, limit: Number(s.get('limit')) || 50 });
      return J({ ok: true, orders: r.orders, sw });
    }
    if (p === '/rt/admin/orders.csv' && req.method === 'GET') {
      const d1 = dayIn(u.searchParams.get('d1'), kstOf(now)), d0 = dayIn(u.searchParams.get('d0'), shift(d1, -29));
      const r = await M.ordOp('range', { d0, d1, by: 'created' });
      return new Response('﻿' + ordersCsv(r.rows || []), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="orders-${d0}-${d1}.csv"`, 'cache-control': 'no-store' } });
    }
    if (p === '/rt/admin/order-products') {
      if (req.method === 'GET') return J({ ...(await M.ordOp('products', { log: true })), sw });
      if (req.method !== 'POST') return J({ err: 'method' }, 405);
      const b = await body(req); if (!b) return no('down', 400);
      const f = productFault(b); if (!f.ok) return J({ ok: false, error: f.error }, 400);
      const r = await M.ordOp('productPut', { v: f.v, by: 'admin' }, now); orderCacheDrop();
      return J(r);
    }
    if (p === '/rt/admin/order-revenue' && req.method === 'GET') {
      const d1 = dayIn(u.searchParams.get('d1'), kstOf(now)), d0 = dayIn(u.searchParams.get('d0'), shift(d1, -29));
      const r = await M.ordOp('range', { d0, d1 });
      let picks = null; try { const g = await giftM(env).giftAdmin('stats', { d0, d1 }, now); picks = { 1: 0, 2: 0, 3: 0 }; for (const d of g?.days || []) for (const t of [1, 2, 3]) picks[t] += Number(d['pick:' + t]) || 0; } catch { picks = null; }
      const funnel = {}; for (const day of Object.values(r.days || {})) for (const ev of PAY_EVENTS) funnel[ev] = (funnel[ev] || 0) + (Number(day['live:' + ev]) || 0);
      const rev = revenueOf(r.rows || [], { firstPaid: r.firstPaid || {}, picks: picks || {}, funnel, d0 });
      if (!picks) for (const x of rev.products) x.picks = null; // the gift counters could not be read: unknown, not zero
      return J({ ok: true, d0, d1, revenue: rev, funnelDays: r.days || {}, sw });
    }
    const m = /^\/rt\/admin\/order\/(o_[A-Za-z0-9]{20})(?:\/(refund|manual|publish|revoke))?$/.exec(p);
    if (!m) return J({ err: 'not found' }, 404);
    const id = m[1], sub = m[2] || '';
    if (!sub) { if (req.method !== 'GET') return J({ err: 'get' }, 405); const r = await M.ordOp('get', { id, events: true }); return r.ok ? J({ ok: true, order: r.order, events: r.events, cost: costOf(r.order.price) }) : no('nf', 404); }
    if (req.method !== 'POST') return J({ err: 'post' }, 405);
    const b = (await body(req)) || {}, note = String(b.note || '').trim().slice(0, PAY.noteMax);
    const g = await M.ordOp('get', { id }); if (!g.ok) return no('nf', 404);
    const o = g.order;
    if (sub === 'publish') { const a = await M.ordOp('publishAgain', { id, admin: true, by: 'admin' }, now); if (!a.ok) return no('state', 409); const x = a.publish ? await publish(env, a.order, ctx) : a.order; return J({ ok: true, order: x }); }
    if (sub === 'revoke') { // 혜택 다시 떼기: a refunded order whose perks did not come off the board
      if (o.st !== 'REFUNDED') return no('state', 409, { order: o });
      const ok = await revoke(env, o, ctx); return J({ ok, order: (await M.ordOp('get', { id })).order }, ok ? 200 : 502);
    }
    if (note.length < 2) return no('note', 400);
    if (sub === 'manual') {
      if (b.op === 'paid') { const r = await M.ordOp('manualPaid', { id, note }, now); if (!r.ok) return no('state', 409, { order: r.order }); const x = r.publish ? await publish(env, r.order, ctx) : r.order; return J({ ok: true, order: x }); }
      if (b.op === 'refunded' && o.pg_tx && o.how !== 'manual') return no('pgref', 409, { order: o }); // money the PG holds goes back through the PG
      if (b.op === 'refunded') { const r = await M.ordOp('refunded', { id, note, by: 'admin', via: 'manual' }, now); if (r.revoke) await revoke(env, r.order, ctx); return r.ok ? J({ ok: true, order: r.order }) : no('state', 409, { order: r.order }); }
      return J({ ok: false, error: 'op' }, 400);
    }
    // refund through the PG: only an order the PG took money for; the state is checked first (our idempotency guard), then cancel, then
    // PortOne is asked again and only a CANCELLED payment makes the order REFUNDED (a REQUESTED cancel waits for its webhook).
    if (o.st === 'REFUNDED') return J({ ok: true, order: o, already: true });
    if (!(MONEY_STATES.includes(o.st) || (o.st === 'FAILED' && o.pg_tx))) return no('state', 409, { order: o });
    if (o.how === 'manual' || !o.pg_tx) return J({ ok: false, code: 'manual', error: '결제사를 거치지 않은 주문이에요. 손으로 돌려준 뒤 "환불했음"으로 표시해 주세요.' }, 409);
    const pv = provider(env, o.mode === 'mock' ? 'mock' : 'portone'), key = 'refund-' + o.id;
    const c = await pv.cancel(o.id, { reason: note, key });
    if (!c.ok) { await M.ordOp('mark', { id, by: 'admin', detail: { refund_fail: c.code, status: c.status || null, type: c.type || null } }, now); return c.code === 'keys' ? no('keys', 503) : no('pg', 502); }
    const after = await pv.get(o.id);
    if (after.ok && after.payment?.status === 'CANCELLED') { const r = await M.ordOp('refunded', { id, note, by: 'admin', via: 'pg', key }, now); if (r.revoke) await revoke(env, r.order, ctx); return J({ ok: !!r.ok, order: r.order }); }
    await M.ordOp('mark', { id, by: 'admin', detail: { refund: c.how, key, note } }, now);
    return J({ ok: true, order: (await M.ordOp('get', { id })).order, requested: true }, 202);
  } catch { return J({ ok: false, error: '처리하지 못했어요.' }, 503); }
}
