# 文档渲染 QA 日志

> **历史参考。** 本文是一次文档渲染检查记录，不描述当前项目功能。请从 [文档地图](../../../README.md) 开始。

当前状态：`WAITING_EXTERNAL_INPUT`。自动生成器、共享 report-data 模型和固定渲染器脚手架已准备；真实研究数据、LibreOffice/Poppler/Noto CJK 的生产 digest 和逐页视觉检查尚未发生。结构化检查已锁定 DOCX 的 `zh-CN` 默认语言、Heading 层级、首行表头/跨页重复属性、图表替代文字、相邻数据表和可解释链接。固定 Playwright 1.62.0 的 `page.pdf` 类型未提供 `tagged/outline` 能力，因此正式 PDF 不声明 PDF/UA、标签树或书签已通过；待渲染器和人工检查补充文本提取、标题/阅读顺序、空页、乱码、溢出和边界结果。任何正式研究 DOCX/PDF 只能在 R4 后生成候选或最终成果，并在这里记录页数、乱码、空页、表格溢出、阅读顺序和人工复查结果。

正式报告渲染命令会用同一 report-data 对应的打印 HTML/Playwright 生成交付 PDF；DOCX 只转换到隔离的 `.qa-render/` 目录生成 QA PDF/逐页 PNG，并写出 `document-render-qa.json`。自动结果只标记结构化生成成功，`visualReviewStatus` 固定为 `WAITING_HUMAN_REVIEW`，不会把缺少 LibreOffice/Poppler 或未逐页复核的文件标成通过。

| 日期 | 文件 | 结构化检查 | 视觉检查 | 状态 |
|---|---|---|---|---|
| 2026-08-22 | `deliverables/acceptance-materials/成果接收页.{docx,pdf}`、`项目实践与成果接收证明.{docx,pdf}` | DOCX/PDF 均可读取；包含“草稿/未签署”水印、条件式措辞和空白事实字段；未写入姓名、日期、签字、盖章或已接收结论 | 当前环境缺少 LibreOffice/Poppler，未生成 PNG，不能宣称视觉通过 | `STRUCTURAL_ONLY_WAITING_RENDERER` |
