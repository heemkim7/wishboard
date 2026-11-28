// 같이 춤추기 (docs/superpowers/specs/2026-11-24-dance-together-design.md): no score, no judging. Everything here comes from
// the clock (live.js nowMs(), the server offset included), so two devices at the same moment play the same track at the
// same bar and their avatars make the same move: a flash mob with no server signal.
//
//   the plaza radio   the dance tracks in turn, each for its own length, from the epoch: radioAt(t) is the track, bar, beat
//                     and the move for that bar. No picker: dancing together needs the same track.
//   the carol         징글벨 is on the radio only from 1 December to 1 January (KST).
//   others            a dancer re-sends the existing K-댄스 reaction ({t:'E', k, e: 4}) every RESEND_MS, never inside the
//                     emote cooldown; a receiver marks that player dancing for DANCER_MS after the last one. Nothing new is
//                     sent, stored or scored.
//
// No DOM and no three.js here (Node tests run it). radioAt fills an object it is given, so the world can ask every frame
// without making one.
import { TRACKS } from './bgm.js?v=202611281741';

// The model's clips a move may use (ts3d/gestures.js CLIPS): the Dance loop between the others.
export const DANCE_CLIPS = Object.freeze(['Dance', 'Wave', 'Jump', 'ThumbsUp', 'Yes', 'No']);
const D = 'Dance';
const mk = (id, name, bars, moves, season = false) => Object.freeze({ id, name, bpm: TRACKS[id].bpm, bars, moves: Object.freeze(moves), season });
// moves: one per bar, round and round (a bar is four beats: 1.9 s at 124 BPM, 2.4 s at 100).
export const DANCE_TRACKS = Object.freeze([
  mk('neon', '네온 스텝', 48, [D, D, 'Wave', D, 'Jump', D, 'ThumbsUp', D, D, 'Yes', D, 'Jump', D, 'Wave', 'Jump', D]),
  mk('disco', '반짝 미러볼', 44, [D, D, D, 'Wave', D, D, 'ThumbsUp', 'Jump']),
  mk('groove', '골목 그루브', 40, [D, 'Yes', D, D, 'Wave', D, 'No', D]),
  mk('jingle', '징글벨', 48, [D, D, D, 'Jump', D, D, D, 'Wave', D, D, D, 'Jump', D, D, 'ThumbsUp', 'Jump'], true),
]);
const BY_ID = Object.freeze(Object.fromEntries(DANCE_TRACKS.map((t) => [t.id, t])));

export const DANCER_MS = 6500;   // a player is dancing this long after their last K-댄스 reaction
export const RESEND_MS = 4000;   // how often a dancer re-sends it
export const SUSTAIN_MS = 3000;  // a re-sent one, not a single K-댄스 tap: what the "같이 춤추기" notice waits for
export const NEAR_M = 15;        // 지금 N명이 같이 춰요 and the notice count dancers this close

export function barMs(track) { return 240000 / track.bpm; }
export function trackMs(track) { return track.bars * barMs(track); }

const KST_MS = 9 * 3600e3;
/** 1 December 00:00 to 1 January 23:59 KST. */
export function carolSeason(t) {
  const d = new Date((Number(t) || 0) + KST_MS);
  const m = d.getUTCMonth();
  return m === 11 || (m === 0 && d.getUTCDate() === 1);
}
const PLAIN = Object.freeze(DANCE_TRACKS.filter((t) => !t.season));
const ALL = DANCE_TRACKS;
const CYCLE = new Map([[PLAIN, PLAIN.reduce((s, t) => s + trackMs(t), 0)], [ALL, ALL.reduce((s, t) => s + trackMs(t), 0)]]);
/** The tracks on the radio at t (one of two fixed lists). */
export function radioList(t) { return carolSeason(t) ? ALL : PLAIN; }

/** The move for a bar of a track ('Dance' for an unknown track). */
export function clipAt(id, bar) {
  const tr = BY_ID[id];
  if (!tr) return D;
  const m = tr.moves;
  return m[((Math.floor(bar) % m.length) + m.length) % m.length];
}

/** What the radio plays at t: { index, id, name, bpm, posMs, barMs, bar, beat, phase, clip, key, leftMs }. key changes
 *  with every bar (and every track), so "a new bar" is key !== the last one. out: filled in place when given. */
export function radioAt(t, out = {}) {
  const list = radioList(t);
  const cycle = CYCLE.get(list);
  const now = Number.isFinite(t) ? t : 0;
  const lap = Math.floor(now / cycle);
  let pos = now - lap * cycle, index = 0;
  while (index < list.length - 1 && pos >= trackMs(list[index])) { pos -= trackMs(list[index]); index++; }
  const tr = list[index], bm = barMs(tr), qm = bm / 4;
  const bar = Math.min(tr.bars - 1, Math.floor(pos / bm));
  const inBar = pos - bar * bm;
  const beat = Math.min(3, Math.floor(inBar / qm));
  out.index = index;
  out.id = tr.id;
  out.name = tr.name;
  out.bpm = tr.bpm;
  out.posMs = pos;
  out.barMs = bm;
  out.bar = bar;
  out.beat = beat;
  out.phase = Math.min(0.999999, Math.max(0, (inBar - beat * qm) / qm));
  out.clip = clipAt(tr.id, bar);
  out.key = (lap * 8 + index) * 1000 + bar;
  out.leftMs = trackMs(tr) - pos;
  return out;
}

// ---- dancers (records the caller keeps: { lastSeen, firstSeen, x, z }, times on the caller's own clock) ----
/** A K-댄스 reaction from this player arrived at now. -> true when they were not dancing before (news). */
export function seenDancer(rec, now) {
  const fresh = !isDancing(rec, now);
  if (fresh) rec.firstSeen = now;
  rec.lastSeen = now;
  return fresh;
}
export function isDancing(rec, now) { return !!rec && rec.lastSeen > 0 && now - rec.lastSeen <= DANCER_MS; }
/** Dancing, and for longer than one reaction: a 같이 춤추기 rather than a single K-댄스 tap. */
export function isSustained(rec, now) { return isDancing(rec, now) && rec.lastSeen - rec.firstSeen >= SUSTAIN_MS; }
/** How many of list are dancing within r metres of (x, z). No allocation. */
export function nearDancers(list, now, x, z, r = NEAR_M) {
  if (!list) return 0;
  let n = 0;
  const r2 = r * r;
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    if (!d || !isDancing(d, now)) continue;
    const dx = d.x - x, dz = d.z - z;
    if (dx * dx + dz * dz <= r2 + 1e-6) n++;
  }
  return n;
}
/** Time to re-send the dance reaction: RESEND_MS since the last one, and outside the emote cooldown (camrig.js EMOTE_GAP_MS). */
export function resendDue(now, sentAt, lastEmote, gap) { return now - sentAt >= RESEND_MS && !(now - lastEmote < gap); }

/** dance_end's duration, as a bucket (the event never carries the seconds). */
export function spanBucket(ms) {
  const s = Number(ms) / 1000;
  if (!(s >= 30)) return 'under_30s';
  if (s < 120) return '30s_2m';
  if (s < 300) return '2m_5m';
  return '5m_plus';
}
