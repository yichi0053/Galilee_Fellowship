/**
 * Polaroid 卡片的行為測試。
 *
 * §15.2：UI 只驗「畫得出來、關鍵規則沒漏掉」。這個元件的關鍵規則是
 * 縮圖的淡入——樣式讓 .polaroid__img 從 opacity: 0 開始，所以任何一條
 * 沒把 data-loaded 掛上的路徑，畫面上都會是一塊永遠的灰底。
 */
import { describe, expect, it } from 'vitest';
import type { Post, PostId } from '@modules/posts';
import { polaroidCard } from './polaroid';

function makePost(over: Partial<Post> = {}): Post {
  return {
    id: 'p-1' as PostId,
    kind: 'free',
    title: '測試標題',
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
  const card = polaroidCard(makePost());
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
    const card = polaroidCard(makePost({ rotationDeg: -3 }));
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

describe('polaroid 卡片上的文字（ADR-0019）', () => {
  it('顯示標題而不是內文——內文在 /post/:id', () => {
    const card = polaroidCard(
      { ...makePost(), title: '今天的晚餐', body: '跟小組一起吃的，很久沒這麼熱鬧。' },
    );
    expect(card.querySelector('.polaroid__title')?.textContent).toBe('今天的晚餐');
    expect(card.textContent).not.toContain('很久沒這麼熱鬧');
  });

  it('alt 用標題：讀螢幕軟體在牆上逐張唸 300 字內文會讓人放棄', () => {
    const card = polaroidCard({ ...makePost(), title: '今天的晚餐' });
    expect(card.querySelector<HTMLImageElement>('.polaroid__img')?.alt).toBe('今天的晚餐');
  });

  it('沒有內文的貼文照樣畫得出來', () => {
    const card = polaroidCard({ ...makePost(), body: null });
    expect(card.querySelector('.polaroid__title')?.textContent).toBe('測試標題');
  });
});

describe('polaroid 是連結而不是按鈕', () => {
  it('卡片本身就連往 /post/:id，不經過中間的放大檢視層', () => {
    const card = polaroidCard(makePost({ id: 'abc123' as PostId }));
    expect(card.tagName).toBe('A');
    expect(card.getAttribute('href')).toBe('/post/abc123');
  });

  it('用連結而非按鈕，長按開新分頁與複製網址才會有作用', () => {
    const card = polaroidCard(makePost());
    // <button> 沒有 href，這一條就是在守住「不要改回按鈕」。
    expect(card).toBeInstanceOf(HTMLAnchorElement);
  });
});
