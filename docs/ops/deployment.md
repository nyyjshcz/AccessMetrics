# 单 VPS 自托管部署

这份说明适用于一台 Linux VPS 上的单实例部署。该项目使用 SQLite 和共享卷，Web、扫描 Worker 与 AI Worker 必须运行在同一台机器、访问同一份数据目录；不要把它部署到无持久磁盘的 Serverless 平台。

## 先准备什么

- 一台受你控制的 Linux VPS，建议 Ubuntu 24.04 LTS，至少 2 vCPU、4 GB 内存和 30 GB 可用磁盘；使用本地大模型时，模型服务仍应在你可访问的受控网络中。
- 一个域名及其 A/AAAA 记录，指向该 VPS 的公网 IP。Caddy 会自动申请和续期 HTTPS 证书，所以域名解析和 80/443 入站端口必须先就绪。
- Docker Engine 与 Docker Compose plugin；主机防火墙只开放 SSH、80、443。
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

其中 APP_BASE_URL 必须与浏览器实际访问的 HTTPS origin 完全一致。EGRESS_PROXY_IMAGE 必须是经安全审核的不可变镜像 digest；不要把任意开放代理、宿主机代理或本地开发代理当成生产替代品。

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

停止写入前备份 data、private-inputs 和 .secrets（.secrets 应单独加密保存）。SQLite 数据库、节点证据和 AI Provider 加密数据互有关联，不能只备份其中之一。

```sh
docker compose --env-file .env.production -f compose.prod.yaml stop web worker ai-worker
tar -czf accesscheck-backup-$(date +%F).tgz data private-inputs .secrets
docker compose --env-file .env.production -f compose.prod.yaml start web worker ai-worker
```

恢复时先停止同一组服务，再恢复这三处目录并使用相同的 session_secret；如果 session_secret 丢失，已保存的 AI Provider Key 无法解密。

## 运行边界

- 生产配置中 Caddy 是唯一公开暴露的服务；Web 只在内部 app 网络监听。
- 扫描 Worker 在隔离网络中运行，强制使用 EGRESS_PROXY_URL；不要删除该设置。
- 当前 SQLite 目标规模约为 10–20 个网站、100–300 个成功页面及其 axe 结果。规模扩大前应重新设计存储与运维，而不是把同一 SQLite 文件跨多台机器挂载。
