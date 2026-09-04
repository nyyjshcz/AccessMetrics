# 飞牛 NAS 预构建镜像部署

> AccessCheck 在 NAS 上唯一采用的部署方式：本机完成构建和验证，NAS 只加载镜像并运行。NAS 不执行 Docker build，也不执行 Docker pull。

## 固定约定

- NAS：`D3AC@192.168.1.35`，项目目录：`/vol1/AccessCheck/app`。
- 构建平台固定为 `linux/amd64`。
- 应用镜像为 `accesscheck-nas:local`，出口代理镜像为 `accesscheck-nas-egress:local`。
- `data/`、`data/exports/`、`private-inputs/` 和 `.secrets/` 是 NAS 宿主机数据，不能放进镜像或归档，也不能执行 `down -v`。
- NAS 上的 Docker 命令使用 `sudo`。

## 1. 本机构建、验证、导出

在 `C:\ai\AccessMetrics` 执行：

```powershell
docker buildx build --platform linux/amd64 --load -t accesscheck-nas:local .
docker buildx build --platform linux/amd64 --load -t accesscheck-nas-egress:local .\tools\egress-proxy

pnpm lint
pnpm typecheck
pnpm test

$bundle = Join-Path $env:TEMP "accesscheck-nas-images.tar"
docker save -o $bundle accesscheck-nas:local accesscheck-nas-egress:local
scp $bundle D3AC@192.168.1.35:/home/D3AC/
```

## 2. NAS 回滚标记、加载、定向重建

```sh
cd /vol1/AccessCheck/app

# 先给当前两个镜像建立明确的可回滚标签。
rollback_stamp=$(date +%Y%m%d-%H%M%S)
sudo docker image inspect accesscheck-nas:local
sudo docker image inspect accesscheck-nas-egress:local
sudo docker tag accesscheck-nas:local "accesscheck-nas:rollback-$rollback_stamp"
sudo docker tag accesscheck-nas-egress:local "accesscheck-nas-egress:rollback-$rollback_stamp"

sudo docker load -i /home/D3AC/accesscheck-nas-images.tar
sudo docker compose --env-file .env.nas -f compose.nas.yaml config --quiet

# 只替换使用新镜像的服务；不要把 caddy 放进命令，也不要执行 down。
sudo docker compose --env-file .env.nas -f compose.nas.yaml up -d --no-build --pull never --force-recreate \
  egress-proxy worker web ai-worker
sudo docker compose --env-file .env.nas -f compose.nas.yaml ps
curl --fail http://127.0.0.1:3000/api/health
```

若健康检查失败，先恢复两个回滚 tag，再用同一条定向重建命令恢复服务；不要重启 Caddy：

```sh
sudo docker tag "accesscheck-nas:rollback-$rollback_stamp" accesscheck-nas:local
sudo docker tag "accesscheck-nas-egress:rollback-$rollback_stamp" accesscheck-nas-egress:local
sudo docker compose --env-file .env.nas -f compose.nas.yaml up -d --no-build --pull never --force-recreate \
  egress-proxy worker web ai-worker
```

确认新版本健康后再考虑删除不再需要的旧镜像；归档在本机保留到验收完成。清理时不要删除 `data`、`private-inputs`、`.secrets` 或 Caddy 命名卷。

## 禁止事项

- 禁止 `docker compose up -d --build`、`docker compose build`。
- 禁止在 NAS 上 `git pull` 后构建；NAS 只需要 Compose 配置、环境文件、secret 和持久化数据。
- 禁止把真实密钥、SQLite 数据或私有证据复制进镜像归档。
- 禁止为了本应用部署执行 `docker compose down` 或重启 Caddy。
- 发布失败时先查看 `ps` 和日志；不要用 `down -v` 或全局 `docker system prune` 作为排障手段。
