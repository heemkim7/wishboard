// Turnstile human check before a new guest is minted (bot protection, docs/bot-protection.md). net.js imports this file only when the Worker
// asks for the check (403 { err:'human' }: both TURNSTILE_SITE and TURNSTILE_SECRET are set), so with the switches off nothing here loads and
// challenges.cloudflare.com is never contacted.
// The widget runs without showing anything (appearance interaction-only). A small card appears only while Cloudflare wants a tap, and after a
// failure, with a retry that reloads the page (a brand-new visitor has nothing to lose there). After a failure the page does not ask Cloudflare
// again by itself: every later token request gets '' at once, so a reconnect loop cannot keep starting challenges.
// The coin rewards (net.js humanCall: the held link reward, the share bonus, a VIP code) ask for tokens of their own action. Those are quiet: on a
// failure the card goes away and the caller says what happened; they never set the guest's failed state, and the guest's never stops them (each
// is asked by the player, or once per link). One widget at a time per page: a second action waits for the first to finish.
export const TS_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; // straight from Cloudflare: never proxied or cached
export const HUMAN_ACTION = 'guest'; // worker.js checks the token's action
export const HUMAN_ACTIONS = Object.freeze(['guest', 'link', 'bonus', 'code']); // worker.js: HUMAN_ACTION, and humanGate's for the rewards
export const HUMAN_TEXT = Object.freeze({
  tap: '사람인지 잠깐 확인할게요. 아래 상자를 눌러 주세요.',
  human: '사람인지 확인하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.',
  day: '오늘 이 인터넷 연결에서 새 손님이 너무 많이 들어왔어요. 계정이 있으면 로그인하거나 내일 다시 와 주세요.',
  rate: '새 손님이 잠깐 몰렸어요. 1분쯤 뒤에 다시 시도해 주세요.',
});
export const HUMAN_MS = Object.freeze({ load: 8000, run: 30000, tap: 180000 });
const STATE = new WeakMap(); // window -> { load, runs (action -> its check), tail (the last check, so they never overlap), failed, card }
const stateOf = (win) => { let s = STATE.get(win); if (!s) { s = { load: null, runs: new Map(), tail: Promise.resolve(), failed: false, card: null }; STATE.set(win, s); } return s; };
const env = (o = {}) => ({ doc: o.doc ?? (typeof document === 'undefined' ? null : document), win: o.win ?? (typeof window === 'undefined' ? null : window), ms: { ...HUMAN_MS, ...(o.ms || {}) } });

// The Turnstile API object, or null when the script cannot be loaded (blocked, offline, LOAD ms without an answer). One <script> per page.
export function loadTurnstile(opts = {}) {
  const { doc, win, ms } = env(opts);
  if (!doc || !win) return Promise.resolve(null);
  const st = stateOf(win);
  if (!st.load) st.load = new Promise((resolve) => {
    const api = () => (win.turnstile && typeof win.turnstile.render === 'function' ? win.turnstile : null);
    if (api()) { resolve(api()); return; }
    const s = doc.createElement('script');
    s.src = TS_SRC; s.async = true; s.defer = true;
    const t = setTimeout(() => resolve(api()), ms.load);
    s.onload = () => { clearTimeout(t); resolve(api()); };
    s.onerror = () => { clearTimeout(t); resolve(null); };
    (doc.head || doc.documentElement || doc.body).append(s);
  });
  return st.load;
}

// The card: fixed at the bottom, above everything, invisible (but laid out, so the widget inside can run) until it has something to say.
function cardOf(doc, st) {
  if (st.card) return st.card;
  const el = doc.createElement('div'), line = doc.createElement('p'), host = doc.createElement('div'), btn = doc.createElement('button');
  el.id = 'kts-human'; el.setAttribute?.('role', 'status'); el.setAttribute?.('aria-live', 'polite');
  el.style.cssText = 'position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:2147483000;'
    + 'width:min(340px,calc(100vw - 32px));box-sizing:border-box;padding:14px 16px;border-radius:16px;background:rgba(12,14,26,.95);color:#fff;'
    + 'font:14px/1.5 system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.45);'
    + 'opacity:0;pointer-events:none;transition:opacity .2s';
  line.style.cssText = 'margin:0 0 8px'; host.style.cssText = 'display:flex;justify-content:center;min-height:0';
  btn.type = 'button'; btn.hidden = true;
  btn.style.cssText = 'margin-top:8px;padding:8px 18px;border:0;border-radius:999px;background:#ffd34d;color:#141414;font:inherit;font-weight:700;cursor:pointer';
  el.append(line, host, btn);
  (doc.body || doc.documentElement).append(el);
  st.card = { el, line, host, btn };
  return st.card;
}
function show(c, text, button) {
  c.line.textContent = text;
  c.btn.hidden = !button; if (button) { c.btn.textContent = button.text; c.btn.onclick = button.click; }
  c.el.style.opacity = '1'; c.el.style.pointerEvents = 'auto';
}
function hide(c) { c.el.style.opacity = '0'; c.el.style.pointerEvents = 'none'; c.btn.hidden = true; }
const retry = (win) => ({ text: '다시 시도', click: () => { try { win.location.reload(); } catch { /* nothing else to do */ } } });

// Shows why a new guest was not made: 'human' (the check failed or the server refused its token: retry reloads), 'day' or 'rate' (a close button).
export function humanSay(code, opts = {}) {
  const { doc, win } = env(opts);
  if (!doc || !win) return;
  const st = stateOf(win), c = cardOf(doc, st), text = HUMAN_TEXT[code] || HUMAN_TEXT.human;
  if (code === 'human' || !HUMAN_TEXT[code]) { st.failed = true; show(c, text, retry(win)); }
  else show(c, text, { text: '닫기', click: () => hide(c) });
}

// A Turnstile token for `site`, or '' when there is none to be had. opts.action: one of HUMAN_ACTIONS (default 'guest'). One check at a time per
// page; parallel callers of the same action share it.
export function humanToken(site, opts = {}) {
  const { doc, win, ms } = env(opts), action = HUMAN_ACTIONS.includes(opts.action) ? opts.action : HUMAN_ACTION, guest = action === HUMAN_ACTION;
  if (!site || !doc || !win) return Promise.resolve('');
  const st = stateOf(win);
  if (guest && st.failed) { humanSay('human', { doc, win }); return Promise.resolve(''); }
  if (st.runs.has(action)) return st.runs.get(action);
  const run = st.tail.then(async () => {
    const ts = await loadTurnstile({ doc, win, ms });
    if (!ts) { if (guest) humanSay('human', { doc, win }); return ''; }
    const c = cardOf(doc, st);
    const tok = await new Promise((resolve) => {
      let done = false, id = null, timer = 0;
      const end = (t) => { if (done) return; done = true; clearTimeout(timer); try { if (id != null) ts.remove(id); } catch { /* already gone */ } resolve(typeof t === 'string' ? t : ''); };
      timer = setTimeout(() => end(''), ms.run);
      try {
        id = ts.render(c.host, {
          sitekey: site, action, appearance: 'interaction-only', retry: 'never', 'refresh-expired': 'never',
          size: Number(win.innerWidth) > 0 && Number(win.innerWidth) < 360 ? 'compact' : 'normal', // the 300 px box does not fit a 320 px phone
          callback: (t) => end(String(t || '')),
          'error-callback': () => { end(''); return true; }, // handled: the card says it
          'expired-callback': () => end(''), 'timeout-callback': () => end(''), 'unsupported-callback': () => end(''),
          'before-interactive-callback': () => { clearTimeout(timer); timer = setTimeout(() => end(''), ms.tap); show(c, HUMAN_TEXT.tap); },
          'after-interactive-callback': () => { c.line.textContent = ''; },
        });
      } catch { end(''); }
    });
    if (tok || !guest) hide(c); else humanSay('human', { doc, win });
    return tok;
  }).catch(() => '').finally(() => { if (st.runs.get(action) === run) st.runs.delete(action); });
  st.runs.set(action, run); st.tail = run;
  return run;
}
