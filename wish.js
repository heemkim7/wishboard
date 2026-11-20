// 오늘의 소원: one short line per person per KST day, free. Pure rules shared by the browser, the Worker and the tests (no I/O).
import { blockedText } from './plaza-account.js';

export const WISH = Object.freeze({ maxLen: 24, heartsPerDay: 5, ipHeartsPerWish: 3, reportHide: 3, topMax: 50, recentMax: 20, boardMax: 24, keepDays: 8, prizes: Object.freeze([300, 200, 100]), prizeMinHearts: 5, prizeMinIps: 3, editsPerDay: 3, editGapMs: 30000, ipPostsPerDay: 20 });

// Korean copy for every error code the wish routes return (`code` in the JSON), so the client can show the same text.
export const WISH_ERR = Object.freeze({
  empty: '소원을 한 줄 적어 주세요.',
  blocked: '그 문구는 올릴 수 없어요.',
  link: '소원에는 링크나 연락처를 넣을 수 없어요.',
  nick: '그 이름은 쓸 수 없어요.',
  already: '오늘 소원은 이미 하트를 받아서 바꿀 수 없어요. 내일 새로 빌어 주세요.',
  hidden: '신고가 쌓여 가려진 소원이에요. 내일 다시 걸 수 있어요.',
  soon: '방금 올리거나 고친 소원이에요. 30초 뒤에 고칠 수 있어요.',
  edits: '오늘 소원은 더 고칠 수 없어요. 내일 새로 빌어 주세요.',
  gone: '없어졌거나 가려진 소원이에요.',
  closed: '오늘 올라온 소원에만 하트를 줄 수 있어요.',
  own: '내 소원에는 하트를 줄 수 없어요.',
  dup: '이 소원에는 이미 하트를 줬어요.',
  limit: '오늘 하트를 다 썼어요. 내일 다시 5개가 생겨요.',
  ip: '이 소원에는 같은 곳에서 하트를 더 줄 수 없어요.',
  auth: '입장한 뒤에 할 수 있어요.',
  rate: '너무 빨라요. 잠시 뒤 다시 해 주세요.',
  down: '소원을 처리하지 못했어요. 잠시 뒤 다시 해 주세요.',
  ipposts: '이 네트워크에서는 오늘 소원을 더 걸 수 없어요. 내일 다시 걸어 주세요.',
});

// Control characters, zero-width marks and bidi overrides out (ZWJ stays so emoji sequences survive), whitespace runs to one space.
const JUNK = /[\u0000-\u001f\u007f-\u009f​‌‎‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const norm = (text) => String(text ?? '').replace(/\s/g, ' ').replace(JUNK, '').replace(/\s+/g, ' ').trim();
export function cleanWish(text) { return Array.from(norm(text)).slice(0, WISH.maxLen).join('').trim(); }

// A wish is not an ad slot: no scheme, no www., no domain-looking word.
const LINKY = /https?:|www\.|[a-z0-9-]+\.[a-z]{2,}\/|[a-z0-9-]+\.(com|net|org|kr|io|co|me|ly|gg|xyz|shop|app|link|site|info|biz|tv|to|kakao)\b/i;
// Nor a contact card: Korean phone shapes only. 0 + 1-2 digits (area / mobile prefix), 3-4 digits, 4 digits, with optional spaces, dots or hyphens
// between the groups and no digit right before or after (010-1234-5678, 01012345678, 02-123-4567), or the +82 form (+82 10 1234 5678).
// Dates, scores and lotto numbers pass (2026.12.25, 100 100 100, 7 14 21 33 40 45, 20020531).
const PHONY = /(?<!\d)0\d{1,2}[\s.\-]*\d{3,4}[\s.\-]*\d{4}(?!\d)|\+\s*82[\s.\-]*\d{1,2}[\s.\-]*\d{3,4}[\s.\-]*\d{4}(?!\d)/;
// '' when acceptable, otherwise the code: empty | blocked | link. Checked on the whole line before clipping so a cut never hides a word.
export function wishFault(text) {
  const s = norm(text);
  if (!s) return 'empty';
  if (blockedText(s)) return 'blocked';
  if (LINKY.test(s) || PHONY.test(s)) return 'link';
  return '';
}
export function wishRejected(text) { const k = wishFault(text); return k ? WISH_ERR[k] : ''; }
// Names that read as staff are not allowed on a wish, nor banned words, links or phone numbers (the same rules as the text): '' or 'nick'.
// The staff check ignores spaces ("운 영 자").
const STAFF = /운영자|관리자|공식|admin|official/i;
export function wishNickFault(nick) { const s = norm(nick), t = s.replace(/\s+/g, ''); return s && (blockedText(s) || STAFF.test(t) || LINKY.test(s) || PHONY.test(s)) ? 'nick' : ''; }
// The nick a wish stores and shows: the same normalising as the text (no zero-width or bidi marks), 16 code points.
export function cleanNick(nick) { return Array.from(norm(nick)).slice(0, 16).join('').trim(); }

// The network a wish limit counts: IPv4 as is, IPv6 by its /64 (one home or phone gets a whole /64), IPv4-mapped IPv6 as the IPv4.
export function ipNet(ip) {
  const s = String(ip || '').trim().toLowerCase(); if (!s) return 'x'; if (!s.includes(':')) return s;
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s); if (v4) return v4[1];
  const [h, t] = s.split('::'), head = h ? h.split(':') : [], tail = s.includes('::') && t ? t.split(':') : [];
  const all = s.includes('::') ? head.concat(Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), tail) : head;
  return all.slice(0, 4).map((x) => (parseInt(x, 16) || 0).toString(16)).join(':') + '::/64';
}

// Same as the Worker's kstDay(): YYYY-MM-DD in KST.
export function wishDay(ms = Date.now()) { return new Date(ms + 9 * 36e5).toISOString().slice(0, 10); }

// Hearts desc, then the earlier wish, then id (stable). Ranks start at 1.
export function rankWishes(rows) {
  return [...(Array.isArray(rows) ? rows : [])]
    .sort((a, b) => (Number(b.hearts) || 0) - (Number(a.hearts) || 0) || (Number(a.at) || 0) - (Number(b.at) || 0) || String(a.id).localeCompare(String(b.id)))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

// ips = distinct IP nets that gave the wish hearts; a prize needs WISH.prizeMinIps of them.
export function prizeFor(rank, hearts, ips) {
  const r = Math.floor(Number(rank));
  if (!(r >= 1 && r <= WISH.prizes.length) || !((Number(hearts) || 0) >= WISH.prizeMinHearts) || !((Number(ips) || 0) >= WISH.prizeMinIps)) return 0;
  return WISH.prizes[r - 1];
}

// Up to max distinct wishes, alternating top-ranked and newest, so a fresh wish with no hearts still reaches a board.
export function boardMix(top, recent, max = WISH.boardMax) {
  const a = Array.isArray(top) ? top : [], b = Array.isArray(recent) ? recent : [], out = [], seen = new Set();
  const take = (w) => { if (w && w.id != null && !seen.has(w.id) && out.length < max) { seen.add(w.id); out.push(w); } };
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < max; i++) { take(a[i]); take(b[i]); }
  return out;
}

export function wishShareText(wish) {
  const nick = String(wish?.nick || '') || '누군가';
  return { title: nick + '님의 소원', text: '"' + String(wish?.txt || '') + '" — 하트 하나만 눌러 주세요' };
}
