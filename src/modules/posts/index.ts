/**
 * posts — 深模組（架構書 §12.5）。
 *
 * 相依：quota、media、themes。
 *
 * 本模組的介面刻意保持窄：UI 只說「建立一則貼文」，不編排步驟。
 * createPost 內部依序完成：配額檢查 → 壓縮與剝除 EXIF → 產生縮圖 → 上傳 Storage
 * → 決定 rotation_deg → 計算 week_start_date → 寫入 posts 表。
 *
 * ****** UI 完全不知道 counts_toward_quota 這個欄位存在。這就是「深」。******
 */
import type { WeekStart } from '@domain/week';
import type { PostKind, QuotaState } from '@modules/quota';

export type PostId = string & { readonly __brand: 'PostId' };

/** 跨出本模組的 domain type。DB row 型別不得外洩（§12.4 規則 3） */
export type Post = {
  readonly id: PostId;
  readonly kind: PostKind;
  readonly body: string;
  readonly imageUrl: string;
  readonly thumbUrl: string;
  readonly rotationDeg: number;
  readonly week: WeekStart;
  readonly authorName: string;
  readonly authorId: string;
  readonly createdAt: Date;
  /** 作者本人可刪除並回補配額的截止時刻；非作者或已逾期為 null（§9.1 的 10 分鐘倒數） */
  readonly refundableUntil: Date | null;
  /** 僅作者本人看得到的下架佔位狀態（§9.5） */
  readonly hiddenByAdmin: boolean;
};

export type NewPost = {
  readonly kind: PostKind;
  readonly body: string;
  readonly file: File;
};

export type PostPatch = {
  readonly body?: string;
  readonly file?: File;
};

export class QuotaExceededError extends Error {}
export class BodyLengthError extends Error {}

export async function createPost(_input: NewPost): Promise<Post> {
  throw new Error('T-04 / T-06 未實作');
}

/** 依週載入（§9.4：不做全牆無限捲動，egress 是比 storage 更早觸頂的限制） */
export async function listWeek(_week: WeekStart): Promise<ReadonlyArray<Post>> {
  throw new Error('T-04 未實作');
}

export async function getPost(_id: PostId): Promise<Post | null> {
  throw new Error('T-04 未實作');
}

/** 編輯不影響配額（§9.5） */
export async function editPost(_id: PostId, _patch: PostPatch): Promise<Post> {
  throw new Error('T-08 未實作');
}

/** 軟刪除。內部判定是否在回補期內，決定配額是否回補 */
export async function deletePost(_id: PostId): Promise<void> {
  throw new Error('T-06 未實作');
}

/** 轉呼 quota，讓 UI 不必同時認識兩個模組 */
export async function getMyQuota(): Promise<QuotaState> {
  throw new Error('T-06 未實作');
}
