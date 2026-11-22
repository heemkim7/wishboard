// 운영 장치 (launch plan 상1–상5): error reports, 문의하기, operator details, the maintenance notice, /rt/health's extra fields.
// The Worker bundles this file (worker.js imports it without a query). Storage is the Meter instance 'ops' (DO SQLite, no Supabase table):
// the Meter methods in worker.js hand their SQL handle to the store functions below. Every DO call here goes through the env worker.js passes
// in, which is the tallied one, so it counts in the daily budget. At budget hard the two write paths (/rt/err, /rt/support) make no DO call.
import { ERR, SUP, SUPPORT_TEXT, body, errRow, line, maintOf, operatorOf, pathOf, scrub, stackOf, supportFault, supportKind, BUILD_RE } from './opsrules.js';

export const OPS = {
  errMax: 300, // error groups kept (newest last-seen first)
  supMax: 500, // inquiries kept (newest first)
  errBytes: 4096, supBytes: 8192, // request body caps
  supHour: 3, // inquiries per hour per account
  supHourIp: 10, // inquiries per hour per network (mobile carriers put many players behind one address)
  doneKeep: 365 * 864e5, // a handled inquiry (its e-mail with it) goes within a year
  rlKeep: 3600e3,
  ipMin: 20, // per isolate, per IP and route, per minute: the fallback when the OPS_RL binding is missing
  sameMs: 30000, // one isolate sends one group at most once per 30 s; repeats ride along as a count
  maintTtl: 60000, maintHardTtl: 300000, maintWait: 800,
  dbTtl: 30000, dbSlow: 1000, dbTimeout: 2000,
};
export const OPS_PATHS = new Set(['/rt/err', '/rt/support', '/rt/admin/errors', '/rt/admin/errors/clear', '/rt/admin/support', '/rt/admin/maint']);
const SUPA = 'https://yxddhpacuyaffaoutxjn.supabase.co', ANON = 'sb_publishable_Vd-7c6e2f2s3G1d5Jbx9vw_0UCuHm-B'; // public (worker.js has the same pair)
const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...h } });
const opsM = (env) => env.METER.get(env.METER.idFromName('ops'));
const DEV = new Set(['phone', 'tablet', 'desktop']);

// ---- store (runs inside the Meter instance 'ops'; q = ctx.storage.sql) ----------------------------------------------------------------
export function opsInit(q) {
  q.exec('create table if not exists oerr(h text primary key, kind text not null, msg text not null, src text not null, n integer not null, first integer not null, last integer not null, stack text not null, builds text not null, page text not null, ua text not null, tier text not null, touch integer not null)');
  q.exec('create table if not exists osup(id text primary key, at integer not null, kind text not null, body text not null, email text not null, actor text not null, nick text not null, build text not null, page text not null, dev text not null, status text not null, done_at integer)');
  q.exec('create table if not exists orl(k text not null, at integer not null)');
  q.exec('create index if not exists orl_k on orl(k, at)');
  q.exec('create table if not exists okv(k text primary key, v text not null)');
}
// One report (n of them when an isolate held repeats back). Same group: count up, newest sample, up to five build ids (newest last).
export function errPut(q, r, now = Date.now()) {
  const old = q.exec('select builds from oerr where h = ?', r.h).toArray()[0];
  let builds = []; try { builds = JSON.parse(old?.builds || '[]'); } catch { builds = []; }
  if (r.build) { builds = builds.filter((b) => b !== r.build); builds.push(r.build); builds = builds.slice(-5); }
  const n = Math.max(1, Math.min(1000, Math.floor(Number(r.n) || 1)));
  if (old) q.exec('update oerr set n = n + ?, last = ?, stack = ?, builds = ?, page = ?, ua = ?, tier = ?, touch = ? where h = ?', n, now, r.stack || '', JSON.stringify(builds), r.page || '', r.ua || '', r.tier || '', r.touch ? 1 : 0, r.h);
  else q.exec('insert into oerr values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', r.h, r.kind, r.msg, r.src || '', n, now, now, r.stack || '', JSON.stringify(builds), r.page || '', r.ua || '', r.tier || '', r.touch ? 1 : 0);
  const c = Number(q.exec('select count(*) as c from oerr').one().c) || 0;
  if (c > OPS.errMax) q.exec('delete from oerr where h in (select h from oerr order by last asc limit ?)', c - OPS.errMax);
  return { ok: true };
}
export function errList(q) {
  return q.exec('select * from oerr order by last desc limit ?', OPS.errMax).toArray().map((r) => {
    let builds = []; try { builds = JSON.parse(r.builds); } catch { builds = []; }
    return { h: r.h, kind: r.kind, msg: r.msg, src: r.src, n: Number(r.n), first: Number(r.first), last: Number(r.last), stack: r.stack, builds, page: r.page, ua: r.ua, tier: r.tier, touch: Number(r.touch) };
  });
}
export function errClear(q) { const n = Number(q.exec('select count(*) as c from oerr').one().c) || 0; q.exec('delete from oerr'); return { ok: true, cleared: n }; }
function supPrune(q, now) {
  q.exec("delete from osup where status = 'done' and done_at < ?", now - OPS.doneKeep);
  q.exec('delete from orl where at < ?', now - OPS.rlKeep);
}
// The hourly limit and the write in one call, so two tabs cannot both pass. keys: 'i:<ip hash>' (OPS.supHourIp an hour) and, with an
// account, 'a:<actor id>' (OPS.supHour an hour).
export function supPut(q, row, keys, now = Date.now()) {
  supPrune(q, now);
  for (const k of keys) if ((Number(q.exec('select count(*) as c from orl where k = ? and at > ?', k, now - OPS.rlKeep).one().c) || 0) >= (k.startsWith('i:') ? OPS.supHourIp : OPS.supHour)) return { ok: false, code: 'rate' };
  for (const k of keys) q.exec('insert into orl(k, at) values(?, ?)', k, now);
  q.exec("insert into osup values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', null)", row.id, now, row.kind, row.body, row.email || '', row.actor || '', row.nick || '', row.build || '', row.page || '', row.dev || '');
  const c = Number(q.exec('select count(*) as c from osup').one().c) || 0;
  if (c > OPS.supMax) q.exec('delete from osup where id in (select id from osup order by at asc limit ?)', c - OPS.supMax);
  return { ok: true, id: row.id };
}
export function supList(q, status = 'open', now = Date.now()) {
  supPrune(q, now);
  const where = status === 'open' || status === 'done' ? ' where status = ?' : '', args = where ? [status] : [];
  const items = q.exec('select * from osup' + where + ' order by at desc limit ?', ...args, OPS.supMax).toArray().map((r) => ({ id: r.id, at: Number(r.at), kind: r.kind, body: r.body, email: r.email, actor: r.actor, nick: r.nick, build: r.build, page: r.page, dev: r.dev, status: r.status, done_at: r.done_at == null ? null : Number(r.done_at) }));
  const open = Number(q.exec("select count(*) as c from osup where status = 'open'").one().c) || 0;
  return { ok: true, items, open };
}
export function supMark(q, id, status, now = Date.now()) {
  if (status !== 'open' && status !== 'done') return { ok: false };
  const w = q.exec('update osup set status = ?, done_at = ? where id = ?', status, status === 'done' ? now : null, String(id || '')).rowsWritten;
  return { ok: w > 0 };
}
export function maintGet(q) { const r = q.exec("select v from okv where k = 'maint'").toArray()[0]; if (!r) return null; try { return JSON.parse(r.v); } catch { return null; } }
export function maintPut(q, m) { const v = maintOf(m) ? { on: true, ...maintOf(m), at: Date.now() } : { on: false, at: Date.now() }; q.exec("insert into okv(k, v) values('maint', ?) on conflict(k) do update set v = excluded.v", JSON.stringify(v)); return v; }

// ---- per-isolate helpers ---------------------------------------------------------------------------------------------------------
const IPC = new Map(); // 'route|ip' -> { at, n }: the per-minute fallback limit
function ipMem(key, max = OPS.ipMin, now = Date.now()) {
  const hit = IPC.get(key);
  if (!hit || now - hit.at >= 60000 || now < hit.at) { if (IPC.size >= 5000) IPC.clear(); IPC.set(key, { at: now, n: 1 }); return true; }
  hit.n++; return hit.n <= max;
}
// The Workers Rate Limiting binding OPS_RL (wrangler.jsonc) when there is one, and the isolate's own count either way.
export async function opsRate(env, req, route) {
  const ip = req.headers.get('cf-connecting-ip') || 'x';
  if (!ipMem(route + '|' + ip)) return false;
  const rl = env.OPS_RL; if (!rl) return true;
  try { return (await rl.limit({ key: route + ':' + ip })).success !== false; } catch { return true; }
}
async function hex16(s) { const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); let h = ''; for (const b of d.slice(0, 8)) h += b.toString(16).padStart(2, '0'); return h; }
export const errKey = (r) => hex16(r.kind + '\n' + r.msg + '\n' + r.src);
async function readCapped(req, max) {
  if (Number(req.headers.get('content-length') || 0) > max) return { big: true };
  let t = ''; try { t = await req.text(); } catch { return { bad: true }; }
  if (t.length > max) return { big: true };
  try { const b = JSON.parse(t); return b && typeof b === 'object' && !Array.isArray(b) ? { b } : { bad: true }; } catch { return { bad: true }; }
}
// Same group again within OPS.sameMs in this isolate: counted here and sent with the next one after that (a tail lost with the isolate is accepted).
const SAME = new Map(); // h -> { at, n }
function sameHold(h, now = Date.now()) {
  const s = SAME.get(h);
  if (s && now - s.at < OPS.sameMs && now >= s.at) { s.n++; return 0; }
  const n = 1 + (s?.n || 0);
  if (SAME.size >= 2000) SAME.clear();
  SAME.set(h, { at: now, n: 0 });
  return n;
}
async function errStore(env, r) { const h = await errKey(r), n = sameHold(h); if (!n) return 'held'; await opsM(env).opsErrPut({ ...r, h, n }); return 'kept'; }

// ---- /rt/err, /rt/support and the admin routes --------------------------------------------------------------------------------------
// deps: lvl() the budget level (worker.js lvlNow), lvlCopy() the isolate's copy, admin() the ADMIN_KEY check, actor() the token's account or
// null, ipHash() a salted hash of the client IP.
export async function opsApi(req, env, ctx, u, deps) {
  const p = u.pathname;
  if (p === '/rt/err') {
    if (req.method !== 'POST') return J({ err: 'post' }, 405);
    if (!(await opsRate(env, req, 'err'))) return J({ ok: false, err: 'rate' }, 429, { 'retry-after': '60' });
    const got = await readCapped(req, OPS.errBytes);
    if (got.big) return J({ ok: false, err: 'size' }, 413);
    const r = got.b && errRow(got.b);
    if (!r) return J({ ok: false, err: 'bad' }, 400);
    if ((await deps.lvl()) >= 2) return J({ ok: true, kept: false, busy: true }, 202); // hard: dropped, no DO call
    try { return J({ ok: true, kept: await errStore(env, r) }, 202); } catch { return J({ ok: false, err: 'store' }, 503); }
  }
  if (p === '/rt/support') {
    if (req.method !== 'POST') return J({ err: 'post' }, 405);
    const no = (code, s) => J({ ok: false, code, error: SUPPORT_TEXT[code] }, s);
    if (!(await opsRate(env, req, 'sup'))) return no('rate', 429);
    const got = await readCapped(req, OPS.supBytes);
    if (got.big) return no('long', 413);
    const b = got.b || {};
    const fault = supportFault({ kind: b.kind, text: b.text, email: b.email, agree: b.agree });
    if (fault) return no(fault, 400);
    if ((await deps.lvl()) >= 2) return no('busy', 503); // hard: refused before any DO call
    const actor = await Promise.resolve().then(deps.actor).catch(() => null), ip = await deps.ipHash();
    const row = {
      id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
      kind: supportKind(b.kind), body: body(b.text), email: String(b.email || '').trim(),
      actor: actor?.id ? String(actor.id) : '', nick: line(b.nick, SUP.nick),
      build: BUILD_RE.test(String(b.build || '')) ? String(b.build) : '', page: pathOf(b.page), dev: DEV.has(b.dev) ? b.dev : '',
    };
    const keys = ['i:' + ip].concat(row.actor ? ['a:' + row.actor] : []);
    let res = null; try { res = await opsM(env).opsSupPut(row, keys); } catch { return no('down', 502); }
    if (res?.ok !== true) return no(res?.code === 'rate' ? 'rate' : 'down', res?.code === 'rate' ? 429 : 502);
    return J({ ok: true, id: res.id });
  }
  // Admin: x-admin-key, the same check as every other /rt/admin route.
  if (!deps.admin()) return J({ err: 'admin' }, 401);
  if (p === '/rt/admin/errors') { if (req.method !== 'GET') return J({ err: 'get' }, 405); return J({ ok: true, items: await opsM(env).opsErrList() }); }
  if (p === '/rt/admin/errors/clear') { if (req.method !== 'POST') return J({ err: 'post' }, 405); SAME.clear(); return J(await opsM(env).opsErrClear()); }
  if (p === '/rt/admin/support') {
    if (req.method === 'GET') { const s = u.searchParams.get('status'); return J(await opsM(env).opsSupList(s === 'done' || s === 'all' ? s : 'open')); }
    if (req.method !== 'POST') return J({ err: 'method' }, 405);
    const got = await readCapped(req, 1000), b = got.b || {};
    if (!/^[0-9a-f]{12}$/.test(String(b.id || '')) || (b.status !== 'open' && b.status !== 'done')) return J({ ok: false, err: 'bad' }, 400);
    const r = await opsM(env).opsSupMark(b.id, b.status); return J(r, r.ok ? 200 : 404);
  }
  if (p === '/rt/admin/maint') {
    if (req.method === 'GET') { const v = await opsM(env).opsMaintGet(); MAINT = { at: Date.now(), v: maintOf(v), p: null }; return J({ ok: true, maint: v || { on: false } }); }
    if (req.method !== 'POST') return J({ err: 'method' }, 405);
    const got = await readCapped(req, 2000), b = got.b;
    if (!b || typeof b.on !== 'boolean') return J({ ok: false, err: 'bad' }, 400);
    let until = 0;
    if (b.until != null && b.until !== '' && b.until !== 0) { until = typeof b.until === 'number' ? b.until : Date.parse(String(b.until)); if (!Number.isFinite(until) || until <= 0) return J({ ok: false, err: 'until' }, 400); }
    const v = await opsM(env).opsMaintPut({ on: b.on, msg: b.msg, until });
    MAINT = { at: Date.now(), v: maintOf(v), p: null }; // this isolate at once; the others within OPS.maintTtl
    return J({ ok: true, maint: v });
  }
  return J({ err: 'not found' }, 404);
}

// ---- server exceptions: the top-level fetch handler's catch. Kept as kind 'server', same store and grouping. Never throws.
export async function opsCrash(req, env, ctx, e, deps) {
  const res = J({ err: 'server' }, 500);
  try {
    let path = '/'; try { path = new URL(req.url).pathname; } catch { }
    const st = String(e?.stack || '');
    const top = (st.split('\n').find((x) => /\.js:\d+/.test(x)) || '').match(/([\w./-]+\.js):(\d+):(\d+)/);
    const r = { kind: 'server', msg: line(scrub(`${e?.name || 'Error'}: ${e?.message ?? e}`), ERR.msg), src: line(pathOf(path) + (top ? ' ' + top[1].split('/').pop() + ':' + top[2] + ':' + top[3] : ''), ERR.src), stack: stackOf(st), build: BUILD.v || '', page: pathOf(path), tier: '', touch: 0, ua: '' };
    const job = (async () => { if (!env?.METER || (await deps.lvl()) >= 2) return; await errStore(env, r); })().catch(() => { });
    try { ctx?.waitUntil?.(job); } catch { }
  } catch { }
  return res;
}

// ---- /rt/config: operator and maint ----------------------------------------------------------------------------------------------
let OPC = { raw: undefined, v: null };
export function operatorFor(env) { const raw = env?.OPERATOR_INFO; if (raw !== OPC.raw) OPC = { raw, v: operatorOf(raw) }; return OPC.v; }
// The maintenance notice as this isolate knows it: at most OPS.maintTtl old (5 min at budget hard), refreshed behind the response.
// An isolate that never read it waits for its first read (OPS.maintWait at most). No METER binding: never on.
let MAINT = { at: 0, v: null, p: null };
export function maintNow() { return MAINT.v; }
export async function maintFor(env, ctx, lvlCopy = () => 0) {
  if (!env?.METER) return null;
  const now = Date.now(), ttl = lvlCopy() >= 2 ? OPS.maintHardTtl : OPS.maintTtl;
  if (MAINT.at && now - MAINT.at < ttl && now >= MAINT.at) return MAINT.v;
  const first = !MAINT.at;
  if (!MAINT.p) {
    const p = MAINT.p = (async () => { let v = MAINT.v; try { v = maintOf(await opsM(env).opsMaintGet()); } catch { } if (MAINT.p === p) MAINT = { at: Date.now(), v, p: null }; })();
  }
  if (first) { let t; await Promise.race([MAINT.p, new Promise((r) => { t = setTimeout(r, OPS.maintWait); })]); clearTimeout(t); }
  else { try { ctx?.waitUntil?.(MAINT.p); } catch { } }
  return MAINT.v;
}

// ---- /rt/health's extra fields ---------------------------------------------------------------------------------------------------
let DB = { at: 0, v: '', p: null };
async function dbProbe() {
  const now = Date.now();
  if (DB.v && now - DB.at < OPS.dbTtl && now >= DB.at) return DB.v;
  if (DB.p) return DB.p;
  return DB.p = (async () => {
    const t0 = Date.now(), ac = typeof AbortController === 'function' ? new AbortController() : null; let timer, v = 'down';
    try {
      const r = await Promise.race([
        fetch(SUPA + '/rest/v1/billboards?select=slot_id&limit=1', { headers: { apikey: ANON, accept: 'application/json' }, signal: ac?.signal }),
        new Promise((res) => { timer = setTimeout(() => { try { ac?.abort(); } catch { } res(null); }, OPS.dbTimeout); }),
      ]);
      if (r && r.ok) { try { await r.body?.cancel?.(); } catch { } v = Date.now() - t0 >= OPS.dbSlow ? 'slow' : 'ok'; }
    } catch { v = 'down'; } finally { clearTimeout(timer); }
    DB = { at: Date.now(), v, p: null };
    return v;
  })();
}
// The deployed build id: the BUILD_ID var when it has the build shape, else the one index.html loads main.js with (read once per isolate).
let BUILD = { v: '', tried: false };
async function buildOf(env, req) {
  const fixed = String(env?.BUILD_ID || '');
  if (BUILD_RE.test(fixed)) return fixed;
  if (BUILD.tried || !env?.ASSETS?.fetch) return BUILD.v;
  BUILD.tried = true;
  try { const r = await env.ASSETS.fetch(new Request(new URL('/', req.url))); const m = r.ok ? (await r.text()).match(/main\.js\?v=(\d{8,14}[a-z]?)/) : null; if (m) BUILD.v = m[1]; } catch { }
  return BUILD.v;
}
// base: today's fields (hasFlushKey, hasGuestKey, mode). Adds db 'ok' | 'slow' | 'down', budget 0 | 1 | 2, maint, build (when known).
export async function opsHealth(req, env, ctx, base, deps) {
  // Over the per-IP limit (main.js reads /rt/health on every boot, and many players can share one address): today's fields and what this
  // isolate already knows, with no probe, no level refresh and no DO call. Never a 429: the boot reads hasFlushKey from here.
  if (!(await opsRate(env, req, 'health'))) return J({ ...base, ...(DB.v ? { db: DB.v } : {}), budget: Math.max(0, Math.min(2, Number(deps.lvlCopy()) || 0)), maint: !!MAINT.v, ...(BUILD.v ? { build: BUILD.v } : {}), cached: true });
  const [db, budget, maint, build] = await Promise.all([dbProbe(), Promise.resolve().then(() => deps.lvl()).catch(() => 0), maintFor(env, ctx, deps.lvlCopy).catch(() => null), buildOf(env, req)]);
  return J({ ...base, db, budget: Math.max(0, Math.min(2, Number(budget) || 0)), maint: !!maint, ...(build ? { build } : {}) });
}
// Tests: forget what this isolate learned.
export function opsReset() { MAINT = { at: 0, v: null, p: null }; DB = { at: 0, v: '', p: null }; BUILD = { v: '', tried: false }; OPC = { raw: undefined, v: null }; SAME.clear(); IPC.clear(); }
