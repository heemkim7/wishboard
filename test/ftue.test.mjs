import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { BALANCE } from '../balance.js';
import { claimWizard, lockCelebration, linesFault, LINES_ERR, airAsk, AIR_PRICE, photoVerdicts, PHOTO_WAIT_MS } from '../ftue.js';

it('offers the four starter streets before a paid slot', () => {
  assert.deepEqual(BALANCE.starterSlots, ['STREET_8', 'STREET_9', 'STREET_10', 'STREET_11']);
  const wiz = claimWizard('STREET_9');
  assert.equal(wiz.step, 1);
  assert.equal(wiz.free, true);
  assert.equal(wiz.mode, 'starter');
  wiz.choose('STREET_1');
  assert.equal(wiz.free, false);
  assert.equal(wiz.mode, 'claim');
  assert.equal(lockCelebration(5000), 5000);
  assert.equal(wiz.linesOk('안녕', '타임스퀘어', ''), true);
});

it('a blank board is refused: the free slot is never spent on three empty lines', () => {
  const wiz = claimWizard('STREET_9');
  assert.equal(wiz.linesOk('', '', ''), false);
  assert.equal(wiz.linesOk('  ', '\t', ' '), false);
  assert.equal(linesFault('', '', ''), 'empty');
  assert.equal(linesFault(undefined, null, ''), 'empty');
  assert.equal(linesFault('', '', '#소원'), '');
  assert.equal(linesFault('가'.repeat(17), '', ''), 'long');
  assert.equal(linesFault('가'.repeat(16), '', ''), '');
  assert.equal(typeof LINES_ERR.empty, 'string');
  assert.equal(wiz.payload().line1, ''); // nothing was kept by the refused check
  assert.equal(wiz.linesOk('', '둘째만', ''), true);
  assert.deepEqual([wiz.payload().line1, wiz.payload().line2, wiz.payload().line3], ['', '둘째만', '']);
});

it('the wizard keeps typed lines across 이전 and 다음', () => {
  const wiz = claimWizard('STREET_9');
  assert.deepEqual(wiz.lines, ['', '', '']);
  wiz.keep('반쯤 쓴 줄', '', '');
  assert.deepEqual(wiz.lines, ['반쯤 쓴 줄', '', '']);
  wiz.choose('STREET_8'); // back on step 1, another slot: the lines stay
  assert.deepEqual(wiz.lines, ['반쯤 쓴 줄', '', '']);
  const copy = wiz.lines;
  copy[0] = 'x';
  assert.equal(wiz.lines[0], '반쯤 쓴 줄'); // a copy, not the model's array
  assert.equal(wiz.linesOk('완성', '둘째', '셋째'), true);
  assert.deepEqual(wiz.lines, ['완성', '둘째', '셋째']);
});

it('the takeover asks a second time with the price and what is left', () => {
  assert.equal(AIR_PRICE, 5000);
  assert.deepEqual(airAsk({ line: '  ', pay: 'coins', have: 9000 }), { ok: false, err: '한 줄을 적어 주세요' });
  assert.equal(airAsk({ line: '안녕', pay: 'coins', have: 4999 }).ok, false);
  assert.match(airAsk({ line: '안녕', pay: 'coins', have: 4999 }).err, /5,000포인트가 필요해요. 지금 4,999포인트/);
  const coins = airAsk({ line: ' 안녕 타임스퀘어 ', pay: 'coins', have: 12345.7 });
  assert.deepEqual(coins, { ok: true, text: '안녕 타임스퀘어', cost: '5,000포인트', after: '쓴 뒤 잔액 7,345포인트' });
  assert.deepEqual(airAsk({ line: '안녕', pay: 'ticket', have: 0, tickets: 0 }), { ok: false, err: 'VIP 티켓이 없어요' });
  assert.deepEqual(airAsk({ line: '안녕', pay: 'ticket', have: 0, tickets: 3 }), { ok: true, text: '안녕', cost: 'VIP 티켓 1장', after: '남는 티켓 2장' });
});

it('the 60-second cover over every board is gone: no bar in any sheet, no takeover hook, and the Worker answers 410 off', () => {
  const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8'), main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const wk = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.equal(ui.includes('airBar'), false); assert.equal(ui.includes('hooks.takeover'), false);
  assert.equal(main.includes("kind: 'air', line"), false); assert.equal(/takeover: \(payload\)/.test(main), false);
  assert.match(wk, /if \(u\.pathname === '\/rt\/spend' && b\.kind === 'air'\) return J\(\{ ok: false, code: 'off', error: BOARD_ERR\.air \}, 410\);/);
});

it('photo review results are told once, also when they came while the player was away', () => {
  const now = Date.UTC(2026, 10, 21, 3);
  const me = 'guest:me';
  const w = (slot, id, extra = {}) => ({ slot, id, who: me, at: now - 1000, ...extra });
  const row = (slot, holder, id, st) => ({ slot_id: slot, holder_id: holder, photo_id: id, photo_status: st });
  const rows = [row('STREET_1', me, 'p1', 'pending'), row('STREET_2', me, 'p2', 'approved'), row('STREET_3', me, null, null),
    row('STREET_4', 'guest:other', null, null), row('STREET_5', 'user:me', 'p5', 'approved')];
  // STREET_6: sent while signed in as user:me, now a fresh guest after signing out, and the board is someone else's:
  // whether that account lost it or merged it away, this browser cannot tell, so it keeps waiting.
  const wait = [w('STREET_1', 'p1'), w('STREET_2', 'p2'), w('STREET_3', 'p3'), w('STREET_4', 'p4'), w('STREET_9', 'p9'), w('STREET_6', 'p6', { who: 'user:me' })];
  const v = photoVerdicts(wait, [...rows, row('STREET_6', 'guest:third', null, null)], me, now);
  assert.deepEqual(v.wait.map((x) => x.slot), ['STREET_1', 'STREET_9', 'STREET_6']); // still pending, no row yet, someone else now
  assert.deepEqual(v.told, [{ slot: 'STREET_2', id: 'p2', kind: 'on' }, { slot: 'STREET_3', id: 'p3', kind: 'off' }, { slot: 'STREET_4', id: 'p4', kind: 'lost' }]);
  // After linking, the board moved to the user id: the guest's photo is still mine.
  assert.deepEqual(photoVerdicts([w('STREET_5', 'p5')], rows, 'user:me', now).told, [{ slot: 'STREET_5', id: 'p5', kind: 'on' }]);
  // A temporary client id decides nothing; old entries go quietly; junk is dropped.
  assert.equal(photoVerdicts(wait, rows, 'c-123', now).wait.length, wait.length);
  assert.deepEqual(photoVerdicts([w('STREET_3', 'p3', { at: now - PHOTO_WAIT_MS - 1 })], rows, me, now), { wait: [], told: [] });
  assert.deepEqual(photoVerdicts([null, {}, { slot: 'STREET_3' }], rows, me, now), { wait: [], told: [] });
});

it('ui exposes the wizard hooks', () => {
  const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
  assert.match(ui, /starterSlots\.includes\(id\) && !b\?\.holder_id/);
  assert.match(ui, /function openClaimStep/);
  assert.match(ui, /function setNextLine/);
  assert.match(ui, /function setQuietBlock/);
  assert.match(ui, /position:\s*'sticky'/);
});

it('celebration lock is five seconds', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /lockCelebration\(5000\)/);
  assert.match(main, /setQuietBlock\(true\)/);
  assert.match(main, /setQuietBlock\(false\)/);
});
