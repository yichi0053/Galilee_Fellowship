-- ============================================================================
-- Migration 009：30 天硬刪除改由 Edge Function 執行
--
-- 架構書 §9.5 / ADR-0009。
-- 規則（§12.6）：新增而非改寫 004。
-- ============================================================================

-- 004 的 cleanup_deleted_posts() 從來沒有成功執行過，也永遠不會。
-- Supabase 已禁止以 SQL 直接刪除 storage.objects：
--
--   ERROR 42501: Direct deletion from storage tables is not allowed.
--                Use the Storage API instead.
--
-- 這件事的失敗模式極其安靜：migration 套用成功、函式建得起來、
-- 只有真的呼叫下去才會爆，而在此之前沒有任何跡象。
-- 後果是 ADR-0009 承諾的 30 天硬刪除從未發生——成員按下刪除、貼文從牆上消失，
-- **但照片仍留在公開 bucket 裡，知道網址的人永遠看得到**。
--
-- 改由 supabase/functions/cleanup-posts 以 service role 執行：
-- 先經 Storage API 刪檔案，再刪資料列。順序不可顛倒。

-- 排程必須停掉。若留著它去跑一個「只刪資料列」的版本會更糟：
-- 資料列一消失就再也查不到 image_path，檔案變成永遠找不回來的孤兒，
-- 持續佔用 1 GB 額度且無從清理。
do $$
begin
  perform cron.unschedule('cleanup-deleted-posts');
  raise notice 'pg_cron 排程已停用，清理改由 Edge Function 執行';
exception
  when others then
    -- 排程本來就沒建起來（004 的 exception 分支），或 pg_cron 不存在。兩種都不必處理。
    raise notice 'pg_cron 排程不存在，無需停用（%）', sqlerrm;
end
$$;

drop function if exists cleanup_deleted_posts();

comment on table posts is
  '§9.5 / ADR-0009：軟刪除後 30 天硬刪除，由 supabase/functions/cleanup-posts 執行'
  '（migration 009）。不可改回 SQL 函式——Storage 的檔案只能經 Storage API 刪除。';
