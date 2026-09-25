#!/usr/bin/env bash
# Re-vendors the office converters used by the in-app reader into vendor/office:
#   mammoth (Word .docx → HTML), SheetJS CE (spreadsheets), JSZip (PowerPoint .pptx).
# Usage: scripts/update-office-libs.sh <mammoth-version> <jszip-version> <sheetjs-version>
set -euo pipefail
MAMMOTH="$1"; JSZIP="$2"; SHEETJS="$3"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/vendor/office"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"

npm pack "mammoth@$MAMMOTH" "jszip@$JSZIP" --silent >/dev/null
mkdir -p mammoth jszip
tar xzf "mammoth-$MAMMOTH.tgz" -C mammoth
tar xzf "jszip-$JSZIP.tgz" -C jszip
curl -sSL -o xlsx.full.min.js "https://cdn.sheetjs.com/xlsx-$SHEETJS/package/dist/xlsx.full.min.js"
curl -sSL -o sheetjs-LICENSE "https://cdn.sheetjs.com/xlsx-$SHEETJS/package/LICENSE"

mkdir -p "$OUT/licenses"
cp mammoth/package/mammoth.browser.min.js jszip/package/dist/jszip.min.js xlsx.full.min.js "$OUT/"
cp mammoth/package/LICENSE "$OUT/licenses/mammoth-LICENSE"
cp jszip/package/LICENSE.markdown "$OUT/licenses/jszip-LICENSE.md"
cp sheetjs-LICENSE "$OUT/licenses/sheetjs-LICENSE"
printf "mammoth %s\njszip %s\nsheetjs (xlsx) %s\n" "$MAMMOTH" "$JSZIP" "$SHEETJS" > "$OUT/VERSIONS"
(cd "$OUT" && sha256sum ./*.js)
