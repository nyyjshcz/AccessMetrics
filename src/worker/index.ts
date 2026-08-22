import {
  config,
  assertPrivateEvidenceRoot,
  assertProductionProxy,
  assertProductionSecrets,
} from "../lib/config";
import { migrate, getDb } from "../lib/db";
import { logger } from "../lib/logger";
import {
  leaseNextJob,
  recoverStaleJobs,
  leaseNextPage,
  getJob,
  createRun,
  addDiscoveredPages,
  finishJob,
  finishRun,
  savePageResult,
  savePageFailure,
} from "../lib/repositories";
import { discoverSite } from "../lib/crawler";
import { scanPage, closeScanner } from "../lib/scan-page";
import { validateTargetUrl, canonicalizeUrl } from "../lib/url-security";
import { persistRunScores } from "../lib/run-score";

async function processJob(job: any) {
  const run = createRun(job);
  if (job.study_campaign_id) {
    const existing = getDb()
      .prepare(
        "SELECT id FROM study_run_attempts WHERE campaign_id=? AND slot=? AND replacement_rank=? AND attempt_no=?",
      )
      .get(job.study_campaign_id, job.study_slot, job.study_replacement_rank, job.study_attempt_no);
    if (!existing)
      (() => {
        const startedAt = new Date().toISOString();
        getDb()
          .prepare(
            "INSERT INTO study_run_attempts(id,campaign_id,slot,candidate_id,replacement_rank,attempt_no,run_id,trigger,terminal_status,usability_decision,started_at,replacement_activated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            `attempt_${run.id}`,
            job.study_campaign_id,
            job.study_slot,
            job.study_candidate_id,
            job.study_replacement_rank,
            job.study_attempt_no,
            run.id,
            "study-run",
            "running",
            "pending",
            startedAt,
            job.study_replacement_rank > 0 ? startedAt : null,
          );
      })();
  }
  const entryUrl = job.submitted_url ?? job.origin;
  await validateTargetUrl(entryUrl);
  const urls = await discoverSite(entryUrl, JSON.parse(job.options_json));
  addDiscoveredPages(job.id, job.site_id, urls);
  let success = 0;
  let failed = 0;
  let pageCount = 0;
  const workerId = `worker-${process.pid}`;
  while (true) {
    const liveStatus = (
      getDb().prepare("SELECT status FROM scan_jobs WHERE id=?").get(job.id) as
        | { status: string }
        | undefined
    )?.status;
    if (liveStatus === "cancelled") break;
    const page = leaseNextPage(job.id, workerId);
    if (!page) break;
    pageCount++;
    getDb()
      .prepare("UPDATE scan_jobs SET heartbeat_at=? WHERE id=? AND status='running'")
      .run(new Date().toISOString(), job.id);
    let completed = false;
    let lastError: unknown;
    let attemptsUsed = 0;
    for (let attempt = 0; attempt <= config.SCAN_RETRY_COUNT; attempt++) {
      attemptsUsed = attempt + 1;
      try {
        const target = await validateTargetUrl(page.canonical_url);
        const result = await scanPage(canonicalizeUrl(target.toString()), config.SCAN_TIMEOUT_MS);
        savePageResult(run.id, page.page_id, result);
        completed = true;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < config.SCAN_RETRY_COUNT)
          await new Promise((resolve) => setTimeout(resolve, Math.min(1000, config.SCAN_DELAY_MS)));
      }
    }
    if (completed) {
      success++;
      getDb()
        .prepare(
          "UPDATE job_pages SET status='completed',attempts=attempts+?,attempt_count=attempt_count+?,updated_at=? WHERE job_id=? AND page_id=?",
        )
        .run(attemptsUsed, attemptsUsed, new Date().toISOString(), job.id, page.page_id);
    } else {
      failed++;
      savePageFailure(run.id, page.page_id, lastError);
      getDb()
        .prepare(
          "UPDATE job_pages SET status='failed',attempts=attempts+?,attempt_count=attempt_count+?,last_error=?,updated_at=? WHERE job_id=? AND page_id=?",
        )
        .run(
          attemptsUsed,
          attemptsUsed,
          String(lastError),
          new Date().toISOString(),
          job.id,
          page.page_id,
        );
      logger.warn(
        { jobId: job.id, runId: run.id, url: page.canonical_url, error: String(lastError) },
        "page scan failed",
      );
    }
  }
  const cancelled =
    (
      getDb().prepare("SELECT status FROM scan_jobs WHERE id=?").get(job.id) as
        | { status: string }
        | undefined
    )?.status === "cancelled";
  finishRun(
    run.id,
    cancelled
      ? "cancelled"
      : failed === pageCount && pageCount > 0
        ? "failed"
        : failed > 0
          ? "completed_with_errors"
          : "completed",
    {
      pages: pageCount,
      success,
      failed,
    },
  );
  if (job.study_campaign_id) {
    const terminalStatus = failed > 0 && success === 0 ? "failed" : "completed";
    getDb()
      .prepare(
        "UPDATE study_run_attempts SET terminal_status=?,usability_decision=?,completed_at=? WHERE campaign_id=? AND slot=? AND replacement_rank=? AND attempt_no=?",
      )
      .run(
        terminalStatus,
        success > 0 ? "included" : "excluded",
        new Date().toISOString(),
        job.study_campaign_id,
        job.study_slot,
        job.study_replacement_rank,
        job.study_attempt_no,
      );
  }
  if (success > 0) persistRunScores(run.id);
  if (!cancelled) finishJob(job.id, failed > 0 && success === 0 ? "failed" : "completed");
  return run.id;
}

async function main() {
  assertPrivateEvidenceRoot();
  assertProductionSecrets();
  assertProductionProxy();
  migrate();
  const once = process.argv.includes("--once");
  do {
    recoverStaleJobs();
    const job = leaseNextJob(`worker-${process.pid}`);
    if (!job) {
      if (once) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    try {
      logger.info({ jobId: job.id }, "scan job started");
      const runId = await processJob(getJob(job.id));
      logger.info({ jobId: job.id, runId }, "scan job finished");
    } catch (error) {
      finishJob(job.id, "failed", error);
      if (job.study_campaign_id) {
        getDb()
          .prepare(
            "UPDATE study_run_attempts SET terminal_status='failed',usability_decision='excluded',decision_reason_code=?,completed_at=? WHERE campaign_id=? AND slot=? AND replacement_rank=? AND attempt_no=? AND terminal_status='running'",
          )
          .run(
            "worker_error",
            new Date().toISOString(),
            job.study_campaign_id,
            job.study_slot,
            job.study_replacement_rank,
            job.study_attempt_no,
          );
      }
      const failedRun = getDb()
        .prepare("SELECT id FROM scan_runs WHERE job_id=? ORDER BY started_at DESC LIMIT 1")
        .get(job.id) as { id: string } | undefined;
      logger.error(
        { jobId: job.id, runId: failedRun?.id, error: String(error) },
        "scan job failed",
      );
    }
  } while (!once);
  await closeScanner();
}
main().catch((error) => {
  logger.error({ error: String(error) }, "worker crashed");
  process.exitCode = 1;
});
