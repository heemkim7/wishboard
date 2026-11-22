// 선물 전광판 light pages (gift.html): the maker at /gift and the board page at /g/<id> (owner preview with the price ladder, the
// recipient page, the 롤링페이퍼). No three.js, no realtime room, no Supabase client: what the page needs from the Worker comes inline in
// #gift-data (the Worker renders /g/<id>), the rest is a few small JSON calls. Text people wrote is only set with textContent.
import { GIFT, GIFT_ID, OCCASIONS, OCC_KEYS, GIFT_THEMES, THEME_KEYS, TIERS, TIER_NOTE, TIER_ASK, won, giftFault, paperFault, startChoices, windowText, dayText, hourText, kstDay, addDays, dayStart, countdown, dDay, refOf, keptRef, cpLen, norm, windowFor } from './giftrules.js';
import { paintGift, giftCardJpeg } from './giftart.js?v=202611231200';
import { createFilm, FILM_MS, recordCanvas, canRecord, saveBlob, fileName } from './giftfilm.js?v=202611231200';

const $app = document.getElementById('app');
// Opened over the plaza (gift.js, ?in=1 in a frame): links into the plaza tell the plaza instead of loading a second one in the frame.
const EMBED = (() => { try { return window.parent !== window && new URLSearchParams(location.search).get('in') === '1'; } catch { return false; } })();
const tellPlaza = (act, id) => { try { window.parent.postMessage({ t: 'gift', act, id }, location.origin); } catch { /* not framed */ } };
const toPlaza = (e, act, id) => { if (!EMBED) return; e.preventDefault(); tellPlaza(act, id); };
try { history.scrollRestoration = 'manual'; } catch { /* old browsers */ } // the film is at the top: a reload starts there
const DATA = (() => { try { return JSON.parse(document.getElementById('gift-data')?.textContent || 'null'); } catch { return null; } })();
const SKEW = DATA?.now ? DATA.now - Date.now() : 0;
const now = () => Date.now() + SKEW;
const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
const json = (k, d) => { try { return JSON.parse(ls.get(k) || '') ?? d; } catch { return d; } };

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
const put = (...nodes) => $app.append(...nodes.filter(Boolean)); // h() skips null children; append() would print them
const card = (...kids) => h('section', { class: 'card' }, ...kids);
const top = () => h('div', { class: 'top' }, h('a', { class: 'brand', href: '/', onclick: (e) => toPlaza(e, 'close', '') }, 'WISH BOARD', h('small', { text: '모두의 전광판' })), h('span', { class: 'tag', text: '🎁 선물 전광판' }));
const foot = () => h('p', { class: 'foot' }, '뉴욕 타임스퀘어를 본뜬 가상 광장이에요. 실제 타임스퀘어와는 관계가 없어요.', h('br'),
  '약관과 개인정보처리방침은 광장의 설정 › 정보에 있어요. ', h('a', { href: '/', text: '광장 가기', onclick: (e) => toPlaza(e, 'close', '') }));
const screenName = (s) => { const m = /^(STREET|PLOT)_(\d+)$/.exec(String(s || '')); return m ? (m[1] === 'STREET' ? '메인거리 ' : '건물 앞 ') + m[2] + '번 화면' : '광장 화면'; };
const say = (el, text, ok = false) => { el.textContent = text || ''; el.className = ok ? 'okmsg' : 'err'; };

// ---- identity -----------------------------------------------------------------------------------------------------------
// The plaza's own: a signed-in Supabase session if this browser has a live one, else the Worker's guest token (masil_gt, the same key the
// plaza uses, so one person is one guest on both). A new guest is minted only when the person writes something.
const AUTH_KEYS = ['maeul_auth', 'sb-yxddhpacuyaffaoutxjn-auth-token'];
function sessionToken() {
  for (const k of AUTH_KEYS) { const j = json(k, null), s = j?.currentSession || j; if (s?.access_token && Number(s.expires_at) * 1000 > Date.now() + 60000) return String(s.access_token); }
  return '';
}
async function human(site, action) {
  if (!site) return '';
  try { const m = await import('./human.js?v=202611231200'); return await m.humanToken(site, { action }); } catch { return ''; }
}
let MINT = null;
async function token(mint = false) {
  const s = sessionToken(); if (s) return s;
  const g = json('masil_gt', null);
  if (g?.token && Number(g.exp) * 1000 > Date.now() + 864e5) return String(g.token);
  if (!g?.token && !mint) return '';
  if (!MINT) MINT = (async () => {
    const post = async (body) => { const r = await fetch('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { r, d: await r.json().catch(() => null) }; };
    let { r, d } = await post(g?.token ? { t: g.token } : {});
    if (r.status === 403 && d?.err === 'human') { const ts = await human(String(d.site || ''), 'guest'); if (!ts) return ''; ({ r, d } = await post({ ts })); }
    if (!r.ok || !d?.token) return g?.token && Number(g.exp) * 1000 > Date.now() ? String(g.token) : '';
    ls.set('masil_gt', JSON.stringify(d)); return String(d.token);
  })().catch(() => '').finally(() => { MINT = null; });
  return MINT;
}
// A POST with the token; a Turnstile check of `action` and one retry when the Worker asks for it (only while it is switched on).
async function post(path, body, { mint = false, action = '' } = {}) {
  let tok = await token(mint);
  if (!tok) return { ok: false, code: 'auth', error: '잠시 뒤에 다시 해 주세요. (손님 입장을 만들지 못했어요)' };
  const send = async (ts) => {
    try { const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(ts ? { ...body, ts } : body) }); return { status: r.status, d: await r.json().catch(() => ({})) }; }
    catch { return { status: 0, d: { ok: false, code: 'down', error: '연결이 끊겼어요. 다시 해 주세요.' } }; }
  };
  let { status, d } = await send('');
  // A stored guest token this Worker does not take (made under another key, or withdrawn): a new guest, once.
  if (status === 401 && mint && tok.startsWith('g1.')) { ls.set('masil_gt', ''); tok = await token(true); if (!tok) return { ok: false, code: 'auth', error: '잠시 뒤에 다시 해 주세요.' }; ({ status, d } = await send('')); }
  if (status === 403 && d?.code === 'human' && action) {
    const ts = await human(String(d.site || ''), action);
    if (!ts) return { ok: false, code: 'human', error: '사람인지 확인하지 못했어요. 잠시 뒤에 다시 해 주세요.' };
    ({ status, d } = await send(ts));
  }
  return { status, ...(d || {}) };
}
const visitor = () => { let v = ls.get('kts_gv'); if (!/^[0-9a-f]{16}$/.test(v || '')) { const b = new Uint8Array(8); crypto.getRandomValues(b); v = [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); ls.set('kts_gv', v); } return v; };
// One beacon per board, event and KST day on this device (sendBeacon: it survives leaving the page).
function beacon(id, e) {
  const seen = json('kts_gseen', {}), key = id + ':' + e, day = kstDay(now());
  if (seen[key] === day) return;
  const keys = Object.keys(seen); if (keys.length > 200) for (const k of keys.slice(0, 100)) delete seen[k];
  seen[key] = day; ls.set('kts_gseen', JSON.stringify(seen));
  const body = JSON.stringify({ v: visitor(), e });
  try { if (navigator.sendBeacon?.('/rt/gift/' + id + '/seen', new Blob([body], { type: 'text/plain' }))) return; } catch { /* fetch below */ }
  fetch('/rt/gift/' + id + '/seen', { method: 'POST', body, keepalive: true }).catch(() => { });
}
const mine = () => (json('kts_gmine', []) || []).filter((x) => GIFT_ID.test(String(x)));
const addMine = (id) => ls.set('kts_gmine', JSON.stringify([id, ...mine().filter((x) => x !== id)].slice(0, 30)));
const dropMine = (id) => ls.set('kts_gmine', JSON.stringify(mine().filter((x) => x !== id)));

// ---- shared pieces ----------------------------------------------------------------------------------------------------------
const TICK = new Set();
setInterval(() => { for (const f of TICK) { try { f(); } catch { /* one bad line */ } } }, 1000);
function live(el, fn) { const run = () => { if (!el.isConnected) { TICK.delete(run); return; } el.textContent = fn(); }; run(); TICK.add(run); return el; }
function clear() { TICK.clear(); STAGES.forEach((s) => s.stop()); STAGES.clear(); $app.replaceChildren(); window.scrollTo(0, 0); }
const STAGES = new Set();

// The 9:16 stage: the stored video when there is one this browser can play, else the drawn film. opts: { watermark, auto, label }.
function stage(g, opts = {}) {
  const box = h('div', { class: 'stage', role: 'img', 'aria-label': `${g.to}님을 위한 축하 영상` });
  const cv = h('canvas', { width: 720, height: 1280 });
  const film = createFilm(cv, g, { watermark: opts.watermark !== false });
  const api = { box, film, canvas: cv, video: null, ended: false, ends: new Set(), stop: () => { film.stop(); api.video?.pause?.(); } };
  STAGES.add(api);
  const bk = (e) => { if (!opts.quiet) beacon(g.id, e); }; // the owner's own preview is not counted
  const end = () => { if (api.ended) return; api.ended = true; bk('done'); for (const f of api.ends) f(); };
  film.onEnd(end);
  box.addEventListener('click', (e) => { if (api.ended && e.target !== play && !play.contains(e.target)) api.replay(); }); // the poster after the end: a tap plays it again
  box.title = '누르면 다시 재생해요';
  const vidOk = g.vid && DATA?.media !== false && (() => { const v = document.createElement('video'), t = g.vid.t === 'webm' ? 'video/webm' : 'video/mp4'; return !!v.canPlayType?.(t); })();
  const play = h('button', { class: 'play', type: 'button', hidden: !!opts.auto, onclick: () => { play.hidden = true; api.replay(); } }, h('span', { text: '▶ 15초 축하 영상 보기' }));
  if (vidOk) {
    const v = h('video', { playsinline: true, muted: true, preload: 'auto', src: '/rt/gift/' + g.id + '/video', 'aria-label': '축하 영상' });
    v.muted = true; api.video = v;
    v.addEventListener('ended', end);
    v.addEventListener('playing', () => bk('play'), { once: true });
    v.addEventListener('error', () => { v.remove(); api.video = null; box.prepend(cv); if (opts.auto) { film.play(); bk('film'); } else film.still(); }, { once: true });
    box.append(v, play);
    api.replay = () => { api.ended = false; v.currentTime = 0; v.play().catch(() => { play.hidden = false; }); };
    if (opts.auto) v.play().catch(() => { play.hidden = false; });
  } else {
    box.append(cv, play);
    api.replay = () => { api.ended = false; film.play(); bk('film'); };
    if (opts.auto) api.replay(); else film.still();
  }
  return api;
}
// "영상 저장": the stored file, else the drawn film recorded on this device (it plays while it records).
async function saveVideo(g, st, btn, note) {
  btn.disabled = true;
  try {
    if (st.video) {
      say(note, '영상을 받는 중…', true);
      const r = await fetch('/rt/gift/' + g.id + '/video'); if (!r.ok) throw new Error('get');
      const b = await r.blob(); const how = await saveBlob(b, fileName(g, b));
      beacon(g.id, 'save'); say(note, how === 'cancel' ? '' : '영상을 저장했어요.', true); return;
    }
    if (!canRecord()) { say(note, '이 브라우저에서는 영상을 만들 수 없어요. 화면 녹화로 저장해 주세요.'); return; }
    const tag = h('div', { class: 'rec' }); st.box.append(tag);
    let left = Math.ceil(FILM_MS / 1000); const tick = setInterval(() => { left = Math.max(1, left - 1); tag.textContent = '● 영상 만드는 중 ' + left; }, 1000); tag.textContent = '● 영상 만드는 중 ' + left;
    st.film.play();
    const ctl = new AbortController(), onHide = () => { if (document.hidden) ctl.abort(); }; document.addEventListener('visibilitychange', onHide);
    const blob = await recordCanvas(st.canvas, FILM_MS + 150, { signal: ctl.signal }); document.removeEventListener('visibilitychange', onHide);
    clearInterval(tick); tag.remove();
    if (!blob) { say(note, ctl.signal.aborted ? '다른 화면으로 가면 영상 만들기가 멈춰요. 이 화면을 켜 둔 채로 다시 해 주세요.' : '영상을 만들지 못했어요. 다시 해 주세요.'); return; }
    const how = await saveBlob(blob, fileName(g, blob));
    beacon(g.id, 'save'); say(note, how === 'cancel' ? '' : '영상을 저장했어요. 스토리에 바로 올릴 수 있는 세로 영상이에요.', true);
  } catch { say(note, '영상을 저장하지 못했어요. 다시 해 주세요.'); }
  finally { btn.disabled = false; }
}
async function share(g, url, note) {
  const o = OCCASIONS[g.occ] || OCCASIONS.bday, text = `${o.emoji} ${g.to}님을 위한 선물 전광판이 뉴욕 타임스퀘어 가상 광장에 걸려요! 친구들 메시지도 남겨 주세요 👉`;
  try { if (navigator.share) { await navigator.share({ title: `${g.to}님을 위한 선물 전광판`, text, url }); beacon(g.id, 'share'); return; } } catch (e) { if (e?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text + ' ' + url); beacon(g.id, 'share'); say(note, '링크를 복사했어요. 카카오톡에 붙여 넣어 보내세요.', true); } catch { say(note, '아래 주소를 길게 눌러 복사해 주세요.'); }
}
function twoTap(btn, label, run) {
  let armed = 0;
  btn.addEventListener('click', () => {
    if (Date.now() - armed > 4000) { armed = Date.now(); const was = btn.textContent; btn.textContent = label; setTimeout(() => { if (btn.isConnected && btn.textContent === label) btn.textContent = was; }, 4000); return; }
    armed = 0; run();
  });
  return btn;
}

// ---- the maker (/gift) ------------------------------------------------------------------------------------------------------
function maker(prefill = {}) {
  clear();
  const q = new URLSearchParams(location.search), ref = refOf(q.get('ref'));
  if (ref) { ls.set('kts_gref', JSON.stringify({ id: ref, at: Date.now() })); history.replaceState(null, '', '/gift'); }
  const today = kstDay(now());
  const f = { to: '', from: '', occ: 'bday', msg: '', th: '', day: today, at: 'now', ...prefill };
  const cv = h('canvas', { class: 'preview', width: 1024, height: 576, 'aria-label': '광장 화면 미리보기' });
  let raf = 0; const repaint = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => paintGift(cv, { id: 'preview', ...f, th: f.th || OCCASIONS[f.occ].th })); };
  const errs = {}; const err = (k) => (errs[k] = h('p', { class: 'err' }));
  const count = (el, max) => { const c = h('small'); const up = () => { c.textContent = cpLen(norm(el.value)) + '/' + max; }; el.addEventListener('input', up); up(); return c; };
  const toIn = h('input', { type: 'text', id: 'to', maxlength: 24, autocomplete: 'off', placeholder: '예: 민지', value: f.to, oninput: () => { f.to = toIn.value; repaint(); } });
  const msgIn = h('input', { type: 'text', id: 'msg', maxlength: 80, autocomplete: 'off', placeholder: OCCASIONS[f.occ].hint, value: f.msg, oninput: () => { f.msg = msgIn.value; repaint(); } });
  const fromIn = h('input', { type: 'text', id: 'from', maxlength: 24, autocomplete: 'off', placeholder: '예: 동아리 친구들', value: f.from, oninput: () => { f.from = fromIn.value; repaint(); } });
  const occRow = h('div', { class: 'chips', role: 'group', 'aria-label': '무슨 날' });
  const paintOcc = () => { occRow.replaceChildren(...OCC_KEYS.map((k) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(f.occ === k), onclick: () => { f.occ = k; f.th = ''; msgIn.placeholder = OCCASIONS[k].hint; paintOcc(); paintTh(); repaint(); } }, OCCASIONS[k].emoji + ' ' + OCCASIONS[k].name))); };
  const thRow = h('div', { class: 'chips', role: 'group', 'aria-label': '색' });
  const paintTh = () => { const cur = f.th || OCCASIONS[f.occ].th; thRow.replaceChildren(...THEME_KEYS.map((k) => h('button', { type: 'button', class: 'sw', title: GIFT_THEMES[k].name, 'aria-label': GIFT_THEMES[k].name, 'aria-pressed': String(cur === k), style: `background:linear-gradient(135deg,${GIFT_THEMES[k].a},${GIFT_THEMES[k].b})`, onclick: () => { f.th = k; paintTh(); repaint(); } }))); };
  const dayRow = h('div', { class: 'chips', role: 'group', 'aria-label': '날짜' }), atRow = h('div', { class: 'chips', role: 'group', 'aria-label': '시간' }), whenLine = h('p', { class: 'when' });
  const dateIn = h('input', { type: 'date', min: today, max: addDays(today, GIFT.aheadDays), value: f.day, hidden: true, 'aria-label': '날짜 고르기', onchange: () => { if (dateIn.value) { f.day = dateIn.value; f.at = ''; paintDay(); } } });
  const paintDay = () => {
    const days = [[today, '오늘'], [addDays(today, 1), '내일'], [addDays(today, 2), '모레']];
    const other = !days.some(([d]) => d === f.day);
    dayRow.replaceChildren(...days.map(([d, t]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(f.day === d), onclick: () => { f.day = d; f.at = ''; dateIn.hidden = true; paintDay(); } }, t)),
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(other), onclick: () => { dateIn.hidden = false; dateIn.focus(); try { dateIn.showPicker?.(); } catch { /* not allowed */ } } }, other ? dayText(f.day) : '📅 다른 날'));
    const ch = startChoices(f.day, now());
    if (!ch.includes(f.at)) f.at = ch.includes('now') ? 'now' : ch.includes(18) ? 18 : ch[0] ?? '';
    atRow.replaceChildren(...ch.map((a) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(f.at === a), onclick: () => { f.at = a; paintDay(); } }, a === 'now' ? '⚡ 지금 바로' : hourText(a) + '부터')));
    const w = f.at === '' ? null : windowFor(f.day, f.at, now());
    whenLine.textContent = w ? windowText(w.a, w.b) + ' · ' + GIFT.hours + '시간 동안 걸려요' : '그날은 고를 수 있는 시간이 없어요';
  };
  const send = h('button', { class: 'btn gold', type: 'submit' }, '🎁 무료로 걸기');
  const sendErr = h('p', { class: 'err' });
  const nextBtn = h('button', { class: 'btn sm', type: 'button', hidden: true });
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    for (const el of Object.values(errs)) el.textContent = '';
    say(sendErr, ''); nextBtn.hidden = true;
    const v = giftFault(f, now());
    if (!v.ok) { (errs[v.field] || sendErr).textContent = v.error; ({ to: toIn, msg: msgIn, from: fromIn }[v.field])?.focus?.(); return; }
    send.disabled = true; send.textContent = '거는 중…';
    const ref = keptRef(ls.get('kts_gref'), Date.now());
    const r = await post('/rt/gift', { to: f.to, from: f.from, occ: f.occ, msg: f.msg, th: f.th || OCCASIONS[f.occ].th, day: f.day, at: f.at, ...(ref ? { ref } : {}) }, { mint: true, action: 'gift' });
    send.disabled = false; send.textContent = '🎁 무료로 걸기';
    if (!r.ok) {
      if (r.field && errs[r.field]) errs[r.field].textContent = r.error; else say(sendErr, r.error || '걸지 못했어요. 다시 해 주세요.');
      if (r.code === 'full' && r.next) { nextBtn.hidden = false; nextBtn.textContent = '빈 시간으로: ' + dayText(r.next.day) + ' ' + (r.next.at === 'now' ? '지금' : hourText(r.next.at)); nextBtn.onclick = () => { f.day = r.next.day; f.at = r.next.at; paintDay(); nextBtn.hidden = true; }; }
      return;
    }
    addMine(r.id);
    if (ref) ls.set('kts_gref', '');
    history.pushState(null, '', '/g/' + r.id);
    owner(r.gift, { fresh: true, mine: r.mine, media: !!r.media });
    giftCardJpeg(r.gift).then(async (jpg) => { const tok = await token(false); if (jpg && tok) fetch('/rt/gift/' + r.id + '/card', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'image/jpeg' }, body: jpg }).catch(() => { }); });
  } },
  h('div', { class: 'field' }, h('label', { for: 'to' }, '누구에게 걸까요?', count(toIn, GIFT.toMax)), toIn, err('to')),
  h('div', { class: 'field' }, h('div', { class: 'label' }, '무슨 날이에요?'), occRow, err('occ')),
  h('div', { class: 'field' }, h('label', { for: 'msg' }, '한마디', count(msgIn, GIFT.msgMax)), msgIn, err('msg')),
  h('div', { class: 'field' }, h('div', { class: 'label' }, '언제 걸까요?', h('small', { text: '한국 시간' })), dayRow, dateIn, h('div', { style: 'height:8px' }), atRow, whenLine, err('day'), err('at')),
  h('div', { class: 'field' }, h('label', { for: 'from' }, '보내는 사람', h('small', { text: '선택' })), fromIn, err('from')),
  h('div', { class: 'field' }, h('div', { class: 'label' }, '색', h('small', { text: '선택' })), thRow),
  send, sendErr, nextBtn,
  h('p', { class: 'fine', text: '결제는 없어요. 글자만 걸고 사진은 받지 않아요. 받는 사람의 연락처는 적지 않아요. 문구는 광장에서 누구나 볼 수 있고, 신고가 쌓이면 가려져요. 기념 페이지는 그날이 지나고 7일 뒤에 지워져요.' }));
  paintOcc(); paintTh(); paintDay(); repaint();
  const lead = h('div', {}, h('h1', { text: '친구를 위해 뉴욕 타임스퀘어에 전광판을 걸어요' }),
    h('p', { class: 'sub', text: `가상 광장의 화면에 ${GIFT.hours}시간 무료로 걸리고, 15초 축하 영상과 친구들의 롤링페이퍼가 함께 가요. 30초면 끝나요.` }),
    cv, h('p', { class: 'fine', text: '광장 화면에는 이렇게 보여요' }));
  put(top(), h('div', { class: 'cols' }, h('div', { class: 'sticky' }, lead), card(form)), foot());
  setTimeout(() => toIn.focus(), 50);
}

// ---- the board page (/g/<id>) -------------------------------------------------------------------------------------------------
let CUR = null; // the board on screen (after making one on /gift there is no #gift-data)
async function board() {
  const g = CUR || DATA?.gift;
  if (!g) return gone();
  if (mine().includes(g.id)) {
    const tok = await token(false);
    if (tok) {
      try {
        const r = await fetch('/rt/gift/' + g.id, { headers: { authorization: 'Bearer ' + tok }, cache: 'no-store' }).then((x) => x.json());
        if (r?.own) return owner(r.gift, { mine: r.mine, media: !!r.media });
      } catch { /* the public page */ }
    }
  }
  visit(g);
}
function gone() {
  clear();
  put(top(), card(h('h1', { text: DATA?.down ? '지금은 광장이 붐벼요' : '기념 페이지가 끝났거나 가려졌어요' }),
    h('p', { class: 'sub', text: DATA?.down ? '잠시 뒤에 다시 열어 주세요.' : '무료 선물 전광판의 기념 페이지는 그날이 지나고 7일 뒤에 지워져요.' }),
    h('a', { class: 'btn gold', href: '/gift', text: '🎁 나도 누군가에게 걸어 주기' })), foot());
}

// The owner: what is up and when, the free preview, the price ladder (E1), sharing, the real video, the 롤링페이퍼 count.
function owner(g, { fresh = false, mine: extra = null, media = false } = {}) {
  clear(); CUR = g;
  const url = location.origin + '/g/' + g.id, note = h('p', { class: 'okmsg' }), O = OCCASIONS[g.occ] || OCCASIONS.bday;
  const phaseTag = h('span', { class: 'tag' + (g.phase === 'live' ? ' live' : '') });
  live(phaseTag, () => { const t = now(); const d = dDay(g.day, t); return t >= g.b ? '광장에서 내려왔어요' : t >= g.a ? '● 지금 광장에 걸려 있어요' : d >= 1 ? 'D-' + d : '걸리기까지 ' + countdown(g.a - t); });
  const st = stage(g, { auto: true, quiet: true });
  const saveNote = h('p', { class: 'okmsg' }), saveBtn = h('button', { class: 'btn', type: 'button', onclick: () => saveVideo(g, st, saveBtn, saveNote) }, '⬇ 이 미리보기 영상 저장');
  const rec = h('a', { class: 'btn pink', href: '/?gb=' + g.id + '&rec=1', onclick: (e) => toPlaza(e, 'rec', g.id) }, '🎬 광장에서 진짜 15초 영상 만들기');
  const vidCard = card(h('h2', { text: '🎬 15초 축하 영상' }),
    h('p', { class: 'sub', text: '광장을 불러와 밤의 타임스퀘어를 날아 이 전광판 앞에서 폭죽과 캐릭터들의 환호를 세로 영상으로 찍어요. 이 기기에서 만들어요. 휴대폰이 1~2분 바빠질 수 있어요.' }),
    g.phase === 'after' ? h('p', { class: 'fine', text: '광장에서 내려온 전광판은 새 영상을 찍을 수 없어요.' }) : rec,
    h('p', { class: 'fine', text: media ? (g.vid ? '찍은 영상이 받는 사람 페이지에 올라가 있어요. 다시 찍으면 바뀌어요(3번까지).' : '찍은 영상은 받는 사람 페이지에 올라가요. 그날이 지나고 7일 뒤에 지워져요.') : '지금은 영상 저장소가 없어서, 찍은 영상은 이 기기에만 저장돼요. 받는 사람 페이지에서는 그려진 축하 영상이 나와요.' }),
    h('div', { style: 'height:8px' }), saveBtn, saveNote);
  const linkBox = h('div', { class: 'link', text: url });
  const shareCard = card(h('h2', { text: '🔗 링크 보내기' }),
    h('p', { class: 'sub', text: '친구들에게 먼저 보내 롤링페이퍼 메시지를 모으고, 그날 ' + g.to + '님에게 보내세요. ' + (g.lk ? '메시지는 그날(' + dayText(g.day) + ') 0시에 함께 열려요.' : '메시지는 남기는 대로 바로 보여요.') }),
    h('div', { class: 'row' }, h('button', { class: 'btn gold', type: 'button', onclick: () => share(g, url, note) }, '공유하기'), h('button', { class: 'btn', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(url); say(note, '링크를 복사했어요.', true); } catch { say(note, '아래 주소를 길게 눌러 복사해 주세요.'); } } }, '링크 복사')),
    linkBox, note);
  const stats = h('div', { class: 'stats' }, h('div', {}, h('b', { text: String(g.v || 0) }), h('span', { text: '열어 본 사람' })), h('div', {}, h('b', { text: String(g.n || 0) }), h('span', { text: '친구 메시지' })), h('div', {}, h('b', { text: String(extra?.kids || 0) }), h('span', { text: '이어서 걸린 전광판' })));
  const del = twoTap(h('button', { class: 'linkbtn', type: 'button' }, '이 선물 전광판 지우기'), '한 번 더 누르면 지워요(되돌릴 수 없어요)', async () => {
    const r = await post('/rt/gift/' + g.id + '/delete', {});
    if (r.ok) { dropMine(g.id); history.replaceState(null, '', '/gift'); maker(); } else say(note, r.error || '지우지 못했어요.');
  });
  const head = h('div', {}, h('h1', { text: fresh ? '🎉 걸었어요!' : O.emoji + ' ' + g.to + '님을 위한 선물 전광판' }),
    h('p', { class: 'sub' }, windowText(g.a, g.b) + ' · ' + screenName(g.scr) + ' ', phaseTag),
    st.box, h('p', { class: 'fine', text: '미리보기예요. 무료 버전이라 워터마크가 있어요.' }));
  put(top(), h('div', { class: 'cols' }, h('div', { class: 'sticky' }, head),
    h('div', {}, shareCard, ladder(g), vidCard, card(h('h2', { text: '📊 지금까지' }), stats, h('p', { class: 'fine', text: '같은 기기는 한 번으로 세요.' })),
      card(h('button', { class: 'btn', type: 'button', onclick: () => visit(g, { preview: true }) }, '👀 받는 사람에게 보이는 화면'), h('div', { style: 'text-align:center;margin-top:8px' }, del)))), foot());
}

// E1: the planned price ladder. Free is chosen and stays the default; a paid tier only says payment is not open and offers a notice
// (advertising: its own consent box, web push only, no email). Views and picks are anonymous daily totals, once per board on this device.
function ladder(g) {
  const flags = json('kts_gint', {}), mark = (k) => { flags[g.id + ':' + k] = 1; const ks = Object.keys(flags); if (ks.length > 300) for (const x of ks.slice(0, 150)) delete flags[x]; ls.set('kts_gint', JSON.stringify(flags)); };
  const once = (k, body) => { if (flags[g.id + ':' + k]) return; mark(k); post('/rt/gift/' + g.id + '/interest', body).catch(() => { }); };
  once('view', { act: 'view' });
  let pick = 0;
  const ask = h('div', { class: 'ask', hidden: true });
  const list = h('div', { class: 'tiers', role: 'radiogroup', 'aria-label': '상품' });
  const paint = () => list.replaceChildren(...TIERS.map((t) => h('button', { type: 'button', class: 'tier', role: 'radio', 'aria-checked': String(pick === t.t), onclick: () => choose(t.t) },
    t.best ? h('span', { class: 'best', text: '추천' }) : null,
    h('div', { class: 'name' }, h('span', {}, t.name, t.tag && !t.best ? h('span', { class: 'hint', text: ' · ' + t.tag }) : null), h('span', { class: 'price', text: t.t ? won(t.price) : '무료' })),
    h('ul', {}, ...t.items.map((x) => h('li', { text: x }))))));
  function choose(t) {
    pick = t; paint();
    if (!t) { ask.hidden = true; return; }
    once('pick:' + t, { act: 'pick', t });
    const T = TIERS[t], box = h('input', { type: 'checkbox', id: 'adok' }), msg = h('p', { class: 'okmsg' });
    const go = h('button', { class: 'btn pink', type: 'button', disabled: true, onclick: async () => {
      go.disabled = true; say(msg, '');
      const tok = await token(false); const r = tok ? await pushOn(tok) : { ok: false, hint: '잠시 뒤에 다시 해 주세요.' };
      if (!r.ok) { say(msg, r.hint + ' 관심은 이미 셌어요. 고마워요!'); go.disabled = false; return; }
      const s = await post('/rt/gift/' + g.id + '/interest', { act: 'notify', t, consent: true });
      if (s.ok) { mark('notify:' + t); say(msg, '열리면 이 기기로 한 번 알려 드릴게요. 고마워요!', true); go.textContent = '알림 신청됨'; } else { say(msg, s.error || '신청하지 못했어요.'); go.disabled = false; }
    } }, '🔔 열리면 알림 받기');
    box.addEventListener('change', () => { go.disabled = !box.checked; });
    ask.hidden = false;
    ask.replaceChildren(h('b', { text: `${T.name} ${won(T.price)}` }), h('p', { class: 'sub', style: 'margin:4px 0 10px', text: TIER_ASK }),
      h('label', { for: 'adok', style: 'display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--muted);margin-bottom:10px' }, box,
        h('span', { text: '(선택) 광고성 정보 수신에 동의해요: 유료 상품이 열리면 이 기기로 (광고) 알림을 보내 드려요. 밤 9시부터 아침 8시까지는 보내지 않아요. 브라우저 알림을 끄면 언제든 그만 받아요. 이메일은 받지 않아요.' })),
      flags[g.id + ':notify:' + t] ? h('p', { class: 'okmsg', text: '이미 알림을 신청했어요.' }) : go, msg,
      h('button', { class: 'linkbtn', type: 'button', onclick: () => choose(0) }, '무료로 둘게요'));
  }
  paint();
  return card(h('h2', { text: '✨ 더 크게, 더 오래 걸고 싶다면' }),
    h('p', { class: 'sub', text: '지금은 무료 시즌이라 무료 걸기로 걸렸어요. 아래는 준비 중인 상품이에요. 골라 보면 결제 대신 "열리면 알림"을 받을 수 있어요.' }),
    list, ask, h('p', { class: 'fine', text: TIER_NOTE }));
}
// Web push for the "열리면 알림" (the plaza's service worker and the same /rt/push the plaza posts to).
async function pushOn(tok) {
  const ios = /iPhone|iPad/.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (ios && !standalone) return { ok: false, hint: '아이폰은 홈 화면에 추가한 앱에서만 알림을 받을 수 있어요.' };
  if (typeof Notification === 'undefined' || !navigator.serviceWorker || !('PushManager' in window)) return { ok: false, hint: '이 브라우저는 알림을 지원하지 않아요.' };
  if (Notification.permission === 'denied') return { ok: false, hint: '알림이 차단되어 있어요. 주소창의 자물쇠에서 알림을 허용해 주세요.' };
  try {
    if ((await Notification.requestPermission()) !== 'granted') return { ok: false, hint: '알림을 허용해야 받을 수 있어요.' };
    const reg = await navigator.serviceWorker.register('/sw.js?v=10'); await navigator.serviceWorker.ready;
    const key = await fetch('/rt/push/key').then((r) => r.json());
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key.k }));
    const r = await fetch('/rt/push', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ s: sub.toJSON() }) });
    return r.ok ? { ok: true } : { ok: false, hint: '알림 등록을 서버에서 받지 못했어요.' };
  } catch { return { ok: false, hint: '알림을 켜지 못했어요.' }; }
}

// The recipient page (and anyone with the link): before the day a countdown and the 롤링페이퍼; from the day the film first, then
// [영상 저장] [직접 가서 보기] [나도 누군가에게 걸어 주기], the messages, and a line about when and where it hangs.
function visit(g, { preview = false } = {}) {
  clear(); CUR = g;
  if (!preview) beacon(g.id, 'open');
  const O = OCCASIONS[g.occ] || OCCASIONS.bday;
  const phase = () => { const t = now(); return t >= g.b ? 'after' : t >= g.a ? 'live' : t >= dayStart(g.day) ? 'day' : 'before'; };
  const back = preview ? h('button', { class: 'btn sm', type: 'button', onclick: () => board() }, '← 내 관리 화면으로') : null;
  if (phase() === 'before') {
    const cd = live(h('div', { class: 'big count' }), () => { const d = dDay(g.day, now()); return d >= 1 ? 'D-' + d : countdown(dayStart(g.day) - now()); });
    const prev = h('canvas', { class: 'preview', width: 1024, height: 576, 'aria-label': '전광판 미리보기' }); paintGift(prev, { ...g, msg: '그날 공개돼요 🤫', n: g.n });
    put(top(), back, h('div', { class: 'cols' },
      h('div', { class: 'sticky' }, h('h1', { text: O.emoji + ' ' + g.to + '님을 위한 선물 전광판' }), h('p', { class: 'sub', text: '뉴욕 타임스퀘어 가상 광장에 ' + windowText(g.a, g.b) + ' 걸려요.' }),
        card(h('div', { class: 'label' }, '그날까지'), cd, h('p', { class: 'fine', text: dayText(g.day) + '이 되면 축하 영상과 친구들의 메시지가 함께 열려요.' })), prev),
      h('div', {}, paperCard(g), cta(g))), foot());
    return;
  }
  const st = stage(g, { auto: true });
  const saveNote = h('p', { class: 'okmsg' }), saveBtn = h('button', { class: 'btn', type: 'button', onclick: () => saveVideo(g, st, saveBtn, saveNote) }, '⬇ 영상 저장');
  const go = h('a', { class: 'btn gold', href: '/?gb=' + g.id, onclick: (e) => { beacon(g.id, 'go'); toPlaza(e, 'go', g.id); } }, '🗽 직접 가서 보기');
  const where = h('p', { class: 'sub' });
  live(where, () => { const p = phase(), t = now(); return p === 'live' ? `지금 ${screenName(g.scr)}에 걸려 있어요 · ${countdown(g.b - t)} 남음` : p === 'day' ? `${hourText(new Date(g.a + 9 * 36e5).getUTCHours())}에 광장에 걸려요 · ${countdown(g.a - t)} 남음` : windowText(g.a, g.b) + ' 광장에 걸렸어요'; });
  const acts = h('div', { class: 'stack', hidden: !preview && !st.ended }, saveBtn, phase() === 'live' ? go : null, h('a', { class: 'btn', href: '/gift?ref=' + g.id, onclick: () => beacon(g.id, 'cta') }, '🎁 나도 누군가에게 걸어 주기'), saveNote);
  const skip = h('button', { class: 'linkbtn', type: 'button', onclick: () => { acts.hidden = false; skip.remove(); } }, '영상 건너뛰기');
  st.ends.add(() => { acts.hidden = false; skip.remove(); });
  const rp = twoTap(h('button', { class: 'linkbtn', type: 'button' }, '이 전광판 신고'), '한 번 더 누르면 신고해요', async () => { const r = await fetch('/rt/gift/' + g.id + '/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((x) => x.json()).catch(() => null); rp.textContent = r?.ok ? '신고했어요' : '신고하지 못했어요'; rp.disabled = true; });
  put(top(), back, h('div', { class: 'cols' },
    h('div', { class: 'sticky' }, h('h1', { text: O.emoji + ' ' + g.to + '님, ' + O.head + '!' }), where, st.box, acts.hidden ? skip : null, h('div', { style: 'height:10px' }), acts),
    h('div', {}, card(h('h2', { text: '📺 광장에 걸린 글' }), h('p', { class: 'big', style: 'font-size:22px', text: 'To. ' + g.to }), h('p', { style: 'font-weight:800;margin:4px 0', text: g.msg || O.hint }), g.from ? h('p', { class: 'sub', text: 'From. ' + g.from }) : null, rp),
      paperCard(g), cta(g))), foot());
}
function cta(g) {
  return card(h('h2', { text: '🎁 나도 누군가에게' }), h('p', { class: 'sub', text: '친구의 생일, 합격, 기념일에 뉴욕 타임스퀘어 가상 광장의 전광판을 6시간 무료로 걸어 줄 수 있어요.' }),
    h('a', { class: 'btn', href: '/gift?ref=' + g.id, onclick: () => beacon(g.id, 'cta') }, '나도 걸어 주기'));
}
// 롤링페이퍼: the lines (once open) or the lock, and the form while the board takes lines. A new guest is minted only on sending.
function paperCard(g) {
  const list = h('div', { class: 'paper' });
  const paint = () => {
    if (g.open && Array.isArray(g.paper)) {
      list.replaceChildren(...(g.paper.length ? g.paper.map((p) => {
        const rp = twoTap(h('button', { class: 'rp', type: 'button' }, '신고'), '한 번 더', async () => { await fetch('/rt/gift/' + g.id + '/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ m: p.id }) }).catch(() => null); rp.textContent = '신고함'; rp.disabled = true; });
        return h('div', { class: 'note' }, rp, h('b', { text: p.nick }), h('p', { text: p.txt }));
      }) : [h('p', { class: 'sub', text: '아직 메시지가 없어요. 첫 메시지를 남겨 주세요!' })]));
    } else list.replaceChildren(h('div', { class: 'lock' }, h('span', { text: '🔒' }), h('span', {}, '친구 메시지 ', h('b', { text: (g.n || 0) + '개' }), ' · ' + dayText(g.day) + '에 열려요')));
  };
  paint();
  if (!g.takes) return card(h('h2', { text: '💌 롤링페이퍼' }), list, h('p', { class: 'fine', text: '메시지를 받는 시간이 끝났어요.' }));
  const nick = h('input', { type: 'text', maxlength: 20, autocomplete: 'nickname', placeholder: '닉네임 (선택)', 'aria-label': '닉네임' });
  const txt = h('textarea', { maxlength: 120, placeholder: g.to + '님에게 한마디', 'aria-label': '메시지' });
  const cnt = h('small', { text: '0/' + GIFT.paper.txtMax }); txt.addEventListener('input', () => { cnt.textContent = cpLen(norm(txt.value)) + '/' + GIFT.paper.txtMax; });
  const msg = h('p', { class: 'err' }), btn = h('button', { class: 'btn gold', type: 'submit' }, '💌 메시지 남기기');
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); say(msg, '');
    const v = paperFault({ nick: nick.value, txt: txt.value }); if (!v.ok) { say(msg, v.error); return; }
    btn.disabled = true;
    const r = await post('/rt/gift/' + g.id + '/paper', { nick: v.v.nick, txt: v.v.txt }, { mint: true, action: 'gmsg' });
    btn.disabled = false;
    if (!r.ok) { say(msg, r.error || '남기지 못했어요.'); return; }
    g.n = r.n; if (g.open) g.paper = [...(g.paper || []), { id: r.id, nick: v.v.nick, txt: v.v.txt }];
    txt.value = ''; cnt.textContent = '0/' + GIFT.paper.txtMax; paint();
    say(msg, g.open ? '남겼어요!' : '남겼어요! ' + dayText(g.day) + '에 다른 친구들의 메시지와 함께 열려요.', true);
  } }, h('div', { class: 'field' }, nick), h('div', { class: 'field' }, h('div', { class: 'label' }, '메시지', cnt), txt), btn, msg,
  h('p', { class: 'fine', text: '닉네임과 메시지는 링크를 받은 사람 누구나 볼 수 있어요. 계정 번호는 다른 사람에게 보이지 않아요. 한 사람이 3개까지 남길 수 있고, 그날이 지나고 7일 뒤에 지워져요.' }));
  return card(h('h2', { text: '💌 롤링페이퍼' }), list, h('div', { style: 'height:12px' }), form);
}

// ---- start ----------------------------------------------------------------------------------------------------------------------
function route() {
  if (/^\/g\/[0-9a-z]{8}\/?$/.test(location.pathname)) { if (DATA && DATA.id === location.pathname.slice(3, 11)) board(); else location.reload(); }
  else maker();
}
window.addEventListener('load', () => { if (scrollY > 0 && !document.activeElement?.matches?.('input,textarea')) scrollTo(0, 0); }, { once: true }); // a reload's kept scroll: start at the film
window.addEventListener('popstate', () => { if (/^\/g\//.test(location.pathname) && !DATA?.gift) location.reload(); else route(); });
route();
