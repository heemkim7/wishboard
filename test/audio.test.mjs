import assert from 'node:assert/strict';
import { it } from 'node:test';
import { play, startMusic, haptic, SFX, MUSIC } from '../audio.js';

it('lists twenty effects and three tracks and vibrates only on a number', () => {
  assert.equal(SFX.length, 20);
  assert.deepEqual(MUSIC, ['plaza', 'drive', 'night']);
  assert.equal(play('nope'), false);
  assert.equal(startMusic('plaza'), 'assets/audio/plaza.ogg');
  assert.equal(startMusic('other'), '');
  const calls = [];
  haptic(40, { vibrate(n) { calls.push(n); } });
  haptic(-1, { vibrate() { calls.push('no'); } });
  assert.deepEqual(calls, [40]);
});
