# Feiniu NAS Deployment and Tailscale Access

[中文](./nas-tailscale.md)

> **Who should read this: people responsible for deploying the project to a Feiniu NAS. Is it required reading: required during deployment and migration.** Other members do not need to read this page.

This is a NAS-specific guide. It does not replace the VPS [deployment guide](./deployment.en.md). The NAS version uses `compose.nas.yaml`: Web, the Scan Worker, and the AI Worker share the same SQLite data; Caddy provides HTTP only on the NAS’s `127.0.0.1:3000`, while Tailscale Funnel provides public HTTPS.

> NAS now permits only the “build and verify locally → export images → NAS `docker load` → start with Compose” workflow. Read the [prebuilt image deployment guide](./nas-prebuilt-deployment.en.md) first; this page no longer uses a source-build workflow on the NAS.

## Pre-deployment checks

- Confirm that Docker, Docker Compose, SSH (default port 22), and Tailscale are enabled on Feiniu.
- Confirm that the NAS has enough disk space for the database, private evidence, report exports, and Docker images.
- Confirm that Tailscale is logged in on the NAS and that MagicDNS, HTTPS certificates, and Funnel permission are enabled.
- Real `.env.nas`, `.secrets/`, `data/`, and `private-inputs/` must not be committed to Git.

## Deploy over SSH

After logging in to the NAS, pin the repository to the commit to run:

```sh
git clone <YOUR_REPOSITORY_URL> accesscheck
cd accesscheck
mkdir -p .secrets private-inputs data data/exports
```

Copy `.env.nas.example` to `.env.nas` and fill in only the HTTPS address of Tailscale Funnel:

```text
APP_BASE_URL=https://nas-name.tailnet-name.ts.net
```

Before migrating current data, stop the local Web, Scan Worker, and AI Worker, and use the project backup process to obtain a consistent copy. Migrate `data/`, `private-inputs/`, `data/exports/`, and the three secret files. `session_secret` must retain its original value, or saved remote AI Provider Keys cannot be decrypted. Do not migrate local AI Providers such as LM Studio that point to `127.0.0.1:1234`; remote Providers may be retained.

Do not write secrets into Compose, `.env.nas`, Shell history, or Git. With non-Swarm Compose on NAS, the Compose `uid`, `gid`, and `mode` fields do not change secret bind-mount permissions; therefore, set the host files’ numeric group and permissions directly. Make the secret files owned by root, in shared read group 10000, with mode 0440:

```sh
chown 10001:10001 private-inputs
chmod 700 private-inputs
chown -R 10001:10000 data
find data -type d -exec chmod 2770 {} +
find data -type f -exec chmod 0660 {} +
chown root:10000 .secrets/*
chmod 0440 .secrets/*
docker compose --env-file .env.nas -f compose.nas.yaml config --quiet
```

These three files are respectively read by Web for access control and the session key, and by the AI Worker for the session key. Compose mounts them at `/run/secrets/`; application containers still run as non-root users and use group 10000 for reading. `deploy:nas:check` checks only file type, permissions, and group; it does not output secret contents.

Start and check (building on the NAS is not allowed):

```sh
docker compose --env-file .env.nas -f compose.nas.yaml up -d --no-build --pull never
docker compose --env-file .env.nas -f compose.nas.yaml ps
docker compose --env-file .env.nas -f compose.nas.yaml logs --tail=100 web worker ai-worker caddy
```

Web, the Worker, and the AI Worker must continue using the same `data/`; do not put `private-inputs/` in the static Web directory.

## Configure Tailscale Funnel

Check Tailscale status, then point Funnel to Caddy’s local port:

```sh
TAILSCALE=/vol1/@appcenter/tailscale/bin/tailscale
TS_SOCKET=/vol1/@appdata/tailscale/tailscaled.sock
$TAILSCALE --socket=$TS_SOCKET status
$TAILSCALE --socket=$TS_SOCKET funnel --bg http://127.0.0.1:3000
$TAILSCALE --socket=$TS_SOCKET funnel status
```

Use the HTTPS address shown by `tailscale funnel status` as the authority, and ensure it exactly matches `APP_BASE_URL` in `.env.nas`. Do not bind Docker’s 3000 port to `0.0.0.0`.

## Acceptance and rollback

Confirm that all containers are running, visit `/api/health`, check permissions separately with the administrator and visitor keys, then download HTML, PDF, and JSON reports and perform one authorized single-page scan. Before an update, stop the three business services and back up `data/`, `private-inputs/`, and `.secrets/`. If a check fails, first run `$TAILSCALE --socket=$TS_SOCKET funnel reset`, stop Compose, and restore the above directories and the original Git commit from the pre-deployment snapshot; do not delete the original local data.
