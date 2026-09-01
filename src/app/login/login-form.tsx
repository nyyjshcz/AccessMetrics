"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { getMessages, type Locale } from "@/lib/i18n";

export default function LoginForm({ nextPath, locale = "zh-CN" }: { nextPath?: string; locale?: Locale }) {
  const copy = getMessages(locale).login;
  const router = useRouter();
  const [accessKey, setAccessKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessKey, next: nextPath }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? copy.error);
      router.replace(data.redirectTo ?? "/");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="access-login-form" onSubmit={submit}>
      <label htmlFor="access-key">{copy.key}</label>
      <input
        id="access-key"
        type="password"
        autoComplete="current-password"
        required
        value={accessKey}
        onChange={(event) => setAccessKey(event.target.value)}
        placeholder={copy.placeholder}
      />
      <p className="muted">{copy.note}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? copy.busy : copy.submit}
      </button>
    </form>
  );
}
