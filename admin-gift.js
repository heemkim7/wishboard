// 선물 전광판 in admin.html (one <script> line there): the daily numbers for E1 (price-ladder interest), E2 (boards, visitors per board,
// boards made from another board's page: K; 답장: boards that got their first reply board) and E3 (lock vs open arm), one day's boards with their 롤링페이퍼 lines and hide/unhide,
// and the "결제가 열렸어요" notice to the accounts that asked for it ((광고), never 21:00-08:00 KST). Same x-admin-key as the rest.
import { TIERS, OCCASIONS, windowText, kstDay, addDays } from './giftrules.js';

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
const dayIn = h('input', { type: 'date', id: 'giftDay', value: kstDay() });
const text = h('input', { type: 'text', id: 'giftNote', maxlength: 80, placeholder: '열리면 보낼 문구 (앞에 (광고)가 붙어요)' });
const box = h('section', { id: 'giftAdmin' },
  h('h2', {}, '🎁 선물 전광판 ', h('button', { type: 'button', text: '새로고침', onclick: () => load() })),
  h('p', { class: 'sub', text: '무료 시즌 지표. 만든 수, 보드당 방문자(같은 기기는 한 번), 롤링페이퍼 메시지, 다른 보드의 페이지에서 와서 만든 보드(K = 이어 만든 보드 ÷ 만든 보드), 유료 관심(가격표를 본 보드, 단계별 고름, 알림 신청)은 계정과 이어지지 않은 하루 합계입니다. 알림 신청만 계정 번호를 따로 동의받아 보관합니다(60일).' }),
  h('div', { class: 'msg', id: 'giftMsg' }),
  h('div', { class: 'scroll' }, h('table', { id: 'giftStats' })),
  h('div', { class: 'hits', id: 'giftArms' }),
  h('div', { class: 'bar' }, dayIn),
  h('div', { class: 'hits', id: 'giftList' }),
  h('h2', { text: '결제 오픈 알림 (광고)' }),
  h('p', { class: 'sub', text: '알림 신청을 한 계정에게 한 번씩 보냅니다. 한 번에 10명씩 보내고, 남은 사람이 있으면 다시 누릅니다. 밤 9시부터 아침 8시(한국 시간)까지는 보내지 않습니다.' }),
  h('div', { class: 'bar' }, text, h('button', { type: 'button', class: 'gold', text: '보내기', onclick: () => notify() })));
(document.querySelector('main') || document.body).append(box);
dayIn.addEventListener('change', () => load());

function say(t, err) { const m = $('giftMsg'); m.textContent = t || ''; m.className = err ? 'msg err' : 'msg'; }
async function api(path, body) {
  const key = keyOf(); if (!key) throw new Error('ADMIN_KEY를 입력하세요.');
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': key }, body: JSON.stringify(body) } : { headers: { 'x-admin-key': key } });
  if (r.status === 401) throw new Error('ADMIN_KEY가 맞지 않아요.');
  const d = await r.json().catch(() => ({})); if (!r.ok || d.ok === false) throw new Error(d.error || '처리하지 못했어요.');
  return d;
}
// The daily keys (giftsrv.js gd), then the ratios read at a glance: [name, numerator, denominator] of the same day (or the 30 days).
const COLS = [['start', '만들기 시작'], ['start_ref', '다른 보드에서 와서 시작'], ['made', '만든 보드'], ['made_ref', '페이지에서 와서 만든'], ['reply', '답장'], ['made_again', '두 번째부터'],
  ['hit', '링크 열림(사람)'], ['hitbot', '링크 열림(미리보기·봇)'], ['view', '새 방문자'], ['view_day', '그날 방문자'], ['return_day', '그날 다시 온'], ['msg', '메시지'], ['video', '영상'], ['ev:film', '그린 영상 재생'], ['ev:play', '저장 영상 재생'], ['ev:done', '끝까지 봄'], ['ev:save', '영상 저장'], ['ev:go', '직접 가서 봄'], ['ev:cer', '점등식 온 기기'], ['ev:cershot', '단체 사진 저장·공유'], ['ev:share', '공유(주인)'], ['ev:reshare', '공유(받는 사람)'], ['heart', '💖 하트'], ['ev:cta', '나도 걸기 누름'], ['ladder', '가격표 본 보드'], ['pick:1', '3,900 고름'], ['pick:2', '7,900 고름'], ['pick:3', '14,900 고름'], ['notify:1', '알림 1'], ['notify:2', '알림 2'], ['notify:3', '알림 3'], ['report', '신고']];
const RATIOS = [['K', 'made_ref', 'made'], ['시작→만듦', 'made', 'start'], ['링크(사람)→방문', 'view', 'hit']];
const ratioOf = (x, [, a, b]) => (x[b] ? ((x[a] || 0) / x[b]).toFixed(2) : '—');
async function load() {
  say('불러오는 중…');
  try {
    const d1 = kstDay(), st = await api('/rt/admin/gift/stats?d0=' + addDays(d1, -29) + '&d1=' + d1);
    const t = $('giftStats'); t.replaceChildren(h('tr', {}, h('th', { text: '날짜' }), ...COLS.map(([, n]) => h('th', { text: n })), ...RATIOS.map(([n]) => h('th', { text: n }))));
    const sum = {};
    for (const day of [...st.days].reverse()) {
      for (const [k] of COLS) sum[k] = (sum[k] || 0) + (day[k] || 0);
      t.append(h('tr', {}, h('td', { text: day.d }), ...COLS.map(([k]) => h('td', { text: String(day[k] || 0) })), ...RATIOS.map((r) => h('td', { text: ratioOf(day, r) }))));
    }
    t.append(h('tr', {}, h('td', {}, h('b', { text: '30일' })), ...COLS.map(([k]) => h('td', {}, h('b', { text: String(sum[k] || 0) }))), ...RATIOS.map((r) => h('td', {}, h('b', { text: ratioOf(sum, r) })))));
    // Makers by the board's account or guest id, from the boards still kept (a guest is one browser; linking an account joins them).
    const mk = st.makers, makers = mk ? h('div', { class: 'hit' }, h('b', { text: '만든 사람' }),
      h('span', { text: `이번 주(${mk.week.from} 월요일부터) ${mk.week.n}명 · 30일 안: 1개 ${mk.d30.one}명, 2개 이상 ${mk.d30.more}명 (남아 있는 보드 기준. 보드는 그날 7일 뒤 지워져요. 손님은 브라우저마다 따로 세요)` })) : null;
    const arms = $('giftArms'); arms.replaceChildren(...(makers ? [makers] : []), ...st.arms.map((a) => h('div', { class: 'hit' }, h('b', { text: a.lk ? '잠금(그날 공개)' : '바로 공개' }),
      h('span', { text: `보드 ${a.boards} · 보드당 방문자 ${a.boards ? (a.visitors / a.boards).toFixed(1) : 0} · 그날 방문자 ${a.dayVisitors} · 보드당 메시지 ${a.boards ? (a.lines / a.boards).toFixed(1) : 0} · 이어 만든 보드 ${a.kids} · 영상 ${a.videos}` }))),
      h('div', { class: 'hit' }, h('b', { text: '알림 신청' }), h('span', { text: (st.optins || []).map((o) => `${TIERS[o.t]?.name || o.t} ${o.n}명(보냄 ${o.sent})`).join(' · ') || '없음' })));
    const list = await api('/rt/admin/gift?day=' + (dayIn.value || kstDay()));
    const L = $('giftList');
    L.replaceChildren(...(list.boards.length ? list.boards.map((g) => h('div', { class: 'hit' },
      h('b', { text: (OCCASIONS[g.occ]?.emoji || '🎁') + ' To. ' + g.to }), h('span', { text: (g.msg || '') + (g.from ? ' · From. ' + g.from : '') }),
      h('span', { text: windowText(g.a, g.b) + ' · ' + g.scr + ' · ' + g.phase + (g.st !== 'live' ? ' · ' + g.st : '') + ' · 방문 ' + g.v + ' · 메시지 ' + g.n + ' · 하트 ' + (g.hr || 0) + ' · 신고 ' + g.rp + (g.vid ? ' · 영상' : '') }),
      h('a', { href: '/g/' + g.id, target: '_blank', rel: 'noopener', text: '/g/' + g.id }),
      h('button', { type: 'button', class: g.st === 'live' ? 'no' : 'ok', text: g.st === 'live' ? '가리기' : '되살리기', onclick: () => hide(g.id, '', g.st === 'live') }),
      ...g.lines.map((m) => h('div', { class: 'hit', style: 'width:100%' }, h('b', { text: m.nick }), h('span', { text: m.txt + ' · 신고 ' + m.rp + (m.st !== 'live' ? ' · 가려짐' : '') }),
        h('button', { type: 'button', class: m.st === 'live' ? 'no' : 'ok', text: m.st === 'live' ? '가리기' : '되살리기', onclick: () => hide(g.id, m.id, m.st === 'live') })))))
      : [h('div', { class: 'empty', text: '그날의 선물 전광판이 없어요.' })]));
    say(`R2 영상 저장소 ${list.media ? '켜짐' : '없음'} · E3 반반 시험 ${list.e3 ? '켜짐(GIFT_E3=1)' : '꺼짐(모두 잠금)'}`);
  } catch (e) { say(e.message, true); }
}
async function hide(id, m, on) { try { await api('/rt/admin/gift/hide', { id, m, hide: on }); load(); } catch (e) { say(e.message, true); } }
async function notify() {
  const t = text.value.trim(); if (!t) { say('보낼 문구를 적어 주세요.', true); return; }
  if (!confirm('알림 신청자에게 "(광고) ' + t + '"를 보낼까요?')) return;
  try { const r = await api('/rt/admin/gift/notify', { text: t }); say(`${r.sent}명에게 보냈어요. 남은 사람 ${r.left}명.`); } catch (e) { say(e.message, true); }
}
if (keyOf()) load();
