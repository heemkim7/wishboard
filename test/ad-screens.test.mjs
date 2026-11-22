// AD_1..AD_5, the ad-only screens (상6): where ts3d/bowtie.js puts them on the real map, that they keep clear of every
// claimable face, blade and building, that the 보기 camera frames them whole in portrait and landscape (and that no claimable
// board's camera now looks through one), and that they are not claimable. The boards themselves stay pinned in boards.test.mjs.
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { SLOT_IDS, SLOT_RE } from '../balance.js';
import { boardVantage, portraitFov, facesBlock } from '../camrig.js';
import { createNYC } from '../ts3d/nyc.js';
import { SKIP_ZONES, LAYOUT, groundHeight } from '../ts3d/layout.js';
import { planBowtie, faceGap, faceOf, CORE, AD_IDS, AD_SPOTS, AD_N, segThrough } from '../ts3d/bowtie.js';
import { AD_SCREENS, AD_SCREEN_IDS } from '../adsale.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MAP = new URL('../assets/nyc/manhattan.bin', import.meta.url);
const haveMap = existsSync(MAP);
let nyc = null, plan = null;
function loadMap() {
  if (nyc) return;
  nyc = createNYC(new Uint8Array(gunzipSync(readFileSync(MAP))));
  const B = nyc.buildings;
  for (let i = 0; i < B.count; i++) for (const z of SKIP_ZONES) if (B.cx[i] >= z.x0 && B.cx[i] <= z.x1 && B.cz[i] >= z.z0 && B.cz[i] <= z.z1) { nyc.skipBuilding[i] = 1; break; }
  plan = planBowtie(nyc);
  nyc.ensureSolid(16, 90, 400);
}
// Where they went (face centre x, z, centre height, width), pinned like the boards: a change to the plan cannot move a sold screen.
const PINNED = {
  AD_1: [69.92, 101.7, 7.69, 11], AD_2: [13.12, 202.44, 20.34, 17], AD_3: [-25.62, -12.19, 30.46, 11], AD_4: [46.02, 193.21, 24.98, 12.5], AD_5: [12.72, -48.39, 15.28, 11],
};
const onStreet = (x, y, z, nx, nz) => {
  const ax = x + nx * 3, az = z + nz * 3;
  const clear = (deg) => { const a = (deg * Math.PI) / 180, dx = nx * Math.cos(a) - nz * Math.sin(a), dz = nx * Math.sin(a) + nz * Math.cos(a); return nyc.rayBlock(ax, y, az, ax + dx * 60, y, az + dz * 60) === 1; };
  for (let deg = -85; deg < 85; deg += 5) if (clear(deg) && clear(deg + 5)) return true;
  return false;
};

describe('the ad screens are not claimable', () => {
  it('AD_1..AD_5: not in the slot table or its one id test; the page and the plan name the same five', () => {
    assert.equal(AD_N, 5);
    assert.deepEqual(AD_IDS, ['AD_1', 'AD_2', 'AD_3', 'AD_4', 'AD_5']);
    assert.deepEqual(AD_SCREEN_IDS, AD_IDS);
    for (const id of AD_IDS) { assert.equal(SLOT_RE.test(id), false, id); assert.equal(SLOT_IDS.includes(id), false, id); }
    assert.deepEqual(Object.keys(AD_SPOTS), AD_IDS);
  });
  it('they mount on their own screens, never on the board registry; no wish, king, sticker, takeover or bid reaches them', () => {
    const tq = read('ts3d/timesq.js'), sc = read('ts3d/screens.js');
    const block = tq.slice(tq.indexOf('// AD_1..AD_5'), tq.indexOf('// Blade signs on the canyon walls'));
    assert.match(block, /ctx\.adScreens\.mount\(a\.id, g, \{ y: a\.y, z: 0\.2, w: a\.w, h: a\.h \}\);/);
    assert.equal(/boards\.mount/.test(block), false);
    const ads = sc.slice(sc.indexOf('export function createAdScreens'));
    assert.equal(/\b(wish\w*|king\w*|decals?|setAir|askBid|sticker\w*)\b|boards\./i.test(ads), false);
    assert.match(ads, /mesh\.userData\.pick = \{ kind: 'adscreen', id \};/);
    assert.match(sc, /const CLAIM = SLOT_RE;/); // the claimable boards' test is unchanged, and AD_ ids fail it
  });
  it('empty screens share one canvas; a booked screen gets its own and gives it back', () => {
    const sc = read('ts3d/screens.js'), ads = sc.slice(sc.indexOf('export function createAdScreens'));
    assert.match(ads, /r\.mesh\.material = sharedOf\(v\.kind\)\.mat; if \(r\.own\) \{ r\.own\.tex\.dispose\(\); r\.own\.mat\.dispose\(\); r\.own = null; \}/);
    assert.match(ads, /const low = quality === 'low', CW = low \? 512 : 1024, CH = low \? 288 : 576;/);
  });
});

describe('where the five go (ts3d/bowtie.js on the real map)', { skip: haveMap ? false : 'assets/nyc/manhattan.bin missing' }, () => {
  before(loadMap);
  it('exactly where they were placed, the same on every run, and where the /ads page says', () => {
    assert.deepEqual(plan.ads.map((a) => a.id), AD_IDS);
    for (const a of plan.ads) {
      const f = faceOf(a), [x, z, y, w] = PINNED[a.id];
      assert.ok(Math.abs(f.x - x) < 0.06 && Math.abs(f.z - z) < 0.06 && Math.abs(a.y - y) < 0.06 && Math.abs(a.w - w) < 1e-9, `${a.id} ${f.x} ${f.z} ${a.y} ${a.w}`);
      const p = AD_SCREENS.find((s) => s.id === a.id);
      assert.ok(Math.abs(p.x - f.x) < 0.1 && Math.abs(p.z - f.z) < 0.1 && Math.abs(p.y - a.y) < 0.1 && p.w === a.w, a.id + ' on the /ads page');
    }
    const again = planBowtie(nyc);
    assert.deepEqual(again.ads.map((a) => [a.x, a.z, a.y, a.w]), plan.ads.map((a) => [a.x, a.z, a.y, a.w]));
  });
  it('the search lands exactly on the table the clients use, and nothing else in the plan moves for them', () => {
    const found = planBowtie(nyc, { search: true });
    for (const a of plan.ads) { const t = found.ads.find((q) => q.id === a.id); assert.deepEqual([t.x, t.z, t.yaw, t.y, t.w, t.h, t.frame], [a.x, a.z, a.yaw, a.y, a.w, a.h, a.frame], a.id); }
    for (const s of plan.streets) { const t = found.streets.find((q) => q.id === s.id); assert.deepEqual([t.x, t.z, t.y, t.w], [s.x, s.z, s.y, s.w], s.id); }
  });
  it('16:9, at least 11 m wide, from 4.6 m up and under the roof, within 150 m of the plaza centre, 26 m apart', () => {
    for (const a of plan.ads) {
      const f = faceOf(a);
      assert.ok(Math.abs(a.h - a.w * 9 / 16) < 1e-9 && a.w >= 11 && a.w <= 17, a.id);
      assert.ok(a.y - a.h / 2 >= 4.6 - 1e-9 && a.y + a.h / 2 + a.frame <= a.wall.h - 1 + 1e-9, a.id);
      assert.ok(Math.hypot(f.x - CORE.x, f.z - CORE.z) <= 150, a.id);
      assert.equal(a.kind, 'ad');
      for (const b of plan.ads) if (b !== a) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 26, a.id + ' ' + b.id);
    }
  });
  it('no ad face touches a claimable face, the main stack, a corner board, a blade sign or another ad face', () => {
    const faces = plan.streets.map((s) => ({ id: s.id, r: faceOf(s, s.frame) }));
    for (const c of plan.corners) for (const y of [c.yA, c.yB]) faces.push({ id: 'SUB_' + c.n, r: { x: c.x + c.nx * 0.35, y, z: c.z + c.nz * 0.35, nx: c.nx, nz: c.nz, rx: c.nz, rz: -c.nx, hw: c.w / 2 + 0.2, hh: c.h / 2 + 0.2 } });
    faces.push({ id: 'MAIN', r: plan.main });
    for (const b of plan.blades) faces.push({ id: 'blade', r: b.face });
    for (const a of plan.ads) faces.push({ id: a.id, r: faceOf(a, a.frame) });
    for (const a of faces.filter((f) => AD_IDS.includes(f.id))) for (const b of faces) if (a !== b) assert.ok(faceGap(a.r, b.r) >= 0.3 - 1e-9, `${a.id} - ${b.id} ${faceGap(a.r, b.r)}`);
  });
  it('no face inside a building, 18 m of open street in front at its height, on a street the map leaves open', () => {
    const B = nyc.buildings, inside = [], shallow = [], sealed = [];
    for (const a of plan.ads) {
      const f = faceOf(a);
      for (let i = 0; i <= 10; i++) for (const out of [0.5, 1.2]) {
        const u = -a.w / 2 + (a.w * i) / 10, x = a.wall.mx + a.wall.tx * a.along + a.nx * out + f.rx * u, z = a.wall.mz + a.wall.tz * a.along + a.nz * out + f.rz * u;
        const b = nyc.buildingAt(x, z);
        if (b >= 0 && B.h[b] >= a.y - a.h / 2 && !inside.includes(a.id)) inside.push(a.id);
      }
      if (nyc.rayBlock(f.x + a.nx * 1.5, a.y, f.z + a.nz * 1.5, f.x + a.nx * 19.5, a.y, f.z + a.nz * 19.5) < 1) shallow.push(a.id);
      if (!onStreet(f.x, a.y, f.z, a.nx, a.nz)) sealed.push(a.id);
    }
    assert.deepEqual({ inside, shallow, sealed }, { inside: [], shallow: [], sealed: [] });
  });
});

describe('framed whole in portrait (390 x 844) and landscape', { skip: haveMap ? false : 'assets/nyc/manhattan.bin missing' }, () => {
  before(loadMap);
  const FRAMES = [['portrait', 390 / 844, portraitFov(390 / 844, 55)], ['portrait, phone tier', 390 / 844, portraitFov(390 / 844, 62)], ['landscape', 16 / 9, 55], ['landscape, phone tier', 16 / 9, 62]];
  const flat = (id, x, y, z, nx, nz, w, h) => ({ id, pos: { x, y, z }, normal: { x: nx, y: 0, z: nz }, right: { x: nz, y: 0, z: -nx }, up: { x: 0, y: 1, z: 0 }, w, h });
  const boardFaces = () => {
    const out = plan.streets.map((s) => { const f = faceOf(s); return flat(s.id, f.x, s.y, f.z, s.nx, s.nz, s.w, s.h); });
    for (const c of plan.corners) for (const [k, y] of [['A', c.yA], ['B', c.yB]]) out.push(flat('SUB_' + c.n + k, c.x + c.nx * 0.35, y, c.z + c.nz * 0.35, c.nx, c.nz, c.w, c.h));
    const fh = 24 * 9 / 16;
    ['MAIN_LOW', 'MAIN_BOT', 'MAIN_MID', 'MAIN_TOP', 'MAIN_UP'].forEach((m, i) => out.push(flat(m, LAYOUT.oneTimes.x, 11 + fh / 2 + i * (fh + 0.5), LAYOUT.oneTimes.z - 1.2, 0, -1, 24, fh)));
    return out;
  };
  const adFaces = () => plan.ads.map((a) => { const f = faceOf(a); return flat(a.id, f.x, a.y, f.z, a.nx, a.nz, a.w, a.h); });
  const blockOf = (faces, id) => { const hit = facesBlock(faces.filter((f) => f.id !== id)); return (ax, ay, az, bx, by, bz) => Math.min(nyc.rayBlock(ax, ay, az, bx, by, bz), hit(ax, ay, az, bx, by, bz)); };
  it('each ad screen: straight on, all of the face, nothing in the way, the frame\'s own FOV', () => {
    const all = boardFaces().concat(adFaces());
    for (const a of plan.ads) for (const [name, aspect, vfov] of FRAMES) {
      const f = faceOf(a), v = boardVantage({ face: { x: f.x, y: a.y, z: f.z, nx: a.nx, nz: a.nz, w: a.w, h: a.h }, dist: 18, aspect, vfov, block: blockOf(all, a.id), ground: groundHeight });
      assert.deepEqual([v.yaw, v.fit, v.seen, v.fov], [0, 1, 1, vfov], `${a.id} ${name}`);
    }
  });
  it('no claimable street board\'s camera changes because an ad face now stands in the square', () => {
    const boards = boardFaces(), all = boards.concat(adFaces());
    for (const s of plan.streets) for (const [name, aspect, vfov] of FRAMES) {
      const f = faceOf(s), face = { x: f.x, y: s.y, z: f.z, nx: s.nx, nz: s.nz, w: s.w, h: s.h };
      const before = boardVantage({ face, dist: 18, aspect, vfov, block: blockOf(boards, s.id), ground: groundHeight });
      const after = boardVantage({ face, dist: 18, aspect, vfov, block: blockOf(all, s.id), ground: groundHeight });
      assert.deepEqual(after, before, `${s.id} ${name}`);
    }
  });
  it('segThrough: a segment through an upright face, beside it, short of it or in its plane', () => {
    const r = { x: 0, y: 10, z: 0, nx: 0, nz: 1, rx: 1, rz: 0, hw: 2, hh: 1 };
    assert.equal(segThrough(r, [0, 10, -5, 0, 10, 5]), true);
    assert.equal(segThrough(r, [3, 10, -5, 3, 10, 5]), false);
    assert.equal(segThrough(r, [0, 12, -5, 0, 12, 5]), false);
    assert.equal(segThrough(r, [0, 10, 1, 0, 10, 5]), false);
    assert.equal(segThrough(r, [-5, 10, 0, 5, 10, 0]), false);
  });
});
