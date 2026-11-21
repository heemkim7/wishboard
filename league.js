// 주간 리그: coins each account really spent in one ISO week (KST). Pure rules shared by the Worker, the browser and the tests (no I/O).
// The Worker imports this module, so it is imported without a ?v= query everywhere.

export const LEAGUE = Object.freeze({ top: 20, world: 10, keepWeeks: 5 });

// Seeded wallets named 네온봇N are not players: they stay out of the ranks players see, and nobody may take that name. Checked after NFKC (full-width
// digits), without spaces and zero-width marks, with any decimal digit (네온봇１, 네온봇 1, 네온봇​1, 네온봇٣).
export const BOT_NICK = /^네온봇\p{Nd}+$/u;
export function botNick(nick) { return BOT_NICK.test(String(nick ?? '').normalize('NFKC').replace(/[\s​-‏⁠-⁤﻿]+/g, '')); }

// ISO week id in KST, 'YYYYWww' (the same as the Worker's isoWeek). Ids of one year compare as strings.
export function leagueWeek(t = Date.now()) {
  const d = new Date(t + 9 * 36e5), w = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), dn = (w.getUTCDay() + 6) % 7;
  w.setUTCDate(w.getUTCDate() - dn + 3); const y = w.getUTCFullYear(), f = new Date(Date.UTC(y, 0, 4));
  return y + 'W' + String(1 + Math.round(((w - f) / 864e5 - 3 + ((f.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0');
}
// When this KST week ends: the next Monday 00:00 KST, epoch ms.
export function weekEnds(t = Date.now()) {
  const d = new Date(t + 9 * 36e5), dn = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dn * 864e5 - 9 * 36e5 + 7 * 864e5;
}
// The oldest week still kept: rows of weeks before it are pruned.
export function leagueCut(t = Date.now()) { return leagueWeek(t - LEAGUE.keepWeeks * 7 * 864e5); }

// rows: one week's { uid, nick, spent, at } (at = when the row last grew). Order: spent desc, then who got there first, then uid, so every
// account has its own rank. Rows with nothing spent and bot names are not ranked. uid never leaves: top rows carry mine (true/false) only.
// me (uid given): { rank, spent, next } where next = { rank, gap } is what passing the account directly above takes (its spent - mine + 1),
// null at rank 1. An account with nothing this week has rank 0 and next = what entering the top n takes.
export function leagueBoard(rows, uid = '', n = LEAGUE.top) {
  const list = (Array.isArray(rows) ? rows : []).map((r) => ({ uid: String(r?.uid || ''), nick: String(r?.nick || '') || '네온손님', spent: Math.max(0, Math.floor(Number(r?.spent) || 0)), at: Number(r?.at) || 0 }))
    .filter((r) => r.uid && r.spent > 0 && !botNick(r.nick))
    .sort((a, b) => b.spent - a.spent || a.at - b.at || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
  const top = list.slice(0, n).map((r, i) => ({ rank: i + 1, nick: r.nick, spent: r.spent, mine: !!uid && r.uid === uid }));
  if (!uid) return { top, me: null };
  const i = list.findIndex((r) => r.uid === uid);
  if (i < 0) return { top, me: { rank: 0, spent: 0, next: list.length < n ? { rank: list.length + 1, gap: 1 } : { rank: n, gap: list[n - 1].spent + 1 } } };
  return { top, me: { rank: i + 1, spent: list[i].spent, next: i ? { rank: i, gap: list[i - 1].spent - list[i].spent + 1 } : null } };
}

// The sheet's line about me. Unranked: the fixed copy for a week that has not started for me.
export function leagueLine(me) {
  if (!me) return '';
  const rank = Math.floor(Number(me.rank) || 0);
  if (rank < 1) return '이번 주 순위는 0에서 시작했어요 · 첫 점령이면 순위에 올라요';
  const next = me.next && Number(me.next.gap) > 0 ? me.next : null;
  return next ? `이번 주 ${rank}위 · ${Math.floor(Number(next.gap)).toLocaleString('en-US')}코인 더 쓰면 ${Math.floor(Number(next.rank))}위` : `이번 주 ${rank}위`;
}
