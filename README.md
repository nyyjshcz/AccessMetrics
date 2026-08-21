# AccessCheck Lishui

这是一个可追溯的网页无障碍自动扫描与研究资料生成系统：URL 安全校验 → 同站页面发现 → Playwright/axe 扫描 → WCAG 目录解析 → 四原则评分 → SQLite 记录 → HTML/PDF/CSV/JSON 导出 → 研究抽样、人工复核和发布门。

## 本地启动

1. 使用计划锁定的 Node 24.19.0、pnpm 11.19.0、Python 3.12.13。依赖预检会实际执行 `PYTHON_BIN`（未设置时使用系统 `python`/`python3`）读取版本，不接受只设置版本字符串的方式。
2. 复制 `.env.example` 为 `.env.local`，再运行 `pnpm install`、`pnpm db:migrate`。
3. 运行 `pnpm dev` 打开管理页面；另开终端运行 `pnpm worker`。
4. 使用 `pnpm scan:site -- https://example.org --max-pages 10` 进行一次受控页面发现；完整任务则提交管理端后由 `pnpm worker` 执行。

本地 Compose 使用 `node standalone/server.js` 启动 Next standalone 服务器；生产 Compose 需要提供真实 `CADDY_SITE`、密钥文件和固定 egress/渲染器镜像 digest，不能把示例值直接用于公网。生产 Worker 和 crawler/scanner 使用同一个显式 `EGRESS_PROXY_URL`，Chromium 禁用 QUIC、后台网络和代理 bypass；缺少代理时生产 Worker 会拒绝启动。

管理端使用 `SCAN_ADMIN_TOKEN`；两类 reviewer 分别使用 `COMPUTER_REVIEW_TOKEN` 和 `MATH_REVIEW_TOKEN`。这些值必须由真人通过外部密钥配置提供，不能写入 Git。

## 质量门

`pnpm test:all` 覆盖依赖负面 fixture、lint、格式、类型、数据库、egress DestinationPolicy、契约、发布卫生、Vitest、Python 参考实现和生产构建；`pnpm test:e2e` 覆盖浏览器冒烟。`pnpm report:generate` 从冻结 `report-data.json` 生成候选 Markdown/DOCX（final 模式必须有 R4 marker），`pnpm deliverables:templates` 生成带条件式水印的成果接收 DOCX/PDF 模板，`pnpm backup:create -- --output <绝对目录>` 对私有证据使用 AES-256-GCM 加密，`pnpm project:status` 根据实际文件、gate receipt 和外部输入输出状态。

正式研究样本、人工 verdict、R1–R5 receipt、生产服务器和域名不会由 AI 伪造。当前真实状态见 [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) 和 [EXTERNAL_INPUTS.md](EXTERNAL_INPUTS.md)。

## 容量边界

目标是 10–20 个网站、约 100–300 个成功页面及其 axe 结果。SQLite 提供该规模的事务、外键、WAL、lease/CAS、manifest/hash 和备份恢复保证；不承诺一千亿行。
