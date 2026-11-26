// The admin rows under the 성장 퍼널 (growth.js dayTable): first action, wizard started vs published, share pages served, cheers paid / free.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { DAY_ROWS, dayVal, dayTable, MIN_BASE } from '../growth.js';

const day = (d, o = {}) => ({ day: d, new: 0, act_new: 0, start_accounts: 0, claim_accounts: 0,
  links: { card: { people: 0, auto: 0 }, wish: { people: 0, auto: 0 }, shot: { people: 0, auto: 0 } }, cheers: { paid: 0, free: 0 }, ...o });

it('reads each row from the day fields, a missing day as 0 and a field folded before it existed as unknown', () => {
  assert.deepEqual(DAY_ROWS.map((r) => r.key), ['new', 'act_new', 'start_accounts', 'claim_accounts', 'links.card.people', 'links.card.auto', 'links.wish.people', 'links.wish.auto',
    'links.shot.people', 'links.shot.auto', 'cheers.paid', 'cheers.free']);
  assert.equal(dayVal(null, 'cheers.paid'), 0);
  assert.equal(dayVal({ day: 'x' }, 'cheers.paid'), null);
  assert.equal(dayVal(day('x', { cheers: { paid: 3, free: 1 } }), 'cheers.free'), 1);
  assert.equal(dayVal(day('x', { links: { card: { people: 5, auto: 2 } } }), 'links.card.auto'), 2);
});

it('lays out today first, the percentage against its base row only from MIN_BASE, and the 7 and 14 day sums of the known days', () => {
  const days = [
    day('2027-07-10', { new: 40, act_new: 10, start_accounts: 25, claim_accounts: 5, links: { card: { people: 7, auto: 3 }, wish: { people: 1, auto: 0 }, shot: { people: 0, auto: 4 } }, cheers: { paid: 30, free: 6 } }),
    day('2027-07-09', { new: 3, act_new: 1, start_accounts: 2, claim_accounts: 1 }),
    { day: '2027-07-08', new: 5, act_new: 2 }, // folded before links, cheers and the wizard counts existed
  ];
  const t = dayTable(days, '2027-07-10', 3), row = (label) => t.find((r) => r[0] === label);
  assert.equal(t.length, DAY_ROWS.length);
  assert.deepEqual(row('신규 계정'), ['신규 계정', '', '40', '3', '5', '48', '48']);
  assert.deepEqual(row('첫 행동 (소원·하트·응원·전광판)'), ['첫 행동 (소원·하트·응원·전광판)', '신규 계정', '10 (25%)', '1', '2', '13 (27%)', '13 (27%)']);
  assert.deepEqual(row('전광판 걸기 완료'), ['전광판 걸기 완료', '전광판 걸기 시작', '5 (20%)', '1', '—', '6 (22%)', '6 (22%)']);
  assert.deepEqual(row('전광판 카드 링크 열림 · 자동'), ['전광판 카드 링크 열림 · 자동', '', '3', '0', '—', '3', '3']);
  assert.deepEqual(row('응원 · 포인트 없이'), ['응원 · 포인트 없이', '', '6', '0', '—', '6', '6']);
  assert.equal(MIN_BASE, 20);
  // A day folded before the field existed is a dash; the sums count only known days.
  assert.deepEqual(dayTable([{ day: '2027-07-10' }], '2027-07-10', 1)[11].slice(2), ['—', '0', '0']); // that day unknown; the 13 days with no row had nothing
});

it('admin.html adds the rows to the funnel table with textContent only', () => {
  const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
  assert.match(html, /import \{ GROW_STEPS, growDays, growSum, stepPct, dayTable \} from '\.\/growth\.js\?v=\d+';/);
  const fn = html.slice(html.indexOf('function renderGrow'), html.indexOf("$('statsLoad').onclick"));
  assert.match(fn, /dayTable\(d\.days, d\.today, shown\.length\)/);
  assert.equal(/innerHTML|insertAdjacentHTML/.test(fn), false);
});
