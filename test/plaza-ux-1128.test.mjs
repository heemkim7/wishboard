// The plaza pass of 2026-11-28 (the owner on a phone: "항목이 많아서 어렵다", "색상을 바로 보기 어렵고 스크롤해야 한다",
// "유료옵션은 숨겨줘 일단"): the board sheet's first screen, the wizard's 배경, the hidden paid options, 메뉴 모두 보기 in ⋯.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { paidAds } from '../overlay.js';
import { adView } from '../adsale.js';
import { claimWizard } from '../ftue.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const ui = read('ui.js'), html = read('index.html'), main = read('main.js'), net = read('net.js');

describe('paid options are hidden unless PAY_ON', () => {
  const ads = { on: 1, list: [] };
  it('no house ad without pay: an empty ad screen is the plain city screen', () => {
    assert.equal(adView(paidAds(ads, false), 'AD_1', Date.now()).kind, 'city');
    assert.equal(adView(paidAds(undefined, false), 'AD_1', Date.now()).kind, 'city');
  });
  it('with PAY_ON nothing changes (gated, not deleted)', () => {
    assert.equal(paidAds(ads, true), ads);
    assert.equal(adView(paidAds(ads, true), 'AD_1', Date.now()).kind, 'house');
  });
  it('a booked ad keeps its list (content, not an offer)', () => {
    const v = paidAds({ on: 1, list: [{ id: 'x' }] }, false);
    assert.deepEqual(v.list, [{ id: 'x' }]);
    assert.equal(v.on, 0);
  });
  it('net.js reads PAY_ON from /rt/config; main.js applies it to the ad screens and the UI', () => {
    assert.match(net, /this\.payOn = j\?\.pay\?\.on === true;/);
    assert.match(main, /world\.setAds\?\.\(paidAds\(remote\.ads, net\.payOn\)\)/);
    assert.match(main, /ui\.setPaid\?\.\(net\.payOn\); if \(lastAds !== undefined\) world\?\.setAds\?\.\(paidAds\(lastAds, net\.payOn\)\)/);
    assert.doesNotMatch(main, /world\.setAds\?\.\(remote\.ads\)/);
  });
  it('the support sheet links the ad page only with PAY_ON, and nothing paid shows before the config is known', () => {
    assert.match(ui, /adsLine\.hidden = id !== 'ads' \|\| !paidOn;/);
    assert.match(ui, /let paidOn = false;/);
    assert.match(ui, /setPaid\(on\) \{ paidOn = !!on; \}/);
  });
  it('the plaza names the video one way: 축하 영상', () => {
    assert.doesNotMatch(read('gift.js'), /15초 축하 영상이 나왔어요/);
    assert.match(read('gift.js'), /🎬 축하 영상이 나왔어요/);
  });
});

describe('board sheet: preview, lines, colours and 걸기 on the first screen', () => {
  const start = ui.indexOf("host.append(h('div', { class: 'grid2 bb' },");
  const block = ui.slice(start, ui.indexOf("showZone(zone && zone !== 'tower'", start));
  it('the preview and slot picker are one block, 걸기 its own, the lines and colours the main block', () => {
    assert.match(block, /h\('div', \{ class: 'bb-look' \}, h\('div', \{ class: 'screen' \}, canvas\), pick\),\s*h\('div', \{ class: 'bb-right' \},/);
    assert.match(block, /class: 'bb-main' \},[\s\S]*\.\.\.lines\), linesErr,[\s\S]*class: 'bb-style' \},\s*themes,\s*inks\)\),\s*h\('div', \{ class: 'bb-go' \}, relightBtn, go, balance, goErr, bidIn\),\s*h\('div', \{ class: 'bb-rest' \},/);
  });
  it('배경 and 글자색 are no longer folded away; emoji, link and the gift mode are', () => {
    const more = ui.slice(ui.indexOf("const more = h('details', { class: 'more bb-more' },"), ui.indexOf("go.addEventListener('click', () => placeBoard('claim'));"));
    assert.doesNotMatch(more, /themes|inks/);
    assert.match(more, /wishBtn, giftBtn/);
    assert.match(more, /urlField/);
  });
  it('slot tabs, place card and numbers, and the photo ad with stickers are folded', () => {
    assert.match(block, /class: 'more bb-place' \},\s*h\('summary'[^)]*\),\s*pickNote, tipsEl, seg, placeEl,/);
    assert.match(block, /class: 'more bb-photo' \},[\s\S]*photoBox, capRow, photoFile,[\s\S]*stickerBox/);
  });
  it('index.html: the preview sticks to the top, 걸기 to the bottom; upright it is one column', () => {
    assert.match(html, /\.sheet\.bill \.bb-look \{ position: sticky; top: 0; z-index: 3; \}/);
    assert.match(html, /\.sheet\.bill \.bb-go \{ position: sticky; bottom: 0; z-index: 2;/);
    const q = html.slice(html.indexOf('@media (max-width: 900px) and (min-height: 521px) {\r\n    .sheet.bill .grid2.bb { display: flex'));
    assert.ok(q.length > 0);
    assert.match(q.slice(0, q.indexOf('\n  }')), /\.sheet\.bill \.grid2\.bb \{ display: flex; flex-direction: column;/);
  });
  it('index.html: the theme row scrolls sideways in the sheet and the wizard', () => {
    assert.match(html, /\.sheet :is\(\.bb-style, \.wiz-style\) \.themes \{ display: flex; flex-wrap: nowrap;/);
  });
});

describe('claim wizard: 배경 on step 2', () => {
  it('the model keeps a picked theme and refuses a gift theme or an unknown one', () => {
    const THEMES = { cyber_navy: {}, neon_pink: {}, bday_party: { gift: true } };
    const m = claimWizard('STREET_1');
    assert.equal(m.theme, 'cyber_navy');
    m.setTheme('neon_pink', THEMES);
    assert.equal(m.payload().bg_theme, 'neon_pink');
    m.setTheme('bday_party', THEMES);
    m.setTheme('nope', THEMES);
    assert.equal(m.payload().bg_theme, 'neon_pink');
  });
  it('step 2 shows the non-gift themes right under the lines and repaints the preview', () => {
    const s2 = ui.slice(ui.indexOf('} else if (n === 2) {'), ui.indexOf('const linkIn = h(', ui.indexOf('} else if (n === 2) {')));
    assert.match(s2, /if \(th\.gift\) continue;/);
    assert.match(s2, /model\.setTheme\(key, THEMES\);[\s\S]*paint\(\);/);
    assert.match(s2, /h\('div', \{ class: 'wiz-style' \}, themeRow\)/);
    assert.doesNotMatch(s2, /전광판에는 이렇게 보여요/); // the preview and the 0/16 counts say it
  });
});

describe('메뉴 모두 보기 is in the ⋯ menu on touch', () => {
  it('a .tool-grad row before ⋯ that graduates and closes the menu; the floating copy is hidden on touch', () => {
    assert.match(ui, /class: 'btn icon tool-more tool-grad', type: 'button', 'aria-label': '메뉴 모두 보기'[^\n]*onclick: \(\) => \{ foldTools\(false\); graduate\(\); \}/);
    assert.match(html, /html\.touch #ui\.newbie \.hud-l > \.newbie-more \{ display: none; \}/);
    assert.match(html, /html\.touch #ui\.newbie \.tools\.open \.tool-grad \{ display: inline-flex !important; \}/);
  });
});
