/**
 * themes — 葉節點（架構書 §12.2）。
 *
 * 職責：每週主題的查詢與（管理員）預排。規格見 §9.6。
 * 空窗週會導致該週發文量斷崖下滑，故預排為必要功能而非便利功能。
 */
import { db, ROOM_ID } from '@db/client';
import { parseWeekStart, weekStartOf } from '@domain/week';
import type { WeekStart } from '@domain/week';

export type Theme = {
  readonly id: string;
  readonly week: WeekStart;
  readonly title: string;
  readonly description: string | null;
};

/** 本週主題。無設定時回傳 null，UI 須顯示「本週尚未設定主題」而非崩潰 */
export async function getCurrentTheme(): Promise<Theme | null> {
  return getThemeForWeek(weekStartOf());
}

/**
 * 指定週次的主題，供瀏覽舊週次時顯示。
 *
 * 一律讀 themes_public（migration 006）而非 themes 本表：後者的 RLS 是
 * is_active_member()，訪客會拿到 0 列，牆頁便顯示「本週還沒有主題」——
 * 但其實有，只是他看不到，那是誤導而非保護。
 * view 的欄位與本表相同（少一個 created_at），成員讀它不會少任何資訊。
 * 寫入仍走 themes 本表（scheduleThemes，管理員限定）。
 */
export async function getThemeForWeek(week: WeekStart): Promise<Theme | null> {
  const { data, error } = await db
    .from('themes_public')
    .select('id, week_start_date, title, description')
    .eq('room_id', ROOM_ID)
    .eq('week_start_date', week)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  // view 的欄位在產生的型別裡全是 nullable：Postgres 的 view 不帶 NOT NULL 資訊。
  // 底層 themes 的這三欄是 not null，實務上不會發生；真的發生就當作沒有主題，
  // 而不是讓一個 undefined 沿著呼叫鏈流進畫面。
  if (data.id === null || data.week_start_date === null || data.title === null) return null;

  // DB row 於此轉為 domain type，不讓 week_start_date 這種欄位名跨出模組（§12.4 規則 3）。
  return {
    id: data.id,
    week: parseWeekStart(data.week_start_date),
    title: data.title,
    description: data.description,
  };
}

/** 管理員預排多週主題。同一週重複設定為覆寫（unique room_id, week_start_date） */
export async function scheduleThemes(
  _drafts: ReadonlyArray<Omit<Theme, 'id'>>,
): Promise<ReadonlyArray<Theme>> {
  throw new Error('T-10 未實作');
}
