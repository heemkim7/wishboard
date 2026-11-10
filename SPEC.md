# Project: K-Times Square (타임스퀘어 K-점령전) Architecture & Rules

## 1. 핵심 아키텍처 원칙 (절대 수정 금지 영역)
현재 레포지토리의 `worker.js`, `net.js`, `cf_release.py`는 프로덕션에서 검증된 Cloudflare Workers + Durable Objects(DO) + Supabase 트래픽 최적화 코어이다. 아래 핵심 메커니즘은 절대 삭제하거나 임의로 단순화하지 마라.
1. **Workers Free 예산 가드 (`Meter DO`)**: 일일 100,000 요청 / 13,000 GB-s 기준 80% `lean` 모드, 95% `hard(down)` 차단 로직 유지.
2. **WebSocket Hibernation (`Room DO`)**: `setWebSocketAutoResponse(ping->pong)`, 클라이언트 25s ping / 75s stale, 대기자·배치 있을 때만 5s 알람, 유휴 시 60s 알람, 접속자 0명 시 알람 해제 유지.
3. **위치 패킷 압축 및 팬아웃 제한**: `v2: {t:'P', k, a:[x,y,...]}` 압축 포맷, 동일 구역(`floor=0`) 및 `NEAR_R(1600)` 이내 근거리 피어 우선 전송, 원거리는 `FAR_MS(3s)` 제한, `net.js`의 1.15s 과거 샘플 속도 보간(Dead-reckoning) 유지.
4. **인증 및 비용 방어**: `/rt/guest`의 Worker HMAC(`GUEST_KEY`) 게스트 토큰 발급(Supabase 익명 MAU 소모 방지) 및 Supabase JWKS 10분 캐시 유지.
5. **보안 배포 규칙 (`cf_release.py`)**: 브라우저에는 Supabase `publishable(anon)` 키만 노출. `service_role`, `FLUSH_KEY`, `GUEST_KEY`, `ADMIN_KEY`는 오직 Worker Secret 환경변수로만 참조. `/.env.local`, `/.git/config` 접근 시 404 반환 유지.

## 2. 도메인 개조 매핑 (마실채플 -> 타임스퀘어 K-점령전)
기존 예배당 도메인을 '뉴욕 타임스퀘어 한복판의 K-로컬 타이쿤' 단일 광장 메타버스로 1:1 매핑하여 개조한다.
- **공간 단일화**: 기존 다층(`floor` 1F/B1/외부) 구조를 단일 광장(`floor = 0` 고정)으로 통일해 모든 접속자(채널당 `CAP=100`)의 시선을 중앙 전광판에 집중시킨다.
- **월드 상태 캐시 (`/rt/prayers` -> `/rt/world`)**:
  - 기존 15초 캐시(`PRAY_TTL=15s`, isolate PC + Cache API) 구조를 그대로 사용하여, 현재 활성화된 **전광판 목록(`billboards`)**과 **20개 토지 분양 상태(`plots`)**를 반환한다.
- **재화 채굴 배치 (`tap_batch` -> `coin_batch`)**:
  - 유저가 붕어빵 미니게임이나 별똥별 줍기로 코인을 획득하면 웹소켓으로 `Room DO`에 탭 이벤트를 보내고, `Room DO`는 어뷰징 방어(유저당 2.5초 내 최대 1회 인정, 1회 최대 10코인) 검증 후 메모리+SQLite에 합산하여 `FLUSH_N=20` 또는 `FLUSH_MS=30s` 주기로 Supabase `rpc/coin_batch(p_key, p_items)`를 1회 호출한다.
- **실시간 이벤트 브로드캐스트 (`HIST_N=10`)**:
  - 자유 텍스트 채팅은 제거한다. 대신 4종의 머리 위 이모티콘 리액션(`{t:'E', k, e: 1~4}`)과, 전광판 등록/땅 분양 성공 시 방 전체에 폭죽 효과와 함께 상태를 즉시 갱신하는 시스템 브로드캐스트(`{t:'SYS', type:'BILLBOARD'|'PLOT', data:{...}}`)를 `Room DO` 링 버퍼(`HIST_N=10`)에 유지한다.

## 3. 프론트엔드 파일 구조 (순수 ES Module + Three.js)
빌드 도구 충돌을 피하기 위해 `cf_release.py` 및 Workers Assets와 100% 호환되는 네이티브 ES Module 구조를 사용한다.
- `index.html`: Three.js(`importmap` CDN: `three`, `three/addons/`), UI 오버레이 레이아웃, 모바일 조이스틱 및 모달 컨테이너.
- `main.js`: 엔트리 포인트. `/rt/guest` 발급, `net.js` 초기화, `timesSquare3d.js` 씬 구동, `ui.js` 이벤트 연결.
- `timesSquare3d.js`: Three.js 기반 3D 월드. 무대는 OpenStreetMap 실측 데이터로 만든 맨해튼 섬 전체(실제 축척):
  1. **스폰 구역**: 타임스퀘어 남쪽 보행 광장(W 44th–45th St). 서울 지하철 2호선 스타일 초록색 '타임스퀘어역 1번 출구'.
  2. **중앙 랜드마크**: 더피 스퀘어의 실제 TKTS 부스 위치에 '빨간 계단(Red Stairs)', 남쪽 끝 실제 '원 타임스퀘어' 북쪽 면을 감싸는 커브드 `MAIN_S` 전광판과 위로 쌓인 스크린·새해 볼.
  3. **경제 활동 구역**: 광장(W 43rd–44th St)의 'K-붕어빵 포장마차'(미니게임 트리거)와 '황금 ATM'.
  4. **분양 구역**: K-타운(W 32nd St 코리아웨이, 브로드웨이~5번가) 북쪽 10필지 + 남쪽 10필지(`plot_id: 1~20`). 분양 단계(0:빈땅, 1:텐트, 2:포장마차, 3:네온상가, 4:고층타워)에 따라 프로시저럴 3D 건물과 소유자 간판, 건물 외벽 소형 전광판(C급)을 렌더링. 해당 자리의 OSM 건물은 `SKIP_ZONES`로 비운다.
  5. **전광판 렌더링**: 기본은 `HTMLCanvasElement`를 `THREE.CanvasTexture`로 변환한 글자 전광판(배경 프리셋, 네온 컬러, 이모지, 3줄 텍스트, 소유자 닉네임)이고 `UnrealBloomPass`로 네온 발광을 낸다. 운영자가 승인한 사진만 같은 캔버스에 덮어 그린다(`photo_status = 'approved'`). `SUB_B1~4`는 광장을 향한 실제 건물 벽에 자동 배치한다. 타임스퀘어를 향한 사진·슬라이드 스크린은 점령 가능한 `WALL_1~64`(큰 화면부터)와 `TOWER_1~5`(원 타임스퀘어 적층)로 바꾼다.
  6. **록펠러**: OSM에 겹쳐 있던 30 Rockefeller Plaza 파츠는 메시만 숨기고(`hideMesh`, 충돌은 유지), 같은 대지에 기단·260m 샤프트·계단형 크라운으로 다시 그린다(`ts3d/rockefeller.js`).
  7. **K-POP 스테이지**: 브라이언트 파크 잔디 남쪽, 북향. `MAIN_S` 동시 송출 LED 월.
- `ui.js`: 붕어빵 타이밍 게이지 미니게임, K-POP 리듬 댄스(스테이지), 택시 HUD(속도·미터기·손님 안내), 정각 별똥별 이벤트 알림, 전광판 문구 등록 모달, 토지 분양/증축 모달(필지 위치·길안내·⚡바로 가기), 이모티콘 단축바(4종), 미니맵 + 현재 거리 이름, 미니맵 클릭 → 맨해튼 전체 지도(실제 도로·공원·건물, 거리 이름, 랜드마크 바로가기, 목적지 핀, ⚡순간이동), 설정(네온 글로우·밝기·그래픽 품질).
- 미니게임 보상은 모두 `MINE` 한 경로로 적립된다. 서버(Room DO `addMine`)가 1회 최대 15코인, 같은 유저 2초 간격을 강제한다.

### 3-1. 3D 모듈 분리 (`ts3d/`)
`timesSquare3d.js`는 렌더러·카메라(OrbitControls 추적)·입력·로컬 플레이어·원격 아바타 동기화를 맡고, 월드 구성은 아래 모듈로 나눈다.
- 좌표계: 미터, 원점 = 7번가 × W 45th St, 북쪽(업타운) = -Z, +X = 이스트리버 방향. 맨해튼 격자 각도(28.97°)만큼 회전해 애비뉴는 Z축, 스트리트는 X축과 나란하다.
- `ts3d/nyc.js`: `/assets/nyc/manhattan.bin` 디코더 + 200m 타일 인덱스, 건물 벽·해안선 충돌(필요한 타일만 지연 구축), 카메라 가림 레이캐스트, 가장 가까운 도로/거리 이름, 주행 가능 도로 그래프(일방통행·실제 신호등 위치), 지도 라벨.
- `ts3d/nycmeta.js`: 빌드 도구가 생성(손으로 수정 금지). 투영 파라미터, 랜드마크 좌표, 이름 붙은 교차로 좌표.
- `ts3d/layout.js`: 게임 요소를 실제 지도 위에 고정한다(스폰, 포차, ATM, TKTS, 원 타임스퀘어, 스테이지, K-타운 필지 `PLOT_SLOTS`, 택시 승강장, `SKIP_ZONES`/`NO_PROPS`/`NO_TREES`, 별똥별 구역 `starSpot()`), `groundHeight()`(계단·스테이지만, 거리는 평지).
- `ts3d/world.js`: 타일 스트리밍(가까운 타일 = 건물+도로+차선·횡단보도·연석+가로등·가로수·급수탑·지하철 입구, 먼 타일 = 건물+도로). 창문을 셰이더로 그리는 파사드 재질(`aWin` = 스타일·시드(flat)·지붕·층고), 섬·호안·강·공원·광장, 강 건너 원경, 150m 이상 고층은 항상 보이는 스카이라인 레이어.
- `ts3d/traffic.js`: 도로 그래프 위 AI 택시·승용차(차선 유지, 36초 주기 동기 신호, 차간거리, 플레이어 주변 스폰), 신호등(실제 신호 교차로), 플레이어 택시·호출 택시·원격 플레이어 택시.
- `ts3d/timesq.js`: 광장을 향한 실제 건물 벽에 저층·중층·고층(최대 190m) 사진/슬라이드 전광판과 블레이드 간판, `MAIN_S`·`SUB_B1~4` 마운트, 새해 볼, 스팀, K-타운 네온 게이트·한글 간판·`MAIN_S` 동시 송출.
- `ts3d/art.js`: 모든 CanvasTexture 페인터(전광판 5종 테마 아트, LED 티커, 네온 간판, K-브랜드 광고 아틀라스, 데칼, 이름표).
- `ts3d/screens.js`: LED 셰이더 재질, 커브드 전광판 + 베젤 + 하단 티커, 슬롯 레지스트리(`MAIN_S`, `SUB_B1~4`, `PLOT_1~20`).
- `ts3d/ground.js`: 젖은 노면 셰이더 패치(물웅덩이) + 평면 반사(고품질에서만).
- `ts3d/landmarks.js`: TKTS 빨간 계단, 타임스퀘어역 1번 출구, 황금 붕어빵 포차, 황금 ATM, K-POP 스테이지, 택시 승강장 표지, 토지 건물(0~4단계).
- `ts3d/rockefeller.js`: 30 Rockefeller Plaza. OSM 파츠는 `hideMesh`로 가리고 같은 자리에 기단·샤프트·크라운을 그린다.
- `ts3d/icons.js`: 타임스퀘어 골목 밖 유명 건물(엠파이어 스테이트, 크라이슬러, 플랫아이언, 원 월드 트레이드, 그랜드 센트럴, MSG, 유엔). 타임스퀘어 주변 건물은 원래 OSM 파사드를 유지한다.
- 높이 안개: `THREE.ShaderChunk`의 fog 청크를 고도에 따라 옅어지게 바꿔, 먼 고층 실루엣이 보이게 한다.
- `ts3d/avatars.js`: `RobotExpressive.glb`(CC0) + `AnimationMixer` 상태 전환(Idle/Walking/Running/Sitting/Dance) 및 이모트.

### 3-2. 위치 동기화 규칙
- 내 캐릭터 위치는 로컬 입력으로만 갱신한다. 서버 패킷은 원격 아바타에만 적용한다.
- 전송 시에만 `net.js`의 `toNetUnits(m) = round(m * 20 + 1500)`(5cm 격자)로 변환하고, 수신 샘플은 `fromNetUnits()`로 되돌린다. `NEAR_R = 1600` ≈ 80m. 맨해튼 전체(x ≈ -2.8~6.9km, z ≈ -14.2~10.7km)도 같은 공식이며 워커는 범위를 제한하지 않는다.
- 이동 중 `anim`은 `'walk'`로 유지해 워커의 원거리 스로틀을 그대로 쓰고, 달리기/걷기 구분은 속도(`vx`, `vy`, 단위 1/20 m/s)로 표현한다.
- 택시 운전 중에는 프레즌스 `equip: 'taxi'`를 보내고, 다른 클라이언트는 그 유저를 로봇 대신 택시로 그린다(`face` = 차량 방향).

### 3-3. 에셋 (`/assets/*`, 서비스워커 캐시 대상)
- `assets/times-square/*.jpg`: Wikimedia Commons 야경 사진(CC BY / BY-SA, 출처는 `credits.json`과 게임 내 ⓘ 패널). 모바일은 `.m.jpg`.
- `assets/textures/*`: Poly Haven CC0 노면 스캔. `assets/models/RobotExpressive.glb`: CC0.
- `assets/nyc/manhattan.bin`: 맨해튼 건물(높이·building:part)·도로(차선·일방통행·이름)·공원/물/광장·해안선·신호등·지하철 입구. gzip된 바이너리(약 1.7MB). © OpenStreetMap contributors, ODbL — 게임 내 ⓘ 패널, 지도 범례, 미니맵에 표기한다.
  - 재생성: `node tools/fetch-osm.mjs`(Overpass, 캐시 `%TEMP%/kts/osm`) → `node tools/build-nyc.mjs`(바이너리 + `ts3d/nycmeta.js` 생성). 원본 캐시는 저장소 밖에 둔다(에셋 25MiB 제한).
  - Google 지도/어스 데이터는 약관상 추출·3D 재구성이 금지되어 쓰지 않는다.
- 품질 단계는 기기에 따라 자동(`high`/`medium`/`low`)이며 `?q=low|medium|high`로 강제할 수 있다.

### 3-4. 사진 전광판 (운영자 승인제)
점령 중인 사람만 사진을 올릴 수 있고, 운영자가 승인한 사진만 광장 전체에 송출된다. 승인 전에는 글자 전광판 그대로다.
- 요금은 등급 고정: S급 +1,000 / B급 +300 / C급 +100 코인. 제출 전에 `settle()`로 미정산 코인을 먼저 반영한다.
- 브라우저가 16:9로 잘라 JPEG로 다시 인코딩한다(EXIF 제거, 280KB 이하). Worker가 JPEG를 다시 파싱해 APP1–APP15·COM(EXIF·GPS·XMP)을 지우고, `sha256(actorId + slot + jpeg)` 앞 40자를 `photo_id`로 쓴다.
- 바이트는 `billboard_photos`(RLS, 공개 SELECT 없음)에만 있고 `FLUSH_KEY`를 검사하는 SECURITY DEFINER RPC로만 읽고 쓴다. 플레이어는 `GET /rt/photo/<id>.jpg`로 **승인된** 사진만 받는다.
- 검수는 Worker 시크릿 `ADMIN_KEY`(`x-admin-key`, 상수 시간 비교, 12자 미만 거부). `admin.html`에서 대기 목록을 보고 승인·거절·내린다. 거절과, 검수 전에 다른 사람이 전광판을 탈환한 경우는 사진 요금을 환불하고 JPEG를 비운다. 승인된 사진을 내리거나 새 사진으로 바꾸면 환불 없이 글자 전광판으로 돌아간다.
- 운영 적용: Supabase SQL 편집기에서 `schema.sql`을 다시 실행하고, `npx wrangler secret put ADMIN_KEY`로 시크릿을 넣은 뒤 `admin.html`을 연다. 로컬 `wrangler dev`에는 `FLUSH_KEY`가 없어 실제 차감·송출은 되지 않는다.