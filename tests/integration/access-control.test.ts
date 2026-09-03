import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(async () => ({
      newPage: async () => ({
        setContent: async () => undefined,
        evaluate: async () => undefined,
        pdf: async () => new Uint8Array([37, 80, 68, 70]),
      }),
      close: async () => undefined,
    })),
  },
}));

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "accesscheck-access-control-"));
const adminAccessKey = "access-control-admin-key-0123456789";
const visitorAccessKey = "access-control-visitor-key-0123456789";

process.env.APP_ENV = "test";
process.env.APP_BASE_URL = "http://localhost:3000";
process.env.DATABASE_URL = path.join(testRoot, "access-control.db");
process.env.PRIVATE_EVIDENCE_ROOT = path.join(testRoot, "private");
process.env.PUBLIC_EXPORT_ROOT = path.join(testRoot, "public");
process.env.SESSION_SECRET = "access-control-test-session-secret-0123456789";
process.env.ADMIN_ACCESS_KEY = adminAccessKey;
process.env.VISITOR_ACCESS_KEY = visitorAccessKey;

const dbModule = await import("@/lib/db");
const repositories = await import("@/lib/repositories");
const loginRoute = await import("@/app/api/auth/login/route");
const scansRoute = await import("@/app/api/scans/route");
const runRoute = await import("@/app/api/runs/[runId]/route");
const reportJsonRoute = await import("@/app/api/reports/[runId]/json/route");
const reportHtmlRoute = await import("@/app/api/reports/[runId]/html/route");
const reportPdfRoute = await import("@/app/api/reports/[runId]/pdf/route");
const publishRoute = await import("@/app/api/runs/[runId]/publish/route");

async function login(accessKey: string, next?: string) {
  const response = await loginRoute.POST(
    new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { Origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ accessKey, next }),
    }),
  );
  return {
    response,
    cookie: response.headers.get("set-cookie")?.split(";", 1)[0] ?? "",
  };
}

function requestWithCookie(url: string, cookie: string) {
  return new Request(url, { headers: { cookie } });
}

describe("administrator and visitor access keys", () => {
  let publishedRunId = "";
  let unpublishedRunId = "";
  let incompleteRunId = "";

  function createFixtureRun(status: "completed" | "running", published = 0) {
    const job = repositories.createScanJob(`https://${status}-${published}.example`, {
      maxPages: 1,
      sameOriginOnly: true,
      respectRobots: true,
    });
    const run = repositories.createRun(job);
    const now = new Date().toISOString();
    dbModule
      .getDb()
      .prepare("UPDATE scan_jobs SET status=?,finished_at=? WHERE id=?")
      .run(status, status === "completed" ? now : null, job.id);
    dbModule
      .getDb()
      .prepare("UPDATE scan_runs SET status=?,published=?,published_at=? WHERE id=?")
      .run(status, published, published ? now : null, run.id);
    return run.id;
  }

  beforeAll(() => {
    dbModule.migrate();
    const job = repositories.createScanJob("https://published-access.example", {
      maxPages: 1,
      sameOriginOnly: true,
      respectRobots: true,
    });
    const run = repositories.createRun(job);
    publishedRunId = run.id;
    dbModule
      .getDb()
      .prepare("UPDATE scan_jobs SET status='completed',finished_at=? WHERE id=?")
      .run(new Date().toISOString(), job.id);
    dbModule
      .getDb()
      .prepare("UPDATE scan_runs SET status='completed',published=1,published_at=? WHERE id=?")
      .run(new Date().toISOString(), run.id);
    dbModule
      .getDb()
      .prepare("UPDATE scan_runs SET crawl_summary_json=? WHERE id=?")
      .run(
        JSON.stringify({
          requestedPageLimit: 3,
          scanTargetCount: 2,
          skippedNotFoundCount: 1,
          stopReason: "queue_exhausted",
        }),
        run.id,
      );
    dbModule
      .getDb()
      .prepare(
        "INSERT INTO pages(id,site_id,canonical_url,first_seen_at,run_id,scan_status,http_status,error_code,error_message) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "page-access-control-failed",
        run.site_id,
        "https://published-access.example/missing",
        new Date().toISOString(),
        run.id,
        "failed",
        500,
        "HTTP_500",
        "页面返回服务器错误",
      );

    unpublishedRunId = createFixtureRun("completed");
    incompleteRunId = createFixtureRun("running");
  });

  afterAll(() => dbModule.closeDb());

  it("issues role-scoped sessions and enforces report-only visitor access", async () => {
    const admin = await login(adminAccessKey, "/scans");
    expect(admin.response.status).toBe(200);
    expect(await admin.response.json()).toMatchObject({ role: "admin", redirectTo: "/scans" });
    expect(admin.cookie).toContain("accesscheck_session=");

    const visitor = await login(visitorAccessKey, "/scans");
    expect(visitor.response.status).toBe(200);
    expect(await visitor.response.json()).toMatchObject({
      role: "visitor",
      redirectTo: "/reports",
    });
    expect(visitor.cookie).toContain("accesscheck_session=");

    const visitorTeam = await login(visitorAccessKey, "/team");
    expect(visitorTeam.response.status).toBe(200);
    expect(await visitorTeam.response.json()).toMatchObject({
      role: "visitor",
      redirectTo: "/team",
    });

    const unauthenticated = await scansRoute.GET(
      new Request("http://localhost:3000/api/scans?view=active"),
    );
    expect(unauthenticated.status).toBe(401);

    const adminActive = await scansRoute.GET(
      requestWithCookie("http://localhost:3000/api/scans?view=active", admin.cookie),
    );
    expect(adminActive.status).toBe(200);

    const visitorActive = await scansRoute.GET(
      requestWithCookie("http://localhost:3000/api/scans?view=active", visitor.cookie),
    );
    expect(visitorActive.status).toBe(403);

    const visitorPublished = await scansRoute.GET(
      requestWithCookie("http://localhost:3000/api/scans?view=published", visitor.cookie),
    );
    expect(visitorPublished.status).toBe(200);
    expect((await visitorPublished.json()).runs).toEqual([
      expect.objectContaining({ run_id: publishedRunId, published: 1 }),
    ]);

    const blockedRun = await runRoute.GET(
      requestWithCookie(`http://localhost:3000/api/runs/${publishedRunId}`, visitor.cookie),
      { params: Promise.resolve({ runId: publishedRunId }) },
    );
    expect(blockedRun.status).toBe(403);

    const report = await reportJsonRoute.GET(
      requestWithCookie(`http://localhost:3000/api/reports/${publishedRunId}/json`, visitor.cookie),
      { params: Promise.resolve({ runId: publishedRunId }) },
    );
    expect(report.status).toBe(200);
    expect((await report.json()).runId).toBe(publishedRunId);
  });

  it("allows admins to export completed unpublished runs but hides them from visitors", async () => {
    const admin = await login(adminAccessKey, "/reports");
    const visitor = await login(visitorAccessKey, "/reports");
    const params = { params: Promise.resolve({ runId: unpublishedRunId }) };

    for (const [route, suffix] of [
      [reportHtmlRoute, "html"],
      [reportJsonRoute, "json"],
      [reportPdfRoute, "pdf"],
    ] as const) {
      const adminResponse = await route.GET(
        requestWithCookie(`http://localhost:3000/api/reports/${unpublishedRunId}/${suffix}`, admin.cookie),
        params,
      );
      expect(adminResponse.status).toBe(200);

      const visitorResponse = await route.GET(
        requestWithCookie(`http://localhost:3000/api/reports/${unpublishedRunId}/${suffix}`, visitor.cookie),
        params,
      );
      expect(visitorResponse.status).toBe(404);
    }
  });

  it("does not export an incomplete run, even for an administrator", async () => {
    const admin = await login(adminAccessKey, "/reports");
    const params = { params: Promise.resolve({ runId: incompleteRunId }) };

    for (const [route, suffix] of [
      [reportHtmlRoute, "html"],
      [reportJsonRoute, "json"],
      [reportPdfRoute, "pdf"],
    ] as const) {
      const response = await route.GET(
        requestWithCookie(`http://localhost:3000/api/reports/${incompleteRunId}/${suffix}`, admin.cookie),
        params,
      );
      expect(response.status).toBe(404);
    }
  });

  it("rejects invalid and cross-origin login attempts", async () => {
    const invalid = await login("not-the-configured-access-key");
    expect(invalid.response.status).toBe(401);
    expect((await invalid.response.json()).error).toMatchObject({ code: "ACCESS_KEY_INVALID" });

    const crossOrigin = await loginRoute.POST(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { Origin: "https://attacker.example", "content-type": "application/json" },
        body: JSON.stringify({ accessKey: adminAccessKey }),
      }),
    );
    expect(crossOrigin.status).toBe(403);
    expect((await crossOrigin.json()).error).toMatchObject({ code: "ORIGIN_MISMATCH" });
  });

  it("exposes crawl summary and page failure details for run results", async () => {
    const admin = await login(adminAccessKey, "/scans");
    const response = await runRoute.GET(
      requestWithCookie(`http://localhost:3000/api/runs/${publishedRunId}`, admin.cookie),
      { params: Promise.resolve({ runId: publishedRunId }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      crawlSummary: {
        requestedPageLimit: 3,
        scanTargetCount: 2,
        skippedNotFoundCount: 1,
        stopReason: "queue_exhausted",
      },
      pages: [
        expect.objectContaining({
          error_code: "HTTP_500",
          error_message: "页面返回服务器错误",
        }),
      ],
    });
  });

  it("restricts report withdrawal and permits an admin to republish", async () => {
    const admin = await login(adminAccessKey, "/scans");
    const visitor = await login(visitorAccessKey, "/reports");
    const params = { params: Promise.resolve({ runId: publishedRunId }) };

    const crossOrigin = await publishRoute.DELETE(
      new Request(`http://localhost:3000/api/runs/${publishedRunId}/publish`, {
        method: "DELETE",
        headers: { Origin: "https://attacker.example", cookie: admin.cookie },
      }),
      params,
    );
    expect(crossOrigin.status).toBe(403);

    const visitorWithdraw = await publishRoute.DELETE(
      requestWithCookie(`http://localhost:3000/api/runs/${publishedRunId}/publish`, visitor.cookie),
      params,
    );
    expect(visitorWithdraw.status).toBe(403);

    const withdrawn = await publishRoute.DELETE(
      requestWithCookie(`http://localhost:3000/api/runs/${publishedRunId}/publish`, admin.cookie),
      params,
    );
    expect(withdrawn.status).toBe(200);

    for (const [route, suffix] of [
      [reportJsonRoute, "json"],
      [reportHtmlRoute, "html"],
      [reportPdfRoute, "pdf"],
    ] as const) {
      const adminResponse = await route.GET(
        requestWithCookie(
          `http://localhost:3000/api/reports/${publishedRunId}/${suffix}`,
          admin.cookie,
        ),
        params,
      );
      expect(adminResponse.status).toBe(200);
    }

    for (const [route, suffix] of [
      [reportJsonRoute, "json"],
      [reportHtmlRoute, "html"],
      [reportPdfRoute, "pdf"],
    ] as const) {
      const response = await route.GET(
        requestWithCookie(
          `http://localhost:3000/api/reports/${publishedRunId}/${suffix}`,
          visitor.cookie,
        ),
        params,
      );
      expect(response.status).toBe(404);
    }

    const republished = await publishRoute.POST(
      new Request(`http://localhost:3000/api/runs/${publishedRunId}/publish`, {
        method: "POST",
        headers: { Origin: "http://localhost:3000", cookie: admin.cookie },
      }),
      params,
    );
    expect(republished.status).toBe(200);

    const visitorReport = await reportHtmlRoute.GET(
      requestWithCookie(`http://localhost:3000/api/reports/${publishedRunId}/html`, visitor.cookie),
      params,
    );
    expect(visitorReport.status).toBe(200);
  });
});
