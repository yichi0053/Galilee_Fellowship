/**
 * media 的純幾何運算。internal 檔案（§12.4 規則 1）。
 */

export type Size = { readonly width: number; readonly height: number };

/**
 * 等比縮放至長邊不超過 maxLongEdge。
 *
 * **不放大**：原圖長邊已小於上限時原樣回傳。
 * 把 800 px 的圖拉到 1600 px 只會讓檔案變大、畫質不變，
 * 直接違背 §9.4 的 egress 控制。
 */
export function fitLongEdge(size: Size, maxLongEdge: number): Size {
  const longEdge = Math.max(size.width, size.height);
  if (longEdge <= maxLongEdge || longEdge === 0) return size;

  const scale = maxLongEdge / longEdge;
  return {
    // 四捨五入後至少為 1，避免極端長寬比產生 0 px 的邊而讓 canvas 拋錯
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/**
 * 縮圖的裁切範圍，以 0 至 1 的比例表示（ADR-0020）。
 *
 * 刻意不用像素：使用者是在一張被縮放過的預覽圖上拖曳的，
 * 而真正要裁的是原始解析度的 bitmap。存比例讓兩者脫鉤——
 * 預覽圖多大、原圖多大，都不影響這個值的意義。
 */
export type CropRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * 卡片顯示框允許的長寬比範圍（polaroid.ts 的 RATIO_MIN / RATIO_MAX 同一組數字）。
 *
 * **裁切框在拖曳時就夾在這個範圍內**，而不是裁完再由 CSS 夾。
 * 兩段各夾一次的話，使用者精心框出來的 9:16 會在牆上被 object-fit 再裁一刀——
 * 他選的範圍和看到的結果對不起來，那比不給選還糟。
 */
export const CROP_RATIO_MIN = 0.62;
export const CROP_RATIO_MAX = 1.5;

/** 裁切框的最短邊不得小於原圖短邊的這個比例，避免框到剩幾個像素 */
const MIN_SIDE_FRACTION = 0.2;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * 整張圖能容納、且比例落在允許範圍內的最大置中矩形。
 *
 * 這是使用者還沒動手時的預設框：比例在範圍內的照片會拿到「整張都要」，
 * 9:16 這類太長的則預設框出中間那一段。
 */
export function defaultCrop(size: Size): CropRect {
  const ratio = size.width / size.height;
  if (ratio >= CROP_RATIO_MIN && ratio <= CROP_RATIO_MAX) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  if (ratio < CROP_RATIO_MIN) {
    // 太長：保留整個寬度，裁掉上下
    const height = ratio / CROP_RATIO_MIN;
    return { x: 0, y: (1 - height) / 2, width: 1, height };
  }
  // 太扁：保留整個高度，裁掉左右
  const width = CROP_RATIO_MAX / ratio;
  return { x: (1 - width) / 2, y: 0, width, height: 1 };
}

/**
 * 把任意一個框修正成合法的框：留在圖內、比例在範圍內、不會小到沒有意義。
 *
 * 順序有意義——先夾尺寸再夾位置。反過來的話，調整尺寸可能又把框推出圖外，
 * 而那個溢出不會有第二次機會被修正。
 */
export function clampCrop(rect: CropRect, size: Size): CropRect {
  const imageRatio = size.width / size.height;

  // 先夾最小邊長
  let width = clamp(rect.width, MIN_SIDE_FRACTION, 1);
  let height = clamp(rect.height, MIN_SIDE_FRACTION, 1);

  // 再夾比例。比例是以「像素」算的，所以要乘上原圖的長寬比，
  // 否則在非正方形的原圖上，同樣的比例值代表的形狀完全不同。
  const ratio = (width / height) * imageRatio;
  if (ratio < CROP_RATIO_MIN) {
    height = clamp((width * imageRatio) / CROP_RATIO_MIN, MIN_SIDE_FRACTION, 1);
  } else if (ratio > CROP_RATIO_MAX) {
    width = clamp((height * CROP_RATIO_MAX) / imageRatio, MIN_SIDE_FRACTION, 1);
  }

  // 最後夾位置，確保整個框留在圖內
  return {
    x: clamp(rect.x, 0, 1 - width),
    y: clamp(rect.y, 0, 1 - height),
    width,
    height,
  };
}

/** 這個框在原圖上的實際像素範圍。四捨五入後每邊至少 1 px，避免 canvas 拋錯 */
export function cropToPixels(
  rect: CropRect,
  size: Size,
): { sx: number; sy: number; sw: number; sh: number } {
  const sw = Math.max(1, Math.round(rect.width * size.width));
  const sh = Math.max(1, Math.round(rect.height * size.height));
  return {
    sx: clamp(Math.round(rect.x * size.width), 0, size.width - sw),
    sy: clamp(Math.round(rect.y * size.height), 0, size.height - sh),
    sw,
    sh,
  };
}
