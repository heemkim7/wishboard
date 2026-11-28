// The boot card (index.html, 2026-11-27): the two makers are plain links in the static page, there before any script or the 3D city;
// the tagline says the plaza is virtual; the 3D plaza is the third choice under its own name; DISCOVER is a small link.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html'), boot = /<div id="boot"[\s\S]*?\n<\/div>\n/.exec(html)[0];

describe('the boot card', () => {
  it('offers 선물하기 and 내 전광판 as links in the static page, before the scripts', () => {
    const cta = /<nav class="bootcta"[\s\S]*?<\/nav>/.exec(boot)?.[0] || '';
    // A line icon (inline SVG, the gift and wish of uiicons.js) before the words; no emoji (2026-11-28).
    assert.match(cta, /<a class="bootbtn gift" href="\/gift"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true">[\s\S]*?<\/svg>누군가에게 선물하기<\/a>/);
    assert.match(cta, /<a class="bootbtn me" href="\/gift\?me=1"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true">[\s\S]*?<\/svg>내 전광판 만들기<\/a>/);
    assert.equal(/\p{Extended_Pictographic}/u.test(cta), false, 'no emoji');
    assert.match(cta, /<a class="bootdisc" href="\/discover">/);
    assert.ok(html.indexOf('class="bootcta"') < html.indexOf('src="./main.js'), 'in the markup, not built by a script');
    assert.ok(boot.indexOf('class="bootcta"') < boot.indexOf('id="bootEnter"'), 'above the 3D entry');
  });
  it('says first that anyone makes and shares a board for free (2026-11-28); one small coming-soon link, no price, no cards', () => {
    const h1 = /<h1>([\s\S]*?)<\/h1>/.exec(boot)?.[1] || '';
    assert.equal(h1, '누구나 무료로 전광판을 만들고 공유할 수 있어요');
    assert.ok(boot.indexOf('<h1>') < boot.indexOf('class="bootcta"'), 'the headline comes before the buttons');
    assert.match(html, /#boot h1 \{ margin: 16px 0 6px; font: 900 26px\/1\.25 var\(--font\);/);
    assert.equal((boot.match(/href="\/discover#soon"/g) || []).length, 1, 'one link to the coming-soon list');
    assert.match(boot, /<a class="bootsoon" href="\/discover#soon">준비 중인 기능<\/a>/);
    assert.equal(/출시 예정|관심 있어요|[0-9],[0-9]{3}원|결제|구매|유료/.test(boot), false, 'no card, price or pay word on the boot card');
    assert.ok(boot.indexOf('class="bootbtn gift"') < boot.indexOf('class="bootsoon"'), 'the free makers come first');
  });
  it('says in its tagline that the plaza is virtual', () => {
    const tag = /<div class="tag">([\s\S]*?)<\/div>/.exec(boot)[1];
    assert.match(tag, /가상 타임스퀘어 전광판에 걸어요/); assert.match(tag, /6시간 무료/); assert.equal(/당신/.test(tag), false, 'names what it does, not "당신의 특별한 순간"');
  });
  it('names the 3D entry 3D 광장 둘러보기 (a shared wish still relabels it)', () => {
    const ui = read('ui.js');
    assert.match(ui, /const BOOT_GO = '3D 광장 둘러보기';/);
    assert.equal(/bootLabel \|\| '입장하기'/.test(ui), false);
  });
  it('the makers stay side by side on a phone (one row, 44px or more to press), so the 3D entry stays on the first screen', () => {
    assert.equal(/#boot \.bootcta \{ grid-template-columns: 1fr; \}/.test(html), false, 'never stacked');
    assert.match(html, /#boot \.bootbtn \{[^}]*min-height: 48px/);
  });
  it('a short screen tightens the title so 3D 광장 둘러보기 is not pushed below the fold; no app mark or English badge on the card', () => {
    assert.match(html, /@media \(max-height: 760px\) \{ #boot h1 \{ font-size: 24px; margin: 10px 0 4px; \} #boot \.bootcta \{ margin-top: 10px; \} \}/); // the free-first headline is two lines (2026-11-28)
    assert.equal(/bootmark|NEW YORK WISH SQUARE/.test(boot), false);
  });
});
