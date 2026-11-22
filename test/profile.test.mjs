import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { setSpecies } from '../profile.js';

it('keeps species inside 1..10 and names the equip RPC', () => {
  assert.equal(setSpecies(2), 2);
  assert.equal(setSpecies(3), 3);
  assert.equal(setSpecies(9), 9);
  assert.equal(setSpecies(10), 10);
  assert.equal(setSpecies(11), 1);
  assert.equal(setSpecies(0), 1);
  const sql = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  assert.match(sql, /FUNCTION public\.equip_cosmetic\(p_key TEXT, p_actor_id TEXT, p_cosmetic_id TEXT\)/);
  assert.match(sql, /'hat_ribbon'/);
  assert.match(sql, /'cab_yellow'/);
  assert.match(sql, /'frame_streak'/);
});

it('tints only the material named Main and renames no material', () => {
  const src = readFileSync(new URL('../ts3d/avatars.js', import.meta.url), 'utf8');
  assert.match(src, /id:\s*2,\s*label:\s*'고양이'/);
  assert.match(src, /id:\s*3,\s*label:\s*'곰'/);
  assert.match(src, /o\.material\?\.name === 'Main'/);
  assert.equal(/\.name\s*=\s*'(Main|Coat)'/.test(src), false);
});
