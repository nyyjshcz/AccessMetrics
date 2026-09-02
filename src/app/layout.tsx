import "./globals.css";
import type { Route } from "next";
import Link from "next/link";
import { getPageRole } from "@/lib/access-control";
import { LocaleSelector } from "@/components/locale-selector";
import { getLocale, t, type Locale } from "@/lib/i18n-server";

export async function generateMetadata() {
  const locale = await getLocale();
  return { title: t(locale, "title"), description: t(locale, "description") };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const role = await getPageRole();
  const locale: Locale = await getLocale();
  return (
    <html lang={locale}>
      <body>
        <header className="topbar">
          <div className="shell topbar-inner">
            <Link className="brand" href={role === "visitor" ? "/reports" : "/"}>
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 32 32" role="img" aria-hidden="true" focusable="false">
                  <path d="M10 6H6v4M22 6h4v4M10 26H6v-4M22 26h4v-4" />
                  <path d="m9.5 16 4.5 4.5 9-10" />
                </svg>
              </span>
              <span className="brand-copy">
                <span>AccessCheck Lishui</span>
                <small>{t(locale, "brandTagline")}</small>
              </span>
            </Link>
            <nav className="topnav" aria-label={t(locale, "navigation")}>
              <LocaleSelector locale={locale} />
              {role === "admin" && (
                <>
                  <Link href="/scans/new">{t(locale, "newScan")}</Link>
                  <Link href="/scans">{t(locale, "activeTasks")}</Link>
                  <Link href="/reports">{t(locale, "publishedReports")}</Link>
                  <Link href={"/team" as Route}>{t(locale, "teamNav")}</Link>
                  <Link href="/settings/ai">{t(locale, "aiSettings")}</Link>
                </>
              )}
              {role === "visitor" && (
                <>
                  <Link href="/reports">{t(locale, "publishedReports")}</Link>
                  <Link href={"/team" as Route}>{t(locale, "teamNav")}</Link>
                </>
              )}
              {role && (
                <form action="/api/auth/logout" method="post" className="logout-form">
                  <span className="access-role">
                    {role === "admin" ? t(locale, "admin") : t(locale, "visitor")}
                  </span>
                  <button type="submit" className="topbar-button">
                    {t(locale, "logout")}
                  </button>
                </form>
              )}
            </nav>
          </div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
