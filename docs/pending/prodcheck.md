# 운영 점검 스크립트 (prodcheck)

`IMPLEMENTED.md`에 `## 운영 점검` 섹션으로 더할 글이다. 아래 `실행`과 `남는 것`은 운영자가 그대로 따라 하는 안내다.

## 운영 점검

배포된 사이트를 확인하는 도구는 둘이다. 둘 다 저장소 루트에서 Node 22 이상(내장 `fetch`, `WebSocket`)으로 돌리고 패키지를 쓰지 않는다. `tools/`는 `.assetsignore`에 있어 정적 에셋으로 나가지 않는다.

- `tools/prod-check.mjs <origin>`: 읽기만 한다. 작업 트리의 파일이 운영에서 바이트까지 같은지, 숨겨야 할 경로(`/.dev.vars`, `/worker.js`, `/AGENTS.md`, `/tools/…`, `/test/…` 등)가 200이 아닌지, `index.html`의 `main.js?v=`부터 모듈 그래프가 모두 열리고 한 모듈이 한 주소인지, 공개 API(`/rt/config` `/rt/world` `/rt/wishes` `/rt/health` `/rt/gate` `/rt/push/key`) 모양을 본다. 비교에서 빼는 파일은 `.assetsignore`를 `.gitignore` 문법으로 읽어 정한다(`parseIgnore`/`ignoredBy`, `.assetsignore` 자신도 뺀다). 문제가 있으면 1로 끝난다.
- `tools/prod-e2e.mjs <origin> [--only=a,b] [--keep] [--fresh] [--state=<file>]`: 운영에 쓴다. 테스트 게스트 셋(`점검1` `점검2` `점검3`)으로 실제 경로를 끝까지 지난다.

### 실행

```
node tools/prod-check.mjs https://studio.wishboard.workers.dev
node tools/prod-e2e.mjs https://studio.wishboard.workers.dev
```

- `ADMIN_KEY`는 실행할 때 `./.dev.vars`의 `KEY=value` 줄에서 읽는다. 값, 게스트 토큰, 계정 id는 출력하지 않는다(id는 끝 4자만, 응답 본문도 `g1.` 토큰·게스트 id·키를 지운 앞 200자만).
- 첫 단계 `admin`에서 `GET /rt/admin/stats`가 401이면 `operator key in .dev.vars is not the production key`, 그 밖에 200 `ok:true`가 아니면 그 이유를 쓰고, 아무것도 만들지 않은 채 2로 끝난다. `GET /rt/gate`가 열려 있지 않을 때(`full`, 또는 `lean` 80% 이상)도 같다. 이미 줄이고 있는 서비스에 부하를 더하지 않는다. `.dev.vars`가 없거나 `ADMIN_KEY`가 없어도 2다. 인자가 틀리면 64.
- origin은 `https://`만 받는다. `http://`는 `localhost`, `127.0.0.1`, `[::1]`일 때만. `--state=`는 `os.tmpdir()` 아래만 받는다(살아 있는 게스트 토큰이 작업 트리에 떨어지지 않게).
- 상태 파일이 없으면 새로 시작한다. 읽을 수 없거나 깨졌거나 다른 버전이면 남은 칸·소원 목록을 잃지 않도록 2로 끝난다. 손으로 고치거나 옮긴 뒤 다시 돌린다.
- 출력은 검사마다 `PASS|FAIL|SKIP  단계  무엇  (자세히)` 한 줄, 끝에 단계별 표와 남긴 것 목록이다. FAIL이 하나도 없을 때만 0으로 끝난다. HTTP 실패 줄에는 메서드, 경로, 상태, 본문 앞 200자가 있고, 기다리다 끝난 줄에는 무엇을 기다렸는지가 있다.
- 게스트 토큰은 `os.tmpdir()`의 `kts-prod-e2e-<host>.json`(또는 `--state=`)에만 쓴다. 다음 실행은 그 게스트를 다시 쓰고(만료 하루 전부터는 `POST /rt/guest {t}`로 같은 id를 갱신), 더 만들지 않는다. `--fresh`는 새 게스트 셋을 만들고 이전 셋은 파일의 `retired`에 남겨 정리와 지갑 목록에 쓴다. 파일이 다른 origin의 것이면 2로 끝난다.
- `--only=wish,board`는 그 단계와 필요한 앞 단계(`guests`, `enter`, `coins`…), 그리고 늘 `admin`과 `cleanup`을 돈다. `--only=cleanup`은 `--keep`으로 남긴 것만 치운다.
- `--keep`이 없으면 실패한 뒤에도, Ctrl+C 뒤에도 `cleanup`이 돈다(Ctrl+C 두 번이면 바로 끝난다).
- 한 번 도는 데 보통 2~4분이다. 캐시를 기다리는 곳(월드 15초, 소원 하나 10초, 사진 조회 60초)은 5초 간격으로 다시 읽는다. KST 0시 15분 전 안이면 소원·불 켜기 검사가 날을 넘을 수 있다고 알린다.

### 단계

| 단계 | 하는 것 |
| --- | --- |
| `admin` | `/rt/admin/stats`(`x-admin-key`, 200 `ok:true`가 아니면 중단), `/rt/health`(시크릿 둘), `/rt/gate`(열려 있고 `lean`이 아니어야 한다, 아니면 중단) |
| `guests` | `POST /rt/guest`로 셋을 만든다. `GUEST_RL`(IP당 분 10개)에 걸리면 `retry-after`만큼 기다린다 |
| `enter` | 셋 다 `net.js`처럼 `wss://…/rt/ws?topic=chapel:square&room=square`, 하위 프로토콜 `masil2`와 `at.<토큰>`으로 연다. `ok`를 기다리고 25초마다 `ping`. `main.js`처럼 `{t:'BONUS', kind:'hello'}`를 보내 hello `PAY` 40을 받는다(앞선 실행에서 받았으면 두 번 오지 않는지 본다). `/rt/flush-wallet`로 정산하고 `/rt/wallet`의 `exists`를 본다. `tr`(프레즌스)는 보내지 않아 광장에 아바타가 서지 않는다 |
| `coins` | 게스트 1의 지갑이 1000코인보다 적을 때만 `POST /rt/admin/coins {actor_id, amount:3000}`. 지갑이 그만큼 는다. 다시 돌릴 때 운영자 지급이 쌓이지 않는다. `WALLET_SYNC`는 있으면 PASS, 없으면 SKIP |
| `wish` | 게스트 3의 링크·전화번호 소원이 `link`로 거절되고 그날 소원이 남는지. 게스트 1이 `소원 점검 중이에요 🌠`를 올리고, 바로 고치면 `soon`, 방에 `WISH`, `mine`·`recent`, 게스트 2의 하트(하트 1, `left` 1 감소), 두 번째 하트 `dup`, 자기 하트 `own`, `?id=`의 `focus`, `/rt/world` `wish.board` |
| `share` | `og.jpg`(117KB)를 `POST /rt/snap?wish=<id>`로. `/rt/s/<id>`의 `og:image`가 `/rt/snap/<id>`이고 그것이 `image/jpeg`. `/rt/w/<id>`의 `og:description`이 소원 글, 그림이 그 사진. 게스트 2가 같은 `?wish=`로 올려도 미리보기는 그대로이고 게스트 2 사진 페이지는 사이트 기본 제목 |
| `push` | `GET /rt/push/key`만. 가짜 구독은 넣지 않는다 |
| `board` | `/rt/world`에서 주인 없는 칸 가운데 메인 타워, 무료 칸(`BALANCE.starterSlots`), 주인 있는 분양 필지 앞(입찰 절반이 그 사람에게 간다)을 빼고 가장 싼 칸. 그런 칸이 2개 미만이면 SKIP(마지막 빈 칸은 가져가지 않는다). `ui.js`가 보내는 몸으로 `claim` 최소 입찰, 세 줄 `점검 중` / `곧 내려갑니다` / 빈 줄. 월드의 주인, 지갑 감소, 방의 `WORLD_UPDATE`, 같은 날 `/rt/relight`가 `lit_until`을 바꾸지 않는지. 게스트 2가 `{t:'CHEER', slot, p:1}`을 보내 `PAY` kind `cheer`를 받고, 게스트 1 소켓에 `INBOX` cheer, 게스트 2를 정산하면 방의 우편 대기열이 나가서 게스트 1 `/rt/inbox`에 cheer 줄(`from`이 게스트 2), `/rt/inbox/read`가 `ok` |
| `moderation` | `/rt/admin/wishes`에 있고, `POST /rt/admin/wish {id, hide:true}`로 가리면 `/rt/wishes` 목록에서 빠지고 게스트 1에게는 `hidden`, `/rt/w/<id>`는 `/`로 302 |
| `cleanup` | 이번과 앞선 실행이 만든 소원을 모두 가린다. 칸은 아래 조건이 모두 맞을 때만 건드린다: `/rt/world`를 읽었고, 그 칸의 주인이 테스트 게스트이고, 상태 파일의 점령이 30분 보호 시간 안이다(`min(보낸 시각+30분, protected_until)`에서 1분 여유, 그 안에서는 누구도 빼앗지 못했다). `takedown_billboard`와 주인 고치기는 서버가 주인을 따지지 않으므로 이것이 유일한 가드다. 맞으면 먼저 주인으로 `mode:'edit'`, 입찰 그대로(돈이 들지 않는다), 세 줄 `여기도 소원 자리예요` / `불이 꺼지면` / `누구나 걸 수 있어요`로 고친다. 고치기가 거절될 때만(FAIL 한 줄) `POST /rt/admin/takedown {slot}`. 조건이 안 맞으면 손대지 않고 `handle by hand: <칸> (이유)`를 쓰며 그 칸은 다음 실행에도 남는다. 소켓을 닫고 지갑 잔액을 쓴다 |

### 남는 것

- 지갑 3개(실행마다 같은 셋, `--fresh`면 셋 더). API로 지울 수 없다. 끝에 이름, id 끝 4자, 잔액이 나온다. 전체 id는 상태 파일에 있다. 운영자가 `/rt/admin/wallets?nickname=점검1`로 찾을 수 있다.
- 칸: 실행마다 새 빈 칸 하나. 정리 뒤에도 그 칸은 점령부터 72시간 동안 테스트 게스트가 켜 둔 칸이다(고친 칸은 중립 세 줄, 내린 칸은 `운영자가 내렸습니다`). 고치기도 `takedown_billboard`도 `holder_id`를 지우지 않는다. 보호 30분 뒤에는 `현재 입찰+50`으로 빼앗을 수 있고, 그때 실제 플레이어가 낸 코인에서 테스트 입찰의 80%가 환불로 테스트 지갑에 들어간다. 72시간 뒤 꺼진 칸이 된다. 바로 비우려면 운영자가 Supabase에서 그 칸의 `holder_id`를 비워야 한다(API 없음). 끝 목록은 고친 칸, 내린 칸, `handle by hand` 칸을 따로 쓴다.
- `billboard_history`(점령, 불 켜기, 고치기·내리기)와 `coin_ledger`(hello, 운영자 지급, 입찰, 응원) 줄은 그대로 남는다.
- 순위: 게스트 1의 `wallets.spent`가 입찰만큼 늘어 `/rt/world` `ranks`(상위 20)에 `점검1`로 나올 수 있다.
- 소원 1개(가림). 그날 게스트 1은 새 소원을 못 건다. 새 소원마다 이 네트워크(IP 망)의 그날 새 소원 20개(`WISH.ipPostsPerDay`) 가운데 하나를 쓴다.
- 답이 오지 않은 점령이나 소원 올리기는 월드(또는 그 게스트의 `mine`)를 다시 읽어, 실제로 걸렸으면 상태 파일에 적고 FAIL로 쓴다. 정리가 그것도 치운다.
- 상태 파일에는 살아 있는 게스트 토큰이 있다(끝 목록에 경로가 나온다). 더 쓰지 않을 때 지운다. 지우면 그 게스트는 이 스크립트로 다시 정리할 수 없다. 올라간 뒤 가려질 때까지 1~2분, 같은 방 사람의 전광판과 소식 줄에 `점검1`의 소원이 보일 수 있다.
- 사진 2장. `snaps` 저장소에서 7일 뒤 지워진다. 가린 소원의 사진 페이지는 사이트 기본 그림으로 간다.
- 우편함 cheer 줄 1개(읽음), 게스트 2의 응원 코인, 점령으로 게스트 1 자신의 광장 열기 게이지(`fg|<id>`) +1.
- 통계: 오늘 방문 +3(`acct` 집계), 점령·응원·불 켜기로 주간 north-star(`ev`) +2, 오늘 걸린 수(`acct.wish`) +1.

### 확인하지 못한 가정

- 응원 보상과 주인 알림은 Room DO가 있는 isolate의 월드 사본(`cachedBoard`, 나이 검사 없음)을 본다. 그 사본이 점령보다 오래됐으면 `PAY` `why:'dark'`로 거절되고, 사본이 없으면 코인은 주지만 우편 줄의 받는 사람이 비어 우편함에 남지 않는다. 스크립트는 `dark`면 15초 뒤 두 번 다시 해 보고, 게스트 1 소켓에 `INBOX`가 오지 않으면 그 이유로 FAIL을 쓴다.
- 우편 대기열(`inboxQ`)은 Room 메모리에 있고 코인 정산 때만 나간다. 하이버네이션으로 메모리가 비면 그 줄은 사라진다.
- `GET /rt/inbox`는 `read_at`을 주지 않아 읽음 표시는 `/rt/inbox/read`의 `ok`만 본다(SKIP 한 줄).
