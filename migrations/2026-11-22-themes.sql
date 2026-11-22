-- 2026-11-22 계절 소원 테마 세 가지와 '없음' (한 번에 붙여 실행하는 파일)
--
-- Supabase SQL 편집기에 이 파일 전체를 붙여 한 번 실행한다. 몇 번을 실행해도 결과는 같다.
-- 마지막 SELECT가 적용됐는지(applied)와 이유(note)를 한 줄로 보여 준다. 편집기는 이 표만 보인다.
--
-- 왜: 소원 시트와 전광판의 소원 카드가 날짜에 맞는 테마(수능, 설날, 추석, 크리스마스, 새해, 발렌타인, 빼빼로데이, 어린이날)를
--     스스로 입는다(seasons.js의 날짜표). 관리자 화면의 운영 달력은 그 위에 얹는 손이다. 그 날짜 구간의 테마를 바꾸거나,
--     '없음'으로 꺼 둘 수 있다. 그런데 ops_events.theme의 CHECK가 다섯 가지(csat, xmas, newyear, seollal, valentine)만 받아서
--     추석(chuseok), 빼빼로데이(pepero), 어린이날(children), 없음(none)은 운영 달력에 저장되지 않는다.
--
-- 무엇을: 두 가지만 바꾼다. 다른 표와 함수는 건드리지 않는다. 데이터는 지우거나 고치지 않는다.
--     1. public.ops_events의 theme CHECK를 아홉 가지로 넓힌다. 이름이 무엇이든 theme을 검사하는 CHECK를 지우고
--        ops_events_theme_check를 다시 건다.
--     2. public.upsert_ops_event(...)가 아홉 가지를 받는다. Worker 키 검사, SECURITY DEFINER, search_path, 권한은 그대로다.
--     public.plaza_live와 public.seasons는 바꾸지 않는다.
--
-- 순서: 코드 배포 앞이든 뒤든 괜찮다.
--     이 파일 전: 화면과 전광판은 날짜표의 테마를 그대로 입는다. 운영 달력에 다섯 가지 중 하나를 저장하면 그 구간은
--       그 테마로 바뀐다(이미 그렇다). 추석, 빼빼로데이, 어린이날, 없음을 저장하려 하면 이 함수가 error 'theme'로 답하고
--       관리자 화면이 "이 테마는 아직 데이터베이스가 받지 않아요"라고 말한다. 아무것도 저장되지 않는다.
--     이 파일 뒤: 아홉 가지가 모두 저장된다. 배포는 필요 없다. 세계 캐시는 저장할 때 비워진다.
--     예전 코드로 되돌려도 해가 없다. 예전 코드는 운영 달력의 theme을 읽지 않는다(문구만 쓴다).

BEGIN;
DO $th$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.ops_events'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%theme%'
  LOOP
    EXECUTE format('ALTER TABLE public.ops_events DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.ops_events ADD CONSTRAINT ops_events_theme_check
    CHECK (theme IN ('csat','xmas','newyear','seollal','valentine','chuseok','pepero','children','none'));
END
$th$;

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
  IF p_theme NOT IN ('csat', 'xmas', 'newyear', 'seollal', 'valentine', 'chuseok', 'pepero', 'children', 'none') THEN
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
GRANT EXECUTE ON FUNCTION public.upsert_ops_event(TEXT, TEXT, DATE, DATE, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
COMMIT;

-- ============================================================================
-- 결과: CHECK가 아홉 가지이고 upsert_ops_event가 아홉 가지를 받는지 (정의를 읽기만 한다. 아무 줄도 쓰지 않는다)
-- ============================================================================
SELECT '계절 소원 테마' AS part,
  (k.n = 1 AND k.def LIKE '%none%' AND k.def LIKE '%chuseok%' AND f.prosrc LIKE '%''none''%' AND f.prosrc LIKE '%''chuseok''%' AND f.prosecdef) AS applied,
  CASE
    WHEN k.n = 0 THEN '안 바뀜: ops_events에 theme CHECK가 없습니다. 실행 메시지의 오류를 보세요'
    WHEN k.n <> 1 THEN 'theme CHECK가 ' || k.n || '개입니다. 이 파일을 다시 실행하세요'
    WHEN k.def NOT LIKE '%none%' OR k.def NOT LIKE '%chuseok%' THEN '안 바뀜: CHECK가 아직 ' || k.def || '입니다. 실행 메시지의 오류를 보세요'
    WHEN f.prosrc IS NULL THEN '안 바뀜: public.upsert_ops_event가 없습니다'
    WHEN f.prosrc NOT LIKE '%''none''%' OR f.prosrc NOT LIKE '%''chuseok''%' THEN 'CHECK는 넓어졌지만 upsert_ops_event가 아직 예전 것입니다. 이 파일을 다시 실행하세요'
    WHEN NOT f.prosecdef THEN 'upsert_ops_event가 SECURITY DEFINER가 아닙니다. 이 파일을 다시 실행하세요'
    ELSE '적용됨. 운영 달력이 csat, xmas, newyear, seollal, valentine, chuseok, pepero, children, none을 받습니다'
  END AS note
FROM (
  SELECT count(*)::int AS n, max(pg_get_constraintdef(oid)) AS def FROM pg_constraint
  WHERE conrelid = 'public.ops_events'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%theme%'
) k
LEFT JOIN pg_proc f ON f.oid = to_regprocedure('public.upsert_ops_event(text,text,date,date,text,text,text)');
