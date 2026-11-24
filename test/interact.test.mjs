// U5 "interactions and feedback": the pure rules in interact.js and audio.js, and the wiring that must keep using them.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { gunzipSync } from 'node:zlib';
import {
  taxiExit, EXIT_SLOW, EXIT_CONFIRM_MS, nextOfferDelay, fareWait, FARE_GAP_S, OFFER_MIN_S, OFFER_RIDE_S,
  stickZone, stickVec, isTouchUI, STICK_W, STICK_H, STICK_THROW, STICK_ENGAGE,
  AUTO_WALK, gridPath, walkSteer, walkStall, walkPace, autoWalkEnds,
  bakeFlip, bakeBest, BAKE_FLIPS, BAKE_ROUND_MS,
} from '../interact.js';
import { PLAY } from '../balance.js';
import { createNYC } from '../ts3d/nyc.js';
import { LOOP, LAYOUT, SKIP_ZONES, PLOT_SLOTS } from '../ts3d/layout.js';
import { touchTag } from '../overlay.js';

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
    assert.equal(/E를 누르세요'/.test(main.replace("TOUCH ? '탑승 버튼을 누르세요' : 'E를 누르세요'", '')), false);
  });
  it('phone prompts do not name keys, and no prompt line says which button to press', () => {
    const ui = read('ui.js');
    const prompts = ui.slice(ui.indexOf('  const PROMPTS = {'), ui.indexOf('  let focusOn = false'));
    // the lines that only said "press the button to start" are gone (the round button on a phone, the E key cap on a keyboard say it)
    assert.equal(/버튼을 누르면|Space 또는 E|E를 누르면|지나가는 택시는 타지 않아요|점수도 보상도 없는/.test(ui), false);
    assert.match(prompts, /cart: \['붕어빵 굽기', '세 번 뒤집어요', '굽기!'\],/);
    assert.match(prompts, /stage: \['같이 춤추기', '모두 같은 음악에 같은 춤', '춤추기'\],/);
    assert.match(prompts, /taxi: \['정차한 택시 탑승', '', '탑승'\],/);
    assert.equal(/'Space 또는 E · /.test(ui), false);
    assert.equal(/붕어빵 포차와는 다른 자리예요/.test(ui), false);
    // a phone shows a tag beside the round button (a plain box, no key cap, no taps); a keyboard keeps the E button
    assert.match(ui, /const promptBtn = coarse\n\s+\? h\('div', \{ class: 'glass tag' \}, promptText, promptSub\)\n\s+: h\('button', \{ class: 'glass', type: 'button', onclick: \(\) => hooks\.interact\(\) \}, h\('span', \{ class: 'keycap', text: 'E' \}\),/);
    assert.equal(ui.includes("text: coarse ? '탭' : 'E'"), false);
    assert.match(ui, /const tag = touchTag\(near\.kind, p\);\n\s+promptText\.textContent = coarse \? tag\[0\] : p\[0\];\n\s+promptSub\.textContent = coarse \? tag\[1\] : p\[1\];\n\s+paintAct\(p\[2\], tag\[0\]\);/);
  });
  it('the tag is one line: a board is "where · whose", a 함성 keeps its countdown, the rest is the name alone', () => {
    assert.deepEqual(touchTag('board', ['빈 전광판 · 소원 걸기', '37번 메인거리', '걸기']), ['37번 메인거리 · 빈 전광판', '']);
    assert.deepEqual(touchTag('board', ['브로드웨이곰33님의 전광판 · 응원하기', '46번 메인거리', '응원']), ['46번 메인거리 · 브로드웨이곰33님의 전광판', '']);
    assert.deepEqual(touchTag('board', ['곧 열리는 전광판', '', '보기']), ['곧 열리는 전광판', '']);
    assert.deepEqual(touchTag('crowd', ['같이 함성 · 옆 2명', '다음 함성까지 12초', '함성']), ['같이 함성 · 옆 2명', '다음 함성까지 12초']);
    assert.deepEqual(touchTag('cart', ['붕어빵 굽기', '세 번 뒤집어요', '굽기!']), ['붕어빵 굽기', '']);
    assert.deepEqual(touchTag('plot', null), ['', '']);
    // the tag takes no touches, so a drag that starts on it turns the view
    const css = read('index.html');
    assert.match(css, /html\.touch \.prompt\.show \{ transform: none; pointer-events: none !important; \}/);
    // the round button carries the whole name for a screen reader, its short word still first (label in name)
    assert.match(read('ui.js'), /const name = what \? `\$\{word\}: \$\{what\}` : word;/);
    // driving: short words that fit the 52px circle (택시 내리기 broke as 택시 내 / 리기)
    assert.match(read('ui.js'), /const label = hd\.exiting \? '멈춤…' : hd\.exitArmed \? '한 번 더' : '내리기';/);
  });
});

// The owner (2026-11-24): "길찾기 기능은 누르면 자동으로 가는 기능이 있으면 좋겠어. 길찾는게 어렵다".
const boxes = (list, pad = AUTO_WALK.clear) => (x, z) => list.some((b) => x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad);
const FIELD = { x0: 0, x1: 60, z0: 0, z1: 60 };
/** Metres of a route, and how many points along it (every 0.2 m) `blocked` says nobody can stand on. */
function walked(points, blocked) {
  let len = 0, bad = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1], q = points[i], d = Math.hypot(q.x - p.x, q.z - p.z);
    len += d;
    for (let s = 0; s <= d; s += 0.2) if (blocked(p.x + ((q.x - p.x) * s) / d, p.z + ((q.z - p.z) * s) / d)) bad++;
  }
  return { len, bad };
}
describe('auto-walk: a route over walkable ground', () => {
  it('goes straight over open ground, testing only the cells on the way', () => {
    assert.deepEqual([AUTO_WALK.cell, AUTO_WALK.clear], [1.5, 0.8]);
    assert.ok(AUTO_WALK.clear > AUTO_WALK.cell / 2, 'no wall fits unseen between two walkable neighbours');
    const from = { x: 5, z: 5 }, to = { x: 52, z: 41 };
    const r = gridPath({ from, to, bounds: FIELD, blocked: () => false });
    assert.deepEqual(r.points, [from, to]);
    assert.equal(r.exact, true);
    assert.ok(r.cells < 0.25 * 40 * 40, String(r.cells));
    // standing on the target already
    assert.deepEqual(gridPath({ from, to: { x: 5.2, z: 5.1 }, bounds: FIELD, blocked: () => false }).points, [from, { x: 5.2, z: 5.1 }]);
    assert.equal(gridPath({ from, to, bounds: FIELD }), null);
    assert.equal(gridPath({ from, to: null, bounds: FIELD, blocked: () => false }), null);
  });
  it('walks round a wall instead of into it, by a route close to the shortest one', () => {
    const wall = [{ x0: 28, x1: 32, z0: 0, z1: 45 }], blocked = boxes(wall), hard = boxes(wall, 0.36);
    const from = { x: 10, z: 10 }, to = { x: 50, z: 10 };
    const r = gridPath({ from, to, bounds: FIELD, blocked });
    assert.ok(r && r.exact);
    assert.deepEqual([r.points[0], r.points[r.points.length - 1]], [from, to]);
    const w = walked(r.points, hard);
    assert.equal(w.bad, 0, 'no step of it is inside the wall, for a walker 0.36 m round');
    // the shortest way round the wall's free end (z 45), with the same clearance
    const best = Math.hypot(27.2 - 10, 45.8 - 10) + 5.6 + Math.hypot(50 - 32.8, 45.8 - 10);
    assert.ok(w.len < best * 1.12, `${w.len.toFixed(1)} m against ${best.toFixed(1)} m`);
    assert.ok(r.points.length <= 7, String(r.points.length)); // a few straight legs, not a staircase of cells
    // the plan may cut a corner by a few centimetres (it reads cells); the lane it keeps clear never touches the wall itself
    assert.equal(walked(r.points, boxes(wall, 0)).bad, 0);
  });
  it('never squeezes between two blocks that touch at a corner', () => {
    const blocks = [{ x0: 20, x1: 30, z0: 20, z1: 30 }, { x0: 30, x1: 40, z0: 30, z1: 40 }];
    const r = gridPath({ from: { x: 22, z: 38 }, to: { x: 38, z: 22 }, bounds: FIELD, blocked: boxes(blocks) });
    assert.ok(r && r.exact);
    assert.equal(walked(r.points, boxes(blocks, 0.36)).bad, 0);
    assert.ok(walked(r.points, () => false).len > 30, 'round one of the blocks, not through the corner (22.6 m)');
  });
  it('a target inside something ends at the nearest ground beside it; one that cannot be reached, at the nearest ground that can', () => {
    // a board on its wall, the ATM itself, a tap on a block of the map
    const block = [{ x0: 30, x1: 50, z0: 20, z1: 40 }], blocked = boxes(block);
    const to = { x: 33, z: 30 }, r = gridPath({ from: { x: 5, z: 30 }, to, bounds: FIELD, blocked });
    assert.ok(r && !r.exact);
    const end = r.points[r.points.length - 1];
    assert.equal(blocked(end.x, end.z), false);
    assert.ok(Math.hypot(end.x - to.x, end.z - to.z) < 3 + AUTO_WALK.clear + AUTO_WALK.cell * 1.5, 'beside the block face nearest to the target');
    assert.ok(end.x < 30);
    assert.equal(walked(r.points, boxes(block, 0.36)).bad, 0);
    // a yard walled in on every side: the walk ends outside the wall, on the side it came from
    const yard = [{ x0: 38, x1: 56, z0: 38, z1: 40 }, { x0: 38, x1: 56, z0: 54, z1: 56 }, { x0: 38, x1: 40, z0: 38, z1: 56 }, { x0: 54, x1: 56, z0: 38, z1: 56 }];
    const y = gridPath({ from: { x: 5, z: 5 }, to: { x: 47, z: 47 }, bounds: FIELD, blocked: boxes(yard) });
    assert.ok(y && !y.exact);
    const stop = y.points[y.points.length - 1];
    assert.ok(stop.x < 38 || stop.z < 38, JSON.stringify(stop));
    assert.ok(Math.hypot(stop.x - 47, stop.z - 47) < 14);
    assert.equal(walked(y.points, boxes(yard, 0.36)).bad, 0);
    // walled in where the walker stands: nowhere to go
    assert.equal(gridPath({ from: { x: 47, z: 47 }, to: { x: 5, z: 5 }, bounds: { x0: 40, x1: 54, z0: 40, z1: 54 }, blocked: (x, z) => Math.hypot(x - 47, z - 47) > 1 }), null);
  });
});

describe('auto-walk: following the route', () => {
  const route = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }];
  it('heads for each corner in turn and is done at the end', () => {
    const st = { i: 0, side: 0 }, out = {};
    walkSteer({ x: 0, z: 0 }, route, st, null, out);
    assert.deepEqual([st.i, out.dx, out.dz, out.done], [1, 1, 0, false]);
    assert.ok(Math.abs(out.left - 20) < 1e-9);
    walkSteer({ x: 9.2, z: 0 }, route, st, null, out); // within AUTO_WALK.reach of the corner: on to the next leg
    assert.equal(st.i, 2);
    assert.ok(out.dz > 0.99 && Math.abs(out.left - Math.hypot(0.8, 10)) < 1e-9);
    walkSteer({ x: 10, z: 9.0 }, route, st, null, out);
    assert.equal(out.done, false);
    walkSteer({ x: 10, z: 9.5 }, route, st, null, out);
    assert.deepEqual([out.done, out.dx, out.dz], [true, 0, 0]);
    assert.ok(AUTO_WALK.arrive < AUTO_WALK.reach);
  });
  it('steers round something the plan did not know, keeping to the side it took', () => {
    const post = (x, z) => Math.hypot(x - 3, z) > 0.9; // a car or a lamp post 3 m down the first leg
    const st = { i: 0, side: 0 }, out = {};
    walkSteer({ x: 0.5, z: 0 }, route, st, post, out); // the step ahead (1 m) is clear
    assert.equal(st.side, 0);
    assert.deepEqual([st.i, out.dx, out.dz], [1, 1, 0]);
    walkSteer({ x: 1.5, z: 0 }, route, st, post, out); // it is not: the first turn that is
    assert.notEqual(st.side, 0);
    const turned = Math.acos(out.dx);
    assert.ok(AUTO_WALK.turns.some((a) => Math.abs(a - turned) < 1e-9), String(turned));
    assert.ok(post(1.5 + out.dx * AUTO_WALK.look, out.dz * AUTO_WALK.look));
    const side = st.side;
    walkSteer({ x: 1.5, z: 0 }, route, st, post, out);
    assert.equal(st.side, side);
    // dead ahead both sides are equally clear: the side taken last time is tried first
    const other = { i: 1, side: -side };
    const mirror = walkSteer({ x: 1.5, z: 0 }, route, other, post, {});
    assert.equal(other.side, -side);
    assert.ok(Math.abs(mirror.dz + out.dz) < 1e-9 && Math.abs(mirror.dx - out.dx) < 1e-9);
    // walked at 60 fps (pushed out of the post the way collide() pushes), it gets past the post and to the end
    const pos = { x: 0, z: 0 }, s2 = { i: 0, side: 0 };
    let t = 0, nearest = Infinity;
    for (; t < 20 && !out.done; t += 1 / 60) {
      walkSteer(pos, route, s2, post, out);
      let nx = pos.x + out.dx * 6.2 / 60, nz = pos.z + out.dz * 6.2 / 60;
      const d = Math.hypot(nx - 3, nz);
      if (d < 0.9) { nx = 3 + ((nx - 3) * 0.9) / d; nz = (nz * 0.9) / d; }
      pos.x = nx; pos.z = nz;
      nearest = Math.min(nearest, Math.hypot(nx - 3, nz));
    }
    assert.ok(out.done && t < 4.5, String(t)); // 20 m at 6.2 m/s is 3.2 s: the detour costs under a second
    assert.ok(nearest > 0.9, `it went round without touching (${nearest.toFixed(2)} m)`);
    // boxed in on every side it tries: it keeps its heading (and the stall clock below stops it)
    walkSteer({ x: 0, z: 0 }, route, { i: 0, side: 0 }, () => false, out);
    assert.deepEqual([out.dx, out.dz], [1, 0]);
  });
  it('gives up when it stops getting nearer: plan again at 0.8 s, stop at 2 s', () => {
    assert.deepEqual([AUTO_WALK.replan, AUTO_WALK.stuck, AUTO_WALK.gain], [0.8, 2, 1]);
    const st = { best: Infinity, t: 0 };
    assert.equal(walkStall(st, 50, 1 / 60), 0);
    let t = 0;
    for (let i = 0; i < 60; i++) t = walkStall(st, 49.5, 1 / 60); // half a metre in a second: not nearer
    assert.ok(Math.abs(t - 1) < 1e-9);
    assert.ok(t >= AUTO_WALK.replan && t < AUTO_WALK.stuck);
    t = walkStall(st, 80, 0, true); // planned again: the new route is longer, the clock runs on
    assert.ok(Math.abs(t - 1) < 1e-9 && st.best === 80);
    for (let i = 0; i < 61; i++) t = walkStall(st, 79.8, 1 / 60);
    assert.ok(t >= AUTO_WALK.stuck);
    assert.equal(walkStall(st, 78.5, 1 / 60), 0); // a metre nearer: the clock starts again
    // an ordinary walk at 2.4 m/s never trips it
    const go = { best: Infinity, t: 0 };
    let worst = 0;
    for (let left = 40; left > 0; left -= 2.4 / 60) worst = Math.max(worst, walkStall(go, left, 1 / 60));
    assert.ok(worst < 0.5, String(worst));
  });
  it('runs, slows over the last few metres, and the player\'s own input ends it at once', () => {
    assert.equal(walkPace(40, 2.4, 6.2), 6.2);
    assert.equal(walkPace(0.5, 2.4, 6.2), 2.4);
    assert.ok(walkPace(2.5, 2.4, 6.2) > 2.4 && walkPace(2.5, 2.4, 6.2) < 6.2);
    assert.equal(autoWalkEnds({}), false);
    assert.equal(autoWalkEnds({ joy: 0.05 }), false); // a thumb resting on the stick's centre
    assert.equal(autoWalkEnds({ joy: 0.2 }), true);
    assert.equal(autoWalkEnds({ keys: 1 }), true);
    assert.equal(autoWalkEnds({ locked: true }), true); // a sheet is open
    assert.equal(autoWalkEnds({ driving: true }), true);
    assert.equal(autoWalkEnds({ guide: false }), true);
  });
});

const MAP = new URL('../assets/nyc/manhattan.bin', import.meta.url);
describe('auto-walk on the real map', { skip: existsSync(MAP) ? false : 'assets/nyc/manhattan.bin missing' }, () => {
  it('finds its way between the plaza\'s places around the buildings, in a few thousand cells, and walks it', () => {
    const nyc = createNYC(new Uint8Array(gunzipSync(readFileSync(MAP))));
    const B = nyc.buildings;
    for (let i = 0; i < B.count; i++) for (const z of SKIP_ZONES) if (B.cx[i] >= z.x0 && B.cx[i] <= z.x1 && B.cz[i] >= z.z0 && B.cz[i] <= z.z1) { nyc.skipBuilding[i] = 1; break; } // as world.js does
    nyc.ensureSolid(LAYOUT.spawn.x, LAYOUT.spawn.z);
    const bounds = { x0: LOOP.x0 + 1.4, x1: LOOP.x1 - 1.4, z0: LOOP.z0 + 1.4, z1: LOOP.z1 - 1.4 };
    // the world's own test without its landmarks and props: inside a building, or within AUTO_WALK.clear of a wall
    const blocked = (x, z) => { if (nyc.buildingAt(x, z) >= 0) return true; const [cx, cz] = nyc.collide(x, z, AUTO_WALK.clear); return Math.hypot(cx - x, cz - z) > 0.02; };
    const collide = (x, z) => { const [cx, cz] = nyc.collide(x, z, 0.36); return [Math.max(bounds.x0, Math.min(bounds.x1, cx)), Math.max(bounds.z0, Math.min(bounds.z1, cz))]; };
    const free = (x, z) => { const [cx, cz] = collide(x, z); return Math.hypot(cx - x, cz - z) < 0.06; };
    const inside = (x, z) => nyc.buildingAt(x, z) >= 0;
    const spawn = { x: LAYOUT.spawn.x, z: LAYOUT.spawn.z };
    const trips = [
      [spawn, { x: LAYOUT.stall.x, z: LAYOUT.stall.z + 4.4 }, true],
      [spawn, { x: -21, z: -118 }, true], // the foot of the red steps
      [spawn, { x: PLOT_SLOTS[0].x, z: PLOT_SLOTS[0].z }, true],
      [{ x: 0, z: 361 }, { x: 0, z: -150 }, true], // the whole length of the square
      [spawn, { x: 70, z: 100 }, true], // down a side street
      [spawn, { x: -60, z: 150 }, false], // a tap in the middle of a block: as near as the street gets
      [{ x: -21, z: -118 }, { x: LAYOUT.oneTimes.x, z: LAYOUT.oneTimes.z }, false], // One Times Square itself
    ];
    for (const [from, to, exact] of trips) {
      const tag = `${from.x},${from.z} -> ${to.x},${to.z}`;
      const r = gridPath({ from, to, bounds, blocked });
      assert.ok(r, tag);
      assert.equal(r.exact, exact, tag);
      assert.ok(r.cells < 4000, `${tag}: ${r.cells} cells`);
      const w = walked(r.points, inside);
      assert.equal(w.bad, 0, tag + ': through a building');
      const end = r.points[r.points.length - 1], straight = Math.hypot(end.x - from.x, end.z - from.z);
      assert.ok(w.len < straight * 1.35 + 5, `${tag}: ${w.len.toFixed(0)} m for ${straight.toFixed(0)} m`);
      if (!exact) assert.ok(Math.hypot(end.x - to.x, end.z - to.z) < 12 && !inside(end.x, end.z), tag);
      // walked as the world walks it: 60 fps, the walk step's easing, the map's own collision
      const pos = { ...from }, st = { i: 0, side: 0 }, stall = { best: Infinity, t: 0 }, out = {};
      let vx = 0, vz = 0, t = 0, stuck = false;
      for (; t < 200; t += 1 / 60) {
        walkSteer(pos, r.points, st, free, out);
        if (out.done) break;
        if (walkStall(stall, out.left, 1 / 60) >= AUTO_WALK.stuck) { stuck = true; break; }
        const top = walkPace(out.left, 2.4, 6.2), k = 1 - Math.exp(-10 / 60);
        vx += (out.dx * top - vx) * k; vz += (out.dz * top - vz) * k;
        [pos.x, pos.z] = collide(pos.x + vx / 60, pos.z + vz / 60);
      }
      assert.ok(out.done && !stuck, `${tag}: ${stuck ? 'stuck' : 'not there'} after ${t.toFixed(0)} s`);
      assert.ok(Math.hypot(pos.x - end.x, pos.z - end.z) <= AUTO_WALK.arrive + 0.2, tag);
      assert.ok(t < w.len / 6.2 + 4, `${tag}: ${t.toFixed(0)} s for ${w.len.toFixed(0)} m`);
    }
  });
});

describe('auto-walk in the world and on the pill', () => {
  const w = read('timesSquare3d.js');
  it('the pill asks through setWaypoint: { auto: true } walks, the same point without it stops, and the HUD hears which', () => {
    const set = between(w, '  function setWaypoint(p) {', '\n  }\n');
    assert.match(set, /const go = !!\(p && p\.auto\);\n\s+autoWalk = null;/);
    assert.match(set, /if \(go && waypoint\) beginAutoWalk\(\);\n\s+sayGuide\(\);/);
    assert.match(w, /const sayGuide = \(\) => opts\.onWaypoint\?\.\(waypoint && \{ x: waypoint\.x, z: waypoint\.z, name: waypoint\.name, auto: !!autoWalk \}\);/);
    assert.match(w, /bearing: bearingTo\(waypoint\.x, waypoint\.z\), auto: !!autoWalk \};/);
    // main.js is as it was: one hook each way
    const main = read('main.js');
    assert.match(main, /  setWaypoint: \(p\) => world\?\.setWaypoint\(p\),/);
    assert.match(main, /  onWaypoint: \(wp\) => ui\.setWaypoint\(wp\),/);
    const ui = read('ui.js');
    // the pill's body walks (or stops); only the ✕ clears the guide
    assert.match(ui, /if \(!wayAt \|\| ev\.target\.closest\?\.\('small'\)\) hooks\.setWaypoint\(null\);\n\s+else hooks\.setWaypoint\(\{ x: wayAt\.x, z: wayAt\.z, name: wayAt\.name, auto: !wayAt\.auto \}\);/);
    assert.match(ui, /wayGo\.replaceChildren\(\.\.\.\(going \? \['멈추기'\] : \['자동', h\('i', \{ text: '으로 가기' \}\)\]\)\);/);
    assert.match(ui, /wayPill\.classList\.toggle\('going', going\);/);
    assert.match(ui, /setWaypoint\(wp\) \{ paintWay\(wp\); \},/);
    assert.equal(/class: 'glass waypill'[^\n]*title: '목적지 지우기', onclick: \(\) => hooks\.setWaypoint\(null\)/.test(ui), false, 'the whole pill is no longer the clear button');
    const css = read('index.html');
    assert.match(css, /\.waypill\.going \{ border-color: var\(--info\); \}/);
    assert.match(css, /@media \(orientation: portrait\) and \(max-width: 411px\) \{ html\.touch \.waypill \.go i \{ display: none; \} \}/);
    assert.match(css, /\.waypill small::after \{ content: ''; position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; transform: translate\(-50%, -50%\); \}/);
  });
  it('the pill names the place: the name comes with setWaypoint and goes back to the HUD with the guide', () => {
    const set = between(w, '  function setWaypoint(p) {', '\n  }\n');
    assert.match(set, /\{ x: p\.x, z: p\.z, name: chars\(typeof p\.name === 'string' \? p\.name : '', 16\) \}/);
    assert.match(w, /at: \{ x: LAYOUT\.atm\.x, z: LAYOUT\.atm\.z, name: '황금 ATM' \}/); // main.js hands info.at to setWaypoint as it is
    const ui = read('ui.js');
    assert.match(ui, /hooks\.setWaypoint\(\{ x: p\.x, z: p\.z, name: label \}\);/);
    assert.match(ui, /hooks\.setWaypoint\(\{ x: q\.x, z: q\.z, name: q\.ko \}\);/);
    assert.match(ui, /hooks\.setWaypoint\(\{ x: p\.x, z: p\.z, name: `\$\{slot\.id\}번 토지` \}\); openMap\(p\);/);
    assert.match(ui, /best = \{ x: card\.x, z: card\.z, name: '전광판' \};/);
    // the pill keeps its class and its three parts: the arrow, .way (.name over .sub: the distance and .go) and the ✕
    assert.match(ui, /\}, wayArrow, h\('span', \{ class: 'way' \}, wayName, h\('span', \{ class: 'sub' \}, wayText, wayGo\)\), h\('small', \{ title: '목적지 지우기' \}, icon\('close'\)\)\);/);
    assert.match(ui, /wayName\.textContent = name;\n\s+wayName\.hidden = !name;\n\s+wayPill\.classList\.toggle\('named', !!name\);/);
    const css = read('index.html');
    assert.match(css, /\.waypill \.name \{ max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/);
    assert.match(css, /\.waypill \.way \{[^}]*min-width: 0;/);
    // 375px upright: the lane is 181px; padding 28, arrow 21, two 8px gaps and the ✕ (30 less 12 of margin) leave 98px for the text,
    // and the second line (12px: about 30 + 6 + 24 for "123m 자동") fits; from 412px (lane 218px) the full label does (30 + 6 + 76)
    assert.ok(375 - 194 - (28 + 21 + 16 + 18) >= 60);
    assert.ok(412 - 194 - (28 + 21 + 16 + 18) >= 112);
    assert.ok(320 - 194 - (20 + 12 + 18) >= 60, 'under 360px: 10px padding, 6px gaps, no arrow');
  });
  it('plans with the world\'s own collision, and stops for the stick, a key, a sheet, a taxi, a teleport and a scripted camera', () => {
    const blocked = between(w, '  function walkBlocked(x, z) {', '\n  }\n');
    assert.match(blocked, /if \(nyc\.buildingAt\(x, z\) >= 0\) return true;/);
    assert.match(blocked, /pushOut\(x, z, AUTO_WALK\.clear, colliders\)/);
    assert.match(blocked, /world\.collideProps\(cx, cz, AUTO_WALK\.clear\)/);
    assert.match(blocked, /nyc\.collide\(cx, cz, AUTO_WALK\.clear\)/);
    assert.equal(/traffic/.test(blocked), false, 'cars come and go: the walk steers round them');
    assert.match(w, /const walkFree = \(x, z\) => \{ const \[cx, cz\] = collide\(x, z, RADIUS, false\); return Math\.hypot\(cx - x, cz - z\) < 0\.06; \};/);
    assert.match(w, /if \(autoWalkEnds\(\{ joy: Math\.hypot\(joy\.x, joy\.y\), keys: keys\.size, locked: !inputEnabled, driving: !!drive, guide: !!waypoint \}\)\) endAutoWalk\(\);\n\s+else auto = stepAutoWalk\(dt\);/);
    assert.match(w, /else sitting = stepWalk\(dt, input, auto\);/);
    for (const [a, b] of [['  function enterTaxi(i) {', '\n  }\n'], ['    teleport(x, z) {', '\n    },\n'], ['  function focusSlot(', '\n  }\n'], ['  function frameBillboard(', '\n  }\n'], ['  function giftShow(', '\n  }\n'], ['    startLounge() {', '\n    },\n']]) {
      assert.match(between(w, a, b), /endAutoWalk\(\);/, a);
    }
    const step = between(w, '  function stepAutoWalk(dt) {', '\n  }\n');
    assert.match(step, /if \(t >= AUTO_WALK\.stuck\) \{ endAutoWalk\('길이 막혀서 자동으로 가기를 멈췄어요', 'err'\); return null; \}/);
    assert.match(step, /else if \(t >= AUTO_WALK\.replan && !a\.replanned\) \{/);
    assert.match(w, /tell\('자동으로 가는 중 · 직접 움직이면 멈춰요', 'ok'\);/);
  });
  it('is local movement: the same walk step, the same packets, nothing new on the wire', () => {
    const auto = between(w, '  // ---- auto-walk (interact.js AUTO_WALK)', '\n  const job = {');
    assert.equal(/\bnet\b|netState|toNetUnits|fromNetUnits|\.send\(|sendEmoji/.test(auto), false);
    assert.equal(/\bpos\.(x|z)\s*=|pos\.set\(|pos\.copy\(/.test(auto), false, 'it only says where to head: stepWalk moves the avatar');
    const walk = between(w, '  function stepWalk(dt, input, auto) {', '\n  function stepDrive(');
    assert.match(walk, /if \(auto\) wish\.set\(auto\.dx, 0, auto\.dz\);/);
    assert.match(walk, /const \[nx, nz\] = collide\(pos\.x \+ vel\.x \* dt, pos\.z \+ vel\.z \* dt, RADIUS, false\);/);
    const netBlock = between(w, '// Network projection', '// Camera: OrbitControls');
    assert.match(netBlock, /netState\.x = toNetUnits\(pos\.x\);\n\s+netState\.y = toNetUnits\(pos\.z\);\n\s+netState\.vx = Math\.round\(vel\.x \* 20\);\n\s+netState\.vy = Math\.round\(vel\.z \* 20\);/);
    assert.equal(/autoWalk|auto\b/.test(netBlock), false);
    assert.equal(/autoWalk|AUTO_WALK|gridPath/.test(read('net.js') + read('worker.js')), false);
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
  // The bake and the dance pay nothing: no session goes to the room, the page never waits for a PAY, and a finished bake tells nobody
  // (the bake tutorial it used to move on is gone: the newcomer's first step is the welcome board, test/welcome.test.mjs).
  it('no SESS and no coins: a finished bake ends on the page, the dance only animates', () => {
    const main = read('main.js');
    assert.doesNotMatch(main, /sendSess|bakeWait|bakeEnding|BAKE_MISS|DANCE_MISS|beginBake|finishDance/);
    assert.doesNotMatch(main, /finishBake|noteBakePay|bakeGuided/);
    assert.match(main, /  bakeFlip: \(result\) => world\?\.bake\?\.\(result === 'gold'\),/);
    assert.match(main, /  danceStart: \(\) => world\?\.setDancing\(true\) === true,/);
    assert.match(main, /  danceEnd: \(\) => world\?\.setDancing\(false\),/);
    assert.doesNotMatch(read('net.js'), /sendSess|t: 'SESS'/);
    assert.match(main, /const got = creditNow\(m\?\.amount, countsAsActivity\(m\?\.kind\)\);/);
  });
  it('the rounds start when the panel opens: no parked needle (that was the tutorial\'s), and nothing goes to the room', () => {
    assert.equal(/startBake/.test(read('ftue.js')), false);
    const ui = read('ui.js');
    assert.match(ui, /baking = \{ flips: \[\], pos: 0\.08, dir: 1, speed: 0\.42, held: false, roundAt: performance\.now\(\), doneAt: 0 \};/);
    assert.equal(/baking\.live|beginRounds|굽기 시작|wait: true|바늘이 움직여요/.test(ui), false);
    assert.match(ui, /function stopBake\(cancel\) \{\n\s+if \(!baking\) return;\n\s+if \(cancel\) \{ closeBake\(\); return; \}\n\s+flipBake\(false\);\n\s+\}/);
    // nothing goes to the room when the rounds start or end (no session)
    assert.equal(/hooks\.beginBake|hooks\.bakeBusy|bakeChip|hooks\.finishBake/.test(ui), false);
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
