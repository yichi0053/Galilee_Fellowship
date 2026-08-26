-- ============================================================================
-- Migration 007：作者軟刪除與配額回補（伺服器端判定）
--
-- 架構書 §9.5 / ADR-0009、ADR-0010。
-- 規則（§12.6）：新增而非改寫 002。
-- ============================================================================

-- 為什麼這件事不能留在前端做：
--
-- 回補與否取決於「現在距離發布是否在 10 分鐘內」。若由瀏覽器判斷，
-- 使用者只要把本機時鐘往回撥，就能讓任何一則舊貼文都算在回補期內，
-- 於是刪了再發、無限繞過每週配額。src/modules/quota/rules.ts 的註解已經寫明
-- 「前端那份只用來畫倒數，不可拿來當授權判斷」——本函式就是那個判斷的正身。
--
-- security definer 會繞過 RLS，故授權必須自己做：只有貼文作者本人能刪。
-- 管理員的下架走 hidden_by_admin，是另一條路徑，不從這裡走。
create or replace function soft_delete_post(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_created_at timestamptz;
  v_author_id  uuid;
begin
  select created_at, author_id into v_created_at, v_author_id
  from posts
  where id = p_id and deleted_at is null;

  if not found then
    raise exception '找不到這則貼文，或它已經被刪除了';
  end if;

  -- 「這一列的作者是不是我」——以 auth.uid() 反查 room_members，
  -- 不信任任何由呼叫端傳入的 member id。
  if not exists (
    select 1 from room_members m
    where m.id = v_author_id and m.user_id = auth.uid() and m.status = 'active'
  ) then
    raise exception '只能刪除自己的貼文';
  end if;

  update posts
  set deleted_at = now(),
      -- ADR-0010：回補期內刪除才不計入配額。邊界採「含」，與前端倒數一致。
      counts_toward_quota =
        case when now() - v_created_at <= interval '10 minutes' then false else true end
  where id = p_id;
end;
$$;

comment on function soft_delete_post(uuid) is
  'ADR-0010：回補判定的正身。前端的 isWithinRefundWindow 只用來畫倒數，'
  '改本機時鐘就能騙過，故授權與時間判斷一律在此以 now() 進行。';

-- 硬刪除仍然只由 004 的清理函式執行；一般使用者只能經由本函式軟刪除。
revoke execute on function soft_delete_post(uuid) from public, anon;
grant execute on function soft_delete_post(uuid) to authenticated;
