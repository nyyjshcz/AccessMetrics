# Feiniu NAS Prebuilt Image Deployment

[中文](./nas-prebuilt-deployment.md)

> The only deployment method used by AccessCheck on NAS: build and verify locally, while the NAS only loads images and runs them. The NAS does not run Docker build and does not run Docker pull.

## Fixed conventions

- NAS: `D3AC@192.168.1.35`, project directory: `/vol1/AccessCheck/app`.
- Build platform is fixed at `linux/amd64`.
- Application image is `accesscheck-nas:local`, and egress proxy image is `accesscheck-nas-egress:local`.
- `data/`, `data/exports/`, `private-inputs/`, and `.secrets/` are NAS host data; they must not be put into an image or archive, and `down -v` must not be run.
- Docker commands on NAS use `sudo`.

## 1. Build, verify, and export locally

Run in `C:\ai\AccessMetrics`:

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

## 2. Mark rollback, load, and selectively recreate

```sh
cd /vol1/AccessCheck/app

# First create explicit rollback tags for the current two images.
rollback_stamp=$(date +%Y%m%d-%H%M%S)
sudo docker image inspect accesscheck-nas:local
sudo docker image inspect accesscheck-nas-egress:local
sudo docker tag accesscheck-nas:local "accesscheck-nas:rollback-$rollback_stamp"
sudo docker tag accesscheck-nas-egress:local "accesscheck-nas-egress:rollback-$rollback_stamp"

sudo docker load -i /home/D3AC/accesscheck-nas-images.tar
sudo docker compose --env-file .env.nas -f compose.nas.yaml config --quiet

# Replace only services that use the new images; do not include caddy in the command or run down.
sudo docker compose --env-file .env.nas -f compose.nas.yaml up -d --no-build --pull never --force-recreate \
  egress-proxy worker web ai-worker
sudo docker compose --env-file .env.nas -f compose.nas.yaml ps
curl --fail http://127.0.0.1:3000/api/health
```

If the health check fails, first restore the two rollback tags, then use the same selective recreation command to restore the services; do not restart Caddy:

```sh
sudo docker tag "accesscheck-nas:rollback-$rollback_stamp" accesscheck-nas:local
sudo docker tag "accesscheck-nas-egress:rollback-$rollback_stamp" accesscheck-nas-egress:local
sudo docker compose --env-file .env.nas -f compose.nas.yaml up -d --no-build --pull never --force-recreate \
  egress-proxy worker web ai-worker
```

After confirming that the new version is healthy, consider deleting old images that are no longer needed; keep the archive locally until acceptance is complete. During cleanup, do not delete `data`, `private-inputs`, `.secrets`, or the Caddy named volume.

## Acceptance for scan-failure remediation

A 200 response from only `/resolve` does not mean a complete scan is usable. In the 2026-09-06 incident, the proxy crashed on unhandled client `EPIPE` / `ECONNRESET` and automatically restarted 7 times, while the Worker represented proxy unavailability as `DNS_LOOKUP_FAILED`; repeated DNS queries also increased the probability of timeouts.

- During investigation, check failed-page error codes, proxy logs, and `docker inspect`’s `RestartCount` together; do not only extend the DNS timeout.
- The tunnel must handle errors and closure on both socket ends during both the DNS-waiting stage and the connected stage; one disconnected browser connection must not terminate the proxy process.
- The proxy coalesces concurrent resolution for the same domain and caches only validated public addresses; the cache does not exceed the DNS TTL and 60 seconds, and it resolves again after expiry, without using expired or failed results.
- When changing only the proxy, build and recreate only `egress-proxy`. Run proxy DNS and socket-lifecycle regression tests locally; if local DNS returns Fake-IP, the real public scan must be verified through the NAS’s actual egress.
- After release, run a complete scan with the same options as the incident task and check discovery count, success count, failure reasons, and proxy restart count. Keep the new verification task available for review; do not rewrite historical failure records.

This complete verification task: `job_bd550ce3e975446e951a82515d320267`, target `https://www.cadtc.org.cn/`, with the same 15-page, same-origin, obey-robots options as the original task; result: 15 pages succeeded, 0 pages failed. Rollback image: `accesscheck-nas-egress:rollback-20260906-2200`.

## Prohibited actions

- Do not run `docker compose up -d --build` or `docker compose build`.
- Do not run `git pull` and then build on the NAS; the NAS needs only Compose configuration, environment files, secrets, and persistent data.
- Do not copy real secrets, SQLite data, or private evidence into an image archive.
- Do not run `docker compose down` or restart Caddy for this application deployment.
- When a release fails, check `ps` and logs first; do not use `down -v` or global `docker system prune` as troubleshooting measures.
