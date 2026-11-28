// The phone's tap-through (2026-11-28, the owner: "전광판 걸기 누르면 바로 팝업 꺼짐"). The round touch button 걸기 opens the
// board sheet on pointerdown and a board tap in 3D opens it on pointerup; the click a phone sends after touchend then landed
// on the new sheet's backdrop and closed it. overlay.js createTapGuard / backdropClose and their wiring in ui.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createTapGuard, backdropClose, GHOST_MS } from '../overlay.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

function clock() { let t = 1000; return { now: () => t, step: (ms) => { t += ms; } }; }

describe('tap guard', () => {
  it('swallows the click of the tap that opened a sheet on pointerdown or pointerup', () => {
    const c = clock(), g = createTapGuard({ now: c.now });
    g.down(); c.step(60); g.opened(); c.step(40);
    assert.equal(g.click({ detail: 1 }), true);
  });
  it('lets the next tap through (one ghost per press)', () => {
    const c = clock(), g = createTapGuard({ now: c.now });
    g.down(); g.opened(); assert.equal(g.click({ detail: 1 }), true);
    c.step(500); g.down(); c.step(80); assert.equal(g.click({ detail: 1 }), false);
  });
  it('does not touch a click whose own handler opens the sheet (the HUD 전광판 걸기 button)', () => {
    const c = clock(), g = createTapGuard({ now: c.now });
    g.down(); c.step(80);
    assert.equal(g.click({ detail: 1 }), false); // let through first …
    g.opened(); // … then its handler opens the sheet
    c.step(400); g.down(); c.step(60);
    assert.equal(g.click({ detail: 1 }), false, 'the next tap on the sheet works');
  });
  it('never swallows a keyboard click (detail 0)', () => {
    const g = createTapGuard({ now: clock().now });
    g.down(); g.opened();
    assert.equal(g.click({ detail: 0 }), false);
  });
  it('forgets an old press: a click long after it is not a ghost', () => {
    const c = clock(), g = createTapGuard({ now: c.now });
    g.down(); g.opened(); c.step(GHOST_MS + 1);
    assert.equal(g.click({ detail: 1 }), false);
  });
  it('a click with no press before it (no pointerdown) is let through', () => {
    const g = createTapGuard({ now: clock().now });
    g.opened();
    assert.equal(g.click({ detail: 1 }), false);
  });
});

describe('backdrop', () => {
  const backdrop = {}, other = {};
  it('closes only when the press began on the backdrop', () => {
    assert.equal(backdropClose({ downOnBack: true, target: backdrop, backdrop }), true);
    assert.equal(backdropClose({ downOnBack: false, target: backdrop, backdrop }), false, 'the end of the tap that opened it');
    assert.equal(backdropClose({ downOnBack: true, target: other, backdrop }), false);
  });
});

describe('ui.js wiring', () => {
  const ui = read('ui.js');
  it('the guard sees every pointerdown and every click first (window, capture)', () => {
    assert.match(ui, /addEventListener\('pointerdown', \(\) => tapGuard\.down\(\), \{ passive: true, capture: true \}\)/);
    assert.match(ui, /addEventListener\('click', \(e\) => \{ if \(tapGuard\.click\(e\)\) \{ e\.preventDefault\(\); e\.stopImmediatePropagation\(\); \} \}, true\)/);
    // declared before any sheet can open (openSheet is hoisted)
    assert.ok(ui.indexOf('const tapGuard = createTapGuard()') < ui.indexOf('function openSheet('));
    assert.ok(ui.indexOf('const tapGuard = createTapGuard()') < ui.indexOf("root.append(h('div', { class: 'hud-r' }"));
  });
  it('a sheet, the far board card, the ad card and a layer report that they opened', () => {
    const body = (name) => { const i = ui.indexOf(`function ${name}(`); return ui.slice(i, ui.indexOf('\n  }\n', i) > 0 ? ui.indexOf('\n  }\n', i) : ui.indexOf('\n  }\r\n', i)); };
    for (const fn of ['openSheet', 'showFarCard', 'showAdCard']) assert.match(body(fn), /tapGuard\.opened\(\)/, fn);
    assert.match(ui, /layer\(el, close\) \{ if \(el && dance\) endDance\('layer'\); layer\(el, close\); if \(el\) tapGuard\.opened\(\); \}/);
  });
  it('the backdrop closes through backdropClose with a press that began on it', () => {
    assert.match(ui, /el\.addEventListener\('pointerdown', \(e\) => \{ me\.downOnBack = e\.target === el; \}\)/);
    assert.match(ui, /backdropClose\(\{ downOnBack: me\.downOnBack, target: e\.target, backdrop: el \}\)/);
    assert.doesNotMatch(ui, /if \(e\.target === el\) backdropTap\(me\)/);
  });
  it('the round touch button still acts on pointerdown (the ghost it leaves is the guard\'s)', () => {
    assert.match(ui, /class: 'act big'[^\n]*onpointerdown: tap\(\(\) => hooks\.interact\(\)\)/);
  });
});
