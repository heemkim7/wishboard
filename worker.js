// Worker name: studio (https://studio.wishboard.workers.dev)
// K-Times Square plaza on the same Workers Free stack: floor is fixed at 0.
// 마실채플 realtime on Cloudflare Workers Free: static assets + SQLite Durable Objects (WebSocket Hibernation).
// Room DO (one per channel topic): presence, broadcast relay (pos filtered by floor = zone sync), FIFO queue, CAP per channel.
// Meter DO: daily (UTC) estimate of billed DO requests -> lean mode at 80%, solo (down) at 95% of the Free 100k/day.
// Supabase keeps auth, DB and RPCs only. No timers in DOs (hibernation-friendly); alarms only while someone waits.
import { DurableObject } from 'cloudflare:workers';
import { BALANCE, slotName, SLOT_IDS, PAY, scaledPay, bakeBase, danceBase, farePay, ballOpen, auctionClosed, stickerNext, chainBoost, cheerCount } from './balance.js';
import { nextBallUntil, drawSpan } from './live.js';
import { CHEER_PHRASES, EVENT_NAMES, allowedLink, blockedText, parseGuestHandover, statsFromCounts } from './plaza-account.js';
import { renderCardPng } from './cardpng.js';
import { ghostPacket } from './ts3d/walkers.js';
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
const MINE_GAP = 2000, MINE_CAP = 15, GAP_EARLY = 400;
const AD_PAY = 15, AD_DAY = 5; // link visit: once per account per board per KST day, AD_DAY boards a day
const MOVE_N = 8, MOVE_MS = 30000; // room moves per account: 8 in a row (a full queue bumps through square-2..8), then one per 30 s
const RELAY = ['take', 'react', 'jump'], RELAY_N = 30, RELAY_MS = 10000; // client broadcasts the game uses, numbers only; 30 per 10 s per socket
const EV_STEP = { page_landing: 1, enter_square: 2, first_coin: 4, board_claim: 8 }, EV_RET = [1, 7, 30], EV_KEEP = 14;
// Once-only and per-day gates per account: (uid, k, d) -> count, d = KST day or '' for ever. Counts only grow, so copies merge by max.
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
  snapInit() { if (this.sp) return; this.sp = 1; this.ctx.storage.sql.exec('create table if not exists snap(id text primary key, jpeg blob, at integer)'); }
  snapPut(id, bytes) { this.snapInit(); const q = this.ctx.storage.sql; q.exec('insert into snap values(?,?,?)', id, bytes, Date.now()); q.exec('delete from snap where at < ?', Date.now() - 7 * 86400000); const n = Number(q.exec('select count(*) n from snap').one().n) || 0; if (n > 400) q.exec('delete from snap where id in (select id from snap order by at asc limit ?)', n - 300); return { ok: true }; }
  snapGet(id) { this.snapInit(); const row = this.ctx.storage.sql.exec('select jpeg from snap where id = ?', id).toArray()[0]; return row?.jpeg || null; }
  // Account registry (instance 'acct'). An account sits in one room at a time. A room asks here only when the account is not already seated with it,
  // so there is no request per message. Moving closes the account's sockets in the old room, settles its pending coins and carries its once/daily
  // gates over (copies merge by max), so opening more topics or sockets never multiplies a limit.
  acInit() { if (this.ai) return; this.ai = 1; const q = this.ctx.storage.sql; q.exec(AG);
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
  // One day's rows (ids lo..hi) -> summary. A session is a tab (sid) and belongs to the last account it reported; a visitor is an account.
  // funnel = [landing, enter, first coin, claim] over visitors plus account-less sessions; funnel_new = the same over accounts first seen that day.
  evSum(day, lo, hi) { const q = this.ctx.storage.sql, S = new Map(), events = {};
    for (const r of q.exec('select t, sid, uid, k, p from evt where id >= ? and id < ?', lo, hi).toArray()) { const k = String(r.k); events[k] = (events[k] || 0) + 1; if (!r.sid) continue;
      let s = S.get(r.sid); if (!s) S.set(r.sid, s = { uid: '', t0: Number(r.t), t1: 0, dur: 0, f: 0, share: 0, claim: 0, focus: 0 }); if (r.uid) s.uid = String(r.uid); s.t1 = Number(r.t); s.f |= EV_STEP[k] || 0;
      if (k === 'share_send') s.share = 1; else if (k === 'board_claim') s.claim = 1; else if (k === 'focus_enter') s.focus = 1;
      if (k === 'session_end') { try { s.dur = Math.max(s.dur, Math.min(86400, Number(JSON.parse(r.p).dur) || 0)); } catch { } } }
    const who = new Map(), al = new Map(), lens = [], fAll = [0, 0, 0, 0], fNew = [0, 0, 0, 0], fresh = [], back = [], shareIds = new Set(), claimIds = new Set(), focusIds = new Set(); let anon = 0;
    const step = (f, to) => { for (let i = 0; i < 4; i++) if (f & (1 << i)) to[i]++; };
    for (const s of S.values()) { lens.push(Math.round(s.dur || (s.t1 - s.t0) / 1000)); let id = s.uid;
      if (id.startsWith('guest:')) { if (!al.has(id)) al.set(id, String(q.exec('select user from alias where guest = ?', id).toArray()[0]?.user || id)); id = al.get(id); }
      if (id) { who.set(id, (who.get(id) || 0) | s.f); if (s.share) shareIds.add(id); if (s.claim) claimIds.add(id); if (s.focus) focusIds.add(id); } else { anon++; step(s.f, fAll); } }
    let focus_new = 0;
    for (const [id, f] of who) { step(f, fAll); const d0 = q.exec('select d0 from seen where uid = ?', id).toArray()[0]?.d0;
      if (!d0 || d0 >= day) { fresh.push(id); step(f, fNew); if (focusIds.has(id)) focus_new++; } else back.push(Math.round((Date.parse(day) - Date.parse(d0)) / 864e5)); }
    lens.sort((a, b) => a - b); const len_avg = lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 0, len_med = lens.length ? lens[lens.length >> 1] : 0;
    return { fresh, back, sum: { visitors: who.size, new: fresh.length, returning: back.length, anon, sessions: S.size, len_avg, len_med, funnel: fAll, funnel_new: fNew, events, share_accounts: shareIds.size, claim_accounts: claimIds.size, focus_new } }; }
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
  cardInit() { if (this.ci) return; this.ci = 1; this.ctx.storage.sql.exec('create table if not exists cards(k text primary key, png blob, at integer)'); }
  cardGet(key) { this.cardInit(); const row = this.ctx.storage.sql.exec('select png from cards where k = ?', String(key || '')).toArray()[0]; return row?.png || null; }
  cardPut(key, bytes) { this.cardInit(); const png = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []); if (png.byteLength > 40000) return { ok: false };
    const q = this.ctx.storage.sql, k = String(key || ''); if (!q.exec('select k from cards where k = ?', k).toArray()[0]) { const n = Number(q.exec('select count(*) n from cards').one().n) || 0; if (n >= 61) q.exec('delete from cards where k in (select k from cards order by at asc limit ?)', n - 60); }
    q.exec('insert into cards(k, png, at) values(?, ?, ?) on conflict(k) do update set png = excluded.png, at = excluded.at', k, png, Date.now()); return { ok: true }; }
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
  async alarm() { this.tapDb(); this.scan(true); this.meter(true); await this.drawDue(); if (this.tapN && Date.now() - (this.tapAt || 0) >= FLUSH_MS - 1000) await this.flush(); if (this.adDirty && Date.now() - (this.adFlushAt || 0) > 30000) await this.flushAds(); try { await this.flushTribeScores(); } catch { /* scores retry on the next alarm */ }
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
    q.exec('create table if not exists seat(uid text primary key, fl integer not null)'); q.exec(AG);
    q.exec('create table if not exists sess(id text primary key, uid text not null, kind text not null, t0 integer not null, x integer not null, z integer not null)');
    q.exec('create table if not exists stk(slot text primary key, g text not null)');
    q.exec('create table if not exists chr(slot text primary key, n integer not null)');
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
    const state = this.payState(a);
    state.revenge = this.fareMult(a.k) > 1;
    const amount = farePay(riders, state);
    if (amount < 1) { this.tx(w, { t: 'PAY', kind: 'fare', amount: 0, why: 'cap' }); return; }
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
  cheer(w, a, m) {
    const p = Math.floor(Number(m.p));
    const slot = String(m.slot || '');
    if (!AD_SLOT.test(slot) || p < 1 || p > 12) return;
    const now = Date.now();
    const board = cachedBoard(slot);
    const until = Date.parse((board && (board.lit_until || board.expires_at)) || '');
    if (board && (!board.holder_id || board.holder_id === a.k || !(until > now))) { this.tx(w, { t: 'PAY', kind: 'cheer', amount: 0, why: 'dark' }); return; }
    this.tapDb();
    if (now - this.gateAt(a.k + '|cheer:' + slot) < PAY.cheer.gapMs - GAP_EARLY) { this.tx(w, { t: 'PAY', kind: 'cheer', amount: 0, why: 'soon' }); return; }
    this.gateSet(a.k + '|cheer:' + slot, now);
    const base = chainBoost(cachedBoards(), slot, now) ? BALANCE.cheerGroup : PAY.cheer.base;
    const amount = this.repeatPay(a, base, '', 'cheer', 12, PAY.cheer.perHour);
    if (amount < 1) { this.tx(w, { t: 'PAY', kind: 'cheer', amount: 0, why: 'cap' }); return; }
    const q = this.ctx.storage.sql, day = kstDay();
    agPut(q, a.k, 'qc', day, agGet(q, a.k, 'qc', day) + 1);
    this.tx(w, { t: 'PAY', kind: 'cheer', amount });
    this.shareCheer(slot, p);
    if (!this.inboxQ) this.inboxQ = [];
    const holder = board?.holder_id && board.holder_id !== a.k ? String(board.holder_id) : '';
    const fromName = clip(a.m?.name || '', 12);
    this.inboxQ.push({ kind: 'cheer', slot_id: slot, phrase: p, from_name: fromName, from: a.k, to: holder });
    if (holder) {
      const note = { t: 'INBOX', kind: 'cheer', slot_id: slot, phrase: p, from_name: fromName, from: a.k };
      for (const [sock, peer] of this.socks()) if (peer.q && peer.k === holder) this.tx(sock, note);
    }
    this.noteTribe(a.k, 1);
    try {
      const job = this.env.METER.get(this.env.METER.idFromName('ev'))?.touch?.(isoWeek(now), a.k);
      if (job && typeof job.then === 'function') job.catch(() => {});
    } catch { /* north-star touch is best-effort */ }
  }
  replyCheer(w, a, m) {
    const p = Math.floor(Number(m?.p));
    const slot = String(m?.slot || '');
    const to = String(m?.to || '').slice(0, 80);
    const ack = (ok) => this.tx(w, { t: 'INBOX', kind: 'reply_ack', ok: !!ok, phrase: p });
    if (!AD_SLOT.test(slot) || p < 1 || p > 12 || !to || to === a.k) return ack(false);
    const board = cachedBoard(slot);
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
    for (const row of rows) {
      const uid = String(row.uid || ''), day = String(row.d || ''), pts = tribePoints(row.v);
      if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(day) || pts < 1) continue;
      if (agGet(q, uid, 'tso', day)) continue;
      if (day >= today && pts < 7) continue;
      const week = isoWeek(Date.parse(day + 'T12:00:00+09:00'));
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
    this.adDirty = 1; }
  // Link visit pays once per account per board per KST day, AD_DAY boards a day.
  adClick(w, a, nick, slot) { if (!a?.k || !AD_SLOT.test(slot)) return false; this.tapDb(); const q = this.ctx.storage.sql, day = kstDay(), n = agGet(q, a.k, 'adn', day);
    if (n >= AD_DAY || agGet(q, a.k, 'ad:' + slot, day)) { if (w) this.tx(w, { t: 'PAY', kind: 'click', amount: 0, why: 'day', key: slot }); return false; }
    const pay = AD_PAY * this.feverScale(a.k); if (!this.credit(a, pay, nick, pay, 'click')) return false;
    agPut(q, a.k, 'adn', day, n + 1); agPut(q, a.k, 'ad:' + slot, day, 1); this.bumpAd(slot, 'clicks', a.k);
    if (w) this.tx(w, { t: 'PAY', kind: 'click', amount: pay });
    return true; }
  async flushAds() { this.tapDb(); const q = this.ctx.storage.sql; this.adFlushAt = Date.now();
    const rows = q.exec('select slot, views, clicks from adstat where dirty = 1 limit 40').toArray();
    if (!rows.length || typeof this.env.FLUSH_KEY !== 'string' || !this.env.FLUSH_KEY) { this.adDirty = rows.length ? 1 : 0; return; }
    const items = rows.map(r => ({ slot_id: String(r.slot), views: Number(r.views) || 0, clicks: Number(r.clicks) || 0 }));
    try {
      const r = await fetch(SUPA + '/rest/v1/rpc/ad_stat_batch', { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ p_key: this.env.FLUSH_KEY, p_items: items }) });
      if (!r.ok) throw new Error('ad ' + r.status);
      for (const row of rows) q.exec('update adstat set dirty = 0 where slot = ? and views = ? and clicks = ?', row.slot, row.views, row.clicks);
      this.adDirty = q.exec('select count(*) n from adstat where dirty = 1').one().n > 0 ? 1 : 0;
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
        items.push({ actor_id: row.uid, nickname: row.nick || '네온손님', delta, reason: row.reason || 'mine' });
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
  // inbox_batch writes the queued rows and trims each account to 50. A missing RPC keeps the queue.
  async flushInbox() {
    const items = this.inboxQ;
    if (!items?.length) return;
    const key = this.env.FLUSH_KEY;
    if (typeof key !== 'string' || !key) return;
    try {
      const r = await fetch(SUPA + '/rest/v1/rpc/inbox_batch', { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ p_key: key, p_items: items }) });
      const text = await r.text();
      if (!r.ok || /schema cache|Could not find|does not exist|42P01/i.test(text)) return;
      this.inboxQ = [];
    } catch { /* coin flush must not depend on the inbox table */ }
  }
  async httpFlush(req) { const uid = String(req.headers.get('x-uid') || ''); if (!uid) return J({ ok: false, error: 'auth' }, 401);
    try { this.tapDb(); const row = this.ctx.storage.sql.exec('select delta from coin where uid = ?', uid).toArray()[0]; if (!row?.delta) return J({ ok: true, pending: 0, flushed: 0 });
      const r = await this.flush(uid); return J(r.ok ? { ok: true, pending: 0, flushed: r.flushed || 0 } : r, r.ok ? 200 : 409);
    } catch { return J({ ok: false, error: '미정산 코인을 반영하지 못했습니다. 잠시 후 다시 시도해 주세요.', pending: true }, 409); } }
  // Clients no longer poll /rt/world or /rt/wallet while connected, so this push carries everything a claim changes: the row, the top-20 ranks,
  // and a WALLET_SYNC for third parties whose balance moved (m.sync). A message without kind tells clients to refetch the world (bulk change).
  async httpWorld(req) { let m = null; try { m = await req.json(); } catch { return J({ err: 'json' }, 400); }
    if (m && m.t === 'WORLD_UPDATE' && !m.kind) { const s = JSON.stringify({ t: 'WORLD_UPDATE' }); for (const w of this.socks().keys()) this.tx(w, s); return J({ ok: true, n: this.socks().size }); }
    if (!m || m.t !== 'WORLD_UPDATE' || (m.kind !== 'BILLBOARD' && m.kind !== 'PLOT') || !m.data || typeof m.data !== 'object') return J({ err: 'world' }, 400);
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
    else if (m.t === 'CHEER' && a.q) this.cheer(w, a, m);
    else if (m.t === 'REPLY' && a.q) this.replyCheer(w, a, m);
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
async function vapidAuth(env, endpoint) { if (!env.VAPID_PRIV) return null; if (!VK) VK = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIV), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = o => b64e(new TextEncoder().encode(JSON.stringify(o))), h = enc({ typ: 'JWT', alg: 'ES256' }), p = enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://studio.wishboard.workers.dev' });
  const g = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, VK, new TextEncoder().encode(h + '.' + p))); return `vapid t=${h}.${p}.${b64e(g)}, k=${VAPID_PUB}`; }
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
  if (row?.kind === 'taken') return `${name}님이 ${slot}을 가져갔어요`;
  if (row?.kind === 'cheer') return CHEER_PHRASES[Math.floor(Number(row.phrase)) - 1] || '';
  if (row?.kind === 'dark') return `${slot} 불이 곧 꺼져요`;
  if (row?.kind === 'gift') return `${name}님이 전광판을 선물했어요`;
  if (row?.kind === 'tribe') return '이번 주 소속 결과가 나왔어요';
  if (row?.kind === 'ball') return '21시 볼 드랍이 곧 시작돼요';
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
      if (!nick || rejectedCopy(nick)) return J({ ok: false, error: '그 이름은 쓸 수 없어요' }, 400);
      const rpc = await supabaseRpc('set_nickname', { p_key: env.FLUSH_KEY, p_actor_id: actor.id, p_nickname: nick });
      if (!rpc.ok || rpc.data?.ok === false) return J({ ok: false, error: '이름을 저장하지 못했어요' }, rpc.ok ? 400 : 502);
      out.nickname = rpc.data?.nickname || nick;
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
  const items = rows.slice(0, 20).map((row) => ({ id: row.id, kind: row.kind, slot_id: row.slot_id ?? null, phrase: row.phrase ?? null, from_name: row.from_name ?? null, from: row.from ?? null, created_at: row.created_at }));
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
let tribeRefundWeek = '';
let tribeRoofWeek = '';
const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...h } });
let GATE = { at: 0, r: null }; // per-isolate meter cache: /rt/gate no longer costs one Meter RPC per call
const GATE_TTL = 15000, PC = new Map(); // PC: per-isolate world cache (Cache API is a no-op on *.workers.dev)
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
async function rateOk(rl, req) { if (!rl) return true; try { return (await rl.limit({ key: req.headers.get('cf-connecting-ip') || 'x' })).success !== false; } catch { return true; } }
// WALLET_SYNC to one account, in the room it sits in (two DO calls). For balances moved by somebody else's request.
async function nudge(env, uid) { try { const room = await acct(env).roomOf(uid); if (room) await env.ROOM.get(env.ROOM.idFromName(room)).fetch(new Request('https://room.internal/sync', { method: 'POST', headers: { 'x-uid': uid } })); } catch { } }
function queueTaken(env, ctx, victim, fromName, slotId) {
  if (!victim) return;
  const job = supabaseRpc('inbox_batch', { p_key: env.FLUSH_KEY || '', p_items: [{ kind: 'taken', slot_id: slotId, from_name: clip(fromName, 12), to: String(victim) }] }).catch(() => {});
  try { ctx?.waitUntil?.(job); } catch { /* the claim still stands */ }
}
// Event properties: at most 6 short keys, numbers or strings up to 40 characters.
function evProps(p) { const o = {}; let n = 0; if (p && typeof p === 'object') for (const [k, v] of Object.entries(p)) { if (n >= 6) break; if (!/^[a-z_]{1,16}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) o[k] = v; else if (typeof v === 'string') o[k] = clip(v, 40); else continue; n++; } return n ? JSON.stringify(o) : ''; }
// today = { visitors, wishes } for the boot screen comes from the account registry: one DO call per cache refill (15 s), never per request.
async function readWorld(env) {
  const h = { apikey: ANON, accept: 'application/json' };
  const [bs, ps, rs, tally, live] = await Promise.all([
    fetch(SUPA + '/rest/v1/billboards?select=*&slot_id=in.(' + SLOT_IDS.join(',') + ')&order=slot_id.asc', { headers: h }),
    fetch(SUPA + '/rest/v1/plots?select=*&order=plot_id.asc', { headers: h }),
    fetch(SUPA + '/rest/v1/wallets?select=actor_id, nickname, spent, linked&spent=gt.0&order=spent.desc&limit=20', { headers: h }),
    Promise.resolve().then(() => acct(env).tallyOf(kstDay())).catch(() => null),
    supabaseRpc('plaza_live', { p_key: env.FLUSH_KEY || '' }).catch(() => null),
  ]);
  if (!bs.ok || !ps.ok) return { err: 'upstream ' + (bs.ok ? ps.status : bs.status) };
  const [billboards, plots, ranks] = await Promise.all([bs.json(), ps.json(), rs.ok ? rs.json() : null]);
  if (!Array.isArray(billboards) || !Array.isArray(plots)) return { err: 'shape' };
  const world = { billboards, plots, ranks: Array.isArray(ranks) ? ranks : [], today: { visitors: Number(tally?.visitors) || 0, wishes: Number(tally?.wishes) || 0 } };
  const row = live?.ok && live.data && typeof live.data === 'object' ? live.data : null;
  if (row?.ops?.id) world.ops = { id: String(row.ops.id), theme: String(row.ops.theme || ''), title: String(row.ops.title || ''), copy: String(row.ops.copy || '') };
  if (row && typeof row.roof === 'string') world.roof = row.roof;
  return { body: JSON.stringify(world), world, ranked: Array.isArray(ranks) };
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
async function settle(env, topic, actorId) {
  const res = await env.ROOM.get(env.ROOM.idFromName(topic)).fetch(new Request('https://room.internal/flush', { method: 'POST', headers: { 'x-uid': actorId } }));
  let data = {}; try { data = await res.json(); } catch { data = { ok: false }; }
  if (!res.ok || data.ok === false) return { ok: false, error: data.error || '미정산 코인을 반영하지 못했습니다. 잠시 후 다시 시도해 주세요.', pending: true };
  return { ok: true, pending: data.pending || 0, flushed: data.flushed || 0 };
}
const PROMO = new Map(); // ponytail: isolate memory. A restart lets the same account claim again. Move to a table if share grants get farmed.
async function promo(req, env, u) {
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const actor = await resolveActor(env, tokenOf(req));
  if (!actor) return J({ err: 'auth' }, 401);
  const day = kstDay();
  const ip = req.headers.get('cf-connecting-ip') || 'x';
  if (u.pathname === '/rt/share-bonus') {
    const ak = 's:' + actor.id + ':' + day, ik = 'i:' + ip + ':' + day;
    if (PROMO.get(ak) || PROMO.get(ik)) return J({ ok: false, error: '오늘은 이미 공유 보너스를 받았어요.' }, 400);
    const rpc = await supabaseRpc('grant_coins', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_amount: 300 });
    const data = rpc.data || {};
    if (!rpc.ok || data.ok === false) return J({ ok: false, error: data.error || '코인을 넣지 못했습니다.' }, rpc.ok ? 400 : 502);
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
async function plaza(req, env, ctx, u) {
  if (u.pathname === '/rt/world') {
    if (req.method !== 'GET') return J({ err: 'get' }, 405);
    const mem = PC.get('world'); if (mem && Date.now() - mem.at < PRAY_TTL * 1000) return new Response(mem.b, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    const key = new Request(WORLD_CACHE), c = caches.default; let r = await c.match(key);
    if (!r) { const got = await readWorld(env); if (got.err || !got.body) return J({ err: got.err || 'upstream' }, 502);
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
      let holder = cachedBoard(slot)?.holder_id || '';
      if (!holder) {
        const s = await fetch(SUPA + '/rest/v1/billboards?select=holder_id&slot_id=eq.' + encodeURIComponent(slot), { headers: { apikey: ANON, accept: 'application/json' } });
        const rows = s.ok ? await s.json() : [];
        holder = Array.isArray(rows) ? (rows[0]?.holder_id || '') : '';
      }
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
      return J({ ok: true, kind: 'sticker', glyph, slot_id: slot, list: added.list || [], remaining_coins: paidSt.remaining_coins ?? null, vip_tickets: paidSt.vip_tickets ?? null });
    } else if (kind === 'air') {
      if (!line) return J({ ok: false, error: '전광판에 올릴 한 줄을 적어 주세요.' }, 400);
      if (rejectedCopy(nick, line)) return J({ ok: false, error: 'blocked' }, 400);
      if (pay === 'ticket') tickets = 1;
      else coins = 5000;
    } else return J({ ok: false, error: '그 금액은 쓸 수 없어요.' }, 400);
    const spent = await supabaseRpc('spend_plaza', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_coins: coins, p_tickets: tickets });
    const paid = spent.data || {};
    const missing = /schema cache|Could not find the function/i.test(String(paid.message || paid.error || spent.data || ''));
    if (!spent.ok || paid.ok === false) return J({ ok: false, error: paid.error || (missing ? '코인 사용이 아직 준비 중이에요.' : '코인을 쓰지 못했어요.') }, spent.ok ? 400 : 502);
    if (kind === 'air') {
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
  let rpc, mode = 'claim';
  if (sell) {
    const slot = String(b.slot_id || '');
    const amount = Math.floor(Number(b.amount));
    if (!SLOT_RE.test(slot)) return J({ ok: false, error: '전광판 슬롯이 올바르지 않습니다.' }, 400);
    if (![10, 20, 50].includes(amount)) return J({ ok: false, error: '10, 20, 50코인만 팔 수 있어요.' }, 400);
    rpc = await supabaseRpc('sell_coins_to_advertiser', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_nickname: nick, p_slot_id: slot, p_amount: amount });
    const data = rpc.data || {};
    if (!rpc.ok || data.ok === false) return J({ ok: false, error: data.error || data.message || '판매를 처리하지 못했습니다.' }, rpc.ok ? 400 : 502);
    try { await env.ROOM.get(env.ROOM.idFromName(topic)).fetch(new Request('https://room.internal/sync', { method: 'POST', headers: { 'x-uid': actor.id } })); } catch { }
    if (data.buyer_id) ctx.waitUntil(nudge(env, String(data.buyer_id))); // the board holder's balance rose too
    return J({ ok: true, remaining_coins: data.remaining_coins ?? null, buyer_name: data.buyer_name || '', slot_id: slot, amount });
  }
  if (claim) {
    const slot = String(b.slot_id || ''); if (!SLOT_RE.test(slot)) return J({ ok: false, error: '전광판 슬롯이 올바르지 않습니다.' }, 400);
    mode = ['claim', 'edit', 'starter', 'tribe'].includes(b.mode) ? b.mode : 'claim';
    if (mode === 'starter') {
      if (b.bid !== 0) return J({ ok: false, error: 'starter' }, 400);
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
    if (mode === 'starter') {
      let used = 0;
      try { used = await acct(env).sipGet(await ipHash(env, req), kstDay()); } catch { used = 0; }
      if (used >= 3) return J({ ok: false, error: '오늘 무료 점령은 이 연결에서 세 번까지예요' }, 400);
    }
    const theme = String(b.bg_theme || '');
    if (rejectedCopy(nick, b.line1, b.line2, b.line3)) return J({ ok: false, error: 'blocked' }, 400);
    rpc = await supabaseRpc('claim_billboard', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_nickname: nick, p_slot_id: slot, p_bid: b.bid, p_line1: clip(b.line1, 16), p_line2: clip(b.line2, 16), p_line3: clip(b.line3, 16), p_emoji: clip(b.emoji || '✨', 4) || '✨', p_bg_theme: /^[\w-]{1,32}$/.test(theme) ? theme : 'cyber_navy', p_text_color: hexColor(b.text_color, '#ffffff'), p_external_url: allowedLink(b.external_url), p_caption_y: Math.min(88, Math.max(12, Math.round(Number(b.caption_y) || 72))), p_mode: mode });
  } else {
    if (!Number.isInteger(b.plot_id) || b.plot_id < 1 || b.plot_id > 18) return J({ ok: false, error: '토지 번호가 올바르지 않습니다.' }, 400);
    if (rejectedCopy(nick, b.sign_text)) return J({ ok: false, error: 'blocked' }, 400);
    rpc = await supabaseRpc('buy_or_upgrade_plot', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_nickname: nick, p_plot_id: b.plot_id, p_sign_text: clip(b.sign_text, 14), p_theme_color: hexColor(b.theme_color, '#00ffcc') });
  }
  const data = rpc.data || {};
  const claimErr = data.error === 'tribe' ? '소속에 들어간 뒤에 소속 코인으로 걸 수 있어요' : data.error === 'starter' ? '무료 칸은 계정당 한 번이고, 비어 있는 거리 칸만 돼요' : playerErr(data.error, data.message || '요청을 처리하지 못했습니다.');
  if (!rpc.ok || data.ok === false) return J({ ok: false, error: claimErr }, rpc.ok ? 400 : 502);
  if (claim && data.review_id) {
    try { await env.ROOM.get(env.ROOM.idFromName(topic)).fetch(new Request('https://room.internal/sync', { method: 'POST', headers: { 'x-uid': actor.id } })); } catch { }
    return J({ ok: true, review_id: data.review_id, remaining_coins: data.remaining_coins ?? null });
  }
  const kind = claim ? 'BILLBOARD' : 'PLOT'; const row = claim ? data.billboard : data.plot;
  if (!row || typeof row !== 'object') return J({ ok: false, error: 'empty' }, 502);
  if (claim && mode !== 'edit' && row.photo_id) {
    try { await supabaseRpc('clear_billboard_photo', { p_key: env.FLUSH_KEY || '', p_slot_id: row.slot_id }); } catch { /* the screen still drops the photo below */ }
    row.photo_id = null;
    row.photo_status = null;
  }
  if (claim) {
    try { await acct(env).wish(kstDay()); } catch { }
    if (mode === 'claim' || mode === 'starter' || mode === 'tribe') {
      try { await env.METER.get(env.METER.idFromName('ev')).touch(isoWeek(), actor.id); } catch { }
    }
    if (mode === 'claim' || mode === 'tribe') {
      try { ctx.waitUntil(noteTribe(env, topic, actor.id, 4)); } catch { /* the room keeps the day's score */ }
    }
    if (mode === 'starter') {
      try { await acct(env).sipAdd(await ipHash(env, req), kstDay()); } catch { }
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
    for (const name of squareTopics(topic)) {
      const br = await env.ROOM.get(env.ROOM.idFromName(name)).fetch(new Request('https://room.internal/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: 'WORLD_UPDATE', kind, data: row, ranks, sync, take, mono: data.monopoly_name || '' }) }));
      broadcast = broadcast || br.ok;
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
async function tribeApi(req, env, u) {
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
    const rpc = await supabaseRpc('pledge_tribe', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_slot_id: slot, p_amount: amount, p_week: isoWeek() });
    const data = rpc.data || {};
    const pledgeErr = data.error === 'tribe' ? '소속에 들어간 뒤에 모금할 수 있어요' : data.error === 'amount' ? '10, 20, 50코인만 모을 수 있어요' : data.error === 'week' ? '이번 주 모금을 열지 못했어요' : (data.error || data.message || '모금하지 못했어요.');
    if (!rpc.ok || data.ok === false) return J({ ok: false, error: pledgeErr }, rpc.ok ? 400 : 502);
    return J({ ok: true, tribe_id: data.tribe_id, amount: data.amount });
  }
  if (b.look) {
    const prev = isoWeek(Date.now() - 7 * 864e5);
    if (tribeRefundWeek !== prev) {
      try {
        const back = await supabaseRpc('refund_tribe_week', { p_key: env.FLUSH_KEY || '', p_week: prev });
        if (back.ok && back.data?.ok !== false) tribeRefundWeek = prev;
      } catch { /* the sheet still opens; the next look retries the refund */ }
    }
    if (kstDow() === 0 && tribeRoofWeek !== isoWeek()) {
      try {
        const roof = await supabaseRpc('award_tribe_roof', { p_key: env.FLUSH_KEY || '', p_week: isoWeek() });
        if (roof.ok && roof.data?.ok !== false) tribeRoofWeek = isoWeek();
      } catch { /* next Sunday open retries */ }
    }
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
  const rpc = await supabaseRpc('relight_billboard', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_slot_id: slot });
  const data = rpc.data || {};
  if (!rpc.ok || data.ok === false) return J({ ok: false, error: playerErr(data.error, data.message || '불을 켜지 못했어요') }, rpc.ok ? 400 : 502);
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
    if (row) await announce(env, ctx, squareTopics(topic), actor.id, row);
  } catch { /* the caller still has lit_until */ }
  return J({ ok: true, lit_until: data.lit_until, lit_days: data.lit_days, scored: data.scored === true });
}
async function announce(env, ctx, topics, uid, row) {
  try { await invalidateWorld(env, ctx); } catch { }
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
      return J({ ok: true, today, days: days.map(d => ({ ...d, ...statsFromCounts(d.events) })) });
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
async function accountApi(req, env, ctx, u) {
  if (u.pathname === '/rt/config') {
    if (req.method !== 'GET') return J({ err: 'get' }, 405);
    return J({ url: SUPA, key: ANON });
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
  const actor = await resolveActor(env, tokenOf(req));
  if (!actor || actor.guest || !actor.id.startsWith('user:')) return J({ err: 'auth' }, 401);
  if (u.pathname === '/rt/auth/withdraw') {
    const rpc = await supabaseRpc('withdraw_account', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id });
    const data = rpc.data || {};
    if (!rpc.ok || data.ok === false) return J({ ok: false, error: data.error || '탈퇴를 처리하지 못했습니다.' }, rpc.ok ? 400 : 502);
    try { await fetch(SUPA + '/auth/v1/user', { method: 'DELETE', headers: { apikey: ANON, Authorization: 'Bearer ' + tokenOf(req) } }); } catch { }
    try { await invalidateWorld(env, ctx); } catch { }
    // The account's boards and plots were cleared in bulk: tell every room so connected clients refetch the world.
    ctx.waitUntil(Promise.all(PLAZA_TOPICS.map(async t => { try { await env.ROOM.get(env.ROOM.idFromName(t)).fetch(new Request('https://room.internal/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"t":"WORLD_UPDATE"}' })); } catch { } })));
    return J({ ok: true });
  }
  const b = await readJson(req);
  const sub = parseGuestHandover(b?.guest_id);
  if (!sub) return J({ ok: false, error: '게스트 정보가 없습니다.' }, 400);
  const guestId = 'guest:' + sub;
  const G = await guestVerify(env, b?.guest_token, 180 * 86400);
  if (!G || G.s !== sub) return J({ err: 'guest' }, 401);
  const rpc = await supabaseRpc('merge_guest_account', { p_key: env.FLUSH_KEY || '', p_user_id: actor.id, p_guest_id: guestId, p_nickname: clip(b?.nickname || '', 16) });
  const data = rpc.data || {};
  if (!rpc.ok || data.ok === false) return J({ ok: false, error: data.error || '계정을 연결하지 못했습니다.' }, rpc.ok ? 400 : 502);
  try { await invalidateWorld(env, ctx); } catch { }
  ctx.waitUntil(Promise.resolve().then(() => env.METER.get(env.METER.idFromName('ev')).evAlias(guestId, actor.id)).catch(() => { })); // return and funnel numbers follow the person across the link
  return J({ ok: true, actor_id: actor.id, coins: data.coins, bonus: data.bonus || 0, linked: true, nickname: data.nickname || '' });
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
    return { ref, holder_name: String(row.holder_name || ''), line1: String(row.line1 || ''), line2: String(row.line2 || ''), line3: String(row.line3 || ''), tier: String(row.tier || ''), updated_at: String(row.updated_at || '') };
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
  const image = env.PLAN === 'paid' ? new URL('/rt/card/' + parsed.slot + '.png', req.url).href : 'https://studio.wishboard.workers.dev/og.jpg';
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
async function sendPushItems(env, items) {
  const dead = [];
  for (const row of items) {
    const body = pushText(row);
    if (!body || !row?.endpoint) continue;
    try {
      const enc = await encryptPush(row, new TextEncoder().encode(JSON.stringify({ body })));
      if (!enc) continue;
      const r = await fetch(row.endpoint, { method: 'POST', headers: { TTL: '1800', Urgency: 'high', Authorization: await vapidAuth(env, row.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' }, body: enc });
      if (r.status === 404 || r.status === 410) dead.push(row.endpoint);
    } catch { /* skip this send; the inbox row stays */ }
  }
  for (const endpoint of dead) { try { await supabaseRpc('push_drop', { p_key: env.FLUSH_KEY, p_endpoint: endpoint }); } catch { /* the next hour retries */ } }
}
export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url); budget(env);
    if (u.pathname === '/rt/snap' && req.method === 'POST') {
      const actor = await resolveActor(env, tokenOf(req)); if (!actor) return J({ err: 'auth' }, 401);
      const buf = await req.arrayBuffer();
      if (buf.byteLength < 800 || buf.byteLength > 900000) return J({ err: 'size' }, 400);
      const u8 = new Uint8Array(buf);
      if (u8[0] !== 0xff || u8[1] !== 0xd8) return J({ err: 'jpeg' }, 400);
      const id = crypto.randomUUID().replace(/-/g, '');
      await env.METER.get(env.METER.idFromName('snaps')).snapPut(id, u8);
      return J({ ok: true, url: new URL('/rt/snap/' + id, req.url).href });
    }
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
    if (u.pathname === '/rt/here' && req.method === 'GET') {
      try {
        const s = await env.ROOM.get(env.ROOM.idFromName('chapel:square')).stats();
        return J({ live: Number(s?.live) || 0 });
      } catch { return J({ live: 0 }); }
    }
    if (u.pathname === '/rt/gate') { try { const now = Date.now(); if (!GATE.r || now - GATE.at > GATE_TTL) { GATE = { at: now, r: await env.METER.get(env.METER.idFromName('day')).add(0) }; }
        const r = GATE.r, l = r.lvl, used = Math.round(r.n), gbs = Math.round(r.g);
        return J(l >= 2 ? { full: true, used, gbs } : { ok: true, cap: CAP, used, gbs, lean: l >= 1 }); } catch (e) { return J({ full: true, err: 1 }, 503); } }
    if (u.pathname === '/rt/sponsor' && req.method === 'GET') return J({ url: extUrl(env.SPONSOR_INQUIRY_URL) || '' });
    if (u.pathname === '/rt/share-bonus' || u.pathname === '/rt/redeem-code') return promo(req, env, u);
    if (u.pathname === '/rt/report') return fileReport(req, env);
    if (u.pathname.startsWith('/rt/card/')) return cardPage(req, env, u);
    if (u.pathname === '/rt/relight') return relightBoard(req, env, ctx);
    if (u.pathname === '/rt/tribe' || u.pathname === '/rt/tribe/pledge') return tribeApi(req, env, u);
    if (u.pathname === '/rt/world' || u.pathname === '/rt/wallet' || u.pathname === '/rt/claim-billboard' || u.pathname === '/rt/buy-plot' || u.pathname === '/rt/sell-coins' || u.pathname === '/rt/flush-wallet' || u.pathname === '/rt/spend') return plaza(req, env, ctx, u);
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
      if (req.method === 'DELETE') {
        const rpc = await supabaseRpc('push_unsubscribe', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_endpoint: endpoint });
        return J({ ok: !!(rpc.ok && rpc.data?.ok !== false) }, rpc.ok ? 200 : 502);
      }
      if (req.method !== 'POST') return J({ err: 'method' }, 405);
      const p256dh = b?.s?.keys?.p256dh, authKey = b?.s?.keys?.auth;
      if (typeof p256dh !== 'string' || typeof authKey !== 'string' || p256dh.length < 8 || authKey.length < 8) return J({ err: 'keys' }, 400);
      const rpc = await supabaseRpc('push_subscribe', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_endpoint: endpoint, p_p256dh: p256dh, p_auth: authKey });
      return J({ ok: !!(rpc.ok && rpc.data?.ok !== false) }, rpc.ok ? 200 : 502);
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
