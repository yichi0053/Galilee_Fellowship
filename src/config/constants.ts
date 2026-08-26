/**
 * 架構書中以數字寫死的業務規則。集中於此，避免同一個常數散落多處。
 * 這些值改動時通常伴隨 ADR 更新，不要隨手改。
 */

/** §9.1 / ADR-0015：每人每週配額 */
export const QUOTA = {
  theme: 1,
  free: 2,
} as const;

/** §9.1 / ADR-0010：回補期 10 分鐘 */
export const REFUND_WINDOW_MINUTES = 10;

/** §9.2：貼文文字長度 */
export const BODY_MIN_LENGTH = 10;
export const BODY_MAX_LENGTH = 100;

/** §9.3：圖片處理規格 */
export const IMAGE = {
  maxOriginalBytes: 10 * 1024 * 1024,
  mainLongEdgePx: 1600,
  mainJpegQuality: 0.8,
  thumbLongEdgePx: 250,
  thumbJpegQuality: 0.8,
} as const;

/** §11.2：polaroid 卡片旋轉角範圍（度） */
export const ROTATION_DEG_RANGE = { min: -3, max: 3 } as const;

/** §9.5 / ADR-0009：軟刪除後保留天數 */
export const SOFT_DELETE_RETENTION_DAYS = 30;

/** §8.2：房間碼最低長度 */
export const JOIN_CODE_MIN_LENGTH = 12;

/**
 * §10.4：加入時顯示姓名的長度上限。
 *
 * **此值在 supabase/functions/join-room/index.ts 另有一份（DISPLAY_NAME_MAX）。**
 * Edge Function 跑在 Deno、無法 import 本檔，兩邊只能各留一份。
 * 伺服器那份才是真正的把關；這一份只用來讓輸入框先擋下來，改動時務必同時改。
 */
export const DISPLAY_NAME_MAX_LENGTH = 20;

/** §7.3：週界時區 */
export const WEEK_BOUNDARY_TIMEZONE = 'Asia/Taipei';

/** Storage bucket 名稱 */
export const POST_IMAGES_BUCKET = 'post-images';

/**
 * §9.4：上傳圖片時送出的 Cache-Control max-age（秒）。
 *
 * Supabase Storage 的預設值是 3600（一小時），對本專案而言太短。
 * 檔名是 `<uid>/<post_uuid>.jpg`，內容永不變動——是不折不扣的 immutable asset，
 * 卻每小時就讓所有人重新下載一次整面牆。
 *
 * egress 是本專案比 storage 更早觸頂的限制。以 24 人 × 18 週的規模估算，
 * 預設值下每月約 8 至 12 GB（免費額度 5 GB + 5 GB cached）；
 * 設為一年後降到約 3 GB。改一個數字，差距是四倍。
 */
export const IMAGE_CACHE_SECONDS = 31536000;
