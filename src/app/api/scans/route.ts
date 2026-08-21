import { NextResponse } from "next/server";
import { createScanJob } from "@/lib/repositories";
import { csrfMatches, requireRole } from "@/lib/auth";
import { validateTargetUrl } from "@/lib/url-security";
import { AppError, errorEnvelope } from "@/lib/errors";
import { migrate } from "@/lib/db";
import { consumeRateLimit, requestClientKey } from "@/lib/rate-limit";
export async function POST(request: Request) {
  try {
    const rate = consumeRateLimit(requestClientKey(request, "scan-create"), 30, 60_000);
    if (!rate.allowed) throw new AppError("RATE_LIMITED", "扫描创建请求过于频繁", 429, rate);
    migrate();
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const idempotencyKey = request.headers.get("idempotency-key");
    if (
      !idempotencyKey ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        idempotencyKey,
      )
    )
      throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "必须提供 UUID 格式的 Idempotency-Key", 422);
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "扫描请求必须是对象", 422);
    const allowed = new Set(["url", "maxPages", "sameOriginOnly", "respectRobots"]);
    if (Object.keys(body).some((key) => !allowed.has(key)))
      throw new AppError("UNKNOWN_FIELD", "扫描请求包含未定义字段", 400);
    const target = await validateTargetUrl(String(body.url ?? ""));
    const maxPages = Number(body.maxPages ?? 10);
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 15)
      throw new AppError("INVALID_PAGE_LIMIT", "maxPages 必须是 1 到 15 的整数", 422);
    const job = createScanJob(
      target.origin,
      {
        maxPages,
        sameOriginOnly: body.sameOriginOnly !== false,
        respectRobots: body.respectRobots !== false,
      },
      session.user.id,
      idempotencyKey,
      target.toString(),
    );
    return NextResponse.json(
      { jobId: job.id, siteId: job.site.id, status: job.status, statusUrl: `/api/scans/${job.id}` },
      { status: job.reused ? 200 : 202 },
    );
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
