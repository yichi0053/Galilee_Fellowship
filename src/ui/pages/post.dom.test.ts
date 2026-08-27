/**
 * /post/:id 的結構煙霧測試。
 *
 * §15.2：UI 只驗「畫得出來、關鍵規則沒漏掉」。這一頁的關鍵規則是
 * 「誰看得到刪除按鈕」——寫錯的方向有兩種，一種讓人刪不掉自己的貼文，
 * 另一種讓人看到別人的刪除鍵。後者伺服器會擋（migration 007），但那時
 * 使用者已經按下去了，看到的是一句 raise exception，那不是好的失敗方式。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@modules/membership';
import type { Post, PostId } from '@modules/posts';

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  getPost: vi.fn(),
  deletePost: vi.fn(),
  hidePost: vi.fn(),
  unhidePost: vi.fn(),
}));

vi.mock('@modules/membership', () => ({ getViewer: mocks.getViewer }));
vi.mock('@modules/posts', () => ({ getPost: mocks.getPost, deletePost: mocks.deletePost }));
vi.mock('@modules/admin', () => ({ hidePost: mocks.hidePost, unhidePost: mocks.unhidePost }));

const POST_ID = '11497c3e-ce30-4398-8390-63925d87af89';
const AUTHOR: Viewer = { kind: 'member', memberId: 'm-1', displayName: '陳小明', avatarUrl: null };
const OTHER: Viewer = { kind: 'member', memberId: 'm-2', displayName: '林大華', avatarUrl: null };
const ADMIN: Viewer = { kind: 'admin', memberId: 'm-9', displayName: '負責人', avatarUrl: null };

function makePost(over: Partial<Post> = {}): Post {
  return {
    id: POST_ID as PostId,
    kind: 'free',
    title: '測試標題',
    body: '宿舍樓下那攤滷味，老闆記得我不吃香菜。',
    imageUrl: 'https://example.test/i.jpg',
    thumbUrl: 'https://example.test/t.jpg',
    rotationDeg: -1,
    week: '2026-08-24' as Post['week'],
    authorName: '陳小明',
    authorId: 'm-1',
    createdAt: new Date(Date.now() - 60_000),
    refundableUntil: new Date(Date.now() + 9 * 60_000),
    hiddenByAdmin: false,
    ...over,
  };
}

async function render(
  options: { viewer?: Viewer; post?: Post | null; path?: string } = {},
): Promise<HTMLElement> {
  document.body.innerHTML = '<main id="app"></main>';
  Object.defineProperty(window, 'location', {
    value: {
      replace: vi.fn(),
      reload: vi.fn(),
      pathname: options.path ?? `/post/${POST_ID}`,
      href: `http://localhost:5173${options.path ?? `/post/${POST_ID}`}`,
    },
    writable: true,
    configurable: true,
  });
  mocks.getViewer.mockResolvedValue(options.viewer ?? AUTHOR);
  mocks.getPost.mockResolvedValue(options.post === undefined ? makePost() : options.post);

  vi.resetModules();
  await import('./post');
  await new Promise((r) => setTimeout(r, 0));
  return document.getElementById('app') as HTMLElement;
}

const deleteButton = (app: HTMLElement): HTMLButtonElement | null =>
  app.querySelector<HTMLButtonElement>('.paper-button--danger');

async function clickThrough(app: HTMLElement, labels: string[]): Promise<void> {
  for (const label of labels) {
    const btn = Array.from(app.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === label,
    );
    btn?.dispatchEvent(new Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  // 這兩支回傳 Promise<void>，mock 不給值的話 vi.fn() 回 undefined，
  // 程式碼對它呼叫 .then 就會炸——那是測試沒設好，不是實作有問題。
  mocks.hidePost.mockResolvedValue(undefined);
  mocks.unhidePost.mockResolvedValue(undefined);
});

describe('/post/:id 的可見性', () => {
  it('作者看得到刪除按鈕與回補倒數', async () => {
    const app = await render({ viewer: AUTHOR });
    expect(deleteButton(app)?.textContent).toBe('刪除這則貼文');
    expect(app.querySelector('.owner__countdown')?.textContent).toMatch(/還有 \d+:\d{2}/);
  });

  it('別的成員看不到刪除按鈕', async () => {
    const app = await render({ viewer: OTHER });
    expect(deleteButton(app)).toBeNull();
    expect(app.querySelector('.owner')).toBeNull();
  });

  it('訪客看得到貼文但沒有任何操作（posts_public 不含 author_id）', async () => {
    const app = await render({ viewer: { kind: 'guest' }, post: makePost({ authorId: null }) });
    expect(app.querySelector('.post-body')).not.toBeNull();
    expect(deleteButton(app)).toBeNull();
  });

  it('回補期已過時仍可刪除，但明說不會拿回配額', async () => {
    const app = await render({ post: makePost({ refundableUntil: null }) });
    expect(deleteButton(app)).not.toBeNull();
    expect(app.querySelector('.owner__countdown')?.textContent).toContain('不會拿回');
  });

  it('被下架的貼文對作者顯示說明，而不是安靜地照常呈現（§9.5）', async () => {
    const app = await render({ post: makePost({ hiddenByAdmin: true }) });
    expect(app.querySelector('.paper-message--error')?.textContent).toContain('下架');
  });

  it('查無貼文時給出說明而不是空白', async () => {
    const app = await render({ post: null });
    expect(app.querySelector('.paper-card__title')?.textContent).toBe('找不到這則貼文');
    expect(mocks.getPost).toHaveBeenCalledWith(POST_ID, 'm-1');
  });

  it('網址不是 uuid 時不去查資料庫', async () => {
    const app = await render({ path: '/post/not-a-uuid' });
    expect(mocks.getPost).not.toHaveBeenCalled();
    expect(app.querySelector('.paper-card__title')?.textContent).toBe('找不到這則貼文');
  });
});

describe('/post/:id 的刪除流程（ADR-0009：無法復原）', () => {
  it('第一下只展開確認，不呼叫 deletePost', async () => {
    const app = await render();
    await clickThrough(app, ['刪除這則貼文']);
    expect(mocks.deletePost).not.toHaveBeenCalled();
    expect(app.querySelector('.owner__confirm')).not.toBeNull();
  });

  it('按「算了」收回確認，貼文還在', async () => {
    const app = await render();
    await clickThrough(app, ['刪除這則貼文', '算了']);
    expect(mocks.deletePost).not.toHaveBeenCalled();
    expect(deleteButton(app)?.textContent).toBe('刪除這則貼文');
  });

  it('確認後才呼叫 deletePost，成功則回牆頁', async () => {
    const app = await render();
    mocks.deletePost.mockResolvedValue(undefined);
    await clickThrough(app, ['刪除這則貼文', '確定刪除']);
    expect(mocks.deletePost).toHaveBeenCalledWith(POST_ID);
    expect(window.location.replace).toHaveBeenCalledWith('/wall');
  });

  it('刪除失敗時顯示原因，並讓按鈕回到可再試的狀態', async () => {
    const app = await render();
    mocks.deletePost.mockRejectedValue(new Error('刪除失敗：只能刪除自己的貼文'));
    await clickThrough(app, ['刪除這則貼文', '確定刪除']);
    expect(app.querySelector('.paper-message--error')?.textContent).toContain('只能刪除自己的貼文');
    expect(deleteButton(app)?.textContent).toBe('刪除這則貼文');
    expect(window.location.replace).not.toHaveBeenCalled();
  });
});

describe('/post/:id 的管理員操作（§9.5）', () => {
  it('管理員看得到下架按鈕，一般成員看不到', async () => {
    const asAdmin = await render({ viewer: ADMIN });
    expect(asAdmin.textContent).toContain('下架這則貼文');

    const asMember = await render({ viewer: OTHER });
    expect(asMember.textContent).not.toContain('下架這則貼文');
  });

  it('已下架的貼文，管理員看到的是復原而不是再下架一次', async () => {
    const app = await render({ viewer: ADMIN, post: makePost({ hiddenByAdmin: true }) });
    expect(app.textContent).toContain('復原這則貼文');
    expect(app.textContent).not.toContain('下架這則貼文');
  });

  it('下架呼叫 hidePost，復原呼叫 unhidePost —— 這兩顆最不能接反', async () => {
    const app = await render({ viewer: ADMIN });
    await clickThrough(app, ['下架這則貼文']);
    expect(mocks.hidePost).toHaveBeenCalledWith(POST_ID);
    expect(mocks.unhidePost).not.toHaveBeenCalled();

    const app2 = await render({ viewer: ADMIN, post: makePost({ hiddenByAdmin: true }) });
    await clickThrough(app2, ['復原這則貼文']);
    expect(mocks.unhidePost).toHaveBeenCalledWith(POST_ID);
  });

  it('管理員若同時是作者，兩組操作都在（§4.1：管理員繼承成員權限）', async () => {
    const app = await render({ viewer: ADMIN, post: makePost({ authorId: 'm-9' }) });
    expect(app.textContent).toContain('刪除這則貼文');
    expect(app.textContent).toContain('下架這則貼文');
  });
});

describe('/post/:id 的標題與內文（ADR-0019）', () => {
  it('標題是這一頁的 h1，排在照片之上', async () => {
    const app = await render({ post: makePost({ title: '今天的晚餐' }) });
    const h1 = app.querySelector('.post-title');
    expect(h1?.tagName).toBe('H1');
    expect(h1?.textContent).toBe('今天的晚餐');
  });

  it('沒有內文時整段不渲染，不留一個空的段落把版面撐開', async () => {
    const app = await render({ post: makePost({ body: null }) });
    expect(app.querySelector('.post-body')).toBeNull();
    expect(app.querySelector('.post-title')).not.toBeNull();
  });

  it('有內文時照常顯示', async () => {
    const app = await render({ post: makePost({ body: '跟小組一起吃的。' }) });
    expect(app.querySelector('.post-body')?.textContent).toBe('跟小組一起吃的。');
  });
});
