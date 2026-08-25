# ADR-0001：採用 Supabase BaaS 而非自建 PHP 後端

**Status**: Accepted

## Context

專案須在兩週內上線，預算 10 至 20 小時。自建後端需處理認證、檔案上傳、權限、部署與維運，估計 80 至 120 小時。

## Decision

採用 Supabase 免費方案（Postgres、Auth、Storage、RLS、Edge Functions），前端為靜態站台由瀏覽器直接呼叫。全案僅 rate limit 需伺服器端邏輯。

## Consequences

**代價**：
- Vendor lock-in。資料層綁定 Postgres 與 Supabase Auth 的 `auth.users` schema，遷出需重寫認證與 Storage 層。
- 安全邊界完全落在 RLS policy 上。RLS 寫錯即資料外洩，且失敗模式安靜（不拋錯誤，只回傳不該回傳的資料）。此風險以 §15.3 的驗證清單承擔。
- 受制於免費方案額度：500 MB DB、1 GB Storage、5 GB egress、7 天無活動自動暫停。
- anon key 必然外流至瀏覽器，安全性零依賴於 key 的保密。
