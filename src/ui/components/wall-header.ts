/**
 * 牆頁頂部三層與捲動收合（架構書 §10.2 / ADR-0011）。
 *
 * 三層在手機上會佔掉超過三分之一螢幕高度，所以向下捲動時把
 * 導覽列與主題橫幅收起來，只留週次選擇器；向上捲動再放回來。
 */

import type { Theme } from '@modules/themes';
import type { WeekStart } from '@domain/week';

export type WeekOption = { week: WeekStart; label: string };

export type WallHeaderOptions = {
  roomName: string;
  theme: Theme | null;
  weeks: readonly WeekOption[];
  activeWeek: WeekStart;
  onSelectWeek: (week: WeekStart) => void;
  navActions: readonly HTMLElement[];
};

export function wallHeader(options: WallHeaderOptions): HTMLElement {
  const top = document.createElement('div');
  top.className = 'wall-top';
  top.dataset['collapsed'] = 'false';

  const collapsible = document.createElement('div');
  collapsible.className = 'wall-collapsible';

  const nav = document.createElement('nav');
  nav.className = 'wall-nav';
  const title = document.createElement('p');
  title.className = 'wall-nav__title';
  title.textContent = options.roomName;
  const actions = document.createElement('div');
  actions.className = 'wall-nav__actions';
  actions.append(...options.navActions);
  nav.append(title, actions);

  const banner = document.createElement('div');
  banner.className = 'theme-banner';
  const label = document.createElement('p');
  label.className = 'theme-banner__label';
  label.textContent = '本週主題';
  const themeTitle = document.createElement('p');
  themeTitle.className = 'theme-banner__title';
  const themeDesc = document.createElement('p');
  themeDesc.className = 'theme-banner__desc';

  if (options.theme) {
    themeTitle.textContent = options.theme.title;
    themeDesc.textContent = options.theme.description ?? '';
  } else {
    // §9.6：空窗週的發文量通常斷崖下滑。畫面上說清楚，總比留一塊空白好。
    themeTitle.textContent = '本週還沒有主題';
    themeDesc.textContent = '可以先貼自由貼文。';
  }
  banner.append(label, themeTitle, themeDesc);

  collapsible.append(nav, banner);

  const picker = document.createElement('div');
  picker.className = 'week-picker';
  picker.setAttribute('role', 'tablist');
  picker.setAttribute('aria-label', '週次');

  for (const option of options.weeks) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'week-pill';
    pill.textContent = option.label;
    pill.dataset['week'] = option.week;
    pill.setAttribute('role', 'tab');
    pill.setAttribute('aria-current', String(option.week === options.activeWeek));
    pill.addEventListener('click', () => {
      picker.querySelectorAll('.week-pill').forEach((el) => {
        el.setAttribute('aria-current', String(el === pill));
      });
      options.onSelectWeek(option.week);
    });
    picker.append(pill);
  }

  top.append(collapsible, picker);
  attachCollapse(top, collapsible);
  return top;
}

function attachCollapse(top: HTMLElement, collapsible: HTMLElement): void {
  let lastY = window.scrollY;
  let ticking = false;

  const measure = (): void => {
    top.style.setProperty('--collapsible-h', `${collapsible.offsetHeight}px`);
  };
  measure();
  window.addEventListener('resize', measure);

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
    { passive: true },
  );
}
