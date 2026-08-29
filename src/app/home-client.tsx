"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type HomeClientProps = {
  view: "active" | "published";
};

type ScanListRow = {
  run_id: string | null;
  run_status: string | null;
  published: number | null;
  job_id: string;
  job_status: string;
  name: string;
  origin: string;
};

const deletableStatuses = new Set(["completed", "failed", "cancelled"]);

export default function HomeClient({ view }: HomeClientProps) {
  const [runs, setRuns] = useState<ScanListRow[]>([]);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const fetchRuns = useCallback(async () => {
    const response = await fetch(`/api/scans?view=${view}`);
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error("读取任务列表失败");
    return (payload?.runs ?? []) as ScanListRow[];
  }, [view]);

  const load = useCallback(async () => {
    setRuns(await fetchRuns());
  }, [fetchRuns]);

  useEffect(() => {
    let cancelled = false;
    void fetchRuns()
      .then((nextRuns) => {
        if (!cancelled) setRuns(nextRuns);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fetchRuns]);

  async function deleteTask(row: ScanListRow) {
    const confirmed = window.confirm(
      `删除“${row.name}”的扫描任务及其未发布结果？此操作不可恢复。`,
    );
    if (!confirmed) return;

    setDeleteError("");
    setDeletingJobId(row.job_id);
    try {
      const response = await fetch(`/api/scans/${row.job_id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "删除任务失败");
      await load();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除任务失败");
    } finally {
      setDeletingJobId(null);
    }
  }

  return (
    <>
      <section className="card">
        <p className="eyebrow">AccessCheck Lishui</p>
        <h1>把网站无障碍问题，一步步变成可发布的报告</h1>
        <p className="muted">
          输入一个公开网站，系统会在同站范围内发现页面，使用 Playwright + axe-core
          扫描，将规则结果、节点证据和可复核评分保存到 SQLite，并生成结构化导出。
        </p>
        <p className="muted" role="note">
          本项目仅评价 axe-core 能够自动判断的网页无障碍检查项。分数不等同于完整人工审计、官方 WCAG
          合规认证或“符合 WCAG 的百分比”。需要人工判断的项目会单独列出。
        </p>
        <p>
          <span className="pill">评分模型 accesscheck-score-v1</span>{" "}
          <span className="pill">WCAG 2.2 映射</span> <span className="pill">可追溯导出</span>
        </p>
        <Link href="/scans/new">
          <button style={{ width: "auto", paddingInline: 24 }}>新建扫描</button>
        </Link>
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <div className="section-heading">
          <div>
            <h2>{view === "published" ? "已发布报告" : "活动任务"}</h2>
            <p className="muted">
              {view === "published" ? "已发布的结果为只读，可随时打开。" : "正在扫描或尚未发布的任务。"}
            </p>
          </div>
          <Link href={view === "published" ? "/scans" : "/reports"}>
            {view === "published" ? "查看活动任务" : "查看已发布报告"}
          </Link>
        </div>
        {deleteError ? (
          <p className="error" role="alert">
            {deleteError}
          </p>
        ) : null}
        {runs.length === 0 ? (
          <p className="muted">暂无记录。</p>
        ) : (
          <div className="run-list">
            {runs.map((row) => {
              const status = row.run_status ?? row.job_status;
              const deletable =
                view === "active" && row.published !== 1 && deletableStatuses.has(row.job_status);
              const destination =
                status === "completed" || status === "completed_with_errors"
                  ? (`/scans/${row.run_id ?? row.job_id}` as `/scans/${string}`)
                  : (`/scans/jobs/${row.job_id}` as `/scans/jobs/${string}`);
              return (
                <div className="run-row" key={row.run_id ?? row.job_id}>
                  <Link className="run-row-link" href={destination}>
                    <div className="run-row-info">
                      <strong>{row.name}</strong>
                      <span className="muted">{row.origin}</span>
                    </div>
                    <span className="pill">{row.published ? "已发布" : status}</span>
                  </Link>
                  {deletable ? (
                    <div className="run-row-actions">
                      <button
                        type="button"
                        className="danger-button"
                        disabled={deletingJobId !== null}
                        onClick={() => void deleteTask(row)}
                      >
                        {deletingJobId === row.job_id ? "删除中…" : "删除"}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
      <section className="grid" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>可感知</h2>
          <p>图片替代文本、颜色对比度、内容结构等。</p>
        </div>
        <div className="card">
          <h2>可操作</h2>
          <p>键盘操作、链接和按钮名称、焦点路径等。</p>
        </div>
        <div className="card">
          <h2>易理解</h2>
          <p>语言、标题、表单标签和错误提示等。</p>
        </div>
        <div className="card">
          <h2>兼容性</h2>
          <p>ARIA 角色、重复 ID 与辅助技术语义等。</p>
        </div>
      </section>
    </>
  );
}
