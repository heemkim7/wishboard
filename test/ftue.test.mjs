import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { BALANCE } from '../balance.js';
import { claimWizard, lockCelebration } from '../ftue.js';

it('offers the four starter streets before a paid slot', () => {
  assert.deepEqual(BALANCE.starterSlots, ['STREET_8', 'STREET_9', 'STREET_10', 'STREET_11']);
  const wiz = claimWizard('STREET_9');
  assert.equal(wiz.step, 1);
  assert.equal(wiz.free, true);
  assert.equal(wiz.mode, 'starter');
  wiz.choose('STREET_1');
  assert.equal(wiz.free, false);
  assert.equal(wiz.mode, 'claim');
  assert.equal(lockCelebration(5000), 5000);
  assert.equal(wiz.linesOk('안녕', '타임스퀘어', ''), true);
});

it('ui exposes the wizard hooks', () => {
  const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
  assert.match(ui, /function openClaimStep/);
  assert.match(ui, /function setNextLine/);
  assert.match(ui, /function setQuietBlock/);
  assert.match(ui, /position:\s*'sticky'/);
});

it('celebration lock is five seconds', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /lockCelebration\(5000\)/);
  assert.match(main, /setQuietBlock\(true\)/);
  assert.match(main, /setQuietBlock\(false\)/);
});
