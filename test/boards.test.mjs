// STREET_31..50: twenty more claimable street boards in the plaza core (81 in all). The slot table and its one id test
// (balance.js), where the faces go (ts3d/bowtie.js, run here on the real map), the board camera that frames them
// (camrig.js boardVantage), "claimable iff the database has the row", and migrations/2026-11-22-boards.sql, which is run
// for real in PGlite when it is installed (see test/db.test.mjs, first lines).
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { SLOTS, SLOT_IDS, SLOT_RE, isSlotId, STREET_N, floorOf, slotName, slotOpen, soonError, SLOT_SOON, starterList, isLateSlot } from '../balance.js';
import { boardVantage, angledFit, frameDistance, portraitFov, boardRange, shortenFocus, facesBlock } from '../camrig.js';
import { createNYC } from '../ts3d/nyc.js';
import { SKIP_ZONES, LAYOUT, groundHeight } from '../ts3d/layout.js';
import { planBowtie, wallsIn, pickWall, mulberry, faceGap, faceOf, CORE, STREET_OLD, STREET_NEW, MOVED } from '../ts3d/bowtie.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const NEW = Array.from({ length: 20 }, (_, i) => 'STREET_' + (31 + i));
const TWELVE = ['STREET_20', 'STREET_23', 'STREET_28', 'STREET_19', 'STREET_27', 'STREET_16', 'STREET_22', 'STREET_7', 'STREET_11', 'STREET_9', 'STREET_8', 'STREET_10'];
const EIGHT = ['STREET_32', 'STREET_37', 'STREET_31', 'STREET_44', 'STREET_43', 'STREET_36', 'STREET_33', 'STREET_45'];
const OLD_RE = '/^(MAIN_(UP|TOP|MID|BOT|LOW)|SUB_[1-4][AB]|STREET_([1-9]|[12]\\d|30)|PLOT_([1-9]|1[0-8]))$/';

describe('the slot table: 81 boards, STREET_31..50 the cheapest street tier', () => {
  it('lists 5 main, 8 corner, 50 street and 18 lot boards, each id once', () => {
    assert.equal(STREET_N, 50);
    assert.equal(SLOT_IDS.length, 81);
    assert.equal(new Set(SLOT_IDS).size, 81);
    for (let n = 1; n <= 50; n++) assert.ok(SLOT_IDS.includes('STREET_' + n), n);
    assert.equal(SLOTS.filter((s) => s.tier === 'C').length, 68);
  });
  it('floors: 1..30 unchanged (200..400), 31..50 from 150 to 250', () => {
    for (let n = 1; n <= 30; n++) assert.equal(floorOf('STREET_' + n), 200 + Math.round((n - 1) * 200 / 29), n);
    for (let n = 31; n <= 50; n++) assert.equal(floorOf('STREET_' + n), 150 + Math.round((n - 31) * 100 / 19), n);
    assert.deepEqual([floorOf('STREET_31'), floorOf('STREET_40'), floorOf('STREET_50'), floorOf('STREET_30'), floorOf('STREET_51')], [150, 197, 250, 400, 0]);
    for (const id of NEW) { assert.ok(floorOf(id) >= 150 && floorOf(id) <= 250, id); assert.equal(SLOTS.find((s) => s.id === id).tier, 'C'); }
    const street = SLOTS.filter((s) => s.id.startsWith('STREET_')).sort((a, b) => a.bid - b.bid);
    assert.equal(street[0].id, 'STREET_31'); // the cheapest way onto the main street
  });
  it('names the new ones like the others', () => {
    assert.equal(slotName('STREET_31'), '31번 메인거리');
    assert.equal(slotName('STREET_50'), '50번 메인거리');
  });
  it('one id test: SLOT_RE is exactly the slot table', () => {
    for (const id of SLOT_IDS) assert.ok(SLOT_RE.test(id) && isSlotId(id), id);
    for (const bad of ['STREET_0', 'STREET_51', 'STREET_05', 'STREET_031', 'STREET_', 'STREET_60', 'PLOT_19', 'SUB_5A', 'MAIN_S', 'street_31', ' STREET_31', 'STREET_31 ', '', null, 31]) assert.equal(isSlotId(bad), false, String(bad));
    // the copies that used to live in the Worker, the screens, the world, the share helper and the tribe helper are gone
    for (const f of ['worker.js', 'ts3d/screens.js', 'timesSquare3d.js', 'share.js', 'tribe.js']) assert.equal(read(f).includes(OLD_RE), false, f);
    assert.match(read('worker.js'), /^import \{ SLOT_RE, soonError \} from '\.\/balance\.js';/m);
    assert.match(read('ts3d/screens.js'), /const CLAIM = SLOT_RE;/);
    assert.match(read('timesSquare3d.js'), /if \(row\?\.slot_id && isSlotId\(row\.slot_id\)\) updateBillboardTexture/);
    assert.match(read('timesSquare3d.js'), /for \(let i = 1; i <= STREET_N; i\+\+\) AD_IDS\.push\('STREET_' \+ i\);/);
    assert.match(read('ui.js'), /const hotIds = Array\.from\(\{ length: STREET_N \}/);
  });
  it('the free first list takes the eight new faces after the twelve, in order', () => {
    const list = [...TWELVE, ...EIGHT];
    assert.deepEqual(starterList(list), list);
    assert.deepEqual(/ARRAY\[([^\]]+)\]/.exec(read('schema.sql').slice(read('schema.sql').indexOf('FUNCTION public.starter_slots()')))[1].match(/STREET_\d+/g), list);
    for (const id of EIGHT) assert.ok(NEW.includes(id), id);
  });
});

describe('claimable iff the database has the row', () => {
  const rows = SLOT_IDS.filter((id) => !NEW.includes(id)).map((slot_id) => ({ slot_id, holder_id: null })); // production before the migration
  it('a board without a row is on the map but not open; with its row it is', () => {
    assert.equal(slotOpen(rows, 'STREET_40'), false);
    assert.equal(slotOpen(rows, 'STREET_30'), true);
    assert.equal(slotOpen([...rows, { slot_id: 'STREET_40' }], 'STREET_40'), true);
    assert.equal(slotOpen([], 'STREET_40'), true); // the world has not loaded: nothing is closed for that
    assert.equal(slotOpen(undefined, 'STREET_40'), true);
    assert.equal(slotOpen(rows, 'STREET_51'), false);
  });
  it('the old database refusals for a missing row read as "곧 열려요"; any other refusal passes', () => {
    assert.equal(soonError('STREET_40', '그 전광판은 점령할 수 없습니다.'), SLOT_SOON);
    assert.equal(soonError('STREET_40', '존재하지 않는 전광판 슬롯입니다.'), SLOT_SOON);
    assert.equal(soonError('STREET_40', '최소 197 코인 이상 입찰해야 합니다.'), null);
    assert.equal(soonError('STREET_99', '그 전광판은 점령할 수 없습니다.'), null);
    assert.match(SLOT_SOON, /곧 열려요/);
  });
  it('the client never sends such a claim, and the board sheet says so instead of offering it', () => {
    const m = read('main.js'), u = read('ui.js');
    assert.match(m, /async function claim\(payload\) \{\n  \/\/ [^\n]*\n  if \(payload\?\.slot_id && !slotOpen\(state\.billboards, payload\.slot_id\)\) throw new Error\(SLOT_SOON\);/);
    const bid = u.slice(u.indexOf('const refreshBid = () => {'), u.indexOf('const fillStats = () => {'));
    assert.match(bid, /if \(!slotOpen\(world\.billboards, slot\)\) \{\n\s+go\.disabled = true;\n\s+tribeGo\.disabled = true;\n\s+setIconText\(go, '', '곧 열려요'\);/);
    assert.match(u, /const placeBoard = async \(mode\) => \{\n\s+if \(placing\) return;\n\s+hush\(\);\n\s+if \(!slotOpen\(world\.billboards, slot\)\) \{ say\(goErr, SLOT_SOON\); return; \}/);
    assert.match(u, /badgeEl\.textContent = !slotOpen\(world\.billboards, slot\) \? '곧 열림'/);
    assert.match(u, /!slotOpen\(world\.billboards, near\.id\) \? \['곧 열리는 전광판', slotName\(near\.id\), '보기'\]/);
    // the zone lists and the 꿀자리 tips leave them out until they open
    assert.match(u, /: mineIds\)\.filter\(\(id\) => slotOpen\(world\.billboards, id\)\);/);
    assert.match(u, /for \(const id of \[\.\.\.towerIds, \.\.\.hotIds, \.\.\.cheapIds\]\) \{\n\s+if \(!slotOpen\(world\.billboards, id\)\) continue;/);
  });
  it('the screen itself says so until the row arrives: "곧 열려요" chip, "곧 열리는 자리" line, the real floor price', () => {
    for (const id of NEW) assert.equal(isLateSlot(id), true, id);
    for (const id of SLOT_IDS.filter((x) => !NEW.includes(x))) assert.equal(isLateSlot(id), false, id);
    const sc = read('ts3d/screens.js'), art = read('ts3d/art.js');
    assert.match(sc, /line2: soon \? '곧 열리는 자리' : '거리 쪽 큰 화면'/);
    assert.match(sc, /data: defaultData\(slotId, isLateSlot\(slotId\)\), real: false,/);
    assert.match(sc, /if \(row && \('holder_id' in row \|\| 'current_bid' in row\)\) b\.real = true;/);
    assert.match(art, /\? \(data\.soon \? '곧 열려요' : auctionClosed/);
  });
  it('the Worker maps the refusal for claims and reads /rt/world rows for the 81 ids', () => {
    const w = read('worker.js');
    assert.match(w, /\(claim && soonError\(String\(b\.slot_id \|\| ''\), data\.error\)\) \|\| playerErr\(/);
    assert.match(w, /billboards\?select=\*&slot_id=in\.\(' \+ SLOT_IDS\.join\(','\) \+ '\)/);
  });
});

// ---- the map ------------------------------------------------------------------------------------------------------
const MAP = new URL('../assets/nyc/manhattan.bin', import.meta.url);
const haveMap = existsSync(MAP);
let nyc = null, plan = null;
function loadMap() {
  if (nyc) return;
  nyc = createNYC(new Uint8Array(gunzipSync(readFileSync(MAP))));
  const B = nyc.buildings;
  for (let i = 0; i < B.count; i++) for (const z of SKIP_ZONES) if (B.cx[i] >= z.x0 && B.cx[i] <= z.x1 && B.cz[i] >= z.z0 && B.cz[i] <= z.z1) { nyc.skipBuilding[i] = 1; break; } // as world.js does
  plan = planBowtie(nyc);
  nyc.ensureSolid(16, 90, 400);
}
// The placement as timesq.js shipped it until 2026-11-22, kept here so STREET_1..30 and the corners provably stay put.
function shipped(nyc) {
  const segPointDist = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz; const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0; return [Math.hypot(px - ax - dx * t, pz - az - dz * t), ax + dx * t, az + dz * t]; };
  const AXES = [[-1, -250, -1, 262], [-63.4, -233, 49, 249.7]];
  const facing = wallsIn(nyc, -110, 120, -250, 262, 9).filter((w) => {
    let best = Infinity, qx = 0, qz = 0;
    for (const [ax, az, bx, bz] of AXES) { const [d, x, z] = segPointDist(w.mx, w.mz, ax, az, bx, bz); if (d < best) { best = d; qx = x; qz = z; } }
    if (best > 95 || best < 4) return false;
    w.dist = best;
    return w.nx * (qx - w.mx) / best + w.nz * (qz - w.mz) / best > (best > 60 ? 0.62 : 0.5);
  });
  const used = new Set(), corners = [];
  for (const [n, ax, az, nx, nz] of [['1', -42, -40, 1, 0], ['2', 14, -112, -1, 0], ['3', -14, 124, 1, 0], ['4', 40, 58, -1, 0]]) {
    const w = pickWall(facing, ax, az, nx, nz, 13, 26) || pickWall(facing, ax, az, nx, nz, 9, 16);
    used.add(w);
    const bw = w ? Math.min(16, Math.max(11, w.len - 1.4)) : 14;
    corners.push({ n, x: w.mx + w.nx * 0.8, z: w.mz + w.nz * 0.8, yaw: Math.atan2(w.nx, w.nz), w: bw, yB: 26 - bw * 9 / 16 - 0.7 });
  }
  const pool = facing.filter((w) => !used.has(w) && w.len >= 12 && w.h >= 12 && w.dist < 85 && Math.hypot(w.mx - LAYOUT.oneTimes.x, w.mz - LAYOUT.oneTimes.z) > 28).sort((a, b) => a.dist - b.dist);
  const sw = [];
  for (const w of pool) { if (sw.length >= 30) break; if (sw.some((p) => Math.hypot(p.mx - w.mx, p.mz - w.mz) < 16)) continue; sw.push(w); }
  for (const w of pool) { if (sw.length >= 30) break; if (!sw.includes(w)) sw.push(w); }
  const streets = sw.map((w) => { const bw = Math.min(22, Math.max(14, w.len * 0.78)), bh = bw * 9 / 16; return { x: w.mx + w.nx * 0.7, z: w.mz + w.nz * 0.7, yaw: Math.atan2(w.nx, w.nz), y: Math.min(w.h - bh / 2 - 1.2, Math.max(bh / 2 + 6, 12)), w: bw }; });
  const r = mulberry(4242), blades = [];
  for (const w of facing) if (w.len > 14 && w.h > 18 && w.dist <= 60 && r() < 0.35) { const along = (r() < 0.5 ? -1 : 1) * (w.len / 2 - 2.2); blades.push({ name: (r() * 5) | 0, x: w.mx + w.tx * along + w.nx * 1.55, z: w.mz + w.tz * along + w.nz * 1.55 }); }
  return { corners, streets, blades };
}
// Where the twenty went (face centre x, z, centre height, width, kind): pinned, so a later change to the plan cannot move a held board.
const PLACED = {
  STREET_31: [28.5, 71.2, 7.5, 10.4, 'eye'], STREET_32: [23.4, 57, 7.4, 10, 'eye'], STREET_33: [-16, 65.6, 7.7, 10.9, 'eye'],
  STREET_34: [42.1, 127.1, 26, 22, 'stack'], STREET_35: [-45.1, 102.8, 7.8, 11.5, 'eye'], STREET_36: [-16.2, 30.3, 7.7, 10.9, 'eye'],
  STREET_37: [17.3, 21.5, 8.3, 13, 'eye'], STREET_38: [-23.7, 19.8, 7.4, 10.1, 'eye'], STREET_39: [78.5, 150.7, 7, 8.5, 'eye'],
  STREET_40: [-15.8, 184.4, 21.3, 14, 'stack'], STREET_41: [13.2, -11.6, 8.3, 13, 'eye'], STREET_42: [-25.6, -12.2, 21.3, 14, 'stack'],
  STREET_43: [28.5, 71.2, 14.4, 10.4, 'eye'], STREET_44: [23.4, 57, 14.1, 10, 'eye'], STREET_45: [-16, 65.6, 14.9, 10.9, 'eye'],
  STREET_46: [42.1, 127.1, 39.7, 22, 'stack'], STREET_47: [-45.1, 102.8, 15.4, 11.5, 'eye'], STREET_48: [-15.8, 184.4, 30.6, 14, 'stack'],
  STREET_49: [42.1, 127.1, 53.5, 22, 'stack'], STREET_50: [-15.8, 184.4, 39.8, 14, 'stack'],
};
// STREET_1..30 faces that the map put inside a neighbouring building (overlapping OpenStreetMap outlines), so no camera
// could see them whole. Nobody held them, so before launch they moved (bowtie.js MOVED) to the Marriott's east wall,
// facing the square across Duffy Square. Where they went (face centre x, z, centre height, width), pinned like PLACED:
const MOVED_IDS = MOVED.map((n) => 'STREET_' + n);
const MOVED_TO = {
  STREET_18: [-15.8, 140.65, 12, 14], STREET_21: [-15.8, 122.65, 38.34, 22], STREET_22: [-15.8, 104.65, 9.94, 19], STREET_24: [-15.8, 144.65, 34.12, 19],
  STREET_25: [-15.8, 102.65, 37.35, 14.5], STREET_27: [-15.8, 102.65, 27.09, 14], STREET_28: [-15.8, 121.65, 7.69, 11], STREET_29: [-15.8, 139.65, 22.87, 11],
};
// Boards kept where they are (not part of that move) that still fall short on the map, each for the reason given:
//  STREET_23, 35, 47: in the Marriott's atrium, which the map closes all round under its 59 m east shell (x -18.2..-16.7);
//    the camera frames them from inside it, but nobody on the street sees them. STREET_23 also has only 12 m in front of
//    it at its height (the shell), so the camera turns 60 degrees for it in portrait.
//  STREET_26, 30 (W 42nd St): in a pocket the map closes, one end of the face 0.5 m inside the next outline. STREET_26
//    has 17.8 m in front of it, not 18, and in portrait comes out short of the margin (fit 0.93, the lens opened 12°).
const SEALED = ['STREET_23', 'STREET_26', 'STREET_30', 'STREET_35', 'STREET_47'];
const OVERLAP = ['STREET_26', 'STREET_30'];
const SHALLOW = ['STREET_23', 'STREET_26'];
const SHORT = { STREET_26: ['portrait', 'portrait, phone tier'] };

describe('where the twenty go (ts3d/bowtie.js on the real map)', { skip: haveMap ? false : 'assets/nyc/manhattan.bin missing' }, () => {
  before(loadMap);
  it('STREET_1..30 and the corner towers are exactly where they shipped, but for the eight moved; blades only lose the ones through a board', () => {
    const old = shipped(nyc);
    for (let i = 0; i < 30; i++) {
      const a = plan.streets[i], b = old.streets[i];
      assert.equal(a.id, 'STREET_' + (i + 1));
      if (MOVED_IDS.includes(a.id)) { assert.deepEqual(a.moved, { x: b.x, z: b.z, y: b.y, w: b.w }, a.id); continue; }
      assert.equal(a.moved, undefined, a.id);
      for (const k of ['x', 'z', 'yaw', 'y', 'w']) assert.equal(a[k], b[k], a.id + ' ' + k);
    }
    for (let i = 0; i < 4; i++) for (const k of ['x', 'z', 'yaw', 'w', 'yB']) assert.equal(plan.corners[i][k], old.corners[i][k], 'SUB_' + (i + 1) + ' ' + k);
    // every blade left is one that shipped, same name, same spot; the ones dropped stood through a claimable face
    let j = 0;
    for (const b of plan.blades) { while (j < old.blades.length && (old.blades[j].x !== b.x || old.blades[j].z !== b.z)) j++; assert.ok(j < old.blades.length, 'blade ' + b.x); assert.equal(old.blades[j].name, b.name); j++; }
    assert.equal(old.blades.length - plan.blades.length, 6);
  });
  it('the twenty are where they were placed, the same on every run', () => {
    assert.equal(plan.streets.length, STREET_OLD + STREET_NEW);
    const again = planBowtie(nyc);
    for (const s of plan.streets.slice(30)) {
      const [x, z, y, w, kind] = PLACED[s.id];
      const f = faceOf(s);
      assert.ok(Math.abs(f.x - x) < 0.06 && Math.abs(f.z - z) < 0.06 && Math.abs(s.y - y) < 0.06 && Math.abs(s.w - w) < 0.06 && s.kind === kind, `${s.id} ${f.x} ${f.z} ${s.y} ${s.w} ${s.kind}`);
      const t = again.streets.find((q) => q.id === s.id);
      assert.deepEqual([t.x, t.z, t.y, t.w], [s.x, s.z, s.y, s.w]);
    }
    assert.equal(plan.streets.slice(30).filter((s) => s.kind === 'eye').length, 13);
    assert.equal(plan.streets.slice(30).filter((s) => s.kind === 'stack').length, 7);
  });
  it('the eight moved ones are where they were placed: the search lands exactly on the table the clients use', () => {
    assert.deepEqual([...MOVED].sort((a, b) => a - b), [18, 21, 22, 24, 25, 27, 28, 29]);
    const found = planBowtie(nyc, { search: true });
    for (const id of MOVED_IDS) {
      const s = plan.streets.find((q) => q.id === id), f = faceOf(s), [x, z, y, w] = MOVED_TO[id];
      assert.ok(Math.abs(f.x - x) < 0.06 && Math.abs(f.z - z) < 0.06 && Math.abs(s.y - y) < 0.06 && Math.abs(s.w - w) < 1e-9, `${id} ${f.x} ${f.z} ${s.y} ${s.w}`);
      const t = found.streets.find((q) => q.id === id);
      assert.deepEqual([t.x, t.z, t.yaw, t.y, t.w, t.h], [s.x, s.z, s.yaw, s.y, s.w, s.h], id);
      assert.ok(Math.abs(s.h - s.w * 9 / 16) < 1e-9 && s.w >= 10 && s.w <= s.moved.w, id);
      assert.ok(Math.hypot(f.x - CORE.x, f.z - CORE.z) <= CORE.r && f.z >= CORE.z0 && f.z <= CORE.z1, id + ' in the core');
      assert.ok(s.y - s.h / 2 >= 4.6 - 1e-9 && s.y + s.h / 2 + s.frame <= s.wall.h - 1 + 1e-9, id + ' under the roof');
      assert.ok(s.nx > 0.99, id + ' faces east, onto the square');
    }
    // everything else in the plan is the same whichever way the eight were found
    for (const s of plan.streets) if (!MOVED_IDS.includes(s.id)) { const t = found.streets.find((q) => q.id === s.id); assert.deepEqual([t.x, t.z, t.y, t.w], [s.x, s.z, s.y, s.w], s.id); }
  });
  it('the old spots of the eight were inside a neighbouring building', () => {
    const old = shipped(nyc);
    // across the face, 1.2 m and 2 m off its wall (the face is at 0.9 m), inside a building standing above its bottom edge
    const clippedAt = (b) => {
      const nx = Math.sin(b.yaw), nz = Math.cos(b.yaw), h = b.w * 9 / 16;
      for (let i = 0; i <= 10; i++) for (const out of [1.2, 2]) {
        const u = -b.w / 2 + (b.w * i) / 10, k = nyc.buildingAt(b.x + nx * (out - 0.7) + nz * u, b.z + nz * (out - 0.7) - nx * u);
        if (k >= 0 && nyc.buildings.h[k] > b.y - h / 2) return true;
      }
      return false;
    };
    for (const id of MOVED_IDS) assert.ok(clippedAt(old.streets[Number(id.slice(7)) - 1]), id);
  });
  it('the two free first ones that moved (22, 27) are nearer the bakery walk than before', () => {
    const A = LAYOUT.spawn, S = LAYOUT.stall;
    const walk = (x, z) => { const dx = S.x - A.x, dz = S.z - A.z, t = Math.max(0, Math.min(1, ((x - A.x) * dx + (z - A.z) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - A.x - dx * t, z - A.z - dz * t); };
    for (const id of ['STREET_22', 'STREET_27']) {
      assert.ok(TWELVE.includes(id), id);
      const s = plan.streets.find((q) => q.id === id), f = faceOf(s);
      assert.ok(walk(f.x, f.z) < walk(s.moved.x, s.moved.z) && walk(f.x, f.z) < 40, `${id} ${walk(f.x, f.z)} vs ${walk(s.moved.x, s.moved.z)}`);
    }
  });
  it('all in the core, facing the square, 16:9, the eye-level ones from 4.6 m up', () => {
    for (const s of plan.streets.slice(30)) {
      const f = faceOf(s);
      assert.ok(Math.hypot(f.x - CORE.x, f.z - CORE.z) <= CORE.r + 1 && f.z >= CORE.z0 && f.z <= CORE.z1, s.id);
      assert.ok(Math.abs(s.h - s.w * 9 / 16) < 1e-9, s.id);
      if (s.kind === 'eye' && s.y < 10) assert.ok(Math.abs(s.y - s.h / 2 - 4.6) < 1e-9, s.id);
      assert.ok(s.w >= 7.5 && s.y - s.h / 2 >= 4.5, s.id);
      assert.ok(s.y + s.h / 2 + s.frame <= s.wall.h - 1 + 1e-9, s.id + ' under the roof');
    }
  });
  it('no new or moved face touches another face, the main stack, a corner board or a blade sign', () => {
    const faces = plan.streets.map((s) => ({ id: s.id, r: faceOf(s, s.frame) }));
    for (const c of plan.corners) for (const y of [c.yA, c.yB]) faces.push({ id: 'SUB_' + c.n, r: { x: c.x + c.nx * 0.35, y, z: c.z + c.nz * 0.35, nx: c.nx, nz: c.nz, rx: c.nz, rz: -c.nx, hw: c.w / 2 + 0.16, hh: c.h / 2 + 0.16 } });
    faces.push({ id: 'MAIN', r: plan.main });
    for (const b of plan.blades) faces.push({ id: 'blade', r: b.face });
    for (const a of faces.filter((f) => NEW.includes(f.id) || MOVED_IDS.includes(f.id))) for (const b of faces) if (a !== b) assert.ok(faceGap(a.r, b.r) >= 0.3 - 1e-9, `${a.id} - ${b.id} ${faceGap(a.r, b.r)}`);
    // and no two street faces touch at all
    const st = faces.filter((f) => /^STREET_/.test(f.id));
    for (const a of st) for (const b of st) if (a !== b) assert.ok(faceGap(a.r, b.r) > 0, `${a.id} - ${b.id}`);
    // and the six blades that would have stood through STREET_1..30 or a corner board are gone
    for (const b of plan.blades) for (const s of plan.streets.slice(0, 30)) assert.ok(faceGap(b.face, faceOf(s, s.frame)) > 0, s.id);
  });
  it('all 50: no face inside a building, 18 m of open street in front at its height, on a street the map leaves open (but for the ones named above)', () => {
    const B = nyc.buildings, inside = [], shallow = [], sealed = [];
    nyc.ensureSolid(16, 0, 400);
    for (const s of plan.streets) {
      const f = faceOf(s);
      let hit = false;
      for (let i = 0; i <= 10; i++) for (const out of [0.5, 1.2]) {
        const u = -s.w / 2 + (s.w * i) / 10, x = s.wall.mx + s.wall.tx * s.along + s.nx * out + f.rx * u, z = s.wall.mz + s.wall.tz * s.along + s.nz * out + f.rz * u;
        const b = nyc.buildingAt(x, z);
        if (b >= 0 && B.h[b] >= s.y - s.h / 2) hit = true;
      }
      if (hit) inside.push(s.id);
      if (nyc.rayBlock(f.x + s.nx * 1.5, s.y, f.z + s.nz * 1.5, f.x + s.nx * 19.5, s.y, f.z + s.nz * 19.5) < 1) shallow.push(s.id);
      // from 3 m in front, at the face's height, two neighbouring lines (5 degrees apart, so not a crack between two
      // outlines) within 85 degrees of straight out run 60 m clear
      const ax = f.x + s.nx * 3, az = f.z + s.nz * 3;
      const clear = (deg) => { const a = (deg * Math.PI) / 180, dx = s.nx * Math.cos(a) - s.nz * Math.sin(a), dz = s.nx * Math.sin(a) + s.nz * Math.cos(a); return nyc.rayBlock(ax, s.y, az, ax + dx * 60, s.y, az + dz * 60) === 1; };
      let open = false;
      for (let deg = -85; deg < 85 && !open; deg += 5) open = clear(deg) && clear(deg + 5);
      if (!open) sealed.push(s.id);
    }
    assert.deepEqual(inside, OVERLAP);
    assert.deepEqual(shallow, SHALLOW);
    assert.deepEqual(sealed, SEALED);
    for (const id of MOVED_IDS) assert.ok(![...SEALED, ...OVERLAP, ...SHALLOW].includes(id), id);
  });
  it('the eight free first ones are the new eye-level faces nearest the bakery walk (spawn to the stall)', () => {
    const A = LAYOUT.spawn, S = LAYOUT.stall;
    const walk = (s) => { const f = faceOf(s), dx = S.x - A.x, dz = S.z - A.z, t = Math.max(0, Math.min(1, ((f.x - A.x) * dx + (f.z - A.z) * dz) / (dx * dx + dz * dz))); return Math.hypot(Math.hypot(f.x - A.x - dx * t, f.z - A.z - dz * t), s.y - 1.6); };
    const eye = plan.streets.slice(30).filter((s) => s.kind === 'eye').sort((a, b) => walk(a) - walk(b)).map((s) => s.id);
    assert.deepEqual(eye.slice(0, 8), EIGHT);
  });
});

describe('the board camera (camrig.js boardVantage)', () => {
  it('angledFit at 0° is frameDistance, and turning shrinks the width a portrait frame needs', () => {
    for (const [w, h, aspect, vfov] of [[22, 12.375, 390 / 844, 72], [14, 7.875, 16 / 9, 55], [24, 13.5, 1, 62]]) {
      assert.ok(Math.abs(angledFit({ w, h, aspect, vfov }) - frameDistance({ w, h, aspect, vfov })) < 1e-9);
    }
    const p = (yaw) => angledFit({ w: 22, h: 12.375, aspect: 390 / 844, vfov: 72, yaw });
    assert.ok(p(Math.PI / 4) < p(0) && p(Math.PI / 3) < p(Math.PI / 4));
  });
  it('a clear straight shot is the pose the camera always took: same spot, same FOV', () => {
    const face = { x: 0, y: 12, z: 0, nx: 0, nz: 1, w: 14, h: 7.875 };
    const v = boardVantage({ face, dist: 18, aspect: 16 / 9, vfov: 55 });
    const d = boardRange(18, frameDistance({ w: 14, h: 7.875, aspect: 16 / 9, vfov: 55 }));
    assert.deepEqual([v.x, v.y, v.yaw, v.fov, v.fit, v.seen], [0, Math.max(12 * 0.42 + 1.8, 1.6), 0, 55, 1, 1]);
    assert.ok(Math.abs(v.z - d) < 1e-9 && Math.abs(v.dist - d) < 1e-9);
    assert.equal(boardVantage({ face, dist: 8, aspect: 1, vfov: 55, level: true }).y, 12);
  });
  it('a building across a narrow street: the camera turns along the street and opens the lens instead of cutting the face', () => {
    // a wall 10 m in front of the face, parallel to it, as tall as anything
    const wall = (ax, ay, az, bx, by, bz) => { if ((az - 10) * (bz - 10) >= 0) return 1; return (10 - az) / (bz - az); };
    const face = { x: 0, y: 12, z: 0, nx: 0, nz: 1, w: 22, h: 12.375 };
    const straight = shortenFocus(42, wall(0, 12, 2.5, 0, 7, 42), { start: 2.5 }) / frameDistance({ w: 22, h: 12.375, aspect: 390 / 844, vfov: 72 });
    const v = boardVantage({ face, dist: 18, aspect: 390 / 844, vfov: 72, block: wall });
    assert.ok(straight < 0.3, String(straight));
    assert.notEqual(v.yaw, 0);
    assert.ok(v.fit > straight * 2, `${v.fit} vs ${straight}`);
    assert.ok(v.fov >= 72 && v.fov <= 84);
    assert.equal(v.seen, 1);
  });
  it('facesBlock: a segment through another board stops at it; beside it, past its edge or parallel to it, it does not', () => {
    const f = { pos: { x: 0, y: 10, z: 5 }, normal: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, w: 4, h: 2 };
    const hit = facesBlock([f, null]);
    assert.ok(Math.abs(hit(0, 10, 0, 0, 10, 10) - 0.5) < 1e-9);
    assert.equal(hit(3, 10, 0, 3, 10, 10), 1); // past the side edge
    assert.equal(hit(0, 12, 0, 0, 12, 10), 1); // above the top edge
    assert.equal(hit(0, 10, 0, 0, 10, 4), 1); // stops short of it
    assert.equal(hit(-5, 10, 5, 5, 10, 5), 1); // in its plane
    assert.equal(facesBlock()(0, 0, 0, 1, 1, 1), 1);
  });
  it('the world asks it for every scripted board camera, and holds its FOV while the camera is out', () => {
    const w = read('timesSquare3d.js');
    const pose = w.slice(w.indexOf('function slotPose('), w.indexOf('const AD_IDS'));
    assert.match(pose, /const v = boardVantage\(\{ face: \{ x: p\.x, y: p\.y, z: p\.z, nx: f\.x, nz: f\.z, w: face\.w, h: face\.h \}, dist, aspect: camera\.aspect, vfov, block, ground: groundHeight, level \}\);/);
    assert.match(pose, /const block = \(ax, ay, az, bx, by, bz\) => Math\.min\(nyc\.rayBlock\(ax, ay, az, bx, by, bz\), hitFace\(ax, ay, az, bx, by, bz\)\);/);
    assert.match(pose, /for \(const b of boards\.boards\.values\(\)\) \{\n\s+if \(b\.slotId === slotId \|\| !b\.mounts\.length\) continue;/);
    assert.match(w, /cine = \{ t0: performance\.now\(\), dur: o\.dur \|\| 700, back: false, until: o\.until \|\| 0, pin: !!o\.pin, fov: o\.fov \|\| 0 \};/);
    assert.match(w, /const fovGoal = \(cine && !cine\.back && cine\.fov\) \|\| portraitFov\(camera\.aspect, baseFov\)/);
    assert.match(w, /startCine\(pose\.cam, pose\.look, \{ dur: 700, until: o\.hold \? performance\.now\(\) \+ o\.hold : 0, fov: pose\.fov \}\);/);
  });
});

describe('every street board framed in portrait (390 x 844) and landscape', { skip: haveMap ? false : 'assets/nyc/manhattan.bin missing' }, () => {
  before(loadMap);
  const FRAMES = [['portrait', 390 / 844, portraitFov(390 / 844, 55)], ['portrait, phone tier', 390 / 844, portraitFov(390 / 844, 62)], ['landscape', 16 / 9, 55], ['landscape, phone tier', 16 / 9, 62]];
  const faceAt = (s) => { const f = faceOf(s); return { x: f.x, y: s.y, z: f.z, nx: s.nx, nz: s.nz, w: s.w, h: s.h }; };
  // Every board face as screens.js face() reports it, so the camera also counts a neighbour's board as in the way (as slotPose does).
  const flat = (id, x, y, z, nx, nz, w, h) => ({ id, pos: { x, y, z }, normal: { x: nx, y: 0, z: nz }, right: { x: nz, y: 0, z: -nx }, up: { x: 0, y: 1, z: 0 }, w, h });
  let faces = null;
  const blockFor = (id) => {
    if (!faces) {
      faces = plan.streets.map((s) => { const f = faceOf(s); return flat(s.id, f.x, s.y, f.z, s.nx, s.nz, s.w, s.h); });
      for (const c of plan.corners) for (const [k, y] of [['A', c.yA], ['B', c.yB]]) faces.push(flat('SUB_' + c.n + k, c.x + c.nx * 0.35, y, c.z + c.nz * 0.35, c.nx, c.nz, c.w, c.h));
      const fh = 24 * 9 / 16;
      ['MAIN_LOW', 'MAIN_BOT', 'MAIN_MID', 'MAIN_TOP', 'MAIN_UP'].forEach((m, i) => faces.push(flat(m, LAYOUT.oneTimes.x, 11 + fh / 2 + i * (fh + 0.5), LAYOUT.oneTimes.z - 1.2, 0, -1, 24, fh)));
    }
    const hit = facesBlock(faces.filter((f) => f.id !== id));
    return (ax, ay, az, bx, by, bz) => Math.min(nyc.rayBlock(ax, ay, az, bx, by, bz), hit(ax, ay, az, bx, by, bz));
  };
  it('the twenty new ones and the eight moved: straight on, all of the face, nothing in the way, the frame\'s own FOV', () => {
    for (const s of plan.streets.filter((q) => q.n > 30 || MOVED_IDS.includes(q.id))) for (const [name, aspect, vfov] of FRAMES) {
      const v = boardVantage({ face: faceAt(s), dist: 18, aspect, vfov, block: blockFor(s.id), ground: groundHeight });
      assert.deepEqual([v.yaw, v.fit, v.seen, v.fov], [0, 1, 1, vfov], `${s.id} ${name}`);
    }
  });
  it('STREET_1..30: never worse than the straight-back camera; all of the face seen and in the frame, but for STREET_26 in portrait', () => {
    for (const s of plan.streets.slice(0, 30)) for (const [name, aspect, vfov] of FRAMES) {
      const f = faceAt(s), v = boardVantage({ face: f, dist: 18, aspect, vfov, block: blockFor(s.id), ground: groundHeight });
      const need = frameDistance({ w: f.w, h: f.h, aspect, vfov }), d = boardRange(18, need);
      const cy = Math.max(f.y * 0.42 + 1.8, groundHeight(f.x + f.nx * d, f.z + f.nz * d) + 1.6);
      const old = Math.min(1, shortenFocus(d, nyc.rayBlock(f.x + f.nx * 2.5, f.y + (cy - f.y) * (2.5 / d), f.z + f.nz * 2.5, f.x + f.nx * d, cy, f.z + f.nz * d)) / need);
      const tag = `${s.id} ${name}: fit ${v.fit.toFixed(2)} (was ${old.toFixed(2)}) seen ${v.seen.toFixed(2)} yaw ${(v.yaw * 180 / Math.PI).toFixed(0)} fov ${v.fov}`;
      assert.ok(v.fov <= vfov + 12, tag);
      assert.ok(v.fit >= old - 1e-9 || v.seen > 0.99, tag);
      assert.equal(v.seen, 1, tag);
      if (SHORT[s.id]?.includes(name)) { assert.ok(v.fit >= 0.84 && v.fit < 1, tag); continue; }
      assert.equal(v.fit, 1, tag);
    }
  });
  it('the portrait boards the old straight-back camera cut (STREET_1, 2, 4, 8, 14, 17, 23 …) now fit', () => {
    const [, aspect, vfov] = FRAMES[0];
    let fixed = 0;
    for (const s of plan.streets.slice(0, 30)) {
      const f = faceAt(s), need = frameDistance({ w: f.w, h: f.h, aspect, vfov }), d = boardRange(18, need);
      const cy = Math.max(f.y * 0.42 + 1.8, groundHeight(f.x + f.nx * d, f.z + f.nz * d) + 1.6);
      const old = shortenFocus(d, nyc.rayBlock(f.x + f.nx * 2.5, f.y + (cy - f.y) * (2.5 / d), f.z + f.nz * 2.5, f.x + f.nx * d, cy, f.z + f.nz * d)) / need;
      if (old < 0.84) { fixed++; assert.ok(boardVantage({ face: f, dist: 18, aspect, vfov, block: blockFor(s.id), ground: groundHeight }).fit >= 0.84, s.id); }
    }
    assert.ok(fixed >= 8, String(fixed));
  });
});

describe('migrations/2026-11-22-boards.sql', () => {
  const mig = read('migrations/2026-11-22-boards.sql'), schema = read('schema.sql');
  const fnBlock = (sql, name) => { const at = sql.lastIndexOf('CREATE OR REPLACE FUNCTION public.' + name + '('); if (at < 0) return null; return sql.slice(at, sql.indexOf('\n$$', sql.indexOf('AS $$', at)) + 3); };
  const topLevel = (sql) => sql.replace(/AS \$\$[\s\S]*?\n\$\$;/g, '').replace(/DO (\$\w*\$)[\s\S]*?\1;/g, '').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  it('two BEGIN … COMMIT parts, nothing destructive at top level, one status row at the end', () => {
    const top = topLevel(mig).replace('CREATE TEMP TABLE IF NOT EXISTS kts_boards (part INT PRIMARY KEY, why TEXT);', '');
    assert.equal((top.match(/^BEGIN;$/gm) || []).length, 2);
    assert.equal((top.match(/^COMMIT;$/gm) || []).length, 2);
    assert.doesNotMatch(top, /\b(DROP|DELETE|TRUNCATE|ALTER|UPDATE|INSERT|CREATE)\b/i);
    assert.ok(mig.lastIndexOf('COMMIT;') < mig.lastIndexOf("SELECT '메인거리 전광판 20칸 더' AS part"));
    assert.match(mig.trim().split('\n').at(-1), /^LEFT JOIN kts_boards m2 ON m2\.part = 2;$/);
    assert.match(mig, /ON CONFLICT \(slot_id\) DO NOTHING/);
  });
  it('restates slot_floor, starter_slots and starter_slot_list exactly as schema.sql has them; never claim_billboard whole', () => {
    for (const name of ['slot_floor', 'starter_slots', 'starter_slot_list']) assert.equal(fnBlock(mig, name), fnBlock(schema, name), name);
    assert.equal(mig.includes('CREATE OR REPLACE FUNCTION public.claim_billboard'), false);
    // the only place in the database that knew the street range
    assert.match(fnBlock(schema, 'slot_floor'), /WHEN p_slot ~ '\^STREET_\(3\[1-9\]\|4\[0-9\]\|50\)\$'\n\s+THEN \(150 \+ round\(\(substring\(p_slot from 8\)::int - 31\) \* 100\.0 \/ 19\)\)::bigint/);
    assert.match(schema, /FROM generate_series\(31, 50\) AS g\nON CONFLICT \(slot_id\) DO NOTHING;/);
  });
  it('the 2026-11-21 migration, run later, keeps a longer list', () => {
    assert.match(read('migrations/2026-11-21-mid.sql'), /IF to_regprocedure\('public\.starter_slots\(\)'\) IS NULL THEN\n\s+EXECUTE \$f\$\nCREATE OR REPLACE FUNCTION public\.starter_slots\(\)/);
  });
});

// ---- the migration, run in PGlite --------------------------------------------------------------------------------
async function loadPGlite() {
  for (const d of [process.env.PGLITE_DIR, join(tmpdir(), 'kts-pglite')].filter(Boolean)) {
    try { const req = createRequire(join(d, 'package.json')); return (await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href)).PGlite; } catch { }
  }
  try { return (await import('@electric-sql/pglite')).PGlite; } catch { return null; }
}
const PGlite = await loadPGlite();
const gitShow = (rev) => { try { return execFileSync('git', ['show', rev + ':schema.sql'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n'); } catch { return null; } };
// Production today: the schema before 2026-11-21-mid.sql (df5a739) with only that file's part 2 run; aef1e9f has all of it.
const PRE_MID = gitShow('df5a739'), POST_MID = gitShow('aef1e9f');
const KEY = 'pglite-key';
async function fresh(text) {
  const db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(text);
  await db.query('UPDATE public.app_secrets SET key_value = $1 WHERE key_name = $2', [KEY, 'FLUSH_KEY']);
  return db;
}
const claim = async (db, actor, slot, bid, mode = 'claim') => (await db.query('SELECT public.claim_billboard($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL, 72, $12) AS r',
  [KEY, actor, '새', slot, bid, '첫 칸', '', '', '✨', 'cyber_navy', '#ffffff', mode])).rows[0].r;
const run = async (db) => (await db.exec(read('migrations/2026-11-22-boards.sql'))).at(-1).rows;
const wallet = (db, id, coins) => db.query('INSERT INTO public.wallets (actor_id, nickname, coins) VALUES ($1, $2, $3)', [id, id.slice(-2), coins]);

describe('the boards migration in PGlite', { skip: PGlite && PRE_MID && POST_MID ? false : 'PGlite or the git history is not available', concurrency: false }, () => {
  it('production as it is (no mid part 1): STREET_40 fails cleanly before, works after; free first slots become twenty', async () => {
    const db = await fresh(PRE_MID);
    try {
      await wallet(db, 'guest:aa', 1000);
      const before = await claim(db, 'guest:aa', 'STREET_40', 197);
      assert.deepEqual(before, { ok: false, error: '그 전광판은 점령할 수 없습니다.' });
      assert.equal(soonError('STREET_40', before.error), SLOT_SOON); // what the Worker answers
      assert.equal((await db.query("SELECT count(*)::int n FROM public.wallets WHERE actor_id = 'guest:aa' AND coins = 1000")).rows[0].n, 1); // nothing charged
      const rows = await run(db);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].applied, true, rows[0].note);
      assert.match(rows[0].note, /^적용됨/);
      assert.deepEqual(await claim(db, 'guest:aa', 'STREET_40', 196), { ok: false, error: '최소 197 코인 이상 입찰해야 합니다.' });
      const ok = await claim(db, 'guest:aa', 'STREET_40', 197);
      assert.equal(ok.ok, true, JSON.stringify(ok));
      assert.equal(ok.billboard.holder_id, 'guest:aa');
      assert.equal(ok.remaining_coins, 803);
      const floors = (await db.query("SELECT slot_id, current_bid::int AS bid, public.slot_floor(slot_id)::int AS floor FROM public.billboards WHERE slot_id ~ '^STREET_' ORDER BY slot_id")).rows;
      assert.equal(floors.length, 50);
      for (const r of floors) assert.equal(r.floor, floorOf(r.slot_id), r.slot_id);
      // a free first claim on a new one, and on an old one
      assert.equal((await claim(db, 'guest:bb', 'STREET_32', 0, 'starter')).ok, true);
      assert.equal((await claim(db, 'guest:cc', 'STREET_20', 0, 'starter')).ok, true);
      assert.deepEqual(await claim(db, 'guest:dd', 'STREET_41', 0, 'starter'), { ok: false, error: 'starter' }); // not in the list
      assert.deepEqual((await db.query('SELECT public.starter_slot_list($1) AS r', [KEY])).rows[0].r, { ok: true, slots: [...TWELVE, ...EIGHT] });
      // again: nothing moves, the held board keeps its holder
      assert.equal((await run(db))[0].applied, true);
      assert.equal((await db.query("SELECT holder_id FROM public.billboards WHERE slot_id = 'STREET_40'")).rows[0].holder_id, 'guest:aa');
      assert.equal((await db.query("SELECT count(*)::int n FROM public.billboards")).rows[0].n, 81);
      // the 2026-11-21 file run afterwards keeps the twenty
      const mid = (await db.exec(read('migrations/2026-11-21-mid.sql'))).at(-1).rows;
      assert.ok(mid.every((r) => r.applied), JSON.stringify(mid));
      assert.equal((await db.query('SELECT public.starter_slot_list($1) AS r', [KEY])).rows[0].r.slots.length, 20);
    } finally { await db.close(); }
  });
  it('after the 2026-11-21 file (aef1e9f): the same result, and schema.sql is the same database', async () => {
    const db = await fresh(POST_MID);
    try {
      assert.deepEqual((await db.query('SELECT public.starter_slot_list($1) AS r', [KEY])).rows[0].r, { ok: true, slots: TWELVE });
      assert.equal((await run(db))[0].applied, true);
      const neu = await fresh(read('schema.sql'));
      const fn = async (d, name) => (await d.query(`SELECT pg_get_functiondef(oid) AS def, proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure($1)`, [name])).rows[0];
      for (const name of ['public.slot_floor(text)', 'public.starter_slots()', 'public.starter_slot_list(text)', 'public.claim_billboard(text,text,text,text,bigint,text,text,text,text,text,text,text,integer,text)']) assert.deepEqual(await fn(db, name), await fn(neu, name), name);
      const cols = 'slot_id, tier, current_bid, line1, line2, line3, holder_id, plot_id';
      assert.deepEqual((await db.query(`SELECT ${cols} FROM public.billboards ORDER BY slot_id`)).rows, (await neu.query(`SELECT ${cols} FROM public.billboards ORDER BY slot_id`)).rows);
      await neu.close();
    } finally { await db.close(); }
  });
  it('a slot_floor that is not the expected shape stops part 1 whole (no rows), and part 2 waits for it', async () => {
    const db = await fresh(PRE_MID);
    try {
      await db.exec(`CREATE OR REPLACE FUNCTION public.slot_floor(p_slot TEXT) RETURNS BIGINT LANGUAGE sql IMMUTABLE AS $$ SELECT 100::bigint $$;`);
      const rows = await run(db);
      assert.equal(rows[0].applied, false);
      assert.match(rows[0].note, /^안 바뀜: 중단: 운영 DB의 slot_floor가 예상한 모양이 아닙니다/);
      assert.equal((await db.query("SELECT count(*)::int n FROM public.billboards WHERE slot_id = 'STREET_31'")).rows[0].n, 0);
      assert.equal((await db.query("SELECT to_regprocedure('public.starter_slots()') IS NULL AS none")).rows[0].none, true);
    } finally { await db.close(); }
  });
});
