/**
 * profile — 葉節點（架構書 §12.2）。相依：無（只碰 db）。
 *
 * 職責：成員讀寫**自己的**個人檔案。規格見 §10.7 / ADR-0022。
 *
 * 為什麼不放進 membership：那個模組的職責是「判定目前訪問者的身分」與加入流程，
 * 是每一頁載入時都會走的路徑。個人檔案的讀寫只有一頁會用到，
 * 混進去只會讓 membership 變成一個什麼都裝的抽屜（§12.2 的深模組要窄介面）。
 *
 * **寫入的欄位範圍不是由這裡決定的。** migration 013 把 room_members 的
 * UPDATE 收窄到四個欄位，role 與 status 沒有任何角色改得動。
 * 就算這支程式被改壞、送出 { role: 'admin' }，資料庫也會拒絕。
 */

import { db, ROOM_ID } from '@db/client';

export type Profile = {
  readonly memberId: string;
  /** 牆上貼文的署名。改了之後所有既有貼文的署名一起變（ADR-0022） */
  readonly displayName: string;
  /** ISO 日期字串（YYYY-MM-DD）。選填 */
  readonly birthday: string | null;
  readonly interests: string | null;
  readonly favoriteVerse: string | null;
};

/** 可更新的欄位。未給的鍵不動，給 null 代表清空 */
export type ProfilePatch = {
  readonly displayName?: string;
  readonly birthday?: string | null;
  readonly interests?: string | null;
  readonly favoriteVerse?: string | null;
};

export class NotAMemberError extends Error {}

async function currentUserId(): Promise<string> {
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new NotAMemberError('尚未登入。');
  return data.user.id;
}

/** 讀自己的個人檔案。members_select policy 只讓成員讀得到同房間的列 */
export async function getMyProfile(): Promise<Profile> {
  const uid = await currentUserId();
  const { data, error } = await db
    .from('room_members')
    .select('id, display_name, birthday, interests, favorite_verse')
    .eq('room_id', ROOM_ID)
    .eq('user_id', uid)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotAMemberError('你還不是這個房間的成員。');

  // DB row 於此轉為 domain type，不讓 favorite_verse 這種欄位名跨出模組（§12.4 規則 3）。
  return {
    memberId: data.id,
    displayName: data.display_name,
    birthday: data.birthday,
    interests: data.interests,
    favoriteVerse: data.favorite_verse,
  };
}

/**
 * 更新自己的個人檔案。
 *
 * 空白字串一律轉成 null：migration 013 的 check 只認 null 或 1 字以上，
 * 送空字串進去會被資料庫擋下來，而那個錯誤訊息使用者看不懂。
 * 這與 posts 的 body 是同一個約定（ADR-0019）。
 */
export async function updateMyProfile(patch: ProfilePatch): Promise<Profile> {
  const uid = await currentUserId();

  // 逐一具名而不是 Record<string, …>：產生的型別會擋掉索引簽章，
  // 而那正是我們要的——多打一個欄位名（例如 role）在這裡就編不過。
  const row: {
    display_name?: string;
    birthday?: string | null;
    interests?: string | null;
    favorite_verse?: string | null;
  } = {};
  if (patch.displayName !== undefined) row.display_name = patch.displayName.trim();
  if (patch.birthday !== undefined) row.birthday = blankToNull(patch.birthday);
  if (patch.interests !== undefined) row.interests = blankToNull(patch.interests);
  if (patch.favoriteVerse !== undefined) row.favorite_verse = blankToNull(patch.favoriteVerse);

  const { data, error } = await db
    .from('room_members')
    .update(row)
    .eq('room_id', ROOM_ID)
    .eq('user_id', uid)
    .select('id, display_name, birthday, interests, favorite_verse')
    .maybeSingle();

  if (error) throw new Error(`儲存失敗：${error.message}`);
  // 更新 0 列而不是報錯，代表 policy 擋下來了——停權者就會走到這裡。
  if (!data) throw new NotAMemberError('沒有可以更新的資料，你可能已被停權。');

  return {
    memberId: data.id,
    displayName: data.display_name,
    birthday: data.birthday,
    interests: data.interests,
    favoriteVerse: data.favorite_verse,
  };
}

function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length === 0 ? null : trimmed;
}
