import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ICONS, ICON_NAMES, icon, shapeOf } from '../uiicons.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const LO = 1, HI = 23; // inside the 24×24 box with room for the 1.75 stroke

// The argument text of every call `fn(` in src: index argIndex, split at top-level commas, strings and templates skipped.
function callArgs(src, fn, argIndex = 0) {
  const out = [];
  const re = new RegExp(`(?<![\\w$])(?<![^.]\\.)${fn}\\(`, 'g'); // a call or a spread (...withIcon), not obj.icon(
  for (const m of src.matchAll(re)) {
    let i = m.index + m[0].length, depth = 0, arg = 0, start = i;
    const args = [];
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "'" || c === '"' || c === '`') {
        const q = c;
        for (i++; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i++;
        continue;
      }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) { args.push(src.slice(start, i)); break; }
        depth--;
      } else if (c === ',' && depth === 0) { args.push(src.slice(start, i)); start = i + 1; arg++; }
    }
    if (args[argIndex] != null) out.push(args[argIndex]);
  }
  return out;
}
const namesIn = (expr) => [...expr.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);

function usedNames(src) {
  const used = new Set();
  for (const a of callArgs(src, 'icon')) namesIn(a).forEach((n) => used.add(n));
  for (const a of callArgs(src, 'withIcon')) namesIn(a).forEach((n) => used.add(n));
  for (const a of callArgs(src, 'setIconText', 1)) namesIn(a).forEach((n) => used.add(n));
  for (const m of src.matchAll(/\bico: '([A-Za-z]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/openSheet\(\['([A-Za-z]+)'/g)) used.add(m[1]);
  // const EMOTE_ICONS = { 1: 'pray', … }
  for (const m of src.matchAll(/const \w+_ICONS = \{([^}]*)\}/g)) namesIn(m[1]).forEach((n) => used.add(n));
  // const [labelIcon, label] = cond ? ['building', '…'] : …
  for (const m of src.matchAll(/const \[\w+Icon, \w+\] = ([^;]+);/g)) for (const t of m[1].matchAll(/\['([A-Za-z]*)', /g)) if (t[1]) used.add(t[1]);
  return used;
}

// SVG arc endpoint form → points along the arc (SVG 1.1 F.6.5), to check how far an arc bulges.
function arcSamples(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  if (!rx || !ry) return [[x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  let k = Math.sqrt(Math.max(0, num / den));
  if (fa === fs) k = -k;
  const cxp = (k * rx * yp) / ry, cyp = (-k * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  if (fs && dt < 0) dt += 2 * Math.PI;
  const pts = [];
  for (let s = 0; s <= 48; s++) {
    const t = t1 + (dt * s) / 48;
    pts.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
  }
  return pts;
}

const ARGS = { M: 2, L: 2, H: 1, V: 1, A: 7, C: 6, Q: 4, Z: 0 };
// Every point a path visits (endpoints, control points, sampled arcs). Throws on anything but absolute M/L/H/V/A/C/Q/Z.
function pathPoints(d) {
  assert.match(d, /^M/, `path must start with M: ${d}`);
  assert.equal(/[^MLHVACQZ0-9.\s-]/.test(d), false, `only absolute M L H V A C Q Z: ${d}`);
  const pts = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  for (const [, cmd, body] of d.matchAll(/([MLHVACQZ])([^MLHVACQZ]*)/g)) {
    const nums = body.trim() ? body.trim().split(/[\s,]+/).map(Number) : [];
    assert.ok(nums.every(Number.isFinite), `bad number in ${cmd}${body}`);
    const n = ARGS[cmd];
    if (n === 0) { assert.equal(nums.length, 0); x = sx; y = sy; continue; }
    assert.ok(nums.length > 0 && nums.length % n === 0, `${cmd} takes ${n} numbers: ${cmd}${body}`);
    for (let i = 0; i < nums.length; i += n) {
      const a = nums.slice(i, i + n);
      if (cmd === 'M' || cmd === 'L') { [x, y] = a; if (cmd === 'M' && i === 0) { sx = x; sy = y; } pts.push([x, y]); }
      else if (cmd === 'H') { x = a[0]; pts.push([x, y]); }
      else if (cmd === 'V') { y = a[0]; pts.push([x, y]); }
      else if (cmd === 'C') { pts.push([a[0], a[1]], [a[2], a[3]], [a[4], a[5]]); [x, y] = [a[4], a[5]]; }
      else if (cmd === 'Q') { pts.push([a[0], a[1]], [a[2], a[3]]); [x, y] = [a[2], a[3]]; }
      else if (cmd === 'A') {
        assert.ok((a[3] === 0 || a[3] === 1) && (a[4] === 0 || a[4] === 1), `arc flags are 0 or 1: ${cmd}${body}`);
        pts.push(...arcSamples(x, y, a[0], a[1], a[2], a[3], a[4], a[5], a[6]));
        [x, y] = [a[5], a[6]];
      }
    }
  }
  return pts;
}

function shapePoints(tag, at) {
  const n = (k) => Number(at[k]);
  if (tag === 'path') return pathPoints(at.d);
  if (tag === 'circle') return [[n('cx') - n('r'), n('cy') - n('r')], [n('cx') + n('r'), n('cy') + n('r')]];
  if (tag === 'ellipse') return [[n('cx') - n('rx'), n('cy') - n('ry')], [n('cx') + n('rx'), n('cy') + n('ry')]];
  if (tag === 'rect') {
    assert.ok(n('rx') >= 0 && n('rx') <= Math.min(n('width'), n('height')) / 2, 'rect corner radius fits');
    return [[n('x'), n('y')], [n('x') + n('width'), n('y') + n('height')]];
  }
  throw new Error('unexpected shape ' + tag);
}

const GEOMETRY = { path: ['d'], circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'], rect: ['x', 'y', 'width', 'height', 'rx'] };

// Just enough DOM for icon(): elements record attributes and children and serialise to markup.
function fakeDocument() {
  const make = (ns, tag) => ({
    ns, tagName: tag, attrs: {}, children: [], className: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    append(...c) { this.children.push(...c); },
  });
  return { createElementNS: make, createElement: (tag) => make(null, tag) };
}
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const markup = (el) => `<${el.tagName}${Object.entries(el.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('')}>${el.children.map(markup).join('')}</${el.tagName}>`;
// Well-formed: every tag closes in order, attributes are quoted, nothing else in between.
function wellFormed(xml) {
  const stack = [];
  const re = /<(\/?)([a-z]+)((?:\s+[a-zA-Z:-]+="[^"<]*")*)\s*>/gy;
  let at = 0;
  for (let m; (m = re.exec(xml));) {
    at = re.lastIndex;
    if (m[1]) { if (stack.pop() !== m[2]) return false; } else stack.push(m[2]);
  }
  return at === xml.length && stack.length === 0;
}

describe('interface icons (uiicons.js)', () => {
  it('has every icon ui.js asks for', () => {
    const used = usedNames(read('ui.js'));
    assert.ok(used.size >= 35, `found ${used.size} names`);
    const missing = [...used].filter((n) => !ICON_NAMES.includes(n));
    assert.deepEqual(missing, []);
  });

  it('gives every emote dock button a line icon, while the emote itself stays the emoji', () => {
    // ts3d/avatars.js needs three.js, so read EMOTES from its source.
    const av = read('ts3d/avatars.js');
    const block = av.slice(av.indexOf('export const EMOTES = {'), av.indexOf('};', av.indexOf('export const EMOTES = {')));
    const EMOTES = Object.fromEntries([...block.matchAll(/(\d+): \{[^}]*glyph: '([^']+)'/g)].map((m) => [m[1], { glyph: m[2] }]));
    assert.equal(Object.keys(EMOTES).length, 4);
    const src = read('ui.js');
    const map = src.match(/const EMOTE_ICONS = \{([^}]*)\}/);
    assert.ok(map, 'EMOTE_ICONS in ui.js');
    const pairs = Object.fromEntries([...map[1].matchAll(/(\d+): '([A-Za-z]+)'/g)].map((m) => [m[1], m[2]]));
    assert.deepEqual(Object.keys(pairs).sort(), Object.keys(EMOTES).sort());
    assert.deepEqual(Object.values(pairs), ['pray', 'firework', 'cheer', 'dance']);
    for (const n of Object.values(pairs)) assert.ok(ICON_NAMES.includes(n), n);
    for (const e of Object.values(EMOTES)) assert.match(e.glyph, /\p{Extended_Pictographic}/u); // what other players see is unchanged
    assert.match(src, /h\('span', \{ class: 'e' \}, EMOTE_ICONS\[id\] \? icon\(EMOTE_ICONS\[id\]\) : e\.glyph\)/);
  });

  it('draws every icon with stroke geometry only, inside the 24×24 box', () => {
    assert.ok(ICON_NAMES.length >= 35 && ICON_NAMES.length <= 90);
    for (const name of ICON_NAMES) {
      assert.match(name, /^[a-z][a-zA-Z]+$/);
      const shapes = ICONS[name];
      assert.ok(Array.isArray(shapes) && shapes.length > 0, name);
      for (const s of shapes) {
        const [tag, at] = shapeOf(s);
        assert.ok(GEOMETRY[tag], `${name}: ${tag}`);
        assert.deepEqual(Object.keys(at).filter((k) => !GEOMETRY[tag].includes(k)), [], `${name}: only geometry attributes`);
        for (const k of GEOMETRY[tag]) if (k !== 'rx' || tag !== 'rect') assert.ok(at[k] != null && at[k] !== '', `${name}: ${tag} needs ${k}`);
        for (const [x, y] of shapePoints(tag, at)) {
          assert.ok(x >= LO - 1e-6 && x <= HI + 1e-6 && y >= LO - 1e-6 && y <= HI + 1e-6, `${name}: ${tag} reaches (${x.toFixed(2)}, ${y.toFixed(2)})`);
        }
      }
    }
  });

  it('builds a decorative, well-formed svg.ico', () => {
    const saved = globalThis.document;
    globalThis.document = fakeDocument();
    try {
      for (const name of ICON_NAMES) {
        const svg = icon(name);
        assert.equal(svg.tagName, 'svg');
        assert.equal(svg.ns, 'http://www.w3.org/2000/svg');
        assert.equal(svg.attrs.class, 'ico');
        assert.equal(svg.attrs.viewBox, '0 0 24 24');
        assert.equal(svg.attrs['aria-hidden'], 'true');
        assert.equal(svg.attrs.focusable, 'false');
        assert.equal(svg.attrs.fill, 'none');
        assert.equal(svg.attrs.stroke, 'currentColor');
        assert.equal(svg.children.length, ICONS[name].length);
        for (const c of svg.children) {
          assert.equal(c.ns, 'http://www.w3.org/2000/svg');
          assert.equal(/fill|stroke/.test(Object.keys(c.attrs).join(' ')), false, `${name}: shapes inherit paint`);
        }
        assert.ok(wellFormed(markup(svg)), `${name}: ${markup(svg)}`);
      }
      assert.equal(icon('trophy', { class: 'big' }).attrs.class, 'ico big');
    } finally {
      if (saved === undefined) delete globalThis.document; else globalThis.document = saved;
    }
  });

  it('gives an empty span for an unknown name and never throws', () => {
    const saved = globalThis.document;
    globalThis.document = fakeDocument();
    try {
      for (const bad of ['nope', '', undefined, null, 42, '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
        const el = icon(bad);
        assert.equal(el.tagName, 'span', String(bad));
        assert.equal(el.children.length, 0);
        assert.equal(el.attrs['aria-hidden'], 'true');
      }
    } finally {
      if (saved === undefined) delete globalThis.document; else globalThis.document = saved;
    }
    assert.doesNotThrow(() => icon('trophy')); // no document at all (node): returns null, no throw
  });

  it('builds icons with createElementNS only, never from markup', () => {
    const src = read('uiicons.js');
    assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|DOMParser/.test(src), false);
    assert.match(read('ui.js'), /import \{ icon \} from '\.\/uiicons\.js\?v=[0-9a-z]+';/);
  });
});
