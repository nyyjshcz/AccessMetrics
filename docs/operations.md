# 运维说明

> **谁需要读：部署和本地运行负责人。是否必读：需要启动、排障或部署时必读。** 读完你会知道怎样启动、停止、检查队列和备份数据。

## 本地启动

首次准备：

1. 安装 Node.js 24.19.0 与 pnpm 11.19.0。
2. 将 .env.example 复制为 .env.local。
3. 设置不同且足够长的 SESSION_SECRET、ADMIN_ACCESS_KEY、VISITOR_ACCESS_KEY。
4. 运行 pnpm install，再运行 pnpm db:migrate。

日常启动：

    pnpm dev

该命令会同时启动：

- Web：默认提供本地页面；
- 扫描 Worker：消费 queued scan job；
- AI Worker：消费 queued AI batch。

按 Ctrl+C 会一起停止这三个进程。若只需要检查前端且不希望继续消费已有队列，应单独启动 Web，而不要使用完整启动命令。

## 启动前检查

完整启动会自动继续数据库中尚未结束的扫描和 AI 批次。演示前建议：

1. 在“活动任务”确认没有 queued 或 running 扫描；
2. 在每个扫描的 AI 辅助复核区确认没有 queued、running 或等待重试的批次；
3. 对不再需要的未发布终态任务，可从活动任务删除；
4. 对不想继续的 AI 批次，先在结果页暂停。

这能避免本地模型或远程 API 在不知情时继续接收请求。

## 角色与密钥

| 密钥 | 放在哪里 | 用途 |
| --- | --- | --- |
| SESSION_SECRET | 仅服务器环境变量或 secret 文件 | 会话 Cookie 签名与 AI Provider Key 加密。 |
| ADMIN_ACCESS_KEY | 仅交给管理员 | 登录后可以管理扫描和 AI。 |
| VISITOR_ACCESS_KEY | 只交给报告读者 | 登录后只能查看已发布报告。 |

不要把 .env.local、.env.production、.secrets 或数据库提交到 Git。

## 常用检查命令

| 目的 | 命令 |
| --- | --- |
| 静态检查 | pnpm lint |
| 类型检查 | pnpm typecheck |
| 单元与集成测试 | pnpm test |
| 浏览器流程 | pnpm test:e2e |
| 全量验证 | pnpm test:all |
| 数据库结构检查 | pnpm db:check |
| 创建备份 | pnpm backup:create |
| 恢复备份 | pnpm backup:restore |
| 静态检查部署文件 | pnpm ops:check |
| 生产部署前检查 | pnpm deploy:check |

## AI 模型服务

管理员在 AI 设置页保存 OpenAI-compatible 服务的 Base URL、模型名称、并发上限和可选 RPM 策略。API Key 只保存在服务器端，页面只会显示 Key 指纹。

- 本地 LM Studio 这类一次只能稳定处理一个任务的服务，应将最大并发设为 1。
- OpenRouter 免费模型可选择 20 请求/分钟策略；这个策略只影响新建批次。
- 429 响应有 Retry-After 时，Worker 按服务端时间等待；没有时才按 60 秒自动重试。
- 非限流的临时请求错误不会被误写成一分钟限流等待。

## 备份与恢复

运行结果、私有证据和导出目录由环境变量指定。备份和恢复应先停止所有会写入 SQLite 的服务，以避免复制到正在写入的数据库。`pnpm backup:create` 会备份 SQLite，并在提供 `PRIVATE_BACKUP_KEY` 或 `PRIVATE_BACKUP_KEY_FILE` 时加密备份私有证据，但不包含 `.secrets`。完整生产备份还必须单独、受保护地保存 `.secrets`，尤其要保留原 `session_secret`。

恢复时先停止 Web、扫描 Worker 和 AI Worker，再恢复 `data/` 与私有输入目录，按生产要求修复目录权限；恢复 `.secrets` 时必须使用原 `session_secret`。随后运行 `pnpm db:check`，启动服务，再访问 health endpoint 并检查已发布报告。项目自带的 `pnpm backup:restore <backup-dir> <target-dir>` 只恢复脚本备份中的数据库和加密私有证据，不恢复 `.secrets`，不能替代整套生产目录恢复。

## 生产部署

生产部署使用 compose.prod.yaml。它包含 Web、扫描 Worker、AI Worker、Caddy 和受控 egress proxy。生产扫描 Worker 的 `EGRESS_PROXY_URL` 由 Compose 固定注入，Web 不依赖该变量。部署前必须准备：

- 可用域名与 HTTPS；
- 生产 .env.production；
- 三个独立 secret 文件；
- 已固定 digest 的 egress proxy 镜像；
- Linux 数据目录、导出目录与正确权限。

详见 [部署说明](./ops/deployment.md)。生产扫描 Worker 不可绕过 egress proxy 直接访问公网。生产 Compose 没有统一迁移服务：两个 Worker 启动时会迁移，Web 的 health 或其他相关请求也会迁移；如需在启动前人工核实，可在主机有 Node/pnpm 时运行 `pnpm db:migrate`。Docker-only 运行不要求主机 Node/pnpm，可直接运行部署说明中的 `docker compose ... config --quiet`、`up -d --build`、`ps` 和日志检查。
