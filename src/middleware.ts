import { NextResponse, type NextRequest } from "next/server";
export function middleware(request: NextRequest) {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const protectedMutation =
      request.nextUrl.pathname.startsWith("/api/admin/") ||
      request.nextUrl.pathname.startsWith("/api/reviewer/") ||
      request.nextUrl.pathname.startsWith("/api/gates/") ||
      request.nextUrl.pathname.startsWith("/api/reviews/") ||
      request.nextUrl.pathname.startsWith("/api/scans") ||
      request.nextUrl.pathname.startsWith("/api/runs/") ||
      request.nextUrl.pathname.startsWith("/api/publication/");
    const hostOrigin = request.headers.get("host")
      ? `${request.nextUrl.protocol}//${request.headers.get("host")}`
      : null;
    if (
      protectedMutation &&
      (!origin || (origin !== request.nextUrl.origin && origin !== hostOrigin))
    )
      return NextResponse.json(
        { error: { code: "ORIGIN_INVALID", message: "请求来源不受信任" } },
        { status: 403 },
      );
  }
  const response = NextResponse.next();
  response.headers.set(
    "x-request-id",
    request.headers.get("x-request-id") ?? globalThis.crypto.randomUUID(),
  );
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set(
    "content-security-policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  return response;
}
export const config = { matcher: ["/api/:path*"] };
