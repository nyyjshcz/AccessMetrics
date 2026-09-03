"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getMessages, type Locale } from "@/lib/i18n";
import { getRuleLocalization } from "@/lib/localization";

type ResolutionSummary = {
  verdict?: string | null;
  source?: "manual" | "ai" | "raw" | null;
  manual?: { verdict?: string | null; note?: string | null } | null;
  ai?: { verdict?: string | null; reason?: string | null } | null;
};

function verdictLabel(verdict: string | null | undefined, en = false) {
  if (en) {
    if (verdict === "problem") return "Problem";
    if (verdict === "not_problem") return "Not a problem";
    if (verdict === "uncertain") return "Uncertain";
    return "No verdict yet";
  }
  if (verdict === "problem") return "存在问题";
  if (verdict === "not_problem") return "不构成问题";
  if (verdict === "uncertain") return "暂不确定";
  return "尚未给出结论";
}

function sourceLabel(resolution?: ResolutionSummary | null, en = false) {
  if (!resolution || resolution.source === "raw")
    return en ? "Needs review" : "待复核";
  if (resolution.source === "manual")
    return `${en ? "Manual" : "人工"}: ${verdictLabel(resolution.verdict, en)}`;
  if (resolution.source === "ai") return `AI: ${verdictLabel(resolution.verdict, en)}`;
  return verdictLabel(resolution.verdict, en);
}

export default function IncompleteReview({
  runId,
  locale = "zh-CN",
  refreshKey = 0,
  onReviewChange,
}: {
  runId: string;
  locale?: Locale;
  refreshKey?: number;
  onReviewChange?: () => void;
}) {
  const en = locale === "en";
  const copy = getMessages(en ? "en" : "zh-CN").ai;
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
      if (!response.ok)
        throw new Error(
          payload.error?.message ??
            (en ? "Failed to load review items" : "读取复核项目失败"),
        );
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
    [en, page, runId],
  );

  useEffect(() => {
    mounted.current = true;
    void load().catch((reason) => {
      if (mounted.current)
        setError(
          reason instanceof Error
            ? reason.message
            : en
              ? "Failed to load review items"
              : "读取复核项目失败",
        );
    });
    return () => {
      mounted.current = false;
      request.current += 1;
    };
  }, [en, load, refreshKey]);

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
      setError(payload.error?.message ?? (en ? "Failed to save manual verdict" : "保存人工结论失败"));
      return;
    }
    setMessage(
      verdict === null
        ? en
          ? "Manual verdict removed."
          : "已撤销人工判断。"
        : en
          ? "Manual verdict saved. The score will update."
          : "已保存人工判断。评分会随复核结果更新。",
    );
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
          <h2>{en ? "Review items" : "复核项目"}</h2>
          <p>
            {en ? (
              <>
                The automatic check could not settle these items on its own. Review is optional;
                items with an AI or human conclusion remain visible so you can verify them.
              </>
            ) : (
              <>
                自动检查无法单独确定这些项目。复核是可选的；已有 AI 或人工结论的项目仍会保留，便于核对。
              </>
            )}
          </p>
        </div>
        <div className="review-count">
          <span>{en ? "Review items" : "复核项目"}</span>
          <strong>{meta?.resolution?.total ?? meta?.total ?? 0}</strong>
          <small>
            {en
              ? `${meta?.resolution?.unresolved ?? meta?.total ?? 0} needs review`
              : `待复核 ${meta?.resolution?.unresolved ?? meta?.total ?? 0} 项`}
          </small>
        </div>
      </header>

      {meta?.resolution ? (
        <div
          className="review-resolution-summary"
          aria-label={en ? "Review status summary" : "复核情况摘要"}
        >
          <span>
            {copy.aiConclusions}
            <strong>{meta.resolution.aiResolved}</strong>
          </span>
          <span>
            {copy.manualConclusions}
            <strong>{meta.resolution.manualResolved}</strong>
          </span>
          <span>
            {copy.noConclusionYet}
            <strong>{meta.resolution.unresolved}</strong>
          </span>
        </div>
      ) : null}

      {locked ? (
        <p className="notice">
          {en
            ? "AI is processing; manual editing is temporarily locked and will refresh automatically."
            : "AI 正在处理，人工编辑暂时锁定；结果返回后会自动刷新。"}
        </p>
      ) : null}
      {readOnly ? (
        <p className="notice">
          {en ? "This scan is published; review is read-only." : "该扫描已发布，复核区现在只读。"}
        </p>
      ) : null}

      <div className="review-workbench-grid">
        <div
          className="review-queue"
          aria-label={en ? "Review items" : "复核项目列表"}
        >
          <div className="review-queue-heading">
            <span>
              {en
                ? `Page ${meta?.page ?? page} / ${meta?.totalPages ?? 1}`
                : `第 ${meta?.page ?? page} / ${meta?.totalPages ?? 1} 页`}
            </span>
            <span>{en ? "20 per page" : "每页 20 项"}</span>
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
                <small className="review-item-resolution">{sourceLabel(item.resolution, en)}</small>
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
              {en ? "Previous" : "上一页"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={page >= (meta?.totalPages ?? 1)}
              onClick={() => setPage(page + 1)}
            >
              {en ? "Next" : "下一页"}
            </button>
          </div>
        </div>

        {selected ? (
          <article className="review-detail">
            <div className="review-detail-heading">
              <p className="rule-id">{selected.rule.id}</p>
              <h3>
                {en ? selected.rule.description : getRuleLocalization(selected.rule.id).zhName}
              </h3>
              <p className="review-resolution">{sourceLabel(selected.resolution, en)}</p>
            </div>
            <dl className="finding-details">
              <div>
                <dt>{en ? "Affected page" : "问题页面"}</dt>
                <dd>
                  <a href={selected.page.url} target="_blank" rel="noreferrer">
                    {en ? "Open source page: " : "打开原网页："}
                    {selected.page.title || selected.page.url}
                  </a>
                </dd>
              </div>
              <div>
                <dt>{en ? "axe summary" : "axe 提示"}</dt>
                <dd>
                  {selected.failureSummary ||
                    (en ? "No failureSummary provided" : "未提供 failureSummary")}
                </dd>
              </div>
              <div>
                <dt>{en ? "Rule guidance" : "规则依据"}</dt>
                <dd>
                  <a href={selected.rule.helpUrl} target="_blank" rel="noreferrer">
                    {en ? selected.rule.help : getRuleLocalization(selected.rule.id).zhFix}
                  </a>
                  {selected.rule.wcag?.length
                    ? ` · WCAG ${selected.rule.wcag.join(", ")}`
                    : en
                      ? " · WCAG not tagged"
                      : " · WCAG 未标注"}
                </dd>
              </div>
            </dl>

            {selected.resolution?.ai ? (
              <aside className="ai-reason">
                <strong>{en ? "AI-assisted judgment" : "AI 的辅助判断"}</strong>
                <p>
                  {verdictLabel(selected.resolution.ai.verdict, en)} ·{" "}
                  {selected.resolution.ai.reason || (en ? "No reason provided" : "未提供理由")}
                </p>
              </aside>
            ) : null}

            <details className="evidence-disclosure">
              <summary>
                {en ? "View target element and technical evidence" : "查看目标元素与技术证据"}
              </summary>
              <p>
                <code>{JSON.stringify(selected.target)}</code>
              </p>
              <pre className="review-evidence">
                {selected.html || (en ? "(No HTML snippet)" : "（无 HTML 片段）")}
              </pre>
              <pre className="review-evidence">
                {selected.evidence
                  ? JSON.stringify(selected.evidence, null, 2)
                  : en
                    ? "(No evidence)"
                    : "（无 evidence）"}
              </pre>
            </details>

            <ManualNoteEditor
              key={`${selected.id}:${selected.resolution?.manual?.note ?? ""}`}
              initialNote={selected.resolution?.manual?.note ?? ""}
              manualVerdict={selected.resolution?.manual?.verdict ?? null}
              locked={locked}
              readOnly={readOnly}
              onSubmit={submit}
              locale={locale}
            />
            {message ? (
              <p className="notice" role="status">
                {message}
              </p>
            ) : null}
          </article>
        ) : (
          <div className="empty-state app-empty-state">
            <strong>{en ? "No review items on this page" : "这一页没有可复核项目"}</strong>
            <p>
              {en
                ? "Switch pages, or return to the scan flow to open the full report."
                : "可以切换页面，或返回扫描流程页打开完整报告。"}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function ManualNoteEditor({
  initialNote,
  locale = "zh-CN",
  manualVerdict,
  locked,
  readOnly,
  onSubmit,
}: {
  initialNote: string;
  locale?: Locale;
  manualVerdict: string | null;
  locked: boolean;
  readOnly: boolean;
  onSubmit: (verdict: string | null, note: string) => void;
}) {
  const [note, setNote] = useState(initialNote);
  const en = locale === "en";
  const verdictButtons = [
    ["problem", en ? "Problem" : "存在问题"],
    ["not_problem", en ? "Not a problem" : "不构成问题"],
    ["uncertain", en ? "Uncertain" : "暂不确定"],
  ];

  return (
    <section className="manual-review" aria-labelledby="manual-review-heading">
      <div>
        <p className="section-kicker">MANUAL REVIEW</p>
        <h3 id="manual-review-heading">{en ? "Give a manual verdict" : "给出人工判断"}</h3>
        <p>
          {en
            ? "Click the selected button to remove the verdict and mark this item as needing review again. Manual verdicts take priority over AI verdicts."
            : "点击已选按钮可撤销判断，将项目重新标记为待复核。人工判断优先于 AI 判断。"}
        </p>
      </div>
      <label htmlFor="incomplete-note">{en ? "Note (optional)" : "备注（可选）"}</label>
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
