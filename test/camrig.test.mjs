// Camera, focus moves and world prompts: the decisions live in camrig.js (no three.js) and ftue.js; the wiring is
// checked against the source, since the world itself needs a browser.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RETURN_MS, easeOutCubic, easeInOutCubic, tweenU, returnPoint, focusOptions, cineCancels, behindCar,
  FOLLOW, followYawRate, portraitFov, fitDistance, DRIVE_CAM, reverseTime, driveCamera, easeCamDist, shortenFocus,
  BOARD_NEAR, pickNearBoard, boardState, boardPrompt, proximityKey, FAR_TAP, tapRoute,
  EMOTE_GAP_MS, cooldownOk, isGiftBoard, FIREWORK, fadeOldest, fireworkAlpha, fireworkDone,
  FRAME, frameDistance, boardRange, SPARK, sparkGlide, sparkDrop,
  CELEBRATE_GAP_MS, celebrationDue, faceAbove, PARTY, celebrationPlan, fanVelocity,
} from '../camrig.js';
import { walkArrival, startFtue } from '../ftue.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

describe('scripted camera: one way back', () => {
  it('returns in 0.45 s on an ease-out that starts at the scripted pose and lands exactly on the orbit', () => {
    assert.equal(RETURN_MS, 450);
    const from = { x: 100, y: 40, z: -200 }, to = { x: 3, y: 4, z: 5 };
    assert.deepEqual(returnPoint(from, to, 0), from);
    assert.deepEqual(returnPoint(from, to, 1), to);
    let last = -1;
    for (let i = 0; i <= 20; i++) {
      const e = easeOutCubic(i / 20);
      assert.ok(e >= last);
      last = e;
    }
    // ease-out: more than half the way in the first third of the time
    assert.ok(easeOutCubic(1 / 3) > 0.7);
    assert.equal(easeOutCubic(2), 1);
    assert.equal(easeOutCubic(-1), 0);
    assert.equal(easeInOutCubic(0.5), 0.5);
    assert.equal(tweenU(1450, 1000, 450), 1);
    assert.equal(tweenU(1000, 1000, 450), 0);
    assert.equal(tweenU(5, 0, 0), 1);
  });

  it('reads focusSlot(slot, n) as a hold and focusSlot(slot, { hold, celebrate }) as options', () => {
    assert.deepEqual(focusOptions(2500), { hold: 2500, celebrate: false });
    assert.deepEqual(focusOptions(), { hold: 0, celebrate: false });
    assert.deepEqual(focusOptions(0), { hold: 0, celebrate: false });
    assert.deepEqual(focusOptions({ celebrate: true }), { hold: 0, celebrate: true });
    assert.deepEqual(focusOptions({ hold: 4500, celebrate: 1 }), { hold: 4500, celebrate: false });
    assert.deepEqual(focusOptions(-3), { hold: 0, celebrate: false });
  });

  it('input ends a held camera, but not one already returning or the pinned photo frame', () => {
    assert.equal(cineCancels({ active: true, keys: 1 }), true);
    assert.equal(cineCancels({ active: true, joy: 0.2 }), true);
    assert.equal(cineCancels({ active: true }), false);
    assert.equal(cineCancels({ active: true, back: true, keys: 2 }), false); // a second input does not cut the return
    assert.equal(cineCancels({ active: true, pin: true, keys: 1, joy: 1 }), false);
    assert.equal(cineCancels({ active: false, keys: 1 }), false);
    // a resting thumb does not end the lounge tour
    assert.equal(cineCancels({ active: true, lounge: true, joy: 0.2 }), false);
    assert.equal(cineCancels({ active: true, lounge: true, joy: 0.3 }), true);
  });

  it('a key still held or a thumb on the stick does not end it while input is switched off', () => {
    assert.equal(cineCancels({ active: true, keys: 2, joy: 1, locked: true }), false);
    assert.equal(cineCancels({ active: true, lounge: true, joy: 1, locked: true }), false);
    assert.equal(cineCancels({ active: true, keys: 1, locked: false }), true);
    const w = read('timesSquare3d.js');
    assert.match(w, /cineCancels\(\{ active: true, pin: cine\.pin, keys: keys\.size, joy: Math\.hypot\(joy\.x, joy\.y\), lounge, locked: !inputEnabled \}\)/);
    assert.match(w, /if \(lounge && inputEnabled && \(keys\.size \|\| Math\.hypot\(joy\.x, joy\.y\) > 0\.25\)\) endCine\(\);/);
    // auto-repeat does not refill the key set that setInputEnabled(false) emptied
    assert.match(w, /if \(inputEnabled\) keys\.add\(e\.code\);/);
    assert.equal(w.match(/keys\.add\(/g).length, 1);
  });

  it('comes back behind a car at the given distance', () => {
    const p = behindCar({ x: 10, y: 2.5, z: 20 }, 0, 11.5);
    // yaw 0 faces +Z, so behind is -Z
    assert.ok(near(p.x, 10, 1e-9) && p.z < 20 && p.y > 2.5);
    assert.ok(near(Math.hypot(p.x - 10, p.y - 2.5, p.z - 20), 11.5, 1e-9));
    const q = behindCar({ x: 0, y: 0, z: 0 }, Math.PI / 2, 10);
    assert.ok(q.x < -9 && Math.abs(q.z) < 1e-9);
  });

  it('the world keeps the orbit under a scripted camera and has one exit', () => {
    const w = read('timesSquare3d.js');
    assert.equal(w.includes('clearCine'), false);
    const step = w.slice(w.indexOf('homePos.copy(camera.position);'), w.indexOf('viewLook.copy(look);'));
    assert.ok(step.length > 0);
    // the scripted branch draws only: it never writes the wanted orbit or the orbit target
    assert.equal(/camWant\.(copy|set)\(/.test(step), false);
    assert.equal(/controls\.target\.(copy|set)\(/.test(step), false);
    assert.match(step, /camera\.position\.lerpVectors\(cineFrom, homePos, e\)/);
    // every ending goes through endCine: the only place a camera is dropped is the landed return
    assert.equal(w.match(/\bcine = null\b/g).length, 2); // the declaration and the landed return
    assert.match(w, /if \(e\.code === 'Escape'\) \{ endCine\(true\); return; \}/);
    assert.match(w, /const cut = !!\(cine && !cine\.back && !cine\.pin\);\n\s+if \(cut\) endCine\(\);/);
    // the touch that ended the camera does not also open the board under it
    assert.match(w, /if \(moved > 7 \|\| !quick \|\| !inputEnabled \|\| cut\) return;/);
    assert.match(w, /if \(cine\.until && now >= cine\.until\) endCine\(\);/);
    assert.match(w, /dur: RETURN_MS, back: true/);
    // cancel-by-input no longer asks whether my avatar is drawn (it is not, in a taxi)
    assert.equal(/cine[^\n]*me\.root\.visible[^\n]*clear/.test(w), false);
    assert.match(w, /function focusSlot\(slotId, holdMsOrOpts = 0\)/);
    assert.match(w, /if \(drive\) \{ tell\('운전 중에는 내린 뒤에 볼 수 있어요'\); return null; \}/);
    assert.match(w, /if \(o\.celebrate\) celebrateBoard\(slotId, '#ffcf5a'\);/);
    const focus = w.slice(w.indexOf('function focusSlot('), w.indexOf('function framePose('));
    assert.equal(/launch\(/.test(focus), false);
    assert.equal(/\bburst\(/.test(focus), false); // nothing is fired at pose.look (the centre of the face) any more
    assert.equal(/camera\.position\.clone\(\)\.lerp/.test(focus), false);
  });

  it('position and yaw packets still come from the avatar, never from the camera', () => {
    const w = read('timesSquare3d.js');
    const netBlock = w.slice(w.indexOf('// Network projection'), w.indexOf('// Camera: OrbitControls'));
    assert.match(netBlock, /netState\.x = toNetUnits\(pos\.x\);/);
    assert.match(netBlock, /netState\.y = toNetUnits\(pos\.z\);/);
    assert.match(netBlock, /netState\.face = String\(Math\.round\(yaw \/ DEG \/ 15\) \* 15\);/);
    assert.equal(/camera|camWant|homePos|follow\b/.test(netBlock), false);
  });
});

describe('on-foot follow and field of view', () => {
  it('turns toward the stick only after 1.5 s without a drag, never while dragging', () => {
    assert.equal(FOLLOW.idleMs, 1500);
    assert.equal(followYawRate({ f: 0, r: 1, idleMs: 1000 }), 0);
    assert.equal(followYawRate({ f: 0, r: 1, idleMs: 9000, dragging: true }), 0);
    assert.ok(near(followYawRate({ f: 0, r: 1, idleMs: 1600 }), 1.2));
    assert.ok(near(followYawRate({ f: 0, r: -1, idleMs: 1600 }), -1.2));
  });
  it('scales with the sideways part and stays still when walking straight ahead or straight back', () => {
    const idleMs = 5000;
    assert.equal(followYawRate({ f: 1, r: 0, idleMs }), 0);
    assert.equal(followYawRate({ f: -1, r: 0, idleMs }), 0);
    assert.equal(followYawRate({ f: 0, r: 0, idleMs }), 0);
    const diag = followYawRate({ f: 1, r: 1, idleMs });
    assert.ok(near(diag, 1.2 * Math.SQRT1_2, 1e-9));
    const half = followYawRate({ f: 0.9, r: 0.3, idleMs });
    assert.ok(half > 0 && half < diag);
    // backing toward the lens at an angle turns much less than the same angle forward
    const backDiag = followYawRate({ f: -1, r: 1, idleMs });
    assert.ok(backDiag > 0 && backDiag < diag * 0.5);
    assert.ok(Math.abs(followYawRate({ f: -1, r: 0.05, idleMs })) < 0.01);
  });
  it('uses about 72 degrees in portrait and the base FOV in landscape, blended between', () => {
    assert.equal(portraitFov(16 / 9, 55), 55);
    assert.equal(portraitFov(1, 62), 62);
    assert.equal(portraitFov(9 / 16, 62), 72);
    assert.equal(portraitFov(9 / 19.5, 55), 72);
    const mid = portraitFov(0.9, 55);
    assert.ok(mid > 55 && mid < 72);
    assert.equal(portraitFov(NaN, 55), 55);
    assert.equal(portraitFov(0.5, 80), 80);
    // a wider FOV needs a shorter distance for the same framing
    assert.ok(fitDistance(22, 62, 72) < 22);
    assert.ok(near(fitDistance(22, 62, 62), 22, 1e-9));
  });
  it('the world eases the FOV in the frame loop and no longer snaps it on leaving a taxi', () => {
    const w = read('timesSquare3d.js');
    const exit = w.slice(w.indexOf('function exitTaxi()'), w.indexOf('function interact()'));
    assert.equal(/camera\.fov\s*=/.test(exit), false);
    assert.match(w, /const fovGoal = portraitFov\(camera\.aspect, baseFov\) \+ \(drive \? /);
    assert.match(w, /followYawRate\(\{ f: input\.f, r: input\.r, idleMs: now - orbitEnd, dragging: orbiting \}\)/);
  });
});

describe('driving camera', () => {
  it('stays behind for a short reverse and looks back only after 1.2 s of reversing', () => {
    assert.equal(DRIVE_CAM.reverseHold, 1.2);
    let t = 0;
    for (let i = 0; i < 60; i++) t = reverseTime(t, -4, 1 / 60); // one second in reverse
    assert.ok(near(t, 1, 1e-6));
    assert.equal(driveCamera({ v: -4, reverseT: t }).front, false);
    for (let i = 0; i < 18; i++) t = reverseTime(t, -4, 1 / 60);
    assert.equal(driveCamera({ v: -4, reverseT: t }).front, true);
    // rolling forward again resets the clock
    assert.equal(reverseTime(t, 0.5, 1 / 60), 0);
    assert.equal(driveCamera({ v: 6, reverseT: 5 }).front, false);
  });
  it('never swings under 3 m/s', () => {
    assert.equal(driveCamera({ v: 2.9, reverseT: 0 }).swing, false);
    assert.equal(driveCamera({ v: -2.9, reverseT: 9 }).swing, false);
    assert.equal(driveCamera({ v: 3, reverseT: 0 }).swing, true);
    assert.equal(driveCamera({ v: -3.5, reverseT: 9 }).swing, true);
  });
});

describe('camera collision', () => {
  it('pulls in at once and eases back out over about a quarter second', () => {
    assert.equal(easeCamDist(8, 2, 1 / 60), 2);
    assert.equal(easeCamDist(Infinity, 8, 1 / 60), 8);
    let d = 2, frames = 0;
    while (d < 8 && frames < 600) { d = easeCamDist(d, 8, 1 / 60); frames++; }
    assert.equal(d, 8);
    const first = easeCamDist(2, 8, 1 / 60);
    assert.ok(first > 2 && first < 4); // no snap on the first frame
    let q = 2;
    for (let i = 0; i < 15; i++) q = easeCamDist(q, 8, 1 / 60); // 0.25 s
    assert.ok(q > 7.6, String(q));
  });
  it('shortens a scripted camera that would sit behind a building', () => {
    assert.equal(shortenFocus(18, 1), 18);
    // wall at 2.5 + 0.5 * 15.5 = 10.25 m, stop 0.8 m short
    assert.ok(near(shortenFocus(18, 0.5), 9.45, 1e-9));
    assert.equal(shortenFocus(18, 0.05), 6);
    assert.equal(shortenFocus(18, 0), 6);
    assert.equal(shortenFocus(5, 0), 5); // never pushed out past the asked distance
    const w = read('timesSquare3d.js');
    assert.match(w, /shortenFocus\(dist, nyc\.rayBlock\(/);
    assert.match(w, /const pose = slotPose\(slotId, 18, true\);/);
  });
});

describe('board prompt', () => {
  const fronts = [
    { id: 'STREET_1', x: 0, z: 0, y: 6 },
    { id: 'STREET_2', x: 30, z: 0, y: 6 },
    { id: 'MAIN_TOP', x: 100, z: 100, y: 40 },
    { id: 'MAIN_LOW', x: 100, z: 100, y: 12 },
    { id: 'BROKEN', x: NaN, z: 0, y: 1 },
    null,
  ];
  it('picks the nearest board whose front point is within 12 m', () => {
    assert.equal(BOARD_NEAR, 12);
    assert.equal(pickNearBoard(3, 4, fronts).id, 'STREET_1');
    assert.equal(pickNearBoard(20, 0, fronts).id, 'STREET_2');
    assert.equal(pickNearBoard(15, 0, fronts), null); // 15 m from both
    assert.equal(pickNearBoard(0, 12.5, fronts), null);
    assert.equal(pickNearBoard(0, 11.5, fronts).id, 'STREET_1');
  });
  it('tolerates boards that are not mounted and prefers the lowest of stacked faces', () => {
    assert.equal(pickNearBoard(0, 0, []), null);
    assert.equal(pickNearBoard(0, 0, null), null);
    assert.equal(pickNearBoard(101, 101, fronts).id, 'MAIN_LOW');
    assert.equal(pickNearBoard(101, 101, [...fronts].reverse()).id, 'MAIN_LOW');
  });
  it('words the prompt by state', () => {
    const now = Date.parse('2026-11-21T12:00:00Z');
    const lit = '2026-11-22T12:00:00Z', dead = '2026-11-20T12:00:00Z';
    assert.equal(boardState(null, 'guest:me', now), 'free');
    assert.equal(boardState({ holder_id: 'guest:a', lit_until: dead }, 'guest:me', now), 'dark');
    assert.equal(boardState({ holder_id: 'guest:a', lit_until: lit }, 'guest:me', now), 'other');
    assert.equal(boardState({ holder_id: 'guest:a', expires_at: lit }, '', now), 'other');
    assert.equal(boardState({ holder_id: 'guest:me', lit_until: dead }, 'guest:me', now), 'mine');
    assert.deepEqual(boardPrompt({ board: null, me: 'guest:me', now, name: '거리 3번' }).p, ['빈 전광판 · 소원 걸기', '거리 3번', '걸기']);
    assert.equal(boardPrompt({ board: { holder_id: 'guest:a', lit_until: dead }, me: 'guest:me', now }).p[0], '빈 전광판 · 소원 걸기');
    const other = boardPrompt({ board: { holder_id: 'guest:a', holder_name: '민지', lit_until: lit }, me: 'guest:me', now });
    assert.equal(other.p[0], '민지님의 전광판 · 응원하기');
    assert.equal(other.p[2], '응원');
    assert.equal(boardPrompt({ board: { holder_id: 'guest:me', lit_until: lit }, me: 'guest:me', now }).p[0], '내 전광판 · 불 켜기/수정');
    assert.equal(boardPrompt({ board: { holder_id: 'guest:a', lit_until: lit }, me: 'x', now }).who, '익명');
  });
  it('the proximity key follows the neighbour count and the board state', () => {
    assert.equal(proximityKey(null), '');
    assert.notEqual(proximityKey({ kind: 'crowd', n: 1 }), proximityKey({ kind: 'crowd', n: 2 }));
    assert.notEqual(proximityKey({ kind: 'board', id: 'STREET_1', s: 'free' }), proximityKey({ kind: 'board', id: 'STREET_1', s: 'other', who: '민지' }));
    assert.notEqual(proximityKey({ kind: 'board', id: 'STREET_1', s: 'other', who: '민지' }), proximityKey({ kind: 'board', id: 'STREET_1', s: 'other', who: '서준' }));
    assert.equal(proximityKey({ kind: 'taxi', i: 3 }), 'taxi3');
    assert.equal(proximityKey({ kind: 'plot', id: 7 }), 'plot7');
  });
  it('the world ranks the board above ring and crowd, and shows 함성 only with a neighbour', () => {
    const w = read('timesSquare3d.js');
    const prox = w.slice(w.indexOf('// Proximity prompts.'), w.indexOf('const key = proximityKey(nk);'));
    const board = prox.indexOf('if (!nk && boardNear) nk = boardNear;'), ring = prox.indexOf("nk = { kind: 'ring' }"), crowd = prox.indexOf("kind: 'crowd'");
    assert.ok(board > 0 && ring > board && crowd > ring);
    assert.match(prox, /if \(now - boardAt > 250\)/); // four times a second
    assert.match(prox, /if \(mates > 0\) nk = \{ kind: 'crowd', n: mates \};/);
    assert.match(prox, /BALANCE\.cheerNear/);
    const main = read('main.js');
    assert.match(main, /else if \(kind === 'board'\) ui\.openAd\(id\);/);
    const ui = read('ui.js');
    assert.match(ui, /near\.kind === 'board'/);
  });
});

describe('taps on far things', () => {
  it('a board beyond 60 m, or any board from a taxi, gets the card; near boards keep the sheet', () => {
    assert.equal(FAR_TAP.board, 60);
    assert.equal(tapRoute({ kind: 'billboard', dist: 20 }), 'open');
    assert.equal(tapRoute({ kind: 'billboard', dist: 60 }), 'open');
    assert.equal(tapRoute({ kind: 'billboard', dist: 61 }), 'card');
    assert.equal(tapRoute({ kind: 'billboard', dist: 5, driving: true }), 'card');
  });
  it('a far ATM tap is a waypoint, a near one opens the hub; other things are unchanged', () => {
    assert.equal(tapRoute({ kind: 'atm', dist: 200 }), 'waypoint');
    assert.equal(tapRoute({ kind: 'atm', dist: 10 }), 'open');
    assert.equal(tapRoute({ kind: 'atm', dist: 200, near: true }), 'open');
    assert.equal(tapRoute({ kind: 'atm', dist: 4, driving: true }), 'waypoint');
    assert.equal(tapRoute({ kind: 'cart', dist: 500 }), 'open');
    assert.equal(tapRoute({ kind: 'plot', dist: 500, driving: true }), 'open');
  });
  it('is wired: world event, main handler, ui card, CSS right after the prompt rules', () => {
    const w = read('timesSquare3d.js'), main = read('main.js'), ui = read('ui.js'), html = read('index.html');
    assert.match(w, /opts\.onInteract\?\.\('board-far', info\.slotId, \{ clicked: true, dist, driving: !!drive, state: bp\.state, who: bp\.who \}\)/);
    assert.match(main, /if \(kind === 'board-far'\) \{ ui\.farBoard\?\.\(id, info\); return; \}/);
    assert.match(main, /if \(info\?\.far && info\.at\) \{ world\?\.setWaypoint\?\.\(info\.at\);/);
    assert.match(ui, /farBoard: showFarCard,/);
    assert.match(ui, /farTimer = setTimeout\(hideFar, 4000\);/);
    const at = html.indexOf('.prompt .cool svg'), card = html.indexOf('.farcard {');
    assert.ok(at > 0 && card > at && card - at < 400);
    const css = html.slice(card, html.indexOf('.dock {', card));
    const colors = [...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]).filter((v) => v !== '--safe-b');
    for (const v of colors) assert.ok(['--surface-hud', '--line', '--text', '--text-2', '--accent'].includes(v), v);
    assert.equal(/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css), false);
    for (const m of css.matchAll(/font-size: (\d+)px/g)) assert.ok(['12', '13', '15'].includes(m[1]), m[1]);
    for (const m of css.matchAll(/border-radius: ([^;]+);/g)) assert.equal(m[1], '14px');
  });
});

describe('small rules', () => {
  it('emotes share one 700 ms cooldown', () => {
    assert.equal(EMOTE_GAP_MS, 700);
    assert.equal(cooldownOk(1000, 400, 700), false);
    assert.equal(cooldownOk(1100, 400, 700), true);
    assert.equal(cooldownOk(0, -1e9, 700), true);
    const w = read('timesSquare3d.js');
    const emote = w.slice(w.indexOf('function playEmote('), w.indexOf('let lastReact'));
    assert.ok(emote.indexOf('cooldownOk(at, lastEmote, EMOTE_GAP_MS)') < emote.indexOf('launch('));
    assert.ok(emote.indexOf('cooldownOk(at, lastEmote, EMOTE_GAP_MS)') < emote.indexOf('sendEmoji'));
  });
  it('gift fireworks need a gift', () => {
    assert.equal(isGiftBoard({ line1: 'To. 민지' }), true);
    assert.equal(isGiftBoard({ line1: 'To.민지' }), true);
    assert.equal(isGiftBoard({ line1: '오늘도 화이팅' }), false);
    assert.equal(isGiftBoard({ line1: 'To. ' }), false);
    assert.equal(isGiftBoard(null), false);
    assert.match(read('timesSquare3d.js'), /if \(!sure && !isGiftBoard\(boards\.get\(slotId\)\?\.data\)\) return;/);
    assert.match(read('main.js'), /world\?\.giftPop\?\.\(FOCUS, true\);/);
  });
  it('over the cap the oldest burst fades instead of vanishing', () => {
    const list = Array.from({ length: 16 }, (_, i) => ({ age: 1 - i * 0.05, fadeAt: -1 }));
    fadeOldest(list, 14);
    assert.deepEqual(list.map((f) => f.fadeAt >= 0), [true, true, ...Array(14).fill(false)]);
    assert.equal(list[0].fadeAt, list[0].age);
    // already fading ones do not count against the cap twice
    fadeOldest(list, 14);
    assert.equal(list.filter((f) => f.fadeAt >= 0).length, 2);
    assert.equal(FIREWORK.cap, 14);
    // the fade starts from the opacity the burst had and reaches 0 in 0.35 s: no pop
    assert.ok(near(fireworkAlpha(1, 2.4, 1), fireworkAlpha(1, 2.4, -1), 1e-12));
    assert.ok(fireworkAlpha(1.2, 2.4, 1) < fireworkAlpha(1.2, 2.4, -1));
    assert.equal(fireworkAlpha(1.35, 2.4, 1), 0);
    assert.equal(fireworkDone(1.2, 2.4, 1), false);
    assert.equal(fireworkDone(1.36, 2.4, 1), true);
    assert.equal(fireworkDone(2.4, 2.4, -1), true);
    assert.equal(fireworkDone(1, 2.4, -1), false);
  });
  it('the photo countdown leaves input alone and the picture has no name tag of mine', () => {
    const ui = read('ui.js');
    const shot = ui.slice(ui.indexOf('function countShot()'), ui.indexOf('let shotBusy'));
    assert.equal(/lockInput\?\.\(true\)/.test(shot), false);
    assert.equal(/pointerEvents/.test(shot), false);
    assert.match(shot, /document\.body\.classList\.add\('posing'\)/);
    assert.match(shot, /document\.body\.classList\.remove\('posing'\)/);
    const w = read('timesSquare3d.js');
    assert.match(w, /if \(document\.body\.classList\.contains\('posing'\)\) return;/);
    const cap = w.slice(w.indexOf('capture() {'), w.indexOf("g.fillText('WISH BOARD"));
    assert.ok(cap.indexOf('me.tag.visible = false;') < cap.indexOf('composer.render()'));
    assert.match(cap, /finally \{ me\.tag\.visible = tagOn; \}/);
  });
  it('rings are quiet while the reward gap runs, and a lost context is handled', () => {
    const w = read('timesSquare3d.js');
    assert.match(w, /const ringWait = now - stuntAt < PAY\.stunt\.gapMs \+ 250;/);
    assert.match(w, /if \(ringWait\) continue;/);
    assert.match(w, /addEventListener\('webglcontextlost', \(e\) => \{\n\s+e\.preventDefault\(\);/);
    assert.match(w, /tell\('화면을 다시 불러오는 중…'\)/);
    assert.match(w, /addEventListener\('webglcontextrestored'/);
    assert.match(w, /\}, 4000\);/);
    assert.match(read('main.js'), /if \(kind === 'notice'\) \{ ui\.note\(info\?\.text \|\| '', info\?\.tone \|\| '', info\?\.reload \? \(\) => location\.reload\(\) : undefined\); return; \}/);
  });
});

describe('framing a board', () => {
  const tan = (deg) => Math.tan((deg * Math.PI) / 360);
  // The frames the review named: desktop 16:9, a 771x1211 window, a 9:16 frame and a 0.46 phone. The portrait ones
  // settle on 72 degrees (portraitFov), the landscape one keeps the base 55.
  const FRAMES = [
    ['16:9 landscape', 16 / 9, portraitFov(16 / 9, 55)],
    ['771x1211', 771 / 1211, portraitFov(771 / 1211, 55)],
    ['9:16', 9 / 16, portraitFov(9 / 16, 55)],
    ['0.46 phone', 0.46, portraitFov(0.46, 62)],
  ];
  const FACES = [
    ['main face', 24, 13.5],
    ['street board', 22, 12.375],
    ['lot board', 3.28, 1.845],
  ];
  it('the whole face is in the frame with 8% of it free on each side, and one side is exactly at the margin', () => {
    assert.equal(FRAME.margin, 0.08);
    for (const [fname, aspect, vfov] of FRAMES) for (const [bname, w, h] of FACES) {
      const d = frameDistance({ w, h, aspect, vfov });
      const seenH = 2 * d * tan(vfov), seenW = seenH * aspect;
      const label = `${bname} in ${fname} at ${d.toFixed(2)} m`;
      assert.ok(w <= seenW * 0.84 + 1e-9, label);
      assert.ok(h <= seenH * 0.84 + 1e-9, label);
      assert.ok(near(Math.max(w / seenW, h / seenH), 0.84, 1e-9), label);
    }
  });
  it('gives the ranges the frames need', () => {
    const at = (w, h, i) => frameDistance({ w, h, aspect: FRAMES[i][1], vfov: FRAMES[i][2] });
    assert.equal(FRAMES[1][2], 72);
    assert.equal(FRAMES[3][2], 72);
    // main face 24 x 13.5: 15.4 m on a desktop, 30.9 m in the 771x1211 window, 35.0 m at 9:16, 42.7 m on the phone
    assert.ok(near(at(24, 13.5, 0), 15.44, 0.01));
    assert.ok(near(at(24, 13.5, 1), 30.88, 0.01));
    assert.ok(near(at(24, 13.5, 2), 34.96, 0.01));
    assert.ok(near(at(24, 13.5, 3), 42.74, 0.01));
    // a 22 m street board: 14.2, 28.3, 32.0 and 39.2 m
    assert.ok(near(at(22, 12.375, 0), 14.15, 0.01));
    assert.ok(near(at(22, 12.375, 1), 28.31, 0.01));
    assert.ok(near(at(22, 12.375, 2), 32.04, 0.01));
    assert.ok(near(at(22, 12.375, 3), 39.18, 0.01));
    // the small lot board fits from under 6 m in every frame
    for (let i = 0; i < FRAMES.length; i++) assert.ok(at(3.28, 1.845, i) < 6, FRAMES[i][0]);
    // a landscape frame is height-bound for a 16:9 face, a portrait one width-bound
    assert.ok(near(at(24, 13.5, 0), 13.5 / (2 * tan(55) * 0.84), 1e-9));
    assert.ok(near(at(24, 13.5, 2), 24 / (9 / 16) / (2 * tan(72) * 0.84), 1e-9));
  });
  it('a board camera moves out for a wide board, comes in for a small one, and stops at the cap', () => {
    assert.equal(FRAME.max, 48);
    assert.equal(FRAME.loose, 1.7);
    assert.equal(FRAME.near, 6);
    // the caller's distance stays while the face is neither cut nor lost: 18 m (보기, the claim), 8 m (the photo)
    assert.equal(boardRange(18, 14.15), 18);
    assert.equal(boardRange(8, 5.84), 8);
    // a wide face pushes the camera out to its fit, up to the cap
    assert.ok(near(boardRange(8, 14.15), 14.15));
    assert.ok(near(boardRange(18, 42.74), 42.74));
    assert.equal(boardRange(18, 70), 48);
    // a small face pulls it in: 18 m would leave a lot board a quarter of the frame wide, so 1.7 x the fit, never under 6 m
    assert.ok(near(boardRange(18, 5.84), 5.84 * 1.7));
    assert.ok(near(boardRange(18, 4.2), 7.14));
    assert.equal(boardRange(18, 2.1), 6);
    assert.equal(boardRange(8, 2.1), 6);
    assert.equal(boardRange(4, 2.1), 4); // a caller that asked for less keeps it
    // from that range the face is at least 0.84 / 1.7 = 49% of the frame in the dimension that fits last
    assert.ok((1 - 2 * FRAME.margin) / FRAME.loose > 0.49);
    assert.equal(boardRange(18, NaN), 18);
    assert.equal(boardRange(18, 0), 18);
    // every face of the plaza fits under the cap on a 0.46 phone
    assert.ok(frameDistance({ w: 24, h: 13.5, aspect: 0.46, vfov: 72 }) < FRAME.max);
  });
  it('bad input cannot produce a wild range', () => {
    assert.equal(frameDistance(), 0);
    assert.equal(frameDistance({ w: -5, h: -5, aspect: 1, vfov: 55 }), 0);
    assert.ok(Number.isFinite(frameDistance({ w: 24, h: 13.5, aspect: 0, vfov: 0 })));
    assert.ok(Number.isFinite(frameDistance({ w: 24, h: 13.5, aspect: NaN, vfov: NaN, margin: 9 })));
  });
  it('every scripted board camera goes through it with the mount\'s real size and the settled FOV', () => {
    const w = read('timesSquare3d.js');
    const pose = w.slice(w.indexOf('function slotPose('), w.indexOf('const AD_IDS'));
    assert.match(pose, /if \(clear\) \{\n\s+const face = boards\.face\(slotId\);\n\s+if \(face\) dist = boardRange\(dist, frameDistance\(\{ w: face\.w, h: face\.h, aspect: camera\.aspect, vfov: portraitFov\(camera\.aspect, baseFov\) \}\)\);/);
    // the fit comes before the wall test, so a building in the way still pulls the camera in
    assert.ok(pose.indexOf('boardRange(') < pose.indexOf('shortenFocus('));
    assert.equal(/camera\.fov/.test(pose), false); // not the FOV in mid-ease
    // focus / claim, lounge (both orientations) and the photo frame all ask with clear = true
    assert.match(w, /const pose = slotPose\(slotId, 18, true\);/);
    assert.match(w, /const pose = watchPortrait \? framePose\(id\) : slotPose\(id, 18, true\);/);
    assert.match(w, /return slotPose\(slotId, d, true, true\);/);
    // the mount's size in metres, parent scale included
    const s = read('ts3d/screens.js');
    assert.match(s, /tier: b\.tier, w: m\.w \* sx, h: m\.h \* sy,/);
  });
});

describe('board celebrations', () => {
  const FACES = [
    ['lot board', { w: 3.28, h: 1.845, tier: 'C' }],
    ['lot tower board', { w: 11.34, h: 6.39, tier: 'C' }],
    ['corner board', { w: 14, h: 7.875, tier: 'B' }],
    ['street board', { w: 22, h: 12.375, tier: 'B' }],
    ['main face', { w: 24, h: 13.5, tier: 'S' }],
  ];
  const VARIANTS = [];
  for (const [name, face] of FACES) for (const low of [false, true]) for (const top of [true, false]) for (const cheer of [false, true]) {
    VARIANTS.push([`${name}${low ? ' low' : ''}${top ? '' : ' stacked'}${cheer ? ' cheer' : ''}`, face, celebrationPlan({ ...face, low, top, cheer })]);
  }
  /** Where the sparks of one burst are over its life, in the board's frame: the corners and middles of the fan. */
  function sparks(plan, b) {
    const out = [];
    for (const ra of [0, 0.25, 0.5, 0.75, 1]) for (const rs of [0, 0.5, 1]) for (const rn of [0, 0.5, 1]) {
      const v0 = fanVelocity(b, ra, rs, rn);
      for (let t = 0; t <= plan.life + 1e-9; t += 0.05) {
        const g = sparkGlide(t, plan.drag), d = sparkDrop(t, plan.drag, plan.grav);
        out.push([b.u + v0[0] * g, b.v + v0[1] * g - d, b.n + v0[2] * g]);
      }
    }
    return out;
  }
  // Clear of the face: beyond a side edge or above the top edge by at least `pad`. (Below the bottom edge is not a
  // way out: nothing is placed there, and a side spark that falls stays beyond its side.)
  const clearOf = (face, u, v, pad) => Math.abs(u) >= face.w / 2 + pad - 1e-9 || v >= face.h / 2 + pad - 1e-9;

  it('no burst, flash or rocket is on the face', () => {
    for (const [name, face, plan] of VARIANTS) {
      assert.ok(plan.bursts.length > 0, name);
      for (const b of plan.bursts) {
        assert.ok(clearOf(face, b.u, b.v, b.flash / 2), `${name}: flash at ${b.u}, ${b.v}`);
        assert.ok(b.n <= 0, name); // on the plane (or behind it), never in front
        if (b.rise > 0) {
          // the rocket climbs straight up beside the board
          assert.ok(Math.abs(b.u) >= face.w / 2 + plan.rocket / 2, name);
          assert.ok(b.riseT > 0 && b.rise / b.riseT < 40, name);
        }
      }
    }
  });
  it('no spark is ever inside the board rectangle', () => {
    for (const [name, face, plan] of VARIANTS) for (const b of plan.bursts) for (const [u, v] of sparks(plan, b)) {
      assert.ok(clearOf(face, u, v, plan.size / 2), `${name}: spark at ${u.toFixed(2)}, ${v.toFixed(2)}`);
    }
  });
  it('no spark is in front of the plane inside the camera\'s cone', () => {
    // The focus camera stands on the board's normal, 6 m (pulled in by a wall) to 48 m (the framing cap) out, level
    // with the face or below it: never above its top edge.
    for (const [name, face, plan] of VARIANTS) {
      for (const D of [6, 18, FRAME.max]) for (const cv of [face.h / 2, 0, -face.h / 2, -face.h / 2 - 30]) {
        for (const b of plan.bursts) for (const [u, v, n] of sparks(plan, b)) {
          if (!(n > 0)) continue; // on or behind the plane: beside the board, or hidden by it
          assert.ok(n < 2.5, name);
          // where the line from the camera through the spark meets the board's plane
          const s = D / (D - n);
          assert.ok(clearOf(face, u * s, cv + (v - cv) * s, plan.size / 2), `${name}: D ${D}, cam ${cv}, spark ${u.toFixed(2)}, ${v.toFixed(2)}, ${n.toFixed(2)}`);
        }
      }
    }
  });
  it('fans open away from the face: side ones outward, the top one upward, by more than a spark can fall', () => {
    for (const [name, face, plan] of VARIANTS) for (const b of plan.bursts) {
      const side = Math.abs(b.u) > face.w / 2;
      for (const ra of [0, 0.5, 1]) {
        const [vu, vv] = fanVelocity(b, ra, 1, 0.5);
        if (side) assert.ok(vu * Math.sign(b.u) > 0, name);
        else assert.ok(vv > 0, name);
      }
      if (!side) assert.ok(b.v - face.h / 2 >= sparkDrop(plan.life, plan.drag, plan.grav) + plan.size / 2, name);
      assert.ok(near(Math.hypot(b.out[0], b.out[1]), 1, 1e-9), name);
      assert.ok(b.flat <= 0.25, name);
    }
  });
  it('a face with another face right above it gets nothing above its top edge', () => {
    for (const id of ['MAIN_LOW', 'MAIN_BOT', 'MAIN_MID', 'MAIN_TOP', 'SUB_1B', 'SUB_4B']) assert.equal(faceAbove(id), true, id);
    for (const id of ['MAIN_UP', 'SUB_1A', 'STREET_7', 'PLOT_3', '', null]) assert.equal(faceAbove(id), false, String(id));
    for (const [name, face, plan] of VARIANTS) {
      if (!name.includes('stacked')) continue;
      for (const b of plan.bursts) assert.ok(Math.abs(b.u) > face.w / 2, name);
    }
  });
  it('size, speed, flash and count follow the board: a lot board gets a small one, the main face a big one', () => {
    const plans = FACES.map(([, face]) => celebrationPlan(face));
    for (let i = 1; i < plans.length; i++) {
      const a = plans[i - 1], b = plans[i];
      assert.ok(b.size >= a.size && b.bursts[0].speed >= a.bursts[0].speed && b.bursts[0].flash >= a.bursts[0].flash, FACES[i][0]);
      assert.ok(b.bursts[0].count >= a.bursts[0].count, FACES[i][0]);
    }
    const small = plans[0], big = plans[plans.length - 1];
    assert.ok(big.total > small.total * 3);
    // the lot board: sprites under 0.3 m, sparks that travel 1.2 m, a flash well under a metre
    assert.ok(small.size < 0.3 && small.bursts[0].flash < 0.8);
    assert.ok(near(small.bursts[0].speed * sparkGlide(small.life, small.drag), 1.2, 1e-9));
    // the old burst used 1.45 m sprites (2.2 m on the tower), a 7 m flash and colours times 2.6
    assert.ok(big.size < 1 && big.bursts[0].flash <= 3.6);
    for (const p of plans) assert.ok(p.gain <= 1.5 && p.flashGain <= 1.2);
    assert.ok(PARTY.gain < 2.6 / 1.9);
  });
  it('counts fall on the low tier and stay under what one claim fired before', () => {
    // Before: boards.set fired 90 (140 on the tower) + 2, 3 or 4 rockets of 80, and the focus call another 100;
    // on the low tier each of those was 60%.
    const OLD = { S: [140 + 100 + 4 * 80, 84 + 60 + 4 * 48], B: [90 + 100 + 3 * 80, 54 + 60 + 3 * 48], C: [90 + 100 + 2 * 80, 54 + 60 + 2 * 48] };
    for (const [name, face] of FACES) for (const top of [true, false]) {
      const high = celebrationPlan({ ...face, top }), low = celebrationPlan({ ...face, top, low: true });
      assert.ok(low.total < high.total, name);
      assert.ok(low.bursts.length <= high.bursts.length, name);
      assert.ok(high.total < OLD[face.tier][0] / 2, `${name}: ${high.total}`);
      assert.ok(low.total < OLD[face.tier][1] / 2, `${name}: ${low.total}`);
      assert.equal(high.total, high.bursts.reduce((s, b) => s + b.count, 0));
      // one claim is a handful of bursts: a phone stays far under the cap of 14 (and the hard cut at 28)
      assert.ok(low.bursts.length <= 5 && low.bursts.length * 2 < FIREWORK.cap, name);
      assert.ok(high.bursts.length <= 7 && high.bursts.length * 2 <= FIREWORK.cap, name);
    }
    assert.equal(FIREWORK.cap, 14);
    assert.equal(FIREWORK.hard, 28);
    // a phone gets no rockets on a lot board and one pair elsewhere
    assert.equal(celebrationPlan({ ...FACES[0][1], low: true }).bursts.filter((b) => b.rise > 0).length, 0);
    assert.equal(celebrationPlan({ ...FACES[4][1], low: true }).bursts.filter((b) => b.rise > 0).length, 2);
    assert.equal(celebrationPlan(FACES[4][1]).bursts.filter((b) => b.rise > 0).length, 4);
  });
  it('is over in about three seconds', () => {
    for (const [name, , plan] of VARIANTS) {
      assert.ok(plan.end <= 3, `${name}: ${plan.end}`);
      assert.ok(plan.life <= 1.5, name);
      for (const b of plan.bursts) assert.ok(b.delay >= 0 && b.delay + b.riseT + plan.life <= plan.end + 1e-9, name);
    }
  });
  it('a cheer is the small version of the same rule', () => {
    for (const [name, face] of FACES) {
      const claim = celebrationPlan(face), cheer = celebrationPlan({ ...face, cheer: true });
      assert.ok(cheer.total < claim.total / 2, name);
      assert.ok(cheer.bursts.length <= 3, name);
      assert.ok(cheer.bursts[0].speed < claim.bursts[0].speed, name);
      assert.equal(celebrationPlan({ ...face, cheer: true, low: true }).bursts.length, 2);
    }
  });
  it('one celebration per board per claim', () => {
    assert.equal(CELEBRATE_GAP_MS, 4000);
    assert.equal(celebrationDue(undefined, 1000), true);
    assert.equal(celebrationDue(1000, 1001), false);
    assert.equal(celebrationDue(1000, 4999), false);
    assert.equal(celebrationDue(1000, 5000), true);
    const w = read('timesSquare3d.js');
    // boards.set, the focus camera and strike share one gate; nothing else fires a claim's fireworks
    assert.match(w, /onBurst: \(slotId, color\) => celebrateBoard\(slotId, color\)/);
    assert.match(w, /strike\(slotId\) \{ celebrateBoard\(slotId, '#ffcf5a'\); \},/);
    const gate = w.slice(w.indexOf('function celebrateBoard('), w.indexOf('function cheerAt('));
    assert.match(gate, /if \(!celebrationDue\(celebratedAt\.get\(slotId\), now\)\) return false;/);
    assert.match(gate, /celebratedAt\.set\(slotId, now\);/);
    assert.equal(w.includes('celebrateAt('), false);
    assert.match(read('ts3d/screens.js'), /if \(celebrate && b\.mounts\.length\) onBurst\?\.\(slotId, THEMES\[next\.bg_theme\]\?\.accent \|\| '#ffcf5a'\);/);
  });
  it('the world places the plan with the board\'s real normal, right and up, and cheerAt follows the same rule', () => {
    const w = read('timesSquare3d.js');
    const fw = w.slice(w.indexOf('function boardFireworks('), w.indexOf('function celebrateBoard('));
    assert.match(fw, /const face = boards\.face\(slotId\);/);
    assert.match(fw, /celebrationPlan\(\{ w: face\.w, h: face\.h, tier: face\.tier, low, top: !faceAbove\(slotId\), cheer: !!o\.cheer \}\)/);
    assert.match(fw, /face\.pos\.clone\(\)\.addScaledVector\(face\.right, b\.u\)\.addScaledVector\(face\.up, b\.v\)\.addScaledVector\(face\.normal, b\.n\)/);
    assert.match(fw, /fanVelocity\(b, Math\.random\(\), Math\.random\(\), Math\.random\(\)\)/);
    assert.equal(/\bburst\(/.test(fw), false);
    const cheer = w.slice(w.indexOf('function cheerAt('), w.indexOf('function fountainSplash('));
    assert.match(cheer, /return boardFireworks\(slotId, '#ff3d9a', \{ cheer: true, alt: \['#ffcf5a'\] \}\);/);
    assert.equal(/worldPos|\bburst\(|launch\(/.test(cheer), false);
    // the face comes from the mount's world matrix: the same normal slotPose aims the camera along
    const s = read('ts3d/screens.js');
    assert.match(s, /normal: new THREE\.Vector3\(e\[8\] \/ sz, e\[9\] \/ sz, e\[10\] \/ sz\),/);
  });
  it('sparks follow a closed form, so the reach the plan counts on is the reach that is drawn', () => {
    assert.equal(sparkGlide(0), 0);
    assert.equal(sparkDrop(0), 0);
    assert.ok(near(sparkGlide(100, 1.5), 1 / 1.5, 1e-9)); // never farther than speed / drag
    // the same motion the frame loop used to integrate step by step (drag 1.5, gravity 5.2), within a few centimetres
    let x = 0, y = 0, vx = 10, vy = 4;
    const dt = 1 / 240;
    for (let i = 0; i < 240 * 2; i++) { const k = Math.exp(-dt * SPARK.drag); vx *= k; vy = vy * k - SPARK.grav * dt; x += vx * dt; y += vy * dt; }
    assert.ok(near(x, 10 * sparkGlide(2), 0.05), String(x));
    assert.ok(near(y, 4 * sparkGlide(2) - sparkDrop(2), 0.05), String(y));
    assert.deepEqual([SPARK.drag, SPARK.grav, SPARK.life], [1.5, 5.2, 2.4]);
    const w = read('timesSquare3d.js');
    assert.match(w, /const glide = sparkGlide\(f\.age, f\.drag\), drop = sparkDrop\(f\.age, f\.drag, f\.grav\);/);
    assert.match(w, /p\[j\] = v\[j\] \* glide; p\[j \+ 1\] = v\[j \+ 1\] \* glide - drop; p\[j \+ 2\] = v\[j \+ 2\] \* glide;/);
    // the round burst keeps its numbers
    assert.match(w, /size: \(power >= 1 \? 1\.45 : 1\.05\) \* Math\.max\(0\.6, power\), gain: 2\.6, flash: 7 \* power, flashGain: 2\.2,/);
  });
});

describe('deep link and lounge wiring', () => {
  it('?focus= moves the avatar to the board first, holds until input, and fires nothing unless gift=1', () => {
    const main = read('main.js');
    const arrive = main.slice(main.indexOf('arrive() {'), main.indexOf('focusShot:'));
    assert.ok(arrive.indexOf('world?.goToSlot?.(FOCUS);') > 0);
    assert.ok(arrive.indexOf('world?.goToSlot?.(FOCUS);') < arrive.indexOf('world?.focusSlot(FOCUS, { hold: 0, celebrate: false })'));
    assert.match(arrive, /if \(GIFT\) \{\n\s+world\?\.giftPop\?\.\(FOCUS, true\);/);
    assert.match(arrive, /introDone\(\); \}, 700\);/);
    const w = read('timesSquare3d.js');
    const go = w.slice(w.indexOf('goToSlot(slotId) {'), w.indexOf('cineOn:'));
    assert.match(go, /api\.teleport\(pose\.front\.x, pose\.front\.z\);/);
    assert.match(go, /insideLoop\(pose\.front\.x, pose\.front\.z, 0\)/);
  });
  it('the lounge tour chains board to board and refuses in a taxi', () => {
    const w = read('timesSquare3d.js');
    const tour = w.slice(w.indexOf('function tourNext()'), w.indexOf('function taxiCanSit('));
    assert.match(tour, /startCine\(pose\.cam, pose\.look, \{ dur: first \? 1100 : 1800 \}\);/);
    assert.equal(/until/.test(tour), false); // no timed return between boards
    assert.match(w, /startLounge\(\) \{\n\s+if \(drive\) \{ tell\('운전 중에는 내린 뒤에 볼 수 있어요'\); return false; \}/);
    const main = read('main.js');
    assert.match(main, /if \(world\.startLounge\(\) === false\) \{ loungeOn = false; return; \}/);
    // reward timing and message are untouched
    assert.match(main, /if \(!payBonus\('lounge', PAY\.lounge\.base\) && !loungeTold\)/);
    assert.match(main, /\}, PAY\.lounge\.gapMs\);/);
  });
});

describe('tutorial arrival at the free slot', () => {
  const free = { id: 'STREET_11', x: 3, z: 4 };
  it('opens only for the waypoint the tutorial set, and only while the slot is still free', () => {
    assert.equal(walkArrival({ at: { x: 3, z: 4 }, free }), 'open');
    assert.equal(walkArrival({ at: { x: 3, z: 4, driving: true }, free }), 'park');
    assert.equal(walkArrival({ at: { x: 40, z: 4 }, free }), '');
    assert.equal(walkArrival({ at: { x: 3, z: 4 }, free, taken: true }), '');
    assert.equal(walkArrival({ at: { x: 3, z: 4 }, free, starterOk: false }), '');
    assert.equal(walkArrival({ at: { x: 3, z: 4 }, free, busy: true }), '');
    assert.equal(walkArrival({ at: { x: 3, z: 4 }, free: null }), '');
    assert.equal(walkArrival({ at: null, free }), '');
  });
  const make = (over = {}) => {
    const calls = [];
    const api = startFtue({
      ui: {
        setNextLine: () => {},
        openClaimStep: (n, model) => calls.push(['wizard', n, model.slot]),
        note: (t) => calls.push(['note', t]),
        isBusy: () => !!over.busy,
        nextGoal: () => over.goal ?? null,
      },
      world: {
        setWaypoint: (p) => calls.push(['wp', p]),
        boardView: (id) => (over.taken ? { holder_id: 'guest:x' } : id === 'STREET_11' ? {} : { holder_id: 'x' }),
        slotCard: (id) => (id === 'STREET_11' ? { x: 3, z: 4 } : null),
      },
    });
    return { api, calls };
  };
  it('startFtue opens the claim wizard for that slot once', () => {
    const { api, calls } = make();
    assert.equal(api.onWaypoint({ x: 21, z: 118 }), ''); // the cart waypoint: not the free slot
    api.onBakePay();
    assert.equal(api.onWaypoint({ x: 99, z: 99 }), '');
    assert.equal(api.onWaypoint({ x: 3, z: 4 }), 'open');
    assert.deepEqual(calls.filter((c) => c[0] === 'wizard'), [['wizard', 1, 'STREET_11']]);
    assert.equal(api.onWaypoint({ x: 3, z: 4 }), ''); // once
  });
  it('says to get out when reached in a taxi, and stays quiet when the screen is busy', () => {
    const a = make();
    a.api.onBakePay();
    assert.equal(a.api.onWaypoint({ x: 3, z: 4, driving: true }), 'park');
    assert.equal(a.calls.some((c) => c[0] === 'wizard'), false);
    assert.equal(a.calls.some((c) => c[0] === 'note'), true);
    const b = make({ busy: true });
    b.api.onBakePay();
    assert.equal(b.api.onWaypoint({ x: 3, z: 4 }), '');
    assert.equal(b.calls.some((c) => c[0] === 'wizard'), false);
  });
  it('the world reports a reached waypoint and main passes it to the tutorial', () => {
    const w = read('timesSquare3d.js');
    assert.match(w, /setWaypoint\(null\);\n\s+opts\.onInteract\?\.\('arrive', null, \{ x: at\.x, z: at\.z, driving: !!drive \}\);/);
    assert.match(read('main.js'), /if \(kind === 'arrive'\) \{ ftueApi\?\.onWaypoint\?\.\(info\); return; \}/);
  });
});
