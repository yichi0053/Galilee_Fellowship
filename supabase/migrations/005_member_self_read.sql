-- ============================================================================
-- Migration 005：成員讀得到自己的 room_members 列
--
-- 架構書 §10.4 的 Viewer 判定。
-- 規則（§12.6）：已推上雲端的 migration 不得修改，故此處新增 policy 而非改寫 001。
-- ============================================================================

-- 001 的 members_select 是 is_active_member(room_id)：只有 active 成員讀得到本表。
-- 後果是 suspended 與 left 的成員查自己的列得到 0 列，
-- 與「orphan（完成 Google 授權但尚未加入）」在前端無從區分——
-- 而這三者的處置完全不同（§4.3、§10.4）：
--   orphan     導向 /join 接續加入流程
--   suspended  貼文一律隱藏
--   left       貼文保留顯示
--
-- permissive policy 之間是 OR 關係，故本 policy 只擴張「看得到自己」這一件事，
-- 不影響 001 的「active 成員看得到同房間所有成員」。
create policy members_select_self on room_members
  for select using (user_id = auth.uid());

comment on policy members_select_self on room_members is
  '§10.4：Viewer 判定需區分 orphan / suspended / left，'
  '而 001 的 members_select 讓後兩者讀不到自己的列。本 policy 只放行自己那一列。';
