-- 1. 유저 지갑 테이블 (게스트 HMAC ID 및 정식 Auth UUID 모두 호환)
CREATE TABLE IF NOT EXISTS public.wallets (
  actor_id TEXT PRIMARY KEY, -- 'guest:xxxx' 또는 'user:uuid'
  nickname TEXT NOT NULL DEFAULT '네온손님',
  coins BIGINT NOT NULL DEFAULT 100 CHECK (coins >= 0),
  vip_tickets INT NOT NULL DEFAULT 0 CHECK (vip_tickets >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  spent BIGINT NOT NULL DEFAULT 0
);
ALTER TABLE public.wallets ALTER COLUMN nickname SET DEFAULT '네온손님';
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS spent BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS linked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS link_bonus BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS wallets_spent_idx ON public.wallets (spent DESC);
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
-- 점령 가능한 슬롯: MAIN 5, SUB 8, STREET 50, PLOT 18 (81칸).
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
-- A claim rewrites the row. The bid stays on the payer even after the board expires or is taken.
CREATE OR REPLACE FUNCTION public.add_billboard_spent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- holder change counts the new bid; a raise by the same holder counts only the increase.
  -- An expires_at-only update does not move spent.
  IF NEW.holder_id IS NOT NULL AND NEW.holder_id IS DISTINCT FROM OLD.holder_id THEN
    IF COALESCE(NEW.current_bid, 0) > 0 THEN
      UPDATE public.wallets
      SET spent = spent + NEW.current_bid, updated_at = now()
      WHERE actor_id = NEW.holder_id;
    END IF;
  ELSIF NEW.holder_id IS NOT NULL AND NEW.current_bid > OLD.current_bid THEN
    UPDATE public.wallets
    SET spent = spent + (NEW.current_bid - OLD.current_bid), updated_at = now()
    WHERE actor_id = NEW.holder_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.add_billboard_spent() FROM PUBLIC;
DROP TRIGGER IF EXISTS billboard_spent ON public.billboards;
CREATE TRIGGER billboard_spent
AFTER UPDATE OF current_bid, holder_id, expires_at ON public.billboards
FOR EACH ROW
EXECUTE FUNCTION public.add_billboard_spent();
-- 사진 전광판(승인제): 현재 점유자가 올린 사진 id와 검수 상태. 'approved'일 때만 클라이언트가 사진을 띄운다.
ALTER TABLE public.billboards ADD COLUMN IF NOT EXISTS photo_id TEXT;
ALTER TABLE public.billboards ADD COLUMN IF NOT EXISTS photo_status TEXT CHECK (photo_status IN ('pending', 'approved'));
ALTER TABLE public.billboards ADD COLUMN IF NOT EXISTS views BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.billboards ADD COLUMN IF NOT EXISTS clicks BIGINT NOT NULL DEFAULT 0;
-- 문구 세로 위치(%). claim_billboard(p_caption_y)가 12~88로 잘라서 쓴다.
ALTER TABLE public.billboards ADD COLUMN IF NOT EXISTS caption_y SMALLINT NOT NULL DEFAULT 72;
ALTER TABLE public.billboards ADD COLUMN IF NOT EXISTS lit_until TIMESTAMPTZ;
ALTER TABLE public.billboards ADD COLUMN IF NOT EXISTS lit_on DATE;
ALTER TABLE public.billboards ADD COLUMN IF NOT EXISTS lit_days INT NOT NULL DEFAULT 0;
ALTER TABLE public.billboards ADD COLUMN IF NOT EXISTS cheers INT NOT NULL DEFAULT 0;
ALTER TABLE public.billboards ADD COLUMN IF NOT EXISTS frame TEXT;
UPDATE public.billboards SET lit_until = expires_at WHERE lit_until IS NULL;

-- Claimable slots. Main tower is the expensive face: five stacked screens.
INSERT INTO public.billboards (slot_id, tier, current_bid, line1, line2, line3, expires_at, protected_until) VALUES
  ('MAIN_UP', 'S', 4000, '메인 타워 최상단', '가장 비싼 자리', '4,000 코인부터', now(), now()),
  ('MAIN_TOP', 'S', 3000, '메인 타워 정상', '타임스퀘어의 왕좌', '3,000 코인부터', now(), now()),
  ('MAIN_MID', 'S', 2000, '메인 타워 중앙', '원 타임스퀘어', '2,000 코인부터', now(), now()),
  ('MAIN_BOT', 'S', 1500, '메인 타워 하단', '거리에서 가장 잘 보임', '1,500 코인부터', now(), now()),
  ('MAIN_LOW', 'S', 1200, '메인 타워 최하단', '길에서 잘 보임', '1,200 코인부터', now(), now()),
  ('SUB_1A', 'B', 800, '1번 타워 상단', '코너 랜드마크', '800 코인부터', now(), now()),
  ('SUB_1B', 'B', 500, '1번 타워 하단', '코너 랜드마크', '500 코인부터', now(), now()),
  ('SUB_2A', 'B', 800, '2번 타워 상단', '코너 랜드마크', '800 코인부터', now(), now()),
  ('SUB_2B', 'B', 500, '2번 타워 하단', '코너 랜드마크', '500 코인부터', now(), now()),
  ('SUB_3A', 'B', 800, '3번 타워 상단', '코너 랜드마크', '800 코인부터', now(), now()),
  ('SUB_3B', 'B', 500, '3번 타워 하단', '코너 랜드마크', '500 코인부터', now(), now()),
  ('SUB_4A', 'B', 800, '4번 타워 상단', '코너 랜드마크', '800 코인부터', now(), now()),
  ('SUB_4B', 'B', 500, '4번 타워 하단', '코너 랜드마크', '500 코인부터', now(), now())
ON CONFLICT (slot_id) DO NOTHING;

INSERT INTO public.billboards (slot_id, tier, plot_id, current_bid, line1, line2, line3)
SELECT 'PLOT_' || g, 'C', g,
  100 + round((g - 1) * 200.0 / 17)::bigint,
  g || '번 거리 전광판', '건물 앞 큰 화면', '100~300 코인'
FROM generate_series(1, 18) AS g
ON CONFLICT (slot_id) DO NOTHING;

INSERT INTO public.billboards (slot_id, tier, current_bid, line1, line2, line3)
SELECT 'STREET_' || g, 'C',
  200 + round((g - 1) * 200.0 / 29)::bigint,
  g || '번 메인거리', '거리 쪽 큰 화면', '200~400 코인'
FROM generate_series(1, 30) AS g
ON CONFLICT (slot_id) DO NOTHING;

-- STREET_31..50: the plaza core, added 2026-11-22 (migrations/2026-11-22-boards.sql), the cheapest street faces.
INSERT INTO public.billboards (slot_id, tier, current_bid, line1, line2, line3)
SELECT 'STREET_' || g, 'C',
  150 + round((g - 31) * 100.0 / 19)::bigint,
  g || '번 메인거리', '거리 쪽 큰 화면', '150~250 코인'
FROM generate_series(31, 50) AS g
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

-- profiles, the coin ledger, and billboard history. Re-run safe. No public read.
CREATE TABLE IF NOT EXISTS public.profiles (
  actor_id TEXT PRIMARY KEY REFERENCES public.wallets(actor_id) ON DELETE CASCADE,
  level INT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 99),
  reputation INT NOT NULL DEFAULT 0 CHECK (reputation >= 0),
  species SMALLINT NOT NULL DEFAULT 1 CHECK (species BETWEEN 1 AND 10),
  ring_color TEXT NOT NULL DEFAULT '#ff3d9a',
  starter_slot TEXT,
  attend_streak INT NOT NULL DEFAULT 0,
  attend_last DATE,
  tribe_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tribe_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ring_set BOOLEAN NOT NULL DEFAULT false;
-- Ten avatar species (ts3d/avatars.js SPECIES). A table made before 2026-11-22 checks species against 1..3: widened here, the same
-- statement as migrations/2026-11-22-species.sql. Re-run safe.
DO $sp$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%species%'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_species_check CHECK (species BETWEEN 1 AND 10);
END
$sp$;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.coin_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id TEXT NOT NULL,
  delta BIGINT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN (
    'mine','fare','bonus','claim','refund','landlord','photo','photo_refund',
    'sell','spend','link','admin','lottery','starter','shop'
  )),
  ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coin_ledger_actor_idx ON public.coin_ledger (actor_id, created_at DESC);
ALTER TABLE public.coin_ledger ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.billboard_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slot_id TEXT NOT NULL,
  holder_id TEXT,
  holder_name TEXT,
  line1 TEXT, line2 TEXT, line3 TEXT,
  bid BIGINT NOT NULL DEFAULT 0,
  event TEXT NOT NULL CHECK (event IN (
    'claim','takeover','edit','relight','clear','takedown','reject','starter'
  )),
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billboard_history_slot_idx ON public.billboard_history (slot_id, at DESC);
ALTER TABLE public.billboard_history ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.lottery_draws (
  bucket BIGINT PRIMARY KEY,
  winning SMALLINT NOT NULL CHECK (winning BETWEEN 1 AND 15),
  drawn_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.lottery_draws ENABLE ROW LEVEL SECURITY;

-- 5.7 reports: one row per account, slot, and KST day. AT TIME ZONE is STABLE, so the
-- unique index calls an IMMUTABLE wrapper of that same Seoul-date expression.
CREATE OR REPLACE FUNCTION public.report_kst_day(p_at TIMESTAMPTZ)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (p_at AT TIME ZONE 'Asia/Seoul')::date;
$$;

CREATE TABLE IF NOT EXISTS public.reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slot_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('abuse','ad','impersonation','other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS reports_day_idx
  ON public.reports (slot_id, reporter_id, (public.report_kst_day(created_at)));

CREATE TABLE IF NOT EXISTS public.billboard_reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slot_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  bid BIGINT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS billboard_reviews_pending_idx
  ON public.billboard_reviews (slot_id) WHERE status = 'pending';
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billboard_reviews ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RPC 1: Worker DO 전용 코인 배치 정산 (기존 tap_batch 대체)
-- p_items 형식: [{"actor_id":"guest:123", "nickname":"홍길동", "delta":45, "reason":"mine"}, ...]
-- coin_batch 항목: reason이 없으면 'mine'
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
  v_delta BIGINT;
  v_reason TEXT;
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
        updated_at = now();
    INSERT INTO public.coin_ledger (actor_id, delta, reason)
    VALUES (v_item->>'actor_id', v_delta, v_reason);
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
  IF NOT FOUND OR v_board.holder_id IS NULL OR COALESCE(v_board.lit_until, v_board.expires_at) <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', '지금 그 전광판을 산 광고주가 없어요.');
  END IF;
  IF v_board.holder_id = p_actor_id THEN
    RETURN jsonb_build_object('ok', false, 'error', '내 광고에는 코인을 팔 수 없어요.');
  END IF;
  INSERT INTO public.wallets (actor_id, nickname, coins)
  VALUES (p_actor_id, left(COALESCE(p_nickname, '네온손님'), 16), 100)
  ON CONFLICT (actor_id) DO NOTHING;
  SELECT * INTO v_seller FROM public.wallets WHERE actor_id = p_actor_id FOR UPDATE;
  IF NOT FOUND OR v_seller.coins < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', '팔 코인이 부족해요.');
  END IF;
  UPDATE public.wallets SET coins = coins - p_amount, nickname = left(p_nickname, 16), updated_at = now()
  WHERE actor_id = p_actor_id;
  UPDATE public.wallets SET coins = coins + p_amount, updated_at = now()
  WHERE actor_id = v_board.holder_id;
  -- buyer_id: Worker가 광고주 소켓에 WALLET_SYNC를 보내는 데만 쓴다. 클라이언트 응답에는 넣지 않는다.
  RETURN jsonb_build_object('ok', true, 'remaining_coins', v_seller.coins - p_amount, 'buyer_name', v_board.holder_name, 'buyer_id', v_board.holder_id, 'amount', p_amount);
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
  IF v_board.protected_until > now() AND COALESCE(v_board.lit_until, v_board.expires_at) > now() AND v_board.holder_id IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object('ok', false, 'error', '현재 광고의 최소 보장 시간이 남아있습니다.');
  END IF;

  -- 빈 자리는 등급 기본가. 누군가 점령 중일 때만 직전 입찰가 + 50.
  IF v_board.holder_id IS NULL OR COALESCE(v_board.lit_until, v_board.expires_at) <= now() THEN
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
  v_protect_mins := CASE v_board.tier WHEN 'S' THEN 120 WHEN 'B' THEN 60 ELSE 30 END;

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
      expires_at = now() + interval '72 hours',
      lit_until = now() + interval '72 hours',
      lit_days = 1,
      lit_on = (timezone('Asia/Seoul', now()))::date,
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
  IF v_board.holder_id IS DISTINCT FROM p_actor_id OR COALESCE(v_board.lit_until, v_board.expires_at) <= now() THEN
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

-- Floors of the 81 claimable slots (balance.js SLOTS). 0 means the id is not claimable.
CREATE OR REPLACE FUNCTION public.slot_floor(p_slot TEXT)
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_slot
    WHEN 'MAIN_UP' THEN 4000
    WHEN 'MAIN_TOP' THEN 3000
    WHEN 'MAIN_MID' THEN 2000
    WHEN 'MAIN_BOT' THEN 1500
    WHEN 'MAIN_LOW' THEN 1200
    WHEN 'SUB_1A' THEN 800 WHEN 'SUB_2A' THEN 800 WHEN 'SUB_3A' THEN 800 WHEN 'SUB_4A' THEN 800
    WHEN 'SUB_1B' THEN 500 WHEN 'SUB_2B' THEN 500 WHEN 'SUB_3B' THEN 500 WHEN 'SUB_4B' THEN 500
    ELSE CASE
      WHEN p_slot ~ '^STREET_([1-9]|[12][0-9]|30)$'
        THEN (200 + round((substring(p_slot from 8)::int - 1) * 200.0 / 29))::bigint
      WHEN p_slot ~ '^STREET_(3[1-9]|4[0-9]|50)$'
        THEN (150 + round((substring(p_slot from 8)::int - 31) * 100.0 / 19))::bigint
      WHEN p_slot ~ '^PLOT_([1-9]|1[0-8])$'
        THEN (100 + round((substring(p_slot from 6)::int - 1) * 200.0 / 17))::bigint
      ELSE 0
    END
  END;
$$;

-- Free first slots (claim_billboard p_mode = 'starter'). The one list the database enforces; nearest the bakery walk first,
-- then the eight new core faces nearest that walk. The Worker reads it with starter_slot_list and serves it in /rt/config.
-- migrations/2026-11-21-mid.sql part 1 added the first twelve; migrations/2026-11-22-boards.sql part 2 makes it these twenty.
CREATE OR REPLACE FUNCTION public.starter_slots()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY['STREET_20','STREET_23','STREET_28','STREET_19','STREET_27','STREET_16',
               'STREET_22','STREET_7','STREET_11','STREET_9','STREET_8','STREET_10',
               'STREET_32','STREET_37','STREET_31','STREET_44','STREET_43','STREET_36','STREET_33','STREET_45']::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.starter_slot_list(p_key TEXT)
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
  RETURN jsonb_build_object('ok', true, 'slots', to_jsonb(public.starter_slots()));
END;
$$;
GRANT EXECUTE ON FUNCTION public.starter_slots() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.starter_slot_list(TEXT) TO anon, authenticated, service_role;

-- 14-arg claim. The 12-arg claim_billboard stays. Drop only the old caption_y signature.
DROP FUNCTION IF EXISTS public.claim_billboard(text, text, text, text, bigint, text, text, text, text, text, text, text, integer);
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
  p_external_url TEXT DEFAULT NULL,
  p_caption_y INTEGER DEFAULT 72,
  p_mode TEXT DEFAULT 'claim'
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
  v_floor BIGINT;
  v_min_required BIGINT;
  v_protect_mins INT;
  v_prev_id TEXT;
  v_prev_name TEXT;
  v_prev_l1 TEXT;
  v_prev_l2 TEXT;
  v_prev_l3 TEXT;
  v_prev_emoji TEXT;
  v_prev_theme TEXT;
  v_prev_color TEXT;
  v_prev_bid BIGINT := 0;
  v_live BOOLEAN := false;
  v_charge BIGINT := 0;
  v_refund BIGINT := 0;
  v_landlord BIGINT := 0;
  v_event TEXT := 'claim';
  v_mono_before TEXT;
  v_mono_after TEXT;
  v_reclaim BIGINT;
  v_rival BOOLEAN;
  v_review BIGINT;
  v_payer TEXT;
  v_holder TEXT;
  v_name TEXT;
  v_tribe TEXT;
  v_tag TEXT;
  v_show BIGINT;
  v_left BIGINT;
  v_take BIGINT;
  v_pool_id BIGINT;
  v_pool_amount BIGINT;
  v_pool_spent BIGINT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;

  IF p_mode NOT IN ('claim', 'edit', 'starter', 'tribe') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mode');
  END IF;
  v_payer := p_actor_id;
  v_holder := p_actor_id;
  v_name := p_nickname;
  IF p_mode = 'tribe' THEN
    SELECT tm.tribe_id, t.tag INTO v_tribe, v_tag
    FROM public.tribe_members tm
    JOIN public.tribes t ON t.id = tm.tribe_id
    WHERE tm.actor_id = p_actor_id;
    IF v_tribe IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'tribe');
    END IF;
    v_payer := 'tribe:' || v_tribe;
    v_holder := v_payer;
    v_name := v_tag;
  END IF;
  IF p_slot_id LIKE 'MAIN_%' AND p_mode IN ('claim', 'starter', 'tribe')
     AND ((timezone('Asia/Seoul', now()))::time < time '21:00' OR (timezone('Asia/Seoul', now()))::time >= time '21:10') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'auction_closed');
  END IF;

  v_floor := public.slot_floor(p_slot_id);
  IF v_floor < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', '그 전광판은 점령할 수 없습니다.');
  END IF;

  IF p_mode IS DISTINCT FROM 'tribe' THEN
    INSERT INTO public.wallets (actor_id, nickname, coins)
    VALUES (p_actor_id, left(COALESCE(p_nickname, '익명'), 16), 100)
    ON CONFLICT (actor_id) DO NOTHING;
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE actor_id = v_payer FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '코인이 부족합니다. 붕어빵을 더 구워보세요!');
  END IF;
  SELECT * INTO v_board FROM public.billboards WHERE slot_id = p_slot_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '존재하지 않는 전광판 슬롯입니다.');
  END IF;

  v_live := v_board.holder_id IS NOT NULL AND COALESCE(v_board.lit_until, v_board.expires_at) > now();
  v_prev_id := v_board.holder_id;
  v_prev_name := v_board.holder_name;
  v_prev_l1 := v_board.line1;
  v_prev_l2 := v_board.line2;
  v_prev_l3 := v_board.line3;
  v_prev_emoji := v_board.emoji;
  v_prev_theme := v_board.bg_theme;
  v_prev_color := v_board.text_color;
  v_prev_bid := COALESCE(v_board.current_bid, 0);
  IF v_board.plot_id IS NOT NULL THEN
    SELECT owner_id INTO v_plot_owner FROM public.plots WHERE plot_id = v_board.plot_id;
  END IF;
  v_mono_before := public.monopoly_name();

  IF p_mode = 'starter' THEN
    IF p_bid <> 0 OR NOT (p_slot_id = ANY (public.starter_slots())) OR v_live THEN
      RETURN jsonb_build_object('ok', false, 'error', 'starter');
    END IF;
    INSERT INTO public.profiles (actor_id) VALUES (p_actor_id) ON CONFLICT (actor_id) DO NOTHING;
    PERFORM 1 FROM public.profiles WHERE actor_id = p_actor_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE actor_id = p_actor_id AND starter_slot IS NOT NULL) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'starter');
    END IF;
    v_charge := 0; v_refund := 0; v_landlord := 0;
    v_event := 'starter';
  ELSIF p_mode = 'edit' THEN
    IF v_board.holder_id IS DISTINCT FROM p_actor_id OR NOT v_live OR p_bid < v_board.current_bid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'edit');
    END IF;
    v_charge := GREATEST(0, p_bid - v_board.current_bid);
    v_refund := 0;
    v_landlord := 0;
    IF v_board.plot_id IS NOT NULL AND v_plot_owner IS NOT NULL AND v_plot_owner IS DISTINCT FROM p_actor_id THEN
      v_landlord := v_charge / 2;
    END IF;
    v_event := 'edit';
  ELSE
    IF v_board.protected_until > now() AND v_live AND v_board.holder_id IS DISTINCT FROM p_actor_id THEN
      RETURN jsonb_build_object('ok', false, 'error', '현재 광고의 최소 보장 시간이 남아있습니다.');
    END IF;
    IF NOT v_live THEN
      v_min_required := v_floor;
    ELSE
      v_min_required := GREATEST(v_floor, v_board.current_bid + 50);
    END IF;
    IF v_mono_before IS NOT NULL AND p_slot_id LIKE 'MAIN_%' AND NOT public.monopoly_member(v_holder, p_line1, p_line2, p_line3) THEN
      v_min_required := ceil(v_min_required * 1.5)::bigint;
    END IF;
    IF p_bid < v_min_required THEN
      RETURN jsonb_build_object('ok', false, 'error', '최소 ' || v_min_required || ' 코인 이상 입찰해야 합니다.');
    END IF;
    v_charge := p_bid;
    IF NOT v_live THEN
      v_refund := 0;
      v_landlord := CASE WHEN v_board.plot_id IS NOT NULL AND v_plot_owner IS NOT NULL AND v_plot_owner IS DISTINCT FROM v_holder THEN p_bid / 2 ELSE 0 END;
    ELSE
      v_refund := LEAST(p_bid, v_prev_bid * 80 / 100);
      v_landlord := (p_bid - v_refund) / 2;
      IF v_board.plot_id IS NULL OR v_plot_owner IS NULL OR v_plot_owner = v_holder OR v_plot_owner = v_board.holder_id THEN
        v_landlord := 0;
      END IF;
    END IF;
    v_event := CASE WHEN v_live AND v_prev_id IS NOT NULL AND v_prev_id IS DISTINCT FROM v_holder THEN 'takeover' ELSE 'claim' END;
  END IF;

  IF v_refund > v_charge THEN
    v_refund := v_charge;
  END IF;
  IF v_refund + v_landlord > v_charge THEN
    v_landlord := v_charge - v_refund;
  END IF;
  IF v_wallet.coins < v_charge THEN
    RETURN jsonb_build_object('ok', false, 'error', '코인이 부족합니다. 붕어빵을 더 구워보세요!');
  END IF;

  -- S-tier claim waits for review. The bid is held here; the board and the 4.1 split wait until approval.
  -- Tribe pays from tribe:<id>. The review stores that id so approval does not charge the member.
  IF v_board.tier = 'S' AND p_mode IN ('claim', 'tribe') THEN
    IF EXISTS (SELECT 1 FROM public.billboard_reviews WHERE slot_id = p_slot_id AND status = 'pending') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'pending');
    END IF;
    IF v_wallet.coins < p_bid THEN
      RETURN jsonb_build_object('ok', false, 'error', '코인이 부족합니다. 붕어빵을 더 구워보세요!');
    END IF;
    UPDATE public.wallets SET coins = coins - p_bid, updated_at = now() WHERE actor_id = v_payer;
    INSERT INTO public.coin_ledger (actor_id, delta, reason, ref) VALUES (v_payer, -p_bid, 'claim', p_slot_id);
    IF p_mode = 'tribe' AND v_tribe IS NOT NULL THEN
      v_left := p_bid;
      FOR v_pool_id, v_pool_amount, v_pool_spent IN
        SELECT id, amount, spent FROM public.tribe_pool
        WHERE tribe_id = v_tribe AND spent < amount
        ORDER BY week, id
        FOR UPDATE
      LOOP
        EXIT WHEN v_left <= 0;
        v_take := LEAST(v_left, v_pool_amount - v_pool_spent);
        UPDATE public.tribe_pool SET spent = spent + v_take WHERE id = v_pool_id;
        v_left := v_left - v_take;
      END LOOP;
    END IF;
    INSERT INTO public.billboard_reviews (slot_id, actor_id, bid, payload)
    VALUES (p_slot_id, v_payer, p_bid, jsonb_build_object(
      'nickname', left(CASE WHEN p_mode = 'tribe' THEN v_name ELSE p_nickname END, 16),
      'line1', left(p_line1, 16), 'line2', left(p_line2, 16), 'line3', left(p_line3, 16),
      'emoji', left(COALESCE(p_emoji, '✨'), 4), 'bg_theme', p_bg_theme, 'text_color', p_text_color,
      'external_url', p_external_url, 'caption_y', p_caption_y, 'member', p_actor_id))
    RETURNING id INTO v_review;
    IF p_mode = 'tribe' THEN
      SELECT coins INTO v_show FROM public.wallets WHERE actor_id = p_actor_id;
    ELSE
      v_show := v_wallet.coins - p_bid;
    END IF;
    RETURN jsonb_build_object('ok', true, 'review_id', v_review, 'remaining_coins', COALESCE(v_show, 0));
  END IF;

  UPDATE public.wallets
  SET coins = coins - v_charge,
      nickname = CASE WHEN p_mode = 'tribe' THEN nickname ELSE left(p_nickname, 16) END,
      updated_at = now()
  WHERE actor_id = v_payer;

  IF p_mode = 'starter' THEN
    INSERT INTO public.coin_ledger (actor_id, delta, reason, ref)
    VALUES (p_actor_id, 0, 'starter', p_slot_id);
  ELSIF v_charge > 0 THEN
    INSERT INTO public.coin_ledger (actor_id, delta, reason, ref)
    VALUES (v_payer, -v_charge, 'claim', p_slot_id);
  END IF;
  IF p_mode = 'tribe' AND v_tribe IS NOT NULL AND v_charge > 0 THEN
    v_left := v_charge;
    FOR v_pool_id, v_pool_amount, v_pool_spent IN
      SELECT id, amount, spent FROM public.tribe_pool
      WHERE tribe_id = v_tribe AND spent < amount
      ORDER BY week, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_left <= 0;
      v_take := LEAST(v_left, v_pool_amount - v_pool_spent);
      UPDATE public.tribe_pool SET spent = spent + v_take WHERE id = v_pool_id;
      v_left := v_left - v_take;
    END LOOP;
  END IF;

  IF v_refund > 0 AND v_prev_id IS NOT NULL THEN
    UPDATE public.wallets SET coins = coins + v_refund, updated_at = now()
    WHERE actor_id = v_prev_id;
    IF FOUND THEN
      INSERT INTO public.coin_ledger (actor_id, delta, reason, ref)
      VALUES (v_prev_id, v_refund, 'refund', p_slot_id);
    END IF;
  END IF;
  IF v_landlord > 0 AND v_plot_owner IS NOT NULL THEN
    UPDATE public.wallets SET coins = coins + v_landlord, updated_at = now()
    WHERE actor_id = v_plot_owner;
    IF FOUND THEN
      INSERT INTO public.coin_ledger (actor_id, delta, reason, ref)
      VALUES (v_plot_owner, v_landlord, 'landlord', p_slot_id);
    END IF;
  END IF;

  v_protect_mins := CASE v_board.tier WHEN 'S' THEN 120 WHEN 'B' THEN 60 ELSE 30 END;
  -- Linked accounts (Google and email, both user:) get one extra 5 minutes. Do not add a separate +3.
  IF left(p_actor_id, 5) = 'user:' THEN
    v_protect_mins := v_protect_mins + 5;
  END IF;

  IF v_board.photo_id IS NOT NULL AND v_prev_id IS DISTINCT FROM v_holder THEN
    UPDATE public.wallets w SET coins = w.coins + p.fee, updated_at = now()
    FROM public.billboard_photos p
    WHERE p.photo_id = v_board.photo_id AND p.status = 'pending' AND w.actor_id = p.actor_id;
    UPDATE public.billboard_photos SET status = 'lapsed', jpeg = ''::BYTEA, reviewed_at = COALESCE(reviewed_at, now())
    WHERE photo_id = v_board.photo_id AND status IN ('pending', 'approved');
  END IF;

  UPDATE public.billboards
  SET photo_id = CASE WHEN p_mode = 'edit' AND v_prev_id = v_holder THEN v_board.photo_id END,
      photo_status = CASE WHEN p_mode = 'edit' AND v_prev_id = v_holder THEN v_board.photo_status END,
      holder_id = v_holder,
      holder_name = left(COALESCE(v_name, ''), 16),
      line1 = left(COALESCE(p_line1, ''), 16),
      line2 = left(COALESCE(p_line2, ''), 16),
      line3 = left(COALESCE(p_line3, ''), 16),
      emoji = left(COALESCE(p_emoji, '✨'), 4),
      bg_theme = COALESCE(p_bg_theme, 'cyber_navy'),
      text_color = COALESCE(p_text_color, '#ffffff'),
      external_url = CASE WHEN left(COALESCE(p_external_url, ''), 200) ~ '^https://' THEN left(p_external_url, 200) ELSE NULL END,
      caption_y = LEAST(88, GREATEST(12, COALESCE(p_caption_y, 72))),
      current_bid = p_bid,
      protected_until = now() + (v_protect_mins || ' minutes')::INTERVAL,
      expires_at = CASE WHEN p_mode = 'edit' THEN v_board.expires_at ELSE now() + interval '72 hours' END,
      lit_until = CASE WHEN p_mode = 'edit' THEN v_board.lit_until ELSE now() + interval '72 hours' END,
      lit_days = CASE WHEN p_mode = 'edit' THEN v_board.lit_days ELSE 1 END,
      lit_on = CASE WHEN p_mode = 'edit' THEN v_board.lit_on ELSE (timezone('Asia/Seoul', now()))::date END,
      updated_at = now()
  WHERE slot_id = p_slot_id
  RETURNING * INTO v_board;

  IF p_mode = 'starter' THEN
    UPDATE public.profiles SET starter_slot = p_slot_id WHERE actor_id = p_actor_id;
  END IF;

  INSERT INTO public.billboard_history (slot_id, holder_id, holder_name, line1, line2, line3, bid, event)
  VALUES (
    p_slot_id, v_holder, left(COALESCE(v_name, ''), 16),
    left(COALESCE(p_line1, ''), 16), left(COALESCE(p_line2, ''), 16), left(COALESCE(p_line3, ''), 16),
    GREATEST(0, p_bid), v_event
  );

  v_mono_after := public.monopoly_name();
  v_reclaim := v_board.current_bid + 50;
  v_rival := v_mono_after IS NOT NULL AND p_slot_id LIKE 'MAIN_%'
    AND NOT public.monopoly_member(v_prev_id, v_prev_l1, v_prev_l2, v_prev_l3);
  IF v_rival THEN
    v_reclaim := ceil(v_reclaim * 1.5)::bigint;
  END IF;
  IF p_mode = 'tribe' THEN
    SELECT coins INTO v_show FROM public.wallets WHERE actor_id = p_actor_id;
  ELSE
    v_show := v_wallet.coins - v_charge;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'billboard', row_to_json(v_board),
    'remaining_coins', COALESCE(v_show, 0),
    'prev_holder_id', v_prev_id,
    'prev_holder_name', v_prev_name,
    'prev_line1', v_prev_l1,
    'prev_line2', v_prev_l2,
    'prev_line3', v_prev_l3,
    'prev_emoji', v_prev_emoji,
    'prev_theme', v_prev_theme,
    'prev_color', v_prev_color,
    'reclaim_bid', CASE WHEN v_prev_id IS NOT NULL AND v_prev_id IS DISTINCT FROM v_holder THEN v_reclaim ELSE NULL END,
    'monopoly_name', CASE WHEN v_mono_after IS NOT NULL AND v_mono_before IS NULL THEN v_mono_after ELSE NULL END,
    'refund', v_refund,
    'landlord', v_landlord
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_billboard_photo(p_key TEXT, p_slot_id TEXT)
RETURNS VOID
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
  UPDATE public.billboards
  SET photo_id = NULL, photo_status = NULL, updated_at = now()
  WHERE slot_id = p_slot_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.clear_billboard_photo(TEXT, TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_lottery_draw(p_key TEXT, p_bucket BIGINT, p_winning INT)
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
  IF p_winning IS NULL OR p_winning < 1 OR p_winning > 15 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  INSERT INTO public.lottery_draws (bucket, winning)
  VALUES (p_bucket, p_winning)
  ON CONFLICT (bucket) DO NOTHING;
  RETURN jsonb_build_object('ok', true);
END;
$$;
CREATE OR REPLACE FUNCTION public.monopoly_name()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_n INT;
  v_holder TEXT;
  v_name TEXT;
  v_tag TEXT;
BEGIN
  SELECT count(*), min(holder_id), min(holder_name)
  INTO v_n, v_holder, v_name
  FROM public.billboards
  WHERE slot_id IN ('MAIN_TOP', 'MAIN_MID', 'MAIN_BOT')
    AND holder_id IS NOT NULL
    AND COALESCE(lit_until, expires_at) > now();
  IF v_n < 3 THEN
    RETURN NULL;
  END IF;
  IF (SELECT count(DISTINCT holder_id) FROM public.billboards
      WHERE slot_id IN ('MAIN_TOP', 'MAIN_MID', 'MAIN_BOT') AND holder_id IS NOT NULL AND COALESCE(lit_until, expires_at) > now()) = 1 THEN
    RETURN v_name;
  END IF;
  SELECT t.tag INTO v_tag
  FROM (
    SELECT (regexp_matches(coalesce(line1, '') || ' ' || coalesce(line2, '') || ' ' || coalesce(line3, ''), '#[0-9A-Za-z가-힣_]{1,16}', 'g'))[1] AS tag,
           slot_id
    FROM public.billboards
    WHERE slot_id IN ('MAIN_TOP', 'MAIN_MID', 'MAIN_BOT') AND COALESCE(lit_until, expires_at) > now()
  ) t
  GROUP BY t.tag
  HAVING count(DISTINCT t.slot_id) = 3
  LIMIT 1;
  RETURN v_tag;
END;
$$;

CREATE OR REPLACE FUNCTION public.monopoly_member(p_actor TEXT, p_l1 TEXT, p_l2 TEXT, p_l3 TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_holder TEXT;
  v_tag TEXT;
  v_blob TEXT;
BEGIN
  IF public.monopoly_name() IS NULL THEN
    RETURN FALSE;
  END IF;
  SELECT holder_id INTO v_holder FROM public.billboards
  WHERE slot_id = 'MAIN_TOP' AND COALESCE(lit_until, expires_at) > now();
  IF v_holder IS NOT NULL AND v_holder = p_actor
     AND (SELECT count(DISTINCT holder_id) FROM public.billboards
          WHERE slot_id IN ('MAIN_TOP', 'MAIN_MID', 'MAIN_BOT') AND COALESCE(lit_until, expires_at) > now()) = 1 THEN
    RETURN TRUE;
  END IF;
  v_blob := coalesce(p_l1, '') || ' ' || coalesce(p_l2, '') || ' ' || coalesce(p_l3, '');
  SELECT t.tag INTO v_tag
  FROM (
    SELECT (regexp_matches(coalesce(line1, '') || ' ' || coalesce(line2, '') || ' ' || coalesce(line3, ''), '#[0-9A-Za-z가-힣_]{1,16}', 'g'))[1] AS tag,
           slot_id
    FROM public.billboards
    WHERE slot_id IN ('MAIN_TOP', 'MAIN_MID', 'MAIN_BOT') AND COALESCE(lit_until, expires_at) > now()
  ) t
  GROUP BY t.tag
  HAVING count(DISTINCT t.slot_id) = 3
  LIMIT 1;
  IF v_tag IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN v_blob ~ v_tag;
END;
$$;

-- Sticker (30) and all-board takeover (5000, or one VIP ticket). Amounts are fixed so this cannot drain a wallet by a guessed call.
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

-- ============================================================================
-- Coin guard in the database (migrations/2026-11-22-coins.sql adds all of this to production).
-- gone_logins: accounts that withdrew, as salted hashes of the account id and of its login e-mail, never the raw values. The salt
--   (app_secrets GONE_SALT) is made once, here, and never leaves the database. It has nothing to do with the Worker's keys, so rotating
--   GUEST_KEY or FLUSH_KEY forgets no withdrawal. A trigger writes the marks whenever a user: wallet row is deleted (withdraw_account).
-- starter_taken: per guest, how many of its arrival coins (the starting 100 and the hello bonus 40, 140 in all) links have already
--   moved into an account (0..140, only grows). merge_guest_account reads and writes it in the same transaction as the move.
-- wallets_need_login: no wallet row for a signed-in id whose login is gone, so a withdrawn account's token (it lives up to an hour)
--   cannot make itself a fresh 100-coin wallet.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.gone_logins (
  h TEXT PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.gone_logins ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.starter_taken (
  guest_id TEXT PRIMARY KEY,
  taken INT NOT NULL DEFAULT 0 CHECK (taken BETWEEN 0 AND 140),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.starter_taken ENABLE ROW LEVEL SECURITY;
INSERT INTO public.app_secrets (key_name, key_value)
VALUES ('GONE_SALT', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (key_name) DO NOTHING;

-- A withdrawal mark: 32 hex characters of SHA-256 over the salt, the kind ('id' or 'mail') and the value. NULL without a value.
CREATE OR REPLACE FUNCTION public.gone_hash(p_kind TEXT, p_value TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN COALESCE(p_value, '') = '' OR s.salt IS NULL THEN NULL
    ELSE left(encode(sha256(convert_to(s.salt || ':' || p_kind || ':' || p_value, 'UTF8')), 'hex'), 32) END
  FROM (SELECT (SELECT key_value FROM public.app_secrets WHERE key_name = 'GONE_SALT') AS salt) s;
$$;
REVOKE ALL ON FUNCTION public.gone_hash(TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- A deleted user: wallet row (withdraw_account) leaves its marks: the id, and the login e-mail while auth.users still has it
-- (forget_login runs after withdraw_account). A second withdrawal moves `at` forward.
CREATE OR REPLACE FUNCTION public.wallets_gone_mark()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mail TEXT;
BEGIN
  IF OLD.actor_id LIKE 'user:%' THEN
    IF to_regclass('auth.users') IS NOT NULL AND OLD.actor_id ~ '^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT lower(email) INTO v_mail FROM auth.users WHERE id = substr(OLD.actor_id, 6)::uuid;
    END IF;
    INSERT INTO public.gone_logins (h, at)
    SELECT k, now() FROM unnest(ARRAY[public.gone_hash('id', OLD.actor_id), public.gone_hash('mail', v_mail)]) AS k
    WHERE k IS NOT NULL
    ON CONFLICT (h) DO UPDATE SET at = now();
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS wallets_gone_mark ON public.wallets;
CREATE TRIGGER wallets_gone_mark AFTER DELETE ON public.wallets FOR EACH ROW EXECUTE FUNCTION public.wallets_gone_mark();

-- No wallet row for a signed-in id with no login. After forget_login deleted a login, its access token still works for up to an hour,
-- and every wallet INSERT (profile_read, coin_batch, claim_billboard, a link, ...) would have made a fresh 100-coin wallet for it.
-- Such an INSERT is skipped (the row is not made), so a coin flush for it adds nothing and a function that then finds no wallet
-- refuses as it does for any missing wallet (the functions that make a wallet on their way end with {ok: false, error: 'login'}).
-- A database without auth.users (a test database) checks no login.
-- A new user: row made anywhere but merge_guest_account starts at 0, not the column's 100: before, an account whose row a profile read,
-- a species save or a room flush made before its first link kept those 100 on top of its first guest's coins and the +300. An
-- anonymous sign-in (it cannot link) keeps the 100. A refund that lands on a user: row deleted by a withdrawal (review_slot_claim,
-- refund_tribe_week make the row with the amount) loses up to 100 the same way; that row has no login after forget_login anyway.
CREATE OR REPLACE FUNCTION public.wallets_need_login()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_anon BOOLEAN := false;
BEGIN
  IF NEW.actor_id LIKE 'user:%' THEN
    IF to_regclass('auth.users') IS NOT NULL THEN
      IF NEW.actor_id !~ '^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN NULL;
      END IF;
      SELECT COALESCE((to_jsonb(u) ->> 'is_anonymous')::boolean, false) INTO v_anon FROM auth.users u WHERE u.id = substr(NEW.actor_id, 6)::uuid;
      IF NOT FOUND THEN
        RETURN NULL;
      END IF;
    END IF;
    -- A new account row made anywhere but merge_guest_account (which makes its own with 0) starts without the 100 every new wallet gets:
    -- an account's starting coins come with its first guest. An anonymous sign-in cannot link, so it keeps them. A row that is already
    -- there is left alone (the INSERT goes to its ON CONFLICT, and EXCLUDED must stay what the function sent).
    IF NOT COALESCE(v_anon, false) AND NOT EXISTS (SELECT 1 FROM public.wallets WHERE actor_id = NEW.actor_id) THEN
      NEW.coins := GREATEST(0, NEW.coins - 100);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS wallets_need_login ON public.wallets;
CREATE TRIGGER wallets_need_login BEFORE INSERT ON public.wallets FOR EACH ROW EXECUTE FUNCTION public.wallets_need_login();

-- Move a guest wallet onto a Supabase user, and keep the coins nobody earned out of it, in this one transaction.
-- Every guest wallet starts with 100 coins and the hello bonus pays 40 on arrival: 140 "arrival coins". The account's first link
-- (link_bonus still false and no withdrawal mark) moves everything and pays +300 once; the guest's arrival coins are spoken for with
-- it. Every later link moves only what the guest holds above the arrival coins it has not moved yet (starter_taken), so a guest
-- that spent them moves only its earnings. An account that withdrew before (gone_logins: its id or its login e-mail) gets no
-- second +300, its link counts as a later one, and the answer says again = true. Spending in between cannot slip through: the move
-- and the take-back are one step. The account never ends below what it had before the call.
-- guard = 2 tells the Worker the database did all of this (it keeps its own take-back only for the older function).
CREATE OR REPLACE FUNCTION public.merge_guest_account(
  p_key TEXT,
  p_user_id TEXT,
  p_guest_id TEXT,
  p_nickname TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_user public.wallets%ROWTYPE;
  v_guest public.wallets%ROWTYPE;
  v_moved BIGINT := 0;
  v_back BIGINT := 0;
  v_bonus INT := 0;
  v_taken INT := 0;
  v_again BOOLEAN := false;
  v_mail TEXT;
  v_name TEXT := left(COALESCE(p_nickname, ''), 16);
  v_coins BIGINT;
  v_nick TEXT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  IF p_user_id IS NULL OR p_user_id !~ '^user:[A-Za-z0-9_-]{8,80}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', '계정 정보가 올바르지 않습니다.', 'guard', 2);
  END IF;
  IF p_guest_id IS NULL OR p_guest_id !~ '^guest:g-[0-9a-f-]{36}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', '게스트 정보가 올바르지 않습니다.', 'guard', 2);
  END IF;

  INSERT INTO public.wallets (actor_id, nickname, coins, linked, link_bonus)
  VALUES (p_user_id, '네온손님', 0, true, false)
  ON CONFLICT (actor_id) DO NOTHING;
  SELECT * INTO v_user FROM public.wallets WHERE actor_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    -- wallets_need_login skipped the row: this id has no login any more (a withdrawal deleted it). Nothing moves.
    RETURN jsonb_build_object('ok', false, 'error', '로그인 정보를 찾지 못했어요. 다시 로그인해 주세요.', 'guard', 2);
  END IF;
  SELECT * INTO v_guest FROM public.wallets WHERE actor_id = p_guest_id FOR UPDATE;
  IF FOUND AND v_guest.coins > 0 THEN
    v_moved := v_guest.coins;
    UPDATE public.wallets SET coins = 0, updated_at = now() WHERE actor_id = p_guest_id;
  END IF;

  INSERT INTO public.starter_taken (guest_id) VALUES (p_guest_id) ON CONFLICT (guest_id) DO NOTHING;
  SELECT taken INTO v_taken FROM public.starter_taken WHERE guest_id = p_guest_id FOR UPDATE;

  IF NOT v_user.link_bonus THEN
    IF to_regclass('auth.users') IS NOT NULL AND p_user_id ~ '^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT lower(email) INTO v_mail FROM auth.users WHERE id = substr(p_user_id, 6)::uuid;
    END IF;
    v_again := EXISTS (
      SELECT 1 FROM public.gone_logins
      WHERE h = public.gone_hash('id', p_user_id) OR h = public.gone_hash('mail', v_mail)
    );
  END IF;

  IF NOT v_user.link_bonus AND NOT v_again THEN
    -- The account's first link: everything moves and +300 once. Only what it really moved of this guest's arrival coins counts as moved:
    -- coins that reach the guest later (its row made only now, a late flush) are held back from its next link like any guest's.
    v_bonus := 300;
    v_taken := GREATEST(v_taken, LEAST(140, v_moved));
  ELSE
    -- A later link, or the first one of an account that withdrew before: the arrival coins not moved yet stay out.
    v_back := LEAST(v_moved, GREATEST(0, 140 - v_taken));
    v_taken := v_taken + v_back;
  END IF;
  UPDATE public.starter_taken SET taken = v_taken, updated_at = now() WHERE guest_id = p_guest_id;

  UPDATE public.wallets
  SET coins = coins + v_moved - v_back + v_bonus,
      link_bonus = true,
      linked = true,
      nickname = CASE WHEN v_name <> '' THEN v_name ELSE nickname END,
      updated_at = now()
  WHERE actor_id = p_user_id
  RETURNING coins, nickname INTO v_coins, v_nick;

  UPDATE public.billboards SET holder_id = p_user_id, updated_at = now() WHERE holder_id = p_guest_id;
  UPDATE public.plots SET owner_id = p_user_id, updated_at = now() WHERE owner_id = p_guest_id;
  UPDATE public.billboard_photos SET actor_id = p_user_id WHERE actor_id = p_guest_id;

  -- No 'moved' key: a Worker that still runs its own take-back reads its absence as "nothing to take back", so the two never stack.
  RETURN jsonb_build_object(
    'ok', true,
    'actor_id', p_user_id,
    'coins', v_coins,
    'bonus', v_bonus,
    'moved_in', v_moved,
    'back', v_back,
    'again', v_again,
    'nickname', v_nick,
    'linked', true,
    'guard', 2
  );
END;
$$;

-- Delete one signed-in user's wallet linkage and clear only that user's boards and plots.
CREATE OR REPLACE FUNCTION public.withdraw_account(
  p_key TEXT,
  p_actor_id TEXT
)
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
  IF p_actor_id !~ '^user:[A-Za-z0-9_-]{8,80}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', '계정 정보가 올바르지 않습니다.');
  END IF;

  UPDATE public.billboards
  SET holder_id = NULL,
      holder_name = 'K-TIMES SQUARE',
      protected_until = now(),
      expires_at = now(),
      photo_id = NULL,
      photo_status = NULL,
      updated_at = now()
  WHERE holder_id = p_actor_id;

  UPDATE public.plots
  SET owner_id = NULL,
      owner_name = NULL,
      level = 0,
      sign_text = '분양 대기중',
      updated_at = now()
  WHERE owner_id = p_actor_id;

  UPDATE public.billboard_photos
  SET status = 'removed', jpeg = ''::BYTEA, reviewed_at = now()
  WHERE actor_id = p_actor_id AND status IN ('pending', 'approved');

  -- Push subscriptions saved only here (before the Worker kept its own copy) go with the account.
  DELETE FROM public.push_subs WHERE actor_id = p_actor_id;
  DELETE FROM public.wallets WHERE actor_id = p_actor_id;
  RETURN jsonb_build_object('ok', true, 'actor_id', p_actor_id);
END;
$$;

-- The last step of a withdrawal: delete the login itself (the auth.users row; identities, sessions and refresh tokens go by cascade).
-- Supabase Auth has no route for a user to delete itself, so the Worker calls this after withdraw_account. It refuses while a wallet row
-- still exists, so it can finish a withdrawal but never delete a live account. The function must be owned by a role that may delete
-- from auth.users (postgres, the SQL editor's default). migrations/2026-11-22-forget-login.sql adds it to production and checks that.
CREATE OR REPLACE FUNCTION public.forget_login(p_key TEXT, p_actor_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_n INT := 0;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id !~ '^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'id');
  END IF;
  IF EXISTS (SELECT 1 FROM public.wallets WHERE actor_id = p_actor_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wallet');
  END IF;
  DELETE FROM auth.users WHERE id = substr(p_actor_id, 6)::uuid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'deleted', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.forget_login(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.forget_login(TEXT, TEXT) TO anon, authenticated, service_role;

-- One report per account, slot, and KST day. A repeat still counts as received.
CREATE OR REPLACE FUNCTION public.file_report(p_key TEXT, p_actor_id TEXT, p_slot_id TEXT, p_reason TEXT)
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
  IF p_reason IS NULL OR p_reason NOT IN ('abuse', 'ad', 'impersonation', 'other') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reason');
  END IF;
  BEGIN
    INSERT INTO public.reports (slot_id, reporter_id, reason)
    VALUES (p_slot_id, p_actor_id, p_reason);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', true);
  END;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_reports(p_key TEXT)
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
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'slot_id', slot_id, 'reporter_id', reporter_id, 'reason', reason, 'created_at', created_at
  ) ORDER BY id DESC), '[]'::JSONB)
  INTO v_items
  FROM (
    SELECT id, slot_id, reporter_id, reason, created_at
    FROM public.reports
    ORDER BY id DESC
    LIMIT 80
  ) s;
  RETURN jsonb_build_object('ok', true, 'items', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_billboard_reviews(p_key TEXT)
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
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'slot_id', slot_id, 'actor_id', actor_id, 'bid', bid, 'payload', payload, 'created_at', created_at
  ) ORDER BY id ASC), '[]'::JSONB)
  INTO v_items
  FROM (
    SELECT id, slot_id, actor_id, bid, payload, created_at
    FROM public.billboard_reviews
    WHERE status = 'pending'
    ORDER BY id ASC
    LIMIT 40
  ) s;
  RETURN jsonb_build_object('ok', true, 'items', v_items);
END;
$$;

-- Approve applies 4.1 to the board's current bid at this moment. The buyer was already charged.
-- Reject returns that bid in full. Pending rows only. The auction window may already be closed.
CREATE OR REPLACE FUNCTION public.review_slot_claim(p_key TEXT, p_id BIGINT, p_approve BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_row public.billboard_reviews%ROWTYPE;
  v_board public.billboards%ROWTYPE;
  v_plot_owner TEXT;
  v_prev_id TEXT;
  v_prev_name TEXT;
  v_prev_l1 TEXT;
  v_prev_l2 TEXT;
  v_prev_l3 TEXT;
  v_prev_emoji TEXT;
  v_prev_theme TEXT;
  v_prev_color TEXT;
  v_prev_bid BIGINT := 0;
  v_live BOOLEAN := false;
  v_bid BIGINT := 0;
  v_refund BIGINT := 0;
  v_landlord BIGINT := 0;
  v_coins BIGINT;
  v_protect_mins INT;
  v_exp TIMESTAMPTZ;
  v_event TEXT;
  v_mono_before TEXT;
  v_mono_after TEXT;
  v_reclaim BIGINT;
  v_rival BOOLEAN;
  v_cap INT;
  v_url TEXT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;

  SELECT * INTO v_row FROM public.billboard_reviews WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_row.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pending');
  END IF;

  IF p_approve IS NOT TRUE THEN
    UPDATE public.billboard_reviews SET status = 'rejected' WHERE id = p_id;
    INSERT INTO public.wallets (actor_id, nickname, coins)
    VALUES (v_row.actor_id, left(COALESCE(v_row.payload->>'nickname', '익명'), 16), v_row.bid)
    ON CONFLICT (actor_id) DO UPDATE
    SET coins = public.wallets.coins + EXCLUDED.coins, updated_at = now()
    RETURNING coins INTO v_coins;
    INSERT INTO public.coin_ledger (actor_id, delta, reason, ref)
    VALUES (v_row.actor_id, v_row.bid, 'refund', v_row.slot_id);
    RETURN jsonb_build_object('ok', true, 'rejected', true, 'actor_id', v_row.actor_id, 'refund', v_row.bid, 'remaining_coins', v_coins);
  END IF;

  SELECT * INTO v_board FROM public.billboards WHERE slot_id = v_row.slot_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.billboard_reviews SET status = 'rejected' WHERE id = p_id;
    INSERT INTO public.wallets (actor_id, nickname, coins)
    VALUES (v_row.actor_id, left(COALESCE(v_row.payload->>'nickname', '익명'), 16), v_row.bid)
    ON CONFLICT (actor_id) DO UPDATE
    SET coins = public.wallets.coins + EXCLUDED.coins, updated_at = now();
    INSERT INTO public.coin_ledger (actor_id, delta, reason, ref)
    VALUES (v_row.actor_id, v_row.bid, 'refund', v_row.slot_id);
    RETURN jsonb_build_object('ok', false, 'error', 'slot');
  END IF;

  v_bid := v_row.bid;
  v_live := v_board.holder_id IS NOT NULL AND COALESCE(v_board.lit_until, v_board.expires_at) > now();
  v_prev_id := v_board.holder_id;
  v_prev_name := v_board.holder_name;
  v_prev_l1 := v_board.line1;
  v_prev_l2 := v_board.line2;
  v_prev_l3 := v_board.line3;
  v_prev_emoji := v_board.emoji;
  v_prev_theme := v_board.bg_theme;
  v_prev_color := v_board.text_color;
  v_prev_bid := COALESCE(v_board.current_bid, 0);
  IF v_board.plot_id IS NOT NULL THEN
    SELECT owner_id INTO v_plot_owner FROM public.plots WHERE plot_id = v_board.plot_id;
  END IF;
  v_mono_before := public.monopoly_name();

  IF NOT v_live THEN
    v_refund := 0;
    v_landlord := CASE WHEN v_board.plot_id IS NOT NULL AND v_plot_owner IS NOT NULL AND v_plot_owner IS DISTINCT FROM v_row.actor_id THEN v_bid / 2 ELSE 0 END;
  ELSE
    v_refund := LEAST(v_bid, v_prev_bid * 80 / 100);
    v_landlord := (v_bid - v_refund) / 2;
    IF v_board.plot_id IS NULL OR v_plot_owner IS NULL OR v_plot_owner = v_row.actor_id OR v_plot_owner = v_board.holder_id THEN
      v_landlord := 0;
    END IF;
  END IF;
  IF v_refund > v_bid THEN
    v_refund := v_bid;
  END IF;
  IF v_refund + v_landlord > v_bid THEN
    v_landlord := v_bid - v_refund;
  END IF;

  IF v_refund > 0 AND v_prev_id IS NOT NULL THEN
    UPDATE public.wallets SET coins = coins + v_refund, updated_at = now()
    WHERE actor_id = v_prev_id;
    IF FOUND THEN
      INSERT INTO public.coin_ledger (actor_id, delta, reason, ref)
      VALUES (v_prev_id, v_refund, 'refund', v_row.slot_id);
    END IF;
  END IF;
  IF v_landlord > 0 AND v_plot_owner IS NOT NULL THEN
    UPDATE public.wallets SET coins = coins + v_landlord, updated_at = now()
    WHERE actor_id = v_plot_owner;
    IF FOUND THEN
      INSERT INTO public.coin_ledger (actor_id, delta, reason, ref)
      VALUES (v_plot_owner, v_landlord, 'landlord', v_row.slot_id);
    END IF;
  END IF;

  v_protect_mins := CASE v_board.tier WHEN 'S' THEN 120 WHEN 'B' THEN 60 ELSE 30 END;
  IF left(v_row.actor_id, 5) = 'user:' THEN
    v_protect_mins := v_protect_mins + 5;
  END IF;
  v_exp := now() + interval '72 hours';
  v_event := CASE WHEN v_live AND v_prev_id IS NOT NULL AND v_prev_id IS DISTINCT FROM v_row.actor_id THEN 'takeover' ELSE 'claim' END;
  v_cap := LEAST(88, GREATEST(12, COALESCE(NULLIF(v_row.payload->>'caption_y', '')::INT, 72)));
  v_url := left(COALESCE(v_row.payload->>'external_url', ''), 200);

  IF v_board.photo_id IS NOT NULL AND v_prev_id IS DISTINCT FROM v_row.actor_id THEN
    UPDATE public.wallets w SET coins = w.coins + p.fee, updated_at = now()
    FROM public.billboard_photos p
    WHERE p.photo_id = v_board.photo_id AND p.status = 'pending' AND w.actor_id = p.actor_id;
    UPDATE public.billboard_photos SET status = 'lapsed', jpeg = ''::BYTEA, reviewed_at = COALESCE(reviewed_at, now())
    WHERE photo_id = v_board.photo_id AND status IN ('pending', 'approved');
  END IF;

  UPDATE public.billboards
  SET photo_id = CASE WHEN v_prev_id = v_row.actor_id THEN v_board.photo_id END,
      photo_status = CASE WHEN v_prev_id = v_row.actor_id THEN v_board.photo_status END,
      holder_id = v_row.actor_id,
      holder_name = left(COALESCE(v_row.payload->>'nickname', ''), 16),
      line1 = left(COALESCE(v_row.payload->>'line1', ''), 16),
      line2 = left(COALESCE(v_row.payload->>'line2', ''), 16),
      line3 = left(COALESCE(v_row.payload->>'line3', ''), 16),
      emoji = left(COALESCE(v_row.payload->>'emoji', '✨'), 4),
      bg_theme = COALESCE(v_row.payload->>'bg_theme', 'cyber_navy'),
      text_color = COALESCE(v_row.payload->>'text_color', '#ffffff'),
      external_url = CASE WHEN v_url ~ '^https://' THEN v_url ELSE NULL END,
      caption_y = v_cap,
      current_bid = v_bid,
      protected_until = now() + (v_protect_mins || ' minutes')::INTERVAL,
      expires_at = v_exp,
      lit_until = v_exp,
      lit_days = 1,
      lit_on = (timezone('Asia/Seoul', now()))::date,
      updated_at = now()
  WHERE slot_id = v_row.slot_id
  RETURNING * INTO v_board;

  UPDATE public.billboard_reviews SET status = 'approved' WHERE id = p_id;

  INSERT INTO public.billboard_history (slot_id, holder_id, holder_name, line1, line2, line3, bid, event)
  VALUES (
    v_row.slot_id, v_row.actor_id, left(COALESCE(v_row.payload->>'nickname', ''), 16),
    left(COALESCE(v_row.payload->>'line1', ''), 16), left(COALESCE(v_row.payload->>'line2', ''), 16), left(COALESCE(v_row.payload->>'line3', ''), 16),
    GREATEST(0, v_bid), v_event
  );

  SELECT coins INTO v_coins FROM public.wallets WHERE actor_id = v_row.actor_id;
  v_mono_after := public.monopoly_name();
  v_reclaim := v_board.current_bid + 50;
  v_rival := v_mono_after IS NOT NULL AND v_row.slot_id LIKE 'MAIN_%'
    AND NOT public.monopoly_member(v_prev_id, v_prev_l1, v_prev_l2, v_prev_l3);
  IF v_rival THEN
    v_reclaim := ceil(v_reclaim * 1.5)::bigint;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'billboard', row_to_json(v_board),
    'remaining_coins', v_coins,
    'actor_id', v_row.actor_id,
    'member', v_row.payload->>'member',
    'prev_holder_id', v_prev_id,
    'prev_holder_name', v_prev_name,
    'prev_line1', v_prev_l1,
    'prev_line2', v_prev_l2,
    'prev_line3', v_prev_l3,
    'prev_emoji', v_prev_emoji,
    'prev_theme', v_prev_theme,
    'prev_color', v_prev_color,
    'reclaim_bid', CASE WHEN v_prev_id IS NOT NULL AND v_prev_id IS DISTINCT FROM v_row.actor_id THEN v_reclaim ELSE NULL END,
    'monopoly_name', CASE WHEN v_mono_after IS NOT NULL AND v_mono_before IS NULL THEN v_mono_after ELSE NULL END,
    'refund', v_refund,
    'landlord', v_landlord,
    'landlord_id', CASE WHEN v_landlord > 0 THEN v_plot_owner ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.takedown_billboard(p_key TEXT, p_slot_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_board public.billboards%ROWTYPE;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;

  UPDATE public.billboards
  SET line1 = '운영자가 내렸습니다',
      line2 = '',
      line3 = '',
      external_url = NULL,
      updated_at = now()
  WHERE slot_id = p_slot_id
  RETURNING * INTO v_board;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot');
  END IF;

  INSERT INTO public.billboard_history (slot_id, holder_id, holder_name, line1, line2, line3, bid, event)
  VALUES (
    p_slot_id, v_board.holder_id, left(COALESCE(v_board.holder_name, ''), 16),
    '운영자가 내렸습니다', '', '', GREATEST(0, COALESCE(v_board.current_bid, 0)), 'takedown'
  );

  RETURN jsonb_build_object('ok', true, 'billboard', row_to_json(v_board));
END;
$$;

GRANT EXECUTE ON FUNCTION public.file_report(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_reports(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_billboard_reviews(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_slot_claim(TEXT, BIGINT, BOOLEAN) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.takedown_billboard(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_kst_day(TIMESTAMPTZ) TO anon, authenticated, service_role;

ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS ref_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS wallets_ref_code_idx ON public.wallets (ref_code) WHERE ref_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ensure_ref_code(p_key TEXT, p_actor_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_code TEXT;
  v_n INT := 0;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  SELECT ref_code INTO v_code FROM public.wallets WHERE actor_id = p_actor_id;
  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;
  LOOP
    v_n := v_n + 1;
    v_code := substr(md5(p_actor_id || clock_timestamp()::text || v_n::text), 1, 8);
    BEGIN
      UPDATE public.wallets SET ref_code = v_code WHERE actor_id = p_actor_id AND ref_code IS NULL;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_n > 8 THEN RAISE; END IF;
    END;
  END LOOP;
  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_ref_code(TEXT, TEXT) TO anon, authenticated, service_role;

-- Cosmetics locker. No public read. A 7-day streak fills only the rows that are still missing.
CREATE TABLE IF NOT EXISTS public.cosmetics (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('hat','cab','frame','emote','tag','ring')),
  season TEXT,
  grant_via TEXT NOT NULL CHECK (grant_via IN ('attend7','shop','season','tribe'))
);
CREATE TABLE IF NOT EXISTS public.inventory (
  actor_id TEXT NOT NULL REFERENCES public.wallets(actor_id) ON DELETE CASCADE,
  cosmetic_id TEXT NOT NULL REFERENCES public.cosmetics(id),
  equipped BOOLEAN NOT NULL DEFAULT false,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, cosmetic_id)
);
ALTER TABLE public.cosmetics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

INSERT INTO public.cosmetics (id, kind, grant_via) VALUES
  ('hat_ribbon', 'hat', 'attend7'),
  ('cab_yellow', 'cab', 'attend7'),
  ('frame_streak', 'frame', 'attend7')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.equip_cosmetic(p_key TEXT, p_actor_id TEXT, p_cosmetic_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_kind TEXT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  SELECT kind INTO v_kind FROM public.cosmetics WHERE id = p_cosmetic_id;
  IF v_kind IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.inventory WHERE actor_id = p_actor_id AND cosmetic_id = p_cosmetic_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing');
  END IF;
  UPDATE public.inventory AS inv
  SET equipped = false
  FROM public.cosmetics AS c
  WHERE inv.actor_id = p_actor_id
    AND inv.cosmetic_id = c.id
    AND c.kind = v_kind
    AND inv.cosmetic_id IS DISTINCT FROM p_cosmetic_id;
  UPDATE public.inventory
  SET equipped = true
  WHERE actor_id = p_actor_id AND cosmetic_id = p_cosmetic_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 꾸미기 상점 (migrations/2026-11-22-shop.sql adds all of this to production; the statements are the same). Coins only, never cash.
-- A table made before it checks kind against hat/cab/frame/emote and the ledger reason without 'shop': widened here, keeping every value
-- already there. Thirteen priced items (balance.js SHOP); the three attendance ones keep grant_via attend7 and are sold too. Re-run safe.
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
-- first one's item (owned). The price is the database's. The bought item is equipped in its kind. Not counted in wallets.spent or the league.
CREATE OR REPLACE FUNCTION public.buy_cosmetic(p_key TEXT, p_actor_id TEXT, p_cosmetic_id TEXT)
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
REVOKE ALL ON FUNCTION public.buy_cosmetic(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unequip_cosmetic(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_cosmetics(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_list(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.buy_cosmetic(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unequip_cosmetic(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.move_cosmetics(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

-- Level is read-time: least(99, 1 + reputation / 10). Reputation itself is the relight +1.
CREATE OR REPLACE FUNCTION public.profile_read(p_key TEXT, p_actor_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_rep INT;
  v_species SMALLINT;
  v_equip JSONB;
  v_owned JSONB;
  v_color TEXT;
  v_set BOOLEAN;
  v_streak INT;
  v_last DATE;
  v_starter TEXT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  INSERT INTO public.wallets (actor_id) VALUES (p_actor_id) ON CONFLICT (actor_id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE actor_id = p_actor_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'login');
  END IF;
  INSERT INTO public.profiles (actor_id) VALUES (p_actor_id) ON CONFLICT (actor_id) DO NOTHING;
  SELECT reputation, species, ring_color, ring_set, attend_streak, attend_last, starter_slot
  INTO v_rep, v_species, v_color, v_set, v_streak, v_last, v_starter
  FROM public.profiles WHERE actor_id = p_actor_id;
  SELECT COALESCE(jsonb_agg(s.cosmetic_id ORDER BY s.cosmetic_id), '[]'::jsonb)
  INTO v_equip
  FROM (
    SELECT cosmetic_id FROM public.inventory
    WHERE actor_id = p_actor_id AND equipped
    ORDER BY cosmetic_id
    LIMIT 6
  ) s;
  SELECT COALESCE(jsonb_agg(s.cosmetic_id ORDER BY s.cosmetic_id), '[]'::jsonb)
  INTO v_owned
  FROM (
    SELECT cosmetic_id FROM public.inventory
    WHERE actor_id = p_actor_id
    ORDER BY cosmetic_id
    LIMIT 16
  ) s;
  RETURN jsonb_build_object(
    'ok', true,
    'level', LEAST(99, 1 + COALESCE(v_rep, 0) / 10),
    'reputation', COALESCE(v_rep, 0),
    'species', COALESCE(v_species, 1),
    'equip', COALESCE(v_equip, '[]'::jsonb),
    'owned', COALESCE(v_owned, '[]'::jsonb),
    'color', CASE WHEN v_set THEN v_color ELSE NULL END,
    'starter', v_starter IS NOT NULL,
    'streak', COALESCE(v_streak, 0),
    'attend_last', v_last
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_species(p_key TEXT, p_actor_id TEXT, p_species INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_species SMALLINT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  v_species := CASE WHEN p_species BETWEEN 1 AND 10 THEN p_species ELSE 1 END;
  INSERT INTO public.wallets (actor_id) VALUES (p_actor_id) ON CONFLICT (actor_id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE actor_id = p_actor_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'login');
  END IF;
  INSERT INTO public.profiles (actor_id, species) VALUES (p_actor_id, v_species)
  ON CONFLICT (actor_id) DO UPDATE SET species = EXCLUDED.species;
  RETURN jsonb_build_object('ok', true, 'species', v_species);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_nickname(p_key TEXT, p_actor_id TEXT, p_nickname TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_name TEXT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  v_name := left(btrim(COALESCE(p_nickname, '')), 16);
  IF v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'name');
  END IF;
  INSERT INTO public.wallets (actor_id, nickname) VALUES (p_actor_id, v_name)
  ON CONFLICT (actor_id) DO UPDATE SET nickname = EXCLUDED.nickname, updated_at = now();
  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE actor_id = p_actor_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'login');
  END IF;
  UPDATE public.billboards SET holder_name = v_name WHERE holder_id = p_actor_id;
  UPDATE public.plots SET owner_name = v_name WHERE owner_id = p_actor_id;
  RETURN jsonb_build_object('ok', true, 'nickname', v_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_ring_color(p_key TEXT, p_actor_id TEXT, p_color TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_color TEXT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  v_color := lower(left(btrim(COALESCE(p_color, '')), 7));
  IF v_color !~ '^#[0-9a-f]{6}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'color');
  END IF;
  INSERT INTO public.wallets (actor_id) VALUES (p_actor_id) ON CONFLICT (actor_id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE actor_id = p_actor_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'login');
  END IF;
  INSERT INTO public.profiles (actor_id, ring_color, ring_set) VALUES (p_actor_id, v_color, true)
  ON CONFLICT (actor_id) DO UPDATE SET ring_color = EXCLUDED.ring_color, ring_set = true;
  RETURN jsonb_build_object('ok', true, 'color', v_color);
END;
$$;

-- Attendance ladder. Same profiles table as above; no DROP. Yesterday continues the streak, any other day starts at 1.
CREATE TABLE IF NOT EXISTS public.profiles (
  actor_id TEXT PRIMARY KEY REFERENCES public.wallets(actor_id) ON DELETE CASCADE,
  level INT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 99),
  reputation INT NOT NULL DEFAULT 0 CHECK (reputation >= 0),
  species SMALLINT NOT NULL DEFAULT 1 CHECK (species BETWEEN 1 AND 10),
  ring_color TEXT NOT NULL DEFAULT '#ff3d9a',
  starter_slot TEXT,
  attend_streak INT NOT NULL DEFAULT 0,
  attend_last DATE,
  tribe_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.touch_attend(p_key TEXT, p_actor_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_last DATE;
  v_streak INT;
  v_today DATE := (timezone('Asia/Seoul', now()))::date;
  v_amount INT;
  v_ladder INT[] := ARRAY[10, 12, 15, 20, 30];
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  INSERT INTO public.wallets (actor_id) VALUES (p_actor_id) ON CONFLICT (actor_id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE actor_id = p_actor_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'login');
  END IF;
  INSERT INTO public.profiles (actor_id) VALUES (p_actor_id) ON CONFLICT (actor_id) DO NOTHING;
  SELECT attend_last, attend_streak INTO v_last, v_streak FROM public.profiles WHERE actor_id = p_actor_id FOR UPDATE;
  IF v_last = v_today THEN
    RETURN jsonb_build_object('ok', false, 'error', 'attended');
  END IF;
  IF v_last = v_today - 1 THEN
    v_streak := COALESCE(v_streak, 0) + 1;
  ELSE
    v_streak := 1;
  END IF;
  v_amount := v_ladder[LEAST(v_streak, 5)];
  UPDATE public.profiles SET attend_streak = v_streak, attend_last = v_today WHERE actor_id = p_actor_id;
  IF v_streak % 7 = 0 THEN
    INSERT INTO public.inventory (actor_id, cosmetic_id) VALUES
      (p_actor_id, 'hat_ribbon'),
      (p_actor_id, 'cab_yellow'),
      (p_actor_id, 'frame_streak')
    ON CONFLICT (actor_id, cosmetic_id) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('ok', true, 'streak', v_streak, 'amount', v_amount, 'last', v_today);
END;
$$;

-- Away inbox and web push subscriptions. No public read. The worker calls SECURITY DEFINER RPCs with FLUSH_KEY.
CREATE TABLE IF NOT EXISTS public.inbox (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('taken','cheer','dark','gift','tribe','ball')),
  slot_id TEXT,
  phrase SMALLINT,
  from_name TEXT,
  from_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS inbox_actor_idx ON public.inbox (actor_id, created_at DESC);
ALTER TABLE public.inbox ADD COLUMN IF NOT EXISTS from_id TEXT;

CREATE TABLE IF NOT EXISTS public.push_subs (
  endpoint TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.inbox_batch(p_key TEXT, p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_item JSONB;
  v_actor TEXT;
  v_kind TEXT;
  v_phrase SMALLINT;
  v_count INT := 0;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'items');
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_actor := left(COALESCE(NULLIF(v_item->>'actor_id', ''), NULLIF(v_item->>'to', '')), 80);
    v_kind := v_item->>'kind';
    IF v_actor IS NULL OR v_actor = '' OR v_kind NOT IN ('taken','cheer','dark','gift','tribe','ball') THEN
      CONTINUE;
    END IF;
    v_phrase := NULL;
    IF COALESCE(v_item->>'phrase', '') ~ '^[0-9]+$' THEN
      v_phrase := LEAST(12, GREATEST(1, (v_item->>'phrase')::int));
    END IF;
    INSERT INTO public.inbox (actor_id, kind, slot_id, phrase, from_name, from_id)
    VALUES (
      v_actor,
      v_kind,
      NULLIF(left(COALESCE(v_item->>'slot_id', ''), 32), ''),
      v_phrase,
      NULLIF(left(COALESCE(v_item->>'from_name', ''), 12), ''),
      NULLIF(left(COALESCE(v_item->>'from', ''), 80), '')
    );
    DELETE FROM public.inbox
    WHERE actor_id = v_actor
      AND id NOT IN (
        SELECT id FROM public.inbox
        WHERE actor_id = v_actor
        ORDER BY created_at DESC, id DESC
        LIMIT 50
      );
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'n', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.inbox_list(p_key TEXT, p_actor_id TEXT)
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
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'kind', s.kind,
    'slot_id', s.slot_id,
    'phrase', s.phrase,
    'from_name', s.from_name,
    'from', s.from_id,
    'created_at', s.created_at,
    'read', (s.read_at IS NOT NULL)
  ) ORDER BY (s.read_at IS NULL) DESC, s.created_at DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT id, kind, slot_id, phrase, from_name, from_id, created_at, read_at
    FROM public.inbox
    WHERE actor_id = p_actor_id
    ORDER BY (read_at IS NULL) DESC, created_at DESC
    LIMIT 20
  ) s;
  RETURN jsonb_build_object('items', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.inbox_read(p_key TEXT, p_actor_id TEXT, p_ids JSONB)
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
  IF jsonb_typeof(p_ids) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ids');
  END IF;
  UPDATE public.inbox
  SET read_at = now()
  WHERE actor_id = p_actor_id
    AND read_at IS NULL
    AND id IN (
      SELECT value::bigint
      FROM jsonb_array_elements_text(p_ids) AS value
      WHERE value ~ '^[0-9]+$'
      LIMIT 50
    );
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.push_subscribe(p_key TEXT, p_actor_id TEXT, p_endpoint TEXT, p_p256dh TEXT, p_auth TEXT)
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
  IF p_endpoint IS NULL OR length(p_endpoint) > 600 OR p_endpoint = '' OR p_p256dh IS NULL OR p_auth IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'endpoint');
  END IF;
  INSERT INTO public.push_subs (endpoint, actor_id, p256dh, auth_key)
  VALUES (p_endpoint, p_actor_id, p_p256dh, p_auth)
  ON CONFLICT (endpoint) DO UPDATE
  SET actor_id = EXCLUDED.actor_id, p256dh = EXCLUDED.p256dh, auth_key = EXCLUDED.auth_key;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.push_unsubscribe(p_key TEXT, p_actor_id TEXT, p_endpoint TEXT)
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
  DELETE FROM public.push_subs WHERE endpoint = p_endpoint AND actor_id = p_actor_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.push_drop(p_key TEXT, p_endpoint TEXT)
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
  DELETE FROM public.push_subs WHERE endpoint = p_endpoint;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.push_due(p_key TEXT, p_limit INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_limit INT;
  v_items JSONB;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  v_limit := LEAST(40, GREATEST(1, COALESCE(p_limit, 40)));
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'endpoint', q.endpoint,
    'p256dh', q.p256dh,
    'auth_key', q.auth_key,
    'kind', q.kind,
    'slot_id', q.slot_id,
    'phrase', q.phrase,
    'from_name', q.from_name
  )), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT endpoint, p256dh, auth_key, kind, slot_id, phrase, from_name
    FROM (
      SELECT s.endpoint, s.p256dh, s.auth_key, i.kind, i.slot_id, i.phrase, i.from_name
      FROM public.inbox i
      JOIN public.push_subs s ON s.actor_id = i.actor_id
      WHERE i.read_at IS NULL AND i.kind IN ('taken', 'cheer')
      UNION ALL
      SELECT s.endpoint, s.p256dh, s.auth_key, 'dark', b.slot_id, NULL::smallint, NULL::text
      FROM public.push_subs s
      JOIN public.billboards b ON b.holder_id = s.actor_id
      WHERE COALESCE(b.lit_until, b.expires_at) > now()
        AND COALESCE(b.lit_until, b.expires_at) <= now() + interval '6 hours'
    ) u
    LIMIT v_limit
  ) q;
  RETURN jsonb_build_object('ok', true, 'items', v_items);
END;
$$;


-- One tap a day keeps a held board. This function does not pay, refund, or mint.
CREATE OR REPLACE FUNCTION public.relight_billboard(p_key TEXT, p_actor_id TEXT, p_slot_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_board public.billboards%ROWTYPE;
  v_today DATE := (timezone('Asia/Seoul', now()))::date;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  SELECT * INTO v_board FROM public.billboards WHERE slot_id = p_slot_id FOR UPDATE;
  IF NOT FOUND OR (
    v_board.holder_id IS DISTINCT FROM p_actor_id
    AND NOT (
      left(COALESCE(v_board.holder_id, ''), 6) = 'tribe:'
      AND EXISTS (
        SELECT 1 FROM public.tribe_members m
        WHERE m.actor_id = p_actor_id
          AND m.tribe_id = substr(v_board.holder_id, 7)
      )
    )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'holder');
  END IF;
  IF v_board.lit_on = v_today THEN
    RETURN jsonb_build_object('ok', true, 'lit_until', v_board.lit_until, 'lit_days', v_board.lit_days);
  END IF;
  UPDATE public.billboards
  SET lit_until = now() + interval '72 hours',
      expires_at = now() + interval '72 hours',
      lit_on = v_today,
      lit_days = lit_days + 1,
      updated_at = now()
  WHERE slot_id = p_slot_id
  RETURNING * INTO v_board;
  INSERT INTO public.profiles (actor_id)
  SELECT actor_id FROM public.wallets WHERE actor_id = p_actor_id
  ON CONFLICT (actor_id) DO NOTHING;
  UPDATE public.profiles SET reputation = reputation + 1 WHERE actor_id = p_actor_id;
  INSERT INTO public.billboard_history (slot_id, holder_id, holder_name, line1, line2, line3, bid, event)
  VALUES (p_slot_id, v_board.holder_id, v_board.holder_name, v_board.line1, v_board.line2, v_board.line3, v_board.current_bid, 'relight');
  RETURN jsonb_build_object('ok', true, 'lit_until', v_board.lit_until, 'lit_days', v_board.lit_days, 'scored', true);
END;
$$;

-- A held board whose light has run out becomes empty. No wallet write.
CREATE OR REPLACE FUNCTION public.clear_dark_boards(p_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_board public.billboards%ROWTYPE;
  v_n INT := 0;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  FOR v_board IN
    SELECT * FROM public.billboards
    WHERE holder_id IS NOT NULL
      AND COALESCE(lit_until, expires_at) < now()
    FOR UPDATE
  LOOP
    INSERT INTO public.billboard_history (slot_id, holder_id, holder_name, line1, line2, line3, bid, event)
    VALUES (v_board.slot_id, v_board.holder_id, v_board.holder_name, v_board.line1, v_board.line2, v_board.line3, v_board.current_bid, 'clear');
    UPDATE public.billboards
    SET holder_id = NULL,
        expires_at = LEAST(expires_at, now()),
        updated_at = now()
    WHERE slot_id = v_board.slot_id;
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'cleared', v_n);
END;
$$;

GRANT EXECUTE ON FUNCTION public.relight_billboard(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_dark_boards(TEXT) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.touch_attend(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.equip_cosmetic(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_read(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_species(TEXT, TEXT, INT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_nickname(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_ring_color(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inbox_batch(TEXT, JSONB) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inbox_list(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inbox_read(TEXT, TEXT, JSONB) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.push_subscribe(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.push_unsubscribe(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.push_drop(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.push_due(TEXT, INT) TO anon, authenticated, service_role;

-- Tribes. One membership per account. No public read. Pledge moves coins; it does not mint them.
CREATE TABLE IF NOT EXISTS public.tribes (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9]{8}$'),
  tag TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  roof_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.tribe_members (
  tribe_id TEXT NOT NULL REFERENCES public.tribes(id),
  actor_id TEXT NOT NULL REFERENCES public.wallets(actor_id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','owner')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id)
);
CREATE TABLE IF NOT EXISTS public.tribe_pool (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tribe_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  week TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tribe_pool ADD COLUMN IF NOT EXISTS spent BIGINT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS public.tribe_scores (
  tribe_id TEXT NOT NULL,
  week TEXT NOT NULL,
  points INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tribe_id, week)
);
CREATE INDEX IF NOT EXISTS tribe_pool_week_idx ON public.tribe_pool (tribe_id, week);
ALTER TABLE public.tribes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tribe_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tribe_pool ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tribe_scores ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.pledge_tribe(p_key TEXT, p_actor_id TEXT, p_slot_id TEXT, p_amount BIGINT, p_week TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_tribe TEXT;
  v_coins BIGINT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  IF p_amount NOT IN (10, 20, 50) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount');
  END IF;
  IF p_week !~ '^[0-9]{4}W[0-9]{2}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'week');
  END IF;
  SELECT tribe_id INTO v_tribe FROM public.tribe_members WHERE actor_id = p_actor_id;
  IF v_tribe IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tribe');
  END IF;
  SELECT coins INTO v_coins FROM public.wallets WHERE actor_id = p_actor_id FOR UPDATE;
  IF COALESCE(v_coins, 0) < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', '코인이 부족합니다. 붕어빵을 더 구워보세요!');
  END IF;
  INSERT INTO public.wallets (actor_id, nickname, coins) VALUES ('tribe:' || v_tribe, v_tribe, 0)
  ON CONFLICT (actor_id) DO NOTHING;
  UPDATE public.wallets SET coins = coins - p_amount, updated_at = now() WHERE actor_id = p_actor_id;
  UPDATE public.wallets SET coins = coins + p_amount, updated_at = now() WHERE actor_id = 'tribe:' || v_tribe;
  INSERT INTO public.coin_ledger (actor_id, delta, reason, ref) VALUES
    (p_actor_id, -p_amount, 'spend', p_slot_id),
    ('tribe:' || v_tribe, p_amount, 'spend', p_slot_id);
  INSERT INTO public.tribe_pool (tribe_id, slot_id, actor_id, amount, week)
  VALUES (v_tribe, p_slot_id, p_actor_id, p_amount, p_week);
  RETURN jsonb_build_object('ok', true, 'tribe_id', v_tribe, 'amount', p_amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_tribe_week(p_key TEXT, p_week TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_row RECORD;
  v_back BIGINT;
  v_coins BIGINT;
  v_n INT := 0;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  IF p_week !~ '^[0-9]{4}W[0-9]{2}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'week');
  END IF;
  FOR v_row IN
    SELECT id, tribe_id, actor_id, amount, spent
    FROM public.tribe_pool
    WHERE week = p_week AND amount > spent
    ORDER BY id
    FOR UPDATE
  LOOP
    v_back := v_row.amount - v_row.spent;
    SELECT coins INTO v_coins FROM public.wallets WHERE actor_id = 'tribe:' || v_row.tribe_id FOR UPDATE;
    IF COALESCE(v_coins, 0) < v_back THEN
      CONTINUE;
    END IF;
    UPDATE public.wallets SET coins = coins - v_back, updated_at = now() WHERE actor_id = 'tribe:' || v_row.tribe_id;
    UPDATE public.wallets SET coins = coins + v_back, updated_at = now() WHERE actor_id = v_row.actor_id;
    IF NOT FOUND THEN
      INSERT INTO public.wallets (actor_id, nickname, coins) VALUES (v_row.actor_id, '네온손님', v_back);
    END IF;
    INSERT INTO public.coin_ledger (actor_id, delta, reason, ref) VALUES
      ('tribe:' || v_row.tribe_id, -v_back, 'refund', v_row.tribe_id),
      (v_row.actor_id, v_back, 'refund', v_row.tribe_id);
    UPDATE public.tribe_pool SET spent = amount WHERE id = v_row.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'rows', v_n);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_tribe(p_key TEXT, p_actor_id TEXT, p_id TEXT, p_tag TEXT)
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
  IF p_id !~ '^[a-z0-9]{8}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'id');
  END IF;
  IF p_tag !~ '^[0-9A-Za-z가-힣_]{1,16}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tag');
  END IF;
  IF EXISTS (SELECT 1 FROM public.tribe_members WHERE actor_id = p_actor_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tribe');
  END IF;
  IF EXISTS (SELECT 1 FROM public.tribes WHERE id = p_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'id');
  END IF;
  IF EXISTS (SELECT 1 FROM public.tribes WHERE tag = p_tag) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tag');
  END IF;
  INSERT INTO public.wallets (actor_id) VALUES (p_actor_id) ON CONFLICT (actor_id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE actor_id = p_actor_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'login');
  END IF;
  INSERT INTO public.tribes (id, tag, name, created_by) VALUES (p_id, p_tag, p_tag, p_actor_id);
  INSERT INTO public.tribe_members (tribe_id, actor_id, role) VALUES (p_id, p_actor_id, 'owner');
  INSERT INTO public.profiles (actor_id, tribe_id) VALUES (p_actor_id, p_id)
  ON CONFLICT (actor_id) DO UPDATE SET tribe_id = EXCLUDED.tribe_id;
  RETURN jsonb_build_object('ok', true, 'tribe_id', p_id, 'tag', p_tag);
END;
$$;

CREATE OR REPLACE FUNCTION public.join_tribe(p_key TEXT, p_actor_id TEXT, p_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_tag TEXT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  IF p_id !~ '^[a-z0-9]{8}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'id');
  END IF;
  IF EXISTS (SELECT 1 FROM public.tribe_members WHERE actor_id = p_actor_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tribe');
  END IF;
  SELECT tag INTO v_tag FROM public.tribes WHERE id = p_id;
  IF v_tag IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'id');
  END IF;
  INSERT INTO public.wallets (actor_id) VALUES (p_actor_id) ON CONFLICT (actor_id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE actor_id = p_actor_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'login');
  END IF;
  INSERT INTO public.tribe_members (tribe_id, actor_id, role) VALUES (p_id, p_actor_id, 'member');
  INSERT INTO public.profiles (actor_id, tribe_id) VALUES (p_actor_id, p_id)
  ON CONFLICT (actor_id) DO UPDATE SET tribe_id = EXCLUDED.tribe_id;
  RETURN jsonb_build_object('ok', true, 'tribe_id', p_id, 'tag', v_tag);
END;
$$;

CREATE OR REPLACE FUNCTION public.add_tribe_score(p_key TEXT, p_actor_id TEXT, p_week TEXT, p_points INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_tribe TEXT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  IF p_week !~ '^[0-9]{4}W[0-9]{2}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'week');
  END IF;
  IF p_points IS NULL OR p_points < 1 OR p_points > 7 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'points');
  END IF;
  SELECT tribe_id INTO v_tribe FROM public.tribe_members WHERE actor_id = p_actor_id;
  IF v_tribe IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tribe');
  END IF;
  INSERT INTO public.tribe_scores (tribe_id, week, points)
  VALUES (v_tribe, p_week, p_points)
  ON CONFLICT (tribe_id, week) DO UPDATE
  SET points = public.tribe_scores.points + EXCLUDED.points;
  RETURN jsonb_build_object('ok', true, 'tribe_id', v_tribe, 'points', p_points);
END;
$$;

CREATE OR REPLACE FUNCTION public.my_tribe(p_key TEXT, p_actor_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_id TEXT;
  v_tag TEXT;
  v_role TEXT;
  v_coins BIGINT;
  v_points INT;
  v_members JSONB;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  SELECT t.id, t.tag, m.role INTO v_id, v_tag, v_role
  FROM public.tribe_members m
  JOIN public.tribes t ON t.id = m.tribe_id
  WHERE m.actor_id = p_actor_id;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'tribe_id', NULL);
  END IF;
  SELECT COALESCE(w.coins, 0) INTO v_coins FROM public.wallets w WHERE w.actor_id = 'tribe:' || v_id;
  SELECT COALESCE(points, 0) INTO v_points
  FROM public.tribe_scores
  WHERE tribe_id = v_id
    AND week = to_char(timezone('Asia/Seoul', now()), 'IYYY') || 'W' || to_char(timezone('Asia/Seoul', now()), 'IW');
  SELECT COALESCE(jsonb_agg(s.obj ORDER BY s.owner_first DESC, s.joined_at), '[]'::jsonb) INTO v_members
  FROM (
    SELECT jsonb_build_object(
      'name', left(COALESCE(NULLIF(w.nickname, ''), '익명'), 16),
      'role', tm.role,
      'me', tm.actor_id = p_actor_id
    ) AS obj,
    (tm.role = 'owner') AS owner_first,
    tm.joined_at
    FROM public.tribe_members tm
    LEFT JOIN public.wallets w ON w.actor_id = tm.actor_id
    WHERE tm.tribe_id = v_id
    ORDER BY (tm.role = 'owner') DESC, tm.joined_at
    LIMIT 40
  ) s;
  RETURN jsonb_build_object(
    'ok', true,
    'tribe_id', v_id,
    'tag', v_tag,
    'role', v_role,
    'coins', COALESCE(v_coins, 0),
    'points', COALESCE(v_points, 0),
    'members', v_members
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.my_tribe(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pledge_tribe(TEXT, TEXT, TEXT, BIGINT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refund_tribe_week(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_tribe(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.join_tribe(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_tribe_score(TEXT, TEXT, TEXT, INT) TO anon, authenticated, service_role;

-- Seasons and the ops calendar. One confirmed season row. Ops copy is written by the admin route, not seeded.
CREATE TABLE IF NOT EXISTS public.seasons (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  theme TEXT NOT NULL CHECK (theme IN ('csat','xmas','newyear','seollal','valentine'))
);
CREATE TABLE IF NOT EXISTS public.ops_events (
  id TEXT PRIMARY KEY,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  theme TEXT NOT NULL CHECK (theme IN ('csat','xmas','newyear','seollal','valentine')),
  title TEXT NOT NULL,
  copy TEXT NOT NULL
);
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_events ENABLE ROW LEVEL SECURITY;
INSERT INTO public.seasons (id, title, starts_on, ends_on, theme)
VALUES ('s1-2027', '새해 소원', '2027-01-01', '2027-01-28', 'newyear')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.plaza_live(p_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_day DATE := (timezone('Asia/Seoul', now()))::date;
  v_ops JSONB;
  v_roof TEXT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  SELECT jsonb_build_object('id', id, 'theme', theme, 'title', title, 'copy', copy)
  INTO v_ops
  FROM public.ops_events
  WHERE starts_on <= v_day AND ends_on >= v_day
  ORDER BY starts_on DESC, id ASC
  LIMIT 1;
  SELECT tag INTO v_roof
  FROM public.tribes
  WHERE roof_until > now()
  ORDER BY roof_until DESC, id ASC
  LIMIT 1;
  RETURN jsonb_build_object('ops', v_ops, 'roof', COALESCE(v_roof, ''));
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_ops_event(
  p_key TEXT, p_id TEXT, p_starts DATE, p_ends DATE, p_theme TEXT, p_title TEXT, p_copy TEXT
)
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
  IF p_id IS NULL OR p_id = '' OR char_length(p_id) > 40 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'id');
  END IF;
  IF p_theme NOT IN ('csat', 'xmas', 'newyear', 'seollal', 'valentine') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'theme');
  END IF;
  IF p_starts IS NULL OR p_ends IS NULL OR p_ends < p_starts THEN
    RETURN jsonb_build_object('ok', false, 'error', 'date');
  END IF;
  IF p_title IS NULL OR char_length(p_title) < 1 OR char_length(p_title) > 80 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'title');
  END IF;
  IF p_copy IS NULL OR char_length(p_copy) < 1 OR char_length(p_copy) > 80 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'copy');
  END IF;
  INSERT INTO public.ops_events (id, starts_on, ends_on, theme, title, copy)
  VALUES (p_id, p_starts, p_ends, p_theme, p_title, p_copy)
  ON CONFLICT (id) DO UPDATE SET
    starts_on = EXCLUDED.starts_on,
    ends_on = EXCLUDED.ends_on,
    theme = EXCLUDED.theme,
    title = EXCLUDED.title,
    copy = EXCLUDED.copy;
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$$;

-- One roof award per finished KST ISO week, on any day after it ends. A NULL tribe_id records a week nobody won. Server only.
CREATE TABLE IF NOT EXISTS public.tribe_roofs (
  week TEXT PRIMARY KEY,
  tribe_id TEXT,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tribe_roofs ENABLE ROW LEVEL SECURITY;

-- The finished week's top tribe keeps the roof for seven days from the award. Scores stay.
CREATE OR REPLACE FUNCTION public.award_tribe_roof(p_key TEXT, p_week TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_id TEXT;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  IF p_week !~ '^[0-9]{4}W(0[1-9]|[1-4][0-9]|5[0-3])$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'week');
  END IF;
  IF p_week >= to_char(timezone('Asia/Seoul', now()), 'IYYY"W"IW') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'open');
  END IF;
  IF EXISTS (SELECT 1 FROM public.tribe_roofs WHERE week = p_week) THEN
    RETURN jsonb_build_object('ok', true, 'done', true);
  END IF;
  SELECT tribe_id INTO v_id
  FROM public.tribe_scores
  WHERE week = p_week AND points > 0
  ORDER BY points DESC, tribe_id ASC
  LIMIT 1;
  INSERT INTO public.tribe_roofs (week, tribe_id) VALUES (p_week, v_id) ON CONFLICT (week) DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'done', true);
  END IF;
  -- A late award for an older week is recorded but does not take the roof from a newer week's winner.
  IF EXISTS (SELECT 1 FROM public.tribe_roofs WHERE week > p_week) THEN
    RETURN jsonb_build_object('ok', true, 'done', true);
  END IF;
  UPDATE public.tribes SET roof_until = NULL WHERE roof_until IS NOT NULL;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'roof', '');
  END IF;
  UPDATE public.tribes SET roof_until = now() + interval '7 days' WHERE id = v_id;
  RETURN jsonb_build_object('ok', true, 'tribe_id', v_id);
END;
$$;

-- 20:50 KST preview. One unread ball row per subscribed account, then the usual 50-row cap.
CREATE OR REPLACE FUNCTION public.inbox_ball(p_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_n INT := 0;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  INSERT INTO public.inbox (actor_id, kind)
  SELECT DISTINCT s.actor_id, 'ball'
  FROM public.push_subs s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.inbox i
    WHERE i.actor_id = s.actor_id
      AND i.kind = 'ball'
      AND (i.created_at AT TIME ZONE 'Asia/Seoul')::date = (timezone('Asia/Seoul', now()))::date
  );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM public.inbox i
  USING (
    SELECT id FROM (
      SELECT id, row_number() OVER (PARTITION BY actor_id ORDER BY created_at DESC, id DESC) AS n
      FROM public.inbox
      WHERE actor_id IN (SELECT DISTINCT actor_id FROM public.push_subs)
    ) ranked
    WHERE ranked.n > 50
  ) old
  WHERE i.id = old.id;
  RETURN jsonb_build_object('ok', true, 'n', v_n);
END;
$$;

CREATE OR REPLACE FUNCTION public.push_ball(p_key TEXT, p_limit INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_limit INT;
  v_items JSONB;
BEGIN
  SELECT key_value INTO v_secret FROM public.app_secrets WHERE key_name = 'FLUSH_KEY';
  IF v_secret IS NULL OR p_key IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'Unauthorized worker key';
  END IF;
  v_limit := LEAST(40, GREATEST(1, COALESCE(p_limit, 40)));
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'endpoint', q.endpoint,
    'p256dh', q.p256dh,
    'auth_key', q.auth_key,
    'kind', 'ball',
    'slot_id', NULL,
    'phrase', NULL,
    'from_name', NULL
  )), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT s.endpoint, s.p256dh, s.auth_key
    FROM public.push_subs s
    JOIN public.inbox i ON i.actor_id = s.actor_id
    WHERE i.kind = 'ball'
      AND i.read_at IS NULL
      AND i.created_at > now() - interval '2 hours'
    LIMIT v_limit
  ) q;
  RETURN jsonb_build_object('ok', true, 'items', v_items);
END;
$$;

GRANT EXECUTE ON FUNCTION public.plaza_live(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_ops_event(TEXT, TEXT, DATE, DATE, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.award_tribe_roof(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inbox_ball(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.push_ball(TEXT, INT) TO anon, authenticated, service_role;