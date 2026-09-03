import { describe, expect, it } from "vitest";
import { renderLanguageControl } from "@/lib/report-html";

describe("static report language control", () => {
  it("shows Chinese and EN choices while preserving the return path", () => {
    const html = renderLanguageControl("en", "/api/reports/run-1/html?lang=en");
    expect(html).toContain("中文");
    expect(html).toContain("EN");
    expect(html).toContain("aria-label=\"语言 / Language\"");
    expect(html).toContain("/api/reports/run-1/html?lang=en");
    expect(html).toContain('name="locale" value="zh-CN"');
    expect(html).toContain('name="locale" value="en"');
  });
});
