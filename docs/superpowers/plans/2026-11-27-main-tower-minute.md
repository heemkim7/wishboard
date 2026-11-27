# 메인 타워 축하 1분 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 선물 전광판을 하루 30자리의 "메인 타워 축하 1분"에 올리는 두 길(A 친구 응원 10곳, B 응원 포인트 2,000)과, 친구 반응 공유 보상(+50, 하루 5명), 그날 전 하트를 만든다.

**Architecture:** 규칙은 새 순수 모듈 `towerrules.js`(I/O 없음, 쿼리 없이 import) 하나에 둔다. 서버는 `giftsrv.js`의 Meter 인스턴스 `'gift'`(DO SQLite)에 표 셋(`gn` 반응한 연결, `gt` 예약, `ga` 만든 사람별 기록)을 더하고, 포인트는 Worker가 넘겨주는 `supabaseRpc`로 `spend_plaza`(2,000, 마이그레이션 뒤)와 `grant_coins`(보상·환불)를 부른다. 광장은 `/rt/world`의 새 키 `tower`와 방(Room) 푸시 `WORLD_UPDATE kind:'TOWER'`로 예약을 알고, `ts3d/screens.js`가 그 1분에 `MAIN_*` 다섯 면을 덮는다.

**Tech Stack:** 빌드 없는 ES 모듈, Cloudflare Workers + Durable Objects(SQLite), Supabase RPC, `node --test`.

**바탕:** `docs/superpowers/specs/2026-11-27-main-tower-minute-design.md`(설계), `AGENTS.md`(경계), `docs/gift-board.md`, `docs/prime-screens.md`, `docs/point-sources-2026-11-27.md`.

---

## 0. 시작 전에 (오케스트레이터)

- HEAD 확인: `git rev-parse HEAD` 가 `cc31ce6b2fe69a50edc98aead2c2e2c629a4d648` 이어야 한다. 아니면 멈추고 주인에게 묻는다.
- 작업 트리에 오늘 커밋하지 않은 큰 변경(소원 상금·스폰서 코드 제거, 공유 보너스 계정마다 한 번, 포인트 문구)이 있다. **이 계획은 그 작업 트리 위에서 짠 것이다.** 워크트리 에이전트(`isolation: "worktree"`)는 push된 `main`에서 시작하므로 지금 변경을 못 본다. 둘 중 하나로 한다.
  1. 주인이 지금 작업 트리를 먼저 커밋하게 하고(커밋은 주인 확인 뒤), 모든 브리프에 그 sha를 `git rev-parse HEAD`로 붙여 넣고 "아니면 `git reset --hard <sha>`"를 적는다.
  2. 워크트리 없이 이 체크아웃에서 바로 일한다. 이때 두 구현자의 파일 묶음은 아래 표처럼 겹치지 않게 지키고, 커밋은 자기 파일만 `git add <파일>`로 한다(`git add -A` 금지).
- 기준선: `node --test test/*.test.mjs tools/account.test.mjs` → 2,181 tests, 2,174 pass, 0 fail, 7 skipped. 이 수가 아니면 먼저 원인을 본다.
- 한 번에 무거운 구현자 둘까지(이 PC). 반복할 때는 테스트 파일 하나씩, 마지막 커밋 전에만 전체 묶음.
- `wrangler`를 돌리지 않는다. 운영 DB를 건드리지 않는다. 마이그레이션은 파일만 만들고, 주인이 SQL 편집기에서 손으로 돌린다.
- 새 파일은 LF로 커밋한다(`core.autocrlf=true` 주의). 커밋 뒤 `git cat-file -p HEAD:<파일> | tr -cd '\r' | wc -c` 가 0인지 본다. `IMPLEMENTED.md`는 원래 CRLF 덩어리다. 고친 뒤 `git diff --numstat IMPLEMENTED.md`가 파일 전체를 바꿨다고 하면 HEAD 바이트에서 다시 만든다(메모리 `implemented-md-crlf-blob`).

---

## 1. 설계와 다른 점 / 열린 문제

코드를 읽고 정한 것이다. "권장"이 이 계획이 따르는 쪽이다. 주인이 다르게 정하면 해당 작업만 고친다.

1. **만든 사람의 네트워크 해시는 이미 있다.** `gb.ip`(NOT NULL)가 만들 때의 네트워크 해시이고(`giftsrv.js` `make`의 `k.ipHash` = `worker.js` `wishIp`, IPv6 /64), 하트(`seen` 항목의 `n`)와 롤링페이퍼(`gm.ip`)도 같은 함수다. 설계 4장의 "새 열"과 3장의 "예전 보드는 A와 공유 보상을 열지 않는다"는 필요 없다. 권장: 새 열을 만들지 않고, 방어로 `gb.ip`가 비어 있는 보드만 열지 않는다(`reactCounts`).
2. **`grant_coins`는 손님 actor id(`guest:<uuid>`)에도 준다. 단 `wallets` 줄이 있어야 한다.** 없으면 HTTP 200에 `{ ok:false, error:'그 지갑을 찾지 못했습니다.' }`. `/gift`에서만 손님이 된 사람(광장에 들어온 적 없음)은 지갑 줄이 없을 수 있다. 권장: 지갑을 새로 만들지 않는다(`profile_read` 같은 함수는 시작 100포인트를 만든다). 실패하면 그 반응의 `paid`와 하루 수를 되돌리고(`giftPayUndo`, DO 한 번) 하루 합계 `tpay_fail`을 센다. 그 연결의 보상은 다시 주지 않는다(두 번 주는 일은 없다).
3. **`/rt/world`의 선물 목록에 `tw`를 붙이는 설계는 쓰지 않는다.** `gifts`는 지금 걸려 있는 보드(`a <= now < b`)만 `GIFT.liveMax` 160개까지 싣고, 테스트가 그 항목의 키 묶음을 못 박아 둔다(`gift-worker.test.mjs` "the world carries the boards up now"). 게다가 광장 클라이언트는 소켓이 붙어 있는 동안 `/rt/world`를 다시 읽지 않는다(`main.js` 60초 동기화는 소켓이 끊겼을 때만). 그래서 (가) 창이 열리기 전에 `/rt/world`를 받은 사람, (나) 예약보다 먼저 들어와 있던 사람은 예약을 모른다. 권장: `/rt/world`에 새 키 `tower: [{ id, m, to, from, occ, msg, th }]`(앞으로 26시간 안, 60개까지, 빈 목록이면 키 없음)를 두고, 예약·취소 때 사람이 앉아 있는 방에 `WORLD_UPDATE kind:'TOWER'`를 보낸다(`worker.js` `wishRooms`, 예산 hard면 보내지 않음). `Room.httpWorld`는 지금 `BILLBOARD`/`PLOT`만 받으므로 `TOWER`를 더한다. 예전 탭은 모르는 kind를 그냥 넘긴다(`ui.news`가 모르는 kind는 아무것도 안 한다).
4. **메인 타워 내용은 클라이언트 `ts3d/screens.js` `paint(b)` → `primeNow(b)` → `primerules.js` `primeAt(plan, slot, t)`가 정한다.** 기념일 정시 1분은 `primeAt`의 `m % H < 60e3 && plan.annH[hour]`(승인된 기념일 팀이 있는 시간만, 21시 제외)이고, 21시는 9시 팀이다. 권장: `primerules.js`는 바꾸지 않는다. `screens.js`가 MAIN 면을 그릴 때 `towerAt(list, t)`를 `primeNow`보다 먼저 본다. `towerAt`은 정각(`:00`)과 21시대 분을 늘 버리므로(서버도 그 분을 처음부터 받지 않는다) "21시 → 9시 팀, 정시 1분 → 기념일 팀, 예약된 1분 → 축하, 그 밖 → 1,000명 팀" 순서가 그대로 된다. 정각은 그 시간에 기념일 팀이 없어도 팔지 않는다(앞날의 계획은 예약할 때 아직 없다).
5. **`spend_plaza`의 거절 문구는 감지에 쓸 만큼 안정적이다.** `schema.sql`이 유일한 정의이고, 허용 목록 밖의 금액이면 키 확인 바로 뒤, 지갑을 읽기 전에 HTTP 200 `{ ok:false, error:'그 금액은 쓸 수 없어요.' }`를 돌려준다. 어떤 마이그레이션도 이 함수를 바꾸지 않았다. 권장: (가) 문구를 `towerrules.js` `SPEND_OLD`로 못 박고 정확히 같은지로만 본다, (나) 누르기 전에 알 수 있도록 `GET .../tower`가 없는 지갑 `probe:tower`로 2,000을 한 번 물어본다(`forget_login` 탐침과 같은 방식, isolate 10분 기억). 마이그레이션 전에는 `SPEND_OLD`, 뒤에는 `지갑을 찾지 못했습니다.`가 온다. 새 마이그레이션은 그 문구를 바꾸면 안 된다(테스트가 본다). Worker의 `/rt/spend`도 같은 문구를 쓰지만 그것은 RPC 답이 아니므로 섞이지 않는다.
6. **Turnstile `theart`와 `tower`.**
   - 하트 경로는 지금 토큰도 사람 확인도 없고, 본문을 300바이트까지만 읽는다(`readSmall(req, 300)`). Turnstile 토큰은 2,048자까지다. 권장: 2,600바이트로 늘린다. 페이지는 403을 받아야 사이트 키를 아는데, 하트는 토큰이 없어도 세어야 하므로 403으로 돌려보낼 수 없다. 권장: `/g/<id>` 페이지 데이터(`gift-data`)에 공개 사이트 키 `site`를 넣는다(`giftKit`에 `humanSite`를 더함). 페이지는 `site`가 있으면 `human(site, 'theart')`로 토큰을 받아 `{ v, ts }`를 보낸다. Worker는 `humanGate(env, req, b, 'theart')`가 `null`이면(통과, 또는 Turnstile이 꺼짐) 항목에 `t:1`, 아니면 `t:0`을 붙이고 하트는 그대로 센다. 토큰이 없으면 `humanGate`가 siteverify를 부르지 않고 바로 403을 만드므로 비용이 없다.
   - `tower`(B만): 본문 `{ m, how:'points', ts }`. `giftpage.js` `post(path, body, { action:'tower' })`가 403 `human` → 토큰 → 한 번 더 보내기를 이미 한다.
   - 둘 다 `human.js` `HUMAN_ACTIONS`에 더한다. `test/reward-client.test.mjs`가 그 배열을 정확히 비교하므로 함께 고친다. Turnstile 위젯 설정은 바꿀 것이 없다(action은 위젯이 붙이는 이름표).
   - human.js는 보상 확인에도 "눌러 주세요" 카드를 띄울 수 있다. 하트를 누른 사람에게 가끔 상자가 보일 수 있다. 하트 자체는 먼저 눌린 것으로 보인다.
7. **DO 호출 세기.** `worker.js` `fetch`가 `env = tallied(env, ctx)`를 만든 뒤 `giftApi`/`giftPage`에 그 env를 넘긴다. 그래서 `giftM(env)`의 모든 호출은 이미 예산에 센다. 새로 생기는 방 푸시(`towerTell`)는 반드시 giftsrv가 받은 그 env로 `env.ROOM`을 부른다(`worker.js` 안의 원래 env를 잡아 두지 않는다). `grant_coins`·`spend_plaza`는 Supabase fetch라 DO 예산에는 안 들지만 하위 요청 한도(무료 50)에 든다. 그래서 비컨 한 묶음이 주는 보상은 `TOWER.payMax` 10건까지다(넘치는 반응은 `paid` 0으로 남고 보상이 없다).
8. **예산 hard(`lvlNow` 2).** 예약·취소 POST는 DO 호출 없이 503 `busy`. `GET .../tower`는 isolate의 보드 사본(`ONE`, hard면 10분)으로 `tw`만 답하고 `hard:true`. 하트 비컨은 지금처럼 버리므로 보상도 A 진행도 없다. `/rt/world`의 `tower`는 `giftWorld`가 가진 마지막 사본. 방 푸시는 보내지 않는다. 신고(`report`)는 hard에서 이미 503이라 가리기·환불이 일어나지 않는다. 운영자 가리기는 hard에도 되므로 그때의 환불 `grant_coins`는 `waitUntil`로 간다.
9. **B의 흐름: 묻기 → 빼기 → 쓰기 → 실패면 돌려주기.** 설계는 "빼고 쓰고, 실패하면 돌려준다"이다. 예측할 수 있는 거절(30일 간격, 하루 한 번, 매진)까지 빼고 돌려주지 않도록, 먼저 같은 DO 메서드를 읽기만 하는 모드로 한 번 부른다(`giftTowerBook(..., dry=true)`). 그래서 B 한 번에 DO 2번 + RPC 1번(경합이면 +1). 두 사람이 같은 분을 몇 초 사이에 고른 경우에만 빼고 돌려준다.
10. **하루와 날.** "지금" 보드는 자정을 넘는다(22:00~04:00). 권장: 그 1분의 KST 날로 센다(`gt.day = kstDay(m)`). "하루 30", "만든 사람 하루 한 번"이 모두 그 분의 날이다. 30일 간격은 포인트를 쓴 때(`ga.at`)부터 잰다. 취소(신고·운영자 가리기·주인 삭제)로 풀린 예약은 `ga` 줄도 지워 간격과 하루 한 번을 돌려준다.
11. **주인 삭제와 탈퇴.** 설계는 "지워지면 자리를 풀고 B는 돌려준다". 권장: 주인이 지우면 아직 시작하지 않은 B는 2,000을 돌려준다. 탈퇴는 지갑이 없어지므로 돌려주지 않고 줄만 지운다. 시작한 1분(그 분이 지금이거나 지남)은 어떤 경우에도 돌려주지 않는다.
12. **방에 쌓인 포인트.** 광장의 `/rt/claim-billboard`는 방을 먼저 정산한다(`settle`). `/g/<id>`는 방 토픽을 모르므로 정산하지 않는다. 방금 광장에서 받은 포인트는 최대 30초쯤(`FLUSH_MS`) 늦게 지갑에 들어간다. 권장: 정산하지 않고, `poor`일 때 "광장에서 방금 받은 포인트는 1분쯤 뒤에 반영돼요"를 덧붙인다.
13. **반응에서 빼는 것.** 만든 사람의 네트워크(`gb.ip`) 말고도, 만든 사람 계정이 다른 네트워크에서 쓴 롤링페이퍼(`gm.uid === gb.uid`)는 세지 않는다. 하트에는 계정이 없으므로 만든 사람이 다른 연결(LTE)에서 누른 하트는 막을 수 없다(설계가 받아들인 한계).
14. **그날 전 하트.** 받기는 `heartTakes`(보드가 `gone`이 아니면)로 넓히고, 보이기는 지금의 `heartsOpen`(공개 뒤) 그대로. 그날 전 받는 사람 페이지('before' 보기)에 하트 버튼을 새로 두고, 공개 전에는 숫자 없이 `🤍 하트 보내기` / `💖 하트를 보냈어요`로 쓴다(0을 보여 주면 "아무도 안 눌렀다"로 읽힌다). 기존 테스트 "💖 is hidden and refused before the board is revealed"는 "숨기지만 받는다"로 바꾼다.
15. **속보 문구.** `{받는 사람}의 {무슨 날}`은 `그냥`·`고마움`에서 어색하다. 권장 `TOWER_WORD`: 생일, 기념일, 합격, 응원, `just` → 특별한 날, `thanks` → 고마운 날. 주인이 바꿀 수 있다.
16. **10곳 알림 푸시.** 설계대로 광고가 아닌 거래 알림이고 밤 시간 제한이 없다. 답장 알림(`giftreply`)은 21~08시에 보내지 않는 것과 다르다. 권장: 설계대로 두되 `PUSH_GAP.gifttower` 60초, 보드마다 한 번(`gr` `to:<id>`).
17. **약관의 "하트 하나마다 주는 포인트도 없습니다".** `test/legal-nongame.test.mjs`가 이 문장을 요구한다. 새 보상은 하트 수가 아니라 "처음 반응한 서로 다른 연결, 하루 5명"이므로 문장은 남기고, 예외 한 줄을 그 앞에 둔다(작업 6). `primerules.js` `BOARD_ERR.prime`("명당은 포인트로 걸 수 없어요")과 `primeCard`의 "포인트로 살 수 없는 자리"는 응원 팀 명당과 전광판 걸기 경로의 말이라 그대로 둔다. 설계 1장의 원칙 예외는 문서(`docs/prime-screens.md`)와 약관에만 적는다.
18. **20:50~20:59.** 9시 배너(`live.js` `NINE.pre`)는 HUD 배너이고 메인 타워 면을 덮지 않는다. 그 10분은 고를 수 있게 둔다. 로컬 확인에서 화면이 겹치지 않는지 본다.
19. **로컬 확인과 운영 DB.** `wrangler dev`는 운영 Supabase를 쓴다(메모리 `local-dev-hits-production-db`). 공유 보상을 로컬에서 일으키면 그 시험 손님의 운영 지갑에 +50이 실제로 들어간다. 권장: 로컬 확인은 Turnstile 꺼짐, 버리는 손님 하나, 보고서에 그 지갑 id를 적는다. B는 로컬에서 누르지 않는다(마이그레이션 전이라 "준비 중"만 확인). 10곳은 워커 테스트가 맡고, 로컬에서는 `cf-connecting-ip` 머리글이 miniflare에서 그대로 들어가는지 먼저 확인한 뒤에만 흉내 낸다.
20. **"오늘" → "그날".** 설계의 `N/30`과 "오늘 메인 타워는 매진이에요"는 보드의 날이 오늘이 아닐 수 있다(30일 앞까지). 권장: 화면은 "그날 남은 자리 N/30", "그날 메인 타워는 매진이에요"(`TOWER_ERR.sold`). 창이 자정을 넘으면 두 날 중 적은 쪽을 보인다.
21. **10곳이 찬 뒤 그 1분 전까지.** 설계의 "그 1분이 시작하기 전까지 남긴 연결"은 A가 10곳이 찬 뒤에만 고를 수 있으므로 저절로 지켜진다. 따로 코드를 두지 않는다.

---

## 2. 약속 (작업 사이의 인터페이스)

두 구현자가 동시에 일하므로 아래 모양을 바꾸지 않는다. 바꿔야 하면 오케스트레이터에게 먼저 말한다.

**`towerrules.js` (작업 1)**: `TOWER`, `REWARD`, `TOWER_HOW`, `SPEND_OLD`, `TOWER_ERR`, `TOWER_WORD`, `minuteStart`, `minuteBlock`, `minuteFault`, `towerMinutes`, `towerDays`, `towerFault`, `reactCounts`, `towerEntry`, `towerWire`, `towerAt`, `towerKey`, `towerNews`, `towerClock`, `towerLook`, `towerCard`. `giftrules.js`에 `heartTakes`와 `giftView`의 `tw`.

**HTTP**
- `GET /rt/gift/<id>/tower` (주인 토큰) → `200 { ok:true, tw:{m,how}|null, days:{'YYYY-MM-DD':{left,mine}}, taken:[m…], friends, need:10, gap, guest, prep }` · hard면 `{ ok:true, hard:true, tw, guest, prep }` · `401 auth` · `403 owner` · `404 gone` · `429 rate` · `503 down|busy`.
- `POST /rt/gift/<id>/tower { m, how:'friends'|'points', ts? }` → `200 { ok:true, tw:{m,how}, coins? }` · 거절 `{ ok:false, code, error, taken?, days? }`: `401 auth`, `403 account|owner|human`, `400 minute|poor`, `404 gone`, `409 taken|sold|board|day|gap|friends`, `413 long`, `429 rate`, `503 busy|prep|down`, `502 down`.
- `POST /rt/gift/<id>/heart { v, ts? }` → 그대로 `{ ok:true }`. 본문 2,600바이트까지.
- `GET /rt/gift/<id>` 공개 `gift.tw`(분, 예약이 있을 때만). 주인은 `mine.tw = { m, how }`.
- `/g/<id>` 페이지 데이터에 `site`(Turnstile 공개 키 또는 `''`).
- `/rt/world`에 `tower: [{ id, m, to, from, occ, msg, th }]`(없으면 키 없음). `gifts` 항목은 그대로.
- 방 푸시: `{ t:'WORLD_UPDATE', kind:'TOWER', data:{ id, m, to, from, occ, msg, th } }`, 풀림은 `data:{ id, m, off:1 }`.
- 웹 푸시 `kind:'gifttower', gid` → 글 `친구 응원 10곳이 모였어요. 메인 타워 1분을 고르세요`, 주소 `/g/<gid>?o=1`.

---

## 3. 작업과 병렬 묶음

| 작업 | 무엇 | 파일 | 먼저 끝나야 할 것 |
| --- | --- | --- | --- |
| 1 | 순수 규칙 | 새 `towerrules.js`, `giftrules.js`(`heartTakes`, `giftView`의 `tw`), 새 `test/tower.test.mjs` | 없음 (혼자, 가장 먼저) |
| 2 | 서버: 반응·공유 보상·그날 전 하트·`theart` | `giftsrv.js`, `worker.js`(giftKit, Meter 메서드, 푸시 종류), `human.js`, 새 `test/tower-worker.test.mjs`, `test/gift-worker.test.mjs`(하트 테스트 하나), `test/reward-client.test.mjs`(배열) | 1 |
| 3 | 서버: 예약·환불·월드·방 푸시·마이그레이션 | `giftsrv.js`, `worker.js`(readWorld, Room.httpWorld, towerTell), `schema.sql`, 새 `migrations/2026-11-27-tower-minute.sql`, `test/tower-worker.test.mjs` | 2 |
| 4 | 광장: 메인 타워 덮기·우선순위·속보·`?gb=` | `ts3d/screens.js`, `timesSquare3d.js`, `main.js`, `ui.js`, `gift.js`, 새 `test/tower-client.test.mjs` | 1 |
| 5 | 선물 페이지: 주인 카드·자리 고르기·카운트다운·하트 | `giftpage.js`, `gift.html`, `test/gift.test.mjs` | 1 (서버 없이 가짜 답으로 테스트) |
| 6 | 문서·약관·질의서 | `legal.js`, `test/legal-nongame.test.mjs`, `docs/prime-screens.md`, `docs/gift-board.md`, `docs/point-sources-2026-11-27.md`, `docs/grac-inquiry.md`, `IMPLEMENTED.md`, `HANDOFF.md` | 3 (숫자·경로 확정) |
| 7 | 빌드 도장·전체 테스트·로컬 확인 | 도장이 고치는 `?v=` 줄 | 2~6 |

**병렬:** 작업 1을 한 사람이 끝내고 커밋한다. 그다음 두 줄로 나눈다.
- 줄 S(구현자 1): 작업 2 → 작업 3 → 작업 6.
- 줄 C(구현자 2): 작업 4 → 작업 5.
두 줄의 파일은 겹치지 않는다(`worker.js`, `giftsrv.js`, `human.js`, `schema.sql`, 테스트 `tower-worker`/`gift-worker`/`reward-client`/`legal-nongame`은 S만, `ts3d/screens.js`, `timesSquare3d.js`, `main.js`, `ui.js`, `gift.js`, `giftpage.js`, `gift.html`, 테스트 `tower-client`/`gift`는 C만). `giftrules.js`와 `towerrules.js`는 작업 1 뒤에는 아무도 고치지 않는다. 고칠 것이 생기면 오케스트레이터가 한 사람에게만 맡긴다. 작업 7은 둘 다 끝난 뒤 오케스트레이터가 혼자.

---

### Task 1: 순수 규칙 `towerrules.js`

**Files:**
- Create: `towerrules.js`
- Modify: `giftrules.js` (`heartsOpen` 옆에 `heartTakes`, `giftView`에 `tw`)
- Test: `test/tower.test.mjs` (새 파일)

- [ ] **Step 1: 실패하는 테스트 쓰기** — `test/tower.test.mjs`

```js
// 메인 타워 축하 1분 (towerrules.js): which minutes can be picked, the day's 30, one per board and per maker a day, the 30 days between
// point bookings, the friends' threshold (the maker's network never counts), what the plaza shows in that minute, and the pre-day 💖 rule
// in giftrules.js. Pure: no clock, no I/O.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TOWER, REWARD, SPEND_OLD, TOWER_WORD, minuteBlock, minuteFault, towerMinutes, towerDays, towerFault, reactCounts, towerEntry, towerWire, towerAt, towerKey, towerNews, towerClock, towerLook, towerCard } from '../towerrules.js';
import { giftView, heartTakes, heartsOpen } from '../giftrules.js';

const KST = (s) => Date.parse(s + '+09:00');
const MIN = 60e3;
// A board 18:00-24:00 on 2026-12-01, made by guest:a on network aaaa…
const G = (o = {}) => ({ id: 'abcd1234', uid: 'guest:a', ip: 'a'.repeat(16), st: 'live', day: '2026-12-01', a: KST('2026-12-01T18:00:00'), b: KST('2026-12-02T00:00:00'), to: '민지', from: '지수', occ: 'bday', msg: '축하해', th: 'party', ...o });
const NOW = KST('2026-12-01T17:00:00');

describe('which minutes can be picked', () => {
  it('never on the hour (anniversaries) nor in the 21 o\'clock hour (the 9 pm team)', () => {
    assert.equal(minuteBlock(KST('2026-12-01T20:00:00')), 'hour');
    assert.equal(minuteBlock(KST('2026-12-01T21:00:00')), 'hour');
    assert.equal(minuteBlock(KST('2026-12-01T21:30:00')), 'gold');
    assert.equal(minuteBlock(KST('2026-12-01T20:30:00')), '');
    assert.equal(minuteBlock(KST('2026-12-01T22:01:00')), '');
  });
  it('a whole minute inside the board\'s window, at least five minutes ahead', () => {
    const g = G();
    assert.equal(minuteFault(g, KST('2026-12-01T20:30:00') + 1, NOW), 'step');
    assert.equal(minuteFault(g, KST('2026-12-01T17:59:00'), NOW), 'window');
    assert.equal(minuteFault(g, KST('2026-12-01T23:59:00'), NOW), '', 'the last minute ends with the window');
    assert.equal(minuteFault(g, g.b, NOW), 'window');
    const at = KST('2026-12-01T20:30:00');
    assert.equal(minuteFault(g, at, at - TOWER.leadMs + 1), 'soon');
    assert.equal(minuteFault(g, at, at - TOWER.leadMs), '');
    assert.equal(minuteFault(g, at, at + MIN), 'soon', 'a minute gone by');
  });
  it('lists every minute of the window with why it cannot be picked: 6 hours, 6 on-the-hour minutes, 59 more in the 21 o\'clock hour', () => {
    const list = towerMinutes(G(), NOW, [KST('2026-12-01T20:30:00')]);
    assert.equal(list.length, 360);
    const why = (w) => list.filter((x) => x.why === w).length;
    assert.deepEqual([why('hour'), why('gold'), why('taken'), why('')], [6, 59, 1, 294]);
  });
  it('a window across midnight covers two KST days', () => {
    assert.deepEqual(towerDays(G({ a: KST('2026-12-01T22:00:00'), b: KST('2026-12-02T04:00:00') })), ['2026-12-01', '2026-12-02']);
    assert.deepEqual(towerDays(G()), ['2026-12-01']);
  });
});

describe('a booking: one per board, one a day per maker, 30 a day, 30 days between point bookings', () => {
  const m = KST('2026-12-01T20:30:00');
  const base = { g: G(), uid: 'guest:a', how: 'friends', m, now: NOW, guest: true, boardHas: false, taken: false, dayN: 0, mine: false, gap: false, friends: 10 };
  it('says why, cheapest first', () => {
    assert.equal(towerFault(base), '');
    assert.equal(towerFault({ ...base, uid: 'guest:b' }), 'owner');
    assert.equal(towerFault({ ...base, g: G({ st: 'hidden' }) }), 'gone');
    assert.equal(towerFault({ ...base, g: null }), 'gone');
    assert.equal(towerFault({ ...base, how: 'money' }), 'minute');
    assert.equal(towerFault({ ...base, boardHas: true }), 'board');
    assert.equal(towerFault({ ...base, m: KST('2026-12-01T21:15:00') }), 'minute');
    assert.equal(towerFault({ ...base, taken: true }), 'taken');
    assert.equal(towerFault({ ...base, dayN: TOWER.perDay }), 'sold');
    assert.equal(towerFault({ ...base, dayN: TOWER.perDay - 1 }), '', 'the 30th');
    assert.equal(towerFault({ ...base, mine: true }), 'day');
    assert.equal(towerFault({ ...base, friends: TOWER.friends - 1 }), 'friends');
    assert.equal(towerFault({ ...base, how: 'points', friends: 0 }), 'account', 'a guest has no points path');
    assert.equal(towerFault({ ...base, how: 'points', guest: false, friends: 0 }), '');
    assert.equal(towerFault({ ...base, how: 'points', guest: false, gap: true }), 'gap');
  });
  it('the numbers', () => {
    assert.deepEqual([TOWER.perDay, TOWER.friends, TOWER.price, TOWER.gapDays, TOWER.leadMs, REWARD.amount, REWARD.perDay], [30, 10, 2000, 30, 300000, 50, 5]);
    assert.equal(SPEND_OLD, '그 금액은 쓸 수 없어요.');
  });
});

describe('a friend\'s reaction counts once per network, never the maker\'s', () => {
  it('another network, a checked person; not the maker\'s network, not the maker\'s own line, not without a network', () => {
    const g = G();
    assert.equal(reactCounts(g, { net: 'b'.repeat(16), human: true }), true);
    assert.equal(reactCounts(g, { net: g.ip, human: true }), false, 'the maker\'s network');
    assert.equal(reactCounts(g, { net: 'b'.repeat(16), uid: 'guest:a', human: true }), false, 'the maker writing from elsewhere');
    assert.equal(reactCounts(g, { net: 'b'.repeat(16), uid: 'guest:c', human: true }), true);
    assert.equal(reactCounts(g, { net: 'b'.repeat(16), human: false }), false, 'a heart without the check');
    assert.equal(reactCounts(g, { net: '', human: true }), false);
    assert.equal(reactCounts(G({ ip: '' }), { net: 'b'.repeat(16), human: true }), false, 'a board with no maker network opens nothing');
  });
});

describe('the plaza in that minute', () => {
  const m = KST('2026-12-01T20:30:00'), e = towerEntry(G(), m);
  it('an entry carries only what the board shows', () => {
    assert.deepEqual(Object.keys(e).sort(), ['from', 'id', 'm', 'msg', 'occ', 'th', 'to']);
  });
  it('towerAt: the one minute, never an on-the-hour or 21 o\'clock entry even if one were listed', () => {
    assert.equal(towerAt([e], m - 1), null);
    assert.equal(towerAt([e], m), e); assert.equal(towerAt([e], m + MIN - 1), e);
    assert.equal(towerAt([e], m + MIN), null);
    const bad = { ...e, m: KST('2026-12-01T21:10:00') };
    assert.equal(towerAt([bad], bad.m + 1000), null);
    assert.equal(towerKey(e), 'abcd1234|' + m); assert.equal(towerKey(null), '');
  });
  it('towerWire cleans a push: a bad id is nothing, off keeps only id and minute, long names are cut', () => {
    assert.equal(towerWire({ id: 'x', m }), null);
    assert.deepEqual(towerWire({ id: 'abcd1234', m, off: 1, to: 'z' }), { id: 'abcd1234', m, off: 1 });
    const w = towerWire({ ...e, to: '가'.repeat(30), occ: 'nope', extra: 1 });
    assert.equal(Array.from(w.to).length, 12); assert.equal(w.occ, 'bday'); assert.equal('extra' in w, false);
  });
  it('the news line names the person and the day, never points or how it was won', () => {
    assert.equal(towerNews(e), '🎉 지금 메인 타워: 민지의 생일');
    assert.equal(towerNews({ ...e, occ: 'just' }), '🎉 지금 메인 타워: 민지의 ' + TOWER_WORD.just);
    assert.equal(/포인트|2,000|친구 응원|응원 10곳/.test(towerNews(e)), false);
    assert.equal(towerClock(m), '20:30');
  });
  it('towerLook: soon, live for the minute, done after', () => {
    assert.equal(towerLook(0, m), 'none');
    assert.deepEqual([towerLook(m, m - 1), towerLook(m, m), towerLook(m, m + MIN)], ['soon', 'live', 'done']);
  });
});

describe('the owner\'s card', () => {
  const g = { ...G(), phase: 'before' }, days = { '2026-12-01': { left: 30, mine: false } };
  const card = (o = {}) => towerCard({ g, tw: null, now: NOW, days, taken: [], friends: 3, guest: true, prep: false, gap: false, ...o });
  it('open: places left, friends k/10, the points path by who is asking', () => {
    const c = card();
    assert.equal(c.state, 'open'); assert.equal(c.left, 30); assert.equal(c.friends, 3); assert.equal(c.need, 10); assert.equal(c.canFriends, false);
    assert.equal(c.points, 'account');
    assert.equal(card({ guest: false }).points, 'ok'); assert.equal(card({ guest: false, prep: true }).points, 'prep'); assert.equal(card({ guest: false, gap: true }).points, 'gap');
    assert.equal(card({ friends: 10 }).canFriends, true);
    assert.equal(c.minutes.filter((x) => !x.why).length, 295, '360 minutes less 6 on the hour and 59 in the 21 o\'clock hour');
  });
  it('sold out, already one today, booked, live, done, closed', () => {
    assert.equal(card({ days: { '2026-12-01': { left: 0, mine: false } } }).state, 'sold');
    assert.equal(card({ days: { '2026-12-01': { left: 5, mine: true } } }).state, 'mine');
    const m = KST('2026-12-01T20:30:00');
    assert.deepEqual([card({ tw: { m, how: 'friends' } }).state, card({ tw: { m, how: 'friends' }, now: m }).state, card({ tw: { m, how: 'friends' }, now: m + MIN }).state], ['booked', 'live', 'done']);
    assert.equal(card({ g: { ...g, phase: 'after' } }).state, 'closed');
    assert.equal(card({ now: KST('2026-12-01T23:56:00') }).state, 'closed', 'no minute left ahead');
  });
});

describe('giftrules: 💖 is taken before the day, shown only after the reveal; the public view carries the booked minute', () => {
  it('heartTakes from the making on; heartsOpen only from the reveal', () => {
    const g = G({ day: '2026-12-02', a: KST('2026-12-02T09:00:00'), b: KST('2026-12-02T15:00:00'), at: KST('2026-12-01T10:00:00') });
    assert.equal(heartTakes(g, NOW), true); assert.equal(heartsOpen(g, NOW), false);
    assert.equal(heartTakes({ ...g, st: 'hidden' }, NOW), false); assert.equal(heartTakes(null, NOW), false);
  });
  it('tw is the minute only, never how it was won', () => {
    const v = giftView({ ...G(), tw: { m: KST('2026-12-01T20:30:00'), how: 'points' } }, NOW);
    assert.equal(v.tw, KST('2026-12-01T20:30:00')); assert.equal(JSON.stringify(v).includes('points'), false);
    assert.equal('tw' in giftView(G(), NOW), false);
  });
});

describe('towerrules.js stays pure', () => {
  it('has no clock, no I/O and imports only giftrules.js, with no query', () => {
    const s = fs.readFileSync(new URL('../towerrules.js', import.meta.url), 'utf8');
    assert.equal(/Date\.now|fetch\(|localStorage|document\.|crypto\./.test(s), false);
    assert.deepEqual([...s.matchAll(/from '([^']+)'/g)].map((x) => x[1]), ['./giftrules.js']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/tower.test.mjs`
Expected: FAIL (`Cannot find module '../towerrules.js'`).

- [ ] **Step 3: `giftrules.js` 고치기** — `heartsOpen` 바로 아래에 더하고, `giftView`의 반환 마지막 줄(`...(heartsOpen(g, now) ? …)`) 다음에 `tw`를 더한다.

```js
// 💖 is taken from the making on (the friends' threshold of the main tower minute counts before the day: towerrules.js); the count is
// still shown only once heartsOpen.
export function heartTakes(g, now = Date.now()) { return !!g && giftPhase(g, now) !== 'gone'; }
```

```js
    // tw: the booked main tower minute (towerrules.js), never how it was won (the owner's read carries mine.tw for that).
    ...(g.tw && Number(g.tw.m) > 0 ? { tw: Number(g.tw.m) } : {}),
```

- [ ] **Step 4: `towerrules.js` 쓰기**

```js
// 메인 타워 축하 1분 (docs/superpowers/specs/2026-11-27-main-tower-minute-design.md): the pure rules shared by the Worker (giftsrv.js), the
// gift pages (giftpage.js), the plaza (ts3d/screens.js, main.js, gift.js, ui.js) and the tests. No I/O, no clock of its own: every function
// takes the time it judges. The Worker bundles this module, so it is imported with no query everywhere (tools/stamp.mjs).
//
// A gift board's owner may put it on all five main tower faces (MAIN_*) for one wall-clock minute inside its own window, 30 minutes a KST
// day, first come first served: (A) once 10 different networks reacted on its page (a 💖 with the human check, or a 롤링페이퍼 line), the
// maker's own network never counting, or (B) for 2,000 응원 포인트 (accounts only, once in 30 days). Never on the hour (the anniversary
// teams' minute), never in the 21 o'clock hour (the 9 pm team), never within 5 minutes. Nothing about how a minute was won is ever shown.
import { OCCASIONS, kstDay, giftPhase } from './giftrules.js';

export const TOWER = Object.freeze({
  perDay: 30,             // minutes a KST day (the day of the minute)
  leadMs: 5 * 60e3,       // a minute must start at least this far ahead (the plaza's copies catch up meanwhile)
  minMs: 60e3,
  friends: 10,            // path A: different networks that reacted on the board's page
  price: 2000,            // path B: 응원 포인트, accounts only
  gapDays: 30,            // path B: once in 30 days per account (from the booking)
  goldHour: 21,
  slots: Object.freeze(['MAIN_UP', 'MAIN_TOP', 'MAIN_MID', 'MAIN_BOT', 'MAIN_LOW']),
  face: 'MAIN_MID',       // where ?gb=<id> takes the camera in that minute
  worldAhead: 26 * 36e5,  // /rt/world carries bookings starting in the next 26 hours
  worldMax: 60,
  payMax: 10,             // share rewards one beacon batch may hand to the Worker (subrequests)
});
// The share reward: a friend's first reaction from another network on the maker's board page pays the maker, at most perDay a KST day.
export const REWARD = Object.freeze({ amount: 50, perDay: 5 });
export const TOWER_HOW = Object.freeze(['friends', 'points']);
// spend_plaza's answer to an amount it does not take (schema.sql). Before migrations/2026-11-27-tower-minute.sql 2,000 is one of them.
export const SPEND_OLD = '그 금액은 쓸 수 없어요.';
export const TOWER_ERR = Object.freeze({
  minute: '고를 수 없는 시간이에요. 다른 1분을 골라 주세요.',
  taken: '방금 다른 사람이 그 1분을 골랐어요. 다른 1분을 골라 주세요.',
  sold: '그날 메인 타워는 매진이에요.',
  board: '이 선물 전광판은 이미 메인 타워 시간을 골랐어요.',
  day: '메인 타워는 하루에 한 번 고를 수 있어요.',
  gap: '포인트로 올리기는 30일에 한 번이에요.',
  friends: '친구 응원 10곳이 모이면 고를 수 있어요.',
  account: '계정을 연결하면 포인트로 올릴 수 있어요.',
  poor: '포인트가 부족해요. 광장에서 방금 받은 포인트는 1분쯤 뒤에 반영돼요.',
  prep: '포인트로 올리기는 준비 중이에요.',
});
export const TOWER_WORD = Object.freeze({ bday: '생일', anniv: '기념일', pass: '합격', cheer: '응원', just: '특별한 날', thanks: '고마운 날' });

const H = 36e5;
const kstHM = (m) => { const d = new Date(Number(m) + 9 * H); return { h: d.getUTCHours(), mi: d.getUTCMinutes() }; };
const two = (n) => String(n).padStart(2, '0');
const cut = (s, n) => Array.from(String(s ?? '').replace(/\s+/g, ' ').trim()).slice(0, n).join('');
export const minuteStart = (t) => Math.floor(Number(t) / TOWER.minMs) * TOWER.minMs;
/** 'hour' (on the hour: the anniversary teams), 'gold' (the 21 o'clock hour: the 9 pm team) or ''. */
export function minuteBlock(m) { const { h, mi } = kstHM(m); return mi === 0 ? 'hour' : h === TOWER.goldHour ? 'gold' : ''; }
/** '' when minute m of board g (its window [a, b)) may be picked at now, else 'step' | 'window' | 'soon' | 'hour' | 'gold'. */
export function minuteFault(g, m, now) {
  const t = Number(m);
  if (!Number.isFinite(t) || t % TOWER.minMs !== 0) return 'step';
  if (!g || t < Number(g.a) || t + TOWER.minMs > Number(g.b)) return 'window';
  if (t < Number(now) + TOWER.leadMs) return 'soon';
  return minuteBlock(t);
}
/** Every minute of g's window: [{ m, why }] (why '' when it may be picked; 'taken' when another board has it). */
export function towerMinutes(g, now, taken = []) {
  const busy = new Set((Array.isArray(taken) ? taken : []).map(Number)), out = [];
  if (!g || !(Number(g.b) > Number(g.a))) return out;
  for (let m = Math.ceil(Number(g.a) / TOWER.minMs) * TOWER.minMs; m + TOWER.minMs <= Number(g.b); m += TOWER.minMs) out.push({ m, why: minuteFault(g, m, now) || (busy.has(m) ? 'taken' : '') });
  return out;
}
/** The KST days g's window touches (a "지금" board can cross midnight). */
export function towerDays(g) { const a = kstDay(Number(g.a)), b = kstDay(Number(g.b) - 1); return a === b ? [a] : [a, b]; }
/**
 * Why a booking is refused, or ''. o: { g (the stored board), uid (the asker), how, m, now, guest (a guest or an anonymous login),
 * boardHas (this board already has one), taken (minute m has a board), dayN (bookings on m's KST day), mine (this maker has one that day),
 * gap (a points booking of this account in the last TOWER.gapDays), friends (reacting networks) }.
 */
export function towerFault(o = {}) {
  const g = o.g;
  if (!g || giftPhase(g, o.now) === 'gone') return 'gone';
  if (String(g.uid) !== String(o.uid || '')) return 'owner';
  if (!TOWER_HOW.includes(o.how)) return 'minute';
  if (o.boardHas) return 'board';
  if (minuteFault(g, o.m, o.now)) return 'minute';
  if (o.taken) return 'taken';
  if ((Number(o.dayN) || 0) >= TOWER.perDay) return 'sold';
  if (o.mine) return 'day';
  if (o.how === 'friends' && (Number(o.friends) || 0) < TOWER.friends) return 'friends';
  if (o.how === 'points' && o.guest) return 'account';
  if (o.how === 'points' && o.gap) return 'gap';
  return '';
}
/** A reaction on g's page counts for its friends and the share reward: another network than the maker's (g.ip), not the maker's own
 *  account (a line it wrote), and a person (human: the 💖 check passed, or Turnstile is off). */
export function reactCounts(g, { net = '', uid = '', human = true } = {}) {
  return !!g && !!g.ip && !!human && !!net && String(net) !== String(g.ip) && (!uid || String(uid) !== String(g.uid));
}
/** What the plaza gets of a booking: the board's own words (no owner, no network, no how). */
export const towerEntry = (g, m) => ({ id: String(g.id), m: Number(m), to: cut(g.to, 12), from: cut(g.from, 12), occ: OCCASIONS[g.occ] ? String(g.occ) : 'bday', msg: cut(g.msg, 40), th: cut(g.th, 12) });
/** A TOWER push or a /rt/world row, cleaned (rooms and browsers both use it): an entry, { id, m, off: 1 }, or null. */
export function towerWire(d) {
  if (!d || typeof d !== 'object' || !/^[0-9a-z]{8}$/.test(String(d.id || '')) || !(Number(d.m) > 0)) return null;
  if (d.off) return { id: String(d.id), m: Number(d.m), off: 1 };
  return towerEntry(d, d.m);
}
/** The entry on the tower at t, or null (an on-the-hour or 21 o'clock entry never shows: those minutes belong to the teams). */
export function towerAt(list, t) {
  for (const e of Array.isArray(list) ? list : []) { const m = Number(e?.m); if (m <= t && t < m + TOWER.minMs && !minuteBlock(m)) return e; }
  return null;
}
export const towerKey = (e) => (e ? String(e.id) + '|' + Number(e.m) : '');
export function towerNews(e) { return `🎉 지금 메인 타워: ${cut(e?.to, 12) || '누군가'}의 ${TOWER_WORD[e?.occ] || TOWER_WORD.bday}`; }
export function towerClock(m) { const { h, mi } = kstHM(m); return two(h) + ':' + two(mi); }
/** 'none' | 'soon' (before the minute) | 'live' (in it) | 'done' (after it). */
export function towerLook(m, now) { const t = Number(m); if (!(t > 0)) return 'none'; return now < t ? 'soon' : now < t + TOWER.minMs ? 'live' : 'done'; }
/**
 * The owner's card. s: { g (the owner's view: phase, a, b), tw ({ m, how } | null), now, days ({ day: { left, mine } }), taken, friends, guest,
 * prep, gap }. -> { state, … }: 'booked' | 'live' | 'done' (tw set: m), 'closed' (the window is over or no minute is left ahead), 'sold'
 * (every day of the window is full), 'mine' (this maker already has one on every day still open), 'open' ({ left, friends, need, canFriends,
 * points: 'ok' | 'account' | 'prep' | 'gap', minutes }).
 */
export function towerCard(s = {}) {
  const { g, tw, now } = s;
  if (tw && Number(tw.m) > 0) { const look = towerLook(tw.m, now); return { state: look === 'soon' ? 'booked' : look, m: Number(tw.m) }; }
  if (!g || g.phase === 'after' || g.phase === 'gone') return { state: 'closed' };
  const days = s.days || {}, day = (m) => days[kstDay(m)] || { left: TOWER.perDay, mine: false };
  const ahead = towerMinutes(g, now, s.taken).filter((x) => x.why === '' || x.why === 'taken');
  if (!ahead.some((x) => x.why === '')) return { state: 'closed' };
  const open = ahead.filter((x) => x.why === '' && day(x.m).left > 0);
  if (!open.length) return { state: 'sold' };
  const free = open.filter((x) => !day(x.m).mine);
  if (!free.length) return { state: 'mine' };
  const minutes = towerMinutes(g, now, s.taken).map((x) => ({ m: x.m, why: x.why || (day(x.m).left <= 0 ? 'sold' : day(x.m).mine ? 'day' : '') }));
  const friends = Math.max(0, Math.floor(Number(s.friends) || 0));
  return { state: 'open', left: Math.min(...towerDays(g).map((d) => (days[d] ? days[d].left : TOWER.perDay))), friends, need: TOWER.friends, canFriends: friends >= TOWER.friends,
    points: s.guest ? 'account' : s.prep ? 'prep' : s.gap ? 'gap' : 'ok', minutes };
}
```

- [ ] **Step 5: 통과 확인**

Run: `node --test test/tower.test.mjs test/gift.test.mjs`
Expected: PASS (gift.test는 `giftView`에 `tw`가 없는 보드는 그대로라 바뀌지 않는다).

- [ ] **Step 6: `node tools/stamp.mjs --check`** — Expected: 0으로 끝난다(`towerrules.js`는 아직 아무도 import하지 않는다).

- [ ] **Step 7: 커밋**

```bash
git add towerrules.js giftrules.js test/tower.test.mjs
git commit -m "Add towerrules.js: the main tower minute's pure rules, and take 💖 before the day (heartTakes)"
```

**Acceptance:** `test/tower.test.mjs` 전부 통과, `test/gift.test.mjs` 변화 없음, `towerrules.js`에 시계·I/O 없음.

---

### Task 2: 서버 — 반응한 연결, 공유 보상 +50, 그날 전 하트, `theart`

**Files:**
- Modify: `giftsrv.js` (`giftDb.tables`, `dropBoards`, `heartAdd`, `seen`, `paper`, 새 `react`/`payUndo`, `seenFlush`, 새 `payOut`, `heart`, `paper` 경로, `giftPage` 데이터, `KIT`)
- Modify: `worker.js` (`giftKit`, Meter `giftPayUndo`, `PUSH_GAP`, `pushText`, `pushUrl`)
- Modify: `human.js` (`HUMAN_ACTIONS`)
- Modify: `test/gift-worker.test.mjs` (하트 공개 전 테스트 하나), `test/reward-client.test.mjs` (배열 줄)
- Create: `test/tower-worker.test.mjs`

- [ ] **Step 1: 실패하는 테스트 쓰기** — `test/tower-worker.test.mjs`

머리에 `test/gift-worker.test.mjs` 1~104줄의 도우미(`registerHooks`, `sqliteStorage`, `makeCtx`, `stub`, `makeEnv`, `json`, `PUSH_HOST`, `harness`, `setup`, `userToken`, `today`, `FORM`, `db`, `VIS`, `spyGift`, `subscriber`, `decrypt`, `VAPID`)를 그대로 옮긴다(이 저장소의 워커 테스트 29개가 모두 그렇게 한다). `fakeNet`만 아래로 바꾼다: RPC 호출을 적고, `spend_plaza`·`grant_coins`·siteverify를 상태로 답한다.

```js
// 메인 타워 축하 1분 on the Worker (giftsrv.js through worker.js): friends' reactions per network, the share reward (+50, 5 a day), 💖 before
// the day, the human check on 💖 (theart); then (Task 3) bookings, the points path before and after the migration, refunds, /rt/world and
// the rooms' TOWER push.
const SITE = '0x4AAAAAAAtowerSITEkey', SECRET = 'tower-secret';
function fakeNet(state) {
  state.rpc = []; state.verify = state.verify || ((b) => ({ success: b.response === 'good', action: state.action || 'theart' }));
  return async (url, opt = {}) => {
    const u = String(url); state.calls.push(u);
    if (u.startsWith(PUSH_HOST)) { state.pushes.push({ url: u, body: opt.body }); return new Response('', { status: 201 }); }
    if (u.startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) return json(state.verify(JSON.parse(opt.body || '{}')));
    if (u.includes('/.well-known/jwks.json')) return json({ keys: state.jwks || [] });
    if (u.includes('/rest/v1/rpc/')) {
      const name = u.split('/rpc/')[1], body = JSON.parse(opt.body || '{}'); state.rpc.push({ name, ...body });
      if (name === 'spend_plaza') return json(state.spend ? state.spend(body) : { ok: false, error: '그 금액은 쓸 수 없어요.' });
      if (name === 'grant_coins') return json(state.grant ? state.grant(body) : { ok: true, coins: 1000 });
      if (name === 'merge_guest_account') return json({ ok: true, coins: 1, bonus: 0 });
      return json({ ok: true });
    }
    if (u.includes('/rest/v1/')) return json([]);
    return new Response('missing', { status: 404 });
  };
}
const grants = (state, uid) => state.rpc.filter((r) => r.name === 'grant_coins' && (!uid || r.p_actor_id === uid));
const NET = (i) => '10.0.' + Math.floor(i / 250) + '.' + (1 + (i % 250)); // a different IPv4 network per i
const heart = (H, id, i, ip, ts) => H.post('/rt/gift/' + id + '/heart', { v: VIS(i), ...(ts ? { ts } : {}) }, null, ip);
const drain = async (env, H) => { const { giftSeenFlush } = await import('../giftsrv.js'); await giftSeenFlush(env, H.ctx); };

describe('friends on a gift board page', { concurrency: false }, () => {
  it('a 💖 before the day is kept (the count still hidden) and counts one network once; the maker\'s network never', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1');
      const r = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 2), at: 9 }), A.token, '1.1.1.1')).json();
      await heart(H, r.id, 1, '1.1.1.1'); await heart(H, r.id, 2, '2.2.2.2'); await heart(H, r.id, 3, '2.2.2.2'); await drain(env, H);
      assert.equal(db(env).prepare('select hr from gb where id = ?').get(r.id).hr, 3, 'every device\'s heart is kept before the day');
      assert.equal('hearts' in (await (await H.get('/rt/gift/' + r.id)).json()).gift, false, 'not shown before the reveal');
      assert.deepEqual(db(env).prepare('select count(*) n from gn where g = ?').get(r.id).n, 1, 'one network (2.2.2.2); the maker\'s network is not a friend');
    } finally { done(); }
  });
  it('Turnstile on: only a checked 💖 counts as a friend (an unchecked one is still a heart); a 2 KB token fits', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1');
      const r = await (await H.post('/rt/gift', FORM(), A.token, '1.1.1.1')).json();
      // switched on after the guest and the board were made (humanSite reads env on every request; the tallied env inherits it)
      env.TURNSTILE_SITE = SITE; env.TURNSTILE_SECRET = SECRET;
      assert.ok((await (await H.get('/g/' + r.id)).text()).includes('"site":"' + SITE + '"'), 'the page data carries the public site key');
      assert.equal((await heart(H, r.id, 1, '3.3.3.3')).status, 200, 'no token: still a heart');
      state.verify = (b) => ({ success: b.response.startsWith('good'), action: 'theart' });
      assert.equal((await heart(H, r.id, 2, '4.4.4.4', 'good'.padEnd(2048, 'x'))).status, 200, 'the body takes a whole token');
      assert.equal((await heart(H, r.id, 3, '5.5.5.5', 'good')).status, 200);
      assert.equal((await heart(H, r.id, 4, '6.6.6.6', 'bad')).status, 200, 'a refused token: still a heart');
      await drain(env, H);
      assert.equal(db(env).prepare('select hr from gb where id = ?').get(r.id).hr, 4);
      assert.deepEqual(db(env).prepare('select net from gn where g = ?').all(r.id).length, 2, 'the two checked ones (4.4.4.4, 5.5.5.5)');
    } finally { done(); }
  });
  it('a 롤링페이퍼 line from another network counts; the maker\'s own line from another network does not', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), B = await H.guest('6.6.6.6');
      const r = await (await H.post('/rt/gift', FORM(), A.token, '1.1.1.1')).json();
      assert.equal((await H.post('/rt/gift/' + r.id + '/paper', { nick: '친구', txt: '축하해!' }, B.token, '6.6.6.6')).status, 200);
      assert.equal((await H.post('/rt/gift/' + r.id + '/paper', { nick: '나', txt: '내가 씀' }, A.token, '7.7.7.7')).status, 200);
      assert.equal(db(env).prepare('select count(*) n from gn where g = ?').get(r.id).n, 1);
    } finally { done(); }
  });
});

describe('the share reward', { concurrency: false }, () => {
  it('+50 to the maker (a guest id too) for each of the first 5 friends a KST day; the 6th pays nothing; the next day pays again', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1');
      const r = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 12 }), A.token, '1.1.1.1')).json();
      for (let i = 0; i < 6; i++) await heart(H, r.id, i + 1, NET(i));
      await drain(env, H);
      assert.deepEqual(grants(state, A.id).map((g) => g.p_amount), [50, 50, 50, 50, 50]);
      assert.equal(db(env).prepare('select sum(paid) n from gn where g = ?').get(r.id).n, 5);
      clock.add(864e5);
      await heart(H, r.id, 99, NET(50)); await drain(env, H);
      assert.equal(grants(state, A.id).length, 6, 'a new day');
    } finally { done(); }
  });
  it('a grant that fails (no wallet yet) is undone: that friend pays nothing, the day keeps its room', async () => {
    const { state, done } = setup();
    try {
      state.grant = () => ({ ok: false, error: '그 지갑을 찾지 못했습니다.' });
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1');
      const r = await (await H.post('/rt/gift', FORM(), A.token, '1.1.1.1')).json();
      await heart(H, r.id, 1, NET(1)); await drain(env, H);
      assert.equal(db(env).prepare('select paid from gn where g = ?').get(r.id).paid, 0);
      assert.equal(db(env).prepare("select n from gr where k = ?").get('tp:' + A.id)?.n || 0, 0);
      delete state.grant; await heart(H, r.id, 2, NET(2)); await drain(env, H);
      assert.equal(grants(state, A.id).length, 2, 'the next friend is paid');
    } finally { done(); }
  });
  it('the 10th friend sends the maker one push (not advertising), once per board', async () => {
    const { state, done } = setup();
    try {
      const env = makeEnv({ VAPID_PRIV: VAPID }), H = harness(env), A = await H.guest('1.1.1.1'), s = await subscriber();
      assert.equal((await H.post('/rt/push', { s: s.sub() }, A.token, '1.1.1.1')).status, 200, 'the maker has web push on'); // as gift-worker.test.mjs's reply notice test
      const r = await (await H.post('/rt/gift', FORM(), A.token, '1.1.1.1')).json();
      for (let i = 0; i < 11; i++) await heart(H, r.id, i + 1, NET(i));
      await drain(env, H);
      const got = await Promise.all(state.pushes.map((p) => decrypt(p.body, s)));
      assert.deepEqual(got.map((x) => [x.body, x.url]), [['친구 응원 10곳이 모였어요. 메인 타워 1분을 고르세요', '/g/' + r.id + '?o=1']]);
    } finally { done(); }
  });
  it('at budget hard a 💖 is 503 and nobody is paid', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1');
      const r = await (await H.post('/rt/gift', FORM(), A.token, '1.1.1.1')).json();
      env.BUDGET_REQ_DAY = '1'; clock.add(61000);
      assert.equal((await heart(H, r.id, 1, NET(1))).status, 503);
      delete env.BUDGET_REQ_DAY; clock.add(61000); await drain(env, H);
      assert.equal(grants(state).length, 0);
    } finally { done(); }
  });
});
```

(구독은 `POST /rt/push { s }`, 받은 글은 `decrypt(p.body, s)`가 `{ body, url }`로 푼다. `test/gift-worker.test.mjs`의 "keeps the first reply on the answered board"와 같다.)

`test/gift-worker.test.mjs`의 "💖 is hidden and refused before the board is revealed" 테스트를 이렇게 바꾼다(이름도):

```js
  it('💖 is hidden before the board is revealed but kept (the friends of the main tower minute count before the day)', async () => {
    const { clock, done } = setup();
    try {
      await drain();
      const env = makeEnv(), H = harness(env), A = await H.guest();
      const r = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 9 }), A.token)).json();
      assert.equal('hearts' in r.gift, false);
      await heart(H, r.id, 1); await giftSeenFlush(env, H.ctx);
      assert.equal(db(env).prepare('select hr from gb where id = ?').get(r.id).hr, 1, 'kept before the reveal');
      assert.equal('hearts' in (await (await H.get('/rt/gift/' + r.id)).json()).gift, false, 'no count in the public read');
      clock.add(21 * 36e5 + 60000);
      await heart(H, r.id, 1); await giftSeenFlush(env, H.ctx);
      assert.equal(db(env).prepare('select hr from gb where id = ?').get(r.id).hr, 1, 'the same device is still one');
      assert.equal((await (await H.get('/rt/gift/' + r.id)).json()).gift.hearts, 1);
    } finally { done(); }
  });
```

`test/reward-client.test.mjs` 87줄의 배열을 `['guest', 'link', 'bonus', 'code', 'gift', 'gmsg', 'gvid', 'theart', 'tower']`로.

- [ ] **Step 2: 실패 확인**

Run: `node --test test/tower-worker.test.mjs test/gift-worker.test.mjs test/reward-client.test.mjs`
Expected: FAIL (`no such table: gn`, 하트가 그날 전에 버려짐, 배열이 다름).

- [ ] **Step 3: `human.js`**

```js
export const HUMAN_ACTIONS = Object.freeze(['guest', 'link', 'bonus', 'code', 'gift', 'gmsg', 'gvid', 'theart', 'tower']); // worker.js: HUMAN_ACTION, and humanGate's for the rewards; giftsrv.js: a new gift board, a 롤링페이퍼 line, a video upload, a checked 💖 (the main tower friends), a main tower minute for points
```

- [ ] **Step 4: `giftsrv.js` — 저장소 쪽**

머리 주석의 표 목록에 더한다:

```js
//   gn(g, net, at, paid)                       networks that reacted on a board's page (a checked 💖 or a 롤링페이퍼 line), once each; never the
//                                              maker's network or the maker's own line (towerrules.js reactCounts). paid: the share reward went
//   gt(m, day, g, how, uid, at)                main tower minutes (Task 3)
//   ga(uid, day, how, at, g)                   a maker's bookings by KST day, kept TOWER.gapDays + 1 days after (Task 3)
```

import 줄: `giftrules.js`에서 `heartTakes`를 더하고, 새 줄 `import { TOWER, REWARD, reactCounts } from './towerrules.js';`(작업 3에서 이름이 더 붙는다).

`giftDb.tables`의 마지막(`gc` 다음)에:

```js
    q.exec('create table if not exists gn(g text not null, net text not null, at integer not null, paid integer not null default 0, primary key(g, net))');
```

`dropBoards`의 첫 줄 표 목록에 `'gn'`을 더하고, 두 번째 루프에 한 줄:

```js
  for (const id of ids) for (const t of ['gm', 'gv', 'grp', 'gc', 'gn']) q.exec(`delete from ${t} where g = ?`, id);
  // … (in the second loop, next to 'rn:')
    q.exec('delete from gr where k = ?', 'to:' + id); // the friends' push went for this board
```

`heartAdd`를 고친다(받기는 `heartTakes`, 세었으면 true):

```js
function heartAdd(q, g, v, net, d, now) {
  if (!g || !heartTakes(g, now)) return false;
  // … the rest as it is
}
```

`heartAdd` 아래에 새 함수:

```js
// A friend reacted on g's page from network net (a 💖 counted just now, or a 롤링페이퍼 line). Once per board and network for good (gn);
// the maker's network and the maker's own lines never (reactCounts). The first REWARD.perDay of a KST day pay the maker (gr 'tp:<uid>',
// pruned with the other day limits); pay: false keeps a reaction unpaid (the batch already handed TOWER.payMax to the Worker). The
// TOWER.friends-th network sends the maker one push (gr 'to:<board>', kept until the board goes). -> { pay?, open? } or null.
function react(q, g, net, uid, human, now, pay = true) {
  if (!reactCounts(g, { net, uid, human })) return null;
  if (q.exec('insert or ignore into gn(g, net, at) values(?, ?, ?)', g.id, net, now).rowsWritten < 1) return null;
  const d = kstDay(now), out = {};
  bump(q, d, 'react');
  if (pay && lim(q, 'tp:' + g.uid, d) < REWARD.perDay) {
    q.exec('update gn set paid = 1 where g = ? and net = ?', g.id, net); limAdd(q, 'tp:' + g.uid, d); bump(q, d, 'tpay');
    out.pay = { uid: g.uid, g: g.id, net, d };
  }
  const n = Number(q.exec('select count(*) n from gn where g = ?', g.id).one().n) || 0;
  if (n >= TOWER.friends && lim(q, 'to:' + g.id, '*') === 0) { limAdd(q, 'to:' + g.id, '*'); out.open = { uid: g.uid, g: g.id }; }
  return out;
}
```

`giftDb.paper`: 줄을 넣은 뒤(`limAdd(q, nk, d); bump(q, d, 'msg');` 다음) 반응을 센다. `o.human`은 경로가 넘긴다.

```js
    const rx = react(q, g, o.ip, o.uid, o.human !== false, now);
    return { ok: true, n: g.n + 1, id: mid, ...(rx?.pay ? { pay: [rx.pay] } : {}), ...(rx?.open ? { open: [rx.open] } : {}) };
```

`giftDb.seen`: 하트 줄을 바꾸고, 보상·알림을 모아 돌려준다.

```js
  seen(q, items, now = Date.now()) {
    const d = kstDay(now), pay = [], open = []; let n = 0;
    // … unchanged until the heart line:
      if (e === 'heart') {
        const g = rowOf(row);
        if (heartAdd(q, g, v, String(it?.n || ''), d, now)) {
          const rx = react(q, g, String(it?.n || ''), '', Number(it?.t) === 1, now, pay.length < TOWER.payMax);
          if (rx?.pay) pay.push(rx.pay); if (rx?.open) open.push(rx.open);
        }
        continue;
      }
    // …
    return { ok: true, n, ...(pay.length ? { pay } : {}), ...(open.length ? { open } : {}) };
  },
```

`giftDb`에 새 메서드(보상 실패를 되돌림):

```js
  // A share reward the Worker could not pay (grant_coins refused: no wallet yet, or no answer): that network stays a friend, unpaid, and the
  // maker's day gets its place back. -> { ok }.
  payUndo(q, g, net, uid, d) {
    if (q.exec('update gn set paid = 0 where g = ? and net = ? and paid = 1', String(g), String(net)).rowsWritten < 1) return { ok: false };
    q.exec('update gr set n = max(0, n - 1) where k = ? and d = ?', 'tp:' + String(uid), String(d)); bump(q, kstDay(Date.now()), 'tpay_fail');
    return { ok: true };
  },
```

- [ ] **Step 5: `giftsrv.js` — 경로 쪽**

모듈 위쪽(`ONE` 근처)에 Worker 도구를 기억하는 칸과 지급 함수:

```js
// The kit of the request that came last (worker.js giftKit): the beacon batch runs after its request answered, and pays out with it.
let KIT = null;
// Share rewards and the friends' push from one DO answer ({ pay, open }), after the answer (waitUntil). A grant that fails is undone in the
// DO (one more call, only then); a reward is never paid twice.
function payOut(env, ctx, k, r) {
  for (const o of Array.isArray(r?.open) ? r.open : []) if (k?.pushNow) k.pushNow(env, ctx, o.uid, { kind: 'gifttower', gid: o.g });
  const pays = Array.isArray(r?.pay) ? r.pay.slice(0, TOWER.payMax) : [];
  if (!pays.length) return null;
  const job = Promise.all(pays.map(async (p) => {
    const res = k?.rpc ? await k.rpc('grant_coins', { p_key: env.FLUSH_KEY || '', p_actor_id: p.uid, p_amount: REWARD.amount }).catch(() => null) : null;
    if (res?.ok && res.data?.ok === true) return;
    try { await giftM(env).giftPayUndo(p.g, p.net, p.uid, p.d); } catch { /* unpaid and not undone: the day loses one place, never pays twice */ }
  })).catch(() => { });
  try { ctx?.waitUntil?.(job); } catch { /* tests */ }
  return job;
}
```

`giftApi` 첫 줄과 `giftPage` 첫 줄(메서드 검사 뒤)에 `KIT = k;`.

`seenFlush`의 `SEEN.p` 줄을 성공·실패 두 갈래로 바꾼다(지급 실패가 항목을 다시 넣으면 안 된다):

```js
  SEEN.p = Promise.resolve().then(() => giftM(env).giftSeen(items, now))
    .then((r) => { payOut(env, ctx, KIT, r); }, () => { const back = items.filter((it) => !it.re).map((it) => ({ ...it, re: 1 })); if (back.length) { SEEN.list = [...back, ...SEEN.list].slice(0, SEEN_CAP); SEEN.at = SEEN.at || now; } })
    .finally(() => { SEEN.p = null; });
```

`heart` 경로: 본문 2,600바이트, hard 뒤에 사람 확인 표시:

```js
async function heart(req, env, ctx, id, k) {
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  if (!(await opsRate(env, req, 'gheart', 20))) return no('rate', 429);
  const got = await readSmall(req, 2600); const b = got.b || {}; // { v, ts? }: a Turnstile token is up to 2,048 characters
  if (!VISITOR_ID.test(String(b.v || ''))) return no('down', 400);
  if (await hard(k, env)) return no('busy', 503);
  // t: 1 when this heart may count as a friend of the board (towerrules.js reactCounts): Turnstile off, or its 'theart' check passed. A heart
  // without it is still a heart. No token at all: humanGate answers at once, siteverify is not asked.
  const t = k.humanGate && (await k.humanGate(env, req, b, 'theart')) ? 0 : 1;
  seenAdd({ g: id, v: await visitorHash(env, b.v), e: 'heart', n: await k.ipHash(env, req), t });
  seenFlush(env, ctx);
  return J({ ok: true });
}
```

`paper` 경로: DO 호출에 `human: true`(이 경로는 `gmsg` 확인을 이미 지났거나 Turnstile이 꺼짐)를 넣고, 답을 지급에 넘긴다:

```js
  let r = null; try { r = await giftM(env).giftPaper(id, { uid: String(actor.id), ip: await k.ipHash(env, req), nick: f.v.nick, txt: f.v.txt, human: true }, Date.now()); } catch { r = null; }
  if (!r) return no('down', 503);
  if (!r.ok) return no(r.code, r.code === 'gone' ? 404 : 409);
  ONE.delete(id); payOut(env, ctx, k, r);
  return J({ ok: true, n: r.n, id: r.id });
```

`paper(req, env, id, k)`는 `ctx`가 필요하므로 서명을 `paper(req, env, ctx, id, k)`로, `giftApi`의 호출도 `paper(req, env, ctx, id, k)`로.

`giftPage`의 `data`에 `site`를 더한다:

```js
  const data = { id, gift: view, now, media: mediaOn(env), down: !!down, occ: live ? OCCASIONS[view.occ]?.name || '' : '', site: k.humanSite ? k.humanSite(env) : '', ...(h ? { hard: true } : {}) };
```

- [ ] **Step 6: `worker.js`**

`giftKit`:

```js
const giftKit = () => ({ adminOk, lvlNow, resolveActor, tokenOf, ipHash: wishIp, humanGate, humanSite, actOk, pushNow, rpc: supabaseRpc, towerTell });
```

(`towerTell`은 작업 3에서 만든다. 작업 2에서는 `towerTell: null`로 두고 작업 3에서 바꾼다.)

Meter 클래스(`giftAdmin` 아래):

```js
  giftPayUndo(g, net, uid, d) { return giftDb.payUndo(this.giftI(), g, net, uid, d); }
```

`pushText`(`giftreply` 다음), `pushUrl`, `PUSH_GAP`:

```js
  if (row?.kind === 'gifttower') return '친구 응원 10곳이 모였어요. 메인 타워 1분을 고르세요'; // 메인 타워 축하 1분: informational, to the board's owner, once per board (giftsrv.js react)
```

```js
  if (row?.kind === 'gifttower') return GIFT_ID.test(String(row.gid || '')) ? '/g/' + row.gid + '?o=1' : '/gift';
```

```js
const PUSH_GAP = { taken: 60000, wish: 600000, dark: 1, invite: 60000, giftopen: 864e5, giftreply: 60000, gifttower: 60000 }, …
```

- [ ] **Step 7: 통과 확인**

Run: `node --test test/tower-worker.test.mjs test/gift-worker.test.mjs test/reward-client.test.mjs test/bot-guard.test.mjs`
Expected: PASS.

- [ ] **Step 8: 커밋**

```bash
git add giftsrv.js worker.js human.js test/tower-worker.test.mjs test/gift-worker.test.mjs test/reward-client.test.mjs
git commit -m "Count friends per network on a gift board page, pay the maker +50 for the first 5 a day, take 💖 before the day, check 💖 with theart"
```

**Acceptance:** 그날 전 하트가 쌓이고(숫자는 공개 뒤), 만든 사람 연결·만든 사람의 줄·확인 없는 하트(Turnstile 켜짐)는 친구가 아니고, 보상은 하루 5명·실패하면 되돌림, 10곳에서 푸시 한 번, hard에서 아무것도 없음.

---

### Task 3: 서버 — 예약, 포인트 길, 환불, `/rt/world`, 방 푸시, 마이그레이션

**Files:**
- Modify: `giftsrv.js` (`giftDb`: `tables`, `prune`, `dropBoards`, `get`, `report`, `admin('hide')`, `del`, `move`, `forget`, 새 `towerState`/`towerGet`/`towerBook`/`towerFree`/`towerLive`/`worldRead`; 경로: `tower`, `towerRead`, `towerPrep`, `spendTower`, `refund`, `towerOff`, `report`, `remove`, `adminApi` hide, `giftWorld`, `ownerExtras`)
- Modify: `worker.js` (`towerTell`, giftKit, Meter 메서드, `readWorld`, `Room.httpWorld`)
- Modify: `schema.sql` (`spend_plaza`)
- Create: `migrations/2026-11-27-tower-minute.sql`
- Test: `test/tower-worker.test.mjs` (이어서)

- [ ] **Step 1: 실패하는 테스트 쓰기** (`test/tower-worker.test.mjs`에 이어 붙임)

```js
const KMIN = (day, hm) => Date.parse(day + 'T' + hm + ':00+09:00');
// A board 18:00-24:00 (tomorrow unless form.day says) by A on A.ip (default 1.1.1.1), with n friends' hearts (Turnstile off: every heart
// is a person). netBase keeps the friends of two boards on different networks.
async function boardWithFriends(H, env, A, n, { netBase = 0, ...form } = {}) {
  const r = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 18, ...form }), A.token, A.ip || '1.1.1.1')).json();
  for (let i = 0; i < n; i++) await heart(H, r.id, 500 + netBase + i, NET(100 + netBase + i));
  await drain(env, H);
  return r;
}
const book = (H, id, body, token, ip = '1.1.1.1') => H.post('/rt/gift/' + id + '/tower', body, token, ip);
const towerOf = async (H, id, token) => (await H.get('/rt/gift/' + id + '/tower', token)).json();

describe('booking a main tower minute', { concurrency: false }, () => {
  it('the owner\'s read: places left, friends, taken minutes; nobody else', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), B = await H.guest('2.2.2.2');
      const r = await boardWithFriends(H, env, A, 3);
      assert.equal((await H.get('/rt/gift/' + r.id + '/tower')).status, 401);
      assert.equal((await H.get('/rt/gift/' + r.id + '/tower', B.token)).status, 403);
      const t = await towerOf(H, r.id, A.token);
      assert.deepEqual([t.friends, t.need, t.tw, t.guest, t.days[addDays(today(), 1)].left], [3, 10, null, true, 30]);
    } finally { done(); }
  });
  it('friends: refused under 10, booked at 10; the minute, the board and the maker\'s day are each taken once', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), day = addDays(today(), 1), m = KMIN(day, '20:30');
      const r = await boardWithFriends(H, env, A, 9);
      let res = await book(H, r.id, { m, how: 'friends' }, A.token); assert.equal(res.status, 409); assert.equal((await res.json()).code, 'friends');
      await heart(H, r.id, 900, NET(900)); await drain(env, H);
      res = await book(H, r.id, { m, how: 'friends' }, A.token); assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
      assert.deepEqual((await res.json()).tw, { m, how: 'friends' });
      assert.equal((await (await H.get('/rt/gift/' + r.id)).json()).gift.tw, m, 'the public read has the minute');
      assert.equal(JSON.stringify(await (await H.get('/rt/gift/' + r.id)).json()).includes('friends'), false, 'never how');
      assert.equal((await (await book(H, r.id, { m: m + 60000, how: 'friends' }, A.token)).json()).code, 'board');
      const r2 = await boardWithFriends(H, env, A, 10, { to: '둘째', netBase: 200 });
      assert.equal((await (await book(H, r2.id, { m: m + 60000, how: 'friends' }, A.token)).json()).code, 'day', 'one a day per maker');
      const C = await H.guest('3.3.3.3'); C.ip = '3.3.3.3';
      const r3 = await boardWithFriends(H, env, C, 10, { to: '셋째', netBase: 400 });
      const busy = await book(H, r3.id, { m, how: 'friends' }, C.token, '3.3.3.3'), b = await busy.json();
      assert.equal(busy.status, 409); assert.equal(b.code, 'taken'); assert.deepEqual(b.taken, [m]);
      assert.equal((await (await book(H, r3.id, { m: KMIN(day, '21:15'), how: 'friends' }, C.token, '3.3.3.3')).json()).code, 'minute');
      assert.equal((await (await book(H, r3.id, { m: KMIN(day, '22:00'), how: 'friends' }, C.token, '3.3.3.3')).json()).code, 'minute');
    } finally { done(); }
  });
  it('two at once for one minute: exactly one gets it', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), C = await H.guest('3.3.3.3'); C.ip = '3.3.3.3';
      const ra = await boardWithFriends(H, env, A, 10), rc = await boardWithFriends(H, env, C, 10, { to: '다른', netBase: 300 });
      const m = KMIN(addDays(today(), 1), '20:31');
      const codes = (await Promise.all([book(H, ra.id, { m, how: 'friends' }, A.token), book(H, rc.id, { m, how: 'friends' }, C.token, '3.3.3.3')])).map((x) => x.status).sort();
      assert.deepEqual(codes, [200, 409]);
    } finally { done(); }
  });
  it('the 31st of a day is refused (sold)', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), day = addDays(today(), 1);
      const r = await boardWithFriends(H, env, A, 10);
      for (let i = 0; i < 30; i++) db(env).prepare('insert into gt(m, day, g, how, uid, at) values(?, ?, ?, ?, ?, ?)').run(KMIN(day, '19:' + String(1 + i).padStart(2, '0')), day, 'zz' + String(i).padStart(6, '0'), 'friends', 'guest:x' + i, 1);
      const res = await book(H, r.id, { m: KMIN(day, '20:30'), how: 'friends' }, A.token);
      assert.equal(res.status, 409); assert.equal((await res.json()).code, 'sold');
      assert.equal((await towerOf(H, r.id, A.token)).days[day].left, 0);
    } finally { done(); }
  });
});

describe('the points path before and after the migration', { concurrency: false }, () => {
  it('before: the read says prep (one probe per isolate per 10 minutes), a press is 503 prep and spends nothing; after: 2,000 once', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), U = await userToken(state, clock, 'tower-1'), day = addDays(today(), 1), m = KMIN(day, '20:30');
      const r = await (await H.post('/rt/gift', FORM({ day, at: 18 }), U.token)).json();
      const t = await towerOf(H, r.id, U.token);
      assert.deepEqual([t.guest, t.prep], [false, true]);
      const probes = state.rpc.filter((x) => x.name === 'spend_plaza'); assert.equal(probes.length, 1); assert.equal(probes[0].p_actor_id, 'probe:tower'); assert.equal(probes[0].p_coins, 2000);
      const res = await book(H, r.id, { m, how: 'points' }, U.token);
      assert.equal(res.status, 503); assert.equal((await res.json()).code, 'prep');
      assert.equal(db(env).prepare('select count(*) n from gt').get().n, 0);
      assert.equal(state.rpc.filter((x) => x.name === 'spend_plaza' && x.p_actor_id === U.id).length, 0, 'nothing spent while it is known to be off');
      state.spend = (b) => (b.p_actor_id === 'probe:tower' ? { ok: false, error: '지갑을 찾지 못했습니다.' } : { ok: true, remaining_coins: 3000 });
      clock.add(600001);
      assert.equal((await towerOf(H, r.id, U.token)).prep, false);
      const ok = await book(H, r.id, { m, how: 'points' }, U.token), o = await ok.json();
      assert.equal(ok.status, 200, JSON.stringify(o)); assert.equal(o.coins, 3000);
      assert.deepEqual(state.rpc.filter((x) => x.name === 'spend_plaza' && x.p_actor_id === U.id).map((x) => [x.p_coins, x.p_tickets]), [[2000, 0]]);
    } finally { done(); }
  });
  it('a guest is refused (account); Turnstile on needs a tower token; too few points spends nothing', async () => {
    const { state, clock, done } = setup();
    try {
      state.spend = (b) => (b.p_actor_id === 'probe:tower' ? { ok: false, error: '지갑을 찾지 못했습니다.' } : { ok: false, error: '코인이 부족해요.' });
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), U = await userToken(state, clock, 'tower-2');
      const day = addDays(today(), 1), m = KMIN(day, '20:30');
      const ra = await (await H.post('/rt/gift', FORM({ day, at: 18 }), A.token)).json();
      const ru = await (await H.post('/rt/gift', FORM({ day, at: 18, to: '계정' }), U.token, '2.2.2.2')).json();
      env.TURNSTILE_SITE = SITE; env.TURNSTILE_SECRET = SECRET; // on from here
      assert.equal((await (await book(H, ra.id, { m, how: 'points' }, A.token)).json()).code, 'account');
      assert.equal((await book(H, ru.id, { m, how: 'points' }, U.token, '2.2.2.2')).status, 403, 'no token: human');
      state.action = 'tower';
      const poor = await book(H, ru.id, { m, how: 'points', ts: 'good' }, U.token, '2.2.2.2'), p = await poor.json();
      assert.equal(poor.status, 400); assert.equal(p.code, 'poor'); assert.match(p.error, /포인트가 부족해요/); assert.equal(/코인/.test(p.error), false);
      assert.equal(db(env).prepare('select count(*) n from gt').get().n, 0);
    } finally { done(); }
  });
  it('spent, then the minute went to someone else in between: the 2,000 comes back and the answer is 409 with the fresh list', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), U = await userToken(state, clock, 'tower-3'), day = addDays(today(), 1), m = KMIN(day, '20:30');
      const r = await (await H.post('/rt/gift', FORM({ day, at: 18 }), U.token)).json();
      state.spend = (b) => { if (b.p_actor_id === 'probe:tower') return { ok: false, error: '지갑을 찾지 못했습니다.' }; db(env).prepare('insert into gt(m, day, g, how, uid, at) values(?, ?, ?, ?, ?, ?)').run(m, day, 'other123', 'friends', 'guest:o', 1); return { ok: true, remaining_coins: 1 }; };
      const res = await book(H, r.id, { m, how: 'points' }, U.token), b = await res.json();
      assert.equal(res.status, 409); assert.equal(b.code, 'taken');
      assert.deepEqual(grants(state, U.id).map((x) => x.p_amount), [2000]);
    } finally { done(); }
  });
  it('points once in 30 days per account', async () => {
    const { state, clock, done } = setup();
    try {
      state.spend = (b) => (b.p_actor_id === 'probe:tower' ? { ok: false, error: '지갑을 찾지 못했습니다.' } : { ok: true, remaining_coins: 9000 });
      const env = makeEnv(), H = harness(env), U = await userToken(state, clock, 'tower-4');
      const r1 = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 18 }), U.token)).json();
      assert.equal((await book(H, r1.id, { m: KMIN(addDays(today(), 1), '20:30'), how: 'points' }, U.token)).status, 200);
      clock.add(10 * 864e5);
      const r2 = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 18 }), U.token)).json();
      assert.equal((await (await book(H, r2.id, { m: KMIN(addDays(today(), 1), '20:30'), how: 'points' }, U.token)).json()).code, 'gap');
      clock.add(21 * 864e5);
      const r3 = await (await H.post('/rt/gift', FORM({ day: addDays(today(), 1), at: 18 }), U.token)).json();
      assert.equal((await book(H, r3.id, { m: KMIN(addDays(today(), 1), '20:30'), how: 'points' }, U.token)).status, 200);
    } finally { done(); }
  });
});

describe('a booking lets go', { concurrency: false }, () => {
  it('reports hide the board: the minute is free again, points come back, the rooms are told; a minute that started keeps its points', async () => {
    const { state, clock, done } = setup();
    try {
      state.spend = (b) => (b.p_actor_id === 'probe:tower' ? { ok: false, error: '지갑을 찾지 못했습니다.' } : { ok: true, remaining_coins: 9000 });
      const env = makeEnv(), H = harness(env), U = await userToken(state, clock, 'tower-5'), day = addDays(today(), 1), m = KMIN(day, '20:30');
      const r = await (await H.post('/rt/gift', FORM({ day, at: 18 }), U.token)).json();
      assert.equal((await book(H, r.id, { m, how: 'points' }, U.token)).status, 200);
      const told = []; const real = env.ROOM.get; env.ROOM.get = (n) => { const s = real(n); return { fetch: async (req) => { told.push(JSON.parse(await req.clone().text())); return s.fetch(req); } }; };
      for (const ip of ['7.7.7.1', '7.7.8.1', '7.7.9.1']) await H.post('/rt/gift/' + r.id + '/report', {}, null, ip);
      assert.equal(db(env).prepare('select count(*) n from gt').get().n, 0);
      assert.equal(db(env).prepare('select count(*) n from ga').get().n, 0, 'the 30 days and the day are given back');
      assert.deepEqual(grants(state, U.id).map((x) => x.p_amount), [2000]);
      assert.ok(told.some((x) => x.kind === 'TOWER' && x.data.id === r.id && x.data.off === 1));
    } finally { done(); }
  });
  it('the owner\'s delete and the admin\'s hide let go the same way and give the 30 days back; a minute that started keeps its points', async () => {
    const { state, clock, done } = setup();
    try {
      state.spend = (b) => (b.p_actor_id === 'probe:tower' ? { ok: false, error: '지갑을 찾지 못했습니다.' } : { ok: true, remaining_coins: 9000 });
      const env = makeEnv(), H = harness(env), U = await userToken(state, clock, 'tower-6'), d1 = addDays(today(), 1), d2 = addDays(today(), 2);
      const r1 = await (await H.post('/rt/gift', FORM({ day: d1, at: 18 }), U.token)).json();
      assert.equal((await book(H, r1.id, { m: KMIN(d1, '20:30'), how: 'points' }, U.token)).status, 200);
      assert.equal((await H.post('/rt/gift/' + r1.id + '/delete', {}, U.token)).status, 200);
      assert.deepEqual(grants(state, U.id).map((x) => x.p_amount), [2000]);
      assert.equal(db(env).prepare("select count(*) n from ga where how = 'points'").get().n, 0, 'the 30 days are given back');
      const r2 = await (await H.post('/rt/gift', FORM({ day: d2, at: 18 }), U.token)).json();
      assert.equal((await book(H, r2.id, { m: KMIN(d2, '20:30'), how: 'points' }, U.token)).status, 200, 'so points can be used again at once');
      assert.equal((await H.admin('/rt/admin/gift/hide', { id: r2.id })).status, 200);
      assert.deepEqual(grants(state, U.id).map((x) => x.p_amount), [2000, 2000]);
      const r3 = await (await H.post('/rt/gift', FORM({ day: today(), at: 18 }), U.token)).json(), m3 = KMIN(today(), '18:30');
      assert.equal((await book(H, r3.id, { m: m3, how: 'points' }, U.token)).status, 200);
      clock.add(m3 - Date.now() + 1000); // the minute has started
      for (const ip of ['7.7.7.1', '7.7.8.1', '7.7.9.1']) await H.post('/rt/gift/' + r3.id + '/report', {}, null, ip);
      assert.equal(grants(state, U.id).length, 2, 'nothing back for a minute that started');
    } finally { done(); }
  });
  it('a withdrawal deletes the bookings and the maker\'s record without paying back; an account link moves them', async () => {
    const { state, clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), G = await H.guest('1.1.1.1'), U = await userToken(state, clock, 'aaaaaaaa-2222-3333-4444-555555555555');
      const r = await boardWithFriends(H, env, G, 10);
      assert.equal((await book(H, r.id, { m: KMIN(addDays(today(), 1), '20:30'), how: 'friends' }, G.token)).status, 200);
      assert.equal((await H.post('/rt/auth/merge', { guest_id: G.id, guest_token: G.token }, U.token)).status, 200);
      assert.deepEqual([db(env).prepare('select uid from gt').get().uid, db(env).prepare('select uid from ga').get().uid], [U.id, U.id]);
      assert.equal((await H.post('/rt/auth/withdraw', {}, U.token)).status, 200);
      assert.deepEqual([db(env).prepare('select count(*) n from gt').get().n, db(env).prepare('select count(*) n from ga').get().n], [0, 0]);
      assert.equal(grants(state, U.id).filter((x) => x.p_amount === 2000).length, 0);
    } finally { done(); }
  });
  it('at budget hard: a booking is 503 busy with no gift DO call; the read answers from the copy with hard: true', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1');
      const r = await boardWithFriends(H, env, A, 10);
      await H.get('/rt/gift/' + r.id); // the board is in this isolate's copy
      env.BUDGET_REQ_DAY = '1'; clock.add(61000);
      const calls = spyGift(env);
      const res = await book(H, r.id, { m: KMIN(addDays(today(), 1), '20:30'), how: 'friends' }, A.token);
      assert.equal(res.status, 503); assert.equal((await res.json()).code, 'busy');
      const t = await towerOf(H, r.id, A.token);
      assert.equal(t.hard, true);
      assert.deepEqual(calls, []);
    } finally { done(); }
  });
});

describe('the plaza learns of a booking', { concurrency: false }, () => {
  it('/rt/world carries tower (next 26 h) with the board\'s words only; none: no key; a hidden board is left out; gifts keep their keys', async () => {
    const { clock, done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), m = KMIN(today(), '20:30'); // today: within the 26 hours
      let w = await (await H.get('/rt/world')).json(); assert.equal('tower' in w, false);
      const r = await boardWithFriends(H, env, A, 10, { day: today() });
      await book(H, r.id, { m, how: 'friends' }, A.token);
      clock.add(121000);
      w = await (await H.get('/rt/world')).json();
      assert.deepEqual(w.tower.map((e) => [e.id, e.m]), [[r.id, m]]);
      assert.deepEqual(Object.keys(w.tower[0]).sort(), ['from', 'id', 'm', 'msg', 'occ', 'th', 'to']);
      await H.admin('/rt/admin/gift/hide', { id: r.id }); clock.add(121000);
      w = await (await H.get('/rt/world')).json(); assert.equal('tower' in w, false);
    } finally { done(); }
  });
  it('the booking goes to the rooms as WORLD_UPDATE TOWER (not at hard); a room takes TOWER and refuses a bad one', async () => {
    const { done } = setup();
    try {
      const env = makeEnv(), H = harness(env), A = await H.guest('1.1.1.1'), m = KMIN(addDays(today(), 1), '20:30');
      const r = await boardWithFriends(H, env, A, 10);
      const told = []; const real = env.ROOM.get; env.ROOM.get = (n) => { const s = real(n); return { fetch: async (req) => { told.push([n, JSON.parse(await req.clone().text())]); return s.fetch(req); } }; };
      assert.equal((await book(H, r.id, { m, how: 'friends' }, A.token)).status, 200);
      const tower = told.filter(([, b]) => b.kind === 'TOWER');
      assert.ok(tower.some(([n]) => n === 'chapel:square'));
      assert.deepEqual(tower[0][1].data, { id: r.id, m, to: '민지', from: '친구들', occ: 'bday', msg: '생일 축하해!', th: 'party' });
      env.ROOM.get = real;
      const room = env.room('chapel:square').do, post = (data) => room.fetch(new Request('https://room.internal/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: 'WORLD_UPDATE', kind: 'TOWER', data }) }));
      assert.equal((await post({ id: 'x', m })).status, 400);
      assert.equal((await post({ id: r.id, m, off: 1 })).status, 200);
    } finally { done(); }
  });
  it('schema.sql and the migration take 2,000 and keep the refusal words; giftsrv.js knows the words', () => {
    const sql = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'), mig = fs.readFileSync(new URL('../migrations/2026-11-27-tower-minute.sql', import.meta.url), 'utf8');
    for (const s of [sql, mig]) { assert.match(s, /\(p_coins = 2000 AND p_tickets = 0\)/); assert.match(s, /'그 금액은 쓸 수 없어요\.'/); assert.match(s, /\(p_coins = 30 AND p_tickets = 0\)/); assert.match(s, /\(p_coins = 5000 AND p_tickets = 0\)/); }
    assert.match(mig, /GRANT EXECUTE ON FUNCTION public\.spend_plaza\(TEXT, TEXT, INT, INT\) TO anon, authenticated, service_role;/);
    const src = fs.readFileSync(new URL('../giftsrv.js', import.meta.url), 'utf8');
    assert.match(src, /SPEND_OLD/, 'the Worker knows the database before the migration');
  });
});
```

(계정 연결과 탈퇴 호출은 `gift-worker.test.mjs`의 "an account link moves a guest's boards"와 "withdrawal deletes the account's boards"가 쓰는 것과 같다. 방 스파이는 giftsrv가 받은 tallied env가 `env.ROOM`을 부를 때 지나가는지 보는 것이므로, `tallied`가 `ROOM.get`을 부를 때마다 원래 객체에서 찾는지(그래야 바꿔 낀 `get`이 보인다) 먼저 확인한다. 아니면 `makeEnv`의 `env.room`을 감싸 같은 것을 본다.)

- [ ] **Step 2: 실패 확인**

Run: `node --test test/tower-worker.test.mjs`
Expected: FAIL (`/tower` 404, `no such table: gt`, 마이그레이션 파일 없음).

- [ ] **Step 3: 마이그레이션과 `schema.sql`**

`migrations/2026-11-27-tower-minute.sql`:

```sql
-- 메인 타워 축하 1분 (docs/superpowers/specs/2026-11-27-main-tower-minute-design.md): spend_plaza takes 2,000 too (path B, accounts only,
-- the Worker checks the rest). Nothing else changes: 30 (sticker), 5,000 and one VIP ticket stay, and the refusal words stay exactly
-- '그 금액은 쓸 수 없어요.' (the Worker reads them to know this has not been run yet: towerrules.js SPEND_OLD).
-- The owner runs this by hand in the Supabase SQL editor of project wishboard. The Worker works before and after it.
CREATE OR REPLACE FUNCTION public.spend_plaza(
  p_key TEXT,
  p_actor_id TEXT,
  p_coins INT,
  p_tickets INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_wallet public.wallets%ROWTYPE;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  IF NOT (
    (p_coins = 30 AND p_tickets = 0) OR
    (p_coins = 2000 AND p_tickets = 0) OR
    (p_coins = 5000 AND p_tickets = 0) OR
    (p_coins = 0 AND p_tickets = 1)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', '그 금액은 쓸 수 없어요.');
  END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE actor_id = p_actor_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '지갑을 찾지 못했습니다.');
  END IF;
  IF p_coins > 0 AND v_wallet.coins < p_coins THEN
    RETURN jsonb_build_object('ok', false, 'error', '코인이 부족해요.');
  END IF;
  IF p_tickets > 0 AND v_wallet.vip_tickets < p_tickets THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VIP 티켓이 없어요.');
  END IF;
  UPDATE public.wallets
  SET coins = coins - p_coins,
      vip_tickets = vip_tickets - p_tickets,
      updated_at = now()
  WHERE actor_id = p_actor_id
  RETURNING * INTO v_wallet;
  RETURN jsonb_build_object('ok', true, 'remaining_coins', v_wallet.coins, 'vip_tickets', v_wallet.vip_tickets);
END;
$$;

REVOKE ALL ON FUNCTION public.spend_plaza(TEXT, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.spend_plaza(TEXT, TEXT, INT, INT) TO anon, authenticated, service_role;

-- Check: SELECT public.spend_plaza('<FLUSH_KEY>', 'probe:tower', 2000, 0);  -> {"ok": false, "error": "지갑을 찾지 못했습니다."}
```

`schema.sql` 1384~1428줄: 주석을 `-- Sticker (30), the main tower minute (2000, migrations/2026-11-27-tower-minute.sql), all-board takeover (5000, or one VIP ticket). …`로, 허용 목록에 `(p_coins = 2000 AND p_tickets = 0) OR`를 같은 자리에 더한다.

- [ ] **Step 4: `giftsrv.js` — 저장소 쪽**

import에 `towerrules.js`의 `TOWER_HOW, SPEND_OLD, TOWER_ERR, towerFault, towerDays, towerEntry`를 더한다. `const no` 위에 오류 문구를 합친다:

```js
const ERR = { ...GIFT_ERR, ...TOWER_ERR };
const no = (code, s = 400, extra = {}) => J({ ok: false, code, error: ERR[code] || GIFT_ERR.down, ...extra }, s);
```

`tables`:

```js
    q.exec('create table if not exists gt(m integer primary key, day text not null, g text not null unique, how text not null, uid text not null, at integer not null)');
    q.exec('create index if not exists gt_day on gt(day)');
    q.exec('create index if not exists gt_uid on gt(uid)');
    q.exec('create table if not exists ga(uid text not null, day text not null, how text not null, at integer not null, g text not null, primary key(uid, day))');
```

`prune`(`gi` 지우는 줄 다음):

```js
    q.exec('delete from ga where at < ?', now - (TOWER.gapDays + 1) * 864e5); // a maker's bookings: the 30 days between point bookings need them
```

`dropBoards` 두 번째 루프에 `q.exec('delete from gt where g = ?', id);`(보드와 함께 예약도 간다. `ga`는 30일 간격 때문에 남는다).

`get`: `re` 처리 다음 줄에

```js
    const t = q.exec('select m, how from gt where g = ?', row.id).toArray()[0];
    if (t) row.tw = { m: Number(t.m), how: String(t.how) };
```

새 메서드(`makers` 위에):

```js
  // The owner's card: the booking, each window day's places left and whether this maker has one that day, the taken minutes of the window,
  // the friends so far, and whether a points booking of this account is under TOWER.gapDays old.
  towerState(q, g, uid, now = Date.now()) {
    const t = q.exec('select m, how from gt where g = ?', g.id).toArray()[0], days = {};
    for (const day of towerDays(g)) {
      const n = Number(q.exec('select count(*) n from gt where day = ?', day).one().n) || 0;
      days[day] = { left: Math.max(0, TOWER.perDay - n), mine: q.exec('select 1 from ga where uid = ? and day = ?', uid, day).toArray().length > 0 };
    }
    const taken = q.exec('select m from gt where m >= ? and m < ? order by m', g.a, g.b).toArray().map((r) => Number(r.m));
    const friends = Number(q.exec('select count(*) n from gn where g = ?', g.id).one().n) || 0;
    const last = Number(q.exec("select max(at) t from ga where uid = ? and how = 'points'", uid).one().t) || 0;
    return { tw: t ? { m: Number(t.m), how: String(t.how) } : null, days, taken, friends, need: TOWER.friends, gap: last > 0 && now - last < TOWER.gapDays * 864e5 };
  },
  towerGet(q, id, uid, now = Date.now()) {
    const g = this.get(q, id, now, false);
    if (!g || giftPhase(g, now) === 'gone') return { ok: false, code: 'gone' };
    if (g.uid !== uid) return { ok: false, code: 'owner' };
    return { ok: true, ...this.towerState(q, g, uid, now) };
  },
  // A booking of minute o.m by o.how ('friends' | 'points'); o.guest: the asker is a guest or an anonymous login. One synchronous method, so
  // two asks for one minute never both pass. dry: only judge (the points path asks before it spends). -> { ok, tw, entry } |
  // { ok: false, code, taken, days }.
  towerBook(q, id, uid, o = {}, now = Date.now(), dry = false) {
    const g = this.get(q, id, now, false), m = Number(o.m), how = String(o.how || ''), day = kstDay(m);
    const s = g && g.uid === uid ? this.towerState(q, g, uid, now) : null;
    const dayN = Number(q.exec('select count(*) n from gt where day = ?', day).one().n) || 0;
    const code = towerFault({ g, uid, how, m, now, guest: !!o.guest, boardHas: !!s?.tw, taken: q.exec('select 1 from gt where m = ?', m).toArray().length > 0,
      dayN, mine: q.exec('select 1 from ga where uid = ? and day = ?', uid, day).toArray().length > 0, gap: !!s?.gap, friends: s?.friends || 0 });
    if (code) return { ok: false, code, ...(s ? { taken: s.taken, days: s.days } : {}) };
    if (dry) return { ok: true };
    try { q.exec('insert into gt(m, day, g, how, uid, at) values(?, ?, ?, ?, ?, ?)', m, day, g.id, how, uid, now); }
    catch { return { ok: false, code: 'taken', taken: s.taken, days: s.days }; }
    q.exec('insert or replace into ga(uid, day, how, at, g) values(?, ?, ?, ?, ?)', uid, day, how, now, g.id);
    bump(q, kstDay(now), 'tower:' + how);
    return { ok: true, tw: { m, how }, entry: towerEntry(g, m) };
  },
  // A booking whose minute has not started is let go (the board was hidden or deleted): the minute and the maker's record for that day go.
  // -> { uid, how, m } (points: the Worker pays back) or null.
  towerFree(q, gid, now = Date.now()) {
    const t = q.exec('select m, day, how, uid from gt where g = ?', String(gid)).toArray()[0];
    if (!t || Number(t.m) <= now) return null;
    q.exec('delete from gt where g = ?', String(gid)); q.exec('delete from ga where uid = ? and day = ? and g = ?', String(t.uid), String(t.day), String(gid));
    bump(q, kstDay(now), 'tower_free');
    return { uid: String(t.uid), how: String(t.how), m: Number(t.m) };
  },
  // /rt/world's tower: bookings of live boards starting in the next TOWER.worldAhead (or in their minute now), earliest first.
  towerLive(q, now = Date.now()) {
    return q.exec("select t.m tm, b.* from gt t join gb b on b.id = t.g where b.st = 'live' and t.m + ? > ? and t.m < ? order by t.m asc limit ?", TOWER.minMs, now, now + TOWER.worldAhead, TOWER.worldMax).toArray()
      .map((r) => towerEntry(rowOf(r), Number(r.tm)));
  },
  worldRead(q, now = Date.now()) { return { gifts: this.live(q, now), tower: this.towerLive(q, now) }; },
```

`report`: 보드가 가려질 때(`else { … if (n >= GIFT.report) … }`) 풀어 돌려준다:

```js
    else { q.exec('update gb set rp = ? where id = ?', n, g.id); if (n >= GIFT.report) { q.exec("update gb set st = 'hidden' where id = ?", g.id); off = this.towerFree(q, g.id, now); } }
    bump(q, kstDay(now), 'report');
    return { ok: true, hidden: n >= GIFT.report, ...(off ? { off } : {}) };
```

(`let off = null;`을 함수 앞에 둔다.)

`del`: `dropBoards` 앞에 `const off = this.towerFree(q, g.id, Date.now());`, 반환에 `...(off ? { off } : {})`.

`admin('hide')`: 보드를 가릴 때만(`!m && st === 'hidden'`) `const off = n ? this.towerFree(q, id, now) : null;`, 반환 `{ ok: true, ...(off ? { off } : {}) }`.

`move`: 끝에

```js
    q.exec('update gt set uid = ? where uid = ?', to, from);
    q.exec('update or ignore ga set uid = ? where uid = ?', to, from); q.exec('delete from ga where uid = ?', from); // the account's own record of a day wins
```

`forget`: 끝에 `q.exec('delete from ga where uid = ?', uid); q.exec('delete from gt where uid = ?', uid);`

- [ ] **Step 5: `giftsrv.js` — 경로 쪽**

`ownerExtras`에 `...(g.tw ? { tw: g.tw } : {})`.

경로 정규식에 `tower`를 더하고 분기:

```js
  const m = /^\/rt\/gift\/([0-9a-z]{8})(?:\/(paper|seen|heart|interest|video|card\.jpg|card|report|delete|tower))?$/.exec(p);
  // …
  if (sub === 'tower') return tower(req, env, ctx, id, k);
```

새 함수들(`interest` 아래):

```js
// ---- 메인 타워 축하 1분 (towerrules.js) ---------------------------------------------------------------------------------------
// Whether spend_plaza takes 2,000 yet (migrations/2026-11-27-tower-minute.sql): asked with a wallet that never exists ('probe:tower'),
// once per isolate per 10 minutes; before the migration the answer is SPEND_OLD, after it 지갑을 찾지 못했습니다. A failed ask counts as
// ready and is asked again in a minute (the press then finds out). A Supabase call, not a DO call.
const PREP = { at: 0, v: false, p: null };
function towerPrep(env, k, now = Date.now()) {
  if (now - PREP.at < 600000 && now >= PREP.at) return Promise.resolve(PREP.v);
  if (!k.rpc) return Promise.resolve(false);
  PREP.p = PREP.p || k.rpc('spend_plaza', { p_key: env.FLUSH_KEY || '', p_actor_id: 'probe:tower', p_coins: TOWER.price, p_tickets: 0 })
    .then((r) => { PREP.v = !!(r?.ok && r.data?.ok === false && r.data.error === SPEND_OLD); PREP.at = Date.now(); return PREP.v; },
      () => { PREP.v = false; PREP.at = Date.now() - 540000; return false; })
    .finally(() => { PREP.p = null; });
  return PREP.p;
}
export const towerPrepReset = () => { PREP.at = 0; PREP.v = false; }; // tests
// -> { ok, coins } | { prep } | { poor } | { down }.
async function spendTower(env, k, uid) {
  const r = await k.rpc('spend_plaza', { p_key: env.FLUSH_KEY || '', p_actor_id: uid, p_coins: TOWER.price, p_tickets: 0 }).catch(() => null);
  const d = r?.data || {};
  if (r?.ok && d.ok === true) { PREP.v = false; PREP.at = Date.now(); return { ok: true, coins: d.remaining_coins ?? null }; }
  if (r?.ok && d.error === SPEND_OLD) { PREP.v = true; PREP.at = Date.now(); return { prep: true }; }
  if (r?.ok && /부족/.test(String(d.error || ''))) return { poor: true };
  return { down: true };
}
// 2,000 back (a booking that could not be written after the spend, or one let go): once, in waitUntil when ctx is given. A failure is
// counted and logged: the operator gives it by hand (/rt/admin/coins).
function refund(env, ctx, k, uid, why) {
  const job = Promise.resolve().then(() => k.rpc('grant_coins', { p_key: env.FLUSH_KEY || '', p_actor_id: uid, p_amount: TOWER.price }))
    .then((r) => { if (!(r?.ok && r.data?.ok === true)) throw new Error('refund'); })
    .catch(() => { console.warn('tower refund failed', why); return giftM(env).giftRefundFail().catch(() => null); });
  if (ctx) { try { ctx.waitUntil(job); } catch { /* tests */ } }
  return job;
}
// A booking let go (off: { uid, how, m }): points back, and the rooms told to drop it.
function towerOff(env, ctx, k, id, off) {
  if (!off) return;
  if (off.how === 'points') refund(env, ctx, k, off.uid, 'off');
  if (k.towerTell) k.towerTell(env, ctx, { id, m: off.m, off: 1 });
  NOW.at = 0;
}
const TOWER_409 = new Set(['taken', 'sold', 'board', 'day', 'gap', 'friends']);
const towerNo = (r) => no(r.code, r.code === 'owner' || r.code === 'account' ? 403 : r.code === 'gone' ? 404 : TOWER_409.has(r.code) ? 409 : 400, { ...(r.taken ? { taken: r.taken } : {}), ...(r.days ? { days: r.days } : {}) });
// GET: the owner's card. POST { m, how, ts }: a booking. Cheapest first: token, the account's minute, the network's minute, body, the path's
// own refusals (a guest asking for points), budget hard (503, no DO call), Turnstile 'tower' (points only), whether the database takes
// 2,000 (points only, see towerPrep), then: friends: one DO call. points: a dry DO call, spend_plaza, the DO call that writes, and a
// refund if that write was refused (two asks for one minute within seconds).
async function tower(req, env, ctx, id, k) {
  if (req.method === 'GET') return towerRead(req, env, id, k);
  if (req.method !== 'POST') return J({ err: 'post' }, 405);
  const actor = await actorOf(req, k, env); if (!actor) return no('auth', 401);
  if (await actNo(k, env, actor.id)) return no('rate', 429, { 'retry-after': '60' });
  if (!(await opsRate(env, req, 'gtower', 10))) return no('rate', 429);
  const got = await readSmall(req, 3000); if (got.big) return no('long', 413); if (!got.b) return no('down', 400);
  const how = String(got.b.how || ''), m = Math.floor(Number(got.b.m)), uid = String(actor.id), guest = !!(actor.guest || actor.anon);
  if (!TOWER_HOW.includes(how) || !(m > 0)) return no('minute', 400);
  if (how === 'points' && guest) return no('account', 403);
  if (await hard(k, env)) return no('busy', 503);
  const M = giftM(env), o = { m, how, guest };
  let spent = null;
  if (how === 'points') {
    const gate = k.humanGate ? await k.humanGate(env, req, got.b, 'tower') : null; if (gate) return gate;
    if (await towerPrep(env, k)) return no('prep', 503);
    let ask = null; try { ask = await M.giftTowerBook(id, uid, o, Date.now(), true); } catch { ask = null; }
    if (!ask) return no('down', 503);
    if (!ask.ok) return towerNo(ask);
    spent = await spendTower(env, k, uid);
    if (spent.prep) return no('prep', 503);
    if (spent.poor) return no('poor', 400);
    if (!spent.ok) return no('down', 502);
  }
  let r = null; try { r = await M.giftTowerBook(id, uid, o, Date.now()); } catch { r = null; }
  if (!r?.ok) { if (spent?.ok) await refund(env, null, k, uid, 'book'); return r ? towerNo(r) : no('down', 503); }
  ONE.delete(id); NOW.at = 0;
  if (k.towerTell) k.towerTell(env, ctx, r.entry);
  return J({ ok: true, tw: r.tw, ...(spent?.ok ? { coins: spent.coins } : {}) });
}
async function towerRead(req, env, id, k) {
  const actor = k.tokenOf(req) ? await actorOf(req, k, env) : null; if (!actor) return no('auth', 401);
  if (!(await opsRate(env, req, 'gtower', 30))) return no('rate', 429);
  const uid = String(actor.id), guest = !!(actor.guest || actor.anon), prep = guest ? false : await towerPrep(env, k);
  if (await hard(k, env)) { // the copy this isolate has (ONE), no DO call
    const hit = ONE.get(id)?.v;
    return hit && hit.uid === uid ? J({ ok: true, hard: true, tw: hit.tw || null, guest, prep }) : no('busy', 503);
  }
  let r = null; try { r = await giftM(env).giftTowerGet(id, uid, Date.now()); } catch { r = null; }
  if (!r) return no('down', 503);
  if (!r.ok) return no(r.code, r.code === 'owner' ? 403 : 404);
  return J({ ok: true, tw: r.tw, days: r.days, taken: r.taken, friends: r.friends, need: r.need, gap: r.gap, guest, prep });
}
```

`giftDb`에 한 줄 메서드를 더한다(운영자 지표에 하루 합계로 보인다):

```js
  refundFail(q, now = Date.now()) { bump(q, kstDay(now), 'tower_refund_fail'); return { ok: true }; },
```

`report` 경로: 성공 뒤 `if (r.off) towerOff(env, ctx, k, id, r.off);` — `report(req, env, ctx, id, k)`로 서명을 바꾸고 `giftApi` 호출도. `remove`: `towerOff(env, ctx, k, id, r.off)`. `adminApi` hide: `if (r.ok) { giftDrop(...); towerOff(env, ctx, k, String(got.b.id || ''), r.off); }`.

`giftWorld`:

```js
// /rt/world's gifts and main tower bookings: one DO call per isolate per 2 minutes at most (5 while there is neither); at hard the last copy.
export async function giftWorld(env, k) {
  const now = Date.now(), busy = !!(NOW.v && (NOW.v.gifts?.length || NOW.v.tower?.length));
  if (now - NOW.at >= (busy ? NOW_TTL : NOW_IDLE) || now < NOW.at) {
    if (!(await hard(k, env))) { try { NOW.v = await giftM(env).giftWorldRead(now); NOW.at = now; } catch { NOW.v = NOW.v || { gifts: [], tower: [] }; NOW.at = now; } }
    else if (!NOW.v) { NOW.v = { gifts: [], tower: [] }; NOW.at = now; }
  }
  const gifts = (NOW.v?.gifts || []).filter((g) => g.a <= now && g.b > now), tower = (NOW.v?.tower || []).filter((e) => e.m + TOWER.minMs > now);
  return gifts.length || tower.length ? { gifts, tower } : null;
}
```

- [ ] **Step 6: `worker.js`**

Meter 메서드(`giftPayUndo` 아래):

```js
  giftTowerGet(id, uid, now) { return giftDb.towerGet(this.giftI(), id, uid, now); }
  giftTowerBook(id, uid, o, now, dry) { return giftDb.towerBook(this.giftI(), id, uid, o, now, !!dry); }
  giftWorldRead(now) { return giftDb.worldRead(this.giftI(), now); }
  giftRefundFail() { return giftDb.refundFail(this.giftI()); }
```

`towerTell`(`giftKit` 위)와 giftKit의 `towerTell`:

```js
// 메인 타워 축하 1분 (giftsrv.js): a booking, or its release ({ id, m, off: 1 }), to the plaza rooms someone sits in (wishRooms of both
// bases) as WORLD_UPDATE kind TOWER. env is the tallied one giftsrv.js was handed, so these DO calls count. Nothing at budget hard.
function towerTell(env, ctx, data) {
  const job = (async () => {
    if (await budgetHard(env)) return;
    const names = [...new Set((await Promise.all(['chapel:square', 'chapelqa:square'].map((t) => wishRooms(env, t)))).flat())];
    const body = JSON.stringify({ t: 'WORLD_UPDATE', kind: 'TOWER', data });
    await Promise.all(names.map((t) => env.ROOM.get(env.ROOM.idFromName(t)).fetch(new Request('https://room.internal/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body })).catch(() => null)));
  })().catch(() => { });
  try { ctx?.waitUntil?.(job); } catch { /* the answer already went */ }
  return job;
}
```

`Room.httpWorld` 첫 분기(`!m.kind`) 바로 다음에:

```js
    if (m && m.t === 'WORLD_UPDATE' && m.kind === 'TOWER') { // 메인 타워 축하 1분 (towerrules.js towerWire): to every socket; kept for a reconnect's replay
      const d = towerWire(m.data); if (!d) return J({ err: 'world' }, 400);
      const msg = { t: 'WORLD_UPDATE', kind: 'TOWER', data: d }; this.pushEv(msg); const s = JSON.stringify(msg); for (const w of this.socks().keys()) this.tx(w, s);
      return J({ ok: true });
    }
```

(`import { towerWire } from './towerrules.js';`를 worker.js 머리에.)

`readWorld`: 9번째 값 이름을 `gw`로 바꾸고

```js
  if (gw?.gifts?.length) world.gifts = gw.gifts; // [{ id, to, from, occ, msg, th, scr, a, b, n }]: left out while none is up
  if (gw?.tower?.length) world.tower = gw.tower; // 메인 타워 축하 1분 [{ id, m, to, from, occ, msg, th }], the next 26 h: left out while none
```

- [ ] **Step 7: 통과 확인**

Run: `node --test test/tower-worker.test.mjs test/gift-worker.test.mjs test/tower.test.mjs`
Expected: PASS. 그다음 `node --test test/*.test.mjs tools/account.test.mjs` 한 번(작업 3 끝): 실패 0.

- [ ] **Step 8: 커밋**

```bash
git add giftsrv.js worker.js schema.sql migrations/2026-11-27-tower-minute.sql test/tower-worker.test.mjs
git commit -m "Book a main tower minute: friends or 2,000 points (works before and after the spend_plaza migration), refunds, /rt/world tower and the rooms' TOWER push"
```

**Acceptance:** 같은 분 동시 예약은 하나만, 31번째 거절, B는 마이그레이션 전 "준비 중"이고 아무것도 빼지 않으며 뒤에는 2,000 한 번, 빼고 쓰기에 실패하면 돌려줌, 가려지면 풀리고 돌려줌, hard면 503에 DO 호출 없음, `/rt/world`의 `gifts` 키 묶음은 그대로.

---

### Task 4: 광장 — 메인 타워 덮기, 우선순위, 속보, `?gb=`

**Files:**
- Modify: `ts3d/screens.js` (`setTower`, `towerSlot`, `paint`, `primeTick`, 갱신 고리, 띠 글자)
- Modify: `timesSquare3d.js` (`setTower`, `towerSlot` 노출)
- Modify: `main.js` (`state.tower`, `applyPlaza`, `onWorldUpdate`, 1초 고리의 속보)
- Modify: `ui.js` (`news` `TOWER`)
- Modify: `gift.js` (`land`)
- Create: `test/tower-client.test.mjs`

- [ ] **Step 1: 실패하는 테스트 쓰기** — `test/tower-client.test.mjs`. `test/prime-client.test.mjs`의 `fakeDom`과 `boardsFor`(1~42줄)를 그대로 옮긴다.

```js
// 메인 타워 축하 1분 on the plaza (ts3d/screens.js setTower): in its minute the five main tower faces show the gift board, over a 1,000
// team's hour, never over the anniversary minute or the 9 pm hour; wish cards and the king stay off; the strip says what it is; main.js keeps
// the list from /rt/world and the rooms' TOWER pushes and says the news once; ?gb=<id> goes to the tower in that minute.
import { planDay, kstDay, dayStart } from '../primerules.js';
// … fakeDom, boardsFor, read copied from prime-client.test.mjs …
const MAIN = ['MAIN_UP', 'MAIN_TOP', 'MAIN_MID', 'MAIN_BOT', 'MAIN_LOW'];
const at = (hm) => dayStart(kstDay(Date.now())) + (Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3))) * 60e3;
const entry = (m, o = {}) => ({ id: 'abcd1234', m, to: '민지', from: '지수', occ: 'bday', msg: '생일 축하해!', th: 'party', ...o });
async function withClock(t, run) { const wall = Date.now; Date.now = () => t; try { await run(); } finally { Date.now = wall; } }

describe('the main tower minute on the plaza', () => {
  it('in its minute all five faces show the board, over a 1,000 team\'s hour; before and after, the team', () => withClock(at('14:30') + 5000, async () => {
    const { boards, words, cam } = await boardsFor();
    const day = kstDay(Date.now()), m = at('14:30'), plan = planDay({ day, teams: [] });
    boards.setPrime({ ...plan, tower: [{ id: 't0000001', a: 14 * 36e5, b: 15 * 36e5 }], names: { t0000001: '팀하나' }, n: { t0000001: 1200 } });
    assert.equal(boards.setTower([entry(m)]), true); assert.equal(boards.setTower([entry(m)]), false, 'the same list is no work');
    for (const id of MAIN) assert.match(words(id), /To\. 민지/, id);
    Date.now = () => m + 61000; for (let i = 0; i < 20; i++) boards.update(0.1, cam);
    for (const id of MAIN) assert.match(words(id), /팀하나/, id);
  }));
  it('never over the anniversary minute or the 9 pm hour, even if such an entry came', () => withClock(at('21:10') + 1000, async () => {
    const { boards, words } = await boardsFor();
    const plan = planDay({ day: kstDay(Date.now()), teams: [] });
    boards.setPrime({ ...plan, gold: { id: 't0000009', n: 50 }, names: { t0000009: '구시팀' } });
    boards.setTower([entry(at('21:10'))]);
    assert.match(words('MAIN_TOP'), /구시팀/);
  }));
  it('wish cards and the 9 pm king stay off the tower in that minute; the strip says 메인 타워 축하 1분', () => withClock(at('14:30') + 1000, async () => {
    const { boards, cam } = await boardsFor();
    boards.setTower([entry(at('14:30'))]);
    boards.setWishes([{ id: 'aaaaaaaaaa', nick: 'a', txt: '첫 소원', hearts: 1 }]); boards.setKing({ nick: '왕', txt: '어제', hearts: 9 });
    for (let i = 0; i < 100; i++) boards.update(0.1, cam);
    for (const id of MAIN) { assert.equal(boards.get(id).wish, null, id); assert.equal(!!boards.get(id).kingOn, false, id); }
    assert.equal(boards.towerSlot('abcd1234'), 'MAIN_MID'); assert.equal(boards.towerSlot('zzzz9999'), '');
  }));
});

describe('the glue', () => {
  const M = read('main.js'), U = read('ui.js'), GJ = read('gift.js'), T = read('timesSquare3d.js');
  it('main.js keeps the tower from /rt/world and the rooms\' pushes, and says the news once per booking', () => {
    assert.match(M, /world\?\.setTower\?\.\(state\.tower\)/);
    assert.match(M, /applyTower\(remote\.tower\)/);
    assert.match(M, /ev\?\.kind === 'TOWER'/);
    assert.match(M, /towerSeen\.has\(towerKey\(e\)\)/);
    assert.match(M, /ui\.news\('TOWER', e\)/);
  });
  it('ui.js: the TOWER news line, tapping it goes to the tower', () => {
    assert.match(U, /else if \(kind === 'TOWER'\) pushNews\('MAIN TOWER', \[towerNews\(data\)\], true, 'MAIN_MID'\);/);
    assert.match(U, /import \{ towerNews \} from '\.\/towerrules\.js';/);
  });
  it('gift.js: ?gb=<id> in its minute goes to the tower, not a street screen', () => { assert.match(GJ, /world\?\.towerSlot\?\.\(id\)/); });
  it('timesSquare3d.js passes setTower and towerSlot through', () => { assert.match(T, /setTower\(list\) \{ return boards\.setTower\?\.\(list\); \}/); assert.match(T, /towerSlot\(id\) \{ return boards\.towerSlot\?\.\(id\) \|\| ''; \}/); });
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test test/tower-client.test.mjs` — Expected: FAIL (`boards.setTower is not a function`).

- [ ] **Step 3: `ts3d/screens.js`**

import 줄에 `import { TOWER, towerAt, towerKey, towerWire } from '../towerrules.js';`(쿼리 없음).

`let prime = null;` 줄 아래에:

```js
  // 메인 타워 축하 1분 (towerrules.js): /rt/world's tower and the rooms' TOWER pushes. In an entry's minute (wall clock, nowMs: everyone the
  // same) the five MAIN_* faces show that gift board, before the plan's team: towerAt never returns an on-the-hour or 21 o'clock entry, so
  // the 9 pm team and the anniversary minute keep theirs. b.primeKey 'tw|<id>|<m>' while it shows (wish cards and the king leave it alone).
  let tower = [];
  const TOWER_SET = new Set(TOWER.slots);
  const towerNow = (b) => (TOWER_SET.has(b.slotId) && tower.length ? towerAt(tower, nowMs()) : null);
  const mainKey = (b) => { const te = towerNow(b); return te ? 'tw|' + towerKey(te) : primeKey(primeNow(b)); };
  function paintTower(b, e) {
    if (b.wish) dropWish(b);
    b.kingOn = 0; b.primeKey = 'tw|' + towerKey(e); b.primeName = ''; b.towerE = e;
    paintGift(b.canvas, e);
    remember(b.canvas); b.tex.needsUpdate = true;
  }
  /** list: [{ id, m, to, from, occ, msg, th }] (/rt/world tower, with the pushes merged by main.js). The same list again does nothing. */
  function setTower(list) {
    const next = (Array.isArray(list) ? list : []).map(towerWire).filter((e) => e && !e.off).slice(0, TOWER.worldMax);
    const sig = JSON.stringify(next);
    if (sig === setTower.sig) return false;
    setTower.sig = sig; tower = next;
    for (const b of boards.values()) if (TOWER_SET.has(b.slotId) && !b.shared) paint(b);
    return true;
  }
  const towerSlot = (id) => { const e = tower.length ? towerAt(tower, nowMs()) : null; return e && e.id === String(id) ? TOWER.face : ''; };
```

`primeTick`의 비교를 `mainKey`로:

```js
      if (mainKey(b) !== (b.primeKey || '')) paint(b);
```

`paint(b)` 첫 줄 앞에:

```js
    const te = towerNow(b);
    if (te) { paintTower(b, te); return; }
    b.towerE = null;
```

갱신 고리: `if (prime) primeTick();` → `if (prime || tower.length) primeTick();`.

띠 글자(`drawLive`): `const team = …` 줄을

```js
    const towerE = b.towerE && b.primeKey ? b.towerE : null; // the main tower minute's gift board
    const team = b.primeKey && !towerE ? b.primeName || '' : null;
```

로 바꾸고, 태그는 `TAGS[towerE ? 'gift' : team != null ? 'prime' : …]`, 글은 맨 앞에 `towerE ? \`메인 타워 축하 1분   ·   To. ${towerE.to}   ·   ${(OCCASIONS[towerE.occ] || OCCASIONS.bday).head}   ·   ${liveHead}\` : …`를 더한다.

반환 객체에 `setTower, towerSlot`을 더한다.

- [ ] **Step 4: `timesSquare3d.js`** — `primeOf` 다음:

```js
    // 메인 타워 축하 1분 (towerrules.js): the bookings (/rt/world tower and the rooms' pushes); towerSlot: 'MAIN_MID' while that board is on the tower.
    setTower(list) { return boards.setTower?.(list); },
    towerSlot(id) { return boards.towerSlot?.(id) || ''; },
```

- [ ] **Step 5: `main.js`**

import에 `import { TOWER, towerAt, towerKey, towerWire } from './towerrules.js';`(쿼리 없음). `state`에 `tower: []`. 도우미(`applyPlaza` 위):

```js
// 메인 타워 축하 1분 (towerrules.js): /rt/world's tower, and the rooms' TOWER pushes merged into it (a booking made after this page loaded,
// or its release). The news line goes once per booking when its minute starts (towerSeen), only after entering.
const towerSeen = new Set();
function applyTower(list) { state.tower = (Array.isArray(list) ? list : []).map(towerWire).filter((e) => e && !e.off).slice(0, TOWER.worldMax); world?.setTower?.(state.tower); }
function towerPush(d) { const w = towerWire(d); if (!w) return; const rest = (state.tower || []).filter((e) => e.id !== w.id && e.m !== w.m); applyTower(w.off ? rest : [...rest, w].sort((a, b) => a.m - b.m)); }
```

`applyPlaza` 안(`world.setPrime?.(state.prime);` 다음): `applyTower(remote.tower); // a missing key is none` — 이렇게 쓰면 테스트의 `world\.setTower\?\.\(state\.tower\)`는 `applyTower` 안에서 맞는다.

`net.onWorldUpdate` 첫 줄(`if (!ev?.kind) …` 앞):

```js
  if (ev?.kind === 'TOWER') { towerPush(ev.data); return; } // 메인 타워 축하 1분: no board row changes, no news here (the minute says it)
```

1초 고리(`setInterval(() => { const b = bucketKey(); …`) 안 끝에:

```js
  const e = entered && state.tower?.length ? towerAt(state.tower, nowMs()) : null;
  if (e && !towerSeen.has(towerKey(e))) { towerSeen.add(towerKey(e)); ui.news('TOWER', e); }
```

(`nowMs`가 main.js에 이미 import되어 있는지 보고, 없으면 `live.js`에서 가져온다.)

- [ ] **Step 6: `ui.js`** — import `import { towerNews } from './towerrules.js';`, `news(kind, data)`의 `WELCOME` 다음:

```js
      else if (kind === 'TOWER') pushNews('MAIN TOWER', [towerNews(data)], true, 'MAIN_MID');
```

- [ ] **Step 7: `gift.js` `land`** — `whenBuilt(() => {` 첫 줄에:

```js
      const face = world?.towerSlot?.(id); // 메인 타워 축하 1분: in its minute the board is on the tower, for everyone
      if (face) { world.goToSlot?.(face); world.focusSlot?.(face, { hold: 0, celebrate: false }); setTimeout(() => world.cheerAt?.(face), 900); note('🎉 지금 메인 타워에 걸려 있어요!', 'ok'); return; }
```

- [ ] **Step 8: 통과 확인** — Run: `node --test test/tower-client.test.mjs test/prime-client.test.mjs test/gift.test.mjs` — Expected: PASS. 그리고 `node tools/stamp.mjs --check` — Expected: 0(새 import가 모두 쿼리 없음).

- [ ] **Step 9: 커밋**

```bash
git add ts3d/screens.js timesSquare3d.js main.js ui.js gift.js test/tower-client.test.mjs
git commit -m "Show a booked gift board on all five main tower faces in its minute, before the 1,000 team's hour; the news line once; ?gb= goes to the tower"
```

**Acceptance:** 그 1분에 다섯 면 모두 그 보드, 정각·21시는 팀 그대로, 소원·소원왕이 덮지 않음, 속보 한 번, `?gb=`가 `MAIN_MID`로.

---

### Task 5: 선물 페이지 — 주인 카드, 자리 고르기, 카운트다운, 하트

**Files:**
- Modify: `giftpage.js` (import, `heartBtn`, 새 `towerCard`/`towerLine`, `owner`, `visit`)
- Modify: `gift.html` (`<link rel="modulepreload" href="/towerrules.js" />`, `giftrules.js` preload 옆)
- Test: `test/gift.test.mjs` (새 `describe`)

- [ ] **Step 1: 실패하는 테스트 쓰기** — `test/gift.test.mjs` 끝에. 이 파일의 `fakeDom`, `pageOf`, `view`, `GUEST`, `KST`를 쓴다.

```js
describe('메인 타워 축하 1분 on the gift pages', () => {
  const ID = 'abcd1234', AT = KST('2026-11-25T12:00:00'), M = KST('2026-11-25T20:30:00'), DAYS = { [DAY]: { left: 30, mine: false } };
  // o.at: the page's clock (the page data's now must match it: giftpage.js takes its skew from there); o.book: the POST's answer.
  const ownerPage = (tower, o = {}) => fakeDom({ path: '/g/' + ID, data: { id: ID, gift: view({ phase: 'day' }), now: o.at || AT, media: false, site: '' }, at: o.at || AT,
    store: { masil_gt: GUEST(), kts_gmine: JSON.stringify([ID]) },
    respond: (url, opt) => url === '/rt/gift/' + ID && !opt.method ? { ok: true, own: true, gift: view({ phase: 'day' }), mine: { kids: 0, vd: 0, at: AT - 1, lk: 1 } }
      : url === '/rt/gift/' + ID + '/tower' && (opt.method || 'GET') === 'GET' ? { ok: true, tw: null, days: DAYS, taken: [], friends: 3, need: 10, gap: false, guest: true, prep: false, ...tower }
      : url === '/rt/gift/' + ID + '/tower' ? (o.book || (() => ({ ok: true, tw: { m: JSON.parse(opt.body).m, how: JSON.parse(opt.body).how } })))(JSON.parse(opt.body)) : null, ...o });
  it('the owner\'s card: places left, friends k/10, the points button (or the account line for a guest)', async () => {
    const P = ownerPage({});
    try {
      await P.load('giftpage.js');
      assert.ok(P.heads().includes('🗽 메인 타워에 올리기'));
      assert.equal(P.says(/그날 남은 자리 30\/30/), true);
      assert.equal(P.says(/3\/10/), true);
      assert.ok(P.btn(/친구 응원 모으기/));
      assert.equal(P.says(/계정을 연결하면 포인트로 올릴 수 있어요/), true);
      assert.equal(P.btn(/2,000포인트로 올리기/), null, 'no points button for a guest');
    } finally { P.done(); }
  });
  it('an account: the points button; before the migration it says 준비 중; sold out says so', async () => {
    let P = ownerPage({ guest: false }); try { await P.load('giftpage.js'); assert.ok(P.btn(/2,000포인트로 올리기/)); } finally { P.done(); }
    P = ownerPage({ guest: false, prep: true }); try { await P.load('giftpage.js'); assert.equal(P.says(/포인트로 올리기는 준비 중이에요/), true); } finally { P.done(); }
    P = ownerPage({ days: { [DAY]: { left: 0, mine: false } } }); try { await P.load('giftpage.js'); assert.equal(P.says(/그날 메인 타워는 매진이에요/), true); } finally { P.done(); }
  });
  it('10 friends: pick a minute (on-the-hour and 21 o\'clock minutes are greyed), and it is booked', async () => {
    const P = ownerPage({ friends: 10 });
    try {
      await P.load('giftpage.js');
      await P.press(P.btn(/시간 고르기/));
      const sel = P.all('select').find((n) => n.attrs['aria-label'] === '메인 타워에 올릴 1분');
      const opts = sel.kids.filter((n) => n.tag === 'option');
      assert.equal(opts.find((n) => n.textContent.startsWith('20:00')).disabled, true);
      assert.equal(opts.find((n) => n.textContent.startsWith('21:15')).disabled, true);
      sel.value = String(M);
      await P.press(P.btn(/이 1분으로 올리기/));
      assert.deepEqual(P.sent.filter((s) => s.url.endsWith('/tower') && s.method === 'POST').map((s) => s.body), [{ m: M, how: 'friends' }]);
      assert.equal(P.says(/20:30에 메인 타워에 올라가요/), true);
    } finally { P.done(); }
  });
  it('a minute taken meanwhile: says so and greys it in the fresh list', async () => {
    const P = ownerPage({ friends: 10 }, { book: () => ({ ok: false, code: 'taken', error: '방금 다른 사람이 그 1분을 골랐어요. 다른 1분을 골라 주세요.', taken: [M], days: DAYS }) });
    try {
      await P.load('giftpage.js'); await P.press(P.btn(/시간 고르기/));
      const sel = P.all('select').find((n) => n.attrs['aria-label'] === '메인 타워에 올릴 1분'); sel.value = String(M);
      await P.press(P.btn(/이 1분으로 올리기/));
      assert.equal(P.says(/방금 다른 사람이 그 1분을 골랐어요/), true);
      const again = P.all('select').find((n) => n.attrs['aria-label'] === '메인 타워에 올릴 1분');
      assert.equal(again.kids.find((n) => n.value === String(M)).disabled, true); // h() puts value on the property, not an attribute
    } finally { P.done(); }
  });
  it('booked: a countdown; in the minute 지금 메인 타워에! with 광장에서 보기; after, 메인 타워에 올랐어요 · 20:30', async () => {
    for (const [now, re] of [[AT, /20:30에 메인 타워에 올라가요/], [M + 1000, /지금 메인 타워에!/], [M + 61000, /메인 타워에 올랐어요 · 20:30/]]) {
      const P = ownerPage({ tw: { m: M, how: 'friends' } }, { at: now });
      try { await P.load('giftpage.js'); assert.equal(P.says(re), true, String(re)); if (now === M + 1000) assert.equal(P.btn(/광장에서 보기/).attrs.href || P.btn(/광장에서 보기/).href, '/?gb=' + ID); } finally { P.done(); }
    }
  });
  it('the recipient page: the tower line from the public view; a heart before the day without a number', async () => {
    let P = pageOf(view({ tw: M }), M + 1000);
    try { await P.load('giftpage.js'); assert.equal(P.says(/지금 메인 타워에!/), true); } finally { P.done(); }
    P = pageOf(view({ day: '2026-11-30', a: KST('2026-11-30T18:00:00'), b: KST('2026-12-01T00:00:00') }), AT);
    try {
      await P.load('giftpage.js');
      const b = P.btn(/하트 보내기/); assert.ok(b, 'a heart before the day');
      await P.press(b);
      assert.equal(P.sent.filter((s) => s.url.endsWith('/heart')).length, 1);
      assert.equal(/\d/.test(P.btn(/하트를 보냈어요/).textContent), false, 'no count before the reveal');
    } finally { P.done(); }
  });
  it('the heart asks for a theart check when the page knows the site key', () => {
    assert.match(src('giftpage.js'), /DATA\?\.site \? await human\(String\(DATA\.site\), 'theart'\) : ''/);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test test/gift.test.mjs` — Expected: FAIL (카드 없음).

- [ ] **Step 3: `giftpage.js`**

import: `import { TOWER, TOWER_ERR, towerCard as towerState, towerClock, towerLook } from './towerrules.js';`(쿼리 없음).

`heartBtn`(그날 전에는 숫자 없이, `theart` 토큰):

```js
function heartBtn(g, note, { off = false, quiet = false } = {}) {
  const mark = hearted(), base = Number(g.hearts) || 0;
  let on = !!mark[g.id], n = on ? Math.max(base, Number(mark[g.id]) || 0) : base;
  const btn = h('button', { class: 'btn', type: 'button', disabled: off });
  // quiet: before the reveal the count is not shown (giftrules.js heartsOpen), so the button says only whether this device sent one.
  const paint = () => { btn.textContent = quiet ? (on ? '💖 하트를 보냈어요' : '🤍 하트 보내기') : (on ? '💖 ' : '🤍 ') + '하트 ' + n; btn.setAttribute('aria-pressed', String(on)); btn.setAttribute('aria-label', quiet ? (on ? '하트를 보냈어요' : '하트 보내기') : (on ? '하트를 보냈어요' : '하트 보내기') + ', ' + n + '개'); };
  btn.addEventListener('click', async () => {
    if (on || off) return;
    on = true; n += 1; paint();
    const keep = hearted(); keep[g.id] = n; const ks = Object.keys(keep); if (ks.length > 300) for (const k of ks.slice(0, 150)) delete keep[k]; ls.set('kts_ghearts', JSON.stringify(keep));
    // theart: with Turnstile on (the page data has its public key) the heart also counts as a friend of the board for the main tower minute.
    const ts = DATA?.site ? await human(String(DATA.site), 'theart') : '';
    let ok = false;
    try { const r = await fetch('/rt/gift/' + g.id + '/heart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ts ? { v: visitor(), ts } : { v: visitor() }) }); ok = !!r.ok; } catch { ok = false; }
    // … the rest as it is
  });
  paint();
  return btn;
}
```

`visit`의 `'before'` 갈래: `card(label, cd, fine)` 다음에 하트 줄과 탑 줄을 넣는다(주인 미리보기에서는 하트를 누를 수 없게):

```js
    const beforeNote = h('p', { class: 'okmsg', role: 'status' });
    const left = h('div', { class: 'sticky' }, h('h1', { … }), h('p', { … }), card(label, cd, fine), towerLine(g), cer, prev,
      h('div', { class: 'row' }, heartBtn(g, beforeNote, { off: preview, quiet: true })), beforeNote);
```

그 뒤 갈래의 `where` 다음에 `towerLine(g)`를 넣는다(`left` 묶음 안).

새 함수(`cta` 위):

```js
// 메인 타워 축하 1분 on the recipient page: the public view's tw (the minute only). Before it a countdown, in it the way to the plaza, after
// it the mark for the 7 days the page lives. Nothing about how it was won.
function towerLine(g) {
  if (!(Number(g?.tw) > 0)) return null;
  const m = Number(g.tw), box = h('div', { class: 'card' }), text = h('p', { style: 'font-weight:800;margin:0' }), go = h('a', { class: 'btn gold', href: '/?gb=' + g.id, onclick: (e) => toPlaza(e, 'go', g.id), hidden: true }, '🗽 광장에서 보기');
  live(text, () => { const t = now(), look = towerLook(m, t); go.hidden = look !== 'live';
    return look === 'soon' ? `🗽 ${towerClock(m)}에 메인 타워에 올라가요 · ${countdown(m - t)} 남음` : look === 'live' ? '🎉 지금 메인 타워에!' : `🗽 메인 타워에 올랐어요 · ${towerClock(m)}`; });
  box.append(text, go);
  return box;
}
// The owner's card (towerrules.js towerCard): places left that day, the two ways (friends k/10, 2,000 points for an account), the minute
// picker, then the countdown. Asks GET /rt/gift/<id>/tower once when built and again after a refusal.
function towerCard(g) {
  const head = () => h('h2', { text: '🗽 메인 타워에 올리기' });
  const box = card(head(), h('p', { class: 'fine', text: '불러오는 중…' }));
  let last = null; // the last GET answer: a refusal redraws from it with the fresh taken minutes and days
  const stateOf = (r) => towerState({ g, tw: r.tw, now: now(), days: r.days || {}, taken: r.taken || [], friends: r.friends, guest: r.guest, prep: r.prep, gap: r.gap });
  const draw = (r) => {
    const s = stateOf(r), note = h('p', { class: 'okmsg', role: 'status' });
    if (s.state === 'closed') { box.hidden = true; return; }
    if (s.state === 'booked' || s.state === 'live' || s.state === 'done') { box.replaceChildren(head(), towerLine({ ...g, tw: s.m })); return; }
    if (s.state === 'sold') { box.replaceChildren(head(), h('p', { class: 'sub', text: TOWER_ERR.sold })); return; }
    if (s.state === 'mine') { box.replaceChildren(head(), h('p', { class: 'sub', text: '그날은 이미 다른 선물 전광판으로 메인 타워 1분을 골랐어요.' })); return; }
    const friendsBtn = h('button', { class: s.canFriends ? 'btn gold' : 'btn', type: 'button' }, s.canFriends ? '🎉 메인 타워가 열렸어요! 시간 고르기' : `👥 친구 응원 모으기 · ${s.friends}/${s.need}`);
    friendsBtn.addEventListener('click', () => (s.canFriends ? pick(s, 'friends') : share(g, location.origin + '/g/' + g.id, note)));
    const points = s.points === 'ok' ? h('button', { class: 'btn', type: 'button', onclick: () => pick(s, 'points') }, `✨ ${TOWER.price.toLocaleString('en-US')}포인트로 올리기`)
      : h('p', { class: 'fine', text: s.points === 'account' ? TOWER_ERR.account : s.points === 'prep' ? TOWER_ERR.prep : TOWER_ERR.gap });
    box.replaceChildren(head(), h('p', { class: 'sub', text: `그날 남은 자리 ${s.left}/${TOWER.perDay} · 모든 사람이 같은 1분에 메인 타워 다섯 면에서 봐요.` }),
      friendsBtn, h('p', { class: 'fine', text: '친구가 이 페이지에서 하트를 누르거나 롤링페이퍼를 쓰면 한 칸씩 차요. 같은 인터넷 연결은 한 번, 내 연결은 세지 않아요.' }), points, note);
  };
  const WHY = { hour: '정각은 기념일 팀', gold: '9시 팀', taken: '찬 자리', soon: '지난 시간', sold: '매진', day: '그날 이미 고름' };
  const pick = (s, how, msg = '') => {
    const note = h('p', { class: 'okmsg', role: 'status' }), sel = h('select', { 'aria-label': '메인 타워에 올릴 1분' });
    for (const x of s.minutes) { const o = h('option', { value: String(x.m), text: towerClock(x.m) + (x.why ? ' · ' + (WHY[x.why] || '') : '') }); if (x.why) o.setAttribute('disabled', ''); sel.append(o); }
    const first = s.minutes.find((x) => !x.why); if (first) sel.value = String(first.m);
    const go = h('button', { class: 'btn gold', type: 'button' }, '이 1분으로 올리기');
    go.addEventListener('click', async () => {
      go.disabled = true;
      const r = await post('/rt/gift/' + g.id + '/tower', { m: Number(sel.value), how }, { action: how === 'points' ? 'tower' : '' });
      go.disabled = false;
      if (r.ok) { last = { ...last, tw: r.tw }; draw(last); return; }
      if (r.taken || r.days) { last = { ...last, taken: r.taken || last.taken, days: r.days || last.days }; pick(stateOf(last), how, r.error); return; } // the fresh list, the taken minute greyed
      say(note, r.error || '처리하지 못했어요. 잠시 뒤 다시 해 주세요.');
    });
    box.replaceChildren(h('h2', { text: '🗽 메인 타워에 올릴 1분' }), h('p', { class: 'fine', text: '이 전광판이 걸리는 시간 안에서 골라요. 정각과 밤 9시대는 응원 팀의 자리예요.' }), sel, go, note);
    if (msg) say(note, msg);
  };
  (async () => {
    const tok = await token(false); if (!tok) { box.hidden = true; return; }
    let r = null; try { r = await fetch('/rt/gift/' + g.id + '/tower', { headers: { authorization: 'Bearer ' + tok }, cache: 'no-store' }).then((x) => x.json()); } catch { r = null; }
    if (!r?.ok) { box.hidden = true; return; }
    last = r; draw(r);
  })();
  return box;
}
```

(`share(g, url, note, made)`는 `giftpage.js`에 이미 있는 주인의 공유 함수다. 409 뒤에는 고르기 화면을 새 목록으로 다시 띄우고 거절 문구를 그 아래에 보인다.)

`owner`의 오른쪽 열 순서에 `towerCard(g)`를 `shareCard` 바로 뒤에 넣는다(`vfirst`일 때도 `shareCard` 다음).

- [ ] **Step 4: `gift.html`** — `<link rel="modulepreload" href="/giftrules.js" />` 아래에 `<link rel="modulepreload" href="/towerrules.js" />`.

- [ ] **Step 5: 통과 확인** — Run: `node --test test/gift.test.mjs test/tower.test.mjs` 그리고 `node tools/stamp.mjs --check` — Expected: PASS, 0.

- [ ] **Step 6: 커밋**

```bash
git add giftpage.js gift.html test/gift.test.mjs
git commit -m "Gift pages: the owner's main tower card (friends k/10, 2,000 points for an account), the minute picker, the countdown, and a 💖 before the day"
```

**Acceptance:** 주인 카드의 상태(열림·손님·준비 중·매진·하루 한 번·예약·그 1분·끝남), 정각·21시 회색, 경합이면 새 목록, 받는 사람 페이지의 탑 줄, 그날 전 하트(숫자 없음), `theart` 토큰.

---

### Task 6: 문서·약관·질의서

**Files:** `legal.js`, `test/legal-nongame.test.mjs`, `docs/prime-screens.md`, `docs/gift-board.md`, `docs/point-sources-2026-11-27.md`, `docs/grac-inquiry.md`, `IMPLEMENTED.md`, `HANDOFF.md`

- [ ] **Step 1: 실패하는 테스트** — `test/legal-nongame.test.mjs`의 '응원 포인트' 테스트에 더한다:

```js
    // 메인 타워 축하 1분 (2026-11-27 설계): one place points are spent on the tower, one share reward, both with their numbers
    for (const w of ['메인 타워 축하 1분(2,000)', '응원 팀 응원과 응원 팀 명당에는 쓰지 않습니다', '내 선물 전광판 페이지에서 다른 인터넷 연결의 친구가 처음 하트를 누르거나 롤링페이퍼를 쓰면 50(하루 5명까지']) assert.ok(p.includes(w), w);
```

'명당과 전광판' 테스트에: `assert.match(p, /메인 타워 축하 1분은 응원 포인트 2,000이나 친구 응원 10곳으로, 남은 자리에서 먼저 고른 사람이 갖습니다/); assert.match(p, /누가 어떤 방법으로 올렸는지는 보이지 않습니다/);`

개인정보 '선물 전광판과 롤링페이퍼'에: `assert.match(sec('privacy', '선물 전광판과 롤링페이퍼'), /하트를 누르거나 메시지를 남긴 인터넷 연결의 해시/);`

- [ ] **Step 2: 실패 확인** — Run: `node --test test/legal-nongame.test.mjs` — Expected: FAIL.

- [ ] **Step 3: `legal.js`**
  - 이용약관 '응원 포인트': ⑤ 공유 끝에 "내 선물 전광판 페이지에서 다른 인터넷 연결의 친구가 처음 하트를 누르거나 롤링페이퍼를 쓰면 50(하루 5명까지, 한 연결은 한 보드에 한 번, 만든 사람의 연결은 세지 않습니다)."를 더한다. "하트 하나마다 주는 포인트도 없습니다" 문장은 남기고 그 앞에 "선물 전광판 공유 보상은 하트 수가 아니라 처음 반응한 서로 다른 친구 수로 셉니다."를 넣는다. 쓰는 곳 문장을 "…스티커, 캐릭터 꾸미기, 메인 타워 축하 1분(2,000)에 씁니다. 응원 팀 응원과 응원 팀 명당에는 쓰지 않습니다."로.
  - '명당과 전광판': "명당(메인 타워와 큰 화면)은 돈으로 팔지 않습니다." 다음에 "메인 타워의 개인 축하 1분은 하루 30자리이고, 응원 포인트 2,000이나 친구 응원 10곳으로, 남은 자리에서 먼저 고른 사람이 갖습니다. 경매나 추첨은 없고, 누가 어떤 방법으로 올렸는지는 보이지 않습니다. 정각과 밤 9시대는 응원 팀의 자리입니다."
  - 개인정보 '선물 전광판과 롤링페이퍼': "선물 전광판 페이지에서 하트를 누르거나 메시지를 남긴 인터넷 연결의 해시(원래 주소가 아닌 값)를 그 보드에 한 번 저장해 친구 응원 수와 공유 보상 한도를 세고, 보드와 함께 지웁니다. 메인 타워 1분을 고르면 그 시각, 고른 방법, 만든 사람의 계정 번호 또는 손님 번호를 저장하고, 포인트로 고른 기록은 30일 간격을 지키려고 31일 동안 둡니다."
  - `EFFECTIVE`와 머리 주석: 시행일은 **배포하는 날**로(작업 7에서 그날을 넣는다). 개정 메모에 "메인 타워 축하 1분과 선물 전광판 공유 보상을 더함".
- [ ] **Step 4: 문서**
  - `docs/prime-screens.md`: 머리말 원칙 문장 뒤에 "예외: 메인 타워의 개인 축하 1분(선물 전광판, `towerrules.js`)은 응원 포인트 2,000으로도 고를 수 있다. 응원 팀 명당은 그대로 사람 수로만 얻는다." 1장 표의 메인 타워 줄에 "선물 전광판 축하 1분(하루 30, 정각·21시 제외)". 3장 6번 우선순위: "21시 → 9시 팀, 정시 1분 → 기념일 팀, 예약된 1분 → 선물 전광판 축하, 그 밖 → 1,000명 팀".
  - `docs/gift-board.md`: 표 `gn`, `gt`, `ga`, 경로 `GET/POST /rt/gift/<id>/tower`, 하트 `{ v, ts? }`와 `theart`, `/rt/world`의 `tower`, 방 푸시, 공유 보상, 그날 전 하트, 하루 합계 키(`react`, `tpay`, `tpay_fail`, `tower:friends`, `tower:points`, `tower_free`, `tower_refund_fail`), 예산 표에 "예약 한 번: friends DO 1 / points DO 2 + RPC 1~2, 방 푸시 = 사람 있는 방 수 + acct 1(30초 캐시)".
  - `docs/point-sources-2026-11-27.md`: 1장 표에 "선물 전광판 친구 반응 +50(하루 5명)"과 쓰는 곳 "메인 타워 축하 1분 2,000(마이그레이션 뒤)". 6장에 바뀐 출처 한 줄.
  - `docs/grac-inquiry.md`: 3장 본문에 축하 1분 설명 한 문단, 질문 목록에 "무료로만 얻는 응원 포인트를 정해진 값(2,000)으로 써서 메인 타워의 개인 축하 1분을 선착순으로 고르는 기능이 게임물 판단에 영향을 주는지". 6장 체크리스트에 약관의 새 두 문장.
  - `IMPLEMENTED.md`: 새 절 "## 메인 타워 축하 1분 (2026-11-27)" — 무엇이 되는지, 숫자, 경로, 표, 마이그레이션 전후 동작. CRLF 주의(0장).
  - `HANDOFF.md`: "남은 것 › 주인이 할 것"에 날짜 붙은 한 줄 "마이그레이션 `migrations/2026-11-27-tower-minute.sql`을 SQL 편집기에서 돌린 뒤 `SELECT public.spend_plaza('<FLUSH_KEY>', 'probe:tower', 2000, 0);`이 `지갑을 찾지 못했습니다.`를 돌려주는지 본다(그 전까지 B는 '준비 중')".
- [ ] **Step 5: 통과 확인** — Run: `node --test test/legal-nongame.test.mjs test/layout.test.mjs` 그리고 `git diff --numstat IMPLEMENTED.md`(더한 줄 수만큼만 바뀌었는지).
- [ ] **Step 6: 커밋**

```bash
git add legal.js test/legal-nongame.test.mjs docs/prime-screens.md docs/gift-board.md docs/point-sources-2026-11-27.md docs/grac-inquiry.md IMPLEMENTED.md HANDOFF.md
git commit -m "Terms, privacy and docs for the main tower minute and the gift board share reward"
```

**Acceptance:** 약관·처리방침이 숫자와 예외를 말하고 게임 낱말 검사(`GAME`)를 통과, 문서 다섯이 경로·표·마이그레이션을 말함.

---

### Task 7: 빌드 도장, 전체 테스트, 로컬 확인 (오케스트레이터)

- [ ] **Step 1:** `node tools/stamp.mjs` (오늘의 빌드 id로 `?v=`를 다시 씀) 뒤 `node tools/stamp.mjs --check` → 0.
- [ ] **Step 2:** `node --test test/*.test.mjs tools/account.test.mjs` → 실패 0. 기준선 2,181개에 새 테스트 수를 더한 값, skipped 7. 무거운 테스트(`test/ads.test.mjs`의 시간 재기, `test/prodcheck.test.mjs`)가 부하로 실패하면 따로 한 번 돌려 본다.
- [ ] **Step 3:** 로컬 확인(`.claude/launch.json`의 `plaza`, 포트 8790, `--persist-to .wrangler/claude-state`): 375×812와 데스크톱에서 `/gift` 만들기 → 주인 카드(손님: "계정을 연결하면…") → 친구 10곳은 워커 테스트가 맡는다. 로컬에서 흉내 내려면 먼저 miniflare가 `cf-connecting-ip`를 그대로 넘기는지 하나로 확인한다. 넘기면 하트 10개를 서로 다른 머리글로 보내고(공유 보상이 운영 지갑에 들어간다는 것을 알고, 버리는 손님 하나로), 자리를 고른 뒤 그 분에 광장의 메인 타워 다섯 면을 본다. 20:50~20:59의 9시 배너와 겹치지 않는지. B는 누르지 않는다(로컬은 운영 DB). 보고서에 만든 손님 지갑 id를 적는다.
- [ ] **Step 4:** 빌드 도장 커밋. 배포·마이그레이션은 하지 않는다. 주인이 할 일(날짜·순서·다음 한 가지)을 끝에 적는다: ① 이 커밋을 배포할지 정하기 → ② 배포 → ③ 마이그레이션을 SQL 편집기에서 돌리기 → ④ 탐침 확인 → ⑤ 운영에서 B 한 번.

---

## 4. 설계 6장과 작업의 대응 (자체 점검)

| 설계 6장 | 작업·테스트 |
| --- | --- |
| 고를 수 있는 분(정각·21시·5분·창 밖·지난 분) | 1 `minuteBlock`/`minuteFault`/`towerMinutes` |
| 하루 30, 보드당, 만든 사람당, 30일 | 1 `towerFault`, 3 "sold", "board/day", "once in 30 days" |
| A 문턱(만든 사람 연결 제외, 같은 연결 두 번) | 1 `reactCounts`, 2 "counts one network once" |
| 같은 분 동시 예약 하나만, 31번째 거절 | 3 "two at once", "the 31st" |
| B 마이그레이션 전 "준비 중", 전후 동작, 빼고 실패하면 돌려줌 | 3 "before … after", "spent, then the minute went" |
| 신고로 가려지면 풀림·환불 | 3 "reports hide the board" (+ 주인 삭제·운영자 가리기) |
| 예산 hard 503 | 3 "at budget hard", 2 "at budget hard a 💖" |
| 공유 보상 5명·한 연결 한 번·만든 사람 연결 제외·토큰 없는 하트 안 셈 | 2 "the share reward", "Turnstile on" |
| 화면: 주인 카드·자리 고르기·카운트다운 | 5 |
| 메인 타워 덮기와 우선순위, 속보 | 4 |
| 전체 실패 0, 로컬 확인 | 7 |
