async function bearer() {
  try {
    const { doToken } = await import('./net.js?v=202611212346');
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

export function setSpecies(id) {
  const n = Math.floor(Number(id));
  return n === 2 || n === 3 ? n : 1;
}

export async function loadProfile() {
  const r = await fetch('/rt/profile', { headers: { authorization: 'Bearer ' + await bearer() } });
  return r.json();
}

export async function equip(cosmeticId) {
  const r = await fetch('/rt/equip', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await bearer() },
    body: JSON.stringify({ cosmetic_id: cosmeticId }),
  });
  return r.json();
}

export async function saveNick(name) {
  const nickname = Array.from(String(name || '')).slice(0, 16).join('').trim();
  if (!nickname) throw new Error('이름을 적어 주세요');
  const r = await fetch('/rt/profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await bearer() },
    body: JSON.stringify({ nickname }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) throw new Error(data.error || '이름을 저장하지 못했어요');
  return data;
}

export async function saveColor(color) {
  const hex = String(color || '').trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(hex)) throw new Error('색을 고르지 못했어요');
  const r = await fetch('/rt/profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await bearer() },
    body: JSON.stringify({ color: hex }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) throw new Error(data.error || '색을 저장하지 못했어요');
  return data;
}

export async function saveSpecies(id) {
  const species = setSpecies(id);
  const r = await fetch('/rt/profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await bearer() },
    body: JSON.stringify({ species }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) throw new Error(data.error || '캐릭터를 저장하지 못했어요');
  return data;
}
