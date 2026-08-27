/**
 * 牆頁的結構煙霧測試。
 *
 * §15.2 說 UI 不值得投資測試，這裡刻意只驗「畫得出來、關鍵規則沒漏掉」，
 * 不驗樣式與動畫——那些仍以真機手動測試為準。
 *
 * modules 一律 mock：它們會 import db/client，而該檔在缺少環境變數時
 * 於載入當下就拋錯。順帶讓「訪客 vs 成員」這組分岔變得可測——
 * 舊版靠 VITE_USE_MOCK 餵假資料時，訪客那條路徑是測不到的。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shiftWeeks, weekStartOf } from '@domain/week';
import type { WeekStart } from '@domain/week';
import type { Post, PostId } from '@modules/posts';
import type { Viewer } from '@modules/membership';

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  listWeek: vi.fn(),
  listWeeks: vi.fn(),
  getThemeForWeek: vi.fn(),
}));

vi.mock('@modules/membership', () => ({
  getViewer: mocks.getViewer,
  // 純函式，照真實行為給一份，避免測試與實作對 canPost 的定義各說各話。
  canPost: (v: Viewer) => v.kind === 'member' || v.kind === 'admin',
}));
vi.mock('@modules/posts', () => ({ listWeek: mocks.listWeek, listWeeks: mocks.listWeeks }));
vi.mock('@modules/themes', () => ({ getThemeForWeek: mocks.getThemeForWeek }));

const MEMBER: Viewer = { kind: 'member', memberId: 'm-1', displayName: '陳小明' };
const GUEST: Viewer = { kind: 'guest' };

function makePost(index: number, week: WeekStart, refundable: boolean): Post {
  const createdAt = new Date(Date.now() - index * 60_000);
  return {
    id: `p-${week}-${index}` as PostId,
    kind: index === 0 ? 'theme' : 'free',
    title: `第 ${index} 則的標題`,
    body: `第 ${index} 則貼文，內容長度要過得了十個字的下限。`,
    imageUrl: `https://example.test/i${index}.jpg`,
    thumbUrl: `https://example.test/t${index}.jpg`,
    // §11.2 的範圍是 -3 到 3，且必須是資料庫存的固定值
    rotationDeg: (index % 7) - 3,
    week,
    authorName: '陳小明',
    authorId: 'm-1',
    createdAt,
    refundableUntil: refundable ? new Date(Date.now() + 8 * 60_000) : null,
    hiddenByAdmin: false,
  };
}

async function renderWall(viewer: Viewer = MEMBER): Promise<HTMLElement> {
  document.body.innerHTML = '<main id="app"></main>';
  mocks.getViewer.mockResolvedValue(viewer);
  mocks.listWeek.mockImplementation((week: WeekStart) =>
    Promise.resolve([0, 1, 2].map((i) => makePost(i, week, viewer.kind === 'member'))),
  );
  // 本週與三週前有貼文，中間兩週是空的——用來驗選擇器不跳號
  const now = weekStartOf();
  mocks.listWeeks.mockResolvedValue([
    { week: now, count: 3 },
    { week: shiftWeeks(now, -3), count: 1 },
  ]);
  // 最舊的那一週刻意沒有主題，用來驗 §9.6 的空窗週處理
  const oldest = shiftWeeks(weekStartOf(), -3);
  mocks.getThemeForWeek.mockImplementation((week: WeekStart) =>
    Promise.resolve(
      week === oldest ? null : { id: `th-${week}`, week, title: '今天的晚餐', description: null },
    ),
  );

  vi.resetModules();
  await import('./wall');
  await new Promise((r) => setTimeout(r, 0));
  return document.getElementById('app') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  // 選到的週次會寫進網址的 hash（那是刻意的：重新整理要停在同一週），
  // 而 happy-dom 的 location 在同一個檔案裡不會自己重置，
  // 不清掉的話上一個測試點過的週次會變成下一個測試的起點。
  history.replaceState(null, '', '/wall');
  // happy-dom 沒有 IntersectionObserver，補一個不做事的替身
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

describe('牆頁', () => {
  it('畫出頂部三層（§10.2）', async () => {
    const app = await renderWall();
    expect(app.querySelector('.wall-nav')).not.toBeNull();
    expect(app.querySelector('.theme-banner')).not.toBeNull();
    expect(app.querySelector('.week-picker')).not.toBeNull();
  });

  it('週次選擇器預設落在本週，不是第 1 週（§10.6）', async () => {
    const app = await renderWall();
    const current = app.querySelector('.week-pill[aria-current="true"]');
    expect(current?.querySelector('.week-pill__label')?.textContent).toBe('本週');
    expect(app.querySelector('.week-pill')).toBe(current);
  });

  it('一次只顯示一週（§10.6）：18 週全部堆在同一頁會捲不完', async () => {
    const app = await renderWall();
    expect(app.querySelectorAll('.week-section').length).toBe(1);
    expect(app.querySelectorAll('.masonry').length).toBe(1);
    expect(mocks.listWeek).toHaveBeenCalledTimes(1);
  });

  it('卡片使用資料庫存的固定旋轉角，不是每次重擲（§11.2）', async () => {
    const app = await renderWall();
    const rot = app.querySelector<HTMLElement>('.polaroid')?.style.getPropertyValue('--rot');
    expect(rot).toMatch(/^-?[0-3]deg$/);

    const again = await renderWall();
    expect(again.querySelector<HTMLElement>('.polaroid')?.style.getPropertyValue('--rot')).toBe(rot);
  });

  it('縮圖一律 lazy load（§9.4：egress 比 storage 更早觸頂）', async () => {
    const app = await renderWall();
    const imgs = Array.from(app.querySelectorAll<HTMLImageElement>('.polaroid__img'));
    expect(imgs.length).toBeGreaterThan(0);
    expect(imgs.every((i) => i.getAttribute('loading') === 'lazy')).toBe(true);
  });

  it('沒有主題的那一週顯示說明而不是留白（§9.6）', async () => {
    const app = await renderWall();
    const headings = Array.from(app.querySelectorAll('.week-section__heading')).map(
      (h) => h.textContent ?? '',
    );
    expect(headings.some((h) => h.trim().split(/\s+/).length === 1)).toBe(true);
  });
});

describe('牆頁的成員視角', () => {
  it('FAB 指向發文頁（ADR-0011）', async () => {
    await renderWall(MEMBER);
    expect(document.querySelector<HTMLAnchorElement>('.fab')?.getAttribute('href')).toBe(
      '/post/new',
    );
  });

  it('顯示 10 分鐘回補倒數（§9.1）', async () => {
    const app = await renderWall(MEMBER);
    expect(app.querySelector('.polaroid__refund')?.textContent).toMatch(/刪除可回補配額 \d+:\d{2}/);
  });

  it('以自己的 memberId 查詢，才拿得到未遮蔽姓名與自己的倒數', async () => {
    await renderWall(MEMBER);
    for (const call of mocks.listWeek.mock.calls) {
      expect(call[1]).toBe('m-1');
    }
  });
});

describe('牆頁的訪客視角（§10.3）', () => {
  it('FAB 改為加入引導，不是發文', async () => {
    await renderWall(GUEST);
    const el = document.querySelector<HTMLAnchorElement>('.fab');
    expect(el?.getAttribute('href')).toBe('/join');
    expect(el?.className).toContain('fab--guest');
  });

  it('查詢時不帶 memberId，資料層才會走 posts_public', async () => {
    await renderWall(GUEST);
    expect(mocks.listWeek).toHaveBeenCalled();
    for (const call of mocks.listWeek.mock.calls) {
      expect(call[1]).toBeNull();
    }
  });

  it('不顯示回補倒數：那是給作者本人的資訊', async () => {
    const app = await renderWall(GUEST);
    expect(app.querySelector('.polaroid')).not.toBeNull();
    expect(app.querySelector('.polaroid__refund')).toBeNull();
  });
});

describe('牆頁的失敗處理', () => {
  it('身分查不出來時顯示原因，不留一個永遠的載入中', async () => {
    document.body.innerHTML = '<main id="app">載入中…</main>';
    mocks.getViewer.mockRejectedValue(new Error('缺少環境變數 VITE_ROOM_ID'));
    vi.resetModules();
    await import('./wall');
    await new Promise((r) => setTimeout(r, 0));

    const app = document.getElementById('app') as HTMLElement;
    expect(app.textContent).toContain('VITE_ROOM_ID');
    expect(app.textContent).not.toContain('載入中');
  });

  it('某一週載入失敗時顯示原因，且選擇器還在，可以切到別週', async () => {
    document.body.innerHTML = '<main id="app"></main>';
    mocks.getViewer.mockResolvedValue(MEMBER);
    mocks.getThemeForWeek.mockResolvedValue(null);
    mocks.listWeeks.mockResolvedValue([{ week: weekStartOf(), count: 0 }]);
    mocks.listWeek.mockRejectedValue(new Error('這一週壞掉了'));

    vi.resetModules();
    await import('./wall');
    await new Promise((r) => setTimeout(r, 0));

    const app = document.getElementById('app') as HTMLElement;
    expect(app.textContent).toContain('這一週壞掉了');
    expect(app.querySelector('.week-picker')).not.toBeNull();
  });

  it('週次列拿不到時仍畫得出本週，而不是整面牆消失', async () => {
    document.body.innerHTML = '<main id="app"></main>';
    mocks.getViewer.mockResolvedValue(MEMBER);
    mocks.getThemeForWeek.mockResolvedValue(null);
    mocks.listWeeks.mockRejectedValue(new Error('週次列壞了'));
    mocks.listWeek.mockResolvedValue([makePost(0, weekStartOf(), false)]);

    vi.resetModules();
    await import('./wall');
    await new Promise((r) => setTimeout(r, 0));

    const app = document.getElementById('app') as HTMLElement;
    expect(app.querySelectorAll('.week-pill').length).toBe(1);
    expect(app.querySelectorAll('.polaroid').length).toBe(1);
  });
});

describe('牆頁的週次選擇器（§10.6）', () => {
  it('週次連續，中間沒有貼文的那幾週也留著——跳號會讓人以為載入壞掉', async () => {
    const app = await renderWall();
    const pills = Array.from(app.querySelectorAll<HTMLElement>('.week-pill'));
    expect(pills.length).toBe(4);
    expect(pills.map((p) => p.dataset['week'])).toEqual([
      weekStartOf(),
      shiftWeeks(weekStartOf(), -1),
      shiftWeeks(weekStartOf(), -2),
      shiftWeeks(weekStartOf(), -3),
    ]);
  });

  it('沒有貼文的週次標記為空，並且不顯示則數', async () => {
    const app = await renderWall();
    const pills = Array.from(app.querySelectorAll<HTMLElement>('.week-pill'));
    expect(pills[0]?.dataset['empty']).toBe('false');
    expect(pills[0]?.querySelector('.week-pill__count')?.textContent).toBe('3');
    expect(pills[1]?.dataset['empty']).toBe('true');
    expect(pills[1]?.querySelector('.week-pill__count')).toBeNull();
  });

  it('點膠囊會換掉整面牆的內容，而不是捲動定位', async () => {
    const app = await renderWall();
    const target = shiftWeeks(weekStartOf(), -2);
    app
      .querySelector<HTMLButtonElement>(`.week-pill[data-week="${target}"]`)
      ?.dispatchEvent(new Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(mocks.listWeek).toHaveBeenLastCalledWith(target, 'm-1');
    expect(app.querySelectorAll('.week-section').length).toBe(1);
    expect(app.querySelector('.week-section')?.id).toBe(`week-${target}`);
  });

  it('本週時「較新」箭頭停用，最舊那週時「較舊」箭頭停用', async () => {
    const app = await renderWall();
    const arrows = Array.from(app.querySelectorAll<HTMLButtonElement>('.week-arrow'));
    expect(arrows[0]?.disabled).toBe(true);
    expect(arrows[1]?.disabled).toBe(false);

    arrows[1]?.dispatchEvent(new Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.listWeek).toHaveBeenLastCalledWith(shiftWeeks(weekStartOf(), -1), 'm-1');
  });

  it('主題橫幅在看舊週次時改口，不會說「本週主題」卻顯示三週前的題目', async () => {
    const app = await renderWall();
    expect(app.querySelector('.theme-banner__label')?.textContent).toBe('本週主題');

    app
      .querySelector<HTMLButtonElement>(`.week-pill[data-week="${shiftWeeks(weekStartOf(), -1)}"]`)
      ?.dispatchEvent(new Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(app.querySelector('.theme-banner__label')?.textContent).toContain('那一週的主題');
  });
});

describe('頂部只有週次選擇器釘在頂端（§10.2）', () => {
  it('週次 bar 是 .wall-top 的直接子元素，沒有中間那層收合容器', async () => {
    const app = await renderWall();
    const bar = app.querySelector('.week-bar');
    expect(bar?.parentElement?.className).toBe('wall-top');
    expect(app.querySelector('.wall-collapsible')).toBeNull();
  });

  it('不再有 data-collapsed——收合已移除，bar 一律待在原地', async () => {
    const app = await renderWall();
    expect(app.querySelector<HTMLElement>('.wall-top')?.dataset['collapsed']).toBeUndefined();
  });

  it('導覽列與主題橫幅仍在，只是會跟著捲走', async () => {
    const app = await renderWall();
    expect(app.querySelector('.wall-nav')).not.toBeNull();
    expect(app.querySelector('.theme-banner')).not.toBeNull();
  });
});
