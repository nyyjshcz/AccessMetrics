# 实施状态

- 当前状态：`WAITING_EXTERNAL_INPUT`
- 当前自动化基线 commit：本提交（以 `git rev-parse HEAD` 获取完整 SHA；未创建 release tag，未公网发布）。
- 自动化实现：已完成计划步骤 1–17，以及步骤 18/19 所有不依赖真人或外部单位的代码、契约、脚手架、fixture、报告生成器、可复现分析管线和 fail-closed 校验。
- 真实阻塞：R1–R5 真人确认、真实研究站点/许可/标准来源、生产服务器/域名/密钥/镜像与渲染器 digest。详见 [EXTERNAL_INPUTS.md](EXTERNAL_INPUTS.md)。

## 已实现链路

- 依赖基线与负面 fixture：Node 24.19.0、pnpm 11.19.0、Python 3.12.13、Next/Playwright/axe 精确版本检查。
- 依赖预检会实际执行 `PYTHON_BIN`/系统 Python 并解析 `--version`；当前捆绑解释器为 Python 3.12.13，系统 Python 3.13.7 会按设计失败，不再信任伪造的 `PYTHON_VERSION`。
- 依赖预检也会实际执行 pnpm（Windows 通过 `cmd.exe`，Unix 直接执行）并核对 11.19.0，不只检查 `package.json` 的声明。
- SQLite 迁移 1–25：外键、WAL、job/page lease、恢复、幂等唯一键与索引、frame 覆盖、研究 campaign/freeze/export、人工 review/adjudication、门证据/outbox、发布 revision/CAS 字段、R5 双角色 artifact 会话、study export current 唯一约束、扫描时本地化 hash、frame 覆盖问题记录、axe 运行时证据快照，以及 R5 clean-clone exercise 草稿、revision artifact 路径、规范化 owner artifact/step/bundle 表和严格的 `artifact_kind/artifact_id/canonical_json` artifact outbox；迁移 18–25 补齐按任务/运行追溯的页面身份、精确/展示分数字段、结果节点 frame 证据、评审当前版本唯一性、R5 不可覆盖证据和恢复队列、正式 attempt 的替补启用时间、任务/结果/R5 全部计划索引，并重建旧版 pages 表以移除站点级 URL 唯一约束。
- URL 安全、robots、同站 BFS、页面深度/资源过滤、Playwright + 本地 axe 四类结果、同源/跨源 frame 尝试、节点清理和非 HTML 失败记录。
- WCAG 2.2 方法目录、axe 4.13.0 完整规则目录生成器、中文目录、独立黄金快照、节点/规则严重程度来源和 `accesscheck-score-v1` TypeScript/Python 参考实现；多原则规则只计一次总体机会并分别归入原则分项。
- axe 目录已冻结为 105 条规则并补齐 WCAG 条款、原则、等级、是否进入 A/AA 评分及未映射原因；运行时不再依赖不完整的手写规则子集。中文规则目录已生成 105 条，未人工核对时明确保持 `ai_draft`。
- Worker、管理员/双 reviewer 会话、CSRF/Origin、API、Web 页面、取消、抽样、复核/裁决、HTML/PDF/CSV/JSON、manifest 原始字节 hash、ZIP/隐私门；R5 exercise API 由服务端创建绑定 rcCommit 的隔离 clean clone，只执行固定 catalog 命令并保存 tree/environment/index/catalog/output hash、观察记录和 revision；理解检查由服务端评分，handoff 从正式文件重算 A–E evidence hash，finalize 需要本人二次认证，三类 artifact 使用不可覆盖 revision 文件、DB outbox 和共同 bundle。理解检查绑定固定题集 hash，按每主题五个要点和总分门槛服务端计算，失败尝试留证且不能靠客户端 `passed` 绕过。
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
- 本轮生产安全审计还补齐了显式 egress proxy：Crawler 的 robots 请求和 Chromium 请求共用代理策略，禁止代理绕过、QUIC、后台网络和 WebRTC 本地地址泄漏；扫描器把 401/403/其他 HTTP 错误保存为结构化失败；Worker 按固定 `SCAN_RETRY_COUNT=1` 重试并把配置快照写入 run；站点发现受最大深度和总时长限制，最终重定向必须保持同源。
- 生产配置现在要求 Worker 使用隔离的 `scan-isolated` 内部网络和显式代理，代理策略拒绝私网、保留地址、文档示例网段、metadata、IPv4-mapped/ULA/link-local IPv6，并提供 `pnpm egress:check`；Caddy 未提供 `CADDY_SITE` 时 fail-closed，应用镜像在构建时安装固定 Playwright Chromium。
- 本轮完成度复核又补齐了 `scan:page`/`scan:one-page` 的无副作用共享 CLI（每次命令只启动一次扫描）、下载型非 HTML 响应的 `NON_HTML` 结构化错误、robots deny/最大深度/总时长/三次确定性发现回归，以及混合图片 pass/violation、浏览器关闭后重启和 PDF 下载 fixture；egress proxy 的 IPv6 判定改为按地址段解析并拒绝所有 IPv4-mapped 形式。
- 本轮安全与验收复核补齐了双角色 cookie 并存时的服务端 role 选择、错误角色 403/未登录 401 区分、生产 reviewer token 不得相同、Caddy 可信代理标记重写，以及只接受可信代理注入的 rate-limit 客户端地址。
- 生产 Web 现在在服务端配置模块加载时即 fail-closed 检查私有证据根目录存在、0700（非 Windows）且可读写，并同时检查生产 secrets 与 egress proxy；缺失或不可写时不会接受首个请求，health endpoint 仍保留 503 作为运行态诊断。
- `contracts/api.openapi.yaml` 已补齐源码下全部 API 路由（含管理、认证、研究、报告、发布和 reviewer 别名路由）；`contract:check` 会递归扫描 `src/app/api/**/route.ts`，用规范化动态参数逐条拒绝未登记路由，避免新增接口只写代码不更新契约。
- OpenAPI 契约门现在同时逐个比对源码 route handler 的 HTTP 方法；新增或遗漏方法会在质量门直接失败。单次 run 导出补齐 `site/configSnapshot/ruleResults/resultNodes/pageScores/siteScore/reviewRefs/provenance` 等可追溯 DTO，`run-export.schema.json` 锁定这些字段；研究导出生成固定的 `data/study.json`、12 张 UTF-8 BOM/CRLF CSV、schema/config/research 目录，source 不带人工审核 payload，manifest 记录行数/字节/hash，`export:verify` 逐项复核原始字节和 CSV 行数。
- run 导出的 `reviewRefs` 由服务端按上下文整理：ad-hoc 只显示自身最终判断，formal batch 在双方完成前只返回进度/`finalVerdict=null`，双方一致取 agreement，分歧只有 approved adjudication 才输出；研究 source/final 复制 run 文件时按允许的正式样本节点重新绑定嵌套 manifest，避免把 ad-hoc 或盲审答案带入研究总体。
- R5 artifact 现在由服务端按 canonical 字节写入 `gates/R5/artifacts/<role>/<type>.r<revision>.json`，三个 artifact schema 均强制要求 `artifactHash`；`artifactHash` 是省略自身后的 canonical JSON（含尾换行）的 SHA-256，数据库/bundle 绑定该语义 hash，outbox 的 `expected_file_hash` 单独绑定完整文件字节 hash。系统会在恢复、重复提交、归档、finalize 和 gate 展开时同时校验两种 hash，并通过严格的 `artifact_kind/artifact_id/canonical_json` DB outbox 恢复/校验磁盘 hash；跨 rcCommit 的同名旧文件按 commit 归档，绝不覆盖历史证据。修订会使共同 bundle 和双方 finalize 失效，缺失/篡改/冲突均 fail-closed。gate receipt 改为完整 receipt 字节 hash，outbox 幂等写入并有双角色 fixture 验证。
- R5 规范化表已与旧 session read-model 同步：`r5_owner_artifacts` 保存角色/版本/当前状态，`r5_exercise_steps` 保存固定命令结果，`r5_artifact_bundles` 保存六份 passed hash；R5 gate 只接受服务端按 `rcCommit` 找到的 ready bundle，不能由请求体自报 artifacts。页面 worker 增加 10 秒 heartbeat、租约拥有者 CAS、崩溃恢复、重试上限、取消时批量终止剩余页面和每页事务提交。
- 研究导出现在先写私有证据根下的隔离临时目录，校验 UTF-8 BOM/CRLF、固定列、CSV 外键、study.json runSet、manifest 条件约束和 payload hash 后才原子改名；校验失败只清理临时目录，不会留下可被当作正式导出的半成品。`export:verify` 同样检查 payload 完整清单、source/final 条件字段和研究绑定。
- study_final 的报告中文目录、模型决策和模型观察文件必须从私有 R4 证据按冻结 SHA-256 精确找到并复制，工作区 `ai_draft` 文件不能冒充 human-reviewed；study source 明确拒绝 final/R4 材料。研究 sites CSV 同时保留站点类别，分析输出增加均值/中位数/四分位数、类别描述、Cohen kappa 和三套权重的 Spearman 排名相关，并在 provenance.calculationKeys 记录来源与筛选键。
- HTML/PDF 报告共享 `AuthorizedRunReportDto` 和 `renderRunReportHtml`；PDF 只把授权后的自包含 HTML 通过 Playwright `page.setContent()` 打印，不访问扫描站点或 `file://` 报告 URL。
- 本轮界面闭环已接入真实数据：首页显示已发布站点/成功页面/最近扫描统计，扫描任务页支持取消与错误状态，结果页展示页面状态和 coverage，问题页支持结果类型/规则/人工状态/影响/原则/排序筛选，报告页展示四原则、主要问题和边界，研究页展示版本/类别筛选后的数据表，reviewer 页按角色加载样本并提交正式复核；报告接口与 HTML/PDF 共用主要问题 DTO。
- 本轮完成度审计又补齐结果页严重度/四原则分布、问题 API 与页面的节点定位/清理片段/失败原因、HTML/PDF/报告页代表性节点证据，以及研究总览的版本过滤、站点四原则分数、分布统计、类别比较、常见规则、严重度/原则图表和对应数据表；缺失版本三元组的历史 run 不会进入研究基线。
- 在上述审计后的闭环复跑中，又补齐扫描任务的开始/结束/耗时/当前页面字段、研究总分排名与 10 档直方图数据、PDF 页眉页脚和 A4 打印边距；最终 `pnpm test:all` 覆盖这些改动并通过。
- 本次按计划逐项复核了步骤 1–19 的自动化命令、交付物和质量证据；`release:* --help`/`publication:preflight --help` 均可启动，`pnpm project:resume` 在缺少 R1–R5 真人证据时按设计以退出码 2 保持等待，未生成伪造正式成果。
- 正式抽样请求现在必须绑定并由服务端复核 `sourceManifestHash`；formal/ad-hoc 审核修订要求 `expectedRevision` 与 `supersedesReviewId`，裁决批准要求相同 `resolutionHash`/revision，旧版本不能静默覆盖。
- 成果 candidate/verify/release 链现在要求固定的 report-data、两份最终报告、图表/表格 hash、R1–R5 数据库绑定 evidence 和分别重算的 `r4EvidenceBundleHash`/`fullGateBundleHash`；缺任何输入均失败，不再把可选参数或文件存在当作完成证明。
- R4 候选链已按计划收紧：`report-data.candidate.json` 使用独立 schema、禁止 `exportId/manifestHash/outcomeDigest/r4EvidenceBundleHash` 等 final 字段，并通过 `$defs` 与最终 report-data 共用分数、frame、人工样本、图表和局限定义；candidate bundle 固定绑定 source/review-freeze/localization/model/commit 以及五个候选文件的 bytes/SHA-256，candidateBundleId 对语义内容完整 hash，候选目录原子写入、只读、可幂等复用。
- 候选契约校验不仅检查顶层字段，还在运行时锁定 frame、scores、manualValidation、charts、limitations 的字段集合、类型、范围和路径安全；生成器与 bundle 命令共用同一校验器，不能用“文件存在”绕过 schema。
- 候选报告生成器现在显式输出 `REVIEW CANDIDATE — NOT FINAL`，只显示 source/review-freeze 身份；`pnpm deliverables:candidate` 会拒绝最终身份字段、最终 schema、缺失模型 hash、缺失候选水印或多余文件，并有 3 个 CLI 集成回归测试覆盖首次写入、幂等复用、final 字段拒绝和 candidate report-data 生成。
- 正式研究链现在按计划计算固定的 `populationDigest`（run/page/rule/result/node 稳定排序与 stable node hash）、独立 execution-log hash、版本三元组和 freeze digest；R1 后 execution log 只追加真实 attempt，source/final 导出经过 `generating -> verified` CAS，source 目录和 review-freeze 只读且同 outcome 幂等。
- study freeze 状态严格推进 `registered -> source_verified -> reviews_completed -> r4_verified -> final_verified`；R3 review-freeze 先进入 `awaiting_r3`，两份 R3 receipt 经 `project:resume` 才晋级，review/adjudication/R4 修订会在同一事务撤下旧 final 并回退到最早失效门。分析报告沿用冻结 manifest 的 populationDigest，不再产生另一套近似总体 hash。
- `gates:verify`、`project:status` 和 `project:resume` 现在会核对 receipt artifact 当前 hash、数据库 current approved 记录、outbox=`written`、outbox 字节/目标路径/hash、R5 六项排序 bundle、共同 bundle hash、两份公共 artifact 集、前置门顺序及 R5 两份相同 40 位 bound commit；不会以文件存在代替数据库事实。

## 最近自动化质量门（2026-08-22）

以下命令已通过（最后一次完整质量门，2026-08-22）：

```text
pnpm dependency:preflight
pnpm test:dependency-preflight
pnpm db:migrate
pnpm db:check
pnpm egress:check
pnpm catalog:generate
pnpm catalog:check
pnpm ops:check
pnpm hygiene:check
pnpm handoff:check      # 8 份接手包文件、内部链接、35 个 FAQ 与命令索引
pnpm contract:check
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:integration     # 6 files, 19 tests
pnpm test:scoring-parity  # 5 files, 22 tests
pnpm test                 # 11 files, 41 tests
pnpm test:analysis
pnpm build                # Next production build
pnpm test:e2e             # 3 browser tests（核心页面 axe、匿名权限、完整 fixture 扫描/审核/发布/导出/撤下流程）
pnpm test:all             # 上述依赖、静态检查、hygiene/handoff:check、egress policy、41 个 Vitest 测试、Python 分析、构建与 3 个 E2E 总门
node scripts/r5-fixed-exercise.mjs <六个固定 exercise id>  # 六项固定 catalog action 均返回 passed
pnpm project:status       # 输出 WAITING_EXTERNAL_INPUT，自动实现 ready
pnpm project:resume       # 当前按预期拒绝续跑，直到 R1–R5/外部输入齐全
```

本轮 R5 outbox/path 收敛后的完整质量门再次通过：迁移 1–25、integration 6 files/19 tests、scoring 5 files/22 tests、全量 11 files/41 tests、Python 分析、Next build、3 个 Playwright E2E；新增测试确认 outbox 仅含计划字段、固定 artifact 路径和跨 commit 归档行为。

本轮候选链局部质量门另外通过：

```text
pnpm exec vitest run tests/integration/candidate.test.ts  # 1 file, 3 tests
pnpm analysis:candidate  # source report-data -> candidate report-data，final 字段剥离与幂等写入通过
pnpm deliverables:candidate  # 使用隔离临时 fixture：首次写入 + 幂等复用均通过
pnpm report:generate -- --mode candidate  # 候选页眉及 source/review-freeze 绑定通过
```

已知但非失败的提示：Next 16.3.0 提示 `middleware` 未来迁移到 `proxy`，Vite/Vitest 提示未来的 native config loader，以及运行时可配置目录导致的 tracing warning；均不影响当前构建结果。Playwright E2E 使用 standalone 输出的兼容启动方式，测试通过但 `next start` 会提示应使用 standalone server。生产 Playwright/Smokescreen/LibreOffice/Poppler 镜像 digest 尚未由外部环境提供，不能标为已上线。Docker 当前未安装，因此只完成静态配置和本地代理源码检查，未冒充 Compose/公网部署通过。

## 恢复规则

真人输入齐全后运行 `pnpm project:resume`。它必须先验证文件、hash、数据库和 gate evidence，再从固定检查点继续；不会覆盖已 verified 的 source/final，也不会把模板、fixture 或 AI 草稿当正式研究结果。

当前仓库已建立本地自动化基线提交，但没有创建正式 release tag，也没有执行公网发布；发布验证仍必须绑定真实 R1–R5 evidence、生产构建 provenance 和接收单位确认。

## 容量边界

本项目保证 10–20 个正式站点、约 100–300 个成功页面规模下的数据完整性、一致性、可恢复性和可追溯性，不承诺 SQLite 承载一千亿行。若确需一千亿行，需要另立分布式采集/对象存储/分区分析数据库项目。
