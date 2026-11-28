// 출시 예정 (2026-11-28, the owner): the service stays free; the features that may come later are shown only as "출시 예정" with one
// button, "이 기능에 관심 있어요", to see which one people want first. Nothing here sells: no price, no date, no buy or pay word, no
// promise of a notice, and none of them is a feature that is free today (the 3D pop-out real video, the card image, the 15 s film, the
// main tower minute, making and sharing a board). Plain data and checks, shared by the pages (soon.js) and the Worker (giftsrv.js).
//
// What is counted (giftsrv.js soonAdd, in the 'gift' Meter's daily counters gd and one small table gsi):
//   imp  a card was on screen (IntersectionObserver), once per page view and feature
//   tap  the interest button was pressed (every press is an event)
//   reg  a person registered interest in that feature: once per person and feature for good (the account when signed in, else the
//        guest id, else this browser's random id; the Worker keeps a keyed hash of it, never the id itself)
// Each by login ('a' a signed-in account, 'g' a guest or no token) and by where the card was (SOON_SRC). No contact data, no notice.

export const SOON_LABEL = '출시 예정';
export const SOON_BTN = '이 기능에 관심 있어요';
export const SOON_DONE = '관심 담음';
export const SOON_THANKS = '관심을 담았어요. 고마워요!';
export const SOON_BUSY = '지금은 붐벼서 담지 못했어요. 잠시 뒤에 다시 눌러 주세요.';
export const SOON_HEAD = '준비 중인 기능';
export const SOON_INTRO = '준비 중인 기능이에요. 관심을 눌러 주시면 무엇부터 만들지 정하는 데 써요.';
export const SOON_FREE = '지금 되는 전광판 만들기와 공유, 축하 영상은 그대로 무료예요.';
export const SOON_LINK = '준비 중인 기능';

// id: the counters' key (never change one that has counts); icon: uiicons.js; name and line: what the card says.
export const SOON = Object.freeze([
  Object.freeze({ id: 'board', icon: 'board', name: '특별한 전광판', line: '더 공들인 디자인, 전광판 위의 사진과 영상, 더 화려한 움직임을 고를 수 있게 준비하고 있어요.' }),
  Object.freeze({ id: 'gift', icon: 'gift', name: '선물 특별 연출·선물 보관함', line: '선물을 열 때 나오는 특별한 연출과, 보내고 받은 선물을 한곳에 모아 두는 보관함이에요.' }),
  Object.freeze({ id: 'keep', icon: 'hourglass', name: '오래 남기기', line: '7일이 지나도 기념 페이지와 기록을 남겨 두고, 디지털 기념품으로 간직하는 기능이에요.' }),
  Object.freeze({ id: 'place', icon: 'building', name: '특별한 자리', line: '타임스퀘어 밖의 다른 랜드마크 공간, 행사 때만 열리는 공간에 거는 기능이에요.' }),
]);
export const SOON_IDS = Object.freeze(SOON.map((x) => x.id));
// Where a card was seen: the gift owner page (right after making it), the 내 전광판 owner page, the owner page's 더 보기, the plaza after a
// board was hung, and the list on /discover (#soon, the boot card's small link).
export const SOON_SRC = Object.freeze(['owner', 'me', 'more', 'plaza', 'soon']);
export const SOON_ACTS = Object.freeze(['imp', 'tap']);
// keepDays: the distinct set (gsi) goes this long after a registration; adminDays: the admin block's trend.
export const SOON_KEEP = Object.freeze({ keepDays: 400, adminDays: 14, bodyMax: 400 });

// A beacon's body -> { ok: true, a, fs (feature ids), s } | { ok: false }. imp may carry up to four ids (the cards seen at once); tap one.
export function soonFault(b) {
  const a = String(b?.a || ''), s = String(b?.s || '');
  if (!SOON_ACTS.includes(a) || !SOON_SRC.includes(s)) return { ok: false };
  const raw = Array.isArray(b?.f) ? b.f : [b?.f], fs = [...new Set(raw.map((x) => String(x || '')))].filter((x) => SOON_IDS.includes(x));
  if (!fs.length || fs.length !== raw.length || (a === 'tap' && fs.length !== 1)) return { ok: false };
  return { ok: true, a, fs, s };
}
// The daily counter keys one event adds to (giftsrv.js gd): the total, the login split and the source.
export const soonKeys = (f, act, lg, s) => ['si:' + f + ':' + act, 'si:' + f + ':' + act + ':' + (lg === 'a' ? 'a' : 'g'), 'si:' + f + ':' + act + '@' + s];

// The admin block from the daily rows ([{ d, k: n, ... }], giftsrv.js gd) and the distinct people per feature ([{ f, n, a }]):
// per feature the sums over the days, the conversion (registrations / impressions), the login split, the sources, a day-by-day trend
// (every day of the range, zeros where nothing came) and the people who registered so far; ranked by registrations, then taps.
export function soonReport(days, people, d0, d1, addDays) {
  const list = []; for (let d = d0; d <= d1; d = addDays(d, 1)) list.push(d);
  const by = new Map((Array.isArray(days) ? days : []).map((x) => [String(x.d), x]));
  const ppl = new Map((Array.isArray(people) ? people : []).map((x) => [String(x.f), x]));
  const n = (x, k) => Number(x?.[k]) || 0;
  const features = SOON.map((F) => {
    const sum = (k) => list.reduce((t, d) => t + n(by.get(d), 'si:' + F.id + ':' + k), 0);
    const imp = sum('imp'), tap = sum('tap'), reg = sum('reg'), P = ppl.get(F.id);
    const src = Object.fromEntries(SOON_SRC.map((s) => [s, { imp: sum('imp@' + s), tap: sum('tap@' + s), reg: sum('reg@' + s) }]));
    return { f: F.id, name: F.name, imp, tap, reg, conv: imp ? reg / imp : 0, tapRate: imp ? tap / imp : 0,
      login: { imp: sum('imp:a'), tap: sum('tap:a'), reg: sum('reg:a') }, guest: { imp: sum('imp:g'), tap: sum('tap:g'), reg: sum('reg:g') },
      src, trend: list.map((d) => ({ d, imp: n(by.get(d), 'si:' + F.id + ':imp'), tap: n(by.get(d), 'si:' + F.id + ':tap'), reg: n(by.get(d), 'si:' + F.id + ':reg') })),
      people: { all: n(P, 'n'), login: n(P, 'a'), guest: n(P, 'n') - n(P, 'a') } };
  });
  const rank = [...features].sort((x, y) => y.reg - x.reg || y.tap - x.tap || y.imp - x.imp || SOON_IDS.indexOf(x.f) - SOON_IDS.indexOf(y.f)).map((x) => x.f);
  return { d0, d1, days: list.length, features, rank };
}
