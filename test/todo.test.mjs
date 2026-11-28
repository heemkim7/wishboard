// 오늘 할 일: the pure rules (todo.js). The screens are in test/todo-ui.test.mjs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TODO, TODO_TEXT, dayAdd, weekStart, todoList, todoSettled, todoProgress, todoNext, todoSnap, todoDiff, allDue, momentHold,
  itemNote, allNote, attendNote, footLine, cardText, pillPlan, keepStamps, markStamp, stampRow, stampName, giftSeen, giftDone, todoKeep,
} from '../todo.js';

const base = { attendPts: 12, cheer: 0, cheerDone: false, wish: false, heart: false };
const ids = (list) => list.map((r) => r.id);

describe('the list', () => {
  it('has attend, cheer, wish, heart and team in that order, team only when teams are usable', () => {
    assert.deepEqual(ids(todoList({ ...base, team: { has: true, done: false } })), ['attend', 'cheer', 'wish', 'heart', 'team']);
    assert.deepEqual(ids(todoList({ ...base, team: false })), ['attend', 'cheer', 'wish', 'heart'], 'off or not answered: N is 4');
    assert.deepEqual(ids(todoList({ ...base, team: null })), ['attend', 'cheer', 'wish', 'heart'], 'still deciding: not in the list yet');
    assert.equal(todoProgress(todoList({ ...base, team: false })).N, 4);
    assert.equal(todoProgress(todoList({ ...base, team: { has: false, done: false } })).N, 5);
  });
  it('labels and right-hand values are the spec table', () => {
    const l = todoList({ ...base, team: { has: true, done: false } });
    assert.deepEqual(l.map((r) => [r.label, r.value]), [
      ['출석', '+12'], ['전광판 응원 3번', '+45'], ['소원 한 줄 걸기', '+15'], ['소원에 하트 1개', '+15'], ['우리 팀 응원하기', '팀 기록'],
    ]);
    assert.equal(todoList({ ...base, team: { has: false, done: false } })[4].label, '응원 팀 고르기');
    assert.equal(TODO.cheerPts, 15 + 30, 'the first cheer pays 15 (BONUS mission), the third 30 (QUEST cheer): nothing new');
  });
  it('attendance is done on arrival; the cheer row counts up to three and is done at three or by the server', () => {
    const l = todoList({ ...base, team: false });
    assert.equal(l[0].done, true);
    assert.equal(l[1].done, false);
    assert.equal(l[1].label, '전광판 응원 3번', 'no (0/3) before the first cheer');
    assert.equal(todoList({ ...base, cheer: 2, team: false })[1].label, '전광판 응원 3번 (2/3)');
    assert.equal(todoList({ ...base, cheer: 3, team: false })[1].done, true);
    assert.equal(todoList({ ...base, cheer: 9, team: false })[1].label, '전광판 응원 3번');
    assert.equal(todoList({ ...base, cheer: 1, cheerDone: true, team: false })[1].done, true, 'the server said qc');
  });
  it('the team row is done only for my team\'s cheer on record', () => {
    assert.equal(todoList({ ...base, team: { has: true, done: true } })[4].done, true);
    assert.equal(todoList({ ...base, team: { has: false, done: true } })[4].done, false, 'no team: there is a team to pick first');
    assert.equal(todoList({ ...base, team: { has: true, done: true } })[4].pts, 0);
  });
  it('wish and heart are unknown until told', () => {
    const l = todoList({ ...base, wish: null, heart: null, team: false });
    assert.deepEqual([l[2].known, l[3].known], [false, false]);
    assert.equal(todoSettled({ ...base, wish: null, heart: false, team: false }), false);
    assert.equal(todoSettled({ ...base, team: null }), false, 'team still deciding');
    assert.equal(todoSettled({ ...base, team: false }), true);
  });
  it('progress and the next row', () => {
    const l = todoList({ ...base, cheer: 3, wish: true, team: { has: true, done: false } });
    assert.deepEqual(todoProgress(l), { n: 3, N: 5, all: false, frac: 0.6 });
    assert.equal(todoNext(l).id, 'heart');
    const all = todoList({ ...base, cheer: 3, wish: true, heart: true, team: { has: true, done: true } });
    assert.equal(todoProgress(all).all, true);
    assert.equal(todoNext(all), null);
    assert.equal(todoProgress([]).all, false);
  });
});

// worker.js Room.cheer counts only a lit board held by someone else ('dark' otherwise): with none in the plaza the cheer row waits.
describe('the cheer row with nothing to cheer (cheerOpen false)', () => {
  const wait = { ...base, cheerOpen: false, team: false };
  it('stays on the list with its pays and says why, but is not counted, never next and not known', () => {
    const l = todoList(wait), r = l[1];
    assert.deepEqual(ids(l), ['attend', 'cheer', 'wish', 'heart']);
    assert.deepEqual([r.wait, r.why, r.value, r.pts, r.done, r.known], [true, TODO_TEXT.cheerWait, '+45', TODO.cheerPts, false, false]);
    assert.equal(TODO_TEXT.cheerWait, '지금은 응원할 전광판이 없어요');
    assert.deepEqual(todoProgress(l), { n: 1, N: 3, all: false, frac: 1 / 3 });
    assert.equal(todoNext(l).id, 'wish');
    assert.equal(todoSnap(l).cheer, null, 'no notice can come from a waiting row');
    assert.equal(todoList({ ...wait, cheer: 2 })[1].label, '전광판 응원 3번 (2/3)', 'cheers already landed today still show');
  });
  it('does not block all done; a row already done stays done and counted', () => {
    const l = todoList({ ...wait, wish: true, heart: true });
    assert.deepEqual(todoProgress(l), { n: 3, N: 3, all: true, frac: 1 });
    assert.equal(todoNext(l), null);
    const done = todoList({ ...wait, cheer: 3 })[1];
    assert.deepEqual([done.done, done.wait, done.known], [true, undefined, true]);
    assert.equal(todoProgress(todoList({ ...wait, cheerDone: true })).N, 4);
  });
  it('comes back when a board lights up (cheerOpen true or left out) and waits for the boards (null) before all done', () => {
    for (const cheerOpen of [true, undefined, null]) {
      const r = todoList({ ...base, cheerOpen, team: false })[1];
      assert.deepEqual([r.wait, r.known], [undefined, true], String(cheerOpen));
    }
    assert.equal(todoSettled({ ...base, team: false, cheerOpen: null }), false, 'the boards are not in yet');
    assert.equal(todoSettled({ ...base, team: false, cheerOpen: false }), true);
    assert.equal(todoSettled({ ...base, team: false }), true, 'left out: as before');
  });
  it('the phone pill never points at it', () => {
    const goal = '다음 목표: 응원 팀과 함께 명당에 이름 걸기';
    assert.equal(pillPlan({ known: true, held: 1, goal, list: todoList(wait) }).text, '할 일 1/3 · 소원 한 줄 걸기');
    const rest = todoList({ ...wait, wish: true, heart: true });
    assert.equal(pillPlan({ known: true, held: 1, goal, list: rest, doneHere: true, streak: 2 }).text, '오늘 할 일 완료 · 출석 2일');
    assert.equal(pillPlan({ known: true, held: 1, goal, list: rest }).text, goal);
    assert.equal(itemNote(todoList(wait)[2], todoNext(todoList({ ...wait, wish: true }))), '✓ 소원 한 줄 걸기 · 다음: 소원에 하트 1개');
  });
});

describe('what changed', () => {
  it('a row seen open and now done is new; a row that came in done says nothing', () => {
    const a = todoSnap(todoList({ ...base, wish: null, heart: false, team: null }));
    const b = todoSnap(todoList({ ...base, cheer: 3, wish: true, heart: false, team: { has: true, done: true } }));
    assert.deepEqual(todoDiff(a, b), ['cheer'], 'wish was unknown and team was not in the list');
    const c = todoSnap(todoList({ ...base, cheer: 3, wish: true, heart: true, team: { has: true, done: true } }));
    assert.deepEqual(todoDiff(b, c), ['heart']);
    assert.deepEqual(todoDiff(c, c), []);
  });
  it('the whole-list moment: once a day, only with every signal in and a row seen open in this session', () => {
    const list = todoList({ ...base, cheer: 3, wish: true, heart: true, team: false });
    const day = '2026-11-25';
    assert.equal(allDue({ list, settled: true, day, allDay: '', sawOpen: true }), true);
    assert.equal(allDue({ list, settled: true, day, allDay: day, sawOpen: true }), false, 'once per day');
    assert.equal(allDue({ list, settled: true, day, allDay: '2026-11-24', sawOpen: true }), true, 'yesterday does not count');
    assert.equal(allDue({ list, settled: false, day, allDay: '', sawOpen: true }), false, 'the team still deciding');
    assert.equal(allDue({ list, settled: true, day, allDay: '', sawOpen: false }), false, 'all done on arrival');
    assert.equal(allDue({ list: todoList({ ...base, team: false }), settled: true, day, sawOpen: true }), false);
  });
  it('a new day starts over: yesterday\'s rows are not today\'s', () => {
    const kept = todoKeep({ allDay: '2026-11-24', cardDay: '2026-11-24', stamps: { '2026-11-24': 2 }, gw: '2026-11-23', gs: ['abcd1234'] }, '2026-11-25');
    assert.deepEqual(kept, { stamps: { '2026-11-24': 2 }, allDay: '', cardDay: '', gw: '2026-11-23', gs: ['abcd1234'] });
    assert.deepEqual(todoKeep(null, '2026-11-25'), { stamps: {}, allDay: '', cardDay: '', gw: '', gs: null });
    assert.deepEqual(todoKeep({ allDay: '2026-11-25', cardDay: '2026-11-25' }, '2026-11-25').allDay, '2026-11-25');
  });
  it('the card waits for the ceremony, a film, the lounge, a ride, a bake, the proof bar, a sheet or a layer; not for a dance', () => {
    assert.equal(momentHold({}), false);
    for (const k of ['cer', 'rec', 'lounge', 'driving', 'busy', 'baking', 'proof']) assert.equal(momentHold({ [k]: true }), true, k);
    assert.equal(momentHold({ dance: true }), false);
  });
});

describe('words', () => {
  const l = todoList({ ...base, cheer: 3, wish: true, team: { has: true, done: false } });
  it('a row with the points that arrived, a row without, the last row', () => {
    assert.equal(itemNote(l[2], todoNext(l), 15), '✓ 소원 한 줄 걸기 · +15 포인트 · 다음: 소원에 하트 1개');
    assert.equal(itemNote(l[1], l[2], 45), '✓ 전광판 응원 3번 · +45 포인트 · 다음: 소원 한 줄 걸기');
    assert.equal(itemNote(l[1], l[2]), '✓ 전광판 응원 3번 · 다음: 소원 한 줄 걸기', 'no pay arrived: no points (test/review2-hud.test.mjs 2)');
    const team = todoList({ ...base, team: { has: true, done: true } })[4];
    assert.equal(itemNote(team, l[3]), '✓ 우리 팀 응원하기 · 다음: 소원에 하트 1개');
    assert.equal(itemNote(l[3], null, 15), '✓ 소원에 하트 1개 · +15 포인트');
    assert.equal(allNote(4), '🎉 오늘 할 일을 다 했어요 · 출석 4일');
  });
  it('the next day\'s attendance line', () => {
    assert.equal(attendNote(3, 15, l[1]), '출석 3일 · +15 포인트 · 다음: 전광판 응원 3번');
    assert.equal(attendNote(1, 10, null), '출석 1일 · +10 포인트');
  });
  it('the foot line before and after', () => {
    assert.equal(footLine({ all: false, streak: 2, tomorrow: 15 }), '출석 2일 · 내일 오면 +15');
    assert.equal(footLine({ all: true, streak: 2, tomorrow: 15 }), '오늘 할 일을 다 했어요 · 내일 오면 +15');
  });
  it('the card: chip, name cut to 12 code points, bottom line', () => {
    const c = cardText('가'.repeat(20), 3);
    assert.equal(c.chip, '🎉 오늘 할 일 완료');
    assert.equal(c.name, '가'.repeat(12));
    assert.equal(c.line, '출석 3일째 · 내일 또 만나요');
    assert.equal(cardText('😀'.repeat(20), 1).name, '😀'.repeat(12), 'code points, not UTF-16 units');
    assert.equal(cardText('민지', 2).strip, '민지님, 오늘 할 일을 다 했어요');
  });
  it('no game words in anything the list says', () => {
    const all = [...Object.values(TODO_TEXT), ...todoList({ ...base, team: { has: false, done: false } }).flatMap((r) => [r.label, r.value]), allNote(1), footLine({}), cardText('a', 1).line];
    for (const t of all) assert.doesNotMatch(t, /게임|퀘스트|레벨|보상|미션/, t);
  });
});

describe('the phone pill', () => {
  const open = todoList({ ...base, team: false });
  const done = todoList({ ...base, cheer: 3, wish: true, heart: true, team: false });
  const goal = '다음 목표: 무료 거리 칸에 이름을 올리세요';
  it('nothing before the goal is known', () => {
    assert.equal(pillPlan({ known: false, list: open, goal }).kind, 'none');
  });
  it('(1) no board and a free slot open: the first board comes first', () => {
    assert.deepEqual(pillPlan({ known: true, held: 0, freeOpen: true, goal, list: open }), { kind: 'goal', text: goal, tag: '', rest: goal });
  });
  it('(2) rows left: 할 일 n/N · next', () => {
    const p = pillPlan({ known: true, held: 0, freeOpen: false, goal: '다음 목표: 건물 앞 전광판까지 400포인트', list: open });
    assert.deepEqual(p, { kind: 'todo', text: '할 일 1/4 · 전광판 응원 3번', tag: '할 일', rest: '1/4 · 전광판 응원 3번' });
    assert.equal(pillPlan({ known: true, held: 1, freeOpen: true, goal, list: open }).kind, 'todo', 'a board held: the free slot is no longer first');
  });
  it('(3) all done: the done line for that session, the goal after', () => {
    assert.equal(pillPlan({ known: true, held: 1, goal: '다음 목표: 응원 팀과 함께 명당에 이름 걸기', list: done, doneHere: true, streak: 5 }).text, '오늘 할 일 완료 · 출석 5일');
    assert.equal(pillPlan({ known: true, held: 1, goal: '다음 목표: 응원 팀과 함께 명당에 이름 걸기', list: done, doneHere: false }).text, '다음 목표: 응원 팀과 함께 명당에 이름 걸기');
    assert.equal(pillPlan({ known: true, held: 1, goal: '', list: done }).kind, 'none');
  });
});

describe('the week\'s stamps', () => {
  it('weeks run Monday to Sunday (KST days)', () => {
    assert.equal(weekStart('2026-11-25'), '2026-11-23'); // a Wednesday
    assert.equal(weekStart('2026-11-23'), '2026-11-23');
    assert.equal(weekStart('2026-11-29'), '2026-11-23'); // Sunday
    assert.equal(weekStart('2026-12-01'), '2026-11-30');
    assert.equal(dayAdd('2026-12-31', 1), '2027-01-01');
    assert.equal(dayAdd('bad', 1), '');
  });
  it('attended only: pale; all done: gold; today not yet: dashed; later days blank', () => {
    const row = stampRow({ day: '2026-11-25', stamps: { '2026-11-23': 1, '2026-11-24': 2 }, streak: 0, last: '' });
    assert.deepEqual(row.map((c) => c.state), ['attend', 'all', 'today', 'later', 'later', 'later', 'later']);
    assert.deepEqual(row.map((c) => c.wd), ['월', '화', '수', '목', '금', '토', '일']);
    assert.equal(stampRow({ day: '2026-11-25', stamps: { '2026-11-25': 2 } })[2].state, 'all');
    assert.equal(stampRow({ day: '2026-11-25', stamps: { '2026-11-25': 1 } })[2].state, 'today', 'attended today but not all done: still dashed');
    assert.equal(stampName(row[1]), '화요일 · 오늘 할 일을 다 했어요');
  });
  it('days before the stamps were kept come from the attendance streak', () => {
    const row = stampRow({ day: '2026-11-25', stamps: {}, streak: 3, last: '2026-11-25' });
    assert.deepEqual(row.slice(0, 3).map((c) => c.state), ['attend', 'attend', 'today']);
    assert.equal(stampRow({ day: '2026-11-26', stamps: {}, streak: 2, last: '2026-11-24' })[0].state, 'attend');
    assert.equal(stampRow({ day: '2026-11-26', stamps: {}, streak: 2, last: '2026-11-24' })[2].state, 'none', 'a day missed');
  });
  it('kept for the last 14 days only, never lowered', () => {
    const s = keepStamps({ '2026-11-01': 2, '2026-11-12': 1, '2026-11-11': 1, '2026-11-26': 1, nope: 2, '2026-11-20': 7 }, '2026-11-25');
    assert.deepEqual(s, { '2026-11-12': 1, '2026-11-20': 2 });
    assert.deepEqual(markStamp({ '2026-11-25': 2 }, '2026-11-25', 1), { '2026-11-25': 2 });
    assert.deepEqual(markStamp({}, '2026-11-25', 2), { '2026-11-25': 2 });
  });
});

describe('the week\'s gift suggestion', () => {
  it('a board made since the plaza last looked ticks this week; the first look only remembers', () => {
    assert.deepEqual(giftSeen(null, ['abcd1234']), { seen: ['abcd1234'], fresh: false });
    assert.deepEqual(giftSeen(['abcd1234'], ['zzzz9999', 'abcd1234']), { seen: ['zzzz9999', 'abcd1234'], fresh: true });
    assert.deepEqual(giftSeen(['abcd1234'], ['abcd1234', 'BAD!']), { seen: ['abcd1234'], fresh: false });
    assert.equal(giftDone('2026-11-23', '2026-11-29'), true);
    assert.equal(giftDone('2026-11-23', '2026-11-30'), false, 'a new week');
    assert.equal(giftDone('', '2026-11-25'), false);
  });
});
