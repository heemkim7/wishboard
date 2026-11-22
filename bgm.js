// Background music made in the browser: three original loops (plaza, drive, night) played by WebAudio oscillators and
// one noise buffer. No audio files: audio.js tries assets/audio/<id>.ogg first (none are shipped) and hands the track
// to this synth when the file fails. ui.js owns the AudioContext and binds the synth with bindMusic().
//
// Everything is scheduled a little ahead (LOOK seconds) on the context clock, so a suspended context (page hidden,
// ui.js suspends it) simply stops time and the loop carries on where it was. Notes are short-lived nodes; a bar of the
// busiest track (drive) makes about 35 of them.
//
// The pure parts (track table, note numbers, the bar plan) are exported for tests; createBgm needs an AudioContext.

export const LOOK = 0.3;          // seconds scheduled ahead
export const TICK_MS = 100;       // scheduler period
export const LEVEL = 0.42;        // music bus gain into the ui.js master (0.55): effects stay on top

export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// One bar = 16 sixteenth steps. chords: one per bar (MIDI note lists), bass: root per bar, scale: lead notes.
export const TRACKS = Object.freeze({
  // Late-night lo-fi on the square: Fmaj7 Em7 Dm7 Cmaj7, two bars each, swung hats, soft keys.
  plaza: Object.freeze({
    bpm: 84, swing: 0.16, cutoff: 2600, barsPerChord: 2,
    chords: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]],
    bass: [41, 40, 38, 36],
    scale: [72, 74, 76, 79, 81, 84],
    kick: [[0, 7, 10], [0, 3, 10]], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], openHat: [],
    bassSteps: [[0, 8], [10, 4]], keys: 'hold', arp: null, leadDensity: 0.32, leadSteps: [2, 6, 8, 11, 14],
  }),
  // In the cab: synthwave Am F C G, four on the floor, pulsing eighth bass and an arpeggio.
  drive: Object.freeze({
    bpm: 108, swing: 0, cutoff: 5200, barsPerChord: 1,
    chords: [[57, 60, 64, 69], [53, 57, 60, 65], [48, 52, 55, 60], [55, 59, 62, 67]],
    bass: [33, 29, 36, 31],
    scale: [69, 72, 74, 76, 79, 81],
    kick: [[0, 4, 8, 12]], snare: [4, 12], hat: [2, 6, 10, 14], openHat: [14],
    bassSteps: [[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]], keys: 'pad', arp: 2, leadDensity: 0.18, leadSteps: [0, 3, 6, 8, 12],
  }),
  // The ball drop / evening event: C G Am F, claps, bells.
  night: Object.freeze({
    bpm: 96, swing: 0.08, cutoff: 4200, barsPerChord: 1,
    chords: [[48, 52, 55, 60], [55, 59, 62, 67], [57, 60, 64, 69], [53, 57, 60, 65]],
    bass: [36, 31, 33, 29],
    scale: [72, 74, 76, 79, 81, 84, 86],
    kick: [[0, 8, 10], [0, 6, 8]], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], openHat: [6],
    bassSteps: [[0, 6], [6, 2], [8, 6], [14, 2]], keys: 'stab', arp: 4, leadDensity: 0.26, leadSteps: [0, 2, 4, 8, 10, 12],
  }),
});

export function stepSeconds(track) { return 60 / track.bpm / 4; }
export function loopBars(track) { return track.chords.length * track.barsPerChord; }

// Small seeded generator: the same phrase every time a loop comes round, so the tune is recognisable.
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// The lead notes of one bar: [{ step, note, len }]. A phrase is 4 bars; it plays twice, then the next variation.
export function leadBar(id, bar) {
  const t = TRACKS[id];
  if (!t) return [];
  const phrase = Math.floor(bar / 8) % 4;
  const r = rng(0x9e3779b1 ^ (id.length * 7919) ^ (phrase * 104729) ^ ((bar % 4) * 1299709));
  const chord = t.chords[Math.floor(bar / t.barsPerChord) % t.chords.length];
  const tones = new Set(chord.map((n) => n % 12));
  const out = [];
  let last = t.scale[Math.floor(r() * t.scale.length)];
  for (const step of t.leadSteps) {
    if (r() > t.leadDensity) continue;
    // Step by a scale degree or two from the last note, preferring chord tones.
    let i = t.scale.indexOf(last);
    if (i < 0) i = 0;
    let pick = t.scale[Math.max(0, Math.min(t.scale.length - 1, i + Math.round((r() - 0.5) * 4)))];
    if (!tones.has(pick % 12) && r() < 0.6) {
      const near = t.scale.filter((n) => tones.has(n % 12));
      if (near.length) pick = near.reduce((a, b) => (Math.abs(b - pick) < Math.abs(a - pick) ? b : a));
    }
    last = pick;
    out.push({ step, note: pick, len: r() < 0.3 ? 4 : 2 });
  }
  // Every fourth bar ends the phrase on a chord tone held a little longer.
  if (bar % 4 === 3 && out.length) out[out.length - 1].len = 6;
  return out;
}

// getCtx() -> AudioContext or null (sound off / no WebAudio); getDest() -> the node music connects to.
export function createBgm(getCtx, getDest, { setTimer = setInterval, clearTimer = clearInterval } = {}) {
  let ctx = null, bus = null, tone = null, echo = null, noise = null;
  let track = null, id = '', timer = 0, step = 0, bar = 0, next = 0;
  let ducked = false, playing = false, stopAt = 0;

  function ensure() {
    const c = getCtx?.();
    if (!c) return false;
    if (ctx !== c) { ctx = c; bus = null; }
    if (bus) return true;
    bus = ctx.createGain();
    bus.gain.value = 0.0001;
    tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3000;
    tone.Q.value = 0.5;
    bus.connect(tone);
    tone.connect(getDest?.() || ctx.destination);
    // A short echo for the lead only.
    const d = ctx.createDelay(1);
    d.delayTime.value = 0.3;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(bus);
    echo = d;
    const len = Math.floor(ctx.sampleRate * 0.5);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    const r = rng(12345);
    for (let i = 0; i < len; i++) data[i] = r() * 2 - 1;
    return true;
  }

  function level() { return ducked ? 0.0001 : LEVEL; }
  function ramp(to, sec) {
    if (!bus) return;
    const now = ctx.currentTime;
    try {
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), now);
      bus.gain.exponentialRampToValueAtTime(Math.max(0.0001, to), now + sec);
    } catch { /* closed context */ }
  }

  // ---- instruments (t: context time) ----
  function env(g, t, peak, attack, hold, release) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    if (hold > 0) g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return t + attack + hold + release + 0.02;
  }
  function osc(type, hz, t, end, dest, detune = 0) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(hz, t);
    if (detune) o.detune.setValueAtTime(detune, t);
    o.connect(dest);
    o.start(t);
    o.stop(end);
    return o;
  }
  function voice(type, midi, t, peak, attack, hold, release, out = bus, detune = 0) {
    const g = ctx.createGain();
    const end = env(g, t, peak, attack, hold, release);
    g.connect(out);
    osc(type, midiHz(midi), t, end, g, detune);
    return g;
  }
  function kick(t) {
    const g = ctx.createGain();
    const end = env(g, t, 0.34, 0.004, 0, 0.26);
    g.connect(bus);
    const o = osc('sine', 130, t, end, g);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
  }
  function hiss(t, type, hz, peak, release, q = 0.7) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    const g = ctx.createGain();
    const end = env(g, t, peak, 0.002, 0, release);
    src.connect(f); f.connect(g); g.connect(bus);
    src.start(t, (t * 7.3) % 0.4);
    src.stop(end);
  }

  function schedule(s, t) {
    const T = track;
    const sx = stepSeconds(T);
    const inBar = s % 16;
    const chord = T.chords[Math.floor(bar / T.barsPerChord) % T.chords.length];
    const root = T.bass[Math.floor(bar / T.barsPerChord) % T.bass.length];
    const kicks = T.kick[bar % T.kick.length];
    if (kicks.includes(inBar)) kick(t);
    if (T.snare.includes(inBar)) hiss(t, 'bandpass', id === 'plaza' ? 1500 : 1900, id === 'plaza' ? 0.07 : 0.1, id === 'plaza' ? 0.12 : 0.16, 0.9);
    if (T.hat.includes(inBar)) {
      const open = T.openHat.includes(inBar);
      hiss(t, 'highpass', 7200, (inBar % 4 === 0 ? 0.022 : 0.032) * (id === 'plaza' ? 0.8 : 1), open ? 0.14 : 0.035);
    }
    for (const [at, len] of T.bassSteps) {
      if (at !== inBar) continue;
      const oct = id === 'drive' && (inBar / 2) % 2 === 1 ? 12 : 0;
      voice('sine', root + oct, t, 0.16, 0.01, len * sx * 0.55, len * sx * 0.4);
      voice('triangle', root + 12 + oct, t, 0.025, 0.01, len * sx * 0.3, len * sx * 0.4);
    }
    if (inBar === 0) {
      const barSec = 16 * sx;
      if (T.keys === 'hold' && bar % T.barsPerChord === 0) {
        for (const n of chord) voice('triangle', n, t, 0.028, 0.05, barSec * T.barsPerChord * 0.55, barSec * 0.6, bus, (n % 3) * 3 - 3);
      } else if (T.keys === 'pad') {
        for (const n of chord) voice('sawtooth', n, t, 0.012, 0.35, barSec * 0.45, barSec * 0.4, bus, (n % 2) * 6 - 3);
      }
    }
    if (T.keys === 'stab' && (inBar === 0 || inBar === 6 || inBar === 10)) {
      for (const n of chord) voice('triangle', n + 12, t, 0.02, 0.008, 0.05, 0.35);
    }
    if (T.keys === 'hold' && inBar === 8 && bar % T.barsPerChord === 1) {
      for (const n of chord.slice(1)) voice('sine', n + 12, t, 0.012, 0.02, 0.05, 0.7);
    }
    if (T.arp && inBar % T.arp === 0) {
      const k = (inBar / T.arp) % chord.length;
      const n = chord[(k + Math.floor(bar / 2)) % chord.length] + (id === 'night' ? 24 : 12);
      voice(id === 'night' ? 'sine' : 'square', n, t, id === 'night' ? 0.026 : 0.0095, 0.004, 0.02, id === 'night' ? 0.5 : 0.16);
    }
    for (const L of leadBar(id, bar)) {
      if (L.step !== inBar) continue;
      const g = voice(id === 'drive' ? 'triangle' : 'sine', L.note, t, 0.038, 0.012, L.len * sx * 0.4, 0.5 + L.len * sx * 0.3);
      g.connect(echo);
    }
  }

  function tick() {
    if (!ctx || !track) return;
    const now = ctx.currentTime;
    if (stopAt && now >= stopAt) { halt(); return; }
    if (next < now - 0.5) next = now + 0.05; // the tab was frozen: pick up again instead of bursting
    let guard = 64;
    while (next < now + LOOK && guard-- > 0) {
      const sx = stepSeconds(track);
      const inBar = step % 16;
      const swing = inBar % 2 === 1 ? track.swing * sx : 0;
      schedule(step, next + swing);
      next += sx;
      step++;
      if (step % 16 === 0) bar = (bar + 1) % (loopBars(track) * 4 * 4);
    }
  }

  function halt() {
    if (timer) clearTimer(timer);
    timer = 0;
    track = null;
    id = '';
    playing = false;
    stopAt = 0;
  }

  return {
    start(name) {
      const T = TRACKS[name];
      if (!T) return false;
      if (!ensure()) return false;
      stopAt = 0;
      if (id === name && timer) { ramp(level(), 0.6); return true; }
      const now = ctx.currentTime;
      const switching = !!track;
      track = T;
      id = name;
      step = 0;
      bar = 0;
      next = now + (switching ? 0.25 : 0.1);
      tone.frequency.setValueAtTime(T.cutoff, now);
      if (switching) {
        try {
          bus.gain.cancelScheduledValues(now);
          bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), now);
          bus.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
          bus.gain.exponentialRampToValueAtTime(Math.max(0.0001, level()), now + 1.6);
        } catch { /* closed */ }
      } else ramp(level(), 1.8);
      if (!timer) timer = setTimer(tick, TICK_MS);
      playing = true;
      tick();
      return true;
    },
    stop() {
      if (!track) return;
      ramp(0.0001, 0.5);
      stopAt = (ctx?.currentTime || 0) + 0.55;
      playing = false;
    },
    duck(on) {
      ducked = !!on;
      if (track) ramp(level(), on ? 0.4 : 1.2);
    },
    get playing() { return playing; },
    get track() { return id; },
  };
}
