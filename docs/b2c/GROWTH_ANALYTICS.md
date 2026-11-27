# 성장 지표 (2026-11-28)

운영 화면(`/admin`, 로그인 필요)의 지표·🎁 선물·🧾 주문·매출에서 본다. 새 분석 인프라를 만들지 않고 있는 집계에 이었다.

## 선물·개인 깔때기 (지시문 이름 → 지금 집계)

| 지시문 | 지금 (`giftsrv.js` 하루 집계 / 비컨) |
| --- | --- |
| gift_view / personal_view | `start`, `start_ref`(만들기 화면 연 수) |
| create_start | `start` |
| template/design_select | 따로 없음(색 선택은 세지 않음) |
| preview | 주인 화면 열기 `view` |
| price_view | `ladder:<갈래>:<g\|me>` |
| (가격 고름) | `pick:<단>:<갈래>:<종류>:<가격>`, `notify:…` |
| checkout_start | 주문 저장소 `checkout_start` |
| payment_success / fail | `pay_success`, `pay_fail` |
| publish_success / fail | `publish_ok`, `publish_fail` (+ `refund`) |
| share | `ev:share`, `ev:reshare`, 친구 보상의 링크 열림 |
| link_open | `hit`(사람) / `hitbot`(자동 미리보기) |
| recipient_reaction | `heart`, `msg`(롤링페이퍼), `reply` |
| recipient_signup | `signup_from_gift` |
| recipient_create | `made_ref`(링크로 온 사람이 만든 보드) |
| repeat (재구매·두 번째 보드) | `made_again`, 주문의 첫 구매일과 재구매 |

광장 전광판: `claim_start`, `board_claim`, `share_send`, `share_link`, 공유 링크 열림(사람/자동).

## 공통 지표

- 방문: 하루 계정 방문자, D1/D7/D30 재방문(`ret`), **WAU**(최근 8일 원자료에서 계산. 그보다 긴 기간은 저장하지 않는다).
- 실제 입장자: 광장 입장 이벤트. 선물 페이지만 본 사람은 선물 집계에만 잡힌다.
- 비회원/회원: 손님과 계정 구분은 이벤트에 있다.
- 매출: 일별·상품별, 결제 건수, 고름 대비 결제, 객단가, 환불, 신규·재구매 고객, 받는 사람에서 온 주문(`ref`). 테스트·모의 주문은 빠진다.

## 섞이지 않게

- 봇: 링크 열림은 사람/자동을 나눈다(`linkWho`). 공유 페이지와 둘러보기는 `noindex`.
- 운영자·시험: 관리자 로그인 기기의 `kts_staff` 쿠키와 `tools/prod-e2e.mjs`의 `x-kts-test` 머리글이 붙은 요청은 이벤트·선물 비컨 집계에서 빠진다(그 사람 자신의 숫자만 빠지고, 보상·주문·속도 제한에는 영향 없음).
- 작은 표본: 하루 수십 명일 때 비율은 방향만 본다.

## 가장 중요한 숫자 (매주)

1. 만들기를 끝낸 사람 비율 (`made / start`)
2. 유료 결제 비율 (`pay_success / 보드 수`, 결제 켠 뒤)
3. 선물 링크로 온 새 사람의 방문율 (`hit` 사람 / 공유)
4. 새 사람의 두 번째 보드 (`made_again`)
5. 재구매율 (주문)
6. 사람당 매출 (광고비를 쓰기 시작하면 사람당 획득 비용과 함께)

## 아직 못 재는 것

색·디자인 선택 단계, 공유 창을 열었다 닫은 수, 9시 동시 접속 최고치, 팀원 D7/D30, 나라별 보드, 사람당 획득 비용(광고 없음).
