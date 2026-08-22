"use client";

import { useCallback, useEffect, useState } from "react";

export default function ReviewBatchPage({ params }: { params: Promise<{ batchId: string }> }) {
  const [batchId, setBatchId] = useState("");
  const [sample, setSample] = useState<any>(null);
  const [done, setDone] = useState(false);
  const [role, setRole] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    params.then((value) => setBatchId(value.batchId));
  }, [params]);
  const loadNext = useCallback(
    async (id = batchId) => {
      if (!id) return;
      setLoading(true);
      const [nextResponse, sessionResponse] = await Promise.all([
        fetch(`/api/reviewer/review-batches/${id}/next`),
        fetch("/api/reviewer/session"),
      ]);
      const next = await nextResponse.json();
      const session = await sessionResponse.json();
      setRole(session.user?.role ?? "");
      if (!nextResponse.ok) setMessage(next.error?.message ?? "抽样读取失败");
      else {
        setSample(next.sample);
        setDone(Boolean(next.done));
        setMessage("");
      }
      setLoading(false);
    },
    [batchId],
  );
  useEffect(() => {
    if (batchId)
      void Promise.resolve()
        .then(() => loadNext(batchId))
        .catch(() => setMessage("抽样读取失败"));
  }, [batchId, loadNext]);
  async function submit(verdict: string) {
    const csrf = document.cookie.match(/(?:^|; )accesscheck_csrf=([^;]+)/)?.[1] ?? "";
    const response = await fetch(
      `/api/reviewer/review-batches/${batchId}/samples/${sample.id}/reviews`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ verdict, note }),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.error?.message ?? "保存失败");
      return;
    }
    setNote("");
    setMessage("已保存本人审核记录；双方提交前不会显示对方 verdict。");
    await loadNext();
  }
  return (
    <section>
      <div className="card">
        <h1>正式人工抽查</h1>
        <p>
          batch：<code>{batchId}</code>；当前角色：{role || "未登录"}
        </p>
        <p className="muted">
          抽样固定引用 study source。两位 reviewer 独立提交，页面不会显示对方答案；误录只能通过
          revision 更正。
        </p>
        {message && <p role="status">{message}</p>}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        {loading ? (
          <p role="status">正在读取下一条样本…</p>
        ) : done ? (
          <p>当前角色已完成本 batch 的全部样本，等待另一位 reviewer。</p>
        ) : sample ? (
          <>
            <h2>样本 {sample.draw_order}</h2>
            <p>
              规则：{sample.rule_id}；提示：{sample.description}
            </p>
            <p>页面节点：</p>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {sample.html_sanitized ?? "（无清理片段）"}
            </pre>
            <p>
              <a href={sample.help_url} target="_blank" rel="noreferrer">
                查看 axe 帮助
              </a>
            </p>
            <label htmlFor="review-note">理由（可选）</label>
            <textarea
              id="review-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
            />
            <div>
              <button type="button" onClick={() => submit("confirmed")}>
                确认问题
              </button>
              <button type="button" className="secondary" onClick={() => submit("not_an_issue")}>
                不是问题
              </button>
              <button type="button" className="secondary" onClick={() => submit("uncertain")}>
                不确定
              </button>
            </div>
          </>
        ) : (
          <p>没有可审核样本。</p>
        )}
      </div>
    </section>
  );
}
