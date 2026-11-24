// 환영 전광판: the newcomer's own name on a plaza screen for a few seconds, on this device only. The card (giftart.js paintWelcome), the pin
// that puts it on the nearest free street screen (ts3d/screens.js pinWelcome, with the real three and a recording 2D context), and the wiring
// that shows it once (main.js, ui.js, timesSquare3d.js: source checks, since those need a browser). The pure rules are in test/ftue.test.mjs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { register } from 'node:module';
import { paintGift, paintWelcome } from '../giftart.js';
import { WELCOME } from '../ftue.js';

register(new URL('./nine-three-hook.mjs', import.meta.url)); // 'three' -> the vendored build, so ts3d/screens.js loads in Node

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
    await later(9000, () => { one.tick(new one.THREE.Vector3(0, 5, 12)); assert.ok(one.words('STREET_1').includes('To. 민지'), 'the gift is back after the card'); });
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
