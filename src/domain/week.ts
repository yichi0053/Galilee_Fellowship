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
 */

/** 某週週一的日期，格式 YYYY-MM-DD（與 Postgres 的 date 對應） */
export type WeekStart = string & { readonly __brand: 'WeekStart' };

/** 給定時刻所屬的週界。預設為此刻 */
export function weekStartOf(_at: Date = new Date()): WeekStart {
  throw new Error('T-06 未實作');
}

/** 目前的週界 */
export function currentWeekStart(): WeekStart {
  return weekStartOf();
}

/** 相對於某週的前後 n 週，供週次選擇器與依週載入使用（n 為負代表往回） */
export function shiftWeeks(_week: WeekStart, _n: number): WeekStart {
  throw new Error('T-06 未實作');
}

/** 從資料庫回傳的 date 字串轉為 WeekStart。格式不符即拋錯，不做靜默修正 */
export function parseWeekStart(value: string): WeekStart {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`不是合法的週界日期：${value}`);
  }
  return value as WeekStart;
}
