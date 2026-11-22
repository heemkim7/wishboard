-- 2026-11-22 메인거리 전광판 20칸 더 (STREET_31..50) (한 번에 붙여 실행하는 파일)
--
-- Supabase SQL 편집기에 이 파일 전체를 붙여 한 번 실행한다(역할은 기본 postgres 그대로). 몇 번을 실행해도 결과는 같다.
-- 마지막 SELECT가 적용됐는지(applied)와 이유(note)를 한 줄로 보여 준다. 편집기는 이 표만 보인다.
--
-- 왜: 광장 한가운데(보타이 안쪽 벽)에 거리 전광판 20칸이 새로 생겼다. 화면에는 이미 그려져 있지만, 운영 DB에 그 칸의 줄이
--     없어서 집 안내만 나오고 "곧 열려요"라고 말한다. 이 파일이 줄을 넣으면 배포 없이 길게는 1분 안에(Worker가 광장을 다시 읽을 때)
--     다른 거리 칸과 똑같이 점령, 수정, 소원, 신고, 리그, 소속 지붕, 불 꺼짐, 공유 페이지, QR, 관리 화면이 된다.
--
-- 무엇을: 두 부분이다. 부분마다 BEGIN … COMMIT이고, 한 부분이 멈추면 그 부분만 되돌아간다(WARNING에 이유가 나온다).
--   1부 전광판 20칸: public.slot_floor(p_slot)가 STREET_31..50에 바닥가를 준다(150 + round((n - 31) * 100 / 19), 150~250 코인,
--       거리 칸 중 가장 싸다. STREET_1..30은 그대로 200~400). 그리고 public.billboards에 STREET_31..50 줄을 넣는다(이미 있으면 그대로).
--       둘은 한 번에 된다. 바닥가가 없는 줄은 생기지 않는다. 지금 slot_floor가 예상한 모양(STREET_1..30만 아는 식)이 아니면 멈춘다.
--   2부 무료 첫 칸 20개: public.starter_slots()가 지금의 12칸 뒤에 새 칸 8개(빵집 가는 길에서 가까운 순)를 붙인 20칸을 돌려준다.
--       2026-11-21-mid.sql 1부를 아직 안 돌렸어도 된다. 그 1부가 하는 일(starter_slot_list를 만들고 claim_billboard의 무료 칸 검사
--       한 줄을 starter_slots()로 바꾸기)을 여기서도 한다. 한 줄을 정확히 한 번 찾을 때만 그 줄만 바꾸고, 운영에서 손으로 고친
--       다른 곳은 남는다. 1부가 적용되지 않았으면(새 칸 줄이 없으면) 2부도 멈춘다. 없는 칸을 무료로 내주지 않으려고.
--   다른 함수와 표, 이미 있는 칸(주인, 입찰가, 기록)은 건드리지 않는다. 지우는 것이 없다.
--
-- 같은 창에 "creates a table without enabling Row Level Security (kts_boards)"가 나올 수 있다. kts_boards는 이 실행 동안만 쓰는
-- 임시 표라 밖에서 읽을 수 없다. "Run without RLS"를 누른다.
--
-- 순서: 이번 코드를 배포한 뒤에 실행한다. 배포 전 코드는 STREET_31..50을 모르므로, 먼저 실행하면 새 줄은 그 코드에서 보이지 않을
--     뿐 해는 없다. 예전 코드로 되돌려도 새 줄은 쓰이지 않을 뿐이다.
--     2026-11-21-mid.sql을 나중에 실행해도 된다. 그 1부는 starter_slots()가 이미 있으면 목록을 다시 12칸으로 되돌리지 않는다.
--
-- 확인(읽기만 한다):
--   SELECT slot_id, current_bid, public.slot_floor(slot_id) FROM public.billboards WHERE slot_id ~ '^STREET_(3[1-9]|4[0-9]|50)$' ORDER BY 2;
--   SELECT public.starter_slots();

-- 멈춘 부분의 이유를 마지막 표에 보이려고 이 실행 동안만 쓰는 임시 표.
CREATE TEMP TABLE IF NOT EXISTS kts_boards (part INT PRIMARY KEY, why TEXT);

-- ============================================================================
-- 1부. 전광판 20칸 (바닥가와 줄을 한 번에)
-- ============================================================================
BEGIN;
DO $p1$
DECLARE
  old_r CONSTANT TEXT := $q$'^STREET_([1-9]|[12][0-9]|30)$'$q$;
  new_r CONSTANT TEXT := $q$'^STREET_(3[1-9]|4[0-9]|50)$'$q$;
  d TEXT;
BEGIN
  BEGIN
    SELECT prosrc INTO d FROM pg_proc WHERE oid = to_regprocedure('public.slot_floor(text)');
    IF d IS NULL THEN
      RAISE EXCEPTION '중단: 운영 DB에 public.slot_floor(text)가 없습니다. 이 부분은 바뀌지 않았습니다.';
    END IF;
    IF position(new_r IN d) = 0 THEN
      IF position(old_r IN d) = 0 THEN
        RAISE EXCEPTION '중단: 운영 DB의 slot_floor가 예상한 모양이 아닙니다(STREET_1..30 식을 찾지 못함). 이 부분은 바뀌지 않았습니다.';
      END IF;
      EXECUTE $f$
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
$$
$f$;
    END IF;
    INSERT INTO public.billboards (slot_id, tier, current_bid, line1, line2, line3)
    SELECT 'STREET_' || g, 'C',
      150 + round((g - 31) * 100.0 / 19)::bigint,
      g || '번 메인거리', '거리 쪽 큰 화면', '150~250 코인'
    FROM generate_series(31, 50) AS g
    ON CONFLICT (slot_id) DO NOTHING;
    DELETE FROM kts_boards WHERE part = 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '1부 %', SQLERRM;
    INSERT INTO kts_boards VALUES (1, SQLERRM) ON CONFLICT (part) DO UPDATE SET why = excluded.why;
  END;
END
$p1$;
COMMIT;

-- ============================================================================
-- 2부. 무료 첫 칸 20개
-- ============================================================================
BEGIN;
DO $p2$
DECLARE
  old_c CONSTANT TEXT := $q$p_slot_id NOT IN ('STREET_8','STREET_9','STREET_10','STREET_11')$q$;
  new_c CONSTANT TEXT := $q$NOT (p_slot_id = ANY (public.starter_slots()))$q$;
  d TEXT; n INT;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.billboards WHERE slot_id ~ '^STREET_(3[1-9]|4[0-9]|50)$';
    IF n <> 20 OR public.slot_floor('STREET_31') <> 150 THEN
      RAISE EXCEPTION '중단: 새 칸 20줄과 바닥가가 아직 없습니다(1부가 먼저). 이 부분은 바뀌지 않았습니다.';
    END IF;
    EXECUTE $f$
CREATE OR REPLACE FUNCTION public.starter_slots()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY['STREET_20','STREET_23','STREET_28','STREET_19','STREET_27','STREET_16',
               'STREET_22','STREET_7','STREET_11','STREET_9','STREET_8','STREET_10',
               'STREET_32','STREET_37','STREET_31','STREET_44','STREET_43','STREET_36','STREET_33','STREET_45']::TEXT[];
$$
$f$;
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
    DELETE FROM kts_boards WHERE part = 2;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '2부 %', SQLERRM;
    INSERT INTO kts_boards VALUES (2, SQLERRM) ON CONFLICT (part) DO UPDATE SET why = excluded.why;
  END;
END
$p2$;
COMMIT;

-- ============================================================================
-- 결과: 지금 운영 정의와 줄을 읽어서
-- ============================================================================
SELECT '메인거리 전광판 20칸 더' AS part, (a.all20 AND a.floors AND b.ok) AS applied,
  CASE
    WHEN a.all20 AND a.floors AND b.ok THEN '적용됨. STREET_31..50 20줄, 바닥가 150~250 코인, 무료 첫 칸 20개(claim_billboard가 starter_slots()로 검사)'
    WHEN NOT (a.all20 AND a.floors) THEN '안 바뀜: ' || COALESCE(m1.why, '새 칸 줄 ' || a.n || '개, 바닥가 ' || CASE WHEN a.floors THEN '맞음' ELSE '없음' END || '. 실행 메시지의 WARNING을 보세요')
    ELSE '전광판 20칸은 적용됨. 무료 첫 칸은 안 바뀜: ' || COALESCE(m2.why, '실행 메시지의 WARNING을 보세요')
  END AS note
FROM (SELECT count(*) AS n, count(*) = 20 AS all20,
        public.slot_floor('STREET_31') = 150 AND public.slot_floor('STREET_40') = 197 AND public.slot_floor('STREET_50') = 250
          AND public.slot_floor('STREET_30') = 400 AND public.slot_floor('STREET_51') = 0 AS floors
      FROM public.billboards WHERE slot_id ~ '^STREET_(3[1-9]|4[0-9]|50)$') a
CROSS JOIN (SELECT COALESCE(position($q$NOT (p_slot_id = ANY (public.starter_slots()))$q$ IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.claim_billboard(text,text,text,text,bigint,text,text,text,text,text,text,text,integer,text)'))) > 0, false)
        AND to_regprocedure('public.starter_slot_list(text)') IS NOT NULL
        AND to_regprocedure('public.starter_slots()') IS NOT NULL
        AND COALESCE((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.starter_slots()')) LIKE '%''STREET_45''%', false) AS ok) b
LEFT JOIN kts_boards m1 ON m1.part = 1
LEFT JOIN kts_boards m2 ON m2.part = 2;
