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
