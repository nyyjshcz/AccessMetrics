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
            nodes: [{ html: "<img>", target: ["img:nth-child(3)"], any: [], all: [], none: [] }],
          },
        ],
        incomplete: [],
        inapplicable: [],
      },
    });
    const score = runScore.persistRunScores(run.id);
    expect(score.overall).toBe(66.7);
    const storedNode = db
      .prepare("SELECT effective_impact,severity_weight,severity_source FROM result_nodes LIMIT 1")
      .get() as { effective_impact: string; severity_weight: number; severity_source: string };
    expect(storedNode).toEqual({
      effective_impact: "critical",
      severity_weight: 4,
      severity_source: "result",
    });
    expect(
      (
        db.prepare("SELECT weighted_defects FROM page_scores WHERE page_id=?").get(pageId) as {
          weighted_defects: number;
        }
      ).weighted_defects,
    ).toBe(4);
    const exported = exportModule.exportRun(run.id);
    expect(fs.existsSync(path.join(exported.target, "manifest.json"))).toBe(true);
    const report = privacy.scanPublicationDirectory(exported.target, exported.exportId);
    expect(report.passed).toBe(true);
    expect(zip.zipDirectory(exported.target).byteLength).toBeGreaterThan(50);
  });

  it("requires 10–20 planned slots and never fabricates a campaign", () => {
    expect(() => study.createCampaign({ targetSiteCount: 2, slots: [] })).toThrow("10–20");
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
