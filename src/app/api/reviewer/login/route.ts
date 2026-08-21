import { NextResponse } from "next/server";
import { loginWithToken, reviewerSessionCookieName } from "@/lib/auth";
import { migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { consumeRateLimit, requestClientKey } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const rate = consumeRateLimit(requestClientKey(request, "reviewer-login"), 10, 60_000);
    if (!rate.allowed) throw new AppError("RATE_LIMITED", "登录请求过于频繁", 429, rate);
    migrate();
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "登录请求必须是对象", 422);
    if (Object.keys(body).some((key) => key !== "reviewToken"))
      throw new AppError("UNKNOWN_FIELD", "登录请求包含未定义字段", 400);
    if (typeof body.reviewToken !== "string" || !body.reviewToken || body.reviewToken.length > 1024)
      throw new AppError("INVALID_INPUT", "reviewer token 长度无效", 422);
    let result;
    try {
      result = loginWithToken("computer_reviewer", body.reviewToken);
    } catch {
      result = loginWithToken("math_reviewer", body.reviewToken);
    }
    const response = NextResponse.json({
      authenticated: true,
      user: result.user,
      csrfToken: result.rawCsrf,
      expiresAt: result.expires.toISOString(),
    });
    response.cookies.set(reviewerSessionCookieName, result.rawToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      expires: result.expires,
      path: "/",
    });
    response.cookies.set("accesscheck_reviewer_csrf", result.rawCsrf, {
      httpOnly: false,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      expires: result.expires,
      path: "/",
    });
    return response;
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
