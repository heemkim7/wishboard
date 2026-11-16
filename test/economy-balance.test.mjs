import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PAY, curveOf, ballOpen, auctionClosed, feverBall, scaledPay, claimSplit, fareRaw, farePay, bakeBase, danceBase, BALANCE } from '../balance.js';
import { taxiTrainMult } from '../taxiTrain.js';

describe('economy numbers', () => {
  it('matches the one balance table', () => {
    assert.equal(BALANCE.starCoin, 6);
    assert.equal(bakeBase('miss'), 0);
    assert.equal(bakeBase('good'), 6);
    assert.equal(bakeBase('gold'), 16);
    assert.equal(danceBase(90), 12);
    assert.equal(danceBase(75), 8);
    assert.equal(danceBase(55), 4);
    assert.equal(danceBase(10), 2);
    assert.equal(PAY.cheer.base, 4);
    assert.equal(PAY.lounge.base, 2);
    assert.equal(PAY.hello, 40);
    assert.deepEqual([1, 2, 3, 4, 5].map(taxiTrainMult), [1, 2.2, 3.8, 6, 10]);
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

  it('applies fever once, then the curve and the window', () => {
    assert.equal(feverBall(true, true), 2);
    assert.equal(curveOf(3599), 1);
    assert.equal(curveOf(3600), 0.3);
    assert.equal(fareRaw(1, false, false, false), 20);
    assert.equal(fareRaw(1, true, true, true), 80);
    assert.equal(farePay(1, { revenge: true, fever: true, ball: true, playSeconds: 0, earnedInWindow: 0 }), 80);
    assert.equal(farePay(1, { playSeconds: 0, earnedInWindow: 1190 }), 10);
    assert.equal(scaledPay(16, { fever: true, ball: true, playSeconds: 3600, earnedInWindow: 0 }), Math.floor(16 * 0.3 * 2));
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

  it('names the S-tier review RPCs', () => {
    const sql = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.billboard_reviews/);
    assert.match(sql, /FUNCTION public\.review_slot_claim\(p_key TEXT, p_id BIGINT, p_approve BOOLEAN\)/);
    assert.match(sql, /FUNCTION public\.takedown_billboard\(p_key TEXT, p_slot_id TEXT\)/);
    assert.match(sql, /운영자가 내렸습니다/);
  });
});
