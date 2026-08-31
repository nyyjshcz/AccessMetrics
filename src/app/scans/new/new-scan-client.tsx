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
    <section className="scan-create-layout">
      <div className="card scan-form-card">
        <p className="eyebrow">START AN ASSESSMENT</p>
        <h1>扫描一个公开网站</h1>
        <p className="scan-form-lede">
          输入网站首页。系统只在同一站点范围内发现页面，并在浏览器渲染后使用 axe 自动检查。
        </p>
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
          <p className="field-help">请填公开、可访问的首页地址；系统会在创建任务时进行地址校验。</p>

          <label htmlFor="pages">最多扫描页面数</label>
          <input
            id="pages"
            type="number"
            min={1}
            max={15}
            value={maxPages}
            onChange={(event) => setMaxPages(Number(event.target.value))}
          />
          <p className="scan-limit-note" aria-live="polite">
            本次最多扫描 <strong>{maxPages}</strong>{" "}
            页。它是上限而非保证：可发现的独立页不足、重复页面合并或页面异常时，实际完成页数可能更少。
          </p>

          {error && <p className="error notice">{error}</p>}
          <button disabled={busy}>{busy ? "正在创建扫描任务…" : "开始 axe 扫描"}</button>
        </form>
      </div>

      <aside className="scan-method-card" aria-label="扫描会产生什么">
        <p className="section-kicker">WHAT THIS RUN CREATES</p>
        <h2>一份可回看的评估记录</h2>
        <ol className="scan-method-list">
          <li>
            <span>01</span>
            <div>
              <strong>页面覆盖</strong>
              <p>记录实际发现、成功、失败和未完成页面，不把上限误当成覆盖结果。</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>规则与节点</strong>
              <p>保留 axe 规则、目标元素与页面证据，便于后续核对。</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>分数与报告</strong>
              <p>按四项原则呈现结果；需要判断的项目不会伪装成自动结论。</p>
            </div>
          </li>
        </ol>
      </aside>
    </section>
  );
}
