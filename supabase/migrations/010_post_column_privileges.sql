-- ============================================================================
-- Migration 010：posts 的欄位層級權限
--
-- 架構書 §9.1、§9.5 / ADR-0010、ADR-0015。
-- 規則（§12.6）：新增而非改寫 002。
-- ============================================================================

-- RLS 管的是「哪些**列**」，不是「哪些**欄**」。
-- 002 的 posts_update policy 允許作者更新自己的貼文——而那包含每一個欄位。
-- 實測（以一般成員的 JWT 直接打 PostgREST）三項都成功：
--
--   counts_toward_quota = false  →  自行回補配額，每週上限完全失效（ADR-0015）
--   hidden_by_admin     = false  →  管理員下架的照片，作者馬上放回去（§9.5）
--   deleted_at          = null   →  自行還原已刪除的貼文
--
-- 另外 type 與 week_start_date 也是可改的，那會讓貼文跳到別週或改變配額分類。
--
-- policy 擋不住這件事，因為它不認識欄位。正確的工具是欄位層級的 GRANT。

-- 先全部收回，再只授予作者真正需要的三欄。
-- 編輯貼文（§9.5：編輯不影響配額）只會動到這三欄。
-- rotation_deg 刻意不在其中：§11.2 說旋轉角在發布時決定一次，不可事後重擲。
revoke update on posts from authenticated;
grant update (body, image_path, thumb_path) on posts to authenticated;

-- hidden_by_admin 於是沒有任何角色能直接寫。改走 definer 函式，
-- 與 007 的 soft_delete_post 同一個模式：privileged 欄位只由自己把關的函式寫入。
create or replace function admin_set_post_hidden(p_id uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- security definer 會繞過 RLS，所以授權必須自己做，
  -- 且以 auth.uid() 反查 room_members，不信任任何呼叫端傳入的身分。
  if not exists (
    select 1
    from posts p
    join room_members m on m.room_id = p.room_id
    where p.id = p_id
      and m.user_id = auth.uid()
      and m.role = 'admin'
      and m.status = 'active'
  ) then
    raise exception '只有管理員可以下架或復原貼文';
  end if;

  update posts set hidden_by_admin = p_hidden where id = p_id;
end;
$$;

comment on function admin_set_post_hidden(uuid, boolean) is
  '§9.5：下架與復原。hidden_by_admin 已由 migration 010 收回直接 UPDATE 權限，'
  '本函式是唯一的寫入路徑。';

revoke execute on function admin_set_post_hidden(uuid, boolean) from public, anon;
grant execute on function admin_set_post_hidden(uuid, boolean) to authenticated;

-- counts_toward_quota 與 deleted_at 同樣不再可直接寫，
-- 唯一路徑是 007 的 soft_delete_post（definer，依伺服器時間決定回補與否）。
comment on column posts.counts_toward_quota is
  'ADR-0010：回補期內刪除設為 false，配額回補。'
  'migration 010 之後只有 soft_delete_post 寫得動它——'
  '先前作者可以直接改這一欄，每週配額形同虛設。';
