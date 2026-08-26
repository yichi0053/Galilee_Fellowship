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
