/**
 * / 的結構煙霧測試。
 *
 * §15.2：UI 只驗「畫得出來、關鍵規則沒漏掉」。這一頁的關鍵規則只有兩個——
 * 每一種身分都導得出一個去處（沒有人被留在「載入中…」），
 * 以及導向時不把網址列上的 OAuth 憑證一起帶走。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@modules/membership';

const mocks = vi.hoisted(() => ({ getViewer: vi.fn() }));
vi.mock('@modules/membership', () => ({ getViewer: mocks.getViewer }));

const replace = vi.fn();

async function render(viewer: Viewer | Error, hash = ''): Promise<HTMLElement> {
  document.body.innerHTML = '<main id="app"><p>載入中…</p></main>';
  Object.defineProperty(window, 'location', {
    value: { replace, pathname: '/', hash, href: `http://localhost:5173/${hash}` },
    writable: true,
    configurable: true,
  });
  if (viewer instanceof Error) mocks.getViewer.mockRejectedValue(viewer);
  else mocks.getViewer.mockResolvedValue(viewer);

  vi.resetModules();
  await import('./index');
  await new Promise((r) => setTimeout(r, 0));
  return document.getElementById('app') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/ —— 依身分導流', () => {
  const toWall: readonly Viewer[] = [
    { kind: 'guest' },
    { kind: 'member', memberId: 'm-1', displayName: '陳小明', avatarUrl: null },
    { kind: 'admin', memberId: 'm-2', displayName: '林大方', avatarUrl: null },
  ];

  for (const viewer of toWall) {
    it(`${viewer.kind} 送去照片牆`, async () => {
      await render(viewer);
      expect(replace).toHaveBeenCalledWith('/wall');
    });
  }

  const toJoin: readonly Viewer[] = [
    { kind: 'orphan', suggestedName: '陳小明' },
    { kind: 'left' },
    { kind: 'suspended' },
  ];

  for (const viewer of toJoin) {
    it(`${viewer.kind} 送去加入頁，那裡有對應的畫面`, async () => {
      await render(viewer);
      expect(replace).toHaveBeenCalledWith('/join');
    });
  }

  it('導向前先換掉「載入中…」，並留一條手動連結', async () => {
    const app = await render({ kind: 'guest' });
    expect(app.textContent).not.toContain('載入中');
    expect(app.querySelector<HTMLAnchorElement>('a[href="/wall"]')).not.toBeNull();
  });

  it('不把網址列上的 OAuth 憑證帶到下一頁', async () => {
    await render({ kind: 'guest' }, '#access_token=eyJhbGciOi.FAKE&refresh_token=FAKE');
    expect(replace).toHaveBeenCalledWith('/wall');
    const arg = replace.mock.calls[0]?.[0] as string;
    expect(arg).not.toContain('access_token');
  });
});

describe('/ —— 身分查不出來時', () => {
  it('顯示原因與兩個入口，而不是永遠的「載入中…」', async () => {
    const app = await render(new Error('缺少環境變數 VITE_SUPABASE_URL。'));
    expect(replace).not.toHaveBeenCalled();
    expect(app.textContent).not.toContain('載入中');
    expect(app.querySelector('.paper-message--error')?.textContent).toContain('VITE_SUPABASE_URL');
    expect(app.querySelector('a[href="/wall"]')).not.toBeNull();
    expect(app.querySelector('a[href="/join"]')).not.toBeNull();
  });
});
