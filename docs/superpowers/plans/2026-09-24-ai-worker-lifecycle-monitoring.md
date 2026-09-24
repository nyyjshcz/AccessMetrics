# AI Worker Lifecycle and Cost Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep AI requests bounded and tied to visible scans, make deletion/configuration changes stop obsolete work, and let admins see exactly what the AI Worker is doing and what usage providers report.

**Architecture:** Keep the existing SQLite queue and separate AI Worker. Add durable request-attempt/worker-heartbeat records and cancellation flags; the Worker checks persisted state before each outbound call and while requests are in flight. Add a read-only, admin-only monitoring endpoint and page; viewing or refreshing it never starts or resumes work.

**Tech Stack:** Next.js 16.3, TypeScript, SQLite/better-sqlite3, Vitest, Docker Compose, local Linux/amd64 image build, LAN transfer to NAS.

**Spec:** `docs/superpowers/specs/2026-09-24-ai-worker-lifecycle-monitoring-design.md`

## Global Constraints

- **Delete a scan:** “同一扫描运行的所有 AI 批次和队列项一并删除，不论其状态是排队、运行、暂停、失败还是已完成。” Persist cancellation before deleting scan-linked data; the Worker revalidates that the scan still exists before every request. Abort an in-flight request promptly. Keep only de-identified request status, time, and usage in the audit log; no resumable batch or task association may remain.
- **Change, disable, or delete a model configuration:** Cancel its nonterminal work and clear queued/failed work; do not silently move it to another configuration. Preserve completed AI judgments, manual reviews, and reports.
- **Switch models:** On an explicit start, cancel stale nonterminal batches for that scan and create at most one active batch using the newly selected snapshot.
- **Pause:** Stop new claims and abort in-flight requests. Keep queued work resumable only while both scan and provider snapshot remain valid; resume is always explicit and does not reset the retry budget.
- **Retries:** At most three outbound API calls per item per explicit review cycle, including the initial call. Use capped exponential backoff and honor `Retry-After`; no error class may bypass the cap.
- **Monitoring:** Admin-only, read-only endpoint and page; show live calls, worker/slot state, distinct active/paused/cancelled/failed counts, and only provider-reported tokens/cost. Missing usage is “unknown”; never infer cost from model pricing. Never expose keys, prompts, page content, or full provider responses.
- Preserve scan scoring, original rule results, report structure, and existing provider/API-key configuration. Do not add billing-provider APIs or claim exact attribution of historical spend.
- Use a local fake provider only; no real provider calls or new real scans during verification. Build and test locally, transfer the app image over LAN, update only `web` and `ai-worker`, and do not rebuild on the NAS or restart Caddy.

## Review Focus

1. **Delete vs. claim/request race:** an item is claimed just as its scan is deleted; assert no later request can start, all run batches/items are gone, an in-flight request is aborted, and the audit row has no scan/batch/item IDs. Cover in the scan-delete integration test.
2. **Provider edit vs. completion race:** provider is disabled/changed while a response is arriving; assert the old result cannot resurrect a queue item or complete stale work, while already-completed judgments remain. Cover in AI lifecycle integration tests.
3. **Pause/resume and stale snapshot:** pause during an API call, then change/delete the provider before resume; assert the call stops and stale work cannot resume. A valid explicit resume retains its consumed attempt count. Cover in AI lifecycle integration tests.
4. **Retry boundary and rate limit:** persistent network/5xx/invalid-response errors stop at exactly three calls; a 429 with `Retry-After` does not retry early and also cannot exceed the cap. Cover with the fake provider and a controllable clock.
5. **Monitor authorization, privacy, and read-only behavior:** visitor/unauthenticated requests are denied; admin responses omit secrets/content; repeated GETs do not alter batch/item state or cause provider calls. Cover in monitor API integration tests.

---

## Task 1: Persist request attempts, worker liveness, and cancellation metadata

**Files:** `src/lib/db.ts`, `tests/scoring/ai-overlay.test.ts` (or a focused new lifecycle test file).

- [ ] Add migration tests first: a fresh database and a database already migrated through version 032 both migrate successfully; repeated migration is idempotent; the new tables/indexes/columns exist.
- [ ] Run `pnpm exec vitest run tests/scoring/ai-overlay.test.ts` and confirm the new migration assertions fail before implementation.
- [ ] Add migration 033 with `ai_api_attempts` (`id`, `worker_id`, `slot`, nullable `run_id`/`batch_id`/`item_id`/`provider_config_id`, provider label/model, retry cycle/attempt number, start/end/duration, status, HTTP status, sanitized error code, nullable token counts/reported cost/currency, cancellation timestamp) and `ai_worker_instances` (`worker_id`, started/last-seen/stopped timestamps). Attempt rows remain durable for usage history; completion fields may be finalized and scope IDs redacted for privacy after scan deletion. Keep scope IDs nullable and without restrictive foreign keys. Add `retry_cycle` and `next_retry_at` to items plus `cancel_requested_at` to batches, with indexes for active attempts, recent history, worker liveness, and due queue items. Do not add key, prompt, URL, page-content, or raw-response fields.
- [ ] Persist the provider-reported prompt/input, completion/output, and total token counts separately; do not infer the reported total from the other two.
- [ ] Re-run `pnpm exec vitest run tests/scoring/ai-overlay.test.ts` and verify migration/idempotence assertions pass.

## Task 2: Bound every retry cycle and record actual provider usage

**Files:** `src/lib/ai-overlay.ts`, `tests/scoring/ai-overlay.test.ts`.

- [ ] Add failing fake-provider tests for: transient failures, malformed/empty responses, 429, success after retry, missing usage, provider-reported usage/cost, and explicit retry beginning a new cycle.
- [ ] Run `pnpm exec vitest run tests/scoring/ai-overlay.test.ts` and confirm the cap/usage assertions fail.
- [ ] Make each outbound call create one durable attempt record and consume one attempt from the current cycle. Enforce three calls for all errors; set bounded exponential retry times, use `Retry-After` for 429, and mark exhausted items failed without requeueing.
- [ ] Parse only provider-returned token/cost fields; missing/malformed values remain null (“unknown”). Finish the attempt row on success, HTTP error, parse error, timeout, or abort using sanitized codes only.
- [ ] Re-run the focused test file and verify exact call counts, persisted cycle state, and usage redaction.

## Task 3: Make cancellation cross-container and make scan deletion remove all AI work

**Files:** `src/lib/ai-overlay.ts`, `src/lib/repositories.ts`, `src/worker/ai.ts`, `src/app/api/scans/[jobId]/route.ts`, `tests/integration/scans-api.test.ts`, focused AI lifecycle tests.

- [ ] Add failing tests for deletion in every batch/item state, request-start/deletion races, in-flight abort, and completion arriving after cancellation.
- [ ] Run `pnpm exec vitest run tests/integration/scans-api.test.ts tests/scoring/ai-overlay.test.ts` and confirm the new tests fail.
- [ ] Register an `AbortController` per active attempt. Before sending, re-read the run, batch, item, provider enabled state, and snapshot validity. While a request is active, poll its durable attempt cancellation state at most once per second; update worker liveness on the same cadence.
- [ ] In scan deletion, first write cancellation to every matching attempt, then in the same deletion workflow remove **all** AI items and batches for every run of that scan regardless of status. Redact run/batch/item/provider-config IDs from retained attempt rows. Keep scan deletion’s existing eligibility/publication safeguards unchanged.
- [ ] Ensure abort/completion handlers update only rows that still exist and remain valid; a deleted or cancelled item can never be recreated, retried, or completed by a late response. A canceled attempt remains visible as de-identified audit state until the Worker confirms abort/end.
- [ ] Re-run the focused tests; assert unrelated scans, reports, and completed results outside the deleted scan are unchanged.

## Task 4: Invalidate stale provider/model work and make pause/resume explicit

**Files:** `src/lib/ai-overlay.ts`, `src/app/api/ai/providers/[providerId]/route.ts`, `src/app/api/ai/batches/[batchId]/route.ts`, `src/app/api/runs/[runId]/ai-review/route.ts`, AI lifecycle integration tests.

- [ ] Add failing tests for provider edit/disable/delete, model switch, valid pause/resume, stale resume rejection, and one-active-batch-per-scan.
- [ ] On a material provider snapshot change, disable, or deletion, persist cancellation for old in-flight requests, cancel old work, and clear unresolved queued/failed/running items. Preserve completed AI judgments and all manual/report data. Do not transfer old work to the new provider.
- [ ] On explicit start with a different model, cancel stale nonterminal batches for that run before creating/reusing a single batch for the new snapshot. Reject start/resume if the source scan is absent or immutable.
- [ ] Pause stops claims and requests abort while retaining eligible queued items; explicit resume requires the same valid scan and provider snapshot and preserves the cycle’s consumed attempts. If the budget is already exhausted, fail without sending another request. Explicit retry starts a new cycle only for failed items and reports how many items will be retried.
- [ ] Re-run focused AI/scans integration tests and verify edits that do not materially change a snapshot do not create duplicate batches or reset attempts.

## Task 5: Add the admin-only, read-only Worker monitor

**Files:** new `src/app/api/ai/worker/route.ts`, new `src/app/settings/ai/worker/page.tsx` and client component, `src/app/settings/ai/ai-settings-client.tsx`, `src/app/layout.tsx`, `src/lib/i18n.ts`, new monitor integration tests.

- [ ] Add failing route tests for auth, response redaction, worker-offline detection, active-call/cost summaries, and repeated GETs with no database writes or provider calls.
- [ ] Before writing Next.js route/page code, read the relevant guide under `node_modules/next/dist/docs/` as required by `AGENTS.md`.
- [ ] Implement a `requireRequestRole(request, "admin")` GET endpoint that returns live worker/slot state, current calls and elapsed time, per-scan/provider batch counts, recent sanitized attempts, and provider-reported usage/cost only. Treat missing usage/cost as unknown; do not expose API keys, prompt/page content, raw response, or sensitive URLs.
- [ ] Identify active work by scan ID and safe display label (host only; no path/query), model, batch, and slot. Consider a worker online only while its heartbeat is no more than 10 seconds old.
- [ ] Add an admin-protected page with localized Chinese/English labels and a link from AI settings. Poll the GET endpoint only; do not add start/resume side effects or controls that can enqueue work.
- [ ] Run `pnpm exec vitest run tests/integration/ai-worker-monitor.test.ts` and verify role denial, redaction, and read-only polling.

## Task 6: Focused regression checks and local Docker verification

**Files:** relevant tests and, only if needed, a small isolated test-compose configuration.

- [ ] Run the targeted lifecycle set: `pnpm exec vitest run tests/scoring/ai-overlay.test.ts tests/integration/scans-api.test.ts tests/integration/ai-worker-monitor.test.ts`.
- [ ] Run `pnpm lint` and `pnpm typecheck`; fix only failures introduced by this work.
- [ ] Build the application image locally for `linux/amd64`; do not invoke a remote/NAS build.
- [ ] Start an isolated local Compose project with its own database/volumes, Web, and AI Worker. Exercise the fake-provider lifecycle path from the integration harness; verify Worker heartbeat/monitor health, then stop the project and confirm no real-provider call or scan was created.
- [ ] Record exact image tag and local test outcomes for the NAS handoff. Do not include credentials in logs or artifacts.

## Task 7: Back up, transfer, deploy, and verify on NAS over LAN

**Files:** existing NAS Compose/deployment configuration only if image references or commands require adjustment; no Caddy changes.

- [ ] Confirm focused tests, lint, typecheck, local Docker smoke, and `linux/amd64` image build have passed before touching NAS.
- [ ] Create and integrity-check a NAS database backup; record current Web and AI Worker image IDs/tags for rollback.
- [ ] Transfer the locally built app image over the LAN and load it on NAS. Do not build on NAS.
- [ ] Recreate only `web` and `ai-worker` with the same verified image; do not restart `worker`, `egress-proxy`, or Caddy.
- [ ] Verify database migration/integrity, Web health, admin monitor auth/read-only behavior, Worker liveness, and that deleted scans have no AI batches/items. Use only the fake-provider/local test path; do not create a real scan or call a paid API.
- [ ] If health or migration verification fails, restore the recorded Web/AI Worker image tags and leave the database backup intact; report the exact rollback result.
