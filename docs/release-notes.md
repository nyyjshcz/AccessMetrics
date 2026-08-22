# AccessCheck Lishui 发布说明（模板）

状态：`AUTOMATED_IMPLEMENTATION_COMPLETE / WAITING_EXTERNAL_INPUT`

## 本次自动化实现

- 公开 URL 的安全校验、同站发现、Playwright/axe 扫描和 frame 覆盖记录；
- SQLite 迁移、任务 lease/恢复、精确评分、导出 manifest 和隐私门；
- 管理员与双 reviewer 权限、R1–R5 fail-closed 门禁、报告与可复现分析；
- 本地 Compose、生产 Caddy/egress 模板、备份恢复和发行验证脚本。

## 验证

以 `docs/validation-log.md` 为准。最近一次 `pnpm test:all` 已通过 integration 7 个文件/21 个测试、scoring 5 个文件/22 个测试、全量 Vitest 12 个文件/44 个测试、Python/notebook、构建和 3 个 E2E 测试，并包含仓库发布卫生门。

## 正式研究数据

本模板不填入真实网站、分数、排名、人工审核或接收结论。R1–R5、真实站点/许可/标准和生产部署输入齐全后，使用 `pnpm project:resume` 继续生成正式成果；AI 不得用 fixture 或草稿替代这些证据。

## 已知边界

项目保证约 10–20 个站点、100–300 个成功页面规模下的可追溯性，不承诺 SQLite 一千亿行；不把自动 axe 分数写成完整 WCAG 合规率，也不外推为全丽水总体结论。
