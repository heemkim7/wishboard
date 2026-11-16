# Phase 1 Moderation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 닉, 전광판 세 줄, 에어 문구, 필지 간판은 금칙어로 거절하고, 링크는 허용 호스트만 저장하며, S급 점령은 승인 전에 칸을 바꾸지 않는다.

**Architecture:** 목록은 `plaza-account.js` 한 곳에 두고 Worker와 클라가 같이 import한다. 응원은 `CHEER_PHRASES`의 번호만 `{t:'CHEER', slot, p}`로 보낸다. S급은 `billboard_reviews`에 `pending`으로 두고 `review_slot_claim`이 설계 4.1의 환불 식을 승인 시점에 적용한다.

**Tech Stack:** `plaza-account.js`, `worker.js`, `schema.sql`, `admin.html`, `ui.js`, `node --test`.

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

전략 `p1-moderation`. 설계 4.6, 4.7, 5.7의 `reports`와 `billboard_reviews`, 6.1 `CHEER`, 6.3 `POST /rt/report`와 관리자 리뷰·내리기. 경제 계획의 `claimSplit` 정수와 `PAY.cheer`를 유지한다.

## 실행 순서

설계 10장 순서 2. `2026-11-15-p1-economy.md` 다음. `worker.js`와 `schema.sql`과 `claim_billboard`를 이 계획이 다시 연다. `p1-ftue`보다 먼저 병합한다.

캐시 토큰: `20261116b`.

### Task 1: 금칙어, 링크, 응원 문구

**Files:**
- Modify: `plaza-account.js`
- Test: `test/moderation-lists.test.mjs`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `export const CHEER_PHRASES` 설계 4.7 배열 그대로. index 0이 소켓 `p = 1`.
  - `export const LINK_HOSTS`
  - `export const BAN_WORDS`
  - `export function blockedText(text)`
  - `export function allowedLink(url)`

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { CHEER_PHRASES, LINK_HOSTS, BAN_WORDS, blockedText, allowedLink } from '../plaza-account.js';

it('uses the fixed cheer list and the link allowlist', () => {
  assert.deepEqual(CHEER_PHRASES, [
    '응원해요', '오늘도 빛나요', '이름이 보여요', '같이 걸어요',
    '대단해요', '축하해요', '힘을 내요', '보고 있어요',
    '최고예요', '내일도 켜요', '우리 편이에요', '타임스퀘어에 걸렸어요',
  ]);
  assert.equal(BAN_WORDS.length > 0, true);
  assert.equal(blockedText('안녕'), false);
  assert.equal(blockedText('아' + BAN_WORDS[0] + '야'), true);
  assert.equal(allowedLink('https://www.youtube.com/watch?v=abc'), 'https://www.youtube.com/watch?v=abc');
  assert.equal(allowedLink('https://evil.example/youtube.com'), null);
  assert.equal(LINK_HOSTS.includes('threads.net'), true);
  assert.equal(LINK_HOSTS.includes('smartstore.naver.com'), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/moderation-lists.test.mjs`

Expected: FAIL. `CHEER_PHRASES`가 export되지 않는다.

- [ ] **Step 3: Write minimal implementation**

`plaza-account.js`에 추가한다.

```js
export const CHEER_PHRASES = Object.freeze([
  '응원해요', '오늘도 빛나요', '이름이 보여요', '같이 걸어요',
  '대단해요', '축하해요', '힘을 내요', '보고 있어요',
  '최고예요', '내일도 켜요', '우리 편이에요', '타임스퀘어에 걸렸어요',
]);

export const BAN_WORDS = Object.freeze([
  '씨발', '시발', '병신', '좆', '지랄',
  'fuck', 'shit', 'bitch', 'nigger', 'nigga',
]);

export const LINK_HOSTS = Object.freeze([
  'instagram.com', 'www.instagram.com',
  'threads.net', 'www.threads.net',
  'youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com',
  'smartstore.naver.com',
]);

export function blockedText(text) {
  const hay = String(text || '').toLowerCase();
  return BAN_WORDS.some((w) => hay.includes(String(w).toLowerCase()));
}

export function allowedLink(url) {
  const raw = String(url || '');
  if (!raw.startsWith('https://') || raw.length > 200) return null;
  let host = '';
  try { host = new URL(raw).hostname.toLowerCase(); } catch { return null; }
  const ok = LINK_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  return ok ? raw.slice(0, 200) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/moderation-lists.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add plaza-account.js test/moderation-lists.test.mjs
git commit -m "feat: share the cheer list, blocklist, and link allowlist"
```

### Task 2: 응원 소켓과 신고

**Files:**
- Modify: `worker.js`, `schema.sql`, `test/plaza.test.mjs`
- Test: `test/plaza.test.mjs`

**Interfaces:**
- Consumes: `CHEER_PHRASES`, `blockedText`, `PAY.cheer` (`base` 4, `gapMs` 12000, `perHour` 30), `SLOT_RE`, `repeatPay`
- Produces: 클라 → Room `{t:'CHEER', slot, p}` `p`는 1–12. 성공 시 `{t:'PAY', kind:'cheer', amount}`. 보유자 자신, 꺼진 칸, 12초 미만은 `{t:'PAY'}` 없음. `POST /rt/report` `{ slot, reason }` `reason` ∈ `abuse` | `ad` | `impersonation` | `other` → `{ ok:true }`. 계정·칸·KST 하루 1회. 북극성 `touch`에 응원 성공 1행 `INSERT OR IGNORE`. `EVENT_NAMES`에 `cheer`를 넣는다.

- [ ] **Step 1: Write the failing test**

`test/plaza.test.mjs` describe 안에 추가한다.

```js
  it('pays a numbered cheer and stores one report a day', async () => {
    const origNow = Date.now;
    let clock = Date.parse('2026-11-15T03:00:00Z');
    Date.now = () => clock;
    globalThis.fetch = okFetch;
    try {
      const { room } = makeRoom();
      const me = openSock(room, 'guest:cheer');
      await room.webSocketMessage(me, JSON.stringify({ t: 'CHEER', slot: 'STREET_8', p: 1 }));
      const pay = msgs(me).filter((m) => m.t === 'PAY').at(-1);
      assert.equal(pay.kind, 'cheer');
      assert.equal(pay.amount, 4);
      clock += 11000;
      await room.webSocketMessage(me, JSON.stringify({ t: 'CHEER', slot: 'STREET_8', p: 99 }));
      assert.equal(msgs(me).filter((m) => m.t === 'PAY' && m.kind === 'cheer').length, 1);
    } finally {
      Date.now = origNow;
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/plaza.test.mjs`

Expected: FAIL. `PAY` cheer가 없다.

- [ ] **Step 3: Write minimal implementation**

`schema.sql`에 설계 5.7 `reports` DDL을 그대로 넣는다. 유니크 인덱스 이름 `reports_day_idx`.

`worker.js` `webSocketMessage`에 분기를 추가한다.

```js
    else if (m.t === 'CHEER' && a.q) this.cheer(w, a, m);
```

```js
  cheer(w, a, m) {
    const p = Math.floor(Number(m.p));
    if (!AD_SLOT.test(String(m.slot || '')) || p < 1 || p > 12) return;
    this.tapDb();
    const now = Date.now();
    if (now - this.gateAt(a.k + '|cheer:' + m.slot) < PAY.cheer.gapMs) return;
    this.gateSet(a.k + '|cheer:' + m.slot, now);
    const amount = this.repeatPay(a, PAY.cheer.base, '', 'cheer', 12, PAY.cheer.perHour);
    if (amount < 1) return;
    const q = this.ctx.storage.sql, day = kstDay();
    agPut(q, a.k, 'qc', day, agGet(q, a.k, 'qc', day) + 1);
    this.tx(w, { t: 'PAY', kind: 'cheer', amount });
    this.env.METER.get(this.env.METER.idFromName('ev')).touch(isoWeek(now), a.k).catch(() => {});
  }
```

꺼진 칸과 자기 칸 거절은 Worker가 `readWorld` 캐시의 그 슬롯 `holder_id`와 `expires_at`을 보고 한다. 보유자 id가 `a.k`와 같거나 `expires_at`이 지났으면 return. 문구 문자열은 저장하지 않는다. 수신함 insert는 `p1-return`의 `inbox_batch`가 받는다. 이 계획은 `phrase: p`와 `from_name`(닉 12자)을 flush 페이로드에 실을 배열 `this.inboxQ`에만 쌓아 둔다. 테이블이 없으면 flush는 그 배열을 건너뛴다.

`POST /rt/report`는 Bearer 계정으로 `reports`에 insert하고, 유니크 위반이면 `{ ok:true }`를 그래도 반환한다(이미 접수). `reason`이 네 값 밖이면 400.

`EVENT_NAMES`에 `'cheer'`를 추가한다. `wish_cheer`는 지우지 않는다.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/plaza.test.mjs test/moderation-lists.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add worker.js schema.sql plaza-account.js test/plaza.test.mjs
git commit -m "feat: accept numbered cheers and one report per board per day"
```

### Task 3: S급 사전 검수와 관리자 내리기

**Files:**
- Modify: `schema.sql`, `worker.js`, `admin.html`
- Test: `test/economy-balance.test.mjs`

**Interfaces:**
- Consumes: `claim_billboard` 14인자, `claimSplit`과 같은 `* 80 / 100`과 `/ 2`, `blockedText`, `adminOk`
- Produces: `review_slot_claim(p_key text, p_id bigint, p_approve boolean)`, `takedown_billboard(p_key text, p_slot_id text)`, `POST /rt/admin/review` `{ id, approve:boolean }`, `POST /rt/admin/takedown` `{ slot }`, `GET /rt/admin/reports`. 모두 `adminOk`. S급 `claim` 응답에 `review_id`가 있으면 칸은 그대로다.

- [ ] **Step 1: Write the failing test**

```js
it('names the S-tier review RPCs', () => {
  const sql = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.billboard_reviews/);
  assert.match(sql, /FUNCTION public\.review_slot_claim\(p_key TEXT, p_id BIGINT, p_approve BOOLEAN\)/);
  assert.match(sql, /FUNCTION public\.takedown_billboard\(p_key TEXT, p_slot_id TEXT\)/);
  assert.match(sql, /운영자가 내렸습니다/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/economy-balance.test.mjs`

Expected: FAIL. `review_slot_claim`이 없다.

- [ ] **Step 3: Write minimal implementation**

`billboard_reviews`는 설계 5.7 DDL 그대로다.

`claim_billboard`에서 tier가 `S`이고 `p_mode`가 `claim`인 경우, 보드 UPDATE 전에 멈춘다. 최저가·보호·`auction_closed`·`blockedText`에 해당하는 금칙(Worker가 RPC 전에 거절해도, SQL은 제어 문자만 보던 기존 검사를 유지)을 통과한 뒤:

```sql
  IF v_board.tier = 'S' AND p_mode = 'claim' THEN
    IF EXISTS (SELECT 1 FROM public.billboard_reviews WHERE slot_id = p_slot_id AND status = 'pending') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'pending');
    END IF;
    IF v_wallet.coins < p_bid THEN
      RETURN jsonb_build_object('ok', false, 'error', '코인이 부족합니다. 붕어빵을 더 구워보세요!');
    END IF;
    UPDATE public.wallets SET coins = coins - p_bid, updated_at = now() WHERE actor_id = p_actor_id;
    INSERT INTO public.coin_ledger (actor_id, delta, reason, ref) VALUES (p_actor_id, -p_bid, 'claim', p_slot_id);
    INSERT INTO public.billboard_reviews (slot_id, actor_id, bid, payload)
    VALUES (p_slot_id, p_actor_id, p_bid, jsonb_build_object(
      'nickname', left(p_nickname, 16), 'line1', left(p_line1, 16), 'line2', left(p_line2, 16), 'line3', left(p_line3, 16),
      'emoji', left(COALESCE(p_emoji, '✨'), 4), 'bg_theme', p_bg_theme, 'text_color', p_text_color,
      'external_url', p_external_url, 'caption_y', p_caption_y))
    RETURNING id INTO v_review;
    RETURN jsonb_build_object('ok', true, 'review_id', v_review, 'remaining_coins', v_wallet.coins - p_bid);
  END IF;
```

`review_slot_claim`은 `status = 'pending'`일 때만 동작한다. `p_approve`가 false면 `rejected`로 바꾸고 `bid`를 구매자에게 그대로 더한다. `coin_ledger.reason`은 `refund`. 80% 식을 쓰지 않는다. true면 설계 4.1의 살아 있는 칸 식을 그 시점의 `current_bid`에 적용해 이전 보유자와 지주에게 넣고, 그 다음 보드 행을 페이로드로 갱신한다. 승인 때 구매자를 다시 차감하지 않는다. 창이 닫힌 뒤에도 승인할 수 있다.

`takedown_billboard`는 `line1`을 `운영자가 내렸습니다`, `line2`와 `line3`를 `''`, `external_url`을 null로 둔다. `current_bid`와 코인은 되돌리지 않는다. `billboard_history.event`는 `takedown`다.

Worker는 `blockedText`가 닉, 세 줄, 에어 문구, 필지 `sign_text`에 걸리면 RPC 전에 `{ ok:false, error:'blocked' }`를 반환한다. `external_url`은 `allowedLink`가 null이면 필드 자체를 null로 넣고, 거절 메시지는 내지 않는다(링크만 빠진다).

`admin.html`에 신고 목록, S급 대기, 내리기 버튼을 추가한다. 기존 사진 탭은 유지한다. 요청 헤더는 `x-admin-key`. 키를 URL에 넣지 않는다.

관리자 경로:

```js
if (u.pathname === '/rt/admin/reports' && req.method === 'GET') { /* adminOk, { items } */ }
if (u.pathname === '/rt/admin/review' && req.method === 'POST') { /* { id, approve } → review_slot_claim */ }
if (u.pathname === '/rt/admin/takedown' && req.method === 'POST') { /* { slot } → takedown_billboard */ }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/economy-balance.test.mjs test/moderation-lists.test.mjs test/plaza.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add schema.sql worker.js admin.html test/economy-balance.test.mjs
git commit -m "feat: hold S-tier claims for review and let an admin take a board down"
```

### Task 4: 점령 창에서 자유 문구 응원을 뺀다

**Files:**
- Modify: `ui.js`, `main.js`, `index.html`
- Test: `test/moderation-lists.test.mjs`

**Interfaces:**
- Consumes: `CHEER_PHRASES`, `{t:'CHEER', slot, p}`
- Produces: 없음. 15자 응원 input은 DOM에 남지 않는다.

- [ ] **Step 1: Write the failing test**

```js
import { readFileSync } from 'node:fs';
it('the arrival card no longer has a free-text cheer field', () => {
  const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
  assert.equal(ui.includes('한 줄 응원, 15자'), false);
  assert.match(ui, /CHEER_PHRASES/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/moderation-lists.test.mjs`

Expected: FAIL. `한 줄 응원, 15자`가 `ui.js`에 있다.

- [ ] **Step 3: Write minimal implementation**

도착 카드의 텍스트 input을 `CHEER_PHRASES` 12개 버튼으로 바꾼다. 클릭은 `hooks.cheer(slot, index + 1)`이다. `main.js`는 그걸 `{ t:'CHEER', slot, p: phraseId }`로 보낸다. `p` 외의 문자열은 보내지 않는다.

`index.html`의 `main.js?v=`와 바뀐 import를 `20261116b`로 맞춘다.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/moderation-lists.test.mjs test/plaza.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add ui.js main.js index.html test/moderation-lists.test.mjs
git commit -m "feat: replace the free-text cheer box with the twelve phrases"
```
