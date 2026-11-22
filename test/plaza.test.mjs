import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') {
      return { url: new URL('./cf-stub.mjs', import.meta.url).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

globalThis.window = globalThis;
Object.defineProperty(globalThis, 'navigator', { value: { webdriver: false, onLine: true }, configurable: true });
globalThis.document = { hidden: false, addEventListener() {} };
globalThis.addEventListener = () => {};
globalThis.localStorage = {
  m: new Map(),
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; },
  setItem(k, v) { this.m.set(k, String(v)); },
};
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = {
  search: '?rt=do',
  hostname: 'masil.example.workers.dev',
  href: 'https://masil.example.workers.dev/',
  protocol: 'https:',
};
globalThis.WebSocketRequestResponsePair = class {
  constructor(req, res) { this.req = req; this.res = res; }
};

const { Room, Meter } = await import('../worker.js');
const worker = (await import('../worker.js')).default;
const { Net, sendEmoji, claimBillboard, buyPlot, onWorldUpdate, rtPatch, toNetUnits, fromNetUnits, guestToken } = await import('../net.js');
const { ticketSub, adoptHandover, GT_LS, SESSION_LS } = await import('../plaza-account.js');

function sqliteStorage() {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    exec(query, ...args) {
      const q = String(query).trim();
      if (!args.length && /^create\b/i.test(q)) {
        db.exec(q);
        return { rowsWritten: 0, toArray() { return []; }, one() { return {}; }, [Symbol.iterator]() { return [][Symbol.iterator](); } };
      }
      const stmt = db.prepare(q);
      if (/^select\b/i.test(q)) {
        const rows = stmt.all(...args);
        return {
          rowsWritten: 0,
          toArray: () => rows,
          one: () => {
            if (rows.length !== 1) throw new Error('expected one row for ' + q);
            return rows[0];
          },
          [Symbol.iterator]: () => rows[Symbol.iterator](),
        };
      }
      const info = stmt.run(...args);
      return { rowsWritten: info.changes, toArray: () => [], one() { throw new Error('one on write'); }, [Symbol.iterator]() { return [][Symbol.iterator](); } };
    },
  };
}

function makeCtx(sql) {
  return {
    storage: {
      sql,
      async getAlarm() { return null; },
      async setAlarm() {},
      transactionSync(fn) {
        sql.db.exec('BEGIN');
        try { const out = fn(); sql.db.exec('COMMIT'); return out; } catch (e) { sql.db.exec('ROLLBACK'); throw e; }
      },
    },
    setWebSocketAutoResponse() {},
    getWebSockets() { return []; },
    getWebSocketAutoResponseTimestamp() { return new Date(); },
    acceptWebSocket() {},
  };
}

function meterStub() {
  return { idFromName() { return 'day'; }, get() { return { add: async () => ({ n: 0, g: 0, lvl: 0 }) }; } };
}

function makeRoom(sql = sqliteStorage()) {
  const env = { FLUSH_KEY: 'flush-test-key', METER: meterStub() };
  env.ROOM = { idFromName: (topic) => topic, get: () => ({ fetch: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }) }) };
  const room = new Room(makeCtx(sql), env);
  return { room, env, sql };
}

function openSock(room, id, extra = {}) {
  const ws = {
    sent: [],
    send(s) { this.sent.push(String(s)); },
    close() { this.closed = true; },
    serializeAttachment() {},
    deserializeAttachment() { return null; },
  };
  const a = { k: id, q: true, v2: true, fl: 3, lob: false, t: Date.now(), ls: Date.now(), m: { x: 0, y: 0, fl: 3, ...extra } };
  room.socks().set(ws, a);
  return ws;
}

function msgs(ws) { return ws.sent.map(s => JSON.parse(s)); }

// A Durable Object stub as the runtime gives it: every method answers with a promise and arguments and results are copied; fetch passes through.
const stub = (obj) => new Proxy(obj, {
  get: (t, k) => k === 'fetch' ? (req) => t.fetch(req) : typeof t[k] === 'function' ? async (...a) => structuredClone(await t[k](...structuredClone(a))) : t[k],
});
// Real Meter and Room objects, one per name, each on its own in-memory SQLite. env.room(topic) / env.meter(name) reach the object behind a stub.
function makeEnv(extra = {}) {
  const meters = new Map(), rooms = new Map();
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ASSETS: { fetch: () => new Response('asset', { status: 200 }) }, rooms, ...extra };
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new Meter(makeCtx(sql), env) }); } return meters.get(name); };
  env.room = (topic) => { if (!rooms.has(topic)) { const sql = sqliteStorage(); rooms.set(topic, { sql, do: new Room(makeCtx(sql), env) }); } return rooms.get(topic); };
  env.METER = { idFromName: (name) => name, get: (name) => stub(env.meter(name).do) };
  env.ROOM = { idFromName: (topic) => topic, get: (topic) => stub(env.room(topic).do) };
  return env;
}
// What Room.fetch does for a WebSocket upgrade, without the upgrade: take the account's seat in this room, then attach a socket.
async function join(env, topic, uid) {
  const room = env.room(topic).do;
  const sf = await room.sit(uid, topic);
  if (sf < 0) return null;
  const ws = openSock(room, uid);
  room.socks().get(ws).sf = sf;
  return ws;
}
const okFetch = async () => new Response(JSON.stringify({ ok: true, flushed: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
const post = (body, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const bearer = (token) => ({ authorization: 'Bearer ' + token });
const coinOf = (sql, uid) => { const r = sql.db.prepare('select delta, n from coin where uid = ?').get(uid); return { delta: r ? r.delta : 0, n: r ? r.n : 0 }; };
const NOON = Date.parse('2026-11-15T03:00:00Z'); // 12:00 KST
const SQ = 'chapel:square', SQ2 = 'chapel:square-2', QA = 'chapelqa:square';

describe('times square plaza', { concurrency: false }, () => {
  it('keeps the Workers Free realtime budget constants and the 1.15s dead-reckoning sample', async () => {
    const workerSrc = await readFile(new URL('../worker.js', import.meta.url), 'utf8');
    const netSrc = await readFile(new URL('../net.js', import.meta.url), 'utf8');
    assert.match(workerSrc, /const CAP = 50, MEM = 0\.125, LEAN = 0\.8, HARD = 0\.95, STALE = 75000, SCAN = 5000, IDLE_SCAN = 60000, REP = 60000/);
    assert.match(workerSrc, /const NEAR_R = 1600, FAR_MS = 3000/);
    assert.match(workerSrc, /const FLUSH_N = 20, FLUSH_MS = 30000/);
    assert.match(workerSrc, /setWebSocketAutoResponse\(new WebSocketRequestResponsePair\('ping', 'pong'\)\)/);
    assert.match(netSrc, /performance\.now\(\) - 1150/);

    const net = new Net();
    const orig = performance.now.bind(performance);
    try {
      performance.now = () => 2000;
      const mid = net.sample({ buf: [
        { t: 0, x: 0, y: 0, face: 's', anim: 'walk', vx: 10, vy: 0 },
        { t: 1000, x: 100, y: 0, face: 's', anim: 'walk', vx: 100, vy: 0 },
      ] });
      assert.equal(mid.x, 85);
      assert.equal(mid.y, 0);
      performance.now = () => 4000;
      const ahead = net.sample({ buf: [
        { t: 0, x: 0, y: 0, face: 's', anim: 'walk', vx: 10, vy: 0 },
        { t: 1000, x: 100, y: 0, face: 's', anim: 'walk', vx: 100, vy: 0 },
      ] });
      assert.equal(ahead.x, 285);
      assert.equal(ahead.anim, 'walk');
    } finally {
      performance.now = orig;
    }
  });

  it('forces floor 0 and still drops far walk updates outside NEAR_R', async () => {
    const { room } = makeRoom();
    const me = openSock(room, 'guest:me');
    const edge = openSock(room, 'guest:edge', { x: 1600, y: 0, fl: 7 });
    const far = openSock(room, 'guest:far', { x: 1601, y: 0, fl: 4 });
    await room.webSocketMessage(me, JSON.stringify({ t: 'p', a: [0, 0, 's', 'walk', 9, 3, 4] }));
    await room.webSocketMessage(me, JSON.stringify({ t: 'p', a: [0, 0, 's', 'walk', 9, 3, 4] }));
    const edgeMsgs = msgs(edge).filter(m => m.t === 'P');
    const farMsgs = msgs(far).filter(m => m.t === 'P');
    assert.equal(edgeMsgs.length, 2);
    assert.equal(farMsgs.length, 1);
    assert.equal(edgeMsgs[0].k, 'guest:me');
    assert.deepEqual(edgeMsgs[0].a, [0, 0, 's', 'walk', 0, 3, 4]);
    assert.equal(edgeMsgs[1].a[4], 0);
    assert.equal(room.socks().get(me).fl, 0);
    await room.webSocketMessage(me, JSON.stringify({ t: 'p', a: [0, 0, 's', 'idle', 9, 0, 0] }));
    assert.equal(msgs(far).filter(m => m.t === 'P').length, 2);
    assert.equal(msgs(far).at(-1).a[3], 'idle');
    await room.webSocketMessage(me, JSON.stringify({ t: 'E', e: 2 }));
    await room.webSocketMessage(me, JSON.stringify({ t: 'E', e: 9 }));
    assert.deepEqual(msgs(edge).filter(m => m.t === 'E'), [{ t: 'E', k: 'guest:me', e: 2 }]);
    assert.equal(msgs(me).some(m => m.t === 'E'), false);
  });

  // Ground coins pay nothing since the non-game change (MINE is answered why 'off'); the flush mechanics are the same for any grant, here 관람.
  it('credits 관람 in memory-backed sqlite, pays ground coins nothing, keeps the 20 s gap, and flushes coin_batch', async () => {
    const orig = Date.now;
    let clock = 1_700_000_000_000;
    Date.now = () => clock;
    const calls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opt) => {
      calls.push({ url: String(url), body: opt?.body });
      if (String(url).includes('/rpc/coin_batch') && calls.filter(c => String(c.url).includes('coin_batch')).length === 1) {
        return new Response('nope', { status: 500 });
      }
      return new Response(JSON.stringify({ ok: true, flushed: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      const { room, sql } = makeRoom();
      const me = openSock(room, 'guest:g-1');
      const other = openSock(room, 'guest:g-2');
      const watch = (r, w, amount = 2) => r.webSocketMessage(w, JSON.stringify({ t: 'BONUS', kind: 'lounge', amount, nick: '까마귀' }));
      for (const amount of [100, 5, 14.2, 1]) await room.webSocketMessage(me, JSON.stringify({ t: 'MINE', amount, nick: '까마귀' }));
      room.tapDb();
      assert.equal(sql.db.prepare('select count(*) c from coin').get().c, 0);
      assert.deepEqual(msgs(me).filter(m => m.t === 'PAY').map(m => m.why), ['off', 'off', 'off', 'off']);
      await watch(room, me, 100); // the client's amount is ignored: 관람 pays PAY.lounge.base
      let row = sql.db.prepare('select delta, n, nick from coin').get();
      assert.equal(row.delta, 2);
      assert.equal(row.n, 1);
      assert.equal(row.nick, '까마귀');
      clock += 2000;
      await watch(room, me); // too soon: 20 s between pays
      assert.equal(sql.db.prepare('select delta from coin').get().delta, 2);
      clock += 18000;
      await watch(room, me);
      row = sql.db.prepare('select delta, n from coin').get();
      assert.equal(row.delta, 4);
      assert.equal(row.n, 2);

      await room.flush('guest:g-1');
      assert.equal(sql.db.prepare('select count(*) c from coin').get().c, 1);
      assert.equal(msgs(me).some(m => m.t === 'WALLET_SYNC'), false);
      assert.equal(calls[0].url.includes('/rpc/coin_batch'), true);
      const failed = JSON.parse(calls[0].body);
      assert.equal(failed.p_key, 'flush-test-key');
      assert.equal(failed.p_items[0].actor_id, 'guest:g-1');
      assert.equal(failed.p_items[0].delta, 4);

      const room2 = new Room(makeCtx(sql), room.env);
      const again = openSock(room2, 'guest:g-1');
      await watch(room2, again); // a woken room keeps the gap (SQLite)
      assert.equal(sql.db.prepare('select delta from coin').get().delta, 4);

      clock += 2000;
      await room.flush('guest:g-1');
      assert.equal(sql.db.prepare('select count(*) c from coin').get().c, 0);
      assert.equal(msgs(me).filter(m => m.t === 'WALLET_SYNC').length, 1);
      assert.equal(msgs(other).some(m => m.t === 'WALLET_SYNC'), false);
      const okBody = JSON.parse(calls[1].body);
      assert.equal(okBody.p_items[0].nickname, '까마귀');
      assert.equal(okBody.p_items[0].delta, 4);

      await watch(room2, again); // still inside the 20 s
      assert.equal(sql.db.prepare('select count(*) c from coin').get().c, 0);
      clock += 20000;
      await watch(room2, again);
      assert.equal(sql.db.prepare('select delta from coin').get().delta, 2);
      // (room2 still counts the row room1 flushed as its oldest grant, so its alarm is due at once)
      clock += 30000;
      await room2.alarm();
      assert.equal(sql.db.prepare('select count(*) c from coin').get().c, 0);
      assert.equal(msgs(again).some(m => m.t === 'WALLET_SYNC'), true);

      const sql3 = sqliteStorage();
      const room3 = new Room(makeCtx(sql3), room.env);
      const farmer = openSock(room3, 'guest:farm');
      for (let i = 0; i < 20; i++) {
        clock += 20000;
        await room3.webSocketMessage(farmer, JSON.stringify({ t: 'BONUS', kind: 'lounge', amount: 2, nick: '농부' }));
      }
      await room3._fq;
      const batch = calls.map(c => ({ url: c.url, body: c.body })).filter(c => c.url.includes('coin_batch')).at(-1);
      const items = JSON.parse(batch.body).p_items;
      assert.equal(items.length, 1);
      assert.equal(items[0].delta, 40); // 20 pays of 2: the 20th grant flushes (FLUSH_N)
      assert.equal(items[0].actor_id, 'guest:farm');
      assert.equal(sql3.db.prepare('select count(*) c from coin').get().c, 0);
      const newbie = openSock(room3, 'guest:new');
      await room3.webSocketMessage(newbie, JSON.stringify({ t: 'BONUS', kind: 'hello', amount: 40, nick: '새' }));
      await room3.webSocketMessage(newbie, JSON.stringify({ t: 'BONUS', kind: 'hello', amount: 80, nick: '새' }));
      const hello = sql3.db.prepare('select delta, n from coin where uid = ?').get('guest:new');
      assert.equal(hello.delta, 40);
      assert.equal(hello.n, 1);
      // An account is no new visitor (its arrival coins came with its first guest): its hello is recorded, so the free first board opens
      // (hasHello), and answered with 0; nothing is queued for it. An anonymous sign-in has a user: id too but is a guest, and is paid.
      const acct = openSock(room3, 'user:5eed0000-0000-4000-8000-00000000ac01');
      await room3.webSocketMessage(acct, JSON.stringify({ t: 'BONUS', kind: 'hello', amount: 40, nick: '계정' }));
      await room3.webSocketMessage(acct, JSON.stringify({ t: 'BONUS', kind: 'hello', amount: 40, nick: '계정' }));
      assert.equal(sql3.db.prepare('select count(*) c from coin where uid = ?').get('user:5eed0000-0000-4000-8000-00000000ac01').c, 0);
      assert.equal(room3.hasHello('user:5eed0000-0000-4000-8000-00000000ac01'), true);
      assert.deepEqual(msgs(acct).filter(m => m.t === 'PAY'), [{ t: 'PAY', kind: 'hello', amount: 0 }]);
      const anon = openSock(room3, 'user:5eed0000-0000-4000-8000-00000000ac02'); room3.socks().get(anon).an = true;
      await room3.webSocketMessage(anon, JSON.stringify({ t: 'BONUS', kind: 'hello', amount: 40, nick: '익명' }));
      assert.equal(sql3.db.prepare('select delta from coin where uid = ?').get('user:5eed0000-0000-4000-8000-00000000ac02').delta, 40);
    } finally {
      Date.now = orig;
      globalThis.fetch = origFetch;
    }
  });

  it('serves /rt/world from the 15s isolate cache with today\'s visitors and wishes, reads the caller wallet, and pushes claims with ranks and third-party wallet syncs', async () => {
    const origFetch = globalThis.fetch, origNow = Date.now;
    Date.now = () => Date.parse('2026-11-16T12:05:00Z');
    const jar = new Map();
    globalThis.caches = {
      default: {
        async match(req) { const hit = jar.get(req.url); return hit ? hit.clone() : undefined; },
        async put(req, res) { jar.set(req.url, res.clone()); },
        async delete(req) { jar.delete(req.url); return true; },
      },
    };
    const world = {
      boards: [{ slot_id: 'MAIN_TOP', line1: 'old', tier: 'S' }],
      plots: [{ plot_id: 1, level: 0, price: 500 }, { plot_id: 3, level: 1, owner_id: 'guest:landlord' }],
      ranks: [],
    };
    const calls = [];
    let failFlush = false;
    globalThis.fetch = async (url, opt) => {
      const u = String(url);
      calls.push({ url: u, body: opt?.body });
      const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
      if (u.includes('/.well-known/jwks.json')) return json({ keys: world.jwks || [] });
      if (u.includes('/rest/v1/billboards')) return json(world.boards);
      if (u.includes('/rest/v1/plots')) return json(world.plots);
      if (u.includes('/rest/v1/wallets')) return json(u.includes('spent=gt.0') ? world.ranks : world.wallet ? [world.wallet] : []); // world.wallet: the caller's row, once it has one
      if (u.includes('/rpc/coin_batch')) return failFlush ? json({ message: 'down' }, 500) : json({ ok: true, flushed: 1 });
      if (u.includes('/rpc/claim_billboard')) {
        const a = JSON.parse(opt.body);
        if (a.p_slot_id === 'PLOT_3') return json({ ok: true, billboard: { slot_id: 'PLOT_3', plot_id: 3, line1: '외벽', holder_id: a.p_actor_id }, remaining_coins: 60, prev_holder_id: 'guest:evicted' });
        return json({ ok: true, billboard: { slot_id: a.p_slot_id, line1: '새 문구', holder_id: 'kept' }, remaining_coins: 80 });
      }
      if (u.includes('/rpc/buy_or_upgrade_plot')) return json({ ok: true, plot: { plot_id: 3, level: 1, owner_name: '까마귀' }, remaining_coins: 40 });
      if (u.includes('/rpc/sell_coins_to_advertiser')) return json({ ok: true, remaining_coins: 30, buyer_name: '건물주', buyer_id: 'guest:landlord' });
      return new Response('missing', { status: 404 });
    };
    const waits = [];
    const ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
    const env = makeEnv();
    const { do: room, sql } = env.room('chapel:square');
    const call = async (path, opt = {}) => {
      const res = await worker.fetch(new Request('https://sq.example' + path, opt), env, ctx);
      await Promise.all(waits.splice(0));
      return res;
    };
    try {
      const guest = await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(guest.status, 200);
      const token = (await guest.json()).token;
      const sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).s;
      const actorId = 'guest:' + sub;
      const auth = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };

      const denied = await call('/rt/wallet?actor_id=' + encodeURIComponent(actorId));
      assert.equal(denied.status, 401);
      const other = await call('/rt/wallet?actor_id=' + encodeURIComponent('user:someone-else'), { headers: auth });
      assert.equal(other.status, 403);
      const wallet = await call('/rt/wallet?actor_id=' + encodeURIComponent(actorId), { headers: auth });
      assert.equal(wallet.status, 200);
      const balance = await wallet.json();
      assert.equal(balance.exists, false);
      assert.equal(balance.coins, 100);
      assert.equal(balance.actor_id, actorId);
      assert.ok(calls.some(c => c.url.includes('/wallets') && c.url.includes(encodeURIComponent(actorId))));

      const boards = () => calls.filter(c => c.url.includes('/billboards')).length;
      const first = await call('/rt/world');
      assert.equal(first.status, 200);
      const fw = await first.json(), { prime: firstPlan, roof, ...rest } = fw;
      assert.deepEqual(rest, { billboards: world.boards, plots: world.plots, ranks: [], today: { visitors: 0, wishes: 0 } });
      assert.equal(roof, ''); assert.equal(firstPlan.day, new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10)); // the prime screens' plan (teamsrv.js), empty today
      assert.equal(boards(), 1);
      await call('/rt/world');
      assert.equal(boards(), 1);

      const sock = await join(env, 'chapel:square', actorId);
      await room.webSocketMessage(sock, JSON.stringify({ t: 'BONUS', kind: 'lounge', amount: 2, nick: '까마귀' })); // 관람 +2, pending
      world.boards = [{ slot_id: 'MAIN_TOP', line1: '새 문구', tier: 'S' }];
      world.ranks = [{ actor_id: actorId, nickname: '까마귀', spent: 120, linked: false }];
      failFlush = true;
      const blocked = await call('/rt/claim-billboard', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ topic: 'chapel:square', slot_id: 'STREET_5', bid: 120, line1: '새 문구', nickname: '까마귀', actor_id: 'user:hacker' }),
      });
      assert.equal(blocked.status, 409);
      const blockedBody = await blocked.json();
      assert.equal(blockedBody.pending, true);
      assert.match(blockedBody.error, /정산되지 않은 포인트/);
      assert.equal(calls.some(c => c.url.includes('claim_billboard')), false);
      assert.equal(sql.db.prepare('select delta from coin').get().delta, 2);

      failFlush = false;
      const claimed = await call('/rt/claim-billboard', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ topic: 'chapel:square', slot_id: 'STREET_5', bid: 120, line1: '새 문구', line2: '타임스퀘어', emoji: '🔥', bg_theme: 'cyber_navy', text_color: '#ffffff', nickname: '까마귀', actor_id: 'user:hacker' }),
      });
      assert.equal(claimed.status, 200);
      const claimBody = await claimed.json();
      assert.equal(claimBody.ok, true);
      assert.equal(claimBody.kind, 'BILLBOARD');
      assert.equal(claimBody.remaining_coins, 80);
      const rpcs = calls.filter(c => c.url.includes('/rpc/'));
      const coin = rpcs.filter(c => c.url.includes('coin_batch')).at(-1);
      const claimRpc = rpcs.filter(c => c.url.includes('claim_billboard')).at(0);
      assert.ok(calls.indexOf(coin) < calls.indexOf(claimRpc));
      const claimArgs = JSON.parse(claimRpc.body);
      assert.equal(claimArgs.p_key, 'flush-test-key');
      assert.equal(claimArgs.p_actor_id, actorId);
      assert.notEqual(claimArgs.p_actor_id, 'user:hacker');
      assert.equal(claimArgs.p_bid, 228, 'the fixed price of STREET_5 (its floor), not the 120 the page sent');
      const seen = msgs(sock);
      assert.ok(seen.some(m => m.t === 'WALLET_SYNC' && Object.keys(m).length === 1));
      // The push carries what polling used to fetch: the row and the fresh top-20 ranks. The replay ring keeps the row only.
      const update = seen.find(m => m.t === 'WORLD_UPDATE');
      assert.deepEqual(Object.keys(update).sort(), ['data', 'kind', 'ranks', 't']);
      assert.equal(update.kind, 'BILLBOARD');
      assert.equal(update.data.line1, '새 문구');
      assert.deepEqual(update.ranks, world.ranks);
      assert.deepEqual(Object.keys(room.hist.find(m => m.t === 'WORLD_UPDATE')).sort(), ['data', 'kind', 't']);
      // Today on the boot screen: one account connected, one claim succeeded. Still served from the cache the claim refilled.
      const before = boards();
      const cached = await (await call('/rt/world')).json();
      assert.equal(cached.billboards[0].line1, '새 문구');
      assert.deepEqual(cached.today, { visitors: 1, wishes: 1 });
      assert.equal(boards(), before);

      const bought = await call('/rt/buy-plot', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ topic: 'chapel:square', plot_id: 3, sign_text: '까마귀타워', theme_color: '#00ffcc', nickname: '까마귀' }),
      });
      assert.equal(bought.status, 200);
      const plotMsg = msgs(sock).filter(m => m.t === 'WORLD_UPDATE').at(-1);
      assert.deepEqual(Object.keys(plotMsg).sort(), ['data', 'kind', 't']);
      assert.equal(plotMsg.kind, 'PLOT');
      assert.equal(plotMsg.data.plot_id, 3);
      const buyArgs = JSON.parse(calls.filter(c => c.url.includes('buy_or_upgrade_plot')).at(-1).body);
      assert.equal(buyArgs.p_actor_id, actorId);
      assert.equal(buyArgs.p_plot_id, 3);
      assert.equal(buyArgs.p_key, 'flush-test-key');
      assert.equal((await (await call('/rt/world')).json()).today.wishes, 1);

      // Other people's balances move too. A plot-front claim pays the plot owner and can refund the previous holder: both get WALLET_SYNC
      // in whatever channel they are in, with no extra request. A coin sale pays the board holder, who is found through the account registry.
      const syncs = (ws) => msgs(ws).filter(m => m.t === 'WALLET_SYNC').length;
      const landlord = await join(env, 'chapel:square-3', 'guest:landlord');
      const evicted = await join(env, 'chapel:square', 'guest:evicted');
      const bystander = await join(env, 'chapel:square', 'guest:bystander');
      const front = await call('/rt/claim-billboard', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ topic: 'chapel:square', slot_id: 'PLOT_3', bid: 140, line1: '외벽', nickname: '까마귀' }),
      });
      assert.equal(front.status, 200);
      assert.equal(syncs(landlord), 1);
      assert.equal(syncs(evicted), 1);
      assert.equal(syncs(bystander), 0);
      assert.equal(msgs(evicted).filter(m => m.t === 'TAKE').length, 0); // its time had run out: not a takeover, nobody is told "taken"
      assert.equal(msgs(landlord).filter(m => m.t === 'WORLD_UPDATE').at(-1).data.slot_id, 'PLOT_3');
      // Points are never sent (non-game change): a guest or an account with any balance gets 410 off, and the database is never asked.
      const sell = (headers = auth) => call('/rt/sell-coins', { method: 'POST', headers, body: JSON.stringify({ topic: 'chapel:square', slot_id: 'PLOT_3', amount: 10, nickname: '까마귀' }) });
      const early = await sell();
      assert.equal(early.status, 410); assert.equal((await early.json()).code, 'off');
      world.wallet = { coins: 5900 };
      const still = await sell();
      assert.equal(still.status, 410); assert.equal((await still.json()).code, 'off');
      assert.equal(calls.some(c => c.url.includes('sell_coins_to_advertiser')), false);
      assert.equal(syncs(landlord), 1);
      assert.equal(syncs(bystander), 0);

      // A bulk change (no kind) reaches every socket and is not replayed to late joiners.
      const ring = room.hist.length;
      const bulk = await room.fetch(new Request('https://room.internal/world', { method: 'POST', body: '{"t":"WORLD_UPDATE"}' }));
      assert.equal(bulk.status, 200);
      assert.deepEqual(msgs(bystander).at(-1), { t: 'WORLD_UPDATE' });
      assert.equal(room.hist.length, ring);
    } finally {
      globalThis.fetch = origFetch;
      Date.now = origNow;
    }
  });

  it('strips EXIF from holder photo uploads, serves only approved photos, and gates review behind ADMIN_KEY', async () => {
    const origFetch = globalThis.fetch;
    globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
    const seg = (m, p) => [0xff, m, ((p.length + 2) >> 8) & 255, (p.length + 2) & 255, ...p];
    const jpeg = Buffer.from([0xff, 0xd8,
      ...seg(0xe0, [...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
      ...seg(0xe1, [...Buffer.from('Exif\0\0GPS-SECRET-37.5665N')]),
      ...seg(0xfe, [...Buffer.from('comment-secret')]),
      ...seg(0xc0, [8, 0, 180, 1, 64, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
      ...seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]), 1, 2, 3, 4, 0xff, 0xd9]);
    const calls = [];
    let stored = null, approved = false;
    globalThis.fetch = async (url, opt) => {
      const u = String(url), args = opt?.body ? JSON.parse(opt.body) : {};
      calls.push({ url: u, args });
      const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
      if (u.includes('/rest/v1/billboards') || u.includes('/rest/v1/plots')) return json([]);
      if (u.includes('/rpc/coin_batch')) return json({ ok: true, flushed: 1 });
      if (u.includes('/rpc/submit_billboard_photo')) {
        stored = args;
        return json({ ok: true, billboard: { slot_id: args.p_slot_id, holder_id: args.p_actor_id, photo_id: args.p_photo_id, photo_status: 'pending' }, remaining_coins: 50, fee: 1000 });
      }
      if (u.includes('/rpc/get_billboard_photo')) return json(stored && (approved || args.p_any) ? { ok: true, status: approved ? 'approved' : 'pending', jpeg: stored.p_jpeg_b64 } : { ok: false });
      if (u.includes('/rpc/list_billboard_photos')) return json({ ok: true, photos: [{ photo_id: stored.p_photo_id, slot_id: 'MAIN_TOP', status: args.p_status }] });
      if (u.includes('/rpc/review_billboard_photo')) {
        approved = args.p_approve === true;
        return json({ ok: true, billboard: { slot_id: 'MAIN_TOP', holder_id: stored.p_actor_id, photo_id: stored.p_photo_id, photo_status: 'approved' }, photo: { photo_id: args.p_photo_id, actor_id: stored.p_actor_id, status: 'approved', refunded: 0 } });
      }
      return new Response('missing', { status: 404 });
    };
    const ctx = { waitUntil() {} };
    const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ADMIN_KEY: 'admin-test-key-123', METER: meterStub(), ASSETS: { fetch: () => new Response('asset') } };
    const room = new Room(makeCtx(sqliteStorage()), env);
    env.ROOM = { idFromName: (t) => t, get: () => room };
    const call = (path, opt = {}, e = env) => worker.fetch(new Request('https://sq.example' + path, opt), e, ctx);
    try {
      const token = (await (await call('/rt/guest', { method: 'POST', body: '{}' })).json()).token;
      const actorId = 'guest:' + JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).s;
      const auth = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
      const sock = openSock(room, actorId);
      await room.webSocketMessage(sock, JSON.stringify({ t: 'MINE', amount: 5, nick: '까마귀' }));
      const body = (photo) => JSON.stringify({ topic: 'chapel:square', slot_id: 'MAIN_TOP', photo, actor_id: 'user:hacker' });

      assert.equal((await call('/rt/billboard-photo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body('') })).status, 401);
      const png = await call('/rt/billboard-photo', { method: 'POST', headers: auth, body: body(Buffer.from('\x89PNG\r\n\x1a\n0000000000000000').toString('base64')) });
      assert.equal(png.status, 400);
      assert.equal(calls.some(c => c.url.includes('submit_billboard_photo')), false);

      const sent = await call('/rt/billboard-photo', { method: 'POST', headers: auth, body: body('data:image/jpeg;base64,' + jpeg.toString('base64')) });
      assert.equal(sent.status, 200);
      const out = await sent.json();
      assert.equal(out.data.photo_status, 'pending');
      assert.equal(out.remaining_coins, 50);
      assert.equal(stored.p_actor_id, actorId);
      assert.equal(stored.p_slot_id, 'MAIN_TOP');
      assert.equal(stored.p_key, 'flush-test-key');
      const clean = Buffer.from(stored.p_jpeg_b64, 'base64');
      assert.equal(clean.includes('GPS-SECRET'), false);
      assert.equal(clean.includes('comment-secret'), false);
      assert.equal(clean.includes('JFIF'), true);
      assert.deepEqual([...clean.subarray(0, 2)], [0xff, 0xd8]);
      assert.deepEqual([...clean.subarray(-2)], [0xff, 0xd9]);
      assert.equal(clean.length, jpeg.length - 4 - 'Exif\0\0GPS-SECRET-37.5665N'.length - 4 - 'comment-secret'.length);
      const { createHash } = await import('node:crypto');
      assert.equal(stored.p_photo_id, createHash('sha256').update(actorId + '\nMAIN_TOP\n').update(clean).digest('hex').slice(0, 40));
      const rpcs = calls.filter(c => c.url.includes('/rpc/'));
      assert.ok(rpcs.findIndex(c => c.url.includes('coin_batch')) < rpcs.findIndex(c => c.url.includes('submit_billboard_photo')));
      assert.equal(msgs(sock).filter(m => m.t === 'WORLD_UPDATE').at(-1).data.photo_status, 'pending');
      assert.ok(msgs(sock).some(m => m.t === 'WALLET_SYNC'));
      assert.equal((await call('/rt/billboard-photo', { method: 'POST', headers: auth, body: body(jpeg.toString('base64')) })).status, 429);

      const id = stored.p_photo_id;
      assert.equal((await call(`/rt/photo/${id}.jpg`)).status, 404);
      assert.equal((await call('/rt/photo/not-a-hash.jpg')).status, 400);
      assert.equal((await call(`/rt/photo/${id}.jpg?review=1`)).status, 401);
      assert.equal((await call('/rt/admin/photos')).status, 401);
      assert.equal((await call('/rt/admin/photos', { headers: { 'x-admin-key': 'admin-test-key-12X' } })).status, 401);
      assert.equal((await call('/rt/admin/photos', { headers: { 'x-admin-key': '' } }, { ...env, ADMIN_KEY: '' })).status, 401);
      const list = await call('/rt/admin/photos?status=pending', { headers: { 'x-admin-key': 'admin-test-key-123' } });
      assert.equal(list.status, 200);
      assert.equal((await list.json()).photos[0].photo_id, id);
      const peek = await call(`/rt/photo/${id}.jpg?review=1`, { headers: { 'x-admin-key': 'admin-test-key-123' } });
      assert.equal(peek.status, 200);
      assert.equal(peek.headers.get('cache-control'), 'no-store');
      assert.equal((await call('/rt/admin/photo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ photo_id: id, approve: true }) })).status, 401);

      const ok = await call('/rt/admin/photo', { method: 'POST', headers: { 'x-admin-key': 'admin-test-key-123', 'content-type': 'application/json' }, body: JSON.stringify({ photo_id: id, approve: true }) });
      assert.equal(ok.status, 200);
      assert.equal(calls.filter(c => c.url.includes('review_billboard_photo')).at(-1).args.p_approve, true);
      assert.equal(msgs(sock).filter(m => m.t === 'WORLD_UPDATE').at(-1).data.photo_status, 'approved');
      const pub = await call(`/rt/photo/${id}.jpg`);
      assert.equal(pub.status, 200);
      assert.equal(pub.headers.get('content-type'), 'image/jpeg');
      assert.match(pub.headers.get('cache-control'), /max-age=3600/);
      assert.deepEqual(Buffer.from(await pub.arrayBuffer()), clean);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('exports emoji, claim, plot, and world-update hooks; no ground-coin send, and a drop-off carries only its board', async () => {
    const net = new Net();
    net.me = { name: '까마귀', x: 3.2, y: 4.6, face: 'e', anim: 'idle', fl: 2, vx: 0, vy: 0 };
    assert.equal(net.state().fl, 0);
    const sent = [];
    net.status = 'online';
    net.ch = { raw(o) { sent.push(o); return true; } };
    for (const gone of ['sendMine', 'sendFare', 'sendSess', 'sendFever', 'sendRevenge', 'sellCoins']) assert.equal(typeof net[gone], 'undefined', gone);
    assert.equal(net.sendDrop('STREET_4'), true);
    assert.deepEqual(sent[0], { t: 'FARE', slot: 'STREET_4' });
    assert.equal(net.sendBonus('hello', 40, '뉴'), true);
    assert.deepEqual(sent.at(-1), { t: 'BONUS', kind: 'hello', amount: 40, nick: '뉴' });
    assert.equal(sendEmoji(3), true);
    assert.deepEqual(sent.at(-1), { t: 'E', e: 3 });
    assert.equal(sendEmoji(5), false);

    const worlds = [];
    const wallets = [];
    const emojis = [];
    onWorldUpdate(ev => worlds.push(ev));
    net.on('wallet', ev => wallets.push(ev));
    net.on('emoji', ev => emojis.push(ev));
    const sb = {};
    rtPatch(sb, net);
    const ch = sb.channel('chapel:square', { config: { presence: { key: net.id } } });
    ch.msg(JSON.stringify({ t: 'WORLD_UPDATE', kind: 'BILLBOARD', data: { slot_id: 'SUB_B1' } }));
    ch.msg(JSON.stringify({ t: 'WALLET_SYNC' }));
    ch.msg(JSON.stringify({ t: 'E', k: 'guest:other', e: 4 }));
    assert.equal(worlds[0].data.slot_id, 'SUB_B1');
    assert.deepEqual(wallets[0], { t: 'WALLET_SYNC' });
    assert.deepEqual(emojis[0], { id: 'guest:other', e: 4 });

    const origFetch = globalThis.fetch;
    let captured = null;
    globalThis.fetch = async (url, opt) => {
      captured = { url: String(url), opt };
      if (String(url) === '/rt/buy-plot') return new Response(JSON.stringify({ ok: false, error: '코인이 부족합니다.' }), { status: 400 });
      return new Response(JSON.stringify({ ok: true, kind: 'BILLBOARD', data: { slot_id: 'MAIN_TOP' }, remaining_coins: 10 }), { status: 200 });
    };
    try {
      net.topic = 'chapel:square';
      net.sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'signed-token' } } }) } };
      const out = await claimBillboard({ slot_id: 'MAIN_TOP', bid: 100, line1: '안녕' });
      assert.equal(out.remaining_coins, 10);
      assert.equal(captured.url, '/rt/claim-billboard');
      assert.equal(captured.opt.headers.authorization, 'Bearer signed-token');
      const body = JSON.parse(captured.opt.body);
      assert.equal(body.topic, 'chapel:square');
      assert.equal(body.nickname, '까마귀');
      await assert.rejects(buyPlot({ plot_id: 1, sign_text: '간판' }), /코인이 부족합니다/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('maps plaza meters onto the 5 cm wire grid and flags history replays', () => {
    assert.equal(toNetUnits(0), 1500);
    assert.equal(toNetUnits(-45), 600);
    assert.equal(toNetUnits(12.34), 1747);
    assert.equal(fromNetUnits(toNetUnits(-6.28)), -6.3);
    assert.equal(fromNetUnits('1740'), 12);

    const net = new Net();
    const worlds = [];
    const emojis = [];
    net.on('world', ev => worlds.push(ev));
    net.on('emoji', ev => emojis.push(ev));
    const sb = {};
    rtPatch(sb, net);
    net.topic = 'chapel:square';
    const ch = sb.channel('chapel:square', { config: { presence: { key: net.id } } });
    ch.cb = () => {};
    ch.msg(JSON.stringify({ t: 'ok', s: {}, h: [{ t: 'WORLD_UPDATE', kind: 'PLOT', data: { plot_id: 3 } }, { t: 'E', k: 'guest:old', e: 2 }] }));
    assert.equal(worlds[0].replay, true);
    assert.equal(worlds[0].data.plot_id, 3);
    assert.deepEqual(emojis[0], { id: 'guest:old', e: 2, replay: true });
    ch.msg(JSON.stringify({ t: 'E', k: 'guest:live', e: 1 }));
    assert.deepEqual(emojis[1], { id: 'guest:live', e: 1 });
  });

  it('reports secret bindings as booleans and keeps dotfiles unserved', async () => {
    const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
    assert.match(sw, /pathname\.startsWith\('\/assets\/'\)/);
    assert.doesNotMatch(sw, /sprite-manifest|char_manifest|sprites\.json|7759/);
    const ctx = { waitUntil() {} }, origFetch = globalThis.fetch;
    // /rt/health also probes Supabase (db), says the budget level and the maintenance switch (test/ops.test.mjs): only the secret part here.
    globalThis.fetch = async () => new Response('[]', { status: 200 });
    const secrets = ({ hasFlushKey, hasGuestKey, mode, db, maint }) => { assert.equal(db, 'ok'); assert.equal(maint, false); return { hasFlushKey, hasGuestKey, mode }; };
    try {
      const present = await worker.fetch(new Request('https://sq.example/rt/health'), { FLUSH_KEY: 'flush-secret-value', GUEST_KEY: 'guest-secret-value' }, ctx);
      const body = await present.json();
      assert.deepEqual(secrets(body), { hasFlushKey: true, hasGuestKey: true, mode: 'DO' });
      const encoded = JSON.stringify(body);
      assert.equal(encoded.includes('flush-secret-value'), false);
      assert.equal(encoded.includes('guest-secret-value'), false);
      const missing = await worker.fetch(new Request('https://sq.example/rt/health'), {}, ctx);
      assert.deepEqual(secrets(await missing.json()), { hasFlushKey: false, hasGuestKey: false, mode: 'DO' });
      const blank = await worker.fetch(new Request('https://sq.example/rt/health'), { FLUSH_KEY: '', GUEST_KEY: '' }, ctx);
      assert.deepEqual(secrets(await blank.json()), { hasFlushKey: false, hasGuestKey: false, mode: 'DO' });
    } finally { globalThis.fetch = origFetch; }
    assert.equal((await worker.fetch(new Request('https://sq.example/.env.local'), { ASSETS: { fetch: () => new Response('secret') } }, ctx)).status, 404);
    assert.equal((await worker.fetch(new Request('https://sq.example/.git/config'), { ASSETS: { fetch: () => new Response('secret') } }, ctx)).status, 404);
  });

  it('S1: a guest id alone never yields a token; a handover ticket signed for that guest\'s own token does', async () => {
    const origFetch = globalThis.fetch, origNow = Date.now;
    const env = makeEnv(), ctx = { waitUntil() {} };
    const call = (path, opt = {}) => worker.fetch(new Request('https://sq.example' + path, opt), env, ctx);
    const mint = async (body = {}) => (await call('/rt/guest', post(body))).json();
    const ticketFor = async (g) => (await call('/rt/handover', { method: 'POST', headers: bearer(g.token) })).json();
    try {
      const a = await mint(), mine = await mint(), victim = await mint();
      assert.match(a.sub, /^g-[0-9a-f-]{36}$/);
      // The old handover took any public id, bare or with the guest: prefix. Now that only mints a stranger.
      for (const h of [a.sub, 'guest:' + a.sub, a.sub.toUpperCase()]) assert.notEqual((await mint({ h })).sub, a.sub);
      assert.notEqual((await mint({ t: mine.token, h: a.sub })).sub, a.sub);

      // A ticket is given only to that guest's own valid token.
      assert.equal((await call('/rt/handover', { method: 'POST' })).status, 401);
      assert.equal((await call('/rt/handover', { method: 'POST', headers: bearer('g1.e30.AAAA') })).status, 401);
      assert.equal((await call('/rt/handover', { headers: bearer(a.token) })).status, 405);
      const t = await ticketFor(a);
      assert.match(t.ticket, /^h1\.[\w-]+\.[\w-]+$/);
      assert.equal(ticketSub(t.ticket), a.sub);
      const life = t.exp * 1000 - Date.now();
      assert.ok(life > 890000 && life <= 900000);

      // The other browser redeems it, with no guest of its own or holding a different one, and becomes guest a.
      const moved = await mint({ h: t.ticket });
      assert.equal(moved.sub, a.sub);
      assert.equal(ticketSub((await ticketFor(moved)).ticket), a.sub);
      assert.equal((await mint({ t: mine.token, h: t.ticket })).sub, a.sub);

      // Forged: the victim's id under another guest's signature. A bad ticket falls back to the caller's own guest.
      const forged = 'h1.' + Buffer.from(JSON.stringify({ s: victim.sub, e: t.exp })).toString('base64url') + '.' + t.ticket.split('.')[2];
      assert.equal(ticketSub(forged), victim.sub);
      assert.notEqual((await mint({ h: forged })).sub, victim.sub);
      assert.equal((await mint({ t: mine.token, h: forged })).sub, mine.sub);
      // A ticket is not a login, and a login is not a ticket.
      assert.equal((await call('/rt/handover', { method: 'POST', headers: bearer(t.ticket) })).status, 401);
      assert.notEqual((await mint({ t: t.ticket })).sub, a.sub);
      assert.notEqual((await mint({ h: a.token })).sub, a.sub);
      // It lasts 15 minutes.
      const real = Date.now();
      Date.now = () => real + 901000;
      assert.notEqual((await mint({ h: t.ticket })).sub, a.sub);
      Date.now = origNow;
      // Renewal with the guest's own token keeps the identity.
      assert.equal((await mint({ t: a.token })).sub, a.sub);

      // Browser side. A bare id in the link is ignored. A ticket is kept next to this browser's own guest and guestToken() redeems it.
      globalThis.fetch = (url, opt) => call(String(url), opt);
      localStorage.setItem(GT_LS, JSON.stringify(mine));
      assert.equal(adoptHandover('?handover=' + encodeURIComponent('guest:' + a.sub) + '&autologin=google', localStorage), '');
      assert.deepEqual(JSON.parse(localStorage.getItem(GT_LS)), mine);
      const t2 = await ticketFor(a);
      assert.equal(adoptHandover('?handover=' + encodeURIComponent(t2.ticket) + '&autologin=google', localStorage), a.sub);
      assert.equal(JSON.parse(localStorage.getItem(GT_LS)).token, mine.token);
      const got = await guestToken();
      assert.equal(got.sub, a.sub);
      assert.deepEqual(Object.keys(JSON.parse(localStorage.getItem(GT_LS))).sort(), ['exp', 'sub', 'token']);
      // A stale link leaves the visitor with their own guest instead of wiping it.
      localStorage.setItem(GT_LS, JSON.stringify(mine));
      adoptHandover('?handover=' + encodeURIComponent(forged), localStorage);
      assert.equal((await guestToken()).sub, mine.sub);
      assert.equal(JSON.parse(localStorage.getItem(GT_LS)).ticket, undefined);
      // In-app side: the ticket for the login sheet is fetched in the background with this guest's token, never for a signed-in user.
      localStorage.setItem(GT_LS, JSON.stringify(a));
      const net = new Net();
      net.id = 'guest:' + a.sub;
      assert.equal(net.handoverTicket(), '');
      await net._htBusy;
      assert.equal(ticketSub(net.handoverTicket()), a.sub);
      const user = new Net();
      user.id = 'user:11111111-2222-3333-4444-555555555555';
      assert.equal(user.handoverTicket(), '');
      assert.equal(user._htBusy, undefined);

      // /rt/auth/merge still needs both the signed-in user and the guest's own token.
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'test-kid' };
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const head = b64({ alg: 'ES256', kid: 'test-kid' });
      const claims = b64({ sub: '11111111-2222-3333-4444-555555555555', exp: Math.floor(Date.now() / 1000) + 600, iss: 'https://yxddhpacuyaffaoutxjn.supabase.co/auth/v1', aud: 'authenticated' });
      const sig = Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(head + '.' + claims))).toString('base64url');
      const userToken = head + '.' + claims + '.' + sig;
      const merges = [];
      globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
      globalThis.fetch = async (url, opt) => {
        const u = String(url);
        if (u.includes('/.well-known/jwks.json')) return new Response(JSON.stringify({ keys: [jwk] }));
        if (u.includes('/rpc/merge_guest_account')) { merges.push(JSON.parse(opt.body)); return new Response(JSON.stringify({ ok: true, coins: 440, bonus: 300 })); }
        return new Response('[]');
      };
      const merge = (body, token = userToken) => call('/rt/auth/merge', post(body, bearer(token)));
      const gid = 'guest:' + a.sub;
      assert.equal((await merge({ guest_id: gid, guest_token: a.token }, a.token)).status, 401);
      assert.equal((await merge({ guest_id: gid })).status, 401);
      assert.equal((await merge({ guest_id: gid, guest_token: mine.token })).status, 401);
      assert.equal((await merge({ guest_id: gid, guest_token: t2.ticket })).status, 401);
      assert.equal((await merge({ guest_id: gid, guest_token: 'g1.not-base64!.x' })).status, 401);
      assert.equal(merges.length, 0);
      const linked = await merge({ guest_id: gid, guest_token: a.token });
      assert.equal(linked.status, 200);
      assert.equal(merges[0].p_guest_id, gid);
      assert.equal(merges[0].p_user_id, 'user:11111111-2222-3333-4444-555555555555');
    } finally {
      globalThis.fetch = origFetch;
      Date.now = origNow;
      localStorage.m.delete(GT_LS);
    }
  });

  it('S2: limits follow the account across rooms and sockets, and only the plaza\'s own topics get a room', async () => {
    const origFetch = globalThis.fetch, origNow = Date.now;
    let clock = NOON;
    Date.now = () => clock;
    globalThis.fetch = okFetch;
    const env = makeEnv(), ctx = { waitUntil() {} };
    const call = (path, opt = {}) => worker.fetch(new Request('https://sq.example' + path, opt), env, ctx);
    const send = (topic, ws, m) => env.room(topic).do.webSocketMessage(ws, JSON.stringify({ nick: '가', ...m }));
    const held = (topic, uid) => coinOf(env.room(topic).sql, uid);
    try {
      // Any chapel:<anything> used to create a Durable Object with its own fresh limits.
      const guest = await (await call('/rt/guest', post({}))).json();
      for (const topic of ['chapel:mine', 'chapel:square-9', 'chapel:square2', 'chapelqa:lobby', 'chapel:square/x', 'square', '']) {
        const ws = await call('/rt/ws?topic=' + encodeURIComponent(topic), { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'masil2, at.' + guest.token } });
        assert.equal(ws.status, 400, 'ws ' + topic);
        assert.equal((await call('/rt/flush-wallet', post({ topic }, bearer(guest.token)))).status, 400, 'flush ' + topic);
      }
      assert.equal((await call('/rt/room?topic=chapelqa:mine')).status, 403);
      assert.equal(env.rooms.size, 0);

      // Two sockets in one room share every gate.
      const uid = 'guest:g-00000000-0000-4000-8000-000000000001';
      const a1 = await join(env, SQ, uid), a2 = await join(env, SQ, uid);
      for (const ws of [a1, a2]) {
        await send(SQ, ws, { t: 'BONUS', kind: 'hello', amount: 40 });
        await send(SQ, ws, { t: 'BONUS', kind: 'draw', amount: 300 });
        await send(SQ, ws, { t: 'BONUS', kind: 'quest', amount: 100 });
        await send(SQ, ws, { t: 'MINE', amount: 15 });
      }
      assert.deepEqual(held(SQ, uid), { delta: 40, n: 1 });

      // Opening another channel moves the account: its sockets in the old room close, its pending coins settle, its gates come along.
      const b1 = await join(env, SQ2, uid);
      assert.equal(a1.closed && a2.closed, true);
      assert.deepEqual(msgs(a1).at(-1), { t: 'moved' });
      assert.equal(env.room(SQ).do.socks().size, 0);
      assert.equal(held(SQ, uid).n, 0);
      assert.equal(await env.METER.get('acct').roomOf(uid), SQ2);
      await send(SQ, a1, { t: 'MINE', amount: 15 });
      assert.equal(held(SQ, uid).n, 0);
      // In the new room the once-only and daily gates are already used and every cooldown counts from the move.
      await send(SQ2, b1, { t: 'BONUS', kind: 'hello', amount: 40 });
      await send(SQ2, b1, { t: 'BONUS', kind: 'draw', amount: 300 });
      await send(SQ2, b1, { t: 'MINE', amount: 15 });
      await send(SQ2, b1, { t: 'MINE', amount: 1 });
      await send(SQ2, b1, { t: 'FARE', amount: 25 });
      assert.equal(held(SQ2, uid).n, 0);
      clock += 2000;
      await send(SQ2, b1, { t: 'MINE', amount: 15 });
      assert.deepEqual(held(SQ2, uid), { delta: 0, n: 0 });
      for (let i = 0; i < 3; i++) await send(SQ2, b1, { t: 'BONUS', kind: 'quest', amount: 100 });
      assert.deepEqual(held(SQ2, uid), { delta: 0, n: 0 });
      clock += 237999;
      await send(SQ2, b1, { t: 'BONUS', kind: 'draw', amount: 300 });
      assert.equal(held(SQ2, uid).delta, 0);
      clock += 1;
      await send(SQ2, b1, { t: 'BONUS', kind: 'draw', amount: 300 });
      assert.equal(held(SQ2, uid).delta, 0);
      // The QA namespace pays the same wallets, so it shares the same seat and gates. Moving back does not help either.
      const q1 = await join(env, QA, uid);
      assert.equal(b1.closed, true);
      await send(QA, q1, { t: 'BONUS', kind: 'hello', amount: 40 });
      await send(QA, q1, { t: 'BONUS', kind: 'quest', amount: 100 });
      const back = await join(env, SQ, uid);
      await send(SQ, back, { t: 'BONUS', kind: 'hello', amount: 40 });
      await send(SQ, back, { t: 'BONUS', kind: 'draw', amount: 300 });
      assert.equal(held(QA, uid).n + held(SQ, uid).n, 0);
      // A new KST day opens the daily gates again, once.
      clock += 86400000;
      for (let i = 0; i < 5; i++) await send(SQ, back, { t: 'BONUS', kind: 'quest', amount: 100 });
      assert.deepEqual(held(SQ, uid), { delta: 0, n: 0 });

      // Moves are budgeted: 8 in a row (a full plaza bumps a newcomer through square-2..8), then one per 30 s.
      const hop = 'guest:g-00000000-0000-4000-8000-000000000003';
      const chain = [SQ, ...[2, 3, 4, 5, 6, 7, 8].map((n) => 'chapel:square-' + n)];
      for (const topic of chain) assert.ok(await join(env, topic, hop), topic);
      assert.ok(await join(env, SQ, hop));
      assert.equal(await join(env, SQ2, hop), null);
      assert.equal(await env.METER.get('acct').roomOf(hop), SQ);
      clock += 30000;
      assert.ok(await join(env, SQ2, hop));

      // A seat grant that arrives after a newer move already evicted this room is refused.
      const late = 'guest:g-00000000-0000-4000-8000-000000000004';
      const grant = { n: 4 };
      const lone = new Room(makeCtx(sqliteStorage()), { FLUSH_KEY: 'flush-test-key', METER: { idFromName: (n) => n, get: () => ({ seat: async () => ({ n: grant.n, fl: 0, gates: [['hello', '', 1]] }), add: async () => ({ lvl: 0 }) }) } });
      await lone.evict(late, 5);
      assert.equal(await lone.sit(late, SQ), -1);
      grant.n = 6;
      assert.equal(await lone.sit(late, SQ), 0);
      const seated = openSock(lone, late);
      await lone.webSocketMessage(seated, JSON.stringify({ t: 'BONUS', kind: 'hello', amount: 40 }));
      assert.equal(lone.ctx.storage.sql.db.prepare('select count(*) c from coin').get().c, 0);

      // Rooms that paid hello before the registry existed hand those gates over once, so they hold in every room.
      const old = makeEnv(), was = 'guest:g-00000000-0000-4000-8000-000000000005';
      const first = old.room(SQ);
      first.sql.db.exec('create table gate(k text primary key, at integer not null)');
      first.sql.db.prepare('insert into gate values(?, ?), (?, ?), (?, ?)').run(was + '|hello', 1700000000000, was + '|quest|2026-11-01', 3, 'fg|' + was, 7);
      first.do.tapDb();
      await new Promise((r) => setTimeout(r, 5));
      assert.deepEqual(first.sql.db.prepare('select k from gate order by k').all().map((r) => r.k), ['fg|' + was, was + '|quest|2026-11-01']);
      const elsewhere = await join(old, SQ2, was);
      await old.room(SQ2).do.webSocketMessage(elsewhere, JSON.stringify({ t: 'BONUS', kind: 'hello', amount: 40 }));
      assert.equal(coinOf(old.room(SQ2).sql, was).n, 0);
      new Room(makeCtx(first.sql), old).tapDb();
      assert.deepEqual(first.sql.db.prepare('select k from gate order by k').all().map((r) => r.k), ['!ag1', 'fg|' + was]);
    } finally {
      globalThis.fetch = origFetch;
      Date.now = origNow;
    }
  });

  // The fever (a coin-2x party a taxi gauge opened) is gone with the points for play: no gauge, no answer to FEVER, nothing on welcome.
  it('S3: no fever: fares move no gauge, FEVER and REV get no answer, and a joining socket hears no gauge', async () => {
    const origFetch = globalThis.fetch, origNow = Date.now;
    let clock = NOON - 400000;
    Date.now = () => clock;
    globalThis.fetch = okFetch;
    try {
      const { room } = makeRoom();
      const uid = 'guest:taxi', me = openSock(room, uid);
      let x = 0;
      for (let i = 0; i < 25; i++) {
        clock += 40000;
        await room.webSocketMessage(me, JSON.stringify({ t: 'p', a: [toNetUnits(x), toNetUnits(0), 0, 'idle', 0, 0, 0] }));
        await room.webSocketMessage(me, JSON.stringify({ t: 'PICK' }));
        await room.webSocketMessage(me, JSON.stringify({ t: 'FARE', amount: 25, nick: '기사', slot: 'STREET_1', riders: 1 }));
        x += 20;
      }
      for (const t of ['FEVER', 'REV']) await room.webSocketMessage(me, JSON.stringify({ t }));
      assert.equal(room.gateAt('fg|' + uid), 0);
      assert.equal(msgs(me).some((m) => m.t === 'FEVER' || m.t === 'REV' || m.t === 'PAY'), false);
      room.tapDb(); assert.equal(room.ctx.storage.sql.exec('select count(*) n from coin').one().n, 0);
      const fresh = openSock(room, 'guest:late'); room.admit(fresh, room.socks().get(fresh));
      const ok = msgs(fresh).find((m) => m.t === 'ok');
      for (const k of ['fg', 'fv', 'rv', 'lot']) assert.equal(k in ok, false, k);
      await room._fq;
    } finally {
      globalThis.fetch = origFetch;
      Date.now = origNow;
    }
  });

  it('S4: a link visit pays once per board per KST day, five boards a day, whatever the room', async () => {
    const origFetch = globalThis.fetch, origNow = Date.now;
    let clock = NOON;
    Date.now = () => clock;
    globalThis.fetch = okFetch;
    const env = makeEnv();
    const uid = 'guest:g-00000000-0000-4000-8000-000000000006';
    const click = async (topic, ws, slot) => { clock += 800; await env.room(topic).do.webSocketMessage(ws, JSON.stringify({ t: 'ADCLICK', nick: '가', slot })); };
    try {
      const a = await join(env, SQ, uid), peer = await join(env, SQ, 'guest:g-00000000-0000-4000-8000-000000000007');
      await click(SQ, a, 'STREET_1');
      assert.deepEqual(coinOf(env.room(SQ).sql, uid), { delta: 15, n: 1 });
      for (let i = 0; i < 20; i++) await click(SQ, a, 'STREET_1');
      for (const bad of ['MAIN_S', 'STREET_51', '', undefined]) await click(SQ, a, bad);
      assert.deepEqual(coinOf(env.room(SQ).sql, uid), { delta: 15, n: 1 });
      for (const slot of ['STREET_2', 'SUB_1A', 'PLOT_4', 'MAIN_TOP']) await click(SQ, a, slot);
      assert.deepEqual(coinOf(env.room(SQ).sql, uid), { delta: 75, n: 5 });
      for (const slot of ['STREET_6', 'STREET_7', 'MAIN_UP']) await click(SQ, a, slot);
      assert.deepEqual(coinOf(env.room(SQ).sql, uid), { delta: 75, n: 5 });
      // Only paid visits count as clicks on the board.
      assert.equal(env.room(SQ).sql.db.prepare('select clicks from adstat where slot = ?').get('STREET_1').clicks, 1);
      assert.equal(msgs(peer).filter((m) => m.t === 'AD' && m.kind === 'clicks').length, 5);
      // Another account has its own allowance. The same account in another room, the same day, has none left.
      await click(SQ, peer, 'STREET_1');
      assert.equal(coinOf(env.room(SQ).sql, 'guest:g-00000000-0000-4000-8000-000000000007').delta, 15);
      const b = await join(env, SQ2, uid);
      clock += 5000;
      for (const slot of ['STREET_1', 'STREET_8']) await click(SQ2, b, slot);
      assert.equal(coinOf(env.room(SQ2).sql, uid).n, 0);
      // The next KST day pays again.
      clock += 86400000;
      await click(SQ2, b, 'STREET_1');
      await click(SQ2, b, 'STREET_1');
      assert.deepEqual(coinOf(env.room(SQ2).sql, uid), { delta: 15, n: 1 });
    } finally {
      globalThis.fetch = origFetch;
      Date.now = origNow;
    }
  });

  it('S5: minting new guests is limited per client IP by the rate limit binding; renewals and handovers are not', async () => {
    const seen = [];
    let allow = 3;
    const env = makeEnv({ GUEST_RL: { async limit({ key }) { seen.push(key); return { success: allow-- > 0 }; } } }), ctx = { waitUntil() {} };
    const ip = '203.0.113.9';
    const call = (body) => worker.fetch(new Request('https://sq.example/rt/guest', post(body, { 'cf-connecting-ip': ip })), env, ctx);
    const first = await (await call({})).json();
    assert.equal((await call({})).status, 200);
    assert.equal((await call({})).status, 200);
    const over = await call({});
    assert.equal(over.status, 429);
    assert.equal(over.headers.get('retry-after'), '60');
    assert.deepEqual(await over.json(), { err: 'rate' });
    assert.deepEqual(seen, [ip, ip, ip, ip]);
    // A bare id or a broken token is still a mint.
    assert.equal((await call({ h: first.sub })).status, 429);
    assert.equal((await call({ t: 'g1.broken.token' })).status, 429);
    // Proving an existing guest is never limited and never counted.
    const n = seen.length;
    const renewed = await call({ t: first.token });
    assert.equal(renewed.status, 200);
    assert.equal((await renewed.json()).sub, first.sub);
    const { ticket } = await (await worker.fetch(new Request('https://sq.example/rt/handover', { method: 'POST', headers: bearer(first.token) }), env, ctx)).json();
    const handed = await call({ h: ticket });
    assert.equal(handed.status, 200);
    assert.equal((await handed.json()).sub, first.sub);
    assert.equal(seen.length, n);
    // If the limiter itself fails, or the binding is absent, new visitors still get in.
    env.GUEST_RL = { async limit() { throw new Error('down'); } };
    assert.equal((await call({})).status, 200);
    delete env.GUEST_RL;
    assert.equal((await call({})).status, 200);
    const cfg = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    assert.match(cfg, /"ratelimits": \[/);
    assert.match(cfg, /\{ "name": "GUEST_RL", "namespace_id": "\d+", "simple": \{ "limit": 10, "period": 60 \} \}/);
  });

  it('S6: attend and mission bonuses pay within their caps, per account per KST day; the pouch pays nothing', async () => {
    const origFetch = globalThis.fetch, origNow = Date.now;
    let clock = NOON;
    Date.now = () => clock;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/rpc/touch_attend')) {
        return new Response(JSON.stringify({ ok: true, amount: 10, streak: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return okFetch();
    };
    const env = makeEnv();
    const uid = 'guest:g-00000000-0000-4000-8000-000000000008';
    const bonus = (topic, ws, kind, amount) => env.room(topic).do.webSocketMessage(ws, JSON.stringify({ t: 'BONUS', kind, amount, nick: '가' }));
    const held = (topic) => coinOf(env.room(topic).sql, uid);
    try {
      const a = await join(env, SQ, uid), a2 = await join(env, SQ, uid);
      await bonus(SQ, a, 'attend', 50);
      assert.deepEqual(held(SQ), { delta: 10, n: 1 });
      await bonus(SQ, a, 'attend', 10);
      await bonus(SQ, a2, 'attend', 10);
      assert.deepEqual(held(SQ), { delta: 10, n: 1 });
      for (const amount of [20, 15, 5, 15, 15]) await bonus(SQ, a, 'mission', amount);
      assert.deepEqual(held(SQ), { delta: 10 + 15 + 15 + 15, n: 4 });
      for (let i = 0; i < 3; i++) { clock += 25000; await bonus(SQ, a, 'pouch', 99); } // the pouch is play: nothing
      assert.deepEqual(held(SQ), { delta: 55, n: 4 });
      for (const [kind, amount] of [['jackpot', 30], ['attend', 0], ['mission', -3], ['pouch', 'x'], ['star', 6], ['stunt', 8], ['hive', 2], ['', 5]]) await bonus(SQ, a, kind, amount);
      assert.equal(held(SQ).n, 4);
      // Same day, another room: nothing more.
      const b = await join(env, SQ2, uid);
      for (const kind of ['attend', 'mission', 'pouch']) await bonus(SQ2, b, kind, 30);
      assert.equal(held(SQ2).n, 0);
      // Next KST day: one more mission and the day's attendance (the server's 10, not the client's 30).
      clock += 86400000;
      await bonus(SQ2, b, 'mission', 15);
      await bonus(SQ2, b, 'attend', 30);
      await bonus(SQ2, b, 'attend', 30);
      assert.deepEqual(held(SQ2), { delta: 15 + 10, n: 2 });
    } finally {
      globalThis.fetch = origFetch;
      Date.now = origNow;
    }
  });

  it('pays no repeat income for play, and ignores client amounts', async () => {
    const origFetch = globalThis.fetch, origNow = Date.now;
    let clock = Date.parse('2026-11-15T03:00:00Z');
    Date.now = () => clock;
    globalThis.fetch = okFetch;
    try {
      const { room } = makeRoom();
      const me = openSock(room, 'guest:eco');
      const atStall = () => room.webSocketMessage(me, JSON.stringify({ t: 'p', a: [toNetUnits(21), toNetUnits(118), 0, 'idle', 0, 0, 0] }));
      await atStall();
      await room.webSocketMessage(me, JSON.stringify({ t: 'SESS', kind: 'bake', op: 'start' }));
      const started = msgs(me).filter((m) => m.t === 'SESS').at(-1);
      assert.equal(started.ok, true);
      clock += 8000;
      await room.webSocketMessage(me, JSON.stringify({ t: 'SESS', id: started.id, op: 'end', result: 'gold' }));
      const pay = msgs(me).filter((m) => m.t === 'PAY').at(-1);
      assert.deepEqual(pay, { t: 'PAY', kind: 'bake', amount: 0, why: 'off' }); // a gold bake from an older page: nothing
      await room.webSocketMessage(me, JSON.stringify({ t: 'MINE', amount: 15, nick: '가' }));
      await room.webSocketMessage(me, JSON.stringify({ t: 'BONUS', kind: 'draw', amount: 300, nick: '가' }));
      room.tapDb();
      assert.equal(room.ctx.storage.sql.exec('select delta from coin where uid = ?', 'guest:eco').toArray().length, 0);
    } finally {
      globalThis.fetch = origFetch;
      Date.now = origNow;
    }
  });

  // The 5-minute draw is gone (WISH BOARD has no lottery): no 'lotto' draw, no DRAW_CHECK answer, no ticket, nothing paid.
  it('has no draw: DRAW_CHECK gets no answer and pays nothing, and the Meter draws no number', async () => {
    const env = makeEnv();
    const room = env.room(SQ).do;
    const lotto = env.METER.get(env.METER.idFromName('lotto'));
    assert.equal(typeof lotto.draw, 'undefined');
    const me = openSock(room, 'guest:lot');
    room.tapDb();
    room.ctx.storage.sql.exec("insert into ag(uid, k, d, v) values(?, ?, '', ?)", 'guest:lot', 'lot:' + (Math.floor(Date.now() / 300000) - 1), 7); // a ticket from before
    await room.webSocketMessage(me, JSON.stringify({ t: 'DRAW_CHECK' }));
    await room.alarm();
    assert.equal(msgs(me).some((m) => m.t === 'DRAW'), false);
    assert.equal(room.ctx.storage.sql.exec('select count(*) n from coin').one().n, 0);
    const w = await readFile(new URL('../worker.js', import.meta.url), 'utf8');
    assert.doesNotMatch(w, /record_lottery_draw|drawDue|drawCheck|payDraw|DRAW_CHECK' && a\.q/);
  });

  it('relays only the game\'s own broadcasts as numbers, never chat, and caps them per socket', async () => {
    const origNow = Date.now;
    let clock = NOON;
    Date.now = () => clock;
    try {
      const { room } = makeRoom();
      const me = openSock(room, 'guest:me'), peer = openSock(room, 'guest:peer');
      const b = (e, p) => room.webSocketMessage(me, JSON.stringify({ t: 'b', e, p }));
      const got = () => msgs(peer).filter((m) => m.t === 'b');
      await b('chat', { name: '나', text: '자유 채팅' });
      await b('praise', { text: 'x' });
      await b('take');
      assert.equal(got().length, 1);
      assert.deepEqual(got()[0], { t: 'b', e: 'take', p: { id: 'guest:me' } });
      assert.equal(room.hist, null);
      await b('take', { id: 'guest:forged', seed: 7, i: 3, text: '몰래 보내는 글', r: '2' });
      assert.deepEqual(got().at(-1), { t: 'b', e: 'take', p: { id: 'guest:me', seed: 7, i: 3 } });
      await b('react', { r: 2 });
      assert.deepEqual(got().at(-1), { t: 'b', e: 'react', p: { id: 'guest:me', r: 2 } });
      assert.equal(msgs(me).some((m) => m.t === 'b'), false);
      // The legacy position form goes through the same clean-up as the compact one.
      await b('pos', { x: '글자', y: 5.4, face: 'a very long direction', anim: 'walk', vx: 'x' });
      assert.deepEqual(msgs(peer).filter((m) => m.t === 'P').at(-1), { t: 'P', k: 'guest:me', a: [0, 5, 'a very long ', 'walk', 0, 0, 0] });
      for (let i = 0; i < 60; i++) await b('jump', {});
      assert.equal(got().length, 30);
      clock += 10001;
      await b('jump', {});
      assert.equal(got().length, 31);
    } finally {
      Date.now = origNow;
    }
  });

  it('I2: events are stored per account and session and fold into daily visitors, return, session length and funnel', async () => {
    const origNow = Date.now, origFetch = globalThis.fetch;
    let clock = NOON;
    Date.now = () => clock;
    const DAY = 86400000, KEY = 'admin-test-key-123';
    const env = makeEnv({ ADMIN_KEY: KEY }), ctx = { waitUntil() {} };
    const call = (path, opt = {}) => worker.fetch(new Request('https://sq.example' + path, opt), env, ctx);
    const guest = async () => (await call('/rt/guest', post({}))).json();
    const ev = (name, sid, who, p) => call('/rt/event', post({ name, sid, p }, who ? bearer(who.token) : {}));
    const stats = async (q = '') => (await call('/rt/admin/stats' + q, { headers: { 'x-admin-key': KEY } })).json();
    try {
      const A = await guest(), B = await guest(), C = await guest();
      // Nov 15. A lands before a token exists, enters, earns, claims. B lands and leaves. Someone bounces with no account at all.
      assert.equal((await ev('page_landing', 'sess-a-0001')).status, 200);
      await ev('enter_square', 'sess-a-0001', A, { load_ms: 1234 });
      await ev('first_coin', 'sess-a-0001', A);
      await ev('board_claim', 'sess-a-0001', A, { tier: 'C', note: 'x'.repeat(90), deep: { no: 1 }, 'Bad Key': 1 });
      clock += 300000;
      await ev('session_end', 'sess-a-0001', A, { dur: 290 });
      await ev('page_landing', 'sess-b-0001', B);
      await ev('session_end', 'sess-b-0001', B, { dur: 20 });
      await ev('page_landing', 'sess-x-0001');
      assert.equal((await ev('made_up', 'sess-a-0001', A)).status, 400);
      assert.equal((await call('/rt/event')).status, 405);
      const raw = env.meter('ev').sql.db.prepare("select sid, uid, k, p from evt where k = 'board_claim'").get();
      assert.equal(raw.uid, 'guest:' + A.sub);
      assert.equal(raw.sid, 'sess-a-0001');
      assert.deepEqual(JSON.parse(raw.p), { tier: 'C', note: 'x'.repeat(40) });
      assert.equal(env.meter('ev').sql.db.prepare('select count(*) c from evt').get().c, 8);

      // The readout takes ADMIN_KEY in a header. No key in the URL, and FLUSH_KEY opens nothing.
      assert.equal((await call('/rt/admin/stats')).status, 401);
      assert.equal((await call('/rt/admin/stats?key=flush-test-key')).status, 401);
      assert.equal((await call('/rt/admin/stats?key=' + KEY)).status, 401);
      assert.equal((await call('/rt/admin/stats', { headers: { 'x-admin-key': 'flush-test-key' } })).status, 401);
      let s = await stats();
      assert.equal(s.today, '2026-11-15');
      assert.equal(s.days.length, 1);
      const { events, ...d15 } = s.days[0];
      assert.deepEqual(events, { page_landing: 3, enter_square: 1, first_coin: 1, board_claim: 1, session_end: 2 });
      assert.deepEqual(d15, {
        day: '2026-11-15', visitors: 2, new: 2, returning: 0, anon: 1, sessions: 3, len_avg: 103, len_med: 20,
        funnel: [3, 1, 1, 1], funnel_new: [2, 1, 1, 1], grow: [3, 1, 0, 0, 0, 0], ret: { 1: null, 7: null, 30: null },
        share_accounts: 0, claim_accounts: 1, focus_new: 0,
        visits: 3, enter_rate: 33, taxi_trips: 0, billboard_claims: 1, outbound_clicks: 0, account_conversions: 0,
      });

      // Nov 16. A comes back. C is new, links an account the same day and returns in a second tab as that user: one visitor, not two.
      // Yesterday is folded; its day-1 return is unknown until today is over.
      clock += DAY;
      const store = env.METER.get('ev');
      await ev('page_landing', 'sess-a-0002', A);
      await ev('enter_square', 'sess-a-0002', A);
      await ev('page_landing', 'sess-c-0001', C);
      await store.evAlias('guest:' + C.sub, 'user:u-2');
      await store.evAdd('page_landing', '2026-11-16', 'sess-c-0002', 'user:u-2', '');
      s = await stats();
      assert.deepEqual(s.days.map((d) => [d.day, d.visitors, d.new, d.returning]), [['2026-11-16', 2, 1, 1], ['2026-11-15', 2, 2, 0]]);
      assert.equal(s.days[0].sessions, 3);
      assert.equal(s.days[1].ret[1], null);
      assert.deepEqual(s.days[0].funnel_new, [1, 0, 0, 0]);

      // Nov 17. B linked a user account before coming back: the user inherits B's first day, so this is a return, not a new visitor.
      clock += DAY;
      await store.evAlias('guest:' + B.sub, 'user:u-1');
      await store.evAdd('page_landing', '2026-11-17', 'sess-b-0003', 'user:u-1', '');
      s = await stats();
      assert.deepEqual(s.days.map((d) => [d.day, d.visitors, d.new, d.returning]), [['2026-11-17', 1, 0, 1], ['2026-11-16', 2, 1, 1], ['2026-11-15', 2, 2, 0]]);
      assert.deepEqual(s.days[2].ret, { 1: 1, 7: null, 30: null });
      assert.equal((await stats('?days=2')).days.length, 2);

      // Nov 22. A is back a week after the first visit. On the 23rd the 15th shows day-1 and day-7 return of 1 out of 2.
      clock += 5 * DAY;
      await ev('page_landing', 'sess-a-0008', A);
      clock += DAY;
      s = await stats('?days=30');
      const first = s.days.at(-1);
      assert.equal(first.day, '2026-11-15');
      assert.deepEqual(first.ret, { 1: 1, 7: 1, 30: null });
      assert.equal(s.days[0].day, '2026-11-22');
      // The fold is kept once: asking again changes nothing, and history does not depend on the raw rows.
      env.meter('ev').sql.db.exec('delete from evt');
      assert.deepEqual((await stats('?days=30')).days, s.days);

      env.EVENT_RL = { async limit() { return { success: false }; } };
      assert.equal((await ev('page_landing', 'sess-a-0009', A)).status, 429);
    } finally {
      Date.now = origNow;
      globalThis.fetch = origFetch;
    }
  });

  it('I1/I2 client: a moved socket stays closed until the tab is used, and events wait for a token without asking for one', async () => {
    const origFetch = globalThis.fetch;
    const sent = [];
    globalThis.fetch = async (url, opt) => { sent.push({ url: String(url), headers: opt.headers, body: JSON.parse(opt.body) }); return new Response('{"ok":true}'); };
    const net = new Net();
    const sb = {};
    rtPatch(sb, net);
    const ch = sb.channel(SQ, { config: { presence: { key: net.id } } }), plain = sb.channel(SQ2, { config: { presence: { key: net.id } } });
    try {
      // One room per account: the server says 'moved' and closes. Reconnecting on a timer would make two tabs evict each other forever.
      const states = [];
      let opened = 0;
      ch.cb = (st) => states.push(st);
      ch.open = () => { opened++; };
      const ws = {};
      ch.ws = ws;
      ch.state = 'joined';
      ch.msg(JSON.stringify({ t: 'moved' }));
      ch.closed(ws);
      assert.deepEqual(states, ['CLOSED', 'CHANNEL_ERROR']);
      assert.equal(ch.rto, undefined);
      assert.equal(opened, 0);
      ch.kick();
      assert.equal(opened, 1);
      assert.equal(ch.moved, false);
      plain.cb = () => {};
      plain.open = () => {};
      plain.ws = ws;
      plain.state = 'joined';
      plain.closed(ws);
      assert.ok(plain.rto);

      // Events. page_landing fires before net.js has a guest token: it is held, nothing is minted, and it goes out with the token once one is stored.
      const { trackEvent } = await import('../analytics.js');
      window.G = { net };
      trackEvent('page_landing');
      trackEvent('not_a_major_event');
      assert.equal(sent.length, 0);
      localStorage.setItem(GT_LS, JSON.stringify({ token: 'g1.guest.tok', sub: 'g-x', exp: Math.floor(Date.now() / 1000) + 3600 }));
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(sent.length, 1);
      assert.equal(sent[0].url, '/rt/event');
      assert.equal(sent[0].headers.authorization, 'Bearer g1.guest.tok');
      assert.equal(sent[0].body.name, 'page_landing');
      assert.match(sent[0].body.sid, /^[\w-]{8,40}$/);
      trackEvent('enter_square', { load_ms: 5 });
      assert.deepEqual(sent[1].body, { name: 'enter_square', sid: sent[0].body.sid, p: { load_ms: 5 } });
      // first_coin: once per session, on the first points asked for (관람, a mission, the share photo; play pays none). The hello and
      // attendance payouts are automatic and do not count.
      net.status = 'online';
      net.ch = { raw: () => true };
      net.sendBonus('hello', 40, '가');
      net.sendBonus('attend', 10, '가');
      assert.equal(sent.length, 2);
      net.sendBonus('lounge', 2, '가');
      net.sendBonus('mission', 15, '가');
      net.sendDrop('STREET_1'); // a taxi drop-off is no earning
      assert.deepEqual(sent.slice(2).map((e) => e.body.name), ['first_coin']);
      // Signed in: the Supabase session is the account.
      localStorage.setItem(SESSION_LS, JSON.stringify({ access_token: 'jwt.user.tok', expires_at: Math.floor(Date.now() / 1000) + 3600 }));
      trackEvent('vip_modal_open');
      assert.equal(sent.at(-1).headers.authorization, 'Bearer jwt.user.tok');
    } finally {
      ch.close();
      plain.close();
      globalThis.fetch = origFetch;
      for (const k of [GT_LS, SESSION_LS, 'kts_sid', 'kts_ev_coin', 'kts_dur']) localStorage.m.delete(k);
      delete window.G;
    }
  });

  it('pays a numbered cheer and stores one report a day', async () => {
    const origNow = Date.now;
    let clock = Date.parse('2026-11-15T03:00:00Z');
    Date.now = () => clock;
    globalThis.fetch = okFetch;
    try {
      const { room } = makeRoom();
      // The room must know who holds the board (a cheer on a board of unknown holder is refused): the claim's WORLD_UPDATE tells it.
      await room.fetch(new Request('https://room.internal/world', post({ t: 'WORLD_UPDATE', kind: 'BILLBOARD', data: { slot_id: 'STREET_8', holder_id: 'guest:owner', holder_name: '주인', lit_until: new Date(clock + 864e5).toISOString(), expires_at: null } })));
      const me = openSock(room, 'guest:cheer');
      await room.webSocketMessage(me, JSON.stringify({ t: 'CHEER', slot: 'STREET_8', p: 1 }));
      const pay = msgs(me).filter((m) => m.t === 'PAY').at(-1);
      assert.equal(pay.kind, 'cheer');
      assert.equal(pay.amount, 4);
      clock += 11000;
      await room.webSocketMessage(me, JSON.stringify({ t: 'CHEER', slot: 'STREET_8', p: 99 }));
      assert.equal(msgs(me).filter((m) => m.t === 'PAY' && m.kind === 'cheer').length, 1);
    } finally {
      Date.now = origNow;
    }
  });

  it('serves a card route and keeps ref codes off the world payload', async () => {
    const src = await readFile(new URL('../worker.js', import.meta.url), 'utf8');
    const sql = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
    assert.match(src, /\/rt\/card\//);
    assert.match(sql, /FUNCTION public\.ensure_ref_code/);
    assert.match(sql, /ref_code TEXT/);
    const worldSelect = src.slice(src.indexOf('actor_id, nickname, spent, linked'), src.indexOf('actor_id, nickname, spent, linked') + 80);
    assert.equal(worldSelect.includes('ref_code'), false);
  });
});
