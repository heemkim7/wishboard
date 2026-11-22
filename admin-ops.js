// admin.html: 오류 · 문의함 · 점검 (launch plan 상1, 상2, 상4). Rendered into #opsRoot; every request carries the ADMIN_KEY admin.html keeps in
// sessionStorage ('kts-admin'). Everything from the server is set as text, never as HTML.
import { SUPPORT_KINDS, kstWhen, MAINT_DEFAULT } from './opsrules.js';

const root = document.getElementById('opsRoot');
const KIND = Object.fromEntries(SUPPORT_KINDS);
const key = () => { try { return sessionStorage.getItem('kts-admin') || ''; } catch { return ''; } };
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'text') n.textContent = v; else if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'style') Object.assign(n.style, v); else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
async function api(path, init = {}) {
  const k = key();
  if (!k) throw new Error('ADMIN_KEY를 입력하고 열기를 누르세요.');
  const r = await fetch(path, { ...init, cache: 'no-store', headers: { ...(init.headers || {}), 'x-admin-key': k, ...(init.body ? { 'content-type': 'application/json' } : {}) } });
  if (r.status === 401) throw new Error('ADMIN_KEY가 맞지 않아요.');
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok === false) throw new Error(d.error || d.err || '처리하지 못했어요');
  return d;
}
const when = (ms) => (ms ? kstWhen(ms) : '—');

const TABS = [['errors', '🧯 오류'], ['support', '📮 문의함'], ['maint', '🚧 점검']];
let tab = 'errors', supStatus = 'open';
const tabs = el('div', { class: 'tabs' }), msg = el('div', { class: 'msg' }), body = el('div', { class: 'hits' });
const say = (t, err) => { msg.textContent = t || ''; msg.className = err ? 'msg err' : 'msg'; };
root.append(
  el('h2', { text: '🛠 운영' }),
  el('p', { class: 'sub', text: '오류는 같은 문구·같은 위치끼리 묶어 최근 300종류, 문의는 최근 500건을 Worker(DO)에 둡니다. 처리한 문의는 1년 뒤 지워집니다. 점검을 켜면 입장 화면이 점검 안내로 바뀌고(1분 안에 모든 화면), 이미 들어온 사람은 안내만 받습니다.' }),
  tabs, msg, body,
);
function renderTabs() {
  tabs.replaceChildren(...TABS.map(([k, label]) => el('button', { type: 'button', text: label, class: k === tab ? 'on' : '', onclick: () => { tab = k; renderTabs(); load(); } })));
}

async function loadErrors() {
  const d = await api('/rt/admin/errors');
  const items = Array.isArray(d.items) ? d.items : [];
  const evicted = Math.max(0, Number(d.evicted) || 0); // groups dropped to make room (the least recently seen first) since the last clear
  say((items.length ? `${items.length}종류 · 합 ${items.reduce((s, x) => s + (Number(x.n) || 0), 0)}번` : '모인 오류가 없어요.')
    + (evicted ? ` · 자리가 모자라 오래 안 보인 ${evicted}종류를 지웠어요(마지막으로 지운 뒤부터).` : ''), evicted > 0);
  const clear = el('button', { type: 'button', class: 'no', text: '모두 지우기', onclick: async () => {
    if (!confirm('모은 오류를 모두 지울까요? 되돌릴 수 없어요.')) return;
    clear.disabled = true;
    try { const r = await api('/rt/admin/errors/clear', { method: 'POST', body: '{}' }); say(`${r.cleared || 0}종류를 지웠어요.`); loadErrors(); } catch (e) { say(e.message, true); clear.disabled = false; }
  } });
  body.replaceChildren(el('div', { class: 'bar' }, el('button', { type: 'button', text: '새로고침', onclick: () => load() }), clear),
    ...items.map((x) => el('div', { class: 'hit', style: { display: 'block' } },
      el('div', null, el('b', { text: `${x.n}번` }), ' · ', el('span', { text: `마지막 ${when(x.last)} · 처음 ${when(x.first)}` }), ' · ', el('span', { text: x.kind === 'server' ? '서버' : '화면' }),
        x.builds?.length ? el('span', { text: ' · 빌드 ' + x.builds.join(', ') }) : null),
      el('div', { style: { marginTop: '4px', color: 'var(--text)' }, text: x.msg }),
      el('div', null, el('span', { text: [x.src, x.page, x.ua, x.tier, x.touch ? '터치' : ''].filter(Boolean).join(' · ') })),
      x.stack ? el('details', null, el('summary', { text: '스택' }), el('pre', { style: { whiteSpace: 'pre-wrap', margin: '6px 0 0', fontSize: '12px', color: 'var(--muted)' }, text: x.stack })) : null)));
}

async function loadSupport() {
  const d = await api('/rt/admin/support?status=' + supStatus);
  const items = Array.isArray(d.items) ? d.items : [];
  say(`처리 전 ${d.open || 0}건` + (supStatus === 'open' ? '' : ` · 이 목록 ${items.length}건`));
  const filter = el('div', { class: 'tabs', style: { marginTop: '0' } }, ...[['open', '처리 전'], ['done', '처리함'], ['all', '전부']].map(([k, label]) =>
    el('button', { type: 'button', text: label, class: k === supStatus ? 'on' : '', onclick: () => { supStatus = k; load(); } })));
  body.replaceChildren(el('div', { class: 'bar' }, filter, el('button', { type: 'button', text: '새로고침', onclick: () => load() })),
    ...(items.length ? items.map((x) => {
      const mark = el('button', { type: 'button', class: x.status === 'open' ? 'ok' : '', text: x.status === 'open' ? '처리 완료' : '다시 열기', onclick: async () => {
        mark.disabled = true;
        try { await api('/rt/admin/support', { method: 'POST', body: JSON.stringify({ id: x.id, status: x.status === 'open' ? 'done' : 'open' }) }); load(); } catch (e) { say(e.message, true); mark.disabled = false; }
      } });
      return el('div', { class: 'hit', style: { display: 'block' } },
        el('div', null, el('b', { text: KIND[x.kind] || x.kind }), ' · ', el('span', { text: when(x.at) }), ' · ', el('span', { text: x.status === 'open' ? '처리 전' : `처리함 ${when(x.done_at)}` })),
        el('div', { style: { margin: '6px 0', whiteSpace: 'pre-wrap', color: 'var(--text)' }, text: x.body }),
        el('div', null, el('span', { text: [x.nick && '닉네임 ' + x.nick, x.actor && '계정 ' + x.actor, x.email && '답장 ' + x.email, x.dev, x.build && '빌드 ' + x.build, x.page].filter(Boolean).join(' · ') })),
        el('div', { class: 'acts', style: { padding: '8px 0 0' } }, mark));
    }) : [el('div', { class: 'empty', text: '해당하는 문의가 없어요' })]));
}

// datetime-local is read as Korea time, whatever the admin's own clock says.
const kstInput = (ms) => { if (!ms) return ''; const d = new Date(ms + 9 * 3600e3); return d.toISOString().slice(0, 16); };
async function loadMaint() {
  const d = await api('/rt/admin/maint');
  const m = d.maint || { on: false };
  say(m.on ? `🚧 점검 중 (${when(m.at)}부터)` : '점검이 꺼져 있어요.');
  const on = el('input', { type: 'checkbox', id: 'opsMaintOn' }); on.checked = !!m.on;
  const text = el('input', { type: 'text', maxlength: '120', placeholder: MAINT_DEFAULT, value: m.on ? m.msg || '' : '' });
  const until = el('input', { type: 'datetime-local', value: m.on ? kstInput(m.until) : '' });
  const save = el('button', { type: 'button', class: 'gold', text: '저장', onclick: async () => {
    const u = until.value ? Date.parse(until.value + ':00+09:00') : 0;
    if (until.value && !Number.isFinite(u)) { say('끝나는 시각을 다시 확인해 주세요.', true); return; }
    if (on.checked && !confirm('점검을 켤까요? 1분 안에 모든 입장 화면이 점검 안내로 바뀝니다.')) return;
    save.disabled = true;
    try { await api('/rt/admin/maint', { method: 'POST', body: JSON.stringify({ on: on.checked, msg: text.value.trim(), until: u }) }); loadMaint(); } catch (e) { say(e.message, true); } finally { save.disabled = false; }
  } });
  body.replaceChildren(
    el('div', { class: 'bar' }, el('label', { for: 'opsMaintOn', style: { display: 'flex', gap: '8px', alignItems: 'center', fontWeight: '800' } }, on, '점검 켜기'), text),
    el('div', { class: 'bar' }, el('span', { class: 'sub', style: { margin: '0' }, text: '끝나는 시각(한국 시간, 선택)' }), until, save),
    el('p', { class: 'sub', text: '켜져 있는 동안: 입장 화면은 이 문구와 끝나는 시각을 보이고 1분마다 다시 확인합니다. 이미 들어온 사람은 5분 안에 안내 한 번을 받고 그대로 놉니다. 서버 경로는 막지 않습니다.' }),
    el('p', { class: 'sub' }, '점검 중에 직접 들어가 보기: ', el('a', { href: '/?maint=skip', style: { color: 'var(--gold-2)' }, text: '/?maint=skip' }), ' (이 탭에서 열어야 합니다. 이 탭의 ADMIN_KEY를 서버가 확인한 뒤에만 열립니다.)'),
  );
}

async function load() {
  if (!key()) { say('ADMIN_KEY를 입력하고 열기를 누르세요.'); body.replaceChildren(); return; }
  say('불러오는 중…');
  try { await (tab === 'errors' ? loadErrors() : tab === 'support' ? loadSupport() : loadMaint()); } catch (e) { say(e.message, true); }
}
renderTabs();
document.getElementById('save')?.addEventListener('click', () => setTimeout(load, 0)); // admin.html's own handler stores the key first
load();
