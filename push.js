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
  if (typeof Notification === 'undefined' || !navigator.serviceWorker) return { ok: false, hint: '이 브라우저는 알림을 지원하지 않아요. 크롬이나 엣지로 여세요.' };
  if (Notification.permission === 'denied') return { ok: false, hint: '알림이 차단돼 있어요. 주소창 왼쪽 자물쇠에서 알림을 허용한 뒤 다시 누르세요.' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, hint: '브라우저에 뜬 알림 창에서 허용을 눌러 주세요. PC에서도 됩니다.' };
  const reg = await navigator.serviceWorker.ready;
  const key = await fetch('/rt/push/key').then((r) => r.json());
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key.k });
  const json = sub.toJSON();
  const res = await fetch('/rt/push', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + bearer() }, body: JSON.stringify({ s: json }) });
  if (!res.ok) return { ok: false, hint: '알림 등록이 서버에서 거절됐어요. 입장한 뒤에 다시 눌러 주세요.' };
  return { ok: true, hint: '이 브라우저에 구독을 저장했어요. 빼앗김·불 꺼짐 알림은 서버 발송이 켜진 뒤에 도착합니다.' };
}
