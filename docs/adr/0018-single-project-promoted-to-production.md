# ADR-0018：現有專案直接轉正，不另開正式專案

**Status**: Accepted
**Supersedes**: ADR-0017

## Context

ADR-0017 決定「開發初期只開一個 project，正式 project 在上線前才建立」，
並把切換成本推遲到上線那天。[docs/SETUP.md](../SETUP.md) 第 7 節列出那組切換共十步：
重跑 migration、換房間 uuid、重設 Google provider、部署兩支 Edge Function、
換 keepalive 指向、重新驗 RLS。每一步漏掉的失敗模式都很安靜。

到了這個時間點，該專案已經：migration 001 至 009 全部套用、Google OAuth 實測通過、
兩支 Edge Function 已部署、Storage policy 與 cacheControl 都驗過、
`verify:rls` 41 項全綠。開第二個專案等於把這一切重做一次，
而重做的每一步都有機會出錯，卻沒有任何一步會讓系統變得更好。

## Decision

現有的 Supabase project 直接作為正式環境。不另開正式專案，
[docs/SETUP.md](../SETUP.md) 第 7 節由「切換步驟」改為「轉正檢查清單」。

## Consequences

**代價**：

- **失去可以隨便弄壞的地方。** 此後跑 migration、手改資料、或任何實驗，
  動到的都是 24 個人的真實照片。ADR-0017 底下「隨便摸、隨便重建」的那段話作廢。
- **`scripts/verify-rls.ts` 不可再對它執行**：該腳本會建立與刪除真實的 auth 使用者
  與貼文。`.env` 已設 `SUPABASE_ENV=production`，腳本會拒絕執行並回傳退出碼 2。
  日後要重跑 RLS 驗證，必須另開一個開發專案（免費方案允許 2 個 active project，
  這條路隨時可以補開，只是不能再拿正式專案當實驗場）。
- **`supabase/seed.sql` 不可再執行**：其中的房間碼是 `DEV-ONLY-JOIN-CODE-0000`，
  且會覆寫既有的房間設定。
- **migration 只能往前**：沒有第二個地方可以先試。新的 migration 上線前
  只能靠人眼審閱，`supabase db reset` 這條路本來就因為沒有 Docker 而不存在（ADR-0017）。

**換到的**：

- 免除那十步切換，以及每一步各自的安靜失敗模式。
- 1 GB Storage 與 egress 額度不必與開發專案共用。實測一則貼文 269 KB，
  1296 則上限約 340 MB，餘裕從三分之二變成完整的一個額度。
- 已經驗證過的東西不必重驗一次。
