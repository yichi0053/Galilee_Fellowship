-- ============================================================================
-- Migration 013：成員個人檔案，以及 room_members 的欄位層級權限
--
-- 架構書 §10.7 / ADR-0013（profile 提前）、ADR-0022。
-- 規則（§12.6）：新增而非改寫 001。
-- ============================================================================

-- ------------------------------------------------------------ 新增欄位 ---

alter table room_members add column birthday        date;
alter table room_members add column interests       text;
alter table room_members add column favorite_verse  text;

alter table room_members add constraint members_interests_length
  check (interests is null or char_length(interests) between 1 and 100);

alter table room_members add constraint members_verse_length
  check (favorite_verse is null or char_length(favorite_verse) between 1 and 200);

-- 生日只用來讓大家知道彼此的日子，不做年齡驗證。範圍檢查純粹是擋打錯：
-- 1900 年以前與未來的日期都不會是任何一個團契成員的生日。
alter table room_members add constraint members_birthday_range
  check (birthday is null or (birthday >= date '1900-01-01' and birthday <= current_date));

-- display_name 到目前為止的唯一寫入者是 join-room Edge Function，長度由那支把關。
-- 本 migration 之後成員可以自己改，PostgREST 這條路上沒有那道檢查——
-- 補一個約束，否則有人送出 5000 字的名字，牆上每張卡片都會爆版。
-- 20 這個數字與 src/config/constants.ts 的 DISPLAY_NAME_MAX_LENGTH
-- 以及 join-room 的 DISPLAY_NAME_MAX 是同一個，三處要一起改。
alter table room_members add constraint members_display_name_length
  check (char_length(display_name) between 1 and 20);

comment on column room_members.birthday is
  'ADR-0022：選填。同房間的成員讀得到（members_select policy），訪客讀不到。';
comment on column room_members.interests is 'ADR-0022：選填，至多 100 字。';
comment on column room_members.favorite_verse is 'ADR-0022：選填，至多 200 字。';

-- -------------------------------------------------------- 欄位層級權限 ---

-- 001 給了 authenticated 整表的 UPDATE，而 members_update policy 是 is_admin()，
-- 所以在此之前一般成員完全改不動任何一列——沒有漏洞。
--
-- 現在要放行「成員改自己的個人檔案」，情況就變了：policy 管的是**列**，
-- 一旦讓成員更新自己那一列，他就能更新那一列的**每一個欄位**，
-- 包含 role。任何成員都能把自己變成管理員，而且是一個 PATCH 就完成。
-- 這與 migration 010 對 posts 做的是同一件事，理由一字不差。
revoke update on room_members from authenticated;
grant update (display_name, birthday, interests, favorite_verse)
  on room_members to authenticated;

create policy members_update_self on room_members
  for update
  using (user_id = auth.uid() and status = 'active')
  with check (user_id = auth.uid() and status = 'active');

comment on policy members_update_self on room_members is
  'ADR-0022：成員只能改自己那一列，且只有 role 與 status 以外的欄位'
  '（欄位範圍由 grant 決定，不是由這條 policy 決定）。'
  'status = active 的條件讓停權者不能改名字繞過辨識。';

-- --------------------------------------------------- 管理員的狀態變更 ---

-- 上面的 revoke 連帶把管理員改 status 的能力也收掉了（欄位 grant 沒有 status）。
-- 與 010 的 admin_set_post_hidden 同一個模式：privileged 欄位只由自己把關的
-- definer 函式寫入。
create or replace function admin_set_member_status(p_member_id uuid, p_status member_status)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target_role member_role;
begin
  -- security definer 會繞過 RLS，所以授權必須自己做，
  -- 且以 auth.uid() 反查 room_members，不信任任何呼叫端傳入的身分。
  if not exists (
    select 1
    from room_members me
    join room_members target on target.room_id = me.room_id
    where target.id = p_member_id
      and me.user_id = auth.uid()
      and me.role = 'admin'
      and me.status = 'active'
  ) then
    raise exception '只有管理員可以變更成員狀態';
  end if;

  select role into v_target_role from room_members where id = p_member_id;

  -- ADR-0014：單一管理員是已知的單點失效。停掉唯一的管理員之後
  -- 就沒有人能把它復權了，只能回 Dashboard 手動改資料庫。
  -- 後台的 UI 也不給管理員任何按鈕，這裡是第二道。
  if v_target_role = 'admin' and p_status <> 'active' then
    raise exception '不可停權或退出管理員。需要移交請先於 Dashboard 指派新的管理員。';
  end if;

  update room_members set status = p_status where id = p_member_id;
end;
$$;

comment on function admin_set_member_status(uuid, member_status) is
  'ADR-0022：status 已由本 migration 收回直接 UPDATE 權限，本函式是唯一的寫入路徑。'
  '「停權」與「退出」對貼文的處置不同（§4.3），但兩者都經由這裡。';

revoke execute on function admin_set_member_status(uuid, member_status) from public, anon;
grant execute on function admin_set_member_status(uuid, member_status) to authenticated;
