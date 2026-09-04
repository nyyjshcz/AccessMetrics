# AccessCheck Lishui

AccessCheck 是一个可自托管的网页无障碍扫描工具。它从一个网址发现同站页面，用真实浏览器和 axe 扫描，把结果写入 SQLite，再生成问题、评分和报告。管理员使用访问密钥管理扫描、AI 和发布；访客密钥只能查看已发布报告。评分用于筛查和比较，不等同于人工审计或合规认证。

## 先从这里开始

第一次了解项目时，只读 [文档地图](docs/README.md) 里的角色路径。所有人先读 [项目说明](docs/项目说明.md)，之后按自己的工作选择一条路径，不需要通读整个 `docs/` 目录。

## 目录地图

| 目录 | 用途 |
| --- | --- |
| `src/`、`public/`、`scripts/`、`migrations/` | 正在运行的网站、后台任务和数据库升级脚本。 |
| `tests/`、`tools/` | 自动化测试与受控扫描工具。 |
| `docs/` | 当前项目说明、架构、评分、数学、运维和部署资料。 |
| `analysis/`、`scoring/`、`research/`、`study/`、`notebooks/` | 数学与研究辅助材料，不是网页运行目录。 |
| `configs/`、`contracts/` | 规则目录、配置和数据格式约定。 |
| `data/`、`private-inputs/` | 本机数据库、私有证据和报告；不提交到 Git，也不要随意清理。 |

## 前置环境

- Node.js `24.19.0`、pnpm `11.19.0`、Python `3.12.13`。
- 复制 `.env.example` 为 `.env.local`，将 `SESSION_SECRET` 换成至少 32 个随机字符。它同时用于 AI Provider API Key 加密和访问会话签名；不要把它提交到 Git。
- 在 `.env.local` 设置不同的 `ADMIN_ACCESS_KEY` 和 `VISITOR_ACCESS_KEY`（均至少 16 个字符）。管理员可扫描、处理、发布和配置 AI；访客仅可读取已发布报告。
- 生产扫描 Worker 的受控 `EGRESS_PROXY_URL` 由 `compose.prod.yaml` 固定注入；部署者不需要在 `.env.production` 中填写它。完整的单 VPS 部署步骤见 [部署说明](docs/ops/deployment.md)。

## 本地启动

```text
pnpm install
pnpm db:migrate
pnpm dev
```

`pnpm db:migrate` 会创建或升级本地 SQLite 数据库结构。`pnpm dev` 会一起启动 Web、扫描 Worker 和 AI Worker。

- **Web 和数据库**：访问 `http://localhost:3000/api/health` 返回 `status: ok`。
- **扫描 Worker**：两个 Worker 启动后会持续运行并轮询队列；提交一次扫描后，看到扫描任务从 queued 进入 running 或完成，并看到扫描 Worker 的 `scan job started` 日志。终端没有 `worker crashed` 或进程退出，表示进程已就绪。
- **AI Worker**：提交 AI 复核批次后，看到批次从 queued 进入 running 或完成。终端没有 `worker crashed` 或进程退出，表示进程已就绪。

扫描 Worker 处理扫描队列，AI Worker 处理 AI 复核队列。默认访问地址是 `http://localhost:3000`，端口由 `APP_BASE_URL` 控制，未另行设置时为 `3000`。按 Ctrl+C 会一并停止三个进程。启动异常或需要排障时，请转读 [运维说明](docs/operations.md)，不要打印或粘贴任何密钥。启动后先在登录页输入管理员或访客访问密钥。需要单独调试某个进程时，仍可另开终端运行 `pnpm worker` 或 `pnpm ai:worker`。`pnpm scan:site` 用于从给定网址发现并扫描同站页面，结果写入数据库；例如：

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

扫描 Worker 只处理队列中的扫描任务并写入结果，AI Worker 只处理 AI 复核队列并写入辅助结论；两者都不会把密钥发送给浏览器。生产 Worker 必须通过显式 egress proxy 出站，不能绕过代理访问公网。私网、环回地址、凭据 URL 和未授权目标会被拒绝。生产环境必须使用随机 `SESSION_SECRET`、不同的管理员/访客访问密钥、独立数据目录和受控网络配置。完整边界见 [安全边界](docs/安全边界.md)。

## 容量提示

本地 SQLite 适合约 10 到 20 个网站、约 100 到 300 个成功页面及其 axe 结果。更大规模或正式部署需要另行设计存储、网络和运维方案。
