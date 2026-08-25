# ADR-0017：開發機無 Docker，本機開發改用第二個 cloud project

**Status**: Accepted

## Context

ADR-0012 決定採 Supabase CLI 本機環境，但該路線需要 Docker，而目前開發機未安裝 Docker。

## Decision

依架構書 §6.3 的替代路線：使用免費方案允許的第二個 active project 作為開發環境。
Migration 檔案結構仍照 CLI 慣例置於 `supabase/migrations/`，日後安裝 Docker 後可直接 `supabase db reset` 而不需搬動任何檔案。

## Consequences

**代價**：
- 無法離線開發。
- 兩個 project 共用同一個 organization 的 1 GB Storage 與 egress 額度。
- 無 `db reset` 一鍵重建，schema 出錯時需手動清理，red-green-refactor 的回饋迴圈變慢。
- `supabase test db`（pgTAP）不可用，§15.3 的 RLS 驗證清單改以 `scripts/verify-rls.ts` 帶不同 JWT 打 REST API 執行。兩者涵蓋的條目相同，但 REST 路徑無法測到直接 SQL 存取的情境。
- 開發用 project 同樣受 7 天無活動自動暫停影響。

**若日後安裝 Docker，本 ADR 應標記為 Superseded by ADR-0012。**
