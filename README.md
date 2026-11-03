# testdsh

dsh-superagent 联调仓库。

## 五年级期中闯关小游戏

`index.html` 是一个无需联网、双击即可打开的静态小游戏，用来在期中前检测五年级上学期三科的学习情况。

- **语文**：人教部编版第 1–4 单元，字词、古诗、课文理解、修辞和说明方法。
- **数学**：人教版小数乘法、小数除法、简便运算、位置与解决问题。
- **英语**：PEP 五年级上册 Unit 1–3，人物、星期、食物相关词汇和句型。
- 每次从题库随机抽 10 题，选项顺序打乱；答完给出正确率、知识点掌握、学习建议和错题回顾。
- 成绩、星级和音效偏好只保存在当前浏览器的 `localStorage` 中。

打开方式：直接双击 `index.html`，或在仓库目录运行 `python3 -m http.server 8000` 后访问 `http://localhost:8000/`。

题库自检：`node scripts/check-questions.mjs`。

## 中小学·高中知识图谱

`cn-math-taxonomy/` 目录复制自 [xiaoyang111222/cn-math-taxonomy](https://github.com/xiaoyang111222/cn-math-taxonomy)（CC BY-NC 4.0，个人学习、教学和研究使用），包含数学、英语、物理等学科的知识图谱、先修关系、题库和自适应前置诊断。

- 在线访问：<https://ylround-agent.github.io/testdsh/cn-math-taxonomy/>
- 本地运行：在仓库根目录运行 `python3 -m http.server 8000`，访问 <http://localhost:8000/cn-math-taxonomy/>。
- 页面入口：`cn-math-taxonomy/index.html`（首页）、`explore/`（知识图谱）、`diagnose/`（诊断）、`children/`（孩子档案）。
- 为保护个人使用隐私，副本关闭了上游站点的访问统计上报（`cn-math-taxonomy/assets/stats-config.js`）。

Hello from superagent

Feishu test ok
