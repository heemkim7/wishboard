// 선물 전광판 on the Worker: the /rt/gift* routes, the admin routes /rt/admin/gift*, the recipient page /g/<id>, the gift part of
// /rt/world and the Meter instance 'gift' (Durable Object SQLite, so no Supabase migration). worker.js imports this with no query,
// sends those paths here and hands over what it owns (k): adminOk, lvlNow, resolveActor, tokenOf, ipHash (the network hash, IPv6
// by /64), humanGate (Turnstile, only while it is switched on), actOk (ACT_RL) and pushNow (web push). Server only: .assetsignore keeps
// this file off the static assets.
//
// Budget: every DO call on these HTTP paths goes through the tallied env worker.js passes in. Reads are cached per isolate (20 s,
// 10 min at the hard budget level); page beacons are kept in the isolate and go to the DO in one call per GIFT.seenBatch or
// GIFT.seenMs; at hard every write answers 503 busy (or drops the beacon) without a DO call.
// Video: an optional R2 binding MEDIA. Without it uploads answer 501 nostore and the recipient page plays the drawn film.
// Privacy (legal.js, 개인정보처리방침 › 선물 전광판과 롤링페이퍼, 알림): the recipient is a display name only; a line keeps its writer's
// account or guest id, never shown to anyone; the board, its lines, card and video go 7 days after the day; interest in the paid tiers is
// counted only as daily totals; "열리면 알림" is advertising: its own consent, "(광고)" in front, never 21:00-08:00 KST, 60 days unless
// renewed. Withdrawal deletes the account's boards (with every line on them), the lines it wrote elsewhere, the videos and the opt-ins;
// an account link moves a guest's boards and lines to the account.
//
// Tables in instance 'gift' (made on first use):
//   gb(id, at, uid, ip, day, a, b, scr, st, lk, ref, n, v, vd, kids, rp, vid, j, re, hr)  boards; j: { to, from, occ, msg, th }; re: the first
//                                              답장 전광판 (a board made with re: 1 whose ref is this one), '' when none; hr: 💖 count. re and
//                                              hr are added to older stores
//   gm(g, id, at, uid, nick, txt, ip, st, rp)  롤링페이퍼 lines; uid: the writer (guest or account), ip: network hash (both only for caps and reports)
//   gv(g, v, at, dd, h)                        distinct visitors per board (v: a hash of the device's random id), dd: seen on the day, h: gave 💖
//   gd(d, k, n)                                daily counters (KST): made, made_ref, made_again, start, start_ref, view, view_day, return_day,
//                                              heart, hit, hitbot, msg, video, ladder, pick:t, ev:<beacon>, ...
//   gr(k, d, n)                                limits: per account / network and KST day, video uploads per board ('*')
//   gi(uid, t, at, sent)                       "열리면 알림" opt-ins (consented) per paid tier; sent: when the opening notice went
//   grp(g, m, ip)                              reports per board ('') or line (its id), one per network
//   gc(g, jpg, at)                             the link-preview card (JPEG the sender's device drew)
import { GIFT, GIFT_ID, PAPER_ID, VISITOR_ID, GIFT_ERR, giftFault, paperFault, pickScreen, nextFree, giftPhase, paperTakes, lockArm, giftView, giftShareText, refOf, kstDay, addDays, pruneDay, quietNow, AD_LABEL, videoKind, VIDEO_TYPE, rangeOf, windowText, OCCASIONS, TIERS, CER_BEACONS, heartsOpen, dayStart, botAgent } from './giftrules.js';
import { opsRate } from './ops.js';

const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...h } });
const no = (code, s = 400, extra = {}) => J({ ok: false, code, error: GIFT_ERR[code] || GIFT_ERR.down, ...extra }, s);
const giftM = (env) => env.METER.get(env.METER.idFromName('gift'));
const ID_ABC = '0123456789abcdefghijklmnopqrstuvwxyz';
const rid = (n) => { const b = new Uint8Array(n); crypto.getRandomValues(b); let s = ''; for (const x of b) s += ID_ABC[x % 36]; return s; };
const hex = async (s) => { const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); let h = ''; for (const x of d.subarray(0, 8)) h += x.toString(16).padStart(2, '0'); return h; };
const hard = async (k, env) => { try { return (await k.lvlNow(env)) >= 2; } catch { return false; } };
export const mediaOn = (env) => !!(env?.MEDIA && typeof env.MEDIA.put === 'function' && typeof env.MEDIA.get === 'function');
export const vidKey = (id) => 'gift/' + id + '.v';
const parse = (s) => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const CARD_MIN = 3000, CARD_MAX = 300000, NOTIFY_N = 10; // NOTIFY_N: accounts per notify call (each push: a DO call and up to 3 fetches; 50 subrequests a call)

// ---- the store (Meter instance 'gift') ---------------------------------------------------------------------------------
const rowOf = (r) => {
  if (!r) return null;
  const j = parse(r.j), v = r.vid ? parse(r.vid) : null;
  return { id: String(r.id), at: Number(r.at), uid: String(r.uid), ip: String(r.ip), day: String(r.day), a: Number(r.a), b: Number(r.b), scr: String(r.scr), st: String(r.st), lk: Number(r.lk) || 0,
    ref: String(r.ref || ''), re: String(r.re || ''), hr: Number(r.hr) || 0, n: Number(r.n) || 0, v: Number(r.v) || 0, vd: Number(r.vd) || 0, kids: Number(r.kids) || 0, rp: Number(r.rp) || 0,
    vid: v && v.t ? { t: String(v.t), n: Number(v.n) || 0, at: Number(v.at) || 0 } : null,
    to: String(j.to || ''), from: String(j.from || ''), occ: String(j.occ || 'bday'), msg: String(j.msg || ''), th: String(j.th || '') };
};
const bump = (q, d, k, n = 1) => q.exec('insert into gd(d, k, n) values(?, ?, ?) on conflict(d, k) do update set n = n + excluded.n', d, k, n);
const lim = (q, k, d) => Number(q.exec('select n from gr where k = ? and d = ?', k, d).toArray()[0]?.n) || 0;
const limAdd = (q, k, d) => q.exec('insert into gr(k, d, n) values(?, ?, 1) on conflict(k, d) do update set n = n + 1', k, d);
// A board that goes takes its reply mark off the board it answered (a reply's ref is that board, so this is a key lookup, not a scan).
function dropBoards(q, ids) {
  for (const id of ids) for (const t of ['gm', 'gv', 'grp', 'gc']) q.exec(`delete from ${t} where g = ?`, id);
  for (const id of ids) {
    q.exec('delete from gr where k = ?', 'vb:' + id); q.exec('delete from gr where k = ?', 'rn:' + id);
    q.exec('delete from gr where k >= ? and k < ?', 'h:' + id + ':', 'h:' + id + ';'); // today's 💖 per network: a range on gr's key, not a scan
    q.exec("update gb set re = '' where id = (select ref from gb where id = ?) and re = ?", id, id);
    q.exec('delete from gb where id = ?', id);
  }
}
// A device seen on a board ('open'): a distinct visitor (and, on the board's own day, a distinct visitor that day, or a returning one).
function visitAdd(q, g, v, onDay, d, now) {
  const fresh = q.exec('insert or ignore into gv(g, v, at, dd) values(?, ?, ?, ?)', g, v, now, onDay ? 1 : 0).rowsWritten > 0;
  if (fresh) { q.exec('update gb set v = v + 1' + (onDay ? ', vd = vd + 1' : '') + ' where id = ?', g); bump(q, d, 'view'); if (onDay) bump(q, d, 'view_day'); return; }
  if (onDay && q.exec('update gv set dd = 1 where g = ? and v = ? and dd = 0', g, v).rowsWritten > 0) { q.exec('update gb set vd = vd + 1 where id = ?', g); bump(q, d, 'view_day'); bump(q, d, 'return_day'); }
}
// 💖 from a device: kept on its visitor row (gv.h, on the device hash a view already keeps). For the cap a heart also keeps the network
// hash against the board for that KST day (gr 'h:<board>:<net>'): that one is new for someone who only looked and pressed, so it goes the
// next day (heartPrune on the first beacon batch of the day, or the make/admin prune) or with the board, whichever is first. A device that
// hearts before its 'open' beacon arrived is seen here first (its later open then changes nothing). -> true when it was counted.
function heartAdd(q, g, v, net, d, now) {
  if (!g || !heartsOpen(g, now)) return false;
  const nk = 'h:' + g.id + ':' + net;
  if (!net || lim(q, nk, d) >= GIFT.heartNet) return false;
  visitAdd(q, g.id, v, g.day === d, d, now);
  if (q.exec('update gv set h = 1 where g = ? and v = ? and h = 0', g.id, v).rowsWritten < 1) return false;
  q.exec('update gb set hr = hr + 1 where id = ?', g.id); limAdd(q, nk, d); bump(q, d, 'heart');
  return true;
}
// Yesterday's (and older) 💖 network marks, on the beacon path: once a KST day (the mark 'hprune' for today, itself pruned tomorrow),
// HEART_PRUNE rows at a time; the day's mark is set only once none are left, so a large backlog goes over the next batches.
const HEART_PRUNE = 500;
function heartPrune(q, d) {
  if (lim(q, 'hprune', d) > 0) return 0;
  const n = q.exec("delete from gr where rowid in (select rowid from gr where k >= 'h:' and k < 'h;' and d < ? limit ?)", d, HEART_PRUNE).rowsWritten;
  if (n < HEART_PRUNE) limAdd(q, 'hprune', d);
  return n;
}
// A board's line count, from what is left (after lines of one writer went).
const recount = (q, g) => q.exec('update gb set n = (select count(*) from gm where gm.g = gb.id) where id = ?', g);
export const giftDb = {
  tables(q) {
    q.exec("create table if not exists gb(id text primary key, at integer not null, uid text not null, ip text not null, day text not null, a integer not null, b integer not null, scr text not null, st text not null, lk integer not null default 1, ref text not null default '', n integer not null default 0, v integer not null default 0, vd integer not null default 0, kids integer not null default 0, rp integer not null default 0, vid text not null default '', j text not null)");
    q.exec('create index if not exists gb_day on gb(day)');
    q.exec('create index if not exists gb_b on gb(b)');
    q.exec('create index if not exists gb_uid on gb(uid)');
    // re (the first reply's id) came after the first stores were made: those get the column here, the way worker.js adds its own
    // (a second try fails on the duplicate name and changes nothing). No Supabase migration.
    try { q.exec("alter table gb add column re text not null default ''"); } catch { /* column already exists */ }
    try { q.exec('alter table gb add column hr integer not null default 0'); } catch { /* column already exists */ } // 💖 (2026-11-27), the same way
    q.exec("create table if not exists gm(g text not null, id text not null, at integer not null, uid text not null, nick text not null, txt text not null, ip text not null, st text not null default 'live', rp integer not null default 0, primary key(g, id))");
    q.exec('create index if not exists gm_uid on gm(uid)');
    q.exec('create table if not exists gv(g text not null, v text not null, at integer not null, dd integer not null default 0, primary key(g, v))');
    try { q.exec('alter table gv add column h integer not null default 0'); } catch { /* column already exists */ } // this device gave 💖
    q.exec('create table if not exists gd(d text not null, k text not null, n integer not null, primary key(d, k))');
    q.exec('create table if not exists gr(k text not null, d text not null, n integer not null, primary key(k, d))');
    q.exec('create table if not exists gi(uid text not null, t integer not null, at integer not null, sent integer not null default 0, primary key(uid, t))');
    q.exec('create table if not exists grp(g text not null, m text not null, ip text not null, primary key(g, m, ip))');
    q.exec('create table if not exists gc(g text primary key, jpg blob not null, at integer not null)');
  },
  // Boards whose day ended GIFT.keepDays ago go with their lines, visitors, reports and card; yesterday's limits, counters older than 400
  // days and opt-ins not renewed for GIFT.optinDays too. -> the ids whose video (if any) the Worker deletes from R2.
  prune(q, now = Date.now()) {
    const old = q.exec('select id from gb where day <= ? limit 200', pruneDay(now)).toArray().map((r) => String(r.id));
    if (old.length) dropBoards(q, old);
    const d = kstDay(now);
    q.exec("delete from gr where d < ? and d <> '*'", d);
    q.exec('delete from gd where d < ?', addDays(d, -400));
    q.exec('delete from gi where at < ?', now - GIFT.optinDays * 864e5);
    return old;
  },
  // o: { uid, ip, v (giftFault's), ref, re, split }. -> { ok: true, row, gone, reply? } | { ok: false, code: 'mine' | 'net' | 'full', next, gone }.
  // 답장 전광판: with o.re and a kept ref (the answered board exists and is another account's) the answered board keeps this board's id
  // in re: the first reply stays, a later one changes nothing. reply: { gid: the answered board's id, to: its owner } only when that mark
  // was set now; `to` (the Worker sends that owner the notice) and the day's `reply` count come once per answered board for good (gr
  // 'rn:<id>', kept until the board goes): a reply taken down and hung again, or one that took a hidden reply's place, tells nobody twice.
  // A later reply is an ordinary board made from the page (kids, made_ref).
  make(q, o, now = Date.now()) {
    const gone = this.prune(q, now), d = kstDay(now), v = o.v;
    if (lim(q, 'u:' + o.uid, d) >= GIFT.dayPerActor) return { ok: false, code: 'mine', gone };
    if (lim(q, 'n:' + o.ip, d) >= GIFT.dayPerNet) return { ok: false, code: 'net', gone };
    const rows = q.exec("select scr, a, b from gb where st = 'live' and b > ? and a < ?", Math.min(v.a, now), Math.max(v.b, now + (GIFT.aheadDays + 9) * 864e5)).toArray().map((r) => ({ scr: String(r.scr), a: Number(r.a), b: Number(r.b) }));
    const scr = pickScreen(rows, v.a, v.b);
    if (!scr) return { ok: false, code: 'full', next: nextFree(rows, v.day, now), gone };
    let id = rid(GIFT.idLen); for (let i = 0; i < 4 && q.exec('select 1 from gb where id = ?', id).toArray().length; i++) id = rid(GIFT.idLen);
    let ref = refOf(o.ref);
    const parent = ref ? rowOf(q.exec('select * from gb where id = ?', ref).toArray()[0]) : null;
    if (!parent || parent.uid === o.uid) ref = '';
    // made_again: the maker (account or guest id) has another board still kept (boards go 7 days after their day, so "again" is judged
    // against those only). A daily total: nothing new about the maker is stored.
    const again = q.exec('select 1 from gb where uid = ? limit 1', o.uid).toArray().length > 0;
    q.exec("insert into gb(id, at, uid, ip, day, a, b, scr, st, lk, ref, j) values(?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?, ?)", id, now, o.uid, o.ip, v.day, v.a, v.b, scr, lockArm(id, !!o.split), ref,
      JSON.stringify({ to: v.to, from: v.from, occ: v.occ, msg: v.msg, th: v.th }));
    limAdd(q, 'u:' + o.uid, d); limAdd(q, 'n:' + o.ip, d);
    bump(q, d, 'made'); if (again) bump(q, d, 'made_again');
    if (ref) { q.exec('update gb set kids = kids + 1 where id = ?', ref); bump(q, d, 'made_ref'); }
    // Only a board whose page can still be opened is answered (not a hidden one, not one past its 7 days), and the place is taken only
    // while the reply in it can be opened too: a reply that was hidden or is over does not keep later ones out.
    let reply = null;
    if (ref && o.re && giftPhase(parent, now) !== 'gone' && giftPhase(parent.re ? rowOf(q.exec('select * from gb where id = ?', parent.re).toArray()[0]) : null, now) === 'gone') {
      q.exec('update gb set re = ? where id = ?', id, ref);
      const first = lim(q, 'rn:' + ref, '*') === 0;
      if (first) { limAdd(q, 'rn:' + ref, '*'); bump(q, d, 'reply'); }
      reply = { gid: ref, ...(first ? { to: parent.uid } : {}) };
    }
    return { ok: true, row: this.get(q, id, now, false), gone, ...(reply ? { reply } : {}) };
  },
  // The stored board (owner fields included: the Worker strips them), with its visible lines (no writer ids) when withPaper.
  // re is kept only while the reply board can still be opened (there, not hidden, its page not over): the owner's card links to it.
  get(q, id, now = Date.now(), withPaper = true) {
    const row = rowOf(q.exec('select * from gb where id = ?', String(id || '')).toArray()[0]);
    if (!row) return null;
    if (row.re && giftPhase(rowOf(q.exec('select * from gb where id = ?', row.re).toArray()[0]), now) === 'gone') row.re = '';
    if (withPaper) row.paper = q.exec("select id, nick, txt from gm where g = ? and st = 'live' order by at asc, rowid asc limit ?", row.id, GIFT.paper.max).toArray().map((r) => ({ id: String(r.id), nick: String(r.nick), txt: String(r.txt) }));
    return row;
  },
  // A 롤링페이퍼 line. o: { uid (the writer), ip, nick, txt }. -> { ok: true, n, id } | { ok: false, code }.
  paper(q, id, o, now = Date.now()) {
    const g = this.get(q, id, now, false);
    if (!g || giftPhase(g, now) === 'gone') return { ok: false, code: 'gone' };
    if (!paperTakes(g, now)) return { ok: false, code: 'paperClosed' };
    if ((Number(q.exec('select count(*) n from gm where g = ?', g.id).one().n) || 0) >= GIFT.paper.max) return { ok: false, code: 'paperFull' };
    if ((Number(q.exec('select count(*) n from gm where g = ? and uid = ?', g.id, o.uid).one().n) || 0) >= GIFT.paper.perWriter) return { ok: false, code: 'paperMine' };
    const d = kstDay(now), nk = 'p:' + g.id + ':' + o.ip;
    if (lim(q, nk, d) >= GIFT.paper.perNetDay) return { ok: false, code: 'paperNet' };
    let mid = rid(6); for (let i = 0; i < 4 && q.exec('select 1 from gm where g = ? and id = ?', g.id, mid).toArray().length; i++) mid = rid(6);
    q.exec('insert into gm(g, id, at, uid, nick, txt, ip) values(?, ?, ?, ?, ?, ?, ?)', g.id, mid, now, o.uid, o.nick, o.txt, o.ip);
    q.exec('update gb set n = n + 1 where id = ?', g.id);
    limAdd(q, nk, d); bump(q, d, 'msg');
    return { ok: true, n: g.n + 1, id: mid };
  },
  // Page beacons, many boards in one call: [{ g, v (visitor hash), e }]. 'open' counts a distinct visitor per board (and, on the
  // board's own day, a distinct visitor that day and a returning one); every other event is a daily count only.
  // Also carried in the same call, with no board: { e: 'hit' | 'hitbot', d, n } (GETs of /g/<id> HTML, summed in the isolate per KST day)
  // and { e: 'start', r } (the maker form shown; r: 1 when it came from another board: start_ref). 'heart' ({ g, v, e, n: network hash})
  // is 💖: once per device and board for good (gv.h), only while heartsOpen, at most GIFT.heartNet per board, network and day.
  seen(q, items, now = Date.now()) {
    const d = kstDay(now); let n = 0;
    heartPrune(q, d);
    for (const it of (Array.isArray(items) ? items : []).slice(0, SEEN_MAX)) { // the isolate sends at most SEEN_MAX a call
      const g = String(it?.g || ''), v = String(it?.v || ''), e = String(it?.e || '');
      if (e === 'hit' || e === 'hitbot') { const day = String(it?.d || ''), k = Math.floor(Number(it?.n)); if (/^\d{4}-\d{2}-\d{2}$/.test(day) && k > 0 && k <= 1e6) { bump(q, day, e, k); n++; } continue; }
      if (e === 'start') { bump(q, d, 'start'); if (Number(it?.r) === 1) bump(q, d, 'start_ref'); n++; continue; }
      if (!GIFT_ID.test(g) || !/^[0-9a-f]{16}$/.test(v) || !(SEEN_EV.has(e) || e === 'heart')) continue;
      const row = q.exec(e === 'heart' ? 'select * from gb where id = ?' : 'select day from gb where id = ?', g).toArray()[0];
      if (!row) continue;
      n++;
      if (e === 'heart') { heartAdd(q, rowOf(row), v, String(it?.n || ''), d, now); continue; }
      if (e !== 'open') { bump(q, d, 'ev:' + e); continue; }
      visitAdd(q, g, v, String(row.day) === d, d, now);
    }
    return { ok: true, n };
  },
  // E1 on the owner's preview: act 'view' (the ladder was shown), 'pick' (tier t chosen) are daily totals only, never kept against the
  // account or the board (the page asks once per board). 'notify' (tier t, with the advertising consent) keeps the account against the
  // tier so the opening notice can reach its web push; asking again renews it. -> { ok }.
  interest(q, id, uid, act, t, consent, now = Date.now()) {
    const g = this.get(q, id, now, false);
    if (!g || giftPhase(g, now) === 'gone') return { ok: false, code: 'gone' };
    if (g.uid !== uid) return { ok: false, code: 'owner' };
    const d = kstDay(now), tier = Math.floor(Number(t));
    if (act === 'view') { bump(q, d, 'ladder'); return { ok: true }; }
    if (!(tier >= 1 && tier <= 3)) return { ok: false, code: 'down' };
    if (act === 'pick') { bump(q, d, 'pick:' + tier); return { ok: true }; }
    if (act === 'notify') {
      if (consent !== true) return { ok: false, code: 'consent' };
      const had = q.exec('select 1 from gi where uid = ? and t = ?', uid, tier).toArray().length > 0;
      q.exec('insert into gi(uid, t, at, sent) values(?, ?, ?, 0) on conflict(uid, t) do update set at = excluded.at', uid, tier, now);
      if (!had) bump(q, d, 'notify:' + tier);
      return { ok: true };
    }
    return { ok: false, code: 'down' };
  },
  // Before an upload: the owner, at most GIFT.video.perBoard per board and perNetDay per network. Counts the attempt. -> { ok } | { ok: false, code }.
  vidAsk(q, id, uid, ip, now = Date.now()) {
    const g = this.get(q, id, now, false);
    if (!g || giftPhase(g, now) === 'gone') return { ok: false, code: 'gone' };
    if (g.uid !== uid) return { ok: false, code: 'owner' };
    const d = kstDay(now);
    if (lim(q, 'vb:' + g.id, '*') >= GIFT.video.perBoard) return { ok: false, code: 'vmany' };
    if (lim(q, 'vn:' + ip, d) >= GIFT.video.perNetDay) return { ok: false, code: 'vmany' };
    limAdd(q, 'vb:' + g.id, '*'); limAdd(q, 'vn:' + ip, d);
    return { ok: true };
  },
  vidSet(q, id, uid, meta, now = Date.now()) {
    const g = this.get(q, id, now, false);
    if (!g || g.uid !== uid) return { ok: false, code: 'owner' };
    q.exec('update gb set vid = ? where id = ?', JSON.stringify({ t: String(meta.t), n: Number(meta.n) || 0, at: now }), g.id);
    if (!g.vid) bump(q, kstDay(now), 'video');
    return { ok: true };
  },
  cardPut(q, id, uid, bytes, now = Date.now()) {
    const g = this.get(q, id, now, false);
    if (!g || g.uid !== uid) return { ok: false, code: 'owner' };
    q.exec('insert into gc(g, jpg, at) values(?, ?, ?) on conflict(g) do update set jpg = excluded.jpg, at = excluded.at', g.id, bytes, now);
    return { ok: true };
  },
  cardGet(q, id) { const r = q.exec("select c.jpg from gc c join gb b on b.id = c.g where c.g = ? and b.st = 'live'", String(id || '')).toArray()[0]; return r?.jpg || null; },
  // A report from one network on the board (m '') or one of its lines. GIFT.report networks hide it. -> { ok, hidden }.
  report(q, id, m, ip, now = Date.now()) {
    const g = this.get(q, id, now, false);
    if (!g) return { ok: false, code: 'gone' };
    const mid = PAPER_ID.test(String(m || '')) ? String(m) : '';
    if (mid && !q.exec('select 1 from gm where g = ? and id = ?', g.id, mid).toArray().length) return { ok: false, code: 'gone' };
    if (q.exec('insert or ignore into grp(g, m, ip) values(?, ?, ?)', g.id, mid, ip).rowsWritten < 1) return { ok: true, hidden: false };
    const n = Number(q.exec('select count(*) n from grp where g = ? and m = ?', g.id, mid).one().n) || 0;
    if (mid) { q.exec('update gm set rp = ? where g = ? and id = ?', n, g.id, mid); if (n >= GIFT.report) q.exec("update gm set st = 'hidden' where g = ? and id = ?", g.id, mid); }
    else { q.exec('update gb set rp = ? where id = ?', n, g.id); if (n >= GIFT.report) q.exec("update gb set st = 'hidden' where id = ?", g.id); }
    bump(q, kstDay(now), 'report');
    return { ok: true, hidden: n >= GIFT.report };
  },
  // The owner takes the board down: it goes with everything of it. -> { ok, vid, up } (vid: had a video to delete; up: the board it was
  // the reply of, whose copy in the Worker is now old).
  del(q, id, uid) {
    const g = this.get(q, id, Date.now(), false);
    if (!g) return { ok: false, code: 'gone' };
    if (g.uid !== uid) return { ok: false, code: 'owner' };
    dropBoards(q, [g.id]);
    return { ok: true, vid: !!g.vid, up: g.ref };
  },
  // Boards on the plaza now (the public copy /rt/world carries), at most GIFT.liveMax, earliest first.
  live(q, now = Date.now()) {
    return q.exec("select * from gb where st = 'live' and a <= ? and b > ? order by a asc, id asc limit ?", now, now, GIFT.liveMax).toArray().map(rowOf)
      .map((g) => ({ id: g.id, to: g.to, from: g.from, occ: g.occ, msg: g.msg, th: g.th, scr: g.scr, a: g.a, b: g.b, n: g.n }));
  },
  // Account link: the guest's boards, the lines it wrote and its opt-ins move to the account (running it again changes nothing).
  move(q, from, to) {
    if (!from || !to || from === to) return { ok: false };
    q.exec('update gb set uid = ? where uid = ?', to, from);
    q.exec('update gm set uid = ? where uid = ?', to, from);
    q.exec('update or ignore gi set uid = ? where uid = ?', to, from); q.exec('delete from gi where uid = ?', from); // the account's own opt-in for a tier wins
    return { ok: true };
  },
  // Withdrawal: the account's boards with every line on them, the lines it wrote on other boards (those boards' counts follow), its
  // opt-ins. -> { ok, ids } (the boards gone, whose videos the Worker deletes from R2).
  forget(q, uid) {
    if (!uid) return { ok: false, ids: [] };
    const ids = q.exec('select id from gb where uid = ?', uid).toArray().map((r) => String(r.id));
    if (ids.length) dropBoards(q, ids);
    const touched = q.exec('select distinct g from gm where uid = ?', uid).toArray().map((r) => String(r.g));
    q.exec('delete from gm where uid = ?', uid);
    for (const g of touched) recount(q, g);
    q.exec('delete from gi where uid = ?', uid);
    return { ok: true, ids, lines: touched.length };
  },
  // Makers, by the board row's uid (the account, or the guest id this browser keeps; a guest's boards move to the account on linking).
  // Counted from the boards still kept, by when they were made (at): the KST week from Monday 00:00, and the last 30 days split into
  // makers with one board and makers with two or more. Boards go 7 days after their day, so the 30 days see only boards still kept
  // (made_again, a daily total, is the durable count). -> { week: { from, n }, d30: { one, more }, keptFrom }.
  makers(q, now = Date.now()) {
    const today = kstDay(now), dow = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7, monday = addDays(today, -dow);
    const wk = dayStart(monday), from30 = now - 30 * 864e5;
    const week = Number(q.exec('select count(distinct uid) n from gb where at >= ?', wk).one().n) || 0;
    const per = q.exec('select count(*) c from gb where at >= ? group by uid', from30).toArray().map((r) => Number(r.c) || 0);
    const kept = q.exec('select min(at) t from gb').toArray()[0]?.t;
    return { week: { from: monday, n: week }, d30: { one: per.filter((c) => c === 1).length, more: per.filter((c) => c >= 2).length }, keptFrom: kept == null ? null : Number(kept) };
  },
  // admin: 'list' (one KST day's boards, every state, with their lines), 'stats' (daily counters d0..d1 and board totals by lock arm),
  // 'hide', 'optins' (counts per tier), 'notify' (the next NOTIFY_N consented accounts not sent yet: marks them sent and hands them over).
  admin(q, op, arg = {}, now = Date.now()) {
    if (op === 'list') {
      const gone = this.prune(q, now);
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(arg.day || '')) ? String(arg.day) : kstDay(now);
      const rows = q.exec('select * from gb where day = ? order by a asc limit 300', day).toArray().map(rowOf);
      for (const g of rows) {
        g.lines = q.exec('select id, nick, txt, st, rp, at from gm where g = ? order by at asc, rowid asc', g.id).toArray().map((r) => ({ id: String(r.id), nick: String(r.nick), txt: String(r.txt), st: String(r.st), rp: Number(r.rp) || 0, at: Number(r.at) }));
        g.phase = giftPhase(g, now); delete g.uid; delete g.ip;
      }
      return { ok: true, day, boards: rows, gone };
    }
    if (op === 'stats') {
      const d1 = /^\d{4}-\d{2}-\d{2}$/.test(String(arg.d1 || '')) ? String(arg.d1) : kstDay(now);
      const d0 = /^\d{4}-\d{2}-\d{2}$/.test(String(arg.d0 || '')) ? String(arg.d0) : addDays(d1, -29);
      const days = new Map();
      for (const r of q.exec('select d, k, n from gd where d >= ? and d <= ? order by d', d0, d1).toArray()) { const x = days.get(String(r.d)) || {}; x[String(r.k)] = Number(r.n) || 0; days.set(String(r.d), x); }
      // Boards whose day is in the range, as they stand now: visitors and lines per board, boards that led to another, by lock arm (E3).
      const arms = q.exec("select lk, count(*) b, sum(v) v, sum(vd) vd, sum(n) n, sum(kids) kids, sum(case when vid <> '' then 1 else 0 end) vid from gb where day >= ? and day <= ? group by lk", d0, d1).toArray()
        .map((r) => ({ lk: Number(r.lk) || 0, boards: Number(r.b) || 0, visitors: Number(r.v) || 0, dayVisitors: Number(r.vd) || 0, lines: Number(r.n) || 0, kids: Number(r.kids) || 0, videos: Number(r.vid) || 0 }));
      return { ok: true, d0, d1, days: [...days].map(([d, k]) => ({ d, ...k })), arms, makers: this.makers(q, now), optins: this.admin(q, 'optins', {}, now).optins };
    }
    if (op === 'optins') {
      return { ok: true, optins: q.exec('select t, count(*) n, sum(case when sent > 0 then 1 else 0 end) s from gi group by t order by t').toArray().map((r) => ({ t: Number(r.t), n: Number(r.n) || 0, sent: Number(r.s) || 0 })) };
    }
    if (op === 'notify') {
      const uids = q.exec('select uid from gi where sent = 0 and at >= ? group by uid order by min(at) asc limit ?', now - GIFT.optinDays * 864e5, NOTIFY_N).toArray().map((r) => String(r.uid));
      for (const u of uids) q.exec('update gi set sent = ? where uid = ?', now, u);
      const left = Number(q.exec('select count(distinct uid) n from gi where sent = 0 and at >= ?', now - GIFT.optinDays * 864e5).one().n) || 0;
      return { ok: true, uids, left };
    }
    if (op === 'hide') {
      const id = String(arg.id || ''), m = PAPER_ID.test(String(arg.m || '')) ? String(arg.m) : '', st = arg.hide === false ? 'live' : 'hidden';
      const n = m ? q.exec('update gm set st = ? where g = ? and id = ?', st, id, m).rowsWritten : q.exec('update gb set st = ? where id = ?', st, id).rowsWritten;
      return n ? { ok: true } : { ok: false, error: '그 선물 전광판(또는 메시지)이 없어요.' };
    }
    return { ok: false, error: 'op' };
  },
};
// reply: the recipient page's 답장 button; cer, cershot (점등식): a device came to a ceremony, it saved or shared the group photo.
// share: the owner's 공유하기; reshare: a visitor's 🔗 공유하기 on the recipient page (its own key, ev:reshare).
const SEEN_EV = new Set(['open', 'film', 'play', 'done', 'save', 'go', 'share', 'reshare', 'cta', 'reply', 'paper_open', ...CER_BEACONS]);

// ---- isolate caches ------------------------------------------------------------------------------------------------------
const ONE = new Map(); // id -> { at, v: stored board | null }
const oneTtl = (h) => (h ? 600000 : 20000);
const oneKeep = (id, v) => { ONE.delete(id); if (ONE.size >= 500) ONE.delete(ONE.keys().next().value); ONE.set(id, { at: Date.now(), v }); return v; };
export const giftDrop = (id) => { ONE.delete(id); NOW.at = 0; CARD.delete(id); };
// -> { v: the stored board | null, h: the budget hard level this read asked anyway (the two reads pass it out as `hard`: no second ask) }.
async function loadGiftH(env, k, id) {
  const hit = ONE.get(id), now = Date.now(), h = await hard(k, env);
  if (hit && now - hit.at < oneTtl(h) && now >= hit.at) return { v: hit.v, h };
  let v = null; try { v = await giftM(env).giftGet(id, now); } catch { if (hit) return { v: hit.v, h }; throw new Error('down'); }
  return { v: oneKeep(id, v || null), h };
}
const loadGift = async (env, k, id) => (await loadGiftH(env, k, id)).v;
// /rt/world's gifts: one DO call per isolate per 2 minutes at most (5 while none is up); at hard the last copy; a failed read keeps the last copy.
// A board made in this isolate shows at once; one made in another isolate shows within that time.
const NOW = { at: 0, v: null }, NOW_TTL = 120000, NOW_IDLE = 300000;
export async function giftWorld(env, k) {
  const now = Date.now();
  if (now - NOW.at >= (NOW.v?.length ? NOW_TTL : NOW_IDLE) || now < NOW.at) {
    if (!(await hard(k, env))) { try { NOW.v = await giftM(env).giftLive(now); NOW.at = now; } catch { NOW.v = NOW.v || []; NOW.at = now; } }
    else if (!NOW.v) { NOW.v = []; NOW.at = now; } // hard with no copy yet: nothing shown, no DO call, asked again in a minute
  }
  const list = (NOW.v || []).filter((g) => g.a <= now && g.b > now);
  return list.length ? list : null;
}
// Page beacons: kept here, one DO call per GIFT.seenBatch or once the oldest is GIFT.seenMs old (the next beacon's waitUntil sends it).
// An isolate that dies loses what it held (like the request tally).
// At most SEEN_MAX items go in one call (the DO takes no more); the rest stay for the next one. A call that fails puts its items back
// once (marked re: a second failure drops them), in front, within SEEN_CAP, so a 💖 shown as pressed is not lost to one slow or failed call.
// Link hits (GETs of /g/<id>) are only sums here, per KST day: { hit, hitbot }. They ride on the next beacon batch, first in its list; when
// they have waited GIFT.seenMs and no beacon took them, the next gift request in this isolate sends them by themselves (hitsFlush): at
// most one such DO call per GIFT.seenMs per isolate, never at budget hard (fetchers send no beacons, so this is what brings theirs in).
export const SEEN_MAX = 200;
const SEEN_CAP = 1000;
const SEEN = { list: [], at: 0, p: null }, HITS = new Map(), HIT = { at: 0, last: 0 };
const seenAdd = (it) => { if (!SEEN.list.length) SEEN.at = Date.now(); if (SEEN.list.length < SEEN_CAP) SEEN.list.push(it); };
function hitAdd(bot, now = Date.now()) {
  const d = kstDay(now), x = HITS.get(d) || { hit: 0, hitbot: 0 };
  x[bot ? 'hitbot' : 'hit']++; HITS.set(d, x); if (!HIT.at) HIT.at = now;
  if (HITS.size > 3) HITS.delete(HITS.keys().next().value); // an isolate that saw no beacon for days keeps three days at most
}
function seenFlush(env, ctx, force = false) {
  const now = Date.now();
  if (SEEN.p || (!SEEN.list.length && !(force && HITS.size)) || (!force && SEEN.list.length < GIFT.seenBatch && now - SEEN.at < GIFT.seenMs)) return SEEN.p;
  const items = [];
  for (const [d, x] of HITS) for (const e of ['hit', 'hitbot']) if (x[e]) items.push({ e, d, n: x[e] });
  HITS.clear(); HIT.at = 0;
  items.push(...SEEN.list.splice(0, Math.max(0, SEEN_MAX - items.length)));
  if (!SEEN.list.length) SEEN.at = 0; // what is left keeps its age: the next request sends it
  SEEN.p = Promise.resolve().then(() => giftM(env).giftSeen(items, now))
    .catch(() => { const back = items.filter((it) => !it.re).map((it) => ({ ...it, re: 1 })); if (back.length) { SEEN.list = [...back, ...SEEN.list].slice(0, SEEN_CAP); SEEN.at = SEEN.at || now; } })
    .finally(() => { SEEN.p = null; });
  try { ctx?.waitUntil?.(SEEN.p); } catch { /* tests */ }
  return SEEN.p;
}
// Hits waiting longer than GIFT.seenMs with no beacon to carry them. h: the budget level this request already knows (giftPage), else asked
// here, and only when they are due (so an ordinary request asks nothing more).
async function hitsFlush(env, ctx, k, h) {
  const now = Date.now();
  if (SEEN.p || !HITS.size || !HIT.at || now - HIT.at < GIFT.seenMs || (now - HIT.last < GIFT.seenMs && now >= HIT.last)) return null;
  if (h ?? (await hard(k, env))) return null;
  HIT.last = now;
  seenFlush(env, ctx, true); // in waitUntil: the request does not wait for it
  return true;
}
export const giftSeenFlush = (env, ctx) => seenFlush(env, ctx, true); // tests
export const giftSeenState = () => ({ list: SEEN.list.length, hits: HITS.size, busy: !!SEEN.p }); // tests

// ---- helpers -------------------------------------------------------------------------------------------------------------
async function readSmall(req, max) {
  if (Number(req.headers.get('content-length') || 0) > max) return { big: true };
  let t = ''; try { t = await req.text(); } catch { return { bad: true }; }
  if (t.length > max) return { big: true };
  try { const b = JSON.parse(t); return b && typeof b === 'object' && !Array.isArray(b) ? { b } : { bad: true }; } catch { return { bad: true }; }
}
async function readBytes(req, max) {
  if (Number(req.headers.get('content-length') || 0) > max) return { big: true };
  let buf; try { buf = await req.arrayBuffer(); } catch { return { bad: true }; }
  return buf.byteLength > max ? { big: true } : { u8: new Uint8Array(buf) };
}
const visitorHash = (env, v) => hex('gv|' + String(v) + '|' + String(env.GUEST_KEY || ''));
const actorOf = async (req, k, env) => { try { return await k.resolveActor(env, k.tokenOf(req)); } catch { return null; } };
const isOwner = (g, actor) => !!(g && actor && g.uid === String(actor.id));
// What only the owner's read carries. re: the first reply board's id while it can be opened (giftDb.get decides); never in the public view.
const ownerExtras = (g) => ({ kids: g.kids, vd: g.vd, at: g.at, lk: g.lk, ...(g.re ? { re: g.re } : {}) });
const actNo = async (k, env, id) => !!(k.actOk && !(await k.actOk(env, 'misc', id)));

// ---- routes --------------------------------------------------------------------------------------------------------------
export const giftPath = (p) => p === '/rt/gift' || p.startsWith('/rt/gift/') || p === '/rt/admin/gift' || p.startsWith('/rt/admin/gift/');
export async function giftApi(req, env, ctx, u, k) {
  const p = u.pathname;
  seenFlush(env, ctx); // beacons kept here go out with any gift request once they are due (no-op otherwise)
  await hitsFlush(env, ctx, k); // link hits no beacon took, once they are due (no-op otherwise; the answer does not wait for the call)
  if (p === '/rt/admin/gift' || p.startsWith('/rt/admin/gift/')) return adminApi(req, env, ctx, u, k);
  if (p === '/rt/gift') return make(req, env, ctx, k);
  if (p === '/rt/gift/start') return startSeen(req, env, ctx, k);
  const m = /^\/rt\/gift\/([0-9a-z]{8})(?:\/(paper|seen|heart|interest|video|card\.jpg|card|report|delete))?$/.exec(p);
  if (!m) return J({ err: 'not found' }, 404);
  const id = m[1], sub = m[2] || '';
  if (sub === 'seen') return seen(req, env, ctx, id, k);
  if (sub === 'heart') return heart(req, env, ctx, id, k);
  if (sub === 'video') return req.method === 'POST' ? videoUp(req, env, ctx, id, k) : videoGet(req, env, id, k);
  if (sub === 'card.jpg') return cardGet(req, env, id, k);
  if (sub === 'card') return cardUp(req, env, id, k);
  if (sub === 'paper') return paper(req, env, id, k);
  if (sub === 'interest') return interest(req, env, id, k);
  if (sub === 'report') return report(req, env, id, k);
  if (sub === 'delete') return remove(req, env, ctx, id, k);
  if (req.method !== 'GET') return J({ err: 'get' }, 405);
  if (!(await opsRate(env, req, 'gread', 120, env.EVENT_RL))) return no('rate', 429);
  let g, h; try { ({ v: g, h } = await loadGiftH(env, k, id)); } catch { return no('down', 503); }
  const now = Date.now();
  if (!g || giftPhase(g, now) === 'gone') return no('gone', 404);
  const actor = k.tokenOf(req) ? await actorOf(req, k, env) : null, own = isOwner(g, actor);
  // hard: budget hard (점등식: the page's button and the plaza's arrival stay out of the room). Only at level 2; an old page ignores it.
  return J({ ok: true, gift: giftView(g, now), own, ...(own ? { mine: ownerExtras(g), media: mediaOn(env) } : {}), ...(h ? { hard: true } : {}) });
}

// POST /rt/gift { to, from, occ, msg, th, day, at, ref, re, ts }: a guest token is enough. Checks, cheapest first: token, the account's
// minute (ACT_RL misc), the network's minute (OPS_RL), body, budget hard, Turnstile ('gift', only while switched on), the form, then one
// DO call that counts the day limits and picks the screen.
// re: 1 marks a 답장 전광판 (ref names the board it answers). It is a board like any other, with the same checks and limits. When it is the
// answered board's first reply, that board's owner gets one web push (informational, so no "(광고)"; never 21:00-08:00 KST: then the owner
// page shows it the next time it is opened). The answer says nothing of the answered board or its owner.
async function make(req, env, ctx, k) {
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const actor = await actorOf(req, k, env); if (!actor) return no('auth', 401);
  if (await actNo(k, env, actor.id)) return no('rate', 429, { 'retry-after': '60' });
  if (!(await opsRate(env, req, 'gift'))) return no('rate', 429);
  const got = await readSmall(req, 3000); if (got.big) return no('long', 413); if (!got.b) return no('down', 400);
  if (await hard(k, env)) return no('busy', 503);
  const gate = k.humanGate ? await k.humanGate(env, req, got.b, 'gift') : null; if (gate) return gate;
  const now = Date.now(), f = giftFault(got.b, now);
  if (!f.ok) return J({ ok: false, code: f.code, field: f.field, error: f.error }, 400);
  const ref = refOf(got.b.ref);
  let r = null; try { r = await giftM(env).giftMake({ uid: String(actor.id), ip: await k.ipHash(env, req), v: f.v, ref, re: !!ref && Number(got.b.re) === 1, split: String(env.GIFT_E3 || '') === '1' }, now); } catch { r = null; }
  if (r?.gone?.length) mediaDrop(env, ctx, r.gone);
  if (!r) return no('down', 503);
  if (!r.ok) return r.code === 'full' ? J({ ok: false, code: 'full', error: GIFT_ERR.full, next: r.next || null }, 409) : no(r.code, 429);
  oneKeep(r.row.id, r.row); NOW.at = 0;
  if (r.reply) {
    ONE.delete(r.reply.gid); // the answered board's copy here has no re yet
    if (r.reply.to && !quietNow(now) && k.pushNow) k.pushNow(env, ctx, r.reply.to, { kind: 'giftreply', from_name: f.v.from, gid: r.reply.gid }); // to: only the board's first reply ever
  }
  return J({ ok: true, id: r.row.id, url: new URL('/g/' + r.row.id, req.url).href, gift: giftView(r.row, now), mine: ownerExtras(r.row), media: mediaOn(env) });
}
function mediaDrop(env, ctx, ids) {
  if (!mediaOn(env) || !ids?.length) return null;
  const job = Promise.resolve().then(() => env.MEDIA.delete(ids.map(vidKey))).catch(() => { });
  try { ctx?.waitUntil?.(job); } catch { /* tests */ }
  return job;
}

// POST /rt/gift/<id>/paper { nick, txt, ts }: a guest token is enough (the policy keeps the writer's id, never shown). The account's and
// the network's minute, the body, budget hard, Turnstile ('gmsg'), the line, then one DO call with the caps (per board, per writer, per
// network and day).
async function paper(req, env, id, k) {
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const actor = await actorOf(req, k, env); if (!actor) return no('auth', 401);
  if (await actNo(k, env, actor.id)) return no('rate', 429);
  if (!(await opsRate(env, req, 'gmsg'))) return no('rate', 429);
  const got = await readSmall(req, 2000); if (got.big) return no('long', 413); if (!got.b) return no('down', 400);
  if (await hard(k, env)) return no('busy', 503);
  const gate = k.humanGate ? await k.humanGate(env, req, got.b, 'gmsg') : null; if (gate) return gate;
  const f = paperFault(got.b);
  if (!f.ok) return J({ ok: false, code: f.code, field: f.field, error: f.error }, 400);
  let r = null; try { r = await giftM(env).giftPaper(id, { uid: String(actor.id), ip: await k.ipHash(env, req), nick: f.v.nick, txt: f.v.txt }, Date.now()); } catch { r = null; }
  if (!r) return no('down', 503);
  if (!r.ok) return no(r.code, r.code === 'gone' ? 404 : 409);
  ONE.delete(id);
  return J({ ok: true, n: r.n, id: r.id });
}

// POST /rt/gift/<id>/seen { v, e }: a page beacon (sendBeacon). Kept in the isolate; nothing at hard. 204 always (it is a count).
async function seen(req, env, ctx, id, k) {
  const ok = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  if (req.method !== 'POST') return ok();
  if (!(await opsRate(env, req, 'gseen', 120, env.EVENT_RL))) return ok();
  const got = await readSmall(req, 400); const b = got.b || {};
  const e = String(b.e || ''); if (!VISITOR_ID.test(String(b.v || '')) || !SEEN_EV.has(e)) return ok();
  if (await hard(k, env)) return ok();
  seenAdd({ g: id, v: await visitorHash(env, b.v), e });
  seenFlush(env, ctx);
  return ok();
}

// POST /rt/gift/<id>/heart { v }: 💖 from this device (v: the page's random device id, hashed as for a view). No token, no account,
// no notice to anyone. The network's minute, budget hard (503 busy, no DO call), then it waits in the isolate with the beacons: the DO
// keeps one per device and board, only while the board's content is revealed, GIFT.heartNet per board, network and day. The answer
// cannot say whether it was counted (the page shows its own press); a heart on a board that is gone or not yet revealed is dropped there.
async function heart(req, env, ctx, id, k) {
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  if (!(await opsRate(env, req, 'gheart', 20))) return no('rate', 429);
  const got = await readSmall(req, 300); const b = got.b || {};
  if (!VISITOR_ID.test(String(b.v || ''))) return no('down', 400);
  if (await hard(k, env)) return no('busy', 503);
  seenAdd({ g: id, v: await visitorHash(env, b.v), e: 'heart', n: await k.ipHash(env, req) });
  seenFlush(env, ctx);
  return J({ ok: true });
}
// POST /rt/gift/start { r }: the maker form was shown (one per page load, the page decides). r: 1 when the maker came from another board
// (a kept ref or a reply): start_ref, as made_ref is to made. A daily count with the beacons; nothing at hard. 204 always.
async function startSeen(req, env, ctx, k) {
  const ok = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  if (req.method !== 'POST') return ok();
  if (!(await opsRate(env, req, 'gseen', 120, env.EVENT_RL))) return ok();
  const got = await readSmall(req, 200); const b = got.b || {};
  if (await hard(k, env)) return ok();
  seenAdd({ e: 'start', r: Number(b.r) === 1 ? 1 : 0 });
  seenFlush(env, ctx);
  return ok();
}

// POST /rt/gift/<id>/interest { act: 'view' | 'pick' | 'notify', t, consent }: the owner's preview only (E1). view and pick are anonymous
// daily totals; notify needs consent: true (the advertising consent the page asked for) and keeps the account against the tier.
async function interest(req, env, id, k) {
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const actor = await actorOf(req, k, env); if (!actor) return no('auth', 401);
  if (!(await opsRate(env, req, 'gint', 30))) return no('rate', 429);
  const got = await readSmall(req, 300); if (!got.b) return no('down', 400);
  const act = String(got.b.act || ''); if (!['view', 'pick', 'notify'].includes(act)) return no('down', 400);
  if (await hard(k, env)) return no('busy', 503);
  let r = null; try { r = await giftM(env).giftInterest(id, String(actor.id), act, Number(got.b.t), got.b.consent === true, Date.now()); } catch { r = null; }
  if (!r) return no('down', 503);
  if (!r.ok) return no(r.code, r.code === 'owner' ? 403 : r.code === 'gone' ? 404 : 400);
  return J({ ok: true });
}

// POST /rt/gift/<id>/report { m }: one per network per board or line. Three networks hide it (the admin can bring it back).
async function report(req, env, id, k) {
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  if (!(await opsRate(env, req, 'grep', 10))) return no('rate', 429);
  const got = await readSmall(req, 300); const b = got.b || {};
  if (await hard(k, env)) return no('busy', 503);
  let r = null; try { r = await giftM(env).giftReport(id, String(b.m || ''), await k.ipHash(env, req), Date.now()); } catch { r = null; }
  if (!r) return no('down', 503);
  if (!r.ok) return no(r.code, 404);
  ONE.delete(id); if (r.hidden) NOW.at = 0;
  return J({ ok: true, hidden: !!r.hidden });
}

// POST /rt/gift/<id>/delete: the owner takes it down (and its video).
async function remove(req, env, ctx, id, k) {
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const actor = await actorOf(req, k, env); if (!actor) return no('auth', 401);
  if (await actNo(k, env, actor.id)) return no('rate', 429);
  let r = null; try { r = await giftM(env).giftDel(id, String(actor.id)); } catch { r = null; }
  if (!r) return no('down', 503);
  if (!r.ok) return no(r.code, r.code === 'owner' ? 403 : 404);
  if (r.vid) mediaDrop(env, ctx, [id]);
  giftDrop(id);
  if (r.up) ONE.delete(r.up); // it may have been that board's reply: its owner's next read asks again
  return J({ ok: true });
}

// POST /rt/gift/<id>/video (body: the file; header x-ts: a Turnstile token while it is on). MEDIA absent: 501 nostore before the body is
// read. Then the owner's token, the account's minute, size by content-length, budget hard, Turnstile ('gvid'), the owner and the caps
// (one DO call that counts the attempt), the bytes (size, MP4 or WebM by their own header), R2, and the board's note (one DO call).
async function videoUp(req, env, ctx, id, k) {
  if (!mediaOn(env)) return no('nostore', 501);
  const actor = await actorOf(req, k, env); if (!actor) return no('auth', 401);
  if (await actNo(k, env, actor.id)) return no('rate', 429);
  if (Number(req.headers.get('content-length') || 0) > GIFT.video.max) return no('vsize', 413);
  if (await hard(k, env)) return no('busy', 503);
  const gate = k.humanGate ? await k.humanGate(env, req, { ts: req.headers.get('x-ts') || '' }, 'gvid') : null; if (gate) return gate;
  let r = null; try { r = await giftM(env).giftVidAsk(id, String(actor.id), await k.ipHash(env, req), Date.now()); } catch { r = null; }
  if (!r) return no('down', 503);
  if (!r.ok) return no(r.code, r.code === 'owner' ? 403 : r.code === 'gone' ? 404 : 429);
  const got = await readBytes(req, GIFT.video.max);
  if (got.big) return no('vsize', 413);
  if (!got.u8 || got.u8.length < GIFT.video.min) return no('vtype', 400);
  const t = videoKind(got.u8); if (!t) return no('vtype', 415);
  try { await env.MEDIA.put(vidKey(id), got.u8, { httpMetadata: { contentType: VIDEO_TYPE[t], cacheControl: 'public, max-age=86400' } }); } catch { return no('down', 503); }
  let s = null; try { s = await giftM(env).giftVidSet(id, String(actor.id), { t, n: got.u8.length }, Date.now()); } catch { s = null; }
  if (!s?.ok) { mediaDrop(env, ctx, [id]); return no('down', 503); }
  ONE.delete(id);
  return J({ ok: true, url: new URL('/rt/gift/' + id + '/video', req.url).href, t, n: got.u8.length });
}
// GET /rt/gift/<id>/video: from R2, with Range (phones fetch a video in parts). Only for a board that still shows (cached read).
async function videoGet(req, env, id, k) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method', { status: 405 });
  if (!mediaOn(env)) return new Response('none', { status: 404 });
  if (!(await opsRate(env, req, 'gvid', 240, env.EVENT_RL))) return new Response('rate', { status: 429, headers: { 'retry-after': '60' } });
  let g; try { g = await loadGift(env, k, id); } catch { return new Response('busy', { status: 503 }); }
  if (!g || !g.vid || giftPhase(g) === 'gone') return new Response('none', { status: 404 });
  const head = await Promise.resolve(env.MEDIA.head?.(vidKey(id))).catch(() => null);
  if (!head) return new Response('none', { status: 404 });
  const size = Number(head.size) || 0, rg = rangeOf(req.headers.get('range'), size);
  if (rg === 'bad') return new Response(null, { status: 416, headers: { 'content-range': 'bytes */' + size } });
  const obj = req.method === 'HEAD' ? null : await Promise.resolve(env.MEDIA.get(vidKey(id), rg ? { range: rg } : undefined)).catch(() => null);
  if (req.method !== 'HEAD' && !obj) return new Response('none', { status: 404 });
  const h = { 'content-type': head.httpMetadata?.contentType || VIDEO_TYPE[g.vid.t] || 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=86400', 'x-robots-tag': 'noindex' };
  if (head.httpEtag) h.etag = head.httpEtag;
  if (rg) { h['content-range'] = 'bytes ' + rg.offset + '-' + (rg.offset + rg.length - 1) + '/' + size; h['content-length'] = String(rg.length); }
  else h['content-length'] = String(size);
  return new Response(obj ? obj.body : null, { status: rg ? 206 : 200, headers: h });
}
// POST /rt/gift/<id>/card (JPEG the sender's page drew): the link preview's picture. GET /rt/gift/<id>/card.jpg serves it (else /og.jpg).
async function cardUp(req, env, id, k) {
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const actor = await actorOf(req, k, env); if (!actor) return no('auth', 401);
  if (await actNo(k, env, actor.id)) return no('rate', 429);
  if (await hard(k, env)) return no('busy', 503);
  const got = await readBytes(req, CARD_MAX);
  if (got.big || !got.u8 || got.u8.length < CARD_MIN || got.u8[0] !== 0xff || got.u8[1] !== 0xd8) return no('vtype', 400);
  let r = null; try { r = await giftM(env).giftCardPut(id, String(actor.id), got.u8, Date.now()); } catch { r = null; }
  if (!r) return no('down', 503);
  if (!r.ok) return no(r.code, 403);
  CARD.delete(id);
  return J({ ok: true });
}
const CARD = new Map(); // id -> { at, v: bytes | null }, 10 minutes per isolate, at most 60
async function cardGet(req, env, id, k) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method', { status: 405 });
  const og = () => Response.redirect(new URL('/og.jpg', req.url).href, 302);
  if (!(await opsRate(env, req, 'gcard', 240, env.EVENT_RL))) return og();
  const hit = CARD.get(id), now = Date.now();
  let v = hit && now - hit.at < 600000 ? hit.v : undefined;
  if (v === undefined) {
    if (await hard(k, env)) return og();
    try { v = await giftM(env).giftCardGet(id); } catch { v = null; }
    if (CARD.size >= 60) CARD.clear(); CARD.set(id, { at: now, v: v || null });
  }
  if (!v) return og();
  const bytes = v instanceof ArrayBuffer ? v : v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
  return new Response(req.method === 'HEAD' ? null : bytes, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=3600', 'x-robots-tag': 'noindex' } });
}

// The admin view (ADMIN_KEY). POST /rt/admin/gift/notify { text }: the "결제가 열렸어요" notice to the consented accounts, NOTIFY_N per call
// (the admin page calls again while left > 0): "(광고) " in front, refused 21:00-08:00 KST, one per account (whatever tiers it picked).
async function adminApi(req, env, ctx, u, k) {
  if (!k.adminOk(env, req)) return J({ err: 'admin' }, 401);
  const M = giftM(env), p = u.pathname, now = Date.now();
  try {
    if (p === '/rt/admin/gift' && req.method === 'GET') {
      const r = await M.giftAdmin('list', { day: u.searchParams.get('day') || '' }, now);
      if (r?.gone?.length) mediaDrop(env, ctx, r.gone);
      return J({ ...r, gone: undefined, media: mediaOn(env), e3: String(env.GIFT_E3 || '') === '1', tiers: TIERS.map((x) => ({ t: x.t, name: x.name, price: x.price })) });
    }
    if (p === '/rt/admin/gift/stats' && req.method === 'GET') return J(await M.giftAdmin('stats', { d0: u.searchParams.get('d0') || '', d1: u.searchParams.get('d1') || '' }, now));
    if (p === '/rt/admin/gift/hide' && req.method === 'POST') {
      const got = await readSmall(req, 500); if (!got.b) return J({ ok: false, error: '요청을 읽지 못했어요.' }, 400);
      const r = await M.giftAdmin('hide', got.b, now); if (r.ok) giftDrop(String(got.b.id || ''));
      return J(r, r.ok ? 200 : 400);
    }
    if (p === '/rt/admin/gift/notify' && req.method === 'POST') {
      const got = await readSmall(req, 800); const text = String(got.b?.text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!text) return J({ ok: false, error: '보낼 문구를 적어 주세요.' }, 400);
      if (quietNow(now)) return J({ ok: false, code: 'quiet', error: '광고성 알림은 밤 9시부터 아침 8시(한국 시간)까지 보내지 않아요.' }, 409);
      if (!k.pushNow) return J({ ok: false, error: '알림을 보낼 수 없어요.' }, 503);
      const r = await M.giftAdmin('notify', {}, now);
      await Promise.all((r.uids || []).map((uid) => k.pushNow(env, ctx, uid, { kind: 'giftopen', text: AD_LABEL + text })));
      return J({ ok: true, sent: (r.uids || []).length, left: r.left });
    }
  } catch { return J({ ok: false, error: '불러오지 못했어요.' }, 503); }
  return J({ err: 'not found' }, 404);
}

// Account link (/rt/auth/merge) and withdrawal (/rt/auth/withdraw), from worker.js's waitUntil.
export async function giftMove(env, from, to) { try { await giftM(env).giftMove(String(from || ''), String(to || '')); } catch { /* the boards stay with the guest id */ } }
export async function giftForget(env, uid, ctx) {
  let r = null; try { r = await giftM(env).giftForget(String(uid || '')); } catch { r = null; }
  if (r?.ids?.length) { for (const id of r.ids) giftDrop(id); await mediaDrop(env, ctx, r.ids); }
  if (r?.lines || r?.ids?.length) ONE.clear(); // their lines left other boards, their replies left the boards they answered: no copy here shows them
  return r;
}

// ---- the recipient page /g/<id> ------------------------------------------------------------------------------------------
// gift.html (a static file, also the maker at /gift) is the template: the Worker puts the link-preview meta and the board's public JSON
// into it, so a link preview (KakaoTalk, X) reads the right title and picture and the page needs no second request to start.
// noindex; the realtime room and the 3D plaza are never loaded here.
const SHELL = { at: 0, v: '' };
const META_BLOCK = /<!--GIFT_META-->[\s\S]*?<!--\/GIFT_META-->/;
async function shell(env, req) {
  const now = Date.now();
  if (SHELL.v && now - SHELL.at < 600000) return SHELL.v;
  try { const r = await env.ASSETS.fetch(new Request(new URL('/gift', req.url).href)); const t = r.ok ? await r.text() : ''; if (META_BLOCK.test(t) && t.includes('<!--GIFT_DATA-->')) { SHELL.v = t; SHELL.at = now; } } catch { /* fallback below */ }
  return SHELL.v || '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><!--GIFT_META--><!--/GIFT_META--></head><body><p><a href="/gift">선물 전광판</a></p><!--GIFT_DATA--></body></html>';
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029); // JSON may carry them; an inline script must not
const jsonTag = (o) => '<script id="gift-data" type="application/json">' + JSON.stringify(o).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029') + '</script>';
export async function giftPage(req, env, ctx, u, k) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method', { status: 405 });
  seenFlush(env, ctx);
  const id = u.pathname.slice(3).replace(/\/+$/, '');
  if (!GIFT_ID.test(id)) return Response.redirect(new URL('/gift', req.url).href, 302);
  if (!(await opsRate(env, req, 'gpage', 120, env.EVENT_RL))) return Response.redirect(new URL('/gift', req.url).href, 302);
  let g = null, down = false, h = false; try { ({ v: g, h } = await loadGiftH(env, k, id)); } catch { down = true; }
  const now = Date.now(), live = !!g && giftPhase(g, now) !== 'gone', origin = new URL(req.url).origin;
  // A link hit: a GET of this HTML for a board that is there, summed in the isolate as people or automated fetchers (botAgent: link
  // previews, crawlers, no User-Agent). Nothing about the request is kept and the answer does not wait. The sums ride on the next beacon
  // batch, or go by themselves once they have waited (hitsFlush: at most one DO call per GIFT.seenMs per isolate). Not at budget hard
  // (the level the read above asked anyway), nor while the store is down.
  if (req.method === 'GET' && !h && !down && live) hitAdd(botAgent(req.headers.get('user-agent')), now);
  if (!down) await hitsFlush(env, ctx, k, h);
  const view = live ? giftView(g, now) : null;
  const words = live ? giftShareText(view) : { title: down ? '잠시 뒤에 다시 열어 주세요 · WISH BOARD' : '선물 전광판 · WISH BOARD', text: down ? '지금은 광장이 붐벼요.' : '뉴욕 타임스퀘어를 본뜬 가상 광장에 친구를 위한 전광판을 6시간 무료로 걸어 보세요.' };
  const desc = live ? words.text + ' (' + windowText(view.a, view.b) + ')' : words.text;
  const img = live ? origin + '/rt/gift/' + id + '/card.jpg' : origin + '/og.jpg';
  const meta = '<title>' + esc(words.title) + '</title><meta name="robots" content="noindex, nofollow"><meta name="description" content="' + esc(desc) + '">'
    + '<meta property="og:type" content="website"><meta property="og:site_name" content="WISH BOARD"><meta property="og:title" content="' + esc(words.title) + '"><meta property="og:description" content="' + esc(desc) + '">'
    + '<meta property="og:url" content="' + esc(origin + '/g/' + id) + '"><meta property="og:image" content="' + esc(img) + '"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
    + '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' + esc(words.title) + '"><meta name="twitter:description" content="' + esc(desc) + '"><meta name="twitter:image" content="' + esc(img) + '">';
  const data = { id, gift: view, now, media: mediaOn(env), down: !!down, occ: live ? OCCASIONS[view.occ]?.name || '' : '', ...(h ? { hard: true } : {}) };
  const html = (await shell(env, req)).replace(META_BLOCK, meta).replace('<!--GIFT_DATA-->', jsonTag(data));
  return new Response(req.method === 'HEAD' ? null : html, { status: live ? 200 : down ? 503 : 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': live ? 'public, max-age=20' : 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'strict-origin-when-cross-origin' } });
}
