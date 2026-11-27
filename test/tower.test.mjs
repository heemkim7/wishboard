// 메인 타워 축하 1분 (towerrules.js): which minutes can be picked, the day's 30, one per board and per maker a day, the 30 days between
// point bookings, the friends' threshold (the maker's network never counts), what the plaza shows in that minute, and the pre-day 💖 rule
// in giftrules.js. Pure: no clock, no I/O.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TOWER, SHARE, shareAmount, shareDayMax, linkFault, friendsText, SPEND_OLD, TOWER_WORD, minuteBlock, minuteFault, towerMinutes, towerDays, towerFault, reactCounts, towerEntry, towerWire, towerAt, towerKey, towerNews, towerClock, towerLook, towerCard } from '../towerrules.js';
import { giftView, heartTakes, heartsOpen, OCC_KEYS } from '../giftrules.js';

const KST = (s) => Date.parse(s + '+09:00');
const MIN = 60e3;
// A board 18:00-24:00 on 2026-12-01, made by guest:a on network aaaa…
const G = (o = {}) => ({ id: 'abcd1234', uid: 'guest:a', ip: 'a'.repeat(16), st: 'live', day: '2026-12-01', a: KST('2026-12-01T18:00:00'), b: KST('2026-12-02T00:00:00'), to: '민지', from: '지수', occ: 'bday', msg: '축하해', th: 'party', ...o });
const NOW = KST('2026-12-01T17:00:00');

describe('which minutes can be picked', () => {
  it('never on the hour (anniversaries) nor in the 21 o\'clock hour (the 9 pm team)', () => {
    assert.equal(minuteBlock(KST('2026-12-01T20:00:00')), 'hour');
    assert.equal(minuteBlock(KST('2026-12-01T21:00:00')), 'hour');
    assert.equal(minuteBlock(KST('2026-12-01T21:30:00')), 'gold');
    assert.equal(minuteBlock(KST('2026-12-01T20:30:00')), '');
    assert.equal(minuteBlock(KST('2026-12-01T22:01:00')), '');
  });
  it('a whole minute inside the board\'s window, at least five minutes ahead', () => {
    const g = G();
    assert.equal(minuteFault(g, KST('2026-12-01T20:30:00') + 1, NOW), 'step');
    assert.equal(minuteFault(g, KST('2026-12-01T17:59:00'), NOW), 'window');
    assert.equal(minuteFault(g, KST('2026-12-01T23:59:00'), NOW), '', 'the last minute ends with the window');
    assert.equal(minuteFault(g, g.b, NOW), 'window');
    const at = KST('2026-12-01T20:30:00');
    assert.equal(minuteFault(g, at, at - TOWER.leadMs + 1), 'soon');
    assert.equal(minuteFault(g, at, at - TOWER.leadMs), '');
    assert.equal(minuteFault(g, at, at + MIN), 'soon', 'a minute gone by');
  });
  it('lists every minute of the window with why it cannot be picked: 6 hours, 6 on-the-hour minutes, 59 more in the 21 o\'clock hour', () => {
    const list = towerMinutes(G(), NOW, [KST('2026-12-01T20:30:00')]);
    assert.equal(list.length, 360);
    const why = (w) => list.filter((x) => x.why === w).length;
    assert.deepEqual([why('hour'), why('gold'), why('taken'), why('')], [6, 59, 1, 294]);
  });
  it('a window across midnight covers two KST days', () => {
    assert.deepEqual(towerDays(G({ a: KST('2026-12-01T22:00:00'), b: KST('2026-12-02T04:00:00') })), ['2026-12-01', '2026-12-02']);
    assert.deepEqual(towerDays(G()), ['2026-12-01']);
  });
});

describe('a booking: one per board, one a day per maker, 30 a day, 30 days between point bookings', () => {
  const m = KST('2026-12-01T20:30:00');
  const base = { g: G(), uid: 'guest:a', how: 'friends', m, now: NOW, guest: true, boardHas: false, taken: false, dayN: 0, mine: false, gap: false, friends: 10 };
  it('says why, cheapest first', () => {
    assert.equal(towerFault(base), '');
    assert.equal(towerFault({ ...base, uid: 'guest:b' }), 'owner');
    assert.equal(towerFault({ ...base, g: G({ st: 'hidden' }) }), 'gone');
    assert.equal(towerFault({ ...base, g: null }), 'gone');
    assert.equal(towerFault({ ...base, how: 'money' }), 'minute');
    assert.equal(towerFault({ ...base, boardHas: true }), 'board');
    assert.equal(towerFault({ ...base, m: KST('2026-12-01T21:15:00') }), 'minute');
    assert.equal(towerFault({ ...base, taken: true }), 'taken');
    assert.equal(towerFault({ ...base, dayN: TOWER.perDay }), 'sold');
    assert.equal(towerFault({ ...base, dayN: TOWER.perDay - 1 }), '', 'the 30th');
    assert.equal(towerFault({ ...base, mine: true }), 'day');
    assert.equal(towerFault({ ...base, friends: TOWER.friends - 1 }), 'friends');
    assert.equal(towerFault({ ...base, how: 'points', friends: 0 }), 'account', 'a guest has no points path');
    assert.equal(towerFault({ ...base, how: 'points', guest: false, friends: 0 }), '');
    assert.equal(towerFault({ ...base, how: 'points', guest: false, gap: true }), 'gap');
  });
  it('the numbers', () => {
    assert.deepEqual([TOWER.perDay, TOWER.friends, TOWER.price, TOWER.gapDays, TOWER.leadMs], [30, 10, 2000, 30, 300000]);
    assert.equal(SPEND_OLD, '그 금액은 쓸 수 없어요.');
  });
});

describe('a friend\'s reaction counts once per network, never the maker\'s', () => {
  it('another network, a checked person; not the maker\'s network, not the maker\'s own line, not without a network', () => {
    const g = G();
    assert.equal(reactCounts(g, { net: 'b'.repeat(16), human: true }), true);
    assert.equal(reactCounts(g, { net: g.ip, human: true }), false, 'the maker\'s network');
    assert.equal(reactCounts(g, { net: 'b'.repeat(16), uid: 'guest:a', human: true }), false, 'the maker writing from elsewhere');
    assert.equal(reactCounts(g, { net: 'b'.repeat(16), uid: 'guest:c', human: true }), true);
    assert.equal(reactCounts(g, { net: 'b'.repeat(16), human: false }), false, 'a heart without the check');
    assert.equal(reactCounts(g, { net: '', human: true }), false);
    assert.equal(reactCounts(G({ ip: '' }), { net: 'b'.repeat(16), human: true }), false, 'a board with no maker network opens nothing');
  });
});

describe('the plaza in that minute', () => {
  const m = KST('2026-12-01T20:30:00'), e = towerEntry(G(), m);
  it('an entry carries only what the board shows', () => {
    assert.deepEqual(Object.keys(e).sort(), ['from', 'id', 'm', 'msg', 'occ', 'th', 'to']);
  });
  it('towerAt: the one minute, never an on-the-hour or 21 o\'clock entry even if one were listed', () => {
    assert.equal(towerAt([e], m - 1), null);
    assert.equal(towerAt([e], m), e); assert.equal(towerAt([e], m + MIN - 1), e);
    assert.equal(towerAt([e], m + MIN), null);
    const bad = { ...e, m: KST('2026-12-01T21:10:00') };
    assert.equal(towerAt([bad], bad.m + 1000), null);
    assert.equal(towerKey(e), 'abcd1234|' + m); assert.equal(towerKey(null), '');
  });
  it('towerWire cleans a push: a bad id is nothing, off keeps only id and minute, long names are cut', () => {
    assert.equal(towerWire({ id: 'x', m }), null);
    assert.deepEqual(towerWire({ id: 'abcd1234', m, off: 1, to: 'z' }), { id: 'abcd1234', m, off: 1 });
    const w = towerWire({ ...e, to: '가'.repeat(30), occ: 'nope', extra: 1 });
    assert.equal(Array.from(w.to).length, 12); assert.equal(w.occ, 'bday'); assert.equal('extra' in w, false);
    for (const occ of ['constructor', '__proto__', 'toString']) assert.equal(towerWire({ ...e, occ }).occ, 'bday', occ + ' is not an occasion');
  });
  it('the news line names the person and the day, never points or how it was won', () => {
    assert.equal(towerNews(e), '🎉 지금 메인 타워: 민지의 생일');
    assert.equal(towerNews({ ...e, occ: 'just' }), '🎉 지금 메인 타워: 민지의 ' + TOWER_WORD.just);
    assert.equal(/포인트|2,000|친구 응원|응원 10곳/.test(towerNews(e)), false);
    for (const k of OCC_KEYS) assert.ok(Object.hasOwn(TOWER_WORD, k) && TOWER_WORD[k], 'a word for every day: ' + k); // 2026-11-27: love, grad, me
    assert.equal(towerNews({ ...e, occ: 'me' }), '🎉 지금 메인 타워: 민지의 전광판');
    assert.equal(towerNews({ ...e, occ: 'love' }), '🎉 지금 메인 타워: 민지의 사랑 고백');
    assert.equal(towerNews({ ...e, occ: 'grad' }), '🎉 지금 메인 타워: 민지의 졸업·승진');
    assert.equal(towerClock(m), '20:30');
  });
  it('towerLook: soon, live for the minute, done after', () => {
    assert.equal(towerLook(0, m), 'none');
    assert.deepEqual([towerLook(m, m - 1), towerLook(m, m), towerLook(m, m + MIN)], ['soon', 'live', 'done']);
  });
});

describe('the owner\'s card', () => {
  const g = { ...G(), phase: 'before' }, days = { '2026-12-01': { left: 30, mine: false } };
  const card = (o = {}) => towerCard({ g, tw: null, now: NOW, days, taken: [], friends: 3, guest: true, prep: false, gap: false, ...o });
  it('open: places left, friends k/10, the points path by who is asking', () => {
    const c = card();
    assert.equal(c.state, 'open'); assert.equal(c.left, 30); assert.equal(c.friends, 3); assert.equal(c.need, 10); assert.equal(c.canFriends, false);
    assert.equal(c.points, 'account');
    assert.equal(card({ guest: false }).points, 'ok'); assert.equal(card({ guest: false, prep: true }).points, 'prep'); assert.equal(card({ guest: false, gap: true }).points, 'gap');
    assert.equal(card({ friends: 10 }).canFriends, true);
    assert.equal(c.minutes.filter((x) => !x.why).length, 295, '360 minutes less 6 on the hour and 59 in the 21 o\'clock hour');
  });
  it('sold out, already one today, booked, live, done, closed', () => {
    assert.equal(card({ days: { '2026-12-01': { left: 0, mine: false } } }).state, 'sold');
    assert.equal(card({ days: { '2026-12-01': { left: 5, mine: true } } }).state, 'mine');
    const m = KST('2026-12-01T20:30:00');
    assert.deepEqual([card({ tw: { m, how: 'friends' } }).state, card({ tw: { m, how: 'friends' }, now: m }).state, card({ tw: { m, how: 'friends' }, now: m + MIN }).state], ['booked', 'live', 'done']);
    assert.equal(card({ g: { ...g, phase: 'after' } }).state, 'closed');
    assert.equal(card({ now: KST('2026-12-01T23:56:00') }).state, 'closed', 'no minute left ahead');
  });
});

describe('giftrules: 💖 is taken before the day, shown only after the reveal; the public view carries the booked minute', () => {
  it('heartTakes from the making on; heartsOpen only from the reveal', () => {
    const g = G({ day: '2026-12-02', a: KST('2026-12-02T09:00:00'), b: KST('2026-12-02T15:00:00'), at: KST('2026-12-01T10:00:00') });
    assert.equal(heartTakes(g, NOW), true); assert.equal(heartsOpen(g, NOW), false);
    assert.equal(heartTakes({ ...g, st: 'hidden' }, NOW), false); assert.equal(heartTakes(null, NOW), false);
  });
  it('tw is the minute only, never how it was won', () => {
    const v = giftView({ ...G(), tw: { m: KST('2026-12-01T20:30:00'), how: 'points' } }, NOW);
    assert.equal(v.tw, KST('2026-12-01T20:30:00')); assert.equal(JSON.stringify(v).includes('points'), false);
    assert.equal('tw' in giftView(G(), NOW), false);
  });
});

describe('towerrules.js stays pure', () => {
  it('has no clock, no I/O and imports only giftrules.js, with no query', () => {
    const s = fs.readFileSync(new URL('../towerrules.js', import.meta.url), 'utf8');
    assert.equal(/Date\.now|fetch\(|localStorage|document\.|crypto\./.test(s), false);
    assert.deepEqual([...s.matchAll(/from '([^']+)'/g)].map((x) => x[1]), ['./giftrules.js']);
  });
});

// 공유 보상 (2026-11-27): one step table for gift pages, wish links and board links together, per maker and KST day.
describe('the share reward steps', () => {
  it('friends 1-10: +50 an account, +10 a guest; 11-30: +20 an account, +10 a guest; from the 31st nothing', () => {
    assert.deepEqual([1, 10, 11, 30, 31, 99].map((n) => shareAmount(n, true)), [50, 50, 20, 20, 0, 0]);
    assert.deepEqual([1, 10, 11, 30, 31].map((n) => shareAmount(n, false)), [10, 10, 10, 10, 0]);
    assert.deepEqual([0, -1, NaN, 1.5].map((n) => shareAmount(n, true)), [0, 0, 0, 0], 'not a friend number');
    assert.deepEqual(SHARE.steps.map((s) => [s.upTo, s.acct, s.guest]), [[10, 50, 10], [30, 20, 10]]);
    assert.equal(shareDayMax(true), 900, '10 x 50 + 20 x 20');
    assert.equal(shareDayMax(false), 300, '30 x 10');
    assert.equal(SHARE.windowMs, 24 * 36e5);
    assert.ok(SHARE.openKeepMs >= 2 * 864e5 - 1 && SHARE.openKeepMs <= 3 * 864e5, 'link opens are kept about two days');
  });
  it('a link friend: the maker\'s own link opened from this network within 24 hours, while the same person still has it', () => {
    const now = KST('2026-12-01T12:00:00'), open = { o: 'user:m', at: now - 36e5 }, base = { owner: 'user:m', net: 'n1', uid: 'guest:f', now, makerNets: ['n0'] };
    assert.equal(linkFault(open, base), '');
    assert.equal(linkFault(null, base), 'link', 'no link opened from this network');
    assert.equal(linkFault({ ...open, at: now - SHARE.windowMs - 1 }, base), 'late', 'opened more than 24 hours ago');
    assert.equal(linkFault({ ...open, at: now - SHARE.windowMs }, base), '', 'exactly 24 hours');
    assert.equal(linkFault({ ...open, at: now + 60e3 }, base), 'late', 'a clock that went back');
    assert.equal(linkFault({ ...open, o: 'user:other' }, base), 'link', 'the board changed hands since the link was opened');
    assert.equal(linkFault(open, { ...base, uid: 'user:m' }), 'self', 'the maker\'s own account');
    assert.equal(linkFault(open, { ...base, net: 'n0' }), 'self', 'the maker\'s own network');
    assert.equal(linkFault(open, { ...base, net: '' }), 'link', 'no network');
    assert.equal(linkFault(open, { ...base, owner: '' }), 'link', 'no maker');
  });
  it('the public line says only how many friends, and nothing at 0', () => {
    assert.equal(friendsText(3), '친구 3명이 응원했어요');
    assert.equal(friendsText(31), '친구 31명이 응원했어요', 'uncapped');
    assert.deepEqual([0, -2, NaN, undefined].map(friendsText), ['', '', '', '']);
  });
});
