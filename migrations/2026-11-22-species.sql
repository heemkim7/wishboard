-- 2026-11-22 캐릭터 열 종 (한 번에 붙여 실행하는 파일)
--
-- Supabase SQL 편집기에 이 파일 전체를 붙여 한 번 실행한다. 몇 번을 실행해도 결과는 같다.
-- 마지막 SELECT가 적용됐는지(applied)와 이유(note)를 한 줄로 보여 준다. 편집기는 이 표만 보인다.
--
-- 왜: 캐릭터가 셋(1 쥐, 2 고양이, 3 곰)에서 열(4 토끼, 5 강아지, 6 판다, 7 여우, 8 펭귄, 9 햄스터, 10 호랑이)이 됐다.
--     지금 운영 DB는 profiles.species에 CHECK (species BETWEEN 1 AND 3)가 있고, save_species는 2와 3이 아니면 1로 저장한다.
--     그래서 4~10을 골라도 DB에는 1이 남는다.
--
-- 무엇을: 두 가지만 바꾼다. 다른 표와 함수는 건드리지 않는다. 데이터는 지우거나 고치지 않는다(지금 줄은 모두 1~3이다).
--     1. public.profiles의 species CHECK를 1~10으로 넓힌다. 이름이 무엇이든 species를 검사하는 CHECK를 지우고
--        profiles_species_check (species BETWEEN 1 AND 10)를 다시 건다.
--     2. public.save_species(p_key, p_actor_id, p_species)가 1~10을 그대로 저장한다. 그 밖의 값은 예전처럼 1이다.
--        Worker 키 검사, SECURITY DEFINER, search_path, 권한은 그대로다.
--
-- 순서: 코드 배포 앞이든 뒤든 괜찮다.
--     이 파일 전: 4~10을 고르면 DB는 1을 저장하고, Worker가 그 계정의 선택을 계정 기록(Meter DO 'acct'의 held 표)에 따로 둔다.
--       DB가 1이라고 답할 때만 그 기록으로 답하므로, 그 계정은 기기를 바꿔도, 다른 사람 화면에서도 고른 캐릭터로 보인다.
--     이 파일 뒤: 4~10이 DB에 그대로 저장되고, 그때 Worker는 따로 두던 기록을 지운다. 예전에 따로 둔 선택은
--       그 계정이 다음에 들어올 때 Worker가 DB에 다시 저장한다(길게는 10분 안에 한 번 더 시도).
--     예전 코드로 되돌려도 해가 없다. 예전 코드는 4~10을 1로 보여 줄 뿐이다.

BEGIN;
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
  INSERT INTO public.profiles (actor_id, species) VALUES (p_actor_id, v_species)
  ON CONFLICT (actor_id) DO UPDATE SET species = EXCLUDED.species;
  RETURN jsonb_build_object('ok', true, 'species', v_species);
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_species(TEXT, TEXT, INT) TO anon, authenticated, service_role;
COMMIT;

-- ============================================================================
-- 결과: CHECK가 1~10이고 save_species가 1~10을 그대로 저장하는지 (정의를 읽기만 한다. 아무 줄도 쓰지 않는다)
-- ============================================================================
SELECT '캐릭터 열 종' AS part,
  (k.def IS NOT NULL AND k.n = 1 AND k.def LIKE '%<= 10%' AND COALESCE(position('BETWEEN 1 AND 10' IN f.prosrc), 0) > 0 AND f.prosecdef) AS applied,
  CASE
    WHEN k.def IS NULL THEN '안 바뀜: profiles에 species CHECK가 없습니다. 실행 메시지의 오류를 보세요'
    WHEN k.n <> 1 THEN 'species CHECK가 ' || k.n || '개입니다. 이 파일을 다시 실행하세요'
    WHEN k.def NOT LIKE '%<= 10%' THEN '안 바뀜: CHECK가 아직 ' || k.def || '입니다. 실행 메시지의 오류를 보세요'
    WHEN f.prosrc IS NULL THEN '안 바뀜: public.save_species(text,text,integer)가 없습니다'
    WHEN position('BETWEEN 1 AND 10' IN f.prosrc) = 0 THEN 'CHECK는 1~10이지만 save_species가 아직 예전 것입니다. 이 파일을 다시 실행하세요'
    WHEN NOT f.prosecdef THEN 'save_species가 SECURITY DEFINER가 아닙니다. 이 파일을 다시 실행하세요'
    ELSE '적용됨. species는 1~10, save_species가 고른 값을 그대로 저장합니다'
  END AS note
FROM (
  SELECT count(*)::int AS n, max(pg_get_constraintdef(oid)) AS def FROM pg_constraint
  WHERE conrelid = 'public.profiles'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%species%'
) k
LEFT JOIN pg_proc f ON f.oid = to_regprocedure('public.save_species(text,text,integer)');
