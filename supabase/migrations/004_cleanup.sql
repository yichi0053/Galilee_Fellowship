-- ============================================================================
-- Migration 004：軟刪除的 30 天硬刪除清理
--
-- 架構書 §9.5 / ADR-0009。
-- 清理任務必須冪等，且資料列刪除與 Storage 檔案刪除必須一併處理，
-- 否則會留下孤兒檔案持續佔用 1 GB 額度。
-- ============================================================================

create or replace function cleanup_deleted_posts()
returns table (deleted_rows integer, deleted_objects integer)
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_rows    integer := 0;
  v_objects integer := 0;
begin
  -- 先刪 Storage 物件，再刪資料列。
  -- 反過來的話，資料列一旦消失就再也查不到檔案路徑，孤兒檔案將永久佔用額度。
  with doomed as (
    select image_path, thumb_path
    from posts
    where deleted_at is not null
      and deleted_at < now() - interval '30 days'
  ),
  paths as (
    select image_path as p from doomed
    union all
    select thumb_path from doomed
  )
  delete from storage.objects o
  using paths
  where o.bucket_id = 'post-images' and o.name = paths.p;

  get diagnostics v_objects = row_count;

  delete from posts
  where deleted_at is not null
    and deleted_at < now() - interval '30 days';

  get diagnostics v_rows = row_count;

  return query select v_rows, v_objects;
end;
$$;

comment on function cleanup_deleted_posts() is
  '冪等，可重複執行。ADR-0009：30 天後誤刪無救，無任何回復路徑。';

-- 一般使用者不得執行；由 pg_cron 或管理員後台（service role）呼叫。
revoke execute on function cleanup_deleted_posts() from public, anon, authenticated;

-- ------------------------------------------------------------- 排程 ----
--
-- §9.5 待驗證：pg_cron 在免費方案的可用性，以及專案閒置暫停是否影響排程執行。
-- 若下列語句失敗，請整段註解掉，並改由管理後台呼叫 admin.runCleanup()
-- （ADR-0009 的替代方案，已在 src/modules/admin/index.ts 預留介面）。

do $$
begin
  create extension if not exists pg_cron;

  perform cron.schedule(
    'cleanup-deleted-posts',
    '30 4 * * *',              -- 每日 UTC 04:30（台灣時間 12:30）
    $cron$ select cleanup_deleted_posts(); $cron$
  );

  raise notice 'pg_cron 排程已建立';
exception
  when others then
    raise warning 'pg_cron 不可用（%），請改用管理後台觸發清理，見 ADR-0009', sqlerrm;
end
$$;
