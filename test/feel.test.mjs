import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { walkerPoints, ghostPacket } from '../ts3d/walkers.js';

it('builds unnamed walkers and a ghost without an account id', () => {
  const pts = walkerPoints(12);
  assert.equal(pts.length, 12);
  assert.equal(pts.every((p) => p.x >= -75 && p.x <= 75 && p.z >= -155 && p.z <= 400), true);
  const g = ghostPacket({ name: '맨해튼호떡74', x: 10, y: 20, actor_id: 'guest:secret' });
  assert.deepEqual(Object.keys(g).sort(), ['name', 't', 'x', 'y']);
  assert.equal(g.t, 'GHOST');
  assert.equal(g.name.length <= 12, true);
});

it('stops loading three from the cdn', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(html.includes('cdn.jsdelivr.net/npm/three@'), false);
  assert.match(html, /vendor\/three\/build\/three\.module\.js/);
  const world = readFileSync(new URL('../timesSquare3d.js', import.meta.url), 'utf8');
  assert.match(world, /preserveDrawingBuffer:\s*false/);
});
