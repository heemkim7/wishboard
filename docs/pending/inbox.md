# inbox — 응원이 칸 주인에게 닿는다

`IMPLEMENTED.md`에 더할 글이다. `같이 보기` 아래(또는 `코인` › 응원 줄 근처)에 `### 응원과 주인` 절로 넣는다. 기존 `응원 | 4. 그 건물이 체인이면 8 | 남 칸, 12초, 시간당 30회` 줄은 그대로다.

### 응원과 주인

- 2026-11-21 운영에서 찾은 문제: Room은 응원의 주인을 자기 isolate의 월드 사본(`cachedBoard`, 나이 검사 없음)에서 찾았다. Room DO는 `/rt/world`를 받는 isolate가 아니라서 그 사본이 대개 없거나 점령보다 오래됐다. 사본이 없으면 코인은 주고 소켓 `INBOX`는 아무에게도 가지 않았고, 우편 줄은 받는 사람이 비어 `inbox_batch`가 버렸다. 사본이 오래됐으면 방금 걸린 칸의 응원이 `why:'dark'`로 거절됐다.
- 이제 Room이 칸 줄을 직접 갖는다. 방이 중계하는 `WORLD_UPDATE` kind `BILLBOARD`의 `data` 줄(점령, 빼앗기, 무료 칸, 소속, 고치기, 불 켜기, 사진 올리기·승인, 내리기)에서 `slot_id` `holder_id` `holder_name` `line1~3` `lit_until` `expires_at`만 Room SQLite 표 `brd`(칸 → 줄, 받은 시각)에 칸마다 하나 둔다(61칸까지). 하이버네이션 뒤에도 남는다. `holder_id`와 시계(`lit_until` 또는 `expires_at`) 키가 없는 줄이면 그 칸 줄을 지운다. `kind` 없는 `WORLD_UPDATE`(한꺼번 변경)는 `brd`를 모두 지운다. 탈퇴(모든 광장 샤드에)와 계정 연결이 보낸다. 계정 연결(`/rt/auth/merge`)은 RPC 전에 `billboards?select=slot_id&holder_id=eq.<게스트 id>&limit=1`을 읽어 게스트가 가진 칸이 있을 때만(못 읽으면 있다고 본다), 성공 뒤 `waitUntil`로 살아 있는 방에만 보낸다. 고르는 법은 소원 알림과 같은 `wishRooms`다(부른 사람의 샤드와, 오늘·어제 들어온 계정이 앉은 같은 광장 샤드. 자리 표를 못 읽으면 부른 사람의 샤드만). 부른 사람의 샤드는 몸의 `topic`(`net.mergeGuest`가 보낸다, 없으면 `chapel:square`)이다. 고르지 않은 방은 `BRD_TTL` 안에 그 칸을 다시 읽는다. 같은 게스트로 다시 부르면 옮길 칸이 없어 아무 방에도 보내지 않는다.
- `/rt/auth/merge`는 토큰 확인, RPC, DO 호출 전에 클라이언트 IP마다 `GUEST_RL`(1분 10회)을 탄다. 넘으면 429 `{ ok:false, err:'rate', error:'계정을 연결하지 못했어요. 잠시 뒤 다시 해 주세요.' }`, `retry-after: 60`. 화면은 그 `error`를 토스트로 보이고, 다음 로그인 때 연결을 다시 시도한다. 점령의 샤드 알림은 샤드마다 따로 실패를 받아, 한 샤드가 실패해도 다음 샤드에 간다.
- 스티커 씻기(`/rt/spend` `kind:'wash'`)는 isolate 월드 사본을 보지 않고 Supabase에서 그 칸 한 줄(`snapBoard(slot, true)`)을 읽어 지금 주인만 허락한다.
- 응원(`{t:'CHEER', slot, p}`)을 받으면 `boardsFor`가 그 칸(코너·메인 타워면 그 건물의 칸 모두)의 줄을 이 순서로 정한다. ① `brd`의 줄(받은 지 5분 `BRD_TTL` 안), ② 그 isolate 월드 사본이 1분 안이고 `brd` 줄보다 새것이면 그 사본, ③ 둘 다 없으면 Supabase `billboards`를 그 칸들만 한 번 읽는다(`select=slot_id,holder_id,holder_name,line1,line2,line3,lit_until,expires_at&slot_id=in.(...)`, 2.5초 `BRD_MS` 안에 답이 없으면 그 응원은 포기한다). 읽은 줄은 `brd`에 넣는다. 받은 시각은 읽기를 시작한 때보다 1ms 앞으로 적어서, 읽는 동안(같은 ms 포함) 온 `WORLD_UPDATE` 줄을 덮지 않는다. 2.5초 뒤에 온 답도 `brd`에 들어간다. Supabase에 줄이 없는 칸은 주인 없는 칸으로 넣는다. 같은 칸들을 동시에 묻는 응원은 한 번 읽기를 나눠 쓴다. 읽기가 실패하거나(오류, 배열이 아닌 답, 주인·시계 키가 없는 줄) 2.5초를 넘으면 그 칸 묶음은 10초(`BRD_FAIL`) 동안 다시 읽지 않는다.
- 주인을 알 수 없으면(읽기 실패·시간 초과·실패 뒤 10초 안) 응원은 `PAY` `amount:0, why:'wait'`로 거절하고 코인도 우편도 없다. 화면은 `잠시 뒤 다시 응원해 주세요`(`main.js`). 예산 hard(`lvl` 2)면 칸 줄을 읽기 전에 `cap`. 그 밖의 거절은 그대로다. 내 칸, 주인 없는 칸, 불 꺼진 칸은 `dark`, 같은 칸 12초 안은 `soon`(칸 줄을 읽기 전에 한 번, 읽은 뒤 한 번 더 본다), 시간당 30회 넘으면 `cap`.
- 체인 보너스(그 건물이 한 사람 또는 같은 `#태그`로 모두 켜졌으면 8)도 같은 `boardsFor` 줄로 본다. 예전에는 isolate 월드 사본이 없으면 늘 4였다.
- 답례(`{t:'REPLY'}`)도 칸 주인 확인에 같은 `boardsFor`를 쓴다(3초 간격과 예산 hard는 읽기 전에 본다). 링크 방문(`ADCLICK`)과 택시 요금은 칸 주인을 보지 않는다.
- 주인이 정해지면 그 주인(`holder_id`, 소속 칸이면 `tribe:<id>`)에게 우편 줄을 넣고, 이 방에 있는 그 계정 소켓에 `{t:'INBOX', kind:'cheer', slot_id, phrase, from_name, from}`를 보낸다. 받는 사람이 빈 우편 줄은 만들지 않는다. 다른 샤드에 있는 주인에게는 소켓 알림이 가지 않고 우편 줄만 남는다.

### 우편 대기열

- 응원 우편 줄은 Room 메모리가 아니라 Room SQLite 표 `ibq`(`id` 자동 증가, 줄 JSON, 넣은 시각)에 쌓인다. 하이버네이션이나 DO 재시작에도 남는다.
- 나가는 때는 코인 정산과 같다. Room의 정산(`_flush`: 알람, 20건, `/rt/flush-wallet`, 방 옮기기)이 `coin_batch`에 성공한 뒤, 또는 보낼 코인 줄이 없을 때 `flushInbox`가 오래된 것부터 100줄(`IBQ_N`)씩 `inbox_batch`로 보낸다. 보낸 줄만 지운다. `inbox_batch`가 실패하거나 함수가 없다는 답이면 줄은 남는다. 한 번에 한 번만 보낸다.
- 보내기 전에 7일(`IBQ_DAYS`)보다 오래된 줄과, 가장 새 500줄(`IBQ_MAX`) 밖의 줄을 지운다.
- 알람은 바꾸지 않았다. 응원 하나는 늘 코인을 남기므로(`coin` 표, `tapN`) 알람이 `FLUSH_MS`(30초)마다 다시 걸리고, 사람이 다 나가도 코인이 남아 있는 동안은 풀리지 않는다. 그래서 방이 비기 직전에 쌓인 줄도 다음 알람의 코인 정산과 함께 나간다. 그 사이 DO가 메모리에서 내려가도 알람이 새 인스턴스를 깨우고, `coin`과 `ibq`가 SQLite에 있어 그대로 나간다.
- 코인은 나갔는데 `inbox_batch`만 실패한 줄은, 보낼 코인이 없는 알람(사람이 있는 동안 60초마다)에서 마지막 보내기 30초 뒤 다시 보낸다. 사람이 없으면 알람이 풀리므로, 방에 다음 정산이 생길 때까지 `ibq`에서 기다린다. 이 줄 때문에 새 알람을 걸지 않는다.

### 운영 점검 스크립트

- `tools/prod-e2e.mjs`의 `board` 단계는 점령 직후 응원을 한 번만 보내고(`dark`를 다시 해 보지 않는다), 게스트 1 소켓의 `INBOX`(보낸 사람이 게스트 2), `/rt/inbox`의 cheer 줄, `/rt/inbox/read`를 본다. `/rt/inbox` 줄에 `read`가 있으면 읽기 전 `false`, 읽은 뒤 다시 읽어 `true`인지 본다. 없으면 SKIP이다.
- 점령할 칸은 `BALANCE.starterSlots`와 `GET /rt/config`의 `starter`에 있는 칸을 모두 뺀다(`starterOf`). `/rt/config`를 읽지 못하면 점령하지 않고 그 단계를 FAIL로 멈춘다.
