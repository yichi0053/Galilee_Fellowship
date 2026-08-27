/**
 * 貼文頁的照片放大檢視（架構書 §10.5）。
 *
 * 與先前那個從牆頁點開的 lightbox 不同，也不該混為一談：那一層是牆與貼文頁
 * **之間**的中間站，帶著上一則／下一則的瀏覽功能，已於 ADR-0020 一併移除
 * （牆上的卡片現在直接連往 /post/:id）。這裡是單張照片的放大，
 * 已經在貼文頁上了，沒有「下一則」可去。
 *
 * 用的是詳細頁本來就載入的主圖網址，不會多下載任何東西（§9.4 的 egress）。
 */

export type PhotoZoom = {
  readonly element: HTMLDialogElement;
  open: (src: string, alt: string) => void;
  close: () => void;
};

export function createPhotoZoom(): PhotoZoom {
  const dialog = document.createElement('dialog');
  dialog.className = 'zoom';

  const img = document.createElement('img');
  img.className = 'zoom__img';
  img.decoding = 'async';
  dialog.append(img);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'zoom__close';
  close.textContent = '✕';
  close.setAttribute('aria-label', '關閉');
  dialog.append(close);

  const doClose = (): void => {
    if (dialog.open) dialog.close();
  };

  close.addEventListener('click', doClose);
  // 點照片以外的地方關閉。照片本身不關——放大之後想細看的人會下意識點在圖上。
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) doClose();
  });
  // Esc 由 <dialog> 內建處理，不必自己監聽。

  return {
    element: dialog,
    open: (src, alt) => {
      img.src = src;
      img.alt = alt;
      // showModal 才會有 ::backdrop 與焦點鎖定；show() 沒有。
      dialog.showModal();
    },
    close: doClose,
  };
}
