/**
 * 牆頁的結構煙霧測試。
 *
 * §15.2 說 UI 不值得投資測試，這裡刻意只驗「畫得出來、關鍵規則沒漏掉」，
 * 不驗樣式與動畫——那些仍以真機手動測試為準。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function renderWall(): Promise<HTMLElement> {
  document.body.innerHTML = '<main id="app"></main>';
  vi.resetModules();
  await import('./wall');
  // 讓 main() 的幾個 await 跑完
  await new Promise((r) => setTimeout(r, 0));
  return document.getElementById('app') as HTMLElement;
}

beforeEach(() => {
  vi.stubEnv('VITE_USE_MOCK', 'true');
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
    expect(current?.textContent).toBe('本週');
    expect(app.querySelector('.week-pill')).toBe(current);
  });

  it('依週分區，每週各自成段（§9.4）', async () => {
    const app = await renderWall();
    expect(app.querySelectorAll('.week-section').length).toBe(4);
    expect(app.querySelectorAll('.masonry').length).toBeGreaterThan(0);
  });

  it('卡片使用資料庫存的固定旋轉角，不是每次重擲（§11.2）', async () => {
    const app = await renderWall();
    const card = app.querySelector<HTMLElement>('.polaroid');
    const rot = card?.style.getPropertyValue('--rot');
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
    // mock 刻意讓其中一週沒有主題
    expect(headings.some((h) => h.trim().split(/\s+/).length === 1)).toBe(true);
  });

  it('FAB 存在且指向發文頁（ADR-0011）', async () => {
    await renderWall();
    const el = document.querySelector<HTMLAnchorElement>('.fab');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('href')).toBe('/post/new');
  });

  it('第一則卡片顯示 10 分鐘回補倒數（§9.1）', async () => {
    const app = await renderWall();
    const hint = app.querySelector('.polaroid__refund');
    expect(hint?.textContent).toMatch(/刪除可回補配額 \d+:\d{2}/);
  });
});
