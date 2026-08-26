import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // 預設為 node（純邏輯測試）；需要 DOM 的檔案以檔名結尾切換
      environmentMatchGlobs: [['**/*.dom.test.ts', 'happy-dom']],
    },
  }),
);
