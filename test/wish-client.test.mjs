// 오늘의 소원, client side: the decisions the sheet, the newcomer card and the boot card make (ftue.js), plus a few
// source checks for what cannot run without a browser (socket mapping, no HTML sinks for wish text).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { WISH, cleanWish } from '../wish.js';
import { EVENT_NAMES } from '../plaza-account.js';
import {
  WISH_STEP, wishStep, wishAutoOpen, wishBootLine, wishHeart, wishDraft, shareWish, firstStep, PUBLIC_MIN,
  tutorialNext, tutorialTap, silentGrad, newcomerKnown, startFtue,
} from '../ftue.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const DAY = '2026-11-20';

describe('newcomer card order', () => {
  // Same shape as ui.js NEWCOMER_STEPS: wish → tutorial line → next goal.
  const steps = (s) => [
    () => { const text = wishStep(s); return text ? { text, k: 'wish' } : null; },
    () => (s.tutorialOn && s.tutorialLine ? { text: s.tutorialLine, k: 'tutorial' } : null),
    () => ({ text: '다음 목표', k: 'goal' }),
  ];
  it('asks for a wish first while the server says there is none', () => {
    assert.deepEqual(firstStep(steps({ known: true, mine: false, skipped: false, tutorialOn: true, tutorialLine: '붕어빵 포차로 가 보세요' })), { text: WISH_STEP, k: 'wish' });
    assert.equal(WISH_STEP, '오늘의 소원 한 줄 걸기 (무료)');
  });
  it('yields to the tutorial once a wish is up, or after the sheet was closed once', () => {
    assert.equal(firstStep(steps({ known: true, mine: true, tutorialOn: true, tutorialLine: 'T' })).k, 'tutorial');
    assert.equal(firstStep(steps({ known: true, mine: false, skipped: true, tutorialOn: true, tutorialLine: 'T' })).k, 'tutorial');
  });
  it('then the next goal; and never asks before the wish list answered', () => {
    assert.equal(firstStep(steps({ known: true, mine: true, tutorialOn: false })).k, 'goal');
    assert.equal(firstStep(steps({ known: false, mine: false, tutorialOn: false })).k, 'goal');
  });
  it('ui.js puts the wish step at the front and sets the skip flag on close', () => {
    const ui = read('ui.js');
    const block = ui.slice(ui.indexOf('const NEWCOMER_STEPS = ['), ui.indexOf('function newcomerTask()'));
    assert.ok(block.indexOf('wishStep(') > 0 && block.indexOf('wishStep(') < block.indexOf('tutorialOn && tutorialLine'));
    assert.match(ui, /sessionStorage\.setItem\('kts_wish_skip', '1'\)/);
  });
});

describe('auto-open after the intro', () => {
  it('only for newcomers without a wish and without a deep link', () => {
    assert.equal(wishAutoOpen({ newbie: true, known: true, mine: false, deep: false }), true);
    assert.equal(wishAutoOpen({ newbie: true, known: false, mine: false, deep: false }), true);
    assert.equal(wishAutoOpen({ newbie: true, known: true, mine: true, deep: false }), false);
    assert.equal(wishAutoOpen({ newbie: true, known: true, mine: false, deep: true }), false);
    assert.equal(wishAutoOpen({ newbie: false, known: true, mine: false, deep: false }), false);
  });
  it('main.js holds the bake tutorial until that sheet closes', () => {
    const main = read('main.js');
    assert.match(main, /if \(ftueArmed \|\| !entered \|\| !world \|\| wishHold\) return;/);
    assert.match(main, /setTimeout\(\(\) => \{ introDone\(\); afterIntro\(\); \}, 3000\)/);
    assert.match(main, /function releaseWish\(\) \{ wishHold = false; armFtue\(\); \}/);
    assert.match(main, /if \(WISH_ID\) \{ landWish\(\); return; \}/);
  });
});

describe('boot card line', () => {
  const deep = { id: 'abcdefghij', nick: '민지', txt: '합격', hearts: 2 };
  const king = { nick: '준호', txt: '건강', hearts: 9 };
  it('deep link beats the king, the king beats the count', () => {
    assert.deepEqual(wishBootLine({ deep, king, count: 99 }), { kind: 'deep', text: '🌠 민지님의 소원 · “합격” · ♥ 2', enter: '입장해서 하트 보내기' });
    assert.deepEqual(wishBootLine({ deep: null, king, count: 99 }), { kind: 'king', text: '👑 어제의 소원왕 준호 · “건강”', enter: '' });
    assert.deepEqual(wishBootLine({ king: null, count: PUBLIC_MIN.wishes }), { kind: 'count', text: `오늘 걸린 소원 ${PUBLIC_MIN.wishes}개`, enter: '' });
  });
  it('small counts and empty answers say nothing; a hidden linked wish falls through', () => {
    assert.equal(wishBootLine({ count: PUBLIC_MIN.wishes - 1 }).kind, '');
    assert.equal(wishBootLine({}).text, '');
    assert.equal(wishBootLine().enter, '');
    assert.equal(wishBootLine({ deep: { ...deep, hidden: true }, king }).kind, 'king');
  });
  it('main.js reads the absent wish key as empty and uses the line', () => {
    const main = read('main.js');
    assert.match(main, /wishBootLine\(\{ deep: deepWish, \.\.\.\(data\?\.wish \?\? \{ board: \[\], king: null, count: 0 \}\), day: deepDay \|\| kstDay\(\), focus: !!FOCUS \}\)/);
    assert.match(main, /ui\.boot\?\.label\?\.\(wishLine\.enter\)/);
    assert.match(main, /const w = src \?\? \{ board: \[\], king: null, count: 0 \};/);
  });
});

describe('heart button', () => {
  const w = { id: 'aaaaaaaaaa', day: DAY, hearts: 0 };
  it('mine, already given, hidden, an earlier day, no hearts left, else ok', () => {
    assert.deepEqual(wishHeart({ wish: { ...w, mine: true }, given: [], left: 5, day: DAY }), { ok: false, why: '내 소원이에요', short: '내 소원' });
    assert.equal(wishHeart({ wish: w, given: ['aaaaaaaaaa'], left: 5, day: DAY }).short, '♥ 보냄');
    assert.equal(wishHeart({ wish: { ...w, hidden: true }, given: [], left: 5, day: DAY }).ok, false);
    assert.equal(wishHeart({ wish: { ...w, day: '2026-11-19' }, given: [], left: 5, day: DAY }).why, '어제 소원이라 하트는 닫혔어요');
    assert.equal(wishHeart({ wish: w, given: [], left: 0, day: DAY }).ok, false);
    assert.deepEqual(wishHeart({ wish: w, given: [], left: 1, day: DAY }), { ok: true, why: '', short: '♥ 보내기' });
  });
  it('a wish with no day (board rows) is not treated as closed; nothing to show without a wish', () => {
    assert.equal(wishHeart({ wish: { id: 'bbbbbbbbbb' }, given: [], left: 2, day: DAY }).ok, true);
    assert.equal(wishHeart({}).ok, false);
  });
});

describe('share fallback order', () => {
  const data = { title: 't', text: '"합격" — 하트 하나만 눌러 주세요', url: 'https://x.test/rt/w/abcdefghij' };
  it('share sheet first', async () => {
    const seen = [];
    assert.equal(await shareWish({ nav: { share: async (d) => seen.push(d) }, clip: async () => { throw new Error('no'); }, data }), 'shared');
    assert.deepEqual(seen, [data]);
  });
  it('a cancel stops there, nothing is copied', async () => {
    let copied = false;
    const err = Object.assign(new Error('x'), { name: 'AbortError' });
    assert.equal(await shareWish({ nav: { share: async () => { throw err; } }, clip: async () => { copied = true; return true; }, data }), 'cancel');
    assert.equal(copied, false);
  });
  it('other share failures and no share sheet go to the clipboard with "text url"', async () => {
    let line = '';
    assert.equal(await shareWish({ nav: { share: async () => { throw new Error('NotAllowed'); } }, clip: async (t) => { line = t; return true; }, data }), 'copied');
    assert.equal(line, `${data.text} ${data.url}`);
    assert.equal(await shareWish({ nav: {}, clip: async () => true, data }), 'copied');
  });
  it('then the manual box', async () => {
    assert.equal(await shareWish({ nav: {}, clip: async () => false, data }), 'manual');
    assert.equal(await shareWish({ nav: null, clip: async () => { throw new Error('denied'); }, data }), 'manual');
  });
});

describe('input counter and clip', () => {
  const samples = ['', '  올해는   꼭\t합격  ', '가'.repeat(30), '👨‍👩‍👧 가족 건강', 'a​b‮c', ' '.repeat(5) + '나'.repeat(26), '올해는 '];
  it('counts code points the server keeps, the same as cleanWish', () => {
    for (const s of samples) {
      const d = wishDraft(s);
      assert.equal(d.text, cleanWish(s));
      assert.equal(d.n, Array.from(cleanWish(s)).length);
      assert.equal(cleanWish(d.value), cleanWish(s), JSON.stringify(s));
    }
  });
  it('leaves the box alone under the limit (a trailing space mid-typing stays) and cuts it at the limit', () => {
    assert.equal(wishDraft('올해는 ').value, '올해는 ');
    const long = wishDraft('가'.repeat(30));
    assert.equal(long.n, WISH.maxLen);
    assert.equal(Array.from(long.value).length, WISH.maxLen);
    assert.equal(wishDraft('😀'.repeat(25)).value, '😀'.repeat(24));
  });
  it('ui.js never rewrites the box while composing', () => {
    const ui = read('ui.js');
    assert.match(ui, /if \(!busy && d\.value !== input\.value\) input\.value = d\.value;/);
    assert.match(ui, /sync\(composing \|\| !!e\.isComposing\)/);
    assert.match(ui, /compositionend', \(\) => \{ composing = false; sync\(false\); \}/);
  });
});

describe('wiring', () => {
  it('net.js maps WISH socket messages and has the four calls', () => {
    const net = read('net.js');
    assert.match(net, /m\.t === 'BALL' \|\| m\.t === 'WISH'\) \{ if \(this\.rt\.net\) this\.rt\.net\.emit\(m\.t\.toLowerCase\(\), m\); \}/);
    for (const f of ['async wishes(id, anon)', 'async postWish(text, nick)', 'async heartWish(id)', 'async reportWish(id)']) assert.ok(net.includes(f), f);
    assert.match(net, /topic: this\.topic \|\| \(NS \+ 'square'\)/);
  });
  it('main.js listens for wish events and sends boards to the scene with optional chaining', () => {
    const main = read('main.js');
    assert.match(main, /net\.on\('wish', /);
    assert.match(main, /world\?\.setWishes\?\.\(/);
    assert.match(main, /ui\.news\('WISH', \{ nick: row\.nick \}\)/);
    assert.match(main, /history\.replaceState\(history\.state, '', u\.pathname \+ u\.search \+ u\.hash\)/);
    assert.ok(!/setInterval\([^)]*loadWishes/.test(main), 'no timer refetches wishes');
  });
  it('wish text never reaches an HTML sink in the wish sheet', () => {
    const ui = read('ui.js');
    const sheet = ui.slice(ui.indexOf('// ---------------------------------------------------------------- 오늘의 소원'), ui.indexOf('function openAd(slotId)'));
    assert.ok(sheet.length > 2000);
    assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(sheet), false);
    const news = ui.slice(ui.indexOf("kind === 'WISH'"), ui.indexOf("kind === 'WELCOME'"));
    assert.match(news, /h\('em', \{ text: chars\(data\?\.nick/);
  });
  it('the 🌠 tool is not folded behind ⋯ and not hidden for newcomers', () => {
    const ui = read('ui.js');
    const btn = ui.slice(ui.indexOf('const wishBtn'), ui.indexOf('const wishBtn') + 200);
    assert.match(btn, /class: 'btn icon tool-wish'/);
    assert.equal(/tool-more|tool-adv/.test(btn), false);
  });
  it('the analytics allow-list has the wish events', () => {
    for (const n of ['wish_view', 'wish_post', 'wish_heart', 'wish_share', 'wish_land']) assert.ok(EVENT_NAMES.includes(n), n);
  });
});

describe('first-minute review fixes', () => {
  it('tapping the tutorial line bakes at the cart, restores a cleared waypoint, pulses a live one, else the goal', () => {
    assert.equal(tutorialTap({ atCart: true, waypoint: null, tutorialWp: { x: 1, z: 2 } }), 'bake');
    assert.equal(tutorialTap({ atCart: false, waypoint: null, tutorialWp: { x: 1, z: 2 } }), 'waypoint');
    assert.equal(tutorialTap({ atCart: false, waypoint: { x: 1, z: 2 }, tutorialWp: { x: 1, z: 2 } }), 'pulse');
    assert.equal(tutorialTap({ atCart: false, waypoint: null, tutorialWp: null }), 'goal');
  });
  it('the at-cart line does not mention the E key on touch', () => {
    const run = (touch) => {
      const lines = [];
      startFtue({ ui: { setNextLine: (t) => lines.push(t), startBake: () => {} }, world: { setWaypoint: () => {} }, touch }).onArrive();
      return lines.at(-1);
    };
    assert.equal(run(true), '여기서 붕어빵을 구워 보세요');
    assert.equal(run(false), '여기서 E를 눌러 붕어빵을 구우세요');
  });
  it('the tutorial stays on through bake pay and ends on claim, graduation, or the end of the walk', () => {
    assert.equal(tutorialNext(true, 'bakePay'), true);
    for (const ev of ['claim', 'grad', 'walkDone', 'skip']) assert.equal(tutorialNext(true, ev), false, ev);
    const ui = read('ui.js');
    assert.match(ui, /if \(!waypoint && tutorialWalk\) \{ tutorialWalk = false; setTutorial\('walkDone'\); \}/);
    assert.match(ui, /if \(tutorialLine && nextLineEl\.textContent === tutorialLine\) setNextLine\(''\);/);
    const main = read('main.js');
    assert.ok(main.indexOf("ui.tutorial?.('bakePay');") < main.indexOf('ftueApi?.onBakePay();'));
  });
  it('a claim ends the tutorial before graduating', () => {
    const main = read('main.js');
    const fn = main.slice(main.indexOf('function celebrateClaim'), main.indexOf('async function claim('));
    assert.ok(fn.indexOf("ui.tutorial?.('claim')") < fn.indexOf('ui.graduate?.()'));
  });
  it('silent graduation: earlier-day players, or kts_ftue with no kts_daily.last; not a reload today', () => {
    assert.equal(silentGrad({ ftue: 1, daily: { last: DAY, earn: 4 }, day: DAY }), false);
    assert.equal(silentGrad({ ftue: '', daily: { last: '2026-11-19' }, day: DAY }), true);
    assert.equal(silentGrad({ ftue: 1, daily: null, day: DAY }), true);
    assert.equal(silentGrad({ ftue: 1, daily: { streak: 3 }, day: DAY }), true);
    assert.equal(silentGrad({ ftue: '', daily: null, day: DAY }), false);
  });
  it('newcomer mode waits for a guest: or user: actor id', () => {
    assert.equal(newcomerKnown({ plazaReady: true, actor: 'c-temp123' }), false);
    assert.equal(newcomerKnown({ plazaReady: true, actor: 'guest:g-1' }), true);
  });
  it('the waypoint pill hides while the bake or dance panel is open', () => {
    assert.match(read('index.html'), /#ui:has\(\.bake\.show\) \.waypill, #ui:has\(\.rhythm\.show\) \.waypill \{ display: none; \}/);
  });
});
