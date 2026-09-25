#!/usr/bin/env bash
# Re-vendors Mozilla PDF.js (legacy build) into vendor/pdfjs, trimmed to what the in-app reader
# needs at runtime. Usage: scripts/update-pdfjs.sh <version> <sha256-of-legacy-dist-zip>
set -euo pipefail
VERSION="$1"
SHA256="$2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -sSL -o "$TMP/dist.zip" "https://github.com/mozilla/pdf.js/releases/download/v${VERSION}/pdfjs-${VERSION}-legacy-dist.zip"
echo "${SHA256}  $TMP/dist.zip" | sha256sum -c -
unzip -q "$TMP/dist.zip" -d "$TMP/out"

cd "$TMP/out"
find . -name '*.map' -delete
# Not needed: debugger, sample PDF, and everything used only for PDF scripting (disabled in Docuna).
rm -f web/debugger.mjs web/debugger.css web/compressed.tracemonkey-pldi-09.pdf build/pdf.sandbox.mjs web/wasm/quickjs-eval.*
# UI strings: English only (the reader's own chrome is native).
(cd web/locale && find . -mindepth 1 -maxdepth 1 -type d ! -name en-US -exec rm -rf {} +)

rm -rf "$ROOT/vendor/pdfjs"
cp -r "$TMP/out" "$ROOT/vendor/pdfjs"
echo "$VERSION" > "$ROOT/vendor/pdfjs/VERSION"
echo "Vendored PDF.js $VERSION ($(du -sh "$ROOT/vendor/pdfjs" | cut -f1))"
