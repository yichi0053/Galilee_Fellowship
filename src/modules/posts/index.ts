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
  IMAGE_CACHE_SECONDS,
  POST_IMAGES_BUCKET,
  ROTATION_DEG_RANGE,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
} from '@config/constants';
import { db, ROOM_ID } from '@db/client';
import { currentWeekStart, parseWeekStart } from '@domain/week';
import type { WeekStart } from '@domain/week';
import { processImage } from '@modules/media';
import type { CropRect } from '@modules/media';
import { canPost, deletableUntil, getQuotaFor } from '@modules/quota';
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
  /** §9.2 / ADR-0019：牆頁卡片上唯一的文字，2 至 20 字，必填 */
  readonly title: string;
  /** ADR-0019：選填的內文，只在 /post/:id 顯示。沒有內文時為 null，不是空字串 */
  readonly body: string | null;
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
  /**
   * 作者本人可自行刪除的截止時刻；非作者或已逾期為 null（§9.5 / ADR-0021）。
   * 逾期即刪不掉了，不是「刪得掉但不回補」——期限內刪除等同撤回。
   */
  readonly deletableUntil: Date | null;
  /** 僅作者本人看得到的下架佔位狀態（§9.5） */
  readonly hiddenByAdmin: boolean;
};

export type NewPost = {
  readonly kind: PostKind;
  readonly title: string;
  /** 選填。空白會在此轉為 null（ADR-0019：兩種「沒有內文」的表示法不並存） */
  readonly body?: string;
  readonly file: File;
  /**
   * 縮圖的裁切範圍（ADR-0020）。省略即由 media 自行取預設框。
   * 只影響縮圖，主圖一律完整。
   */
  readonly crop?: CropRect;
};

export class QuotaExceededError extends Error {}
export class TitleLengthError extends Error {}
export class BodyLengthError extends Error {}
/** 本週尚未設定主題時無法發主題貼文（§9.6：過期主題不可補發） */
export class NoThemeError extends Error {}

/**
 * 建立一則貼文。呼叫端只說「我要發這個」，不編排步驟。
 *
 * `asMemberId` 為呼叫端的 room_members.id（同 listWeek，§12.3 不允許相依於 membership）。
 */
export async function createPost(input: NewPost, asMemberId: string): Promise<Post> {
  const title = input.title.trim();
  if (title.length < TITLE_MIN_LENGTH || title.length > TITLE_MAX_LENGTH) {
    throw new TitleLengthError(
      `標題需 ${TITLE_MIN_LENGTH} 至 ${TITLE_MAX_LENGTH} 字，目前 ${title.length} 字。`,
    );
  }

  // 選填：trim 之後為空就是 null。migration 011 的 check 只認 null 或 1 至 300 字，
  // 送空字串進去會被資料庫擋下來，而那個錯誤訊息使用者看不懂。
  const body = input.body?.trim() ?? '';
  if (body.length > BODY_MAX_LENGTH) {
    throw new BodyLengthError(`內文最多 ${BODY_MAX_LENGTH} 字，目前 ${body.length} 字。`);
  }
  const bodyOrNull = body.length === 0 ? null : body;

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
  const processed = await processImage(input.file, input.crop);

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
      title,
      body: bodyOrNull,
      rotation_deg: randomRotation(),
      week_start_date: week,
    })
    .select('id, type, title, body, image_path, thumb_path, rotation_deg, week_start_date, created_at')
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
    title: data.title,
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
    .select('id, type, thumb_path, image_path, title, body, rotation_deg, week_start_date, created_at, display_name')
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
      // body 不在這裡：ADR-0019 起內文是選填的，null 是正常值。
      // 把它列進來的話，沒寫內文的貼文會從訪客的牆上整個消失。
      row.title === null ||
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
        title: row.title,
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

/** 成員路徑：讀 posts 本表以取得未遮蔽姓名、自己的可刪除倒數與下架佔位 */
async function listWeekAsMember(
  week: WeekStart,
  asMemberId: string,
): Promise<ReadonlyArray<Post>> {
  const { data, error } = await db
    .from('posts')
    .select(MEMBER_SELECT)
    .eq('room_id', ROOM_ID)
    .eq('week_start_date', week)
    // posts_select policy 只管「是不是本房間的成員」，不濾軟刪除，故此處必須自己濾。
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? [])
    // §9.5：管理員下架的貼文只有作者本人看得到佔位，其他成員完全看不到。
    .filter((row) => !row.hidden_by_admin || row.author_id === asMemberId)
    .map((row) => fromMemberRow(row, asMemberId));
}

/** 有貼文的週次與各自的則數，新的在前。牆頁用它畫週次選擇器 */
export type WeekSummary = { readonly week: WeekStart; readonly count: number };

/**
 * 哪些週有貼文、各有幾則（§10.6）。
 *
 * 只取 week_start_date 一個欄位，1296 則上限下約 40 KB，
 * 與圖片相比可以忽略；換到的是週次列上「這週有幾則」的提示。
 * 可見性規則與 listWeek 一致，否則選擇器會顯示一個點進去卻是空的週次。
 */
export async function listWeeks(asMemberId: string | null): Promise<readonly WeekSummary[]> {
  const counts = new Map<string, number>();

  if (asMemberId === null) {
    const { data, error } = await db
      .from('posts_public')
      .select('week_start_date')
      .eq('room_id', ROOM_ID);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.week_start_date === null) continue;
      counts.set(row.week_start_date, (counts.get(row.week_start_date) ?? 0) + 1);
    }
  } else {
    const { data, error } = await db
      .from('posts')
      .select('week_start_date, author_id, hidden_by_admin')
      .eq('room_id', ROOM_ID)
      .is('deleted_at', null);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.hidden_by_admin && row.author_id !== asMemberId) continue;
      counts.set(row.week_start_date, (counts.get(row.week_start_date) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([week, count]) => ({ week: parseWeekStart(week), count }))
    .sort((a, b) => (a.week < b.week ? 1 : -1));
}

/**
 * 自己所有的貼文，不分週次，新的在前（§10.7 的「我的貼文」）。
 *
 * 含被管理員下架的那些：作者本人看得到佔位，也才有機會知道發生了什麼事（§9.5）。
 * 不含已刪除的——那些在 posts 表裡還在，但對作者而言已經是刪掉了。
 */
export async function listMine(asMemberId: string): Promise<ReadonlyArray<Post>> {
  const { data, error } = await db
    .from('posts')
    .select(MEMBER_SELECT)
    .eq('room_id', ROOM_ID)
    .eq('author_id', asMemberId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => fromMemberRow(row, asMemberId));
}

/**
 * 成員視角的欄位。三個查詢（依週、單則、我的貼文）共用同一份，
 * 少一處漏掉 room_members 的 join 就會少掉未遮蔽的姓名。
 */
const MEMBER_SELECT =
  'id, type, thumb_path, image_path, title, body, rotation_deg, week_start_date, created_at, author_id, hidden_by_admin, room_members!inner(display_name)';

type MemberRow = {
  id: string;
  type: PostKind;
  title: string;
  body: string | null;
  image_path: string;
  thumb_path: string;
  rotation_deg: number;
  week_start_date: string;
  created_at: string;
  author_id: string;
  hidden_by_admin: boolean;
  room_members: { display_name: string };
};

function fromMemberRow(row: MemberRow, asMemberId: string): Post {
  return toPost({
    id: row.id,
    type: row.type,
    title: row.title,
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
  });
}

/** bucket 為 public（migration 003），故取得的是可被 CDN 快取的固定網址，不需簽章 */
function publicUrl(path: string): string {
  return db.storage.from(POST_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
}

type PostRow = {
  id: string;
  type: PostKind;
  title: string;
  body: string | null;
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

  // ADR-0021：可刪除期限只對作者本人有意義，逾期即為 null，UI 不必自己判斷。
  // 期限的算式在 quota 只有一份，這裡不重寫。
  const isMine = row.authorId !== null && row.authorId === row.asMemberId;

  return {
    id: row.id as PostId,
    kind: row.type,
    title: row.title,
    body: row.body,
    imageUrl: publicUrl(row.imagePath),
    thumbUrl: publicUrl(row.thumbPath),
    rotationDeg: row.rotationDeg,
    week: parseWeekStart(row.week),
    authorName: row.authorName,
    authorId: row.authorId,
    createdAt,
    deletableUntil: isMine ? deletableUntil(createdAt) : null,
    hiddenByAdmin: row.hiddenByAdmin,
  };
}

/**
 * 單則貼文。找不到、已軟刪除、或被下架且看的人不是作者，一律回 null。
 *
 * 身分同 listWeek 由呼叫端傳入：訪客讀 posts_public（遮蔽姓名），
 * 成員讀 posts 本表（未遮蔽姓名、自己的可刪除倒數）。
 */
export async function getPost(id: PostId, asMemberId: string | null): Promise<Post | null> {
  if (asMemberId === null) {
    const { data, error } = await db
      .from('posts_public')
      .select(
        'id, type, thumb_path, image_path, title, body, rotation_deg, week_start_date, created_at, display_name',
      )
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (
      !data ||
      data.id === null ||
      data.type === null ||
      // 同上：body 為 null 是「沒有內文」，不是壞資料。
      data.title === null ||
      data.image_path === null ||
      data.thumb_path === null ||
      data.rotation_deg === null ||
      data.week_start_date === null ||
      data.created_at === null ||
      data.display_name === null
    ) {
      return null;
    }

    return toPost({
      id: data.id,
      type: data.type,
      title: data.title,
      body: data.body,
      imagePath: data.image_path,
      thumbPath: data.thumb_path,
      rotationDeg: data.rotation_deg,
      week: data.week_start_date,
      createdAt: data.created_at,
      authorName: data.display_name,
      authorId: null,
      hiddenByAdmin: false,
      asMemberId: null,
    });
  }

  const { data, error } = await db
    .from('posts')
    .select(MEMBER_SELECT)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  // §9.5：下架的貼文只有作者本人看得到佔位，其他成員視同不存在。
  if (data.hidden_by_admin && data.author_id !== asMemberId) return null;

  return fromMemberRow(data, asMemberId);
}

/**
 * **編輯貼文（§9.5）第一期不做。**
 *
 * 這裡原本留著一支 `editPost()` 空殼，本體是 `throw new Error('T-08 未實作')`，
 * 而全案沒有任何呼叫端。留著空殼比拿掉更危險：型別看起來是齊的，
 * 日後有人接上 UI 才會在使用者面前炸開。
 *
 * 真要做的話不只是一個 update：改圖要重新上傳與清掉舊檔、
 * 且 migration 010 已收回 `posts` 的欄位層級 UPDATE 權限，
 * 得再開一支 migration 才動得了 `body`。現階段的替代路徑是刪掉重發——
 * 20 分鐘內可以刪掉重發（ADR-0021），剛好覆蓋「貼完才發現打錯字」這個情境。
 */

/**
 * 軟刪除。逾期會被伺服器拒絕（ADR-0021），期限內則一律退還配額。
 *
 * 整件事交給 migration 007 的 soft_delete_post 做，前端不參與判斷：
 * 刪不刪得掉取決於「現在距離發布是否在 20 分鐘內」，若由瀏覽器決定，
 * 使用者把本機時鐘往回撥就能刪掉任何一則舊貼文，
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
