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

const { Room } = await import('../worker.js');
const worker = (await import('../worker.js')).default;
const { Net, sendMine, sendEmoji, claimBillboard, buyPlot, onWorldUpdate, rtPatch, toNetUnits, fromNetUnits } = await import('../net.js');

function sqliteStorage() {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    exec(query, ...args) {
      const q = String(query).trim();
      if (!args.length && /^create\b/i.test(q)) {
        db.exec(q);
        return { rowsWritten: 0, toArray() { return []; }, one() { return {}; } };
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
        };
      }
      const info = stmt.run(...args);
      return { rowsWritten: info.changes, toArray: () => [], one() { throw new Error('one on write'); } };
    },
  };
}

function makeCtx(sql) {
  return {
    storage: {
      sql,
      async getAlarm() { return null; },
      async setAlarm() {},
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

describe('times square plaza', { concurrency: false }, () => {
  it('keeps the Workers Free realtime budget constants and the 1.15s dead-reckoning sample', async () => {
    const workerSrc = await readFile(new URL('../worker.js', import.meta.url), 'utf8');
    const netSrc = await readFile(new URL('../net.js', import.meta.url), 'utf8');
    assert.match(workerSrc, /const CAP = 100, MEM = 0\.125, LEAN = 0\.8, HARD = 0\.95, STALE = 75000, SCAN = 5000, IDLE_SCAN = 60000, REP = 60000/);
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

  it('credits mines in memory-backed sqlite, ignores sub-2s repeats, caps 15, and flushes coin_batch', async () => {
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
      await room.webSocketMessage(me, JSON.stringify({ t: 'MINE', amount: 100, nick: '까마귀' }));
      await room.webSocketMessage(me, JSON.stringify({ t: 'MINE', amount: 5, nick: '까마귀' }));
      let row = sql.db.prepare('select delta, n, nick from coin').get();
      assert.equal(row.delta, 15);
      assert.equal(row.n, 1);
      assert.equal(row.nick, '까마귀');
      clock += 1999;
      await room.webSocketMessage(me, JSON.stringify({ t: 'MINE', amount: 5, nick: '까마귀' }));
      row = sql.db.prepare('select delta, n from coin').get();
      assert.equal(row.delta, 15);
      assert.equal(row.n, 1);
      clock += 1;
      await room.webSocketMessage(me, JSON.stringify({ t: 'MINE', amount: 14.2, nick: '까마귀' }));
      row = sql.db.prepare('select delta, n from coin').get();
      assert.equal(row.delta, 29);
      assert.equal(row.n, 2);

      await room.flush('guest:g-1');
      assert.equal(sql.db.prepare('select count(*) c from coin').get().c, 1);
      assert.equal(msgs(me).some(m => m.t === 'WALLET_SYNC'), false);
      assert.equal(calls[0].url.includes('/rpc/coin_batch'), true);
      const failed = JSON.parse(calls[0].body);
      assert.equal(failed.p_key, 'flush-test-key');
      assert.equal(failed.p_items[0].actor_id, 'guest:g-1');
      assert.equal(failed.p_items[0].delta, 29);

      const room2 = new Room(makeCtx(sql), room.env);
      const again = openSock(room2, 'guest:g-1');
      await room2.webSocketMessage(again, JSON.stringify({ t: 'MINE', amount: 5, nick: '까마귀' }));
      assert.equal(sql.db.prepare('select delta from coin').get().delta, 29);

      clock += 2000;
      await room.flush('guest:g-1');
      assert.equal(sql.db.prepare('select count(*) c from coin').get().c, 0);
      assert.equal(msgs(me).filter(m => m.t === 'WALLET_SYNC').length, 1);
      assert.equal(msgs(other).some(m => m.t === 'WALLET_SYNC'), false);
      const okBody = JSON.parse(calls[1].body);
      assert.equal(okBody.p_items[0].nickname, '까마귀');
      assert.equal(okBody.p_items[0].delta, 29);

      await room2.webSocketMessage(again, JSON.stringify({ t: 'MINE', amount: 4, nick: '까마귀' }));
      assert.equal(sql.db.prepare('select delta from coin').get().delta, 4);
      clock += 10000;
      await room2.alarm();
      assert.equal(sql.db.prepare('select count(*) c from coin').get().c, 1);
      clock += 20000;
      await room2.alarm();
      assert.equal(sql.db.prepare('select count(*) c from coin').get().c, 0);
      assert.equal(msgs(again).some(m => m.t === 'WALLET_SYNC'), true);

      const sql3 = sqliteStorage();
      const room3 = new Room(makeCtx(sql3), room.env);
      const farmer = openSock(room3, 'guest:farm');
      for (let i = 0; i < 20; i++) {
        clock += 2000;
        await room3.webSocketMessage(farmer, JSON.stringify({ t: 'MINE', amount: 1, nick: '농부' }));
      }
      await room3._fq;
      const batch = calls.map(c => ({ url: c.url, body: c.body })).filter(c => c.url.includes('coin_batch')).at(-1);
      const items = JSON.parse(batch.body).p_items;
      assert.equal(items.length, 1);
      assert.equal(items[0].delta, 20);
      assert.equal(items[0].actor_id, 'guest:farm');
      assert.equal(sql3.db.prepare('select count(*) c from coin').get().c, 0);
    } finally {
      Date.now = orig;
      globalThis.fetch = origFetch;
    }
  });

  it('serves /rt/world from the 15s isolate cache, reads the caller wallet, and broadcasts claims', async () => {
    const origFetch = globalThis.fetch;
    const jar = new Map();
    globalThis.caches = {
      default: {
        async match(req) { const hit = jar.get(req.url); return hit ? hit.clone() : undefined; },
        async put(req, res) { jar.set(req.url, res.clone()); },
        async delete(req) { jar.delete(req.url); return true; },
      },
    };
    const world = {
      boards: [{ slot_id: 'MAIN_S', line1: 'old', tier: 'S' }],
      plots: [{ plot_id: 1, level: 0, price: 500 }],
    };
    const calls = [];
    let failFlush = false;
    globalThis.fetch = async (url, opt) => {
      const u = String(url);
      calls.push({ url: u, body: opt?.body });
      const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
      if (u.includes('/rest/v1/billboards')) return json(world.boards);
      if (u.includes('/rest/v1/plots')) return json(world.plots);
      if (u.includes('/rest/v1/wallets')) return json([]);
      if (u.includes('/rpc/coin_batch')) return failFlush ? json({ message: 'down' }, 500) : json({ ok: true, flushed: 1 });
      if (u.includes('/rpc/claim_billboard')) return json({ ok: true, billboard: { slot_id: 'MAIN_S', line1: '새 문구', holder_id: 'kept' }, remaining_coins: 80 });
      if (u.includes('/rpc/buy_or_upgrade_plot')) return json({ ok: true, plot: { plot_id: 3, level: 1, owner_name: '까마귀' }, remaining_coins: 40 });
      return new Response('missing', { status: 404 });
    };
    const waits = [];
    const ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
    const sql = sqliteStorage();
    const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', METER: meterStub(), ASSETS: { fetch: () => new Response('asset', { status: 200 }) } };
    const room = new Room(makeCtx(sql), env);
    env.ROOM = { idFromName: (t) => t, get: () => room };
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
      assert.deepEqual(await first.json(), { billboards: world.boards, plots: world.plots });
      assert.equal(boards(), 1);
      await call('/rt/world');
      assert.equal(boards(), 1);

      const sock = openSock(room, actorId);
      await room.webSocketMessage(sock, JSON.stringify({ t: 'MINE', amount: 9, nick: '까마귀' }));
      world.boards = [{ slot_id: 'MAIN_S', line1: '새 문구', tier: 'S' }];
      failFlush = true;
      const blocked = await call('/rt/claim-billboard', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ topic: 'chapel:square', slot_id: 'MAIN_S', bid: 120, line1: '새 문구', nickname: '까마귀', actor_id: 'user:hacker' }),
      });
      assert.equal(blocked.status, 409);
      const blockedBody = await blocked.json();
      assert.equal(blockedBody.pending, true);
      assert.match(blockedBody.error, /미정산/);
      assert.equal(calls.some(c => c.url.includes('claim_billboard')), false);
      assert.equal(sql.db.prepare('select delta from coin').get().delta, 9);

      failFlush = false;
      const claimed = await call('/rt/claim-billboard', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ topic: 'chapel:square', slot_id: 'MAIN_S', bid: 120, line1: '새 문구', line2: '타임스퀘어', emoji: '🔥', bg_theme: 'cyber_navy', text_color: '#ffffff', nickname: '까마귀', actor_id: 'user:hacker' }),
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
      assert.equal(claimArgs.p_bid, 120);
      const seen = msgs(sock);
      assert.ok(seen.some(m => m.t === 'WALLET_SYNC' && Object.keys(m).length === 1));
      const update = seen.find(m => m.t === 'WORLD_UPDATE');
      assert.deepEqual(Object.keys(update).sort(), ['data', 'kind', 't']);
      assert.equal(update.kind, 'BILLBOARD');
      assert.equal(update.data.line1, '새 문구');
      const cached = await call('/rt/world');
      assert.equal((await cached.json()).billboards[0].line1, '새 문구');

      const bought = await call('/rt/buy-plot', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ topic: 'chapel:square', plot_id: 3, sign_text: '까마귀타워', theme_color: '#00ffcc', nickname: '까마귀' }),
      });
      assert.equal(bought.status, 200);
      const plotMsg = msgs(sock).filter(m => m.t === 'WORLD_UPDATE').at(-1);
      assert.equal(plotMsg.kind, 'PLOT');
      assert.equal(plotMsg.data.plot_id, 3);
      const buyArgs = JSON.parse(calls.filter(c => c.url.includes('buy_or_upgrade_plot')).at(-1).body);
      assert.equal(buyArgs.p_actor_id, actorId);
      assert.equal(buyArgs.p_plot_id, 3);
      assert.equal(buyArgs.p_key, 'flush-test-key');
    } finally {
      globalThis.fetch = origFetch;
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
      if (u.includes('/rpc/list_billboard_photos')) return json({ ok: true, photos: [{ photo_id: stored.p_photo_id, slot_id: 'MAIN_S', status: args.p_status }] });
      if (u.includes('/rpc/review_billboard_photo')) {
        approved = args.p_approve === true;
        return json({ ok: true, billboard: { slot_id: 'MAIN_S', holder_id: stored.p_actor_id, photo_id: stored.p_photo_id, photo_status: 'approved' }, photo: { photo_id: args.p_photo_id, actor_id: stored.p_actor_id, status: 'approved', refunded: 0 } });
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
      const body = (photo) => JSON.stringify({ topic: 'chapel:square', slot_id: 'MAIN_S', photo, actor_id: 'user:hacker' });

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
      assert.equal(stored.p_slot_id, 'MAIN_S');
      assert.equal(stored.p_key, 'flush-test-key');
      const clean = Buffer.from(stored.p_jpeg_b64, 'base64');
      assert.equal(clean.includes('GPS-SECRET'), false);
      assert.equal(clean.includes('comment-secret'), false);
      assert.equal(clean.includes('JFIF'), true);
      assert.deepEqual([...clean.subarray(0, 2)], [0xff, 0xd8]);
      assert.deepEqual([...clean.subarray(-2)], [0xff, 0xd9]);
      assert.equal(clean.length, jpeg.length - 4 - 'Exif\0\0GPS-SECRET-37.5665N'.length - 4 - 'comment-secret'.length);
      const { createHash } = await import('node:crypto');
      assert.equal(stored.p_photo_id, createHash('sha256').update(actorId + '\nMAIN_S\n').update(clean).digest('hex').slice(0, 40));
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

  it('exports mine, emoji, claim, plot, and world-update hooks', async () => {
    const net = new Net();
    net.me = { name: '까마귀', x: 3.2, y: 4.6, face: 'e', anim: 'idle', fl: 2, vx: 0, vy: 0 };
    assert.equal(net.state().fl, 0);
    const sent = [];
    net.status = 'online';
    net.ch = { raw(o) { sent.push(o); return true; } };
    assert.equal(sendMine(5), true);
    assert.deepEqual(sent[0], { t: 'MINE', amount: 5, nick: '까마귀' });
    assert.equal(sendMine(40, '길드'), true);
    assert.equal(sent[1].amount, 15);
    assert.equal(sent[1].nick, '길드');
    assert.equal(sendMine(0), false);
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
      return new Response(JSON.stringify({ ok: true, kind: 'BILLBOARD', data: { slot_id: 'MAIN_S' }, remaining_coins: 10 }), { status: 200 });
    };
    try {
      net.topic = 'chapel:square';
      net.sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'signed-token' } } }) } };
      const out = await claimBillboard({ slot_id: 'MAIN_S', bid: 100, line1: '안녕' });
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
    const ctx = { waitUntil() {} };
    const present = await worker.fetch(new Request('https://sq.example/rt/health'), { FLUSH_KEY: 'flush-secret-value', GUEST_KEY: 'guest-secret-value' }, ctx);
    const body = await present.json();
    assert.deepEqual(body, { hasFlushKey: true, hasGuestKey: true, mode: 'DO' });
    const encoded = JSON.stringify(body);
    assert.equal(encoded.includes('flush-secret-value'), false);
    assert.equal(encoded.includes('guest-secret-value'), false);
    const missing = await worker.fetch(new Request('https://sq.example/rt/health'), {}, ctx);
    assert.deepEqual(await missing.json(), { hasFlushKey: false, hasGuestKey: false, mode: 'DO' });
    const blank = await worker.fetch(new Request('https://sq.example/rt/health'), { FLUSH_KEY: '', GUEST_KEY: '' }, ctx);
    assert.deepEqual(await blank.json(), { hasFlushKey: false, hasGuestKey: false, mode: 'DO' });
    assert.equal((await worker.fetch(new Request('https://sq.example/.env.local'), { ASSETS: { fetch: () => new Response('secret') } }, ctx)).status, 404);
    assert.equal((await worker.fetch(new Request('https://sq.example/.git/config'), { ASSETS: { fetch: () => new Response('secret') } }, ctx)).status, 404);
  });
});
