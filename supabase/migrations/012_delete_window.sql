-- ============================================================================
-- Migration 012：刪除改為只能在 20 分鐘內，逾期不可刪
--
-- 架構書 §9.5 / ADR-0010（修訂）、ADR-0021。
-- 規則（§12.6）：已推上雲端的 migration 不得修改，故新增而非改寫 007。
-- ============================================================================

-- 原本的規則有兩段：10 分鐘內刪除回補配額，逾期仍可刪但不回補。
-- 新規則只有一段：**20 分鐘內可刪，逾期刪不了。**
--
-- 為什麼這樣比較好懂：原本使用者要理解「刪除」與「配額回補」兩個概念，
-- 而後者在畫面上只是一行小字。現在時間內刪除等同於「撤回」，
-- 時間一過貼文就定案了——一個概念，一個倒數。
--
-- 兩個代價，都寫在 ADR-0021：
-- 一、逾期後成員無法自行移除自己的照片，只能請管理員下架（hidden_by_admin）。
--     §8.6 說成員名單帶宗教信仰資訊、屬特種個人資料，所以 join 頁的告知同意
--     必須同步改寫並指出這條管道，否則是不實陳述。
-- 二、20 分鐘的判斷一律以伺服器的 now() 為準，前端的倒數只是畫面。

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

  -- 這一段是本次 migration 的重點。以 now() 判定而非任何前端傳入的時間：
  -- 若由瀏覽器決定，使用者把本機時鐘往回撥就能刪掉任何一則舊貼文，
  -- 於是刪了再發、無限繞過每週配額。
  -- 邊界採「含」，與前端倒數一致。
  if now() - v_created_at > interval '20 minutes' then
    raise exception '這則貼文已超過 20 分鐘，無法自行刪除。請聯絡團契負責人。';
  end if;

  -- 走到這裡必定在期限內，所以一律回補配額——
  -- 「時間內刪除」與「回補」已經是同一件事，不再需要 case 判斷。
  update posts
  set deleted_at = now(),
      counts_toward_quota = false
  where id = p_id;
end;
$$;

comment on function soft_delete_post(uuid) is
  'ADR-0021：20 分鐘內可自行刪除，逾期拒絕。時間判定的正身——'
  '前端的倒數只用來畫面，改本機時鐘騙不過這裡。'
  '逾期後的移除路徑是管理員的 admin_set_post_hidden。';
