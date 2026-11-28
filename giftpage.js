// 선물 전광판 light pages (gift.html): the maker at /gift and the board page at /g/<id> (owner preview with the price ladder, the
// recipient page, the 롤링페이퍼). No three.js, no realtime room, no Supabase client: what the page needs from the Worker comes inline in
// #gift-data (the Worker renders /g/<id>), the rest is a few small JSON calls. Text people wrote is only set with textContent.
import { GIFT, GIFT_ID, OCCASIONS, OCC_KEYS, GIFT_THEMES, THEME_KEYS, TIERS, TIER_NOTE, TIER_ASK, won, giftFault, paperFault, startChoices, windowText, dayText, hourText, clockText, plazaLook, kstDay, addDays, countdown, dDay, refOf, keptRef, cpLen, norm, windowFor, replyDraft, replyLabel, PLAZA_BTN, videoFirst, CER_TEXT, cerStart, cerButton, cerInvite, cerShareLine, cerBackWhy, cerDebugStart, pageLook, hiddenWords, visitorShareText, GIFT_PICK, ME_KINDS, isMe, toLine, boardTitle, cut, filmMark, teaserCard } from './giftrules.js';
import { TOWER, TOWER_ERR, towerCard as towerState, towerClock, towerLook, friendsText } from './towerrules.js';
import { paintGift, paintStreet, giftCardJpeg } from './giftart.js?v=202611280944';
import { createFilm, FILM_MS, recordCanvas, canRecord, saveBlob, fileName } from './giftfilm.js?v=202611280944';
import { icon } from './uiicons.js?v=202611280944';
import { SCENES, REAL_DIR, plateUrls, musicUrls, plateFault, realFileName, realReason, inAppBrowser, lowFor, scenesToDrop } from './realrules.js?v=202611280944';

const $app = document.getElementById('app');
// Opened over the plaza (gift.js, ?in=1 in a frame): links into the plaza tell the plaza instead of loading a second one in the frame.
const EMBED = (() => { try { return window.parent !== window && new URLSearchParams(location.search).get('in') === '1'; } catch { return false; } })();
// Over the plaza the frame's own close button (gift.js) sits in the top right corner: gift.html leaves it room (html.embed).
if (EMBED) document.documentElement.classList.add('embed');
const tellPlaza = (act, id) => { try { window.parent.postMessage({ t: 'gift', act, id }, location.origin); } catch { /* not framed */ } };
const toPlaza = (e, act, id) => { if (!EMBED) return; e.preventDefault(); tellPlaza(act, id); };
// Escape with the cursor in this page closes the frame over the plaza, like the plaza's sheets (a key pressed in here never reaches
// the plaza's own listener, gift.js). Not while Hangul is being composed: there Escape only drops the half-typed syllable.
if (EMBED) document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.isComposing && e.keyCode !== 229 && !e.defaultPrevented) tellPlaza('close', ''); });
// A mouse is the pointer here (a desk): the cursor may wait in the first field. On a phone it must not: the keyboard would come up
// over the preview and push the top of the page out of sight before anything was read.
const FINE = (() => { try { return !!matchMedia('(pointer: fine)').matches; } catch { return false; } })();
// iOS shows :active (gift.html's pressed states) only on pages that listen for touches.
try { document.addEventListener('touchstart', () => { }, { passive: true }); } catch { /* no touch here */ }
try { history.scrollRestoration = 'manual'; } catch { /* old browsers */ } // the film is at the top: a reload starts there
const DATA = (() => { try { return JSON.parse(document.getElementById('gift-data')?.textContent || 'null'); } catch { return null; } })();
const SKEW = DATA?.now ? DATA.now - Date.now() : 0;
const now = () => Date.now() + SKEW;
// 점등식 at budget hard: the page data says so (an older Worker has no field: not hard), or a later read of the board did.
let HARD = !!DATA?.hard;
// The localhost seam (giftrules.js cerDebugStart): ?cerin=<seconds> on a local development host runs the ceremony button against a start
// that many seconds from this load, and its link carries the seconds left to the plaza. Anywhere else 0: the board's own start.
const CER_DEBUG = (() => { try { return cerDebugStart(location.search, location.hostname, now()); } catch { return 0; } })();
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
// me: a page of 내 전광판 (the maker at /gift?me=1, a board with occ me). 둘러보기 is /discover (not over the plaza: the plaza has its own lists).
const top = (me = false) => h('div', { class: 'top' }, h('a', { class: 'brand', href: '/', onclick: (e) => toPlaza(e, 'close', '') }, 'WISH BOARD', h('small', { text: '모두의 전광판' })),
  h('span', { class: 'toplinks' }, EMBED ? null : h('a', { class: 'linkbtn toplink', href: '/discover', text: '둘러보기' }), h('span', { class: 'tag' }, icon(me ? 'wish' : 'gift'), me ? '내 전광판' : '선물 전광판')));
// The page's last lines: what a page has to say but nobody needs before acting (more: lines of that page, above the two every page has).
const foot = (...more) => h('footer', { class: 'foot' }, ...more.map((t) => h('p', { text: t })),
  h('p', {}, '뉴욕 타임스퀘어를 본뜬 가상 광장이에요. 실제 타임스퀘어와는 관계가 없어요.', h('br'), '약관과 개인정보처리방침은 광장의 설정 › 정보에 있어요.'),
  h('a', { class: 'linkbtn', href: '/', text: '광장 가기', onclick: (e) => toPlaza(e, 'close', '') }));
// A screen by the plaza's own name for it (balance.js SLOTS: '31번 메인거리', '6번 건물 앞 전광판'), and where it stands (ts3d/bowtie.js:
// STREET_31..50 are the bowtie's core, the plaza people gather in; STREET_1..30 the walls along the main street; PLOT_* the 위시 스트리트 lots).
const screenName = (s) => { const m = /^(STREET|PLOT)_(\d+)$/.exec(String(s || '')); return m ? m[2] + (m[1] === 'STREET' ? '번 메인거리 전광판' : '번 건물 앞 전광판') : '거리 전광판'; };
const screenZone = (s) => { const m = /^(STREET|PLOT)_(\d+)$/.exec(String(s || '')); return !m ? '' : m[1] === 'PLOT' ? '위시 스트리트' : Number(m[2]) > 30 ? '광장 한가운데' : '메인거리 건물 벽'; };
// 어디에 걸리나, before a board is made: what the code does to every free board (giftrules.js GIFT.hours on one of GIFT_SCREENS).
const PLACE_LINE = '가상 타임스퀘어 거리 전광판 68곳 중 한 곳에 ' + GIFT.hours + '시간 · 3D 광장에 온 누구나 봐요'; // after the pin icon
// icons/street.jpg, a capture of the 3D plaza's street at night (giftart.js paintStreet's ground): asked once, when a page first paints a street.
// -> the image once it has loaded, else null (then: done runs when it has).
let STREET = null;
function streetImg(done) {
  if (STREET?.ok) return STREET.img;
  if (typeof Image === 'undefined') return null;
  if (!STREET) { const img = new Image(); STREET = { img, ok: false, waits: new Set() }; img.decoding = 'async'; img.onload = () => { STREET.ok = true; for (const f of STREET.waits) { try { f(); } catch { /* a view that went */ } } STREET.waits.clear(); }; img.src = '/icons/street.jpg?v=1'; }
  if (done) STREET.waits.add(done);
  return null;
}
// A line under a form or a button: read out when it changes (an error at once, a result when the reader is free).
const say = (el, text, ok = false) => { el.textContent = text || ''; el.className = ok ? 'okmsg' : 'err'; el.setAttribute('role', ok ? 'status' : 'alert'); };
const flag = (el, bad) => el?.setAttribute?.('aria-invalid', String(!!bad)); // a field the form refused, until it is typed in again

// ---- identity -----------------------------------------------------------------------------------------------------------
// The plaza's own: a signed-in Supabase session if this browser has a live one, else the Worker's guest token (masil_gt, the same key the
// plaza uses, so one person is one guest on both). A new guest is minted only when the person writes something.
const AUTH_KEYS = ['maeul_auth', 'sb-yxddhpacuyaffaoutxjn-auth-token'];
function sessionToken() {
  for (const k of AUTH_KEYS) { const j = json(k, null), s = j?.currentSession || j; if (s?.access_token && Number(s.expires_at) * 1000 > Date.now() + 60000) return String(s.access_token); }
  return '';
}
// ms: human.js HUMAN_MS overrides (the 💖 check is quiet: HEART_TS).
async function human(site, action, { ms = null } = {}) {
  if (!site) return '';
  try { const m = await import('./human.js?v=202611280944'); return await m.humanToken(site, ms ? { action, ms } : { action }); } catch { return ''; }
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
// A line that follows the clock: painted at once (the element is usually not on the page yet: a check of isConnected here left it blank
// for its first second, seen on a slow phone as an empty D-3), then every second while it is on the page.
// fn gives the words, or [an icon, the words] (the icon is made again each second, like the words).
function live(el, fn) { const set = (v) => { if (Array.isArray(v)) el.replaceChildren(...v); else el.textContent = v; }; const run = () => { if (!el.isConnected) { TICK.delete(run); return; } set(fn()); }; set(fn()); TICK.add(run); return el; }
function clear() { try { document.documentElement.classList.remove('mkpage'); } catch { /* a page without classes */ } TICK.clear(); STAGES.forEach((s) => s.stop()); STAGES.clear(); REAL_RUN?.ctl.abort(); $app.replaceChildren(); window.scrollTo(0, 0); } // a 실사 영상 being made stops with its view
const STAGES = new Set();

// The 9:16 stage: the stored video when there is one this browser can play, else the drawn film. opts: { watermark, auto, quiet,
// small }. small: the owner's page, where the film is a preview and must leave the first screen to what comes next (gift.html .stage.sm).
function stage(g, opts = {}) {
  const box = h('div', { class: opts.small ? 'stage sm' : 'stage', role: 'img', 'aria-label': `${g.to}님을 위한 축하 영상` });
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
  const play = h('button', { class: 'play', type: 'button', hidden: !!opts.auto, onclick: () => { play.hidden = true; api.replay(); } }, h('span', {}, icon('play'), '15초 축하 영상 보기'));
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
// made: the board's making time (only the owner's read has it): a "지금" board made in the first minutes after a start hour is no ceremony.
async function share(g, url, note, made) {
  const o = OCCASIONS[g.occ] || OCCASIONS.bday, text = `${o.emoji} ${boardTitle(g)}이 뉴욕 타임스퀘어 가상 광장에 걸려요! ${isMe(g) ? '응원 메시지 남겨 주세요' : '친구들 메시지도 남겨 주세요'} 👉`
    + cerShareLine(made ? { ...g, at: made } : g, now()); // 점등식: ' 🎆 점등식 12월 25일 18:00에 같이 봐요!' until the start
  return sendLink(g.id, { title: boardTitle(g), text, url }, note, 'share');
}
// 카드 이미지 저장: the link card (giftart.js giftCardJpeg, 1200 x 630) as a file, the share sheet's 'save image' on a phone.
async function saveCard(g, btn, note) {
  btn.disabled = true;
  try {
    const b = await giftCardJpeg(g);
    if (!b) { say(note, '카드 이미지를 만들지 못했어요. 다시 해 주세요.'); return; }
    const how = await saveBlob(b, 'wishboard-' + (cut(g.to, GIFT.toMax).replace(/[\\/:*?"<>|\s]+/g, '') || 'card') + '.jpg');
    if (how !== 'cancel') { beacon(g.id, 'card_save'); say(note, '카드 이미지를 저장했어요.', true); }
  } catch { say(note, '카드 이미지를 저장하지 못했어요.'); } finally { btn.disabled = false; }
}
const cardBtn = (g, note) => { const b = h('button', { class: 'btn', type: 'button', onclick: () => saveCard(g, b, note) }, icon('image'), '카드 이미지 저장'); return b; };
// 계정에 남겨 두기: after a reaction on a board page (a 💖, a message, a reply hung), a guest on this browser (no signed-in session) may sign in on
// the plaza's own sheet (/?login=1 opens it over the boot card; back= brings the signed-in browser to this page, main.js). The press is
// counted (signup_nudge) and kept (kts_gsign); a page that opens signed in within a day of it counts signup_from_gift once (board()).
// Never over the plaza (it has its own account prompts).
let NUDGE = null;
function nudgeLine(g) {
  if (EMBED || sessionToken()) return (NUDGE = null);
  const back = '/g/' + g.id;
  NUDGE = h('p', { class: 'fine nudge', hidden: true }, h('a', { class: 'linkbtn', href: '/?login=1&back=' + encodeURIComponent(back), onclick: () => { beacon(g.id, 'signup_nudge'); ls.set('kts_gsign', JSON.stringify({ id: g.id, at: Date.now() })); } }, '계정에 남겨 두기'),
    ' · 로그인하면 남긴 하트와 메시지, 만든 전광판이 이 기기 밖에서도 남아요.');
  return NUDGE;
}
const showNudge = () => { if (NUDGE) NUDGE.hidden = false; };
const SIGN_MS = 864e5;
function signedBack(g) {
  if (!sessionToken()) return;
  const k = json('kts_gsign', null);
  if (k && k.id === g.id && Date.now() - Number(k.at) < SIGN_MS && Date.now() >= Number(k.at)) { beacon(g.id, 'signup_from_gift'); ls.set('kts_gsign', ''); }
}
// The system share sheet, else the clipboard, else the address shown to copy by hand (box: the copy box, a read-only field shown only then
// when it is hidden, focused and selected so a keyboard can copy it too). ev: the beacon once something was handed over ('share' the
// owner, 'reshare' a visitor). One at a time: a second tap while the sheet is open does nothing (the sheet would refuse it, and the
// clipboard after it would count twice and say it copied).
let SENDING = false;
async function sendLink(id, { title, text, url }, note, ev, box = null) {
  if (SENDING) return; SENDING = true;
  try {
    try { if (navigator.share) { await navigator.share({ title, text, url }); beacon(id, ev); return; } } catch (e) { if (e?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text + ' ' + url); beacon(id, ev); say(note, '링크를 복사했어요. 카카오톡에 붙여 넣어 보내세요.', true); }
    catch { if (box) { box.hidden = false; pickAll(box); } say(note, '아래 주소를 길게 눌러 복사해 주세요.'); }
  } finally { SENDING = false; }
}
const pickAll = (el) => { try { el.focus(); el.select?.(); el.setSelectionRange?.(0, String(el.value || '').length); } catch { /* the field still shows the address */ } };
// 💖 on the recipient page: one per device and board (the Worker keeps it so). kts_ghearts: { id: the count shown after this device's press },
// so the press stays shown while the board's copies catch up. Nothing at all is said about a refusal (budget hard, the minute): the
// button simply goes back, with one calm line.
const hearted = () => { const o = json('kts_ghearts', {}); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; };
// theart (Turnstile on: the page data has its public key): the 💖's check, asked quietly when the button is shown, so the press rarely waits.
// It never asks for a tap (tap 0: a check that wants one ends with no token), and a press waits for it HEART_WAIT_MS at most. Without a token
// the heart still counts as a heart (only not as a friend of the board for the main tower minute, towerrules.js).
const HEART_WAIT_MS = 3000, HEART_TS = { load: 3000, run: 5000, tap: 0 };
let HEART_TOK = null; // { at, p }: one token per page, asked again after 4 minutes (a token lives 5)
const heartToken = () => {
  if (!DATA?.site) return Promise.resolve('');
  if (!HEART_TOK || Date.now() - HEART_TOK.at > 240000) HEART_TOK = { at: Date.now(), p: human(String(DATA.site), 'theart', { ms: HEART_TS }) };
  return HEART_TOK.p;
};
// quiet: before the reveal the count is not shown (giftrules.js heartsOpen), so the button says only whether this device sent one (a 0
// would read as "nobody pressed it").
// sent: called once the heart went (the account nudge, nudgeLine).
function heartBtn(g, note, { off = false, quiet = false, sent = null } = {}) {
  const mark = hearted(), base = Number(g.hearts) || 0;
  let on = !!mark[g.id], n = on ? Math.max(base, Number(mark[g.id]) || 0) : base;
  const btn = h('button', { class: 'btn', type: 'button', disabled: off });
  const paint = () => {
    const said = on ? '하트를 보냈어요' : '하트 보내기';
    btn.replaceChildren(icon('heart'), quiet ? said : '하트 ' + n); btn.setAttribute('aria-pressed', String(on)); btn.setAttribute('aria-label', quiet ? said : said + ', ' + n + '개');
  };
  btn.addEventListener('click', async () => {
    if (on || off) return;
    on = true; n += 1; paint();
    const ts = DATA?.site ? await Promise.race([heartToken(), new Promise((r) => setTimeout(() => r(''), HEART_WAIT_MS))]) : '';
    HEART_TOK = null; // used (or given up on)
    // keepalive: the heart still goes if the page is left right after the press. This device marks it once it is sent. A signed-in account
    // sends its token (공유 보상: an account friend pays the maker more than a guest one); a guest sends none and is never minted for a heart.
    let ok = false, req = null;
    const acc = sessionToken(), hd = acc ? { 'content-type': 'application/json', authorization: 'Bearer ' + acc } : { 'content-type': 'application/json' };
    try { req = fetch('/rt/gift/' + g.id + '/heart', { method: 'POST', keepalive: true, headers: hd, body: JSON.stringify(ts ? { v: visitor(), ts } : { v: visitor() }) }); } catch { req = null; }
    if (req) { const keep = hearted(); keep[g.id] = n; const ks = Object.keys(keep); if (ks.length > 300) for (const k of ks.slice(0, 150)) delete keep[k]; ls.set('kts_ghearts', JSON.stringify(keep)); }
    try { ok = !!(req && (await req).ok); } catch { ok = false; }
    if (ok) { try { sent?.(); } catch { /* the heart went */ } return; }
    on = false; n -= 1; paint();
    const back = hearted(); delete back[g.id]; ls.set('kts_ghearts', JSON.stringify(back));
    say(note, '잠시 뒤에 다시 눌러 주세요.', true);
  });
  paint();
  if (!off && !on && DATA?.site) heartToken(); // asked before the press (quiet; nothing is shown)
  return btn;
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
// prefill: values to start from. prefill.re (a board id): this is a 답장 전광판 for that board (the recipient page's reply button): the
// form comes filled in (giftrules.js replyDraft), says so, and the board is sent with ref: that board and re: 1. Everything can be edited.
// 내 전광판 (PERSONAL, /gift?me=1): the same maker for a board of one's own: occ 'me', the name is the shown name (prefilled with the plaza
// nickname, kts_nick, when this browser has one), four kinds that only seed the line (ME_KINDS), no sender. Everything after making is the
// gift path.
// 2026-11-28 (the owner: "항목이 많아서 어렵다 · 색이 바로 안 보이고 스크롤하며 만들어야 한다"): three short steps on one screen of a phone
// (1 무슨 날 · 2 이름과 한마디 · 3 언제와 색, then 무료로 걸기), the preview of the board on the virtual street held at the top while the
// fields change under it (gift.html .pv), one gold button a step, ← 이전 back, the dots for where one is. Today now and the occasion's colour
// are chosen already, so the shortest way is a day, a name, 다음, 걸기. A tap on a day goes on to the names by itself.
// The form is one <form>: its submit (the last step's button, or the tests) hangs the board whatever step is up; a refused field brings its
// step back. Enter in a field of step 2 goes to the next step instead (a phone's 이동 key must not hang a board unseen).
const STEP_OF = { occ: 1, to: 2, from: 2, msg: 2, day: 3, at: 3 };
function maker({ re: answers = '', ...prefill } = {}) {
  clear();
  const q = new URLSearchParams(location.search), ref = refOf(q.get('ref')), re = refOf(answers);
  const ME = !re && (prefill.occ === 'me' || q.get('me') === '1');
  try { document.title = (answers ? '답장 전광판' : ME ? '내 전광판' : '선물 전광판') + ' · WISH BOARD'; } catch { /* the tab keeps its name */ } // a reply opens here from a board page: not that board's title
  if (ref) { ls.set('kts_gref', JSON.stringify({ id: ref, at: Date.now() })); history.replaceState(null, '', ME ? '/gift?me=1' : '/gift'); }
  started(re || keptRef(ls.get('kts_gref'), Date.now()) ? 1 : 0);
  const today = kstDay(now()), sendLabel = re ? '답장 걸기' : '무료로 걸기';
  const nick = ME ? cut(ls.get('kts_nick') || '', GIFT.toMax) : '';
  const f = { to: nick, from: '', occ: ME ? 'me' : 'bday', msg: '', th: '', day: today, at: 'now', ...prefill };
  let kind = ''; // 내 전광판: the kind chip last pressed (only seeds the line)
  const cv = h('canvas', { class: 'preview', width: 1024, height: 576, 'aria-label': '가상 타임스퀘어 거리 전광판에 걸린 모습 미리보기' });
  let raf = 0; const repaint = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => paintStreet(cv, { id: 'preview', ...f, th: f.th || OCCASIONS[f.occ].th }, streetImg(repaint))); };
  // A refused field: its line is read out (role alert), the field says it is wrong and points at the line, until it is typed in again.
  const errs = {}; const err = (k) => (errs[k] = h('p', { class: 'err', id: 'err-' + k, role: 'alert' }));
  const count = (el, max) => { const c = h('small'); const up = () => { c.textContent = cpLen(norm(el.value)) + '/' + max; }; el.addEventListener('input', up); up(); return c; };
  const typed = (k, el) => { f[k] = el.value; flag(el, false); if (errs[k]) errs[k].textContent = ''; repaint(); };
  const onward = (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); ahead(); } };
  const toIn = h('input', { type: 'text', id: 'to', maxlength: 24, autocomplete: 'off', enterkeyhint: 'next', placeholder: ME ? '예: 하늘' : '예: 민지', 'aria-describedby': 'err-to', value: f.to, oninput: () => typed('to', toIn), onkeydown: onward });
  const msgIn = h('input', { type: 'text', id: 'msg', maxlength: 80, autocomplete: 'off', enterkeyhint: 'next', placeholder: (OCCASIONS[f.occ] || OCCASIONS.bday).hint, 'aria-describedby': 'err-msg', value: f.msg, oninput: () => typed('msg', msgIn), onkeydown: onward });
  const fromIn = h('input', { type: 'text', id: 'from', maxlength: 24, autocomplete: 'off', enterkeyhint: 'next', placeholder: '예: 동아리 친구들', 'aria-describedby': 'err-from', value: f.from, oninput: () => typed('from', fromIn), onkeydown: onward });
  const fields = ME ? { to: toIn, msg: msgIn } : { to: toIn, msg: msgIn, from: fromIn };
  const occRow = h('div', { class: 'chips', role: 'group', 'aria-label': ME ? '무엇을 걸까요' : '무슨 날' });
  // A day (or a kind) chosen on the first step: the preview changes at once and, a moment later, the names come up.
  let auto = 0; const onOn = () => { if (step !== 1) return; clearTimeout(auto); auto = setTimeout(() => { if (step === 1 && occRow.isConnected) go(2); }, 260); };
  // 내 전광판's kinds: a press puts the kind's example in the line when the line is empty or still another kind's example.
  const seeds = new Set(ME_KINDS.map((x) => x.msg));
  const paintKind = () => occRow.replaceChildren(...ME_KINDS.map((x) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(kind === x.k), onclick: () => {
    kind = x.k; msgIn.placeholder = x.msg;
    if (!norm(msgIn.value) || seeds.has(norm(msgIn.value))) { msgIn.value = x.msg; f.msg = x.msg; flag(msgIn, false); if (errs.msg) errs.msg.textContent = ''; msgIn.dispatchEvent?.(new Event('input')); }
    paintKind(); repaint(); onOn();
  } }, x.name)));
  const paintOcc = () => { if (ME) { paintKind(); return; } occRow.replaceChildren(...GIFT_PICK.filter((k) => OCC_KEYS.includes(k)).map((k) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(f.occ === k), onclick: () => { f.occ = k; f.th = ''; msgIn.placeholder = OCCASIONS[k].hint; paintOcc(); paintTh(); repaint(); onOn(); } }, icon(OCCASIONS[k].icon), OCCASIONS[k].name))); };
  const thRow = h('div', { class: 'chips sws', role: 'group', 'aria-label': '색' });
  const paintTh = () => { const cur = f.th || OCCASIONS[f.occ].th; thRow.replaceChildren(...THEME_KEYS.map((k) => h('button', { type: 'button', class: 'sw', title: GIFT_THEMES[k].name, 'aria-label': GIFT_THEMES[k].name, 'aria-pressed': String(cur === k), style: `background:${GIFT_THEMES[k].f}`, onclick: () => { f.th = k; paintTh(); repaint(); } }))); };
  const dayRow = h('div', { class: 'chips', role: 'group', 'aria-label': '날짜' }), atRow = h('div', { class: 'chips', role: 'group', 'aria-label': '시간' }), whenLine = h('p', { class: 'when' });
  const dateIn = h('input', { type: 'date', min: today, max: addDays(today, GIFT.aheadDays), value: f.day, hidden: true, 'aria-label': '날짜 고르기', onchange: () => { if (dateIn.value) { f.day = dateIn.value; f.at = ''; paintDay(); } } });
  const paintDay = () => {
    const days = [[today, '오늘'], [addDays(today, 1), '내일'], [addDays(today, 2), '모레']];
    const other = !days.some(([d]) => d === f.day);
    dayRow.replaceChildren(...days.map(([d, t]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(f.day === d), onclick: () => { f.day = d; f.at = ''; dateIn.hidden = true; paintDay(); } }, t)),
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(other), onclick: () => { dateIn.hidden = false; dateIn.focus(); try { dateIn.showPicker?.(); } catch { /* not allowed */ } } }, other ? dayText(f.day) : [icon('mission'), '다른 날']));
    const ch = startChoices(f.day, now());
    if (!ch.includes(f.at)) f.at = ch.includes('now') ? 'now' : ch.includes(18) ? 18 : ch[0] ?? '';
    atRow.replaceChildren(...ch.map((a) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(f.at === a), onclick: () => { f.at = a; paintDay(); } }, a === 'now' ? [icon('bolt'), '지금 바로'] : hourText(a) + '부터')));
    const w = f.at === '' ? null : windowFor(f.day, f.at, now());
    whenLine.textContent = w ? windowText(w.a, w.b) + ' · ' + GIFT.hours + '시간' : '그날은 고를 수 있는 시간이 없어요';
  };
  // ---- the steps ----
  const LAST = 3;
  let step = 1;
  const label = (text, small = null, forId = '') => h(forId ? 'label' : 'div', forId ? { for: forId, class: 'qlabel' } : { class: 'label' }, text, small);
  const steps = [null,
    h('div', { class: 'step' }, h('h2', { class: 'q', text: ME ? '무엇을 걸까요?' : '무슨 날이에요?' }), ME ? h('p', { class: 'fine hint', text: '고르면 한마디 예시를 채워 드려요. 그냥 다음으로 가도 돼요.' }) : null, occRow, err('occ'),
      EMBED || re ? null : h('a', { class: 'linkbtn more', href: '/discover', text: '다른 사람 전광판 둘러보기 ›' })),
    h('div', { class: 'step', hidden: true },
      re ? h('p', { class: 'fine hint', text: f.to ? '받는 사람과 한마디를 채워 두었어요. 고쳐 써도 되고, 그대로 걸어도 돼요.' : '한마디를 채워 두었어요. 받는 사람 이름만 적으면 돼요.' }) : null,
      h('div', { class: 'field' }, h('label', { for: 'to' }, ME ? h('span', {}, '이름 ', h('small', { text: '(전광판에 보일 이름)' })) : '누구에게 걸까요?', count(toIn, GIFT.toMax)), toIn, err('to')),
      h('div', { class: 'field' }, h('label', { for: 'msg' }, '한마디', count(msgIn, GIFT.msgMax)), msgIn, err('msg')),
      ME ? null : h('div', { class: 'field' }, h('label', { for: 'from' }, '보내는 사람', h('small', { text: '선택' })), fromIn, err('from'))),
    h('div', { class: 'step', hidden: true },
      h('div', { class: 'field' }, label('언제 걸까요?', h('small', { text: '한국 시간' })), dayRow, dateIn, h('div', { style: 'height:6px' }), atRow, whenLine, err('day'), err('at')),
      h('div', { class: 'field' }, label('색', h('small', { text: '선택' })), thRow)),
  ];
  const dots = h('div', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
  const stepNo = h('span', { class: 'stepno' });
  const back = h('button', { class: 'linkbtn back', type: 'button', onclick: () => go(step - 1) }, icon('chevronLeft'), '이전');
  const next = h('button', { class: 'btn gold', type: 'button', onclick: () => ahead() }, '다음');
  const sendFace = () => [icon(re ? 'envelope' : 'board'), sendLabel];
  const send = h('button', { class: 'btn gold', type: 'submit' }, sendFace());
  const sendErr = h('p', { class: 'err', role: 'alert' });
  const nextBtn = h('button', { class: 'btn sm', type: 'button', hidden: true });
  const fine = h('p', { class: 'fine', text: '결제는 없어요. 문구는 광장에서 누구나 볼 수 있어요.' }); // what is needed before pressing; the other rules are in 규칙 (MAKER_RULES)
  const rules = h('details', { class: 'rules' }, h('summary', { text: '규칙' }), h('p', { class: 'fine', text: MAKER_RULES }),
    h('p', { class: 'fine', text: '뉴욕 타임스퀘어를 본뜬 가상 광장이에요. 실제 타임스퀘어와는 관계가 없어요. 약관과 개인정보처리방침은 광장의 설정 › 정보에 있어요.' }));
  // Which step is up. focus: the step's first field takes the cursor (a step the person moved to; never on load on a phone).
  function go(n, focus = true) {
    step = Math.max(1, Math.min(LAST, n));
    for (let i = 1; i <= LAST; i++) steps[i].hidden = i !== step;
    [...(dots.children || dots.kids || [])].forEach((d, i) => { d.className = i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''; });
    stepNo.textContent = step + ' / ' + LAST;
    back.hidden = step === 1; next.hidden = step === LAST; send.hidden = step !== LAST; fine.hidden = step !== LAST; rules.hidden = step !== LAST;
    if (step !== LAST) { say(sendErr, ''); nextBtn.hidden = true; }
    if (focus && step === 2 && FINE) setTimeout(() => { try { toIn.focus({ preventScroll: true }); } catch { toIn.focus(); } }, 50);
  }
  // 다음: the fields of this step are checked first (the whole form's rules, giftrules.js giftFault, its first refused field on this step or before).
  function ahead() {
    const v = giftFault(f, now());
    if (!v.ok && (STEP_OF[v.field] || LAST) <= step) { refuse(v); return; }
    go(step + 1);
  }
  function refuse(v) {
    go(STEP_OF[v.field] || step, false);
    (errs[v.field] || sendErr).textContent = v.error; flag(fields[v.field], true); fields[v.field]?.focus?.();
  }
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    for (const el of Object.values(errs)) el.textContent = '';
    for (const el of Object.values(fields)) flag(el, false);
    say(sendErr, ''); nextBtn.hidden = true;
    const v = giftFault(f, now());
    if (!v.ok) { refuse(v); return; }
    send.disabled = true; send.textContent = '거는 중…';
    const kept = keptRef(ls.get('kts_gref'), Date.now()), ref = re || kept; // a reply names the board it answers, whatever ref was kept
    const r = await post('/rt/gift', { to: f.to, from: ME ? '' : f.from, occ: f.occ, msg: f.msg, th: f.th || OCCASIONS[f.occ].th, day: f.day, at: f.at, ...(ref ? { ref } : {}), ...(re ? { re: 1 } : {}) }, { mint: true, action: 'gift' });
    send.disabled = false; send.replaceChildren(...sendFace());
    if (!r.ok) {
      if (r.field && errs[r.field]) { go(STEP_OF[r.field] || step, false); errs[r.field].textContent = r.error; flag(fields[r.field], true); } else { go(LAST, false); say(sendErr, r.error || '걸지 못했어요. 다시 해 주세요.'); }
      if (r.code === 'full' && r.next) { nextBtn.hidden = false; nextBtn.textContent = '빈 시간으로: ' + dayText(r.next.day) + ' ' + (r.next.at === 'now' ? '지금' : hourText(r.next.at)); nextBtn.onclick = () => { f.day = r.next.day; f.at = r.next.at; paintDay(); nextBtn.hidden = true; }; }
      return;
    }
    addMine(r.id);
    if (kept && kept === ref) ls.set('kts_gref', '');
    if (re) history.replaceState(null, '', '/gift'); // the reply is hung: going back to this maker starts an ordinary board
    history.pushState(null, '', '/g/' + r.id);
    owner(r.gift, { fresh: true, mine: r.mine, media: !!r.media, signNudge: !!re }); // a reply hung by a guest: 계정에 남겨 두기 on its page
    giftCardJpeg(r.gift).then(async (jpg) => { const tok = await token(false); if (jpg && tok) fetch('/rt/gift/' + r.id + '/card', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'image/jpeg' }, body: jpg }).catch(() => { }); });
    // The teaser card (the name and when, never the line): what a link preview shows until the reveal (giftsrv.js cardGet).
    giftCardJpeg(teaserCard(r.gift, now())).then(async (jpg) => { const tok = await token(false); if (jpg && tok) fetch('/rt/gift/' + r.id + '/card?t=1', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'image/jpeg' }, body: jpg }).catch(() => { }); });
  } },
  h('div', { class: 'stephead' }, dots, stepNo), steps[1], steps[2], steps[3],
  h('div', { class: 'nav' }, back, next, send), sendErr, nextBtn, h('div', { class: 'mkfoot' }, fine, rules));
  paintOcc(); paintTh(); paintDay(); repaint();
  // 어디에 걸리나 (the owner, 2026-11-28: "무료로 걸면 어디 걸리는 건지 와닿지 않는다"): the preview is the board on the virtual street, and
  // the line under it says where and how long, in the code's numbers (giftrules.js GIFT.hours, GIFT_SCREENS: the street and lot screens).
  const lead = h('div', { class: 'pvcol' }, h('h1', { class: 'mkh', text: re ? '답장 전광판을 걸어요' : ME ? '내 이름을 타임스퀘어 전광판에 걸어요' : '친구 이름을 타임스퀘어 전광판에 걸어요' }),
    h('div', { class: 'pv' }, cv, h('p', { class: 'place' }, icon('pin'), PLACE_LINE)));
  put(makerTop(ME, !!re), h('div', { class: 'cols mk' }, lead, h('section', { class: 'card mkcard' }, form)));
  document.documentElement.classList?.add?.('mkpage');
  go(re ? 2 : 1, false);
  // The cursor in the name, where a mouse is the pointer (FINE), once its step is up (a reply opens on it). Never on a phone: the keyboard
  // would come up over the preview before anything was read.
  if (FINE && re && !f.to) setTimeout(() => { try { toIn.focus({ preventScroll: true }); } catch { toIn.focus(); } }, 50);
}
// The maker's top: the brand, and the two makers side by side (선물하기 | 내 전광판) as the switch between them; a reply has neither switch.
const makerTop = (me, re) => h('div', { class: 'top' }, h('a', { class: 'brand', href: '/', onclick: (e) => toPlaza(e, 'close', '') }, 'WISH BOARD'),
  re ? h('span', { class: 'tag' }, icon('envelope'), '답장 전광판') : h('nav', { class: 'seg', 'aria-label': '무엇을 만들까요' },
    h('a', { class: 'chip seg1', href: '/gift', 'aria-current': me ? null : 'page' }, '선물하기'),
    h('a', { class: 'chip seg1', href: '/gift?me=1', 'aria-current': me ? 'page' : null }, '내 전광판')));

// The maker form was shown: one count per page load (a form built again, after a delete or back and forward, is not counted again).
// r: 1 when it came from another board (a kept ref or a reply), as made_ref is to made. No device id: a daily total only.
let STARTED = false;
function started(r) {
  if (STARTED) return; STARTED = true;
  const body = JSON.stringify({ r });
  try { if (navigator.sendBeacon?.('/rt/gift/start', new Blob([body], { type: 'text/plain' }))) return; } catch { /* fetch below */ }
  fetch('/rt/gift/start', { method: 'POST', body, keepalive: true }).catch(() => { });
}
// What a board may carry and how long its page lives. It used to stand under the button with the two lines that are there now.
const MAKER_RULES = '글자만 걸고 사진은 받지 않아요. 받는 사람의 연락처는 적지 않아요. 신고가 쌓이면 문구가 가려지고, 기념 페이지는 그날이 지나고 7일 뒤에 지워져요.';

// ---- the board page (/g/<id>) -------------------------------------------------------------------------------------------------
let CUR = null; // the board on screen (after making one on /gift there is no #gift-data)
async function board() {
  // The board of this address: the one on screen, or the one the Worker put in the page. They differ after a reply was made here
  // (the page of the answered board, then the maker, then the reply's own page) and the visitor goes back.
  const at = location.pathname.slice(3, 11), g = [CUR, DATA?.gift].find((x) => x && x.id === at) || CUR || DATA?.gift;
  if (!g) return gone();
  signedBack(g); // a sign-in from this page's 계정에 남겨 두기 came back
  // The owner's view: on the device that made the board (kts_gmine), or when the address asks for it (?o=1, the reply notice's link: the
  // notice can arrive on another device of the same account). The Worker decides who the owner is; anyone else gets the public page.
  const asked = (() => { try { return new URLSearchParams(location.search).get('o') === '1'; } catch { return false; } })();
  if (mine().includes(g.id) || asked) {
    const tok = await token(false);
    if (tok) {
      try {
        const r = await fetch('/rt/gift/' + g.id, { headers: { authorization: 'Bearer ' + tok }, cache: 'no-store' }).then((x) => x.json());
        if (r?.hard) HARD = true;
        if (r?.own) { if (asked) addMine(g.id); return owner(r.gift, { mine: r.mine, media: !!r.media }); }
      } catch { /* the public page */ }
    }
  }
  visit(g);
}
function gone() {
  clear();
  put(top(), card(h('h1', { text: DATA?.down ? '지금은 광장이 붐벼요' : '기념 페이지가 끝났거나 가려졌어요' }),
    h('p', { class: 'sub', text: DATA?.down ? '잠시 뒤에 다시 열어 주세요.' : '무료 선물 전광판의 기념 페이지는 그날이 지나고 7일 뒤에 지워져요.' }),
    h('a', { class: 'btn gold', href: '/gift' }, icon('gift'), '나도 누군가에게 걸어 주기')), foot());
}

// The owner (2026-11-28, the owner: "항목이 많아서 어렵다", "영상이 많아 헷갈린다", "유료 옵션은 숨겨 줘"): first where the board hangs (the
// screen by its plaza name, the window, the board drawn on the street) with 3D 광장에서 보기 under it, then the three things people do:
// 링크 보내기, 축하 영상 만들기 (one entry: the 실사 video, or the drawn 15 s film where this browser cannot make it), and the rest under one
// 더 보기 (메인 타워, 둘러보기 switch, card image, the numbers, the recipient's view, delete). Nothing about paid tiers unless checkout is open
// (paidCard: /rt/config carries pay).
function owner(g, { fresh = false, mine: extra = null, media = false, signNudge = false } = {}) {
  clear(); CUR = g;
  const ME = isMe(g), nudged = signNudge ? nudgeLine(g) : (NUDGE = null);
  if (nudged) nudged.hidden = false;
  const url = location.origin + '/g/' + g.id, note = h('p', { class: 'okmsg', role: 'status' }), O = OCCASIONS[g.occ] || OCCASIONS.bday;
  // Video first (giftrules.js videoFirst): only when the Worker stores videos (the R2 store), this board has none and is not over. Then the
  // first share or copy of this board asks once (kts_gnudge) whether to record the plaza video for the recipient page first. It never blocks:
  // "그냥 보내기" does what was asked. Without a video store (the live site today) nothing of this shows.
  const vfirst = videoFirst({ media, vid: g.vid, phase: g.phase }) && canRecord();
  const recLink = (cls, label) => h('a', { class: cls, href: '/?gb=' + g.id + '&rec=1', onclick: (e) => toPlaza(e, 'rec', g.id) }, label);
  const nudge = h('div', { class: 'ask', hidden: true });
  const sendOr = (run) => {
    if (!vfirst) return run();
    const kept = json('kts_gnudge', null), asked = kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : {};
    if (asked[g.id]) return run();
    const ks = Object.keys(asked); if (ks.length > 100) for (const k of ks.slice(0, 50)) delete asked[k];
    asked[g.id] = 1; ls.set('kts_gnudge', JSON.stringify(asked));
    nudge.replaceChildren(h('p', { style: 'margin:0 0 10px;font-weight:800', text: '광장 영상을 먼저 찍으면 받는 사람이 그 영상을 봐요' }),
      h('div', { class: 'stack' }, recLink('btn gold', [icon('camera'), '광장 영상 먼저 찍기']), h('button', { class: 'btn', type: 'button', onclick: () => { nudge.hidden = true; run(); } }, '그냥 보내기')));
    nudge.hidden = false;
  };
  const linkBox = h('div', { class: 'link', text: url });
  const shareCard = card(h('h2', {}, icon('link'), '링크 보내기'),
    h('div', { class: 'row' }, h('button', { class: 'btn gold', type: 'button', onclick: () => sendOr(() => share(g, url, note, extra?.at)) }, icon('share'), '공유하기'),
      h('button', { class: 'btn', type: 'button', onclick: () => sendOr(async () => { try { await navigator.clipboard.writeText(url); say(note, '링크를 복사했어요.', true); } catch { say(note, '아래 주소를 길게 눌러 복사해 주세요.'); } }) }, '링크 복사')),
    vfirst ? nudge : null, linkBox, note,
    h('p', { class: 'fine', text: (ME ? '친구들에게 보내 응원 메시지를 모아 보세요. ' : '친구들에게 먼저 보내 메시지를 모으고, 그날 ' + g.to + '님에게 보내세요. ') + (g.lk ? '메시지는 그날(' + dayText(g.day) + ') 0시에 함께 열려요.' : '메시지는 남기는 대로 바로 보여요.') }));
  const stats = h('div', { class: 'stats' }, h('div', {}, h('b', { text: String(g.v || 0) }), h('span', { text: '열어 본 사람' })), h('div', {}, h('b', { text: String(g.n || 0) }), h('span', { text: ME ? '응원 메시지' : '친구 메시지' })), h('div', {}, h('b', { text: String(g.hearts || 0) }), h('span', { text: '하트' })), h('div', {}, h('b', { text: String(extra?.kids || 0) }), h('span', { text: '이어서 걸린 전광판' })));
  const del = twoTap(h('button', { class: 'linkbtn', type: 'button' }, '이 선물 전광판 지우기'), '한 번 더 누르면 지워요(되돌릴 수 없어요)', async () => {
    const r = await post('/rt/gift/' + g.id + '/delete', {});
    if (r.ok) { dropMine(g.id); history.replaceState(null, '', '/gift'); maker(); } else say(note, r.error || '지우지 못했어요.');
  });
  const head = h('div', {}, h('h1', {}, icon(fresh ? 'checkCircle' : O.icon), fresh ? '걸었어요' : boardTitle(g)), nudged, ...whereBlock(g, { owner: true }));
  // 답장 전광판: the first board hung in answer to this one (only the owner's read carries it, while that board can be opened).
  const replyCard = extra?.re && GIFT_ID.test(String(extra.re)) ? card(h('h2', {}, icon('envelope'), '답장이 도착했어요'),
    h('p', { class: 'sub', text: '이 전광판의 링크를 연 사람이 답장 전광판을 걸었어요.' }),
    h('a', { class: 'btn pink', href: '/g/' + extra.re + (EMBED ? '?in=1' : '') }, '답장 보기')) : null;
  const moreNote = h('p', { class: 'okmsg', role: 'status' });
  const more = h('details', { class: 'more' }, h('summary', { class: 'btn' }, '더 보기'),
    towerCard(g),
    card(h('h2', {}, icon('eye'), '둘러보기와 카드'), discoverBtn(g, extra?.dc, moreNote, ME), h('div', { style: 'height:8px' }), cardBtn(g, moreNote), moreNote),
    card(h('h2', {}, icon('chart'), '지금까지'), stats, friendsLine(extra?.friends), h('p', { class: 'fine', text: '같은 기기는 한 번으로 세요.' })),
    media && g.phase !== 'after' && canRecord() ? card(h('h2', {}, icon('camera'), '받는 사람 페이지에 광장 영상 올리기'), recLink('btn', [icon('camera'), '광장에서 영상 찍기 · 약 25초']),
      h('p', { class: 'fine', text: g.vid ? '찍은 영상이 받는 사람 페이지에 올라가 있어요. 다시 찍으면 바뀌어요(3번까지).' : '광장에서 이 전광판 앞의 폭죽과 환호를 찍어 받는 사람 페이지에 올려요. 그날이 지나고 7일 뒤에 지워져요.' })) : null,
    card(h('button', { class: 'btn', type: 'button', onclick: () => visit(g, { preview: true }) }, icon('eye'), '받는 사람에게 보이는 화면'), h('div', { style: 'text-align:center;margin-top:8px' }, del)));
  put(top(ME), h('div', { class: 'cols' }, h('div', { class: 'sticky' }, head),
    h('div', {}, replyCard, shareCard, videoCard(g), paidCard(g, extra?.ladder), more)), foot());
}
// 어디에 걸리나, on a board's own pages: the screen by its plaza name and where it stands, the window, the board drawn on the street, and the
// way into the 3D plaza (gift.js land: 'live' takes the camera to it for everyone's same screen; on its day before the window and after it
// the plaza shows it on this device only; before the reveal there is nothing to show yet, so no button, only when).
// The plaza keeps a board on this screen while nobody has lit it (ts3d/screens.js giftFree, giftrules.js placeGifts); a lit screen sends it to
// another free street screen, and boards sharing a screen take 9-second turns: the fine line says so, in a few words.
function whereBlock(g, { owner: own = false } = {}) {
  const hours = Math.max(1, Math.round((Number(g.b) - Number(g.a)) / 36e5));
  const tag = h('span', { class: 'tag' + (g.phase === 'live' ? ' live' : '') });
  const tagText = () => { const t = now(), d = dDay(g.day, t); tag.className = 'tag' + (t >= g.a && t < g.b ? ' live' : ''); return t >= g.b ? '광장에서 내려왔어요' : t >= g.a ? '● 지금 걸려 있어요' : d >= 1 ? 'D-' + d : clockText(g.a) + '에 켜져요 · ' + countdown(g.a - t) + ' 남음'; };
  tag.textContent = tagText(); live(tag, tagText); // live() paints from the next second on (the tag is not on the page yet)
  const zone = screenZone(g.scr);
  const line = h('p', { class: 'where' }, icon('pin'), h('b', { text: screenName(g.scr) }), zone ? ' · ' + zone : '', ' ', tag);
  const when = h('p', { class: 'fine whenl', text: windowText(g.a, g.b) + ' · ' + hours + '시간 · 누가 그 화면을 켜면 빈 거리 전광판으로 옮겨요' });
  const scene = h('canvas', { class: 'preview scene', width: 1024, height: 576, role: 'img', 'aria-label': `${screenName(g.scr)}에 걸린 ${boardTitle(g)}` });
  const paint = () => paintStreet(scene, g, streetImg(paint)); paint();
  const label = () => { const l = plazaLook(g, now()); return l === 'live' ? '3D 광장에서 내 전광판 보기' : l === 'replay' ? (now() < Number(g.a) ? '3D 광장에서 미리 보기' : '3D 광장에서 다시 보기') : ''; };
  const go = h('a', { class: 'btn go3d', href: '/?gb=' + g.id, onclick: (e) => { beacon(g.id, 'go'); toPlaza(e, 'go', g.id); } });
  const paintGo = () => { const t = label(); go.hidden = !t; return t ? [icon('map'), t] : ''; };
  live(go, paintGo);
  return own ? [line, when, scene, go] : [line, when];
}
// 축하 영상: one entry (the owner, 2026-11-28: "영상이 많아 헷갈린다"). It opens the 실사 video maker (the seven AI scenes, realvideo.js);
// where this browser cannot make it (no recording, no WebGL, or an app's own browser), the same entry opens the drawn 15-second film
// (giftfilm.js) with its save, and says why in one line. Nothing to choose between.
function videoCard(g) {
  const panel = h('div', { class: 'vpanel', hidden: true });
  let built = false;
  const btn = h('button', { class: 'btn', type: 'button', 'aria-expanded': 'false' }, icon('film'), '축하 영상 만들기');
  btn.addEventListener('click', () => {
    if (!built) { built = true; panel.append(...videoBody(g)); }
    panel.hidden = !panel.hidden; btn.setAttribute('aria-expanded', String(!panel.hidden));
  });
  return card(h('h2', {}, icon('film'), '축하 영상'), btn, panel);
}
// What the entry opens: the real video's scene picker, or the drawn film (realReason / inAppBrowser decide).
function videoBody(g) {
  const why = realReason({ rec: canRecord(), gl: hasGL() }), inApp = inAppBrowser(navigator?.userAgent);
  if (!why && !inApp) return realBody(g);
  const st = stage(g, { auto: true, quiet: true, small: true });
  const saveNote = h('p', { class: 'okmsg', role: 'status' }), saveBtn = h('button', { class: 'btn', type: 'button', onclick: () => saveVideo(g, st, saveBtn, saveNote) }, icon('download'), '15초 영상 저장');
  if (inApp) {
    const note = h('p', { class: 'okmsg', role: 'status' }), box = h('input', { type: 'text', class: 'link', readonly: true, value: location.href, hidden: true, 'aria-label': '이 페이지 주소' });
    const copy = h('button', { class: 'btn', type: 'button', onclick: async () => {
      try { await navigator.clipboard.writeText(location.href); say(note, '주소를 복사했어요. Chrome이나 Safari 주소창에 붙여 넣어 주세요.', true); }
      catch { box.hidden = false; pickAll(box); say(note, '아래 주소를 길게 눌러 복사해 주세요.'); }
    } }, icon('link'), '이 페이지 주소 복사');
    return [h('p', { class: 'sub', text: '카카오톡 같은 앱 안의 브라우저에서는 영상을 만들거나 저장할 수 없어요. Chrome이나 Safari에서 열면 실사 축하 영상을 만들 수 있어요.' }), copy, box, note, st.box];
  }
  return [h('p', { class: 'fine', text: why === 'webgl' ? '이 기기에서는 실사 영상을 만들 수 없어서, 그려진 15초 축하 영상으로 만들어요.' : '이 브라우저는 영상 녹화를 지원하지 않아요. 영상을 보며 화면 녹화로 저장해 주세요.' }),
    st.box, h('div', { style: 'height:8px' }), saveBtn, saveNote];
}

// E1: the planned price ladder. Free is chosen and stays the default; a paid tier only says payment is not open and offers a notice
// (advertising: its own consent box, web push only, no email). Views and picks are anonymous daily totals, once per board on this device.
// arm: the board's arm from the owner's read ({ a, p }, giftrules.js ladderArm): its prices are shown (the Worker counts the pick at the same
// price); an older Worker sends none, and the planned prices show. The paid tiers carry their label (결제가 열리면).
const armPrices = (arm) => (Array.isArray(arm?.p) && arm.p.length === TIERS.length && arm.p.every((x, i) => Number.isFinite(Number(x)) && (i === 0 ? Number(x) === 0 : Number(x) > 0)) ? arm.p.map(Number) : TIERS.map((t) => t.price));
function ladder(g, arm = null, into = null) {
  const price = armPrices(arm);
  const flags = json('kts_gint', {}), mark = (k) => { flags[g.id + ':' + k] = 1; const ks = Object.keys(flags); if (ks.length > 300) for (const x of ks.slice(0, 150)) delete flags[x]; ls.set('kts_gint', JSON.stringify(flags)); };
  const once = (k, body) => { if (flags[g.id + ':' + k]) return; mark(k); post('/rt/gift/' + g.id + '/interest', body).catch(() => { }); };
  once('view', { act: 'view' });
  let pick = 0;
  const ask = h('div', { class: 'ask', hidden: true });
  const list = h('div', { class: 'tiers', role: 'radiogroup', 'aria-label': '상품' });
  const paint = () => list.replaceChildren(...TIERS.map((t) => h('button', { type: 'button', class: 'tier', role: 'radio', 'aria-checked': String(pick === t.t), onclick: () => choose(t.t) },
    t.best ? h('span', { class: 'best', text: '추천' }) : null,
    h('div', { class: 'name' }, h('span', {}, t.name, t.tag && !t.best ? h('span', { class: 'hint', text: ' · ' + t.tag }) : null), h('span', { class: 'price', text: t.t ? won(price[t.t]) : '무료' })),
    t.label ? h('span', { class: 'soon', text: t.label }) : null,
    h('ul', {}, ...t.items.map((x) => h('li', { text: x }))))));
  function choose(t) {
    pick = t; paint();
    if (!t) { ask.hidden = true; return; }
    once('pick:' + t, { act: 'pick', t });
    const T = TIERS[t], box = h('input', { type: 'checkbox', id: 'adok' }), msg = h('p', { class: 'okmsg', role: 'status' });
    const go = h('button', { class: 'btn gold', type: 'button', disabled: true, onclick: async () => {
      go.disabled = true; say(msg, '');
      const tok = await token(false); const r = tok ? await pushOn(tok) : { ok: false, hint: '잠시 뒤에 다시 해 주세요.' };
      if (!r.ok) { say(msg, r.hint + ' 관심은 이미 셌어요. 고마워요!'); go.disabled = false; return; }
      const s = await post('/rt/gift/' + g.id + '/interest', { act: 'notify', t, consent: true });
      if (s.ok) { mark('notify:' + t); say(msg, '열리면 이 기기로 한 번 알려 드릴게요. 고마워요!', true); go.textContent = '알림 신청됨'; } else { say(msg, s.error || '신청하지 못했어요.'); go.disabled = false; }
    } }, icon('bell'), '열리면 알림 받기');
    box.addEventListener('change', () => { go.disabled = !box.checked; });
    ask.hidden = false;
    ask.replaceChildren(h('b', { text: `${T.name} ${won(price[t])}` }), h('p', { class: 'sub', style: 'margin:4px 0 10px', text: TIER_ASK }),
      h('label', { for: 'adok', style: 'display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--muted);margin-bottom:10px' }, box,
        h('span', { text: '(선택) 광고성 정보 수신에 동의해요: 유료 상품이 열리면 이 기기로 (광고) 알림을 보내 드려요. 밤 9시부터 아침 8시까지는 보내지 않아요. 브라우저 알림을 끄면 언제든 그만 받아요. 이메일은 받지 않아요.' })),
      flags[g.id + ':notify:' + t] ? h('p', { class: 'okmsg', text: '이미 알림을 신청했어요.' }) : go, msg,
      h('button', { class: 'linkbtn', type: 'button', onclick: () => choose(0) }, '무료로 둘게요'));
  }
  paint();
  const kids = [h('h2', { text: '결제가 열리면 고를 수 있는 것' }),
    h('p', { class: 'sub', text: '무료 걸기는 지금 그대로 쓸 수 있어요. 그 아래는 결제가 열리면 생기는 상품이에요. 지금은 결제가 없고, 고르면 "열리면 알림"을 받을 수 있어요.' }),
    list, ask, h('p', { class: 'fine', text: TIER_NOTE })];
  const box = into || card(); box.replaceChildren(...kids); box.hidden = false;
  payLadder(g, box).catch(() => { }); // checkout open for this account (PAY_ON=1): the same card turns into 결제하기; else it stays as it is
  return box;
}
// 유료 옵션 숨기기 (the owner, 2026-11-28: "유료옵션은 숨겨줘 일단"): the ladder above and everything paid show only while /rt/config carries
// pay (PAY_ON=1). Until then the owner page has no price, no tier, no "열리면 알림" and none of its beacons (ladder() is not even built, so its
// view and pick counts do not fire). With pay on, the card is the one it always was (ladder, then payLadder's checkout for an account that may pay).
function paidCard(g, arm = null) {
  const box = h('section', { class: 'card', hidden: true });
  payMod().then(async (m) => {
    if (!m || !box.isConnected) return;
    let cfg = null; try { cfg = await payApiOf(m).config(); } catch { cfg = null; }
    if (cfg && box.isConnected) ladder(g, arm, box);
  }).catch(() => { });
  return box;
}
// 결제 (payclient.js, only while the Worker has PAY_ON=1 and this account may pay): loaded on the owner page only, when its card is built.
// The mobile return from PortOne (?kts_pay=1&paymentId=<order>) is confirmed once on load (resumeCheckout) and the address cleaned.
let PAYMOD = null;
const payMod = () => (PAYMOD ||= import('./payclient.js?v=202611280944').catch(() => null));
const payApiOf = (m) => m.payApi(undefined, sessionToken); // orders are an account's: the signed-in session only
const PAY_BACK = ['kts_pay', 'paymentId', 'code', 'message', 'pgCode', 'pgMessage', 'transactionType', 'txId'];
const RESUMED = /[?&]kts_pay=1(?:&|$)/.test(location.search) ? payMod().then(async (m) => {
  if (!m) return null;
  let r = null; try { r = await m.resumeCheckout(payApiOf(m)); } catch { r = null; }
  try { const u = new URL(location.href); for (const k of PAY_BACK) u.searchParams.delete(k); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch { /* the address keeps them */ }
  return r ? { st: r.order?.st || '', line: r.order ? m.resultLine(r.order) : { tone: 'err', text: r.message || '결제가 완료되지 않았어요.' } } : null;
}) : Promise.resolve(null);
let RESUME_SHOWN = false, RESUME_RELOADED = false;
// The owner's card in checkout mode: each paid tier with its price (this board's arm), its lines, the test badge in test mode and a
// 결제하기 that opens the sheet (refund rules there and here before paying); the board's order state (결제 대기 / 결제 완료 / 게시 중 /
// 게시됨 / 실패 / 환불); a perk is called applied only at 게시됨. One paid order per board: once one took money the buttons go.
async function payLadder(g, box) {
  const m = await payMod(); if (!m || !box.isConnected) return;
  const api = payApiOf(m), kind = isMe(g) ? 'personal' : 'gift';
  let avail = null; try { avail = await m.payAvailable({ kind, boardId: g.id }, api); } catch { avail = null; }
  const back = await RESUMED;
  if (!avail || !box.isConnected) return;
  // back from the payment page with a paid order: read the board again once (its 12 hours, its clean films), then the line below says it
  if (back && ['PAID', 'PUBLISH_PENDING', 'PUBLISHED'].includes(back.st) && !RESUME_RELOADED) { RESUME_RELOADED = true; board(); return; }
  const byTier = new Map(avail.products.map((p) => [p.tier, p]));
  const draw = async (msg = null) => {
    let orders = []; try { const r = await api.boardOrders(g.id); orders = r.ok ? r.orders || [] : []; } catch { orders = []; }
    if (!box.isConnected) return;
    const line = m.ownerOrderLine(orders), note = h('p', { class: 'okmsg', role: 'status' });
    const tiers = h('div', { class: 'tiers' }, ...TIERS.map((t) => {
      const p = t.t ? byTier.get(t.t) : null; if (t.t && !p) return null;
      const bought = !!(line && t.t && line.name === t.name && line.st !== 'REFUNDED');
      const foot = !t.t ? null : bought ? h('p', { class: line.active ? 'okmsg' : 'fine', text: line.active ? '이 전광판에 적용됐어요' : '이 상품을 주문했어요 · ' + line.label })
        : line?.locked ? h('p', { class: 'fine', text: '이 전광판은 이미 결제한 상품이 있어요.' })
          : h('button', { class: t.best ? 'btn gold' : 'btn', type: 'button', onclick: () => go(p) }, `결제하기 · ${won(p.price)}`);
      return h('div', { class: 'tier pay', 'aria-current': bought ? 'true' : null },
        t.best ? h('span', { class: 'best', text: '추천' }) : null,
        h('div', { class: 'name' }, h('span', {}, t.name, t.tag && !t.best ? h('span', { class: 'hint', text: ' · ' + t.tag }) : null), h('span', { class: 'price', text: t.t ? won(p.price) : '무료' })),
        t.t && avail.badge ? h('span', { class: 'soon', text: avail.badge }) : null,
        h('ul', {}, ...(t.t ? p.perks : t.items).map((x) => h('li', { text: x }))), foot);
    }));
    const status = line ? h('p', { class: line.active ? 'okmsg' : line.st === 'FAILED' || line.st === 'REFUNDED' ? 'err' : 'sub', role: 'status', text: line.text }) : null;
    const refund = avail.refund || {};
    box.replaceChildren(h('h2', { text: '더 오래 걸기 · 워터마크 없는 영상' }),
      avail.testNote ? h('p', { class: 'sub' }, h('b', { text: avail.badge + ' · ' }), avail.testNote) : null,
      h('p', { class: 'sub', text: '무료 걸기는 지금 그대로 쓸 수 있어요. 결제하면 아래 혜택이 이 전광판에 붙어요. 혜택은 결제가 확인되고 전광판에 게시된 뒤에 적용돼요.' }),
      status, tiers, note,
      h('details', {}, h('summary', { text: '취소와 환불' }), h('ul', { class: 'fine' }, ...[refund.before, refund.after, ...(refund.lines || [])].filter(Boolean).map((x) => h('li', { text: x })))),
      h('p', { class: 'fine', text: '가격은 부가세 포함이에요. 한 전광판에 한 번 결제할 수 있어요.' }));
    if (msg) say(note, msg.text, msg.tone === 'ok');
  };
  const go = async (p) => {
    const r = await m.openCheckout({ boardId: g.id, kind, product: p.id }, api);
    if (r?.ok) { board(); return; } // paid: the board is read again (its window, its films) and the card shows the order
    draw();
  };
  const first = back && !RESUME_SHOWN ? back.line : null; RESUME_SHOWN = true;
  await draw(first);
}
// DISCOVER에 보이기 (the owner's share card): off by default. On, the board is listed on /discover while it hangs, with its name, line
// and sender for anyone to read; the Worker keeps the switch (POST /rt/gift/<id>/discover). on: the owner's read (mine.dc).
function discoverBtn(g, on0, note, me) {
  let on = !!Number(on0), busy = false;
  const btn = h('button', { class: 'btn', type: 'button' });
  const paint = () => { btn.replaceChildren(icon(on ? 'eye' : 'eyeOff'), on ? 'DISCOVER에 보이기 · 켜짐' : 'DISCOVER에 보이기 · 꺼짐'); btn.setAttribute('aria-pressed', String(on)); };
  btn.addEventListener('click', async () => {
    if (busy) return; busy = true; btn.disabled = true;
    const r = await post('/rt/gift/' + g.id + '/discover', { on: !on });
    busy = false; btn.disabled = false;
    if (r.ok) { on = Number(r.dc) === 1; paint(); say(note, on ? '둘러보기에 보여요. 이 전광판이 걸려 있는 동안 몇 분 안에 목록에 나와요.' : '몇 분 안에 둘러보기에서 빠져요. 이미 열어 둔 화면도 곧 새로 읽어요.', true); }
    else say(note, r.error || '바꾸지 못했어요. 잠시 뒤 다시 해 주세요.');
  });
  paint();
  return h('div', {}, btn, h('p', { class: 'fine', text: (me ? '켜면 이 전광판이 걸려 있는 동안 둘러보기(DISCOVER)에서 이름과 문구를 누구나 볼 수 있어요.' : '켜면 이 전광판이 걸려 있는 동안 둘러보기(DISCOVER)에서 받는 사람 이름과 문구, 보내는 사람을 누구나 볼 수 있어요. 받는 사람에게 먼저 물어봐 주세요.') + ' 기본은 꺼져 있고, 언제든 끌 수 있어요.' }));
}
// Web push for the "열리면 알림" (the plaza's service worker and the same /rt/push the plaza posts to).
async function pushOn(tok) {
  const ios = /iPhone|iPad/.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (ios && !standalone) return { ok: false, hint: '아이폰은 홈 화면에 추가한 앱에서만 알림을 받을 수 있어요.' };
  if (typeof Notification === 'undefined' || !navigator.serviceWorker || !('PushManager' in window)) return { ok: false, hint: '이 브라우저는 알림을 지원하지 않아요.' };
  if (Notification.permission === 'denied') return { ok: false, hint: '알림이 차단되어 있어요. 주소창의 자물쇠에서 알림을 허용해 주세요.' };
  try {
    if ((await Notification.requestPermission()) !== 'granted') return { ok: false, hint: '알림을 허용해야 받을 수 있어요.' };
    const reg = await navigator.serviceWorker.register('/sw.js?v=11'); await navigator.serviceWorker.ready;
    const key = await fetch('/rt/push/key').then((r) => r.json());
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key.k }));
    const r = await fetch('/rt/push', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ s: sub.toJSON() }) });
    return r.ok ? { ok: true } : { ok: false, hint: '알림 등록을 서버에서 받지 못했어요.' };
  } catch { return { ok: false, hint: '알림을 켜지 못했어요.' }; }
}

// The recipient page (and anyone with the link): before the day a countdown and the 롤링페이퍼; from the day the film first, then
// [답장 전광판 걸기] [🔗 공유하기 | 💖 하트] [영상 저장] [직접 가서 보기 / 광장에서 미리 보기 / 광장에서 다시 보기] [나도 누군가에게 걸어 주기], the messages, and a
// line about when and where it hangs. A 점등식 board (a fixed start) keeps the before look until its start (giftrules.js revealAt,
// pageLook): the lighting is the reveal, and the page turns into the board by itself at that second.
// swap: the page turning by itself (the lighting, or 00:00 of the day on a 점등식 board): { left, right, paper } of the page that is up.
// Then only the left column is built again (and the 📺 card put above the 롤링페이퍼); the 롤링페이퍼 card, the right column, the top, the
// footer and the scroll position stay as they are, so a half-written message, its caret and the focus are never lost, and the page does
// not jump to the top. While a 롤링페이퍼 field has the focus or holds text, the card keeps its place on the screen (the column above it
// changed height).
function visit(g, { preview = false, swap = null } = {}) {
  if (!swap) clear(); CUR = g;
  if (!preview && !swap) beacon(g.id, 'open');
  const O = OCCASIONS[g.occ] || OCCASIONS.bday;
  const phase = () => pageLook(g, now(), CER_DEBUG);
  const back = preview && !swap ? h('button', { class: 'btn sm', type: 'button', onclick: () => board() }, icon('chevronLeft'), '내 관리 화면으로') : null;
  const cer = cerCard(g, preview || swap ? '' : cerBackOnce()); // 점등식: under the countdown before the day, under the where line from the day
  const ME = isMe(g), nudge = preview ? (NUDGE = null) : nudgeLine(g); // shown after this visitor's 💖, message or reply (showNudge)
  const paper = swap?.paper || paperCard(g, preview ? null : showNudge);
  if (phase() === 'before') {
    const words = () => hiddenWords(g, now(), CER_DEBUG), w0 = words(); // a 점등식 board on its day counts to the lighting
    const cd = live(h('div', { class: 'big count' }), () => words().count);
    const label = live(h('div', { class: 'label', text: w0.label }), () => words().label), fine = live(h('p', { class: 'fine', text: w0.fine }), () => words().fine);
    const prev = h('canvas', { class: 'preview', width: 1024, height: 576, 'aria-label': '전광판 미리보기' }); paintGift(prev, { ...g, msg: w0.hush, n: g.n });
    // 💖 before the day (giftrules.js heartTakes): taken now, its count shown only from the reveal; not pressable in the owner's preview.
    const beforeNote = h('p', { class: 'okmsg', role: 'status' });
    const left = h('div', { class: 'sticky' }, h('h1', {}, icon(O.icon), boardTitle(g)), h('p', { class: 'sub', text: '뉴욕 타임스퀘어 가상 광장에 ' + windowText(g.a, g.b) + ' 걸려요.' }),
      card(label, cd, fine), towerLine(g), cer, prev, h('div', { class: 'row' }, heartBtn(g, beforeNote, { off: preview, quiet: true, sent: showNudge })), beforeNote, nudge);
    const right = swap?.right || h('div', {}, paper, cta(g));
    if (swap) swapLeft(swap, left, null);
    else put(top(ME), back, h('div', { class: 'cols' }, left, right), foot());
    // A 점등식 board: at its start the page becomes the board (the reveal), and at midnight of its day the hidden preview says the time.
    // Any other board turns at 00:00 of its day too when the page came without its line (g.hide: the Worker keeps the line and the sender
    // from anyone but the owner until the reveal, giftrules.js publicView): at the reveal the page reads the board again (one GET; a few
    // tries 3 s apart) and shows the board with them. Without a fresh copy it shows what it has (the occasion's hint in place of the line).
    if (CER_DEBUG || cerStart(g) || g.hide) {
      const turn = () => {
        if (!prev.isConnected) { TICK.delete(turn); return; }
        if (phase() !== 'before' || words().hush !== w0.hush) { TICK.delete(turn); reveal(); }
      };
      const reveal = async (tries = 0) => {
        let next = g;
        if (g.hide && phase() !== 'before') {
          try { const r = await fetch('/rt/gift/' + g.id, { cache: 'no-store' }).then((x) => x.json()); if (r?.gift && r.gift.id === g.id && !r.gift.hide) next = { ...g, ...r.gift }; } catch { /* tried again below */ }
          if (next === g && tries < 3) { setTimeout(() => { if (prev.isConnected) reveal(tries + 1); }, 3000); return; }
          delete next.hide;
        }
        if (prev.isConnected) visit(next, { preview, swap: { left, right, paper } });
      };
      TICK.add(turn);
    }
    return;
  }
  const st = stage(g, { auto: true });
  const saveNote = h('p', { class: 'okmsg', role: 'status' }), saveBtn = h('button', { class: 'btn', type: 'button', onclick: () => saveVideo(g, st, saveBtn, saveNote) }, icon('download'), '영상 저장');
  // The plaza button: the visit while the board hangs; on its day before that and after its window the plaza shows it on this device only
  // (gift.js land, giftrules.js plazaLook). The label follows the clock; this part of the page is only built from the day on (a 점등식
  // board: from its start, so it never offers 광장에서 미리 보기).
  const go = h('a', { class: 'btn', href: '/?gb=' + g.id, onclick: (e) => { beacon(g.id, 'go'); toPlaza(e, 'go', g.id); } }, icon('map'), PLAZA_BTN[phase()] || PLAZA_BTN.live);
  live(go, () => [icon('map'), PLAZA_BTN[phase()] || PLAZA_BTN.live]);
  const where = h('p', { class: 'sub' });
  live(where, () => { const p = phase(), t = now(); return p === 'live' ? `지금 ${screenName(g.scr)}에 걸려 있어요 · ${countdown(g.b - t)} 남음` : p === 'day' ? `${hourText(new Date(g.a + 9 * 36e5).getUTCHours())}에 광장에 걸려요 · ${countdown(g.a - t)} 남음` : windowText(g.a, g.b) + ' 광장에 걸렸어요'; });
  // 답장 전광판: the first button (not in the owner's own preview). It opens the maker here, filled in from this board.
  const reply = preview ? null : h('button', { class: 'btn pink', type: 'button', onclick: () => {
    beacon(g.id, 'reply'); ls.set('kts_gref', JSON.stringify({ id: g.id, at: Date.now() })); // kept like ?ref=: a board made later still counts as led here
    // 내 전광판: a cheer for that person (replyDraft: 응원, the name), an ordinary board led from here, not a reply
    if (ME) { history.pushState(null, '', '/gift?ref=' + g.id); maker(replyDraft(g)); return; }
    history.pushState({ re: g.id }, '', '/gift'); maker({ ...replyDraft(g), re: g.id }); // the state: back and forward come to the reply again (route)
  } }, icon(isMe(g) ? 'megaphone' : 'envelope'), replyLabel(g));
  // 🔗 공유하기 (a visitor passing the page on: its own words and its own count, ev:reshare) and 💖, side by side under the reply: the
  // reply stays the first button, and the row is one button tall, so the film and that first button keep the first screen of a phone.
  // The owner's preview shows the heart as it stands (not pressable) and no share (the owner has its own).
  const url = location.origin + '/g/' + g.id, shareNote = h('p', { class: 'okmsg', role: 'status' }), copyBox = h('input', { type: 'text', class: 'link', readonly: true, value: url, hidden: true, 'aria-label': '이 전광판 주소', onfocus: () => { try { copyBox.select(); } catch { /* the field still shows the address */ } } });
  const reshare = preview ? null : h('button', { class: 'btn', type: 'button', onclick: () => sendLink(g.id, { ...visitorShareText(g, phase()), url }, shareNote, 'reshare', copyBox) }, icon('share'), '공유하기');
  const pass = h('div', { class: 'row' }, reshare, heartBtn(g, shareNote, { off: preview, sent: showNudge }));
  const cardNote = h('p', { class: 'okmsg', role: 'status' });
  const more = h('details', { class: 'more' }, h('summary', { class: 'btn' }, '더 보기'), h('div', { class: 'stack' }, go, saveBtn, saveNote, cardBtn(g, cardNote), cardNote));
  const acts = h('div', { class: 'stack', hidden: !preview && !st.ended }, reply, pass, nudge, copyBox, shareNote, more);
  const skip = h('button', { class: 'linkbtn', type: 'button', onclick: () => { acts.hidden = false; skip.remove(); } }, '영상 건너뛰기');
  st.ends.add(() => { acts.hidden = false; skip.remove(); });
  const rp = twoTap(h('button', { class: 'linkbtn', type: 'button' }, '이 전광판 신고'), '한 번 더 누르면 신고해요', async () => { const r = await fetch('/rt/gift/' + g.id + '/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((x) => x.json()).catch(() => null); rp.textContent = r?.ok ? '신고했어요' : '신고하지 못했어요'; rp.disabled = true; });
  const left = h('div', { class: 'sticky' }, h('h1', {}, icon(O.icon), ME ? boardTitle(g) : g.to + '님, ' + O.head), where, friendsLine(g.friends), towerLine(g), cer, st.box, acts.hidden ? skip : null, h('div', { style: 'height:10px' }), acts);
  const posted = card(h('h2', {}, icon('board'), '광장에 걸린 글'), h('p', { class: 'big', style: 'font-size:22px', text: toLine(g) }), h('p', { style: 'font-weight:800;margin:4px 0', text: g.msg || O.hint }), g.from && !ME ? h('p', { class: 'sub', text: 'From. ' + g.from }) : null, rp);
  if (swap) swapLeft(swap, left, posted);
  else put(top(ME), back, h('div', { class: 'cols' }, left, h('div', {}, posted, paper, cta(g))), foot());
}
// The page turning by itself (visit swap): the new left column in place of the old one, the 📺 card (or nothing) at the top of the right
// column. The 롤링페이퍼 card is never taken out of the page. When the person is in it (a field focused or holding text) it is kept where
// it was on the screen; otherwise the scroll position is left alone (never the jump to the top that a new page makes).
function swapLeft(swap, left, lead) {
  const fields = [];
  (function walk(n) { if (!n) return; if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tag === 'input' || n.tag === 'textarea') fields.push(n); for (const k of n.children || n.kids || []) walk(k); })(swap.paper);
  const at = document.activeElement, inPaper = fields.some((f) => f === at || String(f.value || '') !== '');
  const y0 = inPaper ? swap.paper.getBoundingClientRect?.().top : NaN;
  swap.left.after(left); swap.left.remove();
  if (lead) swap.right.prepend(lead);
  const y1 = inPaper ? swap.paper.getBoundingClientRect?.().top : NaN;
  if (Number.isFinite(y0) && Number.isFinite(y1) && y1 !== y0) { try { window.scrollBy(0, y1 - y0); } catch { /* the page stays where it is */ } }
  if (at && fields.includes(at) && document.activeElement !== at) { try { at.focus({ preventScroll: true }); } catch { /* focus stays */ } }
}
// ---- 실사 축하 영상 (realvideo.js) -----------------------------------------------------------------------------------------------
// The owner's card: the seven AI scenes (their stills from /assets/plates/, versioned by index.json); a scene's video and corner track
// are fetched only when it is picked, with how far along (another scene can be picked meanwhile; the scene in hand and the one before stay
// in memory). 만들기 composes the 10-second video on this device (realvideo.js, loaded at the first pick so the tap itself can unlock the
// sound) and offers it to keep: 저장 downloads the file, 공유 opens the share sheet with the file (only where the phone takes files).
// Nothing goes to the server but the page beacons (real_pick, real_made, real_save, real_share, real_fail: names only, since the beacon
// path carries { v, e } counts and no scene or reason). A device that cannot record or has no WebGL is told why; an app's own browser
// (KakaoTalk and the like: no share sheet, downloads go nowhere) is asked to open the page in Chrome or Safari.
const REAL_GOT = new Map(); // scene id -> { pct, json, url, err }
const REAL_ORDER = []; // the scene ids in REAL_GOT, oldest pick first
const REAL_MUSIC = new Map(); // occasion -> Promise<ArrayBuffer | null>; a failed download is asked again next time
let REAL_RV = null, REAL_RVP = null; // realvideo.js once loaded / while loading
let REAL_RUN = null; // the run being made ({ ctl }): one at a time on the page; clear() (another view) aborts it
let GL_SEEN = null;
const hasGL = () => { // asked once per page; the test context is given back at once
  if (GL_SEEN === null) { try { const c = document.createElement('canvas'), x = c.getContext('webgl2') || c.getContext('webgl'); GL_SEEN = !!x; x?.getExtension?.('WEBGL_lose_context')?.loseContext?.(); } catch { GL_SEEN = false; } }
  return GL_SEEN;
};
// A file as a Blob built from its pieces as they come (no second full copy), saying how far along (0..100; -1 when the size is unknown).
async function realBlob(url, type, onPct) {
  const r = await fetch(url); if (!r.ok) throw new Error('get');
  const n = Number(r.headers?.get?.('content-length')) || 0, rd = n && r.body?.getReader ? r.body.getReader() : null;
  if (!rd) { onPct(-1); const b = await r.blob(); onPct(100); return type ? new Blob([b], { type }) : b; }
  const parts = []; let got = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; onPct(Math.min(99, Math.floor((got / n) * 100))); }
  onPct(100); return new Blob(parts, type ? { type } : {});
}
// The day's own track, else its stand-in (realrules.js MUSIC_BACKUP: a day whose track is not in assets/plates/ yet).
const realMusic = (occ) => {
  if (!REAL_MUSIC.has(occ)) REAL_MUSIC.set(occ, (async () => {
    for (const u of musicUrls(occ)) { try { return await (await realBlob(u, '', () => { })).arrayBuffer(); } catch { /* the next one */ } }
    REAL_MUSIC.delete(occ); return null;
  })());
  return REAL_MUSIC.get(occ);
};
// 저장: the file itself (a download), never the share sheet; 공유 is its own button.
function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
}
function realBody(g) {
  const note = h('p', { class: 'okmsg', role: 'status' });
  let pick = null, made = null;
  const idx = new Map(); // scene id -> its index.json entry (its file sizes are the files' version)
  const fill = h('i'), bar = h('div', { class: 'bar', hidden: true, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': '진행' }, fill);
  const barText = h('p', { class: 'fine', hidden: true });
  const showBar = (pct, text) => {
    bar.hidden = pct == null; barText.hidden = pct == null; if (pct == null) return;
    bar.className = pct < 0 ? 'bar wait' : 'bar'; fill.style.width = pct < 0 ? '' : Math.max(2, Math.min(100, pct)) + '%';
    if (pct >= 0) bar.setAttribute('aria-valuenow', String(Math.round(pct))); barText.textContent = text;
  };
  const makeBtn = h('button', { class: 'btn gold', type: 'button', disabled: true, onclick: () => make() }, '장면을 먼저 골라 주세요');
  const result = h('div', { hidden: true });
  const live = h('div', { class: 'stage sm', hidden: true, style: 'margin-top:10px', role: 'img', 'aria-label': '만들고 있는 실사 축하 영상' }); // the video being made, as it is drawn
  const btns = new Map();
  const grid = h('div', { class: 'scenes', role: 'group', 'aria-label': '장면 고르기' }, SCENES.map((s) => {
    const name = h('span', { text: s.name }), img = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
    const b = h('button', { class: 'chip scene', type: 'button', 'aria-pressed': 'false', 'aria-label': s.name + ' 장면', onclick: () => choose(s) }, img, name);
    btns.set(s.id, { b, name, img, s });
    return b;
  }));
  // index.json (asked fresh each time): the scenes' names and the sizes that version their files. Without it the bare file names.
  fetch(REAL_DIR + 'index.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => {
    for (const p of Array.isArray(j?.plates) ? j.plates : []) {
      const x = btns.get(String(p.id)); if (!x) continue;
      idx.set(x.s.id, p);
      if (typeof p.name === 'string' && p.name.trim()) { x.s = { ...x.s, name: p.name.trim() }; x.name.textContent = x.s.name; x.b.setAttribute('aria-label', x.s.name + ' 장면'); }
    }
    for (const x of btns.values()) x.img.setAttribute('src', plateUrls(x.s.id, idx.get(x.s.id)).jpg);
  });
  function refresh() {
    for (const { b, s } of btns.values()) b.setAttribute('aria-pressed', String(pick?.id === s.id));
    if (REAL_RUN) return;
    const e = pick && REAL_GOT.get(pick.id), name = pick ? (btns.get(pick.id)?.s.name || pick.name) : '';
    if (!pick) { showBar(null); makeBtn.disabled = true; makeBtn.textContent = '장면을 먼저 골라 주세요'; return; }
    if (e?.err) { showBar(null); makeBtn.disabled = true; makeBtn.textContent = '장면을 다시 눌러 주세요'; say(note, '‘' + name + '’ 장면을 받지 못했어요. 장면을 다시 눌러 주세요.'); return; }
    if (!e?.url) { const p = e?.pct ?? 0; showBar(p, '‘' + name + '’ 장면 받는 중' + (p >= 0 ? ' ' + p + '%' : '…')); makeBtn.disabled = true; makeBtn.textContent = '장면 받는 중…'; return; }
    showBar(null); makeBtn.disabled = false; makeBtn.replaceChildren(icon('film'), '‘' + name + '’ 장면으로 10초 영상 만들기');
  }
  function loadTool(s) {
    if (!REAL_RVP) REAL_RVP = import('./realvideo.js?v=202611280944').then((m) => { REAL_RV = m; return m; }, (e) => { REAL_RVP = null; throw e; });
    REAL_RVP.catch(() => { if (pick === s && makeBtn.isConnected) { say(note, '영상 도구를 불러오지 못했어요. 장면을 다시 눌러 주세요.'); makeBtn.disabled = true; makeBtn.textContent = '장면을 다시 눌러 주세요'; } });
  }
  function choose(s) {
    if (REAL_RUN) return;
    pick = s; say(note, '');
    beacon(g.id, 'real_pick');
    loadTool(s);
    realMusic(g.occ);
    const at = REAL_ORDER.indexOf(s.id); if (at >= 0) REAL_ORDER.splice(at, 1); REAL_ORDER.push(s.id);
    for (const id of scenesToDrop(REAL_ORDER)) { const x = REAL_GOT.get(id); if (x?.url) URL.revokeObjectURL(x.url); REAL_GOT.delete(id); REAL_ORDER.splice(REAL_ORDER.indexOf(id), 1); }
    const had = REAL_GOT.get(s.id);
    if (!had || had.err) {
      const e = { pct: 0 }; REAL_GOT.set(s.id, e);
      const u = plateUrls(s.id, idx.get(s.id));
      Promise.all([fetch(u.json).then((r) => { if (!r.ok) throw new Error('get'); return r.json(); }), realBlob(u.mp4, 'video/mp4', (p) => { e.pct = p; if (pick?.id === s.id) refresh(); })])
        .then(([j, b]) => { if (plateFault(j)) throw new Error('plate'); if (REAL_GOT.get(s.id) !== e) return; e.json = j; e.url = URL.createObjectURL(b); }) // a scene let go meanwhile keeps nothing
        .catch(() => { e.err = true; }).finally(() => { if (pick?.id === s.id) refresh(); });
    }
    refresh();
  }
  async function make() {
    const e = pick && REAL_GOT.get(pick.id);
    if (REAL_RUN || !e?.url) return;
    if (!REAL_RV) { say(note, REAL_RVP ? '준비하고 있어요. 잠시 뒤에 다시 눌러 주세요.' : '영상 도구를 불러오지 못했어요. 장면을 다시 눌러 주세요.'); return; }
    live.replaceChildren(); live.hidden = false;
    const run = REAL_RV.startRun(e.url, live); // inside the tap: the sound is unlocked here
    const scene = btns.get(pick.id)?.s.name || pick.name, ctl = new AbortController();
    REAL_RUN = { ctl };
    makeBtn.disabled = true; makeBtn.textContent = '영상 만드는 중…'; result.hidden = true; say(note, '');
    if (made) { URL.revokeObjectURL(made.url); made = null; }
    const onHide = () => { if (document.hidden) ctl.abort(); };
    document.addEventListener('visibilitychange', onHide);
    showBar(0, '영상 만드는 중 0% · 이 화면을 켜 둔 채로 기다려 주세요');
    let out = null, fail = '';
    try {
      const music = await realMusic(g.occ);
      for (const hi of lowFor(ls.get('kts_reallo'), Date.now()) ? [false] : [true, false]) {
        try {
          out = await REAL_RV.makeRealVideo({ run, plate: e.json, gift: g, music, hi, signal: ctl.signal,
            onProgress: (p) => showBar(p * 100, '영상 만드는 중 ' + Math.round(p * 100) + '% · 이 화면을 켜 둔 채로 기다려 주세요') });
          break;
        } catch (err) {
          fail = err?.reason || 'fail';
          // too slow at 1080 (this device: 720 for a week), or the graphics context was lost: once more at 720
          if (hi && (fail === 'slow' || fail === 'lost')) { if (fail === 'slow') ls.set('kts_reallo', String(Date.now())); showBar(0, '이 기기에 맞게 720p로 다시 만들어요'); continue; }
          break;
        }
      }
    } finally { document.removeEventListener('visibilitychange', onHide); run.done(); live.hidden = true; REAL_RUN = null; }
    if (!makeBtn.isConnected) return; // the page moved on (clear() stopped the run): nothing more to say
    if (!out) {
      beacon(g.id, 'real_fail'); refresh(); makeBtn.textContent = '다시 만들기'; makeBtn.disabled = false;
      say(note, fail === 'aborted' ? '다른 화면으로 가면 영상 만들기가 멈춰요. 이 화면을 켜 둔 채로 다시 만들어 주세요.' : fail === 'tooslow' ? '이 기기에서는 실사 영상을 부드럽게 만들기 어려워요. 위의 15초 축하 영상을 저장해 보세요.' : '영상을 만들지 못했어요. 다시 만들어 주세요.');
      return;
    }
    made = { blob: out.blob, url: URL.createObjectURL(out.blob), name: realFileName(g, scene, out.type) };
    beacon(g.id, 'real_made'); refresh();
    const file = (() => { try { return new File([made.blob], made.name, { type: made.blob.type }); } catch { return null; } })();
    const canShare = (() => { try { return !!(file && navigator.canShare?.({ files: [file] })); } catch { return false; } })();
    const saveB = h('button', { class: 'btn', type: 'button', onclick: () => {
      try { downloadBlob(made.blob, made.name); beacon(g.id, 'real_save'); say(note, '영상 파일을 내려받았어요. 다운로드 폴더(아이폰은 파일 앱)에서 찾아 보세요.', true); } catch { say(note, '영상을 저장하지 못했어요. 다시 해 주세요.'); }
    } }, icon('download'), '영상 파일 저장');
    const shareB = canShare ? h('button', { class: 'btn', type: 'button', onclick: async () => {
      try { await navigator.share({ files: [file], title: g.to + '님을 위한 축하 영상' }); beacon(g.id, 'real_share'); say(note, '영상을 보냈어요.', true); } catch (err) { if (err?.name !== 'AbortError') say(note, '공유하지 못했어요. 저장한 뒤 보내 주세요.'); }
    } }, icon('share'), '영상 공유') : null;
    result.replaceChildren(h('div', { class: 'stage sm', style: 'margin-top:10px' }, h('video', { src: made.url, controls: true, playsinline: true, preload: 'metadata', 'aria-label': g.to + '님을 위한 실사 축하 영상' })),
      h('div', { class: 'row', style: 'margin-top:10px' }, saveB, shareB));
    result.hidden = false;
    say(note, '영상을 만들었어요. 저장하거나 바로 보내 보세요.', true);
  }
  return [h('p', { class: 'fine', text: '장면을 고르면 이 전광판을 넣은 10초 세로 영상을 이 기기에서 만들어요. 서버에는 올리지 않아요.' }), grid, bar, barText, makeBtn, live, result, note,
    h('p', { class: 'fine', text: '장면을 누르면 그 장면만 받아요(3~8MB). 만드는 동안(10초 남짓) 이 화면을 켜 두어야 해요. 영상 오른쪽 아래에 ‘AI 합성’ 표시가 들어가요.' })];
}

// 점등식: the button for a board with a fixed start (giftrules.js cerButton), with the line under it, or null. Before the window a tap says
// when it opens and shares the invitation; inside it (and for the 2 lit minutes) a link to the plaza (over the plaza: a message to it);
// at budget hard a button that says the plaza is busy. The 1-second ticker repaints the label, swaps the element when what it does
// changes, and takes the whole thing away once the late window is over. why: the reason the plaza sent this visitor back, said once.
function cerCard(g, why = '') {
  const start = CER_DEBUG || cerStart(g);
  const btnOf = () => (start ? cerButton(g, now(), { hard: HARD, start }) : null);
  if (!btnOf()) return null;
  const line = h('p', { class: 'okmsg', role: 'status' }), box = h('div', { class: 'cer' });
  const href = (b) => b.href + (CER_DEBUG ? '&cerin=' + Math.round((start - now()) / 1000) : ''); // the seam goes on into the plaza
  const invite = async () => {
    say(line, CER_TEXT.early, true);
    const inv = cerInvite(g, location.origin + '/g/' + g.id, start); if (!inv) return;
    try { if (navigator.share) { await navigator.share(inv); return; } } catch (e) { if (e?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(inv.text + ' ' + inv.url); say(line, CER_TEXT.early + ' 초대 문구를 복사했어요. 카카오톡에 붙여 넣어 보내세요.', true); } catch { /* the line stays */ }
  };
  const make = (b) => {
    if (b.act !== 'go') return h('button', { class: 'btn gold', type: 'button', onclick: () => (b.act === 'early' ? invite() : say(line, CER_TEXT.busy)) });
    const a = h('a', { class: 'btn gold', href: href(b), onclick: (e) => { a.setAttribute('href', href(b)); beacon(g.id, 'go'); toPlaza(e, 'cer', g.id); } });
    return a;
  };
  let act = '', ctl = null;
  const paint = () => {
    const b = btnOf();
    if (!b) { box.remove(); return false; }
    if (b.act !== act) { if (act) line.textContent = ''; act = b.act; ctl = make(b); box.replaceChildren(ctl, line); }
    ctl.replaceChildren(icon('firework'), b.label);
    if (b.act === 'go') ctl.setAttribute('href', href(b));
    return true;
  };
  paint();
  const run = () => { if (!box.isConnected || !paint()) TICK.delete(run); };
  TICK.add(run);
  if (why) say(line, CER_TEXT[why], true);
  return box;
}
// ?cer=early|busy (the plaza sent this visitor back): the reason, read once; the address loses cer so a reload does not say it again.
function cerBackOnce() {
  const why = cerBackWhy(location.search);
  if (why) {
    try { const q = new URLSearchParams(location.search); q.delete('cer'); const s = q.toString(); history.replaceState(history.state, '', location.pathname + (s ? '?' + s : '') + (location.hash || '')); } catch { /* the address stays */ }
  }
  return why;
}
// 메인 타워 축하 1분 on the recipient page: the public view's tw (the minute only). Before it a countdown, in it the way to the plaza, after
// it the mark for the 7 days the page lives. Nothing about how it was won.
// "친구 N명이 응원했어요" (공유 보상's only public word: the count of networks that reacted on this page, never points): the owner's page from
// the making on (mine.friends), the recipient page once the board is revealed (giftView's friends). Nothing at 0.
function friendsLine(n) { const t = friendsText(n); return t ? h('p', { class: 'sub friends', text: t }) : null; }
function towerLine(g) {
  if (!(Number(g?.tw) > 0)) return null;
  const m = Number(g.tw), box = h('div', { class: 'card' }), text = h('p', { style: 'font-weight:800;margin:0' });
  const go = h('a', { class: 'btn gold', href: '/?gb=' + g.id, style: 'margin-top:10px', onclick: (e) => toPlaza(e, 'go', g.id), hidden: true }, icon('map'), '광장에서 보기');
  const words = () => {
    const t = now(), look = towerLook(m, t); go.hidden = look !== 'live';
    return look === 'soon' ? `${towerClock(m)}에 메인 타워에 올라가요 · ${countdown(m - t)} 남음` : look === 'live' ? '지금 메인 타워에 걸려 있어요' : `메인 타워에 올랐어요 · ${towerClock(m)}`;
  };
  text.textContent = words(); live(text, words); // live() paints from the next second on (the line is not on the page yet)
  box.append(text, go);
  return box;
}
// The owner's card (towerrules.js towerCard): places left that day, the two ways (friends k/10, 2,000 points for an account), the minute
// picker, then the countdown. Asks GET /rt/gift/<id>/tower once when built and again (its refusal carries the fresh taken minutes and days)
// after a refused booking. No card when the Worker has no such route, the board's window is over, or this is not the owner.
function towerCard(g) {
  const head = () => h('h2', {}, icon('building'), '메인 타워에 올리기');
  const box = card(head(), h('p', { class: 'fine', text: '불러오는 중…' }));
  let last = null; // the last answer: a refusal redraws from it with the fresh taken minutes and days
  let busy = false; // a booking is out: nothing redraws the card or opens another picker until it answers (no second points booking)
  const stateOf = (r) => towerState({ g, tw: r.tw, now: now(), days: r.days || {}, taken: r.taken || [], friends: r.friends, guest: r.guest, prep: r.prep, gap: r.gap, paid: !!r.paid });
  const draw = (r, msg = '') => {
    if (busy) return;
    const s = stateOf(r), note = h('p', { class: 'okmsg', role: 'status' });
    box.hidden = false;
    if (s.state === 'booked' || s.state === 'live' || s.state === 'done') { box.replaceChildren(head(), towerLine({ ...g, tw: s.m })); return; }
    if (r.hard) { box.replaceChildren(head(), h('p', { class: 'sub', text: '지금은 광장이 붐벼서 메인 타워 시간을 고를 수 없어요. 잠시 뒤에 다시 열어 주세요.' })); return; }
    if (s.state === 'closed') { box.hidden = true; return; }
    if (s.state === 'sold' || s.state === 'mine') {
      box.replaceChildren(head(), h('p', { class: 'sub', text: s.state === 'sold' ? TOWER_ERR.sold : '그날은 이미 다른 선물 전광판으로 메인 타워 1분을 골랐어요.' }), note);
      if (msg && msg !== TOWER_ERR.sold) say(note, msg);
      return;
    }
    // 메인 타워 주인공 (a published paid order of this board): the minute picked directly, no friends and no points
    if (s.paid) {
      box.replaceChildren(head(), h('p', { class: 'sub', text: `그날 남은 자리 ${s.left}/${TOWER.perDay} · 모든 사람이 같은 1분에 메인 타워 다섯 면에서 봐요.` }),
        h('button', { class: 'btn gold', type: 'button', onclick: () => pick(s, 'paid') }, icon('crown'), '메인 타워 주인공 · 시간 바로 고르기'), note,
        h('p', { class: 'fine', text: '결제한 메인 타워 주인공이라 친구 응원이나 포인트 없이 고를 수 있어요.' }));
      if (msg) say(note, msg);
      return;
    }
    const friendsBtn = h('button', { class: s.canFriends ? 'btn gold' : 'btn', type: 'button' }, s.canFriends ? [icon('clock'), '메인 타워가 열렸어요 · 시간 고르기'] : [icon('users'), `친구 응원 모으기 · ${s.friends}/${s.need}`]);
    friendsBtn.addEventListener('click', () => (s.canFriends ? pick(s, 'friends') : share(g, location.origin + '/g/' + g.id, note)));
    const points = s.points === 'ok' ? h('button', { class: 'btn', type: 'button', onclick: () => pick(s, 'points') }, icon('coin'), `${TOWER.price.toLocaleString('en-US')}포인트로 올리기`)
      : h('p', { class: 'fine', text: s.points === 'account' ? TOWER_ERR.account : s.points === 'prep' ? TOWER_ERR.prep : TOWER_ERR.gap });
    box.replaceChildren(head(), h('p', { class: 'sub', text: `그날 남은 자리 ${s.left}/${TOWER.perDay} · 모든 사람이 같은 1분에 메인 타워 다섯 면에서 봐요.` }),
      h('div', { class: 'stack' }, friendsBtn, points), note,
      h('p', { class: 'fine', text: '친구가 이 페이지에서 하트를 누르거나 롤링페이퍼를 쓰면 한 칸씩 차요. 같은 인터넷 연결은 한 번, 내 연결은 세지 않아요.' }));
    if (msg) say(note, msg);
  };
  // soon: only minutes inside the 5-minute lead are left in the list (the ones gone by, and the one going on, are not shown).
  const WHY = { hour: '정각은 기념일 팀', gold: '9시 팀', taken: '찬 자리', soon: '곧 시작', sold: '매진', day: '그날 이미 고름' };
  const pick = (s, how, msg = '') => {
    if (busy) return;
    const note = h('p', { class: 'okmsg', role: 'status' }), sel = h('select', { 'aria-label': '메인 타워에 올릴 1분' }), t0 = now();
    for (const x of s.minutes.filter((x) => x.m > t0)) { const o = h('option', { value: String(x.m), text: towerClock(x.m) + (x.why ? ' · ' + (WHY[x.why] || '고를 수 없음') : '') }); if (x.why) o.setAttribute('disabled', ''); sel.append(o); }
    const first = s.minutes.find((x) => !x.why && x.m > t0); if (first) sel.value = String(first.m);
    const back = h('button', { class: 'linkbtn', type: 'button', onclick: () => { if (!busy) draw(last); } }, icon('chevronLeft'), '돌아가기');
    const go = h('button', { class: 'btn gold', type: 'button' }, how === 'points' ? `이 1분으로 올리기 · ${TOWER.price.toLocaleString('en-US')}포인트` : '이 1분으로 올리기');
    go.addEventListener('click', async () => {
      if (busy) return;
      busy = true; go.disabled = true; back.disabled = true;
      let r;
      try { r = await post('/rt/gift/' + g.id + '/tower', { m: Number(sel.value), how }, { action: how === 'points' ? 'tower' : '' }); }
      finally { busy = false; go.disabled = false; back.disabled = false; }
      if (r.ok) { last = { ...last, tw: r.tw }; draw(last); return; }
      if (r.taken || r.days) { // the fresh list: the taken minute greyed, or the card when nothing is left to pick
        last = { ...last, taken: r.taken || last.taken, days: r.days || last.days };
        const fresh = stateOf(last);
        if (fresh.state === 'open') pick(fresh, how, r.error); else draw(last, r.error);
        return;
      }
      say(note, r.error || '처리하지 못했어요. 잠시 뒤 다시 해 주세요.');
    });
    box.replaceChildren(...[h('h2', {}, icon('building'), '메인 타워에 올릴 1분'), h('p', { class: 'fine', text: '이 전광판이 걸리는 시간 안에서 골라요. 정각과 밤 9시대는 응원 팀의 자리예요.' }),
      how === 'points' ? h('p', { class: 'sub', text: `누르면 응원 포인트 ${TOWER.price.toLocaleString('en-US')}이 바로 빠져요. 그 1분 전에 전광판이 가려지거나 지워지면 돌려드려요.` }) : null,
      how === 'paid' ? h('p', { class: 'sub', text: '결제한 메인 타워 주인공으로 올려요. 그 1분 전에 전광판이 가려지거나 지워지면 1분은 풀리고 포인트로 돌려드리지 않아요. 환불은 결제의 취소와 환불 규정을 따라요.' }) : null,
      sel, h('div', { style: 'height:8px' }), go, note, h('div', { style: 'text-align:center;margin-top:8px' }, back)].filter(Boolean)); // a null would print as "null"
    if (msg) say(note, msg);
  };
  (async () => {
    const tok = await token(false); if (!tok) { box.hidden = true; return; }
    let r = null; try { r = await fetch('/rt/gift/' + g.id + '/tower', { headers: { authorization: 'Bearer ' + tok }, cache: 'no-store' }).then((x) => x.json()); } catch { r = null; }
    if (!r?.ok) { box.hidden = true; return; }
    last = r; draw(r);
  })();
  return box;
}
function cta(g) {
  return card(h('h2', {}, icon('gift'), '나도 누군가에게'), h('p', { class: 'sub', text: '친구의 생일, 합격, 기념일에 뉴욕 타임스퀘어 가상 광장의 전광판을 6시간 무료로 걸어 줄 수 있어요. 내 이름이나 다짐을 걸 수도 있어요.' }),
    h('a', { class: 'btn', href: '/gift?ref=' + g.id, onclick: () => beacon(g.id, 'cta') }, '나도 걸어 주기'),
    h('a', { class: 'linkbtn', href: '/gift?me=1&ref=' + g.id, style: 'display:block;text-align:center;margin-top:8px', onclick: () => beacon(g.id, 'cta') }, '내 전광판 만들기'));
}
// 롤링페이퍼: the lines (once open) or the lock, and the form while the board takes lines. A new guest is minted only on sending.
// 내 전광판: the same 롤링페이퍼 under the name 응원 메시지. sent: called after a line was left (the account nudge).
function paperCard(g, sent = null) {
  const title = isMe(g) ? '응원 메시지' : '롤링페이퍼', head = () => h('h2', {}, icon('envelope'), title), word = isMe(g) ? '응원 메시지 ' : '친구 메시지 ';
  const list = h('div', { class: 'paper' });
  const paint = () => {
    if (g.open && Array.isArray(g.paper)) {
      list.replaceChildren(...(g.paper.length ? g.paper.map((p) => {
        const rp = twoTap(h('button', { class: 'rp', type: 'button' }, '신고'), '한 번 더', async () => { await fetch('/rt/gift/' + g.id + '/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ m: p.id }) }).catch(() => null); rp.textContent = '신고함'; rp.disabled = true; });
        return h('div', { class: 'note' }, rp, h('b', { text: p.nick }), h('p', { text: p.txt }));
      }) : [h('p', { class: 'sub', text: '아직 메시지가 없어요. 첫 메시지를 남겨 주세요!' })]));
    } else list.replaceChildren(h('div', { class: 'lock' }, icon('lock'), h('span', {}, word, h('b', { text: (g.n || 0) + '개' }), ' · ' + dayText(g.day) + '에 열려요')));
  };
  paint();
  if (!g.takes) return card(head(), list, h('p', { class: 'fine', text: '메시지를 받는 시간이 끝났어요.' }));
  const nick = h('input', { type: 'text', maxlength: 20, autocomplete: 'nickname', placeholder: '닉네임 (선택)', 'aria-label': '닉네임', 'aria-describedby': 'paper-msg', oninput: () => flag(nick, false) });
  const txt = h('textarea', { maxlength: 120, placeholder: g.to + '님에게 한마디', 'aria-label': '메시지', 'aria-describedby': 'paper-msg' });
  const cnt = h('small', { text: '0/' + GIFT.paper.txtMax }); txt.addEventListener('input', () => { flag(txt, false); cnt.textContent = cpLen(norm(txt.value)) + '/' + GIFT.paper.txtMax; });
  const msg = h('p', { class: 'err', id: 'paper-msg', role: 'alert' }), btn = h('button', { class: 'btn gold', type: 'submit' }, icon('envelope'), '메시지 남기기');
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); say(msg, ''); flag(nick, false); flag(txt, false);
    const v = paperFault({ nick: nick.value, txt: txt.value }); if (!v.ok) { say(msg, v.error); flag(v.field === 'nick' ? nick : txt, true); return; }
    btn.disabled = true;
    const r = await post('/rt/gift/' + g.id + '/paper', { nick: v.v.nick, txt: v.v.txt }, { mint: true, action: 'gmsg' });
    btn.disabled = false;
    if (!r.ok) { say(msg, r.error || '남기지 못했어요.'); return; }
    g.n = r.n; if (g.open) g.paper = [...(g.paper || []), { id: r.id, nick: v.v.nick, txt: v.v.txt }];
    txt.value = ''; cnt.textContent = '0/' + GIFT.paper.txtMax; paint();
    say(msg, g.open ? '남겼어요!' : '남겼어요! ' + dayText(g.day) + '에 다른 친구들의 메시지와 함께 열려요.', true);
    try { sent?.(); } catch { /* the line went */ }
  } }, h('div', { class: 'field' }, nick), h('div', { class: 'field' }, h('div', { class: 'label' }, '메시지', cnt), txt), btn, msg,
  h('p', { class: 'fine', text: '닉네임과 메시지는 링크를 받은 사람 누구나 볼 수 있어요. 계정 번호는 다른 사람에게 보이지 않아요. 한 사람이 3개까지 남길 수 있고, 그날이 지나고 7일 뒤에 지워져요.' }));
  return card(head(), list, h('div', { style: 'height:12px' }), form);
}

// ---- start ----------------------------------------------------------------------------------------------------------------------
function route() {
  if (/^\/g\/[0-9a-z]{8}\/?$/.test(location.pathname)) { if (DATA && DATA.id === location.pathname.slice(3, 11)) board(); else location.reload(); }
  else { const re = refOf(history.state?.re); maker(re && DATA?.gift?.id === re ? { ...replyDraft(DATA.gift), re } : {}); } // a reply's maker, reached again by forward
}
window.addEventListener('load', () => { if (scrollY > 0 && !document.activeElement?.matches?.('input,textarea')) scrollTo(0, 0); }, { once: true }); // a reload's kept scroll: start at the film
window.addEventListener('popstate', () => { if (/^\/g\//.test(location.pathname) && !DATA?.gift) location.reload(); else route(); });
route();
