# RLS 驗證

§15.3 的驗證清單由 **[`scripts/verify-rls.ts`](../../scripts/verify-rls.ts)** 執行：

```bash
npm run verify:rls
```

## 為什麼不是 pgTAP

架構書 §15.3 建議 `supabase test db` 搭配 pgTAP，但那需要 Docker 起本機 Postgres，
而開發機未安裝 Docker（[ADR-0017](../../docs/adr/0017-no-docker-local-dev.md)）。
替代做法是以不同身分的 JWT 直接打 PostgREST，涵蓋條目相同。

**兩者的差異**：REST 路徑測不到「直接以 SQL 連線存取」的情境。
這對本專案可接受——前端只能走 PostgREST，而能直連資料庫的人已經持有
service role 或資料庫密碼，RLS 對他們本來就不設防。

日後若安裝 Docker，這裡改放 `rls.test.sql`，並把 ADR-0017 標記為
Superseded by ADR-0012。

## 執行前提

- 指向 **dev 專案**。腳本會建立五個測試帳號與三則貼文，結束時刪除。
- `.env` 需有 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_ANON_KEY`。
- migration 001 至 004 與 `seed.sql` 已套用（腳本依賴 seed 建立的房間 id）。

## 這份清單的份量

RLS policy 寫錯的失敗模式是**安靜的**：不拋錯誤，只回傳不該回傳的資料。
牆上是 24 個人的實名與臉部照片。**未全綠不得進入下一階段**（§11.1、§16）。
