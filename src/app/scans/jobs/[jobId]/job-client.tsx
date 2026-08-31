"use client";

import { useEffect, useState } from "react";
import StatusBadge from "@/components/status-badge";

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

  if (error)
    return (
      <p className="error notice" role="alert">
        {error}
      </p>
    );
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
  const progressBase = Math.max(1, discovered);
  const currentTarget = data.currentPage?.canonical_url ?? "等待扫描器领取页面";

  return (
    <section className="scan-progress-page">
      <div className="scan-progress-hero">
        <div>
          <p className="eyebrow">SCAN IN PROGRESS</p>
          <h1>{done ? "扫描任务已结束" : "正在检查网站"}</h1>
          <p className="scan-origin">{data.job.origin}</p>
        </div>
        <StatusBadge status={data.job.status} />
      </div>

      <section className="scan-progress-panel" aria-label="扫描进度">
        <div className="scan-progress-context">
          <p className="section-kicker">CURRENT ACTIVITY</p>
          <p>
            {done
              ? "本次扫描已停止更新。请先看页面覆盖，再打开结果理解规则与评分。"
              : currentTarget}
          </p>
        </div>
        <div
          className="progress-bar scan-progress-bar"
          aria-label="已处理页面比例"
          aria-valuemin={0}
          aria-valuemax={progressBase}
          aria-valuenow={Math.min(terminal, progressBase)}
          role="progressbar"
        >
          <span style={{ width: `${Math.min(100, (terminal / progressBase) * 100)}%` }} />
        </div>
        <div className="scan-progress-grid">
          <div>
            <span>已发现</span>
            <strong>{discovered}</strong>
            <small>{maxPages === null ? "页面" : `本次上限 ${maxPages} 页`}</small>
          </div>
          <div>
            <span>成功扫描</span>
            <strong>{success}</strong>
            <small>已写入规则结果</small>
          </div>
          <div>
            <span>页面异常</span>
            <strong>{failed}</strong>
            <small>可在结果页查看原因</small>
          </div>
          <div>
            <span>仍待处理</span>
            <strong>{queued + scanning}</strong>
            <small>{scanning > 0 ? `其中 ${scanning} 页正在扫描` : "等待 Worker 处理"}</small>
          </div>
        </div>
        <p className="scan-progress-note">
          “最多扫描页面数”是本次上限，不代表一定会发现同样多的可扫描页面。
          {deduplicated > 0 ? ` 本次有 ${deduplicated} 个重定向或重复页面已合并。` : ""}
        </p>
        {data.run && done ? (
          <a className="button-link" href={`/scans/${data.run.id}`}>
            查看扫描结果
          </a>
        ) : null}
      </section>
    </section>
  );
}
