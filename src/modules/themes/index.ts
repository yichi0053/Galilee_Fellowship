/**
 * themes — 葉節點（架構書 §12.2）。
 *
 * 職責：每週主題的查詢與（管理員）預排。規格見 §9.6。
 * 空窗週會導致該週發文量斷崖下滑，故預排為必要功能而非便利功能。
 */
import type { WeekStart } from '@domain/week';

export type Theme = {
  readonly id: string;
  readonly week: WeekStart;
  readonly title: string;
  readonly description: string | null;
};

/** 本週主題。無設定時回傳 null，UI 須顯示「本週尚未設定主題」而非崩潰 */
export async function getCurrentTheme(): Promise<Theme | null> {
  throw new Error('T-06 未實作');
}

/** 指定週次的主題，供瀏覽舊週次時顯示 */
export async function getThemeForWeek(_week: WeekStart): Promise<Theme | null> {
  throw new Error('T-06 未實作');
}

/** 管理員預排多週主題。同一週重複設定為覆寫（unique room_id, week_start_date） */
export async function scheduleThemes(
  _drafts: ReadonlyArray<Omit<Theme, 'id'>>,
): Promise<ReadonlyArray<Theme>> {
  throw new Error('T-10 未實作');
}
