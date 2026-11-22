// 중3 검색·미리보기: robots.txt, sitemap.xml, the meta tags in index.html, the web app manifest and its icons, and that all of them are served.
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const bytes = (f) => readFileSync(new URL('../' + f, import.meta.url));
const C = await import('../tools/prod-check.mjs');
const rules = C.parseIgnore(read('.assetsignore'));
const html = read('index.html');
const ORIGIN = 'https://studio.wishboard.workers.dev';

const meta = (attr, name) => { const m = html.match(new RegExp(`<meta\\s+${attr}="${name.replace(/[:.]/g, '\\$&')}"\\s+content="([^"]*)"`)); return m ? m[1] : null; };
const pngSize = (f) => { const b = bytes(f); assert.equal(b.subarray(1, 4).toString('latin1'), 'PNG', f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const jpegSize = (f) => { const b = bytes(f); let i = 2; while (i < b.length) { if (b[i] !== 0xff) { i++; continue; } const m = b[i + 1]; if (m >= 0xc0 && m <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + b.readUInt16BE(i + 2); } return null; };

describe('robots.txt and sitemap.xml', () => {
  const robots = read('robots.txt'), sitemap = read('sitemap.xml');
  it('lets the game be crawled, closes the API and admin, keeps the share pages readable, and names the sitemap', () => {
    const lines = robots.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    assert.equal(lines[0], 'User-agent: *');
    for (const l of ['Allow: /', 'Disallow: /rt/', 'Disallow: /admin', 'Disallow: /oauth', `Sitemap: ${ORIGIN}/sitemap.xml`]) assert.ok(lines.includes(l), l);
    // The share and preview pages live under /rt/: they stay allowed so link-preview crawlers can read their Open Graph tags (the longer rule wins).
    for (const p of ['/rt/w/', '/rt/s/', '/rt/card/', '/rt/snap/']) assert.ok(lines.includes('Allow: ' + p), p);
    // Nothing else under /rt/ is allowed: the API, the admin routes, photos, tokens.
    const allowed = lines.filter((l) => l.startsWith('Allow: /rt/')).map((l) => l.slice(7));
    assert.deepEqual(allowed.sort(), ['/rt/card/', '/rt/s/', '/rt/snap/', '/rt/w/']);
    assert.equal(allowed.some((p) => /admin|guest|event|photo|league|recap/.test(p)), false);
  });
  it('lists the home page and /ads, absolute and on the public origin', () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.deepEqual(locs, [ORIGIN + '/', ORIGIN + '/ads']);
    assert.match(sitemap, /^<\?xml version="1.0" encoding="UTF-8"\?>\s*<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    assert.equal((sitemap.match(/<url>/g) || []).length, 2);
  });
  it('are served: not in .assetsignore, and not behind the worker-first routes (those are /rt/*, /.env*, /.git/*)', () => {
    for (const f of ['robots.txt', 'sitemap.xml', 'manifest.webmanifest', 'icons/app-icon-192.png', 'icons/app-icon-512.png', 'icons/app-icon-maskable-512.png', 'og.jpg']) assert.equal(C.ignoredBy(rules, f), false, f);
    const wrangler = read('wrangler.jsonc');
    assert.match(wrangler, /"run_worker_first": \["\/rt\/\*", "\/\.env\*", "\/\.git\/\*"\]/);
    assert.equal(/robots|sitemap/.test(wrangler), false);
  });
  it('prod-check knows what a good robots.txt, sitemap and manifest look like', () => {
    assert.equal(C.seoFault('robots', 200, 'text/plain; charset=utf-8', robots), '');
    assert.equal(C.seoFault('sitemap', 200, 'application/xml', sitemap), '');
    assert.equal(C.seoFault('manifest', 200, 'application/manifest+json', read('manifest.webmanifest')), '');
    assert.match(C.seoFault('robots', 404, 'text/html', ''), /status 404/);
    assert.match(C.seoFault('robots', 200, 'text/html', robots), /text\/plain/);
    assert.match(C.seoFault('robots', 200, 'text/plain', 'User-agent: *\nAllow: /\n'), /close/);
    assert.match(C.seoFault('robots', 200, 'text/plain', robots.replace(/^Sitemap:.*$/m, '')), /Sitemap/);
    assert.match(C.seoFault('sitemap', 200, 'text/html', '<html>'), /sitemap/);
    assert.match(C.seoFault('manifest', 200, 'application/json', '{"start_url":"/","display":"standalone","icons":[]}'), /icons/);
    assert.match(C.seoFault('manifest', 200, 'application/json', 'nope'), /JSON/);
  });
});

describe('index.html head', () => {
  it('has a Korean description of a snippet-sized length, a canonical link and the theme colour', () => {
    const d = meta('name', 'description');
    assert.ok(d && /[가-힣]/.test(d), 'Korean description');
    assert.ok(d.length >= 50 && d.length <= 90, 'description length ' + (d && d.length));
    assert.match(html, new RegExp(`<link rel="canonical" href="${ORIGIN}/" />`));
    assert.equal(meta('name', 'theme-color'), JSON.parse(read('manifest.webmanifest')).theme_color);
    assert.match(html, /<html lang="ko">/);
  });
  it('has complete Open Graph and Twitter tags on the public origin, with a 1200x630 picture and its alt text', () => {
    for (const k of ['og:title', 'og:description', 'og:type', 'og:url', 'og:site_name', 'og:locale', 'og:image', 'og:image:secure_url', 'og:image:type', 'og:image:width', 'og:image:height', 'og:image:alt']) assert.ok(meta('property', k), k);
    for (const k of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt']) assert.ok(meta('name', k), k);
    assert.equal(meta('property', 'og:url'), ORIGIN + '/');
    assert.equal(meta('name', 'twitter:card'), 'summary_large_image');
    for (const k of ['og:image', 'og:image:secure_url']) assert.match(meta('property', k), new RegExp('^' + ORIGIN + '/og\\.jpg(\\?v=\\d+)?$'));
    assert.match(meta('name', 'twitter:image'), new RegExp('^' + ORIGIN + '/og\\.jpg'));
    assert.deepEqual(jpegSize('og.jpg'), [Number(meta('property', 'og:image:width')), Number(meta('property', 'og:image:height'))]);
    assert.deepEqual(jpegSize('og.jpg'), [1200, 630]);
    assert.ok(bytes('og.jpg').length < 600 * 1024, 'og.jpg stays small enough for crawlers');
    assert.equal(meta('property', 'og:image:type'), 'image/jpeg');
    assert.ok(meta('property', 'og:image:alt').length >= 10);
  });
  it('keeps the share pages and the index page saying the same title and description (worker.js SITE)', () => {
    const w = read('worker.js');
    assert.ok(w.includes(`title: '${meta('property', 'og:title')}'`));
    assert.ok(w.includes(`desc: '${meta('property', 'og:description')}'`));
    assert.equal(meta('name', 'twitter:description'), meta('property', 'og:description'));
  });
  it('carries one small WebApplication JSON-LD block that parses', () => {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)];
    assert.equal(blocks.length, 1);
    const ld = JSON.parse(blocks[0][1]);
    assert.equal(ld['@context'], 'https://schema.org');
    assert.equal(ld['@type'], 'WebApplication');
    assert.equal(ld.url, ORIGIN + '/');
    assert.equal(ld.name, meta('property', 'og:title'));
    assert.equal(ld.inLanguage, 'ko');
    assert.equal(ld.applicationCategory, 'GameApplication');
    assert.deepEqual(ld.offers, { '@type': 'Offer', price: '0', priceCurrency: 'KRW' }); // free: no price is claimed beyond that
    assert.ok(blocks[0][1].length < 1200, 'minimal');
  });
});

describe('web app manifest and icons', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  it('names the app, starts at /, runs standalone and has the colours', () => {
    assert.equal(m.id, '/'); assert.equal(m.start_url, '/'); assert.equal(m.scope, '/'); assert.equal(m.display, 'standalone');
    assert.ok(m.name && m.short_name && m.short_name.length <= 12, 'short_name fits under an icon');
    assert.equal(m.lang, 'ko');
    for (const k of ['theme_color', 'background_color']) assert.match(m[k], /^#[0-9a-f]{6}$/i, k);
    assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest" \/>/);
  });
  it('has PNG icons at 192 and 512, and a maskable 512, all really that size and all served', () => {
    const by = (size, purpose) => m.icons.find((i) => i.sizes === size && i.purpose === purpose);
    for (const [size, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]) {
      const i = by(size, purpose); assert.ok(i, size + ' ' + purpose);
      assert.equal(i.type, 'image/png');
      const file = i.src.replace(/^\//, '').split('?')[0];
      assert.deepEqual(pngSize(file), size.split('x').map(Number), file);
      assert.equal(C.ignoredBy(rules, file), false, file);
    }
    // A single icon may not be both: a purpose of "any maskable" would crop the full-bleed one.
    assert.equal(m.icons.some((i) => /\bany\b/.test(i.purpose) && /maskable/.test(i.purpose)), false);
  });
});
