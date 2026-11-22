// Traffic audit, second part (2026-11-22): open tabs that cost the plaza for nothing.
// 1. net.js: a tab hidden 5 min closes its sockets (park) and reopens when seen; main.js pays no 관람 coin in a hidden tab.
// 2. Room: WALLET_SYNC carries the balance coin_batch answers (migrations/2026-11-22-coin-balance.sql, run in PGlite by test/db.test.mjs);
//    main.js reads /rt/wallet only without it.
// 3. Budget hard: the room tells a connecting page 'down' (no 503 retry loop) and forgets a level from an earlier UTC day; net.js tries again
//    after the 00:00 UTC reset and asks /rt/gate at most every ~15 min meanwhile; main.js's socket-down resync is every 5 min then.
// 4. net.js asks /rt/guest for a fresh token only after the Worker closed with 4001 (or once per failure streak), not on every retry.
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: new URL('./cf-stub.mjs', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});
let listeners = {};
const fire = (type) => { for (const f of listeners[type] || []) f(); };
globalThis.window = globalThis;
Object.defineProperty(globalThis, 'navigator', { value: { webdriver: false, onLine: true, userAgent: 'node' }, configurable: true });
globalThis.document = { hidden: false, get visibilityState() { return this.hidden ? 'hidden' : 'visible'; }, addEventListener(t, f) { (listeners[t] ||= []).push(f); } };
globalThis.addEventListener = (t, f) => { (listeners['w:' + t] ||= []).push(f); };
globalThis.localStorage = { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); }, removeItem(k) { this.m.delete(k); } };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = { search: '?rt=do', hostname: 'masil.example.workers.dev', href: 'https://masil.example.workers.dev/', protocol: 'https:', origin: 'https://masil.example.workers.dev' };
globalThis.WebSocketRequestResponsePair = class { constructor(req, res) { this.req = req; this.res = res; } };
// workerd's WebSocketPair and a Response that may be 101 (undici refuses any status under 200).
const sockStub = () => ({ sent: [], accepted: false, send(s) { this.sent.push(String(s)); }, accept() { this.accepted = true; }, close(code, why) { this.closed = [code, why]; }, serializeAttachment(a) { this.att = a; }, deserializeAttachment() { return this.att ?? null; } });
const PAIRS = [];
globalThis.WebSocketPair = class { constructor() { this[0] = sockStub(); this[1] = sockStub(); PAIRS.push(this); } };
const RealResponse = globalThis.Response;
globalThis.Response = class extends RealResponse {
  constructor(body, init) { if (init && init.status === 101) { super(null, { ...init, status: 200 }); Object.defineProperty(this, 'status', { value: 101 }); this.webSocket = init.webSocket; } else super(body, init); }
};

const W = await import('../worker.js');
const { Room } = W;
const { Net, rtPatch, msToReset } = await import('../net.js');
const { GT_LS } = await import('../plaza-account.js');
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

// A clock for Date.now and the timers net.js / main.js use; tick(ms) runs what falls due, in order.
function fakeClock(start) {
  const real = { now: Date.now, st: globalThis.setTimeout, ct: globalThis.clearTimeout, si: globalThis.setInterval, ci: globalThis.clearInterval };
  const c = { t: start, q: new Map(), id: 0 };
  Date.now = () => c.t;
  globalThis.setTimeout = (fn, ms = 0, ...a) => { const id = ++c.id; c.q.set(id, { at: c.t + Math.max(0, Number(ms) || 0), fn: () => fn(...a) }); return id; };
  globalThis.setInterval = (fn, ms = 0, ...a) => { const id = ++c.id, every = Math.max(1, Number(ms) || 0); c.q.set(id, { at: c.t + every, fn: () => fn(...a), every }); return id; };
  globalThis.clearTimeout = globalThis.clearInterval = (id) => { c.q.delete(id); };
  c.tick = async (ms) => {
    const end = c.t + ms;
    for (;;) {
      let best = null; for (const [id, x] of c.q) if (x.at <= end && (!best || x.at < best[1].at)) best = [id, x];
      if (!best) break;
      const [id, x] = best; c.t = Math.max(c.t, x.at); if (x.every) x.at += x.every; else c.q.delete(id);
      x.fn(); await settle();
    }
    c.t = end; await settle();
  };
  c.done = () => { Date.now = real.now; globalThis.setTimeout = real.st; globalThis.clearTimeout = real.ct; globalThis.setInterval = real.si; globalThis.clearInterval = real.ci; };
  return c;
}
// The browser side of one socket: the page's WebSocket. ok() / msg() / drop() are the server.
class FakeWS {
  static all = [];
  constructor(url, protos) { this.url = String(url); this.protos = protos; this.readyState = 0; this.sent = []; FakeWS.all.push(this); }
  send(s) { this.sent.push(String(s)); }
  close(code, why) { if (this.readyState >= 2) return; this.readyState = 2; this.closeCode = code ?? 1005; this.closeWhy = why; queueMicrotask(() => this.drop(this.closeCode)); }
  ok(extra = {}) { this.readyState = 1; this.msg({ t: 'ok', s: {}, live: 1, cap: 50, ...extra }); }
  msg(o) { this.onmessage?.({ data: JSON.stringify(o) }); }
  drop(code = 1006) { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code }); }
  get topic() { return new URL(this.url).searchParams.get('topic'); }
}
globalThis.WebSocket = FakeWS;
// fetch the page makes: /rt/guest (renewal) and /rt/gate, counted.
function fakeFetch(gate = () => ({ ok: true, cap: 50 })) {
  const log = { guest: 0, gate: 0, other: [] };
  globalThis.fetch = async (u, opt = {}) => {
    const p = String(u);
    if (p.includes('/rt/guest')) { log.guest++; return new RealResponse(JSON.stringify({ token: 'tok' + log.guest, exp: Math.floor(Date.now() / 1000) + 30 * 86400, sub: 'abc' }), { status: 200 }); }
    if (p.includes('/rt/gate')) { log.gate++; return new RealResponse(JSON.stringify(gate(Date.now())), { status: 200 }); }
    log.other.push(p); return new RealResponse('{}', { status: 200 });
  };
  return log;
}
const cacheGuest = () => localStorage.setItem(GT_LS, JSON.stringify({ token: 'tok0', exp: Math.floor(Date.now() / 1000) + 30 * 86400, sub: 'abc' }));
const ME = { name: 'n', outfit: '#fff', x: 0, y: 0, face: '0', anim: 'idle', equip: '', av: 1 };
// A page: Net with the DO transport, joined to the square (FakeWS answers 'ok').
async function page() {
  listeners = {}; FakeWS.all.length = 0; document.hidden = false;
  const sb = { channel() {}, removeChannel() {}, getChannels() { return []; } };
  const net = new Net(); rtPatch(sb, net); net.sb = sb; net.admitted = true;
  const seen = { unpark: 0, status: [] }; net.on('unpark', () => seen.unpark++); net.on('status', (s) => seen.status.push(s));
  net.join('square', ME); await settle();
  return { net, sb, seen, ws: () => FakeWS.all.at(-1), live: () => FakeWS.all.filter((w) => w.readyState <= 1) };
}

function sqliteStorage() {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    exec(query, ...args) {
      const q = String(query).trim();
      if (!args.length && /^create\b/i.test(q)) { db.exec(q); return { rowsWritten: 0, toArray() { return []; }, one() { return {}; }, [Symbol.iterator]() { return [][Symbol.iterator](); } }; }
      const stmt = db.prepare(q);
      if (/^select\b/i.test(q)) { const rows = stmt.all(...args); return { rowsWritten: 0, toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() }; }
      const info = stmt.run(...args);
      return { rowsWritten: info.changes, toArray: () => [], one() { throw new Error('one on write'); }, [Symbol.iterator]() { return [][Symbol.iterator](); } };
    },
  };
}
function makeRoom(env = {}) {
  const c = { alarm: null, sets: 0, accepted: [] };
  c.storage = { sql: sqliteStorage(), async getAlarm() { return c.alarm; }, async setAlarm(t) { c.alarm = Number(t); c.sets++; }, async deleteAlarm() { c.alarm = null; }, transactionSync(fn) { return fn(); } };
  Object.assign(c, { setWebSocketAutoResponse() {}, getWebSockets() { return []; }, getWebSocketAutoResponseTimestamp() { return new Date(Date.now()); }, acceptWebSocket(s) { c.accepted.push(s); } });
  const day = { async add() { return { lvl: 0 }; } }, other = new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : async () => null) });
  const room = new Room(c, { METER: { idFromName: (n) => n, get: (id) => (id === 'day' ? day : other) }, ROOM: { idFromName: (t) => t, get: () => ({ fetch: async () => new RealResponse('{}') }) }, ...env });
  return { room, ctx: c };
}
function openSock(room, id) {
  const ws = sockStub(); room.socks().set(ws, { k: id, q: true, v2: true, fl: 0, lob: false, t: Date.now(), ls: Date.now(), m: { x: 1500, y: 1500, fl: 0, name: id.slice(-4) } });
  return ws;
}
const msgs = (ws) => ws.sent.map((s) => JSON.parse(s));
const connect = (room, uid) => room.fetch(new Request('https://room.internal/ws?topic=chapel:square', { headers: { 'x-uid': uid, 'x-v2': '1', 'x-anon': '1' } }));

describe('1. a hidden tab gives its seat back', { concurrency: false }, () => {
  it('hidden 5 min: the socket closes with 1000 and nothing reopens while hidden; seen again: one new socket, one unpark', async () => {
    const clock = fakeClock(Date.UTC(2026, 10, 22, 12, 0, 0)), log = fakeFetch();
    try {
      cacheGuest(); const p = await page(); const ws1 = p.ws(); ws1.ok(); await settle();
      assert.equal(p.net.status, 'online');
      document.hidden = true; fire('visibilitychange');
      await clock.tick(290000);
      assert.equal(ws1.readyState, 1, 'still open at 4 min 50 s');
      const pings = ws1.sent.filter((s) => s === 'ping').length; assert.ok(pings >= 11, 'the 25 s ping kept it alive meanwhile');
      await clock.tick(15000);
      assert.equal(ws1.closeCode, 1000); assert.equal(ws1.closeWhy, 'hidden');
      await clock.tick(3 * 3600e3); // a forgotten tab: three more hours
      assert.equal(FakeWS.all.length, 1, 'no reconnect while hidden'); assert.equal(p.live().length, 0);
      assert.equal(log.guest, 0); assert.equal(log.gate, 0);
      document.hidden = false; fire('visibilitychange'); await settle();
      assert.equal(FakeWS.all.length, 2, 'one socket on return'); assert.equal(p.ws().topic, 'chapel:square');
      p.ws().ok(); await settle();
      assert.equal(p.seen.unpark, 1);
      assert.equal(p.net.status, 'online');
      assert.equal(log.guest, 0, 'the cached guest token is used as it is');
    } finally { clock.done(); }
  });
  it('a phone locked for a minute keeps its socket (and a 4 min hide too)', async () => {
    const clock = fakeClock(Date.UTC(2026, 10, 22, 12, 0, 0)); fakeFetch();
    try {
      cacheGuest(); const p = await page(); const ws1 = p.ws(); ws1.ok(); await settle();
      for (const away of [60000, 240000]) {
        document.hidden = true; fire('visibilitychange'); await clock.tick(away);
        document.hidden = false; fire('visibilitychange'); await settle();
        assert.equal(ws1.readyState, 1, `back after ${away / 1000} s`); assert.equal(FakeWS.all.length, 1);
      }
      await clock.tick(600000); assert.equal(ws1.readyState, 1, 'visible: never parked');
      assert.equal(p.seen.unpark, 0);
    } finally { clock.done(); }
  });
  it('a socket that dropped while hidden retries, but not past 5 min hidden: that retry stays parked until the tab is seen', async () => {
    const clock = fakeClock(Date.UTC(2026, 10, 22, 12, 0, 0)); fakeFetch();
    try {
      cacheGuest(); const p = await page(); p.ws().ok(); await settle();
      document.hidden = true; fire('visibilitychange');
      await clock.tick(285000); p.ws().drop(1006); await settle(); // a network blip at 4 min 45 s: the retry waits >= 30 s (hidden)
      await clock.tick(3600e3);
      assert.equal(FakeWS.all.length, 1, 'the retry found the tab out of sight 5 min and did not open');
      document.hidden = false; fire('visibilitychange'); await settle();
      assert.equal(FakeWS.all.length, 2); p.ws().ok(); await settle(); assert.equal(p.seen.unpark, 1);
    } finally { clock.done(); }
  });
  it('back to a full room: the room queues it, net.js tries the next room (2–8), and the unpark still fires there', async () => {
    const clock = fakeClock(Date.UTC(2026, 10, 22, 12, 0, 0)); fakeFetch();
    try {
      cacheGuest(); const p = await page(); p.ws().ok(); await settle();
      document.hidden = true; fire('visibilitychange'); await clock.tick(301000);
      document.hidden = false; fire('visibilitychange'); await settle();
      const back = p.ws(); assert.equal(back.topic, 'chapel:square');
      back.msg({ t: 'wait', pos: 1, live: 50, cap: 50 }); await settle();
      assert.equal(back.readyState >= 2, true, 'the queued socket in the full room is let go');
      const next = p.ws(); assert.equal(next.topic, 'chapel:square-2');
      next.ok(); await settle();
      assert.equal(p.net.shard, 2); assert.equal(p.net.status, 'online'); assert.equal(p.seen.unpark, 1);
    } finally { clock.done(); }
  });
  it('the room: a parked close is a leave (presence, seat), the waiter is let in, and the last one leaving lets the alarm go', async () => {
    const { room, ctx } = makeRoom(); room.tapDb();
    const others = Array.from({ length: 49 }, (_, i) => openSock(room, 'guest:o' + i)), mine = openSock(room, 'guest:me');
    room.ctx.storage.sql.exec('insert into seat(uid, fl) values(?, 0)', 'guest:late');
    const res = await connect(room, 'guest:late'); assert.equal(res.status, 101);
    const late = ctx.accepted.at(-1);
    assert.deepEqual(msgs(late).at(-1), { t: 'wait', pos: 1, live: 50, cap: 50 });
    await room.webSocketClose(mine, 1000); // the hidden tab parks
    assert.ok(msgs(others[0]).some((m) => m.t === 'pl' && m.k === 'guest:me'), 'the others see it leave');
    assert.equal(msgs(late).at(-1).t, 'ok', 'the waiting player takes the seat');
    assert.equal(room.adm(), 50);
    for (const w of [...others, late]) await room.webSocketClose(w, 1000);
    assert.equal(room.socks().size, 0);
    ctx.alarm = null; const sets = ctx.sets; await room.alarm();
    assert.equal(ctx.sets, sets, 'nobody there: no new alarm');
  });
  it('main.js pays no 관람 coin while the tab is hidden', () => {
    const src = read('main.js'), a = src.indexOf('loungeTimer = setInterval(() => {'), b = src.indexOf('}, PAY.lounge.gapMs);', a);
    assert.ok(a > 0 && b > a);
    const body = src.slice(a, b);
    assert.match(body, /if \(!loungeOn \|\| document\.hidden\) return;/);
    assert.ok(body.indexOf('document.hidden') < body.indexOf("payBonus('lounge'"), 'checked before the BONUS is sent');
  });
});

describe('2. WALLET_SYNC carries the balance', { concurrency: false }, () => {
  async function flushWith(answer) {
    const real = globalThis.fetch, calls = [];
    globalThis.fetch = async (u, opt) => { calls.push(String(u)); return new RealResponse(JSON.stringify(String(u).includes('coin_batch') ? answer(JSON.parse(opt.body)) : {}), { status: 200 }); };
    try {
      const { room } = makeRoom({ FLUSH_KEY: 'flush-test-key' }); room.tapDb();
      const a = openSock(room, 'guest:a'), a2 = openSock(room, 'guest:a'), b = openSock(room, 'guest:b'), c = openSock(room, 'guest:c');
      room.grantFinal(room.socks().get(a), 12, 'a', 'mine'); room.grantFinal(room.socks().get(b), 3, 'b', 'mine');
      const r = await room.flush();
      return { r, a: msgs(a), a2: msgs(a2), b: msgs(b), c: msgs(c), calls, room, sock: { a, b, c } };
    } finally { globalThis.fetch = real; }
  }
  it('after the migration: each flushed account\'s sockets get { t:WALLET_SYNC, c } and nobody else gets one', async () => {
    const t = await flushWith((body) => ({ ok: true, flushed: body.p_items.length, bal: { 'guest:a': 412, 'guest:b': 103 } }));
    assert.equal(t.r.ok, true);
    assert.deepEqual(t.a.filter((m) => m.t === 'WALLET_SYNC'), [{ t: 'WALLET_SYNC', c: 412 }]);
    assert.deepEqual(t.a2.filter((m) => m.t === 'WALLET_SYNC'), [{ t: 'WALLET_SYNC', c: 412 }], 'every tab of that account');
    assert.deepEqual(t.b.filter((m) => m.t === 'WALLET_SYNC'), [{ t: 'WALLET_SYNC', c: 103 }]);
    assert.deepEqual(t.c.filter((m) => m.t === 'WALLET_SYNC'), []);
    assert.ok(JSON.stringify({ t: 'WALLET_SYNC', c: 412 }).length <= 30, 'small');
  });
  it('before the migration (no bal), or a bal without that account: the plain WALLET_SYNC, so the page reads its wallet', async () => {
    const old = await flushWith((body) => ({ ok: true, flushed: body.p_items.length }));
    assert.deepEqual(old.a.filter((m) => m.t === 'WALLET_SYNC'), [{ t: 'WALLET_SYNC' }]);
    const part = await flushWith(() => ({ ok: true, flushed: 2, bal: { 'guest:b': 103, 'guest:a': 'x' } }));
    assert.deepEqual(part.a.filter((m) => m.t === 'WALLET_SYNC'), [{ t: 'WALLET_SYNC' }]);
    assert.deepEqual(part.b.filter((m) => m.t === 'WALLET_SYNC'), [{ t: 'WALLET_SYNC', c: 103 }]);
  });
  it('a balance somebody else moved (/sync) stays the plain one', async () => {
    const { room } = makeRoom(); const a = openSock(room, 'guest:a');
    const r = await room.fetch(new Request('https://room.internal/sync', { method: 'POST', headers: { 'x-uid': 'guest:a' } }));
    assert.equal((await r.json()).n, 1); assert.deepEqual(msgs(a), [{ t: 'WALLET_SYNC' }]);
  });

  // main.js walletPush / applyWallet / refreshWallet, run against stubs.
  function wallet() {
    const src = read('main.js'), a = src.indexOf('async function refreshWallet()'), b = src.indexOf('function upsert(', a);
    assert.ok(a > 0 && b > a);
    const state = { grants: [], confirmed: 0, pending: 0, walletKnown: false, vipTickets: 0 }, reads = [], notes = [];
    let answer = { coins: 100, vip_tickets: 2 }, hold = null;
    const net = { wallet: async () => { reads.push(Date.now()); const at = answer; if (hold) await hold; return at; } }; // answered as the database was when asked
    const ui = { setWallet() {}, note: (t) => notes.push(t) };
    const takeGrants = (gs, n) => { const out = []; let left = n; for (const g of gs) { if (left >= g.n) left -= g.n; else out.push(g); } return out; };
    const pendingSum = () => state.grants.reduce((s, g) => s + g.n, 0);
    const api = new Function('net', 'ui', 'state', 'takeGrants', 'pendingSum', 'BALANCE', 'let walletGen = 0;\n' + src.slice(a, b) + '\nreturn { refreshWallet, walletPush, settled: () => { settledAt = Date.now(); } };')(net, ui, state, takeGrants, pendingSum, { grantKeepMs: 120000 });
    return { ...api, state, reads, notes, set: (w) => { answer = w; }, hold: (p) => { hold = p; } };
  }
  it('a push with c sets the balance without a read; the coins shown ahead of it are taken off once', async () => {
    const clock = fakeClock(1.8e12);
    try {
      const w = wallet(); await w.refreshWallet(); assert.equal(w.reads.length, 1); assert.equal(w.state.confirmed, 100);
      w.state.grants.push({ n: 6, at: Date.now() }, { n: 2, at: Date.now() }); // shown at once, not settled yet
      await clock.tick(30000); w.walletPush({ t: 'WALLET_SYNC', c: 106 });
      assert.equal(w.reads.length, 1, 'no /rt/wallet read');
      assert.equal(w.state.confirmed, 106); assert.deepEqual(w.state.grants.map((g) => g.n), [2]); assert.equal(w.state.vipTickets, 2, 'tickets kept');
      for (let i = 0; i < 19; i++) { await clock.tick(30000); w.walletPush({ t: 'WALLET_SYNC', c: 108 + i }); } // up to 10 min after the read
      assert.equal(w.reads.length, 1);
      await clock.tick(30000); w.walletPush({ t: 'WALLET_SYNC', c: 130 }); await settle();
      assert.equal(w.reads.length, 2, 'the drift check: one read once the last one is 10 min old');
    } finally { clock.done(); }
  });
  it('without c, before any read, or just after an HTTP answer set the balance: the wallet is read', async () => {
    const clock = fakeClock(1.8e12);
    try {
      const w = wallet();
      w.walletPush({ t: 'WALLET_SYNC', c: 150 }); await settle(); assert.equal(w.reads.length, 1, 'no read yet: read');
      w.walletPush({ t: 'WALLET_SYNC' }); await settle(); assert.equal(w.reads.length, 2, 'no c: read');
      for (const bad of [-1, 1.5, 'x', null]) { w.walletPush({ t: 'WALLET_SYNC', c: bad }); await settle(); }
      assert.equal(w.reads.length, 6, 'a c that is not a whole balance: read');
      w.settled(); await clock.tick(2000); w.walletPush({ t: 'WALLET_SYNC', c: 150 }); await settle();
      assert.equal(w.reads.length, 7, 'within 5 s of a claim / send answer: read');
      await clock.tick(5000); w.walletPush({ t: 'WALLET_SYNC', c: 150 }); await settle(); assert.equal(w.reads.length, 7);
    } finally { clock.done(); }
  });
  it('a read still on its way when a push lands does not take the balance back; one fresh read follows', async () => {
    const clock = fakeClock(1.8e12);
    try {
      const w = wallet(); await w.refreshWallet();
      let go; w.hold(new Promise((r) => { go = r; })); w.set({ coins: 90, vip_tickets: 2 }); // asked before the flush landed
      const slow = w.refreshWallet(); await settle();
      w.set({ coins: 140, vip_tickets: 2 }); // the flush: the database now has 140
      w.walletPush({ t: 'WALLET_SYNC', c: 140 }); assert.equal(w.state.confirmed, 140);
      go(); await slow; await settle();
      assert.equal(w.state.confirmed, 140, 'the older answer is dropped');
      assert.equal(w.reads.length, 3, 'one read after the push, only because one was on its way');
      w.hold(null); await clock.tick(30000); w.walletPush({ t: 'WALLET_SYNC', c: 150 }); await settle();
      assert.equal(w.reads.length, 3); assert.equal(w.state.confirmed, 150);
    } finally { clock.done(); }
  });
  it('per earning player-hour (a flush every 30 s): 120 wallet reads before, at most 6 after', async () => {
    const clock = fakeClock(1.8e12);
    try {
      const old = wallet(); await old.refreshWallet(); old.reads.length = 0;
      for (let i = 0; i < 120; i++) { await clock.tick(30000); old.walletPush({ t: 'WALLET_SYNC' }); await settle(); }
      assert.equal(old.reads.length, 120);
      const neu = wallet(); await neu.refreshWallet(); neu.reads.length = 0;
      for (let i = 0; i < 120; i++) { await clock.tick(30000); neu.walletPush({ t: 'WALLET_SYNC', c: 200 + i }); await settle(); }
      assert.ok(neu.reads.length <= 6, String(neu.reads.length));
    } finally { clock.done(); }
  });
});

describe('3. budget hard on open tabs', { concurrency: false }, () => {
  it('the room tells a connecting page down (101, then close 4002), not a 503 it would retry every 30 s', async () => {
    const { room, ctx } = makeRoom(); room.lvl = 2; room.lastRep = Date.now();
    const res = await connect(room, 'guest:h');
    assert.equal(res.status, 101); assert.equal(res.headers.get('Sec-WebSocket-Protocol'), 'masil2');
    const s = ctx.accepted.at(-1); assert.deepEqual(msgs(s), [{ t: 'down' }]); assert.deepEqual(s.closed, [4002, 'budget']);
    assert.equal(room.socks().size, 0);
  });
  it('a hard level from an earlier UTC day is stale: the connect goes in and the next report decides', async () => {
    const { room, ctx } = makeRoom(); room.tapDb(); room.ctx.storage.sql.exec('insert into seat(uid, fl) values(?, 0)', 'guest:h');
    room.lvl = 2; room.lastRep = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z') - 60000; // the last report, 23:59 UTC yesterday
    const res = await connect(room, 'guest:h');
    assert.equal(res.status, 101); assert.equal(room.lvl, 0);
    assert.equal(msgs(ctx.accepted.at(-1))[0].t, 'ok');
  });
  it('a tab told down at 15:00 UTC asks /rt/gate about every 15 min while seen, never while hidden, and is back within ~1 min of 00:00 UTC', async () => {
    const reset = Date.UTC(2026, 10, 23, 0, 0, 0), clock = fakeClock(Date.UTC(2026, 10, 22, 15, 0, 0));
    const log = fakeFetch((now) => (now < reset ? { full: true, used: 99000 } : { ok: true, cap: 50 }));
    try {
      cacheGuest(); const p = await page(); p.ws().ok(); await settle();
      const gates = []; p.net.on('gate', (g) => gates.push(g));
      p.ws().msg({ t: 'down' }); await settle();
      assert.equal(p.net.status, 'offline'); assert.ok(p.net.budgetDown > 0); assert.ok(gates.some((g) => g.down));
      await clock.tick(3 * 3600e3); // 15:00–18:00 seen
      assert.ok(log.gate >= 9 && log.gate <= 16, `${log.gate} gate reads in 3 h`);
      const g0 = log.gate; document.hidden = true; fire('visibilitychange');
      await clock.tick(5 * 3600e3); // 18:00–23:00 hidden
      assert.equal(log.gate, g0, 'hidden: no reads'); assert.equal(FakeWS.all.length, 1);
      document.hidden = false; fire('visibilitychange'); await settle();
      assert.equal(log.gate, g0 + 1, 'seen again: one read'); // still full (23:00)
      const before = FakeWS.all.length;
      await clock.tick(reset - Date.now() - 1000); assert.equal(FakeWS.all.length, before, 'nothing before the reset');
      await clock.tick(65000);
      assert.equal(FakeWS.all.length, before + 1, 'a socket within 65 s of 00:00 UTC'); assert.equal(p.ws().topic, 'chapel:square');
      p.ws().ok(); await settle();
      assert.equal(p.net.status, 'online'); assert.equal(p.net.budgetDown, 0);
      assert.equal(log.guest, 0);
    } finally { clock.done(); }
  });
  it('still full just after this clock\'s reset (its clock runs ahead): 30 s, 60 s, 120 s… not tomorrow', async () => {
    const reset = Date.UTC(2026, 10, 23, 0, 0, 0), clock = fakeClock(reset - 600000);
    const log = fakeFetch((now) => (now < reset + 150000 ? { full: true } : { ok: true, cap: 50 })); // the server's day turns 2.5 min after ours
    try {
      cacheGuest(); const p = await page(); p.ws().ok(); await settle(); p.ws().msg({ t: 'down' }); await settle();
      await clock.tick(600000 + 60000); // our 00:01: the reset try said full
      const n = log.gate; assert.ok(n >= 1);
      await clock.tick(6 * 60000);
      assert.equal(p.ws().readyState, 0, 'reconnected after a few short retries'); assert.ok(log.gate - n <= 4, `${log.gate - n} more reads`);
      assert.ok(msToReset(Date.now()) > 23 * 3600e3);
    } finally { clock.done(); }
  });
  it('main.js: the socket-down resync is every 60 s, every 5 min at hard, and never in a hidden tab', async () => {
    const src = read('main.js'), a = src.indexOf('const HARD_SYNC_MS = 300000;'), b = src.indexOf('}, 60000);', a) + '}, 60000);'.length;
    assert.ok(a > 0 && b > a);
    const clock = fakeClock(1.8e12);
    try {
      const net = { status: 'offline', budgetDown: 0 }; let n = 0;
      new Function('net', 'resync', 'document', src.slice(a, b))(net, () => n++, document);
      document.hidden = false; await clock.tick(3600e3); assert.equal(n, 60);
      n = 0; net.budgetDown = Date.now(); await clock.tick(3600e3); assert.ok(n >= 12 && n <= 13, String(n));
      n = 0; document.hidden = true; await clock.tick(3600e3); assert.equal(n, 0);
      document.hidden = false; net.status = 'online'; await clock.tick(3600e3); assert.equal(n, 0);
    } finally { clock.done(); document.hidden = false; }
  });
});

describe('4. a fresh guest token only when the old one was refused', { concurrency: false }, () => {
  it('ten network failures in a row: one /rt/guest (after the fifth), not eight', async () => {
    const clock = fakeClock(Date.UTC(2026, 10, 22, 12, 0, 0)), log = fakeFetch();
    try {
      cacheGuest(); const p = await page();
      for (let i = 0; i < 10; i++) { p.ws().drop(1006); await settle(); await clock.tick(40000); } // the backoff tops out at 30 s +20%
      assert.equal(FakeWS.all.length, 11); assert.equal(log.guest, 1);
      p.ws().ok(); await settle();
      for (let i = 0; i < 10; i++) { p.ws().drop(1006); await settle(); await clock.tick(40000); } // the backoff tops out at 30 s +20%
      assert.equal(log.guest, 2, 'a new streak may ask once more');
    } finally { clock.done(); }
  });
  it('a 4001 close (the Worker refused the token): the next try asks /rt/guest once and uses the new token', async () => {
    const clock = fakeClock(Date.UTC(2026, 10, 22, 12, 0, 0)), log = fakeFetch();
    try {
      cacheGuest(); const p = await page(); assert.ok(p.ws().protos.includes('at.tok0'));
      p.ws().drop(4001); await settle(); await clock.tick(2000);
      assert.equal(log.guest, 1); assert.ok(p.ws().protos.includes('at.tok1'));
      p.ws().drop(1006); await settle(); await clock.tick(3000);
      assert.equal(log.guest, 1, 'a blip after it does not');
    } finally { clock.done(); }
  });
  it('the Worker closes a socket with a refused token with 4001 instead of answering 401', async () => {
    const env = { GUEST_KEY: 'guest-test-key', METER: { idFromName: (n) => n, get: () => new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : async () => null) }) }, ROOM: { idFromName: (n) => n, get: () => { throw new Error('no room for a refused token'); } } };
    const res = await W.default.fetch(new Request('https://sq.example/rt/ws?topic=chapel:square', { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'masil2, at.not-a-token' } }), env, { waitUntil() {} });
    assert.equal(res.status, 101); assert.equal(res.headers.get('Sec-WebSocket-Protocol'), 'masil2');
    const server = PAIRS.at(-1)[1]; assert.equal(server.accepted, true); assert.deepEqual(server.closed, [4001, 'auth']);
  });
});
