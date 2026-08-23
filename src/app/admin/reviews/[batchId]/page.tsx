"use client";

import { useCallback, useEffect, useState } from "react";

type Batch = {
  targetSize: number;
  populationSize: number;
  status: string;
};

type Progress = {
  total: number;
  completedByMe: number;
  remainingForMe: number;
};

type Sample = {
  id: string;
  draw_order: number;
  rule_id: string;
  description: string;
  help: string;
  help_url: string;
  page_url: string;
  page_title: string | null;
  target: unknown;
  html_sanitized: string | null;
  failure_summary: string | null;
  framePath: unknown;
  frame_url: string | null;
  frame_origin_relation: string | null;
  effective_impact: string | null;
  localization?: { zhName: string; zhFix: string; manualCheck: string };
};

const getReviewerCsrf = () =>
  document.cookie.match(/(?:^|; )accesscheck_reviewer_csrf=([^;]+)/)?.[1] ?? "";

export default function ReviewBatchPage({ params }: { params: Promise<{ batchId: string }> }) {
  const [batchId, setBatchId] = useState("");
  const [sample, setSample] = useState<Sample | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [done, setDone] = useState(false);
  const [role, setRole] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    params.then((value) => setBatchId(value.batchId));
  }, [params]);

  const loadNext = useCallback(
    async (id = batchId) => {
      if (!id) return;
      setLoading(true);
      try {
        const [nextResponse, sessionResponse] = await Promise.all([
          fetch(`/api/reviewer/review-batches/${id}/next`),
          fetch("/api/reviewer/session"),
        ]);
        const next = await nextResponse.json();
        const session = await sessionResponse.json();
        setRole(session.user?.role ?? "");
        if (!nextResponse.ok) {
          setMessage(next.error?.message ?? "正式抽样读取失败");
          setSample(null);
          return;
        }
        setSample(next.sample ?? null);
        setDone(Boolean(next.done));
        setBatch(next.batch ?? null);
        setProgress(next.progress ?? null);
        setMessage("");
      } catch {
        setMessage("正式抽样读取失败，请刷新后重试。");
        setSample(null);
      } finally {
        setLoading(false);
      }
    },
    [batchId],
  );

  useEffect(() => {
    if (batchId)
      void Promise.resolve()
        .then(() => loadNext(batchId))
        .catch(() => setMessage("正式抽样读取失败，请刷新后重试。"));
  }, [batchId, loadNext]);

  async function submit(verdict: "confirmed" | "not_an_issue" | "uncertain") {
    if (!sample || submitting) return;
    const trimmedNote = note.trim();
    if (trimmedNote.length < 5) {
      setMessage("请至少写 5 个字说明判断依据；正式审核必须让之后的人可以复核。");
      return;
    }
    const csrf = getReviewerCsrf();
    if (!csrf) {
      setMessage("Reviewer 会话已失效，请重新登录后再提交。");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/reviewer/review-batches/${batchId}/samples/${sample.id}/reviews`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-csrf-token": csrf },
          body: JSON.stringify({ verdict, note: trimmedNote }),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error?.message ?? "保存失败");
        return;
      }
      setNote("");
      setMessage("已保存本人正式审核记录；在你提交前，系统不会显示另一位 reviewer 的判断。");
      await loadNext();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <div className="card review-intro">
        <p className="pill">正式研究抽样 · 双人独立审核</p>
        <h1>正式人工抽查</h1>
        <p>
          这不是把全部扫描节点逐条人工重做。系统从已经冻结的自动证据中固定抽取最多 40 个节点；两位
          reviewer 各自独立判断，合计最多 80 次判断。
        </p>
        <p className="muted">
          当前角色：{role || "未登录"} · batch：<code>{batchId}</code>
          {batch ? ` · 状态：${batch.status}` : ""}
        </p>
        <ol className="review-steps">
          <li>只审核系统分配的下一个固定样本；不要替换、跳过或手工挑选样本。</li>
          <li>写明实际判断依据，再提交确认、不成立或不确定。</li>
          <li>两人都完成后，系统汇总一致和分歧；有分歧的样本再进入裁决。</li>
          <li>裁决完成且 review set 冻结后，才可以用于正式研究结论。</li>
        </ol>
      </div>

      {batch && progress ? (
        <div className="grid" style={{ marginTop: 16 }}>
          <div className="card">
            <h2>我的进度</h2>
            <div className="score">
              {progress.completedByMe}/{progress.total}
            </div>
            <p className="muted">还剩 {progress.remainingForMe} 个固定样本。</p>
          </div>
          <div className="card">
            <h2>抽样范围</h2>
            <div className="score">{batch.targetSize}</div>
            <p className="muted">
              来自 {batch.populationSize} 个自动问题节点；上限为每位 reviewer 40 个。
            </p>
          </div>
          <div className="card">
            <h2>独立审核保护</h2>
            <p className="muted">
              这里故意只显示你的进度，不显示另一位 reviewer
              的完成数、答案、一致或分歧，避免影响你后续判断。
            </p>
          </div>
        </div>
      ) : null}

      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}

      <div className="card" style={{ marginTop: 16 }}>
        {loading ? (
          <p role="status">正在读取下一个固定样本…</p>
        ) : done ? (
          <>
            <h2>你的正式审核已完成</h2>
            <p>
              你已经完成本 batch 的全部固定样本。若另一位 reviewer
              尚未完成，系统会保持等待；若出现分歧，必须走裁决流程，不能把它当成自动结论。
            </p>
          </>
        ) : sample ? (
          <>
            <h2>
              固定样本 {sample.draw_order}
              {progress ? ` / ${progress.total}` : ""}
            </h2>
            <p className="review-meta">
              {sample.localization?.zhName ?? sample.rule_id} · 自动影响{" "}
              {sample.effective_impact ?? "未确定"}
            </p>
            <p>
              <strong>页面：</strong>{" "}
              <a href={sample.page_url} target="_blank" rel="noreferrer">
                {sample.page_title || sample.page_url}
              </a>
            </p>
            <p>
              <strong>你要判断什么：</strong>{" "}
              {sample.localization?.manualCheck ?? sample.description}
            </p>
            <p>
              <strong>建议修复方向：</strong> {sample.localization?.zhFix ?? sample.help}
            </p>
            <details open>
              <summary>查看固定样本的扫描证据</summary>
              <p>
                <strong>元素定位：</strong> <code>{JSON.stringify(sample.target)}</code>
              </p>
              {sample.failure_summary ? (
                <p>
                  <strong>工具提示：</strong> {sample.failure_summary}
                </p>
              ) : null}
              {sample.frame_origin_relation && sample.frame_origin_relation !== "top" ? (
                <p className="muted">
                  frame：{sample.frame_origin_relation} {sample.frame_url ?? ""}
                </p>
              ) : null}
              <pre className="review-evidence">{sample.html_sanitized ?? "（无清理片段）"}</pre>
            </details>
            <p>
              <a href={sample.help_url} target="_blank" rel="noreferrer">
                查看 axe 规则帮助
              </a>
            </p>
            <label htmlFor="review-note">判断理由（至少 5 个字）</label>
            <textarea
              id="review-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
              placeholder="写下你在这个页面上实际看到的依据。"
            />
            <div className="review-actions">
              <button type="button" onClick={() => submit("confirmed")} disabled={submitting}>
                {submitting ? "保存中…" : "确认问题"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => submit("not_an_issue")}
                disabled={submitting}
              >
                {submitting ? "保存中…" : "当前页面不构成问题"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => submit("uncertain")}
                disabled={submitting}
              >
                {submitting ? "保存中…" : "暂不确定，需要进一步确认"}
              </button>
            </div>
          </>
        ) : (
          <p>该 batch 没有可审核样本。</p>
        )}
      </div>
    </section>
  );
}
