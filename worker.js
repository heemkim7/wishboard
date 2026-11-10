// Worker name: studio (https://studio.wishboard.workers.dev)
// K-Times Square plaza on the same Workers Free stack: floor is fixed at 0.
// 마실채플 realtime on Cloudflare Workers Free: static assets + SQLite Durable Objects (WebSocket Hibernation).
// Room DO (one per channel topic): presence, broadcast relay (pos filtered by floor = zone sync), FIFO queue, CAP per channel.
// Meter DO: daily (UTC) estimate of billed DO requests -> lean mode at 80%, solo (down) at 95% of the Free 100k/day.
// Supabase keeps auth, DB and RPCs only. No timers in DOs (hibernation-friendly); alarms only while someone waits.
import { DurableObject } from 'cloudflare:workers';
// v16 cost pass: ping 25s (client) / STALE 75s, idle scan alarm 60s, meter report 60s, compact pos ('p'/'P'), nearby fanout, event ring + world cache, HMAC guest tokens.
const CAP = 100, MEM = 0.125, LEAN = 0.8, HARD = 0.95, STALE = 75000, SCAN = 5000, IDLE_SCAN = 60000, REP = 60000;
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
async function guestSign(env, sub) { const k = await gkey(env); if (!k) return null; const now = Math.floor(Date.now() / 1000), p = b64e(new TextEncoder().encode(JSON.stringify({ s: sub, e: now + 30 * 86400, i: now })));
  const g = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('g1.' + p))); return { token: 'g1.' + p + '.' + b64e(g), sub, exp: now + 30 * 86400 }; }
export async function guestVerify(env, t, graceS = 0) { const [v, p, g] = String(t || '').split('.'); if (v !== 'g1' || !g) return null; const k = await gkey(env); if (!k) return null;
  if (!(await crypto.subtle.verify('HMAC', k, b64u(g), new TextEncoder().encode('g1.' + p)))) return null; const P = JSON.parse(new TextDecoder().decode(b64u(p)));
  if (!/^g-[0-9a-f-]{36}$/.test(P.s || '') || (P.e + graceS) * 1000 < Date.now()) return null; return P; }
// Plaza identity. HMAC guests and Supabase users share one wallets.actor_id space.
export async function resolveActor(env, token) {
  try {
    const t = String(token || ''); if (!t) return null;
    if (t.startsWith('g1.')) { const G = await guestVerify(env, t); return G ? { id: 'guest:' + G.s, sub: G.s, guest: true, anon: true } : null; }
    const P = await verifyJwt(t); if (!P?.sub) return null; return { id: 'user:' + P.sub, sub: P.sub, guest: false, anon: !!P.is_anonymous };
  } catch { return null; }
}
const FLUSH_N = 20, FLUSH_MS = 30000;
const MINE_GAP = 2000, MINE_CAP = 15;

export class Meter extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.env = env; ctx.storage.sql.exec('create table if not exists d(day text primary key, n real)'); ctx.storage.sql.exec('create table if not exists g(day text primary key, s real)'); }
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
}

export class Room extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.env = env; budget(env); this.S = null; this.msgs = 0; this.conns = 0; this.lastRep = 0; this.lastScan = 0; this.lvl = 0; this.hist = null; this.room = null;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong')); }
  socks() { if (!this.S) { this.S = new Map(); for (const w of this.ctx.getWebSockets()) { const a = w.deserializeAttachment(); if (a) { a.fl = 0; if (a.m) a.m.fl = 0; this.S.set(w, a); } } } return this.S; }
  save(w, a) { try { w.serializeAttachment(a); } catch { } }
  adm() { let n = 0; for (const a of this.socks().values()) if (a.q) n++; return n; }
  waiters() { return [...this.socks()].filter(([, a]) => !a.q).sort((x, y) => x[1].t - y[1].t); }
  tx(w, o) { try { w.send(typeof o === 'string' ? o : JSON.stringify(o)); } catch { } }
  bc(o, skip) { const s = JSON.stringify(o); for (const [w, a] of this.socks()) if (a.q && w !== skip) this.tx(w, s); }
  // chat history ring kept in DO memory (lost on eviction -> one Supabase read to refill), replaces a Supabase select per room join
  async loadHist(room) { if (this.hist || !room) return this.hist || []; this.room = room; this.hist = []; return this.hist; }
  pushHist(p) { if (!this.hist || !p || typeof p.text !== 'string') return; this.hist.push({ name: String(p.name || '').slice(0, 12), body: p.text.slice(0, 80), created_at: new Date().toISOString() }); if (this.hist.length > HIST_N) this.hist.shift(); }
  pushEv(ev) { if (!this.hist) this.hist = []; this.hist.push(ev); if (this.hist.length > HIST_N) this.hist.shift(); }
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === '/flush') return this.httpFlush(req);
    if (u.pathname === '/world') return this.httpWorld(req);
    if (u.pathname === '/sync') return this.httpSync(req);
    const topic = u.searchParams.get('topic') || '', k = req.headers.get('x-uid') || ''; if (!k) return new Response('auth', { status: 401 });
    if (this.lvl >= 2) return new Response('down', { status: 503 });
    const room = (u.searchParams.get('room') || '').slice(0, 48), v2 = req.headers.get('x-v2') === '1';
    const [c, s] = Object.values(new WebSocketPair()); this.ctx.acceptWebSocket(s);
    const a = { k, an: req.headers.get('x-anon') === '1', m: null, q: false, t: Date.now() + Math.random(), ls: Date.now(), lob: /lobby$/.test(topic), v2, fl: 0 };
    this.socks().set(s, a); this.conns++;
    if (v2 && room && /^[\w:-]{1,48}$/.test(room) && !a.lob && /^chapel(qa)?:/.test(topic)) await this.loadHist(room);
    if (a.lob || this.adm() < CAP) this.admit(s, a); else { this.save(s, a); this.waitMsgs(); }
    this.arm(); this.meter(); return new Response(null, { status: 101, webSocket: c, headers: { 'Sec-WebSocket-Protocol': v2 ? 'masil2' : 'masil' } });
  }
  admit(w, a) { a.q = true; a.fl = 0; if (a.m) a.m.fl = 0; this.save(w, a); const st = {}; for (const b of this.socks().values()) if (b.q && b.m) { b.fl = 0; b.m.fl = 0; st[b.k] = b.m; }
    const o = { t: 'ok', s: st, cap: a.lob ? 0 : CAP, live: this.adm(), lean: this.lvl >= 1 }; if (a.v2 && this.hist) o.h = this.hist; this.tx(w, o); }
  waitMsgs() { const ws = this.waiters(), live = this.adm(); ws.forEach(([w], i) => this.tx(w, { t: 'wait', pos: i + 1, live, cap: CAP })); }
  promote() { let n = this.adm(); for (const [w, a] of this.waiters()) { if (n >= CAP) break; this.admit(w, a); n++; } this.waitMsgs(); }
  // alarm: fast (5s) while someone waits or taps are pending, otherwise a slow 60s stale scan while any socket is connected
  async arm() { const fast = this.waiters().length || this.tapN, any = this.socks().size; if (!fast && !any) return; const want = Date.now() + (fast ? SCAN : IDLE_SCAN), cur = await this.ctx.storage.getAlarm();
    if (!cur || (fast && cur > want)) await this.ctx.storage.setAlarm(want); }
  async alarm() { this.tapDb(); this.scan(true); this.meter(true); if (this.tapN && Date.now() - (this.tapAt || 0) >= FLUSH_MS - 1000) await this.flush();
    if (this.waiters().length || this.tapN) await this.ctx.storage.setAlarm(Date.now() + (this.waiters().length ? SCAN : FLUSH_MS)); else if (this.socks().size) await this.ctx.storage.setAlarm(Date.now() + IDLE_SCAN); }
  // Bungeo-ppang coins: 2s per actor, ≤15 per mine, summed in DO SQLite (survives hibernation) with tapN in memory.
  // alarm()/arm() still key off tapN: flush on FLUSH_N accepted mines or the FLUSH_MS alarm.
  tapDb() { if (this._tdb) return; const q = this.ctx.storage.sql;
    q.exec('create table if not exists coin(uid text primary key, nick text, delta integer not null, n integer not null, at integer not null)');
    q.exec('create table if not exists rate(uid text primary key, at integer not null)');
    this._tdb = 1; this.syncPending(); }
  syncPending() { const q = this.ctx.storage.sql; this.tapN = Number(q.exec('select coalesce(sum(n),0) s from coin').one().s) || 0; const age = q.exec('select min(at) a from coin').one().a; if (age) this.tapAt = Number(age); }
  addMine(a, amount, nick) { if (!a?.k || this.lvl >= 2) return false; this.tapDb(); const now = Date.now();
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return false; const credit = Math.min(MINE_CAP, Math.floor(amount)); if (credit < 1) return false;
    const q = this.ctx.storage.sql; const prev = q.exec('select at from rate where uid = ?', a.k).toArray()[0]; if (prev && now - Number(prev.at) < MINE_GAP) return false;
    const name = clip(nick, 16); q.exec('insert into rate(uid, at) values(?, ?) on conflict(uid) do update set at = excluded.at', a.k, now);
    if (!this.tapN) this.tapAt = now;
    q.exec('insert into coin(uid, nick, delta, n, at) values(?, ?, ?, 1, ?) on conflict(uid) do update set delta = delta + excluded.delta, n = n + excluded.n, nick = excluded.nick, at = min(coin.at, excluded.at)', a.k, name, credit, now);
    this.tapN++; if (Math.random() < 0.02) q.exec('delete from rate where at < ?', now - 86400000);
    if (this.tapN >= FLUSH_N) this.flush(); else this.arm(); return true; }
  flush(onlyUid) { const prev = this._fq || Promise.resolve(); const job = prev.then(() => this._flush(onlyUid)); this._fq = job.then(() => {}, () => {}); return job; }
  async _flush(onlyUid) { this.tapDb(); const q = this.ctx.storage.sql;
    const raw = onlyUid ? q.exec('select uid, nick, delta, n, at from coin where uid = ?', onlyUid).toArray() : q.exec('select uid, nick, delta, n, at from coin limit 500').toArray();
    const rows = raw.map(r => ({ uid: String(r.uid), nick: r.nick == null ? '' : String(r.nick), delta: Number(r.delta) || 0, n: Number(r.n) || 0, at: Number(r.at) || Date.now() })).filter(r => r.delta > 0 && r.n > 0);
    if (!rows.length) { this.syncPending(); return { ok: true, flushed: 0, pending: 0 }; }
    const kept = []; for (const row of rows) if (q.exec('delete from coin where uid = ? and delta = ? and n = ?', row.uid, row.delta, row.n).rowsWritten) kept.push(row);
    if (!kept.length) { this.syncPending(); return { ok: true, flushed: 0, pending: 0 }; }
    const items = kept.map(row => ({ actor_id: row.uid, nickname: row.nick || '네온손님', delta: row.delta }));
    try {
      if (typeof this.env.FLUSH_KEY !== 'string' || !this.env.FLUSH_KEY) throw new Error('missing FLUSH_KEY');
      const r = await fetch(SUPA + '/rest/v1/rpc/coin_batch', { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ p_key: this.env.FLUSH_KEY, p_items: items }) });
      const text = await r.text(); let out = null; try { out = JSON.parse(text); } catch { out = null; }
      if (!r.ok || !out || out.ok === false) throw new Error('flush ' + r.status);
      this.syncPending(); this.flushes = (this.flushes || 0) + 1; this.flushErr = null;
      for (const row of kept) for (const [w, b] of this.socks()) if (b.k === row.uid) this.tx(w, { t: 'WALLET_SYNC' });
      if (this.tapN) this.arm(); return { ok: true, flushed: kept.length, pending: 0 };
    } catch (e) {
      for (const row of kept) q.exec('insert into coin(uid, nick, delta, n, at) values(?, ?, ?, ?, ?) on conflict(uid) do update set delta = delta + excluded.delta, n = n + excluded.n, nick = excluded.nick, at = min(coin.at, excluded.at)', row.uid, row.nick, row.delta, row.n, row.at);
      this.syncPending(); this.flushErr = String(e).slice(0, 80); try { this.arm(); } catch { }
      return { ok: false, error: '미정산 코인을 반영하지 못했습니다. 잠시 후 다시 시도해 주세요.', pending: true };
    } }
  async httpFlush(req) { const uid = String(req.headers.get('x-uid') || ''); if (!uid) return J({ ok: false, error: 'auth' }, 401);
    try { this.tapDb(); const row = this.ctx.storage.sql.exec('select delta from coin where uid = ?', uid).toArray()[0]; if (!row?.delta) return J({ ok: true, pending: 0, flushed: 0 });
      const r = await this.flush(uid); return J(r.ok ? { ok: true, pending: 0, flushed: r.flushed || 0 } : r, r.ok ? 200 : 409);
    } catch { return J({ ok: false, error: '미정산 코인을 반영하지 못했습니다. 잠시 후 다시 시도해 주세요.', pending: true }, 409); } }
  async httpWorld(req) { let m = null; try { m = await req.json(); } catch { return J({ err: 'json' }, 400); }
    if (!m || m.t !== 'WORLD_UPDATE' || (m.kind !== 'BILLBOARD' && m.kind !== 'PLOT') || !m.data || typeof m.data !== 'object') return J({ err: 'world' }, 400);
    const msg = { t: 'WORLD_UPDATE', kind: m.kind, data: m.data }; this.pushEv(msg); const s = JSON.stringify(msg); for (const w of this.socks().keys()) this.tx(w, s); return J({ ok: true, n: this.socks().size }); }
  httpSync(req) { const uid = String(req.headers.get('x-uid') || ''); let n = 0; for (const [w, b] of this.socks()) if (b.k === uid) { this.tx(w, { t: 'WALLET_SYNC' }); n++; } return J({ ok: true, n }); }
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
    if (now - (a.sv || 0) > 2000) { a.sv = now; this.save(w, a); }
    const far = anim !== 'walk' || now - (a.fz || 0) >= FAR_MS; if (far) a.fz = now; let sc = null, sl = null;
    for (const [x2, b] of this.socks()) { if (x2 === w || !b.q || b.lob) continue; b.fl = 0; if (b.m) b.m.fl = 0; if (b.fl != null && a.fl != null && b.fl !== a.fl) continue;
      const bm = b.m, near = !bm || bm.x == null || (Math.abs(bm.x - x) <= NEAR_R && Math.abs(bm.y - y) <= NEAR_R); if (!near && !far) continue;
      if (b.v2) this.tx(x2, sc ||= JSON.stringify({ t: 'P', k: a.k, a: [x, y, face, anim, fl, vx, vy] }));
      else this.tx(x2, sl ||= JSON.stringify({ t: 'b', e: 'pos', p: { id: a.k, x, y, face, anim, fl, vx, vy } })); } }
  async webSocketMessage(w, msg) { this.msgs++; const a = this.socks().get(w); if (!a || typeof msg !== 'string' || msg.length > 4000) return; a.ls = Date.now();
    let m; try { m = JSON.parse(msg); } catch { return; }
    if (m.t === 'p' && a.q && Array.isArray(m.a) && m.a.length <= 8) { const A = m.a, n = v => (typeof v === 'number' && isFinite(v) ? Math.round(v) : 0), sv = v => (typeof v === 'string' ? v.slice(0, 12) : null);
      this.relayPos(w, a, [n(A[0]), n(A[1]), sv(A[2]), sv(A[3]), (typeof A[4] === 'number' && isFinite(A[4])) ? A[4] : sv(A[4]), n(A[5]), n(A[6])]); }
    else if (m.t === 'MINE' && a.q) this.addMine(a, m.amount, m.nick);
    else if (m.t === 'E' && a.q) { const e = m.e; if (Number.isInteger(e) && e >= 1 && e <= 4) { this.bc({ t: 'E', k: a.k, e }, w); this.pushEv({ t: 'E', k: a.k, e }); } }
    else if (m.t === 'b' && a.q) { const e = String(m.e || '').slice(0, 16), p = m.p;
      if (p && typeof p === 'object') p.id = a.k; // identity always from the verified token
      if (e === 'pos' && p) this.relayPos(w, a, [p.x, p.y, p.face, p.anim, p.fl, p.vx, p.vy]);
      else { if (e === 'chat') this.pushHist(p); this.bc({ t: 'b', e, p }, w); } }
    else if (m.t === 'tr' && m.m && typeof m.m === 'object' && JSON.stringify(m.m).length < 1500) { const M = m.m, keep = ['name', 'outfit', 'av', 'equip', 'fl', 'x', 'y', 'face', 'anim', 'st', 'seat', 'g', 'hair', 'dong', 'shard', 'act', 'at', 'seat_id', 'look', 'state', 'step', 'mode', 'joined_at'];
      a.m = { id: a.k }; for (const f of keep) if (M[f] !== undefined) a.m[f] = M[f]; if (typeof a.m.name === 'string') a.m.name = a.m.name.slice(0, 12); a.m.fl = 0; a.fl = 0; this.save(w, a); if (a.q) this.bc({ t: 'pj', k: a.k, m: a.m }); }
    else if (m.t === 'ut') { a.m = null; this.save(w, a); if (a.q) this.leaveK(a.k, w); }
    this.scan(); this.meter(); }
  async webSocketClose(w, code) { this.gone(w); try { w.close(code === 1005 ? 1000 : code, 'bye'); } catch { } }
  async webSocketError(w) { this.gone(w); }
  stats() { this.tapDb(); return { live: this.adm(), wait: this.waiters().length, lvl: this.lvl, tapPending: this.tapN, flushes: this.flushes || 0, flushErr: this.flushErr || null, hist: this.hist ? this.hist.length : null, v2: [...this.socks().values()].filter(a => a.v2).length }; }
}

// q5 VAPID web push (payload-less). Public key is public; the private JWK lives only in the Worker secret VAPID_PRIV.
const VAPID_PUB = 'BLw-Ohwbu6DrhQF2m-FwsmMo41N8gYElXddgqaHosG5GHBCnsp1S7IkDL4GSMNcIxPBomsaVWDOVVuI4g3vn-Kw', PUSH_HOSTS = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[\w.-]+\.notify\.windows\.com|web\.push\.apple\.com|[\w.-]+\.push\.apple\.com)$/;
const PUSH_N = 40; // Workers Free: 50 subrequests per invocation
const kstDay = (t = Date.now()) => new Date(t + 9 * 36e5).toISOString().slice(0, 10);
const isoWeek = (t = Date.now()) => { const d = new Date(t + 9 * 36e5), w = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), dn = (w.getUTCDay() + 6) % 7; w.setUTCDate(w.getUTCDate() - dn + 3); const y = w.getUTCFullYear(), f = new Date(Date.UTC(y, 0, 4)); return y + 'W' + String(1 + Math.round(((w - f) / 864e5 - 3 + ((f.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0'); };
let VK = null;
async function vapidAuth(env, endpoint) { if (!env.VAPID_PRIV) return null; if (!VK) VK = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIV), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = o => b64e(new TextEncoder().encode(JSON.stringify(o))), h = enc({ typ: 'JWT', alg: 'ES256' }), p = enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://studio.wishboard.workers.dev' });
  const g = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, VK, new TextEncoder().encode(h + '.' + p))); return `vapid t=${h}.${p}.${b64e(g)}, k=${VAPID_PUB}`; }
const GRP = { at: 0, w: '', v: null };
const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...h } });
let GATE = { at: 0, r: null }; // per-isolate meter cache: /rt/gate no longer costs one Meter RPC per call
const GATE_TTL = 15000, PC = new Map(); // PC: per-isolate world cache (Cache API is a no-op on *.workers.dev)
const WORLD_CACHE = 'https://cache.masil/rt/world';
const TOPIC_RE = /^chapel(qa)?:[^\s/]{1,96}$/;
const SLOT_RE = /^(MAIN_S|SUB_B[1-4]|PLOT_(?:[1-9]|1\d|20)|WALL_(?:[1-9]|[1-5]\d|6[0-4])|TOWER_[1-5])$/;
function clip(s, n) { return Array.from(String(s ?? '').replace(/[\u0000-\u001f]/g, '')).slice(0, n).join(''); }
function tokenOf(req) { const a = req.headers.get('authorization') || ''; return a.startsWith('Bearer ') ? a.slice(7).trim() : ''; }
function hexColor(s, d) { const t = String(s || '').trim(); return /^#[0-9a-fA-F]{3,8}$/.test(t) ? t : d; }
function extUrl(s) { if (s == null || s === '') return null; const t = String(s).trim().slice(0, 200); try { const x = new URL(t); return x.protocol === 'https:' ? t : null; } catch { return null; } }
async function readJson(req) { const n = Number(req.headers.get('content-length') || 0); if (n > 10000) return null; try { const b = await req.json(); return b && typeof b === 'object' ? b : null; } catch { return null; } }
async function readWorld() {
  const h = { apikey: ANON, accept: 'application/json' };
  const [bs, ps] = await Promise.all([
    fetch(SUPA + '/rest/v1/billboards?select=*&order=slot_id.asc', { headers: h }),
    fetch(SUPA + '/rest/v1/plots?select=*&order=plot_id.asc', { headers: h }),
  ]);
  if (!bs.ok || !ps.ok) return { err: 'upstream ' + (bs.ok ? ps.status : bs.status) };
  const [billboards, plots] = await Promise.all([bs.json(), ps.json()]);
  if (!Array.isArray(billboards) || !Array.isArray(plots)) return { err: 'shape' };
  return { body: JSON.stringify({ billboards, plots }) };
}
async function invalidateWorld(ctx) {
  PC.delete('world');
  try { await caches.default.delete(new Request(WORLD_CACHE)); } catch { }
  try {
    const got = await readWorld(); if (!got.body) return;
    PC.set('world', { at: Date.now(), b: got.body });
    const put = caches.default.put(new Request(WORLD_CACHE), new Response(got.body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + PRAY_TTL } }));
    if (ctx) ctx.waitUntil(put); else await put;
  } catch { }
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
async function plaza(req, env, ctx, u) {
  if (u.pathname === '/rt/world') {
    if (req.method !== 'GET') return J({ err: 'get' }, 405);
    const mem = PC.get('world'); if (mem && Date.now() - mem.at < PRAY_TTL * 1000) return new Response(mem.b, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    const key = new Request(WORLD_CACHE), c = caches.default; let r = await c.match(key);
    if (!r) { const got = await readWorld(); if (got.err || !got.body) return J({ err: got.err || 'upstream' }, 502);
      r = new Response(got.body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + PRAY_TTL } }); ctx.waitUntil(c.put(key, r.clone())); }
    const body = await r.text(); if (PC.size > 500) PC.clear(); PC.set('world', { at: Date.now(), b: body });
    return new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  if (u.pathname === '/rt/wallet') {
    if (req.method !== 'GET') return J({ err: 'get' }, 405);
    const actor = await resolveActor(env, tokenOf(req)); if (!actor) return J({ err: 'auth' }, 401);
    const q = u.searchParams.get('actor_id'); if (q && q !== actor.id) return J({ err: 'actor' }, 403);
    const s = await fetch(SUPA + '/rest/v1/wallets?select=actor_id,nickname,coins,vip_tickets,updated_at&actor_id=eq.' + encodeURIComponent(actor.id), { headers: { apikey: ANON, accept: 'application/json' } });
    if (!s.ok) return J({ err: 'upstream ' + s.status }, 502);
    const rows = await s.json(); const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return J({ ok: true, actor_id: actor.id, nickname: '네온손님', coins: 100, vip_tickets: 0, exists: false });
    const coins = Number(row.coins); return J({ ok: true, actor_id: row.actor_id, nickname: row.nickname, coins: Number.isFinite(coins) ? coins : 0, vip_tickets: Number(row.vip_tickets) || 0, exists: true });
  }
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const actor = await resolveActor(env, tokenOf(req)); if (!actor) return J({ err: 'auth' }, 401);
  const b = await readJson(req); if (!b) return J({ err: 'json' }, 400);
  const topic = typeof b.topic === 'string' ? b.topic : '';
  if (!TOPIC_RE.test(topic)) return J({ ok: false, error: '광장 접속 정보가 없습니다. 다시 입장한 뒤 시도해 주세요.', pending: true }, 400);
  const settled = await settle(env, topic, actor.id);
  if (!settled.ok) return J({ ok: false, error: settled.error, pending: true }, 409);
  const nick = clip(b.nickname || b.nick || '', 16) || '네온손님';
  const claim = u.pathname === '/rt/claim-billboard';
  let rpc;
  if (claim) {
    const slot = String(b.slot_id || ''); if (!SLOT_RE.test(slot)) return J({ ok: false, error: '전광판 슬롯이 올바르지 않습니다.' }, 400);
    if (!Number.isInteger(b.bid) || b.bid < 1 || b.bid > 1000000000) return J({ ok: false, error: '입찰 금액이 올바르지 않습니다.' }, 400);
    const theme = String(b.bg_theme || '');
    rpc = await supabaseRpc('claim_billboard', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_nickname: nick, p_slot_id: slot, p_bid: b.bid, p_line1: clip(b.line1, 16), p_line2: clip(b.line2, 16), p_line3: clip(b.line3, 16), p_emoji: clip(b.emoji || '✨', 4) || '✨', p_bg_theme: /^[\w-]{1,32}$/.test(theme) ? theme : 'cyber_navy', p_text_color: hexColor(b.text_color, '#ffffff'), p_external_url: extUrl(b.external_url) });
  } else {
    if (!Number.isInteger(b.plot_id) || b.plot_id < 1 || b.plot_id > 20) return J({ ok: false, error: '토지 번호가 올바르지 않습니다.' }, 400);
    rpc = await supabaseRpc('buy_or_upgrade_plot', { p_key: env.FLUSH_KEY || '', p_actor_id: actor.id, p_nickname: nick, p_plot_id: b.plot_id, p_sign_text: clip(b.sign_text, 14), p_theme_color: hexColor(b.theme_color, '#00ffcc') });
  }
  const data = rpc.data || {};
  if (!rpc.ok || data.ok === false) return J({ ok: false, error: data.error || data.message || '요청을 처리하지 못했습니다.' }, rpc.ok ? 400 : 502);
  const kind = claim ? 'BILLBOARD' : 'PLOT'; const row = claim ? data.billboard : data.plot;
  if (!row || typeof row !== 'object') return J({ ok: false, error: 'empty' }, 502);
  try { await invalidateWorld(ctx); } catch { }
  let broadcast = false;
  try {
    const br = await env.ROOM.get(env.ROOM.idFromName(topic)).fetch(new Request('https://room.internal/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: 'WORLD_UPDATE', kind, data: row }) }));
    broadcast = br.ok;
    await env.ROOM.get(env.ROOM.idFromName(topic)).fetch(new Request('https://room.internal/sync', { method: 'POST', headers: { 'x-uid': actor.id } }));
  } catch { broadcast = false; }
  return J({ ok: true, kind, data: row, remaining_coins: data.remaining_coins ?? null, broadcast });
}
// Photo billboards (operator-approved). The holder uploads a browser re-encoded JPEG (≤300 KB, EXIF already gone);
// Supabase keeps the bytes in billboard_photos (no public read) and charges the tier fee in the same RPC.
// Players only receive approved photos from /rt/photo/<id>; the Worker secret ADMIN_KEY unlocks review.
const PHOTO_MAX = 300000, PHOTO_ID_RE = /^[0-9a-f]{40}$/, PHOTO_GAP = 10000, PHOTO_TTL = 300000;
const PHOTO_C = new Map(), PHOTO_AT = new Map(), PLAZA_TOPICS = ['chapel:square', 'chapelqa:square'];
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
function adminOk(env, req) {
  const want = env.ADMIN_KEY, got = req.headers.get('x-admin-key') || '';
  if (typeof want !== 'string' || want.length < 12 || got.length !== want.length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}
async function announce(env, ctx, topics, uid, row) {
  try { await invalidateWorld(ctx); } catch { }
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
    if (!TOPIC_RE.test(topic)) return J({ ok: false, error: '광장 접속 정보가 없습니다. 다시 입장한 뒤 시도해 주세요.', pending: true }, 400);
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
    if (data.billboard) await announce(env, ctx, TOPIC_RE.test(String(b.topic || '')) ? [b.topic] : PLAZA_TOPICS, data.photo?.actor_id || '', data.billboard);
    return J({ ok: true, billboard: data.billboard || null, photo: data.photo || null });
  }
  return J({ err: 'not found' }, 404);
}
export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url); budget(env);
    if (u.pathname === '/rt/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return J({ err: 'get' }, 405);
      return J({ hasFlushKey: typeof env.FLUSH_KEY === 'string' && env.FLUSH_KEY.length > 0, hasGuestKey: typeof env.GUEST_KEY === 'string' && env.GUEST_KEY.length > 0, mode: 'DO' });
    }
    if (u.pathname === '/rt/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
      const t = u.searchParams.get('topic') || ''; if (!/^chapel(qa)?:[^\s/]{1,96}$/.test(t)) return new Response('bad topic', { status: 400 });
      const pr = (req.headers.get('Sec-WebSocket-Protocol') || '').split(',').map(x => x.trim()), at = (pr.find(x => x.startsWith('at.')) || '').slice(3), v2 = pr.includes('masil2');
      const actor = await resolveActor(env, at); if (!actor) return new Response('unauthorized', { status: 401 });
      const h = new Headers(req.headers); h.set('x-uid', actor.id); h.set('x-anon', (actor.guest || actor.anon) ? '1' : '0'); h.set('x-v2', v2 ? '1' : '0');
      return env.ROOM.get(env.ROOM.idFromName(t)).fetch(new Request(req, { headers: h }));
    }
    if (u.pathname === '/rt/guest') { if (req.method !== 'POST') return J({ err: 'post' }, 405); if (!env.GUEST_KEY) return J({ err: 'no guest key' }, 503);
      let old = null; try { const b = await req.json(); if (b && typeof b.t === 'string') old = await guestVerify(env, b.t, 180 * 86400); } catch { }
      return J(await guestSign(env, old ? old.s : 'g-' + crypto.randomUUID())); }
    if (u.pathname === '/rt/gate') { try { const now = Date.now(); if (!GATE.r || now - GATE.at > GATE_TTL) { GATE = { at: now, r: await env.METER.get(env.METER.idFromName('day')).add(0) }; }
        const r = GATE.r, l = r.lvl, used = Math.round(r.n), gbs = Math.round(r.g);
        return J(l >= 2 ? { full: true, used, gbs } : { ok: true, cap: CAP, used, gbs, lean: l >= 1 }); } catch (e) { return J({ full: true, err: 1 }, 503); } }
    if (u.pathname === '/rt/world' || u.pathname === '/rt/wallet' || u.pathname === '/rt/claim-billboard' || u.pathname === '/rt/buy-plot') return plaza(req, env, ctx, u);
    if (u.pathname === '/rt/billboard-photo' || u.pathname.startsWith('/rt/photo/') || u.pathname.startsWith('/rt/admin/')) return photos(req, env, ctx, u);
    if (u.pathname === '/rt/grp') { const M = env.METER.get(env.METER.idFromName('grp'));
      if (req.method === 'GET') { const w = isoWeek(); if (GRP.w !== w || Date.now() - GRP.at > 60000) { GRP.v = await M.grpTop(w); GRP.at = Date.now(); GRP.w = w; } return J({ w, top: GRP.v }); }
      if (req.method !== 'POST') return J({ err: 'method' }, 405); let b = null; try { b = await req.json(); } catch { }
      if (!b || !/^[A-Z2-9]{6}$/.test(b.c || '')) return J({ err: 'code' }, 400); const G = await guestVerify(env, b.t).catch(() => null); if (!G) return J({ err: 'auth' }, 401);
      const r = await M.grpAdd(b.c, G.s, kstDay(), isoWeek()); GRP.at = 0; return J(r); }
    if (u.pathname === '/rt/push/key') return J({ k: VAPID_PUB }, 200, { 'cache-control': 'public, max-age=3600' });
    if (u.pathname === '/rt/push') { const M = env.METER.get(env.METER.idFromName('grp')); let b = null; try { b = await req.json(); } catch { }
      const e = req.method === 'DELETE' ? b?.e : b?.s?.endpoint; let ok = false; try { const x = new URL(e); ok = x.protocol === 'https:' && PUSH_HOSTS.test(x.hostname) && e.length < 600; } catch { }
      if (!ok) return J({ err: 'endpoint' }, 400); if (req.method === 'DELETE') return J(await M.pushDel(e)); if (req.method !== 'POST') return J({ err: 'method' }, 405); return J(await M.pushAdd(e)); }
    if (u.pathname === '/rt/room') { const t = u.searchParams.get('topic') || ''; if (!/^chapelqa:/.test(t)) return J({ err: 'qa only' }, 403);
      return J(await env.ROOM.get(env.ROOM.idFromName(t)).stats()); }
    if (u.pathname === '/.env.local' || u.pathname === '/.git/config' || u.pathname.startsWith('/.env') || u.pathname.startsWith('/.git/')) return new Response(null, { status: 404 });
    return env.ASSETS.fetch(req);
  },
  // q5 cron "10,50 1 * * 0" (UTC) = 주일 10:10 / 10:50 KST → 예배 50분/10분 전 알림. Free plan: <= PUSH_N sends per run (oldest-first).
  async scheduled(ev, env, ctx) { if (!env.VAPID_PRIV) return; const M = env.METER.get(env.METER.idFromName('grp')), tag = Math.floor(ev.scheduledTime / 60000);
    const list = await M.pushBatch(PUSH_N, tag); const dead = [];
    await Promise.all(list.map(async e => { try { const r = await fetch(e, { method: 'POST', headers: { TTL: '1800', Urgency: 'high', Authorization: await vapidAuth(env, e), 'Content-Length': '0' } }); if (r.status === 404 || r.status === 410) dead.push(e); } catch { } }));
    for (const e of dead.slice(0, 5)) await M.pushDel(e); }
};
