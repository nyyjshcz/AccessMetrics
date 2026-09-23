# Operations Guide

[中文](./operations.md)

> **Who should read this: deployment and local-run owners. Is it required reading: required when starting, troubleshooting, or deploying.** After reading, you will know how to start and stop the system, check queues, and back up data.

## Local startup

First-time preparation:

1. Install Node.js 24.19.0 and pnpm 11.19.0.
2. Copy .env.example to .env.local.
3. Set distinct and sufficiently long SESSION_SECRET, ADMIN_ACCESS_KEY, and VISITOR_ACCESS_KEY values.
4. Run pnpm install, then run pnpm db:migrate.

Daily startup:

    pnpm dev

This command starts all of the following:

- Web: serves the local page by default;
- Scan Worker: consumes queued scan jobs;
- AI Worker: consumes queued AI batch.

Pressing Ctrl+C stops all three processes together. If you only need to check the frontend and do not want to continue consuming existing queues, start Web separately instead of using the full startup command.

## Pre-start checks

Full startup automatically continues scans and AI batches in the database that have not yet ended. Before a demonstration, it is recommended to:

1. Confirm in “Active Tasks” that there are no queued or running scans;
2. In the AI-assisted review area of each scan, confirm that there are no queued, running, or awaiting-retry batches;
3. Delete terminal tasks that are no longer needed and have not been published from Active Tasks;
4. For AI batches you do not want to continue, pause them on the results page first.

This prevents local models or remote APIs from continuing to receive requests without your knowledge.

## Roles and keys

| Key | Where it belongs | Purpose |
| --- | --- | --- |
| SESSION_SECRET | Server environment variable or secret file only | Session Cookie signing and AI Provider Key encryption. |
| ADMIN_ACCESS_KEY | Give to administrators only | After login, can manage scans and AI. |
| VISITOR_ACCESS_KEY | Give to report readers only | After login, can only view published reports. |

Do not commit .env.local, .env.production, .secrets, or the database to Git.

## Common check commands

| Purpose | Command |
| --- | --- |
| Static checks | pnpm lint |
| Type checks | pnpm typecheck |
| Unit and integration tests | pnpm test |
| Browser flows | pnpm test:e2e |
| Full validation | pnpm test:all |
| Database structure check | pnpm db:check |
| Create a backup | pnpm backup:create |
| Restore a backup | pnpm backup:restore |
| Static deployment-file checks | pnpm ops:check |
| Pre-production-deployment checks | pnpm deploy:check |

## AI model service

An administrator saves the Base URL, model name, concurrency limit, and optional RPM policy for an OpenAI-compatible service on the AI Settings page. The API Key is stored only on the server; the page displays only the Key fingerprint.

- For a local service such as LM Studio that can reliably handle only one task at a time, set the maximum concurrency to 1.
- An OpenRouter free model can use a 20 requests/minute policy; this policy affects only newly created batches.
- When a 429 response includes Retry-After, the Worker waits according to the server time; only when it is absent does it automatically retry after 60 seconds.
- Temporary request errors that are not rate limits are not incorrectly recorded as a one-minute rate-limit wait.

## Backup and restore

Run results, private evidence, and export directories are specified by environment variables. Before backup and restore, stop all services that write to SQLite to avoid copying a database while it is being written. `pnpm backup:create` backs up SQLite and encrypts private evidence when `PRIVATE_BACKUP_KEY` or `PRIVATE_BACKUP_KEY_FILE` is provided, but does not include `.secrets`. A complete production backup must also store `.secrets` separately and securely, especially the original `session_secret`.

When restoring, first stop Web, the Scan Worker, and the AI Worker, then restore `data/` and the private-input directory and repair directory permissions as required for production; when restoring `.secrets`, you must use the original `session_secret`. Then run `pnpm db:check`, start the services, visit the health endpoint, and check published reports. The project’s `pnpm backup:restore <backup-dir> <target-dir>` restores only the database and encrypted private evidence from a script backup; it does not restore `.secrets` and cannot replace restoring the complete production directory set.

## Production deployment

Production deployment uses compose.prod.yaml. It includes Web, the Scan Worker, the AI Worker, Caddy, and a controlled egress proxy. The production Scan Worker’s `EGRESS_PROXY_URL` is fixed and injected by Compose, and Web does not depend on this variable. Before deployment, prepare:

- An available domain name and HTTPS;
- A production .env.production;
- Three independent secret files;
- An egress proxy image with a pinned digest;
- Linux data and export directories with correct permissions.

See the [deployment guide](./ops/deployment.en.md). The production Scan Worker must not bypass the egress proxy to access the public internet. Production Compose has no unified migration service: the two Workers migrate at startup, and Web’s health or other related requests also migrate; if you need to verify manually before startup, run `pnpm db:migrate` on a host with Node/pnpm. Docker-only operation does not require Node/pnpm on the host; you can directly run `docker compose ... config --quiet`, `up -d --build`, `ps`, and log checks from the deployment guide.

For the Docker, SQLite data migration, and Tailscale Funnel process on a Feiniu NAS, see the [Feiniu NAS and Tailscale deployment guide](./ops/nas-tailscale.en.md).
