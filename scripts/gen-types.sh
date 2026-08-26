#!/usr/bin/env bash
#
# 從雲端 project 產生 src/db/types.ts。
#
# ADR-0017：開發機無 Docker，故不能用 `supabase gen types --local`。
# 改以 --project-id 打雲端 project，需要 Supabase 存取權杖：
#   npx supabase login                      （互動式，開瀏覽器）
# 或
#   export SUPABASE_ACCESS_TOKEN=sbp_...    （https://supabase.com/dashboard/account/tokens）
#
# project ref 由 .env 的 VITE_SUPABASE_URL 推導，不另設變數，避免兩處不同步。
#
# 用法：npm run db:types
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "找不到 .env，見 docs/SETUP.md" >&2; exit 2; }

# .env 的值合法地可以帶前後空白與成對引號（Vite 與 Node 的解析器都會自行剝除），
# 所以這裡不能只用 cut 硬切，否則 ref 會混進一個引號而 CLI 只回「格式錯誤」。
url=$(grep -E '^[[:space:]]*VITE_SUPABASE_URL[[:space:]]*=' .env | head -1 | cut -d= -f2-)
url=$(printf '%s' "$url" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
                               -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/")
[ -n "$url" ] || { echo "VITE_SUPABASE_URL 是空的，見 docs/SETUP.md" >&2; exit 2; }

ref=${url#https://}
ref=${ref%%.supabase.co*}

# 先自己驗格式。錯的 ref 交給 CLI 只會得到一句沒有上下文的「Invalid project ref format」。
case $ref in
  *[!a-z]*|"") echo "從 VITE_SUPABASE_URL 推導出的 project ref 不合法：'$ref'（原值：$url）" >&2; exit 2;;
esac

echo "產生型別，project ref：$ref"

# 先寫暫存檔。直接重導向到 types.ts 的話，指令失敗會把檔案清空，
# 留下一個「編譯過但什麼都沒有」的型別檔，失敗模式是安靜的。
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

npx supabase gen types typescript --project-id "$ref" > "$tmp"
[ -s "$tmp" ] || { echo "產出是空的，型別未更新" >&2; exit 1; }

mv "$tmp" src/db/types.ts
trap - EXIT
echo "已寫入 src/db/types.ts（$(wc -l < src/db/types.ts) 行）"
