import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

it('relights without moving coins', () => {
  const sql = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  assert.match(sql, /FUNCTION public\.relight_billboard\(p_key TEXT, p_actor_id TEXT, p_slot_id TEXT\)/);
  assert.match(sql, /lit_until TIMESTAMPTZ/);
  assert.match(sql, /interval '72 hours'/);
  const start = sql.indexOf('FUNCTION public.relight_billboard');
  const fn = sql.slice(start, sql.indexOf('$$;', start));
  assert.equal(fn.includes('coins'), false);
});

it('the client asks relight and marks my slot', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const world = readFileSync(new URL('../timesSquare3d.js', import.meta.url), 'utf8');
  assert.match(main, /\/rt\/relight/);
  assert.match(world, /setMyBeacon/);
  assert.match(world, /pinSlot/);
});

it('keeps the refund inside the bid and clears a dark board without paying', () => {
  const sql = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  const account = readFileSync(new URL('../plaza-account.js', import.meta.url), 'utf8');
  assert.match(sql, /COALESCE\(v_board\.lit_until, v_board\.expires_at\) > now\(\)/);
  assert.match(sql, /FUNCTION public\.clear_dark_boards\(p_key TEXT\)/);
  const clearAt = sql.indexOf('FUNCTION public.clear_dark_boards');
  const clearFn = sql.slice(clearAt, sql.indexOf('$$;', clearAt));
  assert.equal(clearFn.includes('coins'), false);
  assert.equal(sql.includes('THEN 720'), false);
  assert.equal(sql.includes('THEN 360'), false);
  assert.equal(sql.includes('THEN 180'), false);
  assert.match(sql, /prev_bid \* 80 \/ 100/);
  assert.match(sql, /v_protect_mins := v_protect_mins \+ 5/);
  assert.match(sql, /lit_days = 1/);
  assert.match(worker, /\/rt\/relight/);
  assert.match(worker, /clear_dark_boards/);
  assert.match(worker, /if \(env\.PLAN !== 'paid'\) return;/);
  assert.equal(account.includes("'relight'"), true);
  const scheduled = worker.slice(worker.indexOf('async scheduled'));
  const paidAt = scheduled.indexOf("if (env.PLAN !== 'paid') return;");
  assert.ok(paidAt >= 0);
  assert.ok(scheduled.indexOf('clear_dark_boards') > paidAt);
});
