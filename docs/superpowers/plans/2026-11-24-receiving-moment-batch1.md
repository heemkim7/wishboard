# 받는 순간 1차 Implementation Plan

> **For agentic workers:** Two tracks with separate file ownership (the project's way: one worktree per track, the lead merges and checks in the browser). Steps use checkbox (`- [ ]`) syntax. Write the failing test first, then the code, run the whole suite before each commit.

**Goal:** A newcomer sees their own name on a plaza billboard in the first seconds and is led to hang a gift board (①); a recipient can answer with a reply board in one tap (④); a gift board can be seen in the 3D plaza outside its 6 hours (②, replay) and the sender is led to record the real video when videos can be stored.

**Architecture:** ① is local only: a welcome card pinned on one free street screen through the existing gift pin (`ts3d/screens.js`), no server call, nothing sent to the room. ④ is an ordinary gift board whose `ref` is the board it answers; the answered board keeps the first reply's id in one new column of the Meter `'gift'` SQLite table (no Supabase migration). ② changes only which phases `gift.js` `land` accepts, decided by one pure function.

**Tech Stack:** Build-less ES modules, three.js, Cloudflare Worker + Durable Objects (SQLite), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-24-receiving-moment-design.md` (①, ④, ② — not ③ ⑤ ⑥ ⑦). Read it first, then `AGENTS.md`.

**Owner decisions already made (2026-11-24):** the newcomer's first step is the gift board, then today's wish; a reply sends a web push (informational, not at night).

## Rules for both tracks

- Start: `git rev-parse HEAD` must be the commit named in your brief; if not, `git reset --hard <that commit>`.
- Touch only your track's files. Do not edit `IMPLEMENTED.md`, `HANDOFF.md`, `MORNING_REPORT.md`, `docs/*` (the lead does; put the facts in your final report). Do not run `tools/stamp.mjs`. Do not start a dev server or a browser, do not deploy, do not push.
- New imports use the same `?v=<build id>` the file's other imports use (`giftrules.js` is imported with no query everywhere).
- Text people wrote is only set with `textContent` / `fillText`. No new reward, point or chance. No new socket message, no cron, no Supabase table or function.
- Keep `AGENTS.md` › 깨면 안 되는 서버 동작. Every Worker DO call on an HTTP path goes through the tallied env; at budget hard (`lvlNow` 2) a new write answers without a DO call.
- Tests: `node --test test/*.test.mjs tools/account.test.mjs` must end with `fail 0` (1,408 tests before this work, 7 skipped). `test/` has a check that no helper is left uncalled: remove what you orphan.
- Commit on your worktree branch in small steps. End each message with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Final report: branch name and last commit, what you built, each file touched, test totals, what you could not verify, and the exact Korean sentences the lead should put in `IMPLEMENTED.md`.

---

## Track A — ① 환영 전광판 (plaza)

**Files (yours):** `ftue.js`, `main.js`, `ui.js`, `ts3d/screens.js`, `timesSquare3d.js`, `giftart.js`, `plaza-account.js` (only `EVENT_NAMES`), `test/ftue.test.mjs`, new `test/welcome.test.mjs`.
**Not yours:** `giftrules.js`, `giftsrv.js`, `giftpage.js`, `gift.js`, `gift.html`, `worker.js`, `admin-gift.js`.

### What the newcomer sees

1. Enter (no deep link) → the arrival intro as today (3 s).
2. Then a free street screen near the avatar shows the welcome card for 8 s: chip `👋 환영해요`, big line `{닉네임} 님`, line `오늘 밤, 가상 타임스퀘어의 주인공`. The camera looks at that screen once (any drag or move ends it, as with `focusSlot`), one round of fireworks around the face, toast `👋 {닉네임}님 이름이 전광판에 걸렸어요!`. At quality `low`: no camera move, card and toast only.
3. The `지금 할 일` card reads `🎁 친구 이름을 전광판에 걸어 보세요 (무료)`. A tap opens the gift maker (the same as the 🎁 button). After the maker was opened once (card or 🎁 button) the card moves on: `오늘의 소원 한 줄 걸기 (무료)` → next goal.
4. The wish sheet does not open by itself in a session where the welcome ran (it stays the card's next step). Links are unchanged: `?gb=`, `?wish=`, `?focus=`, `?team=`/`?tribe=` keep their own arrival and get no welcome.
5. No bake guidance: no `붕어빵 포차로 가 보세요`, no waypoint to the cart, no bake panel opening by itself, no walk to the free slot after the first bake. The cart, the bake play and the 📢 claim wizard stay as they are.
6. Once per browser: `kts_ftue` is written when the welcome is shown (or skipped because it is not due).

### Interfaces

```js
// ftue.js (pure)
/** The welcome board runs once for a newcomer who came without a deep link. deep: any of ?gb= ?wish= ?focus= ?team= ?tribe=. */
export function welcomeDue({ flag, before, day, deep } = {}) { return !deep && ftueDue(flag, before, day); }
export const WELCOME = Object.freeze({ ms: 8000, line: '오늘 밤, 가상 타임스퀘어의 주인공', task: '🎁 친구 이름을 전광판에 걸어 보세요 (무료)' });
/** Tutorial flag: on at 'start'; off at 'skip', 'claim', 'grad', 'gift' (the gift maker was opened). */
export function tutorialNext(on, ev) { if (ev === 'start') return true; if (ev === 'skip' || ev === 'claim' || ev === 'grad' || ev === 'gift') return false; return !!on; }
/** With a welcome this session the wish sheet does not open by itself. */
export function wishAutoOpen({ newbie, known, mine, deep, skipped, welcomed } = {}) { return !!newbie && !deep && !skipped && !welcomed && !(known && mine); }

// giftart.js (browser)
/** The welcome card on a plaza screen: { name } (cut to 12 code points here). Same ground, frame and fonts as paintGift. */
export function paintWelcome(canvas, { name } = {}) {}

// ts3d/screens.js (createBoards' returned object)
/** Shows the welcome card alone on the free gift screen nearest (x, z) for ms. Local only. -> the slot, or '' when none is free. */
pinWelcome(name, ms = 8000, at = { x: 0, z: 0 })

// timesSquare3d.js (world api)
/** -> the slot or ''. cam: false keeps the camera (quality low passes false itself). */
welcome(name, { cam = true } = {})
```

`pinWelcome` reuses the gift pin (`giftPin`, `giftPlace`, `giftFree`): a pinned entry flagged as the welcome card is painted with `paintWelcome` instead of `paintGift`, its ticker badge reads `환영` and its line `{닉네임}님, 가상 타임스퀘어에 오신 걸 환영해요`. It must never enter `gifts` (the server list), must not cover a lit board, a prime screen or an ad screen, and ends by itself (the existing `giftPin.until` path).

### Tasks

- [ ] **A1 `ftue.js` rules.** In `test/ftue.test.mjs` add: `welcomeDue` true for `{ flag: '', before: null, day }`, false with `deep: true`, false with `flag: '1'`, false when `before.last` is an earlier day; `tutorialNext(true, 'gift') === false`, `tutorialNext(true, 'bakePay') === true`, `tutorialNext(true, 'walkDone') === true` (no longer an end); `wishAutoOpen({ newbie: true, welcomed: true }) === false` and `=== true` without `welcomed`. Run: fail. Implement the three functions above. Remove `startFtue`'s bake chain: `startFtue`, `walkArrival` and the self-check block at the end of the file go (the self-check keeps its `ftueDue` lines); remove their tests and add one asserting the module no longer exports `startFtue` and that the file text has no `붕어빵 포차로`. Run: pass. Commit (together with A5 if a test resolves `main.js`'s imports against `ftue.js`'s exports).
- [ ] **A2 `giftart.js` `paintWelcome`.** Move `paintGift`'s ground (gradient, glow, vignette, confetti, frame) into one local helper both painters call (no change to what `paintGift` draws). `paintWelcome` uses theme `night` (`GIFT_THEMES.night`), the chip helper for `👋 환영해요` (left) and `WISH BOARD` (right), `fitSize` for `{name} 님` at up to `118 * k` in `T.hi`, and `WELCOME.line` below in `T.ink`. Test in `test/welcome.test.mjs` with a recording fake 2D context (see how `test/gift.test.mjs` exercises `paintGift`; if it does not, build a small fake: an object whose methods push `[name, ...args]` and whose `measureText` returns `{ width: text.length * 10 }`): the drawn strings include `👋 환영해요`, `네온후드77 님`, `오늘 밤, 가상 타임스퀘어의 주인공`; a 30-character name is drawn cut to 12 code points; `paintGift` with the same fake still draws `To. 민지`. Commit.
- [ ] **A3 `ts3d/screens.js` `pinWelcome`.** Read `giftPlace`, `giftFree`, `giftAt`, `paint` and the ticker code around `setGifts` first. Add `pinWelcome` as specified; choose the nearest free slot by `worldPos(slot)` distance to `at` among `GIFT_SCREENS` for which `giftFree(slot)` holds. Export it from `createBoards`. If `test/` has a harness that builds `createBoards` without WebGL, add a test (pin → the slot's board reports the welcome; after `ms` it is gone; a lit board is never chosen); if it has none, keep the choosing logic in a pure helper in `giftrules.js`-free code you own (`ftue.js`: `nearestSlot(slots, at)` taking `[{ id, x, z }]`) and test that. Commit.
- [ ] **A4 `timesSquare3d.js` `welcome`.** `const slot = boards.pinWelcome(name, WELCOME.ms, { x: me.root.position.x, z: me.root.position.z })`; when a slot came back and `cam` and quality is not `low` and not driving: `focusSlot(slot, { hold: 3500, celebrate: false })` and, 900 ms later, the same fireworks `cheerAt(slot)` uses. Return the slot. Add `welcome` to the returned api next to `pinGift`. Commit.
- [ ] **A5 `main.js` + `ui.js` wiring.** `armFtue`: compute `welcomeDue({ flag: recall('kts_ftue'), before: DAILY_BEFORE, day: kstDay(), deep: !!(FOCUS || WISH_ID || <the gb / team / tribe link flags main.js already has>) })`. Not due → today's `skip` path. Due → wait for the built city (`whenBuilt`) and the real nickname, call `world.welcome(nick, { cam })`, `keep('kts_ftue', '1')`, `ui.note('👋 ' + nick + '님 이름이 전광판에 걸렸어요!', 'ok')` when a slot came back, `ui.setTutorialLine(WELCOME.task)`, `ui.tutorial('start')`, `trackEvent('welcome_show', { ok: slot ? 1 : 0 })`. Set a module flag `welcomedNow = true` before `afterIntro` decides the wish sheet, so `wishAutoOpen` gets `welcomed: true`: decide `welcomeDue` once at `arrive()` time and keep it. `ui.js`: `NEWCOMER_STEPS` order becomes tutorial line → wish step → next goal; `tutorialGo` opens the gift maker (`hooks.openGift()`, which `main.js` wires to `giftUi.open()`), sends `ui.tutorial('gift')` and `trackEvent('welcome_cta')` through a hook; The step ends only through this card path: `main.js` passes ui a wrapper around `giftUi.open` and the wrapper is what ends it. An open from the 🎁 button itself (`gift.js`, not yours) leaves the card as it is; that is accepted. Remove what the bake chain used and nothing else calls (`noteBakePay`'s tutorial calls, `bakeGuided`, `ui.setTutorialWaypoint`, `tutorialTap`, `tutorialWalk`, `tutorialBaked`, `onProximity`'s `ftueApi?.onArrive`, the `arrive` waypoint branch). `plaza-account.js`: add `'welcome_show'`, `'welcome_cta'` to `EVENT_NAMES`. Run the whole suite. Commit.
- [ ] **A6 Self-review.** Re-read the diff against "What the newcomer sees" line by line. Confirm: nothing is sent to the room or the Worker for the welcome except the two events; a returning player (`kts_ftue` set) sees nothing new; `?gb=` arrival is untouched; no string `붕어빵 포차로 가 보세요` or `무료 칸으로 가세요` is left in the tutorial path. Whole suite once more. Final commit and report.

---

## Track B — ④ 답장 전광판, ② 다시 보기와 영상 권유 (gift)

**Files (yours):** `giftrules.js`, `giftsrv.js`, `giftpage.js`, `gift.js`, `gift.html` (styles only if needed), `worker.js` (push text, push gap, push link, and the Meter method that calls a new `giftDb` function if one is needed), `admin-gift.js` (one column), `test/gift.test.mjs`, `test/gift-worker.test.mjs`.
**Not yours:** `giftart.js`, `ts3d/*`, `timesSquare3d.js`, `main.js`, `ui.js`, `ftue.js`, `plaza-account.js`, `sw.js`.

### What people see

**Reply (④).** On the recipient page, when the film has ended (or was skipped), the first button is `💌 {보낸 사람}님에게 답장 전광판 걸기`, or `💌 고마워 전광판 걸기` when the board has no sender name. Not in the owner's preview. A tap opens the maker filled in: 받는 사람 = the board's `from`, 무슨 날 = `고마움`, 한마디 = `덕분에 행복했어, 고마워!`, 보내는 사람 = the board's `to`, today, `지금`. Heading `💌 답장 전광판을 걸어요`, submit `💌 답장 걸기`. Everything can be edited; the usual checks and limits apply.
The answered board's owner page shows a card on top: `💌 답장이 도착했어요` with `답장 보기` (→ `/g/<reply id>`). Its owner gets one web push `{이름}님이 답장 전광판을 걸었어요` (`답장 전광판이 도착했어요` without a name) when they have push on and it is not 21:00–08:00 KST; the push opens `/g/<answered id>`.

**Replay (②).** The recipient page's plaza button by phase: `live` → `🗽 직접 가서 보기` (as now); `day` (the day has come, not lit yet) → `🗽 광장에서 미리 보기`; `after` → `🗽 광장에서 다시 보기`; `before` → no button (as now). In the plaza, `?gb=<id>` outside the window pins the board on a free screen on this device only for a minute with the same camera and fireworks, toast `🎁 {이름}님을 위한 선물 전광판이에요 · 이 기기에서만 다시 보여 드려요` (`day`: `… · 광장에는 {저녁 6시}에 걸려요`). `before` and gone boards keep today's notes.

**Video first (②).** Only when the Worker stores videos (`media` true) and the board has no video and is not `after`: on the owner page the video card comes before the link card, its button is the gold one and reads `🎬 광장에서 진짜 15초 영상 만들기 · 약 25초`; the first tap on `공유하기` or `링크 복사` for that board shows, once (kept per board in `kts_gnudge`), `영상을 먼저 만들면 받는 사람이 진짜 광장 영상을 봐요` with `🎬 영상 먼저 만들기` and `그냥 보내기`. Without `media` the page is exactly as today.

### Interfaces

```js
// giftrules.js
// OCCASIONS gains: thanks: { name: '고마움', head: '정말 고마워요', emoji: '🙏', th: 'rose', hint: '덕분에 행복했어, 고마워!' }
export const REPLY_MSG = '덕분에 행복했어, 고마워!';
/** The maker's values for a reply to board g (public view): to and from swapped, cut to their limits. */
export function replyDraft(g) { return { to: cut(g?.from, GIFT.toMax), from: cut(g?.to, GIFT.fromMax), occ: 'thanks', msg: REPLY_MSG, th: '' }; }
/** What ?gb=<id> may do in the plaza: 'live' (hanging now), 'replay' (the day has come or the window is over, the page still lives:
 *  this device only), 'wait' (before the day), 'gone'. g: the public view ({ day, a, b }). */
export function plazaLook(g, now = Date.now()) {
  if (!g || !validDay(g.day)) return 'gone';
  const a = Number(g.a), b = Number(g.b);
  if (!(now < keepUntil(g))) return 'gone';
  if (now >= a && now < b) return 'live';
  return now >= dayStart(g.day) ? 'replay' : 'wait';
}

// giftsrv.js store: gb gets `re text not null default ''` (the first reply's id).
//   tables(q): after the create statements, add the column when `pragma table_info(gb)` has no `re` (existing stores have the old table).
//   make(q, o, now): o.re true and a kept ref (parent exists, not the same uid) → `update gb set re = ? where id = ? and re = ''`;
//     when that changed a row: bump(q, d, 'reply') and the result carries reply: { to: <parent uid>, gid: <parent id> }.
//   dropBoards(q, ids): also `update gb set re = '' where re = ?` for each id.
//   ownerExtras(g): adds re: g.re only when that board still exists with st 'live' (decide in the DO read, not in the Worker).
// POST /rt/gift body: re: 1 marks a reply (ref names the answered board).
// Worker make(): on r.reply and !quietNow(now) → k.pushNow(env, ctx, r.reply.to, { kind: 'giftreply', from_name: f.v.from, gid: r.reply.gid }).
// worker.js: PUSH_GAP.giftreply = 60000; pushText: giftreply → `${name}님이 답장 전광판을 걸었어요` or '답장 전광판이 도착했어요';
//   the push link function: giftreply → '/g/' + gid when GIFT_ID matches, else '/gift'.
// Beacon key 'reply' is accepted next to 'cta' (ev:reply in the daily counters).
```

### Tasks

- [ ] **B1 `giftrules.js`.** Tests in `test/gift.test.mjs`: `OCC_KEYS` includes `'thanks'` and `giftFault({ to: '지수', occ: 'thanks', day, at: 'now' })` is ok with theme `rose`; `replyDraft({ to: '민지', from: '지수' })` deep-equals `{ to: '지수', from: '민지', occ: 'thanks', msg: REPLY_MSG, th: '' }`; `replyDraft({ to: '민지', from: '' }).to === ''`; `giftFault` accepts a filled draft; `plazaLook` at five times for a board of day D, window 18:00–24:00 KST: D−1 12:00 `wait`, D 10:00 `replay`, D 19:00 `live`, D+3 `replay`, D+8 00:00:01 `gone`; `plazaLook(null) === 'gone'`. Fail, implement, pass. Fix any existing test that counts five occasions. Commit.
- [ ] **B2 store and route.** Tests in `test/gift-worker.test.mjs` (follow the file's own harness): a reply (`re: 1`, `ref` = another account's board) sets the parent's `re` once; a second reply leaves the first; `re: 1` on one's own board, or without a valid `ref`, sets nothing; the owner read (`GET /rt/gift/<id>` with the owner's token) returns `mine.re`; after the reply board is deleted the owner read has no `re`; an old store (create the table without `re`, then call `tables`) gains the column and keeps its rows; the daily counter `reply` is 1; the push helper is called once with `kind: 'giftreply'` and not at 22:00 KST; at budget hard the reply answers 503 with no DO call (the existing rule). Fail, implement, pass. Commit.
- [ ] **B3 `worker.js` push.** Add the gap, the text and the link as specified; a unit test where the file already tests `pushText` for `giftopen` (extend it: a `giftreply` row with and without a name, the link). Commit.
- [ ] **B4 `giftpage.js` reply.** `visit()`: the reply button first in `acts` (not in `preview`): it sends beacon `reply`, stores `kts_gref` (`{ id, at }` as `maker` does for `?ref=`), `history.pushState(null, '', '/gift')` and calls `maker({ ...replyDraft(g), re: g.id })`. `maker(prefill)`: with `prefill.re` the heading and submit label change as specified, the POST body carries `ref: prefill.re, re: 1` (the kept ref is not used then), and when `to` is empty the cursor goes to it. `owner()`: the `💌 답장이 도착했어요` card when `extra?.re`. Commit.
- [ ] **B5 replay.** `giftpage.js` `visit()`: the plaza button and its label by phase as specified (the `go` beacon as now). `gift.js` `land()`: a board found in the live list (`st.list`) is `live` by being there (those rows carry no `day`); otherwise fetch it and take `const look = plazaLook(g, now)`; `live` and `replay` run the pin / goToSlot / focusSlot / cheerAt path (the pin already works outside the window), with the toast for `replay`; `wait` and `gone` keep today's notes. Use the server offset the page already has where there is one; in the plaza use `Date.now()` as `land` does today. Commit.
- [ ] **B6 video first.** `giftpage.js` `owner()`: card order, button style and text, and the one-time nudge as specified, all behind `media && !g.vid && phase !== 'after'`. Commit.
- [ ] **B7 admin + self-review.** `admin-gift.js`: show the daily `reply` count next to `made_ref` if the table lists counters by key (one column `답장`). Re-read the diff against "What people see". Confirm: a reply cannot be told apart from an ordinary board by the public API except through `ref` (which was already private), `re` is only in the owner's `mine`; no user text reaches `innerHTML`; withdrawal (`giftForget`) leaves no dangling `re`. Whole suite. Final commit and report.
