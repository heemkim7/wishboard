import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GT_LS, EVENT_NAMES, keysMatch, isInAppWebView, isAndroid, parseGuestHandover, adoptHandover,
  handoverHref, chromeIntent, loginEmail, profileName, mergeCoins, protectMinutes, slotTier,
  linkedActor, statsFromCounts, LINK_BONUS,
} from '../plaza-account.js';

assert.equal(GT_LS, 'masil_gt');
assert.equal(keysMatch('abc', 'abc'), true);
assert.equal(keysMatch('abc', 'abd'), false);
assert.equal(keysMatch('abc', 'ab'), false);
assert.equal(keysMatch('', 'abc'), false);
assert.equal(keysMatch(undefined, 'abc'), false);

assert.equal(isInAppWebView('Mozilla KAKAOTALK'), true);
assert.equal(isInAppWebView('Instagram 10'), true);
assert.equal(isInAppWebView('Barcelona/1'), true);
assert.equal(isInAppWebView('Threads'), true);
assert.equal(isInAppWebView('FBAN'), true);
assert.equal(isInAppWebView('Line/1'), true);
assert.equal(isInAppWebView('Mozilla Chrome'), false);
assert.equal(isAndroid('Linux Android 14'), true);
assert.equal(isAndroid('iPhone'), false);

const sub = 'g-550e8400-e29b-41d4-a716-446655440000';
assert.equal(parseGuestHandover('guest:' + sub), sub);
assert.equal(parseGuestHandover(sub.toUpperCase()), sub);
assert.equal(parseGuestHandover('guest:nope'), '');
assert.equal(parseGuestHandover(''), '');

const mem = { bag: new Map(), getItem(k) { return this.bag.has(k) ? this.bag.get(k) : null; }, setItem(k, v) { this.bag.set(k, v); } };
assert.equal(adoptHandover('?handover=guest:' + sub + '&autologin=google', mem), sub);
assert.equal(JSON.parse(mem.getItem(GT_LS)).sub, sub);
mem.setItem(GT_LS, JSON.stringify({ sub, token: 'g1.keep', exp: 9 }));
adoptHandover('?handover=' + sub, mem);
assert.equal(JSON.parse(mem.getItem(GT_LS)).token, 'g1.keep');

const href = handoverHref('guest:' + sub, 'google');
assert.equal(href, 'https://studio.wishboard.workers.dev/?handover=guest%3A' + sub + '&autologin=google');
const intent = chromeIntent(href);
assert.match(intent, /^intent:\/\/studio\.wishboard\.workers\.dev\/\?/);
assert.match(intent, /package=com\.android\.chrome/);
assert.doesNotMatch(intent, /signInWithOAuth/);

assert.equal(loginEmail('Neon_1'), 'neon_1@id.wishboard.dev');
assert.equal(loginEmail('a@b.co'), 'a@b.co');
assert.equal(loginEmail('ab'), '');
assert.equal(loginEmail('not an email'), '');
assert.equal(profileName({ app_metadata: { provider: 'google' }, user_metadata: { full_name: '네온' } }), '네온');
assert.equal(profileName({ app_metadata: { provider: 'email' }, user_metadata: { full_name: '숨김' } }), '');

const first = mergeCoins({ userCoins: 40, guestCoins: 100, bonusPaid: false });
assert.equal(first.bonus, LINK_BONUS);
assert.equal(first.coins, 440);
assert.equal(first.guestLeft, 0);
const again = mergeCoins({ userCoins: first.coins, guestCoins: first.guestLeft, bonusPaid: first.bonusPaid });
assert.equal(again.bonus, 0);
assert.equal(again.coins, 440);

assert.equal(protectMinutes('S', 'user:abc'), 125);
assert.equal(protectMinutes('S', 'guest:g-1'), 120);
assert.equal(protectMinutes('B', 'user:abc'), 65);
assert.equal(protectMinutes('C', 'user:abc'), 35);
assert.equal(protectMinutes('S', 'user:abc') - protectMinutes('S', 'guest:x'), 5);
assert.equal(slotTier('MAIN_TOP'), 'S');
assert.equal(slotTier('SUB_1A'), 'B');
assert.equal(slotTier('STREET_3'), 'C');
assert.equal(linkedActor('user:1'), true);
assert.equal(linkedActor('guest:g-1', true), true);
assert.equal(linkedActor('guest:g-1'), false);

const stats = statsFromCounts({ page_landing: 4, enter_square: 1, taxi_dropoff: 2, board_claim: 3, outlink_click: 5, auth_login_success: 1, taxi_pickup: 9 });
assert.deepEqual(stats, { visits: 4, enter_rate: 25, taxi_trips: 2, billboard_claims: 3, outbound_clicks: 5, account_conversions: 1 });
assert.equal(statsFromCounts({}).enter_rate, 0);
assert.equal(EVENT_NAMES.includes('auth_login_success'), true);
assert.equal(EVENT_NAMES.includes('flush_key'), false);

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const heads = [...schema.matchAll(/CREATE OR REPLACE FUNCTION public\.claim_billboard\([\s\S]*?\)\r?\nRETURNS/g)].map((m) => m[0]);
assert.equal(heads.length, 2);
assert.equal(heads.filter((h) => h.includes('p_caption_y')).length, 1);
assert.match(schema, /v_protect_mins := v_protect_mins \+ 5/);
assert.doesNotMatch(schema, /v_protect_mins \+ 3/);
assert.match(schema, /link_bonus = false/);
assert.match(schema, /CREATE OR REPLACE FUNCTION public\.merge_guest_account/);
assert.match(schema, /CREATE OR REPLACE FUNCTION public\.withdraw_account/);

console.log('account tests ok');
