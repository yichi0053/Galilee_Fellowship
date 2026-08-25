/**
 * 由 `npm run db:types`（supabase gen types typescript）產生。
 *
 * ****** 不要手動修改本檔 ******
 *
 * 階段二的 migration 套用後，執行：
 *   npx supabase gen types typescript --project-id <ref> > src/db/types.ts
 *
 * 在那之前，以下為佔位定義，讓 client.ts 可通過型別檢查。
 */

export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
