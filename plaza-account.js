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

export function chromeIntent(httpsUrl) {
  const u = new URL(httpsUrl);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;end`;
}

export function loginEmail(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s.length > 80) return '';
  if (s.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
  if (!/^[a-z0-9._-]{3,32}$/.test(s)) return '';
  return `${s}@id.wishboard.dev`;
}

export function profileName(user) {
  const ids = Array.isArray(user?.identities) ? user.identities : [];
  const google = user?.app_metadata?.provider === 'google' || ids.some((i) => i?.provider === 'google');
  if (!google) return '';
  const m = user?.user_metadata || {};
  return String(m.full_name || m.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16);
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
