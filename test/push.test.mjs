import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { installHint } from '../push.js';

it('asks iOS tabs to install before subscribing', () => {
  assert.equal(installHint({ ios: true, standalone: false }).includes('홈 화면'), true);
  assert.equal(installHint({ ios: true, standalone: true }), '');
  const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(wrangler, /5 \* \* \* \*/);
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(worker, /PLAN !== 'paid'/);
});
