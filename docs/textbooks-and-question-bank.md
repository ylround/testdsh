# 教材在线浏览与题库后台：调研与实现说明

调研与实现时间：2026-11-03。本文说明两件事怎么落地、参考了哪些开源项目，以及当前方案的边界。

## 1. 需求与结论

原始需求：

1. 参考 GitHub 项目，把各科教材放进项目里，部署后的网站可以在线浏览。
2. 有一个后台可以补充题库；题库可以程序生成、AI 生成或手动录入（拍照），也要参考经典的开源项目。

结论：

- **教材**：新增 `textbooks/` 教材中心，内置语文（统编版）、数学（人教版）、英语（PEP）五年级上册三本教材。PDF 不复制进仓库，而是在页面中引用公开归档项目 `ChinaTextbook` 的文件地址，用 PDF.js 在线阅读；优先走 jsDelivr 加速镜像，失败回退 GitHub Raw。另提供 `scripts/fetch-textbooks.mjs`，个人可把 PDF 下载到本机 `textbooks/files/` 作为本地副本（已 gitignore）。
- **题库后台**：新增 `admin/` 题库工作台。因为当前部署是 GitHub Pages 纯静态站点，没有服务器和数据库，后台做成**本地优先**：题库保存在浏览器 IndexedDB，支持手动录入、数学程序生成、AI 提示词/接口生成、拍照配图、JSON/JS 导入导出。导出 `questions.js` 后替换仓库文件即可发布；也可以“应用到本机闯关”立即试玩。
- **没有做真正的服务端后台**：GitHub Pages 不能运行 Python/Node 服务，也没有登录、数据库和对象存储。若要做多人协作、审核流和云端题库，需要另选部署（如 Fly.io/Render/云服务器 + SQLite/Postgres），或引入现成的 `tiku-studio`。这次没有把静态仓库改造成需要长期维护的服务端，避免给出一个无法部署的“后台”。
- **接入已有的 cn-math-taxonomy**：不另起一套知识内容，而是把它的三科五年级知识点、先修关系、诊断入口和题库桥接到教材中心与题库后台：阅读器按单元显示知识点和题量，书架显示三科统计，题库后台可按单元导入选择题。详见 3.6。

## 2. 教材：调研与选择

### 2.1 参考项目

| 项目 | 许可证 | 用途 | 借鉴点 |
| --- | --- | --- | --- |
| [TapXWorld/ChinaTextbook](https://github.com/TapXWorld/ChinaTextbook) | 未声明 | 公开归档的小初高、大学 PDF 教材 | 按“学段/学科/版本/年级”组织文件；本项目只引用其公开文件地址，不复制、不再分发 |
| [happycola233/tchMaterial-parser](https://github.com/happycola233/tchMaterial-parser) | MIT | 国家中小学智慧教育平台电子课本下载工具 | 官方平台是教材的正规来源；下载需要平台登录 Token，不适合写进静态站点 |
| [国家中小学智慧教育平台](https://basic.smartedu.cn/tchMaterial/) | 官方平台 | 官方电子课本在线阅读 | 作为备用入口和版权说明的权威来源 |
| [mozilla/pdf.js](https://github.com/mozilla/pdf.js) | Apache-2.0 | 浏览器内 PDF 渲染 | 本项目 vendored `pdfjs-dist@3.11.174` 的 legacy 核心构建（`pdf.min.js` / `pdf.worker.min.js`）；三本教材字体已嵌入，实测不需要 cMaps/standard_fonts |
| [jsDelivr](https://www.jsdelivr.com/) | CDN 服务 | GitHub 文件加速 | 单文件 ≤ 20 MB 时明显快于 Raw；数学 25 MB 会 403，自动回退 Raw |

### 2.2 为什么不把 PDF 提交进仓库

- 三本 PDF 合计约 44 MB，会让仓库和每次克隆明显变重。
- 教材版权归原出版方所有。`ChinaTextbook` 的 README 也说明其目标是归档公开资源；本项目不应把 PDF 再分发到自己的公开仓库。
- GitHub Pages 对单文件、仓库体积和带宽都有限制；把大 PDF 放进 Pages 并不适合长期使用。

因此采用“**页面集成 + 外部文件**”的方式：教材确实出现在项目里、能在部署站点上在线翻页，但 PDF 文件本身仍由公开归档项目托管。需要离线副本时，运行：

```bash
node scripts/fetch-textbooks.mjs
```

文件会保存到 `textbooks/files/`，该目录下的 PDF 已被 `.gitignore` 排除。本地开发时阅读器会优先使用本地副本；部署站点上不会探测本地文件。

### 2.3 阅读器实现

- 入口：`textbooks/index.html`（书架）、`textbooks/reader.html?book=<id>`（阅读器）。
- 数据：`textbooks/assets/books.json`，包含三本教材的科目、版本、单元、课文/小节、页码和来源。
- 渲染：PDF.js 逐页渲染到 `<canvas>`，支持上一页/下一页、页码跳转、适应页面/宽度、缩放、全屏、键盘 `←/→`、`+/-`、移动端左右滑动。
- 目录：每本教材的单元页码来自原书目录，并按 PDF 前置页偏移 +5 校正（例如语文“第一单元”在原书第 1 页，PDF 第 6 页）。点击目录直接跳页。
- 进度：`localStorage` 的 `textbook-progress-v1` 记录每本书上次读到第几页，书架显示“上次读到”。
- 单元联动：阅读器侧栏按当前页所在单元显示 cn-math-taxonomy 的知识点、题量，以及“看知识图谱 / 诊断本单元”深链。
- 镜像：`books.json` 的 `mirrors` 数组先试 jsDelivr，再回退 GitHub Raw；本地副本优先。加载失败时显示“在新标签页打开 PDF”和官方平台入口。
- 无障碍：页码输入有 `aria-label`，图片阅读区有说明，键盘可操作；没有把文字层强加给扫描版 PDF。

### 2.4 页码与目录来源

单元页码取自 PDF 前部的原书目录页，用 `pdftotext -layout` 核对：

- 语文：第一至八单元分别在第 1、15、31、49、65、75、91、105 页（原书页码）；PDF 偏移 +5。
- 数学：小数乘法第 2 页、位置第 19 页、小数除法第 24 页、可能性第 44 页、简易方程第 52 页、多边形面积第 84 页、植树问题第 104 页、总复习第 109 页；PDF 偏移 +5。
- 英语：Unit 1–3、Recycle 1、Unit 4–6、Recycle 2 分别在第 2、12、22、32、36、46、56、66 页；PDF 偏移 +5。

页码是“PDF 页序号”，不是印刷页码；阅读器页码框显示的是 PDF 页序号，和原书印刷页码相差 5 页。书架的目录按钮按单元跳转，不需要用户自己换算。

## 3. 题库后台：调研与选择

### 3.1 参考项目

| 项目 | 许可证 | 定位 | 借鉴点 / 未采用原因 |
| --- | --- | --- | --- |
| [cy-0754/tiku-studio](https://github.com/cy-0754/tiku-studio) | MIT | 小学题库与组卷系统，FastAPI + Vue3 + SQLite | “课本拆解成纲 → 对纲校验 → 人工确认 → 组卷”的流程最接近需求；它需要 Python/Node 服务和 SQLite，无法直接跑在 GitHub Pages 上，本次只借鉴流程和字段设计，没有复制代码 |
| [mindskip/xzs](https://github.com/mindskip/xzs) | AGPL-3.0 | 在线考试系统 | 题库、组卷、考试、成绩管理的完整后台流程；AGPL 传染性较强，未引入 |
| [Moodle QTI](https://docs.moodle.org/en/Import_questions) | GPL 生态 | 标准题库导入导出 | QTI/Moodle XML 适合和学校平台互通；当前题库是项目自有 JSON，先不做标准包 |
| [DovikN-913/PaperCutter-VL](https://github.com/DovikN-913/PaperCutter-VL) | MIT | 扫描试卷切题成 JSON | 题目图/解析图的字段设计；需要视觉模型和服务端，未直接引入 |
| [parz0val0/scan-to-practice](https://github.com/parz0val0/scan-to-practice) | MIT | 拍照/扫描到练习 | “原图裁剪 + 人工校对”比“OCR 后重画”稳；本项目拍照只做原图配图，OCR/VLM 交给可选 AI |
| [jackli01030/shiyi-math-practice](https://github.com/jackli01030/shiyi-math-practice) | MIT | 一年级数学家庭练习站 | 本地优先、错题本；和当前项目的 localStorage 形态一致 |
| [132465798a/zx-study](https://github.com/132465798a/zx-study) | MIT | 小学离线学习平台 | 本地数据、错题优先；未复制代码 |

### 3.2 为什么是“本地后台”

当前站点部署在 GitHub Pages（`ylround-agent.github.io/testdsh/`），只有静态文件：

- 没有进程可以跑 FastAPI/Express，也没有数据库。
- 没有登录、权限、审核和云端对象存储。
- 任何“网页里直接写题库文件”的能力都需要一个带写权限的后端或 GitHub Token。

因此后台采用与站点一致的本地优先方案：

- 题库存 **IndexedDB**（`quiz-admin-db`），并写一份 localStorage 备份；换设备/清缓存会丢失。
- 所有编辑立即保存；页面显示“本地草稿已保存”。
- 发布靠导出 `questions.js`，由人决定是否提交；也可以先“应用到本机闯关”验证。
- AI Key 只保存在当前浏览器，不进入导出文件，也不上传到项目服务器（项目本身没有服务器）。

这是有意的取舍：**先给一个今天就能用、能部署、不会泄露密钥和题库的后台**，而不是一个无法在 Pages 上运行的服务端半成品。

### 3.3 四种补题方式

1. **手动录入**
   - 科目、知识点、题干、3–4 个选项（A/B/C 必填，D 可选）、正确答案、解析；
   - 可选配图：文件选择/手机拍照，浏览器内压缩到最长边 1600px、JPEG 0.84，作为 data URL 存进题目；
   - 图片会随 `questions.js` 导出，所以控制尺寸；`alt` 文字用于读屏和加载失败。
2. **程序生成（数学）**
   - `admin/assets/generators.js` 提供 4 种模板：小数乘法、小数除法、简便运算、位置（数对）；
   - 答案由整数/定点运算算出，选项去重并打乱；解析由模板生成；
   - 生成后先预览，确认再加入；支持连续加入 5 题；
   - 自检：`node scripts/check-generators.mjs`，每种题型生成 500 道，校验字段、4 个不重复选项和答案下标。
3. **AI 辅助**
   - 先生成提示词，复制到任意 AI 对话；把返回 JSON 粘贴回来解析预览；
   - 配置 OpenAI 兼容接口（OpenAI/DeepSeek/通义/智谱预设）后可直接在页面调用；
   - 返回结果统一走 `normalizeQuestion` 校验：科目、知识点、题干、4 个非空且不重复选项、答案下标、解析；
   - 支持视觉模型识图：选照片 → 发 `image_url` → 解析成题目，图片同时作为配图；识别结果必须人工核对；
   - 浏览器直连第三方服务，部分服务可能因 CORS/网络失败，失败时用“复制提示词”模式。
4. **导入导出**
   - 支持导入 `questions.js`（`window.QUIZ_BANK = {...}`）、纯 JSON 文件或粘贴文本；
   - 合并导入（同题号覆盖）或替换题库；
   - 导出 `questions.js` / JSON，或复制到剪贴板；
   - 导出的 `questions.js` 与现有 `scripts/check-questions.mjs` 兼容。
5. **知识图谱题库**
   - 从 `textbooks/assets/taxonomy-questions.json` 读取 cn-math-taxonomy 的三科五年级题目；
   - 按科目、单元、难度、题型筛选，选择题可单题或整批导入；重复题按 `taxonomy.id` 跳过；
   - 导入的题保留 `source: "taxonomy"` 和 `taxonomy: {id, topicId, difficulty}`，导出后仍可追溯；
   - 数值题不在题库后台导入，页面上直接给“去诊断页”入口，因为现有闯关只支持选择题。

### 3.4 数据和发布流程

```
手动/生成/AI/拍照
      ↓
admin 的 IndexedDB（本地草稿）
      ↓ 导出 questions.js
替换 assets/questions.js → node scripts/check-questions.mjs → 提交/部署
      ↓（可选，立刻试玩）
localStorage: quiz-bank-override-v1 → 首页闯关读取
```

- 导出文件头包含导出时间、格式说明和自检命令。
- 首页在检测到本机题库覆盖时显示提示条和“恢复默认题库”按钮。
- 阅读器/闯关/后台三处互相有入口：首页“配套学习”、页脚、教材中心顶栏、后台顶栏。

### 3.5 校验规则

统一规则（`admin.js` 的 `normalizeQuestion` 和 `scripts/check-questions.mjs`）：

- 科目必须是 `chinese` / `math` / `english`；
- 题号在题库内唯一；新题自动生成 `<科目前缀>-<来源>-<时间>`；
- 知识点、题干、解析非空；
- 3–4 个选项（A/B/C 必填，D 可选），非空且互不重复；
- `answer` 是有效选项下标；
- 可选 `figure.src` + `figure.alt`；
- 可选 `source`（manual/generated/ai/photo）和 `createdAt`。

## 3.6 与 cn-math-taxonomy 的联动

### 为什么做桥接

`cn-math-taxonomy/` 已经包含数学、英语、物理、语文、科学等学科的知识点、先修边、诊断和题库，但它的页面、题库和教材中心原本互不相通。如果只新增教材和后台，用户会在“教材—图谱—诊断—题库”之间来回找。桥接的目标是让教材单元直接连着已有知识内容，题库后台也能复用已有题目。

### 生成的数据

`node scripts/build-taxonomy-bridge.mjs` 从 `cn-math-taxonomy/data/{topics,dependencies,questions}.json` 生成两个文件：

- `textbooks/assets/taxonomy.json`：90 个知识点、三科统计、教材单元 → 知识点映射、先修关系、题量。
- `textbooks/assets/taxonomy-questions.json`：360 道相关题目（291 道选择 / 69 道数值）。其中语文 41 点/164 题、数学 22 点/88 题、英语 27 点/108 题。

单元映射是显式维护的，不靠模糊匹配：

- 语文按课文/习作/语文园地对应到 `cnc_*`；
- 数学按小数乘除法、方程、多边形面积、植树问题等对应到 `cnm_*`；“位置（数对）”映射到图谱里六年级的 `cnm_p136`，标记为“跨年级”；
- 英语按 PEP 五上 Unit 1–6 的功能与词汇对应到 `cne_*`。

### 页面联动

- **书架**：底部“三科知识图谱”卡片显示知识点数、题量、选择/数值题数，链接到 `cn-math-taxonomy/explore/?subject=<subject>&grade=5`、`diagnose/?subject=<subject>&grade=五上` 和后台的 `#taxonomy`。
- **阅读器**：侧栏“本单元知识图谱”随当前页所在单元更新，列出前几个知识点（题量、跨年级标记），并提供：
  - `cn-math-taxonomy/explore/?subject=<subject>&grade=5#<topicId>`
  - `cn-math-taxonomy/diagnose/?subject=<subject>&target=<本单元知识点 id, ...>`
- **题库后台**：新增“知识图谱题库”标签，筛选后导入选择题；数值题给“去诊断页”入口。

### 选项数量

cn-math-taxonomy 的选择题大多是 4 选项，也有少量 3 选项。为不改写题目内容，闯关和后台现在支持 **3–4 个选项**：

- 校验脚本允许 3–4 个非空且不重复选项；
- 后台表单 A/B/C 必填，D 可选；
- 3 选项题在闯关里只显示 A–C，键盘 1–4 仍可用（4 不会触发不存在的选项）。

### 数值题

现有闯关是四选一，没有填空/数值判题 UI，因此数值题不导入题库；它们在知识图谱诊断页里可以正常作答。题库后台的筛选结果会显示数值题数量，并提示去诊断页练习，避免静默丢掉这部分内容。

### 重新生成与校验

```bash
node scripts/build-taxonomy-bridge.mjs
node scripts/check-textbooks.mjs
```

`check-textbooks.mjs` 会检查桥接文件是否存在、单元映射是否覆盖、题目数与统计是否一致，以及选择题是否 3–4 个选项。上游 `cn-math-taxonomy` 的数据更新后，重新生成即可；如果单元映射变了，需要同步修改生成脚本里的 `UNIT_TOPICS`。

### 归属与局限

- 知识点、先修关系和题库来自 cn-math-taxonomy（CC BY-NC 4.0），仅限个人学习、教学和研究使用；商业使用需另行授权。
- 单元映射按当前教材版本和知识点名称显式维护，教材换版或图谱改点后需要重新核对；映射是“相关知识点”，不等于官方教材编排。
- cn-math-taxonomy 自己声明：知识点拆分、先修关系、高中题和英语题等仍需一线教师审核；桥接不会改变这个局限。
- 三科以外的科学、道德与法治等知识点没有映射到三本教材，只保留在 cn-math-taxonomy 原站。

## 4. 当前限制

- **教材文件不在仓库内**：依赖 `ChinaTextbook` 与 jsDelivr/GitHub Raw 的可用性；上游文件被删除或网络受限时，阅读器会显示错误和官方平台入口。
- **数学教材 25 MB 超过 jsDelivr 单文件限制**：会回退 GitHub Raw，首次打开可能需要几十秒；语文、英语走 jsDelivr 通常几秒。
- **页码偏移按 PDF 前置页 +5 处理**：上游若换版本，页码需要重新核对；运行 `node scripts/check-textbooks.mjs --remote` 可以发现链接问题，但发现不了页码错位。
- **后台不是服务端**：没有账号、多人协作、审核流、云端同步；换浏览器/清缓存会丢草稿。要做这些，需要引入 `tiku-studio` 一类服务端，或自建 API + 数据库。
- **AI 生成必须人工校对**：模型可能出错，选项可能重复或答案错误；页面会做结构校验，但不能保证学科正确性。
- **拍照只做原图配图**：没有内置 OCR；识图依赖可选的视觉模型。照片可能含隐私信息，上传前要遮挡。
- **题库格式是项目自有 JSON**：没有实现 QTI/Moodle 导出；如果以后要和学校平台互通，可以加 QTI 适配层。
- **知识图谱桥接是显式映射**：教材换版、图谱增删知识点或单元顺序变化时，需要更新 `scripts/build-taxonomy-bridge.mjs` 的 `UNIT_TOPICS` 并重新生成；数值题仍未进入闯关。
- **版权**：教材、题目图片和 AI 生成内容的使用范围由使用者负责；教材仅限个人学习，不要商业使用或二次分发。

## 5. 复现与自检

```bash
# 本地静态站点（访问 /、/textbooks/、/admin/）
python3 -m http.server 8000

# 题库自检（3 科 54 题）
node scripts/check-questions.mjs

# 教材目录自检
node scripts/check-textbooks.mjs
node scripts/check-textbooks.mjs --remote   # 额外 HEAD 远程 PDF
node scripts/build-taxonomy-bridge.mjs      # 重新生成知识图谱桥接数据

# 程序出题器自检（4 种题型 × 500 道）
node scripts/check-generators.mjs

# 可选：把三本 PDF 下载到 textbooks/files/（gitignored）
node scripts/fetch-textbooks.mjs
```

浏览器行为验证（Playwright）：书架加载、阅读器翻页/目录跳转/缩放/移动端、后台手动录题/生成/导出/应用到本机、首页读取本机题库、无横向溢出。具体结果见 PR 的验证记录和 `docs/screenshots/v3/`。

## 6. 许可证与归属

- PDF.js：Apache-2.0，见 `textbooks/vendor/pdfjs/LICENSE`。
- 教材 PDF：版权归原出版方；本项目不复制文件，只引用公开归档地址。`ChinaTextbook` 未声明许可证，链接不等于授权再分发，请自行判断使用范围。
- 参考项目的许可证见上表；本项目没有复制 `tiku-studio`、`xzs`、`PaperCutter-VL`、`scan-to-practice`、`shiyi-math-practice`、`zx-study` 的代码或题库。
- 知识图谱桥接数据由 cn-math-taxonomy 派生，沿用 CC BY-NC 4.0；生成文件保留来源和许可说明。
- 本项目原有题库和页面代码沿用仓库现状。
