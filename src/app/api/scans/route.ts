import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createScanJob } from "@/lib/repositories";
import { validateTargetUrl } from "@/lib/url-security";
import { AppError, errorEnvelope } from "@/lib/errors";
import { getDb, migrate } from "@/lib/db";
import { consumeRateLimit, requestClientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    migrate();
    const view = new URL(request.url).searchParams.get("view") ?? "active";
    if (view !== "active" && view !== "published")
      throw new AppError("INVALID_VIEW", "view 必须是 active 或 published", 422);
    const rows = getDb()
      .prepare(
        `SELECT r.id run_id,r.status run_status,r.published,r.published_at,r.started_at,r.finished_at,
                j.id job_id,j.status job_status,j.submitted_url,j.created_at,
                s.name,s.origin
           FROM scan_runs r
           JOIN scan_jobs j ON j.id=r.job_id
           JOIN sites s ON s.id=r.site_id
          WHERE r.published=?
          ORDER BY COALESCE(r.published_at,r.created_at) DESC,r.id DESC`,
      )
      .all(view === "published" ? 1 : 0);
    return NextResponse.json({ view, runs: rows });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}

export async function POST(request: Request) {
  try {
    const rate = consumeRateLimit(requestClientKey(request, "scan-create"), 30, 60_000);
    if (!rate.allowed) throw new AppError("RATE_LIMITED", "扫描创建请求过于频繁", 429, rate);
    migrate();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "扫描请求必须是对象", 422);
    const allowed = new Set(["url", "maxPages", "sameOriginOnly", "respectRobots"]);
    if (Object.keys(body).some((key) => !allowed.has(key)))
      throw new AppError("UNKNOWN_FIELD", "扫描请求包含未定义字段", 400);
    const target = await validateTargetUrl(String(body.url ?? ""));
    const maxPages = Number(body.maxPages ?? 10);
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 15)
      throw new AppError("INVALID_PAGE_LIMIT", "maxPages 必须是 1 到 15 的整数", 422);
    const idempotencyKey = request.headers.get("idempotency-key") ?? crypto.randomUUID();
    const job = createScanJob(
      target.origin,
      {
        maxPages,
        sameOriginOnly: body.sameOriginOnly !== false,
        respectRobots: body.respectRobots !== false,
      },
      undefined,
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
