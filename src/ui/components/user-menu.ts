/**
 * 導覽列右上角的大頭貼與功能選單（架構書 §10.2 / ADR-0011）。
 *
 * 先前那裡是一條寫死的「我的貼文」連結，於是每多一個功能就得多擠一條進去，
 * 而手機的導覽列橫向空間本來就不夠。改為大頭貼加下拉選單之後，
 * 新功能是往清單加一列，不再跟版面搶位置。
 *
 * 管理員與一般成員看到的清單不同（§4.1：管理員繼承成員的全部權限，
 * 所以是「成員的清單再加上後台」而不是另一份清單）。
 */

import { isEnabled } from '@config/features';
import type { Viewer } from '@modules/membership';

export type UserMenuOptions = {
  viewer: Viewer;
  /** 按下登出。由呼叫端決定登出後去哪一頁 */
  onSignOut: () => void;
};

type MenuItem = { label: string; href: string } | { label: string; action: () => void };

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

/**
 * 頭像載不到時的退路：姓名首字加一個由姓名決定的底色。
 *
 * 底色不能用隨機值——同一個人每次進來顏色都不同的話，那不是識別而是干擾。
 * 雜湊取色相，飽和度與亮度固定，確保深色底上的白字一定讀得到。
 */
function initialAvatar(displayName: string): HTMLElement {
  const node = el('span', 'user-menu__initial', [...displayName][0] ?? '?');
  let hash = 0;
  for (const ch of displayName) hash = (hash * 31 + ch.codePointAt(0)!) % 360;
  node.style.setProperty('--hue', String(hash));
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function avatar(displayName: string, avatarUrl: string | null): HTMLElement {
  const fallback = initialAvatar(displayName);
  if (avatarUrl === null) return fallback;

  const img = el('img', 'user-menu__avatar');
  img.src = avatarUrl;
  img.alt = '';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  // Google 的頭像網址會過期，帳號被停用時也會 404。
  // 沒有這一段的話那些情況會留下一個破圖，而破圖比首字色塊難看得多。
  img.addEventListener('error', () => img.replaceWith(fallback), { once: true });
  return img;
}

/**
 * 依身分決定清單內容。
 *
 * `個人資料設定` 掛在 features.profile 底下（第三期第 4 至 5 週）：
 * ADR-0013 明訂未啟用的功能不渲染入口，所以現在不會出現，開關一翻就自己冒出來。
 */
function itemsFor(viewer: Viewer, onSignOut: () => void): MenuItem[] {
  const items: MenuItem[] = [{ label: '我的貼文', href: '/member/me' }];

  if (isEnabled('profile')) items.push({ label: '個人資料設定', href: '/member/me/edit' });

  // 管理員的項目排在成員項目之後、登出之前：後台是額外的權限而不是另一種身分。
  if (viewer.kind === 'admin') items.push({ label: '管理後台', href: '/admin' });

  items.push({ label: '登出', action: onSignOut });
  return items;
}

export function userMenu(options: UserMenuOptions): HTMLElement {
  const { viewer } = options;
  if (viewer.kind !== 'member' && viewer.kind !== 'admin') {
    throw new Error('userMenu 只給成員與管理員使用');
  }

  const wrap = el('div', 'user-menu');

  const trigger = el('button', 'user-menu__trigger');
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  // 大頭貼沒有文字，讀螢幕軟體需要一個名字才唸得出這顆按鈕是什麼。
  trigger.setAttribute('aria-label', `${viewer.displayName} 的選單`);
  trigger.append(avatar(viewer.displayName, viewer.avatarUrl));

  const list = el('div', 'user-menu__list');
  list.setAttribute('role', 'menu');
  list.hidden = true;

  const name = el('p', 'user-menu__name', viewer.displayName);
  list.append(name);
  if (viewer.kind === 'admin') list.append(el('p', 'user-menu__role', '管理員'));

  for (const item of itemsFor(viewer, options.onSignOut)) {
    if ('href' in item) {
      const link = el('a', 'user-menu__item', item.label);
      link.href = item.href;
      link.setAttribute('role', 'menuitem');
      list.append(link);
    } else {
      const button = el('button', 'user-menu__item user-menu__item--danger', item.label);
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.addEventListener('click', item.action);
      list.append(button);
    }
  }

  const setOpen = (open: boolean): void => {
    list.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
  };

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(list.hidden);
  });

  // 點選單以外的任何地方就關閉。監聽掛在 document 上，
  // 而牆頁切換週次會重畫整個 header——沒有下面的 dispose，
  // 18 週的學期裡每切一次就多一個永遠不會消失的監聽器。
  //
  // **用 removeEventListener 而不是 AbortController 的 signal。**
  // 那個寫法比較短，但 happy-dom v15 直接忽略 signal 選項：
  // abort() 之後監聽器照樣觸發，於是這段清理在測試裡是靜默失效的，
  // 「有沒有真的拆掉」也就驗不到。真實瀏覽器支援 signal，但驗不到的清理
  // 跟沒有清理一樣危險——這正是本專案最想避免的那種安靜失敗。
  const closeOnOutsideClick = (): void => setOpen(false);
  const closeOnEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') setOpen(false);
  };

  document.addEventListener('click', closeOnOutsideClick);
  document.addEventListener('keydown', closeOnEscape);

  wrap.addEventListener(
    'user-menu:dispose',
    () => {
      document.removeEventListener('click', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    },
    { once: true },
  );

  // 選單本身的點擊不該冒泡到 document 而把自己關掉——
  // 但連結與登出鈕要照常運作，所以只擋冒泡，不擋預設行為。
  list.addEventListener('click', (event) => event.stopPropagation());

  wrap.append(trigger, list);
  return wrap;
}
