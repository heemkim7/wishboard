// 메인 타워 축하 1분 on the plaza (ts3d/screens.js setTower): in its minute the five main tower faces show the gift board, over a 1,000
// team's hour, never over the anniversary minute or the 9 pm hour; wish cards and the king stay off; the strip says what it is; main.js keeps
// the list from /rt/world and the rooms' TOWER pushes and says the news once; ?gb=<id> goes to the tower in that minute.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { planDay, kstDay, dayStart } from '../primerules.js';
import { TOWER, towerWire, towerKey, towerClock } from '../towerrules.js';

register(new URL('./nine-three-hook.mjs', import.meta.url));
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// fakeDom and boardsFor as in test/prime-client.test.mjs.
function fakeDom() {
  const log = { paints: 0 };
  const ctx = () => {
    const words = [];
    return new Proxy({ words }, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'measureText') return (s) => ({ width: String(s).length * 10 });
        if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
        if (k === 'clearRect') return () => { words.length = 0; log.paints++; };
        if (k === 'fillText') return (s) => { words.push(String(s)); };
        if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
        return () => {};
      },
      set(t, k, v) { t[k] = v; return true; },
    });
  };
  globalThis.document = { createElement: () => { let g = null; return { width: 0, height: 0, getContext() { return g || (g = ctx()); } }; } };
  return log;
}
async function boardsFor() {
  const log = fakeDom();
  const { createBoards } = await import('../ts3d/screens.js');
  const THREE = await import('three');
  const boards = createBoards({ renderer: { capabilities: { getMaxAnisotropy: () => 4 } }, kitMats: {}, pick: [], quality: 'high' });
  const parent = new THREE.Group();
  const ids = ['MAIN_UP', 'MAIN_TOP', 'MAIN_MID', 'MAIN_BOT', 'MAIN_LOW', 'SUB_1A', 'SUB_2A', 'SUB_3A', 'SUB_4A', 'SUB_1B', 'SUB_2B', 'SUB_3B', 'SUB_4B', 'STREET_1', 'STREET_2', 'PLOT_1'];
  ids.forEach((id, i) => boards.mount(id, parent, { x: i * 10, y: 5, z: 0, w: 16, h: 9 }));
  return { boards, log, ids, cam: new THREE.Vector3(0, 5, 20), words: (id) => boards.get(id).canvas.getContext('2d').words.join(' ') };
}

const MAIN = ['MAIN_UP', 'MAIN_TOP', 'MAIN_MID', 'MAIN_BOT', 'MAIN_LOW'];
const at = (hm) => dayStart(kstDay(Date.now())) + (Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3))) * 60e3;
const entry = (m, o = {}) => ({ id: 'abcd1234', m, to: '민지', from: '지수', occ: 'bday', msg: '생일 축하해!', th: 'party', ...o });
async function withClock(t, run) { const wall = Date.now; Date.now = () => t; try { await run(); } finally { Date.now = wall; } }

describe('the main tower minute on the plaza', () => {
  it('in its minute all five faces show the board, over a 1,000 team\'s hour; before and after, the team', () => withClock(at('14:30') + 5000, async () => {
    const { boards, words, cam } = await boardsFor();
    const day = kstDay(Date.now()), m = at('14:30'), plan = planDay({ day, teams: [] });
    boards.setPrime({ ...plan, tower: [{ id: 't0000001', a: 14 * 36e5, b: 15 * 36e5 }], names: { t0000001: '팀하나' }, n: { t0000001: 1200 } });
    assert.equal(boards.setTower([entry(m)]), true); assert.equal(boards.setTower([entry(m)]), false, 'the same list is no work');
    for (const id of MAIN) assert.match(words(id), /To\. 민지/, id);
    Date.now = () => m + 61000; for (let i = 0; i < 20; i++) boards.update(0.1, cam);
    for (const id of MAIN) assert.match(words(id), /팀하나/, id);
  }));
  it('a booking for a later minute leaves the team up until that minute starts', () => withClock(at('14:28'), async () => {
    const { boards, words, cam } = await boardsFor();
    const day = kstDay(Date.now()), m = at('14:30'), plan = planDay({ day, teams: [] });
    boards.setPrime({ ...plan, tower: [{ id: 't0000001', a: 14 * 36e5, b: 15 * 36e5 }], names: { t0000001: '팀하나' }, n: { t0000001: 1200 } });
    boards.setTower([entry(m)]);
    assert.match(words('MAIN_MID'), /팀하나/); assert.equal(boards.towerSlot('abcd1234'), '', 'not on the tower yet');
    Date.now = () => m + 1000; for (let i = 0; i < 20; i++) boards.update(0.1, cam);
    for (const id of MAIN) assert.match(words(id), /To\. 민지/, id);
  }));
  it('never over the anniversary minute or the 9 pm hour, even if such an entry came', () => withClock(at('21:10') + 1000, async () => {
    const { boards, words } = await boardsFor();
    const plan = planDay({ day: kstDay(Date.now()), teams: [] });
    boards.setPrime({ ...plan, gold: { id: 't0000009', n: 50 }, names: { t0000009: '구시팀' } });
    boards.setTower([entry(at('21:10'))]);
    assert.match(words('MAIN_TOP'), /구시팀/);
    assert.doesNotMatch(words('MAIN_TOP'), /To\. 민지/);
  }));
  it('never over the anniversary team\'s minute on the hour', () => withClock(at('20:00') + 1000, async () => {
    const { boards, words } = await boardsFor();
    const plan = planDay({ day: kstDay(Date.now()), teams: [] });
    const annH = plan.annH.map(() => ''); annH[20] = 't0000007';
    boards.setPrime({ ...plan, annH, names: { t0000007: '기념팀' }, n: { t0000007: 30 } });
    boards.setTower([entry(at('20:00'))]);
    assert.match(words('MAIN_TOP'), /기념팀/);
    assert.equal(boards.towerSlot('abcd1234'), '');
  }));
  it('wish cards and the 9 pm king stay off the tower in that minute; the strip says 메인 타워 축하 1분', () => withClock(at('14:30') + 1000, async () => {
    const { boards, cam } = await boardsFor();
    boards.setTower([entry(at('14:30'))]);
    boards.setWishes([{ id: 'aaaaaaaaaa', nick: 'a', txt: '첫 소원', hearts: 1 }]); boards.setKing({ nick: '왕', txt: '어제', hearts: 9 });
    for (let i = 0; i < 100; i++) boards.update(0.1, cam);
    for (const id of MAIN) { assert.equal(boards.get(id).wish, null, id); assert.equal(!!boards.get(id).kingOn, false, id); }
    assert.equal(boards.towerSlot('abcd1234'), 'MAIN_MID'); assert.equal(boards.towerSlot('zzzz9999'), '');
    // The strip (drawLive): its tag and its line. The fake canvas keeps every word ever drawn, so read the strip's own line only.
    const drawn = boards.get('MAIN_MID').canvas.getContext('2d').words, strip = drawn.filter((w) => w.startsWith('메인 타워 축하 1분'));
    assert.ok(strip.length > 0, 'the strip says what it is');
    assert.match(strip[0], /^메인 타워 축하 1분 {3}· {3}To\. 민지 {3}· {3}생일/);
    assert.ok(drawn.includes('선물'), 'the gift tag');
    for (const s of strip) assert.doesNotMatch(s, /2,000|친구 응원|포인트/, 'nothing about how it was won, nor the house line about points');
    assert.match(strip[0], /WISH BOARD {2}· {2}모두의 전광판 {2}· {2}$/, 'a fixed tail');
  }));
  it('a tap in that minute is the gift\'s, not the team\'s: primeOf is null, towerOf names the board; after it, the team again', () => withClock(at('14:30') + 1000, async () => {
    const { boards, cam } = await boardsFor();
    const day = kstDay(Date.now()), m = at('14:30'), plan = planDay({ day, teams: [] });
    boards.setPrime({ ...plan, tower: [{ id: 't0000001', a: 14 * 36e5, b: 15 * 36e5 }], names: { t0000001: '팀하나' }, n: { t0000001: 1200 } });
    boards.setTower([entry(m)]);
    for (const id of MAIN) { assert.equal(boards.primeOf(id), null, id); assert.equal(boards.towerOf(id), 'abcd1234', id); }
    assert.equal(boards.towerOf('SUB_1A'), ''); assert.equal(boards.towerOf('STREET_1'), '');
    Date.now = () => m + 61000; for (let i = 0; i < 20; i++) boards.update(0.1, cam);
    assert.equal(boards.primeOf('MAIN_TOP').id, 't0000001'); assert.equal(boards.towerOf('MAIN_TOP'), '');
  }));
  it('a release (an empty list) gives the faces back at once', () => withClock(at('14:30') + 1000, async () => {
    const { boards, words } = await boardsFor();
    boards.setTower([entry(at('14:30'))]);
    assert.match(words('MAIN_TOP'), /To\. 민지/);
    assert.equal(boards.setTower([]), true);
    assert.doesNotMatch(words('MAIN_TOP'), /To\. 민지/);
    assert.equal(boards.towerSlot('abcd1234'), '');
  }));
});

// main.js's tower list (the block between its comment and applyPlaza), run on its own: /rt/world copies can be older than the pushes.
describe('main.js keeps the tower list honest', () => {
  const M = read('main.js');
  const load = (now) => {
    const from = M.indexOf('// 메인 타워 축하 1분 (towerrules.js): /rt/world'), to = M.indexOf('function applyPlaza(');
    assert.ok(from > 0 && to > from, 'the block');
    const state = { tower: [] }, clock = { t: now }, world = { setTower: () => true };
    const f = new Function('state', 'world', 'TOWER', 'towerWire', 'towerKey', 'nowMs', M.slice(from, to) + '\nreturn { applyTower, towerPush };');
    return { ...f(state, world, TOWER, towerWire, towerKey, () => clock.t), state, clock };
  };
  const keys = (L) => L.state.tower.map((e) => e.id + '@' + towerClock(e.m));
  const m1 = at('14:30'), m2 = at('15:10');
  it('a released booking stays released when an older world copy still lists it', () => {
    const L = load(m1 - 600000);
    L.applyTower([entry(m1)]); assert.deepEqual(keys(L), ['abcd1234@14:30']);
    L.towerPush({ id: 'abcd1234', m: m1, off: 1 }); assert.deepEqual(keys(L), []);
    L.applyTower([entry(m1)]); assert.deepEqual(keys(L), [], 'the stale copy does not bring it back');
    L.towerPush(entry(m1)); assert.deepEqual(keys(L), ['abcd1234@14:30'], 'booked again: shown again');
  });
  it('a pushed booking the world copy lacks is kept until its minute is over', () => {
    const L = load(m2 - 600000);
    L.towerPush(entry(m2, { id: 'bbbb2222' })); L.applyTower([]);
    assert.deepEqual(keys(L), ['bbbb2222@15:10']);
    L.clock.t = m2 + 30000; L.applyTower([]); assert.deepEqual(keys(L), ['bbbb2222@15:10'], 'in its minute');
    L.clock.t = m2 + 60000; L.applyTower([]); assert.deepEqual(keys(L), []);
  });
  it('a release takes only that exact booking (a late one never takes another board\'s minute or the board\'s new minute)', () => {
    const L = load(m1 - 600000);
    L.applyTower([entry(m1, { id: 'aaaa1111' }), entry(m2)]);
    L.towerPush({ id: 'cccc3333', m: m1, off: 1 }); L.towerPush({ id: 'abcd1234', m: m1, off: 1 });
    assert.deepEqual(keys(L), ['aaaa1111@14:30', 'abcd1234@15:10']);
  });
  it('bad pushes do nothing; the list is sorted and capped', () => {
    const L = load(m1 - 600000);
    L.towerPush({ id: 'x', m: m1 }); L.towerPush(null); assert.deepEqual(keys(L), []);
    L.applyTower([entry(m2), entry(m1, { id: 'aaaa1111' }), { id: 'dddd4444', m: m1 + 60000, off: 1 }]);
    assert.deepEqual(keys(L), ['aaaa1111@14:30', 'abcd1234@15:10']);
    L.applyTower(Array.from({ length: 80 }, (_, i) => entry(m1 + i * 60000, { id: 'e' + String(i).padStart(7, '0') })));
    assert.equal(L.state.tower.length, TOWER.worldMax);
  });
});

describe('the glue', () => {
  const M = read('main.js'), U = read('ui.js'), GJ = read('gift.js'), T = read('timesSquare3d.js');
  it('main.js keeps the tower from /rt/world and the rooms\' pushes, and says the news once per booking', () => {
    assert.match(M, /world\?\.setTower\?\.\(state\.tower\)/);
    assert.match(M, /applyTower\(remote\.tower\)/);
    assert.match(M, /ev\?\.kind === 'TOWER'/);
    assert.match(M, /towerSeen\.has\(towerKey\(e\)\)/);
    assert.match(M, /ui\.news\('TOWER', e\)/);
    assert.match(M, /import \{ TOWER, towerAt, towerKey, towerWire \} from '\.\/towerrules\.js';/);
  });
  it('ui.js: the TOWER news line, tapping it goes to the tower', () => {
    assert.match(U, /else if \(kind === 'TOWER'\) pushNews\('MAIN TOWER', \[towerNews\(data\)\], true, 'MAIN_MID', Number\(data\?\.m\) \+ TOWER\.minMs\);/);
    assert.match(U, /import \{ TOWER, towerNews \} from '\.\/towerrules\.js';/);
  });
  it('ui.js: a news line past its end (the tower minute is over) is dropped, never run late', () => {
    const at0 = U.indexOf('  function pumpNews() {'), pump = U.slice(at0, U.indexOf('    newsBusy = true;', at0));
    assert.match(pump, /while \(newsQueue\.length && newsQueue\[0\]\.until && nowMs\(\) >= newsQueue\[0\]\.until\) newsQueue\.shift\(\);/);
    assert.match(U, /function pushNews\(kicker, text, sound = true, slot = '', until = 0\) \{\r?\n    newsQueue\.push\(\{ kicker, text, sound, slot: String\(slot \|\| ''\), until: Number\(until\) \|\| 0 \}\);/);
  });
  it('ui.js: a tap on a main tower face in that minute opens the gift board\'s page, not the team sheet (near and far)', () => {
    const at0 = U.indexOf('  function openAd(slotId) {'), ad = U.slice(at0, U.indexOf('    const b = boardById(slotId);', at0));
    assert.match(ad, /const tw = isPrimeSlot\(slotId\) \? hooks\.towerOf\?\.\(slotId\) : ''; if \(tw\) \{ hooks\.openGiftPage\?\.\(tw\); return; \}/);
    assert.ok(ad.indexOf('hooks.towerOf') < ad.indexOf('teamUi().openPrime'), 'before the team sheet');
    const far = U.slice(U.indexOf('  function showFarCard('), U.indexOf('  function showAdCard('));
    assert.match(far, /act\('선물 보기', \(\) => hooks\.openGiftPage\?\.\(tw\), 'go'\)/);
    assert.match(M, /towerOf: \(slot\) => world\?\.towerOf\?\.\(slot\) \|\| '',/);
    assert.match(M, /openGiftPage: \(id\) => giftUi\?\.open\?\.\('\/g\/' \+ id\),/);
    assert.match(T, /towerOf\(id\) \{ return boards\.towerOf\?\.\(id\) \|\| ''; \}/);
  });
  it('main.js hands gift.js the push merge for ?gb= right after boot', () => { assert.match(M, /towerAdd: \(e\) => towerPush\(e\)/); });
  it('gift.js: ?gb=<id> in its minute goes to the tower, not a street screen', () => { assert.match(GJ, /world\?\.towerSlot\?\.\(id\)/); });
  it('timesSquare3d.js passes setTower and towerSlot through', () => { assert.match(T, /setTower\(list\) \{ return boards\.setTower\?\.\(list\); \}/); assert.match(T, /towerSlot\(id\) \{ return boards\.towerSlot\?\.\(id\) \|\| ''; \}/); });
  it('ts3d/screens.js imports towerrules.js with no query (the Worker bundles it)', () => { assert.match(read('ts3d/screens.js'), /import \{ TOWER, towerAt, towerKey, towerWire \} from '\.\.\/towerrules\.js';/); });
});
