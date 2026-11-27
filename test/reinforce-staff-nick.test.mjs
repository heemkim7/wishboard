// Plaza nicknames take the wish rule for staff-like names (wish.js staffNick). The worker's profile / claim / plot paths are in
// test/league.test.mjs ("refuses staff-like plaza nicknames"); here the rule itself, the room's presence name, the photo name, the guest merge
// and the browser's own checks before sending.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { W, makeEnv } from './reinforce-harness.mjs';
import { staffNick, wishNickFault, nickRefused, NICK_FIX, cleanNick } from '../wish.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

it('refuses staff-like names in every spelling the rule covers, the same on wishes', () => {
  const refused = ['admin', 'Admin', 'ADMIN', '공식', '공 식', '공식계정', 'official', 'Official팀', '운영자', '운 영 자', '관리자', '관리자님', 'administrator',
    'ａｄｍｉｎ', '운‍영자', 'ad­min', '공​식', 'OFFICIAL 계정', 'a d m i n', 'the Official', 'kimadmin', 'KIMADMIN', 'TheOfficial', 'sysadmin', 'officiallyadmin', '수학공식'];
  for (const n of refused) { assert.equal(staffNick(n), true, n); assert.equal(wishNickFault(n), 'nick', n); assert.equal(nickRefused(n), true, n); }
  for (const n of ['badminton', 'unofficial', 'officially', '비공식', '비공식팬', '참새', '네온후드', '공원산책', '', null]) assert.equal(staffNick(n), false, String(n));
  for (const n of ['badminton', 'unofficial', 'officially', '비공식', '비공식팬', '참새']) assert.equal(wishNickFault(n), '', n);
  assert.equal(nickRefused('네온봇3'), true); assert.equal(nickRefused('네온봇 팬'), false);
  assert.equal(NICK_FIX, '그 닉네임은 쓸 수 없어요. 닉네임을 바꿔 주세요');
  assert.equal(cleanNick('ａｄｍｉｎ'), 'ａｄｍｉｎ'); // the stored wish nick is unchanged; only the check folds it
});

it('the room shows a staff-like or 네온봇N presence name as 네온손님, in the presence packet and in WELCOME, with no DO call', async () => {
  const env = makeEnv(), R = env.room('chapel:square'), room = R.do;
  const sock = (id) => { const ws = { sent: [], send(s) { this.sent.push(JSON.parse(String(s))); }, close() {}, serializeAttachment() {}, deserializeAttachment() { return null; } };
    ws.a = { k: id, q: true, v2: true, fl: 0, lob: false, t: Date.now(), ls: Date.now(), m: null }; room.socks().set(ws, ws.a); return ws; };
  const watcher = sock('guest:watcher');
  const say = async (id, name) => { const ws = sock(id); await room.webSocketMessage(ws, JSON.stringify({ t: 'tr', m: { name, x: 1500, y: 1500 } })); return ws; };
  env.calls.length = 0;
  for (const [id, name, shown] of [['guest:a', '운영자', '네온손님'], ['guest:b', 'ａｄｍｉｎ', '네온손님'], ['guest:c', '네온봇7', '네온손님'], ['guest:d', '참새', '참새'], ['guest:e', 'badminton', 'badminton'], ['guest:f', 'The Officially', '네온손님'], ['guest:g', 'kimadmin', '네온손님']]) {
    const ws = await say(id, name);
    assert.equal(ws.a.m.name, shown, name);
    const pj = watcher.sent.filter((m) => m.t === 'pj' && m.k === id).pop(); assert.equal(pj.m.name, shown, name);
    const hi = watcher.sent.filter((m) => m.t === 'WELCOME').pop(); assert.equal(hi.name, shown, name);
  }
  assert.deepEqual(env.calls.filter((c) => c !== 'day.add'), [], 'no DO call for a presence name (day.add is the room counting its own requests, as before)');
});

it('a photo submission names a staff-like or 네온봇N sender as 네온손님', () => {
  for (const [raw, out] of [['운영자', '네온손님'], ['Official', '네온손님'], ['네온봇2', '네온손님'], ['', '네온손님'], ['참새', '참새'], ['비공식 팬', '비공식 팬']]) assert.equal(W.plazaName(raw), out, raw);
  assert.match(read('worker.js'), /p_nickname: plazaName\(b\.nickname \|\| b\.nick \|\| ''\), p_slot_id: slot, p_photo_id: id/);
});

it('the guest merge drops a staff-like name the same way it drops 네온봇N, and a claim checks the name before any read', () => {
  const w = read('worker.js');
  assert.match(w, /merge_guest_account', \{[^\n]*p_nickname: botNick\(b\?\.nickname\) \|\| staffNick\(b\?\.nickname\) \? ''/);
  const claim = w.slice(w.indexOf("const claim = u.pathname === '/rt/claim-billboard';"), w.indexOf("rpc =await supabaseRpc('claim_billboard'"));
  const at = claim.indexOf('if (botNick(nick) || staffNick(nick)) return J({ ok: false, error: BOT_NAME_ERR }, 400);');
  assert.ok(at > 0);
  for (const later of ['starterSlots(env, ctx)', 'boardFresh(slot)', 'hasHello(actor.id)', "rest/v1/billboards"]) assert.ok(claim.indexOf(later) > at, later);
});

it('the profile sheet says 닉네임을 바꿔 주세요 and focuses the name, wizard step 1 offers the profile, the entry card uses the same rule', () => {
  const ui = read('ui.js');
  assert.match(ui, /import \{[^}]*nickRefused, NICK_FIX[^}]*\} from '\.\/wish\.js'/);
  assert.match(ui, /if \(blockedText\(name\) \|\| nickRefused\(name\)\) \{ note\(NICK_FIX, 'err'\); input\.focus\?\.\(\); return; \}/);
  assert.match(ui, /if \(nickRefused\(hooks\.nick\?\.\(\)\)\) host\.append\(h\('p', \{ class: 'note err', role: 'alert', text: NICK_FIX \}\), h\('button', \{ class: 'btn ghost', type: 'button', text: '프로필에서 닉네임 바꾸기', onclick: \(\) => openProfile\(\) \}\)\);/);
  assert.match(ui, /if \(nickRefused\(name\) && !known\) \{ nickErr\.textContent = '그 이름은 쓸 수 없어요'/);
});
