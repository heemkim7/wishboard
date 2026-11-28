import { slotName, josa } from './balance.js';
import { CHEER_PHRASES } from './plaza-account.js';

async function bearer() {
  try {
    const { doToken } = await import('./net.js?v=202611280944');
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
  taken: (m) => `${m.from_name || '누군가'}님이 ${josa(slotName(m.slot_id), '에', '에')} 새로 걸었어요`, // rows from before takeovers ended (no new ones)
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
  tribe: () => '지난 소속 결과가 나왔어요',
  ball: () => '21시 볼 드랍이 곧 시작돼요',
};

export function applyInboxPush(msg) {
  return (COPY[msg?.kind] || (() => ''))(msg);
}

// Rows the server already marked read (POST /rt/inbox/read from any device). inbox_list sends no read_at but orders unread
// first, each part newest first: the first row newer than the one before it starts the read part. When every unread row is
// newer than every read one there is no such row and nothing is known. A read_at or read:true on a row is used as it is.
export function serverRead(items) {
  const list = Array.isArray(items) ? items : [];
  const out = new Set();
  let from = list.length;
  for (let i = 1; i < list.length; i++) {
    if (Date.parse(list[i]?.created_at || '') > Date.parse(list[i - 1]?.created_at || '')) { from = i; break; }
  }
  list.forEach((m, i) => {
    const id = Math.floor(Number(m?.id));
    if (id > 0 && (i >= from || m.read === true || m.read_at)) out.add(id);
  });
  return out;
}

// Live INBOX news of this session ({ kind, slot_id, at, ... }) whose stored row has not come back yet (the room writes the
// inbox with its coin flush, about 30 s later): no stored row of the same kind and board within win ms of it.
export function liveOnly(live, items, win = 5 * 60e3) {
  const rows = Array.isArray(items) ? items : [];
  return (Array.isArray(live) ? live : []).filter((n) => !rows.some((m) => m?.kind === n.kind && String(m?.slot_id || '') === String(n.slot_id || '')
    && Math.abs(Date.parse(m?.created_at || '') - n.at) <= win));
}

// 다녀간 사이 rows handled without being shown: only a taken board I hold again is marked read on the server. News counted
// as seen live stays read in this browser only, so the server row stays unread for the player's other devices.
export function handledRead(ids, items, holder, me) {
  const list = Array.isArray(ids) ? ids : [];
  const byId = new Map((Array.isArray(items) ? items : []).map((m) => [Math.floor(Number(m?.id)), m]));
  const server = list.filter((id) => {
    const m = byId.get(Math.floor(Number(id)));
    return !!(m && m.kind === 'taken' && me && typeof holder === 'function' && holder(String(m.slot_id || '')) === me);
  });
  return { server, local: list.slice() };
}
// A live line counts as seen only when it could be: not in newcomer mode (news line and 🔔 hidden) and in a visible tab.
export function liveSeeable(newbie, visibility) { return !newbie && visibility === 'visible'; }

export async function loadInbox() {
  const r = await fetch('/rt/inbox', { headers: { authorization: 'Bearer ' + await bearer() } });
  const data = await r.json().catch(() => ({ items: [] }));
  const items = Array.isArray(data.items) ? data.items.slice(0, 20) : [];
  const read = serverRead(items);
  return items.map((m) => (read.has(Math.floor(Number(m?.id))) ? { ...m, read: true } : m));
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
