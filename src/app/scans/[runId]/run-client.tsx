"use client";
import { useCallback, useEffect, useState } from "react";
import AiOverlayCard from "@/components/ai-overlay-card";
import IncompleteReview from "@/components/incomplete-review";
export default function RunClient({ runId }: { runId: string }) {
  const [data, setData] = useState<any>(); const [tab, setTab] = useState("overview"); const [violations, setViolations] = useState<any[]>([]); const [reviewRefreshKey, setReviewRefreshKey] = useState(0); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const fetchRun = useCallback(async () => { const r = await fetch(`/api/runs/${runId}`, { cache: "no-store" }); const d = await r.json(); if (!r.ok) throw new Error(d.error?.message ?? "读取扫描失败"); return d; }, [runId]);
  useEffect(() => { fetchRun().then(setData).catch(e => setError(e.message)); }, [fetchRun]);
  const aiBatchActive = data?.ai?.batch?.status === "queued" || data?.ai?.batch?.status === "running";
  useEffect(() => {
    if (!aiBatchActive) return;
    const timer = window.setInterval(() => { fetchRun().then(setData).catch(e => setError(e.message)); }, 2000);
    return () => window.clearInterval(timer);
  }, [aiBatchActive, fetchRun]);
  useEffect(() => { if (tab !== "violations" || violations.length) return; fetch(`/api/runs/${runId}/violations`, { cache: "no-store" }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error?.message ?? "读取自动问题失败"); return d; }).then(d => setViolations(d.items ?? [])).catch(e => setError(e.message)); }, [runId, tab, violations.length]);
  async function publish() { const r = await fetch(`/api/runs/${runId}/publish`, { method: "POST" }); const d = await r.json(); if (!r.ok) { setMessage(d.error?.message ?? "发布失败"); return; } setMessage("已发布，报告现在为只读"); setData((x: any) => ({ ...x, run: { ...x.run, published: 1 } })); }
  if (error) return <p className="error" role="alert">{error}</p>; if (!data) return <p role="status">正在读取扫描结果…</p>;
  const s = data.score, incomplete = s.resultNodeCounts?.incomplete ?? 0, violationCount = s.resultNodeCounts?.violation ?? 0; const tabs = [["overview", "概览"], ["violations", `自动问题 (${violationCount})`], ["incomplete", `incomplete 扫描结果 (${incomplete})`], ["report", "报告"]];
  const refreshAfterReviewChange = () => { setReviewRefreshKey((value) => value + 1); fetchRun().then(setData).catch(e => setError(e.message)); };
  return <section><div className="card"><p className="eyebrow">扫描结果</p><h1>{data.run.name}</h1><p className="muted">{data.run.origin} · {data.run.status}</p><div className="tabbar" role="tablist">{tabs.map(([key, label]) => <button type="button" key={key} role="tab" aria-selected={tab === key} className={tab === key ? "active" : "secondary"} onClick={() => setTab(key)}>{label}</button>)}</div>{tab === "overview" && <Overview score={s} data={data} />}{tab === "violations" && <ViolationList items={violations} />}{tab === "incomplete" && <><IncompleteReview runId={runId} refreshKey={reviewRefreshKey} onReviewChange={refreshAfterReviewChange} /><AiOverlayCard runId={runId} pages={data.pages ?? []} readOnly={data.run.published === 1} onBatchChange={refreshAfterReviewChange} /></>}{tab === "report" && <Report data={data} runId={runId} publish={publish} />}{message && <p role="status">{message}</p>}</div></section>;
}
function Overview({ score, data }: any) { const rawScore = data.rawScore ?? score; const aiBatchActive = data.ai?.batch?.status === "queued" || data.ai?.batch?.status === "running"; const display = (value: any) => value?.overall === null || value?.overall === undefined ? "无可计算数据" : `${value.overall} / 100`; return <><div className="score">{display(score)}</div><p>原始分数：{display(rawScore)} · AI/人工判定后有效分数：{display(score)}</p><p>页面 {score.pageCount} · 自动问题 {score.resultNodeCounts?.violation ?? 0} · incomplete 扫描结果 {score.resultNodeCounts?.incomplete ?? 0}</p>{aiBatchActive && <p className="notice">AI 正在判定 incomplete 扫描结果，概览分数会自动更新。</p>}<div className="grid">{[["可感知", score.perceivable], ["可操作", score.operable], ["易理解", score.understandable], ["兼容性", score.robust]].map(([n, v]) => <div className="card" key={String(n)}><h2>{n}</h2><div className="score">{v === null ? "N/A" : String(v)}</div></div>)}</div><p className="notice">下一步：查看自动问题，处理 incomplete 扫描结果，然后在报告页预览、导出或发布。</p>{data.run.published === 1 && <p className="notice">已发布：该扫描及报告为只读。</p>}</>; }
function ViolationList({ items }: { items: any[] }) { if (!items.length) return <p className="muted">没有自动问题。</p>; return <div><p><strong>{items.length}</strong> 个自动问题（axe violation，只读）</p>{items.map(item => <article className="card" style={{ marginTop: 12 }} key={item.id}><h2>{item.rule.id} · {item.rule.description}</h2><p><a href={item.page.url} target="_blank" rel="noreferrer">{item.page.title || item.page.url}</a></p><p><strong>提示：</strong>{item.failureSummary || "未提供 failureSummary"}</p><p><strong>目标元素：</strong><code>{JSON.stringify(item.target)}</code></p><p><a href={item.rule.helpUrl} target="_blank" rel="noreferrer">查看规则说明</a></p></article>)}</div>; }
function Report({ data, runId, publish }: any) {
  const score = data.score;
  const counts = score.resultNodeCounts ?? {};
  const published = data.run.published === 1;
  const pages = data.pages ?? [];
  return <div>
    <h2>报告预览</h2>
    <p>{data.run.origin} · {pages.length} 页 · 当前评分 {score.overall === null ? "无可计算数据" : `${score.overall} / 100`}</p>
    <p className="muted">以下为该扫描的全量统计和页面状态；发布前不会生成或展示任何导出链接。</p>
    <div className="grid">
      {[['通过节点', counts.pass ?? 0], ['自动问题', counts.violation ?? 0], ['待判断', counts.incomplete ?? 0], ['不适用', counts.inapplicable ?? 0]].map(([label, value]) => <div className="card" key={String(label)}><h3>{label}</h3><div className="score">{String(value)}</div></div>)}
    </div>
    <h3>四项原则</h3>
    <p>可感知：{score.perceivable ?? 'N/A'} · 可操作：{score.operable ?? 'N/A'} · 易理解：{score.understandable ?? 'N/A'} · 兼容性：{score.robust ?? 'N/A'}</p>
    <h3>页面状态（{pages.length} 页）</h3>
    <ul>{pages.map((page: any) => <li key={page.id ?? page.canonical_url}><a href={page.canonical_url} target="_blank" rel="noreferrer">{page.title || page.canonical_url}</a> · {page.scan_status}{page.http_status ? ` · HTTP ${page.http_status}` : ''}{page.error_code ? ` · ${page.error_code}` : ''}</li>)}</ul>
    {published ? <>
      <p className="notice">已发布：报告和扫描数据为只读，可匿名下载完整报告。</p>
      <p><a href={`/api/reports/${runId}/html`} target="_blank" rel="noreferrer">打开 HTML</a>{" · "}<a href={`/api/reports/${runId}/pdf`}>下载 PDF</a>{" · "}<a href={`/api/reports/${runId}/json`}>下载 JSON</a></p>
    </> : <>
      <p className="notice">发布后可下载 HTML、PDF、JSON；未发布报告仅供本地预览。</p>
      {data.run.status.startsWith("completed") && <button type="button" onClick={publish}>生成并发布报告</button>}
    </>}
  </div>;
}
