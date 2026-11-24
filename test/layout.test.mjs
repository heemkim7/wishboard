// The HUD stylesheet in index.html: places where two things used to lie on each other. The numbers are worked out from
// the rules themselves (a browser is not available to the tests), so each case names the viewport and the two boxes.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COMPACT_HUD_Q, STICK_H } from '../interact.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');
const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
/** The body of an @media block whose query is exactly `query`, and which holds `has`. */
function media(query, has) {
  let at = 0;
  for (;;) {
    const i = css.indexOf('@media ' + query + ' {', at);
    assert.ok(i >= 0, 'no @media ' + query + ' with ' + has);
    let depth = 0, j = css.indexOf('{', i);
    const start = j + 1;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}' && --depth === 0) break;
    }
    const body = css.slice(start, j);
    if (body.includes(has)) return body;
    at = j;
  }
}
/** Declarations of the rule `selector { ... }` inside `scope` (the first one). */
function rule(scope, selector) {
  const m = scope.match(new RegExp('(^|[}\\n])\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}'));
  assert.ok(m, 'no rule ' + selector);
  return m[2];
}
const px = (decls, prop) => Number(decls.match(new RegExp('(?:^|[;\\s])' + prop + ': (?:calc\\()?(-?[\\d.]+)px'))[1]);

describe('far-tap card and proof bar take their own taps', () => {
  it('the card\'s buttons are .far-acts: a row with pointer events, 44px targets on touch, and no .acts rule can match it', () => {
    const acts = rule(css, '.farcard .far-acts');
    assert.match(acts, /display: flex;/);
    assert.match(acts, /flex-direction: row;/);
    assert.match(acts, /pointer-events: auto;/);
    const touch = rule(css, 'html.touch .farcard .far-acts button');
    assert.ok(px(touch, 'min-height') >= 44 && px(touch, 'min-width') >= 44);
    assert.equal(css.includes('.farcard .acts'), false);
    // the touch controls' rules still name .acts only: absolute, bottom right, no pointer events
    assert.match(rule(css, '.acts'), /position: absolute;[^}]*pointer-events: none;/);
    assert.match(css, /html\.touch \.acts \{/);
    assert.equal(/\.acts\b[^{]*\.far-acts|far-acts[^{]*,\s*\.acts\b/.test(css), false);
  });
  it('#ui > .proof outranks #ui > * for pointer events', () => {
    assert.match(css, /#ui > \* \{ pointer-events: none; \}/);
    assert.match(css, /#ui > \.proof \{ pointer-events: auto; \}/);
    assert.ok(css.indexOf('#ui > .proof { pointer-events: auto; }') > css.indexOf('#ui > * { pointer-events: none; }'));
  });
});

// ---- Touch layout after the screen-by-screen audit (docs/ux-audit-2026-11-24.md) ----------------------------------------
// A phone (the compact HUD's media query, upright or on its side): top left the identity row, the goal and guest pills,
// the 속보 slot and under it the floating stack; top right the icon row, the map, 멍때리기 and the eye (and upright the
// waypoint pill); bottom left the stick; bottom right three round buttons (the action, jump, 동작) with the context tag
// against the action. A touch tablet keeps the bottom lane's stack. PHONE is the block that holds a phone's places.
const Q = '(orientation: portrait) and (max-width: 599px), (orientation: landscape) and (max-height: 520px)';
const UP = '(orientation: portrait) and (max-width: 599px)';
const LAND = '(orientation: landscape) and (max-height: 520px)';
const PHONE = media(Q, '--stack-top');
const PHONE_UP = media(UP, '--stack-top');
const PHONE_LAND = media(LAND, '--stack-top');
const LAND_BLOCK = media(LAND, '.taxihud');

describe('touch: the right thumb column is three round buttons', () => {
  const ui = read('ui.js');
  const acts = rule(css, 'html.touch .acts');
  it('from the bottom: the action, jump, 동작; 멍때리기 and the pouch are no longer in it', () => {
    // ui.js: on touch 멍때리기 goes to the row under the map and the pouch into the 동작 panel; a desktop window keeps both where they were
    assert.match(ui, /if \(coarse\) \{\n\s+viewRow\.prepend\(loungeBtn\);\n\s+reactPanel\.prepend\(balloonEl\);\n\s+\} else \{\n\s+dock\.prepend\(loungeBtn\);\n\s+root\.querySelector\('\.hud-r'\)\?\.append\(balloonEl\);\n\s+\}/);
    assert.match(ui, /root\.append\(joy, h\('div', \{ class: 'acts' \}, boostBtn, actBtn, jumpBtn\)\);/);
    // every button of the column is a 52px circle, 12px from the right edge
    assert.match(css, /html\.touch \.act,\n\s*html\.touch \.act\.big,\n\s*html\.touch \.dock \.emote \{ width: 52px; height: 52px; min-width: 52px; border-radius: 50%;/);
    assert.match(css, /html\.touch \.emote\.more \{ width: 52px; height: 52px; border-radius: 50%; \}/);
    assert.equal(px(acts, 'right'), 12);
    assert.match(acts, /flex-direction: column-reverse;/);
    // nothing of the old five-button column is left: no rule for a pouch or a lounge button in the right-hand column
    assert.equal(css.includes('html.touch .hud-r .stay-balloon'), false);
    assert.equal(css.includes('html.touch .dock .stay-lounge-btn'), false);
    assert.equal(css.includes('html.touch .dock button.stay-lounge-btn'), false);
  });
  it('jump and 동작 never move: the action keeps its place while there is nothing to act on', () => {
    assert.match(css, /html\.touch \.acts > \.act\.big\[hidden\] \{ display: grid !important; visibility: hidden; \}/);
    // the dock (동작) starts where two 52px buttons and their gaps end, at every size
    const gap = px(acts, 'gap');
    assert.equal(px(rule(css, 'html.touch .dock'), 'bottom'), px(acts, 'bottom') + 52 + gap + 52 + gap); // a tablet: 36 + 124
    const up = media('(orientation: portrait)', 'html.touch .acts');
    assert.equal(px(rule(up, 'html.touch .dock'), 'bottom'), px(rule(up, 'html.touch .acts'), 'bottom') + 52 + gap + 52 + gap); // upright: 28 + 124
    const side = rule(LAND_BLOCK, 'html.touch .acts'), sideGap = px(side, 'gap');
    assert.equal(px(rule(LAND_BLOCK, 'html.touch .dock'), 'bottom'), px(side, 'bottom') + 52 + sideGap + 52 + sideGap); // on its side: 30 + 116
    for (const d of [rule(css, 'html.touch .dock'), rule(up, 'html.touch .dock'), rule(LAND_BLOCK, 'html.touch .dock')]) assert.equal(px(d, 'right'), 12);
    // on its side the three end 198px up: 4px under the map (8 + 48 + 6 + 56 = 118px down) on a 320px tall screen
    const top = px(rule(LAND_BLOCK, 'html.touch .dock'), 'bottom') + 52;
    assert.equal(top, 198);
    assert.equal(px(rule(LAND_BLOCK, 'html.touch .minimap'), 'width'), 56);
    assert.ok(320 - top >= 8 + px(rule(css, 'html.touch .tools'), 'height') + 6 + 56 + 4);
    assert.match(rule(LAND_BLOCK, 'html.touch .locpill'), /display: none;/);
  });
  it('the 동작 panel opens left of the column from the bottom edge, with the pouch as its first row', () => {
    const panel = rule(css, 'html.touch .reacts');
    assert.equal(px(panel, 'right'), 12 + 52 + 8);
    assert.equal(px(panel, 'bottom'), px(acts, 'bottom'));
    assert.match(panel, /z-index: 8;/);
    assert.match(panel, /overflow: auto;/);
    const row = rule(css, 'html.touch .reacts button.stay-balloon');
    assert.match(row, /grid-column: 1 \/ -1;/);
    assert.ok(px(row, 'height') >= 44);
    assert.match(rule(css, 'html.touch .reacts button.stay-balloon .bn'), /background: var\(--accent\);/);
    assert.match(rule(css, 'html.touch .reacts button.stay-balloon:disabled .bn'), /color: var\(--text-2\);/);
    // the count is a badge at the row's end, the name beside the icon; at most 999+
    const paint = ui.slice(ui.indexOf('function balloonText('), ui.indexOf('setInterval(paintBalloon, 1000);'));
    assert.match(paint, /balloonEl\.replaceChildren\(\.\.\.\[icon\('packet'\), coarse \? h\('span', \{ class: 'bl', text: '복주머니 던지기' \}\) : null, h\('span', \{ class: 'bn', text \}\)\]\.filter\(Boolean\)\);/);
    assert.match(paint, /balloonText\(coarse \? \(left > 999 \? '999\+' : `\$\{left\}`\) : `\$\{left\}번 남음 · 터뜨려 보세요`\);/); // play: no points
    // its name says what it is and how many are left; the explanation is the tooltip
    assert.match(paint, /balloonName\(`복주머니 던지기 · \$\{left\}번 남음`\);/);
    assert.match(paint, /balloonEl\.title = '맞출 때마다 줄어요\. 0이 되면 터지면서 복이 쏟아져요';/);
    assert.equal(/setAttribute\('aria-label', balloonEl\.title\)/.test(ui), false);
    // a tap closes the panel so the throw is in view, and the first one of a session says what to do in one line
    assert.match(ui, /toggleReacts\(false\);\n\s+if \(!balloonTold && balloonHp > 0\) \{ balloonTold = true; note\('복주머니를 맞혀 보세요'\); \}/);
  });
  it('the panel names its four actions, and every caption is at least 12px', () => {
    assert.match(ui, /reactPanel\.prepend\(h\('p', \{ class: 'rh', text: '동작' \}\), \.\.\.dock\.querySelectorAll\('\.emote:not\(\.more\)'\), h\('p', \{ class: 'rh', text: '리액션' \}\)\);/);
    assert.match(ui, /if \(cap\) cap\.textContent = '동작';/);
    assert.match(css, /html\.touch \.reacts \.rh \{ grid-column: 1 \/ -1; margin: 4px 2px 0; font: 700 12px\/1\.2 var\(--font\);/);
    for (const sel of ['html.touch .reacts button.emote .l', 'html.touch .dock button.emote.more .l']) {
      assert.ok(px(rule(css, sel), 'font-size') >= 12, sel); // they were 10px and 9px
    }
    // upright: four 50px columns (a 12px four-letter name fits), 4px gaps, 6px padding and a 1px border: 226px, left of the column on a 320px phone
    const cols = Number(rule(css, 'html.touch .reacts').match(/right: calc\((\d+)px/)[1]);
    assert.match(css, /html\.touch \.reacts \{ grid-template-columns: repeat\(4, 50px\); \}/);
    assert.ok(320 - cols - (4 * 50 + 3 * 4 + 12 + 2) >= 0);
    // on its side: ten 44px columns (eight under 600px wide), without the two headings, under the icon row
    const land = media(LAND, 'grid-template-columns: repeat(10, 44px)');
    assert.match(rule(land, 'html.touch .reacts'), /grid-template-columns: repeat\(10, 44px\);/);
    assert.match(rule(media(LAND + ' and (max-width: 599px)', '.reacts'), 'html.touch .reacts'), /grid-template-columns: repeat\(8, 44px\);/);
    for (const [vw, n] of [[568, 8], [599, 8], [600, 10], [812, 10]]) assert.ok(vw - 72 - (n * 44 + (n - 1) * 4 + 12 + 2) >= 0, String(vw));
    assert.match(rule(LAND_BLOCK, 'html.touch .reacts .rh'), /display: none;/);
    assert.match(rule(LAND_BLOCK, 'html.touch .reacts'), /max-height: calc\(var\(--app-h, 100dvh\) - 96px/);
  });
  it('the bake and dance panels take the bottom of a touch screen: the stick, the column and the tag step aside', () => {
    assert.match(css, /html\.touch #ui:has\(\.bake\.show, \.rhythm\.show\) > :is\(\.dock, \.acts, \.joy, \.prompt, \.reacts\) \{ visibility: hidden !important; \}/);
    assert.equal(px(rule(css, 'html.touch .bake, html.touch .rhythm'), 'bottom'), 24);
    // on its side the dance panel's lanes are as tall as the screen leaves (it was 455px on a 375px screen, 176px off the top)
    const canvas = rule(LAND_BLOCK, 'html.touch .rhythm canvas');
    assert.match(canvas, /width: auto; height: calc\(var\(--app-h, 100dvh\) - 150px/);
    assert.equal(px(rule(LAND_BLOCK, 'html.touch .bake, html.touch .rhythm'), 'bottom'), 8);
    // 375px tall: header about 44px, canvas 225px, pads 10 + 48px, padding 16px and the border: about 345px from 8px up
    assert.ok(8 + 44 + (375 - 150) + 10 + px(rule(LAND_BLOCK, 'html.touch .rhythm .pads button'), 'height') + 16 + 2 <= 375);
    // a closed panel is invisible, inert and out of the tab order
    assert.match(css, /\.bake:not\(\.show\), \.rhythm:not\(\.show\) \{ visibility: hidden; \}/);
    for (const [el, open, close] of [['bakeEl', 'function startBake()', 'function closeBake()'], ['rhythmEl', 'function startDance()', 'function endDance(']]) {
      assert.match(ui, new RegExp(`const ${el} = h\\('div', \\{ class: 'glass (bake|rhythm)', role: 'dialog', 'aria-hidden': 'true', 'aria-label': '[^']+', inert: true \\}`));
      assert.match(ui.slice(ui.indexOf(open), ui.indexOf(open) + 3600), new RegExp(`${el}\\.inert = false;`));
      assert.match(ui.slice(ui.indexOf(close), ui.indexOf(close) + 700), new RegExp(`${el}\\.inert = true;`));
    }
  });
});

describe('touch: 멍때리기 and the eye are two named tiles under the map', () => {
  const ui = read('ui.js');
  it('ui.js builds the row and puts 멍때리기 in it on touch', () => {
    assert.match(ui, /const viewRow = h\('div', \{ class: 'viewrow' \}, viewBtn\);/);
    assert.match(ui, /mapEl,\n\s*locPill,\n\s*viewRow,\n/);
    assert.match(ui, /const viewLabel = h\('span', \{ class: 'l', text: '화면만' \}\);/);
    assert.match(ui, /viewLabel\.textContent = on \? '돌아가기' : '화면만';/);
    // the first press of a session says what the eye does (nothing said it before the HUD was already gone)
    assert.match(ui, /if \(on && byTap && !viewTold\) \{ viewTold = true; note\('화면만 보기 · 다시 누르면 돌아와요'\); \}/);
    assert.match(ui, /loungeBtn\.setAttribute\('aria-pressed', String\(!!on\)\);/);
    // 멍때리기 is refused in a taxi: its tile steps aside for the ride
    assert.match(ui, /loungeBtn\.hidden = coarse && driving;/);
  });
  it('the tiles are 60 x 48 with a 12px name, shown on touch only; the eye only on a phone', () => {
    assert.match(css, /\n\s*\.viewrow \{ display: none; \}/);
    assert.match(rule(css, 'html.touch .viewrow'), /display: flex; gap: 6px;/);
    const tile = rule(css, 'html.touch .viewrow > button');
    assert.equal(px(tile, 'width'), 60);
    assert.ok(px(tile, 'height') >= 44);
    assert.match(tile, /font: 700 12px\/1 var\(--font\);/);
    assert.match(css, /\.id-coin, \.hud-r \.view-btn, \.wal-quick, \.phone-only \{ display: none; \}/);
    assert.match(media(Q, '.id-coin'), /html\.touch \.hud-r \.view-btn \{ display: flex; \}/);
  });
  it('upright the row is under the map; on its side it is left of the map, level with it', () => {
    // upright (hud-r: 8px down, 6px gaps): the icon row 8 … 56, the map 62 … 120, the tiles 126 … 174
    const tools = px(rule(css, 'html.touch .tools'), 'height'), map = px(rule(media('(orientation: portrait)', '.minimap'), 'html.touch .minimap'), 'height');
    assert.equal(8 + tools + 6 + map + 6, 126);
    assert.match(rule(PHONE_UP, 'html.touch .hud-r .locpill'), /display: none;/);
    // the 속보 line ends 8px left of the two tiles (126px wide, 8px in)
    assert.equal(px(rule(PHONE_UP, 'html.touch .news'), 'right'), 8 + 60 + 6 + 60 + 8);
    // on its side: absolute in the column, under the icon row and 6px left of the 56px map
    const side = media(Q, '.id-coin').match(/@media \(orientation: landscape\) \{ html\.touch \.hud-r > \.viewrow \{ ([^}]*) \} \}/);
    assert.ok(side, 'no landscape rule for the row');
    assert.equal(px(side[1], 'top'), tools + 6);
    assert.equal(px(side[1], 'right'), px(rule(LAND_BLOCK, 'html.touch .minimap'), 'width') + 6);
    // it ends 110px down, above the three buttons (198px up) even on a 320px tall screen
    assert.ok(8 + px(side[1], 'top') + 48 <= 320 - 198);
  });
});

describe('touch bottom lane: one context tag against the action button', () => {
  const ui = read('ui.js');
  const prompt = rule(css, 'html.touch .prompt');
  const joy = rule(css, 'html.touch .joy');
  const acts = rule(css, 'html.touch .acts');
  it('the tag is right-aligned between the resting stick and the column, and takes no touches', () => {
    assert.equal(px(prompt, 'left'), 122);
    assert.equal(px(prompt, 'right'), 72);
    assert.match(prompt, /width: fit-content;/);
    assert.match(prompt, /margin: 0 0 0 auto;/);
    assert.match(prompt, /top: auto;/);
    assert.match(prompt, /transform: translateY\(8px\) scale\(\.96\);/);
    assert.match(rule(css, 'html.touch .prompt.show'), /transform: none; pointer-events: none !important;/);
    // 8px clear of the resting stick (104px, 10px in) and of the 52px column 12px from the right
    assert.ok(px(prompt, 'left') >= px(joy, 'left') + px(joy, 'width') + 8);
    assert.ok(px(prompt, 'right') >= px(acts, 'right') + 52 + 8);
    const tag = rule(css, 'html.touch .prompt .tag');
    assert.match(tag, /font: 700 13px\/1\.35 var\(--font\);/);
    assert.match(tag, /word-break: keep-all;/);
    assert.equal(css.includes('html.touch .prompt button'), false); // it is not a button there any more
    assert.equal(/\.keycap[^{]*\{[^}]*\}/.test(css), true); // the key cap is the keyboard prompt's
  });
  it('the tag and 시점 해제 are level with the action button at every size', () => {
    const tagH = 8 + 13 * 1.35 + 8 + 2; // one line: about 36px
    const level = (actBottom, tagBottom, h) => Math.abs((actBottom + 26) - (tagBottom + h / 2));
    const up = media('(orientation: portrait)', 'html.touch .acts');
    const focus = rule(css, 'html.touch .stay-focus');
    assert.ok(px(focus, 'min-height') >= 44);
    assert.equal(px(focus, 'right'), px(prompt, 'right'));
    assert.match(focus, /left: auto;/);
    for (const [name, a, t, f] of [
      ['a tablet', px(acts, 'bottom'), px(prompt, 'bottom'), px(focus, 'bottom')],
      ['upright', px(rule(up, 'html.touch .acts'), 'bottom'), px(rule(PHONE_UP, 'html.touch .prompt'), 'bottom'), px(rule(PHONE_UP, 'html.touch .stay-focus'), 'bottom')],
      ['on its side', px(rule(LAND_BLOCK, 'html.touch .acts'), 'bottom'), px(rule(PHONE_LAND, 'html.touch .prompt'), 'bottom'), px(rule(PHONE_LAND, 'html.touch .stay-focus'), 'bottom')],
    ]) {
      assert.ok(level(a, t, tagH) <= 1, name + ' tag');
      assert.ok(level(a, f, 44) <= 1, name + ' 시점 해제');
    }
    // on its side the tag is at most 240px wide (it was 406px across the street) and starts past the 88px stick
    const side = rule(PHONE_LAND, 'html.touch .prompt');
    assert.equal(px(side, 'max-width'), 240);
    assert.equal(px(rule(LAND_BLOCK, 'html.touch .joy'), 'width'), 88);
    assert.ok(px(side, 'left') >= 10 + 88 + 8);
    // 시점 해제 takes the tag's place: the prompt is hidden while the focus camera is on
    assert.match(ui, /const show = !!near && !baking && !sheet && !dance && !driving && !focusOn;/);
  });
  it('the 화면만 보기 and 멍때리기 rules still name the pieces', () => {
    assert.match(css, /#ui\.viewonly > :is\(\.hud-l, \.news, \.prompt, \.waypill,/);
    assert.match(css, /#ui\.lounging > \.news, #ui\.lounging > \.help/);
    assert.equal(css.includes('.stay-ticket'), false); // the 5-minute draw line is gone (no lottery)
    // nothing moves the prompt or the pill while a news line shows
    assert.equal(/#ui:has\(> \.news\.show\)[^{]*\.(prompt|waypill)/.test(css), false);
  });
  it('a news line longer than its bar crawls to its end and stays until it has been read', () => {
    const pump = ui.slice(ui.indexOf('function pumpNews('), ui.indexOf('function cooldownLeft('));
    assert.match(pump, /const over = Math\.ceil\(newsText\.scrollWidth - newsText\.clientWidth\);/);
    assert.match(pump, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
    assert.match(pump, /newsText\.style\.setProperty\('--crawl', `\$\{-over\}px`\);/);
    assert.match(pump, /newsEl\.classList\.add\('crawl'\);/);
    assert.match(pump, /\}, Math\.max\(4400, 1000 \+ crawl \+ 1200\)\);/);
    assert.match(rule(css, '.news.crawl .body strong'), /animation: newsCrawl var\(--crawl-s, 3s\) linear 1s both;/);
    assert.match(css, /@keyframes newsCrawl \{ from \{ transform: none; \} to \{ transform: translateX\(var\(--crawl, 0px\)\); \} \}/);
    // the crawl starts after 1 s and leaves 1.2 s on the end: about 70px a second (14ms a pixel), 1.5 to 8 s
    assert.match(pump, /Math\.min\(8000, Math\.max\(1500, over \* 14\)\)/);
    // the line is one 12px line on touch (the 속보 LIVE tab was 10px), under the left column
    assert.match(rule(css, 'html.touch .news .kick'), /font-size: 12px;/);
    assert.match(rule(css, 'html.touch .news .body small'), /display: none;/);
  });
  it('the line waits while one board is looked at or the boards are toured, and the same line is not run twice', () => {
    const pump = ui.slice(ui.indexOf('function pumpNews('), ui.indexOf('function cooldownLeft('));
    assert.match(pump, /if \(focusOn \|\| root\.classList\.contains\('lounging'\)\) return;/);
    assert.match(ui, /focusLock\(on\) \{ focusOn = !!on; focusBtn\.hidden = !on; root\.classList\.toggle\('focusing', focusOn\); renderPrompt\(\); if \(!on\) \{ setTimeout\(pumpQueued, 0\); pumpNews\(\); \} \},/);
    assert.match(ui, /if \(!on\) pumpNews\(\); \},\n/);
    // the welcome comes with every reconnect: the feed keeps one copy, and the banner does not run it again
    assert.match(pump, /const again = \[\.\.\.feedRows\.children\]\.filter\(\(n\) => sameNews\(n\.textContent, line\.textContent\)\);\n\s+for \(const n of again\) n\.remove\(\);/);
    assert.match(pump, /if \(again\.length\) \{ newsBusy = false; pumpNews\(\); return; \}/);
  });
});

describe('the floating stack: the hint, a far-board card, 홈 화면 추가, a board\'s card and the toasts are one column', () => {
  const ui = read('ui.js');
  const stack = rule(css, 'html.touch .toasts');
  const piece = rule(css, 'html.touch .toasts > *');
  const lane = rule(css, 'html.touch .waypill');
  it('ui.js puts every floating card in the toasts\' column, and a burst of toasts drops only toasts', () => {
    const far = ui.slice(ui.indexOf('  function showFarCard('), ui.indexOf('  function showAdCard('));
    const ad = ui.slice(ui.indexOf('  function showAdCard('), ui.indexOf('  function levelOf('));
    for (const f of [far, ad]) {
      assert.match(f, /toasts\.prepend\(el\);/);
      assert.equal(f.includes('root.append(el)'), false);
    }
    const home = ui.slice(ui.indexOf('  function openHome('), ui.indexOf('  function pumpHome('));
    assert.match(home, /toasts\.prepend\(el\); \/\/ in the floating stack/);
    assert.equal(home.includes('document.body.append(el)'), false);
    assert.equal(ui.includes('showDraw'), false); // the lottery result card is gone with the lottery
    assert.match(ui, /if \(!coarse\) root\.append\(sponsorEl\);/);
    assert.match(ui, /if \(coarse\) toasts\.prepend\(sponsorEl\);/);
    assert.match(ui, /if \(coarse\) toasts\.prepend\(coachEl\);/);
    // note(): over three toasts the oldest plain toast goes; a card in the column is never counted or dropped
    const note = ui.slice(ui.indexOf('  function note('), ui.indexOf('  const newsQueue = []'));
    assert.match(note, /const shown = \(\) => \[\.\.\.toasts\.children\]\.filter\(\(c\) => c\.classList\.contains\('toast'\)\);/);
    assert.match(note, /for \(let list = shown\(\); list\.length > 3; list = shown\(\)\) \(list\.find\(\(c\) => c !== t && !c\.classList\.contains\('hit'\)\) \|\| list\[0\]\)\.remove\(\);/);
    assert.equal(note.includes('toasts.firstChild'), false);
  });
  it('a phone: one notice at a time, hanging under the left column, never over the avatar', () => {
    const s = rule(PHONE, 'html.touch .toasts');
    assert.match(s, /top: var\(--stack-top, 182px\); bottom: auto;/);
    assert.match(s, /flex-direction: column; align-items: flex-start;/);
    assert.equal(px(s, 'left'), 10);
    assert.match(rule(PHONE, 'html.touch .toasts > *'), /align-self: flex-start; margin-left: 0; max-width: 100%; translate: none;/);
    assert.match(rule(PHONE, 'html.touch .toasts > .toast:has(~ .toast)'), /display: none;/); // only the newest shows
    assert.match(rule(PHONE, 'html.touch .toast'), /text-align: left;/);
    // ui.js keeps the left column's bottom edge on the root element: the toasts live in <body>, not in #ui
    assert.match(ui, /document\.documentElement\.style\.setProperty\('--hudl-b', Math\.round\(col\.offsetTop \+ col\.offsetHeight\) \+ 'px'\)/);
    assert.equal(ui.includes("root.style.setProperty('--hudl-b'"), false);
    // upright: under both top columns. The left one ends at --hudl-b and the 속보 slot is 8 + 30px under it; the right one
    // (icon row, map, tiles) ends 174px down; with a waypoint pill (180 … 218px) the stack starts under the pill
    const up = rule(PHONE_UP, 'html.touch .toasts');
    assert.match(up, /--stack-top: max\(calc\(var\(--hudl-b, 142px\) \+ 46px\), calc\(182px \+ var\(--safe-t\)\)\);/);
    assert.ok(46 >= 8 + px(rule(css, 'html.touch .news'), 'height') + 8);
    assert.equal(182, 174 + 8);
    const pill = rule(PHONE_UP, 'html.touch .waypill');
    assert.equal(px(pill, 'top'), 174 + 6);
    assert.equal(px(pill, 'right'), 8);
    assert.match(pill, /bottom: auto; left: auto;/);
    assert.match(rule(PHONE_UP, 'html.touch body:has(#ui > .waypill:not([hidden])) .toasts'), /--stack-top: max\(calc\(var\(--hudl-b, 142px\) \+ 46px\), calc\(226px \+ var\(--safe-t\)\)\);/);
    assert.equal(226, px(pill, 'top') + 38 + 8);
    // a 640px tall phone: a three-line notice (about 70px) from 190px ends by 260px, above the avatar's head (about 300px down)
    assert.ok(190 + 70 <= 300);
    // the stack's top is a variable set by the states (pill, taxi), so a sheet's own rule for `top` still wins
    assert.equal(/html\.touch body:has\([^{]*\) \.toasts \{ top: (calc|max)\(/.test(PHONE_UP), false);
  });
  it('a phone on its side: under the left column, as wide as a notice needs; the far-board card takes the tag\'s place', () => {
    const s = rule(PHONE_LAND, 'html.touch .toasts');
    assert.match(s, /--stack-top: calc\(var\(--hudl-b, 142px\) \+ 8px\);/);
    assert.match(s, /right: auto; width: min\(300px,/);
    // the 속보 line is the top centre banner there, between the left column and the icon row (180px, 8px in), the pill centred under it
    const news = rule(PHONE_LAND, 'html.touch .news'), pill = rule(PHONE_LAND, 'html.touch .waypill');
    for (const r of [news, pill]) {
      assert.match(r, /left: calc\(min\(240px, 40vmax\) \+ 18px \+ var\(--safe-l\)\);/);
      assert.equal(px(r, 'right'), 8 + 180 + 8);
      assert.match(r, /margin: 0 auto;/);
    }
    assert.equal(px(pill, 'top'), px(news, 'top') + px(rule(css, 'html.touch .news'), 'height') + 6);
    // the board's card without the board's lines (the camera is on the board)
    assert.match(rule(PHONE_LAND, 'html.touch .toasts > .sponsor p'), /display: none;/);
    // the far-board card would need two rows in a 300px stack: one row in the lane for its 4 s, and the tag steps aside
    const far = rule(PHONE_LAND, 'html.touch .toasts > .farcard');
    assert.match(far, /position: fixed;/);
    assert.equal(px(far, 'left'), px(rule(PHONE_LAND, 'html.touch .prompt'), 'left'));
    assert.equal(px(far, 'right'), 72);
    assert.equal(px(far, 'bottom'), px(rule(LAND_BLOCK, 'html.touch .acts'), 'bottom'));
    assert.match(far, /flex-wrap: nowrap;/);
    assert.match(PHONE_LAND, /html\.touch body:has\(\.toasts > \.farcard\) #ui > \.prompt \{ visibility: hidden; \}/);
    // 568px: the lane is 568 - 106 - 72 = 390px, the card's row is 182px plus the name (140px)
    assert.ok(568 - 106 - 72 >= 2 * 12 + 2 + 12 + 3 * 44 + 2 * 6 + 140);
  });
  it('a tablet keeps the stack above the bottom lane, each piece on the lane\'s centre, never in the right-hand column', () => {
    const L = px(stack, 'left'), R = px(stack, 'right');
    assert.equal(L, 72);
    assert.equal(R, 72);
    assert.equal(px(stack, 'bottom'), 190);
    assert.match(stack, /transform: none;/);
    assert.match(piece, /align-self: flex-start;/);
    const off = Number(piece.match(/margin-left: calc\(50% \+ (\d+)px\);/)[1]);
    const extra = Number(piece.match(/max-width: calc\(100% \+ (\d+)px\);/)[1]);
    const k = Number(piece.match(/translate: min\(-50%, calc\(50vw - (\d+)px - \(var\(--safe-l\) \+ var\(--safe-r\)\) \/ 2 - 100%\)\);/)[1]);
    const acts = rule(css, 'html.touch .acts');
    for (const vw of [600, 768, 834, 1024]) {
      const B = vw - L - R;
      const C = L + B / 2 + off; // where the margin puts a piece's left edge, before the translate
      assert.equal(C, (px(lane, 'left') + vw - px(lane, 'right')) / 2, String(vw));
      const room = vw / 2 - k; // from that centre to the stack's right edge
      assert.equal(room, vw - R - C, String(vw));
      for (const w of [96, 160, 198, 246, 306, 346]) {
        if (w > B + extra) continue;
        const left = C + Math.min(-w / 2, room - w), right = left + w;
        assert.ok(right <= vw - px(acts, 'right') - 52 - 8, vw + ' ' + w);
        assert.ok(left >= L - extra - 1e-9, vw + ' ' + w);
      }
    }
    const joy = rule(css, 'html.touch .joy');
    assert.ok(px(stack, 'bottom') >= px(joy, 'bottom') + px(joy, 'height') + 12);
    assert.ok(px(stack, 'bottom') >= px(lane, 'bottom') + 38 + 8);
    assert.match(rule(css, 'html.touch .toast'), /word-break: keep-all;/);
  });
  it('the pieces have no box of their own, and the far-board card shows its name', () => {
    const far = rule(css, '.farcard'), home = rule(css, '.a2hs');
    assert.equal(css.includes('.stay-draw'), false);
    for (const r of [far, home, rule(css, '.coach')]) {
      assert.equal(/(^|[;\s])(left|bottom|top): /.test(r), false, r);
      assert.equal(/position: (absolute|fixed)/.test(r), false, r);
    }
    assert.match(far, /flex-wrap: wrap;/);
    assert.match(far, /width: max-content; max-width: 100%;/);
    assert.match(rule(css, '.farcard .where'), /flex: 1 1 140px; min-width: 0;/);
    assert.match(rule(css, '.farcard .far-acts'), /margin-left: auto;/);
    assert.match(rule(css, 'html.touch .farcard .far-acts button'), /padding: 0 8px;/);
    // upright on a phone the stack is the screen less 10px each side: one row (name 140px) from 342px wide, two rows below
    const row = 3 * 44 + 2 * 6, card = 2 * 12 + 2;
    assert.equal(card + 140 + 12 + row, 322);
    assert.ok(375 - 20 >= 322 && 320 - 20 < 322);
    // the board's card and the 홈 화면 추가 card are as wide as the phone's stack allows
    assert.match(rule(PHONE, 'html.touch .toasts > :is(.sponsor, .a2hs)'), /width: min\(420px, 100%\);/);
  });
  it('the hint is one 12px line for 8 s; a card sends it aside; a menu hides the whole stack; over a sheet only the toasts show', () => {
    const coach = rule(css, '.coach');
    assert.match(coach, /white-space: nowrap;/);
    assert.match(coach, /font: 700 12px\/1\.35 var\(--font\);/);
    assert.match(ui, /h\('div', \{ class: 'coach', role: 'status', hidden: true \}, h\('span', \{ text: '끌어서 둘러보기' \}\), h\('span', \{ class: 'sep', text: ' · ' \}\), h\('span', \{ text: '두 손가락으로 확대' \}\)\)/);
    assert.match(ui, /coachTimer = setTimeout\(coachDone, 8000\);/); // it was 15 s on every visit until the first drag
    assert.equal(css.includes('html.touch .coach'), false); // no two-line version: every stack is wide enough for the one line
    assert.match(css, /\.toasts:has\(> \.farcard, > \.a2hs:not\(\[hidden\]\), > \.sponsor:not\(\[hidden\]\)\) > \.coach \{ display: none; \}/);
    assert.match(css, /\.toasts:has\(> \.farcard\) > \.a2hs \{ display: none; \}/);
    // the ⋯ menu and the 동작 panel are menus: nothing floats over them (a toast lay on 전체 화면, the hint on the first emoji row)
    assert.match(css, /body:has\(#ui \.tools\.open\) \.toasts, html\.touch body:has\(#ui > \.reacts:not\(\[hidden\]\)\) \.toasts \{ visibility: hidden; \}/);
    assert.match(css, /body\.has-sheet \.toasts > :not\(\.toast\), body\.has-proof \.toasts > :not\(\.toast\), body:has\(#ui > \.bake\.show\) \.toasts > :not\(\.toast\), body:has\(#ui > \.rhythm\.show\) \.toasts > :not\(\.toast\) \{ display: none; \}/);
    const top = css.match(/html\.touch body\.has-sheet \.toasts > \*, html\.touch body\.has-proof \.toasts > \*, html\.touch body:has\(#ui > \.bake\.show\) \.toasts > \*, html\.touch body:has\(#ui > \.rhythm\.show\) \.toasts > \* \{([^}]*)\}/);
    assert.ok(top, 'no reset for the toasts at the top');
    assert.match(top[1], /align-self: center; margin-left: 0; max-width: 100%; translate: none;/);
    assert.ok(css.indexOf(top[0]) > css.indexOf('html.touch .toasts > * {'));
  });
  it('a board\'s card (focus link, taxi drop-off) is in the stack on touch; on a phone the pills step aside for the board', () => {
    const sp = rule(css, 'html.touch .toasts > .sponsor');
    assert.match(sp, /pointer-events: auto;/);
    assert.match(rule(css, 'html.touch .toasts > .sponsor .chips'), /flex-wrap: nowrap; overflow-x: auto;/);
    // a desktop window still lifts its toasts over the card, and its chips are one scrolling row too (twelve chips took three rows)
    assert.match(css, /html:not\(\.touch\) body\.has-sponsor \.toasts \{ bottom: calc\(360px \+ var\(--safe-b\)\); \}/);
    assert.match(css, /#ui > \.sponsor \.chips \{ flex-wrap: nowrap; overflow-x: auto;/);
    assert.equal(css.includes('html.touch body.has-sponsor'), false);
    assert.equal(css.includes('html.touch #ui > .sponsor'), false);
    // looking at one board on a phone: only the identity row stays in the left column, and the 속보 line waits
    assert.match(PHONE, /html\.touch #ui\.focusing > \.hud-l > :not\(\.ident\), html\.touch #ui\.focusing > \.news \{ visibility: hidden !important; \}/);
  });
  it('화면만 보기 hides the hint and the board\'s card in the stack too, and keeps the toasts', () => {
    assert.match(media(Q, '.id-coin'), /html\.touch body:has\(> #ui\.viewonly\) \.toasts > :is\(\.coach, \.sponsor\) \{ display: none !important; \}/);
  });
});

describe('touch landscape on a phone (height up to 520px)', () => {
  // The left column: 10px in, at most min(240px, 40vw) wide.
  const leftCol = (vw) => 10 + Math.min(240, vw * 0.4);
  it('driving: the taxi HUD is one row along the top, between the left column and the icon row', () => {
    assert.match(rule(LAND_BLOCK, 'html.touch .hud-l'), /max-width: min\(240px, 40vw\);/);
    const t = rule(LAND_BLOCK, 'html.touch .taxihud');
    assert.equal(px(t, 'top'), 8); // it was 156px down: across the middle of a 375px screen, on the taxi and the road
    assert.match(t, /left: calc\(min\(240px, 40vw\) \+ 26px \+ var\(--safe-l\)\);/);
    assert.equal(px(t, 'right'), 8 + 180 + 8);
    assert.match(t, /grid-template-rows: auto;/);
    for (const vw of [641, 667, 740, 812, 844]) assert.ok(Math.min(240, vw * 0.4) + 26 - leftCol(vw) >= 12, String(vw));
    // 812px: 812 - 266 - 196 = 350px for speed, passengers, the job line and the timer
    assert.equal(812 - (240 + 26) - px(t, 'right'), 350);
    assert.match(rule(LAND_BLOCK, 'html.touch .taxihud .keys'), /display: none;/);
    // the 속보 line (the same slot) and the waypoint pill wait until the ride is over
    assert.match(LAND_BLOCK, /html\.touch #ui:has\(\.taxihud:not\(\[hidden\]\)\) > :is\(\.news, \.waypill\) \{ display: none; \}/);
    // the base rule (full width, 8px in) comes first, so this one wins
    assert.ok(css.indexOf('html.touch .taxihud { top:') < css.indexOf('(orientation: landscape) and (max-height: 520px)'));
  });
  it('568-640px wide: while driving the taxi HUD takes the row under the identity card', () => {
    const narrow = media(LAND + ' and (max-width: 640px)', '.taxihud');
    const t = rule(narrow, 'html.touch .taxihud');
    assert.equal(px(t, 'left'), 10);
    // under the identity row (10 + 46px) and ending 8px left of 멍때리기, the eye and the map (126 + 6 + 56px wide, 8px in)
    assert.ok(px(t, 'top') >= 10 + 46 + 6);
    assert.equal(px(t, 'right'), 8 + 56 + 6 + 126 + 8);
    assert.ok(568 - px(t, 'left') - px(t, 'right') >= 340);
    assert.match(narrow, /html\.touch #ui:has\(\.taxihud:not\(\[hidden\]\)\) \.hud-l > :not\(\.ident\) \{ display: none; \}/);
  });
  it('upright the taxi HUD is under both top columns and the stack under it', () => {
    assert.equal(px(rule(PHONE_UP, 'html.touch .taxihud'), 'top'), 182);
    assert.match(rule(PHONE_UP, 'html.touch body:has(#ui > .taxihud:not([hidden])) .toasts'), /--stack-top: calc\(282px \+ var\(--safe-t\)\);/);
    // while driving the HUD's arrow points the way: the waypoint pill waits on every phone
    assert.match(PHONE, /html\.touch #ui:has\(\.taxihud:not\(\[hidden\]\)\) > \.waypill \{ display: none; \}/);
    // the key line shows for the first 8 s of a ride, and the ride begins with one short notice (two long ones lay on the road)
    const ui = read('ui.js');
    assert.match(ui, /taxiKeys\.hidden = !driving;\n\s+if \(driving\) taxiKeysTimer = setTimeout\(\(\) => \{ taxiKeys\.hidden = true; \}, 8000\);/);
    assert.match(ui, /if \(driving\) \{ closeSheet\(\); note\('손님 기둥 앞에서 속도를 줄이세요', 'ok'\); \}/);
    assert.equal(/운전 시작!|진행 방향 도로 위에/.test(ui), false);
  });
  it('the ⋯ menu is three columns there, and dims what is behind it', () => {
    assert.match(rule(PHONE_LAND, 'html.touch .tools.open'), /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
    assert.match(rule(css, 'html.touch .tools.open'), /box-shadow: var\(--shadow-sheet\), 0 0 0 100vmax rgba\(0, 0, 0, \.56\);/);
    // eight rows (소리 and 전체 화면 are in settings) and 닫기: 3 rows of 48px + 닫기 + gaps and padding, about 226px of a 375px screen
    assert.ok(4 * px(rule(css, 'html.touch .tools.open > .btn'), 'height') + 3 * 4 + 16 + 2 <= 375 * 0.62);
  });
  it('the boot card scrolls from the top when it is taller than the screen', () => {
    const boot = rule(css, '#boot');
    assert.match(boot, /overflow-y: auto;/);
    assert.match(boot, /place-items: start center;/);
    assert.equal(/overflow: hidden/.test(boot), false);
    // auto margins centre the card while it fits and are zero when it does not
    assert.match(rule(css, '#boot .wrap'), /margin: auto 0;/);
    assert.match(LAND_BLOCK, /#boot \.bootmark \{ display: none; \}/);
  });
});

describe('desktop windows', () => {
  const IDENT_RIGHT = 14 + 340; // .hud-l: left 14px, width 340px
  const row = (n) => n * 40 + 8 + 2; // .tools: 40px buttons, 4px padding each side, 1px border each side
  it('under 820px the tool row folds and no longer reaches the identity card', () => {
    const hudL = rule(css, '.hud-l');
    assert.equal(px(hudL, 'left') + px(hudL, 'width'), IDENT_RIGHT);
    const fold = media('(max-width: 819px)', '.tool-fold');
    assert.match(fold, /html:not\(\.touch\) \.tool-fold \{ display: inline-flex; \}/);
    assert.match(fold, /html:not\(\.touch\) \.tools \.tool-more \{ display: none; \}/);
    assert.match(fold, /html:not\(\.touch\) \.tools\.open \.tool-more \{ display: inline-flex; \}/);
    // the open panel lies over the minimap instead of pushing the column down
    assert.match(rule(fold, 'html:not(.touch) .tools.open'), /position: absolute;[^}]*z-index: 7;/);
    assert.match(rule(fold, 'html:not(.touch) .bar'), /position: relative; min-height: 46px;/);
    // before: 10 buttons (11 with 받은 소식) from the right edge less 14px
    assert.equal(IDENT_RIGHT - (700 - 14 - row(10)), 78);
    assert.equal(IDENT_RIGHT - (700 - 14 - row(11)), 118);
    // after: 전광판, 소원, (받은 소식), 순위, 조작 안내, ⋯
    for (const vw of [641, 700, 771, 819]) assert.ok(vw - 14 - row(6) - IDENT_RIGHT >= 12, String(vw));
    assert.equal(700 - 14 - row(5) - IDENT_RIGHT, 122);
    // from 820px the full row fits again: 11 buttons end 2px right of the card (the sound button is gone: 소리 is a
    // switch in the settings sheet, so the row is 전광판, 소원, 선물, 받은 소식, 공유·코드, 사진, 순위, 내 건물, 전체 화면, 설정, 조작 안내)
    assert.ok(820 - 14 - row(11) - IDENT_RIGHT >= 0);
    const ui = read('ui.js');
    assert.equal(/soundBtn/.test(ui), false);
    assert.equal((ui.slice(ui.indexOf("h('div', { class: 'glass tools' },"), ui.indexOf('    mapEl,\n')).match(/h\('button'/g) || []).length, 7); // + wishBtn, inboxBtn, fsBtn; gift.js and the key card add theirs
  });
  it('from 1240px the first four tools carry their name beside the icon (twelve bare icons told nothing apart)', () => {
    const wide = media('(min-width: 1240px)', '.named');
    assert.match(rule(wide, 'html:not(.touch) .tools .btn:is(.named, .tool-gift)'), /width: auto;/);
    assert.match(rule(wide, 'html:not(.touch) .tools .btn:is(.named, .tool-gift)::after'), /content: attr\(aria-label\);/);
    const ui = read('ui.js');
    for (const name of ['전광판 걸기', '응원 순위']) assert.match(ui, new RegExp(`class: 'btn icon( tool-rank)? named', type: 'button', 'aria-label': '${name}'`));
    assert.match(ui, /class: 'btn icon tool-wish named'/);
    // four names of about 110-150px and seven 40px icons are about 770px: clear of the left column (354px) at 1240px
    assert.ok(1240 - 14 - (124 + 124 + 150 + 112 + 7 * 40 + 10) - IDENT_RIGHT >= 12);
  });
  it('a button and the sheet it opens say the same thing', () => {
    const ui = read('ui.js');
    for (const [label, title] of [['공유·코드', "openSheet(['share', '공유·코드'], null,"], ['내 건물', "openSheet(['building', '내 건물'], null,"]]) {
      assert.ok(ui.includes(`'aria-label': '${label}', title: '${label}'`), label);
      assert.ok(ui.includes(title), title);
    }
    // the English tags beside a title said nothing
    assert.equal(/'(EXCHANGE|SPONSOR|NOW|MANHATTAN|MINE|AD)'/.test(ui), false);
    assert.equal(/VIP 메뉴|내 건물 짓기'|공유와 스폰서 코드'/.test(ui.replace(/\/\/[^\n]*/g, '')), false);
  });
  it('the controls card is above the dock where the dock reaches it, and under every control', () => {
    assert.match(css, /\.help \{ z-index: -1; \}/);
    const mid = media('(min-width: 641px) and (max-width: 1126px)', '.help');
    const help = rule(mid, 'html:not(.touch) .help');
    // the dock: bottom 18px, 70px buttons, 8px padding and 1px border each side
    const dockTop = 18 + 70 + 16 + 2;
    assert.ok(px(help, 'bottom') >= dockTop + 12);
    // the E prompt sits in the same band (bottom 118px, up to two lines, about 66px): the card stays above it too
    assert.ok(px(help, 'bottom') >= 118 + 66 + 12);
    // 4 emotes + more + lounge at 74px, a 5px separator, 6 gaps of 8px, 8px padding and 1px border each side
    const dockW = 6 * 74 + 5 + 6 * 8 + 16 + 2;
    assert.equal(dockW, 515);
    // the card is at most about 280px wide, 14px from the left: the dock clears it (12px gap) from 1127px
    const helpRight = 14 + 280;
    assert.ok((1127 - dockW) / 2 >= helpRight + 12);
    assert.ok((1126 - dockW) / 2 < helpRight + 12);
    // 771px: the dock starts at 128px, 166px inside the card
    assert.equal((771 - dockW) / 2, 128);
    const small = media('(max-width: 640px)', 'html:not(.touch) .help');
    // under 641px the draw / news slot (10px up, 40px tall) and the waypoint pill (58px up, 38px tall) are along the bottom
    const low = media('(max-width: 640px)', 'html:not(.touch) .waypill');
    assert.ok(px(rule(small, 'html:not(.touch) .help'), 'bottom') >= px(rule(low, 'html:not(.touch) .waypill'), 'bottom') + 38 + 6);
  });
});

describe('desktop top-centre column: the news line and the waypoint pill on one axis', () => {
  const IDENT_RIGHT = 14 + 340, TOOL_BOTTOM = 14 + 46, MAP_COL = 14 + 184;
  const news = rule(css, '.news'), way = rule(css, 'html:not(.touch) .waypill');
  /** The box an absolutely placed rule with left, right, width: auto, max-width and auto margins gets at a viewport width. */
  const box = (r, vw) => {
    const l = px(r, 'left'), rr = px(r, 'right'), w = Math.min(px(r, 'max-width'), vw - l - rr);
    return { l: l + (vw - l - rr - w) / 2, w };
  };
  it('from 820px the slot is one box under the top row, between the left column and the minimap column', () => {
    assert.match(news, /width: auto;/);
    assert.match(news, /margin: 0 auto;/);
    assert.equal(px(news, 'top'), 68);
    assert.equal(px(news, 'height'), 40);
    assert.ok(px(news, 'top') >= TOOL_BOTTOM + 8);
    for (const vw of [820, 900, 1024, 1089, 1090, 1280, 1440, 1920]) {
      const b = box(news, vw);
      assert.ok(b.l >= IDENT_RIGHT + 12, String(vw));
      assert.ok(b.l + b.w <= vw - MAP_COL - 12, String(vw));
      // one centre for the slot and the pill: the middle of the band between the two columns (50% + 78px)
      assert.equal(b.l + b.w / 2, vw / 2 + 78, String(vw));
    }
    // before: the ticker in the top row (366px … right 476px, centred) and the pill on the screen's centre, at 1440px
    assert.equal(366 + (1440 - 366 - 476) / 2, 665);
    assert.equal(1440 / 2 + 78, 798);
  });
  it('the waypoint pill is centred under the slot, as wide as its text, and no longer steps aside', () => {
    assert.equal(px(way, 'left'), px(news, 'left'));
    assert.equal(px(way, 'right'), px(news, 'right'));
    assert.match(way, /width: fit-content;/);
    assert.match(way, /margin: 0 auto;/);
    assert.match(way, /transform: none;/);
    assert.ok(px(way, 'top') >= px(news, 'top') + px(news, 'height') + 8);
    assert.equal(/html:not\(\.touch\) #ui:has\(> \.news\.show\) \.waypill/.test(css), false);
  });
  it('641-819px: the slot and the pill are under the minimap column (it ends about 353px down), off the left column', () => {
    const mid = media('(min-width: 641px) and (max-width: 819px)', '.waypill');
    const slot = rule(mid, 'html:not(.touch) .news');
    const pill = rule(mid, 'html:not(.touch) .waypill');
    assert.ok(px(slot, 'top') >= 353 + 24);
    assert.ok(px(pill, 'top') >= px(slot, 'top') + 40 + 8);
    // the pill's box is the slot's column: same right edge, the left edge the slot's width further in
    assert.match(slot, /width: min\(320px, calc\(100vw - 380px\)\);/);
    assert.match(pill, /left: calc\(100% - 14px - var\(--safe-r\) - min\(320px, calc\(100vw - 380px\)\)\);/);
    assert.equal(px(pill, 'right'), px(slot, 'right'));
    for (const vw of [641, 720, 819]) assert.ok(vw - 14 - Math.min(320, vw - 380) >= IDENT_RIGHT + 12, String(vw));
    // before: the pill (88 … 126px, centred, 136px) lay on the left column's second row at 720px
    assert.ok(720 / 2 - 68 < IDENT_RIGHT);
  });
  it('the news line has the slot to itself (the draw line is gone with the lottery)', () => {
    assert.equal(/#ui:has\(> \.news\.show\) > \./.test(css), false);
    assert.match(css, /#ui > \.stay-balloon, #ui > \.stay-focus \{ pointer-events: auto; \}/);
    // the news line only fades (a live region that stays in the page) and takes no taps until it shows a board
    assert.match(rule(css, '.news'), /opacity: 0;[^}]*pointer-events: none;/);
    assert.match(css, /#ui > \.news\.show\.go \{ pointer-events: auto; cursor: pointer; \}/);
  });
});

describe('billboard sheet under 900px', () => {
  const narrow = media('(max-width: 900px)', '.sheet.bill');
  it('only the preview is sticky, and not on a short screen', () => {
    assert.match(rule(narrow, '.sheet.bill .grid2.bb'), /display: block; overflow: auto;/);
    assert.match(rule(narrow, '.sheet.bill .grid2.bb > :first-child'), /display: contents;/);
    assert.equal(/position: sticky/.test(narrow), false);
    const tall = media('(max-width: 900px) and (min-height: 521px)', '.screen');
    assert.match(rule(tall, '.sheet.bill .grid2.bb .screen'), /position: sticky; top: 0; z-index: 3;/);
    assert.match(rule(narrow, '.sheet.bill .grid2.bb .screen'), /background: var\(--surface\);/);
    assert.match(rule(narrow, '.sheet.bill .grid2.bb .screen canvas'), /width: min\(100%, calc\(28vh \* 16 \/ 9\)\); margin: 0 auto;/);
    // the two-column layout above 900px is as it was
    assert.match(css, /\.sheet\.bill \.grid2\.bb > :first-child,\n\s*\.sheet\.bill \.grid2\.bb > :last-child \{ min-height: 0; overflow: auto; \}/);
  });
  it('leaves most of the scroller to the form', () => {
    // Sticky height = the canvas (as wide as the scroller, at most 28vh tall) + 8px above and below.
    const sticky = (width, vh) => Math.min(width * 9 / 16, vh * 0.28) + 16;
    // 771 x 1211 (desktop rules): sheet 860px tall, header 71px, content padding 44px; the scroller is 659px wide
    const a = { scroller: 860 - 71 - 44, sticky: sticky(771 - 64 - 48, 1211) };
    assert.equal(a.scroller, 745);
    assert.ok(Math.abs(a.sticky - 355.1) < 0.1);
    assert.ok(a.scroller - a.sticky > 380);
    // 390 x 780 (desktop rules, as measured): sheet min(88vh, 724) = 686.4px, header 67px, content padding 38px; 330px wide
    const b = { scroller: 686.4 - 67 - 38, sticky: sticky(390 - 24 - 36, 780) };
    assert.ok(Math.abs(b.scroller - 581.4) < 0.1);
    assert.ok(Math.abs(b.sticky - 201.6) < 0.1);
    assert.ok(b.scroller - b.sticky > 370);
    // 390 x 780 on a phone (html.touch: the sheet stops at 76vh): 592.8 - 67 - 38; 334px wide
    const c = { scroller: 592.8 - 67 - 38, sticky: sticky(390 - 20 - 36, 780) };
    assert.ok(c.scroller - c.sticky > 280);
    // 667 x 375: under 521px tall nothing is sticky, so the whole scroller (204px, 170px on a phone) scrolls
    assert.ok(375 < 521);
  });
});

describe('dead rules are gone', () => {
  it('no rule for classes nothing creates', () => {
    const ui = read('ui.js') + read('main.js');
    for (const sel of ['.pill ', '.pill{', '.channel-pill', '.profile .edit', '.emo-tabs', '.emo-grid', '.emo-own', '#boot .kicker', '#boot .credit', '.vipbtn']) {
      assert.equal(css.includes(sel), false, sel);
    }
    // every class name ui.js and main.js put on an element
    const used = new Set([...ui.matchAll(/class(?:Name)?(?::| =) '([^']*)'/g)].flatMap((m) => m[1].split(/\s+/)));
    for (const cls of ['pill', 'channel-pill', 'edit', 'emo-tabs', 'emo-grid', 'emo-own', 'kicker', 'credit', 'vipbtn']) assert.equal(used.has(cls), false, cls);
    // the ones still in use keep their rules
    assert.ok(used.has('emo') && used.has('emo-row'));
    assert.match(css, /\.emo \{/);
    assert.match(css, /\.sheet \.more \.emo-row \{/);
    assert.match(css, /\.locpill \{/);
    assert.match(css, /\.waypill \{/);
  });
});

describe('멍때리기 clears the view', () => {
  it('ui.js marks the HUD while the tour runs, and the stylesheet hides what lies over the boards but keeps the way out', () => {
    const ui = read('ui.js');
    const paint = ui.slice(ui.indexOf('function paintLounge('), ui.indexOf('function paintLounge(') + 500);
    assert.match(paint, /root\.classList\.toggle\('lounging', !!on\);/);
    const m = css.match(/#ui\.lounging > \.hud-l,([^{]*)\{([^}]*)\}/);
    assert.ok(m, 'no #ui.lounging rule');
    const sel = '#ui.lounging > .hud-l,' + m[1];
    for (const gone of ['.hud-l', '.hud-r > :not(.bar)', '.news', '.help']) assert.ok(sel.includes('#ui.lounging > ' + gone), gone);
    assert.match(m[2], /visibility: hidden !important;/);
    // the lounge line, the dock (그만) and 시점 해제 are not in the list
    for (const kept of ['.dock', '.stay-lounge', '.stay-focus', '.bar,']) assert.equal(sel.includes('#ui.lounging > ' + kept), false, kept);
  });
});

describe('toasts and the game panels', () => {
  it('while the bake or the dance panel is up the toasts go to the top, as they do over a sheet', () => {
    const m = css.match(/body\.has-sheet \.toasts,([^{]*)\{([^}]*)\}/);
    assert.ok(m, 'no toast-at-top rule');
    for (const sel of ['body.has-proof .toasts', 'body:has(#ui > .bake.show) .toasts', 'body:has(#ui > .rhythm.show) .toasts']) assert.ok(m[1].includes(sel), sel);
    assert.match(m[2], /bottom: auto !important;/);
    // the bake panel is 112px up and about 170px tall: the default toast line (196px up) is inside it
    const bake = px(rule(css, '.bake'), 'bottom'), toasts = px(rule(css, '.toasts'), 'bottom');
    assert.ok(toasts > bake && toasts < bake + 170);
  });
  it('on a phone the panels are along the bottom, so a notice keeps its place under the left column', () => {
    const phone = media('(orientation: portrait) and (max-width: 599px), (orientation: landscape) and (max-height: 520px)', '--stack-top');
    assert.match(rule(phone, 'html.touch body:has(#ui > .bake.show) .toasts'), /top: var\(--stack-top, 182px\);/);
    // the dance panel reaches that place on a phone on its side (it is centred and 350px tall): only upright
    const up = media('(orientation: portrait) and (max-width: 599px)', '--stack-top');
    assert.match(rule(up, 'html.touch body:has(#ui > .rhythm.show) .toasts'), /top: var\(--stack-top, 182px\);/);
    assert.equal(phone.includes('.rhythm.show'), false);
  });
});

describe('compact phone HUD (a touch phone upright or on its side)', () => {
  const ui = read('ui.js');
  const Q = '(orientation: portrait) and (max-width: 599px), (orientation: landscape) and (max-height: 520px)';
  const box = media(Q, '.id-coin');
  // The column is min(62vw, 240px, 40vmax) wide: 40vmax is 40vw on its side, so landscape keeps min(240px, 40vw).
  const colW = (vw, vh) => Math.min(vw * 0.62, 240, Math.max(vw, vh) * 0.4);
  it('ui.js asks the same media query as the stylesheet, and only on a touch device', () => {
    assert.equal(COMPACT_HUD_Q, Q);
    assert.match(ui, /const compactMq = matchMedia\(COMPACT_HUD_Q\);\n\s*const compactNow = \(\) => coarse && compactMq\.matches;/);
    assert.match(ui, /compactMq\.addEventListener\?\.\('change', \(\) => placeGoal\(\)\);/);
    // the new pieces are hidden by default, so tablets and desktop windows look as they did
    assert.match(css, /\.id-coin, \.hud-r \.view-btn, \.wal-quick, \.phone-only \{ display: none; \}/);
    // every rule in the block starts with html.touch (the nested query too)
    for (const line of box.split('\n').map((s) => s.trim()).filter(Boolean)) {
      if (line === '}') continue;
      assert.ok(line.startsWith('html.touch ') || /^@media \([^{]*\) \{ html\.touch /.test(line), line);
    }
  });
  it('portrait: the left column is at most 62% wide and 136px tall, in thumb-sized rows (it was 172 x 418px at 360 x 780)', () => {
    const col = rule(box, 'html.touch .hud-l');
    assert.match(col, /display: grid;/);
    assert.match(col, /width: min\(62vw, 240px, 40vmax\);/);
    assert.match(col, /max-width: min\(62vw, 240px, 40vmax\);/);
    for (const [vw, vh] of [[320, 640], [360, 780], [390, 844], [430, 932]]) assert.ok(colW(vw, vh) <= vw * 0.62 + 0.01, String(vw));
    assert.equal(Math.round(colW(360, 780)), 223);
    assert.equal(colW(390, 844), 240);
    const gap = px(col, 'gap');
    // identity row: the avatar (30px on touch) + 7px padding above and below + the card's 1px border each side: its two
    // buttons are 44px tall
    assert.match(rule(box, 'html.touch .ident .profile'), /padding: 7px 7px 7px 6px;/);
    const ident = px(rule(css, 'html.touch .avatar'), 'height') + 2 * 7 + 2;
    assert.ok(ident - 2 >= 44);
    // goal pill: one 22px line, 6px padding, 1px border; guest pill: the 36px button alone
    const goal = rule(box, 'html.touch .hud-l > .nextgoal:not(.task)');
    assert.match(goal, /white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/);
    const pill = px(goal, 'line-height') + 2 * px(goal, 'padding') + 2;
    const guest = px(rule(box, 'html.touch .hud-l > .guestwarn .btn'), 'height');
    assert.match(rule(box, 'html.touch .hud-l > .guestwarn p'), /display: none;/);
    assert.equal(pill, 36);
    assert.equal(guest, 36);
    // the pills take taps over 44px and are 8px apart, so their touch rows meet and never overlap (they overlapped by 5px)
    const hit = rule(box, 'html.touch .hud-l > .nextgoal:not(.task)::after, html.touch .hud-l > .guestwarn .btn::after');
    const grow = -Number(hit.match(/inset: (-?\d+)px 0;/)[1]);
    assert.equal(pill + 2 * grow, 44);
    assert.equal(2 * grow, gap);
    const tall = ident + gap + pill + gap + guest;
    assert.equal(tall, 46 + 8 + 36 + 8 + 36);
    assert.ok(tall <= 136);
    // the wallet card and the live board are gone from the column
    assert.match(rule(box, 'html.touch .hud-l > .wallet, html.touch .hud-l > .liveboard'), /display: none;/);
  });
  it('the column ends well above the floating stick\'s zone, and its top row stops 8px left of the tool row', () => {
    // 360 x 780 before: the column reached 10 + 418 = 428px, into the stick zone (from 351px down)
    assert.ok(10 + 418 > 780 * (1 - STICK_H));
    // the column (to 144px), the 속보 slot and one three-line notice (to about 260px) end above the stick zone on a 640px phone
    for (const vh of [640, 780, 844]) assert.ok(10 + 134 + 46 + 70 <= vh * (1 - STICK_H), String(vh));
    // tool row: 40px buttons 4px apart, 3px padding and a 1px border each side, 8px from the right; four buttons, five with
    // 받은 소식 (they were 36px with no gap between them)
    const tools = rule(css, 'html.touch .tools'), btn = rule(css, 'html.touch .tools .btn');
    assert.equal(px(tools, 'height'), 48);
    assert.equal(px(tools, 'gap'), 4);
    assert.equal(px(btn, 'width'), 40);
    assert.equal(px(btn, 'height'), 40);
    // each button takes taps over the row's whole height and half the gap on each side: 44 x 48px
    assert.match(css, /html\.touch \.tools:not\(\.open\) \.btn::after \{ inset: -4px -2px; \}/);
    const row = (n) => n * 40 + (n - 1) * 4 + 2 * 3 + 2;
    assert.equal(row(4), 180);
    assert.match(rule(box, 'html.touch .hud-l > .ident'), /max-width: min\(100%, calc\(100vw - 206px - var\(--safe-l\) - var\(--safe-r\)\)\);/);
    assert.match(rule(box, 'html.touch #ui:has(.tool-inbox:not([hidden])) .hud-l > .ident'), /max-width: min\(100%, calc\(100vw - 250px - var\(--safe-l\) - var\(--safe-r\)\)\);/);
    for (const vw of [320, 360, 390, 430]) {
      assert.equal(vw - 8 - row(4) - (10 + vw - 206), 8, String(vw));
      assert.equal(vw - 8 - row(5) - (10 + vw - 250), 8, String(vw));
    }
    // a name that does not fit ends in "…": the span inside the flex row is what clips (text-overflow does nothing on a flex row)
    assert.match(rule(css, '.profile .name > span'), /min-width: 0; overflow: hidden; text-overflow: ellipsis;/);
  });
  it('landscape keeps the column min(240px, 40vw) wide, so the ticker and the taxi HUD still start past it', () => {
    for (const [vw, vh] of [[568, 320], [667, 375], [740, 360], [780, 360], [844, 390]]) assert.equal(colW(vw, vh), Math.min(240, vw * 0.4), String(vw));
  });
  it('the identity row carries the coin amount (tap: the wallet sheet) and a +N badge while coins wait', () => {
    assert.match(ui, /const idCoin = h\('button', \{ class: 'id-coin', type: 'button', 'aria-label': '내 응원 포인트', title: '응원 포인트 · 정산 안내', onclick: \(\) => openWalletInfo\(\) \}/);
    assert.match(ui, /h\('div', \{ class: 'glass ident' \}, profile, idCoin, channelCard\)/);
    assert.match(ui, /idAmt\.textContent = amtEl\.textContent;/);
    assert.match(ui, /idPend\.hidden = pendingChip\.hidden;/);
    assert.match(ui, /const badge = `\+\$\{money\(wallet\.pending\)\}`;/);
    // the badge sits under the amount (a second grid row), so it never widens the row and squeezes the name
    assert.match(rule(box, 'html.touch .ident .id-coin'), /display: grid; grid-template-rows: auto auto;/);
    assert.match(rule(box, 'html.touch .id-coin .pend'), /grid-row: 2;/);
    assert.match(rule(box, 'html.touch .id-coin .pend'), /font-size: 12px;/); // it was 10px
    // under 400px upright the coin picture steps aside for the name (the wider tool row took 28px from the identity row)
    assert.match(box, /@media \(orientation: portrait\) and \(max-width: 399px\) \{ html\.touch \.id-coin img \{ display: none; \} \}/);
  });
  it('the next goal is one line under the identity row, with a small 목표 tag in place of "다음 목표: "', () => {
    assert.match(ui, /if \(compactNow\(\)\) \{ if \(nextLine\.nextElementSibling !== guestWarn\) guestWarn\.before\(nextLine\); \}/);
    assert.match(ui, /else if \(newbieOn\) walletEl\.before\(nextLine\);\n\s*else walletEl\.querySelector\('\.sub'\)\?\.append\(nextLine\);/);
    // syncNewbie and the end of setup both go through placeGoal
    assert.equal((ui.match(/\bplaceGoal\(\);/g) || []).length, 2);
    assert.match(ui, /nextLine\.replaceChildren\(h\('span', \{ class: 'ng-k', text: m\[1\] \}\), document\.createTextNode\(m\[2\]\)\);/);
    assert.match(rule(box, 'html.touch .hud-l > .nextgoal:not(.task) .ng-k::before'), /content: "목표";/);
    // the newcomer card keeps its own look: only its row is set
    assert.match(rule(box, 'html.touch .hud-l > .nextgoal'), /grid-row: 2;/);
    assert.equal(box.includes('.nextgoal.task'), false);
  });
  // The coin-2x gauge (fever) is gone with the points for play: no chip, no rules for it.
  it('there is no fever gauge any more', () => {
    assert.equal(/\.fever\b/.test(css), false);
    assert.equal(/feverEl|feverText|feverChip|코인 2배|2배 코인/.test(ui), false);
  });
  it('the wallet chips are rows at the top of the wallet sheet with their own taps, and 광장 소식 opens from the ranks sheet', () => {
    const w = ui.slice(ui.indexOf('  function openWalletInfo() {'), ui.indexOf('  function openFeed() {'));
    assert.equal(ui.includes('sessionChip'), false); // the 놀이 n/30 chip went with the points for play
    for (const re of [/quickRow\(todayBtn, \(\) => openToday\(\)\)/, /quickRow\(holdBtn, \(\) => openHolds\(\)\)/, /quickRow\(tribeBtn, \(\) => openTribeSheet\(\)\)/, /protectLine\.hidden \? \[\] : \[h\('button', \{ class: 'btn ghost wide', type: 'button', onclick: \(e\) => protectGo\(e\) \}/]) assert.match(w, re);
    assert.match(w, /host\.append\(\n\s*quick,/);
    assert.match(rule(box, 'html.touch .wal-quick'), /display: grid;/);
    assert.ok(px(rule(box, 'html.touch .wal-quick .btn'), 'min-height') >= 44);
    const r = ui.slice(ui.indexOf('  function openRanks('), ui.indexOf('  function openCredits() {'));
    assert.match(r, /h\('button', \{ class: 'btn ghost phone-only', type: 'button', onclick: \(\) => openFeed\(\) \}/);
    assert.match(rule(box, 'html.touch .sheet .phone-only'), /display: flex;/);
  });
  it('화면만 보기: the eye under the map hides the HUD, keeps the stick, the action buttons and itself, and lasts one tab session', () => {
    assert.match(ui, /const viewBtn = h\('button', \{ class: 'view-btn', type: 'button', 'aria-label': '화면만 보기', title: '화면만 보기', 'aria-pressed': 'false'/);
    assert.match(ui, /root\.classList\.toggle\('viewonly', !!on\);/);
    assert.match(ui, /sessionStorage\.setItem\('kts_viewonly', on \? '1' : '0'\)/);
    assert.match(ui, /if \(sessionStorage\.getItem\('kts_viewonly'\) === '1'\) setViewOnly\(true\);/);
    assert.match(ui, /mapEl,\n\s*locPill,\n\s*viewRow,\n/);
    // the eye sits in the row under the map (.viewrow) with 멍때리기: of that row only the eye stays
    const m = box.match(/html\.touch #ui\.viewonly > :is\(([^)]*)\), html\.touch #ui\.viewonly > \.hud-r > :not\(\.viewrow\), html\.touch #ui\.viewonly > \.hud-r > \.viewrow > :not\(\.view-btn\) \{([^}]*)\}/);
    assert.ok(m, 'no #ui.viewonly rule');
    const hidden = m[1].split(', ');
    for (const gone of ['.hud-l', '.news', '.prompt', '.waypill', '.dock', '.reacts']) assert.ok(hidden.includes(gone), gone);
    for (const kept of ['.joy', '.acts', '.toasts', '.proof', '.bake', '.rhythm', '.taxihud']) assert.equal(hidden.includes(kept), false, kept);
    assert.match(m[2], /visibility: hidden !important;/);
    // the hiding rule is inside the compact block: a tablet or a desktop window never hides its HUD
    assert.equal(css.replace(box, '').includes('#ui.viewonly'), false);
  });
  it('멍때리기 ends from one pill in the corner: the tile under the map is shown alone while its column is hidden', () => {
    // the whole right column is hidden during the tour; the button in it is made visible again and fixed to the corner
    assert.match(css, /#ui\.lounging > :is\(\.hud-r, \.prompt, \.waypill, \.stay-focus, \.reacts, \.joy, \.acts, \.help\) \{ visibility: hidden !important; \}/);
    const stop = rule(css, 'html.touch #ui.lounging .viewrow > .stay-lounge-btn');
    assert.match(stop, /visibility: visible !important; position: fixed;/);
    assert.equal(px(stop, 'right'), 16);
    assert.equal(px(stop, 'bottom'), 14);
    assert.ok(px(stop, 'height') >= 44);
    // the notices take the bottom edge left of it (and no top: the phone's stack rule sets one)
    assert.match(rule(css, 'html.touch body:has(#ui.lounging) .toasts'), /top: auto;[^}]*right: calc\(150px \+ var\(--safe-r\)\);[^}]*bottom: calc\(14px \+ var\(--safe-b\)\) !important;/);
    // a desktop window: its notice is along the bottom edge too, not on the middle of the board being watched
    assert.equal(px(rule(css, 'html:not(.touch) body:has(#ui.lounging) .toasts'), 'bottom'), 24);
    assert.match(ui, /if \(label\) label\.textContent = on \? '그만 보기' : '멍때리기';/);
    // the start notice is two words, the top line says what is on; no notice when it ends
    const main = read('main.js');
    assert.match(main, /ui\.note\(loungeFull \? '오늘 관람 포인트는 다 받았어요 · 움직이면 끝나요' : '움직이면 끝나요', 'ok'\);/);
    assert.equal(/관람을 마쳤어요|8초마다 다음 전광판 · 움직이면/.test(main), false);
    assert.match(ui, /setIconText\(loungeEl, 'coffee', `전광판 관람 중 · 관람 포인트 \+\$\{loungeN\}`\);/);
  });
});
