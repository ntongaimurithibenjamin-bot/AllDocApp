const fs = require('fs');
const path = require('path');

/** Inserts `snippet` right after `anchor` in `html`, failing loudly if PDF.js changed its markup. */
function insertAfter(html, anchor, snippet) {
  const index = html.indexOf(anchor);
  if (index === -1) throw new Error(`PDF.js viewer.html no longer contains: ${anchor}`);
  return html.slice(0, index + anchor.length) + snippet + html.slice(index + anchor.length);
}

/**
 * Copies the vendored PDF.js viewer (vendor/pdfjs) into android/app/src/main/assets/pdfjs and
 * links in Docuna's bridge (reader-web/pdf). The vendored copy itself is never modified.
 */
function syncPdfJsAssets(projectRoot, androidRoot) {
  const source = path.join(projectRoot, 'vendor', 'pdfjs');
  const bridge = path.join(projectRoot, 'reader-web', 'pdf');
  const target = path.join(androidRoot, 'app', 'src', 'main', 'assets', 'pdfjs');
  if (!fs.existsSync(source)) {
    throw new Error('vendor/pdfjs is missing. Run scripts/update-pdfjs.sh to vendor PDF.js.');
  }

  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
  for (const file of ['docuna.js', 'docuna.css']) {
    fs.copyFileSync(path.join(bridge, file), path.join(target, 'web', file));
  }

  // The viewer's CSP allows same-origin files only, so the bridge ships as files, not inline.
  const viewerPath = path.join(target, 'web', 'viewer.html');
  let html = fs.readFileSync(viewerPath, 'utf8');
  html = insertAfter(html, '<link rel="stylesheet" href="viewer.css" />', '\n    <link rel="stylesheet" href="docuna.css" />');
  html = insertAfter(html, '<link rel="resource" type="application/l10n" href="locale/locale.json" />', '\n<script src="docuna.js"></script>');
  fs.writeFileSync(viewerPath, html);
  return target;
}

module.exports = { syncPdfJsAssets };
