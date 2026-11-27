# 구현 보고 (2026-11-28)

바깥 검토(ChatGPT 'B2C 사업모델' 지시문)를 받아 P0 가운데 외부 계정·주인 결정 없이 할 수 있는 것을 만들었다. 기준 커밋 `9f5a469`(실서비스 빌드 `202611272230`) 위에 로컬 `main` `485afbb`까지. **배포·푸시하지 않았다.** 운영 DB 변경 없음(새 저장은 모두 Durable Object 표).

## 만든 방식

조사(Opus 셋: 첫 화면·개인·둘러보기 / 가격·결제·운영·지표 / 선물·받는 사람·보관·안전), 구현(Opus 둘을 각자 작업 폴더에서 + 음악 하나), 합치기, 연결(Opus 하나), 독립 검토 둘(결제 / 제품 화면), 검토 수정 두 차례. 본 세션은 계획, 합치기, 충돌 해결, 전체 테스트, 로컬 화면 확인, 문서.

## 새 기능

| 무엇 | 어디 |
| --- | --- |
| 첫 화면 두 행동(선물하기, 내 전광판 만들기)과 둘러보기 링크, 3D 전에 보임 | `index.html`, `main.js`(`?login=1&back=`) |
| 내 전광판 모드 `/gift?me=1`(무슨 날 `me`, "by", 응원 메시지), 사랑·졸업·승진 | `giftrules.js`, `giftpage.js`, `gift.html`, `giftart.js`, `realcard.js`, `giftfilm.js`, `gift.js`, `ts3d/screens.js`, `towerrules.js` |
| 3D 없는 공유 카드 페이지(광장 전광판, 소원) | `sharepage.js`(서버 전용), `worker.js` `cardPage`·`wishPage` |
| `/discover` 읽기 전용(탭 6, 순위 없음, 예시는 따로), 선물은 주인이 켠 것만 | `discover.html`, `discoverpage.js`, `discoverrules.js`, `POST /rt/gift/<id>/discover` |
| 정직한 가격표, 가격 갈래 기록(`GIFT_ARMS`) | `giftrules.js` TIERS·`LADDER_ARMS`, `giftsrv.js` 집계 |
| 계정에 남겨 두기(`signup_from_gift`), 카드 이미지 저장 | `giftpage.js`, `giftsrv.js` |
| 주문·결제(PortOne V2 시험·모의, 웹훅 서명, 상태 8개, 멱등, 환불), **`PAY_ON=1` 전까지 꺼짐** | `payrules.js`, `ordersrv.js`(서버 전용), `payclient.js`, `worker.js` |
| 유료 혜택 전달: 12시간, 워터마크 없는 영상, 메인 타워 1분 지정 | `giftsrv.js` `perkOn/perkOff`(`gb.pk`), `towerrules.js` |
| 운영 화면 🧾 주문·매출(목록, 상세, 환불, 손 처리, 혜택 다시 떼기, 상품 켜고 끄기, 매출, CSV), WAU | `admin-order.js`, `admin.html` |
| 운영자·시험 트래픽 제외(`kts_staff` 로그인 뒤, `x-kts-test`) | `worker.js`, `giftsrv.js`, `tools/prod-e2e.mjs` |
| 공개 전 선물 내용 숨김(데이터까지, 예고 카드) | `giftsrv.js` `publicView`, `teaserCard` |
| 새 무슨 날 음악 3곡 | `assets/plates/music-{love,grad,me}.m4a`, `tools/plates/music.py` |

## 기존 기능 개선

DISCOVER 끄기는 예산 hard에서도 되고 몇 분 안에 빠진다. 공유·둘러보기 카드가 휴대폰에서 글자를 자르지 않는다. 메인 타워 속보가 새 무슨 날을 맞게 부른다. 로그인 시트를 닫으면 선물 페이지로 끌려가지 않는다. 320px 머리글 한 줄. 부팅 카드에서 "3D 광장 둘러보기"가 첫 화면 안에. 둘러보기 탭 키보드 이동.

## 데이터베이스와 API

- 운영 DB(Supabase): 변경 없음.
- Durable Object(Meter): `order` 인스턴스 표(orders, order_events, webhooks, products, product_log), 선물 `gb.dc`·`gb.pk`, `gct`(예고 카드), 이벤트 원자료 14일(WAU).
- 새 경로: `/rt/order*`, `/rt/pay/hook`, `/rt/order/board/<id>`, `/rt/admin/order*`, `/rt/admin/orders.csv`, `/rt/admin/order-revenue`, `/rt/admin/order-products`, `/rt/gift/<id>/discover`, `/discover`.
- 새 변수·비밀(주인이 넣을 때까지 없음): `PAY_ON`, `PAY_MODE`, `PAY_ALLOW`, `PORTONE_STORE_ID`, `PORTONE_CHANNEL_KEY`, `PORTONE_API_SECRET`, `PORTONE_WEBHOOK_SECRET`, `GIFT_ARMS`(선택).

## 테스트 결과

- 전체 `node --test test/*.test.mjs tools/account.test.mjs`: 2,500개 중 통과 2,493, 실패 0, 건너뜀 7. `node tools/stamp.mjs --check` 통과.
- 지시문의 테스트 시나리오:
  - A 선물 구매자: 모의 결제(`PAY_MODE=mock`)로 주문 → 결제 → 확인 → 게시 → 혜택 → 환불까지 테스트로 확인. 실제 PortOne 시험 결제는 키가 없어 못 함.
  - B 받는 사람: 비회원 접근, 공개 전 숨김, 하트·롤링페이퍼, 카드 저장, 나도 걸어 주기를 테스트로. 실사 영상은 앞 세션에서 로컬로 확인.
  - C 개인 전광판: `/gift?me=1` 로컬 화면 확인(375×812, 옆으로 넘치지 않음). 사진 업로드는 없음(로드맵).
  - D 휴대폰: 로컬 375×812에서 첫 화면·둘러보기·내 전광판 화면 확인. **실제 휴대폰은 못 봄.**
  - E 운영자: 주문·환불·손 처리·혜택 다시 떼기·CSV·매출을 테스트로. 운영 화면을 진짜 키로 열어 보지는 않음(본 세션은 진짜 키를 넣지 않는다).
- 독립 검토 두 건의 지적(결제 10, 화면 10)은 모두 고쳤다. 가장 컸던 것: 실결제 주문을 시험 채널로 내면 혜택이 붙던 길(채널 확인으로 막음), 공개 전 메시지가 데이터로 새던 것(예전부터 있던 문제).

## 확인하지 못한 것

실제 PortOne(시험·실연동), 휴대폰 결제창 돌아오기, 실제 휴대폰 화면, 실서비스 배포 뒤 동작, 새 음악 3곡이 듣기 좋은지(수치로만 맞춤).
