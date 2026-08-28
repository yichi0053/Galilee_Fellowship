/**
 * 週界（week boundary）—— 台灣時間 Asia/Taipei 週一 00:00（架構書 §7.3、§3 詞彙表）。
 *
 * 這是 domain 層而非 module：quota、themes、posts 都需要它，
 * 若讓它住在 quota 之中，themes 就必須相依於 quota，而 §12.3 規定兩者皆為葉節點。
 * 共享語言中的基礎詞彙屬於 shared kernel，不屬於任何一個 module。
 *
 * 時區陷阱密集，是 §15.2 優先序 3 的測試目標。
 * 前端與資料庫的 current_week_start() 必須算出同一個值，
 * 兩邊在週日深夜與週一凌晨最容易分歧。
 *
 * 實作刻意不用 Date 的本地時區方法（getDay、getDate 等）。
 * 那些方法回傳的是「執行環境所在時區」的值，開發機在台灣時碰巧正確，
 * 到了 CI 或使用者手機改時區就安靜地算錯一週。
 */

import { WEEK_BOUNDARY_TIMEZONE } from '@config/constants';

/** 某週週一的日期，格式 YYYY-MM-DD（與 Postgres 的 date 對應） */
export type WeekStart = string & { readonly __brand: 'WeekStart' };

const DAY_MS = 86_400_000;
const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

const taipeiFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: WEEK_BOUNDARY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
});

/** 把一個時刻換算為台灣當地的日曆日與星期 */
function taipeiCivilDate(at: Date): { civilMs: number; weekdayFromMonday: number } {
  const parts = taipeiFormatter.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`Intl 未提供 ${type}`);
    return found.value;
  };

  const weekdayFromMonday = WEEKDAY_INDEX[get('weekday')];
  if (weekdayFromMonday === undefined) {
    throw new Error(`無法解析星期：${get('weekday')}`);
  }

  // 取得台灣當地的年月日後，改以 UTC 做日期算術。
  // 這一步之後就只剩下純日曆運算，不再有時區參與。
  const civilMs = Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')));

  return { civilMs, weekdayFromMonday };
}

function formatCivil(civilMs: number): WeekStart {
  return new Date(civilMs).toISOString().slice(0, 10) as WeekStart;
}

/** 給定時刻所屬的週界。預設為此刻 */
export function weekStartOf(at: Date = new Date()): WeekStart {
  const { civilMs, weekdayFromMonday } = taipeiCivilDate(at);
  return formatCivil(civilMs - weekdayFromMonday * DAY_MS);
}

/** 目前的週界 */
export function currentWeekStart(): WeekStart {
  return weekStartOf();
}

/** 相對於某週的前後 n 週，供週次選擇器與依週載入使用（n 為負代表往回） */
export function shiftWeeks(week: WeekStart, n: number): WeekStart {
  return formatCivil(Date.parse(`${week}T00:00:00Z`) + n * 7 * DAY_MS);
}

/** 從資料庫回傳的 date 字串轉為 WeekStart。格式不符即拋錯，不做靜默修正 */
export function parseWeekStart(value: string): WeekStart {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`不是合法的週界日期：${value}`);
  }
  return value as WeekStart;
}

/** 兩個週界相差幾週。用於算出某週是活動的第幾週 */
export function weeksBetween(from: WeekStart, to: WeekStart): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (7 * DAY_MS));
}
