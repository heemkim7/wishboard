// Shared by test/reinforce-*.test.mjs: the real Worker, Meter and Room on in-memory SQLite (the harness of metrics.test.mjs / league.test.mjs).
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: new URL('./cf-stub.mjs', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});
globalThis.WebSocketRequestResponsePair ||= class { constructor(req, res) { this.req = req; this.res = res; } };

export const W = await import('../worker.js');
export const worker = W.default;
export const KEY = 'admin-test-key-123', DAY = 86400000;

export function sqliteStorage(db = new DatabaseSync(':memory:')) {
  return {
    db,
    exec(query, ...args) {
      const q = String(query).trim();
      if (!args.length && /^create\b/i.test(q)) { db.exec(q); return { rowsWritten: 0, toArray() { return []; }, one() { return {}; }, [Symbol.iterator]() { return [][Symbol.iterator](); } }; }
      const stmt = db.prepare(q);
      if (/^select\b/i.test(q)) { const rows = stmt.all(...args); return { rowsWritten: 0, toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error('expected one row for ' + q); return rows[0]; }, [Symbol.iterator]: () => rows[Symbol.iterator]() }; }
      const info = stmt.run(...args);
      return { rowsWritten: info.changes, toArray: () => [], one() { throw new Error('one on write'); }, [Symbol.iterator]() { return [][Symbol.iterator](); } };
    },
  };
}
export function makeCtx(sql, name = '') {
  return {
    id: { name },
    storage: { sql, async getAlarm() { return null; }, async setAlarm() {}, async deleteAlarm() {}, transactionSync(fn) { sql.db.exec('BEGIN'); try { const out = fn(); sql.db.exec('COMMIT'); return out; } catch (e) { sql.db.exec('ROLLBACK'); throw e; } } },
    setWebSocketAutoResponse() {}, getWebSockets() { return []; }, getWebSocketAutoResponseTimestamp() { return new Date(); }, acceptWebSocket() {},
  };
}
const stub = (obj) => new Proxy(obj, { get: (t, k) => k === 'fetch' ? (req) => t.fetch(req) : typeof t[k] === 'function' ? async (...a) => structuredClone(await t[k](...structuredClone(a))) : t[k] });
// calls: every DO method called through the env, as 'instance.method'.
export function makeEnv(extra = {}) {
  const meters = new Map(), rooms = new Map(), calls = [];
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ADMIN_KEY: KEY, ASSETS: { fetch: () => new Response('asset', { status: 200 }) }, ...extra };
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(); meters.set(name, { sql, do: new W.Meter(makeCtx(sql, name), env) }); } return meters.get(name); };
  env.room = (topic) => { if (!rooms.has(topic)) { const sql = sqliteStorage(); rooms.set(topic, { sql, do: new W.Room(makeCtx(sql, topic), env) }); } return rooms.get(topic); };
  const spy = (name, o) => new Proxy(o, { get: (t, k) => { const v = t[k]; if (typeof v === 'function' && typeof k === 'string') return (...a) => { calls.push(name + '.' + k); return v(...a); }; return v; } });
  env.METER = { idFromName: (name) => name, get: (name) => spy(name, stub(env.meter(name).do)) };
  env.ROOM = { idFromName: (topic) => topic, get: (topic) => spy(topic, stub(env.room(topic).do)) };
  env.calls = calls;
  return env;
}
export function harness(env) {
  const waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const settle = async () => { while (waits.length) await Promise.all(waits.splice(0)); };
  const call = async (path, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + path, opt), env, ctx); await settle(); return res; };
  const post = (body, token) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const guest = async () => (await call('/rt/guest', post({}))).json();
  const ev = (name, sid, who, p) => call('/rt/event', post({ name, sid, p }, who?.token));
  const stats = async (q = '') => (await call('/rt/admin/stats' + q, { headers: { 'x-admin-key': KEY } })).json();
  return { call, post, guest, ev, stats, ctx, waits, settle };
}
export function withClock(start, fn) {
  const orig = Date.now; let t = start; Date.now = () => t;
  return Promise.resolve(fn({ add: (ms) => { t += ms; }, set: (v) => { t = v; }, now: () => t })).finally(() => { Date.now = orig; });
}
