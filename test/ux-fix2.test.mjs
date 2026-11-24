// The owner's six HUD reports after using the 2026-11-24 build (each one an example of a class): the tool row's form and
// order, the centred pieces, the spacing in sheets, one notice per kind, the pouch icon and the bare coin number.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as overlay from '../overlay.js';
import { ICONS } from '../uiicons.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ui = read('ui.js');
const main = read('main.js');
const html = read('index.html');
const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
/** The body of the first @media block whose query is exactly `query` and which holds `has`. */
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
function rule(scope, selector) {
  const m = scope.match(new RegExp('(^|[}\\n])\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}'));
  assert.ok(m, 'no rule ' + selector);
  return m[2];
}

// ---- 1. the tool row: one form, the order of use ------------------------------------------------------------------------
describe('1. the tool row: one form at every desktop width, in the order of use', () => {
  const ORDER = overlay.TOOL_ORDER;
  it('one order for the row, the phone row and the ⋯ menu: core, gift, wish, social, self, window, settings', () => {
    assert.deepEqual(ORDER, ['tool-board', 'tool-gift', 'tool-wish', 'tool-rank', 'tool-inbox', 'tool-shot', 'tool-vip', 'tool-hub', 'tool-keys', 'tool-fs', 'tool-set', 'tool-fold']);
    // every tool button ui.js makes carries its class, and the row is written in that order
    const block = ui.slice(ui.indexOf("h('div', { class: 'glass tools' },"), ui.indexOf('    mapEl,\n'));
    const inRow = [...block.matchAll(/class: 'btn [^']*\b(tool-[a-z]+)\b/g)].map((m) => m[1]).filter((c) => ORDER.includes(c));
    for (const [v, c] of [['wishBtn', 'tool-wish'], ['inboxBtn', 'tool-inbox'], ['fsBtn', 'tool-fs']]) {
      assert.ok(block.includes(v), v);
      assert.match(ui, new RegExp(`const ${v} = h\\('button', \\{ class: '[^']*\\b${c}\\b`));
    }
    const written = block.replace(/wishBtn/, "class: 'btn tool-wish").replace(/inboxBtn/, "class: 'btn tool-inbox").replace(/fsBtn/, "class: 'btn tool-fs");
    const seq = [...written.matchAll(/class: 'btn [^']*?\b(tool-(?:board|wish|rank|inbox|shot|vip|hub|fs|set|fold))\b/g)].map((m) => m[1]);
    assert.deepEqual(seq, ORDER.filter((c) => seq.includes(c)));
    assert.ok(inRow.length >= 6);
    // gift.js adds 선물 전광판 after the wish button and the key card adds 조작 안내: placeTools sorts them into place (the
    // DOM order is what Tab and a screen reader follow, so it is sorted, not a CSS order)
    assert.match(ui, /new MutationObserver\(placeTools\)\.observe\(toolsEl, \{ childList: true \}\);/);
    assert.match(ui, /const rank = \(el\) => \{ const i = TOOL_ORDER\.findIndex\(\(c\) => el\.classList\.contains\(c\)\);/);
    assert.match(ui, /'btn ghost icon tool-desk tool-keys t-1440'/);
  });
  it('placeTools puts 선물 전광판 second and 조작 안내 before 전체 화면 and 설정', () => {
    const src = ui.slice(ui.indexOf('  function placeTools() {'), ui.indexOf('  if (toolsEl && typeof MutationObserver'));
    const el = (cls) => ({ cls, classList: { contains: (c) => c === cls } });
    const made = ['tool-board', 'tool-wish', 'tool-gift', 'tool-rank', 'tool-inbox', 'tool-shot', 'tool-vip', 'tool-hub', 'tool-fs', 'tool-set', 'tool-fold', 'tool-keys'].map(el);
    const toolsEl = { children: made, append(...k) { this.children = k; } };
    new Function('toolsEl', 'TOOL_ORDER', src + '\nplaceTools();')(toolsEl, ORDER);
    assert.deepEqual(toolsEl.children.map((e) => e.cls), ORDER);
  });
  it('from 1024px every tool in the row carries its name; what does not fit is in ⋯, never a mixed row', () => {
    const wide = media('(min-width: 1024px)', '.tool-fold::after');
    assert.match(rule(wide, 'html:not(.touch) .tools > .btn'), /width: auto;/);
    assert.match(rule(wide, 'html:not(.touch) .tools > .btn::after'), /content: attr\(aria-label\);/);
    assert.match(rule(wide, 'html:not(.touch) .tools > .tool-fold::after'), /content: "더보기";/);
    assert.match(rule(wide, 'html:not(.touch) .tools:not(.open) > :is(.t-1280, .t-1440, .t-1680)'), /display: none;/);
    // no rule names only some of the tools any more
    assert.equal(/\.tools[^{]*\.named\b/.test(css), false);
    assert.equal(/class: 'btn [^']*\bnamed\b/.test(ui), false);
    for (const [q, cls] of [['(min-width: 1280px)', 't-1280'], ['(min-width: 1440px)', 't-1440'], ['(min-width: 1680px)', 't-1680']]) {
      assert.match(media(q, cls), new RegExp(`html:not\\(\\.touch\\) \\.tools:not\\(\\.open\\) > \\.${cls} \\{ display: inline-flex; \\}`));
    }
    // the width the named row takes at each width (measured in Chrome: 13px names, 10 + 12px padding, 22px icon, 6px gap,
    // 4px between buttons, 4px padding and a 1px border each side) stays clear of the left column (it ends at 354px) by 12px
    const W = { 'tool-board': 109, 'tool-gift': 109, 'tool-wish': 109, 'tool-rank': 98, 'tool-inbox': 98, 'tool-shot': 122, 'tool-vip': 98, 'tool-hub': 85, 'tool-keys': 98, 'tool-fs': 98, 'tool-set': 72, 'tool-fold': 85 };
    const tier = { 'tool-shot': 1280, 'tool-vip': 1280, 'tool-hub': 1440, 'tool-keys': 1440, 'tool-fs': 1680, 'tool-set': 1680 };
    assert.match(ui, /'btn icon tool-more tool-shot t-1280'/);
    assert.match(ui, /'btn icon tool-more tool-adv tool-vip t-1280'/);
    assert.match(ui, /'btn icon tool-more tool-adv tool-hub t-1440'/);
    assert.match(ui, /tool-fs t-1680'/);
    assert.match(ui, /'btn ghost icon tool-more tool-set t-1680'/);
    for (const vw of [1024, 1100, 1280, 1366, 1440, 1680, 1920]) {
      const shown = ORDER.filter((c) => !(tier[c] > vw) && !(c === 'tool-fold' && vw >= 1680));
      const row = shown.reduce((s, c) => s + W[c], 0) + 4 * (shown.length - 1) + 10;
      assert.ok(vw - 14 - row >= 354 + 12, `${vw}: ${shown.join(' ')} = ${row}px`);
    }
  });
  it('the ⋯ menu lists every tool as an icon + name row, and choosing one closes it', () => {
    const wide = media('(min-width: 1024px)', '.tool-fold::after');
    assert.match(rule(wide, 'html:not(.touch) .tools.open'), /position: absolute;[^}]*grid-template-columns: 1fr;/);
    assert.match(rule(wide, 'html:not(.touch) .tools.open > .btn'), /display: inline-flex; width: 100%;/);
    assert.match(ui, /toolsEl\?\.addEventListener\('click', \(e\) => \{ if \(toolsEl\.classList\.contains\('open'\) && e\.target\.closest\?\.\('\.tools > \.btn:not\(\.tool-fold\)'\)\) foldTools\(false\); \}\);/);
  });
});

// ---- 2. the centred pieces -----------------------------------------------------------------------------------------------
describe('2. the waypoint pill and the 속보 slot are on the screen\'s centre', () => {
  const px = (decls, prop) => Number(decls.match(new RegExp('(?:^|[;\\s])' + prop + ': calc\\((-?[\\d.]+)px'))[1]);
  it('a desktop window from 1024px: a symmetric box, so the pill\'s centre is the viewport\'s', () => {
    const wide = media('(min-width: 1024px)', '.waypill .way');
    const box = rule(wide, 'html:not(.touch) .news, html:not(.touch) .waypill');
    const l = px(box, 'left'), r = px(box, 'right');
    assert.equal(l, r);
    const pill = rule(css, 'html:not(.touch) .waypill');
    assert.match(pill, /width: fit-content;/);
    assert.match(pill, /margin: 0 auto;/);
    // a named pill is about 160-190px wide (measured): it fits centred at 1024 (268px) and up, clear of the left column
    for (const vw of [1024, 1280, 1440, 1920]) {
      const room = vw - l - r;
      assert.ok(room >= 190, String(vw));
      const w = Math.min(190, room);
      assert.equal(l + (room - w) / 2 + w / 2, vw / 2);
      assert.ok(vw / 2 - w / 2 >= 354 + 12);
    }
    // before: the band between the two columns, centred 78px right of the screen's centre
    assert.equal(378 + (1280 - 378 - 222) / 2 - 640, 78);
  });
  it('a phone on its side (641px and up): the same distance from both edges', () => {
    const land = media('(orientation: landscape) and (max-height: 520px)', 'width: min(300px');
    for (const sel of ['html.touch .news', 'html.touch .waypill']) {
      const d = rule(land, sel);
      const left = d.match(/left: ([^;]+);/)[1], right = d.match(/right: ([^;]+);/)[1];
      assert.equal(left, right, sel);
      assert.match(left, /min\(240px, 40vmax\) \+ 18px/);
    }
    // the band is wider than the icon row's 196px at every phone width: min(240, 40% of the long side) + 18 >= 196
    for (const vw of [641, 740, 812, 932]) assert.ok(Math.min(240, 0.4 * vw) + 18 >= 196, String(vw));
    // under 641px the band is too narrow for the pill (568px: 78px): it keeps its place above the tag
    assert.match(land, /@media \(max-width: 640px\) \{ html\.touch \.waypill \{ top: auto; bottom: calc\(92px/);
  });
});

// ---- 3. spacing in sheets --------------------------------------------------------------------------------------------------
describe('3. sheets: tappable neighbours 8px apart with a mouse and 12px on touch, groups 16px apart', () => {
  it('one shared rule: .row (it had none, so its buttons touched) and every group of buttons, chips, tabs and swatches', () => {
    assert.match(css, /:root \{ --tap-gap: 8px; --group-gap: 16px; \}/);
    assert.match(css, /html\.touch \{ --tap-gap: 12px; \}/);
    // a grid of equal cells (four in a row where they fit, two on a phone), so a wrapped last button is not a lone wide bar
    assert.match(rule(css, '.sheet .row'), /display: grid; grid-template-columns: repeat\(auto-fit, minmax\(112px, 1fr\)\); align-items: stretch; gap: var\(--tap-gap\); margin-top: var\(--group-gap\);/);
    const groups = css.match(/\.sheet :is\(([^)]*)\) \{ gap: var\(--tap-gap\); \}/);
    assert.ok(groups);
    for (const g of ['.chips', '.seg', '.place .go', '.themes', '.swatches', '.colors', '.plots', '.species-grid']) assert.ok(groups[1].includes(g), g);
    assert.match(css, /\.sheet :is\(\.chips, \.holder, \.field\) \{ margin-top: var\(--group-gap\); \}/);
    // the touch rules that set 8px themselves follow the shared value
    assert.match(css, /html\.touch \.sheet \.chips \{ gap: var\(--tap-gap\); \}/);
    assert.equal(/html\.touch \.sheet \.chips \{ gap: 8px; \}/.test(css), false);
  });
  it('the held board\'s sheet: its link buttons and the four 네온 스티커 are .row groups', () => {
    const ad = ui.slice(ui.indexOf('  function openAd('), ui.indexOf('  function photoNews('));
    assert.match(ad, /h\('div', \{ class: 'row' \},\n\s+url \? h\('button', \{ type: 'button', class: 'btn ghost', text: '링크 열기'/);
    const st = ui.slice(ui.indexOf('  function stickerBox('), ui.indexOf('  function openReport('));
    assert.match(st, /h\('div', \{ class: 'row' \}, \.\.\.STICKER_GLYPHS\.map/);
  });
});

// ---- 4. one notice per kind ------------------------------------------------------------------------------------------------
function rig() {
  let now = 0, seq = 0;
  const timers = new Map();
  const set = (f, ms) => { const id = ++seq; timers.set(id, { f, at: now + ms }); return id; };
  const clear = (id) => timers.delete(id);
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      timers.delete(next[0]); now = next[1].at; next[1].f();
    }
    now = end;
  };
  const el = (tag, cls = '') => {
    const n = { tag, kids: [], parent: null, text: '' };
    const s = new Set(cls.split(/\s+/).filter(Boolean));
    n.classList = { add: (k) => s.add(k), remove: (k) => s.delete(k), contains: (k) => s.has(k), toggle: (k, on) => { if (on ?? !s.has(k)) s.add(k); else s.delete(k); } };
    n.append = (...cs) => { for (const c of cs) { if (c && typeof c === 'object') { c.remove?.(); c.parent = n; n.kids.push(c); } else if (typeof c === 'string') n.text += c; } };
    n.remove = () => { if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = null; };
    n.addEventListener = () => {};
    Object.defineProperty(n, 'children', { get: () => n.kids });
    Object.defineProperty(n, 'isConnected', { get: () => !!n.parent });
    return n;
  };
  const toasts = el('div', 'toasts');
  toasts.querySelectorAll = () => toasts.kids.filter((k) => k.classList.contains('hit') && !k.classList.contains('out'));
  const h = (tag, props, ...kids) => { const n = el(tag, props?.class || ''); n.append(...kids.filter((k) => k != null)); return n; };
  const src = ui.slice(ui.indexOf('  function note('), ui.indexOf('  const newsQueue = []'));
  const api = new Function('h', 'icon', 'toasts', 'toolsEl', 'reactPanel', 'document', 'toastMs', 'toastText', 'setTimeout', 'clearTimeout', 'Date', src + '\nreturn { note };')(
    h, () => null, toasts, el('div', 'tools'), { hidden: true }, { documentElement: { classList: { contains: () => false } } }, overlay.toastMs, overlay.toastText, set, clear, { now: () => now });
  const live = () => toasts.kids.filter((k) => !k.classList.contains('out'));
  // what the stylesheet shows: the newest plain one and the newest tappable one
  const shown = () => { const l = live(); return l.filter((t, i) => !l.slice(i + 1).some((u) => u.classList.contains('hit') === t.classList.contains('hit'))); };
  return { note: api.note, advance, live, shown, timers };
}

describe('4. a repeated notice of the same kind is one notice', () => {
  it('the same key twice: one row with the new text and a fresh timer', () => {
    const r = rig();
    r.note('다음 응원까지 9초', '', null, { key: 'cheer-wait' });
    r.advance(2000);
    const t = r.note('다음 응원까지 7초', '', null, { key: 'cheer-wait' });
    assert.equal(r.live().length, 1);
    assert.equal(r.live()[0], t);
    assert.equal(t.text, '다음 응원까지 7초');
    assert.ok(t.classList.contains('again')); // no second entrance animation
    const ms = overlay.toastMs('다음 응원까지 7초');
    r.advance(ms - 100);
    assert.ok(!t.classList.contains('out'), 'its time started over');
    r.advance(200);
    assert.ok(t.classList.contains('out'));
  });
  it('the same text without a key is the same notice too', () => {
    const r = rig();
    r.note('공유 링크를 복사했어요', 'ok');
    r.note('공유 링크를 복사했어요', 'ok');
    assert.equal(r.live().length, 1);
  });
  it('ten fast presses: one row', () => {
    const r = rig();
    for (let n = 10; n > 0; n--) { r.note(`다음 응원까지 ${n}초`, '', null, { key: 'cheer-wait' }); r.advance(120); }
    assert.equal(r.live().length, 1);
    assert.equal(r.live()[0].text, '다음 응원까지 1초');
  });
  it('different keys: both kept, and the two-row rule shows the newest plain and the newest tappable one', () => {
    const r = rig();
    const login = r.note('로그아웃됐어요 · 다시 로그인', '', () => {});
    r.note('다음 응원까지 5초', '', null, { key: 'cheer-wait' });
    r.note('다음 함성까지 3초', '', null, { key: 'shout-wait' });
    assert.equal(r.live().length, 3);
    assert.deepEqual(r.shown().map((t) => t.text), ['로그아웃됐어요 · 다시 로그인', '다음 함성까지 3초']);
    assert.ok(login.isConnected);
  });
  it('a keyed plain notice never replaces a tappable one with the same key', () => {
    const r = rig();
    const hit = r.note('연결 보상을 다시 받기', 'err', () => {}, { key: 'offline' });
    r.note('광장 서버에 연결되면 응원이 기록됩니다', 'err', null, { key: 'offline' });
    assert.ok(hit.isConnected);
    assert.equal(r.live().length, 2);
  });
  it('every desktop window and tablet shows two rows at most, as a phone does', () => {
    assert.match(css, /(^|\n)\s*\.toasts > \.toast:not\(\.hit\):has\(~ \.toast:not\(\.hit\)\), \.toasts > \.toast\.hit:has\(~ \.toast\.hit\) \{ display: none; \}/);
    assert.match(css, /\.toast\.again:not\(\.out\) \{ animation: none; \}/);
  });
  it('the notices a repeated tap or a repeating event raises carry a key', () => {
    for (const [file, src, re] of [
      ['main.js', main, /ui\.note\(`다음 응원까지 \$\{Math\.ceil\(wait \/ 1000\)\}초`, '', null, \{ key: 'cheer-wait' \}\)/],
      ['main.js', main, /ui\.note\('잠시 뒤 다시 응원해 주세요', 'err', null, \{ key: 'cheer-wait' \}\)/],
      ['main.js', main, /ui\.note\(`다음 함성까지 [^`]*`, '', null, \{ key: 'shout-wait' \}\)/],
      ['main.js', main, /ui\.note\(`다음 포춘쿠키까지 [^`]*`, '', null, \{ key: 'fortune-wait' \}\)/],
      ['main.js', main, /ui\.note\(`🙏 \$\{CHEER_PHRASES\[p - 1\]\}`, 'ok', null, \{ key: 'cheer-sent' \}\)/],
      ['main.js', main, /ui\.note\('광장 서버에 연결되면 응원이 기록됩니다', 'err', null, \{ key: 'offline' \}\)/],
      ['main.js', main, /ui\.note\(`하차 완료 [^`]*`, 'ok', null, \{ key: 'taxi-drop' \}\)/],
      ['ui.js', ui, /note\(`붕어빵 틀이 식는 중… [^`]*`, '', null, \{ key: 'bake-wait' \}\)/],
    ]) assert.match(src, re, file + ' ' + re);
    // every copy confirmation is one kind
    assert.equal((ui.match(/복사했어요[^']*', 'ok', null, \{ key: 'copied' \}\)/g) || []).length, 8);
    assert.equal(/복사했어요[^']*', 'ok'\)/.test(ui), false);
  });
});

// ---- 5. the pouch icon -----------------------------------------------------------------------------------------------------
describe('5. the pouch buttons show a lucky pouch, not an envelope', () => {
  it('a drawstring bag: a round body, the gathered frill, the tie, a knot and two cord ends', () => {
    const p = ICONS.pouch;
    assert.ok(Array.isArray(p));
    assert.equal(p.filter((s) => Array.isArray(s) && s[0] === 'circle').length, 1); // the knot
    assert.equal(p.filter((s) => Array.isArray(s) && s[0] === 'rect').length, 0); // no box
    assert.equal(p.filter((s) => typeof s === 'string').length, 5);
  });
  it('both pouch buttons (the 동작 panel row or desktop pill, and the round throw button) use it', () => {
    assert.equal((ui.match(/icon\('pouch'\)/g) || []).length, 2);
    assert.equal(/icon\('packet'\)/.test(ui), false);
  });
});

// ---- 6. the coin before the number ---------------------------------------------------------------------------------------
describe('6. an upright phone shows the coin before the 응원 포인트 number', () => {
  it('no rule hides the coin under 400px any more; the row gets tighter instead', () => {
    assert.equal(/html\.touch \.id-coin img \{ display: none; \}/.test(css), false);
    const Q = '(orientation: portrait) and (max-width: 599px), (orientation: landscape) and (max-height: 520px)';
    const box = media(Q, '.id-coin');
    assert.match(box, /@media \(orientation: portrait\) and \(max-width: 399px\) \{ html\.touch \.ident \.id-coin \{ padding: 0 8px 0 5px; \}/);
    assert.match(box, /@media \(orientation: portrait\) and \(max-width: 359px\) \{ html\.touch \.ident \.id-coin \{ padding: 0 6px 0 4px; font-size: 14px; \}/);
    // the name gives way with "…"
    assert.match(rule(css, '.profile .name > span'), /min-width: 0; overflow: hidden; text-overflow: ellipsis;/);
  });
  it('the button is named by what it shows: 응원 포인트 201', () => {
    assert.match(ui, /'aria-label': '응원 포인트 0', title: '응원 포인트 · 정산 안내'/);
    assert.match(ui, /idCoin\.setAttribute\('aria-label', `응원 포인트 \$\{amtEl\.textContent\}`\);/);
  });
});
