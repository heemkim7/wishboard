import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { CHEER_PHRASES, LINK_HOSTS, BAN_WORDS, blockedText, allowedLink } from '../plaza-account.js';

it('uses the fixed cheer list and the link allowlist', () => {
  assert.deepEqual(CHEER_PHRASES, [
    '응원해요', '오늘도 빛나요', '이름이 보여요', '같이 걸어요',
    '대단해요', '축하해요', '힘을 내요', '보고 있어요',
    '최고예요', '내일도 켜요', '우리 편이에요', '타임스퀘어에 걸렸어요',
  ]);
  assert.equal(BAN_WORDS.length > 0, true);
  assert.equal(blockedText('안녕'), false);
  assert.equal(blockedText('아' + BAN_WORDS[0] + '야'), true);
  assert.equal(allowedLink('https://www.youtube.com/watch?v=abc'), 'https://www.youtube.com/watch?v=abc');
  assert.equal(allowedLink('https://evil.example/youtube.com'), null);
  assert.equal(LINK_HOSTS.includes('threads.net'), true);
  assert.equal(LINK_HOSTS.includes('smartstore.naver.com'), true);
});

it('the arrival card no longer has a free-text cheer field', () => {
  const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
  assert.equal(ui.includes('한 줄 응원, 15자'), false);
  assert.match(ui, /CHEER_PHRASES/);
});
