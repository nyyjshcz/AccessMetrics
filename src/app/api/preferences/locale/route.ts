import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { isLocale, localeCookieOptions, LOCALE_COOKIE } from "@/lib/i18n-server";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const requestUrl = new URL(request.url);
  const configuredUrl = new URL(config.APP_BASE_URL);
  const canonicalOrigin = configuredUrl.origin;
  const protocol =
    config.APP_ENV === "production"
      ? configuredUrl.protocol.replace(/:$/, "")
      : forwardedProtocol || requestUrl.protocol.replace(/:$/, "");
  const requestHost = request.headers.get("host");
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const sameOrigin = new Set<string>([canonicalOrigin]);
  // Development and tests can legitimately reach the application through a
  // local proxy with a different host. Production only accepts APP_BASE_URL.
  if (config.APP_ENV !== "production") {
    for (const value of [
      requestUrl.origin,
      requestHost && `${protocol}://${requestHost}`,
      forwardedHost && `${protocol}://${forwardedHost}`,
    ]) {
      if (value) sameOrigin.add(value);
    }
  }
  if (origin && !sameOrigin.has(origin)) {
    return NextResponse.json({ error: "same-origin request required" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  let body: unknown;
  let returnTo: string | null = null;
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const entries = [...form.entries()];
      const localeValue = form.get("locale");
      returnTo = form.get("returnTo")?.toString() ?? null;
      if (
        entries.some(([key, value]) => key !== "locale" && key !== "returnTo" || typeof value !== "string") ||
        entries.filter(([key]) => key === "locale").length !== 1 ||
        !isLocale(localeValue)
      ) {
        return NextResponse.json({ error: "form payload must include locale" }, { status: 400 });
      }
      body = { locale: localeValue };
    } catch {
      return NextResponse.json({ error: "invalid form payload" }, { status: 400 });
    }
  } else {
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "payload must be { locale }" }, { status: 400 });
  }
  const keys = Object.keys(body);
  if (
    keys.length !== 1 ||
    keys[0] !== "locale" ||
    !isLocale((body as { locale?: unknown }).locale)
  ) {
    return NextResponse.json({ error: "locale must be zh-CN or en" }, { status: 400 });
  }

  const locale = (body as { locale: "zh-CN" | "en" }).locale;
  if (returnTo !== null) {
    let target: URL;
    try {
      target = new URL(returnTo, config.APP_ENV === "production" ? canonicalOrigin : requestUrl.origin);
    } catch {
      return NextResponse.json({ error: "returnTo must be a valid same-origin path" }, { status: 400 });
    }
    if (!sameOrigin.has(target.origin) || !target.pathname.startsWith("/")) {
      return NextResponse.json({ error: "returnTo must be same-origin" }, { status: 400 });
    }
    const response = NextResponse.redirect(target, 303);
    response.cookies.set(LOCALE_COOKIE, locale, localeCookieOptions(protocol));
    return response;
  }
  const response = NextResponse.json({ locale });
  response.cookies.set(LOCALE_COOKIE, locale, localeCookieOptions(protocol));
  return response;
}

export function GET() {
  return NextResponse.json(
    { error: "method not allowed" },
    { status: 405, headers: { Allow: "POST" } },
  );
}
