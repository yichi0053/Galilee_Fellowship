/**
 * Polaroid 卡片的行為測試。
 *
 * §15.2：UI 只驗「畫得出來、關鍵規則沒漏掉」。這個元件的關鍵規則是
 * 縮圖的淡入——樣式讓 .polaroid__img 從 opacity: 0 開始，所以任何一條
 * 沒把 data-loaded 掛上的路徑，畫面上都會是一塊永遠的灰底。
 */
import { describe, expect, it, vi } from 'vitest';
import type { Post, PostId } from '@modules/posts';
import { polaroidCard } from './polaroid';

function makePost(over: Partial<Post> = {}): Post {
  return {
    id: 'p-1' as PostId,
    kind: 'free',
    body: '測試貼文，長度要過得了十個字的下限。',
    imageUrl: 'https://example.test/i.jpg',
    thumbUrl: 'https://example.test/t.jpg',
    rotationDeg: 2,
    week: '2026-08-24' as Post['week'],
    authorName: '陳小明',
    authorId: 'm-1',
    createdAt: new Date('2026-08-25T10:00:00Z'),
    refundableUntil: null,
    hiddenByAdmin: false,
    ...over,
  };
}

function cardWithImage(): { card: HTMLElement; img: HTMLImageElement } {
  const card = polaroidCard(makePost(), { onOpen: vi.fn() });
  const img = card.querySelector<HTMLImageElement>('.polaroid__img');
  if (!img) throw new Error('卡片裡沒有縮圖');
  return { card, img };
}

describe('polaroid 縮圖淡入', () => {
  it('載入完成後掛上 data-loaded', () => {
    const { img } = cardWithImage();
    expect(img.dataset['loaded']).toBeUndefined();
    img.dispatchEvent(new Event('load'));
    expect(img.dataset['loaded']).toBe('true');
  });

  it('載入失敗也要掛，否則壞掉的圖連 alt 都看不到', () => {
    const { img } = cardWithImage();
    img.dispatchEvent(new Event('error'));
    expect(img.dataset['loaded']).toBe('true');
  });

  it('lazy 與 async 沒有被改掉（§9.4：egress 比 storage 更早觸頂）', () => {
    const { img } = cardWithImage();
    expect(img.loading).toBe('lazy');
    expect(img.decoding).toBe('async');
  });
});

describe('polaroid 旋轉角', () => {
  it('來自 posts.rotation_deg 而非每次重擲（§11.2）', () => {
    const card = polaroidCard(makePost({ rotationDeg: -3 }), { onOpen: vi.fn() });
    expect(card.style.getPropertyValue('--rot')).toBe('-3deg');
  });
});

describe('polaroid 顯示框長寬比', () => {
  function loadWith(w: number, h: number): HTMLElement {
    const { card, img } = cardWithImage();
    Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
    img.dispatchEvent(new Event('load'));
    return card;
  }

  it('載入前沒有 --ratio，由 CSS 的 fallback 撐出方框', () => {
    const { card } = cardWithImage();
    expect(card.style.getPropertyValue('--ratio')).toBe('');
  });

  it('直式手機照 3:4 完整顯示，不被裁成正方形', () => {
    // 這正是 --ratio 從未被賦值時的失敗模式：上下各切掉一截。
    expect(loadWith(188, 250).style.getPropertyValue('--ratio')).toBe('0.752');
  });

  it('橫式 4:3 同樣完整顯示', () => {
    expect(loadWith(250, 188).style.getPropertyValue('--ratio')).toBe('1.3297872340425532');
  });

  it('9:16 截圖被夾住，不讓單張卡片獨佔整欄', () => {
    expect(loadWith(90, 160).style.getPropertyValue('--ratio')).toBe('0.62');
  });

  it('全景照被夾住，不讓卡片變成看不出內容的細縫', () => {
    expect(loadWith(300, 100).style.getPropertyValue('--ratio')).toBe('1.5');
  });

  it('載入失敗（naturalWidth 為 0）維持方框，不做出 0 高度的卡片', () => {
    const { card, img } = cardWithImage();
    Object.defineProperty(img, 'naturalWidth', { value: 0, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 0, configurable: true });
    img.dispatchEvent(new Event('error'));
    expect(card.style.getPropertyValue('--ratio')).toBe('');
    expect(img.dataset['loaded']).toBe('true');
  });
});
