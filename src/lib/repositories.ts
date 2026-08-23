import { getDb, transaction } from "./db";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { id } from "./ids";
import type { ScanOptions } from "./domain";
import { catalogEntryWithTags } from "./wcag";
import { AppError } from "./errors";
import { canonicalize, sha256 } from "./canonical";
import { config } from "./config";

const now = () => new Date().toISOString();
export function upsertSite(origin: string, name = origin, category?: string, candidateId?: string) {
  const existing = ((candidateId
    ? getDb().prepare("SELECT * FROM sites WHERE candidate_id=?").get(candidateId)
    : null) ?? getDb().prepare("SELECT * FROM sites WHERE origin=?").get(origin)) as any;
  if (existing) {
    if (category !== undefined || candidateId !== undefined || name !== existing.name)
      getDb()
        .prepare(
          "UPDATE sites SET name=?,category=COALESCE(?,category),candidate_id=COALESCE(?,candidate_id),updated_at=? WHERE id=?",
        )
        .run(name, category ?? null, candidateId ?? null, now(), existing.id);
    return getDb().prepare("SELECT * FROM sites WHERE id=?").get(existing.id) as any;
  }
  const record = {
    id: id("site"),
    origin,
    name,
    category: category ?? null,
    candidate_id: candidateId ?? null,
    created_at: now(),
    updated_at: now(),
  };
  getDb()
    .prepare(
      "INSERT INTO sites(id,origin,name,category,candidate_id,created_at,updated_at) VALUES (@id,@origin,@name,@category,@candidate_id,@created_at,@updated_at)",
    )
    .run(record);
  return record;
}
export function createScanJob(
  origin: string,
  options: ScanOptions,
  requestedBy?: string,
  idempotencyKey?: string,
  submittedUrl?: string,
  studyContext?: {
    campaignId: string;
    slot: number;
    candidateId: string;
    replacementRank: number;
    attemptNo: number;
  },
) {
  const site = upsertSite(origin);
  if (idempotencyKey) {
    const existing = getDb()
      .prepare("SELECT * FROM scan_jobs WHERE idempotency_key=?")
      .get(idempotencyKey) as any;
    if (existing) {
      if (
        existing.submitted_url !== (submittedUrl ?? origin) ||
        existing.options_json !== JSON.stringify(options)
      )
        throw new AppError("IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同请求", 409);
      return { ...existing, site, reused: true };
    }
  }
  const job = {
    id: id("job"),
    site_id: site.id,
    status: "queued",
    options_json: JSON.stringify(options),
    max_pages: options.maxPages,
    request_id: crypto.randomUUID(),
    requested_by: requestedBy ?? null,
    idempotency_key: idempotencyKey ?? null,
    submitted_url: submittedUrl ?? origin,
    normalized_url: origin,
    study_campaign_id: studyContext?.campaignId ?? null,
    study_slot: studyContext?.slot ?? null,
    study_candidate_id: studyContext?.candidateId ?? null,
    study_replacement_rank: studyContext?.replacementRank ?? null,
    study_attempt_no: studyContext?.attemptNo ?? null,
    created_at: now(),
  };
  getDb()
    .prepare(
      "INSERT INTO scan_jobs(id,site_id,status,options_json,max_pages,request_id,requested_by,idempotency_key,submitted_url,normalized_url,study_campaign_id,study_slot,study_candidate_id,study_replacement_rank,study_attempt_no,created_at) VALUES (@id,@site_id,@status,@options_json,@max_pages,@request_id,@requested_by,@idempotency_key,@submitted_url,@normalized_url,@study_campaign_id,@study_slot,@study_candidate_id,@study_replacement_rank,@study_attempt_no,@created_at)",
    )
    .run(job);
  return { ...job, site };
}
export function getJob(jobId: string) {
  return getDb()
    .prepare(
      "SELECT j.*,s.origin,s.name FROM scan_jobs j JOIN sites s ON s.id=j.site_id WHERE j.id=?",
    )
    .get(jobId) as any;
}
export function createRun(job: any) {
  const existing = getDb().prepare("SELECT * FROM scan_runs WHERE job_id=?").get(job.id) as any;
  if (existing) return existing;
  const run = {
    id: id("run"),
    job_id: job.id,
    site_id: job.site_id,
    scanner_version: "accesscheck-scanner-v1",
    axe_version: "4.13.0",
    catalog_version: "wcag-2.2-axe-4.13.0-v1",
    score_model_version: "accesscheck-score-v1",
    rule_catalog_hash: crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(process.cwd(), "scoring", "axe-rule-catalog.json")))
      .digest("hex"),
    config_snapshot_json: JSON.stringify({
      jobOptions: job.options_json ? JSON.parse(job.options_json) : {},
      scanner: {
        maxPages: config.SCAN_MAX_PAGES,
        timeoutMs: config.SCAN_TIMEOUT_MS,
        delayMs: config.SCAN_DELAY_MS,
        retryCount: config.SCAN_RETRY_COUNT,
        maxDepth: config.MAX_CRAWL_DEPTH,
        maxSiteDurationMs: config.MAX_SITE_DURATION_MS,
        proxyConfigured: Boolean(config.EGRESS_PROXY_URL),
        proxyPolicyVersion: "destination-policy-v1",
        dnsResolverMode: config.DNS_RESOLVER_MODE,
        dnsOverHttpsEndpoint:
          config.DNS_RESOLVER_MODE === "doh" ? (config.DNS_OVER_HTTPS_URL ?? null) : null,
      },
    }),
    viewport_json: JSON.stringify({ width: 1280, height: 720 }),
    user_agent: null,
    scan_time_localization_hash: (() => {
      const localization = path.join(process.cwd(), "scoring", "rule-localizations.zh-CN.json");
      return fs.existsSync(localization)
        ? crypto.createHash("sha256").update(fs.readFileSync(localization)).digest("hex")
        : null;
    })(),
    started_at: now(),
    created_at: now(),
    status: "running",
  };
  getDb()
    .prepare(
      "INSERT INTO scan_runs(id,job_id,site_id,scanner_version,axe_version,catalog_version,score_model_version,rule_catalog_hash,config_snapshot_json,viewport_json,user_agent,scan_time_localization_hash,started_at,created_at,status) VALUES (@id,@job_id,@site_id,@scanner_version,@axe_version,@catalog_version,@score_model_version,@rule_catalog_hash,@config_snapshot_json,@viewport_json,@user_agent,@scan_time_localization_hash,@started_at,@created_at,@status)",
    )
    .run(run);
  return run;
}
export function addDiscoveredPages(jobId: string, siteId: string, urls: string[]) {
  transaction((db) => {
    const current = db
      .prepare(
        "SELECT COALESCE(MAX(discovery_order) + 1, 0) AS next_order FROM job_pages WHERE job_id=?",
      )
      .get(jobId) as { next_order: number };
    let nextOrder = current.next_order;
    urls.forEach((url) => {
      const existing = db
        .prepare("SELECT id FROM job_pages WHERE job_id=? AND normalized_url=?")
        .get(jobId, url) as { id: string } | undefined;
      if (existing) return;
      const pageId = id("page");
      const jobPageId = id("jobpage");
      db.prepare(
        "INSERT INTO pages(id,site_id,canonical_url,normalized_url,requested_url,first_seen_at,created_at) VALUES (?,?,?,?,?,?,?)",
      ).run(pageId, siteId, url, url, url, now(), now());
      db.prepare(
        "INSERT INTO job_pages(id,job_id,page_id,requested_url,normalized_url,discovery_order,status,created_at,updated_at) VALUES (?,?,?,?,?,?, 'discovered',?,?)",
      ).run(jobPageId, jobId, pageId, url, url, nextOrder++, now(), now());
      db.prepare("UPDATE pages SET job_page_id=? WHERE id=?").run(jobPageId, pageId);
    });
  });
}
export function finishJob(jobId: string, status: string, error?: unknown, workerId?: string) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as any).code)
      : error
        ? "JOB_FAILED"
        : null;
  const message = error instanceof Error ? error.message : error ? String(error) : null;
  const changed = workerId
    ? getDb()
        .prepare(
          "UPDATE scan_jobs SET status=?,finished_at=?,error_message=? WHERE id=? AND (worker_id=? OR status='cancelled')",
        )
        .run(status, now(), message ? message.slice(0, 1000) : null, jobId, workerId)
    : getDb()
        .prepare("UPDATE scan_jobs SET status=?,finished_at=?,error_message=? WHERE id=?")
        .run(status, now(), message ? message.slice(0, 1000) : null, jobId);
  if (code && changed.changes === 1)
    getDb().prepare("UPDATE scan_jobs SET error_code=? WHERE id=?").run(code.slice(0, 128), jobId);
}
export function finishRun(
  runId: string,
  status: string,
  counts: { pages: number; success: number; failed: number },
  workerId?: string,
) {
  if (workerId) {
    getDb()
      .prepare(
        "UPDATE scan_runs SET status=?,finished_at=?,page_count=?,success_count=?,failed_count=? WHERE id=? AND EXISTS (SELECT 1 FROM scan_jobs j WHERE j.id=scan_runs.job_id AND (j.worker_id=? OR j.status='cancelled'))",
      )
      .run(status, now(), counts.pages, counts.success, counts.failed, runId, workerId);
    return;
  }
  getDb()
    .prepare(
      "UPDATE scan_runs SET status=?,finished_at=?,page_count=?,success_count=?,failed_count=? WHERE id=?",
    )
    .run(status, now(), counts.pages, counts.success, counts.failed, runId);
}
export function pendingJobs() {
  return getDb()
    .prepare(
      "SELECT j.*,s.origin FROM scan_jobs j JOIN sites s ON s.id=j.site_id WHERE j.status='queued' ORDER BY j.created_at LIMIT 1",
    )
    .all() as any[];
}
export function leaseNextJob(workerId: string) {
  return transaction((db) => {
    const job = db
      .prepare(
        "SELECT j.*,s.origin FROM scan_jobs j JOIN sites s ON s.id=j.site_id WHERE j.status='queued' ORDER BY j.created_at LIMIT 1",
      )
      .get() as any;
    if (!job) return null;
    const started = now();
    const updated = db
      .prepare(
        "UPDATE scan_jobs SET status='running',started_at=?,heartbeat_at=?,worker_id=? WHERE id=? AND status='queued'",
      )
      .run(started, started, workerId, job.id);
    return updated.changes === 1 ? { ...job, status: "running", worker_id: workerId } : null;
  });
}
export function recoverStaleJobs(maxAgeMs = 5 * 60 * 1000) {
  const threshold = new Date(Date.now() - maxAgeMs).toISOString();
  return transaction((db) => {
    const stale = db
      .prepare(
        "SELECT id FROM scan_jobs WHERE status='running' AND (heartbeat_at IS NULL OR heartbeat_at<?) ORDER BY created_at",
      )
      .all(threshold) as Array<{ id: string }>;
    let recovered = 0;
    for (const job of stale) {
      const changed = db
        .prepare(
          "UPDATE scan_jobs SET status='queued',worker_id=NULL,heartbeat_at=NULL WHERE id=? AND status='running' AND (heartbeat_at IS NULL OR heartbeat_at<?)",
        )
        .run(job.id, threshold);
      if (changed.changes !== 1) continue;
      db.prepare(
        "UPDATE job_pages SET status='discovered',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND status IN ('leased','scanning') AND lease_expires_at IS NOT NULL AND lease_expires_at<?",
      ).run(now(), job.id, now());
      recovered++;
    }
    return recovered;
  });
}
export function leaseNextPage(jobId: string, workerId: string) {
  return transaction((db) => {
    const page = db
      .prepare(
        "SELECT jp.*,p.canonical_url FROM job_pages jp JOIN pages p ON p.id=jp.page_id JOIN scan_jobs j ON j.id=jp.job_id WHERE jp.job_id=? AND j.status='running' AND j.worker_id=? AND jp.attempts<? AND (jp.status='discovered' OR (jp.status IN ('leased','scanning') AND jp.lease_expires_at IS NOT NULL AND jp.lease_expires_at<?)) ORDER BY jp.discovery_order LIMIT 1",
      )
      .get(jobId, workerId, config.SCAN_RETRY_COUNT + 1, new Date().toISOString()) as any;
    if (!page) return null;
    const leaseUntil = new Date(Date.now() + 60 * 1000).toISOString();
    const changed = db
      .prepare(
        "UPDATE job_pages SET status='scanning',lease_owner=?,lease_expires_at=?,attempts=attempts+1,attempt_count=attempt_count+1,updated_at=? WHERE job_id=? AND page_id=? AND attempts<? AND EXISTS (SELECT 1 FROM scan_jobs WHERE id=? AND status='running' AND worker_id=?) AND (status='discovered' OR (status IN ('leased','scanning') AND lease_expires_at IS NOT NULL AND lease_expires_at<?))",
      )
      .run(
        workerId,
        leaseUntil,
        now(),
        jobId,
        page.page_id,
        config.SCAN_RETRY_COUNT + 1,
        jobId,
        workerId,
        new Date().toISOString(),
      );
    return changed.changes === 1 ? page : null;
  });
}

/**
 * axe returns one rule object per execution context. A page can therefore
 * contain the same rule in the top document and in one or more frames. The
 * database stores one rule fact per page/result type, so combine those rule
 * objects while retaining every node as frame-level evidence.
 */
export function mergeAxeRuleResults(axe: Record<string, any[]>) {
  return Object.fromEntries(
    Object.entries(axe).map(([type, rules]) => {
      const merged = new Map<string, any>();
      for (const rule of rules ?? []) {
        const existing = merged.get(String(rule.id));
        if (!existing) {
          merged.set(String(rule.id), {
            ...rule,
            nodes: [...(rule.nodes ?? [])],
            tags: [...new Set(rule.tags ?? [])],
          });
          continue;
        }
        existing.nodes.push(...(rule.nodes ?? []));
        existing.tags = [...new Set([...(existing.tags ?? []), ...(rule.tags ?? [])])];
        if (!existing.impact && rule.impact) existing.impact = rule.impact;
      }
      return [type, [...merged.values()]];
    }),
  ) as Record<string, any[]>;
}

export function savePageResult(
  runId: string,
  pageId: string,
  result: any,
  workerId?: string,
  attemptCount = 1,
) {
  const db = getDb();
  const insert = db.prepare(
    "INSERT INTO rule_results(id,run_id,page_id,rule_id,result_type,impact,description,help,help_url,tags_json,node_count,raw_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  const nodeInsert = db.prepare(
    "INSERT INTO result_nodes(id,rule_result_id,ordinal,frame_path_json,frame_url,frame_origin_relation,target_json,html_sanitized,failure_summary,any_json,all_json,none_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  transaction((tx) => {
    const run = tx.prepare("SELECT job_id FROM scan_runs WHERE id=?").get(runId) as
      | { job_id: string }
      | undefined;
    if (!run) throw new AppError("RUN_NOT_FOUND", "scan run 不存在", 404);
    if (workerId) {
      const lease = tx
        .prepare(
          "SELECT status,lease_owner,lease_expires_at FROM job_pages WHERE job_id=? AND page_id=?",
        )
        .get(run.job_id, pageId) as
        | { status: string; lease_owner: string | null; lease_expires_at: string | null }
        | undefined;
      if (
        !lease ||
        lease.status !== "scanning" ||
        lease.lease_owner !== workerId ||
        !lease.lease_expires_at ||
        lease.lease_expires_at <= new Date().toISOString()
      )
        throw new AppError("PAGE_LEASE_LOST", "页面租约已失效，拒绝写入结果", 409);
    }
    // A lease-expiry retry reuses the same run/page identity.  Replace the
    // previous attempt atomically so a completed page can never accumulate
    // duplicate rule facts or fail on the result unique constraint.
    tx.prepare(
      "DELETE FROM result_nodes WHERE rule_result_id IN (SELECT id FROM rule_results WHERE run_id=? AND page_id=?)",
    ).run(runId, pageId);
    tx.prepare("DELETE FROM rule_results WHERE run_id=? AND page_id=?").run(runId, pageId);
    tx.prepare(
      "UPDATE pages SET run_id=?,requested_url=?,final_url=?,normalized_url=?,title=?,http_status=?,content_type=?,load_ms=?,scan_status='success',frame_total=?,same_origin_frame_total=?,cross_origin_frame_total=?,frame_tested_total=?,frame_skipped_total=?,frame_error_count=?,frame_coverage_status=?,frame_coverage_issues_json=?,axe_timestamp=?,axe_test_engine_json=?,axe_test_environment_json=?,axe_tool_options_json=? WHERE id=?",
    ).run(
      runId,
      result.url,
      result.finalUrl,
      result.finalUrl,
      result.title ?? null,
      result.status,
      result.contentType ?? null,
      result.durationMs,
      result.frameCoverage?.frameTotal ?? 0,
      result.frameCoverage?.sameOriginFrameTotal ?? 0,
      result.frameCoverage?.crossOriginFrameTotal ?? 0,
      result.frameCoverage?.frameTestedTotal ?? 0,
      result.frameCoverage?.frameSkippedTotal ?? 0,
      result.frameCoverage?.frameErrorCount ?? 0,
      result.frameCoverage?.status ?? "no_child_frames",
      JSON.stringify(result.frameCoverage?.issues ?? []),
      result.timestamp ?? null,
      JSON.stringify(result.testEngine ?? null),
      JSON.stringify(result.testEnvironment ?? null),
      JSON.stringify(result.axeToolOptions ?? null),
      pageId,
    );
    if (result.testEnvironment?.userAgent) {
      tx.prepare(
        "UPDATE scan_runs SET user_agent=? WHERE id=? AND (user_agent IS NULL OR user_agent='')",
      ).run(String(result.testEnvironment.userAgent), runId);
    }
    for (const [type, rules] of Object.entries(mergeAxeRuleResults(result.axe)))
      for (const rule of rules as any[]) {
        const resultType =
          type === "violations"
            ? "violation"
            : type === "passes"
              ? "pass"
              : type === "incomplete"
                ? "incomplete"
                : "inapplicable";
        const catalog = catalogEntryWithTags(rule.id, rule.tags ?? []);
        const rr = id("rr");
        const rawForStorage =
          resultType === "pass"
            ? { ...rule, nodes: undefined }
            : {
                ...rule,
                nodes: (rule.nodes ?? []).map((node: any) => ({
                  ...node,
                  frameUrl: sanitizeFrameUrl(node.frameUrl),
                  html: typeof node.html === "string" ? node.html.slice(0, 300) : "",
                })),
              };
        insert.run(
          rr,
          runId,
          pageId,
          rule.id,
          resultType,
          rule.impact,
          rule.description,
          rule.help,
          rule.helpUrl,
          JSON.stringify(rule.tags),
          rule.nodes.length,
          JSON.stringify(rawForStorage),
        );
        tx.prepare(
          "UPDATE rule_results SET wcag_criteria_json=?,principles_json=?,wcag_level_json=?,scoring_eligible=?,created_at=? WHERE id=?",
        ).run(
          JSON.stringify(catalog.wcag),
          JSON.stringify(catalog.principles),
          JSON.stringify(catalog.level),
          catalog.scoringEligible ? 1 : 0,
          now(),
          rr,
        );
        if (resultType === "violation" || resultType === "incomplete")
          rule.nodes.forEach((node: any, index: number) => {
            const nodeId = id("node");
            const targetJson = JSON.stringify(node.target);
            const framePath = node.framePath ? [String(node.framePath)] : [];
            const targetHash = sha256(canonicalize({ framePath, target: node.target }));
            nodeInsert.run(
              nodeId,
              rr,
              index,
              JSON.stringify(framePath),
              sanitizeFrameUrl(node.frameUrl),
              node.frameOriginRelation ?? (framePath.length ? "same_origin" : "top"),
              targetJson,
              node.html,
              node.failureSummary ?? null,
              JSON.stringify(node.any),
              JSON.stringify(node.all),
              JSON.stringify(node.none),
            );
            const isViolation = resultType === "violation";
            const effectiveImpact = isViolation ? (node.impact ?? rule.impact ?? "minor") : null;
            const weight =
              effectiveImpact === "critical"
                ? 4
                : effectiveImpact === "serious"
                  ? 3
                  : effectiveImpact === "moderate"
                    ? 2
                    : effectiveImpact === "minor"
                      ? 1
                      : null;
            tx.prepare(
              "UPDATE result_nodes SET target_hash=?,impact=?,effective_impact=?,severity_weight=?,severity_source=?,html_excerpt=?,checks_json=?,created_at=? WHERE id=?",
            ).run(
              targetHash,
              node.impact ?? null,
              effectiveImpact,
              weight,
              isViolation
                ? node.impact
                  ? "node"
                  : rule.impact
                    ? "result"
                    : "default_for_null"
                : null,
              node.html,
              JSON.stringify({ any: node.any, all: node.all, none: node.none }),
              now(),
              nodeId,
            );
          });
      }
    if (workerId) {
      const changed = tx
        .prepare(
          "UPDATE job_pages SET status='completed',attempts=attempts+?,attempt_count=attempt_count+?,last_error=NULL,last_error_code=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND page_id=? AND status='scanning' AND lease_owner=? AND lease_expires_at>?",
        )
        .run(
          Math.max(0, attemptCount - 1),
          Math.max(0, attemptCount - 1),
          now(),
          run.job_id,
          pageId,
          workerId,
          new Date().toISOString(),
        );
      if (changed.changes !== 1)
        throw new AppError("PAGE_LEASE_LOST", "页面租约在提交时失效，拒绝完成结果", 409);
    }
  });
}

function sanitizeFrameUrl(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    return url.toString().slice(0, 2048);
  } catch {
    return null;
  }
}

export function savePageFailure(
  runId: string,
  pageId: string,
  error: unknown,
  workerId?: string,
  attemptCount = 1,
) {
  const value = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as any).code)
      : "SCAN_FAILED";
  transaction((db) => {
    const run = db.prepare("SELECT job_id FROM scan_runs WHERE id=?").get(runId) as
      | { job_id: string }
      | undefined;
    if (!run) throw new AppError("RUN_NOT_FOUND", "scan run 不存在", 404);
    if (workerId) {
      const changed = db
        .prepare(
          "UPDATE job_pages SET status='failed',attempts=attempts+?,attempt_count=attempt_count+?,last_error=?,last_error_code=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND page_id=? AND status='scanning' AND lease_owner=? AND lease_expires_at>?",
        )
        .run(
          Math.max(0, attemptCount - 1),
          Math.max(0, attemptCount - 1),
          value.slice(0, 1000),
          code.slice(0, 128),
          now(),
          run.job_id,
          pageId,
          workerId,
          new Date().toISOString(),
        );
      if (changed.changes !== 1)
        throw new AppError("PAGE_LEASE_LOST", "页面租约已失效，拒绝写入失败终态", 409);
    }
    db.prepare(
      "UPDATE pages SET run_id=?,scan_status='failed',error_code=?,error_message=? WHERE id=?",
    ).run(runId, code, value.slice(0, 1000), pageId);
  });
}

export function markExhaustedPages(runId: string, jobId: string) {
  const limit = config.SCAN_RETRY_COUNT + 1;
  return transaction((db) => {
    const timestamp = now();
    const changed = db
      .prepare(
        "UPDATE job_pages SET status='failed',last_error='page lease exceeded retry limit',last_error_code='RETRY_EXHAUSTED',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND status IN ('discovered','leased','scanning') AND attempts>=?",
      )
      .run(timestamp, jobId, limit);
    db.prepare(
      "UPDATE pages SET run_id=?,scan_status='failed',error_code='RETRY_EXHAUSTED',error_message='page lease exceeded retry limit' WHERE job_page_id IN (SELECT id FROM job_pages WHERE job_id=? AND status='failed' AND last_error_code='RETRY_EXHAUSTED') AND (run_id IS NULL OR run_id=?)",
    ).run(runId, jobId, runId);
    return changed.changes;
  });
}
