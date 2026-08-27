/**
 * /post/new 的結構煙霧測試。
 *
 * §15.2：UI 只驗「畫得出來、關鍵規則沒漏掉」。這一頁的關鍵規則是配額與主題的
 * 可用性判斷（§9.1、§9.6）——寫錯的話使用者會在填完整張表、壓縮上傳完照片之後
 * 才被退件，那是最貴的一種錯。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@modules/membership';
import type { Theme } from '@modules/themes';
import type { PostKind } from '@modules/posts';

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  getMyQuota: vi.fn(),
  createPost: vi.fn(),
  getCurrentTheme: vi.fn(),
}));

vi.mock('@modules/membership', () => ({ getViewer: mocks.getViewer }));
vi.mock('@modules/posts', () => ({
  getMyQuota: mocks.getMyQuota,
  createPost: mocks.createPost,
}));
vi.mock('@modules/themes', () => ({ getCurrentTheme: mocks.getCurrentTheme }));
vi.mock('@modules/media', () => ({ previewUrl: () => 'blob:preview' }));

const MEMBER: Viewer = { kind: 'member', memberId: 'm-1', displayName: '陳小明', avatarUrl: null };
const THEME: Theme = {
  id: 'th-1',
  week: '2026-08-24' as Theme['week'],
  title: '今天的晚餐，跟誰吃的',
  description: null,
};

async function render(options: {
  viewer?: Viewer;
  remaining?: Readonly<Record<PostKind, number>>;
  theme?: Theme | null;
} = {}): Promise<HTMLElement> {
  document.body.innerHTML = '<main id="app"></main>';
  mocks.getViewer.mockResolvedValue(options.viewer ?? MEMBER);
  mocks.getMyQuota.mockResolvedValue({
    week: '2026-08-24',
    remaining: options.remaining ?? { theme: 1, free: 2 },
  });
  mocks.getCurrentTheme.mockResolvedValue(options.theme === undefined ? THEME : options.theme);

  vi.resetModules();
  await import('./new');
  await new Promise((r) => setTimeout(r, 0));
  return document.getElementById('app') as HTMLElement;
}

function attachFile(app: HTMLElement): File {
  const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
  const input = app.querySelector<HTMLInputElement>('.picker input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input?.dispatchEvent(new Event('change', { bubbles: true }));
  return file;
}

async function submit(app: HTMLElement, title: string, body = ''): Promise<void> {
  const titleInput = app.querySelector<HTMLInputElement>('#post-title');
  if (titleInput) titleInput.value = title;
  const textarea = app.querySelector<HTMLTextAreaElement>('#post-body');
  if (textarea) textarea.value = body;
  app
    .querySelector('form')
    ?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
}

const errorText = (app: HTMLElement): string =>
  app.querySelector('.paper-message--error')?.textContent ?? '';

const kindRadio = (app: HTMLElement, kind: PostKind): HTMLInputElement | null =>
  app.querySelector<HTMLInputElement>(`input[name="kind"][value="${kind}"]`);

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'location', {
    value: { replace: vi.fn(), href: 'http://localhost:5173/post/new' },
    writable: true,
    configurable: true,
  });
});

describe('/post/new 的身分判斷', () => {
  it('訪客看不到表單，被指去加入', async () => {
    const app = await render({ viewer: { kind: 'guest' } });
    expect(app.querySelector('form')).toBeNull();
    expect(app.querySelector<HTMLAnchorElement>('a[href="/join"]')).not.toBeNull();
  });

  it('停權者看不到表單，也不被指去加入', async () => {
    const app = await render({ viewer: { kind: 'suspended' } });
    expect(app.querySelector('form')).toBeNull();
    expect(app.querySelector('a[href="/join"]')).toBeNull();
    expect(app.querySelector('.paper-card__title')?.textContent).toBe('這個帳號已被停權');
  });
});

describe('/post/new 的配額與主題（§9.1、§9.6）', () => {
  it('顯示兩種配額的剩餘數', async () => {
    const app = await render({ remaining: { theme: 1, free: 2 } });
    const counts = Array.from(app.querySelectorAll('.quota__count')).map((n) => n.textContent);
    expect(counts).toEqual(['1', '2']);
  });

  it('本週沒有主題時，主題貼文停用並說明原因', async () => {
    const app = await render({ theme: null });
    expect(kindRadio(app, 'theme')?.disabled).toBe(true);
    expect(kindRadio(app, 'free')?.disabled).toBe(false);
    expect(app.textContent).toContain('本週還沒有主題');
  });

  it('有主題時把主題標題顯示出來，使用者才知道要貼什麼', async () => {
    const app = await render({ theme: THEME });
    expect(app.textContent).toContain('今天的晚餐，跟誰吃的');
    expect(kindRadio(app, 'theme')?.disabled).toBe(false);
  });

  it('主題配額用完時停用該選項，預設落在還有額度的自由貼文', async () => {
    const app = await render({ remaining: { theme: 0, free: 2 } });
    expect(kindRadio(app, 'theme')?.disabled).toBe(true);
    expect(kindRadio(app, 'free')?.checked).toBe(true);
  });

  it('兩種都用完時完全不給表單，而不是給一張送出必定失敗的表單', async () => {
    const app = await render({ remaining: { theme: 0, free: 0 } });
    expect(app.querySelector('form')).toBeNull();
    expect(app.textContent).toContain('配額都用完了');
  });
});

describe('/post/new 的送出檢查', () => {
  it('沒選照片就送出會被擋下，且不呼叫 createPost', async () => {
    const app = await render();
    await submit(app, '今天的晚餐');
    expect(mocks.createPost).not.toHaveBeenCalled();
    expect(errorText(app)).toContain('照片');
  });

  it('沒有標題就送出會被擋下（ADR-0019：標題必填）', async () => {
    const app = await render();
    attachFile(app);
    await submit(app, '   ');
    expect(mocks.createPost).not.toHaveBeenCalled();
    expect(errorText(app)).toContain('標題');
  });

  it('標題只有一個字時擋下，說出下限', async () => {
    const app = await render();
    attachFile(app);
    await submit(app, '好');
    expect(mocks.createPost).not.toHaveBeenCalled();
    expect(errorText(app)).toContain('至少 2 個字');
  });

  it('內文選填：只有照片加標題也發得出去（ADR-0019）', async () => {
    const app = await render();
    const file = attachFile(app);
    mocks.createPost.mockResolvedValue({});
    await submit(app, '今天的晚餐');

    expect(mocks.createPost).toHaveBeenCalledWith(
      { kind: 'theme', title: '今天的晚餐', body: '', file },
      'm-1',
    );
    expect(window.location.replace).toHaveBeenCalledWith('/wall');
  });

  it('標題與內文都去空白後才送出', async () => {
    const app = await render();
    const file = attachFile(app);
    mocks.createPost.mockResolvedValue({});
    await submit(app, '  今天的晚餐  ', '  跟小組一起吃的，很久沒這麼熱鬧。  ');

    expect(mocks.createPost).toHaveBeenCalledWith(
      {
        kind: 'theme',
        title: '今天的晚餐',
        body: '跟小組一起吃的，很久沒這麼熱鬧。',
        file,
      },
      'm-1',
    );
  });

  it('createPost 失敗時原樣顯示模組給的訊息，按鈕恢復可按', async () => {
    const app = await render();
    attachFile(app);
    mocks.createPost.mockRejectedValue(new Error('本週的主題貼文已經用掉了。'));
    await submit(app, '今天的晚餐');

    expect(errorText(app)).toContain('本週的主題貼文已經用掉了');
    const submitButton = app.querySelector<HTMLButtonElement>('.paper-button');
    expect(submitButton?.disabled).toBe(false);
    expect(submitButton?.textContent).toBe('貼上牆');
    expect(window.location.replace).not.toHaveBeenCalled();
  });
});
