import { BALANCE } from './balance.js';
import { WISH, cleanWish } from './wish.js';
import { inviteNews } from './invite.js';

let blockedText = () => false;
try {
  ({ blockedText } = await import('./plaza-account.js'));
} catch {
  ({ blockedText } = await import('./plaza-account.js'));
}

export function lockCelebration(ms) {
  const n = Math.floor(Number(ms));
  return n === 5000 ? 5000 : 0;
}

// Why three board lines cannot go up, or '' when they can: 'long' (a line over 16), 'empty' (all three blank: a board needs
// at least one line, so the free slot is never spent on a blank board), 'blocked' (a word the plaza does not show).
export const LINES_ERR = { long: '줄마다 16자까지예요', empty: '한 줄은 적어 주세요', blocked: '쓸 수 없는 문구가 있어요' };
export function linesFault(a, b, c) {
  const rows = [a, b, c].map((s) => String(s ?? ''));
  if (rows.some((s) => [...s].length > 16)) return 'long';
  if (!rows.some((s) => s.trim())) return 'empty';
  if (rows.some((s) => blockedText(s))) return 'blocked';
  return '';
}

export function claimWizard(slot) {
  const state = { step: 1, slot: String(slot || ''), lines: ['', '', ''], emoji: '✨', theme: 'cyber_navy' };
  return {
    get step() { return state.step; },
    get slot() { return state.slot; },
    get free() { return BALANCE.starterSlots.includes(state.slot); }, // live: the server list can arrive while the wizard is open
    get mode() { return this.free ? 'starter' : 'claim'; },
    // The lines as last kept: step 2 fills its boxes from here, so 이전 and 다음 never lose what was typed.
    get lines() { return state.lines.slice(); },
    choose(id) { state.slot = String(id || ''); state.step = 1; },
    // A draft kept as typed (going back from step 2); it is checked again before step 3.
    keep(a, b, c) { state.lines = [a, b, c].map((s) => String(s ?? '')); },
    linesOk(a, b, c) {
      if (linesFault(a, b, c)) return false;
      state.lines = [a, b, c].map((s) => String(s ?? ''));
      return true;
    },
    next() { if (state.step < 3) state.step += 1; return state.step; },
    payload() {
      return { slot_id: state.slot, bid: this.free ? 0 : undefined, mode: this.mode, line1: state.lines[0], line2: state.lines[1], line3: state.lines[2], emoji: state.emoji, bg_theme: state.theme };
    },
  };
}

// The 60-second takeover's second step (the price is the one main.js and the Worker take: 5000 coins or one VIP ticket).
// ok: what it costs and what is left after it; not ok: the line shown under the card instead.
export const AIR_PRICE = 5000;
export function airAsk({ line, pay, have, tickets } = {}) {
  const text = String(line ?? '').trim();
  const coins = Math.max(0, Math.floor(Number(have) || 0));
  const t = Math.max(0, Math.floor(Number(tickets) || 0));
  const n = (v) => v.toLocaleString('ko-KR');
  if (!text) return { ok: false, err: '한 줄을 적어 주세요' };
  if (blockedText(text)) return { ok: false, err: '그 문구는 올릴 수 없어요' };
  if (pay === 'ticket') {
    if (t < 1) return { ok: false, err: 'VIP 티켓이 없어요' };
    return { ok: true, text, cost: 'VIP 티켓 1장', after: `남는 티켓 ${n(t - 1)}장` };
  }
  if (coins < AIR_PRICE) return { ok: false, err: `${n(AIR_PRICE)}포인트가 필요해요. 지금 ${n(coins)}포인트` };
  return { ok: true, text, cost: `${n(AIR_PRICE)}포인트`, after: `쓴 뒤 잔액 ${n(coins - AIR_PRICE)}포인트` };
}

// Photo ads sent for review, remembered on this device as { slot, id, who, at }, so the result is told even when the review
// came while the player was away. rows: the plaza's billboards; me: my actor id (only a guest:/user: id decides anything).
// Returns the entries still waiting and the results to tell once: 'on' (approved, on air), 'off' (refused, the fee came back),
// 'lost' (the board left me before the review; the photo went down with it). Entries older than 14 days are dropped quietly.
export const PHOTO_WAIT_MS = 14 * 864e5;
export function photoVerdicts(wait, rows, me, now = Date.now()) {
  const boards = Array.isArray(rows) ? rows : [];
  const known = /^(guest|user):/.test(String(me || ''));
  const keep = [], told = [];
  for (const w of Array.isArray(wait) ? wait : []) {
    if (!w || typeof w !== 'object' || !w.slot || !w.id) continue;
    if (!(now - (Number(w.at) || 0) <= PHOTO_WAIT_MS)) continue;
    const row = boards.find((b) => b?.slot_id === w.slot);
    if (!known || !row) { keep.push(w); continue; }
    const tell = (kind) => told.push({ slot: w.slot, id: w.id, kind });
    const mine = !!row.holder_id && (row.holder_id === me || row.holder_id === w.who);
    if (!mine) {
      // Sent as someone else (signed out since): this browser cannot tell what happened, so it keeps waiting.
      if (!w.who || w.who === me) tell('lost'); else keep.push(w);
      continue;
    }
    if (row.photo_id === w.id && row.photo_status === 'pending') keep.push(w);
    else if (row.photo_id === w.id && row.photo_status === 'approved') tell('on');
    else tell('off');
  }
  return { wait: keep, told };
}

// KST calendar day, YYYY-MM-DD. The daily missions and the tutorial both count days this way: wish.js wishDay, the one rule the Worker uses.
export { wishDay as kstDay } from './wish.js';

// Pass the kts_daily snapshot read before this session's attend(), which writes streak 1 for everyone.
export function playedEarlierDay(before, day) {
  return !!(before && typeof before === 'object' && before.last && before.last !== day);
}
export function ftueDue(flag, before, day) {
  if (flag) return false;
  if (!before || typeof before !== 'object') return true;
  if (playedEarlierDay(before, day)) return false;
  return !((before.earn | 0) || (before.bake | 0) || (before.play | 0));
}

// Newcomer mode: no board held and no kts_grad flag. It ends on the first claim, 30 points from cheering and watching today (balance.js
// countsAsActivity; play pays none), or the tap.
export const GRAD_EARN = 30;
export function newcomer({ grad, held } = {}) { return !grad && !(held > 0); }
// Boards unknown is not "no boards": decide only once the plaza and the real actor id are in.
// net.id starts as a temporary client id; only guest:/user: ids say whose boards to count.
export function newcomerKnown({ plazaReady, actor } = {}) { return !!(plazaReady && /^(guest|user):/.test(String(actor || ''))); }
// Silent graduation at load: someone who played on an earlier day, or an old player whose kts_daily predates the `last` field.
// A kts_ftue written today (armFtue writes it when the tutorial is not due) is not enough on its own.
export function silentGrad({ ftue, daily, day } = {}) {
  if (playedEarlierDay(daily, day)) return true;
  return !!ftue && !(daily && typeof daily === 'object' && daily.last);
}
export function graduation({ grad, held, earn } = {}) {
  if (grad) return '';
  if (held > 0) return 'claim';
  return (Number(earn) || 0) >= GRAD_EARN ? 'earn' : '';
}

// Tutorial flag lifecycle: on at start; off when armFtue skips it, on the first claim, on graduation,
// or when the walk to the free slot after the bake pay ends (waypoint reached or cleared). Bake pay itself keeps it on,
// so the line that points at the free slot stays on the card.
export function tutorialNext(on, ev) {
  if (ev === 'start') return true;
  if (ev === 'skip' || ev === 'claim' || ev === 'grad' || ev === 'walkDone') return false;
  return !!on;
}
// What tapping the tutorial line does: bake at the cart, put back a cleared tutorial waypoint, else the next goal.
export function tutorialTap({ atCart, waypoint, tutorialWp } = {}) {
  if (atCart) return 'bake';
  if (tutorialWp && !waypoint) return 'waypoint';
  if (waypoint) return 'pulse';
  return 'goal';
}

// The newcomer card shows the first step that has something to say.
export function firstStep(steps) {
  for (const step of steps || []) {
    const s = step();
    if (s) return s;
  }
  return null;
}

// Public counts are shown only once they help: a lone visitor reads "1명" as an empty plaza.
export const PUBLIC_MIN = { visitors: 20, crowd: 3, wishes: 5 };
export function crowdFacts(src) {
  const out = {};
  for (const k of Object.keys(PUBLIC_MIN)) {
    const n = Math.max(0, Math.floor(Number(src?.[k])) || 0);
    out[k] = n >= PUBLIC_MIN[k] ? n : 0;
  }
  return out;
}
export function peopleTag(n) {
  const v = Math.floor(Number(n)) || 0;
  return v > 1 ? `${v}명` : '';
}

export function goalLine(goal) {
  if (!goal?.name) return '응원 포인트를 모아 전광판에 이름을 걸어 보세요';
  const left = Math.max(0, Math.floor(Number(goal.left) || 0));
  return left ? `${goal.name}까지 ${left.toLocaleString('ko-KR')}포인트 더 모으면 걸 수 있어요` : `${goal.name}에 이름을 걸 수 있어요`;
}

// ---- 오늘의 소원: decisions the wish screens make, kept here so they can be tested without a DOM.
// The newcomer card asks for a wish first, but only once the server said there is none and the sheet was not closed this session.
// Not while the server is saving its budget (busy): the sheet would have no form.
export const WISH_STEP = '오늘의 소원 한 줄 걸기 (무료)';
export function wishStep({ known, mine, skipped, busy } = {}) { return known && !mine && !skipped && !busy ? WISH_STEP : ''; }
// Right after the arrival intro a newcomer gets the wish sheet once, unless a link brought them somewhere else, a wish is already up,
// or the sheet was closed without a wish this session (kts_wish_skip): a skipped sheet does not come back on the next entry.
export function wishAutoOpen({ newbie, known, mine, deep, skipped } = {}) { return !!newbie && !deep && !skipped && !(known && mine); }
// Boot card: a friend's wish from the link, else yesterday's winner, else today's count once it is big enough, else nothing.
// The heart label only when a heart can follow: a wish from today (day unknown counts as today) and no ?focus= taking over.
export function wishBootLine({ deep, king, count, day, focus } = {}) {
  const who = (w) => String(w?.nick || '') || '누군가';
  const hearts = (w) => Math.max(0, Math.floor(Number(w?.hearts) || 0));
  if (deep?.txt && !deep.hidden) {
    const open = !focus && !(deep.day && day && deep.day !== day);
    return { kind: 'deep', text: `🌠 ${who(deep)}님의 소원 · “${deep.txt}” · ♥ ${hearts(deep)}`, enter: open ? '입장해서 하트 보내기' : '' };
  }
  if (king?.txt) return { kind: 'king', text: `👑 어제의 소원왕 ${who(king)} · “${king.txt}”`, enter: '' };
  const n = Math.max(0, Math.floor(Number(count)) || 0);
  if (n >= PUBLIC_MIN.wishes) return { kind: 'count', text: `오늘 걸린 소원 ${n.toLocaleString('ko-KR')}개`, enter: '' };
  return { kind: '', text: '', enter: '' };
}
// Can this player send a heart to this wish? ok, the reason shown under a big button, and a short label for a list row.
export function wishHeart({ wish, given, left, day } = {}) {
  if (!wish?.id) return { ok: false, why: '', short: '♥' };
  if (wish.mine) return { ok: false, why: '내 소원이에요', short: '내 소원' };
  if (Array.isArray(given) && given.includes(wish.id)) return { ok: false, why: '이미 하트를 보냈어요', short: '♥ 보냄' };
  if (wish.hidden) return { ok: false, why: '가려진 소원이에요', short: '가려짐' };
  if (day && wish.day && wish.day !== day) return { ok: false, why: '어제 소원이라 하트는 닫혔어요', short: '닫힘' };
  if (!(Number(left) > 0)) return { ok: false, why: '오늘 하트를 다 썼어요. 내일 다시 5개가 생겨요.', short: '♥' };
  return { ok: true, why: '', short: '♥ 보내기' };
}
// The input as typed: n = code points the server will keep (cleanWish), value = what the box should hold.
// Under the limit the box is left alone (spaces mid-typing survive); at the limit it is cut to the shortest prefix that cleans to the same line.
export function wishDraft(raw) {
  const s = String(raw ?? '');
  const text = cleanWish(s);
  const n = Array.from(text).length;
  if (n < WISH.maxLen) return { text, n, value: s };
  const cps = Array.from(s);
  for (let i = 1; i <= cps.length; i++) {
    const head = cps.slice(0, i).join('');
    if (cleanWish(head) === text) return { text, n, value: head };
  }
  return { text, n, value: s };
}
// Share sheet first; a cancel stops there. Then the clipboard; then the caller shows the link to copy by hand.
export async function shareWish({ nav, clip, data } = {}) {
  if (typeof nav?.share === 'function') {
    try { await nav.share(data); return 'shared'; }
    catch (e) { if (e?.name === 'AbortError') return 'cancel'; }
  }
  let ok = false;
  try { ok = !!(await clip?.(`${data?.text || ''} ${data?.url || ''}`.trim())); } catch { ok = false; }
  return ok ? 'copied' : 'manual';
}

// DOM replaceChildren/append turn null into the text "null". Every optional child goes through this first.
export function present(...nodes) { return nodes.flat(Infinity).filter((n) => n != null && n !== false && n !== ''); }
// A message line: missing text is an empty line, never "null" or "undefined".
export function msgText(v) { return v == null || v === false ? '' : String(v); }

// ---- 알림 제안: when the push sheet may open by itself.
// 'open' now, 'wait' until the screen is free (another sheet, the proof bar, a celebration), or 'no' for this moment.
export const PUSH_BACKOFF = 3 * 864e5;
// placement 'inline' (the row in the my-wish card) is not a pop-up: allowed in newcomer mode and while a sheet is up,
// but only when the browser would really ask (permission 'default'). queuedAt: a queued sheet offer expires after PUSH_QUEUE_MS.
export const PUSH_QUEUE_MS = 60e3;
export function pushAsk({ supported, permission, offered, dismissedAt, now = Date.now(), busy, newbie, placement, queuedAt } = {}) {
  if (!supported) return 'no';
  if (permission === 'denied' || permission === 'granted') return 'no';
  if (offered) return 'no';
  const at = Number(dismissedAt) || 0;
  if (at > 0 && now >= at && now - at < PUSH_BACKOFF) return 'no';
  if (placement === 'inline') return permission === 'default' ? 'open' : 'no';
  if (newbie) return 'no';
  const q = Number(queuedAt) || 0;
  if (q > 0 && now - q > PUSH_QUEUE_MS) return 'no';
  return busy ? 'wait' : 'open';
}
// The line at the top of the push sheet for each moment.
export const PUSH_WHY = Object.freeze({
  wish: '하트가 오면 바로 알려 드릴까요?',
  claim: '내 전광판 불이 꺼지기 전에 알려 드릴까요?',
  share: '내 전광판 불이 꺼지기 전이나 소원에 하트가 오면 바로 알려 드릴까요?',
});

// ---- 다녀간 사이: what the sheet after entering shows. Pure; main.js stores what it returns.
export const AWAY_MAX = 6;
export const AWAY_DAYS = 7;
const AWAY_LOOK = new Set(['cheer', 'reply', 'gift', 'dark']);
// Live INBOX socket messages carry no id. When one is shown in play, this key (kind, slot, second) is kept, and the
// stored row of the same kind and slot within LIVE_WINDOW of it counts as already seen.
export const LIVE_WINDOW = 5 * 60e3;
export function liveKey(m, at = Date.now()) {
  const kind = String(m?.kind || ''), slot = String(m?.slot_id || '');
  return kind && slot ? `${kind}|${slot}|${Math.floor(Number(at) / 1000)}` : '';
}
export function liveSeenAdd(list, key, cap = 30) {
  const out = (Array.isArray(list) ? list : []).filter((k) => typeof k === 'string' && k);
  if (key && !out.includes(key)) out.push(key);
  return out.slice(-cap);
}
function seenLive(liveSeen, kind, slot, at) {
  if (!Number.isFinite(at)) return false;
  for (const k of Array.isArray(liveSeen) ? liveSeen : []) {
    const [a, b, c] = String(k).split('|');
    if (a === kind && b === slot && Math.abs(Number(c) * 1000 - at) <= LIVE_WINDOW) return true;
  }
  return false;
}
// holder(slot) -> who holds that board now (rows about a board I hold again are already handled); me -> my actor id.
// invite: the GET /rt/invite summary (recent = payment times), invSeen: the newest payment time shown before (kts_inv_seen).
export function awayRows({ newbie, inbox, seen, copy, wish, wishSeen, prizeDay, day, now = Date.now(), holder, me, liveSeen, invite, invSeen } = {}) {
  const none = { rows: [], inboxIds: [], wishSeen: null, prizeDay: '' };
  if (newbie) return none;
  const read = new Set((Array.isArray(seen) ? seen : []).map((id) => Math.floor(Number(id))));
  const text = typeof copy === 'function' ? copy : () => '';
  const rows = [];
  const handled = [];
  const byKey = new Map();
  for (const m of Array.isArray(inbox) ? inbox : []) {
    const id = Math.floor(Number(m?.id));
    const slot = String(m?.slot_id || '');
    if (!(id > 0) || read.has(id) || !slot) continue;
    const at = Date.parse(m.created_at || '');
    if (Number.isFinite(at) && now - at > AWAY_DAYS * 864e5) continue;
    const line = String(text(m) || '');
    if (!line) continue;
    const kind = m.kind === 'taken' ? 'taken' : AWAY_LOOK.has(m.kind) ? 'look' : '';
    if (!kind) continue;
    // Already handled: a board I hold again, or the same news seen live during play.
    if ((kind === 'taken' && me && typeof holder === 'function' && holder(slot) === me) || seenLive(liveSeen, m.kind, slot, at)) { handled.push(id); continue; }
    const row = { kind, id, slot, text: line, label: '보러가기', at: Number.isFinite(at) ? at : 0, also: [] };
    const key = m.kind + '|' + slot;
    const prev = byKey.get(key);
    if (prev) {
      // One row per kind and board: the newest stays, the older ids ride along so they are marked read with it.
      if (row.at > prev.at) { row.also = [prev.id, ...prev.also]; rows[rows.indexOf(prev)] = row; byKey.set(key, row); }
      else prev.also.push(id);
      continue;
    }
    byKey.set(key, row);
    rows.push(row);
  }
  const mine = wish?.mine;
  const hearts = Math.max(0, Math.floor(Number(mine?.hearts) || 0));
  let nextSeen = null;
  if (mine?.id && !mine.hidden) {
    const base = wishSeen && wishSeen.id === mine.id ? Math.max(0, Math.floor(Number(wishSeen.hearts) || 0)) : 0;
    const gain = hearts - base;
    if (gain > 0) {
      rows.push({ kind: 'wish', id: 0, slot: '', text: `내 소원에 하트가 ${gain}개 늘었어요 (지금 ${hearts}개)`, label: '내 소원 보기', at: now });
      nextSeen = { id: mine.id, hearts };
    }
  }
  const won = (Array.isArray(wish?.yesterday) ? wish.yesterday : []).find((y) => y?.mine && Math.floor(Number(y.rank)) > 0);
  let nextPrize = '';
  if (won && day && prizeDay !== day) {
    const rank = Math.floor(Number(won.rank));
    const prize = Math.max(0, Math.floor(Number(won.prize) || 0));
    const at = Date.parse(day + 'T00:00:00+09:00');
    rows.push({ kind: 'prize', id: 0, slot: '', text: prize ? `어제 소원이 ${rank}위였어요. +${prize} 포인트` : `어제 소원이 ${rank}위였어요`, label: mine?.id ? '내 소원 보기' : '오늘 소원 걸기', at: Number.isFinite(at) ? at : now - 1 });
    nextPrize = day;
  }
  const inv = inviteNews(invite, invSeen);
  if (inv) rows.push(inv);
  rows.sort((a, b) => b.at - a.at);
  const shown = rows.slice(0, AWAY_MAX);
  return {
    rows: shown,
    inboxIds: [...shown.filter((r) => r.id > 0).flatMap((r) => [r.id, ...(r.also || [])]), ...handled],
    wishSeen: shown.some((r) => r.kind === 'wish') ? nextSeen : null,
    prizeDay: shown.some((r) => r.kind === 'prize') ? nextPrize : '',
    ...(inv && shown.includes(inv) ? { invSeen: inv.at } : {}),
  };
}
// Inbox rows the 🔔 tool counts as new: not seen in this browser and from the last AWAY_DAYS days.
export function inboxUnread(inbox, seen, now = Date.now()) {
  const read = new Set((Array.isArray(seen) ? seen : []).map((id) => Math.floor(Number(id))));
  return (Array.isArray(inbox) ? inbox : []).filter((m) => {
    const id = Math.floor(Number(m?.id));
    if (!(id > 0) || read.has(id)) return false;
    const at = Date.parse(m.created_at || '');
    return !(Number.isFinite(at) && now - at > AWAY_DAYS * 864e5);
  }).length;
}
// Seen inbox ids kept in this browser (newest last, capped).
export function seenAdd(seen, ids, cap = 60) {
  const out = (Array.isArray(seen) ? seen : []).map((id) => Math.floor(Number(id))).filter((id) => id > 0);
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = Math.floor(Number(raw));
    if (id > 0 && !out.includes(id)) out.push(id);
  }
  return out.slice(-cap);
}

// The walk to the free slot ends at its waypoint. `at` is the waypoint the world says was reached (not one cleared by
// hand), `free` the slot the tutorial pointed at. 'open' = open the claim wizard for it; 'park' = reached in a taxi,
// so say to get out; '' = not this waypoint, the slot was taken meanwhile, the starter is used, or the screen is busy.
export function walkArrival({ at, free, taken, starterOk = true, busy = false } = {}) {
  if (!free?.id || !at || !Number.isFinite(at.x) || !Number.isFinite(at.z)) return '';
  if (Math.hypot(at.x - free.x, at.z - free.z) > 1) return '';
  if (taken || !starterOk || busy) return '';
  return at.driving ? 'park' : 'open';
}

export function startFtue(ctx) {
  const { ui, world, balance, touch } = ctx;
  ui.setNextLine?.('붕어빵 포차로 가 보세요');
  world.setWaypoint?.(balance ? { x: 21, z: 118 } : { x: 21, z: 118 });
  let here = false;
  let free = null; // the free slot the last waypoint points at: { id, x, z }
  return {
    // main.js passes the world's "waypoint reached" here. At the free slot the claim wizard opens by itself.
    onWaypoint(at) {
      const goal = ui.nextGoal?.() || null;
      const act = walkArrival({ at, free, taken: !!world.boardView?.(free?.id)?.holder_id, starterOk: !goal || !!goal.free, busy: !!ui.isBusy?.() });
      if (!act) return '';
      const id = free.id;
      free = null;
      if (act === 'open') ui.openClaimStep?.(1, claimWizard(id));
      else ui.note?.('무료 칸 앞이에요. 택시에서 내린 뒤 E를 누르면 걸 수 있어요', 'ok');
      return act;
    },
    onArrive() {
      if (here) return;
      here = true;
      ui.setNextLine?.(touch ? '여기서 붕어빵을 구워 보세요' : '여기서 E를 눌러 붕어빵을 구우세요');
      // The panel opens with the needle parked; it starts moving (and the session starts) on the player's first tap.
      ui.startBake?.({ wait: true });
    },
    onBakePay() {
      // ui.nextGoal() knows whether this player may still take a starter slot; without it, trust the boards.
      const goal = ui.nextGoal?.() || null;
      const starterOk = !goal || goal.free;
      const id = starterOk ? BALANCE.starterSlots.find((slot) => !world.boardView?.(slot)?.holder_id) : '';
      const card = id ? world.slotCard?.(id) : null;
      if (card && Number.isFinite(card.x) && Number.isFinite(card.z)) {
        free = { id, x: card.x, z: card.z };
        world.setWaypoint?.({ x: card.x, z: card.z });
        ui.setNextLine?.('하늘색 기둥을 따라 무료 칸으로 가세요');
        return;
      }
      world.setWaypoint?.(null);
      ui.setNextLine?.(id ? '메인거리 무료 칸에 이름을 걸어 보세요' : goalLine(goal && !goal.free ? goal : null));
      // No walk to wait for, so 'walkDone' would never come: end the tutorial here and let the card show the next goal.
      ui.tutorial?.('walkDone');
    },
  };
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('ftue.js')) {
  const day = '2026-11-20';
  if (ftueDue('', null, day) !== true) throw new Error('new');
  if (ftueDue('1', null, day) !== false) throw new Error('flag');
  if (ftueDue('', { last: day, earn: 2 }, day) !== false) throw new Error('earn');
  if (ftueDue('', { last: day, streak: 1 }, day) !== true) throw new Error('streak today');
  if (ftueDue('', { last: '2026-11-19', streak: 1 }, day) !== false) throw new Error('earlier day');
const calls = [];
startFtue({
  ui: { setNextLine: (t) => calls.push(t) },
  world: {
    setWaypoint: (p) => calls.push(p),
    boardView: (id) => (id === 'STREET_11' ? {} : { holder_id: 'x' }),
    slotCard: (id) => (id === 'STREET_11' ? { x: 3, z: 4 } : null),
  },
}).onBakePay();
if (!calls.some((c) => c && c.x === 3 && c.z === 4)) throw new Error('wp');
if (calls.at(-1) !== '하늘색 기둥을 따라 무료 칸으로 가세요') throw new Error('line');
}
