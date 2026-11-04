# PDF.js vendor

- 来源：`pdfjs-dist@3.11.174` 的 legacy build（npm）。
- 文件：`pdf.min.js`、`pdf.worker.min.js`。
- 许可证：Apache-2.0，见同目录 `LICENSE`。

未包含 `cmaps/` 和 `standard_fonts/`：当前三本五年级上册 PDF 的字体已嵌入，实测渲染时不会请求这两类资源；如果以后加入其他 PDF 出现缺字或字体错误，从 npm 包恢复 `cmaps/`、`standard_fonts/`，并在 `textbooks/assets/reader.js` 的 `getDocument` 参数里加回 `cMapUrl` 和 `standardFontDataUrl`。
