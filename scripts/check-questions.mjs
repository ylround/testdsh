/*
 * 题库自检：node scripts/check-questions.mjs
 * 校验每题都有知识点、解析、3–4 个不重复选项和合法的答案下标。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/questions.js', import.meta.url), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
const bank = sandbox.window && sandbox.window.QUIZ_BANK;

const errors = [];
const seenIds = new Set();
const subjects = ['chinese', 'math', 'english'];
let total = 0;

if (!bank) {
  console.error('找不到 window.QUIZ_BANK');
  process.exit(1);
}

for (const key of subjects) {
  const subject = bank[key];
  if (!subject) {
    errors.push(`缺少科目 ${key}`);
    continue;
  }
  const questions = subject.questions || [];
  if (questions.length < 10) errors.push(`${key} 题量不足 10（${questions.length}）`);
  for (const question of questions) {
    total += 1;
    if (!question.id || seenIds.has(question.id)) errors.push(`${key}: 题号缺失或重复 ${question.id}`);
    seenIds.add(question.id);
    for (const field of ['point', 'q', 'explain']) {
      if (typeof question[field] !== 'string' || !question[field].trim()) {
        errors.push(`${question.id}: 缺少 ${field}`);
      }
    }
    if (!Array.isArray(question.options) || question.options.length < 3 || question.options.length > 4) {
      errors.push(`${question.id}: 必须有 3–4 个选项`);
      continue;
    }
    if (new Set(question.options).size !== question.options.length) {
      errors.push(`${question.id}: 选项重复`);
    }
    if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= question.options.length) {
      errors.push(`${question.id}: 答案下标无效`);
    }
  }
}

if (errors.length) {
  console.error(`题库自检失败（${errors.length} 项）：`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`题库自检通过：3 科，共 ${total} 题（语文 ${bank.chinese.questions.length}、数学 ${bank.math.questions.length}、英语 ${bank.english.questions.length}）。`);
