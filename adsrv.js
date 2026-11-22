// Advertising sales on the Worker (상6): the /rt/ads/* routes, the admin routes /rt/admin/ads*, the ad part of /rt/world and
// the Meter instance 'ads' that keeps requests, bookings and their counts. worker.js imports this with no query, sends those
// paths here and hands over what it owns (k): adminOk, lvlNow, resolveActor, tokenOf, ipHash and dropWorld (clears its
// /rt/world copies). Nothing here touches coins, slots or Supabase. Payment is by bank transfer or invoice, by hand.
//
// Switch ADS_ON (exactly '1'): the house ad on empty ad screens, the /ads form (/rt/ads/request) and /rt/ads/stats.
// Bookings the operator scheduled show, count and report whether it is on or off.
// Tables in instance 'ads':
//   ad_req(id, at, ip, st, j)              requests from the /ads form; j: the form and the operator's notes. Deleted ADS.keepDays after `at`.
//   ad_book(id, rq, p, s, a, b, st, tok, at, j)  bookings: product, screen, [a, b) ms, live | cancelled, the report token, the creative
//   ad_day(bk, d, c, v)                    per booking and KST day: link clicks, accounts that had the screen in view (sampled), all of them
//   ad_dayu(bk, d, c, v)                   the same, counted from linked accounts (user:) only; guests are ad_day minus this
//   ad_who(bk, d, k, u)                    who already counted that day (u: a hash of the account id); rows of earlier days go
//   ad_rate(k, d, n)                        requests per network (hash, IPv6 by /64) per KST day 'YYYY-MM-DD', and in all ('*') per KST hour 'YYYY-MM-DDTHH'
import { ADS, AD_STATUS, adBookFault, adClash, adCreative, adLink, adPrices, adPublic, adRequestFault, adAudience, adScreenName, AD_PRODUCTS, AD_COUNTED, kstDay, kstHour, addDays, clean, linkHost, priceText, nineOn, nineSince } from './adsale.js';
import { opsRate, opsRateKey } from './ops.js';

export const adsOn = (env) => String(env?.ADS_ON ?? '') === '1';
const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...h } });
const adsM = (env) => env.METER.get(env.METER.idFromName('ads'));
const acctM = (env) => env.METER.get(env.METER.idFromName('acct'));
const hex = (n) => { const b = new Uint8Array(n); crypto.getRandomValues(b); let s = ''; for (const x of b) s += x.toString(16).padStart(2, '0'); return s; };
const TOKEN = /^[0-9a-f]{32}$/, BOOK_ID = /^[0-9a-f]{12}$/;
export const ADS_ERR = {
  off: '지금은 광고 신청을 받지 않아요.', busy: '지금은 광장이 붐벼요. 잠시 뒤에 다시 해 주세요.', rate: '오늘은 신청을 더 받을 수 없어요. 내일 다시 해 주세요.',
  hour: '지금은 신청이 몰려 있어요. 한 시간쯤 뒤에 다시 해 주세요.', fast: '너무 빨리 보내고 있어요. 1분 뒤에 다시 해 주세요.',
  size: '신청서가 너무 길어요.', down: '신청을 저장하지 못했어요. 잠시 뒤에 다시 해 주세요.', auth: '로그인 정보가 없어요.',
};

// ---- the store (Meter instance 'ads'; adsTal runs on 'acct') --------------------------------------------------------
const row = (r) => (r ? { ...r, j: (() => { try { return JSON.parse(r.j); } catch { return {}; } })() } : null);
const bookOf = (r) => { const x = row(r); return x && { id: String(x.id), rq: String(x.rq), p: String(x.p), s: String(x.s), a: Number(x.a), b: Number(x.b), st: String(x.st), tok: String(x.tok), at: Number(x.at), start: String(x.j.start || ''), end: String(x.j.end || ''), l: x.j.l || [], e: x.j.e || '📢', th: x.j.th || 'cyber_navy', u: x.j.u || '' }; };
export const adsDb = {
  tables(q) {
    q.exec('create table if not exists ad_req(id text primary key, at integer not null, ip text not null, st text not null, j text not null)');
    q.exec('create table if not exists ad_book(id text primary key, rq text not null, p text not null, s text not null, a integer not null, b integer not null, st text not null, tok text not null, at integer not null, j text not null)');
    q.exec('create unique index if not exists ad_book_tok on ad_book(tok)');
    q.exec('create table if not exists ad_day(bk text not null, d text not null, c integer not null default 0, v integer not null default 0, primary key(bk, d))');
    q.exec('create table if not exists ad_dayu(bk text not null, d text not null, c integer not null default 0, v integer not null default 0, primary key(bk, d))');
    q.exec('create table if not exists ad_who(bk text not null, d text not null, k text not null, u text not null, primary key(bk, d, k, u))');
    q.exec('create table if not exists ad_rate(k text not null, d text not null, n integer not null, primary key(k, d))');
  },
  // v: a request adRequestFault cleaned. -> { ok: true, id } | { ok: false, code: 'rate' (this network today) | 'hour' (everyone, this
  // hour) }. Old requests and counters go first.
  ask(q, ip, v, now = Date.now()) {
    const d = kstDay(now), h = kstHour(now), key = String(ip || 'x').slice(0, 32);
    q.exec('delete from ad_req where at < ?', now - ADS.keepDays * 864e5);
    q.exec('delete from ad_rate where d < ?', d); // yesterday's days and hours ('YYYY-MM-DDTHH' sorts after its own day only)
    const n = (k, at) => Number(q.exec('select n from ad_rate where k = ? and d = ?', k, at).toArray()[0]?.n) || 0;
    if (n(key, d) >= ADS.perIp) return { ok: false, code: 'rate' };
    if (n('*', h) >= ADS.perHour) return { ok: false, code: 'hour' };
    for (const [k, at] of [[key, d], ['*', h]]) q.exec('insert into ad_rate(k, d, n) values(?, ?, 1) on conflict(k, d) do update set n = n + 1', k, at);
    const id = hex(6);
    q.exec("insert into ad_req(id, at, ip, st, j) values(?, ?, '', 'new', ?)", id, now, JSON.stringify({ ...v, ok: false, price: '', note: '' })); // the network's hash stays in ad_rate, for today only
    return { ok: true, id };
  },
  // The admin's operations, one DO call each (so a booking's overlap check and its insert cannot interleave with another).
  admin(q, op, arg = {}, now = Date.now()) {
    if (op === 'list') {
      q.exec('delete from ad_req where at < ?', now - ADS.keepDays * 864e5);
      const requests = q.exec('select id, at, st, j from ad_req order by at desc limit ?', ADS.listMax).toArray().map(row).map((r) => ({ id: String(r.id), at: Number(r.at), st: String(r.st), ...r.j }));
      const bookings = q.exec('select * from ad_book where b > ? order by a asc limit 400', now - 60 * 864e5).toArray().map(bookOf);
      const sums = new Map(q.exec('select bk, sum(c) c, sum(v) v from ad_day group by bk').toArray().map((r) => [String(r.bk), { c: Number(r.c) || 0, v: Number(r.v) || 0 }]));
      const linked = new Map(q.exec('select bk, sum(c) c, sum(v) v from ad_dayu group by bk').toArray().map((r) => [String(r.bk), { cu: Number(r.c) || 0, vu: Number(r.v) || 0 }]));
      for (const b of bookings) Object.assign(b, sums.get(b.id) || { c: 0, v: 0 }, linked.get(b.id) || { cu: 0, vu: 0 }); // c, v: all; cu, vu: linked accounts
      return { ok: true, requests, bookings };
    }
    if (op === 'edit') {
      const r = row(q.exec('select id, st, j from ad_req where id = ?', String(arg.id || '')).toArray()[0]);
      if (!r) return { ok: false, error: '그 문의가 없어요.' };
      const j = r.j; let st = String(r.st);
      if (arg.st != null) { if (!AD_STATUS.includes(String(arg.st))) return { ok: false, error: '상태가 올바르지 않아요.' }; st = String(arg.st); }
      if (arg.price != null) j.price = clean(arg.price, 80);
      if (arg.note != null) j.note = clean(arg.note, 500);
      if (arg.lines != null || arg.emoji != null || arg.theme != null) {
        const cr = adCreative({ lines: arg.lines ?? j.lines, emoji: arg.emoji ?? j.emoji, theme: arg.theme ?? j.theme });
        if (!cr.ok) return cr;
        const changed = JSON.stringify([cr.l, cr.e, cr.th]) !== JSON.stringify([j.lines, j.emoji, j.theme]);
        j.lines = cr.l; j.emoji = cr.e; j.theme = cr.th; if (changed) j.ok = false; // an edited creative is approved again before it is booked
      }
      if (arg.link != null) { const u = adLink(arg.link); if (u === null) return { ok: false, field: 'link', error: '링크는 https://로 시작하는 공개 주소만 돼요.' }; if (u !== j.link) j.ok = false; j.link = u; }
      if (arg.approve === true) j.ok = true; else if (arg.approve === false) j.ok = false;
      q.exec('update ad_req set st = ?, j = ? where id = ?', st, JSON.stringify(j), r.id);
      return { ok: true, request: { id: r.id, st, ...j } };
    }
    if (op === 'book') {
      const r = row(q.exec('select id, st, j from ad_req where id = ?', String(arg.rq || '')).toArray()[0]);
      if (!r) return { ok: false, error: '그 문의가 없어요.' };
      if (!r.j.ok) return { ok: false, error: '광고 문구를 먼저 승인해 주세요.' };
      const f = adBookFault({ product: arg.product || r.j.product, screen: arg.screen, start: arg.start, end: arg.end }, now);
      if (!f.ok) return f;
      const live = q.exec("select * from ad_book where st = 'live' and b > ?", f.v.a).toArray().map(bookOf);
      const hit = adClash(live, { id: '', p: f.v.p, s: f.v.s, a: f.v.a, b: f.v.b });
      if (hit) return { ok: false, field: 'date', error: `${adScreenName(hit.s) || hit.s}에 ${hit.start}~${hit.end} 일정이 이미 있어요.` };
      const id = hex(6), tok = hex(16);
      const j = { start: f.v.start, end: f.v.end, l: r.j.lines, e: r.j.emoji, th: r.j.theme, u: r.j.link || '' };
      q.exec("insert into ad_book(id, rq, p, s, a, b, st, tok, at, j) values(?, ?, ?, ?, ?, ?, 'live', ?, ?, ?)", id, r.id, f.v.p, f.v.s, f.v.a, f.v.b, tok, now, JSON.stringify(j));
      q.exec("update ad_req set st = 'scheduled' where id = ?", r.id);
      return { ok: true, booking: bookOf(q.exec('select * from ad_book where id = ?', id).toArray()[0]) };
    }
    if (op === 'cancel') {
      const n = q.exec("update ad_book set st = 'cancelled' where id = ? and st = 'live'", String(arg.id || '')).rowsWritten;
      return n ? { ok: true } : { ok: false, error: '그 일정이 없거나 이미 취소됐어요.' };
    }
    return { ok: false, error: 'op' };
  },
  // Live bookings that run now or start within ADS.nowDays, the public copy only.
  // Asked about once every 5 minutes per isolate (adsWorld), so it also drops yesterday's per-network and per-account rows (ad_rate, ad_who)
  // and requests older than ADS.keepDays (the privacy policy's year holds even when no new request comes in).
  now(q, now = Date.now()) {
    const d = kstDay(now);
    q.exec('delete from ad_req where at < ?', now - ADS.keepDays * 864e5);
    q.exec('delete from ad_rate where d < ?', d);
    q.exec('delete from ad_who where d < ?', d);
    return q.exec("select * from ad_book where st = 'live' and b > ? and a < ? order by a asc limit 40", now, now + ADS.nowDays * 864e5).toArray().map(bookOf).map(adPublic);
  },
  // One count per account per booking per KST day: kind 'c' a link click, 'v' the screen seen. Only while the booking runs. A sponsor9
  // booking counts only from 21:00:00 KST until ADS.nineLate after (its minute, plus a late "seen" report); in its minute, while a
  // sponsor9 booking runs, a day booking is off the screens and is not counted. linked: the account is a linked one (user:, not a guest),
  // also counted in ad_dayu. -> how many were counted.
  hit(q, ids, kind, who, now = Date.now(), linked = false) {
    const d = kstDay(now), k = kind === 'c' ? 'c' : 'v', u = String(who || '').slice(0, 32); let n = 0; const keep = [];
    if (!u) return { ok: false, n };
    if (Math.random() < 0.05) q.exec('delete from ad_who where d < ?', d);
    const s9 = nineSince(now), late = s9 >= 0 && s9 < ADS.nineLate;
    const preempt = nineOn(now) && q.exec("select 1 from ad_book where st = 'live' and p = 'sponsor9' and a <= ? and b > ? limit 1", now, now).toArray().length > 0;
    for (const id of (Array.isArray(ids) ? ids : [ids]).slice(0, 6)) {
      const b = bookOf(q.exec("select * from ad_book where id = ? and st = 'live'", String(id)).toArray()[0]);
      if (!b || now < b.a || now >= b.b) continue;
      if (b.p === 'sponsor9' ? !late : preempt) { if (b.p !== 'sponsor9') keep.push(b.id); continue; } // reported in the sponsor minute: the client sends it again next round
      if (q.exec('insert or ignore into ad_who(bk, d, k, u) values(?, ?, ?, ?)', b.id, d, k, u).rowsWritten < 1) continue;
      for (const t of linked === true ? ['ad_day', 'ad_dayu'] : ['ad_day']) q.exec(`insert into ${t}(bk, d, ${k}) values(?, ?, 1) on conflict(bk, d) do update set ${k} = ${k} + 1`, b.id, d);
      n++;
    }
    return { ok: true, n, keep };
  },
  // The report behind a token: the booking and its days, no request, contact or account data.
  read(q, tok) {
    if (!TOKEN.test(String(tok || ''))) return null;
    const b = bookOf(q.exec('select * from ad_book where tok = ?', String(tok)).toArray()[0]);
    if (!b) return null;
    const lk = new Map(q.exec('select d, c, v from ad_dayu where bk = ?', b.id).toArray().map((r) => [String(r.d), { cu: Number(r.c) || 0, vu: Number(r.v) || 0 }]));
    const days = q.exec('select d, c, v from ad_day where bk = ? order by d', b.id).toArray().map((r) => ({ d: String(r.d), c: Number(r.c) || 0, v: Number(r.v) || 0, ...(lk.get(String(r.d)) || { cu: 0, vu: 0 }) }));
    return { p: b.p, s: b.s, start: b.start, end: b.end, st: b.st, l: b.l, e: b.e, th: b.th, u: b.u, days };
  },
  // On 'acct': the plaza's daily visitors (accounts that entered, the boot screen's 오늘 다녀간 사람) from day d0 to d1.
  tal(q, d0, d1) {
    return q.exec("select d, n from tal where k = 'v' and d >= ? and d <= ? order by d", String(d0), String(d1)).toArray().map((r) => ({ d: String(r.d), v: Number(r.n) || 0 }));
  },
};

// ---- the ad part of /rt/world ----------------------------------------------------------------------------------------
// One DO call per isolate per 5 minutes at most (the world itself is cached 15 s; a booking made now reaches other isolates within 5 min); at the hard budget level the last copy.
// At hard with no copy yet: nothing booked, no DO call, asked again in 5 minutes. A failed read keeps what it had (or nothing) and is
// tried again in a minute, not on every world read. null (the key is left out) while the switch is off and nothing is booked.
const NOW = { at: 0, v: null };
export async function adsWorld(env, k) {
  const now = Date.now(), on = adsOn(env) ? 1 : 0;
  if (now - NOW.at >= 300000 || now < NOW.at) {
    let hard = false; try { hard = (await k.lvlNow(env)) >= 2; } catch { hard = false; }
    if (!hard) { try { NOW.v = await adsM(env).adsNow(now); NOW.at = now; } catch { NOW.v = NOW.v || []; NOW.at = now - 240000; } }
    else if (!NOW.v) { NOW.v = []; NOW.at = now; }
  }
  const list = (NOW.v || []).filter((x) => x.b > now);
  return on || list.length ? { on, list } : null;
}
export const adsWorldDrop = () => { NOW.at = 0; NOW.v = null; REP.clear(); }; // also forgets the report reads (a booking changed)
// The bookings this isolate knows to be running now (its /rt/world copy): a click or sighting for any other id makes no DO call.
const runningNow = (now) => new Set((NOW.v || []).filter((x) => x.a <= now && now < x.b).map((x) => x.id));

// /rt/ads/report/<token>: a read (the booking and the plaza's visitors, two DO calls) is reused for ADS.reportTtl per isolate, unknown
// tokens too; at most ADS.reportKeep tokens are held (the oldest goes first). Cleared when the admin changes a booking here.
const REP = new Map(); // tok -> { at, v: { r, vis } | null }
function repKeep(tok, v) { REP.delete(tok); if (REP.size >= ADS.reportKeep) REP.delete(REP.keys().next().value); REP.set(tok, { at: Date.now(), v }); return v; }

// ---- routes ------------------------------------------------------------------------------------------------------------
const STATS = { at: 0, v: null }; // /rt/ads/stats numbers, 10 minutes per isolate
async function stats(env, k) {
  const now = Date.now();
  if (STATS.v && now - STATS.at < 600000) return STATS.v;
  let hard = false; try { hard = (await k.lvlNow(env)) >= 2; } catch { hard = false; }
  if (hard) return STATS.v;
  const today = kstDay(now);
  try { STATS.v = adAudience(await acctM(env).adsTal(addDays(today, -7), addDays(today, -1)), today, 7); STATS.at = now; } catch { /* the last copy, or none */ }
  return STATS.v;
}
async function readSmall(req, max) {
  const n = Number(req.headers.get('content-length') || 0);
  if (n > max) return { big: true };
  let text = ''; try { text = await req.text(); } catch { return { bad: true }; }
  if (text.length > max) return { big: true };
  try { const b = JSON.parse(text); return b && typeof b === 'object' && !Array.isArray(b) ? { b } : { bad: true }; } catch { return { bad: true }; }
}
async function who(actor) {
  const dig = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ads|' + actor.id)));
  let s = ''; for (const x of dig.subarray(0, 8)) s += x.toString(16).padStart(2, '0');
  return s;
}

export async function adsApi(req, env, ctx, u, k) {
  const p = u.pathname;
  if (p === '/rt/admin/ads' || p.startsWith('/rt/admin/ads/')) return adminApi(req, env, u, k);
  if (p === '/rt/ads/stats') {
    if (req.method !== 'GET') return J({ err: 'get' }, 405);
    if (!adsOn(env)) return J({ ok: true, on: false }, 200, { 'cache-control': 'public, max-age=60' });
    const s = await stats(env, k);
    return J({ ok: true, on: true, prices: adPrices(env.ADS_PRICES), counted: AD_COUNTED, stats: s }, 200, { 'cache-control': 'public, max-age=300' });
  }
  if (p === '/rt/ads/request') {
    if (req.method !== 'POST') return J({ err: 'post' }, 405);
    if (!adsOn(env)) return J({ ok: false, code: 'off', error: ADS_ERR.off }, 403);
    if (!(await opsRate(env, req, 'ads'))) return J({ ok: false, code: 'rate', error: ADS_ERR.fast }, 429, { 'retry-after': '60' }); // per network, before any DO call
    const got = await readSmall(req, ADS.bodyMax);
    if (got.big) return J({ ok: false, code: 'size', error: ADS_ERR.size }, 413);
    if (!got.b) return J({ ok: false, code: 'body', error: '신청서를 읽지 못했어요.' }, 400);
    if (String(got.b.website ?? '') !== '') return J({ ok: true, id: hex(6) }); // the honeypot: a bot is told it worked, nothing is kept
    if (await k.lvlNow(env).then((l) => l >= 2, () => false)) return J({ ok: false, code: 'busy', error: ADS_ERR.busy }, 503);
    const f = adRequestFault(got.b);
    if (!f.ok) return J({ ok: false, code: 'field', field: f.field, error: f.error }, 400);
    let r = null; try { r = await adsM(env).adsAsk(await k.ipHash(env, req), f.v, Date.now()); } catch { r = null; }
    if (!r) return J({ ok: false, code: 'down', error: ADS_ERR.down }, 503);
    if (!r.ok) return r.code === 'hour' ? J({ ok: false, code: 'hour', error: ADS_ERR.hour }, 429, { 'retry-after': '3600' }) : J({ ok: false, code: 'rate', error: ADS_ERR.rate }, 429, { 'retry-after': '3600' });
    return J({ ok: true, id: r.id });
  }
  // A count from the plaza: limited per network and per account first, then only ids of bookings this isolate knows to be running reach
  // the store (204 and no DO call otherwise). Linked accounts are counted apart from guests (anyone can make a guest).
  if (p === '/rt/ads/click' || p === '/rt/ads/seen') {
    if (req.method !== 'POST') return J({ err: 'post' }, 405);
    if (!(await opsRate(env, req, 'adhit', ADS.hitIpMin, env.EVENT_RL))) return J({ ok: false, code: 'rate' }, 429, { 'retry-after': '60' });
    const actor = await k.resolveActor(env, k.tokenOf(req)); if (!actor) return J({ ok: false, error: ADS_ERR.auth }, 401);
    if (!(await opsRateKey(env, 'adact', String(actor.id), ADS.hitActorMin))) return J({ ok: false, code: 'rate' }, 429, { 'retry-after': '60' });
    const got = await readSmall(req, 600); if (!got.b) return J({ ok: false }, 400);
    const ids = (Array.isArray(got.b.b) ? got.b.b : [got.b.b]).map(String).filter((x) => BOOK_ID.test(x)).slice(0, 6);
    if (!ids.length) return J({ ok: false }, 400);
    if (await k.lvlNow(env).then((l) => l >= 2, () => false)) return J({ ok: false, code: 'busy' }, 503); // the link still opens; this count is lost
    try { await adsWorld(env, k); } catch { /* the copy this isolate has */ }
    const now = Date.now(), live = runningNow(now), known = ids.filter((x) => live.has(x));
    if (!known.length) return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    const linked = !actor.guest && !actor.anon && String(actor.id).startsWith('user:');
    let r = null; try { r = await adsM(env).adsHit(known, p === '/rt/ads/click' ? 'c' : 'v', await who(actor), now, linked); } catch { r = null; }
    return J({ ok: !!r?.ok, n: Number(r?.n) || 0, ...(Array.isArray(r?.keep) && r.keep.length ? { keep: r.keep.map(String) } : {}) });
  }
  if (p.startsWith('/rt/ads/report/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method', { status: 405 });
    const tok = p.slice('/rt/ads/report/'.length);
    const none = () => page('리포트가 없어요', '<p>주소를 다시 확인해 주세요.</p>', 404);
    if (!TOKEN.test(tok)) return none();
    const show = (v) => (v ? page('광고 리포트', reportHtml(v.r, v.vis)) : none());
    const hit = REP.get(tok), now = Date.now();
    if (hit && now - hit.at < ADS.reportTtl && now >= hit.at) return show(hit.v);
    const wait = (s) => page('잠시 뒤에 다시 열어 주세요', '<h1>잠시 뒤에 다시 열어 주세요</h1><p class="sub">지금은 광장이 붐벼서 리포트를 불러오지 않았어요. 잠시 뒤에 다시 열어 주세요.</p>', s, { 'retry-after': '300', 'cache-control': 'no-store' });
    if (await k.lvlNow(env).then((l) => l >= 2, () => false)) return hit ? show(hit.v) : wait(503); // hard: the last read of any age, or no DO call at all
    if (!(await opsRate(env, req, 'adrep', ADS.reportMin))) return wait(429);
    let r = null; try { r = await adsM(env).adsRead(tok); } catch { return wait(503); }
    if (!r) return show(repKeep(tok, null));
    let vis = []; try { vis = await acctM(env).adsTal(r.start, r.end < kstDay() ? r.end : kstDay()); } catch { vis = []; }
    return show(repKeep(tok, { r, vis }));
  }
  return J({ err: 'not found' }, 404);
}

async function adminApi(req, env, u, k) {
  if (!k.adminOk(env, req)) return J({ err: 'admin' }, 401);
  const M = adsM(env), p = u.pathname;
  if (p === '/rt/admin/ads' && req.method === 'GET') {
    try { return J({ ...(await M.adsAdmin('list', {}, Date.now())), on: adsOn(env), prices: adPrices(env.ADS_PRICES) }); } catch { return J({ ok: false, error: '불러오지 못했어요.' }, 503); }
  }
  const op = { '/rt/admin/ads/edit': 'edit', '/rt/admin/ads/book': 'book', '/rt/admin/ads/cancel': 'cancel' }[p];
  if (!op) return J({ err: 'not found' }, 404);
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const got = await readSmall(req, ADS.bodyMax); if (!got.b) return J({ ok: false, error: '요청을 읽지 못했어요.' }, 400);
  let r = null; try { r = await M.adsAdmin(op, got.b, Date.now()); } catch { r = null; }
  if (!r) return J({ ok: false, error: '저장하지 못했어요.' }, 503);
  if (r.ok && op !== 'edit') { adsWorldDrop(); try { await k.dropWorld(); } catch { /* the world copy runs out in 15 s */ } }
  return J(r, r.ok ? 200 : 400);
}

// ---- the advertiser's report page ------------------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function page(title, body, status = 200, extra = {}) {
  const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">'
    + '<title>' + esc(title) + ' · WISH BOARD</title><style>'
    + 'body{margin:0;background:#070a18;color:#eef0fb;font:15px/1.6 "Pretendard Variable",Pretendard,"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif}'
    + 'main{max-width:640px;margin:0 auto;padding:28px 16px 48px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px;color:#ffb020}'
    + '.sub{color:#9aa3c7;margin:0 0 20px}.card{background:#10152b;border:1px solid #232a4a;border-radius:14px;padding:14px 16px;margin:10px 0}'
    + '.ad{display:inline-block;font-size:12px;font-weight:800;color:#070a18;background:#ffb020;border-radius:6px;padding:1px 7px;margin-right:6px}'
    + 'table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{text-align:right;padding:6px 4px;border-bottom:1px solid #1c2340}th:first-child,td:first-child{text-align:left}'
    + '.tot{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.tot b{display:block;font-size:22px;color:#ffe2a8}.tot span,.tot em{display:block;font-size:12px;color:#9aa3c7;font-style:normal}'
    + '.wide{overflow-x:auto}.wide table{font-size:13px;min-width:420px}'
    + '.note{font-size:13px;color:#9aa3c7}a{color:#ffcf5a}</style></head><body><main>' + body + '</main></body></html>';
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, max-age=60', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer', ...extra } });
}
export function reportHtml(r, visitors) {
  const vis = new Map((visitors || []).map((x) => [String(x.d), Number(x.v) || 0]));
  const cnt = new Map((r.days || []).map((x) => [x.d, x]));
  const rows = [], today = kstDay();
  for (let d = r.start; d <= r.end && d <= today && rows.length < 120; d = addDays(d, 1)) {
    const x = cnt.get(d), c = x?.c || 0, v = x?.v || 0, cu = Math.min(c, x?.cu || 0), vu = Math.min(v, x?.vu || 0);
    rows.push({ d, vis: vis.get(d) || 0, c, v, cu, vu, cg: c - cu, vg: v - vu }); // c, v: all; cu, vu: linked accounts; cg, vg: guests
  }
  const sum = (key) => rows.reduce((a, x) => a + x[key], 0), num = (n) => n.toLocaleString('ko-KR');
  const where = r.p === 'sponsor9' ? '광고 화면 다섯 곳 전체 · 밤 9시 60초' : adScreenName(r.s);
  const lines = (r.l || []).filter(Boolean).map(esc).join('<br>');
  const state = r.st === 'cancelled' ? '취소된 일정' : r.start > today ? '시작 전' : r.end < today ? '끝남' : '송출 중';
  const split = (u, g) => '<em>계정 ' + num(sum(u)) + ' · 게스트 ' + num(sum(g)) + '</em>';
  return '<h1>광고 리포트</h1><p class="sub">' + esc(AD_PRODUCTS[r.p]?.name || '') + ' · ' + esc(where) + ' · ' + esc(r.start) + ' ~ ' + esc(r.end) + ' · ' + state + '</p>'
    + '<div class="card"><span class="ad">광고</span>' + esc(r.e || '') + '<br><b>' + lines + '</b>' + (r.u ? '<br><span class="note">링크: ' + esc(linkHost(r.u)) + '</span>' : '') + '</div>'
    + '<h2>합계 (' + AD_COUNTED + ')</h2><div class="tot"><div><b>' + num(sum('vis')) + '</b><span>광장 방문 계정(일별 합)</span></div><div><b>'
    + num(sum('c')) + '</b><span>링크 클릭</span>' + split('cu', 'cg') + '</div><div><b>' + num(sum('v')) + '</b><span>화면을 본 계정(표본)</span>' + split('vu', 'vg') + '</div></div>'
    + '<h2>날짜별</h2><div class="card wide"><table><tr><th>날짜</th><th>광장 방문</th><th>링크 클릭</th><th>계정</th><th>게스트</th><th>화면 봄(표본)</th><th>계정</th><th>게스트</th></tr>'
    + (rows.length ? rows.map((x) => '<tr><td>' + esc(x.d) + '</td><td>' + x.vis + '</td><td>' + x.c + '</td><td>' + x.cu + '</td><td>' + x.cg + '</td><td>' + x.v + '</td><td>' + x.vu + '</td><td>' + x.vg + '</td></tr>').join('') : '<tr><td colspan="8">아직 송출한 날이 없어요.</td></tr>')
    + '</table></div><p class="note">모든 숫자는 게임이 센 수예요. 공식 노출 수치나 보장된 노출이 아니에요. 광장 방문은 그날 광장에 들어온 계정 수(게스트 포함)이고, 링크 클릭과 화면을 본 계정은 같은 계정을 하루에 한 번만 셉니다. '
    + '화면을 본 계정은 접속의 약 절반만 표본으로 세고, 화면이 2초 넘게 시야에 들어온 경우만 셉니다. 사람이나 기기 수가 아니라 계정 수예요.</p>'
    + '<p class="note">계정은 로그인으로 연결된 계정이고, 게스트는 연결하지 않은 게스트예요. 게스트는 누구나 기기마다 새로 만들 수 있어서 게스트 숫자는 계정 숫자보다 약한(덜 믿을 만한) 수치예요. 합계는 둘을 더한 수예요.</p>'
    + (r.p === 'sponsor9' ? '' : '<p class="note">밤 9시 60초 스폰서가 잡힌 날에는 21시 정각부터 60초 동안 이 화면에 스폰서 광고가 나가고, 그 60초의 클릭과 화면 봄은 세지 않아요.</p>')
    + '<p class="note">이 리포트에는 광고주와 이용자의 개인정보가 없어요. 주소를 아는 사람은 누구나 볼 수 있으니 필요한 사람에게만 보내 주세요.</p>';
}
export { priceText };
