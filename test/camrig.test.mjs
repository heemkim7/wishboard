// Camera, focus moves and world prompts: the decisions live in camrig.js (no three.js) and ftue.js; the wiring is
// checked against the source, since the world itself needs a browser.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RETURN_MS, glideMs, easeOutCubic, easeInOutCubic, tweenU, returnPoint, focusOptions, cineCancels, behindCar, DRAG_SPEED, dragSpeed,
  FOLLOW, followYawRate, CHASE, chaseYawRate, STICK_FRAME, stickFrame, DRAG_MIN, viewDragged, tallness, portraitFov, fitDistance,
  BALLOON_LOOK, balloonLook,
  DRIVE_CAM, reverseTime, driveView, driveWiden, driveCamera, easeCamDist, shortenFocus,
  BOARD_NEAR, pickNearBoard, boardState, boardPrompt, proximityKey, FAR_TAP, tapRoute,
  EMOTE_GAP_MS, cooldownOk, isGiftBoard, FIREWORK, fadeOldest, fireworkAlpha, fireworkDone,
  FRAME, frameDistance, boardRange, SPARK, sparkGlide, sparkDrop,
  CELEBRATE_GAP_MS, celebrationDue, faceAbove, PARTY, celebrationPlan, fanVelocity,
} from '../camrig.js';
import { THROW } from '../ts3d/gestures.js';

const read =(p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
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
    assert.match(w, /if \(e\.code === 'Escape'\) \{ endAutoWalk\(\); endCine\(true\); return; \}/);
    assert.match(w, /const cut = !!\(cine && !cine\.back && !cine\.pin\);\n\s+if \(cut\) endCine\(\);/);
    // the touch that ended the camera does not also open the board under it
    assert.match(w, /if \(moved > 7 \|\| !quick \|\| !inputEnabled \|\| cut\) return;/);
    assert.match(w, /if \(cine\.until && now >= cine\.until\) endCine\(\);/);
    assert.match(w, /dur: glideMs\(RETURN_MS, calm\.matches\), back: true/);
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
    // a board camera that opened the lens (boardVantage) holds that FOV until it heads back, then the same ease
    assert.match(w, /const fovGoal = \(cine && !cine\.back && cine\.fov\) \|\| portraitFov\(camera\.aspect, baseFov\) \+ \(drive \? driveWiden\(camera\.aspect, drive\.v\) : 0\);/);
    // keys keep the old rule (the sign turns "toward the right" into a heading)
    assert.match(w, /else if \(!scripted\) turn = -followYawRate\(\{ f: input\.f, r: input\.r, idleMs: now - orbitEnd, dragging: orbiting \}\);/);
  });
});

// The owner on a phone held upright (2026-11-24): "세로모드일떄는 동작이 좀 불편". One thumb is on the stick, so nothing turns the
// view; the old rule turned it by the stick's sideways part only.
const wrap = (a) => ((((a % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
const DEG = Math.PI / 180;
/** Half the width of the view, in degrees, for a frame w x h with that vertical FOV. */
const halfAcross = (w, h, vfov) => Math.atan(Math.tan((vfov * DEG) / 2) * (w / h)) / DEG;
/**
 * The stick and the view, frame by frame, as timesSquare3d.js runs them: thumb(t) is the thumb's angle (rad, + = right of
 * straight up) or null. -> one row per frame: { t, view (the view's heading), travel (the walk's heading or null) }.
 */
function stickWalk(thumb, seconds, { idleMs = Infinity } = {}) {
  const st = { ref: null, lag: 0 }, rows = [], dt = 1 / 60;
  let view = 0, backT = 0;
  for (let t = 0; t < seconds; t += dt) {
    const a = thumb(t);
    stickFrame(st, a);
    if (a == null) { rows.push({ t, view, travel: null }); continue; }
    const travel = view - st.lag - a; // stepWalk: the view's heading less the lag, turned by the thumb
    const err = wrap(travel - view);
    backT = Math.abs(err) > CHASE.backAngle ? backT + dt * 1000 : 0;
    const turn = chaseYawRate({ err, idleMs, backMs: backT });
    st.lag += turn * dt;
    view += turn * dt;
    rows.push({ t, view, travel });
  }
  return rows;
}
describe('the touch stick: the view comes round behind the direction of travel', () => {
  it('an upright phone sees 18.5° either side, so the old rule left the heading off the screen', () => {
    assert.ok(near(halfAcross(375, 812, portraitFov(375 / 812, 62)), 18.55, 0.05));
    assert.ok(halfAcross(812, 375, portraitFov(812 / 375, 62)) > 50);
    // the old rule: a thumb 30° right of straight up keeps walking 30° off the view's axis, and the view keeps turning
    const rate = followYawRate({ f: Math.cos(30 * DEG), r: Math.sin(30 * DEG), idleMs: 9000 });
    assert.ok(near(rate, 0.6, 1e-9));
    assert.equal(followYawRate({ f: -1, r: 0, idleMs: 9000 }), 0); // and a walk back never turned it
  });
  it('a thumb held still walks one straight line, and the view is behind it in about a second and a half', () => {
    for (const deg of [30, 90, -90, 135]) {
      const rows = stickWalk(() => deg * DEG, 4);
      const heads = rows.map((r) => r.travel);
      assert.ok(Math.max(...heads) - Math.min(...heads) < 1e-9, `${deg}: the heading does not turn with the view`);
      const settled = rows.find((r) => Math.abs(wrap(r.travel - r.view)) < 5 * DEG);
      assert.ok(settled && settled.t < (Math.abs(deg) > 120 ? 2.5 : 1.5), `${deg}: behind it after ${settled?.t.toFixed(2)} s`);
      const end = rows[rows.length - 1];
      assert.ok(Math.abs(wrap(end.travel - end.view)) < 2 * DEG, `${deg}: and it stays there`);
    }
    // 90° to the side: within 5° after about 1.3 s, never faster than CHASE.max (103°/s)
    const side = stickWalk(() => 90 * DEG, 4);
    const at = side.find((r) => Math.abs(wrap(r.travel - r.view)) < 5 * DEG).t;
    assert.ok(at > 1.1 && at < 1.5, String(at));
    assert.ok(near(CHASE.max / DEG, 103.1, 0.1));
    for (let i = 1; i < side.length; i++) assert.ok(Math.abs(side[i].view - side[i - 1].view) <= CHASE.max / 60 + 1e-9);
  });
  it('straight back: a few steps keep the view, a walk that goes on turns it round', () => {
    assert.equal(CHASE.backMs, 600);
    const rows = stickWalk(() => Math.PI, 5);
    assert.equal(rows.find((r) => r.t > 0.55).view, 0);
    assert.ok(Math.abs(rows.find((r) => r.t > 0.7).view) > 0);
    const settled = rows.find((r) => Math.abs(wrap(r.travel - r.view)) < 5 * DEG);
    assert.ok(settled && settled.t > 2.5 && settled.t < 3, String(settled?.t)); // right round in 2.8 s
    const half = rows.find((r) => Math.abs(wrap(r.travel - r.view)) < 90 * DEG);
    assert.ok(half.t < 1.6, String(half.t)); // side-on (the way ahead comes into an upright frame) after 1.5 s
    assert.ok(Math.max(...rows.map((r) => r.travel)) - Math.min(...rows.map((r) => r.travel)) < 1e-9);
    assert.equal(chaseYawRate({ err: 3, backMs: 300 }), 0);
    assert.ok(chaseYawRate({ err: 3, backMs: 600 }) > 0);
    assert.ok(chaseYawRate({ err: 2, backMs: 0 }) > 0); // less than backAngle off: at once
  });
  it('a drag of the view wins and holds for 2.5 s; a scripted camera is left alone', () => {
    assert.equal(CHASE.holdMs, 2500);
    assert.equal(chaseYawRate({ err: 1, dragging: true }), 0);
    assert.equal(chaseYawRate({ err: 1, idleMs: 2400 }), 0);
    assert.ok(chaseYawRate({ err: 1, idleMs: 2600 }) > 0);
    assert.equal(chaseYawRate({ err: 1, scripted: true }), 0);
    assert.equal(chaseYawRate({ err: 0 }), 0);
    assert.ok(near(chaseYawRate({ err: 0.4 }), 1) && near(chaseYawRate({ err: -0.4 }), -1)); // gain 2.5
    assert.equal(chaseYawRate({ err: 3, backMs: 9000 }), CHASE.max);
    assert.equal(chaseYawRate({ err: NaN }), 0);
    // held off, nothing turns and the stick reads the live view
    const rows = stickWalk(() => 90 * DEG, 2, { idleMs: 1000 });
    assert.equal(rows[rows.length - 1].view, 0);
  });
  it('moving the thumb takes the lag back out: a small move steers on the line, 45° or more reads the live view', () => {
    assert.ok(near(STICK_FRAME.dead, 8 * DEG, 0.002) && near(STICK_FRAME.full, 45 * DEG, 1e-9));
    const st = { ref: null, lag: 0 };
    stickFrame(st, 1);
    assert.deepEqual(st, { ref: 1, lag: 0 });
    st.lag = 0.8;
    stickFrame(st, 1 + 5 * DEG); // under the dead band: the reference stays, so slow drift adds up to a move
    assert.deepEqual(st, { ref: 1, lag: 0.8 });
    stickFrame(st, 1 + 22.5 * DEG);
    assert.ok(near(st.lag, 0.4, 1e-9) && near(st.ref, 1 + 22.5 * DEG, 1e-12));
    stickFrame(st, 1 + 22.5 * DEG + 50 * DEG);
    assert.equal(st.lag, 0);
    st.lag = 0.5;
    stickFrame(st, null); // the thumb lifts: the next push reads the live view
    assert.deepEqual(st, { ref: null, lag: 0 });
    stickFrame(st, NaN);
    assert.deepEqual(st, { ref: null, lag: 0 });
    // across the ±180° seam a small move is still small
    const seam = { ref: Math.PI - 0.02, lag: 1 };
    stickFrame(seam, -Math.PI + 0.02);
    assert.equal(seam.lag, 1);
    // walked right until the view was behind, then the thumb goes to straight up: the walk goes on the way the screen shows
    const rows = stickWalk((t) => (t < 3 ? 90 * DEG : 0), 5);
    const end = rows[rows.length - 1];
    assert.ok(Math.abs(wrap(end.travel - end.view)) < 2 * DEG);
    assert.ok(Math.abs(wrap(end.travel - rows[170].travel)) < 3 * DEG, 'the same heading as before: up on the screen was where it was going');
  });
  it('a tap that left the view where it was is not a drag', () => {
    assert.equal(viewDragged(0, 0), false);
    assert.equal(viewDragged(DRAG_MIN / 2, -DRAG_MIN / 2), false);
    assert.equal(viewDragged(0.1, 0), true);
    assert.equal(viewDragged(0, -0.1), true);
    assert.equal(viewDragged(Math.PI * 2 - 0.01, 0), false); // across the seam
    const w = read('timesSquare3d.js');
    assert.match(w, /if \(viewDragged\(controls\.getAzimuthalAngle\(\) - orbitYaw0, controls\.getPolarAngle\(\) - orbitPolar0\)\) orbitEnd = performance\.now\(\);/);
    assert.equal(/controls\.addEventListener\('end', \(\) => \{ orbiting = false; orbitEnd = performance\.now\(\); \}\)/.test(w), false);
  });
  it('the world reads the stick against the view less the lag, and the keys against the live view', () => {
    const w = read('timesSquare3d.js');
    const walk = w.slice(w.indexOf('function stepWalk(dt, input, auto) {'), w.indexOf('function stepDrive('));
    assert.match(walk, /stickFrame\(stick, input\.joy && !auto \? Math\.atan2\(input\.r, input\.f\) : null\);\n\s+if \(stick\.lag\) fwd\.applyAxisAngle\(UP, -stick\.lag\);/);
    assert.match(walk, /travel\.on = moving && \(input\.joy \|\| !!auto\);\n\s+if \(travel\.on\) travel\.yaw = Math\.atan2\(wish\.x, wish\.z\);/);
    const cam = w.slice(w.indexOf('// Camera: OrbitControls drives a wanted orbit'), w.indexOf('controls.target.copy(follow);\n    controls.update();'));
    assert.match(cam, /const scripted = !!\(cine && !cine\.back\);/);
    assert.match(cam, /turn = chaseYawRate\(\{ err, idleMs: now - orbitEnd, dragging: orbiting, scripted, backMs: autoWalk \? Infinity : backT \}\);/);
    assert.match(cam, /if \(stick\.ref != null\) stick\.lag \+= turn \* dt;/);
    // the avatar is never moved by the camera, and nothing here reaches the network
    assert.equal(/\bpos\.(x|z|set|copy)\b\s*(=|\()/.test(cam), false);
    assert.equal(/\bnet\b/.test(cam), false);
    // getting into a taxi and a teleport start the stick's frame again
    assert.match(w, /travel\.on = false; stick\.ref = null; stick\.lag = 0;/);
  });
});

describe('dragging the view, and less motion for those who ask for it', () => {
  it('a finger turns the view half as fast again as it did; a mouse as before', () => {
    assert.deepEqual(DRAG_SPEED, { touch: 1.28, low: 0.85, mouse: 0.6 });
    assert.equal(dragSpeed({ touch: true, low: true }), 1.28);
    assert.equal(dragSpeed({ touch: true }), 1.28);
    assert.equal(dragSpeed({ low: true }), 0.85);
    assert.equal(dragSpeed(), 0.6);
    assert.ok(near(DRAG_SPEED.touch / DRAG_SPEED.low, 1.5, 0.01));
    // OrbitControls: 2π x speed x drag / frame height. 96 px on an 812 px frame was 36° by the formula (31° measured);
    // now 54° (about 47° measured the same way): half a turn is a drag of one screen width, not one and a half
    const turn = (px, speed) => (2 * Math.PI * speed * px) / 812 / DEG;
    assert.ok(near(turn(96, 0.85), 36.2, 0.1) && near(turn(96, 1.28), 54.5, 0.1));
    assert.ok(180 / turn(1, 1.28) < 375 * 0.9);
    const w = read('timesSquare3d.js');
    assert.match(w, /controls\.rotateSpeed = dragSpeed\(\{ touch: isTouchUI\(\{ coarse: matchMedia\('\(pointer: coarse\)'\)\.matches, points: navigator\.maxTouchPoints \}\), low \}\);/);
  });
  it('prefers-reduced-motion: the scripted cameras cut where they used to glide', () => {
    assert.equal(glideMs(700), 700);
    assert.equal(glideMs(700, false), 700);
    assert.equal(glideMs(700, true), 1);
    assert.equal(glideMs(2200, true), 1);
    const w = read('timesSquare3d.js');
    assert.match(w, /const calm = matchMedia\('\(prefers-reduced-motion: reduce\)'\);/);
    // every glide starts in startCine, the intro or the way back: a board focus, the lounge tour, the look at the balloon.
    // Not the gift show's glides (film: true): gift.js records them for someone else, so they stay glides
    // (test/world-run.test.mjs runs it with reduced motion on), and so does the way back from it, which gift.js may still
    // be recording (it records 200 ms past the show).
    assert.match(w, /fov: o\.fov \|\| 0 \};\n(\s+\/\/[^\n]*\n)*\s+if \(o\.film\) cine\.film = true;\n\s+else cine\.dur = glideMs\(cine\.dur, calm\.matches\);/);
    const show = w.slice(w.indexOf('  function giftShow('), w.indexOf('  const LOUNGE_IDS'));
    assert.equal(show.match(/startCine\([^;]*film: true/g).length, 3);
    assert.equal(w.match(/film: true/g).length, 3); // nothing else opts out
    assert.match(w, /cine = \{ t0: performance\.now\(\), dur: glideMs\(2200, calm\.matches\), back: true, ease: 'inout', tell: true \};/);
    assert.equal(w.match(/dur: cine\.film \? RETURN_MS : glideMs\(RETURN_MS, calm\.matches\), back: true/g).length, 1);
    assert.equal(w.match(/dur: glideMs\(RETURN_MS, calm\.matches\), back: true/g).length, 1);
    // the four places a scripted camera gets its duration: startCine, the intro and the two ways back
    assert.equal(w.match(/\n\s+cine = \{/g).length, 4);
    assert.equal(w.match(/glideMs\(/g).length, 4);
  });
});

describe('the first throw\'s look up at the balloon', () => {
  it('waits for the pouch to leave the hand, goes 45% of the way from 2 m farther back, and ends when the old look did', () => {
    assert.deepEqual(BALLOON_LOOK, { after: 250, lerp: 0.45, back: 2, dur: 600, hold: 1250 });
    assert.equal(BALLOON_LOOK.after + BALLOON_LOOK.hold, 1500);
    assert.ok(BALLOON_LOOK.after >= THROW.swing * 1000, 'the arm has swung and the pouch is on its way');
    // the follow camera 8.2 m behind an avatar at the origin that faces +z; the balloon 58 m up, 80 m and 14 m away
    const cam = { x: 0, y: 3.15, z: -8.2 }, look = { x: 0, y: 1.9, z: 0 };
    for (const far of [80, 14]) {
      const balloon = { x: 0, y: 58, z: far };
      const v = balloonLook(cam, look, balloon);
      assert.ok(near(Math.hypot(v.cam.x - cam.x, v.cam.y - cam.y, v.cam.z - cam.z), 2, 1e-9));
      assert.ok(v.cam.z < cam.z && v.cam.y > cam.y, 'straight back along the view');
      assert.ok(near(v.look.y, 1.9 + 0.45 * 56.1, 1e-9) && near(v.look.z, 0.45 * far, 1e-9) && v.look.x === 0);
      // the balloon is inside an upright frame (36° either side of the view's axis) and a landscape one (31°)
      const up = (p) => Math.atan2(p.y - v.cam.y, p.z - v.cam.z) / DEG;
      assert.ok(Math.abs(up(balloon) - up(v.look)) < 31, `${far} m: ${(up(balloon) - up(v.look)).toFixed(0)}° off the axis`);
      // the avatar is under the frame for as long as the look lasts (45° below the axis and more): it has thrown by then
      assert.ok(up(v.look) - up({ y: 0, z: 0 }) > 36);
    }
    const w = read('timesSquare3d.js');
    const toss = w.slice(w.indexOf('function throwPouch() {'), w.indexOf('function updateThrows(dt) {'));
    assert.match(toss, /balloonSeen = true;\n\s+balloonLookAt = now \+ BALLOON_LOOK\.after;/);
    assert.equal(/startCine\(/.test(toss), false, 'the throw itself moves no camera');
    assert.match(w, /if \(balloonLookAt && now >= balloonLookAt\) lookAtBalloon\(now\);/);
    assert.match(w, /if \(drive \|\| cine \|\| !balloon \|\| balloon\.hp <= 0\) return;\n\s+const v = balloonLook\(camera\.position, viewLook, balloon\.mesh\.position\);/);
    assert.match(w, /\{ dur: BALLOON_LOOK\.dur, until: now \+ BALLOON_LOOK\.hold \}\);/);
  });
});

// The owner (2026-11-24): "카메라 시점 전환이 좀 어려워서 택시 운전이 어렵고.. 택시운전시에는 카메라 시점을 차 시점으로 고정해줘야".
/** The driving orbit frame by frame. car(t) -> the car's turn rate (rad/s). -> rows { t, off: how far the view is from straight behind }. */
function driveRun(car, seconds, { theta = Math.PI, idle = () => Infinity, dragging = () => false, aspect = 16 / 9, reverseT = () => 0, phi = 1.2 } = {}) {
  const rows = [], dt = 1 / 60, o = { theta, phi };
  let yaw = 0;
  for (let t = 0; t < seconds; t += dt) {
    const turned = car(t) * dt;
    yaw += turned;
    driveCamera({ theta: o.theta, phi: o.phi, yaw, turned, dt, idleMs: idle(t), dragging: dragging(t), aspect, reverseT: reverseT(t) }, o);
    rows.push({ t, off: wrap(yaw + Math.PI - o.theta), phi: o.phi });
  }
  return rows;
}
describe('driving camera: fixed to the car', () => {
  it('in a full-lock turn the view trails by 6.5°, inside what an upright phone shows; the old rule trailed by 45°', () => {
    const STEER = 1.9; // CAR.steer: the car's fastest turn, rad/s
    assert.match(read('timesSquare3d.js'), /const CAR = \{[^}]*steer: 1\.9,/);
    const rows = driveRun(() => STEER, 4, { aspect: 375 / 812 });
    const lag = Math.abs(rows[rows.length - 1].off) / DEG;
    assert.ok(near(lag, ((1 - DRIVE_CAM.ride) * STEER) / DRIVE_CAM.gain / DEG, 0.6), String(lag));
    assert.ok(lag < 7);
    const half = halfAcross(375, 812, portraitFov(375 / 812, 62) + driveWiden(375 / 812, 0));
    assert.ok(half > 20 && half < 21, String(half));
    assert.ok(lag < half / 3);
    assert.ok(Math.max(...rows.map((r) => Math.abs(r.off))) / DEG < 7, 'never farther behind on the way into the turn');
    // before: nothing under 3 m/s, then the gap closed at 2.4 / s: 1.9 / 2.4 rad behind the car, off an upright screen
    assert.ok((STEER / 2.4) / DEG > 45 && (STEER / 2.4) / DEG > halfAcross(375, 812, 72 + 10));
  });
  it('turns with the car at any speed: no 3 m/s gate, a car turning on the spot keeps its view', () => {
    const slow = driveRun(() => 0.43, 3); // under 1.6 m/s the car still turns at 1.9 x 1.6 / 7 rad/s
    assert.ok(Math.abs(slow[slow.length - 1].off) / DEG < 2);
    const w = read('timesSquare3d.js');
    assert.equal(/driveCam\.swing|swingMin|driveCam\.front/.test(w + read('camrig.js')), false);
    const cam = w.slice(w.indexOf('// Camera: OrbitControls drives a wanted orbit'), w.indexOf('controls.target.copy(follow);\n    controls.update();'));
    assert.match(cam, /if \(drive\) \{/);
    assert.match(cam, /driveCamera\(\{ theta: Math\.atan2\(off\.x, off\.z\), phi: Math\.acos\(clamp\(off\.y \/ r, -1, 1\)\), yaw: drive\.yaw, turned: wrapAngle\(drive\.yaw - driveYaw0\), dt, idleMs: now - orbitEnd, dragging: orbiting, aspect: camera\.aspect, reverseT \}, driveOrbit\);/);
    assert.equal(/drive\.v\b[^\n]*driveCamera|Math\.abs\(drive\.v\) >=/.test(cam), false);
  });
  it('a drag looks around; a quarter second after it ends the view is on its way back, and is behind the car in about a second', () => {
    assert.equal(DRIVE_CAM.holdMs, 250);
    // dragging: the view only rides the car's turn
    const o = driveCamera({ theta: 1, phi: 0.9, yaw: 0, turned: 0, dt: 1 / 60, dragging: true });
    assert.deepEqual([o.theta, o.phi], [1, 0.9]);
    assert.ok(near(driveCamera({ theta: 1, phi: 0.9, yaw: 0.1, turned: 0.1, dt: 1 / 60, dragging: true }).theta, 1 + DRIVE_CAM.ride * 0.1, 1e-12));
    assert.equal(driveCamera({ theta: 1, phi: 0.9, yaw: 0, turned: 0, dt: 1 / 60, idleMs: 200 }).theta, 1);
    assert.notEqual(driveCamera({ theta: 1, phi: 0.9, yaw: 0, turned: 0, dt: 1 / 60, idleMs: 300 }).theta, 1);
    // from a look straight ahead of the car (180° off), parked: back within 5° in 1.2 s of the finger lifting, 60° off in 0.9 s
    for (const [deg, max] of [[180, 1.2], [90, 1.0], [60, 0.9]]) {
      const rows = driveRun(() => 0, 3, { theta: Math.PI - deg * DEG, idle: (t) => t * 1000 });
      const back = rows.find((r) => Math.abs(r.off) < 5 * DEG);
      assert.ok(back && back.t <= max, `${deg}°: ${back?.t.toFixed(2)} s`);
      assert.ok(Math.abs(rows[rows.length - 1].off) < 0.2 * DEG);
      for (let i = 1; i < rows.length; i++) assert.ok(Math.abs(rows[i].off) <= Math.abs(rows[i - 1].off) + 1e-9, 'never overshoots');
    }
    // the same while driving and turning
    const moving = driveRun(() => 1, 3, { theta: Math.PI - 2, idle: (t) => t * 1000 });
    assert.ok(Math.abs(moving[moving.length - 1].off) / DEG < 4);
  });
  it('stands higher and farther back in an upright frame, with a wider lens', () => {
    assert.equal(tallness(16 / 9), 0);
    assert.equal(tallness(1), 0);
    assert.equal(tallness(375 / 812), 1);
    assert.ok(tallness(0.9) > 0 && tallness(0.9) < 1);
    assert.equal(tallness(NaN), 0);
    assert.deepEqual(driveView({ aspect: 812 / 375 }), { dist: 11.5, polar: 1.2 });
    assert.deepEqual(driveView({ aspect: 375 / 812 }), { dist: 13, polar: 1.08 });
    assert.equal(driveWiden(812 / 375, 0), 0);
    assert.equal(driveWiden(375 / 812, 0), 6);
    assert.equal(driveWiden(375 / 812, 31), 16);
    assert.ok(near(driveWiden(16 / 9, -15), 5, 1e-9));
    // the orbit eases to that angle (within 0.02 rad in a second and a half), in both shapes
    for (const [aspect, polar] of [[812 / 375, 1.2], [375 / 812, 1.08]]) {
      const rows = driveRun(() => 0, 1.5, { aspect, phi: 1.5 });
      assert.ok(Math.abs(rows[rows.length - 1].phi - polar) < 0.02, String(rows[rows.length - 1].phi));
    }
    const w = read('timesSquare3d.js');
    assert.match(w, /rescaleOrbit\(driveView\(\{ aspect: camera\.aspect \}\)\.dist\);\n\s+driveYaw0 = t\.yaw;/);
    assert.match(w, /const p = behindCar\(follow, drive\.yaw, d, seat\.polar\);/);
    // getting out goes back to the walking view (8.5 m away, 1.25 m above the eye line), not the driving view's height
    const exit = w.slice(w.indexOf('function exitTaxi()'), w.indexOf('function interact()'));
    assert.match(exit, /const side = Math\.atan2\(camWant\.x - follow\.x, camWant\.z - follow\.z\);\n\s+follow\.set\(pos\.x, pos\.y \+ eye, pos\.z\);\n\s+camWant\.set\(follow\.x \+ Math\.sin\(side\) \* 8\.4, follow\.y \+ 1\.25, follow\.z \+ Math\.cos\(side\) \* 8\.4\);/);
    assert.ok(near(Math.hypot(8.4, 1.25), 8.5, 0.01));
  });
  it('stays behind the car in reverse and rises to show the ground behind it after 0.6 s', () => {
    assert.equal(DRIVE_CAM.reverseHold, 0.6);
    let t = 0;
    for (let i = 0; i < 30; i++) t = reverseTime(t, -4, 1 / 60); // half a second in reverse
    assert.ok(near(t, 0.5, 1e-6));
    assert.equal(driveView({ aspect: 1, reverseT: t }).polar, 1.2);
    for (let i = 0; i < 12; i++) t = reverseTime(t, -4, 1 / 60);
    assert.equal(driveView({ aspect: 1, reverseT: t }).polar, DRIVE_CAM.reversePolar);
    assert.equal(driveView({ aspect: 375 / 812, reverseT: t }).polar, DRIVE_CAM.reversePolar);
    // rolling forward again resets the clock
    assert.equal(reverseTime(t, 0.5, 1 / 60), 0);
    // the heading it wants never flips to the car's nose: after 3 s in reverse the view is still straight behind
    const rows = driveRun(() => 0, 3, { reverseT: (s) => s });
    assert.ok(Math.abs(rows[rows.length - 1].off) < 1e-9);
    assert.ok(Math.abs(rows[rows.length - 1].phi - DRIVE_CAM.reversePolar) < 0.01);
    // from 0.8 rad up at 11.5 m the bottom of a 62° frame reaches the ground 5 m behind the car's follow point (2.5 m up)
    const up = 2.5 + 11.5 * Math.cos(0.8), back = 11.5 * Math.sin(0.8), down = Math.PI / 2 - 0.8 + 31 * DEG;
    assert.ok(back - up * Math.tan(Math.PI / 2 - down) > 5);
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
    // the board camera does it inside camrig.js boardVantage, with the map's own ray test (test/boards.test.mjs runs it on the map)
    assert.match(read('camrig.js'), /const stand = shortenFocus\(d, clear, \{ start: S \}\);/);
    assert.match(w, /Math\.min\(nyc\.rayBlock\(ax, ay, az, bx, by, bz\), hitFace\(ax, ay, az, bx, by, bz\)\)/);
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
    const at = w.indexOf("capture({ me: withMe = false, band = '', photo = '' } = {}) {"), cap = w.slice(at, w.indexOf('g.fillText(words', at));
    assert.ok(at > 0 && cap.length > 100);
    assert.ok(cap.indexOf('me.tag.visible = !!withMe;') > 0 && cap.indexOf('me.tag.visible = !!withMe;') < cap.indexOf('composer.render()'), 'without { me: true } my tag is off for the render');
    assert.match(cap, /const words = String\(band \|\| ''\) \|\| 'WISH BOARD · 모두의 전광판';/, 'the default band is today\'s');
    assert.match(cap, /finally \{ me\.tag\.visible = tagOn; \}/);
  });
  it('rings are quiet while their gap runs (no points: PLAY.ring), and a lost context is handled', () => {
    const w = read('timesSquare3d.js');
    assert.match(w, /const ringWait = now - stuntAt < PLAY\.ring\.gapMs \+ 250;/);
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
    assert.match(pose, /const face = clear \? boards\.face\(slotId\) : null;\n\s+const vfov = portraitFov\(camera\.aspect, baseFov\);/);
    // with the map: boardVantage fits the face (boardRange, then the wall test); without it yet, the plain fit
    assert.match(pose, /boardVantage\(\{ face: \{ x: p\.x, y: p\.y, z: p\.z, nx: f\.x, nz: f\.z, w: face\.w, h: face\.h \}, dist, aspect: camera\.aspect, vfov,/);
    assert.match(pose, /if \(face\) dist = boardRange\(dist, frameDistance\(\{ w: face\.w, h: face\.h, aspect: camera\.aspect, vfov \}\)\);/);
    const v = read('camrig.js');
    const fn = v.slice(v.indexOf('export function boardVantage('), v.indexOf('// ---- driving camera'));
    assert.ok(fn.indexOf('boardRange(') > 0 && fn.indexOf('boardRange(') < fn.indexOf('shortenFocus('));
    assert.equal(/camera\.fov/.test(pose), false); // not the FOV in mid-ease
    // focus / claim, lounge (both orientations) and the photo frame all ask with clear = true
    assert.match(w, /const pose = slotPose\(slotId, 18, true\);/);
    assert.match(w, /const pose = framePose\(id\);/);
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
    const go = w.slice(w.indexOf('goToSlot(slotId, { spread } = {}) {'), w.indexOf('cineOn:'));
    // The front point itself, unless a ceremony arrival asks for its spread spot (and that spot is inside the fence).
    assert.match(go, /let tx = pose\.front\.x, tz = pose\.front\.z;\n      if \(spread != null && Number\.isFinite\(Number\(spread\)\)\) \{/);
    assert.match(go, /if \(insideLoop\(sx, sz, 0\) && !approachOf\(sx, sz\)\) \{ tx = sx; tz = sz; break; \}\n        \}\n      \}\n      api\.teleport\(tx, tz\);/);
    assert.match(go, /insideLoop\(pose\.front\.x, pose\.front\.z, 0\)/);
  });
  it('the lounge tour chains board to board and refuses in a taxi', () => {
    const w = read('timesSquare3d.js');
    const tour = w.slice(w.indexOf('function tourNext()'), w.indexOf('function taxiCanSit('));
    assert.match(tour, /startCine\(pose\.cam, pose\.look, \{ dur: first \? 1100 : 1800, fov \}\);/);
    assert.equal(/until/.test(tour), false); // no timed return between boards
    assert.match(w, /startLounge\(\) \{\n\s+if \(drive\) \{ tell\('운전 중에는 내린 뒤에 볼 수 있어요'\); return false; \}/);
    const main = read('main.js');
    assert.match(main, /if \(world\.startLounge\(\) === false\) \{ loungeOn = false; return; \}/);
    // reward timing and message are untouched
    assert.match(main, /if \(!payBonus\('lounge', PAY\.lounge\.base\) && !loungeTold\)/);
    assert.match(main, /\}, PAY\.lounge\.gapMs\);/);
  });
});

describe('a reached waypoint', () => {
  // The bake tutorial opened the claim wizard at the free slot's waypoint; with it gone nothing waits for an arrival.
  it('the guide goes out when the player is within 7 m, and nobody is told', () => {
    const w = read('timesSquare3d.js');
    // (the auto-walk goes on to the end of its route first: test/interact.test.mjs)
    assert.match(w, /if \(waypoint && !autoWalk && Math\.hypot\(pos\.x - waypoint\.x, pos\.z - waypoint\.z\) < 7\) setWaypoint\(null\);/);
    assert.equal(w.includes("'arrive'"), false);
    assert.equal(/'arrive'|ftueApi|onWaypoint\?\.\(info\)/.test(read('main.js')), false);
  });
});

// ---- 점등식: the group photo's pose and where each arrival stands (plan decisions 14 and 16) ------------------------------------------
import { cerShotPose, cerSpread, CER_SHOT } from '../camrig.js';
// Project p for a camera at cam looking at look with the vertical fov (deg) in a frame of this aspect: [x, y] in NDC, or null behind it.
function shotNdc(p, { cam, look, fov }, aspect) {
  const f = [look.x - cam.x, look.y - cam.y, look.z - cam.z], fl = Math.hypot(...f); f[0] /= fl; f[1] /= fl; f[2] /= fl;
  const r = [-f[2], 0, f[0]], rl = Math.hypot(...r); r[0] /= rl; r[2] /= rl; // f x up
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]; // r x f
  const v = [p.x - cam.x, p.y - cam.y, p.z - cam.z], z = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
  if (!(z > 0)) return null;
  const tv = Math.tan((fov * Math.PI) / 360), th = tv * aspect;
  return [(v[0] * r[0] + v[2] * r[2]) / (z * th), (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / (z * tv)];
}
const SHOT_FACES = {
  street: { pos: { x: 40, y: 9, z: -20 }, normal: { x: -1, z: 0 }, w: 12, h: 6.75 }, // a wall face on the avenue
  lot: { pos: { x: 12, y: 7, z: 300 }, normal: { x: -Math.cos(0.35), z: -Math.sin(0.35) }, w: 20, h: 11 }, // turned 20° toward the entrance
};
const SHOT_ASPECTS = { '9:19.5': 9 / 19.5, '9:16': 9 / 16, '16:9': 16 / 9, '19.5:9': 19.5 / 9 };
// The face's corners, the front point 9 m out, and the crowd box: ±4 m to the side, 0..3 m out, 0..1.9 m up.
function shotScene(F) {
  const { pos, normal: n, w, h } = F, r = { x: n.z, z: -n.x }, front = { x: pos.x + n.x * 9, z: pos.z + n.z * 9 };
  const face = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => ({ x: pos.x + r.x * a * w / 2, y: pos.y + b * h / 2, z: pos.z + r.z * a * w / 2 }));
  const crowd = [];
  for (const u of [-4, 4]) for (const d of [0, 3]) for (const y of [0, 1.9]) crowd.push({ x: front.x + r.x * u + n.x * d, y, z: front.z + r.z * u + n.z * d });
  return { front, face, crowd };
}
const inFrame = (q) => !!q && Math.abs(q[0]) <= 0.95 + 1e-9 && Math.abs(q[1]) <= 0.95 + 1e-9;
describe('cerShotPose: the board whole and the crowd in front of it, from behind the crowd', () => {
  for (const [kind, F] of Object.entries(SHOT_FACES)) {
    for (const [name, aspect] of Object.entries(SHOT_ASPECTS)) {
      it(`${kind} face, ${name}: every corner of the face and of the crowd inside NDC ±0.95, the camera behind the crowd on the normal`, () => {
        const { front, face, crowd } = shotScene(F);
        const pose = cerShotPose({ ...F, front, aspect, fov: 55 });
        assert.ok(pose && pose.cam && pose.look && pose.fov > 0);
        for (const p of [...face, ...crowd]) assert.ok(inFrame(shotNdc(p, pose, aspect)), `${JSON.stringify(p)} -> ${shotNdc(p, pose, aspect)}`);
        const along = (pose.cam.x - F.pos.x) * F.normal.x + (pose.cam.z - F.pos.z) * F.normal.z;
        const off = Math.abs((pose.cam.x - F.pos.x) * F.normal.z - (pose.cam.z - F.pos.z) * F.normal.x);
        assert.ok(off <= 0.01, 'on the normal: ' + off);
        assert.ok(along > 9 + 3, 'farther out than the front point and the crowd\'s back row: ' + along);
        assert.ok(pose.cam.y > 1.7, 'above eye level');
        if (aspect < 1) assert.ok(shotNdc(F.pos, pose, aspect)[1] > 0, 'portrait: the face centre above the middle of the screen');
        // The board is the subject, not lost in the frame.
        const span = Math.abs(shotNdc(face[1], pose, aspect)[0] - shotNdc(face[0], pose, aspect)[0]) / 2;
        assert.ok(span >= (aspect < 1 ? 0.5 : 0.25), `the face spans ${span.toFixed(2)} of the width`);
      });
    }
  }
  it('portrait stands farther back than landscape for the same face (the full width at 90 % of the narrow frame)', () => {
    const F = SHOT_FACES.street, { front } = shotScene(F);
    const d = (a) => { const p = cerShotPose({ ...F, front, aspect: a, fov: 55 }); return Math.hypot(p.cam.x - F.pos.x, p.cam.z - F.pos.z); };
    assert.ok(d(9 / 19.5) > d(16 / 9));
  });
  it('with something in the way it keeps the face and the crowd in view: nearer, higher or wider, never on the far side of the wall', () => {
    const F = SHOT_FACES.street, { front, face, crowd } = shotScene(F), aspect = 9 / 16;
    const free = cerShotPose({ ...F, front, aspect, fov: 55 });
    const D = Math.hypot(free.cam.x - F.pos.x, free.cam.z - F.pos.z);
    // A wall across the normal 3 m nearer the face than the free pose: a segment that crosses it is cut there.
    const wx = F.pos.x - (D - 3);
    const block = (ax, ay, az, bx) => ((ax - wx) * (bx - wx) > 0 ? 1 : Math.abs((ax - wx) / (bx - ax)));
    const pose = cerShotPose({ ...F, front, aspect, fov: 55, block });
    assert.ok(pose.cam.x > wx, 'on the board\'s side of the wall: ' + pose.cam.x);
    assert.equal(pose.seen, 1, 'every sample point seen');
    for (const p of [...face, ...crowd]) assert.ok(inFrame(shotNdc(p, pose, aspect)), String(shotNdc(p, pose, aspect)));
    assert.ok(pose.fov >= free.fov && pose.fov <= free.fov + CER_SHOT.widen);
    // Nothing clear from anywhere: still a pose (the free one), and it says how much it saw.
    const wall = cerShotPose({ ...F, front, aspect, fov: 55, block: () => 0 });
    assert.ok(wall.cam && wall.seen === 0);
  });
  it('a block that never blocks gives the free pose', () => {
    const F = SHOT_FACES.lot, { front } = shotScene(F);
    assert.deepEqual(cerShotPose({ ...F, front, aspect: 16 / 9, fov: 55, block: () => 1 }), cerShotPose({ ...F, front, aspect: 16 / 9, fov: 55 }));
  });
});
describe('cerSpread: where each device stands in front of the board', () => {
  it('stays in range, and two seeds give two spots', () => {
    for (const s of [0, 0.5, 0.999, 0.25, 0.75, 0.123, NaN, -1, 1, 7.5, undefined]) {
      const p = cerSpread(s);
      assert.ok(p.u >= -4 && p.u <= 4 && p.n >= 0 && p.n <= 3, String(s) + ' ' + JSON.stringify(p));
    }
    const a = cerSpread(0.2), b = cerSpread(0.7);
    assert.ok(Math.hypot(a.u - b.u, a.n - b.n) > 0.5);
  });
});

// ---- 점등식: the group photo is its own 3:2 render, composed for the people ---------------------------------------------------
import { cerPhotoPose, cerLabels, CER_PHOTO } from '../camrig.js';
describe('cerPhotoPose: 3:2, the people large and above the band, the board whole above them', () => {
  const A = CER_PHOTO.w / CER_PHOTO.h, bandLine = -1 + 2 * CER_PHOTO.band;
  // A street wall face (12 x 6.75, bottom 4 m up), a lot face turned 20° (20 x 11), STREET_1's 22 m face (22 x 12.375 at 12.2 m).
  const FACES = {
    street: { pos: { x: 40, y: 7.4, z: -20 }, normal: { x: -1, z: 0 }, w: 12, h: 6.75 },
    lot: { pos: { x: 12, y: 7, z: 300 }, normal: { x: -Math.cos(0.35), z: -Math.sin(0.35) }, w: 20, h: 11 },
    widest: { pos: { x: 48.9, y: 12.2, z: 203.8 }, normal: { x: -0.9655, z: 0.2605 }, w: 22, h: 12.375 },
  };
  for (const [kind, F] of Object.entries(FACES)) {
    it(`${kind} face: the board's corners in the frame, the crowd box (with its names) above the band, the people large`, () => {
      const { front, face, crowd } = shotScene(F);
      const pose = cerPhotoPose({ ...F, front });
      assert.ok(pose && pose.cam && pose.fov <= CER_PHOTO.fovMax, JSON.stringify(pose));
      for (const p of face) { const q = shotNdc(p, pose, A); assert.ok(q && Math.abs(q[0]) <= 1 && q[1] <= 1 && q[1] > bandLine, 'face ' + q); }
      const r = { x: F.normal.z, z: -F.normal.x };
      const box = [...crowd, ...crowd.filter((p) => p.y > 1).map((p) => ({ ...p, y: CER_PHOTO.tag }))];
      for (const p of box) { const q = shotNdc(p, pose, A); assert.ok(q && Math.abs(q[0]) <= 1 && q[1] <= 1 && q[1] > bandLine, 'crowd ' + q); }
      // A 1.8 m avatar on the front row (the farthest from the camera) is at least 16 % of the picture's height.
      for (const u of [-4, 0, 4]) {
        const foot = { x: front.x + r.x * u, y: 0, z: front.z + r.z * u }, head = { ...foot, y: 1.8 };
        const size = (shotNdc(head, pose, A)[1] - shotNdc(foot, pose, A)[1]) / 2;
        // STREET_1's face is 22 m wide and its top 18 m up: the one board here where the people give way a little (15 %).
        assert.ok(size >= (kind === 'widest' ? 0.15 : CER_PHOTO.body) - 0.005, `${kind}: an avatar at ${u} m is ${(size * 100).toFixed(1)} % tall`);
      }
      assert.ok(shotNdc(F.pos, pose, A)[1] > 0, 'the board in the upper part');
      const along = (pose.cam.x - F.pos.x) * F.normal.x + (pose.cam.z - F.pos.z) * F.normal.z;
      assert.ok(along >= 9 + 3 + CER_PHOTO.behind - 1e-9, 'behind the back row');
      assert.ok(pose.cam.y <= 3.5, 'about chest to eye height');
      assert.equal(pose.pass, kind === 'widest' ? 2 : 1);
    });
  }
  it('the people shrink last: a wider face first keeps them large, then (past a width) the size rule gives way, never the board', () => {
    let shrink = 0;
    for (let w = 12; w <= 60; w += 2) {
      const F = { pos: { x: 40, y: 4 + w * 9 / 32, z: -20 }, normal: { x: -1, z: 0 }, w, h: w * 9 / 16 }, { front, face } = shotScene(F);
      const pose = cerPhotoPose({ ...F, front });
      for (const p of face) { const q = shotNdc(p, pose, A); assert.ok(q && Math.abs(q[0]) <= 1 && q[1] <= 1, `${w} m: the face whole`); }
      if (pose.pass > 1 && !shrink) shrink = w;
    }
    assert.ok(shrink >= 24, 'STREET_1 (22 m) and every narrower face keep the people large: from ' + shrink + ' m');
    console.log('# the people start to shrink at a 16:9 face ' + shrink + ' m wide (bottom 4 m up)');
  });
  it('with the view blocked it turns along the street rather than shoot a wall', () => {
    const F = FACES.street, { front } = shotScene(F);
    const free = cerPhotoPose({ ...F, front });
    const wx = F.pos.x - (free.dist - 1); // a wall across the normal just in front of the free pose
    const block = (ax, ay, az, bx) => ((ax - wx) * (bx - wx) > 0 ? 1 : 0);
    const pose = cerPhotoPose({ ...F, front, block });
    assert.equal(pose.seen, 1);
    assert.ok(pose.cam.x > wx);
  });
});
describe('cerLabels: the names on the photo', () => {
  const W = 1200, H = 800, size = 22;
  it('one label over each head, nearest first, inside the frame and above the band, overlaps moved up or left out', () => {
    const items = [
      { x: 600, y: 400, depth: 5, text: '민지' }, { x: 610, y: 405, depth: 9, text: '지수' }, { x: 612, y: 402, depth: 12, text: '셋째' },
      { x: 615, y: 400, depth: 14, text: '넷째' }, { x: 5, y: 300, depth: 8, text: '가장자리친구' }, { x: 900, y: 780, depth: 6, text: '띠아래' }, { x: -20, y: 300, depth: 3, text: '밖' },
    ];
    const out = cerLabels(items, W, H, size);
    const names = out.map((o) => o.text);
    assert.deepEqual(names.slice(0, 1), ['민지'], 'nearest first');
    assert.ok(names.includes('지수') && names.includes('가장자리친구'));
    assert.equal(names.includes('띠아래'), false, 'a head under the band has no label');
    assert.equal(names.includes('밖'), false);
    assert.equal(names.includes('넷째'), false, 'the fourth stacked label is left out');
    for (const o of out) {
      assert.ok(o.x - o.w / 2 >= 0 && o.x + o.w / 2 <= W && o.y - o.h / 2 >= 0 && o.y + o.h / 2 <= H * (1 - CER_PHOTO.band), JSON.stringify(o));
      for (const p of out) if (p !== o) assert.ok(!(Math.abs(o.x - p.x) < (o.w + p.w) / 2 && Math.abs(o.y - p.y) < (o.h + p.h) / 2), 'no overlap');
    }
    assert.ok(size >= 16 * W / 1200, 'at least 16 px at 1200 px wide');
  });
});
