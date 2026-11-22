// The /ads page (ads.html): what the ad screens are, where they stand, the plaza's own counts, the products and prices
// (ADS_PRICES; '견적 문의' without one) and the request form, which posts to /rt/ads/request. Payment is never taken here:
// the operator answers by email with a quote and bank transfer / invoice details. Off (ADS_ON not '1'): "준비 중이에요".
import { ADS, AD_SCREENS, AD_PRODUCTS, AD_PRODUCT_IDS, AD_TEMPLATES, AD_THEMES, AD_EMOJI, AD_COUNTED, adRequestFault, priceText, kstDay, addDays } from './adsale.js';

const THEME_NAME = { cyber_navy: '사이버 네이비', neon_pink: 'K-POP 핑크', gold_luxury: '골드', matrix_green: '그린', sunset_red: '선셋', bday_party: '생일', cheer_exam: '합격 기원', love_anniv: '기념일' };
function h(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
const app = document.getElementById('app');
const num = (n) => Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('ko-KR');
// /rt/config's operator field (상3, when the Worker has it): a line of text, or { name, email }.
function contactOf(cfg) {
  const o = cfg?.operator;
  if (!o) return '';
  if (typeof o === 'string') return o.slice(0, 200);
  return [o.name || o.company || '', o.email || ''].filter(Boolean).join(' · ').slice(0, 200);
}

function closed(cfg) {
  const c = contactOf(cfg);
  app.replaceChildren(
    h('h1', { text: '광고 안내' }),
    h('div', { class: 'card' }, h('h2', { text: '준비 중이에요', style: 'margin-top:0' }),
      h('p', { text: '모두의 전광판 광고 신청은 곧 열려요. 광장 안의 광고 전용 화면에 하루 단위로 광고를 걸 수 있게 준비하고 있어요.' }),
      c ? h('p', {}, '문의: ', h('b', { text: c })) : h('p', { class: 'muted', text: '문의는 광장 설정의 문의하기를 이용해 주세요.' })));
}

// The square seen from above, north up: 7th Avenue and Broadway (bowtie.js AXES), the plaza and the five screens.
function mapSvg() {
  const NS = 'http://www.w3.org/2000/svg', s = (tag, a) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); return n; };
  const svg = s('svg', { viewBox: '-80 -90 190 330', class: 'map', role: 'img', 'aria-label': '광고 화면 다섯 곳의 위치. 위가 북쪽' });
  svg.append(s('rect', { x: -80, y: -90, width: 190, height: 330, rx: 10, fill: '#0e1428' }));
  for (const [ax, az, bx, bz] of [[-1, -90, -1, 240], [-30.1, -90, 46.8, 240]]) svg.append(s('line', { x1: ax, y1: az, x2: bx, y2: bz, stroke: '#2a3358', 'stroke-width': 9, 'stroke-linecap': 'round' }));
  svg.append(s('circle', { cx: 16, cy: 90, r: 22, fill: 'rgba(255,176,32,.10)', stroke: 'rgba(255,176,32,.35)', 'stroke-dasharray': '3 3' }));
  const t = (x, y, text, fill, size, anchor = 'middle') => { const n = s('text', { x, y, fill, 'font-size': size, 'font-weight': 700, 'text-anchor': anchor, 'font-family': 'inherit' }); n.textContent = text; return n; };
  svg.append(t(16, 122, '광장', '#b9bfdc', 9), t(17, 222, '원 타임스스퀘어', '#8f96b8', 8), t(-21, -78, 'TKTS ↑', '#8f96b8', 8), t(100, -78, 'N ↑', '#666d92', 8, 'end'));
  AD_SCREENS.forEach((a, i) => {
    svg.append(s('circle', { cx: a.x, cy: a.z, r: 7, fill: '#ffb020' }), t(a.x, a.z + 3.4, String(i + 1), '#1c1300', 9));
  });
  return svg;
}

function statsCard(st) {
  if (!st || !st.known) return h('div', { class: 'card' }, h('p', { text: '광장 숫자는 아직 모으는 중이에요.' }));
  return h('div', {},
    h('div', { class: 'grid' },
      h('div', { class: 'card stat' }, h('b', { text: num(st.sum) }), h('span', { text: `지난 ${st.days.length}일 광장 방문 계정(일별 합)` })),
      h('div', { class: 'card stat' }, h('b', { text: num(st.avg) }), h('span', { text: '하루 평균 광장 방문 계정' }))),
    h('p', { class: 'muted', text: `모두 ${AD_COUNTED}예요. 그날 광장에 들어온 계정(게스트 포함) 수이고, 사람이나 기기 수가 아니에요. 광고가 몇 번 보일지 약속하는 숫자(노출 보장)가 아니에요. 동시 접속 최고치는 아직 세지 않아요.` }));
}

function products(prices) {
  return h('div', { class: 'grid' }, ...AD_PRODUCT_IDS.map((k) => h('div', { class: 'card prod' },
    h('h3', { text: AD_PRODUCTS[k].name }), h('p', { text: AD_PRODUCTS[k].desc }),
    h('div', { class: 'price' }, priceText(prices?.[k]), prices?.[k] ? h('small', { text: ' / ' + AD_PRODUCTS[k].unit }) : null))),
  prices?.note ? h('p', { class: 'muted', text: prices.note }) : null);
}

function form() {
  const tomorrow = addDays(kstDay(), 1), last = addDays(kstDay(), ADS.aheadDays);
  const err = {}, fieldErr = (k) => (err[k] = h('div', { class: 'err', role: 'alert' }));
  const input = (name, attrs = {}) => h('input', { name, id: 'f-' + name, ...attrs });
  const lines = [0, 1, 2].map((i) => input('line' + (i + 1), { type: 'text', maxlength: ADS.lineMax[i], placeholder: AD_TEMPLATES.screen[i], autocomplete: 'off' }));
  const counts = lines.map((el, i) => { const c = h('span', { class: 'count', text: `0/${ADS.lineMax[i]}` }); el.addEventListener('input', () => { c.textContent = `${Array.from(el.value).length}/${ADS.lineMax[i]}`; paint(); }); return c; });
  const product = AD_PRODUCT_IDS.map((k, i) => h('label', { class: 'opt' }, h('input', { type: 'radio', name: 'product', value: k, checked: i === 0 }), h('span', {}, h('b', { text: AD_PRODUCTS[k].name }), h('br'), AD_PRODUCTS[k].desc)));
  const screen = h('select', { name: 'screen', id: 'f-screen' }, h('option', { value: '', text: '어디든 좋아요(운영자가 추천)' }), ...AD_SCREENS.map((a, i) => h('option', { value: a.id, text: `${i + 1}. ${a.name}` })));
  const emoji = h('select', { name: 'emoji', id: 'f-emoji' }, ...AD_EMOJI.map((e) => h('option', { value: e, text: e })));
  const theme = h('select', { name: 'theme', id: 'f-theme' }, ...AD_THEMES.map((t) => h('option', { value: t, text: THEME_NAME[t] || t })));
  const pv = { l1: h('div', { class: 'l1' }), l2: h('div', { class: 'l2' }), l3: h('div', { class: 'l3' }), em: h('div', { class: 'em' }) };
  const preview = h('div', { class: 'preview', 'aria-label': '광고 화면 미리보기' }, h('span', { class: 'chip', text: '광고' }), h('div', {}, pv.em, pv.l1, pv.l2, pv.l3));
  function paint() {
    const k = f.querySelector('input[name=product]:checked')?.value || 'screen';
    pv.em.textContent = emoji.value;
    lines.forEach((el, i) => { pv['l' + (i + 1)].textContent = el.value || AD_TEMPLATES[k][i]; el.placeholder = AD_TEMPLATES[k][i]; });
  }
  const agree = h('input', { type: 'checkbox', name: 'agree', id: 'f-agree' });
  const btn = h('button', { class: 'go', type: 'submit', text: '광고 신청 보내기' });
  const f = h('form', { novalidate: true },
    h('fieldset', {}, h('legend', { text: '상품' }), h('div', { class: 'opts' }, ...product), fieldErr('product')),
    h('div', { class: 'row' },
      h('div', { class: 'field' }, h('label', { for: 'f-start', text: '시작 날짜' }), input('start', { type: 'date', min: tomorrow, max: last, value: tomorrow, required: true }), fieldErr('start')),
      h('div', { class: 'field' }, h('label', { for: 'f-days', text: '일수' }), input('days', { type: 'number', min: 1, max: ADS.daysMax, value: 1, inputmode: 'numeric', required: true }), fieldErr('days'))),
    h('div', { class: 'field' }, h('label', { for: 'f-screen', text: '광고 화면' }), screen, fieldErr('screen')),
    h('fieldset', {}, h('legend', { text: '광고 문구 3줄' }),
      ...lines.map((el, i) => h('div', { class: 'field' }, h('label', { for: el.id, text: `${i + 1}번째 줄${i ? ' (선택)' : ''}` }), el, counts[i])), fieldErr('lines')),
    h('div', { class: 'row' },
      h('div', { class: 'field' }, h('label', { for: 'f-emoji', text: '그림' }), emoji, fieldErr('emoji')),
      h('div', { class: 'field' }, h('label', { for: 'f-theme', text: '배경 색' }), theme, fieldErr('theme'))),
    preview,
    h('div', { class: 'field' }, h('label', { for: 'f-link', text: '링크 (선택)' }), input('link', { type: 'url', maxlength: ADS.linkMax, placeholder: 'https://', inputmode: 'url', autocomplete: 'url' }),
      h('span', { class: 'muted', text: '광장에서 광고 화면을 누르면 열리는 주소예요. https:// 로 시작하는 공개 주소만 돼요.' }), fieldErr('link')),
    h('div', { class: 'field' }, h('label', { for: 'f-company', text: '회사 또는 이름' }), input('company', { type: 'text', maxlength: ADS.nameMax, autocomplete: 'organization', required: true }), fieldErr('company')),
    h('div', { class: 'row' },
      h('div', { class: 'field' }, h('label', { for: 'f-email', text: '이메일' }), input('email', { type: 'email', maxlength: ADS.emailMax, autocomplete: 'email', inputmode: 'email', required: true }), fieldErr('email')),
      h('div', { class: 'field' }, h('label', { for: 'f-phone', text: '전화 (선택)' }), input('phone', { type: 'tel', maxlength: ADS.phoneMax, autocomplete: 'tel', inputmode: 'tel' }), fieldErr('phone'))),
    h('div', { class: 'field' }, h('label', { for: 'f-memo', text: '요청 사항 (선택)' }), h('textarea', { name: 'memo', id: 'f-memo', maxlength: ADS.memoMax }), fieldErr('memo')),
    h('div', { class: 'hp', 'aria-hidden': 'true' }, h('label', { for: 'f-website', text: '웹사이트 (비워 두세요)' }), input('website', { type: 'text', tabindex: '-1', autocomplete: 'off' })),
    h('div', { class: 'agree' },
      h('b', { text: '개인정보 수집·이용 동의 (필수)' }),
      h('div', { text: '수집 항목: 회사 또는 이름, 이메일, 전화번호(적은 경우), 광고 문구와 링크, 요청 사항. 이용 목적: 광고 문의 처리, 견적과 입금 안내, 광고 송출 일정 연락. 보유 기간: 문의일로부터 1년 뒤 지웁니다(계약이 이루어지면 세금계산서 등 법령이 정한 기록은 그 기간 동안). 동의하지 않을 수 있지만, 그러면 신청을 받을 수 없어요.' }),
      h('label', { for: 'f-agree' }, agree, h('span', { text: '위 내용에 동의합니다.' })), fieldErr('agree')),
    fieldErr('body'), btn,
    h('p', { class: 'muted', text: '신청만으로는 결제되지 않아요. 운영자가 문구를 검토한 뒤 견적과 입금 안내(계좌이체 또는 세금계산서)를 이메일로 보내 드려요. 카드 결제는 받지 않아요.' }));
  f.addEventListener('change', paint);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    for (const el of Object.values(err)) el.textContent = '';
    const v = (n) => f.elements[n]?.value ?? '';
    const k = f.querySelector('input[name=product]:checked')?.value || '';
    const body = { product: k, start: v('start'), days: Math.floor(Number(v('days'))), screen: k === 'sponsor9' ? '' : v('screen'), lines: lines.map((el) => el.value), emoji: v('emoji'), theme: v('theme'), link: v('link'), company: v('company'), email: v('email'), phone: v('phone'), memo: v('memo'), agree: agree.checked, website: v('website') };
    const chk = adRequestFault(body);
    if (!chk.ok) { (err[chk.field] || err.body).textContent = chk.error; (f.elements[chk.field === 'lines' ? 'line1' : chk.field] || btn).focus?.(); return; }
    btn.disabled = true; btn.textContent = '보내는 중…';
    try {
      const r = await fetch('/rt/ads/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw Object.assign(new Error(d.error || '신청을 보내지 못했어요. 잠시 뒤에 다시 해 주세요.'), { field: d.field });
      thanks(body.email, d.id);
    } catch (x) {
      (err[x.field] || err.body).textContent = x.message;
      btn.disabled = false; btn.textContent = '광고 신청 보내기';
    }
  });
  paint();
  return f;
}

function thanks(email, id) {
  app.replaceChildren(h('div', { class: 'card done' },
    h('h2', { text: '신청을 받았어요' }),
    h('p', {}, '운영자가 광고 문구를 검토한 뒤 ', h('b', { text: email }), '로 견적과 입금 안내(계좌이체 또는 세금계산서)를 이메일로 보내 드려요.'),
    h('p', { text: '입금이 확인되면 일정을 잡고, 광고가 끝나면 게임이 센 숫자로 리포트 링크를 보내 드려요. 카드 결제는 받지 않아요.' }),
    id ? h('p', { class: 'muted', text: `접수 번호 ${id}` }) : null,
    h('p', {}, h('a', { href: './', text: '광장으로 돌아가기' }))));
  window.scrollTo(0, 0);
}

function open(d) {
  app.replaceChildren(
    h('h1', { text: '타임스퀘어 광고 화면에 광고하세요' }),
    h('p', { class: 'lede', text: '모두의 전광판은 뉴욕 타임스퀘어를 옮겨 놓은 3D 광장이에요. 광장 곳곳에 광고 전용 화면 다섯 곳이 있고, 하루 단위로 가게·채널 홍보나 생일·응원 광고를 걸 수 있어요. 광장에서 화면을 누르면 링크가 열려요.' }),
    h('div', { class: 'card' }, h('span', { class: 'chip', text: '광고' }), ' 광고 화면에는 언제나 ‘광고’ 표시가 붙어요. 게임의 점령 전광판(코인으로 경쟁하는 칸)과는 따로 있어서, 광고를 사도 게임 안의 칸이나 코인을 얻지 않아요.'),
    h('h2', { text: '광고 화면' }),
    h('div', { class: 'card' }, mapSvg(),
      h('ul', { class: 'screens' }, ...AD_SCREENS.map((a, i) => h('li', {}, h('b', { text: String(i + 1) }), h('span', { text: `${a.name} · 가로 ${a.w}m, 땅에서 ${Math.round(a.y)}m` }))))),
    h('h2', { text: '광장 숫자' }), statsCard(d.stats),
    h('h2', { text: '상품과 가격' }), products(d.prices),
    h('h2', { text: '진행 순서' }),
    h('ol', { class: 'steps' }, h('li', { text: '아래 신청서를 보내요.' }), h('li', { text: '운영자가 문구를 검토하고 견적을 이메일로 보내요. 법령·약관에 어긋나거나 광장에 맞지 않는 광고는 거절할 수 있어요.' }),
      h('li', { text: '계좌이체 또는 세금계산서로 입금해요.' }), h('li', { text: '정한 날짜(한국 시간)에 광고가 나가요.' }), h('li', { text: '끝나면 리포트 링크를 보내 드려요(게임이 센 수).' })),
    h('h2', { text: '광고 신청' }), form());
}

Promise.all([
  fetch('/rt/ads/stats').then((r) => r.json()).catch(() => null),
  fetch('/rt/config').then((r) => r.json()).catch(() => null),
]).then(([d, cfg]) => (d?.on ? open(d) : closed(cfg)));
