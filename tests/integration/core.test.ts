import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { AppError, errorEnvelope } from "@/lib/errors";
import { sanitizeNodeHtml } from "@/lib/sanitize";
import { sha256 } from "@/lib/canonical";
import { validateReceipt, verifyApprovedGate } from "../../scripts/gate-utils";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "accesscheck-test-"));
process.env.DATABASE_URL = path.join(testRoot, "test.db");
process.env.PRIVATE_EVIDENCE_ROOT = path.join(testRoot, "private");
process.env.PUBLIC_EXPORT_ROOT = path.join(testRoot, "public");

const dbModule = await import("@/lib/db");
const repositories = await import("@/lib/repositories");
const runScore = await import("@/lib/run-score");
const exportModule = await import("@/lib/export");
const privacy = await import("@/lib/privacy");
const zip = await import("@/lib/zip");
const study = await import("@/lib/study");

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
    const exported = exportModule.exportRun(run.id);
    expect(fs.existsSync(path.join(exported.target, "manifest.json"))).toBe(true);
    const runExport = JSON.parse(fs.readFileSync(path.join(exported.target, "scan.json"), "utf8"));
    expect(runExport).toMatchObject({
      schemaVersion: "scan-export-v1",
      exportId: exported.exportId,
      site: { id: site.id },
      configSnapshot: expect.any(Object),
      ruleResults: expect.any(Array),
      resultNodes: expect.any(Array),
      pageScores: expect.any(Array),
      reviewRefs: expect.any(Array),
      provenance: expect.any(Object),
    });
    expect(runExport.reviewRefs).toEqual([
      {
        resultNodeId: nodeId,
        finalVerdict: "uncertain",
        resolutionSource: "ad_hoc",
        batchRef: null,
      },
    ]);
    const report = privacy.scanPublicationDirectory(exported.target, exported.exportId);
    expect(report.passed).toBe(true);
    expect(zip.zipDirectory(exported.target).byteLength).toBeGreaterThan(50);
  });

  it("requires 10–20 planned slots and never fabricates a campaign", () => {
    expect(() => study.createCampaign({ targetSiteCount: 2, slots: [] })).toThrow("10–20");
  });

  it("writes idempotent schema-valid gate receipts through the outbox", () => {
    const artifactPath = path.join(testRoot, "private", "gates", "R1", "protocol.md");
    const artifactBytes = Buffer.from("protocol fixture\n");
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, artifactBytes);
    const input = {
      gateId: "R1",
      role: "computer_lead",
      decision: "approved" as const,
      statementVersion: "r1-v1",
      boundCommit: "a".repeat(40),
      artifacts: [{ logicalId: "protocol.md", sha256: sha256(artifactBytes) }],
      note: "本人已核对协议、样本和模型来源，并确认记录可以复核。",
    };
    const first = study.submitGateEvidence(input);
    const second = study.submitGateEvidence({ ...input, role: "math_lead" });
    const retry = study.submitGateEvidence(input);
    expect(retry).toMatchObject({ reused: true, receiptHash: first.receiptHash });
    expect(study.writePendingEvidence(path.join(testRoot, "private"))).toHaveLength(2);
    if (!first.targetRelpath) throw new Error("first gate evidence did not return a target path");
    const receiptPath = path.join(testRoot, "private", first.targetRelpath);
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    expect(validateReceipt(receipt, "R1", "computer_lead").receiptHash).toBe(first.receiptHash);
    expect(
      (
        dbModule
          .getDb()
          .prepare("SELECT status FROM human_gate_evidence_outbox WHERE evidence_id=?")
          .get(first.evidenceId) as { status: string }
      ).status,
    ).toBe("written");
    expect(verifyApprovedGate(path.join(testRoot, "private", "gates"), "R1").selected).toHaveLength(
      2,
    );
    expect(second.receiptHash).not.toBe(first.receiptHash);
  });

  it("neutralizes spreadsheet formula prefixes in CSV cells", () => {
    expect(exportModule.csvCell('=HYPERLINK("https://evil.test")')).toBe(
      '"\'=HYPERLINK(""https://evil.test"")"',
    );
    expect(exportModule.csvCell("normal,comma")).toBe('"normal,comma"');
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
  });
});
