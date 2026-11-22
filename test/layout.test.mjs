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

describe('touch portrait', () => {
  it('the open reactions panel is above the fixed pouch balloon', () => {
    const portrait = media('(orientation: portrait)', '.stay-balloon');
    assert.equal(Number(rule(portrait, 'html.touch .hud-r .stay-balloon').match(/z-index: (\d+)/)[1]), 7);
    assert.match(css, /html\.touch \.reacts \{ z-index: 8; \}/);
  });
  it('the look-around hint is the bottom of the floating stack: above the stick and the waypoint pill, no box of its own', () => {
    // ui.js puts it first in the toasts' column on touch, so it is the bottom piece and the toasts climb over it
    assert.match(read('ui.js'), /if \(coarse\) toasts\.prepend\(coachEl\);/);
    const coach = rule(css, '.coach');
    assert.equal(/position:|bottom:|left:|transform:/.test(coach), false);
    assert.equal(css.includes('html.touch .coach {'), css.includes('html.touch .coach { white-space: normal;'));
    // 390 x 844: the resting stick ends 36 + 104 = 140px up, the waypoint pill 142 + 38 = 180px up; the stack starts at 190px
    const stack = rule(css, 'html.touch .toasts');
    const joy = rule(css, 'html.touch .joy');
    assert.ok(px(stack, 'bottom') >= px(joy, 'bottom') + px(joy, 'height') + 12);
    const way = rule(css, 'html.touch .waypill');
    assert.ok(px(stack, 'bottom') >= px(way, 'bottom') + 38 + 8);
    // before, the hint had its own box (190px up, 16px … right 76px): 30px left of the toasts' centre and 55px left of the lane's at 390px
    assert.equal((16 + 390 - 76) / 2, 165);
  });
  it('the look-around hint is one line upright, and two lines in the 175-222px stack of a phone on its side under 641px', () => {
    assert.match(rule(css, '.coach'), /white-space: nowrap;/);
    assert.match(rule(css, '.coach'), /font: 700 12px\/1\.35 var\(--font\);/);
    assert.match(read('ui.js'), /h\('div', \{ class: 'coach', role: 'status', hidden: true \}, h\('span', \{ text: '끌어서 둘러보기' \}\), h\('span', \{ class: 'sep', text: ' · ' \}\), h\('span', \{ text: '두 손가락으로 확대' \}\)\)/);
    const narrow = media('(orientation: landscape) and (max-height: 520px) and (max-width: 640px)', '.coach');
    assert.match(rule(narrow, 'html.touch .coach'), /white-space: normal;/);
    assert.match(rule(narrow, 'html.touch .coach > span'), /display: block;/);
    assert.match(rule(narrow, 'html.touch .coach > .sep'), /display: none;/);
    // there it steps aside for a toast: 50px of hint and a three-line toast do not both fit under the tool row at 320px tall
    assert.match(rule(narrow, 'html.touch .toasts:has(> .toast) > .coach'), /display: none;/);
    // the 11px size under 374px is gone: upright the stack is at least 320 - 84 = 236px wide and one 12px line is about 199px
    assert.equal(css.includes('(max-width: 373px)'), false);
    assert.ok(320 - 84 >= 199);
  });
  it('on a phone the four actions are a named row in the panel, and the dock circles carry captions', () => {
    const ui = read('ui.js');
    assert.match(ui, /reactPanel\.prepend\(h\('p', \{ class: 'rh', text: '동작' \}\), \.\.\.dock\.querySelectorAll\('\.emote:not\(\.more\)'\), h\('p', \{ class: 'rh', text: '리액션' \}\)\);/);
    assert.match(ui, /if \(cap\) cap\.textContent = '동작';/);
    assert.match(css, /html\.touch \.reacts button\.emote \.l \{ display: block;/);
    assert.match(css, /html\.touch \.dock button\.emote\.more \.l, html\.touch \.dock button\.stay-lounge-btn \.l \{ display: block;/);
    // the caption rule comes after the rules that hid dock labels on touch
    assert.ok(css.indexOf('html.touch .dock button.emote.more .l') > css.indexOf('html.touch .dock .stay-lounge-btn .l { display: none; }'));
    // portrait: four 44px columns; 4 x 44 + 3 x 4 gaps + 12 padding = 200px, 8px from the right of a 320px phone
    assert.ok(8 + 4 * 44 + 3 * 4 + 12 < 320 - 76);
  });
  it('every dock button is 52 x 52: the old 48px rules for the more and lounge buttons are gone', () => {
    assert.equal(css.includes('html.touch .dock .emote.more'), false);
    assert.equal(/html\.touch \.dock \.stay-lounge-btn \{ width: 48px/.test(css), false);
    assert.match(css, /html\.touch \.dock \.emote,\n\s*html\.touch \.dock \.stay-lounge-btn,\n\s*html\.touch \.hud-r \.stay-balloon \{ width: 52px; height: 52px; min-width: 52px;/);
    assert.match(css, /html\.touch \.emote\.more \{ width: 52px; height: 52px; border-radius: 50%; \}/);
  });
});

describe('touch bottom lane: the news line, the prompt and the waypoint pill are one stack', () => {
  const ui = read('ui.js');
  const slot = rule(css, 'html.touch .news');
  const prompt = rule(css, 'html.touch .prompt');
  const way = rule(css, 'html.touch .waypill');
  const joy = rule(css, 'html.touch .joy');
  const acts = rule(css, 'html.touch .acts');
  const LAND = '(orientation: landscape) and (max-height: 520px)';
  const land = media(LAND, 'html.touch .waypill, html.touch .news, html.touch .prompt');
  const landWide = media(LAND + ' and (min-width: 641px)', '.prompt');
  const landBlock = media(LAND, '.taxihud');
  it('upright and on tablets the three share one lane between the resting stick and the right-hand buttons', () => {
    for (const r of [slot, prompt, way]) {
      assert.equal(px(r, 'left'), 122);
      assert.equal(px(r, 'right'), 72);
      assert.match(r, /margin: 0 auto;/);
      assert.match(r, /top: auto;/);
    }
    for (const r of [slot, prompt]) {
      assert.match(r, /width: auto;/);
      assert.equal(px(r, 'max-width'), 440);
    }
    assert.match(way, /width: fit-content;/);
    assert.match(prompt, /transform: translateY\(8px\) scale\(\.96\);/);
    assert.match(rule(css, 'html.touch .prompt.show'), /transform: none;/);
    assert.match(rule(css, 'html.touch .prompt button'), /width: 100%;/);
    // 8px clear of the resting stick (104px, 10px in) and of the 52px edge column 12px from the right
    assert.ok(px(slot, 'left') >= px(joy, 'left') + px(joy, 'width') + 8);
    assert.ok(px(slot, 'right') >= px(acts, 'right') + 52 + 8);
    // 390px: 196px wide, centred at 220px for all three (before: 168px and 168px at 195px, 202px at 219px)
    assert.equal(390 - 122 - 72, 196);
  });
  it('from the bottom: the slot, the prompt 6px above it, the pill above the stick and a four-line prompt', () => {
    assert.equal(px(slot, 'bottom'), 8);
    assert.equal(px(slot, 'height'), 32);
    assert.equal(px(prompt, 'bottom'), px(slot, 'bottom') + px(slot, 'height') + 6);
    // the prompt is 6px padding, a 32px key cap or up to four 12px lines (about 15px each), 6px padding and a 1px border
    const tallest = 6 + 4 * 15.5 + 6 + 2;
    assert.ok(px(prompt, 'bottom') + tallest <= px(way, 'bottom') - 8);
    assert.equal(px(way, 'bottom'), 142);
    assert.ok(px(way, 'bottom') >= px(joy, 'bottom') + px(joy, 'height'));
    // the news line is one line here (no kicker line), the slot's height
    assert.match(rule(css, 'html.touch .news .body small'), /display: none;/);
    assert.match(rule(css, 'html.touch .news .body strong'), /line-height: 30px;/);
    // the stick stays put while a news line shows: nothing moves the prompt or the pill
    assert.equal(/#ui:has\(> \.news\.show\)[^{]*\.(prompt|waypill)/.test(css), false);
  });
  it('a phone on its side: right of the stick and left of the dock column, and from 641px on the toasts\' centre', () => {
    const r = rule(land, 'html.touch .waypill, html.touch .news, html.touch .prompt');
    // the stick is 88px wide there; the dock column is 52px wide, 76px from the right
    assert.equal(px(rule(landBlock, 'html.touch .joy'), 'width'), 88);
    assert.ok(px(r, 'left') >= 10 + 88 + 8);
    assert.ok(px(r, 'right') >= px(rule(landBlock, 'html.touch .dock'), 'right') + 52 + 12);
    assert.equal(px(rule(land, 'html.touch .waypill'), 'bottom'), 108);
    // two prompt lines (46px) end 54px under the pill; the floating stack (the hint, a card, the toasts) is 8px above the pill
    assert.ok(46 + 46 + 8 <= 108);
    const toasts = rule(media(LAND, '.toasts'), 'html.touch .toasts');
    assert.ok(px(toasts, 'bottom') >= 108 + 38 + 8);
    const wide = rule(landWide, 'html.touch .waypill, html.touch .news, html.touch .prompt');
    const leftOf = (d) => d.match(/left: (calc\([^;]*\));/)[1];
    assert.equal(leftOf(wide), leftOf(toasts));
    assert.equal(px(r, 'right'), px(toasts, 'right'));
  });
  it('the 화면만 보기 and 멍때리기 rules still name the stack pieces', () => {
    assert.match(css, /#ui\.viewonly > :is\(\.hud-l, \.news, \.prompt, \.waypill,/);
    assert.match(css, /#ui\.lounging > \.news, #ui\.lounging > \.help/);
    assert.equal(css.includes('.stay-ticket'), false); // the 5-minute draw line is gone (no lottery)
    // the slot is no longer emptied while driving: the taxi HUD is at the top on touch
    assert.equal(css.includes('html.touch #ui:has(.taxihud:not([hidden])) .news'), false);
    assert.match(css, /html\.touch #ui:has\(\.taxihud:not\(\[hidden\]\)\) \.waypill \{ display: none; \}/);
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
  });
});

describe('touch toasts and the pouch count', () => {
  const ui = read('ui.js');
  it('toasts stay clear of the right-hand buttons (the star line used to cover 멍때리기)', () => {
    const t = rule(css, 'html.touch .toasts');
    assert.match(t, /transform: none;/);
    // upright: the dock and the pouch are 52px wide, 12px from the right
    assert.ok(px(t, 'right') >= 12 + 52 + 8);
    assert.equal(px(t, 'left'), px(t, 'right'));
    assert.match(rule(css, 'html.touch .toast'), /word-break: keep-all;/);
    // on its side: left of the dock column (76px from the right) and the pouch on top of it
    const land = rule(media('(orientation: landscape) and (max-height: 520px)', '.toasts'), 'html.touch .toasts');
    assert.ok(px(land, 'right') >= 76 + 52 + 12);
  });
  it('the pouch is an icon in its circle with the count as a badge on the edge, at most 999+', () => {
    const paint = ui.slice(ui.indexOf('function balloonText('), ui.indexOf('setInterval(paintBalloon, 1000);'));
    assert.match(paint, /balloonEl\.replaceChildren\(icon\('packet'\), h\('span', \{ class: 'bn', text \}\)\);/);
    assert.match(paint, /balloonText\(coarse \? \(left > 999 \? '999\+' : `\$\{left\}`\) : `\$\{left\}번 남음 · 터뜨려 보세요`\);/); // play: no points
    const bn = rule(css, 'html.touch .hud-r .stay-balloon .bn');
    assert.match(bn, /position: absolute;/);
    assert.ok(px(bn, 'top') < 0 && px(bn, 'right') < 0);
    assert.match(bn, /white-space: nowrap;/);
    assert.match(rule(css, 'html.touch .hud-r .stay-balloon:disabled .bn'), /background: var\(--surface-2\);/);
    // the badge needs a positioned button where the phone rules do not fix it (tablets); the phone rules come later
    assert.ok(css.indexOf('html.touch .hud-r .stay-balloon { position: relative; }') < css.indexOf('html.touch .hud-r .stay-balloon { position: fixed;'));
    // on its side the badge (8px past the circle's right edge) stays clear of the edge column: 76 - 8 > 12 + 52
    assert.ok(76 - 8 > 12 + 52);
  });
});

describe('the floating stack: the hint, a far-board card, 홈 화면 추가, a lottery result, a board\'s card and the toasts are one column', () => {
  const ui = read('ui.js');
  const stack = rule(css, 'html.touch .toasts');
  const piece = rule(css, 'html.touch .toasts > *');
  const lane = rule(css, 'html.touch .waypill');
  const LAND = '(orientation: landscape) and (max-height: 520px)';
  const landStack = media(LAND, '.toasts');
  const narrow = media(LAND + ' and (max-width: 640px)', '.farcard');
  it('ui.js puts every floating card in the toasts\' column, under the toasts, and a burst of toasts drops only toasts', () => {
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
    // note(): over three toasts the oldest plain toast goes; a card in the column is never counted or dropped
    const note = ui.slice(ui.indexOf('  function note('), ui.indexOf('  const newsQueue = []'));
    assert.match(note, /const shown = \(\) => \[\.\.\.toasts\.children\]\.filter\(\(c\) => c\.classList\.contains\('toast'\)\);/);
    assert.match(note, /for \(let list = shown\(\); list\.length > 3; list = shown\(\)\) \(list\.find\(\(c\) => c !== t && !c\.classList\.contains\('hit'\)\) \|\| list\[0\]\)\.remove\(\);/);
    assert.equal(note.includes('toasts.firstChild'), false);
  });
  it('upright and on tablets each piece is centred on the bottom lane\'s centre, and a wider one grows left, never into the right-hand column', () => {
    const L = px(stack, 'left'), R = px(stack, 'right');
    assert.equal(L, 72);
    assert.equal(R, 72);
    assert.match(piece, /align-self: flex-start;/);
    const off = Number(piece.match(/margin-left: calc\(50% \+ (\d+)px\);/)[1]);
    const extra = Number(piece.match(/max-width: calc\(100% \+ (\d+)px\);/)[1]);
    const k = Number(piece.match(/translate: min\(-50%, calc\(50vw - (\d+)px - \(var\(--safe-l\) \+ var\(--safe-r\)\) \/ 2 - 100%\)\);/)[1]);
    const acts = rule(css, 'html.touch .acts');
    for (const vw of [320, 360, 375, 390, 412, 430, 600, 768, 1024]) {
      const B = vw - L - R;
      const C = L + B / 2 + off; // where the margin puts a piece's left edge, before the translate
      // that is the lane's centre (122px … right 72px), where the slot, the prompt and the pill are centred
      assert.equal(C, (px(lane, 'left') + vw - px(lane, 'right')) / 2, String(vw));
      const room = vw / 2 - k; // from that centre to the stack's right edge
      assert.equal(room, vw - R - C, String(vw));
      for (const w of [96, 160, 198, 246, 306, 346]) {
        if (w > B + extra) continue;
        const left = C + Math.min(-w / 2, room - w), right = left + w;
        assert.ok(right <= vw - R + 1e-9, vw + ' ' + w);
        // 8px clear of the dock, the pouch and the action buttons (52px wide, 12px in)
        assert.ok(right <= vw - px(acts, 'right') - 52 - 8, vw + ' ' + w);
        assert.ok(left >= L - extra - 1e-9, vw + ' ' + w);
        if (w <= 2 * room) assert.equal(left + w / 2, C, vw + ' ' + w);
      }
    }
    // 390px: a short toast and the hint (198px) are centred on 220px like the pill; the star toast (306px) runs 12 … 318px
    assert.equal(390 / 2 - k, 98);
    // before: the toasts were centred 72px in on each side, the hint 16px … right 76px (195, 165 and 220px at 390)
    assert.equal(L + (390 - L - R) / 2, 195);
  });
  it('the stack starts above the resting stick and the waypoint pill; the pieces have no box of their own', () => {
    const joy = rule(css, 'html.touch .joy');
    assert.equal(px(stack, 'bottom'), 190);
    assert.ok(px(stack, 'bottom') >= px(joy, 'bottom') + px(joy, 'height') + 12);
    assert.ok(px(stack, 'bottom') >= px(lane, 'bottom') + 38 + 8);
    const far = rule(css, '.farcard'), home = rule(css, '.a2hs');
    assert.equal(css.includes('.stay-draw'), false);
    for (const r of [far, home, rule(css, '.coach')]) {
      assert.equal(/(^|[;\s])(left|bottom|top): /.test(r), false, r);
      assert.equal(/position: (absolute|fixed)/.test(r), false, r);
    }
    assert.equal(css.includes('html.touch .a2hs { bottom'), false);
    assert.match(rule(css, 'html.touch .a2hs'), /width: min\(360px, calc\(100% \+ 60px\)\);/);
  });
  it('the far-board card shows its name: it wraps its buttons to a second row instead of squeezing the name to nothing', () => {
    // as a box at left: 50% it could never be wider than half the screen: 195px at 390px, the three buttons alone 156px
    assert.ok(390 / 2 - 24 - 2 - 12 - 3 * 48 - 2 * 6 < 10);
    const far = rule(css, '.farcard');
    assert.match(far, /flex-wrap: wrap;/);
    assert.match(far, /width: max-content; max-width: 100%;/);
    assert.match(rule(css, '.farcard .where'), /flex: 1 1 140px; min-width: 0;/);
    assert.match(rule(css, '.farcard .far-acts'), /margin-left: auto;/);
    const btn = rule(css, 'html.touch .farcard .far-acts button');
    assert.match(btn, /padding: 0 8px;/);
    // three 44px buttons and two 6px gaps (144px) fit the narrowest stack upright (320 - 84 = 236px) and on its side from 641px
    const row = 3 * 44 + 2 * 6, card = 2 * 12 + 2;
    assert.ok(row + card <= 320 - 84);
    assert.ok(row + card <= 641 - Math.min(240, 641 * 0.4) - 26 - 140);
    // one row from 406px upright (name 140px), two rows below
    assert.equal(card + 140 + 12 + row, 322);
    assert.ok(430 - 84 >= 322 && 390 - 84 < 322);
  });
  it('a card in the stack sends the hint aside, a far-board card sends 홈 화면 추가 aside, and over a sheet only the toasts show', () => {
    assert.match(css, /\.toasts:has\(> \.farcard, > \.a2hs:not\(\[hidden\]\), > \.sponsor:not\(\[hidden\]\)\) > \.coach \{ display: none; \}/);
    assert.match(css, /\.toasts:has\(> \.farcard\) > \.a2hs \{ display: none; \}/);
    assert.match(css, /body\.has-sheet \.toasts > :not\(\.toast\), body\.has-proof \.toasts > :not\(\.toast\), body:has\(#ui > \.bake\.show\) \.toasts > :not\(\.toast\), body:has\(#ui > \.rhythm\.show\) \.toasts > :not\(\.toast\) \{ display: none; \}/);
    // up there the toasts are centred 72px in, as before, not on the lane
    const top = css.match(/html\.touch body\.has-sheet \.toasts > \*, html\.touch body\.has-proof \.toasts > \*, html\.touch body:has\(#ui > \.bake\.show\) \.toasts > \*, html\.touch body:has\(#ui > \.rhythm\.show\) \.toasts > \* \{([^}]*)\}/);
    assert.ok(top, 'no reset for the toasts at the top');
    assert.match(top[1], /align-self: center; margin-left: 0; max-width: 100%; translate: none;/);
    assert.ok(css.indexOf(top[0]) > css.indexOf('html.touch .toasts > * {'));
  });
  it('a board\'s card (focus link, taxi drop-off) is in the stack on touch, and 시점 해제 takes the prompt\'s place in the lane', () => {
    const sp = rule(css, 'html.touch .toasts > .sponsor');
    assert.match(sp, /pointer-events: auto;/);
    assert.match(sp, /width: min\(420px, calc\(100% \+ 60px\)\);/);
    assert.match(rule(css, 'html.touch .toasts > .sponsor .chips'), /flex-wrap: nowrap; overflow-x: auto;/);
    // a desktop window still lifts its toasts over the card; touch no longer moves its stack to 400px up
    assert.match(css, /html:not\(\.touch\) body\.has-sponsor \.toasts \{ bottom: calc\(360px \+ var\(--safe-b\)\); \}/);
    assert.equal(css.includes('html.touch body.has-sponsor'), false);
    assert.equal(css.includes('html.touch #ui > .sponsor'), false);
    // 시점 해제 sits where the prompt is, which is hidden while the focus camera is on (it was 310px up, on the card's chips)
    const focus = rule(css, 'html.touch .stay-focus');
    const prompt = rule(css, 'html.touch .prompt');
    for (const p of ['bottom', 'left', 'right']) assert.equal(px(focus, p), px(prompt, p), p);
    assert.match(ui, /const show = !!near && !baking && !sheet && !dance && !driving && !focusOn;/);
    assert.match(media(LAND, 'html.touch .stay-focus { left: calc(106px'), /html\.touch \.stay-focus \{ left: calc\(106px \+ var\(--safe-l\)\); right: calc\(140px \+ var\(--safe-r\)\); \}/);
  });
  it('a phone on its side: from 154px up (114px without a pill), one toast at a time, the far-board card in the lane under 641px', () => {
    const s = rule(landStack, 'html.touch .toasts');
    assert.equal(px(s, 'bottom'), 108 + 38 + 8);
    assert.match(landStack, /html\.touch body:not\(:has\(#ui > \.waypill:not\(\[hidden\]\)\)\) \.toasts \{ bottom: calc\(114px \+ var\(--safe-b\)\); \}/);
    // a three-line prompt there is 6 + 3 x 15.5 + 6 + 2 = 60.5px tall from 46px up
    assert.ok(114 >= 46 + 6 + 3 * 15.5 + 6 + 2 + 6);
    assert.match(rule(landStack, 'html.touch .toasts > *'), /align-self: center; margin-left: 0; max-width: 100%; translate: none;/);
    assert.match(rule(landStack, 'html.touch .toasts > .toast:has(~ .toast)'), /display: none;/);
    assert.match(rule(landStack, 'html.touch .toasts > .sponsor p'), /display: none;/);
    // under 641px the column is 175-222px: the card would need two rows (108px), so it is one row in the lane for its 4 s
    const far = rule(narrow, 'html.touch .toasts > .farcard');
    const landLane = rule(media(LAND, 'html.touch .waypill, html.touch .news, html.touch .prompt'), 'html.touch .waypill, html.touch .news, html.touch .prompt');
    assert.match(far, /position: fixed;/);
    assert.equal(px(far, 'left'), px(landLane, 'left'));
    assert.equal(px(far, 'right'), px(landLane, 'right'));
    assert.equal(px(far, 'bottom'), px(rule(css, 'html.touch .prompt'), 'bottom'));
    assert.match(far, /flex-wrap: nowrap;/);
    assert.match(narrow, /html\.touch body:has\(\.toasts > \.farcard\) #ui > :is\(\.prompt, \.waypill\) \{ visibility: hidden; \}/);
    // 568px: the lane is 322px, the card's row is 182px plus the name (140px)
    assert.equal(568 - 106 - 140, 2 * 12 + 2 + 12 + 3 * 44 + 2 * 6 + 140);
    // the lane's card (46 + 66 = 112px) ends under the stack even without a pill
    assert.ok(46 + 66 <= 114);
  });
  it('화면만 보기 hides the hint and the board\'s card in the stack too, and keeps the toasts', () => {
    const Q = '(orientation: portrait) and (max-width: 599px), (orientation: landscape) and (max-height: 520px)';
    assert.match(media(Q, '.id-coin'), /html\.touch body:has\(> #ui\.viewonly\) \.toasts > :is\(\.coach, \.sponsor\) \{ display: none !important; \}/);
  });
});

describe('touch landscape on a phone (height up to 520px)', () => {
  const land = media('(orientation: landscape) and (max-height: 520px)', '.taxihud');
  // The left column: 14px in above 640px wide (10px at or under), at most min(240px, 40vw) wide.
  const leftCol = (vw) => (vw > 640 ? 14 : 10) + Math.min(240, vw * 0.4);
  const inset = (vw) => Math.min(240, vw * 0.4) + 26;
  it('the columns right of the left column (taxi HUD, the floating stack with the hint and the toasts) start 12px past the identity card', () => {
    assert.match(rule(land, 'html.touch .hud-l'), /max-width: min\(240px, 40vw\);/);
    for (const vw of [568, 640, 667, 740, 767]) assert.ok(inset(vw) - leftCol(vw) >= 12, String(vw));
    assert.equal(leftCol(667), 254);
    assert.equal(inset(667), 266);
    const toasts = rule(media('(orientation: landscape) and (max-height: 520px)', '.toasts'), 'html.touch .toasts');
    for (const r of [rule(land, 'html.touch .taxihud'), toasts]) assert.match(r, /left: calc\(min\(240px, 40vw\) \+ 26px \+ var\(--safe-l\)\);/);
  });
  it('while driving, the taxi HUD is between the left column and the right-hand buttons', () => {
    const t = rule(land, 'html.touch .taxihud');
    assert.match(t, /left: calc\(min\(240px, 40vw\) \+ 26px \+ var\(--safe-l\)\);/);
    assert.ok(px(t, 'right') >= 12 + 52 + 12);
    // the base rule (full width, 8px in) comes first, so this one wins
    assert.ok(css.indexOf('html.touch .taxihud { top:') < css.indexOf('(orientation: landscape) and (max-height: 520px)'));
  });
  it('the dock is its own column left of the action buttons, and the pouch balloon sits on top of it', () => {
    const dock = rule(land, 'html.touch .dock');
    const acts = rule(css, 'html.touch .acts');
    // the edge column: 52px buttons 12px from the right, from 36px up; the dock column is 12px left of it, from the same 36px
    assert.equal(px(acts, 'right'), 12);
    assert.equal(px(dock, 'right'), 12 + 52 + 12);
    assert.equal(px(dock, 'bottom'), px(acts, 'bottom'));
    // two dock buttons 10px apart reach 36 + 114 = 150px; the balloon starts 10px above that
    const b = rule(land, 'html.touch .hud-r .stay-balloon');
    assert.match(b, /position: fixed;/);
    assert.equal(Number(b.match(/z-index: (\d+)/)[1]), 7);
    assert.equal(px(b, 'right'), px(dock, 'right'));
    assert.ok(px(b, 'bottom') >= px(dock, 'bottom') + 52 * 2 + 10 + 10);
    // 320px tall: the balloon's top (320 - 160 - 52 = 108px) is under the map only because the location pill steps aside
    // and the map column is 56px wide at the edge (the balloon is 64px in from it)
    assert.match(rule(land, 'html.touch .locpill'), /display: none;/);
    assert.equal(px(rule(land, 'html.touch .minimap'), 'width'), 56);
    // driving: three 52px buttons 6px apart end 36 + 168 = 204px up, under the map's bottom (56 + 56 = 112px down) at 320px tall
    assert.ok(320 - (px(acts, 'bottom') + 3 * 52 + 2 * px(rule(land, 'html.touch .acts'), 'gap')) >= 56 + 56);
    // the panels of the bakery and the dance are centred and reach the dock column on a narrow screen: the dock steps aside
    assert.match(land, /html\.touch #ui:has\(\.bake\.show\) \.dock, html\.touch #ui:has\(\.rhythm\.show\) \.dock \{ visibility: hidden; \}/);
    // the floating stack (the look-around hint among it) ends left of the dock column
    const stack = rule(media('(orientation: landscape) and (max-height: 520px)', '.toasts'), 'html.touch .toasts');
    assert.ok(px(stack, 'right') >= px(dock, 'right') + 52 + 12);
  });
  it('the news line no longer moves the waypoint pill: it takes the draw line\'s slot', () => {
    assert.equal(css.includes('#ui:has(> .news.show) .waypill'), false);
    assert.equal(land.includes('.news'), false);
    assert.equal(land.includes('.prompt'), false);
  });
  it('568-640px wide: while driving the taxi HUD takes the row under the identity card', () => {
    const narrow = media('(orientation: landscape) and (max-height: 520px) and (max-width: 640px)', '.taxihud');
    const t = rule(narrow, 'html.touch .taxihud');
    assert.equal(px(t, 'left'), 10);
    // 568px wide: 568 - 10 - 110 = 448px (it was 239px), and its right edge (458px) is left of the map column (504px)
    assert.equal(568 - px(t, 'left') - px(t, 'right'), 448);
    assert.ok(568 - px(t, 'right') <= 568 - 12 - 56 - 8);
    assert.match(narrow, /html\.touch #ui:has\(\.taxihud:not\(\[hidden\]\)\) \.hud-l > :not\(\.ident\) \{ display: none; \}/);
    assert.match(rule(narrow, 'html.touch .taxihud .keys'), /display: none;/);
  });
  it('the boot card scrolls from the top when it is taller than the screen', () => {
    const boot = rule(css, '#boot');
    assert.match(boot, /overflow-y: auto;/);
    assert.match(boot, /place-items: start center;/);
    assert.equal(/overflow: hidden/.test(boot), false);
    // auto margins centre the card while it fits and are zero when it does not
    assert.match(rule(css, '#boot .wrap'), /margin: auto 0;/);
    assert.match(land, /#boot \.bootmark \{ display: none; \}/);
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
    // from 820px the full row fits again: 11 buttons end 2px right of the card
    assert.ok(820 - 14 - row(11) - IDENT_RIGHT >= 0);
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
    assert.match(css, /\.id-coin, \.hud-r > \.view-btn, \.wal-quick, \.phone-only \{ display: none; \}/);
    // every rule in the block starts with html.touch (the nested query too)
    for (const line of box.split('\n').map((s) => s.trim()).filter(Boolean)) {
      if (line === '}') continue;
      assert.ok(line.startsWith('html.touch ') || /^@media \([^{]*\) \{ html\.touch /.test(line), line);
    }
  });
  it('portrait: the left column is at most 62% wide and 112px tall (it was 172 x 418px at 360 x 780)', () => {
    const col = rule(box, 'html.touch .hud-l');
    assert.match(col, /display: grid;/);
    assert.match(col, /width: min\(62vw, 240px, 40vmax\);/);
    assert.match(col, /max-width: min\(62vw, 240px, 40vmax\);/);
    for (const [vw, vh] of [[320, 640], [360, 780], [390, 844], [430, 932]]) assert.ok(colW(vw, vh) <= vw * 0.62 + 0.01, String(vw));
    assert.equal(Math.round(colW(360, 780)), 223);
    assert.equal(colW(390, 844), 240);
    const gap = px(col, 'gap');
    // identity row: the avatar (30px on touch) + 5px padding above and below + the card's 1px border each side
    assert.match(rule(box, 'html.touch .ident .profile'), /padding: 5px 7px 5px 5px;/);
    const ident = px(rule(css, 'html.touch .avatar'), 'height') + 2 * 5 + 2;
    // goal pill: one 16px line, 6px padding, 1px border; guest pill: the 28px button alone
    const goal = rule(box, 'html.touch .hud-l > .nextgoal:not(.task)');
    assert.match(goal, /white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/);
    const pill = px(goal, 'line-height') + 2 * px(goal, 'padding') + 2;
    const guest = px(rule(box, 'html.touch .hud-l > .guestwarn .btn'), 'height');
    assert.match(rule(box, 'html.touch .hud-l > .guestwarn p'), /display: none;/);
    const tall = ident + gap + pill + gap + guest;
    assert.equal(tall, 42 + 6 + 30 + 6 + 28);
    assert.ok(tall <= 130);
    // the wallet card and the live board are gone from the column
    assert.match(rule(box, 'html.touch .hud-l > .wallet, html.touch .hud-l > .liveboard'), /display: none;/);
  });
  it('the column ends well above the floating stick\'s zone, and its top row stops 8px left of the tool row', () => {
    // 360 x 780 before: the column reached 10 + 418 = 428px, into the stick zone (from 351px down)
    assert.ok(10 + 418 > 780 * (1 - STICK_H));
    for (const vh of [568, 640, 780, 844]) assert.ok(10 + 112 + 12 <= vh * (1 - STICK_H), String(vh));
    // tool row (portrait): 36px buttons, 3px padding and 1px border each side, 8px from the right; four buttons, five with 받은 소식
    const row = (n) => n * 36 + 2 * 3 + 2;
    assert.match(rule(box, 'html.touch .hud-l > .ident'), /max-width: min\(100%, calc\(100vw - 178px - var\(--safe-l\) - var\(--safe-r\)\)\);/);
    assert.match(rule(box, 'html.touch #ui:has(.tool-inbox:not([hidden])) .hud-l > .ident'), /max-width: min\(100%, calc\(100vw - 214px - var\(--safe-l\) - var\(--safe-r\)\)\);/);
    for (const vw of [320, 360, 390, 430]) {
      assert.equal(vw - 8 - row(4) - (10 + vw - 178), 8, String(vw));
      assert.equal(vw - 8 - row(5) - (10 + vw - 214), 8, String(vw));
    }
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
    // under 375px upright the coin picture steps aside for the name
    assert.match(box, /@media \(orientation: portrait\) and \(max-width: 374px\) \{ html\.touch \.id-coin img \{ display: none; \} \}/);
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
    assert.match(ui, /class: 'glass view-btn', type: 'button', 'aria-label': '화면만 보기'/);
    assert.match(ui, /root\.classList\.toggle\('viewonly', !!on\);/);
    assert.match(ui, /sessionStorage\.setItem\('kts_viewonly', on \? '1' : '0'\)/);
    assert.match(ui, /if \(sessionStorage\.getItem\('kts_viewonly'\) === '1'\) setViewOnly\(true\);/);
    assert.match(ui, /mapEl,\n\s*locPill,\n\s*viewBtn,\n/);
    const m = box.match(/html\.touch #ui\.viewonly > :is\(([^)]*)\), html\.touch #ui\.viewonly > \.hud-r > :not\(\.view-btn\) \{([^}]*)\}/);
    assert.ok(m, 'no #ui.viewonly rule');
    const hidden = m[1].split(', ');
    for (const gone of ['.hud-l', '.news', '.prompt', '.waypill', '.dock', '.reacts']) assert.ok(hidden.includes(gone), gone);
    for (const kept of ['.joy', '.acts', '.toasts', '.proof', '.bake', '.rhythm', '.taxihud']) assert.equal(hidden.includes(kept), false, kept);
    assert.match(m[2], /visibility: hidden !important;/);
    // the hiding rule is inside the compact block: a tablet or a desktop window never hides its HUD
    assert.equal(css.replace(box, '').includes('#ui.viewonly'), false);
  });
  it('the eye clears the right-hand buttons: under the map upright, left of the map on its side', () => {
    const eye = 36, hudTop = 8, gap = 6;
    // upright (390 x 844): tool row 40px, map 58px, location pill about 24px, then the eye; the pouch balloon starts 274 + 52px up
    const top = hudTop + 40 + gap + 58 + gap + 24 + gap;
    assert.ok(top + eye + 12 <= 640 - 274 - 52, 'a 640px tall phone');
    // on its side the column under the map belongs to the action buttons (three while driving reach 36 + 168 = 204px up,
    // 116px from the top at 320px tall), so the eye moves left of the 56px map, level with its top
    const side = box.match(/@media \(orientation: landscape\) \{ html\.touch \.hud-r > \.view-btn \{ ([^}]*) \} \}/);
    assert.ok(side, 'no landscape rule for the eye');
    const land = media('(orientation: landscape) and (max-height: 520px)', '.taxihud');
    const mapW = px(rule(land, 'html.touch .minimap'), 'width');
    assert.equal(px(side[1], 'top'), px(rule(css, 'html.touch .tools'), 'height') + gap);
    assert.equal(px(side[1], 'right'), mapW + gap);
    // its right edge (8 + 62px in) stays 6px left of the action column (12 + 52px wide); its bottom (8 + 48 + 36 = 92px) is
    // above the pouch balloon in the dock column (160 + 52px up: 108px from the top at 320px tall)
    const acts = rule(css, 'html.touch .acts');
    assert.ok(8 + px(side[1], 'right') >= px(acts, 'right') + 52 + 6);
    const balloon = rule(land, 'html.touch .hud-r .stay-balloon');
    assert.ok(hudTop + px(side[1], 'top') + eye + 12 <= 320 - px(balloon, 'bottom') - 52);
  });
});
