import { NextResponse } from "next/server";
import {
  ACCESS_SESSION_COOKIE,
  authenticateAccessKey,
  createAccessSession,
  loginRedirectPath,
  sessionCookieOptions,
} from "@/lib/access-control";
import { AppError, errorEnvelope } from "@/lib/errors";
import { consumeRateLimit, requestClientKey } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const rate = consumeRateLimit(requestClientKey(request, "access-login"), 10, 60_000);
    if (!rate.allowed)
      throw new AppError("ACCESS_LOGIN_RATE_LIMITED", "尝试次数过多，请稍后再试", 429, rate);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("ACCESS_LOGIN_INVALID", "请输入访问密钥", 422);
    if (Object.keys(body).some((key) => key !== "accessKey" && key !== "next"))
      throw new AppError("ACCESS_LOGIN_INVALID", "登录请求包含未知字段", 400);
    if (typeof body.accessKey !== "string" || !body.accessKey)
      throw new AppError("ACCESS_LOGIN_INVALID", "请输入访问密钥", 422);
    const role = authenticateAccessKey(body.accessKey);
    const response = NextResponse.json({
      role,
      redirectTo: loginRedirectPath(body.next, role),
    });
    response.cookies.set(ACCESS_SESSION_COOKIE, createAccessSession(role), sessionCookieOptions());
    return response;
  } catch (error) {
    return NextResponse.json(errorEnvelope(error, request), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
