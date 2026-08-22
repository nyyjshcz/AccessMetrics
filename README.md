# AccessCheck Lishui

这是一个可追溯的网页无障碍自动扫描与研究资料生成系统：URL 安全校验 → 同站页面发现 → Playwright/axe 扫描 → WCAG 目录解析 → 四原则评分 → SQLite 记录 → HTML/PDF/CSV/JSON 导出 → 研究抽样、人工复核和发布门。

## 本地启动

1. 使用计划锁定的 Node 24.19.0、pnpm 11.19.0、Python 3.12.13。依赖预检会实际执行 `PYTHON_BIN`（未设置时使用系统 `python`/`python3`）读取版本，不接受只设置版本字符串的方式。
2. 复制 `.env.example` 为 `.env.local`，再运行 `pnpm install`、`pnpm db:migrate`。
3. 运行 `pnpm dev` 打开管理页面；另开终端运行 `pnpm worker`。
4. 使用 `pnpm scan:site -- https://example.org --max-pages 10` 进行一次受控页面发现；完整任务则提交管理端后由 `pnpm worker` 执行。

本地 Compose 使用 `node standalone/server.js` 启动 Next standalone 服务器；生产 Compose 需要提供真实 `CADDY_SITE`、密钥文件和固定 egress/渲染器镜像 digest，不能把示例值直接用于公网。生产 Worker 和 crawler/scanner 使用同一个显式 `EGRESS_PROXY_URL`，Chromium 禁用 QUIC、后台网络和代理 bypass；缺少代理时生产 Worker 会拒绝启动。

管理端使用 `SCAN_ADMIN_TOKEN`；两类 reviewer 分别使用 `COMPUTER_REVIEW_TOKEN` 和 `MATH_REVIEW_TOKEN`。这些值必须由真人通过外部密钥配置提供，不能写入 Git。

## 运行与数据边界

数据库启动时执行幂等迁移（当前为 1–24），Worker 使用 lease/heartbeat 领取任务；重启会恢复可恢复任务，取消和失败会保留状态事实。正式导出、逐节点结果、人工审核、R1–R5 证据和密钥都放在 Git 外的只读/私有目录，`backup:create` 与 `backup:restore` 会校验数据库、加密私有证据和 manifest 的 hash。

R5 不能上传任意命令或客户端自报分数：服务端先校验 R1–R4 索引，再在私有根下建立绑定 `rcCommit` 的 clean clone，只执行固定 exercise catalog，并保存 tree/environment/index/catalog hash、stdout/stderr hash 和 revision。理解检查由服务端评分；handoff 和 finalize 需要对应 reviewer 二次认证。R5 artifact 使用不可覆盖的 revision 文件和 outbox 恢复机制。

正式成果验证必须同时提供外部 final export、report-data、两份最终报告、R1–R5 gate evidence 以及 R4/full bundle hash：

```text
pnpm deliverables:verify -- --final-export-path <绝对目录> --expected-manifest-sha256 <sha256> --report-data <绝对json> --reports-root <绝对目录> --gate-evidence-path <绝对gates目录> --expected-r4-evidence-bundle-sha256 <sha256> --expected-full-gate-bundle-sha256 <sha256> --publication-db <绝对SQLite文件>
```

缺少真人门、真实站点/许可、固定渲染器或生产部署输入时，命令必须失败并保持 `WAITING_EXTERNAL_INPUT`；不会用 fixture、模板或 AI 草稿替代正式数据。

## 质量门

`pnpm test:all` 覆盖依赖负面 fixture、lint、格式、类型、数据库、egress DestinationPolicy、契约、发布卫生、Vitest、Python 参考实现和生产构建；`pnpm test:e2e` 覆盖浏览器冒烟。`pnpm report:generate -- --mode candidate` 只接受 `report-data.candidate.json`，输出 `REVIEW CANDIDATE — NOT FINAL` 且不写 final export 身份；final 模式必须有 R4 marker。R4 候选包使用：

```text
pnpm deliverables:candidate -- --source-export <绝对目录> --review-freeze <绝对文件或目录> --candidate-files <绝对目录> --output-root <绝对目录> [--report-localization-draft <绝对文件>]
```

候选目录必须恰有 `report-data.candidate.json`、`model-decision-record.md`、`model-observations.md` 和两份候选报告；脚本会核对 source/review-freeze/localization/model/commit hash，排除 final 字段，按五个文件的字节和 SHA-256 生成可复用的 `candidateBundleId`，并原子写入只读 bundle。`pnpm deliverables:templates` 生成带条件式水印的成果接收 DOCX/PDF 模板，`pnpm backup:create -- --output <绝对目录>` 对私有证据使用 AES-256-GCM 加密，`pnpm project:status` 根据实际文件、gate receipt 和外部输入输出状态。

候选 report-data 不手工拼接，使用已验证 source 分析、review-freeze 和两份模型材料生成（命令会剥离所有 final 身份字段，并以临时文件 + 重命名方式幂等写入）：

```text
pnpm analysis:candidate -- --source-report-data <绝对json> --source-export <绝对目录> --review-freeze <绝对文件或目录> --model-decision <绝对文件> --model-observations <绝对文件> --created-from-commit <完整commit SHA> --output <绝对json> [--report-localization-draft <绝对文件>]
```

正式研究样本、人工 verdict、R1–R5 receipt、生产服务器和域名不会由 AI 伪造。当前真实状态见 [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) 和 [EXTERNAL_INPUTS.md](EXTERNAL_INPUTS.md)。

## 容量边界

目标是 10–20 个网站、约 100–300 个成功页面及其 axe 结果。SQLite 提供该规模的事务、外键、WAL、lease/CAS、manifest/hash 和备份恢复保证；不承诺一千亿行。
