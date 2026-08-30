import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
});
