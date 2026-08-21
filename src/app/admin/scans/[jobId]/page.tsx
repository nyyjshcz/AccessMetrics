"use client";
import { useEffect, useState } from "react";
export default function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const [jobId, setJobId] = useState("");
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
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
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>正在读取任务…</p>;
  return (
    <section>
      <div className="card">
        <h1>扫描任务</h1>
        <p>
          <span className="pill">{data.job.status}</span> {data.job.origin}
        </p>
        <p className="muted">任务 ID：{data.job.id}</p>
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
