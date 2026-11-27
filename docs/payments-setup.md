# 결제 설정 안내 (주문·결제, 샌드박스 먼저)

작성: 2026-11-27. 코드: `payrules.js`(규칙), `ordersrv.js`(서버), `payclient.js`(결제 시트), `admin-order.js`(운영 화면 🧾 주문·매출).
이 문서는 주인이 결제를 켜기까지 할 일을 순서대로 적은 것이다. **지금은 꺼져 있고, 켜기 전에는 손님에게 아무것도 보이지 않는다.**

## 지금 상태

| 무엇 | 상태 |
| --- | --- |
| 결제 스위치 `PAY_ON` | 없음(꺼짐). 정확히 `1`일 때만 켜진다. 꺼져 있으면 `/rt/order*`, `/rt/pay/hook`이 모두 404 `off`이고 `/rt/config`에 `pay`가 없다 |
| 모드 `PAY_MODE` | 없음 = `test`(테스트 채널, 돈이 나가지 않음). `live`일 때만 실결제 |
| 결제사 | 포트원(PortOne) V2. 키가 아직 없다 |
| 운영 화면 | `/admin`의 🧾 주문·매출은 켜기 전에도 보인다(상품 가격·혜택을 미리 고칠 수 있다) |
| 약관·방침 | '결제 방법(준비 중)', '결제(준비 중)' 조항을 넣었다. "지금은 결제를 받지 않는다"고 적혀 있어 켜기 전에도 사실이다. 켤 때 결제대행사 이름을 확정해 고친다 |

## 흐름

1. 손님이 결제 시트를 연다(`openCheckout({ boardId, kind })`). 시트는 가격(부가세 포함), 혜택, 취소·환불 규정, 테스트 모드면 '테스트 결제' 표시를 먼저 보여 준다.
2. `POST /rt/order`: 서버가 가격을 정한다(가격 실험 A/B안은 구매자마다 고정). 화면에 보인 가격과 다르면 409 `price`로 다시 확인받는다.
3. `POST /rt/order/<id>/pay`: 포트원 브라우저 SDK(`https://cdn.portone.io/v2/browser-sdk.js`, 결제 버튼을 누를 때만 불러온다)에 넘길 `storeId`, `channelKey`, `paymentId`(= 주문 번호), 금액, 주문 이름을 준다.
4. 결제창이 끝나면 `POST /rt/order/<id>/confirm`: 서버가 포트원에 `GET https://api.portone.io/payments/<paymentId>`로 다시 묻고, 상태 `PAID`, 금액이 주문과 같고, 통화 `KRW`일 때만 결제 완료로 바꾼다. 금액이 다르면 `FAILED`(운영자가 환불).
5. 포트원 웹훅 `POST /rt/pay/hook`: Standard Webhooks 서명(`webhook-id`, `webhook-timestamp` ±5분, `webhook-signature` v1 HMAC-SHA256)을 확인하고, 같은 `webhook-id`는 한 번만 처리하고, 본문은 믿지 않고 다시 묻는다. 휴대폰에서 결제창이 앱으로 넘어가 돌아오지 않아도 웹훅이 결제를 마무리한다.
6. 결제 완료 → 공개: 선물 전광판이면 주문을 그 전광판에 붙이고 혜택을 켠다(`PUBLISHED`). 실패하면 손님이 주문을 다시 열 때, 또는 운영자가 '다시 공개'를 누를 때 다시 해 보고, 3번 실패하면 `FAILED`(환불 대상).
7. 환불: 운영 화면에서 이유를 적고 '결제사로 환불' → 포트원 결제 취소(`POST /payments/<id>/cancel`) → 다시 물어 `CANCELLED`일 때만 `REFUNDED`. 포트원 콘솔에서 직접 취소해도 웹훅으로 `REFUNDED`가 된다. 계좌이체처럼 결제사를 거치지 않은 것은 '입금 확인(수동 결제)', '손으로 환불했음'으로 표시한다(이유 필수, 기록에 남음).

주문 상태: `CREATED → PAYMENT_PENDING → PAID → PUBLISH_PENDING → PUBLISHED`, 그리고 `FAILED`, `CANCELLED`, `REFUNDED`. 허용되는 이동은 `payrules.js`의 `MOVES` 표뿐이고, 모든 변경은 "지금 상태가 이것일 때만" 바꾸는 한 함수(`move`)로 하며 주문 기록(`order_events`)에 남는다.

## Worker 변수와 시크릿

모두 `npx wrangler secret put <이름>`으로 넣는다(값을 물으면 붙여 넣는다). 시크릿으로 두면 다음 `npx wrangler deploy`에도 지워지지 않는다(`INVITE_ON`과 같은 방식). 값은 채팅·코드·커밋에 적지 않는다.

| 이름 | 값 | 비밀? |
| --- | --- | --- |
| `PAY_ON` | `1`이면 켜짐. 없거나 다른 값이면 꺼짐 | 아님(시크릿으로 넣는 것은 배포에 지워지지 않게 하려는 것) |
| `PAY_MODE` | 없음 = `test`, `live` = 실결제. `mock`은 로컬(`localhost`)에서만 되는 가짜 결제사이고, 실서비스 주소에서는 결제가 꺼진다 | 아님 |
| `PAY_ALLOW` | 쉼표로 나눈 계정 번호(`user:…`). 테스트 모드에서는 여기 있는 계정만 결제 시트를 본다(비우면 아무도 못 봄). 실결제 모드에서는 비우면 모두, 적으면 그 계정만(조용한 오픈) | 아님 |
| `PORTONE_STORE_ID` | 포트원 콘솔의 상점 아이디(`store-…`) | 아님 |
| `PORTONE_CHANNEL_KEY` | 결제 채널 키(`channel-key-…`). 테스트 채널 키로 시작하고, 실결제 때 실연동 채널 키로 바꾼다 | 아님 |
| `PORTONE_API_SECRET` | 포트원 V2 API 시크릿(결제 조회·취소) | **비밀** |
| `PORTONE_WEBHOOK_SECRET` | 웹훅 시크릿(`whsec_…`) | **비밀** |

로컬에서 키 없이 끝까지 해 보려면 `.dev.vars`에 `PAY_ON=1`, `PAY_MODE=mock`을 넣고 `localhost`로 연다(가짜 결제창이 나온다). `wrangler dev`는 실서비스 DB를 쓰므로 그 점은 주의한다(선물 전광판을 만들어야 결제를 해 볼 수 있다).

## 주인이 할 일 (순서대로, 사업자등록 전에 할 수 있는 것부터)

**다음 할 일: 1번(포트원 가입).**

1. (사업자 없이 됨) 포트원 콘솔(https://admin.portone.io) 가입 → 상점 만들기. 상점 아이디를 적어 둔다. 안내: https://developers.portone.io/opi/ko/integration/ready/readme
2. (사업자 없이 됨) 결제 연동 → 연동 정보 → **테스트** 채널 추가: NHN KCP(테스트 MID), 카카오페이(테스트). 채널 키를 적어 둔다.
3. 결제 연동 → 연동 정보 → V2 API 시크릿 발급 → `npx wrangler secret put PORTONE_API_SECRET`.
4. 결제 연동 → 웹훅 → V2, 테스트 환경, 주소 `https://studio.wishboard.workers.dev/rt/pay/hook` → 웹훅 시크릿 복사 → `npx wrangler secret put PORTONE_WEBHOOK_SECRET`. 안내: https://developers.portone.io/opi/ko/integration/webhook/readme-v2
5. `npx wrangler secret put PORTONE_STORE_ID`, `npx wrangler secret put PORTONE_CHANNEL_KEY`, `npx wrangler secret put PAY_ALLOW`(내 계정 번호, 설정 화면에 보임), 마지막으로 `npx wrangler secret put PAY_ON`(값 `1`). `PAY_MODE`는 넣지 않는다(= 테스트).
6. 내 계정으로 로그인해 내 선물 전광판에서 결제 시트를 열고 테스트 결제 → `/admin` 🧾 주문·매출에서 상태가 '공개됨'인지, 웹훅이 왔는지(주문 기록의 `pg:hook`) 본다 → '결제사로 환불'로 환불까지 해 본다. 테스트 결제는 매출에 들어가지 않는다.
7. 사업자등록(간이/일반, 업종: 전자상거래 소매 등) → 통신판매업 신고(구청, 사업자등록증·구매안전서비스 확인증 필요: 결제대행사 이용 확인서로 대신하는 경우가 많다) → `OPERATOR_INFO`에 사업자 정보 넣기(약관·방침에 자동으로 나온다).
8. 포트원 콘솔에서 실연동 신청(KCP·카카오페이 심사, 정산 계좌) → 실연동 채널 키를 받는다. 실연동 웹훅도 같은 주소로 만든다(시크릿이 다르면 `PORTONE_WEBHOOK_SECRET`을 바꾼다).
9. 약관·방침의 '결제 방법(준비 중)', '결제(준비 중)'에서 "준비 중"을 빼고, 맡기는 회사의 정확한 이름·연락처를 넣고, 시행일을 바꾼다(변경 7일 전 공지). 환불 규정 초안(아래)을 법무 검토한다.
10. `npx wrangler secret put PORTONE_CHANNEL_KEY`(실연동 키) → `npx wrangler secret put PAY_MODE`(값 `live`) → 먼저 `PAY_ALLOW`에 내 계정만 둔 채 실결제 1건을 해 보고 환불 → 괜찮으면 `npx wrangler secret delete PAY_ALLOW`로 모두에게 연다.

## 비용

| 항목 | 아는 것 | 모르는 것 |
| --- | --- | --- |
| 결제 수수료 | 카드 3.2~3.4% + 수수료의 부가세 10%(소규모 온라인 기준, 계약하면 정해짐). 7,900원이면 약 278~295원 | 간편결제·계좌이체 요율, 정산 주기 |
| 포트원 | — | 포트원 자체 이용료(요금제, 월 거래액 기준 여부): 모름, 가입할 때 확인 |
| 호스팅 | Workers·DO 무료 한도 안(주문 하나에 DO 호출 약 10번: 만들기 2, 결제 시작 1, 확인 4, 웹훅 2~3) | 유료 전환 시점 |
| 영상 만들기, 응대 시간, 세금 | — | 모름(운영 화면에도 '모름'으로 나온다) |

## 환불 규정 초안 (법무 검토 전)

결제 시트에 결제 전에 보이는 문구(`payrules.js` `REFUND_RULES`)와 약관 '유료 상품의 취소와 환불'의 요약이다.

- 전광판이 공개되기 전에는 언제든 취소할 수 있고 낸 금액을 전액 돌려드린다.
- 전광판이 공개된 뒤에는 디지털 콘텐츠 제공이 시작되어 청약철회가 제한된다(전자상거래법 제17조제2항제5호). 결제 전에 이 사실과 무료 체험(무료 선물 전광판, 워터마크 미리보기)을 알린다(같은 조 제6항).
- 여러 날에 걸친 상품은 아직 제공되지 않은 날을 그 전날까지 취소할 수 있다.
- 운영자 쪽 장애로 제공하지 못했거나 설명과 다르게 제공되면 3개월 안에(안 날부터 30일 안에) 돌려드린다.
- 환불은 문의하기로 요청하고, 3영업일 안에 결제한 수단으로 돌려드린다. 만 14세 미만은 살 수 없다.

## 기록과 보관

- 주문은 지우지 않는다(Meter DO 인스턴스 `order`). 전자상거래법: 대금결제·재화 공급 기록 5년, 불만·분쟁 기록 3년. 탈퇴해도 주문 기록은 남는다(방침에 적음).
- **P1(아직 안 함)**: DO 한 곳에만 있는 매출 장부를 Supabase에 복사해 두기(예: 결제·환불 때 `order_ledger`에 한 줄). 지금은 만들지 않았다. 마이그레이션은 주인이 SQL 편집기에서 돌리는 방식이라, 만들 때도 마이그레이션 전후 둘 다 동작해야 한다.
- 매출(운영 화면)은 실결제만 센다: 결제사가 `LIVE` 채널이라고 답한 것과 실결제 모드에서 손으로 확인한 입금. 테스트·mock 주문은 따로 센다.

## 지표

- 퍼널(주문 저장소의 하루 카운터, 모드별): `checkout_start`(주문 만듦), `pay_success`, `pay_fail`(주문마다 한 번), `publish_ok`, `publish_fail`(시도마다), `refund`.
- 운영 화면 매출: 날짜별·상품별, 실결제 건수와 가격표에서 고른 수(선물 전광판 E1 `pick:<t>`) 비교, 전환, 객단가, 환불, 처음 산 사람과 다시 산 사람, 받는 사람 페이지에서 온 주문(`ref`), 주문당 결제 수수료, CSV.
- 운영자·테스트 접속은 일일 지표에서 뺀다: `/admin`을 연 기기에 `kts_staff=1` 쿠키(1년, HttpOnly), `tools/prod-e2e.mjs`는 `x-kts-test: 1` 헤더. `/rt/event`와 선물 전광판 방문 신호(`seen`, `start`)가 이것을 세지 않는다.
- WAU: 지표 화면에 최근 7일 동안 온 서로 다른 계정 수(게스트는 연결된 계정으로 합침). 원본 이벤트를 14일 보관하므로 최근 8일치만 계산된다. 새 저장소는 만들지 않았다.

## 다른 화면에 붙이는 법 (상품 쪽 작업)

```js
import { payAvailable, openCheckout, resumeCheckout } from './payclient.js?v=BUILD';
const open = await payAvailable({ kind: 'gift' }); // null이면 버튼을 보이지 않는다(꺼짐, 로그인 안 함, 허용 목록 밖)
if (open) button.hidden = false;
button.onclick = () => openCheckout({ boardId, kind: 'gift', ref }); // ref: 받는 사람 페이지에서 온 경우 그 전광판 id
resumeCheckout(); // 휴대폰에서 결제창이 이 페이지로 돌려보냈을 때(?kts_pay=1&paymentId=…) 결제 확인
```

전광판의 유료 혜택이 켜졌는지는 서버에서 `orderPerks(env, boardId)`(`ordersrv.js`)로 본다: 그 전광판의 '공개됨' 주문의 혜택만 돌려준다.
