/**
 * 縮圖裁切框（架構書 §9.3 / ADR-0020）。
 *
 * 使用者在預覽圖上拖曳一個框，決定這張照片在牆上顯示哪一段。
 * 框的比例即卡片的比例，所以**框在拖曳當下就被夾在 0.62 至 1.5**——
 * 讓使用者拉出 9:16 再由 CSS 裁第二刀的話，他選的範圍和看到的結果對不起來，
 * 那比不給選還糟。所有約束都在 media/geometry.ts 的 clampCrop 裡，這裡只管手勢。
 *
 * 用 Pointer Events 而不是 mouse 加 touch 兩套：一套程式碼同時涵蓋滑鼠、
 * 觸控與手寫筆，也不必自己處理 touch 與 mouse 事件在同一次點擊中都會觸發的重複。
 */

import { clampCrop, defaultCrop } from '@modules/media';
import type { CropRect, Size } from '@modules/media';

export type CropFrame = {
  /** 掛進畫面的元素 */
  readonly element: HTMLElement;
  /** 目前的裁切範圍。發文時取一次 */
  getCrop: () => CropRect;
  /** 換一張照片：重設為該尺寸的預設框 */
  reset: (size: Size, imageUrl: string) => void;
  /** 移除前呼叫，拆掉 document 上的監聽器 */
  dispose: () => void;
};

/** 拖曳中的狀態。null 代表沒有手指或滑鼠按著 */
type Drag =
  | null
  | { kind: 'move'; startX: number; startY: number; origin: CropRect }
  | { kind: 'resize'; corner: Corner; startX: number; startY: number; origin: CropRect };

type Corner = 'nw' | 'ne' | 'sw' | 'se';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function createCropFrame(): CropFrame {
  const wrap = el('div', 'crop');
  const img = el('img', 'crop__img');
  img.alt = '預覽';
  img.draggable = false;

  // 框以外的部分壓暗，讓「哪一段會上牆」一眼看得出來。
  const shade = el('div', 'crop__shade');
  const frame = el('div', 'crop__frame');
  frame.tabIndex = 0;
  frame.setAttribute('role', 'group');
  frame.setAttribute('aria-label', '拖曳決定照片在牆上顯示的範圍');

  const corners: Record<Corner, HTMLElement> = {
    nw: el('span', 'crop__handle crop__handle--nw'),
    ne: el('span', 'crop__handle crop__handle--ne'),
    sw: el('span', 'crop__handle crop__handle--sw'),
    se: el('span', 'crop__handle crop__handle--se'),
  };
  for (const [corner, node] of Object.entries(corners)) {
    node.dataset['corner'] = corner;
    frame.append(node);
  }

  wrap.append(img, shade, frame);

  let size: Size = { width: 1, height: 1 };
  let crop: CropRect = { x: 0, y: 0, width: 1, height: 1 };
  let drag: Drag = null;

  const paint = (): void => {
    const pct = (n: number): string => `${n * 100}%`;
    frame.style.left = pct(crop.x);
    frame.style.top = pct(crop.y);
    frame.style.width = pct(crop.width);
    frame.style.height = pct(crop.height);
    // 用 clip-path 在遮罩上挖一個洞，比疊四個 div 少三個節點也少三次版面計算。
    shade.style.clipPath = `polygon(
      0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
      ${pct(crop.x)} ${pct(crop.y)},
      ${pct(crop.x)} ${pct(crop.y + crop.height)},
      ${pct(crop.x + crop.width)} ${pct(crop.y + crop.height)},
      ${pct(crop.x + crop.width)} ${pct(crop.y)},
      ${pct(crop.x)} ${pct(crop.y)}
    )`;
  };

  const apply = (next: CropRect): void => {
    crop = clampCrop(next, size);
    paint();
  };

  /** 指標位移換算成 0 至 1 的比例。以元素的實際顯示尺寸為準，不是原圖尺寸 */
  const delta = (event: PointerEvent, from: { startX: number; startY: number }): Size => {
    const box = wrap.getBoundingClientRect();
    return {
      width: box.width === 0 ? 0 : (event.clientX - from.startX) / box.width,
      height: box.height === 0 ? 0 : (event.clientY - from.startY) / box.height,
    };
  };

  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target as HTMLElement;
    const corner = target.dataset['corner'] as Corner | undefined;
    if (!corner && target !== frame) return;

    // touch-action: none 已擋掉捲動，這裡再擋一次預設行為以避免長按選字。
    event.preventDefault();
    const start = { startX: event.clientX, startY: event.clientY };
    drag = corner
      ? { kind: 'resize', corner, ...start, origin: crop }
      : { kind: 'move', ...start, origin: crop };
    frame.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!drag) return;
    const d = delta(event, drag);

    if (drag.kind === 'move') {
      apply({ ...drag.origin, x: drag.origin.x + d.width, y: drag.origin.y + d.height });
      return;
    }

    // 拉角落：被拖的那一角動，對角固定不動。
    const o = drag.origin;
    const right = o.x + o.width;
    const bottom = o.y + o.height;
    const west = drag.corner === 'nw' || drag.corner === 'sw';
    const north = drag.corner === 'nw' || drag.corner === 'ne';

    const x = west ? o.x + d.width : o.x;
    const y = north ? o.y + d.height : o.y;
    apply({
      x,
      y,
      width: west ? right - x : o.width + d.width,
      height: north ? bottom - y : o.height + d.height,
    });
  };

  const onPointerUp = (): void => {
    drag = null;
  };

  frame.addEventListener('pointerdown', onPointerDown);
  // move 與 up 掛在 document：手指滑出框外時仍要跟得上，
  // 放開的位置也常常不在框裡（尤其是把框拖到邊緣時）。
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);

  return {
    element: wrap,
    getCrop: () => crop,
    reset: (nextSize, imageUrl) => {
      size = nextSize;
      img.src = imageUrl;
      // 用 defaultCrop 而不是把「整張都要」丟給 clampCrop 修正：
      // 後者只夾尺寸不管位置，9:16 的照片會得到一個貼在頂端的框而不是置中的框。
      apply(defaultCrop(nextSize));
    },
    dispose: () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
    },
  };
}
