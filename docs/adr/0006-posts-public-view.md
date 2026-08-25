# ADR-0006：訪客透過 posts_public view 讀取

**Status**: Accepted

## Context

訪客需能瀏覽照片牆但只看到遮蔽姓名。若讓 anon role 直接讀 `posts` 表並於前端遮蔽，實名資料會透過 REST API 完整外洩。

## Decision

建立 `posts_public` view，於資料庫層 join `room_members` 並套用 `mask_name()`。anon role 僅可讀取此 view，撤銷其對 `posts` 與 `room_members` 的所有權限。同樣以 `rooms_public` 隱藏 `join_code`。

## Consequences

**代價**：
- 多一層 view 需維護。`posts` 加欄位時 view 需同步更新，容易遺漏。
- View 必須以 owner 權限執行（**不可**設 `security_invoker = true`）才能繞過底層表的 RLS。此設定寫反的失敗模式是訪客看到空白牆且無錯誤訊息。
- 訪客與成員走兩條不同的讀取路徑，前端需分支，測試面積加倍。
