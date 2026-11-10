# AGENTS.md

타임스퀘어 K-점령전. 빌드 없는 ES 모듈 게임이다. 긴 설계는 `SPEC.md`를 보고, 여기 적힌 경계는 그대로 둔다.

## 저장소와 배포

- Git: https://github.com/heemkim7/wishboard (`main`)
- 이 게임의 Worker 이름은 `studio`다. 배포는 `npx wrangler deploy`. 공개 주소는 https://studio.wishboard.workers.dev
- `cf_release.py`는 예전 마실채플(`studio`, `studio-qa`) 배포 도구다. 이 게임에 쓰지 말고, `studio` / `studio-qa`에 이 코드를 올리지 마라.
- 로컬은 `npx wrangler dev --port 8787`.
- `.assetsignore` 때문에 `*.md`, `worker.js`, `schema.sql`, `tools/`는 정적 에셋으로 나가지 않는다. Worker 본문은 `wrangler.jsonc`의 `main`으로만 올라간다.

## 데이터

- 이 게임의 Supabase는 `kts-plaza` (`https://yxddhpacuyaffaoutxjn.supabase.co`, 서울)다.
- `masil-chapel-seoul` (`gisykxqhticmdhmupnry`)은 채플 운영 DB다. 테이블을 만들거나 함수를 바꾸지 마라. `wallets` 스키마가 서로 다르다.
- 스키마 원본은 `schema.sql`. 브라우저에는 publishable 키만 둔다.
- `FLUSH_KEY`, `GUEST_KEY`, `ADMIN_KEY`는 Worker 시크릿이다. `.dev.vars`에만 두고 커밋하지 마라. `service_role` 키도 코드에 넣지 마라.
- `FLUSH_KEY`는 Supabase `app_secrets`의 값과 같아야 `coin_batch`가 통과한다.

## 깨면 안 되는 서버 동작

`worker.js`와 `net.js`의 아래 동작은 유지한다.

- Meter DO 일일 예산 가드. 80% lean, 95% hard.
- Room DO WebSocket hibernation. 핑·스태일·알람 주기와, 사람 없을 때 알람 해제를 지우지 마라.
- 위치 패킷 `v2: {t:'P', k, a:[x,y,...]}`. 같은 층, `NEAR_R` 1600 안을 우선하고 먼 피어는 `FAR_MS`로 줄인다.
- `net.js`의 1.15초 데드레커닝.
- `/rt/guest` HMAC (`GUEST_KEY`). Supabase 익명 가입으로 바꾸지 마라.
- 내 캐릭터 위치는 로컬 입력만 쓴다. 서버 좌표를 내 플레이어에 덮어쓰지 마라.
- 좌표 변환은 `toNetUnits` / `fromNetUnits`만 쓴다. 바닥은 `floor = 0`.
- 자유 텍스트 채팅은 없다. 리액션은 `{t:'E', k, e: 1~4}`.

## 클라이언트

- 엔트리 `index.html` → `main.js` → `timesSquare3d.js` + `ui.js` + `ts3d/`.
- 좌표계는 미터. 원점은 7번가 × W 45th St. 북쪽은 -Z, 동쪽은 +X.
- `ts3d/nycmeta.js`는 `node tools/build-nyc.mjs`가 만든다. 손으로 고치지 마라.
- 지도 원본은 OSM이다. Google 지도/어스에서 따온 지형·건물은 넣지 마라.
- 아바타 종은 프레즌스 `av`다. `1` 쥐(Mousey, Mixamo), `2` 고양이, `3` 곰. 고양이·곰은 Mousey 뼈와 같은 클립 이름(`Idle`, `Walking`, `Running`, `Dance`, `Sitting`, `Wave`, `Jump`, `ThumbsUp`, `Yes`, `No`)을 쓴다.
- 재질 이름이 `Main`인 메시만 이름표 색으로 칠해진다. 고양이 털·배·발은 그 이름이 아니어야 색이 유지된다.
- 사진 전광판은 점령자만 올리고, `ADMIN_KEY`로 `admin.html`에서 승인한 것만 송출한다.

## 하지 말 것

- `.dev.vars`, `.env*`, `*.fbx`, `*.blend`를 커밋하지 마라.
- Worker 시크릿 값을 채팅, 코드, 커밋 메시지에 적지 마라.
- 에셋 합이 Workers 한도를 넘기 때문에 OSM 원본 캐시는 `%TEMP%/kts/osm`에만 둔다.
