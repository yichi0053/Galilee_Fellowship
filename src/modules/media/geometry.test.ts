import { describe, expect, it } from 'vitest';
import { IMAGE } from '@config/constants';
import { fitLongEdge } from './geometry';

const MAIN = IMAGE.mainLongEdgePx; // 1600
const THUMB = IMAGE.thumbLongEdgePx; // 250

describe('fitLongEdge', () => {
  it('橫向照片以寬為長邊', () => {
    expect(fitLongEdge({ width: 4000, height: 3000 }, MAIN)).toEqual({ width: 1600, height: 1200 });
  });

  it('直向照片以高為長邊（手機最常見的情況）', () => {
    expect(fitLongEdge({ width: 3000, height: 4000 }, MAIN)).toEqual({ width: 1200, height: 1600 });
  });

  it('正方形', () => {
    expect(fitLongEdge({ width: 2000, height: 2000 }, THUMB)).toEqual({ width: 250, height: 250 });
  });

  it('不放大：原圖小於上限時原樣回傳', () => {
    const small = { width: 800, height: 600 };
    expect(fitLongEdge(small, MAIN)).toEqual(small);
  });

  it('剛好等於上限時不動', () => {
    const exact = { width: 1600, height: 900 };
    expect(fitLongEdge(exact, MAIN)).toEqual(exact);
  });

  it('極端長寬比的短邊不會變成 0', () => {
    const { width, height } = fitLongEdge({ width: 5000, height: 3 }, THUMB);
    expect(width).toBe(250);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it('維持長寬比（誤差在一個像素內）', () => {
    const src = { width: 4032, height: 3024 };
    const out = fitLongEdge(src, MAIN);
    expect(Math.abs(out.width / out.height - src.width / src.height)).toBeLessThan(0.01);
  });

  it('尺寸為 0 時不除以零', () => {
    expect(fitLongEdge({ width: 0, height: 0 }, MAIN)).toEqual({ width: 0, height: 0 });
  });
});
