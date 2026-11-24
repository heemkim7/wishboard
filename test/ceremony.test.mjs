// 점등식 (the lighting ceremony, spec ③): the pure rules both tracks share (giftrules.js). Every device works the phase out from the
// board's own start and its clock plus the server offset; these tests pin each edge exactly and 1 ms either side, the boards that have
// no ceremony, the words on the recipient page and in the plaza, the teaser that never carries the message, the send-back at budget hard,
// the once-per-device steps a hidden tab resumes from, and the localhost-only seam that runs a ceremony against a start a minute away.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CER, CER_BEACONS, CER_TEXT, cerStart, cerPhase, cerLeft, cerDigit, cerClock, cerWhen, cerButton, cerInvite, cerShareLine, cerTeaser,
  cerBand, cerPhotoText, cerArrive, cerUrl, cerBack, cerBackWhy, cerPinMs, cerSteps, cerArriveNote, cerDebugStart, beaconOnce,
  windowFor, giftView, GIFT,
} from '../giftrules.js';

const KST = (s) => Date.parse(s + '+09:00');
// hr: the start hour the board was made with (giftFault's `at`); it is not kept on the board.
const board = ({ hr = 18, ...o } = {}) => {
  const day = o.day || '2026-12-25', w = windowFor(day, hr, KST(day + 'T08:00:00'));
  return { id: 'abcd1234', to: '민지', from: '지수', occ: 'bday', msg: '비밀 문구 🤫', th: '', day, a: w.a, b: w.b, scr: 'STREET_31', st: 'live', ...o };
};
const S = KST('2026-12-25T18:00:00');

describe('cerStart: the fixed start, from the stored window only', () => {
  it('each start hour of its day', () => {
    for (const h of GIFT.starts) assert.equal(cerStart(board({ hr: h })), KST('2026-12-25T' + String(h).padStart(2, '0') + ':00:00'), String(h));
  });
  it('the public view and the live list (no day) keep it', () => {
    const g = board();
    assert.equal(cerStart(giftView(g, S - 864e5)), S);
    assert.equal(cerStart({ id: g.id, scr: g.scr, a: g.a }), S); // /rt/world's rows carry no day
  });
  it('a "지금" board has none (its start is rounded to 10 minutes, mostly not a start hour)', () => {
    const now = KST('2026-12-25T13:47:00'), w = windowFor('2026-12-25', 'now', now);
    assert.equal(cerStart({ ...board(), a: w.a, b: w.b }), 0);
  });
  it('a "지금" board the owner reads (at: made at or after its start) has none even on a start hour', () => {
    const w = windowFor('2026-12-25', 'now', KST('2026-12-25T18:04:00'));
    assert.equal(w.a, S); // the one case the public view cannot tell apart
    assert.equal(cerStart({ ...board(), at: KST('2026-12-25T18:04:00') }), 0);
    assert.equal(cerStart({ ...board(), at: KST('2026-12-20T10:00:00') }), S); // made days before: a real 18:00 board
  });
  it('hidden, deleted, gone, malformed: none', () => {
    assert.equal(cerStart(null), 0);
    assert.equal(cerStart(board({ st: 'hidden' })), 0);
    assert.equal(cerStart({ ...giftView(board(), S), phase: 'gone' }), 0);
    assert.equal(cerStart(board({ a: S + 60000 })), 0); // not a whole hour
    assert.equal(cerStart(board({ a: KST('2026-12-25T21:00:00') })), 0); // not a start hour
    assert.equal(cerStart({ ...board(), day: '2026-12-24' }), 0); // the day and the window disagree
    assert.equal(cerStart(board({ a: 'x' })), 0);
  });
});

describe('cerPhase: every edge exactly and 1 ms either side', () => {
  const g = board();
  const at = (ms, want) => assert.equal(cerPhase(g, ms), want, new Date(ms).toISOString());
  it('early | wait at start - 10 min', () => { at(S - CER.open - 1, 'early'); at(S - CER.open, 'wait'); at(S - CER.open + 1, 'wait'); });
  it('wait | count at start - 10 s', () => { at(S - CER.count - 1, 'wait'); at(S - CER.count, 'count'); at(S - CER.count + 1, 'count'); });
  it('count | lit at the start', () => { at(S - 1, 'count'); at(S, 'lit'); at(S + 1, 'lit'); });
  it('lit | over at start + 2 min', () => { at(S + CER.late - 1, 'lit'); at(S + CER.late, 'over'); at(S + CER.late + 1, 'over'); });
  it('the days before are early', () => { at(KST('2026-12-01T18:00:00'), 'early'); at(KST('2026-12-25T00:00:00'), 'early'); });
  it('a board without a fixed start, a hidden one and none at all are over at any time', () => {
    const now = KST('2026-12-25T13:47:00'), w = windowFor('2026-12-25', 'now', now);
    for (const t of [S - CER.open, S - 1, S, S + 1]) {
      assert.equal(cerPhase({ ...g, a: w.a, b: w.b }, t), 'over');
      assert.equal(cerPhase(board({ st: 'hidden' }), t), 'over');
      assert.equal(cerPhase(null, t), 'over');
    }
  });
  it('a start number (the localhost seam) works like a board', () => {
    const s = 1_800_000_123_456; // any ms, not a whole hour
    assert.equal(cerPhase(s, s - CER.count), 'count');
    assert.equal(cerPhase(s, s), 'lit');
    assert.equal(cerPhase(0, s), 'over');
  });
  it('the clock offset is the caller\'s: device clock + (server - device)', () => {
    const off = 7000, device = S - 5000; // the device is 7 s slow: the server is already past the start
    assert.equal(cerPhase(g, device), 'count');
    assert.equal(cerPhase(g, device + off), 'lit');
    assert.deepEqual([cerDigit(g, S - 3000 - off), cerDigit(g, S - 3000 - off + off)], [10, 3]); // the device alone says 10; with the offset, 3
  });
});

describe('time left, the countdown digit, the clock words', () => {
  const g = board();
  it('cerLeft', () => {
    assert.equal(cerLeft(g, S - 90000), 90000);
    assert.equal(cerLeft(g, S), 0);
    assert.equal(cerLeft(g, S + 5), 0);
    assert.equal(cerLeft(board({ st: 'hidden' }), S - 90000), 0);
  });
  it('cerDigit: 10..1 exactly while counting, 0 outside', () => {
    assert.equal(cerDigit(g, S - CER.count - 1), 0);
    assert.equal(cerDigit(g, S - CER.count), 10);
    assert.equal(cerDigit(g, S - 9001), 10);
    assert.equal(cerDigit(g, S - 9000), 9);
    assert.equal(cerDigit(g, S - 1001), 2);
    assert.equal(cerDigit(g, S - 1000), 1);
    assert.equal(cerDigit(g, S - 1), 1);
    assert.equal(cerDigit(g, S), 0);
    for (let t = S - CER.count - 2000; t < S + 2000; t += 250) assert.equal(cerDigit(g, t) > 0, cerPhase(g, t) === 'count', String(t - S));
  });
  it('cerClock: mm:ss, rounded up so the last second reads 00:01', () => {
    assert.equal(cerClock(CER.open), '10:00');
    assert.equal(cerClock(CER.open - 1), '10:00');
    assert.equal(cerClock(599000), '09:59');
    assert.equal(cerClock(1), '00:01');
    assert.equal(cerClock(0), '00:00');
    assert.equal(cerClock(-5), '00:00');
  });
  it('cerWhen: month, day and the 24-hour time, in another month and at 09:00 vs 18:00', () => {
    assert.equal(cerWhen(board()), '12월 25일 18:00');
    assert.equal(cerWhen(board({ day: '2027-01-03', hr: 9 })), '1월 3일 09:00');
    assert.equal(cerWhen(board({ day: '2026-11-30', hr: 12 })), '11월 30일 12:00');
    assert.equal(cerWhen(KST('2026-12-01T15:00:00')), '12월 1일 15:00');
    assert.equal(cerWhen(board({ st: 'hidden' })), '');
  });
});

describe('the recipient page: the button, the invitation, the owner\'s share line', () => {
  const g = board();
  it('before the window: says when and does not enter', () => {
    assert.deepEqual(cerButton(g, KST('2026-12-20T12:00:00')), { label: '🎆 점등식 같이 보기 · 12월 25일 18:00', act: 'early', href: '' });
    assert.deepEqual(cerButton(g, S - CER.open - 1), { label: '🎆 점등식 같이 보기 · 12월 25일 18:00', act: 'early', href: '' });
    assert.equal(CER_TEXT.early, '10분 전부터 들어올 수 있어요');
  });
  it('inside the window: into the plaza with &cer=1, the time left on the label', () => {
    assert.deepEqual(cerButton(g, S - CER.open), { label: '🎆 점등식 들어가기 · 10:00 남음', act: 'go', href: '/?gb=abcd1234&cer=1' });
    assert.equal(cerButton(g, S - 1).label, '🎆 점등식 들어가기 · 00:01 남음');
    assert.deepEqual(cerButton(g, S), { label: '🎆 방금 켜졌어요 · 점등식 보러 가기', act: 'go', href: '/?gb=abcd1234&cer=1' });
    assert.equal(cerButton(g, S + CER.late - 1).act, 'go');
  });
  it('at budget hard the button stays but does not enter', () => {
    assert.deepEqual(cerButton(g, S - 60000, { hard: true }), { label: '🎆 점등식 들어가기 · 01:00 남음', act: 'busy', href: '' });
    assert.equal(cerButton(g, S - CER.open - 1, { hard: true }).act, 'early'); // before the window it only says when
  });
  it('none after the late window, and none for a board without a fixed start', () => {
    assert.equal(cerButton(g, S + CER.late), null);
    assert.equal(cerButton({ ...g, a: S + 600000 }, S), null);
    assert.equal(cerButton(null, S), null);
  });
  it('the invitation carries the date and time and the page link', () => {
    assert.deepEqual(cerInvite(g, 'https://x.test/g/abcd1234'), {
      title: '🎆 민지님 선물 전광판 점등식',
      text: '12월 25일 18:00, 뉴욕 타임스퀘어 가상 광장에서 민지님의 전광판이 켜져요. 같이 보러 와요! 10분 전부터 들어올 수 있어요 👉',
      url: 'https://x.test/g/abcd1234',
    });
    assert.ok(cerInvite(board({ day: '2027-01-03', hr: 9 }), '').text.startsWith('1월 3일 09:00, '));
    assert.equal(cerInvite({ ...g, a: S + 600000 }, ''), null);
  });
  it('the owner\'s share text gains the time until the start, not after', () => {
    assert.equal(cerShareLine(g, KST('2026-12-20T12:00:00')), ' 🎆 점등식 12월 25일 18:00에 같이 봐요!');
    assert.equal(cerShareLine(g, S - 1), ' 🎆 점등식 12월 25일 18:00에 같이 봐요!');
    assert.equal(cerShareLine(g, S), '');
    assert.equal(cerShareLine({ ...g, a: S + 600000 }, S - 864e5), '');
  });
  it('the plaza sends a visitor back with a reason the page reads once', () => {
    assert.equal(cerBack('abcd1234', 'busy'), '/g/abcd1234?cer=busy');
    assert.equal(cerBack('abcd1234', 'early'), '/g/abcd1234?cer=early');
    assert.equal(cerBackWhy('?cer=busy'), 'busy');
    assert.equal(cerBackWhy('?x=1&cer=early'), 'early');
    assert.equal(cerBackWhy('?cer=1'), '');
    assert.equal(cerBackWhy(''), '');
    assert.equal(CER_TEXT.busy, '지금은 광장이 붐벼서 점등식에 들어갈 수 없어요. 잠시 뒤에 다시 해 주세요');
    assert.equal(cerUrl('abcd1234'), '/?gb=abcd1234&cer=1');
  });
});

describe('cerArrive: what /?gb=<id>&cer=1 does', () => {
  const g = board();
  it('early → back to the page; hard inside the window → back; inside → go', () => {
    assert.equal(cerArrive(g, S - CER.open - 1), 'early');
    assert.equal(cerArrive(g, S - CER.open), 'go');
    assert.equal(cerArrive(g, S - 1), 'go');
    assert.equal(cerArrive(g, S + CER.late - 1), 'go');
    assert.equal(cerArrive(g, S - 60000, { hard: true }), 'busy');
    assert.equal(cerArrive(g, S + 1000, { hard: true }), 'busy');
    assert.equal(cerArrive(g, S - CER.open - 1, { hard: true }), 'early');
  });
  it('after the late window or without a fixed start: the ordinary ?gb= visit; no board: gone', () => {
    assert.equal(cerArrive(g, S + CER.late), 'plain');
    assert.equal(cerArrive({ ...g, a: S + 600000 }, S), 'plain');
    assert.equal(cerArrive(null, S), 'gone');
  });
  it('a start passed in (the localhost seam) overrides the board\'s', () => {
    const s = S + 3 * 864e5 + 1234;
    assert.equal(cerArrive({ ...g, a: S + 600000 }, s - 60000, { start: s }), 'go');
  });
});

describe('the teaser card never carries the message', () => {
  it('its fields', () => {
    const g = board();
    const t = cerTeaser(g, S - 90000);
    assert.deepEqual(t, { to: '민지', chip: '곧 켜져요', left: '01:30', when: '18:00', emoji: '🎂', th: 'party' });
    assert.ok(!JSON.stringify(t).includes('비밀'), 'no message text');
    assert.ok(!('msg' in t) && !('from' in t));
  });
  it('a name at the limit is whole, one over is cut', () => {
    const twelve = '가나다라마바사아자차카타';
    assert.equal(cerTeaser(board({ to: twelve }), S - 1000).to, twelve);
    assert.equal(cerTeaser(board({ to: twelve + '파' }), S - 1000).to, twelve);
    assert.equal(cerTeaser(board({ to: '' }), S - 1000).to, '당신');
  });
  it('the theme falls back to the occasion\'s, the start can be passed in', () => {
    assert.equal(cerTeaser(board({ occ: 'pass', th: '' }), S - 1000).th, 'gold');
    assert.equal(cerTeaser(board({ th: 'sky' }), S - 1000).th, 'sky');
    const s = S + 1234567; assert.equal(cerTeaser(board(), s - 61000, s).left, '01:01');
  });
});

describe('the group photo', () => {
  it('the band', () => {
    assert.equal(cerBand(board()), 'To. 민지 · 2026.12.25 · WISH BOARD 가상 광장');
    assert.equal(cerBand(board({ day: '2027-01-03', hr: 9 })), 'To. 민지 · 2027.01.03 · WISH BOARD 가상 광장');
    assert.equal(cerBand(board({ to: '가나다라마바사아자차카타파' })), 'To. 가나다라마바사아자차카타 · 2026.12.25 · WISH BOARD 가상 광장');
  });
  it('the share words', () => {
    assert.equal(cerPhotoText(board()), '🎆 민지님 선물 전광판 점등식에서 · WISH BOARD 가상 광장');
  });
  it('the arrival toast', () => {
    assert.equal(cerArriveNote(board(), S - 60000), '🎆 민지님 선물 전광판 점등식 · 18:00에 켜져요');
    assert.equal(cerArriveNote(board(), S + 1000), '🎆 민지님 선물 전광판이 방금 켜졌어요!');
  });
});

describe('cerPinMs: one pin from arrival past the late window', () => {
  const g = board();
  it('until start + late + hold, at least a minute', () => {
    assert.equal(cerPinMs(g, S - CER.open), CER.open + CER.late + CER.hold);
    assert.equal(cerPinMs(g, S), CER.late + CER.hold);
    assert.equal(cerPinMs(g, S + CER.late + 30000), CER.hold);
    assert.equal(cerPinMs(null, S), CER.hold);
  });
});

describe('cerSteps: the once-per-device steps, and where a hidden tab resumes', () => {
  // Drive a device the way the plaza does: one call per tick, mark what it did.
  function run(from, to, step = 250, { start = S, done = {} } = {}) {
    const log = [];
    for (let t = from; t <= to; t += step) {
      const s = cerSteps(start, t, done);
      if (s.phase === 'wait' || s.phase === 'count') done.before = true;
      for (const k of ['teaser', 'count', 'light', 'cheer', 'round', 'pose', 'shot', 'offer', 'end']) {
        if (k === 'round') { if (s.round >= 0) { done.rounds = s.round + 1; log.push(['round' + s.round, t - start]); } }
        else if (s[k]) { done[k] = true; log.push([k, t - start]); }
      }
    }
    return { log, done };
  }
  const names = (log) => log.map((x) => x[0]);
  it('an arrival in the window: teaser, count, light, cheer, six rounds, pose, shot, end; never an offer', () => {
    const { log } = run(S - 120000, S + CER.late + 1000);
    assert.deepEqual(names(log), ['teaser', 'count', 'light', 'cheer', 'round0', 'round1', 'round2', 'round3', 'round4', 'round5', 'pose', 'shot', 'end']);
    const at = Object.fromEntries(log);
    assert.equal(at.count, -CER.count);
    assert.equal(at.light, 0);
    assert.equal(at.cheer, 0);
    assert.equal(at.round5, 5 * CER.roundMs);
    assert.equal(at.pose, CER.pose);
    assert.equal(at.shot, CER.shot);
    assert.equal(at.end, CER.late);
  });
  it('a late arrival: light, one round, the photo offered (never taken by itself), no countdown, no cheer after 5 s', () => {
    const { log } = run(S + 30000, S + CER.late + 1000);
    assert.deepEqual(names(log), ['light', 'round0', 'offer', 'end']);
    assert.deepEqual(names(run(S + 2000, S + 3000).log), ['light', 'cheer', 'round0', 'offer']); // within the cheer's 5 s it still cheers
  });
  it('a tab hidden across the start resumes at the phase it is in now', () => {
    // seen in the wait, hidden from -20 s to +3.7 s: no countdown, the rounds still due from now on (3..5), the photo on time
    const a = run(S - 60000, S - 20000);
    const { log } = run(S + 3700, S + 20000, 250, { done: a.done });
    assert.deepEqual(names(log), ['light', 'cheer', 'round3', 'round4', 'round5', 'pose', 'shot']);
    // hidden past the photo's slack: one round, then the offer
    const b = run(S - 60000, S - 20000);
    assert.deepEqual(names(run(S + CER.shot + CER.shotSlack, S + 30000, 250, { done: b.done }).log), ['light', 'round0', 'offer']);
    // back in the countdown: count at once
    const c = run(S - 60000, S - 20000);
    assert.deepEqual(names(run(S - 4000, S - 3000, 250, { done: c.done }).log), ['count']);
  });
  it('early and over do nothing; over after a ceremony ends it once', () => {
    assert.deepEqual(names(run(S - CER.open - 5000, S - CER.open - 1).log), []);
    assert.deepEqual(names(run(S + CER.late, S + CER.late + 5000).log), []);
    const s = cerSteps(S, S + CER.late, { light: true });
    assert.equal(s.end, true);
    assert.equal(cerSteps(S, S + CER.late, { light: true, end: true }).end, false);
    assert.equal(cerSteps(0, S, {}).phase, 'over');
  });
});

describe('the localhost seam and the beacons', () => {
  const now = S - 864e5;
  it('?cerin=<seconds> is read only on a local development host', () => {
    assert.equal(cerDebugStart('?gb=abcd1234&cer=1&cerin=90', 'localhost', now), now + 90000);
    assert.equal(cerDebugStart('?cerin=90', '127.0.0.1', now), now + 90000);
    assert.equal(cerDebugStart('?cerin=90', 'kts.localhost', now), now + 90000);
    assert.equal(cerDebugStart('?cerin=-30', 'localhost', now), now - 30000); // a late arrival, 30 s after
    assert.equal(cerDebugStart('?cerin=90', 'studio.wishboard.workers.dev', now), 0);
    assert.equal(cerDebugStart('?cerin=90', 'localhost.evil.com', now), 0);
    assert.equal(cerDebugStart('?cerin=abc', 'localhost', now), 0);
    assert.equal(cerDebugStart('?cerin=99999', 'localhost', now), 0); // at most an hour either way
    assert.equal(cerDebugStart('', 'localhost', now), 0);
  });
  it('the two beacon keys', () => { assert.deepEqual([...CER_BEACONS], ['cer', 'cershot']); });
  it('beaconOnce: one per board, event and KST day on this device', () => {
    let r = beaconOnce({}, 'abcd1234', 'cer', '2026-12-25');
    assert.equal(r.send, true); assert.equal(r.seen['abcd1234:cer'], '2026-12-25');
    r = beaconOnce(r.seen, 'abcd1234', 'cer', '2026-12-25'); assert.equal(r.send, false);
    r = beaconOnce(r.seen, 'abcd1234', 'cershot', '2026-12-25'); assert.equal(r.send, true);
    r = beaconOnce(r.seen, 'abcd1234', 'cer', '2026-12-26'); assert.equal(r.send, true);
    const big = Object.fromEntries(Array.from({ length: 201 }, (_, i) => ['k' + i, '2026-12-01']));
    r = beaconOnce(big, 'abcd1234', 'cer', '2026-12-25');
    assert.equal(r.send, true); assert.equal(Object.keys(r.seen).length, 102); assert.ok(!('k0' in r.seen) && 'k100' in r.seen);
    assert.equal(beaconOnce(null, 'abcd1234', 'cer', '2026-12-25').send, true);
  });
});
