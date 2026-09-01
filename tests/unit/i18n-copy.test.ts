import { describe, expect, it } from "vitest";
import { getMessages } from "@/lib/i18n";
import { describeScanStatus } from "@/components/status-badge";

describe("localized UI copy", () => {
  it("uses explicit wording for terminal scan summaries", () => {
    expect(getMessages("zh-CN").job.terminalSummary).toContain("扫描已结束");
    expect(getMessages("en").job.terminalSummary).toContain("Scanning has ended");
    expect(getMessages("zh-CN").job.terminalSummary).not.toContain("停止更新");
    expect(getMessages("en").job.terminalSummary).not.toContain("stopped updating");
  });

  it("defines the AI connection-test action in both locales", () => {
    expect(getMessages("zh-CN").ai.test).toBe("保存并测试连接");
    expect(getMessages("en").ai.test).toBe("Save and test connection");
  });

  it("describes partial completion as a completed scan with page errors", () => {
    expect(describeScanStatus("completed_with_errors", false, "en").label).toBe(
      "Scan complete (some pages failed)",
    );
  });
});
