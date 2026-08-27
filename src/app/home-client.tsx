"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type HomeClientProps = {
  view: "active" | "published";
};

export default function HomeClient({ view }: HomeClientProps) {
  const [runs, setRuns] = useState<any[]>([]);
  useEffect(() => { fetch(`/api/scans?view=${view}`).then(r => r.json()).then(d => setRuns(d.runs ?? [])); }, [view]);
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
        <Link href="/scans/new"><button style={{ width: "auto", paddingInline: 24 }}>新建扫描</button></Link>
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <div className="section-heading"><div><h2>{view === "published" ? "已发布报告" : "活动任务"}</h2><p className="muted">{view === "published" ? "已发布的结果为只读，可随时打开。" : "正在扫描或尚未发布的任务。"}</p></div><Link href={view === "published" ? "/scans" : "/reports"}>{view === "published" ? "查看活动任务" : "查看已发布报告"}</Link></div>
        {runs.length === 0 ? <p className="muted">暂无记录。</p> : <div className="run-list">{runs.map(r => <Link className="run-row" key={r.run_id} href={r.run_status === "completed" || r.run_status === "completed_with_errors" ? `/scans/${r.run_id}` : `/scans/jobs/${r.job_id}`}><div><strong>{r.name}</strong><span className="muted">{r.origin}</span></div><span className="pill">{r.published ? "已发布" : r.run_status}</span></Link>)}</div>}
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
