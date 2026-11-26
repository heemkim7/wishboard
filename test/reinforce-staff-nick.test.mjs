// Plaza nicknames take the wish rule for staff-like names (wish.js STAFF, spaces ignored). The worker paths are in test/league.test.mjs
// ("refuses staff-like plaza nicknames"); here the rule itself, the guest merge and the browser's own checks before sending.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { staffNick, wishNickFault } from '../wish.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

it('staffNick refuses 운영자, 공 식, Official팀 and passes an ordinary name, like the wish rule', () => {
  for (const n of ['운영자', '공 식', 'Official팀', '관리자님', '운 영 자', 'ADMIN', '공​식']) { assert.equal(staffNick(n), true, n); assert.equal(wishNickFault(n), 'nick', n); }
  for (const n of ['참새', '네온후드', '공원산책', '', null]) assert.equal(staffNick(n), false, String(n));
});

it('the guest merge drops a staff-like name the same way it drops 네온봇N', () => {
  const w = read('worker.js');
  assert.match(w, /merge_guest_account', \{[^\n]*p_nickname: botNick\(b\?\.nickname\) \|\| staffNick\(b\?\.nickname\) \? ''/);
  assert.match(w, /rejectedCopy\(nick\) \|\| botNick\(nick\) \|\| staffNick\(nick\)\) return J\(\{ ok: false, error: '그 이름은 쓸 수 없어요' \}/);
  assert.equal((w.match(/if \(botNick\(nick\) \|\| staffNick\(nick\)\) return J\(\{ ok: false, error: BOT_NAME_ERR \}/g) || []).length, 2); // claim and plot
});

it('the profile sheet and the entry card check the same rule before sending', () => {
  const ui = read('ui.js');
  assert.match(ui, /import \{[^}]*staffNick[^}]*\} from '\.\/wish\.js'/);
  assert.match(ui, /if \(blockedText\(name\) \|\| botNick\(name\) \|\| staffNick\(name\)\) \{ note\('그 이름은 쓸 수 없어요', 'err'\)/);
  assert.match(ui, /if \(\(botNick\(name\) \|\| staffNick\(name\)\) && !known\) \{ nickErr\.textContent = '그 이름은 쓸 수 없어요'/);
});
