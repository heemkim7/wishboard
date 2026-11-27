// 선물 전광판 on the Worker: the /rt/gift* routes, the admin routes /rt/admin/gift*, the recipient page /g/<id>, the gift part of
// /rt/world and the Meter instance 'gift' (Durable Object SQLite, so no Supabase migration). worker.js imports this with no query,
// sends those paths here and hands over what it owns (k): adminOk, lvlNow, resolveActor, tokenOf, ipHash (the network hash, IPv6
// by /64), humanGate (Turnstile, only while it is switched on), humanSite (its public key, or ''), actOk (ACT_RL), pushNow (web push),
// rpc (Supabase RPC: grant_coins for the share reward and refunds, spend_plaza for the main tower minute), towerTell (the rooms' TOWER
// push) and towerLater (the same at a board's reveal, from the 'dark' alarm). Server only: .assetsignore keeps this file off the static assets.
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
//   gb(id, at, uid, ip, day, a, b, scr, st, lk, ref, n, v, vd, kids, rp, vid, j, re, hr, dc, pk)  boards; j: { to, from, occ, msg, th }; re:
//                                              the first 답장 전광판 (a board made with re: 1 whose ref is this one), '' when none; hr: 💖 count;
//                                              pk: the paid perks of its published orders (giftrules.js perksOf, '' when none; perkOn / perkOff).
//                                              re, hr, dc and pk are added to older stores
//   gm(g, id, at, uid, nick, txt, ip, st, rp)  롤링페이퍼 lines; uid: the writer (guest or account), ip: network hash (both only for caps and reports)
//   gv(g, v, at, dd, h)                        distinct visitors per board (v: a hash of the device's random id), dd: seen on the day, h: gave 💖
//   gd(d, k, n)                                daily counters (KST): made, made_ref, made_again, start, start_ref, view, view_day, return_day,
//                                              heart, hit, hitbot, msg, video, ladder, pick:t, ev:<beacon>, ...
//   gr(k, d, n)                                limits: per account / network and KST day, video uploads per board ('*')
//   gi(uid, t, at, sent)                       "열리면 알림" opt-ins (consented) per paid tier; sent: when the opening notice went
//   grp(g, m, ip)                              reports per board ('') or line (its id), one per network
//   gc(g, jpg, at)                             the link-preview card (JPEG the sender's device drew)
//   gn(g, net, at, paid)                       networks that reacted on a board's page (a checked 💖 or a 롤링페이퍼 line), once each; never the
//                                              maker's network or the maker's own line (towerrules.js reactCounts). paid: the share reward went
//   gt(m, day, g, how, uid, at, hold)          main tower minutes (메인 타워 축하 1분): one board a minute, one minute a board; day: m's KST day;
//                                              hold > 0: a points booking's place while spend_plaza runs (until then), 0: booked. A minute that
//                                              aired stays (the day's 30 counts it) until its day is over and its board is gone
//   ga(uid, day, how, at, g)                   a maker's bookings by KST day and board, kept TOWER.gapDays + 1 days (the 30 days between points)
//   gf(k, uid, m, g, why, at, done)            refunds grant_coins did not take, and spends whose answer was lost: whom the operator pays by hand
//                                              (the admin gift view only; never in a public read), kept 90 days
// 공유 보상 over gift pages, wish links and board links (towerrules.js SHARE; worker.js hands the wish and board parts over):
//   sl(k, net, o, at)                          link opens by a person (not a preview fetcher): content key ('w:<wish>' | 'c:<slot>'), the opener's
//                                              network hash, the content's owner then; kept SHARE.openKeepMs (2 days)
//   sm(uid, net, at)                           networks a maker made a gift board, posted a wish or claimed a board from: never a friend of that
//                                              maker; kept SHARE.makerKeepMs (30 days) from the last time
//   sk(k, o, net, at)                          link friends per wish / board and owner, for "친구 N명이 응원했어요" (gift boards count gn); kept 7 days
//   sf(uid, d, net, src, k, acct, amt, st, at) a maker's friends by KST day: one network once a day over every source (src g | w | c, k: the
//                                              board, wish or slot, at: when), acct: a linked account, amt: the step (0 past the steps), st: ''
//                                              counted (paid when amt > 0), 'unk' grant_coins gave no clear answer (its place kept), 'fail' a
//                                              clear refusal (unpaid, its place goes to the next friend), 'wait' left unpaid by the beacon batch's
//                                              TOWER.payMax (no place). The operator's list (/rt/admin/gift/share) reads it; kept SHARE.dayKeep days
//   sfr(uid, d, who)                           who already counted for that maker that day, on any network: 'a:<account or guest id>' or, for a
//                                              gift page 💖 sent without a token, 'v:<device hash>'; kept SHARE.dayKeep days
import { GIFT, GIFT_ID, PAPER_ID, VISITOR_ID, GIFT_ERR, giftFault, paperFault, pickScreen, screenLoad, nextFree, PERK, perksOf, longEnd, giftPhase, paperTakes, lockArm, giftView, giftShareText, refOf, kstDay, addDays, pruneDay, quietNow, AD_LABEL, videoKind, VIDEO_TYPE, rangeOf, windowText, OCCASIONS, TIERS, CER_BEACONS, REAL_BEACONS, MORE_BEACONS, ladderArm, heartsOpen, heartTakes, dayStart, botAgent, revealAt } from './giftrules.js';
import { TOWER, SHARE, shareAmount, linkFault, TOWER_HOW, SPEND_OLD, TOWER_ERR, reactCounts, towerFault, towerDays, towerEntry, towerMinutes } from './towerrules.js'; // 메인 타워 축하 1분 and the share reward
import { orderPerks } from './ordersrv.js'; // 메인 타워 주인공: the order ledger says whether a board's paid booking stands
import { opsRate } from './ops.js';

const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...h } });
const ERR = { ...GIFT_ERR, ...TOWER_ERR };
const no = (code, s = 400, extra = {}) => J({ ok: false, code, error: ERR[code] || GIFT_ERR.down, ...extra }, s);
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
    ref: String(r.ref || ''), re: String(r.re || ''), hr: Number(r.hr) || 0, dc: Number(r.dc) ? 1 : 0, n: Number(r.n) || 0, v: Number(r.v) || 0, vd: Number(r.vd) || 0, kids: Number(r.kids) || 0, rp: Number(r.rp) || 0,
    vid: v && v.t ? { t: String(v.t), n: Number(v.n) || 0, at: Number(v.at) || 0 } : null, pk: String(r.pk || ''),
    to: String(j.to || ''), from: String(j.from || ''), occ: String(j.occ || 'bday'), msg: String(j.msg || ''), th: String(j.th || '') };
};
const bump = (q, d, k, n = 1) => q.exec('insert into gd(d, k, n) values(?, ?, ?) on conflict(d, k) do update set n = n + excluded.n', d, k, n);
const lim = (q, k, d) => Number(q.exec('select n from gr where k = ? and d = ?', k, d).toArray()[0]?.n) || 0;
const limAdd = (q, k, d) => q.exec('insert into gr(k, d, n) values(?, ?, 1) on conflict(k, d) do update set n = n + 1', k, d);
// 메인 타워 축하 1분: a points booking holds its minute this long while the Worker spends (towerBook dry -> towerConfirm); then it lapses.
export const HOLD_MS = 30000;
const lapse = (q, now) => q.exec('delete from gt where hold > 0 and hold <= ?', now);
// When the board's words may reach anyone but its owner (giftrules.js revealAt), judged as if it were still live: a hidden ceremony board
// keeps its lighting as the reveal (cerStart reads nothing of a hidden board).
const revOf = (b) => (b ? revealAt({ ...b, st: 'live' }) : Infinity);
// This maker has a booking (or a hold) on that KST day / a points booking under TOWER.gapDays old or one being held now. exceptG: the
// board being booked (its own hold is not a second booking).
const mineOn = (q, uid, day) => q.exec('select 1 from ga where uid = ? and day = ? limit 1', uid, day).toArray().length > 0 || q.exec('select 1 from gt where uid = ? and day = ? limit 1', uid, day).toArray().length > 0;
function gapOf(q, uid, now) {
  const last = Number(q.exec("select max(at) t from ga where uid = ? and how = 'points'", uid).one().t) || 0;
  return (last > 0 && now - last < TOWER.gapDays * 864e5) || q.exec("select 1 from gt where uid = ? and how = 'points' and hold > ? limit 1", uid, now).toArray().length > 0;
}
// A board that goes takes its reply mark off the board it answered (a reply's ref is that board, so this is a key lookup, not a scan).
// Its main tower minute goes only if it has not started: one that aired still counts in its day's 30 (prune drops it once the day is over).
function dropBoards(q, ids, now = Date.now()) {
  for (const id of ids) for (const t of ['gm', 'gv', 'grp', 'gc', 'gn']) q.exec(`delete from ${t} where g = ?`, id);
  for (const id of ids) {
    q.exec('delete from gr where k = ?', 'vb:' + id); q.exec('delete from gr where k = ?', 'rn:' + id);
    q.exec('delete from gr where k = ?', 'to:' + id); // the friends' push went for this board
    q.exec('delete from gt where g = ? and m > ?', id, now); // its main tower minute not yet started (ga stays for the 30 days)
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
// hearts before its 'open' beacon arrived is seen here first (its later open then changes nothing). Taken from the making on (heartTakes:
// the friends of the main tower minute count before the day); the count is shown only once heartsOpen. -> true when it was counted.
function heartAdd(q, g, v, net, d, now) {
  if (!g || !heartTakes(g, now)) return false;
  const nk = 'h:' + g.id + ':' + net;
  if (!net || lim(q, nk, d) >= GIFT.heartNet) return false;
  visitAdd(q, g.id, v, g.day === d, d, now);
  if (q.exec('update gv set h = 1 where g = ? and v = ? and h = 0', g.id, v).rowsWritten < 1) return false;
  q.exec('update gb set hr = hr + 1 where id = ?', g.id); limAdd(q, nk, d); bump(q, d, 'heart');
  return true;
}
// 공유 보상: network net is a friend of maker uid today (src 'g' | 'w' | 'c', k the content). Once per maker, network and KST day over every
// source (sf), never a network the maker made or claimed from (sm); the n-th friend of the day (refused grants not counted) pays
// shareAmount(n, acct). pay: false (the beacon batch already handed TOWER.payMax to the Worker) keeps it unpaid.
// -> { uid, net, d, amt, src, g? } for the Worker to pay, or null.
const SHARE_PRUNE = 100;
const makerNet = (q, uid, net) => q.exec('select 1 from sm where uid = ? and net = ? limit 1', uid, net).toArray().length > 0;
// who: the person behind the reaction ('a:<id>' | 'v:<device hash>'): one person counts once a maker and day whatever network it comes from
// (sfr), so airplane mode or a VPN does not make a second friend.
function friendDay(q, o, now, pay = true) {
  const d = kstDay(now), uid = String(o.uid || ''), net = String(o.net || ''), src = String(o.src || ''), who = String(o.who || '');
  if (!uid || !net || makerNet(q, uid, net)) return null;
  if (who && q.exec('select 1 from sfr where uid = ? and d = ? and who = ? limit 1', uid, d, who).toArray().length) return null;
  if (q.exec("insert or ignore into sf(uid, d, net, src, k, acct, amt, st, at) values(?, ?, ?, ?, ?, ?, 0, ?, ?)", uid, d, net, src, String(o.k || ''), o.acct ? 1 : 0, pay ? '' : 'wait', now).rowsWritten < 1) return null;
  if (who) q.exec('insert or ignore into sfr(uid, d, who) values(?, ?, ?)', uid, d, who);
  bump(q, d, 'friend:' + src);
  if (!pay) return null;
  const n = Number(q.exec("select count(*) n from sf where uid = ? and d = ? and st in ('', 'unk')", uid, d).one().n) || 0, amt = shareAmount(n, !!o.acct);
  if (amt <= 0) return null;
  q.exec('update sf set amt = ? where uid = ? and d = ? and net = ?', amt, uid, d, net); bump(q, d, 'tpay'); bump(q, d, 'tpay_pt', amt);
  return { uid, net, d, amt, src, ...(src === 'g' ? { g: String(o.k) } : {}) };
}
// A friend reacted on g's page from network net (a 💖 counted just now, or a 롤링페이퍼 line). Once per board and network for good (gn);
// the maker's network and the maker's own account never (reactCounts). The share reward is friendDay's (acct: the friend is a linked
// account; who: the person, friendDay's); pay: false keeps a reaction unpaid. A network the maker made, posted or claimed from (sm) is no
// friend here either, so the count, the tower's 10 and the reward agree. The TOWER.friends-th network sends the maker one push (gr
// 'to:<board>', kept until the board goes). -> { pay?, open? } or null.
function react(q, g, net, uid, human, now, pay = true, acct = false, who = '') {
  if (!reactCounts(g, { net, uid, human }) || makerNet(q, g.uid, net)) return null;
  if (q.exec('insert or ignore into gn(g, net, at) values(?, ?, ?)', g.id, net, now).rowsWritten < 1) return null;
  const d = kstDay(now), out = {};
  bump(q, d, 'react');
  const p = friendDay(q, { uid: g.uid, net, src: 'g', k: g.id, acct, who }, now, pay);
  if (p) { q.exec('update gn set paid = 1 where g = ? and net = ?', g.id, net); out.pay = p; }
  const n = Number(q.exec('select count(*) n from gn where g = ?', g.id).one().n) || 0;
  if (n >= TOWER.friends && lim(q, 'to:' + g.id, '*') === 0) { limAdd(q, 'to:' + g.id, '*'); out.open = { uid: g.uid, g: g.id }; }
  return out;
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
// 오래 걸기: the screen board g can hang on until nb, from now on (or its start): its own while the other boards there leave room
// (GIFT.perScreen at once), else the least-loaded other one (giftrules.js pickScreen); '' when none.
function roomFor(q, g, nb, now) {
  const a = Math.max(Number(g.a), Math.min(Number(now), Number(g.b)));
  const rows = q.exec("select scr, a, b from gb where st = 'live' and id <> ? and b > ? and a < ?", g.id, a, nb).toArray().map((r) => ({ scr: String(r.scr), a: Number(r.a), b: Number(r.b) }));
  return screenLoad(rows, g.scr, a, nb) < GIFT.perScreen ? g.scr : pickScreen(rows, a, nb);
}
// gb.pk as an object { o: { <order id>: [perk keys] } } (an empty one for '' or a value that does not read).
const pkOf = (s) => { try { const j = JSON.parse(String(s || '')); if (j && j.o && typeof j.o === 'object' && !Array.isArray(j.o)) return { o: { ...j.o } }; } catch { /* none */ } return { o: {} }; };
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
    try { q.exec('alter table gb add column dc integer not null default 0'); } catch { /* column already exists */ } // DISCOVER opt-in (2026-11-27), off
    try { q.exec("alter table gb add column pk text not null default ''"); } catch { /* column already exists */ } // paid perks (2026-11-28)
    q.exec("create table if not exists gm(g text not null, id text not null, at integer not null, uid text not null, nick text not null, txt text not null, ip text not null, st text not null default 'live', rp integer not null default 0, primary key(g, id))");
    q.exec('create index if not exists gm_uid on gm(uid)');
    q.exec('create table if not exists gv(g text not null, v text not null, at integer not null, dd integer not null default 0, primary key(g, v))');
    try { q.exec('alter table gv add column h integer not null default 0'); } catch { /* column already exists */ } // this device gave 💖
    q.exec('create table if not exists gd(d text not null, k text not null, n integer not null, primary key(d, k))');
    q.exec('create table if not exists gr(k text not null, d text not null, n integer not null, primary key(k, d))');
    q.exec('create table if not exists gi(uid text not null, t integer not null, at integer not null, sent integer not null default 0, primary key(uid, t))');
    q.exec('create table if not exists grp(g text not null, m text not null, ip text not null, primary key(g, m, ip))');
    q.exec('create table if not exists gc(g text primary key, jpg blob not null, at integer not null)');
    q.exec('create table if not exists gn(g text not null, net text not null, at integer not null, paid integer not null default 0, primary key(g, net))');
    q.exec('create table if not exists gt(m integer primary key, day text not null, g text not null unique, how text not null, uid text not null, at integer not null, hold integer not null default 0)');
    q.exec('create index if not exists gt_day on gt(day)');
    q.exec('create index if not exists gt_uid on gt(uid)');
    q.exec('create table if not exists ga(uid text not null, day text not null, how text not null, at integer not null, g text not null, primary key(uid, day, g))');
    q.exec("create table if not exists gf(k integer primary key, uid text not null, m integer not null, g text not null, why text not null, at integer not null, done integer not null default 0)");
    q.exec('create table if not exists sl(k text not null, net text not null, o text not null, at integer not null, primary key(k, net))');
    q.exec('create index if not exists sl_at on sl(at)');
    q.exec('create table if not exists sm(uid text not null, net text not null, at integer not null, primary key(uid, net))');
    q.exec('create index if not exists sm_at on sm(at)');
    q.exec('create table if not exists sk(k text not null, o text not null, net text not null, at integer not null, primary key(k, o, net))');
    q.exec('create index if not exists sk_at on sk(at)');
    q.exec("create table if not exists sf(uid text not null, d text not null, net text not null, src text not null, k text not null, acct integer not null, amt integer not null default 0, st text not null default '', at integer not null, primary key(uid, d, net))");
    q.exec('create index if not exists sf_d on sf(d)');
    q.exec('create table if not exists sfr(uid text not null, d text not null, who text not null, primary key(uid, d, who))');
    q.exec('create index if not exists sfr_d on sfr(d)');
    q.exec('create index if not exists sfr_who on sfr(who)');
  },
  // 공유 보상's old rows, SHARE_PRUNE a table at a time (on the link-open path and with the other prunes): link opens, maker networks,
  // friends per content, and friend days past SHARE.dayKeep.
  sharePrune(q, now = Date.now()) {
    q.exec('delete from sl where rowid in (select rowid from sl where at < ? limit ?)', now - SHARE.openKeepMs, SHARE_PRUNE);
    q.exec('delete from sm where rowid in (select rowid from sm where at < ? limit ?)', now - SHARE.makerKeepMs, SHARE_PRUNE);
    q.exec('delete from sk where rowid in (select rowid from sk where at < ? limit ?)', now - SHARE.contentKeepMs, SHARE_PRUNE);
    q.exec('delete from sf where rowid in (select rowid from sf where d < ? limit ?)', addDays(kstDay(now), -SHARE.dayKeep), SHARE_PRUNE);
    q.exec('delete from sfr where rowid in (select rowid from sfr where d < ? limit ?)', addDays(kstDay(now), -SHARE.dayKeep), SHARE_PRUNE);
  },
  // A person opened a wish or board link (worker.js shareOpen). o: { k: 'w:<id>' | 'c:<slot>', o: its owner now, net }. -> { ok }.
  linkOpen(q, o, now = Date.now()) {
    const k = String(o?.k || ''), owner = String(o?.o || ''), net = String(o?.net || '');
    if (!/^[wc]:[\w-]{1,24}$/.test(k) || !owner || !/^[0-9a-f]{16}$/.test(net)) return { ok: false };
    q.exec('insert into sl(k, net, o, at) values(?, ?, ?, ?) on conflict(k, net) do update set o = excluded.o, at = excluded.at', k, net, owner, now);
    this.sharePrune(q, now);
    return { ok: true };
  },
  // A network the maker used to make or claim something (a gift board here in make; a wish post or a board claim from worker.js).
  makerNet(q, uid, net, now = Date.now()) {
    if (!String(uid || '') || !/^[0-9a-f]{16}$/.test(String(net || ''))) return { ok: false };
    q.exec('insert into sm(uid, net, at) values(?, ?, ?) on conflict(uid, net) do update set at = excluded.at', String(uid), String(net), now);
    return { ok: true };
  },
  // A 💖 on a wish or an 응원 on a board (worker.js shareReact). o: { o: the owner now, k, net, uid (who reacted), acct }. Counts only for a
  // link opened from that network within SHARE.windowMs while the same owner had it, never the owner's account or networks (linkFault);
  // then a friend of that content (sk) and of the owner's day (friendDay). A reaction with no such open writes nothing. -> { ok, pay?, why? }.
  share(q, o, now = Date.now()) {
    const owner = String(o?.o || ''), k = String(o?.k || ''), net = String(o?.net || '');
    if (!/^[wc]:/.test(k)) return { ok: false };
    const row = q.exec('select o, at from sl where k = ? and net = ?', k, net).toArray()[0];
    const nets = owner ? q.exec('select net from sm where uid = ?', owner).toArray().map((r) => String(r.net)) : [];
    const why = linkFault(row ? { o: String(row.o), at: Number(row.at) } : null, { owner, net, uid: String(o?.uid || ''), now, makerNets: nets });
    if (why) return { ok: true, why };
    q.exec('insert or ignore into sk(k, o, net, at) values(?, ?, ?, ?)', k, owner, net, now);
    const p = friendDay(q, { uid: owner, net, src: k[0], k: k.slice(2), acct: !!o?.acct, who: o?.uid ? 'a:' + String(o.uid) : '' }, now, true);
    return { ok: true, ...(p ? { pay: [p] } : {}) };
  },
  // How many link friends a wish or board has (its owner now), for its share page.
  shareCount(q, k, owner) { return Number(q.exec('select count(*) n from sk where k = ? and o = ?', String(k || ''), String(owner || '')).one().n) || 0; },
  // The operator's list: SHARE.adminDays KST days, per maker: friends, of them accounts, points paid, distinct networks, per source; the
  // SHARE.adminTop who got most first. Account and guest ids only here (the admin gate); never in a public read.
  shareTop(q, now = Date.now()) {
    const d0 = addDays(kstDay(now), -(SHARE.adminDays - 1));
    const top = q.exec(`select uid, count(*) friends, sum(acct) acct, sum(case when st = '' then amt else 0 end) paid, count(distinct net) nets,
      sum(case when src = 'g' then 1 else 0 end) g, sum(case when src = 'w' then 1 else 0 end) w, sum(case when src = 'c' then 1 else 0 end) c,
      sum(case when st = 'fail' then 1 else 0 end) fails, sum(case when st = 'unk' then 1 else 0 end) unknown, sum(case when st = 'wait' then 1 else 0 end) waits, count(distinct d) days
      from sf where d >= ? group by uid order by paid desc, friends desc, uid asc limit ?`, d0, SHARE.adminTop).toArray()
      .map((r) => ({ uid: String(r.uid), friends: Number(r.friends) || 0, acct: Number(r.acct) || 0, guest: (Number(r.friends) || 0) - (Number(r.acct) || 0), paid: Number(r.paid) || 0, nets: Number(r.nets) || 0,
        src: { g: Number(r.g) || 0, w: Number(r.w) || 0, c: Number(r.c) || 0 }, fails: Number(r.fails) || 0, unknown: Number(r.unknown) || 0, waits: Number(r.waits) || 0, days: Number(r.days) || 0 }));
    const t = q.exec("select count(*) friends, count(distinct uid) makers, sum(case when st = '' then amt else 0 end) paid from sf where d >= ?", d0).one();
    return { ok: true, days: SHARE.adminDays, from: d0, top, total: { friends: Number(t.friends) || 0, makers: Number(t.makers) || 0, paid: Number(t.paid) || 0 } };
  },
  // Boards whose day ended GIFT.keepDays ago go with their lines, visitors, reports and card; yesterday's limits, counters older than 400
  // days and opt-ins not renewed for GIFT.optinDays too. -> the ids whose video (if any) the Worker deletes from R2.
  prune(q, now = Date.now()) {
    const old = q.exec('select id from gb where day <= ? limit 200', pruneDay(now)).toArray().map((r) => String(r.id));
    if (old.length) dropBoards(q, old, now);
    const d = kstDay(now);
    q.exec("delete from gr where d < ? and d <> '*'", d);
    q.exec('delete from gd where d < ?', addDays(d, -400));
    q.exec('delete from gi where at < ?', now - GIFT.optinDays * 864e5);
    q.exec('delete from ga where at < ?', now - (TOWER.gapDays + 1) * 864e5); // a maker's bookings: the 30 days between point bookings need them
    q.exec('delete from gt where day < ? and g not in (select id from gb)', d); lapse(q, now); // aired minutes of boards that went, once their day is over
    q.exec('delete from gf where at < ?', now - 90 * 864e5);
    this.sharePrune(q, now);
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
    limAdd(q, 'u:' + o.uid, d); limAdd(q, 'n:' + o.ip, d); this.makerNet(q, o.uid, o.ip, now); // 공유 보상: never a friend of this maker
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
    row.fr = Number(q.exec('select count(*) n from gn where g = ?', row.id).one().n) || 0; // friends (networks that reacted): giftView shows it from the reveal
    const t = q.exec('select m, how from gt where g = ? and hold = 0', row.id).toArray()[0]; // its main tower minute: giftView shows only m, the owner's read how too
    if (t) row.tw = { m: Number(t.m), how: String(t.how) };
    if (withPaper) row.paper = q.exec("select id, nick, txt from gm where g = ? and st = 'live' order by at asc, rowid asc limit ?", row.id, GIFT.paper.max).toArray().map((r) => ({ id: String(r.id), nick: String(r.nick), txt: String(r.txt) }));
    return row;
  },
  // A 롤링페이퍼 line. o: { uid (the writer), ip, nick, txt, human (the route's 'gmsg' check passed, or Turnstile is off), acct (a linked account) }.
  // -> { ok: true, n, id, pay?, open? } | { ok: false, code }. pay / open: a friend's reaction (react), for the Worker to pay and tell.
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
    const rx = react(q, g, o.ip, o.uid, o.human !== false, now, true, !!o.acct, 'a:' + o.uid);
    return { ok: true, n: g.n + 1, id: mid, ...(rx?.pay ? { pay: [rx.pay] } : {}), ...(rx?.open ? { open: [rx.open] } : {}) };
  },
  // Page beacons, many boards in one call: [{ g, v (visitor hash), e }]. 'open' counts a distinct visitor per board (and, on the
  // board's own day, a distinct visitor that day and a returning one); every other event is a daily count only.
  // Also carried in the same call, with no board: { e: 'hit' | 'hitbot', d, n } (GETs of /g/<id> HTML, summed in the isolate per KST day)
  // and { e: 'start', r } (the maker form shown; r: 1 when it came from another board: start_ref). 'heart' ({ g, v, e, n: network hash})
  // is 💖: once per device and board for good (gv.h), from the making on (heartTakes), at most GIFT.heartNet per board, network and day.
  // A heart that counted is also a friend's reaction when t: 1 (Turnstile off, or its 'theart' check passed): react (u: the account that
  // pressed it when the page sent its token, a: 1 when that is a linked account, else a guest friend). -> { ok, n, pay?, open? }
  // (the share rewards and friends' pushes for the Worker, at most TOWER.payMax rewards a call).
  seen(q, items, now = Date.now()) {
    const d = kstDay(now), pay = [], open = []; let n = 0;
    heartPrune(q, d);
    for (const it of (Array.isArray(items) ? items : []).slice(0, SEEN_MAX)) { // the isolate sends at most SEEN_MAX a call
      const g = String(it?.g || ''), v = String(it?.v || ''), e = String(it?.e || '');
      if (e === 'hit' || e === 'hitbot') { const day = String(it?.d || ''), k = Math.floor(Number(it?.n)); if (/^\d{4}-\d{2}-\d{2}$/.test(day) && k > 0 && k <= 1e6) { bump(q, day, e, k); n++; } continue; }
      if (e === 'start') { bump(q, d, 'start'); if (Number(it?.r) === 1) bump(q, d, 'start_ref'); n++; continue; }
      if (!GIFT_ID.test(g) || !/^[0-9a-f]{16}$/.test(v) || !(SEEN_EV.has(e) || e === 'heart')) continue;
      const row = q.exec(e === 'heart' ? 'select * from gb where id = ?' : 'select day from gb where id = ?', g).toArray()[0];
      if (!row) continue;
      n++;
      if (e === 'heart') {
        const b = rowOf(row), net = String(it?.n || '');
        if (heartAdd(q, b, v, net, d, now)) {
          // at: when it was pressed (the route's clock), so a 💖 just before midnight is that day's friend even if its batch goes after
          const at = Math.floor(Number(it?.at)), t = at > 0 && at <= now && now - at < 864e5 ? at : now, u = String(it?.u || '');
          const rx = react(q, b, net, u, Number(it?.t) === 1, t, pay.length < TOWER.payMax, Number(it?.a) === 1, u ? 'a:' + u : 'v:' + v);
          if (rx?.pay) pay.push(rx.pay);
          if (rx?.open) open.push(rx.open);
        }
        continue;
      }
      if (e !== 'open') { bump(q, d, 'ev:' + e); continue; }
      visitAdd(q, g, v, String(row.day) === d, d, now);
    }
    return { ok: true, n, ...(pay.length ? { pay } : {}), ...(open.length ? { open } : {}) };
  },
  // A share reward grant_coins clearly refused (no wallet yet): that network stays a friend of the day, unpaid (st 'fail'), and its place
  // goes to the maker's next friend. g: the gift board ('' for a wish or board link). -> { ok }.
  payUndo(q, g, net, uid, d, now = Date.now()) {
    if (q.exec("update sf set amt = 0, st = 'fail' where uid = ? and d = ? and net = ? and st = '' and amt > 0", String(uid), String(d), String(net)).rowsWritten < 1) return { ok: false };
    if (g) q.exec('update gn set paid = 0 where g = ? and net = ? and paid = 1', String(g), String(net));
    bump(q, kstDay(now), 'tpay_fail');
    return { ok: true };
  },
  // One grant_coins gave no clear answer to (a timeout, a 5xx): it may have gone through, so its place stays taken (never paid twice) and the
  // operator sees it (st 'unk', tpay_unknown). -> { ok }.
  payUnknown(q, net, uid, d, now = Date.now()) {
    if (q.exec("update sf set st = 'unk' where uid = ? and d = ? and net = ? and st = '' and amt > 0", String(uid), String(d), String(net)).rowsWritten < 1) return { ok: false };
    bump(q, kstDay(now), 'tpay_unknown');
    return { ok: true };
  },
  // E1 on the owner's preview: act 'view' (the ladder was shown), 'pick' (tier t chosen) are daily totals only, never kept against the
  // account or the board (the page asks once per board). 'notify' (tier t, with the advertising consent) keeps the account against the
  // tier so the opening notice can reach its web push; asking again renews it. -> { ok }.
  // arm: { a, p } (giftrules.js ladderArm, the Worker's GIFT_ARMS): besides the old keys, 'ladder:<arm>:<kind>', 'pick:<t>:<arm>:<kind>:<price>'
  // and 'notify:<t>:<arm>:<kind>:<price>', kind 'me' (내 전광판) or 'g' (a gift), price the one that arm showed. An older Worker sends none: A.
  interest(q, id, uid, act, t, consent, now = Date.now(), arm = null) {
    const g = this.get(q, id, now, false);
    if (!g || giftPhase(g, now) === 'gone') return { ok: false, code: 'gone' };
    if (g.uid !== uid) return { ok: false, code: 'owner' };
    const d = kstDay(now), tier = Math.floor(Number(t)), kind = g.occ === 'me' ? 'me' : 'g';
    const A = /^[A-Z]$/.test(String(arm?.a || '')) && Array.isArray(arm?.p) && arm.p.length === 4 ? arm : { a: 'A', p: TIERS.map((x) => x.price) };
    const tag = (k) => k + ':' + tier + ':' + A.a + ':' + kind + ':' + (Math.floor(Number(A.p[tier])) || 0);
    if (act === 'view') { bump(q, d, 'ladder'); bump(q, d, 'ladder:' + A.a + ':' + kind); return { ok: true }; }
    if (!(tier >= 1 && tier <= 3)) return { ok: false, code: 'down' };
    if (act === 'pick') { bump(q, d, 'pick:' + tier); bump(q, d, tag('pick')); return { ok: true }; }
    if (act === 'notify') {
      if (consent !== true) return { ok: false, code: 'consent' };
      const had = q.exec('select 1 from gi where uid = ? and t = ?', uid, tier).toArray().length > 0;
      q.exec('insert into gi(uid, t, at, sent) values(?, ?, ?, 0) on conflict(uid, t) do update set at = excluded.at', uid, tier, now);
      if (!had) { bump(q, d, 'notify:' + tier); bump(q, d, tag('notify')); }
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
  // A report from one network on the board (m '') or one of its lines. GIFT.report networks hide it. -> { ok, hidden, off? } (off: its main
  // tower minute was let go, towerFree).
  report(q, id, m, ip, now = Date.now()) {
    const g = this.get(q, id, now, false); let off = null;
    if (!g) return { ok: false, code: 'gone' };
    const mid = PAPER_ID.test(String(m || '')) ? String(m) : '';
    if (mid && !q.exec('select 1 from gm where g = ? and id = ?', g.id, mid).toArray().length) return { ok: false, code: 'gone' };
    if (q.exec('insert or ignore into grp(g, m, ip) values(?, ?, ?)', g.id, mid, ip).rowsWritten < 1) return { ok: true, hidden: false };
    const n = Number(q.exec('select count(*) n from grp where g = ? and m = ?', g.id, mid).one().n) || 0;
    if (mid) { q.exec('update gm set rp = ? where g = ? and id = ?', n, g.id, mid); if (n >= GIFT.report) q.exec("update gm set st = 'hidden' where g = ? and id = ?", g.id, mid); }
    else { q.exec('update gb set rp = ? where id = ?', n, g.id); if (n >= GIFT.report) { q.exec("update gb set st = 'hidden' where id = ?", g.id); off = this.towerFree(q, g.id, now); } }
    bump(q, kstDay(now), 'report');
    return { ok: true, hidden: n >= GIFT.report, ...(off ? { off } : {}) };
  },
  // The owner takes the board down: it goes with everything of it. -> { ok, vid, up, off? } (vid: had a video to delete; up: the board it
  // was the reply of, whose copy in the Worker is now old; off: its main tower minute let go (towerFree)).
  del(q, id, uid, now = Date.now()) {
    const g = this.get(q, id, now, false);
    if (!g) return { ok: false, code: 'gone' };
    if (g.uid !== uid) return { ok: false, code: 'owner' };
    const off = this.towerFree(q, g.id, now);
    dropBoards(q, [g.id], now);
    return { ok: true, vid: !!g.vid, up: g.ref, ...(off ? { off } : {}) };
  },
  // Boards on the plaza now (the public copy /rt/world carries), at most GIFT.liveMax, earliest first. dc: 1 only on a board whose owner
  // turned DISCOVER on (/discover lists only those; the plaza shows every board up now, as before).
  live(q, now = Date.now()) {
    return q.exec("select * from gb where st = 'live' and a <= ? and b > ? order by a asc, id asc limit ?", now, now, GIFT.liveMax).toArray().map(rowOf)
      .map((g) => ({ id: g.id, to: g.to, from: g.from, occ: g.occ, msg: g.msg, th: g.th, scr: g.scr, a: g.a, b: g.b, n: g.n, ...(g.dc ? { dc: 1 } : {}) }));
  },
  // The owner's DISCOVER switch (default off): the board's name, line and sender may then be listed on /discover while it is up. -> { ok, dc }.
  discover(q, id, uid, on, now = Date.now()) {
    const g = this.get(q, id, now, false);
    if (!g || giftPhase(g, now) === 'gone') return { ok: false, code: 'gone' };
    if (g.uid !== uid) return { ok: false, code: 'owner' };
    const dc = on ? 1 : 0;
    if (q.exec('update gb set dc = ? where id = ? and dc <> ?', dc, g.id, dc).rowsWritten > 0) bump(q, kstDay(now), dc ? 'discover_on' : 'discover_off');
    return { ok: true, dc };
  },
  // Account link: the guest's boards, the lines it wrote and its opt-ins move to the account (running it again changes nothing).
  move(q, from, to) {
    if (!from || !to || from === to) return { ok: false };
    q.exec('update gb set uid = ? where uid = ?', to, from);
    q.exec('update gm set uid = ? where uid = ?', to, from);
    q.exec('update or ignore gi set uid = ? where uid = ?', to, from); q.exec('delete from gi where uid = ?', from); // the account's own opt-in for a tier wins
    q.exec('update gt set uid = ? where uid = ?', to, from); // its main tower minutes
    // Its booking records, each by board: both accounts' records of a day are kept, so a points booking's 30 days survive the link.
    q.exec('update or ignore ga set uid = ? where uid = ?', to, from); q.exec('delete from ga where uid = ?', from);
    // 공유 보상: the guest's own networks, its friend days (the account's row of a day and network wins), its links' opens and friends, and
    // the guest as someone's friend (sfr who).
    for (const [t, c] of [['sm', 'uid'], ['sf', 'uid'], ['sfr', 'uid'], ['sl', 'o'], ['sk', 'o']]) { q.exec(`update or ignore ${t} set ${c} = ? where ${c} = ?`, to, from); q.exec(`delete from ${t} where ${c} = ?`, from); }
    q.exec('update or ignore sfr set who = ? where who = ?', 'a:' + to, 'a:' + from); q.exec('delete from sfr where who = ?', 'a:' + from);
    return { ok: true };
  },
  // Withdrawal: the account's boards with every line on them, the lines it wrote on other boards (those boards' counts follow), its
  // opt-ins, its main tower bookings (no points back: the wallet goes). A minute that aired stays in its day's 30 with no account on it.
  // -> { ok, ids, offs } (ids: the boards gone, whose videos the Worker deletes from R2; offs: [{ id, m }] its minutes not over yet whose board
  // the plazas already know (revealed): the Worker tells the rooms to drop them).
  forget(q, uid, now = Date.now()) {
    if (!uid) return { ok: false, ids: [], offs: [] };
    const offs = q.exec('select t.m tm, t.g tg, b.* from gt t left join gb b on b.id = t.g where t.uid = ? and t.hold = 0 and t.m + ? > ?', uid, TOWER.minMs, now).toArray()
      .filter((r) => r.id != null && now >= revOf(rowOf(r))).map((r) => ({ id: String(r.tg), m: Number(r.tm) }));
    const ids = q.exec('select id from gb where uid = ?', uid).toArray().map((r) => String(r.id));
    if (ids.length) dropBoards(q, ids, now);
    const touched = q.exec('select distinct g from gm where uid = ?', uid).toArray().map((r) => String(r.g));
    q.exec('delete from gm where uid = ?', uid);
    for (const g of touched) recount(q, g);
    q.exec('delete from gi where uid = ?', uid);
    q.exec('delete from ga where uid = ?', uid); q.exec('delete from gt where uid = ? and m > ?', uid, now); q.exec("update gt set uid = '' where uid = ?", uid);
    q.exec("update gf set uid = '' where uid = ? and done = 1", uid); // a refund still owed keeps whom it is owed to (the operator decides)
    for (const [t, c] of [['sm', 'uid'], ['sf', 'uid'], ['sfr', 'uid'], ['sl', 'o'], ['sk', 'o']]) q.exec(`delete from ${t} where ${c} = ?`, uid); // 공유 보상's rows of this maker
    q.exec('delete from sfr where who = ?', 'a:' + uid); // and of this account as someone's friend
    return { ok: true, ids, lines: touched.length, offs };
  },
  // ---- paid perks (ordersrv.js: an order of payrules.js PRODUCTS for this board; giftrules.js PERK) ----
  // Before an order is made: can board id (the buyer uid's, still up) take these perks? long: a screen for GIFT.paidHours from its start;
  // tower: a main tower minute still open in that window with a place left that day. -> { ok, kind, ref } (kind: the product kind, personal
  // for a 내 전광판; ref: the board it was made from) | { ok: false, code: 'board' | 'late' | 'full' | 'tower' }.
  perkFit(q, id, uid, gives = [], now = Date.now()) {
    const g = this.get(q, id, now, false), want = (Array.isArray(gives) ? gives : []).map(String);
    if (!g || giftPhase(g, now) === 'gone' || g.uid !== String(uid)) return { ok: false, code: 'board' };
    const has = perksOf(g.pk), nb = want.includes(PERK.long) && !has.includes(PERK.long) ? Math.max(g.b, longEnd(g)) : g.b;
    if (now >= nb) return { ok: false, code: 'late' };
    if (nb > g.b && !roomFor(q, g, nb, now)) return { ok: false, code: 'full' };
    if (want.includes(PERK.tower) && !q.exec('select 1 from gt where g = ? and hold = 0', g.id).toArray().length) {
      lapse(q, now);
      const w = { ...g, b: nb }, taken = q.exec('select m from gt where m >= ? and m < ?', w.a, w.b).toArray().map((r) => Number(r.m)), left = {};
      for (const day of towerDays(w)) left[day] = TOWER.perDay - (Number(q.exec('select count(*) n from gt where day = ?', day).one().n) || 0);
      if (!towerMinutes(w, now, taken).some((x) => x.why === '' && (left[kstDay(x.m)] ?? 0) > 0)) return { ok: false, code: 'tower' };
    }
    return { ok: true, kind: g.occ === 'me' ? 'personal' : 'gift', ref: g.ref };
  },
  // Publishing order `order` (paid): its perks go on the board, once (a second call for the same order changes nothing). long: the window
  // ends GIFT.paidHours after its start, on its own screen or, when that one is full then, on the least-loaded free one (the plaza follows
  // the board's scr); clean: the films without the watermark (giftView clean); tower: the main tower minute by how 'paid' (towerBook asks the
  // order ledger too). -> { ok, b, scr, moved } | { ok: false, why: 'gone' | 'owner' | 'late' | 'full' }.
  perkOn(q, id, uid, order, gives = [], now = Date.now()) {
    const g = this.get(q, id, now, false);
    if (!g || giftPhase(g, now) === 'gone') return { ok: false, why: 'gone' };
    if (g.uid !== String(uid)) return { ok: false, why: 'owner' };
    const pk = pkOf(g.pk), key = String(order || '');
    if (!key) return { ok: false, why: 'order' };
    if (pk.o[key]) return { ok: true, again: true, b: g.b, scr: g.scr, moved: false };
    const want = (Array.isArray(gives) ? gives : []).map(String).filter((x) => Object.hasOwn(PERK, x));
    let b = g.b, scr = g.scr;
    if (want.includes(PERK.long) && longEnd(g) > g.b) {
      if (now >= longEnd(g)) return { ok: false, why: 'late' };
      scr = roomFor(q, g, longEnd(g), now); if (!scr) return { ok: false, why: 'full' };
      b = longEnd(g);
    }
    pk.o[key] = want;
    q.exec('update gb set b = ?, scr = ?, pk = ? where id = ?', b, scr, JSON.stringify(pk), g.id);
    bump(q, kstDay(now), 'perk_on');
    return { ok: true, b, scr, moved: scr !== g.scr };
  },
  // A refund of order `order`: its perks come off. Without long any more the window is GIFT.hours again (a board already past that comes
  // down now); a booked main tower minute that has not started goes when it was paid ('paid', no points: it was money) and the tower perk is
  // gone, or when the shorter window no longer holds it (towerFree: points back for a points booking). -> { ok, b, off? } (off: towerFree's).
  perkOff(q, id, order, now = Date.now()) {
    const g = rowOf(q.exec('select * from gb where id = ?', String(id || '')).toArray()[0]), key = String(order || '');
    if (!g) return { ok: true, none: true };
    const pk = pkOf(g.pk); if (!pk.o[key]) return { ok: true, none: true };
    delete pk.o[key];
    const left = perksOf(pk), base = g.a + GIFT.hours * 36e5;
    const b = !left.includes(PERK.long) && g.b > base ? Math.max(base, Math.min(g.b, now)) : g.b;
    const t = q.exec('select m, how from gt where g = ? and hold = 0', g.id).toArray()[0];
    const drop = t && Number(t.m) > now && ((String(t.how) === 'paid' && !left.includes(PERK.tower)) || Number(t.m) + TOWER.minMs > b);
    const off = drop ? this.towerFree(q, g.id, now) : null;
    q.exec('update gb set b = ?, pk = ? where id = ?', b, Object.keys(pk.o).length ? JSON.stringify(pk) : '', g.id);
    bump(q, kstDay(now), 'perk_off');
    return { ok: true, b, ...(off ? { off } : {}) };
  },
  // ---- 메인 타워 축하 1분 (towerrules.js) ----
  // The owner's card: the booking, each window day's places left (holds count) and whether this maker has one that day, the taken minutes of
  // the window (holds too), the friends so far, and whether a points booking of this account is under TOWER.gapDays old (or held now).
  towerState(q, g, uid, now = Date.now()) {
    lapse(q, now);
    const t = q.exec('select m, how from gt where g = ? and hold = 0', g.id).toArray()[0], days = {};
    for (const day of towerDays(g)) {
      const n = Number(q.exec('select count(*) n from gt where day = ?', day).one().n) || 0;
      days[day] = { left: Math.max(0, TOWER.perDay - n), mine: mineOn(q, uid, day) };
    }
    const taken = q.exec('select m from gt where m >= ? and m < ? order by m', g.a, g.b).toArray().map((r) => Number(r.m));
    const friends = Number(q.exec('select count(*) n from gn where g = ?', g.id).one().n) || 0;
    return { tw: t ? { m: Number(t.m), how: String(t.how) } : null, days, taken, friends, need: TOWER.friends, gap: gapOf(q, uid, now), paid: perksOf(g.pk).includes(PERK.tower) };
  },
  // The owner's read. With a booking it also carries entry and rev (what the plaza gets, and when it may: the Worker's own use after a
  // write it could not hear back from; towerRead never passes them on).
  towerGet(q, id, uid, now = Date.now()) {
    const g = this.get(q, id, now, false);
    if (!g || giftPhase(g, now) === 'gone') return { ok: false, code: 'gone' };
    if (g.uid !== uid) return { ok: false, code: 'owner' };
    const s = this.towerState(q, g, uid, now);
    return { ok: true, ...s, ...(s.tw ? { entry: towerEntry(g, s.tw.m), rev: revOf(g) } : {}) };
  },
  // A booking of minute o.m by o.how ('friends' | 'points' | 'paid'); o.guest: the asker is a guest or an anonymous login; o.paid: the Worker
  // found a published 메인 타워 주인공 order of this board bought by this account (ordersrv.js orderPerks). One synchronous method, so
  // two asks for one minute never both pass. dry (the points path, before it spends): the same checks, then the minute is held for this
  // account for HOLD_MS (it counts in the day's 30 and nobody else can take it; towerConfirm books it, towerUnhold or the time lets it go).
  // A retry replaces this account's own hold on the board. -> { ok, tw, entry, rev } | { ok, hold } (dry) | { ok: false, code, taken, days }.
  towerBook(q, id, uid, o = {}, now = Date.now(), dry = false) {
    lapse(q, now);
    const g = this.get(q, id, now, false), m = Number(o.m), how = String(o.how || '');
    if (g && g.uid === uid) q.exec('delete from gt where g = ? and uid = ? and hold > 0', g.id, uid);
    const day = g && Number.isSafeInteger(m) && m >= g.a && m < g.b ? kstDay(m) : ''; // the window first: a minute far outside it is never a date
    const s = g && g.uid === uid ? this.towerState(q, g, uid, now) : null;
    const dayN = day ? Number(q.exec('select count(*) n from gt where day = ?', day).one().n) || 0 : 0;
    const code = towerFault({ g, uid, how, m, now, guest: !!o.guest, boardHas: !!s?.tw, taken: day ? q.exec('select 1 from gt where m = ?', m).toArray().length > 0 : false,
      dayN, mine: day ? mineOn(q, uid, day) : false, gap: !!s?.gap, friends: s?.friends || 0, paid: !!o.paid && !!s?.paid });
    if (code) return { ok: false, code, ...(s ? { taken: s.taken, days: s.days } : {}) };
    try { q.exec('insert into gt(m, day, g, how, uid, at, hold) values(?, ?, ?, ?, ?, ?, ?)', m, day, g.id, how, uid, now, dry ? now + HOLD_MS : 0); }
    catch { return { ok: false, code: 'taken', taken: s.taken, days: s.days }; }
    if (dry) return { ok: true, hold: now + HOLD_MS };
    q.exec('insert or replace into ga(uid, day, how, at, g) values(?, ?, ?, ?, ?)', uid, day, how, now, g.id);
    bump(q, kstDay(now), 'tower:' + how);
    return { ok: true, tw: { m, how }, entry: towerEntry(g, m), rev: revOf(g) };
  },
  // The spend went through: the held minute is booked. A hold that lapsed meanwhile is booked afresh if every check still passes (else the
  // Worker pays back). -> as towerBook.
  towerConfirm(q, id, uid, m, now = Date.now()) {
    lapse(q, now);
    const t = q.exec('select day from gt where m = ? and g = ? and uid = ? and hold > 0', Number(m), String(id), String(uid)).toArray()[0];
    if (!t) return this.towerBook(q, id, uid, { m, how: 'points' }, now);
    const g = this.get(q, id, now, false);
    if (!g || giftPhase(g, now) === 'gone') { q.exec('delete from gt where m = ? and hold > 0', Number(m)); return { ok: false, code: 'gone' }; }
    q.exec('update gt set hold = 0, at = ? where m = ?', now, Number(m));
    q.exec('insert or replace into ga(uid, day, how, at, g) values(?, ?, ?, ?, ?)', String(uid), String(t.day), 'points', now, g.id);
    bump(q, kstDay(now), 'tower:points');
    return { ok: true, tw: { m: Number(m), how: 'points' }, entry: towerEntry(g, Number(m)), rev: revOf(g) };
  },
  // Nothing was spent (too few points, not ready, a refusal): the hold goes now. -> { ok }.
  towerUnhold(q, id, uid, m) { q.exec('delete from gt where m = ? and g = ? and uid = ? and hold > 0', Number(m), String(id), String(uid)); return { ok: true }; },
  // A board was hidden or deleted. A booking whose minute has not started is let go: the minute and the maker's record for that day go
  // (off.pay: points come back). One on the tower now stays booked, aired, and the plazas drop it (pay: false). tell: the plazas know the
  // board (revealed), so the rooms are told; before the reveal nobody but the owner has heard of it. -> { uid, how, m, pay, tell } or null.
  towerFree(q, gid, now = Date.now()) {
    const t = q.exec('select m, day, how, uid from gt where g = ? and hold = 0', String(gid)).toArray()[0];
    if (!t) return null;
    const m = Number(t.m), tell = now >= revOf(rowOf(q.exec('select * from gb where id = ?', String(gid)).toArray()[0]));
    if (m > now) {
      q.exec('delete from gt where g = ?', String(gid)); q.exec('delete from ga where uid = ? and day = ? and g = ?', String(t.uid), String(t.day), String(gid));
      bump(q, kstDay(now), 'tower_free');
      return { uid: String(t.uid), how: String(t.how), m, pay: String(t.how) === 'points', tell };
    }
    return now < m + TOWER.minMs ? { uid: String(t.uid), how: String(t.how), m, pay: false, tell } : null;
  },
  // /rt/world's tower: booked minutes of live boards starting in the next TOWER.worldAhead (or in their minute now), earliest first, only
  // those whose board is revealed (a board's words reach nobody but its owner before revealAt). soon: the next reveal among the rest (the
  // isolate's copy is read again then). -> { list, soon }.
  towerLive(q, now = Date.now()) {
    const rows = q.exec("select t.m tm, b.* from gt t join gb b on b.id = t.g where t.hold = 0 and b.st = 'live' and t.m + ? > ? and t.m < ? order by t.m asc limit ?", TOWER.minMs, now, now + TOWER.worldAhead, TOWER.worldMax).toArray();
    const list = [], later = [];
    for (const r of rows) { const b = rowOf(r), rev = revOf(b); if (now >= rev) list.push(towerEntry(b, Number(r.tm))); else later.push(rev); }
    return { list, soon: later.length ? Math.min(...later) : 0 };
  },
  worldRead(q, now = Date.now()) { const t = this.towerLive(q, now); return { gifts: this.live(q, now), tower: t.list, ...(t.soon ? { soon: t.soon } : {}) }; },
  // The 'dark' alarm at a board's reveal: the entry to tell the rooms, if the minute is still booked, the board live and revealed, and the
  // minute not over. -> entry | null.
  towerEntryAt(q, id, m, now = Date.now()) {
    const t = q.exec('select m from gt where m = ? and g = ? and hold = 0', Number(m), String(id)).toArray()[0];
    const b = t ? rowOf(q.exec("select * from gb where id = ? and st = 'live'", String(id)).toArray()[0]) : null;
    return b && now >= revOf(b) && now < Number(m) + TOWER.minMs ? towerEntry(b, Number(m)) : null;
  },
  // A refund grant_coins did not take, or a spend whose answer never came (why 'unknown': it may or may not have gone through): one row for
  // the operator (the admin gift view lists it; /rt/admin/coins pays it) and a daily total.
  refundFail(q, o = {}, now = Date.now()) {
    q.exec('insert into gf(uid, m, g, why, at) values(?, ?, ?, ?, ?)', String(o.uid || ''), Math.floor(Number(o.m)) || 0, String(o.g || ''), String(o.why || '').slice(0, 16), now);
    bump(q, kstDay(now), o.why === 'unknown' ? 'tower_spend_unknown' : 'tower_refund_fail'); return { ok: true };
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
      // The refunds the operator owes by hand (newest first): the admin gift view only.
      const refunds = q.exec('select k, uid, m, g, why, at, done from gf order by at desc limit 100').toArray().map((r) => ({ k: Number(r.k), uid: String(r.uid), m: Number(r.m), g: String(r.g), why: String(r.why), at: Number(r.at), done: Number(r.done) ? 1 : 0, amount: TOWER.price }));
      return { ok: true, day, boards: rows, gone, refunds };
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
    if (op === 'share') return this.shareTop(q, now);
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
      // Hiding a board lets go of its main tower minute (towerFree); bringing it back does not book it again.
      const off = n && !m && st === 'hidden' ? this.towerFree(q, id, now) : null;
      return n ? { ok: true, ...(off ? { off } : {}) } : { ok: false, error: '그 선물 전광판(또는 메시지)이 없어요.' };
    }
    if (op === 'refund') { // the operator paid one by hand (/rt/admin/coins) and marks it
      const n = q.exec('update gf set done = ? where k = ?', arg.done === false ? 0 : 1, Math.floor(Number(arg.k)) || 0).rowsWritten;
      return n ? { ok: true } : { ok: false, error: '그 줄이 없어요.' };
    }
    return { ok: false, error: 'op' };
  },
};
// reply: the recipient page's 답장 button; cer, cershot (점등식): a device came to a ceremony, it saved or shared the group photo.
// share: the owner's 공유하기; reshare: a visitor's 🔗 공유하기 on the recipient page (its own key, ev:reshare). real_*: 실사 축하 영상.
// signup_nudge, signup_from_gift, card_save (MORE_BEACONS): the account nudge tapped, a sign-in that came back to the page, the card saved.
const SEEN_EV = new Set(['open', 'film', 'play', 'done', 'save', 'go', 'share', 'reshare', 'cta', 'reply', 'paper_open', ...CER_BEACONS, ...REAL_BEACONS, ...MORE_BEACONS]);

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
// /rt/world's gifts and main tower bookings: one DO call per isolate per 2 minutes at most (5 while there is neither), and again at the next
// board reveal the last read named (soon: a booked minute whose board was not revealed yet is left out until then); at hard the last copy;
// a failed read keeps the last copy. A board made (or a minute booked) in this isolate shows at once; one in another isolate within that
// time (the rooms' TOWER push tells the plaza sooner). -> { gifts, tower } or null while there is neither.
const NOW = { at: 0, v: null }, NOW_TTL = 120000, NOW_IDLE = 300000;
const NOW_NONE = () => ({ gifts: [], tower: [] });
export async function giftWorld(env, k) {
  const now = Date.now(), busy = !!(NOW.v && (NOW.v.gifts?.length || NOW.v.tower?.length)), due = Number(NOW.v?.soon) > 0 && now >= Number(NOW.v.soon);
  if (now - NOW.at >= (busy ? NOW_TTL : NOW_IDLE) || now < NOW.at || due) {
    if (!(await hard(k, env))) { try { NOW.v = await giftM(env).giftWorldRead(now); NOW.at = now; } catch { NOW.v = { ...(NOW.v || NOW_NONE()), soon: 0 }; NOW.at = now; } } // a failed read waits its turn, not each request
    else if (!NOW.v) { NOW.v = NOW_NONE(); NOW.at = now; } // hard with no copy yet: nothing shown, no DO call, asked again in a minute
  }
  const gifts = (NOW.v?.gifts || []).filter((g) => g.a <= now && g.b > now), tower = (NOW.v?.tower || []).filter((e) => e.m + TOWER.minMs > now);
  return gifts.length || tower.length ? { gifts, tower } : null;
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
  // A failed DO call puts the items back; what the answer hands over to pay (share rewards, the friends' push) never does (payOut never
  // throws, and a reward is never paid twice). The batch's promise waits for the payouts too.
  SEEN.p = Promise.resolve().then(() => giftM(env).giftSeen(items, now))
    .then((r) => payOut(env, ctx, KIT, r), () => { const back = items.filter((it) => !it.re).map((it) => ({ ...it, re: 1 })); if (back.length) { SEEN.list = [...back, ...SEEN.list].slice(0, SEEN_CAP); SEEN.at = SEEN.at || now; } })
    .finally(() => { SEEN.p = null; });
  try { ctx?.waitUntil?.(SEEN.p); } catch { /* tests */ }
  return SEEN.p;
}
// Hits waiting longer than GIFT.seenMs with no beacon to carry them. h: the budget level this request already knows (giftPage), else asked
// here, and only when they are due (so an ordinary request asks nothing more). Synchronous for the caller: the budget check and the call
// run in ctx.waitUntil, so the answer is never built after them. The interval is taken before the check (one try per GIFT.seenMs per
// isolate, sent or not). -> the job (tests), or null when nothing was due.
function hitsFlush(env, ctx, k, h) {
  const now = Date.now();
  if (SEEN.p || !HITS.size || !HIT.at || now - HIT.at < GIFT.seenMs || (now - HIT.last < GIFT.seenMs && now >= HIT.last)) return null;
  HIT.last = now;
  const job = Promise.resolve().then(async () => { if (h ?? (await hard(k, env))) return; await seenFlush(env, ctx, true); }).catch(() => { });
  try { ctx?.waitUntil?.(job); } catch { /* tests */ }
  return job;
}
export const giftSeenFlush = (env, ctx) => seenFlush(env, ctx, true); // tests
// The kit of the request that came last (worker.js giftKit): a beacon batch runs after its request answered, and pays out with it.
let KIT = null;
// Share rewards (p.amt by grant_coins, to the maker's actor id: an account or a guest id) and the friends' push from one DO answer
// ({ pay, open }), in waitUntil. A grant that fails (no wallet yet, no answer) is undone in the DO (one more call, only then): the friend
// stays unpaid and the maker's day keeps its place. A reward is never paid twice. Never throws. -> the job, or null when nothing was due.
function payOut(env, ctx, k, r) {
  try {
    const jobs = [];
    for (const o of Array.isArray(r?.open) ? r.open : []) if (k?.pushNow) jobs.push(k.pushNow(env, ctx, o.uid, { kind: 'gifttower', gid: o.g }));
    for (const p of Array.isArray(r?.pay) ? r.pay.slice(0, TOWER.payMax) : []) {
      jobs.push(Promise.resolve().then(async () => {
        const amt = Math.floor(Number(p.amt)); if (!(amt > 0)) return;
        const res = k?.rpc ? await k.rpc('grant_coins', { p_key: env.FLUSH_KEY || '', p_actor_id: p.uid, p_amount: amt }).catch(() => null) : null;
        if (res?.ok && res.data?.ok === true) return;
        // Only a clear refusal gives the place back; no answer (it may have been paid) keeps it and is marked for the operator. A throw here
        // leaves the row as paid: the day loses one place, never pays twice.
        if (res?.ok && res.data?.ok === false) await giftM(env).giftPayUndo(p.g || '', p.net, p.uid, p.d);
        else await giftM(env).giftPayUnknown(p.net, p.uid, p.d);
      }).catch(() => { }));
    }
    if (!jobs.length) return null;
    const job = Promise.all(jobs).catch(() => { });
    try { ctx?.waitUntil?.(job); } catch { /* tests */ }
    return job;
  } catch { return null; }
}
export const giftSeenState = () => ({ list: SEEN.list.length, hits: HITS.size, busy: !!SEEN.p }); // tests

// ---- 공유 보상 on wish and board links (worker.js calls these; env is the tallied one on HTTP paths, a Room counts its own call) ----------
// shareOpen: a person (worker.js linkWho) opened /rt/w/<id> or /rt/card/<slot>: one DO write, in waitUntil, the same network and link once
// per OPEN_GAP per isolate. The caller has checked the budget level (nothing at hard). -> the job or null.
const OPENED = new Map(), OPEN_GAP = 600000;
export function shareOpen(env, ctx, o) {
  try {
    const key = String(o?.k || '') + '|' + String(o?.net || ''), now = Date.now(), at = OPENED.get(key);
    if (!o?.o || !o?.net || (at && now - at < OPEN_GAP && now >= at)) return null;
    OPENED.delete(key); if (OPENED.size >= 2000) OPENED.delete(OPENED.keys().next().value); OPENED.set(key, now);
    const job = Promise.resolve().then(() => giftM(env).giftLinkOpen({ k: String(o.k), o: String(o.o), net: String(o.net) }, now)).catch(() => { OPENED.delete(key); });
    try { ctx?.waitUntil?.(job); } catch { /* tests */ }
    return job;
  } catch { return null; }
}
// shareMaker: the maker made or claimed something from this network (a wish post, a board claim): one DO write in waitUntil.
export function shareMaker(env, ctx, uid, net) {
  try {
    if (!uid || !net) return null;
    const job = Promise.resolve().then(() => giftM(env).giftMakerNet(String(uid), String(net), Date.now())).catch(() => { });
    try { ctx?.waitUntil?.(job); } catch { /* tests */ }
    return job;
  } catch { return null; }
}
// shareReact: a 💖 on a wish or an 응원 on a board that landed. o: { o: the owner now, k: 'w:<id>' | 'c:<slot>', net, uid, acct }. One DO
// call; what it hands over is paid as the gift page's (payOut). k: { rpc }. Never throws. -> the payout job, or null.
export async function shareReact(env, ctx, k, o) {
  try {
    if (!o?.o || !o?.net || String(o.uid || '') === String(o.o)) return null;
    const r = await giftM(env).giftShare({ o: String(o.o), k: String(o.k || ''), net: String(o.net), uid: String(o.uid || ''), acct: !!o.acct }, Date.now());
    if (r?.ok && !r.why) CNT.delete(String(o.k) + '|' + String(o.o)); // a new friend: this isolate's share page counts it at once
    return payOut(env, ctx, k, r);
  } catch { return null; }
}
// "친구 N명이 응원했어요" on a share page: the count of a wish's or board's link friends (its owner now), 60 s per isolate; at hard (h) the
// copy only, else 0 (no DO call). -> a number.
const CNT = new Map(), CNT_MS = 60000;
export async function shareCount(env, key, owner, h = false) {
  const id = String(key || '') + '|' + String(owner || ''), hit = CNT.get(id), now = Date.now();
  if (!owner) return 0;
  if (hit && ((now - hit.at < CNT_MS && now >= hit.at) || h)) return hit.n;
  if (h) return 0;
  let n = 0; try { n = Number(await giftM(env).giftShareCount(String(key), String(owner))) || 0; } catch { return hit ? hit.n : 0; }
  if (CNT.size >= 500) CNT.delete(CNT.keys().next().value);
  CNT.set(id, { at: now, n });
  return n;
}
export const shareCountDrop = () => CNT.clear(); // tests

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
// dc: the DISCOVER switch; ladder: the board's price arm ({ a, p }, giftrules.js ladderArm over GIFT_ARMS).
const ownerExtras = (g, env) => ({ kids: g.kids, vd: g.vd, at: g.at, lk: g.lk, friends: Number(g.fr) || 0, dc: Number(g.dc) ? 1 : 0, ladder: ladderArm(g.id, env?.GIFT_ARMS), perks: perksOf(g.pk), ...(g.re ? { re: g.re } : {}), ...(g.tw ? { tw: g.tw } : {}) }); // tw: { m, how }, the main tower minute; friends: before the reveal too; perks: the paid perks on the board (giftrules.js PERK)
const actNo = async (k, env, id) => !!(k.actOk && !(await k.actOk(env, 'misc', id)));

// ---- routes --------------------------------------------------------------------------------------------------------------
export const giftPath = (p) => p === '/rt/gift' || p.startsWith('/rt/gift/') || p === '/rt/admin/gift' || p.startsWith('/rt/admin/gift/');
export async function giftApi(req, env, ctx, u, k) {
  const p = u.pathname; KIT = k;
  seenFlush(env, ctx); // beacons kept here go out with any gift request once they are due (no-op otherwise)
  hitsFlush(env, ctx, k); // link hits no beacon took, once they are due (no-op otherwise; in waitUntil, the answer does not wait)
  if (p === '/rt/admin/gift' || p.startsWith('/rt/admin/gift/')) return adminApi(req, env, ctx, u, k);
  if (p === '/rt/gift') return make(req, env, ctx, k);
  if (p === '/rt/gift/start') return startSeen(req, env, ctx, k);
  const m = /^\/rt\/gift\/([0-9a-z]{8})(?:\/(paper|seen|heart|interest|video|card\.jpg|card|report|delete|tower|discover))?$/.exec(p);
  if (!m) return J({ err: 'not found' }, 404);
  const id = m[1], sub = m[2] || '';
  if (sub === 'seen') return seen(req, env, ctx, id, k);
  if (sub === 'heart') return heart(req, env, ctx, id, k);
  if (sub === 'video') return req.method === 'POST' ? videoUp(req, env, ctx, id, k) : videoGet(req, env, id, k);
  if (sub === 'card.jpg') return cardGet(req, env, id, k);
  if (sub === 'card') return cardUp(req, env, id, k);
  if (sub === 'paper') return paper(req, env, ctx, id, k);
  if (sub === 'interest') return interest(req, env, id, k);
  if (sub === 'discover') return discover(req, env, id, k);
  if (sub === 'report') return report(req, env, ctx, id, k);
  if (sub === 'delete') return remove(req, env, ctx, id, k);
  if (sub === 'tower') return tower(req, env, ctx, id, k);
  if (req.method !== 'GET') return J({ err: 'get' }, 405);
  if (!(await opsRate(env, req, 'gread', 120, env.EVENT_RL))) return no('rate', 429);
  let g, h; try { ({ v: g, h } = await loadGiftH(env, k, id)); } catch { return no('down', 503); }
  const now = Date.now();
  if (!g || giftPhase(g, now) === 'gone') return no('gone', 404);
  const actor = k.tokenOf(req) ? await actorOf(req, k, env) : null, own = isOwner(g, actor);
  // hard: budget hard (점등식: the page's button and the plaza's arrival stay out of the room). Only at level 2; an old page ignores it.
  return J({ ok: true, gift: giftView(g, now), own, ...(own ? { mine: ownerExtras(g, env), media: mediaOn(env) } : {}), ...(h ? { hard: true } : {}) });
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
  if (await actNo(k, env, actor.id)) return noRate();
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
  return J({ ok: true, id: r.row.id, url: new URL('/g/' + r.row.id, req.url).href, gift: giftView(r.row, now), mine: ownerExtras(r.row, env), media: mediaOn(env) });
}
function mediaDrop(env, ctx, ids) {
  if (!mediaOn(env) || !ids?.length) return null;
  const job = Promise.resolve().then(() => env.MEDIA.delete(ids.map(vidKey))).catch(() => { });
  try { ctx?.waitUntil?.(job); } catch { /* tests */ }
  return job;
}

// POST /rt/gift/<id>/paper { nick, txt, ts }: a guest token is enough (the policy keeps the writer's id, never shown). The account's and
// the network's minute, the body, budget hard, Turnstile ('gmsg'), the line, then one DO call with the caps (per board, per writer, per
// network and day). A line from another network than the maker's is a friend's reaction (giftDb.paper → react): its reward and the
// friends' push go out after the answer (payOut).
async function paper(req, env, ctx, id, k) {
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const actor = await actorOf(req, k, env); if (!actor) return no('auth', 401);
  if (await actNo(k, env, actor.id)) return no('rate', 429);
  if (!(await opsRate(env, req, 'gmsg'))) return no('rate', 429);
  const got = await readSmall(req, 2000); if (got.big) return no('long', 413); if (!got.b) return no('down', 400);
  if (await hard(k, env)) return no('busy', 503);
  const gate = k.humanGate ? await k.humanGate(env, req, got.b, 'gmsg') : null; if (gate) return gate;
  const f = paperFault(got.b);
  if (!f.ok) return J({ ok: false, code: f.code, field: f.field, error: f.error }, 400);
  // human: this line passed its 'gmsg' check above (or Turnstile is off); acct: a linked account writes it (a guest friend otherwise)
  let r = null; try { r = await giftM(env).giftPaper(id, { uid: String(actor.id), ip: await k.ipHash(env, req), nick: f.v.nick, txt: f.v.txt, human: true, acct: !!(k.guestLike && !k.guestLike(actor)) }, Date.now()); } catch { r = null; }
  if (!r) return no('down', 503);
  if (!r.ok) return no(r.code, r.code === 'gone' ? 404 : 409);
  ONE.delete(id); payOut(env, ctx, k, r);
  return J({ ok: true, n: r.n, id: r.id });
}

// POST /rt/gift/<id>/seen { v, e }: a page beacon (sendBeacon). Kept in the isolate; nothing at hard. 204 always (it is a count).
async function seen(req, env, ctx, id, k) {
  const ok = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  if (req.method !== 'POST') return ok();
  if (!(await opsRate(env, req, 'gseen', 120, env.EVENT_RL))) return ok();
  const got = await readSmall(req, 400); const b = got.b || {};
  const e = String(b.e || ''); if (!VISITOR_ID.test(String(b.v || '')) || !SEEN_EV.has(e)) return ok();
  if (k.testTraffic?.(req)) return ok(); // the operator's device or tools/prod-e2e.mjs (ordersrv.js testTraffic): not a visitor
  if (await hard(k, env)) return ok();
  seenAdd({ g: id, v: await visitorHash(env, b.v), e });
  seenFlush(env, ctx);
  return ok();
}

// POST /rt/gift/<id>/heart { v, ts? }: 💖 from this device (v: the page's random device id, hashed as for a view). No account, no notice
// to anyone. The network's minute, budget hard (503 busy, no DO call), then it waits in the isolate with the beacons: the DO keeps one per
// device and board, from the making on (the count is shown once the board is revealed), GIFT.heartNet per board, network and day. The
// answer cannot say whether it was counted (the page shows its own press); a heart on a board that is gone is dropped there.
// ts: a Turnstile 'theart' token (up to 2,048 characters) while it is on. Only a checked heart (or any, while Turnstile is off) may count as a
// friend of the main tower minute and pay the share reward (t: 1); one without is still a heart. No token at all: humanGate answers at once,
// siteverify is not asked. Authorization (optional): the page sends its signed-in account's token, so the share reward can tell an account
// friend (+50 / +20) from a guest one (+10); without it, or with a guest token, the heart is a guest friend's. A token that does not verify is
// the same as none (the heart is never refused for it).
async function heart(req, env, ctx, id, k) {
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  if (!(await opsRate(env, req, 'gheart', 20))) return no('rate', 429);
  const got = await readSmall(req, 2600); const b = got.b || {};
  if (!VISITOR_ID.test(String(b.v || ''))) return no('down', 400);
  if (await hard(k, env)) return no('busy', 503);
  const t = k.humanGate && (await k.humanGate(env, req, b, 'theart')) ? 0 : 1;
  const actor = k.tokenOf(req) ? await actorOf(req, k, env) : null, acct = !!(actor && k.guestLike && !k.guestLike(actor));
  seenAdd({ g: id, v: await visitorHash(env, b.v), e: 'heart', n: await k.ipHash(env, req), t, at: Date.now(), ...(actor ? { u: String(actor.id) } : {}), ...(acct ? { a: 1 } : {}) });
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
  if (k.testTraffic?.(req)) return ok(); // not counted for the operator or the e2e tool
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
  let r = null; try { r = await giftM(env).giftInterest(id, String(actor.id), act, Number(got.b.t), got.b.consent === true, Date.now(), ladderArm(id, env.GIFT_ARMS)); } catch { r = null; }
  if (!r) return no('down', 503);
  if (!r.ok) return no(r.code, r.code === 'owner' ? 403 : r.code === 'gone' ? 404 : 400);
  return J({ ok: true });
}
// POST /rt/gift/<id>/discover { on: true | false }: the owner's DISCOVER switch (default off). On, the board's name, line and sender may be
// listed on /discover while it hangs (the world entry carries dc: 1); /discover reads only the cached /rt/world, so it shows within the
// world's next refill. The account's minute, budget hard (503, no DO call), then one DO call.
async function discover(req, env, id, k) {
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const actor = await actorOf(req, k, env); if (!actor) return no('auth', 401);
  if (await actNo(k, env, actor.id)) return no('rate', 429);
  const got = await readSmall(req, 200); if (!got.b || typeof got.b.on !== 'boolean') return no('down', 400);
  if (await hard(k, env)) return no('busy', 503);
  let r = null; try { r = await giftM(env).giftDiscover(id, String(actor.id), got.b.on, Date.now()); } catch { r = null; }
  if (!r) return no('down', 503);
  if (!r.ok) return no(r.code, r.code === 'owner' ? 403 : 404);
  ONE.delete(id); NOW.at = 0;
  return J({ ok: true, dc: r.dc });
}

// ---- 메인 타워 축하 1분 (towerrules.js) -----------------------------------------------------------------------------------
// Whether spend_plaza takes 2,000 yet (migrations/2026-11-27-tower-minute.sql): asked with a wallet that never exists ('probe:tower'),
// once per isolate per 10 minutes; before the migration the answer is SPEND_OLD, after it 지갑을 찾지 못했습니다. A failed ask counts as
// ready and is asked again in a minute (the press then finds out). A Supabase call, not a DO call. -> true while it is known not to (prep).
const PREP = { at: 0, v: false, p: null };
function towerPrep(env, k, now = Date.now()) {
  if (now - PREP.at < 600000 && now >= PREP.at) return Promise.resolve(PREP.v);
  if (!k.rpc) return Promise.resolve(false);
  PREP.p = PREP.p || Promise.resolve().then(() => k.rpc('spend_plaza', { p_key: env.FLUSH_KEY || '', p_actor_id: 'probe:tower', p_coins: TOWER.price, p_tickets: 0 }))
    .then((r) => { PREP.v = !!(r?.ok && r.data?.ok === false && r.data.error === SPEND_OLD); PREP.at = Date.now(); return PREP.v; },
      () => { PREP.v = false; PREP.at = Date.now() - 540000; return false; })
    .finally(() => { PREP.p = null; });
  return PREP.p;
}
export const towerPrepReset = () => { PREP.at = 0; PREP.v = false; }; // tests
// 2,000 from the account's wallet. -> { ok, coins } | { prep } (spend_plaza does not take 2,000 yet) | { poor } | { no } (an answer that
// spent nothing) | { unknown } (no answer, or a gateway error: it may have gone through).
async function spendTower(env, k, uid) {
  const r = await Promise.resolve().then(() => k.rpc('spend_plaza', { p_key: env.FLUSH_KEY || '', p_actor_id: uid, p_coins: TOWER.price, p_tickets: 0 })).catch(() => null);
  if (!r || !(Number(r.status) < 500)) return { unknown: true };
  const d = r.data || {};
  if (r.ok && d.ok === true) { PREP.v = false; PREP.at = Date.now(); return { ok: true, coins: d.remaining_coins ?? null }; }
  if (r.ok && d.error === SPEND_OLD) { PREP.v = true; PREP.at = Date.now(); return { prep: true }; }
  if (r.ok && /부족/.test(String(d.error || ''))) return { poor: true };
  return { no: true };
}
// A row for the operator (the admin gift view): o: { uid, m, g, why }. Never throws.
const owe = (env, o) => Promise.resolve().then(() => giftM(env).giftRefundFail(o)).catch(() => { console.warn('tower owe row lost', o.why, o.g, o.m); return null; });
// 2,000 back (a booking that could not be written after the spend, or one let go before its minute): once, in waitUntil when ctx is given.
// A refund grant_coins does not take leaves a row (uid, m, g, why) the operator pays by hand (/rt/admin/coins).
function refund(env, ctx, k, uid, why, m, g) {
  const job = Promise.resolve().then(() => k.rpc('grant_coins', { p_key: env.FLUSH_KEY || '', p_actor_id: uid, p_amount: TOWER.price }))
    .then((r) => { if (!(r?.ok && r.data?.ok === true)) throw new Error('refund'); })
    .catch(() => { console.warn('tower refund failed', why); return owe(env, { uid, m, g, why }); });
  if (ctx) { try { ctx.waitUntil(job); } catch { /* tests */ } }
  return job;
}
// The rooms hear of a booked minute once its board is revealed: now, or at the reveal by the 'dark' alarm (towerLater).
function towerOn(env, ctx, k, id, r) {
  if (!r?.entry) return;
  if (Number(r.rev) <= Date.now()) { if (k.towerTell) k.towerTell(env, ctx, r.entry); }
  else if (k.towerLater) k.towerLater(env, ctx, { id, m: r.entry.m, at: Number(r.rev) });
}
// A booking let go (off: { uid, how, m, pay, tell }, towerFree): points back when it had not started, and the rooms told to drop it when
// they know of it (a board before its reveal was never told).
function towerOff(env, ctx, k, id, off) {
  if (!off) return;
  if (off.pay && off.how === 'points' && k.rpc) refund(env, ctx, k, off.uid, 'off', off.m, id);
  if (off.tell && k.towerTell) k.towerTell(env, ctx, { id, m: off.m, off: 1 });
  NOW.at = 0;
}
// ---- paid perks: the hooks ordersrv.js calls (worker.js hands them over in its kit; env is the tallied one) ---------------------------
// o: { board, uid, gives } -> giftDb.perkFit's answer.
export async function giftPerkFit(env, o) { return giftM(env).giftPerkFit(String(o?.board || ''), String(o?.uid || ''), o?.gives || [], Date.now()); }
// o: { board, uid, order, gives }: the perks on, this isolate's copies of the board and of /rt/world dropped. -> giftDb.perkOn's answer.
export async function giftPerkOn(env, ctx, k, o) {
  const r = await giftM(env).giftPerkOn(String(o?.board || ''), String(o?.uid || ''), String(o?.order || ''), o?.gives || [], Date.now());
  if (r?.ok) giftDrop(String(o.board));
  return r;
}
// o: { board, order }: the order's perks off; a main tower minute let go is told to the rooms (and points paid back for a points booking).
export async function giftPerkOff(env, ctx, k, o) {
  const r = await giftM(env).giftPerkOff(String(o?.board || ''), String(o?.order || ''), Date.now());
  if (r?.ok && !r.none) { giftDrop(String(o.board)); if (r.off) towerOff(env, ctx, k, String(o.board), r.off); }
  return r;
}
const TOWER_409 = new Set(['taken', 'sold', 'board', 'day', 'gap', 'friends']);
const towerNo = (r) => no(r.code, r.code === 'owner' || r.code === 'account' ? 403 : r.code === 'gone' ? 404 : TOWER_409.has(r.code) ? 409 : 400, { ...(r.taken ? { taken: r.taken } : {}), ...(r.days ? { days: r.days } : {}) });
// 429 with Retry-After as a header (and in the body, as the other refusals carry it).
const noRate = () => J({ ok: false, code: 'rate', error: ERR.rate || GIFT_ERR.down, 'retry-after': '60' }, 429, { 'retry-after': '60' });
// GET: the owner's card. POST { m, how, ts }: a booking. Cheapest first: token, the account's minute, the network's minute, body, the minute's
// shape, the path's own refusals (a guest asking for points), budget hard (503, no DO call), Turnstile 'tower' (points only), whether the
// database takes 2,000 (points only, see towerPrep), then:
// - friends: one DO call that books.
// - points: a DO call that checks and holds the minute for this account (HOLD_MS), spend_plaza, a DO call that books the held minute. Nothing
//   spent: the hold goes (one more call). A spend whose answer never came may have gone through: the minute is booked anyway, and a row tells
//   the operator if it cannot be. The booking call itself failing (it may have written): the owner's read says whether it did before
//   anything is paid back. So no path both keeps a booking and pays back, and a spend that went through is booked or paid back (or, when
//   neither can be known, left as a row for the operator).
async function tower(req, env, ctx, id, k) {
  if (req.method === 'GET') return towerRead(req, env, id, k);
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const actor = await actorOf(req, k, env); if (!actor) return no('auth', 401);
  if (await actNo(k, env, actor.id)) return noRate();
  if (!(await opsRate(env, req, 'gtower', 10))) return noRate();
  const got = await readSmall(req, 3000); if (got.big) return no('long', 413); if (!got.b) return no('down', 400);
  const how = String(got.b.how || ''), m = Math.floor(Number(got.b.m)), uid = String(actor.id), guest = !!(actor.guest || actor.anon);
  if (!TOWER_HOW.includes(how) || !Number.isSafeInteger(m) || !(m > 0) || Math.abs(m - Date.now()) > 400 * 864e5) return no('minute', 400); // a year either way: never a date the store cannot read
  if (how === 'points' && guest) return no('account', 403);
  if (how === 'paid' && guest) return no('paid', 403);
  if (await hard(k, env)) return no('busy', 503);
  const M = giftM(env), o = { m, how, guest };
  // 메인 타워 주인공: the order ledger (one order DO call) must hold a PUBLISHED order of this board with the tower perk, bought by this
  // account; then the gift store books it like any minute (the 30 a day, the minute rules, one a board), with no friends and no points.
  if (how === 'paid') {
    const op = await orderPerks(env, id);
    if (!op?.ok) return no('down', 503);
    if (!(op.gives || []).includes(PERK.tower) || !(op.uids || []).includes(uid)) return no('paid', 403);
    o.paid = true;
  }
  let spent = null;
  if (how === 'points') {
    const gate = k.humanGate ? await k.humanGate(env, req, got.b, 'tower') : null; if (gate) return gate;
    if (!k.rpc || (await towerPrep(env, k))) return no('prep', 503);
    let ask = null; try { ask = await M.giftTowerBook(id, uid, o, Date.now(), true); } catch { ask = null; }
    if (!ask) return no('down', 503); // a hold that was written lapses by itself
    if (!ask.ok) return towerNo(ask);
    spent = await spendTower(env, k, uid);
    if (!spent.ok && !spent.unknown) {
      await Promise.resolve().then(() => M.giftTowerUnhold(id, uid, m)).catch(() => null); // else it lapses
      return spent.prep ? no('prep', 503) : spent.poor ? no('poor', 400) : no('down', 502);
    }
    if (spent.unknown) console.warn('tower spend: no answer', id, m);
  }
  let r = null, lost = false;
  try { r = how === 'points' ? await M.giftTowerConfirm(id, uid, m, Date.now()) : await M.giftTowerBook(id, uid, o, Date.now()); } catch { lost = true; }
  if (lost) { // it may have written: read before answering, and before paying anything back
    let s = null; try { s = await M.giftTowerGet(id, uid, Date.now()); } catch { s = null; }
    if (s?.ok && s.tw && Number(s.tw.m) === m && s.tw.how === how) r = { ok: true, tw: s.tw, entry: s.entry, rev: s.rev };
    else if (s) r = { ok: false, code: 'down' };
    else { if (spent) await owe(env, { uid, m, g: id, why: 'unknown' }); return no('down', 503); } // neither the write nor the read answered
  }
  if (!r.ok) {
    if (spent?.ok) await refund(env, null, k, uid, 'book', m, id);
    else if (spent?.unknown) await owe(env, { uid, m, g: id, why: 'unknown' }); // may have been spent: never paid back blind
    return r.code === 'down' ? no('down', 503) : towerNo(r);
  }
  ONE.delete(id); NOW.at = 0;
  towerOn(env, ctx, k, id, r);
  return J({ ok: true, tw: r.tw, ...(spent?.ok ? { coins: spent.coins } : {}) });
}
// GET /rt/gift/<id>/tower: the owner's card (towerrules.js towerCard). guest: a guest or an anonymous login (no points path); prep: the
// database does not take 2,000 yet (accounts only, towerPrep); paid: the board has the tower perk (메인 타워 주인공, published). At budget
// hard: this isolate's copy of the board (ONE), no DO call.
async function towerRead(req, env, id, k) {
  const actor = k.tokenOf(req) ? await actorOf(req, k, env) : null; if (!actor) return no('auth', 401);
  if (!(await opsRate(env, req, 'gtowerget', 30))) return noRate(); // its own count: a page reading its card never blocks the press
  const uid = String(actor.id), guest = !!(actor.guest || actor.anon), prep = guest ? false : await towerPrep(env, k);
  if (await hard(k, env)) {
    const hit = ONE.get(id)?.v;
    return hit && hit.uid === uid ? J({ ok: true, hard: true, tw: hit.tw || null, guest, prep }) : no('busy', 503);
  }
  let r = null; try { r = await giftM(env).giftTowerGet(id, uid, Date.now()); } catch { r = null; }
  if (!r) return no('down', 503);
  if (!r.ok) return no(r.code, r.code === 'owner' ? 403 : 404);
  return J({ ok: true, tw: r.tw, days: r.days, taken: r.taken, friends: r.friends, need: r.need, gap: r.gap, guest, prep, ...(r.paid ? { paid: true } : {}) });
}

// POST /rt/gift/<id>/report { m }: one per network per board or line. Three networks hide it (the admin can bring it back). A board hidden
// this way lets go of its main tower minute (towerOff: points back if it had not started, the rooms told if they know of it).
async function report(req, env, ctx, id, k) {
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  if (!(await opsRate(env, req, 'grep', 10))) return no('rate', 429);
  const got = await readSmall(req, 300); const b = got.b || {};
  if (await hard(k, env)) return no('busy', 503);
  let r = null; try { r = await giftM(env).giftReport(id, String(b.m || ''), await k.ipHash(env, req), Date.now()); } catch { r = null; }
  if (!r) return no('down', 503);
  if (!r.ok) return no(r.code, 404);
  ONE.delete(id); if (r.hidden) NOW.at = 0;
  if (r.off) towerOff(env, ctx, k, id, r.off);
  return J({ ok: true, hidden: !!r.hidden });
}

// POST /rt/gift/<id>/delete: the owner takes it down (and its video). A main tower minute that has not started is let go (points back).
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
  if (r.off) towerOff(env, ctx, k, id, r.off);
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
    if (p === '/rt/admin/gift/share' && req.method === 'GET') return J(await M.giftAdmin('share', {}, now)); // 공유 보상 많이 받은 사람 (7 days)
    if (p === '/rt/admin/gift/hide' && req.method === 'POST') {
      const got = await readSmall(req, 500); if (!got.b) return J({ ok: false, error: '요청을 읽지 못했어요.' }, 400);
      const r = await M.giftAdmin('hide', got.b, now); if (r.ok) { giftDrop(String(got.b.id || '')); towerOff(env, ctx, k, String(got.b.id || ''), r.off); } // off: in waitUntil, also at hard
      return J({ ...r, off: undefined }, r.ok ? 200 : 400);
    }
    if (p === '/rt/admin/gift/refund' && req.method === 'POST') { // { k, done }: a refund the operator paid by hand (the list is in GET /rt/admin/gift)
      const got = await readSmall(req, 300); if (!got.b) return J({ ok: false, error: '요청을 읽지 못했어요.' }, 400);
      const r = await M.giftAdmin('refund', got.b, now); return J(r, r.ok ? 200 : 400);
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
// tell: worker.js towerTell, so the rooms drop the account's main tower minutes the plazas already know (r.offs).
export async function giftForget(env, uid, ctx, tell) {
  let r = null; try { r = await giftM(env).giftForget(String(uid || ''), Date.now()); } catch { r = null; }
  if (r?.ids?.length) { for (const id of r.ids) giftDrop(id); await mediaDrop(env, ctx, r.ids); }
  if (r?.offs?.length) { NOW.at = 0; if (tell) await Promise.all(r.offs.map((o) => Promise.resolve(tell(env, ctx, { id: o.id, m: o.m, off: 1 })).catch(() => null))); }
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
  KIT = k; seenFlush(env, ctx);
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
  if (!down) hitsFlush(env, ctx, k, h); // in waitUntil
  const view = live ? giftView(g, now) : null;
  const words = live ? giftShareText(view) : { title: down ? '잠시 뒤에 다시 열어 주세요 · WISH BOARD' : '선물 전광판 · WISH BOARD', text: down ? '지금은 광장이 붐벼요.' : '뉴욕 타임스퀘어를 본뜬 가상 광장에 친구를 위한 전광판을 6시간 무료로 걸어 보세요.' };
  const desc = live ? words.text + ' (' + windowText(view.a, view.b) + ')' : words.text;
  const img = live ? origin + '/rt/gift/' + id + '/card.jpg' : origin + '/og.jpg';
  const meta = '<title>' + esc(words.title) + '</title><meta name="robots" content="noindex, nofollow"><meta name="description" content="' + esc(desc) + '">'
    + '<meta property="og:type" content="website"><meta property="og:site_name" content="WISH BOARD"><meta property="og:title" content="' + esc(words.title) + '"><meta property="og:description" content="' + esc(desc) + '">'
    + '<meta property="og:url" content="' + esc(origin + '/g/' + id) + '"><meta property="og:image" content="' + esc(img) + '"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
    + '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' + esc(words.title) + '"><meta name="twitter:description" content="' + esc(desc) + '"><meta name="twitter:image" content="' + esc(img) + '">';
  // site: the public Turnstile key while it is on ('' when off): the page asks a 'theart' token for 💖 itself (a heart is never refused for
  // want of one, so the route cannot answer 403 with the key the way the others do).
  const data = { id, gift: view, now, media: mediaOn(env), down: !!down, occ: live ? OCCASIONS[view.occ]?.name || '' : '', site: k.humanSite ? k.humanSite(env) : '', ...(h ? { hard: true } : {}) };
  const html = (await shell(env, req)).replace(META_BLOCK, meta).replace('<!--GIFT_DATA-->', jsonTag(data));
  return new Response(req.method === 'HEAD' ? null : html, { status: live ? 200 : down ? 503 : 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': live ? 'public, max-age=20' : 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'strict-origin-when-cross-origin' } });
}
