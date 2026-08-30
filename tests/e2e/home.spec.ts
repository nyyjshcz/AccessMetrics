import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const baseUrl = "http://127.0.0.1:3100";
const adminAccessKey = "e2e-admin-access-key-01234567890123456789";
const visitorAccessKey = "e2e-visitor-access-key-01234567890123456789";

async function signIn(page: Page, accessKey: string, nextPath = "/") {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
  await page.getByLabel("访问密钥").fill(accessKey);
  await page.getByRole("button", { name: "进入系统" }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
}

function setE2eJobStatus(jobId: string, status: string) {
  const db = new Database(path.join(process.cwd(), "data/e2e-accesscheck-local.db"));
  try {
    db.pragma("busy_timeout = 5000");
    db.prepare("UPDATE scan_jobs SET status=?,finished_at=? WHERE id=?").run(
      status,
      new Date().toISOString(),
      jobId,
    );
  } finally {
    db.close();
  }
}

function runWorkerOnce() {
  return new Promise<void>((resolve, reject) => {
    const worker = spawn(
      process.execPath,
      [path.join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "src/worker/index.ts", "--once"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          APP_ENV: "test",
          APP_BASE_URL: baseUrl,
          DATABASE_URL: "./data/e2e-accesscheck-local.db",
          PRIVATE_EVIDENCE_ROOT: "./data/e2e-private",
          PUBLIC_EXPORT_ROOT: "./data/e2e-exports",
          SESSION_SECRET: "e2e-session-secret-01234567890123456789",
          ADMIN_ACCESS_KEY: adminAccessKey,
          VISITOR_ACCESS_KEY: visitorAccessKey,
          DNS_RESOLVER_MODE: "system",
          SCAN_TEST_ALLOW_PRIVATE_ADDRESSES: "1",
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    worker.stderr.on("data", (chunk) => (stderr += String(chunk)));
    worker.on("error", reject);
    worker.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`worker exited with ${code}: ${stderr}`)),
    );
  });
}

async function startFixture() {
  const fixture = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(
      '<!doctype html><html lang="zh"><head><title>E2E 本地页面</title></head><body><h1>本地 fixture</h1><img src="/missing.png"><button></button><p>本地扫描内容</p></body></html>',
    );
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("fixture 未取得端口");
  return { fixture, url: `http://127.0.0.1:${address.port}/` };
}

test("管理员登录后可访问扫描管理页面", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "输入访问密钥" })).toBeVisible();
  await signIn(page, adminAccessKey);
  await expect(
    page.getByRole("heading", { name: "把网站无障碍问题，一步步变成可发布的报告" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "新建扫描" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "活动任务", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "已发布报告", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "AI 设置", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "新建扫描" }).first().click();
  await expect(page).toHaveURL(/\/scans\/new$/);
  await expect(page.getByRole("heading", { name: "扫描一个公开网站" })).toBeVisible();
  await expect(page.getByLabel("网站 URL")).toBeVisible();
  await expect(page.getByLabel("最多扫描页面数")).toBeVisible();

  for (const pathname of ["/", "/scans/new", "/settings/ai", "/?view=active", "/?view=published"]) {
    const response = await page.request.get(pathname);
    expect(response.ok(), pathname).toBeTruthy();
  }
  const adminScans = await page.request.get("/api/scans?view=active");
  expect(adminScans.ok()).toBeTruthy();
});

test("活动任务只为已结束任务显示删除按钮并可删除", async ({ page }) => {
  await signIn(page, adminAccessKey);
  const port = 40000 + (Date.now() % 10000);
  const terminalUrl = `http://127.0.0.1:${port}/`;
  const queuedUrl = `http://127.0.0.1:${port + 1}/`;
  const create = async (url: string) => {
    const response = await page.request.post("/api/scans", {
      data: { url, maxPages: 1, sameOriginOnly: true, respectRobots: true },
    });
    expect(response.ok()).toBeTruthy();
    return (await response.json()) as { jobId: string };
  };

  const terminal = await create(terminalUrl);
  const queued = await create(queuedUrl);
  setE2eJobStatus(terminal.jobId, "failed");

  try {
    await page.goto("/?view=active");
    const terminalRow = page.locator(".run-row", { hasText: new URL(terminalUrl).origin });
    const queuedRow = page.locator(".run-row", { hasText: new URL(queuedUrl).origin });
    await expect(terminalRow.getByRole("button", { name: "删除" })).toBeVisible();
    await expect(queuedRow.getByRole("button", { name: "删除" })).toHaveCount(0);

    page.once("dialog", (dialog) => dialog.accept());
    const deleted = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/scans/${terminal.jobId}`) &&
        response.request().method() === "DELETE",
    );
    await terminalRow.getByRole("button", { name: "删除" }).click();
    expect((await deleted).ok()).toBeTruthy();
    await expect(terminalRow).toHaveCount(0);
  } finally {
    setE2eJobStatus(queued.jobId, "cancelled");
    const cleanup = await page.request.delete(`/api/scans/${queued.jobId}`);
    expect(cleanup.ok()).toBeTruthy();
  }
});

test("管理员扫描发布后，访客只能读取已发布报告", async ({ page }) => {
  test.setTimeout(120000);
  const { fixture, url } = await startFixture();
  try {
    await signIn(page, adminAccessKey, "/scans/new");
    await page.goto("/scans/new");
    await page.getByLabel("网站 URL").fill(url);
    await page.getByLabel("最多扫描页面数").fill("1");
    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/scans"),
    );
    await page.getByRole("button", { name: "开始 axe 扫描" }).click();
    const createResponse = await responsePromise;
    expect([200, 202]).toContain(createResponse.status());
    const { jobId } = await createResponse.json();
    expect(jobId).toMatch(/^job_/);
    await expect(page).toHaveURL(new RegExp(`/scans/jobs/${jobId}$`));

    let status = "queued";
    for (let attempt = 0; attempt < 8 && ["queued", "running"].includes(status); attempt++) {
      await runWorkerOnce();
      const jobResponse = await page.request.get(`/api/scans/${jobId}`);
      expect(jobResponse.ok()).toBeTruthy();
      const payload = await jobResponse.json();
      status = payload.job.status;
      if (["queued", "running"].includes(status)) await page.waitForTimeout(250);
    }
    expect(["completed", "completed_with_errors"]).toContain(status);
    await page.reload();
    const resultLink = page.getByRole("link", { name: "查看扫描结果" });
    await expect(resultLink).toBeVisible();
    const runPath = await resultLink.getAttribute("href");
    expect(runPath).toMatch(/^\/scans\/run_/);
    const runId = runPath!.split("/").pop()!;
    await page.goto(runPath!);
    const tabs = page.getByRole("tab");
    await expect(page.getByRole("tablist")).toBeVisible();
    await expect(tabs).toHaveCount(4);
    for (const tabName of ["概览", "自动问题", "incomplete 扫描结果", "报告"]) {
      const tab = tabs.filter({ hasText: new RegExp(`^${tabName}(?: \\(\\d+\\))?$`) });
      await expect(tab).toBeVisible();
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("main")).toBeVisible();
    }
    await page.getByRole("button", { name: "生成并发布报告" }).click();
    await expect(page.getByText("已发布，报告现在为只读")).toBeVisible();

    const publishedRun = await page.request.get(`/api/runs/${runId}`);
    expect(publishedRun.ok()).toBeTruthy();
    expect((await publishedRun.json()).run.published).toBe(1);
    const htmlReport = await page.request.get(`/api/reports/${runId}/html`);
    expect(htmlReport.ok()).toBeTruthy();
    expect(await htmlReport.text()).toContain("AccessCheck");

    await page.context().clearCookies();
    await signIn(page, visitorAccessKey, "/reports");
    await expect(page.getByRole("link", { name: "新建扫描" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "活动任务" })).toHaveCount(0);
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "已发布报告" })).toBeVisible();
    await page.goto("/scans/new");
    await expect(page).toHaveURL(/\/reports$/);
    const deniedActive = await page.request.get("/api/scans?view=active");
    expect(deniedActive.status()).toBe(403);
    const visitorReport = await page.request.get(`/api/reports/${runId}/html`);
    expect(visitorReport.ok()).toBeTruthy();
  } finally {
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
});
