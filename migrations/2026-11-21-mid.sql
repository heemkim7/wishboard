-- 2026-11-21 운영 DB 바꾸기 (한 번에 붙여 실행하는 파일)
--
-- Supabase SQL 편집기에 이 파일 전체를 붙여 한 번 실행한다. 네 부분은 서로 따로다. 부분마다 BEGIN … COMMIT이고,
-- 한 부분이 운영 함수가 예상과 달라 멈추면 그 부분만 되돌아가고(WARNING에 이유가 나온다) 나머지는 그대로 진행한다.
-- 몇 번을 실행해도 결과는 같다. 이미 바뀐 부분은 건너뛴다.
-- 마지막 SELECT가 부분마다 적용됐는지(applied)를 운영 함수의 지금 정의를 읽어 보여 준다. 편집기는 이 표만 보인다.
--
-- 큰 함수(claim_billboard, withdraw_account, inbox_list)는 통째로 바꾸지 않는다. 지금 운영 정의를 읽어 바꿀 한 줄이
-- 정확히 한 번 있을 때만 그 줄만 바꾼다. 운영에서 다른 곳을 손으로 고쳐 두었어도 그 고침은 남는다.
-- SECURITY DEFINER, search_path, 권한은 그대로다.
--
-- 1부 무료 첫 칸 12개: public.starter_slots()(목록)와 public.starter_slot_list(p_key)(Worker가 읽음)를 만들고,
--     claim_billboard의 무료 칸 검사 한 줄을 starter_slots()로 바꾼다. 한 줄을 못 찾으면 셋 다 만들지 않는다.
--     적용 뒤 길게는 10분 안에 배포 없이 12칸이 열린다.
-- 2부 탈퇴 때 옛 푸시 구독 지우기: withdraw_account의 지갑 삭제 앞에 push_subs 삭제 한 줄을 넣는다.
-- 3부 받은 소식 읽음 표시: inbox_list가 줄마다 read(읽었으면 true)를 같이 준다. 순서는 그대로다.
-- 4부 소속 지붕을 일요일 방문 없이: public.tribe_roofs 표(주마다 한 줄)를 만들고 award_tribe_roof를 바꾼다.
--     끝난 주만 받고(지금 주는 open), 주마다 한 번만 정한다(두 번째는 done). 요일 검사는 없다.
--
-- 편집기가 "destructive operation" 경고를 띄울 수 있다. 2부가 넣는 withdraw_account 본문에 DELETE가 있어서다.
-- 이 파일은 표나 데이터를 지우지 않는다. 경고는 예상한 것이니 그대로 실행하면 된다.
-- 같은 창에 "creates a table without enabling Row Level Security (kts_mid)"도 나온다. kts_mid는 이 실행 동안만 쓰는
-- 임시 표라 밖에서 읽을 수 없다. "Run without RLS"를 누른다.
--
-- 2026-11-21: 2부만 운영 DB에 적용했다(임시 표 줄 + 2부 + 결과 표). 파일 전체를 실행하면 2부는 건너뛴다.
-- 2026-11-22: 1부는 starter_slots()가 이미 있으면 그 목록을 그대로 둔다(2026-11-22-boards.sql의 20칸). 그 파일이 1부의 일을 같이 한다.
--
-- 순서: 이번 코드를 배포한 뒤에 실행한다. 4부를 실행한 뒤 예전 코드로 되돌리면(rollback) 예전 코드는 일요일에
-- '지금 주'만 묻기 때문에 소속 지붕이 정해지지 않는다. 다시 새 코드를 올리면 끝난 주부터 이어서 정해진다.

-- 멈춘 부분의 이유를 마지막 표에 보이려고 이 실행 동안만 쓰는 임시 표.
CREATE TEMP TABLE IF NOT EXISTS kts_mid (part INT PRIMARY KEY, why TEXT);

-- ============================================================================
-- 1부. 무료 첫 칸 12개
-- ============================================================================
BEGIN;
DO $p1$
DECLARE
  old_c CONSTANT TEXT := $q$p_slot_id NOT IN ('STREET_8','STREET_9','STREET_10','STREET_11')$q$;
  new_c CONSTANT TEXT := $q$NOT (p_slot_id = ANY (public.starter_slots()))$q$;
  d TEXT; n INT;
BEGIN
  BEGIN
    -- 2026-11-22-boards.sql이 먼저 돌았으면 목록(20칸)이 이미 있다. 12칸으로 되돌리지 않는다.
    IF to_regprocedure('public.starter_slots()') IS NULL THEN
    EXECUTE $f$
CREATE OR REPLACE FUNCTION public.starter_slots()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY['STREET_20','STREET_23','STREET_28','STREET_19','STREET_27','STREET_16',
               'STREET_22','STREET_7','STREET_11','STREET_9','STREET_8','STREET_10']::TEXT[];
$$
$f$;
    END IF;
    EXECUTE $f$
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
$$
$f$;
    GRANT EXECUTE ON FUNCTION public.starter_slots() TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.starter_slot_list(TEXT) TO anon, authenticated, service_role;
    d := pg_get_functiondef('public.claim_billboard(text,text,text,text,bigint,text,text,text,text,text,text,text,integer,text)'::regprocedure);
    IF position(new_c IN d) = 0 THEN
      n := (length(d) - length(replace(d, old_c, ''))) / length(old_c);
      IF n <> 1 THEN
        RAISE EXCEPTION '중단: 운영 DB의 claim_billboard에서 바꿀 줄을 %번 찾았습니다(1번이어야 함). 이 부분은 바뀌지 않았습니다.', n;
      END IF;
      EXECUTE replace(d, old_c, new_c);
    END IF;
    DELETE FROM kts_mid WHERE part = 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '1부 %', SQLERRM;
    INSERT INTO kts_mid VALUES (1, SQLERRM) ON CONFLICT (part) DO UPDATE SET why = excluded.why;
  END;
END
$p1$;
COMMIT;

-- ============================================================================
-- 2부. 탈퇴 때 옛 푸시 구독 지우기
-- ============================================================================
BEGIN;
DO $p2$
DECLARE
  old_w CONSTANT TEXT := 'DELETE FROM public.wallets WHERE actor_id = p_actor_id;';
  new_w CONSTANT TEXT := 'DELETE FROM public.push_subs WHERE actor_id = p_actor_id;';
  note CONSTANT TEXT := '-- Push subscriptions saved only here (before the Worker kept its own copy) go with the account.';
  d TEXT; n INT;
BEGIN
  BEGIN
    d := pg_get_functiondef('public.withdraw_account(text,text)'::regprocedure);
    IF position(new_w IN d) = 0 THEN
      n := (length(d) - length(replace(d, old_w, ''))) / length(old_w);
      IF n <> 1 THEN
        RAISE EXCEPTION '중단: 운영 DB의 withdraw_account에서 바꿀 줄을 %번 찾았습니다(1번이어야 함). 이 부분은 바뀌지 않았습니다.', n;
      END IF;
      EXECUTE replace(d, old_w, note || E'\n  ' || new_w || E'\n  ' || old_w);
    END IF;
    DELETE FROM kts_mid WHERE part = 2;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '2부 %', SQLERRM;
    INSERT INTO kts_mid VALUES (2, SQLERRM) ON CONFLICT (part) DO UPDATE SET why = excluded.why;
  END;
END
$p2$;
COMMIT;

-- ============================================================================
-- 3부. 받은 소식 읽음 표시
-- ============================================================================
BEGIN;
DO $p3$
DECLARE
  old_i CONSTANT TEXT := $q$'created_at', s.created_at$q$;
  new_i CONSTANT TEXT := $q$'read', (s.read_at IS NOT NULL)$q$;
  d TEXT; n INT;
BEGIN
  BEGIN
    d := pg_get_functiondef('public.inbox_list(text,text)'::regprocedure);
    IF position(new_i IN d) = 0 THEN
      n := (length(d) - length(replace(d, old_i, ''))) / length(old_i);
      IF n <> 1 THEN
        RAISE EXCEPTION '중단: 운영 DB의 inbox_list에서 바꿀 줄을 %번 찾았습니다(1번이어야 함). 이 부분은 바뀌지 않았습니다.', n;
      END IF;
      EXECUTE replace(d, old_i, old_i || E',\n    ' || new_i);
    END IF;
    DELETE FROM kts_mid WHERE part = 3;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '3부 %', SQLERRM;
    INSERT INTO kts_mid VALUES (3, SQLERRM) ON CONFLICT (part) DO UPDATE SET why = excluded.why;
  END;
END
$p3$;
COMMIT;

-- ============================================================================
-- 4부. 소속 지붕을 일요일 방문 없이
-- ============================================================================
BEGIN;
DO $p4$
DECLARE
  dow CONSTANT TEXT := $q$IF EXTRACT(DOW FROM timezone('Asia/Seoul', now()))::int <> 0 THEN$q$;
  d TEXT;
BEGIN
  BEGIN
    d := pg_get_functiondef('public.award_tribe_roof(text,text)'::regprocedure);
    IF position('tribe_roofs' IN d) = 0 THEN
      IF position(dow IN d) = 0 THEN
        RAISE EXCEPTION '중단: 운영 DB의 award_tribe_roof가 예상한 모양이 아닙니다(요일 검사를 찾지 못함). 이 부분은 바뀌지 않았습니다.';
      END IF;
      CREATE TABLE IF NOT EXISTS public.tribe_roofs (
        week TEXT PRIMARY KEY,
        tribe_id TEXT,
        awarded_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE public.tribe_roofs ENABLE ROW LEVEL SECURITY;
      EXECUTE $f$
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
$$
$f$;
    END IF;
    DELETE FROM kts_mid WHERE part = 4;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '4부 %', SQLERRM;
    INSERT INTO kts_mid VALUES (4, SQLERRM) ON CONFLICT (part) DO UPDATE SET why = excluded.why;
  END;
END
$p4$;
COMMIT;

-- ============================================================================
-- 결과: 부분마다 지금 운영 정의에 들어가 있는지
-- ============================================================================
SELECT n || '부 ' || t.part AS part, applied,
  CASE WHEN applied THEN yes ELSE COALESCE('안 바뀜: ' || m.why, '안 바뀜. 실행 메시지의 WARNING을 보세요') END AS note
FROM (VALUES
  (1, '무료 첫 칸 12개', COALESCE(position($q$NOT (p_slot_id = ANY (public.starter_slots()))$q$ IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.claim_billboard(text,text,text,text,bigint,text,text,text,text,text,text,text,integer,text)'))) > 0, false)
      AND to_regprocedure('public.starter_slot_list(text)') IS NOT NULL, 'claim_billboard가 starter_slots()로 검사함'),
  (2, '탈퇴 때 푸시 구독 지우기', COALESCE(position('public.push_subs' IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.withdraw_account(text,text)'))) > 0, false), 'withdraw_account가 push_subs를 지움'),
  (3, '받은 소식 읽음 표시', COALESCE(position($q$'read', (s.read_at IS NOT NULL)$q$ IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.inbox_list(text,text)'))) > 0, false), 'inbox_list가 read를 줌'),
  (4, '소속 지붕 주마다 한 번', COALESCE(position('tribe_roofs' IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.award_tribe_roof(text,text)'))) > 0, false)
      AND to_regclass('public.tribe_roofs') IS NOT NULL, '끝난 주만, 주마다 한 번')
) AS t(n, part, applied, yes)
LEFT JOIN kts_mid m ON m.part = t.n
ORDER BY n;
