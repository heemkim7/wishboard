// claim_start (the 전광판 걸기 wizard opening) next to board_claim, and the first meaningful action of a new account, in the daily summary.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { makeEnv, harness, withClock, DAY } from './reinforce-harness.mjs';
import { EVENT_NAMES, slotTier } from '../plaza-account.js';
import { gaName, gaParams } from '../analytics.js';
import { claimStarter, sheetStarts } from '../growth.js';

const NOON = Date.parse('2027-05-03T03:00:00Z'); // 12:00 KST

describe('claim_start: the wizard reports its opening once per open', () => {
  it('sends once for a fresh wizard, not again when 이전 goes back to step 1, and again for the next open', () => {
    const start = claimStarter(slotTier);
    const model = { slot: 'STREET_3', free: true };
    assert.deepEqual(start(model, 'tool'), { tier: 'C', kind: 'starter', from: 'tool' });
    assert.equal(start(model, 'tool'), null); // step 2 -> 이전 -> step 1: the same model
    assert.equal(start(model), null);
    assert.deepEqual(start({ slot: 'SUB_2', free: false }, 'goal'), { tier: 'B', kind: 'claim', from: 'goal' });
    assert.deepEqual(start({ slot: 'MAIN_TOP', free: false }), { tier: 'S', kind: 'claim' });
    assert.equal(start(null), null);
  });
  it('is wired at step 1 of the wizard and at every opening of the claim form, each saying where it came from', () => {
    const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    assert.match(ui, /function openClaimStep\(n, model, from = ''\) \{\n\s*if \(!model\) return;\n\s*if \(n === 1\) \{ const start = claimStart\(model, from\); if \(start\) trackEvent\('claim_start', start\); \}/);
    // The other surface: the 전광판 걸기 sheet, a start only when it opens to light a board this visitor does not hold (growth.js sheetStarts).
    assert.match(ui, /function openBillboard\(slotId = '', zone = '', from = 'sheet'\) \{\n\s*if \(isPrimeSlot\(slotId\)\) \{[^\n]*\n\s*hooks\.refreshWorld\?\.\(\);\n\s*let slot = slotId \|\| 'STREET_1';\n\s*if \(sheetStarts\(\{ slot: slotId, board: slotId \? boardById\(slotId\) : null, me: hooks\.actorId\?\.\(\) \|\| '', now: Date\.now\(\), from \}\)\) \{\n\s*const start = claimStart\(\{ slot, free: false \}, from\); if \(start\) trackEvent\('claim_start', start\); \}/);
    assert.match(ui, /text: '전광판 고르기', onclick: \(\) => openBillboard\('PLOT_1', '', 'wizard'\) \}/); // inside the wizard's flow
    assert.equal((ui.match(/trackEvent\('claim_start'/g) || []).length, 2);
    const opens = [...ui.matchAll(/openClaimStep\(1, claimWizard\([^)]*\)(, '(\w+)')?\)/g)];
    assert.equal(opens.length, 3);
    assert.deepEqual(opens.map((m) => m[2]), ['tool', 'goal', 'toast']);
    assert.match(ui, /else openBillboard\(slot \|\| '', '', 'sheet_tool'\);/); // the tool while already holding a board
    // Each opening of the form is a new object: one claim_start per opening.
    const start = claimStarter(slotTier);
    assert.deepEqual(start({ slot: 'PLOT_4', free: false }, 'sheet'), { tier: 'C', kind: 'claim', from: 'sheet' });
    assert.deepEqual(start({ slot: 'PLOT_4', free: false }, 'sheet_tool'), { tier: 'C', kind: 'claim', from: 'sheet_tool' });
  });
  it('the sheet is a start only to light a board the visitor does not hold, and not inside the wizard', () => {
    const NOW = Date.parse('2027-05-03T03:00:00Z'), lit = (holder) => ({ slot_id: 'PLOT_4', holder_id: holder, lit_until: new Date(NOW + 3600e3).toISOString() });
    const dark = (holder) => ({ slot_id: 'PLOT_4', holder_id: holder, lit_until: new Date(NOW - 1).toISOString() });
    const s = (o) => sheetStarts({ me: 'guest:me', now: NOW, from: 'sheet', ...o });
    assert.equal(s({ slot: '' }), true, 'the picker, to find a board');
    assert.equal(s({ slot: 'PLOT_4', board: { slot_id: 'PLOT_4', holder_id: null } }), true, 'a vacant board');
    assert.equal(s({ slot: 'PLOT_4', board: dark('guest:other') }), true, "someone else's board whose light is out");
    assert.equal(s({ slot: 'PLOT_4', board: lit('guest:me') }), false, '문구 수정 on my own lit board');
    assert.equal(s({ slot: 'PLOT_4', board: dark('guest:me') }), false, 'my own dark board: a relight, not a start');
    assert.equal(s({ slot: 'PLOT_4', board: lit('guest:other') }), false, "someone else's lit board (a notice about a taken board)");
    assert.equal(s({ slot: 'PLOT_1', board: { slot_id: 'PLOT_1', holder_id: null }, from: 'wizard' }), false, "the wizard's 전광판 고르기: that flow already sent one");
    assert.equal(s({ slot: '', from: 'sheet_tool' }), true);
    const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    assert.match(html, /내 전광판 문구 수정·불 켜기, 남의 켜진 전광판, 안내 창 안의 전광판 고르기는 시작으로 세지 않습니다\./);
  });
  it('reaches the same pipelines as board_claim: the first-party event list and GA', () => {
    assert.ok(EVENT_NAMES.includes('claim_start') && EVENT_NAMES.includes('board_claim'));
    assert.equal(gaName('claim_start'), 'claim_start');
    assert.deepEqual(gaParams({ tier: 'C', kind: 'starter', from: 'toast' }), { tier: 'C', kind: 'starter', from: 'toast' });
  });
});

describe('the daily summary: started vs published, and the first meaningful action', { concurrency: false }, () => {
  it('counts accounts that started and that published, and new accounts that did one of wish, heart, cheer, claim', async () => {
    await withClock(NOON, async (clock) => {
      const env = makeEnv(), { guest, ev, stats } = harness(env);
      const [A, B, C, D, E, F] = [await guest(), await guest(), await guest(), await guest(), await guest(), await guest()];
      await ev('page_landing', 'sess-e-0001', E); // E is first seen the day before
      clock.add(DAY);
      await ev('claim_start', 'sess-a-0001', A, { tier: 'C', kind: 'starter', from: 'tool' }); await ev('claim_start', 'sess-a-0002', A, { tier: 'C', kind: 'claim' }); // two tabs: one account
      await ev('board_claim', 'sess-a-0002', A, { tier: 'C' });
      await ev('claim_start', 'sess-b-0001', B, { tier: 'C', kind: 'starter', from: 'goal' }); // started, never published
      await ev('wish_post', 'sess-c-0001', C, { fresh: 1 });
      await ev('page_landing', 'sess-d-0001', D); // nothing meaningful
      await ev('wish_heart', 'sess-e-0002', E); // meaningful, but E is not new today
      await ev('wish_cheer', 'sess-f-0001', F, { slot: 'STREET_3' });
      await ev('claim_start', 'sess-x-0001'); // a session without an account is not an account
      let s = await stats();
      const today = s.days[0];
      assert.equal(today.day, '2027-05-04');
      assert.deepEqual([today.start_accounts, today.claim_accounts], [2, 1]);
      assert.equal(today.new, 5); // A, B, C, D, F
      assert.equal(today.act_new, 3); // A (claim), C (wish), F (cheer)
      assert.equal(today.events.claim_start, 4);
      // The day is folded when the next day's first event arrives: the numbers stay.
      clock.add(DAY);
      await ev('page_landing', 'sess-d-0002', D);
      s = await stats('?days=3');
      const folded = s.days.find((d) => d.day === '2027-05-04');
      assert.deepEqual([folded.start_accounts, folded.claim_accounts, folded.act_new], [2, 1, 3]);
      const first = s.days.find((d) => d.day === '2027-05-03');
      assert.deepEqual([first.start_accounts, first.act_new], [0, 0]);
    });
  });
});
