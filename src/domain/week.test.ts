/**
 * §15.2 優先序 3：週界計算。
 * 時區陷阱密集，UTC 與 Asia/Taipei 的差異在週日晚間與週一凌晨會出錯。
 */
import { describe, expect, it } from 'vitest';
import { parseWeekStart, shiftWeeks, weekBounds, weekStartOf, weeksBetween } from './week';

// 2026-08-24 是星期一，2026-08-26 是星期三。
const MON = parseWeekStart('2026-08-24');
const PREV_MON = parseWeekStart('2026-08-17');

describe('weekStartOf', () => {
  it('週三回傳當週週一', () => {
    expect(weekStartOf(new Date('2026-08-26T04:00:00Z'))).toBe(MON);
  });

  it('週一當天回傳自己', () => {
    expect(weekStartOf(new Date('2026-08-24T06:00:00Z'))).toBe(MON);
  });

  it('週日回傳同一週的週一，而不是隔天', () => {
    // 台灣時間 2026-08-30（日）中午
    expect(weekStartOf(new Date('2026-08-30T04:00:00Z'))).toBe(MON);
  });

  describe('週界前後一秒（§15.4：週一 00:00 前後各發 1 篇應分屬不同週）', () => {
    // 台灣時間 2026-08-24 00:00 = UTC 2026-08-23 16:00
    it('週界前一秒屬於上一週', () => {
      expect(weekStartOf(new Date('2026-08-23T15:59:59Z'))).toBe(PREV_MON);
    });

    it('週界當下屬於新的一週', () => {
      expect(weekStartOf(new Date('2026-08-23T16:00:00Z'))).toBe(MON);
    });
  });

  it('UTC 仍是週日、台灣已是週一的時段，算作新的一週', () => {
    // UTC 2026-08-23（日）20:00 = 台灣 2026-08-24（一）04:00
    // 這是最容易寫錯的一格：若誤用 UTC 的星期，會歸到上一週
    expect(weekStartOf(new Date('2026-08-23T20:00:00Z'))).toBe(MON);
  });

  it('UTC 已是週一、台灣仍是週一（同一週），不會多跳一週', () => {
    expect(weekStartOf(new Date('2026-08-24T23:00:00Z'))).toBe(MON);
  });

  it('跨月與跨年不出錯', () => {
    // 2027-01-01 是星期五，該週週一為 2026-12-28
    expect(weekStartOf(new Date('2027-01-01T04:00:00Z'))).toBe('2026-12-28');
  });

  it('不受執行環境時區影響', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      expect(weekStartOf(new Date('2026-08-23T20:00:00Z'))).toBe(MON);
      process.env.TZ = 'UTC';
      expect(weekStartOf(new Date('2026-08-23T20:00:00Z'))).toBe(MON);
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('shiftWeeks', () => {
  it('往前往後各一週', () => {
    expect(shiftWeeks(MON, -1)).toBe(PREV_MON);
    expect(shiftWeeks(MON, 1)).toBe('2026-08-31');
  });

  it('0 為恆等', () => {
    expect(shiftWeeks(MON, 0)).toBe(MON);
  });

  it('跨年往前 18 週仍落在週一', () => {
    const back = shiftWeeks(MON, -18);
    expect(back).toBe('2026-04-20');
    expect(weekStartOf(new Date(`${back}T06:00:00Z`))).toBe(back);
  });
});

describe('weeksBetween', () => {
  it('計算活動進行到第幾週', () => {
    expect(weeksBetween(PREV_MON, MON)).toBe(1);
    expect(weeksBetween(MON, MON)).toBe(0);
    expect(weeksBetween(MON, shiftWeeks(MON, 17))).toBe(17);
  });
});

describe('weekBounds', () => {
  it('區間起點為台灣時間週一 00:00', () => {
    expect(weekBounds(MON).start.toISOString()).toBe('2026-08-23T16:00:00.000Z');
  });

  it('區間為前閉後開，長度剛好七天', () => {
    const { start, end } = weekBounds(MON);
    expect(end.getTime() - start.getTime()).toBe(7 * 86_400_000);
    expect(weekStartOf(start)).toBe(MON);
    expect(weekStartOf(new Date(end.getTime() - 1))).toBe(MON);
    expect(weekStartOf(end)).toBe('2026-08-31');
  });
});

describe('parseWeekStart', () => {
  it('格式不符即拋錯，不做靜默修正', () => {
    expect(() => parseWeekStart('2026-8-24')).toThrow();
    expect(() => parseWeekStart('')).toThrow();
    expect(() => parseWeekStart('2026-08-24T00:00:00Z')).toThrow();
  });
});
