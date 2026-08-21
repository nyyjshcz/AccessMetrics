# 文档渲染 QA 日志

当前状态：`WAITING_EXTERNAL_INPUT`。自动生成器、共享 report-data 模型和固定渲染器脚手架已准备；真实研究数据、LibreOffice/Poppler/Noto CJK 的生产 digest 和逐页视觉检查尚未发生。任何正式研究 DOCX/PDF 只能在 R4 后生成候选或最终成果，并在这里记录页数、乱码、空页、表格溢出、阅读顺序和人工复查结果。

| 日期 | 文件 | 结构化检查 | 视觉检查 | 状态 |
|---|---|---|---|---|
| 2026-08-22 | `deliverables/acceptance-materials/成果接收页.{docx,pdf}`、`项目实践与成果接收证明.{docx,pdf}` | DOCX/PDF 均可读取；包含“草稿/未签署”水印、条件式措辞和空白事实字段；未写入姓名、日期、签字、盖章或已接收结论 | 当前环境缺少 LibreOffice/Poppler，未生成 PNG，不能宣称视觉通过 | `STRUCTURAL_ONLY_WAITING_RENDERER` |
