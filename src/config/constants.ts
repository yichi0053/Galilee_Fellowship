/**
 * 架構書中以數字寫死的業務規則。集中於此，避免同一個常數散落多處。
 * 這些值改動時通常伴隨 ADR 更新，不要隨手改。
 */

/** §9.1 / ADR-0015：每人每週配額 */
export const QUOTA = {
  theme: 1,
  free: 2,
} as const;

/**
 * §9.5 / ADR-0021：自行刪除的時限，20 分鐘。
 *
 * 期限內刪除等同撤回：貼文消失，配額退還。**逾期就刪不掉了**，
 * 只能請管理員下架。原本是「逾期仍可刪，只是不回補」，
 * 那讓使用者要同時理解刪除與配額兩個概念，而後者在畫面上只是一行小字。
 *
 * **此值在 migration 012 的 soft_delete_post 另有一份。**
 * 伺服器那份才是把關——前端這份只用來畫倒數，改本機時鐘就能騙過。
 * 改動時務必同時改，兩邊不一致的失敗模式是「畫面說還有時間，按下去卻被拒絕」。
 */
export const DELETE_WINDOW_MINUTES = 20;

/**
 * §9.2 / ADR-0019：貼文文字長度。
 *
 * 標題是牆頁卡片上唯一的文字，內文只在 /post/:id 出現。
 * 20 字的上限來自版面而非資料：手機兩欄的卡片寬約 170 px，
 * 0.86rem 的字一行約容得下 12 至 14 個中文字，20 字代表最多換行一次，
 * 卡片高度因此只由照片比例決定。改大這個數字之前先想清楚牆會變成什麼樣子。
 *
 * **這兩組數字在 migration 011 另有一份 check 約束。** 伺服器那份才是把關，
 * 這裡只用來讓輸入框先擋下來並顯示字數，改動時務必同時改。
 */
export const TITLE_MIN_LENGTH = 2;
export const TITLE_MAX_LENGTH = 20;

/** 內文選填（ADR-0019）：沒有內文時存 null，不是空字串 */
export const BODY_MAX_LENGTH = 300;

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
