/**
 * auth — 葉節點（架構書 §12.2）。
 *
 * 職責：Google OAuth 的起始、callback 處理、目前 session 查詢。
 * 本模組只認識「登入的人」，完全不認識「房間成員」——後者是 membership 的職責。
 */

import type { User } from '@supabase/supabase-js';
import { db } from '@db/client';

export type AuthUser = {
  readonly id: string;
  readonly email: string | null;
  /** Google 提供的名稱，僅作為加入流程中顯示姓名欄位的預設值 */
  readonly suggestedName: string | null;
  /**
   * Google 提供的頭像網址（§10.2 的導覽列選單）。
   *
   * 這是 lh3.googleusercontent.com 上的第三方資源，不存進我們的資料庫——
   * 存了就得處理它過期、使用者換頭像、以及「已退出的人的臉還留著」這些問題。
   * 每個人只會在自己的畫面上看到自己的頭像，不會洩漏其他成員的任何東西。
   * 載不到時 UI 退回姓名首字，故此處為 null 是正常狀態而非錯誤。
   */
  readonly avatarUrl: string | null;
};

/**
 * supabase 的 User 帶著 provider token 等本模組以外不該看到的欄位，
 * 依 §12.4 規則 3 於此轉為 domain type，不讓它跨出模組邊界。
 */
function toAuthUser(user: User): AuthUser {
  const meta: Record<string, unknown> = user.user_metadata;
  // Google 兩個欄位都給，取到哪個都可以；缺了就讓使用者自己填。
  const name = meta['full_name'] ?? meta['name'];
  // Google 兩個頭像欄位也都給，取到哪個都可以。
  const avatar = meta['avatar_url'] ?? meta['picture'];
  return {
    id: user.id,
    email: user.email ?? null,
    suggestedName: typeof name === 'string' && name.length > 0 ? name : null,
    avatarUrl: typeof avatar === 'string' && avatar.length > 0 ? avatar : null,
  };
}

/** 觸發 Google OAuth。成功後導回 redirectTo（§10.4 流程 B 第 2 步導向 /join） */
export async function signInWithGoogle(redirectTo: string): Promise<void> {
  const { error } = await db.auth.signInWithOAuth({
    provider: 'google',
    // 轉成絕對網址：Supabase 會拿它跟 Dashboard 的 Redirect URLs 白名單比對，
    // 對不上時**不會報錯**，而是安靜地改導向 Site URL（docs/SETUP.md 第 2 節第 8 步）。
    options: { redirectTo: new URL(redirectTo, window.location.origin).toString() },
  });
  if (error) throw error;
  // 正常路徑上整個分頁已被導往 Google，本行之後的程式碼不會執行。
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  // 先看本機 session。訪客不需登入即可看牆（§10.3），是佔多數的路徑，
  // 這一支不打網路，避免每次開牆頁都多一次往返（§9.4）。
  const { data: local } = await db.auth.getSession();
  if (!local.session) return null;

  // 有 session 才向伺服器確認。只信任本機的話，帳號已在後台被刪除或停權時，
  // UI 會顯示為已登入、然後每個查詢都回空值——正是本專案最該避免的安靜失敗。
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) return null;
  return toAuthUser(data.user);
}

export async function signOut(): Promise<void> {
  const { error } = await db.auth.signOut();
  if (error) throw error;
}
