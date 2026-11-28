// 오늘 할 일 on the screen: the card, the phone pill, the sheet, the notices and the whole-list moment (ui.js, main.js, index.html,
// timesSquare3d.js, ts3d/screens.js, giftart.js). The rules themselves are in test/todo.test.mjs. ui.js's 오늘 할 일 block is run with
// stubs for what it calls (as test/welcome.test.mjs runs main.js), the rest are source and stylesheet checks: no browser here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as TODO_MOD from '../todo.js';
import { BALANCE } from '../balance.js';
import { EVENT_NAMES } from '../plaza-account.js';
import { GA_PARAMS } from '../analytics.js';
import { paintWelcome } from '../giftart.js';
import { WELCOME } from '../ftue.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ui = read('ui.js'), main = read('main.js'), html = read('index.html'), world = read('timesSquare3d.js'), screens = read('ts3d/screens.js');
const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const code = (src) => src.replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ [^\n'`]*$/gm, '');
function body(src, head) {
  const a = src.indexOf(head);
  assert.ok(a >= 0, head);
  const indent = head.match(/^\s*/)[0];
  const b = src.indexOf('\n' + indent + '}', a);
  return src.slice(a, b + indent.length + 2);
}

// ---- ui.js's 오늘 할 일 block, run with stubs ---------------------------------------------------------------------------------------
const DAY = '2026-11-25';
const plain = (v) => JSON.parse(JSON.stringify(v));
function harness({ day = DAY, daily = {}, wish = { known: true, mine: null, given: [], busy: false }, entered = true, nick = '민지', cheerOpen = true } = {}) {
  const a = ui.indexOf('  let teamToday = null'), b = ui.indexOf("  addEventListener('storage'");
  assert.ok(a > 0 && b > a, 'the 오늘 할 일 block');
  const calls = [];
  const node = () => { const n = { kids: [], cls: new Set(), replaceChildren(...k) { n.kids = k; }, classList: { toggle(c, on) { if (on) n.cls.add(c); else n.cls.delete(c); }, contains: (c) => n.cls.has(c) } }; return n; };
  let d = { day, streak: 3, last: day, cheer: 0, wish: 0, heart: 0, paid: {}, qPaid: {}, stamps: {}, allDay: '', cardDay: '', gw: '', gs: null, ...daily };
  let now = 1000;
  const body = new Set(), rootCls = new Set();
  const rows = []; // the todo-row buttons painted (props only)
  const ctx = {
    ...TODO_MOD, BALANCE,
    h: (tag, props, ...kids) => { const n = node(); n.props = props || {}; n.text = kids.filter(Boolean).map((k) => k.props?.text || '').join('|'); if (String(props?.class || '').startsWith('todo-row')) rows.push(n); return n; }, icon: () => null,
    performance: { now: () => now },
    document: { body: { classList: { contains: (c) => body.has(c) } } },
    root: { classList: { contains: (c) => rootCls.has(c) } },
    wishView: wish,
    today: () => d, saveDay: (x) => { d = x; calls.push(['save']); },
    note: (text, kind, tap, o) => calls.push(['note', text, kind, typeof tap, o?.key || '']),
    sfx: { todo: () => calls.push(['sfx', 'todo']), todoAll: () => calls.push(['sfx', 'all']) },
    trackEvent: (n, p) => calls.push(['event', n, p]),
    hooks: { nick: () => nick, todoCard: (c) => { calls.push(['card', c]); return ctx.built; } },
    built: true,
    open: cheerOpen, cheerSignal: () => ctx.open, // ui.js cheerSignal: true / false / null (the boards not in yet)
    guideQuest: (id) => calls.push(['go', id]), openToday: () => calls.push(['sheet']), renderGoal: () => {},
  };
  runInNewContext(`let entered = ${entered}, driving = false, baking = null, sheets = [], ext = null; const proof = { hidden: true };\n${ui.slice(a, b)}\nthis.api = { renderTodo, attendPaid, setTeamToday, pumpTodoCard, todoEl, set(k, v) { if (k === 'driving') driving = v; if (k === 'baking') baking = v; if (k === 'sheet') sheets = v ? [{}] : []; if (k === 'ext') ext = v ? {} : null; if (k === 'proof') proof.hidden = !v; if (k === 'entered') entered = v; } };`, ctx);
  return {
    api: ctx.api, ctx, calls, rows,
    get d() { return d; },
    clear() { calls.length = 0; rows.length = 0; },
    tick(ms = 2500) { now += ms; },
    body, rootCls,
    // as plain data (objects made inside the context have its prototypes, which deepEqual would tell apart)
    notes: () => plain(calls.filter((c) => c[0] === 'note')),
    events: () => plain(calls.filter((c) => c[0] === 'event').map((c) => [c[1], c[2]])),
    cards: () => plain(calls.filter((c) => c[0] === 'card')),
  };
}

describe('the notices: one keyed line per row finished, the next row as its tap', () => {
  it('says nothing for what was already done on arrival, then one todo line per row', () => {
    const t = harness({ daily: { wish: 1 } });
    t.api.setTeamToday(false);
    t.api.renderTodo();
    assert.deepEqual(t.notes(), [], 'the wish was posted before: no notice');
    t.d.cheer = 3; t.api.renderTodo();
    assert.deepEqual(t.notes(), [['note', '✓ 전광판 응원 3번 · 다음: 소원에 하트 1개', 'ok', 'function', 'todo']]); // no QUEST claim went out here: no points (test/review2-hud.test.mjs 2)
    assert.deepEqual(t.calls.filter((c) => c[0] === 'sfx'), [['sfx', 'todo']]);
    assert.deepEqual(t.events(), [['todo_done', { kind: 'cheer' }]]);
  });
  it('the team row has no points; the attendance pay is the same keyed line', () => {
    const t = harness({ daily: { cheer: 3, wish: 1 } });
    t.api.setTeamToday({ has: true, done: false });
    t.clear();
    t.api.setTeamToday({ has: true, done: true });
    assert.equal(t.notes()[0][1], '✓ 우리 팀 응원하기 · 다음: 소원에 하트 1개');
    t.clear();
    t.api.attendPaid(3, 15);
    assert.deepEqual(t.notes(), [['note', '출석 3일 · +15 포인트 · 다음: 소원에 하트 1개', 'ok', 'function', 'todo']]);
    assert.deepEqual(t.events(), [], 'no todo_done for attendance (test/review2-hud.test.mjs 5)');
  });
  it('a row known only later (the wish list, the team) is not announced as just done', () => {
    const t = harness({ wish: { known: false, mine: null, given: [], busy: false } });
    t.api.renderTodo();
    t.ctx.wishView = { known: true, mine: { id: 'w' }, given: ['x'], busy: false }; // the list answers: posted and given earlier
    t.api.setTeamToday(false);
    t.api.renderTodo();
    assert.deepEqual(t.notes().map((n) => n[1]), [], 'no ✓ for a wish or a heart that was there before');
    assert.equal(t.cards().length, 0);
  });
});

describe('the whole list: once a day per device', () => {
  const done = (t) => { t.d.cheer = 3; t.d.wish = 1; t.d.heart = 1; t.api.renderTodo(); };
  it('the last row brings the whole-list notice (not the row\'s), the chime, the gold stamp and todo_all; the card goes up', () => {
    const t = harness({ daily: { cheer: 3, wish: 1 } });
    t.api.setTeamToday(false);
    t.clear();
    t.d.heart = 1; t.api.renderTodo();
    assert.deepEqual(t.notes(), [['note', '🎉 오늘 할 일을 다 했어요 · 출석 3일', 'ok', 'function', 'todo']]);
    assert.deepEqual(t.calls.filter((c) => c[0] === 'sfx'), [['sfx', 'all']]);
    assert.deepEqual(t.events(), [['todo_done', { kind: 'heart' }], ['todo_all', { streak: 3 }]]);
    assert.equal(t.d.stamps[DAY], 2);
    assert.equal(t.d.allDay, DAY);
    assert.deepEqual(t.cards().map((c) => c[1]), [{ chip: '🎉 오늘 할 일 완료', name: '민지', line: '출석 3일째 · 내일 또 만나요', strip: '민지님, 오늘 할 일을 다 했어요' }]);
    assert.equal(t.d.cardDay, DAY);
    // again the same day: nothing
    t.clear(); t.tick(); t.api.renderTodo(); t.api.pumpTodoCard();
    assert.deepEqual(t.notes(), []);
    assert.deepEqual(t.cards(), []);
  });
  it('already had today on this device (a reload): no second moment', () => {
    const t = harness({ daily: { allDay: DAY, cardDay: DAY, stamps: { [DAY]: 2 } } });
    t.api.setTeamToday(false);
    done(t);
    assert.deepEqual(t.notes().filter((n) => n[1].startsWith('🎉')), []);
    assert.deepEqual(t.cards(), []);
  });
  it('all done on arrival (another device): the gold stamp, no moment', () => {
    const t = harness({ daily: { cheer: 3, wish: 1, heart: 1 } });
    t.api.setTeamToday(false);
    assert.equal(t.d.stamps[DAY], 2);
    assert.deepEqual(t.notes(), []);
    assert.deepEqual(t.cards(), []);
  });
  it('waits for the team to be decided: no answer within 10 s means N is 4', () => {
    const t = harness({ daily: { cheer: 3, wish: 1 } });
    t.api.setTeamToday('ask');
    t.api.renderTodo(); // the HUD's 1 s tick
    t.d.heart = 1; t.api.renderTodo();
    assert.deepEqual(t.notes().map((n) => n[1]), [], 'the team may still be a row: not all done yet (and the heart row\'s line waits for its pay)');
    t.clear(); t.tick(10001); t.api.renderTodo();
    assert.deepEqual(t.notes().map((n) => n[1]), ['🎉 오늘 할 일을 다 했어요 · 출석 3일']);
  });
  for (const [what, set, unset] of [
    ['a lighting ceremony', (t) => t.body.add('gift-cer'), (t) => t.body.delete('gift-cer')],
    ['a gift film being recorded', (t) => t.body.add('gift-rec'), (t) => t.body.delete('gift-rec')],
    ['the lounge', (t) => t.rootCls.add('lounging'), (t) => t.rootCls.delete('lounging')],
    ['a taxi ride', (t) => t.api.set('driving', true), (t) => t.api.set('driving', false)],
    ['an open sheet', (t) => t.api.set('sheet', true), (t) => t.api.set('sheet', false)],
    ['a layer (the gift maker)', (t) => t.api.set('ext', true), (t) => t.api.set('ext', false)],
  ]) {
    it(`the card waits out ${what}; the notice and the stamp do not`, () => {
      const t = harness({ daily: { cheer: 3, wish: 1 } });
      t.api.setTeamToday(false);
      set(t);
      t.clear(); t.d.heart = 1; t.api.renderTodo();
      assert.equal(t.notes()[0][1], '🎉 오늘 할 일을 다 했어요 · 출석 3일');
      assert.equal(t.d.stamps[DAY], 2);
      assert.deepEqual(t.cards(), []);
      t.tick(); t.api.pumpTodoCard();
      assert.deepEqual(t.cards(), [], 'still held');
      unset(t); t.tick(); t.api.pumpTodoCard();
      assert.equal(t.cards().length, 1, 'and then it comes, the same day');
      assert.equal(t.d.cardDay, DAY);
    });
  }
  it('a city not built yet: the card is asked again later; a new day forgets it', () => {
    const t = harness({ daily: { cheer: 3, wish: 1 } });
    t.ctx.built = false;
    t.api.setTeamToday(false);
    t.d.heart = 1; t.api.renderTodo();
    assert.equal(t.cards().length, 1);
    assert.equal(t.d.cardDay, '');
    t.api.pumpTodoCard();
    assert.equal(t.cards().length, 1, 'one try every 2 s');
    t.ctx.built = true; t.tick(); t.api.pumpTodoCard();
    assert.equal(t.cards().length, 2);
    assert.equal(t.d.cardDay, DAY);
  });
  it('the card\'s words are drawn by the welcome painter: chip, name, bottom line', () => {
    const words = [];
    const g = new Proxy({}, { get: (o, k) => (k in o ? o[k] : k === 'measureText' ? (s) => ({ width: String(s).length * 10 }) : k === 'fillText' ? (s) => words.push(String(s)) : k.startsWith('create') ? () => ({ addColorStop() {} }) : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
    const c = TODO_MOD.cardText('네온후드77', 4);
    paintWelcome({ width: 1024, height: 576, getContext: () => g }, { name: c.name, line: c.line, chip: c.chip });
    assert.deepEqual(words, ['오늘 할 일 완료', 'WISH BOARD', '네온후드77 님', '출석 4일째 · 내일 또 만나요'], 'the chip\'s emoji is not drawn on a board (2026-11-28)');
    words.length = 0;
    paintWelcome({ width: 1024, height: 576, getContext: () => g }, { name: '민지', line: WELCOME.line });
    assert.deepEqual(words, ['어서 와요', 'WISH BOARD', '민지 님', WELCOME.line], 'the welcome card is unchanged without a chip');
  });
});

describe('nothing goes to the room or the server for the moment', () => {
  it('main.js todoCard is world.welcome with the card and fx, on this device', () => {
    const fn = body(main, 'function todoCard(');
    assert.match(fn, /world\.welcome\(state\.nick, \{ cam: !welcomeCovered\(\), card: \{ chip: card\?\.chip, line: card\?\.line, strip: card\?\.strip \}, fx: true \}\);/);
    assert.equal(/\bnet\.|fetch\(|\.raw\(|\.send\(|sendBonus|authed\(/.test(code(fn)), false);
  });
  it('the ui block sends nothing either: notices, sounds, two events and the local card', () => {
    const a = ui.indexOf('  let teamToday = null'), b = ui.indexOf('  function openToday(opts');
    const blk = code(ui.slice(a, b));
    assert.equal(/\bnet\.|fetch\(|\.raw\(|sendBonus|hooks\.bonus|claimQuest/.test(blk), false);
    assert.deepEqual([...new Set([...blk.matchAll(/trackEvent\('([a-z_]+)'/g)].map((m) => m[1]))], ['todo_done', 'todo_all']);
  });
  it('world.welcome takes the card and its fireworks on the same path; the camera rule is unchanged', () => {
    const fn = body(world, '  function welcome(');
    assert.match(fn, /function welcome\(name, \{ cam = true, card = null, fx = false \} = \{\}\)/);
    assert.match(fn, /if \(slot && cam && !drive && !walking && focusSlot\(slot, \{ hold: 3500, celebrate: false, free: true \}\)\) setTimeout\(\(\) => cheerAt\(slot\), 900\);/);
    assert.match(fn, /else if \(fx\) setTimeout\(\(\) => \{ if \(slot\) cheerAt\(slot\); else if \(!drive\) for/);
    assert.equal(/net\b|\.send|raw\(/.test(fn), false);
    assert.match(screens, /function pinWelcome\(name, ms = 8000, at = \{ x: 0, z: 0 \}, card = null\)/);
    assert.match(screens, /if \(gift\.welcome\) paintWelcome\(b\.canvas, gift\.card \? \{ name: gift\.to, line: gift\.card\.line, chip: gift\.card\.chip \} : \{ name: gift\.to, line: WELCOME\.line \}\);/);
  });
  it('todo_done and todo_all are known events (the Worker checks the same list) and their keys may go to GA', () => {
    for (const n of ['todo_done', 'todo_all']) assert.ok(EVENT_NAMES.includes(n), n);
    for (const k of ['kind', 'streak']) assert.ok(GA_PARAMS.includes(k), k);
  });
});

describe('the pays and their words', () => {
  it('the old notices are gone: the PAY handlers mark and announce through 오늘 할 일', () => {
    assert.doesNotMatch(main, /오늘의 응원 미션 완료|`출석 \+\$\{got\} 포인트`/);
    assert.match(main, /if \(m\?\.kind === 'quest' && got\) ui\.markQuest\?\.\(m\.key, got\);/);
    assert.match(main, /if \(got\) ui\.attendPaid\?\.\(m\?\.key, got\);/);
    assert.doesNotMatch(ui, /오늘 미션 \+|오늘의 응원'\s*\}|h\('b', \{ text: '오늘의 응원' \}\)/);
    // the pay flow itself is as it was: payDue, MISSION_NEED, the QUEST claim
    assert.match(ui, /const MISSION_NEED = \{ cheer: 1, wish: 1, heart: 1 \};/);
    assert.match(ui, /if \(!key \|\| !hooks\.bonus\?\.\('mission', BALANCE\.missionReward\)\) return;/);
    assert.match(ui, /const sent = d\[key\] < need \|\| !!hooks\.claimQuest\?\.\(key\);/);
  });
  it('미션 leaves the screen; the 응원 팀 ranking keeps its name', () => {
    const strings = (src) => [...code(src).matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2]);
    for (const [f, src] of [['ui.js', ui], ['main.js', main]]) assert.deepEqual(strings(src).filter((t) => /미션/.test(t)), [], f);
    assert.match(ui, /withIcon\('trophy', '오늘의 응원 팀'\)/);
    assert.match(ui, /text: TODO_TEXT\.title, onclick: \(e\) => \{ e\.stopPropagation\(\); openToday\(\); \}/);
    assert.match(ui, /todayBtn\.textContent = `출석 \$\{k\}일`;\n\s+todayBtn\.dataset\.row = `\$\{TODO_TEXT\.title\} · 출석 \$\{k\}일`;/);
    assert.match(ui, /h\('span', \{ text: chip\.dataset\.row \|\| chip\.textContent \}\)/, 'the wallet sheet row reads 오늘 할 일 · 출석 N일');
  });
  it('the sheet: its title, the sub line, the list, the stamps, the foot, the suggestion, the goal and the facts', () => {
    const fn = body(ui, '  function openToday(opts = {}) {');
    assert.match(fn, /openSheet\(\['mission', TODO_TEXT\.title\], null,/);
    for (const re of [/TODO_TEXT\.sub/, /todoRow\(r, next, tap, true\)/, /TODO_TEXT\.week/, /footLine\(/, /TODO_TEXT\.gift/, /hooks\.openGiftMaker\?\.\(\)/, /nextGoalGo\(\)/, /todayFacts\(d\)/]) assert.match(fn, re);
    assert.match(main, /openGiftMaker: \(\) => giftUi\?\.open\(\),/);
    assert.match(ui, /if \(quietBlock && \(title === TODO_TEXT\.title \|\|/);
  });
  it('a cheer row walks to the nearest lit board of someone else', () => {
    const fn = body(ui, '  function guideQuest(key) {');
    assert.match(body(ui, '  function cheerBoards() {'), /boardActive\(b\) && \(!me \|\| b\.holder_id !== me\)/);
    assert.match(fn, /const rows = cheerBoards\(\);/);
    assert.doesNotMatch(fn, /world\.billboards/, 'no fallback to every slot (an empty one takes no cheer)');
    assert.match(fn, /hooks\.setWaypoint\?\.\(\{ \.\.\.best, auto: true \}\);/);
    assert.match(fn, /if \(key === 'team'\) \{ openTribeSheet\(\); return; \}/);
  });
  // guideQuest('cheer') run with stubs: worker.js Room.cheer counts a lit board held by someone else, Room.cheerGift a gift board on a
  // screen now that I did not make.
  describe('the cheer guide, run', () => {
    const H = 3600e3, NOW = Date.now();
    const lit = (slot, holder) => ({ slot_id: slot, holder_id: holder, lit_until: new Date(NOW + H).toISOString() });
    const POS = { STREET_20: { x: 1, z: 1 }, STREET_3: { x: 2, z: 2 }, STREET_40: { x: 90, z: 90 }, STREET_9: { x: 5, z: 5 }, STREET_31: { x: 30, z: 30 }, PLOT_7: { x: 3, z: 3 } };
    // gifts: hooks.giftScreens ({ slot, id }); mine: kts_gmine (ids made on this device); no: the ids the room refused this visit (giftNoCheer).
    function guide(billboards, { me = 'me', ready = true, gifts = [], mine = [], no = [] } = {}) {
      const calls = [];
      const ctx = {
        TODO_TEXT: TODO_MOD.TODO_TEXT, PAY: { cheer: { base: 4 } },
        world: { billboards }, plazaReady: ready,
        recall: (k, d) => (k === 'kts_gmine' ? mine : d), giftNoCheer: new Set(no),
        hooks: { actorId: () => me, minimap: () => ({ me: { x: 0, z: 0 } }), slotCard: (id) => POS[id] || {}, setWaypoint: (w) => calls.push(['way', w]), giftScreens: () => gifts },
        note: (text, kind, tap, o) => calls.push(['note', text, kind, o?.key || '']),
        openWish() {}, openTribeSheet() {}, openToday() {},
      };
      runInNewContext(`${body(ui, '  function boardActive(b) {')}\n${body(ui, '  function guideQuest(key) {')}\n${body(ui, '  function cheerBoards() {')}\n${ui.match(/  function cheerSignal\(\) \{[^\n]*\}/)[0]}\nthis.go = guideQuest; this.sig = cheerSignal;`, ctx);
      return { go: () => { ctx.go('cheer'); return JSON.parse(JSON.stringify(calls)); }, sig: () => ctx.sig() };
    }
    const NONE = ['note', '지금은 켜진 남의 전광판도, 걸린 선물 전광판도 없어요. 누가 전광판을 켜거나 선물 전광판을 걸면 응원할 수 있어요', '', 'cheer-none'];
    it('only my own lit board and empty or dark slots: no waypoint, an honest note, and the row waits', () => {
      const g = guide([lit('STREET_20', 'me'), { slot_id: 'STREET_3' }, { slot_id: 'STREET_9', holder_id: 'x', lit_until: new Date(NOW - 1).toISOString() }]);
      assert.deepEqual(g.go(), [NONE]);
      assert.equal(g.sig(), false);
    });
    it('no lit board of someone else, a gift board on a screen: walked to the gift screen, and the row does not wait', () => {
      const g = guide([lit('STREET_20', 'me'), { slot_id: 'STREET_3' }], { gifts: [{ slot: 'STREET_31', id: 'ab12cd34' }] });
      const c = g.go();
      assert.deepEqual(c[0], ['way', { x: 30, z: 30, name: '선물 전광판', auto: true }]);
      assert.equal(c[1][2], 'ok');
      assert.match(c[1][1], /^선물 전광판 길안내를 시작해요\. 켜진 남의 전광판이나 선물 전광판을 눌러 응원하면 응원 포인트 \+4/);
      assert.equal(g.sig(), true);
    });
    it('the nearest of the lit boards and the gift screens', () => {
      assert.deepEqual(guide([lit('STREET_40', 'other')], { gifts: [{ slot: 'PLOT_7', id: 'ab12cd34' }] }).go()[0], ['way', { x: 3, z: 3, name: '선물 전광판', auto: true }]);
      assert.deepEqual(guide([lit('STREET_9', 'other')], { gifts: [{ slot: 'STREET_31', id: 'ab12cd34' }] }).go()[0], ['way', { x: 5, z: 5, name: '전광판', auto: true }]);
    });
    it('a gift board made on this device, or one the room refused this visit, is nothing to cheer: wait only when nothing else is left', () => {
      const mine = guide([], { gifts: [{ slot: 'STREET_31', id: 'ab12cd34' }], mine: ['ab12cd34'] });
      assert.deepEqual(mine.go(), [NONE]);
      assert.equal(mine.sig(), false);
      const no = guide([lit('STREET_20', 'me')], { gifts: [{ slot: 'STREET_31', id: 'ab12cd34' }], no: ['ab12cd34'] });
      assert.equal(no.sig(), false);
      assert.equal(guide([], { gifts: [{ slot: 'STREET_31', id: 'ab12cd34' }, { slot: 'PLOT_7', id: 'zz99yy88' }], mine: ['ab12cd34'] }).go()[0][1].name, '선물 전광판');
    });
    it('the nearest lit board of someone else, walked to by itself; never mine, never an empty slot nearer', () => {
      const g = guide([lit('STREET_20', 'me'), { slot_id: 'STREET_3' }, lit('STREET_40', 'other')]);
      const c = g.go();
      assert.deepEqual(c[0], ['way', { x: 90, z: 90, name: '전광판', auto: true }]);
      assert.equal(c[1][2], 'ok');
      assert.equal(g.sig(), true);
    });
    it('the boards not in yet: the signal is null (the list does not say all done on it)', () => {
      assert.equal(guide([], { ready: false }).sig(), null);
    });
  });
  it('the waiting cheer row on the card: dimmed, says why, not in n / N, not next; it comes back when a board lights up', () => {
    const t = harness({ daily: { wish: 1 }, cheerOpen: false });
    t.api.setTeamToday(false);
    const row = () => t.rows.filter((n) => /^전광판 응원/.test(n.props['aria-label'])).pop();
    const head = () => t.ctx.api.todoEl.kids[0];
    assert.match(row().props.class, /\bwait\b/);
    assert.doesNotMatch(row().props.class, /\bnext\b/);
    assert.match(row().props['aria-label'], /지금은 응원할 전광판이 없어요/);
    assert.match(row().text, /지금은 응원할 전광판이 없어요/);
    assert.match(head().props['aria-label'], /2 \/ 3/);
    assert.ok(t.rows.some((n) => /소원에 하트 1개/.test(n.props['aria-label']) && /\bnext\b/.test(n.props.class)), 'the heart is next');
    t.clear(); t.ctx.open = true; t.api.renderTodo();
    assert.doesNotMatch(row().props.class, /\bwait\b/);
    assert.match(row().props.class, /\bnext\b/);
    assert.match(head().props['aria-label'], /2 \/ 4/);
    assert.deepEqual(t.notes(), [], 'coming back says nothing');
  });
  it('with nothing to cheer the rest can still be all done (the moment, the gold stamp); the boards not in yet hold it', () => {
    const t = harness({ daily: { wish: 1 }, cheerOpen: null });
    t.api.setTeamToday(false);
    t.d.heart = 1; t.api.renderTodo();
    assert.equal(t.d.allDay, '', 'the boards are not in: not settled');
    t.ctx.open = false; t.api.renderTodo();
    assert.equal(t.d.allDay, DAY);
    assert.equal(t.d.stamps[DAY], 2);
  });
  it('the team row: /rt/team/me once per entry, false at budget hard; a cheer write marks it', () => {
    assert.match(main, /function askTeamToday\(\) \{\n\s+if \(net\.budgetDown \|\| net\.gateDown\) \{ ui\.setTeamToday\?\.\(false\); return; \}/);
    assert.match(main, /askTeamToday\(\); \/\/ 오늘 할 일/);
    assert.match(main, /const teamToday = \(me\) => \(\{ has: !!me\?\.team, done: !!\(me\?\.team && me\.today && me\.today\.here !== false\) \}\);/);
    assert.match(main, /if \(body\?\.op === 'cheer' && r\?\.ok !== false && r\?\.why && r\.why !== 'wait'\) ui\.setTeamToday\?\.\(\{ has: true, done: true \}\);/);
  });
});

describe('where it shows', () => {
  const rule = (sel) => { const m = css.match(new RegExp('(^|[}\\n])\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}')); assert.ok(m, 'no rule ' + sel); return m[2]; };
  it('the card sits right under the wallet card, above the 9 pm banner and the live board', () => {
    assert.match(ui, /walletEl\.after\(todoEl\);/);
    assert.equal(ui.includes("class: 'stay-quest'"), false);
    assert.equal(css.includes('.stay-quest'), false);
  });
  it('low windows keep the head line and the next row (all done: the foot line); it is never display: none on a desktop at 521-640px', () => {
    const short = css.slice(css.indexOf('@media (max-height: 640px) {'));
    const blk = short.slice(0, short.indexOf('\n  }'));
    assert.match(blk, /html:not\(\.touch\) \.todo-card \.todo-row:not\(\.next\), html:not\(\.touch\) \.todo-card \.todo-foot \{ display: none; \}/);
    assert.match(blk, /html:not\(\.touch\) \.todo-card\.all \.todo-foot \{ display: grid; \}/);
    assert.equal(/\.todo-card \{ display: none/.test(blk), false);
  });
  it('the compact phone HUD hides the card: the goal pill carries it, with a 할 일 tag', () => {
    const box = css.slice(css.indexOf('@media (orientation: portrait) and (max-width: 599px), (orientation: landscape) and (max-height: 520px) {'));
    assert.match(box, /html\.touch \.hud-l > \.todo-card \{ display: none; \}/);
    assert.match(box, /html\.touch \.hud-l > \.nextgoal:not\(\.task\) \.ng-t \{ display: inline-block;[^}]*font-size: 12px;/);
    assert.match(ui, /const pill = !newbieOn && compactNow\(\) \? phonePill\(goalText\) : null;/);
    assert.match(ui, /nextLine\.replaceChildren\(h\('span', \{ class: 'ng-t', text: pill\.tag \}\), document\.createTextNode\(pill\.rest\)\);/);
    assert.match(ui, /else if \(nextLine\.dataset\.pill\) openToday\(\);/);
  });
  it('the pill fits: "할 일 n/N · <the longest next row>" at 12px inside the 320px column with its ellipsis', () => {
    // the column on a 320px phone: min(62vw, 240px) = 198px; the pill keeps nowrap + ellipsis (layout.test.mjs)
    const longest = Math.max(...TODO_MOD.todoList({ team: { has: false } }).map((r) => [...r.name].length));
    assert.ok(longest <= 9, 'the longest row name is short enough to read before the ellipsis');
  });
  it('the sheet rows are 44px; the card rows 24px on a desktop and 32px on a tablet', () => {
    assert.match(rule('.todo-row.big'), /min-height: 44px;/);
    assert.match(css, /html:not\(\.touch\) \.liveboard :is\(\.livehead, button\.rank, button\.f\), html:not\(\.touch\) \.todo-card :is\(\.todo-head, \.todo-row\), html:not\(\.touch\) \.wallet \.nextgoal:not\(\.task\) \{ min-height: 24px; \}/);
    assert.match(css, /html\.touch \.todo-card \.todo-row:not\(\.big\) \{ min-height: 32px; \}/);
    assert.match(rule('.todo-sheet .todo-goal'), /min-height: 44px;/);
  });
  it('newcomer mode keeps its own card first: the to-do card is hidden there and comes back with the rest', () => {
    assert.match(css, /#ui\.newbie \.liveboard, #ui\.newbie \.todo-card,/);
    assert.match(css, /#ui\.reveal \.liveboard, #ui\.reveal \.todo-card,/);
    assert.match(ui, /const pill = !newbieOn &&/);
  });
  it('contrast: the words on the card, the stamps and the pill tag read at 4.5:1', () => {
    const token = (name) => html.match(new RegExp('--' + name + ': (#[0-9a-f]{6});'))[1];
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const over = (fg, a, bg) => '#' + hex(fg).map((c, i) => Math.round(c * a + hex(bg)[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
    const lum = (h) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; const [r, g, b] = hex(h); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const contrast = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    const card = token('surface'), s2 = token('surface-2');
    assert.ok(contrast(token('accent'), card) >= 4.5, 'n / N and the values');
    assert.ok(contrast(token('text-2'), card) >= 4.5, 'a row');
    assert.ok(contrast(token('muted'), card) >= 4.5, 'a done row');
    assert.ok(contrast(token('text'), over(token('accent'), 0.14, card)) >= 4.5, 'the next row');
    assert.ok(contrast(token('muted'), s2) >= 4.5, 'a stamp');
    assert.ok(contrast('#ffd98a', over('#ffb020', 0.16, card)) >= 4.5, 'a pale stamp');
    assert.ok(contrast('#1c1300', '#ffb020') >= 4.5 && contrast('#1c1300', '#ffe08a') >= 4.5, 'a gold stamp');
    assert.ok(contrast(token('accent'), over('#ffb020', 0.2, card)) >= 4.5, 'the pill tag');
    assert.ok(contrast('#1c1300', '#ffcf5a') >= 4.5, 'the street strip tag 완료');
  });
  it('the check pops, and with reduced motion it just changes', () => {
    assert.match(rule('.todo-row.pop .ck'), /animation: todoPop/);
    const rm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {'));
    assert.match(rm, /\.todo-row\.pop \.ck \{ animation: none; \}/);
  });
});
