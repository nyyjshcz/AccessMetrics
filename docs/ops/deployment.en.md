# Single-VPS Self-Hosted Deployment

[中文](./deployment.md)

> **Who should read this: the person responsible for going live. Is it required reading: required during deployment; others do not need to read it.** After reading, you will know which production configuration, services, and checks are required.

This guide applies to a single-instance deployment on a Linux VPS. The project uses SQLite and shared volumes, so Web, the Scan Worker, and the AI Worker must run on the same machine and access the same data directory; do not deploy it to a Serverless platform without persistent storage.

If the target is a Feiniu NAS with HTTPS access provided through Tailscale, read the [Feiniu NAS and Tailscale deployment guide](./nas-tailscale.en.md) instead.

## What to prepare first

- A Linux VPS under your control, preferably Ubuntu 24.04 LTS, with at least 2 vCPU, 4 GB memory, and 30 GB available disk; when using a local large model, the model service should still be on a controlled network you can access.
- A domain and its A/AAAA records pointing to the VPS’s public IP. Caddy automatically obtains and renews HTTPS certificates, so DNS resolution and inbound ports 80/443 must be ready first.
- Docker Engine and the Docker Compose plugin; the host firewall should expose only SSH, 80, and 443.
- Node 24 and Corepack (needed only when running the full `pnpm` installation and deployment checks on the host; Docker-only operation does not require Node/pnpm on the host).
- Authorization to check the target website, and a reviewed, digest-pinned egress proxy image. The Scan Worker must not connect directly to the public internet; it accesses target sites only through this proxy.

## First deployment

On the server, clone the repository and switch to the commit to publish. Do not put real secrets in Git or .env.production.

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

Administrator and visitor keys must be different. Store them in a password manager: administrators can create scans, manage AI, and publish reports; visitors can only view published reports. Production Compose runs the three SQLite-writing processes with shared GID and `umask 0002`; do not change `data/` back to `0700`, or the Workers will be unable to write to the same database. `private-inputs/` must remain `0700` because it is provided only to Web.

Create the server-local .env.production (do not commit it):

```text
APP_BASE_URL=https://reports.example.com
CADDY_SITE=reports.example.com
EGRESS_PROXY_IMAGE=registry.example.com/approved-egress-proxy@sha256:<immutable-digest>
```

APP_BASE_URL must exactly match the HTTPS origin actually used by the browser. `EGRESS_PROXY_IMAGE` must be a security-reviewed immutable image digest; the production Scan Worker’s `EGRESS_PROXY_URL` is fixed by `compose.prod.yaml` to `http://egress-proxy:8080`, so it does not need to be written to `.env.production`, and Web does not depend on this variable. Do not use an arbitrary open proxy, host proxy, or local development proxy as a production substitute.

If the host has Node 24, Corepack, and pnpm installed, run the full repository checks:

```sh
pnpm install --frozen-lockfile
pnpm ops:check
pnpm deploy:check
```

Docker-only deployment does not require Node/pnpm on the host. Before starting, run at least the Compose configuration check; it validates production environment variables and the expanded Compose result:

```sh
docker compose --env-file .env.production -f compose.prod.yaml config --quiet
```

Production Compose has no unified migration service. The Scan Worker and AI Worker run migrations at startup, and Web’s health or related API requests also run migrations. If the host has Node/pnpm, you may additionally run the existing manual command `pnpm db:migrate` before startup; Docker-only deployment must not assume that the host can run this command.

Start:

```sh
docker compose --env-file .env.production -f compose.prod.yaml up -d --build
docker compose --env-file .env.production -f compose.prod.yaml ps
docker compose --env-file .env.production -f compose.prod.yaml logs --tail=100 web worker ai-worker caddy
```

Initial verification:

1. Open https://reports.example.com/login in a browser.
2. Enter the administrator key, create a small public-site scan, and confirm that the worker claims the task.
3. After publishing the scan, log out and sign in with the visitor key; visitors should see only “Published Reports”, and visiting /scans or /settings/ai should return to /reports.
4. Confirm that downloading PDF, HTML, and JSON reports requires a logged-in administrator or visitor session.

## Daily operation and updates

```sh
docker compose --env-file .env.production -f compose.prod.yaml ps
docker compose --env-file .env.production -f compose.prod.yaml logs -f ai-worker
git pull --ff-only
docker compose --env-file .env.production -f compose.prod.yaml up -d --build
```

After changing the administrator or visitor key, update the corresponding .secrets file and recreate the Web container. Existing sessions for that role will expire automatically:

```sh
chmod 600 .secrets/admin_access_key .secrets/visitor_access_key
docker compose --env-file .env.production -f compose.prod.yaml up -d --force-recreate web
```

## Backup and restore

Before stopping writes, back up `data/`, `private-inputs/`, and `.secrets/`; none of the three may remain long-term in an unencrypted ordinary archive. `data/` and `private-inputs/` must go directly through the host/backup system’s encrypted backup process, while `.secrets/` must be stored separately through a protected key system or encrypted storage, retaining the original `session_secret`. SQLite data, private evidence, and saved AI Provider Keys are related and cannot be backed up only partially. `pnpm backup:create` does not include `.secrets`; it encrypts collected private evidence only when `PRIVATE_BACKUP_KEY` or `PRIVATE_BACKUP_KEY_FILE` is provided.

```sh
docker compose --env-file .env.production -f compose.prod.yaml stop web worker ai-worker
# Use the host/backup system’s encrypted process to back up data/ and private-inputs/; do not create an unencrypted ordinary archive
# Store .secrets/ separately in a protected key system or encrypted storage
docker compose --env-file .env.production -f compose.prod.yaml start web worker ai-worker
```

To restore, first stop the same services, then restore `data/` and `private-inputs/` from encrypted storage managed by the host or backup system into the deployment directory. Do not save decrypted contents again as an ordinary unencrypted archive:

```sh
docker compose --env-file .env.production -f compose.prod.yaml stop web worker ai-worker
# Use the encrypted restore process of your host/backup system to restore data/ and private-inputs/ into this deployment directory
```

Repair the shared GID/permissions for `data/` and the `0700` permission for `private-inputs/` according to the first-deployment steps, then restore `.secrets/` from protected key storage. You must use the same `session_secret`; if it is lost, saved AI Provider Keys cannot be decrypted. If a backup created by the project script is used, a host with Node/pnpm may also run `pnpm backup:restore <absolute-backup-dir> <absolute-target-dir>`; this command still does not restore `.secrets/`.

After restoring `.secrets/`, restart the services and then check service status, the health endpoint, and logs in order:

```sh
docker compose --env-file .env.production -f compose.prod.yaml up -d
docker compose --env-file .env.production -f compose.prod.yaml ps
docker compose --env-file .env.production -f compose.prod.yaml logs --tail=100 web worker ai-worker
```

Open `https://reports.example.com/api/health` in a browser and confirm that it returns a ready state. If the host has Node/pnpm, then run `pnpm db:check`; Docker-only deployment does not require Node/pnpm on the host, using the health endpoint and the container logs above as structure and process validation. Finally, follow the initial-verification steps to check administrator/visitor login, published reports, and report downloads.

## Operating boundaries

- In production configuration, Caddy is the only publicly exposed service; Web listens only on the internal app network.
- The Scan Worker runs on an isolated network and must use EGRESS_PROXY_URL; do not remove this setting.
- The current SQLite target scale is approximately 10 to 20 websites, with 100 to 300 successful pages and their axe results. Before expanding the scale, redesign storage and operations instead of mounting the same SQLite file across multiple machines.
