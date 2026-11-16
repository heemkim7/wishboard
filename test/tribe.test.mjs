import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { pledge, sendCheer } from '../tribe.js';

it('only pledges 10, 20, or 50 and cheers by phrase id', () => {
  assert.deepEqual(pledge('MAIN_TOP', 20), { slot: 'MAIN_TOP', amount: 20 });
  assert.equal(pledge('MAIN_TOP', 15), null);
  assert.deepEqual(sendCheer('STREET_8', 4), { t: 'CHEER', slot: 'STREET_8', p: 4 });
  assert.equal(sendCheer('STREET_8', 13), null);
});

it('wires the tribe sheet through tribe.js', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /openTribe/);
  assert.match(main, /sendCheer/);
  assert.match(main, /pledge\(/);
});
