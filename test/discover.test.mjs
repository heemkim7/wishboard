// /discover (2026-11-27): a read-only page with no 3D, built only from the cached /rt/world and /rt/wishes the plaza already reads. Gifts only
// when their owner turned DISCOVER on (dc: 1) and they hang now; boards lit by people now; today's wishes. Popularity orders, never ranks.
// With fewer real items than DISCOVER.min a tab shows seasonal samples in their own section, labelled, never counted or mixed in.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DISCOVER, TABS, discoverItems, discoverTab, samplesFor, SAMPLE_LABEL, refreshDue } from '../discoverrules.js';
import { PUBLIC_MIN } from '../ftue.js';

const NOW = Date.parse('2026-12-20T03:00:00Z'); // 12:00 KST
const gift = (o = {}) => ({ id: 'gift0001', to: '민지', from: '지수', occ: 'bday', msg: '생일 축하해!', th: 'party', scr: 'STREET_31', a: NOW - 36e5, b: NOW + 36e5, n: 2, dc: 1, ...o });
const board = (o = {}) => ({ slot_id: 'STREET_9', holder_id: 'guest:abc', holder_name: '하늘', line1: '첫 줄', line2: '둘째', line3: '', lit_until: new Date(NOW + 864e5).toISOString(), updated_at: new Date(NOW - 6e5).toISOString(), views: 3, cheers: 4, ...o });
const wish = (o = {}) => ({ id: 'wish000001', nick: '별', txt: '합격하게 해 주세요', hearts: 5, at: NOW - 12e5, ...o });

describe('what /discover lists', () => {
  it('a gift only while it hangs and only when its owner opted in', () => {
    const world = { gifts: [gift(), gift({ id: 'gift0002', dc: 0 }), gift({ id: 'gift0003', dc: undefined }), gift({ id: 'gift0004', b: NOW - 1 }), gift({ id: 'bad', dc: 1 })] };
    const items = discoverItems({ world, now: NOW });
    assert.deepEqual(items.map((x) => x.id), ['gift0001']);
    const g = items[0];
    assert.equal(g.kind, 'gift'); assert.equal(g.big, 'To. 민지'); assert.equal(g.line, '생일 축하해!'); assert.equal(g.by, 'From. 지수');
    assert.equal(g.view, '/?gb=gift0001'); assert.equal(g.page, '/g/gift0001'); assert.equal(g.heart, 'gift'); assert.equal(g.make, '/gift');
    const me = discoverItems({ world: { gifts: [gift({ occ: 'me', from: '' })] }, now: NOW })[0];
    assert.equal(me.big, 'by 민지'); assert.equal(me.by, ''); assert.equal(me.make, '/gift?me=1');
  });
  it('a board only while a person keeps it lit; a wish of today, once even when two lists carry it', () => {
    const world = { billboards: [board(), board({ slot_id: 'STREET_8', holder_id: '' }), board({ slot_id: 'STREET_7', holder_id: 'bot:1' }), board({ slot_id: 'STREET_6', lit_until: new Date(NOW - 1).toISOString() })], wish: { board: [wish(), { id: 'x', txt: 'bad' }] } };
    const items = discoverItems({ world, wishes: { top: [wish()], recent: [wish({ id: 'wish000002', hearts: 0, at: NOW - 1000 })] }, now: NOW });
    assert.deepEqual(items.map((x) => x.kind + ':' + x.id).sort(), ['board:STREET_9', 'wish:wish000001', 'wish:wish000002']);
    const b = items.find((x) => x.kind === 'board');
    assert.equal(b.big, '첫 줄'); assert.equal(b.line, '둘째'); assert.equal(b.by, 'by 하늘'); assert.equal(b.view, '/?focus=STREET_9'); assert.equal(b.page, '/rt/card/STREET_9'); assert.equal(b.heart, '');
    const w = items.find((x) => x.id === 'wish000001');
    assert.equal(w.big, '합격하게 해 주세요'); assert.equal(w.by, '별님의 소원'); assert.equal(w.view, '/?wish=wish000001'); assert.equal(w.page, '/rt/w/wish000001'); assert.equal(w.heart, 'wish');
  });
  it('nothing at all from an empty or broken read', () => {
    for (const x of [undefined, null, {}, { world: { gifts: 'x', billboards: 3 } }, { wishes: { top: null } }]) assert.deepEqual(discoverItems({ ...(x || {}), now: NOW }), []);
  });
});

describe('the tabs', () => {
  const items = discoverItems({ now: NOW, world: { gifts: [gift({ id: 'gift000a', n: 9, a: NOW - 7e6 }), gift({ id: 'gift000b', occ: 'cheer', n: 0, a: NOW - 1e5 }), gift({ id: 'gift000c', occ: 'me', from: '', n: 1, a: NOW - 2e5 })], billboards: [board()] }, wishes: { top: [wish()] } });
  it('are the six, in order', () => { assert.deepEqual(TABS.map((t) => t.name), ['지금 인기', '새로 걸린', '생일', '응원', '개인 전광판', '소원']); });
  it('지금 인기 orders by reactions, 새로 걸린 by when it went up; the others by kind', () => {
    assert.deepEqual(discoverTab(items, 'hot').map((x) => x.id), ['gift000a', 'STREET_9', 'wish000001', 'gift000c', 'gift000b']);
    assert.deepEqual(discoverTab(items, 'new').map((x) => x.id), ['gift000b', 'gift000c', 'STREET_9', 'wish000001', 'gift000a']);
    assert.deepEqual(discoverTab(items, 'bday').map((x) => x.id), ['gift000a']);
    assert.deepEqual(discoverTab(items, 'cheer').map((x) => x.id), ['gift000b']);
    assert.deepEqual(discoverTab(items, 'me').map((x) => x.id), ['gift000c']);
    assert.deepEqual(discoverTab(items, 'wish').map((x) => x.id), ['wish000001']);
    assert.deepEqual(discoverTab(items, 'nope'), []);
  });
  it('carry no rank and no count to show', () => {
    for (const x of discoverTab(items, 'hot')) { assert.equal('rank' in x, false); assert.equal('n' in x, false); }
  });
});

describe('an open page reads the world again', () => {
  it('every two minutes while it is on screen, never while hidden', () => {
    assert.equal(DISCOVER.refreshMs, 120000);
    assert.equal(refreshDue(0, 119999, false), false); assert.equal(refreshDue(0, 120000, false), true);
    assert.equal(refreshDue(0, 999999, true), false, 'a hidden tab waits until it is seen again');
    assert.equal(refreshDue(500, 100, false), true, 'a clock that went back reads again');
  });
  it('checks on a timer and when the tab comes back', () => {
    const page = fs.readFileSync(new URL('../discoverpage.js', import.meta.url), 'utf8');
    assert.match(page, /refreshDue\(/); assert.match(page, /visibilitychange/);
  });
});

describe('samples when the plaza is quiet', () => {
  it('the threshold is the plaza\'s public one', () => { assert.equal(DISCOVER.min, PUBLIC_MIN.wishes); });
  it('are seasonal, labelled, and never real items', () => {
    const dec = samplesFor(NOW), may = samplesFor(Date.parse('2026-05-05T03:00:00Z'));
    assert.ok(dec.length >= 3 && dec.length <= 6); assert.ok(may.length >= 3);
    assert.ok(dec.some((s) => /크리스마스|연말/.test(s.line + s.big)), 'December has its own');
    assert.notDeepEqual(dec.map((s) => s.line), may.map((s) => s.line));
    for (const s of [...dec, ...may]) { assert.equal(s.kind, 'sample'); assert.equal(s.sample, true); assert.equal(s.heart, ''); assert.equal(s.page, ''); assert.equal(s.view, ''); }
    assert.equal(SAMPLE_LABEL, '예시 · WISH BOARD');
  });
});

describe('the page', () => {
  const page = fs.readFileSync(new URL('../discoverpage.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../discover.html', import.meta.url), 'utf8');
  it('reads only the cached world and wishes (and sends hearts); no 3D, no room', () => {
    const urls = [...page.matchAll(/fetch\(\s*'([^']+)'\s*[,)]/g)].map((m) => m[1]).sort(); // whole addresses (the gift heart is built: below)
    assert.deepEqual([...new Set(urls)], ['/rt/guest', '/rt/wish/heart', '/rt/wishes', '/rt/world'].sort());
    assert.match(page, /fetch\(\s*'\/rt\/gift\/' \+/, 'a gift heart');
    assert.equal(/three|timesSquare3d|net\.js|WebSocket/.test(page), false);
    assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(page), false, 'what people wrote is only set as text');
  });
  it('is noindex, names the samples, and says the plaza is virtual', () => {
    assert.match(html, /<meta name="robots" content="noindex"/);
    assert.match(page, /SAMPLE_LABEL/);
    assert.match(html + page, /가상/);
  });
});
