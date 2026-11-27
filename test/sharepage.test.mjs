// The 3D-free share pages (/rt/card/<slot>, /rt/w/<id>): a card drawn in HTML, the three buttons, the friends line, and no automatic jump into
// the 3D plaza. The Open Graph tags stay for the link previews; everything people wrote is escaped.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sharePage } from '../sharepage.js';

const base = { title: '민지 생일 축하', desc: '오늘도 화이팅', image: 'https://sq.example/og.jpg', url: 'https://sq.example/rt/card/STREET_9', dest: '/?focus=STREET_9', chip: '전광판', big: '생일 축하해', line: '오늘도 화이팅', by: 'by 민지', fr: '친구 3명이 응원했어요' };

describe('share page', () => {
  it('keeps the link-preview tags and says noindex', () => {
    const html = sharePage(base);
    for (const t of ['og:title', 'og:description', 'og:image', 'og:url']) assert.match(html, new RegExp('<meta property="' + t + '" content="'), t);
    assert.match(html, /<meta property="og:image" content="https:\/\/sq\.example\/og\.jpg">/);
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.match(html, /<meta name="viewport"/);
  });
  it('never jumps into the 3D plaza by itself: no refresh, no location.replace', () => {
    const html = sharePage(base);
    assert.equal(/http-equiv="refresh"/i.test(html), false); assert.equal(/location\.(replace|assign|href\s*=)/.test(html), false);
  });
  it('offers 3D 광장에서 보기 (the old address), 공유하기 and 나도 만들기, and says the plaza is virtual', () => {
    const html = sharePage(base);
    assert.match(html, /<a class="btn gold" href="\/\?focus=STREET_9">3D 광장에서 보기<\/a>/);
    assert.match(html, /<button[^>]*id="share"[^>]*>공유하기<\/button>/);
    assert.match(html, /<a class="btn" href="\/gift">나도 만들기<\/a>/);
    assert.match(html, /가상/); assert.equal(html.includes('타임스퀘어에서 이 전광판 보기'), false);
    assert.match(html, /친구 3명이 응원했어요/);
    assert.equal(sharePage({ ...base, fr: '' }).includes('응원했어요'), false, 'no line without friends');
  });
  it('나도 만들기 keeps what the link carried (make), /gift without it', () => {
    assert.match(sharePage({ ...base, make: '/gift?inv=ab12cd34&pref=zz99yy88' }), /<a class="btn" href="\/gift\?inv=ab12cd34&amp;pref=zz99yy88">나도 만들기<\/a>/);
    assert.match(sharePage({ ...base, make: 'https://evil.example/' }), /<a class="btn" href="\/gift">나도 만들기<\/a>/, 'only a /gift address');
  });
  it('a long card grows instead of clipping (16:9 is the least it is), and the chip has a row of its own', () => {
    const css = /<style>([\s\S]*?)<\/style>/.exec(sharePage(base))[1], rule = (sel) => new RegExp('(^|\\})' + sel.replace(/[.*]/g, '\\$&') + '\\{([^}]*)\\}').exec(css)?.[2] || '';
    assert.match(rule('.card'), /aspect-ratio:16\/9/); assert.doesNotMatch(rule('.card'), /overflow:hidden/);
    assert.doesNotMatch(rule('.chip'), /position:absolute/);
    const html = sharePage({ ...base, big: '가'.repeat(24), line: '나'.repeat(24) + ' · ' + '다'.repeat(24) });
    assert.match(html, /<section class="card"[^>]*><span class="chip">[^<]*<\/span><div class="mid">/);
  });
  it('escapes every field and keeps people\'s words out of the script', () => {
    const bad = '"><script>alert(1)</script><b>x</b>&\'';
    const html = sharePage({ ...base, title: bad, desc: bad, chip: bad, big: bad, line: bad, by: bad, fr: bad, dest: '/?x="><script>' });
    assert.equal(html.includes('<script>alert'), false); assert.equal(html.includes('<b>'), false); assert.match(html, /&quot;&gt;&lt;script&gt;/);
    assert.equal(html.includes('"><script>'), false);
    const scripts = html.match(/<script>[\s\S]*?<\/script>/g) || [];
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].includes('alert'), false);
  });
});
