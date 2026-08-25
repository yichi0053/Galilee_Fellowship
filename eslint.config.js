// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * 架構書 §12.4 的硬性規則，以 lint 強制，違反時建置失敗。
 *
 *   ui  →  modules  →  db      （單向，無循環）
 *
 * 1. UI 層禁止 import db/
 * 2. 每個 module 只以 index.ts 對外，禁止跨 module 深層 import
 * 3. modules 之間的相依方向固定（§12.3）
 */

const DB_PATTERNS = ['@db', '@db/*', '**/db/*', '../db/*', './db/*'];
const UI_PATTERNS = ['@ui', '@ui/*', '**/ui/*', '../ui/*', './ui/*'];

/** 產生「只准 import 這幾個 module」的限制設定 */
function allowOnlyModules(allowed) {
  const all = ['media', 'quota', 'themes', 'posts', 'membership', 'auth', 'admin'];
  const forbidden = all.filter((m) => !allowed.includes(m));
  return forbidden.flatMap((m) => [`@modules/${m}`, `@modules/${m}/*`, `**/modules/${m}`, `**/modules/${m}/*`]);
}

/** 深層 import 偵測：@modules/x/anything 一律禁止（x/index 除外由 alias 自動解析） */
const DEEP_MODULE_PATTERNS = ['@modules/*/*', '**/modules/*/*'];

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'src/db/types.ts', 'supabase/functions/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---- 全域 ----
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: DEEP_MODULE_PATTERNS,
              message:
                '§12.4 規則 1：每個 module 只以 index.ts 對外，同目錄下其他檔案為 internal，禁止跨 module 深層 import。',
            },
          ],
        },
      ],
    },
  },

  // ---- 規則 2：UI 層禁止碰 db ----
  {
    files: ['src/ui/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: DB_PATTERNS,
              message:
                '§12.4 規則 2：UI 層禁止 import db/。請改為呼叫 modules/*/index.ts 匯出的函式；' +
                'DB row 型別不得跨出 module（規則 3）。',
            },
            {
              group: DEEP_MODULE_PATTERNS,
              message: '§12.4 規則 1：只能 import @modules/<name>，不可深入其內部檔案。',
            },
          ],
        },
      ],
    },
  },

  // ---- 規則 3：modules 之間的相依方向（§12.3）----
  ...[
    { dir: 'media', allow: [] },
    { dir: 'quota', allow: [] },
    { dir: 'themes', allow: [] },
    { dir: 'auth', allow: [] },
    { dir: 'posts', allow: ['quota', 'media', 'themes'] },
    { dir: 'membership', allow: ['auth'] },
    { dir: 'admin', allow: ['membership', 'posts', 'themes'] },
  ].map(({ dir, allow }) => ({
    files: [`src/modules/${dir}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: allowOnlyModules([dir, ...allow]),
              message: `§12.3 相依方向：modules/${dir} 只可相依於 [${allow.join(', ') || '無'}]。` +
                '出現此錯誤通常代表模組邊界劃錯（§12.8 訊號 3）。',
            },
            {
              group: UI_PATTERNS,
              message: '§12.3：相依方向為 ui → modules → db，module 不得反向 import ui。',
            },
            {
              group: DEEP_MODULE_PATTERNS,
              message: '§12.4 規則 1：只能 import @modules/<name>，不可深入其內部檔案。',
            },
          ],
        },
      ],
    },
  })),

  // ---- domain 層：shared kernel。純型別與純函式，不得相依於任何上層 ----
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...UI_PATTERNS, ...DB_PATTERNS, '@modules', '@modules/*', '**/modules/*'],
              message:
                'src/domain 為 shared kernel（§3 共享語言的程式對應物），' +
                '必須是純葉節點，不得相依於 modules、ui 或 db。',
            },
          ],
        },
      ],
    },
  },

  // ---- db 層：葉節點，不得 import 上層 ----
  {
    files: ['src/db/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...UI_PATTERNS, '@modules', '@modules/*', '**/modules/*'],
              message: '§12.3：db 為最底層，不得 import modules 或 ui。',
            },
          ],
        },
      ],
    },
  },

  // ---- scripts / config 檔 ----
  {
    files: ['scripts/**/*.ts', 'vite.config.ts', 'eslint.config.js'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
);
