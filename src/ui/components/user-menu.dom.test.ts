/**
 * 大頭貼選單的結構測試。
 *
 * §15.2：UI 只驗「畫得出來、關鍵規則沒漏掉」。這個元件的關鍵規則有三個——
 * 管理員才看得到後台入口（§4.1）、未啟用的功能不渲染入口（ADR-0013）、
 * 以及頭像載不到時要有退路而不是留一個破圖。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@modules/membership';
import { userMenu } from './user-menu';

const MEMBER: Viewer = {
  kind: 'member',
  memberId: 'm-1',
  displayName: '陳小明',
  avatarUrl: null,
};
const ADMIN: Viewer = { ...MEMBER, kind: 'admin', displayName: '林大方' } as Viewer;

function labels(menu: HTMLElement): string[] {
  return [...menu.querySelectorAll('.user-menu__item')].map((n) => n.textContent ?? '');
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('清單內容', () => {
  it('一般成員：我的貼文與登出', () => {
    const menu = userMenu({ viewer: MEMBER, onSignOut: vi.fn() });
    expect(labels(menu)).toEqual(['我的貼文', '登出']);
  });

  it('管理員多一條後台入口，排在成員項目之後、登出之前（§4.1）', () => {
    const menu = userMenu({ viewer: ADMIN, onSignOut: vi.fn() });
    expect(labels(menu)).toEqual(['我的貼文', '管理後台', '登出']);
    expect(menu.querySelector<HTMLAnchorElement>('a[href="/admin"]')).not.toBeNull();
  });

  it('一般成員看不到後台入口', () => {
    const menu = userMenu({ viewer: MEMBER, onSignOut: vi.fn() });
    expect(menu.querySelector('a[href="/admin"]')).toBeNull();
  });

  it('個人資料設定屬第三期，features.profile 關著就不渲染（ADR-0013）', () => {
    const menu = userMenu({ viewer: MEMBER, onSignOut: vi.fn() });
    expect(labels(menu)).not.toContain('個人資料設定');
  });

  it('管理員的清單上標示身分，避免誤以為在用一般帳號', () => {
    const menu = userMenu({ viewer: ADMIN, onSignOut: vi.fn() });
    expect(menu.querySelector('.user-menu__role')?.textContent).toBe('管理員');
    expect(menu.querySelector('.user-menu__name')?.textContent).toBe('林大方');
  });
});

describe('展開與收合', () => {
  it('預設收合，按一下展開', () => {
    const menu = userMenu({ viewer: MEMBER, onSignOut: vi.fn() });
    const list = menu.querySelector<HTMLElement>('.user-menu__list')!;
    const trigger = menu.querySelector<HTMLButtonElement>('.user-menu__trigger')!;
    expect(list.hidden).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    trigger.click();
    expect(list.hidden).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('點畫面其他地方會關閉', () => {
    document.body.append(userMenu({ viewer: MEMBER, onSignOut: vi.fn() }));
    const list = document.querySelector<HTMLElement>('.user-menu__list')!;
    document.querySelector<HTMLButtonElement>('.user-menu__trigger')!.click();
    expect(list.hidden).toBe(false);

    document.dispatchEvent(new Event('click'));
    expect(list.hidden).toBe(true);
  });

  it('dispose 之後不再回應 document 的點擊——切換週次會重畫 header', () => {
    const menu = userMenu({ viewer: MEMBER, onSignOut: vi.fn() });
    document.body.append(menu);
    const list = menu.querySelector<HTMLElement>('.user-menu__list')!;
    menu.querySelector<HTMLButtonElement>('.user-menu__trigger')!.click();

    menu.dispatchEvent(new CustomEvent('user-menu:dispose'));
    document.dispatchEvent(new Event('click'));
    // 監聽器已拆掉，所以外部點擊不再關閉它
    expect(list.hidden).toBe(false);
  });
});

describe('頭像', () => {
  it('沒有 Google 頭像時用姓名首字，色相由姓名決定而非隨機', () => {
    const a = userMenu({ viewer: MEMBER, onSignOut: vi.fn() });
    const b = userMenu({ viewer: MEMBER, onSignOut: vi.fn() });
    const one = a.querySelector<HTMLElement>('.user-menu__initial')!;
    expect(one.textContent).toBe('陳');
    expect(one.style.getPropertyValue('--hue')).toBe(
      b.querySelector<HTMLElement>('.user-menu__initial')!.style.getPropertyValue('--hue'),
    );
  });

  it('有頭像時用 img，並帶 no-referrer', () => {
    const menu = userMenu({
      viewer: { ...MEMBER, avatarUrl: 'https://lh3.googleusercontent.com/x' } as Viewer,
      onSignOut: vi.fn(),
    });
    const img = menu.querySelector<HTMLImageElement>('.user-menu__avatar')!;
    expect(img.src).toBe('https://lh3.googleusercontent.com/x');
    expect(img.referrerPolicy).toBe('no-referrer');
  });

  it('頭像載不到時換成首字，不留破圖', () => {
    const menu = userMenu({
      viewer: { ...MEMBER, avatarUrl: 'https://lh3.googleusercontent.com/gone' } as Viewer,
      onSignOut: vi.fn(),
    });
    menu.querySelector<HTMLImageElement>('.user-menu__avatar')!.dispatchEvent(new Event('error'));
    expect(menu.querySelector('.user-menu__avatar')).toBeNull();
    expect(menu.querySelector('.user-menu__initial')?.textContent).toBe('陳');
  });
});

describe('登出', () => {
  it('按下登出會呼叫呼叫端給的處理函式', () => {
    const onSignOut = vi.fn();
    const menu = userMenu({ viewer: MEMBER, onSignOut });
    [...menu.querySelectorAll<HTMLElement>('.user-menu__item')]
      .find((n) => n.textContent === '登出')!
      .click();
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});

describe('不是成員的身分', () => {
  it('訪客不該走到這裡，硬叫就拋錯而不是畫出一個空選單', () => {
    expect(() => userMenu({ viewer: { kind: 'guest' }, onSignOut: vi.fn() })).toThrow();
  });
});
