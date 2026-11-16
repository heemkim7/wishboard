# 상용 기반 설계 — 2026-11-15

기준 커밋 `59d054a`. 이 문서는 그 위의 작업 트리(브랜치 `commercial-build`)를 읽고 1–4단계의 이름·모양·순서를 고정한다. 전략 원문(`전광판_상용화_전략`)은 고치지 않는다. 감사 문서의 줄 번호는 `59d054a` 기준이라 쓰지 않고, 아래 식별자는 현재 심볼을 대조한 것이다.

구현 순서와 파일 겹침은 10장. 0단계는 다시 만들지 않는다.

## 1. 이미 닫힌 결정

- 첫 고객은 팬덤과 응원 모임이다. 스레드 창작자는 전광판 링크(`external_url`)로만 병행한다.
- 가짜 주인, 가짜 입찰, 가짜 동시접속은 없다. `fillRivals`와 `rival:`는 트리에 없다.
- 카카오 로그인은 범위 밖이다. 로그인은 지금처럼 Google(Supabase PKCE)과 아이디·이메일이다.
- 4단계는 설계만 한다. 슬롯은 현금으로 팔지 않는다. 코인 가격의 꾸미기만 상수로 적는다.
- `PLAN=paid`는 어떤 단계도 넣지 않는다. 유료 전환은 운영자 작업이다.

남은 결정과 이 설계의 기본값.

| 항목 | 기본값 |
| --- | --- |
| Workers 유료 전환 | 계획에 넣지 않는다. 푸시 크론과 칸별 PNG는 `env.PLAN === 'paid'`일 때만 돈다. |
| 실제 옥외 전광판 시상 | 이번 범위 밖. 비용·심의 확인 전 문구로도 안내하지 않는다. |
| 현금 결제 시점 | 관문 2 통과 후, 꾸미기만, 법무 확인 다음. 코드 없음. |
| 2026 수능 날짜 | 가정: 2026-11-19 하루. 시드는 운영자가 그 날짜를 확인한 뒤에만. |
| 2027 설 연휴 | 시드하지 않는다. `ops_events`에 운영 화면으로 넣는다. |
| 운영 DB의 `네온봇` 행 | 지우지 않는다. |
| 채널 버튼 | `GET /rt/here`의 `live`가 40 미만이면 HUD 채널 칩을 숨긴다. `p3-live`. |
| 나이 확인 | 이메일 가입의 만 14세 체크만 유지한다. |
| `sell_coins_to_advertiser` | 유지. 4단계 법무 목록에만 올린다. |
| 추첨 표시 이름 | 화면 문구는 `추첨`. `복권` `잭팟`은 `p1-economy`에서 뺀다. |
| 무료 첫 칸 | `STREET_8` `STREET_9` `STREET_10` `STREET_11`. |
| 환불 80%, 불 켜기 72시간, 하루 1회 | 이 문서의 수. 보존 규칙(4.1)은 바꾸지 않는다. |
| 응원 12문구 | 6.7의 목록. |
| 잔상 닉 | 켠다. 계정 id는 보내지 않는다. 방당 8명, 10분. |

## 2. 0단계 계약 (트리에 있음)

이후 단계는 이 이름을 유지한다. 어긋난 곳만 이 절 끝에 적는다.

**보너스.** `Room.bonus(a, kind, amount, nick)`. 소켓 `{t:'BONUS', kind, amount, nick}`. 스펙 표의 한 칸은 `[cap, gapMs]` 또는 `[cap, 0, nPerKstDay]` 또는 `[cap, -1]`(계정당 1회).

| kind | 스펙 | 의미 |
| --- | --- | --- |
| `attend` | `[30, 0, 1]` | 계정·KST 하루 1회, 1회 ≤ 30 |
| `mission` | `[15, 0, 3]` | 계정·KST 하루 ≤ 3회, 1회 ≤ 15 |
| `pouch` | `[30, 25000]` | 1회 ≤ 30, 간격 ≥ 25초 |
| `quest` | `[100, 0, 4]` | 하루 ≤ 4회, 1회 ≤ 100 |
| `hello` | `[BALANCE.firstCoins, -1]` | `firstCoins`는 40, 계정당 1회 |
| `lounge` | `[3, 9000]` | |
| `stunt` | `[10, 15000]` | |
| `hive` | `[3, 4500]` | |
| `draw` | `[300, 240000]` | 아직 클라 신고. 1단계에서 막는다 |

게이트는 Room SQLite `ag(uid, k, d, v)`이고, 방 이동 때 `Meter` 인스턴스 `acct`의 `seat` / `evict`로 따라간다. 웹소켓 메시지마다 DO를 더 부르지 않는다.

**세계.** `readWorld`의 JSON은 `billboards`, `plots`, `ranks`, `today: { visitors, wishes }`. `visitors`는 KST 하루 동안 광장에 앉은 계정 수(`Meter.visit` → `tal.k = 'v'`), `wishes`는 성공한 점령 수(`tal.k = 'w'`). 캐시 갱신(15초)마다 DO 1회.

**계정 이전.** `authEnv()`는 `{ inApp, android, handoverUrl, intent }`. 티켓이 없으면 두 문자열은 `''`. `POST /rt/handover`는 그 게스트의 유효한 `g1` 토큰(Authorization Bearer)에만 `h1` 티켓을 준다. 수명 `TICKET_S = 900`. `POST /rt/guest`는 `b.h`(티켓) 또는 `b.t`(기존 `g1`, 유예 180일)일 때만 같은 `sub`를 재발급한다. 그 외에는 새 `g-` UUID이며 `GUEST_RL`(IP당 60초 10회, `cf-connecting-ip`)을 탄다. 재발급과 핸드오버는 이 한도에 넣지 않는다.

**요금.** `FARE`는 `credit()`이 참을 반환한 뒤에만 `bumpFeverCount`. 금액은 `min(25, floor(amount))`가 1 이상의 정수일 때.

**링크 방문.** `ADCLICK`. `AD_PAY = 15`, `AD_DAY = 5`. 계정·슬롯·KST 하루 1회, 그리고 하루 5칸.

**푸시 동기화.** 연결 중 `/rt/wallet` `/rt/world`를 20초마다 폴링하지 않는다. 정산은 `{t:'WALLET_SYNC'}`, 칸·필지 변경은 `{t:'WORLD_UPDATE', kind:'BILLBOARD'|'PLOT', data, ranks?}`. `kind` 없는 `WORLD_UPDATE`는 다시 읽기 신호다. HTTP는 소켓이 `online`이 되는 순간 1회와, 소켓이 내려가 있는 동안 60초마다(`main.js` `resync`)만.

**측정.** `POST /rt/event` `{ name, sid, p }`. `name`은 `plaza-account.js` `EVENT_NAMES`. `sid`는 `[\w-]{8,40}`. `p`는 키 최대 6개(`^[a-z_]{1,16}$`, 문자열 40자 또는 유한 수). 계정은 Bearer에서만. `EVENT_RL`은 IP당 60초 600회. 저장은 Meter 인스턴스 `ev`의 `evt(id, t, sid, uid, k, p)`. 끝난 KST 날은 `daily.j`와 `ret(d0, off, n)`로 접고, 원시행은 `EV_KEEP = 14`일. `EV_STEP`은 `page_landing`, `enter_square`, `first_coin`, `board_claim`. `EV_RET`는 1, 7, 30. `session_end`의 `p.dur`(초, ≤ 86400)가 세션 길이. 읽기: `GET /rt/admin/stats?days=` 헤더 `x-admin-key` = `ADMIN_KEY` (`adminOk`). 쿼리 문자열에 키를 넣지 않는다.

**트리와 문구 계약이 다른 곳.**

- `bonus()`는 `feverScale`(2)을 cap과 금액에 곱한다. 피버 중 `attend`/`pouch` 상한은 60, `mission`은 30이다. 표의 30/15/30은 피버 전 값이다.
- `today`는 집계가 없어도 `{ visitors: 0, wishes: 0 }`으로 항상 있다. `paintBootLive`는 0과 누락을 화면에 쓰지 않고, 없는 세계 응답이면 `#bootLive`를 숨긴다. 동시 인원(`/rt/here` `live`)도 0이면 생략한다.
- `draw`는 클라가 5분 버킷으로 번호를 만들고 `{t:'BONUS', kind:'draw'}`를 보낸다. 서버 추첨이 아니다.
- 출석 사다리 `[10,12,15,20,30]`(`BALANCE.attend`)은 `kts_daily`에만 있다. 서버는 금액 ≤ 30, 하루 1회만 본다. 고친 클라는 매일 30을 받을 수 있다.
- `/rt/push`, `/rt/push/key`, `scheduled()`는 채플 잔여다. 본문 길이 0, `wrangler.jsonc`에 cron 없음, 게임 구독 없음.
- `wallets` SELECT는 공개이고 `holder_id`는 `/rt/world`에 있다.
- `BALANCE.starterSlots`는 `[]`.
- 관람: `timesSquare3d.js` `api.startLounge`가 `api.teleport(-21, -112)`를 호출하고, `main.js` `setLounge(true)`가 10초 `setInterval`로 `payBonus('lounge', 3)`을 시작한다.
- 부스트: `ui.sfx.boost`는 `tone()`이다. `main.js` `onBoost`가 호출한다.
- 인앱 로그인: `ui.openLogin`이 지역 `copy` 버튼을 만들고, `handoverUrl`이 있으면 클립보드, 실패하면 읽기 전용 input에 넣는다.
- 출석·미션은 `ui.payDue` → `hooks.bonus`가 참일 때만 `paid`에 기록한다. 복주머니는 `onBalloon`에서 `payBonus('pouch', 30)`이 참일 때만 지급 문구를 낸다.
- 퀘스트 `fare` `stunt` `cheer` `qPaid`는 `loadDay`가 같은 KST 날이면 유지한다.
- 계정 연결 시트는 `ui.pumpLink`가 `proof`·`sponsorEl`(도착 카드)·`cineOn`이  Quiet 한 뒤에만 연다. 닫기는 `closeSheet`다.
- 봇: `tools/plaza-bots.mjs` 기본 호스트 `http://localhost:8787`, 토픽 `chapelqa:square`. `wishboard.workers.dev`와 Supabase `yxddhpacuyaffaoutxjn`에서는 `--trade`가 켜지지 않는다.

## 3. 경제가 사는 곳

코인을 만드는 경로는 `Room`의 `addMine` / `credit` / `bonus`와, 이미 있는 RPC `coin_batch`, `grant_coins`(관리자), `merge_guest_account`의 `LINK_BONUS` 300, `spend_plaza`의 역방향이 아닌 차감뿐이다. 1단계 이후 반복 수입은 클라 금액이 아니라 이 문서의 표다.

요청 단가(검증: Cloudflare Workers 가격 문서, 2026-11-13 갱신, 2026-11-15 조회).

- Worker 요청: Free 하루 10만, Paid 월 1,000만 포함 후 100만당 $0.30. 정적 에셋 요청은 무료. `run_worker_first`에 걸린 경로는 Worker 요청이고, Free 한도를 넘으면 에셋으로 떨어지지 않고 429다.
- WebSocket Upgrade는 Worker 요청 1회. 이후 메시지는 Worker 요청이 아니다.
- DO 요청: Free 하루 10만, Paid 월 100만 포함 후 100만당 $0.15. 알람 1회 = 1요청. 들어오는 WS 메시지는 과금만 20:1(100메시지 = 5요청). 게임 Meter(`add`)는 이 과금 단위를 세며, 80% lean, 95% hard. Free 예산 `DAY 100000`, `GBS 13000`은 `worker.js` `FREE`와 같다.
- DO 지속시간: Free 하루 13,000 GB-s, Paid 월 400,000 GB-s 후 100만 GB-s당 $12.50. 하이버네이션 중인 방은 지속시간 0. 사람이 있으면 알람이 깨운다(연결 중 60초, 대기·미정산 5초). 이 주기는 유지한다.
- 서브리퀘스트: Free 50, Paid 1만. CPU: Free 10ms, Paid 기본 30초·최대 5분, 크론은 Paid에서 최대 15분.
- 계정 크론: Free 5개, Paid 250개. 이 Worker의 cron은 오늘 0개다. 계정의 나머지 몫은 가정(확인 안 함).
- 정적 파일 1개 ≤ 25 MiB (Free·Paid 동일, 검증).

새 기능의 요청. “DO”는 과금 요청, “W”는 Worker 요청, “SB”는 Supabase RPC(Worker 서브리퀘스트)다.

| 메커니즘 | 자리 | 요청 |
| --- | --- | --- |
| 반복 지급·세션·요금·피버·곡선 | Room DO, 기존 소켓 | 메시지에 포함. 방 이동 때 `acct` 1회(이미 있음). 추가 폴링 없음. |
| 추첨 당첨 번호 | Meter `lotto` | 방당 버킷(5분)당 DO 1회. 8방이면 시간당 약 96. |
| 출석 사다리 | RPC `touch_attend` | 계정·하루 SB 1회. 실패하면 `ag`에 그날 횟수를 올리지 않는다. |
| 점령·환불·지주·무료 첫 칸·S 검수 | RPC `claim_billboard` 한 트랜잭션 | 지금과 같이 점령 1회당 SB 1회 + 방마다 `WORLD_UPDATE`(최대 8 DO). |
| 불 켜기 | RPC `relight_billboard` | 계정·칸·하루 SB 1회. 코인 이동 없음. |
| 수신함 | RPC `inbox_batch`를 코인 flush에 붙임 | flush당 SB 1회. 온라인 수신자는 기존 `nudge`(DO 2회). |
| 웹 푸시 | `scheduled` + `push_subs` | 크론 1회 = W 1. 발송 ≤ `PUSH_N`(40). Paid일 때만. |
| 프로필·장착 | 입장 시 RPC `ensure_profile` | 입장 SB 1회. 이후 5분은 `acct` 메모리. 메시지마다 읽지 않는다. |
| 소속 점수 | Room `ag`에 모았다가 flush | 멤버·하루 SB 1회 이하. |
| 21시 공 | Room 알람이 경계를 넘겨 `{t:'BALL'}` | 방당 하루 DO 2회(열림·닫힘) + 입장 `ok`에 플래그. |
| 운영 달력 | `readWorld`에 `ops` 한 줄 | 세계 캐시 갱신에 포함. 요청을 늘리지 않는다. |
| 북극성 `touch` | Meter `ev` | 계정·ISO 주 1회 DO 쓰기. |
| 카드 HTML/PNG | `GET /rt/card/...` | 스크랩 1회 = W 1 + DO 1(캐시 적중 시 DO 읽기만). |

## 4. 충돌 규칙

각 항목은 규칙 한 줄이다. 구현은 그 다음이다.

### 4.1 불 켜기, 만료, 보호, 80% 환불, 지주 50%

규칙: 한 트랜잭션에서 지갑에 더해지는 코인은, 이름 있는 수원(3장 표, `hello`, `touch_attend`, `quest`, `grant_coins`, 연결 300)이거나, 그 트랜잭션에서 이미 뺀 금액 이하다. 만료·불 켜기·보호 연장은 코인을 움직이지 않는다.

- 점령 때 낸 코인은 그때 소각이 원칙이다. 만료로 돌려주지 않는다.
- `relight_billboard(p_key, p_actor_id, p_slot_id)`: 호출자가 현 보유자이거나(소속 칸이면 `tribe_members`) 보호 여부와 무관하게, KST 하루·칸 1회. `lit_until = now() + interval '72 hours'`, `lit_on = (timezone('Asia/Seoul', now()))::date`, 그날 처음이면 `lit_days = lit_days + 1`, `profiles.reputation = reputation + 1`. `protected_until`과 `current_bid`는 그대로. `expires_at = lit_until`로 맞춰 옛 클라의 `live()`가 유지 중을 살아 있다고 보게 한다.
- 보호(`protected_until`): S 120분, B 60분, C 30분, `user:`이면 + `LINKED_PROTECT_MIN`(5). 불 켜기는 보호를 늘리지 않는다. 보호 중 타인 점령은 거절.
- 살아 있고(`lit_until > now()`) 보호가 끝난 칸을 빼앗으면 최소 입찰은 `max(slot_floor, current_bid + 50)`, 독점이면 지금처럼 1.5배. 새 입찰 `B`를 구매자에게서 뺀다. 이전 보유자 환불 `R = min(B, prev_bid * 80 / 100)` (정수 나눗셈). 남은 `B - R`의 절반 `C = (B - R) / 2`는 `PLOT_*`이고 필지 주인이 있으며 그 주인이 구매자·이전 보유자가 아닐 때만 주인에게. 나머지 `B - R - C`는 소각. `R + C ≤ B`.
- 빈 칸·`lit_until`이 지난 칸은 최저가. 환불 0. `PLOT_*` 지주 몫은 지금과 같이 `B / 2`.
- 같은 보유자의 문구 수정(`p_mode = 'edit'`): 입찰을 올리지 않으면 차감 0, 환불 0, 지주 0. 자기 입찰을 올리면 증액분만 빼고, 그 증액의 절반이 `PLOT_*` 지주 몫이다.
- 무료 첫 칸은 차감 0, 지주 0이다. 합성 지주 수익을 만들지 않는다.
- `add_billboard_spent`: `holder_id`가 바뀌면 `spent += NEW.current_bid`. 같은 보유자가 입찰만 올리면 `spent += NEW.current_bid - OLD.current_bid`. `expires_at`만 바뀌면 `spent`를 올리지 않는다. 불 켜기가 순위를 만들지 않게 한다.
- S급 검수 거절은 빼앗김이 아니다. 그 리뷰의 `bid`를 1회 그대로 돌려준다(4.6). 80% 식을 쓰지 않는다.
- 사진 요금 환불(`review_billboard_photo`)은 지금처럼 대기 중 요금을 낸 사람에게 되돌린다. 새 수원이 아니다.

예시. `PLOT` 이전 입찰 200, 새 입찰 250, 지주는 제3자. 구매자 −250, 이전 보유자 +160, 지주 +45, 소각 45.

### 4.2 메인 타워 경매

규칙: `MAIN_UP` `MAIN_TOP` `MAIN_MID` `MAIN_BOT` `MAIN_LOW`의 신규 점령과 빼앗김은 KST 21:00:00 이상 21:10:00 미만(`ball_open`)에만 성립한다.

`claim_billboard`와 Worker가 둘 다 검사한다. SQL은 `(timezone('Asia/Seoul', now()))::time`. 창 밖 코드는 `auction_closed`. 같은 보유자의 `edit`·`relight`는 창 밖에도 된다. B·C 칸은 하루 종일. 개인 피버와 볼 배율은 `min(2, fever × ball)`로 겹치고, 그 다음에 곡선(8장)을 곱한다. 창이 닫힌 뒤의 S급 `pending` 리뷰는 승인될 수 있다. 21:10:00에 도착한 새 점령은 실패한다.

### 4.3 무료 첫 칸과 게스트 양산

규칙: 무료 칸은 계정마다 1회이고, 새 게스트 발급은 `GUEST_RL`을 그대로 타며, 같은 IP의 무료 점령은 KST 하루 3회다.

- `BALANCE.starterSlots = ['STREET_8','STREET_9','STREET_10','STREET_11']`. `starterBid` 30은 어떤 바닥가로도 쓰지 않는다.
- `p_mode = 'starter'`, `p_bid = 0`, 칸이 그 목록에 있고, 비어 있거나 `lit_until`이 지났고, `profiles.starter_slot`이 null일 때만.
- 계정 조건: `user:`이거나, Room `ag`에 `hello`가 이미 있다(소켓으로 첫 지급을 받은 뒤). 토큰만 만든 게스트는 불가.
- IP 한도: `acct`의 `ag` 키 `sip`, `d` = KST 날, 값 ≤ 3. IP 원문은 저장하지 않고 `SHA-256(ip + GUEST_KEY)`의 앞 16 hex만 키로 쓴다. 기존 2일 삭제(`dayShift - 2`)에 맡긴다.
- 성공 시 `profiles.starter_slot`에 칸 id. 보호·만료(불 켜기 전)는 C급과 같다.

### 4.4 공유 미리보기와 정적 호스팅

규칙: 칸마다 다른 OG는 정적 파일로 올리지 않는다. `/rt/*`는 이미 `run_worker_first`라 Worker가 HTML을 만들고, 이미지는 Meter에 둔다. 묶음 용량을 늘리지 않는다.

- `GET /rt/card/:slot` 과 `GET /rt/card/:slot.png`. `slot`은 `SLOT_RE`.
- HTML은 항상 200. `og:title` = 보유자 이름과 `line1`(이스케이프, 각 16자). `og:description` = `line2`. `og:image` = 같은 오리진의 PNG 절대 URL. `og:url` = 이 카드 URL. `<meta http-equiv="refresh" content="0;url=/?focus=SLOT">` 와 본문 링크. `gift=1`이면 목적지에 `&gift=1`. `ref`가 있으면 `&ref=`.
- PNG는 `cardpng.js` `renderCardPng({ name, line1, line2, line3, tier })` → `Uint8Array`. 600×315, DOM·캔버스·Node 모듈 없음. Meter 인스턴스 `cards`에 `slot + updated_at`로 저장, 칸당 ≤ 40KB, 최대 61장.
- `env.PLAN !== 'paid'`이면 PNG를 그리지 않고 `og:image`를 기존 정적 `/og.jpg`로 둔다. 제목·설명에는 칸 문구가 들어간다.
- 사람이 복사하는 주소는 `https://studio.wishboard.workers.dev/rt/card/STREET_8`. `index.html` 자체는 정적 에셋이라 `/?focus=`만으로는 칸별 OG가 되지 않는다.
- 카카오·슬랙·트위터 스크래퍼가 JS 없이 `og:image`의 JPEG/PNG만 읽는다는 점은 가정(이번 턴에 해당 문서를 열지 않음). SVG는 쓰지 않는다.
- 5초 세로 클립은 서버에 올리지 않는다. `share.js` `saveClip(canvas)`가 `MediaRecorder`가 있으면 9:16·5초를 기기에 저장하고, 없으면 기존 `capture()` JPEG다. iOS 인앱에서 `MediaRecorder`가 없다는 점은 가정이다.

### 4.5 웹 푸시

규칙: Node 라이브러리 없이 Worker WebCrypto만 쓴다. iOS는 홈 화면 웹앱에서만 구독한다.

검증(WebKit 글 13878, Apple “Sending web push notifications”, 2026-11-15 조회): iOS·iPadOS 16.4+의 Web Push는 홈 화면에 추가된 웹앱(`display`가 `standalone` 또는 `fullscreen`)뿐이다. 권한은 사용자 제스처에서만. iOS Safari 탭에서는 요청할 수 없다. 엔드포인트는 `*.push.apple.com`. Apple 문서: 보이지 않는 푸시는 허용되지 않고, 서비스워커가 받자마자 알림을 띄우지 않으면 권한이 취소된다. macOS Safari 16의 일반 웹페이지 푸시와 iOS 탭을 같은 것으로 보지 않는다.

- 지금 `vapidAuth`는 ECDSA P-256 JWT와 빈 본문이다. 게임 알림은 RFC 8291 `aes128gcm` 본문을 WebCrypto(ECDH, HKDF, AES-GCM)로 만든다. npm `web-push`는 넣지 않는다. 이 암호화가 Workers에서 된다는 점은 가정이고, `node --check`와 테스트의 벡터로 확인한다.
- 구독 `POST /rt/push` `{ s: { endpoint, keys: { p256dh, auth } } }` Bearer. 호스트는 기존 `PUSH_HOSTS`. 저장은 `push_subs`이지 Meter `grp`가 아니다. `DELETE /rt/push` `{ e }`.
- `push.js` `subscribePush()`는 클릭 핸들러 안에서만 `Notification.requestPermission`과 `pushManager.subscribe`를 호출한다. `display-mode: standalone`이 아니면(iOS 탭) 구독 대신 “홈 화면에 추가한 뒤 이 버튼을 누르세요”를 보여 준다. `manifest.webmanifest`의 `display`는 `standalone`을 유지한다.
- 본문 템플릿은 `kind`마다 서버 고정 문자열이다(6.6). 사용자 문구를 넣지 않는다.
- `scheduled`는 `env.PLAN !== 'paid'`이면 즉시 return 한다. Free CPU 10ms 안에 암호화 발송 40건이 들어간다는 보장은 없다(가정: 들어가지 않음). 유료 전환 전에는 수신함 GET이 알림의 전부다.
- 크론은 `p1-return`이 `5 * * * *`(매시 5분, UTC) 하나. Paid일 때 구독 중 어두운 칸·안 읽은 `taken`/`cheer`를 `PUSH_N`까지 보낸다. 404·410은 삭제.

### 4.6 검수 최소선과 S급 사전 검수

규칙: 닉·세 줄·에어 한 줄·필지 간판은 `BAN_WORDS`에 걸리면 거절한다. 링크는 `LINK_HOSTS`만 저장한다. S급은 `pending`인 동안 이전 화면이 남고, 거절하면 그 입찰을 100% 되돌린다.

- 목록은 `plaza-account.js`에 둔다. Worker와 클라가 같은 모듈을 쓴다. 클라는 미리 알리고, 서버가 거절한다.
- `BAN_WORDS`: 최소 집합을 `p1-moderation`이 한글·영문 소문자 부분문자열로 채운다. 이 설계는 단어를 창작하지 않는다. 빈 배열로 출고하지 않는다.
- `LINK_HOSTS`: `instagram.com`, `www.instagram.com`, `threads.net`, `www.threads.net`, `youtube.com`, `www.youtube.com`, `youtu.be`, `m.youtube.com`, `smartstore.naver.com`. 호스트가 목록과 같거나 그 접미사(`\.` + 호스트)일 때만. 나머지는 null.
- 신고: `{t` 없음. `POST /rt/report` `{ slot, reason }` `reason` ∈ `abuse` | `ad` | `impersonation` | `other`. 자유 텍스트 없음. 계정·칸·KST 하루 1회(`reports` 유니크 인덱스).
- 에어(`spend_plaza`의 전광판 장악 문구)와 닉에도 같은 금칙어.
- S급 `claim`은 행을 바로 바꾸지 않고 `billboard_reviews`에 `pending`으로 넣고 `bid`를 뺀다. 승인 `review_slot_claim(p_key, p_id, true)`가 4.1의 빼앗김 식을 적용한다. 거절은 `status`를 `rejected`로 바꾸고 그 `bid`를 구매자에게 더한다. 조건은 행이 `pending`일 때 한 번. 관리자 내리기 `takedown_billboard`는 문구를 `운영자가 내렸습니다` / `''` / `''`로 바꾸고 URL을 지운다. 입찰은 되돌리지 않는다(이미 뺀 돈).
- 사진 승인 흐름(`review_billboard_photo`, `admin.html`)은 유지한다.

### 4.7 응원과 자유 채팅

규칙: 응원은 `CHEER_PHRASES`의 번호만 보낸다. 15자 입력칸은 없앤다. `{t:'E', k, e:1~4}`는 그대로 이모트다.

`plaza-account.js`:

```js
export const CHEER_PHRASES = Object.freeze([
  '응원해요', '오늘도 빛나요', '이름이 보여요', '같이 걸어요',
  '대단해요', '축하해요', '힘을 내요', '보고 있어요',
  '최고예요', '내일도 켜요', '우리 편이에요', '타임스퀘어에 걸렸어요',
]); // index 0 → 소켓 p = 1
```

소켓 `{t:'CHEER', slot, p}` `p`는 1–12, `slot`은 `SLOT_RE`. 서버는 문구를 저장하지 않고 `p`만 본다. 보유자 자신, 꺼진 칸, 12초 미만 재전송은 거절. 지급은 8장. 수신함 `kind:'cheer'`, `phrase:p`, `from_name`(12자). 계정 id는 수신함 행의 수신자에만 있고 다른 클라로 나가지 않는다.

### 4.8 방문자 잔상과 공개 id

규칙: 잔상 패킷에는 닉과 좌표만 있다. `actor_id`를 넣지 않고, 순위·지갑·전광판의 기존 `holder_id`를 이 패킷으로 복제하지 않는다.

Room이 소켓을 닫을 때 첨부된 닉이 있으면 메모리 링(최대 8, 10분)에 넣는다. `{t:'GHOST', name, x, y}`. `name`은 이미 자른 12자. 입장 `ok.h`에 같은 모양으로 최대 8개. Supabase·`localStorage`·`/rt/world`에는 쓰지 않는다. 닉이 기본 랜덤이어도 지어내지 않은 그 닉을 쓴다. 보행자 인스턴스(`p3-feel`)에는 이름을 붙이지 않는다. 빈 칸 그림은 `ts3d/screens.js` `defaultData(slotId)`(칸 이름, 최저가, `holder_id: null`)를 유지하고, 운영 행이 있으면 `line2`만 `ops.copy`로 바꾼다.

### 4.9 아바타 색과 `Main`

규칙: 이름표 색은 재질 이름이 `Main`인 메시에만 칠한다. 털·배·발 재질의 이름을 `Main`으로 바꾸지 않는다.

- `ts3d/avatars.js`의 `Avatar` 순회는 `o.material?.name === 'Main'`일 때만 `setColor`한다. 이 조건을 넓히지 않는다.
- 이름표 글자색은 `paintNameTag` 캔버스에 둔다. 발밑 링은 로컬 플레이어 장식이며 이름표 색 경로가 아니다.
- `speciesId`는 `p2-identity`에서 1·2·3을 받고 그 외는 1을 반환한다. `SPECIES`에 `{id:2, label:'고양이'}`, `{id:3, label:'곰'}`을 넣는다. 클립 이름은 `Idle` `Walking` `Running` `Dance` `Sitting` `Wave` `Jump` `ThumbsUp` `Yes` `No` 그대로.
- 꾸미기 재색은 재질 `Coat` `Fur` `Belly` `Paw`만. 고양이·곰 GLB에 `Main`이 있으면 그 메시 이름을 위 넷 중 하나로 바꾼다. `Mousey`의 `Ch14_Body`는 `Main`으로 바꾸지 않는다.
- 서버가 입장 시 내려 준 `av`(1|2|3)와 `equip`(코스메틱 id, 최대 4개)만 표시한다. `tr`로 받은 `av`/`equip`은 Room이 프로필 캐시로 덮어쓴다.

## 5. 데이터 모델

`schema.sql`은 통째로 다시 실행한다. `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS`, `CREATE INDEX IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`. `DROP TABLE` 없음. 시그니처가 바뀌는 함수는 `DROP FUNCTION IF EXISTS`로 그 시그니처만 지운 뒤 만든다. 12인자 `claim_billboard`는 두지 않은 채 남겨 둔다(Worker는 `caption_y` 오버로드를 호출한다). 그 오버로드에 끝 인자 `p_mode TEXT DEFAULT 'claim'`을 추가하려면 기존 `(text, text, text, text, bigint, text, text, text, text, text, text, text, integer)`를 DROP한 뒤 14인자로 만든다. 인자의 뜻은 지금과 같고 `p_mode` ∈ `claim` | `edit` | `starter` | `tribe`.

RLS: 아래 새 표는 활성화하고 공개 SELECT 정책을 만들지 않는다. Worker는 지금처럼 publishable 키 + `SECURITY DEFINER` RPC + `app_secrets.FLUSH_KEY`다. `service_role`은 코드에 넣지 않는다.

### 5.1 `profiles` (2단계, 출석 열은 1단계 `p1-return`이 먼저 추가)

```sql
CREATE TABLE IF NOT EXISTS public.profiles (
  actor_id TEXT PRIMARY KEY REFERENCES public.wallets(actor_id) ON DELETE CASCADE,
  level INT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 99),
  reputation INT NOT NULL DEFAULT 0 CHECK (reputation >= 0),
  species SMALLINT NOT NULL DEFAULT 1 CHECK (species BETWEEN 1 AND 3),
  ring_color TEXT NOT NULL DEFAULT '#ff3d9a',
  starter_slot TEXT,
  attend_streak INT NOT NULL DEFAULT 0,
  attend_last DATE,
  tribe_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`level = least(99, 1 + reputation / 10)`. `reputation`은 불 켜기 하루당 +1. 플레이 시간 곡선은 이 표에 쓰지 않는다(8장, Room `ag`).

### 5.2 보관함·꾸미기 (`p2-identity`)

```sql
CREATE TABLE IF NOT EXISTS public.cosmetics (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('hat','cab','frame','emote')),
  season TEXT,
  grant_via TEXT NOT NULL CHECK (grant_via IN ('attend7','shop','season','tribe'))
);
CREATE TABLE IF NOT EXISTS public.inventory (
  actor_id TEXT NOT NULL REFERENCES public.wallets(actor_id) ON DELETE CASCADE,
  cosmetic_id TEXT NOT NULL REFERENCES public.cosmetics(id),
  equipped BOOLEAN NOT NULL DEFAULT false,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, cosmetic_id)
);
```

시드(`ON CONFLICT DO NOTHING`): `hat_ribbon`(hat, attend7), `cab_yellow`(cab, attend7), `frame_streak`(frame, attend7). 7일 연속 출석(`attend_streak`이 7의 배수로 갱신되는 날)에 `inventory`에 없으면 한 번 넣는다. 같은 `kind`의 `equipped true`는 하나. RPC `equip_cosmetic(p_key, p_actor_id, p_cosmetic_id)`.

상점 가격은 표로 만들지 않는다. `balance.js` `SHOP`(9장). 현금 상품 표는 `schema.sql`에 넣지 않는다.

### 5.3 코인 원장

```sql
CREATE TABLE IF NOT EXISTS public.coin_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id TEXT NOT NULL,
  delta BIGINT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN (
    'mine','fare','bonus','claim','refund','landlord','photo','photo_refund',
    'sell','spend','link','admin','lottery','starter'
  )),
  ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coin_ledger_actor_idx ON public.coin_ledger (actor_id, created_at DESC);
```

`coin_batch` 항목에 `reason`을 선택으로 더한다. 없으면 `mine`. 점령 RPC는 `claim`(음수), `refund`, `landlord`를 같은 트랜잭션에 넣는다. 보너스 개별 틱은 원장에 쓰지 않고, flush된 `mine`/`bonus` 한 줄로 남긴다. `starter`는 delta 0의 표식 행이다.

### 5.4 전광판 이력·불 켜기 열

```sql
ALTER TABLE public.billboards ADD COLUMN IF NOT EXISTS lit_until TIMESTAMPTZ;
ALTER TABLE public.billboards ADD COLUMN IF NOT EXISTS lit_on DATE;
ALTER TABLE public.billboards ADD COLUMN IF NOT EXISTS lit_days INT NOT NULL DEFAULT 0;
ALTER TABLE public.billboards ADD COLUMN IF NOT EXISTS cheers INT NOT NULL DEFAULT 0;
ALTER TABLE public.billboards ADD COLUMN IF NOT EXISTS frame TEXT;

CREATE TABLE IF NOT EXISTS public.billboard_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slot_id TEXT NOT NULL,
  holder_id TEXT,
  holder_name TEXT,
  line1 TEXT, line2 TEXT, line3 TEXT,
  bid BIGINT NOT NULL DEFAULT 0,
  event TEXT NOT NULL CHECK (event IN (
    'claim','takeover','edit','relight','clear','takedown','reject','starter'
  )),
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billboard_history_slot_idx ON public.billboard_history (slot_id, at DESC);
```

일회 이전(다시 실행해도 같음): `UPDATE public.billboards SET lit_until = expires_at WHERE lit_until IS NULL`. 보유자가 있고 `lit_until`이 과거면 다음 점령 또는 크론 `clear`가 `holder_id`를 비우고 `event = 'clear'`를 남긴다. 코인 이동 없음. `p2-relight` 전에는 `expires_at`이 수명의 기준이다(S 720분, B 360분, C 180분). `p2-relight`부터 수명은 `lit_until`이고, 점령 직후 `lit_until = now() + 72 hours`, `lit_days = 1`.

### 5.5 수신함·푸시

```sql
CREATE TABLE IF NOT EXISTS public.inbox (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('taken','cheer','dark','gift','tribe','ball')),
  slot_id TEXT,
  phrase SMALLINT,
  from_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS inbox_actor_idx ON public.inbox (actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.push_subs (
  endpoint TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

계정당 수신함 50행. 넘는 분량은 같은 INSERT에서 오래된 것부터 지운다. 푸시 템플릿: `taken` “{from_name}님이 {slot}을 가져갔어요”, `cheer` 문구 목록의 그 줄, `dark` “{slot} 불이 곧 꺼져요”, `gift` “{from_name}님이 전광판을 선물했어요”, `tribe` “이번 주 소속 결과가 나왔어요”, `ball` “21시 볼 드랍이 곧 시작돼요”. `{slot}`은 `slotName`.

### 5.6 소속·시즌·운영 달력

```sql
CREATE TABLE IF NOT EXISTS public.tribes (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9]{8}$'),
  tag TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  roof_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.tribe_members (
  tribe_id TEXT NOT NULL REFERENCES public.tribes(id),
  actor_id TEXT NOT NULL REFERENCES public.wallets(actor_id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','owner')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id)
);
CREATE TABLE IF NOT EXISTS public.tribe_pool (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tribe_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  week TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.tribe_scores (
  tribe_id TEXT NOT NULL,
  week TEXT NOT NULL,
  points INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tribe_id, week)
);
CREATE TABLE IF NOT EXISTS public.seasons (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  theme TEXT NOT NULL CHECK (theme IN ('csat','xmas','newyear','seollal','valentine'))
);
CREATE TABLE IF NOT EXISTS public.ops_events (
  id TEXT PRIMARY KEY,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  theme TEXT NOT NULL CHECK (theme IN ('csat','xmas','newyear','seollal','valentine')),
  title TEXT NOT NULL,
  copy TEXT NOT NULL
);
```

- 소속은 계정당 하나. `tag`는 `#[0-9A-Za-z가-힣_]{1,16}`에서 `#`을 뺀 표시 이름과 같다. id는 서버가 만든 8자.
- 모금: `pledge_tribe`가 멤버 지갑에서 빼고 `wallets`의 `tribe:<id>`에 더한다(이전). 주가 바뀌고 그 주 풀이 점령에 쓰이지 않으면 `refund_tribe_week`가 낸 사람에게 100% 되돌린다(이전). 점령은 `p_mode = 'tribe'`, 지불 계정 `tribe:<id>`, `holder_id = 'tribe:' || id`, `holder_name`은 `tag`. 빼앗기면 환불은 그 지갑으로 간다.
- 점수: 멤버·KST 하루 응원 1, 불 켜기 1, 점령 5. 상한 7. `isoWeek()`(Worker에 있음)가 `week`.
- 일요일 KST 21:00(`p3-live` 크론)에 그 주 1위의 `roof_until = now() + 7 days`. 동점이면 `tribe_id` 사전순. 점수 행은 지우지 않는다. 1위가 없으면 지붕 이름을 비운다.
- `ops_events` 시드 없음(수능 날짜는 미확인). `readWorld`는 KST 오늘과 겹치는 행 하나를 `ops: { id, theme, title, copy }`로 넣는다. 없으면 필드 생략.
- `seasons` 시드 한 행만, 날짜가 확정된 뒤 `p3-live`가 넣는다: `s1-2027`, `starts_on 2027-01-01`, `ends_on 2027-01-28`, `theme newyear`, title `새해 소원`. 그 전까지 INSERT 하지 않는다.

### 5.7 검수·추첨·참조 코드

```sql
CREATE TABLE IF NOT EXISTS public.reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slot_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('abuse','ad','impersonation','other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS reports_day_idx
  ON public.reports (slot_id, reporter_id, ((created_at AT TIME ZONE 'Asia/Seoul')::date));

CREATE TABLE IF NOT EXISTS public.billboard_reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slot_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  bid BIGINT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lottery_draws (
  bucket BIGINT PRIMARY KEY,
  winning SMALLINT NOT NULL CHECK (winning BETWEEN 1 AND 15),
  drawn_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS ref_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS wallets_ref_code_idx ON public.wallets (ref_code) WHERE ref_code IS NOT NULL;
```

`lottery_draws`는 감사·재시작용이다. 권위는 Meter `lotto`이고, 번호를 정한 뒤 한 번 INSERT한다(`ON CONFLICT DO NOTHING`). 티켓 표는 만들지 않는다. 티켓은 Room `ag` 키 `lot:<bucket>`이다.

`ensure_ref_code`: `ref_code`가 없으면 8자 `[a-z0-9]`를 넣어 유니크 위반 시 다시 뽑는다. `/rt/world`의 select 목록(`actor_id, nickname, spent, linked`)에 `ref_code`를 넣지 않는다. 카드 라우트만 RPC로 `{ ref, holder_name, line1, line2, line3, tier, updated_at }`를 받는다.

### 5.8 미니게임 세션 (Room SQLite, schema.sql 아님)

```sql
create table if not exists sess(
  id text primary key,
  uid text not null,
  kind text not null,
  t0 integer not null,
  x integer not null,
  z integer not null
);
```

`kind` ∈ `bake` | `dance`. 요금은 세션 표 대신 `PICK` 카운터(7장). 방 이동 때 세션은 버린다(처음부터).

## 6. API와 소켓

기존 경로 유지: `/rt/health` `/rt/config` `/rt/gate` `/rt/world` `/rt/here` `/rt/wallet` `/rt/guest` `/rt/handover` `/rt/claim-billboard` `/rt/buy-plot` `/rt/sell-coins` `/rt/spend` `/rt/flush-wallet` `/rt/billboard-photo` `/rt/share-bonus` `/rt/redeem-code` `/rt/event` `/rt/auth/merge` `/rt/auth/withdraw` `/rt/ws` `/rt/snap` `/rt/photo/` `/rt/admin/*` `/rt/grp` `/rt/sponsor`.

위치 패킷 `v2: {t:'P', k, a:[x,y,...]}`와 `{t:'E', k, e:1~4}`는 바꾸지 않는다. 좌표는 `toNetUnits` / `fromNetUnits`, `floor = 0`. 내 아바타 위치는 로컬 입력만.

### 6.1 새로 보내는 소켓 (클라 → Room)

| t | 본문 | 응답 |
| --- | --- | --- |
| `SESS` | `{kind:'bake'\|'dance', op:'start'}` | `{t:'SESS', id, ok}` |
| `SESS` | `{id, op:'end', result}` | `{t:'PAY', kind, amount}` 또는 `{t:'SESS', ok:false}` |
| `PICK` | `{}` | 없음. 거절도 조용히. |
| `FARE` | `{slot}` | 성공 시 `{t:'PAY', kind:'fare', amount}` |
| `CHEER` | `{slot, p}` | 성공 시 `{t:'PAY', kind:'cheer', amount}` |
| `BONUS` | 기존 | `p1-economy` 이후 `draw`는 무시. `attend` `mission` `quest` `hello` `pouch` `lounge` `stunt` `hive`는 금액 무시하고 서버 표만. |
| `QUEST` | `{key:'fare'\|'cheer'\|'stunt'}` | 조건 달성 시 `{t:'PAY', kind:'quest', amount, key}` |

`result`: bake는 `miss`|`good`|`gold`, dance는 정수 0–100.

### 6.2 서버 → 그 소켓·방

| t | 모양 | 누구 |
| --- | --- | --- |
| `PAY` | `{t:'PAY', kind, amount, key?}` | 받은 소켓만. 클라 `creditNow(amount)`는 이 프레임에서만. |
| `BALL` | `{t:'BALL', open:boolean, until:ms}` | 방 전체. `until`은 창이 열려 있으면 21:10 KST의 epoch ms, 아니면 다음 21:00. |
| `WELCOME` | `{t:'WELCOME', name}` | 방 전체. 이름 16자. id 없음. 티커 8초. |
| `GHOST` | `{t:'GHOST', name, x, y}` | 그 방. x,y는 넷 단위. |
| `INBOX` | `{t:'INBOX', kind, slot_id, phrase, from_name}` | 수신자가 앉아 있을 때. |
| `DRAW` | `{t:'DRAW', bucket, win, hit, amount}` | 그 계정. `amount`는 0 또는 25. |
| `WALLET_SYNC` `WORLD_UPDATE` | 기존 | 기존 |

`p1-economy`가 `PAY`를 넣기 전에는 0단계처럼 `sendBonus`가 참이면 클라가 바로 `creditNow` 한다. `PAY`를 켜는 커밋이 그 낙관을 같은 kind에서 지운다. 둘 다 두면 두 번 오른다.

### 6.3 HTTP

| 메서드 경로 | 본문·응답 |
| --- | --- |
| `POST /rt/claim-billboard` | 기존 필드 + `mode`. 응답에 `review_id`가 있으면 S급 대기(칸은 그대로). |
| `POST /rt/relight` | `{ slot }` → `{ ok, lit_until, lit_days }` |
| `POST /rt/report` | `{ slot, reason }` → `{ ok:true }` |
| `GET /rt/inbox` | `{ items: [{ id, kind, slot_id, phrase, from_name, created_at }] }` 최대 20, 미읽음 우선 |
| `POST /rt/inbox/read` | `{ ids: number[] }` |
| `POST /rt/tribe` | `{ tag }` 생성 또는 `{ id }` 가입 → `{ tribe_id, tag }` |
| `POST /rt/tribe/pledge` | `{ slot, amount }` amount ∈ 10, 20, 50 |
| `GET /rt/card/:slot` | 4.4 HTML |
| `GET /rt/card/:slot.png` | PNG 또는 404 |
| `GET /rt/admin/stats` | 기존 + `week_touch` (그 ISO 주의 `touch` 행 수) |
| `GET /rt/admin/reports` | `{ items }` `x-admin-key` |
| `POST /rt/admin/review` | `{ id, approve:boolean }` S급 |
| `POST /rt/admin/takedown` | `{ slot }` |
| `POST /rt/admin/ops` | `{ id, starts_on, ends_on, theme, title, copy }` `copy` ≤ 80자, 금칙어 적용 |

관리자 경로는 모두 `adminOk`. `FLUSH_KEY`를 URL에 두지 않는다.

세션 위치 검사(미터, `LAYOUT`):

- bake 시작: 마지막 `P`가 `LAYOUT.stall` (21, 118)에서 12m 안. 종료는 시작 후 8–40초. `miss` 0, `good` 6, `gold` 16.
- dance 시작: `LAYOUT.stage.spot` (0, 366)에서 8m 안. 종료 25–40초. ≥90이면 12, ≥75이면 8, ≥55이면 4, 그 외 2.
- `PICK`: 직전 `PICK` 또는 요금 이후 ≥ 20초, 그리고 마지막 `P`가 그 이전 `PICK`의 위치에서 ≥ 15m. 요금 사이에 최대 4회(승객 1–5).
- `FARE`: 열린 `PICK`이 1개 이상, 직전 요금 이후 ≥ 40초, `slot`은 `SLOT_RE`. 금액 = `round(20 * train[riders-1] * revenge * feverBall)`. `train`은 기존 `[1, 2.2, 3.8, 6, 10]`. `riders = 1 + 추가 PICK`. 계산 후 `PICK`을 비운다. 클라 `amount`는 없다.

## 7. 클라 모듈

새 파일은 `index.html`의 `main.js?v=`와 `main.js`의 import 쿼리를 같은 값으로 올린다. 새 모듈 import에도 `?v=`를 붙인다. `ts3d/nycmeta.js`는 손대지 않는다.

| 모듈 | 내보내는 함수 | 담당 |
| --- | --- | --- |
| `ftue.js` | `startFtue(ctx)`, `claimWizard(slot)`, `lockCelebration(ms)` | 포차 웨이포인트, 3단계 점령, 5초 잠금 |
| `share.js` | `cardUrl(slot, opts)`, `copyCard(slot)`, `saveClip(canvas)` | 카드 URL, 복사, 5초 클립 |
| `push.js` | `installHint()`, `subscribePush()` | 설치 안내, 구독 |
| `inbox.js` | `loadInbox()`, `applyInboxPush(msg)` | 자리 비운 요약 |
| `tribe.js` | `openTribe()`, `sendCheer(slot, phraseId)`, `pledge(slot, amount)` | 소속, 문구 응원, 모금 |
| `profile.js` | `loadProfile()`, `equip(cosmeticId)`, `setSpecies(id)` | 레벨, 보관함, 종 |
| `audio.js` | `startMusic(id)`, `play(name)`, `haptic(ms)` | 음원 3, 효과 20, 진동 |
| `live.js` | `applyBall(msg)`, `applyOps(ops)` | 21시 표시, 운영 배너 |
| `cardpng.js` | `renderCardPng(card)` | Worker와 노드 테스트가 같이 씀 |

`ctx`는 `{ ui, world, net, balance }`. `balance`는 `balance.js`의 `BALANCE`.

`ui.js`는 시트·HUD를 유지하고, 위 모듈이 부르는 `openClaimStep(n, model)`, `setNextLine(text)`, `setQuietBlock(on)`만 추가한다. `setQuietBlock(true)`인 5초 동안 `pumpLink`와 푸시 동의·미션 시트는 열리지 않는다. 축하를 닫아도 `focusSlot`과 `sponsorEl`은 그대로다.

`main.js`는 import와 이벤트 연결만 늘린다. 경제 숫자는 `balance.js`에만 둔다.

`startFtue`: 입장 후 카메라 인트로가 끝나면 `setWaypoint`로 `LAYOUT.stall`. 첫 `SESS` bake `PAY`가 오면 화살표를 지운다. `claimWizard` 단계: (1) 칸 고르기, 무료 칸을 위에 (2) 세 줄·이모지·테마 (3) 확인. 확인 버튼은 시트 하단 `position: sticky`. 모바일 세로의 “다음 할 일” 한 줄은 `setNextLine`이고, 화면에 상시로 두는 HUD는 지갑·조이스틱·점령·응원·관람 다섯을 넘기지 않는다(`p1-ftue`가 세로에서 겹치는 칩을 접는다).

환영 문구는 칸을 덮어쓰지 않는다. 입장 후 Room이 `{t:'WELCOME'}`를 보내고 `setTicker`로 8초 보여 준다.

## 8. 수치 하나

활동 시간의 목표 구간은 600–1,200코인/시간이다. 곡선은 KST 달력의 0시–1시가 아니다. Room `ag` 키 `play`, `d` = KST 날, 값은 그날 인정된 반복 지급의 초. 초가 3,600 미만이면 배수 1.00, 이상이면 0.30. 자정(KST)에 그 키가 자연히 바뀐다.

반복 지급 1회에 더하는 초: bake 8, dance 25, fare 40, cheer 12, lounge 10, star 10, stunt 15, hive 15, pouch 25, sidewalk 0.

```
scaled = floor(base * curve * min(2, (fever ? 2 : 1) * (ball_open ? 2 : 1)))
```

슬라이딩 60분 창(`ag` 키 `eht` = 창 시작 epoch초, `ehs` = 그 창의 반복 코인 합, `d` = `''`, 방 이동 시 `agAll`로 따라감). 창 상한 1,200. `ball_open` 동안 발생한 지급만 상한 1,600. `scaled`가 남은 한도를 넘으면 한도까지만 주고, 0이면 `{t:'PAY', amount:0}`도 보내지 않는다. 시계가 정각을 넘는 틈은 이 창으로 막는다.

곡선·피버·볼·창 상한을 타지 않는 것: `attend`, `mission`, `quest`, `hello`, 연결 300, `ADCLICK`, 공유 촬영 5, 환불, 지주 몫, 사진 요금 반환, 모금 반환, 관리자 `grant_coins`.

| 원천 | kind / base | 문 | 성실한 1시간 횟수 | 100% 코인 | 30% 코인 |
| --- | --- | --- | --- | --- | --- |
| 붕어빵 성공 | `good` 6 | 세션 8–40초, 포차 12m, 시간당 ≤ 40 | 20 | 120 | 36 |
| 붕어빵 정중앙 | `gold` 16 (good 대체) | 같은 세션 | 5 | 80 | 24 |
| 택시 1명 | `fare` 20 × train[0] | `PICK`·40초·시간당 ≤ 15 | 12 | 240 | 72 |
| 응원 | `cheer` 4 | 문구 1–12, 남 칸, 12초, 시간당 ≤ 30 | 20 | 80 | 24 |
| 댄스 | `dance` 12/8/4/2, 표는 8 | 세션 25–40초, 시간당 ≤ 6 | 4 | 32 | 10 |
| 관람 | `lounge` 2 | 20초, 시간당 ≤ 30. 0단계의 `[3, 9000]`을 이 값으로 바꾼다 | 20 | 40 | 12 |
| 별 | `star` 6 | 시간당 ≤ 8. 0단계 `starCoin` 8을 6으로 | 6 | 36 | 11 |
| 링 | `stunt` 8 | 20초, 시간당 ≤ 8. 0단계 10·15초를 이 값으로 | 6 | 48 | 14 |
| 하이파이브 | `hive` 2 | 15초, 시간당 ≤ 12. 0단계 3을 2로 | 6 | 12 | 4 |
| 바닥 코인 | `MINE` amount 1만 유지 | 기존 2초 12개, 시간당 ≤ 30코인 | 20 | 20 | 6 |
| 복주머니 | `pouch` 20 | 0단계 상한 30·간격 25초는 유지하고, 추가로 시간당 ≤ 4, KST 하루 ≤ 8 | 4 | 80 | 24 |
| 추첨 기댓값 | `lottery` 적중 25, 아니면 0 | 버킷 5분, 계정당 티켓 1장(인정된 요금이 버킷의 첫 장), 번호 1–15 | 12버킷 | 20 | 6 |

성실한 100% 합은 808이다. 전부 상한까지, 정중앙만 구우면 시간당 합이 1,200을 넘을 수 있고 그때 창이 1,200에서 자른다. 택시 train·복수·피버는 식을 거친 뒤 같은 창을 탄다. 함성 `MINE` amount 2와 5–15의 클라 금액을 `p1-economy`가 거절한다(바닥 코인 1만 남긴다).

하루 한 번·계정 한 번(시간당 표 밖):

| 원천 | 금액 |
| --- | --- |
| `hello` | 40, 계정 1회 |
| `attend` | `touch_attend`가 `[10,12,15,20,30]` 후 30. 어제 `attend_last`면 streak+1, 아니면 1. 하루 1회 |
| `mission` | 15, 키 `earn`(반복 코인 30) `bake`(세션 1) `cheer`(응원 1), 하루 ≤ 3 |
| `quest` | `fare` 50 (서버 `PICK` 완료 3), `cheer` 30 (응원 3), `stunt` 40 (링 2), `all` 100. 진행은 `ag` `qf` `qc` `qs`. 클라 금액 무시 |
| `ADCLICK` | 15, 칸·하루 1, `AD_DAY` 5 |
| 연결 | 300, `merge_guest_account` |
| 공유 촬영 | 5, 하루 1 (`shareShot`) |

0단계 `draw` cap 300·간격 240000과 클라 번호는 `p1-economy`에서 제거한다. 서버가 Meter `lotto`에 버킷당 `crypto.getRandomValues`로 1–15를 하나 저장하고, 방금 지난 버킷의 티켓과 같으면 `PAY` 25를 보낸다. 티켓 없는 참가 지급은 없다.

S급 최저가(4,000 / 3,000 / 2,000 / 1,500 / 1,200)는 유지. 시간당 800이면 하루 1시간 플레이는 `MAIN_UP`까지 여러 날이고, 8명이 한 시간 모으면 타워 한 칸이 된다. 슬롯 개수 61과 바닥가는 `balance.js` `SLOTS`와 `slot_floor`가 맞다.

## 9. 4단계 (설계만, 코드·시드 없음)

`SHOP` 초안, 코인만: `hat_ribbon` 400, `cab_yellow` 800, `frame_streak` 600. 시즌 패스는 코인 2,000, `spend_plaza` reason `pass`, 그 시즌 `cosmetics.season`을 `inventory`에 넣는다. 현금 SKU, 슬롯 판매, 스폰서 칸 판매는 만들지 않는다. 스폰서 칸이 필요하면 관리자 SQL로 `billboards`에 표시만 하고 이 저장소 마이그레이션에는 넣지 않는다.

법무 확인 목록(구현 없음): 게임물 등급분류, `sell_coins_to_advertiser`의 이용자 간 이전, 추첨 확률 고지(버킷당 1/15, 상금 25를 화면에 표시하는 일이 이미 1단계에 있다), 만 14세, 사진·스냅샷 초상, 상표(타임스퀘어·브랜드 문구). `legal.js`의 유료 서비스 문장과 “코인은 현금이 아니다”를 이 목록에 맞춰 고치는 일은 유료화 착수 때다.

## 10. 계획 색인

다른 에이전트가 아래 12파일을 쓴다. 구현 순서는 파일명 순서가 아니다. `worker.js`, `schema.sql`, `ui.js`, `main.js`, `timesSquare3d.js`는 한 번에 한 계획만 고친다.

| 순서 | 파일 | 손대는 파일 | 앞선 계획 |
| --- | --- | --- | --- |
| 0 | `docs/superpowers/plans/2026-11-15-p0-trust-recovery.md` | 2장의 트리. 통합은 `?v=`와 노드 테스트 | 없음. 다시 구현하지 않고 검증·통합만 |
| 1 | `docs/superpowers/plans/2026-11-15-p1-economy.md` | `worker.js` `schema.sql` `balance.js` `main.js` `test/plaza.test.mjs` | 0. `claim_billboard`·`bonus`를 먼저 고정 |
| 2 | `docs/superpowers/plans/2026-11-15-p1-moderation.md` | `worker.js` `schema.sql` `plaza-account.js` `admin.html` `ui.js` | 1. 같은 RPC |
| 3 | `docs/superpowers/plans/2026-11-15-p1-ftue.md` | `ftue.js` `ui.js` `main.js` `timesSquare3d.js` `balance.js` `index.html` | 2. 마법사가 보내는 문구가 검수를 통과해야 함 |
| 4 | `docs/superpowers/plans/2026-11-15-p1-share.md` | `share.js` `cardpng.js` `worker.js` `ui.js` `plaza-account.js`(이벤트 이름만) | 3. 축하 다음에 공유 |
| 5 | `docs/superpowers/plans/2026-11-15-p1-return.md` | `push.js` `inbox.js` `sw.js` `worker.js` `schema.sql` `wrangler.jsonc` | 4. 축하 → 공유 → 알림 동의. `profiles.attend_*` |
| 6 | `docs/superpowers/plans/2026-11-15-p2-relight.md` | `schema.sql` `worker.js` `timesSquare3d.js` `ui.js` | 1 이후 전부. `claim_billboard`를 다시 염 |
| 7 | `docs/superpowers/plans/2026-11-15-p2-identity.md` | `schema.sql` `worker.js` `profile.js` `ts3d/avatars.js` `ui.js` | 6. `reputation`은 `lit_days`에서 |
| 8 | `docs/superpowers/plans/2026-11-15-p2-tribe.md` | `schema.sql` `worker.js` `tribe.js` `ui.js` | 7. `profiles.tribe_id` |
| 9 | `docs/superpowers/plans/2026-11-15-p3-live.md` | `worker.js` `wrangler.jsonc` `admin.html` `live.js` `timesSquare3d.js`(볼 연출만) | 8. 지붕 이름은 그 주 소속. 5의 크론 뒤에 크론을 추가 |
| 10 | `docs/superpowers/plans/2026-11-15-p3-feel.md` | `audio.js` `timesSquare3d.js` `ui.js` `index.html` `sw.js` | 9. 같은 3D 파일 |
| 11 | `docs/superpowers/plans/2026-11-15-p4-monetize.md` | 없음. 이 문서 9장과 5.2를 읽고 법무 목록과 `SHOP`을 계획 문서에만 적는다 | 구현 금지. 문서 작업은 9·10과 병렬 가능 |

겹침 세부.

- `plaza-account.js`: 금칙어·문구·링크 호스트는 2번만. `EVENT_NAMES`에 `share_send` `focus_enter`는 4번, `relight` `cheer` `push_on`은 그 기능을 넣는 계획(6, 2의 소켓 응원이 이미 `cheer`를 쓰면 2번이 `cheer`를 넣는다)만 추가한다.
- `wrangler.jsonc` 크론: 5번이 `5 * * * *` 하나(`scheduled`는 `PLAN !== 'paid'`면 return). 9번이 `50 11 * * *`(KST 20:50 예고)와 `0 12 * * *`(KST 21:00 개막·주간 마감)를 더한다. 합계 3. Free 계정 한도 5 안. `triggers`를 통째로 덮어쓰지 않고 항목을 추가한다.
- `admin.html`: 2번(신고·S급·내리기), 9번(운영 달력).
- `test/plaza.test.mjs`: 서버를 건드리는 계획이 순서대로 케이스를 추가한다. `CAP` 50, `MAIN_S` 없음, 프로덕션 호스트 요청 없음.
- `timesSquare3d.js`: 3번 화살표·축하 카메라, 6번 내 칸 빛기둥·미니맵 핀, 9번 볼, 10번 보행자·세로 관람·연출. 10번은 `{t:'BALL'}` 처리 함수를 바꾸지 않고 연출만 붙인다.
- `ui.js`: 2 → 3 → 4 → 5 → 6 → 7 → 8 → 10. 9번은 `ui.js`를 열지 않는다.
- 0단계가 넣은 `GUEST_RL` `EVENT_RL` `today` `h1` 티켓 `PAY` 이전의 `payBonus` 동작을 되돌리지 않는다.

북극성 쓰기: 1번이 Meter `ev`에 `touch(week text, uid text, primary key(week, uid))`를 만들고 점령 성공 때 한 줄. 2번 응원 성공, 6번 불 켜기 성공이 같은 표에 `INSERT OR IGNORE`. 선물 점령은 `board_claim`의 `p.gift = 1`인 점령으로 이미 포함된다.

## 11. 규약

- `AGENTS.md`: Meter 80/95, Room 하이버네이션·무인 시 알람 해제, 위치 패킷, `net.js` 1.15초 데드레커닝, `/rt/guest` HMAC(`GUEST_KEY`, Supabase 익명 가입으로 바꾸지 않음), 내 위치는 로컬만, `toNetUnits`/`fromNetUnits`, `floor = 0`, 자유 채팅 없음, 재질 `Main`만 이름표 색, OSM만, `nycmeta.js` 수동 편집 없음, `.dev.vars`·시크릿·`service_role` 커밋 없음, OSM 캐시는 `%TEMP%/kts/osm`.
- 테스트는 `node test/plaza.test.mjs`, `node test/taxi-detach.test.mjs`, `node tools/account.test.mjs`, 그리고 순수 함수 파일이면 `node tools/account.test.mjs`처럼 `assert` 스크립트. `package.json`을 만들지 않는다. 테스트는 점령·지급으로 프로덕션 Supabase에 쓰지 않고, `https://studio.wishboard.workers.dev`를 호출하지 않는다. 로컬 `wrangler dev`도 프로덕션 DB를 본다.
- 스키마는 5장의 멱등 규칙. 로컬에서 SQL을 운영 DB에 실행하지 않는다.
- 캐시: `index.html`의 `main.js?v=`와 JS import 쿼리를 함께 올린다. `sw.js`의 에셋 캐시 이름도 에셋이 바뀌면 올린다.
- 배포·시크릿·`PLAN=paid`·채플 Worker(`studio`라는 이름이라도 `cf_release.py`와 `masil-chapel-seoul`)는 이 계획들의 일이 아니다.
- 좌표 원점 7번가 × W 45th, 북쪽 −Z, 동쪽 +X. 채널 `chapel:square` … `chapel:square-8`, `CAP` 50.

## 12. 전략 7장 관문 → 측정

실사용자 500명은 `ev`의 `seen`에서 `enter_square`를 가진 계정이 500명인 시점이다(`funnel`에 enter 비트가 있는 계정). 북극성은 그 ISO 주의 `touch` 행 수(점령, 불 켜기, 응원. 선물은 점령에 포함).

`GET /rt/admin/stats`의 하루 객체는 지금 `evStats`가 주는 `day, visitors, new, returning, anon, sessions, len_avg, len_med, funnel[4], funnel_new[4], events, ret{1,7,30}`에 `statsFromCounts`를 더한 것이다. `funnel` 순서는 landing, enter, first_coin, claim. `ret[n]`은 그 날의 신규가 n일 뒤 돌아온 수이고, 그 날이 지나기 전에는 null이다. `len_avg`는 초.

`p1-share`가 `evSum`에 계정 수를 더한다: `share_accounts`(그날 `share_send`), `claim_accounts`(그날 `board_claim`), `focus_new`(그날 신규이면서 `focus_enter`). 이벤트 `focus_enter`의 `p`는 `{ slot, ref }`. `ref`는 `ensure_ref_code`의 8자이고 계정 id가 아니다.

| 관문 | 식 | 목표 |
| --- | --- | --- |
| 첫 화면 → 입장 | 최근 7일의 `funnel[1] / funnel[0]` | ≥ 0.60 |
| 첫 접속 → 점령 | `funnel_new[3] / funnel_new[1]` | ≥ 0.40 |
| 점령자 중 공유 | `share_accounts / claim_accounts` | ≥ 0.15 |
| 다음 날 | `ret[1] / new` | 관문 1 ≥ 0.25, 관문 2 ≥ 0.35 |
| 7일 | `ret[7] / new` | ≥ 0.08, 관문 2 ≥ 0.15 |
| 30일 | `ret[30] / new` | 관문 2 ≥ 0.06 |
| 체류 | `len_avg` | ≥ 480 (8분) |
| 초대 1회가 데려오는 신규 | `focus_new / share_accounts` | 관문 2 ≥ 0.3 |
| 북극성 | `week_touch` | 정의만. 숫자 목표는 기준선 생기기 전엔 두지 않는다 |

`EV_STEP`의 4칸 뜻은 바꾸지 않는다. 공유·재방문은 별도 필드다. 분모가 0이면 그 관문은 “데이터 없음”이지 0% 실패가 아니다.

## 13. 플랫폼 사실 표시

검증(문서를 이번 세션에 연 것): Workers Free/Paid의 요청·CPU·서브리퀘스트·DO 요청·DO GB-s·정적 파일 25 MiB·정적 요청 무료·`run_worker_first`의 Free 429·크론 계정 한도·WS 과금 20:1·Paid $5와 포함량. iOS 16.4+ Web Push는 홈 화면 웹앱만, 제스처 필요, `*.push.apple.com`, 빈 푸시 금지(Apple 문서).

저장소로 확인: `ratelimits` period는 10 또는 60초(`wrangler.jsonc` 주석). 공식 rate-limit 페이지는 이번 턴에 다시 열지 않았다.

가정: 카카오 등 스크래퍼의 PNG 요구, 무료 10ms 안에 푸시 40건·카드 PNG가 들어가지 않음, `MediaRecorder`의 기기 차이, RFC 8291을 WebCrypto만으로 구현할 수 있음, 이 Cloudflare 계정에 크론 슬롯이 3개 더 있음, 2026 수능이 11월 19일.

## 14. 0단계 이후에도 손대지 않는 것

가짜 보유자, 카카오 로그인, 슬롯의 현금 판매, `PLAN=paid`, 운영 DB SQL 실행, 프로덕션 점령, `nycmeta.js` 수동 수정, 자유 입력 채팅, 채플 DB `masil-chapel-seoul`.
