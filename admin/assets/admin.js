(function () {
  'use strict';

  var SUBJECTS = [
    { key: 'chinese', label: '语文', prefix: 'cn' },
    { key: 'math', label: '数学', prefix: 'ma' },
    { key: 'english', label: '英语', prefix: 'en' },
  ];
  var SUBJECT_MAP = {};
  SUBJECTS.forEach(function (item) { SUBJECT_MAP[item.key] = item; });
  var SOURCE_LABELS = {
    manual: '手动录入',
    generated: '程序生成',
    ai: 'AI 辅助',
    photo: '拍照配图',
    taxonomy: '知识图谱',
  };
  var DB_NAME = 'quiz-admin-db';
  var DB_STORE = 'bank';
  var DB_KEY = 'current';
  var LOCAL_KEY = 'quiz-admin-bank-v1';
  var OVERRIDE_KEY = 'quiz-bank-override-v1';
  var SETTINGS_KEY = 'quiz-admin-settings-v1';
  var PAGE_SIZE = 20;

  var state = {
    bank: null,
    baselineIds: [],
    baselineReady: false,
    db: null,
    loaded: false,
    filter: { subject: '', source: '', search: '', page: 1 },
    editing: null,
    figure: null,
    generator: null,
    aiPreview: [],
    importPreview: null,
    aiImage: null,
    taxonomy: null,
    taxonomyQuestions: [],
    settings: loadSettings(),
    toastTimer: null,
  };

  function $(selector) {
    return document.querySelector(selector);
  }

  function $$(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function subjectLabel(key) {
    return SUBJECT_MAP[key] ? SUBJECT_MAP[key].label : key;
  }

  function sourceLabel(source) {
    return SOURCE_LABELS[source] || SOURCE_LABELS.manual;
  }

  function toast(message, options) {
    var el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    el.classList.toggle('toast--error', Boolean(options && options.error));
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(function () {
      el.hidden = true;
    }, options && options.sticky ? 6000 : 2600);
  }

  function setSaveState(text, options) {
    var el = $('#save-state');
    el.textContent = text;
    el.classList.toggle('is-error', Boolean(options && options.error));
  }

  /* ---------- IndexedDB / localStorage ---------- */

  function openDb() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      var request = window.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { resolve(null); };
    });
  }

  function dbGet(db, key) {
    return new Promise(function (resolve) {
      if (!db) { resolve(null); return; }
      try {
        var tx = db.transaction(DB_STORE, 'readonly');
        var request = tx.objectStore(DB_STORE).get(key);
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { resolve(null); };
      } catch (error) {
        resolve(null);
      }
    });
  }

  function dbPut(db, key, value) {
    return new Promise(function (resolve) {
      if (!db) { resolve(false); return; }
      try {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(value, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      } catch (error) {
        resolve(false);
      }
    });
  }

  function readLocalBackup() {
    try {
      var raw = window.localStorage.getItem(LOCAL_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeLocalBackup(value) {
    try {
      window.localStorage.setItem(LOCAL_KEY, JSON.stringify(value));
    } catch (error) {
      /* 题库太大时只依赖 IndexedDB */
    }
  }

  function loadSettings() {
    try {
      var raw = window.localStorage.getItem(SETTINGS_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return {
        endpoint: parsed && parsed.endpoint ? parsed.endpoint : '',
        model: parsed && parsed.model ? parsed.model : '',
        visionModel: parsed && parsed.visionModel ? parsed.visionModel : '',
        apiKey: parsed && parsed.apiKey ? parsed.apiKey : '',
      };
    } catch (error) {
      return { endpoint: '', model: '', visionModel: '', apiKey: '' };
    }
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch (error) {
      /* 忽略 */
    }
  }

  /* ---------- 题库数据 ---------- */

  function defaultBank() {
    if (!window.QUIZ_BANK) return null;
    return clone(window.QUIZ_BANK);
  }

  function defaultIds(bank) {
    var ids = [];
    if (!bank) return ids;
    SUBJECTS.forEach(function (subject) {
      var list = bank[subject.key] && bank[subject.key].questions;
      if (Array.isArray(list)) list.forEach(function (q) { if (q && q.id) ids.push(q.id); });
    });
    return ids;
  }

  function normalizeQuestion(raw, fallbackSubject) {
    if (!raw || typeof raw !== 'object') return { error: '题目不是对象' };
    var subject = SUBJECT_MAP[raw.subject] ? raw.subject : fallbackSubject;
    if (!SUBJECT_MAP[subject]) return { error: '科目无效' };
    var point = String(raw.point || raw.knowledgePoint || '').trim();
    var text = String(raw.q || raw.question || raw.stem || '').trim();
    var options = Array.isArray(raw.options) ? raw.options.map(function (item) {
      if (item && typeof item === 'object') return String(item.text || item.label || '').trim();
      return String(item == null ? '' : item).trim();
    }) : [];
    var explain = raw.explain && typeof raw.explain === 'object' ? raw.explain.text : raw.explain;
    explain = String(explain || '').trim();
    var answer = raw.answer;
    if (typeof answer === 'string' && /^[A-Da-d]$/.test(answer.trim())) {
      answer = 'ABCD'.indexOf(answer.trim().toUpperCase());
    }
    if (typeof answer === 'string' && !/^\d+$/.test(answer)) {
      answer = options.indexOf(answer.trim());
    }
    if (typeof answer === 'string' && /^\d+$/.test(answer)) answer = Number(answer);
    if (!point) return { error: '缺少知识点' };
    if (!text) return { error: '缺少题干' };
    if (options.length < 3 || options.length > 4 || options.some(function (item) { return !item; })) return { error: '必须有 3–4 个非空选项' };
    if (new Set(options).size !== options.length) return { error: '选项重复' };
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) return { error: '答案下标无效' };
    if (!explain) return { error: '缺少解析' };
    var question = {
      id: String(raw.id || '').trim() || '',
      point: point,
      q: text,
      options: options,
      answer: answer,
      explain: explain,
      source: SOURCE_LABELS[raw.source] ? raw.source : 'manual',
    };
    if (raw.figure && raw.figure.src) {
      question.figure = {
        src: String(raw.figure.src),
        alt: String(raw.figure.alt || '题目配图'),
        caption: raw.figure.caption ? String(raw.figure.caption) : '',
      };
    }
    if (raw.source === 'generated' || raw.source === 'ai' || raw.source === 'photo' || raw.source === 'manual' || raw.source === 'taxonomy') {
      question.source = raw.source;
    }
    if (raw.taxonomy && raw.taxonomy.id) {
      question.taxonomy = {
        id: String(raw.taxonomy.id),
        topicId: String(raw.taxonomy.topicId || ''),
        difficulty: String(raw.taxonomy.difficulty || ''),
      };
    }
    if (raw.createdAt) question.createdAt = String(raw.createdAt);
    if (raw.generator) question.generator = String(raw.generator);
    return { question: question, subject: subject };
  }

  function normalizeBank(raw) {
    if (!raw || typeof raw !== 'object') return { error: '题库不是对象' };
    var bank = {};
    var errors = [];
    SUBJECTS.forEach(function (subject) {
      var source = raw[subject.key];
      if (!source || typeof source !== 'object' || !Array.isArray(source.questions)) {
        errors.push('缺少科目 ' + subject.label);
        return;
      }
      var merged = Object.assign({}, source);
      merged.questions = [];
      var seen = new Set();
      source.questions.forEach(function (item, index) {
        var result = normalizeQuestion(item, subject.key);
        if (result.error) {
          errors.push(subject.label + '第 ' + (index + 1) + ' 题：' + result.error);
          return;
        }
        var question = result.question;
        if (!question.id) question.id = makeId(subject.key, question.source, merged.questions);
        if (seen.has(question.id)) {
          question.id = makeId(subject.key, question.source, merged.questions);
        }
        seen.add(question.id);
        merged.questions.push(question);
      });
      bank[subject.key] = merged;
    });
    if (errors.length) return { error: errors.slice(0, 8).join('；') };
    return { bank: bank };
  }

  function allQuestions() {
    var list = [];
    if (!state.bank) return list;
    SUBJECTS.forEach(function (subject) {
      var items = state.bank[subject.key] && state.bank[subject.key].questions;
      if (Array.isArray(items)) {
        items.forEach(function (question) {
          list.push({ subject: subject.key, question: question });
        });
      }
    });
    return list;
  }

  function findQuestion(subject, id) {
    var list = state.bank && state.bank[subject] && state.bank[subject].questions;
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function idExists(id) {
    return allQuestions().some(function (item) { return item.question.id === id; });
  }

  function makeId(subject, source, currentList) {
    var prefix = SUBJECT_MAP[subject] ? SUBJECT_MAP[subject].prefix : 'q';
    var tag = { generated: 'g', ai: 'ai', photo: 'ph' }[source] || 'u';
    var base = prefix + '-' + tag + '-' + Date.now().toString(36);
    var id = base;
    var counter = 0;
    while (idExists(id) || (currentList && currentList.some(function (item) { return item.id === id; }))) {
      counter += 1;
      id = base + '-' + counter;
    }
    return id;
  }

  function saveBank() {
    if (!state.bank) return Promise.resolve();
    setSaveState('保存中…');
    var payload = {
      bank: state.bank,
      baselineIds: state.baselineIds,
      updatedAt: new Date().toISOString(),
    };
    writeLocalBackup(payload);
    try {
      if (state.loaded && window.localStorage.getItem(OVERRIDE_KEY)) {
        window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify({
          bank: state.bank,
          updatedAt: payload.updatedAt,
        }));
      }
    } catch (error) {
      /* 图片较多时可能超出 localStorage 配额，闯关仍可用旧覆盖 */
    }
    return dbPut(state.db, DB_KEY, payload).then(function (ok) {
      setSaveState(ok ? '本地草稿已保存' : '已保存到浏览器');
    });
  }

  function loadBank() {
    return openDb().then(function (db) {
      state.db = db;
      return dbGet(db, DB_KEY).then(function (stored) {
        var fallback = stored || readLocalBackup();
        if (fallback && fallback.bank) {
          var normalized = normalizeBank(fallback.bank);
          if (!normalized.error) {
            state.bank = normalized.bank;
            state.baselineIds = Array.isArray(fallback.baselineIds) ? fallback.baselineIds : defaultIds(defaultBank());
            state.baselineReady = true;
            return;
          }
        }
        var initial = defaultBank();
        if (!initial) throw new Error('找不到默认题库 window.QUIZ_BANK');
        state.bank = initial;
        state.baselineIds = defaultIds(initial);
        state.baselineReady = true;
        return saveBank();
      });
    });
  }

  /* ---------- 统计与列表 ---------- */

  function renderStats() {
    var all = allQuestions();
    var counts = { chinese: 0, math: 0, english: 0 };
    all.forEach(function (item) { counts[item.subject] += 1; });
    $('#stat-total').textContent = all.length;
    $('#stat-chinese').textContent = counts.chinese;
    $('#stat-math').textContent = counts.math;
    $('#stat-english').textContent = counts.english;
    var baseline = new Set(state.baselineIds);
    var added = all.filter(function (item) { return !baseline.has(item.question.id); }).length;
    $('#stat-local').textContent = added;
    $('#export-count').textContent = all.length + ' 题';
    $('#list-count').textContent = all.length + ' 题';
  }

  function filteredQuestions() {
    var search = state.filter.search.trim().toLowerCase();
    var list = allQuestions().filter(function (item) {
      var q = item.question;
      if (state.filter.subject && item.subject !== state.filter.subject) return false;
      var source = q.source || 'manual';
      if (state.filter.source && source !== state.filter.source) return false;
      if (search) {
        var haystack = [q.q, q.point, q.id, q.explain].join(' ').toLowerCase();
        if (haystack.indexOf(search) === -1) return false;
      }
      return true;
    });
    // 新录入/生成的题排在最前面，方便保存后马上看到；原有题库保持原顺序。
    list.sort(function (a, b) {
      var aTime = a.question.createdAt || '';
      var bTime = b.question.createdAt || '';
      if (aTime && bTime) return bTime.localeCompare(aTime);
      if (aTime) return -1;
      if (bTime) return 1;
      return 0;
    });
    return list;
  }

  function renderList() {
    var list = filteredQuestions();
    var totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.filter.page > totalPages) state.filter.page = totalPages;
    var start = (state.filter.page - 1) * PAGE_SIZE;
    var pageItems = list.slice(start, start + PAGE_SIZE);
    var container = $('#question-list');
    var empty = $('#list-empty');
    var pager = $('#list-pager');

    if (!list.length) {
      container.innerHTML = '';
      empty.hidden = false;
      pager.hidden = true;
      $('#list-count').textContent = '0 题';
      return;
    }
    empty.hidden = true;
    pager.hidden = totalPages <= 1;
    $('#list-page').textContent = '第 ' + state.filter.page + ' / ' + totalPages + ' 页';
    $('#list-prev').disabled = state.filter.page <= 1;
    $('#list-next').disabled = state.filter.page >= totalPages;
    $('#list-count').textContent = list.length + ' 题';

    container.innerHTML = pageItems.map(function (item) {
      var q = item.question;
      var options = q.options.map(function (option, index) {
        return '<span class="q-row__option" title="' + escapeHtml(option) + '">' +
          'ABCD'[index] + '. ' + escapeHtml(option) + '</span>';
      }).join('');
      return '<article class="q-row" data-subject="' + item.subject + '" data-id="' + escapeHtml(q.id) + '">' +
        '<div class="q-row__main">' +
          '<div class="q-row__meta">' +
            '<span class="subject-pill subject-pill--' + item.subject + '">' + subjectLabel(item.subject) + '</span>' +
            '<span class="q-row__point">' + escapeHtml(q.point) + '</span>' +
            '<span class="q-row__source q-row__source--' + escapeHtml(q.source || 'manual') + '">' + sourceLabel(q.source) + '</span>' +
            (q.figure ? '<span class="q-row__figure">🖼 配图</span>' : '') +
            '<code class="q-row__id">' + escapeHtml(q.id) + '</code>' +
          '</div>' +
          '<p class="q-row__text">' + escapeHtml(q.q) + '</p>' +
          '<div class="q-row__options">' + options + '</div>' +
        '</div>' +
        '<div class="q-row__actions">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-action="edit">编辑</button>' +
          '<button type="button" class="btn btn--danger btn--sm" data-action="delete">删除</button>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function renderPointDatalist() {
    var points = {};
    allQuestions().forEach(function (item) {
      if (item.question.point) points[item.question.point] = true;
    });
    $('#point-options').innerHTML = Object.keys(points).sort().map(function (point) {
      return '<option value="' + escapeHtml(point) + '"></option>';
    }).join('');
  }

  function renderAll() {
    renderStats();
    renderList();
    renderPointDatalist();
  }

  /* ---------- 标签页 ---------- */

  function switchTab(name) {
    var tabs = $$('.admin-tab');
    var panels = $$('.admin-panel');
    tabs.forEach(function (tab) {
      var active = tab.dataset.tab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    panels.forEach(function (panel) {
      var active = panel.id === 'panel-' + name;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
    if (window.location.hash !== '#' + name) {
      try { window.history.replaceState(null, '', '#' + name); } catch (error) { /* 忽略 */ }
    }
    if (name === 'taxonomy') loadTaxonomyPanel();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- 题目表单 ---------- */

  function clearFigure() {
    state.figure = null;
    $('#form-figure').value = '';
    $('#form-figure-preview').hidden = true;
    $('#alt-field').hidden = true;
    $('#form-figure-alt').value = '';
    $('#form-figure-clear').hidden = true;
    $('#figure-hint').textContent = '支持 JPG / PNG / WebP，自动压缩到 1600px';
  }

  function showFigure(src, alt) {
    state.figure = { src: src, alt: alt || '' };
    $('#form-figure-img').src = src;
    $('#form-figure-preview').hidden = false;
    $('#alt-field').hidden = false;
    $('#form-figure-clear').hidden = false;
    $('#form-figure-alt').value = alt || '';
    $('#figure-hint').textContent = '图片已就绪；如不需要可移除';
  }

  function newQuestion(options) {
    var keepSubject = options && options.keepSubject ? $('#form-subject').value : 'chinese';
    state.editing = null;
    $('#form-title').textContent = '新增题目';
    $('#form-mode').textContent = '新题';
    $('#form-id').value = '';
    $('#form-id-display').value = '';
    $('#form-subject').value = keepSubject;
    $('#form-point').value = '';
    $('#form-question').value = '';
    $('#form-option-a').value = '';
    $('#form-option-b').value = '';
    $('#form-option-c').value = '';
    $('#form-option-d').value = '';
    $('#form-answer').value = '0';
    $('#form-explain').value = '';
    $('#form-source').value = 'manual';
    $('#form-delete').hidden = true;
    $('#form-cancel').hidden = true;
    $('#form-save').textContent = '保存题目';
    clearFigure();
    $('#form-error').hidden = true;
  }

  function editQuestion(subject, id) {
    var question = findQuestion(subject, id);
    if (!question) return;
    state.editing = { subject: subject, id: id };
    $('#form-title').textContent = '编辑题目';
    $('#form-mode').textContent = '编辑中';
    $('#form-id').value = question.id;
    $('#form-id-display').value = question.id;
    $('#form-subject').value = subject;
    $('#form-point').value = question.point || '';
    $('#form-question').value = question.q || '';
    $('#form-option-a').value = question.options[0] || '';
    $('#form-option-b').value = question.options[1] || '';
    $('#form-option-c').value = question.options[2] || '';
    $('#form-option-d').value = question.options[3] || '';
    $('#form-answer').value = String(question.answer || 0);
    $('#form-explain').value = question.explain || '';
    $('#form-source').value = question.source || 'manual';
    $('#form-delete').hidden = false;
    $('#form-cancel').hidden = false;
    $('#form-save').textContent = '保存修改';
    clearFigure();
    if (question.figure && question.figure.src) {
      showFigure(question.figure.src, question.figure.alt || '题目配图');
    }
    $('#form-error').hidden = true;
    switchTab('form');
  }

  function readForm() {
    var subject = $('#form-subject').value;
    var point = $('#form-point').value.trim();
    var text = $('#form-question').value.trim();
    var rawOptions = ['a', 'b', 'c', 'd'].map(function (letter) {
      return $('#form-option-' + letter).value.trim();
    });
    var options = rawOptions.slice(0, 3);
    if (rawOptions[3]) options.push(rawOptions[3]);
    var answer = Number($('#form-answer').value);
    var explain = $('#form-explain').value.trim();
    var source = $('#form-source').value;
    var errors = [];
    if (!SUBJECT_MAP[subject]) errors.push('请选择科目');
    if (!point) errors.push('请填写知识点');
    if (!text) errors.push('请填写题干');
    if (!rawOptions[0] || !rawOptions[1] || !rawOptions[2]) errors.push('至少填写 A、B、C 三个选项');
    if (new Set(options).size !== options.length) errors.push('选项不能重复');
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) errors.push('答案下标无效');
    if (!explain) errors.push('请填写解析');
    if (state.figure && state.figure.src.length > 900000) errors.push('图片太大，请换一张更小的图片');
    if (errors.length) return { errors: errors };
    var question = {
      point: point,
      q: text,
      options: options,
      answer: answer,
      explain: explain,
      source: SOURCE_LABELS[source] ? source : 'manual',
    };
    if (state.figure && state.figure.src) {
      question.figure = {
        src: state.figure.src,
        alt: ($('#form-figure-alt').value.trim() || '题目配图'),
      };
    }
    return { question: question };
  }

  function saveForm(continueNext) {
    var result = readForm();
    var errorEl = $('#form-error');
    if (result.errors) {
      errorEl.hidden = false;
      errorEl.innerHTML = result.errors.map(escapeHtml).join('<br>');
      return;
    }
    errorEl.hidden = true;
    var subject = $('#form-subject').value;
    var question = result.question;
    var editing = state.editing;
    if (editing) {
      var existing = findQuestion(editing.subject, editing.id);
      if (!existing) {
        toast('原题已不存在，已改为新增', { error: true });
        editing = null;
      }
    }
    if (editing) {
      var oldSubject = editing.subject;
      var target = findQuestion(oldSubject, editing.id);
      var index = state.bank[oldSubject].questions.indexOf(target);
      // 允许改科目：先从旧科目移除，再放入新科目
      if (oldSubject !== subject) {
        state.bank[oldSubject].questions.splice(index, 1);
        question.id = editing.id;
        question.createdAt = target.createdAt || new Date().toISOString();
        if (target.taxonomy) question.taxonomy = target.taxonomy;
        if (target.figure && !question.figure) question.figure = target.figure;
        state.bank[subject].questions.push(question);
      } else {
        question = Object.assign({}, target, question);
        if (target.figure && !question.figure) delete question.figure;
        state.bank[subject].questions[index] = question;
      }
      toast('已保存修改');
    } else {
      question.id = makeId(subject, question.source);
      question.createdAt = new Date().toISOString();
      state.bank[subject].questions.push(question);
      toast('已加入题库，共 ' + allQuestions().length + ' 题');
    }
    state.editing = null;
    state.filter.page = 1;
    saveBank();
    renderAll();
    if (continueNext) {
      newQuestion({ keepSubject: true });
      $('#form-point').focus();
    } else {
      newQuestion();
      switchTab('list');
    }
  }

  function deleteQuestion(subject, id) {
    var question = findQuestion(subject, id);
    if (!question) return;
    if (!window.confirm('确定删除这道题吗？\n\n' + question.q)) return;
    state.bank[subject].questions = state.bank[subject].questions.filter(function (item) { return item.id !== id; });
    if (state.editing && state.editing.id === id) {
      state.editing = null;
      newQuestion();
    }
    saveBank();
    renderAll();
    toast('已删除');
  }

  /* ---------- 图片压缩 ---------- */

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('图片读取失败')); };
      reader.readAsDataURL(file);
    });
  }

  function compressImage(file, maxSize) {
    return fileToDataUrl(file).then(function (dataUrl) {
      return new Promise(function (resolve) {
        var image = new Image();
        image.onload = function () {
          var scale = Math.min(1, maxSize / Math.max(image.width, image.height));
          var width = Math.max(1, Math.round(image.width * scale));
          var height = Math.max(1, Math.round(image.height * scale));
          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.84));
        };
        image.onerror = function () { resolve(dataUrl); };
        image.src = dataUrl;
      });
    });
  }

  function handleFigureFile(file) {
    if (!file) return;
    compressImage(file, 1600).then(function (dataUrl) {
      showFigure(dataUrl, '');
      $('#form-figure-alt').focus();
    }).catch(function (error) {
      toast(error.message || '图片处理失败', { error: true });
    });
  }

  /* ---------- 程序生成 ---------- */

  function renderGeneratorPreview(question) {
    var stage = $('#generate-stage');
    if (!question) {
      stage.innerHTML = '<p class="placeholder-note">选一个题型，点「换一题」预览。</p>';
      return;
    }
    state.generator = question;
    stage.innerHTML = '<article class="preview-card preview-card--generated">' +
      '<div class="preview-card__head"><span class="subject-pill subject-pill--math">数学</span>' +
      '<span class="q-row__point">' + escapeHtml(question.point) + '</span><span class="q-row__source q-row__source--generated">程序生成</span></div>' +
      '<p class="preview-card__q">' + escapeHtml(question.q) + '</p>' +
      '<div class="preview-card__options">' + question.options.map(function (option, index) {
        return '<span class="preview-option' + (index === question.answer ? ' is-answer' : '') + '">' +
          'ABCD'[index] + '. ' + escapeHtml(option) + (index === question.answer ? ' ✓' : '') + '</span>';
      }).join('') + '</div>' +
      '<p class="preview-card__explain"><b>解析：</b>' + escapeHtml(question.explain) + '</p>' +
      '<div class="preview-card__actions">' +
        '<button type="button" class="btn btn--primary btn--sm" data-preview-action="add">加入题库</button>' +
        '<button type="button" class="btn btn--ghost btn--sm" data-preview-action="edit">编辑后加入</button>' +
        '<button type="button" class="btn btn--ghost btn--sm" data-preview-action="next">换一题</button>' +
      '</div>' +
    '</article>';
  }

  function generateNew() {
    if (!window.QuizGenerators) {
      toast('生成器没有加载成功', { error: true });
      return;
    }
    var kind = $('#generator-kind').value;
    renderGeneratorPreview(QuizGenerators.generate(kind));
  }

  function addGenerated() {
    if (!state.generator) {
      generateNew();
      return;
    }
    var question = state.generator;
    question.id = makeId('math', 'generated');
    question.createdAt = new Date().toISOString();
    state.bank.math.questions.push(question);
    saveBank();
    renderAll();
    toast('已加入：' + question.q);
    generateNew();
  }

  function addGeneratedFive() {
    var kind = $('#generator-kind').value;
    var added = 0;
    var attempts = 0;
    var existing = new Set(allQuestions().map(function (item) { return item.question.q; }));
    while (added < 5 && attempts < 60) {
      attempts += 1;
      var question = QuizGenerators.generate(kind);
      if (existing.has(question.q)) continue;
      question.id = makeId('math', 'generated');
      question.createdAt = new Date().toISOString();
      state.bank.math.questions.push(question);
      existing.add(question.q);
      added += 1;
    }
    saveBank();
    renderAll();
    toast('已连续加入 ' + added + ' 道数学题');
  }

  /* ---------- AI 辅助 ---------- */

  var SUBJECT_PROMPTS = {
    chinese: '范围是统编版五年级上册第 1–4 单元：字词、古诗文、课文理解、修辞手法、说明方法和语言运用。',
    math: '范围是人教版五年级上册：小数乘法、小数除法、简便运算、位置（数对）和解决问题。',
    english: '范围是 PEP 五年级上册 Unit 1–3：人物、星期、食物相关词汇、句型和情景交际。',
  };

  function buildPrompt() {
    var subject = $('#ai-subject').value;
    var point = $('#ai-point').value.trim() || '不限，覆盖本册重点';
    var count = $('#ai-count').value;
    var extra = $('#ai-extra').value.trim();
    return [
      '你是一位小学五年级老师，正在为家庭学习题库出题。',
      '科目：' + subjectLabel(subject) + '。' + SUBJECT_PROMPTS[subject],
      '知识点：' + point + '。',
      '请出 ' + count + ' 道四选一选择题，难度适合五年级上学期，不要超纲。',
      '每道题必须有且只有 1 个正确答案、4 个互不相同的选项，并提供简洁中文解析。',
      '题干和选项不要出现“以上都对”“以上都不对”这类选项。',
      extra ? '额外要求：' + extra : '',
      '',
      '只输出 JSON，不要 Markdown 代码块，不要解释。格式：',
      '{"questions":[{"point":"知识点","q":"题干","options":["选项A","选项B","选项C","选项D"],"answer":0,"explain":"解析"}]}',
      'answer 是正确选项的下标（0–3）。',
    ].filter(Boolean).join('\n');
  }

  function refreshPrompt() {
    $('#ai-prompt').value = buildPrompt();
  }

  function extractJson(text) {
    var raw = String(text || '').trim();
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      return JSON.parse(raw);
    } catch (error) {
      /* 继续尝试截取 */
    }
    var start = raw.indexOf('{');
    var end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.parse(raw.slice(start, end + 1)); } catch (error) { /* 继续 */ }
    }
    start = raw.indexOf('[');
    end = raw.lastIndexOf(']');
    if (start !== -1 && end > start) {
      try { return JSON.parse(raw.slice(start, end + 1)); } catch (error) { /* 继续 */ }
    }
    throw new Error('AI 返回的内容不是有效 JSON');
  }

  function normalizeAiBatch(raw, subject, source) {
    var list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.questions) ? raw.questions : null);
    if (!list) throw new Error('JSON 里没有 questions 数组');
    var questions = [];
    var errors = [];
    list.forEach(function (item, index) {
      var result = normalizeQuestion(item, subject);
      if (result.error) {
        errors.push('第 ' + (index + 1) + ' 题：' + result.error);
        return;
      }
      var question = result.question;
      var questionSubject = result.subject || subject;
      question.source = source || 'ai';
      question.id = makeId(questionSubject, question.source, questions);
      questions.push({ subject: questionSubject, question: question });
    });
    if (!questions.length) throw new Error(errors.slice(0, 3).join('；') || '没有可用题目');
    return { questions: questions, errors: errors };
  }

  function renderAiPreview(items) {
    state.aiPreview = items;
    var container = $('#ai-result');
    if (!items.length) {
      container.innerHTML = '<p class="placeholder-note">生成或解析后，题目会出现在这里。</p>';
      $('#ai-result-actions').hidden = true;
      return;
    }
    $('#ai-result-actions').hidden = false;
    container.innerHTML = items.map(function (item, index) {
      var q = item.question;
      var subjectOptions = SUBJECTS.map(function (subject) {
        return '<option value="' + subject.key + '"' + (subject.key === item.subject ? ' selected' : '') + '>' +
          subject.label + '</option>';
      }).join('');
      return '<article class="preview-card" data-ai-index="' + index + '">' +
        '<div class="preview-card__head"><select class="ai-subject-select" data-ai-subject data-ai-index="' + index + '" aria-label="题目科目">' +
        subjectOptions + '</select><span class="q-row__point">' + escapeHtml(q.point) + '</span>' +
        '<span class="q-row__source q-row__source--ai">AI 待入库</span></div>' +
        '<p class="preview-card__q">' + escapeHtml(q.q) + '</p>' +
        '<div class="preview-card__options">' + q.options.map(function (option, optionIndex) {
          return '<span class="preview-option' + (optionIndex === q.answer ? ' is-answer' : '') + '">' +
            'ABCD'[optionIndex] + '. ' + escapeHtml(option) + (optionIndex === q.answer ? ' ✓' : '') + '</span>';
        }).join('') + '</div>' +
        '<p class="preview-card__explain"><b>解析：</b>' + escapeHtml(q.explain) + '</p>' +
        '<div class="preview-card__actions">' +
          '<button type="button" class="btn btn--primary btn--sm" data-ai-action="add" data-ai-index="' + index + '">加入题库</button>' +
          '<button type="button" class="btn btn--ghost btn--sm" data-ai-action="drop" data-ai-index="' + index + '">舍弃</button>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function addAiItem(index) {
    var item = state.aiPreview[index];
    if (!item) return;
    var subject = item.subject;
    if (!state.bank[subject]) return;
    item.question.id = makeId(subject, item.question.source || 'ai');
    item.question.createdAt = new Date().toISOString();
    if (state.bank[subject].questions.some(function (q) { return q.q === item.question.q; })) {
      toast('这道题已经在题库里了', { error: true });
      return;
    }
    state.bank[subject].questions.push(item.question);
    state.aiPreview.splice(index, 1);
    saveBank();
    renderAll();
    renderAiPreview(state.aiPreview);
    toast('已加入题库');
  }

  async function callAi(messages, model) {
    var settings = state.settings;
    if (!settings.endpoint) throw new Error('请先在「设置」里填写 API 地址');
    if (!settings.apiKey) throw new Error('请先在「设置」里填写 API Key');
    var response;
    try {
      response = await fetch(settings.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + settings.apiKey,
        },
        body: JSON.stringify({
          model: model || settings.model || 'gpt-4o-mini',
          messages: messages,
          temperature: 0.4,
        }),
      });
    } catch (error) {
      throw new Error('请求失败（可能是网络或 CORS 限制）：' + error.message);
    }
    if (!response.ok) {
      var detail = '';
      try {
        var errorBody = await response.json();
        detail = errorBody && errorBody.error && errorBody.error.message ? errorBody.error.message : '';
      } catch (error) {
        detail = await response.text().catch(function () { return ''; });
      }
      throw new Error('AI 接口返回 ' + response.status + (detail ? '：' + detail : ''));
    }
    var data = await response.json();
    var content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    if (Array.isArray(content)) {
      content = content.map(function (part) { return part.text || ''; }).join('');
    }
    if (!content) throw new Error('AI 没有返回内容');
    return content;
  }

  async function aiGenerate() {
    var subject = $('#ai-subject').value;
    var status = $('#ai-status');
    var prompt = buildPrompt();
    $('#ai-prompt').value = prompt;
    status.textContent = '正在请求 AI…';
    status.classList.remove('is-error');
    try {
      var content = await callAi([
        { role: 'system', content: '你是小学题库编辑，只输出 JSON。' },
        { role: 'user', content: prompt },
      ]);
      var parsed = normalizeAiBatch(extractJson(content), subject, 'ai');
      renderAiPreview(parsed.questions);
      status.textContent = '已生成 ' + parsed.questions.length + ' 题，请逐题核对后加入。' +
        (parsed.errors.length ? ' 有 ' + parsed.errors.length + ' 题格式不完整已跳过。' : '');
    } catch (error) {
      status.textContent = error.message;
      status.classList.add('is-error');
    }
  }

  function aiParsePaste() {
    var text = $('#ai-paste').value.trim();
    var status = $('#ai-parse-status');
    if (!text) {
      status.textContent = '先把 AI 返回的 JSON 粘贴进来。';
      status.classList.add('is-error');
      return;
    }
    try {
      var subject = $('#ai-subject').value;
      var parsed = normalizeAiBatch(extractJson(text), subject, 'ai');
      renderAiPreview(parsed.questions);
      status.textContent = '解析出 ' + parsed.questions.length + ' 题，请核对答案后加入。' +
        (parsed.errors.length ? ' 有 ' + parsed.errors.length + ' 题被跳过。' : '');
      status.classList.remove('is-error');
      switchTab('ai');
    } catch (error) {
      status.textContent = error.message;
      status.classList.add('is-error');
    }
  }

  function aiAddAll() {
    if (!state.aiPreview.length) return;
    var added = 0;
    var copy = state.aiPreview.slice();
    copy.forEach(function (item) {
      var subject = item.subject;
      if (!state.bank[subject]) return;
      if (state.bank[subject].questions.some(function (q) { return q.q === item.question.q; })) return;
      item.question.id = makeId(subject, item.question.source || 'ai');
      item.question.createdAt = new Date().toISOString();
      state.bank[subject].questions.push(item.question);
      added += 1;
    });
    state.aiPreview = [];
    saveBank();
    renderAll();
    renderAiPreview([]);
    toast(added ? '已加入 ' + added + ' 道题' : '没有新的题目可加入', { error: !added });
  }

  async function visionGenerate() {
    var status = $('#vision-status');
    if (!state.aiImage) {
      status.textContent = '先选择一张题目照片。';
      status.classList.add('is-error');
      return;
    }
    status.textContent = '正在识图…';
    status.classList.remove('is-error');
    var subject = $('#ai-subject').value;
    var prompt = '请把这张小学' + subjectLabel(subject) + '题目照片转成题库 JSON。' +
      '只输出 JSON，不要 Markdown。格式：' +
      '{"questions":[{"point":"知识点","q":"题干","options":["A","B","C","D"],"answer":0,"explain":"解析"}]}。' +
      '如果一张图里有多道题，请分别列出；看不清的字段不要编造，宁可少输出。';
    try {
      var content = await callAi([
        { role: 'system', content: '你是小学题目识别助手，只输出 JSON。' },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: state.aiImage } },
          ],
        },
      ], state.settings.visionModel || state.settings.model);
      var parsed = normalizeAiBatch(extractJson(content), subject, 'photo');
      parsed.questions.forEach(function (item) {
        if (!item.question.figure && state.aiImage) {
          item.question.figure = { src: state.aiImage, alt: '题目照片' };
        }
      });
      renderAiPreview(parsed.questions);
      status.textContent = '识别出 ' + parsed.questions.length + ' 题，请重点核对数字、单位和答案。';
      switchTab('ai');
      $('#ai-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      status.textContent = error.message;
      status.classList.add('is-error');
    }
  }

  /* ---------- 导入导出 ---------- */

  function bankToJs(bank) {
    return '/*\n' +
      ' * 五年级上学期闯关 · 题库\n' +
      ' * 由「题库工作台」导出：' + new Date().toISOString() + '\n' +
      ' * 格式与 assets/questions.js 一致，替换后运行 node scripts/check-questions.mjs 自检。\n' +
      ' */\n' +
      'window.QUIZ_BANK = ' + JSON.stringify(bank, null, 2) + ';\n';
  }

  function bankToJson(bank) {
    return JSON.stringify(bank, null, 2) + '\n';
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy') ? resolve() : reject(new Error('复制失败'));
      } catch (error) {
        reject(error);
      } finally {
        area.remove();
      }
    });
  }

  function parseBankText(text) {
    var raw = String(text || '').trim();
    if (!raw) throw new Error('内容为空');
    var parsed;
    if (raw.charAt(0) === '[') {
      parsed = JSON.parse(raw);
    } else if (raw.charAt(0) === '{' && raw.indexOf('window.QUIZ_BANK') === -1) {
      parsed = JSON.parse(raw);
    } else {
      var sandbox = { window: {} };
      var fn = new Function('window', raw + '\n;return window.QUIZ_BANK;');
      parsed = fn(sandbox.window);
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('没有找到题库对象');
    var normalized = normalizeBank(parsed);
    if (normalized.error) throw new Error(normalized.error);
    return normalized.bank;
  }

  function importPreview(bank) {
    var counts = {};
    SUBJECTS.forEach(function (subject) {
      counts[subject.key] = bank[subject.key].questions.length;
    });
    state.importPreview = bank;
    $('#io-preview').innerHTML = '<div class="import-summary">' +
      SUBJECTS.map(function (subject) {
        return '<span class="subject-pill subject-pill--' + subject.key + '">' + subject.label + ' ' + counts[subject.key] + ' 题</span>';
      }).join('') +
      '<span class="import-total">共 ' + (counts.chinese + counts.math + counts.english) + ' 题</span></div>' +
      '<p class="placeholder-note">确认后选择「合并导入」（同题号覆盖）或「替换题库」（丢弃当前本地题库）。</p>';
    $('#io-import-actions').hidden = false;
    $('#io-status').textContent = '解析成功，请确认导入方式。';
    $('#io-status').classList.remove('is-error');
  }

  function applyToQuiz() {
    if (!state.bank) return;
    try {
      window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify({
        bank: state.bank,
        updatedAt: new Date().toISOString(),
      }));
      $('#apply-status').textContent = '已应用到本机闯关。打开首页即可看到新题；换设备或清缓存后失效。';
      $('#apply-status').classList.remove('is-error');
      toast('已应用，去首页试试新题');
    } catch (error) {
      $('#apply-status').textContent = '保存失败（浏览器存储空间不足）：' + error.message;
      $('#apply-status').classList.add('is-error');
    }
  }

  function resetBank() {
    if (!window.confirm('恢复默认题库会丢弃当前本地草稿（导出的文件不受影响）。继续吗？')) return;
    var initial = defaultBank();
    if (!initial) return;
    state.bank = initial;
    state.baselineIds = defaultIds(initial);
    state.editing = null;
    newQuestion();
    try { window.localStorage.removeItem(OVERRIDE_KEY); } catch (error) { /* 忽略 */ }
    saveBank();
    renderAll();
    toast('已恢复默认题库');
  }

  /* ---------- 设置 ---------- */

  function renderSettings() {
    $('#set-endpoint').value = state.settings.endpoint;
    $('#set-model').value = state.settings.model;
    $('#set-vision-model').value = state.settings.visionModel;
    $('#set-key').value = state.settings.apiKey;
    var configured = Boolean(state.settings.endpoint && state.settings.apiKey);
    $('#settings-state').textContent = configured
      ? '已配置：' + (state.settings.model || '未填模型') + '。Key 只保存在本机浏览器。'
      : '尚未配置 AI。可以先用「复制提示词」把题目交给任意 AI，再把 JSON 粘贴回来。';
    $('#settings-state').classList.toggle('is-ok', configured);
  }

  /* ---------- 事件绑定 ---------- */

  function generatorKinds() {
    return window.QuizGenerators ? QuizGenerators.listKinds() : [];
  }

  function updateGeneratorHint() {
    var kind = $('#generator-kind').value;
    var found = generatorKinds().filter(function (item) { return item.key === kind; })[0];
    $('#generator-hint').textContent = found ? found.hint : '';
  }

  /* ---------- 知识图谱题库 ---------- */

  function taxonomyReady() {
    return Boolean(state.taxonomy && Array.isArray(state.taxonomyQuestions));
  }

  function taxonomyBookId(subject) {
    return state.taxonomy && state.taxonomy.subjects[subject]
      ? state.taxonomy.subjects[subject].bookId
      : '';
  }

  function populateTaxonomyUnits() {
    var select = $('#tax-unit');
    var subject = $('#tax-subject').value;
    var bookId = taxonomyBookId(subject);
    var previous = select.value;
    select.innerHTML = '<option value="">全部单元</option>';
    if (!state.taxonomy || !bookId || !state.taxonomy.books[bookId]) return;
    Object.keys(state.taxonomy.books[bookId].units).forEach(function (unitNo) {
      var unit = state.taxonomy.books[bookId].units[unitNo];
      var option = document.createElement('option');
      option.value = unitNo;
      option.textContent = unitNo + ' · ' + unit.topicIds.length + ' 个知识点 / ' + unit.questionCount + ' 题';
      select.appendChild(option);
    });
    if (previous && state.taxonomy.books[bookId].units[previous]) select.value = previous;
  }

  function loadTaxonomyPanel() {
    if (taxonomyReady()) {
      populateTaxonomyUnits();
      renderTaxonomy();
      return;
    }
    $('#tax-list').innerHTML = '<p class="placeholder-note">正在从 cn-math-taxonomy 读取知识点和题库…</p>';
    $('#tax-status').textContent = '';
    Promise.all([
      fetch('../textbooks/assets/taxonomy.json').then(function (response) {
        if (!response.ok) throw new Error('taxonomy.json HTTP ' + response.status);
        return response.json();
      }),
      fetch('../textbooks/assets/taxonomy-questions.json').then(function (response) {
        if (!response.ok) throw new Error('taxonomy-questions.json HTTP ' + response.status);
        return response.json();
      }),
    ]).then(function (results) {
      state.taxonomy = results[0];
      state.taxonomyQuestions = results[1].questions || [];
      populateTaxonomyUnits();
      renderTaxonomy();
    }).catch(function (error) {
      $('#tax-list').innerHTML = '<p class="placeholder-note">知识图谱数据加载失败：' + escapeHtml(error.message) +
        '<br>请先运行 <code>node scripts/build-taxonomy-bridge.mjs</code>。</p>';
      $('#tax-status').textContent = '';
    });
  }

  function taxonomyAnswerIndex(question) {
    if (!Array.isArray(question.choices)) return -1;
    var answer = String(question.answer || '').trim();
    var byKey = question.choices.findIndex(function (choice) {
      return String(choice.key || '').trim().toUpperCase() === answer.toUpperCase();
    });
    if (byKey !== -1) return byKey;
    var byText = question.choices.findIndex(function (choice) {
      return String(choice.text || '').trim() === answer;
    });
    if (byText !== -1) return byText;
    var byLetter = 'ABCD'.indexOf(answer.toUpperCase());
    return byLetter !== -1 ? byLetter : -1;
  }

  function taxonomyImported(id) {
    return allQuestions().some(function (item) {
      return (item.question.taxonomy && item.question.taxonomy.id === id) || item.question.id === 'tax-' + id;
    });
  }

  function taxonomyDiagnoseHref(subject) {
    var base = '../cn-math-taxonomy/diagnose/';
    return subject === 'math' ? base : base + '?subject=' + encodeURIComponent(subject);
  }

  function filteredTaxonomy() {
    var subject = $('#tax-subject').value;
    var type = $('#tax-type').value;
    var difficulty = $('#tax-difficulty').value;
    var search = $('#tax-search').value.trim().toLowerCase();
    var bookId = taxonomyBookId(subject);
    var unitNo = $('#tax-unit').value;
    var allowedTopics = null;
    if (unitNo && bookId && state.taxonomy.books[bookId] && state.taxonomy.books[bookId].units[unitNo]) {
      allowedTopics = state.taxonomy.books[bookId].units[unitNo].topicIds;
    }
    return state.taxonomyQuestions.filter(function (question) {
      if (question.subject !== subject) return false;
      if (type && question.type !== type) return false;
      if (difficulty && question.difficulty !== difficulty) return false;
      if (allowedTopics && allowedTopics.indexOf(question.topicId) === -1) return false;
      if (search) {
        var topic = state.taxonomy.topics[question.topicId];
        var haystack = [question.prompt, question.explanation, question.topicName, topic && topic.chapter]
          .join(' ').toLowerCase();
        if (haystack.indexOf(search) === -1) return false;
      }
      return true;
    });
  }

  function importTaxonomyQuestion(question) {
    if (question.type !== 'choice') return { error: 'numeric' };
    if (taxonomyImported(question.id)) return { skipped: true };
    var topic = state.taxonomy.topics[question.topicId];
    if (!topic) return { error: 'topic' };
    var options = (question.choices || []).map(function (choice) {
      return String(choice.text || '').trim();
    });
    if (options.length < 3 || options.length > 4 || options.some(function (item) { return !item; })) {
      return { error: 'options' };
    }
    if (new Set(options).size !== options.length) return { error: 'options' };
    var answer = taxonomyAnswerIndex(question);
    if (answer < 0 || answer >= options.length) return { error: 'answer' };
    var prompt = String(question.prompt || '').trim();
    var explain = String(question.explanation || '').trim();
    if (!prompt || !explain) return { error: 'fields' };
    state.bank[question.subject].questions.push({
      id: 'tax-' + question.id,
      point: topic.name,
      q: prompt,
      options: options,
      answer: answer,
      explain: explain,
      source: 'taxonomy',
      taxonomy: {
        id: question.id,
        topicId: question.topicId,
        difficulty: question.difficulty || '',
      },
      createdAt: new Date().toISOString(),
    });
    return { added: true };
  }

  function renderTaxonomy() {
    if (!taxonomyReady()) {
      loadTaxonomyPanel();
      return;
    }
    var list = filteredTaxonomy();
    var choiceList = list.filter(function (question) { return question.type === 'choice'; });
    var numericList = list.filter(function (question) { return question.type === 'numeric'; });
    var imported = choiceList.filter(function (question) { return taxonomyImported(question.id); }).length;
    $('#tax-count').textContent = list.length + ' 题';
    $('#tax-status').textContent = '当前筛选：' + choiceList.length + ' 道选择题（已导入 ' + imported + '）、' +
      numericList.length + ' 道数值题。数值题请到知识图谱诊断页练习。';
    if (!list.length) {
      $('#tax-list').innerHTML = '<p class="placeholder-note">没有符合筛选的题目，换个单元或题型试试。</p>';
      return;
    }
    var shown = list.slice(0, 80);
    $('#tax-list').innerHTML = shown.map(function (question) {
      var topic = state.taxonomy.topics[question.topicId];
      var already = question.type === 'choice' && taxonomyImported(question.id);
      var isChoice = question.type === 'choice';
      var options = isChoice && Array.isArray(question.choices) ? question.choices.map(function (choice) {
        var key = String(choice.key || '').toUpperCase();
        var correct = key === String(question.answer || '').trim().toUpperCase() ||
          String(choice.text || '').trim() === String(question.answer || '').trim();
        return '<span class="preview-option' + (correct ? ' is-answer' : '') + '">' +
          escapeHtml(key ? key + '. ' : '') + escapeHtml(choice.text) + (correct ? ' ✓' : '') + '</span>';
      }).join('') : '';
      var action = isChoice
        ? (already
          ? '<span class="tax-imported">已导入</span>'
          : '<button type="button" class="btn btn--primary btn--sm" data-tax-import="' + escapeHtml(question.id) + '">导入</button>')
        : '<a class="btn btn--ghost btn--sm" href="' + taxonomyDiagnoseHref(question.subject) + '" target="_blank" rel="noopener noreferrer">去诊断页</a>';
      return '<article class="tax-card" data-tax-id="' + escapeHtml(question.id) + '">' +
        '<div class="tax-card__head">' +
          '<span class="subject-pill subject-pill--' + question.subject + '">' + subjectLabel(question.subject) + '</span>' +
          '<span class="q-row__point">' + escapeHtml(topic ? topic.name : question.topicName) + '</span>' +
          '<span class="q-row__source q-row__source--taxonomy">' + (isChoice ? '选择题' : '数值题') + '</span>' +
          '<span class="tax-card__difficulty">' + escapeHtml(question.difficulty || '') + '</span>' +
          '<code class="q-row__id">' + escapeHtml(question.id) + '</code>' +
        '</div>' +
        '<p class="tax-card__q">' + escapeHtml(question.prompt) + '</p>' +
        (isChoice
          ? '<div class="tax-card__options">' + options + '</div>'
          : '<p class="tax-card__numeric">参考答案：<b>' + escapeHtml(question.answer) + '</b></p>') +
        '<p class="tax-card__explain"><b>解析：</b>' + escapeHtml(question.explanation) + '</p>' +
        '<div class="tax-card__foot">' + action + '</div>' +
      '</article>';
    }).join('') + (list.length > 80 ? '<p class="placeholder-note">只显示前 80 题，请用筛选缩小范围。</p>' : '');
  }

  function importOneTaxonomy(id) {
    var question = state.taxonomyQuestions.filter(function (item) { return item.id === id; })[0];
    if (!question) return;
    var result = importTaxonomyQuestion(question);
    if (result.added) {
      saveBank();
      renderAll();
      renderTaxonomy();
      toast('已导入：' + question.topicName);
    } else if (result.skipped) {
      toast('这道题已经导入过了', { error: true });
    } else {
      toast('这道题格式不完整，暂不能导入', { error: true });
    }
  }

  function importFilteredTaxonomy() {
    if (!taxonomyReady()) return;
    var choiceList = filteredTaxonomy().filter(function (question) { return question.type === 'choice'; });
    var added = 0;
    var skipped = 0;
    var failed = 0;
    choiceList.forEach(function (question) {
      var result = importTaxonomyQuestion(question);
      if (result.added) added += 1;
      else if (result.skipped) skipped += 1;
      else failed += 1;
    });
    if (added) {
      saveBank();
      renderAll();
    }
    renderTaxonomy();
    toast('已导入 ' + added + ' 道题' +
      (skipped ? '，跳过 ' + skipped + ' 道已导入' : '') +
      (failed ? '，' + failed + ' 道格式不完整' : ''));
  }

  function bindEvents() {
    $$('.admin-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchTab(tab.dataset.tab); });
    });

    // 列表筛选
    $('#list-subject').addEventListener('change', function (event) {
      state.filter.subject = event.target.value;
      state.filter.page = 1;
      renderList();
    });
    $('#list-source').addEventListener('change', function (event) {
      state.filter.source = event.target.value;
      state.filter.page = 1;
      renderList();
    });
    var searchTimer = null;
    $('#list-search').addEventListener('input', function (event) {
      window.clearTimeout(searchTimer);
      var value = event.target.value;
      searchTimer = window.setTimeout(function () {
        state.filter.search = value;
        state.filter.page = 1;
        renderList();
      }, 160);
    });
    $('#list-prev').addEventListener('click', function () {
      state.filter.page = Math.max(1, state.filter.page - 1);
      renderList();
    });
    $('#list-next').addEventListener('click', function () {
      state.filter.page += 1;
      renderList();
    });
    $('#question-list').addEventListener('click', function (event) {
      var button = event.target.closest('[data-action]');
      if (!button) return;
      var row = button.closest('.q-row');
      if (!row) return;
      var subject = row.dataset.subject;
      var id = row.dataset.id;
      if (button.dataset.action === 'edit') editQuestion(subject, id);
      else if (button.dataset.action === 'delete') deleteQuestion(subject, id);
    });

    // 表单
    $('#question-form').addEventListener('submit', function (event) {
      event.preventDefault();
      saveForm(false);
    });
    $('#form-save-next').addEventListener('click', function () { saveForm(true); });
    $('#form-cancel').addEventListener('click', function () {
      state.editing = null;
      newQuestion();
      switchTab('list');
    });
    $('#form-delete').addEventListener('click', function () {
      if (!state.editing) return;
      deleteQuestion(state.editing.subject, state.editing.id);
      switchTab('list');
    });
    $('#form-figure').addEventListener('change', function (event) {
      handleFigureFile(event.target.files && event.target.files[0]);
    });
    $('#form-figure-clear').addEventListener('click', clearFigure);
    $('#form-figure-alt').addEventListener('input', function (event) {
      if (state.figure) state.figure.alt = event.target.value;
    });

    // 知识图谱题库
    $('#tax-subject').addEventListener('change', function () {
      populateTaxonomyUnits();
      renderTaxonomy();
    });
    ['#tax-unit', '#tax-type', '#tax-difficulty'].forEach(function (selector) {
      $(selector).addEventListener('change', renderTaxonomy);
    });
    var taxSearchTimer = null;
    $('#tax-search').addEventListener('input', function () {
      window.clearTimeout(taxSearchTimer);
      taxSearchTimer = window.setTimeout(renderTaxonomy, 160);
    });
    $('#tax-import-all').addEventListener('click', importFilteredTaxonomy);
    $('#tax-list').addEventListener('click', function (event) {
      var button = event.target.closest('[data-tax-import]');
      if (button) importOneTaxonomy(button.dataset.taxImport);
    });

    // 生成器
    var kinds = generatorKinds();
    $('#generator-kind').innerHTML = kinds.map(function (kind) {
      return '<option value="' + kind.key + '">' + escapeHtml(kind.label) + '</option>';
    }).join('');
    $('#generator-kind').addEventListener('change', function () {
      updateGeneratorHint();
      generateNew();
    });
    $('#generate-preview').addEventListener('click', generateNew);
    $('#generate-add').addEventListener('click', addGenerated);
    $('#generate-add-five').addEventListener('click', addGeneratedFive);
    $('#generate-stage').addEventListener('click', function (event) {
      var button = event.target.closest('[data-preview-action]');
      if (!button) return;
      var action = button.dataset.previewAction;
      if (action === 'add') addGenerated();
      else if (action === 'next') generateNew();
      else if (action === 'edit') {
        if (!state.generator) return;
        var q = state.generator;
        newQuestion();
        $('#form-subject').value = 'math';
        $('#form-point').value = q.point;
        $('#form-question').value = q.q;
        $('#form-option-a').value = q.options[0];
        $('#form-option-b').value = q.options[1];
        $('#form-option-c').value = q.options[2];
        $('#form-option-d').value = q.options[3];
        $('#form-answer').value = String(q.answer);
        $('#form-explain').value = q.explain;
        $('#form-source').value = 'generated';
        switchTab('form');
      }
    });

    // AI
    ['#ai-subject', '#ai-point', '#ai-count', '#ai-extra'].forEach(function (selector) {
      $(selector).addEventListener('input', refreshPrompt);
      $(selector).addEventListener('change', refreshPrompt);
    });
    $('#ai-copy-prompt').addEventListener('click', function () {
      refreshPrompt();
      copyText($('#ai-prompt').value).then(function () {
        toast('提示词已复制，去任意 AI 对话里粘贴');
      }).catch(function () {
        $('#ai-prompt').select();
        toast('复制失败，请手动全选复制', { error: true });
      });
    });
    $('#ai-generate').addEventListener('click', aiGenerate);
    $('#ai-parse-paste').addEventListener('click', aiParsePaste);
    $('#ai-add-all').addEventListener('click', aiAddAll);
    $('#ai-result').addEventListener('change', function (event) {
      var select = event.target.closest('[data-ai-subject]');
      if (!select) return;
      var index = Number(select.dataset.aiIndex);
      if (!state.aiPreview[index]) return;
      state.aiPreview[index].subject = select.value;
      renderAiPreview(state.aiPreview);
    });
    $('#ai-result').addEventListener('click', function (event) {
      var button = event.target.closest('[data-ai-action]');
      if (!button) return;
      var index = Number(button.dataset.aiIndex);
      if (button.dataset.aiAction === 'add') addAiItem(index);
      else if (button.dataset.aiAction === 'drop') {
        state.aiPreview.splice(index, 1);
        renderAiPreview(state.aiPreview);
      }
    });
    $('#vision-file').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      compressImage(file, 1600).then(function (dataUrl) {
        state.aiImage = dataUrl;
        $('#vision-img').src = dataUrl;
        $('#vision-preview').hidden = false;
        $('#vision-status').textContent = '图片已就绪，点「识图并解析」。';
      }).catch(function (error) {
        toast(error.message || '图片处理失败', { error: true });
      });
    });
    $('#vision-generate').addEventListener('click', visionGenerate);

    // 导入导出
    $('#export-js').addEventListener('click', function () {
      download('questions.js', bankToJs(state.bank), 'text/javascript;charset=utf-8');
      $('#export-status').textContent = '已下载 questions.js。替换 assets/questions.js 后运行自检。';
    });
    $('#copy-js').addEventListener('click', function () {
      copyText(bankToJs(state.bank)).then(function () {
        $('#export-status').textContent = '已复制 questions.js 内容。';
      }).catch(function () {
        $('#export-status').textContent = '复制失败，请使用下载按钮。';
      });
    });
    $('#export-json').addEventListener('click', function () {
      download('questions.json', bankToJson(state.bank), 'application/json;charset=utf-8');
    });
    $('#copy-json').addEventListener('click', function () {
      copyText(bankToJson(state.bank)).then(function () {
        $('#export-status').textContent = '已复制 JSON。';
      }).catch(function () {
        $('#export-status').textContent = '复制失败，请使用下载按钮。';
      });
    });
    $('#apply-local').addEventListener('click', applyToQuiz);
    $('#reset-bank').addEventListener('click', resetBank);
    $('#io-parse').addEventListener('click', function () {
      var status = $('#io-status');
      try {
        var bank = parseBankText($('#io-text').value);
        importPreview(bank);
      } catch (error) {
        status.textContent = '解析失败：' + error.message;
        status.classList.add('is-error');
        $('#io-import-actions').hidden = true;
        $('#io-preview').innerHTML = '';
      }
    });
    $('#io-file').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        $('#io-text').value = String(reader.result);
        $('#io-parse').click();
      };
      reader.readAsText(file);
    });
    $('#io-merge').addEventListener('click', function () {
      if (!state.importPreview) return;
      SUBJECTS.forEach(function (subject) {
        var incoming = state.importPreview[subject.key].questions;
        var current = state.bank[subject.key].questions;
        incoming.forEach(function (question) {
          var index = current.findIndex(function (item) { return item.id === question.id; });
          if (index === -1) current.push(question);
          else current[index] = question;
        });
      });
      state.importPreview = null;
      saveBank();
      renderAll();
      $('#io-status').textContent = '合并完成。';
      $('#io-import-actions').hidden = true;
      toast('已合并导入');
    });
    $('#io-replace').addEventListener('click', function () {
      if (!state.importPreview) return;
      if (!window.confirm('替换题库会丢弃当前本地题库，确定继续吗？')) return;
      state.bank = state.importPreview;
      state.importPreview = null;
      saveBank();
      renderAll();
      $('#io-status').textContent = '已替换题库。';
      $('#io-import-actions').hidden = true;
      toast('已替换题库');
    });

    // 设置
    $$('[data-provider]').forEach(function (button) {
      button.addEventListener('click', function () {
        var presets = {
          openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', vision: 'gpt-4o-mini' },
          deepseek: { endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', vision: '' },
          dashscope: { endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus', vision: 'qwen-vl-plus' },
          zhipu: { endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash', vision: 'glm-4v-flash' },
        };
        var preset = presets[button.dataset.provider];
        if (!preset) return;
        $('#set-endpoint').value = preset.endpoint;
        $('#set-model').value = preset.model;
        $('#set-vision-model').value = preset.vision;
        toast('已填入 ' + button.textContent + ' 预设，记得保存');
      });
    });
    $('#save-settings').addEventListener('click', function () {
      state.settings = {
        endpoint: $('#set-endpoint').value.trim(),
        model: $('#set-model').value.trim(),
        visionModel: $('#set-vision-model').value.trim(),
        apiKey: $('#set-key').value.trim(),
      };
      saveSettings();
      renderSettings();
      toast('设置已保存到本机');
    });
    $('#clear-settings').addEventListener('click', function () {
      state.settings.apiKey = '';
      saveSettings();
      renderSettings();
      toast('已清除 API Key');
    });

    window.addEventListener('hashchange', function () {
      var name = window.location.hash.replace('#', '');
      if (name && $('#panel-' + name)) switchTab(name);
    });
  }

  function boot() {
    bindEvents();
    refreshPrompt();
    renderSettings();
    updateGeneratorHint();
    loadBank().then(function () {
      state.loaded = true;
      setSaveState('本地草稿已保存');
      renderAll();
      newQuestion();
      var hash = window.location.hash.replace('#', '');
      if (hash && $('#panel-' + hash)) switchTab(hash);
      generateNew();
    }).catch(function (error) {
      setSaveState('读取失败', { error: true });
      toast(error.message || '题库读取失败', { error: true, sticky: true });
    });
  }

  boot();
})();
