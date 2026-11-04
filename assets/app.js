(function () {
  'use strict';

  var DEFAULT_BANK = window.QUIZ_BANK;
  var BANK = loadLocalBank() || DEFAULT_BANK;
  var SUBJECTS = ['chinese', 'math', 'english'];
  var RUN_SIZE = 10;
  var STORAGE_KEY = 'midterm-quiz-v1';
  var LETTERS = ['A', 'B', 'C', 'D'];

  var ADVICE = {
    chinese: {
      '修辞手法': '读句子时圈出“像、好像、仿佛”这些词，说出把什么比作什么。',
      '课文理解': '合上课本复述课文主要内容，再回答课后问题。',
      '古诗文': '每天熟读一首古诗，重点记作者、名句和诗句的意思。',
      '字词积累': '准备一个错字本，每天听写 10 个词语，第二天再复习一遍。',
      '说明方法': '读说明文时找数字、比较和例子，给每段标出说明方法。',
      '语言运用': '做 5 道修改病句题，读一遍检查“谁做什么”。',
      '民间故事': '把《牛郎织女》或《猎人海力布》讲给家人听，记住起因、经过、结果。',
    },
    math: {
      '小数乘法': '先按整数算出积，再数一数两个因数一共有几位小数。',
      '小数除法': '把除数变成整数，商的小数点要和被除数的小数点对齐。',
      '简便运算': '熟记乘法分配律，先观察能不能凑整再计算。',
      '位置': '数对先写列、再写行，在格子图上找一找。',
      '近似数': '保留两位小数就看千分位，用“四舍五入”。',
      '解决问题': '先写出数量关系，再列式计算，最后检查单位。',
    },
    english: {
      '词汇': '把单词按“人物、星期、食物”分类做成单词卡，每天读 5 分钟。',
      '句型': '用 What’s he like? / What would you like? 和家人做问答。',
      '语法': '记住第三人称单数：he / she / it 后面的动词要加 -s 或 -es。',
      '情景交际': '和家人演一演点餐、聊老师的对话，注意问什么就答什么。',
    },
  };

  var state = {
    store: loadStore(),
    run: null,
    timer: null,
  };

  var screens = {};
  var els = {};

  function $(selector) {
    return document.querySelector(selector);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function loadLocalBank() {
    try {
      var raw = window.localStorage.getItem('quiz-bank-override-v1');
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      var bank = parsed && parsed.bank;
      if (!bank) return null;
      var keys = ['chinese', 'math', 'english'];
      for (var i = 0; i < keys.length; i += 1) {
        var subject = bank[keys[i]];
        if (!subject || !Array.isArray(subject.questions) || !subject.questions.length) return null;
      }
      return bank;
    } catch (error) {
      return null;
    }
  }

  function renderBankNote() {
    var footer = document.querySelector('#screen-home .footer');
    if (!footer) return;
    var note = document.getElementById('local-bank-note');
    if (!note) {
      note = document.createElement('div');
      note.id = 'local-bank-note';
      note.className = 'local-bank-note';
      note.innerHTML = '<span id="local-bank-note-text"></span>' +
        '<button type="button" class="btn btn--ghost btn--sm" id="local-bank-reset">恢复默认题库</button>';
      footer.insertAdjacentElement('afterend', note);
      note.querySelector('#local-bank-reset').addEventListener('click', function () {
        window.localStorage.removeItem('quiz-bank-override-v1');
        window.location.reload();
      });
    }
    if (BANK === DEFAULT_BANK) {
      note.hidden = true;
      return;
    }
    var total = 0;
    ['chinese', 'math', 'english'].forEach(function (key) {
      total += BANK[key].questions.length;
    });
    note.hidden = false;
    note.querySelector('#local-bank-note-text').textContent =
      '正在使用本机题库：' + total + ' 题（由题库后台应用）。';
  }

  function loadStore() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { best: {}, sound: true };
      var parsed = JSON.parse(raw);
      return {
        best: parsed && typeof parsed.best === 'object' && parsed.best ? parsed.best : {},
        sound: !parsed || parsed.sound !== false,
      };
    } catch (error) {
      return { best: {}, sound: true };
    }
  }

  function saveStore() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.store));
    } catch (error) {
      /* 隐私模式或存储已满时，游戏本身仍可正常使用 */
    }
  }

  function totalStars() {
    return SUBJECTS.reduce(function (sum, key) {
      var best = state.store.best[key];
      return sum + (best && best.stars ? best.stars : 0);
    }, 0);
  }

  function starsHtml(stars) {
    return [1, 2, 3].map(function (index) {
      return '<span class="star' + (index <= stars ? ' is-on' : '') + '">★</span>';
    }).join('');
  }

  function formatTime(totalSeconds) {
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;
    return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  }

  function shuffle(list) {
    var copy = list.slice();
    for (var i = copy.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = copy[i];
      copy[i] = copy[j];
      copy[j] = temp;
    }
    return copy;
  }

  /* ---------- 音效 ---------- */

  var audioContext = null;

  function playSound(kind) {
    if (!state.store.sound) return;
    try {
      var AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      if (!audioContext) audioContext = new AudioCtor();
      if (audioContext.state === 'suspended') audioContext.resume();

      var now = audioContext.currentTime;
      var notes;
      if (kind === 'correct') {
        notes = [[523.25, 0], [659.25, 0.08], [783.99, 0.16]];
      } else if (kind === 'wrong') {
        notes = [[196, 0], [164.81, 0.12]];
      } else if (kind === 'finish') {
        notes = [[523.25, 0], [659.25, 0.1], [783.99, 0.2], [1046.5, 0.32]];
      } else {
        notes = [[587.33, 0]];
      }

      notes.forEach(function (note) {
        var oscillator = audioContext.createOscillator();
        var gain = audioContext.createGain();
        oscillator.type = kind === 'wrong' ? 'triangle' : 'sine';
        oscillator.frequency.value = note[0];
        gain.gain.setValueAtTime(0.0001, now + note[1]);
        gain.gain.exponentialRampToValueAtTime(kind === 'wrong' ? 0.05 : 0.07, now + note[1] + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + note[1] + 0.26);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(now + note[1]);
        oscillator.stop(now + note[1] + 0.3);
      });
    } catch (error) {
      /* 浏览器不支持音频时静默跳过 */
    }
  }

  function updateSoundButton() {
    var button = els.soundToggle;
    if (!button) return;
    button.textContent = state.store.sound ? '🔊' : '🔇';
    button.setAttribute('aria-pressed', String(state.store.sound));
    button.setAttribute('aria-label', state.store.sound ? '关闭音效' : '打开音效');
  }

  /* ---------- 页面切换 ---------- */

  function showScreen(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].hidden = key !== name;
    });
    document.body.dataset.screen = name;
    if (name === 'home') delete document.body.dataset.subject;
    window.scrollTo(0, 0);
  }

  function renderHome() {
    var grid = els.subjectGrid;
    grid.innerHTML = SUBJECTS.map(function (key) {
      var subject = BANK[key];
      var best = state.store.best[key];
      var stars = best && best.stars ? best.stars : 0;
      var bestText = best
        ? '最佳 ' + stars + ' 星 · 正确率 ' + Math.round((best.correct / best.total) * 100) + '%'
        : '还没挑战，来试试看！';
      return (
        '<button type="button" class="subject-card subject-card--' + key + '" data-subject="' + key + '">' +
          '<span class="subject-card__top">' +
            '<span class="subject-mark" aria-hidden="true">' + escapeHtml(subject.mark) + '</span>' +
            '<span class="subject-stars" aria-label="' + (stars ? '最佳 ' + stars + ' 星' : '尚未挑战') + '">' + starsHtml(stars) + '</span>' +
          '</span>' +
          '<span class="subject-name">' + escapeHtml(subject.label) + '</span>' +
          '<span class="subject-scope">' + escapeHtml(subject.scope) + ' · ' + escapeHtml(subject.topics) + '</span>' +
          '<span class="subject-best">' + bestText + '</span>' +
          '<span class="subject-go">开始闯关 <span aria-hidden="true">→</span></span>' +
        '</button>'
      );
    }).join('');

    els.totalStars.textContent = totalStars() + ' / 9';
    updateSoundButton();
  }

  function scrollToSubjects() {
    var firstCard = els.subjectGrid.querySelector('.subject-card');
    if (!firstCard) return;
    firstCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    firstCard.focus({ preventScroll: true });
  }

  /* ---------- 闯关流程 ---------- */

  function startRun(subjectKey) {
    var subject = BANK[subjectKey];
    var picked = shuffle(subject.questions).slice(0, Math.min(RUN_SIZE, subject.questions.length));
    var questions = picked.map(function (question) {
      var options = question.options.map(function (text, index) {
        return { text: text, correct: index === question.answer };
      });
      shuffle(options);
      return {
        id: question.id,
        point: question.point,
        q: question.q,
        explain: question.explain,
        figure: question.figure || null,
        options: options,
        correctIndex: options.findIndex(function (option) { return option.correct; }),
      };
    });

    state.run = {
      subject: subjectKey,
      questions: questions,
      index: 0,
      answers: [],
      score: 0,
      combo: 0,
      maxCombo: 0,
      locked: false,
      startedAt: Date.now(),
      seconds: 0,
    };

    document.body.dataset.subject = subjectKey;
    els.quizSubject.textContent = subject.label + ' · 期中闯关';
    showScreen('quiz');
    renderQuestion();
    startTimer();
    playSound('click');
  }

  function startTimer() {
    stopTimer();
    if (!state.run) return;
    state.run.startedAt = Date.now();
    updateTimer();
    state.timer = window.setInterval(updateTimer, 500);
  }

  function stopTimer() {
    if (state.timer) {
      window.clearInterval(state.timer);
      state.timer = null;
    }
  }

  function updateTimer() {
    if (!state.run) return;
    var elapsed = Math.max(0, Math.floor((Date.now() - state.run.startedAt) / 1000));
    els.quizTime.textContent = formatTime(elapsed);
  }

  function figureHtml(figure) {
    if (!figure || !figure.src) return '';
    var caption = figure.caption
      ? '<figcaption>' + escapeHtml(figure.caption) + '</figcaption>'
      : '';
    return '<figure class="q-figure">' +
      '<img src="' + escapeHtml(figure.src) + '" alt="' + escapeHtml(figure.alt || '题目配图') + '" loading="lazy">' +
      caption +
    '</figure>';
  }

  function renderQuestion() {
    var run = state.run;
    var question = run.questions[run.index];
    var subject = BANK[run.subject];

    run.locked = false;
    els.quizIndex.textContent = '第 ' + (run.index + 1) + ' / ' + run.questions.length + ' 题';
    els.quizScore.textContent = String(run.score);
    els.progressBar.style.width = (run.index / run.questions.length) * 100 + '%';
    els.quizCombo.hidden = run.combo < 2;
    if (run.combo >= 2) els.quizCombo.textContent = '🔥 连击 ×' + run.combo;

    els.questionTag.textContent = question.point;
    els.questionTag.dataset.subject = run.subject;
    els.questionText.textContent = question.q.replace(/\n/g, '\n');
    if (els.questionFigure) {
      els.questionFigure.innerHTML = figureHtml(question.figure);
      els.questionFigure.hidden = !question.figure;
    }

    els.options.innerHTML = question.options.map(function (option, index) {
      return (
        '<button type="button" class="option" data-index="' + index + '">' +
          '<span class="option__letter" aria-hidden="true">' + LETTERS[index] + '</span>' +
          '<span class="option__text">' + escapeHtml(option.text) + '</span>' +
        '</button>'
      );
    }).join('');

    els.feedback.hidden = true;
    els.feedback.className = 'feedback';
    els.optionButtons = Array.prototype.slice.call(els.options.querySelectorAll('.option'));
    els.optionButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        answer(Number(button.dataset.index));
      });
    });

    els.quizSubject.textContent = subject.label + ' · 期中闯关';
    els.quizSubject.dataset.subject = run.subject;
    els.quizCard.className = 'question-card question-card--' + run.subject;
    window.scrollTo(0, 0);
  }

  function answer(selectedIndex) {
    var run = state.run;
    if (!run || run.locked) return;
    run.locked = true;

    var question = run.questions[run.index];
    var isCorrect = selectedIndex === question.correctIndex;
    var correctText = question.options[question.correctIndex].text;

    if (isCorrect) {
      run.combo += 1;
      run.maxCombo = Math.max(run.maxCombo, run.combo);
      run.score += 100 + Math.min(run.combo - 1, 4) * 20;
    } else {
      run.combo = 0;
    }

    run.answers.push({ selected: selectedIndex, correct: isCorrect });
    els.quizScore.textContent = String(run.score);
    els.quizCombo.hidden = run.combo < 2;
    if (run.combo >= 2) els.quizCombo.textContent = '🔥 连击 ×' + run.combo;
    els.progressBar.style.width = ((run.index + 1) / run.questions.length) * 100 + '%';

    els.optionButtons.forEach(function (button, index) {
      button.disabled = true;
      if (index === question.correctIndex) button.classList.add('is-correct');
      if (index === selectedIndex && !isCorrect) button.classList.add('is-wrong');
      if (index !== selectedIndex && index !== question.correctIndex) button.classList.add('is-muted');
    });

    els.feedback.hidden = false;
    els.feedback.className = 'feedback ' + (isCorrect ? 'feedback--correct' : 'feedback--wrong');
    els.feedbackIcon.textContent = isCorrect ? '✓' : '✕';
    els.feedbackTitle.textContent = isCorrect
      ? '答对啦！' + (run.combo >= 3 ? ' 连击 ×' + run.combo : '')
      : '差一点点，正确答案是「' + correctText + '」';
    els.feedbackText.textContent = question.explain;
    els.nextBtn.textContent = run.index === run.questions.length - 1 ? '查看学习报告 →' : '下一题 →';
    els.nextBtn.className = 'btn btn--primary btn--sm next-btn';

    playSound(isCorrect ? 'correct' : 'wrong');
    window.setTimeout(function () {
      if (typeof els.feedback.scrollIntoView === 'function') {
        els.feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      els.nextBtn.focus({ preventScroll: true });
    }, 120);
  }

  function nextQuestion() {
    var run = state.run;
    if (!run || !run.locked) return;
    if (run.index === run.questions.length - 1) {
      finishRun();
      return;
    }
    run.index += 1;
    renderQuestion();
  }

  function finishRun() {
    var run = state.run;
    if (!run) return;
    stopTimer();

    var total = run.questions.length;
    var correct = run.answers.filter(function (answerItem) { return answerItem.correct; }).length;
    var accuracy = correct / total;
    var stars = accuracy >= 0.9 ? 3 : accuracy >= 0.7 ? 2 : 1;
    var seconds = Math.max(1, Math.round((Date.now() - run.startedAt) / 1000));
    var previous = state.store.best[run.subject];
    var isRecord = !previous ||
      stars > previous.stars ||
      (stars === previous.stars && accuracy >= previous.correct / previous.total);

    if (isRecord) {
      state.store.best[run.subject] = {
        score: run.score,
        stars: stars,
        correct: correct,
        total: total,
        at: Date.now(),
      };
      saveStore();
    }

    var result = {
      subject: run.subject,
      total: total,
      correct: correct,
      accuracy: accuracy,
      stars: stars,
      score: run.score,
      maxCombo: run.maxCombo,
      seconds: seconds,
      isRecord: isRecord,
      questions: run.questions,
      answers: run.answers,
    };

    state.lastResult = result;
    state.run = null;
    renderResult(result);
    showScreen('result');
    updateStarTotal();
    playSound('finish');
    if (stars >= 2) window.setTimeout(launchConfetti, 250);
  }

  function updateStarTotal() {
    els.totalStars.textContent = totalStars() + ' / 9';
  }

  function renderResult(result) {
    var subject = BANK[result.subject];
    var accuracyPercent = Math.round(result.accuracy * 100);
    var title = result.stars === 3 ? '太厉害了，小侦探！' : result.stars === 2 ? '不错，再往前一步！' : '找到进步空间啦！';
    var note = result.stars === 3
      ? '知识点掌握得很扎实，换一科继续挑战吧。'
      : result.stars === 2
        ? '大部分知识点都掌握了，重点看看下面的小建议。'
        : '别着急，先把错题弄懂，再来一次一定更好。';

    els.resultSubject.textContent = subject.label + ' · 期中闯关';
    els.resultSubject.dataset.subject = result.subject;
    els.resultTitle.textContent = title;
    els.resultNote.textContent = note;
    els.resultScore.textContent = String(result.score);
    els.resultStars.innerHTML = [1, 2, 3].map(function (index) {
      return '<span class="star ' + (index <= result.stars ? 'is-on' : '') + '" style="animation-delay:' + (index * 0.12 + 0.1) + 's">★</span>';
    }).join('');
    els.resultStars.setAttribute('aria-label', result.stars + ' 星');

    els.resultChips.innerHTML = [
      { label: '答对', value: result.correct + ' / ' + result.total },
      { label: '正确率', value: accuracyPercent + '%' },
      { label: '最高连击', value: '×' + result.maxCombo },
      { label: '用时', value: formatTime(result.seconds) },
    ].map(function (chip) {
      return '<span class="result-chip"><span>' + chip.label + '</span><b>' + chip.value + '</b></span>';
    }).join('') + (result.isRecord ? '<span class="result-chip result-chip--new">✨ 刷新最佳</span>' : '');

    renderKnowledge(result);
    renderTips(result);
    renderWrongAnswers(result);

    els.retryBtn.textContent = '再战' + subject.label + ' →';
    els.retryBtn.dataset.subject = result.subject;
  }

  function groupByPoint(result) {
    var map = {};
    result.questions.forEach(function (question, index) {
      if (!map[question.point]) map[question.point] = { point: question.point, total: 0, correct: 0 };
      map[question.point].total += 1;
      if (result.answers[index].correct) map[question.point].correct += 1;
    });
    return Object.keys(map).map(function (key) { return map[key]; }).sort(function (a, b) {
      var diff = a.correct / a.total - b.correct / b.total;
      if (diff !== 0) return diff;
      return b.total - a.total;
    });
  }

  function renderKnowledge(result) {
    var groups = groupByPoint(result);
    els.knowledgeList.innerHTML = groups.map(function (group) {
      var percent = Math.round((group.correct / group.total) * 100);
      var level = percent >= 80 ? 'good' : percent >= 60 ? 'mid' : 'weak';
      return (
        '<div class="knowledge-row knowledge-row--' + level + '">' +
          '<div class="knowledge-row__top">' +
            '<span class="knowledge-name">' + escapeHtml(group.point) + '</span>' +
            '<span class="knowledge-count">' + group.correct + ' / ' + group.total + ' 题</span>' +
          '</div>' +
          '<div class="knowledge-bar" role="img" aria-label="' + escapeHtml(group.point) + '正确率 ' + percent + '%">' +
            '<span class="knowledge-bar__fill" style="width:' + Math.max(percent, 4) + '%"></span>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderTips(result) {
    var groups = groupByPoint(result);
    var adviceTable = ADVICE[result.subject] || {};
    var weak = groups.filter(function (group) { return group.correct / group.total < 0.7; });
    var tips = [];

    if (weak.length === 0) {
      tips.push('这次各知识点都掌握得不错，把做对的题讲给家人听，能讲明白才是真掌握。');
    } else {
      weak.slice(0, 3).forEach(function (group) {
        tips.push(adviceTable[group.point] || '把“' + group.point + '”的错题再做一遍，并把解题思路讲给家人听。');
      });
    }

    if (result.correct < result.total) {
      tips.push('把错题遮住答案再做一遍，能独立做对才算真的会了。');
    }
    if (tips.length < 3) {
      tips.push('休息一下眼睛，再选另一科闯关，看看三科里哪一科最拿手。');
    }

    els.tips.innerHTML = tips.map(function (tip, index) {
      return '<li><span class="tip-num">' + (index + 1) + '</span><p>' + escapeHtml(tip) + '</p></li>';
    }).join('');
  }

  function renderWrongAnswers(result) {
    var wrong = [];
    result.questions.forEach(function (question, index) {
      if (!result.answers[index].correct) {
        wrong.push({ question: question, selected: result.answers[index].selected });
      }
    });

    els.wrongCount.textContent = wrong.length ? '共 ' + wrong.length + ' 题' : '全对';
    if (!wrong.length) {
      els.wrongList.innerHTML =
        '<div class="review-empty"><span aria-hidden="true">🎉</span>' +
        '<div><b>没有错题，太棒了！</b><p>可以挑战另一科，或者把这 10 道题讲给家人听。</p></div></div>';
      return;
    }

    els.wrongList.innerHTML = wrong.map(function (item) {
      var question = item.question;
      var selectedText = question.options[item.selected].text;
      var correctText = question.options[question.correctIndex].text;
      return (
        '<article class="review-card">' +
          '<div class="review-card__head">' +
            '<span class="review-card__tag">' + escapeHtml(question.point) + '</span>' +
            '<p class="review-card__q">' + escapeHtml(question.q) + '</p>' +
          '</div>' +
          figureHtml(question.figure) +
          '<div class="review-card__answers">' +
            '<span class="answer-pill answer-pill--wrong">你的答案：' + escapeHtml(selectedText) + '</span>' +
            '<span class="answer-pill answer-pill--right">正确答案：' + escapeHtml(correctText) + '</span>' +
          '</div>' +
          '<p class="review-card__explain"><span aria-hidden="true">💡</span> ' + escapeHtml(question.explain) + '</p>' +
        '</article>'
      );
    }).join('');
  }

  /* ---------- 彩带 ---------- */

  var confettiFrame = null;

  function launchConfetti() {
    if (document.body.dataset.screen !== 'result') return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var canvas = els.confetti;
    var context = canvas.getContext('2d');
    if (!context) return;

    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    var width = window.innerWidth;
    var height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.display = 'block';
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    var colors = ['#FFC93C', '#FF7A67', '#5B8DEF', '#35B97C', '#F49B44'];
    var particles = [];
    for (var i = 0; i < 90; i += 1) {
      particles.push({
        x: width / 2 + (Math.random() - 0.5) * 180,
        y: height * 0.32,
        vx: (Math.random() - 0.5) * 9,
        vy: -Math.random() * 9 - 2,
        w: 6 + Math.random() * 7,
        h: 9 + Math.random() * 7,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.32,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }

    var started = performance.now();
    if (confettiFrame) window.cancelAnimationFrame(confettiFrame);

    function draw(now) {
      var elapsed = now - started;
      context.clearRect(0, 0, width, height);
      particles.forEach(function (particle) {
        particle.vy += 0.28;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.rot += particle.vr;
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.rot);
        context.fillStyle = particle.color;
        context.fillRect(-particle.w / 2, -particle.h / 2, particle.w, particle.h);
        context.restore();
      });
      if (elapsed < 2600) {
        confettiFrame = window.requestAnimationFrame(draw);
      } else {
        context.clearRect(0, 0, width, height);
        canvas.style.display = 'none';
        confettiFrame = null;
      }
    }

    confettiFrame = window.requestAnimationFrame(draw);
  }

  /* ---------- 事件绑定 ---------- */

  function quitQuiz() {
    if (!state.run) return;
    var shouldQuit = window.confirm('这局还没答完，确定要退出吗？');
    if (!shouldQuit) return;
    stopTimer();
    state.run = null;
    showScreen('home');
    renderHome();
  }

  function goHome() {
    stopTimer();
    state.run = null;
    showScreen('home');
    renderHome();
  }

  function bindEvents() {
    els.totalStars = $('#total-stars');
    els.soundToggle = $('#sound-toggle');
    els.heroStart = $('#hero-start');
    els.subjectGrid = $('#subject-grid');
    els.quitQuiz = $('#quit-quiz');
    els.quizSubject = $('#quiz-subject');
    els.quizIndex = $('#q-index');
    els.quizTime = $('#q-time');
    els.quizScore = $('#quiz-score');
    els.quizCombo = $('#q-combo');
    els.progressBar = $('#progress-bar');
    els.quizCard = $('#question-card');
    els.questionTag = $('#q-tag');
    els.questionText = $('#q-text');
    els.questionFigure = $('#q-figure');
    els.options = $('#options');
    els.feedback = $('#feedback');
    els.feedbackIcon = $('#feedback-icon');
    els.feedbackTitle = $('#feedback-title');
    els.feedbackText = $('#feedback-text');
    els.nextBtn = $('#next-btn');
    els.resultSubject = $('#result-subject');
    els.resultTitle = $('#result-title');
    els.resultNote = $('#result-note');
    els.resultScore = $('#result-score');
    els.resultStars = $('#result-stars');
    els.resultChips = $('#result-chips');
    els.knowledgeList = $('#knowledge-list');
    els.tips = $('#tips');
    els.wrongCount = $('#wrong-count');
    els.wrongList = $('#wrong-list');
    els.retryBtn = $('#retry');
    els.confetti = $('#confetti');

    screens.home = $('#screen-home');
    screens.quiz = $('#screen-quiz');
    screens.result = $('#screen-result');

    els.subjectGrid.addEventListener('click', function (event) {
      var card = event.target.closest('.subject-card');
      if (!card) return;
      startRun(card.dataset.subject);
    });

    els.heroStart.addEventListener('click', scrollToSubjects);

    els.quitQuiz.addEventListener('click', quitQuiz);

    els.nextBtn.addEventListener('click', nextQuestion);

    els.retryBtn.addEventListener('click', function () {
      startRun(els.retryBtn.dataset.subject);
    });

    $('#back-home').addEventListener('click', goHome);

    els.soundToggle.addEventListener('click', function () {
      state.store.sound = !state.store.sound;
      saveStore();
      updateSoundButton();
      playSound('click');
    });

    document.addEventListener('keydown', function (event) {
      if (document.body.dataset.screen !== 'quiz' || !state.run) return;
      if (event.key === 'Escape') {
        quitQuiz();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      var run = state.run;
      if (!run.locked) {
        var keyMap = { '1': 0, '2': 1, '3': 2, '4': 3, a: 0, b: 1, c: 2, d: 3 };
        var optionIndex = keyMap[event.key.toLowerCase()];
        if (typeof optionIndex === 'number' && optionIndex < run.questions[run.index].options.length) {
          event.preventDefault();
          answer(optionIndex);
        }
      } else if (event.key === 'Enter' && !(event.target instanceof Element && event.target.closest('button'))) {
        event.preventDefault();
        nextQuestion();
      }
    });

    $('#brand-home').addEventListener('click', function (event) {
      event.preventDefault();
      if (document.body.dataset.screen === 'quiz' && state.run) {
        quitQuiz();
        return;
      }
      goHome();
    });
  }

  function init() {
    if (!BANK) {
      document.body.innerHTML = '<p style="padding:2rem">题库加载失败，请检查 assets/questions.js。</p>';
      return;
    }
    bindEvents();
    renderHome();
    renderBankNote();
    updateSoundButton();
    showScreen('home');
    window.quizGame = {
      startRun: startRun,
      state: state,
      bank: BANK,
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
