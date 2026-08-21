import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";

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
          DATABASE_URL: "./data/e2e-accesscheck.db",
          PRIVATE_EVIDENCE_ROOT: "./data/e2e-private",
          PUBLIC_EXPORT_ROOT: "./data/e2e-exports",
          SESSION_SECRET: "e2e-session-secret-01234567890123456789",
          CSRF_SECRET: "e2e-csrf-secret-012345678901234567890",
          SCAN_ADMIN_TOKEN: "e2e-admin-token",
          COMPUTER_REVIEW_TOKEN: "e2e-computer-token",
          MATH_REVIEW_TOKEN: "e2e-math-token",
          SCAN_TEST_ALLOW_PRIVATE_ADDRESSES: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    worker.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    worker.on("error", reject);
    worker.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`worker exited with ${code}: ${stderr}`));
    });
  });
}

async function csrfCookie(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const value = document.cookie.split("; ").find((item) => item.startsWith("accesscheck_csrf="));
    return value?.slice("accesscheck_csrf=".length) ?? "";
  });
}

async function reviewerCsrfCookie(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const value = document.cookie
      .split("; ")
      .find((item) => item.startsWith("accesscheck_reviewer_csrf="));
    return value?.slice("accesscheck_reviewer_csrf=".length) ?? "";
  });
}

async function appRequest(
  page: import("@playwright/test").Page,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
) {
  return page.evaluate(
    async ({ path, method, headers, body }) => {
      const response = await fetch(path, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
        body: await response.text(),
      };
    },
    { path, ...init },
  );
}
test("home page and health endpoint are reachable", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "网站无障碍扫描与研究平台" })).toBeVisible();
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).status).toBe("ok");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  const anonymousScan = await request.post("/api/scans", {
    data: { url: "https://example.com", maxPages: 1 },
    headers: { "content-type": "application/json" },
  });
  expect([401, 403]).toContain(anonymousScan.status());
});

test("core public and login pages have keyboard labels and no axe violations", async ({ page }) => {
  for (const pathname of ["/", "/admin/login", "/review/login"]) {
    await page.goto(pathname);
    await expect(page.locator("main")).toBeVisible();
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations, `${pathname} axe violations`).toEqual([]);
    if (pathname !== "/") await expect(page.getByRole("textbox")).toHaveCount(1);
  }
});

test("admin, reviewers, publishing and exports complete the fixture flow", async ({
  page,
  browser,
}) => {
  await page.goto("/admin/login");
  await page.getByLabel("管理口令").fill("e2e-admin-token");
  const [loginResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/admin/login")),
    page.getByRole("button", { name: "登录" }).click(),
  ]);
  expect(loginResponse.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/admin\/scans\/new$/);
  const fixture = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(
      '<!doctype html><head><title>E2E fixture</title></head><body><h1>fixture</h1><img src="/missing.png"><button></button></body>',
    );
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", () => resolve()));
  const address = fixture.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await page.getByLabel("网站 URL").fill(`http://127.0.0.1:${port}/`);
  await page.getByLabel("最多页面数（1–15）").fill("1");
  const [scanResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/scans")),
    page.getByRole("button", { name: "创建扫描任务" }).click(),
  ]);
  expect(scanResponse.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/admin\/scans\/job_/);
  await expect(page.getByRole("heading", { name: "扫描任务" })).toBeVisible();
  let jobStatus = "queued";
  for (let attempt = 0; attempt < 5 && jobStatus !== "completed"; attempt++) {
    await runWorkerOnce();
    await page.reload();
    jobStatus = await page.locator(".pill").innerText();
  }
  expect(jobStatus).toBe("completed");
  await expect(page.getByRole("link", { name: "查看扫描结果与评分" })).toBeVisible();
  const runLink = await page.getByRole("link", { name: "查看扫描结果与评分" }).getAttribute("href");
  expect(runLink).toMatch(/^\/scans\/run_/);
  const runId = runLink!.split("/").pop()!;
  await page.goto(runLink!);
  await expect(page.getByText(/\/ 100|无可计算数据/)).toBeVisible();
  for (const principle of ["可感知", "可操作", "易理解", "兼容性"]) {
    await expect(page.getByRole("heading", { name: principle })).toBeVisible();
  }
  await page.goto(`/scans/${runId}/issues`);
  await expect(page.getByRole("heading", { name: "问题列表" })).toBeVisible();
  await page.getByLabel("严重程度").selectOption("critical");
  await expect(page.getByText(/当前筛选没有自动化问题|第/)).toBeVisible();

  const issueResponse = await appRequest(page, `/api/runs/${runId}/issues?pageSize=100`);
  expect(issueResponse.ok).toBeTruthy();
  const issuePayload = JSON.parse(issueResponse.body);
  expect(issuePayload.items.length).toBeGreaterThan(0);
  const resultNodeId = issuePayload.items[0].result_node_id;
  expect(resultNodeId).toMatch(/^node_/);
  const adminAttempt = await appRequest(page, "/api/reviews/ad-hoc", {
    headers: { Origin: baseUrl },
    body: { resultNodeId, verdict: "confirmed", note: "admin must not review" },
  });
  expect(adminAttempt.status).toBe(403);
  const recalculate = await appRequest(page, `/api/admin/runs/${runId}/recalculate`, {
    method: "POST",
    headers: { Origin: baseUrl, "x-csrf-token": await csrfCookie(page) },
    body: { expectedModelVersion: "accesscheck-score-v1" },
  });
  expect(recalculate.ok).toBeTruthy();
  expect(JSON.parse(recalculate.body).score.exact.overall.numerator).toMatch(/^\d+$/);

  const computerContext = await browser.newContext({ baseURL: baseUrl });
  const computerPage = await computerContext.newPage();
  await computerPage.goto("/review/login");
  await computerPage.getByLabel("Reviewer token").fill("e2e-computer-token");
  await computerPage.getByRole("button", { name: "登录" }).click();
  await expect(computerPage).toHaveURL(/\/research$/);
  await computerPage.reload();
  const computerCsrf = await reviewerCsrfCookie(computerPage);
  const computerReview = await appRequest(computerPage, "/api/reviews/ad-hoc", {
    headers: { Origin: baseUrl, "x-csrf-token": computerCsrf },
    body: { resultNodeId, verdict: "confirmed", note: "computer review" },
  });
  expect(computerReview.status).toBe(201);
  expect(JSON.parse(computerReview.body).reviewer).toBe("computer_lead");
  const computerStatus = await appRequest(computerPage, `/api/reviews/status?runId=${runId}`);
  expect(JSON.parse(computerStatus.body).counts).toEqual([{ reviewer: "computer_lead", count: 1 }]);

  const mathContext = await browser.newContext({ baseURL: baseUrl });
  const mathPage = await mathContext.newPage();
  await mathPage.goto("/review/login");
  await mathPage.getByLabel("Reviewer token").fill("e2e-math-token");
  await mathPage.getByRole("button", { name: "登录" }).click();
  await expect(mathPage).toHaveURL(/\/research$/);
  await mathPage.reload();
  const mathReview = await appRequest(mathPage, "/api/reviews/ad-hoc", {
    headers: { Origin: baseUrl, "x-csrf-token": await reviewerCsrfCookie(mathPage) },
    body: { resultNodeId, verdict: "uncertain", note: "math review is a separate record" },
  });
  expect(mathReview.status).toBe(201);
  expect(JSON.parse(mathReview.body).reviewer).toBe("math_lead");
  const mathStatus = await appRequest(mathPage, `/api/reviews/status?runId=${runId}`);
  expect(JSON.parse(mathStatus.body).counts).toEqual([{ reviewer: "math_lead", count: 1 }]);

  const adminCsrf = await csrfCookie(page);
  const publish = await appRequest(page, `/api/admin/runs/${runId}/publish`, {
    method: "POST",
    headers: { Origin: baseUrl, "x-csrf-token": adminCsrf },
  });
  expect(publish.ok).toBeTruthy();
  const exportRun = await appRequest(page, `/api/runs/${runId}/export`, {
    method: "POST",
    headers: { Origin: baseUrl, "x-csrf-token": adminCsrf },
  });
  expect(exportRun.status).toBe(201);
  const jsonExport = await appRequest(page, `/api/exports/${runId}/json`);
  expect(jsonExport.ok).toBeTruthy();
  const publicContext = await browser.newContext({ baseURL: baseUrl });
  const publicRun = await publicContext.request.get(`${baseUrl}/api/runs/${runId}`);
  expect(publicRun.ok()).toBeTruthy();
  const htmlReport = await publicContext.request.get(`${baseUrl}/api/reports/${runId}/html`);
  expect(htmlReport.ok()).toBeTruthy();
  expect((await htmlReport.body()).toString()).toContain("本项目仅评价 axe-core");
  const pdfReport = await publicContext.request.get(`${baseUrl}/api/reports/${runId}/pdf`);
  expect(pdfReport.ok()).toBeTruthy();
  expect(pdfReport.headers()["content-type"]).toContain("application/pdf");
  expect(
    (
      await publicContext.request.get(`${baseUrl}/api/exports/studies/not-a-real-export.zip`)
    ).status(),
  ).toBe(404);
  const unpublish = await appRequest(page, `/api/admin/runs/${runId}/unpublish`, {
    method: "POST",
    headers: { Origin: baseUrl, "x-csrf-token": adminCsrf },
  });
  expect(unpublish.ok).toBeTruthy();
  expect((await publicContext.request.get(`${baseUrl}/api/runs/${runId}`)).status()).toBe(404);
  await publicContext.close();
  await mathContext.close();
  await computerContext.close();
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
});
