// 실사 축하 영상, the corner box in 3D (out/popout-2026-11-28, the owner's decisions of 2026-11-28): which pop-out a day gets, each
// day's beat (against tools/plates/music.py, which made the music), the room solved from plate 6's camera, what shows through the
// opening, the two timelines on the beats (the gift box that leaves the frame and lets balloons go; the headline's letters), the
// room's colours per theme, and the shader the compositor builds for it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { OCC_KEYS, GIFT_THEMES } from '../giftrules.js';
import {
  REAL, POP_VARIANT, popVariant, MUSIC_BEAT, beatOf, beatAt, beatNear, beatPulse, roomLights, roomFlash, cornerRoom, projectRoom, throughOpening,
  giftScene, lettersScene, heroLines, HERO_MAX, roomPalette, luma, sortFarToNear, POP_MODE, rotAxis,
} from '../realrules.js';
import { fragmentSource } from '../realvideo.js';

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const plate6 = JSON.parse(fs.readFileSync(new URL('../assets/plates/plate-06.json', import.meta.url), 'utf8'));
const room = cornerRoom(plate6.camera);
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const theme = (k) => { const t = GIFT_THEMES[k]; return { a: hex(t.a), b: hex(t.b), hi: hex(t.hi), deep: hex(t.deep), ink: hex(t.ink) }; };
const minXZ = (p) => Math.min(p[0], p[2]);
// a monospace stand-in for the glyph atlas: every letter a cell 1.3 x 1.6 font sizes, advance 0.95 ('!' 0.35)
const mono = (text) => Object.fromEntries(Array.from(text).map((c) => [c, { rect: [0, 0, 1, 1], w: 1.3, h: 1.6, adv: c === '!' ? 0.35 : 0.95 }]));

describe('which pop-out a day gets (the owner, 2026-11-28)', () => {
  it('gift-feeling days: the box and balloons; days whose words are the point: the 3D letters', () => {
    for (const k of ['bday', 'anniv', 'love', 'thanks', 'just']) assert.equal(popVariant(k), 'gift', k);
    for (const k of ['cheer', 'pass', 'grad', 'me']) assert.equal(popVariant(k), 'letters', k);
  });
  it('every day is listed; a day not listed (or not a day) gets the box', () => {
    assert.deepEqual(Object.keys(POP_VARIANT).sort(), [...OCC_KEYS].sort());
    for (const k of ['party', '', null, undefined, 'constructor', '__proto__', 42]) assert.equal(popVariant(k), 'gift', String(k));
  });
});

describe('each day\'s beat', () => {
  it('one entry per day, beat 0 on the flash', () => {
    assert.deepEqual(Object.keys(MUSIC_BEAT).sort(), [...OCC_KEYS].sort());
    for (const k of OCC_KEYS) { assert.equal(MUSIC_BEAT[k].t0, REAL.flash, k); near(beatOf(k).beat, 60 / MUSIC_BEAT[k].bpm, 1e-12, k); }
    assert.deepEqual(beatOf('nope'), beatOf('bday'), 'an unknown day: the birthday song');
  });
  it('the tempo and the bar are the ones tools/plates/music.py wrote the music with', () => {
    const src = fs.readFileSync(new URL('../tools/plates/music.py', import.meta.url), 'utf8');
    const seen = {};
    for (const m of src.matchAll(/name='(\w+)', key='[^']*', meter=(\d+), bpm=([\d.]+)/g)) seen[m[1]] = { meter: Number(m[2]), bpm: Number(m[3]) };
    assert.deepEqual(Object.keys(seen).sort(), [...OCC_KEYS].sort());
    for (const k of OCC_KEYS) assert.deepEqual({ meter: MUSIC_BEAT[k].meter, bpm: MUSIC_BEAT[k].bpm }, seen[k], k);
    assert.match(src, /T_FLASH = 36 \/ FPS/, 'the hit is on frame 36 = 1.5 s');
  });
  it('beat helpers: times, the nearest beat (not before a floor), a bump on each beat', () => {
    const bt = beatOf('bday');
    near(beatAt(bt, 3), 1.5 + 3 * 60 / 108, 1e-12); assert.equal(beatNear(bt, 3.17), 3); assert.equal(beatNear(bt, 1.6, 2), 2);
    assert.ok(beatPulse(beatAt(bt, 2) + 0.03, [beatAt(bt, 2)]) > 0.9); assert.equal(beatPulse(beatAt(bt, 2) + 0.3, [beatAt(bt, 2)]), 0);
  });
  it('the room is dark before the hit (with the heartbeat), lit after it, lifting on the beats; the flash peaks on the hit', () => {
    const bt = beatOf('cheer');
    assert.ok(roomLights(0.5, bt) < 0.3 && roomLights(1.3, bt) < 0.3);
    assert.ok(roomLights(bt.t0 - bt.beat + 0.03, bt) > roomLights(bt.t0 - bt.beat - 0.1, bt), 'a heartbeat');
    assert.ok(roomLights(2.5, bt) >= 0.55); assert.ok(roomLights(beatAt(bt, 4) + 0.04, bt) > roomLights(beatAt(bt, 4) + bt.beat / 2, bt), 'a lift on the beat');
    assert.equal(roomFlash(1.0, bt), 0); assert.ok(roomFlash(1.5, bt) > 0.8); assert.ok(roomFlash(2.2, bt) < 0.01);
  });
});

describe('the room from plate 6\'s camera', () => {
  it('the camera stands level with the screen\'s lower edge, in front of both faces (NOTES: about (-0.53, 0, -0.62))', () => {
    near(room.C[0], -0.53, 0.01); near(room.C[1], 0, 0.01); near(room.C[2], -0.62, 0.01);
  });
  it('the fold and the outer edges project onto the screen\'s tracked corners', () => {
    const [L, R] = plate6.screens[0].faces.map((f) => f.corners[0]);
    const px = (w) => projectRoom(room, w).slice(0, 2), d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    assert.ok(d(px([0, 1, 0]), L[1]) < 4 && d(px([0, 0, 0]), L[2]) < 4, 'the fold');
    assert.ok(d(px([room.wR, 1, 0]), R[1]) < 6 && d(px([0, 1, room.wL]), L[0]) < 6, 'the outer top corners');
  });
  it('the panel stands inside the room, faces the camera and is upright', () => {
    const { ctr, n, up, rt, half } = room.panel;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = [0, 1, 2].map((i) => ctr[i] + rt[i] * half[0] * sx + n[i] * half[2] * sz);
      assert.ok(p[0] > 0 && p[0] < room.rx && p[2] > 0 && p[2] < room.rz);
    }
    assert.ok(ctr[1] - half[1] > room.y0 && ctr[1] + half[1] < room.y1, 'between the floor and the ceiling');
    const toC = [room.C[0] - ctr[0], 0, room.C[2] - ctr[2]], k = Math.hypot(...toC);
    near(n[0] * toC[0] / k + n[2] * toC[2] / k, 1, 1e-9, 'faces the camera'); assert.deepEqual(up, [0, 1, 0]);
  });
  it('no camera, a broken one, or a viewer behind the faces: no room (the flat corner is drawn)', () => {
    assert.equal(cornerRoom(undefined), null); assert.equal(cornerRoom({ P: [[1, 0, 0]], wL: 0.4, wR: 0.4 }), null);
    assert.equal(cornerRoom({ ...plate6.camera, wL: 0 }), null);
    const P = plate6.camera.P.map((r) => r.slice()), M = [[1, 0, 0, -3], [0, 1, 0, 0], [0, 0, 1, -3], [0, 0, 0, 1]];
    const moved = P.map((r) => [0, 1, 2, 3].map((j) => r.reduce((s, v, i) => s + v * M[i][j], 0))); // the world moved: the camera now at X, Z > 0
    assert.equal(cornerRoom({ ...plate6.camera, P: moved }), null);
  });
  it('inside the building only what the opening shows; in front of it anything', () => {
    const { ctr } = room.panel;
    assert.equal(throughOpening(room, ctr), true, 'the panel, through the opening');
    assert.equal(throughOpening(room, [0.05, 0.005, 0.05]), false, 'just inside, behind the bottom of the frame');
    assert.equal(throughOpening(room, [-0.3, 2, -0.3]), true, 'in front, up in the sky');
  });
});

describe('A: the gift box on the beats', () => {
  for (const occ of ['bday', 'love', 'just']) {
    it(`${occ}: hops on the beats before the pop, pops on a beat, leaves the frame and stands in front; balloons into the sky`, () => {
      const bt = beatOf(occ), sc = giftScene(room, bt, theme('party')), { hops, pop, balloons } = sc.times;
      const onBeat = (t) => Math.abs((t - bt.t0) / bt.beat - Math.round((t - bt.t0) / bt.beat)) < 1e-9;
      assert.ok(hops.length >= 1 && hops.every(onBeat) && hops.every((h) => h < pop), 'hops');
      assert.ok(onBeat(pop) && pop >= beatAt(bt, 2) && pop < 4.5, 'the pop'); assert.ok(onBeat(balloons) && balloons > pop + 1, 'the balloons');
      const a = sc.state(2.0).pos, b = sc.state(9.5).pos;
      assert.ok(minXZ(a) > 0, 'starts in the room'); assert.ok(minXZ(b) < -0.1, 'ends in front of the fold');
      const start = sc.at(1.0).items.flatMap((it) => it.pts);
      assert.ok(start.some((p) => !throughOpening(room, p)) && start.some((p) => throughOpening(room, p)), 'at first half hidden by the frame\'s lower edge');
      const end = sc.at(9.5);
      const top = projectRoom(room, [0, 1, 0])[1]; // the screen's highest point in the picture (the fold's top)
      assert.ok(end.items.some((it) => it.mode === POP_MODE.ball && it.pts.some((p) => projectRoom(room, p)[1] < top)), 'a balloon above the screen\'s top');
      assert.equal(end.spheres.length, 3); assert.ok(end.boxes.length >= 1);
      assert.ok(sc.at(pop + 0.5).items.filter((it) => it.mode === POP_MODE.flat).length > 50, 'confetti');
    });
  }
  it('a dark accent (밤하늘) keeps the box bright', () => {
    const sc = giftScene(room, beatOf('bday'), theme('night')), face = sc.at(1).items.find((it) => it.mode === POP_MODE.face);
    assert.ok(luma(face.col) > 0.05);
  });
});

describe('B: the headline\'s letters on the beats', () => {
  it('the headline\'s lines; more than 8 letters keep the last line', () => {
    assert.deepEqual(heroLines({ occ: 'cheer' }), ['언제나', '응원해요!']); assert.deepEqual(heroLines({ occ: 'me' }), ['오늘의', '주인공']);
    assert.deepEqual(heroLines({ occ: 'grad' }), ['축하해요!']); assert.deepEqual(heroLines({ occ: 'pass' }), ['합격', '축하해요!']);
    for (const k of OCC_KEYS) assert.ok(Array.from(heroLines({ occ: k }).join('').replace(/\s/g, '')).length <= HERO_MAX, k);
  });
  for (const occ of ['cheer', 'pass', 'grad', 'me']) {
    it(`${occ}: one letter a beat from beat 1, from the panel to in front of the fold, rows no wider than the screen`, () => {
      const bt = beatOf(occ), lines = heroLines({ occ }), sc = lettersScene(room, bt, theme('sky'), lines, mono(lines.join('')), { layers: 6 });
      assert.equal(sc.letters.length, Array.from(lines.join('').replace(/\s/g, '')).length);
      sc.letters.forEach((l, i) => { near(l.t0, beatAt(bt, 1 + i), 1e-9); assert.ok(minXZ(l.start) > 0, 'starts in the room'); });
      assert.ok(sc.letters.at(-1).t0 + 0.62 < 9, 'all landed well before the end');
      for (const l of sc.letters) { const s = sc.letterAt(l, 9.5); assert.ok(minXZ(s.pos) < 0.03 && s.pos[1] > 0.2 && s.pos[1] < 0.7, l.ch); near(s.k, 1.22, 1e-9); }
      for (const y of new Set(sc.letters.map((l) => l.land[1]))) {
        const row = sc.letters.filter((l) => l.land[1] === y), xs = row.map((l) => l.land[0] - l.land[2]);
        assert.ok(Math.max(...xs) - Math.min(...xs) <= 0.75, 'a row fits across the two faces');
      }
      const f = sc.at(6);
      assert.equal(f.glyphs.length, sc.letters.length); assert.ok(f.items.filter((it) => it.mode === POP_MODE.side).length >= 6 * sc.letters.length, 'extruded');
    });
  }
});

describe('the room\'s colours per theme', () => {
  for (const k of Object.keys(GIFT_THEMES)) {
    it(`${k}: walls dark, the neon and the highlight bright`, () => {
      const p = roomPalette(theme(k));
      assert.ok(luma(p.wall) <= 0.0451 && luma(p.wall) > 0.01, 'walls'); assert.ok(luma(p.ceil) < luma(p.wall));
      assert.ok(luma(p.neon) >= 0.12, 'neon glows'); assert.ok(luma(p.gold) > 0.3);
    });
  }
});

describe('the GL side', () => {
  it('the box shader: the room branch and the casters\' counts only when asked', () => {
    const s = fragmentSource(2, { nb: 2, ns: 3, ng: 0 });
    assert.match(s, /#define ROOM\n/); assert.match(s, /#define NB 2\n/); assert.match(s, /#define NS 3\n/); assert.match(s, /#define NG 0\n/);
    assert.doesNotMatch(fragmentSource(2), /#define ROOM/);
    assert.doesNotMatch(s.replace(/#define N \d+/, ''), /\bN\s*=/, 'nothing named N (the macro would eat it)');
  });
  it('far to near from the camera', () => {
    const items = [{ pts: [[0, 0, 0]] }, { pts: [[-0.4, 0, -0.5]] }, { pts: [[0.3, 0.5, 0.3]] }];
    assert.deepEqual(sortFarToNear(items, room.C).map((it) => it.pts[0][0]), [0.3, 0, -0.4]);
  });
  it('rotations are rotations', () => {
    const R = rotAxis([1, 0.2, -0.6], 1.3);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) near(R[i].reduce((s, v, k) => s + v * R[j][k], 0), i === j ? 1 : 0, 1e-12);
  });
});
