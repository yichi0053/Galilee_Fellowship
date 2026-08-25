# ADR-0002：否決 InfinityFree

**Status**: Accepted

## Context

曾考慮以 InfinityFree 免費 PHP 主機自建後端，開發者對 PHP 較熟悉。

## Decision

否決。改採 ADR-0001 的 Supabase 路線。

## Consequences

**代價**：放棄開發者既有的 PHP 熟悉度，須學習 Postgres RLS 與 Supabase 工作流。

否決理由：
- 資料庫 50 MB 硬上限，本專案估計需 518 MB Storage。
- 對外 API 連線的 DNS 解析不穩定，將導致 OAuth token exchange 隨機失效。
- Cloudflare bot 偵測會對部分訪客顯示挑戰頁，免費方案無法關閉。
- 服務條款通常禁止以圖片儲存為主要用途。
- 採此路線等於回到全自建，工時 80 至 120 小時，與兩週上線直接衝突。
