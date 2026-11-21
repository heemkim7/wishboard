# metrics: 성장 퍼널과 카카오톡 공유 (`IMPLEMENTED.md`에 더할 글)

## 성장 퍼널 (admin.html)

`admin.html`의 `🚀 성장 퍼널` 표는 `📈 지표`와 같은 `GET /rt/admin/stats?days=30`(`x-admin-key`) 응답으로 그린다. 요청은 늘지 않고, 지표 표의 새로고침이 이 표도 다시 그린다. 계산은 `growth.js`(DOM·네트워크 없는 순수 모듈, `admin.html`이 `./growth.js?v=<빌드 id>`로 부른다), 그리기는 `admin.html`의 `renderGrow`이며 칸은 모두 `textContent`다.

- 서버: `Meter` `ev` 인스턴스의 `evSum`이 하루치 이벤트에서 `grow`(길이 6)를 더 낸다. `daily`에 접힌 날에도 들어가므로 `EV_KEEP`(14일) 뒤에도 남는다. SQL·새 표는 없다. 접힌 날의 `daily.j`에 `grow`가 없으면(이 빌드 이전에 접힌 날) 응답에도 없다. 클라이언트는 그 날을 '—'(모름)로 두고 합계에서 뺀다. 응답에 행이 아예 없는 날은 이벤트가 없던 날로 0이다.
- 단계와 이벤트(`EV_GROW`, 한 단계당 한 비트): `[0]` 방문(부팅) = `page_landing`, `[1]` 입장 = `enter_square`, `[2]` 소원 걸기 = `wish_post`, `[3]` 공유 = `wish_share` 또는 `share_link` 또는 `share_send`, `[4]` 공유로 들어옴 = `wish_land` 또는 `focus_enter`, `[5]` 재방문 = `return_visit`.
- 세는 단위: 하루에 계정 하나가 그 단계를 한 번이라도 거치면 1이다. 같은 계정의 탭이 여럿이어도, 게스트가 `alias`로 이어진 user여도 한 명이다(`evSum`의 `who` 접기와 같은 규칙). 계정 없이 온 세션은 세션 하나가 1이다(`anon`).
- 표: 단계 × (오늘부터 7일의 날짜별 열, 최근 7일 합계, 최근 14일 합계). 합계는 일별 인원의 합(연인원)이라 같은 사람이 여러 날이면 여러 번 센다. 칸은 `n (%)`이다.
- 퍼센트의 기준 단계(`GROW_STEPS[i].base`): 입장은 방문, 소원 걸기는 입장, 공유는 입장(소원 없이 사진만 공유해도 공유이므로 소원 걸기가 아니라 입장 대비), 공유로 들어옴은 공유(100%를 넘을 수 있다), 재방문은 입장. 기준 단계가 20 미만(`MIN_BASE`)이면 '—'를 쓴다.

### 새 이벤트 `return_visit`

`plaza-account.js`의 `EVENT_NAMES`에 `return_visit`(`gap`: 마지막 출석일로부터 며칠)이 더해졌다. 브라우저가 이미 쓰는 `kts_daily`가 기준이다.

- 판단은 `growth.js`의 순수 함수다. `backFields(prev, day)`: 저장된 기록의 날이 오늘과 다르면 `back = daysBetween(prev.last, 오늘)`(기록이 없거나 `last`가 없거나 오늘 이후면 0, 최대 365)과 `backSent = 0`, 같은 날이면 두 값을 그대로 잇는다(이 빌드 이전 기록은 `back`이 없어 0). `loadDay`가 이 값을 `kts_daily`의 날 기록에 편다. `noteServerAttend`가 `last`를 오늘로 먼저 바꿔도 `back`은 남는다.
- `returnGap(mine, stored, day)`: 이 탭의 기록에 `back > 0`이고 `backSent`가 아니며, 방금 읽은 `kts_daily`가 오늘 날짜로 `backSent`를 적어 두지 않았을 때만 간격(일)을 준다. 아니면 0이다.
- `attend()`(입장 때)는 맨 앞에서 `kts_daily`를 다시 읽어(`saveDay`가 덮어쓰기 전에) `returnGap`을 구하고, `back > 0 && !backSent`이면 `backSent = 1`을 먼저 저장한 다음 간격이 0이 아니면 `trackEvent('return_visit', { gap })`를 한 번 보낸다. 여러 탭을 같은 날 열어도 먼저 입장한 탭 하나만 보내고, 그날의 새로고침도 다시 보내지 않는다. `kts_daily`가 없는(처음 온) 브라우저는 보내지 않는다.

### GA4

`analytics.js`의 `trackEvent`는 gtag에 `gaName(name)`(소문자·숫자·밑줄, 영문자로 시작, 40자까지)과 `gaParams(params)`를 보낸다. `gaParams`는 `GA_PARAMS`에 있는 키(`slot`, `ref`, `streak`, `tier`, `found`, `method`, `kind`, `how`, `from`, `fresh`, `pic`, `load_ms`, `gap`. 지금 호출부가 보내는 키 전부)만 남기고 값은 수·불린(1/0)·문자열(100자까지)만 받는다. 그 밖의 키(`text`, `nick` 같은 플레이어가 쓴 글 포함)는 Google로 나가지 않는다. 새 이벤트가 새 키를 보내려면 `GA_PARAMS`에 더해야 하고, 테스트가 `ui.js`·`main.js`의 `trackEvent` 호출 키가 목록에 있는지 확인한다. `EVENT_NAMES`는 모두 이미 GA4 규칙을 지킨다(테스트가 확인). 서버로 가는 `/rt/event` 본문은 그대로다. `index.html`의 GA 조각(`GA_MEASUREMENT_ID = 'G-XXXXXXXXXX'` 자리표시)은 바뀌지 않았다.

## 카카오톡으로 보내기 (키가 있을 때만)

Kakao JavaScript 키는 비밀이 아니라 공개 키다. Worker 변수 `KAKAO_JS_KEY`가 없으면 기능이 통째로 없다.

- `GET /rt/config`는 `{ url, key }`에 더해, `KAKAO_JS_KEY`가 `[\w-]{16,80}` 모양일 때만 `kakao`를 준다. 비었거나 모양이 틀리면 `kakao` 필드가 없다. 코드에는 키가 없다. `net.js`의 `loadConfig`는 `url`·`key`만 읽으므로 영향이 없다.
- `share.js`: `kakaoKey()`가 `/rt/config`를 페이지당 한 번 읽는다(실패하면 다음 호출에 다시 시도, 키가 없으면 `''`). `loadKakao(key)`가 공식 SDK를 `KAKAO_SDK`(고정 버전 2.7.9, `https://t1.kakaocdn.net/kakao_js_sdk/2.7.9/kakao.min.js`, `integrity` sha384, `crossOrigin=anonymous`)로 한 번만 불러 `Kakao.init(key)`를 한 번 한다. 로드가 실패하면(막힌 CDN, 맞지 않는 integrity) 그 페이지가 열려 있는 동안 실패를 기억해서 탭마다 `<script>`를 다시 붙이지 않고 바로 기존 공유로 간다(`navigator.share`가 탭의 사용자 활성을 그대로 쓴다). `kakaoSend(key, payload)`가 `Kakao.Share.sendDefault(payload)`를 부르고, 키·로드·호출 어디서든 실패하면 예외 없이 `false`를 준다. Kakao 로그인이나 다른 Kakao API는 쓰지 않는다.
- `kakaoFeed({ title, text, url, origin })`가 피드 템플릿을 만든다. 제목·설명은 링크 공유와 같은 글(각 200자까지), 링크(`mobileWebUrl`·`webUrl`·버튼)는 링크 공유와 같은 주소다(`inv` 같은 파라미터가 그대로 간다). 그림은 `kakaoImage`가 정한다: 주소가 `/rt/s/<32자 id>`(스냅샷 페이지)이면 `<origin>/rt/snap/<id>`, 아니면 `<origin>/og.jpg`.
- `ui.js`: 키가 확인되면 `카카오톡으로 보내기` 버튼(`btn ghost kakao`, 처음엔 `hidden`)이 보이고 SDK를 미리 받아 둔다. 자리는 소원 시트의 `친구에게 하트 부탁하기` 바로 아래, 사진 공유 시트의 `shot-row` 끝이다(사진 링크가 만들어지기 전엔 비활성, 링크를 못 만들면 `공유하기`와 함께 지워진다). 누르면 `sendKakao`가 SDK로 보내고 `share_link { kind, how: 'kakao' }`를 남긴다. `sendKakao`는 다른 공유 버튼과 같은 `shareBusy`로 막혀 있어 연타해도 창이 하나만 열린다(진행 중이면 `'busy'`). 소원 공유는 Kakao 팝업이 탭 직후여야 해서 사진 링크를 최대 1초만 기다리고(다른 공유는 4초), 그때까지 없으면 `/rt/w/<id>` 링크와 `/og.jpg` 그림으로 보낸다. 카카오 링크는 `shareMine`이 쓰는 최종 `url` 변수에서 만든다. SDK가 막히거나 던지면 말없이 기존 `sendLink` 경로(공유 시트 → 복사 → 손으로 복사)로 간다. 소원은 `wish_share { how: 'kakao' | 'shared' | 'copied' | 'manual', pic }`도 남긴다.

### 소유자가 할 일

1. Kakao Developers(https://developers.kakao.com)에서 앱을 만든다.
2. 앱 설정 > 플랫폼 키(JavaScript 키)의 `JavaScript SDK 도메인`에 `https://studio.wishboard.workers.dev`를 넣는다. 로컬에서 시험하려면 `http://localhost:8787`도 넣는다. 도메인이 없으면 SDK가 호출을 거절한다(버튼은 보이지만 기존 공유로 떨어진다).
3. 그 JavaScript 키를 Worker 변수로 넣는다. 공개 키라 `wrangler.jsonc`의 `"vars": { "KAKAO_JS_KEY": "<키>" }`도 되고, `npx wrangler secret put KAKAO_JS_KEY`도 된다. 배포한다.
4. `share.js`의 `KAKAO_SDK.integrity`는 Kakao 개발자 문서 다운로드 페이지(https://developers.kakao.com/docs/ko/javascript/download)의 2.7.9 `SRI 해시 복사` 값과 같은지 한 번 대조한다. 이 값은 공개 글(GitHub PR)에서 옮겨 적었고 개발자 문서 페이지에서 직접 확인하지 못했다. 다르면 SDK가 로드되지 않고 기능은 기존 공유로 떨어지니 위험은 없지만 버튼이 소용없다. 새 버전으로 올릴 때는 `src`의 버전과 `integrity`와 `version`을 같이 바꾼다.

### 확인하는 법

- 키 없이: `/rt/config` 응답에 `kakao`가 없고, 소원 시트·사진 시트에 카카오 버튼이 없다.
- 키를 넣은 뒤(휴대폰 카카오톡이 깔린 기기): `https://studio.wishboard.workers.dev`를 열고 소원을 걸면 `친구에게 하트 부탁하기` 아래에 `카카오톡으로 보내기`가 보인다. 누르면 카카오톡 공유창(친구 고르기)이 열리고, 보낸 카드는 제목 `<이름>님의 소원`, 사진(전광판에 올린 스냅샷), `광장에서 보기` 버튼이다. 카드를 누르면 같은 링크로 광장이 열린다.
- 개발자 도구 Network에서 `kakao.min.js`가 200으로 오고 Console에 integrity 오류가 없어야 한다. `Kakao.isInitialized()`가 `true`여야 한다. 도메인을 등록하지 않았으면 콘솔에 도메인 오류가 나고 기존 링크 공유로 떨어진다.

## 테스트

`test/metrics.test.mjs`: 단계별 하루 집계(계정당 한 번, 두 탭, alias로 이어진 게스트, 계정 없는 세션)와 접힌 날의 `grow`, `return_visit` 허용·`return` 거절, GA4 이름·파라미터, 퍼센트와 '—'(20 미만), 날짜 열과 합계, `/rt/config`의 `kakao`(있을 때·없을 때·잘못된 값·POST 405), `kakaoFeed` 페이로드, SDK 고정 버전·integrity·한 번 로드·init 한 번·실패 시 `false`, `kakaoKey` 캐시, 로드 실패 기억, `ui.js`의 연결(폴백, `shareBusy`, 1초)과 GA 자리표시·키 없음, `return_visit` 판단(`backFields`·`returnGap`: 처음 방문·같은 날·다음 날 간격 1·사흘 뒤 3·옛 기록·이미 보낸 날·다른 탭이 보낸 날), `gaParams` 허용 키(`text`·`nick` 같은 키는 버림). `test/plaza.test.mjs`의 I2 테스트는 하루 요약에 `grow`가 더해져서 기대 객체에 `grow: [3, 1, 0, 0, 0, 0]`을 더했다(다른 값은 그대로).
