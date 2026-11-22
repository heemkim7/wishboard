-- 2026-11-22 코인 정산이 잔액을 돌려준다 (한 번에 붙여 실행하는 파일)
--
-- Supabase SQL 편집기에 이 파일 전체를 붙여 한 번 실행한다. 몇 번을 실행해도 결과는 같다.
-- 마지막 SELECT가 적용됐는지(applied)와 이유(note)를 한 줄로 보여 준다. 편집기는 이 표만 보인다.
--
-- 왜: 방(Room DO)은 약 30초마다 쌓인 코인을 coin_batch로 지갑에 넣고, 그 계정의 화면에 WALLET_SYNC를 보낸다.
--     화면은 그때마다 /rt/wallet을 읽는다(Worker 요청 하나 + Supabase 읽기 하나). 코인을 버는 플레이어 한 명이
--     한 시간에 60~120번이고, 플레이어당 가장 큰 HTTP·Supabase 항목이다(docs/capacity-2026-11-22.md).
--     coin_batch가 이미 그 줄을 고치면서 새 잔액을 알기 때문에, 그 값을 돌려주면 이 읽기가 없어진다.
--
-- 무엇을: public.coin_batch(p_key, p_items) 하나만 바꾼다. 다른 표와 함수, 데이터는 건드리지 않는다.
--     답에 bal을 더한다: {"ok": true, "flushed": N, "bal": {"guest:..": 1234, ...}}. 계정마다 이 배치 뒤 잔액이다.
--     같은 계정이 여러 항목이면(500씩 나뉜 큰 정산) 마지막 잔액이다. 지갑 줄이 생기지 않은 계정(wallets_need_login이 막은
--     로그인 없는 user: id)은 bal에 없다. 지갑에 넣는 일, 장부, 키 검사, 상한 500, SECURITY DEFINER, search_path, 권한은 그대로다.
--     함수 글은 schema.sql의 coin_batch와 같다.
--
-- 순서: 코드 배포 앞이든 뒤든 괜찮다.
--     이 파일 전: 답에 bal이 없다. 방은 예전처럼 빈 WALLET_SYNC를 보내고 화면이 /rt/wallet을 읽는다.
--     이 파일 뒤(새 Worker): WALLET_SYNC에 잔액 c가 실리고 화면은 읽지 않는다. 화면은 10분에 한 번, 그리고 전광판 점령 같은
--       HTTP 응답이 잔액을 고친 뒤 5초 안에는 그래도 읽는다. 다른 사람이 옮긴 코인(받은 코인, 환불)은 예전처럼 빈 WALLET_SYNC다.
--     예전 Worker는 답의 ok만 보므로 bal이 있어도 그대로 동작한다. 되돌릴 때는 schema.sql의 예전 coin_batch를 다시 실행하면 된다.

BEGIN;
CREATE OR REPLACE FUNCTION public.coin_batch(p_key TEXT, p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_item JSONB;
  v_count INT := 0;
  v_delta BIGINT;
  v_reason TEXT;
  v_coins BIGINT;
  v_bal JSONB := '{}'::jsonb;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized flush key';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- coin_batch 항목: reason이 없으면 'mine'
    v_delta := LEAST(GREATEST((v_item->>'delta')::BIGINT, 0), 500);
    v_reason := COALESCE(NULLIF(v_item->>'reason', ''), 'mine');
    IF v_reason NOT IN (
      'mine','fare','bonus','claim','refund','landlord','photo','photo_refund',
      'sell','spend','link','admin','lottery','starter'
    ) THEN
      v_reason := 'mine';
    END IF;
    INSERT INTO public.wallets (actor_id, nickname, coins, updated_at)
    VALUES (
      v_item->>'actor_id',
      COALESCE(NULLIF( left(v_item->>'nickname', 16), '' ), '네온손님'),
      100 + v_delta, -- 1회 배치당 최대 500코인 상한 방어
      now()
    )
    ON CONFLICT (actor_id) DO UPDATE
    SET coins = public.wallets.coins + v_delta,
        nickname = COALESCE(NULLIF(left(v_item->>'nickname', 16), ''), public.wallets.nickname),
        updated_at = now()
    RETURNING coins INTO v_coins;
    -- 같은 계정이 여러 항목이면(500씩 나뉜 큰 정산) 마지막 잔액이 남는다.
    IF v_coins IS NOT NULL THEN
      v_bal := v_bal || jsonb_build_object(v_item->>'actor_id', v_coins);
    END IF;
    INSERT INTO public.coin_ledger (actor_id, delta, reason)
    VALUES (v_item->>'actor_id', v_delta, v_reason);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'flushed', v_count, 'bal', v_bal);
END;
$$;
COMMIT;

SELECT
  (f.prosrc IS NOT NULL AND position('v_bal JSONB' IN f.prosrc) > 0 AND position('RETURNING coins INTO v_coins' IN f.prosrc) > 0 AND f.prosecdef) AS applied,
  CASE
    WHEN f.prosrc IS NULL THEN '안 바뀜: public.coin_batch(text,jsonb)가 없습니다. 실행 메시지의 오류를 보세요'
    WHEN position('v_bal JSONB' IN f.prosrc) = 0 OR position('RETURNING coins INTO v_coins' IN f.prosrc) = 0 THEN '안 바뀜: coin_batch가 아직 예전 것입니다. 실행 메시지의 오류를 보세요'
    WHEN NOT f.prosecdef THEN 'coin_batch가 SECURITY DEFINER가 아닙니다. 이 파일을 다시 실행하세요'
    ELSE '적용됨. coin_batch가 계정마다 배치 뒤 잔액(bal)을 돌려줍니다'
  END AS note
FROM (SELECT 1) one
LEFT JOIN pg_proc f ON f.oid = to_regprocedure('public.coin_batch(text,jsonb)');
