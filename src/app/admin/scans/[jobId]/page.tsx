"use client";
import { useEffect, useState } from "react";
export default function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const [jobId, setJobId] = useState("");
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    params.then((p) => setJobId(p.jobId));
  }, [params]);
  useEffect(() => {
    if (!jobId) return;
    let timer: any;
    const load = async () => {
      const r = await fetch(`/api/scans/${jobId}`);
      const d = await r.json();
      if (!r.ok) {
        setError(d.error?.message ?? "读取失败");
        return;
      }
      setData(d);
      if (["queued", "running"].includes(d.job.status)) timer = setTimeout(load, 1500);
    };
    load();
    return () => clearTimeout(timer);
  }, [jobId]);
  async function cancel() {
    const csrf = document.cookie.match(/(?:^|; )accesscheck_csrf=([^;]+)/)?.[1] ?? "";
    const response = await fetch(`/api/admin/scans/${jobId}/cancel`, {
      method: "POST",
      headers: { "x-csrf-token": csrf },
    });
    const value = await response.json();
    if (!response.ok) setError(value.error?.message ?? "取消失败");
    else setMessage("已请求取消任务，已完成页面会保留。");
  }
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>正在读取任务…</p>;
  const startedAt = data.job.started_at ?? data.job.created_at;
  const finishedAt = data.job.finished_at;
  const elapsedMs = startedAt
    ? new Date(finishedAt ?? new Date().toISOString()).getTime() - new Date(startedAt).getTime()
    : null;
  const elapsed = elapsedMs === null ? "N/A" : `${Math.max(0, Math.round(elapsedMs / 1000))} 秒`;
  return (
    <section>
      <div className="card">
        <h1>扫描任务</h1>
        <p>
          <span className="pill">{data.job.status}</span> {data.job.origin}
        </p>
        <p className="muted">任务 ID：{data.job.id}</p>
        <p>
          开始：{startedAt ?? "尚未开始"}；结束：{finishedAt ?? "进行中"}；耗时：{elapsed}
        </p>
        <p>
          当前页面：
          {data.currentPage?.canonical_url ?? (data.job.status === "queued" ? "等待 Worker" : "无")}
        </p>
        {!["completed", "completed_with_errors", "failed", "cancelled"].includes(
          data.job.status,
        ) && (
          <button type="button" className="secondary" onClick={cancel}>
            取消任务
          </button>
        )}
        {message && <p role="status">{message}</p>}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>页面处理进度</h2>
        <p role="status" aria-live="polite">
          已发现 {data.progress?.discovered ?? 0} 页；成功 {data.progress?.success ?? 0} 页； 失败{" "}
          {data.progress?.failed ?? 0} 页；正在处理 {data.progress?.scanning ?? 0} 页； 剩余{" "}
          {data.progress?.queued ?? 0} 页
        </p>
        <table>
          <thead>
            <tr>
              <th>状态</th>
              <th>数量</th>
            </tr>
          </thead>
          <tbody>
            {data.pageCounts.map((row: any) => (
              <tr key={row.status}>
                <td>{row.status}</td>
                <td>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.run &&
        ["completed", "completed_with_errors", "failed", "cancelled"].includes(data.run.status) ? (
          <p style={{ marginTop: 16 }}>
            <a href={`/scans/${data.run.id}`}>查看扫描结果与评分</a>
          </p>
        ) : null}
      </div>
    </section>
  );
}
