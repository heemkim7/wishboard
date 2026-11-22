// Daily budget, 2026-11-22 second pass: the guard also sees SQLite rows written / read in every DO and Worker requests (Workers Free caps both at
// 100k a day; rows written are the first free limit players reach), and a room no longer drops what it counted when it hibernates or empties.
// 1. rows come from the cursors' own rowsWritten / rowsRead (what Cloudflare bills), plus one row per setAlarm / deleteAlarm
// 2. Meter.add keeps them in today's UTC row; the level is the highest of five fractions; FREE / PAID numbers and the BUDGET_*_DAY overrides
// 3. a room carries its unreported counts on a socket attachment through hibernation, reports on its last close, hands them back when empty
// 4. other Meter instances batch their rows; Worker requests ride the isolate tally; /rt/gate shows the new numbers
// 5. nothing adds a DO call per write, per message or per request
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
globalThis.WebSocketRequestResponsePair = class { constructor(req, res) { this.req = req; this.res = res; } };

const W = await import('../worker.js');
const worker = W.default, { Meter, Room } = W;
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const turn = () => new Promise((r) => setImmediate(r));

// SQLite behind the workerd cursor shape. Every cursor reports rowsWritten (changes) and rowsRead (rows returned: the stub cannot see scanned rows),
// and the log keeps each one so a test can sum what the runtime would bill, independently of the code under test.
function sqliteStorage(log = []) {
  const db = new DatabaseSync(':memory:');
  const cur = (rows, w) => { const c = { rowsWritten: w, rowsRead: rows.length, toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error('one'); return rows[0]; }, [Symbol.iterator]: () => rows[Symbol.iterator]() }; log.push(c); return c; };
  return {
    db, log,
    exec(query, ...args) {
      const q = String(query).trim();
      if (!args.length && /^create\b/i.test(q)) { db.exec(q); return cur([], 0); }
      const stmt = db.prepare(q);
      if (/^select\b/i.test(q)) return cur(stmt.all(...args), 0);
      const info = stmt.run(...args); return cur([], Number(info.changes) || 0);
    },
  };
}
const billed = (log) => log.reduce((s, c) => ({ w: s.w + c.rowsWritten, r: s.r + c.rowsRead }), { w: 0, r: 0 });
function makeCtx(sql, socks = []) {
  const c = { alarm: null, sets: 0, socks,
    storage: { sql, async getAlarm() { return c.alarm; }, async setAlarm(t) { c.alarm = Number(t); c.sets++; }, async deleteAlarm() { c.alarm = null; }, transactionSync(fn) { return fn(); } },
    setWebSocketAutoResponse() {}, getWebSockets() { return c.socks.filter((w) => !w.closed); }, getWebSocketAutoResponseTimestamp() { return new Date(Date.now()); }, acceptWebSocket() {} };
  return c;
}
// A socket whose attachment survives "hibernation" (a new Room on the same ctx), like the runtime's.
function sock(id) {
  return { id, sent: [], att: null, saves: 0, send(s) { this.sent.push(String(s)); }, close() { this.closed = true; },
    serializeAttachment(v) { this.att = structuredClone(v); this.saves++; }, deserializeAttachment() { return this.att ? structuredClone(this.att) : null; } };
}
function roomEnv() {
  const adds = [], other = new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : async () => null) });
  const day = { async add(n, g, x) { adds.push({ n, g, x: x ? { ...x } : null }); return { n, g, lvl: 0 }; } };
  const env = { METER: { idFromName: (n) => n, get: (id) => (id === 'day' ? day : other) }, ROOM: { idFromName: (t) => t, get: () => ({ fetch: async () => new Response('{}') }) } };
  return { env, adds };
}
function join(room, ctx, id) {
  const ws = sock(id), a = { k: id, q: true, v2: true, fl: 0, lob: false, t: Date.now(), ls: Date.now(), sf: 0, m: { x: 1500, y: 1500, fl: 0 } };
  ctx.socks.push(ws); room.socks().set(ws, a); room.save(ws, a); return ws;
}
let clockBase = Date.parse('2027-06-01T03:00:00Z');
function clock() { clockBase += 10 * 864e5; let t = clockBase; const was = Date.now; Date.now = () => t; return { add: (ms) => { t += ms; }, now: () => t, done: () => { Date.now = was; } }; }

describe('1. rows come from the cursors', () => {
  it('a coin grant: the rows the room reports are the sum of its cursors\' rowsWritten / rowsRead, plus its setAlarm', async () => {
    const c = clock();
    try {
      const sql = sqliteStorage(), ctx = makeCtx(sql), { env, adds } = roomEnv(), room = new Room(ctx, env);
      const ws = join(room, ctx, 'guest:m1'); room.tapDb(); await turn();
      room.meter(true); await turn(); // report what joining cost, so the next report is the grant alone
      const from = sql.log.length, sets0 = ctx.sets; c.add(61000);
      await room.webSocketMessage(ws, JSON.stringify({ t: 'MINE', amount: 1, nick: 'n' })); await turn(); await turn();
      assert.ok(JSON.parse(ws.sent.at(-1)).amount > 0, 'the grant was paid');
      const want = billed(sql.log.slice(from)), last = adds.at(-1);
      assert.ok(want.w >= 3, 'a grant writes rows (rate, the hour gate, the coin row)');
      assert.ok(ctx.sets - sets0 >= 1, 'the grant set the flush alarm');
      // the report at the end of the message has the grant's rows; the alarm set after an await waits for the next report
      assert.deepEqual({ w: last.x.w + room.rows.w, r: last.x.r + room.rows.r }, { w: want.w + (ctx.sets - sets0), r: want.r }, 'cursor rows plus one per setAlarm');
      assert.ok(last.x.w >= want.w - 1);
    } finally { c.done(); }
  });
  it('a cursor read later in the same turn counts its final rowsRead; one read after an await counts what it had by then', async () => {
    const R = [];
    let step = 0; const lazy = () => { const c = { rowsWritten: 0, rowsRead: 1, *[Symbol.iterator]() { for (let i = 0; i < 5; i++) { c.rowsRead = 1 + i; yield { i }; } } }; return c; };
    const raw = { exec() { step++; const c = lazy(); R.push(c); return c; } };
    const m = new Meter(makeCtx(raw), {}); m.isDay = 1; // no reporting: only the box is looked at
    const c1 = m.ctx.storage.sql.exec('select'); const n1 = [...c1].length; await turn();
    assert.equal(n1, 5); assert.equal(m.rows.r, 2 + 5, 'the constructor\'s two creates read 1 each, the lazy cursor all 5');
    m.rows.r = 0; const c2 = m.ctx.storage.sql.exec('select'); await turn(); [...c2];
    assert.equal(m.rows.r, 1, 'iterated after the turn: only the first step was read by then');
    assert.equal(step, 4);
  });
  it('setAlarm and deleteAlarm are one row written each; getAlarm and everything else pass through on the real object', async () => {
    const sql = sqliteStorage(), ctx = makeCtx(sql), m = new Meter(ctx, {}); m.isDay = 1; await turn();
    const w0 = m.rows.w;
    await m.ctx.storage.setAlarm(123); await m.ctx.storage.getAlarm(); await m.ctx.storage.deleteAlarm(); await m.ctx.storage.setAlarm(456);
    assert.equal(m.rows.w - w0, 3); assert.equal(ctx.alarm, 456);
    assert.equal(m.ctx.storage.transactionSync(() => 7), 7);
    assert.equal(m.ctx.storage.sql.db, sql.db, 'non-exec members of sql pass through');
    ctx.storage.getAlarm = async () => 99; assert.equal(await m.ctx.storage.getAlarm(), 99, 'a member replaced later is seen');
  });
  it('the wrapper is in both DO constructors and covers every exec site (no raw ctx.storage left in a DO)', () => {
    const src = read('worker.js');
    assert.match(src, /this\.rows = rowsBox\(\); this\.ctx = rowsCtx\(ctx, this\.rows\); this\.rows\.on = \(\) => this\.rowsDue\(\)/);
    assert.match(src, /this\.rows = rowsBox\(\); this\.ctx = rowsCtx\(ctx, this\.rows\); this\.pdW = null/);
    assert.doesNotMatch(src, /[^.]ctx\.storage\.sql/, 'only this.ctx.storage reaches SQL');
  });
});

describe('2. the day row and the level', () => {
  const freshDay = (env = {}) => { const sql = sqliteStorage(); return { sql, m: new Meter(makeCtx(sql), env) }; };
  it('add keeps rows written / read and Worker requests (with WREQ_PAD) in one row; GB-s moved to the same row (one row written per add)', async () => {
    const { sql, m } = freshDay();
    m.add(3, 2.5, { w: 100, r: 1000, q: 200 }); await turn();
    const from = sql.log.length; const r = m.add(1, 0.5, { w: 10, r: 0, q: 0 });
    assert.deepEqual([r.n, r.g, r.w > 110, r.r >= 1000, Math.round(r.q)], [6, 3, true, true, 210]);
    assert.equal(billed(sql.log.slice(from)).w, 1, 'one upsert');
    const row = sql.db.prepare('select * from d').get(); assert.deepEqual(Object.keys(row).sort(), ['day', 'n', 'q', 'r', 's', 'w']);
    // a g row written before the s column existed still counts that day
    sql.db.prepare('insert into g values(?, ?)').run(row.day, 7); assert.equal(m.add(0).g, 10);
    assert.equal(m.add(0, 0, { w: -5, r: NaN, q: 'x' }).w, r.w + 2, 'junk counts as 0 (the +2 is the adds\' own rows)');
  });
  it('the level reacts to each budget alone: 80% lean, 95% hard (Free numbers)', () => {
    const cases = [[{ w: 80000 }, 1], [{ w: 95000 }, 2], [{ r: 4.0e6 }, 1], [{ r: 4.75e6 }, 2], [{ q: 76200 }, 1], [{ q: 90477 }, 2], [{ w: 79000, r: 3.9e6, q: 76000 }, 0]];
    for (const [x, lvl] of cases) { const { m } = freshDay(); assert.equal(m.add(0, 0, x).lvl, lvl, JSON.stringify(x)); }
    const { m } = freshDay(); assert.equal(m.add(79000).lvl, 0); assert.equal(m.add(1000).lvl, 1, 'DO requests as before');
    const g = freshDay().m; assert.equal(g.add(0, 12400).lvl, 2, 'GB-s as before');
  });
  it('PLAN=paid uses the paid caps; BUDGET_ROWS_DAY / BUDGET_READS_DAY / BUDGET_WREQ_DAY override either plan; junk overrides are ignored', () => {
    const lv = (env, x) => freshDay(env).m.add(0, 0, x).lvl;
    assert.equal(lv({ PLAN: 'paid' }, { w: 1.5e6 }), 0); assert.equal(lv({ PLAN: 'paid' }, { w: 1.6e6 }), 1); assert.equal(lv({ PLAN: 'paid' }, { w: 1.9e6 }), 2);
    assert.equal(lv({ PLAN: 'paid' }, { q: 1.2e6 / 1.05 }), 1); assert.equal(lv({ PLAN: 'paid' }, { r: 9.5e8 }), 2);
    assert.equal(lv({ BUDGET_ROWS_DAY: '1000' }, { w: 960 }), 2); assert.equal(lv({ PLAN: 'paid', BUDGET_ROWS_DAY: '5000000' }, { w: 3e6 }), 0);
    assert.equal(lv({ BUDGET_WREQ_DAY: '1000' }, { q: 800 }), 1, '800 * 1.05 = 840 of 1000');
    assert.equal(lv({ BUDGET_READS_DAY: '1000' }, { r: 999 }), 2);
    assert.equal(lv({ BUDGET_ROWS_DAY: 'lots' }, { w: 95000 }), 2, 'not a number: the plan default'); assert.equal(lv({ BUDGET_ROWS_DAY: '-1' }, { w: 95000 }), 2);
  });
  it('the day key is the UTC date (Cloudflare resets the free limits at 00:00 UTC = 09:00 KST), not the KST date', () => {
    const RealDate = Date; let at = Date.parse('2026-11-22T23:59:59Z'); // 08:59:59 on 11-23 in Korea
    globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [at])); } static now() { return at; } };
    try {
      const { sql, m } = freshDay();
      assert.equal(m.add(0, 0, { w: 96000 }).lvl, 2);
      assert.deepEqual(sql.db.prepare('select day from d').all().map((x) => x.day), ['2026-11-22']);
      at = Date.parse('2026-11-23T00:00:00Z');
      assert.equal(m.add(0, 0, { w: 10 }).lvl, 0, 'a new UTC day starts from zero');
      assert.deepEqual(sql.db.prepare('select day from d order by day').all().map((x) => x.day), ['2026-11-22', '2026-11-23']);
    } finally { globalThis.Date = RealDate; }
  });
});

describe('3. a room keeps what it counted', () => {
  it('through hibernation: the counts ride on a socket and the woken room reports them once', async () => {
    const c = clock();
    try {
      const sql = sqliteStorage(), ctx = makeCtx(sql), { env, adds } = roomEnv(), r1 = new Room(ctx, env);
      const ws = join(r1, ctx, 'guest:h1'); join(r1, ctx, 'guest:h2'); r1.tapDb(); r1.meter(true); await turn(); const n0 = adds.length;
      c.add(5000);
      for (let i = 0; i < 45; i++) await r1.webSocketMessage(ws, JSON.stringify({ t: 'p', a: [1500 + i, 1500, '0', 'walk', 0, 0, 0] }));
      c.add(2100); await r1.webSocketMessage(ws, JSON.stringify({ t: 'MINE', amount: 1, nick: 'n' })); await turn(); await turn();
      assert.equal(adds.length, n0, 'nothing reported inside REP');
      const held = { msgs: r1.msgs, conns: r1.conns, w: r1.rows.w, r: r1.rows.r }; assert.ok(held.w > 0 && held.msgs === 46);
      // r1 is evicted from memory here. A new instance on the same ctx (sockets and attachments kept) gets the next message.
      const r2 = new Room(ctx, env); c.add(3000);
      await r2.webSocketMessage(ws, JSON.stringify({ t: 'p', a: [1600, 1500, '0', 'idle', 0, 0, 0] })); await turn();
      const rep = adds.at(-1); assert.equal(adds.length, n0 + 1, 'the woken room reports at its first event, as before');
      // the copy is exact when written; messages and reads only rewrite it per 20 / 50, so at most that much of the tail is missing
      const msgs = (rep.n - held.conns) * 20 - 1; assert.ok(msgs <= held.msgs && msgs > held.msgs - 20, `messages carried: ${msgs} of ${held.msgs}`);
      assert.equal(rep.x.w, held.w, 'rows written carried'); assert.ok(rep.x.r <= held.r && rep.x.r > held.r - 50, 'rows read carried');
      assert.equal(ws.att.pd, undefined, 'after the report the copy is cleared');
      const r3 = new Room(ctx, env); c.add(61000);
      await r3.webSocketMessage(ws, JSON.stringify({ t: 'p', a: [1700, 1500, '0', 'idle', 0, 0, 0] })); await turn();
      assert.ok(adds.at(-1).n < 1 && adds.at(-1).x.w <= 1, 'a second wake carries nothing twice');
    } finally { c.done(); }
  });
  it('the copy is rewritten only when the numbers change: every 20th position message, not every one', async () => {
    const c = clock();
    try {
      const sql = sqliteStorage(), ctx = makeCtx(sql), { env } = roomEnv(), room = new Room(ctx, env);
      const ws = join(room, ctx, 'guest:k1'), other = join(room, ctx, 'guest:k2'); room.tapDb(); room.meter(true); await turn(); c.add(1000);
      const carrier = room.pdW, from = carrier === ws ? other : ws, s0 = carrier.saves;
      for (let i = 0; i < 100; i++) await room.webSocketMessage(from, JSON.stringify({ t: 'p', a: [1500, 1500 + i, '0', 'walk', 0, 0, 0] }));
      assert.ok(carrier.saves - s0 <= 5 + 1, `${carrier.saves - s0} saves for 100 messages`);
      assert.equal(carrier.att.pd[0], 100, 'the copy holds the exact count');
    } finally { c.done(); }
  });
  it('a closing carrier hands the copy to another socket; the last close reports at once, and an empty room with nothing new does not call', async () => {
    const c = clock();
    try {
      const sql = sqliteStorage(), ctx = makeCtx(sql), { env, adds } = roomEnv(), room = new Room(ctx, env);
      const a = join(room, ctx, 'guest:c1'), b = join(room, ctx, 'guest:c2'); room.tapDb(); room.meter(true); await turn(); c.add(3000);
      await room.webSocketMessage(a, JSON.stringify({ t: 'MINE', amount: 1, nick: 'n' })); await turn(); await turn();
      const n0 = adds.length, carrier = room.pdW, rest = carrier === a ? b : a;
      carrier.closed = true; await room.webSocketClose(carrier, 1000);
      assert.equal(adds.length, n0, 'one socket left: no report'); assert.equal(room.pdW, rest); assert.ok(rest.att.pd?.[2] > 0, 'the rows moved');
      rest.closed = true; await room.webSocketClose(rest, 1000); await turn();
      assert.equal(adds.length, n0 + 1, 'the last close reports'); assert.ok(adds.at(-1).x.w > 0);
      const again = new Room(ctx, env); again.socks(); again.gone({}); assert.equal(adds.length, n0 + 1);
    } finally { c.done(); }
  });
  it('an alarm whose scan closes the last socket reports once, not twice', async () => {
    const c = clock();
    try {
      const sql = sqliteStorage(), ctx = makeCtx(sql), { env, adds } = roomEnv(), room = new Room(ctx, env);
      const ws = join(room, ctx, 'guest:s1'); room.tapDb(); room.meter(true); await turn(); c.add(80000); // past STALE
      ctx.getWebSocketAutoResponseTimestamp = () => new Date(0); const n0 = adds.length;
      await room.alarm(); await turn();
      assert.ok(ws.closed || room.socks().size === 0);
      assert.equal(adds.length, n0 + 1);
    } finally { c.done(); }
  });
  it('an empty room hands its counts back on the response (x-pend), and a room that receives one adds it to its own', async () => {
    const c = clock();
    try {
      const shard = new Room(makeCtx(sqliteStorage()), roomEnv().env);
      const res = await shard.fetch(new Request('https://room.internal/chr', { method: 'POST', body: JSON.stringify({ op: 'add', slot: 'STREET_3' }) }));
      const v = String(res.headers.get('x-pend')).split(',').map(Number); assert.equal(v.length, 3); assert.ok(v[1] >= 1, 'the cheer row it wrote');
      assert.equal(shard.rows.w, 0, 'handed over, not kept');
      const res2 = await shard.fetch(new Request('https://room.internal/air', { method: 'POST', body: '{}' })); assert.equal(res2.headers.get('x-pend'), null, 'nothing new: no header');
      // the cheering room (with a socket) sends copies to square-2..8; each empty shard's x-pend joins its counts
      const sql = sqliteStorage(), ctx = makeCtx(sql), { env } = roomEnv(), room = new Room(ctx, env);
      env.ROOM.get = () => ({ fetch: async () => new Response('{"ok":true,"n":1}', { headers: { 'x-pend': '0,2,3' } }) });
      join(room, ctx, 'guest:x1'); room.topicName = 'chapel:square'; room.tapDb(); await turn(); room.rows.w = 0; room.rows.r = 0;
      room.shareCheer('STREET_3', 1); await turn(); await turn();
      assert.ok(room.rows.w >= 7 * 2 && room.rows.r >= 7 * 3);
    } finally { c.done(); }
  });
  it('a WebSocket upgrade is not given an x-pend header (the room reports it through meter)', () => {
    const src = read('worker.js');
    assert.match(src, /async fetch\(req\) \{ const res = await this\.route\(req\); if \(res && res\.status !== 101 && !upgrade\(req\)\)/);
  });
});

// Real DOs behind a stub that copies arguments like the runtime, as in guard.test.mjs.
const stub = (obj) => new Proxy(obj, { get: (t, k) => k === 'fetch' ? (req) => t.fetch(req) : typeof t[k] === 'function' ? async (...a) => structuredClone(await t[k](...structuredClone(a))) : t[k] });
function makeEnv(extra = {}) {
  const meters = new Map(), rooms = new Map(), calls = [];
  const env = { GUEST_KEY: 'guest-test-key', ADMIN_KEY: 'admin-test-key-123', ASSETS: { fetch: () => new Response('asset') }, ...extra };
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new Meter(makeCtx(sql), env) }); } return meters.get(name); };
  env.room = (topic) => { if (!rooms.has(topic)) { const sql = sqliteStorage(); rooms.set(topic, { sql, do: new Room(makeCtx(sql), env) }); } return rooms.get(topic); };
  env.METER = { idFromName: (n) => n, get: (n) => { const s = stub(env.meter(n).do); return new Proxy(s, { get: (t, k) => typeof t[k] === 'function' ? (...a) => { calls.push(n + '.' + String(k)); return t[k](...a); } : t[k] }); } };
  env.ROOM = { idFromName: (t) => t, get: (t) => stub(env.room(t).do) };
  return { env, calls, dayAdds: () => calls.filter((x) => x === 'day.add').length };
}
const dayRow = (env) => env.meter('day').sql.db.prepare('select * from d').get() || { n: 0, w: 0, r: 0, q: 0 };

describe('4. Meter instances and the Worker', () => {
  it('another instance sends its rows to day in one add per REP once ROWS_MIN are waiting, at hard only after ROWS_IDLE', async () => {
    const c = clock();
    try {
      const { env, dayAdds } = makeEnv(), acct = env.meter('acct').do, day = () => dayRow(env);
      for (let i = 0; i < 30; i++) { acct.visit('guest:v' + i, '2027-06-01'); await turn(); }
      assert.equal(dayAdds(), 0, 'inside REP: no call, however many rows');
      c.add(61000); acct.visit('guest:v99', '2027-06-01'); await turn(); await turn();
      assert.equal(dayAdds(), 1, 'one batch'); const w1 = day().w; assert.ok(w1 >= 31, `rows ${w1}`);
      c.add(30000); for (let i = 0; i < 30; i++) { acct.visit('guest:w' + i, '2027-06-01'); await turn(); } await turn();
      assert.equal(dayAdds(), 1, 'the next batch waits for REP');
      env.meter('day').sql.db.prepare('update d set w = 99000').run(); c.add(31000); acct.visit('guest:z1', '2027-06-01'); await turn(); await turn();
      assert.equal(dayAdds(), 2); assert.equal(acct.rowsLvl, 2, 'the batch answer brings the level');
      c.add(61000); for (let i = 0; i < 30; i++) { acct.visit('guest:y' + i, '2027-06-01'); await turn(); } await turn();
      assert.equal(dayAdds(), 2, 'at hard: no batch after REP');
      c.add(600000); acct.visit('guest:y99', '2027-06-01'); await turn(); await turn(); assert.equal(dayAdds(), 3, 'after ROWS_IDLE');
      const few = env.meter('grp').do; few.grpAdd('ABCDEF', 'guest:g1', '2027-06-01', '2027W22'); await turn(); c.add(61000); few.grpAdd('ABCDEF', 'guest:g2', '2027-06-01', '2027W22'); await turn(); await turn();
      assert.equal(dayAdds(), 3, 'under ROWS_MIN: waits'); c.add(600000); few.grpTop('2027W22'); await turn(); await turn(); assert.equal(dayAdds(), 4, 'sent after ROWS_IDLE');
    } finally { c.done(); }
  });
  it('every Worker invocation counts; requests alone go out with WREQ_MIN (not at hard) or after WREQ_IDLE; /rt/gate shows rows, reads and wreq', async () => {
    const c = clock();
    try {
      const { env, dayAdds } = makeEnv(), ctx = { w: [], waitUntil(p) { this.w.push(Promise.resolve(p)); } };
      const call = async (path, opt) => { const r = await worker.fetch(new Request('https://sq.example' + path, opt), env, ctx); while (ctx.w.length) await Promise.all(ctx.w.splice(0)); return r; };
      const g0 = await (await call('/rt/gate')).json(); // drains what earlier tests in this process left in the isolate
      for (const k of ['ok', 'cap', 'used', 'gbs', 'lean', 'rows', 'reads', 'wreq']) assert.ok(k in g0, k);
      const a0 = dayAdds(), q0 = dayRow(env).q;
      c.add(30000); for (let i = 0; i < 200; i++) await call('/rt/push/key');
      assert.equal(dayAdds(), a0, '200 requests with no DO call: no add');
      for (let i = 0; i < 60; i++) await call('/rt/push/key');
      assert.equal(dayAdds(), a0 + 1, 'the 250th request sends them');
      assert.equal(Math.round(dayRow(env).q - q0), Math.round(250 * 1.05));
      c.add(16000); const g = await (await call('/rt/gate')).json();
      assert.equal(g.wreq, Math.round(dayRow(env).q)); assert.equal(g.rows, Math.round(dayRow(env).w)); assert.equal(typeof g.reads, 'number');
      worker.scheduled({ cron: '5 * * * *' }, env, ctx); c.add(16000); assert.ok((await (await call('/rt/gate')).json()).wreq >= g.wreq + 2 * 1.05 - 1, 'the cron run and the gate read count');
      // at hard (here: the Worker request budget), requests alone wait for WREQ_IDLE
      env.BUDGET_WREQ_DAY = String(Math.ceil(dayRow(env).q)); c.add(16000); const full = await (await call('/rt/gate')).json();
      assert.equal(full.full, true); for (const k of ['used', 'gbs', 'rows', 'reads', 'wreq']) assert.ok(k in full, k);
      const a1 = dayAdds(); c.add(30000); for (let i = 0; i < 300; i++) await call('/rt/push/key');
      assert.equal(dayAdds(), a1, 'at hard no add for requests alone');
      c.add(600000); await call('/rt/push/key'); assert.equal(dayAdds(), a1 + 1, 'after WREQ_IDLE');
      const s = await (await call('/rt/admin/stats', { headers: { 'x-admin-key': 'admin-test-key-123' } })).json();
      assert.equal(typeof s.tally.wreq, 'number'); assert.equal(typeof s.tally.rows, 'number'); assert.equal(typeof s.tally.pending, 'number');
    } finally { c.done(); }
  });
  it('the x-pend of a room fetch the Worker makes joins the isolate tally', async () => {
    const c = clock();
    try {
      const { env } = makeEnv(), ctx = { w: [], waitUntil(p) { this.w.push(Promise.resolve(p)); } };
      const call = async (path, opt) => { const r = await worker.fetch(new Request('https://sq.example' + path, opt), env, ctx); while (ctx.w.length) await Promise.all(ctx.w.splice(0)); return r; };
      await call('/rt/gate'); const tok = (await (await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).token;
      env.ROOM.get = () => ({ fetch: async () => new Response('no', { status: 503, headers: { 'x-pend': '1,40,9' } }) });
      c.add(16000); const before = (await (await call('/rt/gate')).json()).rows;
      await call('/rt/ws?topic=chapel:square', { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'masil2, at.' + tok } });
      c.add(26000); await call('/rt/push/key'); c.add(16000);
      const got = (await (await call('/rt/gate')).json()).rows - before;
      assert.ok(got >= 40 && got <= 43, `${got}: the 40 handed back, plus the day instance's own row per add`);
    } finally { c.done(); }
  });
});

describe('5. no DO call on a hot path', () => {
  it('a busy room: hundreds of messages and grants inside REP make one report (the first after the room woke)', async () => {
    const c = clock();
    try {
      const sql = sqliteStorage(), ctx = makeCtx(sql), { env, adds } = roomEnv(), room = new Room(ctx, env);
      const ws = join(room, ctx, 'guest:b1'), ws2 = join(room, ctx, 'guest:b2'); room.tapDb();
      for (let i = 0; i < 300; i++) { c.add(150); await room.webSocketMessage(i % 2 ? ws : ws2, JSON.stringify(i % 15 ? { t: 'p', a: [1500 + i, 1500, '0', 'walk', 0, 0, 0] } : { t: 'MINE', amount: 1, nick: 'n' })); }
      await turn();
      assert.equal(adds.length, 1, '45 s of traffic: the wake report only');
      assert.ok(room.rows.w > 0, 'rows wait for the next report');
    } finally { c.done(); }
  });
  it('the counting itself is synchronous bookkeeping: rowsCtx, keep and the tally make no stub call', () => {
    const src = read('worker.js'), body = (name) => { const a = src.indexOf(name); return src.slice(a, src.indexOf('\n', a)); };
    for (const f of ['function rowsCtx', 'function rowsFold', 'const wreqOne', '  keep() {', '  pdBack(list)', '  handBack(res)', '  pendIn(res)']) assert.doesNotMatch(body(f), /METER|ROOM|\.add\(|fetch\(/, f);
  });
});
