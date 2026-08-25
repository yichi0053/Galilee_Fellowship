/**
 * quota — 葉節點（架構書 §12.2）。
 *
 * 職責：配額計算與回補判定。規格見 §9.1 / ADR-0010、ADR-0015。
 * 邊界條件密集，是 §15.2 優先序 2 的測試目標。實作於 T-06。
 */

import type { WeekStart } from '@domain/week';

export type PostKind = 'theme' | 'free';

export type QuotaState = {
  readonly week: WeekStart;
  readonly remaining: Readonly<Record<PostKind, number>>;
};

/** 查詢目前使用者本週的剩餘配額 */
export async function getMyQuota(): Promise<QuotaState> {
  throw new Error('T-06 未實作');
}

/**
 * 判定某則貼文於此刻刪除是否落在回補期內（發布後 10 分鐘）。
 * 呼叫端不需要知道 counts_toward_quota 這個欄位的存在。
 */
export function isWithinRefundWindow(_publishedAt: Date, _now?: Date): boolean {
  throw new Error('T-06 未實作');
}
