function bearer() {
  const raw = localStorage.getItem('masil_gt') || '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.token === 'string') return parsed.token;
  } catch { /* already a raw token */ }
  return raw;
}

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
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, hint: '' };
  const reg = await navigator.serviceWorker.ready;
  const key = await fetch('/rt/push/key').then((r) => r.json());
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key.k });
  const json = sub.toJSON();
  await fetch('/rt/push', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + bearer() }, body: JSON.stringify({ s: json }) });
  return { ok: true, hint: '' };
}
