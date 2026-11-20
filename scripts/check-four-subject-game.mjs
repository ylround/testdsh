#!/usr/bin/env node
/*
 * 四科探险队 · 题库与页面自检
 * 用法：node scripts/check-four-subject-game.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function fail(message) {
  errors.push(message);
}

function read(relative) {
  const full = join(root, relative);
  if (!existsSync(full)) {
    fail(`缺少文件：${relative}`);
    return '';
  }
  return readFileSync(full, 'utf8');
}

const bankSource = read('four-subject-game/assets/questions.js');
const sandbox = { window: {} };
vm.createContext(sandbox);
try {
  vm.runInContext(bankSource, sandbox, { filename: 'questions.js' });
} catch (error) {
  fail(`questions.js 无法执行：${error.message}`);
}

const bank = sandbox.window.FOUR_SUBJECT_BANK;
if (!bank || !Array.isArray(bank.subjects)) {
  fail('window.FOUR_SUBJECT_BANK 不存在或没有 subjects 数组');
  report();
  process.exit(1);
}

const expectedSubjects = ['chinese', 'math', 'english', 'science'];
const expectedNames = ['语文', '数学', '英语', '科学'];
const allIds = new Set();
const questionTexts = new Set();
let questionCount = 0;
let levelCount = 0;

if (bank.subjects.length !== 4) fail(`应有 4 个科目，实际 ${bank.subjects.length} 个`);

bank.subjects.forEach((subject, subjectIndex) => {
  const where = `科目[${subjectIndex}]`;
  if (!expectedSubjects.includes(subject.id)) fail(`${where} id 不是预期的四科之一：${subject.id}`);
  if (expectedNames[subjectIndex] !== subject.name) {
    fail(`${where} 名称顺序不符合预期：${subject.name}`);
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(subject.color || '')) fail(`${where} color 不是 6 位十六进制颜色`);
  if (!subject.planet || !subject.tagline || !subject.intro) fail(`${where} 缺少 planet/tagline/intro`);
  if (!Array.isArray(subject.levels) || subject.levels.length !== 3) {
    fail(`${where} 应有 3 个关卡，实际 ${subject.levels ? subject.levels.length : 0} 个`);
    return;
  }
  levelCount += subject.levels.length;

  subject.levels.forEach((level, levelIndex) => {
    const levelWhere = `${where} 关卡[${levelIndex}] ${level.id || '(无 id)'}`;
    if (!level.id) fail(`${levelWhere} 缺少 id`);
    else if (allIds.has(level.id)) fail(`${levelWhere} id 重复`);
    else allIds.add(level.id);

    if (!level.name || !level.subtitle) fail(`${levelWhere} 缺少 name/subtitle`);
    if (!Array.isArray(level.topics) || level.topics.length === 0) {
      fail(`${levelWhere} 缺少 topics`);
      return;
    }
    const topicNames = new Set();
    level.topics.forEach((topic, topicIndex) => {
      if (!topic.name) fail(`${levelWhere} topics[${topicIndex}] 缺少 name`);
      if (!topic.tip || topic.tip.length < 8) fail(`${levelWhere} topics[${topicIndex}] 缺少有效 tip`);
      if (topicNames.has(topic.name)) fail(`${levelWhere} topic 重复：${topic.name}`);
      topicNames.add(topic.name);
    });

    if (!Array.isArray(level.questions) || level.questions.length !== 6) {
      fail(`${levelWhere} 应有 6 道题，实际 ${level.questions ? level.questions.length : 0} 道`);
      return;
    }

    const usedTopics = new Set();
    level.questions.forEach((question, questionIndex) => {
      const qWhere = `${levelWhere} 题目[${questionIndex}] ${question.id || '(无 id)'}`;
      questionCount += 1;

      if (!question.id) fail(`${qWhere} 缺少 id`);
      else if (allIds.has(question.id)) fail(`${qWhere} id 重复`);
      else allIds.add(question.id);

      if (!question.topic || !topicNames.has(question.topic)) {
        fail(`${qWhere} topic 不在本关 topics 中：${question.topic}`);
      } else {
        usedTopics.add(question.topic);
      }
      if (!question.q || question.q.trim().length < 6) fail(`${qWhere} 题干过短`);
      else if (questionTexts.has(question.q)) fail(`${qWhere} 题干重复`);
      else questionTexts.add(question.q);

      if (!Array.isArray(question.options) || question.options.length < 3 || question.options.length > 4) {
        fail(`${qWhere} 应有 3–4 个选项，实际 ${question.options ? question.options.length : 0} 个`);
        return;
      }
      const options = new Set();
      question.options.forEach((option) => {
        if (typeof option !== 'string' || !option.trim()) fail(`${qWhere} 有空选项`);
        if (options.has(option)) fail(`${qWhere} 选项重复：${option}`);
        options.add(option);
      });
      if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= question.options.length) {
        fail(`${qWhere} answer 下标越界：${question.answer}`);
      }
      if (!question.explain || question.explain.length < 10) fail(`${qWhere} 缺少足够长的解析`);
    });

    level.topics.forEach((topic) => {
      if (!usedTopics.has(topic.name)) fail(`${levelWhere} topic 没有对应题目：${topic.name}`);
    });

    if (level.questions.length !== 6) fail(`${levelWhere} 题目数量不是 6`);
  });
});

if (levelCount !== 12) fail(`应有 12 个关卡，实际 ${levelCount} 个`);
if (questionCount !== 72) fail(`应有 72 道题，实际 ${questionCount} 道`);

if (bank.meta) {
  if (bank.meta.levelCount !== 12) fail(`meta.levelCount 应为 12，实际 ${bank.meta.levelCount}`);
  if (bank.meta.questionCount !== 72) fail(`meta.questionCount 应为 72，实际 ${bank.meta.questionCount}`);
  if (bank.meta.totalStars !== 36) fail(`meta.totalStars 应为 36，实际 ${bank.meta.totalStars}`);
}

/* ---------- 页面与静态资源 ---------- */

const html = read('four-subject-game/index.html');
const css = read('four-subject-game/assets/styles.css');
const js = read('four-subject-game/assets/game.js');
read('four-subject-game/assets/favicon.svg');

const requiredIds = [
  'total-stars', 'sound-toggle', 'screen-home', 'screen-planet', 'screen-quiz', 'screen-result',
  'planet-grid', 'planet-hero', 'level-list', 'daily-card', 'daily-best', 'daily-streak',
  'daily-start', 'quiz-title', 'quiz-score', 'quiz-progress', 'quiz-progress-fill',
  'quiz-progress-label', 'quiz-subject-chip', 'quiz-topic', 'quiz-combo', 'quiz-question',
  'quiz-options', 'quiz-feedback', 'feedback-icon', 'feedback-title', 'feedback-explain',
  'quiz-continue', 'result-content', 'toast', 'confirm-dialog', 'confetti',
];
requiredIds.forEach((id) => {
  if (!new RegExp(`id=["']${id}["']`).test(html)) fail(`index.html 缺少 #${id}`);
});

if (!/questions\.js/.test(html) || !/game\.js/.test(html)) fail('index.html 未正确引入 questions.js / game.js');
if (html.indexOf('questions.js') > html.indexOf('game.js')) fail('index.html 中 questions.js 应在 game.js 之前引入');
if (!/styles\.css/.test(html)) fail('index.html 未引入 styles.css');

const offlineSources = [
  ['index.html', html],
  ['styles.css', css],
  ['game.js', js],
];
offlineSources.forEach(([name, source]) => {
  if (/https?:\/\//.test(source)) fail(`${name} 含有外部网络地址，破坏离线运行`);
  if (/@import\s+url/i.test(source)) fail(`${name} 含有外部 @import`);
  if (/\bfetch\s*\(/.test(source)) fail(`${name} 使用了 fetch，file:// 打开时会失败`);
});

if (!/localStorage/.test(js)) fail('game.js 没有使用 localStorage 保存进度');
if (!/prefers-reduced-motion/.test(css)) fail('styles.css 没有处理减少动效偏好');

/* ---------- 输出 ---------- */

function report() {
  if (errors.length) {
    console.error(`四科探险队自检失败：${errors.length} 个问题`);
    errors.forEach((message) => console.error(`  ✗ ${message}`));
    process.exitCode = 1;
  } else {
    const subjectSummary = bank.subjects
      .map((subject) => `${subject.name} ${subject.levels.length} 关/${subject.levels.reduce((sum, level) => sum + level.questions.length, 0)} 题`)
      .join('，');
    console.log('四科探险队自检通过');
    console.log(`  科目：${subjectSummary}`);
    console.log(`  合计：${levelCount} 关 / ${questionCount} 题 / ${bank.meta ? bank.meta.totalStars : 36} 颗星`);
    console.log(`  资源：index.html + styles.css + game.js + questions.js + favicon.svg`);
  }
}

report();
