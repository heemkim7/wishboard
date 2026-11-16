import assert from 'node:assert/strict';
import { it } from 'node:test';
import { renderCardPng } from '../cardpng.js';

it('renders a small deterministic PNG', async () => {
  const a = await renderCardPng({ name: '수지', line1: '합격', line2: '기원', line3: '', tier: 'C' });
  const b = await renderCardPng({ name: '수지', line1: '합격', line2: '기원', line3: '', tier: 'C' });
  const c = await renderCardPng({ name: '수지', line1: '다른문구', line2: '기원', line3: '', tier: 'S' });
  assert.equal(a[0], 0x89);
  assert.equal(a[1], 0x50);
  assert.ok(a.length <= 40000);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(a[16], 0);
  assert.equal(a[17], 0);
  assert.equal(a[18], 2);
  assert.equal(a[19], 0x58);
  assert.equal(a[20], 0);
  assert.equal(a[21], 0);
  assert.equal(a[22], 1);
  assert.equal(a[23], 0x3b);
});
