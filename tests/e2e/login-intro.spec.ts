import { expect, test } from "@playwright/test";

test("匿名登录页介绍项目评估、报告、招生官体验方式和评分边界，并支持英文", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "输入访问密钥" })).toBeVisible();
  const accessKey = page.getByLabel("访问密钥");
  await expect(accessKey).toBeVisible();
  await expect(accessKey).toBeInViewport();
  await expect(page.getByRole("button", { name: "进入系统" })).toBeVisible();

  const process = page.getByRole("region", { name: "无障碍评估怎样完成" });
  await expect(process.getByRole("listitem")).toHaveCount(4);
  const report = page.getByRole("region", { name: "报告会呈现哪些信息" });
  await expect(report.getByRole("listitem")).toHaveCount(4);
  const audiences = page.getByRole("region", { name: "谁可以使用 AccessCheck" });
  await expect(audiences.getByRole("heading", { name: "报告访客" })).toBeVisible();
  await expect(audiences.getByRole("heading", { name: "招生官体验" })).toBeVisible();

  const localeResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/preferences/locale") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "EN", exact: true }).click();
  expect((await localeResponse).status()).toBe(200);
  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Enter your access key" })).toBeVisible();
  const englishAccessKey = page.getByLabel("Access key");
  await expect(englishAccessKey).toBeVisible();
  await expect(englishAccessKey).toBeInViewport();
  await expect(page.getByRole("button", { name: "Enter system" })).toBeVisible();

  const englishProcess = page.getByRole("region", { name: "How an assessment works" });
  await expect(englishProcess.getByRole("listitem")).toHaveCount(4);
  const englishReport = page.getByRole("region", { name: "What a report includes" });
  await expect(englishReport.getByRole("listitem")).toHaveCount(4);
  const englishAudiences = page.getByRole("region", { name: "Who can use AccessCheck" });
  await expect(englishAudiences.getByRole("heading", { name: "Report visitors" })).toBeVisible();
  await expect(
    englishAudiences.getByRole("heading", { name: "Admissions officer preview" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(englishAccessKey).toBeInViewport();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});
