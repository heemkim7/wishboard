import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

it('defines the attendance ladder RPC', () => {
  const sql = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  assert.match(sql, /FUNCTION public\.touch_attend\(p_key TEXT, p_actor_id TEXT\)/);
  assert.match(sql, /attend_streak/);
  assert.match(sql, /ARRAY\[10, 12, 15, 20, 30\]/);
});
