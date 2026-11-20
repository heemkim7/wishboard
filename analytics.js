import { EVENT_NAMES, GT_LS, SESSION_LS } from './plaza-account.js';

// Each major event goes to POST /rt/event with a session id (this tab) and, when one exists, the account's token:
// the Supabase session when signed in, else the guest token. The Worker derives the account from the token and stores
// the event for the admin readout (visitors, new and returning, day-1/7/30 return, session length, funnel).
// Nothing here asks for a token. page_landing fires before net.js has one, so events wait up to 3 s for it, then go out without.
const MAJOR = new Set(EVENT_NAMES);
const mem = {};
function ss(key, value) {
  try {
    if (value === undefined) return sessionStorage.getItem(key) || '';
    sessionStorage.setItem(key, value);
  } catch {
    if (value === undefined) return mem[key] || '';
    mem[key] = value;
  }
  return value;
}
function sid() {
  return ss('kts_sid') || ss('kts_sid', (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 24));
}
function token() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_LS) || 'null');
    if (s?.access_token && s.expires_at * 1000 > Date.now() + 5000) return s.access_token;
  } catch { /* fall through to the guest */ }
  try {
    const g = JSON.parse(localStorage.getItem(GT_LS) || 'null');
    if (g?.token && g.exp * 1000 > Date.now()) return g.token;
  } catch { /* no account yet */ }
  return '';
}
function post(ev) {
  const tok = token();
  const headers = { 'content-type': 'application/json' };
  if (tok) headers.authorization = 'Bearer ' + tok;
  try {
    fetch('/rt/event', { method: 'POST', headers, body: JSON.stringify(ev), keepalive: true }).catch(() => {});
  } catch { /* offline */ }
}
const held = [];
let heldAt = 0, timer = 0;
function drain(force) {
  if (!held.length || (force !== true && !token() && Date.now() - heldAt < 3000)) return;
  clearInterval(timer);
  timer = 0;
  for (const ev of held.splice(0)) post(ev);
}
function send(name, p) {
  const ev = { name, sid: sid(), p };
  if (!held.length && token()) { post(ev); return; }
  if (!held.length) heldAt = Date.now();
  held.push(ev);
  if (!timer) timer = setInterval(drain, 300);
}

// first_coin: once per session, on the first coin the player earns by playing (net.js emits 'earn').
let hooked = false;
function hook() {
  const net = window.G?.net;
  if (hooked || !net?.on) return;
  hooked = true;
  net.on('earn', () => {
    if (ss('kts_ev_coin')) return;
    ss('kts_ev_coin', '1');
    trackEvent('first_coin');
  });
}

// session_end: seconds this tab was visible, sent when it is hidden or closed. The server keeps the largest value per session.
let shownAt = Date.now(), shown = (Number(ss('kts_dur')) || 0) * 1000, sentDur = -1;
function leave() {
  if (shownAt) { shown += Date.now() - shownAt; shownAt = 0; }
  const dur = Math.round(shown / 1000);
  if (ss('kts_sid') && dur >= sentDur + 15) {
    sentDur = dur;
    ss('kts_dur', String(dur));
    send('session_end', { dur });
  }
  drain(true);
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leave();
    else if (!shownAt) shownAt = Date.now();
  });
  window.addEventListener?.('pagehide', leave);
}

export function trackEvent(eventName, params) {
  const name = String(eventName || '');
  const extra = params && typeof params === 'object' ? params : {};
  try {
    if (typeof window.gtag === 'function') window.gtag('event', name, extra);
    if (typeof window.clarity === 'function') window.clarity('event', name);
  } catch { /* analytics must not break play */ }
  if (!MAJOR.has(name)) return;
  hook();
  send(name, extra);
}
