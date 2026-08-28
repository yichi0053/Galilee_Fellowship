/**
 * §15.3 RLS 驗證清單。
 *
 * RLS 是本專案最大的技術風險（§16）：寫錯的失敗模式是**安靜的**——
 * 不拋錯誤，只回傳不該回傳的資料。因此這份清單不是可選項。
 *
 * ADR-0017：開發機無 Docker，pgTAP 不可用，故改以不同身分的 JWT
 * 直接打 PostgREST，涵蓋條目與 §15.3 相同。
 *
 * 用法（**務必指向 dev 專案，本腳本會建立與刪除資料**）：
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/verify-rls.ts
 * 或把值放進 .env 後直接 `npm run verify:rls`。
 */

import { IMAGE_CACHE_SECONDS, POST_IMAGES_BUCKET } from '../src/config/constants';
import { weekStartOf } from '../src/domain/week';

type Identity = { label: string; token: string | null };

const ROOM_ID = '00000000-0000-4000-8000-000000000001';
const PASSWORD = 'verify-rls-not-a-real-password-9f3a';

// ---------------------------------------------------------------- 環境 ----

try {
  process.loadEnvFile('.env');
} catch {
  // 沒有 .env 就靠既有環境變數
}

const URL_BASE = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

if (!URL_BASE || !SERVICE_KEY || !ANON_KEY) {
  console.error(
    '缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY。見 docs/SETUP.md。',
  );
  process.exit(2);
}

if (/production|prod/i.test(process.env.SUPABASE_ENV ?? '')) {
  console.error('拒絕在 production 執行：本腳本會建立與刪除資料。');
  process.exit(2);
}

// ------------------------------------------------------------ HTTP 工具 ----

type RestResult = { status: number; body: unknown };

async function rest(
  identity: Identity,
  path: string,
  init: RequestInit = {},
): Promise<RestResult> {
  const headers: Record<string, string> = {
    apikey: ANON_KEY!,
    Authorization: `Bearer ${identity.token ?? ANON_KEY}`,
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* 保留原始字串 */
  }
  return { status: res.status, body };
}

async function admin(path: string, init: RequestInit = {}): Promise<RestResult> {
  const res = await fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* 保留原始字串 */
  }
  if (res.status >= 400) {
    throw new Error(`service role 請求失敗 ${res.status} ${path}: ${text}`);
  }
  return { status: res.status, body };
}

// -------------------------------------------------------------- 斷言 ----

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function rows(r: RestResult): unknown[] {
  return Array.isArray(r.body) ? r.body : [];
}

/** 呼叫 Edge Function。與 rest() 的差別只在路徑前綴，但那前綴是寫死的，故另立一支 */
async function callFunction(identity: Identity, name: string): Promise<number> {
  const res = await fetch(`${URL_BASE}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY!,
      Authorization: `Bearer ${identity.token ?? ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  return res.status;
}

/** 已上傳的測試檔案，於 finally 一併清除 */
const uploadedObjects: string[] = [];

/**
 * 上傳一個最小的 JPEG 到 post-images。
 *
 * migration 003 的 policy 建在 storage.objects 上，而那張表的擁有者是
 * supabase_storage_admin，不是 SQL Editor 用的 postgres——建不起來是有可能的，
 * 且失敗模式是安靜的：migration 看起來成功，直到第一個人上傳照片才爆。
 * 這幾項就是為了不讓那件事發生在正式上線之後。
 */
async function upload(path: string, token: string | null): Promise<number> {
  const res = await fetch(`${URL_BASE}/storage/v1/object/${POST_IMAGES_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY!,
      Authorization: `Bearer ${token ?? ANON_KEY}`,
      'Content-Type': 'image/jpeg',
      'cache-control': String(IMAGE_CACHE_SECONDS),
    },
    body: new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]),
  });
  if (res.ok) uploadedObjects.push(path);
  return res.status;
}

/** PostgREST 對「無權限」的回應可能是 401/403，也可能是 200 加空陣列（RLS 濾掉） */
function deniedOrEmpty(r: RestResult): boolean {
  return r.status === 401 || r.status === 403 || (r.status === 200 && rows(r).length === 0);
}

// ------------------------------------------------------------ 測試資料 ----

type Fixture = { userId: string; memberId: string; token: string };

async function createIdentity(
  email: string,
  displayName: string,
  role: 'member' | 'admin',
  status: 'active' | 'suspended' | 'left',
): Promise<Fixture> {
  const created = await admin('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  const userId = (created.body as { id: string }).id;

  const member = await admin('/rest/v1/room_members', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      room_id: ROOM_ID,
      user_id: userId,
      display_name: displayName,
      role,
      status,
    }),
  });
  const memberId = (member.body as Array<{ id: string }>)[0]!.id;

  const signIn = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const session = (await signIn.json()) as { access_token?: string };
  if (!session.access_token) {
    throw new Error(`無法取得 ${email} 的 access token：${JSON.stringify(session)}`);
  }

  return { userId, memberId, token: session.access_token };
}

/** createdAt 可回填過去的時刻，用來測逾期的分支而不必真的等 20 分鐘（ADR-0021）*/
async function createPost(memberId: string, body: string, createdAt?: Date): Promise<string> {
  const r = await admin('/rest/v1/posts', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      room_id: ROOM_ID,
      author_id: memberId,
      type: 'free',
      image_path: `${memberId}/x.jpg`,
      thumb_path: `${memberId}/x_thumb.jpg`,
      // migration 011：title 為 not null 且 2 至 20 字。
      // 取 body 前 20 字，與該 migration 回填既有貼文的做法一致。
      title: body.slice(0, 20),
      body,
      ...(createdAt ? { created_at: createdAt.toISOString() } : {}),
      // §7.3：貼文歸屬於「週」而不是「日」。原本這裡填的是今天的日期，
      // 週一以外的日子跑起來就與配額查詢的 week_start_date 對不上。
      week_start_date: weekStartOf(),
    }),
  });
  return (r.body as Array<{ id: string }>)[0]!.id;
}

async function cleanup(userIds: string[]): Promise<void> {
  for (const id of userIds) {
    try {
      await admin(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
    } catch (e) {
      console.warn(`  清理 ${id} 失敗：${(e as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------- 主流程 ----

async function main(): Promise<void> {
  const stamp = Date.now();
  const created: string[] = [];

  console.log('建立測試身分…');
  const adminUser = await createIdentity(
    `rls-admin-${stamp}@example.com`, '管理員', 'admin', 'active');
  const memberA = await createIdentity(
    `rls-a-${stamp}@example.com`, '陳小明', 'member', 'active');
  const memberB = await createIdentity(
    `rls-b-${stamp}@example.com`, '林大華', 'member', 'active');
  const suspended = await createIdentity(
    `rls-s-${stamp}@example.com`, '停權者', 'member', 'suspended');
  const leftUser = await createIdentity(
    `rls-l-${stamp}@example.com`, '退出者', 'member', 'left');
  created.push(adminUser.userId, memberA.userId, memberB.userId, suspended.userId, leftUser.userId);

  const postB = await createPost(memberB.memberId, '這是成員 B 的貼文，用來測試越權更新。');
  await createPost(suspended.memberId, '這是停權成員的貼文，不應出現在公開 view。');
  await createPost(leftUser.memberId, '這是退出成員的貼文，應該仍然出現在公開 view。');

  const guest: Identity = { label: 'anon', token: null };
  const asA: Identity = { label: 'member A', token: memberA.token };
  const asSuspended: Identity = { label: 'suspended', token: suspended.token };
  const asLeft: Identity = { label: 'left', token: leftUser.token };
  const asAdmin: Identity = { label: 'admin', token: adminUser.token };

  try {
    console.log('\n§15.3 RLS 驗證清單');

    // 1
    const r1 = await rest(guest, 'posts?select=id');
    check('以 anon 身分查詢 posts（非 view）回傳 0 列',
      deniedOrEmpty(r1), `status=${r1.status} rows=${rows(r1).length}`);

    // 2
    const r2 = await rest(guest, 'posts_public?select=display_name');
    const names = rows(r2).map((x) => (x as { display_name: string }).display_name);
    check('以 anon 身分查詢 posts_public 的 display_name 為遮蔽形式',
      r2.status === 200 && names.length > 0 && names.every((n) => n.includes('O')),
      `status=${r2.status} names=${JSON.stringify(names)}`);

    // 3
    const r3 = await rest(guest, 'rooms?select=join_code');
    check('以 anon 身分查詢 rooms 被拒',
      deniedOrEmpty(r3), `status=${r3.status} rows=${rows(r3).length}`);

    // 4
    const r4 = await rest(asA, `posts?id=eq.${postB}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ body: '成員 A 不該改得動成員 B 的貼文，這行不該被寫入。' }),
    });
    check('以成員 A 身分更新成員 B 的貼文被拒',
      r4.status === 403 || r4.status === 401 || rows(r4).length === 0,
      `status=${r4.status} rows=${rows(r4).length}`);

    // 5
    const r5 = await rest(asA, 'rooms?select=join_code');
    check('以成員身分查詢 rooms.join_code 被拒',
      deniedOrEmpty(r5), `status=${r5.status} rows=${rows(r5).length}`);

    // 6
    const r6 = await rest(asA, 'join_attempts?select=id');
    check('以成員身分查詢 join_attempts 被拒',
      deniedOrEmpty(r6), `status=${r6.status} rows=${rows(r6).length}`);

    // 7
    const r7 = await rest(asSuspended, 'posts?select=id');
    check('以 suspended 成員身分查詢 posts 回傳 0 列',
      deniedOrEmpty(r7), `status=${r7.status} rows=${rows(r7).length}`);

    // 8 與 9：§4.3 最容易寫反的一組
    const r89 = await rest(guest, 'posts_public?select=display_name,body');
    const bodies = rows(r89).map((x) => (x as { body: string }).body);
    check('suspended 成員的貼文不出現在 posts_public',
      !bodies.some((b) => b.includes('停權成員')),
      JSON.stringify(bodies));
    check('left 成員的貼文出現在 posts_public',
      bodies.some((b) => b.includes('退出成員')),
      JSON.stringify(bodies));

    // 退出由管理員在後台代為標記（admin.markMemberLeft），成員自己改不動。
    const rSelfLeave = await rest(asA, `room_members?id=eq.${memberA.memberId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'left' }),
    });
    check('成員無法自行把 status 改為 left（第一期由管理員代為標記）',
      rSelfLeave.status === 403 || rSelfLeave.status === 401 || rows(rSelfLeave).length === 0,
      `status=${rSelfLeave.status} rows=${rows(rSelfLeave).length}`);

    console.log('\n補充檢查');

    // migration 006：訪客看得到主題標題，但仍不得直接讀 themes 本表。
    const rThemePub = await rest(guest, 'themes_public?select=title&limit=1');
    check('訪客讀得到 themes_public（否則牆頁只會說「本週還沒有主題」而其實有）',
      rThemePub.status === 200 && rows(rThemePub).length === 1,
      `status=${rThemePub.status} rows=${rows(rThemePub).length}`);

    const rThemeRaw = await rest(guest, 'themes?select=title');
    check('訪客仍讀不到 themes 本表（006 只開 view，沒有動 RLS）',
      deniedOrEmpty(rThemeRaw), `status=${rThemeRaw.status} rows=${rows(rThemeRaw).length}`);

    // migration 007：soft_delete_post 是 security definer，會繞過 RLS，
    // 故它自己的授權判斷就是唯一防線，這三項專門打它。
    const victim = await createPost(memberB.memberId, '成員 B 的貼文，用來測試越權刪除。');
    const rStealDelete = await rest(asA, 'rpc/soft_delete_post', {
      method: 'POST',
      body: JSON.stringify({ p_id: victim }),
    });
    check('成員 A 無法以 RPC 刪除成員 B 的貼文（007 的 definer 函式自己把關）',
      rStealDelete.status >= 400, `status=${rStealDelete.status}`);

    const mine = await createPost(memberA.memberId, '成員 A 的貼文，用來測試期限內刪除。');
    const rSelfDelete = await rest(asA, 'rpc/soft_delete_post', {
      method: 'POST',
      body: JSON.stringify({ p_id: mine }),
    });
    check('作者刪得掉自己的貼文',
      rSelfDelete.status >= 200 && rSelfDelete.status < 300, `status=${rSelfDelete.status}`);

    const rAfter = await admin(
      `/rest/v1/posts?id=eq.${mine}&select=deleted_at,counts_toward_quota`,
    );
    const deleted = rows(rAfter)[0] as
      | { deleted_at: string | null; counts_toward_quota: boolean }
      | undefined;
    check('期限內刪除會把 counts_toward_quota 設為 false（ADR-0021）',
      deleted?.deleted_at !== null && deleted?.counts_toward_quota === false,
      JSON.stringify(deleted));

    // 另一半：ADR-0021 說「超過 20 分鐘就刪不掉」。回填 created_at 到 40 分鐘前，
    // 不必真的等。這是本次規則改動最要緊的一項——前端把按鈕藏起來只是禮貌，
    // 真正把關的是 migration 012 的 raise exception。
    const stale = await createPost(
      memberA.memberId,
      '成員 A 的舊貼文，用來測試逾期刪除會被拒絕。',
      new Date(Date.now() - 40 * 60_000),
    );
    await rest(asA, 'rpc/soft_delete_post', {
      method: 'POST',
      body: JSON.stringify({ p_id: stale }),
    });
    const rStale = await admin(`/rest/v1/posts?id=eq.${stale}&select=deleted_at,counts_toward_quota`);
    const staleRow = rows(rStale)[0] as
      | { deleted_at: string | null; counts_toward_quota: boolean }
      | undefined;
    // ADR-0021：逾期刪除現在會被 migration 012 直接拒絕，貼文維持未刪除狀態。
    check('逾期刪除被拒絕，貼文仍在（ADR-0021）',
      staleRow?.deleted_at === null,
      JSON.stringify(staleRow));

    // 光是欄位對還不夠：配額查詢必須真的把它算進去，否則欄位形同裝飾。
    const rCount = await admin(
      `/rest/v1/posts?select=id&author_id=eq.${memberA.memberId}` +
        `&week_start_date=eq.${weekStartOf()}&type=eq.free&counts_toward_quota=eq.true`,
    );
    check('逾期的貼文仍被配額查詢計入（它根本沒被刪掉）',
      rows(rCount).some((r) => (r as { id: string }).id === stale),
      `符合條件的列：${rows(rCount).length}`);

    // migration 005：§10.4 的 Viewer 判定必須能區分 orphan / suspended / left。
    // 001 的 members_select 是 is_active_member()，後兩者讀不到自己的列，
    // 在前端與「尚未加入」無從區分。005 放行自己那一列，這三項確認它有效且沒有擴權。
    const rSelfS = await rest(asSuspended, `room_members?select=status&user_id=eq.${suspended.userId}`);
    check('suspended 讀得到自己的 room_members 列（否則前端誤判為 orphan）',
      rSelfS.status === 200 && rows(rSelfS).length === 1,
      `status=${rSelfS.status} rows=${rows(rSelfS).length}`);

    const rSelfL = await rest(asLeft, `room_members?select=status&user_id=eq.${leftUser.userId}`);
    check('left 讀得到自己的 room_members 列（否則前端誤判為 orphan）',
      rSelfL.status === 200 && rows(rSelfL).length === 1,
      `status=${rSelfL.status} rows=${rows(rSelfL).length}`);

    // 005 只該放行「自己那一列」。若寫成放行整表，這一項會抓到。
    const rOthers = await rest(asSuspended, 'room_members?select=id');
    check('suspended 仍讀不到其他成員的列（確認 005 沒有擴權）',
      rOthers.status === 200 && rows(rOthers).length === 1,
      `status=${rOthers.status} rows=${rows(rOthers).length}`);

    const rA = await rest(asAdmin, 'rooms?select=join_code');
    check('管理員讀得到 join_code（否則後台無法顯示房間碼）',
      rA.status === 200 && rows(rA).length === 1,
      `status=${rA.status} rows=${rows(rA).length}`);

    const rM = await rest(asA, 'posts?select=id');
    check('成員讀得到 posts（否則牆頁對成員也是空的）',
      rM.status === 200 && rows(rM).length >= 3,
      `status=${rM.status} rows=${rows(rM).length}`);

    const rForge = await rest(asA, 'posts', {
      method: 'POST',
      body: JSON.stringify({
        room_id: ROOM_ID,
        author_id: memberB.memberId,      // 冒用他人身分
        type: 'free',
        image_path: 'x/x.jpg',
        thumb_path: 'x/x_thumb.jpg',
        body: '成員 A 冒用成員 B 的身分發文，這則不該被寫入。',
        week_start_date: new Date().toISOString().slice(0, 10),
      }),
    });
    check('成員無法以他人 author_id 發文',
      rForge.status >= 400, `status=${rForge.status}`);

    // ---- §15.2 優先序 4：mask_name 純函式 ----
    console.log('\nmigration 010：欄位層級權限（RLS 只管列，不管欄）');

    // 這一組是 2026-08-27 以一般成員的 JWT 直打 PostgREST 發現的。
    // posts_update policy 允許作者更新自己的貼文——而 policy 不認識欄位，
    // 於是「自己的貼文」等於「這一列的每一欄」。三項當時都成功。
    const owned = await createPost(memberA.memberId, '成員 A 的貼文，用來測試欄位層級權限。');

    for (const [column, value, why] of [
      ['counts_toward_quota', false, '自行回補配額，每週上限完全失效'],
      ['hidden_by_admin', false, '自行復原被管理員下架的貼文'],
      ['deleted_at', null, '自行還原已刪除的貼文'],
      ['rotation_deg', 3, '事後重擲旋轉角（§11.2 說發布時決定一次）'],
      ['week_start_date', '2020-01-06', '把貼文搬到別週，繞過當週配額'],
      // migration 011 刻意沒有把 title 加進 010 的 update grant：
      // 第一期沒有編輯功能，沒有任何路徑需要更新它。
      ['title', '被改掉的標題', '在沒有編輯功能的情況下改動牆上的文字'],
    ] as const) {
      const r = await rest(asA, `posts?id=eq.${owned}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ [column]: value }),
      });
      check(`成員改不動自己貼文的 ${column}（否則可${why}）`,
        r.status >= 400 || rows(r).length === 0, `status=${r.status}`);
    }

    // 修好權限如果順手把正常操作也擋死了會更糟，故兩個方向都驗。
    const rEdit = await rest(asA, `posts?id=eq.${owned}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ body: '作者改過的內文，一樣要過得了十個字。' }),
    });
    check('作者仍改得動自己貼文的內文（§9.5：編輯不影響配額）',
      rEdit.status === 200 && rows(rEdit).length === 1, `status=${rEdit.status}`);

    const rHideAsMember = await rest(asA, 'rpc/admin_set_post_hidden', {
      method: 'POST',
      body: JSON.stringify({ p_id: owned, p_hidden: true }),
    });
    check('一般成員呼叫 admin_set_post_hidden 被拒 ← definer 的唯一防線',
      rHideAsMember.status >= 400, `status=${rHideAsMember.status}`);

    const rHideAsAdmin = await rest(asAdmin, 'rpc/admin_set_post_hidden', {
      method: 'POST',
      body: JSON.stringify({ p_id: owned, p_hidden: true }),
    });
    check('管理員下架得了貼文', rHideAsAdmin.status < 300, `status=${rHideAsAdmin.status}`);

    console.log('\n管理員專屬操作，一般成員一律被拒');

    const rRoomWrite = await rest(asA, `rooms?id=eq.${ROOM_ID}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ name: '被改掉了', join_open: true }),
    });
    check('成員改不動房間設定（含 join_open 這個 §8.4 的開關）',
      deniedOrEmpty(rRoomWrite), `status=${rRoomWrite.status}`);

    const rSuspendAdmin = await rest(asA, `room_members?id=eq.${adminUser.memberId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'suspended' }),
    });
    check('成員停權不了管理員 ← 最惡劣的一種越權',
      deniedOrEmpty(rSuspendAdmin), `status=${rSuspendAdmin.status}`);

    const rSelfPromote = await rest(asA, `room_members?id=eq.${memberA.memberId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ role: 'admin' }),
    });
    check('成員無法把自己升為管理員',
      deniedOrEmpty(rSelfPromote), `status=${rSelfPromote.status}`);

    console.log('\nEdge Function：cleanup-posts（ADR-0009 的 30 天硬刪除）');

    // 這支函式以 service role 執行、繞過 RLS，所以它自己那段
    // 「以 auth.uid() 反查 room_members 確認是管理員」就是唯一的防線。
    const cAnon = await callFunction(guest, 'cleanup-posts');
    check('訪客無法觸發清理', cAnon === 401, `status=${cAnon}`);

    const cMember = await callFunction(asA, 'cleanup-posts');
    check('一般成員無法觸發清理 ← definer 等級權限的唯一防線', cMember === 403, `status=${cMember}`);

    // 測試資料都是剛建立的，沒有滿 30 天的貼文，故這一趟只驗權限與冪等，不會刪到東西。
    const cAdmin = await callFunction(asAdmin, 'cleanup-posts');
    check('管理員觸發得了清理', cAdmin === 200, `status=${cAdmin}`);

    console.log('\nmigration 003：Storage bucket 與 policy');

    const bucket = await admin(`/storage/v1/bucket/${POST_IMAGES_BUCKET}`);
    const cfg = bucket.body as {
      public?: boolean;
      file_size_limit?: number;
      allowed_mime_types?: string[];
    };
    check('bucket public = true（訪客不登入即可看照片牆，§10.3）',
      bucket.status === 200 && cfg.public === true, `status=${bucket.status} public=${cfg.public}`);
    check('bucket 大小上限 10 MB、MIME 限 jpeg/png/webp（§9.3）',
      cfg.file_size_limit === 10485760 &&
        JSON.stringify(cfg.allowed_mime_types) ===
          JSON.stringify(['image/jpeg', 'image/png', 'image/webp']),
      `${cfg.file_size_limit} ${JSON.stringify(cfg.allowed_mime_types)}`);

    const sOwn = await upload(`${memberA.userId}/verify.jpg`, memberA.token);
    check('成員上傳得到自己的 uid 資料夾（post_images_insert）', sOwn === 200, `status=${sOwn}`);

    // 這一項是 post_images_insert 的核心限制：路徑首層必須等於 auth.uid()。
    const sCross = await upload(`${memberB.userId}/stolen.jpg`, memberA.token);
    check('成員無法上傳到別人的資料夾', sCross >= 400, `status=${sCross}`);

    const sAnon = await upload(`${memberA.userId}/anon.jpg`, null);
    check('訪客無法上傳', sAnon >= 400, `status=${sAnon}`);

    const pub = await fetch(
      `${URL_BASE}/storage/v1/object/public/${POST_IMAGES_BUCKET}/${memberA.userId}/verify.jpg`,
    );
    check('訪客讀得到已上傳的圖（post_images_read + public bucket）',
      pub.status === 200, `status=${pub.status}`);
    // §9.4：Storage 預設 max-age 是 3600，會讓 egress 直接翻四倍。
    check('Cache-Control 依上傳時指定的一年送出（§9.4 的 egress 控制）',
      (pub.headers.get('cache-control') ?? '').includes(String(IMAGE_CACHE_SECONDS)),
      pub.headers.get('cache-control') ?? '(無)');

    console.log('\n§15.2 優先序 4：mask_name');

    const maskCases: Array<[string, string]> = [
      ['陳小明', '陳小O'],
      ['林大華強', '林大OO'],
      ['小明', '小O'],
      ['王', '王'],
      ['', ''],
      ['Alexander', 'AlOOOOOOO'],
    ];
    for (const [input, expected] of maskCases) {
      const r = await rest(guest, 'rpc/mask_name', {
        method: 'POST',
        body: JSON.stringify({ n: input }),
      });
      check(`mask_name(${JSON.stringify(input)}) = ${JSON.stringify(expected)}`,
        r.status === 200 && r.body === expected,
        `status=${r.status} got=${JSON.stringify(r.body)}`);
    }

    // ---- 前端與資料庫的週界必須算出同一個值（§7.3）----
    // 兩邊各自實作，在週日深夜與週一凌晨最容易分歧。
    // 分歧的後果是配額查詢與貼文歸屬用了不同的一週，而且完全不會報錯。
    const rWeek = await rest(guest, 'rpc/current_week_start', { method: 'POST', body: '{}' });
    check('資料庫的 current_week_start() 與前端的 weekStartOf() 一致',
      rWeek.status === 200 && rWeek.body === weekStartOf(),
      `db=${JSON.stringify(rWeek.body)} frontend=${weekStartOf()}`);

    const rJoin = await rest(asA, 'room_members', {
      method: 'POST',
      body: JSON.stringify({
        room_id: ROOM_ID,
        user_id: memberA.userId,
        display_name: '繞過房間碼',
      }),
    });
    check('登入者無法繞過 Edge Function 自行插入 room_members',
      rJoin.status >= 400, `status=${rJoin.status}`);
  } finally {
    console.log('\n清理測試資料…');
    // 檔案要先清：帳號一刪，uid 就查不回來，Storage 上會留下永久佔額度的孤兒檔。
    if (uploadedObjects.length > 0) {
      await admin(`/storage/v1/object/${POST_IMAGES_BUCKET}`, {
        method: 'DELETE',
        body: JSON.stringify({ prefixes: uploadedObjects }),
      });
    }
    await cleanup(created);
  }

  console.log(`\n通過 ${passed} 項，失敗 ${failed} 項`);
  if (failed > 0) {
    console.log('\n※ RLS 未全綠不得進入下一階段（§11.1 / §16）。');
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(2);
});
