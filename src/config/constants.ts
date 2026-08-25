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

/** §7.3：週界時區 */
export const WEEK_BOUNDARY_TIMEZONE = 'Asia/Taipei';

/** Storage bucket 名稱 */
export const POST_IMAGES_BUCKET = 'post-images';
