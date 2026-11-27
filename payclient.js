// 결제 sheet for the board owner page (a gift board, kind gift, or a 내 전광판, kind personal): one exported entry,
// openCheckout({ boardId, kind, ref, product }), that the owner page (giftpage.js) calls from a paid tier's 결제하기 (product: that tier's
// product, chosen in the sheet). ownerOrderLine says what the page shows of the board's orders (GET /rt/order/board/<id>). Nothing shows unless /rt/config carries pay (PAY_ON=1) and /rt/order/products answers for this
// account (signed in, and on PAY_ALLOW while testing): payAvailable() is the check a page makes before it shows a button at all.
// The PortOne browser SDK is loaded from its official CDN only when the buyer presses pay (no CSP on the plaza pages to widen; the operator
// page's CSP is separate and never loads it). In PAY_MODE=mock (local hosts only) a fake payment window stands in for PortOne.
// Paid perks are never shown as active before the server says PUBLISHED. Text goes in with textContent only.
// payrules.js and plaza-account.js are shared with the Worker: imported with no query (tools/stamp.mjs).
import { REFUND_RULES, TEST_BADGE, TEST_NOTE, ST_NAME, OWNER_ST, ORDER_ID } from './payrules.js';
import { GT_LS, SESSION_LS } from './plaza-account.js';

export const PORTONE_SDK = 'https://cdn.portone.io/v2/browser-sdk.js';
const won = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR') + '원';

// ---- talking to the Worker ---------------------------------------------------------------------------------------------------------
function tokenNow() {
  try { const s = JSON.parse(localStorage.getItem(SESSION_LS) || 'null'); if (s?.access_token && s.expires_at * 1000 > Date.now() + 5000) return s.access_token; } catch { /* no session */ }
  try { const g = JSON.parse(localStorage.getItem(GT_LS) || 'null'); if (g?.token && g.exp * 1000 > Date.now()) return g.token; } catch { /* no guest */ }
  return '';
}
// The API the flow uses; tests hand in their own.
export function payApi(fetchFn = (...a) => fetch(...a), token = tokenNow) {
  const call = async (path, body) => {
    const t = token(), headers = { ...(t ? { authorization: 'Bearer ' + t } : {}), ...(body ? { 'content-type': 'application/json' } : {}) };
    let r; try { r = await fetchFn(path, body ? { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store' } : { headers, cache: 'no-store' }); } catch { return { ok: false, code: 'net', status: 0 }; }
    let j = {}; try { j = await r.json(); } catch { j = {}; }
    return { ...j, ok: r.ok && j.ok !== false, status: r.status };
  };
  return {
    config: async () => { const r = await call('/rt/config'); return r.pay?.on ? r.pay : null; },
    products: (kind, board) => { const q = new URLSearchParams(); if (kind) q.set('kind', kind); if (board) q.set('board', board); const s = q.toString(); return call('/rt/order/products' + (s ? '?' + s : '')); },
    boardOrders: (board) => call('/rt/order/board/' + encodeURIComponent(board)),
    create: (b) => call('/rt/order', b),
    pay: (id) => call('/rt/order/' + id + '/pay', {}),
    confirm: (id) => call('/rt/order/' + id + '/confirm', {}),
    fail: (id, code) => call('/rt/order/' + id + '/fail', { code }),
    cancel: (id) => call('/rt/order/' + id + '/cancel', {}),
    mock: (id, result) => call('/rt/order/' + id + '/mock', { result }),
    get: (id) => call('/rt/order/' + id),
  };
}

// Is checkout open for this account and kind? boardId: the prices are that board's arm (the ones its page shows). -> the
// /rt/order/products answer, or null (off, not signed in, not allowed, nothing on sale).
export async function payAvailable({ kind = 'gift', boardId = '' } = {}, api = payApi()) {
  const cfg = await api.config().catch(() => null); if (!cfg) return null;
  const r = await api.products(kind, boardId); return r.ok && Array.isArray(r.products) && r.products.length ? r : null;
}
// The owner page's line for a board's orders (newest first; a cancelled one is left out): { st, label (결제 대기 / 결제 완료 / 게시 중 /
// 게시됨 / 실패 / 환불), text, active (the perks are on: PUBLISHED only), locked (money taken and kept: no second order), name, gives }, or
// null when there is none.
export function ownerOrderLine(orders) {
  const o = (Array.isArray(orders) ? orders : []).find((x) => x && x.st && x.st !== 'CANCELLED');
  if (!o) return null;
  const paidFail = o.st === 'FAILED' && o.paid_at != null;
  const why = { CREATED: '결제를 마치지 않았다면 결제하기를 다시 눌러 주세요.', PAYMENT_PENDING: '결제를 확인하고 있어요. 결제를 마치지 않았다면 결제하기를 다시 눌러 주세요.',
    PAID: '결제가 확인됐어요. 곧 전광판에 게시돼요.', PUBLISH_PENDING: '전광판에 혜택을 넣고 있어요. 잠시 뒤에 다시 열어 주세요.', PUBLISHED: '혜택이 이 전광판에 적용됐어요.',
    FAILED: paidFail ? '결제는 됐지만 게시하지 못했어요. 운영자가 확인해 다시 게시하거나 환불해 드려요.' : '결제가 완료되지 않았어요. 돈이 나갔다면 문의하기로 알려 주세요.',
    REFUNDED: '환불된 주문이에요. 이 전광판은 무료 걸기로 돌아갔어요.' }[o.st] || '';
  const label = OWNER_ST[o.st] || o.st;
  return { st: o.st, label, name: String(o.name || ''), text: `${o.name || '주문'} · ${label}${o.test ? ' (' + TEST_BADGE + ')' : ''} · ${why}`, active: o.st === 'PUBLISHED',
    locked: ['PAID', 'PUBLISH_PENDING', 'PUBLISHED'].includes(o.st) || paidFail, gives: o.st === 'PUBLISHED' && Array.isArray(o.gives) ? [...o.gives] : [] };
}

// ---- what the sheet shows ----------------------------------------------------------------------------------------------------------
// From the products answer: rows, the test badge, the refund rules (shown before paying), and the line that says perks start after payment.
// pick: the product the page's button was for (checked first); without one, or one not on sale, the first row.
export function sheetModel(r, pick = '') {
  const test = !!r.test, at = Math.max(0, r.products.findIndex((p) => p.id === pick));
  return {
    title: '결제하기', badge: test ? TEST_BADGE : '', testNote: test ? TEST_NOTE : '',
    rows: r.products.map((p, i) => ({ id: p.id, name: p.name, price: p.price, priceText: won(p.price), perks: [...p.perks], active: false, checked: i === at })),
    refund: [REFUND_RULES.before, REFUND_RULES.after, ...REFUND_RULES.lines], afterPay: '혜택은 결제가 확인되고 전광판에 공개된 뒤에 적용돼요.',
    vat: '가격은 부가세 포함이에요.',
  };
}
export function payLabel(price) { return won(price) + ' 결제하기'; }
// The order as the result screen says it.
export function resultLine(o) {
  if (!o) return { tone: 'err', text: '주문을 확인하지 못했어요.' };
  if (o.st === 'PUBLISHED') return { tone: 'ok', text: '결제가 끝났고 혜택이 적용됐어요.' };
  if (o.st === 'PAID' || o.st === 'PUBLISH_PENDING') return { tone: 'ok', text: '결제가 끝났어요. 전광판에 공개하는 중이에요.' };
  if (o.st === 'PAYMENT_PENDING' || o.st === 'CREATED') return { tone: 'wait', text: '결제를 확인하고 있어요. 잠시 뒤에 다시 확인해 주세요.' };
  if (o.st === 'REFUNDED') return { tone: 'err', text: '환불된 주문이에요.' };
  if (o.st === 'CANCELLED') return { tone: 'err', text: '취소된 주문이에요.' };
  return { tone: 'err', text: '결제가 완료되지 않았어요(' + (ST_NAME[o.st] || o.st) + '). 돈이 나갔다면 문의하기로 알려 주세요.' };
}

// ---- the flow (no DOM: ui is handed in) ------------------------------------------------------------------------------------------------
// ui: { busy(text), error(text), price(newPrice), mockWindow() -> 'paid'|'failed'|'amount'|null, done(order) }. requestPayment(sdk) is
// PortOne.requestPayment (loaded on demand). -> { ok, order?, code? }
export async function runCheckout({ api, ui, mode, boardId, kind, ref, product, shown, requestPayment, redirectUrl }) {
  ui.busy('주문을 만드는 중…');
  const c = await api.create({ product, kind, boardId, ref, shown });
  if (!c.ok) { if (c.code === 'price' && c.price) ui.price(c.price); ui.error(c.error || '주문을 만들지 못했어요.'); return { ok: false, code: c.code || 'create' }; }
  const id = c.order.id;
  ui.busy('결제창을 여는 중…');
  const p = await api.pay(id);
  if (!p.ok) { ui.error(p.error || '결제를 시작하지 못했어요.'); return { ok: false, code: p.code || 'pay' }; }
  if (mode === 'mock' || p.sdk?.mock) {
    const result = await ui.mockWindow();
    if (!result) { await api.fail(id, 'MOCK_CLOSED'); ui.error('결제를 닫았어요.'); return { ok: false, code: 'closed' }; }
    await api.mock(id, result);
  } else {
    let resp; try { resp = await requestPayment({ ...p.sdk, ...(redirectUrl ? { redirectUrl } : {}) }); } catch { resp = { code: 'SDK_ERROR', message: '결제창을 열지 못했어요.' }; }
    if (resp?.code != null) { await api.fail(id, String(resp.code).slice(0, 60)); ui.error(resp.message || '결제가 완료되지 않았어요.'); return { ok: false, code: 'pg' }; }
  }
  ui.busy('결제를 확인하는 중…');
  const r = await api.confirm(id);
  const order = r.order || null; ui.done(order, r);
  return { ok: !!order && ['PAID', 'PUBLISH_PENDING', 'PUBLISHED'].includes(order.st), order };
}

// After a mobile redirect PortOne sends the buyer back with ?paymentId=<order id>&code=... (code only on failure). -> the confirm answer, or null.
export async function resumeCheckout(api = payApi(), loc = typeof location !== 'undefined' ? location : null) {
  if (!loc) return null;
  const q = new URLSearchParams(loc.search), id = q.get('paymentId') || '';
  if (!ORDER_ID.test(id) || q.get('kts_pay') !== '1') return null;
  if (q.get('code')) { await api.fail(id, String(q.get('code')).slice(0, 60)); return { ok: false, code: 'pg', message: q.get('message') || '' }; }
  return api.confirm(id);
}

// ---- the browser parts ---------------------------------------------------------------------------------------------------------------
let SDK = null;
export function loadSdk(doc = document) {
  if (globalThis.PortOne?.requestPayment) return Promise.resolve(globalThis.PortOne);
  if (SDK) return SDK;
  SDK = new Promise((res, rej) => { const s = doc.createElement('script'); s.src = PORTONE_SDK; s.async = true; s.onload = () => (globalThis.PortOne ? res(globalThis.PortOne) : rej(new Error('sdk'))); s.onerror = () => { SDK = null; rej(new Error('sdk')); }; doc.head.append(s); });
  return SDK;
}
const CSS = '.kpay{position:fixed;inset:0;z-index:9999;display:grid;align-items:end;justify-items:center;background:rgba(4,6,16,.66);font-family:"Pretendard Variable",Pretendard,"Malgun Gothic",sans-serif}'
  + '.kpay-s{width:min(520px,100%);max-height:92vh;overflow:auto;box-sizing:border-box;padding:20px 16px calc(20px + env(safe-area-inset-bottom));border-radius:20px 20px 0 0;background:#10152b;color:#eef0fb;border:1px solid #232a4a;box-shadow:0 -10px 40px rgba(0,0,0,.5)}'
  + '@media(min-width:640px){.kpay{align-items:center}.kpay-s{border-radius:20px}}'
  + '.kpay h2{margin:0 0 4px;font-size:20px;font-weight:900;display:flex;gap:8px;align-items:center}.kpay .b{font-size:12px;font-weight:800;color:#2a1800;background:#ffcf5a;border-radius:6px;padding:2px 8px}'
  + '.kpay p{margin:6px 0;font-size:13px;line-height:1.55;color:#b9c0e0}.kpay .t{color:#ffcf5a;font-weight:700}'
  + '.kpay label{display:block;margin:10px 0;padding:12px 14px;border-radius:14px;border:1px solid #2a3258;background:rgba(255,255,255,.03);cursor:pointer}'
  + '.kpay label:has(input:checked){border-color:#ffcf5a;background:rgba(255,207,90,.08)}.kpay label b{font-size:15px}.kpay label span{float:right;font-weight:800;color:#ffe2a8}'
  + '.kpay ul{margin:6px 0 0;padding-left:18px;font-size:13px;color:#b9c0e0}.kpay input{margin-right:8px}'
  + '.kpay details{margin:12px 0;font-size:13px}.kpay summary{cursor:pointer;font-weight:800}'
  + '.kpay button{width:100%;min-height:48px;margin-top:8px;border-radius:14px;border:1px solid #2a3258;background:rgba(255,255,255,.05);color:#eef0fb;font:inherit;font-weight:800;font-size:15px;cursor:pointer}'
  + '.kpay button.go{border:0;color:#2a1800;background:linear-gradient(135deg,#ffe9a8,#ffcf5a 45%,#e6a52a)}.kpay button:disabled{opacity:.5;cursor:default}'
  + '.kpay .m{min-height:20px;font-weight:700}.kpay .m.err{color:#ff9cb0}.kpay .m.ok{color:#7dffb3}';
function el(doc, tag, props = {}, ...kids) {
  const n = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (v == null || v === false) continue; if (k === 'text') n.textContent = v; else if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v); }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
  return n;
}

// The one entry the product pages use. -> a Promise of the runCheckout result ({ ok: false, code: 'off' } when checkout is not open here).
export async function openCheckout({ boardId = '', kind = 'gift', ref = '', product = '' } = {}, api = payApi(), doc = document) {
  const avail = await payAvailable({ kind, boardId }, api); if (!avail) return { ok: false, code: 'off' };
  const m = sheetModel(avail, product), mode = avail.mode;
  if (!doc.getElementById('kpay-css')) doc.head.append(el(doc, 'style', { id: 'kpay-css', text: CSS }));
  const before = doc.activeElement;
  let finish; const out = new Promise((res) => { finish = res; });
  const msg = el(doc, 'p', { class: 'm', role: 'status', 'aria-live': 'polite' });
  const rows = m.rows.map((r) => el(doc, 'label', {}, el(doc, 'input', { type: 'radio', name: 'kpay-p', value: r.id, checked: r.checked }), el(doc, 'b', { text: r.name }), el(doc, 'span', { text: r.priceText, 'data-price': String(r.price) }), el(doc, 'ul', {}, r.perks.map((x) => el(doc, 'li', { text: x })))));
  const picked = () => { const i = rows.findIndex((r) => r.querySelector('input').checked); return m.rows[Math.max(0, i)]; };
  const go = el(doc, 'button', { type: 'button', class: 'go', text: payLabel(picked().price) });
  const close = el(doc, 'button', { type: 'button', text: '닫기' });
  for (const r of rows) r.querySelector('input').addEventListener('change', () => { go.textContent = payLabel(picked().price); });
  const sheet = el(doc, 'div', { class: 'kpay-s', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kpay-h' },
    el(doc, 'h2', { id: 'kpay-h' }, m.title, m.badge ? el(doc, 'span', { class: 'b', text: m.badge }) : null),
    m.testNote ? el(doc, 'p', { class: 't', text: m.testNote }) : null,
    el(doc, 'p', { text: m.vat + ' ' + m.afterPay }), ...rows,
    el(doc, 'details', { open: true }, el(doc, 'summary', { text: '취소와 환불' }), el(doc, 'ul', {}, m.refund.map((x) => el(doc, 'li', { text: x })))),
    msg, go, close);
  const wrap = el(doc, 'div', { class: 'kpay' }, sheet);
  const shut = (res) => { wrap.remove(); doc.removeEventListener('keydown', onKey); try { before?.focus?.(); } catch { /* gone */ } finish(res); };
  const onKey = (e) => { if (e.key === 'Escape' && !go.disabled) shut({ ok: false, code: 'closed' }); };
  doc.addEventListener('keydown', onKey); wrap.addEventListener('click', (e) => { if (e.target === wrap && !go.disabled) shut({ ok: false, code: 'closed' }); });
  close.addEventListener('click', () => shut(last || { ok: false, code: 'closed' }));
  let last = null;
  const ui = {
    busy: (t) => { msg.className = 'm'; msg.textContent = t; go.disabled = true; },
    error: (t) => { msg.className = 'm err'; msg.textContent = t; go.disabled = false; },
    price: (n) => { const r = picked(); r.price = n; r.priceText = won(n); const span = rows[m.rows.indexOf(r)].querySelector('span'); span.textContent = r.priceText; go.textContent = payLabel(n); },
    mockWindow: () => new Promise((res) => {
      const box = el(doc, 'div', { class: 'kpay', role: 'dialog', 'aria-modal': 'true', 'aria-label': '가짜 결제창' }, el(doc, 'div', { class: 'kpay-s' },
        el(doc, 'h2', { text: '가짜 결제창' }, el(doc, 'span', { class: 'b', text: 'mock' })), el(doc, 'p', { text: '로컬 테스트용이에요. 실제 결제사를 부르지 않아요.' }),
        ...[['paid', '결제 성공'], ['failed', '결제 실패'], ['amount', '금액이 다르게 결제됨'], [null, '창 닫기']].map(([v, t]) => el(doc, 'button', { type: 'button', class: v === 'paid' ? 'go' : null, text: t, onclick: () => { box.remove(); res(v); } }))));
      doc.body.append(box); box.querySelector('button')?.focus();
    }),
    done: (o) => { const l = resultLine(o); msg.className = 'm ' + (l.tone === 'ok' ? 'ok' : l.tone === 'err' ? 'err' : ''); msg.textContent = l.text; go.hidden = l.tone === 'ok'; go.disabled = false; close.textContent = l.tone === 'ok' ? '확인' : '닫기'; },
  };
  go.addEventListener('click', async () => {
    const r = picked(), back = new URL(location.href); back.searchParams.set('kts_pay', '1');
    last = await runCheckout({ api, ui, mode, boardId, kind, ref, product: r.id, shown: r.price, redirectUrl: back.href,
      requestPayment: async (sdk) => (await loadSdk(doc)).requestPayment(sdk) });
    if (last?.ok) close.focus();
  });
  doc.body.append(wrap); go.focus();
  return out;
}
