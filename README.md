# 團契照片牆系統

約 24 人的團契線上共享空間，成員以實名上傳圖文貼文，配合每週主題，為期一學期（18 週）。

- **架構書 2.0** 為唯一有效規格，本 repo 的註解以 `§` 引用其章節。
- **[CONTEXT.md](CONTEXT.md)** — 共享語言與架構不變條件。改動程式前先讀。
- **[docs/SETUP.md](docs/SETUP.md)** — 人工前置步驟（Supabase、Google OAuth、Cloudflare Pages）。
- **[docs/OPERATIONS.md](docs/OPERATIONS.md)** — 維運與復原路徑。
- **[docs/adr/](docs/adr/README.md)** — 23 則架構決策紀錄。

## 快速開始

```bash
npm install
cp .env.example .env     # 依 docs/SETUP.md 填入值
npm run dev
```

## 指令

| 指令 | 用途 |
|---|---|
| `npm run dev` | Vite 開發伺服器 |
| `npm run build` | typecheck 後打包至 `dist/` |
| `npm run lint` | ESLint，含架構邊界規則 |
| `npm run typecheck` | 瀏覽器程式碼與 node 程式碼各一次 |
| `npm test` | 單元測試 |
| `npm run verify:rls` | §15.3 RLS 驗證清單（需 dev 專案）|
| `npm run db:types` | 從雲端專案重新產生 `src/db/types.ts`，**每次跑完 migration 都要跑** |
| `bash scripts/check-architecture-guard.sh` | 驗證架構護欄本身有效 |

## 技術棧

Vite + TypeScript + 原生 DOM（[ADR-0016](docs/adr/0016-frontend-stack.md)），
Supabase 免費方案（[ADR-0001](docs/adr/0001-supabase-baas.md)），部署於 Cloudflare Pages。

## 架構

相依方向單向，由 `eslint.config.js` 強制，違反時建置失敗：

```
ui  →  modules  →  db
              ↘  domain  ↙        （shared kernel，純葉節點）
```

```
src/
  domain/     週界等共享語言的基礎詞彙，純型別與純函式
  db/         唯一持有 supabase client 的地方；UI 禁止 import
  modules/    media quota themes posts membership auth admin profile
  ui/         components / pages
  config/     功能開關與業務常數
supabase/
  migrations/ 一功能一檔，只增不改；RLS policy 與其保護的表寫在同一檔
  tests/      RLS 驗證清單
  functions/  Edge Functions（房間碼驗證與 rate limit）
```

每個 module 只以 `index.ts` 對外。詳見 [CONTEXT.md](CONTEXT.md) 與
[ADR-0016](docs/adr/0016-frontend-stack.md)。

## 1.0（2026-08-28）

上線中：<https://galilee-fellowship.pages.dev>

第一期的功能全部完成並部署。資料庫、前端、排程三者對齊。

| 面向 | 現況 |
|---|---|
| 頁面 | 9 個入口：`/`、`/wall`、`/join`、`/post/new`、`/post/:id`、`/member/me`、`/member/me/edit`、`/members`、`/admin` |
| 資料層 | migration 001 至 013 全部套用於正式專案，RLS 與欄位層級權限逐項驗證 |
| 排程 | Keepalive（每兩天）與 Cleanup（每月 1 日）皆為綠燈 |
| 測試 | 232 項；程式 5,929 行、測試 2,634 行 |
| 決策紀錄 | 23 則 ADR |

### 1.0 的功能

- **牆**：依週分區的 masonry，一次顯示一週，週次選擇器釘在頂端
- **貼文**：標題加選填內文、上傳時可拖曳決定縮圖範圍、20 分鐘內可自行刪除
- **成員**：Google 登入加房間碼、個人檔案（生日／興趣／經節）、成員列表
- **管理**：房間設定、18 週主題預排、成員停權與退出、下架與復原、30 天清理

### 不在 1.0 裡（ADR-0013 的後續分期）

`memberFilter`、`randomThrowback`、`profile` 之外的第三期以後功能，
以及**貼文編輯**（ADR-0019：現階段的替代路徑是 20 分鐘內刪掉重發）。

### 已知的取捨

- **單一管理員**是已知的單點失效，復原路徑寫在 [OPERATIONS.md](docs/OPERATIONS.md)（ADR-0014）
- **`verify:rls` 目前停用**：正式專案只有一個，護欄擋住那支會建立測試帳號的腳本。
  下次動 schema 前應補開一個 dev 專案（ADR-0018）
- **成員列表沒有人臉**：Google 頭像只有本人的 session 拿得到（ADR-0023）
- 逾期後成員無法自行刪除貼文，只能請管理員下架（ADR-0021）
