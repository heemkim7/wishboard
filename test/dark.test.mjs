import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: new URL('./cf-stub.mjs', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});
globalThis.WebSocketRequestResponsePair = class { constructor(req, res) { this.req = req; this.res = res; } };

const { Meter } = await import('../worker.js');
const worker = (await import('../worker.js')).default;
const { Room } = await import('../worker.js');
const { DARK, quietShift, darkNext, darkText } = await import('../dark.js');
const { slotName } = await import('../balance.js');
const { applyInboxPush } = await import('../inbox.js');

// Same harness as share-push.test.mjs, plus a DO alarm the test can read (ctx.alarm) and fire (do.alarm()).
function sqliteStorage(db = new DatabaseSync(':memory:')) {
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
function makeCtx(sql) {
  const c = {
    alarm: null, alarms: 0,
    storage: { sql, async getAlarm() { return c.alarm; }, async setAlarm(t) { c.alarm = Number(t); c.alarms++; }, async deleteAlarm() { c.alarm = null; },
      transactionSync(fn) { sql.db.exec('BEGIN'); try { const out = fn(); sql.db.exec('COMMIT'); return out; } catch (e) { sql.db.exec('ROLLBACK'); throw e; } } },
    setWebSocketAutoResponse() {}, getWebSockets() { return []; }, getWebSocketAutoResponseTimestamp() { return new Date(); }, acceptWebSocket() {},
  };
  return c;
}
const stub = (obj) => new Proxy(obj, { get: (t, k) => k === 'fetch' ? (req) => t.fetch(req) : typeof t[k] === 'function' ? async (...a) => structuredClone(await t[k](...structuredClone(a))) : t[k] });
function makeEnv(extra = {}) {
  const meters = new Map(), rooms = new Map();
  const env = { GUEST_KEY: 'guest-test-key', FLUSH_KEY: 'flush-test-key', ADMIN_KEY: 'admin-test-key-123', ASSETS: { fetch: () => new Response('asset', { status: 200 }) }, ...extra };
  env.meter = (name) => { if (!meters.has(name)) { const sql = sqliteStorage(), ctx = makeCtx(sql); meters.set(name, { sql, ctx, do: new Meter(ctx, env) }); } return meters.get(name); };
  env.room = (topic) => { if (!rooms.has(topic)) { const sql = sqliteStorage(), ctx = makeCtx(sql); rooms.set(topic, { sql, ctx, do: new Room(ctx, env) }); } return rooms.get(topic); };
  env.METER = { idFromName: (name) => name, get: (name) => stub(env.meter(name).do) };
  env.ROOM = { idFromName: (topic) => topic, get: (topic) => stub(env.room(topic).do) };
  return env;
}
function spyMeter(env, name) {
  const calls = {}, real = env.METER.get;
  env.METER.get = (n) => { const m = real(n); if (n !== name) return m; return new Proxy(m, { get: (t, k) => typeof t[k] === 'function' ? (...a) => { calls[k] = (calls[k] || 0) + 1; return t[k](...a); } : t[k] }); };
  return calls;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const PUSH_HOST = 'https://fcm.googleapis.com/';
const iso = (t) => new Date(t).toISOString();
// Fake Supabase + push service. state.boards is what Supabase holds (the alarm re-reads it); claims and relights keep it in step like the RPCs do.
function fakeNet(state) {
  const put = (b) => { state.boards = (state.boards || []).filter((x) => x.slot_id !== b.slot_id).concat([b]); return b; };
  return async (url, opt = {}) => {
    const u = String(url); state.calls.push({ url: u, body: opt.body });
    if (u.startsWith(PUSH_HOST)) { state.pushes.push({ url: u, headers: opt.headers, body: opt.body }); return new Response('', { status: 201 }); }
    if (u.includes('/.well-known/jwks.json')) return json({ keys: state.jwks || [] });
    if (u.includes('/rest/v1/billboards')) { if (state.boardsDown) return json({ message: 'down' }, 503); const m = /slot_id=eq\.(\w+)/.exec(u); return json((state.boards || []).filter((x) => !m || x.slot_id === m[1])); }
    if (u.includes('/rest/v1/plots')) return json([]);
    if (u.includes('/rest/v1/wallets')) return json([]);
    if (u.includes('/rpc/plaza_live')) return json({});
    if (u.includes('/rpc/push_subscribe') || u.includes('/rpc/push_unsubscribe') || u.includes('/rpc/push_drop')) return json({ ok: true });
    if (u.includes('/rpc/inbox_batch')) { state.inbox.push(...JSON.parse(opt.body).p_items); return json({ ok: true }); }
    if (u.includes('/rpc/coin_batch')) return json({ ok: true, flushed: 0 });
    if (u.includes('/rpc/merge_guest_account')) return json({ ok: true, coins: 1, bonus: 0 });
    if (u.includes('/rpc/withdraw_account')) return json({ ok: true });
    if (u.includes('/rpc/claim_billboard')) { const a = JSON.parse(opt.body), prev = (state.boards || []).find((x) => x.slot_id === a.p_slot_id);
      const lit = a.p_mode === 'edit' && prev ? prev.lit_until : iso(Date.now() + 72 * 3600e3), holder = a.p_mode === 'tribe' ? 'tribe:abcd1234' : a.p_actor_id;
      return json({ ok: true, billboard: put({ slot_id: a.p_slot_id, holder_id: holder, holder_name: a.p_nickname, line1: a.p_line1, lit_until: lit, expires_at: lit }), remaining_coins: 10, prev_holder_id: prev?.holder_id || null }); }
    if (u.includes('/rpc/relight_billboard')) { const a = JSON.parse(opt.body), b = (state.boards || []).find((x) => x.slot_id === a.p_slot_id);
      if (!b || b.holder_id !== a.p_actor_id) return json({ ok: false, error: 'holder' }); b.lit_until = b.expires_at = iso(Date.now() + 72 * 3600e3); return json({ ok: true, lit_until: b.lit_until, lit_days: 2 }); }
    if (u.includes('/rpc/review_slot_claim')) { const a = JSON.parse(opt.body), r = state.review; const lit = iso(Date.now() + 72 * 3600e3), prev = (state.boards || []).find((x) => x.slot_id === r.slot);
      return json({ ok: true, actor_id: r.actor, prev_holder_id: prev?.holder_id || null, billboard: a.p_approve ? put({ slot_id: r.slot, holder_id: r.actor, holder_name: '승인', lit_until: lit, expires_at: lit }) : null }); }
    if (u.includes('/rpc/takedown_billboard')) { const a = JSON.parse(opt.body); return json({ ok: true, billboard: (state.boards || []).find((x) => x.slot_id === a.p_slot_id) || null }); }
    return new Response('missing', { status: 404 });
  };
}
function harness(env) {
  const waits = [], ctx = { waitUntil(p) { waits.push(Promise.resolve(p)); } };
  const call = async (path, opt = {}) => { const res = await worker.fetch(new Request('https://sq.example' + path, opt), env, ctx); while (waits.length) await Promise.all(waits.splice(0)); return res; };
  const guest = async () => { const t = (await (await call('/rt/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).token; return { token: t, id: 'guest:' + JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).s }; };
  const post = (path, body, token, head = {}) => call(path, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1', ...(token ? { authorization: 'Bearer ' + token } : {}), ...head }, body: JSON.stringify(body) });
  const get = (path, token) => call(path, { headers: token ? { authorization: 'Bearer ' + token } : {} });
  const admin = (path, body) => post(path, body, '', { 'x-admin-key': 'admin-test-key-123' });
  return { call, guest, post, get, admin };
}
// The clock starts at a KST wall time; each test gets its own day.
let dayN = 0;
function setup(kst = '17:00') { const t0 = Date.parse(`2027-05-${String(1 + (dayN++ % 20)).padStart(2, '0')}T${kst}:00+09:00`) + Math.floor(dayN / 20) * 30 * 864e5;
  let t = t0; const orig = Date.now, fetch0 = globalThis.fetch; Date.now = () => t;
  const state = { calls: [], pushes: [], inbox: [] }; globalThis.fetch = fakeNet(state); globalThis.caches = { default: { async match() {}, async put() {}, async delete() { return true; } } };
  return { state, clock: { add: (ms) => { t += ms; }, to: (ms) => { t = ms; }, now: () => t }, done: () => { Date.now = orig; globalThis.fetch = fetch0; } };
}
const CLAIM = (slot = 'STREET_5', mode) => ({ topic: 'chapel:square', slot_id: slot, bid: 300, line1: '내 자리', nickname: '주인', ...(mode ? { mode } : {}) });
const rows = (env) => env.meter('dark').sql.db.prepare('select slot, uid, lit, pre, out from dk order by slot').all().map((r) => ({ ...r }));
const alarmOf = (env) => env.meter('dark').ctx.alarm;
const fire = (env) => env.meter('dark').do.alarm();
const H = 3600e3;

// RFC 8291 receiver side, as in share-push.test.mjs.
const te = new TextEncoder(), b64 = (u8) => Buffer.from(u8).toString('base64url');
const cat = (...p) => { const o = new Uint8Array(p.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
async function hkdf(salt, ikm, info, len) { const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8)); }
async function subscriber() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)), auth = crypto.getRandomValues(new Uint8Array(16));
  return { priv: pair.privateKey, pub, auth, endpoint: PUSH_HOST + 'fcm/send/' + crypto.randomUUID(), sub() { return { endpoint: this.endpoint, keys: { p256dh: b64(this.pub), auth: b64(this.auth) } }; } };
}
async function decrypt(body, s) {
  const b = new Uint8Array(body), salt = b.slice(0, 16), idlen = b[20], asPub = b.slice(21, 21 + idlen), ct = b.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, s.priv, 256));
  const ikm = await hkdf(s.auth, shared, cat(te.encode('WebPush: info\0'), s.pub, asPub), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
  let end = pt.length - 1; while (end >= 0 && pt[end] === 0) end--; return JSON.parse(new TextDecoder().decode(pt.slice(0, end)));
}
const VAPID = JSON.stringify(await crypto.subtle.exportKey('jwk', (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])).privateKey));
async function userToken(state, clock, sub) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  state.jwks = [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'dark-kid' }];
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), head = enc({ alg: 'ES256', kid: 'dark-kid' });
  const claims = enc({ sub, exp: Math.floor(clock.now() / 1000) + 600, iss: 'https://yxddhpacuyaffaoutxjn.supabase.co/auth/v1', aud: 'authenticated' });
  return { token: head + '.' + claims + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(head + '.' + claims))).toString('base64url'), id: 'user:' + sub };
}

describe('dark.js', () => {
  it('quiet hours 23:00–08:00 KST move a time to the next 08:00 KST', () => {
    const k = (s) => Date.parse(`2027-05-10T${s}+09:00`);
    assert.equal(quietShift(k('12:00:00')), k('12:00:00'));
    assert.equal(quietShift(k('07:59:59')), k('08:00:00'));
    assert.equal(quietShift(k('08:00:00')), k('08:00:00'));
    assert.equal(quietShift(k('22:59:59')), k('22:59:59'));
    assert.equal(quietShift(k('23:00:00')), Date.parse('2027-05-11T08:00:00+09:00'));
    assert.equal(quietShift(k('02:30:00')), k('08:00:00'));
  });
  it('next notice: 6 hours before, then at dark; a 6-hour notice pushed past dark is skipped', () => {
    const lit = Date.parse('2027-05-10T17:00:00+09:00');
    assert.deepEqual(darkNext({ lit, pre: 0, out: 0 }), { at: lit - 6 * H, stage: 'pre' });
    assert.deepEqual(darkNext({ lit, pre: 1, out: 0 }), { at: lit, stage: 'out' });
    assert.equal(darkNext({ lit, pre: 1, out: 1 }), null);
    const early = Date.parse('2027-05-10T07:30:00+09:00'); // 6 h before is 01:30, moved to 08:00, after dark
    assert.deepEqual(darkNext({ lit: early, pre: 0, out: 0 }), { at: Date.parse('2027-05-10T08:00:00+09:00'), stage: 'out' });
    const close = Date.parse('2027-05-10T08:59:59+09:00'); // moved to 08:00, under an hour before dark: only the dark notice
    assert.deepEqual(darkNext({ lit: close, pre: 0, out: 0 }), { at: close, stage: 'out' });
  });
  it('copy', () => {
    assert.equal(darkText('pre', 'STREET_5'), `🕯️ ${slotName('STREET_5')} 불이 6시간 뒤에 꺼져요. 지금 켜면 72시간 더 켜져요.`);
    assert.equal(darkText('out', 'STREET_5'), `${slotName('STREET_5')} 불이 꺼졌어요. 다른 사람이 가져가기 전에 다시 켜세요.`);
    assert.equal(applyInboxPush({ kind: 'dark', slot_id: 'STREET_5', phrase: 1 }), `${slotName('STREET_5')} 불이 곧 꺼져요`);
    assert.equal(applyInboxPush({ kind: 'dark', slot_id: 'STREET_5', phrase: 2 }), `${slotName('STREET_5')} 불이 꺼졌어요`);
    assert.equal(applyInboxPush({ kind: 'dark', slot_id: 'STREET_5' }), `${slotName('STREET_5')} 불이 곧 꺼져요`);
  });
});

describe('dark registry', () => {
  it('claim, takeover, tribe claim, review approval, relight and takedown keep the registry and its alarm', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), { guest, post, admin } = harness(env), a = await guest(), b = await guest();
      assert.equal((await post('/rt/claim-billboard', CLAIM(), a.token)).status, 200);
      const lit1 = clock.now() + 72 * H;
      assert.deepEqual(rows(env), [{ slot: 'STREET_5', uid: a.id, lit: lit1, pre: 0, out: 0 }]);
      assert.equal(alarmOf(env), lit1 - 6 * H);
      clock.add(H); await post('/rt/claim-billboard', CLAIM('STREET_5', 'edit'), a.token); // same holder, same clock: unchanged
      assert.deepEqual(rows(env), [{ slot: 'STREET_5', uid: a.id, lit: lit1, pre: 0, out: 0 }]);
      clock.add(H); assert.equal((await post('/rt/claim-billboard', CLAIM(), b.token)).status, 200); // takeover
      const lit2 = clock.now() + 72 * H;
      assert.deepEqual(rows(env), [{ slot: 'STREET_5', uid: b.id, lit: lit2, pre: 0, out: 0 }]);
      assert.equal(alarmOf(env), lit2 - 6 * H);
      clock.add(H); await post('/rt/claim-billboard', CLAIM('STREET_6', 'starter'), a.token); // starter needs the room hello first; a refused claim changes nothing
      assert.deepEqual(rows(env).map((r) => r.slot), ['STREET_5']);
      await post('/rt/claim-billboard', CLAIM('STREET_6'), a.token);
      clock.add(H); await post('/rt/relight', { slot: 'STREET_5' }, b.token);
      const lit3 = clock.now() + 72 * H;
      assert.deepEqual(rows(env).find((r) => r.slot === 'STREET_5'), { slot: 'STREET_5', uid: b.id, lit: lit3, pre: 0, out: 0 });
      assert.equal(alarmOf(env), lit2 + H - 6 * H); // STREET_6 (claimed one hour after STREET_5's takeover) is now the earliest
      state.review = { slot: 'STREET_7', actor: a.id };
      assert.equal((await admin('/rt/admin/review', { id: 9, approve: true })).status, 200);
      assert.equal(rows(env).find((r) => r.slot === 'STREET_7').uid, a.id);
      await post('/rt/claim-billboard', CLAIM('STREET_7', 'tribe'), b.token); // a tribe now holds it: no personal row
      assert.equal(rows(env).some((r) => r.slot === 'STREET_7'), false);
      // Takedown blanks the lines only: holder and clock stay, and so do the rows and the alarm.
      const before = rows(env), at = alarmOf(env);
      assert.equal((await admin('/rt/admin/takedown', { slot: 'STREET_6' })).status, 200);
      assert.equal((await admin('/rt/admin/takedown', { slot: 'STREET_5' })).status, 200);
      assert.deepEqual(rows(env), before); assert.equal(alarmOf(env), at);
    } finally { done(); }
  });

  it('a takedown keeps the row with its flags, and a later /rt/world backfill changes nothing', async () => {
    const { state, clock, done } = setup('17:00');
    try {
      const env = makeEnv(), { guest, post, get, admin } = harness(env), a = await guest();
      await post('/rt/claim-billboard', CLAIM(), a.token); const lit = clock.now() + 72 * H;
      clock.to(lit - 6 * H); await fire(env); assert.equal(rows(env)[0].pre, 1);
      await admin('/rt/admin/takedown', { slot: 'STREET_5' });
      clock.add(2 * H); await get('/rt/world');
      assert.deepEqual(rows(env), [{ slot: 'STREET_5', uid: a.id, lit, pre: 1, out: 0 }]);
      clock.to(lit); await fire(env); assert.deepEqual(state.inbox.map((x) => x.phrase), [1, 2]);
    } finally { done(); }
  });

  // Holds the alarm's Supabase re-read until release(), so a claim can land while the alarm waits.
  function gateRead() { const inner = globalThis.fetch; let release = () => {}, gate = null;
    globalThis.fetch = async (u, o) => { const r = await inner(u, o); if (gate && String(u).includes('select=slot_id,holder_id,lit_until')) await gate; return r; };
    return { arm() { gate = new Promise((r) => { release = r; }); }, release() { release(); gate = null; } }; }
  const tick = () => new Promise((r) => setTimeout(r, 20));

  it('a takeover while the alarm waits on Supabase keeps the new holder row (dark notice due)', async () => {
    const { state, clock, done } = setup('17:00');
    try {
      const env = makeEnv(), { guest, post } = harness(env), a = await guest(), b = await guest();
      await post('/rt/claim-billboard', CLAIM(), a.token); const lit = clock.now() + 72 * H;
      clock.to(lit - 6 * H); await fire(env);
      const g = gateRead(); clock.to(lit + 1000); g.arm();
      const p = fire(env); await tick();
      await post('/rt/claim-billboard', CLAIM(), b.token);
      g.release(); await p;
      assert.deepEqual(rows(env).map((r) => [r.uid, r.pre]), [[b.id, 0]]); assert.equal(alarmOf(env), clock.now() + 72 * H - 6 * H);
      assert.deepEqual(state.inbox.filter((x) => x.kind === 'dark').map((x) => x.to), [a.id]); // only a's 6-hour notice; no dark notice to a for b's board
    } finally { done(); }
  });

  it('a takeover while the alarm waits on Supabase leaves the new holder its own 6-hour notice', async () => {
    const { state, clock, done } = setup('17:00');
    try {
      const env = makeEnv(), { guest, post } = harness(env), a = await guest(), b = await guest();
      await post('/rt/claim-billboard', CLAIM(), a.token); const lit = clock.now() + 72 * H;
      const g = gateRead(); clock.to(lit - 6 * H); g.arm();
      const p = fire(env); await tick();
      await post('/rt/claim-billboard', CLAIM(), b.token);
      g.release(); await p;
      assert.deepEqual(rows(env).map((r) => [r.uid, r.pre]), [[b.id, 0]]);
      assert.equal(state.inbox.filter((x) => x.kind === 'dark').length, 0);
    } finally { done(); }
  });

  it('20 rows due at once go out exactly once over several passes of at most 8, each within the subrequest limit', async () => {
    const { state, clock, done } = setup('11:00');
    try {
      const env = makeEnv({ VAPID_PRIV: VAPID }), { guest, post } = harness(env), slots = Array.from({ length: 20 }, (_, i) => 'STREET_' + (i + 1));
      for (const s of slots) { const g = await guest(); for (let k = 0; k < 3; k++) await post('/rt/push', { s: (await subscriber()).sub() }, g.token); await post('/rt/claim-billboard', CLAIM(s), g.token); }
      const lit = clock.now() + 72 * H; clock.to(lit - 3 * H); // dark 11:00 KST: all 20 six-hour notices moved to 08:00
      const calls = spyMeter(env, 'push'), passes = [];
      for (let i = 0; i < 6 && alarmOf(env) <= clock.now() + 1000; i++) { clock.to(Math.max(clock.now(), alarmOf(env))); const c0 = state.calls.length, d0 = state.inbox.length, p0 = calls.psDue || 0; await fire(env);
        passes.push({ rows: state.inbox.length - d0, fetches: state.calls.length - c0 + (calls.psDue || 0) - p0, inbox: state.calls.slice(c0).filter((x) => x.url.includes('inbox_batch')).length }); }
      assert.deepEqual(passes.map((p) => p.rows), [8, 8, 4]);
      for (const p of passes) { assert.ok(p.fetches + 1 <= 50, JSON.stringify(p)); assert.equal(p.inbox, 1); } // + the day meter call
      assert.deepEqual(state.inbox.map((x) => x.slot_id).sort(), slots.slice().sort());
      assert.equal(state.pushes.length, 60);
      assert.equal(alarmOf(env), lit);
    } finally { done(); }
  });

  it('a board dark just after 08:00 KST gets only its dark notice, not "1시간" a second before it', async () => {
    const { state, clock, done } = setup('08:00');
    try {
      const env = makeEnv(), { guest, post } = harness(env), a = await guest();
      clock.add(500); await post('/rt/claim-billboard', CLAIM(), a.token); const lit = clock.now() + 72 * H;
      assert.equal(alarmOf(env), lit);
      clock.to(lit); await fire(env); assert.deepEqual(state.inbox.map((x) => x.phrase), [2]);
      assert.deepEqual(darkNext({ lit: Date.parse('2027-05-10T09:00:00+09:00'), pre: 0, out: 0 }), { at: Date.parse('2027-05-10T08:00:00+09:00'), stage: 'pre' }); // a full hour left: still sent
    } finally { done(); }
  });

  it('claims during a hard-budget hold do not bring the held alarm forward', async () => {
    const { state, clock, done } = setup('17:00');
    try {
      const env = makeEnv({ BUDGET_REQ_DAY: '1000' }), { guest, post } = harness(env), a = await guest();
      await post('/rt/claim-billboard', CLAIM(), a.token); const lit = clock.now() + 72 * H;
      await env.meter('day').do.add(960); clock.to(lit - 6 * H); await fire(env);
      const held = clock.now() + DARK.retryMs; assert.equal(alarmOf(env), held);
      clock.add(60000); for (let i = 0; i < 5; i++) await post('/rt/claim-billboard', CLAIM('STREET_' + (10 + i)), a.token);
      assert.equal(alarmOf(env), held);
      env.BUDGET_REQ_DAY = '1000000'; clock.to(held); await fire(env);
      assert.deepEqual(state.inbox.map((x) => x.phrase), [1]); assert.equal(alarmOf(env), lit); // the hold is over: STREET_5's dark notice is next
    } finally { done(); }
  });

  it('each notice goes once: push { body, url } plus an inbox row, at 6 hours before and at dark', async () => {
    const { state, clock, done } = setup('17:00');
    try {
      const env = makeEnv({ VAPID_PRIV: VAPID }), { guest, post } = harness(env), a = await guest(), s = await subscriber();
      await post('/rt/push', { s: s.sub() }, a.token);
      await post('/rt/claim-billboard', CLAIM(), a.token); const lit = clock.now() + 72 * H;
      clock.to(lit - 6 * H - 1000); await fire(env); assert.equal(state.pushes.length, 0); // a stray early alarm sends nothing
      clock.to(lit - 6 * H); await fire(env);
      assert.equal(state.pushes.length, 1);
      assert.deepEqual(await decrypt(state.pushes[0].body, s), { body: darkText('pre', 'STREET_5', 6), url: '/?focus=STREET_5' });
      assert.deepEqual(state.inbox, [{ kind: 'dark', slot_id: 'STREET_5', to: a.id, phrase: 1 }]);
      assert.equal(alarmOf(env), lit);
      clock.add(60000); await fire(env); assert.equal(state.pushes.length, 1); assert.equal(state.inbox.length, 1);
      clock.to(lit); await fire(env);
      assert.equal(state.pushes.length, 2);
      assert.deepEqual(await decrypt(state.pushes[1].body, s), { body: darkText('out', 'STREET_5'), url: '/?focus=STREET_5' });
      assert.deepEqual(state.inbox[1], { kind: 'dark', slot_id: 'STREET_5', to: a.id, phrase: 2 });
      assert.deepEqual(rows(env), []); assert.equal(alarmOf(env), null);
      clock.add(H); await fire(env); assert.equal(state.pushes.length, 2); assert.equal(state.inbox.length, 2);
    } finally { done(); }
  });

  it('without VAPID_PRIV the inbox row still goes', async () => {
    const { state, clock, done } = setup('17:00');
    try {
      const env = makeEnv(), { guest, post } = harness(env), a = await guest();
      await post('/rt/claim-billboard', CLAIM(), a.token); clock.add(66 * H); await fire(env);
      assert.equal(state.pushes.length, 0); assert.deepEqual(state.inbox, [{ kind: 'dark', slot_id: 'STREET_5', to: a.id, phrase: 1 }]);
    } finally { done(); }
  });

  it('a relight before the alarm cancels the old notice and schedules the new one', async () => {
    const { state, clock, done } = setup('17:00');
    try {
      const env = makeEnv(), { guest, post } = harness(env), a = await guest();
      await post('/rt/claim-billboard', CLAIM(), a.token); const lit = clock.now() + 72 * H;
      clock.add(24 * H); assert.equal((await post('/rt/relight', { slot: 'STREET_5' }, a.token)).status, 200);
      const lit2 = clock.now() + 72 * H; assert.equal(alarmOf(env), lit2 - 6 * H);
      clock.to(lit - 6 * H); await fire(env); clock.to(lit); await fire(env);
      assert.equal(state.inbox.length, 0);
      clock.to(lit2 - 6 * H); await fire(env); assert.deepEqual(state.inbox.map((x) => x.phrase), [1]);
    } finally { done(); }
  });

  it('a relight the registry missed is found at send time: nothing goes, the new clock is kept', async () => {
    const { state, clock, done } = setup('17:00');
    try {
      const env = makeEnv(), { guest, post } = harness(env), a = await guest();
      await post('/rt/claim-billboard', CLAIM(), a.token); const lit = clock.now() + 72 * H;
      clock.to(lit - 6 * H); const lit2 = clock.now() + 72 * H; state.boards[0].lit_until = iso(lit2); // relit elsewhere
      await fire(env);
      assert.equal(state.inbox.length, 0); assert.deepEqual(rows(env), [{ slot: 'STREET_5', uid: a.id, lit: lit2, pre: 0, out: 0 }]);
      assert.equal(alarmOf(env), lit2 - 3 * H); // dark at 11:00 KST: 6 h before is 05:00, moved to 08:00
      state.boards = []; clock.to(lit2 - 3 * H); await fire(env); // cleared elsewhere: dropped
      assert.equal(state.inbox.length, 0); assert.deepEqual(rows(env), []);
    } finally { done(); }
  });

  it('quiet hours: a 6-hour notice due at 06:00 KST goes at 08:00 and says the hours really left', async () => {
    const { state, clock, done } = setup('12:00');
    try {
      const env = makeEnv({ VAPID_PRIV: VAPID }), { guest, post } = harness(env), a = await guest(), s = await subscriber();
      await post('/rt/push', { s: s.sub() }, a.token);
      await post('/rt/claim-billboard', CLAIM(), a.token); const lit = clock.now() + 72 * H; // dark at 12:00 KST, 6 h before is 06:00
      assert.equal(alarmOf(env), lit - 4 * H);
      clock.to(lit - 6 * H); await fire(env); assert.equal(state.inbox.length, 0);
      clock.to(lit - 4 * H); await fire(env);
      assert.deepEqual(await decrypt(state.pushes[0].body, s), { body: darkText('pre', 'STREET_5', 4), url: '/?focus=STREET_5' });
      assert.equal(state.inbox.length, 1);
    } finally { done(); }
  });

  it('quiet hours: a board dark at 01:00 KST gets its dark notice at 08:00 if still held, none if taken meanwhile', async () => {
    const { state, clock, done } = setup('01:00');
    try {
      const env = makeEnv(), { guest, post } = harness(env), a = await guest(), b = await guest();
      await post('/rt/claim-billboard', CLAIM('STREET_6'), a.token); await post('/rt/claim-billboard', CLAIM('STREET_8'), a.token); const lit = clock.now() + 72 * H;
      clock.to(lit - 6 * H); await fire(env); // 19:00 KST: both 6-hour notices
      assert.deepEqual(state.inbox.map((x) => [x.slot_id, x.phrase]).sort(), [['STREET_6', 1], ['STREET_8', 1]]);
      assert.equal(alarmOf(env), lit + 7 * H);
      clock.to(lit); await fire(env); assert.equal(state.inbox.length, 2);
      clock.to(lit + H); await post('/rt/claim-billboard', CLAIM('STREET_8'), b.token); // STREET_8, dark, is taken at 02:00
      const dark = () => state.inbox.filter((x) => x.kind === 'dark'); // the takeover itself adds a 'taken' row
      clock.to(lit + 3 * H); await fire(env); assert.equal(dark().length, 2);
      clock.to(lit + 7 * H); await fire(env);
      assert.deepEqual(dark().filter((x) => x.phrase === 2), [{ kind: 'dark', slot_id: 'STREET_6', to: a.id, phrase: 2 }]);
      assert.deepEqual(rows(env).map((r) => [r.slot, r.uid]), [['STREET_8', b.id]]);
    } finally { done(); }
  });

  it('at the hard budget level nothing is sent or marked; the alarm comes back in 30 minutes', async () => {
    const { state, clock, done } = setup('17:00');
    try {
      const env = makeEnv({ BUDGET_REQ_DAY: '1000' }), { guest, post } = harness(env), a = await guest();
      await post('/rt/claim-billboard', CLAIM(), a.token); const lit = clock.now() + 72 * H;
      await env.meter('day').do.add(950);
      clock.to(lit - 6 * H); await fire(env);
      assert.equal(state.inbox.length, 0); assert.equal(rows(env)[0].pre, 0); assert.equal(alarmOf(env), clock.now() + DARK.retryMs);
      env.BUDGET_REQ_DAY = '1000000'; clock.add(DARK.retryMs); await fire(env);
      assert.deepEqual(state.inbox.map((x) => x.phrase), [1]); assert.equal(rows(env)[0].pre, 1);
    } finally { done(); }
  });

  it('the alarm counts its DO work in the daily budget', async () => {
    const { clock, done } = setup('17:00');
    try {
      const env = makeEnv(), { guest, post } = harness(env), a = await guest();
      await post('/rt/claim-billboard', CLAIM(), a.token); await post('/rt/claim-billboard', CLAIM('STREET_6'), a.token);
      const before = (await env.meter('day').do.add(0)).n;
      clock.add(66 * H); await fire(env);
      assert.equal((await env.meter('day').do.add(0)).n - before, 1 + 1 + 2 + 1); // add(0) itself, the alarm, two due rows, the add call
    } finally { done(); }
  });

  it('merge moves a guest row to the user id; withdrawal deletes it', async () => {
    const { state, clock, done } = setup('17:00');
    try {
      const env = makeEnv(), { guest, post } = harness(env), g = await guest(), u = await userToken(state, clock, '33333333-2222-3333-4444-555555555555');
      await post('/rt/claim-billboard', CLAIM(), g.token);
      assert.equal((await post('/rt/auth/merge', { guest_id: g.id, guest_token: g.token }, u.token)).status, 200);
      assert.deepEqual(rows(env).map((r) => r.uid), [u.id]);
      state.boards[0].holder_id = u.id; // merge_guest_account moved the board
      assert.equal((await post('/rt/auth/withdraw', {}, u.token)).status, 200);
      assert.deepEqual(rows(env), []); assert.equal(alarmOf(env), null);
    } finally { done(); }
  });

  it('the alarm does nothing in any other Meter instance', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), { guest, post } = harness(env), a = await guest(), s = await subscriber();
      await post('/rt/push', { s: s.sub() }, a.token); await post('/rt/wish', { text: '소원', nick: '가' }, a.token);
      for (const name of ['push', 'wish', 'acct', 'day', 'ev', 'snaps']) {
        const m = env.meter(name), calls = state.calls.length;
        assert.equal(await m.do.alarm(), undefined, name);
        assert.equal(m.ctx.alarm, null, name); assert.equal(m.ctx.alarms, 0, name); assert.equal(state.calls.length, calls, name);
        assert.equal(m.sql.db.prepare("select count(*) n from sqlite_master where name = 'dk'").get().n, 0, name);
      }
    } finally { done(); }
  });

  it('a /rt/world refill backfills missing rows only, at most once per isolate per hour', async () => {
    const { state, clock, done } = setup('17:00');
    try {
      const env = makeEnv(), { guest, post, get } = harness(env), a = await guest(), now = clock.now();
      await post('/rt/claim-billboard', CLAIM(), a.token); const lit5 = now + 72 * H;
      state.boards = [
        { slot_id: 'STREET_5', holder_id: 'guest:someone-else', lit_until: iso(now + 10 * H) }, // already in the registry: left as it is
        { slot_id: 'STREET_9', holder_id: 'guest:x', lit_until: iso(now + 30 * H) }, // missing: added
        { slot_id: 'STREET_10', holder_id: 'guest:y', lit_until: null, expires_at: iso(now + 3 * H) }, // missing, 6-hour mark passed: only the dark notice
        { slot_id: 'STREET_11', holder_id: 'guest:z', lit_until: iso(now - H) }, // already dark: no row
        { slot_id: 'STREET_12', holder_id: 'tribe:abcd1234', lit_until: iso(now + 30 * H) }, // tribe: no row
        { slot_id: 'STREET_13', holder_id: null, lit_until: iso(now + 30 * H) },
      ];
      const calls = spyMeter(env, 'dark');
      clock.add(16000); await get('/rt/world');
      assert.equal(calls.dkSeed, 1);
      assert.deepEqual(rows(env), [
        { slot: 'STREET_10', uid: 'guest:y', lit: now + 3 * H, pre: 1, out: 0 },
        { slot: 'STREET_5', uid: a.id, lit: lit5, pre: 0, out: 0 },
        { slot: 'STREET_9', uid: 'guest:x', lit: now + 30 * H, pre: 0, out: 0 },
      ]);
      assert.equal(alarmOf(env), now + 3 * H);
      clock.add(30 * 60000); await get('/rt/world'); assert.equal(calls.dkSeed, 1);
      clock.add(31 * 60000); await get('/rt/world'); assert.equal(calls.dkSeed, 2);
      clock.to(now + 3 * H); await fire(env);
      assert.deepEqual(state.inbox, [{ kind: 'dark', slot_id: 'STREET_10', to: 'guest:y', phrase: 2 }]);
    } finally { done(); }
  });

  it('when Supabase cannot be read at send time the registry stands', async () => {
    const { state, clock, done } = setup('17:00');
    try {
      const env = makeEnv(), { guest, post } = harness(env), a = await guest();
      await post('/rt/claim-billboard', CLAIM(), a.token); clock.add(66 * H); state.boardsDown = true; await fire(env);
      assert.deepEqual(state.inbox.map((x) => x.phrase), [1]);
    } finally { done(); }
  });
});
