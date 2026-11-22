import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { applyBall, applyOps, ballNotice, nextBallUntil } from '../live.js';

it('describes the 21:00 window without touching coins', () => {
  const open = { t: 'BALL', open: true, until: Date.parse('2026-11-15T12:10:00Z') };
  assert.equal(applyBall(open).includes('21:10'), true);
  assert.equal(applyOps({ copy: '새해 카운트다운' }), '새해 카운트다운');
  assert.equal(nextBallUntil(Date.parse('2026-11-15T03:00:00Z'), false), Date.parse('2026-11-15T12:00:00Z'));
  assert.equal(nextBallUntil(Date.parse('2026-11-15T12:05:00Z'), true), Date.parse('2026-11-15T12:10:00Z'));
  assert.equal(ballNotice(false, { t: 'BALL', open: false }), '');
  assert.equal(ballNotice(false, open).includes('21:10'), true);
  assert.equal(ballNotice(true, { t: 'BALL', open: false }).includes('밤 9시'), true);
  assert.equal(ballNotice(true, open), '');
});

it('adds the two KST crons beside the hourly return cron', () => {
  const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(wrangler, /5 \* \* \* \*/);
  assert.match(wrangler, /50 11 \* \* \*/);
  assert.match(wrangler, /0 12 \* \* \*/);
  const sql = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  assert.match(sql, /s1-2027/);
  assert.match(sql, /2027-01-01/);
  assert.match(sql, /2027-01-28/);
  assert.equal(sql.includes('2026-11-19'), false);
});
