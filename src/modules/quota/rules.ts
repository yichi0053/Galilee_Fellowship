/**
 * quota 的純規則。internal 檔案，不得跨 module import（§12.4 規則 1）。
 *
 * 這裡刻意不碰資料庫：配額的邊界條件密集（§15.2 優先序 2），
 * 把判斷抽成純函式才測得動。index.ts 負責取數字，這裡負責決定意義。
 */

import { DELETE_WINDOW_MINUTES, QUOTA } from '@config/constants';

export type PostKind = 'theme' | 'free';

export const POST_KINDS: readonly PostKind[] = ['theme', 'free'] as const;

export type UsedCounts = Readonly<Record<PostKind, number>>;
export type Remaining = Readonly<Record<PostKind, number>>;

const DELETE_WINDOW_MS = DELETE_WINDOW_MINUTES * 60 * 1000;

/**
 * 由「已計入配額的篇數」算出剩餘配額。
 *
 * 傳入的 used 只應包含 counts_toward_quota = true 且 deleted_at is null 的貼文
 * （§9.1 的五個條件）。期限內刪除的貼文不在其中，因此不需要在這裡扣回來。
 */
export function remainingFrom(used: UsedCounts): Remaining {
  return {
    // 夾在 0 以上：管理員手動改資料或舊資料可能讓已用數超過上限，
    // 那種情況該顯示「剩 0」，不是負數。
    theme: Math.max(0, QUOTA.theme - used.theme),
    free: Math.max(0, QUOTA.free - used.free),
  };
}

export function canPost(kind: PostKind, remaining: Remaining): boolean {
  return remaining[kind] > 0;
}

/**
 * 此刻是否還刪得掉（§9.5 / ADR-0021：發布後 20 分鐘）。
 *
 * 邊界採「含」：剛好第 20 分鐘整仍可刪。
 * UI 的倒數在 20:00 走到 0，若這裡用「不含」，使用者在讀秒歸零那一刻按下刪除
 * 會被拒絕，且完全看不出原因。時鐘誤差也一律往有利使用者的方向倒。
 *
 * ※ 真正算數的是伺服器端的 created_at 與 now()（migration 012）。
 *   前端這份只用來畫倒數與決定按鈕要不要出現，不可拿來當授權判斷——
 *   使用者改本機時鐘就能騙過它，但騙不過資料庫。
 */
export function isWithinDeleteWindow(publishedAt: Date, now: Date = new Date()): boolean {
  const elapsed = now.getTime() - publishedAt.getTime();
  // 負的 elapsed 代表時鐘偏移或資料有誤，視為仍在窗內。
  return elapsed <= DELETE_WINDOW_MS;
}

/** 可刪除的截止時刻。已逾期回傳 null，讓 UI 不必自己再算一次 */
export function deletableUntil(publishedAt: Date, now: Date = new Date()): Date | null {
  const deadline = new Date(publishedAt.getTime() + DELETE_WINDOW_MS);
  return now.getTime() <= deadline.getTime() ? deadline : null;
}

/** 倒數剩餘毫秒，供卡片上的提示使用。已逾期為 0 */
export function deleteMsRemaining(publishedAt: Date, now: Date = new Date()): number {
  return Math.max(0, publishedAt.getTime() + DELETE_WINDOW_MS - now.getTime());
}
