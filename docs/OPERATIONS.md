# 維運文件

架構書 §4.2 / ADR-0014 要求的復原路徑。**單一管理員是已知的單點失效**，
本文即為該風險的唯一補償控制。半年後你會忘記這些步驟，所以寫在這裡。

---

## 1. 管理員失效時，手動指派新管理員

前提：你（開發者）保有 Supabase 專案的登入權限。

1. 登入 https://supabase.com/dashboard → 選擇本專案 → 左側 **SQL Editor**
2. 先確認房間 id 與現有成員：

```sql
select id, name, join_open from rooms;

select m.id, m.display_name, m.role, m.status, u.email
from room_members m
join auth.users u on u.id = m.user_id
order by m.joined_at;
```

3. 將某位成員升為管理員（把 `<member_id>` 換成上一步查到的 `room_members.id`）：

```sql
update room_members
set role = 'admin', status = 'active'
where id = '<member_id>';
```

4. 若要同時卸除舊管理員：

```sql
update room_members set role = 'member' where id = '<old_admin_member_id>';
```

> SQL Editor 以 service role 執行，會繞過所有 RLS，因此上述語句必定成功。
> 這也是為什麼專案的 service_role key 絕對不可進入前端 bundle。

---

## 2. 查詢或更換房間碼

```sql
-- 查看目前房間碼（ADR-0008：明文儲存）
select join_code, join_open from rooms;

-- 更換房間碼，舊碼立即失效
update rooms set join_code = '<新的房間碼，至少 12 字元>' where id = '<room_id>';

-- 24 人到齊後關閉加入（§8.4，成本最低而效果最好的防護）
update rooms set join_open = false where id = '<room_id>';
```

---

## 3. 防自動暫停

免費方案連續 **7 天無資料庫請求**即自動暫停。暫停後成員開啟網站看到錯誤頁，活動即結束。

本 repo 以 `.github/workflows/keepalive.yml` 每兩天呼叫一次 `rooms_public` 端點。

**須定期確認**：GitHub → Actions → Keepalive → 最近一次執行為綠色。
期中考週與連假是最容易同時發生「沒人發文」與「沒人注意到 workflow 壞掉」的時期。

備援：另外設一個 UptimeRobot monitor 指向同一個端點，間隔 12 小時。

若 GitHub repo 為 private 且超出免費 Actions 額度，workflow 會安靜停止執行——
這是本項最可能的失效方式。

---

## 4. 手動觸發 30 天清理

**不要用 SQL。** `cleanup_deleted_posts()` 這支函式已由 migration 009 移除
（`drop function if exists`），現在執行只會得到「function does not exist」。

它被移除的原因是它從來沒有成功執行過：Supabase 禁止以 SQL 直接刪
`storage.objects`，所以那支函式刪得掉資料列、刪不掉照片，而照片才是重點
（ADR-0009）。唯一可行的路徑是以 service role 呼叫 Storage API，
那必須在 Edge Function 裡做。

現行的兩條路徑，兩者都是呼叫同一支 `cleanup-posts` Edge Function：

1. **後台**：`/admin` → 貼文管理 → 「執行清理」。日常用這個。
2. **GitHub Actions**：Actions → `Cleanup deleted posts` → Run workflow。
   排程每月 1 日自動跑一次；手動觸發用於確認 secrets 仍然有效。

兩者皆為冪等，只移除已滿 30 天的軟刪除貼文，可重複執行。

執行後請確認 Storage 中無孤兒檔案：

```sql
-- 列出 Storage 中沒有對應 posts 資料列的物件
select o.name
from storage.objects o
where o.bucket_id = 'post-images'
  and not exists (
    select 1 from posts p
    where p.image_path = o.name or p.thumb_path = o.name
  );
```

---

## 5. 額度巡檢

Dashboard → Settings → Usage。每四週看一次：

| 項目 | 額度 | 觸頂的徵兆與對策 |
|---|---|---|
| Storage | 1 GB / organization | 逼近 700 MB 時把縮圖從 250 px 降到 200 px，並執行清理 |
| Egress | 5 GB + 5 GB cached | 先確認 Storage 的 cache-control 有生效，再檢查是否有人繞過依週載入 |
| Database | 500 MB | 本專案只存 metadata，不太可能觸頂 |

Egress 會比 Storage 更早觸頂（§9.4）。
