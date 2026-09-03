import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportDocument } from "@/components/report-document";
import type { ReportModel } from "@/lib/report";

function reportModel(): ReportModel {
  return {
    runId: "run_report_document",
    site: { name: "Example public service", origin: "https://example.test" },
    run: {
      status: "completed_with_errors",
      startedAt: "2026-09-03T08:00:00.000Z",
      finishedAt: "2026-09-03T08:05:00.000Z",
      createdAt: "2026-09-03T07:59:00.000Z",
    },
    score: {
      overall: 74,
      modelVersion: "fixture",
      principles: {
        perceivable: 70,
        operable: 72,
        understandable: 76,
        robust: 78,
      },
    },
    resolvedScore: {
      overall: 80,
      modelVersion: "fixture",
      principles: {
        perceivable: 76,
        operable: 78,
        understandable: 82,
        robust: 84,
      },
    },
    generatedAt: "2026-09-03T08:06:00.000Z",
    pages: [
      {
        canonicalUrl: "https://example.test/",
        scanStatus: "succeeded",
        httpStatus: 200,
        errorCode: null,
        frameCoverageStatus: "complete",
      },
      {
        canonicalUrl: "https://example.test/failed",
        scanStatus: "failed",
        httpStatus: null,
        errorCode: "NAVIGATION_FAILED",
        frameCoverageStatus: null,
      },
    ],
    nodeStatistics: { total: 12, pass: 2, violation: 4, incomplete: 6, inapplicable: 0 },
    issues: [
      {
        id: "issue_image_alt",
        ruleId: "image-alt",
        impact: "serious",
        resultType: "violation",
        description: "Image alternative text",
        help: "Images must have alternate text",
        helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
        nodeCount: 4,
        nodes: [
          {
            ordinal: 1,
            pageUrl: "https://example.test/",
            target: ["main img"],
            html: '<img src="notice.png">',
            failureSummary: "Element does not have an alt attribute",
            framePath: [],
            resolution: null,
          },
        ],
      },
    ],
    incompleteResolutions: {
      total: 6,
      manual: { problem: 1, not_problem: 0, uncertain: 1 },
      ai: { problem: 0, not_problem: 1, uncertain: 1 },
      unresolved: 2,
    },
  } as unknown as ReportModel;
}

function render(model: ReportModel, locale: "zh-CN" | "en") {
  return renderToStaticMarkup(createElement(ReportDocument, { model, locale }));
}

function assertInOrder(html: string, labels: string[]) {
  let position = -1;
  for (const label of labels) {
    const next = html.indexOf(label);
    expect(next, `Expected ${label} to appear after the previous section`).toBeGreaterThan(position);
    position = next;
  }
}

describe("ReportDocument", () => {
  it("renders the same five report chapters in English without web-only actions", () => {
    const html = render(reportModel(), "en");

    assertInOrder(html, [
      "Overview",
      "Key accessibility issues",
      "Review status",
      "Pages not successfully scanned",
      "About this report",
    ]);
    expect(html).toContain("Review items");
    expect(html).toContain("Reviewed");
    expect(html).toContain("Needs review");
    expect(html).toContain("Images must have alternate text");
    expect(html).toContain("image-alt");
    expect(html).not.toMatch(/<h3[^>]*>[^<]*image-alt/);
    expect(html).toContain("Element does not have an alt attribute");
    expect(html).toContain("https://example.test/failed");
    expect(html).toContain("NAVIGATION_FAILED");
    expect(html).toContain("&lt;img src=&quot;notice.png&quot;&gt;");
    expect(html).not.toContain("Download HTML");
    expect(html).not.toContain("Publish report");
    expect(html).not.toContain("Withdraw report");
    expect(html).toContain("Full report");
    expect(html).not.toContain("items counted");
    expect(html).toContain("affected elements");
    expect(html).not.toContain('<main class="report-shell"');
    expect(html.indexOf('class="score-context"')).toBeGreaterThan(html.indexOf("Overview"));
  });

  it("uses the review-item terms in Chinese and counts uncertain conclusions as reviewed", () => {
    const html = render(reportModel(), "zh-CN");

    assertInOrder(html, ["概览", "主要无障碍问题", "复核情况", "未成功扫描页面", "报告说明"]);
    expect(html).toContain("复核项目");
    expect(html).toContain("已复核");
    expect(html).toContain("待复核");
    expect(html).toContain('data-review-items="6"');
    expect(html).toContain('data-reviewed="4"');
    expect(html).toContain('data-needs-review="2"');
    expect(html).not.toContain("原始 incomplete 清单");
    expect(html).toContain("完整报告");
    expect(html).toContain("受影响元素");
  });
});
