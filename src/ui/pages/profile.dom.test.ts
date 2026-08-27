/**
 * /member/me/edit 的結構測試。
 *
 * §15.2：UI 只驗「畫得出來、關鍵規則沒漏掉」。這一頁的關鍵規則有三個——
 * 暱稱必填、其餘留白即清空、以及非成員不該看到表單。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@modules/membership';
import type { Profile } from '@modules/profile';

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  getMyProfile: vi.fn(),
  updateMyProfile: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@modules/membership', () => ({ getViewer: mocks.getViewer }));
vi.mock('@modules/auth', () => ({ signOut: mocks.signOut }));
vi.mock('@modules/profile', () => ({
  getMyProfile: mocks.getMyProfile,
  updateMyProfile: mocks.updateMyProfile,
}));

const MEMBER: Viewer = {
  kind: 'member',
  memberId: 'm-1',
  displayName: '陳小明',
  avatarUrl: null,
};

const PROFILE: Profile = {
  memberId: 'm-1',
  displayName: '陳小明',
  birthday: '1999-04-18',
  interests: '爬山、煮咖啡',
  favoriteVerse: '你們要休息，要知道我是神。—— 詩篇 46:10',
};

async function render(
  options: { viewer?: Viewer; profile?: Profile } = {},
): Promise<HTMLElement> {
  document.body.innerHTML = '<main id="app"></main>';
  Object.defineProperty(window, 'location', {
    value: { replace: vi.fn(), pathname: '/member/me/edit' },
    writable: true,
    configurable: true,
  });
  mocks.getViewer.mockResolvedValue(options.viewer ?? MEMBER);
  mocks.getMyProfile.mockResolvedValue(options.profile ?? PROFILE);
  mocks.updateMyProfile.mockResolvedValue(options.profile ?? PROFILE);

  vi.resetModules();
  await import('./profile');
  await new Promise((r) => setTimeout(r, 0));
  return document.getElementById('app') as HTMLElement;
}

const input = (app: HTMLElement, id: string): HTMLInputElement | HTMLTextAreaElement =>
  app.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;

async function submit(app: HTMLElement): Promise<void> {
  app.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('表單內容', () => {
  it('四個欄位都帶入現有的值', async () => {
    const app = await render();
    expect(input(app, 'p-name').value).toBe('陳小明');
    expect(input(app, 'p-birthday').value).toBe('1999-04-18');
    expect(input(app, 'p-interests').value).toBe('爬山、煮咖啡');
    expect(input(app, 'p-verse').value).toContain('詩篇 46:10');
  });

  it('沒填過的欄位是空的，不是 null 字串', async () => {
    const app = await render({
      profile: { ...PROFILE, birthday: null, interests: null, favoriteVerse: null },
    });
    expect(input(app, 'p-birthday').value).toBe('');
    expect(input(app, 'p-interests').value).toBe('');
    expect(input(app, 'p-verse').value).toBe('');
  });

  it('生日用 date 型別的輸入，不是自由文字', async () => {
    const app = await render();
    expect((input(app, 'p-birthday') as HTMLInputElement).type).toBe('date');
  });

  it('說明白寫出誰看得到——這是個資的告知', async () => {
    const app = await render();
    expect(app.querySelector('.paper-card__lead')?.textContent).toContain('同房間的成員看得到');
  });
});

describe('儲存', () => {
  it('送出四個欄位，暱稱去空白', async () => {
    const app = await render();
    input(app, 'p-name').value = '  陳小明  ';
    await submit(app);
    expect(mocks.updateMyProfile).toHaveBeenCalledWith({
      displayName: '陳小明',
      birthday: '1999-04-18',
      interests: '爬山、煮咖啡',
      favoriteVerse: '你們要休息，要知道我是神。—— 詩篇 46:10',
    });
  });

  it('暱稱留白時擋下來，不呼叫 updateMyProfile', async () => {
    const app = await render();
    input(app, 'p-name').value = '   ';
    await submit(app);
    expect(mocks.updateMyProfile).not.toHaveBeenCalled();
    expect(app.querySelector('.paper-message--error')?.textContent).toContain('暱稱');
  });

  it('選填欄位清空後照樣送出——留白即清空', async () => {
    const app = await render();
    input(app, 'p-interests').value = '';
    input(app, 'p-verse').value = '';
    await submit(app);
    expect(mocks.updateMyProfile).toHaveBeenCalledWith(
      expect.objectContaining({ interests: '', favoriteVerse: '' }),
    );
  });

  it('模組給的錯誤訊息原樣顯示', async () => {
    const app = await render();
    mocks.updateMyProfile.mockRejectedValue(new Error('儲存失敗：超過長度限制'));
    await submit(app);
    expect(app.querySelector('.paper-message--error')?.textContent).toContain('超過長度限制');
  });
});

describe('登出', () => {
  it('登出鈕在頁面上，與儲存分開', async () => {
    const app = await render();
    const button = app.querySelector<HTMLButtonElement>('.profile-signout .paper-button');
    expect(button?.textContent).toBe('登出');
  });

  it('按下去會呼叫 signOut', async () => {
    mocks.signOut.mockResolvedValue(undefined);
    const app = await render();
    app.querySelector<HTMLButtonElement>('.profile-signout .paper-button')!.click();
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
});

describe('非成員', () => {
  it('訪客看不到表單，被指去加入', async () => {
    const app = await render({ viewer: { kind: 'guest' } });
    expect(mocks.getMyProfile).not.toHaveBeenCalled();
    expect(app.querySelector('form')).toBeNull();
    expect(app.querySelector<HTMLAnchorElement>('a[href="/join"]')).not.toBeNull();
  });
});
