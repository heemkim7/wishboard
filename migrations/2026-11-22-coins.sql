-- 2026-11-22 코인 가드를 DB로 옮기기 (한 번에 붙여 실행하는 파일)
--
-- Supabase SQL 편집기에 이 파일 전체를 붙여 한 번 실행한다. 역할은 바꾸지 않고 기본(postgres) 그대로 둔다.
-- 몇 번을 실행해도 결과는 같다. 마지막 SELECT 한 줄이 적용됐는지(applied)와 이유(note)를 보여 준다. 편집기는 이 표만 보인다.
--
-- 왜:
--   1. 계정 연결(merge_guest_account)은 게스트 코인을 모두 옮기고, Worker가 그 뒤에 시작 코인을 따로 30씩 빼 왔다.
--      옮긴 직후 빼기 전에 입찰·분양·스티커·60초 장악·모금으로 써 버리면 그만큼은 빼지 못했다.
--   2. 탈퇴 표시는 Worker의 Durable Object에만 있었고 GUEST_KEY로 해시했다. 키를 바꾸면 표시가 읽히지 않고,
--      일일 예산이 hard일 때는 적지도 읽지도 않았다.
--   3. 탈퇴로 로그인 정보가 지워져도 그 토큰은 길게는 1시간 통한다. 그동안 프로필을 읽으면 100코인 지갑이 새로 생겼다.
--   4. 게스트마다 도착하자마자 받는 40코인(hello)은 시작 100코인처럼 번 코인이 아닌데, 연결할 때 같이 옮겨져
--      게스트를 여러 개 만들어 한 계정에 모으면 그만큼 쌓였다.
--   5. 계정(user:) 지갑도 연결 전에 프로필 읽기 등으로 먼저 만들어지면 시작 100코인을 따로 받았다. 그 위에 첫 연결이 게스트의
--      140과 보상 300을 더했다. 또 첫 연결은 게스트가 아직 빈 지갑이어도 그 게스트의 도착 코인 140을 다 옮긴 것으로 적어서,
--      그 게스트가 나중에 받은 140을 다른 계정이 통째로 가져갈 수 있었다.
--
-- 무엇을 (1부, 한 덩어리. 하나라도 실패하면 1부 전체가 되돌아가고 이유가 마지막 표에 나온다):
--   - 표 public.gone_logins(탈퇴 표시: 계정 id와 로그인 이메일의 소금 친 해시. 원래 값은 적지 않는다),
--     public.starter_taken(게스트마다 연결로 이미 옮긴 도착 코인 0~140). 둘 다 RLS를 켜고 정책은 두지 않는다(밖에서 못 읽는다).
--   - app_secrets에 GONE_SALT(처음 한 번 무작위로 만든다. 이미 있으면 그대로). Worker 키와 상관이 없어서 GUEST_KEY를 바꿔도
--     탈퇴 표시는 그대로 읽힌다. 이 값은 바꾸지 않는다(바꾸면 지금까지의 표시가 읽히지 않는다).
--   - 함수 public.gone_hash, 트리거 함수 public.wallets_gone_mark(user: 지갑 줄이 지워질 때 표시를 남긴다),
--     public.wallets_need_login(로그인 정보가 없는 user: id에는 지갑 줄을 만들지 않는다. 그리고 계정 연결 밖에서 새로 만드는
--     user: 지갑 줄은 시작 100코인 없이 0에서 시작한다. 계정의 시작 코인은 첫 게스트에게서 온다. 익명 로그인은 연결을 못 하니 100 그대로).
--     줄이 이미 있으면 건드리지 않는다. 탈퇴로 지워진 user: 줄에 환불이 새 줄을 만들 때도 그 환불에서 100까지 빠진다(드문 경우).
--   - merge_guest_account를 통째로 바꾼다. 옮기기와 도로 빼기가 한 번에 된다. 첫 연결은 전처럼 다 옮기고 +300.
--     그 뒤의 연결은 그 게스트의 도착 코인 140(시작 100 + hello 40) 가운데 아직 안 옮긴 만큼을 빼고 옮긴다.
--     첫 연결도 그 게스트의 도착 코인은 실제로 옮긴 만큼만(최대 140) 옮긴 것으로 적는다.
--     탈퇴했던 계정(id나 이메일 표시가 있음)은 +300을 다시 받지 않는다. 응답에 guard: 2와 again이 붙고 moved는 없다.
--   - sell_coins_to_advertiser에서 한 줄만 바꾼다: 'IF v_seller.coins < p_amount THEN' → 'IF NOT FOUND OR v_seller.coins < p_amount THEN'.
--     지갑 줄이 없을 때(위 트리거가 줄을 만들지 않은 경우) 받는 사람에게 코인이 생기지 않게 한다. 그 줄이 정확히 한 번 있을 때만 바꾼다.
--   - 가는 길에 지갑 줄을 만드는 함수 일곱 개(profile_read, save_species, set_nickname, set_ring_color, touch_attend, create_tribe,
--     join_tribe)에 각각 한 덩어리를 더한다: 지갑 줄을 만드는 줄 바로 뒤에서 줄이 없으면(위 트리거가 만들지 않은 경우)
--     {ok: false, error: 'login'}으로 끝낸다. 전에는 profiles의 외래 키 오류로 실패했다. 그 줄이 정확히 한 번 있을 때만 바꾼다.
--   다른 함수와 표는 건드리지 않는다. withdraw_account와 forget_login도 그대로다.
--
-- 2부 (주석, 따로 실행): 메일 확인을 켜 두었을 때 가입하고 확인하지 않은 옛 계정을 확인 처리한다. 지금은 메일 확인이 꺼져 있어서
--   새 가입은 바로 확인된 것으로 들어간다. 그 전에 가입한 몇 계정은 로그인하지 못할 수 있다. 몇 개인지는 1부를 실행하면
--   마지막 표의 note에 나온다. 실행할지는 주인이 정한다. 파일 끝의 2부 주석을 읽고, 줄 앞의 '-- '를 지워 그 부분만 실행한다.
--
-- 순서: 코드 배포 앞이든 뒤든 괜찮다.
--   - 이 파일 전(지금): Worker가 예전처럼 연결 뒤에 시작 코인을 따로 빼고(이제 140까지), 탈퇴 표시는 Durable Object에 둔다.
--     일일 예산 hard에서는 계정 연결을 "잠시 뒤에 다시" 답으로 미룬다.
--   - 이 파일 뒤: Worker는 응답의 guard: 2를 보고 따로 빼지 않는다. hard에서도 연결이 된다(DB가 혼자 지킨다).
--   - 예전 코드로 되돌려도(rollback) 둘이 겹쳐 두 번 빼지 않는다. 새 함수는 moved를 주지 않고, 예전 Worker는 moved가 없으면 빼지 않는다.
--   - 이 파일 전에 Durable Object에만 남은 탈퇴 표시는 Worker가 계속 읽는다(첫 연결 때 한 번). 그 표시는 GUEST_KEY로 만든 것이라
--     GUEST_KEY를 바꾸면 그 옛 표시만 읽히지 않는다. 이 파일 뒤의 탈퇴는 DB에 남으므로 상관없다.
--   - 이 파일 전에 연결한 게스트에게 나중에 들어온 코인(늦은 정산)은 DB에 기록이 없어 다음 연결에서 처음 140까지 빠질 수 있다.
--   - 이미 있는 지갑 줄은 그대로다(벌써 100으로 만들어진 user: 줄도). Worker의 보내기·모금 하한은 두 상태 모두 580이다.
--
-- 함수의 주인: auth.users를 읽을 수 있는 역할(postgres)이어야 한다. 1부는 시작할 때 이것을 확인하고, 읽지 못하면 아무것도 바꾸지 않는다
--   (트리거가 모든 계정의 지갑 줄을 막는 일이 없게).
--
-- 편집기가 "destructive operation" 경고를 띄울 수 있다. DROP TRIGGER IF EXISTS(다시 만들기 전에)와 함수 본문 때문이다.
-- 이 파일은 표나 데이터를 지우지 않는다. "creates a table without enabling Row Level Security (kts_coins)"도 나올 수 있다.
-- kts_coins는 이 실행 동안만 쓰는 임시 표다. "Run without RLS"를 누른다.

-- 멈춘 이유와 2부 대상 수를 마지막 표에 보이려고 이 실행 동안만 쓰는 임시 표.
CREATE TEMP TABLE IF NOT EXISTS kts_coins (k TEXT PRIMARY KEY, v TEXT);

-- ============================================================================
-- 1부. 코인 가드
-- ============================================================================
BEGIN;
DO $p1$
DECLARE
  old_s CONSTANT TEXT := 'IF v_seller.coins < p_amount THEN';
  new_s CONSTANT TEXT := 'IF NOT FOUND OR v_seller.coins < p_amount THEN';
  -- The wallet-making line of the seven functions (set_nickname has its own), and what goes right after it.
  w_line CONSTANT TEXT := 'INSERT INTO public.wallets (actor_id) VALUES (p_actor_id) ON CONFLICT (actor_id) DO NOTHING;';
  w_nick CONSTANT TEXT := 'ON CONFLICT (actor_id) DO UPDATE SET nickname = EXCLUDED.nickname, updated_at = now();';
  w_guard CONSTANT TEXT := E'\n  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE actor_id = p_actor_id) THEN\n    RETURN jsonb_build_object(''ok'', false, ''error'', ''login'');\n  END IF;';
  d TEXT; n INT; blocked BOOLEAN; f TEXT; ln TEXT;
BEGIN
  BEGIN
    -- The trigger functions read auth.users as their owner (whoever runs this file). If that role cannot see its rows, the login check
    -- would refuse every account's wallet: stop before anything changes.
    IF to_regclass('auth.users') IS NOT NULL THEN
      SELECT c.relrowsecurity AND NOT (r.rolsuper OR r.rolbypassrls OR c.relowner = r.oid) INTO blocked
      FROM pg_class c, pg_roles r WHERE c.oid = 'auth.users'::regclass AND r.rolname = current_user;
      IF COALESCE(blocked, true) THEN
        RAISE EXCEPTION '중단: 지금 역할(%)은 auth.users의 줄을 볼 수 없습니다. postgres 역할로 다시 실행하세요. 1부는 바뀌지 않았습니다.', current_user;
      END IF;
      PERFORM 1 FROM auth.users LIMIT 1; -- no SELECT right: the error stops here
    END IF;

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

    EXECUTE $f$
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
$f$;
    REVOKE ALL ON FUNCTION public.gone_hash(TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;

    EXECUTE $f$
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
$f$;
    DROP TRIGGER IF EXISTS wallets_gone_mark ON public.wallets;
    CREATE TRIGGER wallets_gone_mark AFTER DELETE ON public.wallets FOR EACH ROW EXECUTE FUNCTION public.wallets_gone_mark();

    -- sell_coins_to_advertiser: refuse when there is no seller row (the next trigger can leave one out), before the receiver is paid.
    d := pg_get_functiondef('public.sell_coins_to_advertiser(text,text,text,text,integer)'::regprocedure);
    IF position(new_s IN d) = 0 THEN
      n := (length(d) - length(replace(d, old_s, ''))) / length(old_s);
      IF n <> 1 THEN
        RAISE EXCEPTION '중단: 운영 DB의 sell_coins_to_advertiser에서 바꿀 줄을 %번 찾았습니다(1번이어야 함). 1부는 바뀌지 않았습니다.', n;
      END IF;
      EXECUTE replace(d, old_s, new_s);
    END IF;

    -- The seven functions that make the actor's wallet row on their way: with the next trigger that row can be left out, and then they
    -- failed on the profiles (or tribe_members) foreign key. Right after the wallet line they now end with {ok: false, error: 'login'}.
    FOREACH f IN ARRAY ARRAY['profile_read(text,text)', 'save_species(text,text,integer)', 'set_nickname(text,text,text)', 'set_ring_color(text,text,text)',
                             'touch_attend(text,text)', 'create_tribe(text,text,text,text)', 'join_tribe(text,text,text)'] LOOP
      d := pg_get_functiondef(('public.' || f)::regprocedure);
      IF position(w_guard IN d) = 0 THEN
        ln := CASE WHEN f LIKE 'set_nickname(%' THEN w_nick ELSE w_line END;
        n := (length(d) - length(replace(d, ln, ''))) / length(ln);
        IF n <> 1 THEN
          RAISE EXCEPTION '중단: 운영 DB의 %에서 지갑을 만드는 줄을 %번 찾았습니다(1번이어야 함). 1부는 바뀌지 않았습니다.', split_part(f, '(', 1), n;
        END IF;
        EXECUTE replace(d, ln, ln || w_guard);
      END IF;
    END LOOP;

    EXECUTE $f$
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
$f$;
    DROP TRIGGER IF EXISTS wallets_need_login ON public.wallets;
    CREATE TRIGGER wallets_need_login BEFORE INSERT ON public.wallets FOR EACH ROW EXECUTE FUNCTION public.wallets_need_login();

    EXECUTE $f$
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
$f$;
    DELETE FROM kts_coins WHERE k = 'p1';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '1부 %', SQLERRM;
    INSERT INTO kts_coins VALUES ('p1', SQLERRM) ON CONFLICT (k) DO UPDATE SET v = excluded.v;
  END;
END
$p1$;
COMMIT;

-- PostgREST가 바뀐 함수를 바로 보게 한다.
NOTIFY pgrst, 'reload schema';

-- 시험 호출(아무것도 바꾸지 않는다): 있을 수 없는 계정으로 merge_guest_account를 한 번 부른다. 새 함수면 guard 2로 거절한다.
-- 그리고 2부 대상(메일 확인이 안 끝난 옛 이메일·아이디 가입)을 센다. 키는 app_secrets에서 읽으므로 붙여 넣지 않는다.
DO $try$
DECLARE
  r JSONB;
  c BIGINT;
BEGIN
  DELETE FROM kts_coins WHERE k IN ('try', 'unconfirmed');
  BEGIN
    r := public.merge_guest_account((SELECT key_value FROM public.app_secrets WHERE key_name = 'FLUSH_KEY'), 'probe', 'probe', '');
    INSERT INTO kts_coins VALUES ('try', CASE WHEN r->>'ok' = 'false' AND r->>'guard' = '2' THEN 'ok' ELSE r::text END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO kts_coins VALUES ('try', SQLERRM);
  END;
  BEGIN
    EXECUTE $q$SELECT count(*) FROM auth.users
      WHERE email_confirmed_at IS NULL AND COALESCE(raw_app_meta_data->>'provider', 'email') = 'email'
        AND NOT COALESCE(is_anonymous, false) AND deleted_at IS NULL$q$ INTO c;
    INSERT INTO kts_coins VALUES ('unconfirmed', c::text);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO kts_coins VALUES ('unconfirmed', '?');
  END;
END
$try$;

-- ============================================================================
-- 결과: 한 줄. applied가 true면 1부가 다 들어가 있다. note 끝에 2부 대상 수가 나온다.
-- ============================================================================
SELECT
  (m.ok AND s.ok AND g.oid IS NOT NULL AND t.n = 2 AND COALESCE(y.v, '') = 'ok' AND salt.ok AND tb.n = 2 AND w.ok AND pf.n = 7) AS applied,
  CASE
    WHEN p1.v IS NOT NULL THEN '안 바뀜: ' || p1.v
    WHEN NOT m.ok THEN '안 바뀜: merge_guest_account가 새 모양이 아닙니다. 이 파일 전체를 다시 실행하세요'
    WHEN NOT s.ok THEN '안 바뀜: sell_coins_to_advertiser에 지갑 없음 검사가 없습니다'
    WHEN NOT w.ok THEN '안 바뀜: wallets_need_login이 새 모양이 아닙니다. 이 파일 전체를 다시 실행하세요'
    WHEN pf.n <> 7 THEN '덜 들어감: 지갑을 만드는 함수 일곱 개 가운데 ' || (7 - pf.n) || '개에 지갑 없음 검사가 없습니다. 이 파일 전체를 다시 실행하세요'
    WHEN g.oid IS NULL OR t.n <> 2 OR tb.n <> 2 OR NOT salt.ok THEN '덜 들어감: 표, 트리거, gone_hash, GONE_SALT 가운데 빠진 것이 있습니다. 이 파일 전체를 다시 실행하세요'
    WHEN COALESCE(y.v, '') <> 'ok' THEN '함수는 있지만 시험 호출이 예상과 다릅니다: ' || COALESCE(y.v, '부르지 않음')
    ELSE '적용됨. 연결과 도로 빼기가 한 번에 되고, 탈퇴 표시는 DB에, 로그인 없는 계정에는 지갑이 생기지 않고, 연결 밖에서 생기는 계정 지갑은 0에서 시작합니다'
  END || ' · 메일 확인이 안 끝난 옛 가입 ' || COALESCE(u.v, '?') || '개(2부 참고, 따로 실행)' AS note
FROM (SELECT position('''guard'', 2' IN d) > 0 AND position('LEAST(140, v_moved)' IN d) > 0 AS ok FROM (SELECT pg_get_functiondef('public.merge_guest_account(text,text,text,text)'::regprocedure) AS d) x) m
CROSS JOIN (SELECT position('IF NOT FOUND OR v_seller.coins < p_amount THEN' IN pg_get_functiondef('public.sell_coins_to_advertiser(text,text,text,text,integer)'::regprocedure)) > 0 AS ok) s
CROSS JOIN (SELECT to_regprocedure('public.gone_hash(text,text)') AS oid) g
CROSS JOIN (SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'public.wallets'::regclass AND tgname IN ('wallets_gone_mark', 'wallets_need_login') AND NOT tgisinternal) t
CROSS JOIN (SELECT count(*)::int AS n FROM pg_class WHERE oid IN (to_regclass('public.gone_logins'), to_regclass('public.starter_taken')) AND relrowsecurity) tb
CROSS JOIN (SELECT EXISTS (SELECT 1 FROM public.app_secrets WHERE key_name = 'GONE_SALT' AND length(key_value) >= 32) AS ok) salt
CROSS JOIN (SELECT COALESCE(position('NEW.coins := GREATEST(0, NEW.coins - 100);' IN pg_get_functiondef(to_regprocedure('public.wallets_need_login()'))) > 0, false) AS ok) w
CROSS JOIN (SELECT count(DISTINCT proname)::int AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('profile_read', 'save_species', 'set_nickname', 'set_ring_color', 'touch_attend', 'create_tribe', 'join_tribe')
  AND position('IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE actor_id = p_actor_id) THEN' IN prosrc) > 0) pf
LEFT JOIN kts_coins p1 ON p1.k = 'p1'
LEFT JOIN kts_coins y ON y.k = 'try'
LEFT JOIN kts_coins u ON u.k = 'unconfirmed';

-- ============================================================================
-- 2부. 메일 확인이 안 끝난 옛 가입을 확인 처리 (주석. 주인이 정하면 따로 실행)
-- ============================================================================
-- 대상: auth.users에서 email_confirmed_at이 비어 있고, 이메일·아이디(…@id.wishboard.dev)로 가입했고(provider 'email'),
--   익명 로그인이 아니고, 지워지지 않은 줄. 구글 로그인 줄은 대상이 아니다.
-- 하는 일: 그 줄의 email_confirmed_at을 지금 시각으로 채운다. 다른 열(confirmed_at은 Supabase가 스스로 계산한다)과 다른 줄은 건드리지 않는다.
--   지금 메일 확인이 꺼져 있어서 새 가입은 이미 이렇게 들어간다. 옛 가입도 같은 상태로 맞추는 것이다.
--   이메일로 가입한 줄은 그 주소의 주인인지 확인하지 않은 채 확인된 것으로 바뀐다. 그것이 싫으면 아래 WHERE에
--   "AND email LIKE '%@id.wishboard.dev'"를 더해 아이디 가입만 고른다.
-- 몇 번을 실행해도 같다(이미 채운 줄은 다시 고르지 않는다). 되돌리려면 이 실행에서 고른 id 목록이 필요하니, 먼저 읽기만 하는 조회로 본다:
--
--   SELECT id, email, created_at, last_sign_in_at FROM auth.users
--   WHERE email_confirmed_at IS NULL AND COALESCE(raw_app_meta_data->>'provider', 'email') = 'email'
--     AND NOT COALESCE(is_anonymous, false) AND deleted_at IS NULL
--   ORDER BY created_at;
--
-- 실행하려면 아래 다섯 줄 앞의 '-- '를 지우고 그 다섯 줄만 골라 실행한다. 마지막 줄이 바꾼 줄 수를 보여 준다.
-- WITH done AS (
--   UPDATE auth.users SET email_confirmed_at = now()
--   WHERE email_confirmed_at IS NULL AND COALESCE(raw_app_meta_data->>'provider', 'email') = 'email'
--     AND NOT COALESCE(is_anonymous, false) AND deleted_at IS NULL RETURNING id)
-- SELECT count(*) AS confirmed FROM done;
