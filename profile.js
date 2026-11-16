function bearer() {
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
  const r = await fetch('/rt/profile', { headers: { authorization: 'Bearer ' + bearer() } });
  return r.json();
}

export async function equip(cosmeticId) {
  const r = await fetch('/rt/equip', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + bearer() },
    body: JSON.stringify({ cosmetic_id: cosmeticId }),
  });
  return r.json();
}

export async function saveSpecies(id) {
  const species = setSpecies(id);
  const r = await fetch('/rt/profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + bearer() },
    body: JSON.stringify({ species }),
  });
  return r.json();
}
