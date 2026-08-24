# 编码实施计划逐步覆盖表

本表把《AccessCheck_Lishui_编码实施计划》的 19 个执行步骤映射到当前仓库的交付物、质量门和外部依赖。它是自动化实现的审计索引，不替代 R1–R5 真人 receipt，也不把 fixture 或候选成果当作正式研究结果；不得伪造外部输入或人工确认。

| 步骤 | 计划主题 | 当前状态 | 主要交付物/入口 | 自动化质量门 | 仍需外部行动 |
| ---: | --- | --- | --- | --- | --- |
| 1 | 工程初始化与质量门 | `AUTOMATED_COMPLETE` | `package.json`、锁文件、依赖预检、lint/typecheck/format/test 总门 | `pnpm dependency:preflight`、`pnpm test:all` | 无 |
| 2 | 领域类型、配置和日志 | `AUTOMATED_COMPLETE` | `src/lib/config.ts`、`src/lib/logger.ts`、共享领域模块 | `pnpm typecheck`、`pnpm lint`、集成测试 | 无 |
| 3 | 已知问题 fixture 网站 | `AUTOMATED_COMPLETE` | `tests/fixtures/known-issues/`、fixture 扫描测试 | `pnpm test:integration`、`pnpm test:e2e` | 无；fixture 不得替代正式站点 |
| 4 | SQLite 数据库和迁移 | `AUTOMATED_COMPLETE` | `migrations/`、数据库检查、备份恢复脚本；迁移 27 增加薄 AI overlay 的 evidence 字段和三张 AI 表 | `pnpm db:check`、AI schema 测试、集成迁移/恢复测试 | 正式数据仍需外部输入 |
| 5 | 管理与双 reviewer 认证 | `AUTOMATED_COMPLETE` | 管理员/reviewer 登录、CSRF、角色绑定 API/UI | `pnpm test:scoring`、`pnpm test:e2e`、契约门 | 真人 token 由负责人提供 |
| 6 | URL 安全层 | `AUTOMATED_COMPLETE` | `src/lib/url-security.ts`、SSRF/重定向/robots 策略 | URL 安全测试、`pnpm egress:check` | 真实站点许可由负责人提供 |
| 7 | 站内页面发现器 | `AUTOMATED_COMPLETE` | crawler/BFS、同源边界、深度/时长/页面上限 | fixture 扫描与集成测试 | 真实网站清单由负责人提供 |
| 8 | 单页 axe 扫描器 | `AUTOMATED_COMPLETE` | Playwright、四类 axe 结果、frame coverage、失败记录；incomplete 在 frame 存在时保存 best-effort AI evidence | fixture 扫描、AI evidence/数据库测试、E2E、集成测试 | 真实采集窗口和许可由负责人提供 |
| 9 | axe 规则目录和 WCAG 解析 | `AUTOMATED_COMPLETE` | 105 条冻结目录、中文目录、WCAG 映射/黄金快照 | `pnpm catalog:check`、WCAG 测试 | 可信标准来源及中文解释复核由负责人提供 |
| 10 | 固定评分模块 | `AUTOMATED_COMPLETE` | `accesscheck-score-v1` TS/Python 双实现、敏感性配置 | `pnpm test:scoring-parity`、`pnpm test:analysis` | R1 预注册确认由两位负责人完成 |
| 11 | 完整站点扫描与 Worker | `AUTOMATED_COMPLETE` | Worker lease/heartbeat/recovery/cancel、egress proxy | 集成恢复测试、`pnpm ops:check`、E2E | Docker/生产代理实际 smoke 需外部环境 |
| 12 | API | `AUTOMATED_COMPLETE` | OpenAPI 路由契约、统一错误、分页/筛选/导出/发布 API；AI provider/batch API | `pnpm contract:check`、AI worker/provider 测试、集成/E2E | 实际 provider API Key 由运行负责人配置 |
| 13 | 完整 Web 页面 | `AUTOMATED_COMPLETE` | 首页、扫描进度、结果、问题、研究、报告、reviewer 页面；设置页和现有扫描页 AI 卡片/证据详情 | Next build、Playwright E2E、axe 页面检查、Lint | 无 |
| 14 | HTML/PDF/CSV/JSON 导出 | `AUTOMATED_COMPLETE` | run/study export、manifest/hash、报告/DOCX/PDF 生成与验证；独立 `study_final_ai` 分支和五个 AI 文件 | 集成导出测试、AI export 契约、候选报告测试、`pnpm deliverables:verify` | LibreOffice/Poppler 逐页视觉 QA 需外部环境/人工 |
| 15 | Python/Jupyter 与跨语言一致性 | `AUTOMATED_COMPLETE` | notebook、标准库 runner、统计/图表/report-data | `pnpm test:analysis`、黄金数据、候选分析测试 | 正式导出必须来自真实 study source |
| 16 | 端到端测试 | `AUTOMATED_COMPLETE` | 登录→扫描→审核→发布→导出→撤下完整流程 | `pnpm test:e2e`（3 passed） | 无 |
| 17 | Docker、运维和文档 | `AUTOMATED_COMPLETE_WAITING_EXTERNAL_RUNTIME` | 本地/生产 Compose、Caddy、备份、README、文档契约门 | `pnpm ops:check`、`pnpm hygiene:check`、`pnpm docs:check`、`pnpm plan:check` | 当前桌面无 Docker/Compose；实际 smoke、视觉 QA、生产部署待外部环境 |
| 18 | 正式验证和发布冻结 | `WAITING_EXTERNAL_INPUT` | `research/` 模板、study campaign/freeze、R1–R4/R5 gate、release 验证器 | `pnpm project:status`、`pnpm project:resume`、各 gate/发布脚本 fail-closed 测试 | R1–R5 receipt、真实站点、正式研究数据、服务器/DNS/密钥/镜像 |
| 19 | 成果材料和两人接手包 | `AUTOMATED_COMPLETE_WAITING_EXTERNAL_INPUT` | 候选/最终报告生成器、接收模板、交接包、外部交付证明契约 | `pnpm handoff:check`、候选/报告测试、`pnpm deliverables:verify` | R4/R5、真实报告数字、真人签收、外部交付 attestation |

## 状态含义

- `AUTOMATED_COMPLETE`：本地代码、模板和自动化质量门已完成，不代表真实研究或公网发布已完成。
- `AUTOMATED_COMPLETE_WAITING_EXTERNAL_RUNTIME`：静态配置和可测试脚手架已完成，但当前机器缺少 Docker、渲染器或生产环境，不能伪造运行通过。
- `WAITING_EXTERNAL_INPUT`：计划明确要求真人、真实站点、正式数据或外部基础设施；系统保持 fail-closed。

每一行的命令都必须在当前提交上重新运行；`pnpm test:all` 会先执行 `pnpm plan:check` 间接要求的文档/状态契约。任何行的状态改变都必须同步更新 `IMPLEMENTATION_STATUS.md`、`EXTERNAL_INPUTS.md` 和 `docs/validation-log.md`，不得只修改本表。
