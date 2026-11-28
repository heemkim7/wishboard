// 응원 팀과 명당 on the Worker (docs/prime-screens.md): the /rt/team* and /rt/teams routes, /rt/prime, the admin routes /rt/admin/team*,
// the share page /t/<id>, the prime part of /rt/world and the Meter instance 'team' (Durable Object SQLite, so no Supabase migration).
// worker.js imports this with no query, sends those paths here and hands over what it owns (k): adminOk, lvlNow, resolveActor, tokenOf,
// ipHash (the network hash: IPv4 as is, IPv6 by /64), actOk (ACT_RL), supa (the project URL and publishable key, for the account age) and myTribe
// (the old 소속 of an account, read once to bring it over). Server only: .assetsignore keeps this file off the static assets.
//
// Budget: every DO call here goes through the tallied env worker.js passes in. Reads are cached per isolate (team page 20 s, rankings 30 s,
// the day's plan 60 s; at the hard budget level any copy is used and a miss answers busy); every write is one DO call and answers 503 busy
// at hard without one. The counting itself keeps counters per team and day (tdc), so a ranking reads one row per team, never one per person.
// Privacy: an account id never leaves this instance (pages carry team names and counts only); a network is kept as a hash for the day's
// one-per-network rule and goes with the supporter row after PRIME.keepDays; withdrawal deletes the account's rows (forget).
//
// Tables in instance 'team' (made on first use):
//   tm(id, name, nk, owner, at, members, hidden)     teams; nk: nameKey (one team per name)
//   tmm(uid, tid, role, at)                           membership, one team per account
//   tml(uid, at)                                      when an account last left a team (PRIME.hopMs)
//   tsd(d, uid, tid, at, ok, why, net)                one support per account and KST day; ok = counted
//   tdc(d, tid, n, last, act, k, n21, l21)            per team and day: counted supporters, when the latest came, the 7-day active
//                                                     supporters, every support (k), and the count and time at 21:00 (null until then)
//   tact(tid, uid, d)                                 the last day an account's support counted for a team (the 7-day window)
//   tan(tid, md, label, st, at, ok_at)                one anniversary per team: wait / ok / no
//   tach(tid, d, kind, n)                             achievements: small / big / tower (the day reached), hot, ann, gold (the day shown)
//   tpl(d, j, at, gold)                               the frozen plan of a day; gold = 1 once the 9 pm team is set
//   tua(uid, at)                                      an account's creation time, read once
//   tmj(uid, tid, d)                                  joins by day (D7 / D30 of members)
//   tmk(k, d, n)                                      per network and day: teams made
//   tri(uid)                                          accounts whose old 소속 was already looked at
import { PRIME, TEAM_ID, TEAM_ERR, kstDay, dayStart, addDays, mdOf, mdOk, cleanName, nameFault, nameKey, supportVerdict, countsFrom, supportLine, rateOf, hottest, byCount, goldPick, planDay, withGold, stripPlan, teamSlots, goalOf, nextGoal, rankToday, rankWeek, GOLD_HOUR, isDay } from './primerules.js';
import { opsRate } from './ops.js';

const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...h } });
const no = (code, s = 400, extra = {}) => J({ ok: false, code, error: TEAM_ERR[code] || TEAM_ERR.down, ...extra }, s);
const teamM = (env) => env.METER.get(env.METER.idFromName('team'));
const ID_ABC = 'abcdefghijklmnopqrstuvwxyz0123456789';
const rid = () => { const b = new Uint8Array(8); crypto.getRandomValues(b); let s = ''; for (const x of b) s += ID_ABC[x % 36]; return s; };
const hard = async (k, env) => { try { return (await k.lvlNow(env)) >= 2; } catch { return false; } };
const H = 3600e3;
const MADE_DAY = 3; // teams one network may make in a KST day

// ---- the store (Meter instance 'team') ---------------------------------------------------------------------------------
const one = (q, sql, ...a) => q.exec(sql, ...a).toArray()[0] || null;
const all = (q, sql, ...a) => q.exec(sql, ...a).toArray();
const teamRow = (r) => (r ? { id: String(r.id), name: String(r.name), owner: String(r.owner || ''), at: Number(r.at) || 0, members: Math.max(0, Number(r.members) || 0), hidden: Number(r.hidden) ? 1 : 0 } : null);
const memberOf = (q, uid) => one(q, 'select tid, role, at from tmm where uid = ?', uid);
const dayRow = (q, d, tid) => one(q, 'select n, last, act, k, n21, l21 from tdc where d = ? and tid = ?', d, tid);
const counts = (r) => ({ n: Math.max(0, Number(r?.n) || 0), act: Math.max(0, Number(r?.act) || 0), k: Math.max(0, Number(r?.k) || 0) });
// The day's counter row, made with the 7-day active supporters the team already had (their last counted day in [d-6, d-1]).
function dayEnsure(q, d, tid, now) {
  if (dayRow(q, d, tid)) return;
  const act = Number(one(q, 'select count(*) n from tact where tid = ? and d >= ? and d < ?', tid, addDays(d, 1 - PRIME.activeDays), d)?.n) || 0;
  const after21 = now >= dayStart(d) + GOLD_HOUR * H;
  q.exec('insert into tdc(d, tid, n, last, act, k, n21, l21) values(?, ?, 0, 0, ?, 0, ?, ?) on conflict(d, tid) do nothing', d, tid, act, after21 ? 0 : null, after21 ? 0 : null);
}
// The first support at or after 21:00 freezes the count before it (the 9 pm team is judged on that).
function mark21(q, d, tid, now) {
  if (now >= dayStart(d) + GOLD_HOUR * H) q.exec('update tdc set n21 = n, l21 = last where d = ? and tid = ? and n21 is null', d, tid);
}
function hiddenSet(q) { return new Set(all(q, 'select id from tm where hidden = 1').map((r) => String(r.id))); }
function prune(q, now) {
  const d = kstDay(now);
  q.exec('delete from tsd where d < ?', addDays(d, -PRIME.keepDays));
  q.exec('delete from tact where d < ?', addDays(d, -PRIME.activeDays - 1));
  q.exec('delete from tmj where d < ?', addDays(d, -60));
  q.exec('delete from tmk where d < ?', d);
  q.exec('delete from tpl where d < ?', addDays(d, -PRIME.keepDays));
  q.exec('delete from tdc where d < ?', addDays(d, -120));
}
// A day's plan: made once from the day before (final), with the anniversaries of its month-day; the 9 pm team is added once 21:00 has passed.
function planFor(q, day, now) {
  if (!isDay(day) || now < dayStart(day)) return null;
  let row = one(q, 'select j, gold from tpl where d = ?', day);
  if (!row) {
    const prev = addDays(day, -1);
    const teams = all(q, 'select tdc.tid id, tm.name name, tdc.n n, tdc.last last, tdc.act act from tdc join tm on tm.id = tdc.tid where tdc.d = ? and tm.hidden = 0 and tdc.n > 0', prev);
    const hot = hottest(teams);
    if (hot) hot.name = teams.find((t) => t.id === hot.id)?.name || '';
    const ann = all(q, "select tan.tid id, tm.name name, tan.label label, tan.ok_at at from tan join tm on tm.id = tan.tid where tan.md = ? and tan.st = 'ok' and tm.hidden = 0", mdOf(day));
    const plan = planDay({ day, teams, hot, ann });
    q.exec('insert into tpl(d, j, at, gold) values(?, ?, ?, 0) on conflict(d) do nothing', day, JSON.stringify(plan), now);
    for (const t of teams) { const g = goalOf(t.n); if (g) q.exec('insert into tach(tid, d, kind, n) values(?, ?, ?, ?) on conflict do nothing', t.id, prev, g, Math.floor(Number(t.n) || 0)); }
    if (hot) q.exec("insert into tach(tid, d, kind, n) values(?, ?, 'hot', ?) on conflict do nothing", hot.id, prev, Math.round(hot.rate * 100));
    for (const a of plan.ann) q.exec("insert into tach(tid, d, kind, n) values(?, ?, 'ann', 0) on conflict do nothing", a.id, day);
    prune(q, now);
    row = one(q, 'select j, gold from tpl where d = ?', day);
  }
  let plan; try { plan = JSON.parse(String(row.j)); } catch { return null; }
  if (Number(row.gold)) { /* the 9 pm team is in j already */ } else if (now >= dayStart(day) + GOLD_HOUR * H) {
    const rows = all(q, 'select tdc.tid id, tm.name name, coalesce(tdc.n21, tdc.n) n, case when tdc.n21 is null then tdc.last else tdc.l21 end last from tdc join tm on tm.id = tdc.tid where tdc.d = ? and tm.hidden = 0', day);
    const gold = goldPick(rows);
    plan = withGold(plan, gold, gold ? rows.find((r) => r.id === gold.id)?.name : '');
    q.exec('update tpl set j = ?, gold = 1 where d = ?', JSON.stringify(plan), day);
    if (gold) q.exec("insert into tach(tid, d, kind, n) values(?, ?, 'gold', ?) on conflict do nothing", gold.id, day, gold.n);
  } else delete plan.gold; // not decided yet: primeAt reads undefined as "to be named at 21:00"
  return stripPlan(plan, hiddenSet(q));
}
const PAST_KINDS = { small: 1, big: 1, tower: 1, hot: 1, ann: 1, gold: 1 };
// The public page of a team: what anyone may see (transparency, report "팀에는 도구를 주고"): today's supporters and goal, participation,
// where it shows today and what it has earned for tomorrow, the past record. No account id, no member names.
function pageOf(q, tid, now) {
  const t = teamRow(one(q, 'select * from tm where id = ?', tid));
  if (!t || t.hidden) return null;
  const d = kstDay(now), today = counts(dayRow(q, d, tid)), yday = counts(dayRow(q, addDays(d, -1), tid));
  const plan = planFor(q, d, now);
  const past = all(q, 'select d, kind, n from tach where tid = ? order by d desc, kind limit 20', tid).filter((r) => PAST_KINDS[r.kind]).map((r) => ({ d: String(r.d), kind: String(r.kind), n: Number(r.n) || 0 }));
  const ann = one(q, 'select md, label, st from tan where tid = ?', tid);
  const goal = goalOf(today.n);
  return { id: t.id, name: t.name, at: t.at, members: t.members, today: { n: today.n, act: today.act, rate: rateOf(today.n, today.act), goal, next: nextGoal(today.n) },
    yesterday: { n: yday.n }, slots: plan ? teamSlots(plan, tid) : [], tomorrow: goal ? { goal } : null, past,
    ann: ann ? { md: String(ann.md), label: String(ann.label || ''), st: String(ann.st) } : null, day: d };
}
export const teamDb = {
  tables(q) {
    q.exec("create table if not exists tm(id text primary key, name text not null, nk text not null unique, owner text not null default '', at integer not null, members integer not null default 0, hidden integer not null default 0)");
    q.exec('create table if not exists tmm(uid text primary key, tid text not null, role text not null, at integer not null)');
    q.exec('create index if not exists tmm_tid on tmm(tid, at)');
    q.exec('create table if not exists tml(uid text primary key, at integer not null)');
    q.exec("create table if not exists tsd(d text not null, uid text not null, tid text not null, at integer not null, ok integer not null, why text not null, net text not null default '', primary key(d, uid))");
    q.exec('create index if not exists tsd_net on tsd(d, tid, net)');
    q.exec('create index if not exists tsd_uid on tsd(uid)');
    q.exec('create table if not exists tdc(d text not null, tid text not null, n integer not null default 0, last integer not null default 0, act integer not null default 0, k integer not null default 0, n21 integer, l21 integer, primary key(d, tid))');
    q.exec('create table if not exists tact(tid text not null, uid text not null, d text not null, primary key(tid, uid))');
    q.exec('create index if not exists tact_uid on tact(uid)');
    q.exec("create table if not exists tan(tid text primary key, md text not null, label text not null default '', st text not null, at integer not null, ok_at integer not null default 0)");
    q.exec('create index if not exists tan_md on tan(md, st)');
    q.exec('create table if not exists tach(tid text not null, d text not null, kind text not null, n integer not null default 0, primary key(tid, d, kind))');
    q.exec('create index if not exists tach_d on tach(d)');
    q.exec('create table if not exists tpl(d text primary key, j text not null, at integer not null, gold integer not null default 0)');
    q.exec('create table if not exists tua(uid text primary key, at integer not null)');
    q.exec('create table if not exists tmj(uid text not null, tid text not null, d text not null, primary key(uid, tid, d))');
    q.exec('create index if not exists tmj_d on tmj(d)');
    q.exec('create table if not exists tmk(k text not null, d text not null, n integer not null, primary key(k, d))');
    q.exec('create table if not exists tri(uid text primary key)');
  },
  // o: { uid, guest, name, net, now }. Only a linked account makes a team (a guest may join one).
  create(q, o) {
    const now = Number(o.now) || Date.now(), uid = String(o.uid || ''), d = kstDay(now);
    if (!uid) return { ok: false, code: 'auth' };
    if (o.guest) return { ok: false, code: 'link' };
    if (memberOf(q, uid)) return { ok: false, code: 'member' };
    const left = Number(one(q, 'select at from tml where uid = ?', uid)?.at) || 0;
    if (left && now - left < PRIME.hopMs) return { ok: false, code: 'hop', at: left + PRIME.hopMs };
    const fault = nameFault(o.name); if (fault) return { ok: false, code: fault };
    const name = cleanName(o.name), nk = nameKey(name);
    if (one(q, 'select id from tm where nk = ?', nk)) return { ok: false, code: 'name_taken' };
    const net = String(o.net || '');
    if (net && (Number(one(q, 'select n from tmk where k = ? and d = ?', 'mk:' + net, d)?.n) || 0) >= MADE_DAY) return { ok: false, code: 'made' };
    let id = String(o.id || ''); for (let i = 0; i < 4 && (!TEAM_ID.test(id) || one(q, 'select id from tm where id = ?', id)); i++) id = rid();
    if (!TEAM_ID.test(id) || one(q, 'select id from tm where id = ?', id)) return { ok: false, code: 'down' };
    q.exec('insert into tm(id, name, nk, owner, at, members) values(?, ?, ?, ?, ?, 1)', id, name, nk, uid, now);
    q.exec("insert into tmm(uid, tid, role, at) values(?, ?, 'owner', ?)", uid, id, now);
    q.exec('insert into tmj(uid, tid, d) values(?, ?, ?) on conflict do nothing', uid, id, d);
    if (net) q.exec('insert into tmk(k, d, n) values(?, ?, 1) on conflict(k, d) do update set n = n + 1', 'mk:' + net, d);
    return { ok: true, team: pageOf(q, id, now), role: 'owner' };
  },
  join(q, o) {
    const now = Number(o.now) || Date.now(), uid = String(o.uid || ''), id = String(o.id || '');
    if (!uid) return { ok: false, code: 'auth' };
    const t = teamRow(one(q, 'select * from tm where id = ?', id));
    if (!t || t.hidden) return { ok: false, code: 'team' };
    const cur = memberOf(q, uid);
    if (cur) return cur.tid === id ? { ok: true, team: pageOf(q, id, now), role: String(cur.role), again: true } : { ok: false, code: 'member' };
    const left = Number(one(q, 'select at from tml where uid = ?', uid)?.at) || 0;
    if (left && now - left < PRIME.hopMs) return { ok: false, code: 'hop', at: left + PRIME.hopMs };
    const role = t.owner ? 'member' : 'owner'; // a team whose owner left takes the next one who joins as its owner
    q.exec('insert into tmm(uid, tid, role, at) values(?, ?, ?, ?)', uid, id, role, now);
    q.exec('update tm set members = members + 1' + (role === 'owner' ? ', owner = ?' : '') + ' where id = ?', ...(role === 'owner' ? [uid, id] : [id]));
    q.exec('insert into tmj(uid, tid, d) values(?, ?, ?) on conflict do nothing', uid, id, kstDay(now));
    return { ok: true, team: pageOf(q, id, now), role };
  },
  leave(q, o) {
    const now = Number(o.now) || Date.now(), uid = String(o.uid || '');
    const cur = memberOf(q, uid); if (!cur) return { ok: false, code: 'none' };
    leaveRow(q, uid, cur);
    q.exec('insert into tml(uid, at) values(?, ?) on conflict(uid) do update set at = excluded.at', uid, now);
    return { ok: true, left: String(cur.tid), hopAt: now + PRIME.hopMs };
  },
  // o: { uid, guest, anon, createdAt, net, now }. -> { ok, why, counted, n, act } or { need: 'age' } (the Worker reads the account's
  // creation time from Supabase Auth and calls again; it is kept in tua so that happens once per account).
  cheer(q, o) {
    const now = Number(o.now) || Date.now(), uid = String(o.uid || ''), d = kstDay(now);
    if (!uid) return { ok: false, code: 'auth' };
    const cur = memberOf(q, uid); if (!cur) return { ok: false, code: 'none' };
    const tid = String(cur.tid);
    const done = one(q, 'select tid, ok, why from tsd where d = ? and uid = ?', d, uid);
    if (done) { const c = counts(dayRow(q, d, tid)); return { ok: true, why: 'done', counted: false, before: String(done.why), n: c.n, act: c.act, tid }; }
    let createdAt = Number(o.createdAt) || 0;
    const user = !o.guest && !o.anon;
    if (user) {
      if (createdAt > 0) q.exec('insert into tua(uid, at) values(?, ?) on conflict(uid) do nothing', uid, createdAt);
      else createdAt = Number(one(q, 'select at from tua where uid = ?', uid)?.at) || 0;
      if (!(createdAt > 0)) return { ok: true, need: 'age' };
    }
    const net = String(o.net || '');
    const netTaken = !!(net && one(q, 'select 1 x from tsd where d = ? and tid = ? and net = ? and ok = 1 limit 1', d, tid, net));
    const why = supportVerdict({ guest: !!o.guest, anon: !!o.anon, createdAt, now, netTaken });
    dayEnsure(q, d, tid, now);
    mark21(q, d, tid, now);
    const ok = why === 'ok' ? 1 : 0;
    q.exec('insert into tsd(d, uid, tid, at, ok, why, net) values(?, ?, ?, ?, ?, ?, ?)', d, uid, tid, now, ok, why, net);
    if (ok) {
      const prevDay = String(one(q, 'select d from tact where tid = ? and uid = ?', tid, uid)?.d || '');
      const fresh = !prevDay || prevDay < addDays(d, 1 - PRIME.activeDays);
      q.exec('insert into tact(tid, uid, d) values(?, ?, ?) on conflict(tid, uid) do update set d = excluded.d', tid, uid, d);
      q.exec('update tdc set n = n + 1, last = ?, k = k + 1' + (fresh ? ', act = act + 1' : '') + ' where d = ? and tid = ?', now, d, tid);
    } else q.exec('update tdc set k = k + 1 where d = ? and tid = ?', d, tid);
    const c = counts(dayRow(q, d, tid));
    return { ok: true, why, counted: !!ok, n: c.n, act: c.act, tid, ...(why === 'young' ? { from: countsFrom(createdAt) } : {}) };
  },
  // My membership with my team's page and today's support (one call for the sheet).
  me(q, uid, now = Date.now()) {
    const cur = memberOf(q, String(uid || ''));
    const d = kstDay(now), mine = one(q, 'select tid, ok, why, at from tsd where d = ? and uid = ?', d, String(uid || ''));
    const left = Number(one(q, 'select at from tml where uid = ?', String(uid || ''))?.at) || 0;
    const looked = !!one(q, 'select 1 x from tri where uid = ?', String(uid || ''));
    const hopAt = left && now - left < PRIME.hopMs ? left + PRIME.hopMs : 0;
    if (!cur) return { ok: true, team: null, today: mine ? { why: String(mine.why), counted: !!Number(mine.ok) } : null, hopAt, looked };
    return { ok: true, team: pageOf(q, String(cur.tid), now), role: String(cur.role), since: Number(cur.at) || 0, today: mine ? { why: String(mine.why), counted: !!Number(mine.ok), here: String(mine.tid) === String(cur.tid) } : null, hopAt, looked };
  },
  page(q, id, now = Date.now()) { return pageOf(q, String(id || ''), now); },
  // Rankings: today's counters (distinct supporters, participation) and this ISO week's achievements; q: a name to look for (prefix).
  ranks(q, now = Date.now(), find = '') {
    const d = kstDay(now);
    const rows = all(q, 'select tdc.tid id, tm.name name, tdc.n n, tdc.act act, tdc.last last from tdc join tm on tm.id = tdc.tid where tdc.d = ? and tm.hidden = 0 and tdc.n > 0', d);
    const { today, rate } = rankToday(rows);
    const wd = (() => { const t = new Date(dayStart(d) + 9 * H), dn = (t.getUTCDay() + 6) % 7; return addDays(d, -dn); })(); // this week's Monday (KST)
    const week = rankWeek(all(q, "select tach.tid id, tm.name name, count(*) k from tach join tm on tm.id = tach.tid where tach.d >= ? and tm.hidden = 0 and tach.kind in ('small','big','tower','hot','gold') group by tach.tid", wd));
    const out = { ok: true, day: d, today, rate, week, teams: Number(one(q, 'select count(*) n from tm where hidden = 0 and members > 0')?.n) || 0 };
    const key = cleanName(find, 16);
    if (key) {
      const nk = nameKey(key);
      out.found = all(q, 'select id, name, members from tm where hidden = 0 and nk like ? order by members desc limit 10', nk.replace(/[%_]/g, '') + '%').map((r) => ({ id: String(r.id), name: String(r.name), members: Number(r.members) || 0 }));
    }
    return out;
  },
  // The day's plan and today's leader so far (the 20:50 banner) and the latest 9 pm team (the roof).
  prime(q, now = Date.now()) {
    const d = kstDay(now), plan = planFor(q, d, now);
    const ranked = byCount(all(q, 'select tdc.tid id, tm.name name, tdc.n n, tdc.last last from tdc join tm on tm.id = tdc.tid where tdc.d = ? and tm.hidden = 0 and tdc.n > 0', d));
    const lead = ranked[0] || null, top = ranked.slice(0, 5).map((r) => ({ id: r.id, name: String(r.name), n: r.n }));
    const roof = plan?.gold ? plan.names?.[plan.gold.id] || '' : (() => { const p = one(q, 'select j from tpl where d = ?', addDays(d, -1)); try { const y = p ? JSON.parse(String(p.j)) : null; return y?.gold ? y.names?.[y.gold.id] || '' : ''; } catch { return ''; } })();
    return { ok: true, day: d, plan, lead: lead ? { id: lead.id, name: String(lead.name), n: lead.n } : null, top, roof };
  },
  annSet(q, o) {
    const now = Number(o.now) || Date.now(), uid = String(o.uid || '');
    const cur = memberOf(q, uid); if (!cur) return { ok: false, code: 'none' };
    if (String(cur.role) !== 'owner') return { ok: false, code: 'owner' };
    if (!mdOk(o.md)) return { ok: false, code: 'md' };
    const label = cleanName(o.label, PRIME.labelMax);
    if (o.label && nameFault(o.label, PRIME.labelMax)) return { ok: false, code: 'label' };
    q.exec("insert into tan(tid, md, label, st, at, ok_at) values(?, ?, ?, 'wait', ?, 0) on conflict(tid) do update set md = excluded.md, label = excluded.label, st = 'wait', at = excluded.at, ok_at = 0", String(cur.tid), String(o.md), label, now);
    return { ok: true, ann: { md: String(o.md), label, st: 'wait' } };
  },
  // The old 소속 of an account (Supabase tribes), brought over once: the same id and name, the same role. tribe: { id, tag, role } or null.
  bring(q, uid, tribe, now = Date.now()) {
    uid = String(uid || '');
    if (!uid || one(q, 'select 1 x from tri where uid = ?', uid)) return { ok: true, moved: false };
    q.exec('insert into tri(uid) values(?) on conflict do nothing', uid);
    if (!tribe || !TEAM_ID.test(String(tribe.id || '')) || memberOf(q, uid)) return { ok: true, moved: false };
    const id = String(tribe.id);
    let t = teamRow(one(q, 'select * from tm where id = ?', id));
    if (!t) {
      let name = cleanName(String(tribe.tag || '').replace(/^#/, '')) || '응원 팀';
      if (nameFault(name)) name = '응원 팀 ' + id.slice(0, 4);
      if (one(q, 'select id from tm where nk = ?', nameKey(name))) name = cleanName(name + ' ' + id.slice(0, 4));
      if (one(q, 'select id from tm where nk = ?', nameKey(name))) return { ok: true, moved: false };
      q.exec("insert into tm(id, name, nk, owner, at, members) values(?, ?, ?, '', ?, 0)", id, name, nameKey(name), now);
      t = teamRow(one(q, 'select * from tm where id = ?', id));
    }
    if (t.hidden) return { ok: true, moved: false };
    const role = String(tribe.role) === 'owner' && !t.owner ? 'owner' : t.owner ? 'member' : 'owner';
    q.exec('insert into tmm(uid, tid, role, at) values(?, ?, ?, ?)', uid, id, role, now);
    q.exec('update tm set members = members + 1' + (role === 'owner' ? ', owner = ?' : '') + ' where id = ?', ...(role === 'owner' ? [uid, id] : [id]));
    return { ok: true, moved: true, id };
  },
  move(q, from, to) {
    from = String(from || ''); to = String(to || '');
    if (!from || !to || from === to) return { ok: true };
    const a = memberOf(q, from), b = memberOf(q, to);
    if (a && !b) { q.exec('update tmm set uid = ? where uid = ?', to, from); q.exec('update tm set owner = ? where owner = ?', to, from); }
    else if (a && b) leaveRow(q, from, a);
    q.exec('update or ignore tsd set uid = ? where uid = ?', to, from); q.exec('delete from tsd where uid = ?', from);
    q.exec('update or ignore tact set uid = ? where uid = ?', to, from); q.exec('delete from tact where uid = ?', from);
    q.exec('update or ignore tmj set uid = ? where uid = ?', to, from); q.exec('delete from tmj where uid = ?', from);
    q.exec('delete from tml where uid = ?', from);
    return { ok: true };
  },
  forget(q, uid) {
    uid = String(uid || ''); if (!uid) return { ok: true };
    const cur = memberOf(q, uid); if (cur) leaveRow(q, uid, cur);
    for (const t of ['tsd', 'tact', 'tmj', 'tml', 'tua', 'tri']) q.exec(`delete from ${t} where uid = ?`, uid);
    return { ok: true };
  },
  // Admin: 'stats' (the weekly numbers of the report), 'list' (teams), 'ann' (approve / refuse an anniversary), 'hide' (a team off every
  // screen and list, e.g. a name that breaks the posting rules).
  admin(q, op, arg = {}, now = Date.now()) {
    const d = kstDay(now);
    if (op === 'stats') {
      const d14 = addDays(d, -13), wd = (() => { const t = new Date(dayStart(d) + 9 * H), dn = (t.getUTCDay() + 6) % 7; return addDays(d, -dn); })();
      const days = all(q, 'select tdc.d d, tdc.tid id, tm.name name, tdc.n n, tdc.k k, tdc.act act from tdc join tm on tm.id = tdc.tid where tdc.d >= ? order by tdc.d desc, tdc.n desc', d14)
        .map((r) => ({ d: String(r.d), id: String(r.id), name: String(r.name), n: Number(r.n) || 0, k: Number(r.k) || 0, act: Number(r.act) || 0 }));
      const goals = all(q, "select d, kind, count(*) n from tach where d >= ? and kind in ('small','big','tower','hot','gold','ann') group by d, kind order by d desc", d14).map((r) => ({ d: String(r.d), kind: String(r.kind), n: Number(r.n) || 0 }));
      const active = Number(one(q, 'select count(distinct tid) n from tdc where d >= ? and n > 0', wd)?.n) || 0;
      const why = all(q, 'select why, count(*) n from tsd where d = ? group by why', d).map((r) => ({ why: String(r.why), n: Number(r.n) || 0 }));
      // D7 / D30 of members: of the accounts that joined a team on day J (J far enough back), the share that supported a team on J+7 / J+30.
      const cohort = (n) => {
        const r = one(q, `select count(distinct j.uid) a, count(distinct s.uid) b from tmj j left join tsd s on s.uid = j.uid and s.d = date(j.d, '+${n} day') where j.d <= ? and j.d >= ?`, addDays(d, -n), addDays(d, -n - 27));
        const a = Number(r?.a) || 0, b = Number(r?.b) || 0;
        return { joined: a, back: b, rate: a ? b / a : null };
      };
      const teams = Number(one(q, 'select count(*) n from tm where hidden = 0')?.n) || 0;
      const members = Number(one(q, 'select count(*) n from tmm')?.n) || 0;
      const wait = all(q, "select tan.tid id, tm.name name, tan.md md, tan.label label, tan.at at from tan join tm on tm.id = tan.tid where tan.st = 'wait' order by tan.at limit 50").map((r) => ({ id: String(r.id), name: String(r.name), md: String(r.md), label: String(r.label || ''), at: Number(r.at) || 0 }));
      const okBy = all(q, "select md, count(*) n from tan where st = 'ok' group by md").reduce((o, r) => { o[String(r.md)] = Number(r.n) || 0; return o; }, {});
      return { ok: true, day: d, teams, members, active, days, goals, why, d7: cohort(7), d30: cohort(30), wait, okBy };
    }
    if (op === 'list') {
      return { ok: true, list: all(q, 'select id, name, members, hidden, at from tm order by members desc, at limit 200').map((r) => ({ id: String(r.id), name: String(r.name), members: Number(r.members) || 0, hidden: Number(r.hidden) ? 1 : 0, at: Number(r.at) || 0 })) };
    }
    if (op === 'ann') {
      const id = String(arg.id || ''), row = one(q, 'select md, st from tan where tid = ?', id);
      if (!row) return { ok: false, error: '그 팀의 기념일 신청이 없어요.' };
      if (arg.ok) {
        const n = Number(one(q, "select count(*) n from tan where md = ? and st = 'ok' and tid <> ?", String(row.md), id)?.n) || 0;
        if (n >= PRIME.annMax) return { ok: false, error: `그날은 이미 ${PRIME.annMax}팀이 승인되어 있어요(정시 23번).` };
        q.exec("update tan set st = 'ok', ok_at = ? where tid = ?", now, id);
      } else q.exec("update tan set st = 'no' where tid = ?", id);
      return { ok: true, id, st: arg.ok ? 'ok' : 'no' };
    }
    if (op === 'hide') {
      const id = String(arg.id || '');
      if (!one(q, 'select id from tm where id = ?', id)) return { ok: false, error: '그 팀이 없어요.' };
      q.exec('update tm set hidden = ? where id = ?', arg.hide === false ? 0 : 1, id);
      return { ok: true, id, hidden: arg.hide === false ? 0 : 1 };
    }
    return { ok: false, error: 'op' };
  },
};
function leaveRow(q, uid, cur) {
  const tid = String(cur.tid);
  q.exec('delete from tmm where uid = ?', uid);
  q.exec('update tm set members = max(0, members - 1) where id = ?', tid);
  if (String(cur.role) === 'owner') {
    const next = one(q, 'select uid from tmm where tid = ? order by at, uid limit 1', tid);
    if (next) { q.exec("update tmm set role = 'owner' where uid = ?", String(next.uid)); q.exec('update tm set owner = ? where id = ?', String(next.uid), tid); }
    else q.exec("update tm set owner = '' where id = ?", tid);
  }
}

// ---- isolate caches ----------------------------------------------------------------------------------------------------
const PAGE = new Map(), PAGE_TTL = 20000;       // id -> { at, v }
const RANKS = new Map(), RANK_TTL = 30000;      // find -> { at, v }
const ME = new Map(), ME_TTL = 5000;            // uid -> { at, v }
const PRIMEC = { at: 0, v: null, key: '' };     // the day's plan
const keep = (m, k, v, max = 300) => { m.delete(k); if (m.size >= max) m.delete(m.keys().next().value); m.set(k, { at: Date.now(), v }); return v; };
const fresh = (m, k, ttl) => { const x = m.get(k); return x && Date.now() - x.at < ttl ? x : null; };
const primeKeyNow = (now) => { const d = kstDay(now), hour = Math.floor((now - dayStart(d)) / H); return d + (hour >= GOLD_HOUR ? 'g' : ''); };
// A write drops what it changed: the team's page and the account's sheet; an admin change (all = true) drops every copy and the plan.
export function teamDrop(id = '', uid = '', all = false) { if (id) PAGE.delete(id); if (uid) ME.delete(uid); if (all) { PAGE.clear(); RANKS.clear(); PRIMEC.at = 0; } }
// The prime part of /rt/world and /rt/prime: one 'team' DO call per isolate a minute at most (10 s in the 9 pm hour until the team is named),
// the last copy at the hard budget level (a copy of another day is not used: the screens then keep their notices).
export async function teamWorld(env, k) {
  const now = Date.now(), key = primeKeyNow(now), c = PRIMEC;
  const ttl = c.v && c.v.plan && c.v.plan.gold === undefined && key.endsWith('g') ? 10000 : 60000;
  if (c.v && c.key === key && now - c.at < ttl) return c.v;
  if (await hard(k, env)) return c.v && c.v.day === kstDay(now) ? c.v : null;
  try { const v = await teamM(env).teamPrime(now); PRIMEC.v = v; PRIMEC.at = now; PRIMEC.key = key; return v; } catch { return c.v && c.v.day === kstDay(now) ? c.v : null; }
}

// ---- routes ------------------------------------------------------------------------------------------------------------
export const teamPath = (p) => p === '/rt/team' || p === '/rt/team/me' || p === '/rt/teams' || p === '/rt/prime' || p === '/rt/admin/teams' || p === '/rt/admin/team' || p.startsWith('/t/');
const actorOf = async (req, k, env) => { try { return await k.resolveActor(env, k.tokenOf(req)); } catch { return null; } };
// An account's creation time (ms): GET /auth/v1/user with the caller's own token and the publishable key (Supabase answers only that user),
// 3 s, 0 when it cannot be read (the support then answers 'wait' and nothing is written). Read once per account: tua keeps it.
async function ageOf(req, k) {
  const t = k.tokenOf(req); if (!t || t.startsWith('g1.') || !k.supa?.url) return 0;
  try { const r = await fetch(k.supa.url + '/auth/v1/user', { headers: { apikey: k.supa.key, authorization: 'Bearer ' + t }, signal: AbortSignal.timeout(3000) }); if (!r.ok) return 0;
    const j = await r.json(); const at = Date.parse(String(j?.created_at || '')); return Number.isFinite(at) && at > 0 ? at : 0; } catch { return 0; }
}
async function readSmall(req, max = 1000) { const n = Number(req.headers.get('content-length') || 0); if (n > max) return null; try { const b = await req.json(); return b && typeof b === 'object' ? b : null; } catch { return null; } }
export async function teamApi(req, env, ctx, u, k) {
  const p = u.pathname;
  if (p.startsWith('/t/')) return sharePage(req, env, u, k);
  if (p === '/rt/admin/teams' || p === '/rt/admin/team') return adminApi(req, env, u, k);
  if (p === '/rt/prime') {
    if (req.method !== 'GET') return J({ err: 'get' }, 405);
    if (!(await opsRate(env, req, 'prime', 120, env.EVENT_RL))) return no('rate', 429);
    const v = await teamWorld(env, k);
    return v ? J({ ok: true, prime: v.plan, lead: v.lead, top: v.top || [], roof: v.roof || '' }) : no('busy', 503);
  }
  if (p === '/rt/teams') {
    if (req.method !== 'GET') return J({ err: 'get' }, 405);
    if (!(await opsRate(env, req, 'teams', 120, env.EVENT_RL))) return no('rate', 429);
    const find = cleanName(u.searchParams.get('q') || '', 16), hit = fresh(RANKS, find, RANK_TTL);
    if (hit) return J(hit.v);
    if (await hard(k, env)) { const any = RANKS.get(find); return any ? J({ ...any.v, busy: true }) : no('busy', 503); }
    try { return J(keep(RANKS, find, await teamM(env).teamRanks(Date.now(), find), 100)); } catch { return no('down', 503); }
  }
  if (p === '/rt/team/me') {
    if (req.method !== 'GET') return J({ err: 'get' }, 405);
    // ?peek=1 (the plaza's entry, main.js askTeamToday): what the team store already has, the same shape. It never reads Supabase and
    // never brings an old 소속 over (no tri, no team row, no membership): an account with no row is "no team". The sheet reads without it.
    const peek = u.searchParams.get('peek') === '1';
    const actor = await actorOf(req, k, env); if (!actor) return no('auth', 401);
    const hit = fresh(ME, actor.id, ME_TTL); if (hit) return J(hit.v);
    if (await hard(k, env)) { const any = ME.get(actor.id); return any ? J({ ...any.v, busy: true }) : no('busy', 503); }
    try {
      const M = teamM(env);
      let v = await M.teamMe(actor.id, Date.now());
      const bring = !v.team && !v.looked && !actor.guest && k.myTribe;
      // An old 소속 (Supabase tribes) is brought over once, the first time an account without a team opens the sheet.
      if (!peek && bring) {
        const tribe = await k.myTribe(env, actor.id).catch(() => null);
        const got = await M.teamBring(actor.id, tribe, Date.now());
        if (got?.moved) v = await M.teamMe(actor.id, Date.now());
      }
      const out = { ...v, guest: !!(actor.guest || actor.anon) };
      // A peek that skipped the bring is not kept: the sheet's read right after must still bring the old 소속 over.
      return J(peek && bring ? out : keep(ME, actor.id, out));
    } catch { return no('down', 503); }
  }
  // GET /rt/team?id=<id>: the public team page.
  if (req.method === 'GET') {
    const id = String(u.searchParams.get('id') || '');
    if (!TEAM_ID.test(id)) return no('team', 404);
    if (!(await opsRate(env, req, 'tpage', 120, env.EVENT_RL))) return no('rate', 429);
    const hit = fresh(PAGE, id, PAGE_TTL); if (hit) return hit.v ? J({ ok: true, team: hit.v }) : no('team', 404);
    if (await hard(k, env)) { const any = PAGE.get(id); return any?.v ? J({ ok: true, team: any.v, busy: true }) : no('busy', 503); }
    try { const v = keep(PAGE, id, await teamM(env).teamPage(id, Date.now())); return v ? J({ ok: true, team: v }) : no('team', 404); } catch { return no('down', 503); }
  }
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const actor = await actorOf(req, k, env); if (!actor) return no('auth', 401);
  if (k.actOk && !(await k.actOk(env, 'misc', actor.id))) return no('rate', 429, { retry: 60 });
  const b = await readSmall(req); if (!b) return J({ ok: false, error: '요청을 읽지 못했어요.' }, 400);
  const op = String(b.op || '');
  if (!['create', 'join', 'leave', 'cheer', 'anniv'].includes(op)) return no('op');
  if (await hard(k, env)) return no('busy', 503);
  const M = teamM(env), now = Date.now(), guest = !!(actor.guest || actor.anon);
  let r;
  try {
    if (op === 'create') r = await M.teamCreate({ uid: actor.id, guest, name: b.name, net: await k.ipHash(env, req), now });
    else if (op === 'join') r = TEAM_ID.test(String(b.id || '')) ? await M.teamJoin({ uid: actor.id, id: String(b.id), now }) : { ok: false, code: 'team' };
    else if (op === 'leave') r = await M.teamLeave({ uid: actor.id, now });
    else if (op === 'anniv') r = await M.teamAnn({ uid: actor.id, md: String(b.md || ''), label: String(b.label || ''), now });
    else {
      const o = { uid: actor.id, guest: !!actor.guest, anon: !!actor.anon, createdAt: 0, net: await k.ipHash(env, req), now };
      r = await M.teamCheer(o);
      if (r?.need === 'age') {
        const at = await ageOf(req, k);
        r = at > 0 ? await M.teamCheer({ ...o, createdAt: at }) : { ok: true, why: 'wait', counted: false };
      }
    }
  } catch { return no('down', 503); }
  if (!r || r.ok === false) return no(r?.code || 'down', r?.code === 'team' ? 404 : r?.code === 'auth' ? 401 : 400, r?.at ? { at: r.at } : {});
  teamDrop(r.team?.id || r.tid || r.left || '', actor.id, op === 'create' || op === 'leave');
  if (op === 'cheer') return J({ ok: true, why: r.why, counted: !!r.counted, n: r.n || 0, act: r.act || 0, rate: rateOf(r.n, r.act), line: supportLine(r.why, { from: r.from || 0 }), ...(r.before ? { before: r.before } : {}) });
  return J(r);
}
async function adminApi(req, env, u, k) {
  if (!k.adminOk(env, req)) return J({ err: 'admin' }, 401);
  const M = teamM(env), now = Date.now();
  try {
    if (u.pathname === '/rt/admin/teams' && req.method === 'GET') {
      const [stats, list] = await Promise.all([M.teamAdmin('stats', {}, now), M.teamAdmin('list', {}, now)]);
      return J({ ...stats, list: list.list || [] });
    }
    if (u.pathname === '/rt/admin/team' && req.method === 'POST') {
      const b = await readSmall(req); if (!b) return J({ ok: false, error: '요청을 읽지 못했어요.' }, 400);
      const op = b.op === 'ann' ? 'ann' : b.op === 'hide' ? 'hide' : '';
      if (!op) return J({ ok: false, error: 'op' }, 400);
      const r = await M.teamAdmin(op, b, now); if (r.ok) teamDrop(String(b.id || ''), '', true);
      return J(r, r.ok ? 200 : 400);
    }
  } catch { return J({ ok: false, error: '불러오지 못했어요.' }, 503); }
  return J({ err: 'not found' }, 404);
}
// Account link and withdrawal (worker.js waitUntil).
export async function teamMove(env, from, to) { try { await teamM(env).teamMove(String(from || ''), String(to || '')); teamDrop('', String(from || '')); teamDrop('', String(to || '')); } catch { /* the membership stays with the guest id */ } }
export async function teamForget(env, uid) { try { await teamM(env).teamForget(String(uid || '')); teamDrop('', String(uid || ''), true); } catch { /* the rows age out after PRIME.keepDays */ } }

// ---- the share page /t/<id> --------------------------------------------------------------------------------------------
// A link preview (KakaoTalk, X) reads the team's name and today's count; a person is sent on to the plaza with the team page open.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function sharePage(req, env, u, k) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method', { status: 405 });
  const id = u.pathname.slice(3).replace(/\/+$/, ''), origin = u.origin;
  if (!TEAM_ID.test(id)) return Response.redirect(origin + '/', 302);
  if (!(await opsRate(env, req, 'tshare', 120, env.EVENT_RL))) return Response.redirect(origin + '/?team=' + id, 302);
  let t = fresh(PAGE, id, PAGE_TTL)?.v;
  if (t === undefined && !(await hard(k, env))) { try { t = keep(PAGE, id, await teamM(env).teamPage(id, Date.now())); } catch { t = null; } }
  const to = origin + '/?team=' + id;
  const title = t ? `${t.name} 응원 팀 · WISH BOARD` : '응원 팀 · WISH BOARD';
  const n = t ? Math.floor(Number(t.today?.n) || 0) : 0, ng = t?.today?.next;
  const desc = t ? `오늘 서로 다른 ${n.toLocaleString('en-US')}명이 응원했어요.${ng ? ` ${ng.at.toLocaleString('en-US')}명까지 ${ng.left.toLocaleString('en-US')}명 남았어요.` : ''} 함께 응원하면 가상 타임스퀘어 명당에 팀 이름이 걸려요.` : '가상 타임스퀘어에서 함께 응원하고 명당에 팀 이름을 걸어 보세요.';
  const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title>'
    + '<meta name="robots" content="noindex, nofollow"><meta name="description" content="' + esc(desc) + '"><meta property="og:type" content="website"><meta property="og:site_name" content="WISH BOARD">'
    + '<meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(desc) + '"><meta property="og:image" content="' + esc(origin + '/og.jpg?v=4') + '"><meta property="og:url" content="' + esc(origin + '/t/' + id) + '">'
    + '<meta name="twitter:card" content="summary_large_image"><meta http-equiv="refresh" content="0;url=' + esc(to) + '"></head><body style="background:#070a18;color:#eef0fb;font-family:sans-serif"><p><a style="color:#ffb020" href="' + esc(to) + '">' + esc(t ? t.name + ' 팀 페이지 열기' : '광장으로') + '</a></p><script>location.replace(' + JSON.stringify(to) + ')</script></body></html>';
  return new Response(req.method === 'HEAD' ? null : html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
