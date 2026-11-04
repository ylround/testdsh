#!/usr/bin/env node
/*
 * 把教材 PDF 下载到 textbooks/files/，供本地阅读器优先使用。
 *
 *   node scripts/fetch-textbooks.mjs
 *   node scripts/fetch-textbooks.mjs --book cn-g5-v1
 *   node scripts/fetch-textbooks.mjs --force
 *
 * 版权提醒：这些 PDF 的版权归原出版方所有，只适合个人学习使用。
 * textbooks/files/ 已在 .gitignore 中忽略，不会随 git 提交，也不应公开再分发。
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(ROOT, 'textbooks', 'assets', 'books.json');
const argumentsList = process.argv.slice(2);
const force = argumentsList.includes('--force');
const bookIndex = argumentsList.indexOf('--book');
const onlyBook = bookIndex !== -1 ? argumentsList[bookIndex + 1] : '';

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const books = (manifest.books || []).filter((book) => !onlyBook || book.id === onlyBook);

if (!books.length) {
  console.error(onlyBook ? `找不到教材：${onlyBook}` : '教材目录为空');
  process.exit(1);
}

console.log('教材 PDF 只用于个人学习；下载文件保存在 textbooks/files/，不会提交到 git。\n');

for (const book of books) {
  if (!book.localPdf) {
    console.log(`- ${book.id} 没有配置 localPdf，跳过`);
    continue;
  }
  const target = path.join(ROOT, 'textbooks', book.localPdf);
  if (existsSync(target) && !force) {
    console.log(`- ${book.label} ${book.grade} 已存在，跳过：${path.relative(ROOT, target)}`);
    continue;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  const temp = target + '.part';
  console.log(`- 正在下载 ${book.label} ${book.grade}…`);
  console.log(`  ${book.pdf}`);
  let response;
  try {
    response = await fetch(book.pdf, { redirect: 'follow' });
  } catch (error) {
    console.error(`  下载失败：${error.message}`);
    process.exitCode = 1;
    continue;
  }
  if (!response.ok || !response.body) {
    console.error(`  下载失败：HTTP ${response.status}`);
    process.exitCode = 1;
    continue;
  }
  const total = Number(response.headers.get('content-length')) || 0;
  let received = 0;
  let lastReport = 0;
  const startedAt = Date.now();
  const source = Readable.fromWeb(response.body);
  source.on('data', (chunk) => {
    received += chunk.length;
    const now = Date.now();
    if (now - lastReport > 1000) {
      lastReport = now;
      const percent = total ? Math.round((received / total) * 100) : 0;
      const speed = received / 1024 / Math.max(1, (now - startedAt) / 1000);
      process.stdout.write(`\r  ${percent}% · ${(received / 1024 / 1024).toFixed(1)} MB · ${speed.toFixed(0)} KB/s   `);
    }
  });
  try {
    await pipeline(source, createWriteStream(temp));
  } catch (error) {
    console.error(`\n  写入失败：${error.message}`);
    rmSync(temp, { force: true });
    process.exitCode = 1;
    continue;
  }
  process.stdout.write('\n');
  const header = readFileSync(temp).subarray(0, 5).toString('latin1');
  if (header !== '%PDF-') {
    console.error('  文件不是有效的 PDF，已删除临时文件。');
    rmSync(temp, { force: true });
    process.exitCode = 1;
    continue;
  }
  renameSync(temp, target);
  console.log(`  已保存：${path.relative(ROOT, target)}（${(received / 1024 / 1024).toFixed(1)} MB）`);
}

console.log('\n完成。运行 node scripts/check-textbooks.mjs 可以检查目录和本地副本。');
