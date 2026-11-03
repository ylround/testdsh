# testdsh

dsh-superagent 联调仓库。

## 五年级期中闯关小游戏

`index.html` 是一个无需联网、双击即可打开的静态小游戏，用来在期中前检测五年级上学期三科的学习情况。

- **语文**：人教部编版第 1–4 单元，字词、古诗、课文理解、修辞和说明方法。
- **数学**：人教版小数乘法、小数除法、简便运算、位置与解决问题。
- **英语**：PEP 五年级上册 Unit 1–3，人物、星期、食物相关词汇和句型。
- 每次从题库随机抽 10 题，选项顺序打乱；答完给出正确率、知识点掌握、学习建议和错题回顾。
- 答错的题自动收进错题本；同一题连续答对 2 次标记为掌握，可用“错题重练”按错误次数和复习时间优先抽题。
- 首页学习档案记录累计答题、总正确率、连续学习天数和待复习错题，并按知识点汇总薄弱项。
- 成绩、错题、学习档案和音效偏好只保存在当前浏览器的 `localStorage` 中。

打开方式：直接双击 `index.html`，或在仓库目录运行 `python3 -m http.server 8000` 后访问 `http://localhost:8000/`。

题库自检：`node scripts/check-questions.mjs`。

参考调研：GitHub 中小学辅助学习系统的对比与借鉴记录见 [docs/k12-github-reference.md](docs/k12-github-reference.md)；图形题与老师作业导入的方案见 [docs/homework-import-and-figures.md](docs/homework-import-and-figures.md)。

Hello from superagent
