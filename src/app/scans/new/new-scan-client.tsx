"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { getMessages, type Locale } from "@/lib/i18n";

export default function NewScanClient({ locale = "zh-CN" }: { locale?: Locale }) {
  const copy = (getMessages(locale) as any).newScanPage;
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(10);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/scans", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ url, maxPages }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error?.message ?? copy.failed);
      setBusy(false);
      return;
    }
    router.push(`/scans/jobs/${data.jobId}` as any);
  }

  return (
    <section className="scan-create-layout">
      <div className="card scan-form-card">
        <p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p className="scan-form-lede">{copy.lede}</p>
        <form onSubmit={submit}>
          <label htmlFor="url">{copy.url}</label>
          <input
            id="url"
            type="url"
            required
            placeholder="https://example.com"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <p className="field-help">{copy.help}</p>

          <label htmlFor="pages">{copy.pages}</label>
          <input
            id="pages"
            type="number"
            min={1}
            max={15}
            value={maxPages}
            onChange={(event) => setMaxPages(Number(event.target.value))}
          />
          <p className="scan-limit-note" aria-live="polite">
            {copy.limit.replace("{count}", String(maxPages))}
          </p>

          {error && <p className="error notice">{error}</p>}
          <button disabled={busy}>{busy ? copy.creating : copy.create}</button>
        </form>
      </div>

      <aside className="scan-method-card" aria-label={copy.what}>
        <p className="section-kicker">{copy.what}</p><h2>{copy.output}</h2>
        <ol className="scan-method-list">
          <li>
            <span>01</span>
            <div>
              <strong>{copy.items[0][0]}</strong><p>{copy.items[0][1]}</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>{copy.items[1][0]}</strong><p>{copy.items[1][1]}</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>{copy.items[2][0]}</strong><p>{copy.items[2][1]}</p>
            </div>
          </li>
        </ol>
      </aside>
    </section>
  );
}
