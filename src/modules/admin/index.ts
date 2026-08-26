/**
 * admin — 深模組（架構書 §12.2）。相依：membership、posts、themes。
 *
 * 職責：管理後台四分頁所需的全部操作（§9.7）。
 * 所有函式都預設呼叫者為管理員；真正的授權在 RLS，此處不做前端把關以外的假設。
 */
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
export async function getRoomSettings(): Promise<RoomSettings> {
  throw new Error('T-10 未實作');
}

export async function updateRoomSettings(_patch: Partial<RoomSettings>): Promise<RoomSettings> {
  throw new Error('T-10 未實作');
}

// ---- 分頁 3：成員管理 ----
export async function listMembers(): Promise<ReadonlyArray<MemberSummary>> {
  throw new Error('T-10 未實作');
}

export async function suspendMember(_memberId: string): Promise<void> {
  throw new Error('T-10 未實作');
}

export async function reinstateMember(_memberId: string): Promise<void> {
  throw new Error('T-10 未實作');
}

/**
 * 代為標記某位成員為「已退出」（status = 'left'）。
 *
 * 第一期沒有讓成員自行退出的頁面：§10.1 的頁面清單裡沒有，
 * 而 members_update policy 是管理員限定，成員改不了自己的 status。
 * 想退出的人私訊管理員，由管理員在成員管理分頁按這顆按鈕。
 *
 * 與 suspendMember 的差別是貼文的處置，這是 §4.3 最容易寫反的一組：
 *   left      → 貼文**保留顯示**，作者名稱維持原樣
 *   suspended → 貼文**一律隱藏**
 * posts_public 的 where 條件只排除 suspended，所以資料庫那邊已經是對的；
 * 這裡要小心的是別把兩顆按鈕接反。
 */
export async function markMemberLeft(_memberId: string): Promise<void> {
  throw new Error('T-10 未實作');
}

export async function listJoinAttempts(): Promise<ReadonlyArray<JoinAttempt>> {
  throw new Error('T-10 未實作');
}

// ---- 分頁 4：貼文管理 ----
export async function hidePost(_id: PostId): Promise<void> {
  throw new Error('T-10 未實作');
}

export async function unhidePost(_id: PostId): Promise<void> {
  throw new Error('T-10 未實作');
}

/** 已軟刪除且未逾 30 天的貼文（§9.7） */
export async function listSoftDeleted(): Promise<ReadonlyArray<{ id: PostId; deletedAt: Date }>> {
  throw new Error('T-10 未實作');
}

/**
 * 觸發 30 天硬刪除清理。pg_cron 不可用時的替代路徑（ADR-0009），
 * 由管理員登入後台時呼叫。函式為冪等，可重複執行。
 */
export async function runCleanup(): Promise<{ deletedRows: number; deletedObjects: number }> {
  throw new Error('T-13 未實作');
}
