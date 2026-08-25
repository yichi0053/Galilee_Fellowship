import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * 多頁應用（MPA）。每個 HTML 入口對應 docs 第 10.1 節的一條路徑，
 * 乾淨網址（/wall 而非 /wall.html）由 public/_redirects 於 Cloudflare Pages 處理。
 */
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        wall: resolve(__dirname, 'wall.html'),
        post: resolve(__dirname, 'post.html'),
        new: resolve(__dirname, 'new.html'),
        join: resolve(__dirname, 'join.html'),
        member: resolve(__dirname, 'member.html'),
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
