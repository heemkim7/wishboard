// The HUD stylesheet in index.html: places where two things used to lie on each other. The numbers are worked out from
// the rules themselves (a browser is not available to the tests), so each case names the viewport and the two boxes.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COMPACT_HUD_Q, feverChip, STICK_H } from '../interact.js';

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
  it('the look-around hint is in the lower middle: off the left column, the dock, the stick and the waypoint pill', () => {
    const coach = rule(css, 'html.touch .coach');
    assert.match(coach, /top: auto;/);
    assert.match(coach, /transform: none;/);
    const bottom = px(coach, 'bottom'), right = px(coach, 'right');
    // 390 x 780: the resting stick ends 36 + 104 = 140px up, the waypoint pill 142 + 38 = 180px up, toasts start at 228px
    const joy = rule(css, 'html.touch .joy');
    assert.ok(bottom >= px(joy, 'bottom') + px(joy, 'height') + 12);
    const way = rule(media('(orientation: portrait)', '.waypill'), 'html.touch .waypill');
    assert.ok(bottom >= px(way, 'bottom') + 38 + 8);
    // one line of 12px text is 12 * 1.35 + 16 + 2 = 34.2px tall: its top stays under the toasts
    assert.ok(bottom + 34.2 <= px(rule(css, 'html.touch .toasts'), 'bottom'));
    // the dock and the action buttons are 52px wide, 12px from the right
    assert.ok(right >= 12 + 52 + 12);
  });
  it('the look-around hint is one line, a little smaller under 374px', () => {
    assert.match(rule(css, 'html.touch .coach'), /white-space: nowrap;/);
    const narrow = media('(max-width: 373px)', '.coach');
    assert.equal(px(rule(narrow, 'html.touch .coach'), 'font-size'), 11);
    assert.match(read('ui.js'), /class: 'coach', role: 'status', hidden: true, text: '끌어서 둘러보기 · 두 손가락으로 확대'/);
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

describe('touch landscape on a phone (height up to 520px)', () => {
  const land = media('(orientation: landscape) and (max-height: 520px)', '.stay-ticket');
  // The left column: 14px in above 640px wide (10px at or under), at most min(240px, 40vw) wide.
  const leftCol = (vw) => (vw > 640 ? 14 : 10) + Math.min(240, vw * 0.4);
  const inset = (vw) => Math.min(240, vw * 0.4) + 26;
  it('the ticker starts 12px past the identity card and ends before the folded tool row', () => {
    const t = rule(land, 'html.touch .stay-ticket');
    assert.match(t, /left: calc\(min\(240px, 40vw\) \+ 26px \+ var\(--safe-l\)\);/);
    assert.match(t, /transform: none;/);
    assert.match(t, /width: auto;/);
    assert.match(rule(land, 'html.touch .hud-l'), /max-width: min\(240px, 40vw\);/);
    for (const vw of [568, 640, 667, 740, 767]) assert.ok(inset(vw) - leftCol(vw) >= 12, String(vw));
    // 667px: before, a 260px ticker centred at 333.5px started at 203.5px, 50.5px inside the card (which ends at 254px)
    assert.equal(leftCol(667), 254);
    assert.equal(667 / 2 - 130, 203.5);
    assert.equal(inset(667), 266);
    // the folded tool row is at most 5 x 36 + 8 = 188px wide, 8px from the right
    assert.ok(px(t, 'right') >= 8 + 188 + 12);
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
    // the look-around hint ends left of the dock column
    assert.ok(px(rule(land, 'html.touch .coach'), 'right') >= px(dock, 'right') + 52 + 12);
  });
  it('a news line lifts the waypoint pill over it instead of lying on it', () => {
    const news = rule(land, 'html.touch .news'), way = rule(land, 'html.touch #ui:has(> .news.show) .waypill');
    assert.ok(px(way, 'bottom') >= px(news, 'bottom') + px(news, 'height') + 8);
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
    // under 641px the ticker (bottom 10px, 32px tall) and the news bar (bottom 50px, 40px tall) are along the bottom
    assert.ok(px(rule(small, 'html:not(.touch) .help'), 'bottom') >= 50 + 40 + 12);
  });
  it('the waypoint pill gives the news bar its row: under it from 1090px, faded out at 820-1089px', () => {
    const wide = media('(min-width: 820px)', '.news');
    const news = rule(wide, 'html:not(.touch) .news');
    assert.match(rule(wide, 'html:not(.touch) #ui:has(> .news.show) .waypill'), /opacity: 0;[^}]*pointer-events: none !important;/);
    const top = media('(min-width: 1090px)', 'news.show');
    const way = rule(top, 'html:not(.touch) #ui:has(> .news.show) .waypill');
    assert.ok(px(way, 'top') >= px(news, 'top') + 46 + 8);
    assert.match(way, /opacity: 1;/);
  });
  it('the news bar never shares a row with the tool row (14px to 60px from the top)', () => {
    const toolBottom = 14 + 46;
    const wide = media('(min-width: 820px)', '.news');
    assert.ok(px(rule(wide, 'html:not(.touch) .news'), 'top') >= toolBottom + 8);
    const mid = media('(min-width: 641px) and (max-width: 819px)', '.news');
    assert.ok(px(rule(mid, 'html:not(.touch) .news'), 'top') >= 384 + 32 + 8); // under the ticker of that range
    // 820-900px: the bar is centred 78px right of the middle, min(440, vw - 600) wide: right of the card, left of the minimap
    for (const vw of [820, 860, 900]) {
      const w = Math.min(440, vw - 600), cx = vw / 2 + 78;
      assert.ok(cx - w / 2 >= IDENT_RIGHT + 12, String(vw));
      assert.ok(cx + w / 2 <= vw - 14 - 184 - 12, String(vw));
    }
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
    for (const gone of ['.hud-l', '.hud-r > :not(.bar)', '.news', '.stay-ticket', '.help']) assert.ok(sel.includes('#ui.lounging > ' + gone), gone);
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
    assert.match(css, /\.id-coin, \.hud-r > \.view-btn, \.wal-quick, \.phone-only, \.fever \.fs \{ display: none; \}/);
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
    assert.match(ui, /const idCoin = h\('button', \{ class: 'id-coin', type: 'button', 'aria-label': '내 지갑', title: '지갑 · 정산 안내', onclick: \(\) => openWalletInfo\(\) \}/);
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
  it('the fever gauge is a chip beside the goal only while it moves', () => {
    assert.deepEqual(feverChip(null), { show: false, text: '2배 0/20' });
    assert.deepEqual(feverChip({ phase: '', gauge: 0 }), { show: false, text: '2배 0/20' });
    assert.deepEqual(feverChip({ phase: '', gauge: 3 }), { show: true, text: '2배 3/20' });
    assert.deepEqual(feverChip({ phase: 'count', gauge: 20, left: 4.2 }), { show: true, text: '2배까지 5초' });
    assert.deepEqual(feverChip({ phase: 'party', gauge: 20, left: 41.5 }), { show: true, text: '2배 42초' });
    assert.match(rule(box, 'html.touch .hud-l > .fever.idle'), /display: none;/);
    assert.match(rule(box, 'html.touch .hud-l > .fever'), /grid-row: 2; grid-column: 2;/);
    assert.match(ui, /class: 'glass fever idle'/);
    // the mission sheet quotes the long text only
    assert.match(ui, /text: `\$\{feverText\.textContent\}\. \$\{feverEl\.title\}`/);
  });
  it('the wallet chips are rows at the top of the wallet sheet with their own taps, and 광장 소식 opens from the ranks sheet', () => {
    const w = ui.slice(ui.indexOf('  function openWalletInfo() {'), ui.indexOf('  function standings() {'));
    for (const re of [/quickRow\(todayBtn, \(\) => openToday\(\)\)/, /quickRow\(sessionChip, \(\) => openToday\(\)\)/, /quickRow\(holdBtn, \(\) => openHolds\(\)\)/, /quickRow\(tribeBtn, \(\) => openTribeSheet\(\)\)/, /protectLine\.hidden \? \[\] : \[h\('button', \{ class: 'btn ghost wide', type: 'button', onclick: \(e\) => protectGo\(e\) \}/]) assert.match(w, re);
    assert.match(w, /host\.append\(\n\s*quick,/);
    assert.match(rule(box, 'html.touch .wal-quick'), /display: grid;/);
    assert.ok(px(rule(box, 'html.touch .wal-quick .btn'), 'min-height') >= 44);
    const r = ui.slice(ui.indexOf('  function openRanks() {'), ui.indexOf('  function openCredits() {'));
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
    for (const gone of ['.hud-l', '.news', '.stay-ticket', '.prompt', '.waypill', '.dock', '.reacts']) assert.ok(hidden.includes(gone), gone);
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
    const land = media('(orientation: landscape) and (max-height: 520px)', '.stay-ticket');
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
