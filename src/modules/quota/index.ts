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
 * §9.1 的五個條件缺一不可：author_id 相符、week_start_date 為當週、type 相符、
 * counts_toward_quota = true、deleted_at is null。
 * 漏掉 counts_toward_quota 的失敗模式是回補期內刪除後配額沒有回補，
 * 使用者只會覺得「這網站壞了」而不會回報。
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
        .eq('counts_toward_quota', true)
        .is('deleted_at', null);

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
