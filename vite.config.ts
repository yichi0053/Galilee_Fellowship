import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import type { Connect, Plugin } from 'vite';

/**
 * 乾淨網址在本機的對應（§10.1）。
 *
 * public/_redirects 只有 Cloudflare Pages 會讀，Vite 的 dev 與 preview server 都不會。
 * 少了這段，/join 在本機是 404——而 OAuth 完成後 Google 導回的正是 /join，
 * 整個加入流程於是無法在本機走完，失敗還會被誤認為 OAuth 設定有問題。
 *
 * **本表與 public/_redirects 不再是同一組規則。** 兩邊的宿主行為不同：
 * Cloudflare Pages 本來就會以 wall.html 服務 /wall，且會把 .html 結尾的目標
 * 308 轉回無副檔名形式（因此那邊的規則必須刪光精確路徑、目標不可寫 .html，
 * 見該檔的說明）；Vite 沒有這層解析，六條都得自己補。
 * 動到任何一邊時，請先讀另一邊的註解確認差異仍然成立。
 *
 * 順序有意義：/post/new 必須排在 /post/* 之前，
 * /member/me/edit 必須排在 /member/* 之前。
 */
const CLEAN_URLS: readonly (readonly [RegExp, string])[] = [
  [/^\/wall\/?$/, '/wall.html'],
  [/^\/join\/?$/, '/join.html'],
  [/^\/admin\/?$/, '/admin.html'],
  [/^\/member\/me\/edit\/?$/, '/profile.html'],
  [/^\/post\/new\/?$/, '/new.html'],
  [/^\/post\/.+/, '/post.html'],
  [/^\/member\/.+/, '/member.html'],
];

function cleanUrls(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, _res, next) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    const hit = CLEAN_URLS.find(([pattern]) => pattern.test(path));
    if (hit) req.url = hit[1];
    next();
  };
  return {
    name: 'galilee-clean-urls',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

/**
 * 多頁應用（MPA）。每個 HTML 入口對應 docs 第 10.1 節的一條路徑，
 * 乾淨網址（/wall 而非 /wall.html）由 public/_redirects 於 Cloudflare Pages 處理。
 */
export default defineConfig({
  plugins: [cleanUrls()],
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        wall: resolve(__dirname, 'wall.html'),
        post: resolve(__dirname, 'post.html'),
        new: resolve(__dirname, 'new.html'),
        join: resolve(__dirname, 'join.html'),
        member: resolve(__dirname, 'member.html'),
        profile: resolve(__dirname, 'profile.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@db': resolve(__dirname, 'src/db'),
      '@domain': resolve(__dirname, 'src/domain'),
      '@modules': resolve(__dirname, 'src/modules'),
      '@ui': resolve(__dirname, 'src/ui'),
      '@config': resolve(__dirname, 'src/config'),
    },
  },
});
