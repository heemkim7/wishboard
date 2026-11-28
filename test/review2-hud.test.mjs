// The second independent review (2026-11-25) of the keyed notices, 오늘 할 일 and 같이 춤추기: what would hurt a real user, each
// checked by running the rule where that can be done without a browser (the Room's history is in test/plaza.test.mjs).
//   1. the tappable notices are a stack: one hidden under a newer one keeps its time; a recover notice never waits;
//   2. a row's notice names points only when its pay arrived;
//   3. the completion card waits for a board focus, an auto-walk, the intro, a scripted camera; welcome() never ends a walk;
//   5. the entry's team read is a peek (no Supabase, no writes); attendance sends no todo_done;
//   6. a replaced notice keeps its place;  7. a team cheer marks the row only when recorded;  8. the pop plays once;
//   9. the dance's music, the gift maker, the player's own reaction;  10. no to-do notices in newcomer mode;
//  11. the street-screen card on a desktop is framed clear of the left column.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { toastMs, toastText } from '../overlay.js';
import * as TODO_MOD from '../todo.js';
import { BALANCE } from '../balance.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ui = read('ui.js'), main = read('main.js'), world = read('timesSquare3d.js'), teamsrv = read('teamsrv.js');
function body(src, head) {
  const a = src.indexOf(head);
  assert.ok(a >= 0, head);
  const indent = head.match(/^\s*/)[0];
  const b = src.indexOf('\n' + indent + '}', a);
  return src.slice(a, b + indent.length + 2);
}

// ---- note() and its timer helpers, lifted out of ui.js and run against a few fake elements and a fake clock ---------------------
function noteRig() {
  let now = 0, seq = 0;
  const timers = new Map();
  const set = (f, ms) => { const id = ++seq; timers.set(id, { f, at: now + ms }); return id; };
  const clear = (id) => timers.delete(id);
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      timers.delete(next[0]); now = next[1].at; next[1].f();
    }
    now = end;
  };
  const el = (tag, cls = '') => {
    const n = { tag, kids: [], parent: null, text: '', on: {} };
    const s = new Set(cls.split(/\s+/).filter(Boolean));
    n.classList = { add: (k) => s.add(k), remove: (k) => s.delete(k), contains: (k) => s.has(k), toggle: (k, on) => { if (on ?? !s.has(k)) s.add(k); else s.delete(k); } };
    n.append = (...cs) => { for (const c of cs) { if (c && typeof c === 'object') { c.remove?.(); c.parent = n; n.kids.push(c); } else if (typeof c === 'string') n.text += c; } };
    n.insertBefore = (c, ref) => { c.remove?.(); c.parent = n; const i = n.kids.indexOf(ref); n.kids.splice(i < 0 ? n.kids.length : i, 0, c); };
    n.remove = () => { if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = null; };
    n.addEventListener = (t, f) => { (n.on[t] ||= []).push(f); };
    n.click = () => { for (const f of n.on.click || []) f(); };
    Object.defineProperty(n, 'children', { get: () => n.kids });
    Object.defineProperty(n, 'isConnected', { get: () => !!n.parent });
    return n;
  };
  const toasts = el('div', 'toasts');
  toasts.querySelectorAll = () => toasts.kids.filter((k) => k.classList.contains('hit') && !k.classList.contains('out'));
  const h = (tag, props, ...kids) => { const n = el(tag, props?.class || ''); n.append(...kids.filter((k) => k != null)); return n; };
  const toolsEl = el('div', 'tools'), reactPanel = { hidden: true };
  const src = ui.slice(ui.indexOf('  function note('), ui.indexOf('  const newsQueue = []'));
  const api = new Function('h', 'icon', 'toasts', 'toolsEl', 'reactPanel', 'document', 'toastMs', 'toastText', 'setTimeout', 'clearTimeout', 'Date', src + '\nreturn { note, holdToasts };')(
    h, () => null, toasts, toolsEl, reactPanel, { documentElement: { classList: { contains: () => true } } }, toastMs, toastText, set, clear, { now: () => now });
  const live = () => toasts.kids.filter((k) => !k.classList.contains('out'));
  // what the stylesheet shows (index.html: .toast.hit:has(~ .toast.hit) is display: none): the newest plain one and the last tappable one
  const shownHit = () => live().filter((k) => k.classList.contains('hit')).at(-1) || null;
  const shown = () => { const l = live(); return l.filter((t, i) => !l.slice(i + 1).some((u) => u.classList.contains('hit') === t.classList.contains('hit'))); };
  const menu = (open) => { toolsEl.classList.toggle('open', open); api.holdToasts(); };
  return { note: api.note, advance, live, shown, shownHit, menu, toasts };
}
const tap = () => {};
const RECOVER = '로그아웃됐어요 · 다시 로그인';
const GUIDE = '출석 3일 · +15 포인트 · 다음: 전광판 응원 3번';
const DANCE = '곰님이 춤추고 있어요 · 같이 춤추기';

describe('1. the tappable notices are a stack, and a recover notice never waits', () => {
  it('recover, then a guide: the recover one stays on top and its clock runs; the guide waits under it with its whole time', () => {
    const r = noteRig();
    const login = r.note(RECOVER, '', tap, { recover: true });
    r.advance(3000);
    const guide = r.note(GUIDE, 'ok', tap, { key: 'todo' });
    assert.equal(r.shownHit(), login, 'the attendance line does not cover the re-login');
    const left = toastMs(RECOVER, true) - 3000;
    r.advance(left - 100);
    assert.ok(!login.classList.contains('out'), 'it has the rest of its own time');
    assert.ok(guide.isConnected && !guide.classList.contains('out'), 'the guide waited');
    r.advance(100); // exactly its end: login goes out now and the guide's clock starts
    assert.ok(login.classList.contains('out'), 'and it goes when its time is up');
    assert.equal(r.shownHit(), guide);
    const full = toastMs(GUIDE, true);
    r.advance(full - 100);
    assert.ok(!guide.classList.contains('out'), 'the guide got its whole time after');
    r.advance(200);
    assert.ok(guide.classList.contains('out'));
  });
  it('a guide, then a recover one: the recover one is on top; the guide keeps the rest of its time (at least 4 s) for after', () => {
    const r = noteRig();
    const guide = r.note(GUIDE, 'ok', tap, { key: 'todo' });
    const full = toastMs(GUIDE, true);
    r.advance(2000);
    const retry = r.note('연결 보상 100포인트를 지금은 넣지 못했어요. 잠시 뒤에 눌러서 다시 받아 주세요.', 'err', tap, { recover: true });
    assert.equal(r.shownHit(), retry);
    r.advance(toastMs(retry.kSay, true) + 400); // the retry runs out in its own time; the guide waited all along
    assert.equal(retry.isConnected, false);
    assert.equal(r.shownHit(), guide);
    assert.ok(!guide.classList.contains('out'));
    r.advance(full - 2000 - 400 - 100); // it came back when the retry went out (400 ms ago)
    assert.ok(!guide.classList.contains('out'), 'the rest of its time: full - 2 s');
    r.advance(200);
    assert.ok(guide.classList.contains('out'));
  });
  it('a guide with 1 s left under a newer one comes back for at least 4 s, as after a menu', () => {
    const r = noteRig();
    const guide = r.note(GUIDE, 'ok', tap, { key: 'todo' });
    r.advance(toastMs(GUIDE, true) - 1000);
    const dance = r.note(DANCE, 'ok', tap, { key: 'dance-near' });
    r.advance(toastMs(DANCE, true) + 400);
    assert.equal(dance.isConnected, false);
    assert.equal(r.shownHit(), guide);
    r.advance(3400); // 3.8 s since it came back
    assert.ok(!guide.classList.contains('out'));
    r.advance(400);
    assert.ok(guide.classList.contains('out'));
  });
  it('a guide, then a guide: the same key replaces it (one row); different keys stack, the newer on top, the older paused', () => {
    const r = noteRig();
    const a = r.note(GUIDE, 'ok', tap, { key: 'todo' });
    const b = r.note('✓ 전광판 응원 3번 · 다음: 소원 한 줄 걸기', 'ok', tap, { key: 'todo' });
    assert.equal(a.isConnected, false);
    assert.deepEqual(r.live(), [b]);
    r.advance(1000);
    const d = r.note(DANCE, 'ok', tap, { key: 'dance-near' });
    assert.deepEqual(r.live(), [b, d]);
    assert.equal(r.shownHit(), d);
    r.advance(toastMs(DANCE, true) + 400);
    assert.equal(d.isConnected, false, 'the invite ran out in its own time');
    assert.ok(b.isConnected && !b.classList.contains('out'), 'the row notice under it did not');
    r.advance(toastMs(b.kSay, true) - 1000 - 400 - 100);
    assert.ok(!b.classList.contains('out'));
    r.advance(200);
    assert.ok(b.classList.contains('out'));
  });
  it('the recover option is on the notices that ask to put things right; the guides carry none', () => {
    assert.match(main, /'err', \(\) => claimLinkReward\(user, held\), \{ recover: true \}\);/);
    assert.match(main, /ui\.note\(mailSaid, ARRIVED\.failed \? 'err' : 'ok', \(\) => ui\.openLogin\?\.\(\), \{ recover: true \}\);/);
    assert.match(main, /ui\.note\('로그아웃됐어요 · 다시 로그인', '', \(\) => ui\.openLogin\?\.\(\), \{ recover: true \}\);/);
    assert.match(ui, /note\(text, kind, \(\) => openLogin\(\), \{ recover: true \}\);/);
    assert.equal(/\{ key: '(todo|dance-near)', recover/.test(ui), false);
  });
  it('a plain notice has nothing to do with the stack', () => {
    const r = noteRig();
    const login = r.note(RECOVER, '', tap, { recover: true });
    const plain = r.note('🙌 하이파이브!', 'ok');
    assert.deepEqual(r.shown(), [login, plain]);
  });
  it('tapping the top one brings the one under it back', () => {
    const r = noteRig();
    const g = r.note(GUIDE, 'ok', tap, { key: 'todo' });
    const d = r.note(DANCE, 'ok', tap, { key: 'dance-near' });
    r.advance(5000);
    d.click();
    assert.equal(r.shownHit(), g);
    r.advance(toastMs(GUIDE, true) - 100);
    assert.ok(!g.classList.contains('out'));
  });
  it('a menu over a stack still pauses the top one and it gets its rest after', () => {
    const r = noteRig();
    const g = r.note(GUIDE, 'ok', tap, { key: 'todo' });
    const login = r.note(RECOVER, '', tap, { recover: true });
    r.menu(true);
    r.advance(60000);
    assert.ok(login.isConnected && g.isConnected);
    r.menu(false);
    assert.equal(r.shownHit(), login);
  });
});

describe('6. a notice replaced by one with the same key keeps its place', () => {
  it('on a desktop window (time order) the row does not jump to the end of the stack', () => {
    const r = noteRig();
    r.note('다음 응원까지 9초', '', null, { key: 'cheer-wait' });
    r.note('공유 링크를 복사했어요', 'ok', null, { key: 'copied' });
    const again = r.note('다음 응원까지 7초', '', null, { key: 'cheer-wait' });
    assert.deepEqual(r.live().map((t) => t.text), ['다음 응원까지 7초', '공유 링크를 복사했어요']);
    assert.ok(again.classList.contains('again'));
  });
  it('a tappable one keeps its place in the stack too (under the newer one it was under)', () => {
    const r = noteRig();
    r.note(GUIDE, 'ok', tap, { key: 'todo' });
    const d = r.note(DANCE, 'ok', tap, { key: 'dance-near' });
    const g2 = r.note('✓ 소원 한 줄 걸기 · 다음: 소원에 하트 1개', 'ok', tap, { key: 'todo' });
    assert.deepEqual(r.live(), [g2, d]);
  });
});

// ---- ui.js's 오늘 할 일 block, run with stubs (as test/todo-ui.test.mjs does) -----------------------------------------------------
const DAY = '2026-11-25';
const plain = (v) => JSON.parse(JSON.stringify(v));
function harness({ daily = {}, wish = { known: true, mine: null, given: [], busy: false }, newbie = false } = {}) {
  const a = ui.indexOf('  let teamToday = null'), b = ui.indexOf("  addEventListener('storage'");
  assert.ok(a > 0 && b > a, 'the 오늘 할 일 block');
  const calls = [];
  const node = () => { const n = { kids: [], cls: new Set(), replaceChildren(...k) { n.kids = k; }, classList: { toggle(c, on) { if (on) n.cls.add(c); else n.cls.delete(c); }, contains: (c) => n.cls.has(c) } }; return n; };
  let d = { day: DAY, streak: 3, last: DAY, cheer: 0, wish: 0, heart: 0, paid: {}, qPaid: {}, got: {}, stamps: {}, allDay: '', cardDay: '', gw: '', gs: null, ...daily };
  let now = 1000;
  const bodyCls = new Set(), rootCls = new Set(newbie ? ['newbie'] : []);
  const rows = [];
  const ctx = {
    ...TODO_MOD, BALANCE,
    h: (tag, props) => { const n = node(); n.props = props || {}; if (String(props?.class || '').startsWith('todo-row')) rows.push(n); return n; }, icon: () => null,
    performance: { now: () => now },
    document: { body: { classList: { contains: (c) => bodyCls.has(c) } } },
    root: { classList: { contains: (c) => rootCls.has(c) } },
    wishView: wish,
    today: () => d, saveDay: (x) => { d = x; },
    note: (text, kind, tapFn, o) => calls.push(['note', text, kind, typeof tapFn, o?.key || '']),
    sfx: { todo: () => calls.push(['sfx', 'todo']), todoAll: () => calls.push(['sfx', 'all']) },
    trackEvent: (n, p) => calls.push(['event', n, p]),
    hooks: { nick: () => '민지', todoCard: (c) => { calls.push(['card', c]); return true; } },
    open: true, cheerSignal: () => ctx.open, // ui.js cheerSignal (test/todo-ui.test.mjs covers false and null)
    guideQuest: () => {}, openToday: () => {}, renderGoal: () => {},
  };
  runInNewContext(`let entered = true, driving = false, baking = null, sheets = [], ext = null; const proof = { hidden: true };\n${ui.slice(a, b)}\nthis.api = { renderTodo, attendPaid, setTeamToday, pumpTodoCard, todoPaid: typeof todoPaid === 'function' ? todoPaid : () => renderTodo(), todoQuestSent: typeof todoQuestSent === 'function' ? todoQuestSent : () => {} };`, ctx);
  return {
    api: ctx.api, ctx, calls, rows, bodyCls, rootCls,
    get d() { return d; },
    clear() { calls.length = 0; rows.length = 0; },
    tick(ms = 2500) { now += ms; },
    notes: () => plain(calls.filter((c) => c[0] === 'note').map((c) => c[1])),
    events: () => plain(calls.filter((c) => c[0] === 'event').map((c) => [c[1], c[2]])),
    cards: () => calls.filter((c) => c[0] === 'card'),
  };
}

describe('2. a row\'s notice names points only when its pay arrived, with the amount that arrived', () => {
  it('the third cheer: the notice waits for the quest pay and says what arrived (15 on the first cheer + 30 now)', () => {
    const t = harness({ daily: { cheer: 2, wish: 1, paid: { cheer: 1, wish: 1 }, got: { cheer: 15, wish: 15 } } });
    t.api.setTeamToday(false);
    t.clear();
    t.api.todoQuestSent(); t.d.cheer = 3; t.api.renderTodo();
    assert.deepEqual(t.notes(), [], 'nothing yet: the pay has not come');
    t.d.qPaid.cheer = 1; t.api.todoPaid('cheer', 30);
    assert.deepEqual(t.notes(), ['✓ 전광판 응원 3번 · +45 포인트 · 다음: 소원에 하트 1개']);
    t.tick(20000); t.api.renderTodo();
    assert.equal(t.notes().length, 1, 'one keyed notice per row, not a second one');
  });
  it('the Room refuses the quest (already paid on another device): after the wait it reads without points', () => {
    const t = harness({ daily: { cheer: 2, wish: 1, paid: { wish: 1 }, got: { wish: 15 } } });
    t.api.setTeamToday(false);
    t.clear();
    t.api.todoQuestSent(); t.d.cheer = 3; t.api.renderTodo();
    t.tick(5000); t.api.renderTodo();
    assert.deepEqual(t.notes(), []);
    t.tick(6000); t.api.renderTodo();
    assert.deepEqual(t.notes(), ['✓ 전광판 응원 3번 · 다음: 소원에 하트 1개']);
  });
  it('offline (the claim was not sent): right away, without points', () => {
    const t = harness({ daily: { cheer: 2, wish: 1 } });
    t.api.setTeamToday(false);
    t.clear();
    t.d.cheer = 3; t.api.renderTodo();
    assert.deepEqual(t.notes(), ['✓ 전광판 응원 3번 · 다음: 소원에 하트 1개']);
  });
  it('a wish posted here: the notice comes with the mission pay that arrived (markDaily), with its amount', () => {
    const t = harness({ daily: { cheer: 3, qPaid: { cheer: 1 } } });
    t.api.setTeamToday(false);
    t.clear();
    t.d.wish = 1; t.api.renderTodo();
    assert.deepEqual(t.notes(), []);
    t.d.paid.wish = 1; t.api.todoPaid('wish', 15);
    assert.deepEqual(t.notes(), ['✓ 소원 한 줄 걸기 · +15 포인트 · 다음: 소원에 하트 1개']);
  });
  it('the mission pay gave up (payDue marks it paid with nothing): without points', () => {
    const t = harness({ daily: { cheer: 3, qPaid: { cheer: 1 } } });
    t.api.setTeamToday(false);
    t.clear();
    t.d.wish = 1; t.api.renderTodo();
    t.d.paid.wish = 1; t.tick(1000); t.api.renderTodo();
    assert.deepEqual(t.notes(), ['✓ 소원 한 줄 걸기 · 다음: 소원에 하트 1개']);
  });
  it('a wish known from the server only (posted on another device, seen open first): no pay is coming, no points', () => {
    const t = harness({ daily: { cheer: 3, qPaid: { cheer: 1 } } });
    t.api.setTeamToday(false);
    t.clear();
    t.ctx.wishView.mine = { id: 'w' }; t.api.renderTodo();
    assert.deepEqual(t.notes(), ['✓ 소원 한 줄 걸기 · 다음: 소원에 하트 1개']);
  });
  it('the team row has no points; the attendance pay names what arrived', () => {
    const t = harness({ daily: { cheer: 3, wish: 1, paid: { wish: 1 }, qPaid: { cheer: 1 } } });
    t.api.setTeamToday({ has: true, done: false });
    t.clear();
    t.api.setTeamToday({ has: true, done: true });
    assert.deepEqual(t.notes(), ['✓ 우리 팀 응원하기 · 다음: 소원에 하트 1개']);
    t.clear();
    t.api.attendPaid(3, 15);
    assert.deepEqual(t.notes(), ['출석 3일 · +15 포인트 · 다음: 소원에 하트 1개']);
  });
  it('the words: todo.js itemNote takes the points that arrived, not the row\'s nominal value', () => {
    const l = TODO_MOD.todoList({ cheer: 3, wish: false, heart: false });
    assert.equal(TODO_MOD.itemNote(l[1], l[2], 45), '✓ 전광판 응원 3번 · +45 포인트 · 다음: 소원 한 줄 걸기');
    assert.equal(TODO_MOD.itemNote(l[1], l[2]), '✓ 전광판 응원 3번 · 다음: 소원 한 줄 걸기');
    assert.equal(TODO_MOD.itemNote(l[1], l[2], 0), '✓ 전광판 응원 3번 · 다음: 소원 한 줄 걸기');
  });
  it('the pays hand their amount in: markDaily, markQuest (main.js passes got), and the third cheer is claimed before the list repaints', () => {
    assert.match(main, /if \(m\?\.kind === 'quest' && got\) ui\.markQuest\?\.\(m\.key, got\);/);
    const md = body(ui, '  function markDaily(amount) {');
    assert.match(md, /todoPaid\(key, amount\)/);
    const qb = body(ui, '  function questBump(key) {');
    assert.ok(qb.indexOf('hooks.claimQuest') < qb.indexOf('renderTodo()'), 'claim first, so the row knows a pay is coming');
    // a heart and a wish are counted (kts_daily) before the list sees them in the wish state, so their row waits for the pay
    const hw = body(main, 'async function heartWish(id) {');
    assert.ok(hw.indexOf("ui.mission?.('heart')") < hw.indexOf('paintWish()'));
    const pw = body(main, 'async function postWish(text) {');
    assert.ok(pw.indexOf("ui.mission?.('wish')") < pw.indexOf('state.wish.mine = mine'));
  });
});

describe('5. attendance sends no todo_done', () => {
  it('attendPaid says its line and sends no event (the server knows the attendance already)', () => {
    const t = harness({ daily: { cheer: 3, wish: 1 } });
    t.api.setTeamToday(false);
    t.clear();
    t.api.attendPaid(3, 15);
    assert.deepEqual(t.events(), []);
  });
});

describe('8. the check pops once', () => {
  it('the finished row pops on the paint that shows it done, and a later repaint does not replay it', () => {
    const t = harness({ daily: { cheer: 3, qPaid: { cheer: 1 } } });
    t.api.setTeamToday(false);
    t.clear();
    t.ctx.wishView.mine = { id: 'w' }; t.api.renderTodo();
    assert.equal(t.rows.filter((n) => / pop/.test(n.props.class)).length, 1, 'it popped');
    t.clear();
    t.api.setTeamToday({ has: true, done: false }); // the team row comes in: the card repaints, nothing was just finished
    assert.ok(t.rows.length > 0, 'the card was repainted');
    assert.equal(t.rows.filter((n) => / pop/.test(n.props.class)).length, 0, 'the old pop is not played again');
    t.clear();
    t.ctx.wishView.given = ['x']; t.api.renderTodo();
    assert.equal(t.rows.filter((n) => / pop/.test(n.props.class)).length, 1, 'the next finished row pops');
    assert.ok(t.rows.find((n) => / pop/.test(n.props.class)).props['aria-label'].startsWith('소원에 하트'));
  });
});

describe('10. newcomer mode: no to-do notices (the stamps and counters still update)', () => {
  it('a row, the attendance and the whole list say nothing while #ui.newbie is on', () => {
    const t = harness({ daily: { cheer: 2, wish: 1 }, newbie: true });
    t.api.setTeamToday(false);
    t.clear();
    t.d.cheer = 3; t.api.renderTodo();
    t.api.attendPaid(3, 15);
    t.d.heart = 1; t.api.renderTodo();
    assert.deepEqual(t.notes(), []);
    assert.deepEqual(t.calls.filter((c) => c[0] === 'sfx'), []);
    assert.equal(t.d.stamps[DAY], 2, 'the stamp still turns gold');
    assert.equal(t.d.allDay, DAY);
  });
});

describe('3. the completion card waits while the player is busy', () => {
  const all = (t) => { t.api.setTeamToday(false); t.clear(); t.d.heart = 1; t.api.renderTodo(); };
  for (const [what, set, unset] of [
    ['a board focus or the photo frame (#ui.focusing)', (t) => t.rootCls.add('focusing'), (t) => t.rootCls.delete('focusing')],
    ['an auto-walk', (t) => { t.ctx.hooks.autoWalking = () => true; }, (t) => { t.ctx.hooks.autoWalking = () => false; }],
    ['the entry intro', (t) => { t.ctx.hooks.introOn = () => true; }, (t) => { t.ctx.hooks.introOn = () => false; }],
    ['a scripted camera (a tour, a focus link)', (t) => { t.ctx.hooks.cineOn = () => true; }, (t) => { t.ctx.hooks.cineOn = () => false; }],
  ]) {
    it(`it waits out ${what} and comes when it ends, the same day`, () => {
      const t = harness({ daily: { cheer: 3, wish: 1, qPaid: { cheer: 1 }, paid: { wish: 1 } } });
      set(t);
      all(t);
      assert.equal(t.cards().length, 0);
      t.tick(); t.api.pumpTodoCard();
      assert.equal(t.cards().length, 0, 'still held');
      unset(t); t.tick(); t.api.pumpTodoCard();
      assert.equal(t.cards().length, 1);
    });
  }
  it('todo.js momentHold knows the new holds', () => {
    for (const k of ['focus', 'walk', 'intro', 'cine']) assert.equal(TODO_MOD.momentHold({ [k]: true }), true, k);
  });
  it('the hooks exist: main.js asks the world for its walk and camera, and knows when the intro is over', () => {
    assert.match(main, /autoWalking: \(\) => !!world\?\.autoWalking\?\.\(\),/);
    assert.match(main, /introOn: \(\) => !introOver,/);
    assert.match(world, /autoWalking: \(\) => !!autoWalk,/);
  });
  it('welcome() treats an auto-walk as walking: no camera, so focusSlot does not end the walk', () => {
    const fn = body(world, '  function welcome(');
    assert.match(fn, /const walking = !!autoWalk \|\| cineCancels\(/);
    assert.match(fn, /if \(slot && cam && !drive && !walking && focusSlot\(/);
  });
});

describe('5. the entry\'s team read is a peek', () => {
  it('askTeamToday reads /rt/team/me?peek=1; the sheet (teamMe with no argument) reads as before', () => {
    const fn = body(main, 'function askTeamToday() {');
    assert.match(fn, /teamMe\(true\)/);
    assert.match(main, /async function teamMe\(peek = false\) \{\n\s+const me = await net\.teamGet\(peek \? '\/rt\/team\/me\?peek=1' : '\/rt\/team\/me'\);/);
  });
  it('the Worker\'s peek never brings an old 소속 and never stores a reply that skipped it', () => {
    const route = teamsrv.slice(teamsrv.indexOf("  if (p === '/rt/team/me') {"), teamsrv.indexOf('  // GET /rt/team?id=<id>'));
    assert.match(route, /const peek = u\.searchParams\.get\('peek'\) === '1';/);
    assert.match(route, /const bring = !v\.team && !v\.looked && !actor\.guest && k\.myTribe;/);
    assert.match(route, /if \(!peek && bring\) \{/);
    assert.match(route, /return J\(peek && bring \? out : keep\(ME, actor\.id, out\)\);/);
  });
});

describe('7. a team cheer marks the row only when it was recorded', () => {
  it('why wait (nothing recorded) leaves the row open', () => {
    assert.match(main, /if \(body\?\.op === 'cheer' && r\?\.ok !== false && r\?\.why && r\.why !== 'wait'\) ui\.setTeamToday\?\.\(\{ has: true, done: true \}\);/);
  });
});

describe('9. 같이 춤추기', () => {
  it('danceSong is set only when bgm.over took, and the tick tries again while it has not', () => {
    const fn = body(ui, '  function danceMusic(r) {');
    assert.match(fn, /if \(bgm\.over\(r\.id, r\.posMs \/ 1000\)\) danceSong = r\.id;/);
    const tick = body(ui, '  function tickDance(now, force) {');
    assert.match(tick, /else if \(danceSong !== r\.id\) danceMusic\(r\);/);
  });
  it('a layer (the gift maker) ends the dance and blocks its start, as a sheet does', () => {
    assert.match(ui, /    layer\(el, close\) \{ if \(el && dance\) endDance\('layer'\); layer\(el, close\); \},/);
    assert.match(body(ui, "  function startDance(kind = 'panel') {"), /if \(sheet \|\| ext \|\| baking \|\| driving\) return false;/);
  });
  it('the automatic re-send never eats the player\'s own reaction: it does not take the emote cooldown, it waits for it', () => {
    const send = body(world, '  function sendDance(now) {');
    assert.match(send, /if \(!resendDue\(now, danceSentAt, lastEmote, EMOTE_GAP_MS\)\) return;/);
    assert.equal(/lastEmote = /.test(send), false);
  });
});

describe('11. the street-screen card on a desktop window is framed clear of the HUD columns', () => {
  // The desktop HUD (index.html): the left column is 14 + 340 px; the minimap column is 184 px + 14 from the right edge. ui.js freeView adds 8 px.
  const COL_L = 14 + 340, COL_R = 14 + 184;
  const frameFor = ({ w, h, W, H, yaw = 0, rise = 0, vfov = 55 }) => {
    // the board camera's own frame (camrig.js frameDistance, margin 0.08): the whole face in the whole window
    const t = Math.tan((vfov * Math.PI) / 360), keep = 1 - 2 * 0.08;
    const dist = Math.max(w / (W / H), h) / (2 * t * keep);
    const c = { x: 0, y: 8, z: 0 }, right = { x: 1, y: 0, z: 0 }, up = { x: 0, y: 1, z: 0 };
    const cam = { x: Math.sin(yaw) * dist, y: 8 - rise, z: Math.cos(yaw) * dist };
    return { cam, look: { ...c }, face: { c, right, up, w, h }, vfov, W, H };
  };
  for (const [W, H] of [[1280, 760], [1440, 900]]) {
    for (const [what, o] of [['a 16:9 screen straight on', { w: 12, h: 6.75 }], ['a 2:1 screen', { w: 10, h: 5 }], ['seen 30° off its normal, from below', { w: 12, h: 6.75, yaw: 0.52, rise: 3 }]]) {
      it(`${W}×${H}, ${what}: the four corners fall right of the left column and left of the minimap column`, async () => {
        const { freeFrame, projectPx, faceCorners } = await import('../ts3d/freeframe.js');
        const f = frameFor({ ...o, W, H });
        const before = faceCorners(f.face).map((p) => projectPx(p, f.cam, f.look, f.vfov, W, H));
        assert.ok(before.some((s) => s.x < COL_L), 'the full-window frame put the card under the column (the finding)');
        const inside = (ff) => {
          for (const p of faceCorners(f.face)) {
            const s = projectPx(p, ff.cam, ff.look, ff.fov, W, H);
            assert.ok(s.x >= COL_L && s.x <= W - COL_R, `x ${s.x.toFixed(0)} in [${COL_L}, ${W - COL_R}]`);
            assert.ok(s.y >= 0 && s.y <= H, `y ${s.y.toFixed(0)}`);
          }
        };
        // a step back along the camera's own line to the face (the world's sees() says the spot still sees it), the lens unchanged
        const dist0 = Math.hypot(f.cam.x - f.face.c.x, f.cam.y - f.face.c.y, f.cam.z - f.face.c.z);
        const ff = freeFrame({ ...f, left: COL_L + 8, right: COL_R + 8, sees: () => true });
        assert.ok(ff, 'a frame was found');
        assert.equal(ff.fov, f.vfov, 'the lens is the board camera\'s');
        const k = Math.hypot(ff.cam.x - f.face.c.x, ff.cam.y - f.face.c.y, ff.cam.z - f.face.c.z) / dist0;
        assert.ok(k > 1 && k <= 2.2, 'stepped back ' + k.toFixed(2));
        assert.equal(ff.look.y, f.look.y, 'only turned about the vertical axis: the face keeps its height in the frame');
        inside(ff);
      });
    }
  }
  it('where a step back would not see the face it stops there and opens the lens a little; with no room at all the frame is kept (null)', async () => {
    const { freeFrame, projectPx, faceCorners } = await import('../ts3d/freeframe.js');
    const f = frameFor({ w: 12, h: 6.75, W: 1440, H: 900 });
    const dist0 = Math.hypot(f.cam.x, f.cam.y - 8, f.cam.z);
    const ff = freeFrame({ ...f, left: COL_L + 8, right: COL_R + 8, sees: (p) => Math.hypot(p.x, p.y - 8, p.z) <= dist0 * 1.3 + 1e-6 });
    assert.ok(ff);
    assert.ok(Math.hypot(ff.cam.x, ff.cam.y - 8, ff.cam.z) <= dist0 * 1.3 + 1e-6, 'not past the last spot that sees');
    assert.ok(ff.fov > f.vfov && ff.fov <= f.vfov + 20, 'the lens opened ' + (ff.fov - f.vfov) + '°');
    for (const p of faceCorners(f.face)) { const s = projectPx(p, ff.cam, ff.look, ff.fov, 1440, 900); assert.ok(s.x >= COL_L && s.x <= 1440 - COL_R); }
    assert.equal(freeFrame({ ...frameFor({ w: 12, h: 6.75, W: 1280, H: 760 }), left: COL_L + 8, right: COL_R + 8, sees: () => false }), null);
  });
  it('the world checks the spot: a clear line to the face (nyc.rayBlock) and above the ground', () => {
    const fn = body(world, '  function freeFit(pose) {');
    assert.match(fn, /nyc\.rayBlock\(p\.x, p\.y, p\.z, f\.pos\.x, f\.pos\.y, f\.pos\.z\) >= 0\.97/);
    assert.match(fn, /p\.y >= groundHeight\(p\.x, p\.z\) \+ 1\.2/);
    assert.match(fn, /pose\.cam\.set\(ff\.cam\.x, ff\.cam\.y, ff\.cam\.z\);/);
  });
  it('the world uses it for the card only, on a desktop window: welcome asks focusSlot for free; ui.js freeView is null on touch', () => {
    assert.match(world, /focusSlot\(slot, \{ hold: 3500, celebrate: false, free: true \}\)/);
    assert.match(world, /if \(holdMsOrOpts\?\.free\) freeFit\(pose\);/);
    assert.match(body(ui, '    freeView() {'), /if \(document\.documentElement\.classList\.contains\('touch'\)\) return null;/);
    assert.match(main, /freeView: \(\) => ui\.freeView\?\.\(\) \|\| null,/);
  });
});
