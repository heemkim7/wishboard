// Board report for its holder, and the shop templates of the claim wizard. Bundled by the Worker too, so it is imported with no query.
// The rooms count views (taxi drop-offs at the board), paid link visits and paid cheers per slot in one-minute buckets, and hand them to the Meter
// instance 'ad' in the ad_stat_batch rhythm (Room.flushAds). Tables there, all keyed by slot:
//   ads(slot, d, v, c, h, p)  per KST day: views, link clicks, cheers, people (distinct accounts that did any of the three that day)
//   adu(slot, d, u)           today's people, as a hash of the account id; rows of earlier days are deleted on every ingest
//   adh(slot, holder, since)  whose tenure the rows belong to. A new holder starts from nothing, so nobody sees the previous holder's numbers.
// These are game counts (accounts, not people or networks), not audited figures.
import { SLOT_IDS } from './balance.js';
import { wishDay as dayOf } from './wish.js'; // the KST day, YYYY-MM-DD

export const AD = { keep: 35, days: 14, small: 10, items: 200, people: 400 };
const SLOTS = new Set(SLOT_IDS);
const shift = (day, n) => new Date(Date.parse(day) + n * 864e5).toISOString().slice(0, 10);
const num = (v) => Math.min(100000, Math.max(0, Math.floor(Number(v)) || 0));
const minute = (b) => Number.isInteger(b) && b > 0 ? b : 0;

export function adTables(q) {
  q.exec('create table if not exists ads(slot text not null, d text not null, v integer not null default 0, c integer not null default 0, h integer not null default 0, p integer not null default 0, primary key(slot, d))');
  q.exec('create table if not exists adu(slot text not null, d text not null, u text not null, primary key(slot, d, u))');
  q.exec("create table if not exists adh(slot text primary key, holder text not null default '', since integer not null)");
}
export async function adHash(uid) {
  const dig = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ad|' + String(uid))));
  let hex = ''; for (const b of dig.subarray(0, 8)) hex += b.toString(16).padStart(2, '0');
  return hex;
}
const tenure = (q, slot) => q.exec('select holder, since from adh where slot = ?', slot).toArray()[0] || null;
// Bucket b counts for the tenure only if its minute started at or after the tenure began: the claim's own minute may hold the previous
// holder's events, so the new holder loses up to a minute rather than seeing anyone else's. A slot first seen here opens a tenure with no
// holder; only a claim by the holder who already held it (prev === claimer) adopts it, a report never does.
function open(q, slot, b) {
  let t = tenure(q, slot);
  if (!t) { q.exec("insert into adh(slot, holder, since) values(?, '', ?)", slot, b * 60000); t = { holder: '', since: b * 60000 }; }
  return b * 60000 >= Number(t.since);
}
function bump(q, slot, d, v, c, h, p) {
  q.exec('insert into ads(slot, d, v, c, h, p) values(?, ?, ?, ?, ?, ?) on conflict(slot, d) do update set v = v + excluded.v, c = c + excluded.c, h = h + excluded.h, p = p + excluded.p', slot, d, v, c, h, p);
}
// items [{ s: slot, b: minute bucket, v, c, h }], people [{ s, d: KST day, u: account id, b }]. Returns what was counted.
export async function adIngest(q, items, people, now = Date.now()) {
  const today = dayOf(now), oldest = shift(today, -(AD.keep - 1)); let n = 0, p = 0;
  for (const it of (Array.isArray(items) ? items : []).slice(0, AD.items)) {
    const slot = String(it?.s || ''), b = minute(it?.b); if (!SLOTS.has(slot) || !b) continue;
    const d = dayOf(b * 60000), v = num(it.v), c = num(it.c), h = num(it.h); if (d < oldest || d > today || !(v || c || h) || !open(q, slot, b)) continue;
    bump(q, slot, d, v, c, h, 0); n++;
  }
  for (const it of (Array.isArray(people) ? people : []).slice(0, AD.people)) {
    const slot = String(it?.s || ''), b = minute(it?.b), uid = String(it?.u || ''); if (!SLOTS.has(slot) || !b || !uid || it.d !== today || dayOf(b * 60000) !== today || !open(q, slot, b)) continue;
    if (q.exec('insert or ignore into adu(slot, d, u) values(?, ?, ?)', slot, today, await adHash(uid)).rowsWritten) { bump(q, slot, today, 0, 0, 0, 1); p++; }
  }
  q.exec('delete from adu where d < ?', today);
  q.exec('delete from ads where d < ?', oldest);
  return { ok: true, n, p };
}
const wipe = (q, slot, holder, at) => { q.exec('delete from ads where slot = ?', slot); q.exec('delete from adu where slot = ?', slot);
  q.exec('insert into adh(slot, holder, since) values(?, ?, ?) on conflict(slot) do update set holder = excluded.holder, since = excluded.since', slot, holder, at); };
// A claim (or an approved review) made `holder` the holder; prev is who held it before. The record is kept only when the claimer held it
// right before (prev is the claimer: extending or re-claiming one's own board). A claim on a board with no previous holder starts fresh, since
// a lost hook may have left someone else's events in the stored tenure. An unnamed tenure is adopted on the same rule. Else a new tenure at `at`.
export function adTenure(q, slot, holder, prev = '', at = Date.now()) {
  const s = String(slot || ''), who = String(holder || ''), was = String(prev || ''); if (!SLOTS.has(s) || !who) return { ok: false };
  const t = tenure(q, s);
  if (t && t.holder === who && was === who) return { ok: true, kept: true };
  if (t && !t.holder && was === who) { q.exec('update adh set holder = ? where slot = ?', who, s); return { ok: true, kept: true }; }
  wipe(q, s, who, at); return { ok: true, kept: false };
}
// Account withdrawal: the boards this account's tenures covered lose their record (rows deleted, not left unnamed for someone to adopt).
export function adForget(q, uid) {
  const u = String(uid || ''); if (!u) return { ok: false, n: 0 };
  const slots = q.exec('select slot from adh where holder = ?', u).toArray().map((r) => String(r.slot));
  for (const s of slots) { q.exec('delete from ads where slot = ?', s); q.exec('delete from adu where slot = ?', s); q.exec('delete from adh where slot = ?', s); }
  return { ok: true, n: slots.length };
}
// Account link: the boards merge_guest_account moved keep their report.
export function adRename(q, from, to) {
  const f = String(from || ''), t = String(to || ''); if (!f || !t || f === t) return { ok: false };
  q.exec('update adh set holder = ? where holder = ?', t, f); return { ok: true };
}
const ZERO = () => ({ views: 0, clicks: 0, cheers: 0, people: 0 });
// The report for `holder`, who the Worker checked holds the slot now. A tenure that is not named for this holder (someone else's, or unnamed
// because the claim hook never landed) is closed here and a new one starts now.
export function adReport(q, slot, holder, now = Date.now(), n = AD.days) {
  const s = String(slot || ''), who = String(holder || ''); if (!SLOTS.has(s) || !who) return null;
  let t = tenure(q, s);
  if (!t || t.holder !== who) { wipe(q, s, who, now); t = { holder: who, since: now }; }
  const today = dayOf(now), first = shift(today, -(n - 1)), from = dayOf(Number(t.since)), total = ZERO(), days = [];
  for (const r of q.exec('select d, v, c, h, p from ads where slot = ? order by d', s).toArray()) {
    const row = { day: String(r.d), views: Number(r.v) || 0, clicks: Number(r.c) || 0, cheers: Number(r.h) || 0, people: Number(r.p) || 0 };
    for (const k of Object.keys(total)) total[k] += row[k];
    if (row.day >= first && row.day >= from) days.push(row);
  }
  return { days, total, since: new Date(Number(t.since)).toISOString(), today };
}
// UI: today / last 7 / last 14 days from report.days (days missing from the list had nothing).
export function adSums(days, today) {
  const out = { today: ZERO(), d7: ZERO(), d14: ZERO() };
  for (const r of Array.isArray(days) ? days : []) {
    const age = Math.round((Date.parse(today) - Date.parse(r.day)) / 864e5); if (!(age >= 0 && age < 14)) continue;
    for (const k of Object.keys(out.d14)) { const v = Number(r[k]) || 0; out.d14[k] += v; if (age < 7) out.d7[k] += v; if (age === 0) out.today[k] += v; }
  }
  return out;
}
// 14 bars, oldest first: { day, n (views + clicks + cheers), before (ahead of this tenure) }.
export function adBars(days, today, since, n = AD.days) {
  const by = new Map((Array.isArray(days) ? days : []).map((r) => [r.day, (Number(r.views) || 0) + (Number(r.clicks) || 0) + (Number(r.cheers) || 0)]));
  const from = since ? dayOf(Date.parse(since)) : today, out = [];
  for (let i = n - 1; i >= 0; i--) { const day = shift(today, -i); out.push({ day, n: by.get(day) || 0, before: day < from }); }
  return out;
}

// Claim wizard step 2: three editable lines (16 characters each). They still pass the wizard's length and banned-word checks.
export const AD_TEMPLATES = [
  { key: 'shop', label: '가게 홍보', lines: ['우리 가게 이름', '오늘만 아메리카노 1+1', '골목 안 2층'] },
  { key: 'event', label: '이벤트', lines: ['주말 이벤트', '첫 방문 10% 할인', '토·일 오후 2시~6시'] },
  { key: 'hire', label: '구인', lines: ['함께 일할 분 찾아요', '주말 홀 아르바이트', 'DM으로 연락 주세요'] },
  { key: 'party', label: '축하', lines: ['생일 축하해요!', '오늘의 주인공 ○○', '늘 고마워요'] },
  { key: 'cheer', label: '응원', lines: ['오늘도 힘내요!', '시험 합격 기원', '우리가 응원해요'] },
];
