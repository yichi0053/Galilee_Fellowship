# ADR 索引

架構決策紀錄。格式為 Context、Decision、Consequences、Status。
**每個 ADR 的 Consequences 段落必須寫出代價，不只寫好處。**

| 編號 | 標題 | 代價摘要 |
|---|---|---|
| [0001](0001-supabase-baas.md) | 採用 Supabase BaaS 而非自建 PHP 後端 | vendor lock-in；RLS 寫錯即資料外洩 |
| [0002](0002-reject-infinityfree.md) | 否決 InfinityFree | 放棄免費 PHP 主機的既有熟悉度 |
| [0003](0003-google-oauth-first.md) | 第一期採 Google OAuth，LINE Login 延後 | 部分成員登入摩擦上升 |
| [0004](0004-room-id-everywhere.md) | Schema 保留 `room_id` 但 UI 僅暴露單一房間 | 每張表多一欄位與 where 條件 |
| [0005](0005-trust-model.md) | 採信任模型，不驗證實名 | 任何取得房間碼者可冒名加入 |
| [0006](0006-posts-public-view.md) | 訪客透過 `posts_public` view 讀取 | 多一層 view 需維護 |
| [0007](0007-reject-free-drag-layout.md) | 否決自由座標拖曳，採依週分區加 masonry | 失去「真實佈告欄」的自由感 |
| [0008](0008-plaintext-join-code.md) | 房間碼明文儲存，僅管理員可讀 | 資料庫被讀取時房間碼直接外洩 |
| [0009](0009-soft-delete-30-days.md) | 軟刪除加 30 天硬刪除 | 需排程機制；30 天後誤刪無救 |
| [0010](0010-quota-refund-window.md) | 10 分鐘配額回補期 | 需額外欄位與 UI 倒數提示 |
| [0011](0011-top-nav-and-fab.md) | 一律頂部導覽列，發文按鈕採 FAB | 只有週次 bar 釘頂，捲動時看不到導覽連結 |
| [0012](0012-supabase-cli-not-xampp.md) | 本機開發採 Supabase CLI 而非 XAMPP | 需安裝 Docker |
| [0013](0013-phased-feature-release.md) | 分期釋出功能作為維持參與度的手段 | 使用者需經歷多次新功能說明 |
| [0014](0014-single-admin.md) | 單一管理員 | 單點失效，需開發者作為復原路徑 |
| [0015](0015-quota-3-per-week.md) | 每人每週 1 主題加 2 自由，合計 3 篇 | 儲存餘裕由三分之二降至一半 |
| [0016](0016-frontend-stack.md) | 前端採 Vite + TypeScript + 原生 DOM | masonry/下拉選單/表單狀態全部自寫 |
| [0017](0017-no-docker-local-dev.md) | 開發機無 Docker，改用第二個 cloud project | 無法離線開發；pgTAP 不可用 |
| [0018](0018-single-project-promoted-to-production.md) | 現有 Supabase 專案直接轉正，不另開正式專案 | 沒有可以弄壞的環境；verify:rls 停用 |
| [0019](0019-title-and-body.md) | 貼文拆成標題與內文，牆頁只顯示標題 | 牆上讀不到內文，需逐則點入 |
| [0020](0020-thumbnail-crop.md) | 上傳時可拖曳決定縮圖範圍，原圖完整保留 | 發文多一步；牆上與貼文頁構圖不同 |
| [0021](0021-delete-window.md) | 自行刪除改為 20 分鐘內限定，逾期不可刪 | 逾期後只能請管理員下架，繼承單點失效 |
| [0022](0022-member-profile.md) | 成員個人檔案，profile 從第三期提前 | 改名會改動既有貼文署名；room_members 權限須收窄 |
