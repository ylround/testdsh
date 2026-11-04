/*
 * 题库工作台 · 程序出题器
 * 只生成答案可计算的数学题；生成结果仍会经过 admin.js 的统一校验。
 * 浏览器挂到 window.QuizGenerators，Node 下可 require 用于自检。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuizGenerators = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function choice(list) {
    return list[randInt(0, list.length - 1)];
  }

  function shuffle(list) {
    var copy = list.slice();
    for (var i = copy.length - 1; i > 0; i -= 1) {
      var j = randInt(0, i);
      var temp = copy[i];
      copy[i] = copy[j];
      copy[j] = temp;
    }
    return copy;
  }

  function trimNumber(value) {
    var text = Number(value.toFixed(6)).toString();
    return text;
  }

  function uniqueOptions(correct, candidates) {
    var options = [trimNumber(correct)];
    var seen = new Set(options);
    candidates.forEach(function (item) {
      var value = trimNumber(item);
      if (options.length < 4 && !seen.has(value)) {
        options.push(value);
        seen.add(value);
      }
    });
    var guard = 0;
    while (options.length < 4 && guard < 30) {
      guard += 1;
      var base = Number(trimNumber(correct));
      var delta = choice([0.1, 0.2, 0.5, 1, 2, 10]);
      var candidate = trimNumber(base + delta * (guard % 2 === 0 ? 1 : -1));
      if (!seen.has(candidate)) {
        options.push(candidate);
        seen.add(candidate);
      }
    }
    var shuffled = shuffle(options);
    return { options: shuffled, answer: shuffled.indexOf(trimNumber(correct)) };
  }

  function withIdentity(kind, point, q, options, answer, explain) {
    return {
      id: 'ma-g-' + Date.now().toString(36) + '-' + randInt(100, 999),
      point: point,
      q: q,
      options: options,
      answer: answer,
      explain: explain,
      source: 'generated',
      createdAt: new Date().toISOString(),
      generator: kind,
    };
  }

  function decimalMultiply() {
    var aScale = randInt(1, 2);
    var bScale = randInt(0, 1);
    var aScaled = randInt(aScale === 1 ? 11 : 101, aScale === 1 ? 99 : 999);
    var bScaled = randInt(bScale === 0 ? 2 : 11, bScale === 0 ? 9 : 29);
    var a = aScaled / Math.pow(10, aScale);
    var b = bScaled / Math.pow(10, bScale);
    var productScaled = aScaled * bScaled;
    var scale = aScale + bScale;
    var product = productScaled / Math.pow(10, scale);
    var distractors = [product * 10, product / 10, product + 0.1, product * 100];
    var built = uniqueOptions(product, distractors);
    return withIdentity(
      'decimal-multiply',
      '小数乘法',
      '计算：' + trimNumber(a) + ' × ' + trimNumber(b) + ' = ?',
      built.options,
      built.answer,
      '先按整数相乘，两个因数一共有 ' + scale + ' 位小数，就从积的右边数出 ' + scale + ' 位点上小数点，结果是 ' + trimNumber(product) + '。'
    );
  }

  function decimalDivide() {
    var divisorScaled = randInt(2, 25);
    var quotientScaled = randInt(11, 99);
    var divisorScale = 1;
    var quotientScale = 1;
    var dividendScaled = divisorScaled * quotientScaled;
    var dividend = dividendScaled / Math.pow(10, divisorScale + quotientScale);
    var divisor = divisorScaled / Math.pow(10, divisorScale);
    var quotient = quotientScaled / Math.pow(10, quotientScale);
    var distractors = [quotient * 10, quotient / 10, quotient + 0.1, quotient + 1];
    var built = uniqueOptions(quotient, distractors);
    return withIdentity(
      'decimal-divide',
      '小数除法',
      '计算：' + trimNumber(dividend) + ' ÷ ' + trimNumber(divisor) + ' = ?',
      built.options,
      built.answer,
      '把除数 ' + trimNumber(divisor) + ' 的小数点向右移动一位变成 ' + divisorScaled +
        '，被除数也同时扩大 10 倍，再按除数是整数的除法计算，商是 ' + trimNumber(quotient) + '。'
    );
  }

  function simplify() {
    var mode = randInt(1, 3);
    var a;
    var answer;
    var q;
    var explain;
    var distractors;
    if (mode === 1) {
      var pair = choice([
        { a: 0.25, b: 4 },
        { a: 0.5, b: 2 },
        { a: 2.5, b: 4 },
        { a: 1.25, b: 8 },
      ]);
      var midScaled = randInt(11, 99);
      var mid = midScaled / 10;
      answer = pair.a * pair.b * mid;
      q = '用简便方法计算：' + trimNumber(pair.a) + ' × ' + trimNumber(mid) + ' × ' + pair.b + ' = ?';
      explain = trimNumber(pair.a) + ' × ' + pair.b + ' = ' + trimNumber(pair.a * pair.b) +
        '，再用 ' + trimNumber(pair.a * pair.b) + ' × ' + trimNumber(mid) + ' = ' + trimNumber(answer) + '。';
      distractors = [answer * 10, answer / 10, answer + 0.1, answer + 1];
    } else if (mode === 2) {
      a = randInt(11, 99) / 10;
      answer = a * 9.9;
      q = '用简便方法计算：' + trimNumber(a) + ' × 9.9 = ?';
      explain = '把 9.9 看成 10 − 0.1，' + trimNumber(a) + ' × 10 = ' + trimNumber(a * 10) +
        '，再减去 ' + trimNumber(a) + ' × 0.1 = ' + trimNumber(a / 10) + '，结果是 ' + trimNumber(answer) + '。';
      distractors = [a * 10, a * 9, a * 10 - a / 100, answer + 0.1];
    } else {
      a = randInt(11, 99) / 10;
      answer = a * 10.1;
      q = '用简便方法计算：' + trimNumber(a) + ' × 10.1 = ?';
      explain = '把 10.1 看成 10 + 0.1，' + trimNumber(a) + ' × 10 = ' + trimNumber(a * 10) +
        '，再加上 ' + trimNumber(a) + ' × 0.1 = ' + trimNumber(a / 10) + '，结果是 ' + trimNumber(answer) + '。';
      distractors = [a * 10, a * 10.1 + 1, a * 10 - a / 10, answer + 0.1];
    }
    var built = uniqueOptions(answer, distractors);
    return withIdentity('simplify', '简便运算', q, built.options, built.answer, explain);
  }

  function position() {
    var x = randInt(1, 9);
    var y = randInt(1, 9);
    while (y === x) y = randInt(1, 9);
    var correct = '(' + x + ', ' + y + ')';
    var options = [correct, '(' + y + ', ' + x + ')', '(' + x + ', ' + (y + 1) + ')', '(' + (x + 1) + ', ' + y + ')'];
    var shuffled = shuffle(options);
    return withIdentity(
      'position',
      '位置',
      '在方格图上，点 A 在第 ' + x + ' 列、第 ' + y + ' 行，用数对表示是？',
      shuffled,
      shuffled.indexOf(correct),
      '数对先写列、再写行，所以点 A 的位置是 ' + correct + '。'
    );
  }

  var generators = {
    'decimal-multiply': { label: '小数乘法', run: decimalMultiply, hint: '积的小数位数等于两个因数小数位数之和。' },
    'decimal-divide': { label: '小数除法', run: decimalDivide, hint: '把除数转化成整数，再按整数除法计算。' },
    simplify: { label: '简便运算', run: simplify, hint: '凑整、乘法分配律，先观察再计算。' },
    position: { label: '位置（数对）', run: position, hint: '数对先列后行。' },
  };

  function generate(kind) {
    var generator = generators[kind] || generators['decimal-multiply'];
    return generator.run();
  }

  function listKinds() {
    return Object.keys(generators).map(function (key) {
      return { key: key, label: generators[key].label, hint: generators[key].hint };
    });
  }

  return { generate: generate, listKinds: listKinds, generators: generators };
});
