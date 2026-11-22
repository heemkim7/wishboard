// 광고 판매 in admin.html (one <script> line there): the /ads requests (new → quoted → paid → scheduled → done, or
// rejected), the creative check, a price note, the schedule per ad screen (no two bookings meet on one screen; the Worker
// checks) and each booking's read-only report link for the advertiser. Same x-admin-key as the rest of the page.
import { AD_SCREENS, AD_PRODUCTS, AD_STATUS, AD_STATUS_NAME, AD_THEMES, AD_EMOJI, ADS, adScreenName, priceText, addDays, kstDay } from './adsale.js';

const $ = (id) => document.getElementById(id);
const keyOf = () => (($('key')?.value || '').trim() || sessionStorage.getItem('kts-admin') || '');
function h(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'value') n.value = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
const when = (t) => new Date(t).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
const sel = (opts, value) => h('select', {}, ...opts.map(([v, t]) => { const o = h('option', { value: v, text: t }); if (v === value) o.selected = true; return o; }));

const box = h('section', { id: 'adsAdmin' },
  h('h2', {}, '📺 광고 판매 ', h('button', { type: 'button', id: 'adsLoad', text: '새로고침' })),
  h('p', { class: 'sub', text: '광고 전용 화면(AD_1~AD_5)의 신청·검토·일정입니다. 점령 칸·코인과 따로이고 결제는 계좌이체·세금계산서로 직접 받습니다. 문구를 승인해야 일정을 잡을 수 있고, 한 화면에 겹치는 일정은 저장되지 않습니다. 날짜는 한국 시간, 끝 날짜까지 포함입니다. 리포트 링크는 광고주에게 보내는 읽기 전용 주소이고 개인정보가 없습니다.' }),
  h('div', { class: 'msg', id: 'adsMsg' }),
  h('h2', { text: '일정' }), h('p', { class: 'sub', text: '클릭·화면 봄은 합계와 함께 연결된 계정과 게스트를 나눠 보입니다. 게스트는 누구나 새로 만들 수 있어 게스트 숫자는 약한 수치입니다. 밤 9시 스폰서가 도는 60초에는 하루 광고의 클릭·화면 봄을 세지 않습니다.' }),
  h('div', { class: 'scroll' }, h('table', { id: 'adsBook' })),
  h('h2', { text: '신청' }), h('div', { class: 'hits', id: 'adsReq' }));
(document.querySelector('main') || document.body).append(box);

function say(text, err) { const m = $('adsMsg'); m.textContent = text || ''; m.className = err ? 'msg err' : 'msg'; }
async function api(path, body) {
  const key = keyOf();
  if (!key) throw new Error('ADMIN_KEY를 입력하세요.');
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': key }, body: JSON.stringify(body) } : { headers: { 'x-admin-key': key } });
  if (r.status === 401) throw new Error('ADMIN_KEY가 맞지 않아요.');
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok === false) throw new Error(d.error || '처리하지 못했어요.');
  return d;
}

// A count as its total with linked accounts and guests apart (guest counts are weaker: anyone can make a guest).
const split = (all, linked) => { const n = Math.max(0, Number(all) || 0), u = Math.min(n, Math.max(0, Number(linked) || 0)); return `${n} (계정 ${u} · 게스트 ${n - u})`; };
function bookings(list) {
  const head = h('tr', {}, ...['화면', '상품', '날짜', '상태', '문구', '링크 클릭', '화면 봄(표본)', '리포트', ''].map((t) => h('th', { text: t })));
  const rows = list.map((b) => {
    const url = new URL('/rt/ads/report/' + b.tok, location.origin).href;
    const copy = h('button', { type: 'button', text: '링크 복사', onclick: async () => { try { await navigator.clipboard.writeText(url); say('리포트 링크를 복사했어요.'); } catch { prompt('리포트 링크', url); } } });
    const cancel = b.st === 'live' ? h('button', { type: 'button', class: 'no', text: '취소', onclick: async () => { if (!confirm('이 일정을 취소할까요? 광장에서 바로 내려갑니다.')) return; try { await api('/rt/admin/ads/cancel', { id: b.id }); say('일정을 취소했어요.'); load(); } catch (e) { say(e.message, true); } } }) : null;
    const state = b.st === 'cancelled' ? '취소' : b.b <= Date.now() ? '끝남' : b.a <= Date.now() ? '송출 중' : '예정';
    return h('tr', {}, h('td', { text: adScreenName(b.s) || b.s }), h('td', { text: AD_PRODUCTS[b.p]?.name || b.p }), h('td', { text: `${b.start} ~ ${b.end}` }), h('td', { text: state }),
      h('td', { text: (b.l || []).filter(Boolean).join(' / ') }), h('td', { text: split(b.c, b.cu) }), h('td', { text: split(b.v, b.vu) }),
      h('td', {}, h('a', { href: url, target: '_blank', rel: 'noopener', text: '열기' }), ' ', copy), h('td', {}, cancel));
  });
  $('adsBook').replaceChildren(head, ...(rows.length ? rows : [h('tr', {}, h('td', { colspan: 9, text: '잡힌 일정이 없어요.' }))]));
}

function request(r, prices) {
  const lines = [0, 1, 2].map((i) => h('input', { type: 'text', maxlength: ADS.lineMax[i], value: (r.lines || [])[i] || '' }));
  const emoji = sel(AD_EMOJI.map((e) => [e, e]), r.emoji), theme = sel(AD_THEMES.map((t) => [t, t]), r.theme);
  const link = h('input', { type: 'text', value: r.link || '', placeholder: 'https:// (선택)' });
  const st = sel(AD_STATUS.map((s) => [s, AD_STATUS_NAME[s]]), r.st);
  const price = h('input', { type: 'text', maxlength: 80, value: r.price || '', placeholder: `견적 메모 (기준가 ${priceText(prices?.[r.product])})` });
  const note = h('input', { type: 'text', maxlength: 500, value: r.note || '', placeholder: '운영 메모' });
  const end0 = addDays(r.start || kstDay(), Math.max(0, (Number(r.days) || 1) - 1));
  const screen = r.product === 'sponsor9' ? h('span', { text: '전체 화면(밤 9시 60초)' }) : sel(AD_SCREENS.map((a) => [a.id, `${a.id} ${a.name}`]), r.screen || AD_SCREENS[0].id);
  const start = h('input', { type: 'date', value: r.start || '' }), end = h('input', { type: 'date', value: end0 });
  const save = async (extra = {}) => {
    try {
      await api('/rt/admin/ads/edit', { id: r.id, st: st.value, price: price.value, note: note.value, lines: lines.map((x) => x.value), emoji: emoji.value, theme: theme.value, link: link.value, ...extra });
      say('저장했어요.'); load();
    } catch (e) { say(e.message, true); }
  };
  const book = async () => {
    try {
      await save();
      await api('/rt/admin/ads/book', { rq: r.id, product: r.product, screen: screen.value || '*', start: start.value, end: end.value });
      say('일정을 잡았어요. 1분 안에 광장에 나갑니다.'); load();
    } catch (e) { say(e.message, true); }
  };
  return h('div', { class: 'hit', style: 'display:grid;gap:8px;align-items:stretch' },
    h('div', {}, h('b', { text: AD_STATUS_NAME[r.st] || r.st }), ' · ', AD_PRODUCTS[r.product]?.name || r.product, ' · 원하는 날짜 ', h('b', { text: `${r.start} 부터 ${r.days}일` }), ' · ', adScreenName(r.screen) || '어디든', h('span', { text: ` · 접수 ${when(r.at)} · ${r.id}` })),
    h('div', {}, h('b', { text: r.company || '' }), ' · ', h('a', { href: 'mailto:' + encodeURIComponent(r.email || '').replace(/%40/g, '@'), text: r.email || '' }), r.phone ? ' · ' + r.phone : '', r.memo ? h('div', { class: 'sub', text: '요청: ' + r.memo }) : null),
    h('div', { class: 'bar', style: 'margin:0' }, ...lines, emoji, theme),
    h('div', { class: 'bar', style: 'margin:0' }, link, h('span', { text: r.ok ? '✅ 문구 승인됨' : '⏳ 문구 미승인' }),
      h('button', { type: 'button', class: r.ok ? '' : 'ok', text: r.ok ? '승인 취소' : '문구 승인', onclick: () => save({ approve: !r.ok }) })),
    h('div', { class: 'bar', style: 'margin:0' }, st, price, note, h('button', { type: 'button', text: '저장', onclick: () => save() })),
    h('div', { class: 'bar', style: 'margin:0' }, screen, start, end, h('button', { type: 'button', class: 'gold', text: '일정 잡기', disabled: !r.ok, onclick: book })));
}

async function load() {
  if (!keyOf()) { say('ADMIN_KEY를 입력하세요.'); return; }
  say('불러오는 중…');
  try {
    const d = await api('/rt/admin/ads');
    bookings(d.bookings || []);
    const reqs = d.requests || [];
    $('adsReq').replaceChildren(...(reqs.length ? reqs.map((r) => request(r, d.prices)) : [h('div', { class: 'empty', text: '들어온 신청이 없어요.' })]));
    say(`ADS_ON ${d.on ? '켜짐' : '꺼짐 (집 광고·신청서 꺼짐, 잡은 일정은 나감)'} · 신청 ${reqs.length}건 · 일정 ${(d.bookings || []).length}건 · 가격 ${['screen', 'cheer', 'sponsor9'].map((k) => priceText(d.prices?.[k])).join(' / ')}`);
  } catch (e) { say(e.message, true); }
}
$('adsLoad').onclick = load;
$('save')?.addEventListener('click', () => setTimeout(load, 0));
load();
