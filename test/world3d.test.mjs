// Shader patches and per-frame costs of the 3D world. The world needs a browser to run, so these read the sources;
// the one thing checked against real code is that every shader chunk a patch replaces still exists in the vendored three.
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from '../vendor/three/build/three.module.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SOURCES = ['timesSquare3d.js', ...readdirSync(new URL('../ts3d/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => 'ts3d/' + f)];

describe('shader patches', () => {
  it('every #include a patch replaces is in the vendored three shader for that stage', () => {
    const libs = [THREE.ShaderLib.standard, THREE.ShaderLib.basic];
    let n = 0;
    for (const f of SOURCES) {
      const src = read(f);
      for (const t of src.matchAll(/\.replace\(\s*'(#include <[a-z_0-9]+>)'/g)) {
        const before = src.slice(0, t.index);
        const stage = before.lastIndexOf('sh.vertexShader =') > before.lastIndexOf('sh.fragmentShader =') ? 'vertexShader' : 'fragmentShader';
        assert.ok(libs.some((l) => l[stage].includes(t[1])), `${f}: ${stage} has no ${t[1]}`);
        n++;
      }
    }
    assert.ok(n >= 20, String(n));
  });
  it('the paver joints take their pixel footprint before the running-bond shift', () => {
    const g = read('ts3d/ground.js');
    const pc = g.indexOf('vec2 pc = vWxz / uPave.xy;'), pf = g.indexOf('vec2 pf = fwidth( pc );'), shift = g.indexOf('pc.x += uPave.w * 0.5 * floor( pc.y );');
    assert.ok(pc > 0 && pf > pc && shift > pf);
    // no normal-map code: none of the wet materials has a normal map
    assert.equal(/nonPerturbedNormal|normal_fragment_maps/.test(g), false);
    assert.equal(/normalMap/.test(read('ts3d/world.js')), false);
  });
  it('the star field cannot divide by zero', () => {
    const w = read('timesSquare3d.js');
    assert.match(w, /vec2 sp = floor\(d\.xz \/ max\(d\.y \+ 0\.05, 1e-3\) \* 420\.0\);/);
    assert.equal(/d\.xz \/ \(d\.y \+ 0\.05\)/.test(w), false);
  });
  it('only the bottom 3.6 m of a wall runs the storefront block, with its derivative taken outside the branch', () => {
    const w = read('ts3d/world.js');
    const sf = w.indexOf('float sf = street * (1.0 - smoothstep(3.45, 3.55, y));'), sw = w.indexOf('vec2 sw = max(fwidth(vFac), vec2(1e-4));'), br = w.indexOf('if (vFac.y < 3.6) {');
    assert.ok(sf > 0 && sw > sf && br > sw);
    // sf is zero from 3.55 m up and every result of the block is mixed in by sf, so the branch changes nothing above it
    const block = w.slice(br, w.indexOf("`)", br));
    for (const out of ['diffuseColor.rgb = mix(diffuseColor.rgb, mix(nearD, frame, sfFar), sf);', 'gEmit = mix(gEmit, mix(nearE, farE, sfFar), sf);', 'gRefl = mix(gRefl, glassM * (1.0 - shut) * (1.0 - sfFar), sf);']) assert.ok(block.includes(out), out);
    assert.equal((block.match(/\b(diffuseColor\.rgb|gEmit|gRefl) = /g) || []).length, 3);
    assert.ok(3.6 > 3.55);
    // vFac is the wall uv: metres along the wall and metres above the street
    assert.match(w, /vFac = uv;/);
    assert.match(w, /g\.v\(x1, mh, z1, nx, 0, nz, u, mh, col, style, seed, 0, fh\);/);
  });
});

describe('per-frame work', () => {
  it('the phone tier redraws the live strip on 3 boards every other tick, the others on 10 every tick', () => {
    const s = read('ts3d/screens.js');
    assert.match(s, /const LIVE_HOT = quality === 'low' \? 3 : 10, LIVE_EVERY = quality === 'low' \? 2 : 1;/);
    assert.match(s, /const draw = liveTick % LIVE_EVERY === 0;/);
    assert.match(s, /const hot = new Set\(near\.slice\(0, LIVE_HOT\)\.map\(\(r\) => r\.b\)\);/);
    assert.match(s, /if \(!draw \|\| !on \|\| b\.shared \|\| seen\.has\(b\.canvas\)\) continue;/);
    // the 0.08 s tick itself is unchanged, so the wish and king cadences (every 8th tick, kingBudget per tick) are too
    assert.match(s, /if \(liveAcc < 0\.08\) return;/);
    assert.match(s, /if \(liveTick % 8 === 0\) \{/);
  });
  it('dispose clears the context-loss timer', () => {
    const w = read('timesSquare3d.js');
    const d = w.slice(w.indexOf('function dispose() {'), w.indexOf('const projV'));
    assert.match(d, /clearTimeout\(ctxTimer\);/);
  });
  it('the tour comment says what a photo does to the lounge', () => {
    const w = read('timesSquare3d.js');
    const tour = w.slice(w.indexOf('function tourNext()'), w.indexOf('function taxiCanSit('));
    assert.equal(/waits for the next 8 s tick/.test(tour), false);
    assert.match(tour, /ends the lounge/);
    // and that is what the code does: endCine drops the lounge and tells main.js
    const end = w.slice(w.indexOf('function endCine('), w.indexOf('function focusSlot('));
    assert.match(end, /lounge = false;/);
    assert.match(end, /if \(wasLounge\) opts\.onLoungeEnd\?\.\(\);/);
  });
});

describe('dead 3D code is gone', () => {
  it('no unused painters, material branches or shared vacant canvas', () => {
    const art = read('ts3d/art.js');
    const all = SOURCES.map(read).join('\n') + read('ui.js') + read('main.js');
    for (const fn of ['paintTentPrint', 'paintStorefronts', 'paintWindows', 'paintManhole', 'paintLanes', 'paintCrosswalk', 'roadInk']) assert.equal(all.includes(fn), false, fn);
    // the painters that are used are still exported
    for (const fn of ['paintBillboard', 'paintGlow', 'paintBeam', 'paintPuddles', 'paintAdAtlas', 'paintLabel']) assert.match(art, new RegExp('export function ' + fn + '\\('), fn);
    const av = read('ts3d/avatars.js');
    assert.equal(/'Grey'|'Black'/.test(av), false);
    assert.match(av, /if \(m\.name === 'Main'\) \{ m\.metalness = 0; m\.roughness = 0\.6; \}/);
    const s = read('ts3d/screens.js');
    assert.equal(/vacantCanvas|vacantTex|vacantMat|ownCanvas|shared: true/.test(s), false);
  });
});
