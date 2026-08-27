# AccessCheck Lishui

AccessCheck 是一个本地网页无障碍扫描工具：校验 URL 后发现同站页面，使用 Playwright/axe 扫描，将结果写入 SQLite，并提供问题、评分和报告。评分用于筛查和比较，不等同于人工审计或合规认证。

## 前置环境

- Node.js `24.19.0`、pnpm `11.19.0`、Python `3.12.13`。
- 复制 `.env.example` 为 `.env.local`，将 `SESSION_SECRET` 换成至少 32 个随机字符。它是 AI Provider API Key 的稳定加密密钥；生产环境不得使用示例默认值，也不要把密钥提交到 Git。
- 生产扫描还需要显式配置 `EGRESS_PROXY_URL`；本地开发可留空。公网部署、域名、TLS 和代理属于部署者负责的外部配置。

## 本地启动

```text
pnpm install
pnpm db:migrate
pnpm dev
```

需要执行扫描时，另开终端运行 `pnpm worker`。需要 AI 解析时，再运行 `pnpm ai:worker`。也可以直接运行：

```text
pnpm scan:site -- https://example.org --max-pages 10
```

扫描结果和报告数据默认写入 `.env.local` 指定的目录；不要将私有证据目录或数据库提交到 Git。

## 常用命令

- `pnpm lint`、`pnpm typecheck`：检查代码和类型。
- `pnpm test`：运行单元及集成测试；`pnpm test:e2e`：运行浏览器流程。
- `pnpm test:all`：按顺序运行 lint、typecheck、test、build 和 test:e2e。
- `pnpm db:check`：检查数据库结构；`pnpm db:reset:test`：重置测试数据库。
- `pnpm scan:page`、`pnpm scan:site`：运行单页或站点扫描。
- `pnpm score:recalculate`：重新计算已有扫描的评分。
- 发布扫描后可从报告页下载 HTML、PDF 和完整 JSON 报告。
- `pnpm backup:create`、`pnpm backup:restore`：备份或恢复本地数据。

浏览器中的 AI provider 配置入口为 `/settings/ai`。

## 数据与安全边界

Worker 只处理队列中的扫描任务并写入结果；生产 Worker 必须通过显式 egress proxy 出站，不能绕过代理访问公网。私网、环回地址、凭据 URL 和未授权目标会被拒绝。生产环境必须使用随机 `SESSION_SECRET`、独立数据目录和受控网络配置。

## 容量提示

本地 SQLite 适合约 10–20 个网站、约 100–300 个成功页面及其 axe 结果。更大规模或正式部署需要另行设计存储、网络和运维方案。
