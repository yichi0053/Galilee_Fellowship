/**
 * media — 葉節點，純函式，無 DB 依賴（架構書 §12.2）。
 *
 * 職責：瀏覽器端的圖片處理。壓縮、剝除 EXIF（含 GPS）、產生縮圖。規格見 §9.3。
 *
 * EXIF 是怎麼被剝掉的：把圖片畫進 canvas 之後再 toBlob，
 * 產出的是重新編碼的像素資料，原始檔的中繼資料一概不隨行——
 * 包含 GPS 座標、機型、拍攝時間。沒有另外呼叫「移除 EXIF」的步驟，
 * 因為那一步就是繪製本身。
 *
 * 但方向資訊要在丟棄前先用掉：createImageBitmap 的 imageOrientation: 'from-image'
 * 會依 EXIF Orientation 轉正。少了它，iPhone 直拍的照片會整片躺著上牆，
 * 而且因為 EXIF 已被剝除，事後無從補救。
 */

import { IMAGE } from '@config/constants';
import { fitLongEdge } from './geometry';
import type { Size } from './geometry';

/** 處理完成的圖片，尚未上傳 */
export type ProcessedImage = {
  readonly main: Blob;
  readonly thumb: Blob;
  readonly width: number;
  readonly height: number;
};

export class ImageTooLargeError extends Error {
  constructor(bytes: number) {
    const mb = (bytes / 1024 / 1024).toFixed(1);
    super(`圖片 ${mb} MB，超過 ${IMAGE.maxOriginalBytes / 1024 / 1024} MB 上限。`);
  }
}

export class UnsupportedImageFormatError extends Error {
  constructor(type: string) {
    super(
      /hei[cf]/i.test(type)
        ? '這個瀏覽器無法讀取 HEIC 照片。請到 iPhone 的「設定 → 相機 → 格式」選「最相容」後重拍，' +
          '或先用內建的照片編輯功能存成 JPEG。'
        : `不支援的圖片格式：${type || '未知'}。請改用 JPEG、PNG 或 WebP。`,
    );
  }
}

function isProbablyImage(file: File): boolean {
  return file.type.startsWith('image/') || file.type === '';
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    // 'from-image' 讓瀏覽器依 EXIF Orientation 轉正。這一步必須在剝除 EXIF 之前。
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // 解碼失敗最常見的原因就是 HEIC：iOS 相簿多半會在選檔時自動轉成 JPEG，
    // 但使用者若是從檔案 App 挑原始檔，Android 與桌機 Chrome 都讀不了。
    //
    // 這裡刻意不引入 heic2any 之類的 wasm 解碼器：那會讓 bundle 多出約 1 MB，
    // 而 §9.4 的 egress 是本專案比 storage 更早觸頂的限制。
    // 改為給出可照做的指示（見 UnsupportedImageFormatError）。
    throw new UnsupportedImageFormatError(file.type);
  }
}

async function render(bitmap: ImageBitmap, size: Size, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法取得 canvas 繪圖環境');

  // 縮小倍率大時，瀏覽器預設的取樣會有鋸齒，對縮圖尤其明顯。
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });
  if (!blob) throw new Error('圖片編碼失敗');
  return blob;
}

/**
 * 將使用者選取的檔案處理為可上傳的主圖與縮圖。
 *
 * 呼叫端不需要知道 EXIF、canvas、或壓縮參數的存在，只要交出一個 File。
 */
export async function processImage(file: File): Promise<ProcessedImage> {
  if (file.size > IMAGE.maxOriginalBytes) throw new ImageTooLargeError(file.size);
  if (!isProbablyImage(file)) throw new UnsupportedImageFormatError(file.type);

  const bitmap = await decode(file);
  try {
    const source: Size = { width: bitmap.width, height: bitmap.height };
    const mainSize = fitLongEdge(source, IMAGE.mainLongEdgePx);
    const thumbSize = fitLongEdge(source, IMAGE.thumbLongEdgePx);

    const [main, thumb] = await Promise.all([
      render(bitmap, mainSize, IMAGE.mainJpegQuality),
      render(bitmap, thumbSize, IMAGE.thumbJpegQuality),
    ]);

    return { main, thumb, width: mainSize.width, height: mainSize.height };
  } finally {
    // 不釋放的話，連續發文幾次就會在手機上吃掉大量記憶體
    bitmap.close();
  }
}

/** 供發文表單即時預覽用。呼叫端須自行 revokeObjectURL */
export function previewUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}
