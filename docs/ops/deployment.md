# 单 VPS 自托管部署

> **谁需要读：负责上线的人。是否必读：部署时必读，其他人不用读。** 读完你会知道生产环境需要哪些配置、服务和检查。

这份说明适用于一台 Linux VPS 上的单实例部署。该项目使用 SQLite 和共享卷，Web、扫描 Worker 与 AI Worker 必须运行在同一台机器、访问同一份数据目录；不要把它部署到无持久磁盘的 Serverless 平台。

如果目标是飞牛 NAS，并通过 Tailscale 提供 HTTPS 访问，请改读[飞牛 NAS 与 Tailscale 部署说明](./nas-tailscale.md)。

## 先准备什么

- 一台受你控制的 Linux VPS，建议 Ubuntu 24.04 LTS，至少 2 vCPU、4 GB 内存和 30 GB 可用磁盘；使用本地大模型时，模型服务仍应在你可访问的受控网络中。
- 一个域名及其 A/AAAA 记录，指向该 VPS 的公网 IP。Caddy 会自动申请和续期 HTTPS 证书，所以域名解析和 80/443 入站端口必须先就绪。
- Docker Engine 与 Docker Compose plugin；主机防火墙只开放 SSH、80、443。
- Node 24 与 Corepack（仅当要在主机执行完整的 `pnpm` 安装和部署检查时需要；Docker-only 运行不需要主机 Node/pnpm）。
- 对目标网站的检查授权，以及经过审核、固定 digest 的出站代理镜像。扫描 Worker 不可直连公网；它只通过该代理访问目标站点。

## 第一次部署

在服务器上克隆仓库并切换到要发布的 commit。不要把真实密钥写进 Git 或 .env.production。

```sh
git clone <YOUR_REPOSITORY_URL> accesscheck
cd accesscheck
mkdir -p .secrets private-inputs data data/exports
# Private evidence is only mounted into the Web container (UID 10001).
sudo chown 10001:10001 private-inputs
sudo chmod 700 private-inputs
# Web and both Workers share SQLite. They retain different UIDs but share GID
# 10000, so WAL/journal files created by one process stay writable by the others.
sudo chown -R 10001:10000 data
sudo find data -type d -exec chmod 2770 {} +
sudo find data -type f -exec chmod 660 {} +
chmod 700 .secrets
openssl rand -base64 48 > .secrets/session_secret
openssl rand -base64 32 > .secrets/admin_access_key
openssl rand -base64 32 > .secrets/visitor_access_key
chmod 600 .secrets/*
```

管理员与访客密钥必须不同。把它们保存在密码管理器中：管理员能创建扫描、管理 AI 和发布报告；访客只能查看已发布报告。生产 Compose 会以共享 GID 和 `umask 0002` 运行三个写入 SQLite 的进程；不要把 `data/` 改回 `0700`，否则 Worker 无法写入同一个数据库。`private-inputs/` 则必须保持 `0700`，因为它只提供给 Web。

创建服务器本地的 .env.production（不要提交）：

```text
APP_BASE_URL=https://reports.example.com
CADDY_SITE=reports.example.com
EGRESS_PROXY_IMAGE=registry.example.com/approved-egress-proxy@sha256:<immutable-digest>
```

其中 APP_BASE_URL 必须与浏览器实际访问的 HTTPS origin 完全一致。`EGRESS_PROXY_IMAGE` 必须是经安全审核的不可变镜像 digest；生产扫描 Worker 使用的 `EGRESS_PROXY_URL` 由 `compose.prod.yaml` 固定为 `http://egress-proxy:8080`，不需要写入 `.env.production`，Web 不依赖该变量。不要把任意开放代理、宿主机代理或本地开发代理当成生产替代品。

如果主机安装了 Node 24、Corepack 和 pnpm，可执行完整的仓库检查：

```sh
pnpm install --frozen-lockfile
pnpm ops:check
pnpm deploy:check
```

Docker-only 部署不需要主机 Node/pnpm。启动前至少运行 Compose 配置检查；它会校验生产环境变量与 Compose 展开结果：

```sh
docker compose --env-file .env.production -f compose.prod.yaml config --quiet
```

生产 Compose 没有统一迁移服务。扫描 Worker 和 AI Worker 启动时会执行迁移，Web 的 health 或相关 API 请求也会执行迁移。若主机安装了 Node/pnpm，可在启动前另外运行已存在的手工命令 `pnpm db:migrate`；Docker-only 部署不应假定主机可以执行该命令。

启动：

```sh
docker compose --env-file .env.production -f compose.prod.yaml up -d --build
docker compose --env-file .env.production -f compose.prod.yaml ps
docker compose --env-file .env.production -f compose.prod.yaml logs --tail=100 web worker ai-worker caddy
```

首次验证：

1. 在浏览器打开 https://reports.example.com/login。
2. 输入管理员密钥，创建一个小型公开站点扫描，确认 worker 会领取任务。
3. 发布该扫描后退出，再用访客密钥登录；访客应只能看到“已发布报告”，访问 /scans 或 /settings/ai 会回到 /reports。
4. 确认 PDF、HTML、JSON 报告下载都需要已登录的管理员或访客会话。

## 日常运行与更新

```sh
docker compose --env-file .env.production -f compose.prod.yaml ps
docker compose --env-file .env.production -f compose.prod.yaml logs -f ai-worker
git pull --ff-only
docker compose --env-file .env.production -f compose.prod.yaml up -d --build
```

更换管理员或访客密钥后，更新对应 .secrets 文件并重新创建 Web 容器。对应角色的旧会话会自动失效：

```sh
chmod 600 .secrets/admin_access_key .secrets/visitor_access_key
docker compose --env-file .env.production -f compose.prod.yaml up -d --force-recreate web
```

## 备份与恢复

停止写入前备份 `data/`、`private-inputs/` 和 `.secrets/`；三者都不能以明文普通归档长期留存。`data/` 与 `private-inputs/` 必须直接交给主机/备份系统的加密备份流程，`.secrets/` 则单独通过受保护的密钥系统或加密存储保存，并保留原 `session_secret`。SQLite 数据、私有证据和已保存的 AI Provider Key 互有关联，不能只备份其中之一。`pnpm backup:create` 不包含 `.secrets`；它在提供 `PRIVATE_BACKUP_KEY` 或 `PRIVATE_BACKUP_KEY_FILE` 时才会加密收集私有证据。

```sh
docker compose --env-file .env.production -f compose.prod.yaml stop web worker ai-worker
# 使用主机/备份系统的加密流程备份 data/ 和 private-inputs/；不要生成明文普通归档
# 将 .secrets/ 单独保存到受保护的密钥系统或加密存储
docker compose --env-file .env.production -f compose.prod.yaml start web worker ai-worker
```

恢复时先停止同一组服务，再从主机或备份系统的加密存储中恢复 `data/` 和 `private-inputs/` 到部署目录。不要把解密后的内容重新保存成普通明文归档：

```sh
docker compose --env-file .env.production -f compose.prod.yaml stop web worker ai-worker
# 使用你所在主机/备份系统的加密恢复流程，将 data/ 和 private-inputs/ 恢复到本部署目录
```

按首次部署步骤修复 `data/` 的共享 GID/权限及 `private-inputs/` 的 0700 权限，然后从受保护的密钥存储恢复 `.secrets/`。必须使用相同的 `session_secret`；如果丢失，已保存的 AI Provider Key 无法解密。若使用项目脚本创建的备份，主机有 Node/pnpm 时也可运行 `pnpm backup:restore <备份绝对目录> <目标绝对目录>`；该命令仍不恢复 `.secrets/`。

恢复 `.secrets/` 后重新启动服务，再按顺序检查服务状态、健康端点和日志：

```sh
docker compose --env-file .env.production -f compose.prod.yaml up -d
docker compose --env-file .env.production -f compose.prod.yaml ps
docker compose --env-file .env.production -f compose.prod.yaml logs --tail=100 web worker ai-worker
```

在浏览器打开 `https://reports.example.com/api/health`，确认返回就绪状态。主机有 Node/pnpm 时，随后运行 `pnpm db:check`；Docker-only 部署不要求主机 Node/pnpm，以健康端点和上述容器日志作为结构与进程验证。最后按首次验证步骤检查管理员/访客登录、已发布报告和报告下载。

## 运行边界

- 生产配置中 Caddy 是唯一公开暴露的服务；Web 只在内部 app 网络监听。
- 扫描 Worker 在隔离网络中运行，强制使用 EGRESS_PROXY_URL；不要删除该设置。
- 当前 SQLite 目标规模约为 10 到 20 个网站、100 到 300 个成功页面及其 axe 结果。规模扩大前应重新设计存储与运维，而不是把同一 SQLite 文件跨多台机器挂载。
