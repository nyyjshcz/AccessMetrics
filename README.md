# AccessCheck Lishui

这是一个可追溯的网页无障碍自动扫描与研究资料生成系统：URL 安全校验 → 同站页面发现 → Playwright/axe 扫描 → WCAG 目录解析 → 四原则评分 → SQLite 记录 → HTML/PDF/CSV/JSON 导出 → 研究抽样、人工复核和发布门。

## 系统效果与计划运行清单

完成自动化实施后，使用者可以从管理端提交允许的公共 HTTP(S) 网站，看到扫描进度、页面和节点证据、严重度、四原则分数、问题筛选和可追溯报告；研究链还能从冻结的数据生成抽样、人工复核、统计图表、HTML/PDF/CSV/JSON 和研究 ZIP。自动评分是筛查和比较工具，不等于人工审计、官方 WCAG 合规认证或总体准确率。

### 前置环境

- Node.js `24.19.0`、pnpm `11.19.0`、Python `3.12.13`；`pnpm dependency:preflight` 会执行真实解释器并核对固定基线。
- 复制 `.env.example` 为 `.env.local`，由负责人提供管理、reviewer、CSRF、会话和加密备份密钥；密钥不进入 Git。
- 若要运行容器形态，需要 Docker Compose；正式 PDF/DOCX 视觉 QA 还需要固定版本的 LibreOffice、Poppler 和渲染器镜像。当前仓库没有把缺失工具伪装成通过。

### 本地与 Docker 启动

本地启动顺序是 `pnpm install` → `pnpm db:migrate` → `pnpm dev`，另开终端运行 `pnpm worker`。Docker 本地形态使用 `compose.yaml`（或兼容的 `docker-compose.yml`）：先准备 `.env.local`，再执行 `docker compose up --build`；它会同时启动 Web、Worker 和 egress-proxy，Worker 只加入隔离网络并通过显式代理出站。首次启动后检查 Web 健康端点、Worker 日志和迁移状态。生产形态使用 `compose.prod.yaml` 与 `Caddyfile`，必须先替换真实域名、密钥和固定镜像 digest。没有 Docker、服务器或域名时，只能运行静态配置检查，不能声称已部署。

### 管理、迁移、Web/Worker 和安全边界

- 管理口令由 `SCAN_ADMIN_TOKEN` 设置；`COMPUTER_REVIEW_TOKEN`、`MATH_REVIEW_TOKEN` 只授予对应 reviewer，不能互换。
- 数据库升级只通过幂等 `pnpm db:migrate`；升级前备份，升级后运行 `pnpm db:check` 和完整质量门。禁止手改生产库、跳过迁移或回滚到不匹配的代码/迁移组合。
- Web 负责会话、权限、CSRF/Origin、幂等键和已授权 DTO；Worker 只领取 lease 任务并写入结果。生产 Worker 使用非 root、sandbox/seccomp、`scan-isolated` 内部网络和显式 `EGRESS_PROXY_URL`，不能直连公网或绕过代理。
- 安全头、生产 Cookie、CSRF、Origin、SSRF、限速和发布 CAS 是 fail-closed 约束；不要为调试关闭这些检查。`pnpm egress:check`、`pnpm ops:check` 和自动化测试验证这些边界。

### 测试、扫描、发布与导出

- 完整质量门：`pnpm test:all`（包含 `pnpm docs:check` 文档契约检查和 `pnpm plan:check` 计划逐步覆盖检查）；浏览器流程：`pnpm test:e2e`；状态查询：`pnpm project:status`。
- 单站点扫描：`pnpm scan:site -- https://example.org --max-pages 10`。只允许计划中的公共站点，私网、环回、凭据 URL、代理绕过和未授权目标必须失败。
- 研究扫描和正式发布必须经过 R1–R5 receipt、冻结的 source export、报告数据和 manifest/hash 校验；使用 `pnpm deliverables:candidate`、`pnpm deliverables:build`、`pnpm deliverables:render`、`pnpm deliverables:verify`。任何缺失真人门或正式输入都会保持 `WAITING_EXTERNAL_INPUT`。
- 导出必须来自结构化数据库数据并原子写入；`export:verify`、`gates:verify` 和报告验证脚本检查固定列、canonical JSON、字节/hash、权限和敏感字段。正式 PDF 只能来自同一 `report-data-v1` 的打印 HTML；DOCX 转换结果只放入 `.qa-render` 做视觉 QA。

### Jupyter、备份恢复、上线检查与升级

- 分析 notebook 位于 `analysis/notebooks/accesscheck_analysis.ipynb`，入口说明见 `notebooks/README.md`。正式数据到位后用冻结的 study source 运行，不从网页实时取数；`pnpm test:analysis` 会验证 Python 参考实现和 notebook 代码单元。
- 备份：`pnpm backup:create -- --output <绝对目录>`；恢复到独立目录后运行 `pnpm backup:restore <备份目录> <新目标目录>`、设置 `DATABASE_URL`、执行 `pnpm db:check` 和 `pnpm gates:verify`。数据库、加密私有证据和 manifest 的记录数/hash 必须一致。
- 公网上线前逐项确认服务器、域名、DNS、HTTPS 证书、Caddy 反向代理、生产 Cookie、CSRF/Origin、限速、安全头、日志轮转、健康检查、备份恢复和镜像 digest；这些是外部动作，不由 AI 伪造。
- 升级规则：先冻结并记录依赖、迁移和镜像 digest，备份并在独立环境运行 `pnpm test:all`；确认迁移可重复、导出/hash 不变后再发布。依赖变更必须重新运行预检、测试和冻结流程，不能只改版本字符串。

### 外部输入与自动评分限制

真实研究协议、丽水样本、正式网站许可/标准快照、R1–R5 receipt、生产服务器/域名/密钥、固定代理/渲染器镜像等列在 `EXTERNAL_INPUTS.md`。缺少它们时先完成所有本地代码、测试、模板和脚手架，状态保持 `WAITING_EXTERNAL_INPUT`；输入齐全后运行 `pnpm project:resume` 幂等续跑。`project:status` 只在研究门已通过且 Git 外 `private-inputs/external-delivery/attestation.json` 通过 schema/canonical hash 校验后才会显示 `EXTERNAL_DELIVERY_COMPLETE`，不会把文件存在当成真实交付。自动评分只表示已定义规则下的可重复筛查结果，不能替代人工 verdict、完整人工审计或合规认证。

## 本地启动

1. 使用计划锁定的 Node 24.19.0、pnpm 11.19.0、Python 3.12.13。依赖预检会实际执行 `PYTHON_BIN`（未设置时使用系统 `python`/`python3`）读取版本，不接受只设置版本字符串的方式。
2. 复制 `.env.example` 为 `.env.local`，再运行 `pnpm install`、`pnpm db:migrate`。
3. 运行 `pnpm dev` 打开管理页面；另开终端运行 `pnpm worker`。
4. 使用 `pnpm scan:site -- https://example.org --max-pages 10` 进行一次受控页面发现；完整任务则提交管理端后由 `pnpm worker` 执行。

本地 Compose 使用 `node standalone/server.js` 启动 Next standalone 服务器；生产 Compose 需要提供真实 `CADDY_SITE`、密钥文件和固定 egress/渲染器镜像 digest，不能把示例值直接用于公网。生产 Worker 和 crawler/scanner 使用同一个显式 `EGRESS_PROXY_URL`，Chromium 禁用 QUIC、后台网络和代理 bypass；缺少代理时生产 Worker 会拒绝启动。

管理端使用 `SCAN_ADMIN_TOKEN`；两类 reviewer 分别使用 `COMPUTER_REVIEW_TOKEN` 和 `MATH_REVIEW_TOKEN`。这些值必须由真人通过外部密钥配置提供，不能写入 Git。

## 运行与数据边界

数据库启动时执行幂等迁移（当前为 1–25），Worker 使用 lease/heartbeat 领取任务；重启会恢复可恢复任务，取消和失败会保留状态事实。正式导出、逐节点结果、人工审核、R1–R5 证据和密钥都放在 Git 外的只读/私有目录，`backup:create` 与 `backup:restore` 会校验数据库、加密私有证据和 manifest 的 hash。R5 正式 outbox 使用 `artifact_kind/artifact_id/canonical_json` 多态记录；artifact 以固定 role/type/revision 路径写入，跨 commit 的同名历史文件按 commit 归档，不覆盖旧证据。

R5 不能上传任意命令或客户端自报分数：服务端先校验 R1–R4 索引，再在私有根下建立绑定 `rcCommit` 的 clean clone，只执行固定 exercise catalog，并保存 tree/environment/index/catalog hash、stdout/stderr hash 和 revision。理解检查由服务端评分；handoff 和 finalize 需要对应 reviewer 二次认证。R5 artifact 使用不可覆盖的 revision 文件和 outbox 恢复机制。

正式成果验证必须同时提供外部 final export、report-data、两份最终报告、R1–R5 gate evidence 以及 R4/full bundle hash：

```text
pnpm deliverables:verify -- --final-export-path <绝对目录> --expected-manifest-sha256 <sha256> --report-data <绝对json> --reports-root <绝对目录> --gate-evidence-path <绝对gates目录> --expected-r4-evidence-bundle-sha256 <sha256> --expected-full-gate-bundle-sha256 <sha256> --publication-db <绝对SQLite文件>
```

缺少真人门、真实站点/许可、固定渲染器或生产部署输入时，命令必须失败并保持 `WAITING_EXTERNAL_INPUT`；不会用 fixture、模板或 AI 草稿替代正式数据。

## 质量门

`pnpm test:all` 覆盖依赖负面 fixture、lint、格式、类型、数据库、egress DestinationPolicy、契约、发布卫生、文档契约、计划逐步覆盖、Vitest、Python 参考实现和生产构建；`pnpm test:e2e` 覆盖浏览器冒烟。逐步状态索引见 [docs/plan-coverage.md](docs/plan-coverage.md)。`pnpm report:generate -- --mode candidate` 只接受 `report-data.candidate.json`，输出 `REVIEW CANDIDATE — NOT FINAL` 且不写 final export 身份；final 模式必须有 R4 marker。R4 候选包使用：

```text
pnpm deliverables:candidate -- --source-export <绝对目录> --review-freeze <绝对文件或目录> --candidate-files <绝对目录> --output-root <绝对目录> [--report-localization-draft <绝对文件>]
```

候选目录必须恰有 `report-data.candidate.json`、`model-decision-record.md`、`model-observations.md` 和两份候选报告；脚本会核对 source/review-freeze/localization/model/commit hash，排除 final 字段，按五个文件的字节和 SHA-256 生成可复用的 `candidateBundleId`，并原子写入只读 bundle。`pnpm deliverables:templates` 生成带条件式水印的成果接收 DOCX/PDF 模板，`pnpm backup:create -- --output <绝对目录>` 对私有证据使用 AES-256-GCM 加密，`pnpm project:status` 根据实际文件、gate receipt 和外部输入输出状态。

候选 report-data 不手工拼接，使用已验证 source 分析、review-freeze 和两份模型材料生成（命令会剥离所有 final 身份字段，并以临时文件 + 重命名方式幂等写入）：

```text
pnpm analysis:candidate -- --source-report-data <绝对json> --source-export <绝对目录> --review-freeze <绝对文件或目录> --model-decision <绝对文件> --model-observations <绝对文件> --created-from-commit <完整commit SHA> --output <绝对json> [--report-localization-draft <绝对文件>]
```

R4 通过后，成果命令必须按同一份正式 `report-data-v1` 和同一个 final export 运行；不能把候选文件改名冒充最终成果。构建器会先在临时目录生成研究型和应用型两份 Markdown/DOCX，再通过原子改名写入 final 目录；目标目录已有不同字节时拒绝覆盖：

```text
pnpm deliverables:build -- --export-id <final-export-id> --report-data <绝对report-data.json> --output-root <绝对成果目录> --evidence-root <绝对私有证据根>
pnpm deliverables:render -- --input-dir <绝对成果目录/final> --output-dir <绝对成果目录/final> --qa-log <绝对路径/document-render-qa.json>
pnpm deliverables:verify -- --final-export-path <绝对最终导出目录> --expected-manifest-sha256 <manifest-sha256> --report-data <绝对report-data.json> --reports-root <绝对成果目录/final> --gate-evidence-path <绝对私有gates目录> --expected-r4-evidence-bundle-sha256 <r4-sha256> --expected-full-gate-bundle-sha256 <full-sha256> --publication-db <绝对SQLite文件>
```

`deliverables:render` 对 Markdown 使用同一份报告数据生成打印 HTML，再用固定 Playwright 版本生成正式 PDF，并把正式 PDF 的 SHA-256 写回报告 manifest；DOCX 则单独转到 `.qa-render/` 生成 QA PDF 和逐页 PNG，不把 DOCX 转换结果冒充正式 PDF。缺少 LibreOffice 或 Poppler 时命令必须失败；生成成功也只代表结构化渲染完成，`document-render-qa.json` 会保持 `visualReviewStatus=WAITING_HUMAN_REVIEW`，逐页空页、乱码、溢出、阅读顺序和 PDF/UA 不能由 AI 自动声称通过。

正式研究样本、人工 verdict、R1–R5 receipt、生产服务器和域名不会由 AI 伪造。当前真实状态见 [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) 和 [EXTERNAL_INPUTS.md](EXTERNAL_INPUTS.md)。

## 容量边界

目标是 10–20 个网站、约 100–300 个成功页面及其 axe 结果。SQLite 提供该规模的事务、外键、WAL、lease/CAS、manifest/hash 和备份恢复保证；不承诺一千亿行。
