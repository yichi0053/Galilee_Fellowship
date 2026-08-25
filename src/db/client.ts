import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

/**
 * 全案唯一持有 supabase client 的檔案（架構書 §12.2）。
 *
 * UI 層禁止 import 本檔（§12.4 規則 2），由 eslint.config.js 強制。
 * 需要資料時請呼叫 src/modules/<name>/index.ts 匯出的函式。
 */

/**
 * 逐一具名讀取，不用 import.meta.env[name] 的動態存取——
 * Vite 只保證靜態的 import.meta.env.VITE_X 會在 build 時被替換。
 */
function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `缺少環境變數 ${name}。請複製 .env.example 為 .env 並填入值，見 docs/SETUP.md。`,
    );
  }
  return value;
}

export const db: SupabaseClient<Database> = createClient<Database>(
  requireEnv('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
  requireEnv('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY),
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

/**
 * 第一期只有一個房間（ADR-0004）。所有查詢都必須帶上此 id，
 * 即使 RLS 已經擋掉跨房間存取——少了 where 條件，日後擴展為 multi-tenant 時會安靜出錯。
 */
export const ROOM_ID: string = requireEnv('VITE_ROOM_ID', import.meta.env.VITE_ROOM_ID);
