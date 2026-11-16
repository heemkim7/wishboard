# Phase 0 Trust Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 0단계 네 할 일(플레이 오류, 계정·보상 가드, 가짜 주인 제거, 측정과 소켓 동기화)이 트리에 이미 있는 상태로 고정하고, 남은 일은 캐시 토큰 정렬과 로컬 검증, 운영자 배포 순서뿐이다.

**Architecture:** 이 계획은 기능을 다시 만들지 않는다. 설계 2장의 심볼이 파일에 있는지 테스트로 잠그고, 어긋나면 그 블록만 되돌린다. 배포와 스키마 적용은 태스크 밖에서 운영자가 한다.

**Tech Stack:** 빌드 없는 ES 모듈, Cloudflare Workers, Durable Objects, Supabase RPC, `node --test` (package.json 없음).

## Global Constraints

- Meter DO 일일 예산 가드는 80% lean, 95% hard를 유지한다. `PLAN=paid`를 넣지 않는다. Workers 계정은 운영자가 올리기 전까지 Free다. `env.PLAN === 'paid'`는 유료 전용 작업을 건너뛰는 런타임 검사로만 쓴다.
- Room DO WebSocket hibernation을 유지한다. 핑, 스태일, 알람 주기와, 사람이 없을 때 알람 해제를 지우지 않는다.
- 위치 패킷은 `v2: {t:'P', k, a:[x,y,...]}`다. 서버가 받는 기존 메시지는 `t:'p'`이고, 릴레이는 `t:'P'`다. 이 둘을 한 글자로 합치지 않는다. 같은 층, `NEAR_R` 1600 안을 우선하고 먼 피어는 `FAR_MS`로 줄인다. `net.js` 데드레커닝 1.15초를 유지한다.
- `/rt/guest`는 HMAC(`GUEST_KEY`)이다. Supabase 익명 가입으로 바꾸지 않는다.
- 내 캐릭터 위치는 로컬 입력만 쓴다. 서버 좌표로 내 플레이어를 덮어쓰지 않는다. 좌표 변환은 `toNetUnits` / `fromNetUnits`만 쓴다. `floor = 0`.
- 자유 텍스트 채팅은 없다. 리액션은 `{t:'E', k, e: 1~4}`다.
- 브라우저에는 publishable 키만 둔다. `service_role`을 코드에 넣지 않는다. `.dev.vars`를 읽거나 커밋하지 않는다. 시크릿 값을 채팅, 코드, 커밋 메시지에 적지 않는다.
- 지도는 OSM만 쓴다. `ts3d/nycmeta.js`를 손으로 고치지 않는다.
- `schema.sql`은 통째로 다시 실행한다. 변경은 멱등이다. `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS`, `CREATE INDEX IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`. `DROP TABLE`은 없다. 시그니처가 바뀌는 함수만 `DROP FUNCTION IF EXISTS`로 그 시그니처를 지운 뒤 만든다.
- 캐시: 이번 태스크에서 바뀐 모듈의 import `?v=`와 `index.html`의 `main.js?v=`를 같은 토큰으로 함께 올린다.
- 태스크 안에서 `npx wrangler deploy`, Supabase SQL 실행, `.dev.vars` 읽기, `git push`를 하지 않는다.
- 테스트는 `node`로 직접 실행한다. `package.json`을 만들지 않는다. `test/cf-stub.mjs`와 `test/plaza.test.mjs` 방식을 따른다. `https://studio.wishboard.workers.dev`를 호출하지 않는다. 테스트는 프로덕션 Supabase에 점령·지급을 쓰지 않는다. 로컬 `wrangler dev`도 프로덕션 DB를 본다.
- 이름표 색은 재질 이름이 `Main`인 메시에만 칠한다.
- 원점은 7번가 × W 45th St. 북쪽은 −Z, 동쪽은 +X. 채널은 `chapel:square`부터 `chapel:square-8`. `CAP`은 50이다.

---

## 범위

전략 프론트의 `p0-bugs`, `p0-security`, `p0-honesty`, `p0-infra`와 설계 2장·10장 순서 0. `PLAN=paid`와 Workers 유료 전환은 운영자 작업이라 이 계획에 넣지 않는다. 카카오 로그인도 넣지 않는다.

## 실행 순서

설계 10장 순서 0. 선행 계획 없음. 이후 `2026-11-15-p1-economy.md`가 `worker.js`를 연다. 이 계획이 끝난 뒤에만 1단계로 간다.

## 이미 구현된 것 (기준: 작업 트리, 커밋 `59d054a` 위)

| 전략 항목 | 파일 | 심볼 |
| --- | --- | --- |
| 관람 teleport | `timesSquare3d.js` | `startLounge`가 같은 API의 `teleport(x, z)`를 호출한다. 좌표는 `teleport(-21, -112)`. |
| 부스트 효과음 | `ui.js` | `sfx.boost`는 `tone()`이다. `main.js` `onBoost`가 `ui.sfx.boost()`를 호출한다. |
| 인앱 로그인 copy | `ui.js` | `openLogin` 안의 지역 변수 `copy`. `hooks.authEnv()`의 `handoverUrl`을 클립보드에 넣고, 실패하면 읽기 전용 input에 넣는다. |
| 출석·미션·복주머니 | `ui.js` `payDue`, `main.js` `onBalloon` | `hooks.bonus('attend', coins)` / `hooks.bonus('mission', BALANCE.missionReward)` / `payBonus('pouch', 30)`이 참일 때만 지급으로 기록한다. |
| 퀘스트 저장 | `ui.js` `loadDay` | 같은 KST 날이면 `fare`, `stunt`, `cheer`, `qPaid`를 유지한다. |
| 계정 창이 축하를 가리지 않음 | `ui.js` `pumpLink` | `proof.hidden && sponsorEl.hidden && !hooks.cineOn()`일 때만 `openLinkPrompt`. |
| 게스트 인계 | `worker.js` | `POST /rt/handover`, `POST /rt/guest`는 `b.h` 또는 `b.t`일 때만 같은 `sub`를 재발급한다. |
| 계정 단위 한도 | `worker.js` | `Room.bonus`, `agGet` / `agPut`, 방 이동은 `acct`의 `seat` / `evict`. |
| FARE 게이지 | `worker.js` | `credit()`이 참을 반환한 뒤에만 `bumpFeverCount`. |
| 링크 방문 상한 | `worker.js` | `adClick`, `AD_PAY = 15`, `AD_DAY = 5`. |
| 게스트 속도 | `worker.js`, `wrangler.jsonc` | `GUEST_RL` limit 10, period 60. `EVENT_RL` limit 600, period 60. |
| 가짜 주인 | `balance.js` | `chainsOf`는 `rival:`를 보지 않는다. `fillRivals`는 없다. |
| 빈 칸 | `ts3d/screens.js` | `defaultData(slotId)`가 `holder_id: null`인 칸 이름·최저가를 그린다. |
| 봇 | `tools/plaza-bots.mjs` | `TOPIC = 'chapelqa:square'`, 기본 호스트 `http://localhost:8787`. |
| 첫 화면 0명 | `main.js` | `paintBootLive`. `today.visitors` / `today.wishes` / `here.live`가 0이면 그 조각을 생략한다. |
| 20초 폴링 제거 | `main.js` | `resync`. 온라인 전환 때 1회, 오프라인이면 60초. |
| 측정 | `plaza-account.js` | `EVENT_NAMES`. `POST /rt/event`는 `{ name, sid, p }`. |
| 테스트 | `test/plaza.test.mjs` | S1–S6, I1, I2. `CAP`은 50. 슬롯 `MAIN_S`는 쓰지 않는다. |

0단계 스키마 diff는 `billboards.caption_y`와 `sell_coins_to_advertiser` 반환의 `buyer_id`뿐이다. 새 게임 테이블은 없다.

### Task 1: 0단계 심볼 잠금

**Files:**
- Create: `test/p0-contract.test.mjs`
- Modify: 없음. 실패할 때만 아래 복구 블록을 해당 파일에 넣는다.
- Test: `test/p0-contract.test.mjs`

**Interfaces:**
- Consumes: 설계 2장의 `Room.bonus(a, kind, amount, nick)`, `authEnv()` → `{ inApp, android, handoverUrl, intent }`, `paintBootLive`, `payDue`, `pumpLink`, `startLounge`, `sfx.boost`, `resync`, `AD_PAY`, `AD_DAY`, `GUEST_RL`, `EVENT_NAMES`
- Produces: 없음. 1단계가 이 심볼을 유지한 채로 확장한다.

- [ ] **Step 1: Write the failing test**

`test/p0-contract.test.mjs`를 만든다. 제품 코드를 아직 되돌리지 않는다.

```js
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

describe('phase 0 contracts', () => {
  it('keeps the play-bug fixes', () => {
    const ui = read('ui.js');
    const main = read('main.js');
    const world = read('timesSquare3d.js');
    assert.match(ui, /boost:\s*\(\)\s*=>\s*tone\(/);
    assert.match(main, /onBoost:\s*\(\)\s*=>\s*ui\.sfx\.boost\(\)/);
    assert.match(ui, /function openLogin\([\s\S]*const copy = h\('button'/);
    assert.match(ui, /handoverUrl/);
    assert.match(ui, /function payDue\(/);
    assert.match(ui, /function pumpLink\(/);
    assert.match(ui, /sponsorEl\.hidden && !hooks\.cineOn\?\.\(\)/);
    assert.match(world, /startLounge\(\) \{[\s\S]*api\.teleport\(-21, -112\)/);
    assert.match(world, /teleport\(x, z\)/);
    const load = ui.slice(ui.indexOf('function loadDay'), ui.indexOf('function payDue'));
    assert.match(load, /fare:/);
    assert.match(load, /stunt:/);
    assert.match(load, /qPaid:/);
  });

  it('keeps honesty, bots, boot counts, and the socket resync', () => {
    const main = read('main.js');
    const balance = read('balance.js');
    const bots = read('tools/plaza-bots.mjs');
    const screens = read('ts3d/screens.js');
    assert.equal(main.includes('fillRivals'), false);
    assert.equal(balance.includes('rival:'), false);
    assert.match(main, /function paintBootLive/);
    assert.match(main, /오늘 다녀간 사람/);
    assert.match(main, /오늘 걸린 소원/);
    assert.match(main, /function resync\(\)/);
    assert.match(main, /if \(net\.status !== 'online' && !document\.hidden\) resync\(\); \}, 60000\)/);
    assert.match(bots, /chapelqa:square/);
    assert.match(bots, /localhost:8787/);
    assert.equal(bots.includes('wishboard.workers.dev'), false);
    assert.match(screens, /function defaultData/);
    assert.match(screens, /holder_id: null/);
  });

  it('keeps the server guards and does not set PLAN=paid', () => {
    const worker = read('worker.js');
    const wrangler = read('wrangler.jsonc');
    const account = read('plaza-account.js');
    assert.match(worker, /AD_PAY = 15, AD_DAY = 5/);
    assert.match(worker, /attend: \[30, 0, 1\], mission: \[15, 0, 3\]/);
    assert.match(worker, /pouch: \[30, 25000\]/);
    assert.match(worker, /pathname === '\/rt\/handover'/);
    assert.match(worker, /GUEST_RL/);
    assert.match(wrangler, /"name": "GUEST_RL"/);
    assert.match(wrangler, /"limit": 10, "period": 60/);
    assert.match(wrangler, /"name": "EVENT_RL"/);
    assert.equal(wrangler.includes('"PLAN"'), false);
    assert.match(account, /page_landing/);
    assert.match(account, /first_coin/);
    assert.match(account, /session_end/);
    assert.equal(worker.includes("PLAN === 'paid' ?"), true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/p0-contract.test.mjs`

Expected: 세 테스트가 통과한다. 트리에 0단계가 이미 있다. 하나라도 실패하면 Step 3의 해당 블록만 복구하고 다시 실행한다. 실패 없이 통과하면 Step 3은 건너뛰고 Step 4로 간다.

- [ ] **Step 3: Restore only a missing symbol**

실패한 assertion에 해당하는 블록만 넣는다. 이미 있는 함수는 갈아엎지 않는다.

`timesSquare3d.js`의 API 객체 안에서 `startLounge`는 이렇게 끝난다.

```js
startLounge() {
  lounge = true;
  loungeAt = 0;
  loungeI = 0;
  api.teleport(-21, -112);
  yaw = 0;
  me.holder.rotation.y = 0;
},
teleport(x, z) {
  // 기존 순간이동 본문은 유지한다. 이 키가 API 객체에 있기만 하면 된다.
},
```

`ui.js`의 `sfx` 안에 부스트를 둔다.

```js
boost: () => tone([{ f: 160, to: 640, d: 0.3, type: 'sawtooth', g: 0.04 }, { f: 1175, d: 0.16, type: 'sine', g: 0.03, at: 0.1 }]),
```

`main.js`의 엔진 콜백은 `onBoost: () => ui.sfx.boost(),` 다.

`openLogin` 안에서 인앱 분기는 지역 변수 `copy`를 만들고 `hooks.authEnv()`의 `handoverUrl`만 복사한다. 게스트 id를 링크에 그대로 붙이지 않는다.

`payDue`는 `hooks.bonus`가 참을 돌려준 뒤에만 `paid.attend` 또는 `paid[key]`를 기록한다.

`loadDay`의 같은 날 분기는 `fare`, `stunt`, `qPaid`를 `prev`에서 복사한다.

`pumpLink`의 quiet 조건에는 `proof.hidden`, `sponsorEl.hidden`, `!hooks.cineOn?.()`가 모두 있다.

`worker.js`의 `bonus` spec 객체는 아래를 유지한다.

```js
const spec = { lounge: [3, 9000], stunt: [10, 15000], hive: [3, 4500], draw: [300, 240000], pouch: [30, 25000], quest: [100, 0, 4], attend: [30, 0, 1], mission: [15, 0, 3], hello: [BALANCE.firstCoins, -1] }[kind];
```

`FARE` 분기는 `this.credit(...)`가 참일 때만 `this.bumpFeverCount(a.k)`를 호출한다.

`wrangler.jsonc`의 `ratelimits`는 아래 두 항목을 유지하고, `vars.PLAN`은 넣지 않는다.

```jsonc
"ratelimits": [
  { "name": "GUEST_RL", "namespace_id": "4701", "simple": { "limit": 10, "period": 60 } },
  { "name": "EVENT_RL", "namespace_id": "4702", "simple": { "limit": 600, "period": 60 } }
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/p0-contract.test.mjs`

Expected: PASS, `3` tests.

- [ ] **Step 5: Commit**

```powershell
git add test/p0-contract.test.mjs timesSquare3d.js ui.js main.js worker.js wrangler.jsonc
git commit -m "test: lock phase 0 play, account, and honesty contracts"
```

워킹 트리에 복구 diff가 없으면 `test/p0-contract.test.mjs`만 스테이지한다.

### Task 2: 기존 서버 테스트가 통과하는지 확인

**Files:**
- Modify: 없음
- Test: `test/plaza.test.mjs`, `test/taxi-detach.test.mjs`, `tools/account.test.mjs`

**Interfaces:**
- Consumes: Task 1의 심볼. `test/plaza.test.mjs`의 `makeEnv`, `join`, `openSock`.
- Produces: 없음

- [ ] **Step 1: Write the failing test**

새 테스트를 만들지 않는다. 0단계가 이미 `test/plaza.test.mjs`에 S1–S6와 I1·I2를 넣었다. 그 파일이 없으면 Task 1 복구와 같은 원칙으로 `59d054a` 대비 작업 트리의 테스트 파일을 유지한다. 제품 코드를 새로 쓰지 않는다.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/plaza.test.mjs test/taxi-detach.test.mjs tools/account.test.mjs`

Expected: 전부 PASS. 실패하면 실패한 `it` 이름만 보고, 그 테스트가 가리키는 설계 2장 심볼을 Task 1의 복구 블록으로 되돌린 뒤 다시 실행한다. 새 경제 규칙으로 테스트를 고치지 않는다. 그 변경은 `p1-economy`가 한다.

- [ ] **Step 3: Write minimal implementation**

구현 없음. `worker.js`의 Meter 예산 상수 `LEAN = 0.8`, `HARD = 0.95`, `CAP = 50`을 바꾸지 않는다.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/plaza.test.mjs test/taxi-detach.test.mjs tools/account.test.mjs`

Expected: PASS. `MAIN_S` assertion이 없고, 프로덕션 호스트로 나가는 `fetch`가 없다.

- [ ] **Step 5: Commit**

테스트가 코드 변경 없이 통과하면 커밋하지 않는다. Task 1 복구가 남았으면 그 커밋에 포함되었는지 `git status`로 확인한다.

### Task 3: 캐시 토큰을 한 값으로 맞춘다

**Files:**
- Modify: `index.html`, `main.js`, `ui.js`, `net.js`, `analytics.js`, `timesSquare3d.js`, `ts3d/screens.js`
- Test: `test/p0-cachebust.test.mjs`

**Interfaces:**
- Consumes: 없음
- Produces: 엔트리 토큰 `20261115c`. 이후 계획은 자기 태스크의 토큰으로 다시 올린다.

- [ ] **Step 1: Write the failing test**

```js
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { it } from 'node:test';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

it('ships one cache token for the phase 0 modules', () => {
  const html = read('index.html');
  const token = (html.match(/main\.js\?v=([0-9a-z]+)/) || [])[1];
  assert.ok(token);
  const files = ['main.js', 'ui.js', 'net.js', 'analytics.js', 'timesSquare3d.js', 'ts3d/screens.js'];
  const changed = ['analytics.js', 'balance.js', 'net.js', 'plaza-account.js', 'timesSquare3d.js', 'ui.js', 'ts3d/art.js', 'ts3d/screens.js', 'ts3d/avatars.js'];
  for (const file of files) {
    const text = read(file);
    for (const mod of changed) {
      const bare = new RegExp("from '\\./" + mod.replace('.', '\\.') + "'");
      const stale = new RegExp("from '\\./" + mod.replace('.', '\\.') + "\\?v=(?!" + token + ")");
      assert.equal(bare.test(text), false, file + ' imports ' + mod + ' without ?v=');
      assert.equal(stale.test(text), false, file + ' imports ' + mod + ' on a different token');
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/p0-cachebust.test.mjs`

Expected: FAIL. `main.js`의 `./ts3d/avatars.js`에 `?v=`가 없고, `balance.js?v=20261113y`처럼 토큰이 여러 개다.

- [ ] **Step 3: Write minimal implementation**

아래 import의 쿼리만 `?v=20261115c`로 바꾼다. 모듈 경로는 유지한다.

`index.html`:

```html
<script type="module" src="./main.js?v=20261115c"></script>
```

`main.js`:

```js
import { Net, CDN, guestToken } from './net.js?v=20261115c';
import { createTimesSquare, AVATAR_COLORS, taxiTrainMult } from './timesSquare3d.js?v=20261115c';
import { speciesId } from './ts3d/avatars.js?v=20261115c';
import { starSpot, insideLoop } from './ts3d/layout.js?v=20261115c';
import { createUI } from './ui.js?v=20261115c';
import { BALANCE, chainBoost, chainsOf, live, monopolyOf, slotName, slotOf } from './balance.js?v=20261115c';
import { trackEvent } from './analytics.js?v=20261115c';
import { adoptHandover, chromeIntent, handoverHref, isAndroid, isInAppWebView, loginEmail, profileName, GT_LS, slotTier } from './plaza-account.js?v=20261115c';
```

`ui.js`에서 `art.js`, `balance.js`, `avatars.js`, `analytics.js`, `plaza-account.js`의 쿼리를 `20261115c`로 바꾼다. `layout.js`와 `nyc.js`는 0단계에서 안 바뀌었으면 그대로 둔다.

`net.js`의 `plaza-account.js` 쿼리를 `20261115c`로 바꾼다.

`analytics.js`의 `plaza-account.js` 쿼리를 `20261115c`로 바꾼다.

`timesSquare3d.js`에서 `net.js`, `balance.js`, `screens.js`, `art.js`, `avatars.js`의 쿼리를 `20261115c`로 바꾼다.

`ts3d/screens.js`의 `art.js` 쿼리를 `20261115c`로 바꾼다.

`sw.js?v=5`는 에셋이 안 바뀌었으므로 올리지 않는다.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/p0-cachebust.test.mjs test/p0-contract.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add index.html main.js ui.js net.js analytics.js timesSquare3d.js ts3d/screens.js test/p0-cachebust.test.mjs
git commit -m "fix: ship phase 0 modules on one cache token"
```

### Task 4: 운영자 검증 순서 (실행하지 않음)

**Files:**
- Modify: 없음
- Test: 없음

**Interfaces:**
- Consumes: `schema.sql`의 `caption_y`, `wrangler.jsonc`의 `GUEST_RL`과 `EVENT_RL`
- Produces: 배포 순서 문서. 코드 변경 없음.

- [ ] **Step 1: Write the failing test**

테스트 파일을 추가하지 않는다. 이 태스크의 산출물은 아래 순서이고, 에이전트는 실행하지 않는다.

- [ ] **Step 2: Run test to verify it fails**

실행하지 않는다. `npx wrangler deploy`와 Supabase SQL은 이 태스크의 명령이 아니다.

- [ ] **Step 3: Write minimal implementation**

운영자가 로컬 테스트가 통과한 뒤에, 직접 이 순서로 한다.

1. `schema.sql` 전체를 wishboard 프로젝트에 한 번 실행한다. `caption_y`는 `ADD COLUMN IF NOT EXISTS`라 다시 실행해도 된다. `sell_coins_to_advertiser`는 `CREATE OR REPLACE`다. 에이전트가 이 SQL을 대신 실행하지 않는다.
2. `GUEST_RL`과 `EVENT_RL` 바인딩이 있는 `wrangler.jsonc`를 `npx wrangler deploy`로 Worker `studio`에 올린다. `PLAN=paid`를 설정하지 않는다. `cf_release.py`를 쓰지 않는다. `masil-chapel-seoul`에 올리지 않는다.
3. 배포 뒤에 브라우저에서 입장, 붕어빵, 관람, 택시 부스트, 인앱이 아닌 계정 창, `?focus=` 입장을 한 번씩 본다. 계정 창이 축하 카드 위에 바로 뜨면 `pumpLink`를 다시 본다.
4. 운영 DB의 `네온봇` 행은 지우지 않는다.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/p0-contract.test.mjs test/p0-cachebust.test.mjs test/plaza.test.mjs`

Expected: PASS. 이 명령은 배포를 포함하지 않는다.

- [ ] **Step 5: Commit**

이 태스크는 파일이 없으면 커밋하지 않는다.
