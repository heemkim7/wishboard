// The independent review of the 2026-11-24 HUD pass (test/ux-pass.test.mjs, test/layout.test.mjs): five things the pass got
// wrong, each checked here by working the rule out rather than by matching its words where that can be done without a browser.
//   1. a phone shows one notice at a time, and a tappable one is never hidden by a plain one that came after it;
//   2. a tappable notice waits out the ⋯ menu and the 동작 panel instead of running out behind them;
//   3. the pouch is one tap per throw after the first one;
//   4. no text field on touch is under 16px (iOS zooms the page in on one);
//   5. the gift frame over the plaza is modal: Escape closes it alone, the HUD is inert, the plaza's keys do nothing.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toastMs, toastText, createInputLock } from '../overlay.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const styleOf = (page) => { let out = ''; for (const m of page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) out += m[1] + '\n'; return out.replace(/\/\*[\s\S]*?\*\//g, ''); };
const html = read('index.html');
const css = styleOf(html);
const ui = read('ui.js');
const gift = read('gift.js');

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
function rule(scope, selector) {
  const m = scope.match(new RegExp('(^|[}\\n])\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}'));
  assert.ok(m, 'no rule ' + selector);
  return m[2];
}
const px = (decls, prop) => Number(decls.match(new RegExp('(?:^|[;\\s])' + prop + ': (?:calc\\()?(-?[\\d.]+)px'))[1]);
/** Every `selector { declarations }` of a stylesheet, media blocks flattened, in source order. */
function rules(text) {
  const out = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ sel: m[1].trim().replace(/\s+/g, ' '), decls: m[2] });
  return out;
}
/** A selector list split at its top-level commas. */
function list(sel) {
  const out = []; let depth = 0, cur = '';
  for (const c of sel) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/** Specificity [ids, classes, types] of one complex selector (:is/:not/:has count as their most specific argument, :where as 0). */
function spec(sel) {
  const s = [0, 0, 0];
  for (let i = 0; i < sel.length;) {
    const c = sel[i];
    if (c === '#') { s[0]++; i++; while (i < sel.length && /[\w-]/.test(sel[i])) i++; }
    else if (c === '.') { s[1]++; i++; while (i < sel.length && /[\w-]/.test(sel[i])) i++; }
    else if (c === '[') { s[1]++; i = sel.indexOf(']', i) + 1; }
    else if (c === ':' && sel[i + 1] === ':') { s[2]++; i += 2; while (i < sel.length && /[\w-]/.test(sel[i])) i++; }
    else if (c === ':') {
      const name = /^:([\w-]+)/.exec(sel.slice(i))[1];
      i += name.length + 1;
      if (sel[i] === '(') {
        let depth = 0, j = i;
        for (; j < sel.length; j++) { if (sel[j] === '(') depth++; else if (sel[j] === ')' && --depth === 0) break; }
        const arg = sel.slice(i + 1, j);
        i = j + 1;
        if (name === 'where') continue;
        if (/^(is|not|has|matches)$/.test(name)) {
          const best = list(arg.replace(/^[>~+]\s*/, '')).map(spec).sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0] || [0, 0, 0];
          s[0] += best[0]; s[1] += best[1]; s[2] += best[2];
          continue;
        }
      }
      s[1]++;
    }
    else if (/[a-zA-Z]/.test(c)) { s[2]++; while (i < sel.length && /[\w-]/.test(sel[i])) i++; }
    else if (c === '*') i++;
    else i++;
  }
  return s;
}
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// ---- 1. one notice at a time, and a tappable one wins ----------------------------------------------------------------------
// A small selector engine for the shapes the phone's notice rules use: html.touch, .toasts, >, .toast, .hit, :not(.x),
// :has(~ X) and :has(> X). Every display:none rule of the phone block that starts at html.touch .toasts is applied to a
// column of toasts, and what is left on screen is read back.
const PHONE_Q = '(orientation: portrait) and (max-width: 599px), (orientation: landscape) and (max-height: 520px)';
function compound(text) {
  const c = { cls: [], not: [], has: [] };
  let i = 0;
  const word = () => { const m = /^[\w-]+/.exec(text.slice(i)); i += m[0].length; return m[0]; };
  const paren = () => { let depth = 0, j = i; for (; j < text.length; j++) { if (text[j] === '(') depth++; else if (text[j] === ')' && --depth === 0) break; } const arg = text.slice(i + 1, j); i = j + 1; return arg; };
  while (i < text.length) {
    if (text[i] === '.') { i++; c.cls.push(word()); }
    else if (text.startsWith(':not(', i)) { i += 4; c.not.push(compound(paren())); }
    else if (text.startsWith(':has(', i)) { i += 4; const arg = paren().trim(); c.has.push({ rel: arg[0], c: compound(arg.slice(1).trim()) }); }
    else if (/[a-z]/.test(text[i])) c.tag = word();
    else throw new Error('selector not understood here: ' + text);
  }
  return c;
}
function complex(sel) {
  // split at the combinators outside parentheses (:has(~ .toast) keeps its own space)
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of sel.replace(/\s*>\s*/g, ' > ')) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ' ' && !depth) { if (cur) parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) parts.push(cur);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '>') { out[out.length - 1].next = '>'; continue; }
    out.push({ c: compound(parts[i]), next: ' ' });
  }
  return out;
}
function hits(el, c) {
  if (c.tag && el.tag !== c.tag) return false;
  if (!c.cls.every((k) => el.cls.has(k))) return false;
  if (c.not.some((n) => hits(el, n))) return false;
  for (const h of c.has) {
    const pool = h.rel === '~' ? el.parent.kids.slice(el.parent.kids.indexOf(el) + 1) : h.rel === '>' ? el.kids : [];
    if (!pool.some((k) => hits(k, h.c))) return false;
  }
  return true;
}
function matches(el, chain, i = chain.length - 1) {
  if (!el || !hits(el, chain[i].c)) return false;
  if (i === 0) return true;
  if (chain[i - 1].next === '>') return matches(el.parent, chain, i - 1);
  for (let up = el.parent; up; up = up.parent) if (matches(up, chain, i - 1)) return true;
  return false;
}
/** Which of the toasts (each 'hit' or 'plain', oldest first) a phone shows. */
function phoneShows(kinds) {
  const node = (tag, cls, parent) => { const n = { tag, cls: new Set(cls), parent, kids: [] }; parent?.kids.push(n); return n; };
  const top = node('html', ['touch'], null), body = node('body', [], top), stack = node('div', ['toasts'], body);
  const toasts = kinds.map((k) => node('div', ['glass', 'toast', ...(k === 'hit' ? ['hit'] : [])], stack));
  const hide = rules(media(PHONE_Q, '--stack-top')).filter((r) => /display: none;/.test(r.decls)).flatMap((r) => list(r.sel)).filter((s) => s.startsWith('html.touch .toasts') && s.includes('.toast'));
  assert.ok(hide.length > 0, 'the phone block hides some toasts');
  const chains = hide.map(complex);
  return toasts.map((t, i) => (chains.some((c) => matches(t, c)) ? -1 : i)).filter((i) => i >= 0);
}

describe('1. a phone: at most two notices, the newest plain one and the newest tappable one', () => {
  it('plain notices: only the newest shows (as before); tappable ones: only the newest', () => {
    assert.deepEqual(phoneShows(['plain']), [0]);
    assert.deepEqual(phoneShows(['plain', 'plain']), [1]);
    assert.deepEqual(phoneShows(['plain', 'plain', 'plain']), [2]);
    assert.deepEqual(phoneShows(['hit', 'hit']), [1]);
    assert.deepEqual(phoneShows(['hit', 'hit', 'hit']), [2]);
  });
  it('a tappable notice then a plain one: both (a plain one used to hide the retry for its whole life)', () => {
    assert.deepEqual(phoneShows(['hit', 'plain']), [0, 1]); // e.g. 연결 보상 … 눌러서 다시 받아 주세요, then a coin line
    assert.deepEqual(phoneShows(['hit', 'plain', 'plain']), [0, 2]);
  });
  it('a plain notice then a tappable one: both (an error is not swallowed by 한 곡 더 or the star-shower note)', () => {
    assert.deepEqual(phoneShows(['plain', 'hit']), [0, 1]);
    assert.deepEqual(phoneShows(['plain', 'hit', 'hit']), [0, 2]);
  });
  it('an error, or 한 번 더 누르면 나가요, raised while a tappable notice is up is on screen', () => {
    assert.deepEqual(phoneShows(['hit', 'plain']), [0, 1]); // the err after a failed purchase within 8 s of 한 곡 더
    assert.deepEqual(phoneShows(['plain', 'hit', 'plain']), [1, 2]); // the exit warning during a star shower: the newest plain
  });
  it('the tappable row is the upper one, and two rows fit between the left column and the stick on a phone on its side', () => {
    assert.match(rule(media(PHONE_Q, '--stack-top'), 'html.touch .toasts > .toast:not(.hit)'), /order: 1;/);
    const land = media('(orientation: landscape) and (max-height: 520px)', 'width: min(300px');
    assert.match(land, /html\.touch \.toasts \{ gap: 6px; \}\n\s+html\.touch \.toast \{ padding: 6px 12px; line-height: 1\.3; \}/);
    assert.match(land, /@media \(max-height: 340px\) \{\n\s+html\.touch \.toasts \{ gap: 4px; \}\n\s+html\.touch \.toast \{ padding: 3px 10px; font-size: 12px; line-height: 1\.25; \}/);
    // two lines of each (13px x 1.3, and 12px x 1.25 under 341px tall), a 1px border, a tappable row at least 44px
    const row = (fs, lh, pad) => 2 * fs * lh + 2 * pad + 2;
    const two = (fs, lh, pad, gap) => Math.max(44, row(fs, lh, pad)) + gap + row(fs, lh, pad);
    // stack top (the left column with the guest pill ends 100-104px down, + 8px) and the stick's top, measured in Chrome
    for (const [h, top, stick, fs, lh, pad, gap] of [[375, 112, 251, 13, 1.3, 6, 6], [360, 112, 236, 13, 1.3, 6, 6], [320, 108, 196, 12, 1.25, 3, 4]]) {
      assert.ok(top + two(fs, lh, pad, gap) <= stick, `${h}px tall: ${top + two(fs, lh, pad, gap)} > ${stick}`);
    }
  });
  it('never more than two rows, never two of the same kind, always the newest of each kind', () => {
    const kinds = ['hit', 'plain'];
    for (let n = 1; n <= 5; n++) {
      for (let m = 0; m < 2 ** n; m++) {
        const k = Array.from({ length: n }, (_, i) => kinds[(m >> i) & 1]);
        const idx = phoneShows(k), shown = idx.map((i) => k[i]);
        assert.ok(shown.length <= 2 && new Set(shown).size === shown.length, k.join(' '));
        for (const kind of kinds) if (k.includes(kind)) assert.equal(idx.find((i) => k[i] === kind), k.lastIndexOf(kind), k.join(' '));
      }
    }
  });
  it('note() still drops the oldest plain toast over three, so a tappable one is kept in the list', () => {
    const note = ui.slice(ui.indexOf('  function note('), ui.indexOf('  const newsQueue = []'));
    assert.match(note, /\(list\.find\(\(c\) => c !== t && !c\.classList\.contains\('hit'\)\) \|\| list\[0\]\)\.remove\(\);/);
  });
});

// ---- 2. a tappable notice waits out the ⋯ menu and the 동작 panel -------------------------------------------------------------
// note() and its timer helpers, lifted out of ui.js and run against a few fake elements and a fake clock.
function noteRig({ touch = true } = {}) {
  let now = 0, seq = 0;
  const timers = new Map();
  const clock = { now: () => now, set: (f, ms) => { const id = ++seq; timers.set(id, { f, at: now + ms }); return id; }, clear: (id) => timers.delete(id) };
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
    const n = { tag, kids: [], parent: null, on: {}, classList: null };
    const set = new Set(cls.split(/\s+/).filter(Boolean));
    n.classList = { add: (k) => set.add(k), remove: (k) => set.delete(k), contains: (k) => set.has(k), toggle: (k, on) => { if (on ?? !set.has(k)) set.add(k); else set.delete(k); } };
    n.append = (...cs) => { for (const c of cs) { if (c && typeof c === 'object') { c.parent = n; n.kids.push(c); } } };
    n.remove = () => { if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = null; };
    n.addEventListener = (t, f) => { (n.on[t] ||= []).push(f); };
    Object.defineProperty(n, 'children', { get: () => n.kids });
    Object.defineProperty(n, 'isConnected', { get: () => !!n.parent });
    return n;
  };
  const toasts = el('div', 'toasts');
  toasts.querySelectorAll = (q) => { assert.equal(q, ':scope > .toast.hit:not(.out)'); return toasts.kids.filter((k) => k.classList.contains('toast') && k.classList.contains('hit') && !k.classList.contains('out')); };
  const h = (tag, props, ...kids) => { const n = el(tag, props?.class || ''); n.append(...kids.filter((k) => k && typeof k === 'object')); return n; };
  const toolsEl = el('div', 'tools'), reactPanel = { hidden: true };
  const doc = { documentElement: { classList: { contains: (k) => k === 'touch' && touch } } };
  const src = ui.slice(ui.indexOf('  function note('), ui.indexOf('  const newsQueue = []'));
  assert.ok(src.includes('function holdToasts('), 'ui.js has holdToasts');
  const make = new Function('h', 'icon', 'toasts', 'toolsEl', 'reactPanel', 'document', 'toastMs', 'toastText', 'setTimeout', 'clearTimeout', 'Date',
    src + '\nreturn { note, holdToasts };');
  const api = make(h, () => null, toasts, toolsEl, reactPanel, doc, toastMs, toastText, clock.set, clock.clear, { now: clock.now });
  const tools = (open) => { toolsEl.classList.toggle('open', open); api.holdToasts(); };
  const panel = (open) => { reactPanel.hidden = !open; api.holdToasts(); };
  return { ...api, toasts, advance, tools, panel };
}

describe('2. a tappable notice waits out the ⋯ menu and the 동작 panel', () => {
  it('foldTools and toggleReacts tell the notices (holdToasts) every time they open or close', () => {
    const fold = ui.slice(ui.indexOf('  function foldTools('), ui.indexOf('  toolsEl?.addEventListener'));
    assert.match(fold, /holdToasts\(\);/);
    const tog = ui.slice(ui.indexOf('  function toggleReacts('), ui.indexOf('  // Pressed feedback'));
    assert.match(tog, /holdToasts\(\);/);
    // the stylesheet hides the stack in exactly those two states, so the two lists of states are the same
    assert.match(css, /body:has\(#ui \.tools\.open\) \.toasts, html\.touch body:has\(#ui > \.reacts:not\(\[hidden\]\)\) \.toasts \{ visibility: hidden; \}/);
  });
  it('a tappable notice shown, then the menu open for 30 s: it is still there after, for at least 4 s', () => {
    const r = noteRig();
    const t = r.note('연결 보상 100 포인트를 지금은 넣지 못했어요. 잠시 뒤에 눌러서 다시 받아 주세요', 'err', () => {});
    r.advance(2000);
    r.tools(true);
    r.advance(30000);
    assert.equal(t.isConnected, true, 'it did not run out behind the menu');
    r.tools(false);
    r.advance(3900);
    assert.equal(t.isConnected, true, 'at least 4 s after the menu closed');
    r.advance(60000);
    assert.equal(t.isConnected, false, 'and it goes in the end');
  });
  it('the rest of its time is kept: a notice with 6 s left gets its 6 s back', () => {
    const r = noteRig();
    const t = r.note('로그아웃됐어요 · 다시 로그인', '', () => {});
    const ms = toastMs('로그아웃됐어요 · 다시 로그인', true);
    r.advance(ms - 6000);
    r.panel(true);
    r.advance(20000);
    r.panel(false);
    r.advance(5800);
    assert.equal(t.isConnected, true);
    r.advance(600);
    assert.ok(t.classList.contains('out'));
  });
  it('one that comes while the panel is open waits for it to close', () => {
    const r = noteRig();
    r.panel(true);
    const t = r.note('전광판에 등록됐어요 · 친구에게 자랑하기', 'ok', () => {});
    r.advance(60000);
    assert.equal(t.isConnected, true);
    r.panel(false);
    r.advance(7000);
    assert.equal(t.isConnected, true); // its own 8 s from now
  });
  it('a plain notice keeps its clock, and a desktop window\'s reaction panel does not hide notices', () => {
    const r = noteRig();
    const plain = r.note('🙌 하이파이브!', 'ok');
    r.tools(true);
    r.advance(toastMs('🙌 하이파이브!') + 400);
    assert.equal(plain.isConnected, false);
    const d = noteRig({ touch: false });
    const t = d.note('다시 받기', '', () => {});
    d.panel(true);
    d.advance(9000);
    assert.equal(t.isConnected, false); // the stylesheet keeps the stack visible there, so its time runs
  });
});

// ---- 3. the pouch is one tap per throw after the first --------------------------------------------------------------------
function pouchRig({ coarse = true } = {}) {
  let now = 100000;
  const thrown = [];
  const el = (tag, props = {}) => {
    const n = { tag, props, attrs: {}, dataset: {}, hidden: !!props.hidden, kids: [], title: props.title || '' };
    n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
    n.getAttribute = (k) => n.attrs[k] ?? null;
    n.replaceChildren = (...k) => { n.kids = k; };
    return n;
  };
  const root = { kids: [], append(n) { root.kids.push(n); } };
  const tips = [];
  const src = ui.slice(ui.indexOf('  const POUCH_GO_MS'), ui.indexOf('  let loungeN = 0;'));
  const state = { balloonHp: 1000, driving: false };
  const make = new Function('coarse', 'h', 'icon', 'root', 'hooks', 'holdTip', 'Date', 'S',
    'let balloonHp, driving;\n' + src + '\nreturn { pouchGo, pouchThrown, paintPouchGo, set(o) { if ("balloonHp" in o) balloonHp = o.balloonHp; if ("driving" in o) driving = o.driving; } };');
  const api = make(coarse, (tag, props, ...kids) => { const n = el(tag, props || {}); n.kids = kids; return n; }, () => ({ icon: 'packet' }), root,
    { throwPouch: () => { thrown.push(now); return true; } }, (n, f) => tips.push(f()), { now: () => now });
  api.set(state);
  return { ...api, root, thrown, tips, at: (ms) => { now += ms; }, tap: () => api.pouchGo.props.onclick() };
}

describe('3. the pouch: after the first throw, one tap per throw with the balloon in view', () => {
  it('the panel row still closes the panel on a tap, and that tap brings out the throw button', () => {
    assert.match(ui, /toggleReacts\(false\);\n\s+if \(!balloonTold && balloonHp > 0\) \{ balloonTold = true; note\('복주머니를 맞혀 보세요'\); \}\n\s+pouchThrown\(\);/);
    const r = pouchRig();
    assert.equal(r.pouchGo.hidden, true, 'not there before a throw');
    assert.ok(r.root.kids.includes(r.pouchGo), 'in #ui');
    r.pouchThrown(); // the first throw, from the panel
    assert.equal(r.pouchGo.hidden, false);
    assert.equal(r.pouchGo.getAttribute('aria-label'), '복주머니 던지기 · 100번 남음');
    assert.equal(r.pouchGo.kids[1].props.text, '100'); // the badge
    assert.equal(r.tips.length, 1); // a long press says what it is
  });
  it('each tap on it is one throw, and it stays while the player keeps throwing', () => {
    const r = pouchRig();
    r.pouchThrown();
    for (let i = 0; i < 40; i++) { r.at(300); r.tap(); }
    assert.equal(r.thrown.length, 40);
    r.set({ balloonHp: 610 }); r.paintPouchGo();
    assert.equal(r.pouchGo.getAttribute('aria-label'), '복주머니 던지기 · 61번 남음');
    r.at(9000); r.paintPouchGo();
    assert.equal(r.pouchGo.hidden, false);
  });
  it('it goes 10 s after the last throw, when the pouch bursts, and while driving', () => {
    const r = pouchRig();
    r.pouchThrown();
    r.at(10001); r.paintPouchGo();
    assert.equal(r.pouchGo.hidden, true);
    r.pouchThrown();
    r.set({ balloonHp: 0 }); r.paintPouchGo();
    assert.equal(r.pouchGo.hidden, true);
    r.set({ balloonHp: 500, driving: true }); r.pouchThrown();
    assert.equal(r.pouchGo.hidden, true);
  });
  it('a desktop window has no such button (its pouch is a pill under the map, one click per throw)', () => {
    const r = pouchRig({ coarse: false });
    assert.equal(r.pouchGo, null);
    r.pouchThrown();
    assert.equal(r.root.kids.length, 0);
  });
  it('paintBalloon and setDriving repaint it', () => {
    const paint = ui.slice(ui.indexOf('  function paintBalloon('), ui.indexOf('  setInterval(paintBalloon, 1000);'));
    assert.match(paint, /paintPouchGo\(\);\n\s+\}\n$/);
    assert.match(ui, /dock\.hidden = driving;\n\s+paintPouchGo\(\);/);
  });
  it('it is a 52px circle left of 동작, level with it, at every size: nothing in the thumb column moves or is covered', () => {
    const LAND = '(orientation: landscape) and (max-height: 520px)';
    const base = rule(css, 'html.touch #ui > .pouchgo');
    assert.equal(px(base, 'width'), 52);
    assert.equal(px(base, 'height'), 52);
    assert.equal(px(base, 'right'), 12 + 52 + 8);
    assert.match(base, /pointer-events: auto;/);
    assert.match(css, /html\.touch #ui > \.pouchgo\[hidden\] \{ display: none; \}/);
    assert.match(css, /html\.touch #ui:is\(\.newbie, \.lounging, \.viewonly, :has\(\.bake\.show\)\) > \.pouchgo \{ display: none; \}/);
    const blocks = {
      tablet: css,
      up: media('(orientation: portrait)', 'html.touch .acts'),
      land: media(LAND, '.taxihud'),
    };
    const at = (scope, sel) => rule(scope, sel);
    for (const [name, scope] of Object.entries(blocks)) {
      const pg = scope === css ? base : at(scope, 'html.touch #ui > .pouchgo');
      assert.equal(px(pg, 'bottom'), px(at(scope, 'html.touch .dock'), 'bottom'), name + ': level with 동작');
    }
    // the six phone sizes the layout rules are checked at: the circle is on screen, clear of the column (right 12 … 64px),
    // of the tag under it (at most about 100px tall from the bottom of the action button) and, on a phone on its side
    // under 641px wide, of the waypoint pill above the tag (92px up, 38px tall)
    for (const [w, hgt] of [[375, 812], [360, 780], [320, 568], [812, 375], [740, 360], [568, 320]]) {
      const land = w > hgt;
      const scope = land ? blocks.land : blocks.up;
      const bottom = px(at(scope, 'html.touch #ui > .pouchgo'), 'bottom');
      const box = { l: w - 124, r: w - 72, b: hgt - bottom, t: hgt - bottom - 52 };
      assert.ok(box.l >= 0 && box.t >= 0, `${w}x${hgt}: on screen`);
      assert.ok(box.r <= w - 64, `${w}x${hgt}: left of the column`);
      const tag = px(rule(land ? media(LAND, '.prompt') : media('(orientation: portrait) and (max-width: 599px)', '.prompt'), 'html.touch .prompt'), 'bottom');
      assert.ok(tag + 100 <= bottom, `${w}x${hgt}: above the tag`);
      if (land && w <= 640) assert.ok(92 + 38 + 8 <= bottom, `${w}x${hgt}: above the waypoint pill`);
      // on its side the map column ends 118px down (8 + 48 + 6 + 56) and is 8 … 64px from the right: the circle is left of it anyway
      if (land) assert.ok(box.r <= w - 64 - 8);
    }
  });
});

// ---- 4. no field under 16px on touch -------------------------------------------------------------------------------------
// For every rule that sets a text field's font under 16px, the rule that wins on touch (the most specific of that rule and the
// html.touch rules that cover the same field; the later one on a tie) sets 16px or more.
const FIELD = /(^|[\s>+~(,])(input|textarea|select)\b|\.input\b|\[contenteditable/;
function fontPx(decls) {
  const size = /(?:^|[;\s])font-size: (\d+(?:\.\d+)?)px/.exec(decls);
  if (size) return Number(size[1]);
  const font = /(?:^|[;\s])font: ([^;]*)/.exec(decls);
  const m = font && /(\d+(?:\.\d+)?)px/.exec(font[1]);
  return m ? Number(m[1]) : null;
}
const subject = (sel) => sel.split(/\s+|>|~|\+/).filter(Boolean).pop();
const textField = (sel) => FIELD.test(' ' + subject(sel)) && !/type=["']?(checkbox|radio|range|color|file)|::?placeholder/.test(subject(sel));
// html.touch :is(.input, textarea, select) covers a field whose own last part names one of those.
function covers(touchSel, subj) {
  const m = /^html\.touch :is\(([^)]*)\)$/.exec(touchSel);
  if (!m) return false;
  return list(m[1]).some((f) => new RegExp((f.startsWith('.') ? '' : String.raw`(^|[^\w.#-])`) + f.replace(/\./g, String.raw`\.`) + String.raw`(?![\w-])`).test(subj));
}
function smallFields(styles) {
  const all = rules(styles).flatMap((r, i) => list(r.sel).map((s) => ({ s, i, size: fontPx(r.decls) }))).filter((x) => x.size != null && textField(x.s));
  const touchRules = all.filter((x) => /html\.touch\b/.test(x.s));
  const bad = [];
  for (const r of all) {
    if (r.size >= 16 || /html\.touch\b/.test(r.s) || /:not\(\.touch\)/.test(r.s)) continue;
    // what covers it on touch: the general field rule, or the same selector under html.touch
    const cover = touchRules.filter((t) => t.s === 'html.touch ' + r.s || covers(t.s, subject(r.s)));
    const win = [r, ...cover].sort((a, b) => cmp(spec(a.s), spec(b.s)) || a.i - b.i).pop();
    if (win.size < 16) bad.push(`${r.s} (${r.size}px; on touch ${win.s} gives ${win.size}px)`);
  }
  return bad;
}

describe('4. no text field on a touch screen is under 16px (iOS zooms in on one)', () => {
  it('the specificity helper agrees with the case the review found', () => {
    assert.deepEqual(spec('.sheet .more .emo-row .input'), [0, 4, 0]);
    assert.deepEqual(spec('html.touch :is(.input, textarea, select)'), [0, 2, 1]);
    assert.deepEqual(spec('html.touch .sheet .more .emo-row .input'), [0, 5, 1]);
    assert.ok(cmp(spec('.sheet .more .emo-row .input'), spec('html.touch :is(.input, textarea, select)')) > 0); // the 15px won
  });
  it('the plaza (index.html): every field rule under 16px loses on touch to one of 16px or more', () => {
    assert.match(css, /html\.touch :is\(\.input, textarea, select\) \{ font-size: 16px; \}/);
    assert.deepEqual(smallFields(css), []);
    // and the finder does find the kind of rule it is for
    assert.equal(smallFields('.a .b .c .input { font-size: 15px; }\nhtml.touch :is(.input, textarea, select) { font-size: 16px; }').length, 1);
    assert.equal(smallFields('.wish-field .input { font-size: 15px; }\nhtml.touch :is(.input, textarea, select) { font-size: 16px; }').length, 0);
  });
  it('the gift page (gift.html) has no touch class: its fields are 16px everywhere', () => {
    const g = styleOf(read('gift.html'));
    const fields = rules(g).flatMap((r) => list(r.sel).map((s) => ({ s, size: fontPx(r.decls) }))).filter((x) => x.size != null && textField(x.s));
    assert.ok(fields.length > 0);
    for (const f of fields) assert.ok(f.size >= 16, f.s);
  });
  it('no field built in the plaza sets a smaller size of its own (an inline style)', () => {
    for (const f of ['ui.js', 'teamui.js', 'gift.js', 'giftpage.js']) {
      for (const line of read(f).split('\n').filter((l) => /h\('(input|textarea|select)'/.test(l))) {
        const m = /fontSize: '(\d+)px'/.exec(line);
        if (m) assert.ok(Number(m[1]) >= 16, f + ': ' + line.trim().slice(0, 80));
      }
    }
  });
});

// ---- 5. the gift frame is modal ------------------------------------------------------------------------------------------
// ui.js's keydown listener (the one registered in createUI, before gift.js mounts) lifted out with fakes for what it calls.
function keyRig({ ext = true, sheet = true } = {}) {
  const calls = [];
  const src = ui.slice(ui.indexOf("  window.addEventListener('keydown', (e) => {\n    const tag = e.target?.tagName;"));
  const body = src.slice(src.indexOf('(e) => {'), src.indexOf('\n  }, true);') + 4);
  const names = ['ext', 'closeLayer', 'dance', 'endDance', 'proof', 'leaveProof', 'baking', 'reactPanel', 'toggleReacts', 'stopBake', 'sheet', 'backSheet', 'fsOn', 'openMap', 'driving'];
  const rec = (n) => (...a) => { calls.push(n); return true; };
  const fn = new Function(...names, 'return ' + body)(
    ext ? { el: {}, close() {} } : null, rec('closeLayer'), null, rec('endDance'), { hidden: true }, rec('leaveProof'), false,
    { hidden: true }, rec('toggleReacts'), rec('stopBake'), sheet ? { el: { querySelector: () => null } } : null, rec('backSheet'), () => false, rec('openMap'), false);
  const press = (key, code = '') => { const e = { key, code, repeat: false, isComposing: false, target: { tagName: 'BUTTON' }, prevented: false, stopped: false, preventDefault() { e.prevented = true; }, stopPropagation() { e.stopped = true; } }; fn(e); return e; };
  return { press, calls };
}

describe('5. the gift frame over the plaza: Escape closes it alone, the HUD is inert, the plaza\'s keys do nothing', () => {
  it('Escape with a sheet under the frame closes the frame only (it used to close the sheet too)', () => {
    const r = keyRig();
    const e = r.press('Escape');
    assert.deepEqual(r.calls, ['closeLayer']);
    assert.ok(e.prevented && e.stopped);
    // without the frame the same Escape closes the sheet, as before
    const plain = keyRig({ ext: false });
    plain.press('Escape');
    assert.deepEqual(plain.calls, ['backSheet']);
  });
  it('M and 5 do nothing while the frame is up (they opened the map or the 동작 panel under it)', () => {
    const r = keyRig({ sheet: false });
    r.press('m', 'KeyM'); r.press('5', 'Digit5');
    assert.deepEqual(r.calls, []);
    const plain = keyRig({ ext: false, sheet: false });
    plain.press('m', 'KeyM'); plain.press('5', 'Digit5');
    assert.deepEqual(plain.calls, ['openMap', 'toggleReacts']);
  });
  it('ui.layer makes the HUD, every sheet and the notices inert, keeps them so when a sheet under it closes, and is one history level', () => {
    const block = ui.slice(ui.indexOf('  function showTop('), ui.indexOf('  const TABBABLE'));
    let rootInert = null, viewTab = null;
    const sheetsList = [{ el: { classList: { toggle() {} }, inert: false } }];
    const wants = [];
    const toasts = { inert: false };
    const make = new Function('sheets', 'root', 'toasts', 'syncBack', 'document', 'hooks', block + '\nreturn { layer, closeLayer, backInert, get ext() { return ext; } };');
    const root = { set inert(v) { rootInert = v; }, get inert() { return rootInert; } };
    const viewEl = { set tabIndex(v) { viewTab = v; }, setAttribute() {}, removeAttribute() {} };
    const api = make(sheetsList, root, toasts, () => wants.push('sync'), { getElementById: (id) => (id === 'view' ? viewEl : null), addEventListener() {} }, { lockInput() {} });
    let closed = 0;
    api.layer({ contains: () => false, querySelector: () => null }, () => { closed++; api.layer(null); });
    assert.equal(rootInert, true);
    assert.equal(viewTab, -1);
    assert.equal(toasts.inert, true);
    assert.equal(sheetsList[0].el.inert, true, 'the top sheet under the frame too');
    api.backInert(false); // the last sheet under the frame closes (afterSheets)
    assert.equal(rootInert, true, 'the HUD stays inert under the frame');
    assert.equal(api.closeLayer(), true);
    assert.equal(closed, 1);
    assert.equal(api.ext, null);
    assert.equal(rootInert, true, 'the sheet under it is still open: the HUD stays inert for the sheet');
    assert.equal(toasts.inert, false);
    assert.equal(sheetsList[0].el.inert, false, 'the sheet is live again');
    sheetsList.length = 0;
    api.backInert(false); // and that sheet closes
    assert.equal(rootInert, false);
    assert.equal(api.closeLayer(), false, 'nothing left to close');
    assert.ok(wants.length >= 2);
    assert.match(ui, /function syncBack\(\) \{ backKeeper\.want\(sheets\.length \+ proofLevel\(\) \+ \(ext \? 1 : 0\)\); \}/);
    // the phone's back button closes the frame first, then sheets, as one level each
    assert.match(ui, /for \(let i = 0; i < act\.back; i\+\+\) \{ if \(!\(closeLayer\(\) \|\| \(sheet \? backSheet\(\) : \(leaveProof\(\) \|\| skipProofWait\(\)\)\)\)\) break; \}/);
    assert.match(ui, /\n\s+layer\(el, close\) \{ if \(el && dance\) endDance\('layer'\); layer\(el, close\); if \(el\) tapGuard\.opened\(\); \},[^\n]*\n\s+startBake, stopBake,/); // on the UI object (it also ends 같이 춤추기: test/review2-hud.test.mjs 9)
  });
  it('gift.js hands its frame to ui.layer on open, takes it back before focus returns, and keeps Tab between ✕ and the page', () => {
    const open = gift.slice(gift.indexOf('  function openMaker('), gift.indexOf('  function closeMaker('));
    assert.match(open, /frame\.append\(lead, ifr, x\); document\.body\.append\(frame\);\n[^\n]*\n\s+if \(typeof ui\?\.layer === 'function'\) ui\.layer\(frame, closeMaker\);\n\s+else world\?\.setInputEnabled\?\.\(false\);/);
    assert.match(open, /if \(!e\.shiftKey && at === x\) \{ e\.preventDefault\(\); ifr\.focus\(\); \}/);
    assert.match(open, /else if \(e\.shiftKey && at === frame\) \{ e\.preventDefault\(\); x\.focus\(\{ preventScroll: true \}\); \}/);
    assert.match(open, /lead\.tabIndex = 0; lead\.addEventListener\('focus', \(\) => x\.focus\(\{ preventScroll: true \}\)\);/);
    const close = gift.slice(gift.indexOf('  function closeMaker('), gift.indexOf("  window.addEventListener('keydown'"));
    assert.ok(close.indexOf('ui.layer(null)') > 0 && close.indexOf('ui.layer(null)') < close.indexOf('back.focus('), 'the HUD is live again before focus goes back to it');
    // ui.js's Escape listener is registered first (createUI runs before mountGift), so it is the one that must know the frame
    const main = read('main.js');
    assert.ok(main.indexOf('createUI(document.getElementById') < main.indexOf('mountGift({'));
  });
  // gift.js's openMaker/closeMaker and ui.js's layer, lifted out and joined as in the page: ui.js's owner-based input lock
  // (overlay.js createInputLock, ui.js hooks.lockInput) in front of a world whose movement is on or off (main.js lockInput).
  function frameRig() {
    const world = { on: true, setInputEnabled(v) { world.on = !!v; } };
    const inputLock = createInputLock((locked) => world.setInputEnabled(!locked));
    const hooks = { lockInput: (on, owner) => inputLock.set(owner, !!on) };
    const block = ui.slice(ui.indexOf('  function showTop('), ui.indexOf('  const TABBABLE'));
    const sheets = [];
    const doc = { activeElement: null, body: null, getElementById: () => null, addEventListener() {} };
    const el = () => {
      const n = { kids: [], parent: null, attrs: {}, classList: { toggle() {} } };
      n.setAttribute = (k, v) => { n.attrs[k] = v; }; n.addEventListener = () => {}; n.focus = () => { doc.activeElement = n; };
      n.append = (...cs) => { for (const c of cs) { c.parent = n; n.kids.push(c); } };
      n.remove = () => { if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = null; };
      n.contains = (o) => { for (let x = o; x; x = x.parent) if (x === n) return true; return false; };
      n.querySelector = () => null;
      Object.defineProperty(n, 'isConnected', { get: () => { for (let x = n; x; x = x.parent) if (x === doc.body) return true; return false; } });
      return n;
    };
    doc.createElement = el; doc.createElementNS = () => el();
    doc.body = el();
    const uiApi = new Function('sheets', 'root', 'toasts', 'syncBack', 'document', 'hooks', block + '\nreturn { layer, closeLayer };')(sheets, {}, {}, () => {}, doc, hooks);
    const src = gift.slice(gift.indexOf('  let frame = null, opener = null;'), gift.indexOf('  // Escape with the cursor'));
    const btn = el(); doc.body.append(btn);
    const g = new Function('document', 'world', 'ui', 'btn', src + '\nreturn { openMaker, closeMaker, get frame() { return frame; } };')(doc, world, uiApi, btn);
    return { world, hooks, inputLock, g, ui: uiApi };
  }
  it('the frame over a sheet, then closed: movement stays locked by the sheet (WASD walked behind it)', () => {
    const r = frameRig();
    r.hooks.lockInput(true, 'sheet');
    r.g.openMaker('/g/abcd1234?o=1');
    assert.equal(r.world.on, false);
    assert.deepEqual(r.inputLock.owners().sort(), ['layer', 'sheet']);
    r.g.closeMaker();
    assert.equal(r.g.frame, null);
    assert.equal(r.world.on, false, 'the sheet still holds the lock');
    assert.deepEqual(r.inputLock.owners(), ['sheet']);
    r.hooks.lockInput(false, 'sheet');
    assert.equal(r.world.on, true);
  });
  it('the frame alone: locked while open, free after it closes (by its close button or by Escape through closeLayer)', () => {
    const r = frameRig();
    r.g.openMaker();
    assert.equal(r.world.on, false);
    r.g.closeMaker();
    assert.equal(r.world.on, true);
    assert.deepEqual(r.inputLock.owners(), []);
    r.g.openMaker();
    assert.equal(r.ui.closeLayer(), true);
    assert.equal(r.world.on, true);
    assert.equal(r.g.frame, null);
  });
  it('a sheet that opens while the frame is up and is still open when the frame closes keeps the lock', () => {
    const r = frameRig();
    r.g.openMaker();
    r.hooks.lockInput(true, 'sheet');
    r.g.closeMaker();
    assert.equal(r.world.on, false);
  });
});
