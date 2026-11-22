// Traffic audit (2026-11-22): requests a full room made for nothing, and DO calls the daily budget did not see.
// 1. main.js: the 'online' work (resync = /rt/wallet + /rt/world, DRAW_CHECK) runs once per connect, not on every presence sync.
// 2. Room: DRAW_CHECK asks 'lotto' (and Supabase) once per bucket per room; the Room's own DO calls and its alarm count toward the budget.
// 3. net.js DO send rule: no 0/+1 sign flicker on a run along a street axis; the budget's lean level slows the rule (it did nothing before).
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
globalThis.window = globalThis;
Object.defineProperty(globalThis, 'navigator', { value: { webdriver: false, onLine: true, userAgent: 'node' }, configurable: true });
globalThis.document = { hidden: false, addEventListener() {} };
globalThis.addEventListener = () => {};
globalThis.localStorage = { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); }, removeItem(k) { this.m.delete(k); } };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = { search: '?rt=do', hostname: 'masil.example.workers.dev', href: 'https://masil.example.workers.dev/', protocol: 'https:', origin: 'https://masil.example.workers.dev' };
globalThis.WebSocketRequestResponsePair = class { constructor(req, res) { this.req = req; this.res = res; } };

const { Room } = await import('../worker.js');
const { Net, rtPatch, DO_MODE, toNetUnits } = await import('../net.js');
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

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
function makeCtx(sql) {
  const c = {
    alarm: null, alarms: [],
    storage: { sql, async getAlarm() { return c.alarm; }, async setAlarm(t) { c.alarm = Number(t); c.alarms.push(Number(t)); }, async deleteAlarm() { c.alarm = null; }, transactionSync(fn) { return fn(); } },
    setWebSocketAutoResponse() {}, getWebSockets() { return []; }, getWebSocketAutoResponseTimestamp() { return new Date(); }, acceptWebSocket() {},
  };
  return c;
}
// METER: 'lotto' counts its draws (one number per bucket, like Meter.draw), 'day' records each add, anything else answers nothing.
function makeRoom() {
  const draws = [], adds = [], wins = new Map(), calls = [];
  const lotto = { async draw(b) { draws.push(b); if (!wins.has(b)) wins.set(b, 1 + (b % 15)); return wins.get(b); } };
  const day = { async add(n, g) { adds.push([n, g]); return { n, g, lvl: 0 }; } };
  const other = new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : async (...a) => { calls.push(String(k)); return null; }) });
  const env = { METER: { idFromName: (n) => n, get: (id) => (id === 'lotto' ? lotto : id === 'day' ? day : other) } };
  env.ROOM = { idFromName: (t) => t, get: () => ({ fetch: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }) }) };
  const room = new Room(makeCtx(sqliteStorage()), env);
  return { room, draws, adds, calls };
}
function openSock(room, id) {
  const ws = { sent: [], send(s) { this.sent.push(String(s)); }, close() { this.closed = true; }, serializeAttachment() {}, deserializeAttachment() { return null; } };
  room.socks().set(ws, { k: id, q: true, v2: true, fl: 0, lob: false, t: Date.now(), ls: Date.now(), m: { x: 1500, y: 1500, fl: 0 } });
  return ws;
}

describe('1. main.js: the online work runs once per connect', () => {
  // The status listener as main.js has it, run against stubs (queuePos is the queue number main.js keeps).
  const src = read('main.js'), a = src.indexOf('let syncedAt = 0;'), b = src.indexOf("net.on('gate'", a);
  const block = src.slice(a, b);
  it('the block is where the test reads it', () => {
    assert.ok(a > 0 && b > a);
    assert.match(block, /function resync\(\)/);
    assert.match(block, /net\.on\('status'/);
  });
  function harness() {
    const h = {}, sent = [], log = { wallet: 0, world: 0, bind: 0 }, Q = { pos: 0 };
    const net = { on(ev, fn) { h[ev] = fn; }, ch: { raw(o) { sent.push(o.t); return true; } } };
    const ui = { setStatus() {}, note() {} };
    new Function('net', 'ui', 'refreshWallet', 'refreshWorld', 'bindTake', 'Q', block.replace(/\bqueuePos\b/g, 'Q.pos'))(net, ui, () => log.wallet++, () => log.world++, () => log.bind++, Q);
    return { say: (s) => h.status(s), sent, log, Q };
  }
  // There is no draw any more (no lottery): a connect sends nothing to the room by itself, it only resyncs and binds once.
  it('presence syncs (the same status again) do not resync; a connect sends no DRAW_CHECK', () => {
    const was = Date.now; let now = 1e12; Date.now = () => now;
    try {
      const t = harness();
      t.say('connecting'); t.say('online');
      assert.deepEqual(t.sent, []);
      assert.deepEqual(t.log, { wallet: 1, world: 1, bind: 1 });
      for (let i = 0; i < 40; i++) { now += 1000; t.say('online'); } // 40 joins / leaves / outfit changes in the room
      assert.deepEqual(t.log, { wallet: 1, world: 1, bind: 1 });
      t.say('connecting'); now += 1000; t.say('online'); // a reconnect: resyncs again (resync keeps its own 15 s spacing)
      assert.equal(t.log.wallet, 2);
      assert.deepEqual(t.sent, []);
    } finally { Date.now = was; }
  });
  it('a connect while a queue number shows binds once the number is gone', () => {
    const t = harness();
    t.Q.pos = 3; t.say('online');
    assert.equal(t.log.bind, 0);
    t.Q.pos = 0; t.say('online'); t.say('online');
    assert.equal(t.log.bind, 1);
    assert.deepEqual(t.sent, []);
  });
});

describe('2. Room: no draw, and its own DO calls in the budget', () => {
  it('a room full of DRAW_CHECKs (pages from before the lottery went) asks lotto nothing and pays nothing', async () => {
    const was = Date.now; let now = Date.UTC(2026, 10, 22, 3, 2, 0); Date.now = () => now;
    try {
      const { room, draws } = makeRoom(), bucket = Math.floor(now / 300000) - 1;
      room.tapDb();
      const socks = Array.from({ length: 20 }, (_, i) => openSock(room, 'guest:d' + i));
      room.ctx.storage.sql.exec("insert into ag(uid, k, d, v) values(?, ?, '', ?)", 'guest:d3', 'lot:' + bucket, 1 + (bucket % 15)); // a ticket from before
      room.lastRep = now;
      const c0 = room.conns;
      for (let round = 0; round < 3; round++) for (const ws of socks) await room.webSocketMessage(ws, JSON.stringify({ t: 'DRAW_CHECK' }));
      assert.deepEqual(draws, []);
      assert.equal(room.conns - c0, 0); // no DO call at all
      assert.equal(socks.some((w) => w.sent.some((s) => JSON.parse(s).t === 'DRAW')), false);
      assert.equal(room.ctx.storage.sql.exec('select count(*) n from coin').one().n, 0);
    } finally { Date.now = was; }
  });
  it('the alarm counts itself and draws nothing', async () => {
    const { room, adds, draws } = makeRoom();
    openSock(room, 'guest:a1');
    await room.alarm();
    assert.ok(adds.length >= 1);
    assert.ok(adds[0][0] >= 1, 'the alarm itself is in the first report');
    assert.equal(draws.length, 0);
    assert.equal(room.conns, 0); // nothing after its report
  });
  it('the alarm still settles pending coins after its report', async () => {
    const { room } = makeRoom();
    openSock(room, 'guest:a2');
    room.tapDb();
    room.ctx.storage.sql.exec("insert into coin(uid, nick, delta, n, at, reason) values('guest:a2', 'n', 3, 1, 0, 'mine')");
    room.syncPending();
    assert.equal(room.tapN, 1);
    await room.alarm();
    assert.match(String(room.flushErr || ''), /FLUSH_KEY/); // the flush ran (this env has no key, so it keeps the coins)
  });
  it('an earning room wakes when its coins are due (30 s), not every 5 s', async () => {
    const was = Date.now; let now = 1.8e12; Date.now = () => now;
    try {
      const { room } = makeRoom(), a = room.socks().get(openSock(room, 'guest:e1'));
      room.tapDb();
      const t0 = now;
      for (let i = 0; i < 15; i++) { room.grantFinal(a, 1, 'n', 'mine'); await new Promise((r) => setImmediate(r)); now += 2000; } // a coin every 2 s
      assert.equal(room.ctx.alarm, t0 + 30000);
      assert.ok(room.ctx.alarms.every((t) => t >= t0 + 30000), 'never pulled in to the 5 s scan');
      room.socks().get([...room.socks().keys()][0]).q = false; // someone waiting in the queue: the 5 s scan again
      room.ctx.alarm = now + 60000; await room.arm();
      assert.equal(room.ctx.alarm, now + 5000);
    } finally { Date.now = was; }
  });
  it('a failed flush is not retried on every grant; the alarm retries it FLUSH_MS later', async () => {
    const was = Date.now; let now = 1.8e12; Date.now = () => now;
    try {
      const { room } = makeRoom(), a = room.socks().get(openSock(room, 'guest:f1'));
      room.tapDb();
      let tries = 0; const real = room._flush.bind(room); room._flush = (...x) => { tries++; return real(...x); };
      for (let i = 0; i < 20; i++) room.grantFinal(a, 1, 'n', 'mine'); // the 20th reaches FLUSH_N: a flush, which fails (no FLUSH_KEY here)
      await room.flush();
      assert.equal(tries, 2);
      assert.ok(room.flushBad > 0);
      for (let i = 0; i < 30; i++) { now += 500; room.grantFinal(a, 1, 'n', 'mine'); await new Promise((r) => setImmediate(r)); }
      assert.equal(tries, 2, 'no retry per grant');
      assert.ok(room.ctx.alarm >= room.flushBad + 30000);
      now = room.ctx.alarm; await room.alarm();
      assert.equal(tries, 3, 'the alarm retries');
    } finally { Date.now = was; }
  });
  it('every connect counts its registry read (and the copy it fills)', async () => {
    const { room, calls } = makeRoom();
    const c0 = room.conns;
    await room.loadProf('guest:p1');
    assert.deepEqual(calls, ['profileOf']);
    assert.equal(room.conns - c0, 1);
  });
  it('a cheer counts the shard copies it sends', () => {
    const { room } = makeRoom();
    room.topicName = 'chapel:square';
    room.tapDb();
    const c0 = room.conns;
    room.shareCheer('STREET_1', 1);
    assert.equal(room.conns - c0, 7); // square-2..8
  });
});

describe('3. net.js: the DO position send rule', () => {
  assert.equal(DO_MODE, true);
  const DEG = Math.PI / 180;
  // The game's netState for a run at a fixed heading (timesSquare3d.js: x/y in net units, face in 15-degree steps, anim walk), one tick per frame.
  function runSends({ heading, secs = 30, speed = 6.2, turn = 0, reverseAt = 0 }) {
    const was = performance.now; let t = 0; performance.now = () => t;
    try {
      const sent = [], net = new Net();
      net.ch = { send(o) { sent.push({ t, ...o.payload }); }, track() {} }; net.status = 'online'; net.cells = new Map(); net.topic = 'chapel:square';
      let x = 0, z = 0, h = heading;
      for (let i = 0; i < secs * 60; i++) {
        t = i * (1000 / 60);
        if (reverseAt && t >= reverseAt * 1000 && h === heading) h = heading + Math.PI;
        h += turn * DEG / 60;
        x += Math.sin(h) * speed / 60; z += Math.cos(h) * speed / 60;
        net.tick({ name: 'n', outfit: '#fff', av: 1, equip: '', x: toNetUnits(x), y: toNetUnits(z), face: String(Math.round(h / DEG / 15) * 15), anim: 'walk', fl: 0, vx: Math.round(Math.sin(h) * speed * 20), vy: Math.round(Math.cos(h) * speed * 20) });
      }
      return sent;
    } finally { performance.now = was; }
  }
  it('a run 1 degree off a street axis sends a keepalive every 3 s, not a turn every 120 ms', () => {
    for (const deg of [0.5, 1, 2, 3, 89, 181]) {
      const sent = runSends({ heading: deg * DEG });
      assert.ok(sent.length <= 12, `heading ${deg}: ${sent.length} packets in 30 s`);
    }
  });
  it('a reversal still goes out at once', () => {
    const sent = runSends({ heading: 1 * DEG, secs: 8, reverseAt: 4 });
    const after = sent.filter((p) => p.t >= 4000);
    assert.ok(after.length >= 1 && after[0].t - 4000 <= 300, 'reversal sent within 300 ms');
  });
  it('turning still sends each 15-degree step, at least 120 ms apart', () => {
    const sent = runSends({ heading: 0.2, secs: 10, turn: 90 });
    assert.ok(sent.length >= 50, `${sent.length} packets for a 90 deg/s turn`);
    for (let i = 1; i < sent.length; i++) assert.ok(sent[i].t - sent[i - 1].t > 120);
  });
  it('lean (cfg from the room) widens the gap to 250 ms and the keepalive to 4 s; back to normal after', () => {
    const sb = { channel() {}, removeChannel() {}, getChannels() { return []; } };
    rtPatch(sb, null);
    const ch = sb.channel('chapel:square', {});
    ch.msg(JSON.stringify({ t: 'cfg', lean: true }));
    assert.equal(Net.LEAN, true);
    try {
      const turning = runSends({ heading: 0.2, secs: 10, turn: 90 });
      for (let i = 1; i < turning.length; i++) assert.ok(turning[i].t - turning[i - 1].t > 250);
      const straight = runSends({ heading: 17 * DEG, secs: 30 });
      for (let i = 2; i < straight.length; i++) assert.ok(straight[i].t - straight[i - 1].t > 4000 - 20);
      assert.ok(straight.length >= 7 && straight.length <= 9);
    } finally { ch.msg(JSON.stringify({ t: 'cfg', lean: false })); }
    assert.equal(Net.LEAN, false);
    assert.ok(Net.LEAN_KEEP + 0 < 1150 + 3200, 'keepalive inside the receivers\' dead-reckoning horizon');
  });
  it('the packet itself is unchanged (v2 p, 7 numbers / strings)', () => {
    assert.match(read('net.js'), /this\.raw\(\{ t: 'p', a: \[p\.x, p\.y, p\.face, p\.anim, p\.fl, p\.vx, p\.vy\] \}\)/);
    assert.match(read('net.js'), /performance\.now\(\) - 1150/);
  });
});
