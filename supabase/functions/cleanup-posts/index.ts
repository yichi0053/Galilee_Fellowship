/**
 * cleanup-posts —— 軟刪除滿 30 天後的硬刪除（架構書 §9.5 / ADR-0009）。
 *
 * 為什麼這不是一支 SQL 函式：
 * 004 原本是，但 Supabase 禁止以 SQL 直接刪除 storage.objects
 * （42501: Direct deletion from storage tables is not allowed）。
 * 檔案只能經 Storage API 刪除，而那需要一個帶 service role 的執行環境。
 * migration 009 已把那支函式與 pg_cron 排程一併退場。
 *
 * **順序不可顛倒：先刪檔案，再刪資料列。**
 * 反過來的話，資料列一消失就再也查不到 image_path，
 * 檔案會變成永遠找不回來的孤兒，持續佔用 1 GB 額度且無從清理。
 *
 * 冪等：可重複執行，沒有到期的貼文時回報 0。
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const RETENTION_DAYS = 30; // ADR-0009
const BUCKET = 'post-images';

function cors(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    // 回送請求端問的那組，理由同 join-room：寫死的清單遲早漏掉 supabase-js 的新標頭，
    // 而漏掉時 preflight 仍回 200，瀏覽器靜靜擋下請求，伺服器端毫無記錄。
    'Access-Control-Allow-Headers':
      req.headers.get('Access-Control-Request-Headers') ??
      'authorization, content-type, apikey, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

/** 定時比較。與 join-room 同一份理由：這幾行的成本低到不值得留下一個要解釋的問題 */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const ROOM_ID = Deno.env.get('ROOM_ID')!;
  const CRON_SECRET = Deno.env.get('CLEANUP_CRON_SECRET') ?? '';

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // ---- 1. 兩種身分可以觸發：管理員本人，或帶著 cron secret 的排程 ----
  //
  // 排程那條路刻意不用 service role key：那把鑰匙繞過所有 RLS，
  // 放進 GitHub secrets 等於把整個資料庫的寫入權交出去。
  // 這個 secret 只能做一件事——觸發清理，而清理本身是冪等且只刪滿 30 天的東西。
  const presented = req.headers.get('x-cron-secret') ?? '';
  const viaCron =
    CRON_SECRET.length > 0 &&
    presented.length === CRON_SECRET.length &&
    timingSafeEqual(presented, CRON_SECRET);

  if (!viaCron) {
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: userData } = await asUser.auth.getUser();
    const user = userData?.user;
    if (!user) return json(req, { error: 'unauthenticated' }, 401);

    // service role 繞過 RLS，所以「你是不是管理員」必須自己查，
    // 且以 auth.uid() 反查 room_members，不信任呼叫端傳來的任何 id。
    const { data: member } = await admin
      .from('room_members')
      .select('role, status')
      .eq('room_id', ROOM_ID)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!member || member.role !== 'admin' || member.status !== 'active') {
      return json(req, { error: 'forbidden' }, 403);
    }
  }

  // ---- 2. 找出到期的貼文 ----
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const { data: doomed, error: selectError } = await admin
    .from('posts')
    .select('id, image_path, thumb_path')
    .eq('room_id', ROOM_ID)
    .not('deleted_at', 'is', null)
    .lt('deleted_at', cutoff);

  if (selectError) return json(req, { error: 'select_failed', detail: selectError.message }, 500);
  if (!doomed || doomed.length === 0) {
    return json(req, { ok: true, deletedRows: 0, deletedObjects: 0 });
  }

  // ---- 3. 先刪檔案 ----
  const paths = doomed.flatMap((p) => [p.image_path, p.thumb_path]);
  const { data: removed, error: storageError } = await admin.storage.from(BUCKET).remove(paths);

  if (storageError) {
    // 檔案沒刪成就不要動資料列：留著下次再試，總比留下查不到路徑的孤兒檔好。
    return json(req, { error: 'storage_failed', detail: storageError.message }, 500);
  }

  // ---- 4. 再刪資料列 ----
  const { error: deleteError } = await admin
    .from('posts')
    .delete()
    .in('id', doomed.map((p) => p.id));

  if (deleteError) {
    return json(req, { error: 'delete_failed', detail: deleteError.message }, 500);
  }

  return json(req, {
    ok: true,
    deletedRows: doomed.length,
    deletedObjects: removed?.length ?? paths.length,
  });
});
