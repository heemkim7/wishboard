// Background music without files: bgm.js schedules original loops on a WebAudio context, audio.js hands a track to it
// when assets/audio/<id>.ogg is missing, and ui.js binds it and ducks it under the lounge chords and the dance track.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { TRACKS, createBgm, leadBar, midiHz, stepSeconds, loopBars, LEVEL, chordAt } from '../bgm.js';
import { MUSIC } from '../audio.js';
import { DANCE_TRACKS } from '../dance.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function param(v = 0) {
  const p = { value: v, calls: [] };
  for (const k of ['setValueAtTime', 'exponentialRampToValueAtTime', 'linearRampToValueAtTime', 'cancelScheduledValues', 'setTargetAtTime']) {
    p[k] = (...a) => { p.calls.push([k, ...a]); if (k !== 'cancelScheduledValues') p.value = a[0]; return p; };
  }
  return p;
}
function fakeCtx() {
  const made = { osc: 0, src: 0, started: [] };
  const node = (extra = {}) => ({ connect() {}, disconnect() {}, ...extra });
  const ctx = {
    currentTime: 0, sampleRate: 8000, destination: node(), made,
    createGain: () => node({ gain: param(1) }),
    createBiquadFilter: () => node({ type: '', frequency: param(1000), Q: param(1) }),
    createDelay: () => node({ delayTime: param(0) }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    createOscillator: () => { made.osc++; return node({ type: '', frequency: param(440), detune: param(0), start(t) { made.started.push(t); }, stop() {} }); },
    createBufferSource: () => { made.src++; return node({ buffer: null, start(t) { made.started.push(t); }, stop() {} }); },
  };
  return ctx;
}
function clock() {
  const timers = new Map();
  let n = 0;
  return {
    setTimer: (fn) => { timers.set(++n, fn); return n; },
    clearTimer: (id) => { timers.delete(id); },
    run() { for (const fn of [...timers.values()]) fn(); },
    get live() { return timers.size; },
  };
}

describe('bgm.js tracks', () => {
  it('has one synth loop for every track audio.js knows, plus the lounge and the dance tracks (같이 춤추기)', () => {
    assert.deepEqual(Object.keys(TRACKS).sort(), [...MUSIC, 'lounge', ...DANCE_TRACKS.map((t) => t.id)].sort());
    assert.equal(MUSIC.includes('lounge'), false); // ui.js lays it over the current track; no file is asked for
    for (const [id, t] of Object.entries(TRACKS)) {
      assert.ok(t.bpm >= 60 && t.bpm <= 130, id);
      assert.equal(t.chords.length, t.bass.length, id);
      for (const c of t.chords) for (const n of c) assert.ok(n >= 36 && n <= 84, id + ' chord range');
      assert.ok(stepSeconds(t) > 0.1 && stepSeconds(t) < 0.25, id);
      assert.ok(loopBars(t) >= 4 && loopBars(t) <= 8, id);
    }
  });
  it('plays the same lead phrase every time the loop comes round, and stays on the scale', () => {
    for (const id of Object.keys(TRACKS)) {
      for (let bar = 0; bar < 16; bar++) {
        assert.deepEqual(leadBar(id, bar), leadBar(id, bar));
        for (const L of leadBar(id, bar)) {
          assert.ok(TRACKS[id].scale.includes(L.note), id);
          assert.ok(TRACKS[id].leadSteps.includes(L.step), id);
        }
      }
    }
    assert.deepEqual(leadBar('nope', 0), []);
    assert.equal(Math.round(midiHz(69)), 440);
    assert.equal(Math.round(midiHz(81)), 880);
  });
});

describe('the dance tracks (같이 춤추기)', () => {
  it('keep the track rules: chords and bass per bar, a 4-8 bar loop, a form and a melody only where they fit', () => {
    for (const { id } of DANCE_TRACKS) {
      const t = TRACKS[id];
      assert.ok(t.bpm >= 100 && t.bpm <= 124, id);
      for (let bar = 0; bar < 64; bar++) {
        const ci = chordAt(t, bar);
        assert.ok(Number.isInteger(ci) && ci >= 0 && ci < t.chords.length, id + ' bar ' + bar);
      }
      if (t.form) for (const i of t.form) assert.ok(i >= 0 && i < t.chords.length, id);
      for (const n of t.bass) assert.ok(n >= 28 && n <= 48, id + ' bass range');
    }
    // the carol: the public-domain chorus, 16 bars, one tune every time round, every note on its scale and steps
    const j = TRACKS.jingle;
    assert.equal(j.melody.length, 16);
    assert.equal(j.form.length, 16);
    assert.deepEqual(leadBar('jingle', 0).map((L) => L.note), [76, 76, 76]); // jin-gle bells
    assert.deepEqual(leadBar('jingle', 2).map((L) => L.note), [76, 79, 72, 74]); // jin-gle all the
    assert.deepEqual(leadBar('jingle', 15).map((L) => L.note), [72]);
    assert.deepEqual(leadBar('jingle', 16), leadBar('jingle', 0));
    for (let bar = 0; bar < 16; bar++) {
      const steps = leadBar('jingle', bar).reduce((s, L) => s + L.len, 0);
      assert.equal(steps, 16, 'bar ' + bar + ' fills four beats');
    }
    // chords under the tune: C for "jingle bells", F under the F bars, G7 before the last C
    assert.deepEqual([0, 4, 14, 15].map((b) => chordAt(j, b)), [0, 1, 2, 0]);
  });
  it('the synth takes each of them, and over(id, seconds) starts on the step the clock is at', () => {
    for (const { id } of DANCE_TRACKS) {
      const ctx = fakeCtx();
      ctx.currentTime = 3;
      const c = clock();
      const bgm = createBgm(() => ctx, () => ctx.destination, c);
      bgm.start('plaza');
      const at = 37.03, before = ctx.made.started.length;
      assert.equal(bgm.over(id, at), true);
      assert.equal(bgm.track, id);
      const sx = stepSeconds(TRACKS[id]);
      ctx.currentTime = 3.2;
      c.run();
      const mine = ctx.made.started.slice(before);
      const first = Math.min(...mine);
      assert.ok(mine.length > 0 && first >= 3.25 && first <= 3.25 + 4 * sx, id + ' first step ' + first); // a step or two may have nothing on it
      if (!TRACKS[id].swing) {
        for (const t of mine) { const k = (t - 3 + at) / sx; assert.ok(Math.abs(k - Math.round(k)) < 1e-6, id + ' on the grid'); }
      }
      ctx.currentTime = 9;
      c.run();
      bgm.over(null);
      assert.equal(bgm.track, 'plaza');
    }
  });
});

describe('createBgm', () => {
  it('schedules notes ahead on the context clock, fades in, and stops its timer after a stop', () => {
    const ctx = fakeCtx();
    const c = clock();
    const bgm = createBgm(() => ctx, () => ctx.destination, c);
    assert.equal(bgm.start('nope'), false);
    assert.equal(bgm.start('plaza'), true);
    assert.equal(bgm.playing, true);
    assert.equal(bgm.track, 'plaza');
    assert.equal(c.live, 1);
    const first = ctx.made.osc + ctx.made.src;
    assert.ok(first > 0, 'the first steps are scheduled at once');
    assert.ok(ctx.made.started.every((t) => t <= 0.1 + 0.3 + 0.2), 'nothing far beyond the look-ahead');
    // Time stands still (a suspended context): ticking adds nothing.
    c.run(); c.run();
    assert.equal(ctx.made.osc + ctx.made.src, first);
    ctx.currentTime = 4;
    c.run();
    assert.ok(ctx.made.osc + ctx.made.src > first, 'a moving clock schedules more');
    bgm.stop();
    assert.equal(bgm.playing, false);
    ctx.currentTime = 5;
    c.run();
    assert.equal(c.live, 0, 'the timer ends once the fade is over');
    assert.equal(bgm.track, '');
  });
  it('lays the lounge over the current track and goes back to it; a new track asked meanwhile waits', () => {
    const ctx = fakeCtx();
    const c = clock();
    const bgm = createBgm(() => ctx, () => ctx.destination, c);
    bgm.start('plaza');
    bgm.over('lounge');
    assert.equal(bgm.track, 'lounge');
    bgm.start('night'); // the ball opens while the player sits: the lounge goes on
    assert.equal(bgm.track, 'lounge');
    bgm.over(null);
    assert.equal(bgm.track, 'night');
    assert.equal(c.live, 1);
    bgm.stop(); // sound off ends the overlay too
    bgm.over(null);
    assert.equal(bgm.playing, false);
    assert.equal(bgm.over('nope'), true); // an unknown name is no overlay: back to the base track
    assert.equal(bgm.track, 'night');
  });
  it('switches tracks on one timer, does nothing without a context, and ducks to silence', () => {
    const ctx = fakeCtx();
    const c = clock();
    let on = false;
    const bgm = createBgm(() => (on ? ctx : null), () => ctx.destination, c);
    assert.equal(bgm.start('plaza'), false, 'sound off or no WebAudio: no music');
    on = true;
    bgm.start('plaza');
    bgm.start('drive');
    assert.equal(bgm.track, 'drive');
    assert.equal(c.live, 1);
    bgm.duck(true);
    bgm.duck(false);
    bgm.start('drive');
    assert.equal(c.live, 1);
    assert.ok(LEVEL > 0 && LEVEL < 0.6);
  });
});

describe('audio.js hands a missing track to the synth', () => {
  it('starts the synth once the file has failed, and stops it with the sound setting', async () => {
    const audio = await import('../audio.js?bgm');
    const calls = [];
    audio.markAudioFailed('assets/audio/plaza.ogg');
    audio.bindMusic({ start: (id) => calls.push('start ' + id), stop: () => calls.push('stop'), duck: (on) => calls.push('duck ' + on) });
    audio.startMusic('plaza');
    audio.duckMusic(true);
    audio.setSound(false);
    audio.startMusic('plaza');
    audio.setSound(true);
    assert.deepEqual(calls, ['start plaza', 'duck true', 'stop', 'start plaza']);
  });
  it('ui.js binds the synth to its context and lays the lounge and the dance track over the square', () => {
    const ui = read('ui.js');
    assert.match(ui, /createBgm\(\(\) => \(soundOn \? ac\(\) : null\), \(\) => audio\.master\)/);
    assert.match(ui, /bindMusic\(bgm\)/);
    assert.match(ui, /lofi = true;\n\s+bgm\.over\('lounge'\);/);
    assert.match(ui, /lofi = false;\n\s+bgm\.over\(null\);/);
    assert.doesNotMatch(ui, /const chords = \[\[220, 261\.6, 329\.6\]/); // the old humming sine chords
    assert.match(ui, /danceSong = r\.id;\n\s+bgm\.over\(r\.id, r\.posMs \/ 1000\);/); // 같이 춤추기: the radio's track at the clock's place
    assert.equal(/danceBus|duckMusic/.test(ui), false);
    assert.match(read('index.html') + read('ui.js'), /bgm\.js\?v=/);
  });
});
