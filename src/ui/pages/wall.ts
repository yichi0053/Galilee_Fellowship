/**
 * /wall —— 照片牆主頁（架構書 §10.1、§10.6）。
 *
 * UI 層禁止 import db/（§12.4 規則 2）。資料一律來自 modules 或（開發期間）mock。
 *
 * 目前接的是 mock 資料。tracer bullet（T-04）完成後，
 * loadWeek 與 loadTheme 換成 posts.listWeek 與 themes.getThemeForWeek 即可，
 * 本檔其餘部分不需更動——這正是分層的用處。
 */

import '@ui/styles/wall.css';

import { shiftWeeks, weeksBetween, weekStartOf } from '@domain/week';
import type { WeekStart } from '@domain/week';
import type { Post } from '@modules/posts';
import type { Theme } from '@modules/themes';
import { createLightbox } from '@ui/components/lightbox';
import { disposeCards, observeEntrance, polaroidCard } from '@ui/components/polaroid';
import { wallHeader } from '@ui/components/wall-header';
import type { WeekOption } from '@ui/components/wall-header';
import { mockListWeek, mockTheme, mockWeeks } from '@ui/mock/wall-data';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

/** 第一期只有一種訪問身分需要在牆頁分辨：能不能發文（§10.3） */
type Mode = 'member' | 'guest';

const WEEKS_SHOWN = 4;

async function loadWeek(week: WeekStart): Promise<readonly Post[]> {
  if (USE_MOCK) return mockListWeek(week);
  // T-04 接上：return posts.listWeek(week);
  throw new Error('尚未接上資料層。開發期間請以 VITE_USE_MOCK=true 啟動。');
}

function loadTheme(week: WeekStart): Theme | null {
  if (USE_MOCK) return mockTheme(week);
  // T-04 接上：return themes.getThemeForWeek(week);
  return null;
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

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  const mode: Mode = 'member'; // T-04 接上 membership.getViewer() 後改為實際判定
  const current = weekStartOf();
  const weeks = USE_MOCK
    ? mockWeeks(WEEKS_SHOWN)
    : Array.from({ length: WEEKS_SHOWN }, (_, i) => shiftWeeks(current, -i));

  const options: WeekOption[] = weeks.map((w) => ({ week: w, label: weekLabel(w, current) }));
  const lightbox = createLightbox();

  const body = document.createElement('div');
  body.className = 'wall-weeks';

  const header = wallHeader({
    roomName: '加利利團契',
    theme: loadTheme(current),
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
    const posts = await loadWeek(week);
    body.append(renderWeekSection(week, posts, loadTheme(week), mode, lightbox.open));
    detachEntrance?.();
    detachEntrance = observeEntrance(body);
  }

  window.addEventListener('pagehide', () => {
    disposeCards(body);
    detachEntrance?.();
  });
}

void main();
