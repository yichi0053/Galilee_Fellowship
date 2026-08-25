#!/usr/bin/env bash
#
# 驗證 eslint.config.js 真的擋得住架構書 §12.3 / §12.4 的違規。
#
# lint 規則寫了但沒生效，失敗模式是安靜的：你以為有護欄，其實沒有。
# 本腳本刻意寫入違規檔案，確認 eslint 報錯，然後刪除。
#
# 用法：bash scripts/check-architecture-guard.sh
set -uo pipefail
cd "$(dirname "$0")/.."

TMP_UI="src/ui/__guard_violation.ts"
TMP_MOD="src/modules/media/__guard_violation.ts"
TMP_DEEP="src/ui/__guard_deep.ts"

cleanup() { rm -f "$TMP_UI" "$TMP_MOD" "$TMP_DEEP"; }
trap cleanup EXIT

pass=0
fail=0

expect_lint_error() {
  local label="$1" file="$2"
  if npx eslint "$file" >/dev/null 2>&1; then
    echo "  ✗ $label — eslint 未報錯，護欄失效"
    fail=$((fail + 1))
  else
    echo "  ✓ $label"
    pass=$((pass + 1))
  fi
}

echo "架構護欄檢查"

# 規則 2：UI 層禁止 import db/
cat > "$TMP_UI" <<'EOF'
import { db } from '@db/client';
export const x = db;
EOF
expect_lint_error "UI 層 import db/ 應被拒" "$TMP_UI"

# 規則 1：禁止跨 module 深層 import
cat > "$TMP_DEEP" <<'EOF'
import { something } from '@modules/posts/internal/helpers';
export const y = something;
EOF
expect_lint_error "跨 module 深層 import 應被拒" "$TMP_DEEP"

# §12.3：media 為葉節點，不可相依於 posts
cat > "$TMP_MOD" <<'EOF'
import { createPost } from '@modules/posts';
export const z = createPost;
EOF
expect_lint_error "media 相依於 posts（方向錯誤）應被拒" "$TMP_MOD"

cleanup

# 正常的程式碼必須通過
echo "  --- 既有程式碼 ---"
if npx eslint . >/dev/null 2>&1; then
  echo "  ✓ 現有程式碼通過 lint"
  pass=$((pass + 1))
else
  echo "  ✗ 現有程式碼未通過 lint"
  npx eslint .
  fail=$((fail + 1))
fi

echo
echo "通過 $pass 項，失敗 $fail 項"
[ "$fail" -eq 0 ]
