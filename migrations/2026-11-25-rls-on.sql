-- 2026-11-25 RLS가 꺼져 있던 여섯 표에 RLS 켜기 (한 번에 붙여 실행하는 파일)
--
-- Supabase SQL 편집기에 이 파일 전체를 붙여 한 번 실행한다. 몇 번을 실행해도 결과는 같다.
-- 마지막 SELECT가 적용됐는지(applied)와 이유(note)를 한 줄로 보여 준다. 편집기는 이 표만 보인다.
--
-- 왜: 2026-11-25에 Supabase 보안 점검(Security Advisor)이 'RLS Disabled in Public' 오류 여섯 개를 냈다.
--     운영 DB의 tribes, tribe_members, tribe_pool, tribe_scores, seasons, ops_events는 RLS가 꺼져 있었다.
--     Supabase는 public 스키마의 표에 anon과 authenticated의 모든 권한을 기본으로 주므로, 브라우저에 실리는 공개 키만으로
--     누구나 이 여섯 표를 읽고, 넣고, 고치고, 지울 수 있었다. schema.sql에는 처음부터 ENABLE ROW LEVEL SECURITY가 있지만
--     운영 DB의 이 표들은 그 줄 없이 만들어졌고, 그 줄을 운영으로 옮긴 마이그레이션이 없었다.
--
-- 무엇을: 여섯 표에 RLS를 켠다. 그것뿐이다. 정책은 만들지 않는다(schema.sql과 같다. 공개 읽기 없음).
--     데이터, 함수, 권한은 건드리지 않는다.
--     이 표들을 쓰는 함수(plaza_live, my_tribe, create_tribe, join_tribe, pledge_tribe, refund_tribe_week, add_tribe_score,
--     award_tribe_roof, claim_billboard, relight_billboard, upsert_ops_event)는 모두 SECURITY DEFINER이고 표 주인의 것이라
--     RLS를 지나간다. tribe_roofs, profiles, coin_ledger, inbox가 이미 같은 모양(RLS 켬, 정책 없음)으로 돌고 있다.
--     Worker와 화면은 이 표들을 직접 읽지 않는다(직접 읽는 표는 billboards, plots, wallets뿐이다).
--
-- 순서: 코드 배포와 상관없다. 배포가 필요 없다.
--     이 파일 전: 서비스 동작은 같고, 여섯 표가 공개 키에 열려 있다.
--     이 파일 뒤: 서비스 동작은 같고, 공개 키로는 여섯 표에서 한 줄도 읽거나 쓰지 못한다.
--     되돌릴 일은 없다. 굳이 되돌리려면 표마다 ALTER TABLE public.<표> DISABLE ROW LEVEL SECURITY.

BEGIN;
ALTER TABLE IF EXISTS public.tribes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tribe_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tribe_pool ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tribe_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ops_events ENABLE ROW LEVEL SECURITY;
COMMIT;

-- ============================================================================
-- 결과: 여섯 표의 RLS가 켜졌는지, public에 RLS가 꺼진 다른 표가 남았는지 (읽기만 한다. 아무 줄도 쓰지 않는다)
-- ============================================================================
SELECT 'RLS 켜기' AS part,
  (s.off_n = 0) AS applied,
  CASE
    WHEN s.off_n > 0 THEN '안 바뀜: 아직 RLS가 꺼진 표: ' || s.off_names || '. 실행 메시지의 오류를 보세요'
    ELSE '적용됨. 여섯 표 가운데 이 DB에 있는 ' || s.have_n || '개의 RLS가 켜져 있습니다'
      || CASE WHEN s.have_n < 6 THEN ' (없는 표: ' || s.missing || ')' ELSE '' END
      || CASE WHEN o.names IS NULL THEN '. public에 RLS가 꺼진 표가 없습니다'
              ELSE '. 이 파일이 다루지 않는 표 가운데 RLS가 꺼진 것: ' || o.names END
  END AS note
FROM (
  SELECT count(c.oid)::int AS have_n,
    (count(c.oid) FILTER (WHERE NOT c.relrowsecurity))::int AS off_n,
    string_agg(w.t, ', ' ORDER BY w.t) FILTER (WHERE c.oid IS NOT NULL AND NOT c.relrowsecurity) AS off_names,
    string_agg(w.t, ', ' ORDER BY w.t) FILTER (WHERE c.oid IS NULL) AS missing
  FROM unnest(ARRAY['tribes', 'tribe_members', 'tribe_pool', 'tribe_scores', 'seasons', 'ops_events']) AS w(t)
  LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || w.t)
) s,
(
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) AS names
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
    AND c.relname NOT IN ('tribes', 'tribe_members', 'tribe_pool', 'tribe_scores', 'seasons', 'ops_events')
) o;
