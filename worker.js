// Worker name: studio (https://studio.wishboard.workers.dev)
// K-Times Square plaza on the same Workers Free stack: floor is fixed at 0.
// 마실채플 realtime on Cloudflare Workers Free: static assets + SQLite Durable Objects (WebSocket Hibernation).
// Room DO (one per channel topic): presence, broadcast relay (pos filtered by floor = zone sync), FIFO queue, CAP per channel.
// Meter DO: daily (UTC) estimate of billed DO requests -> lean mode at 80%, solo (down) at 95% of the Free 100k/day.
// Supabase keeps auth, DB and RPCs only. No timers in DOs (hibernation-friendly); alarms only while someone waits.
import { DurableObject } from 'cloudflare:workers';
import { BALANCE, slotName, josa, SLOT_IDS, PAY, scaledPay, bakeBase, danceBase, farePay, ballOpen, auctionClosed, stickerNext, chainBoost, buildingOf, cheerCount, STARTER_DEFAULT, starterList } from './balance.js';
import { nextBallUntil, drawSpan } from './live.js';
import { CHEER_PHRASES, EVENT_NAMES, allowedLink, blockedText, parseGuestHandover, statsFromCounts } from './plaza-account.js';
import { renderCardPng } from './cardpng.js';
import { WISH, WISH_ERR, cleanWish, cleanNick, wishFault, wishNickFault, ipNet, rankWishes, prizeFor, boardMix, wishShareText } from './wish.js';
import { ghostPacket } from './ts3d/walkers.js';
import { LEAGUE, leagueBoard, leagueCut, weekEnds, botNick } from './league.js';
import { DARK, quietShift, darkNext, darkHours, darkText, litOf } from './dark.js';
import { INVITE, invCode, newCode, inviteFault, inviteWaits, inviteOn, ipWide } from './invite.js';
import { adTables, adIngest, adTenure, adRename, adForget, adReport } from './adreport.js';
// v16 cost pass: ping 25s (client) / STALE 75s, idle scan alarm 60s, meter report 60s, compact pos ('p'/'P'), nearby fanout, event ring + world cache, HMAC guest tokens.
const CAP = 50, MEM = 0.125, LEAN = 0.8, HARD = 0.95, STALE = 75000, SCAN = 5000, IDLE_SCAN = 60000, REP = 60000;
const NEAR_R = 1600, FAR_MS = 3000, HIST_N = 10, PRAY_TTL = 15;
// Budget guard. Default = Workers Free daily limits (safe on Free). Only if the Worker var PLAN === 'paid' are paid-plan
// cost-safety budgets used (overridable with BUDGET_REQ_DAY / BUDGET_GBS_DAY vars). This never changes the account plan.
const FREE = { DAY: 100000, GBS: 13000 }, PAID = { DAY: 30e6, GBS: 3e6 };
let BUD = FREE;
const budget = env => { const p = env && env.PLAN === 'paid' ? PAID : FREE; BUD = { DAY: +(env && env.BUDGET_REQ_DAY) || p.DAY, GBS: +(env && env.BUDGET_GBS_DAY) || p.GBS }; return BUD; };
const lvlOf = (n, g = 0) => { const f = Math.max(n / BUD.DAY, g / BUD.GBS); return f >= HARD ? 2 : f >= LEAN ? 1 : 0; };
const today = () => new Date().toISOString().slice(0, 10);
// Budget tally: DO calls the Worker makes for HTTP routes, summed per isolate and added to 'day' at most once per TALLY_MS (a /rt/gate read that comes
// first carries it too). Not counted here: Meter.add (it counts its own call) and the /rt/ws upgrade (the Room counts the connection). A tail lost with
// the isolate is accepted; a failed add is not retried, so nothing is counted twice. LVL is the level the last add answered, at most LVL_TTL old.
const TALLY_MS = 25000, LVL_TTL = 60000, FLUSH_DEAD = 10000, CTX = Symbol('ctx');
let TALLY = { n: 0, at: 0, p: null, pAt: 0 }, LVL = { l: 0, at: 0 };
const stale = (at, ms, now = Date.now()) => now - at >= ms || now < at;
const upgrade = r => /^websocket$/i.test(String(r?.headers?.get?.('Upgrade') || ''));
// Every function handed out runs on the real stub (never with the Proxy as receiver). Not counted: add (counts itself), the /rt/ws upgrade, symbol keys.
// Non-functions and then pass through untouched.
const tallyStub = s => new Proxy(s, { get(t, k) { const v = Reflect.get(t, k); if (typeof v !== 'function' || k === 'then') return v;
  return (...a) => { if (typeof k === 'string' && k !== 'add' && !(k === 'fetch' && upgrade(a[0]))) TALLY.n++; return Reflect.apply(v, t, a); }; } });
const tallyNs = ns => ns && new Proxy(ns, { get(t, k) { const v = Reflect.get(t, k); if (typeof v !== 'function') return v;
  return k === 'get' || k === 'getByName' ? (...a) => tallyStub(Reflect.apply(v, t, a)) : k === 'jurisdiction' ? (...a) => tallyNs(Reflect.apply(v, t, a)) : (...a) => Reflect.apply(v, t, a); } });
// One add carrying the pending count; it sets LVL. A throw drops the taken count (never re-added) and keeps the old level until LVL_TTL (fail open).
async function tallyAdd(env) { const n = TALLY.n; TALLY.n = 0; TALLY.at = Date.now();
  try { const r = await env.METER.get(env.METER.idFromName('day')).add(n); LVL = { l: Number(r?.lvl) || 0, at: Date.now() }; return r; } catch (e) { LVL.at = Date.now(); throw e; } }
// Starts an add in this request's waitUntil, or null while another request's add is in flight. One older than FLUSH_DEAD (its request may have been
// cancelled) is forgotten, so a lost promise never blocks later requests.
function tallyFlush(env, ctx) { const now = Date.now(); if (TALLY.p && !stale(TALLY.pAt, FLUSH_DEAD, now)) return null;
  const p = TALLY.p = tallyAdd(env).catch(() => null).finally(() => { if (TALLY.p === p) TALLY.p = null; }); TALLY.pAt = now; try { ctx?.waitUntil?.(p); } catch { } return p; }
// The env every HTTP route sees: inherits every binding from the runtime env (no Proxy over it), with own counting METER / ROOM and env[CTX] = this
// request's ctx and the add it started. Durable Objects and scheduled keep the raw env. The count of earlier requests goes out once TALLY_MS has passed.
function tallied(env, ctx) { const me = { ctx, own: TALLY.n > 0 && stale(TALLY.at, TALLY_MS) ? tallyFlush(env, ctx) : null };
  return Object.create(env, { METER: { value: tallyNs(env.METER), enumerable: true }, ROOM: { value: tallyNs(env.ROOM), enumerable: true }, [CTX]: { value: me } }); }
// The level the wish, share and push routes obey, without a DO call per request: once LVL_TTL old, this request refreshes it with its own add
// (carrying the tally). It never waits on another request's add: while one is in flight the current level stands.
async function lvlNow(env) { if (stale(LVL.at, LVL_TTL)) { const me = env[CTX], p = tallyFlush(env, me?.ctx) || me?.own; if (p) await p; } return LVL.l; }
const SUPA = 'https://yxddhpacuyaffaoutxjn.supabase.co', ANON = 'sb_publishable_Vd-7c6e2f2s3G1d5Jbx9vw_0UCuHm-B'; // public
// Supabase JWT check (guest = anonymous sign-in tokens too). Public JWKS only: no secret needed or stored.
let JW = { at: 0, keys: new Map() };
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function jwk(kid) { if (!JW.keys.has(kid) || Date.now() - JW.at > 6e5) { const r = await fetch(SUPA + '/auth/v1/.well-known/jwks.json', { cf: { cacheTtl: 600 } }); const j = await r.json(); JW = { at: Date.now(), keys: new Map() };
    for (const k of j.keys || []) if (k.kty === 'EC') JW.keys.set(k.kid, await crypto.subtle.importKey('jwk', k, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])); } return JW.keys.get(kid); }
export async function verifyJwt(t) { const [h, p, g] = String(t || '').split('.'); if (!g) return null; const H = JSON.parse(new TextDecoder().decode(b64u(h))); if (H.alg !== 'ES256') return null;
  const key = await jwk(H.kid); if (!key) return null; const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64u(g), new TextEncoder().encode(h + '.' + p)); if (!ok) return null;
  const P = JSON.parse(new TextDecoder().decode(b64u(p))); if (!P.sub || P.exp * 1000 < Date.now() - 30000 || P.iss !== SUPA + '/auth/v1' || P.aud !== 'authenticated') return null; return P; }
// Guest identity without Supabase anonymous sign-in (no MAU): HMAC-SHA256 token signed with the Worker secret GUEST_KEY.
// Format g1.<b64u {"s":sub,"e":exp_s,"i":iat_s}>.<b64u sig>. Renewal keeps the same sub if the old token's signature is valid (<=180d old).
const b64e = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let GK = null;
async function gkey(env) { if (!env.GUEST_KEY) return null; if (!GK || GK.raw !== env.GUEST_KEY) GK = { raw: env.GUEST_KEY, k: await crypto.subtle.importKey('raw', new TextEncoder().encode(env.GUEST_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']) }; return GK.k; }
// The tag is part of the signed text, so a handover ticket (h1) never passes as a guest token (g1) or the reverse.
async function seal(env, tag, body) { const k = await gkey(env); if (!k) return null; const p = b64e(new TextEncoder().encode(JSON.stringify(body)));
  const g = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(tag + '.' + p))); return tag + '.' + p + '.' + b64e(g); }
async function unseal(env, tag, t, graceS = 0) { try { const [v, p, g] = String(t || '').split('.'); if (v !== tag || !g) return null; const k = await gkey(env); if (!k) return null;
    if (!(await crypto.subtle.verify('HMAC', k, b64u(g), new TextEncoder().encode(tag + '.' + p)))) return null; const P = JSON.parse(new TextDecoder().decode(b64u(p)));
    if (!/^g-[0-9a-f-]{36}$/.test(P.s || '') || (P.e + graceS) * 1000 < Date.now()) return null; return P; } catch { return null; } }
async function guestSign(env, sub) { const now = Math.floor(Date.now() / 1000), exp = now + 30 * 86400, token = await seal(env, 'g1', { s: sub, e: exp, i: now }); return token ? { token, sub, exp } : null; }
export const guestVerify = (env, t, graceS = 0) => unseal(env, 'g1', t, graceS);
// Handover ticket h1.<b64u {"s":sub,"e":exp_s}>.<b64u sig>: lets another browser of the same person take over a guest. A guest id is public
// (ranks, presence, wallets), so /rt/guest never signs for a bare id: POST /rt/handover gives a ticket only to that guest's own valid token.
const TICKET_S = 900;
const ticketVerify = (env, t) => unseal(env, 'h1', t);
// Plaza identity. HMAC guests and Supabase users share one wallets.actor_id space.
export async function resolveActor(env, token) {
  try {
    const t = String(token || ''); if (!t) return null;
    if (t.startsWith('g1.')) { const G = await guestVerify(env, t); return G ? { id: 'guest:' + G.s, sub: G.s, guest: true, anon: true } : null; }
    const P = await verifyJwt(t); if (!P?.sub) return null; return { id: 'user:' + P.sub, sub: P.sub, guest: false, anon: !!P.is_anonymous };
  } catch { return null; }
}
const FLUSH_N = 20, FLUSH_MS = 30000;
const TRIBE_FLUSH_N = 20; // Room flushTribeScores: add_tribe_score fetches per pass
const MINE_GAP = 2000, MINE_CAP = 15, GAP_EARLY = 400;
const AD_PAY = 15, AD_DAY = 5; // link visit: once per account per board per KST day, AD_DAY boards a day
const MOVE_N = 8, MOVE_MS = 30000; // room moves per account: 8 in a row (a full queue bumps through square-2..8), then one per 30 s
const RELAY = ['take', 'react', 'jump'], RELAY_N = 30, RELAY_MS = 10000; // client broadcasts the game uses, numbers only; 30 per 10 s per socket
const EV_STEP = { page_landing: 1, enter_square: 2, first_coin: 4, board_claim: 8 }, EV_RET = [1, 7, 30], EV_KEEP = 14;
// Growth funnel steps (admin 성장 퍼널), one bit each: landing, entered, posted a wish, shared a link, arrived by a shared link, came back on a later day.
const EV_GROW = { page_landing: 1, enter_square: 2, wish_post: 4, wish_share: 8, share_link: 8, share_send: 8, wish_land: 16, focus_enter: 16, return_visit: 32 };
// Once-only and per-day gates per account: (uid, k, d) -> count, d = KST day or '' for ever. Counts only grow, so copies merge by max.
const PS_MAX = 50000, PS_TTL = 60 * 864e5; // immediate-push subscriptions kept in the 'push' instance, and how long one lives without a re-subscribe
const AG = 'create table if not exists ag(uid text, k text, d text, v integer not null, primary key(uid, k, d))';
const agGet = (q, uid, k, d) => { const r = q.exec('select v from ag where uid = ? and k = ? and d = ?', uid, k, d).toArray()[0]; return r ? Number(r.v) : 0; };
const agPut = (q, uid, k, d, v) => { q.exec('insert into ag(uid, k, d, v) values(?, ?, ?, ?) on conflict(uid, k, d) do update set v = max(v, excluded.v)', uid, k, d, v); };
const agSet = (q, uid, k, d, v) => { q.exec('insert into ag(uid, k, d, v) values(?, ?, ?, ?) on conflict(uid, k, d) do update set v = excluded.v', uid, k, d, v); };
const agAll = (q, uid) => q.exec('select k, d, v from ag where uid = ?', uid).toArray().map(r => [String(r.k), String(r.d), Number(r.v)]);
// position array from a client -> [x, y, face, anim, fl, vx, vy]: rounded numbers and short strings only
const posOf = A => { const n = v => (typeof v === 'number' && isFinite(v) ? Math.round(v) : 0), sv = v => (typeof v === 'string' ? v.slice(0, 12) : null);
  return [n(A[0]), n(A[1]), sv(A[2]), sv(A[3]), (typeof A[4] === 'number' && isFinite(A[4])) ? A[4] : sv(A[4]), n(A[5]), n(A[6])]; };

export class Meter extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.env = env; this.sq = new Map(); ctx.storage.sql.exec('create table if not exists d(day text primary key, n real)'); ctx.storage.sql.exec('create table if not exists g(day text primary key, s real)'); }
  add(n, gbs = 0) { budget(this.env); const d = today(); if (gbs) this.ctx.storage.sql.exec('insert into g values(?,?) on conflict(day) do update set s = s + excluded.s', d, gbs); this.ctx.storage.sql.exec('insert into d values(?,?) on conflict(day) do update set n = n + excluded.n', d, n + 1);
    const t = this.ctx.storage.sql.exec('select n from d where day = ?', d).one().n, g = [...this.ctx.storage.sql.exec('select s from g where day = ?', d)][0]?.s || 0; return { n: t, g, lvl: lvlOf(t, g) }; }  // q5 group weekly attendance (one DO instance 'grp'): one count per guest per KST day, top 10 per ISO week. Old day keys pruned.
  grpInit() { if (this.gi) return; this.gi = 1; const q = this.ctx.storage.sql; q.exec('create table if not exists gw(w text, c text, n integer, primary key(w,c))'); q.exec('create table if not exists gu(d text, s text, primary key(d,s))'); q.exec('create table if not exists ps(e text primary key, k text, at integer, sent integer default 0)'); }
  grpAdd(c, sub, d, w) { this.grpInit(); const q = this.ctx.storage.sql; if (q.exec('insert or ignore into gu values(?,?)', d, sub).rowsWritten < 1) return { dup: 1 };
    q.exec('insert into gw values(?,?,1) on conflict(w,c) do update set n = n + 1', w, c); if (Math.random() < 0.02) { q.exec('delete from gu where d < ?', d); } return { ok: 1 }; }
  grpTop(w) { this.grpInit(); return [...this.ctx.storage.sql.exec('select c, n from gw where w = ? order by n desc limit 10', w)].map(r => [r.c, r.n]); }
  // q5 web push subscriptions (payload-less; no keys needed beyond the endpoint)
  pushAdd(e) { this.grpInit(); const q = this.ctx.storage.sql; const n = q.exec('select count(*) as n from ps').one().n; if (n >= 20000) return { full: 1 }; q.exec('insert or ignore into ps(e, at) values(?,?)', e, Date.now()); return { ok: 1 }; }
  pushDel(e) { this.grpInit(); this.ctx.storage.sql.exec('delete from ps where e = ?', e); return { ok: 1 }; }
  pushBatch(n, tag) { this.grpInit(); const q = this.ctx.storage.sql; const r = [...q.exec('select e from ps where sent < ? order by sent asc limit ?', tag, n)].map(x => x.e); for (const e of r) q.exec('update ps set sent = ? where e = ?', tag, e); return r; }
  // snx (new table, snap itself is older): what a snapshot was taken of, k 'slot' | 'wish', the validated id, and u the uploader (the holder / author
  // the Worker checked). u never leaves the Worker. Pruned with snap.
  snapInit() { if (this.sp) return; this.sp = 1; const q = this.ctx.storage.sql; q.exec('create table if not exists snap(id text primary key, jpeg blob, at integer)');
    q.exec("create table if not exists snx(id text primary key, k text not null, r text not null, u text not null default '', at integer not null)");
    try { q.exec("alter table snx add column u text not null default ''"); } catch { /* column already exists */ } q.exec('create index if not exists snx_kr on snx(k, r, u, at)'); }
  snapPut(id, bytes, k = '', r = '', u = '') { this.snapInit(); const q = this.ctx.storage.sql; q.exec('insert into snap values(?,?,?)', id, bytes, Date.now()); if (k && r && u) q.exec('insert or replace into snx(id, k, r, u, at) values(?, ?, ?, ?, ?)', id, String(k), String(r), String(u), Date.now());
    q.exec('delete from snap where at < ?', Date.now() - 7 * 86400000); const n = Number(q.exec('select count(*) n from snap').one().n) || 0; if (n > 400) q.exec('delete from snap where id in (select id from snap order by at asc limit ?)', n - 300);
    q.exec('delete from snx where id not in (select id from snap)'); return { ok: true }; }
  snapGet(id) { this.snapInit(); const row = this.ctx.storage.sql.exec('select jpeg from snap where id = ?', id).toArray()[0]; return row?.jpeg || null; }
  // null = no such snapshot (or pruned); otherwise its context, { k: '', r: '' } when it was uploaded without one.
  snapCtx(id) { this.snapInit(); const q = this.ctx.storage.sql; if (!q.exec('select id from snap where id = ?', String(id || '')).toArray()[0]) return null;
    const x = q.exec('select k, r, u from snx where id = ?', String(id)).toArray()[0]; return { k: String(x?.k || ''), r: String(x?.r || ''), u: String(x?.u || '') }; }
  // Newest snapshot of (k, r) uploaded by u (the board's current holder / the wish's author), so a takeover never previews the old holder's shot.
  // Account merge: the guest's shots now belong to the user id that merge_guest_account moved its boards to.
  snapMove(from, to) { this.snapInit(); const f = String(from || ''), t = String(to || ''); if (!f || !t || f === t) return { ok: false }; this.ctx.storage.sql.exec('update snx set u = ? where u = ?', t, f); return { ok: true }; }
  // Account withdrawal: every shot recorded as this account's upload goes, image and context. A shot stored without an uploader (no context) cannot be
  // attributed and stays until the 7-day prune.
  snapForget(uid) { this.snapInit(); const u = String(uid || ''); if (!u) return { ok: false }; const q = this.ctx.storage.sql;
    q.exec('delete from snap where id in (select id from snx where u = ?)', u); q.exec('delete from snx where u = ?', u); return { ok: true }; }
  // Board report (instance 'ad', adreport.js): what the rooms counted per slot and KST day, since the current holder's tenure began.
  adI() { if (!this.ai) { this.ai = 1; adTables(this.ctx.storage.sql); } }
  adAdd(items, people) { this.adI(); return adIngest(this.ctx.storage.sql, items, people); }
  adClaim(slot, holder, prev) { this.adI(); return adTenure(this.ctx.storage.sql, slot, holder, prev); }
  adMove(from, to) { this.adI(); return adRename(this.ctx.storage.sql, from, to); }
  adForget(uid) { this.adI(); return adForget(this.ctx.storage.sql, uid); }
  adRead(slot, holder) { this.adI(); return adReport(this.ctx.storage.sql, slot, holder); }
  snapFor(k, r, u) { this.snapInit(); if (!u) return null; const x = this.ctx.storage.sql.exec('select x.id from snx x join snap s on s.id = x.id where x.k = ? and x.r = ? and x.u = ? order by x.at desc limit 1', String(k), String(r), String(u)).toArray()[0]; return x ? String(x.id) : null; }
  // Immediate push (instance 'push', new tables). pss: up to 3 subscriptions per actor, keyed by endpoint (a browser belongs to its latest subscriber).
  // psg: last notice per (actor, kind), the minimum gap. Endpoints and actor ids never leave the Worker.
  psInit() { if (this.pi) return; this.pi = 1; const q = this.ctx.storage.sql;
    q.exec('create table if not exists pss(e text primary key, uid text not null, p text not null, a text not null, at integer not null)'); q.exec('create index if not exists pss_u on pss(uid, at)'); q.exec('create index if not exists pss_at on pss(at)');
    q.exec('create table if not exists psg(uid text, k text, at integer not null, primary key(uid, k))'); }
  psTrim(uid) { const q = this.ctx.storage.sql; q.exec('delete from pss where uid = ? and e not in (select e from pss where uid = ? order by at desc, e desc limit 3)', uid, uid); }
  // Rows not (re)subscribed for PS_TTL go first (a live browser re-sends its subscription each session, which refreshes at). Then, full (PS_MAX rows):
  // a new endpoint is refused rather than evicting other actors' rows; an endpoint already stored may still update.
  psAdd(uid, e, p, a) { this.psInit(); const q = this.ctx.storage.sql, u = String(uid || ''); if (!u) return { ok: false };
    q.exec('delete from pss where at < ?', Date.now() - PS_TTL);
    if (!q.exec('select e from pss where e = ?', String(e)).toArray()[0] && (Number(q.exec('select count(*) n from pss').one().n) || 0) >= PS_MAX) return { ok: false, full: true };
    q.exec('insert into pss(e, uid, p, a, at) values(?, ?, ?, ?, ?) on conflict(e) do update set uid = excluded.uid, p = excluded.p, a = excluded.a, at = excluded.at', String(e), u, String(p), String(a), Date.now()); this.psTrim(u);
    return { ok: true }; }
  psDel(uid, e) { this.psInit(); this.ctx.storage.sql.exec('delete from pss where e = ? and uid = ?', String(e), String(uid || '')); return { ok: true }; }
  psDrop(e) { this.psInit(); this.ctx.storage.sql.exec('delete from pss where e = ?', String(e)); return { ok: true }; }
  psMove(from, to) { this.psInit(); const f = String(from || ''), t = String(to || ''); if (!f || !t || f === t) return { ok: false }; this.ctx.storage.sql.exec('update pss set uid = ? where uid = ?', t, f); this.psTrim(t); return { ok: true }; }
  // Account withdrawal: its subscriptions and notice gaps go. e: the endpoints removed, for the Worker to drop the Supabase copies (never sent on).
  psForget(uid) { this.psInit(); const u = String(uid || ''); if (!u) return { ok: false, e: [] }; const q = this.ctx.storage.sql, e = q.exec('select e from pss where uid = ?', u).toArray().map(r => String(r.e));
    q.exec('delete from pss where uid = ?', u); q.exec('delete from psg where uid = ?', u); return { ok: true, e }; }
  // The actor's subscriptions if a notice of this kind may go now (and that notice is recorded), else []. No subscription records nothing.
  psDue(uid, k, gap, now = Date.now()) { this.psInit(); const q = this.ctx.storage.sql, u = String(uid || ''), kind = String(k || '');
    const subs = q.exec('select e, p, a from pss where uid = ? order by at desc limit 3', u).toArray(); if (!subs.length) return [];
    const g = q.exec('select at from psg where uid = ? and k = ?', u, kind).toArray()[0]; if (g && now - Number(g.at) < gap) return [];
    q.exec('insert into psg(uid, k, at) values(?, ?, ?) on conflict(uid, k) do update set at = excluded.at', u, kind, now); if (Math.random() < 0.02) q.exec('delete from psg where at < ?', now - 864e5);
    return subs.map(r => ({ endpoint: String(r.e), p256dh: String(r.p), auth: String(r.a) })); }
  // 불 꺼지기 전 (instance 'dark', table dk): one row per board held by a person, its clock in ms and which notice went (pre: 6 hours before, out: at
  // dark; a row goes once out is sent). One DO alarm at the earliest pending notice, no polling. Tribe-held, empty and already dark boards have no row.
  dkInit() { if (this.dki) return; this.dki = 1; const q = this.ctx.storage.sql; q.exec('create table if not exists dk(slot text primary key, uid text not null, lit integer not null, pre integer not null default 0, out integer not null default 0)');
    q.exec('create table if not exists dkx(k text primary key, v integer not null)'); } // dkx 'hold': until when a hard-budget retry holds the alarm
  dkPut(q, slot, uid, lit, now) { q.exec('insert into dk(slot, uid, lit, pre, out) values(?, ?, ?, ?, 0) on conflict(slot) do update set uid = excluded.uid, lit = excluded.lit, pre = excluded.pre, out = 0', slot, uid, lit, lit - DARK.preMs <= now ? 1 : 0); } // a 6-hour mark already passed is not sent
  // A board clock the Worker learned. A new holder or clock replaces the row (takeover, relight); the same holder and clock keep its flags (edit).
  async dkSet(slot, uid, lit, now = Date.now()) { this.dkInit(); const q = this.ctx.storage.sql, s = String(slot || ''), u = String(uid || ''), t = Math.floor(Number(lit)) || 0; if (!s) return { ok: false };
    const cur = q.exec('select uid, lit from dk where slot = ?', s).toArray()[0]; if (cur && u && cur.uid === u && Math.abs(Number(cur.lit) - t) < 1000) return { ok: true };
    if (!u || u.startsWith('tribe:') || t <= now) q.exec('delete from dk where slot = ?', s); else this.dkPut(q, s, u, t, now);
    await this.dkArm(now); return { ok: true }; }
  // Backfill from a world read, [{ slot, uid, lit }]: only slots the registry has no row for, and only boards still lit.
  async dkSeed(list, now = Date.now()) { this.dkInit(); const q = this.ctx.storage.sql; let n = 0;
    for (const b of Array.isArray(list) ? list.slice(0, 100) : []) { const s = String(b?.slot || ''), u = String(b?.uid || ''), t = Math.floor(Number(b?.lit)) || 0;
      if (!s || !u || u.startsWith('tribe:') || t <= now || q.exec('select slot from dk where slot = ?', s).toArray()[0]) continue; this.dkPut(q, s, u, t, now); n++; }
    if (n) await this.dkArm(now); return { ok: true, n }; }
  dkMove(from, to) { this.dkInit(); const f = String(from || ''), t = String(to || ''); if (!f || !t || f === t) return { ok: false }; this.ctx.storage.sql.exec('update dk set uid = ? where uid = ?', t, f); return { ok: true }; }
  async dkForget(uid) { this.dkInit(); this.ctx.storage.sql.exec('delete from dk where uid = ?', String(uid || '')); await this.dkArm(); return { ok: true }; }
  // The alarm goes to the earliest pending notice, or is removed when there is none. While a hard-budget retry holds it (dkx 'hold') it is never
  // brought earlier than that. -> the time set, 0 for none.
  async dkArm(now = Date.now()) { const q = this.ctx.storage.sql; let at = Infinity; for (const r of q.exec('select lit, pre, out from dk').toArray()) { const n = darkNext(r); if (n && n.at < at) at = n.at; }
    if (at === Infinity) { await this.ctx.storage.deleteAlarm(); return 0; } const hold = Number(q.exec("select v from dkx where k = 'hold'").toArray()[0]?.v) || 0;
    const t = Math.max(at, now + 1000, hold > now ? hold : 0); await this.ctx.storage.setAlarm(t); return t; }
  // Only the 'dark' instance ever sets an alarm; any other Meter instance has no dk table and returns here at once. One pass handles at most
  // DARK.passMax due rows, earliest first (subrequests per invocation); the rest follow 1 s later. The alarm and its push gap checks count in the daily
  // budget ('day'); at the hard level nothing is sent or marked and the alarm is held for DARK.retryMs.
  async alarm() { const q = this.ctx.storage.sql; let rows; try { rows = q.exec('select slot, uid, lit, pre, out from dk').toArray(); } catch { return; } this.dkInit();
    const now = Date.now(), due = rows.map(r => ({ r, n: darkNext(r) })).filter(x => x.n && x.n.at <= now).sort((x, y) => x.n.at - y.n.at).slice(0, DARK.passMax).map(x => x.r);
    if (due.length) { let lvl = 0; try { lvl = Number((await this.env.METER.get(this.env.METER.idFromName('day')).add(1 + due.length))?.lvl) || 0; } catch { /* unknown: send */ }
      if (lvl >= 2) { q.exec("insert into dkx(k, v) values('hold', ?) on conflict(k) do update set v = excluded.v", now + DARK.retryMs); await this.ctx.storage.setAlarm(now + DARK.retryMs); return; }
      q.exec("delete from dkx where k = 'hold'"); try { await this.dkFire(due, now); } catch { /* each flag is written before its send */ } }
    await this.dkArm(Date.now()); }
  // Each due row is checked against the board (one Supabase read for all): relit, taken or cleared without the registry hearing it -> the row takes the
  // board's state and nothing goes now. After that read nothing awaits until every flag is written, and each write first checks the row is still the
  // one this pass read (a claim may have replaced it meanwhile). Flags go before the sends: each notice at most once per (slot, lit_until).
  async dkFire(due, now) { const q = this.ctx.storage.sql, send = []; let live = null; try { live = await darkBoards(due.map(r => String(r.slot))); } catch { live = null; } // null: Supabase cannot say, the registry stands
    for (const r of due) { const s = String(r.slot), u = String(r.uid), lit = Number(r.lit), b = live && (live.get(s) || { uid: '', lit: 0 });
      const cur = q.exec('select uid, lit from dk where slot = ?', s).toArray()[0]; if (!cur || cur.uid !== u || Number(cur.lit) !== lit) continue; // replaced while the read was out
      if (b && (b.uid !== u || Math.abs(b.lit - lit) >= 1000)) { if (!b.uid || b.uid.startsWith('tribe:') || b.lit <= now) q.exec('delete from dk where slot = ?', s); else this.dkPut(q, s, b.uid, b.lit, now); continue; }
      if (darkNext(r).stage === 'pre' && now < lit) { q.exec('update dk set pre = 1 where slot = ?', s); send.push({ u, s, stage: 'pre', h: darkHours(lit, now) }); continue; }
      q.exec('update dk set pre = 1 where slot = ?', s); if (quietShift(lit) > now) continue; // a 6-hour notice held past dark is dropped; the dark one waits for 08:00
      q.exec('delete from dk where slot = ?', s); send.push({ u, s, stage: 'out', h: 6 }); }
    await darkSend(this.env, send); }
  // Account registry (instance 'acct'). An account sits in one room at a time. A room asks here only when the account is not already seated with it,
  // so there is no request per message. Moving closes the account's sockets in the old room, settles its pending coins and carries its once/daily
  // gates over (copies merge by max), so opening more topics or sockets never multiplies a limit.
  acInit() { if (this.acOk) return; this.acOk = 1; const q = this.ctx.storage.sql; q.exec(AG);
    q.exec('create table if not exists seat(uid text primary key, room text not null, n integer not null, fl integer not null, mv integer not null, mt integer not null)');
    q.exec('create table if not exists vis(d text, uid text, primary key(d, uid))'); q.exec('create table if not exists tal(d text, k text, n integer not null, primary key(d, k))'); }
  seat(uid, room, day) { const job = (this.sq.get(uid) || Promise.resolve()).then(() => this.seatNow(uid, room, day)), tail = job.then(() => { }, () => { }); // one move at a time per account
    this.sq.set(uid, tail); tail.then(() => { if (this.sq.get(uid) === tail) this.sq.delete(uid); }); return job; }
  // -> { n: seat number (grows with every move), fl: when the account last moved here (cooldown floor), gates } or { no: 1 } when it moves too often
  async seatNow(uid, room, day) { this.acInit(); const q = this.ctx.storage.sql, now = Date.now(); let s = q.exec('select room, n, fl, mv, mt from seat where uid = ?', uid).toArray()[0];
    if (!s) { s = { n: 1, fl: 0 }; q.exec('insert into seat(uid, room, n, fl, mv, mt) values(?, ?, 1, 0, ?, ?)', uid, room, MOVE_N, now); }
    else if (s.room !== room) { const add = Math.floor((now - Number(s.mt)) / MOVE_MS), left = Math.min(MOVE_N, Number(s.mv) + add); if (left < 1) return { no: 1 };
      const n = Number(s.n) + 1, mt = add ? now : Number(s.mt), rows = await this.env.ROOM.get(this.env.ROOM.idFromName(String(s.room))).evict(uid, n);
      for (const [k, d, v] of rows || []) agPut(q, uid, k, d, v);
      s = { n, fl: Date.now() }; q.exec('update seat set room = ?, n = ?, fl = ?, mv = ?, mt = ? where uid = ?', room, n, s.fl, left - 1, mt, uid); }
    this.visit(uid, day); if (Math.random() < 0.02) q.exec("delete from ag where d <> '' and d < ?", dayShift(day, -2));
    return { n: Number(s.n), fl: Number(s.fl), gates: agAll(q, uid) }; }
  // Rooms that seat an account seen on this KST day or the one before (vis), for the wish fan-out. A seat row stays after its sockets close, so this
  // over-counts a little, never under-counts a connected account.
  liveRooms(day) { this.acInit(); return this.ctx.storage.sql.exec('select distinct room from seat where uid in (select uid from vis where d >= ?)', dayShift(day, -1)).toArray().map(r => String(r.room)); }
  roomOf(uid) { this.acInit(); return String(this.ctx.storage.sql.exec('select room from seat where uid = ?', uid).toArray()[0]?.room || ''); }
  // Profile for the next 5 minutes. Entry reads Supabase once; messages do not.
  profileOf(uid) {
    const hit = this._prof?.get(String(uid || ''));
    if (!hit || Date.now() - hit.at > 300000) return null;
    return { av: hit.av, equip: hit.equip.slice() };
  }
  profilePut(uid, av, equip) {
    if (!this._prof) this._prof = new Map();
    const row = { av: speciesOf(av), equip: equipList(equip), at: Date.now() };
    this._prof.set(String(uid || ''), row);
    return { av: row.av, equip: row.equip.slice() };
  }
  gatePut(rows) { this.acInit(); const q = this.ctx.storage.sql; for (const [uid, k, d, v] of rows || []) agPut(q, uid, k, d, v); return { ok: 1 }; }
  // Boot screen "today": distinct accounts that connected to the plaza and successful billboard claims, per KST day.
  visit(uid, day) { this.acInit(); const q = this.ctx.storage.sql; if (q.exec('insert or ignore into vis(d, uid) values(?, ?)', day, uid).rowsWritten) this.tally(day, 'v');
    if (Math.random() < 0.01) q.exec('delete from vis where d < ?', dayShift(day, -2)); return { ok: 1 }; }
  wish(day) { this.acInit(); this.tally(day, 'w'); return { ok: 1 }; }
  tally(day, k) { this.ctx.storage.sql.exec('insert into tal(d, k, n) values(?, ?, 1) on conflict(d, k) do update set n = n + 1', day, k); }
  tallyOf(day) { this.acInit(); const o = { visitors: 0, wishes: 0 }; for (const r of this.ctx.storage.sql.exec('select k, n from tal where d = ?', day).toArray()) o[r.k === 'v' ? 'visitors' : 'wishes'] = Number(r.n) || 0; return o; }
  // Product events (instance 'ev'). One row written per event, with its account (guest or user), session and a few properties. No alarm: when a later
  // day's first event (or the admin readout) arrives, each finished KST day is folded into `daily` (visitors, new and returning, sessions, funnel, counts)
  // and `ret` (day-1/7/30 return by first-seen day), so history outlives the raw rows, which go after EV_KEEP days.
  evInit() { if (this.ei) return; this.ei = 1; const q = this.ctx.storage.sql;
    q.exec('create table if not exists evt(id integer primary key, t integer not null, sid text, uid text, k text not null, p text)');
    q.exec('create table if not exists mark(day text primary key, id0 integer not null)'); // first evt id of each day: a day is an id range, no index written per event
    q.exec('create table if not exists seen(uid text primary key, d0 text not null)'); q.exec('create table if not exists alias(guest text primary key, user text not null)');
    q.exec('create table if not exists daily(day text primary key, j text not null)'); q.exec('create table if not exists ret(d0 text, off integer, n integer not null, primary key(d0, off))'); }
  evAdd(name, day, sid = '', uid = '', p = '') { this.evInit(); const d = String(day || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false }; const q = this.ctx.storage.sql;
    q.exec('insert into evt(t, sid, uid, k, p) values(?, ?, ?, ?, ?)', Date.now(), String(sid), String(uid), String(name).slice(0, 40), String(p));
    if (this.evNow !== d) { this.evNow = d; q.exec('insert or ignore into mark(day, id0) select ?, max(id) from evt', d); this.evFold(d); }
    return { ok: true }; }
  // A linked guest keeps its history: its sessions count as the user, and the user inherits the guest's first-seen day.
  evAlias(guest, user) { this.evInit(); const q = this.ctx.storage.sql; q.exec('insert or replace into alias(guest, user) values(?, ?)', guest, user);
    const d0 = q.exec('select d0 from seen where uid = ?', guest).toArray()[0]?.d0; if (d0) q.exec('insert into seen(uid, d0) values(?, ?) on conflict(uid) do update set d0 = min(d0, excluded.d0)', user, d0); return { ok: 1 }; }
  // Guests linked to this user (account withdrawal clears what they left in the other instances).
  evGuests(user) { this.evInit(); return this.ctx.storage.sql.exec('select guest from alias where user = ?', String(user || '')).toArray().map(r => String(r.guest)); }
  // Invite checks: the account with its link group (a guest, the user it was linked to, that user's other guests), and whether any of them was
  // first seen (folded into `seen`) on a day before `day` (the caller passes today minus INVITE.newDays).
  evGroup(id, day) { this.evInit(); const q = this.ctx.storage.sql, u = String(id || ''), ids = new Set([u]);
    const user = u.startsWith('user:') ? u : String(q.exec('select user from alias where guest = ?', u).toArray()[0]?.user || '');
    if (user) { ids.add(user); for (const r of q.exec('select guest from alias where user = ?', user).toArray()) ids.add(String(r.guest)); }
    const list = [...ids]; return { ids: list, old: !!q.exec('select 1 from seen where uid in (' + list.map(() => '?').join(',') + ') and d0 < ? limit 1', ...list, String(day || '')).toArray()[0] }; }
  // One day's rows (ids lo..hi) -> summary. A session is a tab (sid) and belongs to the last account it reported; a visitor is an account.
  // funnel = [landing, enter, first coin, claim] over visitors plus account-less sessions; funnel_new = the same over accounts first seen that day.
  evSum(day, lo, hi) { const q = this.ctx.storage.sql, S = new Map(), events = {};
    for (const r of q.exec('select t, sid, uid, k, p from evt where id >= ? and id < ?', lo, hi).toArray()) { const k = String(r.k); events[k] = (events[k] || 0) + 1; if (!r.sid) continue;
      let s = S.get(r.sid); if (!s) S.set(r.sid, s = { uid: '', t0: Number(r.t), t1: 0, dur: 0, f: 0, g: 0, share: 0, claim: 0, focus: 0 }); if (r.uid) s.uid = String(r.uid); s.t1 = Number(r.t); s.f |= EV_STEP[k] || 0; s.g |= EV_GROW[k] || 0;
      if (k === 'share_send') s.share = 1; else if (k === 'board_claim') s.claim = 1; else if (k === 'focus_enter') s.focus = 1;
      if (k === 'session_end') { try { s.dur = Math.max(s.dur, Math.min(86400, Number(JSON.parse(r.p).dur) || 0)); } catch { } } }
    const who = new Map(), whoG = new Map(), al = new Map(), lens = [], fAll = [0, 0, 0, 0], fNew = [0, 0, 0, 0], grow = [0, 0, 0, 0, 0, 0], fresh = [], back = [], shareIds = new Set(), claimIds = new Set(), focusIds = new Set(); let anon = 0;
    const step = (f, to) => { for (let i = 0; i < 4; i++) if (f & (1 << i)) to[i]++; };
    const stepG = (g) => { for (let i = 0; i < 6; i++) if (g & (1 << i)) grow[i]++; };
    for (const s of S.values()) { lens.push(Math.round(s.dur || (s.t1 - s.t0) / 1000)); let id = s.uid;
      if (id.startsWith('guest:')) { if (!al.has(id)) al.set(id, String(q.exec('select user from alias where guest = ?', id).toArray()[0]?.user || id)); id = al.get(id); }
      if (id) { who.set(id, (who.get(id) || 0) | s.f); whoG.set(id, (whoG.get(id) || 0) | s.g); if (s.share) shareIds.add(id); if (s.claim) claimIds.add(id); if (s.focus) focusIds.add(id); } else { anon++; step(s.f, fAll); stepG(s.g); } }
    for (const g of whoG.values()) stepG(g); // accounts (guests folded into their user) count once a day; account-less sessions count one each
    let focus_new = 0;
    for (const [id, f] of who) { step(f, fAll); const d0 = q.exec('select d0 from seen where uid = ?', id).toArray()[0]?.d0;
      if (!d0 || d0 >= day) { fresh.push(id); step(f, fNew); if (focusIds.has(id)) focus_new++; } else back.push(Math.round((Date.parse(day) - Date.parse(d0)) / 864e5)); }
    lens.sort((a, b) => a - b); const len_avg = lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 0, len_med = lens.length ? lens[lens.length >> 1] : 0;
    return { fresh, back, sum: { visitors: who.size, new: fresh.length, returning: back.length, anon, sessions: S.size, len_avg, len_med, funnel: fAll, funnel_new: fNew, grow, events, share_accounts: shareIds.size, claim_accounts: claimIds.size, focus_new } }; }
  evFold(today) { const q = this.ctx.storage.sql;
    for (const m of q.exec('select day, id0 from mark where day < ? and day not in (select day from daily) order by day', today).toArray()) this.ctx.storage.transactionSync(() => {
      const hi = q.exec('select min(id0) hi from mark where day > ?', m.day).one().hi ?? Number.MAX_SAFE_INTEGER, { fresh, back, sum } = this.evSum(String(m.day), m.id0, hi);
      for (const id of fresh) q.exec('insert or ignore into seen(uid, d0) values(?, ?)', id, m.day);
      for (const off of back) if (EV_RET.includes(off)) q.exec('insert into ret(d0, off, n) values(?, ?, 1) on conflict(d0, off) do update set n = n + 1', dayShift(m.day, -off), off);
      q.exec('insert into daily(day, j) values(?, ?)', m.day, JSON.stringify(sum)); });
    const cut = q.exec('select min(id0) lo from mark where day >= ?', dayShift(today, -EV_KEEP)).one().lo; if (cut) q.exec('delete from evt where id < ?', cut); }
  // Newest first, today computed live. ret[n] = how many of that day's new accounts came back n days later, null until that day is over.
  evStats(today, n) { this.evInit(); this.evFold(today); const q = this.ctx.storage.sql, out = [];
    const m = q.exec('select id0 from mark where day = ?', today).toArray()[0]; if (m) out.push({ day: today, ...this.evSum(today, m.id0, Number.MAX_SAFE_INTEGER).sum });
    for (const r of q.exec('select day, j from daily where day >= ? and day < ? order by day desc', dayShift(today, 1 - n), today).toArray()) out.push({ day: String(r.day), ...JSON.parse(r.j) });
    for (const d of out) { d.ret = {}; for (const off of EV_RET) d.ret[off] = dayShift(d.day, off) < today ? Number(q.exec('select n from ret where d0 = ? and off = ?', d.day, off).toArray()[0]?.n) || 0 : null; }
    return out; }
  draw(bucket) {
    this.ctx.storage.sql.exec('create table if not exists lot(bucket integer primary key, win integer)');
    const hit = this.ctx.storage.sql.exec('select win from lot where bucket = ?', bucket).toArray()[0];
    if (hit) return Number(hit.win);
    const win = (crypto.getRandomValues(new Uint8Array(1))[0] % 15) + 1;
    this.ctx.storage.sql.exec('insert into lot(bucket, win) values(?, ?) on conflict(bucket) do nothing', bucket, win);
    const row = this.ctx.storage.sql.exec('select win from lot where bucket = ?', bucket).one();
    return Number(row.win);
  }
  touch(week, uid) {
    this.ctx.storage.sql.exec('create table if not exists touch(week text, uid text, primary key(week, uid))');
    this.ctx.storage.sql.exec('insert or ignore into touch(week, uid) values(?, ?)', String(week || ''), String(uid || '').slice(0, 80));
  }
  sipGet(hash, day) { this.acInit(); return agGet(this.ctx.storage.sql, String(hash || '').slice(0, 16), 'sip', String(day || '')); }
  sipAdd(hash, day) { this.acInit(); const q = this.ctx.storage.sql, id = String(hash || '').slice(0, 16), d = String(day || ''); agPut(q, id, 'sip', d, agGet(q, id, 'sip', d) + 1); return agGet(q, id, 'sip', d); }
  // Check and count in one call (a DO runs one call at a time), so parallel starter claims from one IP cannot pass the cap.
  sipTake(hash, day, cap) { this.acInit(); const q = this.ctx.storage.sql, id = String(hash || '').slice(0, 16), d = String(day || ''), n = agGet(q, id, 'sip', d); if (n >= cap) return false; agPut(q, id, 'sip', d, n + 1); return true; }
  sipGive(hash, day) { this.acInit(); const q = this.ctx.storage.sql, id = String(hash || '').slice(0, 16), d = String(day || ''), n = agGet(q, id, 'sip', d); if (n > 0) agSet(q, id, 'sip', d, n - 1); return Math.max(0, n - 1); }
  // Starter guard for account links (instance 'acct'). stp: how many of a guest's unearned starting coins its links have already moved out of its
  // wallet (0..cap, only grows). Check and count in one call, so two links at once never both see the same starter. -> how much of `moved` is starter.
  stInit() { if (this.stOk) return; this.stOk = 1; const q = this.ctx.storage.sql; q.exec('create table if not exists stp(g text primary key, v integer not null)'); q.exec('create table if not exists gone(h text primary key, at integer not null)'); }
  stTake(guest, moved, cap) { this.stInit(); const q = this.ctx.storage.sql;
    const g = String(guest || '').slice(0, 80), m = Math.floor(Number(moved)), c = Math.floor(Number(cap)); if (!g || !(m > 0) || !(c > 0)) return 0;
    const had = Number(q.exec('select v from stp where g = ?', g).toArray()[0]?.v) || 0, s = Math.min(m, Math.max(0, c - had));
    if (s > 0) q.exec('insert into stp(g, v) values(?, ?) on conflict(g) do update set v = excluded.v', g, had + s); return s; }
  // gone: accounts that withdrew, by a keyed hash of the id (goneKey), kept for good. A withdrawal deletes the wallet row and its link_bonus, so
  // the next link of the same id is paid the link reward again; the mark is how the Worker knows that link is not a first one.
  goneSet(h) { this.stInit(); const k = String(h || '').slice(0, 64); if (!k) return false; this.ctx.storage.sql.exec('insert or ignore into gone(h, at) values(?, ?)', k, Date.now()); return true; }
  // For the link the reward was paid on (see takeBack), in one call. No mark: a real first link, the guest's whole starter is counted as gone with it
  // (even when nothing moved yet, so coins that reach its row later are its earnings). A mark: a later link, part = how much of `moved` is starter.
  stFirst(guest, moved, cap, h) { this.stInit(); const k = String(h || '').slice(0, 64), gone = !!k && !!this.ctx.storage.sql.exec('select 1 from gone where h = ?', k).toArray()[0];
    if (gone) return { gone: true, part: this.stTake(guest, moved, cap) }; this.stTake(guest, cap, cap); return { gone: false, part: 0 }; }
  // Leases (instance 'acct', see sendHold / linkHold), each running out by itself. shl: one coin send (or pledge) at a time per account, -> its
  // `until`, the token sellDone needs, or false while a send or a link of that account is under way. lkl: account links that are moving coins;
  // several may run at once (n), -> the lease's `at`, the token linkDone needs, or false while a send of that account is under way.
  shInit() { if (this.shOk) return; this.shOk = 1; const q = this.ctx.storage.sql; q.exec('create table if not exists shl(uid text primary key, until integer not null)'); q.exec('create table if not exists lkl(uid text primary key, until integer not null, n integer not null, at integer not null)'); }
  shNow(uid) { this.shInit(); const q = this.ctx.storage.sql, now = Date.now(), id = String(uid || '').slice(0, 80); q.exec('delete from shl where until <= ?', now); q.exec('delete from lkl where until <= ?', now);
    return { q, now, id, send: id ? q.exec('select until from shl where uid = ?', id).toArray()[0] : null, link: id ? q.exec('select until, n, at from lkl where uid = ?', id).toArray()[0] : null }; }
  sellTake(uid, ms) { const { q, now, id, send, link } = this.shNow(uid); if (!id || send || link) return false;
    const until = now + Math.min(60000, Math.max(1000, Math.floor(Number(ms)) || 0)); q.exec('insert into shl(uid, until) values(?, ?)', id, until); return until; }
  sellDone(uid, until) { this.shInit(); this.ctx.storage.sql.exec('delete from shl where uid = ? and until = ?', String(uid || '').slice(0, 80), Math.floor(Number(until)) || 0); return true; }
  linkTake(uid, ms) { const { q, now, id, send, link } = this.shNow(uid); if (!id || send) return false; const until = now + Math.min(60000, Math.max(1000, Math.floor(Number(ms)) || 0));
    if (link) { q.exec('update lkl set n = n + 1, until = max(until, ?) where uid = ?', until, id); return Number(link.at); }
    q.exec('insert into lkl(uid, until, n, at) values(?, ?, 1, ?)', id, until, now); return now; }
  linkDone(uid, at) { this.shInit(); const q = this.ctx.storage.sql, id = String(uid || '').slice(0, 80); q.exec('update lkl set n = n - 1 where uid = ? and at = ?', id, Math.floor(Number(at)) || 0); q.exec('delete from lkl where uid = ? and n <= 0', id); return true; }
  // Share bonus (instance 'acct'): one a KST day per key (the account, and the hashed address). Check and take in one call, so parallel claims
  // cannot both pass; promoGive hands the day back when the grant itself failed. Older days go on every take.
  promoInit() { if (this.prOk) return; this.prOk = 1; this.ctx.storage.sql.exec('create table if not exists prm(k text, d text, primary key(k, d))'); }
  promoTake(keys, day) { this.promoInit(); const q = this.ctx.storage.sql, d = String(day || ''), ks = (Array.isArray(keys) ? keys : []).map(k => String(k || '').slice(0, 120)).filter(Boolean).slice(0, 4); if (!d || !ks.length) return false;
    q.exec('delete from prm where d < ?', d); const hit = ks.filter(k => q.exec('select 1 from prm where k = ? and d = ?', k, d).toArray()[0]); if (hit.length) return hit; // -> the keys already used today
    for (const k of ks) q.exec('insert or ignore into prm(k, d) values(?, ?)', k, d); return true; }
  promoGive(keys, day) { this.promoInit(); for (const k of (Array.isArray(keys) ? keys : []).slice(0, 4)) this.ctx.storage.sql.exec('delete from prm where k = ? and d = ?', String(k || '').slice(0, 120), String(day || '')); return true; }
  cardInit() { if (this.ci) return; this.ci = 1; this.ctx.storage.sql.exec('create table if not exists cards(k text primary key, png blob, at integer)'); }
  cardGet(key) { this.cardInit(); const row = this.ctx.storage.sql.exec('select png from cards where k = ?', String(key || '')).toArray()[0]; return row?.png || null; }
  cardPut(key, bytes) { this.cardInit(); const png = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []); if (png.byteLength > 40000) return { ok: false };
    const q = this.ctx.storage.sql, k = String(key || ''); if (!q.exec('select k from cards where k = ?', k).toArray()[0]) { const n = Number(q.exec('select count(*) n from cards').one().n) || 0; if (n >= 61) q.exec('delete from cards where k in (select k from cards order by at asc limit ?)', n - 60); }
    q.exec('insert into cards(k, png, at) values(?, ?, ?) on conflict(k) do update set png = excluded.png, at = excluded.at', k, png, Date.now()); return { ok: true }; }
  // 오늘의 소원 (instance 'wish'). One line per account per KST day (a few spaced edits while it has no hearts); hearts per actor per day and per IP net per
  // wish; reports hide at WISH.reportHide distinct IP nets. wst keeps each settled day's winners (JSON). A winner is marked paid when it is handed out for
  // payment and un-marked only on a clear refusal, so a prize is paid at most once. uid never leaves this object except to settlement, to the
  // Worker's heart push (wHeart's au) and to its snapshot checks (wAuthor), and never reaches an HTTP response.
  wInit() { if (this.wi) return; this.wi = 1; const q = this.ctx.storage.sql;
    q.exec('create table if not exists wsh(id text primary key, day text not null, uid text not null, nick text, txt text, at integer, et integer, ed integer not null default 0, hearts integer not null default 0, rep integer not null default 0, hid integer not null default 0, unique(day, uid))');
    q.exec('create index if not exists wsh_d on wsh(day, hid, hearts)'); q.exec('create table if not exists wht(wid text, uid text, day text, primary key(wid, uid))'); q.exec('create index if not exists wht_u on wht(uid, day)');
    q.exec('create table if not exists wip(day text, wid text, ip text, n integer not null, primary key(day, wid, ip))'); q.exec('create table if not exists wrp(wid text, uid text, ip text, primary key(wid, uid))');
    q.exec('create table if not exists wst(day text primary key, j text not null)'); q.exec('create table if not exists wpi(day text, ip text, n integer not null, primary key(day, ip))'); // fresh wishes per IP net per day
    // An earlier build made wsh without et/ed and wrp without ip; create-if-not-exists keeps that shape, so add the columns (an existing column throws).
    for (const s of ['alter table wsh add column et integer', 'alter table wsh add column ed integer not null default 0', 'alter table wrp add column ip text', 'alter table wsh add column dup integer not null default 0']) { try { q.exec(s); } catch { /* column already exists */ } } }
  wRow(id) { this.wInit(); return this.ctx.storage.sql.exec('select * from wsh where id = ?', String(id || '')).toArray()[0] || null; }
  wPub(r, uid = '', rank = 0) { const o = { id: String(r.id), day: String(r.day), nick: String(r.nick || ''), txt: String(r.txt || ''), hearts: Number(r.hearts) || 0, at: Number(r.at) || 0, mine: !!uid && r.uid === uid }; if (rank) o.rank = rank; if (r.hid) o.hidden = true; return o; }
  wRank(r) { return 1 + (Number(this.ctx.storage.sql.exec('select count(*) n from wsh where day = ? and hid = 0 and (hearts > ? or (hearts = ? and (at < ? or (at = ? and id < ?))))', r.day, r.hearts, r.hearts, r.at, r.at, r.id).one().n) || 0); }
  wTop(day, n) { return rankWishes(this.ctx.storage.sql.exec('select * from wsh where day = ? and hid = 0 order by hearts desc, at asc, id asc limit ?', day, n).toArray()); }
  wNew(day, n) { return this.ctx.storage.sql.exec('select * from wsh where day = ? and hid = 0 order by at desc, id desc limit ?', day, n).toArray(); }
  wUsed(uid, day) { return Number(this.ctx.storage.sql.exec('select count(*) n from wht where uid = ? and day = ?', uid, day).one().n) || 0; }
  wIps(wid) { return Number(this.ctx.storage.sql.exec('select count(distinct ip) n from wip where wid = ?', wid).one().n) || 0; }
  // ip: the hashed IP net; a fresh wish (not an edit) counts against WISH.ipPostsPerDay for it. No ip (direct calls) counts nothing.
  wPost(uid, nick, txt, day, now, ip = '') { this.wInit(); const q = this.ctx.storage.sql, cur = q.exec('select * from wsh where day = ? and uid = ?', day, uid).toArray()[0], t = Math.floor(Number(now) || Date.now());
    if (cur) { if (cur.hid) return { ok: false, error: 'hidden' }; if (Number(cur.hearts) > 0) return { ok: false, error: 'already' }; if (Number(cur.ed) >= WISH.editsPerDay) return { ok: false, error: 'edits' };
      if (t - (Number(cur.et) || Number(cur.at) || 0) < WISH.editGapMs) return { ok: false, error: 'soon' };
      q.exec('update wsh set txt = ?, nick = ?, ed = ed + 1, et = ? where id = ?', txt, nick, t, cur.id); return { ok: true, wish: this.wPub(this.wRow(cur.id), uid), fresh: false }; }
    const ipk = String(ip || '').slice(0, 16); if (ipk && (Number(q.exec('select n from wpi where day = ? and ip = ?', day, ipk).toArray()[0]?.n) || 0) >= WISH.ipPostsPerDay) return { ok: false, error: 'ipposts' };
    const b = crypto.getRandomValues(new Uint8Array(10)); let id = ''; for (const x of b) id += (x % 36).toString(36);
    q.exec('insert into wsh(id, day, uid, nick, txt, at, et) values(?, ?, ?, ?, ?, ?, ?)', id, day, uid, nick, txt, t, t);
    if (ipk) q.exec('insert into wpi(day, ip, n) values(?, ?, 1) on conflict(day, ip) do update set n = n + 1', day, ipk); return { ok: true, wish: this.wPub(this.wRow(id), uid), fresh: true }; }
  wHeart(uid, wid, ip, day) { const q = this.ctx.storage.sql, w = this.wRow(wid);
    if (!w || w.hid) return { ok: false, error: 'gone' }; if (w.day !== day) return { ok: false, error: 'closed' }; if (w.uid === uid) return { ok: false, error: 'own' };
    if (q.exec('select wid from wht where wid = ? and uid = ?', w.id, uid).toArray()[0]) return { ok: false, error: 'dup' };
    const used = this.wUsed(uid, day); if (used >= WISH.heartsPerDay) return { ok: false, error: 'limit' };
    const ipk = String(ip || 'x').slice(0, 16), n = Number(q.exec('select n from wip where day = ? and wid = ? and ip = ?', day, w.id, ipk).toArray()[0]?.n) || 0; if (n >= WISH.ipHeartsPerWish) return { ok: false, error: 'ip' };
    q.exec('insert into wht(wid, uid, day) values(?, ?, ?)', w.id, uid, day); q.exec('insert into wip(day, wid, ip, n) values(?, ?, ?, 1) on conflict(day, wid, ip) do update set n = n + 1', day, w.id, ipk);
    q.exec('update wsh set hearts = hearts + 1 where id = ?', w.id); return { ok: true, hearts: Number(w.hearts) + 1, left: WISH.heartsPerDay - used - 1, au: String(w.uid) }; } // au: the author, for the Worker's push only
  // What settlement picks for a day: the top three by hearts, each with a prize only if prizeFor(rank, hearts, distinct IP nets) gives one.
  wPick(day) { return this.wTop(day, 3).map(r => ({ r, prize: prizeFor(r.rank, r.hearts, this.wIps(r.id)) })).filter(x => x.prize > 0)
    .map(({ r, prize }) => ({ id: String(r.id), uid: String(r.uid), nick: String(r.nick || ''), txt: String(r.txt || ''), hearts: Number(r.hearts) || 0, rank: r.rank, prize, paid: 0, tries: 0, at: 0 })); }
  // Stored winners of a settled day, or (not settled yet) what settlement would pick. Either way only wishes visible now: a later hide drops that winner.
  // Ranks are kept as settled, so a hidden first place leaves no king that day.
  wWin(day) { const row = this.ctx.storage.sql.exec('select j from wst where day = ?', day).toArray()[0]; let list = [];
    if (row) { try { list = JSON.parse(row.j); } catch { list = []; } } else list = this.wPick(day);
    return list.filter(w => { const r = this.wRow(w.id); return r && !r.hid; }); }
  wList(day, uid = '') { this.wInit(); const q = this.ctx.storage.sql, top = this.wTop(day, WISH.topMax), rk = new Map(top.map(r => [r.id, r.rank]));
    const me = uid ? q.exec('select * from wsh where day = ? and uid = ?', day, uid).toArray()[0] : null;
    return { day, count: Number(q.exec('select count(*) n from wsh where day = ? and hid = 0', day).one().n) || 0, top: top.map(r => this.wPub(r, uid, r.rank)), recent: this.wNew(day, WISH.recentMax).map(r => this.wPub(r, uid, rk.get(r.id) || 0)),
      mine: me ? this.wPub(me, uid, me.hid ? 0 : this.wRank(me)) : null, left: uid ? Math.max(0, WISH.heartsPerDay - this.wUsed(uid, day)) : 0,
      given: uid ? q.exec('select wid from wht where uid = ? and day = ?', uid, day).toArray().map(r => String(r.wid)) : [],
      yesterday: this.wWin(dayShift(day, -1)).map(w => ({ id: w.id, rank: w.rank, nick: w.nick, txt: w.txt, hearts: w.hearts, prize: w.prize, mine: !!uid && w.uid === uid })) }; }
  wOne(wid, uid = '') { const r = this.wRow(wid); return r && !r.hid ? this.wPub(r, uid, this.wRank(r)) : null; }
  // The author of a visible wish, for the Worker's snapshot checks only ('' when missing or hidden). Never sent to a client.
  wAuthor(wid) { const r = this.wRow(wid); return r && !r.hid ? String(r.uid) : ''; }
  wBoard(day) { this.wInit(); const n = WISH.boardMax, top = this.wTop(day, n); let out = boardMix(top, this.wNew(day, n), n);
    if (out.length < 6) out = boardMix(out, this.wTop(dayShift(day, -1), n), n);
    return out.map(r => ({ id: String(r.id), nick: String(r.nick || ''), txt: String(r.txt || ''), hearts: Number(r.hearts) || 0 })); }
  wWorld(day) { this.wInit(); const k = this.wWin(dayShift(day, -1)).find(w => w.rank === 1);
    return { board: this.wBoard(day), king: k ? { nick: k.nick, txt: k.txt, hearts: k.hearts } : null, count: Number(this.ctx.storage.sql.exec('select count(*) n from wsh where day = ? and hid = 0', day).one().n) || 0 }; }
  // One report per account per wish; the wish hides when reports come from WISH.reportHide distinct IP nets (fresh guests on one IP count once).
  wReport(uid, wid, ip) { const q = this.ctx.storage.sql, w = this.wRow(wid); if (!w || w.hid) return { ok: false, error: 'gone' }; if (w.uid === uid) return { ok: false, error: 'own' };
    if (q.exec('insert or ignore into wrp(wid, uid, ip) values(?, ?, ?)', w.id, uid, String(ip || 'x').slice(0, 16)).rowsWritten < 1) return { ok: true, hidden: false, dup: true };
    const rep = Number(q.exec('select count(distinct ip) n from wrp where wid = ?', w.id).one().n) || 0, hid = rep >= WISH.reportHide ? 1 : 0;
    q.exec('update wsh set rep = ?, hid = max(hid, ?) where id = ?', rep, hid, w.id); return { ok: true, hidden: !!hid }; }
  // A forgotten wish (withdrawal, uid 'gone:') or a merge duplicate (dup) stays hidden: { ok:false, locked:true } on an unhide.
  wHide(wid, hidden) { this.wInit(); const q = this.ctx.storage.sql, id = String(wid || '');
    if (!hidden && q.exec("select 1 from wsh where id = ? and (dup = 1 or uid like 'gone:%')", id).toArray()[0]) return { ok: false, locked: true };
    return { ok: q.exec('update wsh set hid = ? where id = ?', hidden ? 1 : 0, id).rowsWritten > 0 }; }
  // Operator list of one day, hidden ones included: reports = distinct reporting IP nets, gone = can never be unhidden (withdrawn or merge duplicate).
  // No uid, no IP hash.
  wAdmin(day) { this.wInit(); return this.ctx.storage.sql.exec("select w.id, w.nick, w.txt, w.hearts, w.hid, w.at, (w.dup = 1 or w.uid like 'gone:%') gone, (select count(distinct ip) from wrp r where r.wid = w.id) reports from wsh w where w.day = ? order by w.at desc, w.id desc limit 200", String(day || '')).toArray()
    .map(r => ({ id: String(r.id), nick: String(r.nick || ''), txt: String(r.txt || ''), hearts: Number(r.hearts) || 0, reports: Number(r.reports) || 0, hidden: !!r.hid, gone: !!r.gone, at: Number(r.at) || 0 })); }
  // Stored winner lists (wst) rewritten by f(list) -> list; only changed days are written.
  wStored(f) { const q = this.ctx.storage.sql; for (const r of q.exec('select day, j from wst').toArray()) { let list; try { list = JSON.parse(r.j); } catch { continue; } const j = JSON.stringify(f(list)); if (j !== r.j) q.exec('update wst set j = ? where day = ?', j, r.day); } }
  // Account merge: the guest's wishes, hearts, reports and stored winner entries become the user's. One wish per day per actor: where the user already
  // has that day's wish, the user's stays and the guest's is hidden for good (dup). A heart both gave to one wish, and a heart that would become a
  // heart on one's own wish, is taken back (row gone, that wish's count one lower). Reports both filed on one wish stay as one row.
  wMove(from, to) { this.wInit(); const q = this.ctx.storage.sql, f = String(from || ''), t = String(to || ''); if (!f || !t || f === t) return { ok: false };
    const unheart = (uid, sel, ...a) => { for (const r of q.exec(sel, ...a).toArray()) { q.exec('update wsh set hearts = max(0, hearts - 1) where id = ?', r.wid); q.exec('delete from wht where wid = ? and uid = ?', r.wid, uid); } };
    this.ctx.storage.transactionSync(() => {
      unheart(f, 'select wid from wht where uid = ? and wid in (select wid from wht where uid = ?)', f, t); // both hearted it: the user's heart stays
      q.exec('update or ignore wsh set uid = ? where uid = ?', t, f); q.exec('update wsh set hid = 1, dup = 1 where uid = ?', f);
      q.exec('update or ignore wht set uid = ? where uid = ?', t, f); q.exec('delete from wht where uid = ?', f);
      unheart(t, 'select wid from wht where uid = ? and wid in (select id from wsh where uid = ?)', t, t); // hearts on what is now the user's own wish
      q.exec('update or ignore wrp set uid = ? where uid = ?', t, f); q.exec('delete from wrp where uid = ?', f);
      this.wStored(list => list.map(w => w.uid === f ? { ...w, uid: t } : w)); });
    return { ok: true }; }
  // Account withdrawal: its wishes hidden for good and emptied (no uid, nick or text left, never listed or paid), its hearts taken back, its reports
  // dropped (a wish already hidden by reports stays hidden), its stored winner entries removed.
  wForget(uid) { this.wInit(); const q = this.ctx.storage.sql, u = String(uid || ''); if (!u) return { ok: false };
    this.ctx.storage.transactionSync(() => {
      q.exec("update wsh set uid = 'gone:' || id, nick = '', txt = '', hid = 1 where uid = ?", u);
      q.exec('update wsh set hearts = max(0, hearts - 1) where id in (select wid from wht where uid = ?)', u); q.exec('delete from wht where uid = ?', u);
      const reported = q.exec('select wid from wrp where uid = ?', u).toArray().map(r => String(r.wid)); q.exec('delete from wrp where uid = ?', u);
      for (const wid of reported) q.exec('update wsh set rep = (select count(distinct ip) from wrp where wid = ?) where id = ?', wid, wid);
      this.wStored(list => list.filter(w => w.uid !== u)); });
    return { ok: true }; }
  // Lazy settlement. Every day before `day` that still has rows (within keepDays) and no wst row is snapshotted, so a day nobody visited after is not lost.
  // Then winners not yet handed out (visible now, under 5 attempts, 60 s apart) are returned AND marked paid in the same step: at most once even if the payer dies.
  // max: winners handed out (and marked) in this call; the rest stay unmarked for the next call.
  wSettle(day, now = Date.now(), max = Infinity) { this.wInit(); const q = this.ctx.storage.sql, cut = dayShift(day, -WISH.keepDays);
    if (this.wPr !== day) { this.wPr = day; q.exec('delete from wsh where day < ?', cut); q.exec('delete from wht where day < ?', cut); q.exec('delete from wip where day < ?', cut); q.exec('delete from wst where day < ?', cut); q.exec('delete from wpi where day < ?', cut);
      q.exec('delete from wrp where wid not in (select id from wsh)'); }
    for (const r of q.exec('select distinct day from wsh where day < ? and day >= ? and day not in (select day from wst) order by day', day, cut).toArray()) q.exec('insert or ignore into wst(day, j) values(?, ?)', r.day, JSON.stringify(this.wPick(String(r.day))));
    const due = [];
    for (const r of q.exec('select day, j from wst where day < ? order by day', day).toArray()) { let list = []; try { list = JSON.parse(r.j); } catch { continue; } let ch = 0;
      for (const w of list) { if (due.length >= max) break; if (w.paid || (w.tries || 0) >= 5 || now - (w.at || 0) < 60000) continue; const row = this.wRow(w.id); if (!row || row.hid) continue;
        w.paid = 1; w.tries = (w.tries || 0) + 1; w.at = now; ch = 1; due.push({ day: String(r.day), id: w.id, uid: w.uid, rank: w.rank, prize: w.prize }); }
      if (ch) q.exec('update wst set j = ? where day = ?', JSON.stringify(list), r.day); }
    return due; }
  // Supabase clearly said no (HTTP ok, data.ok === false: no wallet row yet): hand the winner out again later, attempts permitting.
  wUnpay(day, wid) { this.wInit(); const q = this.ctx.storage.sql, r = q.exec('select j from wst where day = ?', day).toArray()[0]; if (!r) return { ok: false };
    let list = []; try { list = JSON.parse(r.j); } catch { return { ok: false }; } const w = list.find(x => x.id === wid); if (!w) return { ok: false };
    w.paid = 0; q.exec('update wst set j = ? where day = ?', JSON.stringify(list), day); return { ok: true }; }
  // 친구 초대 (instance 'inv'). ivc: codes (an account can own several after a merge; its first is the one handed out), ivip: IP nets an account used
  // per KST day (code requests and wish posts), ivs: accounts seen posting a fresh wish (d0 = first day) or tried as an invitee, ivr: rewarded invitees
  // (one row each, ever), ivp: the two payments of each reward, marked paid when handed out and done once Supabase took them, iva: guest→user links
  // from merges, ivq: pairs refused only for the service-wide day cap, waiting for a later day. ivr.wide is the invitee's coarse prefix (IPv6 /48,
  // IPv4 /24, hashed), added to older tables by alter table. Ids and IP hashes never leave the Worker; the summary has counts and times only.
  ivInit() { if (this.ii) return; this.ii = 1; const q = this.ctx.storage.sql;
    q.exec('create table if not exists ivc(code text primary key, uid text not null, d text not null, ip text not null, at integer not null)'); q.exec('create index if not exists ivc_u on ivc(uid, at)');
    q.exec('create table if not exists ivip(uid text, day text, ip text, primary key(uid, day, ip))');
    q.exec("create table if not exists ivs(uid text primary key, d0 text not null default '', tried integer not null default 0)");
    q.exec('create table if not exists ivr(invitee text primary key, inviter text not null, day text not null, at integer not null, ip text not null)'); q.exec('create index if not exists ivr_i on ivr(inviter, day)'); q.exec('create index if not exists ivr_ip on ivr(ip, day)');
    q.exec('create table if not exists ivp(id text primary key, uid text not null, side text not null, amount integer not null, paid integer not null default 0, done integer not null default 0, tries integer not null default 0, at integer not null default 0, dt integer not null default 0)');
    q.exec('create index if not exists ivp_u on ivp(uid, side, done)'); q.exec('create index if not exists ivp_d on ivp(done, paid, at)'); q.exec('create table if not exists iva(guest text primary key, user text not null)');
    try { q.exec("alter table ivr add column wide text not null default ''"); } catch { /* column already exists */ } q.exec('create index if not exists ivr_w on ivr(wide, day)'); q.exec('create index if not exists ivr_d on ivr(day)');
    // ivq.td: the day a pass last held the pair back for a daily limit (it is looked at once per day)
    q.exec("create table if not exists ivq(invitee text primary key, inviter text not null, ip text not null, wide text not null, day text not null, at integer not null, td text not null default '')");
    try { q.exec("alter table ivq add column td text not null default ''"); } catch { /* column already exists */ }
    for (const s of ['create index if not exists ivq_d on ivq(day)', 'create index if not exists ivq_w on ivq(wide, at)', 'create index if not exists ivq_ip on ivq(day, ip)', 'create index if not exists ivq_wd on ivq(day, wide)', 'create index if not exists ivq_i on ivq(day, inviter)']) q.exec(s); }
  // The invitee with every account linked to it by merges seen here (two hops: guest → user → the user's other guests).
  ivGroup(seed) { const q = this.ctx.storage.sql, ids = new Set(seed.map(String).filter(Boolean));
    for (let hop = 0; hop < 2; hop++) for (const x of [...ids]) for (const r of q.exec('select guest, user from iva where guest = ? or user = ?', x, x).toArray()) { ids.add(String(r.guest)); ids.add(String(r.user)); }
    return [...ids]; }
  // inviteFault's count fields for a pair judged on day d.
  ivCaps(inviter, ip, wide, d) { const q = this.ctx.storage.sql, n = (s, ...a) => Number(q.exec(s, ...a).toArray()[0]?.n) || 0;
    return { perDay: n('select count(*) n from ivr where inviter = ? and day = ?', inviter, d), total: n('select count(*) n from ivr where inviter = ?', inviter), ipDay: n('select count(*) n from ivr where ip = ? and day = ?', ip, d),
      ipTotal: n('select count(*) n from ivr where ip = ?', ip), wideDay: wide ? n('select count(*) n from ivr where wide = ? and day = ?', wide, d) : 0, dayAll: n('select count(*) n from ivr where day = ?', d) }; }
  // The reward row and its two payments, written together; the payments wait (pending, at 0) for ivHand. A guest already linked is paid as its user.
  ivPay(u, inviter, ip, wide, d, t) { const q = this.ctx.storage.sql, to = String(q.exec('select user from iva where guest = ?', u).toArray()[0]?.user || '') || u;
    this.ctx.storage.transactionSync(() => { q.exec('insert into ivr(invitee, inviter, day, at, ip, wide) values(?, ?, ?, ?, ?, ?)', u, inviter, d, t, ip, wide);
      for (const [uid, side, amount] of [[inviter, 'inviter', INVITE.inviter], [to, 'invitee', INVITE.invitee]]) q.exec('insert into ivp(id, uid, side, amount, paid, tries, at) values(?, ?, ?, ?, 0, 0, 0)', crypto.randomUUID(), uid, side, amount); }); }
  // Hands out (marks paid, at most once: the Worker pays what this returns) up to n payments that are due: new ones first, then refused ones 60 s
  // after their refusal, INVITE.tries attempts in all. n is the invocation's budget, so one request never pays more than a few.
  ivHand(n, t) { const q = this.ctx.storage.sql, k = Math.max(0, Math.floor(Number(n) || 0)); if (!k) return [];
    const due = q.exec('select id, uid, side, amount from ivp where done = 0 and paid = 0 and tries < ? and at <= ? order by at, rowid limit ?', INVITE.tries, t - INVITE.retryMs, k).toArray().map(r => ({ id: String(r.id), uid: String(r.uid), side: String(r.side), amount: Number(r.amount) || 0 }));
    for (const p of due) q.exec('update ivp set paid = 1, tries = tries + 1, at = ? where id = ?', t, p.id);
    return due; }
  // Waiting pairs from earlier days, served before anything new is accepted on d. Round-robin by coarse prefix: every prefix's earliest pair before
  // anyone's second, then arrival. Each is judged under d's caps (inviter, per-net, coarse prefix, day, self via merges): rewarded through ivPay (its
  // payments wait for ivHand); held back to the next day (td = d) on a daily limit; dropped for good on a permanent one or once older than queueDays.
  // One call looks at passRows pairs at most and rewards `pairs` at most; d's counters are read once per call. ivqDay = d once nothing is left, or d is full.
  ivQueue(d, t, pairs = INVITE.passPairs) { if (!d || this.ivqDay === d) return 0; const q = this.ctx.storage.sql; let out = 0;
    q.exec('delete from ivq where day < ?', dayShift(d, -INVITE.queueDays));
    // round = the prefix's rewards today + the pair's rank within its prefix, so a prefix served earlier today (by this pass, a past call or a live post) waits its turn
    const rows = q.exec('select w.invitee, w.inviter, w.ip, w.wide from (select invitee, inviter, ip, wide, at, row_number() over (partition by wide order by at, invitee) rk from ivq where day < ? and td <> ?) w'
      + ' left join (select wide, count(*) n from ivr where day = ? group by wide) r on r.wide = w.wide order by coalesce(r.n, 0) + w.rk, w.at, w.invitee limit ?', d, d, d, INVITE.passRows).toArray();
    const by = (col) => new Map(q.exec('select ' + col + ' k, count(*) n from ivr where day = ? group by ' + col, d).toArray().map(r => [String(r.k), Number(r.n) || 0]));
    const perDay = by('inviter'), ipDay = by('ip'), wideDay = by('wide'), tot = new Map(), bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    const total = (col, k) => { const key = col + '|' + k; if (!tot.has(key)) tot.set(key, Number(q.exec('select count(*) n from ivr where ' + col + ' = ?', k).one().n) || 0); return tot.get(key); };
    let dayAll = [...perDay.values()].reduce((s, x) => s + x, 0);
    for (const r of rows) {
      const u = String(r.invitee), inviter = String(r.inviter), ip = String(r.ip), wide = String(r.wide);
      const fault = inviteFault({ inviter, invitee: u, group: this.ivGroup([u]), seen: !!q.exec('select 1 from ivr where invitee = ?', u).toArray()[0], ip,
        perDay: perDay.get(inviter) || 0, total: inviter ? total('inviter', inviter) : 0, ipDay: ipDay.get(ip) || 0, ipTotal: total('ip', ip), wideDay: wide ? wideDay.get(wide) || 0 : 0, dayAll });
      if (fault === 'full') { this.ivqDay = d; return out; }
      if (!fault && out >= pairs) return out; // the rest on the next call
      if (inviteWaits(fault)) { q.exec('update ivq set td = ? where invitee = ?', d, u); continue; }
      q.exec('delete from ivq where invitee = ?', u); q.exec('insert into ivs(uid, tried) values(?, 1) on conflict(uid) do update set tried = 1', u);
      if (fault) continue;
      this.ivPay(u, inviter, ip, wide, d, t); out += 1; bump(perDay, inviter); bump(ipDay, ip); bump(wideDay, wide); bump(tot, 'inviter|' + inviter); bump(tot, 'ip|' + ip); dayAll += 1;
    }
    if (!q.exec('select 1 from ivq where day < ? and td <> ? limit 1', d, d).toArray()[0]) this.ivqDay = d;
    return out; }
  // May a pair refused for a daily limit wait? Today's arrivals in the queue: one per IP net, wideDay per coarse prefix, perDay per inviter, and
  // queueMax waiting pairs in all. No: it is refused for good.
  ivAdmit(inviter, ip, wide, d) { const q = this.ctx.storage.sql, n = (s, ...a) => Number(q.exec(s, ...a).toArray()[0]?.n) || 0;
    return n('select count(*) n from ivq where day = ? and ip = ?', d, ip) < INVITE.ipDay && (!wide || n('select count(*) n from ivq where day = ? and wide = ?', d, wide) < INVITE.wideDay)
      && n('select count(*) n from ivq where day = ? and inviter = ?', d, inviter) < INVITE.perDay && n('select count(*) n from ivq') < INVITE.queueMax; }
  ivIp(uid, ip, day) { const q = this.ctx.storage.sql, d = String(day || ''); if (this.ivPr !== d) { this.ivPr = d; q.exec('delete from ivip where day < ?', dayShift(d, -1)); }
    if (uid && ip && d) q.exec('insert or ignore into ivip(uid, day, ip) values(?, ?, ?)', String(uid), d, String(ip).slice(0, 16)); }
  // ip given: the account's net is noted for today, but only once it owns a code (an inviter).
  ivSum(uid, day, recent = false, ip = '') { this.ivInit(); const q = this.ctx.storage.sql, u = String(uid || ''), n = (s, ...a) => Number(q.exec(s, ...a).toArray()[0]?.n) || 0;
    const c = q.exec('select code from ivc where uid = ? order by at asc, code asc limit 1', u).toArray()[0]; if (c && ip) this.ivIp(u, ip, day);
    const o = { code: c ? String(c.code) : '', count: n('select count(*) n from ivr where inviter = ?', u), today: n('select count(*) n from ivr where inviter = ? and day = ?', u, String(day || '')),
      earned: n("select coalesce(sum(amount), 0) n from ivp where uid = ? and side = 'inviter' and done = 1", u), gift: n("select coalesce(sum(amount), 0) n from ivp where uid = ? and side = 'invitee' and done = 1", u) };
    if (recent) o.recent = q.exec("select dt from ivp where uid = ? and side = 'inviter' and done = 1 order by dt desc limit ?", u, INVITE.recentMax).toArray().map(r => Number(r.dt) || 0);
    return o; }
  // The caller's code (made on the first call: random, never derived from the id) and its summary. The net it was asked from counts as the inviter's.
  ivCode(uid, ip, day, now = Date.now()) { this.ivInit(); const q = this.ctx.storage.sql, u = String(uid || ''); if (!u) return null; const ipk = String(ip || '').slice(0, 16);
    if (!q.exec('select code from ivc where uid = ? limit 1', u).toArray()[0]) for (let i = 0; i < 5; i++) if (q.exec('insert or ignore into ivc(code, uid, d, ip, at) values(?, ?, ?, ?, ?)', newCode(), u, String(day || ''), ipk, Math.floor(Number(now) || Date.now())).rowsWritten) break;
    return this.ivSum(u, day, false, ipk); }
  // A wish post. Every post notes the poster's net for today; a fresh one notes the poster's first wish day. A fresh wish with a code is judged once
  // for this invitee (tried, whatever the outcome) after the waiting queue was served; refused only for a daily limit, it waits in ivq instead (when
  // ivAdmit lets it) and is not tried. Counting and writing run in this one synchronous call, so no cap can be overrun. group/old: the 'ev' link group and history the
  // Worker looked up; merges seen here add to it. wide: the hashed coarse prefix of the invitee's address.
  // budget: payments this call may hand out (the invocation's share); pay is what the Worker pays now, more/left say whether anything still waits.
  ivPost({ uid, ip = '', wide = '', day, now = Date.now(), fresh = false, code = '', group = [], old = false, budget = 0 } = {}) { this.ivInit(); const q = this.ctx.storage.sql, u = String(uid || ''), d = String(day || ''), ipk = String(ip || '').slice(0, 16), wk = String(wide || '').slice(0, 16), t = Math.floor(Number(now) || Date.now());
    if (!u || !d) return { pay: [] }; this.ivIp(u, ipk, d);
    if (fresh) q.exec("insert into ivs(uid, d0) values(?, ?) on conflict(uid) do update set d0 = case when d0 = '' then excluded.d0 else d0 end", u, d);
    const c = invCode(code); if (!fresh || !c) return { pay: [] };
    this.ivQueue(d, t); // earlier days' waiting pairs first
    const out = (r) => ({ ...r, pay: this.ivHand(budget, t), ...this.ivLeft(d) });
    const list = this.ivGroup([u, ...(Array.isArray(group) ? group : [])]), inl = list.map(() => '?').join(',');
    const inviter = String(q.exec('select uid from ivc where code = ?', c).toArray()[0]?.uid || '');
    const seen = !!q.exec('select 1 from ivs where uid in (' + inl + ') and tried = 1 union all select 1 from ivr where invitee in (' + inl + ') union all select 1 from ivq where invitee in (' + inl + ') limit 1', ...list, ...list, ...list).toArray()[0];
    const older = !!old || !!q.exec("select 1 from ivs where uid in (" + inl + ") and d0 <> '' and d0 < ? limit 1", ...list, d).toArray()[0];
    const ips = inviter ? q.exec('select ip from ivip where uid = ? and day = ? union select ip from ivc where uid = ?', inviter, d, inviter).toArray().map(r => String(r.ip)).filter(Boolean) : [];
    const fault = inviteFault({ inviter, invitee: u, group: list, seen, old: older, ip: ipk, inviterIps: ips, ...this.ivCaps(inviter, ipk, wk, d) });
    if (inviteWaits(fault) && this.ivAdmit(inviter, ipk, wk, d)) { q.exec('insert or ignore into ivq(invitee, inviter, ip, wide, day, at) values(?, ?, ?, ?, ?, ?)', u, inviter, ipk, wk, d, t); return out({ fault, wait: true }); }
    q.exec('insert into ivs(uid, tried) values(?, 1) on conflict(uid) do update set tried = 1', u);
    if (fault) return out({ fault });
    this.ivPay(u, inviter, ipk, wk, d, t); return out({}); }
  // left: payments not yet handed out that may still be (pending or refused, under INVITE.tries); more: the queue pass is not done for d.
  ivLeft(d) { return { left: Number(this.ctx.storage.sql.exec('select count(*) n from ivp where done = 0 and paid = 0 and tries < ?', INVITE.tries).one().n) || 0, more: !!d && this.ivqDay !== d }; }
  // The lazy pass: the waiting queue for day first (rewards written, payments pending), then up to budget due payments handed out (paid) for the Worker.
  ivDue(now = Date.now(), day = '', budget = INVITE.payMax) { this.ivInit(); const t = Math.floor(Number(now) || Date.now()), d = String(day || ''); this.ivQueue(d, t);
    return { due: this.ivHand(budget, t), ...this.ivLeft(d) }; }
  // Supabase clearly said no (HTTP ok, data.ok === false: no wallet row yet): hand it out again later. A guest that has been linked since (to, from the
  // 'ev' aliases, or a merge seen here) is paid as its user: still one row, so still at most once.
  ivUnpay(id, to = '') { this.ivInit(); const q = this.ctx.storage.sql, r = q.exec('select uid from ivp where id = ? and done = 0', String(id || '')).toArray()[0]; if (!r) return { ok: false };
    const u = String(r.uid), t = String(to || '').startsWith('user:') ? String(to) : String(q.exec('select user from iva where guest = ?', u).toArray()[0]?.user || '') || u;
    return { ok: q.exec('update ivp set paid = 0, uid = ? where id = ? and done = 0', t, String(id)).rowsWritten > 0 }; }
  ivDone(id, now = Date.now()) { this.ivInit(); this.ctx.storage.sql.exec('update ivp set done = 1, dt = ? where id = ?', Math.floor(Number(now) || Date.now()), String(id || '')); return { ok: true }; }
  // Account merge: the guest's codes, nets, rewards (both sides) and pending payments become the user's; the link is kept for the self-invite check.
  ivMove(from, to) { this.ivInit(); const q = this.ctx.storage.sql, f = String(from || ''), t = String(to || ''); if (!f || !t || f === t) return { ok: false };
    this.ctx.storage.transactionSync(() => { q.exec('insert or replace into iva(guest, user) values(?, ?)', f, t); q.exec('update ivc set uid = ? where uid = ?', t, f);
      q.exec('update or ignore ivip set uid = ? where uid = ?', t, f); q.exec('delete from ivip where uid = ?', f);
      const g = q.exec('select d0, tried from ivs where uid = ?', f).toArray()[0];
      if (g) { q.exec("insert into ivs(uid, d0, tried) values(?, ?, ?) on conflict(uid) do update set d0 = case when d0 = '' or (excluded.d0 <> '' and excluded.d0 < d0) then excluded.d0 else d0 end, tried = max(tried, excluded.tried)", t, String(g.d0 || ''), Number(g.tried) || 0); q.exec('delete from ivs where uid = ?', f); }
      q.exec('update ivr set inviter = ? where inviter = ?', t, f); q.exec('update or ignore ivr set invitee = ? where invitee = ?', t, f); q.exec('update ivp set uid = ? where uid = ?', t, f);
      q.exec('update ivq set inviter = ? where inviter = ?', t, f); q.exec('update or ignore ivq set invitee = ? where invitee = ?', t, f); q.exec('delete from ivq where invitee = ?', f); });
    return { ok: true }; }
  // Account withdrawal: its codes, nets, links and payments go; reward rows lose the id but stay, so the caps of the others still count them.
  ivForget(uid) { this.ivInit(); const q = this.ctx.storage.sql, u = String(uid || ''); if (!u) return { ok: false };
    this.ctx.storage.transactionSync(() => { for (const s of ['delete from ivc where uid = ?', 'delete from ivip where uid = ?', 'delete from ivs where uid = ?', 'delete from ivp where uid = ?']) q.exec(s, u);
      q.exec('delete from iva where guest = ? or user = ?', u, u); q.exec('delete from ivq where invitee = ? or inviter = ?', u, u); q.exec("update ivr set inviter = 'gone:' || rowid where inviter = ?", u); q.exec("update ivr set invitee = 'gone:' || rowid where invitee = ?", u); });
    return { ok: true }; }
  // 주간 리그 (instance 'lg'). lg: coins an account really spent per KST ISO week (at = when the row last grew, the tie-break). lgm: once-a-week
  // markers of the lazy tribe settlement (st 1 done, 0 claimed at `at`). uid never leaves this object except as mine (true/false).
  // lgs: what a refund needs to find the week it belongs to. Key = a slot id (its holder as tallied, the week its claim was tallied in or '' when the league never counted it, the last bid), 'r:<review
  // id>' (an S-tier bid held for review) or 'p:<photo id>' (a pending photo's fee).
  lgInit() { if (this.li) return; this.li = 1; const q = this.ctx.storage.sql;
    q.exec("create table if not exists lg(w text, uid text, nick text not null default '', spent integer not null default 0, at integer not null default 0, primary key(w, uid))");
    q.exec('create table if not exists lgm(k text primary key, st integer not null, at integer not null)');
    q.exec('create table if not exists lgs(k text primary key, uid text not null, w text not null, bid integer not null default 0)'); }
  lgPrune(wk, now, cut) { if (!cut || this.lgPr === wk) return; this.lgPr = wk; const q = this.ctx.storage.sql;
    q.exec('delete from lg where w < ?', String(cut)); q.exec("delete from lgs where w <> '' and w < ?", String(cut)); q.exec('delete from lgm where at < ?', now - 60 * 864e5); }
  // Adds d > 0 to the week's row. nick '' (or one the Worker refused) keeps the stored nick; a new row without one is 네온손님.
  lgPlus(wk, u, nick, d, now) { const n = String(nick || '');
    this.ctx.storage.sql.exec('insert into lg(w, uid, nick, spent, at) values(?, ?, ?, ?, ?) on conflict(w, uid) do update set spent = spent + excluded.spent, at = excluded.at, nick = case when ? <> \'\' then ? else nick end', wk, u, n || '네온손님', d, now, n, n); }
  // A refund lowers the row of the week it was tallied in, never below 0; a week already pruned (or a spend never tallied) loses nothing.
  lgMinus(wk, u, d) { this.ctx.storage.sql.exec('update lg set spent = max(0, spent - ?) where w = ? and uid = ?', d, String(wk || ''), String(u || '')); }
  // delta > 0 adds to this week (key: also remember it for a later refund); delta < 0 lowers this week's row (direct calls and tests only).
  lgAdd(w, uid, nick, delta, now = Date.now(), cut = '', key = '') { this.lgInit(); const u = String(uid || ''), d = Math.trunc(Number(delta) || 0), wk = String(w || '');
    this.lgPrune(wk, now, cut); if (!u || !wk || !d) return { ok: false };
    if (d > 0) { this.lgPlus(wk, u, nick, d, now); if (key) this.ctx.storage.sql.exec('insert or replace into lgs(k, uid, w, bid) values(?, ?, ?, ?)', String(key), u, wk, d); }
    else this.lgMinus(wk, u, -d);
    return { ok: true }; }
  // One board claim, in one call so the order is fixed: first the previous holder's refund (from the week its bid was tallied, found in the slot record),
  // then the new holder. claim: the bid. edit: only what goes past the recorded bid of this holder (parallel edits are serialised here, so one raise
  // counts once; a board with no record, held since before the league, counts its first raise as nothing). starter, tribe: nothing, but the record
  // follows the board. Only guest:/user: holders are tallied.
  lgBoard(slot, w, now, cut, holder, nick, mode, bid, prev = '', refund = 0) { this.lgInit(); const q = this.ctx.storage.sql, s = String(slot || ''), wk = String(w || ''), h = String(holder || ''), b = Math.max(0, Math.floor(Number(bid) || 0));
    if (!s || !wk || !h) return { ok: false }; this.lgPrune(wk, now, cut);
    this.ctx.storage.transactionSync(() => {
      const rec = q.exec('select uid, w, bid from lgs where k = ?', s).toArray()[0] || null, back = Math.floor(Number(refund) || 0);
      if (back > 0 && prev && rec && rec.uid === String(prev)) this.lgMinus(rec.w, rec.uid, back);
      const player = /^(guest|user):/.test(h);
      if (mode === 'edit') { const known = rec && rec.uid === h ? Number(rec.bid) : null, add = known == null ? 0 : Math.max(0, b - known);
        if (add > 0 && player) this.lgPlus(wk, h, nick, add, now);
        // The record keeps the week its bid was tallied in: a raise does not move it (the refund is 80% of the whole bid), and a board with no record
        // gets w = '' so a refund of a bid the league never counted takes nothing.
        q.exec('insert or replace into lgs(k, uid, w, bid) values(?, ?, ?, ?)', s, h, known != null ? String(rec.w) : '', Math.max(b, known ?? 0)); }
      else { if (mode === 'claim' && b > 0 && player) this.lgPlus(wk, h, nick, b, now); q.exec('insert or replace into lgs(k, uid, w, bid) values(?, ?, ?, ?)', s, h, wk, b); } });
    return { ok: true }; }
  // A refund of something remembered under key (a rejected review bid, a rejected photo fee): from the week it was tallied, once; the record goes.
  lgBack(key, uid, amount) { this.lgInit(); const q = this.ctx.storage.sql, k = String(key || ''), rec = q.exec('select uid, w from lgs where k = ?', k).toArray()[0], d = Math.floor(Number(amount) || 0);
    if (!rec || rec.uid !== String(uid || '') || d <= 0) return { ok: false }; this.lgMinus(rec.w, rec.uid, d); q.exec('delete from lgs where k = ?', k); return { ok: true }; }
  // An approved review: the board's previous holder is refunded from its slot record, then the slot remembers the reviewed bid in its tallied week.
  lgApprove(id, slot, prev = '', refund = 0) { this.lgInit(); const q = this.ctx.storage.sql, k = 'r:' + String(id), s = String(slot || '');
    this.ctx.storage.transactionSync(() => {
      const rec = q.exec('select uid, w from lgs where k = ?', s).toArray()[0], back = Math.floor(Number(refund) || 0);
      if (back > 0 && prev && rec && rec.uid === String(prev)) this.lgMinus(rec.w, rec.uid, back);
      const r = q.exec('select uid, w, bid from lgs where k = ?', k).toArray()[0];
      if (r && s) q.exec('insert or replace into lgs(k, uid, w, bid) values(?, ?, ?, ?)', s, r.uid, r.w, r.bid); else if (s) q.exec('delete from lgs where k = ?', s);
      q.exec('delete from lgs where k = ?', k); });
    return { ok: true }; }
  lgRows(w) { this.lgInit(); return this.ctx.storage.sql.exec('select uid, nick, spent, at from lg where w = ? and spent > 0', String(w || '')).toArray(); }
  lgTop(w, uid = '', n = LEAGUE.top) { return leagueBoard(this.lgRows(w), String(uid || ''), n); }
  lgWorld(w, n = LEAGUE.world) { return leagueBoard(this.lgRows(w), '', n).top.map(r => ({ nick: r.nick, spent: r.spent })); }
  lgNick(w, uid, nick) { this.lgInit(); this.ctx.storage.sql.exec('update lg set nick = ? where w = ? and uid = ?', String(nick || ''), String(w || ''), String(uid || '')); return { ok: true }; }
  // Account merge: the guest's weekly rows are summed into the user's (the user's nick stays when it has one).
  lgMove(from, to) { this.lgInit(); const q = this.ctx.storage.sql, f = String(from || ''), t = String(to || ''); if (!f || !t || f === t) return { ok: false };
    this.ctx.storage.transactionSync(() => {
      q.exec("insert into lg(w, uid, nick, spent, at) select w, ?, nick, spent, at from lg where uid = ? on conflict(w, uid) do update set spent = spent + excluded.spent, at = max(at, excluded.at), nick = case when nick <> '' then nick else excluded.nick end", t, f);
      q.exec('delete from lg where uid = ?', f); q.exec('update lgs set uid = ? where uid = ?', t, f); });
    return { ok: true }; }
  lgForget(uid) { this.lgInit(); const u = String(uid || ''); this.ctx.storage.sql.exec('delete from lg where uid = ?', u); this.ctx.storage.sql.exec('delete from lgs where uid = ?', u); return { ok: true }; }
  // A once-a-week job: 'done' (finished before), 'busy' (another caller claimed it under 2 minutes ago) or 'mine' (claimed now; lgDone when it worked).
  lgOnce(k, now = Date.now()) { this.lgInit(); const q = this.ctx.storage.sql, r = q.exec('select st, at from lgm where k = ?', String(k)).toArray()[0];
    if (r && Number(r.st) === 1) return 'done'; if (r && now - Number(r.at) < 120000) return 'busy';
    q.exec('insert into lgm(k, st, at) values(?, 0, ?) on conflict(k) do update set st = 0, at = excluded.at', String(k), now); return 'mine'; }
  lgDone(k, now = Date.now()) { this.lgInit(); this.ctx.storage.sql.exec('insert into lgm(k, st, at) values(?, 1, ?) on conflict(k) do update set st = 1, at = excluded.at', String(k), now); return { ok: true }; }
  lgFree(k) { this.lgInit(); this.ctx.storage.sql.exec('delete from lgm where k = ? and st = 0', String(k)); return { ok: true }; }
}

export class Room extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.env = env; budget(env); this.S = null; this.msgs = 0; this.conns = 0; this.lastRep = 0; this.lastScan = 0; this.lvl = 0; this.hist = null; this.room = null; this.out = new Map();
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong')); }
  socks() { if (!this.S) { this.S = new Map(); for (const w of this.ctx.getWebSockets()) { const a = w.deserializeAttachment(); if (a) { a.fl = 0; if (a.m) a.m.fl = 0; this.S.set(w, a); } } } return this.S; }
  save(w, a) { try { w.serializeAttachment(a); } catch { } }
  adm() { let n = 0; for (const a of this.socks().values()) if (a.q) n++; return n; }
  waiters() { return [...this.socks()].filter(([, a]) => !a.q).sort((x, y) => x[1].t - y[1].t); }
  tx(w, o) { try { w.send(typeof o === 'string' ? o : JSON.stringify(o)); } catch { } }
  bc(o, skip) { const s = JSON.stringify(o); for (const [w, a] of this.socks()) if (a.q && w !== skip) this.tx(w, s); }
  // event ring (world updates, reactions) kept in DO memory and replayed to a joining socket
  async loadHist(room) { if (this.hist || !room) return this.hist || []; this.room = room; this.hist = []; return this.hist; }
  pushEv(ev) { if (!this.hist) this.hist = []; this.hist.push(ev); if (this.hist.length > HIST_N) this.hist.shift(); }
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === '/flush') return this.httpFlush(req);
    if (u.pathname === '/score') return this.httpScore(req);
    if (u.pathname === '/profile') return this.httpProfile(req);
    if (u.pathname === '/world') return this.httpWorld(req);
    if (u.pathname === '/sync') return this.httpSync(req);
    if (u.pathname === '/air') return this.httpAir(req);
    if (u.pathname === '/wish') return this.httpWish(req);
    if (u.pathname === '/stk') return this.httpSticker(req);
    if (u.pathname === '/chr') return this.httpCheer(req);
    if (u.pathname === '/fever') return this.httpFever(req);
    const topic = u.searchParams.get('topic') || '', k = req.headers.get('x-uid') || ''; if (topic) this.topicName = topic; if (!k) return new Response('auth', { status: 401 });
    if (this.lvl >= 2) return new Response('down', { status: 503 });
    const sf = await this.sit(k, topic); if (sf < 0) return new Response('moved', { status: 429 });
    const room = (u.searchParams.get('room') || '').slice(0, 48), v2 = req.headers.get('x-v2') === '1';
    const prof = await this.loadProf(k);
    const [c, s] = Object.values(new WebSocketPair()); this.ctx.acceptWebSocket(s);
    const a = { k, an: req.headers.get('x-anon') === '1', m: null, q: false, t: Date.now() + Math.random(), ls: Date.now(), lob: /lobby$/.test(topic), v2, fl: 0, sf, prof };
    this.socks().set(s, a); this.conns++;
    if (v2 && room && /^[\w:-]{1,48}$/.test(room) && !a.lob && /^chapel(qa)?:/.test(topic)) await this.loadHist(room);
    if (a.lob || this.adm() < CAP) this.admit(s, a); else { this.save(s, a); this.waitMsgs(); }
    this.arm(); this.meter(); return new Response(null, { status: 101, webSocket: c, headers: { 'Sec-WebSocket-Protocol': v2 ? 'masil2' : 'masil' } });
  }
  admit(w, a) { a.q = true; a.fl = 0; if (a.m) a.m.fl = 0; this.save(w, a); const st = {}; for (const b of this.socks().values()) if (b.q && b.m) { b.fl = 0; b.m.fl = 0; st[b.k] = b.m; }
    const o = { t: 'ok', s: st, cap: a.lob ? 0 : CAP, live: this.adm(), lean: this.lvl >= 1 }; if (a.prof) { o.av = a.prof.av; o.equip = a.prof.equip; } try { const fg = this.gateAt('fg|' + a.k), fv = this.gateAt('fv|' + a.k), rv = this.gateAt('rev|' + a.k); if (fg) o.fg = fg; if (fv > Date.now()) o.fv = fv; if (rv > Date.now()) o.rv = rv; const lot = agGet(this.ctx.storage.sql, a.k, 'lot:' + Math.floor(Date.now() / 300000), ''); if (lot >= 1 && lot <= 15) o.lot = lot; } catch { /* the gauge follows the next fare */ } const ghosts = this.ghostJoin(); if (a.v2 && this.hist) o.h = ghosts.length ? this.hist.concat(ghosts) : this.hist; else if (ghosts.length) o.h = ghosts; if (this.airShow && this.airShow.until > Date.now()) o.air = this.airShow; o.stk = this.stkAll(); o.chr = this.chrAll(); o.ball = this.ballFrame(); this.tx(w, o); }
  waitMsgs() { const ws = this.waiters(), live = this.adm(); ws.forEach(([w], i) => this.tx(w, { t: 'wait', pos: i + 1, live, cap: CAP })); }
  promote() { let n = this.adm(); for (const [w, a] of this.waiters()) { if (n >= CAP) break; this.admit(w, a); n++; } this.waitMsgs(); }
  // One room per account (see Meter 'acct'). Returns the cooldown floor for this account's sockets here: 0, or the time it last moved in from another room,
  // which every gap is counted from so that a move never resets a cooldown. -1 = no seat (moving too often, or a newer move already took it away).
  acct() { return this.env.METER.get(this.env.METER.idFromName('acct')); }
  async sit(uid, topic) { this.tapDb(); const q = this.ctx.storage.sql, day = kstDay(); let s = q.exec('select fl from seat where uid = ?', uid).toArray()[0];
    if (!s) { this.conns++; let r = null; try { r = await this.acct().seat(uid, topic, day); } catch { }
      if (!r || r.no || r.n <= (this.out.get(uid) || 0)) return -1;
      this.out.delete(uid); for (const [k, d, v] of r.gates) agPut(q, uid, k, d, v); agPut(q, uid, 'visit', day, 1);
      s = { fl: r.fl }; q.exec('insert or replace into seat(uid, fl) values(?, ?)', uid, r.fl); }
    else if (!agGet(q, uid, 'visit', day)) { agPut(q, uid, 'visit', day, 1); this.conns++; this.acct().visit(uid, day).catch(() => { }); }
    return Number(s.fl) || 0; }
  // Called by the registry when the account takes a seat in another room (seat number n): close its sockets here, settle its pending coins, hand back its gates.
  async evict(uid, n) { this.tapDb(); this.conns++; const q = this.ctx.storage.sql; this.out.set(uid, n); q.exec('delete from seat where uid = ?', uid);
    for (const [w, a] of [...this.socks()]) if (a.k === uid) { this.tx(w, { t: 'moved' }); try { w.close(4003, 'moved'); } catch { } this.gone(w); }
    if (q.exec('select 1 from coin where uid = ?', uid).toArray().length) { try { await this.flush(uid); } catch { } }
    return agAll(q, uid); }
  // alarm: fast (5s) while someone waits or taps are pending, otherwise a slow 60s stale scan while any socket is connected
  async arm() { const fast = this.waiters().length || this.tapN, any = this.socks().size; if (!fast && !any) return; const want = Date.now() + (fast ? SCAN : IDLE_SCAN), cur = await this.ctx.storage.getAlarm();
    if (!cur || (fast && cur > want)) await this.ctx.storage.setAlarm(want); }
  ballFrame(now = Date.now()) {
    const open = ballOpen(now);
    return { t: 'BALL', open, until: nextBallUntil(now, open) };
  }
  // One open and one close per KST day. ag v: last state in bits 1–2, open-sent 4, close-sent 8.
  noteBall() {
    const now = Date.now();
    const open = ballOpen(now);
    const day = kstDay(now);
    const q = this.ctx.storage.sql;
    const cur = open ? 2 : 1;
    const prev = agGet(q, 'room', 'ball', day);
    const last = prev & 3;
    let next = (prev & ~3) | cur;
    if (last && last !== cur) {
      if (open && !(prev & 4)) { this.bc(this.ballFrame(now)); next |= 4; }
      if (!open && !(prev & 8)) { this.bc(this.ballFrame(now)); next |= 8; }
    }
    if (next !== prev) agSet(q, 'room', 'ball', day, next);
  }
  async alarm() { this.tapDb(); this.scan(true); this.meter(true); await this.drawDue(); if (this.tapN && Date.now() - (this.tapAt || 0) >= FLUSH_MS - 1000) await this.flush(); if (this.adDirty && Date.now() - (this.adFlushAt || 0) > 30000) await this.flushAds(); if (!this.tapN && Date.now() - (this.ibAt || 0) > 30000 && this.ibWait()) await this.flushInbox(); try { await this.flushTribeScores(); } catch { /* scores retry on the next alarm */ }
    if (this.socks().size) { try { this.noteBall(); } catch { /* the next scan retries the ball */ } }
    if (this.waiters().length || this.tapN) await this.ctx.storage.setAlarm(Date.now() + (this.waiters().length ? SCAN : FLUSH_MS)); else if (this.socks().size) await this.ctx.storage.setAlarm(Date.now() + IDLE_SCAN); }
  // Bungeo-ppang coins: 2s per actor, ≤15 per mine, summed in DO SQLite (survives hibernation) with tapN in memory.
  // alarm()/arm() still key off tapN: flush on FLUSH_N accepted mines or the FLUSH_MS alarm.
  tapDb() { if (this._tdb) return; const q = this.ctx.storage.sql;
    q.exec("create table if not exists coin(uid text primary key, nick text, delta integer not null, n integer not null, at integer not null, reason text not null default 'mine')");
    try { q.exec("alter table coin add column reason text not null default 'mine'"); } catch { /* column already exists */ }
    q.exec('create table if not exists rate(uid text primary key, at integer not null)');
    q.exec('create table if not exists gate(k text primary key, at integer not null)');
    q.exec('create table if not exists adstat(slot text primary key, views integer not null, clicks integer not null, dirty integer not null)');
    q.exec('create table if not exists adq(slot text not null, b integer not null, v integer not null default 0, c integer not null default 0, h integer not null default 0, primary key(slot, b))');
    q.exec('create table if not exists adw(slot text not null, d text not null, uid text not null, b integer not null, primary key(slot, d, uid))');
    if (q.exec('select 1 from adq union all select 1 from adw limit 1').toArray().length) this.adDirty = 1; // tallies from before hibernation still go out
    q.exec('create table if not exists seat(uid text primary key, fl integer not null)'); q.exec(AG);
    q.exec('create table if not exists sess(id text primary key, uid text not null, kind text not null, t0 integer not null, x integer not null, z integer not null)');
    q.exec('create table if not exists stk(slot text primary key, g text not null)');
    q.exec('create table if not exists chr(slot text primary key, n integer not null)');
    q.exec('create table if not exists brd(slot text primary key, b text not null, at integer not null)');
    q.exec('create table if not exists ibq(id integer primary key autoincrement, it text not null, at integer not null)');
    this._tdb = 1; this.syncPending(); this.moveHello(); }
  // One-time: hello gates written before the account registry existed move from `gate` to `ag` and are reported to the registry. '!ag1' marks the job done.
  moveHello() { if (this.gateAt('!ag1')) return; const q = this.ctx.storage.sql, old = q.exec("select k from gate where k like '%|hello' limit 2000").toArray().map(r => String(r.k));
    if (!old.length) { q.exec("delete from gate where k like '%|quest|%'"); this.gateSet('!ag1', 1); return; }
    const rows = old.map(k => [k.slice(0, -6), 'hello', '', 1]); for (const r of rows) agPut(q, ...r);
    try { this.acct().gatePut(rows).then(() => { for (const k of old) q.exec('delete from gate where k = ?', k); }).catch(() => { }); } catch { } }
  syncPending() { const q = this.ctx.storage.sql; this.tapN = Number(q.exec('select coalesce(sum(n),0) s from coin').one().s) || 0; const age = q.exec('select min(at) a from coin').one().a; if (age) this.tapAt = Number(age); }
  addMine(a, amount, nick) { if (!a?.k || this.lvl >= 2) return 0; this.tapDb(); const now = Date.now();
    if (amount !== 1) return 0;
    if (now - (a.sf || 0) < MINE_GAP) return -1; // just moved in from another room: the gap counts from the move
    const q = this.ctx.storage.sql;
    // sidewalk coins: 12 per 2s, then the server table. Client amounts other than 1 are refused. -1 = wait, 0 = no pay.
    const key = a.k + '#c';
    const prev = q.exec('select at from rate where uid = ?', key).toArray()[0];
    const raw = prev ? Number(prev.at) : 0;
    let start = Math.floor(raw / 100), n = raw % 100;
    if (!start || now - start >= 2000) { start = now; n = 0; }
    if (n >= 12) return -1;
    q.exec('insert into rate(uid, at) values(?, ?) on conflict(uid) do update set at = excluded.at', key, start * 100 + n + 1);
    const gained = this.repeatPay(a, 1, nick, 'mine', 0, 30);
    if (gained > 0 && Math.random() < 0.02) { q.exec('delete from rate where at < ?', now - 86400000); q.exec("delete from gate where at > 1e12 and at < ? and k not like '%|hello'", now - 86400000); q.exec("delete from ag where d <> '' and d < ?", dayShift(kstDay(now), -2)); }
    return gained > 0 ? gained : 0; }
  credit(a, amount, nick, cap, kind) { if (!a?.k || this.lvl >= 2) return false; this.tapDb(); const now = Date.now();
    const creditN = Math.min(cap, Math.floor(Number(amount))); if (!Number.isInteger(creditN) || creditN < 1) return false;
    const q = this.ctx.storage.sql; const key = a.k + '|' + kind;
    if (now - Math.max(this.gateAt(key), a.sf || 0) < (kind === 'click' ? 800 : MINE_GAP)) return false;
    this.gateSet(key, now);
    const name = clip(nick, 16); if (!this.tapN) this.tapAt = now;
    q.exec("insert into coin(uid, nick, delta, n, at, reason) values(?, ?, ?, 1, ?, 'bonus') on conflict(uid) do update set delta = delta + excluded.delta, n = n + excluded.n, nick = excluded.nick, at = min(coin.at, excluded.at), reason = excluded.reason", a.k, name, creditN, now);
    this.tapN++; if (this.tapN >= FLUSH_N) this.flush(); else this.arm(); return true; }
  // Repeat income uses the server table. attend, mission and hello do not take fever.
  // Daily gates stay attend: [30, 0, 1], mission: [15, 0, 3]. Pouch keeps pouch: [30, 25000] as its cap and gap.
  bonus(w, a, kind, amount, nick) {
    if (kind === 'draw' || kind === 'quest') return false;
    const fixed = { attend: [30, 0, 1], mission: [15, 0, 3], hello: [PAY.hello, -1], pouch: [30, 25000] };
    if (!a?.k || this.lvl >= 2) return false;
    this.tapDb();
    const now = Date.now(), q = this.ctx.storage.sql;
    if (kind === 'attend') return this.attendPay(w, a, nick, now, q);
    if (kind === 'mission' || kind === 'hello' || kind === 'shot') {
      const day = kind === 'hello' ? '' : kstDay(now);
      const spec = kind === 'shot' ? [5, 0, 1] : fixed[kind];
      const n = agGet(q, a.k, kind, day);
      if (n >= (spec[2] || 1)) return false;
      const paid = this.grantFinal(a, spec[0], nick, kind, 'bonus');
      if (paid < 1) return false;
      agPut(q, a.k, kind, day, n + 1);
      this.tx(w, { t: 'PAY', kind, amount: paid });
      return true;
    }
    const row = { lounge: PAY.lounge, stunt: PAY.stunt, hive: PAY.hive, star: PAY.star, pouch: PAY.pouch }[kind];
    if (!row) return false;
    if (kind === 'pouch' && agGet(q, a.k, 'pouch', kstDay(now)) >= PAY.pouch.perDay) { this.tx(w, { t: 'PAY', kind: 'pouch', amount: 0, why: 'pouchday' }); return false; }
    const gap = kind === 'pouch' ? fixed.pouch[1] : (row.gapMs || 0);
    if (gap > 0) {
      const key = a.k + '|' + kind;
      if (now - Math.max(this.gateAt(key), a.sf || 0) < gap - GAP_EARLY) { this.tx(w, { t: 'PAY', kind, amount: 0, why: 'soon' }); return false; }
      this.gateSet(key, now);
    }
    const playAdd = { lounge: 10, star: 10, stunt: 15, hive: 15, pouch: 25 }[kind] || 0;
    const eachCap = kind === 'pouch' ? fixed.pouch[0] : 0;
    const paid = this.repeatPay(a, row.base, nick, kind, playAdd, row.perHour || 0, eachCap);
    if (paid > 0 && kind === 'pouch') agPut(q, a.k, 'pouch', kstDay(now), agGet(q, a.k, 'pouch', kstDay(now)) + 1);
    if (paid > 0 && kind === 'stunt') agPut(q, a.k, 'qs', kstDay(now), agGet(q, a.k, 'qs', kstDay(now)) + 1);
    if (paid > 0) this.tx(w, { t: 'PAY', kind, amount: paid });
    else this.tx(w, { t: 'PAY', kind, amount: 0, why: 'cap' });
    return paid > 0;
  }
  // touch_attend owns the ladder. A failed RPC does not spend today's ag count, and fever does not multiply the amount.
  async attendPay(w, a, nick, now, q) {
    const day = kstDay(now);
    const n = agGet(q, a.k, 'attend', day);
    if (n >= 1) return false;
    const key = this.env?.FLUSH_KEY;
    if (typeof key !== 'string' || !key) return false;
    let data = null;
    try {
      const r = await fetch(SUPA + '/rest/v1/rpc/touch_attend', { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ p_key: key, p_actor_id: a.k }) });
      data = await r.json();
    } catch { return false; }
    if (!data || data.ok !== true) return false;
    const amount = Math.floor(Number(data.amount));
    if (!Number.isInteger(amount) || amount < 1 || amount > 30) return false;
    agPut(q, a.k, 'attend', day, n + 1);
    const paid = this.grantFinal(a, amount, nick, 'attend', 'bonus');
    if (paid > 0) this.tx(w, { t: 'PAY', kind: 'attend', amount: paid, key: String(data.streak ?? '') });
    return paid > 0;
  }
  payState(a) {
    const q = this.ctx.storage.sql, now = Date.now(), day = kstDay(now);
    let start = agGet(q, a.k, 'eht', ''), sum = agGet(q, a.k, 'ehs', '');
    if (!start || now / 1000 - start >= 3600) { start = Math.floor(now / 1000); sum = 0; agSet(q, a.k, 'eht', '', start); agSet(q, a.k, 'ehs', '', 0); }
    return { playSeconds: agGet(q, a.k, 'play', day), earnedInWindow: sum, fever: this.feverScale(a.k) > 1, ball: ballOpen(now), windowStart: start };
  }
  notePlay(a, add, amount) {
    const q = this.ctx.storage.sql, day = kstDay();
    if (add) agPut(q, a.k, 'play', day, agGet(q, a.k, 'play', day) + add);
    agSet(q, a.k, 'ehs', '', agGet(q, a.k, 'ehs', '') + amount);
  }
  grantFinal(a, amount, nick, kind, reason = 'mine') {
    if (amount < 1) return 0;
    const now = Date.now(), name = clip(nick, 16), q = this.ctx.storage.sql;
    if (!this.tapN) this.tapAt = now;
    q.exec('insert into coin(uid, nick, delta, n, at, reason) values(?, ?, ?, 1, ?, ?) on conflict(uid) do update set delta = delta + excluded.delta, n = n + excluded.n, nick = excluded.nick, at = min(coin.at, excluded.at), reason = excluded.reason', a.k, name, amount, now, reason || 'mine');
    this.tapN++;
    if (this.tapN >= FLUSH_N) this.flush(); else this.arm();
    return amount;
  }
  repeatPay(a, base, nick, kind, playAdd, perHour, eachCap = 0) {
    if (!a?.k || this.lvl >= 2) return 0;
    this.tapDb();
    const q = this.ctx.storage.sql, now = Date.now(), bucket = String(Math.floor(now / 3600000));
    const used = agGet(q, a.k, 'hr:' + kind, bucket);
    if (perHour && used >= perHour) return 0;
    const state = this.payState(a);
    let amount = scaledPay(base, state);
    if (eachCap) amount = Math.min(eachCap, amount);
    if (amount < 1) return 0;
    agPut(q, a.k, 'hr:' + kind, bucket, used + 1);
    this.notePlay(a, playAdd, amount);
    return this.grantFinal(a, amount, nick, kind, 'mine');
  }
  metersOf(a) {
    const x = (Number(a.m?.x) - 1500) / 20, z = (Number(a.m?.y) - 1500) / 20;
    return { x, z };
  }
  near(a, point, radius) {
    const p = this.metersOf(a);
    return Math.hypot(p.x - point.x, p.z - point.z) <= radius;
  }
  sess(w, a, m) {
    this.tapDb();
    const q = this.ctx.storage.sql;
    if (m.op === 'start' && (m.kind === 'bake' || m.kind === 'dance')) {
      const hx = Number(m.a?.[0]), hy = Number(m.a?.[1]);
      if (Number.isFinite(hx) && Number.isFinite(hy) && Math.abs(hx) < 100000 && Math.abs(hy) < 100000) a.m = Object.assign(a.m || {}, { x: Math.round(hx), y: Math.round(hy) });
      const point = m.kind === 'bake' ? PAY.stall : PAY.stage;
      const radius = m.kind === 'bake' ? PAY.bake.nearM : PAY.dance.nearM;
      if (!this.near(a, point, radius)) { this.tx(w, { t: 'SESS', ok: false, why: 'place' }); return; }
      const id = crypto.randomUUID();
      const p = this.metersOf(a);
      q.exec('insert into sess(id, uid, kind, t0, x, z) values(?, ?, ?, ?, ?, ?)', id, a.k, m.kind, Date.now(), Math.round(p.x), Math.round(p.z));
      this.tx(w, { t: 'SESS', id, ok: true });
      return;
    }
    if (m.op !== 'end' || typeof m.id !== 'string') { this.tx(w, { t: 'SESS', ok: false }); return; }
    const row = q.exec('select id, uid, kind, t0 from sess where id = ?', m.id).toArray()[0];
    q.exec('delete from sess where id = ?', String(m.id || ''));
    if (!row || row.uid !== a.k) { this.tx(w, { t: 'SESS', ok: false }); return; }
    const dt = Date.now() - Number(row.t0);
    const spec = row.kind === 'bake' ? PAY.bake : PAY.dance;
    if (dt < spec.minS * 1000 - GAP_EARLY || dt > spec.maxS * 1000) { this.tx(w, { t: 'SESS', ok: false, why: 'time' }); return; }
    const base = row.kind === 'bake' ? bakeBase(m.result) : danceBase(m.result);
    const amount = this.repeatPay(a, base, '', row.kind, row.kind === 'bake' ? 8 : 25, spec.perHour);
    if (amount > 0) this.tx(w, { t: 'PAY', kind: row.kind, amount });
    else this.tx(w, { t: 'SESS', ok: false, why: 'cap' });
  }
  pick(a) {
    this.tapDb();
    const q = this.ctx.storage.sql, now = Date.now(), p = this.metersOf(a);
    const prevAt = agGet(q, a.k, 'pickAt', ''), prevX = agGet(q, a.k, 'pickX', ''), prevZ = agGet(q, a.k, 'pickZ', ''), n = agGet(q, a.k, 'pickN', '');
    if (n >= PAY.fare.pickMax) return;
    if (prevAt && now - prevAt < PAY.fare.pickGapMs - GAP_EARLY) return;
    if (prevAt && Math.hypot(p.x - prevX, p.z - prevZ) < PAY.fare.pickMoveM) return;
    agSet(q, a.k, 'pickAt', '', now); agSet(q, a.k, 'pickX', '', Math.round(p.x)); agSet(q, a.k, 'pickZ', '', Math.round(p.z)); agSet(q, a.k, 'pickN', '', n + 1);
  }
  fare(w, a, m) {
    if (!AD_SLOT.test(String(m.slot || ''))) { this.tx(w, { t: 'PAY', kind: 'fare', amount: 0, why: 'place' }); return; }
    this.tapDb();
    const q = this.ctx.storage.sql, now = Date.now(), n = agGet(q, a.k, 'pickN', '');
    if (n < 1) { this.tx(w, { t: 'PAY', kind: 'fare', amount: 0, why: 'nopick' }); return; }
    if (now - agGet(q, a.k, 'fareAt', '') < PAY.fare.gapMs - GAP_EARLY) { this.tx(w, { t: 'PAY', kind: 'fare', amount: 0, why: 'soon' }); return; }
    const riders = n;
    agSet(q, a.k, 'pickN', '', 0); agSet(q, a.k, 'fareAt', '', now);
    const hb = String(Math.floor(now / 3600000)), hn = agGet(q, a.k, 'hr:fare', hb); // PAY.fare.perHour paid fares per clock hour, the repeatPay bucket
    if (hn >= PAY.fare.perHour) { this.tx(w, { t: 'PAY', kind: 'fare', amount: 0, why: 'cap' }); return; }
    const state = this.payState(a);
    state.revenge = this.fareMult(a.k) > 1;
    const amount = farePay(riders, state);
    if (amount < 1) { this.tx(w, { t: 'PAY', kind: 'fare', amount: 0, why: 'cap' }); return; }
    agPut(q, a.k, 'hr:fare', hb, hn + 1);
    this.notePlay(a, 40, amount);
    this.grantFinal(a, amount, '', 'fare', 'fare');
    const gauge = this.bumpFeverCount(a.k);
    this.bumpAd(m.slot, 'views', a.k);
    const day = kstDay(now);
    agPut(q, a.k, 'qf', day, agGet(q, a.k, 'qf', day) + 1);
    const bucket = Math.floor(now / 300000);
    let ticket = agGet(q, a.k, 'lot:' + bucket, '');
    if (!ticket) {
      ticket = (crypto.getRandomValues(new Uint8Array(1))[0] % 15) + 1;
      agPut(q, a.k, 'lot:' + bucket, '', ticket);
    }
    this.tx(w, { t: 'PAY', kind: 'fare', amount, gauge, lot: ticket });
  }
  quest(w, a, m) {
    const key = m.key;
    if (key !== 'fare' && key !== 'cheer' && key !== 'stunt') return;
    this.tapDb();
    const q = this.ctx.storage.sql, day = kstDay(), map = { fare: ['qf', 3, PAY.quest.fare], cheer: ['qc', 3, PAY.quest.cheer], stunt: ['qs', 2, PAY.quest.stunt] };
    const [agk, need, prize] = map[key];
    if (agGet(q, a.k, agk + 'd', day)) return;
    if (agGet(q, a.k, agk, day) < need) return;
    agPut(q, a.k, agk + 'd', day, 1);
    this.grantFinal(a, prize, '', 'quest', 'bonus');
    this.tx(w, { t: 'PAY', kind: 'quest', amount: prize, key });
    if (['qf', 'qc', 'qs'].every((k) => agGet(q, a.k, k + 'd', day)) && !agGet(q, a.k, 'qall', day)) {
      agPut(q, a.k, 'qall', day, 1);
      this.grantFinal(a, PAY.quest.all, '', 'quest', 'bonus');
      this.tx(w, { t: 'PAY', kind: 'quest', amount: PAY.quest.all, key: 'all' });
    }
  }
  // The holder comes from boardsFor (this room's own rows, a fresh isolate copy, or one read), never from an unchecked world copy.
  // Holder unknown (the read failed): 'wait'. No holder, own board or not lit: 'dark'. Budget hard: 'wait' before any read.
  async cheer(w, a, m) {
    const p = Math.floor(Number(m.p));
    const slot = String(m.slot || '');
    if (!AD_SLOT.test(slot) || p < 1 || p > 12) return;
    const soon = () => Date.now() - this.gateAt(a.k + '|cheer:' + slot) < PAY.cheer.gapMs - GAP_EARLY;
    if (this.lvl >= 2) { this.tx(w, { t: 'PAY', kind: 'cheer', amount: 0, why: 'wait' }); return; }
    if (soon()) { this.tx(w, { t: 'PAY', kind: 'cheer', amount: 0, why: 'soon' }); return; } // before any board read
    const boards = await this.boardsFor(buildingOf(slot)?.slots || [slot]), board = boards.get(slot);
    const now = Date.now();
    if (!board) { this.tx(w, { t: 'PAY', kind: 'cheer', amount: 0, why: 'wait' }); return; }
    const until = Date.parse(board.lit_until || board.expires_at || '');
    if (!board.holder_id || board.holder_id === a.k || !(until > now)) { this.tx(w, { t: 'PAY', kind: 'cheer', amount: 0, why: 'dark' }); return; }
    this.tapDb();
    if (soon()) { this.tx(w, { t: 'PAY', kind: 'cheer', amount: 0, why: 'soon' }); return; } // again: another cheer may have landed during the read
    this.gateSet(a.k + '|cheer:' + slot, now);
    const base = chainBoost([...boards.values()], slot, now) ? BALANCE.cheerGroup : PAY.cheer.base;
    const amount = this.repeatPay(a, base, '', 'cheer', 12, PAY.cheer.perHour);
    if (amount < 1) { this.tx(w, { t: 'PAY', kind: 'cheer', amount: 0, why: 'cap' }); return; }
    const q = this.ctx.storage.sql, day = kstDay();
    agPut(q, a.k, 'qc', day, agGet(q, a.k, 'qc', day) + 1);
    this.tx(w, { t: 'PAY', kind: 'cheer', amount });
    this.adTally(slot, 'h', a.k);
    this.shareCheer(slot, p);
    const holder = String(board.holder_id);
    const fromName = clip(a.m?.name || '', 12);
    this.ibPut({ kind: 'cheer', slot_id: slot, phrase: p, from_name: fromName, from: a.k, to: holder });
    const note = { t: 'INBOX', kind: 'cheer', slot_id: slot, phrase: p, from_name: fromName, from: a.k };
    for (const [sock, peer] of this.socks()) if (peer.q && peer.k === holder) this.tx(sock, note);
    this.noteTribe(a.k, 1);
    try {
      const job = this.env.METER.get(this.env.METER.idFromName('ev'))?.touch?.(isoWeek(now), a.k);
      if (job && typeof job.then === 'function') job.catch(() => {});
    } catch { /* north-star touch is best-effort */ }
  }
  async replyCheer(w, a, m) {
    const p = Math.floor(Number(m?.p));
    const slot = String(m?.slot || '');
    const to = String(m?.to || '').slice(0, 80);
    const ack = (ok) => this.tx(w, { t: 'INBOX', kind: 'reply_ack', ok: !!ok, phrase: p });
    if (!AD_SLOT.test(slot) || p < 1 || p > 12 || !to || to === a.k) return ack(false);
    if (this.lvl >= 2 || Date.now() - this.gateAt(a.k + '|reply') < 3000) return ack(false); // before any board read
    const board = (await this.boardsFor([slot])).get(slot);
    if (!board || board.holder_id !== a.k) return ack(false);
    const now = Date.now();
    if (now - this.gateAt(a.k + '|reply') < 3000) return ack(false);
    this.gateSet(a.k + '|reply', now);
    const fromName = clip(a.m?.name || board.holder_name || '', 12);
    let hit = false;
    for (const [sock, peer] of this.socks()) if (peer.q && peer.k === to) {
      this.tx(sock, { t: 'INBOX', kind: 'reply', slot_id: slot, phrase: p, from_name: fromName });
      hit = true;
    }
    ack(hit);
  }
  // Boards as this room last heard them (WORLD_UPDATE rows, single reads) in SQLite `brd`, so a woken room keeps them. at: when the row was known current
  // (a relayed row: when it arrived; a read: 1 ms before the read started, so it never ties an update relayed meanwhile); an older answer never replaces a newer row.
  brdPut(b, at) { const r = brdRow(b); if (r) this.ctx.storage.sql.exec('insert into brd(slot, b, at) values(?, ?, ?) on conflict(slot) do update set b = excluded.b, at = excluded.at where excluded.at >= brd.at', r.slot_id, JSON.stringify(r), at); }
  brdGet(slot, now) { const r = this.ctx.storage.sql.exec('select b, at from brd where slot = ?', slot).toArray()[0]; if (!r || !(now - Number(r.at) < BRD_TTL)) return null; try { return { b: JSON.parse(r.b), at: Number(r.at) }; } catch { return null; } }
  // slot -> row for these slots: this room's row (BRD_TTL) or the isolate's world copy when it is under a minute old and newer; the rest in one Supabase
  // read (BRD_MS). A slot left out is unknown: the caller must not guess its holder.
  async boardsFor(slots) { this.tapDb(); const now = Date.now(), out = new Map(), mem = PC.get('world'), wAt = mem && now - mem.at < 60000 ? mem.at : 0, world = wAt ? cachedBoards() : [];
    const pick = (s) => { const own = this.brdGet(s, Date.now()), w = wAt ? world.find((x) => x?.slot_id === s) : null, b = w && (!own || wAt > own.at) ? w : own?.b; if (b) out.set(s, b); };
    slots.forEach(pick); const miss = slots.filter((s) => !out.has(s)); if (!miss.length) return out;
    if (await this.boardRead(miss)) miss.forEach(pick);
    return out; }
  // One read of these boards into brd, shared by cheers that ask at the same time; false when Supabase fails or does not answer in BRD_MS. A late answer
  // still lands in brd. After a failure or a late answer the same set of slots is not read again for BRD_FAIL (the cheers in between get 'wait').
  boardRead(slots) { const key = slots.join(','); if (!this._br) { this._br = new Map(); this._bf = new Map(); }
    if (this._br.has(key)) return this._br.get(key);
    if (Date.now() < (this._bf.get(key) || 0)) return Promise.resolve(false);
    const t0 = Date.now(), fail = () => { this._bf.set(key, Date.now() + BRD_FAIL); return false; }; let t = 0;
    const read = (async () => { const r = await fetch(SUPA + '/rest/v1/billboards?select=' + BRD_KEYS + '&slot_id=in.(' + slots.join(',') + ')', { headers: { apikey: ANON, accept: 'application/json' } });
      const rows = r.ok ? await r.json() : null; if (!Array.isArray(rows)) throw new Error('board ' + r.status);
      const got = new Map(); for (const b of rows) if (slots.includes(String(b?.slot_id))) { if (!brdRow(b)) throw new Error('board row'); got.set(String(b.slot_id), b); }
      for (const s of slots) this.brdPut(got.get(s) || { slot_id: s, holder_id: null, lit_until: null }, t0 - 1); // no row in Supabase: nobody holds it
      this._bf.delete(key); return true; })().catch(fail);
    const job = Promise.race([read, new Promise((ok) => { t = setTimeout(() => ok(fail()), BRD_MS); })]).finally(() => { clearTimeout(t); this._br.delete(key); });
    this._br.set(key, job); return job; }
  // Inbox rows wait in SQLite `ibq` until flushInbox; a row without a recipient is never queued.
  ibPut(it) { if (!it?.to) return; this.tapDb(); this.ctx.storage.sql.exec('insert into ibq(it, at) values(?, ?)', JSON.stringify(it), Date.now()); }
  noteTribe(uid, bit) {
    const n = Math.floor(Number(bit));
    if (!uid || (n !== 1 && n !== 2 && n !== 4)) return 0;
    this.tapDb();
    const q = this.ctx.storage.sql, day = kstDay();
    const next = agGet(q, uid, 'ts', day) | n;
    agPut(q, uid, 'ts', day, next);
    return tribePoints(next);
  }
  async httpScore(req) {
    const uid = String(req.headers.get('x-uid') || '');
    if (!uid) return J({ ok: false }, 401);
    let m = {};
    try { m = await req.json(); } catch { m = {}; }
    if (m?.look) {
      this.tapDb();
      const q = this.ctx.storage.sql;
      let pending = 0;
      for (const row of q.exec("select d, v from ag where uid = ? and k = 'ts'", uid).toArray()) {
        if (agGet(q, uid, 'tso', String(row.d || ''))) continue;
        pending += tribePoints(row.v);
      }
      return J({ ok: true, pending });
    }
    const bit = Math.floor(Number(m?.bit));
    if (bit !== 1 && bit !== 2 && bit !== 4) return J({ ok: false }, 400);
    if (m?.seated) {
      this.tapDb();
      const here = this.ctx.storage.sql.exec('select 1 from seat where uid = ?', uid).toArray()[0] || [...this.socks().values()].some((a) => a.k === uid);
      if (!here) return J({ ok: true, skip: true });
    }
    return J({ ok: true, points: this.noteTribe(uid, bit) });
  }
  async flushTribeScores() {
    const key = this.env?.FLUSH_KEY;
    if (typeof key !== 'string' || !key || key === 'flush-test-key') return;
    this.tapDb();
    const q = this.ctx.storage.sql, today = kstDay();
    let rows = [];
    try { rows = q.exec("select uid, d, v from ag where k = 'ts'").toArray(); } catch { return; }
    let sent = 0; // at most TRIBE_FLUSH_N fetches per pass (a claim's settle waits for this flush); the rest stay for the next flush
    for (const row of rows) {
      const uid = String(row.uid || ''), day = String(row.d || ''), pts = tribePoints(row.v);
      if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(day) || pts < 1) continue;
      if (agGet(q, uid, 'tso', day)) continue;
      if (day >= today && pts < 7) continue;
      const week = isoWeek(Date.parse(day + 'T12:00:00+09:00'));
      if (sent++ >= TRIBE_FLUSH_N) return;
      try {
        const r = await fetch(SUPA + '/rest/v1/rpc/add_tribe_score', { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ p_key: key, p_actor_id: uid, p_week: week, p_points: pts }) });
        const text = await r.text();
        let out = null; try { out = JSON.parse(text); } catch { out = null; }
        if (/schema cache|Could not find|does not exist|42P01/i.test(text)) return;
        if (out && out.ok === false && out.error === 'tribe') { agPut(q, uid, 'tso', day, 1); continue; }
        if (!r.ok || !out || out.ok === false) continue;
        agPut(q, uid, 'tso', day, 1);
      } catch { /* the day's points stay until the next flush */ }
    }
  }
  async drawDue() {
    try {
      const bucket = Math.floor(Date.now() / 300000);
      const closed = drawSpan(this.gateAt('lotSeen'), bucket);
      if (!closed.length) return;
      const lotto = this.env.METER?.get?.(this.env.METER.idFromName('lotto'));
      if (!lotto?.draw) return;
      for (const b of closed) {
        const win = await lotto.draw(b);
        const who = new Set();
        for (const [w, a] of this.socks()) {
          if (!a?.q || who.has(a.k)) continue;
          who.add(a.k);
          this.payDraw(w, a, b, win);
        }
        this.rememberDraw(b, win);
      }
      this.gateSet('lotSeen', bucket);
    } catch { /* the raffle must not stop the alarm */ }
  }
  payDraw(w, a, bucket, win) {
    if (!a?.k) return;
    this.tapDb();
    const q = this.ctx.storage.sql, paid = 'lotd:' + bucket;
    if (agGet(q, a.k, paid, '')) return;
    const ticket = agGet(q, a.k, 'lot:' + bucket, '');
    agPut(q, a.k, paid, '', 1);
    if (ticket < 1) return;
    const hit = ticket >= 1 && ticket === Number(win);
    const amount = hit ? PAY.lottery.hit : 0;
    if (amount > 0) this.grantFinal(a, amount, '', 'lottery', 'lottery');
    if (w) this.tx(w, { t: 'DRAW', bucket, win: Number(win), hit, amount, lot: ticket });
  }
  async drawCheck(w, a) {
    const bucket = Math.floor(Date.now() / 300000) - 1;
    let win = 0;
    try {
      const lotto = this.env.METER.get(this.env.METER.idFromName('lotto'));
      if (!lotto?.draw) return;
      win = await lotto.draw(bucket);
    } catch { return; }
    this.payDraw(w, a, bucket, win);
    this.rememberDraw(bucket, win);
  }
  rememberDraw(bucket, win) {
    const key = this.env?.FLUSH_KEY;
    if (typeof key !== 'string' || !key || key === 'flush-test-key') return;
    const job = supabaseRpc('record_lottery_draw', { p_key: key, p_bucket: Number(bucket), p_winning: Number(win) }).catch(() => {});
    try { this.ctx.waitUntil?.(job); } catch { /* Meter is the authority */ }
  }
  hasHello(uid) { this.tapDb(); return agGet(this.ctx.storage.sql, String(uid || ''), 'hello', '') >= 1; }
  gateAt(key) { this.tapDb(); const row = this.ctx.storage.sql.exec('select at from gate where k = ?', key).toArray()[0]; return row ? Number(row.at) : 0; }
  gateSet(key, at) { this.tapDb(); this.ctx.storage.sql.exec('insert into gate(k, at) values(?, ?) on conflict(k) do update set at = excluded.at', key, at); }
  fareMult(uid) { return this.gateAt('rev|' + uid) > Date.now() ? 2 : 1; }
  feverScale(uid) { return this.gateAt('fv|' + uid) > Date.now() ? 2 : 1; }
  trainMult(uid, riders) {
    const table = [1, 2.2, 3.8, 6, 10];
    const n = Math.min(5, Math.max(1, Math.floor(Number(riders)) || 1));
    return table[n - 1] * this.fareMult(uid) * this.feverScale(uid);
  }
  bumpFeverCount(uid) {
    if (this.gateAt('fv|' + uid) > Date.now()) return this.gateAt('fg|' + uid);
    const next = Math.min(20, (this.gateAt('fg|' + uid) || 0) + 1);
    this.gateSet('fg|' + uid, next);
    return next;
  }
  startFever(uid) {
    const until = this.gateAt('fv|' + uid);
    if (until > Date.now()) return until;
    if ((this.gateAt('fg|' + uid) || 0) < 20) return 0;
    const next = Date.now() + 60000;
    this.gateSet('fv|' + uid, next);
    this.gateSet('fg|' + uid, 0);
    return next;
  }
  markDisp(uid) { if (uid) this.gateSet('disp|' + String(uid).slice(0, 80), Date.now()); }
  startRevenge(uid) {
    const at = this.gateAt('disp|' + uid);
    if (!at || Date.now() - at > 10 * 60 * 1000) return 0;
    const until = Date.now() + 120000;
    this.gateSet('rev|' + uid, until);
    return until;
  }
  bumpAd(slot, kind, by) { if (!AD_SLOT.test(String(slot || ''))) return; this.tapDb(); const q = this.ctx.storage.sql;
    q.exec('insert into adstat(slot, views, clicks, dirty) values(?, 0, 0, 0) on conflict(slot) do nothing', slot);
    if (kind === 'clicks') q.exec('update adstat set clicks = clicks + 1, dirty = 1 where slot = ?', slot);
    else q.exec('update adstat set views = views + 1, dirty = 1 where slot = ?', slot);
    const row = q.exec('select views, clicks from adstat where slot = ?', slot).toArray()[0];
    this.bc({ t: 'AD', slot, kind: kind === 'clicks' ? 'clicks' : 'views', views: Number(row?.views) || 0, clicks: Number(row?.clicks) || 0, by });
    this.adTally(slot, kind === 'clicks' ? 'c' : 'v', by); }
  // The holder's report (Meter 'ad'): per slot and minute, plus who acted today, until the next flushAds hands them over.
  adTally(slot, col, uid) { if (!AD_SLOT.test(String(slot || '')) || !['v', 'c', 'h'].includes(col)) return; this.tapDb(); const q = this.ctx.storage.sql, now = Date.now(), b = Math.floor(now / 60000);
    q.exec('insert into adq(slot, b, ' + col + ') values(?, ?, 1) on conflict(slot, b) do update set ' + col + ' = ' + col + ' + 1', slot, b);
    if (uid) q.exec('insert or ignore into adw(slot, d, uid, b) values(?, ?, ?, ?)', slot, kstDay(now), String(uid).slice(0, 80), b);
    this.adDirty = 1; }
  // Hands the tallies to Meter 'ad' (one call). Sent rows are taken off by what was sent, so events counted meanwhile stay. Returns rows still waiting.
  async adPush() { const q = this.ctx.storage.sql, now = Date.now();
    // Bounded while the Meter keeps failing: what it would drop anyway (older than its 35 days, people of another day) goes here first.
    q.exec('delete from adq where b < ?', Math.floor((now - 35 * 864e5) / 60000)); q.exec('delete from adw where d <> ?', kstDay(now));
    const rows = q.exec('select slot, b, v, c, h from adq limit 200').toArray(), ppl = q.exec('select slot, d, uid, b from adw limit 400').toArray();
    if (rows.length || ppl.length) { this.conns++; // one DO call, counted toward the daily budget like the seat calls
      try { await this.env.METER.get(this.env.METER.idFromName('ad')).adAdd(rows.map(r => ({ s: String(r.slot), b: Number(r.b), v: Number(r.v) || 0, c: Number(r.c) || 0, h: Number(r.h) || 0 })), ppl.map(r => ({ s: String(r.slot), d: String(r.d), u: String(r.uid), b: Number(r.b) })));
        for (const r of rows) q.exec('update adq set v = v - ?, c = c - ?, h = h - ? where slot = ? and b = ?', r.v, r.c, r.h, r.slot, r.b);
        q.exec('delete from adq where v <= 0 and c <= 0 and h <= 0'); for (const r of ppl) q.exec('delete from adw where slot = ? and d = ? and uid = ?', r.slot, r.d, r.uid);
      } catch { /* the rows wait for the next flush */ } }
    return Number(q.exec('select (select count(*) from adq) + (select count(*) from adw) n').one().n) || 0; }
  // Link visit pays once per account per board per KST day, AD_DAY boards a day.
  adClick(w, a, nick, slot) { if (!a?.k || !AD_SLOT.test(slot)) return false; this.tapDb(); const q = this.ctx.storage.sql, day = kstDay(), n = agGet(q, a.k, 'adn', day);
    if (n >= AD_DAY || agGet(q, a.k, 'ad:' + slot, day)) { if (w) this.tx(w, { t: 'PAY', kind: 'click', amount: 0, why: 'day', key: slot }); return false; }
    const pay = AD_PAY * this.feverScale(a.k); if (!this.credit(a, pay, nick, pay, 'click')) return false;
    agPut(q, a.k, 'adn', day, n + 1); agPut(q, a.k, 'ad:' + slot, day, 1); this.bumpAd(slot, 'clicks', a.k);
    if (w) this.tx(w, { t: 'PAY', kind: 'click', amount: pay });
    return true; }
  async flushAds() { this.tapDb(); const q = this.ctx.storage.sql; this.adFlushAt = Date.now(); const wait = await this.adPush();
    const rows = q.exec('select slot, views, clicks from adstat where dirty = 1 limit 40').toArray();
    if (!rows.length || typeof this.env.FLUSH_KEY !== 'string' || !this.env.FLUSH_KEY) { this.adDirty = rows.length || wait ? 1 : 0; return; }
    const items = rows.map(r => ({ slot_id: String(r.slot), views: Number(r.views) || 0, clicks: Number(r.clicks) || 0 }));
    try {
      const r = await fetch(SUPA + '/rest/v1/rpc/ad_stat_batch', { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ p_key: this.env.FLUSH_KEY, p_items: items }) });
      if (!r.ok) throw new Error('ad ' + r.status);
      for (const row of rows) q.exec('update adstat set dirty = 0 where slot = ? and views = ? and clicks = ?', row.slot, row.views, row.clicks);
      this.adDirty = wait || q.exec('select count(*) n from adstat where dirty = 1').one().n > 0 ? 1 : 0;
    } catch { this.adDirty = 1; } }
  flush(onlyUid) { const prev = this._fq || Promise.resolve(); const job = prev.then(() => this._flush(onlyUid)); this._fq = job.then(() => {}, () => {}); return job; }
  async _flush(onlyUid) { this.tapDb(); const q = this.ctx.storage.sql;
    const raw = onlyUid ? q.exec('select uid, nick, delta, n, at, reason from coin where uid = ?', onlyUid).toArray() : q.exec('select uid, nick, delta, n, at, reason from coin limit 500').toArray();
    const rows = raw.map(r => ({ uid: String(r.uid), nick: r.nick == null ? '' : String(r.nick), delta: Number(r.delta) || 0, n: Number(r.n) || 0, at: Number(r.at) || Date.now(), reason: r.reason ? String(r.reason) : 'mine' })).filter(r => r.delta > 0 && r.n > 0);
    if (!rows.length) { await this.flushInbox(); try { await this.flushTribeScores(); } catch { /* coin flush already had nothing to send */ } this.syncPending(); return { ok: true, flushed: 0, pending: 0 }; }
    const kept = []; for (const row of rows) if (q.exec('delete from coin where uid = ? and delta = ? and n = ?', row.uid, row.delta, row.n).rowsWritten) kept.push(row);
    if (!kept.length) { this.syncPending(); return { ok: true, flushed: 0, pending: 0 }; }
    const items = [];
    for (const row of kept) {
      let left = row.delta;
      while (left > 0) {
        const delta = Math.min(500, left);
        items.push({ actor_id: row.uid, nickname: (!botNick(row.nick) && row.nick) || '네온손님', delta, reason: row.reason || 'mine' }); // 네온봇N is the seeded bots' name, not a player's
        left -= delta;
      }
    }
    try {
      if (typeof this.env.FLUSH_KEY !== 'string' || !this.env.FLUSH_KEY) throw new Error('missing FLUSH_KEY');
      const r = await fetch(SUPA + '/rest/v1/rpc/coin_batch', { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ p_key: this.env.FLUSH_KEY, p_items: items }) });
      const text = await r.text(); let out = null; try { out = JSON.parse(text); } catch { out = null; }
      if (!r.ok || !out || out.ok === false) throw new Error('flush ' + r.status);
      await this.flushInbox();
      try { await this.flushTribeScores(); } catch { /* coins are already settled */ }
      this.syncPending(); this.flushes = (this.flushes || 0) + 1; this.flushErr = null;
      for (const row of kept) this.walletSync(row.uid);
      if (this.tapN) this.arm(); return { ok: true, flushed: kept.length, pending: 0 };
    } catch (e) {
      for (const row of kept) q.exec('insert into coin(uid, nick, delta, n, at, reason) values(?, ?, ?, ?, ?, ?) on conflict(uid) do update set delta = delta + excluded.delta, n = n + excluded.n, nick = excluded.nick, at = min(coin.at, excluded.at), reason = excluded.reason', row.uid, row.nick, row.delta, row.n, row.at, row.reason || 'mine');
      this.syncPending(); this.flushErr = String(e).slice(0, 80); try { this.arm(); } catch { }
      return { ok: false, error: '미정산 코인을 반영하지 못했습니다. 잠시 후 다시 시도해 주세요.', pending: true };
    } }
  // inbox_batch writes the queued rows (ibq, oldest first, IBQ_N per call) and trims each account to 50. Sent rows leave ibq; a failure or a missing RPC
  // keeps them for the next flush. Rows older than IBQ_DAYS or past the newest IBQ_MAX are dropped first. One send at a time.
  flushInbox() { if (!this._ib) this._ib = this._flushInbox().catch(() => { }).finally(() => { this._ib = null; }); return this._ib; }
  async _flushInbox() {
    this.tapDb(); const q = this.ctx.storage.sql, now = Date.now(); this.ibAt = now;
    q.exec('delete from ibq where at < ?', now - IBQ_DAYS * 864e5); q.exec('delete from ibq where id <= (select max(id) from ibq) - ?', IBQ_MAX);
    const rows = q.exec('select id, it from ibq order by id limit ?', IBQ_N).toArray();
    if (!rows.length) return;
    const items = []; for (const r of rows) { try { const it = JSON.parse(r.it); if (it?.to) items.push(it); } catch { /* a broken row is dropped with the batch */ } }
    const key = this.env.FLUSH_KEY;
    if (items.length) {
      if (typeof key !== 'string' || !key) return;
      try {
        const r = await fetch(SUPA + '/rest/v1/rpc/inbox_batch', { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ p_key: key, p_items: items }) });
        const text = await r.text();
        if (!r.ok || /schema cache|Could not find|does not exist|42P01/i.test(text)) return;
      } catch { return; } // coin flush must not depend on the inbox table
    }
    q.exec('delete from ibq where id <= ?', rows[rows.length - 1].id);
  }
  ibWait() { this.tapDb(); return this.ctx.storage.sql.exec('select 1 from ibq limit 1').toArray().length > 0; }
  async httpFlush(req) { const uid = String(req.headers.get('x-uid') || ''); if (!uid) return J({ ok: false, error: 'auth' }, 401);
    try { this.tapDb(); const row = this.ctx.storage.sql.exec('select delta from coin where uid = ?', uid).toArray()[0]; if (!row?.delta) return J({ ok: true, pending: 0, flushed: 0 });
      const r = await this.flush(uid); return J(r.ok ? { ok: true, pending: 0, flushed: r.flushed || 0 } : r, r.ok ? 200 : 409);
    } catch { return J({ ok: false, error: '미정산 코인을 반영하지 못했습니다. 잠시 후 다시 시도해 주세요.', pending: true }, 409); } }
  // Clients no longer poll /rt/world or /rt/wallet while connected, so this push carries everything a claim changes: the row, the top-20 ranks,
  // and a WALLET_SYNC for third parties whose balance moved (m.sync). A message without kind tells clients to refetch the world (bulk change).
  async httpWorld(req) { let m = null; try { m = await req.json(); } catch { return J({ err: 'json' }, 400); }
    if (m && m.t === 'WORLD_UPDATE' && !m.kind) { this.tapDb(); this.ctx.storage.sql.exec('delete from brd'); const s = JSON.stringify({ t: 'WORLD_UPDATE' }); for (const w of this.socks().keys()) this.tx(w, s); return J({ ok: true, n: this.socks().size }); } // bulk change: the room's boards are read again
    if (!m || m.t !== 'WORLD_UPDATE' || (m.kind !== 'BILLBOARD' && m.kind !== 'PLOT') || !m.data || typeof m.data !== 'object') return J({ err: 'world' }, 400);
    if (m.kind === 'BILLBOARD') { this.tapDb(); if (brdRow(m.data)) this.brdPut(m.data, Date.now()); else this.ctx.storage.sql.exec('delete from brd where slot = ?', String(m.data.slot_id || '')); } // a row without holder and clock: read it again
    const msg = { t: 'WORLD_UPDATE', kind: m.kind, data: m.data }; this.pushEv(msg); const s = JSON.stringify(Array.isArray(m.ranks) ? { ...msg, ranks: m.ranks } : msg); for (const w of this.socks().keys()) this.tx(w, s);
    for (const id of Array.isArray(m.sync) ? m.sync : []) this.walletSync(String(id));
    const take = m.take;
    if (take && take.victim) {
      this.markDisp(take.victim);
      this.bc({ t: 'TAKE', victim: String(take.victim).slice(0, 80), attacker: clip(take.attacker, 16), slot: String(take.slot || '').slice(0, 16), name: clip(take.name, 24), price: Math.floor(Number(take.price) || 0), line1: clip(take.line1, 16), line2: clip(take.line2, 16), line3: clip(take.line3, 16), emoji: clip(take.emoji, 4), theme: clip(take.theme, 32), color: clip(take.color, 9) });
      const note = { t: 'INBOX', kind: 'taken', slot_id: String(take.slot || '').slice(0, 16), from_name: clip(take.attacker, 12) };
      for (const [sock, peer] of this.socks()) if (peer.q && peer.k === String(take.victim)) this.tx(sock, note);
    }
    if (m.mono) this.bc({ t: 'MONO', name: clip(m.mono, 24) });
    return J({ ok: true, n: this.socks().size }); }
  walletSync(uid) { let n = 0; for (const [w, b] of this.socks()) if (b.k === uid) { this.tx(w, { t: 'WALLET_SYNC' }); n++; } return n; }
  httpSync(req) { return J({ ok: true, n: this.walletSync(String(req.headers.get('x-uid') || '')) }); }
  async httpAir(req) { let m = null; try { m = await req.json(); } catch { return J({ err: 'json' }, 400); }
    const until = Math.floor(Number(m?.until));
    const nick = clip(m?.nick, 16);
    const line = clip(m?.line, 24);
    if (!nick || !line || !Number.isInteger(until) || until < Date.now() || until > Date.now() + 120000) return J({ err: 'air' }, 400);
    this.airShow = { nick, line, until };
    this.bc({ t: 'AIR', nick, line, until });
    return J({ ok: true }); }
  // A new 오늘의 소원 for the boards in this room (from POST /rt/wish). Nothing is stored here; the next /rt/world carries it too.
  async httpWish(req) { let m = null; try { m = await req.json(); } catch { return J({ err: 'json' }, 400); }
    const w = m?.w, id = String(w?.id || ''); if (m?.t !== 'WISH' || !/^[0-9a-z]{10}$/.test(id)) return J({ err: 'wish' }, 400);
    this.bc({ t: 'WISH', w: { id, nick: clip(w.nick, 16), txt: clip(w.txt, WISH.maxLen), hearts: Math.max(0, Math.floor(Number(w.hearts)) || 0) } }); return J({ ok: true }); }
  stkRead(slot) { this.tapDb(); const row = this.ctx.storage.sql.exec('select g from stk where slot = ?', slot).toArray()[0]; if (!row) return []; try { return stickerNext(JSON.parse(row.g), '', 'set'); } catch { return []; } }
  stkWrite(slot, list) { const q = this.ctx.storage.sql; if (!list.length) q.exec('delete from stk where slot = ?', slot); else q.exec('insert into stk(slot, g) values(?, ?) on conflict(slot) do update set g = excluded.g', slot, JSON.stringify(list)); }
  stkAll() { this.tapDb(); const out = []; for (const row of this.ctx.storage.sql.exec('select slot, g from stk').toArray()) { let list = []; try { list = stickerNext(JSON.parse(row.g), '', 'set'); } catch { list = []; } if (SLOT_RE.test(String(row.slot)) && list.length) out.push({ slot: String(row.slot), list }); } return out; }
  async httpSticker(req) { let m = null; try { m = await req.json(); } catch { return J({ err: 'json' }, 400); }
    const slot = String(m?.slot || ''); if (!SLOT_RE.test(slot)) return J({ err: 'slot' }, 400);
    const op = m?.op === 'pop' || m?.op === 'set' ? m.op : 'add';
    const cur = this.stkRead(slot);
    let list = cur;
    if (op === 'pop') { if (!cur.length) return J({ ok: false, error: 'empty', list: cur }, 400); list = stickerNext(cur, '', 'pop'); }
    else if (op === 'set') list = stickerNext(m?.list, '', 'set');
    else { list = stickerNext(cur, String(m?.glyph || ''), 'add'); if (list.length === cur.length) return J({ ok: false, error: 'full', list: cur }, 400); }
    this.stkWrite(slot, list); this.bc({ t: 'STK', slot, list }); return J({ ok: true, list }); }
  chrAdd(slot) { this.tapDb(); const q = this.ctx.storage.sql; const row = q.exec('select n from chr where slot = ?', slot).toArray()[0]; const n = (row ? Number(row.n) : 0) + 1; q.exec('insert into chr(slot, n) values(?, ?) on conflict(slot) do update set n = excluded.n', slot, n); return n; }
  chrSet(slot, n) { this.tapDb(); const q = this.ctx.storage.sql; const row = q.exec('select n from chr where slot = ?', slot).toArray()[0]; const next = cheerCount(row ? row.n : 0, n); if (next < 1) return 0; q.exec('insert into chr(slot, n) values(?, ?) on conflict(slot) do update set n = excluded.n', slot, next); return next; }
  chrAll() { this.tapDb(); const out = []; for (const row of this.ctx.storage.sql.exec('select slot, n from chr').toArray()) if (SLOT_RE.test(String(row.slot)) && Number(row.n) > 0) out.push({ slot: String(row.slot), n: Number(row.n) }); return out; }
  announceCheer(slot, n, phrase) {
    const p = Math.floor(Number(phrase));
    if (n > 0) this.bc({ t: 'CHEER_HIT', slot, n, ...(p >= 1 && p <= 12 ? { p } : {}) });
  }
  async httpCheer(req) { let m = null; try { m = await req.json(); } catch { return J({ err: 'json' }, 400); }
    const slot = String(m?.slot || ''); if (!SLOT_RE.test(slot)) return J({ err: 'slot' }, 400);
    const n = m?.op === 'set' ? this.chrSet(slot, m.n) : this.chrAdd(slot);
    this.announceCheer(slot, n, m?.p); return J({ ok: true, n }); }
  shareCheer(slot, phrase) {
    const names = squareTopics(this.topicName || 'chapel:square');
    const mine = this.topicName || names[0];
    const send = (name, body) => this.env.ROOM.get(this.env.ROOM.idFromName(name)).fetch(new Request('https://room.internal/chr', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).then((r) => r.json()).catch(() => null);
    if (mine === names[0]) {
      const n = this.chrAdd(slot);
      this.announceCheer(slot, n, phrase);
      for (const name of names.slice(1)) send(name, { op: 'set', slot, n, p: phrase });
      return;
    }
    send(names[0], { op: 'add', slot, p: phrase }).then((data) => {
      const n = Math.floor(Number(data?.n)) || 0;
      if (n < 1) return;
      this.chrSet(slot, n);
      this.announceCheer(slot, n, phrase);
      for (const name of names) if (name !== mine && name !== names[0]) send(name, { op: 'set', slot, n, p: phrase });
    });
  }
  httpFever(req) { const uid = String(req.headers.get('x-uid') || '').slice(0, 80); if (!uid) return J({ err: 'auth' }, 401); return J({ ok: true, gauge: this.bumpFeverCount(uid) }); }
  async loadProf(uid) {
    try {
      const hit = await this.acct().profileOf(uid);
      if (hit && (hit.av === 1 || hit.av === 2 || hit.av === 3)) return { av: speciesOf(hit.av), equip: equipList(hit.equip) };
    } catch { /* a meter without the cache still lets the socket open */ }
    const key = this.env?.FLUSH_KEY;
    if (typeof key !== 'string' || !key) return null;
    try {
      const rpc = await supabaseRpc('profile_read', { p_key: key, p_actor_id: uid });
      if (!rpc.ok || !rpc.data || rpc.data.ok === false || rpc.data.species == null) return null;
      const prof = normProf(rpc.data);
      try { await this.acct().profilePut(uid, prof.av, prof.equip); } catch { /* this socket keeps the copy */ }
      return prof;
    } catch { return null; }
  }
  async httpProfile(req) {
    const uid = String(req.headers.get('x-uid') || '').slice(0, 80);
    if (!uid) return J({ ok: false }, 401);
    let body = null;
    try { body = await req.json(); } catch { return J({ err: 'json' }, 400); }
    const prof = { av: speciesOf(body?.av ?? body?.species), equip: equipList(body?.equip) };
    for (const [w, a] of this.socks()) if (a.k === uid) {
      a.prof = prof;
      if (a.m) {
        if (a.m.equip === 'taxi' || a.m.seat === 'taxi') a.m.seat = 'taxi';
        a.m.av = prof.av;
        a.m.equip = prof.equip;
        this.save(w, a);
        if (a.q) this.bc({ t: 'pj', k: a.k, m: a.m });
      } else this.save(w, a);
    }
    return J({ ok: true });
  }
  scan(force) { const now = Date.now(); if (!force && now - this.lastScan < SCAN) return; this.lastScan = now;
    for (const [w, a] of [...this.socks()]) { const ar = this.ctx.getWebSocketAutoResponseTimestamp(w)?.getTime() || 0;
      if (now - Math.max(a.ls, ar, a.t) > STALE) { try { w.close(4000, 'stale'); } catch { } this.gone(w); } } }
  meter(force) { const now = Date.now(); if (!force && now - this.lastRep < REP) return; this.lastRep = now;
    const n = this.msgs / 20 + this.conns, awake = this.lastRep0 ? Math.min(now - this.lastRep0, 2 * REP) / 1000 : 1; this.lastRep0 = now; this.msgs = 0; this.conns = 0;
    this.env.METER.get(this.env.METER.idFromName('day')).add(n, awake * MEM).then(r => this.setLvl(r.lvl)).catch(() => { }); }
  setLvl(l) { if (l === this.lvl) return; this.lvl = l; this.bc({ t: 'cfg', lean: l >= 1 });
    if (l >= 2) for (const w of this.socks().keys()) { this.tx(w, { t: 'down' }); try { w.close(4002, 'budget'); } catch { } } }
  leaveK(k, skip) { for (const [w, a] of this.socks()) if (w !== skip && a.q && a.k === k && a.m) return; this.bc({ t: 'pl', k }); }
  gone(w) { const a = this.socks().get(w); if (!a) return; this.socks().delete(w); if (a.q) { if (a.m) this.leaveK(a.k, w); this.promote(); } else this.waitMsgs(); }
  // position relay: same floor + within NEAR_R gets every update; far/unknown peers get at most one per FAR_MS per sender (+ every stop),
  // so ghosts never drift far. v2 sockets get the compact form {t:'P',k,a:[x,y,face,anim,fl,vx,vy]}, legacy sockets the old {t:'b',e:'pos',p}.
  relayPos(w, a, P) { if (Array.isArray(P)) P[4] = 0; const [x, y, face, anim, fl, vx, vy] = P, now = Date.now(); a.fl = 0; a.m = Object.assign(a.m || {}, { x, y, face, anim, fl: 0 });
    // Attachment is only for wake-after-hibernation. Live relay uses memory. 30s keeps a runner inside NEAR_R (80m) and cuts rows_written 15x.
    if (now - (a.sv || 0) > 30000) { a.sv = now; this.save(w, a); }
    const far = anim !== 'walk' || now - (a.fz || 0) >= FAR_MS; if (far) a.fz = now; let sc = null, sl = null;
    for (const [x2, b] of this.socks()) { if (x2 === w || !b.q || b.lob) continue; b.fl = 0; if (b.m) b.m.fl = 0; if (b.fl != null && a.fl != null && b.fl !== a.fl) continue;
      const bm = b.m, near = !bm || bm.x == null || (Math.abs(bm.x - x) <= NEAR_R && Math.abs(bm.y - y) <= NEAR_R); if (!near && !far) continue;
      if (b.v2) this.tx(x2, sc ||= JSON.stringify({ t: 'P', k: a.k, a: [x, y, face, anim, fl, vx, vy] }));
      else this.tx(x2, sl ||= JSON.stringify({ t: 'b', e: 'pos', p: { id: a.k, x, y, face, anim, fl, vx, vy } })); } }
  async webSocketMessage(w, msg) { this.msgs++; const a = this.socks().get(w); if (!a || typeof msg !== 'string' || msg.length > 4000) return; a.ls = Date.now();
    let m; try { m = JSON.parse(msg); } catch { return; }
    if (m.t === 'p' && a.q && Array.isArray(m.a) && m.a.length <= 8) this.relayPos(w, a, posOf(m.a));
    else if (m.t === 'MINE' && a.q) { const gained = this.addMine(a, m.amount, m.nick); this.tx(w, gained > 0 ? { t: 'PAY', kind: 'mine', amount: gained } : { t: 'PAY', kind: 'mine', amount: 0, why: gained < 0 ? 'soon' : 'cap' }); }
    else if (m.t === 'BONUS' && a.q) await this.bonus(w, a, String(m.kind || ''), m.amount, m.nick);
    else if (m.t === 'SESS' && a.q) this.sess(w, a, m);
    else if (m.t === 'PICK' && a.q) this.pick(a);
    else if (m.t === 'FARE' && a.q) this.fare(w, a, m);
    else if (m.t === 'QUEST' && a.q) this.quest(w, a, m);
    else if (m.t === 'CHEER' && a.q) await this.cheer(w, a, m);
    else if (m.t === 'REPLY' && a.q) await this.replyCheer(w, a, m);
    else if (m.t === 'DRAW_CHECK' && a.q) await this.drawCheck(w, a);
    else if (m.t === 'FEVER' && a.q) { this.tx(w, { t: 'FEVER', until: this.startFever(a.k) }); }
    else if (m.t === 'REV' && a.q) { const until = this.startRevenge(a.k); this.tx(w, { t: 'REV', until: until || 0 }); }
    else if (m.t === 'ADCLICK' && a.q) this.adClick(w, a, m.nick, String(m.slot || ''));
    else if (m.t === 'E' && a.q) { const e = m.e; if (Number.isInteger(e) && e >= 1 && e <= 4) { this.bc({ t: 'E', k: a.k, e }, w); this.pushEv({ t: 'E', k: a.k, e }); } }
    else if (m.t === 'b' && a.q) { const e = String(m.e || ''), p = m.p && typeof m.p === 'object' ? m.p : {}, now = Date.now();
      if (e === 'pos') this.relayPos(w, a, posOf([p.x, p.y, p.face, p.anim, p.fl, p.vx, p.vy]));
      else if (RELAY.includes(e)) { // no free text: only the game's own broadcasts, numeric fields, identity from the verified token, RELAY_N per RELAY_MS
        if (now - (a.bt || 0) > RELAY_MS) { a.bt = now; a.bn = 0; }
        if (++a.bn <= RELAY_N) { const P = { id: a.k }; for (const f of ['seed', 'i', 'r']) if (Number.isFinite(p[f])) P[f] = p[f]; this.bc({ t: 'b', e, p: P }, w); } } }
    else if (m.t === 'tr' && m.m && typeof m.m === 'object' && JSON.stringify(m.m).length < 1500) { const M = m.m, keep = ['name', 'outfit', 'av', 'equip', 'rank', 'fl', 'x', 'y', 'face', 'anim', 'st', 'seat', 'g', 'hair', 'dong', 'shard', 'act', 'at', 'seat_id', 'look', 'state', 'step', 'mode', 'joined_at'];
      a.m = { id: a.k }; for (const f of keep) if (M[f] !== undefined) a.m[f] = M[f]; if (a.prof) { if (M.equip === 'taxi') a.m.seat = 'taxi'; a.m.av = a.prof.av; a.m.equip = a.prof.equip; } if (!a.welcomed && typeof M.name === 'string' && M.name.trim()) { a.welcomed = true; this.bc({ t: 'WELCOME', name: M.name.trim().slice(0, 16) }); } if (typeof a.m.name === 'string') a.m.name = a.m.name.slice(0, 12); a.m.fl = 0; a.fl = 0; this.save(w, a); if (a.q) this.bc({ t: 'pj', k: a.k, m: a.m }); }
    else if (m.t === 'ut') { a.m = null; this.save(w, a); if (a.q) this.leaveK(a.k, w); }
    this.scan(); this.meter(); }
  noteGhost(w) {
    const a = this.socks().get(w);
    const raw = a?.m && typeof a.m.name === 'string' ? a.m.name.trim() : '';
    if (!raw) return;
    const pkt = ghostPacket({ name: raw, x: a.m.x, y: a.m.y });
    if (!pkt.name) return;
    const now = Date.now();
    if (!this.ghosts) this.ghosts = [];
    this.ghosts = this.ghosts.filter((g) => now - g.at < 600000);
    this.ghosts.push({ name: pkt.name, k: a.k, x: pkt.x, y: pkt.y, at: now });
    if (this.ghosts.length > 8) this.ghosts.splice(0, this.ghosts.length - 8);
    this.bc(pkt, w);
  }
  ghostJoin() {
    const now = Date.now();
    if (!this.ghosts?.length) return [];
    this.ghosts = this.ghosts.filter((g) => now - g.at < 600000);
    return this.ghosts.slice(-8).map((g) => ghostPacket(g));
  }
  async webSocketClose(w, code) { this.noteGhost(w); this.gone(w); try { w.close(code === 1005 ? 1000 : code, 'bye'); } catch { } }
  async webSocketError(w) { this.gone(w); }
  stats() { this.tapDb(); return { live: this.adm(), wait: this.waiters().length, lvl: this.lvl, tapPending: this.tapN, flushes: this.flushes || 0, flushErr: this.flushErr || null, hist: this.hist ? this.hist.length : null, v2: [...this.socks().values()].filter(a => a.v2).length }; }
}

// q5 VAPID web push (payload-less). Public key is public; the private JWK lives only in the Worker secret VAPID_PRIV.
const VAPID_PUB = 'BLw-Ohwbu6DrhQF2m-FwsmMo41N8gYElXddgqaHosG5GHBCnsp1S7IkDL4GSMNcIxPBomsaVWDOVVuI4g3vn-Kw', PUSH_HOSTS = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[\w.-]+\.notify\.windows\.com|web\.push\.apple\.com|[\w.-]+\.push\.apple\.com)$/;
const PUSH_N = 40; // Workers Free: 50 subrequests per invocation
const kstDay = (t = Date.now()) => new Date(t + 9 * 36e5).toISOString().slice(0, 10);
const dayShift = (day, n) => new Date(Date.parse(day) + n * 864e5).toISOString().slice(0, 10);
const isoWeek = (t = Date.now()) => { const d = new Date(t + 9 * 36e5), w = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), dn = (w.getUTCDay() + 6) % 7; w.setUTCDate(w.getUTCDate() - dn + 3); const y = w.getUTCFullYear(), f = new Date(Date.UTC(y, 0, 4)); return y + 'W' + String(1 + Math.round(((w - f) / 864e5 - 3 + ((f.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0'); };
const tribePoints = (mask) => { const m = Number(mask) || 0; return Math.min(7, (m & 1 ? 1 : 0) + (m & 2 ? 1 : 0) + (m & 4 ? 5 : 0)); };
let VK = null;
async function vapidAuth(env, endpoint) { if (!env.VAPID_PRIV) return null; if (!VK || VK.raw !== env.VAPID_PRIV) VK = { raw: env.VAPID_PRIV, k: await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIV), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) };
  const enc = o => b64e(new TextEncoder().encode(JSON.stringify(o))), h = enc({ typ: 'JWT', alg: 'ES256' }), p = enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://studio.wishboard.workers.dev' });
  const g = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, VK.k, new TextEncoder().encode(h + '.' + p))); return `vapid t=${h}.${p}.${b64e(g)}, k=${VAPID_PUB}`; }
function cat(...parts) { const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', key, ikm));
  const mac = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', mac, cat(info, new Uint8Array([1])))).slice(0, len);
}
// RFC 8291 aes128gcm. A WebCrypto failure returns null so the caller skips the send and leaves the inbox row.
async function encryptPush(sub, bytes) {
  try {
    const asKey = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const uaPub = b64u(sub.p256dh || sub.keys?.p256dh || '');
    const auth = b64u(sub.auth_key || sub.auth || sub.keys?.auth || '');
    const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKey.privateKey, 256));
    const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', asKey.publicKey));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const ikm = await hkdf(auth, shared, cat(new TextEncoder().encode('WebPush: info'), new Uint8Array([0]), uaPub, asPub), 32);
    const cek = await hkdf(salt, ikm, cat(new TextEncoder().encode('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
    const nonce = await hkdf(salt, ikm, cat(new TextEncoder().encode('Content-Encoding: nonce'), new Uint8Array([0])), 12);
    const aes = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, cat(bytes, new Uint8Array([2]))));
    const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
    return cat(salt, rs, new Uint8Array([asPub.length]), asPub, cipher);
  } catch { return null; }
}
function pushText(row) {
  const slot = slotName(String(row?.slot_id || ''));
  const name = clip(row?.from_name, 12);
  if (row?.kind === 'taken') return `${name}님이 ${josa(slot, '을', '를')} 가져갔어요`;
  if (row?.kind === 'cheer') return CHEER_PHRASES[Math.floor(Number(row.phrase)) - 1] || '';
  if (row?.kind === 'dark') return row.stage ? darkText(row.stage, row.slot_id, row.h) : `${slot} 불이 곧 꺼져요`; // stage: the registry's notices; none: the (paid-plan) cron
  if (row?.kind === 'gift') return `${name}님이 전광판을 선물했어요`;
  if (row?.kind === 'tribe') return '이번 주 소속 결과가 나왔어요';
  if (row?.kind === 'ball') return '21시 볼 드랍이 곧 시작돼요';
  if (row?.kind === 'wish') { const n = Math.floor(Number(row.n)) || 0; return n <= 1 ? '내 소원에 첫 하트가 왔어요' : `내 소원이 하트 ${n}개를 받았어요`; }
  if (row?.kind === 'wishwin') return `어제 소원이 ${Math.max(1, Math.floor(Number(row.rank)) || 1)}위였어요. +${Math.max(0, Math.floor(Number(row.prize)) || 0)}코인이 들어왔어요`;
  if (row?.kind === 'invite') return `초대한 친구가 소원을 걸었어요. +${Math.max(0, Math.floor(Number(row.amount)) || 0)}코인이 들어왔어요`;
  return '';
}
// Where a notification click lands (same origin, validated ids only); '' leaves it to the service worker's default '/'.
function pushUrl(row) {
  const slot = String(row?.slot_id || ''), wid = String(row?.wid || '');
  if ((row?.kind === 'taken' || row?.kind === 'dark') && SLOT_RE.test(slot)) return '/?focus=' + slot;
  if ((row?.kind === 'wish' || row?.kind === 'wishwin') && WISH_ID.test(wid)) return '/?wish=' + wid;
  return '';
}
function speciesOf(id) {
  const n = Math.floor(Number(id));
  return n === 2 || n === 3 ? n : 1;
}
function levelOf(rep) {
  const n = Math.max(0, Math.floor(Number(rep) || 0));
  return Math.min(99, 1 + Math.floor(n / 10));
}
function equipList(raw) {
  const src = Array.isArray(raw) ? raw : String(raw || '').split(',');
  const out = [];
  for (const item of src) {
    const id = String(item || '');
    if (!/^[a-z0-9_]{1,40}$/.test(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length === 4) break;
  }
  return out;
}
function normProf(data) {
  const reputation = Math.max(0, Math.floor(Number(data?.reputation) || 0));
  return { av: speciesOf(data?.species), equip: equipList(data?.equip), reputation, level: levelOf(reputation) };
}
async function publishProfile(env, actorId) {
  const rpc = await supabaseRpc('profile_read', { p_key: env.FLUSH_KEY || '', p_actor_id: actorId });
  if (!rpc.ok || !rpc.data || rpc.data.ok === false || rpc.data.species == null) return null;
  const prof = normProf(rpc.data);
  try { await acct(env).profilePut(actorId, prof.av, prof.equip); } catch { /* the room push still carries this copy */ }
  try {
    const room = await acct(env).roomOf(actorId);
    if (room) await env.ROOM.get(env.ROOM.idFromName(room)).fetch(new Request('https://room.internal/profile', { method: 'POST', headers: { 'x-uid': actorId, 'content-type': 'application/json' }, body: JSON.stringify(prof) }));
  } catch { /* the next entry reads the five-minute cache */ }
  return prof;
}
async function profileApi(req, env, u, ctx) {
  const actor = await resolveActor(env, tokenOf(req));
  if (!actor) return J({ err: 'auth' }, 401);
  if (u.pathname === '/rt/profile' && req.method === 'GET') {
    const rpc = await supabaseRpc('profile_read', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id });
    if (!rpc.ok || !rpc.data || rpc.data.ok === false || rpc.data.species == null) return J({ err: 'profile' }, 502);
    const prof = normProf(rpc.data);
    const color = /^#[0-9a-fA-F]{6}$/.test(String(rpc.data.color || '')) ? String(rpc.data.color) : '';
    const streak = Math.max(0, Math.floor(Number(rpc.data.streak) || 0));
    const attendLast = /^\d{4}-\d{2}-\d{2}/.test(String(rpc.data.attend_last || '')) ? String(rpc.data.attend_last).slice(0, 10) : '';
    return J({ level: prof.level, reputation: prof.reputation, species: prof.av, equip: prof.equip, owned: equipList(rpc.data.owned), starter: rpc.data.starter === true, streak, ...(attendLast ? { attend_last: attendLast } : {}), ...(color ? { color } : {}) });
  }
  if (u.pathname === '/rt/profile' && req.method === 'POST') {
    if (!env.FLUSH_KEY) return J({ err: 'profile' }, 503);
    const b = await readJson(req);
    if (!b || (b.species == null && typeof b.nickname !== 'string' && typeof b.color !== 'string')) return J({ err: 'profile' }, 400);
    const out = {};
    if (b.species != null) {
      const species = speciesOf(b.species);
      const rpc = await supabaseRpc('save_species', { p_key: env.FLUSH_KEY, p_actor_id: actor.id, p_species: species });
      if (!rpc.ok || rpc.data?.ok === false) return J({ ok: false, error: rpc.data?.error || 'profile' }, rpc.ok ? 400 : 502);
      const prof = await publishProfile(env, actor.id);
      out.species = prof?.av || species;
    }
    if (typeof b.nickname === 'string') {
      const nick = clip(b.nickname, 16);
      if (!nick || rejectedCopy(nick) || botNick(nick)) return J({ ok: false, error: '그 이름은 쓸 수 없어요' }, 400);
      const rpc = await supabaseRpc('set_nickname', { p_key: env.FLUSH_KEY, p_actor_id: actor.id, p_nickname: nick });
      if (!rpc.ok || rpc.data?.ok === false) return J({ ok: false, error: '이름을 저장하지 못했어요' }, rpc.ok ? 400 : 502);
      out.nickname = rpc.data?.nickname || nick;
      try { ctx?.waitUntil?.(Promise.resolve().then(() => lgM(env).lgNick(isoWeek(), actor.id, out.nickname)).then(lgDrop).catch(() => null)); } catch { /* the week's list shows the new name at the next spend */ }
      try { await invalidateWorld(env, ctx); } catch { /* the next world read still picks up the name */ }
    }
    if (typeof b.color === 'string') {
      const color = String(b.color).trim().toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(color)) return J({ ok: false, error: '색을 고르지 못했어요' }, 400);
      const rpc = await supabaseRpc('set_ring_color', { p_key: env.FLUSH_KEY, p_actor_id: actor.id, p_color: color });
      if (!rpc.ok || rpc.data?.ok === false) return J({ ok: false, error: '색을 저장하지 못했어요' }, rpc.ok ? 400 : 502);
      out.color = rpc.data?.color || color;
    }
    return J({ ok: true, ...out });
  }
  if (u.pathname === '/rt/equip' && req.method === 'POST') {
    if (!env.FLUSH_KEY) return J({ ok: false, error: 'missing' }, 503);
    const b = await readJson(req);
    const id = String(b?.cosmetic_id || '');
    if (!/^[a-z0-9_]{1,40}$/.test(id)) return J({ ok: false, error: 'missing' }, 400);
    const rpc = await supabaseRpc('equip_cosmetic', { p_key: env.FLUSH_KEY, p_actor_id: actor.id, p_cosmetic_id: id });
    if (!rpc.ok || !rpc.data) return J({ ok: false, error: 'missing' }, 502);
    if (rpc.data.ok === false) return J({ ok: false, error: rpc.data.error || 'missing' }, 400);
    await publishProfile(env, actor.id);
    return J({ ok: true });
  }
  return J({ err: 'method' }, 405);
}
async function inboxList(req, env) {
  const actor = await resolveActor(env, tokenOf(req)); if (!actor) return J({ err: 'auth' }, 401);
  const rpc = await supabaseRpc('inbox_list', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id });
  const rows = Array.isArray(rpc.data?.items) ? rpc.data.items : [];
  const items = rows.slice(0, 20).map((row) => ({ id: row.id, kind: row.kind, slot_id: row.slot_id ?? null, phrase: row.phrase ?? null, from_name: row.from_name ?? null, from: row.from ?? null, created_at: row.created_at, ...(typeof row.read === 'boolean' ? { read: row.read } : {}) })); // read: after the 2026-11-21 migration
  return J({ items });
}
async function inboxRead(req, env) {
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const actor = await resolveActor(env, tokenOf(req)); if (!actor) return J({ err: 'auth' }, 401);
  const b = await readJson(req); if (!b || !Array.isArray(b.ids)) return J({ err: 'ids' }, 400);
  const ids = b.ids.map((n) => Math.floor(Number(n))).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50);
  const rpc = await supabaseRpc('inbox_read', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_ids: ids });
  if (!rpc.ok || rpc.data?.ok === false) return J({ ok: false }, rpc.ok ? 400 : 502);
  return J({ ok: true });
}
function pushHostOk(endpoint) { try { const x = new URL(endpoint); return x.protocol === 'https:' && PUSH_HOSTS.test(x.hostname) && String(endpoint).length < 600; } catch { return false; } }
const GRP = { at: 0, w: '', v: null };
const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...h } });
let GATE = { at: 0, r: null }; // per-isolate meter cache: /rt/gate no longer costs one Meter RPC per call
const GATE_TTL = 15000, PC = new Map(); // PC: per-isolate world cache (Cache API is a no-op on *.workers.dev)
const HERE = new Map(); // GET /rt/here: { at, v } per topic, 5 s per isolate
const WORLD_CACHE = 'https://cache.masil/rt/world';
const SLOT_RE = /^(MAIN_(UP|TOP|MID|BOT|LOW)|SUB_[1-4][AB]|STREET_([1-9]|[12]\d|30)|PLOT_([1-9]|1[0-8]))$/;
const AD_SLOT = SLOT_RE;
const REPORT_REASONS = ['abuse', 'ad', 'impersonation', 'other'];
function clip(s, n) { return Array.from(String(s ?? '').replace(/[\u0000-\u001f]/g, '')).slice(0, n).join(''); }
function playerErr(code, fallback) {
  const map = {
    holder: '이 칸의 주인만 할 수 있어요. 다른 계정으로 점령했다면 그 계정으로 들어오세요.',
    edit: '지금 가진 칸의 문구만 고칠 수 있어요.',
    blocked: '그 문구는 올릴 수 없어요.',
    empty: '서버가 결과를 주지 않았어요. 잠시 뒤 다시 해 주세요.',
    tag: '그 소속 이름은 쓸 수 없어요.',
    id: '소속 링크가 맞지 않아요.',
    slot: '그 자리는 없어요.',
    auth: '입장한 뒤에 할 수 있어요.',
    relight: '불을 켜지 못했어요.',
    tribe: '이미 소속이 있거나, 소속에 들어간 뒤에만 할 수 있어요.',
  };
  const text = String(code || '');
  return map[text] || text || fallback;
}
function tokenOf(req) { const a = req.headers.get('authorization') || ''; return a.startsWith('Bearer ') ? a.slice(7).trim() : ''; }
function hexColor(s, d) { const t = String(s || '').trim(); return /^#[0-9a-fA-F]{3,8}$/.test(t) ? t : d; }
function extUrl(s) { if (s == null || s === '') return null; const t = String(s).trim().slice(0, 200); try { const x = new URL(t); return x.protocol === 'https:' ? t : null; } catch { return null; } }
function rejectedCopy(...parts) { return parts.some((part) => blockedText(part)); }
function cachedBoards() {
  const mem = PC.get('world');
  if (!mem?.b) return [];
  try {
    const world = JSON.parse(mem.b);
    return Array.isArray(world?.billboards) ? world.billboards : [];
  } catch { return []; }
}
// Room board rows (brd): trusted for BRD_TTL, a missing one is read with a BRD_MS limit, not again for BRD_FAIL after a failure. Room inbox queue (ibq):
// IBQ_N rows per inbox_batch, kept IBQ_DAYS, IBQ_MAX rows.
const BRD_TTL = 300000, BRD_MS = 2500, BRD_FAIL = 10000, BRD_KEYS = 'slot_id,holder_id,holder_name,line1,line2,line3,lit_until,expires_at', IBQ_N = 100, IBQ_DAYS = 7, IBQ_MAX = 500;
// The fields a cheer reads (holder, clock, lines for a chain #tag), or null for a row that does not carry both the holder and a clock.
function brdRow(b) { if (!b || typeof b !== 'object' || !SLOT_RE.test(String(b.slot_id || '')) || !('holder_id' in b) || !('lit_until' in b || 'expires_at' in b)) return null;
  const o = {}; for (const k of BRD_KEYS.split(',')) o[k] = b[k] ?? null; return o; }
function cachedBoard(slot) {
  const mem = PC.get('world');
  if (!mem?.b) return null;
  try {
    const world = JSON.parse(mem.b);
    if (!world || !Array.isArray(world.billboards)) return null;
    return world.billboards.find((b) => b.slot_id === slot) || null;
  } catch { return null; }
}
async function readJson(req) { const n = Number(req.headers.get('content-length') || 0); if (n > 10000) return null; try { const b = await req.json(); return b && typeof b === 'object' ? b : null; } catch { return null; } }
const acct = env => env.METER.get(env.METER.idFromName('acct'));
async function ipHash(env, req) {
  const ip = req.headers.get('cf-connecting-ip') || 'x';
  const dig = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + String(env.GUEST_KEY || ''))));
  let hex = '';
  for (const b of dig) hex += b.toString(16).padStart(2, '0');
  return hex.slice(0, 16);
}
// Workers Rate Limiting binding (wrangler.jsonc "ratelimits"), keyed by client IP. Counts are per Cloudflare location and approximate. No binding (tests) = no limit.
async function rateOk(rl, req) { return rateKey(rl, req.headers.get('cf-connecting-ip') || 'x'); }
async function rateKey(rl, key) { if (!rl) return true; try { return (await rl.limit({ key })).success !== false; } catch { return true; } }
// WALLET_SYNC to one account, in the room it sits in (two DO calls). For balances moved by somebody else's request.
async function nudge(env, uid) { try { const room = await acct(env).roomOf(uid); if (room) await env.ROOM.get(env.ROOM.idFromName(room)).fetch(new Request('https://room.internal/sync', { method: 'POST', headers: { 'x-uid': uid } })); } catch { } }
function queueTaken(env, ctx, victim, fromName, slotId) {
  if (!victim) return;
  const job = supabaseRpc('inbox_batch', { p_key: env.FLUSH_KEY || '', p_items: [{ kind: 'taken', slot_id: slotId, from_name: clip(fromName, 12), to: String(victim) }] }).catch(() => {});
  try { ctx?.waitUntil?.(job); } catch { /* the claim still stands */ }
  pushNow(env, ctx, String(victim), { kind: 'taken', slot_id: String(slotId || ''), from_name: clip(fromName, 12) });
}
// Immediate web push without the cron. Subscriptions live in the Meter instance 'push' (filled by /rt/push), because Supabase push_subs cannot be read
// per actor with the publishable key. One notice per (actor, kind) per PUSH_GAP; everything runs in waitUntil and never touches the triggering response.
const PUSH_GAP = { taken: 60000, wish: 600000, wishwin: 60000, dark: 1, invite: 60000 }, WISH_PUSH_AT = [1, 3, 5, 10, 20, 30, 50, 100]; // dark: no gap, each notice is once per (slot, lit_until) already
const pushM = env => env.METER.get(env.METER.idFromName('push'));
function pushNow(env, ctx, actorId, note) {
  if (!env?.VAPID_PRIV || !actorId || !PUSH_GAP[note?.kind]) return Promise.resolve();
  const job = (async () => { const P = pushM(env), subs = await P.psDue(String(actorId), note.kind, PUSH_GAP[note.kind], Date.now());
    if (Array.isArray(subs) && subs.length) await sendPushItems(env, subs.map(s => ({ ...note, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth })), e => P.psDrop(e)); })().catch(() => { });
  try { ctx?.waitUntil?.(job); } catch { /* the request already answered */ }
  return job;
}
// 불 꺼지기 전: the Meter instance 'dark' hears every board clock the Worker learns (claim, takeover, starter, tribe, edit, review approval, relight,
// takedown) and sends its own notices from its alarm. A row without a clock leaves the registry as it is.
const darkM = env => env.METER.get(env.METER.idFromName('dark'));
let DSEED = 0; // last world backfill handed to the registry: once per isolate per hour
function darkNote(env, ctx, row) { const slot = String(row?.slot_id || ''), lit = litOf(row); if (!SLOT_RE.test(slot) || (row.holder_id && !lit)) return;
  const job = Promise.resolve().then(() => darkM(env).dkSet(slot, String(row.holder_id || ''), lit, Date.now())).catch(() => { });
  try { ctx?.waitUntil?.(job); } catch { /* the board already changed */ } }
function darkSeed(env, ctx, world) { const now = Date.now(); if (now - DSEED < 3600e3 || !Array.isArray(world?.billboards)) return; DSEED = now;
  const list = world.billboards.filter(b => b?.holder_id && SLOT_RE.test(String(b.slot_id || ''))).map(b => ({ slot: String(b.slot_id), uid: String(b.holder_id), lit: litOf(b) })).filter(b => b.lit > now);
  if (list.length) { try { ctx?.waitUntil?.(Promise.resolve().then(() => darkM(env).dkSeed(list, now)).catch(() => { })); } catch { /* next hour */ } } }
// slot -> { uid, lit } as Supabase has it now, or null when it cannot say.
async function darkBoards(slots) { const ok = slots.filter(s => SLOT_RE.test(s)); if (!ok.length) return new Map();
  const r = await fetch(SUPA + '/rest/v1/billboards?select=slot_id,holder_id,lit_until,expires_at&slot_id=in.(' + ok.join(',') + ')', { headers: { apikey: ANON, accept: 'application/json' } });
  const rows = r.ok ? await r.json() : null; return Array.isArray(rows) ? new Map(rows.map(b => [String(b.slot_id), { uid: String(b.holder_id || ''), lit: litOf(b) }])) : null; }
// One alarm pass's notices [{ u, s, stage, h }]: an immediate push each (url opens the slot) and one inbox_batch with a dark row each (phrase 1 = 6 hours
// before, 2 = dark).
async function darkSend(env, list) { if (!list.length) return; await Promise.all([...list.map(x => pushNow(env, null, x.u, { kind: 'dark', slot_id: x.s, stage: x.stage, h: x.h })),
  supabaseRpc('inbox_batch', { p_key: env.FLUSH_KEY || '', p_items: list.map(x => ({ kind: 'dark', slot_id: x.s, to: x.u, phrase: x.stage === 'out' ? 2 : 1 })) }).catch(() => null)]); }
// Event properties: at most 6 short keys, numbers or strings up to 40 characters.
function evProps(p) { const o = {}; let n = 0; if (p && typeof p === 'object') for (const [k, v] of Object.entries(p)) { if (n >= 6) break; if (!/^[a-z_]{1,16}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) o[k] = v; else if (typeof v === 'string') o[k] = clip(v, 40); else continue; n++; } return n ? JSON.stringify(o) : ''; }
// today = { visitors, wishes } for the boot screen comes from the account registry: one DO call per cache refill (15 s), never per request.
async function readWorld(env) {
  const h = { apikey: ANON, accept: 'application/json' };
  const [bs, ps, rs, tally, live, wish, league] = await Promise.all([
    fetch(SUPA + '/rest/v1/billboards?select=*&slot_id=in.(' + SLOT_IDS.join(',') + ')&order=slot_id.asc', { headers: h }),
    fetch(SUPA + '/rest/v1/plots?select=*&order=plot_id.asc', { headers: h }),
    fetch(SUPA + '/rest/v1/wallets?select=actor_id, nickname, spent, linked&spent=gt.0&order=spent.desc&limit=60', { headers: h }), // 60: room for the 네온봇N rows filtered out below
    Promise.resolve().then(() => acct(env).tallyOf(kstDay())).catch(() => null),
    supabaseRpc('plaza_live', { p_key: env.FLUSH_KEY || '' }).catch(() => null),
    lvlNow(env).then(l => l >= 2 ? (WWLAST.day === kstDay() ? WWLAST.v : null) : wishM(env).wWorld(kstDay()).then(v => { WWLAST = { day: kstDay(), v }; return v; })).catch(() => null), // budget hard: the last copy, no wish-DO call
    Promise.resolve().then(() => leagueWorld(env)).catch(() => null),
  ]);
  if (!bs.ok || !ps.ok) return { err: 'upstream ' + (bs.ok ? ps.status : bs.status) };
  const [billboards, plots, ranks] = await Promise.all([bs.json(), ps.json(), rs.ok ? rs.json() : null]);
  if (!Array.isArray(billboards) || !Array.isArray(plots)) return { err: 'shape' };
  const world = { billboards, plots, ranks: Array.isArray(ranks) ? ranks.filter(r => !botNick(r?.nickname)).slice(0, 20) : [], today: { visitors: Number(tally?.visitors) || 0, wishes: Number(tally?.wishes) || 0 } };
  const row = live?.ok && live.data && typeof live.data === 'object' ? live.data : null;
  if (row?.ops?.id) world.ops = { id: String(row.ops.id), theme: String(row.ops.theme || ''), title: String(row.ops.title || ''), copy: String(row.ops.copy || '') };
  if (row && typeof row.roof === 'string') world.roof = row.roof;
  const ww = wishWorld(wish); if (ww.count || ww.board.length || ww.king) world.wish = ww; // left out while empty or failing: clients read a missing key as { board: [], king: null, count: 0 }
  if (league?.top?.length) world.league = { week: league.week, top: league.top.map(r => ({ nick: clip(r.nick, 16), spent: Math.max(0, Math.floor(Number(r.spent)) || 0) })) }; // also left out while empty
  return { body: JSON.stringify(world), world, ranked: Array.isArray(ranks) };
}
function wishWorld(v) {
  const card = (w) => ({ nick: clip(w?.nick, 16), txt: clip(w?.txt, WISH.maxLen), hearts: Math.max(0, Math.floor(Number(w?.hearts)) || 0) });
  try { return { board: (Array.isArray(v?.board) ? v.board : []).filter(w => WISH_ID.test(String(w?.id || ''))).slice(0, WISH.boardMax).map(w => ({ id: String(w.id), ...card(w) })), king: v?.king ? card(v.king) : null, count: Math.max(0, Math.floor(Number(v?.count)) || 0) }; }
  catch { return { board: [], king: null, count: 0 }; }
}
async function invalidateWorld(env, ctx) {
  PC.delete('world');
  try { await caches.default.delete(new Request(WORLD_CACHE)); } catch { }
  let got = null;
  try {
    got = await readWorld(env); if (!got.body) return null;
    PC.set('world', { at: Date.now(), b: got.body });
    const put = caches.default.put(new Request(WORLD_CACHE), new Response(got.body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + PRAY_TTL } }));
    if (ctx) ctx.waitUntil(put); else await put;
  } catch { }
  return got && got.body ? got : null; // the fresh world, so a claim can push its ranks
}
async function supabaseRpc(name, args) {
  const r = await fetch(SUPA + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(args) });
  const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch { data = { ok: false, error: text.slice(0, 180) }; }
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { } }
  return { ok: r.ok, status: r.status, data };
}
// Free first slots as the database enforces them (starter_slot_list). Per isolate: a good list for 10 minutes. A failure, a missing
// function or no answer in 1.5 s keeps the last good list (or the old four if there never was one) and asks again after 60 s.
// good=false means the list is only the fallback: then the starter claim checks just the STREET_ shape and claim_billboard decides.
let STARTER_C = { at: 0, ttl: 0, list: [...STARTER_DEFAULT], good: false, p: null };
export function starterSlots(env) {
  if (Date.now() - STARTER_C.at < STARTER_C.ttl) return Promise.resolve(STARTER_C);
  if (STARTER_C.p) return STARTER_C.p;
  const ask = supabaseRpc('starter_slot_list', { p_key: env.FLUSH_KEY || '' }).then((r) => (r.ok && r.data?.ok === true ? starterList(r.data.slots) : null), () => null);
  let timer; const late = new Promise((res) => { timer = setTimeout(res, 1500, null); });
  return STARTER_C.p = Promise.race([ask, late]).then((list) => {
    clearTimeout(timer);
    STARTER_C = list ? { at: Date.now(), ttl: 600000, list, good: true, p: null } : { ...STARTER_C, at: Date.now(), ttl: 60000, p: null };
    return STARTER_C;
  });
}
async function settle(env, topic, actorId) {
  const res = await env.ROOM.get(env.ROOM.idFromName(topic)).fetch(new Request('https://room.internal/flush', { method: 'POST', headers: { 'x-uid': actorId } }));
  let data = {}; try { data = await res.json(); } catch { data = { ok: false }; }
  if (!res.ok || data.ok === false) return { ok: false, error: data.error || '미정산 코인을 반영하지 못했습니다. 잠시 후 다시 시도해 주세요.', pending: true };
  return { ok: true, pending: data.pending || 0, flushed: data.flushed || 0 };
}
// Share bonus: once a KST day per account and per address. The record is in the 'acct' instance (promoTake, the address as ipHash, never raw) and
// PROMO is this isolate's copy, checked first. Budget hard, or that call failing: the isolate copy alone, as before. Redeem codes stay in PROMO.
const PROMO = new Map();
async function promo(req, env, u) {
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const actor = await resolveActor(env, tokenOf(req));
  if (!actor) return J({ err: 'auth' }, 401);
  const day = kstDay();
  const ip = req.headers.get('cf-connecting-ip') || 'x';
  if (u.pathname === '/rt/share-bonus') {
    const ak = 's:' + actor.id + ':' + day, ik = 'i:' + ip + ':' + day;
    const had = () => J({ ok: false, error: '오늘은 이미 공유 보너스를 받았어요.' }, 400);
    if (PROMO.get(ak) || PROMO.get(ik)) return had();
    let keys = null; // what was taken in the acct instance, given back if the grant fails
    if (!(await budgetHard(env))) { try { const ks = ['s:' + actor.id, 'i:' + await ipHash(env, req)]; const hit = await acct(env).promoTake(ks, day);
        if (hit !== true) { if (Array.isArray(hit)) { if (hit.includes(ks[0])) PROMO.set(ak, 1); if (hit.includes(ks[1])) PROMO.set(ik, 1); } return had(); } keys = ks; } catch { keys = null; } }
    const rpc = await supabaseRpc('grant_coins', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_amount: 300 }).catch(() => ({ ok: false, data: {} }));
    const data = rpc.data || {};
    if (!rpc.ok || data.ok === false) { if (keys) { try { await acct(env).promoGive(keys, day); } catch { /* today's bonus is lost for this account, never doubled */ } }
      return J({ ok: false, error: data.error || '코인을 넣지 못했습니다.' }, rpc.ok ? 400 : 502); }
    PROMO.set(ak, 1); PROMO.set(ik, 1);
    return J({ ok: true, coins: data.coins, amount: 300 });
  }
  const b = await readJson(req);
  const code = String(b?.code || '').trim();
  if (!/^[A-Za-z0-9]{8,32}$/.test(code)) return J({ ok: false, error: '8자리 코드를 입력하세요.' }, 400);
  const codes = String(env.VIP_CODES || '').split(/[\s,]+/).filter((s) => s.length >= 8);
  if (!codes.includes(code)) return J({ ok: false, error: '코드가 맞지 않아요.' }, 400);
  const key = 'v:' + actor.id + ':' + code;
  if (PROMO.get(key)) return J({ ok: false, error: '이미 사용한 코드예요.' }, 400);
  const rpc = await supabaseRpc('grant_coins', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_amount: 10000 });
  const data = rpc.data || {};
  if (!rpc.ok || data.ok === false) return J({ ok: false, error: data.error || '코인을 넣지 못했습니다.' }, rpc.ok ? 400 : 502);
  PROMO.set(key, 1);
  return J({ ok: true, coins: data.coins, amount: 10000 });
}
// 오늘의 소원 HTTP. State lives in the Meter instance 'wish' (DO SQLite), never in Supabase; prizes go through grant_coins like promo().
const wishM = env => env.METER.get(env.METER.idFromName('wish'));
const WISH_ID = /^[0-9a-z]{10}$/, WISH_PATHS = new Set(['/rt/wishes', '/rt/wish', '/rt/wish/heart', '/rt/wish/report', '/rt/admin/wish', '/rt/admin/wishes']);
const WISHC = { at: 0, day: '', v: null }; // anonymous list, 10 s per isolate; cleared on post / hide
const WONE = new Map(); // single wish by id (share page, ?id=), 10 s per isolate, misses too
let WWLAST = { day: '', v: null }; // the last wWorld answer, served instead of the wish DO while the budget is hard
let WSET = { day: '', at: 0, more: false }; // settlement: once per isolate per day, again every 60 s after a clear refusal or a full batch
const WISH_PAY_N = 3; // prizes paid per settlement run (grant_coins + its push each): the subrequest limit of one invocation
let WFULL = 0; // last full world refill caused by a wish, so a burst of wishes refills at most once per 10 s per isolate
let WLIVE = { at: 0, day: '', v: null }; // rooms with seated accounts (Meter 'acct' liveRooms), 30 s per isolate, for the fresh-wish fan-out
// The shards of topic a fresh wish is sent to: the poster's own room, plus shards the seat registry says someone sits in. A failed lookup: own room only.
async function wishRooms(env, topic) {
  const day = kstDay(); let live = WLIVE.v;
  if (!live || WLIVE.day !== day || Date.now() - WLIVE.at > 30000) { try { live = new Set(await acct(env).liveRooms(day)); WLIVE = { at: Date.now(), day, v: live }; } catch { live = null; } }
  return squareTopics(topic).filter(name => name === topic || (live && live.has(name)));
}
// Wish limits count IP nets (IPv6 by /64). The shared ipHash stays as it is for the other features.
async function wishIp(env, req) {
  const dig = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ipNet(req.headers.get('cf-connecting-ip') || '') + String(env.GUEST_KEY || ''))));
  let hex = ''; for (const b of dig) hex += b.toString(16).padStart(2, '0'); return hex.slice(0, 16);
}
// With req, a cache miss first passes EVENT_RL (random ids must not reach the instance unthrottled): undefined = refused, null = no such wish.
async function wishOne(env, id, req) {
  const hit = WONE.get(id); if (hit && Date.now() - hit.at < 10000) return hit.v;
  if (await lvlNow(env) >= 2) return hit ? hit.v : null; // budget hard: the cached copy of any age, a miss reads as no such wish (no wish-DO call)
  if (req && !(await rateOk(env.EVENT_RL, req))) return undefined;
  const v = await wishM(env).wOne(id); if (WONE.size > 500) WONE.clear(); WONE.set(id, { at: Date.now(), v }); return v;
}
// At most once: wSettle marks a winner paid when it hands it out. Only Supabase's clear refusal (HTTP ok, data.ok === false, e.g. no wallet row yet)
// un-marks it for a later attempt. A thrown fetch, a 5xx or a failed DO call leaves it marked, so a prize is never paid twice.
function wishSettle(env, ctx, day) {
  if (WSET.day === day && (!WSET.more || Date.now() - WSET.at < 60000)) return;
  WSET = { day, at: Date.now(), more: false };
  const job = (async () => { const M = wishM(env), due = await M.wSettle(day, Date.now(), WISH_PAY_N); let more = Array.isArray(due) && due.length >= WISH_PAY_N; // a full batch: the rest 60 s later
    for (const w of Array.isArray(due) ? due : []) {
      try { const rpc = await supabaseRpc('grant_coins', { p_key: env.FLUSH_KEY || '', p_actor_id: w.uid, p_amount: w.prize });
        if (rpc.ok && rpc.data && typeof rpc.data === 'object' && rpc.data.ok === false) { more = true; await M.wUnpay(w.day, w.id); }
        else if (rpc.ok) await pushNow(env, ctx, w.uid, { kind: 'wishwin', rank: w.rank, prize: w.prize, wid: w.id }); } catch { /* unknown outcome: stays paid */ } }
    if (WSET.day === day) WSET.more = more; })().catch(() => { if (WSET.day === day) WSET.more = true; }); // a failed run is tried again 60 s later (payment stays at most once)
  try { ctx?.waitUntil?.(job); } catch { /* the next request retries */ }
}
// The list and single-wish copies always go. full = a wish appeared or disappeared: refill the world once per 10 s per isolate (that refill replaces the
// isolate's world copy). An edit or a throttled change leaves the world copy alone: it shows with the next world read (15 s cache).
function wishFresh(env, ctx, full, id) {
  WISHC.at = 0; if (id) WONE.delete(id); if (!full) return;
  try { if (Date.now() - WFULL >= 10000) { WFULL = Date.now(); ctx?.waitUntil?.(invalidateWorld(env, ctx).catch(() => null)); }
    else ctx?.waitUntil?.(caches.default.delete(new Request(WORLD_CACHE)).catch(() => null)); } catch { }
}
const wishNo = (code, s = 400) => J({ ok: false, code, error: WISH_ERR[code] || WISH_ERR.down }, s);
async function wishPage(req, env, u) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method', { status: 405 });
  const id = u.pathname.slice('/rt/w/'.length); let w = null;
  if (WISH_ID.test(id)) { try { w = await wishOne(env, id, req); } catch { w = null; } }
  if (!w) return Response.redirect(new URL('/' + invTail(u, true), req.url).href, 302);
  const s = wishShareText(w), dest = '/?wish=' + id + invTail(u), title = esc(s.title), desc = esc(w.txt), shot = await snapFor(env, 'wish', id, await wishAuthor(env, id)); // only the author's own shot
  const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>' + title + '</title>'
    + '<meta property="og:title" content="' + title + '">'
    + '<meta property="og:description" content="' + desc + '">'
    + '<meta property="og:image" content="' + esc(new URL(shot ? '/rt/snap/' + shot : '/og.jpg', req.url).href) + '">'
    + '<meta property="og:url" content="' + esc(new URL('/rt/w/' + id, req.url).href) + '">'
    + '<meta name="twitter:card" content="summary_large_image">'
    + '<meta http-equiv="refresh" content="0;url=' + esc(dest) + '">'
    + '<script>location.replace(' + JSON.stringify(dest) + ')</script>'
    + '</head><body><p><a href="' + esc(dest) + '">타임스퀘어에서 이 소원 보기</a></p></body></html>';
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=30' } });
}
async function wishApi(req, env, ctx, u) {
  const day = kstDay(), M = wishM(env), lv = u.pathname.startsWith('/rt/admin/') ? 0 : await lvlNow(env);
  if (u.pathname === '/rt/wishes') {
    if (req.method !== 'GET') return J({ err: 'get' }, 405);
    if (lv >= 2) { const id = String(u.searchParams.get('id') || ''), f = WONE.get(id); // budget hard: copies only, no wish-DO call and no settlement (the next request after the drop settles)
      const v = WISHC.day === day && WISHC.v ? WISHC.v : { day, count: 0, top: [], recent: [], mine: null, left: 0, given: [], yesterday: [] };
      return J({ ...v, ...(f?.v ? { focus: f.v } : {}), busy: true }); }
    wishSettle(env, ctx, day); invRetry(env, ctx, day);
    const tok = tokenOf(req), actor = tok ? await resolveActor(env, tok) : null, id = String(u.searchParams.get('id') || '');
    if (actor && !(await rateOk(env.EVENT_RL, req))) return wishNo('rate', 429);
    try { let v;
      if (actor) v = await M.wList(day, actor.id);
      else { if (WISHC.day !== day || !WISHC.v || Date.now() - WISHC.at > 10000) { WISHC.v = await M.wList(day, ''); WISHC.at = Date.now(); WISHC.day = day; } v = WISHC.v; }
      if (WISH_ID.test(id)) { const f = await wishOne(env, id, actor ? null : req); if (f !== undefined) v = { ...v, focus: f ? { ...f, mine: !!(v.mine && v.mine.id === f.id) } : null }; } // undefined: rate refused, no focus
      return J(v);
    } catch { return J({ err: 'wish' }, 502); }
  }
  if (u.pathname === '/rt/admin/wishes') {
    if (req.method !== 'GET') return J({ err: 'get' }, 405);
    if (!adminOk(env, req)) return J({ err: 'admin' }, 401);
    const d = String(u.searchParams.get('day') || ''), on = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : day;
    try { return J({ ok: true, day: on, wishes: await M.wAdmin(on) }); } catch { return J({ ok: false, err: 'wish' }, 502); }
  }
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  try {
    if (u.pathname === '/rt/admin/wish') {
      if (!adminOk(env, req)) return J({ err: 'admin' }, 401);
      const b = await readJson(req), id = String(b?.id || ''); if (!WISH_ID.test(id) || typeof b.hide !== 'boolean') return J({ ok: false, error: 'id' }, 400);
      const r = await M.wHide(id, b.hide); if (r.locked) return J({ ok: false, code: 'locked', error: '되살릴 수 없는 소원이에요' }, 409);
      if (r.ok) wishFresh(env, ctx, true, id); return J({ ok: !!r.ok }, r.ok ? 200 : 404);
    }
    if (lv >= 2) return wishNo('busy', 503);
    if (!(await rateOk(env.EVENT_RL, req))) return wishNo('rate', 429);
    const actor = await resolveActor(env, tokenOf(req)); if (!actor) return J({ err: 'auth', code: 'auth', error: WISH_ERR.auth }, 401);
    const b = await readJson(req); if (!b) return J({ err: 'json' }, 400);
    if (u.pathname === '/rt/wish') {
      if (!(inviteOn(env) && invCode(b.inv))) wishSettle(env, ctx, day); // a post that runs the invite step leaves the prize settlement to GET /rt/wishes (subrequest budget)
      const fault = wishFault(b.text); if (fault) return wishNo(fault);
      const nick = cleanNick(b.nick ?? b.nickname ?? '') || '네온손님'; if (wishNickFault(nick)) return wishNo('nick');
      const ip = await wishIp(env, req), r = await M.wPost(actor.id, nick, cleanWish(b.text), day, Date.now(), ip); if (!r.ok) return wishNo(r.error || 'already', 409);
      const wc = PC.get('world'); // the world copy before wishFresh drops it, for the invite step
      wishFresh(env, ctx, !!r.fresh, r.wish.id); // an edit (fresh false) reaches boards with the next world read; no refill, no fan-out
      if (inviteOn(env)) { ctx.waitUntil(inviteStep(env, ctx, actor.id, b.inv, !!r.fresh, day, ip, wc, req.headers.get('cf-connecting-ip') || '')); // never part of the answer
        if (!(r.fresh && invCode(b.inv))) invRetry(env, ctx, day, INVITE.payWish); } // one paying step per invocation: the code's own step, or the lazy pass
      const topic = typeof b.topic === 'string' ? b.topic : ''; // at budget lean (lv 1) the fresh wish goes to the poster's own room only
      if (r.fresh && PLAZA_TOPICS.includes(topic)) { const body = JSON.stringify({ t: 'WISH', w: { id: r.wish.id, nick: r.wish.nick, txt: r.wish.txt, hearts: r.wish.hearts } });
        ctx.waitUntil((lv >= 1 ? Promise.resolve([topic]) : wishRooms(env, topic)).then(names => Promise.all(names.map(name => env.ROOM.get(env.ROOM.idFromName(name)).fetch(new Request('https://room.internal/wish', { method: 'POST', headers: { 'content-type': 'application/json' }, body })).catch(() => null)))).catch(() => null)); }
      return J({ ok: true, wish: r.wish, fresh: !!r.fresh });
    }
    const id = String(b.id || ''); if (!WISH_ID.test(id)) return wishNo('gone');
    if (u.pathname === '/rt/wish/heart') { const r = await M.wHeart(actor.id, id, await wishIp(env, req), day); if (!r.ok) return wishNo(r.error);
      if (lv < 1 && r.au && WISH_PUSH_AT.includes(r.hearts)) pushNow(env, ctx, r.au, { kind: 'wish', n: r.hearts, wid: id }); // r.au stays here: the response lists its fields
      return J({ ok: true, hearts: r.hearts, left: r.left }); }
    if (u.pathname === '/rt/wish/report') { const r = await M.wReport(actor.id, id, await wishIp(env, req)); if (!r.ok) return wishNo(r.error); if (r.hidden) wishFresh(env, ctx, true, id); return J({ ok: true, hidden: !!r.hidden }); }
    return J({ err: 'path' }, 404);
  } catch { return wishNo('down', 502); }
}
// 친구 초대. State lives in the Meter instance 'inv', never in Supabase. Payments go through grant_coins at most once each, like the wish prize:
// marked paid when handed out, un-marked only on Supabase's clear refusal (HTTP ok, data.ok === false: no wallet row yet), tried again 60 s apart.
const invM = env => env.METER.get(env.METER.idFromName('inv'));
let INVP = { day: '', at: 0, more: false }; // retries: once per isolate per day, then every 60 s while refused payments wait
// The one budget check of this feature: the guard's level (lvlNow, its isolate reading), hard = 2.
async function budgetHard(env) { try { return (await lvlNow(env)) >= 2; } catch { return false; } }
// The invitee's coarse prefix (invite.js ipWide: IPv6 /48, IPv4 /24), hashed like wishIp, for the INVITE.wideDay cap.
async function wideIp(env, raw) { const dig = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ipWide(raw) + String(env.GUEST_KEY || ''))));
  let hex = ''; for (const b of dig) hex += b.toString(16).padStart(2, '0'); return hex.slice(0, 16); }
// From the isolate's world copy only (no Supabase read): any of ids holds a board it bid for (the free first board, bid 0, does not count), owns a plot,
// or is on the spend ranking.
function invHeld(ids, mem = PC.get('world')) { if (!mem?.b) return false;
  try { const w = JSON.parse(mem.b), s = new Set(ids.map(String)); return (w.billboards || []).some(b => s.has(String(b?.holder_id || '')) && Number(b?.current_bid) > 0) || (w.plots || []).some(p => s.has(String(p?.owner_id || ''))) || (w.ranks || []).some(r => s.has(String(r?.actor_id || ''))); } catch { return false; } }
// Pays what ivHand handed out (at most INVITE.payWish / payMax per invocation) and pushes at most INVITE.pushMax inviters, so one invocation stays
// far under the Workers subrequest limit: a grant whose fetch failed for that reason would count as an unknown outcome and never be retried.
async function invPay(env, ctx, rows) { const M = invM(env); let pushes = 0;
  for (const p of Array.isArray(rows) ? rows.slice(0, INVITE.payMax) : []) {
    try { const rpc = await supabaseRpc('grant_coins', { p_key: env.FLUSH_KEY || '', p_actor_id: p.uid, p_amount: p.amount });
      if (rpc.ok && rpc.data && typeof rpc.data === 'object' && rpc.data.ok === false) { INVP.more = true; let to = '';
        if (String(p.uid).startsWith('guest:')) { try { to = String((await env.METER.get(env.METER.idFromName('ev')).evGroup(p.uid, ''))?.ids?.find(x => String(x).startsWith('user:')) || ''); } catch { /* the merges the inv instance saw still count */ } }
        await M.ivUnpay(p.id, to); continue; } // a guest linked since posting is paid as its user next time
      if (!rpc.ok) continue; // 5xx: unknown outcome, stays paid
      await M.ivDone(p.id, Date.now()); await nudge(env, p.uid);
      if (p.side === 'inviter' && pushes < INVITE.pushMax) { pushes += 1; pushNow(env, ctx, p.uid, { kind: 'invite', amount: p.amount }); } } catch { /* unknown outcome: stays paid */ } } }
// The lazy pass (queue, then due payments), at most once per isolate per day and then every 60 s while something waits. Only with the switch on.
function invRetry(env, ctx, day = kstDay(), budget = INVITE.payMax) {
  if (!inviteOn(env)) return;
  if (INVP.day === day && (!INVP.more || Date.now() - INVP.at < INVITE.retryMs)) return;
  INVP = { day, at: Date.now(), more: false };
  const job = (async () => { if (await budgetHard(env)) { INVP.more = true; return; } // hard: no queue pass and nothing goes out, tried again later
    const r = await invM(env).ivDue(Date.now(), day, budget); if (Number(r?.left) > 0 || r?.more) INVP.more = true; await invPay(env, ctx, r?.due); })().catch(() => { INVP.more = true; });
  try { ctx?.waitUntil?.(job); } catch { /* the next request retries */ }
}
// After a wish post, in waitUntil: notes the poster's IP net and, for a fresh wish that came with a code, judges and pays the invite. Skipped at budget
// level hard. A refusal is silent: the invitee just gets no coins.
async function inviteStep(env, ctx, uid, raw, fresh, day, ip, wc, addr = '') {
  try { const code = fresh ? invCode(raw) : '';
    if (!inviteOn(env) || await budgetHard(env)) return;
    let group = [], old = false;
    if (code) { try { const g = await env.METER.get(env.METER.idFromName('ev')).evGroup(uid, dayShift(day, -INVITE.newDays)); group = Array.isArray(g?.ids) ? g.ids : []; old = !!g?.old; } catch { /* merges the inv instance saw still count */ }
      old = old || invHeld([uid, ...group], wc || PC.get('world')); }
    const r = await invM(env).ivPost({ uid, ip, wide: code ? await wideIp(env, addr) : '', day, now: Date.now(), fresh, code, group, old, budget: code ? INVITE.payWish : 0 });
    if (Number(r?.left) > 0 || r?.more) INVP.more = true; // the next lazy pass picks up what this invocation could not pay
    if (r?.pay?.length) await invPay(env, ctx, r.pay);
  } catch { /* the wish stands either way */ }
}
// GET: the caller's summary with `recent` (payment times). POST: the same, making the code on the first call. Counts and times only, no ids.
async function inviteApi(req, env, ctx) {
  if (!inviteOn(env)) return J({ ok: false, code: 'off' }, 404); // master switch off: nothing touches the inv instance
  if (req.method !== 'GET' && req.method !== 'POST') return J({ err: 'method' }, 405);
  const actor = await resolveActor(env, tokenOf(req)); if (!actor) return J({ err: 'auth' }, 401);
  if (!(await rateOk(env.EVENT_RL, req))) return J({ err: 'rate' }, 429);
  if (await budgetHard(env)) return req.method === 'GET' ? J({ ok: true, busy: true }) : J({ ok: false, code: 'busy' }, 503); // no inv DO call at hard
  const day = kstDay(), ip = await wishIp(env, req); invRetry(env, ctx, day);
  try { const s = req.method === 'POST' ? await invM(env).ivCode(actor.id, ip, day, Date.now()) : await invM(env).ivSum(actor.id, day, true, ip); if (!s) return J({ err: 'auth' }, 401);
    const o = { ok: true, code: invCode(s.code), count: Number(s.count) || 0, today: Number(s.today) || 0, earned: Number(s.earned) || 0, gift: Number(s.gift) || 0 };
    if (Array.isArray(s.recent)) o.recent = s.recent.map(Number).filter(Number.isFinite);
    return J(o); } catch { return J({ ok: false, err: 'invite' }, 502); }
}
// ?inv= on a share page, re-checked, for its redirect into the game ('' when missing or malformed: never reflected as given).
const invTail = (u, first) => { const c = invCode(u.searchParams.get('inv')); return c ? (first ? '?' : '&') + 'inv=' + c : ''; };
// 주간 리그. The tally lives in the Meter instance 'lg': one DO call per spend the Worker mediates, in waitUntil, with the amount the RPC charged;
// refunds subtract. Tribe pledges (refundable, refund_tribe_week does not say to whom) and coins sent to an advertiser are not counted.
const lgM = env => env.METER.get(env.METER.idFromName('lg'));
const LGW = { at: 0, w: '', v: null }; // /rt/world's league part, 60 s per isolate; this isolate's spends clear it
const LGC = { at: 0, w: '', v: null }; // the anonymous /rt/league answer, 10 s per isolate
const LGA = new Map(); let LGG = 0; // a signed-in /rt/league answer per week and account, 10 s per isolate, at most 500; LGG: bumped when it is cleared
const lgDrop = () => { LGW.at = 0; LGC.at = 0; LGA.clear(); LGG++; }; // after a spend, link or withdrawal in this isolate: the next read is fresh
// The nick a spend may write on the public list: '' (keep the stored one) when it is banned or the bots' shape. Sticker and photo routes never check it.
const BOT_NAME_ERR = '그 이름은 쓸 수 없어요. 프로필에서 이름을 바꿔 주세요.'; // claims, plots, air: the name comes from the profile
const leagueNick = (nick) => { const n = clip(nick, 16); return !n || rejectedCopy(n) || botNick(n) ? '' : n; };
function leagueRun(env, ctx, run) {
  const t = Date.now(), job = Promise.resolve().then(() => run(lgM(env), t)).then(lgDrop).catch(() => null);
  try { ctx?.waitUntil?.(job); } catch { /* the spend stands; this week's tally misses it */ }
}
// A spend with no board behind it (plot, sticker, air, photo fee, an S-tier bid held for review). key: remember it for a later refund (lgBack).
function leagueAdd(env, ctx, uid, nick, delta, key = '') {
  const id = String(uid || ''), d = Math.trunc(Number(delta) || 0); if (d <= 0 || !/^(guest|user):/.test(id)) return;
  leagueRun(env, ctx, (M, t) => M.lgAdd(isoWeek(t), id, leagueNick(nick), d, t, leagueCut(t), key));
}
// At the hard budget level the isolate's last copy is all there is (no DO call).
async function leagueWorld(env) {
  const w = isoWeek(), hard = (await lvlNow(env)) >= 2;
  if (!hard && (LGW.w !== w || !LGW.v || Date.now() - LGW.at > 60000)) { const v = await lgM(env).lgWorld(w); LGW.at = Date.now(); LGW.w = w; LGW.v = v; }
  return { week: w, top: LGW.w === w && Array.isArray(LGW.v) ? LGW.v : [] };
}
async function leagueApi(req, env) {
  if (req.method !== 'GET') return J({ err: 'get' }, 405);
  if (!(await rateOk(env.EVENT_RL, req))) return J({ ok: false, err: 'rate' }, 429);
  const tok = tokenOf(req), actor = tok ? await resolveActor(env, tok) : null, now = Date.now(), w = isoWeek(now);
  if ((await lvlNow(env)) >= 2) return LGC.w === w && LGC.v ? J({ ok: true, week: w, ends: weekEnds(now), top: LGC.v.top }) : J({ ok: false, err: 'busy' }, 503); // hard budget: the anonymous copy, no DO call
  try { let v;
    if (actor) { const k = w + '|' + actor.id, hit = LGA.get(k); if (hit && now - hit.at < 10000) v = hit.v; // a token is no way past the memo: one lg-DO call per account per 10 s
      else { const g = LGG; v = await lgM(env).lgTop(w, actor.id); if (g === LGG) { if (LGA.size >= 500) LGA.clear(); LGA.set(k, { at: now, v }); } } } // a spend that landed meanwhile: not kept
    else { if (LGC.w !== w || !LGC.v || now - LGC.at > 10000) { LGC.v = await lgM(env).lgTop(w, ''); LGC.at = now; LGC.w = w; } v = LGC.v; }
    return J({ ok: true, week: w, ends: weekEnds(now), top: v.top, ...(actor ? { me: v.me } : {}) });
  } catch { return J({ ok: false, err: 'league' }, 502); }
}
// Lazy weekly tribe settlement (scheduled stays off on the free plan). No other cron job runs here. Jobs, each once per week across isolates through a
// marker in the 'lg' instance (refund:<week>, roof:<week>):
// - refund: after the KST week rolls over, refund_tribe_week(last week). A refunded row has spent = amount, so a second run pays nothing.
// - roof: after the rollover (Monday to Saturday), award_tribe_roof(last week). A migrated database awards a finished week once (ok / done). The old
//   function answers skipped on any day but Sunday: then this path rests for 6 hours in this isolate, and
// - sun (the old function's own time): Sunday 21:00-23:59 KST, award_tribe_roof(this week). A migrated database answers 'open': fine, not again tonight.
// Until a job is done this isolate asks at most once a minute, once an hour after 3 failures in a row. A function PostgREST does not know is done for the week.
const TSET = { refund: '', roof: '', sun: '', at: 0, fails: 0, rest: 0 };
// At the hard budget level (lvlNow 2) it does nothing and asks again a minute later.
function tribeSettle(env, ctx, now = Date.now()) {
  const prev = isoWeek(now - 7 * 864e5), week = isoWeek(now), dow = kstDow(now), night = dow === 0 && new Date(now + 9 * 36e5).getUTCHours() >= 21;
  const jobs = [];
  if (TSET.refund !== prev) jobs.push(['refund', 'refund_tribe_week', prev]);
  if (dow !== 0 && TSET.roof !== prev && now >= TSET.rest) jobs.push(['roof', 'award_tribe_roof', prev]);
  if (night && TSET.sun !== week) jobs.push(['sun', 'award_tribe_roof', week]);
  if (!jobs.length || now - TSET.at < (TSET.fails >= 3 ? 3600000 : 60000)) return Promise.resolve();
  TSET.at = now;
  const job = (async () => { const M = lgM(env); if ((await lvlNow(env)) >= 2) return;
    for (const [kind, fn, w] of jobs) {
      const k = (kind === 'refund' ? 'refund:' : 'roof:') + w, st = await M.lgOnce(k, now); if (st === 'done') { TSET[kind] = w; continue; } if (st !== 'mine') continue;
      let r = null; try { r = await supabaseRpc(fn, { p_key: env.FLUSH_KEY || '', p_week: w }); } catch { r = null; }
      const d = r?.data && typeof r.data === 'object' ? r.data : {};
      if (r?.ok && d.ok !== false && !d.skipped) { await M.lgDone(k, Date.now()); TSET[kind] = w; TSET.fails = 0; if (kind !== 'refund') PC.delete('world'); continue; }
      await M.lgFree(k);
      if (r?.ok && d.skipped) TSET.rest = Date.now() + 6 * 3600000; // the old award_tribe_roof: not migrated; ask again in 6 h in case the migration runs mid-week
      else if (r?.ok && d.error === 'open') TSET.sun = w; // the migrated one keeps this week open until it is over
      else if (r && !r.ok && /PGRST202|Could not find the function/i.test(JSON.stringify(r.data))) TSET[kind] = w;
      else TSET.fails++;
    } })().catch(() => { });
  try { ctx?.waitUntil?.(job); } catch { /* the next request retries */ }
  return job;
}
// The starter floor. A wallet row starts with STARTER_COINS nobody earned, and sell_coins_to_advertiser and pledge_tribe only refuse an amount larger
// than the balance (row lock, coins >= 0), so a new guest could hand its starting coins to a board holder or a tribe with no link at all. A guest
// (any actor that is not a signed-in account, and an anonymous sign-in) keeps STARTER_COINS: the Worker reads its settled balance and refuses an
// amount that would leave less. Read and spend are two steps, so one account spends through here one at a time: SENDING within this isolate (an
// entry older than SEND_HOLD is dead) and a lease in the 'acct' instance across isolates. The balance is read once before the lease, so a refusal
// costs no Durable Object call, and once more under it. Budget hard, or the lease call failing: this isolate only.
// LINKING / linkHold: a link that is about to move coins holds the account's sends until its take-back is done (see takeBack), and is itself
// refused while a send is under way. Several links of one account may run together.
const SENDING = new Map(), LINKING = new Map(), SEND_HOLD = 15000, SEND_BUSY = '앞선 코인 보내기가 끝난 뒤에 다시 해 주세요.';
const STARTER_ERR = '시작 코인 100은 보낼 수 없어요. 계정을 연결하면 보낼 수 있어요.', STARTER_PLEDGE = '시작 코인 100은 모금할 수 없어요. 계정을 연결하면 모금할 수 있어요.';
const guestLike = (actor) => !String(actor?.id || '').startsWith('user:') || !!actor?.anon;
const sendingHere = (uid, now = Date.now()) => { const t = SENDING.get(uid) || 0; return now >= t && now - t < SEND_HOLD; };
const linkingHere = (uid, now = Date.now()) => { const l = LINKING.get(uid); return !!l && l.n > 0 && now >= l.at && now - l.at < SEND_HOLD; };
// -> a release function, or false while another send or a link of this account is on its way.
async function sendHold(env, uid) {
  const now = Date.now(); if (sendingHere(uid, now) || linkingHere(uid, now)) return false;
  if (SENDING.size >= 5000) SENDING.clear(); SENDING.set(uid, now); let lease = 0;
  const drop = () => { if (SENDING.get(uid) === now) SENDING.delete(uid); };
  try { if (!(await budgetHard(env))) { const t = await acct(env).sellTake(uid, SEND_HOLD); if (t === false) { drop(); return false; } lease = Number(t) || 0; } } catch { lease = 0; }
  return async () => { drop(); if (lease) { try { await acct(env).sellDone(uid, lease); } catch { /* the lease runs out by itself */ } } };
}
// -> a release function, or false while a send of this account is on its way.
async function linkHold(env, uid) {
  const now = Date.now(); if (sendingHere(uid, now)) return false;
  if (LINKING.size >= 5000) LINKING.clear(); const old = LINKING.get(uid), me = linkingHere(uid, now) ? old : { n: 0, at: now }; me.n++; me.at = now; LINKING.set(uid, me); let lease = 0;
  const drop = () => { if (LINKING.get(uid) === me && --me.n <= 0) LINKING.delete(uid); };
  try { if (!(await budgetHard(env))) { const t = await acct(env).linkTake(uid, SEND_HOLD); if (t === false) { drop(); return false; } lease = Number(t) || 0; } } catch { lease = 0; }
  return async () => { drop(); if (lease) { try { await acct(env).linkDone(uid, lease); } catch { /* the lease runs out by itself */ } } };
}
// A wallet's settled coins: a number, 0 for no row (the 100 the wallet route shows for it is display only), null when it cannot be read.
async function coinsOf(uid) {
  try { const s = await fetch(SUPA + '/rest/v1/wallets?select=coins&actor_id=eq.' + encodeURIComponent(uid), { headers: { apikey: ANON, accept: 'application/json' } }); const rows = s.ok ? await s.json() : null;
    if (!Array.isArray(rows)) return null; const n = rows.length ? Number(rows[0]?.coins) : 0; return Number.isFinite(n) ? n : null; } catch { return null; }
}
// One spend of `amount` through the floor: run() is the database call. hold = false leaves a signed-in account as it was (no read, no lease).
// -> run()'s result, or the refusal as a Response: 429 busy, 400 starter (text: the line for this route), 502 when the balance cannot be read.
async function floored(env, actor, amount, hold, text, run) {
  const guest = guestLike(actor); if (!guest && !hold) return run();
  const busy = () => J({ ok: false, code: 'busy', error: SEND_BUSY }, 429);
  const under = async () => { const have = await coinsOf(actor.id); return have === null ? J({ ok: false, error: text.down }, 502) : have - amount < STARTER_COINS ? J({ ok: false, code: 'starter', error: text.starter }, 400) : null; };
  if (sendingHere(actor.id) || linkingHere(actor.id)) return busy();
  if (guest) { const no = await under(); if (no) return no; } // refused before any Durable Object call
  const free = await sendHold(env, actor.id); if (free === false) return busy();
  try { if (guest) { const no = await under(); if (no) return no; } // the balance as it is while nothing else of this account can spend through here
    return await run(); } finally { await free(); }
}
async function plaza(req, env, ctx, u) {
  if (u.pathname === '/rt/world') {
    if (req.method !== 'GET') return J({ err: 'get' }, 405);
    tribeSettle(env, ctx);
    const mem = PC.get('world'); if (mem && Date.now() - mem.at < PRAY_TTL * 1000) return new Response(mem.b, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    const key = new Request(WORLD_CACHE), c = caches.default; let r = await c.match(key);
    if (!r) { const got = await readWorld(env); if (got.err || !got.body) return J({ err: got.err || 'upstream' }, 502); darkSeed(env, ctx, got.world);
      r = new Response(got.body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + PRAY_TTL } }); ctx.waitUntil(c.put(key, r.clone())); }
    const body = await r.text(); if (PC.size > 500) PC.clear(); PC.set('world', { at: Date.now(), b: body });
    return new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  if (u.pathname === '/rt/wallet') {
    if (req.method !== 'GET') return J({ err: 'get' }, 405);
    const actor = await resolveActor(env, tokenOf(req)); if (!actor) return J({ err: 'auth' }, 401);
    const q = u.searchParams.get('actor_id'); if (q && q !== actor.id) return J({ err: 'actor' }, 403);
    const s = await fetch(SUPA + '/rest/v1/wallets?select=actor_id,nickname,coins,vip_tickets,updated_at,linked&actor_id=eq.' + encodeURIComponent(actor.id), { headers: { apikey: ANON, accept: 'application/json' } });
    if (!s.ok) return J({ err: 'upstream ' + s.status }, 502);
    const rows = await s.json(); const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return J({ ok: true, actor_id: actor.id, nickname: '네온손님', coins: 100, vip_tickets: 0, linked: actor.id.startsWith('user:'), exists: false });
    const coins = Number(row.coins); return J({ ok: true, actor_id: row.actor_id, nickname: row.nickname, coins: Number.isFinite(coins) ? coins : 0, vip_tickets: Number(row.vip_tickets) || 0, linked: row.linked === true || actor.id.startsWith('user:'), exists: true });
  }
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const actor = await resolveActor(env, tokenOf(req)); if (!actor) return J({ err: 'auth' }, 401);
  const b = await readJson(req); if (!b) return J({ err: 'json' }, 400);
  const topic = typeof b.topic === 'string' ? b.topic : '';
  if (!PLAZA_TOPICS.includes(topic)) return J({ ok: false, error: '광장 접속 정보가 없습니다. 다시 입장한 뒤 시도해 주세요.', pending: true }, 400);
  // An edit with the same bid costs nothing, so edits (a raise of one's own bid too) are spaced per account before any Durable Object call; a claim or
  // takeover is never slowed. A refusal above this line does not count; one after settle does.
  if (u.pathname === '/rt/claim-billboard' && b.mode === 'edit' && gapHit('edit:' + actor.id)) return J({ ok: false, error: GAP_ERR }, 429);
  const settled = await settle(env, topic, actor.id);
  if (!settled.ok) return J({ ok: false, error: settled.error, pending: true }, 409);
  const nick = clip(b.nickname || b.nick || '', 16) || '네온손님';
  if (u.pathname === '/rt/flush-wallet') {
    const s = await fetch(SUPA + '/rest/v1/wallets?select=coins&actor_id=eq.' + encodeURIComponent(actor.id), { headers: { apikey: ANON, accept: 'application/json' } });
    const rows = s.ok ? await s.json() : [];
    const coins = Number(Array.isArray(rows) ? rows[0]?.coins : 0) || 0;
    return J({ ok: true, coins, flushed: settled.flushed || 0 });
  }
  if (u.pathname === '/rt/spend') {
    const kind = String(b.kind || '');
    const pay = String(b.pay || 'coins');
    const glyph = String(b.glyph || '');
    const line = clip(b.line || '', 24);
    let coins = 0, tickets = 0;
    if (kind === 'wash') {
      const slot = String(b.slot_id || '');
      if (!SLOT_RE.test(slot)) return J({ ok: false, error: '전광판 슬롯이 올바르지 않습니다.' }, 400);
      const holder = String((await snapBoard(slot, true))?.holder_id || ''); // one fresh row: an isolate copy may still show the previous holder
      if (!holder || holder !== actor.id) return J({ ok: false, error: '내 전광판만 씻을 수 있어요.' }, 400);
      const peeled = await pushSticker(env, topic, { op: 'pop', slot });
      if (!peeled.ok) return J({ ok: false, error: '지울 스티커가 없어요.' }, 400);
      return J({ ok: true, kind: 'wash', slot_id: slot, list: peeled.list || [] });
    }
    if (kind === 'sticker') {
      const slot = String(b.slot_id || '');
      if (!stickerNext([glyph], '', 'set').length) return J({ ok: false, error: '그 스티커는 없어요.' }, 400);
      if (!SLOT_RE.test(slot)) return J({ ok: false, error: '전광판 슬롯이 올바르지 않습니다.' }, 400);
      const added = await pushSticker(env, topic, { op: 'add', slot, glyph });
      if (!added.ok) return J({ ok: false, error: added.error === 'full' ? '이 전광판 스티커가 가득 찼어요.' : '스티커를 붙이지 못했어요.' }, 400);
      const spentSt = await supabaseRpc('spend_plaza', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_coins: 30, p_tickets: 0 });
      const paidSt = spentSt.data || {};
      if (!spentSt.ok || paidSt.ok === false) {
        await pushSticker(env, topic, { op: 'pop', slot }).catch(() => {});
        return J({ ok: false, error: paidSt.error || '코인을 쓰지 못했어요.' }, spentSt.ok ? 400 : 502);
      }
      leagueAdd(env, ctx, actor.id, nick, 30);
      return J({ ok: true, kind: 'sticker', glyph, slot_id: slot, list: added.list || [], remaining_coins: paidSt.remaining_coins ?? null, vip_tickets: paidSt.vip_tickets ?? null });
    } else if (kind === 'air') {
      if (!line) return J({ ok: false, error: '전광판에 올릴 한 줄을 적어 주세요.' }, 400);
      if (rejectedCopy(nick, line)) return J({ ok: false, error: 'blocked' }, 400);
      if (botNick(nick)) return J({ ok: false, error: BOT_NAME_ERR }, 400);
      if (pay === 'ticket') tickets = 1;
      else coins = 5000;
    } else return J({ ok: false, error: '그 금액은 쓸 수 없어요.' }, 400);
    const spent = await supabaseRpc('spend_plaza', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_coins: coins, p_tickets: tickets });
    const paid = spent.data || {};
    const missing = /schema cache|Could not find the function/i.test(String(paid.message || paid.error || spent.data || ''));
    if (!spent.ok || paid.ok === false) return J({ ok: false, error: paid.error || (missing ? '코인 사용이 아직 준비 중이에요.' : '코인을 쓰지 못했어요.') }, spent.ok ? 400 : 502);
    if (kind === 'air') {
      leagueAdd(env, ctx, actor.id, nick, coins);
      const until = Date.now() + 60000;
      try {
        for (const name of squareTopics(topic)) {
          await env.ROOM.get(env.ROOM.idFromName(name)).fetch(new Request('https://room.internal/air', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nick, line, until }) }));
        }
      } catch { /* the buyer still applies the response locally */ }
      return J({ ok: true, kind: 'air', remaining_coins: paid.remaining_coins ?? null, vip_tickets: paid.vip_tickets ?? null, until, nick, line });
    }
    return J({ ok: false, error: '그 금액은 쓸 수 없어요.' }, 400);
  }
  const claim = u.pathname === '/rt/claim-billboard';
  const sell = u.pathname === '/rt/sell-coins';
  let rpc, mode = 'claim', sip = null;
  if (sell) {
    const slot = String(b.slot_id || '');
    const amount = Math.floor(Number(b.amount));
    if (!SLOT_RE.test(slot)) return J({ ok: false, error: '전광판 슬롯이 올바르지 않습니다.' }, 400);
    if (![10, 20, 50].includes(amount)) return J({ ok: false, error: '10, 20, 50코인만 팔 수 있어요.' }, 400);
    // A guest sends only what it holds above the starting coins (see floored), read after settle so coins a room still held are in the row. An
    // account sends any amount it has, but one send at a time and never while one of its links is moving coins (the same lease).
    rpc = await floored(env, actor, amount, true, { starter: STARTER_ERR, down: '판매를 처리하지 못했습니다.' }, () => supabaseRpc('sell_coins_to_advertiser', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_nickname: nick, p_slot_id: slot, p_amount: amount }));
    if (rpc instanceof Response) return rpc;
    const data = rpc.data || {};
    // The function's own refusals (HTTP 200, ok:false) are lines written for the player. Anything else is a database or gateway message: logged, not shown.
    if (!rpc.ok) { console.warn('sell_coins_to_advertiser', rpc.status, String(data.message || data.error || '').slice(0, 200)); return J({ ok: false, error: '판매를 처리하지 못했습니다.' }, 502); }
    if (data.ok === false) return J({ ok: false, error: String(data.error || '') || '판매를 처리하지 못했습니다.' }, 400);
    try { await env.ROOM.get(env.ROOM.idFromName(topic)).fetch(new Request('https://room.internal/sync', { method: 'POST', headers: { 'x-uid': actor.id } })); } catch { }
    if (data.buyer_id) ctx.waitUntil(nudge(env, String(data.buyer_id))); // the board holder's balance rose too
    return J({ ok: true, remaining_coins: data.remaining_coins ?? null, buyer_name: data.buyer_name || '', slot_id: slot, amount });
  }
  if (claim) {
    const slot = String(b.slot_id || ''); if (!SLOT_RE.test(slot)) return J({ ok: false, error: '전광판 슬롯이 올바르지 않습니다.' }, 400);
    mode = ['claim', 'edit', 'starter', 'tribe'].includes(b.mode) ? b.mode : 'claim';
    if (mode === 'starter') {
      if (b.bid !== 0) return J({ ok: false, error: 'starter' }, 400);
      const sc = await starterSlots(env); // without a list from the database, claim_billboard is the only judge
      if (sc.good ? !sc.list.includes(slot) : !/^STREET_\d+$/.test(slot)) return J({ ok: false, error: '무료 칸은 계정당 한 번이고, 비어 있는 거리 칸만 돼요' }, 400);
      let held = false;
      try {
        const s = await fetch(SUPA + '/rest/v1/billboards?select=holder_id&slot_id=eq.' + encodeURIComponent(slot), { headers: { apikey: ANON, accept: 'application/json' } });
        const rows = s.ok ? await s.json() : [];
        held = !!(Array.isArray(rows) && rows[0]?.holder_id);
      } catch { held = true; }
      if (held) return J({ ok: false, error: '이 칸에는 주인이 있어요. 불이 꺼진 칸은 그 사람이 다시 켤 수 있어요' }, 400);
    } else if (mode === 'edit') {
      if (!Number.isInteger(b.bid) || b.bid < 0 || b.bid > 1000000000) return J({ ok: false, error: '입찰 금액이 올바르지 않습니다.' }, 400);
    } else if (!Number.isInteger(b.bid) || b.bid < 1 || b.bid > 1000000000) return J({ ok: false, error: '입찰 금액이 올바르지 않습니다.' }, 400);
    if ((mode === 'claim' || mode === 'starter' || mode === 'tribe') && auctionClosed(slot, Date.now())) return J({ ok: false, error: '메인 타워는 밤 9시부터 10분 동안만 점령할 수 있어요' }, 400);
    if (mode === 'starter' && !String(actor.id).startsWith('user:')) {
      let hello = false;
      try { hello = await env.ROOM.get(env.ROOM.idFromName(topic)).hasHello(actor.id); } catch { hello = false; }
      if (!hello) return J({ ok: false, error: '무료 칸은 광장에 연결된 뒤에 열려요. 잠시 뒤 다시 눌러 주세요' }, 400);
    }
    const theme = String(b.bg_theme || '');
    if (rejectedCopy(nick, b.line1, b.line2, b.line3)) return J({ ok: false, error: 'blocked' }, 400);
    if (botNick(nick)) return J({ ok: false, error: BOT_NAME_ERR }, 400);
    if (mode === 'starter') { // one atomic take of today's 3 per IP; given back below if the claim is refused
      try { sip = { h: await ipHash(env, req), d: kstDay() }; if (!(await acct(env).sipTake(sip.h, sip.d, 3))) return J({ ok: false, error: '오늘 무료 점령은 이 연결에서 세 번까지예요' }, 400); } catch { sip = null; }
    }
    rpc =await supabaseRpc('claim_billboard', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_nickname: nick, p_slot_id: slot, p_bid: b.bid, p_line1: clip(b.line1, 16), p_line2: clip(b.line2, 16), p_line3: clip(b.line3, 16), p_emoji: clip(b.emoji || '✨', 4) || '✨', p_bg_theme: /^[\w-]{1,32}$/.test(theme) ? theme : 'cyber_navy', p_text_color: hexColor(b.text_color, '#ffffff'), p_external_url: allowedLink(b.external_url), p_caption_y: Math.min(88, Math.max(12, Math.round(Number(b.caption_y) || 72))), p_mode: mode })
      .catch(async (e) => { if (sip) await acct(env).sipGive(sip.h, sip.d).catch(() => {}); throw e; }); // a network throw gives the take back too
  } else {
    if (!Number.isInteger(b.plot_id) || b.plot_id < 1 || b.plot_id > 18) return J({ ok: false, error: '토지 번호가 올바르지 않습니다.' }, 400);
    if (rejectedCopy(nick, b.sign_text)) return J({ ok: false, error: 'blocked' }, 400);
    if (botNick(nick)) return J({ ok: false, error: BOT_NAME_ERR }, 400);
    rpc = await supabaseRpc('buy_or_upgrade_plot', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_nickname: nick, p_plot_id: b.plot_id, p_sign_text: clip(b.sign_text, 14), p_theme_color: hexColor(b.theme_color, '#00ffcc') });
  }
  const data = rpc.data || {};
  const claimErr = data.error === 'tribe' ? '소속에 들어간 뒤에 소속 코인으로 걸 수 있어요' : data.error === 'starter' ? '무료 칸은 계정당 한 번이고, 비어 있는 거리 칸만 돼요' : playerErr(data.error, data.message || '요청을 처리하지 못했습니다.');
  if (!rpc.ok || data.ok === false) {
    if (sip) { try { await acct(env).sipGive(sip.h, sip.d); } catch { } }
    return J({ ok: false, error: claimErr }, rpc.ok ? 400 : 502);
  }
  if (claim && data.review_id) {
    if (mode === 'claim') leagueAdd(env, ctx, actor.id, nick, b.bid, 'r:' + data.review_id); // an S-tier bid is charged now and held for review; a rejection refunds it
    try { await env.ROOM.get(env.ROOM.idFromName(topic)).fetch(new Request('https://room.internal/sync', { method: 'POST', headers: { 'x-uid': actor.id } })); } catch { }
    return J({ ok: true, review_id: data.review_id, remaining_coins: data.remaining_coins ?? null });
  }
  const kind = claim ? 'BILLBOARD' : 'PLOT'; const row = claim ? data.billboard : data.plot;
  if (!row || typeof row !== 'object') return J({ ok: false, error: 'empty' }, 502);
  // The week's tally, one DO call: the 80% the RPC hands back to the board's previous holder comes off the week that bid was tallied in, then a claim
  // adds its bid, an edit only its raise past the recorded bid (a tribe claim charges the tribe, a free one nothing). A plot adds its old price
  // (the RPC doubles it).
  if (claim) { const holder = mode === 'tribe' ? String(row.holder_id || '') : actor.id, sl = String(row.slot_id || b.slot_id || ''), prev = String(data.prev_holder_id || ''), back = Math.floor(Number(data.refund) || 0);
    leagueRun(env, ctx, (M, t) => M.lgBoard(sl, isoWeek(t), t, leagueCut(t), holder, leagueNick(nick), mode, b.bid, prev, back)); }
  else leagueAdd(env, ctx, actor.id, nick, Math.floor(Number(row.price) / 2));
  if (claim && mode !== 'edit' && row.photo_id) {
    try { await supabaseRpc('clear_billboard_photo', { p_key: env.FLUSH_KEY || '', p_slot_id: row.slot_id }); } catch { /* the screen still drops the photo below */ }
    row.photo_id = null;
    row.photo_status = null;
  }
  if (claim) {
    darkNote(env, ctx, row); // any mode: a takeover replaces the old holder's row, an edit with the same holder and clock keeps it
    try { await acct(env).wish(kstDay()); } catch { }
    if (mode !== 'edit') await adSoon(ctx, () => adM(env).adClaim(row.slot_id, String(row.holder_id || actor.id), String(data.prev_holder_id || ''))); // a new holder's report starts now
    if (mode === 'claim' || mode === 'starter' || mode === 'tribe') {
      try { await env.METER.get(env.METER.idFromName('ev')).touch(isoWeek(), actor.id); } catch { }
    }
    if (mode === 'claim' || mode === 'tribe') {
      try { ctx.waitUntil(noteTribe(env, topic, actor.id, 4)); } catch { /* the room keeps the day's score */ }
    }
  }
  let fresh = null; try { fresh = await invalidateWorld(env, ctx); } catch { }
  let broadcast = false;
  let feverGauge = 0;
  try {
    const buyer = claim && mode === 'tribe' ? String(row.holder_id || actor.id) : actor.id;
    const take = claim && data.prev_holder_id && data.prev_holder_id !== buyer ? { victim: data.prev_holder_id, attacker: nick, slot: row.slot_id, name: slotName(row.slot_id), price: Number(data.reclaim_bid) || 0, line1: data.prev_line1, line2: data.prev_line2, line3: data.prev_line3, emoji: data.prev_emoji, theme: data.prev_theme, color: data.prev_color } : null;
    if (take) queueTaken(env, ctx, take.victim, nick, row.slot_id);
    // A claim also moves other wallets: the plot owner's 50% share of a plot-front board, and a pending-photo refund to the previous holder.
    const owner = claim && row.plot_id != null ? fresh?.world.plots.find(p => p.plot_id === row.plot_id)?.owner_id : null;
    const sync = claim ? [data.prev_holder_id, owner].filter(id => id && id !== actor.id) : [];
    const ranks = claim && fresh?.ranked ? fresh.world.ranks : undefined;
    const hard = await budgetHard(env); // budget hard: the sockets were closed when the level was set; no shard fan-out (the world copy above is still refilled)
    for (const name of hard ? [] : squareTopics(topic)) {
      try { // one shard failing must not keep the update from the shards after it
        const br = await env.ROOM.get(env.ROOM.idFromName(name)).fetch(new Request('https://room.internal/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: 'WORLD_UPDATE', kind, data: row, ranks, sync, take, mono: data.monopoly_name || '' }) }));
        broadcast = broadcast || br.ok;
      } catch { /* that room misses this row; its cheers read the board again after BRD_TTL */ }
    }
    await env.ROOM.get(env.ROOM.idFromName(topic)).fetch(new Request('https://room.internal/sync', { method: 'POST', headers: { 'x-uid': actor.id } }));
    if (claim) {
      try {
        const fr = await env.ROOM.get(env.ROOM.idFromName(topic)).fetch(new Request('https://room.internal/fever', { method: 'POST', headers: { 'x-uid': actor.id } }));
        const body = await fr.json();
        const n = Math.floor(Number(body?.gauge));
        if (Number.isInteger(n) && n > 0) feverGauge = n;
      } catch { /* the gauge follows the next fare */ }
    }
  } catch { broadcast = false; }
  return J({ ok: true, kind, data: row, remaining_coins: data.remaining_coins ?? null, broadcast, ...(feverGauge ? { fever: feverGauge } : {}) });
}
// Photo billboards (operator-approved). The holder uploads a browser re-encoded JPEG (≤300 KB, EXIF already gone);
// Supabase keeps the bytes in billboard_photos (no public read) and charges the tier fee in the same RPC.
// Players only receive approved photos from /rt/photo/<id>; the Worker secret ADMIN_KEY unlocks review.
const PHOTO_MAX = 300000, PHOTO_ID_RE = /^[0-9a-f]{40}$/, PHOTO_GAP = 10000, PHOTO_TTL = 300000;
const PHOTO_C = new Map(), PHOTO_AT = new Map();
// Per-account gaps for free repeats (/rt/claim-billboard mode 'edit', /rt/relight): one per key per 3 s per isolate. true = too soon; otherwise recorded.
const LIT_MS = 72 * 3600e3; // the lifetime a claim or a relight gives a board (schema.sql: now() + interval '72 hours')
const EDIT_GAP = 3000, EDIT_AT = new Map(), GAP_ERR = '조금만 천천히요. 3초 뒤에 다시 해 주세요.';
function gapHit(k) { const now = Date.now(); if (now - (EDIT_AT.get(k) || 0) < EDIT_GAP) return true; if (EDIT_AT.size >= 5000) EDIT_AT.clear(); EDIT_AT.set(k, now); return false; }
async function pushSticker(env, topic, body) {
  const names = squareTopics(topic);
  const send = (name, payload) => env.ROOM.get(env.ROOM.idFromName(name)).fetch(new Request('https://room.internal/stk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }));
  let primary; try { primary = await send(names[0], body); } catch { return { ok: false, error: 'room' }; }
  let data = {}; try { data = await primary.json(); } catch { data = {}; }
  if (!primary.ok || data.ok === false) return { ok: false, error: data.error || 'room', list: data.list || [] };
  const set = { op: 'set', slot: body.slot, list: data.list || [] };
  await Promise.all(names.slice(1).map((name) => send(name, set).catch(() => {})));
  return { ok: true, list: data.list || [] };
}
function squareTopics(topic) {
  const m = /^(chapel(?:qa)?):square(?:-(\d+))?$/.exec(topic || '');
  if (!m) return topic ? [topic] : ['chapel:square'];
  const base = m[1] + ':square';
  const out = [base];
  for (let i = 2; i <= 8; i++) out.push(base + '-' + i);
  return out;
}
const PLAZA_TOPICS = squareTopics('chapel:square').concat(squareTopics('chapelqa:square'));
async function readBody(req, max) {
  if (Number(req.headers.get('content-length') || 0) > max) return null;
  try { const t = await req.text(); if (t.length > max) return null; const b = JSON.parse(t); return b && typeof b === 'object' ? b : null; } catch { return null; }
}
function unb64(s) { const t = atob(s), u8 = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u8[i] = t.charCodeAt(i); return u8; }
function b64of(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
// Re-emits a baseline/progressive JPEG without APP1–APP13/APP15 (EXIF, GPS, XMP, ICC, maker notes) and COM segments.
function jpegClean(u8) {
  if (u8.length < 12 || u8[0] !== 0xff || u8[1] !== 0xd8) return null;
  const keep = [u8.subarray(0, 2)]; let i = 2, w = 0, h = 0, sos = false;
  while (i + 4 <= u8.length) {
    if (u8[i] !== 0xff) return null;
    const m = u8[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xda) { sos = true; keep.push(u8.subarray(i)); break; }
    if ((m >= 0xd0 && m <= 0xd9) || m === 0x01) { i += 2; continue; }
    const len = (u8[i + 2] << 8) | u8[i + 3]; if (len < 2 || i + 2 + len > u8.length) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { if (len < 8) return null; h = (u8[i + 5] << 8) | u8[i + 6]; w = (u8[i + 7] << 8) | u8[i + 8]; }
    if (!((m >= 0xe1 && m <= 0xed) || m === 0xef || m === 0xfe)) keep.push(u8.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  if (!sos || !w || !h) return null;
  const out = new Uint8Array(keep.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of keep) { out.set(p, o); o += p.length; }
  return { bytes: out, w, h };
}
const OPS_THEMES = new Set(['csat', 'xmas', 'newyear', 'seollal', 'valentine']);
function isoDay(v) {
  const s = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const t = Date.parse(s + 'T00:00:00Z');
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== s) return '';
  return s;
}
function kstDow(now = Date.now()) { return new Date(now + 9 * 3600000).getUTCDay(); }
function adminOk(env, req) {
  const want = env.ADMIN_KEY, got = req.headers.get('x-admin-key') || '';
  if (typeof want !== 'string' || want.length < 12 || got.length !== want.length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}
async function noteTribe(env, topic, uid, bit) {
  if (!env?.ROOM || !uid || !PLAZA_TOPICS.includes(topic)) return;
  const n = Math.floor(Number(bit));
  if (n !== 1 && n !== 2 && n !== 4) return;
  try {
    await env.ROOM.get(env.ROOM.idFromName(topic)).fetch(new Request('https://room.internal/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-uid': String(uid) },
      body: JSON.stringify({ bit: n }),
    }));
  } catch { /* the score waits for the next visit */ }
}
function tribeId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[bytes[i] % 36];
  return s;
}
async function tribeApi(req, env, u, ctx) {
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const actor = await resolveActor(env, tokenOf(req));
  if (!actor) return J({ err: 'auth' }, 401);
  const b = await readJson(req);
  if (!b) return J({ err: 'json' }, 400);
  if (u.pathname === '/rt/tribe/pledge') {
    const amount = Math.floor(Number(b.amount));
    const slot = String(b.slot || '');
    if (amount !== 10 && amount !== 20 && amount !== 50) return J({ ok: false, error: 'amount' }, 400);
    if (!SLOT_RE.test(slot)) return J({ ok: false, error: 'slot' }, 400);
    if (PLAZA_TOPICS.includes(b.topic)) {
      const settled = await settle(env, b.topic, actor.id);
      if (!settled.ok) return J({ ok: false, error: settled.error, pending: true }, 409);
    }
    // A guest pledges only what it holds above the starting coins, like a coin send and under the same hold (see floored); an account as before.
    const rpc = await floored(env, actor, amount, false, { starter: STARTER_PLEDGE, down: '모금하지 못했어요.' }, () => supabaseRpc('pledge_tribe', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_slot_id: slot, p_amount: amount, p_week: isoWeek() }));
    if (rpc instanceof Response) return rpc;
    const data = rpc.data || {};
    if (!rpc.ok) { console.warn('pledge_tribe', rpc.status, String(data.message || data.error || '').slice(0, 200)); return J({ ok: false, error: '모금하지 못했어요.' }, 502); } // a database message is logged, not shown
    const pledgeErr = data.error === 'tribe' ? '소속에 들어간 뒤에 모금할 수 있어요' : data.error === 'amount' ? '10, 20, 50코인만 모을 수 있어요' : data.error === 'week' ? '이번 주 모금을 열지 못했어요' : (String(data.error || '') || '모금하지 못했어요.');
    if (data.ok === false) return J({ ok: false, error: pledgeErr }, 400);
    return J({ ok: true, tribe_id: data.tribe_id, amount: data.amount });
  }
  if (b.look) {
    await tribeSettle(env, ctx); // last week's refund (and Sunday night's roof) before the sheet reads the tribe's coins
    const rpc = await supabaseRpc('my_tribe', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id });
    const data = rpc.data || {};
    if (!rpc.ok || data.ok === false) return J({ ok: false, error: data.error || '소속을 불러오지 못했어요' }, rpc.ok ? 400 : 502);
    let pending = 0;
    try {
      const room = await acct(env).roomOf(actor.id);
      if (room) {
        const got = await env.ROOM.get(env.ROOM.idFromName(room)).fetch(new Request('https://room.internal/score', { method: 'POST', headers: { 'x-uid': actor.id, 'content-type': 'application/json' }, body: JSON.stringify({ look: true }) }));
        const body = await got.json();
        pending = Math.max(0, Math.floor(Number(body?.pending) || 0));
      }
    } catch { /* the saved week score still shows */ }
    return J({ ok: true, tribe_id: data.tribe_id || null, tag: data.tag || '', role: data.role || '', coins: Number(data.coins) || 0, points: (Number(data.points) || 0) + pending, members: Array.isArray(data.members) ? data.members : [] });
  }
  if (typeof b.tag === 'string' && b.tag.trim()) {
    const tag = b.tag.replace(/^#/, '').slice(0, 16);
    if (!/^[0-9A-Za-z가-힣_]{1,16}$/.test(tag) || blockedText(tag)) return J({ ok: false, error: 'tag' }, 400);
    let last = { ok: false, error: 'id' };
    for (let i = 0; i < 4; i++) {
      const rpc = await supabaseRpc('create_tribe', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_id: tribeId(), p_tag: tag });
      last = rpc.data || {};
      if (rpc.ok && last.ok !== false) return J({ tribe_id: last.tribe_id, tag: last.tag });
      if (last.error !== 'id') break;
    }
    return J({ ok: false, error: playerErr(last.error, '소속을 만들지 못했어요') }, 400);
  }
  const id = String(b.id || '');
  if (!/^[a-z0-9]{8}$/.test(id)) return J({ ok: false, error: 'id' }, 400);
  const rpc = await supabaseRpc('join_tribe', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_id: id });
  const data = rpc.data || {};
  if (!rpc.ok || data.ok === false) return J({ ok: false, error: playerErr(data.error, data.message || '가입하지 못했어요.') }, rpc.ok ? 400 : 502);
  return J({ tribe_id: data.tribe_id, tag: data.tag });
}
async function relightBoard(req, env, ctx) {
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const actor = await resolveActor(env, tokenOf(req));
  if (!actor) return J({ err: 'auth' }, 401);
  const b = await readJson(req);
  if (!b) return J({ err: 'json' }, 400);
  const slot = String(b.slot || b.slot_id || '');
  if (!SLOT_RE.test(slot)) return J({ ok: false, error: 'slot' }, 400);
  if (gapHit('relight:' + actor.id)) return J({ ok: false, error: GAP_ERR }, 429); // a same-day relight is free: spaced per account before the RPC and any DO call
  const rpc = await supabaseRpc('relight_billboard', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_slot_id: slot });
  const data = rpc.data || {};
  if (!rpc.ok || data.ok === false) return J({ ok: false, error: playerErr(data.error, data.message || '불을 켜지 못했어요') }, rpc.ok ? 400 : 502);
  // A repeat on the same KST day: relight_billboard leaves the clock. The clock moved when the answer says scored, or (a database without that key) its
  // lit_until is within 2 minutes of now + 72 h. Neither: nothing changed, so no board read, ledger note, touch or room is told.
  const moved = data.scored === true || Math.abs(Date.parse(String(data.lit_until || '')) - (Date.now() + LIT_MS)) < 120000;
  if (!moved) return J({ ok: true, lit_until: data.lit_until, lit_days: data.lit_days, scored: false });
  try { await env.METER.get(env.METER.idFromName('ev')).touch(isoWeek(), actor.id); } catch { /* the light already moved */ }
  if (data.scored === true) {
    const lightTopic = PLAZA_TOPICS.includes(b.topic) ? b.topic : 'chapel:square';
    try { ctx.waitUntil(noteTribe(env, lightTopic, actor.id, 2)); } catch { /* the room keeps the day's score */ }
  }
  try {
    const s = await fetch(SUPA + '/rest/v1/billboards?select=*&slot_id=eq.' + encodeURIComponent(slot), { headers: { apikey: ANON, accept: 'application/json' } });
    const rows = s.ok ? await s.json() : [];
    const row = Array.isArray(rows) ? rows[0] : null;
    const topic = PLAZA_TOPICS.includes(b.topic) ? b.topic : 'chapel:square';
    if (row) { darkNote(env, ctx, row); await announce(env, ctx, squareTopics(topic), actor.id, row); }
  } catch { /* the caller still has lit_until */ }
  return J({ ok: true, lit_until: data.lit_until, lit_days: data.lit_days, scored: data.scored === true });
}
// GET /rt/ad-report?slot=: the holder's own numbers (Meter 'ad', adreport.js). The holder is read from Supabase every time, never the isolate copy:
// a stale copy could show the last minute to someone who was just displaced, and would close the new holder's tenure. A tribe board: its members.
const adM = env => env.METER.get(env.METER.idFromName('ad'));
// A report hook on a claim / review / merge: waited for up to AD_WAIT so the next report sees it, never longer (the call finishes in waitUntil).
// A failure is dropped: the next report closes a tenure not named for its reader.
const AD_WAIT = 800;
function adSoon(ctx, call) { const job = Promise.resolve().then(call).catch(() => { }); try { ctx?.waitUntil?.(job); } catch { } return Promise.race([job, new Promise((r) => setTimeout(r, AD_WAIT))]); }
async function adReportApi(req, env, u) {
  if (req.method !== 'GET') return J({ err: 'get' }, 405);
  const actor = await resolveActor(env, tokenOf(req)); if (!actor) return J({ ok: false, error: playerErr('auth') }, 401);
  if (!(await rateOk(env.EVENT_RL, req))) return J({ ok: false, error: 'rate' }, 429);
  const slot = String(u.searchParams.get('slot') || ''); if (!SLOT_RE.test(slot)) return J({ ok: false, error: playerErr('slot') }, 400);
  const mk = actor.id + '|' + slot, hit = ADR.get(mk); if (hit && Date.now() - hit.at < 10000) return J(hit.v); // a holder's answer, 10 s: no Supabase read, no DO call
  let b = null; try { const s = await fetch(SUPA + '/rest/v1/billboards?select=slot_id,holder_id&slot_id=eq.' + encodeURIComponent(slot), { headers: { apikey: ANON, accept: 'application/json' } }); const rows = s.ok ? await s.json() : null; if (!Array.isArray(rows)) throw new Error('board'); b = rows[0] || {}; } catch { b = null; }
  if (!b) return J({ ok: false, error: '리포트를 불러오지 못했어요. 잠시 뒤 다시 해 주세요.' }, 503); // could not read the holder: not a 403
  const holder = String(b.holder_id || '');
  let ok = !!holder && holder === actor.id;
  if (!ok && holder.startsWith('tribe:')) { try { const t = await supabaseRpc('my_tribe', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id }); ok = !!t.data?.tribe_id && 'tribe:' + t.data.tribe_id === holder; } catch { ok = false; } }
  if (!ok) return J({ ok: false, error: playerErr('holder') }, 403);
  let r = null; try { r = await adM(env).adRead(slot, holder); } catch { r = null; }
  if (!r) return J({ ok: false, error: '리포트를 불러오지 못했어요. 잠시 뒤 다시 해 주세요.' }, 503);
  const v = { ok: true, slot, days: r.days, total: r.total, since: r.since, today: r.today }; if (ADR.size >= 500) ADR.clear(); ADR.set(mk, { at: Date.now(), v });
  return J(v);
}
const ADR = new Map(); // GET /rt/ad-report answers per (account, slot), 10 s per isolate, at most 500; only a holder's 200 is kept
async function announce(env, ctx, topics, uid, row) {
  try { await invalidateWorld(env, ctx); } catch { }
  if (await budgetHard(env)) return; // budget hard: every socket was closed when the level was set, so no room is told (the world copy is still refilled)
  for (const topic of topics) {
    try {
      const room = env.ROOM.get(env.ROOM.idFromName(topic));
      await room.fetch(new Request('https://room.internal/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: 'WORLD_UPDATE', kind: 'BILLBOARD', data: row }) }));
      if (uid) await room.fetch(new Request('https://room.internal/sync', { method: 'POST', headers: { 'x-uid': uid } }));
    } catch { }
  }
}
async function photos(req, env, ctx, u) {
  if (u.pathname.startsWith('/rt/photo/')) {
    if (req.method !== 'GET') return J({ err: 'get' }, 405);
    const id = u.pathname.slice(10).replace(/\.jpg$/, '');
    if (!PHOTO_ID_RE.test(id)) return J({ err: 'id' }, 400);
    const review = u.searchParams.has('review');
    if (review && !adminOk(env, req)) return J({ err: 'admin' }, 401);
    const hit = !review && PHOTO_C.get(id);
    let bytes = hit && Date.now() - hit.at < PHOTO_TTL ? hit.b : null;
    if (!bytes) {
      const rpc = await supabaseRpc('get_billboard_photo', { p_key: env.FLUSH_KEY || '', p_photo_id: id, p_any: review });
      if (!rpc.ok || !rpc.data?.ok || !rpc.data.jpeg) { PHOTO_C.delete(id); return J({ err: 'not found' }, 404); }
      bytes = unb64(String(rpc.data.jpeg).replace(/\s+/g, ''));
      if (!review) { if (PHOTO_C.size >= 24) PHOTO_C.delete(PHOTO_C.keys().next().value); PHOTO_C.set(id, { b: bytes, at: Date.now() }); }
    }
    return new Response(bytes, { headers: { 'content-type': 'image/jpeg', 'cache-control': review ? 'no-store' : 'public, max-age=3600', 'x-content-type-options': 'nosniff' } });
  }
  if (u.pathname === '/rt/billboard-photo') {
    if (req.method !== 'POST') return J({ err: 'post' }, 405);
    const actor = await resolveActor(env, tokenOf(req)); if (!actor) return J({ err: 'auth' }, 401);
    if (Date.now() - (PHOTO_AT.get(actor.id) || 0) < PHOTO_GAP) return J({ ok: false, error: '사진은 10초에 한 번만 올릴 수 있어요.' }, 429);
    const b = await readBody(req, Math.ceil(PHOTO_MAX * 4 / 3) + 4000); if (!b) return J({ ok: false, error: '사진이 너무 커요. (최대 300KB)' }, 413);
    const topic = typeof b.topic === 'string' ? b.topic : '';
    if (!PLAZA_TOPICS.includes(topic)) return J({ ok: false, error: '광장 접속 정보가 없습니다. 다시 입장한 뒤 시도해 주세요.', pending: true }, 400);
    const slot = String(b.slot_id || ''); if (!SLOT_RE.test(slot)) return J({ ok: false, error: '전광판 슬롯이 올바르지 않습니다.' }, 400);
    let raw = null; try { raw = unb64(String(b.photo || '').replace(/^data:image\/jpeg;base64,/, '')); } catch { }
    const img = raw && raw.length <= PHOTO_MAX ? jpegClean(raw) : null;
    if (!img || img.w < 160 || img.h < 90 || img.w > 2048 || img.h > 2048) return J({ ok: false, error: '사진 형식이 올바르지 않습니다. (JPEG, 최대 300KB)' }, 400);
    PHOTO_AT.set(actor.id, Date.now()); if (PHOTO_AT.size > 5000) PHOTO_AT.clear();
    const settled = await settle(env, topic, actor.id);
    if (!settled.ok) return J({ ok: false, error: settled.error, pending: true }, 409);
    const tag = new TextEncoder().encode(actor.id + '\n' + slot + '\n'), buf = new Uint8Array(tag.length + img.bytes.length);
    buf.set(tag); buf.set(img.bytes, tag.length);
    const id = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 40);
    const rpc = await supabaseRpc('submit_billboard_photo', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_nickname: clip(b.nickname || b.nick || '', 16) || '네온손님', p_slot_id: slot, p_photo_id: id, p_jpeg_b64: b64of(img.bytes) });
    const data = rpc.data || {}, msg = String(data.message || '');
    if (!rpc.ok || data.ok === false) return J({ ok: false, error: data.error || (/schema cache|Could not find the function/i.test(msg) ? '사진 전광판이 아직 준비 중이에요. 잠시 후 다시 시도해 주세요.' : '사진을 올리지 못했어요. 잠시 후 다시 시도해 주세요.') }, rpc.ok ? 400 : 502);
    const row = data.billboard; if (!row || typeof row !== 'object') return J({ ok: false, error: 'empty' }, 502);
    leagueAdd(env, ctx, actor.id, b.nickname || b.nick || '', Math.floor(Number(data.fee) || 0), 'p:' + id);
    await announce(env, ctx, [topic], actor.id, row);
    return J({ ok: true, kind: 'BILLBOARD', data: row, remaining_coins: data.remaining_coins ?? null, fee: data.fee ?? null });
  }
  if (u.pathname === '/rt/admin/photos') {
    if (!adminOk(env, req)) return J({ err: 'admin' }, 401);
    const s = u.searchParams.get('status'), status = ['pending', 'approved', 'rejected', 'removed'].includes(s) ? s : 'pending';
    const rpc = await supabaseRpc('list_billboard_photos', { p_key: env.FLUSH_KEY || '', p_status: status });
    if (!rpc.ok || rpc.data?.ok === false) return J({ err: 'upstream' }, 502);
    return J({ ok: true, status, photos: Array.isArray(rpc.data?.photos) ? rpc.data.photos : [] });
  }
  if (u.pathname === '/rt/admin/photo') {
    if (req.method !== 'POST') return J({ err: 'post' }, 405);
    if (!adminOk(env, req)) return J({ err: 'admin' }, 401);
    const b = await readJson(req); const id = String(b?.photo_id || '');
    if (!PHOTO_ID_RE.test(id)) return J({ err: 'id' }, 400);
    const rpc = await supabaseRpc('review_billboard_photo', { p_key: env.FLUSH_KEY || '', p_photo_id: id, p_approve: b.approve === true });
    const data = rpc.data || {};
    if (!rpc.ok || data.ok === false) return J({ ok: false, error: data.error || data.message || '검수를 처리하지 못했습니다.' }, rpc.ok ? 400 : 502);
    PHOTO_C.delete(id);
    if (data.photo?.actor_id && Number(data.photo.refunded) > 0) { const who = String(data.photo.actor_id), back = Math.floor(Number(data.photo.refunded)); leagueRun(env, ctx, (M) => M.lgBack('p:' + id, who, back)); } // a rejected pending photo's fee came back, off the week it was paid in
    if (data.billboard) await announce(env, ctx, PLAZA_TOPICS.includes(b.topic) ? [b.topic] : PLAZA_TOPICS, data.photo?.actor_id || '', data.billboard);
    return J({ ok: true, billboard: data.billboard || null, photo: data.photo || null });
  }
  if (u.pathname === '/rt/admin/wallets') {
    if (!adminOk(env, req)) return J({ err: 'admin' }, 401);
    const rpc = await supabaseRpc('find_wallets', { p_key: env.FLUSH_KEY || '', p_nickname: clip(u.searchParams.get('nickname') || '', 16) });
    const data = rpc.data || {};
    if (!rpc.ok || data.ok === false) return J({ ok: false, error: data.error || '지갑을 찾지 못했습니다.' }, rpc.ok ? 400 : 502);
    return J({ ok: true, wallets: Array.isArray(data.wallets) ? data.wallets : [] });
  }
  if (u.pathname === '/rt/admin/coins') {
    if (req.method !== 'POST') return J({ err: 'post' }, 405);
    if (!adminOk(env, req)) return J({ err: 'admin' }, 401);
    const b = await readJson(req);
    const actorId = String(b?.actor_id || '');
    const amount = Math.floor(Number(b?.amount));
    if (!/^(guest|user):[\w-]{8,80}$/.test(actorId) || !Number.isInteger(amount) || amount < 1 || amount > 1000000) return J({ ok: false, error: '지갑을 고르고 1~100만 코인을 입력하세요.' }, 400);
    const rpc = await supabaseRpc('grant_coins', { p_key: env.FLUSH_KEY || '', p_actor_id: actorId, p_amount: amount });
    const data = rpc.data || {};
    if (!rpc.ok || data.ok === false) return J({ ok: false, error: data.error || data.message || '코인을 넣지 못했습니다.' }, rpc.ok ? 400 : 502);
    ctx.waitUntil(nudge(env, actorId));
    return J({ ok: true, actor_id: data.actor_id, nickname: data.nickname || '', coins: data.coins });
  }
  if (u.pathname === '/rt/admin/stats') {
    if (req.method !== 'GET') return J({ err: 'get' }, 405);
    if (!adminOk(env, req)) return J({ err: 'admin' }, 401);
    const today = kstDay(), n = Math.min(90, Math.max(1, Math.floor(Number(u.searchParams.get('days'))) || 14));
    try {
      const days = await env.METER.get(env.METER.idFromName('ev')).evStats(today, n);
      return J({ ok: true, today, days: days.map(d => ({ ...d, ...statsFromCounts(d.events) })), tally: { pending: TALLY.n, flushAgeMs: TALLY.at ? Date.now() - TALLY.at : -1, lvl: LVL.l } }); // this isolate's budget tally, numbers only
    } catch { return J({ err: 'meter' }, 503); }
  }
  if (u.pathname === '/rt/admin/reports' && req.method === 'GET') {
    if (!adminOk(env, req)) return J({ err: 'admin' }, 401);
    const reports = await supabaseRpc('list_reports', { p_key: env.FLUSH_KEY || '' });
    const reviews = await supabaseRpc('list_billboard_reviews', { p_key: env.FLUSH_KEY || '' });
    if (!reports.ok || reports.data?.ok === false) return J({ err: 'upstream' }, 502);
    return J({
      ok: true,
      items: Array.isArray(reports.data?.items) ? reports.data.items : [],
      reviews: reviews.ok && Array.isArray(reviews.data?.items) ? reviews.data.items : [],
    });
  }
  if (u.pathname === '/rt/admin/review' && req.method === 'POST') {
    if (!adminOk(env, req)) return J({ err: 'admin' }, 401);
    const b = await readJson(req);
    const id = Math.floor(Number(b?.id));
    if (!Number.isInteger(id) || id < 1) return J({ ok: false, error: 'id' }, 400);
    const rpc = await supabaseRpc('review_slot_claim', { p_key: env.FLUSH_KEY || '', p_id: id, p_approve: b?.approve === true });
    const data = rpc.data || {};
    if (!rpc.ok || data.ok === false) return J({ ok: false, error: data.error || data.message || '검수를 처리하지 못했습니다.' }, rpc.ok ? 400 : 502);
    // A rejected S-tier bid goes back to its payer; an approved one hands 80% of the old bid back to the board's previous holder.
    // Both come off the week the bid was tallied in (the review record, the slot record).
    if (data.rejected && data.actor_id) { const who = String(data.actor_id), back = Math.floor(Number(data.refund) || 0); leagueRun(env, ctx, (M) => M.lgBack('r:' + id, who, back)); }
    else if (data.billboard) { const sl = String(data.billboard.slot_id || ''), prev = String(data.prev_holder_id || ''), back = Math.floor(Number(data.refund) || 0); leagueRun(env, ctx, (M) => M.lgApprove(id, sl, prev, back)); }
    if (b?.approve === true && data.billboard) {
      const payer = String(data.actor_id || '');
      const member = String(data.member || '');
      const who = payer.startsWith('tribe:') ? member : payer;
      if (who && !who.startsWith('tribe:')) {
        for (const topic of PLAZA_TOPICS) {
          try {
            await env.ROOM.get(env.ROOM.idFromName(topic)).fetch(new Request('https://room.internal/score', {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-uid': who },
              body: JSON.stringify({ bit: 4, seated: true }),
            }));
          } catch { /* the seated room is the one that keeps the point */ }
        }
      }
    }
    if (data.billboard) {
      const take = data.prev_holder_id && data.prev_holder_id !== data.actor_id ? { victim: data.prev_holder_id, attacker: data.billboard.holder_name || '', slot: data.billboard.slot_id, name: slotName(data.billboard.slot_id), price: Number(data.reclaim_bid) || 0, line1: data.prev_line1, line2: data.prev_line2, line3: data.prev_line3, emoji: data.prev_emoji, theme: data.prev_theme, color: data.prev_color } : null;
      if (take) queueTaken(env, ctx, take.victim, take.attacker, take.slot);
      if (b?.approve === true && data.billboard.holder_id) await adSoon(ctx, () => adM(env).adClaim(data.billboard.slot_id, String(data.billboard.holder_id), String(data.prev_holder_id || '')));
      darkNote(env, ctx, data.billboard);
      try { await invalidateWorld(env, ctx); } catch { }
      const msg = { t: 'WORLD_UPDATE', kind: 'BILLBOARD', data: data.billboard, sync: [data.prev_holder_id, data.landlord_id].filter((uid) => uid && uid !== data.actor_id), take, mono: data.monopoly_name || '' };
      for (const topic of PLAZA_TOPICS) {
        try { await env.ROOM.get(env.ROOM.idFromName(topic)).fetch(new Request('https://room.internal/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(msg) })); } catch { }
      }
    }
    for (const uid of [data.actor_id, data.prev_holder_id, data.landlord_id]) if (uid) { try { ctx.waitUntil(nudge(env, String(uid))); } catch { } }
    return J({ ok: true, approved: b?.approve === true, remaining_coins: data.remaining_coins ?? null });
  }
  if (u.pathname === '/rt/admin/takedown' && req.method === 'POST') {
    if (!adminOk(env, req)) return J({ err: 'admin' }, 401);
    const b = await readJson(req);
    const slot = String(b?.slot || '');
    if (!SLOT_RE.test(slot)) return J({ ok: false, error: 'slot' }, 400);
    const rpc = await supabaseRpc('takedown_billboard', { p_key: env.FLUSH_KEY || '', p_slot_id: slot });
    const data = rpc.data || {};
    if (!rpc.ok || data.ok === false) return J({ ok: false, error: data.error || data.message || '내리지 못했습니다.' }, rpc.ok ? 400 : 502);
    if (data.billboard) darkNote(env, ctx, data.billboard); // takedown blanks the lines only: holder and clock stay, so does the row
    if (data.billboard) await announce(env, ctx, PLAZA_TOPICS, '', data.billboard);
    return J({ ok: true, billboard: data.billboard || null });
  }
  if (u.pathname === '/rt/admin/ops' && req.method === 'POST') {
    if (!adminOk(env, req)) return J({ err: 'admin' }, 401);
    const b = await readJson(req);
    if (!b) return J({ err: 'json' }, 400);
    const id = String(b.id || '').trim();
    const starts = isoDay(b.starts_on);
    const ends = isoDay(b.ends_on);
    const theme = String(b.theme || '');
    const title = String(b.title || '').trim();
    const copy = String(b.copy || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/.test(id)) return J({ ok: false, error: 'id' }, 400);
    if (!OPS_THEMES.has(theme)) return J({ ok: false, error: 'theme' }, 400);
    if (!starts || !ends || ends < starts) return J({ ok: false, error: 'date' }, 400);
    if (!title || [...title].length > 80) return J({ ok: false, error: 'title' }, 400);
    if (!copy || [...copy].length > 80) return J({ ok: false, error: 'copy' }, 400);
    if (blockedText(copy) || blockedText(title)) return J({ ok: false, error: 'blocked' }, 400);
    const rpc = await supabaseRpc('upsert_ops_event', { p_key: env.FLUSH_KEY || '', p_id: id, p_starts: starts, p_ends: ends, p_theme: theme, p_title: title, p_copy: copy });
    const data = rpc.data || {};
    if (!rpc.ok || data.ok === false) return J({ ok: false, error: data.error || 'ops' }, rpc.ok ? 400 : 502);
    PC.delete('world');
    try { await caches.default.delete(new Request(WORLD_CACHE)); } catch { /* the next read refills */ }
    return J({ ok: true, id });
  }
  return J({ err: 'not found' }, 404);
}
async function fileReport(req, env) {
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const actor = await resolveActor(env, tokenOf(req));
  if (!actor) return J({ err: 'auth' }, 401);
  const b = await readJson(req);
  if (!b) return J({ err: 'json' }, 400);
  const slot = String(b.slot || '');
  const reason = String(b.reason || '');
  if (!SLOT_RE.test(slot)) return J({ ok: false, error: 'slot' }, 400);
  if (!REPORT_REASONS.includes(reason)) return J({ ok: false, error: 'reason' }, 400);
  const rpc = await supabaseRpc('file_report', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_slot_id: slot, p_reason: reason });
  const data = rpc.data || {};
  const msg = String(data.message || data.error || '');
  if (!rpc.ok && /unique|duplicate|23505/i.test(msg)) return J({ ok: true });
  if (!rpc.ok || data.ok === false) return J({ ok: false, error: data.error || (/schema cache|Could not find the function/i.test(msg) ? '신고가 아직 준비 중이에요.' : '신고를 접수하지 못했어요.') }, rpc.ok ? 400 : 502);
  return J({ ok: true });
}
// Starter guard for account links. A guest wallet starts with STARTER_COINS nobody earned (wallets.coins DEFAULT 100; coin_batch, claim_billboard and
// sell_coins_to_advertiser insert the same 100) and merge_guest_account moves every coin, so sign-out -> a new guest -> sign-in added 100 a cycle.
// The merge's own answer is the judge, decided inside its one transaction: bonus > 0 only for the call that made the account's first link (everything
// moves, as before), moved = what this very call moved (0 for a replay and for the loser of two calls at once). On every later link the first
// STARTER_COINS a guest ever moves are taken back out of the account and what it earned on top stays. Meter.stTake counts them per guest, so coins
// that reach an already linked guest later (a late room flush) are its earnings. An answer without a numeric `moved` leaves the link as it was.
// A first link counts the guest's whole starter as gone even when nothing moved yet (stFirst). An account that withdrew is remembered (goneKey,
// Meter.goneSet): its wallet row and link_bonus are deleted, so the database pays the link reward again on its next link, but that link is not a
// first one. The reward and the guest's starter are both taken back, and only what the guest earned stays. Budget hard: no 'acct' call, so no mark
// is written or read and such a link passes as a first one.
// While a link that will move coins is under way the account's own coin sends wait (linkHold), so they cannot empty the wallet before the take-back.
// takeBack removes n coins with what the database has today: spend_plaza burns exactly 30 and nothing else, grant_coins adds any amount. Whole 30s
// first, then the rest r as +(30 - r) and one more 30, so at no step has the wallet lost more than n: the account never loses a coin it had before the
// link. It stops at the first refusal and the account keeps the remainder. -> the coins actually removed.
const STARTER_COINS = 100, BURN = 30, BACK_MAX = 400; // BACK_MAX: the starter and the link reward (300) together, 13 burns + 1 grant + 1 burn
async function takeBack(env, uid, n) {
  const key = env.FLUSH_KEY || '', want = Math.min(BACK_MAX, Math.floor(Number(n))); if (!(want > 0)) return 0;
  const yes = (r) => r.ok && r.data?.ok === true, burn = () => supabaseRpc('spend_plaza', { p_key: key, p_actor_id: uid, p_coins: BURN, p_tickets: 0 }).then(yes, () => false);
  const whole = Math.floor(want / BURN), rest = want % BURN;
  const done = (await Promise.all(Array.from({ length: whole }, burn))).filter(Boolean).length * BURN;
  if (done < whole * BURN || !rest) return done;
  if (!(await supabaseRpc('grant_coins', { p_key: key, p_actor_id: uid, p_amount: BURN - rest }).then(yes, () => false))) return done;
  return (await burn()) ? want : done - (BURN - rest);
}
// The mark of a withdrawn account: a keyed hash, so the 'acct' instance never holds the id of someone who left.
async function goneKey(env, uid) { const dig = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('gone:' + uid + String(env.GUEST_KEY || ''))));
  let hex = ''; for (const b of dig) hex += b.toString(16).padStart(2, '0'); return hex.slice(0, 32); }
// The two wallet rows a link touches, in one read. -> { g: the guest's coins (0: no row), paid: the account already has its link reward }, or null
// when they cannot be read.
async function linkAhead(guestId, userId) {
  try { const s = await fetch(SUPA + '/rest/v1/wallets?select=actor_id,coins,link_bonus&actor_id=in.(' + [guestId, userId].map(x => encodeURIComponent('"' + x + '"')).join(',') + ')', { headers: { apikey: ANON, accept: 'application/json' } }); const rows = s.ok ? await s.json() : null;
    if (!Array.isArray(rows)) return null; const g = rows.find(r => r?.actor_id === guestId), a = rows.find(r => r?.actor_id === userId), n = g ? Number(g.coins) : 0;
    return Number.isFinite(n) ? { g: n, paid: a?.link_bonus === true } : null; } catch { return null; }
}
async function accountApi(req, env, ctx, u) {
  if (u.pathname === '/rt/config') {
    if (req.method !== 'GET') return J({ err: 'get' }, 405);
    const kakao = String(env.KAKAO_JS_KEY || '').trim(); // a public JavaScript key (not a secret); the share button exists only when it is set
    // On every visitor's boot path: never wait for Supabase. A stale list (or the old four, a subset) is safe; refresh behind the response.
    if (Date.now() - STARTER_C.at >= STARTER_C.ttl) ctx?.waitUntil?.(starterSlots(env));
    return J({ ...(/^[\w-]{16,80}$/.test(kakao) ? { url: SUPA, key: ANON, kakao, starter: STARTER_C.list } : { url: SUPA, key: ANON, starter: STARTER_C.list }), ...(inviteOn(env) ? { invite: true } : {}) }); // invite: the master switch INVITE_ON
  }
  if (u.pathname === '/rt/event') {
    if (req.method !== 'POST') return J({ err: 'post' }, 405);
    const b = await readJson(req);
    const name = String(b?.name || '');
    if (!EVENT_NAMES.includes(name)) return J({ err: 'event' }, 400);
    if (!(await rateOk(env.EVENT_RL, req))) return J({ err: 'rate' }, 429);
    // The account is whoever the bearer token proves (guest or user), never a client-sent id. page_landing may arrive without one; its session ties it in.
    const actor = await resolveActor(env, tokenOf(req)), sid = /^[\w-]{8,40}$/.test(String(b.sid || '')) ? String(b.sid) : '';
    try { await env.METER.get(env.METER.idFromName('ev')).evAdd(name, kstDay(), sid, actor ? actor.id : '', evProps(b.p)); }
    catch { return J({ err: 'meter' }, 503); }
    return J({ ok: true });
  }
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const actor = await resolveActor(env, tokenOf(req)); // the JWT check: cached JWKS, no Durable Object call
  if (!actor || actor.guest || !actor.id.startsWith('user:')) return J({ err: 'auth' }, 401);
  if (actor.anon && u.pathname === '/rt/auth/merge') return J({ ok: false, error: '로그인한 계정만 연결할 수 있어요.' }, 400); // an anonymous sign-in has no account to link to
  // A link or a withdrawal is done once per account; a replay loop must not reach the RPC or any Durable Object (GUEST_RL: 10 a minute per account,
  // keyed by account so a shared IP's signed-in boots never use up the guest mints).
  if (!(await rateKey(env.GUEST_RL, (u.pathname === '/rt/auth/merge' ? 'merge:' : 'withdraw:') + actor.id))) return J({ ok: false, err: 'rate', error: u.pathname === '/rt/auth/merge' ? '계정을 연결하지 못했어요. 잠시 뒤 다시 해 주세요.' : '탈퇴를 처리하지 못했어요. 잠시 뒤 다시 해 주세요.' }, 429, { 'retry-after': '60' });
  if (u.pathname === '/rt/auth/withdraw') {
    const rpc = await supabaseRpc('withdraw_account', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id });
    const data = rpc.data || {};
    if (!rpc.ok || data.ok === false) return J({ ok: false, error: data.error || '탈퇴를 처리하지 못했습니다.' }, rpc.ok ? 400 : 502);
    // The wallet row and its link_bonus are gone now: remember that this id has had its link reward (see takeBack). Not at budget hard.
    const mark = (async () => { if (!(await budgetHard(env))) await acct(env).goneSet(await goneKey(env, actor.id)); })().catch(() => { }); ctx.waitUntil(mark); await mark;
    try { await fetch(SUPA + '/auth/v1/user', { method: 'DELETE', headers: { apikey: ANON, Authorization: 'Bearer ' + tokenOf(req) } }); } catch { }
    try { await invalidateWorld(env, ctx); } catch { }
    // What the Worker keeps outside Supabase goes too (see forgetActor), before the rooms are told, so their refetch no longer shows the wish.
    const gone = forgetActor(env, actor.id).catch(() => { }); ctx.waitUntil(gone);
    // The account's boards and plots were cleared in bulk: tell every room so connected clients refetch the world.
    ctx.waitUntil(gone.then(() => Promise.all(PLAZA_TOPICS.map(async t => { try { await env.ROOM.get(env.ROOM.idFromName(t)).fetch(new Request('https://room.internal/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"t":"WORLD_UPDATE"}' })); } catch { } }))));
    return J({ ok: true });
  }
  const b = await readJson(req);
  const sub = parseGuestHandover(b?.guest_id);
  if (!sub) return J({ ok: false, error: '게스트 정보가 없습니다.' }, 400);
  const guestId = 'guest:' + sub;
  const G = await guestVerify(env, b?.guest_token, 180 * 86400);
  if (!G || G.s !== sub) return J({ err: 'guest' }, 401);
  // Read ahead, together: does the link move a board (merge_guest_account does not say; a replay moves nothing and tells no room; unreadable:
  // assume yes), and will coins reach the account: the guest holds some, or the link reward is still to be paid (then the account's coin sends are
  // held until the take-back is done; unreadable: assume yes). A replay, nothing to move and the reward long paid, holds nothing.
  const [held, ahead] = await Promise.all([(async () => { try { const s = await fetch(SUPA + '/rest/v1/billboards?select=slot_id&holder_id=eq.' + encodeURIComponent(guestId) + '&limit=1', { headers: { apikey: ANON, accept: 'application/json' } }); const rows = s.ok ? await s.json() : null; return Array.isArray(rows) ? rows.length > 0 : true; } catch { return true; } })(), linkAhead(guestId, actor.id)]);
  const free = ahead && ahead.g === 0 && ahead.paid ? null : await linkHold(env, actor.id);
  if (free === false) return J({ ok: false, err: 'rate', error: '계정을 연결하지 못했어요. 잠시 뒤 다시 해 주세요.' }, 429, { 'retry-after': '60' }); // one of this account's sends is under way
  // The RPC and the starter guard are one piece of work, handed to waitUntil before it is awaited: a client that goes away after the coins moved
  // does not skip the take-back. Only a link that moved coins or was paid the reward asks 'acct' anything (one call); a take-back is at most 15 RPCs
  // (5 without the reward). Budget hard, or that call failing: no Durable Object, a later link gives back the first STARTER_COINS of what it moved.
  const work = (async () => {
    const rpc = await supabaseRpc('merge_guest_account', { p_key: env.FLUSH_KEY || '', p_user_id: actor.id, p_guest_id: guestId, p_nickname: botNick(b?.nickname) ? '' : clip(b?.nickname || '', 16) });
    const data = rpc.data || {}; if (!rpc.ok || data.ok === false) return { rpc, data, back: 0, again: false };
    const moved = typeof data.moved === 'number' ? Math.max(0, Math.floor(data.moved)) : 0, bonus = Math.max(0, Math.floor(Number(data.bonus)) || 0); // no numeric moved: the function does not say, nothing counts as starter
    if (!moved && !bonus) return { rpc, data, back: 0, again: false };
    const hard = await budgetHard(env); let part = bonus ? 0 : Math.min(moved, STARTER_COINS), again = false; // again: the reward was paid to an id that withdrew before
    if (!hard) { try { if (bonus) { const f = await acct(env).stFirst(guestId, moved, STARTER_COINS, await goneKey(env, actor.id)); again = f?.gone === true; part = again ? Number(f.part) || 0 : 0; }
        else part = Number(await acct(env).stTake(guestId, moved, STARTER_COINS)) || 0; } catch { /* as at hard */ } }
    return { rpc, data, again, back: await takeBack(env, actor.id, part + (again ? bonus : 0)).catch(() => 0) };
  })().finally(() => (free ? free() : null));
  ctx.waitUntil(work.catch(() => { }));
  const { rpc, data, back, again } = await work;
  if (!rpc.ok || data.ok === false) return J({ ok: false, error: data.error || '계정을 연결하지 못했습니다.' }, rpc.ok ? 400 : 502);
  let coins = data.coins; if (back > 0 && Number.isFinite(Number(coins))) coins = Math.max(0, Number(coins) - back);
  try { await invalidateWorld(env, ctx); } catch { }
  // The guest's boards now have the user as holder: a bulk change, so the live rooms drop their board rows (brd) and clients refetch the world. Live rooms
  // as the wish fan-out picks them (wishRooms: the caller's shard and shards with a seated account today or yesterday; unreadable: the caller's only).
  // Other rooms read the board again within BRD_TTL.
  if (held) { const topic = PLAZA_TOPICS.includes(b?.topic) ? b.topic : 'chapel:square';
    ctx.waitUntil(wishRooms(env, topic).then(names => Promise.all(names.map(t => env.ROOM.get(env.ROOM.idFromName(t)).fetch(new Request('https://room.internal/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"t":"WORLD_UPDATE"}' })).catch(() => null)))).catch(() => null)); }
  ctx.waitUntil(Promise.resolve().then(() => env.METER.get(env.METER.idFromName('ev')).evAlias(guestId, actor.id)).catch(() => { })); // return and funnel numbers follow the person across the link
  // Pushes to the user: id reach the guest's browsers, and the guest's board shots stay the holder's own (card page, share-page title).
  // The guest's wish, hearts, reports and unpaid prizes become the user's (wMove), so mine, the one-wish-a-day rule and the prize follow the person.
  ctx.waitUntil(Promise.resolve().then(() => Promise.all([pushM(env).psMove(guestId, actor.id), snapM(env).snapMove(guestId, actor.id).then(() => { SNX.clear(); SNC.clear(); }),
    wishM(env).wMove(guestId, actor.id).then(() => { WISHC.at = 0; WONE.clear(); WAU.clear(); }), darkM(env).dkMove(guestId, actor.id), lgM(env).lgMove(guestId, actor.id).then(lgDrop), invM(env).ivMove(guestId, actor.id)])).catch(() => { })); // the invite code, counts and pending rewards too
  await adSoon(ctx, () => adM(env).adMove(guestId, actor.id)); // the moved boards keep their report; waited for (up to 0.8 s) so a report right after the link finds it
  return J({ ok: true, actor_id: actor.id, coins, bonus: again ? 0 : data.bonus || 0, linked: true, nickname: data.nickname || '' }); // again: the reward went back, so none is announced
}
// Account withdrawal, outside Supabase: push subscriptions and gaps, wishes (hidden and emptied), hearts given, reports filed, and the uploader link of
// snapshot contexts, for the user and for every guest linked to it (the 'ev' alias). Then this isolate's copies that could still show the wish.
async function forgetActor(env, uid) {
  let ids = [uid]; try { ids = ids.concat(await env.METER.get(env.METER.idFromName('ev')).evGuests(uid)); } catch { /* the user's own rows still go */ }
  const dropSubs = async (id) => { const r = await pushM(env).psForget(id); // the Supabase copies of the endpoints this instance knew (older ones only Supabase knows stay)
    await Promise.all((r?.e || []).map(e => supabaseRpc('push_unsubscribe', { p_key: env.FLUSH_KEY || '', p_actor_id: id, p_endpoint: e }).catch(() => null))); };
  await Promise.all(ids.map(id => Promise.all([dropSubs(id), wishM(env).wForget(id), snapM(env).snapForget(id), darkM(env).dkForget(id), lgM(env).lgForget(id), invM(env).ivForget(id)].map(p => p.catch(() => null)))));
  await Promise.all(ids.map(id => adM(env).adForget(id).catch(() => null))); // the board reports of their tenures go too
  WISHC.at = 0; WONE.clear(); WAU.clear(); SNX.clear(); SNC.clear(); PC.delete('world'); lgDrop();
  try { await caches.default.delete(new Request(WORLD_CACHE)); } catch { }
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function pngBytes(png) {
  if (!png) return null;
  if (png instanceof Uint8Array) return png;
  if (png instanceof ArrayBuffer) return new Uint8Array(png);
  if (ArrayBuffer.isView(png)) return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
  return null;
}
function cardSlotOf(pathname) {
  if (!pathname.startsWith('/rt/card/')) return null;
  let rest = pathname.slice('/rt/card/'.length);
  const png = rest.endsWith('.png');
  if (png) rest = rest.slice(0, -4);
  if (!rest || rest.includes('/') || !SLOT_RE.test(rest)) return null;
  return { slot: rest, png };
}
function cardTarget(slot, search, holderRef) {
  const q = new URLSearchParams();
  q.set('focus', slot);
  if (search.get('gift') === '1') q.set('gift', '1');
  const fromQuery = String(search.get('ref') || '');
  const ref = /^[a-z0-9]{8}$/.test(fromQuery) ? fromQuery : (/^[a-z0-9]{8}$/.test(holderRef) ? holderRef : '');
  if (ref) q.set('ref', ref);
  const inv = invCode(search.get('inv')); if (inv) q.set('inv', inv);
  return '/?' + q.toString();
}
// The live billboard row is the previous screen. A pending S-tier review stays in billboard_reviews and is not drawn here.
async function loadCard(env, slot) {
  const empty = { ref: '', holder_name: '', line1: '', line2: '', line3: '', tier: '', updated_at: '' };
  try {
    const s = await fetch(SUPA + '/rest/v1/billboards?select=slot_id,holder_id,holder_name,line1,line2,line3,tier,updated_at&slot_id=eq.' + encodeURIComponent(slot), { headers: { apikey: ANON, accept: 'application/json' } });
    if (!s.ok) return empty;
    const rows = await s.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return empty;
    let ref = '';
    const holder = String(row.holder_id || '');
    if (holder) {
      try {
        const rpc = await supabaseRpc('ensure_ref_code', { p_key: env.FLUSH_KEY || '', p_actor_id: holder });
        const code = typeof rpc.data === 'string' ? rpc.data : '';
        if (/^[a-z0-9]{8}$/.test(code)) ref = code;
      } catch { ref = ''; }
    }
    return { ref, holder: holder, holder_name: String(row.holder_name || ''), line1: String(row.line1 || ''), line2: String(row.line2 || ''), line3: String(row.line3 || ''), tier: String(row.tier || ''), updated_at: String(row.updated_at || '') };
  } catch { return empty; }
}
async function cardPage(req, env, u) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method', { status: 405 });
  const parsed = cardSlotOf(u.pathname);
  if (!parsed) return new Response('not found', { status: 404 });
  if (parsed.png && env.PLAN !== 'paid') return new Response('not found', { status: 404 });
  const card = await loadCard(env, parsed.slot);
  if (parsed.png) {
    try {
      const key = parsed.slot + String(card.updated_at || '');
      const meter = env.METER.get(env.METER.idFromName('cards'));
      let png = pngBytes(await meter.cardGet(key));
      if (!png) {
        png = await renderCardPng({ name: card.holder_name, line1: card.line1, line2: card.line2, line3: card.line3, tier: card.tier });
        if (png.length > 40000) return new Response('not found', { status: 404 });
        await meter.cardPut(key, png);
      }
      return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=300' } });
    } catch { return new Response('not found', { status: 404 }); }
  }
  const shot = await snapFor(env, 'slot', parsed.slot, card.holder); // only the current holder's own shot
  const image = shot ? new URL('/rt/snap/' + shot, req.url).href : env.PLAN === 'paid' ? new URL('/rt/card/' + parsed.slot + '.png', req.url).href : 'https://studio.wishboard.workers.dev/og.jpg';
  const page = new URL('/rt/card/' + parsed.slot, req.url).href;
  const dest = cardTarget(parsed.slot, u.searchParams, card.ref);
  const title = esc([clip(card.holder_name, 16), clip(card.line1, 16)].filter(Boolean).join(' ') || '타임스퀘어 전광판');
  const desc = esc(clip(card.line2, 16));
  const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>' + title + '</title>'
    + '<meta property="og:title" content="' + title + '">'
    + '<meta property="og:description" content="' + desc + '">'
    + '<meta property="og:image" content="' + esc(image) + '">'
    + '<meta property="og:url" content="' + esc(page) + '">'
    + '<meta http-equiv="refresh" content="0;url=' + esc(dest) + '">'
    + '</head><body><p><a href="' + esc(dest) + '">타임스퀘어에서 이 전광판 보기</a></p></body></html>';
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
// Payload { body, url? } (the service worker defaults the title to 모두의 전광판). drop(endpoint) also forgets a gone endpoint in the 'push' instance.
async function sendPushItems(env, items, drop) {
  const dead = [];
  for (const row of items) {
    const body = pushText(row);
    if (!body || !row?.endpoint) continue;
    try {
      const url = pushUrl(row), enc = await encryptPush(row, new TextEncoder().encode(JSON.stringify(url ? { body, url } : { body })));
      if (!enc) continue;
      const r = await fetch(row.endpoint, { method: 'POST', headers: { TTL: '1800', Urgency: 'high', Authorization: await vapidAuth(env, row.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' }, body: enc });
      if (r.status === 404 || r.status === 410) dead.push(row.endpoint);
    } catch { /* skip this send; the inbox row stays */ }
  }
  for (const endpoint of dead) { if (drop) { try { await drop(endpoint); } catch { /* the next 410 drops it */ } } try { await supabaseRpc('push_drop', { p_key: env.FLUSH_KEY, p_endpoint: endpoint }); } catch { /* the next hour retries */ } }
}
// Share pages for snapshots. A snapshot keeps its context only when the uploader is entitled to it (the board's holder, the wish's author), and the
// card / wish pages use it only while that uploader still is. SNX: newest snapshot per 'k:r:uploader' (misses too); SNC: a snapshot's context;
// WAU: a wish's author. All 60 s per isolate, ≤300 keys; uploader and author ids stay in the Worker.
const snapM = env => env.METER.get(env.METER.idFromName('snaps'));
const SNX = new Map(), SNC = new Map(), WAU = new Map(), SNAP_HEX = /^[0-9a-f]{32}$/;
const SITE = { title: 'WISH BOARD : 모두의 전광판', desc: '붕어빵 구워 뉴욕 타임스퀘어 전광판과 건물을 차지하세요!' }; // index.html's og:title / og:description
const memo = (m, key, v) => { if (m.size > 300) m.clear(); m.set(key, { at: Date.now(), v }); return v; };
const memoHit = (m, key) => { const hit = m.get(key); return hit && Date.now() - hit.at < 60000 ? hit : null; };
async function snapFor(env, k, r, owner) {
  if (!owner) return ''; const key = k + ':' + r + ':' + owner, hit = memoHit(SNX, key); if (hit) return hit.v;
  let id = ''; try { id = String(await snapM(env).snapFor(k, r, owner) || ''); } catch { return ''; }
  return memo(SNX, key, id);
}
async function snapCtx(env, id) { const hit = memoHit(SNC, id); if (hit) return hit.v; return memo(SNC, id, await snapM(env).snapCtx(id)); }
// '' when the wish is missing, hidden or the instance fails.
async function wishAuthor(env, wid) { const hit = memoHit(WAU, wid); if (hit) return hit.v; if (await lvlNow(env) >= 2) return ''; /* hard: no wish-DO call, the page uses /og.jpg */ let a = ''; try { a = String(await wishM(env).wAuthor(wid) || ''); } catch { return ''; } return memo(WAU, wid, a); }
// The holder and first line of a board: the isolate's world copy while it is under a minute old, else one row from Supabase.
// fresh: skip the isolate copy (an upload whose cached holder is someone else re-reads, the copy may predate the claim).
async function snapBoard(slot, fresh = false) {
  const mem = PC.get('world'); if (!fresh && mem && Date.now() - mem.at < 60000) return cachedBoard(slot);
  try { const s = await fetch(SUPA + '/rest/v1/billboards?select=slot_id,holder_id,holder_name,line1&slot_id=eq.' + encodeURIComponent(slot), { headers: { apikey: ANON, accept: 'application/json' } });
    const rows = s.ok ? await s.json() : []; return Array.isArray(rows) ? rows[0] || null : null; } catch { return null; }
}
async function snapPage(req, env, u) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method', { status: 405 });
  const id = u.pathname.slice('/rt/s/'.length), home = () => Response.redirect(new URL('/' + invTail(u, true), req.url).href, 302); let c = null;
  if (!SNAP_HEX.test(id) || !(await rateOk(env.EVENT_RL, req))) return home();
  try { c = await snapCtx(env, id); } catch { c = null; }
  if (!c) return home();
  let title = SITE.title, desc = SITE.desc, dest = '/', shot = true, age = 300;
  if (c.k === 'slot' && SLOT_RE.test(c.r)) {
    dest = '/?focus=' + c.r; const b = await snapBoard(c.r);
    // The holder's name and line go over the photo only while its uploader still holds the board.
    if (b?.holder_id && c.u && String(b.holder_id) === c.u) { title = [clip(b.holder_name, 16), clip(b.line1, 16)].filter(Boolean).join(' ') || '타임스퀘어 전광판'; desc = '타임스퀘어 ' + slotName(c.r) + ' 전광판에서 찍었어요'; }
    else { title = '타임스퀘어 전광판'; desc = slotName(c.r) + ' 전광판에서 찍었어요'; }
  } else if (c.k === 'wish' && WISH_ID.test(c.r)) {
    age = 30; let w = null; try { w = await wishOne(env, c.r); } catch { w = null; } // rate already checked above
    if (w && !w.hidden) { const s = wishShareText(w); title = s.title; desc = s.text; dest = '/?wish=' + c.r; }
    else shot = false; // a hidden or gone wish: the photo likely shows its text
  }
  dest += invTail(u, dest === '/');
  const t = esc(title), d = esc(desc), img = esc(new URL(shot ? '/rt/snap/' + id : '/og.jpg', req.url).href);
  const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>' + t + '</title>'
    + '<meta property="og:title" content="' + t + '">'
    + '<meta property="og:description" content="' + d + '">'
    + '<meta property="og:image" content="' + img + '">'
    + (shot ? '<meta property="og:image:type" content="image/jpeg">' : '')
    + '<meta property="og:url" content="' + esc(new URL('/rt/s/' + id, req.url).href) + '">'
    + '<meta name="twitter:card" content="summary_large_image">'
    + '<meta name="twitter:title" content="' + t + '">'
    + '<meta name="twitter:description" content="' + d + '">'
    + '<meta name="twitter:image" content="' + img + '">'
    + '<meta http-equiv="refresh" content="0;url=' + esc(dest) + '">'
    + '<script>location.replace(' + JSON.stringify(dest) + ')</script>'
    + '</head><body><p><a href="' + esc(dest) + '">타임스퀘어에서 보기</a></p></body></html>';
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=' + age } });
}
export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url); budget(env); env = tallied(env, ctx);
    if (u.pathname === '/rt/snap' && req.method === 'POST') {
      if (await lvlNow(env) >= 2) return wishNo('busy', 503);
      const actor = await resolveActor(env, tokenOf(req)); if (!actor) return J({ err: 'auth' }, 401);
      const buf = await req.arrayBuffer();
      if (buf.byteLength < 800 || buf.byteLength > 900000) return J({ err: 'size' }, 400);
      const u8 = new Uint8Array(buf);
      if (u8[0] !== 0xff || u8[1] !== 0xd8) return J({ err: 'jpeg' }, 400);
      const id = crypto.randomUUID().replace(/-/g, '');
      let sl = String(u.searchParams.get('slot') || ''), wi = String(u.searchParams.get('wish') || ''); if (!SLOT_RE.test(sl)) sl = ''; if (sl || !WISH_ID.test(wi)) wi = '';
      // A context is kept only for the board's current holder or the wish's author; anyone else's upload is stored plain (generic page, redirect to /).
      let sk = '', sr = '';
      if (sl) { const mem = PC.get('world'), cached = !!mem && Date.now() - mem.at < 60000; let b = await snapBoard(sl); if (cached && String(b?.holder_id || '') !== actor.id) b = await snapBoard(sl, true); if (b?.holder_id && String(b.holder_id) === actor.id) { sk = 'slot'; sr = sl; } }
      else if (wi && (await wishAuthor(env, wi)) === actor.id) { sk = 'wish'; sr = wi; }
      await snapM(env).snapPut(id, u8, sk, sr, sk ? actor.id : '');
      if (sk) memo(SNX, sk + ':' + sr + ':' + actor.id, id);
      return J({ ok: true, url: new URL('/rt/snap/' + id, req.url).href, page: new URL('/rt/s/' + id, req.url).href });
    }
    if (u.pathname.startsWith('/rt/s/')) return snapPage(req, env, u);
    const snapId = u.pathname.startsWith('/rt/snap/') ? u.pathname.slice('/rt/snap/'.length) : '';
    if (snapId && /^[0-9a-f]{32}$/.test(snapId) && req.method === 'GET') {
      const jpeg = await env.METER.get(env.METER.idFromName('snaps')).snapGet(snapId);
      if (!jpeg) return new Response('gone', { status: 404 });
      const bytes = jpeg instanceof ArrayBuffer ? jpeg : jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength);
      return new Response(bytes, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' } });
    }
    if (u.pathname === '/rt/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return J({ err: 'get' }, 405);
      return J({ hasFlushKey: typeof env.FLUSH_KEY === 'string' && env.FLUSH_KEY.length > 0, hasGuestKey: typeof env.GUEST_KEY === 'string' && env.GUEST_KEY.length > 0, mode: 'DO' });
    }
    if (u.pathname === '/rt/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
      const t = u.searchParams.get('topic') || ''; if (!PLAZA_TOPICS.includes(t)) return new Response('bad topic', { status: 400 }); // only the plaza's own channels may create a room
      const pr = (req.headers.get('Sec-WebSocket-Protocol') || '').split(',').map(x => x.trim()), at = (pr.find(x => x.startsWith('at.')) || '').slice(3), v2 = pr.includes('masil2');
      const actor = await resolveActor(env, at); if (!actor) return new Response('unauthorized', { status: 401 });
      const h = new Headers(req.headers); h.set('x-uid', actor.id); h.set('x-anon', (actor.guest || actor.anon) ? '1' : '0'); h.set('x-v2', v2 ? '1' : '0');
      return env.ROOM.get(env.ROOM.idFromName(t)).fetch(new Request(req, { headers: h }));
    }
    if (u.pathname === '/rt/guest') { if (req.method !== 'POST') return J({ err: 'post' }, 405); if (!env.GUEST_KEY) return J({ err: 'no guest key' }, 503);
      // An existing guest is re-issued only against proof: a handover ticket (b.h) or its own token (b.t, renewal). Anything else mints a new guest, limited per client IP.
      const b = await readJson(req) || {};
      const own = (typeof b.h === 'string' && await ticketVerify(env, b.h)) || (typeof b.t === 'string' && await guestVerify(env, b.t, 180 * 86400)) || null;
      if (!own && !(await rateOk(env.GUEST_RL, req))) return J({ err: 'rate' }, 429, { 'retry-after': '60' });
      return J(await guestSign(env, own ? own.s : 'g-' + crypto.randomUUID())); }
    if (u.pathname === '/rt/handover') { if (req.method !== 'POST') return J({ err: 'post' }, 405);
      const actor = await resolveActor(env, tokenOf(req)); if (!actor?.guest) return J({ err: 'auth' }, 401);
      const exp = Math.floor(Date.now() / 1000) + TICKET_S; return J({ ticket: await seal(env, 'h1', { s: actor.sub, e: exp }), exp }); }
    if (u.pathname === '/rt/config' || u.pathname === '/rt/event' || u.pathname === '/rt/auth/merge' || u.pathname === '/rt/auth/withdraw') return accountApi(req, env, ctx, u);
    if (u.pathname === '/rt/here' && req.method === 'GET') { // no token: the answer per topic is kept 5 s in the isolate (at most one room call per 5 s)
      const t = 'chapel:square', hit = HERE.get(t); if (hit && Date.now() - hit.at < 5000) return J({ live: hit.v });
      let live = 0; try { const s = await env.ROOM.get(env.ROOM.idFromName(t)).stats(); live = Number(s?.live) || 0; } catch { live = 0; }
      HERE.set(t, { at: Date.now(), v: live }); return J({ live });
    }
    if (u.pathname === '/rt/gate') { try { const now = Date.now(); if (!GATE.r || now - GATE.at > GATE_TTL) { GATE = { at: now, r: await tallyAdd(env) }; }
        const r = GATE.r, l = r.lvl, used = Math.round(r.n), gbs = Math.round(r.g);
        return J(l >= 2 ? { full: true, used, gbs } : { ok: true, cap: CAP, used, gbs, lean: l >= 1 }); } catch (e) { return J({ full: true, err: 1 }, 503); } }
    if (u.pathname === '/rt/sponsor' && req.method === 'GET') return J({ url: extUrl(env.SPONSOR_INQUIRY_URL) || '' });
    if (u.pathname === '/rt/share-bonus' || u.pathname === '/rt/redeem-code') return promo(req, env, u);
    if (u.pathname === '/rt/report') return fileReport(req, env);
    if (u.pathname.startsWith('/rt/card/')) return cardPage(req, env, u);
    if (u.pathname === '/rt/relight') return relightBoard(req, env, ctx);
    if (u.pathname === '/rt/ad-report') return adReportApi(req, env, u);
    if (u.pathname === '/rt/tribe' || u.pathname === '/rt/tribe/pledge') return tribeApi(req, env, u, ctx);
    if (u.pathname === '/rt/league') return leagueApi(req, env);
    if (u.pathname === '/rt/world' || u.pathname === '/rt/wallet' || u.pathname === '/rt/claim-billboard' || u.pathname === '/rt/buy-plot' || u.pathname === '/rt/sell-coins' || u.pathname === '/rt/flush-wallet' || u.pathname === '/rt/spend') return plaza(req, env, ctx, u);
    if (WISH_PATHS.has(u.pathname)) return wishApi(req, env, ctx, u);
    if (u.pathname.startsWith('/rt/w/')) return wishPage(req, env, u);
    if (u.pathname === '/rt/invite') return inviteApi(req, env, ctx);
    if (u.pathname === '/rt/billboard-photo' || u.pathname.startsWith('/rt/photo/') || u.pathname.startsWith('/rt/admin/')) return photos(req, env, ctx, u);
    if (u.pathname === '/rt/grp') { const M = env.METER.get(env.METER.idFromName('grp'));
      if (req.method === 'GET') { const w = isoWeek(); if (GRP.w !== w || Date.now() - GRP.at > 60000) { GRP.v = await M.grpTop(w); GRP.at = Date.now(); GRP.w = w; } return J({ w, top: GRP.v }); }
      if (req.method !== 'POST') return J({ err: 'method' }, 405); let b = null; try { b = await req.json(); } catch { }
      if (!b || !/^[A-Z2-9]{6}$/.test(b.c || '')) return J({ ok: false, error: '코드는 영문 대문자와 숫자 6자리예요' }, 400);
      let sub = '';
      if (typeof b.t === 'string') { const G = await guestVerify(env, b.t).catch(() => null); if (G) sub = G.s; }
      if (!sub) { const actor = await resolveActor(env, tokenOf(req)); if (actor) sub = actor.id; }
      if (!sub) return J({ err: 'auth' }, 401);
      const r = await M.grpAdd(b.c, sub, kstDay(), isoWeek()); GRP.at = 0; return J({ ok: true, dup: !!r.dup }); }
    if (u.pathname === '/rt/profile' || u.pathname === '/rt/equip') return profileApi(req, env, u, ctx);
    if (u.pathname === '/rt/inbox' && req.method === 'GET') return inboxList(req, env);
    if (u.pathname === '/rt/inbox/read') return inboxRead(req, env);
    if (u.pathname === '/rt/push/key') return J({ k: VAPID_PUB }, 200, { 'cache-control': 'public, max-age=3600' });
    if (u.pathname === '/rt/push') {
      const actor = await resolveActor(env, tokenOf(req)); if (!actor) return J({ err: 'auth' }, 401);
      let b = null; try { b = await req.json(); } catch { b = null; }
      const endpoint = req.method === 'DELETE' ? b?.e : b?.s?.endpoint;
      if (!pushHostOk(endpoint)) return J({ err: 'endpoint' }, 400);
      // Supabase keeps its copy for the (paid-plan) cron; the 'push' instance keeps the one the Worker can read for pushNow. Either one landing is success.
      if (req.method === 'DELETE') {
        let dok = false; try { dok = !!(await pushM(env).psDel(actor.id, endpoint))?.ok; } catch { dok = false; }
        let rpc = { ok: false, data: null }; try { rpc = await supabaseRpc('push_unsubscribe', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_endpoint: endpoint }); } catch { }
        return J({ ok: dok || !!(rpc.ok && rpc.data?.ok !== false) }, rpc.ok || dok ? 200 : 502);
      }
      if (req.method !== 'POST') return J({ err: 'method' }, 405);
      const p256dh = b?.s?.keys?.p256dh, authKey = b?.s?.keys?.auth;
      if (typeof p256dh !== 'string' || typeof authKey !== 'string' || p256dh.length < 8 || authKey.length < 8) return J({ err: 'keys' }, 400);
      const fit = p256dh.length <= 200 && authKey.length <= 100 && /^[\w+/-]+=*$/.test(p256dh) && /^[\w+/-]+=*$/.test(authKey); // only well-formed keys are kept here
      let dok = false; if (fit) { try { dok = !!(await pushM(env).psAdd(actor.id, endpoint, p256dh, authKey))?.ok; } catch { dok = false; } }
      let rpc = { ok: false, data: null }; try { rpc = await supabaseRpc('push_subscribe', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_endpoint: endpoint, p_p256dh: p256dh, p_auth: authKey }); } catch { }
      return J({ ok: dok || !!(rpc.ok && rpc.data?.ok !== false) }, rpc.ok || dok ? 200 : 502);
    }
    if (u.pathname === '/rt/room') { const t = u.searchParams.get('topic') || ''; if (!/^chapelqa:/.test(t) || !PLAZA_TOPICS.includes(t)) return J({ err: 'qa only' }, 403);
      return J(await env.ROOM.get(env.ROOM.idFromName(t)).stats()); }
    if (u.pathname === '/.env.local' || u.pathname === '/.git/config' || u.pathname.startsWith('/.env') || u.pathname.startsWith('/.git/')) return new Response(null, { status: 404 });
    return env.ASSETS.fetch(req);
  },
  // Paid plan only. Free returns before any push work. Dark boards and unread taken/cheer, at most PUSH_N.
// 50 11 * * * is 20:50 KST (ball inbox). 0 12 * * * is 21:00 KST (Sunday roof). 5 * * * * stays the hourly pass.
async scheduled(ev, env, ctx) {
  if (env.PLAN !== 'paid') return;
  const cron = String(ev?.cron || '');
  if (cron === '50 11 * * *') {
    try { await supabaseRpc('inbox_ball', { p_key: env.FLUSH_KEY || '' }); } catch { /* the next night retries */ }
    if (!env.VAPID_PRIV || typeof env.FLUSH_KEY !== 'string' || !env.FLUSH_KEY) return;
    let due = null;
    try { due = await supabaseRpc('push_ball', { p_key: env.FLUSH_KEY, p_limit: PUSH_N }); } catch { return; }
    const items = Array.isArray(due?.data?.items) ? due.data.items.slice(0, PUSH_N) : [];
    await sendPushItems(env, items);
    return;
  }
  if (cron === '0 12 * * *') {
    if (kstDow() !== 0) return;
    try { await supabaseRpc('award_tribe_roof', { p_key: env.FLUSH_KEY || '', p_week: isoWeek() }); } catch { /* next Sunday */ }
    return;
  }
  try { await supabaseRpc('clear_dark_boards', { p_key: env.FLUSH_KEY || '' }); } catch { /* the next hour retries */ }
  if (!env.VAPID_PRIV || typeof env.FLUSH_KEY !== 'string' || !env.FLUSH_KEY) return;
  let due = null;
  try { due = await supabaseRpc('push_due', { p_key: env.FLUSH_KEY, p_limit: PUSH_N }); } catch { return; }
  const items = Array.isArray(due?.data?.items) ? due.data.items.slice(0, PUSH_N) : [];
  await sendPushItems(env, items);
}
};
