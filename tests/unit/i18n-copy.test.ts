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

  it("defines team navigation and page copy in both locales", () => {
    const zh = getMessages("zh-CN");
    const en = getMessages("en");

    expect(zh.teamNav).toBe("团队");
    expect(en.teamNav).toBe("Team");
    expect(zh.team.eyebrow).toBe("团队");
    expect(en.team.eyebrow).toBe("OUR TEAM");
    expect(zh.team.title).toBe("团队成员");
    expect(en.team.title).toBe("Meet the Team");
    expect(zh.team.members.hong).toMatchObject({
      name: "洪诚择",
      role: "联合创始人 · 技术负责人",
      school: "海亮高级中学",
    });
    expect(en.team.members.hong).toMatchObject({
      name: "Chengze Hong",
      role: "Co-Founder · Technical Lead",
      school: "Hailiang Senior High School",
    });
    expect(zh.team.members.ye).toMatchObject({
      name: "叶欣怡",
      role: "联合创始人 · 数学负责人",
      school: "海亮教育致远书院",
    });
    expect(en.team.members.ye).toMatchObject({
      name: "Xinyi Ye",
      role: "Co-Founder · Mathematics Lead",
      school: "Hailiang Education Astra College",
    });
  });

  it("describes partial completion as a completed scan with page errors", () => {
    expect(describeScanStatus("completed_with_errors", false, "en").label).toBe(
      "Scan complete (some pages failed)",
    );
  });
});
