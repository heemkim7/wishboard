export const SFX = Object.freeze(['click', 'hit', 'crit', 'miss', 'star', 'coin', 'fanfare', 'honk', 'tick', 'shutter', 'news', 'bump', 'engine', 'pickup', 'cash', 'whoosh', 'jackpot', 'drum', 'siren', 'boost']);
export const MUSIC = Object.freeze(['plaza', 'drive', 'night']);

let tones = null;
const busy = new Set();
let music = null;
let musicId = '';

export function bindSfx(map) {
  tones = map || null;
}

export function play(name) {
  if (!SFX.includes(name)) return false;
  if (busy.has(name)) return false;
  if (name === 'boost') haptic(40);
  if (typeof Audio !== 'function') return true;
  busy.add(name);
  const audio = new Audio('assets/audio/sfx/' + name + '.ogg');
  let settled = false;
  const finish = (ok) => {
    if (settled) return;
    settled = true;
    if (!ok) {
      const fn = tones?.[name];
      if (typeof fn === 'function') fn();
    }
    busy.delete(name);
  };
  audio.addEventListener('error', () => finish(false), { once: true });
  const pending = audio.play();
  if (pending && typeof pending.then === 'function') pending.then(() => finish(true)).catch(() => finish(false));
  else finish(true);
  return true;
}

export function startMusic(id) {
  if (!MUSIC.includes(id)) return '';
  const src = 'assets/audio/' + id + '.ogg';
  if (typeof Audio === 'function' && musicId !== id) {
    if (music) {
      music.pause();
      music.removeAttribute('src');
      try { music.load(); } catch { /* already released */ }
    }
    music = new Audio(src);
    music.loop = true;
    music.volume = 0.35;
    const pending = music.play();
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    musicId = id;
  }
  return src;
}

export function haptic(ms, nav = globalThis.navigator) {
  const n = Math.floor(Number(ms));
  if (!Number.isInteger(n) || n < 1 || n > 200) return false;
  if (typeof nav?.vibrate === 'function') nav.vibrate(n);
  return true;
}
