# 实施状态

- 当前状态：`WAITING_EXTERNAL_INPUT`
- 当前自动化基线 commit：`a528a3145968d5828fde0cba7c0431a48223ca76`（未创建 release tag，未公网发布）。
- 自动化实现：已完成计划步骤 1–17，以及步骤 18/19 所有不依赖真人或外部单位的代码、契约、脚手架、fixture、报告生成器、可复现分析管线和 fail-closed 校验。
- 真实阻塞：R1–R5 真人确认、真实研究站点/许可/标准来源、生产服务器/域名/密钥/镜像与渲染器 digest。详见 [EXTERNAL_INPUTS.md](EXTERNAL_INPUTS.md)。

## 已实现链路

- 依赖基线与负面 fixture：Node 24.19.0、pnpm 11.19.0、Python 3.12.13、Next/Playwright/axe 精确版本检查。
- 依赖预检会实际执行 `PYTHON_BIN`/系统 Python 并解析 `--version`；当前捆绑解释器为 Python 3.12.13，系统 Python 3.13.7 会按设计失败，不再信任伪造的 `PYTHON_VERSION`。
- 依赖预检也会实际执行 pnpm（Windows 通过 `cmd.exe`，Unix 直接执行）并核对 11.19.0，不只检查 `package.json` 的声明。
- SQLite 迁移 1–21：外键、WAL、job/page lease、恢复、幂等唯一键与索引、frame 覆盖、研究 campaign/freeze/export、人工 review/adjudication、门证据/outbox、发布 revision/CAS 字段、R5 双角色 artifact 会话、study export current 唯一约束、扫描时本地化 hash、frame 覆盖问题记录和 axe 运行时证据快照；迁移 18–21 补齐按任务/运行追溯的页面身份、精确/展示分数字段、结果节点 frame 证据、评审当前版本唯一性，并重建旧版 pages 表以移除站点级 URL 唯一约束。
- URL 安全、robots、同站 BFS、页面深度/资源过滤、Playwright + 本地 axe 四类结果、同源/跨源 frame 尝试、节点清理和非 HTML 失败记录。
- WCAG 2.2 方法目录、axe 4.13.0 完整规则目录生成器、中文目录、独立黄金快照、节点/规则严重程度来源和 `accesscheck-score-v1` TypeScript/Python 参考实现；多原则规则只计一次总体机会并分别归入原则分项。
- axe 目录已冻结为 105 条规则并补齐 WCAG 条款、原则、等级、是否进入 A/AA 评分及未映射原因；运行时不再依赖不完整的手写规则子集。中文规则目录已生成 105 条，未人工核对时明确保持 `ai_draft`。
- Worker、管理员/双 reviewer 会话、CSRF/Origin、API、Web 页面、取消、抽样、复核/裁决、HTML/PDF/CSV/JSON、manifest 原始字节 hash、ZIP/隐私门；R5 固定练习、理解检查、A–E 交接确认由服务端评分并生成共同 bundle。理解检查现在绑定固定题集 hash，按每主题五个要点和总分门槛服务端计算，失败尝试留证且不能靠客户端 `passed` 绕过。
- campaign、review、R1–R5、候选报告、发布验证、镜像/部署、加密私有证据备份恢复和交接包的命令与模板；缺真人输入时均 fail-closed，不写假数据。
- 可复现分析管线：只接受带 `manifest.json`/`manifest.sha256` 的已验证导出，输出 `report-data-v1`、站点分数/常见规则/严重度/四原则/敏感性/人工样本边界、确定性图表和数据表；Jupyter notebook 在缺真实导出时明确等待，不生成假研究结论。
- `analysis:run` 现在会执行并保存 `accesscheck_analysis.executed.ipynb`；优先使用 Jupyter/nbconvert，缺少该命令时使用仓库内标准库 runner，代码 cell 异常会使命令失败。
- 扫描器对 HTTP/HTTPS、SSRF、robots 重定向、service worker、同源/跨源 frame、axe 超时和非 HTML 响应统一记录；coverage 状态使用 `full`、`no_child_frames`、`coverage_limited` 并保存原因。
- 任务完成页可直接进入结果页；结果与重算 API 将精确分数的 BigInt 序列化为字符串；输入页、结果页、研究页、HTML/PDF 报告均显示统一项目边界免责声明。
- 本地 Compose Web 使用 standalone server 启动，生产 Caddy 使用外部 `CADDY_SITE`，仅在 HTTPS 请求上启用 HSTS；运维静态检查会拒绝误用 `next start` 的 compose 配置。
- 仓库发布卫生门 `pnpm hygiene:check` 会检查密钥/证书模式、超大文件、符号链接、治理文件和 `.gitignore` 隔离；发行验证脚本会在外部输入齐全后执行 candidate 单 parent/白名单差异、manifest/gate hash、DB CAS、clean clone、镜像 provenance 和 publish-readiness 核验。
- 成果接收页和《项目实践与成果接收证明》已生成 DOCX/PDF 条件式空白模板，统一保留“草稿/未签署/不能作为已接收证明”水印；当前缺少 LibreOffice/Poppler，只记录结构化检查，未冒充视觉 QA 通过。
- `scan:site`、`scan:page` 和 `backup:create` 的 CommonJS CLI 入口已改为显式异步主函数，实际命令可启动并在 URL 安全层 fail-closed；备份/恢复烟测已验证数据库、AES-256-GCM 私有文件、manifest hash 和文件数一致。
- 所有计划示例使用的 `pnpm <script> -- <参数>` 分隔符已统一处理；扫描、导出、研究导入、发布预检、备份恢复等 CLI 不会再把单独的 `--` 当作业务参数。
- 本轮审计还补齐了 axe 四类结果的扫描时间/引擎/环境/选项快照、页面级节点计数与 weighted defect 展示、通过规则的轻量 raw 证据、节点 HTML 300 字符上限、基于页面/规则/目标的稳定 target hash，以及错误响应的稳定 `errorEnvelope`。

## 最近自动化质量门（2026-08-22）

以下命令已通过（最后一次完整质量门，2026-08-22）：

```text
pnpm dependency:preflight
pnpm test:dependency-preflight
pnpm db:migrate
pnpm db:check
pnpm catalog:generate
pnpm catalog:check
pnpm ops:check
pnpm hygiene:check
pnpm handoff:check      # 8 份接手包文件、内部链接、35 个 FAQ 与命令索引
pnpm contract:check
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:integration     # 3 files, 11 tests
pnpm test:scoring-parity  # 4 files, 20 tests
pnpm test                 # 7 files, 31 tests
pnpm test:analysis
pnpm build                # Next production build
pnpm test:e2e             # 3 browser tests（核心页面 axe、匿名权限、完整 fixture 扫描/审核/发布/导出/撤下流程）
pnpm test:all             # 上述依赖、静态检查、hygiene/handoff:check、31 个 Vitest 测试、Python 分析、构建与 3 个 E2E 总门
pnpm project:status       # 输出 WAITING_EXTERNAL_INPUT，自动实现 ready
pnpm project:resume       # 当前按预期拒绝续跑，直到 R1–R5/外部输入齐全
```

已知但非失败的提示：Next 16.3.0 提示 `middleware` 未来迁移到 `proxy`，Vite/Vitest 提示未来的 native config loader，以及运行时可配置目录导致的 tracing warning；均不影响当前构建结果。Playwright E2E 使用 standalone 输出的兼容启动方式，测试通过但 `next start` 会提示应使用 standalone server。生产 Playwright/Smokescreen/LibreOffice/Poppler 镜像 digest 尚未由外部环境提供，不能标为已上线。Docker 当前未安装，因此只完成静态配置和本地代理源码检查，未冒充 Compose/公网部署通过。

## 恢复规则

真人输入齐全后运行 `pnpm project:resume`。它必须先验证文件、hash、数据库和 gate evidence，再从固定检查点继续；不会覆盖已 verified 的 source/final，也不会把模板、fixture 或 AI 草稿当正式研究结果。

当前仓库已建立本地自动化基线提交，但没有创建正式 release tag，也没有执行公网发布；发布验证仍必须绑定真实 R1–R5 evidence、生产构建 provenance 和接收单位确认。

## 容量边界

本项目保证 10–20 个正式站点、约 100–300 个成功页面规模下的数据完整性、一致性、可恢复性和可追溯性，不承诺 SQLite 承载一千亿行。若确需一千亿行，需要另立分布式采集/对象存储/分区分析数据库项目。
