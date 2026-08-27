/**
 * Polaroid 卡片（架構書 §11.2）。
 *
 * 純呈現：吃 domain type，吐 DOM，不知道資料從哪來。
 */

import type { Post } from '@modules/posts';

const timeFormat = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export type PolaroidOptions = {
  onOpen: (post: Post) => void;
  /** 顯示 10 分鐘回補倒數（§9.1：不顯示的話使用者不會知道有這個規則） */
  refundCountdown?: boolean;
};

function refundLabel(msRemaining: number): string {
  const total = Math.ceil(msRemaining / 1000);
  const mm = Math.floor(total / 60);
  const ss = String(total % 60).padStart(2, '0');
  return `刪除可回補配額 ${mm}:${ss}`;
}

export function polaroidCard(post: Post, options: PolaroidOptions): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'polaroid';
  card.style.setProperty('--rot', `${post.rotationDeg}deg`);
  card.dataset['postId'] = post.id;

  const frame = document.createElement('div');
  frame.className = 'polaroid__frame';

  const pin = document.createElement('span');
  pin.className = 'polaroid__pin';
  pin.setAttribute('aria-hidden', 'true');

  const img = document.createElement('img');
  img.className = 'polaroid__img';
  img.src = post.thumbUrl;
  img.alt = post.body;
  // §9.4：只載入 viewport 內的縮圖。egress 比 storage 更早觸頂。
  img.loading = 'lazy';
  img.decoding = 'async';

  // 縮圖載到才淡進來（樣式在 wall.css 的 .polaroid__img）。
  // error 也要掛 data-loaded：否則載入失敗的圖停在 opacity: 0，
  // 連 alt 文字都看不到，畫面上只剩一塊灰底，看不出是壞了還是還沒載。
  // complete 的分支涵蓋已在快取中的圖——那種情況 load 事件不會再觸發。
  if (img.complete) {
    img.dataset['loaded'] = 'true';
  } else {
    const done = (): void => {
      img.dataset['loaded'] = 'true';
    };
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  }

  frame.append(pin, img);

  const body = document.createElement('p');
  body.className = 'polaroid__body';
  body.textContent = post.body;

  const meta = document.createElement('div');
  meta.className = 'polaroid__meta';
  const author = document.createElement('span');
  author.textContent = post.authorName;
  const when = document.createElement('time');
  when.dateTime = post.createdAt.toISOString();
  when.textContent = timeFormat.format(post.createdAt);
  meta.append(author, when);

  card.append(frame, body, meta);

  if (options.refundCountdown && post.refundableUntil) {
    const hint = document.createElement('div');
    hint.className = 'polaroid__refund';
    card.append(hint);

    const deadline = post.refundableUntil.getTime();
    const tick = (): void => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        hint.remove();
        window.clearInterval(timer);
        return;
      }
      hint.textContent = refundLabel(remaining);
    };
    const timer = window.setInterval(tick, 1000);
    tick();

    // 卡片被移除時一併停掉計時器，否則換週次幾次之後會累積一堆 interval
    card.addEventListener('polaroid:dispose', () => window.clearInterval(timer));
  }

  card.addEventListener('click', () => options.onOpen(post));
  return card;
}

/** 移除卡片前呼叫，讓倒數計時器有機會收尾 */
export function disposeCards(container: ParentNode): void {
  container.querySelectorAll('.polaroid').forEach((el) => {
    el.dispatchEvent(new CustomEvent('polaroid:dispose'));
  });
}

/**
 * 進場動畫（§11.3）。以 Intersection Observer 觸發，只播一次。
 * 回傳 disconnect 供頁面卸載時呼叫。
 */
export function observeEntrance(container: ParentNode): () => void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cards = Array.from(container.querySelectorAll<HTMLElement>('.polaroid'));

  if (reduced) {
    cards.forEach((c) => (c.dataset['entered'] = 'true'));
    return () => undefined;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      // 同一批進入視窗的卡片依序上來，比整排同時彈出自然。
      // 上限 8 張：第一次載入時整個視窗的卡片會在同一批進來，
      // 不設上限的話最後幾張要等將近一秒才出現，那不是動畫是延遲。
      let order = 0;
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target as HTMLElement;
        el.style.setProperty('--stagger', `${Math.min(order, 8) * 45}ms`);
        order += 1;
        el.dataset['entered'] = 'true';
        observer.unobserve(el);
      });
    },
    { rootMargin: '80px' },
  );

  cards.forEach((c) => observer.observe(c));
  return () => observer.disconnect();
}
