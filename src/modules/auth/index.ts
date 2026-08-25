/**
 * auth — 葉節點（架構書 §12.2）。
 *
 * 職責：Google OAuth 的起始、callback 處理、目前 session 查詢。
 * 本模組只認識「登入的人」，完全不認識「房間成員」——後者是 membership 的職責。
 */

export type AuthUser = {
  readonly id: string;
  readonly email: string | null;
  /** Google 提供的名稱，僅作為加入流程中顯示姓名欄位的預設值 */
  readonly suggestedName: string | null;
};

/** 觸發 Google OAuth。成功後導回 redirectTo（§10.4 流程 B 第 2 步導向 /join） */
export async function signInWithGoogle(_redirectTo: string): Promise<void> {
  throw new Error('T-04 未實作');
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  throw new Error('T-04 未實作');
}

export async function signOut(): Promise<void> {
  throw new Error('T-04 未實作');
}

/** session 變動時通知（token refresh、其他分頁登出）。回傳取消訂閱函式 */
export function onAuthChange(_handler: (user: AuthUser | null) => void): () => void {
  throw new Error('T-04 未實作');
}
