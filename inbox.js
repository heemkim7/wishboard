import { slotName } from './balance.js';
import { CHEER_PHRASES } from './plaza-account.js';

async function bearer() {
  try {
    const { doToken } = await import('./net.js?v=202611210015');
    const tok = await doToken();
    if (tok) return tok;
  } catch { /* node tests have no session */ }
  const raw = localStorage.getItem('masil_gt') || '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.token === 'string') return parsed.token;
  } catch { /* already a raw token */ }
  return raw;
}

const COPY = {
  taken: (m) => `${m.from_name || '누군가'}님이 ${slotName(m.slot_id)}을 가져갔어요`,
  cheer: (m) => {
    const phrase = CHEER_PHRASES[Math.floor(Number(m.phrase)) - 1] || '';
    const who = m.from_name || '누군가';
    return phrase ? `${who}님: ${phrase}` : `${who}님이 응원했어요`;
  },
  dark: (m) => Number(m.phrase) === 2 ? `${slotName(m.slot_id)} 불이 꺼졌어요` : `${slotName(m.slot_id)} 불이 곧 꺼져요`, // phrase 2: the at-dark notice
  reply: (m) => {
    const phrase = CHEER_PHRASES[Math.floor(Number(m.phrase)) - 1] || '';
    const who = m.from_name || '주인';
    return phrase ? `${who}님의 답례: ${phrase}` : `${who}님이 답례를 보냈어요`;
  },
  gift: (m) => `${m.from_name || '누군가'}님이 전광판을 선물했어요`,
  tribe: () => '이번 주 소속 결과가 나왔어요',
  ball: () => '21시 볼 드랍이 곧 시작돼요',
};

export function applyInboxPush(msg) {
  return (COPY[msg?.kind] || (() => ''))(msg);
}

export async function loadInbox() {
  const r = await fetch('/rt/inbox', { headers: { authorization: 'Bearer ' + await bearer() } });
  const data = await r.json().catch(() => ({ items: [] }));
  return Array.isArray(data.items) ? data.items.slice(0, 20) : [];
}

export async function readInbox(ids) {
  const list = (Array.isArray(ids) ? ids : []).map((id) => Math.floor(Number(id))).filter((id) => Number.isInteger(id) && id > 0).slice(0, 20);
  if (!list.length) return;
  await fetch('/rt/inbox/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await bearer() },
    body: JSON.stringify({ ids: list }),
  });
}
