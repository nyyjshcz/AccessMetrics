"use client";

import { useEffect, useState } from "react";

export default function ReviewPage({ params }: { params: Promise<{ runId: string }> }) {
  const [runId, setRunId] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    params.then((value) => setRunId(value.runId));
  }, [params]);
  useEffect(() => {
    if (runId)
      fetch(`/api/runs/${runId}/issues?pageSize=40`)
        .then((response) => response.json())
        .then((data) => setItems(data.items ?? []));
  }, [runId]);
  async function review(resultNodeId: string, verdict: string) {
    const csrf = document.cookie.match(/(?:^|; )accesscheck_csrf=([^;]+)/)?.[1] ?? "";
    const response = await fetch("/api/reviews/ad-hoc", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ resultNodeId, verdict, note: "", reviewContext: "ad_hoc" }),
    });
    setMessage(
      response.ok ? "已保存当前 reviewer verdict" : "保存失败：请确认 reviewer 会话和 CSRF",
    );
  }
  return (
    <section>
      <div className="card">
        <h1>人工复核</h1>
        <p className="muted">
          这是当前 reviewer 会话可见的审核入口。管理员不能代替 reviewer 提交
          verdict；最终研究抽查仍需通过 R2/R3 真人门。
        </p>
        {message && <p>{message}</p>}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th>规则</th>
              <th>影响</th>
              <th>帮助</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.rule_id}</td>
                <td>{item.impact ?? "未确定"}</td>
                <td>{item.help}</td>
                <td>
                  <button
                    className="secondary"
                    onClick={() => review(item.result_node_id, "confirmed")}
                  >
                    确认问题
                  </button>{" "}
                  <button
                    className="secondary"
                    onClick={() => review(item.result_node_id, "not_an_issue")}
                  >
                    不是问题
                  </button>{" "}
                  <button
                    className="secondary"
                    onClick={() => review(item.result_node_id, "uncertain")}
                  >
                    不确定
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
