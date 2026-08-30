# AccessCheck Lishui

AccessCheck 是一个可自托管的网页无障碍扫描工具：校验 URL 后发现同站页面，使用 Playwright/axe 扫描，将结果写入 SQLite，并提供问题、评分和报告。管理员使用访问密钥管理扫描、AI 和发布；访客密钥只能查看已发布报告。评分用于筛查和比较，不等同于人工审计或合规认证。

## 前置环境

- Node.js `24.19.0`、pnpm `11.19.0`、Python `3.12.13`。
- 复制 `.env.example` 为 `.env.local`，将 `SESSION_SECRET` 换成至少 32 个随机字符。它同时用于 AI Provider API Key 加密和访问会话签名；不要把它提交到 Git。
- 在 `.env.local` 设置不同的 `ADMIN_ACCESS_KEY` 和 `VISITOR_ACCESS_KEY`（均至少 16 个字符）。管理员可扫描、处理、发布和配置 AI；访客仅可读取已发布报告。
- 生产扫描需要显式配置受控 `EGRESS_PROXY_URL`。完整的单 VPS 部署步骤见 [部署说明](docs/ops/deployment.md)。

## 本地启动

```text
pnpm install
pnpm db:migrate
pnpm dev
```

`pnpm dev` 会一起启动 Web、扫描 Worker 和 AI Worker，点击扫描或 AI 处理后会自动消费队列；按 Ctrl+C 会一并停止它们。启动后先在登录页输入管理员或访客访问密钥。需要单独调试某个进程时，仍可另开终端运行 `pnpm worker` 或 `pnpm ai:worker`。也可以直接运行：

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

Worker 只处理队列中的扫描任务并写入结果；生产 Worker 必须通过显式 egress proxy 出站，不能绕过代理访问公网。私网、环回地址、凭据 URL 和未授权目标会被拒绝。生产环境必须使用随机 `SESSION_SECRET`、不同的管理员/访客访问密钥、独立数据目录和受控网络配置。

## 容量提示

本地 SQLite 适合约 10–20 个网站、约 100–300 个成功页面及其 axe 结果。更大规模或正式部署需要另行设计存储、网络和运维方案。
