# CONTEXT — 團契照片牆系統

本檔為架構書 §3「領域語彙」的 repo 內副本，供人與 AI coding agent 共同讀取（§13.2）。

## 共享語言規則

程式中的變數、函式、資料表欄位一律使用下表的英文詞。
**同一概念不得出現同義詞**（不可混用 `post` 與 `entry`、`member` 與 `user`）。

| 詞彙 | 英文 | 定義 |
|---|---|---|
| 房間 | room | 一個獨立的照片牆空間。第一期只有一個 |
| 房間碼 | join code | 加入房間的准入字串，管理員自訂，明文儲存 |
| 成員 | member | `room_members` 中 `status = 'active'` 的使用者 |
| 訪客 | guest | 未登入，或已登入但不在 `room_members` 中 |
| 孤兒帳號 | orphan account | 完成 Google 授權但未加入任何房間的 auth user |
| 標題 | title | 貼文的一行標題，2 至 20 字，必填。牆頁卡片上唯一的文字 |
| 內文 | body | 貼文的長文，至多 300 字，選填。只在 `/post/:id` 顯示，沒有時為 `null` |
| 主題貼文 | theme post | `type = 'theme'`，每人每週上限 1 篇 |
| 自由貼文 | free post | `type = 'free'`，每人每週上限 2 篇 |
| 週界 | week boundary | 台灣時間（`Asia/Taipei`）週一 00:00 |
| 配額 | quota | 每人每週 1 主題加 2 自由 |
| 回補期 | refund window | 發布後 10 分鐘內刪除可回補配額 |
| 遮蔽姓名 | masked name | 訪客所見的姓名形式，例如「陳小O」 |
| 軟刪除 | soft delete | 作者刪除，設 `deleted_at`，30 天後硬刪除 |
| 下架 | hidden | 管理員隱藏，設 `hidden_by_admin` |
| 停權 | suspended | 管理員停權成員，其貼文一律隱藏 |
| 退出 | left | 成員自願退出，其貼文保留顯示 |

## 架構不變條件

相依方向單向，無循環（§12.3），由 `eslint.config.js` 強制：

```
ui  →  modules  →  db

posts       →  quota, media, themes
membership  →  auth
admin       →  membership, posts, themes
```

1. 每個 module 只以 `index.ts` 對外，同目錄下其他檔案為 internal。
2. UI 層禁止 import `db/`。
3. DB row 型別不得跨出 module；每個 module 在 `index.ts` 轉換為自己的 domain type。
4. Module 之間只傳 domain type。

## 容易寫反的地方

- `suspended` 的貼文**一律隱藏**；`left` 的貼文**保留顯示**（§4.3）。
- `posts_public` 與 `rooms_public` 兩個 view **不可**設 `security_invoker = true`，
  它們必須以 owner 權限執行才能繞過底層表的 RLS——這正是訪客唯讀的機制。
- 週界為 `Asia/Taipei` 週一 00:00，不是 UTC。
- `body` 是**可為 null** 的（ADR-0019）。讀取端的 null 守衛不可把 `body === null`
  當成壞資料整列跳過——那會讓沒寫內文的貼文從訪客的牆上整個消失。該檢查的是 `title`。
