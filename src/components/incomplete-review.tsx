"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ResolutionSummary = {
  verdict?: string | null;
  source?: "manual" | "ai" | "raw" | null;
  manual?: { verdict?: string | null; note?: string | null } | null;
  ai?: { verdict?: string | null; reason?: string | null } | null;
};

function verdictLabel(verdict: string | null | undefined) {
  if (verdict === "problem") return "存在问题";
  if (verdict === "not_problem") return "不构成问题";
  if (verdict === "uncertain") return "暂不确定";
  return "尚未给出结论";
}

function sourceLabel(resolution?: ResolutionSummary | null) {
  if (!resolution || resolution.source === "raw") return "原始 incomplete（尚未解决）";
  if (resolution.source === "manual") return `人工判定：${verdictLabel(resolution.verdict)}`;
  if (resolution.source === "ai") return `AI 判定：${verdictLabel(resolution.verdict)}`;
  return verdictLabel(resolution.verdict);
}

export default function IncompleteReview({
  runId,
  refreshKey = 0,
  onReviewChange,
}: {
  runId: string;
  refreshKey?: number;
  onReviewChange?: () => void;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<any>();
  const [state, setState] = useState({ manualLocked: false, readOnly: false });
  const [selected, setSelected] = useState<any>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  const request = useRef(0);

  const load = useCallback(
    async (requestedPage = page) => {
      const requestId = ++request.current;
      const response = await fetch(
        `/api/runs/${runId}/incomplete?page=${requestedPage}&pageSize=20`,
        {
          cache: "no-store",
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "读取 incomplete 扫描结果失败");
      if (!mounted.current || requestId !== request.current) return;
      setItems(payload.items ?? []);
      setMeta(payload.pagination);
      setState({
        manualLocked: Boolean(payload.manualLocked),
        readOnly: Boolean(payload.readOnly),
      });
      setSelected(
        (previous: any) =>
          payload.items?.find((item: any) => item.id === previous?.id) ?? payload.items?.[0],
      );
    },
    [page, runId],
  );

  useEffect(() => {
    mounted.current = true;
    void load().catch((reason) => {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : "读取 incomplete 扫描结果失败");
    });
    return () => {
      mounted.current = false;
      request.current += 1;
    };
  }, [load, refreshKey]);

  useEffect(() => {
    if (!state.manualLocked) return;
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [load, state.manualLocked]);

  const locked = state.manualLocked;
  const readOnly = state.readOnly;

  async function submit(verdict: string | null, note: string) {
    if (!selected || locked || readOnly) return;
    const response = await fetch(
      `/api/runs/${runId}/incomplete/${selected.id}/review`,
      verdict === null
        ? { method: "DELETE" }
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ verdict, note }),
          },
    );
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error?.message ?? "保存失败");
      return;
    }
    setMessage(verdict === null ? "已撤销人工判断。" : "已保存人工判断。评分会随复核结果更新。");
    onReviewChange?.();
    await load();
  }

  if (error)
    return (
      <p className="error notice" role="alert">
        {error}
      </p>
    );

  return (
    <section className="review-workbench">
      <header className="review-workbench-header">
        <div>
          <p className="section-kicker">REVIEW QUEUE</p>
          <h2>需要进一步判断的扫描结果</h2>
          <p>
            axe 将这些项目标记为 <code>incomplete</code>
            ，意味着自动工具不能可靠地下结论。请结合页面与证据作出人工判断；不判断也会如实保留为原始
            incomplete。
          </p>
        </div>
        <div className="review-count">
          <span>本次待复核</span>
          <strong>{meta?.total ?? 0}</strong>
        </div>
      </header>

      {locked ? (
        <p className="notice">AI 正在处理，人工编辑暂时锁定；结果返回后会自动刷新。</p>
      ) : null}
      {readOnly ? <p className="notice">该扫描已发布，复核区现在只读。</p> : null}

      <div className="review-workbench-grid">
        <div className="review-queue" aria-label="待复核项目列表">
          <div className="review-queue-heading">
            <span>
              第 {meta?.page ?? page} / {meta?.totalPages ?? 1} 页
            </span>
            <span>每页 20 项</span>
          </div>
          <div className="incomplete-list">
            {items.map((item, index) => (
              <button
                type="button"
                key={item.id}
                className={selected?.id === item.id ? "incomplete-active" : "secondary"}
                onClick={() => setSelected(item)}
              >
                <span className="review-item-number">
                  {(meta?.pageSize ?? 20) * (page - 1) + index + 1}
                </span>
                <span className="review-item-copy">
                  <strong>{item.rule.id}</strong>
                  <small>{item.page.title || item.page.url}</small>
                </span>
                <small className="review-item-resolution">{sourceLabel(item.resolution)}</small>
              </button>
            ))}
          </div>
          <div className="incomplete-actions review-pagination">
            <button
              type="button"
              className="secondary"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </button>
            <button
              type="button"
              className="secondary"
              disabled={page >= (meta?.totalPages ?? 1)}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
          </div>
        </div>

        {selected ? (
          <article className="review-detail">
            <div className="review-detail-heading">
              <p className="rule-id">{selected.rule.id}</p>
              <h3>{selected.rule.description}</h3>
              <p className="review-resolution">{sourceLabel(selected.resolution)}</p>
            </div>
            <dl className="finding-details">
              <div>
                <dt>问题页面</dt>
                <dd>
                  <a href={selected.page.url} target="_blank" rel="noreferrer">
                    打开原网页：{selected.page.title || selected.page.url}
                  </a>
                </dd>
              </div>
              <div>
                <dt>axe 提示</dt>
                <dd>{selected.failureSummary || "未提供 failureSummary"}</dd>
              </div>
              <div>
                <dt>规则依据</dt>
                <dd>
                  <a href={selected.rule.helpUrl} target="_blank" rel="noreferrer">
                    {selected.rule.help}
                  </a>
                  {selected.rule.wcag?.length
                    ? ` · WCAG ${selected.rule.wcag.join(", ")}`
                    : " · WCAG 未标注"}
                </dd>
              </div>
            </dl>

            {selected.resolution?.ai ? (
              <aside className="ai-reason">
                <strong>AI 的辅助判断</strong>
                <p>
                  {verdictLabel(selected.resolution.ai.verdict)} ·{" "}
                  {selected.resolution.ai.reason || "未提供理由"}
                </p>
              </aside>
            ) : null}

            <details className="evidence-disclosure">
              <summary>查看目标元素与技术证据</summary>
              <p>
                <code>{JSON.stringify(selected.target)}</code>
              </p>
              <pre className="review-evidence">{selected.html || "（无 HTML 片段）"}</pre>
              <pre className="review-evidence">
                {selected.evidence ? JSON.stringify(selected.evidence, null, 2) : "（无 evidence）"}
              </pre>
            </details>

            <ManualNoteEditor
              key={`${selected.id}:${selected.resolution?.manual?.note ?? ""}`}
              initialNote={selected.resolution?.manual?.note ?? ""}
              manualVerdict={selected.resolution?.manual?.verdict ?? null}
              locked={locked}
              readOnly={readOnly}
              onSubmit={submit}
            />
            {message ? (
              <p className="notice" role="status">
                {message}
              </p>
            ) : null}
          </article>
        ) : (
          <div className="empty-state app-empty-state">
            <strong>这一页没有可复核项目</strong>
            <p>可以切换页面，或返回概览查看自动问题和报告。</p>
          </div>
        )}
      </div>
    </section>
  );
}

function ManualNoteEditor({
  initialNote,
  manualVerdict,
  locked,
  readOnly,
  onSubmit,
}: {
  initialNote: string;
  manualVerdict: string | null;
  locked: boolean;
  readOnly: boolean;
  onSubmit: (verdict: string | null, note: string) => void;
}) {
  const [note, setNote] = useState(initialNote);
  const verdictButtons = [
    ["problem", "存在问题"],
    ["not_problem", "不构成问题"],
    ["uncertain", "暂不确定"],
  ];

  return (
    <section className="manual-review" aria-labelledby="manual-review-heading">
      <div>
        <p className="section-kicker">MANUAL REVIEW</p>
        <h3 id="manual-review-heading">给出人工判断</h3>
        <p>点击已选按钮可撤销判断，恢复为“原始 incomplete（尚未解决）”。人工判断优先于 AI 判断。</p>
      </div>
      <label htmlFor="incomplete-note">备注（可选）</label>
      <textarea
        id="incomplete-note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={2000}
        disabled={locked || readOnly}
      />
      <div className="incomplete-actions">
        {verdictButtons.map(([verdict, label]) => {
          const selected = manualVerdict === verdict;
          return (
            <button
              type="button"
              key={verdict}
              className={selected ? "incomplete-active" : "secondary"}
              aria-pressed={selected}
              disabled={locked || readOnly}
              onClick={() => onSubmit(selected ? null : verdict, note)}
            >
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
