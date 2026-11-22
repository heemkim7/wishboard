// 친구 초대: pure rules shared by the browser, the Worker (it bundles this module, so it is imported with no query) and the tests.
// Every shared link carries the sharer's code (?inv=). When a friend who came through it posts their first wish, both get coins,
// at most once per invitee, from distinct IP nets, within the inviter's daily and total caps. Refusal reasons never reach a client.
import { ipNet } from './wish.js';
export const INVITE = Object.freeze({
  inviter: 100, invitee: 100, // coins to each side
  perDay: 5, total: 50, // rewarded friends per inviter per KST day / ever
  ipDay: 1, ipTotal: 3, // rewards one IP net can be the invitee side of, per KST day across all inviters / ever
  wideDay: 5, // rewards per KST day whose invitee sits in one coarse prefix (IPv6 /48, IPv4 /24): one tunnel or block mints at most 1,000 a day
  dayAll: 40, // rewarded invites per KST day across the whole service: the bound on coins minted (40 × 200 a day)
  // A pair refused only for a daily limit (ipday, wide, capday, full) waits in the queue and is served on a later day, round-robin by coarse prefix.
  queueDays: 7, // dropped after this many days
  queueMax: 200, // waiting pairs in all; a pair over it is refused for good
  passRows: 50, // waiting pairs one call looks at, at most
  passPairs: 3, // pairs one queue pass rewards (their payments are written pending and handed out within the budget below)
  payWish: 2, payMax: 3, pushMax: 1, // invite payments handed out per invocation (a wish post / any other route), and inviter pushes per invocation
  newDays: 7, // an account first seen more than this many days ago is not new
  fromDays: 7, // the client forgets a landing code (kts_inv_from) this many days after it kept it
  tries: 8, retryMs: 60000, // a payment Supabase clearly refused (no wallet row yet) is handed out again, 60 s apart, this many times in all
  recentMax: 20,
});
export const INV_RE = /^[0-9a-z]{8}$/;
export const invCode = (v) => { const s = String(v ?? ''); return INV_RE.test(s) ? s : ''; };
// 8 characters from [0-9a-z], uniform (bytes ≥ 252 are dropped so x % 36 has no bias). Random, never derived from the account id.
export function newCode(rand = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  let out = '';
  while (out.length < 8) for (const x of rand(16)) { if (x < 252 && out.length < 8) out += (x % 36).toString(36); }
  return out;
}
// '' = the invite pays. inviter: the code's owner ('' for an unknown code). group: accounts linked to the invitee (guest↔user aliases).
// seen: the invitee (or its group) was an invitee before. old: it posted a wish on an earlier day, holds a board it bid for, a plot or a spend
// rank, or was first seen more than newDays ago. ip: the invitee's hashed IP net; inviterIps: nets the inviter used creating the code or today.
// perDay/total: the inviter's rewards so far; ipDay/ipTotal: rewards this IP net was the invitee side of; wideDay: today's rewards in its coarse
// prefix; dayAll: rewards today, service-wide. Permanent reasons come first, so a daily one (inviteWaits) means nothing else stands in the way.
export function inviteFault({ inviter = '', invitee = '', group = [], seen = false, old = false, ip = '', inviterIps = [], perDay = 0, total = 0, ipDay = 0, ipTotal = 0, wideDay = 0, dayAll = 0 } = {}) {
  if (!inviter || !invitee) return 'code';
  if (inviter === invitee || (Array.isArray(group) && group.includes(inviter))) return 'self';
  if (seen) return 'seen';
  if (old) return 'old';
  if (!ip || (Array.isArray(inviterIps) && inviterIps.includes(ip))) return 'ip';
  if (ipTotal >= INVITE.ipTotal) return 'ipcap';
  if (total >= INVITE.total) return 'cap';
  if (ipDay >= INVITE.ipDay) return 'ipday';
  if (wideDay >= INVITE.wideDay) return 'wide';
  if (perDay >= INVITE.perDay) return 'capday';
  if (dayAll >= INVITE.dayAll) return 'full';
  return '';
}
// Reasons that only last the day: the pair waits in the queue instead of being refused for good.
export const INVITE_WAIT = Object.freeze(['ipday', 'wide', 'capday', 'full']);
export const inviteWaits = (fault) => INVITE_WAIT.includes(String(fault || ''));
// The master switch: the feature mints coins only when the Worker environment has INVITE_ON = '1' (a secret or var; off when missing).
export const inviteOn = (env) => env?.INVITE_ON === '1';
// What the screen shows and sends. on: /rt/config carried `invite: true`. Off: no code on links, no lines, nothing sent with a wish.
export function inviteView({ on = false, code = '', sum = null, from = '' } = {}) {
  if (!on) return { code: '', line: '', box: '', send: '' };
  return { code: invCode(code), line: Number(sum?.count) >= INVITE.total ? '' : `친구가 이 링크로 와서 소원을 걸면 둘 다 응원 포인트 ${INVITE.invitee}`, box: inviteLine(sum), send: invCode(from) };
}
// The coarse prefix of an address for the wideDay cap: IPv6 /48, IPv4 /24 ('x' when there is none). Hashed by the Worker like wishIp.
export function ipWide(ip) {
  const n = ipNet(ip);
  if (n.endsWith('::/64')) return n.split(':').slice(0, 3).join(':') + '::/48';
  const v4 = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(n);
  return v4 ? v4[1] + '.0/24' : n;
}
// kts_inv_from as stored ({ c, at }), or '' once it is older than fromDays or malformed.
export function inviteFrom(raw, now = Date.now()) {
  let v = null;
  try { v = JSON.parse(String(raw || 'null')); } catch { return ''; }
  const c = invCode(v?.c), at = Number(v?.at);
  return c && Number.isFinite(at) && at <= now + 60000 && now - at <= INVITE.fromDays * 864e5 ? c : '';
}
// The link with ?inv=<code> when it points at one of `origins` (this site); any other link, or no valid code, comes back unchanged.
export function withInvite(url, code, origins = []) {
  const c = invCode(code), s = String(url || '');
  if (!c || !s) return s;
  let u;
  try { u = new URL(s); } catch { return s; }
  const ok = (Array.isArray(origins) ? origins : [origins]).some((o) => { try { return new URL(String(o)).origin === u.origin; } catch { return false; } });
  if (!ok) return s;
  u.searchParams.set('inv', c);
  return u.toString();
}
// The wish sheet line: '' until somebody came through my links.
export function inviteLine(sum) {
  const n = Math.max(0, Math.floor(Number(sum?.count) || 0));
  return n > 0 ? `초대한 친구 ${n}명 · 받은 포인트 ${Math.max(0, Math.floor(Number(sum?.earned) || 0)).toLocaleString('ko-KR')}` : '';
}
// The 다녀간 사이 row for rewards paid since `seen` (ms, the newest one shown before), or null. at = the newest of them.
export function inviteNews(sum, seen = 0) {
  const fresh = (Array.isArray(sum?.recent) ? sum.recent : []).map(Number).filter((t) => Number.isFinite(t) && t > (Number(seen) || 0));
  if (!fresh.length) return null;
  return { kind: 'invite', id: 0, slot: '', text: `초대한 친구 ${fresh.length}명이 소원을 걸었어요. +${(fresh.length * INVITE.inviter).toLocaleString('ko-KR')} 포인트`, label: '소원 보기', at: Math.max(...fresh) };
}
