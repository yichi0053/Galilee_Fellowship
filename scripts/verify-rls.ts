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

async function createPost(memberId: string, body: string): Promise<string> {
  const r = await admin('/rest/v1/posts', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      room_id: ROOM_ID,
      author_id: memberId,
      type: 'free',
      image_path: `${memberId}/x.jpg`,
      thumb_path: `${memberId}/x_thumb.jpg`,
      body,
      week_start_date: new Date().toISOString().slice(0, 10),
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

    console.log('\n補充檢查');

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
