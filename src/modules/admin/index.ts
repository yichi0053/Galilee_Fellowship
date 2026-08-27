/**
 * admin — 深模組（架構書 §12.2）。相依：membership、posts、themes。
 *
 * 職責：管理後台四分頁所需的全部操作（§9.7）。
 * 所有函式都預設呼叫者為管理員；真正的授權在 RLS，此處不做前端把關以外的假設。
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import { JOIN_CODE_MIN_LENGTH } from '@config/constants';
import { db, ROOM_ID } from '@db/client';
import { publicImageUrl } from '@modules/posts';
import type { PostId } from '@modules/posts';

export type RoomSettings = {
  readonly name: string;
  readonly description: string | null;
  readonly backgroundImageUrl: string | null;
  readonly joinCode: string;
  readonly joinOpen: boolean;
};

export type MemberSummary = {
  readonly memberId: string;
  readonly displayName: string;
  readonly role: 'member' | 'admin';
  readonly status: 'active' | 'suspended' | 'left';
  readonly joinedAt: Date;
};

export type JoinAttempt = {
  readonly displayName: string | null;
  readonly success: boolean;
  readonly at: Date;
};

/** 房間碼強度不足（§8.2：最低 12 字元、禁止清單） */
export class WeakJoinCodeError extends Error {}

// ---- 分頁 1：房間設定 ----

/**
 * §8.2 的禁止清單。長度以資料庫的 check constraint 把關，
 * 「12 個字但是 aaaaaaaaaaaa」則要在這裡擋——字元類別規則是熵的劣質代理指標，
 * 與其發明一套規則，不如列出實際會被想到的那幾個。
 */
const BANNED_JOIN_CODES = [
  'dev-only-join-code-0000',
  'password0000',
  '000000000000',
  '123456789012',
  'aaaaaaaaaaaa',
];

function assertStrongJoinCode(code: string): void {
  const trimmed = code.trim();
  if (trimmed.length < JOIN_CODE_MIN_LENGTH) {
    throw new WeakJoinCodeError(`房間碼至少要 ${JOIN_CODE_MIN_LENGTH} 個字元。`);
  }
  if (BANNED_JOIN_CODES.includes(trimmed.toLowerCase())) {
    throw new WeakJoinCodeError('這個房間碼太好猜了，換一個。');
  }
  if (new Set(trimmed).size < 4) {
    throw new WeakJoinCodeError('房間碼的字元變化太少，換一個。');
  }
}

export async function getRoomSettings(): Promise<RoomSettings> {
  // rooms_select policy 是 is_admin(id)：非管理員在這裡會拿到 0 列而不是錯誤。
  const { data, error } = await db
    .from('rooms')
    .select('name, description, background_image_url, join_code, join_open')
    .eq('id', ROOM_ID)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('讀不到房間設定。只有管理員看得到這一頁。');

  return {
    name: data.name,
    description: data.description,
    backgroundImageUrl: data.background_image_url,
    joinCode: data.join_code,
    joinOpen: data.join_open,
  };
}

export async function updateRoomSettings(patch: Partial<RoomSettings>): Promise<RoomSettings> {
  if (patch.joinCode !== undefined) assertStrongJoinCode(patch.joinCode);

  const row = {
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.backgroundImageUrl !== undefined
      ? { background_image_url: patch.backgroundImageUrl }
      : {}),
    ...(patch.joinCode !== undefined ? { join_code: patch.joinCode.trim() } : {}),
    ...(patch.joinOpen !== undefined ? { join_open: patch.joinOpen } : {}),
  };

  const { error } = await db.from('rooms').update(row).eq('id', ROOM_ID);
  if (error) throw new Error(`更新房間設定失敗：${error.message}`);
  return getRoomSettings();
}

// ---- 分頁 3：成員管理 ----

export async function listMembers(): Promise<ReadonlyArray<MemberSummary>> {
  const { data, error } = await db
    .from('room_members')
    .select('id, display_name, role, status, joined_at')
    .eq('room_id', ROOM_ID)
    .order('joined_at', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((m) => ({
    memberId: m.id,
    displayName: m.display_name,
    role: m.role,
    status: m.status,
    joinedAt: new Date(m.joined_at),
  }));
}

/**
 * 走 migration 013 的 definer 函式，不是直接 UPDATE。
 *
 * 那支 migration 為了讓成員能編輯自己的個人檔案，把 room_members 的 UPDATE
 * 收窄到四個欄位——status 與 role 不在其中，任何角色都改不動。
 * 少了這道，成員只要一個 PATCH 就能把自己的 role 設成 admin。
 *
 * 授權與「不可停權管理員」的判斷都在函式內以 auth.uid() 重做一次，
 * 前端這裡不做也不能做（ADR-0014：停掉唯一的管理員就沒有人能把它復權了）。
 */
async function setStatus(memberId: string, status: MemberSummary['status']): Promise<void> {
  const { error } = await db.rpc('admin_set_member_status', {
    p_member_id: memberId,
    p_status: status,
  });
  if (error) throw new Error(`更新成員狀態失敗：${error.message}`);
}

export async function suspendMember(memberId: string): Promise<void> {
  return setStatus(memberId, 'suspended');
}

export async function reinstateMember(memberId: string): Promise<void> {
  return setStatus(memberId, 'active');
}

export async function markMemberLeft(memberId: string): Promise<void> {
  return setStatus(memberId, 'left');
}

export async function listJoinAttempts(): Promise<ReadonlyArray<JoinAttempt>> {
  const [attempts, members] = await Promise.all([
    db
      .from('join_attempts')
      .select('user_id, success, created_at')
      .eq('room_id', ROOM_ID)
      .order('created_at', { ascending: false })
      .limit(50),
    db.from('room_members').select('user_id, display_name').eq('room_id', ROOM_ID),
  ]);

  if (attempts.error) throw attempts.error;
  if (members.error) throw members.error;

  // join_attempts 與 room_members 之間沒有外鍵（前者的 user_id 指向 auth.users），
  // PostgREST 無法自動 embed，故在這裡對起來。查不到名字是正常的——
  // 失敗的嘗試多半來自還沒加入的人，那正是這份清單要看的東西。
  const nameByUser = new Map((members.data ?? []).map((m) => [m.user_id, m.display_name]));

  return (attempts.data ?? []).map((a) => ({
    displayName: a.user_id === null ? null : (nameByUser.get(a.user_id) ?? null),
    success: a.success,
    at: new Date(a.created_at),
  }));
}

// ---- 分頁 4：貼文管理 ----

/**
 * 下架與復原（§9.5）。與作者的刪除是兩件事：
 * 下架設 hidden_by_admin，貼文仍在、作者仍看得到佔位，配額也不變動。
 *
 * 走 migration 010 的 admin_set_post_hidden 而不是直接 UPDATE：
 * 該欄位的直接寫入權限已經收回。先前它是可以直接改的，
 * 於是被下架的作者只要打一次 PostgREST 就能把自己的貼文放回來。
 */
async function setHidden(id: PostId, hidden: boolean): Promise<void> {
  const { error } = await db.rpc('admin_set_post_hidden', { p_id: id, p_hidden: hidden });
  if (error) throw new Error(`${hidden ? '下架' : '復原'}失敗：${error.message}`);
}

export async function hidePost(id: PostId): Promise<void> {
  return setHidden(id, true);
}

export async function unhidePost(id: PostId): Promise<void> {
  return setHidden(id, false);
}

/**
 * 目前被下架、尚未刪除的貼文（§9.7）。
 *
 * 為什麼後台需要這一份清單：下架的入口在每則貼文自己的頁面，
 * 但**下架之後那則貼文就從所有人的牆上消失了**——包含管理員自己的。
 * 只有作者看得到佔位，管理員反而找不回自己下架過什麼。
 * 沒有這份清單，「放回架上」實務上做不到。
 */
export type HiddenPost = {
  readonly id: PostId;
  readonly title: string;
  readonly authorName: string;
  readonly week: string;
  readonly createdAt: Date;
  readonly thumbUrl: string;
};

export async function listHidden(): Promise<ReadonlyArray<HiddenPost>> {
  const { data, error } = await db
    .from('posts')
    .select('id, title, thumb_path, week_start_date, created_at, room_members!inner(display_name)')
    .eq('room_id', ROOM_ID)
    .eq('hidden_by_admin', true)
    // 已刪除的不列：那些歸「等待清理」管，兩份清單重疊只會讓人不知道該按哪個。
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id as PostId,
    title: row.title,
    authorName: row.room_members.display_name,
    week: row.week_start_date,
    createdAt: new Date(row.created_at),
    thumbUrl: publicImageUrl(row.thumb_path),
  }));
}

/** 已軟刪除且未逾 30 天的貼文（§9.7） */
export async function listSoftDeleted(): Promise<ReadonlyArray<{ id: PostId; deletedAt: Date }>> {
  const { data, error } = await db
    .from('posts')
    .select('id, deleted_at')
    .eq('room_id', ROOM_ID)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: true });

  if (error) throw error;
  return (data ?? [])
    .filter((p): p is { id: string; deleted_at: string } => p.deleted_at !== null)
    .map((p) => ({ id: p.id as PostId, deletedAt: new Date(p.deleted_at) }));
}

/**
 * 觸發 30 天硬刪除清理（ADR-0009）。冪等，可重複執行。
 *
 * 這件事不能在瀏覽器做，也不能是一支 SQL 函式：
 * Storage 的檔案只能經 Storage API 刪除，而那需要 service role。
 * 004 原本寫成 SQL 函式，但 Supabase 禁止以 SQL 直接刪 storage.objects，
 * 那支函式從來沒有成功執行過（migration 009 已將它與 pg_cron 排程一併退場）。
 *
 * 現在走 cleanup-posts Edge Function：先刪檔案再刪資料列，
 * 且它自己會以 auth.uid() 反查 room_members 確認呼叫者是管理員。
 */
export async function runCleanup(): Promise<{ deletedRows: number; deletedObjects: number }> {
  const { data, error } = await db.functions.invoke<{
    ok: true;
    deletedRows: number;
    deletedObjects: number;
  }>('cleanup-posts', { body: {} });

  if (error) {
    if (!(error instanceof FunctionsHttpError)) throw error;
    const payload = ((await (error.context as Response).json().catch(() => null)) ?? {}) as {
      error?: string;
      detail?: string;
    };
    if (payload.error === 'forbidden') throw new Error('只有管理員可以執行清理。');
    if (payload.error === 'unauthenticated') throw new Error('尚未登入。');
    throw new Error(`清理失敗：${payload.detail ?? payload.error ?? error.message}`);
  }

  if (!data) throw new Error('cleanup-posts 沒有回傳內容。');
  return { deletedRows: data.deletedRows, deletedObjects: data.deletedObjects };
}
