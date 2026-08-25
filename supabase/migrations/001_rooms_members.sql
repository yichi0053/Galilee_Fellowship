-- ============================================================================
-- Migration 001：rooms、room_members、join_attempts
--
-- 架構書 §7.2、§8.1。
-- 規則（§12.6）：RLS policy 必須與其保護的表寫在同一個 migration，
-- 分開會出現「表已建立但尚無 policy」的時間窗口。
-- 已推上雲端的 migration 不得修改，需要調整時新增一個 migration。
-- ============================================================================

-- ---------------------------------------------------------------- 資料表 ----

create table rooms (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  description           text,
  background_image_url  text,
  join_code             text not null,
  join_open             boolean not null default true,
  created_at            timestamptz not null default now(),

  -- §8.2：房間碼最低長度 12 字元。字元類別規則是熵的劣質代理指標，
  -- 故此處只擋最低長度，禁止清單於前端（admin module）檢查。
  constraint join_code_min_length check (char_length(join_code) >= 12)
);

comment on column rooms.join_code is
  'ADR-0008：明文儲存。房間碼本質不是密碼，管理員必須能複述給成員。'
  '存取以 RLS 限制為僅管理員可讀，一般讀取走 rooms_public view。';

create type member_role   as enum ('member', 'admin');
create type member_status as enum ('active', 'suspended', 'left');

create table room_members (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references rooms(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  display_name  text not null,
  role          member_role   not null default 'member',
  status        member_status not null default 'active',
  joined_at     timestamptz   not null default now(),
  unique (room_id, user_id)
);

comment on column room_members.status is
  '§4.3：suspended 的貼文一律隱藏；left 的貼文保留顯示。'
  '這是實作中最容易寫反的一組條件，見 supabase/tests 的對應項目。';

-- §8.3：rate limit 與稽核
create table join_attempts (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid references rooms(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  ip          inet,
  success     boolean not null,
  created_at  timestamptz not null default now()
);

create index join_attempts_user_idx on join_attempts (user_id, created_at desc);
-- IP 維度的 rate limit 查詢（§8.3：同一 IP 每小時上限 20 次）
create index join_attempts_ip_idx   on join_attempts (ip, created_at desc);

-- ------------------------------------------------------------ 判斷函式 ----
--
-- security definer 是必要的：members_select policy 本身要查 room_members，
-- 若以 invoker 身分執行會造成 policy 遞迴。
-- security definer 函式必須釘住 search_path，否則呼叫者可用自訂 schema 劫持函式解析。

create or replace function is_active_member(rid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from room_members
    where room_id = rid and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function is_admin(rid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from room_members
    where room_id = rid and user_id = auth.uid()
      and role = 'admin' and status = 'active'
  );
$$;

-- ------------------------------------------------------------------ RLS ----

alter table rooms         enable row level security;
alter table room_members  enable row level security;
alter table join_attempts enable row level security;

-- rooms：一般讀取走 002 建立的 rooms_public view。
-- 本表只有管理員可讀，因為 join_code 在裡面。
create policy rooms_select on rooms
  for select using (is_admin(id));

create policy rooms_update on rooms
  for update using (is_admin(id)) with check (is_admin(id));

-- room_members：僅成員可讀，僅管理員可改。
-- 刻意「沒有」INSERT policy：加入房間一律走 join-room Edge Function（service role），
-- 前端無法自行插入成員列，否則任何登入者都能無視房間碼直接加入。
create policy members_select on room_members
  for select using (is_active_member(room_id));

create policy members_update on room_members
  for update using (is_admin(room_id)) with check (is_admin(room_id));

-- join_attempts：僅管理員可讀。同樣沒有 INSERT policy，只有 Edge Function 寫入。
create policy attempts_select on join_attempts
  for select using (is_admin(room_id));

-- --------------------------------------------------------------- Grants ----
--
-- §5.3：2026-05-30 之後建立的 project 需為 PostgREST 存取加上明確的 grants。
-- 未設定的失效模式為查詢回傳空值但無錯誤訊息。
--
-- RLS 管「哪些列」，grant 管「哪些操作」。兩者都要，缺一即失效。

grant usage on schema public to anon, authenticated;

-- Supabase 對 public schema 設有 default privileges，會自動把 anon 與 authenticated
-- 的權限授予新建的表。因此必須先全部收回，再逐項授予需要的操作，
-- 否則 authenticated 會默默擁有 insert 與 delete。
revoke all on rooms, room_members, join_attempts from anon, authenticated;

-- 訪客對這三張表一律無權限。訪客只讀 002 建立的兩個 view。

-- authenticated 拿得到 grant，但實際可見的列由上面的 policy 決定。
-- 例如 rooms 的 select grant 給了 authenticated，但 rooms_select policy
-- 限定 is_admin(id)，因此非管理員查 rooms 回傳 0 列。
--
-- 沒有 insert：room_members 只由 join-room Edge Function 以 service role 寫入。
-- 沒有 delete：本專案不硬刪除任何使用者資料。
grant select, update on rooms          to authenticated;
grant select, update on room_members   to authenticated;
grant select          on join_attempts to authenticated;

grant execute on function is_active_member(uuid) to anon, authenticated;
grant execute on function is_admin(uuid)         to anon, authenticated;
