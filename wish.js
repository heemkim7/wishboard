// 오늘의 소원: one short line per person per KST day, free. Pure rules shared by the browser, the Worker and the tests (no I/O).
import { blockedText } from './plaza-account.js';
import { botNick } from './league.js';

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
  busy: '지금은 광장이 붐벼요. 잠시 뒤에 다시 해 주세요.',
});

// Control characters, zero-width marks and bidi overrides out (ZWJ stays so emoji sequences survive), whitespace runs to one space.
const JUNK = /[\u0000-\u001f\u007f-\u009f​‌‎‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const norm = (text) => String(text ?? '').replace(/\s/g, ' ').replace(JUNK, '').replace(/\s+/g, ' ').trim();
export function cleanWish(text) { return Array.from(norm(text)).slice(0, WISH.maxLen).join('').trim(); }

// A wish is not an ad slot: no scheme, no www., no domain-looking word.
const LINKY = /https?:|www\.|[a-z0-9-]+\.[a-z]{2,}\/|[a-z0-9-]+\.(com|net|org|kr|io|co|me|ly|gg|xyz|shop|app|link|site|info|biz|tv|to|kakao)\b/i;
// Nor a contact card: Korean phone shapes only. 0 + 1-2 digits (area / mobile prefix), 3-4 digits, 4 digits, with optional separators
// between the groups and no digit right before or after (010-1234-5678, 01012345678, 02-123-4567, 010_1234/5678), or the +82 form (+82 10 1234 5678).
// Dates, scores and lotto numbers pass (2026.12.25, 100 100 100, 7 14 21 33 40 45, 20020531).
const SEP = '\\s.\\-_/·•,~*()\\u2010-\\u2015\\u2212\\u30fc\\u3161\\u1173'; // spaces . - _ / · • , ~ * ( ), dashes, ー, and ㅡ (NFKC turns it into U+1173)
const PHONY = new RegExp('(?<!\\d)0\\d{1,2}[' + SEP + ']*\\d{3,4}[' + SEP + ']*\\d{4}(?!\\d)|\\+[' + SEP + ']*82[' + SEP + ']*\\d{1,2}[' + SEP + ']*\\d{3,4}[' + SEP + ']*\\d{4}(?!\\d)');
// The link and phone checks read a folded copy (never stored): NFKC (０１０, ｈｔｔｐ, ｗｗｗ．, ⓪①), format characters and marks out (zero-width, bidi,
// the emoji selector and keycap of 5️⃣), 。 as a dot.
// A run of 7 or more digits, Korean digit syllables (공 영 빵 일 이 …) or o/O, with anything that is not a letter or digit (and the hangul fillers and
// braille blank) between them, is read as one number: syllables and o/O become digits, everything else goes, and the joined digits are refused when
// they are exactly a Korean number (0 + 1x / 2 / area / 70 / 50x, or 82 + prefix, then 7-8 digits: 010-12-34-5678, O1O 1234 5678, 공일공 일이 삼사 오육 칠팔).
// Exact length keeps lotto lines, dates, scores and 20020531; 오이, 이사, 구구단, 일요일, OK 100점 stay words. Numbers split by whole words are out of reach.
const KDIG = { 공: '0', 영: '0', 빵: '0', 일: '1', 이: '2', 삼: '3', 사: '4', 오: '5', 육: '6', 륙: '6', 칠: '7', 팔: '8', 구: '9', o: '0', O: '0' };
// o/O is a zero only when no other Latin letter touches it (nor sits right before a joining - _ . /): O1O-1234-5678 yes; Hello, zoo, Woo, GT-O1012 no.
const DIGC = '(?:[0-9공영빵일이삼사오육륙칠팔구]|(?<![A-Za-z][-_./]?)[oO]+(?![A-Za-z]))', RSEP = '(?:[^\\p{L}\\p{N}]|[\\u115f\\u1160\\u3164\\uffa0\\u2800])';
const KRUN = new RegExp(DIGC + '(?:' + RSEP + '*' + DIGC + '){6,}', 'gu');
const KNUM = /^(?:0(?:1[016789]|2|[3-6][1-5]|70|50\d)|82(?:1[016789]|2|[3-6][1-5]|70))\d{7,8}$/;
const fold = (s) => s.normalize('NFKC').replace(/[\p{Cf}\p{M}]/gu, '').replace(/[。｡]/g, '.');
const contact = (s) => { const f = fold(s); if (LINKY.test(f)) return true; let hit = false;
  const m = f.replace(KRUN, (run) => { const d = run.replace(/[oO공영빵일이삼사오육륙칠팔구]/g, (c) => KDIG[c]); if (KNUM.test(d.replace(/\D/g, ''))) hit = true; return d; });
  return hit || PHONY.test(m); }; // PHONY still finds the usual groupings inside a longer run (010-1234-5678 2026)
// '' when acceptable, otherwise the code: empty | blocked | link. Checked on the whole line before clipping so a cut never hides a word.
export function wishFault(text) {
  const s = norm(text);
  if (!s) return 'empty';
  if (blockedText(s)) return 'blocked';
  if (contact(s)) return 'link';
  return '';
}
export function wishRejected(text) { const k = wishFault(text); return k ? WISH_ERR[k] : ''; }
// Names that read as staff are not allowed on a wish, nor banned words, links or phone numbers (the same rules as the text): '' or 'nick'.
// The staff check ignores spaces ("운 영 자"). Nor the seeded bots' 네온봇N.
const STAFF = /운영자|관리자|공식|admin|official/i;
export function wishNickFault(nick) { const s = norm(nick), t = s.replace(/\s+/g, ''); return s && (blockedText(s) || STAFF.test(t) || botNick(t) || contact(s)) ? 'nick' : ''; }
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
