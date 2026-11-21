-- 2026-11-21 운영 정리 미리보기: 봇·점검 지갑과 테스트 전광판.
--
-- 코드는 아무것도 지우지 않는다. 운영자가 Supabase SQL 편집기에서 손으로 돌린다.
-- 편집기는 마지막 문장의 결과만 보이므로, 블록마다 그 블록만 마우스로 골라(선택) 실행한다.
--
-- 1부(읽기 전용, 한 번에 표 하나): kind 열로 나뉜다.
--   '봇 지갑'      닉네임이 '네온봇'+숫자인 지갑(tools/plaza-bots.mjs가 만든 이름).
--   '점검 지갑'    닉네임이 '점검'+숫자인 guest: 지갑(라이브 점검 스크립트가 남긴 것).
--   '테스트 같은 칸' 주인이 있고, 주인 이름이나 세 줄에 테스트, test, 점검, 자판 두드림(ㅁㄴㅇㄹ, asdf, qwer, zxcv,
--                 자모만 4자 이상)이 있거나 봇·점검 지갑이 가진 칸. 자모 규칙은 ㅋㅋㅋㅋ, ㅠㅠㅠㅠ 같은 진짜 문구도
--                 잡으니 한 줄씩 보고 고른다.
--   guest 열이 false인 지갑은 로그인한 사람이다(닉네임만 비슷할 수 있다). 2부는 그런 id를 받지 않는다.
--   tribe_owner가 true인 지갑을 지우면 그 소속은 주인 없는 소속으로 남는다(소속과 모금은 지우지 않는다).
-- 1부-선택: 아래 2부가 지울 줄 수를 표마다 센다. 1부와 같은 이름 규칙으로 센 어림값이다.
--
-- 2부(기본은 주석, 한 트랜잭션, 되돌릴 수 없다):
--   대상은 이름 규칙으로 다시 고르지 않는다. 1부에서 고른 id를 맨 위 두 ARRAY[...]에 직접 복사해 넣는다.
--   지갑 id가 하나라도 guest:로 시작하지 않으면 아무것도 하지 않고 멈춘다.
--   - 적어 넣은 칸과 지울 지갑이 가진 칸을 비운다. takedown_billboard처럼 문구를 '운영자가 내렸습니다'로 바꾸고
--     링크를 지우고 'takedown' 기록을 한 줄 남긴 뒤, withdraw_account처럼 주인을 비우고 시계를 지금으로 돌린다.
--     걸려 있던 사진은 'removed'가 되고 요금은 돌려주지 않는다.
--   - 지울 지갑의 분양을 빈 땅으로 돌리고, 그 지갑을 가리키는 줄(심사 대기, 사진, 우편, 푸시 구독, 신고, 코인 기록,
--     전광판 기록)을 지운 다음 지갑을 지운다. profiles, inventory, tribe_members는 지갑을 따라 지워진다
--     (ON DELETE CASCADE). tribe_pool에 낸 모금은 소속의 코인이라 그대로 둔다.
--   - schema.sql에 없는 표가 운영 DB에서 지갑을 가리키면 지갑 삭제가 실패하고 트랜잭션 전체가 되돌아간다.
--   쓰는 법: 1부 결과를 읽고, 두 ARRAY[...]를 채우고, 2부의 줄 앞 '-- '를 모두 지운 뒤 2부만 골라 실행한다.
--   지운 지갑, 코인, 기록은 다시 살아나지 않는다.
--   Worker의 Durable Object(소원, 푸시 사본, 자리 표)에 남은 기록은 이 파일이 건드리지 않는다.

-- ============================================================================
-- 1부. 읽기 전용 (이 블록만 골라 실행)
-- ============================================================================
WITH marked AS (
  SELECT w.actor_id, CASE WHEN w.nickname ~ '^네온봇[0-9]+$' THEN '봇 지갑' ELSE '점검 지갑' END AS kind
  FROM public.wallets w
  WHERE w.nickname ~ '^네온봇[0-9]+$' OR (w.nickname ~ '^점검[0-9]+$' AND w.actor_id LIKE 'guest:%')
)
SELECT m.kind, w.actor_id AS id, w.nickname AS name, NULL::TEXT AS holder, w.actor_id LIKE 'guest:%' AS guest,
  w.coins, w.spent,
  LEAST(p.created_at, (SELECT min(l.created_at) FROM public.coin_ledger l WHERE l.actor_id = w.actor_id)) AS first_seen,
  (SELECT string_agg(b.slot_id, ' ' ORDER BY b.slot_id) FROM public.billboards b WHERE b.holder_id = w.actor_id) AS slots,
  (SELECT count(*) FROM public.plots t WHERE t.owner_id = w.actor_id) AS plots,
  (SELECT tm.tribe_id FROM public.tribe_members tm WHERE tm.actor_id = w.actor_id) AS tribe,
  EXISTS (SELECT 1 FROM public.tribe_members tm WHERE tm.actor_id = w.actor_id AND tm.role = 'owner')
    OR EXISTS (SELECT 1 FROM public.tribes tr WHERE tr.created_by = w.actor_id) AS tribe_owner,
  NULL::TEXT AS lines, NULL::BIGINT AS bid, NULL::BOOLEAN AS lit
FROM marked m
JOIN public.wallets w ON w.actor_id = m.actor_id
LEFT JOIN public.profiles p ON p.actor_id = w.actor_id
UNION ALL
SELECT '테스트 같은 칸', b.slot_id, b.holder_name, b.holder_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  concat_ws(' / ', b.line1, b.line2, b.line3), b.current_bid,
  COALESCE(b.lit_until, b.expires_at) > now()
FROM public.billboards b
WHERE b.holder_id IS NOT NULL AND (
  concat_ws(' ', b.holder_name, b.line1, b.line2, b.line3) ~* '(테스트|test|점검|ㅁㄴㅇㄹ|asdf|qwer|zxcv)'
  OR concat_ws(' ', b.holder_name, b.line1, b.line2, b.line3) ~ '[ㄱ-ㅎㅏ-ㅣ]{4,}'
  OR b.holder_id IN (SELECT actor_id FROM public.wallets
                     WHERE nickname ~ '^네온봇[0-9]+$' OR (nickname ~ '^점검[0-9]+$' AND actor_id LIKE 'guest:%')))
ORDER BY 1, 2;

-- ============================================================================
-- 1부-선택. 지울 줄 수 어림 (이 블록만 골라 실행)
-- ============================================================================
WITH bots AS (
  SELECT actor_id FROM public.wallets
  WHERE actor_id LIKE 'guest:%' AND (nickname ~ '^네온봇[0-9]+$' OR nickname ~ '^점검[0-9]+$')
)
SELECT 'wallets' AS what, count(*) AS n FROM bots
UNION ALL SELECT 'billboards held', count(*) FROM public.billboards WHERE holder_id IN (SELECT actor_id FROM bots)
UNION ALL SELECT 'plots owned', count(*) FROM public.plots WHERE owner_id IN (SELECT actor_id FROM bots)
UNION ALL SELECT 'billboard_reviews', count(*) FROM public.billboard_reviews WHERE actor_id IN (SELECT actor_id FROM bots)
UNION ALL SELECT 'billboard_photos', count(*) FROM public.billboard_photos WHERE actor_id IN (SELECT actor_id FROM bots)
UNION ALL SELECT 'inbox', count(*) FROM public.inbox WHERE actor_id IN (SELECT actor_id FROM bots)
UNION ALL SELECT 'push_subs', count(*) FROM public.push_subs WHERE actor_id IN (SELECT actor_id FROM bots)
UNION ALL SELECT 'reports', count(*) FROM public.reports WHERE reporter_id IN (SELECT actor_id FROM bots)
UNION ALL SELECT 'coin_ledger', count(*) FROM public.coin_ledger WHERE actor_id IN (SELECT actor_id FROM bots)
UNION ALL SELECT 'billboard_history', count(*) FROM public.billboard_history WHERE holder_id IN (SELECT actor_id FROM bots)
UNION ALL SELECT 'tribe_members', count(*) FROM public.tribe_members WHERE actor_id IN (SELECT actor_id FROM bots)
UNION ALL SELECT 'tribe_pool (kept)', count(*) FROM public.tribe_pool WHERE actor_id IN (SELECT actor_id FROM bots);

-- ============================================================================
-- 2부. 지우기 (되돌릴 수 없다). 기본은 주석이다.
-- ============================================================================

-- BEGIN;
-- CREATE TEMP TABLE kts_bots (actor_id TEXT PRIMARY KEY) ON COMMIT DROP;
-- CREATE TEMP TABLE kts_slots (slot_id TEXT PRIMARY KEY) ON COMMIT DROP;
-- -- 지울 지갑 id. 1부의 id 열에서 복사한다. 예: ARRAY['guest:g-...','guest:g-...']
-- INSERT INTO kts_bots (actor_id) SELECT DISTINCT unnest(ARRAY[]::TEXT[]);
-- -- 비울 칸 id. 1부의 '테스트 같은 칸'에서 고른다. 예: ARRAY['STREET_3','PLOT_2']. 지울 지갑이 가진 칸은 저절로 들어간다.
-- INSERT INTO kts_slots (slot_id) SELECT DISTINCT unnest(ARRAY[]::TEXT[]);
-- DO $guard$ BEGIN
--   IF EXISTS (SELECT 1 FROM kts_bots WHERE actor_id NOT LIKE 'guest:%') THEN
--     RAISE EXCEPTION '중단: guest:로 시작하지 않는 id가 있습니다. 로그인한 사람의 계정은 이 파일로 지우지 않습니다. 아무것도 바뀌지 않았습니다.';
--   END IF;
-- END $guard$;
-- INSERT INTO kts_slots (slot_id) SELECT slot_id FROM public.billboards WHERE holder_id IN (SELECT actor_id FROM kts_bots) ON CONFLICT DO NOTHING;
--
-- UPDATE public.billboard_photos SET status = 'removed', jpeg = ''::BYTEA, reviewed_at = now()
--   WHERE status IN ('pending', 'approved')
--     AND (slot_id IN (SELECT slot_id FROM kts_slots) OR actor_id IN (SELECT actor_id FROM kts_bots));
-- INSERT INTO public.billboard_history (slot_id, holder_id, holder_name, line1, line2, line3, bid, event)
--   SELECT slot_id, holder_id, left(COALESCE(holder_name, ''), 16), '운영자가 내렸습니다', '', '', GREATEST(0, COALESCE(current_bid, 0)), 'takedown'
--   FROM public.billboards
--   WHERE slot_id IN (SELECT slot_id FROM kts_slots) AND holder_id IS NOT NULL AND holder_id NOT IN (SELECT actor_id FROM kts_bots);
-- UPDATE public.billboards
--   SET holder_id = NULL, holder_name = 'K-TIMES SQUARE',
--       line1 = '운영자가 내렸습니다', line2 = '', line3 = '', external_url = NULL,
--       photo_id = NULL, photo_status = NULL,
--       protected_until = now(), expires_at = now(), lit_until = now(), updated_at = now()
--   WHERE slot_id IN (SELECT slot_id FROM kts_slots);
--
-- UPDATE public.plots SET owner_id = NULL, owner_name = NULL, level = 0, sign_text = '분양 대기중', updated_at = now()
--   WHERE owner_id IN (SELECT actor_id FROM kts_bots);
-- DELETE FROM public.billboard_reviews WHERE actor_id IN (SELECT actor_id FROM kts_bots);
-- DELETE FROM public.billboard_photos WHERE actor_id IN (SELECT actor_id FROM kts_bots);
-- DELETE FROM public.inbox WHERE actor_id IN (SELECT actor_id FROM kts_bots);
-- DELETE FROM public.push_subs WHERE actor_id IN (SELECT actor_id FROM kts_bots);
-- DELETE FROM public.reports WHERE reporter_id IN (SELECT actor_id FROM kts_bots);
-- DELETE FROM public.coin_ledger WHERE actor_id IN (SELECT actor_id FROM kts_bots);
-- DELETE FROM public.billboard_history WHERE holder_id IN (SELECT actor_id FROM kts_bots);
-- DELETE FROM public.wallets WHERE actor_id IN (SELECT actor_id FROM kts_bots);
-- SELECT (SELECT count(*) FROM kts_slots) AS slots_released, (SELECT count(*) FROM kts_bots) AS wallets_deleted;
-- COMMIT;
