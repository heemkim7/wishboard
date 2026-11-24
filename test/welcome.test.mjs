// 환영 전광판: the newcomer's own name on a plaza screen for a few seconds, on this device only. The card (giftart.js paintWelcome), the pin
// that puts it on the nearest free street screen (ts3d/screens.js pinWelcome, with the real three and a recording 2D context), and the wiring
// that shows it once (main.js, ui.js, timesSquare3d.js: source checks, since those need a browser). The pure rules are in test/ftue.test.mjs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { posix } from 'node:path';
import { runInNewContext } from 'node:vm';
import { paintGift, paintWelcome } from '../giftart.js';
import { WELCOME } from '../ftue.js';
import { cineCancels } from '../camrig.js';

register(new URL('./nine-three-hook.mjs', import.meta.url)); // 'three' -> the vendored build, so ts3d/screens.js loads in Node
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// The text of a function from its first line to the line that closes it at the same indent.
function body(src, head) {
  const a = src.indexOf(head);
  assert.ok(a >= 0, head);
  const indent = head.match(/^\s*/)[0];
  const b = src.indexOf('\n' + indent + '}', a);
  return src.slice(a, b + indent.length + 2);
}

// A 2D context that records every call and every property it is given; text is measured at 10 px a character.
function fakeCanvas(w = 1024, h = 576) {
  const words = [], calls = [];
  const g = new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return (s) => ({ width: String(s).length * 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return (...a) => { calls.push([k, ...a]); return { addColorStop(o, c) { calls.push(['stop', o, c]); } }; };
      if (k === 'fillText') return (s, ...a) => { words.push(String(s)); calls.push(['fillText', String(s), ...a]); };
      return (...a) => { calls.push([String(k), ...a]); };
    },
    set(t, k, v) { t[k] = v; calls.push(['=', String(k), typeof v === 'object' ? 'gradient' : v]); return true; },
  });
  return { width: w, height: h, getContext: () => g, words, calls };
}
const digest = (cv) => createHash('sha1').update(JSON.stringify(cv.calls)).digest('hex');
const GIFT = { id: 'aaaaaaa1', to: '민지', from: '동아리', occ: 'bday', msg: '생일 축하해! 오늘은 네가 주인공이야', th: '', n: 3 };

describe('the welcome card', () => {
  it('draws the chip, the name and the line; nothing else of the newcomer', () => {
    const cv = fakeCanvas();
    paintWelcome(cv, { name: '네온후드77', line: WELCOME.line });
    assert.deepEqual(cv.words, ['👋 환영해요', 'WISH BOARD', '네온후드77 님', '오늘 밤, 가상 타임스퀘어의 주인공']);
  });
  it('cuts the name to 12 code points and still draws a card without one', () => {
    const long = fakeCanvas();
    paintWelcome(long, { name: '가'.repeat(30), line: WELCOME.line });
    assert.ok(long.words.includes('가'.repeat(12) + ' 님'));
    assert.equal(long.words.some((w) => w.includes('가'.repeat(13))), false);
    const emoji = fakeCanvas();
    paintWelcome(emoji, { name: '😀'.repeat(20) });
    assert.ok(emoji.words.includes('😀'.repeat(12) + ' 님'), 'code points, not UTF-16 units');
    const none = fakeCanvas();
    paintWelcome(none);
    assert.deepEqual(none.words, ['👋 환영해요', 'WISH BOARD', '환영해요']);
  });
  it('shares the gift board\'s ground and frame (the 밤하늘 theme), on any canvas size', () => {
    const a = fakeCanvas(), b = fakeCanvas(384, 216);
    paintWelcome(a, { name: '민지', line: WELCOME.line });
    paintWelcome(b, { name: '민지', line: WELCOME.line });
    const stops = (cv) => cv.calls.filter((c) => c[0] === 'stop').slice(0, 2).map((c) => c[2]);
    assert.deepEqual(stops(a), ['#312e81', '#020617']);
    assert.deepEqual(stops(b), ['#312e81', '#020617']);
    assert.deepEqual(a.calls.find((c) => c[0] === 'fillRect'), ['fillRect', 0, 0, 1024, 576]);
    assert.deepEqual(b.calls.find((c) => c[0] === 'fillRect'), ['fillRect', 0, 0, 384, 216]);
    assert.equal(a.calls.filter((c) => c[0] === 'stroke').length, 1, 'the frame');
    // The same number of ground calls as a gift board up to the frame: one helper paints both.
    const g = fakeCanvas();
    paintGift(g, { ...GIFT, id: '민지', th: 'night' });
    const upToFrame = (cv) => cv.calls.slice(0, cv.calls.findIndex((c) => c[0] === 'stroke') + 1);
    assert.deepEqual(upToFrame(a), upToFrame(g));
  });
});

describe('the gift board painter is unchanged by sharing its ground', () => {
  it('draws exactly what it drew before (every call and property, in order)', () => {
    const cv = fakeCanvas();
    paintGift(cv, GIFT);
    assert.ok(cv.words.includes('To. 민지'));
    assert.ok(cv.words.includes('🎁 선물 전광판'));
    // The digests were taken from giftart.js as it was before paintGround and paintChip were split out of paintGift.
    assert.equal(digest(cv), '8e4dab62f29868f8c2757bb57454a9b472c16fc0');
    const card = fakeCanvas(1200, 630);
    paintGift(card, { ...GIFT, from: '' }, { brand: true, glow: 0.5 });
    assert.equal(digest(card), '371f391d19cd1ffcf37e672f7060ded57083bf4a');
    const strip = fakeCanvas(384, 216);
    paintGift(strip, { ...GIFT, msg: '' }, { strip: '그날 공개돼요', chip: false });
    assert.equal(digest(strip), 'e662dc9f7bdcdfa12276778f9aa48c640c0d6026');
  });
});

// ---- ts3d/screens.js with the real three and a recording 2D context (the harness of test/nine.test.mjs) ---------------------------------
function fakeDom() {
  const ctx = () => {
    const words = [];
    return new Proxy({ words }, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'measureText') return (s) => ({ width: String(s).length * 10 });
        if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
        if (k === 'clearRect') return () => { words.length = 0; };
        if (k === 'fillText') return (s) => { words.push(String(s)); };
        if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
        return () => {};
      },
      set(t, k, v) { t[k] = v; return true; },
    });
  };
  globalThis.document = { createElement: () => { let g = null; return { width: 0, height: 0, getContext() { return g || (g = ctx()); } }; } };
}
// Boards in a row 10 m apart along x, all facing +z (specs: [id, { x, z, ry }] to place one by hand).
const ROW = ['MAIN_TOP', 'SUB_1A', ...Array.from({ length: 12 }, (_, i) => 'STREET_' + (i + 1)), 'PLOT_1', 'PLOT_2'];
async function plaza(specs = ROW.map((id, i) => [id, { x: i * 10 }]), quality = 'high') {
  fakeDom();
  const { createBoards } = await import('../ts3d/screens.js');
  const THREE = await import('three');
  const boards = createBoards({ renderer: { capabilities: { getMaxAnisotropy: () => 4 } }, kitMats: {}, pick: [], quality });
  const parent = new THREE.Group();
  for (const [id, s] of specs) boards.mount(id, parent, { x: 0, y: 5, z: 0, w: 16, h: 9, ...s });
  const words = (id) => boards.get(id).canvas.getContext('2d').words;
  return {
    boards, words, THREE,
    xOf: (id) => specs.find((s) => s[0] === id)[1].x,
    shows: (id) => words(id).includes('👋 환영해요'),
    tick(cam, n = 8) { for (let i = 0; i < n; i++) boards.update(0.1, cam); }, // 8 ticks: one 0.64 s pass (gifts, wishes, the strips)
  };
}
const LIT = () => ({ holder_id: 'guest:a', holder_name: '주인', line1: '내 가게', line2: '', line3: '', lit_until: new Date(Date.now() + 36e5).toISOString() });
const gift = (id, scr) => ({ id, to: '민지', from: '', occ: 'bday', msg: '축하해', th: '', scr, a: Date.now() - 1000, b: Date.now() + 36e5, n: 0 });
// The pin ends by the wall clock: the test moves Date.now instead of waiting.
async function later(ms, run) {
  const real = Date.now;
  Date.now = () => real() + ms;
  try { return await run(); } finally { Date.now = real; }
}

describe('the welcome pin on the plaza screens', () => {
  it('puts the card alone on the free street screen nearest the avatar, with its own strip, and takes it down by itself', async () => {
    const p = await plaza();
    const at = { x: p.xOf('STREET_5') + 2, z: 30 };
    const slot = p.boards.pinWelcome('네온후드77', WELCOME.ms, at);
    assert.equal(slot, 'STREET_5');
    assert.deepEqual(p.words(slot).slice(-4), ['👋 환영해요', 'WISH BOARD', '네온후드77 님', WELCOME.line]);
    assert.equal(ROW.filter((id) => p.shows(id)).join(), 'STREET_5', 'one screen only');
    assert.equal(p.boards.giftSlot('aaaaaaa1'), '', 'no gift is placed by it');
    // The moving strip of the near boards: the 환영 tag and the welcome line, never the gift words.
    p.tick(new p.THREE.Vector3(at.x, 5, at.z));
    const strip = p.words(slot).join(' ');
    assert.match(strip, /환영 네온후드77님, 가상 타임스퀘어에 오신 걸 환영해요/);
    assert.doesNotMatch(strip, /선물 전광판|To\. /);
    // Before its time is up it stays through the passes; after it the screen goes back to its notice.
    await later(WELCOME.ms - 1000, () => { p.tick(new p.THREE.Vector3(at.x, 5, at.z)); assert.equal(p.shows(slot), true); });
    await later(WELCOME.ms + 100, () => { p.tick(new p.THREE.Vector3(at.x, 5, at.z)); assert.equal(p.shows(slot), false); assert.match(p.words(slot).join(' '), /메인거리/); });
    assert.equal(p.boards.get(slot).gifts, null);
  });
  it('cuts the name to 12 code points on the screen and the strip, and shows nothing for no name', async () => {
    const p = await plaza();
    const slot = p.boards.pinWelcome('가'.repeat(30), 8000, { x: 40, z: 30 });
    assert.ok(p.words(slot).includes('가'.repeat(12) + ' 님'));
    p.tick(new p.THREE.Vector3(40, 5, 30));
    assert.equal(p.words(slot).some((w) => w.includes('가'.repeat(13))), false);
    const q = await plaza();
    assert.equal(q.boards.pinWelcome('   ', 8000, { x: 40, z: 30 }), '');
    assert.equal(q.boards.pinWelcome(undefined), '');
    assert.equal(ROW.some((id) => q.shows(id)), false);
  });
  it('never covers a lit board, a prime screen or a takeover; a board lit under it gets its own face back', async () => {
    const p = await plaza();
    p.boards.set('STREET_5', LIT());
    // Standing right in front of the lit board, and of the main tower: the nearest free street or lot screen is used instead.
    const a = p.boards.pinWelcome('민지', 8000, { x: p.xOf('STREET_5'), z: 12 });
    assert.ok(a === 'STREET_4' || a === 'STREET_6', a);
    assert.match(p.words('STREET_5').join(' '), /내 가게/);
    assert.equal(p.shows('STREET_5'), false);
    const b = p.boards.pinWelcome('민지', 8000, { x: p.xOf('MAIN_TOP'), z: 12 });
    assert.equal(b, 'STREET_1', 'MAIN_TOP (0 m) and SUB_1A (10 m) are nearer but are prime screens');
    assert.equal(p.shows('MAIN_TOP') || p.shows('SUB_1A'), false);
    assert.equal(p.shows(a), false, 'the card moved: one screen at a time');
    // Someone lights the screen the card is on: the card gives way at once.
    p.boards.set(b, LIT());
    p.tick(new p.THREE.Vector3(0, 5, 12));
    assert.equal(p.shows(b), false);
    assert.match(p.words(b).join(' '), /내 가게/);
    // A takeover (air) leaves no free screen.
    p.boards.setAir({ nick: '광고주', line: '전 전광판 장악 중', until: Date.now() + 60000 });
    assert.equal(p.boards.pinWelcome('민지', 8000, { x: 60, z: 12 }), '');
    p.boards.setAir(null);
    // No street or lot screen on the map at all: nothing to show it on.
    const none = await plaza([['MAIN_TOP', { x: 0 }], ['SUB_1A', { x: 10 }]]);
    assert.equal(none.boards.pinWelcome('민지', 8000, { x: 0, z: 12 }), '');
  });
  it('prefers a screen that faces the avatar and one that carries no gift', async () => {
    // STREET_2 is nearer but shows its back to someone standing at z = +20; from the other side it is the one.
    const p = await plaza([['STREET_1', { x: 0 }], ['STREET_2', { x: 10, ry: Math.PI }]]);
    assert.equal(p.boards.pinWelcome('민지', 8000, { x: 9, z: 20 }), 'STREET_1');
    assert.equal(p.boards.pinWelcome('민지', 8000, { x: 9, z: -20 }), 'STREET_2');
    // A gift board is on the nearest screen: the idle one next to it is used. With no idle screen in reach the card may share it.
    const q = await plaza();
    q.boards.setGifts([gift('aaaaaaa1', 'STREET_5')]);
    assert.equal(q.boards.giftSlot('aaaaaaa1'), 'STREET_5');
    const s = q.boards.pinWelcome('민지', 8000, { x: q.xOf('STREET_5') + 1, z: 12 });
    assert.equal(s, 'STREET_6');
    assert.equal(q.boards.giftSlot('aaaaaaa1'), 'STREET_5', 'the gift stays where it was');
    const one = await plaza([['STREET_1', { x: 0 }]]);
    one.boards.setGifts([gift('aaaaaaa2', 'STREET_1')]);
    assert.equal(one.boards.pinWelcome('민지', 8000, { x: 0, z: 12 }), 'STREET_1');
    assert.equal(one.shows('STREET_1'), true);
    await later(9000, () => { one.tick(new one.THREE.Vector3(0, 5, 12)); assert.equal(one.boards.get('STREET_1').giftKey, 'aaaaaaa2', 'the gift is back after the card'); assert.ok(one.words('STREET_1').includes('To. 민지')); });
  });
  it('is never in the server list and never takes a gift pin\'s place; a gift pin takes its place', async () => {
    const p = await plaza();
    const g = gift('bbbbbbb1', '');
    const w = p.boards.pinWelcome('민지', 8000, { x: 60, z: 12 });
    assert.ok(w);
    // Lists from the server (an empty one, then one gift elsewhere) neither take the card down nor ever hold it.
    p.boards.setGifts([]);
    assert.equal(p.boards.get(w).giftKey, '!welcome');
    p.boards.setGifts([gift('ccccccc1', 'PLOT_1')]);
    assert.equal(p.boards.get(w).giftKey, '!welcome');
    assert.equal(p.boards.giftSlot('ccccccc1'), 'PLOT_1');
    // A row that claims the card's id or its flag is not a gift: the list is empty again and nothing is placed for it.
    p.boards.setGifts([{ id: '!welcome', welcome: true, to: '남의 이름' }, { ...gift('ddddddd1', 'PLOT_2'), id: '!welcome' }]);
    assert.equal(ROW.filter((id) => p.boards.get(id).gifts).join(), w, 'only the pin itself is up');
    assert.equal(ROW.some((id) => p.words(id).includes('남의 이름 님')), false);
    assert.equal(p.boards.get(w).giftKey, '!welcome');
    // The 15-second recording or a ?gb= visit pins a gift: it wins, and the welcome does not come back over it.
    const gs = p.boards.pinGift(g, 20000);
    assert.ok(gs);
    assert.equal(ROW.some((id) => p.boards.get(id).giftKey === '!welcome'), false);
    assert.equal(p.boards.pinWelcome('민지', 8000, { x: 60, z: 12 }), '');
    assert.equal(p.boards.get(gs).giftKey, 'bbbbbbb1');
  });
});

// ---- the world and the entry flow: source checks (they need WebGL and a page) -------------------------------------------------------------
describe('a gift board alone on its screen follows the list', () => {
  it('repaints with the new friend-message count and words when /rt/world brings them (it has no turn to wait for)', async () => {
    const p = await plaza();
    const cam = new p.THREE.Vector3(p.xOf('STREET_3'), 5, 20);
    p.boards.setGifts([gift('eeeeeee1', 'STREET_3')]);
    p.tick(cam);
    assert.equal(p.boards.giftSlot('eeeeeee1'), 'STREET_3');
    assert.ok(p.words('STREET_3').includes('To. 민지'));
    assert.equal(p.words('STREET_3').some((w) => /친구 메시지/.test(w)), false);
    p.boards.setGifts([{ ...gift('eeeeeee1', 'STREET_3'), n: 3, msg: '다시 축하해' }]);
    p.tick(cam);
    const words = p.words('STREET_3');
    assert.ok(words.includes('다시 축하해'), 'the new words');
    assert.ok(words.some((w) => /친구 메시지 3개/.test(w)), 'the new count: ' + words.join(' | '));
    assert.match(words.join(' '), /선물 전광판/, 'and its strip is the gift strip, not the empty-slot one');
  });
});

describe('the world shows the welcome (timesSquare3d.js)', () => {
  const w = read('timesSquare3d.js');
  it('pins near where the avatar stands and looks at it once on every tier; no camera in a taxi, for a player already walking or when told not to', () => {
    const fn = body(w, '  function welcome(');
    assert.match(fn, /const slot = boards\.pinWelcome\(name, WELCOME\.ms, \{ x: pos\.x, z: pos\.z \}\);/);
    // The same rule that ends a scripted camera decides not to start one (camrig.js cineCancels): keys or the stick, unless input is locked.
    assert.match(fn, /const walking = cineCancels\(\{ active: true, keys: keys\.size, joy: Math\.hypot\(joy\.x, joy\.y\), locked: !inputEnabled \}\);/);
    assert.equal(cineCancels({ active: true, keys: 1, joy: 0, locked: false }), true);
    assert.equal(cineCancels({ active: true, keys: 0, joy: 0.5, locked: false }), true);
    assert.equal(cineCancels({ active: true, keys: 0, joy: 0, locked: false }), false);
    assert.equal(cineCancels({ active: true, keys: 1, joy: 1, locked: true }), false, 'entered before the city is built: movement is locked, the camera may go');
    assert.match(fn, /if \(slot && cam && !drive && !walking && focusSlot\(slot, \{ hold: 3500, celebrate: false \}\)\) setTimeout\(\(\) => cheerAt\(slot\), 900\);/);
    assert.doesNotMatch(fn, /!low\b/, 'the phone tier gets the camera too: without it the card can hang out of sight');
    assert.match(fn, /return slot;/);
    assert.match(w, /import \{ WELCOME \} from '\.\/ftue\.js\?v=[0-9a-z]+';/);
    assert.match(w, /\n    pinGift\(g, ms\) \{ return boards\.pinGift\(g, ms\); \},\n    welcome,\n/, 'in the world api, next to pinGift');
  });
  it('moves the camera only: the avatar is not teleported and nothing goes to the room', () => {
    const fn = body(w, '  function welcome(');
    assert.equal(/teleport|goToSlot|pos\.(set|copy|x =|z =)|me\.root\.position|net\b|\.send|raw\(/.test(fn), false);
  });
});

// main.js from `let ftueArmed` to the wallet section, run with stubs: what armFtue and the card's gift step do, in order.
function entry({ due = true, entered = true, hold = false, built = true, slot = 'STREET_3', busy = false, frame = false, gift = true } = {}) {
  const main = read('main.js');
  const a = main.indexOf('\nlet ftueArmed = false, welcomeNow = false;'), b = main.indexOf('\n// ---- wallet & 응원 포인트');
  assert.ok(a > 0 && b > a);
  const calls = [], timers = [];
  const ctx = {
    WELCOME,
    state: { nick: '민지' },
    keep: (k, v) => calls.push(['keep', k, v]),
    trackEvent: (name, p) => calls.push(p ? ['event', name, p] : ['event', name]),
    ui: {
      isBusy: () => busy, note: (text, tone) => calls.push(['note', text, tone]),
      setTutorialLine: (t) => calls.push(['line', t]), tutorial: (ev) => calls.push(['tutorial', ev]),
    },
    world: { welcome: (name, o) => { calls.push(['welcome', name, o]); return slot; } },
    whenBuilt: (run, giveUp) => (built ? run() : giveUp()),
    giftUi: gift ? { open: (...args) => calls.push(['maker', ...args]) } : null,
    document: { getElementById: (id) => (frame && id === 'kts-gift-frame' ? {} : null) },
    setTimeout: (fn) => { timers.push(fn); return 0; },
  };
  runInNewContext(`let entered = ${entered}, wishHold = ${hold};\n${main.slice(a, b)}\nwelcomeNow = ${due};\nthis.api = { armFtue, openGiftFromCard, release() { wishHold = false; armFtue(); } };`, ctx);
  // The calls as plain data (objects made inside the context have its prototypes, which deepEqual would tell apart).
  return { get calls() { return JSON.parse(JSON.stringify(calls)); }, api: ctx.api, run() { for (const fn of timers.splice(0)) fn(); } };
}

describe('the entry flow shows it once (main.js, run with stubs)', () => {
  it('due: after the frame, kts_ftue with the board, the toast and one event; the card is not touched again', () => {
    const e = entry();
    e.api.armFtue();
    assert.deepEqual(e.calls, [], 'the board waits for the frame to end; kts_ftue waits for the board');
    e.run();
    assert.deepEqual(e.calls, [
      ['keep', 'kts_ftue', '1'],
      ['welcome', '민지', { cam: true }],
      ['note', '👋 민지님 이름이 전광판에 걸렸어요!', 'ok'],
      ['event', 'welcome_show', { found: 1 }],
    ]);
    // arrive() put the gift step on the card; armFtue never starts it again (the maker may already have been opened from it).
    assert.equal(e.calls.some((c) => c[0] === 'line' || c[0] === 'tutorial'), false);
    // Once: the intro's landing, a closing sheet and afterIntro all call armFtue.
    e.api.armFtue(); e.run();
    assert.equal(e.calls.length, 4);
  });
  it('no free screen, or a city that never came: no toast, and the event says so', () => {
    const none = entry({ slot: '' });
    none.api.armFtue(); none.run();
    assert.deepEqual(none.calls, [['keep', 'kts_ftue', '1'], ['welcome', '민지', { cam: true }], ['event', 'welcome_show', { found: 0 }]]);
    const late = entry({ built: false });
    late.api.armFtue(); late.run();
    assert.deepEqual(late.calls, [['keep', 'kts_ftue', '1'], ['event', 'welcome_show', { found: 0 }]]);
  });
  it('a sheet or the gift maker over the plaza: the card goes up, the camera stays', () => {
    for (const over of [{ busy: true }, { frame: true }]) {
      const e = entry(over);
      e.api.armFtue(); e.run();
      assert.deepEqual(e.calls.find((c) => c[0] === 'welcome'), ['welcome', '민지', { cam: false }], JSON.stringify(over));
    }
  });
  it('not due (a second visit, a link): kts_ftue and the skip, nothing shown, nothing counted', () => {
    const e = entry({ due: false });
    e.api.armFtue(); e.run();
    assert.deepEqual(e.calls, [['keep', 'kts_ftue', '1'], ['tutorial', 'skip']]);
  });
  it('waits for the plaza to be entered and for a wish sheet a link opened to close', () => {
    const out = entry({ entered: false });
    out.api.armFtue(); out.run();
    assert.deepEqual(out.calls, []);
    const held = entry({ hold: true });
    held.api.armFtue(); held.run();
    assert.deepEqual(held.calls, []);
    held.api.release(); held.run();
    assert.equal(held.calls.at(-1)[1], 'welcome_show');
  });
  it('the card\'s gift step opens the maker the 🎁 button opens, ends the step and counts the tap', () => {
    const e = entry();
    e.api.openGiftFromCard();
    assert.deepEqual(e.calls, [['maker'], ['tutorial', 'gift'], ['event', 'welcome_cta']]);
    const none = entry({ gift: false });
    none.api.openGiftFromCard();
    assert.deepEqual(none.calls, [], 'no maker, so the step stays');
  });
});

describe('the entry flow shows it once (main.js, ui.js: source checks)', () => {
  const main = read('main.js'), ui = read('ui.js');
  it('is decided once in arrive(), after a ?gb= link took the arrival, with every link that brings its own', () => {
    const arrive = main.slice(main.indexOf('  arrive() {'), main.indexOf('  focusShot:'));
    const gb = arrive.indexOf('if (giftUi?.arrive()) return;'), due = arrive.indexOf('welcomeNow = welcomeDue({ flag: recall(\'kts_ftue\'), before: DAILY_BEFORE, day: kstDay(), deep: DEEP_LINK });');
    assert.ok(gb > 0 && due > gb, 'a gift link returns before the welcome is even asked');
    assert.ok(due > arrive.indexOf('if (!FOCUS) {') && due < arrive.indexOf('if (WISH_ID) { landWish(); return; }'));
    assert.match(arrive, /if \(welcomeNow\) \{ ui\.setTutorialLine\?\.\(WELCOME\.task\); ui\.tutorial\?\.\('start'\); \}/);
    // DEEP_LINK, run with the page's address: read at load, before the keys are taken out of it.
    const src = main.slice(main.indexOf('const DEEP_LINK = (() => {'), main.indexOf('let bootData = null'));
    const deep = (search, FOCUS = '', WISH_ID = '') => runInNewContext(src + '\nDEEP_LINK;', { location: { search }, FOCUS, WISH_ID, GIFT_ID: /^[0-9a-z]{8}$/, URLSearchParams });
    assert.equal(deep(''), false);
    assert.equal(deep('?inv=abc123&q=high&season=xmas'), false, 'an invite, a quality or a preview key is no arrival of its own');
    assert.equal(deep('?gb=abcd1234'), true);
    assert.equal(deep('?gb=abcd1234&rec=1'), true);
    assert.equal(deep('?team=abcd1234'), true);
    assert.equal(deep('?tribe=abcd1234'), true);
    assert.equal(deep('', 'STREET_3'), true);
    assert.equal(deep('', '', 'abcdefghij'), true);
    assert.equal(deep('?gb=nope&team=x'), false, 'a broken id opens nothing, so the welcome runs');
    assert.match(main, /^import \{ GIFT_ID \} from '\.\/giftrules\.js';$/m);
  });
  it('the wish sheet stays closed after it, and the intro hands over as before', () => {
    const fn = main.slice(main.indexOf('async function afterIntro()'), main.indexOf('let crownSig'));
    assert.match(fn, /wishAutoOpen\(\{[^}]*deep: !!\(WISH_ID \|\| FOCUS\), skipped, welcomed: welcomeNow \}\)/);
    assert.match(main, /setTimeout\(\(\) => \{ introDone\(\); afterIntro\(\); \}, 3000\)/);
    assert.match(main, /onFocus: \(on\) => \{ if \(!on\) focusedSlot = ''; ui\.focusLock\(on\); if \(!on\) armFtue\(\); \},/);
  });
  it('sends nothing but the two events: no room message, no Worker call, no stored name', () => {
    const fn = main.slice(main.indexOf('\nlet ftueArmed = false, welcomeNow = false;'), main.indexOf('\n// ---- wallet & 응원 포인트'));
    assert.equal(/\bnet\.|fetch\(|\.raw\(|\.send\(|sendBonus|authed\(|localStorage|sessionStorage/.test(fn.replace(/^\s*\/\/.*$/gm, '')), false);
    assert.deepEqual([...fn.matchAll(/trackEvent\('([a-z_]+)'/g)].map((m) => m[1]), ['welcome_show', 'welcome_cta']);
    assert.deepEqual([...new Set([...fn.matchAll(/keep\('([a-z_]+)'/g)].map((m) => m[1]))], ['kts_ftue'], 'the one thing kept is the done flag, never the name');
  });
  it('the card: the gift step in front, a tap goes through the hook main.js wires to the maker', () => {
    assert.match(ui, /function tutorialGo\(\) \{ hooks\.openGift\?\.\(\); \}/);
    assert.match(main, /\n  openGift: \(\) => openGiftFromCard\(\),\n/);
    assert.match(main, /giftUi = mountGift\(\{ world, ui, whenBuilt, introDone: \(\) => introDone\(\) \}\);/);
  });
  it('the bake guide is gone from the plaza: no line, no waypoint to the cart, no panel opening by itself, no walk to the free slot', () => {
    for (const [name, src] of [['main.js', main], ['ui.js', ui], ['ftue.js', read('ftue.js')]]) {
      for (const s of ['붕어빵 포차로 가 보세요', '무료 칸으로 가세요', '여기서 붕어빵을', '무료 칸 앞이에요']) assert.equal(src.includes(s), false, name + ': ' + s);
      assert.equal(/startFtue|ftueApi|noteBakePay|bakeGuided|walkArrival|tutorialTap|setTutorialWaypoint|nearKind|\bfinishBake\b/.test(src), false, name);
    }
    assert.match(main, /\n  onProximity: \(near\) => ui\.setNear\(near\),\n/);
    // The cart, the bake play and the 📢 claim wizard stay.
    assert.match(main, /if \(kind === 'cart'\) \{\n\s+if \(info\?\.near === false\) ui\.note\('붕어빵 포차 앞으로 가까이 가면 구울 수 있어요'\);\n\s+else ui\.startBake\(\);/);
    assert.match(ui, /function startBake\(\) \{/);
    assert.match(ui, /function openClaimStep\(n, model\) \{/);
  });
  it('the two events are on the allow-list (the Worker and analytics.js read the same list)', async () => {
    const { EVENT_NAMES } = await import('../plaza-account.js');
    for (const n of ['welcome_show', 'welcome_cta']) assert.ok(EVENT_NAMES.includes(n), n);
  });
  // No test loads main.js, ui.js or timesSquare3d.js (they need a page), so a name imported from a module that no longer exports it would
  // only fail in the browser. Read from the sources: every named import of the modules this change touched, and every import of ftue.js and
  // giftart.js anywhere, names something its module exports.
  it('every name the plaza modules import is exported by its module', async () => {
    const exportsOf = (file) => {
      const src = read(file), out = new Set();
      for (const m of src.matchAll(/^export (?:async )?(?:function\*?|class) ([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
      for (const m of src.matchAll(/^export (?:const|let|var) (.*)$/gm)) for (const d of ('\u0000' + m[1]).matchAll(/(?:\u0000|, )([A-Za-z_$][\w$]*) = /g)) out.add(d[1]);
      for (const m of src.matchAll(/^export \{([^}]+)\}/gm)) for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) out.add(n); }
      return out;
    };
    const mine = ['main.js', 'ui.js', 'timesSquare3d.js', 'ts3d/screens.js', 'giftart.js', 'ftue.js'], all = [...mine, 'gift.js', 'giftfilm.js', 'giftpage.js'];
    const missing = [];
    let seen = 0;
    for (const file of all) {
      for (const m of read(file).matchAll(/^import \{([^}]+)\} from '(\.{1,2}\/[^'?]+\.js)(?:\?v=[0-9a-z]+)?';/gm)) {
        const target = posix.normalize(posix.join(posix.dirname(file), m[2]));
        if (target.startsWith('vendor/') || !(mine.includes(file) || target === 'ftue.js' || target === 'giftart.js')) continue;
        const ex = exportsOf(target);
        for (const name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) { seen++; if (!ex.has(name)) missing.push(`${file}: ${name} from ${target}`); }
      }
    }
    assert.deepEqual(missing, []);
    assert.ok(seen > 300, String(seen));
    // The reader of exports agrees with the real modules where Node can load them.
    for (const f of ['ftue.js', 'giftart.js']) assert.deepEqual([...exportsOf(f)].sort(), Object.keys(await import('../' + f)).sort(), f);
  });
});

describe('the gift step is a step of the newcomer card (ui.js: source checks)', () => {
  const u = read('ui.js');
  it('someone known to be no newcomer (an account with boards on a fresh browser) never gets it as words on the plain line that nothing can end', () => {
    assert.match(u, /const on = ev === 'start' && newbieOn === false \? false : tutorialNext\(tutorialOn, ev\);/, 'it does not start once newcomer mode is known to be off');
    assert.match(u, /function setTutorialLine\(text\) \{\r?\n    if \(newbieOn === false\) return;/, 'and its words are not put on the plain line');
    assert.match(u, /\n    if \(!on\) setTutorial\('grad'\);/, 'a step started before that was known ends when it is (not only on leaving newcomer mode)');
  });
});

// ---- 점등식: the teaser card (giftart.js paintTeaser) drawn from cerTeaser's fields only ------------------------------------------------
import { paintTeaser } from '../giftart.js';
import { cerTeaser, windowFor } from '../giftrules.js';
describe('the ceremony teaser card', () => {
  const KST = (s) => Date.parse(s + '+09:00'), S = KST('2026-12-25T18:00:00');
  const board = (o = {}) => { const w = windowFor('2026-12-25', 18, KST('2026-12-25T08:00:00')); return { id: 'abcd1234', to: '민지', from: '지수', occ: 'bday', msg: '비밀 문구 🤫', th: '', day: '2026-12-25', a: w.a, b: w.b, ...o }; };
  // Every string the painter hands the context (fillText and strokeText alike).
  const drawn = (cv) => cv.calls.filter((c) => c[0] === 'fillText' || c[0] === 'strokeText').map((c) => String(c[1]));
  it('draws the chip, WISH BOARD, the name, when it lights and the time left, in that order', () => {
    const cv = fakeCanvas();
    paintTeaser(cv, cerTeaser(board(), S - 90000));
    assert.deepEqual(cv.words, ['곧 켜져요', 'WISH BOARD', 'To. 민지', '🎂 18:00에 켜져요', '01:30']);
  });
  it('never draws the message or the sender, on any canvas size, even when they are passed in', () => {
    for (const [w, h] of [[1024, 576], [384, 216], [512, 288]]) {
      const cv = fakeCanvas(w, h);
      paintTeaser(cv, { ...cerTeaser(board(), S - 30000), msg: '비밀 문구 🤫', from: '지수' });
      for (const s of drawn(cv)) assert.equal(/비밀|지수|🤫/.test(s), false, s);
      assert.ok(drawn(cv).length >= 5);
    }
  });
  it('cuts a 13-character name to 12 and draws a card without fields', () => {
    const cv = fakeCanvas();
    paintTeaser(cv, { ...cerTeaser(board(), S - 1000), to: '가나다라마바사아자차카타파' });
    assert.ok(cv.words.includes('To. 가나다라마바사아자차카타'));
    assert.equal(cv.words.some((s) => s.includes('파')), false);
    const none = fakeCanvas();
    paintTeaser(none);
    assert.deepEqual(none.words, ['곧 켜져요', 'WISH BOARD', 'To. 당신']);
  });
  it('shares the gift board\'s ground in the board\'s theme', () => {
    const a = fakeCanvas(), g = fakeCanvas();
    paintTeaser(a, cerTeaser(board({ th: 'sky' }), S - 1000));
    paintGift(g, { ...GIFT, id: 'abcd1234', th: 'sky' });
    const upToFrame = (cv) => cv.calls.slice(0, cv.calls.findIndex((c) => c[0] === 'stroke') + 1);
    assert.deepEqual(upToFrame(a).filter((c) => c[0] === 'stop').slice(0, 2), upToFrame(g).filter((c) => c[0] === 'stop').slice(0, 2));
  });
});
