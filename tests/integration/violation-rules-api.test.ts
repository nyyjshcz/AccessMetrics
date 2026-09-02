import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "accesscheck-violation-rules-"));
process.env.APP_ENV = "test";
process.env.DATABASE_URL = path.join(testRoot, "rules.db");
process.env.PRIVATE_EVIDENCE_ROOT = path.join(testRoot, "private");
process.env.PUBLIC_EXPORT_ROOT = path.join(testRoot, "public");

const dbModule = await import("@/lib/db");
const repositories = await import("@/lib/repositories");
const listRoute = await import("@/app/api/runs/[runId]/violation-rules/route");
const detailRoute = await import("@/app/api/runs/[runId]/violation-rules/[ruleId]/route");

describe("site-wide violation rule APIs", () => {
  let runId = "";
  let detailRule = "";

  beforeAll(() => {
    dbModule.migrate();
    const job = repositories.createScanJob("https://rules-api.example", {
      maxPages: 2,
      sameOriginOnly: true,
      respectRobots: true,
    });
    const run = repositories.createRun(job);
    runId = run.id;
    repositories.addDiscoveredPages(job.id, job.site_id, [
      "https://rules-api.example/one",
      "https://rules-api.example/two",
    ]);
    const db = dbModule.getDb();
    const pages = db.prepare("SELECT id FROM pages WHERE site_id=? ORDER BY canonical_url").all(job.site_id) as Array<{ id: string }>;
    pages.forEach((page, pageIndex) => {
      db.prepare("UPDATE pages SET run_id=?,title=?,scan_status='success' WHERE id=?").run(
        runId,
        `Page ${pageIndex + 1}`,
        page.id,
      );
      const rules = pageIndex === 0 ? ["image-alt", "button-name"] : ["image-alt"];
      rules.forEach((ruleId, ruleIndex) => {
        const rrId = `rr-${pageIndex}-${ruleIndex}`;
        const impact = ruleId === "button-name" ? "serious" : pageIndex === 0 ? "moderate" : "critical";
        db.prepare(
          "INSERT INTO rule_results(id,run_id,page_id,rule_id,result_type,impact,description,help,help_url,tags_json,node_count,raw_json,wcag_criteria_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(rrId, runId, page.id, ruleId, "violation", impact, "desc", "help", "https://dequeuniversity.com/rules/axe/4.13/" + ruleId, "[]", 2, "{}", "[]");
        for (let ordinal = 0; ordinal < 2; ordinal++) {
          const nodeId = `node-${pageIndex}-${ruleIndex}-${ordinal}`;
          const nodeImpact = ruleId === "image-alt" && pageIndex === 0 && ordinal === 1 ? "serious" : impact;
          db.prepare(
            "INSERT INTO result_nodes(id,rule_result_id,ordinal,target_json,html_sanitized,failure_summary,any_json,all_json,none_json,effective_impact,checks_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          ).run(nodeId, rrId, ordinal, JSON.stringify([`#${ruleId}-${ordinal}`]), `<div>${ruleId}</div>`, "Fix it", "[]", "[]", "[]", nodeImpact, JSON.stringify({ any: [], all: [], none: [] }));
        }
        if (!detailRule) detailRule = ruleId;
      });
    });
  });

  afterAll(() => dbModule.closeDb());

  it("returns aggregate rows without node evidence", async () => {
    const response = await listRoute.GET(new Request(`http://localhost/api/runs/${runId}/violation-rules`), {
      params: Promise.resolve({ runId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(2);
    expect(body.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "image-alt", highestImpact: "critical", affectedPageCount: 2, nodeCount: 4 }),
      expect.objectContaining({ ruleId: "button-name", highestImpact: "serious", affectedPageCount: 1, nodeCount: 2 }),
    ]));
    expect(JSON.stringify(body)).not.toContain("selector");
    expect(JSON.stringify(body)).not.toContain("html");
    expect(JSON.stringify(body)).not.toContain("failureSummary");
  });

  it("loads detail evidence only for the requested rule and paginates nodes", async () => {
    const response = await detailRoute.GET(
      new Request(`http://localhost/api/runs/${runId}/violation-rules/${encodeURIComponent(detailRule)}?page=1&pageSize=1`),
      { params: Promise.resolve({ runId, ruleId: detailRule }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rule.id).toBe(detailRule);
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 1, totalNodes: 4, totalPages: 4, hasMore: true });
    expect(body.pages).toHaveLength(1);
    expect(body.pages[0]).toMatchObject({ nodeCount: 2, highestImpact: "serious" });
    expect(body.pages[0].nodes).toHaveLength(1);
    expect(body.pages[0].nodes[0]).toMatchObject({ html: `<div>${detailRule}</div>`, target: [`#${detailRule}-0`] });
  });

  it("rejects invalid pagination and unknown rules", async () => {
    const invalid = await detailRoute.GET(new Request(`http://localhost/api/runs/${runId}/violation-rules/${detailRule}?pageSize=101`), {
      params: Promise.resolve({ runId, ruleId: detailRule }),
    });
    expect(invalid.status).toBe(400);
    const missing = await detailRoute.GET(new Request(`http://localhost/api/runs/${runId}/violation-rules/missing`), {
      params: Promise.resolve({ runId, ruleId: "missing" }),
    });
    expect(missing.status).toBe(404);
  });
});
