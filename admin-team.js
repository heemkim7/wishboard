// 응원 팀과 명당 in admin.html (one <script> line there): the weekly numbers of the report (활성 팀, daily distinct supporters per team, goals
// reached, D7 / D30 of team members), why supports were not counted today, the anniversaries waiting for approval, and hiding a team whose
// name breaks the posting rules. One GET /rt/admin/teams a load (two Meter calls in one instance, teamsrv.js admin). Same x-admin-key as the rest.
import { PRIME, mdText, pct } from './primerules.js';

const $ = (id) => document.getElementById(id);
const keyOf = () => (($('key')?.value || '').trim() || sessionStorage.getItem('kts-admin') || '');
function h(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
const box = h('section', { id: 'teamAdmin' },
  h('h2', {}, '🏆 응원 팀과 명당 ', h('button', { type: 'button', text: '새로고침', onclick: () => load() })),
  h('p', { class: 'sub', text: `서로 다른 응원한 사람(계정 연결 ${PRIME.ageDays}일 이상, 같은 인터넷 연결은 팀마다 하루 한 명)으로만 셉니다. 목표 ${PRIME.goals.small}·${PRIME.goals.big}·${PRIME.goals.tower.toLocaleString('ko-KR')}명, 참여율은 최근 ${PRIME.activeDays}일 응원한 팀원 ${PRIME.minTeam}명 이상인 팀만. 포인트와 결제는 들어가지 않습니다. 팀원 D7·D30은 팀에 들어간 날로 묶은 사람 가운데 7·30일 뒤 그날 응원한 비율입니다.` }),
  h('div', { class: 'msg', id: 'teamMsg' }),
  h('div', { class: 'hits', id: 'teamSum' }),
  h('h2', { text: '기념일 승인 대기' }),
  h('p', { class: 'sub', text: `승인하면 매년 그날 메인 타워 정시 1분이 그 팀에 돌아갑니다. 하루에 ${PRIME.annMax}팀까지. 아이돌 생일·데뷔일 같은 공개된 날만 승인하세요.` }),
  h('div', { class: 'hits', id: 'teamAnn' }),
  h('h2', { text: '날마다 응원한 사람 (최근 14일)' }),
  h('div', { class: 'scroll' }, h('table', { id: 'teamDays' })),
  h('h2', { text: '팀 목록' }),
  h('div', { class: 'hits', id: 'teamList' }));
(document.querySelector('main') || document.body).append(box);

function say(t, err) { const m = $('teamMsg'); m.textContent = t || ''; m.className = err ? 'msg err' : 'msg'; }
async function api(path, body) {
  const key = keyOf(); if (!key) throw new Error('ADMIN_KEY를 입력하세요.');
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': key }, body: JSON.stringify(body) } : { headers: { 'x-admin-key': key } });
  if (r.status === 401) throw new Error('ADMIN_KEY가 맞지 않아요.');
  const d = await r.json().catch(() => ({})); if (!r.ok || d.ok === false) throw new Error(d.error || '처리하지 못했어요.');
  return d;
}
const WHY = { ok: '세어짐', guest: '손님', young: '가입 3일 미만', net: '같은 연결', wait: '나이 확인 못 함' };
const GOAL = { small: '30명', big: '100명', tower: '1,000명', hot: '가장 뜨거운', gold: '밤 9시', ann: '기념일' };
async function load() {
  say('불러오는 중…');
  try {
    const d = await api('/rt/admin/teams');
    const cohort = (c) => (c?.joined ? `${pct(c.rate)} (${c.back}/${c.joined})` : '아직 없음');
    $('teamSum').replaceChildren(
      h('div', { class: 'hit' }, h('b', { text: '활성 팀(이번 주)' }), h('span', { text: `${d.active}팀 · 전체 ${d.teams}팀 · 팀원 ${d.members}명` })),
      h('div', { class: 'hit' }, h('b', { text: '팀원 D7 / D30' }), h('span', { text: `D7 ${cohort(d.d7)} · D30 ${cohort(d.d30)}` })),
      h('div', { class: 'hit' }, h('b', { text: '오늘 응원' }), h('span', { text: (d.why || []).map((w) => `${WHY[w.why] || w.why} ${w.n}`).join(' · ') || '아직 없음' })),
      h('div', { class: 'hit' }, h('b', { text: '목표·명당 (최근 14일)' }), h('span', { text: Object.entries((d.goals || []).reduce((o, g) => { o[g.kind] = (o[g.kind] || 0) + g.n; return o; }, {})).map(([k, n]) => `${GOAL[k] || k} ${n}`).join(' · ') || '아직 없음' })));
    $('teamAnn').replaceChildren(...((d.wait || []).length ? d.wait.map((a) => h('div', { class: 'hit' },
      h('b', { text: `${a.name} · ${mdText(a.md)}` }), h('span', { text: `${a.label || '(이름 없음)'} · 그날 이미 승인 ${d.okBy?.[a.md] || 0}팀` }),
      h('button', { type: 'button', class: 'gold', text: '승인', onclick: () => act({ op: 'ann', id: a.id, ok: true }) }),
      h('button', { type: 'button', text: '거절', onclick: () => act({ op: 'ann', id: a.id, ok: false }) }))) : [h('p', { class: 'sub', text: '대기 중인 기념일이 없어요.' })]));
    const days = [...new Set((d.days || []).map((r) => r.d))].sort().reverse();
    const top = [...(d.days || []).reduce((m, r) => m.set(r.id, { name: r.name, n: (m.get(r.id)?.n || 0) + r.n }), new Map())].sort((a, b) => b[1].n - a[1].n).slice(0, 12);
    const at = new Map((d.days || []).map((r) => [r.d + '|' + r.id, r]));
    $('teamDays').replaceChildren(h('tr', {}, h('th', { text: '날짜' }), ...top.map(([, t]) => h('th', { text: t.name }))),
      ...days.map((day) => h('tr', {}, h('td', { text: day }), ...top.map(([id]) => { const r = at.get(day + '|' + id); return h('td', { text: r ? `${r.n}${r.k > r.n ? ` (+${r.k - r.n})` : ''}` : '' }); }))));
    $('teamList').replaceChildren(...(d.list || []).map((t) => h('div', { class: 'hit' }, h('b', { text: t.name + (t.hidden ? ' (숨김)' : '') }), h('span', { text: `팀원 ${t.members} · ${t.id}` }),
      h('button', { type: 'button', text: t.hidden ? '다시 보이기' : '숨기기', onclick: () => { if (t.hidden || confirm(`${t.name} 팀을 모든 화면·순위에서 숨길까요?`)) act({ op: 'hide', id: t.id, hide: !t.hidden }); } }))));
    say(`${d.day} 기준. 괄호 안은 세지 않은 응원 수(손님, 가입 3일 미만, 같은 연결)입니다.`);
  } catch (e) { say(e.message, true); }
}
async function act(body) { try { await api('/rt/admin/team', body); await load(); } catch (e) { say(e.message, true); } }
if (keyOf()) load();
