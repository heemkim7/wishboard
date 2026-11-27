// 선물 전광판 in the plaza (browser only): the 🎁 button next to 🌠 (it opens the light maker /gift over the plaza, in a frame),
// /rt/world's live gifts onto the street screens, the ?gb=<id> link ("직접 가서 보기": the camera goes to that board; on the board's
// day before its window and after it, the same on this device only), and the
// sender's 15-second video (?gb=<id>&rec=1, or 🎬 in the frame): a scripted night fly-through to the board with fireworks and a
// cheering crew (timesSquare3d.js giftShow), drawn into a 9:16 frame with the words and the free watermark, recorded with
// MediaRecorder (MP4 where it can, WebM otherwise) and uploaded to the board when the Worker has the R2 store (else kept on the device).
// main.js calls mountGift once and gift.apply(remote.gifts) with every world; ui.js is not touched (the button is put next to 🌠); the frame asks it for ui.layer.
import { GIFT_ID, OCCASIONS, windowText, plazaLook, plazaNote, CER, CER_TEXT, cerStart, cerArrive, cerBack, cerDebugStart, cerSteps, cerDigit, cerPinMs, cerArriveNote, cerBand, cerPhotoText, beaconOnce, kstDay, revealAt, isMe } from './giftrules.js';
import { towerLook } from './towerrules.js';
import { nowMs, clock, skewOf } from './live.js';
import { GIFT_SANS, fitSize } from './giftart.js?v=202611272230';
import { recordCanvas, canRecord, saveBlob, fileName } from './giftfilm.js?v=202611272230';
import { doToken } from './net.js?v=202611272230';

const CSS = `
#kts-gift-frame{position:fixed;inset:0;z-index:2147482000;background:rgba(4,4,14,.72);display:flex;align-items:stretch;justify-content:center;outline:none}
#kts-gift-frame iframe{width:min(100vw,1000px);height:100%;border:0;background:#07061a}
#kts-gift-frame button{position:absolute;right:max(10px,env(safe-area-inset-right));top:max(10px,env(safe-area-inset-top));z-index:2;width:38px;height:38px;border-radius:10px;display:grid;place-items:center;padding:0;line-height:1;color:var(--text-2,#b9bfdc);background:var(--surface-2,#1c2440);border:1px solid var(--line,#262d47);cursor:pointer;transition:background-color .25s,border-color .25s,color .25s,transform .25s}
#kts-gift-frame button::after{content:"";position:absolute;inset:-3px}
#kts-gift-frame button svg{display:block;width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
#kts-gift-frame button:hover{color:var(--text,#f2f4ff);border-color:var(--line-strong,#3a4266)}
#kts-gift-frame button:active{color:var(--text,#f2f4ff);background:#4a5380;border-color:#7781b3;transform:scale(.92);transition:none}
body.gift-rec #ui{visibility:hidden}
body.gift-rec{background:#000}
body.gift-rec #view{left:50%;right:auto;width:min(100vw,calc(100vh * 9 / 16));transform:translateX(-50%)}
#kts-gift-rec{position:fixed;left:50%;transform:translateX(-50%);top:max(12px,env(safe-area-inset-top));z-index:2147482100;display:flex;gap:8px;align-items:center;padding:8px 14px;border-radius:999px;background:rgba(10,8,30,.82);color:#fff;font:800 14px ${GIFT_SANS};border:1px solid rgba(255,255,255,.2)}
#kts-gift-rec i{width:10px;height:10px;border-radius:50%;background:#ff2d55;display:inline-block;animation:kgr 1s infinite}
#kts-gift-rec button{position:relative;min-width:44px;border:0;border-radius:999px;padding:4px 10px;background:rgba(255,255,255,.14);color:#fff;font:inherit;line-height:20px;cursor:pointer;transition:background-color .25s}
#kts-gift-rec button::after{content:"";position:absolute;inset:-8px 0}
#kts-gift-rec button:active{background:rgba(255,255,255,.42);transition:none}
@keyframes kgr{50%{opacity:.25}}
#kts-gift-done{position:fixed;inset:0;z-index:2147482100;background:rgba(4,4,14,.86);display:grid;place-items:center;padding:16px;font:15px/1.5 ${GIFT_SANS};color:#f3f1ff}
#kts-gift-done .box{width:min(420px,100%);max-height:100%;overflow:auto;background:#100d2a;border:1px solid rgba(255,255,255,.14);border-radius:20px;padding:16px}
#kts-gift-done video{display:block;width:100%;max-height:52vh;object-fit:contain;border-radius:14px;background:#000}
#kts-gift-done h2{margin:0 0 8px;font-size:18px}
#kts-gift-done p{margin:8px 0;color:#a8a6c9;font-size:13px}
#kts-gift-done .b{display:flex;width:100%;min-height:48px;margin-top:8px;align-items:center;justify-content:center;border-radius:14px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;font:inherit;font-weight:900;text-decoration:none;cursor:pointer;box-shadow:inset 0 0 0 99px rgba(70,36,0,0);transition:background-color .25s,border-color .25s,box-shadow .25s,transform .25s}
#kts-gift-done .b:active{background-color:rgba(255,255,255,.24);border-color:rgba(255,255,255,.55);transform:scale(.97);transition:none}
#kts-gift-done .b.gold:active{box-shadow:inset 0 0 0 99px rgba(70,36,0,.34)}
#kts-gift-done .b.gold{border:0;color:#2a1800;background:linear-gradient(135deg,#ffe9a8,#ffcf5a 45%,#e6a52a)}
body.gift-cer:not(.has-sheet) #ui{visibility:hidden}
#kts-cer-n{position:fixed;inset:0;margin:auto;width:min(56vw,56vh);height:min(56vw,56vh);z-index:2147481900;display:grid;place-items:center;pointer-events:none;font:900 min(42vw,42vh)/1 ${GIFT_SANS};color:#fff;border-radius:50%;background:radial-gradient(circle,rgba(6,4,20,.8) 0 56%,rgba(6,4,20,0) 71%);text-shadow:.045em .000em 0 #06041a,-.045em .000em 0 #06041a,.000em .045em 0 #06041a,.000em -.045em 0 #06041a,.032em .032em 0 #06041a,-.032em .032em 0 #06041a,.032em -.032em 0 #06041a,-.032em -.032em 0 #06041a,0 0 .12em rgba(0,0,0,.9);font-variant-numeric:tabular-nums;user-select:none}
#kts-cer-n.a{animation:kcer1 .45s ease-out}
#kts-cer-n.b{animation:kcer2 .45s ease-out}
@keyframes kcer1{from{transform:scale(1.22)}to{transform:none}}
@keyframes kcer2{from{transform:scale(1.22)}to{transform:none}}
@media (prefers-reduced-motion: reduce){#kts-cer-n.a,#kts-cer-n.b{animation:none}}
#kts-cer-card{position:fixed;inset:0;z-index:2147482100;background:rgba(4,4,14,.86);display:grid;place-items:center;padding:16px;font:15px/1.5 ${GIFT_SANS};color:#f3f1ff;outline:none}
#kts-cer-card .box{position:relative;width:min(440px,100%);max-height:100%;overflow:auto;background:#100d2a;border:1px solid rgba(255,255,255,.14);border-radius:20px;padding:16px}
#kts-cer-card h2{margin:0 52px 10px 0;font-size:18px;line-height:1.35}
#kts-cer-card img{display:block;width:100%;aspect-ratio:3/2;height:auto;object-fit:contain;border-radius:14px;background:#000}
@media (orientation: landscape) and (max-height: 520px){#kts-cer-card .box{width:min(760px,100%);display:grid;grid-template-columns:3fr 2fr;column-gap:14px;align-items:start}#kts-cer-card h2{grid-column:1/-1}#kts-cer-card img{grid-column:1;grid-row:2/span 5;max-height:calc(100vh - 110px);width:auto;max-width:100%}#kts-cer-card p,#kts-cer-card .b{grid-column:2}#kts-cer-card p{grid-row:2;margin-top:0}}
#kts-cer-card p{margin:8px 0 0;color:#a8a6c9;font-size:13px;min-height:1.5em}
#kts-cer-card .b{display:flex;width:100%;min-height:48px;margin-top:8px;align-items:center;justify-content:center;border-radius:14px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;font:inherit;font-weight:900;text-decoration:none;cursor:pointer;box-shadow:inset 0 0 0 99px rgba(70,36,0,0);transition:background-color .25s,border-color .25s,box-shadow .25s,transform .25s}
#kts-cer-card .b:active{background-color:rgba(255,255,255,.24);border-color:rgba(255,255,255,.55);transform:scale(.97);transition:none}
#kts-cer-card .b.gold{border:0;color:#2a1800;background:linear-gradient(135deg,#ffe9a8,#ffcf5a 45%,#e6a52a)}
#kts-cer-card .b.gold:active{box-shadow:inset 0 0 0 99px rgba(70,36,0,.34)}
#kts-cer-card .x{position:absolute;right:12px;top:12px;width:44px;height:44px;border-radius:12px;display:grid;place-items:center;padding:0;color:var(--text-2,#b9bfdc);background:var(--surface-2,#1c2440);border:1px solid var(--line,#262d47);cursor:pointer;transition:background-color .25s,transform .25s}
#kts-cer-card .x:active{background:#4a5380;transform:scale(.92);transition:none}
#kts-cer-card .x svg{display:block;width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.tool-gift{font-size:20px;line-height:1}`;
// ---- 점등식: the gate (spec ③, giftrules.js 점등식) -----------------------------------------------------------------------
// /?gb=<id>&cer=1 (the recipient page's 🎆 button) asks for the board before the room is joined: once, from the moment this module
// loads (main.js enter() waits for it before net.join; the boot card is not changed). The read is the existing GET /rt/gift/<id>;
// its Date header gives the server's clock (live.js skewOf: no 12 h bound, like the page's own server time, so a device a day off is
// not sent back and forth). One clock for the whole ceremony: when it lets a visitor in and measured an offset that the plaza's
// (clock.off, from the boot read) lacks or differs from by more than 2 s, it becomes the plaza's offset (clock.kept: the boot read
// does not overwrite it), so the teaser, the steps, the 9 pm show and the dance all read the gate's clock. Too early -> back to the page with
// ?cer=early; budget hard inside the window (the read's optional `hard`, absent on an older Worker) -> ?cer=busy; both replace this
// address and never resolve. A ceremony now -> { go, g, start }. Anything else (no fixed start, past the late window, gone, a failed
// read, no answer in CER_WAIT ms) -> { go: false }: the ordinary ?gb= visit. start: the board's own (cerStart), or on a local
// development host the ?cerin=<seconds> seam (cerDebugStart).
const CER_WAIT = 4000;
// The ceremony's own notices (gift.js only): its screen moved, it had no screen left, the connection is down while it waits.
const CER_MOVED = '🎆 점등식 전광판이 옆 화면으로 옮겨 갔어요', CER_GONE = '점등식 전광판을 보여 줄 화면이 없어서 점등식을 마쳤어요';
const CER_NET = '광장 연결이 잠시 끊겼어요. 점등식은 이 기기에서 그대로 이어져요';
const CER_Q = (() => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(''); } })();
const CER_ID = GIFT_ID.test(CER_Q.get('gb') || '') && CER_Q.get('cer') === '1' ? CER_Q.get('gb') : '';
const CER_SEARCH = CER_ID ? String(location.search || '') : '';
// The CER_WAIT ms count from when something waits on the answer (arm: main.js enter(), the arrival), not from the read itself: the read
// starts at import, while a slow phone is still busy building the plaza, and the visitor only waits once the boot card is tapped.
function gateFor(id, search = '', { armed = true } = {}) {
  let arm = () => {};
  const p = new Promise((resolve) => {
    let settled = false, timer = 0;
    const end = (v) => { if (!settled) { settled = true; resolve(v); } };
    arm = () => { if (!timer && !settled) timer = setTimeout(() => end({ go: false }), CER_WAIT); };
    if (armed) arm();
    const sent = Date.now();
    fetch('/rt/gift/' + id, { cache: 'no-store' }).then(async (r) => {
      const skew = skewOf(r.headers?.get?.('date'), sent, Date.now());
      const d = await r.json().catch(() => null);
      if (settled) return; // too late: the ordinary visit already went ahead
      const g = d?.ok && d.gift ? d.gift : null, t = skew == null ? nowMs() : Date.now() + skew;
      const start = (g && cerDebugStart(search, location.hostname, t)) || cerStart(g);
      const why = cerArrive(g, t, { hard: !!d?.hard, start });
      if (why === 'early' || why === 'busy') { settled = true; location.replace(cerBack(id, why)); return; }
      if (why === 'go' && skew != null) { if (!clock.off || Math.abs(skew - clock.off) > 2000) clock.off = skew; clock.kept = true; }
      end(why === 'go' ? { go: true, g, start } : { go: false });
    }).catch(() => end({ go: false }));
  });
  p.arm = arm;
  return p;
}
let cerGateP = null;
/** The ceremony link's gate (resolved once; later calls get the same promise). Without ?gb=<id>&cer=1: { go: false } at once. */
export function cerGate() {
  if (!CER_ID) return Promise.resolve({ go: false });
  cerGateP ||= gateFor(CER_ID, CER_SEARCH, { armed: false });
  return cerGateP;
}
/** The same promise, with its CER_WAIT ms started now (the visitor waits on it from here). */
const cerWait = () => { const p = cerGate(); p.arm?.(); return p; };
if (CER_ID) cerGate();

// budgetDown: a real budget-hard signal (net.js budgetHard), the only thing that sends a waiting ceremony visitor back; netDown: the
// connection is down for another reason (net.js gateDown), which the ceremony only mentions once (the pin and the clock are local).
export function mountGift({ world, ui, whenBuilt, introDone, budgetDown, netDown, towerAdd }) {
  const st = { list: [], busy: false };
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const note = (t, k, fn, o) => { try { ui?.note?.(t, k, fn, o); } catch { /* no toast */ } };
  // The 🎁 button: right after 🌠, when the HUD is there (it is built before the world).
  const btn = document.createElement('button');
  btn.className = 'btn icon tool-gift'; btn.type = 'button'; btn.title = '선물 전광판'; btn.setAttribute('aria-label', '선물 전광판 걸기'); import('./uiicons.js?v=202611272230').then((m) => btn.replaceChildren(m.icon('gift'))).catch(() => { btn.textContent = '🎁'; }); // the line icon, like its neighbours (the emoji only if the icon set cannot be loaded)
  btn.addEventListener('click', () => openMaker());
  const place = () => { const w = document.querySelector('#ui .tool-wish'); if (w && !btn.isConnected) w.after(btn); return !!w; };
  if (!place()) { const t = setInterval(() => { if (place()) clearInterval(t); }, 500); setTimeout(() => clearInterval(t), 30000); }

  // The light page over the plaza. It talks back with postMessage: close, rec (make the video here), go (look at the board here).
  // It is a dialog like the plaza's sheets (ui.js openSheet): named, modal, focus moves to it when it opens (to the frame itself, so a
  // phone does not raise its keyboard; the page inside puts the cursor in its first field only where a mouse is the pointer), Escape
  // closes it, and focus goes back to what opened it (the 🎁 button when nothing else did). Its close button is the sheets' (index.html
  // .x: 38px, 10px corners, the same colours, 44px to press) with the same two-stroke icon (uiicons.js close).
  let frame = null, opener = null;
  let frameAfter = null; // run once the frame closes (the photo card comes back over the plaza when its 받는 사람 페이지로 opened the page here)
  function openMaker(path = '/gift', after = null) {
    if (frame) return;
    frameAfter = typeof after === 'function' ? after : null;
    const name = path.startsWith('/g/') ? '선물 전광판' : '선물 전광판 만들기';
    const active = document.activeElement;
    opener = active && active !== document.body && typeof active.focus === 'function' ? active : null;
    frame = document.createElement('div'); frame.id = 'kts-gift-frame';
    frame.setAttribute('role', 'dialog'); frame.setAttribute('aria-modal', 'true'); frame.setAttribute('aria-label', name); frame.setAttribute('tabindex', '-1');
    const ifr = document.createElement('iframe'); ifr.src = path + (path.includes('?') ? '&' : '?') + 'in=1'; ifr.title = name;
    const x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', '닫기'); x.addEventListener('click', closeMaker);
    const SVG = 'http://www.w3.org/2000/svg', ico = document.createElementNS(SVG, 'svg'), strokes = document.createElementNS(SVG, 'path');
    ico.setAttribute('viewBox', '0 0 24 24'); ico.setAttribute('aria-hidden', 'true'); ico.setAttribute('focusable', 'false'); strokes.setAttribute('d', 'M6 6L18 18M18 6L6 18');
    ico.append(strokes); x.append(ico);
    // Tab goes round the close button and the page inside: on from ✕ into the page, back from the page's first field (the
    // stop in front of it) to ✕, and back from the frame itself to ✕. ui.layer makes everything under the frame inert, takes
    // Escape and the back button first, and stops the plaza's keys.
    const lead = document.createElement('span'); lead.tabIndex = 0; lead.addEventListener('focus', () => x.focus({ preventScroll: true }));
    frame.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const at = document.activeElement;
      if (!e.shiftKey && at === x) { e.preventDefault(); ifr.focus(); }
      else if (e.shiftKey && at === frame) { e.preventDefault(); x.focus({ preventScroll: true }); }
    });
    frame.append(lead, ifr, x); document.body.append(frame);
    // ui.layer also locks movement as its own owner of ui.js's input lock; only a plaza without it is switched off here.
    if (typeof ui?.layer === 'function') ui.layer(frame, closeMaker);
    else world?.setInputEnabled?.(false);
    try { frame.focus({ preventScroll: true }); } catch { /* focus stays where it was */ }
  }
  function closeMaker() {
    if (!frame) return;
    frame.remove(); frame = null;
    // Through ui.layer the lock is released as the layer's owner only, so a sheet still open under the frame keeps it.
    if (typeof ui?.layer === 'function') ui.layer(null);
    else world?.setInputEnabled?.(true);
    const back = opener && opener.isConnected ? opener : btn; opener = null;
    try { back.focus({ preventScroll: true }); } catch { /* focus stays where the browser put it */ }
    const after = frameAfter; frameAfter = null;
    if (after) { try { after(); } catch { /* the plaza stays as it is */ } }
  }
  // Escape with the cursor in the plaza's own document (the frame, its close button). ui.js's keydown listener comes first (createUI
  // runs before mountGift) and closes the frame alone while ui.layer has it; this one is for a plaza without that hook. Keys pressed
  // inside the page come as its own 'close' message.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing) return;
    if (frame) { e.preventDefault(); e.stopPropagation(); closeMaker(); }
    else if (cardEl && typeof ui?.layer !== 'function') { e.preventDefault(); e.stopPropagation(); closeCard(); } // the photo card (ui.layer closes it first where it exists)
  }, true);
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.t !== 'gift') return;
    const id = String(e.data.id || '');
    if (e.data.act === 'close') closeMaker();
    else if (e.data.act === 'rec' && GIFT_ID.test(id)) { closeMaker(); record(id); }
    else if (e.data.act === 'go' && GIFT_ID.test(id)) { closeMaker(); land(id); }
    else if (e.data.act === 'cer' && GIFT_ID.test(id)) { closeMaker(); arriveCer(id, ''); } // the page's 🎆 button over the plaza: no second plaza
  });
  // A tap on a reply notice ("…님이 답장 전광판을 걸었어요": worker.js pushUrl gives /g/<the answered board>) while the plaza is open: the
  // service worker hands this tab the address instead of opening a window (sw.js), so that board's page opens here, over the plaza.
  // Only a board page of this site; the plaza's own links (?focus=, ?wish=) stay main.js's.
  const pushBoard = (url) => { try { const u = new URL(String(url || ''), location.origin); return u.origin === location.origin ? (/^\/g\/([0-9a-z]{8})$/.exec(u.pathname) || [])[1] || '' : ''; } catch { return ''; } };
  try { navigator.serviceWorker?.addEventListener('message', (e) => { const id = e.data?.t === 'push' ? pushBoard(e.data.url) : ''; if (id && !st.busy) { closeMaker(); openMaker('/g/' + id + '?o=1'); } }); } catch { /* no service worker here */ }

  async function fetchGift(id) {
    let tok = ''; try { tok = await doToken(); } catch { tok = ''; }
    try { const r = await fetch('/rt/gift/' + id, { cache: 'no-store', headers: tok ? { authorization: 'Bearer ' + tok } : {} }); const d = await r.json(); return d?.ok ? { ...d, tok } : null; } catch { return null; }
  }
  // "직접 가서 보기" (and, outside the board's window, "광장에서 미리 보기" / "다시 보기"): the board alone on a screen for a minute, the
  // avatar in front of it, the camera on it, fireworks. giftrules.js plazaLook says what the link may do: 'live' while the board hangs,
  // 'replay' on its day before the window and after it while its page lives. A replay is drawn on this device only (pinGift is local:
  // nothing is sent to the room or the Worker), so it takes no screen from anyone. Before the day the link only says when it hangs.
  async function land(id) {
    const up = st.list.find((g) => g.id === id); // the world's copy has no day: it is live by being there
    const g = up || (await fetchGift(id))?.gift, t = nowMs(), look = up ? 'live' : plazaLook(g, t);
    if (!g || look === 'gone') { note('없어졌거나 가려진 선물 전광판이에요', 'err'); return; }
    if (look === 'wait') { note(`이 선물 전광판은 ${windowText(g.a, g.b)}에 걸려요`, 'ok', () => { location.href = '/g/' + id; }); return; }
    whenBuilt(() => {
      // 메인 타워 축하 1분: in its minute the board is on the tower, for everyone. Right after boot the world's copy may not have come yet:
      // the fetched view's minute (tw) is enough, once the board is revealed (main.js towerPush keeps it for that minute).
      const t1 = nowMs();
      if (!world?.towerSlot?.(id) && Number(g.tw) > 0 && towerLook(g.tw, t1) === 'live' && t1 >= revealAt(g)) towerAdd?.({ ...g, id, m: Number(g.tw) });
      const face = world?.towerSlot?.(id);
      if (face) { world.goToSlot?.(face); world.focusSlot?.(face, { hold: 0, celebrate: false }); setTimeout(() => world.cheerAt?.(face), 900); note('🎉 지금 메인 타워에 걸려 있어요!', 'ok'); return; }
      const slot = world?.pinGift?.(g, 60000);
      if (!slot) { note('지금은 이 전광판을 보여 줄 화면이 비어 있지 않아요', 'err'); return; }
      world.goToSlot?.(slot);
      world.focusSlot?.(slot, { hold: 0, celebrate: false });
      setTimeout(() => world.cheerAt?.(slot), 900); // fireworks around the face (giftPop's bursts sit on it and hide the words)
      note(plazaNote(g, look, t), 'ok');
    });
  }

  // ---- the 15-second video ------------------------------------------------------------------------------------------------
  async function record(id) {
    if (st.busy) return;
    if (!canRecord()) { note('이 브라우저에서는 영상을 만들 수 없어요. 크롬이나 사파리 최신 버전에서 해 주세요', 'err'); return; }
    const d = await fetchGift(id);
    if (!d?.gift) { note('없어졌거나 가려진 선물 전광판이에요', 'err'); return; }
    if (!d.own) { note('이 전광판을 만든 기기에서만 영상을 만들 수 있어요. 대신 광장에서 볼게요'); land(id); return; }
    whenBuilt(() => run(d), () => note('광장을 불러오지 못했어요. 다시 해 주세요', 'err'));
  }
  async function run(d) {
    const g = d.gift, O = OCCASIONS[g.occ] || OCCASIONS.bday;
    st.busy = true;
    document.body.classList.add('gift-rec');
    world?.setInputEnabled?.(false);
    const bar = document.createElement('div'); bar.id = 'kts-gift-rec';
    const label = document.createElement('span'), stopBtn = document.createElement('button'), dot = document.createElement('i');
    stopBtn.type = 'button'; stopBtn.textContent = '취소'; bar.append(dot, label, stopBtn); document.body.append(bar);
    const ctl = new AbortController(); stopBtn.addEventListener('click', () => ctl.abort());
    // A hidden tab draws no frames (the file would come out short and frozen): leaving the page stops the recording.
    let hid = false; const onHide = () => { if (document.hidden) { hid = true; ctl.abort(); } }; document.addEventListener('visibilitychange', onHide);
    let unhook = null, show = null, blob = null;
    try {
      // The canvas is now a 9:16 column: give the renderer a few frames to take the new size before the poses are measured.
      label.textContent = '준비 중…';
      await new Promise((r) => setTimeout(r, 450));
      const slot = world.pinGift(g, 20000);
      if (!slot) { note('지금은 이 전광판을 걸 화면이 없어요. 잠시 뒤에 다시 해 주세요', 'err'); return; }
      const view = document.getElementById('view');
      const comp = document.createElement('canvas'); comp.width = 720; comp.height = 1280;
      const c = comp.getContext('2d');
      const t0 = performance.now();
      unhook = world.onFrame(() => {
        const W = comp.width, H = comp.height, vw = view.width, vh = view.height;
        if (!vw || !vh) return;
        // Cover: the middle of the drawn frame at 9:16.
        let sw = vw, sh = vw * 16 / 9; if (sh > vh) { sh = vh; sw = vh * 9 / 16; }
        c.drawImage(view, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, W, H);
        words(c, W, H, (performance.now() - t0) / 1000, g, O);
      });
      for (let n = 3; n > 0; n--) { if (ctl.signal.aborted) break; label.textContent = n + '초 뒤에 시작해요'; await new Promise((r) => setTimeout(r, 700)); }
      if (ctl.signal.aborted) return;
      let left = 15; label.textContent = '녹화 중 ' + left;
      const tick = setInterval(() => { left = Math.max(1, left - 1); label.textContent = '녹화 중 ' + left; }, 1000);
      show = world.giftShow(slot, { ms: 15000 });
      if (!show) { clearInterval(tick); note('운전 중에는 영상을 만들 수 없어요. 내린 뒤에 해 주세요', 'err'); return; }
      blob = await recordCanvas(comp, 15200, { signal: ctl.signal });
      clearInterval(tick);
    } finally {
      try { show?.stop?.(); } catch { /* ended */ }
      unhook?.(); bar.remove(); document.removeEventListener('visibilitychange', onHide);
      document.body.classList.remove('gift-rec');
      world?.setInputEnabled?.(true);
      st.busy = false;
    }
    if (ctl.signal.aborted) { note(hid ? '다른 화면으로 가면 녹화가 멈춰요. 이 화면을 켜 둔 채로 다시 해 주세요' : '영상 만들기를 취소했어요', hid ? 'err' : undefined); return; }
    if (!blob) { note('영상을 만들지 못했어요. 다시 해 주세요', 'err'); return; }
    done(g, blob, d);
  }
  // The opening line, the closing words and the watermark: the same as the drawn film's.
  function words(c, W, H, t, g, O) {
    const a1 = Math.max(0, Math.min(1, (t - 2.6) / 0.6)) * (1 - Math.max(0, Math.min(1, (t - 5.8) / 0.6)));
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (a1 > 0) {
      c.globalAlpha = a1; c.fillStyle = 'rgba(6,4,20,0.45)'; c.fillRect(0, H * 0.08, W, H * 0.13);
      c.fillStyle = '#ffe7a8'; c.font = `700 ${Math.round(W * 0.042)}px ${GIFT_SANS}`; c.fillText('오늘 밤, 뉴욕 타임스퀘어', W / 2, H * 0.115);
      const line = (g.to || '당신') + (isMe(g) ? '님의 전광판이 켜졌어요' : '님을 위한 전광판이 켜졌어요'); // 내 전광판: no "for"
      c.fillStyle = '#fff'; c.font = `800 ${fitSize(c, line, W * 0.88, W * 0.062, W * 0.04)}px ${GIFT_SANS}`; c.fillText(line, W / 2, H * 0.17);
    }
    const a2 = Math.max(0, Math.min(1, (t - 13.2) / 0.8));
    if (a2 > 0) {
      c.globalAlpha = a2;
      const big = O.emoji + ' ' + (g.to || '당신') + '님, ' + O.head + '!';
      c.font = `900 ${fitSize(c, big, W * 0.9, W * 0.075, W * 0.045, 900)}px ${GIFT_SANS}`;
      c.lineWidth = W * 0.012; c.strokeStyle = 'rgba(10,4,30,0.75)'; c.strokeText(big, W / 2, H * 0.8); c.fillStyle = '#ffe08a'; c.fillText(big, W / 2, H * 0.8);
      if (g.from) { c.font = `700 ${Math.round(W * 0.042)}px ${GIFT_SANS}`; c.fillStyle = '#fff'; c.fillText('From. ' + g.from, W / 2, H * 0.85); }
    }
    c.globalAlpha = 1; c.textAlign = 'right'; c.textBaseline = 'alphabetic'; c.font = `800 ${Math.round(W * 0.03)}px ${GIFT_SANS}`;
    c.fillStyle = 'rgba(255,255,255,0.75)'; c.fillText('WISH BOARD · 무료', W - W * 0.04, H - H * 0.022);
    c.textAlign = 'left'; c.font = `600 ${Math.round(W * 0.022)}px ${GIFT_SANS}`; c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillText('가상 광장 · 실제 타임스퀘어와 무관', W * 0.04, H - H * 0.022);
  }
  // The result: play it back, save it, and put it on the recipient page when the Worker keeps videos.
  function done(g, blob, d) {
    const url = URL.createObjectURL(blob);
    const wrap = document.createElement('div'); wrap.id = 'kts-gift-done';
    const box = document.createElement('div'); box.className = 'box';
    const h2 = document.createElement('h2'); h2.textContent = '🎬 15초 축하 영상이 나왔어요';
    const v = document.createElement('video'); v.src = url; v.controls = true; v.playsInline = true; v.muted = true; v.loop = true; v.autoplay = true;
    const info = document.createElement('p'); info.textContent = (blob.type.includes('mp4') ? 'MP4' : 'WebM') + ' · ' + (blob.size / 1048576).toFixed(1) + 'MB · 세로 9:16';
    const up = document.createElement('p');
    const save = document.createElement('button'); save.className = 'b gold'; save.type = 'button'; save.textContent = '⬇ 영상 저장';
    save.addEventListener('click', async () => { const how = await saveBlob(blob, fileName(g, blob)); if (how !== 'cancel') up.textContent = up.textContent || '저장했어요.'; });
    const page = document.createElement('a'); page.className = 'b'; page.href = '/g/' + g.id; page.textContent = '받는 사람 페이지 보기';
    const close = document.createElement('button'); close.className = 'b'; close.type = 'button'; close.textContent = '광장으로 돌아가기';
    close.addEventListener('click', () => { wrap.remove(); URL.revokeObjectURL(url); });
    box.append(h2, v, info, up, save, page, close); wrap.append(box); document.body.append(wrap);
    if (!d.media) { up.textContent = '지금은 영상 저장소가 없어서 이 기기에만 저장돼요. 받는 사람 페이지에서는 그려진 축하 영상이 나와요.'; return; }
    up.textContent = '받는 사람 페이지에 올리는 중…';
    upload(g.id, blob).then((r) => { up.textContent = r.ok ? '받는 사람 페이지에 올렸어요. 링크를 연 사람에게 이 영상이 먼저 나와요.' : (r.error || '올리지 못했어요. 영상은 저장해 두세요.'); });
  }
  async function upload(id, blob) {
    let tok = ''; try { tok = await doToken(); } catch { tok = ''; }
    if (!tok) return { ok: false, error: '로그인 정보가 없어 올리지 못했어요.' };
    const send = async (ts) => { try { const r = await fetch('/rt/gift/' + id + '/video', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': blob.type || 'application/octet-stream', ...(ts ? { 'x-ts': ts } : {}) }, body: blob }); return { s: r.status, d: await r.json().catch(() => ({})) }; } catch { return { s: 0, d: { ok: false } }; } };
    let { s, d } = await send('');
    if (s === 403 && d?.code === 'human' && d.site) {
      let ts = ''; try { ts = await (await import('./human.js?v=202611272230')).humanToken(String(d.site), { action: 'gvid' }); } catch { ts = ''; }
      if (ts) ({ s, d } = await send(ts));
    }
    return d || { ok: false };
  }

  // ---- 점등식: the ceremony on this device ---------------------------------------------------------------------------------
  // No server signal: a 250 ms tick (and at once when the tab is seen again or the page comes back from the back/forward cache) asks
  // giftrules.js cerSteps what is due now and does each step once; a tab that was away resumes at the phase it is in (missed steps are
  // not replayed). Nothing new goes to the room: the cheer is the existing emote (playEmote(3): its own E packet and cooldown) and the
  // avatar's spread spot and turn are local moves sent in the ordinary position packets. Nothing is uploaded: the photo stays on this
  // device until its owner saves or shares it. No reward. The HUD (#ui) hides from the countdown until the photo (or +12 s), only
  // while no sheet and no layer is open and the player is not driving; every exit puts it back (hud() runs after every tick, stopCer
  // on every way out).
  let cer = null; // { g, id, start, slot, done, spot, posed, shot, timer }
  const busy = () => { try { return !!ui?.busy?.(); } catch { return false; } };
  const seat = () => {
    let v = NaN; try { v = Number(sessionStorage.getItem('kts_cerseat')); } catch { /* private mode */ }
    if (!(v >= 0 && v < 1)) { v = Math.random(); try { sessionStorage.setItem('kts_cerseat', String(v)); } catch { /* kept for this page only */ } }
    return v;
  };
  // The recipient page's beacon rule (giftpage.js beacon, giftrules.js beaconOnce): one per board, event and KST day on this device.
  const visitor = () => { let v = ''; try { v = localStorage.getItem('kts_gv') || ''; } catch { v = ''; } if (!/^[0-9a-f]{16}$/.test(v)) { const b = new Uint8Array(8); crypto.getRandomValues(b); v = [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); try { localStorage.setItem('kts_gv', v); } catch { /* this page only */ } } return v; };
  function beacon(id, e) {
    let seen = {}; try { seen = JSON.parse(localStorage.getItem('kts_gseen') || '{}') || {}; } catch { seen = {}; }
    const r = beaconOnce(seen, id, e, kstDay(nowMs()));
    try { localStorage.setItem('kts_gseen', JSON.stringify(r.seen)); } catch { /* private mode: sent again next time */ }
    if (!r.send) return;
    const body = JSON.stringify({ v: visitor(), e });
    try { if (navigator.sendBeacon?.('/rt/gift/' + id + '/seen', new Blob([body], { type: 'text/plain' }))) return; } catch { /* fetch below */ }
    fetch('/rt/gift/' + id + '/seen', { method: 'POST', body, keepalive: true }).catch(() => { });
  }
  // The big number: white with a dark edge, no pointer; it only changes (no scale or fade) under prefers-reduced-motion (the CSS).
  let digitEl = null;
  function digit(n) {
    if (!n) { digitEl?.remove(); digitEl = null; return; }
    if (!digitEl) { digitEl = document.createElement('div'); digitEl.id = 'kts-cer-n'; digitEl.setAttribute('aria-hidden', 'true'); document.body.append(digitEl); }
    const t = String(n);
    if (digitEl.textContent !== t) { digitEl.textContent = t; digitEl.className = n % 2 ? 'a' : 'b'; }
  }
  // HUD hidden: from the countdown until the photo is taken or its moment passed, while no sheet or layer is open (the CSS also leaves
  // it when body.has-sheet comes first) and the player is not driving.
  function hud() {
    const c = cer, now = nowMs();
    const on = !!c && !!c.done.before && !c.done.shot && now >= c.start - CER.count && now < c.start + CER.shot + CER.shotSlack && !busy() && !world?.isDriving?.();
    document.body.classList.toggle('gift-cer', on);
  }
  function stopCer() {
    const c = cer;
    cer = null;
    if (c) { clearInterval(c.timer); if (c.posed && !c.done.shot) { try { world?.cerEnd?.(); } catch { /* the camera comes back by itself (CER_HOLD) */ } } }
    digit(0);
    document.body.classList.remove('gift-cer');
  }
  const onSeen = () => { if (cer && !document.hidden) tick(); };
  document.addEventListener('visibilitychange', onSeen);
  window.addEventListener('pageshow', onSeen);
  function ceremony(g, start) {
    stopCer();
    whenBuilt(() => {
      const now = nowMs();
      const slot = world?.pinGift?.(g, cerPinMs(start, now), { cer: start });
      if (!slot) { note('지금은 이 전광판을 보여 줄 화면이 비어 있지 않아요', 'err'); return; }
      const c = { g, id: g.id, start, slot, done: {}, spot: null, posed: false, timer: 0 };
      cer = c;
      try {
        c.spot = world.goToSlot?.(slot, { spread: seat() }) || null;
        if (!world.isDriving?.()) world.focusSlot?.(slot, { hold: 3500, celebrate: false });
      } catch { /* the board is up; the camera stays where it is */ }
      note(cerArriveNote(g, now, start), 'ok');
      beacon(g.id, 'cer');
      setTimeout(() => { if (cer === c) { try { world?.cerPrep?.(slot); } catch { /* worked out at the pose instead */ } } }, 1200); // the photo pose, ahead of time
      c.timer = setInterval(tick, 250);
      tick();
    }, () => note('광장을 불러오지 못했어요. 다시 해 주세요', 'err'));
  }
  // The ceremony's screen changed under it: someone lit it, so ts3d/screens.js moved the pin to the nearest free screen. The ceremony
  // goes on there: the gather spot (before the photo pose), the camera, the photo's pose worked out again, the pose itself if it is up.
  function follow(c, slot) {
    c.slot = slot;
    if (!c.done.pose && !world.isDriving?.()) {
      c.spot = world.goToSlot?.(slot, { spread: seat() }) || c.spot;
      world.focusSlot?.(slot, { hold: 3500, celebrate: false });
    }
    try { world.cerPrep?.(slot); } catch { /* worked out at the pose instead */ }
    if (c.posed && !c.done.shot) c.posed = !!world.cerPose?.(slot);
    note(CER_MOVED, 'ok', null, { key: 'cer-move' });
  }
  function tick() {
    const c = cer;
    if (!c) return;
    try {
      const now = nowMs();
      // The board left its screen: moved to another one (a lit claim), or gone (no free screen, the pin replaced): followed, or the end.
      const at = world?.giftSlot ? world.giftSlot(c.id) : c.slot;
      if (at !== c.slot) {
        if (!at) { stopCer(); note(CER_GONE, 'err', null, { key: 'cer-move' }); return; }
        follow(c, at);
      }
      const s = cerSteps(c.start, now, c.done);
      const before = s.phase === 'wait' || s.phase === 'count';
      if (before) c.done.before = true;
      // Budget hard learned after arriving (net.js budgetHard: the room's 'down', /rt/gate full without err) before the start: back to the
      // page. After it, stay. A connection that is only failing keeps the visitor here (the pin and the clock are on this device).
      if (before && budgetDown?.()) { stopCer(); location.replace(cerBack(c.id, 'busy')); return; }
      if (before && !c.done.net && netDown?.()) { c.done.net = true; note(CER_NET, '', null, { key: 'cer-net' }); }
      if (s.teaser) c.done.teaser = true; // pinned with its teaser at arrival
      if (before && !c.done.gather && c.start - now <= 30000) {
        c.done.gather = true;
        const p = world?.getPlayer?.(), at = c.spot;
        if (p && at && Math.hypot(p.x - at.x, p.z - at.z) > 25) note(CER_TEXT.gather, 'ok', () => { c.spot = world.goToSlot?.(c.slot, { spread: seat() }) || c.spot; });
      }
      if (s.count) {
        c.done.count = true;
        if (!world.isDriving?.() && !world.walking?.()) world.focusSlot?.(c.slot, { hold: Math.max(1000, c.start + CER.pose - now), celebrate: false });
      }
      digit(s.phase === 'count' ? cerDigit(c.start, now) : 0);
      if (s.light) c.done.light = true; // the same screen shows the card from the start (ts3d/screens.js)
      if (s.cheer && world.playEmote?.(3)) c.done.cheer = true; // refused by the cooldown: the next tick tries again (until +5 s)
      if (s.round >= 0) { c.done.rounds = s.round + 1; world.cheerAt?.(c.slot); }
      if (s.pose) { c.done.pose = true; c.posed = !!world.cerPose?.(c.slot); }
      if (s.shot && shoot(c)) c.done.shot = true; // refused (a hidden page, a lost context): tried again next tick, offered after the slack
      if (s.offer) {
        c.done.offer = true;
        note(CER_TEXT.shotTake, 'ok', () => takeLater(c), { ms: Math.max(4000, c.start + CER.late - now) });
      }
      if (s.end || s.phase === 'over') { c.done.end = true; stopCer(); return; } // over: also a ceremony that began past its late window
    } catch {
      stopCer(); // a step that throws ends the ceremony here; the HUD is back
      return;
    } finally {
      if (cer === c) hud();
    }
  }
  // The offered photo (a late arrival, or the moment passed unseen): the same pose, the shot 1.5 s later, the same card.
  // One at a time: taps while a shot is on its way do nothing.
  function takeLater(c) {
    if (c.taking) return;
    if (!world?.cerPose?.(c.slot)) { note('지금은 단체 사진을 찍을 수 없어요. 택시에서 내린 뒤에 다시 해 주세요', 'err'); return; }
    c.taking = true;
    setTimeout(() => { c.taking = false; if (!shoot(c)) note('지금은 단체 사진을 찍을 수 없어요. 잠시 뒤에 다시 해 주세요', 'err'); }, CER.shot - CER.pose);
  }
  // The photo is the world's own 3:2 render of the ceremony (timesSquare3d.js capture({ photo })): it does not wait for the live camera
  // or for a frame to be drawn. -> true when there is a photo; false when the world refused (nothing is claimed).
  function shoot(c) {
    let blob = null;
    try { blob = world.capture?.({ photo: c.slot, band: cerBand(c.g, c.start) }) || null; } catch { blob = null; }
    if (!blob) return false;
    try { world.cerEnd?.(); } catch { /* the camera comes back by itself */ }
    if (cer === c) hud();
    // A sheet or a layer is open: the photo waits behind a notice (the card is the one modal layer).
    if (busy()) note(CER_TEXT.shotReady, 'ok', () => photoCard(c.g, blob), { ms: 60000 });
    else photoCard(c.g, blob);
    return true;
  }
  // The photo card: one modal layer (ui.layer: Escape, the back button and ✕ close it; the HUD under it is inert).
  // Closing gives focus back to what had it when the card opened (a notice, a HUD button), like the sheets and the gift frame.
  let cardEl = null, cardUrl = '', cardBack = null;
  function closeCard() {
    if (!cardEl) return;
    cardEl.remove(); cardEl = null;
    if (cardUrl) { try { URL.revokeObjectURL(cardUrl); } catch { /* gone */ } cardUrl = ''; }
    if (typeof ui?.layer === 'function') ui.layer(null);
    const back = cardBack; cardBack = null;
    if (back && back.isConnected) { try { back.focus({ preventScroll: true }); } catch { /* focus stays where the browser put it */ } }
  }
  function photoCard(g, blob) {
    if (frame) return note(CER_TEXT.shotReady, 'ok', () => photoCard(g, blob), { ms: 60000 }); // the gift frame is the layer now
    closeCard();
    const active = document.activeElement;
    cardBack = active && active !== document.body && typeof active.focus === 'function' ? active : null;
    const id = g.id, name = 'wishboard-' + id + '.jpg';
    const wrap = document.createElement('div'); wrap.id = 'kts-cer-card';
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', '단체 사진'); wrap.setAttribute('tabindex', '-1');
    const box = document.createElement('div'); box.className = 'box';
    const h2 = document.createElement('h2'); h2.textContent = CER_TEXT.shotHead;
    const img = document.createElement('img'); cardUrl = URL.createObjectURL(blob); img.src = cardUrl; img.alt = 'To. ' + (g.to || '') + ' 단체 사진';
    const line = document.createElement('p'); line.setAttribute('role', 'status');
    const save = document.createElement('button'); save.type = 'button'; save.className = 'b gold'; save.textContent = CER_TEXT.save;
    save.addEventListener('click', async () => {
      const how = await saveBlob(blob, name);
      if (how === 'cancel') return;
      beacon(id, 'cershot'); line.textContent = '사진을 저장했어요.';
    });
    const share = document.createElement('button'); share.type = 'button'; share.className = 'b'; share.textContent = CER_TEXT.share;
    share.addEventListener('click', async () => {
      const url = location.origin + '/g/' + id, text = cerPhotoText(g);
      try {
        let file = null; try { file = new File([blob], name, { type: 'image/jpeg' }); } catch { file = null; }
        if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text, url });
        else if (navigator.share) await navigator.share({ title: text, text, url });
        else { await navigator.clipboard.writeText(text + ' ' + url); line.textContent = '링크를 복사했어요. 카카오톡에 붙여 넣어 보내세요.'; }
        beacon(id, 'cershot');
      } catch (e) { if (e?.name !== 'AbortError') line.textContent = '공유하지 못했어요. 사진 저장을 눌러 주세요.'; }
    });
    // The recipient page opens over the plaza in the gift frame (the 🎁 button's): the plaza and this photo stay; closing the frame
    // brings the card back. The card closes first (ui.layer holds one layer). The href stays for a new tab.
    const page = document.createElement('a'); page.className = 'b'; page.href = '/g/' + id; page.textContent = CER_TEXT.page;
    page.addEventListener('click', (e) => { e?.preventDefault?.(); closeCard(); openMaker('/g/' + id, () => photoCard(g, blob)); });
    const x = document.createElement('button'); x.type = 'button'; x.className = 'x'; x.setAttribute('aria-label', '닫기'); x.addEventListener('click', closeCard);
    const SVG = 'http://www.w3.org/2000/svg', ico = document.createElementNS(SVG, 'svg'), strokes = document.createElementNS(SVG, 'path');
    ico.setAttribute('viewBox', '0 0 24 24'); ico.setAttribute('aria-hidden', 'true'); ico.setAttribute('focusable', 'false'); strokes.setAttribute('d', 'M6 6L18 18M18 6L6 18');
    ico.append(strokes); x.append(ico);
    box.append(x, h2, img, line, save, share, page); wrap.append(box); document.body.append(wrap);
    cardEl = wrap;
    if (typeof ui?.layer === 'function') ui.layer(wrap, closeCard);
    try { wrap.focus({ preventScroll: true }); } catch { /* focus stays */ }
    if (cer?.id === id) hud();
  }
  // The embedded recipient page's ceremony button ({ act: 'cer' }), or a ceremony link: the same gate, then the ceremony or the visit.
  function arriveCer(id, search) {
    if (cer && cer.id === id) return; // that board's ceremony is on here: a second 🎆 tap changes nothing (it would make a late arrival)
    const p = search == null ? cerWait() : gateFor(id, search);
    p.then((r) => { if (r?.go) ceremony(r.g, r.start); else land(id); }).catch(() => land(id));
  }

  // ?gb=<id> (and &rec=1, or &cer=1: the ceremony): after entering. True when it took the arrival (main.js then skips its intro and tutorial).
  const q = new URLSearchParams(location.search), GB = GIFT_ID.test(q.get('gb') || '') ? q.get('gb') : '', REC = q.get('rec') === '1';
  function arrive() {
    if (!GB) return false;
    try { const u = new URL(location.href); for (const k of ['gb', 'rec', 'cer', 'cerin']) u.searchParams.delete(k); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch { /* keep the address */ }
    if (CER_ID === GB) arriveCer(GB); else if (REC) record(GB); else land(GB);
    setTimeout(() => introDone?.(), 700);
    return true;
  }
  return {
    arrive, open: openMaker,
    // main.js enter(): the room is joined only after the ceremony link's gate (at once without one).
    cerHold: () => (CER_ID ? cerWait() : Promise.resolve({ go: false })),
    apply(list) { st.list = Array.isArray(list) ? list : []; world?.setGifts?.(st.list); },
  };
}
