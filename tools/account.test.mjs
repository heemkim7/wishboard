import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GT_LS, EVENT_NAMES, keysMatch, isInAppWebView, isAndroid, parseGuestHandover, adoptHandover, ticketSub,
  handoverHref, chromeIntent, loginEmail, mergeCoins, protectMinutes, slotTier,
  linkedActor, statsFromCounts, LINK_BONUS,
  isKakaoTalk, kakaoExternal, externalRoutes, oauthMessage, oauthReturn, returnUrl, cleanAddress, oauthErrorText, authErrorText, accountLabel,
  OAUTH_CHANNEL, OAUTH_MSG, OAUTH_ACK, OAUTH_ERR,
} from '../plaza-account.js';
import * as account from '../plaza-account.js';

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

// The handover link carries a ticket (h1.<payload>.<signature>), never a bare guest id. The Worker signs and verifies it;
// the browser only reads which guest it names. test/plaza.test.mjs covers the signature.
const ticket = 'h1.' + Buffer.from(JSON.stringify({ s: sub, e: 1900000000 })).toString('base64url') + '.' + 'A'.repeat(43);
assert.equal(ticketSub(ticket), sub);
assert.equal(ticketSub(' ' + ticket + ' '), sub);
for (const bad of [sub, 'guest:' + sub, 'g1.' + ticket.slice(3), ticket.split('.').slice(0, 2).join('.'), 'h1.' + Buffer.from('{"s":"nope"}').toString('base64url') + '.' + 'A'.repeat(43), 'h1.%%%.sig', '', null]) assert.equal(ticketSub(bad), '');

const mem = { bag: new Map(), getItem(k) { return this.bag.has(k) ? this.bag.get(k) : null; }, setItem(k, v) { this.bag.set(k, v); } };
// A guest id in the link does nothing: it is public, so it proves nothing.
assert.equal(adoptHandover('?handover=guest:' + sub + '&autologin=google', mem), '');
assert.equal(adoptHandover('?handover=' + sub, mem), '');
assert.equal(mem.getItem(GT_LS), null);
// A ticket is stored for net.js to redeem.
assert.equal(adoptHandover('?handover=' + encodeURIComponent(ticket) + '&autologin=google', mem), sub);
assert.deepEqual(JSON.parse(mem.getItem(GT_LS)), { ticket });
// This browser's own guest stays until the server accepts the ticket.
const other = 'g-11111111-2222-4333-8444-555555555555';
mem.setItem(GT_LS, JSON.stringify({ sub: other, token: 'g1.mine', exp: 9 }));
assert.equal(adoptHandover('?handover=' + ticket, mem), sub);
assert.deepEqual(JSON.parse(mem.getItem(GT_LS)), { sub: other, token: 'g1.mine', exp: 9, ticket });
// Already this guest: nothing to redeem.
mem.setItem(GT_LS, JSON.stringify({ sub, token: 'g1.keep', exp: 9 }));
adoptHandover('?handover=' + ticket, mem);
assert.deepEqual(JSON.parse(mem.getItem(GT_LS)), { sub, token: 'g1.keep', exp: 9 });

const href = handoverHref(ticket, 'google');
assert.equal(href, 'https://studio.wishboard.workers.dev/?handover=' + ticket + '&autologin=google');
assert.equal(adoptHandover(new URL(href).search, { getItem: () => null, setItem() {} }), sub);
const intent = chromeIntent(href);
assert.match(intent, /^intent:\/\/studio\.wishboard\.workers\.dev\/\?/);
assert.match(intent, /package=com\.android\.chrome/);
assert.doesNotMatch(intent, /signInWithOAuth/);
assert.equal(adoptHandover(new URL(intent.replace(/^intent:/, 'https:').split('#')[0]).search, { getItem: () => null, setItem() {} }), sub);
// Without Chrome the webview goes to the same handover link (S.browser_fallback_url, encoded so its & and = stay inside the value).
const fallback = /;S\.browser_fallback_url=([^;]+);end$/.exec(intent);
assert.ok(fallback, intent);
assert.equal(decodeURIComponent(fallback[1]), href);
assert.doesNotMatch(fallback[1], /[&=?#;]/);

// In-app browser → system browser: KakaoTalk's own way out first (both platforms), then the Android intent. iOS elsewhere has none.
const KAKAO_AND = 'Mozilla/5.0 (Linux; Android 14; SM-S911N) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 KAKAOTALK 10.4.5';
const KAKAO_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 KAKAOTALK 10.4.5';
const INSTA_AND = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 Instagram 310.0';
const INSTA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 310.0';
assert.equal(isKakaoTalk(KAKAO_AND), true);
assert.equal(isKakaoTalk(INSTA_AND), false);
const kakao = kakaoExternal(href);
assert.equal(kakao, 'kakaotalk://web/openExternal?url=' + encodeURIComponent(href));
assert.equal(new URL(kakao).searchParams.get('url'), href);
assert.deepEqual(externalRoutes(KAKAO_AND, href), [kakao, intent]);
assert.deepEqual(externalRoutes(KAKAO_IOS, href), [kakao]);
assert.deepEqual(externalRoutes(INSTA_AND, href), [intent]);
assert.deepEqual(externalRoutes(INSTA_IOS, href), []);
assert.deepEqual(externalRoutes(KAKAO_AND, ''), []);

// The second window (oauth.html) reports with one message shape; anything else is ignored.
assert.equal(OAUTH_CHANNEL, 'kts-oauth');
assert.notEqual(OAUTH_MSG, OAUTH_ACK);
const authCode = '0b6c5a2e-7f1d-4c3b-9a8e-2d1f0e9c8b7a';
assert.deepEqual(oauthMessage({ t: OAUTH_MSG, code: authCode }), { code: authCode });
assert.deepEqual(oauthMessage({ t: OAUTH_MSG, error: 'access_denied', description: 'x'.repeat(500) }), { error: 'access_denied', errorCode: '', description: 'x'.repeat(200) });
assert.deepEqual(oauthMessage({ t: OAUTH_MSG, error: 'server_error', errorCode: 'unexpected_failure', description: 7 }), { error: 'server_error', errorCode: 'unexpected_failure', description: '' });
for (const bad of [null, 'x', 7, [], {}, { code: authCode }, { t: 'other', code: authCode }, { t: OAUTH_ACK }, { t: OAUTH_MSG }, { t: OAUTH_MSG, code: 'short' }, { t: OAUTH_MSG, code: 'a b c d e f g h' }, { t: OAUTH_MSG, code: '<img src=x onerror=1>' }, { t: OAUTH_MSG, code: 'x'.repeat(600) }, { t: OAUTH_MSG, code: 12345678 }, { t: OAUTH_MSG, error: '' }, { t: OAUTH_MSG, error: {} }])
  assert.equal(oauthMessage(bad), null, JSON.stringify(bad));

// The full-page fallback: what this load came back with, where the next one returns to, and the address once it was read.
assert.deepEqual(oauthReturn('?code=' + authCode, ''), { code: true, failed: false, error: '', errorCode: '', description: '' });
assert.deepEqual(oauthReturn('?focus=PLOT_3', ''), { code: false, failed: false, error: '', errorCode: '', description: '' });
assert.equal(oauthReturn('?code=', '').code, false);
assert.deepEqual(oauthReturn('?error=access_denied&error_code=access_denied&error_description=User+denied+access', ''), { code: false, failed: true, error: 'access_denied', errorCode: 'access_denied', description: 'User denied access' });
assert.deepEqual(oauthReturn('', '#error=server_error&error_description=Unable%20to%20exchange'), { code: false, failed: true, error: 'server_error', errorCode: '', description: 'Unable to exchange' });
assert.equal(oauthReturn('', '#wish').failed, false);
const ORIGIN = 'https://studio.wishboard.workers.dev';
assert.equal(returnUrl(ORIGIN + '/?focus=PLOT_3&code=abc&handover=h1.x.y&autologin=google&error=e&error_code=c&error_description=d#frag'), ORIGIN + '/?focus=PLOT_3');
assert.equal(returnUrl(ORIGIN + '/?error_description=x'), ORIGIN + '/');
assert.equal(returnUrl('http://localhost:8790/?qa=1&wish=abcdefghij'), 'http://localhost:8790/?qa=1&wish=abcdefghij');
assert.equal(cleanAddress(ORIGIN + '/?focus=PLOT_3&code=abc&error=e&error_code=c&error_description=d&handover=h&autologin=google#top'), '/?focus=PLOT_3#top');
assert.equal(cleanAddress(ORIGIN + '/?error=access_denied#error=access_denied&error_description=x'), '/');
assert.equal(cleanAddress(ORIGIN + '/#access_token=abc&token_type=bearer'), '/');
assert.equal(cleanAddress(ORIGIN + '/?wish=abcdefghij'), '/?wish=abcdefghij');

// Provider errors and Supabase auth errors become one Korean line. For a provider error the line is one of a fixed set
// (OAUTH_ERR): error, error_code and error_description come from the address, so none of their text is shown.
assert.equal(oauthErrorText({ error: 'access_denied', errorCode: 'access_denied', description: 'User denied access' }), '구글 로그인을 취소했어요');
assert.equal(oauthErrorText({ error: 'access_denied' }), '구글 로그인을 취소했어요');
assert.equal(oauthErrorText({ error: 'access_denied', errorCode: 'signup_disabled', description: 'Signups not allowed for this instance' }), '지금은 새 계정을 만들 수 없어요');
assert.equal(oauthErrorText({ error: 'server_error', description: 'Unable to exchange external code' }), '로그인하지 못했어요. 다시 시도해 주세요.');
assert.equal(oauthErrorText({ error: 'server_error', description: 'a\u0000b\n' + 'x'.repeat(300) }), '로그인하지 못했어요. 다시 시도해 주세요.');
assert.equal(oauthErrorText({ error: 'no_code' }), '로그인하지 못했어요. 다시 시도해 주세요.');
assert.equal(oauthErrorText(null), '로그인하지 못했어요. 다시 시도해 주세요.');
assert.equal(oauthErrorText({ error: 'access_denied', errorCode: 'user_banned', description: 'User is banned' }), OAUTH_ERR.banned);
assert.equal(oauthErrorText({ error: 'invalid_request', errorCode: 'bad_oauth_state', description: 'OAuth state is invalid' }), OAUTH_ERR.expired);
assert.equal(authErrorText(new Error('Invalid login credentials')), '아이디 또는 비밀번호가 맞지 않아요');
assert.equal(authErrorText({ code: 'invalid_credentials', message: 'x' }), '아이디 또는 비밀번호가 맞지 않아요');
assert.equal(authErrorText(new Error('User already registered')), '이미 가입한 아이디예요. 로그인해 주세요.');
assert.equal(authErrorText({ code: 'user_already_exists' }), '이미 가입한 아이디예요. 로그인해 주세요.');
assert.equal(authErrorText(new Error('Password should be at least 6 characters.')), '비밀번호는 6자 이상이어야 해요');
assert.equal(authErrorText({ code: 'weak_password', message: 'weak' }), '비밀번호는 6자 이상이어야 해요');
assert.equal(authErrorText({ status: 429, message: 'x' }), '요청이 너무 많아요. 잠시 뒤에 다시 해 주세요.');
assert.equal(authErrorText(new Error('Email rate limit exceeded')), '요청이 너무 많아요. 잠시 뒤에 다시 해 주세요.');
assert.equal(authErrorText({ code: 'over_request_rate_limit', message: 'x' }), '요청이 너무 많아요. 잠시 뒤에 다시 해 주세요.');
assert.equal(authErrorText(new TypeError('Failed to fetch')), '네트워크에 연결하지 못했어요. 연결을 확인하고 다시 해 주세요.');
assert.equal(authErrorText({ name: 'AuthRetryableFetchError', message: '' }), '네트워크에 연결하지 못했어요. 연결을 확인하고 다시 해 주세요.');
assert.equal(authErrorText(new Error('Load failed')), '네트워크에 연결하지 못했어요. 연결을 확인하고 다시 해 주세요.');
assert.equal(authErrorText({ code: 'flow_state_not_found', message: 'invalid flow state, no valid flow state found' }), '로그인 시간이 지났어요. 다시 시도해 주세요.');
assert.equal(authErrorText(new Error('both auth code and code verifier should be non-empty')), '로그인 시간이 지났어요. 다시 시도해 주세요.');
assert.equal(authErrorText(new Error('계정을 연결하지 못했어요. 잠시 뒤 다시 해 주세요.')), '계정을 연결하지 못했어요. 잠시 뒤 다시 해 주세요.'); // the Worker's own line
assert.equal(authErrorText(new Error('Something odd happened')), '로그인에 실패했어요');
assert.equal(authErrorText(null), '로그인에 실패했어요');

// Settings shows the bare id for an id sign-up, the address for anything else.
assert.deepEqual(accountLabel(loginEmail('Neon_1')), { kind: 'id', text: 'neon_1' });
assert.deepEqual(accountLabel('someone@example.com'), { kind: 'email', text: 'someone@example.com' });
assert.deepEqual(accountLabel('a@id.wishboard.dev.evil.example'), { kind: 'email', text: 'a@id.wishboard.dev.evil.example' });
assert.deepEqual(accountLabel(''), { kind: '', text: '' });
assert.deepEqual(accountLabel(undefined), { kind: '', text: '' });

assert.equal(loginEmail('Neon_1'), 'neon_1@id.wishboard.dev');
assert.equal(loginEmail('a@b.co'), 'a@b.co');
assert.equal(loginEmail('ab'), '');
assert.equal(loginEmail('not an email'), '');
// The provider's profile name (a real name, for Google) is never read: the helper that did is gone.
assert.equal('profileName' in account, false);

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
assert.equal(EVENT_NAMES.includes('first_coin'), true);
assert.equal(EVENT_NAMES.includes('session_end'), true);
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
