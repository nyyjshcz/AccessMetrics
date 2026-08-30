"use client";

import { useEffect, useState } from "react";

export default function JobClient({ jobId }: { jobId: string }) {
  const [id] = useState(jobId);
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const response = await fetch(`/api/scans/${id}`);
      const value = await response.json();
      if (!response.ok) {
        setError(value.error?.message ?? "读取任务失败");
        return;
      }
      setData(value);
      if (["queued", "running"].includes(value.job.status)) timer = setTimeout(load, 1500);
    };
    void load();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p role="status">正在准备扫描…</p>;

  const done = ["completed", "completed_with_errors", "failed", "cancelled"].includes(
    data.job.status,
  );
  const progress = data.progress ?? {};
  const discovered = Number(progress.discovered ?? 0);
  const success = Number(progress.success ?? 0);
  const failed = Number(progress.failed ?? 0);
  const deduplicated = Number(progress.deduplicated ?? 0);
  const queued = Number(progress.queued ?? 0);
  const scanning = Number(progress.scanning ?? 0);
  let maxPages: number | null = null;
  try {
    const value = JSON.parse(data.job.options_json ?? "{}")?.maxPages;
    if (Number.isInteger(value)) maxPages = value;
  } catch {
    // The scan remains readable even if an old job has malformed options.
  }
  const terminal = success + failed + deduplicated + Number(progress.cancelled ?? 0);

  return (
    <section>
      <div className="card">
        <p className="eyebrow">第二步 · axe 扫描</p>
        <h1>正在检查 {data.job.origin}</h1>
        <p>
          <span className="pill">{data.job.status}</span>
        </p>
        <p className="muted">
          {done ? "扫描已结束" : (data.currentPage?.canonical_url ?? "等待扫描器处理")}
        </p>
        <div className="progress-bar">
          <span style={{ width: `${Math.min(100, (terminal / Math.max(1, discovered)) * 100)}%` }} />
        </div>
        <p>
          已发现 {discovered} 页{maxPages === null ? "" : `（最多 ${maxPages} 页）`} · 成功 {success} 页
          {deduplicated > 0 ? ` · 重定向重复已合并 ${deduplicated} 页` : ""} · 失败 {failed} 页
          {scanning > 0 ? ` · 扫描中 ${scanning} 页` : ""}
          {queued > 0 ? ` · 待处理 ${queued} 页` : ""}
        </p>
        {data.run && done ? (
          <a href={`/scans/${data.run.id}`}>
            <button>查看扫描结果</button>
          </a>
        ) : null}
      </div>
    </section>
  );
}
