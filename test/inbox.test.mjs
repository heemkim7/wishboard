import assert from 'node:assert/strict';
import { it } from 'node:test';
import { applyInboxPush } from '../inbox.js';

it('summarizes an away inbox message without an account id', () => {
  const line = applyInboxPush({ t: 'INBOX', kind: 'taken', slot_id: 'STREET_8', from_name: '하늘' });
  assert.equal(line.includes('하늘'), true);
  assert.equal(line.includes('8번 메인거리'), true);
  assert.equal(line.includes('guest:'), false);
  assert.equal(applyInboxPush({ kind: 'cheer', phrase: 1, from_name: '하늘' }), '하늘님: 응원해요');
  assert.equal(applyInboxPush({ kind: 'reply', phrase: 2, from_name: '힘킴' }), '힘킴님의 답례: 오늘도 빛나요');
});
