/**
 * quota — 葉節點（架構書 §12.2）。
 *
 * 職責：配額計算與回補判定。規格見 §9.1 / ADR-0010、ADR-0015。
 *
 * 純規則在 ./rules.ts（internal，已有測試涵蓋 §15.4）；
 * 本檔只負責去資料庫拿數字，然後把結果交給那些規則。
 */

import { db, ROOM_ID } from '@db/client';
import { currentWeekStart } from '@domain/week';
import type { WeekStart } from '@domain/week';
import { POST_KINDS, remainingFrom } from './rules';
import type { PostKind, Remaining, UsedCounts } from './rules';

export type { PostKind } from './rules';
export {
  canPost,
  isWithinRefundWindow,
  refundableUntil,
  refundMsRemaining,
} from './rules';

export type QuotaState = {
  readonly week: WeekStart;
  readonly remaining: Remaining;
};

/**
 * 查詢某位成員在某一週已計入配額的篇數。
 *
 * 四個條件：author_id 相符、week_start_date 為當週、type 相符、
 * counts_toward_quota = true。
 *
 * **刻意不濾 deleted_at**，這一點與直覺相反，所以寫清楚：
 *
 * 「有沒有用掉配額」這件事完全由 counts_toward_quota 表達，而那個欄位是
 * migration 007 的 soft_delete_post 依伺服器時間決定的——回補期內刪除設為 false，
 * 逾期刪除維持 true。三種狀態各自對應：
 *
 *   未刪除            counts_toward_quota = true   → 計數
 *   回補期內刪除      counts_toward_quota = false  → 不計數（配額回補）
 *   逾期刪除          counts_toward_quota = true   → 仍計數（不回補，ADR-0010）
 *
 * 若再加上 deleted_at is null，第三種狀態會被排除在計數之外，
 * 於是**任何時候刪除都等於回補，ADR-0010 的回補期完全失去作用**。
 * 那個失效是安靜的：配額看起來永遠夠用，沒有人會察覺每週上限已經形同虛設。
 */
async function countUsed(memberId: string, week: WeekStart): Promise<UsedCounts> {
  const used: Record<PostKind, number> = { theme: 0, free: 0 };

  await Promise.all(
    POST_KINDS.map(async (kind) => {
      const { count, error } = await db
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('room_id', ROOM_ID)
        .eq('author_id', memberId)
        .eq('week_start_date', week)
        .eq('type', kind)
        .eq('counts_toward_quota', true);

      if (error) throw new Error(`查詢配額失敗（${kind}）：${error.message}`);
      used[kind] = count ?? 0;
    }),
  );

  return used;
}

/** 某位成員本週的剩餘配額 */
export async function getQuotaFor(memberId: string, week?: WeekStart): Promise<QuotaState> {
  const target = week ?? currentWeekStart();
  return { week: target, remaining: remainingFrom(await countUsed(memberId, target)) };
}
