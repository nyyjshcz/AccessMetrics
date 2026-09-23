# Current Architecture

> **Who should read this: code owners. Is it required: required for code maintenance, optional for others.** After reading, you will know how the Web app, the two Workers, SQLite, and reports work together.

Language: [中文版](./architecture.md)

## One-sentence overview

AccessCheck consists of a Next.js Web application, a scanning Worker, an AI Worker, and a SQLite database. The Web app handles authorization, presentation, and task creation; the two Workers only claim work from the queues; all reports are generated on demand from traceable results in the database.

Two kinds of status must be distinguished here: a page that is incomplete to scan is the scan status of the page itself, indicating that the page did not complete scanning successfully; an item requiring further judgment is an axe `incomplete` result, indicating that the rule could not reach a reliable conclusion automatically. The former is page coverage status, while the latter is rule- or node-level review status; they are not the same thing.

## Runtime components

| Component | Responsibility | What it does not do |
| --- | --- | --- |
| Web | Login, role authorization, scan/AI/publish APIs, result pages, HTML/PDF/JSON reports | It does not scan web pages in the browser, and it does not send model keys to the browser. |
| Scanning Worker | Claim scan tasks, validate targets, discover same-site pages, call Playwright and axe, write results | It does not process the AI queue. |
| AI Worker | Claim run-wide incomplete review batches, call the frozen model configuration, save auxiliary conclusions | It does not change the original axe results or scan web pages. |
| SQLite | Store tasks, runs, pages, rules, nodes, manual/AI conclusions, and publication status | It is not used as a large multi-tenant database. |

Running `pnpm dev` locally starts the Web app, scanning Worker, and AI Worker together. If there are unfinished queues in the database, they will continue processing; before a demo, confirm that no scan or AI batch is continuing unexpectedly.

## Access and roles

The server has three different keys configured:

| Configuration | Purpose |
| --- | --- |
| ADMIN_ACCESS_KEY | Administrator login key. Administrators can create scans, configure AI, review, publish, and delete unpublished terminal-state tasks. |
| VISITOR_ACCESS_KEY | Report visitor login key. Visitors can only read published reports. |
| SESSION_SECRET | Internal server key used to sign the HttpOnly login Cookie and to protect the saved AI Provider Key. It is not shown to users. |

Every API requires a signed session; management APIs require the administrator role. Write requests carrying an Origin from the browser must also come from the current application Origin. Published runs remain read-only.

## Scanning data flow

1. An administrator submits the public website home page and the page limit for this run.
2. The Web app creates a scan job, and the scanning Worker claims it.
3. After DNS resolution, the Worker validates the target address and rejects private-network, loopback, credential URLs, and non-HTTP(S) addresses.
4. The Worker discovers pages within the same-site scope, opens stable pages with Playwright, and runs axe-core.
5. Each page produces rule results and node-level evidence; successful pages, failed pages, merged redirects, and pages with incomplete scans are all recorded.
6. The Worker writes the run's raw score and completion status; the Web app then reads these results from the database and generates the report.

The page limit is only the maximum attempted scope for one task. The actual number of completed pages depends on the independent pages discoverable on the site, merged redirects, and page errors.

## Result and scoring data

The core relationships can be understood as:

scan job → scan run → pages → rule results → result nodes

Among them:

- scan job is the queued task;
- scan run is a scorable, publishable scan;
- pages store page coverage and scan status, including pages with incomplete scans;
- rule results store per-page, rule-level statistics and `node_count`;
- result nodes store detailed evidence for violations / incomplete;
- manual and AI conclusions attach only to axe `incomplete` nodes, that is, items requiring further judgment; they do not attach to the page status of a page with an incomplete scan.

Pass and inapplicable nodes do not need to be persisted as large numbers of result nodes; their true counts come from `node_count` in rule results. This keeps statistics complete without allowing meaningless passing nodes to overwhelm storage.

See [Scoring explanation](./scoring-explained.en.md) for the scoring algorithm and its boundaries.

## AI-assisted review data flow

1. An administrator selects a configuration from the saved model services.
2. The Web app creates a batch for all incomplete items in the current run and freezes the model, address, Key fingerprint, concurrency, and rate-limiting strategy at that time.
3. The AI Worker claims only new run-wide batches; old page, formal, or study batches are not executed by the new Worker.
4. AI conclusions are saved as problem, not_problem, or uncertain, with a short rationale.
5. When results are read, the effective conclusion is calculated in the order manual > AI > original incomplete. The original axe data is never overwritten.

When a model service is temporarily unavailable or rate-limited with 429, the individual item remains in an automatically recoverable waiting queue; the batch does not require manual continuation item by item because of a temporary error in one item.

## Reports and publication

Unpublished runs can be previewed by administrators only in the management interface. After publication:

- the scan run and its review data become read-only;
- administrators and report visitors can read the same HTML, PDF, or JSON report;
- the HTML report is generated from the current database results, showing scores, coverage, and high-priority items first, with node evidence expanded on demand;
- the report clearly labels automatically identified problems, items requiring further judgment, manual conclusions, and AI conclusions, without conflating them.

## Security and deployment boundaries

The production scanning Worker must make outbound connections through an explicit `EGRESS_PROXY_URL`; the Web app may use a separate browser egress path for PDF rendering. Production deployment uses `compose.prod.yaml`, Caddy, three Docker secrets, and a separate data directory; see [Deployment instructions](./ops/deployment.en.md) for the complete steps.

The system is intended for small-scale, traceable assessments, not for an open-ended crawler, general-purpose AI platform, or large multi-tenant SaaS.
