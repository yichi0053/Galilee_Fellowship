/**
 * membership — 深模組（架構書 §12.2）。相依：auth。
 *
 * 職責：判定目前訪問者的身分，以及加入房間的流程。
 *
 * 最重要的一件事是**孤兒帳號**（§10.4）：完成 Google 授權但尚未加入任何房間的
 * auth user。使用者關閉頁面後再回來必須能接續，不可卡在空白畫面。
 * 這個狀態由 Viewer 型別明確表達，而不是靠 null 檢查散落各處。
 */

export type Viewer =
  /** 未登入 */
  | { readonly kind: 'guest' }
  /** 已登入但不在 room_members 中，須導向 /join 接續加入流程 */
  | { readonly kind: 'orphan'; readonly suggestedName: string | null }
  /** active 成員 */
  | { readonly kind: 'member'; readonly memberId: string; readonly displayName: string }
  /** active 且 role = admin。管理員繼承成員的全部權限（§4.1） */
  | { readonly kind: 'admin'; readonly memberId: string; readonly displayName: string }
  /** 已被停權，其貼文一律隱藏（§4.3） */
  | { readonly kind: 'suspended' }
  /** 自願退出，其貼文保留顯示（§4.3） */
  | { readonly kind: 'left' };

export class JoinClosedError extends Error {}
export class InvalidJoinCodeError extends Error {}
export class RateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('嘗試次數過多');
  }
}

/** 判定目前訪問者身分。每個頁面載入時呼叫一次 */
export async function getViewer(): Promise<Viewer> {
  throw new Error('T-04 未實作');
}

/** 便利判斷，避免 UI 到處寫 kind === 'member' || kind === 'admin' */
export function canPost(viewer: Viewer): boolean {
  return viewer.kind === 'member' || viewer.kind === 'admin';
}

export function isAdmin(viewer: Viewer): boolean {
  return viewer.kind === 'admin';
}

/**
 * 加入房間。內部呼叫 join-room Edge Function：
 * 驗 JWT → 查 join_open → rate limit → 比對房間碼 → 寫 join_attempts
 * → 成功則以 service role 建立 room_members 列。
 *
 * 前端無法自行插入 room_members（該表刻意沒有 INSERT policy）。
 */
export async function joinRoom(_joinCode: string, _displayName: string): Promise<Viewer> {
  throw new Error('T-07 未實作');
}
