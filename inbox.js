function bearer() {
  const raw = localStorage.getItem('masil_gt') || '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.token === 'string') return parsed.token;
  } catch { /* already a raw token */ }
  return raw;
}

const COPY = {
  taken: (m) => `${m.from_name}님이 ${m.slot_id}을 가져갔어요`,
  cheer: (m) => `응원 ${m.phrase}번이 도착했어요`,
  dark: (m) => `${m.slot_id} 불이 곧 꺼져요`,
  gift: (m) => `${m.from_name}님이 전광판을 선물했어요`,
  tribe: () => '이번 주 소속 결과가 나왔어요',
  ball: () => '21시 볼 드랍이 곧 시작돼요',
};

export function applyInboxPush(msg) {
  return (COPY[msg?.kind] || (() => ''))(msg);
}

export async function loadInbox() {
  const r = await fetch('/rt/inbox', { headers: { authorization: 'Bearer ' + bearer() } });
  const data = await r.json().catch(() => ({ items: [] }));
  return Array.isArray(data.items) ? data.items.slice(0, 20) : [];
}

export async function readInbox(ids) {
  const list = (Array.isArray(ids) ? ids : []).map((id) => Math.floor(Number(id))).filter((id) => Number.isInteger(id) && id > 0).slice(0, 20);
  if (!list.length) return;
  await fetch('/rt/inbox/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + bearer() },
    body: JSON.stringify({ ids: list }),
  });
}
