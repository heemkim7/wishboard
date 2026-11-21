# nine — IMPLEMENTED.md에 더할 글

## 전광판 › 아래에 더할 항목 (메인 타워 21:00~21:10 줄 다음)

- 밤 9시 배너: KST 20:50:00부터 왼쪽 열(지갑 아래)에 얇은 줄 하나가 나온다. 20:50~20:59:59는 `밤 9시, 메인 타워가 열려요 · mm:ss`(누르면 카메라가 메인 타워로), 21:00~21:09:59는 `지금 메인 타워가 열렸어요 · 닫히기까지 mm:ss`(누르면 점령 창이 `메인/코너` 구역으로, 켜진 주인이 없는 가장 싼 메인 타워 칸 `MAIN_LOW` → `MAIN_BOT` → `MAIN_MID` → `MAIN_TOP` → `MAIN_UP`, 모두 켜져 있으면 `MAIN_LOW`에 열린다), 21:10에 사라진다. 남은 시간은 초 단위 올림이라 한 단계 안에서 `00:00`은 나오지 않는다. 배너는 스스로 아무 시트도 열지 않는다. 새로 온 사람 모드에서는 숨는다. 3D 전광판 위가 아니라 HUD 열 안에 있으므로 소원 글자와 `지금 빼기 가능` 줄을 가리지 않는다.
- 어제의 소원왕 1분: KST 21:00:00~21:00:59에 `/rt/world`의 `wish.king`이 있으면, 메인 타워(`MAIN_*`)를 뺀 점령 가능한 칸이 모두(켜진 칸 포함) 왕의 카드를 보인다. 칩 `👑 어제의 소원왕`, 소원 글, `— 이름`, `♥ n`, 아래 띠 `👑 어제 하트를 가장 많이 받은 소원`, 가까운 칸의 움직이는 줄은 배지 `소원왕`과 `👑 어제의 소원왕 · {이름}`. 스티커는 그리지 않는다. 21:01이 되면 칸마다 원래 화면(켜진 주인의 광고 그대로, 빈칸·꺼진 칸의 안내면)으로 돌아가고 소원 카드 돌기가 이어진다. 60초 장악(`air`)이 같이 켜져 있으면 장악이 이기고, 장악이 끝나면 그 1분 안이면 왕의 카드로 돌아간다.
- 판단은 모두 클라이언트 시계로 한다. 새 라우트, 새 소켓 메시지, 서버를 다시 부르는 타이머는 없다. `main.js` `tickNine`이 1초마다 `live.js`로 계산해 `ui.setNine`(글이 바뀔 때만 DOM을 고친다)과 `world.setKing`을 부른다.
- 시계 보정: 부팅 때의 `GET /rt/world` 응답 `Date` 헤더로 서버 시계 − 내 시계를 한 번 재어 `live.js` `clock.off`에 둔다(`clockSkew`, 1초 단위 헤더라 +500ms, 요청 앞뒤 시각의 가운데와 비교). 2초 미만은 잡음으로 보고 0, 12시간을 넘으면 깨진 헤더로 보고 0, 요청이 3초 넘게 걸렸으면 오차가 그 절반까지 될 수 있어 0이다. 그 전에는 이런 보정이 없었다. 브라우저의 메인 타워 판단은 모두 `nowMs()`(`Date.now() + clock.off`)로 `auctionClosed(slot, nowMs())`를 부른다: 점령 창 배지·버튼·보내기 전 검사(`ui.js`), 전광판의 `towerOpen`(`ts3d/screens.js`), 빈 메인 타워 안내면(`ts3d/art.js`), 부팅 카드의 걸 수 있는 빈 자리 수(`main.js`). 워커는 `clock.off`를 쓰지 않으므로 `nowMs()`는 `Date.now()`다. `balance.js` 안에서 기본 시각으로 부르는 곳은 그대로다.
- 순수 함수는 `live.js`(워커도 번들하는 모듈이라 쿼리 없이 부른다): `NINE`(`pre` 20:50, `open` 21:00, `king` 21:01, `close` 21:10, KST 하루 안의 ms), `kstMsOfDay`, `ninePhase`(`pre` / `open` / ``), `nineLeft`, `mmss`, `nineBanner`(`{ phase, left, text }` 또는 `null`), `kingMinute(t, king)`, `clockSkew(date, sentAt, gotAt)`, `nineSlot(rows, now)`. `open`은 `balance.js` `ballOpen`과 초 단위로 같다.

## 오늘의 소원 › 전광판에 도는 소원 › 더할 항목

- 장면 API `setKing(k)`(`timesSquare3d.js` → `ts3d/screens.js`): `{ nick, txt, hearts }`면 왕의 1분을 켜고 `null`이면 끈다. 같은 카드를 다시 주면 아무 일도 하지 않고, 부르는 순간에는 아무것도 다시 그리지 않는다. 바뀐 칸은 0.08초 틱마다 가까운 칸부터 3개(`low` 1개)씩만 다시 그린다(`kingStep`). 61칸이 다 바뀌는 데 약 1.6초(`low` 약 5초)다. 글꼴이 들어오면 같은 예산으로 한 번 더 그린다. 지도에 없는 칸은 붙을 때(`mount`) 맞춘다.
- 소원 카드는 자기 칸이 왕 카드로 바뀔 때만 내려간다(`wishOk`가 그 칸의 왕 여부를 본다). 소원 판단(0.64초)은 왕 카드를 보이는 칸만 돌지 않는 칸으로 보므로, 1분이 시작될 때 소원 카드를 한 번에 모두 내리는 일이 없다. `pinWish`도 왕 카드 칸에는 올리지 않는다.

## 다녀간 사이와 받은 소식 › 고칠 줄

- 서버의 읽음 표시: `inbox_list`는 `read_at`을 주지 않지만 읽지 않은 줄을 먼저, 각 묶음 안에서는 새것부터 준다. `inbox.js` `serverRead`는 앞 줄보다 새 줄이 처음 나오는 곳부터를 다른 기기에서 이미 읽은 줄로 보고(`read_at`이나 `read:true`가 오면 그것도), `loadInbox`가 그 줄에 `read: true`를 붙인다. 🔔 점, `다녀간 사이`의 본 목록은 `kts_inbox_seen`과 이 줄들을 합쳐 본다(`main.js` `seenIds`). 이 추론이 되는 것은 읽지 않은 줄 가운데 읽은 줄보다 오래된 것이 있을 때뿐이다. 가장 흔한 경우(기기 A에서 모두 읽고, 기기 B를 연다: 모두 읽음이거나, 새로 온 읽지 않은 줄이 모두 읽은 줄보다 새것)에는 순서가 끊기는 곳이 없어 아무것도 알 수 없고, 기기 B는 A에서 읽은 줄을 새 소식으로 보인다. 이것은 고치지 못했다(아래 `사장님이 할 일`).
- 🔔 시트(`openInbox`)는 `/rt/inbox/read`를 기다리지 않고 뒤에서 보낸다(서버가 이미 읽은 줄은 빼고). 보내기가 실패해도 목록은 보이고 이 브라우저에서는 읽음으로 적혀 점이 꺼진다. 연 목록을 `inboxRows`로 바꿔 둔다.
- 놀던 중에 소켓 `INBOX`로 온 소식은 이번 세션 목록(`liveNews`, 10개까지)에 둔다. 방이 그 줄을 저장하기 전(코인 정산 때, 약 30초)에 🔔를 열어도 그 소식이 맨 위에 보인다(`inbox.js` `liveOnly`: 같은 종류·칸, 앞뒤 5분 안의 저장된 줄이 있으면 뺀다). 시트를 열면 비운다. 남아 있는 동안 🔔 점은 꺼지지 않는다.
- `다녀간 사이`가 이미 처리한 줄은 시트를 열지 않아도 바로 `kts_inbox_seen`에 적는다. 서버(`/rt/inbox/read`)에도 읽음으로 보내는 것은 다시 내가 가진 칸의 `taken`뿐이다(`inbox.js` `handledRead`). 놀던 중에 본 소식은 이 브라우저에서만 읽음이고, 서버 줄은 다른 기기를 위해 읽지 않은 채 둔다. 시트에 보인 줄과 그 밑에 접힌 줄은 그대로 시트를 닫을 때 적는다.
- 놀던 중에 본 소식 기록 `kts_inbox_live`는 그 줄을 볼 수 있었을 때만 쓴다: 새로 온 사람 모드가 아니고(소식 줄과 🔔가 숨어 있다) 탭이 보이는 상태(`document.visibilityState === 'visible'`)일 때(`inbox.js` `liveSeeable`). 그래서 새로 온 사람의 칸을 빼앗긴 소식이나 뒤에 깔린 탭에 온 소식은 다음 입장의 `다녀간 사이`에 나온다. `liveNews`의 시각은 `nowMs()`라 저장된 줄의 서버 `created_at`과 비교한다.
- `kts_inbox_seen`에 배열이 아닌 JSON이 들어 있으면 빈 목록으로 본다.

## 사장님이 할 일 (선택)

다른 기기에서 읽은 소식을 늘 맞게 하려면 DB 함수 `inbox_list`의 `jsonb_build_object(...)`에 한 줄을 더해 읽음 여부를 실어야 한다(`'created_at', s.created_at` 다음):

```sql
    'created_at', s.created_at,
    'read', s.read_at IS NOT NULL
```

그리고 `worker.js` `inboxList`의 줄 매핑에 `read: row.read === true` 를 더한다:

```js
const items = rows.slice(0, 20).map((row) => ({ id: row.id, kind: row.kind, slot_id: row.slot_id ?? null, phrase: row.phrase ?? null, from_name: row.from_name ?? null, from: row.from ?? null, created_at: row.created_at, read: row.read === true }));
```

클라이언트(`serverRead`)는 이미 `read: true`를 읽음으로 본다. 이번 작업은 SQL과 `worker.js`를 바꾸지 않았다.

## 고친 것 아닌 것

- `main.js`가 부르던 `world.setRank`는 장면에 없었다. 넘기던 값이 순위가 아니라 지갑 잔액이었고, 내 화면에만 보이는 잔액 표시는 HUD 지갑과 같은 말이라 호출 두 줄을 지웠다.
