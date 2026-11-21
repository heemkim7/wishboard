-- 2026-11-22 탈퇴 때 로그인 정보까지 지우기 (한 번에 붙여 실행하는 파일)
--
-- Supabase SQL 편집기에 이 파일 전체를 붙여 한 번 실행한다. 몇 번을 실행해도 결과는 같다.
-- 마지막 SELECT가 적용됐는지(applied)와 이유(note)를 한 줄로 보여 준다. 편집기는 이 표만 보인다.
--
-- 왜: 지금 탈퇴는 지갑, 전광판, 토지, 사진, 푸시 구독을 지우지만 로그인 정보(auth.users의 그 줄)는 남는다.
--     Supabase Auth에는 이용자가 자기 계정을 지우는 길이 없어서, Worker가 부르던 DELETE /auth/v1/user는 아무 일도 하지 않았다.
--     같은 아이디와 비밀번호로 다시 로그인하면 같은 user:<uuid>로 돌아왔다.
--
-- 무엇을: public.forget_login(p_key, p_actor_id) 함수 하나를 만든다. 다른 함수와 표는 건드리지 않는다.
--     withdraw_account는 바꾸지 않는다. Worker가 withdraw_account 다음에 이 함수를 따로 부른다.
--     이 함수는 Worker 키(app_secrets의 FLUSH_KEY)가 맞을 때만 돌고, user:<uuid> 모양만 받고,
--     그 계정의 지갑 줄이 아직 있으면 거절한다(error 'wallet'). 그래서 탈퇴를 끝내는 데만 쓸 수 있고 살아 있는 계정은 지우지 못한다.
--     지갑 줄이 없으면 auth.users에서 그 한 줄을 지우고(identities, sessions, refresh tokens는 Supabase의 cascade로 같이 지워진다)
--     { ok: true, deleted: 0 또는 1 }을 돌려준다.
--
-- 함수의 주인: auth.users를 지울 수 있는 역할이어야 한다. SQL 편집기의 기본 역할 postgres가 그렇다.
--     SECURITY DEFINER라서 함수는 주인의 권한으로 돈다. 편집기에서 역할을 바꾸지 않고 그대로 실행하면 주인은 postgres가 된다.
--     다른 역할로 만들면 함수는 생기지만 지우지 못하고, 마지막 표의 applied가 false로 나온다.
--
-- 남기는 것 없이 확인하는 법: 이 파일이 끝에서 직접 해 본다. 있을 수 없는 계정(user:00000000-0000-0000-0000-000000000000)으로
--     함수를 한 번 부른다. 지워지는 줄은 0줄이고, 권한이 없으면 여기서 오류가 난다. 키는 app_secrets에서 읽으므로 붙여 넣지 않는다.
--     결과는 마지막 표의 note에 나온다. 따로 다시 해 보려면:
--       SELECT public.forget_login((SELECT key_value FROM public.app_secrets WHERE key_name = 'FLUSH_KEY'),
--                                  'user:00000000-0000-0000-0000-000000000000');
--     { "ok": true, "deleted": 0 }이면 된다.
--
-- 편집기가 "destructive operation" 경고를 띄울 수 있다. 함수 본문에 DELETE가 있어서다. 이 파일을 실행하는 것만으로는
-- 어떤 계정도 지워지지 않는다. 경고는 예상한 것이니 그대로 실행하면 된다.
-- 같은 창에 "creates a table without enabling Row Level Security (kts_forget)"도 나올 수 있다. kts_forget은 이 실행 동안만 쓰는
-- 임시 표라 밖에서 읽을 수 없다. "Run without RLS"를 누른다.
--
-- 순서: 코드 배포 앞이든 뒤든 괜찮다. 이 함수가 없는 동안 Worker는 탈퇴를 그대로 처리하고 응답에 login: 'kept'를 넣으며,
--     화면은 "로그인 정보는 운영자가 지웁니다"라고 말한다. 함수가 생기면 배포 없이 그 뒤의 탈퇴부터 로그인 정보까지 지우고
--     login: 'deleted'로 답한다. 탈퇴 화면의 안내 문구는 길게는 10분 안에(Worker가 다시 물어볼 때) 바뀐다.
--     예전 코드로 되돌려도 이 함수는 불리지 않을 뿐 해가 없다.
--     이 함수가 생기기 전에 탈퇴한 사람의 로그인 정보는 남아 있다. 그 줄은 Authentication > Users에서 손으로 지운다.
--     후보를 보는 법(읽기만 한다): 지갑 줄이 없는 로그인이다. 가입만 하고 한 번도 연결하지 않은 계정도 같이 나오므로
--     마지막 로그인 시각을 보고 고른다. Worker 로그의 'forget_login … login kept' 줄에는 계정 id를 적지 않는다.
--       SELECT u.id, u.email, u.created_at, u.last_sign_in_at FROM auth.users u
--       WHERE NOT EXISTS (SELECT 1 FROM public.wallets w WHERE w.actor_id = 'user:' || u.id::text) ORDER BY u.last_sign_in_at DESC;

-- 시험 호출의 결과를 마지막 표에 보이려고 이 실행 동안만 쓰는 임시 표.
CREATE TEMP TABLE IF NOT EXISTS kts_forget (k TEXT PRIMARY KEY, v TEXT);

BEGIN;
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
COMMIT;

-- PostgREST가 새 함수를 바로 보게 한다(Supabase는 보통 저절로 하지만 한 번 더 알린다).
NOTIFY pgrst, 'reload schema';

-- 시험 호출: 있을 수 없는 계정으로 한 번. 지워지는 줄은 없다. 권한이나 키가 맞지 않으면 그 이유가 표에 남는다.
DO $try$
DECLARE
  r JSONB;
BEGIN
  DELETE FROM kts_forget;
  BEGIN
    r := public.forget_login((SELECT key_value FROM public.app_secrets WHERE key_name = 'FLUSH_KEY'), 'user:00000000-0000-0000-0000-000000000000');
    INSERT INTO kts_forget VALUES ('try', CASE WHEN r->>'ok' = 'true' AND r->>'deleted' = '0' THEN 'ok' ELSE r::text END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO kts_forget VALUES ('try', SQLERRM);
  END;
END
$try$;

-- ============================================================================
-- 결과: 함수가 있고, 주인의 권한으로 auth.users를 지울 수 있는지
-- ============================================================================
SELECT '탈퇴 때 로그인 정보 지우기' AS part,
  (f.oid IS NOT NULL AND f.prosecdef AND COALESCE(t.v, '') = 'ok' AND NOT COALESCE(r.blocked, false)) AS applied,
  CASE
    WHEN f.oid IS NULL THEN '안 바뀜: public.forget_login(text,text)이 없습니다. 실행 메시지의 오류를 보세요'
    WHEN NOT f.prosecdef THEN '함수는 있지만 SECURITY DEFINER가 아닙니다. 이 파일을 다시 실행하세요'
    WHEN t.v IS NULL THEN '함수는 있습니다. 시험 호출을 하지 않았습니다. 이 파일 전체를 실행하세요'
    WHEN t.v <> 'ok' THEN '함수는 있지만 지우지 못합니다(주인 ' || f.proowner::regrole::text || '): ' || t.v || '. postgres 역할로 다시 실행하세요'
    WHEN COALESCE(r.blocked, false) THEN '함수는 있지만 auth.users의 RLS 때문에 주인 ' || f.proowner::regrole::text || '이 줄을 보지 못합니다. postgres 역할로 다시 실행하세요'
    ELSE '적용됨. 주인 ' || f.proowner::regrole::text || '. 없는 계정으로 시험 호출해 0줄 삭제를 확인했습니다'
  END AS note
FROM (SELECT to_regprocedure('public.forget_login(text,text)') AS oid) x
LEFT JOIN pg_proc f ON f.oid = x.oid
LEFT JOIN kts_forget t ON t.k = 'try'
LEFT JOIN LATERAL (
  SELECT c.relrowsecurity AND NOT (o.rolsuper OR o.rolbypassrls OR c.relowner = f.proowner) AS blocked
  FROM pg_class c JOIN pg_roles o ON o.oid = f.proowner
  WHERE c.oid = to_regclass('auth.users')
) r ON true;
