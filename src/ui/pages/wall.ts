/**
 * /wall —— 照片牆主頁（架構書 §10.1、§10.6）。
 *
 * UI 層禁止 import db/（§12.4 規則 2）。資料一律經由各 module 的 index.ts。
 *
 * 訪客與成員看到的是同一個版面、不同的資料來源：
 * posts.listWeek 依傳入的 memberId 決定讀 posts_public（遮蔽姓名）或 posts（全名）。
 * 本檔不知道那個分岔怎麼實作，只負責把身分交出去。
 *
 * **一次只顯示一週**（§10.6）。18 週的學期若全部堆在同一頁，
 * 捲到期末要經過幾百張卡片，而 §9.4 的 egress 也撐不住一次載入整學期的縮圖。
 * 選到的週次寫進網址的 hash，重新整理與分享連結才會停在同一週。
 */

import '@ui/styles/wall.css';

import { parseWeekStart, shiftWeeks, weeksBetween, weekStartOf } from '@domain/week';
import type { WeekStart } from '@domain/week';
import { canPost, getViewer } from '@modules/membership';
import { listWeek, listWeeks } from '@modules/posts';
import type { Post } from '@modules/posts';
import { getThemeForWeek } from '@modules/themes';
import type { Theme } from '@modules/themes';
import { createLightbox } from '@ui/components/lightbox';
import { disposeCards, observeEntrance, polaroidCard } from '@ui/components/polaroid';
import { wallHeader } from '@ui/components/wall-header';
import type { WeekOption } from '@ui/components/wall-header';

/** 第一期只有一種訪問身分需要在牆頁分辨：能不能發文（§10.3） */
type Mode = 'member' | 'guest';

/** 選擇器上最多回溯幾週。一學期 18 週，多給一點餘裕 */
const MAX_WEEKS = 24;

/**
 * 主題對訪客一律是 null（themes 的 RLS 是 is_active_member，且無 themes_public view）。
 * 這不是錯誤，橫幅會改顯示「本週還沒有主題」，牆本身照常呈現。
 */
async function loadTheme(week: WeekStart): Promise<Theme | null> {
  return getThemeForWeek(week);
}

function weekLabel(week: WeekStart, current: WeekStart): string {
  const delta = weeksBetween(week, current);
  if (delta === 0) return '本週';
  if (delta === 1) return '上週';
  return week.slice(5).replace('-', '/');
}

/** 網址的 #week=YYYY-MM-DD。認不得就回 null，讓呼叫端落回本週 */
function weekFromHash(): WeekStart | null {
  const raw = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('week');
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  try {
    return parseWeekStart(raw);
  } catch {
    return null;
  }
}

function renderWeekSection(
  week: WeekStart,
  posts: readonly Post[],
  theme: Theme | null,
  mode: Mode,
  onOpen: (posts: readonly Post[], index: number) => void,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'week-section';
  section.id = `week-${week}`;

  const heading = document.createElement('h2');
  heading.className = 'week-section__heading';
  const label = document.createElement('span');
  label.textContent = week.replace(/-/g, '/');
  heading.append(label);

  if (theme) {
    const t = document.createElement('span');
    t.className = 'week-section__theme';
    t.textContent = theme.title;
    heading.append(t);
  }
  section.append(heading);

  if (posts.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'wall-empty';
    empty.textContent = '這一週還沒有人貼東西。';
    section.append(empty);
    return section;
  }

  const grid = document.createElement('div');
  grid.className = 'masonry';
  posts.forEach((post, index) => {
    grid.append(
      polaroidCard(post, {
        onOpen: () => onOpen(posts, index),
        // 訪客看不到倒數：那是給作者本人的資訊
        refundCountdown: mode === 'member',
      }),
    );
  });
  section.append(grid);
  return section;
}

function navActions(mode: Mode): HTMLElement[] {
  const link = document.createElement('a');
  link.className = 'wall-nav__link';
  if (mode === 'member') {
    link.href = '/member/me';
    link.textContent = '我的貼文';
  } else {
    // §10.3：訪客的 FAB 改為加入引導
    link.href = '/join';
    link.textContent = '我要加入';
  }
  return [link];
}

function fab(mode: Mode): HTMLElement {
  const button = document.createElement('a');
  button.className = mode === 'member' ? 'fab' : 'fab fab--guest';
  button.href = mode === 'member' ? '/post/new' : '/join';
  button.textContent = mode === 'member' ? '＋ 發文' : '加入團契';
  return button;
}

function failure(detail: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'wall-weeks';
  const note = document.createElement('p');
  note.className = 'wall-empty';
  note.setAttribute('role', 'alert');
  note.textContent = `牆載入失敗：${detail}`;
  box.append(note);
  return box;
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  let viewer;
  try {
    viewer = await getViewer();
  } catch (error: unknown) {
    // 身分查不出來就整面牆都畫不了。與其留一個永遠的「載入中…」，
    // 不如把原因顯示出來——這種失敗通常是環境變數或 RLS，訊息本身就是線索。
    app.replaceChildren(failure(error instanceof Error ? error.message : '無法取得你的身分。'));
    return;
  }

  const mode: Mode = canPost(viewer) ? 'member' : 'guest';
  // 回補倒數與未遮蔽姓名都需要「我是誰」。訪客與停權者沒有 memberId，一律傳 null。
  const asMemberId =
    viewer.kind === 'member' || viewer.kind === 'admin' ? viewer.memberId : null;

  const current = weekStartOf();

  let summaries: readonly { week: WeekStart; count: number }[] = [];
  try {
    summaries = await listWeeks(asMemberId);
  } catch {
    // 週次列拿不到不該讓整面牆消失：至少還能看本週。
    summaries = [];
  }

  // 連續的週次範圍，中間沒有貼文的那幾週也留著。
  // 跳號的選擇器（本週、上週、然後直接是三週前）會讓人以為載入壞掉了。
  const countByWeek = new Map(summaries.map((s) => [s.week, s.count]));
  const oldest = summaries.at(-1)?.week ?? current;
  const span = Math.min(MAX_WEEKS, Math.max(1, weeksBetween(oldest, current) + 1));
  const weeks = Array.from({ length: span }, (_, i) => shiftWeeks(current, -i));

  const options: WeekOption[] = weeks.map((w) => ({
    week: w,
    label: weekLabel(w, current),
    count: countByWeek.get(w) ?? 0,
  }));

  const lightbox = createLightbox();
  let selected = weekFromHash() ?? current;
  if (!weeks.includes(selected)) selected = current;

  let detachEntrance: (() => void) | undefined;

  const show = async (week: WeekStart): Promise<void> => {
    selected = week;
    // 換週次時把上一輪的監聽器拆掉，否則一學期切下來會累積一堆 scroll 與 interval。
    const previous = app.querySelector<HTMLElement>('.wall-weeks');
    if (previous) disposeCards(previous);
    detachEntrance?.();

    const body = document.createElement('div');
    body.className = 'wall-weeks';

    let theme: Theme | null = null;
    try {
      theme = await loadTheme(week);
    } catch {
      // 主題拿不到只是少一行字，不該擋住貼文。
    }

    const header = wallHeader({
      roomName: '加利利團契',
      theme,
      weeks: options,
      activeWeek: week,
      navActions: navActions(mode),
      onSelectWeek: (next) => {
        if (next !== selected) void show(next);
      },
    });

    app.replaceChildren(header, body);

    try {
      const posts = await listWeek(week, asMemberId);
      body.append(renderWeekSection(week, posts, theme, mode, lightbox.open));
    } catch (error: unknown) {
      body.append(failure(error instanceof Error ? error.message : `${week} 載入失敗。`));
    }

    detachEntrance = observeEntrance(body);

    // 換週次後回到頂端，否則看完長的一週再切過去會停在半空中。
    window.scrollTo({ top: 0 });
    const hash = week === current ? '' : `#week=${week}`;
    history.replaceState(null, '', `${window.location.pathname}${hash}`);
  };

  await show(selected);

  document.body.append(fab(mode));
  window.addEventListener('pagehide', () => {
    const body = app.querySelector<HTMLElement>('.wall-weeks');
    if (body) disposeCards(body);
    detachEntrance?.();
  });
}

void main();
