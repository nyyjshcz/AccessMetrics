"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
export default function NewScanPage() {
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(10);
  const [error, setError] = useState("");
  const router = useRouter();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const r = await fetch("/api/scans", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": document.cookie.match(/(?:^|; )accesscheck_csrf=([^;]+)/)?.[1] ?? "",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({ url, maxPages }),
    });
    const d = await r.json();
    if (!r.ok) {
      setError(d.error?.message ?? "创建失败");
      return;
    }
    router.push(`/admin/scans/${d.jobId}`);
  }
  return (
    <section className="card" style={{ maxWidth: 640, margin: "32px auto" }}>
      <h1>新建扫描</h1>
      <p className="muted">
        只允许你有权检查的公开 HTTP/HTTPS 站点。系统会阻止本机、内网、云元数据等目标。
      </p>
      <form onSubmit={submit}>
        <label htmlFor="url">网站 URL</label>
        <input
          id="url"
          type="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <label htmlFor="maxPages">最多页面数（1–15）</label>
        <input
          id="maxPages"
          type="number"
          min={1}
          max={15}
          value={maxPages}
          onChange={(e) => setMaxPages(Number(e.target.value))}
        />
        {error && <p className="error">{error}</p>}
        <button type="submit">创建扫描任务</button>
      </form>
    </section>
  );
}
