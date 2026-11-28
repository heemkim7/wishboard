// Bookkeeping for everything that sits on top of the plaza: browser history for sheets and the proof bar, the sheet
// stack, the input lock, toast timing, notification-click routing. No DOM in here, so it all runs in Node (test/overlay.test.mjs).

// ---- history ---------------------------------------------------------------------------------
// Entries this page owns, bottom to top:
//   base     the entry the page loaded on (no tag)
//   guard    one entry pushed on entering the plaza, so the first back gesture does not leave the game
//   overlay  one entry per open overlay level (a sheet, a child sheet, the proof bar)
// Every entry carries history.state.kts = { g: 0|1 (a guard lies below or is this entry), o: overlay level, 0 = none }.
// The UI only says how many levels are on screen (want) and whether the plaza is entered (arm); settle() makes the history
// match. Three rules keep sheets, the proof bar and the guard from fighting:
//   1. A traversal of our own (history.go) is counted in `pending` until its popstate arrives, and nothing is pushed while
//      one is in flight: a pushState in that window would be undone by the traversal when it lands.
//   2. An entry is pushed only after a tap or key press that came later than the last traversal (touch() / `fresh`).
//      Chrome skips, on the next back, every entry a page adds without a new gesture after a back/forward, and that
//      next back would then leave the game. So after a back gesture nothing is pushed again (each level already has its
//      own entry), and something that opens by itself gets its entry at the player's next tap; until then a back still
//      closes it (pop() reports it), only from one entry lower.
//   3. The entry of a level that closed stays for SPARE_MS as a spare: whatever opens next (the proof bar after a purchase,
//      a queued offer, the next sheet) reuses it with no history call at all. Left unused it is stepped off; a back gesture
//      that only lands on a spare still counts as "back" for what is on screen.
export const EXIT_MS = 2000;
export const SPARE_MS = 3000;
export function createBackKeeper({ hist, later = (fn) => Promise.resolve().then(fn), timer = (fn, ms) => setTimeout(fn, ms), clear = (id) => clearTimeout(id), exitMs = EXIT_MS, spareMs = SPARE_MS } = {}) {
  let want = 0, guard = false, pending = 0, queued = false, exitTimer = null, watchdog = null, spare = null, fresh = false;
  const obj = (s) => (s && typeof s === 'object' ? s : {});
  const at = () => {
    const k = obj(obj(hist.state).kts);
    return { g: k.g ? 1 : 0, o: Number.isInteger(k.o) && k.o > 0 ? k.o : 0 };
  };
  const push = (g, o) => hist.pushState({ ...obj(hist.state), kts: { g, o } }, '');
  // A reload while a sheet was open leaves this page on an overlay entry with nothing to show: it becomes a plain entry.
  try { const a = at(); if (a.o > 0) hist.replaceState({ ...obj(hist.state), kts: { g: a.g, o: 0 } }, ''); } catch { /* history is not writable here */ }
  let last = at();

  function schedule() {
    if (queued) return;
    queued = true;
    later(settle);
  }
  function travel(delta) {
    pending += 1;
    clear(watchdog);
    // A traversal that never reports back must not block every later push.
    watchdog = timer(() => { watchdog = null; if (pending) { pending = 0; schedule(); } }, 1500);
    hist.go(delta);
  }
  function settle() {
    queued = false;
    if (pending) return;
    let { g, o } = at();
    if (o > want) {
      if (!spare) travel(want - o); // while the spare timer runs the entries above stay
      return;
    }
    const needGuard = guard && !exitTimer && !g && o === 0;
    if ((needGuard || o < want) && !fresh) return; // touch() comes back here
    if (needGuard) { push(1, 0); g = 1; }
    for (let k = o + 1; k <= want; k++) push(g, k);
    last = at();
  }
  function startExit() { exitTimer = timer(() => { exitTimer = null; schedule(); }, exitMs); }
  function stopExit() {
    if (!exitTimer) return;
    clear(exitTimer);
    exitTimer = null;
  }
  // Call from the popstate listener. { own }: our own traversal landed, nothing to do. { back: n }: the player went back
  // over n open levels, close them (and call want() with what is left). { exit }: back from the plaza itself with nothing
  // open: say "한 번 더 누르면 나가요"; the guard comes back after exitMs unless the player backs out first.
  function pop() {
    const from = last;
    last = at();
    fresh = false;
    if (pending > 0) {
      pending -= 1;
      if (!pending) { clear(watchdog); watchdog = null; }
      schedule();
      return { own: true };
    }
    const { g, o } = last;
    if (o < want) return { back: want - o };
    if (o === want && from.o > o) {
      // The gesture only stepped off spare entries. It still means "back": one level if something is open, else the plaza's own.
      if (want > 0) return { back: 1 };
      if (guard && g && !exitTimer) { startExit(); travel(-1); return { exit: true }; }
    }
    schedule(); // forward onto a spent overlay entry steps back off it; a missing guard is put back
    if (o === 0 && want === 0 && guard && !g && !exitTimer) { startExit(); return { exit: true }; }
    if (g) stopExit(); // forward onto the guard again
    return {};
  }
  return {
    // n overlay levels are on screen now.
    want(n) {
      want = Math.max(0, Math.floor(Number(n)) || 0);
      if (want) stopExit();
      if (at().o > want && !pending) {
        clear(spare);
        spare = timer(() => { spare = null; schedule(); }, spareMs);
        return;
      }
      schedule();
    },
    // The plaza is entered: keep one guard entry under everything.
    arm() { guard = true; schedule(); },
    // A tap or key press happened (the page calls this from pointerup / keydown): entries may be pushed again.
    touch() { if (fresh) return; fresh = true; schedule(); },
    pop,
    settle,
    state: () => ({ want, guard, pending, fresh, exiting: !!exitTimer, spare: !!spare, ...at() }),
  };
}

// ---- sheet stack -----------------------------------------------------------------------------
// What opening a sheet of `kind` does to the open stack (kinds, bottom to top):
//   the same kind on top       → it re-renders in place (wizard steps, another board in the same sheet)
//   the same kind further down → the sheets above it close and it re-renders
//   anything else              → a child on top; the parent stays alive underneath (over SHEET_MAX deep it replaces the top)
export const SHEET_MAX = 5;
export function sheetPlan(kinds, kind, max = SHEET_MAX) {
  const list = Array.isArray(kinds) ? kinds : [];
  const i = list.lastIndexOf(kind);
  if (i >= 0) return { pop: list.length - 1 - i, replace: true };
  if (list.length >= max) return { pop: 0, replace: true };
  return { pop: 0, replace: false };
}
// A backdrop tap must not throw away typing: true when the player typed in this sheet and some text field still holds text.
export function draftAtRisk(typed, values) {
  if (!typed) return false;
  return (Array.isArray(values) ? values : []).some((v) => String(v ?? '').trim() !== '');
}

// ---- input lock ------------------------------------------------------------------------------
// Movement is locked while any owner (a sheet, the proof bar, bake, dance, the city still being built) wants it locked.
// Each owner releases only its own lock; a call that names no owner uses the slot 'other' and frees nothing else.
export function createInputLock(apply) {
  const owners = new Set();
  return {
    set(owner, on) {
      const key = String(owner || 'other');
      if (on) owners.add(key);
      else owners.delete(key);
      const locked = owners.size > 0;
      apply(locked);
      return locked;
    },
    locked: () => owners.size > 0,
    owners: () => [...owners],
  };
}

// ---- toasts ----------------------------------------------------------------------------------
export const TOAST = Object.freeze({ base: 2500, perChar: 60, max: 7000, hit: 8000 });
// How long a toast stays: longer text stays longer; one that can be tapped stays at least 8 s.
export function toastMs(text, clickable = false) {
  const n = Array.from(String(text ?? '')).length;
  const ms = Math.min(TOAST.max, TOAST.base + TOAST.perChar * n);
  return clickable ? Math.max(TOAST.hit, ms) : ms;
}
// An error that reaches a toast as raw English (a fetch failure, a server code) is said in Korean with what to do next.
export function toastText(text, kind = '') {
  const s = String(text ?? '').trim();
  if (!s || kind !== 'err' || /[가-힣]/.test(s)) return s;
  if (/fetch|network|timeout|timed out|abort|load failed|offline/i.test(s)) return '연결이 불안정해요. 잠시 뒤 다시 해 주세요';
  return '처리하지 못했어요. 잠시 뒤 다시 해 주세요';
}

// ---- pressed feedback ------------------------------------------------------------------------
// Every control shows a press (index.html "Pressed"): the stylesheet styles :active and .tapped alike, and ui.js keeps
// .tapped on the control under the pointer for PRESS.ms from pointerdown, so a quick tap is seen too.
export const PRESS = Object.freeze({ sel: 'button, [role="button"], summary, a.btn, label.agree', ms: 160 });

// ---- ghost clicks ----------------------------------------------------------------------------
// A phone sends a tap as pointerdown, pointerup, then (after touchend) the compatibility mouse events and the click, hit-tested
// where the finger was at that moment. Something that opens on pointerdown or pointerup (the round touch button 걸기, a tap on a
// board in 3D, the far board card) is already on screen by then, so the click lands on it: on the new sheet's backdrop it closed
// the sheet at once (the owner's "전광판 걸기 누르면 바로 팝업 꺼짐", 2026-11-28), on a button of it it pressed that button.
// ui.js calls down() on every pointerdown, opened() whenever a sheet, a layer or a floating card comes up, and click(event)
// first thing on every click: true means "this click belongs to the press that opened it", and ui.js swallows it. A click
// whose own handler opens something is not affected (it has already been let through), nor a keyboard click (detail 0).
export const GHOST_MS = 1500;
export function createTapGuard({ now = () => Date.now(), ms = GHOST_MS } = {}) {
  let g = null;
  return {
    down() { g = { t: now(), opened: false, clicked: false }; },
    opened() { if (g && !g.clicked) g.opened = true; },
    click(ev) {
      const swallow = !!(g && g.opened && !g.clicked && Number(ev?.detail) > 0 && now() - g.t < ms);
      if (g) g.clicked = true;
      return swallow;
    },
  };
}
// A backdrop closes its sheet only when the press began on it after the sheet was up (the press that opened it ended there).
export function backdropClose({ downOnBack, target, backdrop }) {
  return !!downOnBack && target === backdrop;
}

// ---- the tool row's order --------------------------------------------------------------------
// The top-right tool row, the phone's closed row and the ⋯ menu all list the tools in this order, by how much they are
// used (each tool button carries the class): 전광판 걸기 is the core action; 선물 전광판 the growth loop (a friend's name on
// a board, shared); 오늘의 소원 the daily return; 응원 순위 and 받은 소식 the social ones; 사진 찍어 공유, 공유·코드 and 내 건물
// one's own; 조작 안내 and 전체 화면 the window's; 설정 last; ⋯ itself at the end. The map is the minimap tile, not a tool.
export const TOOL_ORDER = Object.freeze(['tool-board', 'tool-gift', 'tool-wish', 'tool-rank', 'tool-inbox', 'tool-shot', 'tool-vip', 'tool-hub', 'tool-keys', 'tool-fs', 'tool-set', 'tool-fold']);

// ---- the touch prompt tag --------------------------------------------------------------------
// What the tag beside the round touch button says, from the prompt's three parts [name, second line, button word]:
// [the line, a small second line or '']. A board is "where · whose" (the rest of its name, "소원 걸기" and the like, is the
// button's own word); a 함성 keeps its second line, because it counts down; everything else is its name alone.
export function touchTag(kind, p) {
  const name = String(p?.[0] ?? ''), sub = String(p?.[1] ?? '');
  if (kind === 'board') {
    const whose = name.split(' · ')[0];
    return [sub ? `${sub} · ${whose}` : whose, ''];
  }
  return [name, kind === 'crowd' ? sub : ''];
}

// ---- the next goal ---------------------------------------------------------------------------
// The goal line ("무료 거리 칸에 이름을 올리세요" or "건물 앞 전광판에 …") reads three things that arrive at different
// moments after a load: the boards (who holds which slot), the account's own "free slot used" flag (null until the
// profile answers) and the free-slot list (/rt/config answers with the old four until its isolate has asked the
// database once; main.js asks again and reports it settled). Deciding before all three are in showed one goal on one load
// and the other on the next, for the same guest. So: no goal until all are known, or until `waited` ms have passed since
// the plaza was entered (a profile or a list that never arrives must not leave the HUD without a goal for good).
export const GOAL_WAIT_MS = 8000;
export function goalKnown({ boards, used, list, waited = 0 } = {}) {
  if (!boards) return false;
  if (used != null && list) return true;
  return Number(waited) >= GOAL_WAIT_MS;
}

// ---- hints shown only a few times ------------------------------------------------------------
// A how-to line that is worth reading three times, not for ever (the map sheet's "탭: 목적지 · 드래그: 이동 …").
// hintLeft(seen, max): how many showings are left; the caller stores seen + 1 each time it shows the line.
export function hintLeft(seen, max = 3) {
  const n = Math.max(0, Math.floor(Number(seen) || 0));
  return Math.max(0, max - n);
}

// ---- the news feed ---------------------------------------------------------------------------
// The same line again (a welcome on every reload, a board announced twice): one copy is kept, the newest.
export function sameNews(a, b) {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  return norm(a) !== '' && norm(a) === norm(b);
}

// ---- notification click ----------------------------------------------------------------------
// Where a clicked notification wants the open game to go. sw.js posts { t: 'push', url }; the page moves there in place.
export function pushRoute(url, origin = 'https://plaza.invalid') {
  let u, base;
  try { base = new URL(origin); u = new URL(String(url || '/'), base); } catch { return { kind: 'none' }; }
  if (u.origin !== base.origin) return { kind: 'none' };
  const focus = u.searchParams.get('focus') || '';
  if (/^(MAIN|SUB|STREET|PLOT)_[A-Z0-9_]{1,20}$/.test(focus)) return { kind: 'focus', slot: focus };
  const wish = u.searchParams.get('wish') || '';
  if (/^[0-9a-z]{10}$/.test(wish)) return { kind: 'wish', id: wish };
  return { kind: 'none' };
}

// ---- proof bar -------------------------------------------------------------------------------
// The two offers that used to be their own sheets right after a claim now sit on the proof bar:
//   link  계정 연결 +300, for a guest
//   push  알림 받기, while the browser has neither granted nor refused; not for a gift or a plot (nobody can take those from me)
export function proofOffers({ ready, guest, linked, gift, slot, pushSupported, permission } = {}) {
  return {
    link: !!ready && !!guest && !linked,
    push: !!pushSupported && permission === 'default' && !gift && !String(slot || '').startsWith('PLOT_'),
  };
}
// Does the bar come up, or only its notice? Only the notice when the player walked on while the celebration ran (waited, and
// the focus camera is gone or back was pressed: skip) or a sheet is open; force: the player tapped that notice.
// pushLater: the bar is skipped, so its "알림 받기" was never on screen; that ask is queued as the push sheet instead.
export function proofPlan({ force, waited, focus, skip, sheet, offers } = {}) {
  const bar = !!force || !((!!waited && (!focus || !!skip)) || !!sheet);
  return { bar, pushLater: !bar && !!offers?.push };
}

// ---- 다녀간 사이 ------------------------------------------------------------------------------
// What leaving the sheet marks as read. explicit (✕, back, Escape, backdrop): everything it showed. Left through a row's
// button (the sheet closed to go and look): only the rows acted on; the others stay unread and come back next time.
export function awayRead(plan, acted, explicit) {
  const p = plan || {};
  const ids = Array.isArray(p.inboxIds) ? p.inboxIds : [];
  if (explicit) return { inboxIds: ids, wishSeen: p.wishSeen || null, prizeDay: p.prizeDay || '', invSeen: p.invSeen || 0 };
  const did = (Array.isArray(p.rows) ? p.rows : []).filter((r) => (Array.isArray(acted) ? acted : []).includes(r));
  const mine = new Set(did.filter((r) => r.id > 0).flatMap((r) => [r.id, ...(r.also || [])]));
  return {
    inboxIds: ids.filter((id) => mine.has(id)),
    wishSeen: did.some((r) => r.kind === 'wish') ? (p.wishSeen || null) : null,
    prizeDay: did.some((r) => r.kind === 'prize') ? (p.prizeDay || '') : '',
    invSeen: did.some((r) => r.kind === 'invite') ? (p.invSeen || 0) : 0,
  };
}
