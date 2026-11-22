-- 2026-11-22 꾸미기 상점 (한 번에 붙여 실행하는 파일)
--
-- Supabase SQL 편집기에 이 파일 전체를 붙여 한 번 실행한다. 몇 번을 실행해도 결과는 같다.
-- 마지막 SELECT가 적용됐는지(applied)와 이유(note)를 한 줄로 보여 준다. 편집기는 이 표만 보인다.
--
-- 왜: 이름표·발밑 링·택시 색·전광판 테두리·리본 모자를 게임 코인으로 사는 상점(13종)을 연다. 현금은 받지 않는다.
--     지금 운영 DB의 cosmetics에는 가격이 없고, kind는 hat/cab/frame/emote뿐이며, 코인 장부(coin_ledger)의 reason에 'shop'이 없다.
--
-- 무엇을: 데이터는 지우지 않는다. 출석 7일로 이미 받은 꾸미기는 그대로 남는다.
--     1. cosmetics.kind CHECK에 'tag'(이름표), 'ring'(발밑 링)을 더한다. 있던 값은 그대로 둔다.
--     2. cosmetics.price 열(코인, 비어 있으면 상점에서 안 판다)을 더하고 13종을 넣는다. 리본 모자 400, 노란 택시 800, 연속 테두리 600은
--        출석으로도 계속 받고 상점에서도 산다(grant_via는 attend7 그대로). balance.js SHOP과 같은 숫자다.
--     3. coin_ledger의 reason CHECK에 'shop'을 더한다. 있던 값(손으로 더한 것이 있어도)은 그대로 둔다.
--     4. 새 함수 넷: shop_list(파는 것과 가격), buy_cosmetic(화면에 보인 가격 p_price가 오면 DB 가격과 같은지 먼저 보고(다르면 'price'로 사지 않음),
--        인자 셋짜리 예전 초안이 있으면 지우고 넷짜리로 만든다. 한 트랜잭션에서 지갑을 잠그고, 이미 가졌는지·코인이 되는지 보고, 코인을 빼고
--        장부에 'shop'으로 적고, 보관함에 넣고 그 종류로 장착), unequip_cosmetic(그 종류를 벗기), move_cosmetics(게스트가 계정을 연결할 때
--        게스트 보관함을 계정으로 옮김). 모두 Worker 키(FLUSH_KEY)를 검사하는 SECURITY DEFINER다.
--     5. profile_read가 장착 목록을 4개가 아니라 6개, 보관함을 12개가 아니라 16개까지 준다. 함수의 다른 줄은 건드리지 않는다
--        (그 두 줄이 정확히 한 번씩 있을 때만 바꾼다).
--
-- 순서: 코드 배포 앞이든 뒤든 괜찮다.
--     이 파일 전: 상점은 물건과 가격을 보이고 '곧 열려요'로 구매 버튼을 막는다(GET /rt/shop이 open: false). 장착은 예전처럼 된다.
--     이 파일 뒤: Worker가 10분 안에 shop_list를 다시 물어 상점을 연다. 구매·벗기·연결 때 보관함 옮기기가 된다.
--     예전 코드로 되돌려도 해가 없다. 예전 코드는 새 종류를 그리지 않을 뿐이다.

BEGIN;

-- 1. kind: 'tag', 'ring' 추가. kind를 검사하는 CHECK마다 그 안의 값에 둘을 더해 같은 이름으로 다시 건다.
DO $sk$
DECLARE
  c RECORD;
  v_vals TEXT;
BEGIN
  FOR c IN
    SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'public.cosmetics'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    IF position('''tag''' IN c.def) > 0 AND position('''ring''' IN c.def) > 0 THEN CONTINUE; END IF;
    SELECT string_agg(quote_literal(v), ', ' ORDER BY o) INTO v_vals FROM (
      SELECT v, min(o) AS o FROM (
        SELECT m[1] AS v, n AS o FROM regexp_matches(c.def, '''([a-z_0-9]+)''', 'g') WITH ORDINALITY AS t(m, n)
        UNION ALL SELECT 'tag', 1000001 UNION ALL SELECT 'ring', 1000002
      ) a GROUP BY v
    ) b;
    EXECUTE format('ALTER TABLE public.cosmetics DROP CONSTRAINT %I', c.conname);
    EXECUTE format('ALTER TABLE public.cosmetics ADD CONSTRAINT %I CHECK (kind IN (%s))', c.conname, v_vals);
  END LOOP;
END
$sk$;

-- 2. 가격과 13종.
ALTER TABLE public.cosmetics ADD COLUMN IF NOT EXISTS price INT CHECK (price IS NULL OR price > 0);
INSERT INTO public.cosmetics (id, kind, grant_via, price) VALUES
  ('tag_heart', 'tag', 'shop', 300),
  ('tag_gold', 'tag', 'shop', 500),
  ('tag_neon', 'tag', 'shop', 700),
  ('ring_sparkle', 'ring', 'shop', 700),
  ('ring_heart', 'ring', 'shop', 800),
  ('ring_rainbow', 'ring', 'shop', 1000),
  ('cab_yellow', 'cab', 'attend7', 800),
  ('cab_pink', 'cab', 'shop', 900),
  ('cab_black', 'cab', 'shop', 1100),
  ('frame_streak', 'frame', 'attend7', 600),
  ('frame_gold', 'frame', 'shop', 1000),
  ('frame_rainbow', 'frame', 'shop', 1500),
  ('hat_ribbon', 'hat', 'attend7', 400)
ON CONFLICT (id) DO UPDATE SET price = EXCLUDED.price;

-- 3. 장부 reason: 'shop' 추가. reason을 검사하는 CHECK마다 그 안의 값에 'shop'을 더해 같은 이름으로 다시 건다.
DO $sl$
DECLARE
  c RECORD;
  v_vals TEXT;
BEGIN
  FOR c IN
    SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'public.coin_ledger'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%reason%'
  LOOP
    IF position('''shop''' IN c.def) > 0 THEN CONTINUE; END IF;
    SELECT string_agg(quote_literal(v), ', ' ORDER BY o) INTO v_vals FROM (
      SELECT v, min(o) AS o FROM (
        SELECT m[1] AS v, n AS o FROM regexp_matches(c.def, '''([a-z_0-9]+)''', 'g') WITH ORDINALITY AS t(m, n)
        UNION ALL SELECT 'shop', 1000001
      ) a GROUP BY v
    ) b;
    EXECUTE format('ALTER TABLE public.coin_ledger DROP CONSTRAINT %I', c.conname);
    EXECUTE format('ALTER TABLE public.coin_ledger ADD CONSTRAINT %I CHECK (reason IN (%s))', c.conname, v_vals);
  END LOOP;
END
$sl$;

-- 4. 함수.
CREATE OR REPLACE FUNCTION public.shop_list(p_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_items JSONB;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'price', price) ORDER BY kind, price, id), '[]'::jsonb)
  INTO v_items
  FROM public.cosmetics WHERE price IS NOT NULL;
  RETURN jsonb_build_object('ok', true, 'items', v_items);
END;
$$;

-- One purchase, all or nothing: the wallet row is locked first, so two buys of one account run one after the other and the second sees the
-- first one's item (owned). The price is the database's. The bought item is equipped in its kind. p_price: the price the player was shown;
-- when given and not the database's, nothing is bought ('price', with the database's price), so a list cached for a while never overcharges.
DROP FUNCTION IF EXISTS public.buy_cosmetic(TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.buy_cosmetic(p_key TEXT, p_actor_id TEXT, p_cosmetic_id TEXT, p_price INT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_kind TEXT;
  v_price INT;
  v_coins BIGINT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  SELECT kind, price INTO v_kind, v_price FROM public.cosmetics WHERE id = p_cosmetic_id;
  IF v_kind IS NULL OR v_price IS NULL OR v_price <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'item');
  END IF;
  IF p_price IS NOT NULL AND p_price <> v_price THEN
    RETURN jsonb_build_object('ok', false, 'error', 'price', 'price', v_price);
  END IF;
  SELECT coins INTO v_coins FROM public.wallets WHERE actor_id = p_actor_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'coins', 'coins', 0, 'price', v_price);
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory WHERE actor_id = p_actor_id AND cosmetic_id = p_cosmetic_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'owned', 'coins', v_coins);
  END IF;
  IF v_coins < v_price THEN
    RETURN jsonb_build_object('ok', false, 'error', 'coins', 'coins', v_coins, 'price', v_price);
  END IF;
  UPDATE public.wallets SET coins = coins - v_price, updated_at = now() WHERE actor_id = p_actor_id RETURNING coins INTO v_coins;
  INSERT INTO public.coin_ledger (actor_id, delta, reason, ref) VALUES (p_actor_id, -v_price, 'shop', p_cosmetic_id);
  UPDATE public.inventory AS inv
  SET equipped = false
  FROM public.cosmetics AS c
  WHERE inv.actor_id = p_actor_id AND inv.cosmetic_id = c.id AND c.kind = v_kind AND inv.equipped;
  INSERT INTO public.inventory (actor_id, cosmetic_id, equipped) VALUES (p_actor_id, p_cosmetic_id, true);
  RETURN jsonb_build_object('ok', true, 'cosmetic_id', p_cosmetic_id, 'kind', v_kind, 'price', v_price, 'coins', v_coins);
END;
$$;

CREATE OR REPLACE FUNCTION public.unequip_cosmetic(p_key TEXT, p_actor_id TEXT, p_kind TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_n INT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  UPDATE public.inventory AS inv
  SET equipped = false
  FROM public.cosmetics AS c
  WHERE inv.actor_id = p_actor_id AND inv.cosmetic_id = c.id AND c.kind = p_kind AND inv.equipped;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'n', v_n);
END;
$$;

-- A guest's locker follows it into the account it links to (the Worker calls this after merge_guest_account). What the account already
-- has stays; a guest's equipped item stays equipped only in a kind the account has nothing equipped in.
CREATE OR REPLACE FUNCTION public.move_cosmetics(p_key TEXT, p_from TEXT, p_to TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_n INT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  IF p_from IS NULL OR p_from NOT LIKE 'guest:%' OR p_to IS NULL OR p_to NOT LIKE 'user:%'
    OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE actor_id = p_to) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor');
  END IF;
  INSERT INTO public.inventory (actor_id, cosmetic_id, equipped, granted_at)
  SELECT p_to, g.cosmetic_id,
    g.equipped AND NOT EXISTS (
      SELECT 1 FROM public.inventory AS u JOIN public.cosmetics AS uc ON uc.id = u.cosmetic_id
      WHERE u.actor_id = p_to AND u.equipped AND uc.kind = c.kind),
    g.granted_at
  FROM public.inventory AS g JOIN public.cosmetics AS c ON c.id = g.cosmetic_id
  WHERE g.actor_id = p_from
  ON CONFLICT (actor_id, cosmetic_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM public.inventory WHERE actor_id = p_from;
  RETURN jsonb_build_object('ok', true, 'moved', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.shop_list(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.buy_cosmetic(TEXT, TEXT, TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unequip_cosmetic(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_cosmetics(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_list(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.buy_cosmetic(TEXT, TEXT, TEXT, INT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unequip_cosmetic(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.move_cosmetics(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

-- 5. profile_read: 장착 4 → 6, 보관함 12 → 16. 두 줄이 정확히 한 번씩 있을 때만, 그 두 줄만 바꾼다.
DO $pr$
DECLARE
  d TEXT;
BEGIN
  d := pg_get_functiondef('public.profile_read(text,text)'::regprocedure);
  IF (SELECT count(*) FROM regexp_matches(d, 'LIMIT 4\M', 'g')) = 1 AND (SELECT count(*) FROM regexp_matches(d, 'LIMIT 12\M', 'g')) = 1 THEN
    EXECUTE regexp_replace(regexp_replace(d, 'LIMIT 4\M', 'LIMIT 6'), 'LIMIT 12\M', 'LIMIT 16');
  END IF;
END
$pr$;

COMMIT;

-- ============================================================================
-- 결과: 다섯 가지가 모두 들어갔는지 (정의와 표를 읽기만 한다. 아무 줄도 쓰지 않는다)
-- ============================================================================
SELECT
  (k.ok AND l.ok AND p.n = 13 AND f.n = 4 AND f.definer = 4 AND r.src LIKE '%LIMIT 6%' AND r.src LIKE '%LIMIT 16%') AS applied,
  CASE
    WHEN NOT k.ok THEN '안 바뀜: cosmetics의 kind CHECK에 tag, ring이 없습니다. 실행 메시지의 오류를 보세요'
    WHEN NOT l.ok THEN '안 바뀜: coin_ledger의 reason CHECK에 shop이 없습니다. 실행 메시지의 오류를 보세요'
    WHEN p.n <> 13 THEN '가격이 있는 꾸미기가 ' || p.n || '개입니다(13개여야 합니다). 이 파일을 다시 실행하세요'
    WHEN f.n <> 4 THEN '상점 함수가 ' || f.n || '개입니다(shop_list, buy_cosmetic, unequip_cosmetic, move_cosmetics). 실행 메시지의 오류를 보세요'
    WHEN f.definer <> 4 THEN '상점 함수 중 SECURITY DEFINER가 아닌 것이 있습니다. 이 파일을 다시 실행하세요'
    WHEN r.src IS NULL THEN '안 바뀜: public.profile_read(text,text)가 없습니다'
    WHEN r.src NOT LIKE '%LIMIT 6%' OR r.src NOT LIKE '%LIMIT 16%' THEN '상점은 열렸지만 profile_read가 아직 장착 4개, 보관함 12개까지만 줍니다(그 두 줄이 손으로 바뀌어 있습니다). 개발자에게 알려 주세요'
    ELSE '적용됨. 꾸미기 13종을 코인으로 팔고, 장착은 종류마다 하나, 프로필이 장착 6개·보관함 16개까지 줍니다'
  END AS note
FROM
  (SELECT COALESCE(bool_and(pg_get_constraintdef(oid) LIKE '%''tag''%' AND pg_get_constraintdef(oid) LIKE '%''ring''%'), false) AS ok FROM pg_constraint
    WHERE conrelid = 'public.cosmetics'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%kind%') k,
  (SELECT COALESCE(bool_and(pg_get_constraintdef(oid) LIKE '%''shop''%'), true) AS ok FROM pg_constraint
    WHERE conrelid = 'public.coin_ledger'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%reason%') l,
  (SELECT count(*)::int AS n FROM public.cosmetics WHERE price IS NOT NULL) p,
  (SELECT count(*)::int AS n, count(*) FILTER (WHERE prosecdef)::int AS definer FROM pg_proc
    WHERE oid IN (to_regprocedure('public.shop_list(text)'), to_regprocedure('public.buy_cosmetic(text,text,text,integer)'),
      to_regprocedure('public.unequip_cosmetic(text,text,text)'), to_regprocedure('public.move_cosmetics(text,text,text)'))) f,
  (SELECT max(prosrc) AS src FROM pg_proc WHERE oid = to_regprocedure('public.profile_read(text,text)')) r;
