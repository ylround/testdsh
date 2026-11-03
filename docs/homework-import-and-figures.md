# 图形题与老师作业导入：GitHub / Hugging Face 调研

调研时间：2026-11-03。本文回答两个问题：

1. 很多题目带图形，图形怎么进入题库和答题界面？
2. 老师布置的作业怎么导入？拍照导入是否可行，还有什么更稳的办法？

> 结论先行：
>
> - **图形题不要先 OCR 成文字再“重画”。** 对扫描/拍照来源，保留**原图裁剪**最稳；对数字原生图形，用 SVG；公式用 LaTeX；需要交互的几何图才考虑 JSXGraph/GeoGebra。
> - **拍照导入可行，但“拍完自动变成完美题库”不可行。** 必须有一个“识别 → 人工校对 → 保存”的环节；对静态网页来说，最稳的第一步是“拍照/裁剪 + 手工答案”，OCR/VLM 作为辅助。
> - **当前项目建议分三步走**：先做图形字段与 JSON 导入；再做拍照裁剪和“我的作业”；最后才做 OCR/VLM 批量转录和 QTI/CSV 互操作。

## 1. 图形题：先区分“图”是什么

不同图形适合的存法完全不同：

| 图形类型 | 例子 | 推荐存法 | 不建议 |
| --- | --- | --- | --- |
| 阅读/情境配图 | 语文课文插图、英语场景图 | 原图裁剪（WebP/PNG）+ alt 文本 | 用文字描述代替原图 |
| 几何图 | 三角形、圆、方格图、数轴 | 数字原生用 SVG；扫描来源用裁剪图 | 让 OCR 把图“识别”成文字 |
| 统计图/表格 | 条形图、折线图、数据表 | 优先结构化表格/图表数据；否则裁剪图 | 只保留 OCR 后的数字，丢掉坐标轴和标签 |
| 数学公式 | 分数、方程、根式 | LaTeX + MathJax 渲染；保留原图作兜底 | 当普通文字排版 |
| 选项图 | “下面哪幅图是……” | 选项级图片 `options[].figure` | 只把图放在题干里 |
| 需要操作的图 | 动态几何、函数图像 | JSXGraph（LGPL-3.0）或 GeoGebra 嵌入 | 用静态图假装可交互 |

### 1.1 现有系统怎么处理

- **Moodle / QTI**：题目正文里的图片作为题目资源打包，导入/导出时随题目一起走；QTI 用标准的 item body + resource 表达图片，Moodle XML 也能把题目用到的文件随题打包。适合“从学校平台导出再导入”的场景。
  - Moodle 导入说明：<https://docs.moodle.org/en/Import_questions>
  - QTI 标准：<https://www.1edtech.org/standards/qti>
- **H5P**：Drag and Drop、Find the Hotspot 等题型直接以一张背景图/热点图为核心，适合“看图找位置/拖拽分类”。如果只是普通选择题，不需要上 H5P 这么重的运行时。
  - Drag and Drop：<https://h5p.org/drag-and-drop>
- **Anki**：从 23.10 起内置 Image Occlusion（图片遮挡）笔记类型，把图上的区域遮住来考“这是哪里/叫什么”，适合生物结构图、地图、电路图等需要记位置的图。
  - 说明：<https://docs.ankiweb.net/editing.html#image-occlusion>
- **PaperCutter-VL**（开源，MIT）：把扫描试卷切成题目级 JSON，字段里明确有 `question_images`（题干图）、`analysis_images`（解析图）、`question_tables`，子题还有自己的 `image`；图片可转成 Base64/data URI。它的 schema 很适合作为“题目 + 图形”的参考。
  - <https://github.com/DovikN-913/PaperCutter-VL>
- **Scan-to-Practice**（开源方法论，MIT）：明确建议复杂图形**裁剪原图**，而不是用文字重建；对 2,584 页的参考项目，视觉转录约 10–13 秒/页，成本约 CNY 23–42，8–12 小时后台处理。这个成本数据对“整本作业本导入”很有参考价值。
  - <https://github.com/parz0val0/scan-to-practice>

### 1.2 对当前项目的启发

当前题库是 `assets/questions.js` 里的纯文本结构（`id / point / q / options / answer / explain`）。增加图形不需要推翻它，只需要加**可选字段**：

```js
{
  id: 'ma-21',
  point: '位置',
  q: '在方格图中，点 A 的位置用数对表示是？',
  figure: {
    src: 'assets/figures/ma-21-grid.svg',
    alt: '方格图：点 A 在第 3 列第 4 行的交点上',
    caption: '方格图',
  },
  options: ['(3, 4)', '(4, 3)', '(3, 3)', '(4, 4)'],
  answer: 0,
  explain: '数对先写列、再写行，所以点 A 是 (3, 4)。',
}
```

更完整的版本可以支持“题干/选项/解析各自带图”：

```js
{
  id: 'hw-20261103-1',
  subject: 'math',
  point: '位置',
  stem: {
    text: '看图填空。',
    figures: [
      { src: 'images/q1-stem.webp', alt: '方格图，点 A 在第 3 列第 4 行', role: 'stem' }
    ]
  },
  options: [
    { text: '(3, 4)' },
    { text: '(4, 3)' },
    { text: '下图', figure: { src: 'images/q1-opt-c.webp', alt: '点在第 4 列第 3 行' } }
  ],
  answer: 0,
  explain: {
    text: '先看列，再看行。',
    figures: [{ src: 'images/q1-explain.webp', alt: '列和行的标注示意', role: 'explain' }]
  },
  source: { type: 'photo', capturedAt: '2026-11-03', rights: 'family-use' }
}
```

渲染上只需要：

1. 在 `renderQuestion()` 里，题干文字之后、选项之前插入 `<figure>`；
2. 在 `renderWrongAnswers()`（错题回顾）里也显示同一张图，避免“错题只有文字、没有图”；
3. 用 `object-fit: contain`、`max-height: min(38vh, 320px)` 约束高度，手机上可点开全屏查看；
4. `alt` 必填；复杂图再补一句 `figcaption` 或长描述；
5. 图片文件放 `assets/figures/`（内置题库）或 IndexedDB（用户导入），**不要**把大图塞进 `localStorage`。

存储注意：

- `localStorage` 通常只有约 5 MB，几张照片就会满；用户导入的图片应放 **IndexedDB**，用 `URL.createObjectURL()` 显示，导出时再打包。
- 内置题库的图放静态目录，走浏览器缓存；SVG 优先，扫描图用 WebP（质量 0.8 左右，长边 1600–2000px 通常够看）。
- 不要在 JSON 里散落远程图片 URL：会带来加载失败、隐私和版权问题；导入包用本地文件或 zip。

## 2. 老师作业导入：有哪些办法

先给结论：**没有一种“全自动且零校对”的导入方式**。越是拍照/手写/复杂版面，越需要人工确认。按“实现成本 / 保真度 / 适用场景”排：

| 方式 | 输入 | 需要 OCR/VLM | 图形题 | 准确度 | 适合 |
| --- | --- | --- | --- | --- | --- |
| 手工录入 / JSON 导入 | 老师给的电子题、家长整理 | 否 | 图片字段 | 最高 | 少量题、家长有时间 |
| 拍照裁剪（无 OCR） | 手机拍照 | 否 | 原图直接保留 | 高（图就是原图） | 图形题、手写题、无法识别的版面 |
| 拍照 + 文本 OCR | 打印体作业 | 是（Tesseract/PaddleOCR） | 图需另行裁剪 | 中 | 打印体、规则排版 |
| 拍照 + VLM 结构化 | 拍照/扫描 | 是（Qwen3-VL 等） | 可同时切图 | 中，需要校对 | 整页、多题、批量 |
| PDF/Word 解析 | 老师发的电子文件 | 视文件而定 | 可提取原图 | 高 | 有电子版时最省事 |
| QTI / Moodle XML / CSV | 学校平台导出 | 否 | 标准资源包 | 高 | 平台间迁移 |
| 直接抓老师平台 | 网页/App | 否 | 不确定 | 低/不合规 | 不建议（登录、ToS、隐私） |

### 2.1 拍照导入的现实流程

一个可用的拍照导入不是“拍完就完事”，而是：

```text
拍照/选图
  -> 旋转、裁剪、去透视（可选）
  -> 题目切分（一页多题时）
  -> 识别文字/公式（可选）
  -> 人工校对：题号、题干、选项、答案、图形
  -> 保存为“我的作业”
```

其中**原图必须保留**：识别结果只作为草稿，校对页左边显示原图裁剪、右边显示可编辑文字；老师/家长确认后才进入题库。Scan-to-Practice 的经验也是“源内容保真优先于 AI 生成”，不要把模型输出的答案直接当标准答案。

对当前这个纯静态网页，最现实的两个入口是：

1. **拍照 → 裁剪 → 作为图片题保存**：不识别文字，题目就是那张裁剪图；答案由家长/老师填，或做成“看完答案自评”。这对图形题、手写题、奥数题最稳。
2. **拍照 → OCR/VLM 生成草稿 → 人工校对 → 保存**：需要本地 Python 工具或后端/云 API；纯浏览器只适合打印体短文本，公式和版面不可靠。

### 2.2 其他建议的方法

- **优先问老师要电子版**：PDF/Word 往往自带文字层和原图，解析成本远低于拍照；有文字层时用 PyMuPDF 先试 `get_text()`，不要盲目 OCR。
- **QTI / Moodle XML / CSV**：如果学校平台能导出，直接做导入器最省事；图片随包走，答案和题型也保真。
- **共享/粘贴**：老师发在群里的图片，用系统分享面板或拖拽导入；比“拍照”少一步压缩。
- **JSON + 图片 zip**：给老师/家长一个模板，题目文本、选项、答案、图片路径写清楚；这是最可控、最容易校验的“导入 API”。
- **只导入“作业清单”而不导入题目**：如果目标只是提醒和记录，拍照+日期+科目即可，不必把每道题都结构化。

### 2.3 答案和批改

- 选择题/填空题：老师给答案时，按题型自动判分；
- 解答题/手写题：不要自动判分，最多做“自评/家长评”；
- 图片题：答案可以是文字、选项，或“查看答案”；
- 没有标准答案时，明确标成“练习/自评”，不要用 AI 生成的答案冒充老师答案。

## 3. GitHub 上的可借鉴项目

| 项目 | 星标（约） | 许可证 | 能借鉴什么 |
| --- | ---: | --- | --- |
| [scan-to-practice](https://github.com/parz0val0/scan-to-practice) | 110 | MIT | 从扫描材料到练习产品的完整方法论：源内容保真、图形裁剪、校对、成本控制 |
| [PaperCutter-VL](https://github.com/DovikN-913/PaperCutter-VL) | 7 | MIT | PaddleOCR-VL + 版面分析 + LLM 的试卷切题；题目级 JSON 里带 `question_images`、`analysis_images` |
| [chinese-exam-question-regions](https://github.com/jz315/chinese-exam-question-regions) | 3 | 标注 CC BY 4.0 | 中文试卷切题数据集：2,360 页、12,431 个题目框、9 科，YOLO 标签；原卷图片权利仍归原作者 |
| [homework-grader](https://github.com/Lazily01/homework-grader) | 4 | MIT（README 声明） | 拍照 → 有道切题 API → Qwen-VL 识别手写答案 → 批改的完整链路，适合看“商业 API 路线” |
| [image2mcq](https://github.com/manjur-ai/image2mcq) | 0 | MIT | 图片 → 选择题（视觉 LLM 或 OCR 两段式）；适合“生成练习”，不适合直接当“导入老师原题” |
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | 92k | Apache-2.0 | 中文 OCR、版面分析、公式/表格识别；PP-StructureV3 可做题目区域和阅读顺序 |
| [MinerU](https://github.com/opendatalab/MinerU) | 83k | Apache-2.0 + 附加条件 | PDF/Office → Markdown/JSON，保留公式、表格、图片；适合电子版讲义/试卷 |
| [dots.ocr](https://github.com/studio-dots-ai/dots.ocr) | 9.2k | MIT | 多语言文档版面解析，输出带位置的文本/图块，适合做切题和图片裁剪 |
| [Surya](https://github.com/datalab-to/surya) | 22k | 代码 Apache-2.0；权重 OpenRAIL-M | OCR、版面分析、阅读顺序、表格识别，90+ 语言 |
| [LaTeX-OCR / pix2tex](https://github.com/lukas-blecher/LaTeX-OCR) | 17k | MIT | 公式图片 → LaTeX；适合把公式转成可编辑文本 |
| [marker](https://github.com/datalab-to/marker) | 41k | Apache-2.0 | PDF → Markdown/JSON，速度快，适合电子 PDF |
| [JSXGraph](https://github.com/jsxgraph/jsxgraph) | 1.5k | LGPL-3.0 | 浏览器里的交互几何/函数图；只有“需要拖动/测量”的题才需要 |
| [MathJax](https://github.com/mathjax/MathJax) | 11k | Apache-2.0 | 公式排版；和 LaTeX 字段配合 |

### 3.1 三个最值得细看的项目

**PaperCutter-VL** 的流程很接近“老师拍照导入”：

```text
图片/PDF
  -> PaddleOCR-VL + PP-DocLayoutV2 版面识别
  -> 页面 Markdown + 图片落盘
  -> 大模型按严格 JSON schema 抽题
  -> question_images / analysis_images / sub_questions
  -> 图片转 Base64 或 data URI
```

它的 JSON 字段值得直接借鉴：`question_content`、`question_options`、`question_images`、`question_tables`、`analysis_images`、`sub_questions[].image`。这比“题干字符串里塞 Markdown 图片”更容易校验和渲染。

**chinese-exam-question-regions** 解决的是“一页多题怎么切”：用 YOLO 检测题目框，输出 `question` 类的 bbox。它提供 2,360 页、12,431 个框的中文试卷数据，覆盖 9 科。注意：标注是 CC BY 4.0，但原卷图片仍属于原权利人，不能因为数据集开放就随意转载原卷。

**scan-to-practice** 是最值得读的“踩坑总结”：它明确说复杂图形用授权原图裁剪比文字重建安全；整本 2,584 页的视觉转录成本约 CNY 23–42，但真正耗时的是校对和结构校验，不是模型调用。这个结论对“要不要做全自动导入”很关键。

## 4. Hugging Face 上的模型与数据集

Hugging Face 上主要有三类可用资源：**文档/OCR 视觉模型**、**公式识别模型**、**视觉数学/图形评测集**。

### 4.1 模型

| 模型 | 任务 | 许可证 | 适用方式 |
| --- | --- | --- | --- |
| [Qwen3-VL-8B-Instruct](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct) | 文档解析、OCR、视觉定位、结构化抽取 | Apache-2.0 | 本地 GPU 或云 API；适合“整页 → JSON 草稿” |
| [PaddleOCR-VL](https://huggingface.co/PaddlePaddle/PaddleOCR-VL) | 文档版面、文字、表格、公式、图表 | Apache-2.0 | 本地部署；PaperCutter-VL 的底座之一 |
| [dots.ocr](https://huggingface.co/dots-studio/dots.ocr.base) | 多语言版面解析 | MIT | 本地部署；输出带位置的块，适合切题 |
| [olmOCR-2-7B](https://huggingface.co/allenai/olmOCR-2-7B-1025) | PDF → 线性文本 | Apache-2.0 | 电子 PDF 批量处理 |
| [GOT-OCR2.0](https://huggingface.co/stepfun-ai/GOT-OCR2_0) | 通用 OCR（文字/公式/表格） | 代码 Apache-2.0，权重/数据需核对 | 实验/研究；上生产前确认权重许可 |
| [TrOCR handwritten](https://huggingface.co/microsoft/trocr-base-handwritten) | 手写英文/数字 OCR | MIT | 只适合短行手写；中文/公式弱 |
| [LaTeX-OCR / pix2tex](https://github.com/lukas-blecher/LaTeX-OCR) | 公式图 → LaTeX | MIT | 单独处理公式裁剪 |
| [Surya](https://github.com/datalab-to/surya) | OCR/版面/阅读顺序/表格 | 代码 Apache-2.0；权重 OpenRAIL-M | 本地或服务化；商用前看权重条款 |

**选择建议：**

- **只想在浏览器里做**：Tesseract.js 可以识别打印体短文本，但公式、手写、复杂版面效果差；不要把它当成“拍照导入”的完整方案。
- **有本地 GPU / 愿意跑 Python**：PaddleOCR-VL、dots.ocr、Qwen3-VL 三选一先做小样本评测；PaddleOCR-VL/PaperCutter-VL 对中文试卷更贴近。
- **不想运维**：用云厂商的 Qwen-VL/文档解析 API，或 Mathpix/有道等专用 API；成本、隐私和稳定性要单独评估。
- **公式很多**：pix2tex/LaTeX-OCR 单独做公式行识别，和版面 OCR 组合，比让通用 OCR 一次搞定更稳。

### 4.2 数据集/评测集

这些不是“直接拿来当题库”的数据，而是用来评测“模型能不能看懂图”的：

| 数据集 | 内容 | 用途 |
| --- | --- | --- |
| [MathVista](https://huggingface.co/datasets/AI4Math/MathVista) | 带图表的数学推理题 | 评测视觉数学理解 |
| [MathVerse](https://huggingface.co/datasets/AI4Math/MathVerse) | 多模态数学题 | 评测图+文推理 |
| [Geometry3K](https://huggingface.co/datasets/MrZilinXiao/geometry3k) | 几何题 + 图 | 评测几何图理解/解题 |
| [AI2D](https://huggingface.co/datasets/Ryoo72/ai2d) | 科学示意图 | 评测示意图理解 |
| [UniMER_Dataset](https://huggingface.co/datasets/wanderkid/UniMER_Dataset) | 公式识别数据 | 训练/评测公式 OCR |
| [ccace/chinese-exam-question-regions](https://huggingface.co/datasets/ccace/chinese-exam-question-regions) | 中文试卷题目框 | 训练/评测切题检测 |

**注意：** 评测集上的高分不等于“能直接导入你孩子的作业”。真实作业有手写、涂改、拍照畸变、老师批注、多栏排版，必须用自己的一小批样本做验收。

## 5. 对当前项目的推荐方案

### 阶段 1：先让题库“能带图”（不依赖 OCR）

- 给题目 schema 加可选 `figure`（题干）和 `figures[]`（题干/选项/解析）；
- 渲染题干、选项、错题回顾、打印四个位置都能显示图；
- 加图片校验：文件存在、`alt` 非空、尺寸/格式、答案索引合法；
- 内置题库先用 1–2 道自制 SVG 图题验证（版权清晰、可审查）；
- 导入方式先做 **JSON + 图片目录/zip**，人工填写，不做 OCR。

这一步能把“图形题怎么增加进来”真正落地，而且不会引入模型/后端复杂度。

### 阶段 2：拍照裁剪 + “我的作业”（静态网页可做）

- 首页加“我的作业”入口；
- `<input type="file" accept="image/*" capture="environment">` 调起手机相机；
- Canvas 做旋转/裁剪/压缩，图片存 IndexedDB；
- 题目先按“图片题”保存：题干图 + 可选文字 + 答案/自评；
- 支持一页多题时手动框选切分；
- 导出/备份为 zip（manifest + images），换设备可恢复。

这一步不依赖 OCR，已经能覆盖“老师发一张作业照片，孩子点开就能做”的核心需求；图形题天然保真。

### 阶段 3：OCR/VLM 辅助转录（需要本地工具或后端）

- 做一个 `tools/homework-import` 本地工具（Python），而不是把密钥塞进前端；
- 用 PaddleOCR-VL/dots.ocr 做版面与切题，Qwen3-VL 做结构化抽取；
- 输出 `manifest.json + images/`，字段对齐 PaperCutter-VL 的思路；
- 提供校对页：原图 vs 识别文本，逐题确认；
- 加“待确认/已确认”状态，未确认的题不进正式题库；
- 只对电子 PDF 优先走 PyMuPDF 文本层 + 图片提取，避免不必要的 OCR。

### 阶段 4（可选）：标准格式互操作

- QTI / Moodle XML / CSV 导入；
- 图片资源随包；
- 与学校平台/老师给的导出文件对齐。

### 不建议现在做

- 纯浏览器端“拍照→自动出整本题库”：公式/手写/版面不可靠，校对成本高；
- 让 AI 自动生成答案或解析当标准答案；
- 把原卷照片直接公开到仓库（版权/隐私）；
- 把大图 base64 塞进 `localStorage`；
- 直接抓老师平台页面（登录、ToS、隐私都不合适）。

## 6. 许可证、隐私与版权

- **老师作业/试卷**：为家庭学习导入没问题，但不要公开转载原卷、答案或学生信息；拍照前避开姓名、学号、学校。
- **数据集**：`chinese-exam-question-regions` 的标注是 CC BY 4.0，但原卷图片权利仍归原权利人；`AI2D`、`MathVista` 等也要看各自许可证，别把评测集直接当题库分发。
- **模型**：Qwen3-VL/PaddleOCR/olmOCR/dots.ocr 相对宽松；GOT-OCR2.0 的权重/数据许可要核对；Surya 代码 Apache-2.0 但权重是 OpenRAIL-M；MinerU 是 Apache-2.0 + 附加条件。
- **儿童数据**：优先本地处理；用云 API 时明确告知、最小化上传、不要用于训练；保留删除入口。
- **AI 输出**：标明“识别草稿/待校对”，不要冒充老师原题或标准答案。

## 7. 参考链接

### 方法论 / 项目

- Scan-to-Practice：<https://github.com/parz0val0/scan-to-practice>
- PaperCutter-VL：<https://github.com/DovikN-913/PaperCutter-VL>
- 中文试卷切题数据集：<https://github.com/jz315/chinese-exam-question-regions>
- homework-grader：<https://github.com/Lazily01/homework-grader>
- image2mcq：<https://github.com/manjur-ai/image2mcq>
- PaddleOCR：<https://github.com/PaddlePaddle/PaddleOCR>
- MinerU：<https://github.com/opendatalab/MinerU>
- dots.ocr：<https://github.com/studio-dots-ai/dots.ocr>
- Surya：<https://github.com/datalab-to/surya>
- LaTeX-OCR：<https://github.com/lukas-blecher/LaTeX-OCR>
- marker：<https://github.com/datalab-to/marker>
- JSXGraph：<https://github.com/jsxgraph/jsxgraph>
- MathJax：<https://github.com/mathjax/MathJax>

### 格式 / 交互参考

- Moodle 题目导入：<https://docs.moodle.org/en/Import_questions>
- QTI 标准：<https://www.1edtech.org/standards/qti>
- H5P Drag and Drop：<https://h5p.org/drag-and-drop>
- Anki Image Occlusion：<https://docs.ankiweb.net/editing.html#image-occlusion>

### Hugging Face

- Qwen3-VL-8B-Instruct：<https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct>
- PaddleOCR-VL：<https://huggingface.co/PaddlePaddle/PaddleOCR-VL>
- dots.ocr：<https://huggingface.co/dots-studio/dots.ocr.base>
- olmOCR-2-7B：<https://huggingface.co/allenai/olmOCR-2-7B-1025>
- GOT-OCR2.0：<https://huggingface.co/stepfun-ai/GOT-OCR2_0>
- TrOCR handwritten：<https://huggingface.co/microsoft/trocr-base-handwritten>
- MathVista：<https://huggingface.co/datasets/AI4Math/MathVista>
- MathVerse：<https://huggingface.co/datasets/AI4Math/MathVerse>
- Geometry3K：<https://huggingface.co/datasets/MrZilinXiao/geometry3k>
- AI2D：<https://huggingface.co/datasets/Ryoo72/ai2d>
- UniMER：<https://huggingface.co/datasets/wanderkid/UniMER_Dataset>
- 中文试卷题目框：<https://huggingface.co/datasets/ccace/chinese-exam-question-regions>
