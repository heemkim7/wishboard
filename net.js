// Realtime multiplayer via Supabase Realtime (Presence = who's here, Broadcast = ≤2Hz moves, chat, emotes, jumps).
// SYNC LAYER: this file is the ONLY module that talks to the realtime transport. The game uses just
//   join(room,me) leave() tick(me) sample(peer) send(ev,payload) chat() on(ev,fn) lobby()/leaveLobby() peers/status/counts
// To move to a dedicated WebSocket server, reimplement these methods here; nothing else needs to change.
// Fully optional: if the CDN or Supabase is unreachable, the game keeps running single-player.
// v6: Seoul project (ap-northeast-2). Rooms = 행정동 code + scene; a shared lobby presence channel gives per-dong head counts.
import { GT_LS, SESSION_LS, isInAppWebView, returnUrl } from './plaza-account.js';
import { setStarterSlots } from './balance.js';
import { snapQuery, kakaoOf } from './share.js?v=202611211159';
export const SUPA_URL = 'https://yxddhpacuyaffaoutxjn.supabase.co';
export const SUPA_KEY = 'sb_publishable_Vd-7c6e2f2s3G1d5Jbx9vw_0UCuHm-B'; // publishable key: public by design
// v13: QA/test clients (?qa=1) live in a separate namespace and never appear in real players' rooms, lobby counts or chat history
export const NS = /[?&]qa=1/.test(location.search) || window.__QA || navigator.webdriver ? 'chapelqa:' : 'chapel:';
export const CDN = '@supabase/supabase-js';
// Interest management: the room channel (≤100 users/shard, see v6.cap) carries presence diffs + chat/events only.
// Positions go to a spatial-grid cell channel; each client subscribes to the 3x3 cells around it (≈ one screen each way),
// so it only receives nearby users. Rate: 2Hz if someone is within NEAR, else 1Hz (edge/far); idle or seated → nothing.
const CELL = 900, KEEP = 2; // cell size (world px); drop a cell only when ≥KEEP cells away (hysteresis, no flapping)


// v15 Cloudflare transport: on *.workers.dev (or ?rt=do) realtime goes to SQLite Durable Objects over one WebSocket per channel.
// The shim mimics the small part of supabase-js RealtimeChannel this game uses, so the rest of the file is unchanged.
// Supabase stays for auth, DB and RPCs. Any failure → solo mode (game keeps working single-player).
export const DO_MODE = /^(studio(-qa)?\.(masilchapel|wishboard)|(masil|masilchapel|wishboard)\.[a-z0-9-]+)\.workers\.dev$/.test(location.hostname) || /[?&]rt=do/.test(location.search) || window.__PLAZA_RT === true; // plaza sets __PLAZA_RT before this module loads
// v17 resilient reconnect: silent exponential backoff (0.8s→30s cap, forever); the solo popup only after FAIL_MS of continuous failure
// while the page is visible and the device is online. Explicit server 'down' (budget) still stops at once.
const DO_BASE = 800, DO_CAP = 30000, FAIL_MS = 60000, FAIL_N = 5;
// Identity for the DO = verified Supabase JWT (guests use anonymous sign-in). Sent as a WebSocket subprotocol, never in the URL.
const AUTH_LS = 'sb-yxddhpacuyaffaoutxjn-auth-token';
const soon = (ms) => new Promise((r) => setTimeout(() => r(null), ms));
export async function doToken(sb, fresh) { try { const c = (window.G?.net?.sb || sb);
    let s = null;
    if (c?.auth?.getSession) s = await Promise.race([c.auth.getSession().then((x) => x?.data?.session || null).catch(() => null), soon(1500)]);
    if (!s && c) { try { const j = JSON.parse(localStorage.getItem(AUTH_LS) || 'null'); if (j?.access_token && j.expires_at * 1000 > Date.now() + 60000) return j.access_token; } catch { } }
    if (s?.access_token) return s.access_token; const g = await guestToken(fresh); if (g) return g.token; // v16: guests get a Worker-signed token (no Supabase anonymous user/MAU)
    if (!c?.auth?.signInAnonymously) return null; const r = await Promise.race([c.auth.signInAnonymously(), soon(2000)]); return r?.data?.session?.access_token || null; } catch { return null; } }
// v16 guest identity: HMAC token from /rt/guest, cached in localStorage and renewed (same id) before it expires.
// g.ticket = a handover ticket adopted from another browser's link (plaza-account.js adoptHandover): the server swaps it for that guest's token,
// and only then does this browser's own guest get replaced. A guest id alone is never enough.
export async function guestToken(fresh) { let g = null; try { g = JSON.parse(localStorage.getItem(GT_LS) || 'null'); } catch { }
  const live = g?.token && g.exp * 1000 > Date.now();
  if (!fresh && !g?.ticket && live && g.exp * 1000 > Date.now() + 86400000) return g;
  const body = {}; if (g?.token) body.t = g.token; if (g?.ticket) body.h = g.ticket;
  try { const r = await fetch('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) return live ? g : null;
    const n = await r.json(); if (!n?.token) return live ? g : null; localStorage.setItem(GT_LS, JSON.stringify(n)); return n; } catch { return live ? g : null; } }
class DOChan {
  constructor(rt, topic, cfg) { this.rt = rt; this.topic = topic; this.key = cfg?.config?.presence?.key || ('w' + Math.random().toString(36).slice(2, 10)); this.hs = []; this.st = {}; this.state = 'closed'; this.mine = null; this.tries = 0; }
  on(type, f, fn) { this.hs.push([type, f?.event, fn]); return this; }
  fire(type, ev, arg) { for (const [t, e, fn] of this.hs) if (t === type && (e === ev || e === '*')) try { fn(arg); } catch (x) { console.warn('[rt]', x); } }
  presenceState() { const o = {}; for (const k in this.st) o[k] = [this.st[k]]; return o; }
  subscribe(cb) { this.cb = cb || (() => { }); this.open(); return this; }
  async open() { if (this.dead || this.opening || (this.ws && this.ws.readyState <= 1)) return; clearTimeout(this.rto); this.opening = true; let tok; try { tok = await doToken(this.rt.sb, this.tries >= 2); } finally { this.opening = false; } if (this.dead) return; if (!tok) return this.closed(null, true); const u = new URL('/rt/ws', location.href); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'; u.searchParams.set('topic', this.topic); if (this.rt.net?.room) u.searchParams.set('room', this.rt.net.room);
    let ws; try { ws = this.ws = new WebSocket(u, ['masil2', 'at.' + tok]); } catch { return this.closed(null); }
    ws.onmessage = e => this.msg(e.data); ws.onclose = () => this.closed(ws); ws.onerror = () => { };
    clearInterval(this.pt); this.pt = setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 25000); } // server auto-responds (free, no DO wake); stale after 75s
  msg(d) { if (d === 'pong') return; let m; try { m = JSON.parse(d); } catch { return; }
    if (m.t === 'ok') { this.st = m.s || {}; this.state = 'joined'; this.tries = 0; this.failAt = 0; this.rt.ev(this, { ok: true, live: m.live, cap: m.cap }); this.rt.cfg(m); this._trS = 0; this.cb('SUBSCRIBED'); if (m.air && this.rt.net) this.rt.net.emit('air', m.air); if (Array.isArray(m.stk) && this.rt.net) this.rt.net.emit('stk', { all: m.stk }); if (Array.isArray(m.chr) && this.rt.net) this.rt.net.emit('cheer', { all: m.chr }); if (m.ball && this.rt.net) this.rt.net.emit('ball', m.ball); if ((m.fg != null || m.fv || m.rv) && this.rt.net) this.rt.net.emit('fever', { gauge: m.fg || 0, until: m.fv || 0, revenge: m.rv || 0, sync: true }); if (m.lot && this.rt.net) this.rt.net.emit('lot', { n: m.lot }); if (this.rt.net && (m.av != null || Array.isArray(m.equip))) this.rt.net.emit('profile', { av: m.av, equip: m.equip }); if (this.mine && !this._trS) this.raw({ t: 'tr', m: this.mine }); this.fire('presence', 'sync'); if (m.h && this.rt.net && this.topic === this.rt.net.topic) { const chat = []; for (const row of m.h) { if (row?.t === 'WORLD_UPDATE') this.rt.net.emit('world', { ...row, replay: true }); else if (row?.t === 'E') this.rt.net.emit('emoji', { id: row.k, e: row.e, replay: true }); else if (row?.t === 'GHOST') this.rt.net.emit('ghost', row); else chat.push(row); } if (chat.length) this.rt.net.emit('history', chat); } }
    else if (m.t === 'wait') {
      if (this.rt.net?.bumpShard?.()) { this.dead = true; try { this.ws.close(); } catch { } return; }
      this.state = 'waiting'; this.rt.ev(this, { pos: m.pos, live: m.live, cap: m.cap });
    }
    else if (m.t === 'pj') { this.st[m.k] = m.m; this.fire('presence', 'sync'); }
    else if (m.t === 'pl') { delete this.st[m.k]; this.fire('presence', 'sync'); }
    else if (m.t === 'P' && Array.isArray(m.a)) { const [x, y, face, anim, fl, vx, vy] = m.a; this.fire('broadcast', 'pos', { type: 'broadcast', event: 'pos', payload: { id: m.k, x, y, face, anim, fl, vx, vy } }); }
    else if (m.t === 'b') this.fire('broadcast', m.e, { type: 'broadcast', event: m.e, payload: m.p });
    else if (m.t === 'cfg') this.rt.cfg(m);
    else if (m.t === 'down') { this.dead = true; this.rt.down(this); }
    else if (m.t === 'moved') this.moved = true; // this account joined another channel elsewhere (one room per account): the server closes this socket next
    else if (m.t === 'WORLD_UPDATE') { if (this.rt.net) this.rt.net.emit('world', m); }
    else if (m.t === 'WALLET_SYNC') { if (this.rt.net) this.rt.net.emit('wallet', m); }
    else if (m.t === 'AD') { if (this.rt.net) this.rt.net.emit('ad', m); }
    else if (m.t === 'E') { this.fire('broadcast', 'emote', { type: 'broadcast', event: 'emote', payload: { id: m.k, e: m.e } }); if (this.rt.net) this.rt.net.emit('emoji', { id: m.k, e: m.e }); }
    else if (m.t === 'TAKE' || m.t === 'MONO' || m.t === 'REV' || m.t === 'FEVER' || m.t === 'AIR') { if (this.rt.net) this.rt.net.emit(m.t.toLowerCase(), m); }
    else if (m.t === 'STK') { if (this.rt.net) this.rt.net.emit('stk', m); }
    else if (m.t === 'CHEER_HIT') { if (this.rt.net) this.rt.net.emit('cheer', m); }
    else if (m.t === 'PAY' || m.t === 'DRAW' || m.t === 'SESS' || m.t === 'WELCOME' || m.t === 'INBOX' || m.t === 'BALL' || m.t === 'WISH') { if (this.rt.net) this.rt.net.emit(m.t.toLowerCase(), m); }
    else if (m.t === 'GHOST') { if (this.rt.net) this.rt.net.emit('ghost', m); } }
  raw(o) { if (this.ws?.readyState === 1) { this.ws.send(JSON.stringify(o)); return true; } return false; }
  send(o) { if (this.state !== 'joined') return Promise.resolve('error'); const p = o.payload; if (o.event === 'pos' && p) { this.raw({ t: 'p', a: [p.x, p.y, p.face, p.anim, p.fl, p.vx, p.vy] }); return Promise.resolve('ok'); } this.raw({ t: 'b', e: o.event, p: o.payload }); return Promise.resolve('ok'); }
  track(m) { this.mine = m; if (this.state === 'joined') { this._trS = 1; this.raw({ t: 'tr', m }); } return Promise.resolve('ok'); }
  untrack() { this.mine = null; this.raw({ t: 'ut' }); return Promise.resolve('ok'); }
  closed(ws, noTok) { if (!noTok && ws && ws !== this.ws) return; clearInterval(this.pt); const was = this.state; this.state = 'closed'; this.st = {}; if (this.dead) return;
    if (was === 'joined') { this.fire('presence', 'sync'); this.cb('CLOSED'); }
    if (this.moved) { clearTimeout(this.rto); this.cb('CHANNEL_ERROR'); return; } // no retry timer, or two tabs would evict each other in a loop; kick() reopens when this tab is used again
    const n = this.tries++, now = Date.now(); if (!this.failAt) this.failAt = now;
    if (!this.downSent && n >= FAIL_N && now - this.failAt >= FAIL_MS && !document.hidden && navigator.onLine !== false) { this.downSent = true; this.cb('CHANNEL_ERROR'); this.rt.down(this); }
    const d = Math.min(DO_CAP, DO_BASE * 2 ** Math.min(n, 6)) * (0.8 + Math.random() * 0.4); // hidden tab: no faster than 30s (the browser throttles anyway)
    clearTimeout(this.rto); this.rto = setTimeout(() => this.open(), document.hidden ? Math.max(d, DO_CAP) : d); }
  kick() { if (this.dead || this.state === 'joined' || this.opening || (this.ws && this.ws.readyState <= 1)) return; this.moved = false; this.tries = Math.min(this.tries, 1); clearTimeout(this.rto); this.open(); }
  close() { this.dead = true; clearInterval(this.pt); clearTimeout(this.rto); try { this.ws?.close(1000); } catch { } }
}
export function rtPatch(sb, net) { if (!DO_MODE || !sb || sb.__do) return sb; const chans = new Set(), base = { POS: Net.POS_MS, FAR: Net.FAR_MS };
  const rt = { net, sb, ev(ch, g) { if (g.ok && ch.downSent) { ch.downSent = false; if (net) net.gateDown = false; } if (net && ch.topic === net.topic) { if (g.ok) net.emit('gate', { ok: true, live: g.live, cap: g.cap }); else { net.pos = g.pos; net.emit('gate', g); } } },
    cfg(m) { Net.POS_MS = m.lean ? base.POS * 2 : base.POS; Net.FAR_MS = m.lean ? base.FAR * 2 : base.FAR; },
    down(ch) { if (net && (ch.topic === net.topic || !net.ch)) { net.gateDown = true; net.setStatus('offline'); net.emit('gate', { down: true }); } } };
  sb.channel = (t, c) => { const ch = new DOChan(rt, t, c); chans.add(ch); return ch; };
  sb.removeChannel = async ch => { ch?.close?.(); chans.delete(ch); return 'ok'; };
  sb.getChannels = () => [...chans]; sb.__do = true;
  const kick = () => { if (!document.hidden) for (const c of chans) c.kick(); }; // back to foreground / network back: reconnect now, not after the backoff
  document.addEventListener('visibilitychange', kick); addEventListener('online', kick); addEventListener('pageshow', kick); return sb; }

export class Net {
  static GRID_ON = 30; static GRID_OFF = 20; /* grid cells only pay off in a crowd; below that one room channel = fewer joins */ static POS_MS = 1000; static FAR_MS = 2000; static NEAR = 1400; // 2Hz with a peer near, 1Hz otherwise (edge/far); 0 when idle/seated
  constructor() { this.sb = null; this.ch = null; this.room = null; this.id = Net.cid(); this.peers = new Map(); this.status = 'offline'; this.h = {}; this.me = null; this.lastSend = 0; this.lastPres = 0; Net.active = this; }
  // v13: ONE stable presence key per user/device (persisted) → the same person can never appear as two peers (join/leave flapping after 혼자 모드 ↔ 함께)
  static cid() { try { let c = localStorage.getItem('maeul_cid'); if (!c) { c = Math.random().toString(36).slice(2, 10); localStorage.setItem('maeul_cid', c); } return c; } catch { return Math.random().toString(36).slice(2, 10); } }
  on(ev, fn) { (this.h[ev] ||= []).push(fn); } emit(ev, ...a) { for (const f of this.h[ev] || []) f(...a); }
  async init() {
    if (DO_MODE) { Net.GRID_ON = 1e9; Net.GRID_OFF = 1e9 - 1; try { const g = await guestToken(); if (g?.sub) this.id = 'guest:' + g.sub; } catch { } }
    if (DO_MODE && isInAppWebView(navigator.userAgent)) { const warm = () => { if (!document.hidden) this.handoverTicket(); }; warm(); setInterval(warm, 300000); document.addEventListener('visibilitychange', warm); } // the login sheet reads the ticket synchronously
    const cfgP = this.loadConfig(); // also brings the free-slot list, so it runs even when the CDN does not answer
    try { let m = globalThis.__SUPA_MOD; if (!m?.createClient) m = await Promise.race([import(CDN).then((mod) => { globalThis.__SUPA_MOD = mod; return mod; }), soon(4000)]);
      if (!m?.createClient) throw new Error('cdn timeout');
      const cfg = await cfgP;
      this.sb = m.createClient(cfg.url, cfg.key, { realtime: { params: { eventsPerSecond: 30 } }, auth: { persistSession: true, storageKey: SESSION_LS, detectSessionInUrl: true, flowType: 'pkce' } }); rtPatch(this.sb, this);
    } catch (e) { console.warn('[net] offline:', e.message); this.setStatus('offline'); }
    if (DO_MODE && this.sb?.auth?.getSession) { try { const s = await Promise.race([this.sb.auth.getSession().then((x) => x?.data?.session || null).catch(() => null), soon(1500)]); if (s?.user?.id) this.id = 'user:' + s.user.id; } catch { } }
    return !!this.sb;
  }
  setStatus(s) { this.status = s; this.emit('status', s, this.peers.size); }
  // ENTRY GATE (global cap + FIFO queue, server-side counter via REST RPC; DO-ready: swap gateBeat() for a DO fetch).
  // Waiting costs 1 REST call / GATE_POLL ms and zero Realtime messages; admitted users heartbeat every GATE_BEAT ms.
  static GATE_POLL = 5000; static GATE_BEAT = 5000; static GATE_TRY = [800, 2000, 4500]; // waiters poll 5s (refill ≤~6s), admitted beat 10s (abandon expiry 30s), retry with backoff before solo
  static gid() { try { let c = sessionStorage.getItem('maeul_gid'); if (!c) { c = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 36); sessionStorage.setItem('maeul_gid', c); } return c; } catch { return Math.random().toString(36).slice(2, 12); } }
  // One entry per tab session (sessionStorage id, not the shared localStorage cid) → idempotent server upsert; responses are sequence-checked so a late reply can't overwrite a newer state.
  async gateBeat() { this.gidv ||= Net.gid(); const seq = this._gseq = (this._gseq || 0) + 1;
    for (let k = 0; ; k++) { try { const { data, error } = DO_MODE ? { data: await fetch('/rt/gate', { cache: 'no-store' }).then(r => r.json()) } : await this.sb.rpc('gate_beat', { p_cid: this.gidv, p_qa: NS !== 'chapel:' }); if (error) throw error; if (seq !== this._gseq) return { stale: true }; return data; }
      catch (e) { if (k >= Net.GATE_TRY.length) throw e; await new Promise(r => setTimeout(r, Net.GATE_TRY[k] * (0.8 + Math.random() * 0.4))); } } }
  gateEnter() { if (this._gate) return this._gate; this.emit('gate', { checking: true });
    const tok = this._gtok = (this._gtok || 0) + 1;
    return this._gate = (async () => { for (;;) { if (this.solo || tok !== this._gtok) return false; let r; try { r = await this.gateBeat(); this._gfail = 0; } catch (e) { const now = Date.now(); this._gfail ||= now;
          if (now - this._gfail >= FAIL_MS && !this.gateDown && !document.hidden) { this.gateDown = true; this.emit('gate', { down: true }); } // sustained failure only
          await new Promise(res => setTimeout(res, this.gateDown ? DO_CAP : 5000)); continue; }
        if (r.stale) continue;
        if (r.full) { this.gateDown = true; this._gate = null; this.emit('gate', { down: true, full: true }); return false; }
        if (r.ok) { this.admitted = true; this.gateDown = false; if (this.lobbyMe) this.lobby(this.lobbyMe.dong, this.lobbyMe.name, this.lobbyMe.shard); this.emit('gate', { ok: true, live: r.live, cap: r.cap }); clearInterval(this._hb); if (!DO_MODE) this._hb = setInterval(() => this.gateHeart(), Net.GATE_BEAT); return true; }
        this.pos = r.pos; this.emit('gate', { pos: r.pos, live: r.live, cap: r.cap, guard: r.guard }); await new Promise(res => setTimeout(res, Net.GATE_POLL)); } })(); }
  // Heartbeat while admitted. If the server no longer holds our slot (expired after sleep/network loss) we drop Realtime and re-queue instead of silently over-filling.
  async gateHeart() { let r; try { r = await this.gateBeat(); } catch { return; } if (r.stale || r.ok || !this.admitted) return;
    clearInterval(this._hb); this.admitted = false; this._gate = null; const want = this.room || this._want; this.leave?.(true); this._want = want; this.gateEnter().then(ok => { if (ok && this._want) this.join(this._want, this.me); }); }
  gateLeave() { clearInterval(this._hb); this.admitted = false; this._gate = null; this._gtok = (this._gtok || 0) + 1; this._gseq = (this._gseq || 0) + 1; const id = this.gidv; if (!id || DO_MODE) return;
    try { const body = JSON.stringify({ p_cid: id }), u = SUPA_URL + '/rest/v1/rpc/gate_leave'; // keepalive so a tab close still frees the slot at once
      fetch(u, { method: 'POST', keepalive: true, headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, 'Content-Type': 'application/json' }, body }).catch(() => { }); } catch { } }
  goSolo() { this.solo = true; this.emit('gate', { solo: true }); }
  bumpShard() {
    const n = (this.shard || 1) + 1;
    if (n > 8) return false;
    this.shard = n;
    const room = 'square-' + n;
    queueMicrotask(() => this.join(room, this.me));
    return true;
  }
  async join(room, me) {
    this.me = me; if (!this.sb || this.solo || this.gateDown) return;
    if (!this.admitted) { const first = !this._gate; this._want = room; if (first) this.gateEnter().then(ok => { if (ok && this._want) this.join(this._want, this.me); }); return; } if (this.room === room && this.ch) return; const seq = this._jseq = (this._jseq || 0) + 1;
    await this.leave(true); if (seq !== this._jseq) return; this.room = room; this.shard = room === 'square' ? 1 : (Number(String(room).split('-').pop()) || 1); this.setStatus('connecting');
    const topic = NS + room.replace(/^d(\d+)(?:-(\d+))?/, (m, c, n) => c + '-' + (n || 1));
    for (const c of this.sb.getChannels?.() || []) if (c.topic === 'realtime:' + topic || c.topic === topic) { try { await this.sb.removeChannel(c); } catch { } } // never two subscriptions to one room
    if (seq !== this._jseq) return;
    this.topic = topic; this.cells = new Map(); const ch = this.ch = this.sb.channel(topic, { config: { presence: { key: this.id }, broadcast: { self: false } } });
    ch.on('presence', { event: 'sync' }, () => { const st = ch.presenceState(), seen = new Set();
      for (const [k, arr] of Object.entries(st)) { const m = arr[arr.length - 1]; if (k === this.id || m?.id === this.id) continue; seen.add(k); const q = this.peers.get(k); if (q) q.goneAt = 0; this.upsert(k, m, true); }
      // v13: leave debounced 10s (a presence blip / reconnect never shows 나갔어요→접속했어요 loops)
      for (const [k, q] of this.peers) if (!seen.has(k) && !q.goneAt) { q.goneAt = performance.now(); setTimeout(() => { const z = this.peers.get(k); if (z && z.goneAt && performance.now() - z.goneAt >= 9900 && this.ch === ch) { this.peers.delete(k); this.emit('leave', k); this.emit('status', this.status, this.peers.size); } }, 10000); }
      this.emit('status', this.status, this.peers.size); });
    ch.on('broadcast', { event: 'pos' }, ({ payload: p }) => { if (p.id !== this.id && this.peers.has(p.id)) this.upsert(p.id, p, false); });
    ch.on('broadcast', { event: 'chat' }, ({ payload: p }) => this.emit('chat', p));
    ch.on('broadcast', { event: 'emote' }, ({ payload: p }) => this.emit('emote', p));
    ch.on('broadcast', { event: 'praise' }, ({ payload: p }) => this.emit('praise', p));
    ch.on('broadcast', { event: 'prayer' }, ({ payload: p }) => this.emit('prayer', p));
    ch.on('broadcast', { event: 'pick' }, ({ payload: p }) => this.emit('pick', p));
    ch.on('broadcast', { event: 'picks' }, ({ payload: p }) => this.emit('picks', p));
    for (const ev of ['lead', 'lmsg', 'svc', 'offer', 'tier', 'seat', 'photo', 'amen', 'decor', 'obi', 'wh']) ch.on('broadcast', { event: ev }, ({ payload: p }) => this.emit(ev, p));
    ch.on('broadcast', { event: 'jump' }, ({ payload: p }) => this.emit('jump', p));
    ch.subscribe(async (s) => { if (ch !== this.ch) return;
      if (s === 'SUBSCRIBED') { this.setStatus('online'); await ch.track(this.state()); if (!DO_MODE) this.history(room); }
      else if (s === 'CLOSED') this.setStatus('connecting'); /* silent auto-reconnect */ else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') this.setStatus('offline'); });
  }
  async leave(rejoin) { this._jseq = rejoin ? this._jseq : (this._jseq || 0) + 1; for (const c of (this.cells || new Map()).values()) { try { this.sb.removeChannel(c.ch); } catch { } } this.cells = new Map(); if (this.ch) { const c = this.ch; this.ch = null; try { await c.untrack(); await this.sb.removeChannel(c); } catch { } } for (const k of this.peers.keys()) this.emit('leave', k, true); this.peers.clear(); } // local=true: we left, no '나갔어요' toasts
  state() { const m = this.me; return { id: this.id, name: m.name, outfit: m.outfit, x: Math.round(m.x), y: Math.round(m.y), face: m.face, anim: m.anim, fl: 0, equip: m.equip, av: m.av, rank: m.rank || '', vx: Math.round(m.vx || 0), vy: Math.round(m.vy || 0) }; } /* char-fix: velocity lets receivers dead-reckon between sparse sends. Plaza floor is always 0. */
  upsert(k, m, fromPresence) {
    let p = this.peers.get(k); const now = performance.now();
    if (!p) { p = { id: k, buf: [] }; this.peers.set(k, p); this.emit('join', p, m); }
    Object.assign(p, { name: m.name ?? p.name, outfit: m.outfit ?? p.outfit, equip: m.equip ?? p.equip, av: m.av ?? p.av, rank: m.rank ?? p.rank, fl: m.fl ?? p.fl, seat: m.seat ?? p.seat });
    if (!fromPresence || !p.buf.length) { p.buf.push({ t: now, x: m.x, y: m.y, face: m.face, anim: m.anim, vx: m.vx, vy: m.vy }); if (p.buf.length > 20) p.buf.shift(); }
    this.emit('update', p);
  }
  // Sync budget (v14 cost pass): idle/seated → 0 msgs; moving → ≤2Hz and only when a peer is near (same floor, ≤NEAR px),
  // otherwise one keep-alive every 5s; +1 final stop update. Presence (track) only when appearance/floor/name changes.
  tick(me) {
    this.me = me; if (!this.ch || this.status !== 'online') return; const now = performance.now();
    const st = this.state(), L = this.lastSt, moved = !L || st.x !== L.x || st.y !== L.y || st.face !== L.face || st.anim !== L.anim || st.fl !== L.fl;
    this.gridOn = this.peers.size >= Net.GRID_ON || (this.gridOn && this.peers.size > Net.GRID_OFF); if (this.gridOn) this.updateCells(st); else if (this.cells?.size) { for (const c of this.cells.values()) { try { this.sb.removeChannel(c.ch); } catch { } } this.cells.clear(); this._cc = null; };
    let due; if (DO_MODE) { // send on direction/target/anim/floor change (+3s keepalive while moving, +final stop); receivers interpolate
      const dx = L ? Math.sign(st.x - L.x) : 0, dy = L ? Math.sign(st.y - L.y) : 0, dir = dx + ',' + dy + ',' + st.face + ',' + st.anim + ',' + st.fl;
      due = moved && ((dir !== this.lastDir && now - this.lastSend > 120) || now - this.lastSend > 3000); if (due) this.lastDir = dir; }
    else due = moved && now - this.lastSend > (this.nearPeer(st) ? Net.POS_MS : Net.FAR_MS);
    if (due) { this.lastSend = now; this.lastSt = st; this.sent = (this.sent || 0) + 1;
      const own = this.cells.get(this.cellKey(st)); (own?.ok ? own.ch : this.ch).send({ type: 'broadcast', event: 'pos', payload: st }); }
    const K = JSON.stringify([st.outfit, st.av, st.equip, st.fl, st.name, st.rank]);
    if (K !== this.lastPresK && now - this.lastPres > 2500) { this.lastPres = now; this.lastPresK = K; this.ch.track(st); }
  }
  cellOf(st) { return [Math.floor(st.x / CELL), Math.floor(st.y / CELL)]; }
  cellKey(st, cx, cy) { if (cx === undefined) [cx, cy] = this.cellOf(st); return `${this.topic}:g${st.fl ?? 0}_${cx}_${cy}`; }
  updateCells(st) { const [cx, cy] = this.cellOf(st), f = st.fl ?? 0; if (this._cc === `${f},${cx},${cy}`) return; this._cc = `${f},${cx},${cy}`;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const k = this.cellKey(st, cx + dx, cy + dy); if (this.cells.has(k)) continue;
      const c = { ch: this.sb.channel(k, { config: { broadcast: { self: false } } }), ok: false, cx: cx + dx, cy: cy + dy, f }; this.cells.set(k, c);
      c.ch.on('broadcast', { event: 'pos' }, ({ payload: p }) => { if (p.id !== this.id && this.peers.has(p.id)) this.upsert(p.id, p, false); this.rx = (this.rx || 0) + 1; });
      c.ch.on('broadcast', { event: 'want' }, () => { const me = this.me && this.state(), now = performance.now(); if (!me || this.cellKey(me) !== k || now - (this._ans || 0) < 2000) return; this._ans = now; c.ch.send({ type: 'broadcast', event: 'pos', payload: me }); });
      c.ch.subscribe(s => { c.ok = s === 'SUBSCRIBED'; if (c.ok) c.ch.send({ type: 'broadcast', event: 'want', payload: {} }); }); } // newcomer asks idle users in that cell for one position
    for (const [k, c] of this.cells) if (c.f !== f || Math.abs(c.cx - cx) > KEEP || Math.abs(c.cy - cy) > KEEP) { this.cells.delete(k); try { this.sb.removeChannel(c.ch); } catch { } } }
  nearPeer(st) { for (const p of this.peers.values()) { const b = p.buf[p.buf.length - 1]; if (!b || p.goneAt) continue; if ((p.fl ?? null) !== (st.fl ?? null)) continue; if (Math.abs(b.x - st.x) < Net.NEAR && Math.abs(b.y - st.y) < Net.NEAR) return true; } return false; }
  // interpolated sample ~1.15s in the past (1Hz near / 0.5Hz far senders)
  sample(p) { const b = p.buf; if (!b.length) return null; const t = performance.now() - 1150;
    if (b.length === 1 || t <= b[0].t) return b[0];
    for (let i = b.length - 1; i > 0; i--) if (b[i - 1].t <= t) { const a = b[i - 1], c = b[i]; if (t >= c.t) { const e = Math.min(3200, t - c.t) / 1000; return c.anim === 'walk' && (c.vx || c.vy) ? { ...c, x: c.x + c.vx * e, y: c.y + c.vy * e, stale: t - c.t } : { ...c, stale: t - c.t }; } /* keep walking past the newest sample instead of stalling then jumping */ const k = (t - a.t) / (c.t - a.t); return { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, face: c.face, anim: c.anim, vx: c.vx, vy: c.vy }; }
    return b[b.length - 1]; }
  send(ev, payload) { if (this.ch && this.status === 'online') this.ch.send({ type: 'broadcast', event: ev, payload: { id: this.id, ...payload } }); }
  async chat(name, text) { this.send('chat', { name, text }); if (this.sb && this.room && NS === 'chapel:') try { await this.sb.from('chat_messages').insert({ room: this.room, name: name.slice(0, 12), body: text.slice(0, 80), client_id: this.id }); } catch { } }
  // ---- lobby: one presence channel, each member tracks {dong}; gives head counts per 행정동 for the map
  async lobby(dong, name, shard = 1) { if (!this.sb) return; this.lobbyMe = { dong, name, shard }; if (!this.admitted) { if (!this._gate && !this.solo && !this.gateDown) this.gateEnter(); return; } // q48: admission starts with the lobby (was only from join → +2.5s) /* waiting/solo: no Realtime at all */
    if (this.lb) { const k = JSON.stringify(this.lobbyMe); if (k !== this.lbKey) { this.lbKey = k; try { await this.lb.track(this.lobbyMe); } catch { } } return; }
    const lb = this.lb = this.sb.channel(NS + 'lobby', { config: { presence: { key: this.id } } });
    lb.on('presence', { event: 'sync' }, () => { const c = {}, sh = {}; for (const arr of Object.values(lb.presenceState())) { const m = arr[arr.length - 1], d = m.dong; if (d) { c[d] = (c[d] || 0) + 1; const n = m.shard || 1; (sh[d] ||= {})[n] = (sh[d][n] || 0) + 1; } } this.counts = c; this.shards = sh; this.lbSynced = true; this.emit('counts', c); });
    lb.subscribe(async s => { if (s === 'SUBSCRIBED' && this.lobbyMe) { this.lbKey = JSON.stringify(this.lobbyMe); await lb.track(this.lobbyMe); } }); }
  async leaveLobby() { if (this.lb) { const c = this.lb; this.lb = null; this.lbKey = null; try { await c.untrack(); await this.sb.removeChannel(c); } catch { } } this.counts = {}; }
  // ---- prayer wall (RLS: public rows readable; writes only via rate-limited security-definer RPCs)
  secret() { let s = localStorage.getItem('maeul_secret'); if (!s) { s = Array.from(crypto.getRandomValues(new Uint8Array(18)), b => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('maeul_secret', s); } return s; }
  async loadConfig() { try { const r = await fetch('/rt/config', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); setStarterSlots(j?.starter); this.forget = j?.forget === true; /* a withdrawal also deletes the login */ this.inviteOn = j?.invite === true; /* 친구 초대 master switch */ this.kakao = kakaoOf(j); if (typeof j?.url === 'string' && j.url.startsWith('https://') && typeof j?.key === 'string' && j.key && !/service_role/i.test(j.key)) return { url: j.url, key: j.key }; } } catch { } finally { this.kakaoKey(); this.kakaoSet(this.kakao || ''); } return { url: SUPA_URL, key: SUPA_KEY }; }
  // The Kakao key loadConfig kept from that one /rt/config answer ('' without one). Waits for it; never a request of its own.
  kakaoKey() { if (!this.kakaoP) this.kakaoP = new Promise((r) => { this.kakaoSet = r; }); return this.kakaoP; }
  async currentSession() { try { const s = await this.sb?.auth?.getSession(); return s?.data?.session || null; } catch { return null; } }
  // What the shared storage holds, for a window that follows another window's sign-in or sign-out (main.js syncActor): { session } with the stored
  // session, { session: null } when none is stored, and null when that cannot be told now (no client, a refresh that failed, no answer in 3 s, a stored
  // session the client did not return). "Cannot tell" must never be read as "signed out".
  async storedSession() { const auth = this.sb?.auth; if (!auth?.getSession) return null;
    try { const r = await Promise.race([auth.getSession(), soon(3000)]); if (!r) return null; if (r.data?.session?.user?.id) return { session: r.data.session }; if (r.error) return null;
      return localStorage.getItem(SESSION_LS) ? null : { session: null }; } catch { return null; } }
  // fn(event) after every sign-in and sign-out this client hears of, its own or another window's (supabase-js tells every window of the browser, and says
  // SIGNED_IN again each time a signed-in tab is looked at). fn runs in a later task: calling the client from inside its own callback can deadlock it.
  onAuth(fn) { const auth = this.sb?.auth; if (!auth?.onAuthStateChange) return false;
    try { auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') setTimeout(() => { try { fn(ev); } catch { } }, 0); }); return true; } catch { return false; } }
  // Google sign-in. The game tab stays: oauthUrl() only asks supabase-js for the provider address (skipBrowserRedirect) so main.js can load it in a
  // second window, which comes back to /oauth (oauth.html) and hands the code to this tab; exchangeCode() then finishes here. PKCE: the code verifier
  // is in localStorage under the client's storage key, so whichever same-origin tab ends up with the code can exchange it.
  async oauthUrl(provider, redirectTo) { if (!this.sb?.auth) throw new Error('로그인 준비 중이에요'); const { data, error } = await this.sb.auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } }); if (error) throw error; if (!data?.url) throw new Error('로그인 주소를 받지 못했어요. 다시 시도해 주세요.'); return data.url; }
  async exchangeCode(code) { if (!this.sb?.auth) throw new Error('로그인 준비 중이에요'); const { data, error } = await this.sb.auth.exchangeCodeForSession(code); if (error) throw error; if (!data?.session) throw new Error('로그인에 실패했어요'); return data.session; }
  // The fallback when a second window cannot be opened: this tab goes to the provider and comes back to the same address (minus one-time parameters).
  async startOAuth(provider) { if (!this.sb?.auth) throw new Error('로그인 준비 중이에요'); const redirectTo = returnUrl(location.href); const { error } = await this.sb.auth.signInWithOAuth({ provider, options: { redirectTo } }); if (error) throw error; }
  // This device only (scope local): the account's other devices stay signed in.
  async signOut() { const auth = this.sb?.auth; if (!auth) throw new Error('로그인 준비 중이에요'); const { error } = await auth.signOut({ scope: 'local' }); if (error) throw error; }
  async passwordAuth(kind, email, password) { const auth = this.sb?.auth; if (!auth) throw new Error('로그인 준비 중이에요'); const first = kind === 'up' ? await auth.signUp({ email, password }) : await auth.signInWithPassword({ email, password }); if (first.error) throw first.error; if (first.data?.session) return first.data.session; if (kind === 'up') { const again = await auth.signInWithPassword({ email, password }); if (again.data?.session) return again.data.session; const err = new Error('가입은 기록됐지만 이 창에서 바로 로그인되지 않았어요. 메일 확인이 켜져 있으면 확인 후 다시 로그인해 주세요.'); err.code = 'confirm'; throw err; } throw new Error('로그인에 실패했어요'); }
  async mergeGuest(guestId, guestToken, nickname) { const tok = await doToken(this.sb); if (!tok || String(tok).startsWith('g1.')) throw new Error('로그인 세션이 없어요'); const r = await fetch('/rt/auth/merge', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify({ guest_id: guestId, guest_token: guestToken, nickname: nickname || '', topic: this.topic || (NS + 'square') }) }); const data = await r.json().catch(() => ({})); if (!r.ok || data.ok === false) throw new Error(data.error || data.err || '계정 연결에 실패했어요'); return data; }
  // Does a withdrawal delete the login too (the Worker found forget_login in the database)? Asked when the withdrawal sheet opens; ?forget=1
  // makes the Worker wait for its own check. No answer counts as no, so the sheet never promises more than will happen.
  async forgetLogin() { try { const r = await fetch('/rt/config?forget=1', { cache: 'no-store' }); const j = r.ok ? await r.json() : null; this.forget = j?.forget === true; } catch { this.forget = false; } return this.forget; }
  // -> the Worker's answer; login: 'deleted' | 'kept' says whether the login itself went with the account.
  async withdrawAccount() { const tok = await doToken(this.sb); if (!tok || String(tok).startsWith('g1.')) throw new Error('로그인된 계정만 탈퇴할 수 있어요'); const r = await fetch('/rt/auth/withdraw', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: '{}' }); const data = await r.json().catch(() => ({})); if (!r.ok || data.ok === false) throw new Error(data.error || '탈퇴를 처리하지 못했어요'); try { await this.sb?.auth?.signOut(); } catch { } return data; }
  // In-app browser → system browser. A guest id is public, so the handover link carries a 15-minute ticket that only this guest's own token can obtain
  // (POST /rt/handover). Returns the cached ticket ('' until one is ready) and refreshes it in the background once under 10 minutes remain.
  handoverTicket() { const h = this._ht, left = h ? h.exp * 1000 - Date.now() : 0;
    if (left < 600000 && !this._htBusy && !String(this.id).startsWith('user:')) this._htBusy = (async () => { try { const g = await guestToken(); if (g?.token) { const r = await fetch('/rt/handover', { method: 'POST', headers: { authorization: 'Bearer ' + g.token } }); const j = r.ok ? await r.json() : null; if (j?.ticket) this._ht = j; } } catch { } this._htBusy = null; })();
    return left > 60000 ? h.ticket : ''; }
  async world() { const r = await fetch('/rt/world', { cache: 'no-store' }); if (!r.ok) throw new Error('world ' + r.status); return r.json(); }
  // 주간 리그: this week's top 20 and, with a token, my line. Never throws: null when it could not load (8 s cap).
  async league() { try { const tok = await doToken(this.sb), signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined; const r = await fetch('/rt/league', { cache: 'no-store', headers: tok ? { authorization: 'Bearer ' + tok } : {}, signal }); const d = await r.json().catch(() => null); return r.ok && d && d.ok && Array.isArray(d.top) ? d : null; } catch { return null; } }
  async wallet(actorId) { const id = actorId || this.id; const tok = await doToken(this.sb); if (!tok) throw new Error('auth'); const r = await fetch('/rt/wallet?actor_id=' + encodeURIComponent(id), { cache: 'no-store', headers: { authorization: 'Bearer ' + tok } }); const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(data.err || data.error || ('wallet ' + r.status)); return data; }
  earned(ok, kind) { if (ok && kind !== 'hello' && kind !== 'attend') this.emit('earn'); return ok; } // a coin the player worked for (analytics.js: first_coin); hello and attendance pay on arrival
  sendMine(amount, nick) { if (!this.ch?.raw || this.status !== 'online') return false; const n = Math.floor(Number(amount)); if (!Number.isFinite(n) || n < 1) return false; return this.earned(this.ch.raw({ t: 'MINE', amount: Math.min(15, n), nick: Array.from(String(nick ?? this.me?.name ?? '')).slice(0, 16).join('') })); }
  sendBonus(kind, amount, nick) { if (!this.ch?.raw || this.status !== 'online') return false; const n = Math.floor(Number(amount)); if (!Number.isInteger(n) || n < 1) return false; return this.earned(this.ch.raw({ t: 'BONUS', kind: String(kind || '').slice(0, 12), amount: n, nick: Array.from(String(nick ?? '')).slice(0, 16).join('') }), kind); }
  sendFare(amount, nick, slot, riders) { if (!this.ch?.raw || this.status !== 'online') return false; const n = Math.floor(Number(amount)); if (!Number.isInteger(n) || n < 1) return false; const msg = { t: 'FARE', amount: Math.min(25, n), nick: Array.from(String(nick ?? '')).slice(0, 16).join(''), slot: String(slot || '').slice(0, 16) }; const ridersN = Math.floor(Number(riders)); if (ridersN >= 1 && ridersN <= 5) msg.riders = ridersN; return this.earned(this.ch.raw(msg)); }
  sendRevenge() { if (!this.ch?.raw || this.status !== 'online') return false; return this.ch.raw({ t: 'REV' }); }
  sendFever() { if (!this.ch?.raw || this.status !== 'online') return false; return this.ch.raw({ t: 'FEVER' }); }
  sendAdClick(nick, slot) { if (!this.ch?.raw || this.status !== 'online') return false; return this.ch.raw({ t: 'ADCLICK', nick: Array.from(String(nick ?? '')).slice(0, 16).join(''), slot: String(slot || '').slice(0, 16) }); }
  sendEmoji(emojiId) { if (!this.ch?.raw || this.status !== 'online') return false; const e = Number(emojiId); if (!Number.isInteger(e) || e < 1 || e > 4) return false; return this.ch.raw({ t: 'E', e }); }
  sendSess(op, extra = {}) { if (!this.ch?.raw || this.status !== 'online') return false; const msg = { t: 'SESS', op, kind: extra.kind || 'bake' }; if (extra.id) msg.id = extra.id; if (extra.result) msg.result = extra.result; if (Array.isArray(extra.a) && extra.a.length >= 2) msg.a = [Math.round(Number(extra.a[0])), Math.round(Number(extra.a[1]))]; return this.ch.raw(msg); }
  onWorldUpdate(fn) { this.on('world', fn); return this; }
  async claimBillboard(payload) { return this._plazaPost('/rt/claim-billboard', payload); }
  async buyPlot(payload) { return this._plazaPost('/rt/buy-plot', payload); }
  async sellCoins(payload) { return this._plazaPost('/rt/sell-coins', payload); }
  async flushWallet() { return this._plazaPost('/rt/flush-wallet', {}); }
  // ctx { slot } or { wish } tells the server what the picture shows. Resolves to { url (the JPEG), page (the preview page to share) }.
  async publishShot(blob, ctx) { const tok = await doToken(this.sb); if (!tok) throw new Error('auth'); const r = await fetch('/rt/snap' + snapQuery(ctx), { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'image/jpeg' }, body: blob }); const data = await r.json().catch(() => ({})); if (!r.ok || !data.url) throw new Error(data.err || 'snap'); return { url: String(data.url), page: typeof data.page === 'string' ? data.page : '' }; }
  async shareBonus() { return this.authed('/rt/share-bonus', {}); }
  async redeemCode(code) { return this.authed('/rt/redeem-code', { code }); }
  // 오늘의 소원. None of these throw: GET gives the body or null, POSTs give the body even on 4xx/5xx so the sheet can show `error`.
  // anon: no token at all (the deep link before entering), so no guest is made just to read one wish.
  // 8 s cap: a hung GET must not leave the wish sheet waiting forever (null = could not load).
  async wishes(id, anon) { let timer = 0; try { const tok = anon ? null : await doToken(this.sb); let signal; if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) signal = AbortSignal.timeout(8000); else if (typeof AbortController !== 'undefined') { const c = new AbortController(); timer = setTimeout(() => c.abort(), 8000); signal = c.signal; } const r = await fetch('/rt/wishes' + (id ? '?id=' + encodeURIComponent(id) : ''), { cache: 'no-store', headers: tok ? { authorization: 'Bearer ' + tok } : {}, signal }); const data = await r.json().catch(() => null); return data && typeof data === 'object' ? data : null; } catch { return null; } finally { clearTimeout(timer); } }
  async postWish(text, nick) { return this._wishPost('/rt/wish', { text: String(text ?? ''), nick: Array.from(String(nick ?? this.me?.name ?? '')).slice(0, 16).join(''), topic: this.topic || (NS + 'square') }); }
  // The first wish of someone who came through an invite link carries that code (inv); the server judges it after answering.
  async postWishInv(text, nick, inv) { return this._wishPost('/rt/wish', { text: String(text ?? ''), nick: Array.from(String(nick ?? this.me?.name ?? '')).slice(0, 16).join(''), topic: this.topic || (NS + 'square'), inv: String(inv || '') }); }
  // 친구 초대 summary { code, count, today, earned, gift, recent? }; make: POST (makes my code on the first call). null on any failure, 6 s cap.
  async invite(make) { try { const tok = await doToken(this.sb); if (!tok) return null; const r = await fetch('/rt/invite', { method: make ? 'POST' : 'GET', cache: 'no-store', headers: { authorization: 'Bearer ' + tok, ...(make ? { 'content-type': 'application/json' } : {}) }, body: make ? '{}' : undefined, signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined }); const d = await r.json().catch(() => null); return d && d.ok && !d.busy ? d : null; } catch { return null; } } // busy (budget hard): null, try again later
  async heartWish(id) { return this._wishPost('/rt/wish/heart', { id: String(id || '') }); }
  async reportWish(id) { return this._wishPost('/rt/wish/report', { id: String(id || '') }); }
  async _wishPost(path, payload) { try { const tok = await doToken(this.sb); if (!tok) return { ok: false, code: 'auth', error: '입장한 뒤에 할 수 있어요.' }; const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(payload || {}) }); const data = await r.json().catch(() => null); if (data && typeof data === 'object') return data; return { ok: false, code: 'down', error: '소원을 처리하지 못했어요. 잠시 뒤 다시 해 주세요.' }; } catch { return { ok: false, code: 'down', error: '소원을 처리하지 못했어요. 잠시 뒤 다시 해 주세요.' }; } }
  // The holder's own board report (GET /rt/ad-report). Throws with the server's Korean error; 8 s cap.
  async adReport(slot) { const tok = await doToken(this.sb); if (!tok) throw new Error('입장한 뒤에 볼 수 있어요'); const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined; let r; try { r = await fetch('/rt/ad-report?slot=' + encodeURIComponent(String(slot || '')), { cache: 'no-store', headers: { authorization: 'Bearer ' + tok }, signal }); } catch { throw new Error('리포트를 불러오지 못했어요. 잠시 뒤 다시 해 주세요.'); } const data = await r.json().catch(() => ({})); if (!r.ok || data.ok !== true) throw new Error(data.error && data.error !== 'rate' ? data.error : '리포트를 불러오지 못했어요. 잠시 뒤 다시 해 주세요.'); return data; }
  async sponsorUrl() { const r = await fetch('/rt/sponsor', { cache: 'no-store' }); const d = await r.json().catch(() => ({})); return d.url || ''; }
  async authed(path, payload) { const tok = await doToken(this.sb); if (!tok) throw new Error('입장한 뒤에 사용할 수 있어요'); const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(payload || {}) }); const data = await r.json().catch(() => ({})); if (!r.ok || data.ok === false) throw new Error(data.error || data.err || '요청을 처리하지 못했습니다.'); return data; }
  async submitBillboardPhoto(payload) { return this._plazaPost('/rt/billboard-photo', payload); }
  async _plazaPost(path, payload) { const tok = await doToken(this.sb); if (!tok) throw new Error('auth'); const body = { ...(payload || {}) }; if (!body.topic) body.topic = this.topic || (NS + 'square'); if (!body.nickname && !body.nick) body.nickname = this.me?.name || ''; const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(body) }); const data = await r.json().catch(() => ({})); if (!r.ok || data.ok === false) throw new Error(data.error || data.err || '요청을 처리하지 못했습니다.'); return data; }
  async prayers(dong) { if (DO_MODE) return this.world(); if (!this.sb) throw new Error('offline'); const [pub, mine] = await Promise.all([
      DO_MODE ? fetch('/rt/prayers?dong=' + encodeURIComponent(dong)).then(async r => r.ok ? { data: await r.json() } : { error: new Error('prayers ' + r.status) }).catch(error => ({ error })) // v16: 15s edge/DO-side cache
        : this.sb.from('prayers').select('id,room,name,body,is_public,amen_count,created_at,answered,testimony').eq('room', dong).order('created_at', { ascending: false }).limit(40),
      this.sb.rpc('my_prayers', { p_secret: this.secret() })]);
    if (pub.error) throw pub.error; const ids = new Set((mine.data || []).map(r => r.id));
    return { list: pub.data.map(r => ({ ...r, mine: ids.has(r.id) })), mine: (mine.data || []).filter(r => r.room === dong && !r.is_public).map(r => ({ ...r, mine: true })) }; }
  async postPrayer(dong, name, body, pub) { body = window.Safe ? window.Safe.clean(body) : body; const r = await this.sb.rpc('post_prayer', { p_room: dong, p_name: name, p_body: body, p_public: pub, p_secret: this.secret() }); if (r.error) throw r.error; if (pub) this.send('prayer', { op: 'new' }); return r.data; }
  async prayWith(id, cur) { if (DO_MODE && this.ch?.raw) { if (!this.ch.raw({ t: 'tap', k: 'pray', r: String(id) })) throw new Error('offline'); return (+cur || 0) + 1; } const r = await this.sb.rpc('pray_with', { p_id: id, p_secret: this.secret() }); if (r.error) throw r.error; this.send('prayer', { op: 'amen', pid: id, n: r.data }); return r.data; }
  async history(room) { if (NS !== 'chapel:') return; try { const { data } = await this.sb.from('chat_messages').select('name,body,created_at').eq('room', room).order('created_at', { ascending: false }).limit(8); if (data && this.room === room) this.emit('history', data.reverse()); } catch { } }
}
// Plaza meters ↔ wire units: 5 cm grid offset by 1500 so the worker's integer rounding keeps precision (NEAR_R 1600 ≈ 80 m).
export const NET_SCALE = 20, NET_ORIGIN = 1500;
export const toNetUnits = (m) => Math.round(m * NET_SCALE + NET_ORIGIN);
export const fromNetUnits = (u) => (Number(u) - NET_ORIGIN) / NET_SCALE;
export function sendMine(amount, nick) { if (!Net.active) return false; return Net.active.sendMine(amount, nick); }
export function sendEmoji(emojiId) { if (!Net.active) return false; return Net.active.sendEmoji(emojiId); }
export function claimBillboard(payload) { if (!Net.active) throw new Error('net'); return Net.active.claimBillboard(payload); }
export function buyPlot(payload) { if (!Net.active) throw new Error('net'); return Net.active.buyPlot(payload); }
export function submitBillboardPhoto(payload) { if (!Net.active) throw new Error('net'); return Net.active.submitBillboardPhoto(payload); }
export function onWorldUpdate(fn) { if (!Net.active) throw new Error('net'); return Net.active.onWorldUpdate(fn); }
