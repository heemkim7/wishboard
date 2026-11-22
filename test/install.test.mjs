// 중4 홈 화면 추가 유도: install.js rules, and that ui.js / index.html wire them the way the rules need.
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { A2HS_KEY, VISITS_KEY, MIN_VISITS, MIN_PLAY_MS, bumpVisits, isStandalone, isIosSafari, installMode, meaningful, installDue, INSTALL_COPY } from '../install.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const ev = { prompt() {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) };
const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
  iphoneKakao: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.9.0',
  iphoneInsta: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 340.0.0.0',
  ipadSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
};

describe('visit counting', () => {
  it('counts KST days, not page loads', () => {
    let v = bumpVisits(null, '2026-11-22');
    assert.deepEqual(v, { n: 1, last: '2026-11-22' });
    v = bumpVisits(v, '2026-11-22'); assert.equal(v.n, 1, 'a reload is not a second visit');
    v = bumpVisits(v, '2026-11-23'); assert.deepEqual(v, { n: 2, last: '2026-11-23' });
    assert.equal(bumpVisits(v, '2026-11-23').n, 2);
    assert.equal(bumpVisits(v, '2026-11-25').n, 3);
  });
  it('survives junk: a bad record starts over, a bad day changes nothing', () => {
    for (const bad of [undefined, 'x', 7, [], { n: 'many' }, { n: -4 }]) assert.equal(bumpVisits(bad, '2026-11-22').n, 1, JSON.stringify(bad));
    assert.deepEqual(bumpVisits({ n: 3, last: '2026-11-20' }, 'not a day'), { n: 3, last: '2026-11-20' });
    assert.equal(bumpVisits({ n: 123456, last: 'a' }, '2026-11-22').n <= 10000, true);
  });
});

describe('installed already', () => {
  const win = (o = {}) => ({ navigator: { standalone: o.nav }, matchMedia: (q) => ({ matches: !!(o.modes || []).find((m) => q === `(display-mode: ${m})`) }) });
  it('is standalone by iOS navigator.standalone or a display-mode query, never by a plain tab', () => {
    assert.equal(isStandalone(win({ nav: true })), true);
    assert.equal(isStandalone(win({ modes: ['standalone'] })), true);
    assert.equal(isStandalone(win({ modes: ['fullscreen'] })), true);
    assert.equal(isStandalone(win({ modes: ['minimal-ui'] })), true);
    assert.equal(isStandalone(win({ modes: ['browser'] })), false);
    assert.equal(isStandalone(win({ nav: false })), false);
    assert.equal(isStandalone(null), false);
    assert.equal(isStandalone({ navigator: {}, matchMedia() { throw new Error('no'); } }), false);
  });
});

describe('iOS Safari detection', () => {
  it('is Safari on iPhone and iPad only', () => {
    assert.equal(isIosSafari(UA.iphoneSafari, 5), true);
    assert.equal(isIosSafari(UA.ipadSafari, 5), true, 'iPadOS says Macintosh but has touch points');
    assert.equal(isIosSafari(UA.macSafari, 0), false, 'a Mac has no home screen');
    assert.equal(isIosSafari(UA.androidChrome, 5), false);
    for (const k of ['iphoneChrome', 'iphoneKakao', 'iphoneInsta']) assert.equal(isIosSafari(UA[k], 5), false, k + ' has its own share menu');
    assert.equal(isIosSafari('', 0), false);
  });
});

describe('what to offer', () => {
  it('prompt with a captured event, ios steps without one, nothing when installed or when there is no way', () => {
    assert.equal(installMode({ event: ev, ios: false }), 'prompt');
    assert.equal(installMode({ event: ev, ios: true }), 'prompt');
    assert.equal(installMode({ event: null, ios: true }), 'ios');
    assert.equal(installMode({ event: null, ios: false }), '');
    assert.equal(installMode({ event: {}, ios: false }), '', 'an event that cannot prompt is none');
    assert.equal(installMode({ standalone: true, event: ev, ios: true }), '', 'never in an installed app');
    assert.equal(installMode(), '');
  });
});

describe('when the card is due', () => {
  const ok = { mode: 'prompt', done: 0, visits: { n: 2 }, act: { wish: true }, playMs: 0, busy: false, newbie: false };
  it('needs the 2nd visit day, something meaningful, and a quiet screen', () => {
    assert.equal(installDue(ok), true);
    assert.equal(installDue({ ...ok, visits: { n: 1 } }), false, 'the first visit never');
    assert.equal(installDue({ ...ok, visits: null }), false);
    assert.equal(installDue({ ...ok, visits: { n: MIN_VISITS } }), true);
    assert.equal(installDue({ ...ok, visits: { n: 9 } }), true);
    assert.equal(installDue({ ...ok, act: {}, playMs: 0 }), false, 'nothing done yet');
    assert.equal(installDue({ ...ok, act: {}, playMs: MIN_PLAY_MS - 1 }), false);
    assert.equal(installDue({ ...ok, act: {}, playMs: MIN_PLAY_MS }), true, '3 minutes in the plaza');
    assert.equal(installDue({ ...ok, act: { claim: true } }), true);
    assert.equal(installDue({ ...ok, act: { wish: true } }), true);
  });
  it('is once ever: a stored kts_a2hs ends it, whatever the player answered', () => {
    assert.equal(installDue({ ...ok, done: Date.now() }), false);
    assert.equal(installDue({ ...ok, done: 1 }), false);
  });
  it('never over a sheet or a celebration (busy), for a newcomer, in a standalone app, or with no way to install', () => {
    assert.equal(installDue({ ...ok, busy: true }), false);
    assert.equal(installDue({ ...ok, newbie: true }), false);
    assert.equal(installDue({ ...ok, mode: installMode({ standalone: true, event: ev, ios: true }) }), false);
    assert.equal(installDue({ ...ok, mode: '' }), false);
  });
  it('the iOS hint follows the same rules (once, 2nd visit, meaningful)', () => {
    const ios = { ...ok, mode: 'ios' };
    assert.equal(installDue(ios), true);
    assert.equal(installDue({ ...ios, visits: { n: 1 } }), false);
    assert.equal(installDue({ ...ios, done: 1 }), false);
    assert.equal(meaningful({ playMs: 5 }), false);
  });
  it('says what the task asked', () => {
    assert.equal(INSTALL_COPY.title, '홈 화면에 추가하면 바로 들어올 수 있어요');
    assert.equal(INSTALL_COPY.add, '추가'); assert.equal(INSTALL_COPY.later, '나중에');
    assert.equal(INSTALL_COPY.iosSteps.length, 3);
    assert.ok(INSTALL_COPY.iosSteps.some((s) => s.includes('홈 화면에 추가')) && INSTALL_COPY.iosSteps[0].includes('공유'));
  });
});

describe('wiring (ui.js, index.html)', () => {
  const ui = read('ui.js'), html = read('index.html');
  const block = ui.slice(ui.indexOf('// ---- 홈 화면 추가 (install.js)'), ui.indexOf('// ---- 주간 돌아보기 (recap.js)'));
  it('index.html keeps the browser event early and marks an install as spent with the same key', () => {
    assert.match(html, /addEventListener\('beforeinstallprompt', \(e\) => \{ e\.preventDefault\(\); window\.__ktsInstall = e; \}\);/);
    assert.match(html, /addEventListener\('appinstalled'[^\n]*localStorage\.setItem\('kts_a2hs'/);
    assert.equal(A2HS_KEY, 'kts_a2hs'); assert.equal(VISITS_KEY, 'kts_visits');
  });
  it('the card waits for the screen: busy includes screenBusy (sheets, celebration, focus camera, bake, dance...) and the queued asks that came first', () => {
    assert.ok(block.length > 500);
    assert.match(block, /const homeBusy = \(\) => screenBusy\(\) \|\| !!awayWant \|\| !!pushQueued \|\| Date\.now\(\) < pushHoldUntil \|\| linkWant/);
    assert.match(block, /busy: busy|installDue\(\{[^}]*busy,/);
    assert.match(block, /a2hs\.el\.hidden = busy;/, 'a card already up steps aside when a sheet opens');
    assert.equal(/openSheet\(/.test(block), false, 'the card is not a sheet');
  });
  it('is spent when shown (once ever), not when answered', () => {
    const open = block.slice(block.indexOf('function openHome('), block.indexOf('function pumpHome('));
    assert.match(open, /store\(A2HS_KEY, Date\.now\(\)\)/);
    assert.match(open, /trackEvent\('install_prompt'/);
    assert.match(block, /installDue\(\{ mode, done: recall\(A2HS_KEY, 0\), visits: recall\(VISITS_KEY, null\)/);
    assert.match(block, /a2hs\.free < 3/, 'quiet for a few ticks before it appears');
  });
  it('"추가" uses the captured event once; the iOS card has steps and no native prompt', () => {
    const open = block.slice(block.indexOf('function openHome('), block.indexOf('function pumpHome('));
    assert.match(open, /const ev = window\.__ktsInstall;\s*window\.__ktsInstall = null;[\s\S]*?ev\.prompt\(\)/);
    assert.match(open, /mode === 'ios'/);
    assert.match(open, /INSTALL_COPY\.iosSteps/);
  });
  it('counts the visit day on entering, and a first wish or a claim is what makes it meaningful', () => {
    assert.match(ui, /store\(VISITS_KEY, bumpVisits\(recall\(VISITS_KEY, null\), d\.day\)\)/);
    assert.match(ui, /trackEvent\('wish_post'[^\n]*\n\s*a2hs\.act\.wish = true;/);
    assert.match(ui, /noteClaim\(\) \{ a2hs\.act\.claim = true;/);
    assert.match(read('main.js'), /if \(mode === 'starter' \|\| mode === 'claim'\) ui\.noteClaim\?\.\(\);/);
  });
  it('the event names are on the whitelist', async () => {
    const { EVENT_NAMES } = await import('../plaza-account.js');
    for (const n of ['install_prompt', 'week_recap']) assert.ok(EVENT_NAMES.includes(n), n);
  });
});
