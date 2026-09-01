import { NextResponse } from "next/server";
import { ACCESS_SESSION_COOKIE, sessionCookieOptions } from "@/lib/access-control";
import { AppError, errorEnvelope } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/request-security";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const response = NextResponse.redirect(new URL("/login", request.url), 303);
    response.cookies.set(ACCESS_SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
    return response;
  } catch (error) {
    return NextResponse.json(errorEnvelope(error, request), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
