# ADR-0016：前端採 Vite + TypeScript + 原生 DOM，不使用 UI 框架

**Status**: Accepted

## Context

架構書指定前端為靜態網站與 TypeScript，但未指定 UI 框架。候選為原生 DOM、React、SvelteKit。

## Decision

採 Vite + TypeScript，多頁應用（MPA）架構，不引入 UI 框架。每個頁面一個 HTML 入口，乾淨網址由 Cloudflare Pages 的 `_redirects` 處理。

## Consequences

**代價**：
- masonry、lightbox、捲動收合、表單狀態管理全部要自己寫，沒有現成套件可用。這是本決策最主要的成本。
- 無宣告式渲染，DOM 更新為手動操作，複雜畫面（管理後台四分頁）容易寫出難維護的程式碼。
- 第四至六期的破冰互動功能若需要複雜狀態管理，屆時可能後悔。

理由：
- Egress 為硬限制（5 GB），bundle 大小直接影響額度消耗。
- 工時已超支（21.5 小時 vs 預算 20 小時），框架的設定與學習成本無處吸收。
- §12 的 module 分層與 UI 框架無關，日後抽換 `src/ui/` 不影響 `src/modules/`。
