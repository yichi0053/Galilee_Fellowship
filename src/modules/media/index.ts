/**
 * media — 葉節點，純函式，無 DB 依賴（架構書 §12.2）。
 *
 * 職責：瀏覽器端的圖片處理。壓縮、剝除 EXIF（含 GPS）、產生縮圖。
 * 規格見 §9.3。實作於 T-05。
 */

/** 處理完成的圖片，尚未上傳 */
export type ProcessedImage = {
  readonly main: Blob;
  readonly thumb: Blob;
  readonly width: number;
  readonly height: number;
};

export class ImageTooLargeError extends Error {}
export class UnsupportedImageFormatError extends Error {}

/**
 * 將使用者選取的檔案處理為可上傳的主圖與縮圖。
 *
 * 內部依序完成：格式檢查、HEIC 轉檔、10 MB 上限檢查、
 * 以 canvas 重繪（此步驟同時剝除 EXIF）、縮放至長邊 1600 與 250。
 *
 * 呼叫端不需要知道 EXIF 或 canvas 的存在。
 */
export async function processImage(_file: File): Promise<ProcessedImage> {
  throw new Error('T-05 未實作');
}
