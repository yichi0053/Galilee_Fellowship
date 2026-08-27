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

/**
 * 從某一週起算的主題清單，供後台排程介面顯示（§9.6）。
 *
 * 讀 themes_public：欄位與本表相同，且管理員與訪客走同一條路少一種分支。
 */
export async function listThemesFrom(week: WeekStart): Promise<ReadonlyArray<Theme>> {
  const { data, error } = await db
    .from('themes_public')
    .select('id, week_start_date, title, description')
    .eq('room_id', ROOM_ID)
    .gte('week_start_date', week)
    .order('week_start_date', { ascending: true });

  if (error) throw error;

  return (data ?? []).flatMap((t) =>
    t.id === null || t.week_start_date === null || t.title === null
      ? []
      : [
          {
            id: t.id,
            week: parseWeekStart(t.week_start_date),
            title: t.title,
            description: t.description,
          },
        ],
  );
}

/**
 * 管理員預排多週主題。同一週重複設定為覆寫（unique room_id, week_start_date）。
 *
 * 標題留白代表**刪掉那一週的主題**，而不是存一個空字串——
 * 後台的排程介面是一排輸入框，清空某一格是最自然的「我不要這週有主題」的表達方式。
 */
export async function scheduleThemes(
  drafts: ReadonlyArray<Omit<Theme, 'id'>>,
): Promise<ReadonlyArray<Theme>> {
  const blank = drafts.filter((d) => d.title.trim() === '');
  const filled = drafts.filter((d) => d.title.trim() !== '');

  if (blank.length > 0) {
    const { error } = await db
      .from('themes')
      .delete()
      .eq('room_id', ROOM_ID)
      .in('week_start_date', blank.map((d) => d.week));
    if (error) throw new Error(`刪除主題失敗：${error.message}`);
  }

  if (filled.length > 0) {
    const { error } = await db.from('themes').upsert(
      filled.map((d) => ({
        room_id: ROOM_ID,
        week_start_date: d.week,
        title: d.title.trim(),
        description: d.description?.trim() || null,
      })),
      // 唯一鍵是 (room_id, week_start_date)：同一週重複設定為覆寫而非新增一列，
      // 否則 §9.6 的「預排」會在改動時堆出兩筆而 getThemeForWeek 只拿得到其中一筆。
      { onConflict: 'room_id,week_start_date' },
    );
    if (error) throw new Error(`儲存主題失敗：${error.message}`);
  }

  return drafts.length === 0 ? [] : listThemesFrom(drafts[0]!.week);
}
