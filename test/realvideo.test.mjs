// 실사 축하 영상 (docs/superpowers/specs/2026-11-27-real-video-design.md): the pure rules in realrules.js — the homography from four
// corners, frame <-> time, the per-frame corner track, the plate JSON's shape, the card layouts and how long words wrap or shrink, the
// card's words from a gift, the music files (one per OCCASIONS key), the ambience level and its swell at the flash, the file name,
// the LED grid's level, whether a device keeps up — and, when assets/plates/ is there, the real plates against the same rules.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { OCC_KEYS, OCCASIONS } from '../giftrules.js';
import {
  REAL, SCENES, plateUrls, musicUrl, homography, invert3, applyH, frameOf, timeOf, quadAt, plateFault, layoutFor, fitLines, headOf,
  cardWords, ambGain, ambCurve, ambBaseDb, realFileName, ledMean, ledCols, screenStats, texSize, keepsUp, realReason, popAt, REAL_BEACONS,
  REAL_TYPES, pickRealType, REAL_DIR, finishReason, lowFor, LOW_MS, inAppBrowser, scenesToDrop, MUSIC_BACKUP,
} from '../realrules.js';
import { fragmentSource, MAX_SCREENS } from '../realvideo.js';

const near = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const Q = [[100, 200], [500, 220], [520, 900], [90, 880]];
const UNIT = [[0, 0], [1, 0], [1, 1], [0, 1]];
// A measure for layout tests: every code point is `size * 0.9` wide, a space half that.
const mono = (text, size) => Array.from(String(text)).reduce((w, c) => w + (c === ' ' ? 0.45 : 0.9) * size, 0);
const plate = (o = {}) => ({ v: 1, id: '01', name: '정면 밤', w: 1080, h: 1920, fps: 24, frames: 3, flash: 1.5, ground: { y: 0.74, tint: 0.03 },
  screens: [{ kind: 'led', layout: 'card', aspect: 0.7, corners: [Q, Q, Q] }], ...o });

describe('the homography from four corners', () => {
  it('maps each source corner onto its target corner', () => {
    const H = homography(UNIT, Q);
    UNIT.forEach((p, i) => { const q = applyH(H, p); near(q[0], Q[i][0], 1e-6); near(q[1], Q[i][1], 1e-6); });
  });
  it('is projective: the middle of the unit square goes to where the diagonals of the quad cross, not to the corners\' average', () => {
    const H = homography(UNIT, Q), m = applyH(H, [0.5, 0.5]);
    // the diagonals Q0-Q2 and Q1-Q3 cross at m
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    near(cross(Q[0], Q[2], m), 0, 1e-6, 'on diagonal 0-2'); near(cross(Q[1], Q[3], m), 0, 1e-6, 'on diagonal 1-3');
  });
  it('inverts: the quad back to the unit square', () => {
    const Hi = invert3(homography(UNIT, Q));
    Q.forEach((p, i) => { const q = applyH(Hi, p); near(q[0], UNIT[i][0], 1e-9); near(q[1], UNIT[i][1], 1e-9); });
    const I = invert3([2, 0, 0, 0, 4, 0, 0, 0, 1]); assert.deepEqual(I.map((v) => +v.toFixed(6)), [0.5, 0, 0, 0, 0.25, 0, 0, 0, 1]);
  });
  it('a degenerate quad (three points on a line) gives null, not NaN', () => {
    assert.equal(homography(UNIT, [[0, 0], [1, 1], [2, 2], [3, 3]]), null);
    assert.equal(invert3([1, 2, 3, 2, 4, 6, 0, 0, 0]), null);
  });
});

describe('frame <-> time', () => {
  it('a frame\'s media time gives that frame, even a hair under it; the middle of a frame gives the frame shown', () => {
    assert.equal(frameOf(0, 24, 241), 0);
    assert.equal(frameOf(36 / 24, 24, 241), 36, 'the flash frame');
    assert.equal(frameOf(36 / 24 - 1e-6, 24, 241), 36, 'a timestamp rounded down by the container');
    assert.equal(frameOf((36 + 0.5) / 24, 24, 241), 36);
    assert.equal(frameOf(-1, 24, 241), 0); assert.equal(frameOf(99, 24, 241), 240, 'clamped to the last frame');
    assert.equal(frameOf(NaN, 24, 241), 0);
  });
  it('the card\'s clock is the frame\'s own time', () => { assert.equal(timeOf(36, 24), 1.5); assert.equal(timeOf(0, 24), 0); });
});

describe('the corner track', () => {
  const A = [[0, 0], [10, 0], [10, 10], [0, 10]], B = [[2, 4], [12, 4], [12, 14], [2, 14]];
  it('per frame, linear between frames, clamped at the ends', () => {
    assert.deepEqual(quadAt([A, B], 0), A); assert.deepEqual(quadAt([A, B], 1), B);
    assert.deepEqual(quadAt([A, B], 0.5), [[1, 2], [11, 2], [11, 12], [1, 12]]);
    assert.deepEqual(quadAt([A, B], 7), B); assert.deepEqual(quadAt([A, B], -3), A);
  });
  it('a locked-off screen may give one quad for the whole clip', () => { assert.deepEqual(quadAt(A, 120), A); });
  it('screenStats: the narrowest top or bottom edge over the clip, the tallest side, the median width over height', () => {
    const s = screenStats({ corners: [A, [[0, 0], [8, 0], [9, 20], [0, 20]]] });
    assert.equal(s.minW, 8); near(s.maxH, Math.hypot(1, 20)); assert.ok(s.aspect > 0.4 && s.aspect < 1.01, String(s.aspect));
    const c = screenStats({ layout: 'corner', faces: [{ corners: [[0, 0], [40, 10], [40, 110], [0, 100]] }, { corners: [[40, 10], [100, 0], [100, 100], [40, 110]] }] });
    assert.equal(c.maxH, 100); assert.ok(c.minW >= 40, 'both faces together');
  });
});

describe('the plate JSON', () => {
  it('takes the documented shape', () => { assert.equal(plateFault(plate()), ''); });
  it('takes a corner screen (two faces and a split, no corners of its own) and small screens with vis', () => {
    const corner = { kind: 'led', layout: 'corner', aspect: 1.3, split: 0.48, faces: [{ corners: [Q, Q, Q] }, { corners: [Q, Q, Q] }] };
    assert.equal(plateFault(plate({ screens: [corner] })), '');
    const small = { kind: 'small', layout: 'card', aspect: 0.5, corners: [Q, Q, Q], vis: [1, 0, 1] };
    assert.equal(plateFault(plate({ screens: [plate().screens[0], small], ground: null })), '');
  });
  it('refuses what the compositor cannot draw, saying what', () => {
    assert.equal(plateFault(null), 'json');
    assert.equal(plateFault(plate({ v: 2 })), 'v');
    assert.equal(plateFault(plate({ fps: 0 })), 'fps');
    assert.equal(plateFault(plate({ screens: [] })), 'screens');
    assert.equal(plateFault(plate({ screens: [{ kind: 'tv', layout: 'card', aspect: 0.7, corners: [Q, Q, Q] }] })), 'kind');
    assert.equal(plateFault(plate({ screens: [{ kind: 'led', layout: 'poster', aspect: 0.7, corners: [Q, Q, Q] }] })), 'layout');
    assert.equal(plateFault(plate({ screens: [{ kind: 'led', layout: 'card', aspect: 0.7, corners: [Q, Q] }] })), 'corners', 'a frame short');
    assert.equal(plateFault(plate({ screens: [{ kind: 'led', layout: 'card', aspect: 0.7, corners: [Q, Q, [[0, 0], [1, 1], [2, 2]]] }] })), 'corners');
    assert.equal(plateFault(plate({ screens: [{ kind: 'led', layout: 'corner', aspect: 1.3, split: 0.48, faces: [{ corners: [Q, Q, Q] }] }] })), 'faces');
    assert.equal(plateFault(plate({ screens: [{ kind: 'led', layout: 'corner', aspect: 1.3, split: 1.2, faces: [{ corners: [Q, Q, Q] }, { corners: [Q, Q, Q] }] }] })), 'split');
    assert.equal(plateFault(plate({ ground: { y: 3 } })), 'ground');
  });
});

describe('the card layouts (card.py layout_for)', () => {
  it('names: card for a near-frontal board, banner for a tall one, wide for a landscape one, corner only by name', () => {
    assert.equal(layoutFor('', 0.7).name, 'card'); assert.equal(layoutFor('', 0.42).name, 'banner'); assert.equal(layoutFor('', 1.4).name, 'wide');
    assert.equal(layoutFor('corner', 1.3).name, 'corner'); assert.equal(layoutFor('banner', 0.7).name, 'banner', 'the JSON\'s choice wins');
  });
  it('every element sits inside the frame, top to bottom in reading order', () => {
    for (const [n, a] of [['card', 0.7], ['banner', 0.42], ['wide', 1.5], ['corner', 1.3]]) {
      const L = layoutFor(n, a), ys = [L.badge.y, L.to.y, ...L.head.ys, L.line.y, L.frm.y, L.brand.y];
      for (let i = 1; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1], `${n}: ${ys.join(' ')}`);
      assert.ok(ys[0] > L.inset && ys[ys.length - 1] < 1 - L.inset / a * 0.5, n);
      assert.ok(L.line.maxLines >= 1 && L.head.ys.length >= 1, n);
    }
    assert.equal(layoutFor('wide', 1.5).head.ys.length, 1, 'wide: one headline line'); assert.equal(layoutFor('card', 0.7).head.ys.length, 2);
  });
  it('the line room (for two or three lines) lies between the headline and From.', () => {
    for (const [n, a] of [['card', 0.7], ['banner', 0.42], ['wide', 1.5], ['corner', 0.825]]) {
      const L = layoutFor(n, a);
      assert.ok(L.line.room > 0 && L.line.y - L.line.room / 2 > L.head.ys.at(-1) && L.line.y + L.line.room / 2 < L.frm.y, n);
    }
  });
  it('corner keeps the lower part free for the gift box', () => { assert.ok(layoutFor('corner', 1.3).frm.y < 0.6); assert.ok(layoutFor('corner', 1.3).burst > 0.7); });
});

describe('long words wrap, then shrink (fitLines)', () => {
  it('a short line keeps its size on one line', () => { assert.deepEqual(fitLines('생일 축하해', mono, 1000, 50, 20, 2), { size: 50, lines: ['생일 축하해'] }); });
  it('a line a little too wide shrinks before it wraps', () => {
    const r = fitLines('가'.repeat(12), mono, 500, 50, 20, 2);
    assert.equal(r.lines.length, 1); assert.ok(r.size < 50 && r.size >= 0.8 * 50, String(r.size)); assert.ok(mono(r.lines[0], r.size) <= 500);
  });
  it('a long line wraps between words, every line inside the width', () => {
    const t = '오늘 하루도 정말 수고 많았어 언제나 응원할게 사랑해';
    const r = fitLines(t, mono, 500, 50, 20, 2);
    assert.equal(r.lines.length, 2); for (const l of r.lines) assert.ok(mono(l, r.size) <= 500, l);
    assert.equal(r.lines.join(' '), t, 'no word lost or cut');
  });
  it('past the smallest size and the last line, the end is cut with an ellipsis', () => {
    const r = fitLines('가'.repeat(80), mono, 300, 50, 20, 2);
    assert.equal(r.size, 20); assert.equal(r.lines.length, 2); assert.ok(r.lines[1].endsWith('…')); for (const l of r.lines) assert.ok(mono(l, 20) <= 300, l);
  });
  it('empty text: no lines', () => { assert.deepEqual(fitLines('  ', mono, 300, 50, 20, 2).lines, []); });
});

describe('the card\'s words', () => {
  it('the headline is the occasion\'s, in two lines, with an exclamation where it is a wish', () => {
    assert.deepEqual(headOf('bday'), ['생일', '축하해요!']); assert.deepEqual(headOf('cheer'), ['언제나', '응원해요!']);
    assert.deepEqual(headOf('just'), ['그냥', '생각나서']); assert.deepEqual(headOf('nope'), headOf('bday'));
    for (const k of OCC_KEYS) assert.equal(headOf(k).join(' ').replace(/!$/, ''), OCCASIONS[k].head, k);
  });
  it('To., the line (or the occasion\'s hint), From. only with a sender; nothing as emoji', () => {
    const w = cardWords({ to: '민지', from: '지수', occ: 'pass', msg: '고생했어!' });
    assert.deepEqual([w.to, w.occ, w.line, w.from, w.brand, w.key], ['To. 민지', '합격', '고생했어!', 'From. 지수', 'WISH BOARD', 'pass']);
    const e = cardWords({ to: ' 민지 ', occ: 'bday', msg: '  ' });
    assert.equal(e.line, OCCASIONS.bday.hint); assert.equal(e.from, ''); assert.equal(e.to, 'To. 민지');
    assert.equal(/\p{Extended_Pictographic}/u.test(JSON.stringify(cardWords({ to: 'a', occ: 'bday' }))), false);
    assert.equal(cardWords(null).key, 'bday');
  });
});

describe('the files', () => {
  it('a scene\'s three files, under /assets/plates/, no query (they are cached long)', () => {
    assert.deepEqual(plateUrls('03'), { mp4: '/assets/plates/plate-03.mp4', jpg: '/assets/plates/plate-03.jpg', json: '/assets/plates/plate-03.json' });
    assert.equal(SCENES.length, 7); assert.deepEqual(SCENES.map((s) => s.id), ['01', '02', '03', '04', '05', '06', '07']);
    assert.deepEqual(SCENES.map((s) => s.name), ['정면 밤', '타워', '비 오는 밤', '연말 군중', '내 손 휴대폰', '코너 입체', '블루아워']);
  });
  it('one music file per OCCASIONS key; an unknown day plays the birthday song', () => {
    for (const k of OCC_KEYS) assert.equal(musicUrl(k), '/assets/plates/music-' + k + '.m4a');
    assert.equal(musicUrl('zzz'), musicUrl('bday'));
  });
  it('the file name: wishboard-<받는 사람>-<장면>.mp4, nothing a file system refuses', () => {
    assert.equal(realFileName({ to: '민지' }, '비 오는 밤', 'video/mp4'), 'wishboard-민지-비_오는_밤.mp4');
    assert.equal(realFileName({ to: 'a/b:c*?' }, '타워', 'video/webm'), 'wishboard-a_b_c_-타워.webm');
    assert.equal(realFileName(null, '', ''), 'wishboard-gift-video.mp4');
  });
  it('the beacons the page sends (giftsrv.js allows them)', () => {
    assert.deepEqual([...REAL_BEACONS], ['real_pick', 'real_made', 'real_save', 'real_share', 'real_fail']);
    assert.match(fs.readFileSync(new URL('../giftsrv.js', import.meta.url), 'utf8'), /\.\.\.REAL_BEACONS/);
  });
});

describe('the sound', () => {
  it('the ambience sits at about -34 LUFS: the base gain from the plate\'s own loudness, clamped', () => {
    near(ambBaseDb(-24), -10, 1e-9); near(ambBaseDb(-34), 0, 1e-9); near(ambBaseDb(undefined), REAL.ambDefaultDb, 1e-9);
    assert.ok(ambBaseDb(-80) <= 12, 'a silent plate is not pushed into noise'); assert.ok(ambBaseDb(0) >= -40);
  });
  it('swells about 10 dB around the flash (music.py ambience_gain) and is flat away from it', () => {
    near(ambGain(0, 1.5, -10, 0), 10 ** (-10 / 20), 1e-9, 'start');
    near(ambGain(1.5 + 0.3, 1.5, -10, 0), 1, 1e-9, 'the swell');
    near(ambGain(5, 1.5, -10, 0), 10 ** (-10 / 20), 1e-9, 'after');
    assert.ok(ambGain(1.2, 1.5, -10, 0) > ambGain(1.0, 1.5, -10, 0), 'rises into the flash');
    const c = ambCurve(101, 10, 1.5, -10, 0); assert.equal(c.length, 101); near(c[0], ambGain(0, 1.5, -10, 0), 1e-6); near(c[100], ambGain(10, 1.5, -10, 0), 1e-6);
  });
});

describe('the LED look and the texture', () => {
  it('ledMean normalises the dot grid so it does not dim the board', () => {
    const p = 0.7; let s = 0; const n = 2000;
    for (let i = 0; i < n; i++) for (let j = 0; j < 40; j++) { const gx = 0.5 + 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / n), gy = 0.5 + 0.5 * Math.cos(2 * Math.PI * (j + 0.5) / 40); s += (gx * gy) ** p; }
    near(ledMean(p), s / (n * 40), 2e-3);
  });
  it('about one LED per 3 output pixels at the narrowest edge, at least 40', () => { assert.equal(ledCols(450), 150); assert.equal(ledCols(60), 40); assert.equal(ledCols(450, 720 / 1080), 100); });
  it('the card texture follows the screen\'s size on the output, within bounds', () => {
    assert.deepEqual(texSize(0.7, 650), { w: Math.round(845 * 0.7), h: 845 }); assert.deepEqual(texSize(0.7, 50), { w: 224, h: 320 }); assert.equal(texSize(1.3, 3000).h, 1280);
  });
});

describe('the device', () => {
  it('keeps up when it draws most of the frames the video showed in the first second', () => {
    assert.equal(keepsUp(24, 24), true); assert.equal(keepsUp(17, 24), true); assert.equal(keepsUp(12, 24), false); assert.equal(keepsUp(0, 0), true, 'nothing to judge yet');
    assert.equal(keepsUp(8, 24, 0.3), true, 'at 720 only a device far too slow stops'); assert.equal(keepsUp(5, 24, 0.3), false);
  });
  it('records picture and sound: MP4 (H.264 + AAC) first, WebM (VP9/VP8 + Opus) otherwise, the bare container last', () => {
    assert.equal(REAL_TYPES[0], 'video/mp4;codecs=avc1.42E01E,mp4a.40.2');
    assert.equal(pickRealType((t) => t.startsWith('video/webm')), 'video/webm;codecs=vp9,opus');
    assert.equal(pickRealType((t) => t === 'video/mp4'), 'video/mp4');
    assert.equal(pickRealType(() => false), ''); assert.equal(pickRealType(() => { throw new Error('x'); }), '');
    assert.ok(REAL_TYPES.every((t) => /^video\/(mp4|webm)/.test(t)));
  });
  it('says why it cannot make the video: recording first, then WebGL', () => {
    assert.equal(realReason({ rec: true, gl: true }), ''); assert.equal(realReason({ rec: false, gl: true }), 'record'); assert.equal(realReason({ rec: true, gl: false }), 'webgl');
  });
});

describe('the corner gift box (corner.py GiftPop timings)', () => {
  it('nothing before 1.58 s; out of the corner, then the lid opens, then a slow bob', () => {
    assert.equal(popAt(1.5), null);
    const a = popAt(1.7), b = popAt(2.5), c = popAt(3.2);
    assert.ok(a.out < b.out, 'it comes out'); assert.equal(a.lid, 0); assert.ok(c.lid > 1.8 && c.lid < 2.3, 'the lid ~118 degrees open'); assert.ok(c.scale > 0.99);
  });
});

// The real plates (another job makes them into assets/plates/): the same rules, when they are there.
const DIR = new URL('../assets/plates/', import.meta.url);
const HAVE = fs.existsSync(new URL('index.json', DIR));
describe('the real plates in assets/plates/', { skip: HAVE ? false : 'assets/plates/index.json is not there yet' }, () => {
  const idx = HAVE ? JSON.parse(fs.readFileSync(new URL('index.json', DIR), 'utf8')) : null;
  it('index.json names the seven scenes; every scene has its mp4 (<= 8 MB), jpg and a JSON the compositor takes', () => {
    const list = Array.isArray(idx) ? idx : idx.plates || idx.scenes;
    assert.ok(Array.isArray(list) && list.length === 7, 'seven scenes');
    for (const p of list) {
      const id = String(p.id), u = plateUrls(id);
      for (const f of [u.mp4, u.jpg, u.json]) assert.ok(fs.existsSync(new URL('..' + f, import.meta.url)), f);
      assert.ok(fs.statSync(new URL('..' + u.mp4, import.meta.url)).size <= 8 * 1024 * 1024, u.mp4);
      const j = JSON.parse(fs.readFileSync(new URL('..' + u.json, import.meta.url), 'utf8'));
      assert.equal(plateFault(j), '', id + ': ' + plateFault(j));
    }
  });
  it('a music file for every OCCASIONS key (a key in MUSIC_BACKUP may wait for its own: its stand-in is there)', () => {
    const has = (k) => fs.existsSync(new URL('..' + musicUrl(k), import.meta.url));
    for (const k of OCC_KEYS) assert.ok(has(k) || (Object.hasOwn(MUSIC_BACKUP, k) && has(MUSIC_BACKUP[k])), musicUrl(k));
    const m = idx && !Array.isArray(idx) ? idx.music : null;
    const named = m ? (Array.isArray(m) ? m.map((x) => (typeof x === 'string' ? x : x.occ)) : Object.keys(m)) : [];
    if (m) for (const k of OCC_KEYS) assert.ok(named.includes(k) || Object.hasOwn(MUSIC_BACKUP, k), 'index.json names ' + k);
    if (m) for (const k of named) assert.ok(OCC_KEYS.includes(k), 'index.json names no unknown day: ' + k);
    if (Array.isArray(m)) for (const x of m) if (x && x.file) assert.equal(REAL_DIR + x.file, musicUrl(x.occ), 'the page asks for the file index.json names');
  });
});

describe('review fixes (2026-11-27)', () => {
  it('a run is done only when the video reached its last frames; anything else keeps its reason', () => {
    assert.equal(finishReason('done', 240, 241), 'done'); assert.equal(finishReason('done', 239, 241), 'done', 'one frame short of the end still counts');
    assert.equal(finishReason('done', 200, 241), 'short', 'the safety timer or an early end is not a video');
    assert.equal(finishReason('aborted', 240, 241), 'aborted'); assert.equal(finishReason('', 240, 241), 'fail');
  });
  it('the shader is sized to the plate: as many screen slots as it has entries (GLES2 guarantees few uniform vectors)', () => {
    assert.match(fragmentSource(3), /#define N 3\n/); assert.match(fragmentSource(0), /#define N 1\n/);
    assert.match(fragmentSource(99), new RegExp('#define N ' + MAX_SCREENS + '\n'));
  });
  it('plate files carry their version from index.json, so a re-made video and its corners always match', () => {
    const e = { id: '03', mp4Bytes: 7390201, jsonBytes: 13931, jpgBytes: 36693 };
    assert.deepEqual(plateUrls('03', e), { mp4: '/assets/plates/plate-03.mp4?v=7390201-13931', json: '/assets/plates/plate-03.json?v=7390201-13931', jpg: '/assets/plates/plate-03.jpg?v=36693' });
    assert.deepEqual(plateUrls('03', {}), plateUrls('03'), 'no sizes: no query');
  });
  it('720 is remembered for a week, not for ever (an old flag without a time counts as expired)', () => {
    const now = Date.UTC(2026, 10, 27);
    assert.equal(lowFor(String(now - 1000), now), true); assert.equal(lowFor(String(now - LOW_MS - 1), now), false);
    assert.equal(lowFor('1', now), false); assert.equal(lowFor(null, now), false); assert.equal(lowFor(String(now + 60000), now), false, 'a time from the future is not trusted');
    assert.equal(LOW_MS, 7 * 864e5);
  });
  it('in-app browsers (no share sheet, no blob download) are told to open Chrome or Safari', () => {
    for (const ua of ['Mozilla/5.0 (iPhone) AppleWebKit Mobile KAKAOTALK 10.4.5', 'Mozilla/5.0 (Linux; Android 14) Instagram 300.0', 'Mozilla/5.0 [FBAN/FBIOS;FBAV/450]', 'Mozilla/5.0 Line/13.1.0', 'Mozilla/5.0 NAVER(inapp; search; 1000)', 'Mozilla/5.0 DaumApps/5.0', 'Mozilla/5.0 everytimeApp'])
      assert.equal(inAppBrowser(ua), true, ua);
    for (const ua of ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1', '', undefined])
      assert.equal(inAppBrowser(ua), false, String(ua));
  });
  it('at most the scene in hand and the one before stay in memory', () => {
    assert.deepEqual(scenesToDrop(['01', '03', '05']), ['01']); assert.deepEqual(scenesToDrop(['01', '03']), []); assert.deepEqual(scenesToDrop([]), []);
  });
  it('the occasion is looked up as an own key only (constructor, __proto__ are not occasions)', () => {
    for (const k of ['constructor', '__proto__', 'toString']) { assert.equal(musicUrl(k), musicUrl('bday'), k); assert.deepEqual(headOf(k), headOf('bday'), k); assert.equal(cardWords({ occ: k }).key, 'bday', k); }
  });
  it('the file name drops control characters and direction marks, and is cut by code points (no half emoji)', () => {
    assert.equal(realFileName({ to: 'a\u202eb\u0007c\u200f\u2066d' }, '비\u200e 오는 밤', 'video/mp4'), 'wishboard-abcd-비_오는_밤.mp4');
    const n = realFileName({ to: '😀'.repeat(50) }, '타워', 'video/mp4');
    assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(n), false, 'no lone surrogate');
    assert.equal(Array.from(n.slice('wishboard-'.length, n.indexOf('-타워'))).length, 40);
  });
});

describe('the service worker leaves the plates to the network', () => {
  const handlers = {};
  const self = { location: { href: 'https://sq.example/sw.js?v=11', origin: 'https://sq.example' }, addEventListener: (k, f) => { handlers[k] = f; }, clients: {}, registration: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), { self, URL, caches: { open: async () => ({ match: async () => null, put: async () => {} }) }, fetch: async () => ({ ok: false }) });
  const served = (path) => { let took = false; handlers.fetch({ request: { method: 'GET', url: 'https://sq.example' + path }, respondWith: () => { took = true; } }); return took; };
  it('plates, their tracks, stills and music go straight to the network (no cache-first, no waiting for the cache)', () => {
    for (const f of ['plate-01.mp4?v=1-2', 'plate-01.json?v=1-2', 'plate-01.jpg?v=3', 'index.json', 'music-bday.m4a']) assert.equal(served('/assets/plates/' + f), false, f);
    assert.equal(served('/assets/models/CatToy.glb'), true, 'other assets are still cached');
  });
  it('the worker is registered at one new revision in both pages (a new revision drops the old cache with any plates in it)', () => {
    const at = (f) => [...fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').matchAll(/register\('\/sw\.js\?v=(\d+)'\)/g)].map((m) => Number(m[1]));
    assert.deepEqual([...at('index.html'), ...at('giftpage.js')], [11, 11]);
  });
});
