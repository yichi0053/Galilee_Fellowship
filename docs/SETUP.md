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

Google Cloud Console 已改版為 **Google Auth Platform**，設定拆成 Branding、Audience、
Data Access、Clients 四個分頁。

1. https://console.cloud.google.com → 建立專案（或沿用既有專案）

2. **Branding** —— 只填三格，其餘全部留白：

| 欄位 | 值 |
|---|---|
| App name | 例如「加利利團契照片牆」，這會顯示在 Google 登入畫面上 |
| User support email | 你的 Gmail |
| Developer contact information | 你的 Gmail |
| App logo | **跳過**。要顯示 logo 得先做品牌驗證，不值得為 24 人做 |
| App domain（首頁、隱私權政策、服務條款） | **留白**。Google 只對 external **production** 應用強制要求這三個連結 |
| Authorized domains | **留白**。填了就得到 Search Console 驗證網域擁有權，而 `supabase.co` 不是你的，驗不了 |

3. **Audience** —— User type 選 **External**，發布狀態維持 **Testing**。
   **Test users 一個都不用加**，理由見第 4 步的說明框。

> **這一頁會顯示一則錯誤訊息，不要理它。**
>
> Publishing status 區塊會出現：
> 「Your app's OAuth configuration is incomplete. You must enter the missing
> information to proceed. Please visit the Branding page to finish configuring your app.」
>
> 這是 Google 主控台的已知 bug（[官方開發者論壇討論串](https://discuss.google.dev/t/cannot-publish-due-to-error-message-your-apps-oauth-configuration-is-incomplete-you-must-enter-the-missing-information-to-proceed-please-visit-the-branding-page-to-finish-configuring-your-app-even-though-all-required-fields-are-complete/392229)：
> 必填欄位全部填妥、跨三個全新專案重現，刪除重建無效，至今無解）。
> 它唯一的作用是擋住 **Publish app** —— 而你的目標狀態就是 Testing，**根本不需要發布**。
> 只要 Publishing status 顯示 `Testing`，這一頁就算完成了。
>
> **千萬不要為了消掉它去填 App domain。** 一旦填入首頁／隱私權政策／服務條款連結，
> Google 就會連帶要求 Authorized domains，而你的 redirect 是 `<ref>.supabase.co` ——
> 那不是你的網域，Search Console 驗不了擁有權。那才是真正會卡死的死路。

4. **Data Access（Scopes）** —— 只勾這三個，一個都不要多：

   ```
   .../auth/userinfo.email
   .../auth/userinfo.profile
   openid
   ```

> **這一步決定了整個登入體驗，不要手滑多勾。**
>
> Google 對「只請求 `email`、`profile`、`openid` 這三個 basic scope」的應用有明文例外
> （[Unverified apps](https://support.google.com/cloud/answer/7454865)、
> [Manage App Audience](https://support.google.com/cloud/answer/15549945)）：
> 使用者**不需要在 Test users 清單裡**、**不會看到「Google 尚未驗證這個應用程式」警告頁**、
> 授權也**不會 7 天過期**。
>
> 多勾任何一個 sensitive scope，這三件事全部回來 —— 24 人要逐一登記、
> 每個人登入時看到嚇人的警告畫面、還得送審等數日。
> 本專案只需要辨識身分，沒有理由多勾。

5. **Clients → Create OAuth client**
   - Application type：**Web application**
   - **Authorized redirect URIs** 先填開發專案這一條：
     ```
     https://<你的-project-ref>.supabase.co/auth/v1/callback
     ```
     正式專案開好後**再回來加第二條**，不要刪掉第一條。
   - **Authorized JavaScript origins**：留白。Supabase 走的是瀏覽器導向 Google、
     Google 再導回 Supabase callback 的 server-side flow，不需要 JS origin。

6. 取得 **Client ID** 與 **Client secret**

7. 回到 Supabase Dashboard → **Authentication → Providers → Google**
   - 啟用，貼上 Client ID 與 Client secret

8. **Authentication → URL Configuration**

   下文的 `<專案名>` 是你在 Cloudflare Pages 建立專案時自己取的名字（見第 3 節）。
   **取名之前這個網址並不存在**，所以現階段先只填本機這組：

   - Site URL：`http://localhost:5173`
   - Redirect URLs：`http://localhost:5173/**`

   Pages 開好、拿到真網址之後再回來改成：

   - Site URL：`https://<專案名>.pages.dev`
   - Redirect URLs（三條都要留著）：
     ```
     http://localhost:5173/**
     https://<專案名>.pages.dev/**
     https://*.<專案名>.pages.dev/**
     ```

   三個容易踩的地方：

   - 少了 `localhost` 這條，本機開發時 OAuth 會導向線上站台。**改成正式網址時不要刪掉它。**
   - 第三條是 Pages 的預覽部署（網址形如 `<branch>.<專案名>.pages.dev`，
     與正式站不同子網域）。不加的話預覽站打得開但登不了。
   - `5173` 是 Vite 預設埠。被佔用時 Vite 會**安靜地**改用 5174，
     OAuth 就會因為對不上而失敗，且錯誤訊息看不出原因。
     要根絕就在 `vite.config.ts` 加 `server: { port: 5173, strictPort: true }`。

9. **實測驗證 —— 這步不能跳**

   不需要任何程式碼。T-04（`src/modules/auth/`）還沒實作也能測，
   因為 Supabase 的 auth endpoint 自己會把整套流程跑完。
   直接在瀏覽器開：

   ```
   https://<你的-project-ref>.supabase.co/auth/v1/authorize?provider=google&redirect_to=http://localhost:5173
   ```

   用一個**沒有加進任何清單**的 Google 帳號開，確認三件事：

   | 檢查項 | 期望 |
   |---|---|
   | 授權畫面 | **不出現**「Google 尚未驗證這個應用程式」警告頁 |
   | 帳號 | 直接進到選帳號／同意畫面，不被拒絕 |
   | 導回的網址列 | `http://localhost:5173/` 且後面帶 `#access_token=` |

   先開著 `npm run dev` 會比較好看，但**不開也算成功** —— 要看的是網址列有沒有
   `#access_token=`，那代表 Google ↔ Supabase 的握手打通了。
   導回後頁面顯示「載入中…」是正常的：那是 `index.html` 的靜態佔位文字，
   `src/ui/pages/index.ts` 要到階段五才實作。

   若警告頁真的出現，回頭檢查 Data Access 是不是混進了第四個 scope。

   > **開發專案已於 2026-08-27 實測通過**：非清單帳號可登入、無警告頁、
   > token payload 含 `email`、`email_verified`、`full_name`、`picture`。
   > 第 4 步的 basic scopes 例外確認成立。
   > **正式專案上線時要再測一次**（見第 7 節）—— 兩個專案的 Auth 設定不共用。

> **導回的網址列裡是活的憑證，不要外流。** `#access_token=` 是有效的 session JWT
> （約 1 小時），後面的 `refresh_token` **不會自己過期**，拿到的人可以無限期換新 token。
> 不要截圖、貼進聊天室或 issue。真的外流了：Supabase Dashboard →
> Authentication → Users 刪掉該筆 user（作廢 refresh token），
> 再到 https://myaccount.google.com/permissions 移除本 app 的存取權（作廢 `provider_token`）。

> 登入畫面會顯示「繼續前往 `<你的-project-ref>.supabase.co`」而不是你的站名。
> 這是 Supabase 免費方案的固定行為（換成自訂網域要付費），無法消除。
> 建議在加入流程的說明或 LINE 公告裡先講一句，免得成員以為是釣魚網站。

---

## 3. Cloudflare Pages

1. https://dash.cloudflare.com → **Workers & Pages → Create → Pages**
2. 連接 git repo（或先用 **Direct Upload** 手動上傳 `dist/`）

> **站台網址在這一步定案。** 你輸入的專案名稱直接決定網址 —— 取名 `galilee-fellowship`
> 就得到 `https://galilee-fellowship.pages.dev`。
>
> 名稱拿去當子網域，所以受 DNS 規則限制：**只允許小寫字母、數字、連字號**，
> 1 至 58 字元，頭尾不能是連字號。**大寫與底線都會被退回** ——
> `Galilee_Fellowship` 不合法，`galilee-fellowship` 才可以。
> 用「連接 git repo」建立時 Cloudflare 會拿 repo 名稱當預設值並自動正規化，
> 但那一格可以編輯，**自己打上去**，不要賭它轉出來的結果跟你想的一樣。
>
> 名稱在 `pages.dev` 底下全球唯一，被別人佔走就得換一個（例如加上 `-wall`）。
> 所以**在這裡按下建立、確認名字真的到手之前，第 2 節第 8 步的正式網址無從填起**。
> 定案後記得回第 2 節把 Supabase 的 Site URL 與 Redirect URLs 補上。

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

## 7. 上線檢查清單

**ADR-0018：不另開正式專案，你現在用的這一個就是正式環境。**
原本「開第二個專案並切換」那十步已經不需要，改為以下清單。

> 這代表你**沒有可以隨便弄壞的地方了**。此後 migration、手改資料、任何實驗，
> 動到的都是 24 個人的真實照片。想要開發環境的話免費方案還允許第二個 project，
> 隨時可以補開——但不要再拿這一個當實驗場。

### 7.1 資料層轉正

- [ ] **把自己升為管理員**
      Dashboard → Table Editor → `room_members` → 你那一列的 `role` 改成 `admin`。
      沒有這一步 `/admin` 會擋你自己。
- [ ] **換掉房間碼**
      種子資料的 `DEV-ONLY-JOIN-CODE-0000` 寫在 repo 裡，且已列入 `admin` 模組的禁止清單。
      到 `/admin` → 房間設定改一個，至少 12 字元、字元變化 4 種以上。
      **這是你要唸給 24 個人聽的字串**，好記比複雜重要（rate limit 已經擋住暴力猜測）。
- [ ] **清掉測試貼文與檔案**（見 7.4）
- [ ] **確認 `.env` 有 `SUPABASE_ENV=production`**
      少了它，`npm run verify:rls` 會對正式資料庫建立與刪除真實使用者。
      設好之後該腳本會拒絕執行並回傳退出碼 2。

> **這代表 RLS 與權限的迴歸驗證目前跑不起來。** `verify:rls` 共 50 餘項，
> 其中一整組是「一般成員不得做管理員的事」——那些檢查需要一個非管理員的
> 測試帳號，而建立測試帳號正是護欄要擋的行為。
>
> 2026-08-27 發現的三個欄位層級權限漏洞（成員可自行改
> `counts_toward_quota`、`hidden_by_admin`、`deleted_at`）就是靠這類檢查抓到的，
> 當時是另寫一次性探針。**日後補開一個開發專案的主要理由就是這件事**：
> 免費方案允許 2 個 active project，開了之後把 `.env` 的 `SUPABASE_ENV` 拿掉、
> 指向那個專案即可重新跑起來。
- [ ] **不要執行 `supabase/seed.sql`**。它會覆寫房間設定並塞回開發用房間碼。

### 7.2 站台

- [ ] **開 Cloudflare Pages 專案**（第 3 節），取得 `<專案名>.pages.dev`
- [ ] **Supabase → Authentication → URL Configuration** 補上正式網址
      （第 2 節第 8 步；**保留 localhost 那條**）
- [ ] **Cloudflare Pages 環境變數**填 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、
      `VITE_ROOM_ID`（Production 與 Preview 各一份）
- [ ] **Google OAuth 的 redirect URI 不需要改** —— 專案沒有換，那條 callback 還是同一個

### 7.3 維運

- [ ] **把 repo 推上 GitHub**。兩支排程 workflow 都得在 GitHub 上才會跑。
- [ ] **GitHub repo secrets** 三個：

      | Secret | 值 |
      |---|---|
      | `SUPABASE_URL` | 同 `.env` 的 `VITE_SUPABASE_URL` |
      | `SUPABASE_ANON_KEY` | 同 `.env` 的 `VITE_SUPABASE_ANON_KEY` |
      | `CLEANUP_CRON_SECRET` | 同 `.env` 的同名變數（已一併設進 Supabase 的 function secret）|

      `CLEANUP_CRON_SECRET` 刻意不是 service role key：那把鑰匙繞過所有 RLS，
      放進 GitHub 等於交出整個資料庫的寫入權。這個 secret 只能觸發清理，
      而清理是冪等的、只刪滿 30 天的東西。

- [ ] **兩支 workflow 各手動觸發一次**（Actions 分頁 → Run workflow），確認綠燈：
      `Keepalive`（每兩天）與 `Cleanup deleted posts`（每月 1 日）。
- [ ] **60 天規則已由 keepalive 自行處理**：GitHub 會停用 repo 連續 60 天無 commit 的
      scheduled workflow，而學期是 126 天。workflow 會在距上次 commit 滿 50 天時
      自己 commit 一個時間戳。若你把 repo 設為需要 PR 才能推 main，這一步會失敗——
      那種情況改設 UptimeRobot 當主力（`OPERATIONS.md` 第 3 節）。

### 7.4 清掉開發殘留

測試貼文的資料列與 Storage 檔案要一起清，且**順序不可顛倒**——
先刪資料列的話就再也查不到 `image_path`，檔案會變成永遠找不回來的孤兒。

最省事的做法是在 `/post/:id` 逐則刪除（那只是軟刪除），然後到 `/admin` →
貼文管理 → 執行清理。但清理只會移除**已滿 30 天**的，所以測試資料要立刻清乾淨的話，
得從 Dashboard 手動處理：Storage → `post-images` 刪掉對應檔案，再到 Table Editor 刪 `posts` 的列。

- [ ] 測試貼文（資料列 + Storage 檔案）
- [ ] `join_attempts` 的測試紀錄（可留，只是稽核用）

### 7.5 非程式（架構書 §17）

- [ ] **背景牆圖片**：目前是零位元組的漸層代用，可以直接上線，換素材是加分項
- [ ] **告知同意文字**：`/join` 上的四點聲明**須由團契負責人確認後才可上線**

---

## 完成檢查

```bash
npm install
npm run lint       # 應通過
npm run typecheck  # 應通過
```

`.env` 中 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` 有值後即可進入階段二。
