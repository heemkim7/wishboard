// U5 "interactions and feedback": the pure rules in interact.js and audio.js, and the wiring that must keep using them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  taxiExit, EXIT_SLOW, EXIT_CONFIRM_MS, nextOfferDelay, fareWait, FARE_GAP_S, OFFER_MIN_S, OFFER_RIDE_S,
  stickZone, stickVec, isTouchUI, STICK_W, STICK_H, STICK_THROW, STICK_ENGAGE,
  bakeFlip, bakeBest, BAKE_FLIPS, BAKE_ROUND_MS,
} from '../interact.js';
import { PLAY } from '../balance.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, a); const j = src.indexOf(b, i + a.length); assert.ok(j > i, b); return src.slice(i, j); };

// The non-game change: picking up ground coins paid 응원 포인트 for play, so the coins are gone from the world, the page and the rules.
describe('ground coins are gone', () => {
  it('no MINE gate, no coin pick-up and no coin meshes', () => {
    assert.doesNotMatch(read('interact.js'), /coinGate|COIN_GAP_MS|COIN_WAIT_MS|COIN_CAP_MS/);
    const main = read('main.js');
    assert.doesNotMatch(main, /takeCoin|coinBack|sendMine|onCoin|removeCoin|holdCoin/);
    assert.doesNotMatch(read('net.js'), /sendMine|t: 'MINE'/);
    const w = read('timesSquare3d.js');
    assert.doesNotMatch(w, /COIN_HOME|holdCoin|removeCoin|updateCoins|onCoin/);
    assert.match(w, /startStars, removeStar, clearStars,\n/);
  });
  it('the world still exits a taxi slowly, boosts at one top speed, and keeps a fast ride waiting only when a fare gap runs', () => {
    const w = read('timesSquare3d.js');
    assert.match(w, /if \(d\.exiting && Math\.abs\(d\.v\) <= EXIT_SLOW\) exitTaxi\(\);/);
    assert.match(w, /const top = boosting \? CAR\.boost : CAR\.max;/);
    assert.match(w, /const boosting = input\.walk \|\| boostHeld;/); // the fever's unlimited boost is gone with the fever
    assert.equal(/party \? 52/.test(w), false);
    assert.match(w, /if \(left > 0\) opts\.onJob\?\.\(\{ type: 'abandon', riders: left \}\);/);
    assert.match(w, /job\.wait = there \? fareWait\(/);
    assert.match(w, /else if \(there && !job\.wait && Math\.abs\(d\.v\) < SLOW_V\)/);
  });
});

describe('taxi: leaving, offers and the fare gap', () => {
  it('with riders the first press warns for 3 s; the second gets out (braking first when fast)', () => {
    const a = taxiExit({ riders: 2, speed: 0, now: 1000, armedUntil: 0 });
    assert.deepEqual(a, { act: 'warn', armedUntil: 1000 + EXIT_CONFIRM_MS });
    assert.equal(taxiExit({ riders: 2, speed: 0, now: 2000, armedUntil: a.armedUntil }).act, 'exit');
    assert.equal(taxiExit({ riders: 2, speed: 12, now: 2000, armedUntil: a.armedUntil }).act, 'brake');
    // too late: it warns again
    assert.equal(taxiExit({ riders: 2, speed: 0, now: 1000 + EXIT_CONFIRM_MS, armedUntil: a.armedUntil }).act, 'warn');
  });
  it('without riders it gets out at once below walking pace, and brakes first above it (either direction)', () => {
    assert.equal(taxiExit({ riders: 0, speed: EXIT_SLOW }).act, 'exit');
    assert.equal(taxiExit({ riders: 0, speed: EXIT_SLOW + 0.1 }).act, 'brake');
    assert.equal(taxiExit({ riders: 0, speed: -6 }).act, 'brake');
    assert.equal(EXIT_SLOW, 3);
  });
  // No fare is paid, so main.js reports every drop-off as ev.sent = false and the world never starts a gap: since stays null, the next
  // passenger comes OFFER_MIN_S after the last job and nobody waits at the drop-off. The pacing rules stay for a gap if one is ever set.
  it('with no fare gap the next passenger comes at once; with one, a ride waits for it', () => {
    assert.equal(FARE_GAP_S, 40);
    assert.ok(PLAY.drop.gapMs <= PLAY.pick.gapMs);
    assert.equal(nextOfferDelay(null), OFFER_MIN_S);
    assert.equal(nextOfferDelay(0), FARE_GAP_S - OFFER_RIDE_S);
    assert.equal(nextOfferDelay(10), FARE_GAP_S - OFFER_RIDE_S - 10);
    assert.equal(nextOfferDelay(39), OFFER_MIN_S);
    assert.equal(nextOfferDelay(null, { min: 0.4 }), 0.4);
    // A fast ride waits at the drop-off rather than sending a fare the Room refuses.
    assert.equal(fareWait(null), 0);
    assert.equal(fareWait(30), 10);
    assert.equal(fareWait(45), 0);
  });
  it('the world uses the rules: E asks, the cab brakes to a stop, fever is boost without the 52 m/s car', () => {
    const w = read('timesSquare3d.js');
    assert.match(w, /function interact\(\) \{\n\s+if \(drive\) \{ askExit\(\); return; \}/);
    assert.match(w, /const r = taxiExit\(\{ riders, speed: drive\.v, now, armedUntil: exitArmed \}\);/);
    assert.match(w, /if \(d\.exiting && Math\.abs\(d\.v\) <= EXIT_SLOW\) exitTaxi\(\);/);
    assert.match(w, /const top = boosting \? CAR\.boost : CAR\.max;/);
    assert.equal(/party \? 52/.test(w), false);
    assert.match(w, /if \(left > 0\) opts\.onJob\?\.\(\{ type: 'abandon', riders: left \}\);/);
    assert.match(w, /job\.wait = there \? fareWait\(/);
    assert.match(w, /else if \(there && !job\.wait && Math\.abs\(d\.v\) < SLOW_V\)/);
  });
  it('"하차 완료" on the drop-off itself, never a fare: PICK and the drop-off (FARE, a board view) keep their shape', () => {
    const main = read('main.js');
    const job = between(main, '  onJob(ev) {', '\n  },\n');
    assert.match(job, /net\.ch\?\.raw\?\.\(\{ t: 'PICK' \}\)/);
    assert.match(job, /if \(ev\.type === 'done'\) \{ if \(dropped\) net\.sendDrop\?\.\(ev\.slot\); ev\.sent = false; \}/);
    assert.match(job, /ui\.note\(`하차 완료 · \$\{ev\.riders \|\| 1\}명 · 연속 \$\{fareStreak\}명`, 'ok'\);/);
    assert.doesNotMatch(main, /payFare|sendFare|운임 \+/);
    assert.match(read('net.js'), /sendDrop\(slot\) \{ if \(!this\.ch\?\.raw \|\| this\.status !== 'online'\) return false; return this\.ch\.raw\(\{ t: 'FARE', slot: String\(slot \|\| ''\)\.slice\(0, 16\) \}\); \}/);
    assert.equal(/운임/.test(read('ui.js')), false);
  });
  it('names the pillars by role in the HUD, the toasts and the world, with cyan arrows and pins', () => {
    for (const f of ['ui.js', 'main.js', 'timesSquare3d.js']) assert.equal(/초록 기둥|노란 기둥|노란 빛기둥/.test(read(f)), false, f);
    const ui = read('ui.js');
    assert.match(ui, /'손님 기둥에서 속도를 줄이세요' : '도착 기둥에서 속도를 줄이세요'/);
    assert.match(ui, /jobArrow\.style\.color = 'var\(--info, #48d6f0\)';/);
    assert.match(ui, /if \(d\.job\) pin\(d\.job, '#48d6f0',/);
    assert.match(read('timesSquare3d.js'), /const GO_HERE = '#48d6f0'/);
    assert.equal(/'하차'/.test(ui), false);
  });
});

describe('touch controls', () => {
  it('the stick area is the lower-left 45% x 55%, with a 56 px throw', () => {
    assert.equal(STICK_W, 0.45);
    assert.equal(STICK_H, 0.55);
    assert.equal(STICK_THROW, 56);
    assert.equal(stickZone(10, 790, 400, 800), true);
    assert.equal(stickZone(180, 360, 400, 800), true);
    assert.equal(stickZone(181, 700, 400, 800), false); // right of 45%
    assert.equal(stickZone(50, 359, 400, 800), false); // above the lower 55%
    assert.equal(stickZone(NaN, 1, 400, 800), false);
    const v = stickVec(112, 0);
    assert.deepEqual([v.ox, v.oy, v.x, v.y], [56, 0, 1, 0]);
    const s = stickVec(14, -14);
    assert.ok(Math.abs(s.x - 0.25) < 1e-9 && Math.abs(s.y + 0.25) < 1e-9);
    assert.ok(STICK_ENGAGE > 7); // a touch the world still counts as a tap (7 px) never moves the stick
  });
  it('ui.js sizes the area from the same numbers and hands its taps to the world', () => {
    const ui = read('ui.js');
    assert.match(ui, /style: \{ width: `\$\{STICK_W \* 100\}%`, height: `\$\{STICK_H \* 100\}%` \}/);
    assert.match(ui, /root\.prepend\(joyZone\);/);
    assert.match(ui, /hooks\.tapDown\?\.\(ev\.clientX, ev\.clientY\);/);
    assert.match(ui, /else hooks\.tapUp\?\.\(ev\.clientX, ev\.clientY\);/);
    const w = read('timesSquare3d.js');
    assert.match(w, /canvas\.addEventListener\('pointerdown', onDown, \{ signal \}\);/);
    assert.match(w, /tapUp\(x, y\) \{ onUp\(\{ clientX: x, clientY: y \}\); \},/);
  });
  it('one touch-device test for the layout, the controls and the lines', () => {
    assert.equal(isTouchUI({ coarse: true, points: 0 }), true);
    assert.equal(isTouchUI({ coarse: false, points: 5 }), true);
    assert.equal(isTouchUI({ coarse: false, points: 1 }), false);
    assert.equal(isTouchUI(), false);
    assert.match(read('index.html'), /classList\.toggle\('touch', matchMedia\('\(pointer: coarse\)'\)\.matches \|\| navigator\.maxTouchPoints > 1\)/);
    assert.match(read('ui.js'), /const coarse = isTouchUI\(\{ coarse: matchMedia\('\(pointer: coarse\)'\)\.matches, points: navigator\.maxTouchPoints \}\);/);
    const main = read('main.js');
    assert.match(main, /const TOUCH = isTouchUI\(\{ coarse: matchMedia\('\(pointer: coarse\)'\)\.matches, points: navigator\.maxTouchPoints \}\);/);
    assert.match(main, /touch: TOUCH \}\);/);
    assert.equal(/E를 누르세요'/.test(main.replace("TOUCH ? '탑승 버튼을 누르세요' : 'E를 누르세요'", '')), false);
  });
  it('phone prompts do not name keys', () => {
    const ui = read('ui.js');
    assert.match(ui, /const PRESS = coarse \? '버튼을 누르면' : 'Space 또는 E를 누르면';/);
    assert.equal(/'Space 또는 E · /.test(ui), false);
    assert.equal(/붕어빵 포차와는 다른 자리예요/.test(ui), false);
  });
});

describe('bake: three flips in one session', () => {
  it('scores a flip and keeps the best one', () => {
    assert.equal(bakeFlip(0.5), 'gold');
    assert.equal(bakeFlip(0.4), 'good');
    assert.equal(bakeFlip(0.7), 'miss');
    assert.equal(bakeBest(['miss', 'good', 'miss']), 'good');
    assert.equal(bakeBest(['good', 'gold', 'miss']), 'gold');
    assert.equal(bakeBest(['miss', 'miss', 'miss']), 'miss');
    assert.equal(bakeBest(), 'miss');
  });
  it('a bake is three rounds of about 8 s', () => {
    const total = BAKE_FLIPS * BAKE_ROUND_MS;
    assert.equal(BAKE_FLIPS, 3);
    assert.ok(total >= 7000 && total <= 8000, String(total));
  });
  // The bake and the dance pay nothing: no session goes to the room, the page never waits for a PAY, and a finished bake only moves the tutorial.
  it('no SESS and no coins: a finished bake moves the tutorial on, the dance only animates', () => {
    const main = read('main.js');
    assert.doesNotMatch(main, /sendSess|bakeWait|bakeEnding|BAKE_MISS|DANCE_MISS|beginBake|finishDance/);
    assert.match(main, /  finishBake: \(\) => noteBakePay\(\),/);
    assert.match(main, /  danceStart: \(\) => world\?\.setDancing\(true\),/);
    assert.match(main, /  danceEnd: \(\) => world\?\.setDancing\(false\),/);
    assert.doesNotMatch(read('net.js'), /sendSess|t: 'SESS'/);
    assert.match(main, /const got = creditNow\(m\?\.amount, countsAsActivity\(m\?\.kind\)\);/);
  });
  it('the tutorial opens the panel with the needle parked until the first tap', () => {
    assert.match(read('ftue.js'), /ui\.startBake\?\.\(\{ wait: true \}\);/);
    const ui = read('ui.js');
    assert.match(ui, /if \(!baking\.live\) \{ beginRounds\(\); return; \}/);
    // nothing goes to the room when the rounds start (no session)
    assert.equal(/hooks\.beginBake|hooks\.bakeBusy|bakeChip/.test(ui), false);
  });
});

describe('copy and small fixes', () => {
  it('rings work on foot and in a taxi; the cheer guide makes no distance promise', () => {
    const ui = read('ui.js');
    assert.equal(/가까이서 응원하면/.test(ui), false);
    assert.equal(/링 안으로 걸어|링을 걸어 통과/.test(ui + read('main.js')), false);
  });
  it('stars skip the shared cooldown', () => {
    const star = between(read('main.js'), 'function takeStar(i) {', '\n}\n');
    assert.equal(/cooldownLeft/.test(star), false);
  });
  it('the controls card fades 16 s after entering, not after the page load', () => {
    const ui = read('ui.js');
    assert.equal(/\n  setTimeout\(\(\) => help\.classList\.add\('fade'\), 16000\);/.test(ui), false);
    assert.match(ui, /const helpFade = \(\) => setTimeout\(\(\) => help\.classList\.add\('fade'\), 16000\);/);
  });
  it('the enter button waits for the city (12 s fallback) instead of a fixed 2.5 s', () => {
    const ui = read('ui.js');
    assert.equal(/setTimeout\(bootReady, 2500\)/.test(ui), false);
    assert.match(ui, /setTimeout\(\(\) => bootReady\(true\), BOOT_FALLBACK_MS\);/);
    assert.match(ui, /const BOOT_FALLBACK_MS = 12000;/);
    assert.match(read('main.js'), /onReady: \(\) => ui\.boot\.ready\(\),/);
  });
  it('the balloon keeps 100 hits and throws at most every 250 ms', () => {
    const w = read('timesSquare3d.js');
    assert.match(w, /balloon = \{ hp: 1000, mesh, next: 0 \};/);
    assert.match(w, /balloon\.hp -= 10;/);
    assert.match(w, /const THROW_GAP_MS = 250;/);
  });
  it('the foot ring draws in front of the polygon-offset ground', () => {
    const av = read('ts3d/avatars.js');
    assert.match(av, /polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12/);
    assert.match(av, /this\.ring\.renderOrder = 1;/);
    // stronger than every ground layer's offset in ts3d/world.js (road paint -4 is the strongest)
    const world = read('ts3d/world.js');
    const factors = [...world.matchAll(/polygonOffsetFactor: (-?\d+)/g)].map((m) => Number(m[1]));
    assert.ok(factors.length && Math.min(...factors) > -6, String(factors));
  });
});

describe('audio follows the sound setting and remembers missing files', () => {
  it('a file that failed once is not requested again; the synth plays at once', async () => {
    const made = [];
    globalThis.Audio = class {
      constructor(src) { this.src = src; this.on = {}; made.push(src); }
      addEventListener(type, fn) { this.on[type] = fn; }
      play() { return Promise.reject(new Error('404')); }
      pause() {}
      removeAttribute() {}
      load() {}
    };
    try {
      const audio = await import('../audio.js?fail');
      const tones = [];
      audio.bindSfx({ click: () => tones.push('click') });
      assert.equal(audio.play('click'), true);
      await new Promise((r) => setTimeout(r, 0));
      assert.deepEqual(tones, ['click']);
      assert.equal(audio.audioFailed('assets/audio/sfx/click.ogg'), true);
      assert.equal(audio.play('click'), false); // ui.js tone() plays the synth when play() says false
      assert.equal(made.length, 1);
      // music: once failed it is not requested again (the synth in bgm.js plays it)
      audio.startMusic('plaza');
      await new Promise((r) => setTimeout(r, 0));
      made.length = 0;
      audio.markAudioFailed('assets/audio/plaza.ogg');
      audio.startMusic('night');
      audio.startMusic('plaza');
      assert.deepEqual(made, ['assets/audio/night.ogg']);
    } finally { delete globalThis.Audio; }
  });
  it('sound off: no effects, no music, no vibration', async () => {
    const audio = await import('../audio.js?off');
    const calls = [];
    const nav = { vibrate(n) { calls.push(n); } };
    assert.equal(audio.haptic(20, nav), true);
    audio.setSound(false);
    assert.equal(audio.soundIsOn(), false);
    assert.equal(audio.haptic(20, nav), false);
    assert.equal(audio.play('click'), false);
    assert.equal(audio.startMusic('plaza'), 'assets/audio/plaza.ogg');
    audio.setSound(true);
    assert.equal(audio.haptic(30, nav), true);
    assert.deepEqual(calls, [20, 30]);
  });
  it('ui.js passes the setting to audio.js and pauses ambience in the background', () => {
    const ui = read('ui.js');
    assert.match(ui, /setSound\(soundOn\); \/\/ music and vibration follow/);
    assert.match(ui, /store\('kts_sound', soundOn\);\n\s+setSound\(soundOn\);/);
    assert.match(ui, /if \(hidden\) audio\.ctx\.suspend/);
  });
});
