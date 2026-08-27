import { test, expect } from "@playwright/test";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const baseUrl = "http://127.0.0.1:3100";

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

test("首页导航、新建扫描页和匿名页面可访问", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "把网站无障碍问题，一步步变成可发布的报告" })).toBeVisible();
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
    const response = await request.get(pathname);
    expect(response.ok(), pathname).toBeTruthy();
  }
  const anonymousScans = await request.get("/api/scans?view=active");
  expect(anonymousScans.ok()).toBeTruthy();
});

test("匿名本地扫描可查看四标签、发布并公开读取报告", async ({ page, request }) => {
  test.setTimeout(120000);
  const { fixture, url } = await startFixture();
  try {
    await page.goto("/scans/new");
    await page.getByLabel("网站 URL").fill(url);
    await page.getByLabel("最多扫描页面数").fill("1");
    const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/scans"));
    await page.getByRole("button", { name: "开始 axe 扫描" }).click();
    const createResponse = await responsePromise;
    expect([200, 202]).toContain(createResponse.status());
    const { jobId } = await createResponse.json();
    expect(jobId).toMatch(/^job_/);
    await expect(page).toHaveURL(new RegExp(`/scans/jobs/${jobId}$`));

    let status = "queued";
    for (let attempt = 0; attempt < 8 && ["queued", "running"].includes(status); attempt++) {
      await runWorkerOnce();
      const jobResponse = await request.get(`/api/scans/${jobId}`);
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
    for (const tabName of ["概览", "自动问题", "待判断", "报告"]) {
      const tab = tabs.filter({ hasText: new RegExp(`^${tabName}(?: \\(\\d+\\))?$`) });
      await expect(tab).toBeVisible();
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("main")).toBeVisible();
    }
    await page.getByRole("button", { name: "生成并发布报告" }).click();
    await expect(page.getByText("已发布，报告现在为只读")).toBeVisible();

    const publishedRun = await request.get(`/api/runs/${runId}`);
    expect(publishedRun.ok()).toBeTruthy();
    expect((await publishedRun.json()).run.published).toBe(1);
    const htmlReport = await request.get(`/api/reports/${runId}/html`);
    expect(htmlReport.ok()).toBeTruthy();
    expect(await htmlReport.text()).toContain("AccessCheck");
    await page.goto("/?view=published");
    await expect(page.getByRole("heading", { name: "已发布报告" })).toBeVisible();
  } finally {
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
});
