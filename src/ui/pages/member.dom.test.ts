/**
 * /member/:id 的結構煙霧測試。
 *
 * §15.2：UI 只驗「畫得出來、關鍵規則沒漏掉」。這一頁的關鍵規則有兩個——
 * 被下架的貼文必須看得出來不是正常狀態（§9.5），
 * 以及第二期功能不可以在第一期就開（ADR-0013）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@modules/membership';
import type { Post, PostId } from '@modules/posts';

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  listMine: vi.fn(),
  getMyQuota: vi.fn(),
}));

vi.mock('@modules/membership', () => ({ getViewer: mocks.getViewer }));
vi.mock('@modules/posts', () => ({ listMine: mocks.listMine, getMyQuota: mocks.getMyQuota }));

const MEMBER: Viewer = { kind: 'member', memberId: 'm-1', displayName: '陳小明', avatarUrl: null };

function makePost(i: number, over: Partial<Post> = {}): Post {
  return {
    id: `p-${i}` as PostId,
    kind: 'free',
    title: '測試標題',
    body: `第 ${i} 則貼文，長度要過得了十個字的下限。`,
    imageUrl: `https://example.test/i${i}.jpg`,
    thumbUrl: `https://example.test/t${i}.jpg`,
    rotationDeg: (i % 7) - 3,
    week: '2026-08-24' as Post['week'],
    authorName: '陳小明',
    authorId: 'm-1',
    createdAt: new Date(Date.now() - i * 86_400_000),
    deletableUntil: null,
    hiddenByAdmin: false,
    ...over,
  };
}

async function render(
  options: { viewer?: Viewer; posts?: Post[]; path?: string } = {},
): Promise<HTMLElement> {
  document.body.innerHTML = '<main id="app"></main>';
  const path = options.path ?? '/member/me';
  Object.defineProperty(window, 'location', {
    value: { replace: vi.fn(), pathname: path, href: `http://localhost:5173${path}` },
    writable: true,
    configurable: true,
  });
  mocks.getViewer.mockResolvedValue(options.viewer ?? MEMBER);
  mocks.listMine.mockResolvedValue(options.posts ?? [makePost(1), makePost(2)]);
  mocks.getMyQuota.mockResolvedValue({
    week: '2026-08-24',
    remaining: { theme: 1, free: 0 },
  });

  vi.resetModules();
  await import('./member');
  await new Promise((r) => setTimeout(r, 0));
  return document.getElementById('app') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

describe('/member/me', () => {
  it('列出自己的貼文，並以自己的 memberId 查詢', async () => {
    const app = await render();
    expect(app.querySelectorAll('.polaroid').length).toBe(2);
    expect(mocks.listMine).toHaveBeenCalledWith('m-1');
  });

  it('標頭顯示姓名、則數與本週剩餘配額', async () => {
    const app = await render();
    expect(app.querySelector('.member-head__name')?.textContent).toBe('陳小明');
    expect(app.querySelector('.member-head__count')?.textContent).toBe('共 2 則');
    expect(app.querySelector('.member-head__quota')?.textContent).toContain('自由 0/2');
  });

  it('被下架的貼文標記出來，讓作者知道那不是正常狀態（§9.5）', async () => {
    const app = await render({ posts: [makePost(1, { hiddenByAdmin: true }), makePost(2)] });
    const marked = app.querySelectorAll('.polaroid[data-hidden="true"]');
    expect(marked.length).toBe(1);
    expect((marked[0] as HTMLElement).title).toContain('下架');
  });

  it('沒有貼文時給出下一步，而不是一片空白', async () => {
    const app = await render({ posts: [] });
    expect(app.querySelector('.polaroid')).toBeNull();
    expect(app.querySelector('.member-empty')?.textContent).toContain('還沒有貼過');
  });

  it('訪客被指去加入，看不到任何貼文', async () => {
    const app = await render({ viewer: { kind: 'guest' } });
    expect(mocks.listMine).not.toHaveBeenCalled();
    expect(app.querySelector<HTMLAnchorElement>('a[href="/join"]')).not.toBeNull();
  });
});

describe('/member/<其他人> —— memberFilter 是第二期（ADR-0013）', () => {
  it('第一期不渲染別人的貼文列表，也不假裝壞掉', async () => {
    const app = await render({ path: '/member/m-2' });
    expect(mocks.listMine).not.toHaveBeenCalled();
    expect(app.querySelector('.paper-card__title')?.textContent).toBe('這個功能還沒開放');
    expect(app.querySelector('.paper-message')?.textContent).toContain('之後才會開放');
  });
});
