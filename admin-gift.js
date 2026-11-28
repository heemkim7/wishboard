// 선물 전광판 in admin.html (one <script> line there): the daily numbers for E1 (price-ladder interest), E2 (boards, visitors per board,
// boards made from another board's page: K; 답장: boards that got their first reply board) and E3 (lock vs open arm), one day's boards with their 롤링페이퍼 lines and hide/unhide,
// and the "결제가 열렸어요" notice to the accounts that asked for it ((광고), never 21:00-08:00 KST). Same login cookie as the rest (a 401 goes back to the login page).
// 메인 타워 축하 1분: the refunds grant_coins did not take (and spends whose answer never came), whom to pay by hand at /rt/admin/coins, and a
// mark once paid (POST /rt/admin/gift/refund). Only this operator view carries the account ids.
// 공유 보상 많이 받은 사람 (GET /rt/admin/gift/share): the last 7 KST days per maker (friends counted, account / guest, points paid, distinct
// networks, by source), the top 50: how the operator spots abuse (the terms let points gained by abuse be taken back).
import { TIERS, OCCASIONS, windowText, kstDay, addDays } from './giftrules.js';
import { SOON_SRC } from './soonrules.js';

const $ = (id) => document.getElementById(id);
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
  // 출시 예정 관심 (soonrules.js soonReport, in the stats answer): which coming feature people want first.
  h('h2', { text: '출시 예정 관심 (최근 14일)' }),
  h('p', { class: 'sub', text: '준비 중인 기능 카드가 화면에 보인 수(페이지마다 한 번), 관심 버튼을 누른 수(누를 때마다), 관심을 등록한 사람(같은 사람은 한 번: 로그인한 계정, 손님 번호, 아니면 브라우저의 무작위 번호)입니다. 전환 = 등록 ÷ 보임. 운영자 기기와 시험 도구는 세지 않습니다. 사람 수(누적)는 지금까지 등록한 사람 전체입니다.' }),
  h('div', { class: 'scroll' }, h('table', { id: 'giftSoon' })),
  h('div', { class: 'scroll' }, h('table', { id: 'giftSoonDays' })),
  h('div', { class: 'bar' }, dayIn),
  h('div', { class: 'hits', id: 'giftList' }),
  h('h2', { text: '공유 보상 많이 받은 사람 (최근 7일)' }),
  h('p', { class: 'sub', text: '링크로 온 친구가 반응해서 만든 사람이 받은 공유 보상입니다(선물 페이지, 소원 링크, 전광판 링크). 친구는 한 연결을 그날 한 번만 셉니다. 계정 친구 1~10번째 +50, 11~30번째 +20, 손님 친구 +10, 31번째부터는 세기만 합니다. 연결 수에 비해 친구가 많거나 손님 친구만 많으면 살펴보세요. 부정하게 얻은 포인트는 약관대로 회수할 수 있습니다.' }),
  h('div', { class: 'hits', id: 'giftShare' }),
  h('h2', { text: '메인 타워 1분: 손으로 돌려줄 포인트' }),
  h('p', { class: 'sub', text: '돌려주기(grant_coins)가 실패했거나, 포인트를 뺀 답이 오지 않아 확인이 필요한 것입니다. 코인 지급(/rt/admin/coins)으로 2,000을 준 뒤 "줬어요"를 누릅니다. "확인 필요"는 지갑 기록을 먼저 봅니다.' }),
  h('div', { class: 'hits', id: 'giftRefunds' }),
  h('h2', { text: '결제 오픈 알림 (광고)' }),
  h('p', { class: 'sub', text: '알림 신청을 한 계정에게 한 번씩 보냅니다. 한 번에 10명씩 보내고, 남은 사람이 있으면 다시 누릅니다. 밤 9시부터 아침 8시(한국 시간)까지는 보내지 않습니다.' }),
  h('div', { class: 'bar' }, text, h('button', { type: 'button', class: 'gold', text: '보내기', onclick: () => notify() })));
(document.querySelector('main') || document.body).append(box);
dayIn.addEventListener('change', () => load());

function say(t, err) { const m = $('giftMsg'); m.textContent = t || ''; m.className = err ? 'msg err' : 'msg'; }
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin' });
  if (r.status === 401) { location.replace('/admin'); throw new Error('로그인이 끝났어요. 다시 로그인해 주세요.'); }
  const d = await r.json().catch(() => ({})); if (!r.ok || d.ok === false) throw new Error(d.error || '처리하지 못했어요.');
  return d;
}
// The daily keys (giftsrv.js gd), then the ratios read at a glance: [name, numerator, denominator] of the same day (or the 30 days).
const COLS = [['start', '만들기 시작'], ['start_ref', '다른 보드에서 와서 시작'], ['made', '만든 보드'], ['made_ref', '페이지에서 와서 만든'], ['reply', '답장'], ['made_again', '두 번째부터'],
  ['hit', '링크 열림(사람)'], ['hitbot', '링크 열림(미리보기·봇)'], ['view', '새 방문자'], ['view_day', '그날 방문자'], ['return_day', '그날 다시 온'], ['msg', '메시지'], ['video', '영상'], ['ev:film', '그린 영상 재생'], ['ev:play', '저장 영상 재생'], ['ev:done', '끝까지 봄'], ['ev:save', '영상 저장'], ['ev:go', '직접 가서 봄'], ['ev:cer', '점등식 온 기기'], ['ev:cershot', '단체 사진 저장·공유'], ['ev:share', '공유(주인)'], ['ev:reshare', '공유(받는 사람)'], ['heart', '💖 하트'], ['ev:cta', '나도 걸기 누름'], ['ladder', '가격표 본 보드'], ['pick:1', '3,900 고름'], ['pick:2', '7,900 고름'], ['pick:3', '14,900 고름'], ['notify:1', '알림 1'], ['notify:2', '알림 2'], ['notify:3', '알림 3'], ['report', '신고'],
  ['react', '친구 반응'], ['friend:g', '공유 친구(선물)'], ['friend:w', '공유 친구(소원)'], ['friend:c', '공유 친구(전광판)'], ['tpay', '공유 보상'], ['tpay_pt', '공유 보상 포인트'], ['tpay_fail', '공유 보상 되돌림'], ['tpay_unknown', '공유 보상 답 없음'], ['tower:friends', '메인 타워(친구)'], ['tower:points', '메인 타워(포인트)'], ['tower_free', '메인 타워 풀림'], ['tower_refund_fail', '돌려주기 실패'], ['tower_spend_unknown', '포인트 답 없음']];
const RATIOS = [['K', 'made_ref', 'made'], ['시작→만듦', 'made', 'start'], ['링크(사람)→방문', 'view', 'hit']];
// A key a day does not have is '—' (the store keeps only keys that were counted, and days before a key existed have none). A ratio's
// 30-day sum takes only the days that have its denominator: a month of made over one day of starts would mean nothing.
const ratioOf = (x, [, a, b]) => (x[b] ? ((x[a] || 0) / x[b]).toFixed(2) : '—');
const cell = (x, k) => (k in x ? String(x[k]) : '—');
async function load() {
  say('불러오는 중…');
  try {
    const d1 = kstDay(), st = await api('/rt/admin/gift/stats?d0=' + addDays(d1, -29) + '&d1=' + d1);
    const t = $('giftStats'); t.replaceChildren(h('tr', {}, h('th', { text: '날짜' }), ...COLS.map(([, n]) => h('th', { text: n })), ...RATIOS.map(([n]) => h('th', { text: n }))));
    const sum = {}, rsum = RATIOS.map(() => ({}));
    for (const day of [...st.days].reverse()) {
      for (const [k] of COLS) if (k in day) sum[k] = (sum[k] || 0) + day[k];
      RATIOS.forEach(([, a, b], i) => { if (b in day) { rsum[i][a] = (rsum[i][a] || 0) + (day[a] || 0); rsum[i][b] = (rsum[i][b] || 0) + day[b]; } });
      t.append(h('tr', {}, h('td', { text: day.d }), ...COLS.map(([k]) => h('td', { text: cell(day, k) })), ...RATIOS.map((r) => h('td', { text: ratioOf(day, r) }))));
    }
    t.append(h('tr', {}, h('td', {}, h('b', { text: '30일' })), ...COLS.map(([k]) => h('td', {}, h('b', { text: cell(sum, k) }))), ...RATIOS.map((r, i) => h('td', {}, h('b', { text: ratioOf(rsum[i], r) })))));
    // Makers by the board's account or guest id, from the boards still kept (a guest is one browser; linking an account joins them).
    const mk = st.makers, makers = mk ? h('div', { class: 'hit' }, h('b', { text: '만든 사람' }),
      h('span', { text: `이번 주(${mk.week.from} 월요일부터) ${mk.week.n}명 · 30일 안: 1개 ${mk.d30.one}명, 2개 이상 ${mk.d30.more}명 (남아 있는 보드 기준. 보드는 그날 7일 뒤 지워져요. 손님은 브라우저마다 따로 세요)` })) : null;
    const arms = $('giftArms'); arms.replaceChildren(...(makers ? [makers] : []), ...st.arms.map((a) => h('div', { class: 'hit' }, h('b', { text: a.lk ? '잠금(그날 공개)' : '바로 공개' }),
      h('span', { text: `보드 ${a.boards} · 보드당 방문자 ${a.boards ? (a.visitors / a.boards).toFixed(1) : 0} · 그날 방문자 ${a.dayVisitors} · 보드당 메시지 ${a.boards ? (a.lines / a.boards).toFixed(1) : 0} · 이어 만든 보드 ${a.kids} · 영상 ${a.videos}` }))),
      h('div', { class: 'hit' }, h('b', { text: '알림 신청' }), h('span', { text: (st.optins || []).map((o) => `${TIERS[o.t]?.name || o.t} ${o.n}명(보냄 ${o.sent})`).join(' · ') || '없음' })));
    soonPaint(st.soon);
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
    const sh = await api('/rt/admin/gift/share'), S = $('giftShare'), top = Array.isArray(sh.top) ? sh.top : [];
    if (S) S.replaceChildren(h('div', { class: 'hit' }, h('b', { text: `${sh.from || ''}부터 합계` }), h('span', { text: `만든 사람 ${sh.total?.makers || 0}명 · 친구 ${sh.total?.friends || 0} · 준 포인트 ${Number(sh.total?.paid || 0).toLocaleString('ko-KR')}` })),
      ...(top.length ? top.map((x, i) => h('div', { class: 'hit' }, h('b', { text: `${i + 1}. ${x.uid}` }),
        h('span', { text: `친구 ${x.friends}(계정 ${x.acct} · 손님 ${x.guest}) · ${Number(x.paid || 0).toLocaleString('ko-KR')}포인트 · 연결 ${x.nets}곳 · ${x.days}일 · 선물 ${x.src?.g || 0} · 소원 ${x.src?.w || 0} · 전광판 ${x.src?.c || 0}` + (x.fails ? ` · 지급 거절 ${x.fails}` : '') + (x.unknown ? ` · 답 없음 ${x.unknown}(지갑 기록 확인)` : '') + (x.waits ? ` · 묶음 한도로 못 줌 ${x.waits}` : '') })))
        : [h('div', { class: 'empty', text: '최근 7일 공유 보상이 없어요.' })]));
    const R = $('giftRefunds'), owed = Array.isArray(list.refunds) ? list.refunds : [];
    if (R) R.replaceChildren(...(owed.length ? owed.map((x) => h('div', { class: 'hit' },
      h('b', { text: (x.done ? '✔ 줬음 · ' : '') + x.uid + ' · ' + Number(x.amount || 2000).toLocaleString('ko-KR') + '포인트' }),
      h('span', { text: '메인 타워 ' + new Date(x.m).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + ' · ' + (x.why === 'unknown' ? '확인 필요(뺀 답이 오지 않음)' : x.why === 'off' ? '풀린 예약' : '예약 실패') + ' · ' + new Date(x.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) }),
      h('a', { href: '/g/' + x.g, target: '_blank', rel: 'noopener', text: '/g/' + x.g }),
      h('button', { type: 'button', class: x.done ? 'no' : 'ok', text: x.done ? '되돌리기' : '줬어요', onclick: () => refunded(x.k, !x.done) })))
      : [h('div', { class: 'empty', text: '손으로 돌려줄 것이 없어요.' })]));
    say(`R2 영상 저장소 ${list.media ? '켜짐' : '없음'} · E3 반반 시험 ${list.e3 ? '켜짐(GIFT_E3=1)' : '꺼짐(모두 잠금)'}`);
  } catch (e) { say(e.message, true); }
}
// 출시 예정 관심: the ranking table (rank, feature, seen, taps, registered in the 14 days, conversion, login / guest, by source, people so
// far), then the 14 days, one row a day: registered / taps / seen per feature. An older Worker sends no soon: the block says so.
const SRC_NAME = { owner: '선물 주인', me: '내 전광판 주인', more: '더 보기', plaza: '광장', soon: '목록(/discover)' };
const pct = (x) => (x * 100).toFixed(1) + '%';
function soonPaint(so) {
  const T = $('giftSoon'), D = $('giftSoonDays'); if (!T || !D) return;
  if (!so || !Array.isArray(so.features)) { T.replaceChildren(h('tr', {}, h('td', { text: '아직 집계가 없어요(이 Worker에는 출시 예정 관심이 없어요).' }))); D.replaceChildren(); return; }
  const by = new Map(so.features.map((x) => [x.f, x]));
  T.replaceChildren(h('tr', {}, ...['순위', '기능', '보임', '누름', '등록', '전환(등록÷보임)', '누름÷보임', '등록 계정/손님', '보임 계정/손님', '출처별 보임·누름·등록', '사람(누적, 계정/손님)'].map((t) => h('th', { text: t }))),
    ...so.rank.map((f, i) => { const x = by.get(f); return h('tr', {}, h('td', { text: String(i + 1) }), h('td', {}, h('b', { text: x.name })), h('td', { text: String(x.imp) }), h('td', { text: String(x.tap) }), h('td', {}, h('b', { text: String(x.reg) })),
      h('td', { text: x.imp ? pct(x.conv) : '—' }), h('td', { text: x.imp ? pct(x.tapRate) : '—' }), h('td', { text: x.login.reg + ' / ' + x.guest.reg }), h('td', { text: x.login.imp + ' / ' + x.guest.imp }),
      h('td', { text: SOON_SRC.map((s) => SRC_NAME[s] + ' ' + x.src[s].imp + '·' + x.src[s].tap + '·' + x.src[s].reg).join(' | ') }), h('td', { text: x.people.all + ' (' + x.people.login + '/' + x.people.guest + ')' })); }));
  const feats = so.features;
  D.replaceChildren(h('tr', {}, h('th', { text: '날짜' }), ...feats.map((x) => h('th', { text: x.name + ' 등록/누름/보임' }))),
    ...[...(feats[0]?.trend || [])].map((_, i) => i).reverse().map((i) => h('tr', {}, h('td', { text: feats[0].trend[i].d }), ...feats.map((x) => { const t = x.trend[i]; return h('td', { text: t.reg + ' / ' + t.tap + ' / ' + t.imp }); }))));
}
async function refunded(k, done) { try { await api('/rt/admin/gift/refund', { k, done }); load(); } catch (e) { say(e.message, true); } }
async function hide(id, m, on) { try { await api('/rt/admin/gift/hide', { id, m, hide: on }); load(); } catch (e) { say(e.message, true); } }
async function notify() {
  const t = text.value.trim(); if (!t) { say('보낼 문구를 적어 주세요.', true); return; }
  if (!confirm('알림 신청자에게 "(광고) ' + t + '"를 보낼까요?')) return;
  try { const r = await api('/rt/admin/gift/notify', { text: t }); say(`${r.sent}명에게 보냈어요. 남은 사람 ${r.left}명.`); } catch (e) { say(e.message, true); }
}
load();
