# 專案建置規格書

**團契照片牆系統（Galilee Fellowship Wall）v1.0**
最後更新：2026-08-28

---

## 1. 文件目的

本文記錄本專案從零建置至上線的完整流程，涵蓋四個外部服務的設定、
所有環境變數與密鑰的用途與存放位置、資料庫遷移的套用順序，
以及各步驟之間的相依關係。

適用情境有二：

1. 於全新環境重建本系統（例如換一個 Supabase 專案或另建測試環境）。
2. 半年後回頭理解「這個設定為什麼是這樣」。

與其他文件的分工：

| 文件 | 內容 |
|---|---|
| 本文 | 建置流程、參數、相依順序 |
| [SETUP.md](SETUP.md) | 首次建置時的逐步操作手冊，含各服務介面的實際點選路徑 |
| [OPERATIONS.md](OPERATIONS.md) | 上線後的維運與復原路徑 |
| [adr/](adr/README.md) | 23 則架構決策紀錄，每則載明代價 |
| [../CONTEXT.md](../CONTEXT.md) | 共享語彙與架構不變條件 |

---

## 2. 系統概述

| 項目 | 內容 |
|---|---|
| 用途 | 約 24 人團契的線上照片牆，一學期 18 週 |
| 前端 | Vite + TypeScript + 原生 DOM，多頁應用（MPA），9 個 HTML 入口 |
| 後端 | Supabase 免費方案（PostgreSQL、Auth、Storage、Edge Functions） |
| 部署 | Cloudflare Pages，接 GitHub 自動建置 |
| 排程 | GitHub Actions（keepalive 與清理） |
| 身分驗證 | Google OAuth（僅 basic scopes） |

### 2.1 設計上的關鍵限制

以下三項限制決定了大量技術取捨，重建時必須一併理解：

1. **Supabase 免費方案的 egress 為 5 GB／月**，較 1 GB 的 Storage 額度更早觸頂。
   因此縮圖長邊限制 250 px、主圖 1600 px、Storage 的 `Cache-Control` 設為一年、
   縮圖採 lazy load、不載入中文網頁字型。
2. **免費方案連續 7 天無資料庫請求即自動暫停**，暫停後成員只會看到錯誤頁。
   因此 keepalive 排程為必要元件而非選配。
3. **開發機無 Docker**（ADR-0017），無法使用 `supabase start`、`supabase db reset`
   等本機功能。所有遷移必須由人工貼入 Supabase 主控台的 SQL Editor 執行。

---

## 3. 前置需求

### 3.1 帳號

| 服務 | 用途 | 方案 |
|---|---|---|
| Supabase | 資料庫、Auth、Storage、Edge Functions | Free |
| Google Cloud | OAuth 用戶端 | 免費 |
| Cloudflare | Pages 靜態託管 | Free |
| GitHub | 版本控制與排程 | Free（公開儲存庫的 Actions 用量無上限） |

### 3.2 本機環境

| 需求 | 版本 | 備註 |
|---|---|---|
| Node.js | 22 以上 | Cloudflare Pages 端以 `NODE_VERSION` 環境變數指定 |
| npm | 隨 Node.js | — |
| Git | 任意 | — |
| Docker | **不需要** | 見 ADR-0017 |

---

## 4. 建置順序與相依關係

各階段存在硬性先後順序，顛倒將導致無法完成或需回頭重做：

```
階段 1  Supabase 專案建立
          │  產出 project ref、Project URL、anon key、service_role key
          ▼
階段 2  Google OAuth 用戶端
          │  redirect URI 需填入 <ref>.supabase.co，故須先有階段 1
          ▼
階段 3  本機環境與 .env
          │  需要階段 1 的三個值
          ▼
階段 4  資料庫遷移（001 至 013）與種子資料
          │  產出房間 uuid，為階段 5、6 所需
          ▼
階段 5  Edge Functions 部署與 secrets
          │  ROOM_ID 來自階段 4
          ▼
階段 6  Cloudflare Pages 專案
          │  產出正式網址，為階段 7 所需
          ▼
階段 7  Supabase Auth 的 URL Configuration
          │  需要階段 6 的正式網址
          ▼
階段 8  GitHub repository secrets 與排程啟用
```

**兩個最常見的順序錯誤：**

- 於階段 6 之前設定 Supabase 的 Site URL——該網址在 Cloudflare Pages
  專案建立之前並不存在。
- 部署前端後才套用資料庫遷移——前端會查詢尚未存在的欄位，導致整頁失效。
  **一律先套用遷移，再部署前端。**

---

## 5. 階段一：Supabase 專案

### 5.1 建立專案

1. 於 <https://supabase.com/dashboard> 建立新專案。
2. **Region** 選擇 `Northeast Asia (Tokyo)` 或 `Southeast Asia (Singapore)`，
   兩者對台灣的延遲最低。
3. 設定資料庫密碼並存入密碼管理器。遺失須重設整個資料庫密碼。

### 5.2 取得憑證

於 **Settings → API** 取得三個值：

| 主控台欄位 | 用途 | 存放位置 |
|---|---|---|
| Project URL | 前端與腳本的 API 端點 | `.env`、Cloudflare、GitHub |
| `anon` `public` key | 前端使用，安全性完全依賴 RLS | 同上 |
| `service_role` `secret` key | 繞過所有 RLS | **僅** `.env` 與 Edge Function |

專案網址中的子網域即 **project ref**（形如 `abcdefghijkl`），後續多處會用到。

> **`service_role` key 絕不可加上 `VITE_` 前綴。** Vite 會在建置時將所有
> `VITE_` 開頭的變數字面替換進 JavaScript 產物並送至瀏覽器；一旦誤設，
> 等同公開發布整個資料庫的讀寫權限。

### 5.3 專案數量的取捨

本專案僅使用單一 Supabase 專案，並於上線時將其直接轉為正式環境（ADR-0018）。
其代價是 `npm run verify:rls`（50 餘項 RLS 迴歸驗證）無法執行——
該腳本會建立與刪除真實的 auth 使用者，故 `.env` 中的 `SUPABASE_ENV=production`
會使其拒絕執行並回傳退出碼 2。

免費方案允許 2 個 active 專案。**下次變更 schema 之前應補建開發專案**，
屆時將 `.env` 指向該專案並移除 `SUPABASE_ENV` 即可恢復驗證能力。

---

## 6. 階段二：Google OAuth 用戶端

Google Cloud Console 現已改版為 **Google Auth Platform**，設定分為
Branding、Audience、Data Access、Clients 四個分頁。

### 6.1 Branding

僅填寫三欄，其餘留空：

| 欄位 | 值 |
|---|---|
| App name | 顯示於 Google 登入畫面的應用程式名稱 |
| User support email | 管理者信箱 |
| Developer contact information | 管理者信箱 |
| App logo | **留空**。顯示 logo 須先完成品牌驗證 |
| App domain（三個連結） | **留空**。填寫後將連帶要求 Authorized domains |
| Authorized domains | **留空**。redirect 位於 `supabase.co`，無法驗證網域擁有權 |

### 6.2 Audience

User type 選 **External**，發布狀態維持 **Testing**，**Test users 不需新增**。

> 此頁會顯示「OAuth configuration is incomplete」錯誤訊息，屬 Google 主控台
> 已知缺陷，可忽略。它僅阻擋 **Publish app**，而目標狀態即為 Testing。
> **切勿為消除該訊息而填寫 App domain**，那將導致無法通過的網域驗證要求。

### 6.3 Data Access（Scopes）

僅勾選三項：

```
.../auth/userinfo.email
.../auth/userinfo.profile
openid
```

**此步驟決定整體登入體驗。** Google 對僅請求上述 basic scopes 的應用程式
設有明文例外：使用者無須列入 Test users、不會看到「尚未驗證」警告頁、
授權亦不會於 7 天後過期。新增任一 sensitive scope 將使上述三項例外同時失效。

### 6.4 Clients

建立 **Web application** 類型的 OAuth client：

| 欄位 | 值 |
|---|---|
| Authorized redirect URIs | `https://<project-ref>.supabase.co/auth/v1/callback` |
| Authorized JavaScript origins | **留空**。採 server-side flow，不需要 |

取得 **Client ID** 與 **Client secret**。

### 6.5 於 Supabase 啟用

**Authentication → Providers → Google**，啟用並填入 Client ID 與 Client secret。

### 6.6 驗證

無須任何程式碼。以未列入任何清單的 Google 帳號開啟：

```
https://<project-ref>.supabase.co/auth/v1/authorize?provider=google&redirect_to=http://localhost:5173
```

三項檢查：不出現「尚未驗證」警告頁、可正常選擇帳號、導回網址帶有 `#access_token=`。

> 導回網址中的 `#access_token=` 為有效的 session JWT，其後的 `refresh_token`
> **不會自行過期**。不得截圖或外流。

---

## 7. 階段三：本機環境

```bash
git clone <repository-url>
cd Galilee_Fellowship
npm install
cp .env.example .env
```

### 7.1 `.env` 欄位

| 變數 | 值的來源 | 是否進入前端產物 |
|---|---|---|
| `VITE_SUPABASE_URL` | 階段 1 的 Project URL | 是 |
| `VITE_SUPABASE_ANON_KEY` | 階段 1 的 anon key | 是 |
| `VITE_ROOM_ID` | 階段 4 產出的房間 uuid | 是 |
| `SUPABASE_SERVICE_ROLE_KEY` | 階段 1 的 service_role key | **否** |
| `SUPABASE_DB_URL` | 資料庫連線字串，僅 `verify:rls` 使用 | 否 |
| `SUPABASE_ENV` | 設為 `production` 時停用 `verify:rls` | 否 |
| `CLEANUP_CRON_SECRET` | 自行產生的隨機字串 | 否 |

`.env` 已列入 `.gitignore`。經全部提交紀錄掃描確認，四類密鑰均未進入版本控制。

### 7.2 可用指令

| 指令 | 用途 |
|---|---|
| `npm run dev` | Vite 開發伺服器（port 5173） |
| `npm run build` | 型別檢查後打包至 `dist/` |
| `npm run lint` | ESLint，含架構邊界規則 |
| `npm run typecheck` | 瀏覽器與 Node 程式碼各檢查一次 |
| `npm test` | 單元與 DOM 測試（232 項） |
| `npm run db:types` | 自雲端專案重新產生 `src/db/types.ts` |
| `npm run verify:rls` | RLS 驗證清單（需開發專案） |

**每次套用遷移後須執行 `npm run db:types`**，使型別定義與資料庫實際結構一致。
該指令需要 Supabase 存取權杖，可經 `npx supabase login` 或
`SUPABASE_ACCESS_TOKEN` 環境變數提供。

---

## 8. 階段四：資料庫

### 8.1 遷移套用方式

因開發機無 Docker，遷移一律以人工方式套用：
**Supabase 主控台 → SQL Editor → 貼入檔案全文 → Run**，依編號順序執行。

### 8.2 遷移清單

| 編號 | 內容 | 關鍵設計 |
|---|---|---|
| 001 | `rooms`、`room_members`、`join_attempts` | 刻意無 INSERT policy，加入一律走 Edge Function |
| 002 | `themes`、`posts`、`posts_public`、`rooms_public` | 兩個 view **不可**設 `security_invoker`，須以 owner 權限執行 |
| 003 | Storage bucket `post-images` 與存取政策 | `public = true`；路徑首層須等於 `auth.uid()` |
| 004 | 30 天硬刪除清理 | 已由 009 退場 |
| 005 | 成員讀得到自己的 `room_members` 列 | 使前端能區分 orphan／suspended／left |
| 006 | `themes_public` view | 訪客可讀主題標題 |
| 007 | `soft_delete_post` 函式 | 時間判定於伺服器端進行 |
| 008 | 配額索引 | 僅計入 `counts_toward_quota = true` |
| 009 | 清理改由 Edge Function 執行 | Supabase 禁止以 SQL 刪除 `storage.objects` |
| 010 | `posts` 的欄位層級權限 | RLS 管列不管欄，須以 GRANT 收窄 |
| 011 | 貼文拆為 `title` 與 `body` | view 以 `create or replace` 更新以保留 grant |
| 012 | 刪除時限 20 分鐘，逾期拒絕 | 取代 010 的配額回補機制 |
| 013 | 成員個人檔案與 `room_members` 欄位層級權限 | 另建 `admin_set_member_status` definer 函式 |

### 8.3 三項不可違反的資料層規則

1. **已推送至雲端的遷移不得修改**，一律新增檔案（§12.6）。
2. **RLS policy 須與其保護的資料表寫在同一個遷移檔**，避免出現「資料表已建立
   但尚無 policy」的時間窗口。
3. **RLS 管列，GRANT 管欄。** 允許某角色更新某列，即等於允許其更新該列的
   每一個欄位。`posts` 與 `room_members` 均因此需要欄位層級 GRANT，
   否則成員可自行修改 `role`、`counts_toward_quota` 等特權欄位。

### 8.4 種子資料

遷移完成後建立房間列。房間 uuid 採固定值，使 `.env` 與 Edge Function 的設定可預期：

```sql
insert into rooms (id, name, description, join_code, join_open)
values (
  '00000000-0000-4000-8000-000000000001',
  '<房間名稱>',
  '<房間說明>',
  '<房間碼，至少 12 字元>',
  true
)
on conflict (id) do nothing;
```

將該 uuid 填入 `.env` 的 `VITE_ROOM_ID`。

### 8.5 管理員指派

前端無提升權限的路徑。首位管理員須於主控台手動設定：

```sql
update room_members set role = 'admin' where id = '<member_id>';
```

須先以 Google 帳號完成一次加入流程，該列才會存在。

---

## 9. 階段五：Edge Functions

本專案有兩支 Edge Function，均為必要元件。

### 9.1 `join-room`

房間碼驗證與 rate limit。**全案唯一的伺服器端業務邏輯。**
`room_members` 刻意無 INSERT policy，若前端能自行插入成員列，
任何登入者皆可無視房間碼直接加入。

### 9.2 `cleanup-posts`

執行 30 天硬刪除。此工作無法以 SQL 完成：Storage 檔案僅能經 Storage API 刪除，
而該操作需要 service role。遷移 004 原以 SQL 函式實作，從未成功執行過，
已由 009 退場。

### 9.3 部署

```bash
npx supabase login
npx supabase functions deploy join-room    --project-ref <ref>
npx supabase functions deploy cleanup-posts --project-ref <ref>
```

### 9.4 Secrets

`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_ANON_KEY`
由平台自動注入，無須設定。另需手動設定兩項：

```bash
npx supabase secrets set ROOM_ID=<房間 uuid> --project-ref <ref>
npx supabase secrets set CLEANUP_CRON_SECRET=<與 .env 相同的值> --project-ref <ref>
```

`CLEANUP_CRON_SECRET` **刻意不使用 service role key**：後者繞過所有 RLS，
置於 GitHub 等同交出資料庫寫入權；前者僅能觸發清理，且清理為冪等操作，
只移除已滿 30 天的資料。

### 9.5 `verify_jwt` 設定

`supabase/config.toml` 中兩支 function 均設 `verify_jwt = false`。
此設定**不等於不驗證身分**：平台層的 `verify_jwt` 僅確認 JWT 由本專案簽發，
而 anon key 本身即為合法 JWT 且必然外流至瀏覽器，故其實質保護趨近於零。
真正的把關位於 function 內部（以呼叫者的 Authorization header 建立 client
並呼叫 `getUser()`）。關閉該設定換得可靠的 CORS preflight——
OPTIONS 請求不帶 Authorization header，開啟時會在正式請求送出前即遭平台阻擋。

---

## 10. 階段六：Cloudflare Pages

### 10.1 建立專案

**Workers & Pages → Create → Pages → Connect to Git**。

> 新版主控台預設引導至 Workers（含靜態資產），**該路徑不適用本專案**。
> 可直接前往 `https://dash.cloudflare.com/?to=/:account/pages/new`。

| 欄位 | 值 |
|---|---|
| 專案名稱 | 自行輸入，僅允許小寫字母、數字、連字號 |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Production branch | `main` |

專案名稱直接決定網址（`<名稱>.pages.dev`），且於 `pages.dev` 之下全球唯一。
**正式網址於此步驟定案**，階段七方能進行。

### 10.2 環境變數

**Settings → Environment variables**，**Production 與 Preview 各設一份**：

| 變數 | 值 | 型別 |
|---|---|---|
| `VITE_SUPABASE_URL` | 同 `.env` | Text |
| `VITE_SUPABASE_ANON_KEY` | 同 `.env` | Text |
| `VITE_ROOM_ID` | 同 `.env` | Text |
| `NODE_VERSION` | `22` | Text |

Preview 環境涵蓋 `<branch>.<專案名>.pages.dev`。未設定時預覽部署可開啟但立即失效。

**不得設定** `SUPABASE_SERVICE_ROLE_KEY` 與 `CLEANUP_CRON_SECRET`：
Pages 僅提供靜態檔案，無伺服器端程式碼，兩者在此毫無用途。

型別選 Text 而非 Secret：`VITE_` 變數於建置時即被字面替換進 JavaScript 產物，
標記為 Secret 並不改變其最終公開的事實。

環境變數變更**不會觸發重新建置**，須於 Deployments 手動 Retry。

### 10.3 路由設定

`public/_redirects` 定義乾淨網址。**其目標一律不可寫 `.html`**：

```
/members/*       /members   200
/member/me/edit  /profile   200
/post/new        /new       200
/post/*          /post      200
/member/*        /member    200
```

Cloudflare Pages 會將任何 `.html` 結尾的路徑以 308 轉回無副檔名形式，
且該正規化亦套用於 `_redirects` 規則的目標。若目標寫成 `/wall.html`，
將展開為 `/wall → 308 → /wall` 的無窮迴圈；萬用規則則會連 splat 一併遺失。
本專案於 2026-08-27 首次部署時，除 `/` 之外每一條路由皆因此失效。

`/wall`、`/join`、`/admin` 等精確路徑**刻意不寫規則**：
Pages 本即會以 `wall.html` 服務 `/wall`。

規則順序有意義：`/member/me/edit` 須排在 `/member/*` 之前。
`/members*` 與 `/member/*` 不會互相匹配——後者要求 `member` 之後緊接 `/`。

`vite.config.ts` 中的 `CLEAN_URLS` 為同一組路由的本機實作。
兩者**規則內容不同**（Vite 無 Pages 的副檔名解析），變更時須同時檢視。

---

## 11. 階段七：Supabase Auth URL 設定

**Authentication → URL Configuration**：

- **Site URL**：`https://<專案名>.pages.dev`
- **Redirect URLs**（三條均須保留）：
  ```
  http://localhost:5173/**
  https://<專案名>.pages.dev/**
  https://*.<專案名>.pages.dev/**
  ```

三條的用途：本機開發、正式站、Pages 預覽部署。

> **Supabase 於 `redirect_to` 未通過白名單比對時不會回報錯誤**，
> 而是靜默改導向 Site URL。此為最難診斷的失效模式之一：
> 使用者完成登入卻落在非預期頁面，且無任何錯誤訊息。
> 前端的 `/` 頁面即為此情況的落地點，會依身分自動分流。

Google OAuth 的 redirect URI 無須變更——Supabase 專案未變，callback 位址相同。

---

## 12. 階段八：GitHub

### 12.1 Repository secrets

**Settings → Secrets and variables → Actions**：

| Secret | 值 | 用途 |
|---|---|---|
| `SUPABASE_URL` | 同 `.env` 的 `VITE_SUPABASE_URL` | keepalive 與清理 |
| `SUPABASE_ANON_KEY` | 同 `.env` 的 `VITE_SUPABASE_ANON_KEY` | 同上 |
| `CLEANUP_CRON_SECRET` | 同 `.env` 與 Edge Function secret | 觸發清理 |

**名稱不含 `VITE_` 前綴**，與 `.env` 中的變數名不同。

### 12.2 排程

| Workflow | 頻率 | 用途 |
|---|---|---|
| `Keepalive` | 每兩天 UTC 03:00 | 防止 7 天無請求自動暫停 |
| `Cleanup deleted posts` | 每月 1 日 UTC 03:30 | 執行 30 天硬刪除 |

兩者均支援 `workflow_dispatch`，建置完成後應各手動觸發一次確認為綠燈。

### 12.3 60 天規則

GitHub 會停用「儲存庫連續 60 天無活動」的排程工作，而一學期為 126 天。
`keepalive.yml` 於距上次提交滿 50 天時自動提交一個時間戳記以規避此限制。
若儲存庫設定為需經 PR 方能推送 `main`，此步驟將失敗，
應改以 UptimeRobot 作為主要機制。

### 12.4 備援

建議另設 UptimeRobot 監控，間隔 12 小時，指向：

```
https://<project-ref>.supabase.co/rest/v1/rooms_public?select=id&limit=1
```

須於進階設定加入 `apikey` header（值為 anon key）。
Keepalive 最可能的失效方式是靜默停止，單一機制構成單點失效。

---

## 13. 環境變數總表

同一組值分散於四處，命名與前綴各不相同。下表為完整對照：

| 值 | `.env` | Cloudflare Pages | GitHub Secrets | Edge Function |
|---|---|---|---|---|
| Project URL | `VITE_SUPABASE_URL` | `VITE_SUPABASE_URL` | `SUPABASE_URL` | 自動注入 |
| anon key | `VITE_SUPABASE_ANON_KEY` | `VITE_SUPABASE_ANON_KEY` | `SUPABASE_ANON_KEY` | 自動注入 |
| service_role key | `SUPABASE_SERVICE_ROLE_KEY` | **不可設定** | **不可設定** | 自動注入 |
| 房間 uuid | `VITE_ROOM_ID` | `VITE_ROOM_ID` | — | `ROOM_ID`（手動） |
| 清理密鑰 | `CLEANUP_CRON_SECRET` | **不可設定** | `CLEANUP_CRON_SECRET` | `CLEANUP_CRON_SECRET`（手動） |
| Node 版本 | — | `NODE_VERSION=22` | — | — |
| 環境護欄 | `SUPABASE_ENV=production` | — | — | — |

### 13.1 一值多處的風險

下列數值於多處各存一份，變更時須同步修改全部位置：

| 數值 | 位置 |
|---|---|
| 顯示姓名上限 20 | `constants.ts`、`join-room/index.ts`、遷移 013 的 check |
| 刪除時限 20 分鐘 | `constants.ts`、遷移 012 的 interval、`join.ts` 的告知同意文字 |
| 標題 2 至 20 字 | `constants.ts`、遷移 011 的 check |
| 內文上限 300 字 | `constants.ts`、遷移 011 的 check |
| 路由規則 | `public/_redirects`、`vite.config.ts` 的 `CLEAN_URLS` |

各處程式碼註解均已標註對應位置。伺服器端的定義為最終把關，
前端的份僅用於提前阻擋與顯示。

---

## 14. 上線前檢查清單

### 14.1 資料層

- [ ] 遷移 001 至 013 全數套用
- [ ] 執行 `npm run db:types` 並確認 `src/db/types.ts` 與資料庫一致
- [ ] 首位管理員已於主控台指派
- [ ] 房間碼已更換為正式值（至少 12 字元）
- [ ] 測試貼文與其 Storage 檔案已清除（**須先刪檔案再刪資料列**，
      順序顛倒將產生無法追蹤的孤兒檔案）

### 14.2 前端

- [ ] Cloudflare Pages 專案已建立且建置成功
- [ ] Production 與 Preview 環境變數各四項齊備
- [ ] 各路由回應 200 且送出正確頁面
- [ ] 產物中含 anon key 而**不含** service_role key

### 14.3 身分驗證

- [ ] Supabase 的 Site URL 與三條 Redirect URLs 已設定
- [ ] 以非管理員的 Google 帳號完成一次完整加入流程

### 14.4 維運

- [ ] GitHub secrets 三項齊備
- [ ] 兩支 workflow 手動觸發皆為綠燈
- [ ] UptimeRobot 備援監控已建立

---

## 15. 驗證方法

因無法於本機執行 SQL，遷移的驗證採探針方式進行，可安全地對正式資料庫執行：

**必敗探針**——送出違反約束的資料，預期收到 400。失敗的 INSERT 不寫入任何資料，
對正式資料庫零風險。

**必成探針**——送出合法資料，但將 `week_start_date` 設為久遠的過去
（如 `2020-01-06`），使其不會出現於任何使用者可見的畫面，驗證後立即刪除
並確認資料庫回復原狀。

前端產物的驗證則直接抓取線上資產進行字串比對，確認新程式碼確實部署、
且密鑰未混入。

此方法無法涵蓋欄位層級 GRANT（service role 會繞過所有 grant，
需一般成員的 JWT 方能驗證），該部分仍依賴 `verify:rls`。

---

## 16. 常見失效模式

| 徵狀 | 原因 |
|---|---|
| 登入後落在首頁而非預期頁面 | Redirect URLs 未涵蓋該網址，Supabase 靜默改用 Site URL |
| 路由無窮轉址或路徑參數遺失 | `_redirects` 的目標寫了 `.html` |
| 整站白畫面 | Cloudflare 環境變數未設定，`requireEnv()` 拋出例外 |
| 查詢回傳空值但無錯誤訊息 | 缺少 GRANT，或 RLS policy 不符 |
| 訪客看不到照片而成員看得到 | view 誤設 `security_invoker = true` |
| 網站於某日突然無法使用 | Supabase 因 7 天無請求而暫停，keepalive 已失效 |
| workflow 靜默停止執行 | 儲存庫連續 60 天無活動，排程遭 GitHub 停用 |

---

## 17. 版本

本文對應 **v1.0.0**（2026-08-28）。

後續變更 schema 時，應同步更新第 8.2 節的遷移清單與第 13 節的環境變數總表。
