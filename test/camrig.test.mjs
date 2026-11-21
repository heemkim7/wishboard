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
    assert.match(w, /if \(o\.celebrate\) burst\(pose\.look\.clone\(\)/);
    const focus = w.slice(w.indexOf('function focusSlot('), w.indexOf('function framePose('));
    assert.equal(/launch\(/.test(focus), false);
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
