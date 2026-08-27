/**
 * §15.2 優先序 2、§15.4 的配額測試案例。
 */
import { describe, expect, it } from 'vitest';
import { DELETE_WINDOW_MINUTES, QUOTA } from '@config/constants';
import {
  canPost,
  isWithinDeleteWindow,
  deleteMsRemaining,
  deletableUntil,
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

describe('可刪除期限（§9.5 / ADR-0021）', () => {
  it('§15.4：發文後 5 分鐘，還刪得掉', () => {
    expect(isWithinDeleteWindow(T0, after(5))).toBe(true);
  });

  it('發文後 15 分鐘，仍在 20 分鐘內，還刪得掉', () => {
    // 舊規則是 10 分鐘，這一項在改成 20 分鐘之後由 false 翻成 true。
    expect(isWithinDeleteWindow(T0, after(15))).toBe(true);
  });

  it('發文後 25 分鐘，刪不掉了', () => {
    expect(isWithinDeleteWindow(T0, after(25))).toBe(false);
  });

  it('第 20 分鐘整仍可刪（邊界採含）', () => {
    // UI 的倒數在 20:00 走到 0。這裡若採「不含」，使用者在讀秒歸零那一刻
    // 按下刪除會被拒絕，而且完全看不出原因。
    expect(isWithinDeleteWindow(T0, after(DELETE_WINDOW_MINUTES))).toBe(true);
  });

  it('第 20 分鐘又 1 毫秒刪不掉', () => {
    expect(isWithinDeleteWindow(T0, new Date(after(DELETE_WINDOW_MINUTES).getTime() + 1))).toBe(
      false,
    );
  });

  it('時鐘偏移導致 now 早於發布時刻時，視為仍在窗內', () => {
    // 誤差一律往有利使用者的方向倒：真正把關的是伺服器（migration 012）。
    expect(isWithinDeleteWindow(T0, after(-30))).toBe(true);
  });
});

describe('倒數顯示', () => {
  it('剛發布時為完整的 20 分鐘', () => {
    expect(deleteMsRemaining(T0, T0)).toBe(DELETE_WINDOW_MINUTES * 60_000);
  });

  it('逾期後為 0，不會變負數', () => {
    expect(deleteMsRemaining(T0, after(30))).toBe(0);
  });

  it('deletableUntil 在窗內回傳截止時刻，逾期回傳 null', () => {
    expect(deletableUntil(T0, after(5))?.toISOString()).toBe('2026-08-26T04:20:00.000Z');
    expect(deletableUntil(T0, after(21))).toBeNull();
  });

  it('倒數與可刪判斷在邊界上一致', () => {
    const edge = after(DELETE_WINDOW_MINUTES);
    expect(isWithinDeleteWindow(T0, edge)).toBe(true);
    expect(deleteMsRemaining(T0, edge)).toBe(0);
    expect(deletableUntil(T0, edge)).not.toBeNull();
  });
});
