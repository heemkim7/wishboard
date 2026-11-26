// 응원 순위 › 새로 걸린: boards lit now by a person, most recently lit first (plaza-account.js freshBoards), and the tab in ui.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { freshBoards } from '../plaza-account.js';

const NOW = Date.parse('2027-08-01T03:00:00Z'), H = 3600e3;
const b = (slot, holder, litIn, upd = 0, extra = {}) => ({ slot_id: slot, holder_id: holder, lit_until: litIn == null ? null : new Date(NOW + litIn).toISOString(), expires_at: null, updated_at: new Date(NOW + upd).toISOString(), ...extra });

it('orders lit boards of people by the latest light-up, breaks ties by updated_at then slot, and leaves out vacant, dark, expired and team boards', () => {
  const rows = [
    b('PLOT_1', 'guest:a', 70 * H),           // lit 2 hours ago
    b('PLOT_2', 'user:b', 72 * H - 60e3),     // lit a minute ago: first
    b('PLOT_3', null, 71 * H),                // vacant
    b('PLOT_4', 'guest:c', -H),               // expired an hour ago
    b('PLOT_5', 'guest:d', null),             // no time at all: dark
    b('MAIN_TOP', 'tribe:abcd1234', 72 * H),  // a team's board, not a person's
    b('PLOT_7', 'guest:e', 50 * H, -5 * H),   // tie on lit_until with PLOT_8, updated earlier
    b('PLOT_8', 'guest:f', 50 * H, -H),
    b('PLOT_10', 'guest:g', 40 * H, -H),      // full tie with PLOT_9: by slot id
    b('PLOT_9', 'guest:h', 40 * H, -H),
    { slot_id: 'SUB_1', holder_id: 'guest:i', lit_until: null, expires_at: new Date(NOW + 10 * H).toISOString() }, // an old row: expires_at stands in
  ];
  assert.deepEqual(freshBoards(rows, NOW).map((x) => x.slot_id), ['PLOT_2', 'PLOT_1', 'PLOT_8', 'PLOT_7', 'PLOT_10', 'PLOT_9', 'SUB_1']);
  assert.equal(freshBoards(rows, NOW, 3).length, 3);
  const many = Array.from({ length: 14 }, (_, i) => b('STREET_' + (i + 1), 'guest:' + i, (i + 1) * H));
  assert.deepEqual(freshBoards(many, NOW).map((x) => x.slot_id), Array.from({ length: 10 }, (_, i) => 'STREET_' + (14 - i)));
  assert.deepEqual(freshBoards(null, NOW), []);
  assert.deepEqual(freshBoards([null, {}], NOW), []);
  assert.equal(rows[0].slot_id, 'PLOT_1', 'the world rows are not reordered');
});

it('adds the tab right after 전광판 with the same row, its note and empty line, and keeps aria-pressed on every tab', () => {
  const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
  const sheet = ui.slice(ui.indexOf('function openRanks('), ui.indexOf('function openCredits('));
  assert.match(sheet, /tabBtn\('hot', '전광판'\), tabBtn\('new', '새로 걸린'\), tabBtn\('team', '태그'\)/);
  assert.match(sheet, /\['today', 'rate', 'week', 'hot', 'new', 'team'\]\.includes\(start\)/);
  assert.match(sheet, /rows = fresh \? freshBoards\(world\.billboards, Date\.now\(\), 10\) : hotBoards\(\)\.slice\(0, 10\)/);
  assert.match(sheet, /'가장 최근에 켜진 전광판부터 보여요\.'/);
  assert.match(sheet, /'아직 켜진 전광판이 없어요\.'/);
  assert.match(sheet, /text: '열기', onclick: \(\) => openAd\(b\.slot_id\)[\s\S]*text: '보러가기', onclick: \(\) => go\(b\.slot_id\)[\s\S]*linkBtn\(b\)/);
  // One tab handler for all: the pressed one gets on + aria-pressed true, every other one false.
  assert.match(sheet, /'aria-pressed': String\(id === tab\)/);
  assert.match(sheet, /c\.setAttribute\('aria-pressed', String\(c === e\.currentTarget\)\)/);
  assert.match(sheet, /if \(tab === 'hot' \|\| tab === 'new' \|\| tab === 'team'\) paint\(\);/);
});
