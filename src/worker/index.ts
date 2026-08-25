import { config } from "../lib/config";
import { assertScanWorkerStartup } from "../lib/startup";
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
  markExhaustedPages,
  heartbeatJobAndPage,
} from "../lib/repositories";
import { discoverSite } from "../lib/crawler";
import { scanPage, closeScanner } from "../lib/scan-page";
import { validateTargetUrl, canonicalizeUrl } from "../lib/url-security";
import { persistRunScores } from "../lib/run-score";
import { AppError } from "../lib/errors";

async function processJob(job: any) {
  const run = createRun(job);
  const workerId = `worker-${process.pid}`;
  let activePageId: string | null = null;
  let leaseLost = false;
  const heartbeat = () => {
    const result = heartbeatJobAndPage(job.id, workerId, activePageId);
    if (!result.jobChanged || !result.pageChanged) leaseLost = true;
  };
  // Start the heartbeat before discovery: crawling can be the longest part of
  // a job and must keep both the job and any active page lease alive.
  heartbeat();
  const heartbeatTimer = setInterval(heartbeat, 10_000);
  heartbeatTimer.unref?.();
  try {
    if (job.study_campaign_id) {
      const existing = getDb()
        .prepare(
          "SELECT id FROM study_run_attempts WHERE campaign_id=? AND slot=? AND replacement_rank=? AND attempt_no=?",
        )
        .get(
          job.study_campaign_id,
          job.study_slot,
          job.study_replacement_rank,
          job.study_attempt_no,
        );
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
    if (leaseLost) throw new AppError("JOB_LEASE_LOST", "扫描任务租约已失效", 409);
    addDiscoveredPages(job.id, job.site_id, urls);
    while (true) {
      const liveStatus = (
        getDb().prepare("SELECT status FROM scan_jobs WHERE id=?").get(job.id) as
          | { status: string }
          | undefined
      )?.status;
      if (liveStatus === "cancelled") break;
      const page = leaseNextPage(job.id, workerId);
      if (!page) break;
      activePageId = page.page_id;
      leaseLost = false;
      heartbeat();
      let completed = false;
      let lastError: unknown;
      let attemptsUsed = 0;
      try {
        for (let attempt = 0; attempt <= config.SCAN_RETRY_COUNT; attempt++) {
          attemptsUsed = attempt + 1;
          try {
            const target = await validateTargetUrl(page.canonical_url);
            const result = await scanPage(
              canonicalizeUrl(target.toString()),
              config.SCAN_TIMEOUT_MS,
            );
            if (leaseLost) throw new AppError("PAGE_LEASE_LOST", "页面租约已失效", 409);
            savePageResult(run.id, page.page_id, result, workerId, attemptsUsed);
            completed = true;
            break;
          } catch (error) {
            lastError = error;
            if ((error as { code?: string })?.code === "PAGE_LEASE_LOST") {
              leaseLost = true;
              break;
            }
            if (attempt < config.SCAN_RETRY_COUNT)
              await new Promise((resolve) =>
                setTimeout(resolve, Math.min(1000, config.SCAN_DELAY_MS)),
              );
          }
        }
        if (leaseLost) {
          logger.warn(
            { jobId: job.id, runId: run.id, pageId: page.page_id },
            "page lease lost; retrying",
          );
          continue;
        }
        if (!completed) {
          savePageFailure(run.id, page.page_id, lastError, workerId, attemptsUsed);
          logger.warn(
            { jobId: job.id, runId: run.id, url: page.canonical_url, error: String(lastError) },
            "page scan failed",
          );
        }
      } finally {
        activePageId = null;
      }
    }
    const cancelled =
      (
        getDb().prepare("SELECT status FROM scan_jobs WHERE id=?").get(job.id) as
          | { status: string }
          | undefined
      )?.status === "cancelled";
    const ownership = getDb()
      .prepare("SELECT status,worker_id FROM scan_jobs WHERE id=?")
      .get(job.id) as { status: string; worker_id: string | null } | undefined;
    if (ownership && !cancelled && ownership.worker_id !== workerId) {
      logger.warn(
        { jobId: job.id, runId: run.id },
        "job lease lost; leaving terminal state to current worker",
      );
      return run.id;
    }
    markExhaustedPages(run.id, job.id);
    const persistedCounts = getDb()
      .prepare(
        "SELECT COUNT(*) AS pages,SUM(CASE WHEN scan_status='success' THEN 1 ELSE 0 END) AS success,SUM(CASE WHEN scan_status='failed' THEN 1 ELSE 0 END) AS failed FROM pages WHERE run_id=?",
      )
      .get(run.id) as { pages: number; success: number | null; failed: number | null };
    const storedPageCount = Number(persistedCounts.pages ?? 0);
    const storedSuccess = Number(persistedCounts.success ?? 0);
    const storedFailed = Number(persistedCounts.failed ?? 0);
    finishRun(
      run.id,
      cancelled
        ? "cancelled"
        : storedFailed === storedPageCount && storedPageCount > 0
          ? "failed"
          : storedFailed > 0
            ? "completed_with_errors"
            : "completed",
      {
        pages: storedPageCount,
        success: storedSuccess,
        failed: storedFailed,
      },
      workerId,
    );
    if (job.study_campaign_id) {
      const terminalStatus = storedFailed > 0 && storedSuccess === 0 ? "failed" : "completed";
      getDb()
        .prepare(
          "UPDATE study_run_attempts SET terminal_status=?,usability_decision=?,completed_at=? WHERE campaign_id=? AND slot=? AND replacement_rank=? AND attempt_no=?",
        )
        .run(
          terminalStatus,
          storedSuccess > 0 ? "included" : "excluded",
          new Date().toISOString(),
          job.study_campaign_id,
          job.study_slot,
          job.study_replacement_rank,
          job.study_attempt_no,
        );
    }
    if (storedSuccess > 0) persistRunScores(run.id);
    if (!cancelled)
      finishJob(
        job.id,
        storedFailed > 0 && storedSuccess === 0 ? "failed" : "completed",
        undefined,
        workerId,
      );
    return run.id;
  } finally {
    clearInterval(heartbeatTimer);
  }
}

async function main() {
  assertScanWorkerStartup();
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
      finishJob(job.id, "failed", error, `worker-${process.pid}`);
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
