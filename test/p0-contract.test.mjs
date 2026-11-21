import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

describe('phase 0 contracts', () => {
  it('keeps the play-bug fixes', () => {
    const ui = read('ui.js');
    const main = read('main.js');
    const world = read('timesSquare3d.js');
    assert.match(ui, /boost:\s*\(\)\s*=>\s*tone\(/);
    assert.match(main, /onBoost:\s*\(\)\s*=>\s*ui\.sfx\.boost\(\)/);
    assert.match(ui, /function openLogin\([\s\S]*const copy = h\('button'/);
    assert.match(ui, /handoverUrl/);
    assert.match(ui, /function payDue\(/);
    assert.match(ui, /function pumpLink\(/);
    assert.match(ui, /sponsorEl\.hidden && !hooks\.cineOn\?\.\(\)/);
    // 멍때리기 no longer moves the avatar (it used to teleport to -21, -112): only the camera tours the boards.
    const lounge = world.slice(world.indexOf('startLounge() {'), world.indexOf('stopLounge() {'));
    assert.ok(lounge.length > 0);
    assert.equal(/teleport\(/.test(lounge), false);
    assert.match(world, /function tourNext\(\)/);
    assert.match(world, /teleport\(x, z\)/);
    const load = ui.slice(ui.indexOf('function loadDay'), ui.indexOf('function payDue'));
    assert.match(load, /fare:/);
    assert.match(load, /stunt:/);
    assert.match(load, /qPaid:/);
  });

  it('keeps honesty, bots, boot counts, and the socket resync', () => {
    const main = read('main.js');
    const balance = read('balance.js');
    const bots = read('tools/plaza-bots.mjs');
    const screens = read('ts3d/screens.js');
    assert.equal(main.includes('fillRivals'), false);
    assert.equal(balance.includes('rival:'), false);
    assert.match(main, /function paintBootLive/);
    assert.match(main, /오늘 다녀간 사람/);
    assert.match(main, /오늘 걸린 소원/);
    assert.match(main, /function resync\(\)/);
    assert.match(main, /if \(net\.status !== 'online' && !document\.hidden\) resync\(\); \}, 60000\)/);
    assert.match(bots, /chapelqa:square/);
    assert.match(bots, /localhost:8787/);
    assert.equal(bots.includes('wishboard.workers.dev'), false);
    assert.match(screens, /function defaultData/);
    assert.match(screens, /holder_id: null/);
  });

  it('keeps the server guards and does not set PLAN=paid', () => {
    const worker = read('worker.js');
    const wrangler = read('wrangler.jsonc');
    const account = read('plaza-account.js');
    assert.match(worker, /AD_PAY = 15, AD_DAY = 5/);
    assert.match(worker, /attend: \[30, 0, 1\], mission: \[15, 0, 3\]/);
    assert.match(worker, /pouch: \[30, 25000\]/);
    assert.match(worker, /pathname === '\/rt\/handover'/);
    assert.match(worker, /GUEST_RL/);
    assert.match(wrangler, /"name": "GUEST_RL"/);
    assert.match(wrangler, /"limit": 10, "period": 60/);
    assert.match(wrangler, /"name": "EVENT_RL"/);
    assert.equal(wrangler.includes('"PLAN"'), false);
    assert.match(account, /page_landing/);
    assert.match(account, /first_coin/);
    assert.match(account, /session_end/);
    assert.equal(worker.includes("PLAN === 'paid' ?"), true);
  });
});
