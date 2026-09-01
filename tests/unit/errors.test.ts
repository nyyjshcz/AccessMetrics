import { describe, expect, it } from "vitest";
import { AppError, errorEnvelope } from "@/lib/errors";

describe("localized API error envelopes", () => {
  it("prefers a valid lang query over the locale cookie", () => {
    const request = new Request("http://localhost/api/test?lang=en", { headers: { cookie: "accesscheck_locale=zh-CN" } });
    expect(errorEnvelope(new AppError("NOT_FOUND", "敏感内部消息", 404), request).error.message).toBe("The requested resource was not found");
  });

  it("uses a valid cookie and ignores invalid locale values", () => {
    const request = new Request("http://localhost/api/test?lang=fr", { headers: { cookie: "accesscheck_locale=en" } });
    expect(errorEnvelope(new AppError("INVALID_INPUT", "内部详情"), request).error.message).toBe("The request body is invalid");
  });

  it("does not expose unknown error details", () => {
    const result = errorEnvelope(new Error("secret database password"), "request-1", "en");
    expect(result).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error", requestId: "request-1" } });
  });

  it("uses precise bilingual wording for AI batch retry errors", () => {
    expect(errorEnvelope(new AppError("AI_BATCH_RETRY_REQUIRED", "internal"), "r1", "zh-CN").error.message)
      .toBe("失败的批次必须先重试失败项");
    expect(errorEnvelope(new AppError("AI_BATCH_RETRY_REQUIRED", "internal"), "r1", "en").error.message)
      .toBe("Retry the failed items in the batch before continuing");
  });

  it("uses raw axe-incomplete terminology for AI node errors", () => {
    expect(errorEnvelope(new AppError("AI_NODE_NOT_INCOMPLETE", "internal"), "r2", "zh-CN").error.message)
      .toBe("AI 只能处理 axe 标记为 incomplete 的节点");
    expect(errorEnvelope(new AppError("INCOMPLETE_NODE_NOT_FOUND", "internal"), "r2", "en").error.message)
      .toBe("The incomplete node marked by axe was not found");
  });

  it("calls the locked manual field a verdict", () => {
    expect(errorEnvelope(new AppError("AI_REVIEW_ACTIVE", "internal"), "r3", "en").error.message)
      .toBe("Manual verdicts cannot be changed while an AI batch is running");
  });
});
