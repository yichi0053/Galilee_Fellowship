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
  /** 顯示可刪除倒數（§9.5：不顯示的話使用者不會知道時間一過就刪不掉了） */
  deleteCountdown?: boolean;
};

function deleteLabel(msRemaining: number): string {
  const total = Math.ceil(msRemaining / 1000);
  const mm = Math.floor(total / 60);
  const ss = String(total % 60).padStart(2, '0');
  // 「回補配額」是內部詞彙，使用者不需要認識它（ADR-0021）。
  // 倒數留著：時間一過就真的刪不掉了，這比以前更需要被看見。
  return `還可刪除 ${mm}:${ss}`;
}

/**
 * 卡片顯示框的長寬比上下限。
 *
 * 直式手機照是 3:4（0.75），橫式是 4:3（1.33），兩者都落在區間內、完全不裁切。
 * 夾住兩端是為了極端比例：9:16 的截圖（0.5625）不夾的話會做出一張比鄰居高一倍的
 * 卡片、獨佔整個欄位；全景照（3:1）則會變成一條看不出內容的細縫。
 * 超出區間才裁切，而且只裁超出的部分。
 */
const RATIO_MIN = 0.62;
const RATIO_MAX = 1.5;

/**
 * 以縮圖的實際尺寸決定顯示框的長寬比。
 *
 * **為什麼要在瀏覽器端反推**：processImage() 算得出寬高（media/index.ts），
 * 但 posts 沒有存這兩個欄位，Post 型別也不帶。少了它，wall.css 的
 * `aspect-ratio: var(--ratio, 1)` 永遠吃 fallback 值 1，於是每張照片都被
 * object-fit: cover 硬裁成正方形——直式照上下各被切掉一截。
 *
 * 代價是縮圖載入的那一刻卡片高度會變一次。要根除得加 migration 把寬高存進
 * posts、讓伺服器一開始就給出比例；在那之前，會動一下的正確比例
 * 比永遠正方形的錯誤比例好。
 */
function applyRatio(img: HTMLImageElement, card: HTMLElement): void {
  const { naturalWidth: w, naturalHeight: h } = img;
  if (w <= 0 || h <= 0) return; // 載入失敗時維持 fallback 的正方形
  const ratio = Math.min(RATIO_MAX, Math.max(RATIO_MIN, w / h));
  card.style.setProperty('--ratio', String(ratio));
}

export function polaroidCard(post: Post, options: PolaroidOptions = {}): HTMLElement {
  // **是 <a> 而不是 <button>。** 點卡片就是換頁到 /post/:id，那是導覽而非動作：
  // 用連結才有長按開新分頁、中鍵、複製網址這些瀏覽器內建行為，
  // 也不需要 JS 就能運作。先前那一層放大檢視的 lightbox 已經移除。
  const card = document.createElement('a');
  card.href = `/post/${post.id}`;
  card.className = 'polaroid';

  // §9.5：被管理員下架的貼文。走到這裡的一定是作者自己的——其他人的已在
  // posts 模組濾掉——但它必須一眼看得出不是正常狀態，否則作者會以為下架沒生效。
  //
  // 標示放在元件內而不是各呼叫端：牆頁與「我的貼文」都會顯示下架的貼文，
  // 先前兩邊各有一份相同的四行，而牆頁那一份漏掉了整整一天沒有人發現。
  if (post.hiddenByAdmin) {
    card.dataset['hidden'] = 'true';
    card.title = '這則已被管理員下架，只有你看得到。';
  }
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
  // alt 用標題而非內文：內文是選填的，而且可能有 300 字——
  // 讀螢幕軟體在牆上逐張唸完那些會讓人放棄。想讀完整內容有 /post/:id。
  img.alt = post.title;
  // §9.4：只載入 viewport 內的縮圖。egress 比 storage 更早觸頂。
  img.loading = 'lazy';
  img.decoding = 'async';

  // 縮圖載到才淡進來（樣式在 wall.css 的 .polaroid__img）。
  // error 也要掛 data-loaded：否則載入失敗的圖停在 opacity: 0，
  // 連 alt 文字都看不到，畫面上只剩一塊灰底，看不出是壞了還是還沒載。
  // complete 的分支涵蓋已在快取中的圖——那種情況 load 事件不會再觸發。
  if (img.complete) {
    applyRatio(img, card);
    img.dataset['loaded'] = 'true';
  } else {
    const done = (): void => {
      applyRatio(img, card);
      img.dataset['loaded'] = 'true';
    };
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  }

  frame.append(pin, img);

  // ADR-0019：卡片上只有標題。內文在 /post/:id，點卡片就過去。
  const title = document.createElement('p');
  title.className = 'polaroid__title';
  title.textContent = post.title;

  const meta = document.createElement('div');
  meta.className = 'polaroid__meta';
  const author = document.createElement('span');
  author.textContent = post.authorName;
  const when = document.createElement('time');
  when.dateTime = post.createdAt.toISOString();
  when.textContent = timeFormat.format(post.createdAt);
  meta.append(author, when);

  card.append(frame, title, meta);

  if (options.deleteCountdown && post.deletableUntil) {
    const hint = document.createElement('div');
    hint.className = 'polaroid__deletable';
    card.append(hint);

    const deadline = post.deletableUntil.getTime();
    const tick = (): void => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        hint.remove();
        window.clearInterval(timer);
        return;
      }
      hint.textContent = deleteLabel(remaining);
    };
    const timer = window.setInterval(tick, 1000);
    tick();

    // 卡片被移除時一併停掉計時器，否則換週次幾次之後會累積一堆 interval
    card.addEventListener('polaroid:dispose', () => window.clearInterval(timer));
  }

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
