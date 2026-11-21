// The HUD stylesheet in index.html: places where two things used to lie on each other. The numbers are worked out from
// the rules themselves (a browser is not available to the tests), so each case names the viewport and the two boxes.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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
  it('the pouch balloon is fixed beside the dock, not a static box under it', () => {
    const b = rule(land, 'html.touch .hud-r .stay-balloon');
    assert.match(b, /position: fixed;/);
    assert.equal(Number(b.match(/z-index: (\d+)/)[1]), 7);
    const dock = rule(land, 'html.touch .dock');
    assert.equal(px(b, 'bottom'), px(dock, 'bottom'));
    assert.ok(px(b, 'right') >= px(dock, 'right') + 52 + 12);
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
    const m = css.match(/body.has-sheet .toasts,([^{]*){([^}]*)}/);
    assert.ok(m, 'no toast-at-top rule');
    for (const sel of ['body.has-proof .toasts', 'body:has(#ui > .bake.show) .toasts', 'body:has(#ui > .rhythm.show) .toasts']) assert.ok(m[1].includes(sel), sel);
    assert.match(m[2], /bottom: auto !important;/);
    // the bake panel is 112px up and about 170px tall: the default toast line (196px up) is inside it
    const bake = px(rule(css, '.bake'), 'bottom'), toasts = px(rule(css, '.toasts'), 'bottom');
    assert.ok(toasts > bake && toasts < bake + 170);
  });
});
