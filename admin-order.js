// 🧾 주문·매출 in admin.html (one <script> line there), behind the same login cookie as the rest (a 401 goes back to the login page).
// The pay switches as the Worker sees them, the orders list with filters (state, product, mode), one order's history with the operator's
// actions (refund through the PG, manual paid / refunded for bank transfers, publish again; each needs a reason and is kept in the history),
// the products (from the gift price ladder, giftrules.js TIERS: names, lines and prices are read only here, the switch on/off is the edit;
// every edit logged; the price experiment is the Worker's GIFT_ARMS, by board), revenue for a date range (real orders
// only: test and mock are counted apart), the daily funnel counters, and the CSV export. Routes: ordersrv.js /rt/admin/order*.
// payrules.js is shared with the Worker: imported with no query (tools/stamp.mjs).
import { ST, ST_NAME, PRODUCTS, PAY_EVENTS, COST } from './payrules.js';

const $ = (id) => document.getElementById(id);
function h(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'value') n.value = v; else if (k === 'checked') n.checked = !!v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
const won = (n) => (n == null ? '모름' : Math.round(Number(n) || 0).toLocaleString('ko-KR') + '원');
const pct = (r) => (r == null ? '—' : Math.round(r * 1000) / 10 + '%');
const kst = (ms) => (ms ? new Date(Number(ms) + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) : '—');
const kstDay = (ms = Date.now()) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const shift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const KIND = { gift: '선물', personal: '내 전광판' };
const NAME = Object.fromEntries(PRODUCTS.map((p) => [p.id, p.name + ' (' + KIND[p.kind] + ')']));
const EV_NAME = { checkout_start: '주문 시작', pay_success: '결제 성공', pay_fail: '결제 실패', publish_ok: '공개 성공', publish_fail: '공개 실패', refund: '환불' };

const sel = (id, opts) => h('select', { id }, opts.map(([v, t]) => h('option', { value: v, text: t })));
const fSt = sel('ordSt', [['', '모든 상태'], ...Object.keys(ST).map((s) => [s, ST_NAME[s] + ' (' + s + ')'])]);
const fProd = sel('ordProd', [['', '모든 상품'], ...PRODUCTS.map((p) => [p.id, NAME[p.id]])]);
const fMode = sel('ordMode', [['', '실결제·테스트 모두'], ['real', '실결제만'], ['test', '테스트·mock만']]);
const d1In = h('input', { type: 'date', id: 'ordD1', value: kstDay() }), d0In = h('input', { type: 'date', id: 'ordD0', value: shift(kstDay(), -29) });
const csv = h('a', { id: 'ordCsv', class: 'btn', href: '#', download: '', text: 'CSV 내려받기' });
const box = h('section', { id: 'orderAdmin' },
  h('h2', {}, '🧾 주문·매출 ', h('button', { type: 'button', text: '새로고침', onclick: () => loadAll() })),
  h('p', { class: 'sub', text: '결제는 PAY_ON=1일 때만 열립니다. PAY_MODE가 live가 아니면 모두 테스트 결제(돈이 나가지 않음)이고, 매출에는 실결제(결제사 LIVE 채널, 또는 손으로 확인한 입금)만 셉니다. 환불·수동 처리는 이유를 적어야 하고 주문 기록에 남습니다. 주문은 지우지 않습니다(전자상거래법 5년 보관).' }),
  h('div', { class: 'hits', id: 'ordSwitch' }),
  h('div', { class: 'msg', id: 'ordMsg' }),
  h('h2', { text: '매출' }),
  h('div', { class: 'bar' }, d0In, d1In, h('button', { type: 'button', text: '보기', onclick: () => loadRevenue() }), csv),
  h('div', { class: 'hits', id: 'ordKpi' }),
  h('div', { class: 'scroll' }, h('table', { id: 'ordDays' })),
  h('div', { class: 'scroll' }, h('table', { id: 'ordProds' })),
  h('div', { class: 'scroll' }, h('table', { id: 'ordFunnel' })),
  h('h2', { text: '주문' }),
  h('div', { class: 'bar' }, fSt, fProd, fMode, h('button', { type: 'button', text: '목록', onclick: () => loadList() })),
  h('div', { class: 'scroll' }, h('table', { id: 'ordList' })),
  h('div', { class: 'hits', id: 'ordOne' }),
  h('h2', { text: '상품' }),
  h('p', { class: 'sub', text: '상품은 선물 전광판 주인 화면의 가격표(giftrules.js TIERS)와 같아요. 이름·혜택·가격은 코드에서만 바꾸고, 여기서는 판매를 켜고 끄기만 해요. 가격 실험은 Worker 변수 GIFT_ARMS(예: A:3900/7900/14900;B:2900/5900/11900)로 전광판마다 A나 B가 정해지고, 주문에 본 가격과 안이 남아요. 가격은 부가세 포함이에요. 바꾼 내용은 아래 기록에 남아요.' }),
  h('div', { class: 'hits', id: 'ordProducts' }),
  h('div', { class: 'hits', id: 'ordLog' }));
(document.querySelector('main') || document.body).append(box);

function say(t, err) { const m = $('ordMsg'); m.textContent = t || ''; m.className = err ? 'msg err' : 'msg'; }
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin' });
  if (r.status === 401) { location.replace('/admin'); throw new Error('로그인이 끝났어요. 다시 로그인해 주세요.'); }
  const d = await r.json().catch(() => ({})); if (!r.ok || d.ok === false) throw new Error(d.error || '처리하지 못했어요.');
  return d;
}
const row = (tag, cells) => h('tr', {}, cells.map((c) => h(tag, {}, c)));
function showSwitch(sw) {
  if (!sw) return;
  const k = sw.keys || {}, yes = (b) => (b ? '있음' : '없음');
  $('ordSwitch').replaceChildren(h('div', { class: 'hit' }, h('b', { text: sw.on ? '결제 켜짐' : '결제 꺼짐(손님에게 안 보임)' }), h('span', { text: '모드 ' + (sw.mode || '없음(잘못된 PAY_MODE)') }),
    h('span', { text: 'PAY_ALLOW ' + sw.allow + '명' }), h('span', { text: `상점 ID ${yes(k.store)} · 채널 키 ${yes(k.channel)} · API 시크릿 ${yes(k.api)} · 웹훅 시크릿 ${yes(k.hook)}` })));
}

async function loadRevenue() {
  const d0 = d0In.value, d1 = d1In.value; csv.href = '/rt/admin/orders.csv?d0=' + encodeURIComponent(d0) + '&d1=' + encodeURIComponent(d1);
  try {
    const r = await api('/rt/admin/order-revenue?d0=' + encodeURIComponent(d0) + '&d1=' + encodeURIComponent(d1)), v = r.revenue; showSwitch(r.sw);
    const kpi = (t, n, s) => h('div', { class: 'hit' }, h('b', { text: n }), h('span', { text: t + (s ? ' · ' + s : '') }));
    $('ordKpi').replaceChildren(
      kpi('결제 건수(실결제)', String(v.paid), '테스트·mock ' + v.excluded + '건은 뺌'), kpi('매출', won(v.gross), '환불 뺀 순매출 ' + won(v.net)), kpi('객단가', won(v.aov)),
      kpi('환불', v.refunds.n + '건', won(v.refunds.amount) + ' · ' + pct(v.refunds.rate)), kpi('구매자', String(v.buyers.total), '처음 ' + v.buyers.new + ' · 다시 산 ' + v.buyers.repeat),
      kpi('받는 사람 페이지에서 온 주문', v.ref.n + '건', won(v.ref.gross)),
      kpi('전환', '주문 시작→결제 ' + pct(v.conversion.checkout), '가격표 고름→결제 ' + pct(v.conversion.picks)),
      kpi('결제 수수료(추정)', won(v.cost.pg.lo) + ' ~ ' + won(v.cost.pg.hi), `카드 ${COST.pg.lo * 100}~${COST.pg.hi * 100}% + 부가세 10%`),
      kpi('주문당 비용', v.cost.perOrder ? won(v.cost.perOrder.pg.lo) + ' ~ ' + won(v.cost.perOrder.pg.hi) : '—', '결제 수수료만 · 고정비·호스팅·영상·응대·세금은 모름'));
    $('ordDays').replaceChildren(row('th', ['날짜', '결제', '매출', '환불', '환불 금액']), ...(v.days.length ? v.days.map((x) => row('td', [x.day, String(x.paid), won(x.gross), String(x.refunds), won(x.refundAmount)])) : [row('td', ['이 기간에 실결제가 없어요.', '', '', '', ''])]));
    $('ordProds').replaceChildren(row('th', ['상품', '결제', '매출', '환불', '가격표에서 고름', '고름 대비 결제', 'A안', 'B안']), ...v.products.map((p) => row('td', [NAME[p.id] || p.id, String(p.paid), won(p.gross), String(p.refunds), p.picks == null ? '—' : String(p.picks), p.picks ? pct(p.paid / p.picks) : '—', armText(p.arms.A), armText(p.arms.B)])));
    const days = Object.keys(r.funnelDays || {}).sort().reverse();
    $('ordFunnel').replaceChildren(row('th', ['날짜 (실결제 모드 live · 괄호는 테스트+mock)', ...PAY_EVENTS.map((e) => EV_NAME[e])]), ...days.map((d) => { const x = r.funnelDays[d]; return row('td', [d, ...PAY_EVENTS.map((e) => String(x['live:' + e] || 0) + ' (' + ((x['test:' + e] || 0) + (x['mock:' + e] || 0)) + ')')]); }));
  } catch (e) { say(e.message, true); }
}
const armText = (a) => (a ? a.paid + '건 · ' + won(a.gross) : '—');

async function loadList() {
  try {
    const q = new URLSearchParams({ st: fSt.value, product: fProd.value, mode: fMode.value, limit: '100' });
    const r = await api('/rt/admin/orders?' + q); showSwitch(r.sw);
    $('ordList').replaceChildren(row('th', ['만든 때', '주문', '상품', '가격', '상태', '결제', '모드', '받는 사람 페이지에서']),
      ...(r.orders.length ? r.orders.map((o) => { const tr = row('td', [kst(o.created_at), '', NAME[o.product] || o.product, won(o.price) + (o.arm !== 'A' ? ' (' + o.arm + ')' : ''), (ST_NAME[o.st] || o.st) + ((o.flags & 2 && o.st !== 'REFUNDED') || o.flags & 4 ? ' ⚠' : ''), o.how, o.mode, o.ref ? '예' : '']);
        tr.children[1].replaceChildren(h('button', { type: 'button', text: o.id, onclick: () => loadOne(o.id) })); return tr; }) : [row('td', ['주문이 없어요.', '', '', '', '', '', '', ''])]));
  } catch (e) { say(e.message, true); }
}

async function loadOne(id) {
  try {
    const r = await api('/rt/admin/order/' + id), o = r.order;
    const note = h('input', { type: 'text', maxlength: 300, placeholder: '이유 (필수, 주문 기록에 남아요)' });
    const act = (label, path, body, cls) => h('button', { type: 'button', class: cls, text: label, onclick: async () => {
      if (!note.value.trim() && !path.endsWith('/publish') && !path.endsWith('/revoke')) { say('이유를 적어 주세요.', true); note.focus(); return; }
      if (!confirm(label + ': ' + o.id + '\n' + (note.value || ''))) return;
      try { const x = await api('/rt/admin/order/' + o.id + path, { ...body, note: note.value }); say(x.requested ? '환불을 요청했어요. 결제사가 끝내면 웹훅으로 환불됨이 돼요.' : '처리했어요: ' + (ST_NAME[x.order?.st] || '')); loadOne(o.id); loadList(); } catch (e) { say(e.message, true); }
    } });
    const ev = r.events.map((e) => h('div', { class: 'hit' }, h('b', { text: kst(e.at) }), h('span', { text: (e.from || '—') + ' → ' + e.to + ' · ' + e.by }), e.detail ? h('span', { text: JSON.stringify(e.detail) }) : null));
    $('ordOne').replaceChildren(
      h('div', { class: 'hit' }, h('b', { text: o.id }), h('span', { text: `${NAME[o.product] || o.product} · ${won(o.price)} (${o.arm}안) · ${ST_NAME[o.st] || o.st} · ${o.how}/${o.mode}` }),
        h('span', { text: '구매자 ' + o.uid }), o.ref_board ? h('span', { text: '전광판 ' + o.ref_board }) : null, o.pg_tx ? h('span', { text: '거래 ' + o.pg_tx }) : null,
        o.flags & 2 && o.st !== 'REFUNDED' ? h('span', { text: '⚠ 환불 필요(금액·채널이 맞지 않거나 같은 전광판의 두 번째 결제)' }) : null, o.flags & 4 ? h('span', { text: '⚠ 환불했지만 전광판에서 혜택을 떼지 못함: "혜택 다시 떼기"' }) : null,
        h('span', { text: `결제 수수료(추정) ${won(r.cost.pg.lo)}~${won(r.cost.pg.hi)}` })),
      h('div', { class: 'bar' }, note, act('결제사로 환불', '/refund', {}, 'no'), act('입금 확인(수동 결제)', '/manual', { op: 'paid' }, 'ok'), act('손으로 환불했음(결제사를 거치지 않은 주문만)', '/manual', { op: 'refunded' }), act('다시 공개(멈춘 공개도 처음부터)', '/publish', {}), o.st === 'REFUNDED' ? act('혜택 다시 떼기', '/revoke', {}) : null),
      ...ev);
  } catch (e) { say(e.message, true); }
}

async function loadProducts() {
  try {
    const r = await api('/rt/admin/order-products'); showSwitch(r.sw);
    $('ordProducts').replaceChildren(...r.products.map((p) => {
      const on = h('input', { type: 'checkbox', checked: p.active, 'aria-label': p.id + ' 판매' });
      return h('div', { class: 'hit' }, h('b', { text: NAME[p.id] || p.name }), h('span', { text: p.id + ' · A안 ' + won(p.price) }), h('span', { text: p.perks.join(' · ') }), h('label', {}, on, ' 판매'),
        h('button', { type: 'button', class: 'gold', text: '저장', onclick: async () => {
          try { await api('/rt/admin/order-products', { id: p.id, active: on.checked }); say('저장했어요: ' + p.id); loadProducts(); } catch (e) { say(e.message, true); }
        } }));
    }));
    $('ordLog').replaceChildren(...(r.log || []).map((l) => h('div', { class: 'hit' }, h('b', { text: kst(l.at) }), h('span', { text: l.id + ' · ' + l.by }), h('span', { text: JSON.stringify(l.before) + ' → ' + JSON.stringify(l.after) }))));
  } catch (e) { say(e.message, true); }
}

function loadAll() { say(''); loadRevenue(); loadList(); loadProducts(); }
loadAll();
