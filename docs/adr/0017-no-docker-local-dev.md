# ADR-0017：開發機無 Docker，本機開發改用第二個 cloud project

**Status**: Superseded by ADR-0018

## Context

ADR-0012 決定採 Supabase CLI 本機環境，但該路線需要 Docker，而目前開發機未安裝 Docker。

## Decision

依架構書 §6.3 的替代路線：以雲端 project 取代本機 Supabase CLI 環境。

**開發初期只開一個 project，當開發環境用**；正式 project 在上線前才建立
（免費方案允許 2 個 active project）。理由是初期 schema 還會反覆改，
維護兩套環境的同步成本高於收益，而這段期間也還沒有任何真實資料需要保護。
Migration 檔案結構仍照 CLI 慣例置於 `supabase/migrations/`，日後安裝 Docker 後可直接 `supabase db reset` 而不需搬動任何檔案。

## Consequences

**代價**：
- 無法離線開發。
- 兩個 project 共用同一個 organization 的 1 GB Storage 與 egress 額度。
- 無 `db reset` 一鍵重建，schema 出錯時需手動清理，red-green-refactor 的回饋迴圈變慢。
- `supabase test db`（pgTAP）不可用，§15.3 的 RLS 驗證清單改以 `scripts/verify-rls.ts` 帶不同 JWT 打 REST API 執行。兩者涵蓋的條目相同，但 REST 路徑無法測到直接 SQL 存取的情境。
- 開發用 project 同樣受 7 天無活動自動暫停影響。

- **「先開一個」把成本推遲到上線那天**：屆時要重跑 migration、換房間 uuid、
  重設 Google provider、換 keepalive 指向的專案。任何一項漏掉的失敗模式都很安靜。
  完整切換清單見 `docs/SETUP.md` 第 7 節，上線前逐條打勾。

**2026-08-27 補充**：Supabase CLI v1 的 `functions deploy` 以 Docker 打包，在本 ADR 的前提下
不可用。CLI **v2** 改走 Management API，不需 Docker（僅印出一行 Docker 未執行的警告）。
故 `package.json` 的 devDependency 已升至 `supabase@^2`，**不可退回 v1**，
否則部署會再次卡在 Docker。

（`gen types` 不受影響：v1 與 v2 的 `--project-id` 路徑都打雲端，本來就不需 Docker。
真正需要 Docker 的是 `--local`，而 `npm run db:types` 原本錯用了它，已改為
`scripts/gen-types.sh`。）

**2026-08-27 起由 ADR-0018 取代**：不再開第二個專案，現有專案直接轉正。
本 ADR 中「隨便摸、隨便重建」與「兩個 project 共用額度」等敘述已不適用；
「無 Docker，故 db reset 與 pgTAP 不可用」的部分仍然成立。
