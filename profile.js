async function bearer() {
  try {
    const { doToken } = await import('./net.js?v=202611221059');
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

// Species ids 1..10 (ts3d/avatars.js SPECIES; kept here as a number so this module loads without three.js). Anything else is 1.
export const SPECIES_MAX = 10;
export function setSpecies(id) {
  const n = typeof id === 'number' ? id : typeof id === 'string' && /^\s*\d{1,2}\s*$/.test(id) ? Number(id) : NaN; // a number, or digits from storage or JSON
  return Number.isInteger(n) && n >= 1 && n <= SPECIES_MAX ? n : 1;
}

// The species a GET /rt/profile answer leaves this device with. Before migrations/2026-11-22-species.sql the database stores 1 for a choice
// of 4..10; the Worker answers the choice from its account registry, and when it could not ask (hard budget, a failed call) it says
// species_sure: false. Only then, and only against an answer of 1, does this device's own choice of 4..10 stand.
export function profileSpecies(p, local) {
  const got = setSpecies(p?.species), mine = setSpecies(local);
  return p?.species_sure === false && got === 1 && mine > 3 ? mine : got;
}

// local: this device's species, sent as a hint (?sp=). The Worker asks its account registry for a clamped choice of 4..10 only when the
// database answers 1 and the hint is missing or above 3: a device on 1..3 has no such choice to recover, so its reads cost no registry call.
export async function loadProfile(local) {
  const sp = local == null ? '' : '?sp=' + setSpecies(local);
  const r = await fetch('/rt/profile' + sp, { headers: { authorization: 'Bearer ' + await bearer() } });
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
