import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as ftue from '../ftue.js';
import { ftueDue, playedEarlierDay, newcomer, graduation, GRAD_EARN, crowdFacts, PUBLIC_MIN, peopleTag, tutorialNext, firstStep, kstDay, newcomerKnown } from '../ftue.js';
import { goalKnown, GOAL_WAIT_MS } from '../overlay.js';

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
    // The tutorial is the welcome board now (ftue.js welcomeDue = ftueDue and no deep link): one decision, in arrive().
    assert.match(main, /welcomeNow = welcomeDue\(\{ flag: recall\('kts_ftue'\), before: DAILY_BEFORE, day: kstDay\(\), deep: DEEP_LINK \}\);/);
    assert.equal(main.split('welcomeDue(').length - 1, 1, 'decided once');
    assert.ok(main.indexOf('const DAILY_BEFORE') < main.indexOf('const ui = createUI('));
  });
});

describe('the card\'s last step', () => {
  // The bake tutorial's last step (a walk to the free slot, ftue.js goalLine) is gone; the card ends on ui.js nextGoal as before.
  it('ui.js nextGoal names the free street slot first, else the cheapest slot and the points left', () => {
    const ui = read('ui.js');
    assert.match(ui, /if \(firstOpenStarter\(\)\) \{ slot = firstOpenStarter\(\); price = 0; name = '무료 거리 칸'; \}/);
    assert.match(ui, /return \{ text: left \?[^\n]*name, left/);
    // the card's last step is that goal, and no step at all while the goal is still undecided (an empty text)
    assert.match(ui, /\(\) => \{ const text = nextGoal\(\)\.text\.replace\(\/\^다음 목표: \/, ''\); return text \? \{ text, go: nextGoalGo \} : null; \},/);
  });
  // The same guest used to see 무료 거리 칸 on one load and 건물 앞 전광판 on the next: the goal was decided before the boards, the
  // account's "free slot used" flag and the settled free-slot list were all in (a cold Worker isolate answers /rt/config with the old four).
  it('the goal is decided only once the boards, the starter flag and the settled starter list are known, or after 8 s', () => {
    assert.equal(GOAL_WAIT_MS, 8000);
    assert.equal(goalKnown({ boards: false, used: false, list: true, waited: 99999 }), false); // never before the boards
    assert.equal(goalKnown({ boards: true, used: null, list: true, waited: 0 }), false); // the profile has not answered
    assert.equal(goalKnown({ boards: true, used: false, list: false, waited: 0 }), false); // the list may still change
    assert.equal(goalKnown({ boards: true, used: false, list: true, waited: 0 }), true);
    assert.equal(goalKnown({ boards: true, used: true, list: true }), true);
    assert.equal(goalKnown({ boards: true, used: null, list: false, waited: GOAL_WAIT_MS - 1 }), false);
    assert.equal(goalKnown({ boards: true, used: null, list: false, waited: GOAL_WAIT_MS }), true); // a profile that never comes
    assert.equal(goalKnown(), false);
    const ui = read('ui.js'), main = read('main.js');
    assert.match(ui, /const goalReady = \(\) => goalKnown\(\{ boards: plazaReady, used: hooks\.starterUsed\?\.\(\), list: hooks\.starterListKnown\?\.\(\) !== false, waited: plazaAt \? performance\.now\(\) - plazaAt : 0 \}\);/);
    assert.match(ui, /if \(!goalReady\(\)\) return \{ text: '', undecided: true,/);
    assert.match(ui, /if \(g\.undecided\) return;/);
    // no line on screen while there is nothing to say, and no free-slot offer from a list that may change
    assert.match(ui, /const none = newbieOn \? !newcomerTask\(\)\?\.text : !goalText;\s+if \(nextLine\.hidden !== none\) nextLine\.hidden = none;/);
    assert.match(ui, /if \(!goalReady\(\)\) return; \/\/ the same wait as the goal line/);
    // main.js: an answer that is exactly the old four is asked again (below), and the offer waits for the list to settle
    assert.match(main, /starterListKnown: \(\) => starterListKnown,/);
    assert.match(main, /starterListSettled: \(\) => starterListSettled,/);
    assert.match(ui, /if \(hooks\.starterListSettled\?\.\(\) === false\) return;/);
  });
  // The re-reads in main.js, run as they are written there, against a /rt/config that answers from a list of answers. A cold
  // Worker isolate answered the old four for longer than the one read 2.5 s later, and the guest kept the wrong goal all session.
  it('main.js reads /rt/config again while it answers the old four: at 2.5, 6 and 20 s at most, stopping at the first real list', async () => {
    const main = read('main.js');
    const from = main.indexOf('net.kakaoKey().catch(() => {}).then(async () => {'), to = main.indexOf('\n});', from) + 4;
    assert.ok(from > 0 && to > from);
    const consts = main.match(/^const STARTER_REREAD_MS = [^\n]+/m)?.[0] || '';
    // the real balance.js: 'real' is the database's list, 'old' the old four marked starter_fallback (a cold isolate),
    // 'oldw' the old four unmarked (a Worker from before the flag)
    const B = await import('../balance.js');
    const run = async (answers) => {
      const REAL = ['STREET_20', 'STREET_21'];
      const give = (a) => (a === 'real' ? B.setStarterSlots(REAL) : B.setStarterSlots([...B.STARTER_DEFAULT], a === 'old'));
      B.setStarterSlots(null);
      give(answers[0]);
      const st = { reads: [], t: 0, known: false, settled: false };
      const net = { kakaoKey: () => Promise.resolve(), loadConfig: async () => { st.reads.push(st.t); give(answers[st.reads.length]); } };
      const setTimeout = (f, ms) => { st.t += ms; f(); };
      const body = (consts + '\n' + main.slice(from, to)).replace(/starterListKnown = true;/g, 'st.known = true;').replace(/starterListSettled = true;/g, 'st.settled = true;').replace(/^net\.kakaoKey\(\)/m, 'return net.kakaoKey()');
      try {
        await new Function('net', 'BALANCE', 'STARTER_DEFAULT', 'starterFromDb', 'setTimeout', 'st', body)(net, B.BALANCE, B.STARTER_DEFAULT, B.starterFromDb ?? (() => false), setTimeout, st);
        return { reads: st.reads, real: B.BALANCE.starterSlots.join() === REAL.join(), known: st.known, settled: st.settled };
      } finally { B.setStarterSlots(null); }
    };
    // the case that went wrong: the real list only on the third read again (one read again kept the old four all session)
    const cold = await run(['old', 'old', 'old', 'real']);
    assert.deepEqual([cold.reads, cold.real], [[2500, 6000, 20000], true]);
    // a real list at once: no read again
    assert.deepEqual(await run(['real']), { reads: [], real: true, known: true, settled: true });
    // the old four, then the real list on the first read again (what one re-read used to cover)
    assert.deepEqual(await run(['old', 'real']), { reads: [2500], real: true, known: true, settled: true });
    // a cold isolate: the old four twice more, the real list at 20 s; the goal line follows it from there
    assert.deepEqual(await run(['old', 'old', 'old', 'real']), { reads: [2500, 6000, 20000], real: true, known: true, settled: true });
    // a database without starter_slot_list: the old four every time, three reads and no more
    assert.deepEqual(await run(['old', 'old', 'old', 'old', 'real']), { reads: [2500, 6000, 20000], real: false, known: true, settled: true });
    // a Worker from before the flag answers the old four unmarked: still read again, as before
    assert.deepEqual(await run(['oldw', 'oldw', 'real']), { reads: [2500, 6000], real: true, known: true, settled: true });
    // the database's list at once, then a cold isolate's fallback on a later read (main.js maintTick): the list stays
    const B2 = await import('../balance.js');
    try {
      B2.setStarterSlots(['STREET_20', 'STREET_21']);
      B2.setStarterSlots([...B2.STARTER_DEFAULT], true);
      assert.deepEqual(B2.BALANCE.starterSlots, ['STREET_20', 'STREET_21']);
    } finally { B2.setStarterSlots(null); }
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
  it('starts, and ends on skip, the first claim, graduation, or the gift maker opened from the card', () => {
    assert.equal(tutorialNext(false, 'start'), true);
    assert.equal(tutorialNext(true, 'skip'), false);
    assert.equal(tutorialNext(true, 'gift'), false);
    assert.equal(tutorialNext(true, 'grad'), false);
    assert.equal(tutorialNext(true, 'claim'), false);
    assert.equal(tutorialNext(true, 'other'), true);
    assert.equal(tutorialNext(false, 'other'), false);
    // the bake tutorial's events are no events any more
    assert.equal(tutorialNext(true, 'bakePay'), true);
    assert.equal(tutorialNext(true, 'walkDone'), true);
  });
  it('main.js drives every edge and marks the starter used on a starter claim', () => {
    const main = read('main.js');
    assert.match(main, /ui\.tutorial\?\.\('start'\)/);
    assert.match(main, /ui\.tutorial\?\.\('skip'\)/);
    assert.match(main, /ui\.tutorial\?\.\('gift'\)/);
    assert.match(main, /ui\.tutorial\?\.\('claim'\)/);
    assert.equal(/ui\.tutorial\?\.\('(bakePay|walkDone)'\)/.test(main + read('ui.js')), false);
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
    assert.match(ui, /const NEWCOMER_STEPS = \[\r?\n\s+\(\) => \(tutorialOn && tutorialLine \? \{ text: tutorialLine, go: tutorialGo \} : null\),/);
    assert.match(ui, /function newcomerTask\(\)/);
    assert.match(ui, /setTutorialLine/);
    assert.ok(read('index.html').includes('#ui.newbie .nextline'));
    // The line is the welcome's gift step; other setNextLine callers (news, notices) never write the card.
    assert.match(read('main.js'), /ui\.setTutorialLine\?\.\(WELCOME\.task\);/);
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
