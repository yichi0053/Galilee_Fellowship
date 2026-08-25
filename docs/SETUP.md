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

5. 依 ADR-0017，重複本步驟建立**第二個專案**作為開發環境，命名加上 `-dev` 後綴。
   兩個專案共用 organization 的 Storage 與 egress 額度。

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
   - Authorized redirect URIs 填入（兩個專案各一條）：
     ```
     https://<你的-project-ref>.supabase.co/auth/v1/callback
     https://<你的-dev-project-ref>.supabase.co/auth/v1/callback
     ```
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

## 完成檢查

```bash
npm install
npm run lint       # 應通過
npm run typecheck  # 應通過
```

`.env` 中 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` 有值後即可進入階段二。
