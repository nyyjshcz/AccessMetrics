# Task 5 implementation report

- Added explicit `remaining` and `all` batch requests with request ID replay protection and distinct batches for deliberate repeated actions.
- Explicit successor batches now invalidate queued, running, and paused predecessors, preserving old item history and preventing stale paused work from resuming.
- Updated lifecycle tests to reuse request IDs for replay assertions and to close newly created active batches so global worker activity cannot leak across tests.
- Focused verification: `pnpm exec vitest run tests/integration/ai-lifecycle.test.ts tests/scoring/ai-overlay.test.ts` — **2 test files passed; 87 tests passed, 0 failed**.
- UI test discovery: no separate AI overlay UI test file is present in `tests/`; no UI test was available to run.

## Fix round 1 report

- Persisted an action ledger in migration 037 to bind each idempotency key to its mode, provider snapshot, and effective source; exact retries now replay the same batch or the exact persisted empty result, while semantic changes under the same key return 409.
- Re-check the current provider snapshot after acquiring the SQLite write transaction; `remaining` source freshness, candidate scope, and request replay are decided within that same transaction.
- Added regression tests for mode/provider conflicts, replay after an empty range's eligibility changes, and legacy action-key backfill. The new regressions failed before the implementation (changed-mode request incorrectly returned 201; changed empty range incorrectly created another 201 batch).
- Verification: `pnpm exec vitest run tests/integration/ai-lifecycle.test.ts tests/scoring/ai-overlay.test.ts` — 2 files, 98 tests passed.
- No separate UI test suite exists. Task 6 remains in progress; no NAS side effects.

## Fix-round-1 re-review

- Verdict: backend idempotency/source transaction fixes accepted; one Important UI source-selection bug remains.
- Reproduction: after batches A then B, selecting provider A can cause `summarizeAiRun` to return historical A while `latestBatchId` is B; the UI checks the displayed batch against latest ID and hides the `remaining` action. Fix must make latest batch the action/progress source independent of selected provider and add A→B→A coverage.
- Task 5 typecheck is also red: explicit action response's empty-or-batch union leaks to legacy callers. Preserve discriminated response typing without weakening strictness. Task 6 owns its separate missing monitor import.
- Next: fix round 2, cover with regression tests and rerun Task 5 suite plus `pnpm typecheck`, then scoped re-review.

## Fix round 2 report

- RED: `pnpm exec vitest run tests/integration/ai-lifecycle.test.ts -t 'uses the latest batch as remaining source'` — 1 failed, 32 skipped; selecting provider A returned historical batch A instead of latest batch B.
- GREEN: the same focused regression command — 1 passed, 32 skipped. Summary/progress now always use the latest scan batch; A→B→A continues using B as the source while the action uses selected provider A.
- Retained concurrent same-request coverage: two `Promise.all` POST replays return the same batch ID and create exactly one batch.
- Added overloads so legacy `createAiBatch` calls return a statically non-empty batch result while explicit actions retain the empty-or-batch union; narrowed explicit test results without casts.
- Focused verification: `pnpm exec vitest run tests/integration/ai-lifecycle.test.ts tests/scoring/ai-overlay.test.ts` — **2 files passed, 98 tests passed**.
- Type check: `pnpm typecheck` reports only the separate Task 6 error `src/app/settings/ai/worker/worker-monitor-client.tsx(405,25): Cannot find name 'formatAiStopReason'.` No Task 5 union errors remain; the Task 6 monitor/import issue was left untouched.

## Fix-round-2 re-review P2

- Added a pretyped explicit-request regression that statically requires the empty-result branch. Before the overload change, `pnpm typecheck` failed at that assertion (`true` was not assignable to `false`), reproducing the finding.
- Put the explicit-action overload before the structurally compatible legacy overload; legacy inputs without `mode` continue to infer the non-empty result.
- Verification: `pnpm exec vitest run tests/scoring/ai-overlay.test.ts -t "retains the empty-result branch for a pretyped explicit batch request"` — 1 passed; `pnpm exec vitest run tests/integration/ai-lifecycle.test.ts tests/scoring/ai-overlay.test.ts` — 2 files, 99 tests passed.
- `pnpm typecheck` now reports only the unrelated Task 6 missing `formatAiStopReason` import. No monitor files, Docker, or NAS were changed or used for this fix.
