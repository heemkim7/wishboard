# 봇 막기 (2026-11-22)

질문: "손님에게 공짜 코인을 주면 봇이 한꺼번에 붙어 서버를 마비시킬 수 있지 않나? 봇을 막는 로직이 있나? 없으면 만들어라. 어떻게 막나?"

짧은 답:

- 막는 장치는 전에도 꽤 있었다(아래 1번 표). 새 손님은 주소당 1분 10명, 손님 코인은 남에게 보낼 수 없고, 계정에 이어 붙여도 도착 코인 140은 첫 손님 것만 넘어가고, 하루 예산이 95%를 넘으면 광장이 스스로 닫힌다.
- 빈틈은 세 갈래였다. (가) 손님을 만드는 문 자체에 사람 확인이 없고, IPv6 주소를 바꿔 가며 끝없이 만들 수 있었다. (나) 한 손님 토큰으로 한 방에 소켓을 끝없이 열거나, 메시지를 퍼붓거나, 방 정산을 부르는 요청을 끝없이 보낼 수 있었다. (다) 하루 예산이 hard일 때도 이벤트 기록은 DO를 불렀다.
- 이번에 넣은 것: Cloudflare Turnstile(무료, 대개 보이지 않는 사람 확인)을 새 손님을 만들 때만 건다. 스위치 둘(`TURNSTILE_SITE`, `TURNSTILE_SECRET`)을 주인이 넣기 전에는 아무것도 바뀌지 않는다. 스위치와 상관없이 바로 켜지는 것: 네트워크(IPv6는 /64)마다 하루 새 손님 100명, 계정마다 1분 한도(`ACT_RL`), 방의 소켓 3개·도배 차단, hard에서 이벤트 DO 생략. 공유 보너스 300은 계정만 받는다.
- Worker 안에서 끝까지 못 막는 것: 주소를 아주 많이 가진 봇이 요청만 퍼붓는 것. Workers Free의 하루 요청 10만은 Worker가 거절한 요청도 세기 때문이다. 이것은 사용자 도메인 + WAF 속도 제한 규칙(Worker 앞에서 막는다)이나 유료 플랜으로 막는다(4번).

## 1. 이미 있던 것

| 장치 | 위치 | 막는 것 |
| --- | --- | --- |
| 게스트 토큰 HMAC(`g1`, `GUEST_KEY`) | `worker.js` `guestSign`/`guestVerify`, `/rt/guest` | 손님 id를 지어낼 수 없다. 다시 받기는 자기 토큰, 다른 브라우저로 넘기기는 넘김 표(`h1`)가 있어야 한다 |
| `GUEST_RL` 새 손님 1분 10명 | `wrangler.jsonc` ratelimits, `worker.js` `guestMint` | 한 주소에서 손님을 마구 찍기 |
| `GUEST_RL` 연결·탈퇴 1분 10번(계정 키) | `worker.js` `accountApi`(`merge:`/`withdraw:`) | 연결을 되풀이해 RPC와 DO를 부르기 |
| `EVENT_RL` 1분 600(주소) | 이벤트, 소원, 리그, 리포트, 초대, 공유 페이지 | 토큰 경로 도배 |
| `OPS_RL` 1분 20(네트워크) | `ops.js` `opsRate` | 오류 보고, 문의, 상태, 광고 신청 도배. 문의는 손님 전체 시간당 120 |
| 하루 예산 80% lean, 95% hard | `worker.js` `Meter.add`, `lvlNow`, `tallied`, Room `setLvl` | DO·요청이 늘면 스스로 줄이고, hard면 방이 모든 소켓을 닫는다 |
| 방 CAP 50 + 대기 줄, 한 계정 한 방 | Room `fetch`/`admit`, `Meter.seat`, `MOVE_N` 8 | 방이 넘치면 기다린다. 방 옮기기는 8번 뒤 30초에 한 번 |
| 소켓 75초 무응답 정리, 핑 자동응답 | Room `scan`, `setWebSocketAutoResponse` | 죽은 소켓이 자리를 차지하기 |
| 클라 방송 30/10초 | Room `RELAY_N` | `take`/`react`/`jump` 도배 |
| 반복 코인 상한 | Room `addMine`·`bonus`·`fare`, `balance.js` `PAY` | 시간당 1,200(1시간 뒤 30%), 동전 2초 간격, 복주머니 하루 8 등 |
| 하루·계정 한 번 보상 | Room `ag` 표 | hello 40, 출석, 미션, 퀘스트, 링크 클릭 |
| 무료 첫 칸 하루 3번 | `Meter.sipTake` | 한 연결에서 무료 칸 독차지. 손님은 방에서 hello를 받은 뒤에만(`hasHello`) |
| 코인 보내기·모금 하한 | `floorGate`, `SEND_FLOOR` 580 | 손님은 못 보내고, 계정도 선물 코인은 못 보낸다 |
| 연결 시작 코인 가드 | `stTake`/`stFirst`, `merge_guest_account` | 여러 손님을 한 계정에 이어 붙여 도착 코인 140씩 모으기, 탈퇴 뒤 재가입 300 |
| 공유 보너스 하루 1번(계정·주소) | `promo`, `Meter.promoTake` | 하루 300을 여러 번 |
| 코드 입력 한 번(계정+코드) | `Meter.codeTake` | 같은 코드 되풀이 |
| 소원 | `Meter.wPost`/`wHeart`/`wReport`, `wish.js` `WISH` | 하루 한 줄, 하트 계정당 5·네트워크당 소원마다 3, 상금은 하트 5와 네트워크 3 이상, 새 소원 네트워크당 하루 20, 금칙어 |
| 초대(`INVITE_ON`) | `invite.js` `INVITE` | 초대한 사람 하루 5·평생 50, 초대받는 네트워크 하루 1·평생 3, /24·/48 하루 5 |
| 편집·불 켜기·사진 간격 | `gapHit` 3초, `PHOTO_GAP` 10초 | 공짜 편집 도배 |
| Supabase 익명 가입 | Supabase Auth 설정 | 꺼져 있다(`/auth/v1/settings`의 `anonymous_users: false`, 2026-11-22 확인). 켜지 마라 |

## 2. 빈틈과 한 일

| 빈틈 | 왜 문제인가 | 한 일 |
| --- | --- | --- |
| 새 손님에 사람 확인이 없다 | 손님 하나마다 100+40코인, 무료 칸 하나, 소켓, 하트·신고 한 표. 스크립트로 얼마든지 | Turnstile(스위치 둘, 아래 3번). 켜면 새 손님은 Cloudflare 확인 토큰이 있어야 생긴다 |
| `GUEST_RL`·무료 칸·공유 보너스가 주소 그대로를 키로 쓴다 | IPv6 한 줄(/64)은 주소가 2^64개라 주소만 바꾸면 한도가 없다 | 셋 다 네트워크 키(IPv4 그대로, IPv6 /64, `ipNet`) |
| 새 손님 하루 한도가 없다 | 1분 10명이면 한 주소에서 하루 14,400명 | 네트워크마다 KST 하루 100명(`GUEST_DAY`, `acct`의 `gmt`). Worker 변수 `GUEST_DAY`로 바꾸고 `0`이면 끈다 |
| 공유 보너스를 손님도 받는다 | 손님 농사 → 하루 300 | 계정만(주인 결정). 손님은 403 `account`, 화면은 계정 연결 안내 |
| 한 계정이 한 방에 소켓을 끝없이 연다 | 손님 토큰 하나로 방 50자리를 채워 진짜 사람을 대기 줄로 민다 | 한 계정 한 방 3개, 넷째가 오면 가장 오래된 것을 닫는다 |
| 소켓 하나가 메시지를 끝없이 보낸다 | 위치·리액션·프레즌스가 방 전원에게 퍼지고 메시지가 예산을 태운다 | 10초 120개를 넘기면 닫고 그 계정은 60초 그 방에 못 들어온다. 리액션 10초 30, 프레즌스 10초 20 |
| 소켓을 열고 닫기를 되풀이한다 | 입장마다 Worker 요청 + 방 DO + 자리 DO | 계정마다 1분 60번(`ACT_RL` `ws:`) |
| 광장 쓰기(`/rt/flush-wallet`, `/rt/spend`, 점령, 분양, 보내기)에 한도가 없다 | 요청마다 방 정산(DO)과 RPC | 계정마다 1분 60(`ACT_RL` `plaza:`) |
| 푸시 등록, 신고, 받은 소식 읽음, 프로필·꾸미기 쓰기, 사진 올리기, `/rt/grp`에 한도가 없다 | 요청마다 DO나 RPC, 사진은 900KB | 계정마다 1분 60(`ACT_RL` `misc:`) |
| `GET /rt/snap/<id>`가 아무 id로나 DO를 부른다 | 토큰 없이 DO 호출 | `EVENT_RL` 먼저 |
| hard에서도 `/rt/event`가 DO를 부른다 | hard에서 DO를 줄인다는 규칙 위반 | hard면 DO 없이 `{ ok:true, kept:false }` |

`ACT_RL`은 새 바인딩이다(`wrangler.jsonc`, namespace `4712`, 1분 60). 배포하면 생긴다. 키가 계정 id라서 PC방·학교처럼 한 주소를 나눠 쓰는 사람끼리는 서로 막지 않는다. 봇이 이 한도를 피하려면 계정(손님)을 많이 만들어야 하고, 그 문을 위의 Turnstile·하루 한도가 지킨다.

남겨 둔 것(결정이 필요하거나 다른 작업과 겹친다):

| 남은 것 | 내용 | 제안 |
| --- | --- | --- |
| 요청 폭주 | Workers Free는 하루 요청 10만이고 Worker가 거절한 요청도 센다. 주소가 많은 봇이 `/rt/config` 같은 것을 퍼부으면 그날 Worker가 멈춘다 | 사용자 도메인을 붙이고 WAF 속도 제한 규칙(예: `/rt/*` 주소당 10초 100)과 Bot Fight Mode. WAF가 막은 요청은 Worker를 부르지 않는다. 아니면 Workers Paid |
| 이메일 가입이 메일 확인 없이 바로 된다 | Supabase `mailer_autoconfirm: true`. 계정을 찍어 내면 연결 보상 300(계정마다 한 번, 손님 하나 필요)과 공유 보너스 300(하루, 네트워크마다)을 받는다 | Supabase Auth의 CAPTCHA(같은 Turnstile을 쓸 수 있다). 켜면 가입·로그인 요청에 `captchaToken`이 있어야 해서 로그인 시트(`net.js` `passwordAuth`)를 같이 고쳐야 한다. 지금 다른 작업이 그 코드를 바꾸는 중이라 이번에는 손대지 않았다. 코드 먼저, 그다음 Supabase 설정 |
| VIP 코드(`VIP_CODES`, 10,000코인)를 손님도 쓴다 | 코드가 새면 손님마다 10,000 | 계정만 받게 할지 정한다(공유 보너스와 같은 한 줄) |
| 소원 신고 3표면 가려진다 | 네트워크 셋을 가진 봇이 남의 소원을 가릴 수 있다 | 관리자 화면에서 되살릴 수 있다. 문제가 되면 계정만 신고 |
| 분양 칸 입찰의 절반 지급 | 손님 코인이 땅 주인에게 간다(`claim_billboard`) | 알려진 길. 손님을 만드는 문이 좁아져 값이 커진다 |

## 3. Turnstile 켜기 (주인이 할 일)

스위치가 꺼져 있으면(기본) 화면은 Cloudflare 스크립트를 받지 않고, Worker는 `siteverify`를 부르지 않는다. 둘 다 넣는 순간 켜진다. 이 코드를 먼저 배포한 뒤에 넣는다.

### 3-1. 위젯 만들기

1. Cloudflare 대시보드(https://dash.cloudflare.com)에서 이 Worker가 있는 계정으로 들어간다.
2. 왼쪽 메뉴 `Turnstile` → `Add widget`.
3. 이름: 아무거나(예: `wishboard guest`).
4. Hostnames: `studio.wishboard.workers.dev`와 `localhost` 두 개를 넣는다(사용자 도메인을 붙이면 그것도).
5. Widget Mode: `Managed`(권장. 대부분 보이지 않고, 수상할 때만 상자 하나를 누르게 한다) 또는 `Invisible`(절대 보이지 않는다. 대신 걸리면 그냥 실패한다). 화면은 어느 쪽이든 `interaction-only`로 그리고, 상자가 필요할 때만 아래 카드가 뜬다.
6. `Create`. Site Key(공개)와 Secret Key(비밀)가 나온다. Secret Key는 채팅·코드·커밋에 적지 않는다.

### 3-2. Worker에 넣기

비밀 키:

```
npx wrangler secret put TURNSTILE_SECRET
```

물으면 Secret Key를 붙여 넣는다. 바로 적용된다.

사이트 키(공개 값). 셋 중 하나만 쓴다(한 이름을 변수와 시크릿 둘로 두면 배포가 거절된다).

- 권장: `npx wrangler secret put TURNSTILE_SITE` 하고 Site Key를 붙여 넣는다. 공개 값이지만 시크릿으로 두면 다음 `npx wrangler deploy`에도 지워지지 않는다(`INVITE_ON`과 같은 방식).
- `wrangler.jsonc`에 `"vars": { "TURNSTILE_SITE": "<Site Key>" }`를 넣고 `npx wrangler deploy`. 키가 저장소에 남는다(공개 값이라 괜찮지만 커밋할지는 주인이 정한다).
- `npx wrangler deploy --var TURNSTILE_SITE:<Site Key>`. 배포할 때마다 붙여야 하고, 빠뜨리면 그 배포에서 Turnstile이 꺼진다.

끄기: `npx wrangler secret delete TURNSTILE_SECRET`(둘 중 하나만 없어도 꺼진다). 사이트 키 모양이 틀려도(`[\w-]{10,100}`가 아니면) 꺼진 것으로 본다.

### 3-3. 켰는지 보기

- `curl -s https://studio.wishboard.workers.dev/rt/config` 응답에 `"turnstile":"<Site Key>"`가 있다.
- `curl -s -X POST https://studio.wishboard.workers.dev/rt/guest -H "content-type: application/json" -d "{}"`가 403 `{"err":"human",...}`이다(새 손님을 만들지 않는다).
- 시크릿 창으로 사이트를 연다. 그냥 들어가져야 한다. 개발자 도구 Network에 `challenges.cloudflare.com/turnstile/v0/api.js`와 `/rt/guest` 두 번(403 다음 200)이 보인다. 이미 손님 토큰이 있는 브라우저는 확인 없이 다시 받기만 한다.
- Cloudflare 대시보드 Turnstile 위젯의 Analytics에 확인 수가 올라간다.
- `npx wrangler tail`에 `turnstile siteverify …` 경고가 계속 나오면 비밀 키가 틀렸거나 Cloudflare가 답을 못 준 것이다. 그동안에는 들여보내되 네트워크마다 1분 3명, 하루 10명으로 좁힌다.

### 3-4. 로컬에서 시험

`.dev.vars`(커밋하지 않는다)에 Cloudflare가 공개한 시험 키를 넣는다. 이것은 진짜 키가 아니다.

```
TURNSTILE_SITE=1x00000000000000000000BB
TURNSTILE_SECRET=1x0000000000000000000000000000000AA
```

- 사이트 키 `1x00000000000000000000BB`: 보이지 않고 늘 통과. `1x00000000000000000000AA`: 보이고 늘 통과. `2x00000000000000000000AB`: 늘 실패. `3x00000000000000000000FF`: 늘 상자를 누르게 한다.
- 비밀 키 `1x0000000000000000000000000000000AA`: 늘 통과. `2x0000000000000000000000000000000AA`: 늘 실패. `3x0000000000000000000000000000000AA`: 이미 쓴 토큰.
- 로컬 Worker도 운영 Supabase를 쓴다. 새 손님을 만들면 운영 DB에 지갑이 생긴다.

### 3-5. 켜면 달라지는 것

- 새 손님만 확인한다: 처음 온 사람, 로그아웃·탈퇴 뒤 새 손님, 180일이 지난 토큰. 이미 손님인 사람의 다시 받기, 넘김 링크, 로그인한 계정은 확인하지 않는다.
- 보통은 아무것도 보이지 않고 1~3초 늦게 들어온다. 상자가 필요하면 화면 아래 카드 `사람인지 잠깐 확인할게요. 아래 상자를 눌러 주세요.`가 뜬다.
- 실패하면 `사람인지 확인하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.`와 `다시 시도`(새로고침). 광고 차단기가 `challenges.cloudflare.com`을 막으면 여기서 멈춘다. 그 사람은 계정으로 로그인하면 들어올 수 있다.
- `tools/prod-e2e.mjs`는 브라우저가 아니라 새 손님을 못 만든다. 상태 파일의 살아 있는 손님(30일, 다시 받기 180일)을 쓰거나 그동안 끈다.

## 4. 요청 폭주까지 막으려면

Worker 안의 한도는 "거절"이지 "공짜"가 아니다. 거절한 요청도 Workers 요청 수에 들어간다. 한 줄이 아니라 아주 많은 주소에서 오는 폭주는 Worker 앞에서 막아야 한다.

1. 사용자 도메인을 Cloudflare에 붙이고 Worker 경로로 연결한다(workers.dev 주소에는 WAF 규칙을 걸 수 없다).
2. Security → WAF → Rate limiting rules: 예를 들어 URI 경로가 `/rt/`로 시작하면 주소당 10초에 100번 넘게 오면 막기. 무료 플랜도 규칙 하나는 된다.
3. Security → Bots → Bot Fight Mode 켜기.
4. 그래도 모자라면 Workers Paid(하루 10만 한도가 없어지고, `PLAN=paid` 예산 숫자를 쓸 수 있다).

## 5. 시험

- `node --test test/bot-guard.test.mjs`: 새 손님(스위치 꺼짐·켜짐, 토큰 없음·거절·통과·다른 action, `siteverify`가 판단 못 할 때 1분 3·하루 10, 다시 받기·넘김), `GUEST_RL` 네트워크 키, 하루 100과 `GUEST_DAY`, hard·DO 실패 때 열림, `mintTake`, `ACT_RL` 세 묶음, 사진 읽기 `EVENT_RL`, hard 이벤트, 방 소켓 3개·도배·리액션·프레즌스, 화면 `guestToken`(한 번의 확인을 같이 기다림, 실패, 하루 한도 뒤 10분), `human.js`(스크립트 한 번, 보이지 않게 그리기, 상자 카드, 실패와 다시 시도), VIP 시트의 계정 안내.
- `test/merge-guard.test.mjs`의 공유 보너스: 손님·익명 로그인 403 `account`(DO·RPC 없음), 계정 하루 한 번, IPv6 /64는 한 주소.
