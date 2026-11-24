// 같이 춤추기 (dance.js): the plaza radio, the bar and beat, the choreography, the December carol, the nearby dancers and the
// re-send cadence. Everything comes from the clock, so two devices at the same nowMs() play the same thing.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DANCE_TRACKS, DANCE_CLIPS, DANCER_MS, RESEND_MS, SUSTAIN_MS, NEAR_M,
  carolSeason, radioList, radioAt, trackMs, barMs, clipAt, seenDancer, isDancing, isSustained, nearDancers, resendDue, spanBucket,
} from '../dance.js';
import { TRACKS, loopBars } from '../bgm.js';
import { CLIPS } from '../ts3d/gestures.js';

const KST = 9 * 3600e3;
const at = (y, m, d, h = 12, min = 0) => Date.UTC(y, m - 1, d, h, min) - KST; // a KST wall time as epoch ms

describe('dance.js tracks', () => {
  it('four dance tracks: three originals at 100-124 BPM with Korean names of our own, and 징글벨', () => {
    assert.equal(DANCE_TRACKS.length, 4);
    const ids = DANCE_TRACKS.map((t) => t.id);
    assert.deepEqual(ids, ['neon', 'disco', 'groove', 'jingle']);
    for (const t of DANCE_TRACKS) {
      assert.ok(TRACKS[t.id], t.id + ' is a bgm.js track');
      assert.equal(t.bpm, TRACKS[t.id].bpm, t.id);
      assert.ok(t.bpm >= 100 && t.bpm <= 124, t.id);
      assert.match(t.name, /^[가-힣 ]+$/, t.id);
      assert.ok(t.bars >= 32 && t.bars <= 64, t.id);
      assert.ok(t.bars <= loopBars(TRACKS[t.id]) * 16, 'the synth does not wrap inside a radio slot');
    }
    assert.equal(new Set(DANCE_TRACKS.map((t) => t.bpm)).size, 4, 'four different tempos');
    assert.equal(DANCE_TRACKS.find((t) => t.id === 'jingle').name, '징글벨');
    assert.equal(DANCE_TRACKS.find((t) => t.id === 'jingle').season, true);
    assert.equal(DANCE_TRACKS.filter((t) => t.season).length, 1);
  });
  it('the choreography uses only the model clips Dance, Wave, Jump, ThumbsUp, Yes and No, and starts each track dancing', () => {
    assert.deepEqual([...DANCE_CLIPS].sort(), ['Dance', 'Jump', 'No', 'ThumbsUp', 'Wave', 'Yes']);
    for (const c of DANCE_CLIPS) assert.ok(CLIPS.includes(c), c);
    for (const t of DANCE_TRACKS) {
      assert.ok(t.moves.length >= 8, t.id);
      for (const m of t.moves) assert.ok(DANCE_CLIPS.includes(m), t.id + ' ' + m);
      assert.equal(t.moves[0], 'Dance', t.id);
      assert.ok(t.moves.filter((m) => m !== 'Dance').length >= 2, t.id + ' does more than the loop');
      assert.equal(clipAt(t.id, 0), 'Dance');
      assert.equal(clipAt(t.id, t.moves.length), t.moves[0], 'the table repeats');
    }
    assert.equal(clipAt('nope', 3), 'Dance');
  });
});

describe('the December carol', () => {
  it('징글벨 is in the radio from 1 December to 1 January (KST), not otherwise', () => {
    assert.equal(carolSeason(at(2026, 11, 30, 23, 59)), false);
    assert.equal(carolSeason(at(2026, 12, 1, 0, 0)), true);
    assert.equal(carolSeason(at(2026, 12, 25)), true);
    assert.equal(carolSeason(at(2027, 1, 1, 23, 59)), true);
    assert.equal(carolSeason(at(2027, 1, 2, 0, 0)), false);
    assert.equal(carolSeason(at(2027, 7, 1)), false);
    // the KST day, not the UTC one: 1 December 00:30 KST is still 30 November in UTC
    assert.equal(new Date(at(2026, 12, 1, 0, 30)).getUTCDate(), 30);
    assert.equal(carolSeason(at(2026, 12, 1, 0, 30)), true);
    assert.deepEqual(radioList(at(2026, 11, 24)).map((t) => t.id), ['neon', 'disco', 'groove']);
    assert.deepEqual(radioList(at(2026, 12, 24)).map((t) => t.id), ['neon', 'disco', 'groove', 'jingle']);
    assert.equal(radioList(at(2026, 11, 24)), radioList(at(2026, 11, 25)), 'one list, not a new array per call');
  });
  it('the carol plays in December and never in November', () => {
    const seen = (t0) => { const s = new Set(); for (let t = t0; t < t0 + 3 * 3600e3; t += 20e3) s.add(radioAt(t).id); return s; };
    assert.equal(seen(at(2026, 11, 24)).has('jingle'), false);
    assert.equal(seen(at(2026, 12, 24)).has('jingle'), true);
  });
});

describe('the plaza radio', () => {
  it('the same clock gives every device the same track, bar, beat and move', () => {
    const t = at(2026, 11, 24, 21, 7) + 12345.6;
    const a = radioAt(t), b = radioAt(t);
    assert.deepEqual(a, b);
    for (const k of ['index', 'id', 'name', 'bpm', 'posMs', 'bar', 'beat', 'phase', 'clip', 'key', 'leftMs', 'barMs']) assert.ok(k in a, k);
    assert.ok(a.bar >= 0 && a.bar < DANCE_TRACKS.find((x) => x.id === a.id).bars);
    assert.ok(a.beat >= 0 && a.beat < 4);
    assert.ok(a.phase >= 0 && a.phase < 1);
    assert.equal(a.clip, clipAt(a.id, a.bar));
    assert.ok(Math.abs(a.posMs - (a.bar * a.barMs + a.beat * a.barMs / 4 + a.phase * a.barMs / 4)) < 1e-6);
  });
  it('a late joiner is on the same bar as the one who started earlier (the position is the clock, not the start)', () => {
    const t = at(2026, 11, 24, 15);
    const early = radioAt(t), late = radioAt(t);
    assert.equal(early.key, late.key);
    // one bar later the key moves on by one, the track stays
    const next = radioAt(t + early.barMs * (early.bar + 1 < DANCE_TRACKS.find((x) => x.id === early.id).bars ? 1 : 0));
    if (next.id === early.id && next.bar === early.bar + 1) assert.notEqual(next.key, early.key);
  });
  it('the radio walks the list in order, each track for its own length, and loops', () => {
    const list = radioList(at(2026, 11, 24));
    const cycle = list.reduce((s, t) => s + trackMs(t), 0);
    let t = Math.ceil(at(2026, 11, 24) / cycle) * cycle; // a cycle boundary
    for (const tr of list) {
      const r = radioAt(t + 1);
      assert.equal(r.id, tr.id);
      assert.equal(r.bar, 0);
      assert.equal(r.index, list.indexOf(tr));
      assert.ok(Math.abs(r.leftMs - (trackMs(tr) - 1)) < 1e-3);
      const end = radioAt(t + trackMs(tr) - 1);
      assert.equal(end.id, tr.id);
      assert.equal(end.bar, tr.bars - 1, 'the last bar before the change');
      t += trackMs(tr);
    }
    assert.equal(radioAt(t + 1).id, list[0].id, 'and round again');
  });
  it('trackMs and barMs come from the BPM (four beats a bar)', () => {
    const neon = DANCE_TRACKS[0];
    assert.equal(barMs(neon), 4 * 60000 / neon.bpm);
    assert.equal(trackMs(neon), neon.bars * barMs(neon));
    for (const tr of DANCE_TRACKS) assert.ok(trackMs(tr) > 60e3 && trackMs(tr) < 130e3, tr.id + ' is one to two minutes');
  });
  it('the server offset (live.js clock.off) is part of the time: devices with different clocks agree once it is added', () => {
    const server = at(2026, 11, 24, 18) + 777;
    const aClock = server - 1500, aOff = 1500; // device A runs 1.5 s slow
    const bClock = server + 900, bOff = -900;  // device B runs 0.9 s fast
    assert.deepEqual(radioAt(aClock + aOff), radioAt(bClock + bOff));
    assert.notDeepEqual(radioAt(aClock), radioAt(bClock), 'without the offset they would not');
  });
  it('fills a given object instead of making one (the world calls it every frame)', () => {
    const out = {};
    const r = radioAt(at(2026, 11, 24), out);
    assert.equal(r, out);
    radioAt(at(2026, 11, 24) + 5000, out);
    assert.equal(Object.keys(out).length, Object.keys(radioAt(1)).length);
    assert.doesNotThrow(() => radioAt(NaN));
    assert.equal(radioAt(-5).bar >= 0, true);
  });
});

describe('dancers nearby', () => {
  it('a reaction marks a player dancing for DANCER_MS after the last one; the signal stopping stops them', () => {
    assert.ok(RESEND_MS + 1000 < DANCER_MS, 'one late re-send does not drop a dancer');
    assert.ok(DANCER_MS < 2 * RESEND_MS, 'two missing ones do');
    const r = { x: 0, z: 0 };
    assert.equal(isDancing(r, 1000), false);
    assert.equal(seenDancer(r, 1000), true, 'the first signal is news');
    assert.equal(isDancing(r, 1000 + DANCER_MS), true);
    assert.equal(isDancing(r, 1001 + DANCER_MS), false);
    assert.equal(seenDancer(r, 1000 + RESEND_MS), false, 'a re-send is not news');
    assert.equal(isDancing(r, 1000 + RESEND_MS + DANCER_MS), true);
    assert.equal(seenDancer(r, 1000 + RESEND_MS + DANCER_MS + 1), true, 'after a gap it starts again');
  });
  it('a single K-댄스 reaction is not a sustained dance; a re-sent one is (that is what the invite waits for)', () => {
    const r = { x: 0, z: 0 };
    seenDancer(r, 100);
    assert.equal(isSustained(r, 110), false);
    seenDancer(r, 100 + RESEND_MS);
    assert.ok(RESEND_MS >= SUSTAIN_MS);
    assert.equal(isSustained(r, 110 + RESEND_MS), true);
    assert.equal(isSustained(r, 101 + RESEND_MS + DANCER_MS), false);
  });
  it('counts the players dancing within NEAR_M (15 m) of a point', () => {
    assert.equal(NEAR_M, 15);
    const now = 50000;
    const list = [
      { id: 'a', lastSeen: now - 100, x: 3, z: 4 },
      { id: 'b', lastSeen: now - 100, x: 10, z: 11.18 }, // 15.0 m
      { id: 'c', lastSeen: now - 100, x: 12, z: 12 },    // 17 m
      { id: 'd', lastSeen: now - DANCER_MS - 1, x: 1, z: 1 }, // stopped
      { id: 'e', lastSeen: 0, x: 0, z: 0 }, // never danced
      null,
    ];
    assert.equal(nearDancers(list, now, 0, 0), 2);
    assert.equal(nearDancers(list, now, 0, 0, 30), 3);
    assert.equal(nearDancers([], now, 0, 0), 0);
    assert.equal(nearDancers(null, now, 0, 0), 0);
  });
  it('re-sends the dance reaction every RESEND_MS, never inside the emote cooldown', async () => {
    const { EMOTE_GAP_MS } = await import('../camrig.js');
    assert.equal(resendDue(10000, 10000 - RESEND_MS, 0, EMOTE_GAP_MS), true);
    assert.equal(resendDue(10000, 10000 - RESEND_MS + 1, 0, EMOTE_GAP_MS), false);
    assert.equal(resendDue(10000, 0, 10000 - EMOTE_GAP_MS + 1, EMOTE_GAP_MS), false, 'another emote just went out');
    assert.equal(resendDue(10000, 0, 10000 - EMOTE_GAP_MS, EMOTE_GAP_MS), true);
  });
  it('dance_end carries a duration bucket, not the seconds', () => {
    assert.equal(spanBucket(5000), 'under_30s');
    assert.equal(spanBucket(29999), 'under_30s');
    assert.equal(spanBucket(30000), '30s_2m');
    assert.equal(spanBucket(119999), '30s_2m');
    assert.equal(spanBucket(120000), '2m_5m');
    assert.equal(spanBucket(300000), '5m_plus');
    assert.equal(spanBucket(NaN), 'under_30s');
  });
});
