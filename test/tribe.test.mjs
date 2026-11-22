import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import * as T from '../tribe.js';

it('cheers by phrase id; there is no pledge (소속 모금 is closed: points are never pooled)', () => {
  assert.deepEqual(T.sendCheer('STREET_8', 4), { t: 'CHEER', slot: 'STREET_8', p: 4 });
  assert.equal(T.sendCheer('STREET_8', 13), null);
  assert.equal('pledge' in T, false);
});

it('wires the tribe sheet through tribe.js, without a pledge row', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
  assert.match(main, /openTribe/);
  assert.match(main, /sendCheer/);
  assert.doesNotMatch(main, /pledge|\/rt\/tribe\/pledge/);
  assert.doesNotMatch(ui, /hooks\.pledge|pledgeRow|소속 모금/);
  assert.match(ui, /text: '소속 포인트로 걸기'/); // a tribe's points pledged before the change still pay for its claims
});
