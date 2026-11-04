(function () {
  'use strict';

  var PROGRESS_KEY = 'textbook-progress-v1';
  var params = new URLSearchParams(window.location.search);
  var bookId = params.get('book') || '';

  var els = {
    subject: document.getElementById('reader-subject'),
    title: document.getElementById('reader-title'),
    edition: document.getElementById('reader-edition'),
    pdfLink: document.getElementById('pdf-link'),
    toc: document.getElementById('toc'),
    tocHint: document.getElementById('toc-hint'),
    unitGraph: document.getElementById('unit-graph'),
    unitGraphTopics: document.getElementById('unit-graph-topics'),
    unitGraphCount: document.getElementById('unit-graph-count'),
    unitGraphNote: document.getElementById('unit-graph-note'),
    unitExplore: document.getElementById('unit-explore'),
    unitDiagnose: document.getElementById('unit-diagnose'),
    side: document.getElementById('reader-side'),
    sideClose: document.getElementById('side-close'),
    sideSource: document.getElementById('side-source'),
    sideOfficial: document.getElementById('side-official'),
    tocToggle: document.getElementById('toc-toggle'),
    scrim: document.getElementById('side-scrim'),
    prev: document.getElementById('prev-page'),
    next: document.getElementById('next-page'),
    pageInput: document.getElementById('page-input'),
    pageTotal: document.getElementById('page-total'),
    zoomOut: document.getElementById('zoom-out'),
    zoomIn: document.getElementById('zoom-in'),
    fitPage: document.getElementById('fit-page'),
    fitWidth: document.getElementById('fit-width'),
    fullscreen: document.getElementById('fullscreen'),
    stage: document.getElementById('stage'),
    canvas: document.getElementById('pdf-canvas'),
    loading: document.getElementById('loading'),
    loadingText: document.getElementById('loading-text'),
    loadbar: document.getElementById('loadbar'),
    error: document.getElementById('error'),
    errorText: document.getElementById('error-text'),
    errorOpen: document.getElementById('error-open'),
    pageStatus: document.getElementById('page-status'),
    localNote: document.getElementById('local-note'),
  };

  var state = {
    book: null,
    pdf: null,
    page: 1,
    total: 0,
    zoom: 1,
    fitMode: 'page',
    renderTask: null,
    renderToken: 0,
    tocItems: [],
    taxonomy: null,
    local: false,
    mirror: false,
    loading: true,
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function readProgress() {
    try {
      var raw = window.localStorage.getItem(PROGRESS_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function saveProgress() {
    if (!state.book || !state.page) return;
    try {
      var progress = readProgress();
      progress[state.book.id] = {
        page: state.page,
        total: state.total,
        updatedAt: new Date().toISOString(),
      };
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    } catch (error) {
      /* 忽略隐私模式下的存储失败 */
    }
  }

  function showError(message) {
    state.loading = false;
    els.loading.hidden = true;
    els.error.hidden = false;
    els.errorText.textContent = message || '可能是上游 PDF 链接暂时不可用。';
    els.errorOpen.href = state.book ? state.book.pdf : '#';
  }

  function updateControls() {
    els.pageInput.value = state.page;
    els.pageInput.max = state.total || 1;
    els.pageTotal.textContent = state.total || 0;
    els.pageStatus.textContent = '第 ' + state.page + ' 页' + (state.total ? ' / 共 ' + state.total + ' 页' : '');
    els.prev.disabled = state.page <= 1;
    els.next.disabled = !state.total || state.page >= state.total;
    els.fitPage.setAttribute('aria-pressed', String(state.fitMode === 'page'));
    els.fitWidth.setAttribute('aria-pressed', String(state.fitMode === 'width'));
    document.title = state.book
      ? state.book.label + ' · 第 ' + state.page + ' 页 · 教材中心'
      : '在线翻阅 · 教材中心';
    highlightToc();
  }

  function highlightToc() {
    var best = null;
    state.tocItems.forEach(function (item) {
      if (!item.page) return;
      if (item.page <= state.page && (!best || item.page >= best.page)) best = item;
    });
    Array.prototype.forEach.call(els.toc.querySelectorAll('[data-page]'), function (button) {
      button.classList.toggle('is-active', best && Number(button.dataset.page) === best.page);
    });
  }

  function scrollTocToActive() {
    var active = els.toc.querySelector('.is-active');
    if (!active) return;
    var side = els.side;
    var top = active.offsetTop;
    if (top < side.scrollTop || top > side.scrollTop + side.clientHeight - 80) {
      side.scrollTop = Math.max(0, top - side.clientHeight / 2);
    }
  }

  function setPage(page, options) {
    if (!state.pdf) return;
    var next = clamp(Number(page) || 1, 1, state.total || 1);
    var changed = next !== state.page;
    state.page = next;
    updateControls();
    updateUnitGraph();
    if (window.location.hash !== '#p=' + next) {
      try {
        window.history.replaceState(null, '', '#p=' + next);
      } catch (error) {
        /* 某些静态环境不允许 replaceState，不影响阅读 */
      }
    }
    saveProgress();
    if (changed || (options && options.force)) renderCurrentPage();
    if (window.matchMedia('(max-width: 900px)').matches) closeSidebar();
  }

  function metrics() {
    var stageStyle = window.getComputedStyle(els.stage);
    var padX = parseFloat(stageStyle.paddingLeft) + parseFloat(stageStyle.paddingRight);
    var padY = parseFloat(stageStyle.paddingTop) + parseFloat(stageStyle.paddingBottom);
    return {
      width: Math.max(200, els.stage.clientWidth - padX),
      height: Math.max(200, els.stage.clientHeight - padY),
    };
  }

  async function renderCurrentPage() {
    if (!state.pdf) return;
    var token = ++state.renderToken;
    var pageNumber = state.page;
    if (state.renderTask) {
      try { state.renderTask.cancel(); } catch (error) { /* 已结束 */ }
      state.renderTask = null;
    }
    els.stage.classList.add('is-rendering');
    try {
      var page = await state.pdf.getPage(pageNumber);
      if (token !== state.renderToken) return;
      var unscaled = page.getViewport({ scale: 1 });
      var box = metrics();
      var fitScale;
      if (state.fitMode === 'width') {
        fitScale = box.width / unscaled.width;
      } else {
        fitScale = Math.min(box.width / unscaled.width, box.height / unscaled.height);
      }
      var scale = Math.max(0.15, fitScale * state.zoom);
      var viewport = page.getViewport({ scale: scale });
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var canvas = els.canvas;
      var ctx = canvas.getContext('2d', { alpha: false });
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = Math.floor(viewport.width) + 'px';
      canvas.style.height = Math.floor(viewport.height) + 'px';
      canvas.style.visibility = 'visible';
      var transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null;
      state.renderTask = page.render({
        canvasContext: ctx,
        viewport: viewport,
        transform: transform,
      });
      await state.renderTask.promise;
      state.renderTask = null;
      if (token !== state.renderToken) return;
      if (!state.loading) {
        els.stage.classList.remove('is-rendering');
      }
      updateControls();
      scrollTocToActive();
      // 预热相邻页，翻页更顺
      if (pageNumber < state.total) {
        state.pdf.getPage(pageNumber + 1).catch(function () {});
      }
      if (pageNumber > 1) {
        state.pdf.getPage(pageNumber - 1).catch(function () {});
      }
    } catch (error) {
      if (error && error.name === 'RenderingCancelledException') return;
      if (token !== state.renderToken) return;
      state.renderTask = null;
      showError('第 ' + pageNumber + ' 页渲染失败：' + (error && error.message ? error.message : '未知错误'));
    }
  }

  async function headOk(url, timeout) {
    var controller = new AbortController();
    var timer = window.setTimeout(function () { controller.abort(); }, timeout || 6000);
    try {
      var response = await fetch(url, {
        method: 'HEAD',
        cache: 'no-store',
        signal: controller.signal,
      });
      return response.ok;
    } catch (error) {
      return false;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function resolvePdfUrl(book) {
    var localHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
    if (book.localPdf && (localHost || params.get('local') === '1')) {
      var localUrl = new URL(book.localPdf, window.location.href).href;
      if (await headOk(localUrl, 3000)) {
        state.local = true;
        return localUrl;
      }
    }
    var candidates = Array.isArray(book.mirrors) && book.mirrors.length
      ? book.mirrors.slice()
      : [book.pdf];
    els.loadingText.textContent = '正在选择最快的教材镜像…';
    for (var i = 0; i < candidates.length; i += 1) {
      if (await headOk(candidates[i], 6000)) {
        state.mirror = candidates[i] !== book.pdf;
        return candidates[i];
      }
    }
    return book.pdf;
  }

  function activeUnitNo() {
    if (!state.book) return '';
    var units = state.book.units.slice().sort(function (a, b) {
      return (a.page || Number.MAX_SAFE_INTEGER) - (b.page || Number.MAX_SAFE_INTEGER);
    });
    var active = units[0];
    units.forEach(function (unit) {
      if (unit.page && unit.page <= state.page) active = unit;
    });
    return active ? active.no : '';
  }

  function updateUnitGraph() {
    if (!els.unitGraph) return;
    if (!state.taxonomy || !state.book) {
      els.unitGraph.hidden = true;
      return;
    }
    var bookMap = state.taxonomy.books && state.taxonomy.books[state.book.id];
    var unitNo = activeUnitNo();
    var unit = bookMap && bookMap.units && bookMap.units[unitNo];
    if (!unit || !unit.topicIds || !unit.topicIds.length) {
      els.unitGraph.hidden = true;
      return;
    }
    var subject = state.book.subject;
    var topics = unit.topicIds.map(function (id) {
      return state.taxonomy.topics[id];
    }).filter(Boolean);
    if (!topics.length) {
      els.unitGraph.hidden = true;
      return;
    }
    var shown = topics.slice(0, 6);
    els.unitGraph.hidden = false;
    els.unitGraphCount.textContent = topics.length + ' 个知识点 · ' + unit.questionCount + ' 题';
    els.unitGraphTopics.innerHTML = shown.map(function (topic) {
      var href = '../cn-math-taxonomy/explore/?subject=' + encodeURIComponent(subject) +
        '&grade=5#' + encodeURIComponent(topic.id);
      return '<a class="unit-graph__topic" href="' + href + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="unit-graph__topic-copy"><b>' + escapeHtml(topic.name) + '</b>' +
        '<small>' + escapeHtml(topic.domain || '') + ' · ' + (topic.crossGrade ? '跨年级延伸' : '五年级') + '</small></span>' +
        (topic.crossGrade ? '<span class="unit-graph__badge">跨年级</span>' : '') +
        '<span class="unit-graph__count">' + topic.questionCount + ' 题</span>' +
      '</a>';
    }).join('');
    els.unitGraphNote.textContent = topics.length > shown.length
      ? '还有 ' + (topics.length - shown.length) + ' 个知识点，点「看知识图谱」查看全部。'
      : '知识点、先修关系和题库来自 cn-math-taxonomy；数值题在诊断页练习。';
    var first = topics[0];
    els.unitExplore.href = '../cn-math-taxonomy/explore/?subject=' + encodeURIComponent(subject) +
      '&grade=5#' + encodeURIComponent(first.id);
    var params = new URLSearchParams();
    if (subject !== 'math') params.set('subject', subject);
    params.set('target', unit.topicIds.join(','));
    els.unitDiagnose.href = '../cn-math-taxonomy/diagnose/?' + params.toString();
  }

  function buildTocFromManifest(book) {
    state.tocItems = book.units.filter(function (unit) { return unit.page; }).map(function (unit) {
      return { title: unit.no + ' ' + unit.title, page: unit.page };
    });
    els.toc.innerHTML = book.units.map(function (unit) {
      var lessons = unit.lessons && unit.lessons.length
        ? '<span class="toc__lessons">' + unit.lessons.map(escapeHtml).join(' · ') + '</span>'
        : '';
      var page = unit.page ? ' data-page="' + Number(unit.page) + '"' : '';
      return '<button type="button" class="toc__item toc__item--unit"' + page + '>' +
        '<span class="toc__no">' + escapeHtml(unit.no) + '</span>' +
        '<span class="toc__title">' + escapeHtml(unit.title) + '</span>' +
        lessons +
        (unit.inQuiz ? '<span class="toc__badge">期中范围</span>' : '') +
        '</button>';
    }).join('');
    els.tocHint.textContent = '按教材单元编排。PDF 书签可用时会自动换成原书目录。';
    Array.prototype.forEach.call(els.toc.querySelectorAll('[data-page]'), function (button) {
      button.addEventListener('click', function () {
        setPage(Number(button.dataset.page));
      });
    });
    highlightToc();
  }

  function buildTocFromOutline(items) {
    var visible = items.filter(function (item) {
      return item.title && item.page && item.depth <= 1;
    }).slice(0, 120);
    if (!visible.length) return false;
    state.tocItems = visible;
    els.toc.innerHTML = visible.map(function (item) {
      return '<button type="button" class="toc__item toc__item--depth-' + item.depth + '" data-page="' + item.page + '">' +
        '<span class="toc__title">' + escapeHtml(item.title) + '</span>' +
        '<span class="toc__page">' + item.page + '</span>' +
        '</button>';
    }).join('');
    els.tocHint.textContent = '目录来自 PDF 书签，点击可跳到对应页。';
    Array.prototype.forEach.call(els.toc.querySelectorAll('[data-page]'), function (button) {
      button.addEventListener('click', function () {
        setPage(Number(button.dataset.page));
      });
    });
    highlightToc();
    return true;
  }

  async function readOutline(pdf) {
    try {
      var outline = await pdf.getOutline();
      if (!outline || !outline.length) return [];
      var items = [];
      async function walk(nodes, depth) {
        for (var i = 0; i < nodes.length; i += 1) {
          var node = nodes[i];
          var page = null;
          try {
            var dest = node.dest;
            if (typeof dest === 'string') dest = await pdf.getDestination(dest);
            if (Array.isArray(dest) && dest.length) {
              var ref = dest[0];
              if (typeof ref === 'number') page = ref + 1;
              else if (ref) page = (await pdf.getPageIndex(ref)) + 1;
            }
          } catch (error) {
            page = null;
          }
          items.push({ title: String(node.title || '').trim(), page: page, depth: depth });
          if (node.items && node.items.length && depth < 1) {
            await walk(node.items, depth + 1);
          }
        }
      }
      await walk(outline, 0);
      return items;
    } catch (error) {
      return [];
    }
  }

  function openSidebar() {
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    els.side.classList.add('is-open');
    els.scrim.hidden = false;
    els.tocToggle.setAttribute('aria-expanded', 'true');
  }

  function closeSidebar() {
    els.side.classList.remove('is-open');
    els.scrim.hidden = true;
    els.tocToggle.setAttribute('aria-expanded', 'false');
  }

  function initialPage() {
    var hashMatch = /(?:^#|&)p=(\d+)/.exec(window.location.hash);
    if (hashMatch) return Number(hashMatch[1]);
    var queryPage = Number(params.get('page'));
    if (queryPage) return queryPage;
    var progress = readProgress();
    var saved = state.book ? progress[state.book.id] : null;
    return saved && saved.page ? Number(saved.page) : 1;
  }

  async function boot() {
    if (!window.pdfjsLib) {
      showError('PDF 阅读组件没有加载成功，请刷新页面重试。');
      return;
    }
    var taxonomyPromise = fetch('assets/taxonomy.json', { cache: 'no-cache' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .catch(function () { return null; });

    try {
      var response = await fetch('assets/books.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var data = await response.json();
      state.book = (data.books || []).filter(function (item) { return item.id === bookId; })[0];
      if (!state.book) throw new Error('没有找到这本教材，请从书架重新进入。');
    } catch (error) {
      showError(error && error.message ? error.message : '教材目录加载失败。');
      return;
    }

    var book = state.book;
    document.body.dataset.subject = book.subject;
    els.subject.textContent = book.label;
    els.subject.className = 'reader-subject reader-subject--' + book.subject;
    els.title.textContent = book.title;
    els.edition.textContent = book.edition + ' · ' + book.grade;
    els.pdfLink.href = book.pdf;
    els.errorOpen.href = book.pdf;
    els.sideSource.href = book.sourcePage || book.pdf;
    if (book.official) els.sideOfficial.href = book.official;
    buildTocFromManifest(book);
    state.taxonomy = await taxonomyPromise;
    updateUnitGraph();

    var pdfUrl = await resolvePdfUrl(book);
    els.localNote.textContent = state.local ? '正在读取本地副本' : (state.mirror ? '已使用加速镜像' : '');
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.js', window.location.href).href;

    try {
      var attempts = [pdfUrl];
      if (pdfUrl !== book.pdf) attempts.push(book.pdf);
      var lastError = null;
      for (var attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
        try {
          els.loadbar.style.width = '0%';
          els.loadingText.textContent = attemptIndex === 0 ? '正在打开教材…' : '镜像加载失败，正在回退…';
          var loadingTask = pdfjsLib.getDocument({
            url: attempts[attemptIndex],
          });
          loadingTask.onProgress = function (progress) {
            if (!progress || !progress.total) return;
            var percent = clamp(Math.round((progress.loaded / progress.total) * 100), 0, 100);
            els.loadingText.textContent = '正在打开教材… ' + percent + '%';
            els.loadbar.style.width = percent + '%';
          };
          state.pdf = await loadingTask.promise;
          if (attemptIndex > 0) els.localNote.textContent = '已回退到 GitHub Raw';
          break;
        } catch (error) {
          lastError = error;
          state.pdf = null;
        }
      }
      if (!state.pdf) throw lastError || new Error('PDF 加载失败');
      state.total = state.pdf.numPages;
      state.page = clamp(initialPage(), 1, state.total);
      updateControls();
      updateUnitGraph();

      var outlineItems = await readOutline(state.pdf);
      if (!buildTocFromOutline(outlineItems)) buildTocFromManifest(book);

      await renderCurrentPage();
      saveProgress();
      state.loading = false;
      els.loading.hidden = true;
      els.stage.classList.remove('is-rendering');
      updateControls();
    } catch (error) {
      showError('PDF 加载失败：' + (error && error.message ? error.message : '未知错误') +
        '。可以稍后重试，或点下面的按钮在新标签页打开原文件。');
    }
  }

  // 工具栏事件
  els.prev.addEventListener('click', function () { setPage(state.page - 1); });
  els.next.addEventListener('click', function () { setPage(state.page + 1); });
  els.pageInput.addEventListener('change', function () {
    setPage(Number(els.pageInput.value));
    els.pageInput.blur();
  });
  els.pageInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      setPage(Number(els.pageInput.value));
      els.pageInput.blur();
    }
  });
  els.zoomIn.addEventListener('click', function () {
    state.zoom = clamp(state.zoom * 1.15, 0.5, 4);
    renderCurrentPage();
  });
  els.zoomOut.addEventListener('click', function () {
    state.zoom = clamp(state.zoom / 1.15, 0.5, 4);
    renderCurrentPage();
  });
  els.fitPage.addEventListener('click', function () {
    state.fitMode = 'page';
    state.zoom = 1;
    renderCurrentPage();
    updateControls();
  });
  els.fitWidth.addEventListener('click', function () {
    state.fitMode = 'width';
    state.zoom = 1;
    renderCurrentPage();
    updateControls();
  });
  els.fullscreen.addEventListener('click', function () {
    var target = document.querySelector('.reader-main');
    if (!document.fullscreenElement) {
      if (target.requestFullscreen) target.requestFullscreen().catch(function () {});
    } else if (document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
  });
  els.tocToggle.addEventListener('click', function () {
    if (els.side.classList.contains('is-open')) closeSidebar();
    else openSidebar();
  });
  els.sideClose.addEventListener('click', closeSidebar);
  els.scrim.addEventListener('click', closeSidebar);

  window.addEventListener('keydown', function (event) {
    if (event.target && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      event.preventDefault();
      setPage(state.page - 1);
    } else if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
      event.preventDefault();
      setPage(state.page + 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setPage(1);
    } else if (event.key === 'End') {
      event.preventDefault();
      setPage(state.total);
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      els.zoomIn.click();
    } else if (event.key === '-') {
      event.preventDefault();
      els.zoomOut.click();
    }
  });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (!state.pdf) return;
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () { renderCurrentPage(); }, 180);
  });

  // 手势翻页
  var touchStartX = null;
  var touchStartY = null;
  els.stage.addEventListener('touchstart', function (event) {
    if (event.touches.length !== 1) return;
    touchStartX = event.touches[0].clientX;
    touchStartY = event.touches[0].clientY;
  }, { passive: true });
  els.stage.addEventListener('touchend', function (event) {
    if (touchStartX === null) return;
    var dx = event.changedTouches[0].clientX - touchStartX;
    var dy = event.changedTouches[0].clientY - touchStartY;
    touchStartX = null;
    touchStartY = null;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (dx < 0) setPage(state.page + 1);
    else setPage(state.page - 1);
  }, { passive: true });

  boot();
})();
