-- 1. 유저 지갑 테이블 (게스트 HMAC ID 및 정식 Auth UUID 모두 호환)
CREATE TABLE IF NOT EXISTS public.wallets (
  actor_id TEXT PRIMARY KEY, -- 'guest:xxxx' 또는 'user:uuid'
  nickname TEXT NOT NULL DEFAULT '네온손님',
  coins BIGINT NOT NULL DEFAULT 100 CHECK (coins >= 0),
  vip_tickets INT NOT NULL DEFAULT 0 CHECK (vip_tickets >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.wallets ALTER COLUMN nickname SET DEFAULT '네온손님';
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read wallets" ON public.wallets;
CREATE POLICY "Anyone can read wallets" ON public.wallets FOR SELECT USING (true);

-- 2. 토지 분양(Plots) 테이블 (1~20번 슬롯 사전 생성)
CREATE TABLE IF NOT EXISTS public.plots (
  plot_id INT PRIMARY KEY CHECK (plot_id BETWEEN 1 AND 20),
  owner_id TEXT REFERENCES public.wallets(actor_id),
  owner_name TEXT,
  level INT NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 4), -- 0:빈땅, 1:텐트, 2:포차, 3:네온상가, 4:타워
  sign_text TEXT DEFAULT '분양 대기중',
  theme_color TEXT DEFAULT '#00ffcc',
  external_url TEXT,
  price BIGINT NOT NULL DEFAULT 500, -- 다음 인수/증축 기준가
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.plots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read plots" ON public.plots;
CREATE POLICY "Anyone can read plots" ON public.plots FOR SELECT USING (true);

-- 초기 20개 토지 시드 데이터 입력
INSERT INTO public.plots (plot_id, price)
SELECT g, CASE WHEN g <= 4 THEN 2000 WHEN g <= 12 THEN 1000 ELSE 500 END
FROM generate_series(1, 20) AS g
ON CONFLICT (plot_id) DO NOTHING;

-- 3. 전광판(Billboards) 슬롯 테이블
-- slot_id 규칙: 'MAIN_S' (정중앙 메인타워), 'SUB_B1'~'SUB_B4' (서브타워 4개), 'PLOT_1'~'PLOT_20' (유저 건물 외벽 간판)
CREATE TABLE IF NOT EXISTS public.billboards (
  slot_id TEXT PRIMARY KEY,
  tier TEXT NOT NULL CHECK (tier IN ('S', 'B', 'C')),
  plot_id INT REFERENCES public.plots(plot_id), -- C급(건물 외벽)일 경우 연결된 토지 번호
  holder_id TEXT,
  holder_name TEXT DEFAULT 'K-TIMES SQUARE',
  line1 TEXT NOT NULL DEFAULT '뉴욕 타임스퀘어',
  line2 TEXT DEFAULT 'K-점령전에 오신 것을',
  line3 TEXT DEFAULT '환영합니다!',
  emoji TEXT DEFAULT '🔥',
  bg_theme TEXT NOT NULL DEFAULT 'cyber_navy', -- 프리셋 테마 코드
  text_color TEXT NOT NULL DEFAULT '#ffffff',
  external_url TEXT,
  current_bid BIGINT NOT NULL DEFAULT 100,
  protected_until TIMESTAMPTZ NOT NULL DEFAULT now(), -- 최소 노출 보장 시각
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.billboards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read billboards" ON public.billboards;
CREATE POLICY "Anyone can read billboards" ON public.billboards FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS billboards_updated_at_idx ON public.billboards(updated_at DESC);
-- 사진 전광판(승인제): 현재 점유자가 올린 사진 id와 검수 상태. 'approved'일 때만 클라이언트가 사진을 띄운다.
ALTER TABLE public.billboards ADD COLUMN IF NOT EXISTS photo_id TEXT;
ALTER TABLE public.billboards ADD COLUMN IF NOT EXISTS photo_status TEXT CHECK (photo_status IN ('pending', 'approved'));
ALTER TABLE public.billboards ADD COLUMN IF NOT EXISTS views BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.billboards ADD COLUMN IF NOT EXISTS clicks BIGINT NOT NULL DEFAULT 0;

-- 초기 전광판 시드 데이터 입력 (메인 1개, 서브 4개, 토지 귀속 20개)
INSERT INTO public.billboards (slot_id, tier, current_bid, expires_at, protected_until) VALUES
  ('MAIN_S', 'S', 3000, now(), now()),
  ('SUB_B1', 'B', 500, now(), now()),
  ('SUB_B2', 'B', 500, now(), now()),
  ('SUB_B3', 'B', 500, now(), now()),
  ('SUB_B4', 'B', 500, now(), now())
ON CONFLICT (slot_id) DO NOTHING;

INSERT INTO public.billboards (slot_id, tier, plot_id, current_bid, line1, line2, line3)
SELECT 'PLOT_' || g, 'C', g, 100, '거리 소원 간판 #' || g, '붕어빵 코인으로', '내 소원을 걸어보세요!'
FROM generate_series(1, 20) AS g
ON CONFLICT (slot_id) DO NOTHING;

-- 타임스퀘어 거리·타워에 붙던 사진 스크린. 등급은 C라 100코인부터 점령한다.
INSERT INTO public.billboards (slot_id, tier, current_bid, line1, line2, line3, expires_at, protected_until)
SELECT 'WALL_' || g, 'C', 100, g || '번 광장 전광판', '타임스퀘어 거리', '100 코인부터', now(), now()
FROM generate_series(1, 400) AS g
ON CONFLICT (slot_id) DO NOTHING;
INSERT INTO public.billboards (slot_id, tier, current_bid, line1, line2, line3, expires_at, protected_until)
SELECT 'TOWER_' || g, 'C', 100, g || '번 타워 전광판', '원 타임스퀘어', '100 코인부터', now(), now()
FROM generate_series(1, 5) AS g
ON CONFLICT (slot_id) DO NOTHING;

-- 4. 앱 설정 시크릿 테이블 (Worker FLUSH_KEY 검증용)
CREATE TABLE IF NOT EXISTS public.app_secrets (
  key_name TEXT PRIMARY KEY,
  key_value TEXT NOT NULL
);
ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;
-- 주의: 실제 운영 시 아래 'YOUR_FLUSH_SECRET_HERE'를 Worker 환경변수 FLUSH_KEY와 동일한 값으로 변경
INSERT INTO public.app_secrets (key_name, key_value)
VALUES ('FLUSH_KEY', 'YOUR_FLUSH_SECRET_HERE')
ON CONFLICT (key_name) DO NOTHING;

-- ============================================================================
-- RPC 1: Worker DO 전용 코인 배치 정산 (기존 tap_batch 대체)
-- p_items 형식: [{"actor_id":"guest:123", "nickname":"홍길동", "delta":45}, ...]
-- ============================================================================
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
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized flush key';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.wallets (actor_id, nickname, coins, updated_at)
    VALUES (
      v_item->>'actor_id',
      COALESCE(NULLIF( left(v_item->>'nickname', 16), '' ), '네온손님'),
      100 + LEAST(GREATEST((v_item->>'delta')::BIGINT, 0), 500), -- 1회 배치당 최대 500코인 상한 방어
      now()
    )
    ON CONFLICT (actor_id) DO UPDATE
    SET coins = public.wallets.coins + LEAST(GREATEST((v_item->>'delta')::BIGINT, 0), 500),
        nickname = COALESCE(NULLIF(left(v_item->>'nickname', 16), ''), public.wallets.nickname),
        updated_at = now();
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'flushed', v_count);
END;
$$;

-- 거리 코인을 모은 사람이, 지금 전광판을 가진 광고주에게 넘긴다.
CREATE OR REPLACE FUNCTION public.sell_coins_to_advertiser(
  p_key TEXT,
  p_actor_id TEXT,
  p_nickname TEXT,
  p_slot_id TEXT,
  p_amount INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_seller public.wallets%ROWTYPE;
  v_board public.billboards%ROWTYPE;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  IF p_amount NOT IN (10, 20, 50) THEN
    RETURN jsonb_build_object('ok', false, 'error', '10, 20, 50코인만 팔 수 있어요.');
  END IF;
  SELECT * INTO v_board FROM public.billboards WHERE slot_id = p_slot_id FOR UPDATE;
  IF NOT FOUND OR v_board.holder_id IS NULL OR v_board.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', '지금 그 전광판을 산 광고주가 없어요.');
  END IF;
  IF v_board.holder_id = p_actor_id THEN
    RETURN jsonb_build_object('ok', false, 'error', '내 광고에는 코인을 팔 수 없어요.');
  END IF;
  INSERT INTO public.wallets (actor_id, nickname, coins)
  VALUES (p_actor_id, left(COALESCE(p_nickname, '네온손님'), 16), 100)
  ON CONFLICT (actor_id) DO NOTHING;
  SELECT * INTO v_seller FROM public.wallets WHERE actor_id = p_actor_id FOR UPDATE;
  IF v_seller.coins < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', '팔 코인이 부족해요.');
  END IF;
  UPDATE public.wallets SET coins = coins - p_amount, nickname = left(p_nickname, 16), updated_at = now()
  WHERE actor_id = p_actor_id;
  UPDATE public.wallets SET coins = coins + p_amount, updated_at = now()
  WHERE actor_id = v_board.holder_id;
  RETURN jsonb_build_object('ok', true, 'remaining_coins', v_seller.coins - p_amount, 'buyer_name', v_board.holder_name, 'amount', p_amount);
END;
$$;

-- Room DO가 메모리에 모은 전광판 노출/클릭을 주기적으로 더한다.
CREATE OR REPLACE FUNCTION public.ad_stat_batch(p_key TEXT, p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_item JSONB;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized flush key';
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    UPDATE public.billboards
    SET views = GREATEST(views, COALESCE((v_item->>'views')::BIGINT, 0)),
        clicks = GREATEST(clicks, COALESCE((v_item->>'clicks')::BIGINT, 0))
    WHERE slot_id = v_item->>'slot_id';
  END LOOP;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ============================================================================
-- RPC 2: 전광판 등록 및 밀어내기 경매 + 건물주 50% 수수료 자동 정산
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_billboard(
  p_key TEXT,
  p_actor_id TEXT,
  p_nickname TEXT,
  p_slot_id TEXT,
  p_bid BIGINT,
  p_line1 TEXT,
  p_line2 TEXT,
  p_line3 TEXT,
  p_emoji TEXT,
  p_bg_theme TEXT,
  p_text_color TEXT,
  p_external_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_wallet public.wallets%ROWTYPE;
  v_board public.billboards%ROWTYPE;
  v_plot_owner TEXT;
  v_min_required BIGINT;
  v_protect_mins INT;
  v_expire_mins INT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;

  -- 지갑 확인 (없으면 기본 100코인으로 생성)
  INSERT INTO public.wallets (actor_id, nickname, coins)
  VALUES (p_actor_id, left(COALESCE(p_nickname, '익명'), 16), 100)
  ON CONFLICT (actor_id) DO NOTHING;

  SELECT * INTO v_wallet FROM public.wallets WHERE actor_id = p_actor_id FOR UPDATE;
  SELECT * INTO v_board FROM public.billboards WHERE slot_id = p_slot_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '존재하지 않는 전광판 슬롯입니다.');
  END IF;

  -- 아직 보호 시간(최소 노출 보장)이 남아있는 경우 밀어내기 불가
  IF v_board.protected_until > now() AND v_board.expires_at > now() AND v_board.holder_id IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object('ok', false, 'error', '현재 광고의 최소 보장 시간이 남아있습니다.');
  END IF;

  -- 빈 자리는 등급 기본가. 누군가 점령 중일 때만 직전 입찰가 + 50.
  IF v_board.holder_id IS NULL OR v_board.expires_at <= now() THEN
    v_min_required := CASE
      WHEN v_board.slot_id IN ('PLOT_18', 'PLOT_19', 'PLOT_20') THEN 30
      WHEN v_board.tier = 'S' THEN 3000
      WHEN v_board.tier = 'B' THEN 500
      ELSE 100
    END;
  ELSE
    v_min_required := v_board.current_bid + 50;
  END IF;

  IF p_bid < v_min_required THEN
    RETURN jsonb_build_object('ok', false, 'error', '최소 ' || v_min_required || ' 코인 이상 입찰해야 합니다.');
  END IF;

  IF v_wallet.coins < p_bid THEN
    RETURN jsonb_build_object('ok', false, 'error', '코인이 부족합니다. 붕어빵을 더 구워보세요!');
  END IF;

  -- 코인 차감
  UPDATE public.wallets SET coins = coins - p_bid, nickname = left(p_nickname, 16), updated_at = now()
  WHERE actor_id = p_actor_id;

  -- C급(유저 건물 외벽 간판)인 경우 해당 건물주에게 50% 수수료 지급!
  IF v_board.tier = 'C' AND v_board.plot_id IS NOT NULL THEN
    SELECT owner_id INTO v_plot_owner FROM public.plots WHERE plot_id = v_board.plot_id;
    IF v_plot_owner IS NOT NULL AND v_plot_owner IS DISTINCT FROM p_actor_id THEN
      UPDATE public.wallets SET coins = coins + (p_bid / 2), updated_at = now()
      WHERE actor_id = v_plot_owner;
    END IF;
  END IF;

  -- 등급별 보호 시간 및 만료 시간 설정
  v_protect_mins := CASE v_board.tier WHEN 'S' THEN 15 WHEN 'B' THEN 10 ELSE 5 END;
  v_expire_mins  := CASE v_board.tier WHEN 'S' THEN 180 WHEN 'B' THEN 60 ELSE 20 END;

  -- 점유자가 바뀌면 이전 점유자의 사진은 내려간다. 아직 검수 전이었다면 사진 요금을 돌려준다.
  IF v_board.photo_id IS NOT NULL AND v_board.holder_id IS DISTINCT FROM p_actor_id THEN
    UPDATE public.wallets w SET coins = w.coins + p.fee, updated_at = now()
    FROM public.billboard_photos p
    WHERE p.photo_id = v_board.photo_id AND p.status = 'pending' AND w.actor_id = p.actor_id;
    UPDATE public.billboard_photos SET status = 'lapsed', jpeg = ''::BYTEA, reviewed_at = COALESCE(reviewed_at, now())
    WHERE photo_id = v_board.photo_id AND status IN ('pending', 'approved');
  END IF;

  UPDATE public.billboards
  SET photo_id = CASE WHEN v_board.holder_id = p_actor_id THEN v_board.photo_id END,
      photo_status = CASE WHEN v_board.holder_id = p_actor_id THEN v_board.photo_status END,
      holder_id = p_actor_id,
      holder_name = left(p_nickname, 16),
      line1 = left(COALESCE(p_line1, ''), 16),
      line2 = left(COALESCE(p_line2, ''), 16),
      line3 = left(COALESCE(p_line3, ''), 16),
      emoji = left(COALESCE(p_emoji, '✨'), 4),
      bg_theme = COALESCE(p_bg_theme, 'cyber_navy'),
      text_color = COALESCE(p_text_color, '#ffffff'),
      external_url = CASE WHEN left(COALESCE(p_external_url, ''), 200) ~ '^https://' THEN left(p_external_url, 200) ELSE NULL END,
      current_bid = p_bid,
      protected_until = now() + (v_protect_mins || ' minutes')::INTERVAL,
      expires_at = now() + (v_expire_mins || ' minutes')::INTERVAL,
      updated_at = now()
  WHERE slot_id = p_slot_id
  RETURNING * INTO v_board;

  RETURN jsonb_build_object('ok', true, 'billboard', row_to_json(v_board), 'remaining_coins', v_wallet.coins - p_bid);
END;
$$;

-- ============================================================================
-- RPC 3: 토지 분양 및 건물 증축 (레벨 1 텐트 -> 2 포차 -> 3 상가 -> 4 타워)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.buy_or_upgrade_plot(
  p_key TEXT,
  p_actor_id TEXT,
  p_nickname TEXT,
  p_plot_id INT,
  p_sign_text TEXT,
  p_theme_color TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_wallet public.wallets%ROWTYPE;
  v_plot public.plots%ROWTYPE;
  v_cost BIGINT;
  v_next_level INT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE actor_id = p_actor_id FOR UPDATE;
  SELECT * INTO v_plot FROM public.plots WHERE plot_id = p_plot_id FOR UPDATE;

  IF NOT FOUND OR v_wallet.actor_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '유저 지갑 또는 토지 정보를 찾을 수 없습니다.');
  END IF;

  -- 본인 땅 증축인지, 빈 땅/남의 땅 인수인지 판별
  IF v_plot.owner_id = p_actor_id THEN
    IF v_plot.level >= 4 THEN
      RETURN jsonb_build_object('ok', false, 'error', '이미 최고 단계(고층 타워) 건물입니다.');
    END IF;
    v_cost := v_plot.price;
    v_next_level := v_plot.level + 1;
  ELSE
    -- 남의 땅은 마지막 업데이트 후 7일이 지났거나 빈 땅(level=0)일 때만 인수 가능
    IF v_plot.level > 0 AND v_plot.updated_at > (now() - interval '7 days') THEN
      RETURN jsonb_build_object('ok', false, 'error', '이미 주인이 활발히 운영 중인 건물입니다.');
    END IF;
    v_cost := v_plot.price;
    v_next_level := GREATEST(v_plot.level, 1);
  END IF;

  IF v_wallet.coins < v_cost THEN
    RETURN jsonb_build_object('ok', false, 'error', '분양/증축 코인이 부족합니다. (필요: ' || v_cost || ' 코인)');
  END IF;

  UPDATE public.wallets SET coins = coins - v_cost, nickname = left(p_nickname, 16), updated_at = now()
  WHERE actor_id = p_actor_id;

  UPDATE public.plots
  SET owner_id = p_actor_id,
      owner_name = left(p_nickname, 16),
      level = v_next_level,
      sign_text = left(COALESCE(NULLIF(p_sign_text, ''), p_nickname || '의 타워'), 14),
      theme_color = COALESCE(p_theme_color, '#00ffcc'),
      price = v_cost * 2, -- 증축할수록 가치 2배 상승
      updated_at = now()
  WHERE plot_id = p_plot_id
  RETURNING * INTO v_plot;

  RETURN jsonb_build_object('ok', true, 'plot', row_to_json(v_plot), 'remaining_coins', v_wallet.coins - v_cost);
END;
$$;

-- ============================================================================
-- 5. 사진 전광판 (운영자 승인제)
-- 점유자가 올린 JPEG는 이 테이블에만 저장된다. 공개 SELECT 정책이 없어 아래 SECURITY DEFINER RPC로만 읽고 쓴다.
-- Worker가 승인된 사진만 /rt/photo/<id> 로 내보내고, 검수는 Worker 시크릿 ADMIN_KEY가 있어야 한다.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.billboard_photos (
  photo_id TEXT PRIMARY KEY CHECK (photo_id ~ '^[0-9a-f]{40}$'), -- sha256(actor|slot|jpeg) 앞 40자
  slot_id TEXT NOT NULL REFERENCES public.billboards(slot_id),
  actor_id TEXT NOT NULL,
  nickname TEXT,
  jpeg BYTEA NOT NULL CHECK (octet_length(jpeg) <= 300000), -- 거절·내림·만료되면 비운다
  fee BIGINT NOT NULL DEFAULT 0,
  -- lapsed: 다른 사람이 전광판을 탈환해 내려감(검수 전이었다면 요금 환불)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'removed', 'lapsed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
ALTER TABLE public.billboard_photos ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS billboard_photos_status_idx ON public.billboard_photos(status, created_at);

-- RPC 4: 사진 제출 — 지금 그 전광판을 점유 중인 사람만, 등급별 사진 요금(S 1000 / B 300 / C 100) 차감 후 검수 대기
CREATE OR REPLACE FUNCTION public.submit_billboard_photo(
  p_key TEXT,
  p_actor_id TEXT,
  p_nickname TEXT,
  p_slot_id TEXT,
  p_photo_id TEXT,
  p_jpeg_b64 TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_wallet public.wallets%ROWTYPE;
  v_board public.billboards%ROWTYPE;
  v_prev TEXT;
  v_fee BIGINT;
  v_bytes BYTEA;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;

  SELECT * INTO v_board FROM public.billboards WHERE slot_id = p_slot_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '존재하지 않는 전광판 슬롯입니다.');
  END IF;
  IF v_board.holder_id IS DISTINCT FROM p_actor_id OR v_board.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', '지금 이 전광판을 점령 중인 사람만 사진을 올릴 수 있어요.');
  END IF;
  IF v_board.photo_status = 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 검수 중인 사진이 있어요. 결과가 나온 뒤 다시 올려 주세요.');
  END IF;
  SELECT status INTO v_prev FROM public.billboard_photos WHERE photo_id = p_photo_id;
  IF v_prev IN ('rejected', 'removed') THEN
    RETURN jsonb_build_object('ok', false, 'error', '검수에서 거절된 사진은 다시 올릴 수 없어요.');
  END IF;
  IF v_prev = 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 송출 중인 사진이에요.');
  END IF;

  v_bytes := decode(p_jpeg_b64, 'base64');
  IF v_bytes IS NULL OR octet_length(v_bytes) > 300000 OR substring(v_bytes FROM 1 FOR 3) <> '\xffd8ff'::BYTEA THEN
    RETURN jsonb_build_object('ok', false, 'error', '사진 형식이 올바르지 않습니다.');
  END IF;

  v_fee := CASE v_board.tier WHEN 'S' THEN 1000 WHEN 'B' THEN 300 ELSE 100 END;
  SELECT * INTO v_wallet FROM public.wallets WHERE actor_id = p_actor_id FOR UPDATE;
  IF NOT FOUND OR v_wallet.coins < v_fee THEN
    RETURN jsonb_build_object('ok', false, 'error', '사진 요금(' || v_fee || ' 코인)이 부족합니다.');
  END IF;

  UPDATE public.wallets SET coins = coins - v_fee, updated_at = now() WHERE actor_id = p_actor_id;
  -- 송출 중이던 이전 사진은 새 사진이 검수받는 동안 내려간다
  IF v_board.photo_id IS NOT NULL THEN
    UPDATE public.billboard_photos SET status = 'lapsed', jpeg = ''::BYTEA, reviewed_at = COALESCE(reviewed_at, now())
    WHERE photo_id = v_board.photo_id AND status = 'approved';
  END IF;
  INSERT INTO public.billboard_photos (photo_id, slot_id, actor_id, nickname, jpeg, fee, status, created_at, reviewed_at)
  VALUES (p_photo_id, p_slot_id, p_actor_id, left(COALESCE(p_nickname, '익명'), 16), v_bytes, v_fee, 'pending', now(), NULL)
  ON CONFLICT (photo_id) DO UPDATE
  SET nickname = EXCLUDED.nickname, jpeg = EXCLUDED.jpeg, fee = EXCLUDED.fee, status = 'pending', created_at = now(), reviewed_at = NULL;

  UPDATE public.billboards
  SET photo_id = p_photo_id, photo_status = 'pending', updated_at = now()
  WHERE slot_id = p_slot_id
  RETURNING * INTO v_board;

  RETURN jsonb_build_object('ok', true, 'billboard', row_to_json(v_board), 'remaining_coins', v_wallet.coins - v_fee, 'fee', v_fee);
END;
$$;

-- RPC 5: 검수 — 승인하면 전광판에 송출, 거절하면 사진 요금 환불, 승인된 사진을 거절하면 내림(환불 없음)
CREATE OR REPLACE FUNCTION public.review_billboard_photo(p_key TEXT, p_photo_id TEXT, p_approve BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_photo public.billboard_photos%ROWTYPE;
  v_board public.billboards%ROWTYPE;
  v_status TEXT;
  v_refund BIGINT := 0;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;

  SELECT * INTO v_photo FROM public.billboard_photos WHERE photo_id = p_photo_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '사진을 찾을 수 없습니다.');
  END IF;

  IF p_approve THEN
    IF v_photo.status <> 'pending' THEN
      RETURN jsonb_build_object('ok', false, 'error', '검수 대기 중인 사진만 승인할 수 있습니다.');
    END IF;
    v_status := 'approved';
    UPDATE public.billboards SET photo_status = 'approved', updated_at = now()
    WHERE slot_id = v_photo.slot_id AND photo_id = p_photo_id
    RETURNING * INTO v_board;
  ELSE
    IF v_photo.status NOT IN ('pending', 'approved') THEN
      RETURN jsonb_build_object('ok', false, 'error', '이미 처리된 사진입니다.');
    END IF;
    v_status := CASE WHEN v_photo.status = 'pending' THEN 'rejected' ELSE 'removed' END;
    IF v_photo.status = 'pending' AND v_photo.fee > 0 THEN
      v_refund := v_photo.fee;
      UPDATE public.wallets SET coins = coins + v_refund, updated_at = now() WHERE actor_id = v_photo.actor_id;
    END IF;
    UPDATE public.billboards SET photo_id = NULL, photo_status = NULL, updated_at = now()
    WHERE slot_id = v_photo.slot_id AND photo_id = p_photo_id
    RETURNING * INTO v_board;
  END IF;

  UPDATE public.billboard_photos
  SET status = v_status, reviewed_at = now(), jpeg = CASE WHEN v_status = 'approved' THEN jpeg ELSE ''::BYTEA END
  WHERE photo_id = p_photo_id;

  RETURN jsonb_build_object(
    'ok', true,
    'billboard', CASE WHEN v_board.slot_id IS NULL THEN NULL ELSE row_to_json(v_board)::JSONB END,
    'photo', jsonb_build_object('photo_id', p_photo_id, 'slot_id', v_photo.slot_id, 'actor_id', v_photo.actor_id, 'status', v_status, 'refunded', v_refund)
  );
END;
$$;

-- RPC 6: 사진 바이트 읽기 — 기본은 승인된 사진만, p_any(운영자 검수 화면)일 때만 대기 중인 사진도
CREATE OR REPLACE FUNCTION public.get_billboard_photo(p_key TEXT, p_photo_id TEXT, p_any BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_photo public.billboard_photos%ROWTYPE;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  SELECT * INTO v_photo FROM public.billboard_photos WHERE photo_id = p_photo_id;
  IF NOT FOUND OR octet_length(v_photo.jpeg) = 0 OR (v_photo.status <> 'approved' AND NOT p_any) THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', v_photo.status, 'jpeg', encode(v_photo.jpeg, 'base64'));
END;
$$;

-- RPC 7: 검수 목록 (운영자 화면)
CREATE OR REPLACE FUNCTION public.list_billboard_photos(p_key TEXT, p_status TEXT DEFAULT 'pending')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  RETURN jsonb_build_object('ok', true, 'photos', COALESCE((
    SELECT jsonb_agg(row_to_json(t) ORDER BY t.created_at)
    FROM (
      SELECT photo_id, slot_id, actor_id, nickname, fee, status, created_at, reviewed_at, octet_length(jpeg) AS bytes
      FROM public.billboard_photos
      WHERE status = p_status
      ORDER BY created_at
      LIMIT 100
    ) t
  ), '[]'::JSONB));
END;
$$;

-- 테스트용. 닉네임으로 지갑 후보를 찾고, 고른 actor_id 에만 코인을 더한다.
CREATE OR REPLACE FUNCTION public.find_wallets(p_key TEXT, p_nickname TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  IF btrim(COALESCE(p_nickname, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', '닉네임을 입력하세요.');
  END IF;
  RETURN jsonb_build_object('ok', true, 'wallets', COALESCE((
    SELECT jsonb_agg(row_to_json(t) ORDER BY t.updated_at DESC)
    FROM (
      SELECT actor_id, nickname, coins, updated_at
      FROM public.wallets
      WHERE nickname = left(btrim(p_nickname), 16)
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 20
    ) t
  ), '[]'::JSONB));
END;
$$;

DROP FUNCTION IF EXISTS public.grant_coins(TEXT, TEXT, BIGINT);
CREATE FUNCTION public.grant_coins(p_key TEXT, p_actor_id TEXT, p_amount BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_coins BIGINT;
  v_nick TEXT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  IF p_amount IS NULL OR p_amount < 1 OR p_amount > 1000000 THEN
    RETURN jsonb_build_object('ok', false, 'error', '1에서 100만 코인까지 지급할 수 있어요.');
  END IF;
  UPDATE public.wallets SET coins = coins + p_amount, updated_at = now()
  WHERE actor_id = p_actor_id
  RETURNING coins, nickname INTO v_coins, v_nick;
  IF v_coins IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '그 지갑을 찾지 못했습니다.');
  END IF;
  RETURN jsonb_build_object('ok', true, 'actor_id', p_actor_id, 'nickname', v_nick, 'coins', v_coins);
END;
$$;