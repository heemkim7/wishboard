export function pledge(slot, amount) {
  const n = Math.floor(Number(amount));
  if (n !== 10 && n !== 20 && n !== 50) return null;
  if (!/^(MAIN_(UP|TOP|MID|BOT|LOW)|SUB_[1-4][AB]|STREET_([1-9]|[12]\d|30)|PLOT_([1-9]|1[0-8]))$/.test(String(slot || ''))) return null;
  return { slot: String(slot), amount: n };
}

export function sendCheer(slot, phraseId) {
  const p = Math.floor(Number(phraseId));
  if (p < 1 || p > 12) return null;
  if (!/^(MAIN_|SUB_|STREET_|PLOT_)/.test(String(slot || ''))) return null;
  return { t: 'CHEER', slot: String(slot), p };
}

export function openTribe() {
  return { create(tag) { return { tag: String(tag || '').replace(/^#/, '').slice(0, 16) }; } };
}
