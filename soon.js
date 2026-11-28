// 출시 예정 (soonrules.js): the four coming features as quiet cards with one button each, "이 기능에 관심 있어요". The same block on the
// gift owner page (giftpage.js: right after making a board, else under 더 보기), on /discover (#soon, the boot card's small link) and in
// the plaza's sheet after a board was hung (ui.js). Browser only; its own small stylesheet over the pages' shared tokens (--surface,
// --line, --text, --accent, --r).
//
// What goes to the server (POST /rt/gift/soon, giftsrv.js soonSeen): 'imp' once per page view and feature when its card is half on screen
// (IntersectionObserver; the cards that come in together go in one request), 'tap' at every press of the button. The person is the
// account or guest this browser already is (its token, never a new guest for this), else the gift pages' random browser id (kts_gv).
// Nothing else: no contact, no notice. This browser remembers what it registered (kts_soon), so the button stays "관심 담음".
import { SOON, SOON_LABEL, SOON_BTN, SOON_DONE, SOON_THANKS, SOON_BUSY, SOON_HEAD, SOON_INTRO, SOON_FREE, SOON_SRC } from './soonrules.js';
import { icon } from './uiicons.js?v=202611280944';

const KEY = 'kts_soon';
const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
const json = (k, d) => { try { return JSON.parse(ls.get(k) || '') ?? d; } catch { return d; } };
const mineAll = () => { const o = json(KEY, {}); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; };
export const soonMine = (f) => !!mineAll()[f];
const keep = (f, on = true) => { const o = mineAll(); if (on) o[f] = 1; else delete o[f]; ls.set(KEY, JSON.stringify(o)); };

// The plaza's own identity, read only: a live signed-in session, else the guest token (masil_gt) while it is good.
const AUTH_KEYS = ['maeul_auth', 'sb-yxddhpacuyaffaoutxjn-auth-token'];
function tokenNow() {
  for (const k of AUTH_KEYS) { const j = json(k, null), s = j?.currentSession || j; if (s?.access_token && Number(s.expires_at) * 1000 > Date.now() + 60000) return String(s.access_token); }
  const g = json('masil_gt', null);
  return g?.token && Number(g.exp) * 1000 > Date.now() + 60000 ? String(g.token) : '';
}
const visitor = () => { let v = ls.get('kts_gv'); if (!/^[0-9a-f]{16}$/.test(v || '')) { const b = new Uint8Array(8); crypto.getRandomValues(b); v = [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); ls.set('kts_gv', v); } return v; };
async function send(body) {
  const tok = tokenNow();
  try {
    const r = await fetch('/rt/gift/soon', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) });
    return await r.json().catch(() => ({ ok: r.ok }));
  } catch { return null; }
}

const CSS = `
.soon { margin: 12px 0; text-align: left; }
.soon .soon-h { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font-size: 16px; font-weight: 900; line-height: 1.3; color: var(--text); letter-spacing: -0.02em; }
.soon .soon-intro { margin: 0 0 2px; font-size: 13px; line-height: 1.5; color: var(--text-2); }
.soon .soon-free { margin: 0 0 10px; font-size: 12px; line-height: 1.5; color: var(--muted); }
.soon .soon-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
.soon .soon-card { min-width: 0; display: flex; flex-direction: column; gap: 6px; padding: 12px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r, 4px); }
.soon .soon-top { display: flex; align-items: flex-start; gap: 8px; }
.soon .soon-top .ico { flex: none; width: 22px; height: 22px; margin-top: 1px; fill: none; stroke: var(--accent); stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.soon .soon-name { flex: 1; min-width: 0; font-size: 15px; font-weight: 900; line-height: 1.35; color: var(--text); word-break: keep-all; }
.soon .soon-tag { flex: none; padding: 1px 6px; border: 1px solid var(--line-strong, #444); border-radius: var(--r, 4px); font-size: 11px; font-weight: 700; line-height: 1.5; color: var(--muted); white-space: nowrap; }
.soon .soon-line { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-2); word-break: keep-all; }
.soon .soon-btn { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; margin-top: 2px; padding: 0 14px; border: 1px solid var(--line-strong, #444); border-radius: var(--r, 4px); background: var(--surface-2); color: var(--text); font: inherit; font-size: 14px; font-weight: 800; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.soon .soon-btn .ico { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.soon .soon-btn:not(:disabled):active { background: var(--surface); }
.soon .soon-btn:focus-visible { outline: 2px solid var(--info, #48d6f0); outline-offset: 2px; }
.soon .soon-btn:disabled { cursor: default; opacity: 1; }
.soon .soon-btn[aria-pressed=true] { background: transparent; border-color: rgba(255,176,32,.5); color: var(--accent); }
.soon .soon-msg { margin: 0; font-size: 12px; font-weight: 700; line-height: 1.5; color: var(--ok, #36d67e); }
.soon .soon-msg.err { color: var(--muted); }
.soon .soon-msg:empty { display: none; }
`;
function style() {
  if (typeof document === 'undefined' || document.getElementById('soon-css')) return;
  const s = document.createElement('style'); s.id = 'soon-css'; s.textContent = CSS; (document.head || document.documentElement).append(s);
}
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

// The features whose card was on screen in this page view (this module lives as long as the page): the owner page built again after a
// 💖 or a delete, 더 보기 opened, the plaza sheet opened twice: one impression each, as soonrules.js counts them. Kept per document (a
// page view has one), so a module shared by several documents (the tests' pages) keeps theirs apart.
const PV = new WeakMap();
const seenNow = () => { const d = typeof document === 'object' && document ? document : PV; let s = PV.get(d); if (!s) PV.set(d, (s = new Set())); return s; };
// The block. src: where it stands (SOON_SRC); heading: false when the place has its own (the plaza sheet's title); id: the section's id.
export function soonBlock({ src, heading = true, id = '' } = {}) {
  style();
  const s = SOON_SRC.includes(src) ? src : 'soon';
  const box = el('section', 'soon'); if (id) box.id = id;
  box.setAttribute('aria-label', SOON_HEAD);
  if (heading) box.append(el('h2', 'soon-h', SOON_HEAD));
  box.append(el('p', 'soon-intro', SOON_INTRO), el('p', 'soon-free', SOON_FREE));
  const list = el('ul', 'soon-list');
  // Impressions: once per page view and feature (seenNow, over every block and every block built again); the cards that come into view
  // together go in one request.
  const seen = seenNow(); let wait = new Set(), timer = 0;
  const flush = () => { timer = 0; const fs = [...wait]; wait = new Set(); if (fs.length) send({ a: 'imp', f: fs, s }); };
  const saw = (f) => { if (seen.has(f)) return; seen.add(f); wait.add(f); if (!timer) timer = setTimeout(flush, 400); };
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { saw(e.target.getAttribute('data-f')); io.unobserve(e.target); } }, { threshold: 0.5 })
    : null;
  for (const F of SOON) {
    const card = el('li', 'soon-card'); card.setAttribute('data-f', F.id);
    const top = el('div', 'soon-top'), ic = icon(F.icon); if (ic) top.append(ic);
    top.append(el('b', 'soon-name', F.name), el('span', 'soon-tag', SOON_LABEL));
    const btn = el('button', 'soon-btn'); btn.type = 'button';
    const msg = el('p', 'soon-msg'); msg.setAttribute('role', 'status');
    const paint = () => {
      const on = soonMine(F.id), ic2 = on ? icon('check') : null;
      btn.replaceChildren(...(ic2 ? [ic2] : []), on ? SOON_DONE : SOON_BTN);
      btn.setAttribute('aria-pressed', String(on)); btn.disabled = on;
      btn.setAttribute('aria-label', on ? F.name + ' · ' + SOON_DONE : F.name + ' · ' + SOON_BTN);
    };
    // Shown as registered at once (the answer can take a few seconds); a refused or lost one comes back to press again, and says so.
    btn.addEventListener('click', async () => {
      if (btn.disabled || soonMine(F.id)) return;
      keep(F.id); paint(); msg.className = 'soon-msg'; msg.textContent = SOON_THANKS;
      const r = await send({ a: 'tap', f: F.id, s, v: visitor() });
      if (r?.ok && (r.kept || r.test)) return;
      keep(F.id, false); paint(); msg.className = 'soon-msg err'; msg.textContent = SOON_BUSY;
    });
    paint();
    card.append(top, el('p', 'soon-line', F.line), btn, msg);
    list.append(card);
    if (io) io.observe(card); else saw(F.id); // no observer: built is seen
  }
  box.append(list);
  return box;
}
