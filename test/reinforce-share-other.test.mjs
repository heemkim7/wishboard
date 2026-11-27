// 공유 of someone else's lit board (openAd) and of other people's wishes (오늘의 소원): the card or wish page, through sendLink, paying nothing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { otherShare, SITE } from '../plaza-account.js';

const NOW = Date.parse('2027-08-01T03:00:00Z');
const board = (o = {}) => ({ slot_id: 'PLOT_9', holder_id: 'guest:holder', holder_name: '지민', lit_until: new Date(NOW + 3600e3).toISOString(), ...o });
const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
const between = (a, b) => ui.slice(ui.indexOf(a), ui.indexOf(b, ui.indexOf(a)));

it('gives a visitor the board card page with the holder named, and nothing to the owner or on a dark board', () => {
  assert.deepEqual(otherShare({ board: board(), me: 'guest:visitor', now: NOW }), {
    kind: 'board_other', title: 'WISH BOARD : 모두의 전광판', text: '지민님의 전광판이 가상 타임스퀘어에 걸려 있어요', url: SITE.replace(/\/+$/, '') + '/rt/card/PLOT_9' });
  assert.equal(otherShare({ board: board({ holder_name: '' }), me: 'guest:visitor', now: NOW }).text, '누군가님의 전광판이 가상 타임스퀘어에 걸려 있어요');
  assert.equal(otherShare({ board: board(), me: 'guest:holder', now: NOW }), null); // the owner
  assert.equal(otherShare({ board: board({ lit_until: new Date(NOW - 1).toISOString() }), me: 'guest:visitor', now: NOW }), null); // dark
  assert.equal(otherShare({ board: board({ holder_id: null }), me: 'guest:visitor', now: NOW }), null); // vacant
  assert.equal(otherShare({ board: board({ slot_id: '../x' }), me: 'guest:visitor', now: NOW }), null);
});

it("gives other people's wishes their /rt/w/<id> page, and nothing for my own", () => {
  const w = { id: 'abcdefghij', nick: '하늘', txt: '합격하게 해주세요' };
  assert.deepEqual(otherShare({ wish: w, own: false, origin: 'https://studio.wishboard.workers.dev/' }), {
    kind: 'wish_other', title: '하늘님의 소원', text: '"합격하게 해주세요" — 가상 타임스퀘어에 걸린 소원이에요', url: 'https://studio.wishboard.workers.dev/rt/w/abcdefghij' });
  assert.equal(otherShare({ wish: w, own: true }), null);
  assert.equal(otherShare({ wish: { ...w, mine: true } }), null);
  assert.equal(otherShare({ wish: { ...w, id: 'x' } }), null);
  assert.equal(otherShare({}), null);
});

it('openAd: a visitor gets 공유 next to the visitor buttons; the owner keeps 문구 수정 and 초대 링크 복사 and gets no 공유', () => {
  const ad = between('function openAd(slotId) {', 'const photoTold');
  assert.match(ad, /const other = mine \? null : otherShare\(\{ board: b, me: hooks\.actorId\?\.\(\) \|\| '' \}\);/);
  assert.match(ad, /other \? h\('button', \{ type: 'button', class: 'btn ghost', text: '공유', 'aria-label': .*onclick: \(\) => shareOther\(other, inviteBox\) \}\) : null,/);
  assert.match(ad, /mine \? h\('button', \{ type: 'button', class: 'btn primary', text: '문구 수정', onclick: \(\) => openBillboard\(slotId\) \}\)/);
  assert.match(ad, /mine \? h\('button', \{ type: 'button', class: 'btn ghost', text: '초대 링크 복사', onclick: \(\) => copyInvite\(slotId, '', inviteBox\) \}\) : h\('button', \{ type: 'button', class: 'btn ghost', text: '신고'/);
  assert.match(ad, /if \(!boardActive\(b\)\) \{ openBillboard\(slotId\); return; \}/); // only a lit board reaches this sheet
});

it('the wish list: a small 공유 on rows that are not mine, 44px tall, the action row --tap-gap apart', () => {
  const row = between('function wishRowEl(w, i) {', 'function paintList()');
  assert.match(row, /const other = own \? null : otherShare\(\{ wish: w, own, origin: location\.origin \}\);/);
  assert.match(row, /text: '공유', .*style: \{ minHeight: '44px' \}, onclick: \(\) => shareOther\(other\) \}\) : null;/);
  assert.match(row, /h\('div', \{ class: 'wa', style: \{ gap: 'var\(--tap-gap\)' \} \}, heart, shareBtn, rep\)/);
});

it('the shares go through sendLink without my invite code and call no reward: no shot bonus, no +300, no link-visit pay', () => {
  const fn = between('async function shareOther(o, into = null) {', 'const kakaoKey');
  assert.match(fn, /sendLink\(\{ kind: o\.kind, native: true, title: o\.title, text: o\.text, url: o\.url, into, invite: false \}\)/);
  for (const reward of ['askShot', 'hooks.bonus', 'shareBonus', 'adClick', 'copyInvite', 'ensureInvite', 'inviteCode']) assert.equal(fn.includes(reward), false, reward);
  const send = between('async function sendLink(', '// 카카오톡으로 보내기');
  assert.match(send, /if \(invite\) url = invited\(url, hooks\.inviteCode\?\.\(\)\);/);
  for (const reward of ['askShot', 'hooks.bonus', 'shareBonus', 'adClick']) assert.equal(send.includes(reward), false, reward);
  // The share bonus (+300) is asked for only from the 공유·코드 sheet, the photo bonus only from askShot, the link-visit pay only from 링크 열기.
  assert.equal((ui.match(/hooks\.shareBonus\?\.\(\)/g) || []).length, 1);
  assert.equal((ui.match(/hooks\.bonus\?\.\('shot'/g) || []).length, 1);
});
