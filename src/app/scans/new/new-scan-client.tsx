"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function NewScanClient() {
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
      setError(data.error?.message ?? "创建扫描失败");
      setBusy(false);
      return;
    }
    router.push(`/scans/jobs/${data.jobId}` as any);
  }

  return (
    <section className="card form-card">
      <p className="eyebrow">第一步 · 新建扫描</p>
      <h1>扫描一个公开网站</h1>
      <p className="muted">输入首页地址。系统会在同站范围内发现页面，并用 axe 自动检查。</p>
      <form onSubmit={submit}>
        <label htmlFor="url">网站 URL</label>
        <input
          id="url"
          type="url"
          required
          placeholder="https://example.com"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <label htmlFor="pages">最多扫描页面数</label>
        <input
          id="pages"
          type="number"
          min={1}
          max={15}
          value={maxPages}
          onChange={(event) => setMaxPages(Number(event.target.value))}
        />
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>{busy ? "正在创建…" : "开始 axe 扫描"}</button>
      </form>
    </section>
  );
}
