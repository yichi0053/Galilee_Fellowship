-- ============================================================================
-- Migration 011：貼文拆成「標題」與「內文」
--
-- 架構書 §9.2 / ADR-0019。規則（§12.6）：已推上雲端的 migration 不得修改，
-- 故新增而非改寫 002。
-- ============================================================================

-- 原本一則貼文只有 body，10 至 100 字，牆頁的卡片直接把它整段印出來。
-- 那讓卡片高度完全取決於文字長度：有人寫 10 字、有人寫 100 字，
-- 兩欄的牆於是高高低低，而且長文字把照片擠得很小——照片牆的主角變成了文字。
--
-- 改成：title 一行顯示在照片下方，body 只在 /post/:id 出現。
-- 卡片高度因此只由照片比例決定，牆面整齊，而想寫長一點的人也有地方寫。

-- ---------------------------------------------------------------- title ---

alter table posts add column title text;

-- 回填既有貼文。body 的舊下限是 10 字，所以 left(body, 20) 必定落在
-- 底下 2 至 20 字的約束內，不會有回填不了的列。
update posts set title = left(body, 20) where title is null;

alter table posts alter column title set not null;

-- 2 字下限擋掉「。」這種等於沒填的標題；20 字上限來自版面：
-- 手機兩欄的卡片寬約 170 px，0.86rem 的字一行約容得下 12 至 14 個中文字，
-- 20 字代表最多換行一次，卡片高度仍然整齊。
alter table posts add constraint posts_title_length
  check (char_length(title) between 2 and 20);

comment on column posts.title is
  '§9.2：牆頁卡片上唯一的文字。2 至 20 字，必填。'
  '上限來自版面而非資料——手機兩欄時 20 字最多換行一次。';

-- ----------------------------------------------------------------- body ---

-- 002 把長度寫成 inline check，PostgreSQL 自動命名為 posts_body_check。
-- 用 if exists 是因為這個名字是推斷來的：萬一實際名稱不同，
-- 這一行安靜跳過、下面的新約束照樣加上，不會讓整支 migration 中斷。
alter table posts drop constraint if exists posts_body_check;

-- 內文改為選填（ADR-0019：只有照片加標題也能發）。
-- 空字串一律以 null 表示：前端送出前會 trim 並轉 null，
-- 兩種「沒有內文」的表示法並存的話，每個讀取端都得同時檢查兩者。
alter table posts alter column body drop not null;

alter table posts add constraint posts_body_length
  check (body is null or char_length(body) between 1 and 300);

comment on column posts.body is
  '§9.2 / ADR-0019：選填的內文，只在 /post/:id 顯示。上限 300 字。'
  '沒有內文時為 null，不是空字串。';

-- --------------------------------------------------------- posts_public ---

-- 訪客看得到標題，否則牆上對他們而言每張卡片都只有一張沒有說明的照片。
-- 標題與內文都由成員自行撰寫、不含姓名，與 §8.6 要保護的成員名單無關。
--
-- 用 create or replace 而非 drop + create：後者會一併丟掉 002 的
-- grant select on posts_public to anon, authenticated，而那正是訪客唯讀的唯一通道。
-- replace 的限制是既有欄位的名稱、型別與**順序**都不可變動，新欄位只能加在最後，
-- 所以 p.title 排在 display_name 之後而不是 body 旁邊。
--
-- 與 002 同理，本 view **不可**設 security_invoker = true：
-- 它必須以 owner 權限執行才能繞過 posts 的 RLS。
create or replace view posts_public as
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
  mask_name(m.display_name) as display_name,
  p.title
from posts p
join room_members m on m.id = p.author_id
where p.deleted_at is null
  and p.hidden_by_admin = false
  and m.status <> 'suspended';   -- §4.3：suspended 隱藏，left 保留顯示

-- ----------------------------------------------------------- 欄位權限 ---

-- 010 收回了 posts 的 UPDATE、只授予 (body, image_path, thumb_path)。
-- title **刻意不加進去**：第一期沒有編輯功能（editPost 已於 §9.5 移除），
-- 沒有任何路徑需要更新它。等真的做編輯時再開一支 migration 一併授予。
