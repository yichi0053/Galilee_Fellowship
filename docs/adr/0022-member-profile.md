# ADR-0022：成員個人檔案，並把 profile 從第三期提前

**Status**: Accepted

## Context

導覽列的大頭貼選單（ADR-0011 的 2026-08-28 修訂）建好之後，右上角有了一個
「這是我」的入口，但點開只有三條功能連結——沒有任何地方看得到、改得了自己是誰。

`features.profile` 原本排在第三期第 4 至 5 週（ADR-0013）。提前的理由是這個入口
已經存在，而一個點開沒有「我」的個人選單，比沒有選單更奇怪。

## Decision

新增 `/member/me/edit`，可編輯四個欄位：

| 欄位 | 必填 | 長度 | 誰看得到 |
|---|---|---|---|
| 暱稱（`display_name`） | 是 | 1 至 20 | 所有人（訪客看到遮蔽後的形式）|
| 生日 | 否 | `date` | 同房間的成員 |
| 興趣 | 否 | ≤ 100 | 同房間的成員 |
| 喜歡的一句聖經經節 | 否 | ≤ 200 | 同房間的成員 |

- **暱稱就是既有的 `display_name`**，不另立欄位。CONTEXT.md 的共享語言規則明訂
  同一概念不得出現同義詞；牆上的署名與檔案頁的名字若是兩個欄位，
  成員會分不清哪一個才是「我」。
- 選單的第一項是頭像加姓名，整塊就是通往這一頁的連結。
- 登出鈕從選單移到這一頁的最底下**並保留在選單裡**——選單是快速操作，
  檔案頁是「處理我的帳號」的地方，兩處都合理。

## Consequences

**代價**：

- **改名會改動所有既有貼文的署名。** `posts` 存的是 `author_id`，署名是查出來的，
  所以改一次名字，牆上三個月前的貼文署名也跟著變。ADR-0005 是信任模型、
  不驗證實名，所以也擋不住有人改成別人的名字。24 人的房間裡這是社交問題而非技術問題。
- **`room_members` 的 UPDATE 權限必須收窄，連帶動到管理員的路徑。**
  policy 管列不管欄：一旦讓成員更新自己那一列，他就能更新那一列的每個欄位，
  包含 `role`——一個 PATCH 就變成管理員。migration 013 因此
  `revoke update` 再只授予四個欄位，而這連帶把管理員改 `status` 的能力也收掉了，
  必須另開 `admin_set_member_status` definer 函式（與 ADR-0010 的
  `admin_set_post_hidden` 同一個模式）。**這是本決策最大的隱藏成本。**
- **生日與興趣是個資，且同房間的成員都讀得到。**
  `members_select` policy 是 `is_active_member(room_id)`，所以任何成員用 API
  都讀得到所有人的這些欄位——即使第一期沒有任何畫面顯示別人的檔案。
  檔案頁因此明寫「填了的欄位，同房間的成員看得到；訪客看不到」。
  訪客確實讀不到：`posts_public` 只帶遮蔽後的姓名。
- **`display_name` 從此有兩個寫入路徑**（join-room Edge Function 與 PostgREST），
  而長度限制原本只在 Edge Function 裡。migration 013 補上 check 約束，
  於是 20 這個數字有三份：`DISPLAY_NAME_MAX_LENGTH`、Edge Function 的
  `DISPLAY_NAME_MAX`、以及該約束。
- **多一個 HTML 入口。** `/member/me/edit` 的規則必須排在 `/member/*` 之前，
  否則會被萬用規則吃掉——`public/_redirects` 與 `vite.config.ts` 兩處都要。

理由：一個點開沒有「我」的個人選單，比沒有選單更奇怪。

**相關**：[ADR-0013](0013-phased-feature-release.md)（本決策把 profile 提前）、
[ADR-0011](0011-top-nav-and-fab.md)（大頭貼選單）、
[ADR-0005](0005-trust-model.md)（不驗證實名，所以改名擋不住冒名）。
