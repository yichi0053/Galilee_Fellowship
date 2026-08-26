/**
 * Lightbox（架構書 §10.6、§11.3）。
 * 點卡片放大，可左右瀏覽同一週的貼文。
 */

import type { Post } from '@modules/posts';

const stampFormat = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  dateStyle: 'medium',
  timeStyle: 'short',
});

export type Lightbox = {
  open: (posts: readonly Post[], index: number) => void;
  close: () => void;
};

export function createLightbox(): Lightbox {
  const dialog = document.createElement('dialog');
  dialog.className = 'lightbox';

  const bar = document.createElement('div');
  bar.className = 'lightbox__bar';
  const counter = document.createElement('span');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'lightbox__close';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', '關閉');
  bar.append(counter, closeBtn);

  const stage = document.createElement('div');
  stage.className = 'lightbox__stage';
  const img = document.createElement('img');
  img.className = 'lightbox__img';
  stage.append(img);

  const caption = document.createElement('div');
  caption.className = 'lightbox__caption';

  const nav = document.createElement('div');
  nav.className = 'lightbox__nav';
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.textContent = '‹';
  prevBtn.setAttribute('aria-label', '上一則');
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.textContent = '›';
  nextBtn.setAttribute('aria-label', '下一則');
  nav.append(prevBtn, nextBtn);

  dialog.append(bar, stage, caption, nav);
  document.body.append(dialog);

  let items: readonly Post[] = [];
  let cursor = 0;

  function render(): void {
    const post = items[cursor];
    if (!post) return;

    // 縮圖已在牆上載入過，先擺著當佔位，主圖到位再換掉，
    // 避免點開後盯著一片空白（§9.4：主圖是按需載入，不隨牆頁一起下載）。
    img.src = post.thumbUrl;
    img.alt = post.body;
    const full = new Image();
    full.decoding = 'async';
    full.addEventListener('load', () => {
      if (items[cursor] === post) img.src = full.src;
    });
    full.src = post.imageUrl;

    caption.textContent = post.body;
    counter.textContent = `${post.authorName} · ${stampFormat.format(post.createdAt)}（${cursor + 1}/${items.length}）`;
    prevBtn.disabled = cursor === 0;
    nextBtn.disabled = cursor === items.length - 1;
  }

  function step(delta: number): void {
    const next = cursor + delta;
    if (next < 0 || next >= items.length) return;
    cursor = next;
    render();
  }

  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  closeBtn.addEventListener('click', () => dialog.close());

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });

  // 點畫面外圍關閉，但點在圖片或文字上不關
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target === stage) dialog.close();
  });

  // 手機左右滑動（§10.6）。門檻取 45 px，並要求水平位移明顯大於垂直，
  // 否則使用者想上下捲動時會誤觸換頁。
  let touchX = 0;
  let touchY = 0;
  stage.addEventListener(
    'touchstart',
    (e) => {
      const t = e.changedTouches[0];
      if (!t) return;
      touchX = t.clientX;
      touchY = t.clientY;
    },
    { passive: true },
  );
  stage.addEventListener(
    'touchend',
    (e) => {
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - touchX;
      const dy = t.clientY - touchY;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    },
    { passive: true },
  );

  return {
    open(posts, index) {
      items = posts;
      cursor = Math.min(Math.max(index, 0), posts.length - 1);
      render();
      dialog.showModal();
    },
    close() {
      dialog.close();
    },
  };
}
