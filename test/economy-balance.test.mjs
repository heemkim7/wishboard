import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PAY, PLAY, BONUS_KINDS, ballOpen, auctionClosed, claimSplit, BALANCE, takeGrants, stickerNext, chainBoost, cheerCount, countsAsActivity, askBid } from '../balance.js';
import * as BAL from '../balance.js';
import { taxiTrainMult } from '../taxiTrain.js';

describe('economy numbers', () => {
  // The non-game change (docs/non-game-plan-2026-11-22.md 4-3, 4-5): no controlled play pays 응원 포인트. The table that pays holds watching and
  // cheering (flat, a gap, an hour cap on the action, a day cap on the points), attendance, missions, the first visit and the cheer quest.
  it('matches the one balance table: what pays, and nothing for play', () => {
    assert.deepEqual(Object.keys(PAY).sort(), ['attend', 'cheer', 'hello', 'lounge', 'mission', 'quest']);
    assert.deepEqual({ ...PAY.cheer }, { base: 4, gapMs: 12000, perHour: 30, perDay: 30 });
    assert.deepEqual({ ...PAY.lounge }, { base: 2, gapMs: 20000, perHour: 30, perDay: 30 });
    assert.equal(BALANCE.cheerGroup, 8);
    assert.equal(PAY.hello, 40);
    assert.equal(PAY.mission, 15);
    assert.equal(PAY.attend, 30);
    assert.deepEqual({ ...PAY.quest }, { cheer: 30 });
    for (const k of ['bake', 'dance', 'fare', 'star', 'stunt', 'hive', 'pouch', 'lottery', 'mine', 'hourCap', 'ballHourCap', 'playFullS']) assert.equal(k in PAY, false, k);
    for (const f of ['curveOf', 'feverBall', 'scaledPay', 'fareRaw', 'farePay', 'bakeBase', 'danceBase', 'countsAsPlay']) assert.equal(f in BAL, false, f);
    for (const k of ['starCoin', 'bakeGold', 'bakeGood', 'danceShow', 'missionEarn', 'coinR']) assert.equal(k in BALANCE, false, k);
    assert.deepEqual([...BONUS_KINDS], ['attend', 'mission', 'hello', 'shot', 'lounge']);
    // the play keeps only its pacing, with no amounts
    assert.deepEqual(JSON.parse(JSON.stringify(PLAY)), { ring: { gapMs: 20000 }, hive: { gapMs: 15000 }, pick: { gapMs: 20000, moveM: 15, max: 4 }, drop: { gapMs: 15000 }, stage: { nearM: 8 } });
    assert.deepEqual([1, 2, 3, 4, 5].map(taxiTrainMult), [1, 2.2, 3.8, 6, 10]); // the taxi train's look; no fare uses it
  });

  it('splits a plot takeover without minting', () => {
    const out = claimSplit({ mode: 'claim', bid: 250, prevBid: 200, plot: true, live: true, landlordId: 'guest:land', buyerId: 'guest:buy', prevId: 'guest:old' });
    assert.deepEqual(out, { charge: 250, refund: 160, landlord: 45, burn: 45 });
    assert.ok(out.refund + out.landlord + out.burn === out.charge);
    assert.deepEqual(claimSplit({ mode: 'starter', bid: 0, plot: true, landlordId: 'guest:land', buyerId: 'guest:new' }), { charge: 0, refund: 0, landlord: 0, burn: 0 });
    const vacant = claimSplit({ mode: 'claim', bid: 100, plot: true, live: false, landlordId: 'guest:land', buyerId: 'guest:buy' });
    assert.equal(vacant.refund, 0);
    assert.equal(vacant.landlord, 50);
    assert.equal(vacant.burn, 50);
  });

  it('opens the main tower 21:00-21:10 KST (claims only; no pay multiplier any more)', () => {
    assert.equal(ballOpen(Date.parse('2026-11-15T03:00:00Z')), false);
    assert.equal(ballOpen(Date.parse('2026-11-15T12:00:00Z')), true);
    assert.equal(ballOpen(Date.parse('2026-11-15T12:10:00Z')), false);
    assert.equal(auctionClosed('MAIN_TOP', Date.parse('2026-11-15T03:00:00Z')), true);
    assert.equal(auctionClosed('STREET_8', Date.parse('2026-11-15T03:00:00Z')), false);
  });

  it('locks the 14-arg claim and the ledger reasons', () => {
    const sql = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
    assert.match(sql, /p_mode TEXT DEFAULT 'claim'/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.profiles/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.coin_ledger/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.billboard_history/);
    assert.match(sql, /auction_closed/);
    assert.match(sql, /prev_bid \* 80 \/ 100/);
    assert.equal(sql.includes('DROP TABLE'), false);
  });

  it('pays the bigger cheer only when one side holds the whole building', () => {
    const now = Date.parse('2026-11-17T00:00:00Z');
    const row = (id) => ({ slot_id: id, holder_id: 'a', holder_name: '힘', lit_until: '2026-11-18T00:00:00Z' });
    const held = [row('SUB_1A'), row('SUB_1B')];
    assert.equal(chainBoost(held, 'SUB_1A', now), true);
    assert.equal(chainBoost(held, 'SUB_2A', now), false);
    assert.equal(chainBoost([{ ...row('SUB_1A'), holder_id: 'b' }, row('SUB_1B')], 'SUB_1A', now), false);
  });

  it('counts cheering, watching and link visits as the day\'s activity, never play, attendance or one-off bonuses', () => {
    for (const k of ['cheer', 'lounge', 'click']) assert.equal(countsAsActivity(k), true, k);
    for (const k of ['fare', 'bake', 'dance', 'mine', 'star', 'stunt', 'hive', 'pouch', 'attend', 'hello', 'quest', 'mission', 'shot']) assert.equal(countsAsActivity(k), false, k);
  });

  it('lets the holder edit at the current bid', () => {
    const now = Date.parse('2026-11-17T03:00:00Z');
    const board = { slot_id: 'STREET_8', holder_id: 'me', current_bid: 0, lit_until: '2026-11-18T00:00:00Z' };
    assert.equal(askBid(board, [], 'me', '', now), 0);
    assert.equal(askBid({ ...board, current_bid: 248 }, [], 'me', '', now), 248);
    assert.equal(askBid({ ...board, current_bid: 248 }, [], 'other', '', now), 298);
  });

  it('keeps the higher cheer count when two rooms report', () => {
    assert.equal(cheerCount(2, 4), 4);
    assert.equal(cheerCount(5, 3), 5);
    assert.equal(cheerCount(0, 1), 1);
  });

  it('keeps eight known stickers and drops the last on wash', () => {
    const one = stickerNext([], '🔥부럽다!', 'add');
    assert.deepEqual(one, ['🔥부럽다!']);
    assert.equal(stickerNext(one, 'nope', 'add').length, 1);
    const full = Array.from({ length: 8 }, () => '👀내자리찜');
    assert.equal(stickerNext(full, '💖하트폭탄', 'add').length, 8);
    assert.equal(stickerNext(one, '', 'pop').length, 0);
  });

  it('shrinks a pending grant when the server pays less', () => {
    const left = takeGrants([{ n: 2, at: 1 }, { n: 1, at: 2 }], 1);
    assert.deepEqual(left, [{ n: 1, at: 1 }, { n: 1, at: 2 }]);
    assert.deepEqual(takeGrants([{ n: 2, at: 1 }], 5), []);
  });

  it('names the S-tier review RPCs', () => {
    const sql = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.billboard_reviews/);
    assert.match(sql, /FUNCTION public\.review_slot_claim\(p_key TEXT, p_id BIGINT, p_approve BOOLEAN\)/);
    assert.match(sql, /FUNCTION public\.takedown_billboard\(p_key TEXT, p_slot_id TEXT\)/);
    assert.match(sql, /운영자가 내렸습니다/);
  });
});

describe('조사: the particle after a name that is only known at run time', () => {
  it('follows the last sound: a final consonant takes the closed form, a vowel the open one', async () => {
    const { josa, slotName } = await import('../balance.js');
    assert.equal(josa('5번 메인거리', '을', '를'), '5번 메인거리를');
    assert.equal(josa('메인 타워 하단', '을', '를'), '메인 타워 하단을');
    assert.equal(josa('6번 분양 전광판', '은', '는'), '6번 분양 전광판은');
    assert.equal(josa('교차로 코너', '이', '가'), '교차로 코너가');
    // a trailing number is read aloud: 1 일, 3 삼, 6 육, 7 칠, 8 팔, 0 영 close; 2 이, 4 사, 5 오, 9 구 do not
    assert.equal(josa('PLOT 6', '을', '를'), 'PLOT 6을');
    assert.equal(josa('PLOT 5', '을', '를'), 'PLOT 5를');
    assert.equal(josa('room 10', '은', '는'), 'room 10은');
    // anything else (Latin letters, nothing at all) takes the open form and never throws
    assert.equal(josa('Times', '을', '를'), 'Times를');
    assert.equal(josa('', '을', '를'), '를');
    assert.equal(josa(null, '을', '를'), '를');
    // every board name the game has reads right with it
    for (const id of ['MAIN_TOP', 'MAIN_LOW', 'SUB_1A', 'STREET_5', 'STREET_12', 'PLOT_6']) {
      const s = josa(slotName(id), '을', '를');
      assert.ok(s.startsWith(slotName(id)) && /[을를]$/.test(s), id);
    }
  });
  it('is what the "taken" lines use, in the game, the inbox and the push text', () => {
    const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
    assert.match(read('ui.js'), /josa\(slotName\(t\.slot\), '을', '를'\)\} 가져갔어요/);
    assert.match(read('inbox.js'), /josa\(slotName\(m\.slot_id\), '을', '를'\)\} 가져갔어요/);
    assert.match(read('worker.js'), /josa\(slot, '을', '를'\)\} 가져갔어요/);
    for (const f of ['ui.js', 'main.js', 'inbox.js', 'worker.js']) assert.equal(/\}을 (가져갔어요|점령했습니다|완전 점령)/.test(read(f)), false, f);
  });
});
