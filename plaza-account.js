// Shared account, analytics, and handover rules. No DOM, no secrets, no Cloudflare imports.
export const GT_LS = 'masil_gt';
export const SESSION_LS = 'maeul_auth'; // supabase-js session storage key (net.js createClient)
export const SITE = 'https://studio.wishboard.workers.dev/';
export const LINK_BONUS = 300;
export const LINKED_PROTECT_MIN = 5;
export const EVENT_NAMES = Object.freeze([
  'page_landing',
  'enter_square',
  'taxi_pickup',
  'taxi_dropoff',
  'board_claim',
  'wish_cheer',
  'cheer',
  'outlink_click',
  'vip_modal_open',
  'auth_login_success',
  'first_coin',
  'session_end',
  'share_send',
  'focus_enter',
  'push_on',
  'relight',
  'wish_view',
  'wish_post',
  'wish_heart',
  'wish_share',
  'wish_land',
  'share_link',
  'return_visit',
  'invite_land',
  'invite_reward',
  'install_prompt',
  'week_recap',
]);
const GUEST_SUB = /^g-[0-9a-f-]{36}$/i;
const TICKET = /^h1\.[A-Za-z0-9_-]{20,200}\.[A-Za-z0-9_-]{20,90}$/;

export function keysMatch(want, got) {
  if (typeof want !== 'string' || typeof got !== 'string' || !want || want.length !== got.length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}

export function isInAppWebView(ua) {
  return /KAKAOTALK|Instagram|Barcelona|Threads|FBAN|FB_IAB|FBAV|Line\//i.test(String(ua || ''));
}

export function isAndroid(ua) {
  return /Android/i.test(String(ua || ''));
}

export function parseGuestHandover(raw) {
  const s = String(raw || '').trim();
  const m = /^(?:guest:)?(g-[0-9a-f-]{36})$/i.exec(s);
  if (!m || !GUEST_SUB.test(m[1])) return '';
  return m[1].toLowerCase();
}

// A guest id is public (ranks, presence, wallets), so the handover link carries a short-lived ticket the Worker signs for
// that guest's own token (POST /rt/handover). This reads the guest the ticket names; the Worker checks the signature on redeem.
export function ticketSub(raw) {
  const s = String(raw || '').trim();
  if (!TICKET.test(s)) return '';
  try { return parseGuestHandover(JSON.parse(atob(s.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).s); } catch { return ''; }
}

// Stores the ticket next to this browser's own guest. net.js guestToken() redeems it and only then replaces the stored guest,
// so an expired or forged link cannot cost the visitor their wallet.
export function adoptHandover(search, storage) {
  const ticket = String(new URLSearchParams(String(search || '').replace(/^\?/, '')).get('handover') || '').trim();
  const sub = ticketSub(ticket);
  if (!sub || !storage) return '';
  let cur = null;
  try { cur = JSON.parse(storage.getItem(GT_LS) || 'null'); } catch { cur = null; }
  if (!cur || typeof cur !== 'object') cur = {};
  if (!(cur.token && cur.sub === sub)) storage.setItem(GT_LS, JSON.stringify({ ...cur, ticket }));
  return sub;
}

export function handoverHref(ticket, autologin) {
  const u = new URL(SITE);
  const id = String(ticket || '');
  if (id) u.searchParams.set('handover', id);
  if (autologin) u.searchParams.set('autologin', autologin);
  return u.href;
}

// Android: open the link in Chrome. S.browser_fallback_url is where the webview goes when Chrome is not installed.
export function chromeIntent(httpsUrl) {
  const u = new URL(httpsUrl);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(u.href)};end`;
}

export function isKakaoTalk(ua) {
  return /KAKAOTALK/i.test(String(ua || ''));
}

// KakaoTalk's own way out of its in-app browser (Android and iOS): it opens the link in the phone's default browser.
export function kakaoExternal(httpsUrl) {
  return 'kakaotalk://web/openExternal?url=' + encodeURIComponent(new URL(httpsUrl).href);
}

// The addresses to try, in order, to carry a handover link from an in-app browser into the system browser.
// Empty when there is no automatic way (iOS outside KakaoTalk): the sheet then shows the copy-link instructions only.
export function externalRoutes(ua, httpsUrl) {
  const url = String(httpsUrl || '');
  if (!url) return [];
  const out = [];
  if (isKakaoTalk(ua)) out.push(kakaoExternal(url));
  if (isAndroid(ua)) out.push(chromeIntent(url));
  return out;
}

// ---- Google sign-in in a second window (oauth.html) and the full-page fallback ----
export const OAUTH_CHANNEL = 'kts-oauth';
export const OAUTH_MSG = 'kts-oauth';
export const OAUTH_ACK = 'kts-oauth-ack';
const AUTH_PARAMS = ['code', 'error', 'error_code', 'error_description'];
const ONCE_PARAMS = ['autologin', 'handover', ...AUTH_PARAMS];
const hashParams = (hash) => new URLSearchParams(String(hash || '').replace(/^#/, ''));

// What oauth.html sent: { code } or { error, errorCode, description }, or null for anything else (wrong shape, odd characters).
export function oauthMessage(data) {
  if (!data || typeof data !== 'object' || data.t !== OAUTH_MSG) return null;
  if (typeof data.code === 'string' && data.code) return /^[\w.~-]{8,512}$/.test(data.code) ? { code: data.code } : null;
  if (typeof data.error !== 'string' || !data.error) return null;
  return {
    error: data.error.slice(0, 80),
    errorCode: typeof data.errorCode === 'string' ? data.errorCode.slice(0, 80) : '',
    description: typeof data.description === 'string' ? data.description.slice(0, 200) : '',
  };
}

// The game's own address right after a full-page sign-in: a code to exchange (supabase-js does it), or the provider's error.
export function oauthReturn(search, hash) {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const f = hashParams(hash);
  const pick = (k) => String(q.get(k) || f.get(k) || '');
  const error = pick('error'), errorCode = pick('error_code'), description = pick('error_description');
  return { code: !!q.get('code'), failed: !!(error || errorCode || description), error, errorCode, description };
}

// Where a full-page sign-in comes back to: this page without the one-time parameters (and without the hash).
export function returnUrl(href) {
  const u = new URL(href);
  for (const k of ONCE_PARAMS) u.searchParams.delete(k);
  return u.origin + u.pathname + u.search;
}

// The address bar once the sign-in parameters were read: path + query + hash without them. A hash that carries an error or a token goes too.
export function cleanAddress(href) {
  const u = new URL(href);
  for (const k of ONCE_PARAMS) u.searchParams.delete(k);
  const f = hashParams(u.hash);
  const hash = AUTH_PARAMS.some((k) => f.has(k)) || f.has('access_token') ? '' : u.hash;
  return u.pathname + u.search + hash;
}

// A line for the player when the provider sent an error back. Pressing cancel in the Google window is access_denied.
// error, error_code and error_description come from the address (or from oauth.html, which read them there): anyone can write a
// link with them. They only choose one of the fixed lines below; none of their text is ever shown.
export const OAUTH_ERR = Object.freeze({
  cancel: '구글 로그인을 취소했어요',
  signup: '지금은 새 계정을 만들 수 없어요',
  banned: '이 계정으로는 로그인할 수 없어요. 다른 계정으로 해 주세요.',
  provider: '지금은 구글 로그인을 쓸 수 없어요. 아이디로 로그인해 주세요.',
  expired: '로그인 시간이 지났어요. 다시 시도해 주세요.',
  rate: '요청이 너무 많아요. 잠시 뒤에 다시 해 주세요.',
  verify: '메일 확인이 끝나지 않은 계정이에요. 구글에서 메일을 확인한 뒤 다시 해 주세요.',
  exists: '이미 다른 방법으로 가입한 메일이에요. 그 방법으로 로그인해 주세요.',
  other: '로그인하지 못했어요. 다시 시도해 주세요.',
});
const OAUTH_ERR_CODES = Object.freeze({
  signup_disabled: 'signup',
  user_banned: 'banned',
  provider_disabled: 'provider', oauth_provider_not_supported: 'provider',
  bad_oauth_state: 'expired', bad_oauth_callback: 'expired', flow_state_expired: 'expired', flow_state_not_found: 'expired', otp_expired: 'expired',
  over_request_rate_limit: 'rate', over_email_send_rate_limit: 'rate',
  provider_email_needs_verification: 'verify', email_not_confirmed: 'verify',
  identity_already_exists: 'exists', email_exists: 'exists', user_already_exists: 'exists',
});
export function oauthErrorKind(r) {
  const error = String(r?.error || '').toLowerCase(), code = String(r?.errorCode || '').toLowerCase();
  const known = OAUTH_ERR_CODES[code] || OAUTH_ERR_CODES[error];
  if (known) return known;
  const all = code + ' ' + String(r?.description || '').slice(0, 200);
  if (/signup/i.test(all) && /disabled|not allowed/i.test(all)) return 'signup';
  if (/banned/i.test(all)) return 'banned';
  if (error === 'access_denied' && !/disabled|provider/i.test(all)) return 'cancel';
  return 'other';
}
export function oauthErrorText(r) { return OAUTH_ERR[oauthErrorKind(r)]; }

// One account (or one guest) per window: what a window does when the session in shared storage is not the one it shows.
// have: the account id this window shows ('' for a guest). known: the stored session could be read (false after a failed
// refresh or with no client: nothing is done then, a network error must never sign anyone out). user: the stored
// account id ('' when no session is stored).
//   'in'    another window signed in: link here too        'out'   another window signed out: go on as a guest
//   'swap'  another account is stored: leave this one, then link that one        'none'  nothing to do
export function sessionDrift({ have, known, user } = {}) {
  const mine = String(have || ''), theirs = String(user || '');
  if (!known || mine === theirs) return 'none';
  if (!mine) return 'in';
  return theirs ? 'swap' : 'out';
}

// Supabase auth errors in Korean. Our own Korean messages pass through; anything else becomes one plain line.
export function authErrorText(e) {
  const m = String(e?.message || (typeof e === 'string' ? e : '') || ''), code = String(e?.code || ''), status = Number(e?.status) || 0;
  const all = m + ' ' + code;
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(m)) return '아이디 또는 비밀번호가 맞지 않아요';
  if (code === 'user_already_exists' || code === 'email_exists' || /already registered|already been registered/i.test(m)) return '이미 가입한 아이디예요. 로그인해 주세요.';
  if (code === 'same_password' || /should be different from the old password/i.test(m)) return '지금 비밀번호와 같아요. 다른 비밀번호를 적어 주세요.';
  if (code === 'weak_password' || /password should|weak.?password|password.*at least/i.test(m)) return '비밀번호는 6자 이상이어야 해요';
  if (code === 'reauthentication_needed' || /reauthentication/i.test(m)) return '보안을 위해 로그아웃한 뒤 다시 로그인하고 바꿔 주세요.';
  if (code === 'session_not_found' || /auth session missing/i.test(m)) return '로그인이 끝나 있어요. 다시 로그인한 뒤 바꿔 주세요.';
  if (status === 429 || /rate.?limit|too many requests|for security purposes/i.test(all)) return '요청이 너무 많아요. 잠시 뒤에 다시 해 주세요.';
  if (e?.name === 'AuthRetryableFetchError' || /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(m)) return '네트워크에 연결하지 못했어요. 연결을 확인하고 다시 해 주세요.';
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(m)) return '메일 확인이 끝나지 않은 계정이에요';
  if (code === 'email_address_invalid' || /email address.*invalid|unable to validate email/i.test(m)) return '이메일 또는 아이디를 확인해 주세요';
  if (/code verifier|flow.?state|auth code/i.test(all)) return '로그인 시간이 지났어요. 다시 시도해 주세요.';
  if (/[가-힣]/.test(m)) return m;
  return '로그인에 실패했어요';
}

// What the settings sheet shows for an account: the bare id for an id sign-up (…@id.wishboard.dev is not a mailbox), else the e-mail.
export function accountLabel(email) {
  const s = String(email || '').trim();
  if (!s) return { kind: '', text: '' };
  const m = /^([^@\s]+)@id\.wishboard\.dev$/i.exec(s);
  return m ? { kind: 'id', text: m[1] } : { kind: 'email', text: s };
}

export function loginEmail(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s.length > 80) return '';
  if (s.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
  if (!/^[a-z0-9._-]{3,32}$/.test(s)) return '';
  return `${s}@id.wishboard.dev`;
}

export function mergeCoins({ userCoins = 0, guestCoins = 0, bonusPaid = false } = {}) {
  const user = Math.max(0, Math.floor(Number(userCoins) || 0));
  const guest = Math.max(0, Math.floor(Number(guestCoins) || 0));
  const bonus = bonusPaid ? 0 : LINK_BONUS;
  return { coins: user + guest + bonus, bonus, bonusPaid: true, guestLeft: 0 };
}

export function protectMinutes(tier, actorId) {
  const base = tier === 'S' ? 120 : tier === 'B' ? 60 : 30;
  return base + (String(actorId || '').startsWith('user:') ? LINKED_PROTECT_MIN : 0);
}

export function slotTier(slotId) {
  const s = String(slotId || '');
  if (s.startsWith('MAIN')) return 'S';
  if (s.startsWith('SUB')) return 'B';
  return 'C';
}

export function linkedActor(id, flag) {
  return flag === true || String(id || '').startsWith('user:');
}

export const CHEER_PHRASES = Object.freeze([
  '응원해요', '오늘도 빛나요', '이름이 보여요', '같이 걸어요',
  '대단해요', '축하해요', '힘을 내요', '보고 있어요',
  '최고예요', '내일도 켜요', '우리 편이에요', '타임스퀘어에 걸렸어요',
]);

export const BAN_WORDS = Object.freeze([
  '씨발', '시발', '병신', '좆', '지랄',
  'fuck', 'shit', 'bitch', 'nigger', 'nigga',
]);

export const LINK_HOSTS = Object.freeze([
  'instagram.com', 'www.instagram.com',
  'threads.net', 'www.threads.net',
  'youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com',
  'smartstore.naver.com',
]);

export function blockedText(text) {
  const hay = String(text || '').toLowerCase();
  return BAN_WORDS.some((w) => hay.includes(String(w).toLowerCase()));
}

export function allowedLink(url) {
  const raw = String(url || '');
  if (!raw.startsWith('https://') || raw.length > 200) return null;
  let host = '';
  try { host = new URL(raw).hostname.toLowerCase(); } catch { return null; }
  const ok = LINK_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  return ok ? raw.slice(0, 200) : null;
}

export function statsFromCounts(counts) {
  const n = (k) => {
    const v = Math.floor(Number(counts?.[k]));
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  const visits = n('page_landing');
  const enters = n('enter_square');
  return {
    visits,
    enter_rate: visits ? Math.round((enters / visits) * 100) : 0,
    taxi_trips: n('taxi_dropoff'),
    billboard_claims: n('board_claim'),
    outbound_clicks: n('outlink_click'),
    account_conversions: n('auth_login_success'),
  };
}
