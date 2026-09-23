# 飞牛 NAS 部署与 Tailscale 访问

[English](./nas-tailscale.en.md)

> **谁需要读：负责把项目部署到飞牛 NAS 的人。是否必读：部署和迁移时必读。** 其他成员不需要阅读本页。

这是一份 NAS 专用说明。它不替代 VPS 的[部署说明](./deployment.md)。NAS 版使用 `compose.nas.yaml`：Web、扫描 Worker 和 AI Worker 共用同一份 SQLite 数据；Caddy 只在 NAS 本机的 `127.0.0.1:3000` 提供 HTTP，公网 HTTPS 由 Tailscale Funnel 提供。

> NAS 现在只允许“本机构建并验证 → 导出镜像 → NAS `docker load` → Compose 启动”的流程。请先阅读[预构建镜像部署说明](./nas-prebuilt-deployment.md)；本页不再使用 NAS 上的源码构建流程。

## 部署前检查

- 确认飞牛已启用 Docker、Docker Compose、SSH（默认 22 端口）和 Tailscale。
- 确认 NAS 有足够磁盘保存数据库、私有证据、报告导出和 Docker 镜像。
- 确认 Tailscale 已登录 NAS，并已启用 MagicDNS、HTTPS 证书和 Funnel 权限。
- 真实 `.env.nas`、`.secrets/`、`data/` 和 `private-inputs/` 都不能提交 Git；任何招生访问码也绝不能写入日志。

## 通过 SSH 部署

登录 NAS 后，将仓库固定到要运行的提交：

```sh
git clone <YOUR_REPOSITORY_URL> accesscheck
cd accesscheck
mkdir -p .secrets private-inputs data data/exports
```

复制 `.env.nas.example` 为 `.env.nas`，只填写 Tailscale Funnel 的 HTTPS 地址：

```text
APP_BASE_URL=https://nas-name.tailnet-name.ts.net
```

迁移当前数据前，先停止本机 Web、扫描 Worker 和 AI Worker，并用项目备份流程得到一致副本。迁移 `data/`、`private-inputs/`、`data/exports/` 和既有的三个 secret 文件；首次启用此版本时另建 `.secrets/admissions_access_key`，留空即禁用。`session_secret` 必须保留原值，否则已保存的远程 AI Provider Key 无法解密。不迁移指向 `127.0.0.1:1234` 的 LM Studio 等本机 AI Provider；远程 Provider 可保留。

不要把密钥写进 Compose、`.env.nas`、Shell 历史或 Git。NAS 使用非 Swarm Compose 时，Compose 的 `uid`、`gid`、`mode` 字段不会改变 secret bind mount 的权限；因此必须直接设置宿主机文件的数字组和权限。让 secret 文件归 root 所有、属于共享读取组 10000，并设为 0440：

```sh
chown 10001:10001 private-inputs
chmod 700 private-inputs
chown -R 10001:10000 data
find data -type d -exec chmod 2770 {} +
find data -type f -exec chmod 0660 {} +
# 首次部署时创建可选招生访问码文件；已有启用的文件不会被覆盖。
test -e .secrets/admissions_access_key || : > .secrets/admissions_access_key
chown root:10000 .secrets/*
chmod 0440 .secrets/*
docker compose --env-file .env.nas -f compose.nas.yaml config --quiet
```

三个既有 secret 分别供 Web 读取访问控制和会话密钥，AI Worker 只读取会话密钥；可选的 `admissions_access_key` 只挂载给 Web。Compose 会把它们以只读文件挂载到 `/run/secrets/`；应用容器仍以非 root 用户运行，依靠组 10000 读取。`deploy:nas:check` 会只检查文件类型、权限、组和招生码格式，不会输出密钥内容。

## 可选招生访问码

`.secrets/admissions_access_key` 是共享的完整管理员访问码：留空表示禁用；非空时必须恰好是 `0-9A-HJKMNP-TV-Z` 中的四个字符。用它成功登录会得到完整管理员权限，每次登录的会话有效七天。只通过受信任的密码管理器或 `sudoedit .secrets/admissions_access_key` 写入或更换它，绝不能把实际访问码放进 Git、Compose、`.env.nas`、Shell 历史或日志。

要立即撤销这一共享访问，可将这个已忽略的文件清空，或安全地替换为新码，然后只重建 Web：

```sh
sudo truncate -s 0 .secrets/admissions_access_key
sudo chown root:10000 .secrets/admissions_access_key
sudo chmod 0440 .secrets/admissions_access_key
sudo docker compose --env-file .env.nas -f compose.nas.yaml up -d --no-build --pull never --force-recreate web
```

替换时使用同一条只重建 Web 的命令。新 Web 进程读取新文件后，旧招生访问码签发的会话会立即失效；不要重建 Worker、AI Worker 或 Caddy。

启动并检查（不允许在 NAS 上构建）：

```sh
docker compose --env-file .env.nas -f compose.nas.yaml up -d --no-build --pull never
docker compose --env-file .env.nas -f compose.nas.yaml ps
docker compose --env-file .env.nas -f compose.nas.yaml logs --tail=100 web worker ai-worker caddy
```

Web、Worker 和 AI Worker 必须继续使用同一份 `data/`；不要把 `private-inputs/` 放进静态 Web 目录。

## 配置 Tailscale Funnel

确认 Tailscale 状态，再把 Funnel 指向 Caddy 的本地端口：

```sh
TAILSCALE=/vol1/@appcenter/tailscale/bin/tailscale
TS_SOCKET=/vol1/@appdata/tailscale/tailscaled.sock
$TAILSCALE --socket=$TS_SOCKET status
$TAILSCALE --socket=$TS_SOCKET funnel --bg http://127.0.0.1:3000
$TAILSCALE --socket=$TS_SOCKET funnel status
```

以 `tailscale funnel status` 显示的 HTTPS 地址为准，确保它和 `.env.nas` 中的 `APP_BASE_URL` 完全一致。不要把 Docker 的 3000 端口绑定到 `0.0.0.0`。

## 验收与回滚

确认所有容器运行，访问 `/api/health`，分别用管理员和访客密钥检查权限，再下载 HTML、PDF、JSON 报告并做一次已授权的单页扫描。更新前停止三个业务服务，备份 `data/`、`private-inputs/` 和 `.secrets/`。若检查失败，先执行 `$TAILSCALE --socket=$TS_SOCKET funnel reset`，停止 Compose，从部署前快照恢复上述目录和原 Git 提交；本机原数据不删除。
