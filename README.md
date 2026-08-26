# 團契照片牆系統

約 24 人的團契線上共享空間，成員以實名上傳圖文貼文，配合每週主題，為期一學期（18 週）。

- **架構書 2.0** 為唯一有效規格，本 repo 的註解以 `§` 引用其章節。
- **[CONTEXT.md](CONTEXT.md)** — 共享語言與架構不變條件。改動程式前先讀。
- **[docs/SETUP.md](docs/SETUP.md)** — 人工前置步驟（Supabase、Google OAuth、Cloudflare Pages）。
- **[docs/OPERATIONS.md](docs/OPERATIONS.md)** — 維運與復原路徑。
- **[docs/adr/](docs/adr/README.md)** — 17 則架構決策紀錄。

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
| `npm run dev:mock` | 以假資料啟動，**不需 Supabase 專案**，可直接看牆頁 |
| `npm run build` | typecheck 後打包至 `dist/` |
| `npm run lint` | ESLint，含架構邊界規則 |
| `npm run typecheck` | 瀏覽器程式碼與 node 程式碼各一次 |
| `npm test` | 單元測試 |
| `npm run verify:rls` | §15.3 RLS 驗證清單（需 dev 專案）|
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
  modules/    media quota themes posts membership auth admin
  ui/         components / pages
  config/     功能開關與業務常數
supabase/
  migrations/ 一功能一檔，只增不改；RLS policy 與其保護的表寫在同一檔
  tests/      RLS 驗證清單
  functions/  Edge Functions（房間碼驗證與 rate limit）
```

每個 module 只以 `index.ts` 對外。詳見 [CONTEXT.md](CONTEXT.md) 與
[ADR-0016](docs/adr/0016-frontend-stack.md)。

## 目前進度

| 階段 | 工單 | 狀態 |
|---|---|---|
| 一 骨架與制度 | T-01 | ✅ 完成（外部服務申請待人工執行，見 SETUP.md） |
| 二 資料層與 RLS | T-02、T-03 | 🟡 migration 已寫，**尚未於任何資料庫執行過** |
| 三 Tracer bullet | T-04、T-07 | 🟡 Edge Function 已寫，串接待 Supabase 專案 |
| 四 深模組補完 | T-05、T-06 | ✅ 純邏輯完成，47 項測試全過 |
| 五 牆頁與其餘頁面 | T-08 至 T-13 | 🟡 牆頁視覺完成（`npm run dev:mock` 可看）；其餘頁面待做 |
