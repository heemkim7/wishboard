# db — IMPLEMENTED.md에 넣을 글

아래는 `IMPLEMENTED.md`의 해당 줄을 바꾸거나 더할 글이다. 운영 DB는 배포로 바뀌지 않는다. 운영자가 `migrations/2026-11-21-mid.sql`을 SQL 편집기에서 돌린 뒤부터 그 부분이 적용된다. 그 전에는 예전과 같다.

## `전광판` › 무료 첫 칸 (57줄을 바꾼다)

- 무료 첫 칸 목록은 데이터베이스가 가진다. `public.starter_slots()`(`IMMUTABLE`, `text[]`)가 하나뿐인 목록이고 `claim_billboard`의 무료 모드가 이것으로 칸을 검사한다. 마이그레이션 1부 뒤의 목록은 12칸이고 붕어빵 포차에서 가까운 순서다. `STREET_20` `STREET_23` `STREET_28` `STREET_19` `STREET_27` `STREET_16` `STREET_22` `STREET_7` `STREET_11` `STREET_9` `STREET_8` `STREET_10`. 메인 타워, 코너, 분양 앞 칸은 무료가 아니다. 1부 전의 데이터베이스는 예전 네 칸(`STREET_8`~`STREET_11`)만 받는다.
- Worker는 `starter_slot_list(p_key)`(FLUSH_KEY, 틀리면 예외)로 목록을 읽는다(`starterSlots(env)`, 캐시 `STARTER_C`). 받은 목록은 isolate마다 10분 쓴다. 함수가 없거나, 실패하거나, 1.5초 안에 답이 없거나, 목록에 거리 칸이 하나도 없으면 마지막으로 받은 좋은 목록을 그대로 두고(한 번도 없었으면 예전 네 칸) 60초 뒤에 다시 묻는다. 같은 때 들어온 요청은 묻기 하나를 같이 기다린다.
- `GET /rt/config`는 `{ url, key, starter }`다. Supabase를 기다리지 않는다. 지금 캐시의 목록(없으면 예전 네 칸)을 바로 주고, 캐시가 지났으면 `ctx.waitUntil`로 새로 묻는다. 예전 네 칸은 12칸의 일부라서 늦은 목록을 줘도 없는 무료 칸을 권하지 않는다.
- 무료 모드 `/rt/claim-billboard`: 입찰 0 검사 다음에 칸을 본다. 데이터베이스에서 받은 목록이 있으면(`good`) 그 목록에 없는 칸은 400 `무료 칸은 계정당 한 번이고, 비어 있는 거리 칸만 돼요`이고 Supabase를 부르지 않는다. 받은 목록이 없으면 `^STREET_\d+$` 모양만 보고 `claim_billboard`가 정한다(거절은 `starter`, 같은 문구). 나머지 규칙은 그대로다. 계정당 한 번(`profiles.starter_slot`), 켜져 있지 않은 칸(SQL)과 주인이 없는 칸(Worker), 입찰 0, 게스트는 hello 보너스 뒤.
- 같은 IP KST 하루 3회는 Meter `acct`의 `sipTake(hash, day, 3)` 한 번으로 세고 늘린다(DO가 한 번에 한 호출만 돌리므로 동시에 보내도 3회를 넘지 못한다). 문구 검사를 지난 뒤, `claim_billboard`를 부르기 직전에 잡고, 그 호출이 실패하거나 거절되거나 네트워크 예외로 던지면 `sipGive`로 돌려준다. 저장은 예전과 같은 `ag` 표 `sip` 줄이다. `sipGet`/`sipAdd`는 남아 있으나 이 길에서는 쓰지 않는다.
- 화면: `balance.js`의 `BALANCE.starterSlots`는 getter다. 서버 목록이 있으면 그것, 없으면 `STARTER_DEFAULT`(예전 네 칸)다. `net.js` `loadConfig`가 `/rt/config`의 `starter`를 `setStarterSlots`로 넣는다. 거리 칸 id만, 겹치지 않게, 순서대로 받고(`starterList`), 30개를 넘거나 맞는 것이 없으면 기본 네 칸으로 돌아간다. `loadConfig`는 Supabase CDN을 기다리지 않고 `init` 처음에 시작한다. 무료 칸 토스트, 다음 목표, 점령 마법사, 튜토리얼 길안내는 모두 이 getter를 지나고 목록의 첫 빈 칸(포차에서 가장 가까운 빈 칸)을 고른다. `claimWizard`의 `free`/`mode`/`payload`도 만들 때가 아니라 읽을 때 getter를 본다.
- 점령 마법사 1단계는 열린 무료 칸 가운데 앞의 4개만 보인다(요청한 칸은 그 밖이어도 보인다).

## `화면에서 이미 이어 둔 것`, `처음 1분` (119줄, 130줄)

- `비어 있는 STREET_8~11` / `첫 빈 STREET_8~11`을 `무료 첫 칸 목록의 첫 빈 칸`으로 바꾼다.

## `즉시 알림` › 탈퇴 (296줄을 바꾼다)

- 마이그레이션 2부 뒤 `withdraw_account`는 지갑을 지우기 전에 그 계정의 `push_subs` 줄도 지운다(다시 불러도 같다). 그래서 `pss`가 생기기 전에 Supabase에만 들어간 구독도 탈퇴 때 사라진다. 이 함수는 별칭을 모르므로 `ev`로 이어진 게스트가 Supabase에 남긴 구독은 지우지 않는다(Worker 쪽 `pss`는 지금처럼 별칭까지 지운다).

## `다녀간 사이와 받은 소식` (끝에 더한다)

- 마이그레이션 3부 뒤 `inbox_list`는 줄마다 `read`(`read_at`이 있으면 true)를 같이 준다. 순서는 그대로 `ORDER BY (read_at IS NULL) DESC, created_at DESC`, 20줄. `GET /rt/inbox`(`inboxList`)는 `read`가 참/거짓일 때만 줄에 넣는다. 3부 전에는 그 키가 없고 화면은 예전처럼 동작한다.

## `같이 보기` › 소속 지붕 (168줄 뒤에 더한다)

- 마이그레이션 4부 뒤 `award_tribe_roof(p_key, p_week)`는 요일을 보지 않는다. 표 `public.tribe_roofs`(`week` 기본 키, `tribe_id` NULL 가능, `awarded_at`, RLS 켬, 정책 없음)에 주마다 한 줄을 남긴다. `p_week`는 `^[0-9]{4}W(0[1-9]|[1-4][0-9]|5[0-3])$`(Worker `isoWeek()`와 같은 `2026W47` 꼴, 주 번호 01~53)이고, 돌려주는 모양은 다음 다섯 가지다.
  - `{ ok:false, error:'week' }`: 형식이 틀리거나 주 번호가 01~53 밖이다. 아무것도 바꾸지 않는다.
  - `{ ok:false, error:'open' }`: `p_week`가 지금 KST ISO 주(`to_char(timezone('Asia/Seoul', now()), 'IYYY"W"IW')`)와 같거나 뒤다. 끝난 주만 정한다.
  - `{ ok:true, done:true }`: 그 주가 이미 `tribe_roofs`에 있다(동시에 두 번 불러도 한 번만 정한다). 더 뒤의 주가 이미 정해져 있으면 그 주를 적기만 하고 지붕은 건드리지 않은 채 이것을 준다.
  - `{ ok:true, tribe_id }`: 그 주 `tribe_scores`에서 `points > 0`인 소속 가운데 `points` 내림차순, 같으면 `tribe_id` 오름차순 첫째. 모든 소속의 `roof_until`을 비우고 그 소속만 `now() + 7일`로 둔다.
  - `{ ok:true, roof:'' }`: 점수 낸 소속이 없다. `tribe_id` NULL로 그 주를 적고 모든 지붕을 비운다.
- 4부 전의 함수는 KST 일요일이 아니면 `{ ok:true, skipped:true }`이고 주를 기록하지 않는다. 지금 Worker는 일요일에 지금 주(`isoWeek()`)로 부르므로 4부 뒤에는 `open`을 받는다. 지난 주로 부르는 것은 `league` 묶음의 Worker 코드가 맡는다.

## 새 섹션 `마이그레이션`

- 운영 DB는 `npx wrangler deploy`로 바뀌지 않는다. `migrations/`의 SQL을 운영자가 Supabase SQL 편집기에서 손으로 돌린다. `.assetsignore`의 `**/*.sql` 때문에 정적 에셋으로 나가지 않는다.
- `2026-11-21-mid.sql`: 한 번에 붙여 실행하는 파일. 네 부분(1 무료 첫 칸 12개, 2 탈퇴 때 `push_subs`, 3 `inbox_list`의 `read`, 4 소속 지붕 주마다 한 번)이 각자 `BEGIN … COMMIT`이고, 부분 안의 `DO` 블록이 바깥 예외를 잡아 그 부분만 되돌리고 `WARNING`을 남긴 뒤 다음 부분으로 간다. 몇 번을 돌려도 같다.
  - 1~3부는 큰 함수를 다시 쓰지 않는다. `pg_get_functiondef`로 지금 운영 정의를 읽어, 새 글이 이미 있으면 아무것도 하지 않고, 바꿀 글이 정확히 한 번 있을 때만 그 글만 바꿔 `EXECUTE`한다. 아니면 `중단: 운영 DB의 <함수>에서 바꿀 줄을 N번 찾았습니다(1번이어야 함). 이 부분은 바뀌지 않았습니다.` 운영에서 다른 곳을 손으로 고친 것은 남고, `SECURITY DEFINER`, `search_path`, 권한은 그대로다. 1부는 `starter_slots`, `starter_slot_list`(둘 다 `anon, authenticated, service_role` EXECUTE)도 같은 블록에서 만들어서, 검사 줄을 못 바꾸면 이 둘도 생기지 않는다(그때 Worker는 예전 네 칸).
  - 4부는 지금 정의에 요일 검사 글이 그대로 있을 때만 `tribe_roofs`를 만들고 함수를 통째로 바꾼다. 이미 `tribe_roofs`를 쓰면 건너뛰고, 둘 다 아니면 중단 문구를 낸다.
  - 마지막 `SELECT`는 표 하나(`part`, `applied`, `note`)다. 운영 정의를 읽어 부분마다 들어가 있는지를 보인다. 멈춘 부분의 `note`는 `안 바뀜: ` 뒤에 그 이유(예: `중단: … 바꿀 줄을 0번 찾았습니다…`)다. 이유는 이 실행 세션의 임시 표 `kts_mid(part, why)`에 적고, 그 부분이 나중에 성공하면 지운다. 편집기가 `destructive operation` 경고를 띄울 수 있는데, 2부가 넣는 `withdraw_account` 본문에 `DELETE`가 있어서다.
  - `schema.sql`은 예전 schema.sql에 이 파일을 돌린 결과와 같다(함수 정의·권한·열·RLS, `test/db.test.mjs`가 견준다).
- `2026-11-21-cleanup-preview.sql`: 운영 정리 미리보기. 블록마다 골라서 실행한다(편집기는 마지막 결과만 보인다).
  - 1부는 SELECT 하나, 표 하나다. `kind`가 `봇 지갑`(닉네임 `^네온봇[0-9]+$`), `점검 지갑`(`guest:`이고 닉네임 `^점검[0-9]+$`), `테스트 같은 칸`(주인이 있고 주인 이름·세 줄에 `테스트` `test` `점검` `ㅁㄴㅇㄹ` `asdf` `qwer` `zxcv`나 자모만 4자 이상, 또는 위 지갑의 칸). 열은 id, 이름, 칸 주인, `guest`, 코인, 누적 사용, 처음 본 때, 가진 칸, 분양 수, 소속, `tribe_owner`, 세 줄, 입찰, 켜짐. 1부-선택은 지울 줄 수의 어림이다.
  - 2부는 주석이고 한 트랜잭션이다. 대상을 이름 규칙으로 다시 고르지 않는다. 운영자가 1부에서 복사한 지갑 id와 칸 id를 두 `ARRAY[...]`에 적는다. 지갑 id가 하나라도 `guest:`로 시작하지 않으면 멈추고 아무것도 바꾸지 않는다. 적은 칸과 그 지갑의 칸을 `takedown_billboard`처럼 `운영자가 내렸습니다`·링크 없음·`takedown` 기록으로, `withdraw_account`처럼 주인 없음·시계 지금으로 비운다. 사진은 `removed`(환불 없음). 분양을 빈 땅으로 돌리고 그 지갑을 가리키는 줄(심사, 사진, 우편, `push_subs`, 신고, `coin_ledger`, `billboard_history`)과 지갑을 지운다(`profiles`, `inventory`, `tribe_members`는 CASCADE, `tribe_pool`과 `tribes`는 남긴다. 소속 주인이던 지갑을 지우면 그 소속은 주인 없이 남는다). 되돌릴 수 없다. Durable Object에 남은 기록은 건드리지 않는다.
- 검증: `test/db.test.mjs`는 PGlite가 저장소 밖(`%TEMP%/kts-pglite` 또는 `PGLITE_DIR`)에 있으면 schema.sql 전체를 PGlite에 올려(역할 `anon` `authenticated` `service_role`만 흉내) 두 SQL 파일을 실제로 돌린다. 없으면 그 묶음만 건너뛰고 그렇게 적는다.
