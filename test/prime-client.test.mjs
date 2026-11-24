// 명당 in the browser: the prime screens paint the team the day's plan gives them (ts3d/screens.js setPrime, art.js paintPrime), a board lit
// before the change and wish cards give way, the turns change by the wall clock; the board sheet has no bid, no takeover and no prime screen;
// the team sheets (teamui.js) count people and say why a support did not count; the module addresses follow tools/stamp.mjs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { planDay, kstDay, dayStart } from '../primerules.js';

register(new URL('./nine-three-hook.mjs', import.meta.url));
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

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
const T = (id) => 't' + String(id).padStart(7, '0');

describe('prime screens on the plaza', () => {
  it('paint the planned team; a screen with no team keeps the house notice of how it is earned, never a price', async () => {
    const { boards, words } = await boardsFor();
    const day = kstDay(Date.now());
    assert.match(words('SUB_2A'), /응원 팀 명당/); assert.match(words('SUB_2A'), /100명/);
    assert.doesNotMatch(words('MAIN_TOP'), /포인트부터|점령|9시에 10분/); assert.match(words('MAIN_TOP'), /포인트로 살 수 없어요/);
    const plan = planDay({ day, teams: [{ id: T(1), name: '은하수 응원단', n: 160 }, { id: T(2), name: '초록별', n: 40 }] });
    assert.equal(boards.setPrime(plan), true);
    assert.equal(boards.setPrime(JSON.parse(JSON.stringify(plan))), false, 'the same plan again is no work');
    assert.match(words('SUB_1A'), /은하수 응원단/); assert.match(words('SUB_1A'), /100명 달성/);
    assert.match(words('SUB_1B'), /초록별/); assert.match(words('SUB_1B'), /30명 달성/);
    assert.doesNotMatch(words('SUB_2A'), /은하수/, 'one team, one screen');
    assert.equal(boards.primeOf('SUB_1A').id, T(1));
    assert.equal(boards.primeOf('STREET_1'), null);
    // A plan of another day shows nothing (the screens wait for the new day's plan).
    boards.setPrime({ ...plan, day: '2020-01-01' });
    assert.doesNotMatch(words('SUB_1A'), /은하수/);
  });
  it('wins over a board lit there before the change and over a wish card; the 9 pm king never covers a prime screen', async () => {
    const { boards, words, cam } = await boardsFor();
    const day = kstDay(Date.now());
    boards.set('SUB_1A', { holder_id: 'guest:old', holder_name: '예전 주인', line1: '예전 광고', line2: '', line3: '', lit_until: new Date(Date.now() + 36e5).toISOString() });
    assert.match(words('SUB_1A'), /예전 광고/);
    boards.setPrime(planDay({ day, teams: [{ id: T(1), name: '팀하나', n: 120 }] }));
    assert.match(words('SUB_1A'), /팀하나/);
    boards.setWishes([{ id: 'aaaaaaaaaa', nick: 'a', txt: '첫 소원', hearts: 1 }]);
    for (let i = 0; i < 200; i++) boards.update(0.1, cam);
    assert.equal(boards.get('SUB_1A').wish, null);
    boards.setKing({ nick: '왕', txt: '어제의 소원', hearts: 9 });
    for (let i = 0; i < 100; i++) boards.update(0.1, cam);
    for (const id of ['MAIN_TOP', 'SUB_1A', 'SUB_3B']) assert.equal(!!boards.get(id).kingOn, false, id);
    assert.equal(!!boards.get('STREET_1').kingOn, true);
  });
  it('turns a shared screen by the wall clock, the main tower in its hour, and never shows a takeover shield', async () => {
    const { boards, words, cam } = await boardsFor();
    const day = kstDay(Date.now()), now = Date.now();
    const teams = [1, 2, 3, 4, 5].map((i) => ({ id: T(i), name: '팀' + i, n: 40 - i }));
    const plan = planDay({ day, teams });
    const m = now - dayStart(day);
    boards.setPrime({ ...plan, tower: [{ id: T(1), a: m - 60000, b: m + 3600000 }], annH: plan.annH.map(() => ''), names: { ...plan.names, [T(1)]: '팀1' }, n: { ...plan.n, [T(1)]: 1200 } });
    for (const id of ['MAIN_UP', 'MAIN_TOP', 'MAIN_MID', 'MAIN_BOT', 'MAIN_LOW']) assert.match(words(id), /팀1/, id);
    assert.match(words('MAIN_LOW'), /함께 응원해요/);
    const first = boards.primeOf('SUB_1B').id;
    const realNow = Date.now; Date.now = () => now + 60000;
    try { for (let i = 0; i < 20; i++) boards.update(0.1, cam); assert.notEqual(boards.primeOf('SUB_1B').id, first); } finally { Date.now = realNow; }
    boards.set('STREET_2', { holder_id: 'guest:x', holder_name: 'x', line1: '내 가게', protected_until: new Date(now - 1000).toISOString(), lit_until: new Date(now + 36e5).toISOString() });
    for (let i = 0; i < 20; i++) boards.update(0.1, cam);
    assert.doesNotMatch(words('STREET_2'), /빼기|방어막/);
  });
});

describe('the board sheet and the team sheets', () => {
  const ui = read('ui.js'), team = read('teamui.js');
  it('has no bid, no takeover and no prime screen; a lit board of someone else says when it frees up', () => {
    const bill = ui.slice(ui.indexOf('  function openBillboard('), ui.indexOf('  function openAdReport('));
    assert.match(bill, /if \(isPrimeSlot\(slotId\)\) \{ teamUi\(\)\.openPrime\(slotId\); return; \}/);
    assert.doesNotMatch(bill, /입찰|점령|빼앗|탈환|steps|tribeGo|minBid|protectedLeft|연속 점령/);
    assert.match(bill, /`\$\{money\(price\)\} 포인트로 72시간 걸기`/);
    assert.match(bill, /뒤에 비어요/);
    const ad = ui.slice(ui.indexOf('  function openAd('), ui.indexOf('  const photoTold'));
    assert.doesNotMatch(ad, /빼앗|입찰/); assert.match(ad, /빈 전광판 찾기/);
  });
  it('the team sheet counts people, says why a support did not count, and shares /t/<id>', () => {
    assert.match(team, /'오늘 우리 팀 응원하기'/);
    assert.match(team, /hooks\.teamOp\?\.\(\{ op: 'cheer' \}\)/);
    assert.match(team, /location\.origin \+ '\/t\/' \+ id/);
    assert.match(team, /손님 응원이라 기록만 하고 세지 않았어요/);
    assert.doesNotMatch(team, /입찰|점령|빼앗|포인트를 (쓰면|더 쓰면)/);
    assert.match(team, /명당은 포인트나 돈으로 살 수 없어요/);
  });
  it('the team sheets never hand replaceChildren a null (the DOM writes it out as the text "null")', () => {
    for (let i = team.indexOf('replaceChildren('); i >= 0; i = team.indexOf('replaceChildren(', i + 1)) {
      let depth = 0, j = i + 'replaceChildren'.length;
      for (; j < team.length; j++) { const c = team[j]; if (c === '(') depth++; else if (c === ')' && --depth === 0) break; }
      const args = team.slice(i, j + 1);
      if (/:\s*null\b/.test(args)) assert.match(args, /\.filter\(Boolean\)/, 'a null branch reaches replaceChildren: ' + args.slice(0, 80));
    }
  });
  it('the 🏆 sheet is 응원 순위 (people, participation, goals) and the HUD board shows today\'s teams', () => {
    const r = ui.slice(ui.indexOf('  function openRanks('), ui.indexOf('  function openCredits() {'));
    // short tab names, so all five fit a phone's width (인기 전광판 was cut and 해시태그 out of sight at 375px)
    assert.match(r, /tabBtn\('today', '오늘'\), tabBtn\('rate', '참여율'\), tabBtn\('week', '이번 주'\), tabBtn\('hot', '전광판'\), tabBtn\('team', '태그'\)/);
    // the chosen tab is told to a screen reader too, not by colour alone
    assert.match(r, /'aria-pressed': String\(id === tab\)/);
    assert.doesNotMatch(r, /누적|쓴 응원 포인트|spent/);
    assert.match(ui, /withIcon\('trophy', '오늘의 응원 팀'\)/);
  });
  it('module addresses: teamui.js is browser-only (?v=), primerules.js is bundled by the Worker (no query)', () => {
    assert.match(ui, /import \{ createTeamUI \} from '\.\/teamui\.js\?v=\d+';/);
    assert.match(team, /from '\.\/primerules\.js';/);
    assert.match(read('ts3d/screens.js'), /from '\.\.\/primerules\.js';/);
    assert.match(read('worker.js'), /from '\.\/teamsrv\.js';/);
    assert.match(read('.assetsignore'), /^teamsrv\.js$/m);
    assert.match(read('admin.html'), /<script type="module" src="\.\/admin-team\.js\?v=\d+"><\/script>/);
  });
});
