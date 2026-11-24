// The plot buildings as models: five GLB files under assets/models/lots (tools/blender/build_props.py), fetched when the
// camera first comes near the lots' street and shared by all 18 lots (ts3d/lotmodels.js, ts3d/landmarks.js buildPlot).
// The files are read from disk here: their glTF JSON for what they promise, and through the repository's own GLTFLoader
// for what the game makes of them. Then ts3d/landmarks.js is built in Node (the real three, the real board registry, no
// renderer; the harness of test/plot-street.test.mjs) with a loader that reads the same files, or fails.
import { readFileSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { register } from 'node:module';
import * as THREE from '../vendor/three/build/three.module.js';
import { LAYOUT, LOT, PLOT_SLOTS, lotRect, streetPosts, groundHeight } from '../ts3d/layout.js';
import { boardVantage, facesBlock, portraitFov, frameDistance } from '../camrig.js';
import { LOT_MODEL_URL, LOTS_R, MODEL_URL, nearLots } from '../ts3d/loadplan.js';
import { loadBudget } from '../tools/load-budget.mjs';

register(new URL('./nine-three-hook.mjs', import.meta.url)); // 'three' -> the vendored build, so ts3d/*.js loads in Node

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const onDisk = (url) => new URL('..' + url, import.meta.url);
const S = LAYOUT.street, SC = LOT.scale;
const LEVELS = [0, 1, 2, 3, 4];
const NAMES = ['lot0_empty', 'lot1_tent', 'lot2_pocha', 'lot3_shop', 'lot4_tower'];
const close = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const near = (a, b, msg, eps = 1e-3) => assert.ok(close(a, b, eps), `${msg ?? ''} ${a} vs ${b}`);
const EPS = 1e-9;
const inside = (r, o) => r.x0 >= o.x0 - EPS && r.x1 <= o.x1 + EPS && r.z0 >= o.z0 - EPS && r.z1 <= o.z1 + EPS;
const overlap = (a, b) => a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS;
const pad = (slot) => lotRect(slot, LOT.w / 2, LOT.d / 2);

/** The JSON chunk of a GLB. */
function glbJson(url) {
  const b = readFileSync(onDisk(url));
  assert.equal(b.toString('ascii', 0, 4), 'glTF');
  assert.equal(b.readUInt32LE(8), b.length); // the header's length is the file's
  return { size: b.length, json: JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12))) };
}
/** A loader as ts3d/lotmodels.js takes one: (url) -> Promise of a GLTFLoader result, read from disk. `calls` lists the URLs asked for. */
async function diskLoader(remap = (url) => url) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const calls = [];
  const loadGlb = (url) => {
    calls.push(url);
    return new Promise((resolve, reject) => {
      const b = readFileSync(onDisk(remap(url)));
      new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', resolve, reject);
    });
  };
  return { loadGlb, calls };
}

// ---- the files ---------------------------------------------------------------------------------------------------
describe('the five lot models: the files', () => {
  it('one table: a file per level under /assets/models/lots/, 600 KB together', () => {
    assert.deepEqual(LOT_MODEL_URL, Object.fromEntries(NAMES.map((n, i) => [i, `/assets/models/lots/${n}.glb`])));
    const sizes = LEVELS.map((l) => statSync(onDisk(LOT_MODEL_URL[l])).size);
    for (const b of sizes) assert.ok(b > 40_000 && b < 150_000, String(b));
    const total = sizes.reduce((a, b) => a + b, 0);
    assert.ok(total < 700_000, String(total));
    assert.equal(total, 599_936);
    // served as static assets (nothing in .assetsignore takes them out) and cached by URL by the service worker like every
    // /assets/ file, so a changed model gets a new file name (ts3d/loadplan.js)
    const ignored = read('.assetsignore').split('\n').map((l) => l.trim()).filter(Boolean);
    assert.equal(ignored.some((l) => /glb|lots|assets\/models\/?$/.test(l)), false);
    assert.match(read('sw.js'), /url\.pathname\.startsWith\('\/assets\/'\)/);
    // none shares a name with an avatar model
    assert.equal(Object.values(LOT_MODEL_URL).some((u) => Object.values(MODEL_URL).includes(u)), false);
  });

  for (const level of LEVELS) {
    it(`${NAMES[level]}.glb: BoardAnchor and SignAnchor where the game hangs the board and the sign, an Accent to tint, nothing to decode`, () => {
      const { json } = glbJson(LOT_MODEL_URL[level]);
      assert.equal(json.asset.version, '2.0');
      for (const k of ['images', 'textures', 'samplers', 'skins', 'animations', 'cameras']) assert.equal(json[k], undefined, k);
      assert.equal(json.extensionsRequired, undefined);
      assert.deepEqual(json.extensionsUsed, ['KHR_materials_emissive_strength']); // three reads it as emissiveIntensity
      // materials: flat colours, at most eight, `Accent` among them and neutral grey (the game sets its colour)
      const mats = json.materials.map((m) => m.name);
      assert.equal(new Set(mats).size, mats.length);
      assert.ok(mats.length <= 8, String(mats));
      for (const m of json.materials) {
        assert.equal(m.pbrMetallicRoughness.baseColorTexture, undefined, m.name);
        assert.equal(m.emissiveTexture, undefined, m.name);
        assert.notEqual(m.doubleSided, true, m.name); // closed shells, drawn single-sided
      }
      const accent = json.materials.find((m) => m.name === 'Accent');
      assert.ok(accent, 'no Accent material');
      const [r, g, b] = accent.pbrMetallicRoughness.baseColorFactor;
      assert.ok(close(r, g, 1e-6) && close(g, b, 1e-6) && r > 0.6 && r < 0.8, String([r, g, b]));
      const [er, eg, eb] = accent.emissiveFactor;
      assert.ok(close(er, eg, 1e-6) && close(eg, eb, 1e-6) && close(er / r, 0.45, 0.01), String([er, eg, eb]));
      // nodes: the building as one mesh node, the two anchors, and over the empty lot the gem
      const node = (name) => json.nodes.find((n) => n.name === name);
      assert.deepEqual(json.nodes.map((n) => n.name).sort(), [...(level === 0 ? ['Gem'] : []), 'BoardAnchor', 'Lot', 'SignAnchor'].sort());
      for (const n of json.nodes) assert.equal(n.rotation, undefined, n.name);
      assert.equal(node('Lot').translation, undefined);
      assert.equal(node('Lot').scale, undefined);
      const faces = LOT.faces[level];
      const at = (n, spec, tag) => {
        const [x, y, z] = n.translation, [w, h, d] = n.scale;
        near(x, spec.x, tag + ' x'); near(y, spec.y, tag + ' y'); near(z, spec.z, tag + ' z');
        near(w, spec.w, tag + ' w'); near(h, spec.h, tag + ' h'); near(d, 1, tag + ' depth');
      };
      at(node('BoardAnchor'), faces.board, 'board');
      if (level < 4) at(node('SignAnchor'), faces.sign, 'sign');
      else {
        // The tower's own name plate is on its crown, 2.35 m behind the board. The game keeps the sign's size and stands
        // it on the board's top rim instead (see 'the name sign can be seen from the street' below).
        at(node('SignAnchor'), { ...faces.sign, y: 16.3, z: 1.2 }, 'crown plate');
        assert.ok(faces.sign.z > 1.2 + 2 && faces.sign.z < faces.board.z);
        // over the model's rim round the board (its top bar and neon tube end 0.42 above the screen's opening)
        assert.ok(faces.sign.y - faces.sign.h / 2 > faces.board.y + faces.board.h / 2 + 0.42);
        assert.ok(faces.sign.y + faces.sign.h / 2 < LOT.tall[4]);
      }
      if (level === 0) {
        assert.deepEqual(node('Gem').translation.map((v) => Math.round(v * 1e4) / 1e4), [0, 4.35, 0.6]);
        assert.notEqual(node('Gem').mesh, node('Lot').mesh);
      }
      // geometry: positions and normals only (no UVs, no vertex colours in the file), indexed triangles, one primitive per material
      let tris = 0;
      for (const mesh of json.meshes) {
        const used = mesh.primitives.map((p) => p.material);
        assert.equal(new Set(used).size, used.length, mesh.name);
        for (const p of mesh.primitives) {
          assert.deepEqual(Object.keys(p.attributes).sort(), ['NORMAL', 'POSITION']);
          assert.ok(p.mode === undefined || p.mode === 4);
          tris += json.accessors[p.indices].count / 3;
        }
      }
      assert.ok(tris >= 3000 && tris <= 6000, String(tris));
      assert.equal(tris, [3478, 4722, 5698, 5696, 4772][level]);
    });
  }
});

// ---- when they are fetched --------------------------------------------------------------------------------------
describe('the lot models are not part of the first load', () => {
  it('no lot model is in the boot list or the first-minute list; all five are counted under later', () => {
    for (const species of [1, 10]) {
      const r = loadBudget({ quality: 'low', species });
      assert.deepEqual(r.unclassified, []);
      assert.deepEqual(r.missing, []);
      const rows = r.rows.filter((x) => x.file.startsWith('assets/models/lots/'));
      assert.deepEqual(rows.map((x) => '/' + x.file).sort(), Object.values(LOT_MODEL_URL).sort());
      for (const x of rows) assert.equal(x.phase, 'later', x.file);
      for (const x of r.rows) if (x.phase !== 'later') assert.equal(/lots\//.test(x.file), false, x.file);
    }
    // nothing preloads them, and the page itself does not name them
    for (const f of ['index.html', 'main.js', 'sw.js']) assert.equal(/models\/lots/.test(read(f)), false, f);
  });
  it('they are asked for from one place: marks.update, once the camera is within 150 m of the street', () => {
    assert.equal(LOTS_R, 150);
    const lm = read('ts3d/landmarks.js');
    assert.match(lm, /function update\(dt, t, eye\) \{\n\s*if \(eye && !lots\.started && nearLots\(eye\.x, eye\.z, LAYOUT\.street\)\) lots\.want\(\);/);
    assert.equal((lm.match(/lots\.want\(/g) || []).length, 1);
    // the world hands it the camera's position every frame: a link that lands on a plot is inside the radius on its first frame
    assert.match(read('timesSquare3d.js'), /marks\?\.update\(dt, t, camera\.position\);/);
    for (const f of ['timesSquare3d.js', 'main.js', 'ui.js']) assert.equal(/lots\.want|LOT_MODEL_URL|lotmodels/.test(read(f)), false, f);
  });
  it('nearLots: 150 m from the street\'s centre line, ends included', () => {
    const spawn = LAYOUT.spawn;
    assert.equal(nearLots(spawn.x, spawn.z, S), false); // 234 m north of the arch
    assert.ok(Math.hypot(spawn.x - S.x, S.z0 - spawn.z) > 230);
    assert.equal(nearLots(LAYOUT.stall.x, LAYOUT.stall.z, S), true); // by the bungeo-ppang stall, 145.5 m
    assert.equal(nearLots(16, 100, S), false);
    assert.equal(nearLots(S.x, S.z0 - 150, S), true);
    assert.equal(nearLots(S.x, S.z0 - 150.01, S), false);
    assert.equal(nearLots(S.x + 150, S.mid.z, S), true);
    assert.equal(nearLots(S.x - 150.01, S.mid.z, S), false);
    assert.equal(nearLots(S.x, S.z1 + 150.01, S), false);
    for (const s of PLOT_SLOTS) assert.equal(nearLots(s.x, s.z, S), true, 'lot ' + s.id);
    assert.equal(nearLots(S.x, S.entry.z, S), true); // where a jump to the lots lands
    assert.equal(nearLots(NaN, 0, S), false);
    assert.equal(nearLots(0, 300, null), false);
  });
});

// ---- what the game makes of a file -----------------------------------------------------------------------------------
describe('a lot model as the game draws it (ts3d/lotmodels.js)', () => {
  let lots = null, mod = null;
  before(async () => {
    mod = await import('../ts3d/lotmodels.js');
    lots = mod.createLotModels({ loadGlb: (await diskLoader()).loadGlb });
    assert.equal(lots.want(), true);
    assert.equal(lots.want(), false);
    await lots.settled();
  });
  const PARTS = [['matte', 'glow'], ['matte', 'metal', 'glow', 'accent'], ['matte', 'metal', 'glow', 'accent'], ['matte', 'glow', 'accent'], ['matte', 'glow', 'accent']];
  it('a file becomes two to four shared geometries with vertex colours: an empty lot 3 draw calls, a tent or a stall 4, a shop or a tower 3', () => {
    assert.deepEqual(mod.LOT_PARTS, ['matte', 'metal', 'glow', 'accent']);
    assert.equal(lots.missing.size, 0);
    const draws = [];
    for (const level of LEVELS) {
      const prep = lots.get(level);
      assert.ok(prep, 'level ' + level);
      assert.deepEqual([...prep.parts.keys()], PARTS[level], 'level ' + level);
      assert.equal(!!prep.gem, level === 0);
      draws.push(prep.parts.size + (prep.gem ? 1 : 0));
      let tris = prep.gem ? prep.gem.geometry.index.count / 3 : 0;
      for (const [name, g] of prep.parts) {
        const tag = `level ${level} ${name}`;
        assert.equal(g.userData.shared, true, tag);
        assert.deepEqual(Object.keys(g.attributes).sort(), ['color', 'normal', 'position'], tag);
        assert.ok(g.index && g.boundingSphere && g.boundingBox, tag);
        tris += g.index.count / 3;
        const c = g.attributes.color.array;
        let max = 0, min = Infinity;
        for (const v of c) { if (v > max) max = v; if (v < min) min = v; }
        if (name === 'glow') assert.ok(max > 1.4, `${tag} ${max}`); // neon is brighter than white: the bloom pass picks it up
        else if (name === 'accent') assert.ok(max === 1 && min === 1, tag); // white: the lot's own material colours it
        else assert.ok(max <= 1 && min >= 0, `${tag} ${max}`);
      }
      assert.equal(tris, glbJson(LOT_MODEL_URL[level]).json.meshes.reduce((a, m) => a + m.primitives.reduce((b, p) => b + glbJson(LOT_MODEL_URL[level]).json.accessors[p.indices].count / 3, 0), 0), 'level ' + level);
      assert.equal(tris, prep.tris);
    }
    assert.deepEqual(draws, [3, 4, 4, 3, 3]);
    // an empty lot's kerb is the unowned colour, unlit, in the glow part (so an empty lot has no accent part)
    const kerb = new THREE.Color(mod.EMPTY_ACCENT).multiplyScalar(mod.EMPTY_GLOW);
    assert.equal(mod.EMPTY_ACCENT, '#ffe2a8');
    const c = lots.get(0).parts.get('glow').attributes.color;
    let n = 0;
    for (let i = 0; i < c.count; i++) if (close(c.getX(i), kerb.r, 1e-5) && close(c.getY(i), kerb.g, 1e-5) && close(c.getZ(i), kerb.b, 1e-5)) n++;
    assert.equal(n, 132); // the Accent primitive's vertices in lot0_empty.glb
    // the materials every lot shares: lit vertex colours (the kit's program), the gem with the file's own values
    for (const k of ['matte', 'metal', 'gem']) assert.ok(lots.mats[k].isMeshStandardMaterial && lots.mats[k].vertexColors, k);
    assert.ok(lots.mats.glow.isMeshBasicMaterial && lots.mats.glow.vertexColors);
    assert.deepEqual([lots.mats.matte.roughness, lots.mats.matte.metalness, lots.mats.metal.roughness, lots.mats.metal.metalness], [0.72, 0, 0.36, 0.65]);
    near(lots.mats.gem.emissiveIntensity, 1.3);
    near(lots.mats.gem.roughness, 0.18);
    assert.ok(lots.mats.gem.emissive.r > 0.9 && lots.mats.gem.emissive.b < 0.1);
  });
  it('the anchors it reads are the file\'s', () => {
    for (const level of LEVELS) {
      const a = lots.get(level).anchors, f = LOT.faces[level];
      assert.deepEqual(a.board, f.board, 'level ' + level);
      assert.deepEqual(a.sign, level === 4 ? { ...f.sign, y: 16.3, z: 1.2 } : f.sign, 'level ' + level);
    }
    assert.deepEqual(lots.get(0).gem.position.toArray().map((v) => Math.round(v * 1e4) / 1e4), [0, 4.35, 0.6]);
  });
  /** Every vertex of a level's model, in the lot's frame: [x, y, z]. */
  const points = (level) => {
    const out = [];
    for (const g of lots.get(level).parts.values()) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) out.push([p.getX(i), p.getY(i), p.getZ(i)]); }
    return out;
  };
  it('every model stands on its pad and inside the lot\'s numbers (LOT in ts3d/layout.js)', () => {
    const tops = [];
    for (const level of LEVELS) {
      const box = new THREE.Box3();
      for (const g of lots.get(level).parts.values()) box.union(g.boundingBox);
      const tag = `level ${level} ${box.min.toArray()} ${box.max.toArray()}`;
      // the pad itself is in it: 8.4 x 7.6, on the ground
      assert.ok(box.min.x <= -LOT.w / 2 + 1e-3 && box.max.x >= LOT.w / 2 - 1e-3, tag);
      near(box.min.z, -LOT.d / 2, tag);
      near(box.min.y, 0, tag);
      assert.ok(box.max.x <= LOT.wide / 2 && box.min.x >= -LOT.wide / 2, tag);
      // nothing behind the pad; nothing before it but the tower's marquee
      assert.ok(box.max.z <= (level === 4 ? LOT.reach : LOT.d / 2 + 1e-3), tag);
      tops.push(Math.round(box.max.y * 100) / 100);
      if (LOT.tall[level]) assert.ok(box.max.y <= LOT.tall[level] + 0.011, tag); // a 1 cm lamp over the shop's tank
    }
    assert.deepEqual(tops, [4.13, 7.18, 8.93, 9.01, 19]);
    // LOT.wide is the rim of the tower's board, LOT.reach its marquee
    const tower = new THREE.Box3();
    for (const g of lots.get(4).parts.values()) tower.union(g.boundingBox);
    assert.ok(LOT.wide / 2 - tower.max.x < 0.01 && LOT.wide / 2 + tower.min.x < 0.01, String([tower.min.x, tower.max.x]));
    assert.ok(LOT.reach - tower.max.z < 0.01, String(tower.max.z));
    // the other four keep within 5.02 m of the centre line across (the shop's two hanging signs)
    for (const level of [0, 1, 2, 3]) for (const [x] of points(level)) assert.ok(Math.abs(x) <= 5.02, `level ${level} ${x}`);
  });
  it('the tower\'s marquee is all that passes a pad\'s front edge: 3.8 m wide, 2.6 m up or more, nothing under it', () => {
    for (const level of [0, 1, 2, 3]) assert.equal(points(level).some(([, , z]) => z > LOT.d / 2 + 1e-3), false, 'level ' + level);
    const over = points(4).filter(([, , z]) => z > LOT.d / 2 + 1e-3);
    assert.ok(over.length > 20, String(over.length));
    for (const [x, y, z] of over) {
      assert.ok(y >= 2.6, `y ${y}`); // the lamps under it: 2.35 m in the world at the lots' scale, over a 1.8 m avatar's head
      // the marquee over the door, or one of the two lamps on the lobby's pilasters (6 cm over the edge, 3 m up)
      if (Math.abs(x) > 1.9) assert.ok(Math.abs(Math.abs(x) - 2.57) <= 0.12 && z <= LOT.d / 2 + 0.07, `x ${x} z ${z}`);
      assert.ok(z <= LOT.reach, `z ${z}`);
    }
    // in the world the marquee ends 12.94 m from the centre line: outside the street's clear width, and clear of the lot's
    // number post (4.4 m along the street from the lot's centre) and of the spot before the lot (5.4 forward of it)
    const edge = S.lotX - LOT.reach * SC;
    near(edge, 12.941);
    assert.ok(edge > S.half + 0.9);
    for (const p of streetPosts().filter((q) => q.lot)) assert.ok(Math.abs(p.z - PLOT_SLOTS[p.lot - 1].z) - p.r > 1.9 * SC + 2);
    assert.ok(5.4 > LOT.reach + 0.8);
  });
  it('the colliders hold what stands in a walker\'s way', () => {
    // Of each model's surface between 0.6 and 1.7 m (a walker's body; the pad, kerbs, steps and low stools are under it),
    // the share that lies inside the level's collider. Outside it are only small things: the tent's back stays and its
    // folding board, the stall's gas bottle and menu board, the shop's two bollards and the box on its back wall, the
    // tower's pilaster fronts and bollards.
    const share = [];
    for (const level of [1, 2, 3, 4]) {
      const [ax, dz] = LOT.foot[level];
      let inArea = 0, all = 0;
      for (const g of lots.get(level).parts.values()) {
        const p = g.attributes.position, ix = g.index, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), t = new THREE.Triangle();
        for (let i = 0; i < ix.count; i += 3) {
          t.set(a.fromBufferAttribute(p, ix.getX(i)), b.fromBufferAttribute(p, ix.getX(i + 1)), c.fromBufferAttribute(p, ix.getX(i + 2)));
          const y = (a.y + b.y + c.y) / 3, x = (a.x + b.x + c.x) / 3, z = (a.z + b.z + c.z) / 3;
          if (y < 0.6 || y > 1.7) continue;
          const area = t.getArea();
          all += area;
          if (Math.abs(x) <= ax + 0.05 && Math.abs(z) <= dz + 0.05) inArea += area;
        }
      }
      share.push(Math.round((inArea / all) * 100));
      assert.ok(inArea / all >= 0.9, `level ${level}: ${inArea / all}`);
      // and it is not a box much bigger than the building: inside the pad, with the pad's edge strip left to walk on
      assert.ok(ax < LOT.w / 2 && dz < LOT.d / 2, 'level ' + level);
    }
    assert.deepEqual(share, [96, 97, 97, 98]); // percent, levels 1 to 4
    // the numbers the colliders were set from, measured on the files (a box has vertices only at its ends, so each is
    // read where the piece meets the ground)
    const span = (level, part, keep) => {
      const b = new THREE.Box3(), p = lots.get(level).parts.get(part).attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) if (keep(v.fromBufferAttribute(p, i))) b.expandByPoint(v);
      return b;
    };
    // the tent's two steel masts stand at x ± 2.98 and are 0.2 thick: the collider reaches their outer faces
    const masts = span(1, 'metal', (v) => v.y < 0.3);
    near(masts.max.x, 3.08, 'tent masts', 0.01);
    near(masts.min.x, -3.08, 'tent masts', 0.01);
    assert.ok(LOT.foot[1][0] >= masts.max.x && LOT.foot[1][0] <= masts.max.x + 0.1);
    // the shop (8.0 wide) stands on a plinth 8.12 wide whose back is 3.36 behind the centre (its downpipe at x 3.6 left out)
    const plinth = span(3, 'matte', (v) => v.y > 0.4 && v.y < 0.6 && v.z < 2 && Math.abs(v.x - 3.6) > 0.1);
    near(plinth.max.x - plinth.min.x, 8.12, 'shop plinth', 0.01);
    near(plinth.min.z, -3.36, 'shop back', 0.01);
    assert.ok(LOT.foot[3][0] >= plinth.max.x && LOT.foot[3][0] <= plinth.max.x + 0.1);
    assert.ok(LOT.foot[3][1] >= -plinth.min.z - 0.07);
    // the tower's lobby (7.9 wide) stands on a base band 8.02 wide, from 3.28 behind the centre to 3.48 before it
    const band = span(4, 'matte', (v) => v.y > 0.3 && v.y < 0.52);
    near(band.max.x - band.min.x, 8.02, 'tower base', 0.01);
    near(band.min.z, -3.28, 'tower back', 0.01);
    near(band.max.z, 3.48, 'tower front', 0.01);
    assert.ok(LOT.foot[4][0] >= band.max.x && LOT.foot[4][0] <= band.max.x + 0.1);
    assert.ok(LOT.foot[4][1] >= band.max.z && LOT.foot[4][1] <= band.max.z + 0.2);
  });
});

// ---- the built street ------------------------------------------------------------------------------------------------
function fakeDom() {
  const ctx = () => new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return (s) => ({ width: String(s).length * 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  globalThis.document = { createElement: () => { let g = null; return { width: 0, height: 0, getContext() { return g || (g = ctx()); } }; } };
}
async function buildWorld({ loadGlb, quality = 'high' } = {}) {
  fakeDom();
  const { createBoards } = await import('../ts3d/screens.js');
  const { buildLandmarks } = await import('../ts3d/landmarks.js');
  const { kitMaterials } = await import('../ts3d/kit.js');
  const scene = new THREE.Scene(), colliders = [], blockers = [], pick = [];
  const kitMats = kitMaterials();
  const boards = createBoards({ renderer: { capabilities: { getMaxAnisotropy: () => 4 } }, kitMats, pick, quality });
  const ground = { glowTex: new THREE.Texture(), pools: () => null, mats: { street: new THREE.MeshStandardMaterial() } };
  const marks = buildLandmarks({ scene, kitMats, boards, ground, colliders, blockers, pick, quality, loadGlb });
  scene.updateMatrixWorld(true);
  return { scene, colliders, blockers, pick, boards, marks, kitMats };
}
const NEAR = { x: S.x, y: 3.15, z: S.z0 - 20 }, FAR = { x: LAYOUT.spawn.x, y: 3.15, z: LAYOUT.spawn.z };
const isBox = (rec) => rec.model === false && rec.body[0].isGroup && rec.body[0].children.some((m) => m.name === 'base');
const isModel = (rec) => rec.model === true && rec.body.every((m) => m.isMesh && m.geometry.userData.shared === true);
const bodyMeshes = (rec) => { const out = []; for (const n of rec.body) n.traverse((o) => { if (o.isMesh) out.push(o); }); return out; };
const inScene = (o, scene) => { for (let p = o; p; p = p.parent) if (p === scene) return true; return false; };
/** console.warn and console.error held back while fn runs; returns what was said. */
async function quiet(fn) {
  const said = [], w = console.warn, e = console.error;
  console.warn = (...a) => said.push(a.join(' '));
  console.error = (...a) => said.push(a.join(' '));
  try { await fn(); } finally { console.warn = w; console.error = e; }
  return said;
}

describe('the street with the models in (ts3d/landmarks.js with the real three and the real files)', () => {
  let W = null, disk = null;
  const all = (level, color = (s) => (s.side === 'E' ? '#ff3d9a' : '#3fe6ff')) => {
    for (const s of PLOT_SLOTS) assert.ok(W.marks.applyPlot({ plot_id: s.id, level, theme_color: color(s), owner_name: level ? '테스트' : '' }));
    W.scene.updateMatrixWorld(true);
  };
  before(async () => { disk = await diskLoader(); W = await buildWorld({ loadGlb: disk.loadGlb }); });

  it('nothing is asked for until the camera is within 150 m of the street; then each file once, and the boxes stand until it is in', async () => {
    const lots = W.marks.lots;
    assert.equal(lots.started, false);
    for (let i = 0; i < 3; i++) { W.marks.update(0.016, i, FAR); W.marks.update(0.016, i); }
    assert.equal(lots.started, false);
    assert.deepEqual(disk.calls, []);
    for (const rec of W.marks.plots.values()) assert.ok(isBox(rec), 'lot ' + rec.id);
    W.marks.update(0.016, 3, { x: LAYOUT.stall.x, y: 3.15, z: LAYOUT.stall.z }); // walking south past the stall
    assert.equal(lots.started, true);
    assert.deepEqual([...disk.calls].sort(), Object.values(LOT_MODEL_URL).sort());
    for (const rec of W.marks.plots.values()) assert.ok(isBox(rec), 'lot ' + rec.id); // this frame still shows the boxes
    await lots.settled();
    assert.equal(lots.missing.size, 0);
    for (const rec of W.marks.plots.values()) assert.ok(isModel(rec), 'lot ' + rec.id);
    for (let i = 0; i < 3; i++) W.marks.update(0.016, 4 + i, NEAR);
    assert.equal(disk.calls.length, 5); // never again
  });

  it('18 empty lots draw the one empty-lot model: 54 draw calls and 62,604 triangles for the buildings, one geometry each', () => {
    const empty = W.marks.lots.get(0);
    let draws = 0, tris = 0;
    for (const rec of W.marks.plots.values()) {
      assert.deepEqual(rec.body.map((m) => m.name), ['matte', 'glow', 'gem'], 'lot ' + rec.id);
      assert.equal(rec.body[0].geometry, empty.parts.get('matte'));
      assert.equal(rec.body[1].geometry, empty.parts.get('glow'));
      assert.equal(rec.body[2].geometry, empty.gem.geometry);
      assert.equal(rec.body[0].material, W.marks.lots.mats.matte);
      assert.equal(rec.body[1].material, W.kitMats.glow); // the same material as every other neon in the plaza
      assert.equal(rec.body[2].material, W.marks.lots.mats.gem);
      // the lot's group holds the model, the name sign, the badge and the board: no box is left in it
      assert.equal(rec.group.children.length, 3 + 3, 'lot ' + rec.id);
      assert.equal(rec.group.children.some((o) => o.isGroup && o.children.some((m) => m.name === 'base')), false);
      for (const m of rec.body) { draws++; tris += m.geometry.index.count / 3; }
    }
    assert.deepEqual([draws, tris], [54, 18 * 3478]);
    assert.equal(tris, 62604);
    // nothing of the boxes is left to pick: per lot the model's three meshes and the sign
    for (const s of PLOT_SLOTS) assert.equal(W.pick.filter((o) => o.userData.pick?.kind === 'plot' && o.userData.pick.plotId === s.id).length, 4, 'lot ' + s.id);
    for (const o of W.pick) assert.ok(inScene(o, W.scene), o.name);
    assert.equal(W.colliders.filter((c) => c.plot).length, 0);
  });

  it('the gem over an empty lot is the model\'s, and it turns and bobs', () => {
    const rec = W.marks.plots.get(7), gem = rec.gem;
    assert.equal(gem, rec.body[2]);
    assert.equal(gem.geometry.index.count / 3, 36);
    assert.deepEqual([gem.position.x, gem.position.z].map((v) => Math.round(v * 1e4) / 1e4), [0, 0.6]);
    const seen = [];
    for (const t of [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2]) { W.marks.update(0.4, t, NEAR); seen.push([gem.rotation.y, gem.position.y]); }
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i][0] > seen[i - 1][0]);
    near(seen[8][0], 3.2 * 1.4);
    const ys = seen.map((s) => s[1]);
    assert.ok(Math.min(...ys) >= 4.35 - 0.18 - 1e-9 && Math.max(...ys) <= 4.35 + 0.18 + 1e-9);
    assert.ok(Math.max(...ys) - Math.min(...ys) > 0.3);
    // every lot's gem is on its own beat, as before
    assert.notEqual(W.marks.plots.get(8).gem.position.y, gem.position.y);
  });

  const DRAWS = [3, 4, 4, 3, 3];
  for (const level of LEVELS) {
    it(`level ${level} on both sides: the model on its pad, its pick data, its board and sign on their mounts, its collider inside the pad`, () => {
      all(level);
      const prep = W.marks.lots.get(level);
      const ray = new THREE.Raycaster();
      const lotsColliders = W.colliders.filter((c) => c.plot);
      assert.equal(lotsColliders.length, level ? 18 : 0);
      assert.equal(W.blockers.filter((b) => b.plot).length, LOT.tall[level] ? 18 : 0);
      for (const s of PLOT_SLOTS) {
        const rec = W.marks.plots.get(s.id), tag = `lot ${s.id}@${level}`;
        const toStreet = Math.sign(S.x - s.x);
        assert.ok(isModel(rec), tag);
        assert.equal(rec.body.length, DRAWS[level], tag);
        // drawn from the shared geometry, turned and scaled by the lot's group alone
        assert.equal(rec.group.rotation.y, s.rot, tag);
        assert.equal(rec.group.scale.x, SC, tag);
        for (const m of rec.body) {
          if (m.name !== 'gem') assert.equal(m.geometry, prep.parts.get(m.name), `${tag} ${m.name}`);
          if (m.name !== 'gem') assert.deepEqual(m.position.toArray().concat(m.rotation.y, m.scale.x), [0, 0, 0, 0, 1], tag);
          // picking: every mesh of the model opens this lot's sheet
          assert.deepEqual(m.userData.pick, { kind: 'plot', plotId: s.id }, `${tag} ${m.name}`);
          assert.ok(W.pick.includes(m), `${tag} ${m.name}`);
        }
        // the owner's colour: the lot's own accent material, colour and a glow of the same colour
        const accent = rec.body.find((m) => m.name === 'accent');
        assert.equal(!!accent, level > 0, tag);
        if (accent) {
          const want = new THREE.Color(s.side === 'E' ? '#ff3d9a' : '#3fe6ff');
          assert.equal(accent.material.color.getHex(), want.getHex(), tag);
          assert.equal(accent.material.emissive.getHex(), want.getHex(), tag);
          near(accent.material.emissiveIntensity, 0.45, tag);
          assert.ok(accent.material.vertexColors && accent.material.isMeshStandardMaterial, tag);
          assert.notEqual(accent.material, W.marks.plots.get(s.id <= 2 ? s.id + 2 : s.id - 2).body.find((m) => m.name === 'accent').material, tag);
        }
        // in the world: the front toward the street, nothing in the clear walking width, nothing off the lot
        const box = new THREE.Box3();
        for (const m of rec.body) box.union(new THREE.Box3().copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld));
        const front = toStreet > 0 ? box.max.x - s.x : s.x - box.min.x, back = toStreet > 0 ? s.x - box.min.x : box.max.x - s.x;
        near(back, (LOT.d / 2) * SC, tag);
        if (level === 4) near(front, LOT.reach * SC, tag, 0.01); else near(front, (LOT.d / 2) * SC, tag);
        assert.ok(Math.min(Math.abs(box.min.x - S.x), Math.abs(box.max.x - S.x)) > S.half + 0.9, tag);
        assert.ok(box.max.z - s.z <= (LOT.wide / 2) * SC + 1e-6 && s.z - box.min.z <= (LOT.wide / 2) * SC + 1e-6, tag);
        // a tap from the street: the ray to the pad's front kerb, as the game picks (the nearest pickable thing)
        const eye = new THREE.Vector3(S.x, 1.9, s.z + 1.5), kerb = rec.group.localToWorld(new THREE.Vector3(0.6, 0.13, LOT.d / 2 - 0.08));
        ray.set(eye, kerb.clone().sub(eye).normalize());
        const hit = ray.intersectObjects(W.pick, false).find((h) => h.object.userData.pick);
        assert.ok(hit, tag);
        assert.deepEqual(hit.object.userData.pick, { kind: 'plot', plotId: s.id }, tag);
        assert.ok(bodyMeshes(rec).includes(hit.object), tag);
        // the board: toward the street, where LOT.faces says, and the model's mount plate 0.24 m behind the screen
        const f = W.boards.face('PLOT_' + s.id), spec = LOT.faces[level];
        near(f.normal.x, toStreet, tag); near(f.normal.z, 0, tag);
        const at = rec.group.localToWorld(new THREE.Vector3(spec.board.x, spec.board.y, spec.board.z));
        near(f.pos.x, at.x, tag); near(f.pos.y, at.y, tag); near(f.pos.z, at.z, tag);
        ray.set(f.pos.clone().addScaledVector(f.normal, 0.5), f.normal.clone().negate());
        const plate = ray.intersectObjects(rec.body, false)[0];
        assert.ok(plate, tag);
        near(plate.distance - 0.5, 0.24 * SC, `${tag} plate behind the screen`, 0.005);
        assert.equal(W.boards.get('PLOT_' + s.id).mounts.length, 1, tag);
        // the name sign: where LOT.faces says, pickable, and (but for the tower, whose sign stands on the board's rim)
        // the model's own name plate 3 cm behind it
        near(rec.sign.position.x, spec.sign.x, tag); near(rec.sign.position.y, spec.sign.y, tag); near(rec.sign.position.z, spec.sign.z, tag);
        assert.deepEqual(rec.sign.userData.pick, { kind: 'plot', plotId: s.id }, tag);
        assert.ok(W.pick.includes(rec.sign), tag);
        const sp = rec.sign.getWorldPosition(new THREE.Vector3());
        ray.set(sp.clone().addScaledVector(f.normal, 0.5), f.normal.clone().negate());
        const behind = ray.intersectObjects(rec.body, false)[0];
        if (level < 4) near(behind.distance - 0.5, 0.03 * SC, `${tag} plate behind the sign`, 0.005);
        else {
          // the tower: the crown is 1.9 m behind the sign, and the sign stands on the rim round the board (its top bar
          // 0.17 under the sign's lower edge, in the lot's own metres)
          assert.ok(behind.distance - 0.5 > 1.9, `${tag} ${behind.distance}`);
          for (const u of [-0.45, 0, 0.45]) {
            ray.set(rec.sign.localToWorld(new THREE.Vector3(u * spec.sign.w, -spec.sign.h / 2, 0)), new THREE.Vector3(0, -1, 0));
            near(ray.intersectObjects(rec.body, false)[0].distance, 0.17 * SC, `${tag} rim under the sign`, 0.005);
          }
        }
        // the collider: lotRect's, inside the pad; the camera blocker over it, as tall as the level
        const c = lotsColliders.find((q) => q.plot === s.id);
        if (level) {
          const r = lotRect(s, LOT.foot[level][0], LOT.foot[level][1]);
          near(c.x0, r.x0, tag); near(c.x1, r.x1, tag); near(c.z0, r.z0, tag); near(c.z1, r.z1, tag);
          assert.ok(inside(c, pad(s)), tag);
          assert.ok(Math.min(Math.abs(c.x0 - S.x), Math.abs(c.x1 - S.x)) >= S.half + 1.7, tag);
          for (const p of streetPosts()) assert.equal(overlap(c, { x0: p.x - p.r, x1: p.x + p.r, z0: p.z - p.r, z1: p.z + p.r }), false, tag);
        } else assert.equal(c, undefined, tag);
        const b = W.blockers.find((q) => q.plot === s.id);
        if (LOT.tall[level]) {
          near(b.max.y, LOT.tall[level] * SC, tag);
          assert.deepEqual([b.min.x, b.max.x, b.min.z, b.max.z, b.min.y], [c.x0, c.x1, c.z0, c.z1, 0], tag);
          assert.ok(b.max.y >= box.max.y - 0.011, tag); // as tall as the model
        } else assert.equal(b, undefined, tag);
      }
      // shared: one geometry per part for all 18, the lot's accent apart
      const mats = new Set(), geos = new Set();
      for (const rec of W.marks.plots.values()) for (const m of rec.body) { mats.add(m.material); geos.add(m.geometry); }
      assert.equal(geos.size, DRAWS[level]);
      assert.equal(mats.size, level ? DRAWS[level] - 1 + 18 : 3);
      // no vertex of a model is inside a number post or an arch post (the first two pairs stand for all: lots 1 and 2 are
      // the ones by the arch)
      const posts = streetPosts().map((p) => new THREE.Box3(new THREE.Vector3(p.x - p.r, 0, p.z - p.r), new THREE.Vector3(p.x + p.r, p.arch ? S.arch.h : 1.8, p.z + p.r)));
      const v = new THREE.Vector3();
      for (const id of [1, 2, 3, 4]) for (const m of W.marks.plots.get(id).body) {
        const p = m.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
          for (const b of posts) assert.equal(b.containsPoint(v), false, `lot ${id}@${level} ${m.name} ${v.toArray()}`);
        }
      }
    });
  }

  it('the street stays 27 m wide: on an upright phone the tower\'s board camera needs 20.1 m and has 6.6 m of street behind it', () => {
    // The widest board (a tower's, 11.34 x 6.38 m in the world) seen whole on a 9:19.5 frame (37 degrees wide) from straight
    // on. With the rows at x ± 17 the camera stands 6.3 m past the centre line, inside the clear width, 6.6 m before the far
    // row's marquees. Rows 2.83 m nearer the centre line would put it outside the clear width, and the next test shows how
    // little a narrower street gives a walker. So LAYOUT.street.lotX stays 17.
    all(4);
    const aspect = 9 / 19.5, vfov = portraitFov(aspect, 62);
    near(vfov, 72);
    const faces = new Map(PLOT_SLOTS.map((s) => [s.id, W.boards.face('PLOT_' + s.id)]));
    for (const s of PLOT_SLOTS) {
      const f = faces.get(s.id), toStreet = Math.sign(S.x - s.x);
      near(frameDistance({ w: f.w, h: f.h, aspect, vfov }), 20.13, 'lot ' + s.id, 0.01);
      const v = boardVantage({ face: { x: f.pos.x, y: f.pos.y, z: f.pos.z, nx: f.normal.x, nz: f.normal.z, w: f.w, h: f.h }, dist: 18, aspect, vfov, block: facesBlock([...faces.values()].filter((o) => o !== f)), ground: groundHeight });
      assert.ok(v.fit >= 0.999 && v.seen >= 0.999 && v.yaw === 0, 'lot ' + s.id);
      near((S.x - v.x) * toStreet, -6.33, 'lot ' + s.id, 0.01); // 6.33 m past the centre line
      assert.ok(Math.abs(v.x - S.x) < S.half);
      const farMarquee = S.lotX - LOT.reach * SC; // the far row's marquees, from the centre line
      near(farMarquee - Math.abs(v.x - S.x), 6.61, 'lot ' + s.id, 0.01);
      // moving both rows in by d moves the face in and the camera out by d while the clear half-width shrinks by d
      near((S.half - Math.abs(v.x - S.x)) / 2, 2.83, 'lot ' + s.id, 0.01);
    }
    assert.equal(S.lotX, 17);
  });

  it('walking down the centre, an upright phone sees little of the lots at any width the street may have', () => {
    // The share of a 9:19.5 frame (37 degrees wide, the walking camera 8.4 m behind and 1.25 m over the eye line) that the
    // lots' models and boards cover, pads left out, with the player on the centre line at z 300. The real models are
    // projected and filled into a 180 x 390 grid for rows at x ± 17 (as built), ± 15 and ± 13 (the narrowest that leaves
    // 16 m clear). The fronts are parallel to the walk, so the frame's edges only reach them 37 m ahead and at 15 to 18
    // degrees off their own plane, at every width: a narrower street is not clearly better, and at ± 13 the tower's board
    // camera of the test above no longer fits in it.
    const tris = LEVELS.map((level) => {
      const out = [];
      for (const g of W.marks.lots.get(level).parts.values()) {
        const p = g.attributes.position, ix = g.index;
        for (let i = 0; i < ix.count; i += 3) {
          const t = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, ix.getX(i + k)));
          if (t.some((v) => v.y >= 0.3)) out.push(t);
        }
      }
      const b = LOT.faces[level].board, w = Math.min(b.w, (b.h * 16) / 9) / 2, h = Math.min(b.h, (b.w * 9) / 16) / 2;
      const q = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => new THREE.Vector3(b.x + x, b.y + y, b.z));
      out.push([q[0], q[1], q[2]], [q[0], q[2], q[3]]);
      return out;
    });
    const GW = 180, GH = 390, aspect = 9 / 19.5;
    const cam = new THREE.PerspectiveCamera(portraitFov(aspect, 62), aspect, 0.2, 5200);
    cam.position.set(S.x, 1.9 + 1.25, 300 - 8.4);
    cam.lookAt(S.x, 1.9, 300);
    cam.updateMatrixWorld(true);
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const fill = (lotX, levelOf) => {
      const mask = new Uint8Array(GW * GH), m = new THREE.Matrix4(), v = new THREE.Vector4();
      for (const s of PLOT_SLOTS) {
        m.compose(new THREE.Vector3(S.x + Math.sign(s.x - S.x) * lotX, 0, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot), new THREE.Vector3(SC, SC, SC)).premultiply(vp);
        for (const t of tris[levelOf(s.id)]) {
          const a = [];
          for (const p of t) {
            v.set(p.x, p.y, p.z, 1).applyMatrix4(m);
            if (v.w < 0.2) break; // beside or behind the camera: outside this narrow frame anyway
            a.push((v.x / v.w * 0.5 + 0.5) * GW, (0.5 - v.y / v.w * 0.5) * GH);
          }
          if (a.length < 6) continue;
          const [x0, y0, x1, y1, x2, y2] = a, area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
          if (Math.abs(area) < 1e-9) continue;
          const xa = Math.max(0, Math.floor(Math.min(x0, x1, x2))), xb = Math.min(GW - 1, Math.ceil(Math.max(x0, x1, x2)));
          const ya = Math.max(0, Math.floor(Math.min(y0, y1, y2))), yb = Math.min(GH - 1, Math.ceil(Math.max(y0, y1, y2)));
          for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
            const px = x + 0.5, py = y + 0.5;
            const e0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area, e1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
            if (e0 >= 0 && e1 >= 0 && e0 + e1 <= 1) mask[y * GW + x] = 1;
          }
        }
      }
      let n = 0;
      for (const b of mask) n += b;
      return (n / mask.length) * 100;
    };
    const MIX = [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 0, 1, 2, 4, 3, 0, 0];
    const table = [17, 15, 13].map((x) => [fill(x, () => 0), fill(x, (id) => MIX[id - 1]), fill(x, () => 4)]);
    // percent of the frame: all lots empty, a mix of levels, all towers
    for (const [row, want] of [[table[0], [1.0, 4.5, 9.6]], [table[1], [1.1, 4.8, 12.0]], [table[2], [1.6, 7.8, 15.4]]]) {
      row.forEach((got, i) => assert.ok(Math.abs(got - want[i]) < 0.15, `${row.map((n) => n.toFixed(2))} vs ${want}`));
    }
    // at the width as built the lots abreast of the walker and the next two pairs are outside the frame: the nearest
    // board whose centre is in it is 37 m ahead
    const half = Math.tan((portraitFov(aspect, 62) * Math.PI) / 360) * aspect; // tan of half the frame's width
    const faceX = S.lotX - LOT.faces[4].board.z * SC;
    const first = PLOT_SLOTS.map((s) => s.z - 300).filter((d) => d > 0 && faceX / (d + 8.4) < half).sort((a, b) => a - b)[0];
    assert.equal(first, 37);
  });

  it('the street with a mix of levels: 3 or 4 draw calls a lot, the models\' own triangle counts', () => {
    const MIX = [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 0, 1, 2, 4, 3, 0, 0];
    for (const s of PLOT_SLOTS) W.marks.applyPlot({ plot_id: s.id, level: MIX[s.id - 1], theme_color: '#ffcf5a', owner_name: MIX[s.id - 1] ? '테스트' : '' });
    let draws = 0, tris = 0;
    const geos = new Set();
    for (const rec of W.marks.plots.values()) for (const m of rec.body) { draws++; tris += m.geometry.index.count / 3; geos.add(m.geometry); }
    // six empty lots and three of each building: 6 x 3 + 3 x (4 + 4 + 3 + 3), 6 x 3478 + 3 x (4722 + 5698 + 5696 + 4772)
    assert.deepEqual([draws, tris], [60, 83532]);
    assert.equal(geos.size, 3 + 4 + 4 + 3 + 3); // seventeen geometries on the GPU for any street
  });

  it('an upgrade swaps the model: the new level\'s shared geometry, the lot\'s old accent material freed, nothing shared freed', () => {
    all(0, () => '#00ffcc');
    const freed = [];
    for (const level of LEVELS) {
      const prep = W.marks.lots.get(level);
      for (const [name, g] of prep.parts) g.addEventListener('dispose', () => freed.push(`geometry ${level} ${name}`));
      prep.gem?.geometry.addEventListener('dispose', () => freed.push('gem geometry'));
    }
    for (const [name, m] of Object.entries(W.marks.lots.mats)) m.addEventListener('dispose', () => freed.push('material ' + name));
    for (const [name, m] of Object.entries(W.kitMats)) m.addEventListener('dispose', () => freed.push('kit ' + name));
    const picks = () => W.pick.filter((o) => o.userData.pick?.kind === 'plot' && o.userData.pick.plotId === 5);
    const before0 = W.marks.plots.get(5);
    let res = W.marks.applyPlot({ plot_id: 5, level: 2, theme_color: '#39f58a', owner_name: '가게' });
    assert.deepEqual([res.changed, res.levelUp], [true, true]);
    let rec = W.marks.plots.get(5);
    assert.notEqual(rec, before0);
    assert.equal(inScene(before0.group, W.scene), false);
    assert.deepEqual(rec.body.map((m) => m.name), ['matte', 'metal', 'glow', 'accent']);
    for (const m of rec.body) assert.equal(m.geometry, W.marks.lots.get(2).parts.get(m.name));
    assert.equal(rec.gem, null);
    assert.equal(picks().length, 4 + 1);
    const accent2 = rec.body[3].material;
    let gone = 0;
    accent2.addEventListener('dispose', () => gone++);
    assert.equal(accent2.color.getHex(), 0x39f58a);
    // level 2 -> 4
    res = W.marks.applyPlot({ plot_id: 5, level: 4, theme_color: '#39f58a', owner_name: '가게' });
    assert.deepEqual([res.changed, res.levelUp], [true, true]);
    rec = W.marks.plots.get(5);
    assert.deepEqual(rec.body.map((m) => m.name), ['matte', 'glow', 'accent']);
    for (const m of rec.body) assert.equal(m.geometry, W.marks.lots.get(4).parts.get(m.name));
    assert.equal(gone, 1);
    assert.equal(picks().length, 3 + 1);
    assert.equal(W.colliders.filter((c) => c.plot === 5).length, 1);
    assert.equal(W.blockers.filter((b) => b.plot === 5).length, 1);
    // a new colour at the same level: a new accent material, the same geometry
    const a4 = rec.body[2].material;
    res = W.marks.applyPlot({ plot_id: 5, level: 4, theme_color: '#b84dff', owner_name: '가게' });
    assert.equal(res.changed, true);
    rec = W.marks.plots.get(5);
    assert.notEqual(rec.body[2].material, a4);
    assert.equal(rec.body[2].material.color.getHex(), 0xb84dff);
    // nothing changed: nothing rebuilt
    assert.equal(W.marks.applyPlot({ plot_id: 5, level: 4, theme_color: '#b84dff', owner_name: '가게' }).changed, false);
    assert.equal(W.marks.plots.get(5), rec);
    // back to an empty lot: its gem is back, its collider and blocker are gone
    W.marks.applyPlot({ plot_id: 5, level: 0, theme_color: '#00ffcc', owner_name: '' });
    rec = W.marks.plots.get(5);
    assert.deepEqual(rec.body.map((m) => m.name), ['matte', 'glow', 'gem']);
    assert.equal(W.colliders.filter((c) => c.plot === 5).length + W.blockers.filter((b) => b.plot === 5).length, 0);
    assert.deepEqual(freed, []);
    for (const o of W.pick) assert.ok(inScene(o, W.scene), o.name);
    assert.equal(picks().length, 3 + 1);
  });

  it('the name sign can be seen from the street at every level; on the tower\'s crown it could not', () => {
    // Rays from a walker's camera height to 45 points of the sign, through everything the lots draw (models, boards and
    // their frames). `share` is how many arrive. From the far side of the street every sign is in full view but the
    // shop's, whose lower edge the board's rim covers; from the centre line the shop's sign loses its lower third.
    const visible = (level) => {
      all(level);
      const solid = [];
      for (const rec of W.marks.plots.values()) rec.group.traverse((o) => { if (o.isMesh && o.visible && o.material.visible !== false && !o.material.transparent) solid.push(o); });
      const ray = new THREE.Raycaster(), out = {};
      for (const [name, off] of [['centre', 0], ['far', S.half - 0.5]]) {
        let got = 0, n = 0;
        for (const id of [9, 10]) {
          const s = PLOT_SLOTS[id - 1], rec = W.marks.plots.get(id), toStreet = Math.sign(S.x - s.x);
          const eye = new THREE.Vector3(S.x + toStreet * off, 3.15, s.z);
          for (let u = -0.45; u <= 0.451; u += 0.225) for (let v = -0.45; v <= 0.451; v += 0.1125) {
            const p = rec.sign.localToWorld(new THREE.Vector3(u * rec.signSpec.w, v * rec.signSpec.h, 0));
            const d = p.clone().sub(eye), len = d.length();
            ray.set(eye, d.divideScalar(len));
            const hit = ray.intersectObjects(solid, false)[0];
            n++;
            if (!hit || hit.distance > len - 0.02) got++;
          }
        }
        out[name] = Math.round((got / n) * 100);
      }
      return out;
    };
    const seen = LEVELS.map(visible);
    assert.deepEqual(seen.map((s) => s.far), [100, 100, 100, 89, 100]);
    assert.deepEqual(seen.map((s) => s.centre), [100, 100, 100, 67, 100]);
    // The same count for the tower's sign on the model's own plate (y 16.3, z 1.2): the board, 2.2 m before it and as
    // high, hides all of it from anywhere in the street. That is why the game stands the sign on the board's rim.
    all(4);
    for (const id of [9, 10]) { const rec = W.marks.plots.get(id); rec.sign.position.set(0, 16.3, 1.2); rec.signSpec = { ...rec.signSpec, y: 16.3, z: 1.2 }; }
    W.scene.updateMatrixWorld(true);
    const solid = [];
    for (const rec of W.marks.plots.values()) rec.group.traverse((o) => { if (o.isMesh && o.visible && o.material.visible !== false && !o.material.transparent) solid.push(o); });
    const ray = new THREE.Raycaster();
    let got = 0, n = 0;
    for (const off of [0, S.half - 0.5]) for (const id of [9, 10]) {
      const s = PLOT_SLOTS[id - 1], rec = W.marks.plots.get(id), toStreet = Math.sign(S.x - s.x);
      const eye = new THREE.Vector3(S.x + toStreet * off, 3.15, s.z);
      for (let u = -0.45; u <= 0.451; u += 0.225) for (let v = -0.45; v <= 0.451; v += 0.1125) {
        const p = rec.sign.localToWorld(new THREE.Vector3(u * 6.2, v * 0.9, 0));
        const d = p.clone().sub(eye), len = d.length();
        ray.set(eye, d.divideScalar(len));
        const hit = ray.intersectObjects(solid, false)[0];
        n++;
        if (!hit || hit.distance > len - 0.02) got++;
      }
    }
    assert.deepEqual([got, n], [0, 180]);
    all(0, () => '#00ffcc'); // leaves the street as it found it
  });
});

describe('when a lot model does not arrive, the boxes stay', () => {
  it('every file fails: every lot keeps its box building at every level, nothing throws, nothing is asked for twice', async () => {
    const calls = [];
    const W = await buildWorld({ loadGlb: (url) => { calls.push(url); return Promise.reject(new Error('offline')); } });
    const said = await quiet(async () => { W.marks.update(0.016, 0, NEAR); await W.marks.lots.settled(); });
    assert.equal(calls.length, 5);
    assert.equal(said.length, 5);
    for (const url of Object.values(LOT_MODEL_URL)) assert.ok(said.some((line) => line.includes(url) && line.includes('offline')), url);
    assert.deepEqual([...W.marks.lots.missing].sort(), LEVELS);
    for (const level of LEVELS) {
      for (const s of PLOT_SLOTS) W.marks.applyPlot({ plot_id: s.id, level, theme_color: '#ff3d9a', owner_name: level ? '테스트' : '' });
      for (const rec of W.marks.plots.values()) {
        assert.ok(isBox(rec), `lot ${rec.id}@${level}`);
        for (const m of bodyMeshes(rec)) assert.deepEqual(m.userData.pick, { kind: 'plot', plotId: rec.id });
        assert.equal(!!rec.gem, level === 0);
      }
      assert.equal(W.colliders.filter((c) => c.plot).length, level ? 18 : 0);
      W.marks.update(0.016, level, NEAR);
    }
    assert.equal(calls.length, 5);
    // the box gem still turns
    for (const s of PLOT_SLOTS) W.marks.applyPlot({ plot_id: s.id, level: 0, theme_color: '#00ffcc', owner_name: '' });
    W.marks.update(0.5, 1, NEAR);
    near(W.marks.plots.get(3).gem.rotation.y, 1.4);
  });
  it('a loader that throws outright is a failed file like any other', async () => {
    const W = await buildWorld({ loadGlb: () => { throw new Error('no fetch here'); } });
    const said = await quiet(async () => { W.marks.update(0.016, 0, NEAR); await W.marks.lots.settled(); });
    assert.equal(said.length, 5);
    assert.equal(W.marks.lots.missing.size, 5);
    for (const rec of W.marks.plots.values()) assert.ok(isBox(rec));
  });
  it('one file fails: that level keeps its boxes, the other four show their models', async () => {
    const disk = await diskLoader();
    const W = await buildWorld({ loadGlb: (url) => (url === LOT_MODEL_URL[2] ? Promise.reject(new Error('404')) : disk.loadGlb(url)) });
    const said = await quiet(async () => { W.marks.update(0.016, 0, NEAR); await W.marks.lots.settled(); });
    assert.equal(said.length, 1);
    assert.deepEqual([...W.marks.lots.missing], [2]);
    for (const level of LEVELS) {
      for (const s of PLOT_SLOTS) W.marks.applyPlot({ plot_id: s.id, level, theme_color: '#ff3d9a', owner_name: level ? '테스트' : '' });
      for (const rec of W.marks.plots.values()) assert.ok(level === 2 ? isBox(rec) : isModel(rec), `lot ${rec.id}@${level}`);
    }
  });
  it('a file that is not the model this build expects (its board mount elsewhere) is turned down', async () => {
    // level 1's URL answers with the shop's file: a stale or mixed-up copy
    const disk = await diskLoader((url) => (url === LOT_MODEL_URL[1] ? LOT_MODEL_URL[3] : url));
    const W = await buildWorld({ loadGlb: disk.loadGlb });
    const said = await quiet(async () => { W.marks.update(0.016, 0, NEAR); await W.marks.lots.settled(); });
    assert.equal(said.length, 1);
    assert.ok(said[0].includes(LOT_MODEL_URL[1]) && said[0].includes('not the model this build expects'));
    assert.deepEqual([...W.marks.lots.missing], [1]);
    assert.equal(W.marks.lots.get(1), null);
    for (const s of PLOT_SLOTS) W.marks.applyPlot({ plot_id: s.id, level: 1, theme_color: '#ff3d9a', owner_name: '테스트' });
    for (const rec of W.marks.plots.values()) assert.ok(isBox(rec));
  });
  it('files that arrive after a lot changed level dress the lot as it is then, and leave a replaced lot alone', async () => {
    const disk = await diskLoader(), held = [];
    const W = await buildWorld({ loadGlb: (url) => new Promise((resolve, reject) => { held.push(() => disk.loadGlb(url).then(resolve, reject)); }) });
    W.marks.update(0.016, 0, NEAR);
    assert.equal(held.length, 5);
    const old = W.marks.plots.get(4);
    W.marks.applyPlot({ plot_id: 4, level: 3, theme_color: '#ffcf5a', owner_name: '테스트' }); // while the files are on their way
    assert.ok(isBox(W.marks.plots.get(4)));
    for (const go of held) go();
    await W.marks.lots.settled();
    const rec = W.marks.plots.get(4);
    assert.ok(isModel(rec));
    assert.deepEqual(rec.body.map((m) => m.name), ['matte', 'glow', 'accent']);
    assert.equal(rec.body[0].geometry, W.marks.lots.get(3).parts.get('matte'));
    assert.equal(old.body, null); // the replaced lot was undressed with its group and stays so
    assert.equal(inScene(old.group, W.scene), false);
    for (const o of W.pick) assert.ok(inScene(o, W.scene), o.name);
  });
  it('the phone tier builds the same', async () => {
    const disk = await diskLoader();
    const W = await buildWorld({ loadGlb: disk.loadGlb, quality: 'low' });
    W.marks.update(0.016, 0, NEAR);
    await W.marks.lots.settled();
    for (const rec of W.marks.plots.values()) assert.deepEqual(rec.body.map((m) => m.name), ['matte', 'glow', 'gem']);
  });
});

// ---- the level pictures ----------------------------------------------------------------------------------------------
describe('the level pictures are renders of the same models', () => {
  const ICONS = ['lot', 'tent', 'pocha', 'shop', 'tower'];
  /** Width and height from a JPEG's frame header. */
  function jpegSize(buf) {
    assert.deepEqual([buf[0], buf[1]], [0xff, 0xd8]);
    for (let i = 2; i < buf.length - 9;) {
      assert.equal(buf[i], 0xff);
      const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xc2) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
      i += 2 + len;
    }
    return null;
  }
  it('icons/lot.jpg, tent.jpg, pocha.jpg, shop.jpg and tower.jpg: 256 x 256 JPEG, under 20 KB each', () => {
    for (const n of ICONS) {
      const b = readFileSync(new URL(`../icons/${n}.jpg`, import.meta.url));
      assert.deepEqual(jpegSize(b), [256, 256], n);
      assert.ok(b.length > 8_500 && b.length < 20_000, `${n} ${b.length}`); // the pictures before these renders were 6 to 8.5 KB
    }
  });
  it('ui.js asks for them with ?v=2, so nobody keeps the old pictures', () => {
    const ui = read('ui.js');
    const want = [['lot', '빈 땅'], ['tent', '텐트'], ['pocha', '포차'], ['shop', '네온상가'], ['tower', '타워']].map(([n, t]) => `  { src: 'icons/${n}.jpg?v=2', t: '${t}' },`).join('\n');
    assert.ok(ui.includes(`const LEVELS = [\n${want}\n];`));
    assert.equal(/icons\/(lot|tent|pocha|shop|tower)\.jpg'/.test(ui), false); // none without the query
    // the load plan still files them under `later` (the query is not part of the file name)
    const rows = loadBudget({ quality: 'low' }).rows.filter((x) => /^icons\/(lot|tent|pocha|shop|tower)\.jpg$/.test(x.file));
    assert.deepEqual(rows.map((x) => x.phase), ['later', 'later', 'later', 'later', 'later']);
  });
  it('tools/blender/render_props.py draws them with the stand-in screen off (dark navy, at most 12% bright) and the tower\'s sign where the game puts it', () => {
    const py = read('tools/blender/render_props.py');
    const m = py.match(/^ICON_SCREEN = \("(#[0-9a-f]{6})", "(#[0-9a-f]{6})"\)/m);
    assert.ok(m, 'ICON_SCREEN');
    for (const hex of [m[1], m[2]]) {
      const c = new THREE.Color(hex), [r, g, b] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)].map((v) => v / 255);
      assert.ok(0.2126 * r + 0.7152 * g + 0.0722 * b <= 0.12, hex);
      assert.ok(b > r && b > g, hex); // navy
      assert.ok(c.b > c.r);
    }
    assert.match(py, /icon = shot\(32\.0, ICON_PITCH\[name\], 256, 0\.03, name \+ "_icon\.png", pts=box, screen=False, lift=0\.5\)/);
    assert.match(py, /OLD_ICON = dict\(lot0_empty="lot\.jpg", lot1_tent="tent\.jpg", lot2_pocha="pocha\.jpg", lot3_shop="shop\.jpg", lot4_tower="tower\.jpg"\)/);
    const at = py.match(/^SIGN_AT = dict\(lot4_tower=\(([\d.]+), ([\d.]+), ([\d.]+)\)\)/m);
    assert.ok(at, 'SIGN_AT');
    const sign = LOT.faces[4].sign;
    assert.deepEqual(at.slice(1).map(Number), [sign.x, sign.y, sign.z]);
  });
});
