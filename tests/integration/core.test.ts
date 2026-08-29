import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { AppError, errorEnvelope } from "@/lib/errors";
import { sanitizeNodeHtml } from "@/lib/sanitize";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "accesscheck-test-"));
process.env.DATABASE_URL = path.join(testRoot, "test.db");
process.env.PRIVATE_EVIDENCE_ROOT = path.join(testRoot, "private");
process.env.PUBLIC_EXPORT_ROOT = path.join(testRoot, "public");

const dbModule = await import("@/lib/db");
const repositories = await import("@/lib/repositories");
const runScore = await import("@/lib/run-score");

describe("database and evidence chain", () => {
  beforeAll(() => dbModule.migrate());
  afterAll(() => dbModule.closeDb());

  it("creates a site/job and uses a single atomic job lease", () => {
    const job = repositories.createScanJob("https://example.test", {
      maxPages: 2,
      sameOriginOnly: true,
      respectRobots: true,
    });
    const first = repositories.leaseNextJob("worker-a");
    const second = repositories.leaseNextJob("worker-b");
    expect(first?.id).toBe(job.id);
    expect(second).toBeNull();
    expect(
      (dbModule.getDb().pragma("foreign_keys") as Array<{ foreign_keys: number }>)[0].foreign_keys,
    ).toBe(1);
  });

  it("keeps discovered page identity per job and exposes plan-level trace columns", () => {
    const site = repositories.upsertSite("https://pages.example");
    const first = repositories.createScanJob("https://pages.example", {
      maxPages: 1,
      sameOriginOnly: true,
      respectRobots: true,
    });
    const second = repositories.createScanJob("https://pages.example", {
      maxPages: 1,
      sameOriginOnly: true,
      respectRobots: true,
    });
    repositories.addDiscoveredPages(first.id, site.id, ["https://pages.example/a"]);
    repositories.addDiscoveredPages(first.id, site.id, ["https://pages.example/b"]);
    repositories.addDiscoveredPages(second.id, site.id, ["https://pages.example/a"]);
    const rows = dbModule
      .getDb()
      .prepare(
        "SELECT jp.job_id,jp.id AS job_page_id,p.id AS page_id,p.job_page_id AS page_job_page_id FROM job_pages jp JOIN pages p ON p.id=jp.page_id WHERE jp.job_id IN (?,?) ORDER BY jp.job_id",
      )
      .all(first.id, second.id) as Array<{
      job_id: string;
      job_page_id: string;
      page_id: string;
      page_job_page_id: string;
    }>;
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.page_id)).size).toBe(3);
    expect(rows.every((row) => row.job_page_id === row.page_job_page_id)).toBe(true);
  });

  it("merges a redirect duplicate without aborting the job", () => {
    const db = dbModule.getDb();
    const site = repositories.upsertSite("https://redirect-duplicate.example");
    const job = repositories.createScanJob(site.origin, {
      maxPages: 2,
      sameOriginOnly: true,
      respectRobots: true,
    });
    const workerId = "redirect-duplicate-worker";
    db.prepare("UPDATE scan_jobs SET status='running',worker_id=?,heartbeat_at=? WHERE id=?").run(
      workerId,
      new Date().toISOString(),
      job.id,
    );
    const run = repositories.createRun(job);
    repositories.addDiscoveredPages(job.id, site.id, [
      "https://redirect-duplicate.example/first",
      "https://redirect-duplicate.example/second",
    ]);
    const result = (url: string) => ({
      url,
      finalUrl: "https://redirect-duplicate.example/final",
      title: "redirect fixture",
      status: 200,
      durationMs: 1,
      axe: { passes: [], violations: [], incomplete: [], inapplicable: [] },
    });

    const first = repositories.leaseNextPage(job.id, workerId)!;
    expect(repositories.savePageResult(run.id, first.page_id, result(first.canonical_url), workerId)).toMatchObject({
      status: "saved",
    });
    const second = repositories.leaseNextPage(job.id, workerId)!;
    expect(
      repositories.savePageResult(run.id, second.page_id, result(second.canonical_url), workerId),
    ).toMatchObject({ status: "deduplicated", finalUrl: "https://redirect-duplicate.example/final" });

    expect(
      db.prepare("SELECT COUNT(*) count FROM pages WHERE run_id=?").get(run.id),
    ).toMatchObject({ count: 1 });
    expect(
      db
        .prepare(
          "SELECT jp.status,p.scan_status,p.run_id FROM job_pages jp JOIN pages p ON p.id=jp.page_id WHERE jp.job_id=? ORDER BY jp.discovery_order",
        )
        .all(job.id),
    ).toEqual([
      { status: "completed", scan_status: "success", run_id: run.id },
      { status: "completed", scan_status: "skipped", run_id: null },
    ]);
  });

  it("persists a scan result, exact score, manifest and privacy report", () => {
    const db = dbModule.getDb();
    const site = repositories.upsertSite("https://score.example");
    const job = repositories.createScanJob("https://score.example", {
      maxPages: 1,
      sameOriginOnly: true,
      respectRobots: true,
    });
    const run = repositories.createRun({ id: job.id, site_id: site.id });
    const pageId = "page_test_1";
    db.prepare("INSERT INTO pages(id,site_id,canonical_url,first_seen_at) VALUES (?,?,?,?)").run(
      pageId,
      site.id,
      "https://score.example/",
      new Date().toISOString(),
    );
    repositories.savePageResult(run.id, pageId, {
      url: "https://score.example/",
      finalUrl: "https://score.example/",
      title: "fixture",
      status: 200,
      durationMs: 10,
      axe: {
        passes: [
          {
            id: "image-alt",
            impact: null,
            tags: ["wcag111"],
            description: "",
            help: "",
            helpUrl: "https://example.test",
            nodes: [
              { html: "<img alt=ok>", target: ["img"], any: [], all: [], none: [] },
              { html: "<img alt=ok>", target: ["img:nth-child(2)"], any: [], all: [], none: [] },
            ],
          },
        ],
        violations: [
          {
            id: "image-alt",
            impact: "critical",
            tags: ["wcag111"],
            description: "",
            help: "",
            helpUrl: "https://example.test",
            nodes: [
              {
                framePath: "frame-0",
                frameUrl: "https://user:secret@frame.example/path",
                frameOriginRelation: "cross_origin",
                html: "<img>",
                target: ["img:nth-child(3)"],
                any: [],
                all: [],
                none: [],
              },
            ],
          },
        ],
        incomplete: [],
        inapplicable: [],
      },
    });
    const score = runScore.persistRunScores(run.id);
    expect(score.overall).toBe(66.7);
    const storedNode = db
      .prepare(
        "SELECT effective_impact,severity_weight,severity_source,frame_url,frame_origin_relation,frame_path_json,target_hash FROM result_nodes LIMIT 1",
      )
      .get() as {
      effective_impact: string;
      severity_weight: number;
      severity_source: string;
      frame_url: string;
      frame_origin_relation: string;
      frame_path_json: string;
      target_hash: string;
    };
    expect(storedNode).toEqual({
      effective_impact: "critical",
      severity_weight: 4,
      severity_source: "result",
      frame_url: "https://frame.example/path",
      frame_origin_relation: "cross_origin",
      frame_path_json: '["frame-0"]',
      target_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(
      (
        db.prepare("SELECT weighted_defects FROM page_scores WHERE page_id=?").get(pageId) as {
          weighted_defects: number;
        }
      ).weighted_defects,
    ).toBe(4);
    const nodeId = (db.prepare("SELECT id FROM result_nodes LIMIT 1").get() as { id: string }).id;
    db.prepare(
      "INSERT INTO manual_reviews(id,result_node_id,sample_id,review_context,reviewer,verdict,note,revision,is_current,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run(
      "adhoc-core-review",
      nodeId,
      null,
      "ad_hoc",
      "computer_lead",
      "uncertain",
      "fixture",
      1,
      1,
      new Date().toISOString(),
    );
    expect(() =>
      db
        .prepare(
          "INSERT INTO manual_reviews(id,result_node_id,sample_id,review_context,reviewer,verdict,note,revision,is_current,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          "duplicate-current-adhoc",
          nodeId,
          null,
          "ad_hoc",
          "computer_lead",
          "confirmed",
          "duplicate fixture",
          1,
          1,
          new Date().toISOString(),
        ),
    ).toThrow();
  });

  it("merges duplicate axe rules from multiple execution contexts", () => {
    const db = dbModule.getDb();
    const site = repositories.upsertSite("https://frame-merge.example");
    const job = repositories.createScanJob("https://frame-merge.example", {
      maxPages: 1,
      sameOriginOnly: true,
      respectRobots: true,
    });
    const run = repositories.createRun({ id: job.id, site_id: site.id });
    const pageId = "page_frame_merge";
    db.prepare("INSERT INTO pages(id,site_id,canonical_url,first_seen_at) VALUES (?,?,?,?)").run(
      pageId,
      site.id,
      "https://frame-merge.example/",
      new Date().toISOString(),
    );
    const rule = (target: string[], framePath?: string) => ({
      id: "color-contrast",
      impact: "serious",
      tags: ["wcag143"],
      description: "contrast",
      help: "contrast",
      helpUrl: "https://example.test/color-contrast",
      nodes: [
        {
          framePath,
          frameUrl: framePath ? "https://frame-merge.example/frame" : undefined,
          target,
          html: "<p>text</p>",
          any: [],
          all: [],
          none: [],
        },
      ],
    });
    repositories.savePageResult(run.id, pageId, {
      url: "https://frame-merge.example/",
      finalUrl: "https://frame-merge.example/",
      title: "fixture",
      status: 200,
      durationMs: 10,
      axe: {
        passes: [],
        violations: [rule(["p"]), rule(["iframe", "p"], "frame-0")],
        incomplete: [],
        inapplicable: [],
      },
    });
    expect(
      (
        db.prepare("SELECT COUNT(*) AS count FROM rule_results WHERE run_id=?").get(run.id) as {
          count: number;
        }
      ).count,
    ).toBe(1);
    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM result_nodes WHERE rule_result_id IN (SELECT id FROM rule_results WHERE run_id=?)",
          )
          .get(run.id) as { count: number }
      ).count,
    ).toBe(2);
  });

  it("creates a server-side request id for unified error envelopes", () => {
    const envelope = errorEnvelope(new AppError("BAD_INPUT", "invalid"));
    expect(envelope.error.code).toBe("BAD_INPUT");
    expect(envelope.error.requestId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("sanitizes and bounds stored node HTML excerpts", () => {
    const value = sanitizeNodeHtml(`<div onclick="steal()">${"x".repeat(400)}</div>`);
    expect(value).not.toContain("onclick");
    expect(value.length).toBeLessThanOrEqual(300);
    expect(sanitizeNodeHtml(`<div>${"x".repeat(400)}</div>`, 600).length).toBeGreaterThan(300);
  });
});
