/**
 * 牆頁頂部三層與捲動收合（架構書 §10.2、§10.6 / ADR-0011）。
 *
 * 三層在手機上會佔掉超過三分之一螢幕高度，所以向下捲動時把
 * 導覽列與主題橫幅收起來，只留週次選擇器；向上捲動再放回來。
 *
 * 週次選擇器是**切換**而不是捲動定位：牆一次只顯示一週（§10.6）。
 * 18 週的學期若全部堆在同一頁，捲到期末要經過幾百張卡片。
 */

import type { Theme } from '@modules/themes';
import type { WeekStart } from '@domain/week';

export type WeekOption = {
  week: WeekStart;
  /** 本週／上週／08/10 之類的短標籤 */
  label: string;
  /** 該週的貼文則數。0 會讓膠囊變淡，點進去之前就知道那週是空的 */
  count: number;
};

export type WallHeaderOptions = {
  roomName: string;
  theme: Theme | null;
  /** 選擇器上顯示的週次，新的在前 */
  weeks: readonly WeekOption[];
  activeWeek: WeekStart;
  onSelectWeek: (week: WeekStart) => void;
  navActions: readonly HTMLElement[];
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function wallHeader(options: WallHeaderOptions): HTMLElement {
  const top = el('div', 'wall-top');
  top.dataset['collapsed'] = 'false';

  const collapsible = el('div', 'wall-collapsible');

  const nav = el('nav', 'wall-nav');
  nav.append(el('p', 'wall-nav__title', options.roomName));
  const actions = el('div', 'wall-nav__actions');
  actions.append(...options.navActions);
  nav.append(actions);

  const isCurrent = options.weeks[0]?.week === options.activeWeek;
  const banner = el('div', 'theme-banner');
  banner.append(
    el(
      'p',
      'theme-banner__label',
      // 看舊週次時標籤要跟著改，不然畫面會說「本週主題」卻顯示三週前的題目。
      isCurrent ? '本週主題' : `${options.activeWeek.replace(/-/g, '/')} 那一週的主題`,
    ),
  );

  if (options.theme) {
    banner.append(el('p', 'theme-banner__title', options.theme.title));
    banner.append(el('p', 'theme-banner__desc', options.theme.description ?? ''));
  } else {
    // §9.6：空窗週的發文量通常斷崖下滑。畫面上說清楚，總比留一塊空白好。
    banner.append(el('p', 'theme-banner__title', isCurrent ? '本週還沒有主題' : '這一週沒有主題'));
    banner.append(el('p', 'theme-banner__desc', isCurrent ? '可以先貼自由貼文。' : ''));
  }

  collapsible.append(nav, banner);
  top.append(collapsible, weekPicker(options));
  attachCollapse(top, collapsible);
  return top;
}

function weekPicker(options: WallHeaderOptions): HTMLElement {
  const bar = el('div', 'week-bar');

  const rail = el('div', 'week-picker');
  rail.setAttribute('role', 'tablist');
  rail.setAttribute('aria-label', '週次');

  const index = options.weeks.findIndex((w) => w.week === options.activeWeek);

  // weeks 是新的在前，所以「較新的一週」是索引減一。
  // 箭頭的方向照時間走而不是照陣列走，否則使用者按「往前」卻回到未來。
  const step = (delta: number): void => {
    const target = options.weeks[index + delta];
    if (target) options.onSelectWeek(target.week);
  };

  const newer = el('button', 'week-arrow', '‹');
  newer.type = 'button';
  newer.setAttribute('aria-label', '較新的一週');
  newer.disabled = index <= 0;
  newer.addEventListener('click', () => step(-1));

  const older = el('button', 'week-arrow', '›');
  older.type = 'button';
  older.setAttribute('aria-label', '較舊的一週');
  older.disabled = index < 0 || index >= options.weeks.length - 1;
  older.addEventListener('click', () => step(1));

  for (const option of options.weeks) {
    const pill = el('button', 'week-pill');
    pill.type = 'button';
    pill.dataset['week'] = option.week;
    pill.dataset['empty'] = String(option.count === 0);
    pill.setAttribute('role', 'tab');
    pill.setAttribute('aria-current', String(option.week === options.activeWeek));

    pill.append(el('span', 'week-pill__label', option.label));
    if (option.count > 0) pill.append(el('span', 'week-pill__count', String(option.count)));

    pill.addEventListener('click', () => options.onSelectWeek(option.week));
    rail.append(pill);
  }

  bar.append(newer, rail, older);

  // 選到的那一週若在捲動範圍外，使用者會以為選擇器沒有反應。
  // rAF 是因為此刻元素還沒進 DOM，量不到位置。
  requestAnimationFrame(() => {
    rail
      .querySelector('.week-pill[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  });

  return bar;
}

/**
 * 捲動收合。切換週次會重畫整個 header，所以這裡的 window 監聽器必須拆得掉——
 * 少了這件事，18 週的學期裡每切一次就多兩個永遠不會消失的 scroll 監聽器。
 * 慣例同 polaroid：呼叫端在移除元素前 dispatch 一個 dispose 事件。
 */
function attachCollapse(top: HTMLElement, collapsible: HTMLElement): void {
  const controller = new AbortController();
  const { signal } = controller;
  top.addEventListener('wall-header:dispose', () => controller.abort(), { once: true });

  let lastY = window.scrollY;
  let ticking = false;

  const measure = (): void => {
    top.style.setProperty('--collapsible-h', `${collapsible.offsetHeight}px`);
  };
  measure();
  window.addEventListener('resize', measure, { signal });

  const update = (): void => {
    const y = window.scrollY;
    const delta = y - lastY;

    // 8 px 的死區。少了它，手指離開螢幕時的微小回彈會讓頂部連續開闔。
    if (Math.abs(delta) > 8) {
      // 頁面最上方一律展開，否則使用者捲回頂端卻看不到主題
      top.dataset['collapsed'] = String(delta > 0 && y > 80);
      lastY = y;
    }
    ticking = false;
  };

  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    },
    { passive: true, signal },
  );
}
