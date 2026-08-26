-- ============================================================================
-- Migration 006：themes_public view
--
-- 架構書 §9.6、§10.3 / ADR-0006。
-- 規則（§12.6）：已推上雲端的 migration 不得修改，故新增而非改寫 002。
-- ============================================================================

-- 002 只建了 posts_public 與 rooms_public，themes 的 RLS 是 is_active_member()，
-- 於是訪客看得到貼文卻看不到那一週的主題標題——而 posts_public 裡就有 theme_id。
-- 訪客拿得到 id 卻解不出標題，牆頁對訪客只能顯示「本週還沒有主題」，
-- 但其實有，只是他看不到。這是誤導，不是保護。
--
-- 主題文案（例如「今天的晚餐，跟誰吃的」）由管理員撰寫、不含任何個人資料，
-- 與 §8.6 要保護的成員名單無關，故對訪客開放。
--
-- 與 posts_public 同理，本 view **不可**設 security_invoker = true：
-- 它必須以 owner 權限執行才能繞過 themes 的 RLS。設反了的失敗模式是
-- 訪客看到的主題永遠是空的，且無任何錯誤訊息。
create view themes_public as
  select id, room_id, week_start_date, title, description
  from themes;

comment on view themes_public is
  'ADR-0006：訪客可讀的主題。刻意不含 created_at——'
  '排程時間洩漏管理員的作業節奏，對訪客沒有任何用處。';

grant select on themes_public to anon, authenticated;
