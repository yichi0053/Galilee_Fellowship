# SETUP — 人工前置步驟（T-01）

這些步驟需要你本人操作外部服務，程式無法代勞。**完成前無法進入階段二（資料層）。**
每一步都會產出一個要填進 `.env` 的值。

先複製環境檔：

```bash
cp .env.example .env
```

---

## 1. Supabase 專案

1. https://supabase.com/dashboard → **New project**
2. Region 選 **Northeast Asia (Tokyo)** 或 **Southeast Asia (Singapore)**，兩者對台灣延遲最低
3. 設定 Database password 並**存到密碼管理器**，遺失需重設整個資料庫密碼
4. 建立完成後至 **Settings → API**，取得：

| Dashboard 欄位 | 填入 `.env` 的變數 |
|---|---|
| Project URL | `VITE_SUPABASE_URL` |
| `anon` `public` key | `VITE_SUPABASE_ANON_KEY` |
| `service_role` `secret` key | `SUPABASE_SERVICE_ROLE_KEY` |

> `service_role` key 繞過所有 RLS。它**只能**出現在 `.env`（已被 gitignore）與 Edge Function 的
> secret 中，絕對不可加 `VITE_` 前綴，否則會被打包進瀏覽器 bundle。

5. **現在只開這一個，把它當開發專案用**（ADR-0017）。
   隨便摸、隨便重建、`verify:rls` 想跑幾次都行。
   正式專案在上線前才開，見本文第 7 節。

---

## 2. Google OAuth client

1. https://console.cloud.google.com → 建立專案（或沿用既有專案）
2. **APIs & Services → OAuth consent screen**
   - User Type：**External**
   - App name、support email、developer contact 填好
   - Scopes 只需要預設的 `email`、`profile`、`openid`
   - 發布狀態維持 **Testing** 即可（Testing 模式上限 100 位測試使用者，本專案 24 人足夠）
   - **注意**：Testing 模式下，每位成員的 Google 帳號都必須加入 **Test users** 清單，
     否則登入會被拒。24 人要逐一加入。若嫌麻煩則需送審 Publishing，審核可能需數日。
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type：**Web application**
   - Authorized redirect URIs 先填開發專案這一條：
     ```
     https://<你的-project-ref>.supabase.co/auth/v1/callback
     ```
     正式專案開好後**再回來加第二條**，不要刪掉第一條。
4. 取得 **Client ID** 與 **Client secret**
5. 回到 Supabase Dashboard → **Authentication → Providers → Google**
   - 啟用，貼上 Client ID 與 Client secret
6. **Authentication → URL Configuration**
   - Site URL：正式站網址（例如 `https://galilee-wall.pages.dev`）
   - Redirect URLs 加入：
     ```
     http://localhost:5173/**
     https://galilee-wall.pages.dev/**
     ```
   - 少了 `localhost` 這條，本機開發時 OAuth 會導向線上站台

---

## 3. Cloudflare Pages

1. https://dash.cloudflare.com → **Workers & Pages → Create → Pages**
2. 連接 git repo（或先用 **Direct Upload** 手動上傳 `dist/`）
3. 建置設定：

| 欄位 | 值 |
|---|---|
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |

4. **Settings → Environment variables** 加入（Production 與 Preview 各一份）：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_ROOM_ID`

> `public/_redirects` 已寫好 §10.1 的路由，Cloudflare Pages 會自動套用，不需額外設定。

---

## 4. Keepalive（防 7 天自動暫停）

`.github/workflows/keepalive.yml` 已建立。需在 GitHub repo 設定 secrets：

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | 值 |
|---|---|
| `SUPABASE_URL` | 同 `VITE_SUPABASE_URL` |
| `SUPABASE_ANON_KEY` | 同 `VITE_SUPABASE_ANON_KEY` |

設好後到 **Actions** 分頁手動觸發一次（workflow_dispatch）確認為綠燈。

備援請另設 UptimeRobot，詳見 `OPERATIONS.md` 第 3 節。

---

## 5. 房間 id

資料層 migration 與種子資料套用後，執行以下 SQL 取得房間 uuid，填入 `VITE_ROOM_ID`
（ADR-0004：schema 保留 `room_id` 但 UI 只暴露單一房間）：

```sql
select id, name from rooms;
```

---

## 6. 非程式待辦（架構書 §17）

- [ ] **背景牆圖片**：先找一張免費授權的軟木塞板或水泥牆材質圖放進 `public/`，
      避免牆頁視覺被素材卡住。正式素材可後補。
- [ ] **告知同意文字**：加入流程需呈現，內容至少涵蓋四點——
      照片與姓名會被同房間成員看到、持有連結的非成員可看到照片但姓名遮蔽、
      成員可自行刪除自己的貼文、退出房間後貼文仍會保留顯示。
      **此聲明須由團契負責人確認後才可上線。**

---

## 7. 上線前：開正式專案並切換

你選擇先開一個專案當開發用，所以上線前有一組切換步驟。
**這些事沒做完網站就是壞的，而且多半是安靜地壞**，故逐條列出。

1. 開第二個 Supabase 專案，命名加上 `-prod`。免費方案允許 2 個 active project。
2. 在新專案的 SQL Editor 依序執行 `supabase/migrations/` 的 001 至 004。
   **不要執行 `seed.sql`** —— 它裡面的房間碼是 `DEV-ONLY-JOIN-CODE-0000`。
   改為手動 insert 一列 `rooms`，房間碼自訂（至少 12 字元，§8.2）。
3. `select id from rooms;` 取得**新的房間 uuid**。
   它跟開發專案的不一樣，以下三處都要換：
   - Cloudflare Pages 的環境變數 `VITE_ROOM_ID`
   - Edge Function 的 secret：`npx supabase secrets set ROOM_ID=<新 uuid> --project-ref <prod-ref>`
   - 本機 `.env`（若你還要接著開發）
4. Cloudflare Pages 的 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_ANON_KEY` 換成正式專案的值。
5. Google Cloud Console → Credentials → 你的 OAuth client，
   **新增**正式專案的 redirect URI（保留開發那條）：
   `https://<prod-ref>.supabase.co/auth/v1/callback`
6. 正式專案的 **Authentication → Providers → Google** 也要貼一次 Client ID 與 secret。
   這是最容易漏的一步：兩個專案各有各的 Auth 設定，不會自動同步。
7. 正式專案的 **Authentication → URL Configuration** 填正式網址。
8. 部署 Edge Function 到正式專案：
   `npx supabase functions deploy join-room --project-ref <prod-ref>`
9. GitHub secrets 的 `SUPABASE_URL` / `SUPABASE_ANON_KEY` 換成正式專案，
   否則 keepalive 會一直 ping 開發專案，而**正式專案在第 7 天安靜暫停**。
10. 最後跑一次 `npm run verify:rls` 指向正式專案，確認全綠，
    然後**把它產生的測試帳號清乾淨**（腳本會自己刪，但請到
    Authentication → Users 目視確認一次）。
    此後不要再對正式專案跑這個腳本。

---

## 完成檢查

```bash
npm install
npm run lint       # 應通過
npm run typecheck  # 應通過
```

`.env` 中 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` 有值後即可進入階段二。
