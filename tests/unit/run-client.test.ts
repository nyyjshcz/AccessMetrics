import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunNextSteps } from "@/app/scans/[runId]/run-client";

describe("scan next steps", () => {
  it("offers review and full report only for completed runs", () => {
    const html = renderToStaticMarkup(createElement(RunNextSteps, { runId: "run-1", locale: "en", status: "completed_with_errors" }));
    expect(html).toContain("/scans/run-1/review");
    expect(html).toContain("/reports/run-1");
  });

  it("explains that failed and cancelled runs have no complete report", () => {
    for (const status of ["failed", "cancelled"] as const) {
      const html = renderToStaticMarkup(createElement(RunNextSteps, { runId: "run-1", locale: "en", status }));
      expect(html).toContain("No complete report is available");
      expect(html).not.toContain("/reports/run-1");
      expect(html).not.toContain("/scans/run-1/review");
    }
  });
});
