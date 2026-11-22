// 선물 전광판: the pure rules (giftrules.js) — the form, windows, scheduling, the plaza placement, phases and the 롤링페이퍼 lock,
// attribution, the price ladder, quiet hours, the video's type and ranges.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  GIFT, GIFT_SCREENS, OCCASIONS, TIERS, TIER_NOTE, TIER_ASK, won, giftFault, paperFault, windowFor, windowText, startChoices, dayText, hourText,
  screenLoad, pickScreen, nextFree, placeGifts, turnOf, giftPhase, keepUntil, pruneDay, paperOpen, paperTakes, lockArm, refOf, keptRef, REF_MS,
  giftView, giftShareText, countdown, videoKind, rangeOf, pickRecordType, quietNow, kstDay, dayStart, addDays, giftScreen,
} from '../giftrules.js';

const KST = (s) => Date.parse(s + '+09:00');
const NOW = KST('2026-11-23T12:00:00'); // Monday noon KST
const form = (o = {}) => ({ to: '민지', from: '동아리', occ: 'bday', msg: '생일 축하해!', day: '2026-11-23', at: 'now', ...o });

describe('the form', () => {
  it('takes a name, an occasion, a short line and a window; the theme follows the occasion unless chosen', () => {
    const r = giftFault(form(), NOW);
    assert.equal(r.ok, true);
    assert.equal(r.v.th, OCCASIONS.bday.th);
    assert.equal(r.v.a, Math.floor(NOW / 600000) * 600000);
    assert.equal(r.v.b - r.v.a, GIFT.hours * 36e5);
    assert.equal(giftFault(form({ th: 'night' }), NOW).v.th, 'night');
    assert.equal(giftFault(form({ th: 'nope' }), NOW).v.th, OCCASIONS.bday.th);
    assert.equal(giftFault(form({ msg: '', from: '' }), NOW).ok, true, 'the line and the sender are optional');
    assert.equal(giftFault(form({ to: '  민​지  ' }), NOW).v.to, '민지', 'zero-width marks and spaces go');
  });
  it('refuses what a board must not carry, field by field', () => {
    const f = (o) => { const r = giftFault(form(o), NOW); return r.ok ? '' : r.field + ':' + r.code; };
    assert.equal(f({ to: '' }), 'to:to');
    assert.equal(f({ to: '운영자' }), 'to:name');
    assert.equal(f({ to: 'x'.repeat(GIFT.toMax + 1) }), 'to:long');
    assert.equal(f({ from: '01012345678' }), 'from:name');
    assert.equal(f({ msg: '연락 010-1234-5678' }), 'msg:link');
    assert.equal(f({ msg: 'https://evil.example/x' }), 'msg:link');
    assert.equal(f({ msg: 'x'.repeat(GIFT.msgMax + 1) }), 'msg:long');
    assert.equal(f({ occ: 'party' }), 'occ:occ');
    assert.equal(f({ day: '2026-11-22' }), 'day:day');
    assert.equal(f({ day: addDays('2026-11-23', GIFT.aheadDays + 1), at: 18 }), 'day:day');
    assert.equal(f({ day: '2026-02-30', at: 18 }), 'day:day');
    assert.equal(f({ day: '2026-11-24', at: 'now' }), 'at:at', '"now" is for today only');
    assert.equal(f({ at: 9 }), 'at:past');
    assert.equal(f({ at: 13 }), 'at:at', 'only the offered start hours');
    assert.equal(giftFault(null).ok, false);
  });
  it('offers today now and the hours still ahead, a later day every start hour, nothing outside the range', () => {
    assert.deepEqual(startChoices('2026-11-23', NOW), ['now', 15, 18]);
    assert.deepEqual(startChoices('2026-11-24', NOW), [9, 12, 15, 18]);
    assert.deepEqual(startChoices('2026-11-22', NOW), []);
    assert.deepEqual(startChoices(addDays('2026-11-23', 31), NOW), []);
    assert.deepEqual(startChoices('2026-11-23', KST('2026-11-23T19:00:00')), ['now']);
  });
  it('says the window in Korean', () => {
    const w = windowFor('2026-12-25', 18, NOW);
    assert.equal(windowText(w.a, w.b), '12월 25일 (금) 저녁 6시 ~ 자정');
    const late = windowFor('2026-11-23', 'now', KST('2026-11-23T22:05:00'));
    assert.equal(windowText(late.a, late.b), '11월 23일 (월) 밤 10시 ~ 다음 날 새벽 4시');
    assert.equal(hourText(12), '낮 12시'); assert.equal(hourText(9), '오전 9시'); assert.equal(hourText(15), '오후 3시'); assert.equal(dayText('2026-11-23'), '11월 23일 (월)');
    assert.equal(countdown(3 * 864e5 + 5), 'D-3'); assert.equal(countdown(3 * 36e5 + 12 * 6e4), '3시간 12분'); assert.equal(countdown(65000), '1분 5초');
  });
  it('a 롤링페이퍼 line: a short text, an optional nick (default 친구), the same filters', () => {
    assert.deepEqual(paperFault({ nick: '', txt: ' 생일 축하해 ' }).v, { nick: '친구', txt: '생일 축하해' });
    assert.equal(paperFault({ txt: '' }).code, 'paperEmpty');
    assert.equal(paperFault({ txt: '전화 01012345678' }).code, 'link');
    assert.equal(paperFault({ nick: '관리자', txt: '안녕' }).code, 'name');
    assert.equal(paperFault({ txt: 'x'.repeat(GIFT.paper.txtMax + 1) }).code, 'long');
  });
});

describe('scheduling', () => {
  it('uses ordinary screens only: streets and lots, never the main tower, the corner towers or the ad screens', () => {
    assert.equal(GIFT_SCREENS.length, 68);
    assert.ok(GIFT_SCREENS.every((s) => /^(STREET_\d+|PLOT_\d+)$/.test(s)));
    for (const s of ['MAIN_TOP', 'MAIN_UP', 'SUB_1A', 'SUB_4B', 'AD_1', 'AD_5']) assert.equal(giftScreen(s), false, s);
    assert.equal(GIFT_SCREENS[0], 'STREET_31', 'the bowtie\'s own screens first');
  });
  it('spreads boards one per screen first, then shares a screen up to GIFT.perScreen, then is full', () => {
    const rows = [], a = NOW, b = NOW + 6 * 36e5;
    for (let i = 0; i < GIFT_SCREENS.length; i++) rows.push({ scr: pickScreen(rows, a, b), a, b });
    assert.deepEqual(rows.map((r) => r.scr), GIFT_SCREENS, 'each screen once');
    const pool = ['STREET_1', 'STREET_2'], few = [];
    for (let i = 0; i < 2 * GIFT.perScreen; i++) { const s = pickScreen(few, a, b, pool); assert.ok(s, 'room ' + i); few.push({ scr: s, a, b }); }
    assert.equal(pickScreen(few, a, b, pool), '', 'full');
    assert.equal(screenLoad(few, 'STREET_1', a, b), GIFT.perScreen);
    assert.equal(pickScreen(few, b, b + 36e5, pool), 'STREET_1', 'the next window is free again');
    assert.equal(screenLoad([{ scr: 'STREET_1', a, b: a + 36e5 }, { scr: 'STREET_1', a: a + 36e5, b }], 'STREET_1', a, b), 1, 'back to back is not overlap');
  });
  it('suggests the next window that still has a screen', () => {
    const pool = GIFT_SCREENS, rows = [];
    const w = windowFor('2026-11-23', 'now', NOW);
    for (const s of pool) for (let i = 0; i < GIFT.perScreen; i++) rows.push({ scr: s, a: w.a - 36e5, b: w.a + 6 * 36e5 }); // full until 18:00
    const n = nextFree(rows, '2026-11-23', NOW);
    assert.deepEqual(n, { day: '2026-11-23', at: 18 }, 'today at 18 is past the full stretch');
  });
});

describe('the plaza places what is live', () => {
  const gifts = [{ id: 'aaaaaaa1', scr: 'STREET_31', a: 1 }, { id: 'aaaaaaa2', scr: 'STREET_31', a: 2 }, { id: 'aaaaaaa3', scr: 'STREET_32', a: 3 }];
  it('keeps a board on its screen while that screen is free', () => {
    const p = placeGifts(gifts, () => true);
    assert.deepEqual([...p], [['STREET_31', ['aaaaaaa1', 'aaaaaaa2']], ['STREET_32', ['aaaaaaa3']]]);
  });
  it('moves boards off a screen someone lit to the least-loaded free one, never covering it', () => {
    const p = placeGifts(gifts, (s) => s !== 'STREET_31');
    assert.equal(p.has('STREET_31'), false);
    assert.deepEqual(p.get('STREET_33'), ['aaaaaaa1']); assert.deepEqual(p.get('STREET_34'), ['aaaaaaa2']);
    assert.deepEqual(placeGifts(gifts, () => false), new Map(), 'no free screen: nothing shows');
    const per = placeGifts(Array.from({ length: 6 }, (_, i) => ({ id: 'bbbbbbb' + i, scr: 'STREET_1', a: i })), (s) => s === 'STREET_1' || s === 'STREET_2');
    assert.equal(per.get('STREET_1').length, GIFT.perScreen); assert.equal(per.get('STREET_2').length, 2);
  });
  it('turns shared screens by the wall clock, the same for every viewer', () => {
    assert.equal(turnOf(3, 0), 0); assert.equal(turnOf(3, GIFT.cycleMs), 1); assert.equal(turnOf(3, 3 * GIFT.cycleMs), 0); assert.equal(turnOf(0, 5), 0);
  });
});

describe('phases, keeping and the 롤링페이퍼 lock (E3)', () => {
  const g = { id: 'cccccccc', st: 'live', day: '2026-11-25', a: KST('2026-11-25T18:00:00'), b: KST('2026-11-26T00:00:00'), lk: 1 };
  it('before the day, on the day, on the plaza, after, gone (the day plus 7 days)', () => {
    assert.equal(giftPhase(g, KST('2026-11-24T23:59:59')), 'before');
    assert.equal(giftPhase(g, KST('2026-11-25T00:00:00')), 'day');
    assert.equal(giftPhase(g, g.a), 'live');
    assert.equal(giftPhase(g, g.b), 'after');
    assert.equal(keepUntil(g), KST('2026-12-03T00:00:00'), 'the policy: 그날이 지나고 7일 뒤');
    assert.equal(giftPhase(g, KST('2026-12-02T23:59:59')), 'after');
    assert.equal(giftPhase(g, KST('2026-12-03T00:00:00')), 'gone');
    assert.equal(giftPhase({ ...g, st: 'hidden' }, g.a), 'gone');
    assert.equal(pruneDay(KST('2026-12-03T00:00:00')), '2026-11-25', 'that day is pruned from then on');
    assert.equal(pruneDay(KST('2026-12-02T23:59:59')), '2026-11-24');
  });
  it('locks lines until 00:00 of the day; the open arm shows them at once; lines are taken until the window ends', () => {
    assert.equal(paperOpen(g, KST('2026-11-24T23:00:00')), false);
    assert.equal(paperOpen(g, KST('2026-11-25T00:00:00')), true);
    assert.equal(paperOpen({ ...g, lk: 0 }, KST('2026-11-20T00:00:00')), true);
    assert.equal(paperTakes(g, g.b - 1), true); assert.equal(paperTakes(g, g.b), false);
    assert.equal(lockArm('abcdefgh', false), 1, 'no split: every board locks');
    const arms = new Set(); for (const id of ['aaaaaaaa', 'aaaaaaab', 'aaaaaaac', 'aaaaaaad', 'zzzzzzz1', 'zzzzzzz2']) arms.add(lockArm(id, true));
    assert.deepEqual([...arms].sort(), [0, 1], 'the split gives both arms');
  });
  it('the public view never carries the owner, the network or a writer; lines only once open', () => {
    const stored = { ...g, uid: 'guest:x', ip: 'abc', to: '민지', from: 'A', occ: 'bday', msg: 'hi', th: 'party', scr: 'STREET_31', n: 2, paper: [{ id: 'p00001', nick: '친구', txt: '축하', uid: 'guest:y' }] };
    const before = giftView(stored, KST('2026-11-24T00:00:00')), after = giftView(stored, g.a);
    for (const v of [before, after]) { const s = JSON.stringify(v); assert.equal(s.includes('guest:'), false); assert.equal('ip' in v, false); assert.equal('uid' in v, false); }
    assert.equal(before.paper, null); assert.equal(before.n, 2);
    assert.deepEqual(after.paper, [{ id: 'p00001', nick: '친구', txt: '축하' }]);
    assert.match(giftShareText(stored).title, /민지님을 위한 선물 전광판/);
  });
});

describe('attribution (E2), the price ladder (E1), quiet hours', () => {
  it('keeps a ref 7 days', () => {
    assert.equal(refOf('abcd1234'), 'abcd1234'); assert.equal(refOf('ABCD1234'), ''); assert.equal(refOf('abc'), '');
    assert.equal(keptRef(JSON.stringify({ id: 'abcd1234', at: 1000 }), 1000 + REF_MS - 1), 'abcd1234');
    assert.equal(keptRef(JSON.stringify({ id: 'abcd1234', at: 1000 }), 1000 + REF_MS), '');
    assert.equal(keptRef('junk', 0), '');
  });
  it('the ladder is the report\'s: free first and the default, 3,900 / 7,900 (recommended) / 14,900, VAT included, no fake scarcity', () => {
    assert.deepEqual(TIERS.map((t) => t.price), [0, 3900, 7900, 14900]);
    assert.equal(TIERS.filter((t) => t.best).map((t) => t.t).join(), '2');
    assert.equal(TIERS.filter((t) => /커피 한 잔/.test(t.tag)).map((t) => t.t).join(), '1', 'the coffee words only on the 3,900 tier');
    assert.match(TIER_NOTE, /부가세 포함/); assert.match(TIER_ASK, /결제는 준비 중이에요 · 열리면 알려 드릴까요\?/);
    assert.match(TIERS[3].items.join(), /메인 타워와 따로/, 'the parade is not the fans\' 9 pm main tower');
    assert.equal(/남은|마감|한정/.test(JSON.stringify(TIERS)), false);
    assert.equal(won(7900), '7,900원'); assert.equal(won(0), '0원');
    const page = fs.readFileSync(new URL('../giftpage.js', import.meta.url), 'utf8');
    assert.match(page, /let pick = 0;/, 'the page starts on the free tier');
  });
  it('no advertising push from 21:00 to 08:00 KST', () => {
    assert.equal(quietNow(KST('2026-11-23T20:59:59')), false);
    assert.equal(quietNow(KST('2026-11-23T21:00:00')), true);
    assert.equal(quietNow(KST('2026-11-24T07:59:59')), true);
    assert.equal(quietNow(KST('2026-11-24T08:00:00')), false);
  });
  it('days are KST', () => { assert.equal(kstDay(KST('2026-11-23T23:59:59')), '2026-11-23'); assert.equal(kstDay(KST('2026-11-24T00:00:00')), '2026-11-24'); assert.equal(dayStart('2026-11-24'), KST('2026-11-24T00:00:00')); });
});

describe('the video', () => {
  it('knows MP4 and WebM by their bytes, nothing else', () => {
    const mp4 = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(videoKind(mp4), 'mp4'); assert.equal(videoKind(webm), 'webm');
    assert.equal(videoKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), '');
    assert.equal(videoKind(new Uint8Array(3)), '');
  });
  it('serves byte ranges', () => {
    assert.deepEqual(rangeOf('bytes=0-99', 1000), { offset: 0, length: 100 });
    assert.deepEqual(rangeOf('bytes=900-', 1000), { offset: 900, length: 100 });
    assert.deepEqual(rangeOf('bytes=-100', 1000), { offset: 900, length: 100 });
    assert.deepEqual(rangeOf('bytes=990-5000', 1000), { offset: 990, length: 10 });
    assert.equal(rangeOf('bytes=1000-', 1000), 'bad'); assert.equal(rangeOf('', 1000), null); assert.equal(rangeOf('items=0-1', 1000), null);
  });
  it('records MP4 where the browser can, WebM otherwise', () => {
    assert.equal(pickRecordType((t) => t.startsWith('video/webm')), 'video/webm;codecs=vp9');
    assert.equal(pickRecordType((t) => t === 'video/mp4'), 'video/mp4');
    assert.equal(pickRecordType(() => false), '');
  });
});
