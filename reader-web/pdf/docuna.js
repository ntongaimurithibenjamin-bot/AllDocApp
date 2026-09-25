/*
 * Docuna bridge for the bundled PDF.js viewer. Loaded by viewer.html (patched at prebuild) as a
 * classic script, so it runs before PDF.js's module scripts and can configure the viewer.
 *
 * App → viewer: window.docuna.{goToPage, find, clearFind, setZoom, setNight, goToOutline}
 * Viewer → app: ReactNativeWebView.postMessage(JSON) with a `type` of
 *   loaded | page | find | outline | error
 */
(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var lowMemory = params.get('lowmem') === '1';
  var night = params.get('night') === '1';
  var outline = [];

  function post(message) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    } catch (e) {
      /* not inside the app */
    }
  }

  function applyNight(enabled) {
    document.documentElement.classList.toggle('docuna-night', !!enabled);
  }
  applyNight(night);

  document.addEventListener('webviewerloaded', function () {
    var options = window.PDFViewerApplicationOptions;
    if (!options) return;
    options.set('disablePreferences', true);
    options.set('disableHistory', true);
    // PDF JavaScript is never executed: documents are untrusted input.
    options.set('enableScripting', false);
    // No network: don't fetch the alt-text ML model; editing tools are out of scope for reading.
    options.set('enableAltText', false);
    options.set('enableAltTextModelDownload', false);
    options.set('annotationEditorMode', -1);
    options.set('localeProperties', { lang: 'en-US' });
    options.set('sidebarViewOnLoad', 0);
    options.set('defaultZoomValue', 'page-width');
    // Low-RAM phones: cap each page canvas (~4 MP instead of ~33 MP) to avoid out-of-memory kills.
    if (lowMemory) options.set('maxCanvasPixels', Math.pow(2, 22));
  });

  function flattenOutline(items, depth, out) {
    (items || []).forEach(function (item) {
      out.push({ title: item.title, depth: depth, dest: item.dest, url: item.url || null });
      flattenOutline(item.items, depth + 1, out);
    });
    return out;
  }

  function whenReady(callback) {
    var app = window.PDFViewerApplication;
    if (!app) return setTimeout(function () { whenReady(callback); }, 50);
    app.initializedPromise.then(function () { callback(app); });
  }

  whenReady(function (app) {
    var bus = app.eventBus;
    var findState = { query: '' };

    bus.on('pagesloaded', function (event) {
      post({ type: 'loaded', pageCount: event.pagesCount });
      app.pdfDocument.getOutline().then(function (items) {
        outline = flattenOutline(items, 0, []);
        post({
          type: 'outline',
          items: outline.map(function (item, index) {
            return { index: index, title: item.title, depth: item.depth };
          }),
        });
      });
    });

    bus.on('pagechanging', function (event) {
      post({ type: 'page', page: event.pageNumber, pageCount: app.pagesCount });
    });

    bus.on('updatefindmatchescount', function (event) {
      post({ type: 'find', current: event.matchesCount.current, total: event.matchesCount.total, pending: false });
    });

    bus.on('updatefindcontrolstate', function (event) {
      // state: 0 found, 1 not found, 2 wrapped, 3 pending
      var counts = event.matchesCount || { current: 0, total: 0 };
      post({ type: 'find', current: counts.current, total: counts.total, pending: event.state === 3 });
    });

    window.docuna = {
      goToPage: function (page) {
        app.page = Math.max(1, Math.min(page, app.pagesCount));
      },
      find: function (query, previous) {
        var again = query === findState.query;
        findState.query = query;
        bus.dispatch('find', {
          source: null,
          type: again ? 'again' : '',
          query: query,
          caseSensitive: false,
          entireWord: false,
          highlightAll: true,
          findPrevious: !!previous,
          matchDiacritics: false,
        });
      },
      clearFind: function () {
        findState.query = '';
        bus.dispatch('findbarclose', { source: null });
      },
      setZoom: function (value) {
        app.pdfViewer.currentScaleValue = value;
      },
      setNight: applyNight,
      goToOutline: function (index) {
        var item = outline[index];
        if (!item) return;
        if (item.dest) app.pdfLinkService.goToDestination(item.dest);
        else if (item.url) window.location.href = item.url; // intercepted by the app
      },
    };
  });

  window.addEventListener('error', function (event) {
    post({ type: 'error', message: String(event.message || 'Unknown error') });
  });
})();
