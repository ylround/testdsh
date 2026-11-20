/*
 * 四科探险队 · 游戏逻辑
 * 纯静态、无依赖：题库来自 window.FOUR_SUBJECT_BANK，进度保存在 localStorage。
 */
(function () {
  'use strict';

  var BANK = window.FOUR_SUBJECT_BANK;
  if (!BANK || !Array.isArray(BANK.subjects)) {
    var fallback = document.getElementById('planet-grid');
    if (fallback) fallback.textContent = '题库加载失败，请刷新页面重试。';
    return;
  }

  var STORAGE_KEY = 'four-subject-game-v1';
  var MAX_STARS = BANK.meta && BANK.meta.totalStars ? BANK.meta.totalStars : 36;
  var DAILY_SIZE = 8;
  var LETTERS = ['A', 'B', 'C', 'D'];
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SUBJECTS = BANK.subjects;
  var LEVEL_INDEX = {};
  var TIP_INDEX = {};

  SUBJECTS.forEach(function (subject) {
    subject.levels.forEach(function (level, index) {
      LEVEL_INDEX[level.id] = { subject: subject, level: level, index: index };
      level.topics.forEach(function (topic) {
        if (!TIP_INDEX[topic.name]) TIP_INDEX[topic.name] = topic.tip;
      });
    });
  });

  var store = loadStore();
  var state = {
    screen: 'home',
    subjectId: null,
    run: null,
    result: null,
  };
  var toastTimer = null;
  var audioCtx = null;
  var confettiFrame = null;

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  /* ---------- 存储 ---------- */

  function defaultStore() {
    return { v: 1, sound: true, best: {}, daily: {} };
  }

  function loadStore() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultStore();
      var parsed = JSON.parse(raw);
      return {
        v: 1,
        sound: !parsed || parsed.sound !== false,
        best: parsed && parsed.best && typeof parsed.best === 'object' ? parsed.best : {},
        daily: parsed && parsed.daily && typeof parsed.daily === 'object' ? parsed.daily : {},
      };
    } catch (error) {
      return defaultStore();
    }
  }

  function saveStore() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (error) {
      showToast('浏览器存储不可用，本次进度不会被保存');
    }
  }

  function bestOf(levelId) {
    var rec = store.best[levelId];
    if (!rec || typeof rec !== 'object') return null;
    return {
      stars: Math.max(0, Math.min(3, Number(rec.stars) || 0)),
      correct: Number(rec.correct) || 0,
      total: Number(rec.total) || 0,
      score: Number(rec.score) || 0,
    };
  }

  function dailyOf(dayKey) {
    var rec = store.daily[dayKey];
    if (!rec || typeof rec !== 'object') return null;
    return {
      stars: Math.max(0, Math.min(3, Number(rec.stars) || 0)),
      correct: Number(rec.correct) || 0,
      total: Number(rec.total) || 0,
      score: Number(rec.score) || 0,
    };
  }

  function totalStars() {
    var total = 0;
    SUBJECTS.forEach(function (subject) {
      subject.levels.forEach(function (level) {
        var rec = bestOf(level.id);
        if (rec) total += rec.stars;
      });
    });
    return Math.min(total, MAX_STARS);
  }

  function subjectStars(subject) {
    var total = 0;
    subject.levels.forEach(function (level) {
      var rec = bestOf(level.id);
      if (rec) total += rec.stars;
    });
    return total;
  }

  function completedLevels() {
    var count = 0;
    SUBJECTS.forEach(function (subject) {
      subject.levels.forEach(function (level) {
        var rec = bestOf(level.id);
        if (rec && rec.stars > 0) count += 1;
      });
    });
    return count;
  }

  function isUnlocked(subject, index) {
    if (index <= 0) return true;
    var prev = subject.levels[index - 1];
    var rec = bestOf(prev.id);
    return !!rec && rec.stars >= 1;
  }

  function subjectById(id) {
    for (var i = 0; i < SUBJECTS.length; i += 1) {
      if (SUBJECTS[i].id === id) return SUBJECTS[i];
    }
    return null;
  }

  /* ---------- 日期 / 随机 ---------- */

  function dateKey(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function dateLabel(date) {
    var week = '日一二三四五六';
    return (date.getMonth() + 1) + '月' + date.getDate() + '日 · 星期' + week.charAt(date.getDay());
  }

  function shiftDay(date, days) {
    var copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  function dailyStreak() {
    var day = new Date();
    if (!store.daily[dateKey(day)]) day = shiftDay(day, -1);
    var count = 0;
    while (store.daily[dateKey(day)] && count < 3660) {
      count += 1;
      day = shiftDay(day, -1);
    }
    return count;
  }

  function hashString(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, random) {
    var rng = typeof random === 'function' ? random : Math.random;
    for (var i = list.length - 1; i > 0; i -= 1) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  /* ---------- 文案 / 计分 ---------- */

  function starsText(stars) {
    var filled = Math.max(0, Math.min(3, stars));
    return '★'.repeat(filled) + '☆'.repeat(3 - filled);
  }

  function starsMarkup(stars) {
    var filled = Math.max(0, Math.min(3, stars));
    var html = '';
    for (var i = 1; i <= 3; i += 1) {
      html += i <= filled ? '<span>★</span>' : '<span class="empty">☆</span>';
    }
    return html;
  }

  function calcStars(correct, total) {
    var ratio = total ? correct / total : 0;
    if (ratio >= 0.85) return 3;
    if (ratio >= 0.65) return 2;
    if (ratio >= 0.5) return 1;
    return 0;
  }

  /* ---------- 提示 / 声音 ---------- */

  function showToast(message) {
    var toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toast.classList.remove('is-visible');
    }, 2400);
  }

  function ensureAudio() {
    if (!audioCtx) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      try {
        audioCtx = new Ctor();
      } catch (error) {
        return null;
      }
    }
    if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();
    return audioCtx;
  }

  function tone(freq, duration, delay, type, volume) {
    var ctx = ensureAudio();
    if (!ctx) return;
    try {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      var start = ctx.currentTime + (delay || 0);
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume || 0.07, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.03);
    } catch (error) {
      /* 声音失败不影响游戏 */
    }
  }

  function sfx(name) {
    if (!store.sound) return;
    if (name === 'correct') {
      tone(660, 0.12, 0, 'sine', 0.07);
      tone(880, 0.16, 0.09, 'sine', 0.06);
    } else if (name === 'wrong') {
      tone(220, 0.16, 0, 'sawtooth', 0.045);
      tone(160, 0.22, 0.09, 'sawtooth', 0.04);
    } else if (name === 'win') {
      tone(523, 0.14, 0, 'triangle', 0.065);
      tone(659, 0.14, 0.12, 'triangle', 0.065);
      tone(784, 0.14, 0.24, 'triangle', 0.065);
      tone(1046, 0.3, 0.36, 'triangle', 0.07);
    } else if (name === 'finish') {
      tone(523, 0.12, 0, 'sine', 0.05);
      tone(784, 0.18, 0.1, 'sine', 0.05);
    }
  }

  function renderSoundButton() {
    var button = $('#sound-toggle');
    if (!button) return;
    button.textContent = store.sound ? '🔊' : '🔇';
    button.setAttribute('aria-pressed', store.sound ? 'true' : 'false');
    button.setAttribute('aria-label', store.sound ? '关闭音效' : '开启音效');
  }

  function toggleSound() {
    store.sound = !store.sound;
    saveStore();
    renderSoundButton();
    if (store.sound) sfx('finish');
  }

  /* ---------- 屏幕切换 ---------- */

  function setScreen(name, focusHeading) {
    state.screen = name;
    document.body.dataset.screen = name;
    ['home', 'planet', 'quiz', 'result'].forEach(function (key) {
      var section = document.getElementById('screen-' + key);
      if (section) section.hidden = key !== name;
    });
    if (focusHeading !== false) {
      var target = document.getElementById('screen-' + name);
      var heading = target ? target.querySelector('h1, h2') : null;
      if (heading) {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    }
    var root = document.documentElement;
    var previousBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    root.style.scrollBehavior = previousBehavior;
  }

  /* ---------- 首页 ---------- */

  function renderHome() {
    var total = totalStars();
    var totalEl = $('#total-stars');
    if (totalEl) totalEl.textContent = String(total);

    renderDaily();

    var grid = $('#planet-grid');
    if (!grid) return;
    grid.innerHTML = SUBJECTS.map(function (subject) {
      var earned = subjectStars(subject);
      var max = subject.levels.length * 3;
      var done = subject.levels.filter(function (level) {
        var rec = bestOf(level.id);
        return !!rec && rec.stars > 0;
      }).length;
      var chips = subject.levels.map(function (level, index) {
        var rec = bestOf(level.id);
        var unlocked = isUnlocked(subject, index);
        var cls = 'level-chip';
        var label = '第 ' + (index + 1) + ' 关';
        if (!unlocked) {
          cls += ' is-locked';
          label += ' · 未解锁';
        } else if (rec && rec.stars > 0) {
          cls += ' is-done';
          label += ' ' + starsText(rec.stars);
        }
        return '<span class="' + cls + '">' + esc(label) + '</span>';
      }).join('');

      return (
        '<article class="planet-card" style="--accent:' + esc(subject.color) + '">' +
          '<div class="planet-card__glow" aria-hidden="true"></div>' +
          '<div class="planet-card__head">' +
            '<div class="orb" aria-hidden="true">' +
              '<svg class="icon"><use href="#icon-' + esc(subject.icon) + '"></use></svg>' +
            '</div>' +
            '<div>' +
              '<h3>' + esc(subject.planet) + '</h3>' +
              '<p>' + esc(subject.name) + ' · ' + esc(subject.tagline) + '</p>' +
            '</div>' +
          '</div>' +
          '<div class="level-chips">' + chips + '</div>' +
          '<div class="meter"><span style="width:' + Math.round((earned / max) * 100) + '%"></span></div>' +
          '<div class="planet-card__foot">' +
            '<span class="starline"><svg class="icon icon--star" aria-hidden="true"><use href="#icon-star"></use></svg>' + earned + ' / ' + max + '</span>' +
            '<button class="btn btn--accent" type="button" data-action="open-planet" data-subject="' + esc(subject.id) + '">' +
              (done > 0 ? '继续闯关' : '进入星球') +
              '<svg class="icon" aria-hidden="true"><use href="#icon-arrow"></use></svg>' +
            '</button>' +
          '</div>' +
        '</article>'
      );
    }).join('');
  }

  function renderDaily() {
    var today = new Date();
    var key = dateKey(today);
    var rec = dailyOf(key);
    var dateEl = $('#daily-date');
    var bestEl = $('#daily-best');
    var streakEl = $('#daily-streak');
    var startEl = $('#daily-start');
    if (dateEl) dateEl.textContent = dateLabel(today);
    if (bestEl) bestEl.textContent = rec ? starsText(rec.stars) + ' · ' + rec.correct + '/' + rec.total : '还没挑战';
    if (streakEl) {
      var streak = dailyStreak();
      streakEl.textContent = streak > 0 ? '连续 ' + streak + ' 天' : '今天开始';
    }
    if (startEl) startEl.textContent = rec ? '再挑战一次' : '开始挑战';
  }

  function showHome(focusHeading) {
    state.run = null;
    state.subjectId = null;
    renderHome();
    renderSoundButton();
    setScreen('home', focusHeading);
    document.title = '四科探险队 · 语数英科学习游戏';
  }

  /* ---------- 星球页 ---------- */

  function openPlanet(subjectId) {
    var subject = subjectById(subjectId);
    if (!subject) return;
    state.subjectId = subjectId;
    state.run = null;

    var hero = $('#planet-hero');
    var list = $('#level-list');
    if (!hero || !list) return;

    var earned = subjectStars(subject);
    var max = subject.levels.length * 3;
    var done = subject.levels.filter(function (level) {
      var rec = bestOf(level.id);
      return !!rec && rec.stars > 0;
    }).length;

    hero.setAttribute('style', '--accent:' + subject.color);
    hero.innerHTML =
      '<div class="orb" aria-hidden="true">' +
        '<svg class="icon"><use href="#icon-' + esc(subject.icon) + '"></use></svg>' +
      '</div>' +
      '<div class="planet-hero__copy">' +
        '<p class="section__kicker">' + esc(subject.planet) + '</p>' +
        '<h1 id="planet-title" tabindex="-1">' + esc(subject.name) + '星球</h1>' +
        '<p>' + esc(subject.intro) + '</p>' +
      '</div>' +
      '<div class="planet-hero__stats">' +
        '<span><svg class="icon icon--star" aria-hidden="true"><use href="#icon-star"></use></svg>' + earned + ' / ' + max + '</span>' +
        '<span>已通关 ' + done + ' / ' + subject.levels.length + '</span>' +
      '</div>';

    list.setAttribute('style', '--accent:' + subject.color);
    list.innerHTML = subject.levels.map(function (level, index) {
      var rec = bestOf(level.id);
      var unlocked = isUnlocked(subject, index);
      var stars = rec ? rec.stars : 0;
      var topics = level.topics.map(function (topic) { return topic.name; }).join(' · ');
      var meta = level.questions.length + ' 题';
      if (rec && rec.total) meta += ' · 最佳 ' + rec.correct + '/' + rec.total;
      var action = unlocked
        ? '<button class="btn btn--accent" type="button" data-action="start-level" data-subject="' + esc(subject.id) + '" data-level="' + esc(level.id) + '">' +
            (stars > 0 ? '复习本关' : '开始挑战') +
            '<svg class="icon" aria-hidden="true"><use href="#icon-arrow"></use></svg>' +
          '</button>'
        : '<span class="lock-note"><svg class="icon" aria-hidden="true"><use href="#icon-lock"></use></svg>先完成上一关</span>';

      return (
        '<article class="level-card' + (unlocked ? '' : ' is-locked') + '">' +
          '<div class="level-card__index" aria-hidden="true">' + String(index + 1).padStart(2, '0') + '</div>' +
          '<div class="level-card__body">' +
            '<h2>' + esc(level.name) + '</h2>' +
            '<p>' + esc(level.subtitle) + ' · ' + esc(topics) + '</p>' +
            '<span class="level-card__meta">' + esc(meta) + '</span>' +
          '</div>' +
          '<div class="level-card__stars" aria-label="' + stars + ' 颗星">' + starsMarkup(stars) + '</div>' +
          '<div class="level-card__action">' + action + '</div>' +
        '</article>'
      );
    }).join('');

    setScreen('planet');
    document.title = subject.planet + ' · 四科探险队';
  }

  /* ---------- 开始游戏 ---------- */

  function makeRunQuestion(question, subject, level, random) {
    var options = question.options.map(function (text, index) {
      return { text: text, correct: index === question.answer };
    });
    shuffle(options, random);
    return {
      id: question.id,
      q: question.q,
      topic: question.topic,
      explain: question.explain,
      options: options,
      subjectId: subject.id,
      subjectName: subject.name,
      color: subject.color,
      levelName: level.name,
    };
  }

  function startLevel(subjectId, levelId) {
    var subject = subjectById(subjectId);
    if (!subject) return;
    var index = -1;
    for (var i = 0; i < subject.levels.length; i += 1) {
      if (subject.levels[i].id === levelId) {
        index = i;
        break;
      }
    }
    if (index < 0) return;
    if (!isUnlocked(subject, index)) {
      showToast('先完成上一关才能解锁哦');
      return;
    }
    var level = subject.levels[index];
    var questions = shuffle(level.questions.slice(), Math.random).map(function (question) {
      return makeRunQuestion(question, subject, level, Math.random);
    });

    state.subjectId = subject.id;
    state.run = {
      mode: 'level',
      subjectId: subject.id,
      levelId: level.id,
      levelIndex: index,
      subjectName: subject.name,
      levelName: level.name,
      color: subject.color,
      questions: questions,
      index: 0,
      answers: [],
      score: 0,
      streak: 0,
      bestStreak: 0,
      answered: false,
      finished: false,
    };
    setScreen('quiz', false);
    renderQuiz();
    document.title = '答题中 · 四科探险队';
  }

  function startDaily() {
    var key = dateKey(new Date());
    var rng = mulberry32(hashString('daily:' + key));
    var picks = [];
    SUBJECTS.forEach(function (subject) {
      var pool = [];
      subject.levels.forEach(function (level) {
        level.questions.forEach(function (question) {
          pool.push({ question: question, subject: subject, level: level });
        });
      });
      shuffle(pool, rng);
      picks = picks.concat(pool.slice(0, 2));
    });
    shuffle(picks, rng);

    state.subjectId = null;
    state.run = {
      mode: 'daily',
      subjectId: null,
      levelId: null,
      levelIndex: null,
      subjectName: '四科挑战',
      levelName: '每日挑战',
      color: '#FFD166',
      questions: picks.map(function (pick) {
        return makeRunQuestion(pick.question, pick.subject, pick.level, rng);
      }),
      index: 0,
      answers: [],
      score: 0,
      streak: 0,
      bestStreak: 0,
      answered: false,
      finished: false,
    };
    setScreen('quiz', false);
    renderQuiz();
    document.title = '答题中 · 四科探险队';
  }

  /* ---------- 答题页 ---------- */

  function renderQuiz() {
    var run = state.run;
    if (!run) return;
    var question = run.questions[run.index];
    var total = run.questions.length;

    var titleEl = $('#quiz-title');
    if (titleEl) {
      titleEl.textContent = run.mode === 'daily' ? '今日混合挑战' : run.subjectName + ' · ' + run.levelName;
    }
    var scoreEl = $('#quiz-score');
    if (scoreEl) scoreEl.textContent = run.score + ' 分';

    var progress = $('#quiz-progress');
    var fill = $('#quiz-progress-fill');
    var label = $('#quiz-progress-label');
    if (progress) {
      progress.setAttribute('aria-valuemax', String(total));
      progress.setAttribute('aria-valuenow', String(run.index + 1));
    }
    if (fill) fill.style.width = Math.round(((run.index + 1) / total) * 100) + '%';
    if (label) label.textContent = '第 ' + (run.index + 1) + ' / ' + total + ' 题';

    var card = $('.question-card');
    if (card) card.style.setProperty('--accent', question.color);

    var subjectChip = $('#quiz-subject-chip');
    if (subjectChip) {
      subjectChip.textContent = question.subjectName;
      subjectChip.style.setProperty('--accent', question.color);
    }
    var topicChip = $('#quiz-topic');
    if (topicChip) topicChip.textContent = question.topic;

    var combo = $('#quiz-combo');
    if (combo) {
      if (run.streak >= 2) {
        combo.hidden = false;
        combo.textContent = '连对 ×' + run.streak;
      } else {
        combo.hidden = true;
      }
    }

    var questionEl = $('#quiz-question');
    if (questionEl) questionEl.textContent = question.q;

    var optionsEl = $('#quiz-options');
    if (optionsEl) {
      optionsEl.innerHTML = '';
      question.options.forEach(function (option, index) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'option';
        button.dataset.action = 'answer';
        button.dataset.index = String(index);

        var key = document.createElement('span');
        key.className = 'option__key';
        key.textContent = LETTERS[index];

        var text = document.createElement('span');
        text.className = 'option__text';
        text.textContent = option.text;

        var mark = document.createElement('span');
        mark.className = 'option__mark';
        mark.setAttribute('aria-hidden', 'true');

        button.appendChild(key);
        button.appendChild(text);
        button.appendChild(mark);
        optionsEl.appendChild(button);
      });
    }

    var feedback = $('#quiz-feedback');
    if (feedback) {
      feedback.hidden = true;
      feedback.classList.remove('is-wrong');
    }
    var continueBtn = $('#quiz-continue');
    if (continueBtn) continueBtn.textContent = run.index === total - 1 ? '查看成绩' : '下一题';
    run.answered = false;

    if (questionEl) questionEl.focus({ preventScroll: true });
  }

  function answerOption(index) {
    var run = state.run;
    if (!run || run.answered) return;
    var question = run.questions[run.index];
    if (!question || index < 0 || index >= question.options.length) return;

    run.answered = true;
    var correctIndex = -1;
    for (var i = 0; i < question.options.length; i += 1) {
      if (question.options[i].correct) {
        correctIndex = i;
        break;
      }
    }
    var chosen = question.options[index];
    var correct = !!chosen.correct;

    var optionButtons = $('#quiz-options') ? $('#quiz-options').querySelectorAll('.option') : [];
    Array.prototype.forEach.call(optionButtons, function (button, optionIndex) {
      button.disabled = true;
      button.classList.add('is-dim');
      var mark = button.querySelector('.option__mark');
      if (optionIndex === correctIndex) {
        button.classList.remove('is-dim');
        button.classList.add('is-correct');
        if (mark) mark.innerHTML = '<svg class="icon"><use href="#icon-check"></use></svg>';
      } else if (optionIndex === index) {
        button.classList.remove('is-dim');
        button.classList.add('is-wrong');
        if (mark) mark.innerHTML = '<svg class="icon"><use href="#icon-close"></use></svg>';
      }
    });

    if (correct) {
      run.streak += 1;
      run.bestStreak = Math.max(run.bestStreak, run.streak);
      run.score += 10 + Math.min(run.streak - 1, 5) * 2;
      sfx('correct');
    } else {
      run.streak = 0;
      sfx('wrong');
    }

    run.answers.push({
      index: run.index,
      q: question.q,
      topic: question.topic,
      subjectName: question.subjectName,
      chosen: chosen.text,
      correctText: question.options[correctIndex].text,
      explain: question.explain,
      correct: correct,
    });

    var scoreEl = $('#quiz-score');
    if (scoreEl) scoreEl.textContent = run.score + ' 分';

    var combo = $('#quiz-combo');
    if (combo) {
      if (run.streak >= 2) {
        combo.hidden = false;
        combo.textContent = '连对 ×' + run.streak;
      } else {
        combo.hidden = true;
      }
    }

    var feedback = $('#quiz-feedback');
    var feedbackIcon = $('#feedback-icon');
    var feedbackTitle = $('#feedback-title');
    var feedbackExplain = $('#feedback-explain');
    if (feedback) {
      feedback.hidden = false;
      feedback.classList.toggle('is-wrong', !correct);
      if (feedbackIcon) feedbackIcon.textContent = correct ? '✓' : '✕';
      if (feedbackTitle) feedbackTitle.textContent = correct ? '答对了！' : '再想一想';
      if (feedbackExplain) {
        feedbackExplain.textContent = correct
          ? question.explain
          : '正确答案是 ' + LETTERS[correctIndex] + '。' + question.explain;
      }
    }

    var continueBtn = $('#quiz-continue');
    if (continueBtn) {
      continueBtn.textContent = run.index === run.questions.length - 1 ? '查看成绩' : '下一题';
      continueBtn.focus({ preventScroll: true });
    }
  }

  function continueRun() {
    var run = state.run;
    if (!run || !run.answered) return;
    if (run.index + 1 >= run.questions.length) {
      finishRun();
      return;
    }
    run.index += 1;
    renderQuiz();
  }

  function finishRun() {
    var run = state.run;
    if (!run) return;
    var total = run.questions.length;
    var correct = run.answers.filter(function (answer) { return answer.correct; }).length;
    var stars = calcStars(correct, total);
    var today = dateKey(new Date());
    var previous = run.mode === 'daily' ? dailyOf(today) : bestOf(run.levelId);
    var improved = !previous || stars > previous.stars ||
      (stars === previous.stars && run.score > previous.score);

    if (improved) {
      var record = {
        stars: stars,
        correct: correct,
        total: total,
        score: run.score,
        at: Date.now(),
      };
      if (run.mode === 'daily') store.daily[today] = record;
      else store.best[run.levelId] = record;
      saveStore();
    }

    run.finished = true;
    state.result = {
      correct: correct,
      total: total,
      stars: stars,
      improved: improved,
      hadPrevious: !!previous,
      previous: previous,
    };
    renderResult();
    setScreen('result');
    document.title = '成绩 · 四科探险队';

    if (stars === 3) sfx('win');
    else sfx('finish');

    if (improved && stars > 0) {
      var colors = run.mode === 'daily'
        ? ['#FF7A7A', '#5B8DEF', '#2EC4B6', '#B57BFF', '#FFD166']
        : [run.color, '#FFD166', '#FFFFFF', '#5B8DEF'];
      burstConfetti(colors);
    }
  }

  /* ---------- 成绩页 ---------- */

  function renderResult() {
    var run = state.run;
    var result = state.result;
    var container = $('#result-content');
    if (!run || !result || !container) return;

    var headline = result.stars === 3 ? '完美通关！'
      : result.stars === 2 ? '顺利抵达！'
      : result.stars === 1 ? '惊险过关！'
      : '继续加油！';

    var starsHtml = '';
    for (var i = 1; i <= 3; i += 1) {
      starsHtml += '<svg class="icon' + (i <= result.stars ? ' is-filled' : '') + '" aria-hidden="true"><use href="#icon-star"></use></svg>';
    }

    var badge = '';
    if (result.stars > 0 && result.improved && !result.hadPrevious) {
      badge = '<span class="new-best"><svg class="icon" aria-hidden="true"><use href="#icon-star"></use></svg>首次通关</span>';
    } else if (result.stars > 0 && result.improved && result.hadPrevious) {
      badge = '<span class="new-best"><svg class="icon" aria-hidden="true"><use href="#icon-bolt"></use></svg>刷新最佳成绩</span>';
    }

    var accuracy = Math.round((result.correct / result.total) * 100);
    var resultSubject = run.mode === 'level' ? subjectById(run.subjectId) : null;
    var eyebrow = run.mode === 'daily'
      ? '每日挑战 · ' + dateLabel(new Date())
      : (resultSubject ? resultSubject.planet : '') + ' · 第 ' + (run.levelIndex + 1) + ' 关';
    var subtitle = run.mode === 'daily'
      ? '四科混合挑战 · ' + result.total + ' 题'
      : (resultSubject ? resultSubject.name : '') + ' · ' + run.levelName;

    var groups = buildGroups(run);
    var tips = buildTips(run);

    var masteryHtml = groups.map(function (group) {
      var percent = group.total ? Math.round((group.correct / group.total) * 100) : 0;
      return (
        '<div class="mastery-row">' +
          '<div class="mastery-row__head"><span>' + esc(group.name) + '</span><b>' + group.correct + ' / ' + group.total + '</b></div>' +
          '<div class="meter"><span style="width:' + percent + '%"></span></div>' +
        '</div>'
      );
    }).join('');

    var tipsHtml = tips.length
      ? '<ul class="tips">' + tips.map(function (tip) {
          return '<li><b>' + esc(tip.topic) + '</b>' + esc(tip.tip) + '</li>';
        }).join('') + '</ul>'
      : '';

    var wrong = run.answers.filter(function (answer) { return !answer.correct; });
    var reviewHtml = wrong.length
      ? '<details class="review"' + (wrong.length <= 3 ? ' open' : '') + '>' +
          '<summary>查看错题（' + wrong.length + ' 道）</summary>' +
          '<ol>' + wrong.map(function (answer) {
            return (
              '<li>' +
                '<p class="review__q">' + esc(answer.q) + '</p>' +
                '<p class="review__answer">你的答案：<span class="bad">' + esc(answer.chosen) + '</span> · 正确答案：<span class="good">' + esc(answer.correctText) + '</span></p>' +
                '<p class="review__explain">' + esc(answer.explain) + '</p>' +
              '</li>'
            );
          }).join('') + '</ol>' +
        '</details>'
      : '<p class="perfect"><svg class="icon" aria-hidden="true"><use href="#icon-check"></use></svg>全部答对，太厉害了！</p>';

    var actions = buildResultActions(run, result);

    container.innerHTML =
      '<div class="result-hero">' +
        '<p class="result-eyebrow">' + esc(eyebrow) + '</p>' +
        '<h1 id="result-title" tabindex="-1">' + headline + '</h1>' +
        '<div class="result-stars" role="img" aria-label="获得 ' + result.stars + ' 颗星">' + starsHtml + '</div>' +
        '<p class="result-subtitle">' + esc(subtitle) + '</p>' +
        badge +
        '<div class="result-stats">' +
          '<div class="result-stat"><b>' + result.correct + ' / ' + result.total + '</b><span>答对题数</span></div>' +
          '<div class="result-stat"><b>' + accuracy + '%</b><span>正确率</span></div>' +
          '<div class="result-stat"><b>' + run.score + '</b><span>本局得分</span></div>' +
          '<div class="result-stat"><b>' + run.bestStreak + '</b><span>最高连对</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="result-body">' +
        '<section class="result-block">' +
          '<h2><svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg>' +
            (run.mode === 'daily' ? '各科表现' : '知识点掌握') +
          '</h2>' +
          '<div class="mastery-list">' + masteryHtml + '</div>' +
          tipsHtml +
        '</section>' +
        '<section class="result-block">' +
          '<h2><svg class="icon" aria-hidden="true"><use href="#icon-book"></use></svg>错题回顾</h2>' +
          reviewHtml +
        '</section>' +
      '</div>' +
      '<div class="result-actions">' + actions + '</div>';

    var heading = $('#result-title');
    if (heading) heading.focus({ preventScroll: true });
  }

  function buildGroups(run) {
    var order = [];
    var map = {};
    run.answers.forEach(function (answer) {
      var key = run.mode === 'daily' ? answer.subjectName : answer.topic;
      if (!map[key]) {
        map[key] = { name: key, correct: 0, total: 0 };
        order.push(key);
      }
      map[key].total += 1;
      if (answer.correct) map[key].correct += 1;
    });
    return order.map(function (key) { return map[key]; });
  }

  function buildTips(run) {
    var tips = [];
    var seen = {};
    run.answers.forEach(function (answer) {
      if (answer.correct || seen[answer.topic]) return;
      var tip = TIP_INDEX[answer.topic];
      if (!tip) return;
      seen[answer.topic] = true;
      tips.push({ topic: answer.topic, tip: tip });
    });
    return tips;
  }

  function buildResultActions(run, result) {
    var actions = '';
    if (run.mode === 'level') {
      var subject = subjectById(run.subjectId);
      var next = subject && subject.levels[run.levelIndex + 1] ? subject.levels[run.levelIndex + 1] : null;
      var nextUnlocked = next ? isUnlocked(subject, run.levelIndex + 1) : false;

      if (next && nextUnlocked) {
        actions += '<button class="btn btn--primary" type="button" data-action="next-level">下一关：' + esc(next.name) +
          '<svg class="icon" aria-hidden="true"><use href="#icon-arrow"></use></svg></button>';
        actions += '<button class="btn btn--ghost" type="button" data-action="replay">再挑战一次</button>';
      } else {
        actions += '<button class="btn btn--primary" type="button" data-action="replay">再挑战一次</button>';
        if (next && !nextUnlocked) {
          actions += '<span class="lock-note"><svg class="icon" aria-hidden="true"><use href="#icon-lock"></use></svg>拿到 1 颗星解锁下一关</span>';
        }
      }
      actions += '<button class="btn btn--ghost" type="button" data-action="back-planet">返回' + esc(subject.planet) + '</button>';
    } else {
      actions += '<button class="btn btn--primary" type="button" data-action="replay">再挑战一次</button>';
      actions += '<button class="btn btn--ghost" type="button" data-action="back-home">返回首页</button>';
    }
    return actions;
  }

  /* ---------- 导航 ---------- */

  function goHome() {
    if (state.screen === 'quiz' && state.run && !state.run.finished && state.run.answers.length) {
      confirmAction({
        title: '退出本次挑战？',
        text: '本关还没有完成，退出后本次答题记录不会保存。',
        okText: '退出挑战',
        cancelText: '继续答题',
        onOk: function () { showHome(); },
      });
      return;
    }
    showHome();
  }

  function requestExitQuiz() {
    if (state.screen !== 'quiz' || !state.run) return;
    if (!state.run.answers.length) {
      backToPlanet();
      return;
    }
    confirmAction({
      title: '退出本次挑战？',
      text: '本关还没有完成，退出后本次答题记录不会保存。',
      okText: '退出挑战',
      cancelText: '继续答题',
      onOk: function () { backToPlanet(); },
    });
  }

  function backToPlanet() {
    var subjectId = state.run ? state.run.subjectId : state.subjectId;
    state.run = null;
    if (subjectId) openPlanet(subjectId);
    else showHome();
  }

  function replayRun() {
    var run = state.run;
    if (!run) return;
    if (run.mode === 'daily') startDaily();
    else startLevel(run.subjectId, run.levelId);
  }

  function nextLevel() {
    var run = state.run;
    if (!run || run.mode !== 'level') return;
    var subject = subjectById(run.subjectId);
    if (!subject) return;
    var next = subject.levels[run.levelIndex + 1];
    if (next) startLevel(subject.id, next.id);
  }

  /* ---------- 确认弹窗 ---------- */

  function confirmAction(options) {
    var dialog = $('#confirm-dialog');
    if (!dialog) {
      if (window.confirm(options.title + '\n' + options.text)) options.onOk();
      return;
    }
    var titleEl = $('#confirm-title');
    var textEl = $('#confirm-text');
    var okBtn = $('#confirm-ok');
    var cancelBtn = $('#confirm-cancel');
    if (!okBtn || !cancelBtn) {
      if (window.confirm(options.title + '\n' + options.text) && options.onOk) options.onOk();
      return;
    }
    if (titleEl) titleEl.textContent = options.title;
    if (textEl) textEl.textContent = options.text;
    if (okBtn) {
      okBtn.textContent = options.okText || '确认';
      okBtn.className = 'btn ' + (options.danger ? 'btn--danger' : 'btn--primary');
    }
    if (cancelBtn) cancelBtn.textContent = options.cancelText || '取消';

    function cleanup() {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      dialog.removeEventListener('close', onClose);
    }
    function close() {
      if (typeof dialog.close === 'function') dialog.close();
    }
    function onOk() {
      cleanup();
      close();
      if (options.onOk) options.onOk();
    }
    function onCancel() {
      cleanup();
      close();
    }
    function onClose() {
      cleanup();
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    dialog.addEventListener('close', onClose);

    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      if (window.confirm(options.title + '\n' + options.text) && options.onOk) options.onOk();
      cleanup();
    }
  }

  function resetProgress() {
    confirmAction({
      title: '清空学习进度？',
      text: '所有星球的星星、最佳成绩和每日挑战记录都会被清空，无法恢复。',
      okText: '清空进度',
      cancelText: '再想想',
      danger: true,
      onOk: function () {
        try {
          window.localStorage.removeItem(STORAGE_KEY);
        } catch (error) {
          /* 忽略存储错误 */
        }
        store = defaultStore();
        renderSoundButton();
        renderHome();
        if (state.screen !== 'home') showHome();
        showToast('学习进度已清空');
      },
    });
  }

  /* ---------- 彩纸 ---------- */

  function burstConfetti(colors) {
    if (REDUCED) return;
    var canvas = $('#confetti');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var width = window.innerWidth;
    var height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var particles = [];
    for (var i = 0; i < 150; i += 1) {
      particles.push({
        x: width / 2 + (Math.random() - 0.5) * width * 0.4,
        y: height * 0.32 + (Math.random() - 0.5) * 90,
        vx: (Math.random() - 0.5) * 9,
        vy: -6 - Math.random() * 9,
        g: 0.2 + Math.random() * 0.15,
        size: 5 + Math.random() * 7,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: colors[i % colors.length],
        shape: Math.random() < 0.5 ? 'rect' : 'circle',
      });
    }

    var start = performance.now();
    if (confettiFrame) cancelAnimationFrame(confettiFrame);

    function frame(now) {
      var elapsed = now - start;
      ctx.clearRect(0, 0, width, height);
      var alpha = Math.max(0, 1 - elapsed / 2600);
      particles.forEach(function (particle) {
        particle.vy += particle.g;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vx *= 0.995;
        particle.rot += particle.vr;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rot);
        ctx.fillStyle = particle.color;
        if (particle.shape === 'rect') {
          ctx.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, particle.size / 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });
      if (elapsed < 2600) confettiFrame = requestAnimationFrame(frame);
      else {
        ctx.clearRect(0, 0, width, height);
        confettiFrame = null;
      }
    }
    confettiFrame = requestAnimationFrame(frame);
  }

  /* ---------- 事件 ---------- */

  document.addEventListener('click', function (event) {
    var trigger = event.target.closest ? event.target.closest('[data-action]') : null;
    if (!trigger) return;
    var action = trigger.dataset.action;

    if (action === 'home') {
      event.preventDefault();
      goHome();
    } else if (action === 'scroll-planets') {
      var planets = $('#planets');
      if (planets) planets.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
    } else if (action === 'open-planet') {
      openPlanet(trigger.dataset.subject);
    } else if (action === 'start-level') {
      startLevel(trigger.dataset.subject, trigger.dataset.level);
    } else if (action === 'start-daily') {
      startDaily();
    } else if (action === 'sound') {
      toggleSound();
    } else if (action === 'reset') {
      resetProgress();
    } else if (action === 'exit-quiz') {
      requestExitQuiz();
    } else if (action === 'answer') {
      answerOption(parseInt(trigger.dataset.index, 10));
    } else if (action === 'continue') {
      continueRun();
    } else if (action === 'replay') {
      replayRun();
    } else if (action === 'next-level') {
      nextLevel();
    } else if (action === 'back-planet') {
      backToPlanet();
    } else if (action === 'back-home') {
      showHome();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (state.screen !== 'quiz' || !state.run) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      requestExitQuiz();
      return;
    }
    var run = state.run;
    if (!run.answered) {
      var key = event.key.toLowerCase();
      var index = -1;
      if (/^[1-4]$/.test(key)) index = parseInt(key, 10) - 1;
      else if (/^[a-d]$/.test(key)) index = key.charCodeAt(0) - 97;
      if (index >= 0 && index < run.questions[run.index].options.length) {
        event.preventDefault();
        answerOption(index);
      }
    } else if (event.key === 'Enter') {
      if (document.activeElement && document.activeElement.tagName === 'BUTTON') return;
      event.preventDefault();
      continueRun();
    }
  });

  /* ---------- 启动 ---------- */

  renderSoundButton();
  renderHome();
  setScreen('home', false);
  document.title = '四科探险队 · 语数英科学习游戏';
})();
