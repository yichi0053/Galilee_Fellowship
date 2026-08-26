/**
 * §15.2 優先序 2、§15.4 的配額測試案例。
 */
import { describe, expect, it } from 'vitest';
import { QUOTA, REFUND_WINDOW_MINUTES } from '@config/constants';
import {
  canPost,
  isWithinRefundWindow,
  refundMsRemaining,
  refundableUntil,
  remainingFrom,
} from './rules';

const T0 = new Date('2026-08-26T04:00:00Z');
const after = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);

describe('配額上限（ADR-0015）', () => {
  it('每週 1 主題加 2 自由', () => {
    expect(QUOTA).toEqual({ theme: 1, free: 2 });
  });

  it('尚未發文時為滿額', () => {
    expect(remainingFrom({ theme: 0, free: 0 })).toEqual({ theme: 1, free: 2 });
  });

  it('§15.4：發文 1 篇主題後，主題剩 0、自由剩 2', () => {
    expect(remainingFrom({ theme: 1, free: 0 })).toEqual({ theme: 0, free: 2 });
  });

  it('兩種類型互不影響', () => {
    expect(remainingFrom({ theme: 0, free: 2 })).toEqual({ theme: 1, free: 0 });
  });

  it('已用數超過上限時顯示 0 而非負數', () => {
    expect(remainingFrom({ theme: 3, free: 9 })).toEqual({ theme: 0, free: 0 });
  });
});

describe('canPost', () => {
  it('額滿的類型不可發文（§10.5：已用完的類型呈灰階）', () => {
    const remaining = remainingFrom({ theme: 1, free: 0 });
    expect(canPost('theme', remaining)).toBe(false);
    expect(canPost('free', remaining)).toBe(true);
  });
});

describe('回補期（§9.1 / ADR-0010）', () => {
  it('§15.4：發文後 5 分鐘刪除，落在回補期內', () => {
    expect(isWithinRefundWindow(T0, after(5))).toBe(true);
  });

  it('§15.4：發文後 15 分鐘刪除，不在回補期內', () => {
    expect(isWithinRefundWindow(T0, after(15))).toBe(false);
  });

  it('第 10 分鐘整仍回補（邊界採含）', () => {
    expect(isWithinRefundWindow(T0, after(REFUND_WINDOW_MINUTES))).toBe(true);
  });

  it('第 10 分鐘又 1 毫秒不回補', () => {
    expect(isWithinRefundWindow(T0, new Date(after(REFUND_WINDOW_MINUTES).getTime() + 1))).toBe(
      false,
    );
  });

  it('時鐘偏移導致 now 早於發布時刻時，視為仍在窗內', () => {
    expect(isWithinRefundWindow(T0, after(-30))).toBe(true);
  });
});

describe('倒數顯示', () => {
  it('剛發布時為完整的 10 分鐘', () => {
    expect(refundMsRemaining(T0, T0)).toBe(REFUND_WINDOW_MINUTES * 60_000);
  });

  it('逾期後為 0，不會變負數', () => {
    expect(refundMsRemaining(T0, after(30))).toBe(0);
  });

  it('refundableUntil 在窗內回傳截止時刻，逾期回傳 null', () => {
    expect(refundableUntil(T0, after(5))?.toISOString()).toBe('2026-08-26T04:10:00.000Z');
    expect(refundableUntil(T0, after(11))).toBeNull();
  });

  it('倒數與回補判斷在邊界上一致', () => {
    const edge = after(REFUND_WINDOW_MINUTES);
    expect(isWithinRefundWindow(T0, edge)).toBe(true);
    expect(refundMsRemaining(T0, edge)).toBe(0);
    expect(refundableUntil(T0, edge)).not.toBeNull();
  });
});
