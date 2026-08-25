-- ============================================================================
-- Migration 002：themes、posts、輔助函式、posts_public、rooms_public
--
-- 架構書 §7.2 至 §7.4、§8.1。
-- ============================================================================

-- ------------------------------------------------------------ 輔助函式 ----

-- §7.3：週界為台灣時間（Asia/Taipei）週一 00:00。
-- date_trunc('week', ...) 在 Postgres 中以週一為週首，與規格一致。
create or replace function current_week_start()
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select date_trunc('week', now() at time zone 'Asia/Taipei')::date;
$$;

-- §7.4：陳小明 → 陳小O
create or replace function mask_name(n text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when char_length(n) <= 1 then n
    when char_length(n) = 2  then left(n, 1) || 'O'
    else left(n, 2) || repeat('O', char_length(n) - 2)
  end;
$$;

-- ---------------------------------------------------------------- 資料表 ----

create table themes (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references rooms(id) on delete cascade,
  week_start_date  date not null,
  title            text not null,
  description      text,
  created_at       timestamptz not null default now(),
  unique (room_id, week_start_date)
);

comment on table themes is
  '§9.6：管理員可預排多週。忘記設定的那一週會出現空窗，'
  '而空窗週的發文量通常斷崖下滑，故預排為必要功能而非便利功能。';

create type post_type as enum ('theme', 'free');

create table posts (
  id                    uuid primary key default gen_random_uuid(),
  room_id               uuid not null references rooms(id) on delete cascade,
  author_id             uuid not null references room_members(id) on delete cascade,
  type                  post_type not null,
  theme_id              uuid references themes(id),
  image_path            text not null,
  thumb_path            text not null,
  body                  text not null check (char_length(body) between 10 and 100),
  rotation_deg          smallint not null default 0 check (rotation_deg between -3 and 3),
  week_start_date       date not null,
  counts_toward_quota   boolean not null default true,
  hidden_by_admin       boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,

  -- 主題貼文必須指向主題，自由貼文必須不指向。
  -- 少了這條，配額分類與實際內容可能不一致而無人察覺。
  constraint theme_post_has_theme check ((type = 'theme') = (theme_id is not null))
);

comment on column posts.counts_toward_quota is
  'ADR-0010：回補期內刪除設為 false，配額回補。'
  'UI 層完全不知道此欄位存在——編排在 modules/posts 內部（§12.5）。';

comment on column posts.week_start_date is
  '§7.3：雖可由 created_at 推導，仍存為獨立欄位以簡化依週分區的查詢與索引。'
  '過期主題不可補發，貼文一律歸屬於發布當下的週次（§9.6）。';

-- §7.2 指定的兩個索引
create index posts_room_week_idx on posts (room_id, week_start_date desc);
create index posts_author_idx    on posts (author_id);

-- 配額查詢（§9.1 的五個條件）。部分索引只涵蓋實際會被計數的列。
create index posts_quota_idx
  on posts (author_id, week_start_date, type)
  where counts_toward_quota and deleted_at is null;

-- 30 天清理任務的掃描對象（ADR-0009）
create index posts_deleted_at_idx on posts (deleted_at) where deleted_at is not null;

-- updated_at 自動維護
create or replace function touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger posts_touch_updated_at
  before update on posts
  for each row execute function touch_updated_at();

-- ------------------------------------------------------------------ RLS ----

alter table themes enable row level security;
alter table posts  enable row level security;

create policy themes_select on themes
  for select using (is_active_member(room_id));

create policy themes_all on themes
  for all using (is_admin(room_id)) with check (is_admin(room_id));

create policy posts_select on posts
  for select using (is_active_member(room_id));

create policy posts_insert on posts
  for insert with check (
    is_active_member(room_id)
    and author_id in (
      select id from room_members
      where room_id = posts.room_id and user_id = auth.uid()
    )
  );

-- WITH CHECK 不可省略。只寫 USING 的話，作者可以把 author_id 或 room_id
-- 改成別人的值——通過了「你能改這一列」的檢查，卻沒人檢查「改完是否還合法」。
create policy posts_update on posts
  for update using (
    author_id in (
      select id from room_members
      where room_id = posts.room_id and user_id = auth.uid()
    )
    or is_admin(room_id)
  ) with check (
    author_id in (
      select id from room_members
      where room_id = posts.room_id and user_id = auth.uid()
    )
    or is_admin(room_id)
  );

-- 刻意沒有 DELETE policy：刪除一律為軟刪除（UPDATE deleted_at），
-- 硬刪除只由 004 的清理函式以 definer 權限執行。

-- ----------------------------------------------------------------- Views ----
--
-- ADR-0006。這兩個 view **不可**設 security_invoker = true。
-- 它們必須以 owner 權限執行才能繞過底層表的 RLS——這正是訪客唯讀的機制。
-- 設反了的失敗模式是訪客看到空白牆且無任何錯誤訊息。

create view posts_public as
select
  p.id,
  p.room_id,
  p.type,
  p.theme_id,
  p.thumb_path,
  p.image_path,
  p.body,
  p.rotation_deg,
  p.week_start_date,
  p.created_at,
  mask_name(m.display_name) as display_name
from posts p
join room_members m on m.id = p.author_id
where p.deleted_at is null
  and p.hidden_by_admin = false
  and m.status <> 'suspended';   -- §4.3：suspended 隱藏，left 保留顯示

comment on view posts_public is
  'ADR-0006：訪客瀏覽功能的安全核心。anon 僅可讀取此 view，'
  '不可直接讀取 posts 或 room_members。若讓 anon 直接讀 posts，'
  '實名資料會透過 REST API 完整外洩，前端遮蔽無效。';

create view rooms_public as
  select id, name, description, background_image_url, join_open
  from rooms;

comment on view rooms_public is
  'ADR-0008：存在的唯一理由是不暴露 join_code。';

-- --------------------------------------------------------------- Grants ----

-- 同 001：先收回 Supabase default privileges 自動授予的權限，再逐項授予。
revoke all on themes, posts from anon, authenticated;

-- themes 的 delete 是給管理員用的（themes_all policy 涵蓋 delete）。
grant select, insert, update, delete on themes to authenticated;

-- posts 刻意沒有 delete：刪除一律為軟刪除（UPDATE deleted_at）。
-- 這一行少了 delete，等於在 grant 層再擋一次硬刪除，與缺少 DELETE policy 互為備援。
grant select, insert, update on posts to authenticated;

-- 訪客與成員都經由 view 讀取公開資料
grant select on posts_public to anon, authenticated;
grant select on rooms_public to anon, authenticated;

grant execute on function current_week_start() to anon, authenticated;
grant execute on function mask_name(text)      to anon, authenticated;
