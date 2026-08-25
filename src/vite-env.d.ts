/// <reference types="vite/client" />

/**
 * 前端可見的環境變數（架構書 §5.1）。
 * 只有 VITE_ 前綴的變數會被打包進 bundle，因此這裡列出的每一個值都等同公開。
 * service_role key 絕對不可出現在此介面中。
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_ROOM_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
