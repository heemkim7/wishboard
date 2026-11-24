// 환영 전광판: the newcomer's own name on a plaza screen for a few seconds, on this device only. The card (giftart.js paintWelcome), the pin
// that puts it on the nearest free street screen (ts3d/screens.js pinWelcome, with the real three and a recording 2D context), and the wiring
// that shows it once (main.js, ui.js, timesSquare3d.js: source checks, since those need a browser). The pure rules are in test/ftue.test.mjs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { paintGift, paintWelcome } from '../giftart.js';
import { WELCOME } from '../ftue.js';

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
