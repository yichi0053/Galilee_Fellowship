/**
 * join-room —— 房間碼驗證與 rate limit（架構書 §8.3、§10.4 流程 B）。
 *
 * 這是全案唯一的伺服器端邏輯。它存在的理由有三個：
 *
 * 1. room_members 刻意沒有 INSERT policy。若前端能自行插入成員列，
 *    任何登入者都可以無視房間碼直接加入，房間碼形同虛設。
 * 2. rate limit 必須在使用者碰不到的地方計數。
 * 3. 比對房間碼需要讀 rooms.join_code，而該欄位只有管理員讀得到。
 *
 * 流程順序為「先 Google 登入，再輸房間碼」（§10.4），
 * 因此這裡一定拿得到 user_id，rate limit 得以綁定帳號而不只綁 IP。
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const FAILURES_PER_USER_PER_HOUR = 10; // §8.3
const ATTEMPTS_PER_IP_PER_HOUR = 20; // §8.3
const LOCKOUT_SECONDS = 3600;
const DISPLAY_NAME_MAX = 20;

/**
 * Allow-Headers 回送瀏覽器問的那一組，而不是維護一份寫死的清單。
 *
 * supabase-js 會隨版本增減自己的標頭（x-client-info、x-supabase-api-version……），
 * 寫死的清單遲早漏掉其中一個。漏掉的失敗模式特別惡劣：preflight 仍然回 200，
 * 瀏覽器卻因為缺少該標頭而靜靜擋下正式請求，前端只看到
 * 「Failed to send a request to the Edge Function」——那是 fetch 沒送出去，
 * 不是伺服器回了錯誤，所以伺服器端的 log 什麼都沒有。
 *
 * 而且 curl 不執行 CORS，用 curl 測 preflight 一定會過，測不出這個問題。
 *
 * Allow-Origin 為 *，非 credentials 模式，故回送請求端的標頭清單不擴大任何權限；
 * 真正的把關是本函式自己的 getUser()。
 */
function cors(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      req.headers.get('Access-Control-Request-Headers') ?? 'authorization, content-type, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // 一天內不必為每個請求各跑一次 preflight（§9.4）
    'Access-Control-Max-Age': '86400',
  };
}

function json(
  req: Request,
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), ...extra, 'Content-Type': 'application/json' },
  });
}

/**
 * 定時比較。房間碼經過 rate limit 保護後，時序攻擊在實務上不可行，
 * 但這幾行的成本低到不值得為此留下一個需要解釋的問題。
 */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  // 長度不同時仍走完整個迴圈，避免由回應時間推斷長度
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

function clientIp(req: Request): string | null {
  // Supabase Edge Functions 位於代理之後，x-forwarded-for 的第一段才是原始來源。
  const forwarded = req.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const ROOM_ID = Deno.env.get('ROOM_ID')!;

  // ---- 1. 驗證身分 ----
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await asUser.auth.getUser();
  const user = userData?.user;
  if (!user) return json(req, { error: 'unauthenticated' }, 401);

  // service role client：以下所有資料庫操作都繞過 RLS，因此每一步都要自己把關。
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const ip = clientIp(req);

  // ---- 2. 已經是成員就直接回覆，不計入嘗試次數 ----
  // 使用者重新整理或按了兩次送出都會走到這裡，不該因此吃掉 rate limit 額度。
  const { data: existing } = await admin
    .from('room_members')
    .select('id, display_name, role, status')
    .eq('room_id', ROOM_ID)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing && existing.status === 'active') {
    return json(req, { ok: true, alreadyMember: true, member: existing });
  }
  if (existing && existing.status === 'suspended') {
    // 停權者不得用房間碼繞回來
    return json(req, { error: 'suspended' }, 403);
  }

  // ---- 3. Rate limit ----
  const since = new Date(Date.now() - 3600_000).toISOString();

  const { count: userFailures } = await admin
    .from('join_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('success', false)
    .gte('created_at', since);

  if ((userFailures ?? 0) >= FAILURES_PER_USER_PER_HOUR) {
    return json(req, { error: 'rate_limited', retryAfterSeconds: LOCKOUT_SECONDS }, 429, {
      'Retry-After': String(LOCKOUT_SECONDS),
    });
  }

  if (ip) {
    const { count: ipAttempts } = await admin
      .from('join_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('created_at', since);

    // IP 維度算的是全部嘗試而非只有失敗：同一個 IP 底下有整棟宿舍的情況，
    // 20 次/小時對 24 人的加入期而言仍然寬鬆。
    if ((ipAttempts ?? 0) >= ATTEMPTS_PER_IP_PER_HOUR) {
      return json(req, { error: 'rate_limited', retryAfterSeconds: LOCKOUT_SECONDS }, 429, {
        'Retry-After': String(LOCKOUT_SECONDS),
      });
    }
  }

  // ---- 4. 讀入並檢查輸入 ----
  let body: { joinCode?: unknown; displayName?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'bad_request' }, 400);
  }

  const joinCode = typeof body.joinCode === 'string' ? body.joinCode.trim() : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';

  if (!displayName || displayName.length > DISPLAY_NAME_MAX) {
    return json(req, { error: 'invalid_display_name', maxLength: DISPLAY_NAME_MAX }, 400);
  }

  const record = async (success: boolean): Promise<void> => {
    await admin.from('join_attempts').insert({
      room_id: ROOM_ID,
      user_id: user.id,
      ip,
      success,
    });
  };

  // ---- 5. 比對房間碼 ----
  const { data: room } = await admin
    .from('rooms')
    .select('join_code, join_open')
    .eq('id', ROOM_ID)
    .single();

  if (!room) {
    await record(false);
    return json(req, { error: 'invalid_code' }, 403);
  }

  if (!room.join_open) {
    // §8.4：24 人到齊後管理員關閉加入，此後房間碼失效。
    // 這是成本最低而效果最好的防護。
    await record(false);
    return json(req, { error: 'join_closed' }, 403);
  }

  if (!timingSafeEqual(joinCode, room.join_code)) {
    await record(false);
    // 不透露是房間碼錯還是房間不存在
    return json(req, { error: 'invalid_code' }, 403);
  }

  // ---- 6. 建立或恢復成員 ----
  // status = 'left' 的人再次加入時沿用同一列，貼文與作者的關聯因此保留（§4.3）。
  const { data: member, error } = existing
    ? await admin
        .from('room_members')
        .update({ status: 'active', display_name: displayName })
        .eq('id', existing.id)
        .select('id, display_name, role, status')
        .single()
    : await admin
        .from('room_members')
        .insert({
          room_id: ROOM_ID,
          user_id: user.id,
          display_name: displayName,
          role: 'member',
          status: 'active',
        })
        .select('id, display_name, role, status')
        .single();

  if (error) {
    await record(false);
    return json(req, { error: 'join_failed', detail: error.message }, 500);
  }

  await record(true);
  return json(req, { ok: true, alreadyMember: false, member });
});
