import assert from 'node:assert/strict';
import { it } from 'node:test';
import { cardUrl } from '../share.js';
import { EVENT_NAMES } from '../plaza-account.js';

it('builds a card url and records share events', () => {
  assert.equal(cardUrl('STREET_8'), 'https://studio.wishboard.workers.dev/rt/card/STREET_8');
  assert.equal(cardUrl('STREET_8', { gift: true, ref: 'ab12cd34' }), 'https://studio.wishboard.workers.dev/rt/card/STREET_8?gift=1&ref=ab12cd34');
  assert.equal(cardUrl('MAIN_S'), '');
  assert.equal(EVENT_NAMES.includes('share_send'), true);
  assert.equal(EVENT_NAMES.includes('focus_enter'), true);
});
