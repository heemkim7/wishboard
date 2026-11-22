// 선물 전광판 in the plaza (browser only): the 🎁 button next to 🌠 (it opens the light maker /gift over the plaza, in a frame),
// /rt/world's live gifts onto the street screens, the ?gb=<id> link ("직접 가서 보기": the camera goes to that board), and the
// sender's 15-second video (?gb=<id>&rec=1, or 🎬 in the frame): a scripted night fly-through to the board with fireworks and a
// cheering crew (timesSquare3d.js giftShow), drawn into a 9:16 frame with the words and the free watermark, recorded with
// MediaRecorder (MP4 where it can, WebM otherwise) and uploaded to the board when the Worker has the R2 store (else kept on the device).
// main.js calls mountGift once and gift.apply(remote.gifts) with every world; ui.js is not touched (the button is put next to 🌠).
import { GIFT_ID, OCCASIONS, windowText } from './giftrules.js';
import { GIFT_SANS, fitSize } from './giftart.js?v=202611230850';
import { recordCanvas, canRecord, saveBlob, fileName } from './giftfilm.js?v=202611230850';
import { doToken } from './net.js?v=202611230850';

const CSS = `
#kts-gift-frame{position:fixed;inset:0;z-index:2147482000;background:rgba(4,4,14,.72);display:flex;align-items:stretch;justify-content:center}
#kts-gift-frame iframe{width:min(100vw,1000px);height:100%;border:0;background:#07061a}
#kts-gift-frame button{position:absolute;right:max(10px,env(safe-area-inset-right));top:max(10px,env(safe-area-inset-top));z-index:2;width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(10,8,30,.85);color:#fff;font:700 18px system-ui;cursor:pointer}
body.gift-rec #ui{visibility:hidden}
body.gift-rec{background:#000}
body.gift-rec #view{left:50%;right:auto;width:min(100vw,calc(100vh * 9 / 16));transform:translateX(-50%)}
#kts-gift-rec{position:fixed;left:50%;transform:translateX(-50%);top:max(12px,env(safe-area-inset-top));z-index:2147482100;display:flex;gap:8px;align-items:center;padding:8px 14px;border-radius:999px;background:rgba(10,8,30,.82);color:#fff;font:800 14px ${GIFT_SANS};border:1px solid rgba(255,255,255,.2)}
#kts-gift-rec i{width:10px;height:10px;border-radius:50%;background:#ff2d55;display:inline-block;animation:kgr 1s infinite}
#kts-gift-rec button{border:0;border-radius:999px;padding:4px 10px;background:rgba(255,255,255,.14);color:#fff;font:inherit;cursor:pointer}
@keyframes kgr{50%{opacity:.25}}
#kts-gift-done{position:fixed;inset:0;z-index:2147482100;background:rgba(4,4,14,.86);display:grid;place-items:center;padding:16px;font:15px/1.5 ${GIFT_SANS};color:#f3f1ff}
#kts-gift-done .box{width:min(420px,100%);max-height:100%;overflow:auto;background:#100d2a;border:1px solid rgba(255,255,255,.14);border-radius:20px;padding:16px}
#kts-gift-done video{display:block;width:100%;max-height:52vh;object-fit:contain;border-radius:14px;background:#000}
#kts-gift-done h2{margin:0 0 8px;font-size:18px}
#kts-gift-done p{margin:8px 0;color:#a8a6c9;font-size:13px}
#kts-gift-done .b{display:flex;width:100%;min-height:48px;margin-top:8px;align-items:center;justify-content:center;border-radius:14px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;font:inherit;font-weight:900;text-decoration:none;cursor:pointer}
#kts-gift-done .b.gold{border:0;color:#2a1800;background:linear-gradient(135deg,#ffe9a8,#ffcf5a 45%,#e6a52a)}
.tool-gift{font-size:20px;line-height:1}`;

export function mountGift({ world, ui, whenBuilt, introDone }) {
  const st = { list: [], busy: false };
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const note = (t, k, fn) => { try { ui?.note?.(t, k, fn); } catch { /* no toast */ } };
  // The 🎁 button: right after 🌠, when the HUD is there (it is built before the world).
  const btn = document.createElement('button');
  btn.className = 'btn icon tool-gift'; btn.type = 'button'; btn.title = '선물 전광판'; btn.setAttribute('aria-label', '선물 전광판 걸기'); btn.textContent = '🎁';
  btn.addEventListener('click', () => openMaker());
  const place = () => { const w = document.querySelector('#ui .tool-wish'); if (w && !btn.isConnected) w.after(btn); return !!w; };
  if (!place()) { const t = setInterval(() => { if (place()) clearInterval(t); }, 500); setTimeout(() => clearInterval(t), 30000); }

  // The light page over the plaza. It talks back with postMessage: close, rec (make the video here), go (look at the board here).
  let frame = null;
  function openMaker(path = '/gift') {
    if (frame) return;
    frame = document.createElement('div'); frame.id = 'kts-gift-frame';
    const ifr = document.createElement('iframe'); ifr.src = path + (path.includes('?') ? '&' : '?') + 'in=1'; ifr.title = '선물 전광판';
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', '닫기'); x.addEventListener('click', closeMaker);
    frame.append(ifr, x); document.body.append(frame);
    world?.setInputEnabled?.(false);
  }
  function closeMaker() { if (!frame) return; frame.remove(); frame = null; world?.setInputEnabled?.(true); }
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.t !== 'gift') return;
    const id = String(e.data.id || '');
    if (e.data.act === 'close') closeMaker();
    else if (e.data.act === 'rec' && GIFT_ID.test(id)) { closeMaker(); record(id); }
    else if (e.data.act === 'go' && GIFT_ID.test(id)) { closeMaker(); land(id); }
  });

  async function fetchGift(id) {
    let tok = ''; try { tok = await doToken(); } catch { tok = ''; }
    try { const r = await fetch('/rt/gift/' + id, { cache: 'no-store', headers: tok ? { authorization: 'Bearer ' + tok } : {} }); const d = await r.json(); return d?.ok ? { ...d, tok } : null; } catch { return null; }
  }
  // "직접 가서 보기": the board alone on its screen for a minute, the avatar in front of it, the camera on it, fireworks.
  async function land(id) {
    const d = st.list.find((g) => g.id === id) ? { gift: st.list.find((g) => g.id === id) } : await fetchGift(id);
    const g = d?.gift;
    if (!g) { note('없어졌거나 가려진 선물 전광판이에요', 'err'); return; }
    const t = Date.now(), phase = g.phase || (t >= g.b ? 'after' : t >= g.a ? 'live' : 'before'); // the world's copy has no phase: it is live by being there
    if (phase !== 'live') { note(phase === 'after' ? '이 선물 전광판은 광장에서 내려왔어요' : `이 선물 전광판은 ${windowText(g.a, g.b)}에 걸려요`, 'ok', () => { location.href = '/g/' + id; }); return; }
    whenBuilt(() => {
      const slot = world?.pinGift?.(g, 60000);
      if (!slot) { note('지금은 이 전광판을 보여 줄 화면이 비어 있지 않아요', 'err'); return; }
      world.goToSlot?.(slot);
      world.focusSlot?.(slot, { hold: 0, celebrate: false });
      setTimeout(() => world.cheerAt?.(slot), 900); // fireworks around the face (giftPop's bursts sit on it and hide the words)
      note(`🎁 ${g.to}님을 위한 선물 전광판이에요!`, 'ok');
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
      const line = (g.to || '당신') + '님을 위한 전광판이 켜졌어요';
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
      let ts = ''; try { ts = await (await import('./human.js?v=202611230850')).humanToken(String(d.site), { action: 'gvid' }); } catch { ts = ''; }
      if (ts) ({ s, d } = await send(ts));
    }
    return d || { ok: false };
  }

  // ?gb=<id> (and &rec=1): after entering. True when it took the arrival (main.js then skips its intro and tutorial).
  const q = new URLSearchParams(location.search), GB = GIFT_ID.test(q.get('gb') || '') ? q.get('gb') : '', REC = q.get('rec') === '1';
  function arrive() {
    if (!GB) return false;
    try { const u = new URL(location.href); u.searchParams.delete('gb'); u.searchParams.delete('rec'); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch { /* keep the address */ }
    if (REC) record(GB); else land(GB);
    setTimeout(() => introDone?.(), 700);
    return true;
  }
  return {
    arrive, open: openMaker,
    apply(list) { st.list = Array.isArray(list) ? list : []; world?.setGifts?.(st.list); },
  };
}
