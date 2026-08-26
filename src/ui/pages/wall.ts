/**
 * /wall —— 照片牆主頁（架構書 §10.1、§10.6）。
 *
 * UI 層禁止 import db/（§12.4 規則 2）。資料一律經由各 module 的 index.ts。
 *
 * 訪客與成員看到的是同一個版面、不同的資料來源：
 * posts.listWeek 依傳入的 memberId 決定讀 posts_public（遮蔽姓名）或 posts（全名）。
 * 本檔不知道那個分岔怎麼實作，只負責把身分交出去。
 */

import '@ui/styles/wall.css';

import { shiftWeeks, weeksBetween, weekStartOf } from '@domain/week';
import type { WeekStart } from '@domain/week';
import { canPost, getViewer } from '@modules/membership';
import { listWeek } from '@modules/posts';
import type { Post } from '@modules/posts';
import { getThemeForWeek } from '@modules/themes';
import type { Theme } from '@modules/themes';
import { createLightbox } from '@ui/components/lightbox';
import { disposeCards, observeEntrance, polaroidCard } from '@ui/components/polaroid';
import { wallHeader } from '@ui/components/wall-header';
import type { WeekOption } from '@ui/components/wall-header';

/** 第一期只有一種訪問身分需要在牆頁分辨：能不能發文（§10.3） */
type Mode = 'member' | 'guest';

const WEEKS_SHOWN = 4;

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
  return `${week.slice(5).replace('-', '/')}`;
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
  const weeks = Array.from({ length: WEEKS_SHOWN }, (_, i) => shiftWeeks(current, -i));

  const options: WeekOption[] = weeks.map((w) => ({ week: w, label: weekLabel(w, current) }));
  const lightbox = createLightbox();

  const body = document.createElement('div');
  body.className = 'wall-weeks';

  const header = wallHeader({
    roomName: '加利利團契',
    theme: await loadTheme(current),
    weeks: options,
    activeWeek: current,
    navActions: navActions(mode),
    onSelectWeek: (week) => {
      document.getElementById(`week-${week}`)?.scrollIntoView({ behavior: 'smooth' });
    },
  });

  app.replaceChildren(header, body);
  document.body.append(fab(mode));

  let detachEntrance: (() => void) | undefined;

  // §9.4：依週分批載入，不做全牆無限捲動。
  // 一次把四週全抓下來也還好（每週不到 30 則），但每一週各自成段，
  // 之後要改成捲到才載入時不需要動版面結構。
  for (const week of weeks) {
    try {
      const [posts, theme] = await Promise.all([listWeek(week, asMemberId), loadTheme(week)]);
      body.append(renderWeekSection(week, posts, theme, mode, lightbox.open));
    } catch (error: unknown) {
      // 一週失敗不該讓其他三週也跟著消失，故錯誤就地呈現，迴圈繼續。
      body.append(failure(error instanceof Error ? error.message : `${week} 載入失敗。`));
    }
    detachEntrance?.();
    detachEntrance = observeEntrance(body);
  }

  window.addEventListener('pagehide', () => {
    disposeCards(body);
    detachEntrance?.();
  });
}

void main();
