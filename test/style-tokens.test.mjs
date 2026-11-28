// 2026-11-28 (A. LED 전광판, out/design-2026-11-28/STYLE.md): one set of colour and corner tokens for the plaza (index.html) and the pages
// outside it (gift.html, discover.html, ads.html, the Worker's share pages in sharepage.js), the board colours every gift card is drawn in
// (giftrules.js GIFT_THEMES f/k/t), and what the restyle took out: gradients, glows and emoji on the pages' controls.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GIFT_THEMES, OCCASIONS } from '../giftrules.js';
import { ICONS } from '../uiicons.js';
import { sharePage } from '../sharepage.js';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const css = (html) => [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
// The custom properties of the first :root block, as { name: value }.
const tokens = (text) => {
  const block = /:root\s*\{([^}]*)\}/.exec(text)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)].map((m) => [m[1], m[2].trim().replace(/\s+/g, ' ').toLowerCase()]));
};
const lum = (hex) => { const n = parseInt(hex.slice(1), 16), f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const SHARED = ['--bg', '--surface', '--surface-2', '--line', '--line-strong', '--text', '--text-2', '--muted', '--accent', '--accent-press', '--on-accent', '--info', '--r', '--r-sheet'];
const PAGES = { 'index.html': tokens(css(read('index.html'))), 'gift.html': tokens(css(read('gift.html'))), 'discover.html': tokens(css(read('discover.html'))),
  'ads.html': tokens(css(read('ads.html'))), 'sharepage.js': tokens(/<style>([\s\S]*?)<\/style>/.exec(sharePage({ title: 't', big: 'b' }))[1]) };

describe('one set of tokens for the plaza and the pages outside it', () => {
  it('the same values under the same names on every page (the plaza\'s :root is the source)', () => {
    const want = PAGES['index.html'];
    assert.equal(want['--bg'], '#000000', 'a true black, no blue in it');
    assert.equal(want['--accent'], '#ffb020', 'the marquee amber, the one accent');
    assert.deepEqual([want['--r'], want['--r-sheet']], ['4px', '6px']);
    for (const [page, got] of Object.entries(PAGES)) {
      for (const k of SHARED) if (page !== 'sharepage.js' || got[k]) assert.equal(got[k], want[k], `${page} ${k}`);
    }
  });
  it('text tokens read at 4.5:1 or more on every surface', () => {
    const t = PAGES['index.html'];
    for (const fg of ['--text', '--text-2', '--muted', '--dim']) for (const bg of ['--bg', '--surface', '--surface-2']) assert.ok(ratio(t[fg], t[bg]) >= 4.5, `${fg} on ${bg}: ${ratio(t[fg], t[bg]).toFixed(2)}`);
    assert.ok(ratio(t['--on-accent'], t['--accent']) >= 4.5 && ratio(t['--on-accent'], t['--accent-press']) >= 4.5, 'words on the amber, at rest and pressed');
    assert.ok(ratio(t['--accent'], t['--accent-press']) >= 1.5, 'the pressed amber is seen');
  });
  it('no gradient, blur or glow on the pages outside the plaza, and no purple-blue left in them', () => {
    for (const f of ['gift.html', 'discover.html', 'ads.html']) {
      const s = css(read(f));
      assert.equal(/gradient\(|backdrop-filter|text-shadow/.test(s), false, f);
      for (const old of ['#07061a', '#3a1150', '#14205a', '#5b21ff', '#ff4fa3', '#0a0e1c', '#141a2e', '#1c2440']) assert.equal(s.toLowerCase().includes(old), false, `${f}: ${old}`);
    }
    const share = /<style>([\s\S]*?)<\/style>/.exec(sharePage({ title: 't', big: 'b' }))[1];
    assert.equal(/gradient\(|text-shadow/.test(share), false, 'sharepage.js');
  });
});

describe('the board colours (giftrules.js GIFT_THEMES)', () => {
  it('every theme is one flat colour with its two inks at 4.5:1 or more; the keys of old boards stay', () => {
    assert.deepEqual(Object.keys(GIFT_THEMES), ['party', 'rose', 'gold', 'sky', 'mint', 'night']);
    for (const [k, T] of Object.entries(GIFT_THEMES)) {
      for (const c of [T.f, T.k, T.t]) assert.match(c, /^#[0-9a-f]{6}$/, k);
      assert.ok(ratio(T.k, T.f) >= 4.5, `${k}: the name ${ratio(T.k, T.f).toFixed(2)}:1`);
      assert.ok(ratio(T.t, T.f) >= 4.5, `${k}: the words ${ratio(T.t, T.f).toFixed(2)}:1`);
    }
    assert.equal(GIFT_THEMES.party.f, '#b5121b'); assert.equal(GIFT_THEMES.night.f, '#000000');
  });
  it('every day has a line icon of the same set as the pages', () => {
    for (const [k, o] of Object.entries(OCCASIONS)) { assert.ok(o.icon && ICONS[o.icon], `${k}: ${o.icon}`); assert.ok(o.emoji, `${k}: the emoji stays for the words people send`); }
  });
  it('the board painter draws no gradient, light, vignette or confetti and never an emoji on a label', () => {
    const art = read('giftart.js');
    assert.equal(/createLinearGradient|createRadialGradient|shadowBlur|globalAlpha = 0\.\d+ \+ rnd/.test(art), false);
    assert.match(art, /export const plainWords/);
  });
});

describe('no emoji on the pages\' buttons and headings', () => {
  it('giftpage.js and discoverpage.js build their buttons, chips and headings with line icons', () => {
    const PICT = /\p{Extended_Pictographic}/u;
    for (const f of ['giftpage.js', 'discoverpage.js']) {
      const lines = read(f).split('\n').filter((l) => !/^\s*\/\//.test(l));
      const bad = lines.filter((l) => /h\('(?:button|a|h1|h2)'/.test(l) && PICT.test(l.replace(/\/\/.*$/, '')) && !/share|text: `\$\{o\.emoji\}|visitorShareText|giftShareText/.test(l));
      assert.deepEqual(bad.map((l) => l.trim().slice(0, 120)), [], f);
    }
    const boot = /<nav class="bootcta"[\s\S]*?<\/nav>/.exec(read('index.html'))[0];
    assert.equal(/\p{Extended_Pictographic}/u.test(boot), false, 'the boot card\'s two makers');
  });
  it('the plaza film\'s watermark never says 무료 (the paid tiers are hidden)', () => {
    for (const f of ['gift.js', 'giftfilm.js']) assert.equal(/WISH BOARD · 무료/.test(read(f)), false, f);
  });
});
