"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import StatusBadge from "@/components/status-badge";

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

const principles = [
  ["可感知", "P", "替代文本、颜色对比度、内容结构"],
  ["可操作", "O", "键盘操作、焦点、链接与控件名称"],
  ["易理解", "U", "语言、标题、表单标签与反馈"],
  ["兼容性", "R", "ARIA 语义、ID 与辅助技术兼容性"],
];

export default function HomeClient({ view }: HomeClientProps) {
  const isPublishedView = view === "published";
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
    const confirmed = window.confirm(`删除“${row.name}”的扫描任务及其未发布结果？此操作不可恢复。`);
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

  const heroTitle = isPublishedView ? "已发布报告" : "把网站无障碍问题，变成可以核对的结论";

  return (
    <>
      <section className={`home-hero ${isPublishedView ? "home-hero-reports" : ""}`}>
        <div className="home-hero-copy">
          <p className="eyebrow">
            {isPublishedView ? "REPORT LIBRARY" : "ACCESSIBILITY RESEARCH WORKBENCH"}
          </p>
          <h1>{heroTitle}</h1>
          <p className="home-hero-lede">
            {isPublishedView
              ? "这是面向评审者的只读报告库。每份报告从优先整改事项开始，并保留评分、覆盖范围和节点级证据。"
              : "从公开网站开始，系统完成同站页面发现、浏览器渲染检查、规则归类与可追溯报告。分数用于比较和筛查，证据用于复核。"}
          </p>
          {!isPublishedView ? (
            <div className="hero-actions">
              <Link className="button-link" href="/scans/new">
                新建扫描
              </Link>
              <Link className="text-link" href="/reports">
                查看已发布报告 <span aria-hidden="true">→</span>
              </Link>
            </div>
          ) : null}
        </div>
        <aside className="home-method" aria-label={isPublishedView ? "报告阅读说明" : "评估方法"}>
          {isPublishedView ? (
            <>
              <p className="method-label">阅读顺序</p>
              <ol className="method-list">
                <li>
                  <span>01</span>
                  <strong>先看有效评分与覆盖范围</strong>
                </li>
                <li>
                  <span>02</span>
                  <strong>再看高优先级整改事项</strong>
                </li>
                <li>
                  <span>03</span>
                  <strong>必要时展开节点证据核对</strong>
                </li>
              </ol>
            </>
          ) : (
            <>
              <p className="method-label">评估路径</p>
              <ol className="method-list">
                <li>
                  <span>01</span>
                  <strong>发现同站页面</strong>
                </li>
                <li>
                  <span>02</span>
                  <strong>以真实浏览器状态运行 axe</strong>
                </li>
                <li>
                  <span>03</span>
                  <strong>把规则、节点与结论写入报告</strong>
                </li>
              </ol>
            </>
          )}
        </aside>
      </section>

      <section className="content-section">
        <div className="section-heading section-heading-spacious">
          <div>
            <p className="section-kicker">
              {isPublishedView ? "PUBLISHED OUTPUT" : "CURRENT WORK"}
            </p>
            <h2>{isPublishedView ? "报告列表" : "活动任务"}</h2>
            <p className="muted">
              {isPublishedView
                ? "报告一经发布即为只读，管理员和报告访客看到的内容一致。"
                : "这里显示正在扫描、等待处理或尚未发布的任务；已发布内容移至报告库。"}
            </p>
          </div>
          {!isPublishedView ? (
            <Link className="text-link" href="/reports">
              打开报告库 <span aria-hidden="true">→</span>
            </Link>
          ) : null}
        </div>

        {deleteError ? (
          <p className="error notice" role="alert">
            {deleteError}
          </p>
        ) : null}

        {runs.length === 0 ? (
          <div className="empty-state app-empty-state">
            <strong>{isPublishedView ? "还没有已发布报告" : "当前没有活动任务"}</strong>
            <p>
              {isPublishedView
                ? "完成扫描并发布后，报告会出现在这里，供持有访客密钥的人只读查看。"
                : "从一个公开网站开始创建扫描；系统会记录页面覆盖、规则结果和可复核的节点证据。"}
            </p>
            {!isPublishedView ? (
              <Link className="button-link button-link-compact" href="/scans/new">
                新建扫描
              </Link>
            ) : null}
          </div>
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
                <article className="run-row" key={row.run_id ?? row.job_id}>
                  <Link className="run-row-link" href={destination}>
                    <div className="run-row-info">
                      <strong>{row.name}</strong>
                      <span className="muted">{row.origin}</span>
                    </div>
                    <span className="run-row-open" aria-hidden="true">
                      查看 <span>→</span>
                    </span>
                  </Link>
                  <div className="run-row-meta">
                    <StatusBadge status={status} published={row.published === 1} />
                    {deletable ? (
                      <button
                        type="button"
                        className="danger-button compact-button"
                        disabled={deletingJobId !== null}
                        onClick={() => void deleteTask(row)}
                      >
                        {deletingJobId === row.job_id ? "删除中…" : "删除"}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {!isPublishedView ? (
        <section className="principle-section" aria-labelledby="principle-heading">
          <div className="section-heading section-heading-spacious">
            <div>
              <p className="section-kicker">WCAG PRINCIPLES</p>
              <h2 id="principle-heading">四项评估维度</h2>
            </div>
            <p className="muted principle-summary">
              结果按可感知、可操作、易理解和兼容性组织；它们是报告的阅读框架，不是“合规百分比”。
            </p>
          </div>
          <div className="principle-overview">
            {principles.map(([name, initials, description]) => (
              <article key={name}>
                <span aria-hidden="true">{initials}</span>
                <div>
                  <h3>{name}</h3>
                  <p>{description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
