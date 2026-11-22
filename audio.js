export const SFX = Object.freeze(['click', 'hit', 'crit', 'miss', 'star', 'coin', 'fanfare', 'honk', 'tick', 'shutter', 'news', 'bump', 'engine', 'pickup', 'cash', 'whoosh', 'jackpot', 'drum', 'siren', 'boost']);
export const MUSIC = Object.freeze(['plaza', 'drive', 'night']);

let tones = null;
const busy = new Set();
let music = null;
let musicId = '';
let wantId = '';
// The sound setting (ui.js 🔊, kts_sound): effects, music and vibration all follow it.
let soundOn = true;
// Files that failed to load this session (assets/audio is not shipped): never requested again; effects go straight to
// the synth tone, music to the synth track (bgm.js, bound by ui.js with bindMusic).
const failed = new Set();
// { start(id), stop(), duck(on) } or null. Plays a track whose file is missing.
let synth = null;

export function bindSfx(map) {
  tones = map || null;
}
/** The synth that plays a track when its file is missing (bgm.js createBgm). */
export function bindMusic(s) {
  synth = s && typeof s.start === 'function' ? s : null;
  if (synth && soundOn && wantId && failed.has('assets/audio/' + wantId + '.ogg')) synth.start(wantId);
}
/** Lower the music to nothing while another sound owns the room (the lounge chords, the dance track), and back. */
export function duckMusic(on) {
  synth?.duck?.(!!on);
  if (music) { try { music.volume = on ? 0 : 0.35; } catch { /* released */ } }
}

export function audioFailed(src) {
  return failed.has(String(src || ''));
}
export function markAudioFailed(src) {
  if (src) failed.add(String(src));
}

/** Sound on/off for effects, music and haptics. Turning it on starts the track asked for last; off pauses it. */
export function setSound(on) {
  soundOn = !!on;
  if (!soundOn) {
    if (music) { try { music.pause(); } catch { /* released */ } }
    synth?.stop?.();
    return;
  }
  if (wantId) {
    const id = wantId;
    if (music && musicId === id) musicVisible(!(typeof document !== 'undefined' && document.hidden));
    else startMusic(id);
  }
}
export function soundIsOn() { return soundOn; }

export function play(name) {
  if (!SFX.includes(name)) return false;
  if (!soundOn) return false;
  if (busy.has(name)) return false;
  if (name === 'boost') haptic(40);
  if (typeof Audio !== 'function') return true;
  const src = 'assets/audio/sfx/' + name + '.ogg';
  // Known missing: the synth tone now, no new request.
  if (failed.has(src)) return false;
  busy.add(name);
  const audio = new Audio(src);
  let settled = false;
  const finish = (ok) => {
    if (settled) return;
    settled = true;
    if (!ok) {
      failed.add(src);
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
  wantId = id;
  if (!soundOn) return src;
  // Known missing (or no <audio> at all): the synth plays it, no new request.
  if (failed.has(src) || typeof Audio !== 'function') { stopTrack(); synth?.start(id); return src; }
  if (musicId !== id) {
    stopTrack();
    synth?.stop?.();
    music = new Audio(src);
    music.loop = true;
    music.volume = 0.35;
    const el = music;
    el.addEventListener?.('error', () => { failed.add(src); if (music === el) { stopTrack(); if (soundOn && wantId === id) synth?.start(id); } }, { once: true });
    musicId = id;
  }
  if (typeof document !== 'undefined' && document.hidden) return src;
  const pending = music.play();
  if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  return src;
}
function stopTrack() {
  if (!music) return;
  try {
    music.pause();
    music.removeAttribute('src');
    music.load();
  } catch { /* already released */ }
  music = null;
  musicId = '';
}
/** The page went to the background (or came back): music pauses and resumes with it. */
export function musicVisible(on) {
  if (!music) return;
  if (!on) { try { music.pause(); } catch { /* released */ } return; }
  if (!soundOn) return;
  const p = music.play?.();
  if (p?.catch) p.catch(() => {});
}

export function haptic(ms, nav = globalThis.navigator) {
  const n = Math.floor(Number(ms));
  if (!Number.isInteger(n) || n < 1 || n > 200) return false;
  if (!soundOn) return false;
  if (typeof nav?.vibrate === 'function') nav.vibrate(n);
  return true;
}
