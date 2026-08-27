import { describe, expect, it } from 'vitest';
import { IMAGE } from '@config/constants';
import { clampCrop, cropToPixels, defaultCrop, fitLongEdge } from './geometry';

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

describe('defaultCrop —— 使用者還沒動手時的預設框', () => {
  it('比例在允許範圍內的照片，預設整張都要', () => {
    // 3:4 直式手機照 = 0.75，落在 0.62 至 1.5 之間
    expect(defaultCrop({ width: 1200, height: 1600 })).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    // 4:3 橫式 = 1.33
    expect(defaultCrop({ width: 1600, height: 1200 })).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('9:16 截圖太長，預設保留整個寬度並置中裁掉上下', () => {
    const crop = defaultCrop({ width: 900, height: 1600 });
    expect(crop.width).toBe(1);
    expect(crop.height).toBeCloseTo(0.5625 / 0.62, 5);
    // 置中：上下裁掉的一樣多
    expect(crop.y).toBeCloseTo((1 - crop.height) / 2, 5);
  });

  it('全景照太扁，預設保留整個高度並置中裁掉左右', () => {
    const crop = defaultCrop({ width: 3000, height: 1000 });
    expect(crop.height).toBe(1);
    expect(crop.width).toBeCloseTo(1.5 / 3, 5);
    expect(crop.x).toBeCloseTo((1 - crop.width) / 2, 5);
  });

  it('預設框本身一定是合法的框', () => {
    for (const size of [
      { width: 900, height: 1600 },
      { width: 3000, height: 1000 },
      { width: 1200, height: 1600 },
    ]) {
      expect(clampCrop(defaultCrop(size), size)).toEqual(defaultCrop(size));
    }
  });
});

describe('clampCrop —— 拖曳時把框修正成合法的框', () => {
  const square = { width: 1000, height: 1000 };

  it('超出左上角的框被推回圖內', () => {
    const r = clampCrop({ x: -0.3, y: -0.2, width: 0.5, height: 0.5 }, square);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it('超出右下角的框被推回圖內，而不是被縮小', () => {
    const r = clampCrop({ x: 0.8, y: 0.9, width: 0.5, height: 0.5 }, square);
    expect(r.x).toBeCloseTo(0.5, 5);
    expect(r.y).toBeCloseTo(0.5, 5);
    expect(r.width).toBe(0.5);
  });

  it('太長的框被夾到 0.62，使用者拉不出會獨佔整欄的卡片', () => {
    const r = clampCrop({ x: 0, y: 0, width: 0.3, height: 1 }, square);
    expect((r.width / r.height) * 1).toBeCloseTo(0.62, 5);
  });

  it('太扁的框被夾到 1.5，使用者拉不出看不出內容的細縫', () => {
    const r = clampCrop({ x: 0, y: 0, width: 1, height: 0.3 }, square);
    expect((r.width / r.height) * 1).toBeCloseTo(1.5, 5);
  });

  it('比例的判定要吃進原圖本身的長寬比', () => {
    // 在 2:1 的原圖上，一個「正方形的比例值」其實是 2:1 的形狀，該被夾住
    const wide = { width: 2000, height: 1000 };
    const r = clampCrop({ x: 0, y: 0, width: 0.5, height: 0.5 }, wide);
    expect((r.width / r.height) * 2).toBeLessThanOrEqual(1.5 + 1e-9);
  });

  it('框不會被縮到只剩幾個像素', () => {
    const r = clampCrop({ x: 0.5, y: 0.5, width: 0.001, height: 0.001 }, square);
    expect(r.width).toBeGreaterThanOrEqual(0.2);
    expect(r.height).toBeGreaterThanOrEqual(0.2);
  });

  it('修正後的框一定仍在圖內——先夾尺寸再夾位置的理由', () => {
    const r = clampCrop({ x: 0.95, y: 0.95, width: 0.1, height: 1 }, square);
    expect(r.x + r.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(r.y + r.height).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('cropToPixels —— 換算成原圖上的像素', () => {
  it('整張圖就是整張圖', () => {
    expect(cropToPixels({ x: 0, y: 0, width: 1, height: 1 }, { width: 1200, height: 1600 })).toEqual(
      { sx: 0, sy: 0, sw: 1200, sh: 1600 },
    );
  });

  it('中間那一半', () => {
    expect(
      cropToPixels({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, { width: 1000, height: 800 }),
    ).toEqual({ sx: 250, sy: 200, sw: 500, sh: 400 });
  });

  it('四捨五入之後每邊至少 1 px，否則 canvas 會拋錯', () => {
    const r = cropToPixels({ x: 0, y: 0, width: 0.0001, height: 0.0001 }, { width: 100, height: 100 });
    expect(r.sw).toBeGreaterThanOrEqual(1);
    expect(r.sh).toBeGreaterThanOrEqual(1);
  });

  it('四捨五入不會讓範圍超出原圖邊界', () => {
    const r = cropToPixels({ x: 0.999, y: 0.999, width: 0.5, height: 0.5 }, { width: 999, height: 777 });
    expect(r.sx + r.sw).toBeLessThanOrEqual(999);
    expect(r.sy + r.sh).toBeLessThanOrEqual(777);
  });
});
