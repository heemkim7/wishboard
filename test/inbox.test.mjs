import assert from 'node:assert/strict';
import { it } from 'node:test';
import { applyInboxPush } from '../inbox.js';

it('summarizes an away inbox message without an account id', () => {
  const line = applyInboxPush({ t: 'INBOX', kind: 'taken', slot_id: 'STREET_8', from_name: '하늘' });
  assert.equal(line.includes('하늘'), true);
  assert.equal(line.includes('guest:'), false);
});
