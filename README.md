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


## 教材中心（五年级上册）

`textbooks/` 是一个可在线翻页的教材书架，内置语文（统编版）、数学（人教版）、英语（PEP）五年级上册三本教材，按单元目录跳转，自动记住上次读到哪一页。

- 在线访问：<https://ylround-agent.github.io/testdsh/textbooks/>
- 本地访问：在仓库根目录运行 `python3 -m http.server 8000`，打开 <http://localhost:8000/textbooks/>。
- 阅读器：`textbooks/reader.html?book=cn-g5-v1`（语文）、`ma-g5-v1`（数学）、`en-g5-v1`（英语）。
- 教材 PDF 引用自公开归档项目 [ChinaTextbook](https://github.com/TapXWorld/ChinaTextbook)，版权归原出版方所有；本仓库不复制、不再分发 PDF。优先使用 jsDelivr 镜像，失败时回退 GitHub Raw。
- 需要本地副本时运行 `node scripts/fetch-textbooks.mjs`，PDF 会保存到 `textbooks/files/`（已 gitignore），本地开发时阅读器会优先使用。
- 自检：`node scripts/check-textbooks.mjs`（加 `--remote` 可检查 PDF 链接）。
- 阅读器侧栏会按当前单元显示 cn-math-taxonomy 的知识点、题量和“看知识图谱 / 诊断本单元”入口；书架底部展示三科知识图谱统计。

## 题库工作台

`admin/` 是一个本地优先的题库后台，用来补充五年级三科题库。

- 在线访问：<https://ylround-agent.github.io/testdsh/admin/>
- **手动录入**：科目、知识点、题干、3–4 个选项（A/B/C 必填，D 可选）、答案、解析，可配图或拍照。
- **程序生成**：数学的小数乘法、小数除法、简便运算、位置（数对），答案由程序计算，预览后入库。
- **AI 辅助**：生成提示词复制到任意 AI；配置 OpenAI 兼容接口后可直接生成，或拍照交给视觉模型识图。AI 结果必须人工核对。
- **知识图谱题库**：从 cn-math-taxonomy 按科目/单元/难度筛选并导入选择题；数值题保留在知识图谱诊断页练习。
- **导入导出**：支持 `questions.js` / JSON 合并或替换；导出后替换 `assets/questions.js` 并运行 `node scripts/check-questions.mjs`，即可发布。
- 题库存放在当前浏览器的 IndexedDB（localStorage 备份），不会上传到服务器；换设备或清缓存会丢失。发布靠导出文件后提交。
- “应用到本机闯关”会把本地题库写入 `localStorage`，首页闯关立即使用，并显示恢复默认的入口。
- 出题器自检：`node scripts/check-generators.mjs`。

> GitHub Pages 是纯静态托管，没有服务端数据库；因此这里的“后台”是浏览器内的本地工作台，而不是账号/多人协作的云端后台。详细取舍和参考项目见 [docs/textbooks-and-question-bank.md](docs/textbooks-and-question-bank.md)。

## 知识图谱联动

`textbooks/assets/taxonomy.json` 和 `taxonomy-questions.json` 是把 `cn-math-taxonomy/` 的三科五年级内容桥接到教材中心和题库后台的生成文件：

- 90 个知识点、360 道题（语文 41 点/164 题，数学 22 点/88 题，英语 27 点/108 题）。
- 阅读器按单元显示对应知识点、题量和 `explore/`、`diagnose/` 深链；书架显示三科统计。
- 题库后台「知识图谱题库」按科目/单元/难度筛选，选择题可直接导入；数值题保留在诊断页练习。
- 支持 3–4 个选项：知识图谱里的三选项选择题可以直接入库并在闯关中显示。
- 数据由 `node scripts/build-taxonomy-bridge.mjs` 重新生成；`node scripts/check-textbooks.mjs` 会校验桥接数据。
- 来源 [cn-math-taxonomy](https://github.com/xiaoyang111222/cn-math-taxonomy)（CC BY-NC 4.0），仅限个人学习、教学和研究使用。

## 中小学·高中知识图谱

`cn-math-taxonomy/` 目录复制自 [xiaoyang111222/cn-math-taxonomy](https://github.com/xiaoyang111222/cn-math-taxonomy)（CC BY-NC 4.0，个人学习、教学和研究使用），包含数学、英语、物理等学科的知识图谱、先修关系、题库和自适应前置诊断。

- 在线访问：<https://ylround-agent.github.io/testdsh/cn-math-taxonomy/>
- 本地运行：在仓库根目录运行 `python3 -m http.server 8000`，访问 <http://localhost:8000/cn-math-taxonomy/>。
- 页面入口：`cn-math-taxonomy/index.html`（首页）、`explore/`（知识图谱）、`diagnose/`（诊断）、`children/`（孩子档案）。
- 为保护个人使用隐私，副本关闭了上游站点的访问统计上报（`cn-math-taxonomy/assets/stats-config.js`）。

Hello from superagent

## 本地运行与自检

```bash
python3 -m http.server 8000            # 打开 /、/textbooks/、/admin/
node scripts/check-questions.mjs       # 题库自检
node scripts/check-textbooks.mjs       # 教材目录自检
node scripts/check-generators.mjs      # 程序出题器自检
node scripts/build-taxonomy-bridge.mjs  # 重新生成知识图谱桥接数据
node scripts/fetch-textbooks.mjs       # 可选：下载教材到 textbooks/files/
```
