import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as ftue from '../ftue.js';
import { ftueDue, playedEarlierDay, newcomer, graduation, GRAD_EARN, crowdFacts, PUBLIC_MIN, peopleTag, goalLine, startFtue, tutorialNext, firstStep, kstDay, newcomerKnown } from '../ftue.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const DAY = '2026-11-20';

describe('tutorial start', () => {
  it('runs for a first visit even though attend() already wrote a streak this session', () => {
    assert.equal(ftueDue('', null, DAY), true);
    assert.equal(ftueDue('', {}, DAY), true);
    // the snapshot taken before attend() has no streak; the live value would have streak 1
    assert.equal(ftueDue('', { day: DAY, last: DAY, streak: 1 }, DAY), true);
  });
  it('does not run for someone who played on an earlier day', () => {
    assert.equal(playedEarlierDay({ last: '2026-11-19', streak: 1 }, DAY), true);
    assert.equal(ftueDue('', { day: '2026-11-19', last: '2026-11-19', streak: 1 }, DAY), false);
    assert.equal(ftueDue('', { day: DAY, last: '2026-11-18', streak: 3 }, DAY), false);
  });
  it('does not run once done or after play today', () => {
    assert.equal(ftueDue('1', null, DAY), false);
    assert.equal(ftueDue('', { day: DAY, last: DAY, earn: 4 }, DAY), false);
    assert.equal(ftueDue('', { day: DAY, last: DAY, bake: 1 }, DAY), false);
  });
  it('main.js decides from a snapshot taken before this session attends', () => {
    const main = read('main.js');
    assert.match(main, /const DAILY_BEFORE = /);
    assert.match(main, /ftueDue\(recall\('kts_ftue'\), DAILY_BEFORE, kstDay\(\)\)/);
    assert.ok(main.indexOf('const DAILY_BEFORE') < main.indexOf('const ui = createUI('));
  });
});

describe('tutorial last step', () => {
  const run = (goal, taken) => {
    const calls = [];
    const api = startFtue({
      ui: { setNextLine: (t) => calls.push(['line', t]), nextGoal: () => goal },
      world: {
        setWaypoint: (p) => calls.push(['wp', p]),
        boardView: (id) => (taken.includes(id) ? { holder_id: 'x' } : {}),
        slotCard: () => ({ x: 3, z: 4 }),
      },
    });
    api.onBakePay();
    return calls;
  };
  it('guides to a free starter slot when one is open', () => {
    const calls = run({ free: true, slot: 'STREET_11', name: '무료 거리 칸', left: 0 }, ['STREET_8', 'STREET_9', 'STREET_10']);
    assert.deepEqual(calls.at(-2), ['wp', { x: 3, z: 4 }]);
    assert.deepEqual(calls.at(-1), ['line', '하늘색 기둥을 따라 무료 칸으로 가세요']);
  });
  it('names the cheapest slot and the points left when no starter slot is free', () => {
    const all = ['STREET_8', 'STREET_9', 'STREET_10', 'STREET_11'];
    const calls = run({ free: false, slot: 'PLOT_1', name: '분양 전광판', left: 140 }, all);
    assert.deepEqual(calls.at(-2), ['wp', null]);
    assert.equal(calls.at(-1)[1], '분양 전광판까지 140포인트 더 모으면 걸 수 있어요');
    assert.equal(calls.some(([, t]) => typeof t === 'string' && t.includes('무료')), false);
  });
  it('does not promise a free slot when the starter was already used', () => {
    const calls = run({ free: false, slot: 'PLOT_1', name: '분양 전광판', left: 0 }, []);
    assert.deepEqual(calls.at(-2), ['wp', null]);
    assert.equal(calls.at(-1)[1], '분양 전광판에 이름을 걸 수 있어요');
  });
  it('goalLine formats with thousands separators and falls back without a goal', () => {
    assert.equal(goalLine({ name: '메인거리', left: 1200 }), '메인거리까지 1,200포인트 더 모으면 걸 수 있어요');
    assert.equal(goalLine(null), '응원 포인트를 모아 전광판에 이름을 걸어 보세요');
  });
  it('ui exposes nextGoal with name and left', () => {
    const ui = read('ui.js');
    assert.match(ui, /nextGoal,/);
    assert.match(ui, /return \{ text: left \?[^\n]*name, left/);
  });
});

describe('newcomer mode', () => {
  it('is on with no board and no graduation flag', () => {
    assert.equal(newcomer({ grad: false, held: 0 }), true);
    assert.equal(newcomer({ grad: true, held: 0 }), false);
    assert.equal(newcomer({ grad: false, held: 1 }), false);
  });
  it('graduates on claim or on 30 play coins today (the tap goes through ui graduate())', () => {
    assert.equal(GRAD_EARN, 30);
    assert.equal(graduation({ grad: false, held: 0, earn: 29 }), '');
    assert.equal(graduation({ grad: false, held: 0, earn: 30 }), 'earn');
    assert.equal(graduation({ grad: false, held: 1, earn: 0 }), 'claim');
    assert.equal(graduation({ grad: true, held: 1, earn: 99 }), '');
  });
  it('never turns on before the plaza and the actor id are known', () => {
    assert.equal(newcomerKnown({ plazaReady: false, actor: 'a' }), false);
    assert.equal(newcomerKnown({ plazaReady: true, actor: '' }), false);
    assert.equal(newcomerKnown({ plazaReady: true, actor: 'a' }), false);
    assert.equal(newcomerKnown({ plazaReady: true, actor: 'guest:g-1' }), true);
    assert.equal(newcomerKnown({ plazaReady: true, actor: 'user:u-1' }), true);
    const ui = read('ui.js');
    assert.match(ui, /newcomerKnown\(\{ plazaReady, actor: hooks\.actorId\?\.\(\) \}\)/);
  });
  it('graduates silently only for earlier-day players or an old kts_ftue without kts_daily.last', () => {
    assert.match(read('ui.js'), /if \(!grad && silentGrad\(\{ ftue: recall\('kts_ftue', ''\), daily: recall\('kts_daily', null\), day: kstDay\(\) \}\)\)/);
  });
  it('hides the guest warning and keeps the tap target 40px with focus styling', () => {
    const html = read('index.html');
    assert.ok(html.includes('#ui.newbie .guestwarn'));
    assert.match(html, /\.newbie-more \{[^}]*min-height: 40px/);
    assert.match(html, /\.newbie-more:focus-visible/);
  });
  it('reveal animates opacity only and the phone column has no extra blur layers', () => {
    const html = read('index.html');
    const kf = html.slice(html.indexOf('@keyframes revealIn'), html.indexOf('}', html.indexOf('to {', html.indexOf('@keyframes revealIn'))));
    assert.equal(kf.includes('transform'), false);
    const tail = html.slice(html.indexOf('/* Newcomer focus mode'));
    assert.equal(tail.slice(0, tail.indexOf('@media (prefers-reduced-motion')).includes('backdrop-filter'), false);
    assert.match(tail, /max-width: min\(56vw, calc\(100vw - 188px\)\)/);
  });
  it('uses a class and the safe storage helpers, keeps the HUD built once', () => {
    const ui = read('ui.js');
    assert.match(ui, /store\('kts_grad', 1\)/);
    assert.match(ui, /recall\('kts_grad'/);
    assert.match(ui, /classList\.toggle\('newbie'/);
    assert.match(ui, /메뉴 모두 보기/);
    assert.match(ui, /지금 할 일/);
    const html = read('index.html');
    for (const sel of ['.liveboard', '.stay-quest', '.stay-balloon', '.channel-card']) {
      assert.ok(html.includes(`#ui.newbie ${sel}`), sel);
    }
    // the coin-2x gauge and the draw line are gone (no points for play, no lottery)
    for (const sel of ['.fever', '.stay-ticket']) assert.equal(html.includes(sel), false, sel);
  });
  it('holds back the entry star shower for newcomers', () => {
    const main = read('main.js');
    assert.match(main, /if \(!shower && !ui\.isNewbie\?\.\(\)\) startShower\(bucketKey\(\), true\)/);
  });
  it('keeps the waypoint pill clear of the left column and the tools on phones', () => {
    assert.match(read('index.html'), /html\.touch \.waypill \{ top: auto; bottom: calc\(142px \+ var\(--safe-b\)\)/);
  });
});

describe('tutorial lifecycle', () => {
  it('starts, and ends on skip, the first claim, graduation, or the end of the walk to the free slot', () => {
    assert.equal(tutorialNext(false, 'start'), true);
    assert.equal(tutorialNext(true, 'skip'), false);
    assert.equal(tutorialNext(true, 'bakePay'), true);
    assert.equal(tutorialNext(true, 'grad'), false);
    assert.equal(tutorialNext(true, 'walkDone'), false);
    assert.equal(tutorialNext(true, 'claim'), false);
    assert.equal(tutorialNext(true, 'other'), true);
    assert.equal(tutorialNext(false, 'other'), false);
  });
  it('main.js drives every edge and marks the starter used on a starter claim', () => {
    const main = read('main.js');
    assert.match(main, /ui\.tutorial\?\.\('start'\)/);
    assert.match(main, /ui\.tutorial\?\.\('skip'\)/);
    assert.match(main, /ui\.tutorial\?\.\('bakePay'\)/);
    assert.match(main, /ui\.tutorial\?\.\('claim'\)/);
    assert.match(main, /if \(mode === 'starter'\) state\.starterUsed = true;/);
  });
  it('graduation marks the starter toast as shown, and newcomers never get it', () => {
    const ui = read('ui.js');
    const sync = ui.slice(ui.indexOf('function syncNewbie'), ui.indexOf('function graduate()'));
    assert.match(sync, /if \(was && !on\) \{[^}]*starterToastShown = true/);
    const toast = ui.slice(ui.indexOf('function maybeStarterToast'), ui.indexOf('const plotById'));
    assert.match(toast, /if \(newbieOn\) return;/);
  });
});

describe('one instruction at a time', () => {
  it('firstStep returns the first step that has something to say', () => {
    const calls = [];
    const steps = [() => { calls.push('a'); return null; }, () => { calls.push('b'); return { text: 'B' }; }, () => { calls.push('c'); return { text: 'C' }; }];
    assert.deepEqual(firstStep(steps), { text: 'B' });
    assert.deepEqual(calls, ['a', 'b']);
    assert.equal(firstStep([]), null);
  });
  it('the card reads the tutorial line first, and the tutorial writes through its own hook', () => {
    const ui = read('ui.js');
    assert.match(ui, /const NEWCOMER_STEPS = \[/);
    assert.match(ui, /function newcomerTask\(\)/);
    assert.match(ui, /setTutorialLine/);
    assert.ok(read('index.html').includes('#ui.newbie .nextline'));
    assert.match(read('main.js'), /setNextLine: \(t\) => ui\.setTutorialLine\(t\)/);
  });
});

describe('clean-up', () => {
  it('ftueStillDue is gone and slots come from BALANCE', () => {
    assert.equal('ftueStillDue' in ftue, false);
    const src = read('ftue.js');
    assert.equal(src.includes("'STREET_8'"), false);
    assert.match(src, /BALANCE\.starterSlots/);
  });
  it('one KST day helper', () => {
    assert.equal(kstDay(Date.UTC(2026, 10, 19, 15, 0, 0)), '2026-11-20');
    assert.equal(kstDay(Date.UTC(2026, 10, 19, 14, 59, 0)), '2026-11-19');
    assert.equal(read('main.js').includes('9 * 36e5'), false);
    assert.equal(read('ui.js').includes("const kstDay ="), false);
  });
});

describe('public numbers', () => {
  it('drops counts that are too small to help', () => {
    assert.deepEqual(PUBLIC_MIN, { visitors: 20, crowd: 3, wishes: 5 });
    assert.deepEqual(crowdFacts({ visitors: 1, crowd: 1, wishes: 0 }), { visitors: 0, crowd: 0, wishes: 0 });
    assert.deepEqual(crowdFacts({ visitors: 20, crowd: 3, wishes: 5 }), { visitors: 20, crowd: 3, wishes: 5 });
    assert.deepEqual(crowdFacts({ visitors: '19', crowd: 2.9, wishes: 'x' }), { visitors: 0, crowd: 0, wishes: 0 });
    assert.deepEqual(crowdFacts(null), { visitors: 0, crowd: 0, wishes: 0 });
  });
  it('hides the people count when it is just me', () => {
    assert.equal(peopleTag(1), '');
    assert.equal(peopleTag(0), '');
    assert.equal(peopleTag(2), '2명');
  });
  it('boot card and mission sheet go through the helper', () => {
    assert.match(read('main.js'), /crowdFacts\(/);
    assert.match(read('ui.js'), /crowdFacts\(/);
  });
});

describe('copy', () => {
  // There is no lottery any more (WISH BOARD is not a game): no draw, no tickets, no words of chance.
  it('has no draw: never 추첨, 복권, 잭팟, 당첨, 🎰, 로또 in the plaza screens', () => {
    for (const f of ['ui.js', 'main.js', 'index.html', 'ftue.js', 'net.js']) {
      const src = read(f);
      for (const w of ['추첨', '복권', '잭팟', '당첨', '🎰', '로또']) assert.equal(src.includes(w), false, `${f}: ${w}`);
    }
    assert.doesNotMatch(read('ui.js'), /showDraw|paintTickets|noteLot|stay-ticket/);
    assert.doesNotMatch(read('main.js'), /DRAW_CHECK|net\.on\('draw'|net\.on\('lot'/);
  });
});

describe('small defects', () => {
  it('registers the prompt refresh once', () => {
    const ui = read('ui.js');
    assert.equal(ui.split("near.kind === 'cart')) renderPrompt(); }, 400)").length - 1, 1);
  });
  it('claim wizard shows prices, a selected state, and a live preview', () => {
    const ui = read('ui.js');
    const step = ui.slice(ui.indexOf('function openClaimStep'), ui.indexOf('function pumpLink'));
    assert.match(step, /aria-pressed/);
    assert.match(step, /'무료'/);
    assert.match(step, /paintBillboard\(/);
    assert.match(step, /올해는 꼭 합격/);
    assert.match(step, /\/16/);
  });
});
