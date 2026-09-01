import { cookies } from "next/headers";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, normalizeLocale, type Locale } from "@/lib/i18n";

export * from "@/lib/i18n";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return normalizeLocale(store.get(LOCALE_COOKIE)?.value);
}

export function localeCookieOptions(scheme?: string) {
  return {
    maxAge: LOCALE_COOKIE_MAX_AGE,
    httpOnly: false,
    secure: scheme?.toLowerCase() === "https",
    sameSite: "lax" as const,
    path: "/",
  };
}
