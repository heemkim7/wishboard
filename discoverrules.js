// /discover (둘러보기, 2026-11-27): the pure rules of a read-only page without the 3D plaza. Its items come only from what the plaza already reads
// and caches: /rt/world (boards, the gifts up now, the wish board) and /rt/wishes (today's wishes). No new DO call per visit.
//   gift   a gift board hanging now whose owner turned DISCOVER on (dc: 1 in the world entry; giftsrv.js discover). Off by default.
//   board  a plaza board a person keeps lit now (holder guest: / user:, lit_until or expires_at ahead)
//   wish   a wish of today (the top, the recent, the world's wish board; once each)
// Popularity only orders a list (never a rank or a count on the page). When a tab has fewer real items than DISCOVER.min (the plaza's own
// public threshold, ftue.js PUBLIC_MIN.wishes), the page adds seasonal samples in a section of their own, labelled SAMPLE_LABEL, never
// counted and never mixed into the list.
// Browser only (the page imports it as ./discoverrules.js?v=BUILD); giftrules.js is the Worker's too, imported with no query.
import { GIFT_ID, OCCASIONS, toLine, isMe } from './giftrules.js';

export const DISCOVER = Object.freeze({ min: 5, max: 30, refreshMs: 120000 }); // refreshMs: an open page reads the world again (a board taken off DISCOVER leaves)
export const TABS = Object.freeze([
  Object.freeze({ k: 'hot', name: '지금 인기' }), Object.freeze({ k: 'new', name: '새로 걸린' }), Object.freeze({ k: 'bday', name: '생일' }),
  Object.freeze({ k: 'cheer', name: '응원' }), Object.freeze({ k: 'me', name: '개인 전광판' }), Object.freeze({ k: 'wish', name: '소원' }),
]);
export const SAMPLE_LABEL = '예시 · WISH BOARD';
const WISH_ID = /^[0-9a-z]{10}$/, SLOT = /^[A-Z]+_[A-Z0-9_]+$/;
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v, n = 40) => Array.from(String(v ?? '').replace(/\s+/g, ' ').trim()).slice(0, n).join('');
const ms = (v) => { const t = typeof v === 'number' ? v : Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; };

/** { world, wishes, now } -> the items (any order): { kind, id, occ, th, chip, big, line, by, heat, at, view, page, heart, make }. */
export function discoverItems({ world = null, wishes = null, now = Date.now() } = {}) {
  const out = [];
  for (const g of arr(world?.gifts)) {
    if (!g || Number(g.dc) !== 1 || !GIFT_ID.test(String(g.id || '')) || !(Number(g.a) <= now && now < Number(g.b))) continue;
    const occ = Object.hasOwn(OCCASIONS, String(g.occ)) ? String(g.occ) : 'bday', O = OCCASIONS[occ], me = isMe({ occ });
    out.push({ kind: 'gift', id: String(g.id), occ, th: str(g.th, 12), chip: O.emoji + ' ' + O.name, big: toLine({ occ, to: str(g.to, 12) }), line: str(g.msg) || O.hint,
      by: !me && str(g.from, 12) ? 'From. ' + str(g.from, 12) : '', heat: Math.max(0, Number(g.n) || 0), at: Number(g.a) || 0,
      view: '/?gb=' + g.id, page: '/g/' + g.id, heart: 'gift', make: me ? '/gift?me=1' : '/gift',
      art: { id: String(g.id), to: str(g.to, 12), from: me ? '' : str(g.from, 12), occ, msg: str(g.msg), th: str(g.th, 12) } }); // art: what giftart.js paintGift draws
  }
  for (const b of arr(world?.billboards)) {
    if (!b || !SLOT.test(String(b.slot_id || '')) || !/^(guest|user):/.test(String(b.holder_id || '')) || !(ms(b.lit_until || b.expires_at) > now)) continue;
    const lines = [b.line1, b.line2, b.line3].map((s) => str(s, 24)).filter(Boolean), name = str(b.holder_name, 16);
    out.push({ kind: 'board', id: String(b.slot_id), occ: '', th: '', chip: '가상 타임스퀘어 전광판', big: lines[0] || name || '빈 전광판', line: lines.slice(1).join(' · '), by: name ? 'by ' + name : '',
      heat: Math.max(0, (Number(b.views) || 0) + (Number(b.cheers) || 0)), at: ms(b.updated_at), view: '/?focus=' + b.slot_id, page: '/rt/card/' + b.slot_id, heart: '', make: '/gift' });
  }
  const seen = new Set();
  for (const w of [...arr(wishes?.top), ...arr(wishes?.recent), ...arr(world?.wish?.board)]) {
    const id = String(w?.id || '');
    if (!WISH_ID.test(id) || seen.has(id) || w.hidden || !str(w.txt)) continue;
    seen.add(id);
    out.push({ kind: 'wish', id, occ: '', th: '', chip: '오늘의 소원', big: str(w.txt, 60), line: '', by: str(w.nick, 16) ? str(w.nick, 16) + '님의 소원' : '', heat: Math.max(0, Number(w.hearts) || 0), at: Number(w.at) || 0,
      view: '/?wish=' + id, page: '/rt/w/' + id, heart: 'wish', make: '/gift' });
  }
  return out;
}

const byHeat = (x, y) => y.heat - x.heat || y.at - x.at || String(x.id).localeCompare(String(y.id));
const byAt = (x, y) => y.at - x.at || y.heat - x.heat || String(x.id).localeCompare(String(y.id));
/** The items of one tab (TABS k), in its order, at most DISCOVER.max. */
export function discoverTab(items, tab) {
  const all = arr(items), gifts = (occ) => all.filter((x) => x.kind === 'gift' && x.occ === occ).sort(byAt);
  const list = tab === 'hot' ? [...all].sort(byHeat) : tab === 'new' ? [...all].sort(byAt) : tab === 'bday' || tab === 'cheer' || tab === 'me' ? gifts(tab)
    : tab === 'wish' ? all.filter((x) => x.kind === 'wish').sort(byHeat) : [];
  return list.slice(0, DISCOVER.max);
}

// Samples by season (KST month): what a board can look like, clearly an example. Never a real name of anyone.
const S = (occ, to, msg) => ({ occ, to, msg });
const SEASON = [
  { m: [12, 1], list: [S('bday', '우리 엄마', '메리 크리스마스, 늘 고마워요'), S('me', '하늘', '올해도 수고했어, 나!'), S('cheer', '수험생 친구들', '새해엔 다 잘될 거야'), S('love', '너', '함께한 연말이 제일 따뜻했어')] },
  { m: [2, 3], list: [S('grad', '졸업하는 동생', '새 출발을 응원해!'), S('me', '민준', '새 학기, 매일 한 페이지'), S('love', '너', '봄에도 같이 걷자')] },
  { m: [4, 5, 6], list: [S('thanks', '선생님', '가르쳐 주셔서 고맙습니다'), S('bday', '단짝', '생일 축하해, 오늘은 네가 주인공'), S('me', '다온', '첫 공연을 마쳤어요')] },
  { m: [7, 8, 9], list: [S('cheer', '우리 팀', '끝까지 같이 가자!'), S('me', '서윤', '첫 마라톤 완주!'), S('anniv', '우리', '100일 축하해')] },
  { m: [10, 11], list: [S('pass', '수험생', '고생 많았어, 정말 축하해!'), S('me', '지호', '새 앨범이 나왔어요'), S('bday', '친구', '태어나 줘서 고마워!')] },
];
/** The samples for the KST month of now: { kind: 'sample', sample: true, occ, th, chip, big, line, by } with no link to anything. */
export function samplesFor(now = Date.now()) {
  const m = new Date(now + 9 * 36e5).getUTCMonth() + 1, set = SEASON.find((x) => x.m.includes(m)) || SEASON[0];
  return set.list.map((s, i) => ({ kind: 'sample', sample: true, id: 'sample' + i, occ: s.occ, th: OCCASIONS[s.occ].th, chip: OCCASIONS[s.occ].emoji + ' ' + OCCASIONS[s.occ].name, big: toLine(s), line: s.msg, by: '',
    heat: 0, at: 0, view: '', page: '', heart: '', make: s.occ === 'me' ? '/gift?me=1' : '/gift', art: { id: 'sample' + i, to: s.to, from: '', occ: s.occ, msg: s.msg, th: OCCASIONS[s.occ].th } }));
}
/** Whether an open page should read the world again: on screen and DISCOVER.refreshMs since the last read (or a clock that went back). */
export const refreshDue = (last, now = Date.now(), hidden = false) => !hidden && (now - Number(last) >= DISCOVER.refreshMs || now < Number(last));
