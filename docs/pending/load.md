# 첫 로드 줄이기 (package `load`)

`IMPLEMENTED.md`에 넣을 글. `## 세계`의 아바타 줄 아래와 `## 화면에서 이미 이어 둔 것`의 서비스 워커 줄을 아래처럼 고친다.

## 세계 (추가)

- 무엇을 언제 받는지는 `ts3d/loadplan.js`의 순수 함수다(three를 부르지 않는다). 모델 주소 `MODEL_URL`(1 `Mousey.glb`, 2 `Cat.glb`, 3 `Bear.glb`)도 여기 하나뿐이다.
- 아바타 모델: 처음에는 내 종 하나만 받는다(`createAvatars({ first })`). 다른 종은 그 종의 피어가 화면 안(카메라 시야 절두체)이고 카메라에서 `SEE_R` 90m 안에, 택시 밖으로 처음 보일 때 받는다(`seesAvatar`, `syncRemotes`에서 `Avatar.want()`). `🤖 내 캐릭터`에서 종을 고르면 그 종 하나를 바로 받기 시작한다(`hooks.wantSpecies` → `world.wantSpecies` → `avatars.want(id)`). 종마다 요청은 한 번이다. 모델이 이미 있는 아바타의 종이 바뀌면(내 캐릭터 저장, 입장, `pullProfile`이 가져온 서버 종, 피어의 `av`) 새 종 모델이 올 때까지 지금 모델을 그대로 보이고, 오면 바꾼다. 새 종을 못 받으면 지금 모델이 남는다. 바꿀 때 이전 모델의 스켈레톤과 리본 모자 지오메트리·재질은 해제한다. 아직 모델이 하나도 없는 아바타만 받는 동안 기존 대역 몸(캡슐)을 보인다.
- 모델이 없는 아바타에 무엇을 보일지는 `modelFor(id, { loaded, missing })`다. 받았으면 그 종, 아직이면 대역 몸으로 기다리고, 실패했으면 쥐(없으면 받은 아무 종)를 쓴다. 쥐도 실패했으면 대역 몸으로 둔다.
- 입장 뒤 미리 받기: `main.js` `enter`가 `world.prefetchAvatars()`를 부른다. `prefetchDelay`가 60초(`PREFETCH_MS`) 뒤 `requestIdleCallback`(없으면 `setTimeout`)으로 나머지 종을 받는다. `low` 품질이거나 `navigator.connection.saveData`면 하지 않는다.
- 광장 걷는 사람(`walkers`)은 캡슐 인스턴스라 종 모델을 쓰지 않는다.
- 모델 파일은 `tools/pack-models.mjs`(glTF-Transform 4.5.1, 저장소 의존성이 아니라 `GLTF_DEPS` 폴더에 따로 설치)로 다시 만든 것이다. 노드 extras 삭제, weld(쥐는 인덱스 없는 삼각형 덩어리였다), resample, 클립 내내 노드 기본값인 트랙 삭제, prune, 재질은 빼고 accessor·mesh·texture만 dedup, 텍스처 WebP(`EXT_texture_webp`) 1024px 이하, 회전 키 normalized int16, `KHR_mesh_quantization`으로 NORMAL int8·JOINTS uint8·WEIGHTS uint8. 위치와 UV는 float 그대로다(위치를 양자화하면 메시마다 스킨이 복제된다). Draco·Meshopt는 쓰지 않는다. 크기: 쥐 3.27MB → 0.87MB, 고양이 1.71MB → 0.97MB, 곰 1.54MB → 0.85MB. 원본과 비교해 모든 클립의 스키닝된 꼭짓점 오차는 키의 0.2% 이하였다(vendored GLTFLoader로 측정).
- 재질 이름은 그대로다. 쥐 `Ch14_Body`, 고양이 `CatWhite` `CatFur` `CatEar` `CatEye` `CatMuzzle` `CatNose` `Black`, 곰 `Main` `EyeWhite` `BearEar` `BearMuzzle` `BearNose` `Black`. 스킨은 모델마다 하나, 관절 이름 46개(`mixamorig*`)도 같다. `test/load.test.mjs`가 클립 10개, 재질 이름, 관절 이름, 허용 확장, 텍스처 크기를 GLB JSON에서 확인한다. `assets/models/RobotExpressive.glb`는 코드가 부르지 않는다.
- 실제 사진은 환경맵(`buildPhotoEnv`)에만 쓴다. 받는 것은 `ENV_PHOTOS` 네 장(`night-2025` `night-pano` `night-steps` `night-canyon`)이고, 모든 품질이 `assets/times-square/<이름>.env.jpg`(가로 512 이상, 세로 256 이상, 약 190KB 합)를 쓴다(`envPhotoUrl`). `night-2013` `night-billboards` `night-lionking` `night-pano2`와 원본·`.m` 파일은 저장소에만 있고 받지 않는다(출처 `credits.json`은 그대로).
- 바닥 텍스처: `low`는 색·노멀 맵을 `assets/textures/512/`에서 받는다(거칠기 맵은 원래 512). `medium`·`high`는 1024 그대로다.
- `icons/`는 같은 이름·형식으로 다시 인코딩했다. `coin.jpg` 192px, `board.jpg` 256px, `app-icon.jpg` 512px(매니페스트 크기와 같다), `boot.jpg` 1280×720 품질 72, `bokjumeoni.png` 512px 팔레트 PNG. 복주머니 풍선은 첫 프레임부터 떠 있으므로 입장 전에 받는다.
- `manhattan.bin`(1.67MB)은 스폰 주변 바닥·건물·전광판이 모두 이 데이터로 만들어져서 늦출 수 없다. 그대로 부팅 때 받는다.
- 오디오 `assets/audio/*.ogg`는 저장소에 없다. 입장 때 음악 요청은 404로 끝나고 효과음은 합성음으로 대신한다(전과 같다).

### 바이트 (`node tools/load-budget.mjs`)

정적으로 계산한다. `index.html`이 거는 것, `<script type=module>`에서 시작하는 import 그래프, 그 모듈 안의 `/assets/…`·`icons/…` 문자열을 `RULES`로 단계에 나눈다. 단계는 `boot`(입장 버튼을 누르기 전), `first`(입장 후 첫 1분: 다른 두 종이 다 보이는 최악, 오디오), `later`(시트를 열 때: 분양 그림, 허브 그림, 사진 출처). 규칙에 없는 자산 문자열이 있으면 1로 끝나고 테스트가 실패한다. wire는 글자 파일 gzip -9, 그림·모델·`manhattan.bin`은 원래 크기다. CDN에서 받는 것(supabase-js, Pretendard·Black Han Sans 글꼴 파일)과 승인된 전광판 사진은 세지 않는다. 새 휴대폰에서는 이것들이 수백 KB를 더한다. 규칙 표(`RULES`)는 손으로 관리하는 목록이라 런타임에 정해지는 주소(전광판 사진처럼 월드 데이터가 주는 것)는 잡지 못한다.

| 휴대폰(`low`, 쥐) | 전 (df5a739) | 후 |
| --- | --- | --- |
| 입장 전 | 13.39 MB | 4.32 MB |
| 첫 1분까지 | 13.39 MB | 6.14 MB |
| 전부 | 13.80 MB | 6.20 MB |

`high`(데스크톱): 입장 전 15.69 → 5.38 MB, 첫 1분 7.20 MB. 테스트 예산(`BUDGET`)은 `low`에서 입장 전 5.0 MB, 첫 1분 7.0 MB이고 세 종 모두 확인한다.

## 화면에서 이미 이어 둔 것 (바꿈)

- 서비스 워커 `sw.js?v=8`은 `/assets/*`만 캐시하고, 캐시 이름은 그 `?v=` 값이다. HTML·JS는 캐시하지 않는다. (v=7에서 올렸다: 모델 세 개를 같은 주소로 바꿔 넣었다.)

## 모듈 주소 (바꿈)

- `sw.js`(`?v=8`, 손으로 관리)와 `vendor/`는 이 규칙 밖이다.
