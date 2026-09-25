/**
 * HTML for the in-app reader WebView (scanned pages and text files). PDFs use the bundled PDF.js
 * viewer instead. Both speak the same bridge protocol (see reader-web/pdf/docuna.js):
 *   app → page:  window.docuna.{goToPage, find, clearFind, setZoom, setNight}
 *   page → app:  {type: 'loaded' | 'page' | 'progress' | 'find' | 'error', ...}
 */

export interface ReaderPage {
  uri: string;
  width: number;
  height: number;
}

/** Largest text file shown in full; bigger files would stall low-RAM phones. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** JSON that is safe to embed inside a <script> element. */
function embedJson(value: unknown): string {
  // Escape "<" (no "</script>" breakout) and the U+2028/U+2029 line separators.
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const BASE_CSS = `
  html, body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
  body { background: #e9ecef; color: #111827; font-family: sans-serif; }
  .night body, body.night { background: #111418; color: #d7dde5; }
`;

const BRIDGE_JS = `
  function post(message) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(message)); } catch (e) {}
  }
  window.addEventListener('error', function (e) { post({ type: 'error', message: String(e.message) }); });
  function throttleFrame(fn) {
    var queued = false;
    return function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; fn(); });
    };
  }
`;

/** Continuous vertical reader for scanned pages: lazy-loaded images, native pinch zoom. */
export function buildPagesHtml(pages: readonly ReaderPage[], options: { night: boolean; startPage: number }): string {
  const pageMarkup = pages
    .map(
      (page, i) =>
        `<div class="page" id="p${i + 1}" style="aspect-ratio:${page.width}/${page.height};--ratio:${page.width / page.height}">` +
        `<img src="${escapeHtml(page.uri)}" loading="${i < 2 ? 'eager' : 'lazy'}" decoding="async" alt="Page ${i + 1}"></div>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html class="${options.night ? 'night' : ''}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=6, user-scalable=yes">
<style>${BASE_CSS}
  #pages { padding: 8px 0 72px; }
  .page { margin: 0 auto 8px; width: calc(100% - 16px); background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
  .fit-page .page { width: min(calc(100% - 16px), calc((100vh - 16px) * var(--ratio))); }
  .page img { display: block; width: 100%; height: 100%; }
  .night .page { background: #222; }
  .night .page img { filter: invert(.9) hue-rotate(180deg); }
</style></head>
<body><div id="pages">${pageMarkup}</div>
<script>
${BRIDGE_JS}
(function () {
  var pages = document.querySelectorAll('.page');
  var total = pages.length;
  var current = 0;
  function reportPage() {
    var probe = window.innerHeight * 0.35;
    var page = 1;
    for (var i = 0; i < total; i++) {
      if (pages[i].getBoundingClientRect().top <= probe) page = i + 1; else break;
    }
    if (page !== current) { current = page; post({ type: 'page', page: page, pageCount: total }); }
  }
  window.addEventListener('scroll', throttleFrame(reportPage), { passive: true });
  window.docuna = {
    goToPage: function (n) {
      var el = document.getElementById('p' + Math.max(1, Math.min(n, total)));
      if (el) el.scrollIntoView({ block: 'start' });
    },
    setZoom: function (mode) {
      var page = current || 1;
      document.documentElement.classList.toggle('fit-page', mode === 'page-fit');
      window.docuna.goToPage(page);
    },
    setNight: function (on) { document.documentElement.classList.toggle('night', !!on); },
    find: function () {},
    clearFind: function () {},
  };
  window.docuna.goToPage(${Math.max(1, options.startPage)});
  post({ type: 'loaded', pageCount: total });
  reportPage();
})();
</script></body></html>`;
}

/** Plain-text reader with in-page search (highlights all matches, steps through them). */
export function buildTextHtml(text: string, options: { night: boolean; truncated: boolean; monospace: boolean }): string {
  return `<!DOCTYPE html>
<html class="${options.night ? 'night' : ''}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes">
<style>${BASE_CSS}
  body { background: #fff; }
  .night body { background: #111418; }
  #content { margin: 0; padding: 16px 16px 80px; white-space: pre-wrap; word-break: break-word;
    font-size: 15px; line-height: 1.55; font-family: ${options.monospace ? 'monospace' : 'sans-serif'}; }
  #notice { margin: 0; padding: 12px 16px; background: #fff4d6; color: #5c4400; font-size: 14px; }
  .night #notice { background: #3a3013; color: #f2dca0; }
  mark { background: #ffe066; color: inherit; border-radius: 2px; }
  mark.current { background: #ff9f1c; }
  .night mark { background: #7a6400; }
  .night mark.current { background: #c46b00; }
</style></head>
<body>
${options.truncated ? '<p id="notice">This file is large, so only the first 2 MB are shown.</p>' : ''}
<pre id="content"></pre>
<script id="source" type="application/json">${embedJson(text)}</script>
<script>
${BRIDGE_JS}
(function () {
  var raw = JSON.parse(document.getElementById('source').textContent);
  var content = document.getElementById('content');
  content.textContent = raw;
  var marks = [];
  var index = -1;
  var lastQuery = '';

  function render(query) {
    marks = [];
    index = -1;
    if (!query) { content.textContent = raw; return; }
    var lower = raw.toLowerCase();
    var needle = query.toLowerCase();
    var fragment = document.createDocumentFragment();
    var from = 0;
    var at = lower.indexOf(needle);
    while (at !== -1 && marks.length < 5000) {
      fragment.appendChild(document.createTextNode(raw.slice(from, at)));
      var mark = document.createElement('mark');
      mark.textContent = raw.slice(at, at + needle.length);
      fragment.appendChild(mark);
      marks.push(mark);
      from = at + needle.length;
      at = lower.indexOf(needle, from);
    }
    fragment.appendChild(document.createTextNode(raw.slice(from)));
    content.textContent = '';
    content.appendChild(fragment);
  }

  function select(i) {
    if (index >= 0 && marks[index]) marks[index].classList.remove('current');
    index = i;
    if (marks[index]) {
      marks[index].classList.add('current');
      marks[index].scrollIntoView({ block: 'center' });
    }
    post({ type: 'find', current: marks.length ? index + 1 : 0, total: marks.length, pending: false });
  }

  function reportProgress() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    post({ type: 'progress', percent: max > 0 ? Math.round((window.scrollY / max) * 100) : 100 });
  }
  window.addEventListener('scroll', throttleFrame(reportProgress), { passive: true });

  window.docuna = {
    find: function (query, previous) {
      if (query !== lastQuery) { lastQuery = query; render(query); select(marks.length ? 0 : -1); return; }
      if (!marks.length) return select(-1);
      select(previous ? (index - 1 + marks.length) % marks.length : (index + 1) % marks.length);
    },
    clearFind: function () { lastQuery = ''; render(''); },
    setNight: function (on) { document.documentElement.classList.toggle('night', !!on); },
    goToPage: function () {},
    setZoom: function () {},
  };
  post({ type: 'loaded', pageCount: 0 });
  reportProgress();
})();
</script></body></html>`;
}
