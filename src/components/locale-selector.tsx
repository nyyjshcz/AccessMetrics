"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";

export function LocaleSelector({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [selectedLocale, setSelectedLocale] = useState<Locale>(locale);

  async function select(nextLocale: Locale) {
    if (nextLocale === selectedLocale || pending) return;
    setPending(true);
    setSelectedLocale(nextLocale);
    try {
      const response = await fetch("/api/preferences/locale", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(`Locale preference failed (${response.status})`);
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== "object" ||
        (result as { locale?: unknown }).locale !== nextLocale
      ) {
        throw new Error("Locale preference response was invalid");
      }
      // Keep the preference available even when a dev proxy rewrites the
      // response host while the server is being reached via 127.0.0.1.
      document.cookie = `accesscheck_locale=${encodeURIComponent(nextLocale)}; Max-Age=31536000; Path=/; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
      // Refresh the current route so all server components and metadata read
      // the newly written cookie without changing the user's URL.
      router.refresh();
    } catch {
      setSelectedLocale(locale);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="locale-selector" aria-label={locale === "en" ? "Language" : "语言"}>
      <button
        type="button"
        className={selectedLocale === "zh-CN" ? "locale-active" : "locale-button"}
        aria-pressed={selectedLocale === "zh-CN"}
        onClick={() => select("zh-CN")}
        disabled={pending}
      >
        中文
      </button>
      <span aria-hidden="true">|</span>
      <button
        type="button"
        className={selectedLocale === "en" ? "locale-active" : "locale-button"}
        aria-pressed={selectedLocale === "en"}
        onClick={() => select("en")}
        disabled={pending}
      >
        EN
      </button>
    </div>
  );
}
