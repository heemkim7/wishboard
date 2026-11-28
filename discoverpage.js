// /discover (discover.html): 둘러보기 without the 3D plaza. It reads the cached /rt/world and /rt/wishes once (the plaza's own reads: no new
// DO call per visit), draws each item on this device (a gift as its plaza card, giftart.js; a board or a wish as a card in HTML) and offers
// 💖 where the item takes one (a gift: POST /rt/gift/<id>/heart, one per device; a wish: POST /rt/wish/heart as this browser's guest or
// account), 공유하기 (its own share page), 3D에서 보기 (?gb= / ?focus= / ?wish=) and 나도 만들기. Popularity orders the lists; no rank, no count.
// A tab with fewer real items than DISCOVER.min also shows seasonal samples in their own section (SAMPLE_LABEL), never counted or mixed in.
// Text people wrote is only ever set with textContent.
import { TABS, DISCOVER, discoverItems, discoverTab, samplesFor, SAMPLE_LABEL, refreshDue } from './discoverrules.js?v=202611280944';
import { paintGift } from './giftart.js?v=202611280944';

const $app = document.getElementById('app');
const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
const json = (k, d) => { try { return JSON.parse(ls.get(k) || '') ?? d; } catch { return d; } };
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

// ---- who presses a wish heart: the plaza's own (a live signed-in session, else the guest token masil_gt; a guest made only on a press) ----
const AUTH_KEYS = ['maeul_auth', 'sb-yxddhpacuyaffaoutxjn-auth-token'];
function sessionToken() {
  for (const k of AUTH_KEYS) { const j = json(k, null), s = j?.currentSession || j; if (s?.access_token && Number(s.expires_at) * 1000 > Date.now() + 60000) return String(s.access_token); }
  return '';
}
let MINT = null;
async function token() {
  const s = sessionToken(); if (s) return s;
  const g = json('masil_gt', null);
  if (g?.token && Number(g.exp) * 1000 > Date.now() + 864e5) return String(g.token);
  if (!MINT) MINT = (async () => {
    const post = async (body) => { const r = await fetch('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { r, d: await r.json().catch(() => null) }; };
    let { r, d } = await post(g?.token ? { t: g.token } : {});
    if (r.status === 403 && d?.err === 'human') {
      let ts = ''; try { const m = await import('./human.js?v=202611280944'); ts = await m.humanToken(String(d.site || ''), { action: 'guest' }); } catch { ts = ''; }
      if (!ts) return '';
      ({ r, d } = await post({ ts }));
    }
    if (!r.ok || !d?.token) return '';
    ls.set('masil_gt', JSON.stringify(d)); return String(d.token);
  })().catch(() => '').finally(() => { MINT = null; });
  return MINT;
}
const visitor = () => { let v = ls.get('kts_gv'); if (!/^[0-9a-f]{16}$/.test(v || '')) { const b = new Uint8Array(8); crypto.getRandomValues(b); v = [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); ls.set('kts_gv', v); } return v; };

// ---- the hearts ----
// kts_ghearts: the gift pages' own store (one heart per device and board, giftpage.js); kts_dwish: the wishes this device hearted today.
const today = () => new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);
function heartBtn(it, note) {
  const key = it.heart === 'gift' ? 'kts_ghearts' : 'kts_dwish';
  const read = () => { const o = json(key, {}); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; };
  const had = () => { const v = read()[it.id]; return it.heart === 'gift' ? !!v : v === today(); };
  let on = had();
  const btn = h('button', { class: 'btn', type: 'button' });
  const paint = () => { btn.textContent = on ? '💖 하트를 보냈어요' : '🤍 하트'; btn.setAttribute('aria-pressed', String(on)); };
  btn.addEventListener('click', async () => {
    if (on) return;
    on = true; paint(); btn.disabled = true;
    let ok = false, said = '';
    try {
      if (it.heart === 'gift') {
        const r = await fetch('/rt/gift/' + it.id + '/heart', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: visitor() }) });
        ok = r.ok;
      } else {
        const tok = await token();
        if (tok) {
          const r = await fetch('/rt/wish/heart', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ id: it.id }) });
          const d = await r.json().catch(() => ({})); ok = r.ok && d?.ok !== false; said = ok ? '' : String(d?.error || '');
        }
      }
    } catch { ok = false; }
    btn.disabled = false;
    if (ok) { const o = read(); o[it.id] = it.heart === 'gift' ? 1 : today(); const ks = Object.keys(o); if (ks.length > 300) for (const k of ks.slice(0, 150)) delete o[k]; ls.set(key, JSON.stringify(o)); return; }
    on = false; paint(); note.textContent = said || '잠시 뒤에 다시 눌러 주세요.';
  });
  paint();
  return btn;
}
async function share(it, note) {
  const url = location.origin + it.page, title = it.big, text = [it.big, it.line].filter(Boolean).join(' · ') + ' · 가상 타임스퀘어 전광판';
  try { if (navigator.share) { await navigator.share({ title, text, url }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text + ' ' + url); note.textContent = '링크를 복사했어요. 카카오톡에 붙여 넣어 보내세요.'; } catch { note.textContent = url; }
}

// ---- the cards ----
function face(it) {
  if (it.art) { // a gift or a sample: its plaza card, drawn here
    const cv = h('canvas', { width: 640, height: 360, role: 'img', 'aria-label': [it.big, it.line, it.by].filter(Boolean).join(' · ') });
    try { paintGift(cv, it.art, it.sample ? { chip: false } : {}); } catch { /* the label still reads */ } // a sample never says 선물 전광판
    return cv;
  }
  return h('div', { class: 'face' + (it.kind === 'wish' ? ' wish' : '') }, h('span', { class: 'chip', text: it.chip }), h('div', { class: 'mid' }, h('p', { class: 'big', text: it.big }),
    it.line ? h('p', { class: 'line', text: it.line }) : null, it.by ? h('p', { class: 'by', text: it.by }) : null));
}
function itemCard(it) {
  const note = h('p', { class: 'note', role: 'status' });
  if (it.sample) return h('article', { class: 'item' }, face(it), h('span', { class: 'badge', text: SAMPLE_LABEL }), h('div', { class: 'acts' }, h('a', { class: 'btn gold', href: it.make, style: 'grid-column:1 / -1' }, '나도 만들기')));
  return h('article', { class: 'item' }, face(it),
    h('div', { class: 'acts' }, it.heart ? heartBtn(it, note) : null, h('button', { class: 'btn', type: 'button', onclick: () => share(it, note) }, '🔗 공유'),
      h('a', { class: 'btn', href: it.view }, '3D에서 보기'), h('a', { class: 'btn gold', href: it.make }, '나도 만들기')), note);
}

// ---- the page ----
const TAB_KEY = 'kts_dtab';
let ITEMS = [], tab = (() => { const q = new URLSearchParams(location.search).get('tab') || ls.get(TAB_KEY) || 'hot'; return TABS.some((t) => t.k === q) ? q : 'hot'; })(), DOWN = false;
function paint() {
  const list = discoverTab(ITEMS, tab), name = TABS.find((t) => t.k === tab)?.name || '';
  // A tablist with one panel: the chosen tab is the one in the Tab order; ←/→ (Home/End) move to the next tab, choose it and keep the focus there.
  const pick = (k, focus = false) => { tab = k; ls.set(TAB_KEY, tab); paint(); if (focus) { try { document.getElementById('tab-' + k)?.focus(); } catch { /* the tab is chosen */ } } };
  const keys = (e) => { const i = TABS.findIndex((t) => t.k === tab), n = TABS.length, to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1; if (to < 0) return; e.preventDefault(); pick(TABS[to].k, true); };
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': '둘러보기 목록', onkeydown: keys }, ...TABS.map((t) => h('button', { class: 'tab', type: 'button', role: 'tab', id: 'tab-' + t.k, 'aria-controls': 'panel', 'aria-selected': String(t.k === tab), tabindex: t.k === tab ? '0' : '-1', onclick: () => pick(t.k) }, t.name)));
  const body = list.length ? h('div', { class: 'grid' }, ...list.map(itemCard))
    : h('p', { class: 'empty', text: DOWN ? '지금은 목록을 불러오지 못했어요. 잠시 뒤에 다시 열어 주세요.' : `아직 ‘${name}’에 걸린 전광판이 없어요. 첫 전광판을 걸어 보세요.` });
  const samples = list.length < DISCOVER.min ? h('section', { class: 'samples', 'aria-label': SAMPLE_LABEL }, h('h2', { text: SAMPLE_LABEL }),
    h('p', { class: 'fine', text: '실제로 걸린 전광판이 아니라, 이렇게 걸 수 있다는 예시예요. 목록과 숫자에는 넣지 않아요.' }), h('div', { class: 'grid' }, ...samplesFor(Date.now()).map(itemCard))) : null;
  $app.replaceChildren(
    h('div', { class: 'top' }, h('a', { class: 'brand', href: '/' }, 'WISH BOARD', h('small', { text: '모두의 전광판' })), h('span', { class: 'tag', text: '둘러보기' })),
    h('h1', { text: '가상 타임스퀘어에 걸린 전광판' }),
    h('p', { class: 'sub', text: '지금 걸린 전광판과 오늘의 소원을 3D 없이 둘러봐요. 선물 전광판은 만든 사람이 ‘DISCOVER에 보이기’를 켠 것만 보여요.' }),
    h('div', { class: 'make' }, h('a', { class: 'btn gold', href: '/gift' }, '🎁 선물하기'), h('a', { class: 'btn', href: '/gift?me=1' }, '✨ 내 전광판')),
    tabs, h('div', { id: 'panel', role: 'tabpanel', 'aria-labelledby': 'tab-' + tab }, body, samples),
    h('p', { class: 'foot' }, '뉴욕 타임스퀘어를 본뜬 가상 광장이에요. 실제 타임스퀘어와는 관계가 없어요. 많이 반응한 순서로 보여 줄 뿐, 순위를 매기지 않아요.', h('br'), h('a', { href: '/' }, '3D 광장 둘러보기')));
}
let LAST = 0, LOADING = false;
async function load() {
  if (LOADING) return; LOADING = true; LAST = Date.now();
  // No token on either read: both are the isolate's cached copies (an anonymous /rt/wishes is the 10-second copy, /rt/world the plaza's).
  const body = (r) => (r.ok ? r.json() : null);
  const [world, wishes] = await Promise.all([fetch('/rt/world').then(body).catch(() => null), fetch('/rt/wishes').then(body).catch(() => null)]);
  DOWN = !world && !wishes;
  ITEMS = discoverItems({ world, wishes, now: Date.now() });
  LOADING = false;
  // A refill keeps the reader where they are: only the list changes, never while a share sheet or a heart is out (paint is synchronous).
  const y = window.scrollY; paint(); try { window.scrollTo(0, y); } catch { /* stays */ }
}
// An open page reads the world again every DISCOVER.refreshMs while it is on screen (a board whose owner turned DISCOVER off leaves within
// minutes), and when the tab comes back after that long. The reads are the cached ones above.
setInterval(() => { if (refreshDue(LAST, Date.now(), document.hidden)) load(); }, 15000);
document.addEventListener('visibilitychange', () => { if (refreshDue(LAST, Date.now(), document.hidden)) load(); });
paint();
load();
