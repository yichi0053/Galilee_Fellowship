/**
 * membership — 深模組（架構書 §12.2）。相依：auth。
 *
 * 職責：判定目前訪問者的身分，以及加入房間的流程。
 *
 * 最重要的一件事是**孤兒帳號**（§10.4）：完成 Google 授權但尚未加入任何房間的
 * auth user。使用者關閉頁面後再回來必須能接續，不可卡在空白畫面。
 * 這個狀態由 Viewer 型別明確表達，而不是靠 null 檢查散落各處。
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { db, ROOM_ID } from '@db/client';
import { getCurrentUser } from '@modules/auth';

export type Viewer =
  /** 未登入 */
  | { readonly kind: 'guest' }
  /** 已登入但不在 room_members 中，須導向 /join 接續加入流程 */
  | { readonly kind: 'orphan'; readonly suggestedName: string | null }
  /** active 成員 */
  | {
      readonly kind: 'member';
      readonly memberId: string;
      readonly displayName: string;
      /** Google 頭像，載不到或沒有時為 null，UI 退回姓名首字 */
      readonly avatarUrl: string | null;
    }
  /** active 且 role = admin。管理員繼承成員的全部權限（§4.1） */
  | {
      readonly kind: 'admin';
      readonly memberId: string;
      readonly displayName: string;
      readonly avatarUrl: string | null;
    }
  /** 已被停權，其貼文一律隱藏（§4.3） */
  | { readonly kind: 'suspended' }
  /** 自願退出，其貼文保留顯示（§4.3） */
  | { readonly kind: 'left' };

export class JoinClosedError extends Error {}
export class InvalidJoinCodeError extends Error {}
export class RateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('嘗試次數過多');
  }
}

/** 判定目前訪問者身分。每個頁面載入時呼叫一次 */
export async function getViewer(): Promise<Viewer> {
  const user = await getCurrentUser();
  if (!user) return { kind: 'guest' };

  // 只查自己那一列。migration 005 的 members_select_self policy 保證
  // suspended 與 left 也讀得到自己，否則這三種身分在前端無從區分（見該檔說明）。
  const { data, error } = await db
    .from('room_members')
    .select('id, display_name, role, status')
    .eq('room_id', ROOM_ID)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) throw error;

  // 查得到 auth user 卻查不到成員列，就是孤兒帳號（§10.4）。
  // 這不是錯誤狀態，是加入流程的正常中間態，使用者關掉頁面再回來必須能接續。
  if (!data) return { kind: 'orphan', suggestedName: user.suggestedName };

  switch (data.status) {
    case 'suspended':
      return { kind: 'suspended' };
    case 'left':
      return { kind: 'left' };
    case 'active': {
      // 頭像來自 auth 而非 room_members：顯示姓名是成員自填的（可能與 Google 不同），
      // 頭像則一律跟著 Google 帳號走，我們不存也不管理它。
      const common = {
        memberId: data.id,
        displayName: data.display_name,
        avatarUrl: user.avatarUrl,
      } as const;
      return data.role === 'admin'
        ? { kind: 'admin', ...common }
        : { kind: 'member', ...common };
    }
  }
}

/**
 * 便利判斷，避免 UI 到處寫 kind === 'member' || kind === 'admin'。
 *
 * 刻意沒有對應的 isAdmin：管理員的分支只有三處，且都需要同時取出 memberId，
 * 寫成 viewer.kind === 'admin' 才能讓 TypeScript 收窄型別。
 */
export function canPost(viewer: Viewer): boolean {
  return viewer.kind === 'member' || viewer.kind === 'admin';
}

/**
 * 加入房間。內部呼叫 join-room Edge Function：
 * 驗 JWT → 查 join_open → rate limit → 比對房間碼 → 寫 join_attempts
 * → 成功則以 service role 建立 room_members 列。
 *
 * 前端無法自行插入 room_members（該表刻意沒有 INSERT policy）。
 */
export async function joinRoom(joinCode: string, displayName: string): Promise<Viewer> {
  const { data, error } = await db.functions.invoke<JoinRoomResponse>('join-room', {
    body: { joinCode, displayName },
  });

  if (error) {
    // 非 HTTP 錯誤（斷網、CORS、function 未部署）沒有 body 可讀，原樣拋出。
    if (!(error instanceof FunctionsHttpError)) throw error;

    const res: Response = error.context;
    const payload = ((await res.json().catch(() => null)) ?? {}) as JoinRoomError;

    switch (payload.error) {
      case 'join_closed':
        throw new JoinClosedError('房間已關閉加入，請聯絡管理員。');
      case 'invalid_code':
        // Edge Function 刻意不區分「房間碼錯」與「房間不存在」，此處照樣不區分。
        throw new InvalidJoinCodeError('房間碼不正確。');
      case 'rate_limited':
        throw new RateLimitedError(payload.retryAfterSeconds ?? 3600);
      case 'suspended':
        // 停權者不得用房間碼繞回來。這不是例外，是一種確定的身分，
        // 交給呼叫端照 Viewer 正常渲染（§4.3）。
        return { kind: 'suspended' };
      case 'invalid_display_name':
        throw new Error(`顯示姓名不可空白，且不可超過 ${payload.maxLength ?? 20} 字。`);
      case 'unauthenticated':
        throw new Error('尚未登入，請先以 Google 帳號登入。');
      default:
        throw error;
    }
  }

  if (!data) throw new Error('join-room 沒有回傳內容。');

  // role/status 是 DB row 的欄位名，在此轉為 domain type，不讓它跨出模組（§12.4 規則 3）。
  const m = data.member;
  // 剛加入完，頭像從目前的 auth session 取；取不到就先留 null，
  // 下次 getViewer() 會補上（UI 本來就要能處理 null）。
  const authUser = await getCurrentUser();
  const common = {
    memberId: m.id,
    displayName: m.display_name,
    avatarUrl: authUser?.avatarUrl ?? null,
  } as const;
  return m.role === 'admin' ? { kind: 'admin', ...common } : { kind: 'member', ...common };
}

// ---- join-room Edge Function 的回應契約（supabase/functions/join-room/index.ts）----
// 這是跨執行環境的介面，兩邊無法共用型別，改動時務必同時改。

type JoinRoomResponse = {
  readonly ok: true;
  readonly alreadyMember: boolean;
  readonly member: {
    readonly id: string;
    readonly display_name: string;
    readonly role: 'member' | 'admin';
    readonly status: 'active' | 'suspended' | 'left';
  };
};

type JoinRoomError = {
  readonly error?: string;
  readonly retryAfterSeconds?: number;
  readonly maxLength?: number;
};
