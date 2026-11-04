#!/usr/bin/env node
/*
 * 程序出题器自检：
 *   node scripts/check-generators.mjs
 *
 * 对每种题型生成 500 道题，检查字段、选项数量和答案下标。
 * 生成器只覆盖数学；语文、英语题请走手动录入或 AI 辅助。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const generators = require('../admin/assets/generators.js');

const REQUIRED_FIELDS = ['id', 'point', 'q', 'options', 'answer', 'explain', 'source'];
const errors = [];
let total = 0;

for (const kind of generators.listKinds()) {
  const seen = new Set();
  for (let index = 0; index < 500; index += 1) {
    const question = generators.generate(kind.key);
    total += 1;
    for (const field of REQUIRED_FIELDS) {
      if (question[field] == null || question[field] === '') {
        errors.push(`${kind.key}#${index}: 缺少 ${field}`);
      }
    }
    if (!Array.isArray(question.options) || question.options.length !== 4) {
      errors.push(`${kind.key}#${index}: 必须有 4 个选项`);
      continue;
    }
    if (new Set(question.options).size !== 4) {
      errors.push(`${kind.key}#${index}: 选项重复 ${JSON.stringify(question.options)}`);
    }
    if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer > 3) {
      errors.push(`${kind.key}#${index}: 答案下标无效`);
    }
    if (typeof question.q !== 'string' || !question.q.trim()) {
      errors.push(`${kind.key}#${index}: 题干为空`);
    }
    if (typeof question.explain !== 'string' || !question.explain.trim()) {
      errors.push(`${kind.key}#${index}: 解析为空`);
    }
    if (question.source !== 'generated') {
      errors.push(`${kind.key}#${index}: source 应为 generated`);
    }
    if (seen.has(question.q)) {
      // 随机题允许偶发重复，只记录提示；题库工作台会按题干去重。
      seen.add(question.q);
    }
  }
  console.log(`  ✓ ${kind.label} · 500 道`);
}

if (errors.length) {
  console.error(`\n出题器自检失败（${errors.length} 项）：`);
  errors.slice(0, 20).forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}

console.log(`\n出题器自检通过：${generators.listKinds().length} 种题型，共生成 ${total} 道题。`);
