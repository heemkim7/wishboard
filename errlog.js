// Browser error reports (launch plan 상1). main.js imports this module first, so it is evaluated before the rest of the game and its two
// listeners (error, unhandledrejection) are on before any other module runs. A report is POST /rt/err with the message, file:line:col, the
// top five stack frames, the build id, the page path, the quality tier, touch yes/no and the browser family. Nothing that names a person: no
// nickname, no account id, no address query, no token (opsrules.js scrub runs on every text field here and again in the Worker).
// Limits: five reports per page load, the same message once, one in five while the budget is lean. It never throws and never waits.
import { ERR, line, pathOf, scrub, srcOf, stackOf, uaFamily } from './opsrules.js';

const BUILD = (() => { try { return new URL(import.meta.url).searchParams.get('v') || ''; } catch { return ''; } })();
const EXT = /\b(?:chrome|moz|safari|safari-web|ms-browser)-extension:/i;
// Noise with nothing to act on: an opaque cross-origin "Script error.", the ResizeObserver notice, a cancelled fetch.
const QUIET = /^(?:Unhandled rejection: )?(?:Script error\.?|ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)\.?)$|^(?:Unhandled rejection: )?AbortError\b/i;

// The top frame's file:line:col from a stack ('at f (https://x/ui.js?v=1:12:34)', 'f@https://x/ui.js:12:34').
export function topFrame(stack) {
  const m = String(stack || '').match(/((?:[a-z][\w+.-]*:\/\/)?[^\s()@]+\.m?js[^\s():]*):(\d+):(\d+)/i);
  return m ? { file: m[1], line: Number(m[2]), col: Number(m[3]) } : null;
}

// One report from what a listener saw, or null when there is nothing to send (noise, an extension's own error, no message).
// info: { message, file, line, col, stack }; page: { path, tier, touch, ua }.
export function reportOf(info, page = {}) {
  const raw = String(info?.message ?? '').trim();
  if (!raw || QUIET.test(raw)) return null;
  if (EXT.test(String(info?.file || '')) || EXT.test(String(info?.stack || '').split('\n').slice(0, 3).join('\n'))) return null;
  const top = info?.file ? null : topFrame(info?.stack);
  return {
    m: line(scrub(raw), ERR.msg),
    s: srcOf(info?.file || top?.file || '', info?.line || top?.line, info?.col || top?.col),
    k: stackOf(info?.stack),
    b: /^\d{8,14}[a-z]?$/.test(String(page.build ?? BUILD)) ? String(page.build ?? BUILD) : '',
    p: pathOf(page.path || '/'),
    q: ['high', 'medium', 'low', 'auto'].includes(page.tier) ? page.tier : '',
    t: page.touch ? 1 : 0,
    ua: page.ua || '',
  };
}

// The limits, apart from the browser so a test can drive them. send(json) delivers; rand() decides the lean sample.
export function createReporter({ send, rand = Math.random, page = () => ({}) } = {}) {
  const st = { sent: 0, seen: new Set(), lean: false, tier: '' };
  return {
    state: st,
    ctx(o = {}) { if (typeof o.tier === 'string') st.tier = o.tier; if ('lean' in o) st.lean = !!o.lean; },
    report(info) {
      try {
        if (st.sent >= ERR.perLoad) return false;
        const p = { ...page(), tier: st.tier || page().tier || '' };
        const r = reportOf(info, p);
        if (!r) return false;
        const key = r.m + '|' + r.s;
        if (st.seen.has(key)) return false;
        st.seen.add(key);
        if (st.lean && !(rand() < ERR.leanRate)) return false;
        st.sent++;
        send(JSON.stringify(r));
        return true;
      } catch { return false; }
    },
  };
}

function beacon(json) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/rt/err', new Blob([json], { type: 'text/plain' }))) return;
  } catch { /* fall through to fetch */ }
  try { fetch('/rt/err', { method: 'POST', body: json, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => { }); } catch { /* never block the game */ }
}
function pageNow() {
  let touch = false;
  try { touch = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints || 0) > 0; } catch { }
  return { path: typeof location !== 'undefined' ? location.pathname : '/', touch, ua: uaFamily(typeof navigator !== 'undefined' ? navigator.userAgent : '') };
}

const reporter = createReporter({ send: beacon, page: pageNow });
// main.js tells the quality tier once the world is built and whether the entry gate said the budget is lean.
export function errlogCtx(o) { reporter.ctx(o); }

export function installErrlog(win = typeof window !== 'undefined' ? window : null) {
  if (!win?.addEventListener || win.__ktsErrlog) return false;
  win.__ktsErrlog = 1;
  win.addEventListener('error', (ev) => {
    if (ev?.target && ev.target !== win && ev.target.nodeType) return; // a failed <img>/<script> load: not a script error
    reporter.report({ message: ev?.message || ev?.error?.message, file: ev?.filename, line: ev?.lineno, col: ev?.colno, stack: ev?.error?.stack });
  });
  win.addEventListener('unhandledrejection', (ev) => {
    const r = ev?.reason;
    const message = r instanceof Error ? `${r.name}: ${r.message}` : typeof r === 'string' ? r : r && typeof r.message === 'string' ? r.message : '';
    reporter.report({ message: message ? 'Unhandled rejection: ' + message : '', stack: r?.stack });
  });
  return true;
}
installErrlog();
