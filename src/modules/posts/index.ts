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
import {
  BODY_MAX_LENGTH,
  BODY_MIN_LENGTH,
  IMAGE_CACHE_SECONDS,
  POST_IMAGES_BUCKET,
  ROTATION_DEG_RANGE,
} from '@config/constants';
import { db, ROOM_ID } from '@db/client';
import { currentWeekStart, parseWeekStart } from '@domain/week';
import type { WeekStart } from '@domain/week';
import { processImage } from '@modules/media';
import { canPost, getQuotaFor, refundableUntil } from '@modules/quota';
import type { PostKind, QuotaState } from '@modules/quota';
import { getThemeForWeek } from '@modules/themes';

/**
 * 本模組的公開介面提到這兩個型別（NewPost.kind、getMyQuota 的回傳），
 * 故由此轉出。呼叫端不必為了寫一則貼文而同時認識 quota（§12.5）。
 */
export type { PostKind, QuotaState } from '@modules/quota';

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
  /**
   * 訪客一律為 null：posts_public 刻意不含 author_id（ADR-0006 只給訪客最小欄位）。
   * 非空即代表這是成員視角的資料。
   */
  readonly authorId: string | null;
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
/** 本週尚未設定主題時無法發主題貼文（§9.6：過期主題不可補發） */
export class NoThemeError extends Error {}

/**
 * 建立一則貼文。呼叫端只說「我要發這個」，不編排步驟。
 *
 * `asMemberId` 為呼叫端的 room_members.id（同 listWeek，§12.3 不允許相依於 membership）。
 */
export async function createPost(input: NewPost, asMemberId: string): Promise<Post> {
  const body = input.body.trim();
  if (body.length < BODY_MIN_LENGTH || body.length > BODY_MAX_LENGTH) {
    throw new BodyLengthError(
      `內文需 ${BODY_MIN_LENGTH} 至 ${BODY_MAX_LENGTH} 字，目前 ${body.length} 字。`,
    );
  }

  // §9.6：貼文一律歸屬於發布當下的週次，不接受指定。過期主題不可補發。
  const week = currentWeekStart();

  const { remaining } = await getQuotaFor(asMemberId, week);
  if (!canPost(input.kind, remaining)) {
    throw new QuotaExceededError(
      input.kind === 'theme' ? '本週的主題貼文已經用掉了。' : '本週的自由貼文已經用完了。',
    );
  }

  // DB 有 theme_post_has_theme 約束：主題貼文必須指向主題，自由貼文必須不指向。
  // 先在這裡擋下來，錯誤訊息才說得出人話，而不是一句 constraint violation。
  let themeId: string | null = null;
  if (input.kind === 'theme') {
    const theme = await getThemeForWeek(week);
    if (!theme) throw new NoThemeError('本週還沒有主題，只能發自由貼文。');
    themeId = theme.id;
  }

  // 壓縮、剝除 EXIF（含 GPS）、產生縮圖。呼叫端不需要知道這些存在。
  const processed = await processImage(input.file);

  const uid = await currentUserId();
  const postId = crypto.randomUUID();
  const imagePath = `${uid}/${postId}.jpg`;
  const thumbPath = `${uid}/${postId}_thumb.jpg`;

  await upload(imagePath, processed.main);
  await upload(thumbPath, processed.thumb);

  const { data, error } = await db
    .from('posts')
    .insert({
      id: postId,
      room_id: ROOM_ID,
      author_id: asMemberId,
      type: input.kind,
      theme_id: themeId,
      image_path: imagePath,
      thumb_path: thumbPath,
      body,
      rotation_deg: randomRotation(),
      week_start_date: week,
    })
    .select('id, type, body, image_path, thumb_path, rotation_deg, week_start_date, created_at')
    .single();

  if (error) {
    // 檔案先上傳、資料列後寫入，故寫入失敗會留下孤兒檔案。
    // 004 的清理函式只掃得到軟刪除的貼文，掃不到這種——只能在這裡自己收。
    await removeQuietly([imagePath, thumbPath]);
    throw new Error(`發布失敗：${error.message}`);
  }

  return toPost({
    id: data.id,
    type: data.type,
    body: data.body,
    imagePath: data.image_path,
    thumbPath: data.thumb_path,
    rotationDeg: data.rotation_deg,
    week: data.week_start_date,
    createdAt: data.created_at,
    authorName: '',                 // 呼叫端就是作者本人，姓名由 UI 自己的 Viewer 提供
    authorId: asMemberId,
    hiddenByAdmin: false,
    asMemberId,
  });
}

/**
 * Storage policy 要求路徑首層等於 auth.uid()（migration 003），
 * 而那是 auth user 的 id，不是 room_members.id。
 *
 * §12.3 不允許 posts 相依於 auth module，但 db 是允許的下層，故直接向它取。
 */
async function currentUserId(): Promise<string> {
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new Error('尚未登入，無法發布。');
  return data.user.id;
}

async function upload(path: string, blob: Blob): Promise<void> {
  const { error } = await db.storage.from(POST_IMAGES_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    // §9.4：路徑含 post uuid，內容永不變動，是 immutable asset。
    // 用 Storage 的預設 3600 秒會讓 egress 直接翻四倍，見 IMAGE_CACHE_SECONDS 的說明。
    cacheControl: String(IMAGE_CACHE_SECONDS),
    upsert: false,
  });
  if (error) throw new Error(`圖片上傳失敗：${error.message}`);
}

/** 收拾孤兒檔案。這是補償路徑，本身再失敗也不該蓋掉原始錯誤 */
async function removeQuietly(paths: readonly string[]): Promise<void> {
  try {
    await db.storage.from(POST_IMAGES_BUCKET).remove([...paths]);
  } catch {
    // 忽略：呼叫端要看到的是「發布失敗」的原因，不是清理失敗的原因。
  }
}

/** §11.2：旋轉角在發布時決定一次並存進資料庫，不可每次載入重擲 */
function randomRotation(): number {
  const { min, max } = ROTATION_DEG_RANGE;
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * 依週載入（§9.4：不做全牆無限捲動，egress 是比 storage 更早觸頂的限制）。
 *
 * `asMemberId` 為呼叫端的 room_members.id，訪客與非成員傳 null。
 * 本模組依 §12.3 不可相依於 membership，故身分由呼叫端傳入而非自行查詢——
 * 這也讓「成員看全名、訪客看遮蔽名」這個分岔在型別上是顯式的。
 */
export async function listWeek(
  week: WeekStart,
  asMemberId: string | null,
): Promise<ReadonlyArray<Post>> {
  return asMemberId === null ? listWeekAsGuest(week) : listWeekAsMember(week, asMemberId);
}

/**
 * 訪客路徑：只讀 posts_public。
 *
 * 該 view 已在資料庫端濾掉軟刪除、管理員下架、以及 suspended 成員的貼文（§4.3），
 * 姓名也已由 mask_name 遮蔽。**不可**改讀 posts —— 那會讓實名資料經 REST API 完整外洩。
 */
async function listWeekAsGuest(week: WeekStart): Promise<ReadonlyArray<Post>> {
  const { data, error } = await db
    .from('posts_public')
    .select('id, type, thumb_path, image_path, body, rotation_deg, week_start_date, created_at, display_name')
    .eq('room_id', ROOM_ID)
    .eq('week_start_date', week)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).flatMap((row) => {
    // posts_public 的欄位在產生的型別裡**全部是 nullable**：Postgres 的 view 不帶
    // NOT NULL 資訊，而底層 posts 的這些欄位都是 not null，實務上不會出現 null。
    //
    // 這裡不用 `!` 硬斷言，改為整列跳過。真的出現 null 時（例如日後有人改了 view），
    // 少一張卡片是可以接受的；整面牆因為一個 undefined 而炸掉不行。
    if (
      row.id === null ||
      row.type === null ||
      row.body === null ||
      row.image_path === null ||
      row.thumb_path === null ||
      row.rotation_deg === null ||
      row.week_start_date === null ||
      row.created_at === null ||
      row.display_name === null
    ) {
      return [];
    }

    return [
      toPost({
        id: row.id,
        type: row.type,
        body: row.body,
        imagePath: row.image_path,
        thumbPath: row.thumb_path,
        rotationDeg: row.rotation_deg,
        week: row.week_start_date,
        createdAt: row.created_at,
        authorName: row.display_name,
        authorId: null,
        hiddenByAdmin: false,
        asMemberId: null,
      }),
    ];
  });
}

/** 成員路徑：讀 posts 本表以取得未遮蔽姓名、自己的回補倒數與下架佔位 */
async function listWeekAsMember(
  week: WeekStart,
  asMemberId: string,
): Promise<ReadonlyArray<Post>> {
  const { data, error } = await db
    .from('posts')
    .select(
      'id, type, thumb_path, image_path, body, rotation_deg, week_start_date, created_at, author_id, hidden_by_admin, room_members!inner(display_name)',
    )
    .eq('room_id', ROOM_ID)
    .eq('week_start_date', week)
    // posts_select policy 只管「是不是本房間的成員」，不濾軟刪除，故此處必須自己濾。
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? [])
    // §9.5：管理員下架的貼文只有作者本人看得到佔位，其他成員完全看不到。
    .filter((row) => !row.hidden_by_admin || row.author_id === asMemberId)
    .map((row) =>
      toPost({
        id: row.id,
        type: row.type,
        body: row.body,
        imagePath: row.image_path,
        thumbPath: row.thumb_path,
        rotationDeg: row.rotation_deg,
        week: row.week_start_date,
        createdAt: row.created_at,
        authorName: row.room_members.display_name,
        authorId: row.author_id,
        hiddenByAdmin: row.hidden_by_admin,
        asMemberId,
      }),
    );
}

/** bucket 為 public（migration 003），故取得的是可被 CDN 快取的固定網址，不需簽章 */
function publicUrl(path: string): string {
  return db.storage.from(POST_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
}

type PostRow = {
  id: string;
  type: PostKind;
  body: string;
  imagePath: string;
  thumbPath: string;
  rotationDeg: number;
  week: string;
  createdAt: string;
  authorName: string;
  authorId: string | null;
  hiddenByAdmin: boolean;
  asMemberId: string | null;
};

function toPost(row: PostRow): Post {
  const createdAt = new Date(row.createdAt);

  // ADR-0010：回補期只對作者本人有意義，逾期即為 null，UI 不必自己判斷。
  // 期限的算式在 quota 只有一份，這裡不重寫。
  const isMine = row.authorId !== null && row.authorId === row.asMemberId;

  return {
    id: row.id as PostId,
    kind: row.type,
    body: row.body,
    imageUrl: publicUrl(row.imagePath),
    thumbUrl: publicUrl(row.thumbPath),
    rotationDeg: row.rotationDeg,
    week: parseWeekStart(row.week),
    authorName: row.authorName,
    authorId: row.authorId,
    createdAt,
    refundableUntil: isMine ? refundableUntil(createdAt) : null,
    hiddenByAdmin: row.hiddenByAdmin,
  };
}

export async function getPost(_id: PostId): Promise<Post | null> {
  throw new Error('T-04 未實作');
}

/** 編輯不影響配額（§9.5） */
export async function editPost(_id: PostId, _patch: PostPatch): Promise<Post> {
  throw new Error('T-08 未實作');
}

/**
 * 軟刪除。內部判定是否在回補期內，決定配額是否回補。
 *
 * 整件事交給 migration 007 的 soft_delete_post 做，前端不參與判斷：
 * 回補與否取決於「現在距離發布是否在 10 分鐘內」，若由瀏覽器決定，
 * 使用者把本機時鐘往回撥就能讓任何舊貼文都算在回補期內，
 * 於是刪了再發、無限繞過每週配額。作者身分同樣由該函式以 auth.uid() 反查。
 *
 * ****** 呼叫端完全不知道 counts_toward_quota 這個欄位存在。這就是「深」。******
 */
export async function deletePost(id: PostId): Promise<void> {
  const { error } = await db.rpc('soft_delete_post', { p_id: id });
  if (error) throw new Error(`刪除失敗：${error.message}`);
}

/** 轉呼 quota，讓 UI 不必同時認識兩個模組 */
export async function getMyQuota(asMemberId: string): Promise<QuotaState> {
  return getQuotaFor(asMemberId);
}
