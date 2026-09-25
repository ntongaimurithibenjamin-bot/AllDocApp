/*
 * Docuna office reader: renders Word (.docx), spreadsheets (.xlsx/.xls/.ods/.csv) and PowerPoint
 * (.pptx) on the device, inside the reader WebView. Same bridge protocol as the other readers:
 *   app → page:  window.docuna.{goToPage, find, clearFind, setZoom, setNight}
 *   page → app:  {type: 'loaded' | 'page' | 'progress' | 'zoom' | 'tap' | 'find' | 'failed', ...}
 * Query: ?file=<file:// URL>&type=word|sheet|slides&night=0|1
 */
(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var fileUrl = params.get('file');
  var type = params.get('type');
  var content = document.getElementById('content');
  var statusEl = document.getElementById('status');
  var noticeEl = document.getElementById('notice');
  var tabsEl = document.getElementById('tabs');
  /** Rows parsed per sheet: keeps huge spreadsheets from exhausting a low-RAM phone. */
  var MAX_SHEET_ROWS = 5000;
  var MAX_MATCHES = 5000;

  document.documentElement.classList.toggle('night', params.get('night') === '1');

  function post(message) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    } catch (e) {
      /* not inside the app */
    }
  }

  function throttleFrame(fn) {
    var queued = false;
    return function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        fn();
      });
    };
  }

  function fail(message) {
    statusEl.hidden = false;
    statusEl.textContent = 'This file could not be opened.';
    post({ type: 'failed', message: String(message) });
  }

  window.addEventListener('error', function (event) {
    post({ type: 'error', message: String(event.message) });
  });

  // --- taps & zoom ------------------------------------------------------------------------------

  var tapTimer = null;
  document.addEventListener(
    'click',
    function (event) {
      var target = event.target;
      if (target && target.closest && target.closest('a, button, input, textarea, select, #tabs')) return;
      var selection = window.getSelection && window.getSelection();
      if (selection && String(selection).length > 0) return;
      if (tapTimer) {
        clearTimeout(tapTimer);
        tapTimer = null;
        return;
      }
      tapTimer = setTimeout(function () {
        tapTimer = null;
        post({ type: 'tap' });
      }, 280);
    },
    true,
  );

  if (window.visualViewport) {
    var lastZoom = 100;
    window.visualViewport.addEventListener(
      'resize',
      throttleFrame(function () {
        var zoom = Math.round(window.visualViewport.scale * 100);
        if (zoom !== lastZoom) {
          lastZoom = zoom;
          post({ type: 'zoom', percent: zoom });
        }
      }),
    );
  }

  // --- loading ----------------------------------------------------------------------------------

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error('Could not load ' + src));
      };
      document.head.appendChild(script);
    });
  }

  /** fetch() doesn't support file:// in Android WebView; XHR does (with file access enabled). */
  function readFile(url) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'arraybuffer';
      xhr.onload = function () {
        if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) resolve(xhr.response);
        else reject(new Error('HTTP ' + xhr.status));
      };
      xhr.onerror = function () {
        reject(new Error('Could not read the file'));
      };
      xhr.send();
    });
  }

  // --- paging (slides and sheets have "pages"; Word reports scroll progress) ---------------------

  var pageMode = 'progress';
  var pageCount = 0;
  var currentPage = 0;
  var slideEls = [];

  function reportScroll() {
    if (pageMode === 'slides') {
      var probe = window.innerHeight * 0.35;
      var page = 1;
      for (var i = 0; i < slideEls.length; i++) {
        if (slideEls[i].getBoundingClientRect().top <= probe) page = i + 1;
        else break;
      }
      if (page !== currentPage) {
        currentPage = page;
        post({ type: 'page', page: page, pageCount: pageCount });
      }
    } else if (pageMode === 'progress') {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      post({ type: 'progress', percent: max > 0 ? Math.round((window.scrollY / max) * 100) : 100 });
    }
  }
  window.addEventListener('scroll', throttleFrame(reportScroll), { passive: true });

  // --- Word ---------------------------------------------------------------------------------------

  function renderWord(data) {
    return loadScript('mammoth.browser.min.js')
      .then(function () {
        return window.mammoth.convertToHtml({ arrayBuffer: data });
      })
      .then(function (result) {
        var article = document.createElement('article');
        article.className = 'doc';
        article.innerHTML = result.value || '<p><em>This document is empty.</em></p>';
        content.appendChild(article);
        return 0;
      });
  }

  // --- Spreadsheets -------------------------------------------------------------------------------

  var workbook = null;

  function showSheet(index) {
    var name = workbook.SheetNames[index];
    var sheet = workbook.Sheets[name];
    content.textContent = '';
    var wrapper = document.createElement('div');
    wrapper.className = 'sheet';
    var hasCells = sheet && sheet['!ref'];
    if (hasCells) {
      // sheet_to_html escapes cell text; the CSP stops anything executable regardless.
      wrapper.innerHTML = window.XLSX.utils.sheet_to_html(sheet, { header: '', footer: '', editable: false });
    } else {
      wrapper.innerHTML = '<p class="empty">This sheet is empty.</p>';
    }
    content.appendChild(wrapper);
    Array.prototype.forEach.call(tabsEl.children, function (button, i) {
      button.setAttribute('aria-selected', String(i === index));
    });
    currentPage = index + 1;
    window.scrollTo(0, 0);
    post({ type: 'page', page: currentPage, pageCount: pageCount });
  }

  function renderSheet(data) {
    return loadScript('xlsx.full.min.js').then(function () {
      workbook = window.XLSX.read(data, { type: 'array', sheetRows: MAX_SHEET_ROWS + 1, cellDates: true });
      pageCount = workbook.SheetNames.length;
      pageMode = 'sheets';
      var truncated = workbook.SheetNames.some(function (name) {
        var ref = workbook.Sheets[name]['!fullref'];
        if (!ref) return false;
        return window.XLSX.utils.decode_range(ref).e.r + 1 > MAX_SHEET_ROWS;
      });
      if (truncated) {
        noticeEl.hidden = false;
        noticeEl.textContent = 'This spreadsheet is large, so only the first 5,000 rows of each sheet are shown.';
      }
      if (pageCount > 1) {
        tabsEl.hidden = false;
        workbook.SheetNames.forEach(function (name, i) {
          var button = document.createElement('button');
          button.type = 'button';
          button.textContent = name;
          button.addEventListener('click', function () {
            showSheet(i);
          });
          tabsEl.appendChild(button);
        });
      }
      showSheet(0);
      return pageCount;
    });
  }

  // --- PowerPoint ---------------------------------------------------------------------------------

  var NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  var NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

  function parseXml(text) {
    return new DOMParser().parseFromString(text, 'application/xml');
  }

  function resolvePath(base, target) {
    var parts = base.split('/');
    parts.pop();
    target.split('/').forEach(function (part) {
      if (part === '..') parts.pop();
      else if (part && part !== '.') parts.push(part);
    });
    return parts.join('/');
  }

  function renderSlide(zip, path, index) {
    var relsPath = path.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels');
    return Promise.all([zip.file(path).async('string'), zip.file(relsPath) ? zip.file(relsPath).async('string') : '']).then(
      function (texts) {
        var xml = parseXml(texts[0]);
        var rels = {};
        if (texts[1]) {
          Array.prototype.forEach.call(parseXml(texts[1]).getElementsByTagNameNS(NS_PKG, 'Relationship'), function (rel) {
            rels[rel.getAttribute('Id')] = rel.getAttribute('Target');
          });
        }

        var section = document.createElement('section');
        section.className = 'slide';
        var label = document.createElement('div');
        label.className = 'label';
        label.textContent = 'Slide ' + (index + 1);
        section.appendChild(label);

        var imagePromises = [];
        Array.prototype.forEach.call(xml.getElementsByTagNameNS(NS_P, 'sp'), function (shape) {
          var placeholder = shape.getElementsByTagNameNS(NS_P, 'ph')[0];
          var placeholderType = placeholder ? placeholder.getAttribute('type') : '';
          var isTitle = placeholderType === 'title' || placeholderType === 'ctrTitle';
          Array.prototype.forEach.call(shape.getElementsByTagNameNS(NS_A, 'p'), function (paragraph) {
            var text = Array.prototype.map
              .call(paragraph.getElementsByTagNameNS(NS_A, 't'), function (t) {
                return t.textContent;
              })
              .join('');
            if (!text.trim()) return;
            var properties = paragraph.getElementsByTagNameNS(NS_A, 'pPr')[0];
            var level = properties ? Math.min(Number(properties.getAttribute('lvl') || 0), 2) : 0;
            var el = document.createElement(isTitle ? 'h2' : 'p');
            el.textContent = text;
            if (!isTitle && level) el.className = 'level-' + level;
            section.appendChild(el);
          });
        });

        Array.prototype.forEach.call(xml.getElementsByTagNameNS(NS_A, 'blip'), function (blip) {
          var target = rels[blip.getAttributeNS(NS_R, 'embed')];
          if (!target) return;
          var file = zip.file(resolvePath(path, target));
          if (!file || !/\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(target)) return;
          var img = document.createElement('img');
          img.alt = 'Image on slide ' + (index + 1);
          section.appendChild(img);
          imagePromises.push(
            file.async('blob').then(function (blob) {
              var typed = /\.svg$/i.test(target) ? new Blob([blob], { type: 'image/svg+xml' }) : blob;
              img.src = URL.createObjectURL(typed);
            }),
          );
        });

        if (section.children.length === 1) {
          var empty = document.createElement('p');
          empty.textContent = '(No text on this slide)';
          empty.style.opacity = '0.6';
          section.appendChild(empty);
        }
        return Promise.all(imagePromises).then(function () {
          return section;
        });
      },
    );
  }

  function renderSlides(data) {
    return loadScript('jszip.min.js')
      .then(function () {
        return window.JSZip.loadAsync(data);
      })
      .then(function (zip) {
        var paths = Object.keys(zip.files)
          .filter(function (name) {
            return /^ppt\/slides\/slide\d+\.xml$/.test(name);
          })
          .sort(function (a, b) {
            return Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]);
          });
        if (paths.length === 0) throw new Error('No slides found');
        content.className = 'slides';
        // One slide at a time keeps memory flat on large decks.
        return paths.reduce(function (chain, path, i) {
          return chain.then(function () {
            return renderSlide(zip, path, i).then(function (section) {
              content.appendChild(section);
              slideEls.push(section);
            });
          });
        }, Promise.resolve()).then(function () {
          pageMode = 'slides';
          pageCount = paths.length;
          return pageCount;
        });
      });
  }

  // --- search -------------------------------------------------------------------------------------

  var marks = [];
  var markIndex = -1;
  var lastQuery = '';

  function clearMarks() {
    marks.forEach(function (mark) {
      var parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
    marks = [];
    markIndex = -1;
  }

  function highlight(query) {
    clearMarks();
    if (!query) return;
    var needle = query.toLowerCase();
    var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (var n = 0; n < nodes.length && marks.length < MAX_MATCHES; n++) {
      var node = nodes[n];
      var text = node.nodeValue;
      var lower = text.toLowerCase();
      var at = lower.indexOf(needle);
      if (at === -1) continue;
      var fragment = document.createDocumentFragment();
      var from = 0;
      while (at !== -1 && marks.length < MAX_MATCHES) {
        fragment.appendChild(document.createTextNode(text.slice(from, at)));
        var mark = document.createElement('mark');
        mark.textContent = text.slice(at, at + needle.length);
        fragment.appendChild(mark);
        marks.push(mark);
        from = at + needle.length;
        at = lower.indexOf(needle, from);
      }
      fragment.appendChild(document.createTextNode(text.slice(from)));
      node.parentNode.replaceChild(fragment, node);
    }
  }

  function select(index) {
    if (markIndex >= 0 && marks[markIndex]) marks[markIndex].classList.remove('current');
    markIndex = index;
    if (marks[markIndex]) {
      marks[markIndex].classList.add('current');
      marks[markIndex].scrollIntoView({ block: 'center', inline: 'center' });
    }
    post({ type: 'find', current: marks.length ? markIndex + 1 : 0, total: marks.length, pending: false });
  }

  window.docuna = {
    find: function (query, previous) {
      if (query !== lastQuery) {
        lastQuery = query;
        highlight(query);
        select(marks.length ? 0 : -1);
        return;
      }
      if (!marks.length) return select(-1);
      select(previous ? (markIndex - 1 + marks.length) % marks.length : (markIndex + 1) % marks.length);
    },
    clearFind: function () {
      lastQuery = '';
      clearMarks();
    },
    goToPage: function (page) {
      if (pageMode === 'sheets' && workbook) {
        lastQuery = '';
        marks = [];
        showSheet(Math.max(0, Math.min(page - 1, pageCount - 1)));
      } else if (pageMode === 'slides') {
        var el = slideEls[Math.max(0, Math.min(page - 1, slideEls.length - 1))];
        if (el) el.scrollIntoView({ block: 'start' });
      }
    },
    setNight: function (on) {
      document.documentElement.classList.toggle('night', !!on);
    },
    setZoom: function () {},
  };

  // --- go -----------------------------------------------------------------------------------------

  var renderers = { word: renderWord, sheet: renderSheet, slides: renderSlides };
  var render = renderers[type];
  if (!fileUrl || !render) {
    fail('Unknown document type: ' + type);
    return;
  }

  readFile(fileUrl)
    .then(render)
    .then(function (count) {
      statusEl.hidden = true;
      post({ type: 'loaded', pageCount: count || 0 });
      reportScroll();
    })
    .catch(fail);
})();
