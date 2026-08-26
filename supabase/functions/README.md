# Edge Functions

## join-room

房間碼驗證與 rate limit（§8.3、§10.4）。全案唯一的伺服器端邏輯。

### 部署

```bash
npx supabase functions deploy join-room --project-ref <ref>
```

### 需要的 secrets

`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_ANON_KEY` 由平台自動注入。
`ROOM_ID` 需自行設定：

```bash
npx supabase secrets set ROOM_ID=<房間 uuid> --project-ref <ref>
```

### 手動驗證

拿一個已登入使用者的 access token（瀏覽器 devtools 的 localStorage
`sb-<ref>-auth-token` 內），然後：

```bash
# 錯誤的房間碼 → 403 invalid_code
curl -i -X POST "https://<ref>.supabase.co/functions/v1/join-room" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"joinCode":"definitely-wrong","displayName":"測試"}'

# 連打 11 次 → 第 11 次應為 429 並帶 Retry-After
```

關掉加入開關後再試，應得 403 `join_closed`：

```sql
update rooms set join_open = false where id = '<room_id>';
```

### 為什麼這段邏輯不能放在前端

`room_members` 刻意沒有 INSERT policy。若前端能自行插入成員列，
任何登入者都可以無視房間碼直接加入，房間碼形同虛設。
`scripts/verify-rls.ts` 有一項專門檢查這條路是否真的走不通。
