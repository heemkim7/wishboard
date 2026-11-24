# 받는 순간 2차 Implementation Plan (③ 점등식)

> **For agentic workers:** Two tracks with separate file ownership (the project's way: one worktree per track, the lead merges and checks in the browser). Steps use checkbox (`- [ ]`) syntax. Write the failing test first, then the code, run the whole suite before each commit. The shared rules (Task 0) are already on the base: read them, do not change their behaviour.

**Goal:** Friends of a recipient gather in front of a scheduled gift board in the 3D plaza, watch a teaser count down, see it light with fireworks and a cheer, and leave with a group photo taken on their own device; the recipient page invites them with the date and time.

**Architecture:** No server signal. Every device works out the ceremony's phase from the board's own start (`a` when it is a whole start hour of its day) and its clock plus the server offset (`nowMs()` in the plaza, the page's `now()` on `/g/<id>`), with the pure rules in `giftrules.js` (Task 0, landed). The plaza fetches the board once (`GET /rt/gift/<id>`, existing), pins it locally on its own screen (`pinGift`, existing, extended with a teaser) and drives the steps with `cerSteps` on a 250 ms tick. The only server changes are two accepted beacon keys and a `hard` flag on two existing reads. No new route, socket message, cron, Supabase change, reward, upload.

**Tech Stack:** Build-less ES modules, three.js, Cloudflare Worker + Durable Objects (SQLite), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-24-receiving-moment-design.md` › ③ 점등식 (sections 1–3 for the rules that bind every item). Not ② R2, ⑤, ⑥, ⑦. Read it first, then `AGENTS.md`.

## Decisions (made; do not reopen)

From the lead:
1. Only boards with a fixed start (9, 12, 15, 18 h KST of their day). A "지금" board never has a ceremony.
2. Before the 10-minute window the recipient page's button does not enter the plaza: a tap says `10분 전부터 들어올 수 있어요` and opens the share sheet with the invitation (date and time). Inside the window it goes to `/?gb=<id>&cer=1`.
3. Phases (`cerPhase`): `early` (> 10 min before), `wait` (10 min … 10 s), `count` (last 10 s), `lit` (start … +2 min), `over`.
4. The teaser card shows `곧 켜져요`, the recipient's name and mm:ss left, repainted at most once a second; the message is never drawn.
5. At the start: the normal gift card, six rounds of fireworks, each participant's own avatar cheers once with the existing emote (`playEmote(3)`, `🙌 만세`, the existing `{t:'E', k, e}` packet and `EMOTE_GAP_MS`).
6. At +8 s the group photo is taken on the device (the 3D view with the name tags and a band `To. 민지 · 2026.12.25 · WISH BOARD 가상 광장`), then a card with `사진 저장`, `공유하기`, `받는 사람 페이지로`. Nothing is uploaded.
7. Budget hard: the ceremony arrival is not accepted; the visitor goes back to the recipient page. Beacons `cer` and `cershot`, once per board, event and KST day on a device.

Made in this plan (one line of reasoning each):
8. **How the start is known.** `cerStart(g)` = `g.a` when it is a whole hour, that hour is in `GIFT.starts`, it falls on `g.day` (when the row has a day) and the owner's `at` (making time, only in the owner's read) is before it. Boards store no `at` choice, and a fixed start is always a whole start hour; a "지금" board is rounded to 10 minutes, so it can only look like a start hour when made in the first 10 minutes after one, and then its 2 lit minutes are over before anyone could gather (accepted, see Risks).
9. **Late arrivals' photo is offered, not taken.** A device that was not here before the start gets a tappable notice `📸 지금 단체 사진 찍기` while `lit`: taking it costs nothing and stays on the device, but an automatic shot of a camera that just arrived frames nobody.
10. **A newcomer by a ceremony link** sees today's boot card and guest entry unchanged, then lands straight at the board (no intro, no tutorial, no welcome board: `?gb=` is already a deep link in `main.js` `DEEP_LINK`, so `welcomeDue` is false). The boot card is the only way to get an avatar; a ceremony variant of it is not worth a second entry path for 5–30 people.
11. **A tab hidden across the start** resumes at the phase it is in now (`cerSteps`): the countdown, the cheer and fireworks rounds whose moment passed are not replayed (back after the last round: one round); the photo is taken only until +12 s (`CER.shotSlack`), later it is offered. Replaying a missed countdown would put this device out of step with everyone else's.
12. **Reduced motion** (`prefers-reduced-motion`): camera moves become cuts (today's `startCine` rule; the ceremony never sets `film`), the countdown digit does not scale or fade (it just changes), the avatar's turn to the photo camera is instant. Fireworks keep their six rounds and the cheer stays: today's claim fireworks also stay under reduced motion, and they are the content of the moment, not a camera effect.
13. **HUD.** From `count` until the photo card opens (or `end`, or +12 s), when no sheet and no layer is open (`ui.busy()` false), `body.gift-cer` hides `#ui` like `body.gift-rec` does (notices included: nothing is said during those ~18 s). If a sheet or the gift frame is open at `count`, the HUD stays and the countdown draws over it (it takes no pointer). The photo card is the one modal layer (`ui.layer`); if a sheet or another layer is open at the shot, the photo is still taken and a tappable notice `📸 단체 사진이 나왔어요 · 보기` opens the card later.
14. **Photo framing.** The photo camera stands on the board's normal behind the crowd (the crowd is between it and the board), above eye level, and at the pose step each device turns its own avatar to face that camera (a local turn, like `goToSlot`'s facing; it goes out in the ordinary position packet's `face`, so friends' avatars turn on my screen ~1 s later). Landscape: the board fills about 60 % of the width, the crowd's heads in the lower third. Portrait: farther back so the board's full width fits at 90 % of the narrow width, the look point lowered so the board is in the upper half and the crowd in the lower half. One pure function (`camrig.js` `cerShotPose`) with projection tests for 9:19.5, 9:16, 16:9, 19.5:9.
15. **The teaser pin.** One pin from arrival until start + 2 min + 1 min (`cerPinMs`), flagged with the start (`pinGift(g, ms, { cer: start })`). The painter picks the teaser before the start and the gift card from the start, on the same canvas and screen in the tick that crosses it: no unpin, no re-placement, so no blank frame. At the pin's end `/rt/world` has the board on its own screen (`g.scr`), the same screen the pin used whenever that screen was free, so the card stays put.
16. **Where avatars stand.** Nothing forces them. Each arrival is put at the board's front point plus a per-device spread (`goToSlot(slot, { spread: seed })`, local teleport, lateral −4…4 m, depth 0…3 m) so friends do not stand inside each other; at 30 s before the start, a device more than 25 m from the front point gets one tappable notice `전광판 앞으로 오면 단체 사진에 같이 찍혀요` (tap → `goToSlot` again). No waypoint: the pill would outlive the ceremony and fight the countdown for the same space.
17. **Quality `low` (phones):** everything runs the same: the same camera moves (as link arrivals do today), six rounds (`celebrationPlan` already thins bursts for `low`, `FIREWORK.cap` 14 / `hard` 28 still bound them), the same photo at `capture()`'s 1280 px cap. The teaser repaints at most once a second like every other board canvas.
18. **Budget hard, both ends.** `GET /rt/gift/<id>` and the `/g/<id>` page data gain `hard: true` at `lvlNow` 2 (the reads already ask `hard()`; no new DO call). The page's button then says `지금은 광장이 붐벼서 점등식에 들어갈 수 없어요. 잠시 뒤에 다시 해 주세요` instead of entering; the plaza asks the board before `net.join` and goes back with `location.replace('/g/<id>?cer=busy')`. If the plaza learns budget hard only later (the room said `down`, or `/rt/gate` said full) before the start, it goes back the same way; after the start it stays (the pin is local; nothing more to save).
20. **The lighting is the reveal (owner, 2026-11-24: "점등까지 숨기기").** For a ceremony board the recipient page keeps its `before` look on the board's own day until the start: no film, no message, the countdown points at the start. Parity with today's before-the-day hiding, no stricter: the same places hide the message (page views and data, share card, the plaza preview for non-owners), the owner keeps everything, the rolling paper keeps its own rule. Added to Track G as task G6 after the plan was written (the rule is a pure function in `giftrules.js`; `giftPhase` keeps its meaning for the server's bookkeeping).
19. **Embedded page.** On the recipient page opened over the plaza (`?in=1`), the `go` button posts `{ t: 'gift', act: 'cer', id }` instead of loading a second plaza; the plaza closes the frame and runs the ceremony in place.

## Rules for both tracks

- Start: `git rev-parse HEAD` must print the commit named in your brief (the lead's merge of Task 0 and this plan). If not, `git reset --hard` to it. Work only in your worktree and commit on its branch; never push, deploy, run `node tools/stamp.mjs` (only `--check`), start `wrangler` or a browser, or touch the main checkout.
- Touch only your track's files. Do not edit `IMPLEMENTED.md`, `HANDOFF.md`, `MORNING_REPORT.md`, `docs/*` (the lead does; put the facts in your final report). Working files are CRLF in the checkout (blobs LF): keep each file's endings; write new files with LF.
- `giftrules.js` is imported with no query everywhere. Other new imports use the same `?v=<build id>` the file's other imports use. The Task 0 exports (`CER`, `cer*`, `beaconOnce`, `CER_BEACONS`, `CER_TEXT`) keep their behaviour; only Track G may add to `giftrules.js`, and a pure helper Track P needs goes in a file Track P owns (`camrig.js`, `gift.js`).
- Text people wrote is only set with `textContent` / `fillText`. No new reward, point or chance. No new socket message, no cron, no Supabase table or function, no user photo upload. Keep `AGENTS.md` › 깨면 안 되는 서버 동작 (my position from local input only: the spread and the turn are local, like the map's teleport). Every Worker DO call on an HTTP path goes through the tallied env; at budget hard a new write answers without a DO call.
- Tests: `node --test test/*.test.mjs tools/account.test.mjs > "$TEMP/<track>-suite.log" 2>&1`, then read the summary from the file (`grep -E "ℹ (tests|pass|fail|skipped)" "$TEMP/<track>-suite.log"`; this Node prints it as `ℹ tests …`). On the base: 1759 tests, 1752 pass, 0 fail, 7 skipped (1718/1711 before Task 0's 41 tests; check your own base once). It must end with `fail 0`. Remove what you orphan.
- Commit in small steps. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Final report: branch and `git log --oneline <sha>..HEAD`; what you built; each file touched; suite numbers; what you could not verify; and the exact Korean sentences for `IMPLEMENTED.md` › `선물 전광판` › a new `### 점등식` block (start from the draft under your track and correct it to what you built; sentences, not bullets of code names only).

---

## Task 0 — shared rules (landed on the base)

`giftrules.js` › `점등식`, tests in `test/ceremony.test.mjs` (41). Read both before starting; the table is the contract.

```js
export const CER = { open: 600000, count: 10000, late: 120000, shot: 8000, pose: 6500, shotSlack: 4000, rounds: 6, roundMs: 1200, cheerMs: 5000, hold: 60000 };
export const CER_BEACONS = ['cer', 'cershot'];
export const CER_TEXT = { early: '10분 전부터 들어올 수 있어요', busy: '지금은 광장이 붐벼서 점등식에 들어갈 수 없어요. 잠시 뒤에 다시 해 주세요',
  soon: '곧 켜져요', gather: '전광판 앞으로 오면 단체 사진에 같이 찍혀요', shotHead: '📸 단체 사진이 나왔어요', shotReady: '📸 단체 사진이 나왔어요 · 보기',
  shotTake: '📸 지금 단체 사진 찍기', save: '사진 저장', share: '공유하기', page: '받는 사람 페이지로' };
// x: a board or a start in ms (the localhost seam passes a number). now: the caller's clock plus the server offset.
cerStart(g) -> ms | 0                    cerPhase(x, now) -> 'early'|'wait'|'count'|'lit'|'over'
cerLeft(x, now) -> ms (0 at/after start) cerDigit(x, now) -> 10..1 while counting, else 0
cerClock(ms) -> '09:59' (rounded up)     cerWhen(x) -> '12월 25일 18:00' | ''
cerUrl(id) -> '/?gb=<id>&cer=1'          cerBack(id, 'early'|'busy') -> '/g/<id>?cer=<why>'   cerBackWhy(search) -> 'early'|'busy'|''
cerButton(g, now, { hard }) -> null | { label, act: 'early'|'go'|'busy', href }
   early '🎆 점등식 같이 보기 · 12월 25일 18:00' · wait/count '🎆 점등식 들어가기 · 09:12 남음' · lit '🎆 방금 켜졌어요 · 점등식 보러 가기'
cerInvite(g, url) -> null | { title: '🎆 민지님 선물 전광판 점등식',
   text: '12월 25일 18:00, 뉴욕 타임스퀘어 가상 광장에서 민지님의 전광판이 켜져요. 같이 보러 와요! 10분 전부터 들어올 수 있어요 👉', url }
cerShareLine(g, now) -> ' 🎆 점등식 12월 25일 18:00에 같이 봐요!' (until the start) | ''
cerArrive(g, now, { hard, start }) -> 'go'|'early'|'busy'|'plain'|'gone'
cerArriveNote(g, now, start?) -> '🎆 민지님 선물 전광판 점등식 · 18:00에 켜져요' | '🎆 민지님 선물 전광판이 방금 켜졌어요!'
cerTeaser(g, now, start?) -> { to, chip: '곧 켜져요', left: 'mm:ss', when: '18:00', emoji, th }   // never msg, never from
cerPinMs(x, now) -> ms                   cerBand(g, start?) -> 'To. 민지 · 2026.12.25 · WISH BOARD 가상 광장'
cerPhotoText(g) -> '🎆 민지님 선물 전광판 점등식에서 · WISH BOARD 가상 광장'
cerSteps(x, now, done) -> { phase, teaser, count, light, cheer, round (-1 none), pose, shot, offer, end }
   // done: { before, teaser, count, light, cheer, rounds, pose, shot, offer, end }; the caller sets done.before = true whenever the phase was
   // wait or count, done[step] = true after doing a step, done.rounds = round + 1 after firing a round.
cerDebugStart(search, host, now) -> now + cerin*1000 on localhost / 127.0.0.1 / [::1] / *.localhost only (|cerin| <= 3600), else 0
beaconOnce(seen, id, e, day) -> { send, seen }   // the recipient page's kts_gseen rule as a pure function
```

---

## Track G — the recipient page, the Worker (gift side)

**Files (yours):** `giftrules.js` (additions only), `giftpage.js`, `gift.html` (styles), `giftsrv.js`, `worker.js` (gift routes only, if at all), `admin-gift.js`, `test/gift.test.mjs` (the page and server parts), `test/gift-worker.test.mjs`, new `test/ceremony-page.test.mjs` if you prefer a separate file.
**Not yours:** `gift.js`, `ts3d/*`, `giftart.js`, `giftfilm.js`, `timesSquare3d.js`, `camrig.js`, `ui.js`, `index.html`, `main.js`, `live.js`, `net.js`, `test/ceremony.test.mjs`.

### What people see

1. **Before the window** (the days before, and the day itself until 17:50 for an 18:00 board). The recipient page shows a gold button `🎆 점등식 같이 보기 · 12월 25일 18:00`: in the `before` view at the top of the sticky column, right under the countdown card; in the `day` view directly under the `where` line, above the film (not inside the `acts` block that waits for the film's end). A tap: the line under it says `10분 전부터 들어올 수 있어요` (role status) and the share sheet opens with `cerInvite(g, location.origin + '/g/' + id)` (`navigator.share`; without it, the clipboard gets `text + ' ' + url` and the line adds `초대 문구를 복사했어요. 카카오톡에 붙여 넣어 보내세요.`). An AbortError from the sheet says nothing more.
2. **Inside the window** (`wait`, `count`). The same button reads `🎆 점등식 들어가기 · 09:12 남음` (the page's 1-second `live()` ticker) and is a link to `/?gb=<id>&cer=1`; a tap sends beacon `go` as the plaza button does (the plaza sends `cer` itself on arrival). Over the plaza (`EMBED`) it posts `{ t: 'gift', act: 'cer', id }` instead.
3. **The first 2 minutes after the start** (`lit`): `🎆 방금 켜졌어요 · 점등식 보러 가기`, same link. After that the button is gone; the ordinary `🗽 직접 가서 보기` stays as today.
4. **Budget hard** (`DATA.hard`, or the last `GET /rt/gift/<id>` said `hard: true`): inside the window the label stays but the button is a `<button>`; a tap says `지금은 광장이 붐벼서 점등식에 들어갈 수 없어요. 잠시 뒤에 다시 해 주세요` (role alert) and enters nothing.
5. **Sent back from the plaza** (`/g/<id>?cer=early` or `?cer=busy`): the page shows `CER_TEXT[why]` once under the ceremony button (role status), then removes `cer` from the address with `history.replaceState`, so a reload does not repeat it.
6. **The owner's page.** `share()` text gains `cerShareLine(g, now())` (the board's start until it has passed): `🎁 민지님을 위한 선물 전광판이 뉴욕 타임스퀘어 가상 광장에 걸려요! 친구들 메시지도 남겨 주세요 👉 🎆 점등식 12월 25일 18:00에 같이 봐요!` — keep the existing sentence, append the line before the URL.
7. **Admin** (`admin-gift.js` `COLS`): two columns after `ev:go`: `['ev:cer', '점등식 온 기기']`, `['ev:cershot', '단체 사진 저장·공유']`.
8. A board without a fixed start ("지금"), a hidden or gone board: no ceremony button anywhere, the page exactly as today.

### Interfaces

```js
// giftsrv.js
// SEEN_EV gains 'cer' and 'cershot' (both are plain daily counts ev:cer / ev:cershot, like 'go'; the device-day rule is the client's).
// GET /rt/gift/<id>:  { ok, gift, own, ...(own ? { mine, media } : {}), ...(h ? { hard: true } : {}) }
//   h: the hard() the read already asks (loadGift); read it once and pass it out, no second lvlNow, no DO call.
// giftPage(): the inline data gains hard: true at lvlNow 2 (same: no DO call). The 503 / 404 shapes are unchanged.

// giftpage.js (module-private, tested through the fake DOM)
// cerCard(g) -> the button + its status line, or null when cerButton(g, now(), { hard }) is null; one live() ticker repaints the label.
// hard: !!DATA?.hard (a later own read that says hard: true sets it too).
// debug: on a local host, cerDebugStart(location.search, location.hostname, now()) is the start for the button and the link carries
//        '&cerin=' + Math.round((start - now()) / 1000) so the plaza continues the same fake ceremony (see "Trying it locally").

// postMessage from the embedded page (gift.js handles it, Track P):
//   { t: 'gift', act: 'cer', id }   // the recipient page's ceremony button while EMBED; the plaza closes the frame and runs the ceremony
```

### Tasks

- [ ] **G1 server.** Tests in `test/gift-worker.test.mjs` (follow its harness): a beacon `{ v, e: 'cer' }` and `{ v, e: 'cershot' }` is accepted and counted as `ev:cer` / `ev:cershot` after the flush; an unknown key (`'cerx'`) is still dropped; `GET /rt/gift/<id>` has no `hard` at level 0 and `hard: true` at level 2, and the level-2 read makes no more DO calls than the level-0 read did for a cached board; the `/g/<id>` HTML's `#gift-data` JSON has `hard: true` at level 2 and no `hard` otherwise; at level 2 a `cer` beacon is dropped (today's rule). Fail, implement, pass. Commit.
- [ ] **G2 recipient page button.** Tests with the fake DOM in `test/gift.test.mjs` (`fakeDom({ path: '/g/<id>', data, at })`): an 18:00 board at D−5 12:00 shows `🎆 점등식 같이 보기 · 12월 25일 18:00` in the `before` view; a tap writes `10분 전부터 들어올 수 있어요` and `P.shared` holds the `cerInvite` title, text and url; with no `navigator.share` the clipboard gets text + url; at D 17:50:00 the element is an `<a>` with `href` `/?gb=<id>&cer=1` and label `🎆 점등식 들어가기 · 10:00 남음`, and one `P.tick()` later `09:59`; at D 18:00:30 `🎆 방금 켜졌어요 · 점등식 보러 가기`; at D 18:02:00 no button; a "지금" board on its day: no button; in the `day` view the button is in the document while `acts` is still hidden; `DATA.hard` at D 17:55 → a `<button>`, a tap writes the busy line and nothing navigates; `?cer=busy` / `?cer=early` show the line once and `history.replaceState` drops `cer`; `embed: true` at D 17:55: a tap posts `{ t: 'gift', act: 'cer', id }`. Fail, implement, pass. Commit.
- [ ] **G3 owner share line, admin.** Test: the owner page's `공유하기` at D−1 shares text ending in `🎆 점등식 12월 25일 18:00에 같이 봐요!`, at D 18:05 without it, a "지금" board never; `admin-gift.js` lists `점등식 온 기기` and `단체 사진 저장·공유` (if the file has a test for `COLS`, extend it; otherwise a source check). Implement, pass. Commit.
- [ ] **G4 local seam.** On `localhost` / `127.0.0.1` / `*.localhost` only: `/g/<id>?cerin=75` makes the page's button behave as if the board started 75 s from load (`cerDebugStart`) and its link carries `&cerin=<seconds left>`. Test both: on `localhost` the link has `cerin`, on `studio.wishboard.workers.dev` the same address shows the real phase and no `cerin`. Commit.
- [ ] **G5 self-review.** Re-read the diff against "What people see". Confirm: the teaser rule does not apply here (the page's `before` preview already paints `그날 공개돼요 🤫`, unchanged); no user text reaches `innerHTML`; no new route or DO call; the page works with a Worker that has no `hard` field (an old isolate) and with `DATA` null. Whole suite. Final commit and report.

### Browser check (the lead, after the merge)

375×812, 812×375, desktop; `/g/<id>` of an 18:00 board made locally, with `?cerin=700` (early), `?cerin=120` (wait), `?cerin=-30` (lit): the button's place in `before` and `day`, the share sheet / clipboard, the label ticking, the 44 px target, the line under it read by a screen reader (role status / alert).

### Draft for `IMPLEMENTED.md` (correct it to what you built)

> 시각을 예약한 보드(9·12·15·18시)는 받는 사람 페이지에 `🎆 점등식 같이 보기 · 12월 25일 18:00` 버튼이 생긴다. 시작 10분 전까지는 누르면 `10분 전부터 들어올 수 있어요`가 뜨고 날짜와 시각이 든 초대 문구로 공유 창이 열린다. 10분 전부터는 `🎆 점등식 들어가기 · mm:ss 남음`이고 `/?gb=<id>&cer=1`로 광장에 들어간다. 시작 뒤 2분 동안은 `🎆 방금 켜졌어요 · 점등식 보러 가기`, 그 뒤에는 버튼이 없다. 예산 hard에서는 들어가지 않고 `지금은 광장이 붐벼서 점등식에 들어갈 수 없어요. 잠시 뒤에 다시 해 주세요`가 뜬다(`GET /rt/gift/<id>`와 페이지 데이터의 `hard`). 만든 사람의 공유 문구에는 시작 전까지 `🎆 점등식 … 에 같이 봐요!`가 붙는다. 비컨 `cer`(점등식에 온 기기), `cershot`(단체 사진 저장·공유)은 관리자 `🎁 선물 전광판` 표에 있다.

---

## Track P — the plaza (ceremony, teaser, photo)

**Files (yours):** `gift.js`, `ts3d/screens.js`, `giftart.js`, `timesSquare3d.js`, `camrig.js`, `ui.js`, `index.html`, `main.js`, `test/camrig.test.mjs`, `test/welcome.test.mjs` (painter tests), `test/gift.test.mjs` (the gift.js parts only: coordinate with nothing; the lead merges the two tracks' hunks), new `test/ceremony-plaza.test.mjs`.
**Not yours:** `giftrules.js`, `giftpage.js`, `gift.html`, `giftsrv.js`, `worker.js`, `admin-gift.js`, `live.js`, `net.js`, `test/ceremony.test.mjs`. (Both tracks may add tests to `test/gift.test.mjs`: put yours in a new `describe('점등식 in the plaza', …)` block at the end of the file so the merge is an append.)

### What the participant sees

1. A tap on `🎆 점등식 들어가기` opens `/?gb=<id>&cer=1`. Before the plaza's room is joined, the plaza reads the board (`GET /rt/gift/<id>`): `early` → back to `/g/<id>?cer=early`; budget hard inside the window → back to `/g/<id>?cer=busy`; `plain` (the late window is over, or no fixed start) → today's `?gb=` visit (`land`); `gone` → today's note.
2. A newcomer sees today's boot card; a returning player enters as usual. No intro, no tutorial, no welcome board.
3. **wait.** The avatar stands at the board's front, spread so friends do not overlap, facing the board; the camera looks at the board once (`focusSlot`, hold 3.5 s, ended by any drag or step as today). The board shows the teaser: chip `곧 켜져요` (left), `WISH BOARD` (right), `To. 민지` big, `🎂 18:00에 켜져요`, and `09:12` (repainted once a second); its ticker line reads `점등식   ·   To. 민지   ·   18:00에 켜져요   ·   …`. Toast `🎆 민지님 선물 전광판 점등식 · 18:00에 켜져요`. Other players' avatars that came the same way stand around (same room). At −30 s a device farther than 25 m from the front point gets `전광판 앞으로 오면 단체 사진에 같이 찍혀요` (tappable: back to the front).
4. **count** (−10 s). A big number in the middle of the screen, 10…1 (`cerDigit`), white with a dark outline, `min(42vw, 42vh)` tall, no pointer events. The HUD hides (`body.gift-cer`) unless a sheet or layer is open. The camera goes to the board (`focusSlot`, hold until +6.5 s) unless the player is driving or moving.
5. **lit** (0 s). The number goes; the same screen shows the real gift card (no blank frame); the avatar cheers once (`playEmote(3)`: `🙌` over the head, the `Cheer` gesture, one `{t:'E', k, e: 3}` to the room; if the cooldown refuses it, the next tick tries again until +5 s); six rounds of fireworks around the face (`cheerAt(slot)`, 1.2 s apart).
6. **+6.5 s** the camera cuts or glides to the photo pose and the avatar turns to face it; **+8 s** the photo: the 3D view with every avatar's name tag including my own, and the band `To. 민지 · 2026.12.25 · WISH BOARD 가상 광장` across the bottom. The HUD comes back and the photo card opens (one modal layer): heading `📸 단체 사진이 나왔어요`, the picture, buttons `사진 저장` (gold), `공유하기`, `받는 사람 페이지로`; Escape, the back button and `✕` close it. `사진 저장` saves `wishboard-<id>.jpg` (giftfilm.js `saveBlob`); `공유하기` shares the file with `cerPhotoText(g)` and the page link when the browser can share files, else the link alone, else copies it; a done save or share sends beacon `cershot`. `받는 사람 페이지로` goes to `/g/<id>`.
7. **Late arrival** (0 … +2 min, first seen in `lit`): the lit card, one round of fireworks, the toast `🎆 민지님 선물 전광판이 방금 켜졌어요!`, no countdown, no automatic photo; a tappable notice `📸 지금 단체 사진 찍기` (same pose, shot and card on tap) while `lit`. A cheer only within the first 5 s.
8. **Hidden tab:** coming back, the tick runs at once (`visibilitychange`) and resumes at the phase it is in (decision 11).
9. **over** (+2 min): the HUD is back, the overlay gone; the pin keeps the card one more minute, then `/rt/world` shows it as for everyone.

### Interfaces

```js
// gift.js
// At import: when the address has ?gb=<id>&cer=1, start the ceremony gate at once (before main.js's boot card is done).
export function cerGate() // -> Promise<{ go: true, g, start } | { go: false }>   (resolved once; later calls return the same promise)
//   GET /rt/gift/<id> (no token needed), skew from its Date header (live.js clockSkew) for this decision only;
//   start = cerDebugStart(location.search, location.hostname, t) || cerStart(g);
//   cerArrive(g, t, { hard: !!d.hard, start }): 'early' | 'busy' -> location.replace(cerBack(id, why)) and never resolves;
//   'go' -> { go: true, g, start }; 'plain' | 'gone' | a failed read | 4 s without an answer -> { go: false } (today's land(id) path).
// mountGift({ world, ui, whenBuilt, introDone, budgetDown }) // budgetDown: () => boolean (main.js: net.budgetDown || net.gateDown)
//   arrive(): with ?cer=1, awaits cerGate(); go -> ceremony(g, start); else land(id) as today.
//   window 'message' { t: 'gift', act: 'cer', id }: closeMaker(); then the same gate logic for that id (no reload).
// The tick: setInterval 250 ms + visibilitychange; cerSteps(start, nowMs(), done) and the steps above; kts_gseen / kts_gv shared with the
// page: beacon(id, e) = beaconOnce(json('kts_gseen'), id, e, kstDay(nowMs())) then sendBeacon('/rt/gift/<id>/seen', { v, e }).

// main.js
//   enter(): await giftUi.cerHold() (gift.js: cerGate() when ?cer=1, else resolved) before net.join('square', …). The boot card is not changed.
//   mountGift(…, budgetDown: () => !!(net.budgetDown || net.gateDown)).

// ts3d/screens.js (createBoards)
pinGift(g, ms = 30000, { cer = 0 } = {}) // cer: the start; the entry keeps it after giftClean. paint(): a pinned entry with cer and nowMs() < cer
//   -> paintTeaser(b.canvas, cerTeaser(gift, nowMs(), cer)); otherwise paintGift as today. giftTick(): the pinned cer board repaints when
//   its shown second changes or the start is crossed (at most once a second). While that pin lives, giftAt() prefers the pin's entry over
//   the same id in `gifts` (the localhost seam runs on a live board that /rt/world also lists). Ticker line for the teaser as above.

// giftart.js
export function paintTeaser(canvas, t) {} // t: cerTeaser's fields only. The paintGift ground (theme t.th), chip helper, fitSize. Draws
//   t.chip, 'WISH BOARD', 'To. ' + t.to, t.emoji + ' ' + t.when + '에 켜져요', t.left. Never anything else.

// camrig.js (pure)
export function cerShotPose({ pos, normal, w, h, front, aspect, fov }) {} // -> { cam: {x,y,z}, look: {x,y,z}, fov }
//   pos: the face centre, normal: its unit normal {x,z} (y 0), w/h: the face size (m), front: the crowd's centre {x,z}, aspect: w/h of the view,
//   fov: the vertical base fov (deg). Decision 14.
export function cerSpread(seed) {} // seed in [0,1) -> { u: -4..4, n: 0..3 } metres (right of the face, out along the normal)

// timesSquare3d.js (world api)
goToSlot(slotId, { spread } = {}) // spread: a seed (gift.js keeps one per tab in sessionStorage 'kts_cerseat'); adds cerSpread's offset
cerPose(slotId) // -> true when the photo pose is up: a pinned startCine to cerShotPose(…) (a cut with reduced motion), my avatar turned to
//   face the camera unless driving or moving; false when driving or the board is not on the map.
capture({ me = false, band = '' } = {}) // me: keep my own name tag (forced visible for this render); band: the bottom band's text
//   (default: today's 'WISH BOARD · 모두의 전광판'). Default call unchanged (ui.js openShot).
cerEnd() // ends the pinned photo pose (endCine) and nothing else

// ui.js
busy() // -> true while a sheet or a layer is open (sheets.length > 0 || ext)
// HUD hiding is gift.js's: body.gift-cer #ui { visibility: hidden } in gift.js's CSS, like body.gift-rec.
```

### Tasks

- [ ] **P1 `camrig.js`.** Tests in `test/camrig.test.mjs`: `cerShotPose` for a 12×6.75 m street face and a 20×11 m lot face, front point 9 m out: for aspects 9/19.5, 9/16, 16/9, 19.5/9 the four corners of the face and the crowd box (front ±4 m right, 0…3 m out, 0…1.9 m high) project inside NDC ±0.95 with the returned fov; the camera is farther from the face than the front point and on its normal (±0.01 m); portrait puts the face centre above the screen centre; `cerSpread(0)`, `(0.5)`, `(0.999)` stay in range, two different seeds give two different spots. Fail, implement, pass. Commit.
- [ ] **P2 `giftart.js` `paintTeaser`.** In `test/welcome.test.mjs` (its recording fake 2D context): drawn strings include `곧 켜져요`, `To. 민지`, `🎂 18:00에 켜져요`, `01:30`; a board whose `msg` is `비밀 문구 🤫` and `from` `지수`, passed through `cerTeaser`, never draws `비밀` or `지수` (check every `fillText` / `strokeText` argument); a 13-character name is drawn cut to 12. Commit.
- [ ] **P3 `ts3d/screens.js` teaser pin.** Read `giftPlace`, `giftAt`, `paint`, `giftTick` first. Implement the `cer` option as specified. Test (the `createBoards` harness if `test/` has one, else extract the choice into a pure helper in a file you own and test that): before the start the pinned board paints the teaser, after it the gift card, same slot, no `giftPlace` re-placement in between; repaints at most once per second over a 3 s run of 0.64 s ticks; a `gifts` list holding the same id does not replace the teaser before the start. Commit.
- [ ] **P4 `timesSquare3d.js`.** `goToSlot` spread, `cerPose`, `capture({ me, band })`, `cerEnd`. Check, and say in the report, whether other avatars' name tags are drawn at the photo's distance (`ts3d/avatars.js` tags are sprites on layer 2; the camera enables layer 2; find any distance fade). Source-level tests where the file is tested that way (`test/plaza.test.mjs`, `test/feel.test.mjs` read the source): `capture()` with no argument still hides my tag and draws `WISH BOARD · 모두의 전광판`; `cerPose` uses `cerShotPose` and refuses while driving. Commit.
- [ ] **P5 `gift.js` ceremony.** Tests in `test/ceremony-plaza.test.mjs` or the new block of `test/gift.test.mjs`, with the fake DOM loading `gift.js` and a fake world recording calls: `?gb=<id>&cer=1` at D 17:40 (early) → `location.replace('/g/<id>?cer=early')`, no `pinGift`; at D 17:55 with `hard: true` → `'/g/<id>?cer=busy'`, no `pinGift`; at D 17:55 → `pinGift(g, cerPinMs, { cer: start })`, `goToSlot(slot, { spread })`, toast `🎆 민지님 선물 전광판 점등식 · 18:00에 켜져요`, beacon `cer` once (a second arrival the same day sends none); stepping the clock: the overlay shows `10` at −10 s and `1` at −0.5 s, `body.gift-cer` set, removed by the card; `playEmote(3)` once (a first `false` is retried); `cheerAt` six times; `cerPose` at +6.5 s; `capture({ me: true, band: 'To. 민지 · 2026.12.25 · WISH BOARD 가상 광장' })` at +8 s; the card's three buttons (`사진 저장` → `cershot` once; `받는 사람 페이지로` → `/g/<id>`); with `ui.busy()` true at +8 s the photo is taken and the notice `📸 단체 사진이 나왔어요 · 보기` opens the card; a late arrival at +30 s: no overlay, one `cheerAt`, no capture, the notice `📸 지금 단체 사진 찍기`; a jump from −20 s to +3.7 s (hidden tab): no overlay, rounds 3–5 only, capture at +8 s; `budgetDown()` true at −60 s → `cerBack(id, 'busy')`, at +10 s → stays; the embedded `{ act: 'cer' }` message closes the frame and runs the gate; at +2 min the tick stops and the HUD class is gone. Commit.
- [ ] **P6 `main.js`, `ui.js`, `index.html`.** `enter()` awaits `giftUi.cerHold()` before `net.join`; `budgetDown` passed; `ui.busy()`. If you put any CSS in `index.html`, the ux tests (`test/ux-pass.test.mjs`: 44 px targets, no text under 12 px, contrast) must cover the card's buttons; otherwise keep the card's CSS in `gift.js` like `#kts-gift-done` and make the buttons at least 48 px tall there. Whole suite. Commit.
- [ ] **P7 self-review.** Re-read the diff against "What the participant sees". Confirm: nothing new is sent to the room (only `playEmote(3)`'s existing `E` and the ordinary position packets), nothing is uploaded (no `publishShot`), the teaser is drawn from `cerTeaser` only, `?gb=` without `cer=1` behaves exactly as before, the welcome board does not run on a ceremony link, quality `low` takes the same path. Whole suite. Final commit and report.

### Browser check (the lead, after the merge)

375×812 (portrait phone), 812×375 (landscape phone), desktop, and `/?q=low`: a locally made board with `/?gb=<id>&cer=1&cerin=75` (whole run: teaser, the gather notice off-screen test by walking away, count, light, cheer, rounds, pose, photo card), `&cerin=-20` (late), `&cerin=700` (sent back early), a hidden tab across the start (switch tabs at −15 s, back at +4 s), reduced motion on (cuts, the number does not animate), a sheet open at −10 s (HUD stays, number over it; at +8 s the notice). Look at the photo on each size: board whole, avatars and name tags in, band readable. Two browser profiles at once for two avatars (their turn to the camera, their tags in my photo).

### Draft for `IMPLEMENTED.md` (correct it to what you built)

> `/?gb=<id>&cer=1`로 들어오면 방에 들어가기 전에 보드를 한 번 읽는다(`gift.js` `cerGate`). 10분 전보다 이르면 `/g/<id>?cer=early`로, 예산 hard면 `?cer=busy`로 돌려보낸다. 시작 2분 뒤가 지났으면 지금의 `직접 가서 보기`다. 10분 전부터는 캐릭터가 그 전광판 앞(기기마다 조금씩 비켜 선 자리)에 서고, 전광판에는 이 기기에서만 예고 카드(`곧 켜져요`, `To. 이름`, `18:00에 켜져요`, 남은 mm:ss, 1초마다)가 걸린다. 문구와 보낸 사람은 그리지 않는다. 10초 전부터 화면 가운데 큰 숫자로 세고 HUD가 숨는다(시트가 열려 있으면 숨기지 않는다). 정각에 같은 화면이 진짜 카드로 바뀌고, 폭죽이 1.2초 간격으로 여섯 번 터지고, 내 캐릭터가 `🙌 만세`를 한 번 한다(있는 리액션 `{t:'E', k, e: 3}`). 6.5초에 카메라가 사진 자리로 가고 캐릭터가 카메라 쪽으로 돌아서며, 8초에 이름표와 아래 띠 `To. 민지 · 2026.12.25 · WISH BOARD 가상 광장`가 든 단체 사진을 이 기기에서 찍는다. 서버에는 올리지 않는다. 카드는 `사진 저장`, `공유하기`, `받는 사람 페이지로`다. 늦게 온 사람(2분 안)은 켜진 카드와 폭죽 한 번을 보고, 사진은 `📸 지금 단체 사진 찍기` 알림으로 고른다. 탭을 숨겼다 돌아오면 그때의 단계부터 이어 가고 지나간 카운트다운과 폭죽은 다시 하지 않는다. 동작 줄이기에서는 카메라가 잘라 바뀌고 숫자는 움직이지 않는다. 화질 `low`도 같다.

---

## Trying it locally without waiting for 18:00

- **Unit level:** every timing rule takes a start in ms (`cerPhase(start, now)`, `cerSteps(start, now, done)`); `test/ceremony.test.mjs` › `cerSteps` drives a device tick by tick, including the hidden-tab jump. Track P's tests fake `nowMs` the same way.
- **Browser (the lead):** run the local Worker as `HANDOFF.md` › 로컬 실행 says (preview `plaza`, `wrangler dev --port 8790`). Make a board at `/gift` (any start, "지금" is fine: it lives in the local Durable Object only and never reaches the live site). Then:
  - `/g/<id>?cerin=700` (the page: `early`), `?cerin=120` (`wait`), `?cerin=-30` (`lit`). The button's link carries `&cerin=` forward.
  - `/?gb=<id>&cer=1&cerin=75`: the plaza runs the ceremony against a start 75 s from load (`cerDebugStart`); `&cerin=-20` is a late arrival; `&cerin=700` is sent back as early.
  - `cerin` is read only on `localhost`, `127.0.0.1`, `[::1]` and `*.localhost` (tested). On the live site it does nothing.
  - Budget hard cannot be faked in the browser; it is covered by Track G's Worker tests (`lvlNow` 2) and Track P's gate tests.
- **What a tester must not press locally:** `wrangler dev` talks to the production Supabase. Verified (`HANDOFF.md` › 로컬 실행, `AGENTS.md`, the spec): a claim (점령), a lot sale (분양), anything that grants coins, and saving a species stay on the live service; never take the free first slot (`무료 첫 칸`) or touch the main tower. Guesses (not checked, so avoid them too): signing in with a real account, and `알림 켜기` / `열리면 알림 받기` (push consent rows). Gift boards, 롤링페이퍼 lines, gift beacons and videos stay in the local DO. The cheer (`playEmote(3)`) and fireworks are room messages and local effects only. Judge the look at `/?q=high` as well as `/?q=low` (the preview pane picks `low`; a hidden pane stops frames). Write down the guest wallets and boards made, as batch 1 did.

## Risks and what cannot be verified here

- **Rooms of 50.** A room shard holds 50 (`worker.js` `CAP`); a full `square` sends new arrivals to `square-2`…`-8` (`net.bumpShard`). Friends who land on different shards do not see each other's avatars or cheers, and are not in each other's photo. At 18:00 with other boards' ceremonies and the evening crowd, this is likely before 30 people. Not solvable without a server change (a room per board would be one); measure in the season test.
- **Clock agreement.** `clock.off` comes from a 1-second `Date` header (±0.5 s), so two devices can show the countdown up to about a second apart; noticeable on a video call, not in the plaza.
- **Friends' turn and cheer arrive late.** Position packets and the 1.15 s dead reckoning delay a friend's turn to the camera by about a second, so at +8 s some may still be turning; far peers are thinned (`FAR_MS`) but the crowd is within `NEAR_R`.
- **Phones:** frame rate with 10–30 avatars and six rounds on `low`; memory of a 1280 px JPEG on old iPhones; iOS Safari and the KakaoTalk in-app browser for `navigator.share` with a file (falls back to the link); a phone locked across the start (timers stop: it resumes, decision 11). All need real phones.
- **The "지금" edge.** A "지금" board made in the first 10 minutes after 9/12/15/18 h looks like a fixed start in the public view; its recipient page can show `🎆 방금 켜졌어요` for what is left of the 2 minutes. Harmless, rare.
- **Nobody outside the ceremony** sees the board lit until `/rt/world` lists it (2–5 minutes), as the spec accepts.
- **Hidden HUD swallows notices** for ~18 s; an error in that span is not seen. Accepted for the moment's sake.
- Not verifiable without several people: whether 5–30 avatars at the front point frame well, whether the spread is enough, how many arrive late.

## For the owner (product questions; the plan builds the recommendation unless told otherwise)

- On a ceremony board's own day, the recipient page already plays the film (with the message) from 00:00, hours before the lighting (batch 1 `day` view). Should a ceremony board keep the `before` look (countdown, the preview with `그날 공개돼요 🤫`) until its start, so the lighting is the reveal? Recommendation: yes. **Answered 2026-11-24: yes ("점등까지 숨기기").** It is decision 20 and Track G's task G6.
- A room holds 50; friends can be split across rooms at a busy 18:00. Accept for the season test and measure (recommended), or plan a room per ceremony later (a server change).

## Self-review (done)

- Spec ③ "보이는 것" 1 → Task 0 `cerButton`/`cerInvite`, G2, G3 · 2 → `cerArrive`, P5 gate, P3 teaser, P2 painter · 3 → P5 count/light/cheer/rounds, P4 · 4 → P1 pose, P4 capture, P5 card · 5 → `cerSteps` late path, P5. "방식": no server signal (Task 0, all `now` from the caller) · one `GET /rt/gift/<id>` (P5 gate, reused for the ceremony) · `pinGift` first (P3) · existing reaction (P5) · photo on the device, not uploaded (P4, P5, P7) · hidden tab resumes (`cerSteps`, P5) · budget hard sends back (decision 18, G1, P5). "재는 것" `ev:cer`, `ev:cershot` → G1, P5, G3 admin. "테스트" → `test/ceremony.test.mjs` (boundaries, clock offset), P2 (teaser never draws the message), G1/P5 (hard).
- Names: `cerGate`, `cerHold`, `cer` pin option, `paintTeaser`, `cerShotPose`, `cerSpread`, `cerPose`, `cerEnd`, `capture({ me, band })`, `ui.busy`, `budgetDown`, postMessage `act: 'cer'`, `hard` on the read and page data, `?cer=early|busy`, `&cerin=` are the same in both tracks.
- `AGENTS.md`: no Supabase change, no cron, no socket message, my position stays local input (spread and turn are local like the map teleport), `giftrules.js` stays pure and query-less, no secrets, budget guard untouched.
