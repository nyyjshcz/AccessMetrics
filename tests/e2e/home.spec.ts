import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const baseUrl = "http://127.0.0.1:3100";
const adminAccessKey = "e2e-admin-access-key-01234567890123456789";
const visitorAccessKey = "e2e-visitor-access-key-01234567890123456789";

// The login endpoint rate-limits by the client address reported by the trusted
// reverse proxy. Give every test its own deterministic bucket so a serial E2E
// run does not make a later, valid login look like an application failure.
test.beforeEach(async ({ context }, testInfo) => {
  const name = testInfo.titlePath.join("::");
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const secondOctet = 1 + (hash % 249);
  const thirdOctet = 1 + ((hash >>> 8) % 249);
  const fourthOctet = 1 + ((hash >>> 16) % 249);
  await context.setExtraHTTPHeaders({
    "x-accesscheck-trusted-proxy": "caddy",
    "x-forwarded-for": `10.${secondOctet}.${thirdOctet}.${fourthOctet}`,
  });
});

async function signIn(page: Page, accessKey: string, nextPath = "/") {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
  await page.getByLabel("访问密钥").fill(accessKey);
  await page.getByRole("button", { name: "进入系统" }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
}

async function chooseLocale(page: Page, locale: "zh-CN" | "en") {
  const preference = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/preferences/locale") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: locale === "en" ? "EN" : "中文", exact: true }).click();
  expect((await preference).status()).toBe(200);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
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

test("语言切换会持久化，并覆盖登录、管理员导航和扫描页", async ({ page, context }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "输入访问密钥" })).toBeVisible();

  await chooseLocale(page, "en");
  await expect(page.getByRole("heading", { name: "Enter your access key" })).toBeVisible();
  await expect(
    (await context.cookies()).find((cookie) => cookie.name === "accesscheck_locale")?.value,
  ).toBe("en");

  await page.getByLabel("Access key").fill(adminAccessKey);
  await page.getByRole("button", { name: "Enter system" }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
  await expect(
    page.getByRole("heading", { name: "Turn accessibility issues into checkable conclusions" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New scan" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Active tasks", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Published reports", exact: true })).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { name: "Turn accessibility issues into checkable conclusions" }),
  ).toBeVisible();
  await page.goto("/scans/new");
  await expect(page.getByRole("heading", { name: "Scan a public website" })).toBeVisible();
  await expect(page.getByLabel("Website URL")).toBeVisible();

  await chooseLocale(page, "zh-CN");
  await expect(page.getByRole("heading", { name: "扫描一个公开网站" })).toBeVisible();
});

test("管理员登录后可访问扫描管理页面", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "输入访问密钥" })).toBeVisible();
  await signIn(page, adminAccessKey);
  await expect(
    page.getByRole("heading", { name: "把网站无障碍问题，变成可以核对的结论" }),
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

test("团队页面对访客开放并完整展示两位平级成员", async ({ page }) => {
  await page.goto("/team");
  await expect(page).toHaveURL(/\/login\?next=%2Fteam$/);
  await page.getByLabel("访问密钥").fill(visitorAccessKey);
  await page.getByRole("button", { name: "进入系统" }).click();
  await expect(page).toHaveURL(/\/team$/);

  await expect(page.getByRole("heading", { name: "团队成员" })).toBeVisible();
  await expect(page.getByRole("link", { name: "团队", exact: true })).toBeVisible();
  const cards = page.locator(".member-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.getByText("联合创始人", { exact: false })).toHaveCount(2);
  await expect(page.getByRole("img", { name: "洪诚择的照片" })).toBeVisible();
  await expect(page.getByRole("img", { name: "叶欣怡的照片" })).toBeVisible();

  const hong = cards.filter({ hasText: "洪诚择" });
  await expect(hong).toContainText("海亮高级中学");
  await expect(hong).toContainText("NOIP 2024 浙江省一等奖");
  await expect(hong.getByRole("link", { name: /Luogu/ })).toHaveAttribute("target", "_blank");
  await expect(hong.getByRole("link", { name: /GitHub/ })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  const ye = cards.filter({ hasText: "叶欣怡" });
  await expect(ye.locator(".member-links")).toHaveCount(0);

  await chooseLocale(page, "en");
  await expect(page.getByRole("heading", { name: "Meet the Team" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Team", exact: true })).toBeVisible();
  await expect(page.getByText("OUR TEAM", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Portrait of Chengze Hong" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Portrait of Xinyi Ye" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Chengze Hong", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Xinyi Ye", level: 2 })).toBeVisible();
  await expect(cards.getByText("Co-Founder", { exact: false })).toHaveCount(2);
  await expect(cards.getByText("School", { exact: true })).toHaveCount(2);
  await expect(cards.getByText("Awards & experience", { exact: true })).toHaveCount(2);
  await expect(cards.filter({ hasText: "Chengze Hong" })).toContainText(
    "Hailiang Senior High School",
  );
  await expect(cards.filter({ hasText: "Chengze Hong" })).toContainText(
    "NOIP 2024 Zhejiang Provincial First Prize",
  );
  await expect(cards.filter({ hasText: "Xinyi Ye" })).toContainText(
    "Hailiang Education Astra College",
  );
  await expect(cards.filter({ hasText: "Xinyi Ye" })).toContainText("Australian AMC First Prize");
  await expect(page.locator(".team-page")).not.toContainText("联合创始人");
  await expect(page.locator(".team-page")).not.toContainText("海亮高级中学");
  await expect(page.locator(".team-page")).not.toContainText("叶欣怡");
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

async function createCompletedRun(page: Page, url: string) {
  await signIn(page, adminAccessKey, "/scans/new");
  await page.goto("/scans/new");
  await page.getByLabel("网站 URL").fill(url);
  await page.getByLabel("最多扫描页面数").fill("1");
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/scans"));
  await page.getByRole("button", { name: "开始扫描", exact: true }).click();
  const response = await responsePromise;
  expect([200, 202]).toContain(response.status());
  const { jobId } = await response.json();
  await expect(page).toHaveURL(new RegExp(`/scans/jobs/${jobId}$`));
  let status = "queued";
  for (let attempt = 0; attempt < 8 && ["queued", "running"].includes(status); attempt++) {
    await runWorkerOnce();
    const statusResponse = await page.request.get(`/api/scans/${jobId}`);
    expect(statusResponse.ok()).toBeTruthy();
    status = (await statusResponse.json()).job.status;
    if (["queued", "running"].includes(status)) await page.waitForTimeout(250);
  }
  expect(["completed", "completed_with_errors"]).toContain(status);
  await page.reload();
  const resultLink = page.getByRole("link", { name: "查看扫描结果" });
  await expect(resultLink).toBeVisible();
  const runPath = await resultLink.getAttribute("href");
  expect(runPath).toMatch(/^\/scans\/run_/);
  return runPath!.split("/").pop()!;
}

function ensureIncompleteReviewItem(runId: string) {
  const db = new Database(path.join(process.cwd(), "data/e2e-accesscheck-local.db"));
  const now = new Date().toISOString();
  try {
    const existing = db
      .prepare(
        "SELECT n.id FROM result_nodes n JOIN rule_results rr ON rr.id=n.rule_result_id WHERE rr.run_id=? AND rr.result_type='incomplete' LIMIT 1",
      )
      .get(runId) as { id: string } | undefined;
    if (existing) return true;
    const page = db
      .prepare(
        "SELECT p.id FROM pages p JOIN scan_runs r ON r.site_id=p.site_id WHERE r.id=? ORDER BY p.id LIMIT 1",
      )
      .get(runId) as { id: string } | undefined;
    if (!page) return false;
    const ruleResultId = `e2e_incomplete_result_${runId}`;
    const nodeId = `e2e_incomplete_node_${runId}`;
    db.prepare(
      "INSERT INTO rule_results(id,run_id,page_id,rule_id,result_type,impact,description,help,help_url,tags_json,node_count,raw_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      ruleResultId,
      runId,
      page.id,
      "e2e-review-item",
      "incomplete",
      "moderate",
      "E2E review fixture",
      "This item needs a human review",
      "https://dequeuniversity.com/rules/axe/e2e-review-item",
      "[]",
      1,
      "{}",
    );
    db.prepare(
      "INSERT INTO result_nodes(id,rule_result_id,ordinal,target_json,html_sanitized,failure_summary,any_json,all_json,none_json) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(
      nodeId,
      ruleResultId,
      1,
      '["#e2e-review-item"]',
      '<div id="e2e-review-item"></div>',
      "E2E review fixture",
      "[]",
      "[]",
      "[]",
    );
    return true;
  } finally {
    db.close();
  }
}

function seedAiBatch(runId: string, status: "queued" | "completed") {
  const db = new Database(path.join(process.cwd(), "data/e2e-accesscheck-local.db"));
  const now = new Date().toISOString();
  const completed = status === "completed";
  try {
    const node = db
      .prepare(
        "SELECT n.id FROM result_nodes n JOIN rule_results rr ON rr.id=n.rule_result_id WHERE rr.run_id=? AND rr.result_type='incomplete' LIMIT 1",
      )
      .get(runId) as { id: string } | undefined;
    if (!node) return false;
    const providerId = `e2e_provider_${runId}`;
    const batchId = `e2e_batch_${runId}`;
    db.prepare(
      "INSERT OR IGNORE INTO ai_provider_configs(id,label,base_url,model,key_fingerprint,max_concurrent_requests,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(providerId, "E2E local provider", "http://127.0.0.1:9", "local-test", "", 1, 1, now, now);
    db.prepare(
      "INSERT OR IGNORE INTO ai_review_batches(id,batch_key,run_id,provider_config_id,provider_snapshot_json,provider_snapshot_hash,prompt_version,prompt_hash,evidence_version,status,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      batchId,
      `e2e:${runId}`,
      runId,
      providerId,
      "{}",
      "e2e",
      "e2e",
      "e2e",
      "e2e",
      status,
      now,
      now,
      completed ? now : null,
    );
    db.prepare(
      "INSERT OR REPLACE INTO ai_review_items(id,batch_id,result_node_id,status,verdict,reason,attempt_count,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run(
      `e2e_item_${runId}`,
      batchId,
      node.id,
      status,
      completed ? "not_problem" : null,
      completed ? "Local E2E conclusion" : null,
      1,
      now,
      now,
      completed ? now : null,
    );
    return true;
  } finally {
    db.close();
  }
}

function completeAiBatch(runId: string) {
  const db = new Database(path.join(process.cwd(), "data/e2e-accesscheck-local.db"));
  const now = new Date().toISOString();
  try {
    db.prepare(
      "UPDATE ai_review_batches SET status='completed',completed_at=?,updated_at=? WHERE run_id=? AND batch_key=?",
    ).run(now, now, runId, `e2e:${runId}`);
    db.prepare(
      "UPDATE ai_review_items SET status='completed',verdict='not_problem',reason='Local E2E conclusion',completed_at=?,updated_at=? WHERE batch_id IN (SELECT id FROM ai_review_batches WHERE run_id=? AND batch_key=?)",
    ).run(now, now, runId, `e2e:${runId}`);
  } finally {
    db.close();
  }
}

test("完成扫描后可选复核、人工结论、完整报告和发布导出", async ({ page }) => {
  test.setTimeout(120000);
  const { fixture, url } = await startFixture();
  try {
    const runId = await createCompletedRun(page, url);
    expect(ensureIncompleteReviewItem(runId)).toBeTruthy();
    await page.goto(`/scans/${runId}`);
    await expect(page.getByRole("link", { name: /处理复核项目/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /查看完整报告/ })).toBeVisible();
    await page.getByRole("link", { name: /处理复核项目/ }).click();
    await expect(page).toHaveURL(new RegExp(`/scans/${runId}/review$`));
    const item = page.locator(".incomplete-list button").first();
    await expect(item).toHaveCount(1);
    await item.click();
    await page.getByRole("button", { name: "存在问题" }).click();
    await expect(page.locator(".review-resolution-summary")).toContainText(/人工已复核\s*1/);
    await page
      .getByRole("link", { name: /继续查看完整报告|跳过，查看完整报告/ })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/reports/${runId}$`));
    await expect(page.getByText("完整报告", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "复核情况" })).toBeVisible();
    // The on-screen report must load the same report layout, rather than
    // rendering the export document as unstyled text.
    await expect(page.locator(".report-hero")).toHaveCSS("display", "grid");
    await expect(page.locator(".summary-grid")).toHaveCSS("display", "grid");
    await expect(page.locator(".report-hero h1")).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(page.getByRole("link", { name: "下载 HTML" })).toHaveAttribute(
      "href",
      `/api/reports/${runId}/html?lang=zh-CN`,
    );
    await expect(page.getByRole("link", { name: "下载 PDF" })).toHaveAttribute(
      "href",
      `/api/reports/${runId}/pdf?lang=zh-CN`,
    );
    await expect(page.getByRole("link", { name: "下载 JSON" })).toHaveAttribute(
      "href",
      `/api/reports/${runId}/json`,
    );
    await page.context().clearCookies();
    await signIn(page, visitorAccessKey, `/reports/${runId}`);
    expect((await page.request.get(`/reports/${runId}`)).status()).toBe(404);
    await page.goto(`/scans/${runId}/review`);
    await expect(page).toHaveURL(/\/reports$/);
    await page.context().clearCookies();
    await signIn(page, adminAccessKey, `/reports/${runId}`);
    await page.goto(`/reports/${runId}`);
    await page.getByRole("button", { name: "发布报告" }).click();
    await expect(page.getByText("报告已发布。")).toBeVisible();
    for (const suffix of ["html", "pdf", "json"])
      expect((await page.request.get(`/api/reports/${runId}/${suffix}`)).ok()).toBeTruthy();
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await page.reload();
    await expect(page.getByText("Full report", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download HTML" })).toHaveAttribute(
      "href",
      `/api/reports/${runId}/html?lang=en`,
    );
    await page.context().clearCookies();
    await signIn(page, visitorAccessKey, "/reports");
    await page.goto("/reports");
    await expect(
      page
        .locator(".run-row")
        .filter({ hasText: new URL(url).origin })
        .getByRole("link"),
    ).toHaveAttribute("href", `/reports/${runId}`);
    await page.context().clearCookies();
    await signIn(page, adminAccessKey, `/reports/${runId}`);
    await page.goto(`/reports/${runId}`);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "撤下报告" }).click();
    await expect(page.getByText("报告已撤下。")).toBeVisible();
    await page.context().clearCookies();
    await signIn(page, visitorAccessKey, "/reports");
    expect((await page.request.get(`/reports/${runId}`)).status()).toBe(404);
    for (const suffix of ["html", "pdf", "json"])
      expect((await page.request.get(`/api/reports/${runId}/${suffix}`)).status()).toBe(404);
  } finally {
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
});

test("AI 已完成结论可进入报告且发布门禁生效", async ({ page }) => {
  test.setTimeout(120000);
  const { fixture, url } = await startFixture();
  try {
    const runId = await createCompletedRun(page, url);
    expect(ensureIncompleteReviewItem(runId)).toBeTruthy();
    expect(seedAiBatch(runId, "queued")).toBeTruthy();
    await page.goto(`/reports/${runId}`);
    const publishButton = page.getByRole("button", { name: "发布报告" });
    await expect(publishButton).toBeDisabled();
    completeAiBatch(runId);
    await page.reload();
    await expect(publishButton).toBeEnabled();
    await page.goto(`/scans/${runId}/review`);
    await expect(page.locator(".review-resolution-summary")).toContainText(/AI 已复核\s*1/);
    await expect(page.getByText("AI 的辅助判断")).toBeVisible();
    await page.getByRole("link", { name: "跳过，查看完整报告" }).click();
    await expect(page).toHaveURL(new RegExp(`/reports/${runId}$`));
    await page.getByRole("button", { name: "发布报告" }).click();
    await expect(page.getByText("报告已发布。")).toBeVisible();
    await page.context().clearCookies();
    await signIn(page, visitorAccessKey, "/reports");
    await page.goto("/reports");
    await expect(
      page
        .locator(".run-row")
        .filter({ hasText: new URL(url).origin })
        .getByRole("link"),
    ).toHaveAttribute("href", `/reports/${runId}`);
    await page.goto(`/scans/${runId}/review`);
    await expect(page).toHaveURL(/\/reports$/);
  } finally {
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
});
