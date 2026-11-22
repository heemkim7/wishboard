// The real actor's token (guest or signed-in user), the same way profile.js and inbox.js get it; the stored guest token is the fallback.
async function bearer() {
  try {
    const { doToken } = await import('./net.js?v=202611221059');
    const tok = await doToken();
    if (tok) return tok;
  } catch { /* node tests have no session */ }
  let raw = '';
  try { raw = localStorage.getItem('masil_gt') || ''; } catch { raw = ''; }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.token === 'string') return parsed.token;
  } catch { /* already a raw token */ }
  return raw;
}

// What the server sends right away (worker.js pushNow: taken, wish, wishwin).
export const PUSH_DONE = '알림을 켰어요. 전광판을 빼앗기거나 내 소원에 하트가 오면 알려 드려요.';

export function installHint(env) {
  if (env?.ios && !env?.standalone) return '홈 화면에 추가한 뒤 이 버튼을 누르세요';
  return '';
}

export async function subscribePush() {
  const hint = installHint({
    ios: /iPhone|iPad/.test(navigator.userAgent),
    standalone: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  });
  if (hint) return { ok: false, hint };
  if (typeof Notification === 'undefined' || !navigator.serviceWorker) return { ok: false, hint: '이 브라우저는 알림을 지원하지 않아요. 크롬이나 엣지로 여세요.' };
  if (Notification.permission === 'denied') return { ok: false, hint: '알림이 차단돼 있어요. 주소창 왼쪽 자물쇠에서 알림을 허용한 뒤 다시 누르세요.' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, hint: '브라우저에 뜬 알림 창에서 허용을 눌러 주세요. PC에서도 됩니다.' };
  const reg = await navigator.serviceWorker.ready;
  const key = await fetch('/rt/push/key').then((r) => r.json());
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key.k });
  const json = sub.toJSON();
  const res = await fetch('/rt/push', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await bearer() }, body: JSON.stringify({ s: json }) });
  if (!res.ok) return { ok: false, hint: '알림 등록이 서버에서 거절됐어요. 입장한 뒤에 다시 눌러 주세요.' };
  return { ok: true, hint: PUSH_DONE };
}

// Subscriptions made before the immediate pushes only live in Supabase, so once per session an already allowed
// subscription is posted again (silently; no permission prompt, no UI). Resolves true when the server took it.
// env.force: post it now even if this session already did. The server binds an endpoint to whoever posts it (POST /rt/push
// replaces the actor), so after a sign-out this is what moves the subscription from the account to the new guest.
export async function resendPush(env = {}) {
  const N = 'Notification' in env ? env.Notification : globalThis.Notification;
  const nav = 'navigator' in env ? env.navigator : globalThis.navigator;
  const ss = 'session' in env ? env.session : (() => { try { return globalThis.sessionStorage; } catch { return null; } })();
  const send = env.fetch || globalThis.fetch;
  try {
    if (!N || N.permission !== 'granted' || !nav?.serviceWorker) return false;
    if (!env?.force && ss?.getItem?.('kts_push_resent') === '1') return false;
    const reg = await Promise.race([
      nav.serviceWorker.getRegistration ? nav.serviceWorker.getRegistration() : nav.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    const sub = await reg?.pushManager?.getSubscription?.();
    if (!sub) return false;
    try { ss?.setItem?.('kts_push_resent', '1'); } catch { /* private mode: at most once per page anyway */ }
    const tok = env.token || await bearer();
    if (!tok) return false;
    const res = await send('/rt/push', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ s: sub.toJSON() }) });
    return !!res?.ok;
  } catch { return false; }
}
