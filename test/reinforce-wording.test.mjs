// Before the season test: the game words left on screen are gone (레벨 · 명성 on the profile, the 명성 +1 notice), the vacant
// corner board and the cheer phrase name the place as 가상 타임스퀘어 / 전광판, and the 전광판 tab's empty line speaks of boards.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { CHEER_PHRASES } from '../plaza-account.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

it('no old wording is left in the visitor-facing code', () => {
  const files = ['ui.js', 'main.js', 'plaza-account.js', 'ts3d/screens.js', 'index.html'];
  for (const f of files) {
    const src = read(f);
    for (const bad of ['뉴욕 한복판', '타임스퀘어에 걸렸어요', '명성', '레벨 $', '아직 걸린 소원이 없어요', '뉴욕 타임스퀘어 전광판']) {
      assert.equal(src.includes(bad), false, `${f} still has ${bad}`);
    }
  }
  assert.match(read('ts3d/screens.js'), /'내 이름을 가상 타임스퀘어에'/);
  assert.match(read('ui.js'), /'아직 켜진 전광판이 없어요\.'/);
});

it('the 12th cheer phrase keeps its index and names the board', () => {
  assert.equal(CHEER_PHRASES.length, 12);
  assert.equal(CHEER_PHRASES[11], '전광판에 걸렸어요');
});

it('relight no longer shows 명성 +1 nor counts it on the device', () => {
  const main = read('main.js');
  const relight = main.slice(main.indexOf('async function relight('), main.indexOf('function celebrateClaim('));
  assert.doesNotMatch(relight, /ui\.note\(/);
  assert.doesNotMatch(relight, /reputation/);
});
