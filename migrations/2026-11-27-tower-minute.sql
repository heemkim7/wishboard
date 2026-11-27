-- 메인 타워 축하 1분 (docs/superpowers/specs/2026-11-27-main-tower-minute-design.md): spend_plaza takes 2,000 too (path B, accounts only,
-- the Worker checks the rest). Nothing else changes: 30 (sticker), 5,000 and one VIP ticket stay, and the refusal words stay exactly
-- '그 금액은 쓸 수 없어요.' (the Worker reads them to know this has not been run yet: towerrules.js SPEND_OLD).
-- The owner runs this by hand in the Supabase SQL editor of project wishboard. The Worker works before and after it.
CREATE OR REPLACE FUNCTION public.spend_plaza(
  p_key TEXT,
  p_actor_id TEXT,
  p_coins INT,
  p_tickets INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_wallet public.wallets%ROWTYPE;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  IF NOT (
    (p_coins = 30 AND p_tickets = 0) OR
    (p_coins = 2000 AND p_tickets = 0) OR
    (p_coins = 5000 AND p_tickets = 0) OR
    (p_coins = 0 AND p_tickets = 1)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', '그 금액은 쓸 수 없어요.');
  END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE actor_id = p_actor_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '지갑을 찾지 못했습니다.');
  END IF;
  IF p_coins > 0 AND v_wallet.coins < p_coins THEN
    RETURN jsonb_build_object('ok', false, 'error', '코인이 부족해요.');
  END IF;
  IF p_tickets > 0 AND v_wallet.vip_tickets < p_tickets THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VIP 티켓이 없어요.');
  END IF;
  UPDATE public.wallets
  SET coins = coins - p_coins,
      vip_tickets = vip_tickets - p_tickets,
      updated_at = now()
  WHERE actor_id = p_actor_id
  RETURNING * INTO v_wallet;
  RETURN jsonb_build_object('ok', true, 'remaining_coins', v_wallet.coins, 'vip_tickets', v_wallet.vip_tickets);
END;
$$;

REVOKE ALL ON FUNCTION public.spend_plaza(TEXT, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.spend_plaza(TEXT, TEXT, INT, INT) TO anon, authenticated, service_role;

-- Check: SELECT public.spend_plaza('<FLUSH_KEY>', 'probe:tower', 2000, 0);  -> {"ok": false, "error": "지갑을 찾지 못했습니다."}
