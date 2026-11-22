// Background music without files: bgm.js schedules original loops on a WebAudio context, audio.js hands a track to it
// when assets/audio/<id>.ogg is missing, and ui.js binds it and ducks it under the lounge chords and the dance track.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { TRACKS, createBgm, leadBar, midiHz, stepSeconds, loopBars, LEVEL } from '../bgm.js';
import { MUSIC } from '../audio.js';

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
  it('has one synth loop for every track audio.js knows', () => {
    assert.deepEqual(Object.keys(TRACKS).sort(), [...MUSIC].sort());
    for (const [id, t] of Object.entries(TRACKS)) {
      assert.ok(t.bpm >= 70 && t.bpm <= 130, id);
      assert.equal(t.chords.length, t.bass.length, id);
      for (const c of t.chords) for (const n of c) assert.ok(n >= 36 && n <= 84, id + ' chord range');
      assert.ok(stepSeconds(t) > 0.1 && stepSeconds(t) < 0.2, id);
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
  it('ui.js binds the synth to its context and ducks it for the lounge and the dance', () => {
    const ui = read('ui.js');
    assert.match(ui, /createBgm\(\(\) => \(soundOn \? ac\(\) : null\), \(\) => audio\.master\)/);
    assert.match(ui, /bindMusic\(bgm\)/);
    assert.match(ui, /duckMusic\(true\); \/\/ the lounge chords/);
    assert.match(ui, /danceBus = dest; duckMusic\(true\);/);
    assert.match(read('index.html') + read('ui.js'), /bgm\.js\?v=/);
  });
});
