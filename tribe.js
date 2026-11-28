// 소속 모금 (pledge) is closed: 응원 포인트 are never pooled or sent (worker.js NO_POOL).
export function sendCheer(slot, phraseId) {
  const p = Math.floor(Number(phraseId));
  if (p < 1 || p > 12) return null;
  if (!/^(MAIN_|SUB_|STREET_|PLOT_)/.test(String(slot || ''))) return null;
  return { t: 'CHEER', slot: String(slot), p };
}
// 선물 전광판 응원: the gift board's id (giftrules.js GIFT_ID), no slot (worker.js Room.cheerGift judges the board, not the screen).
export function sendGiftCheer(id, phraseId) {
  const p = Math.floor(Number(phraseId));
  if (p < 1 || p > 12) return null;
  if (!/^[0-9a-z]{8}$/.test(String(id || ''))) return null;
  return { t: 'CHEER', g: String(id), p };
}

export function openTribe() {
  return { create(tag) { return { tag: String(tag || '').replace(/^#/, '').slice(0, 16) }; } };
}
