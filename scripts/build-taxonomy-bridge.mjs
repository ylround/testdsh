#!/usr/bin/env node
/*
 * 从 cn-math-taxonomy 生成教材中心/题库后台的桥接数据：
 *   textbooks/assets/taxonomy.json            知识点、先修关系、单元映射、题量统计
 *   textbooks/assets/taxonomy-questions.json  只包含三本教材相关单元的题目（默认导出选择题）
 *
 * 运行：
 *   node scripts/build-taxonomy-bridge.mjs
 *
 * 数据来源：cn-math-taxonomy/data/{topics,dependencies,questions}.json
 * 许可证：CC BY-NC 4.0，仅个人学习、教学和研究使用；生成文件保留来源说明。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAXONOMY = path.join(ROOT, 'cn-math-taxonomy');
const OUT_BRIDGE = path.join(ROOT, 'textbooks', 'assets', 'taxonomy.json');
const OUT_QUESTIONS = path.join(ROOT, 'textbooks', 'assets', 'taxonomy-questions.json');

// 教材单元 → 知识图谱知识点。显式映射，避免靠字符串模糊匹配出错。
const UNIT_TOPICS = {
  'cn-g5-v1': {
    '第一单元': ['cnc_p323', 'cnc_p324', 'cnc_p325', 'cnc_p326', 'cnc_p327', 'cnc_p358'],
    '第二单元': ['cnc_p328', 'cnc_p329', 'cnc_p330', 'cnc_p331', 'cnc_p332', 'cnc_p333', 'cnc_p334'],
    '第三单元': ['cnc_p335', 'cnc_p336', 'cnc_p337', 'cnc_p338'],
    '第四单元': ['cnc_p339', 'cnc_p340', 'cnc_p341', 'cnc_p342', 'cnc_p343', 'cnc_p344', 'cnc_p345'],
    '第五单元': ['cnc_p346', 'cnc_p347', 'cnc_p348'],
    '第六单元': ['cnc_p349', 'cnc_p350', 'cnc_p351', 'cnc_p352', 'cnc_p353'],
    '第七单元': ['cnc_p354', 'cnc_p355', 'cnc_p356', 'cnc_p357', 'cnc_p359'],
    '第八单元': ['cnc_p360', 'cnc_p361', 'cnc_p362', 'cnc_p363'],
  },
  'ma-g5-v1': {
    '第一单元': ['cnm_p132', 'cnm_p133', 'cnm_p134', 'cnm_p135'],
    '第二单元': ['cnm_p136'],
    '第三单元': ['cnm_p137', 'cnm_p138', 'cnm_p139'],
    '第四单元': ['cnm_p140', 'cnm_p141'],
    '第五单元': ['cnm_p142', 'cnm_p143', 'cnm_p144', 'cnm_p145', 'cnm_p146'],
    '第六单元': ['cnm_p240', 'cnm_p147', 'cnm_p148', 'cnm_p149', 'cnm_p150', 'cnm_p098'],
    '第七单元': ['cnm_p151'],
    '第八单元': ['cnm_p135', 'cnm_p143', 'cnm_p145', 'cnm_p146', 'cnm_p151'],
  },
  'en-g5-v1': {
    'Unit 1': ['cne_p108', 'cne_p198', 'cne_p109', 'cne_p110', 'cne_p111', 'cne_p112'],
    'Unit 2': ['cne_p113', 'cne_p114', 'cne_p115', 'cne_p116', 'cne_p117'],
    'Unit 3': ['cne_p118', 'cne_p119', 'cne_p120'],
    'Recycle 1': [
      'cne_p108', 'cne_p198', 'cne_p109', 'cne_p110', 'cne_p111', 'cne_p112',
      'cne_p113', 'cne_p114', 'cne_p115', 'cne_p116', 'cne_p117',
      'cne_p118', 'cne_p119', 'cne_p120',
    ],
    'Unit 4': ['cne_p121', 'cne_p122', 'cne_p123', 'cne_p124', 'cne_p167'],
    'Unit 5': ['cne_p125', 'cne_p126', 'cne_p127', 'cne_p128'],
    'Unit 6': ['cne_p129', 'cne_p130', 'cne_p131', 'cne_p132'],
    'Recycle 2': [
      'cne_p121', 'cne_p122', 'cne_p123', 'cne_p124', 'cne_p167',
      'cne_p125', 'cne_p126', 'cne_p127', 'cne_p128',
      'cne_p129', 'cne_p130', 'cne_p131', 'cne_p132',
    ],
  },
};

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(TAXONOMY, relativePath), 'utf8'));
}

function subjectOf(topic) {
  return topic.subject || 'math';
}

function countQuestions(questions) {
  let choice = 0;
  let numeric = 0;
  questions.forEach((question) => {
    if (question.type === 'choice') choice += 1;
    else if (question.type === 'numeric') numeric += 1;
  });
  return { total: questions.length, choice, numeric };
}

const topics = readJson('data/topics.json');
const dependencies = readJson('data/dependencies.json');
const questions = readJson('data/questions.json');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'textbooks', 'assets', 'books.json'), 'utf8'));

const topicById = new Map(topics.map((topic) => [topic.id, topic]));
const questionsByTopic = new Map();
questions.forEach((question) => {
  if (!questionsByTopic.has(question.topicId)) questionsByTopic.set(question.topicId, []);
  questionsByTopic.get(question.topicId).push(question);
});
const prerequisitesByTopic = new Map();
dependencies.forEach((edge) => {
  if (!prerequisitesByTopic.has(edge.topicId)) prerequisitesByTopic.set(edge.topicId, []);
  prerequisitesByTopic.get(edge.topicId).push(edge);
});

const bookById = new Map(manifest.books.map((book) => [book.id, book]));
const allMappedIds = new Set();
const errors = [];

const bridgeBooks = {};
const bridgeTopics = {};
const questionsOut = [];

for (const [bookId, unitMap] of Object.entries(UNIT_TOPICS)) {
  const book = bookById.get(bookId);
  if (!book) {
    errors.push(`教材 ${bookId} 不在 books.json 中`);
    continue;
  }
  const bookUnits = {};
  for (const [unitNo, topicIds] of Object.entries(unitMap)) {
    const unit = book.units.find((item) => item.no === unitNo);
    if (!unit) {
      errors.push(`${bookId} 缺少单元 ${unitNo}`);
      continue;
    }
    const uniqueIds = [...new Set(topicIds)];
    uniqueIds.forEach((id) => {
      if (!topicById.has(id)) {
        errors.push(`${bookId} ${unitNo} 引用了不存在的知识点 ${id}`);
        return;
      }
      const topic = topicById.get(id);
      if (subjectOf(topic) !== book.subject) {
        errors.push(`${bookId} ${unitNo} 的 ${id} 属于 ${subjectOf(topic)}，与教材科目 ${book.subject} 不符`);
      }
      allMappedIds.add(id);
    });
    const unitQuestions = uniqueIds.reduce((sum, id) => sum + (questionsByTopic.get(id) || []).length, 0);
    const unitChoice = uniqueIds.reduce((sum, id) => {
      return sum + (questionsByTopic.get(id) || []).filter((q) => q.type === 'choice').length;
    }, 0);
    bookUnits[unitNo] = {
      topicIds: uniqueIds,
      questionCount: unitQuestions,
      choiceCount: unitChoice,
      numericCount: unitQuestions - unitChoice,
    };
  }
  bridgeBooks[bookId] = {
    subject: book.subject,
    label: book.label,
    title: book.title,
    units: bookUnits,
  };
}

for (const topicId of [...allMappedIds].sort()) {
  const topic = topicById.get(topicId);
  const topicQuestions = questionsByTopic.get(topicId) || [];
  const counts = countQuestions(topicQuestions);
  const prerequisites = (prerequisitesByTopic.get(topicId) || [])
    .filter((edge) => allMappedIds.has(edge.prerequisiteId))
    .slice(0, 8)
    .map((edge) => ({
      id: edge.prerequisiteId,
      name: topicById.get(edge.prerequisiteId).name,
      strength: edge.strength,
    }));
  bridgeTopics[topicId] = {
    id: topicId,
    subject: subjectOf(topic),
    name: topic.name,
    grade: topic.grade,
    semester: topic.semester,
    chapter: topic.chapter,
    domain: topic.domain,
    type: topic.type,
    description: topic.description,
    masteryCriteria: topic.mastery_criteria || [],
    diagnosticQuestion: topic.diagnostic_question || null,
    standards: topic.standards || [],
    prerequisites,
    questionCount: counts.total,
    choiceCount: counts.choice,
    numericCount: counts.numeric,
    crossGrade: topic.grade !== 5,
  };
  topicQuestions.forEach((question) => {
    questionsOut.push({
      id: question.id,
      topicId,
      topicName: topic.name,
      subject: subjectOf(topic),
      type: question.type,
      prompt: question.prompt,
      choices: question.choices || null,
      answer: question.answer,
      explanation: question.explanation,
      difficulty: question.difficulty || '',
      verify: question.verify || '',
    });
  });
}

const subjectTotals = {};
['chinese', 'math', 'english'].forEach((subject) => {
  const ids = [...allMappedIds].filter((id) => bridgeTopics[id].subject === subject);
  const totals = ids.reduce((sum, id) => {
    sum.topicCount += 1;
    sum.questionCount += bridgeTopics[id].questionCount;
    sum.choiceCount += bridgeTopics[id].choiceCount;
    sum.numericCount += bridgeTopics[id].numericCount;
    return sum;
  }, { topicCount: 0, questionCount: 0, choiceCount: 0, numericCount: 0 });
  subjectTotals[subject] = {
    ...totals,
    bookId: manifest.books.find((book) => book.subject === subject).id,
  };
});

if (errors.length) {
  console.error('桥接数据生成失败：');
  errors.forEach((error) => console.error('  - ' + error));
  process.exit(1);
}

questionsOut.sort((a, b) => a.id.localeCompare(b.id));
const generatedAt = new Date().toISOString();
const source = {
  label: 'cn-math-taxonomy',
  url: 'https://github.com/xiaoyang111222/cn-math-taxonomy',
  license: 'CC BY-NC 4.0',
  note: '知识点、先修关系和题库来自 cn-math-taxonomy；仅限个人学习、教学和研究使用，商业使用需另行授权。',
  generatedAt,
};

const bridge = {
  generatedAt,
  source,
  books: bridgeBooks,
  topics: bridgeTopics,
  subjects: subjectTotals,
  counts: {
    topics: Object.keys(bridgeTopics).length,
    questions: questionsOut.length,
    choice: questionsOut.filter((q) => q.type === 'choice').length,
    numeric: questionsOut.filter((q) => q.type === 'numeric').length,
  },
};

writeFileSync(OUT_BRIDGE, JSON.stringify(bridge, null, 2) + '\n');
writeFileSync(OUT_QUESTIONS, JSON.stringify({ generatedAt, source, questions: questionsOut }, null, 2) + '\n');

console.log(`已写入 ${path.relative(ROOT, OUT_BRIDGE)}`);
console.log(`已写入 ${path.relative(ROOT, OUT_QUESTIONS)}`);
console.log(`  知识点 ${bridge.counts.topics} 个，题目 ${bridge.counts.questions} 道（选择 ${bridge.counts.choice} / 数值 ${bridge.counts.numeric}）`);
console.log(`  语文 ${subjectTotals.chinese.topicCount} 点 / ${subjectTotals.chinese.questionCount} 题`);
console.log(`  数学 ${subjectTotals.math.topicCount} 点 / ${subjectTotals.math.questionCount} 题`);
console.log(`  英语 ${subjectTotals.english.topicCount} 点 / ${subjectTotals.english.questionCount} 题`);
