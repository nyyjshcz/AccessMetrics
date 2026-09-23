# AccessCheck Lishui

Language: [中文](README.md) | **English**

AccessCheck is a self-hostable web accessibility scanning tool. Starting from a URL, it discovers pages on the same site, scans them with a real browser and axe, stores the results in SQLite, and generates issues, scores, and reports. Administrators use an access key to manage scans, AI, and publication; visitor keys can view published reports only. Scores are for screening and comparison and are not equivalent to a manual audit or a compliance certification.

## Start here

When learning about the project, follow the role-based paths in the [documentation map](docs/README.en.md). Everyone should first read the [project overview](docs/project-overview.en.md), then choose one path according to their work; you do not need to read the entire `docs/` directory.

## Directory map

| Directory | Purpose |
| --- | --- |
| `src/`, `public/`, `scripts/`, `migrations/` | The running website, background jobs, and database migration scripts. |
| `tests/`, `tools/` | Automated tests and controlled scanning tools. |
| `docs/` | Current project, architecture, scoring, mathematics, operations, and deployment materials. |
| `analysis/`, `scoring/`, `project-materials/` | Mathematics and research support materials, not the web runtime; includes research, study, and notebook materials. |
| `configs/`, `contracts/` | Rule catalogs, configuration, and data-format contracts. |
| `data/`, `private-inputs/` | The local database, private evidence, and reports; do not commit these to Git or clean them up casually. |

## Prerequisites

- Node.js `24.19.0`, pnpm `11.19.0`, and Python `3.12.13`.
- Copy `.env.example` to `.env.local` and replace `SESSION_SECRET` with at least 32 random characters. It is used both to encrypt the AI Provider API Key and to sign access sessions; do not commit it.
- In `.env.local`, set different `ADMIN_ACCESS_KEY` and `VISITOR_ACCESS_KEY` values (each at least 16 characters). Administrators can scan, process, publish, and configure AI; visitors can read published reports only.
- The controlled `EGRESS_PROXY_URL` for the production scanning Worker is injected by `compose.prod.yaml`; deployers do not need to set it in `.env.production`. See the [deployment guide](docs/ops/deployment.en.md) for complete single-VPS deployment steps.

## Run locally

```text
pnpm install
pnpm db:migrate
pnpm dev
```

`pnpm db:migrate` creates or upgrades the local SQLite schema. `pnpm dev` starts the Web, scanning Worker, and AI Worker together.

- **Web and database**: `http://localhost:3000/api/health` returns `status: ok`.
- **Scanning Worker**: after both Workers start, they continuously poll their queues; after submitting a scan, confirm that the scan moves from queued to running or completes and that the scanning Worker logs `scan job started`. No `worker crashed` message or process exit means the process is ready.
- **AI Worker**: after submitting an AI review batch, confirm that it moves from queued to running or completes. No `worker crashed` message or process exit means the process is ready.

The scanning Worker processes the scan queue and the AI Worker processes the AI review queue. The default address is `http://localhost:3000`; the port is controlled by `APP_BASE_URL` and defaults to `3000` when unset. Ctrl+C stops all three processes. For startup failures or troubleshooting, read the [operations guide](docs/operations.en.md); do not print or paste any key. After startup, enter the administrator or visitor access key on the login page. To debug one process separately, open another terminal and run `pnpm worker` or `pnpm ai:worker`. `pnpm scan:site` discovers and scans pages on the same site and writes results to the database; for example:

```text
pnpm scan:site -- https://example.org --max-pages 10
```

Scan results and report data are written by default to the directories specified in `.env.local`; do not commit private evidence directories or the database to Git.

## Common commands

- `pnpm lint`, `pnpm typecheck`: check code and types.
- `pnpm test`: run unit and integration tests; `pnpm test:e2e`: run browser flows.
- `pnpm test:all`: run lint, typecheck, test, build, and test:e2e in order.
- `pnpm db:check`: check the database schema; `pnpm db:reset:test`: reset the test database.
- `pnpm scan:page`, `pnpm scan:site`: run a single-page or site scan.
- `pnpm score:recalculate`: recalculate scores for existing scans.
- After publishing a scan, HTML, PDF, and complete JSON reports can be downloaded from the report page.
- `pnpm backup:create`, `pnpm backup:restore`: back up or restore local data.

The browser AI provider configuration entry point is `/settings/ai`.

## Data and security boundaries

The scanning Worker processes only queued scan jobs and writes results; the AI Worker processes only the AI review queue and writes auxiliary conclusions. Neither sends keys to the browser. Production Workers must use an explicit egress proxy and may not bypass it to access the public internet. Private-network, loopback, credential-URL, and unauthorized targets are rejected. Production must use a random `SESSION_SECRET`, different administrator and visitor access keys, an independent data directory, and controlled network configuration. See the complete [security boundaries](docs/security-boundaries.en.md).

## Capacity note

Local SQLite is suitable for approximately 10 to 20 websites and approximately 100 to 300 successful pages with their axe results. Larger-scale or formal deployment requires a separate storage, networking, and operations design.
