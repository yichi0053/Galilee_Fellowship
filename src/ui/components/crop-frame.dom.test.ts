/**
 * 裁切框的手勢測試。
 *
 * §15.2：UI 只驗「畫得出來、關鍵規則沒漏掉」。這個元件的關鍵規則是
 * **框永遠合法**——留在圖內、比例在 0.62 至 1.5 之間。約束本身在
 * media/geometry.ts 已完整測過，這裡驗的是手勢有沒有真的接上那些約束。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createCropFrame } from './crop-frame';

const PORTRAIT = { width: 1200, height: 1600 }; // 3:4，比例在範圍內
const TALL = { width: 900, height: 1600 }; // 9:16，太長

function mount(size = PORTRAIT): ReturnType<typeof createCropFrame> {
  const frame = createCropFrame();
  document.body.append(frame.element);
  // happy-dom 沒有版面，getBoundingClientRect 一律回 0——
  // 位移的換算會因此除以 0，所以這裡給元素一個假的量測結果。
  frame.element.getBoundingClientRect = () =>
    ({ width: 300, height: 400, left: 0, top: 0 }) as DOMRect;
  frame.reset(size, 'blob:fake');
  return frame;
}

function pointer(type: string, x: number, y: number, target: EventTarget): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: x, clientY: y, pointerId: 1 });
  target.dispatchEvent(event);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('預設框', () => {
  it('比例在範圍內的照片預設整張都要', () => {
    expect(mount(PORTRAIT).getCrop()).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('9:16 太長的照片預設框置中，不是貼在頂端', () => {
    const crop = mount(TALL).getCrop();
    expect(crop.height).toBeLessThan(1);
    expect(crop.y).toBeGreaterThan(0);
    expect(crop.y).toBeCloseTo((1 - crop.height) / 2, 5);
  });

  it('換一張照片會重設成新尺寸的預設框', () => {
    const frame = mount(PORTRAIT);
    frame.reset(TALL, 'blob:another');
    expect(frame.getCrop().height).toBeLessThan(1);
  });
});

describe('拖曳移動', () => {
  it('框拖不出圖外', () => {
    const frame = mount(TALL);
    const box = frame.element.querySelector<HTMLElement>('.crop__frame')!;
    pointer('pointerdown', 150, 200, box);
    // 往上拖遠超過圖的高度
    pointer('pointermove', 150, -9999, document);
    pointer('pointerup', 150, -9999, document);

    const crop = frame.getCrop();
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.y + crop.height).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('沒有按下就移動不會改變框', () => {
    const frame = mount(TALL);
    const before = frame.getCrop();
    pointer('pointermove', 999, 999, document);
    expect(frame.getCrop()).toEqual(before);
  });
});

describe('拉角落改變大小', () => {
  it('拉出來的框比例仍被夾在允許範圍內', () => {
    const frame = mount(PORTRAIT);
    const handle = frame.element.querySelector<HTMLElement>('.crop__handle--se')!;
    pointer('pointerdown', 300, 400, handle);
    // 往上拉到極端，試圖做出一個非常扁的框
    pointer('pointermove', 300, 10, document);
    pointer('pointerup', 300, 10, document);

    const crop = frame.getCrop();
    const ratio = (crop.width / crop.height) * (PORTRAIT.width / PORTRAIT.height);
    expect(ratio).toBeLessThanOrEqual(1.5 + 1e-9);
    expect(ratio).toBeGreaterThanOrEqual(0.62 - 1e-9);
  });

  it('框不會被拉到剩幾個像素', () => {
    const frame = mount(PORTRAIT);
    const handle = frame.element.querySelector<HTMLElement>('.crop__handle--se')!;
    pointer('pointerdown', 300, 400, handle);
    pointer('pointermove', 0, 0, document);
    pointer('pointerup', 0, 0, document);

    const crop = frame.getCrop();
    expect(crop.width).toBeGreaterThanOrEqual(0.2);
    expect(crop.height).toBeGreaterThanOrEqual(0.2);
  });
});

describe('dispose', () => {
  it('拆掉之後 document 上的移動不再影響框——換頁時要能收乾淨', () => {
    const frame = mount(TALL);
    const box = frame.element.querySelector<HTMLElement>('.crop__frame')!;
    pointer('pointerdown', 150, 200, box);
    frame.dispose();
    const before = frame.getCrop();
    pointer('pointermove', 150, 50, document);
    expect(frame.getCrop()).toEqual(before);
  });
});
