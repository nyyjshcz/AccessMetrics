"use client";
import { useCallback, useEffect, useRef, useState } from "react";
export default function IncompleteReview({
  runId,
  refreshKey = 0,
  onReviewChange,
}: {
  runId: string;
  refreshKey?: number;
  onReviewChange?: () => void;
}) {
  const [items, setItems] = useState<any[]>([]), [page, setPage] = useState(1), [meta, setMeta] = useState<any>(), [state, setState] = useState({ manualLocked: false, readOnly: false }), [selected, setSelected] = useState<any>(), [error, setError] = useState(""), [message, setMessage] = useState("");
  const mounted = useRef(true), request = useRef(0);
  const load = useCallback(async (p = page) => { const requestId = ++request.current; const r = await fetch(`/api/runs/${runId}/incomplete?page=${p}&pageSize=20`, { cache: "no-store" }); const d = await r.json(); if (!r.ok) throw new Error(d.error?.message ?? "读取待判断项目失败"); if (!mounted.current || requestId !== request.current) return; setItems(d.items ?? []); setMeta(d.pagination); setState({ manualLocked: Boolean(d.manualLocked), readOnly: Boolean(d.readOnly) }); setSelected((old: any) => d.items?.find((x: any) => x.id === old?.id) ?? d.items?.[0]); }, [runId, page]);
  useEffect(() => {
    mounted.current = true;
    void load().catch(e => { if (mounted.current) setError(e instanceof Error ? e.message : "读取待判断项目失败"); });
    return () => { mounted.current = false; request.current += 1; };
  }, [load, refreshKey]);
  useEffect(() => {
    if (!state.manualLocked) return;
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [load, state.manualLocked]);
  const locked = state.manualLocked, readOnly = state.readOnly;
  async function submit(verdict: string | null, note: string) { if (!selected || locked || readOnly) return; const r = await fetch(`/api/runs/${runId}/incomplete/${selected.id}/review`, verdict === null ? { method: "DELETE" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ verdict, note }) }); const d = await r.json(); if (!r.ok) { setError(d.error?.message ?? "保存失败"); return; } setMessage(verdict === null ? "已撤销人工判断" : "已保存人工判断"); onReviewChange?.(); await load(); }
  if (error) return <p className="error" role="alert">{error}</p>;
  return <div><div className="card"><p><strong>{meta?.total ?? 0}</strong> 个待判断节点 · 第 {meta?.page ?? page} / {meta?.totalPages ?? 1} 页</p>{locked && <p className="notice">AI 正在处理，人工编辑已锁定。</p>}{readOnly && <p className="notice">该扫描已发布，当前为只读。</p>}<div className="incomplete-list">{items.map((item, i) => <button type="button" key={item.id} className={selected?.id === item.id ? "incomplete-active" : "secondary"} onClick={() => setSelected(item)}>{(meta?.pageSize ?? 20) * (page - 1) + i + 1}. {item.rule.id} · {item.page.title || item.page.url}<br /><small>{item.resolution?.verdict ?? "未处理"} · 来源：{item.resolution?.source === "manual" ? "人工" : item.resolution?.source === "ai" ? "AI" : "原始"}</small></button>)}</div><div className="incomplete-actions"><button type="button" className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><button type="button" className="secondary" disabled={page >= (meta?.totalPages ?? 1)} onClick={() => setPage(page + 1)}>下一页</button></div></div>{selected && <div className="card" style={{ marginTop: 16 }}><h2>{selected.rule.id} · {selected.rule.description}</h2><p><a href={selected.page.url} target="_blank" rel="noreferrer">打开原网页：{selected.page.title || selected.page.url}</a></p><p><strong>axe 提示：</strong>{selected.failureSummary || "未提供 failureSummary"}</p><p><strong>规则：</strong><a href={selected.rule.helpUrl} target="_blank" rel="noreferrer">{selected.rule.help}</a> · WCAG {selected.rule.wcag?.join(", ") || "未标注"}</p><p><strong>当前结论：</strong>{selected.resolution?.verdict ?? "未处理"}（来源：{selected.resolution?.source === "manual" ? "人工" : selected.resolution?.source === "ai" ? "AI" : "原始 incomplete"}）</p>{selected.resolution?.ai && <p><strong>AI：</strong>{selected.resolution.ai.verdict} · {selected.resolution.ai.reason || "无理由"}</p>}<details><summary>目标元素与 technical evidence</summary><p><code>{JSON.stringify(selected.target)}</code></p><pre className="review-evidence">{selected.html || "（无 HTML 片段）"}</pre><pre className="review-evidence">{selected.evidence ? JSON.stringify(selected.evidence, null, 2) : "（无 evidence）"}</pre></details><ManualNoteEditor key={`${selected.id}:${selected.resolution?.manual?.note ?? ""}`} initialNote={selected.resolution?.manual?.note ?? ""} manualVerdict={selected.resolution?.manual?.verdict ?? null} locked={locked} readOnly={readOnly} onSubmit={submit} />{message && <p role="status">{message}</p>}</div>}</div>;
}

function ManualNoteEditor({ initialNote, manualVerdict, locked, readOnly, onSubmit }: { initialNote: string; manualVerdict: string | null; locked: boolean; readOnly: boolean; onSubmit: (verdict: string | null, note: string) => void }) {
  const [note, setNote] = useState(initialNote);
  const verdictButtons = [
    ["problem", "problem：存在问题"],
    ["not_problem", "not_problem：不构成问题"],
    ["uncertain", "uncertain：暂不确定"],
  ];
  return <><label htmlFor="incomplete-note">备注（可选）</label><textarea id="incomplete-note" value={note} onChange={e => setNote(e.target.value)} maxLength={2000} /><div className="incomplete-actions">{verdictButtons.map(([verdict, label]) => { const selected = manualVerdict === verdict; return <button type="button" key={verdict} className={selected ? "incomplete-active" : "secondary"} aria-pressed={selected} disabled={locked || readOnly} onClick={() => onSubmit(selected ? null : verdict, note)}>{label}</button>; })}</div></>;
}
