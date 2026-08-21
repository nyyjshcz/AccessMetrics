"use client";

import { useEffect, useState } from "react";

type Issue = {
  id: string;
  page_id: string;
  rule_id: string;
  result_type: string;
  impact: string | null;
  description: string;
  help: string;
  help_url: string;
  node_count: number;
  principles: string[];
  reviewVerdict: string;
  localization?: { zhName: string; zhFix: string; translationStatus: string; fallback: boolean };
};

export default function IssuesPage({ params }: { params: Promise<{ runId: string }> }) {
  const [runId, setRunId] = useState("");
  const [items, setItems] = useState<Issue[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [impact, setImpact] = useState("");
  const [principle, setPrinciple] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    params.then((value) => setRunId(value.runId));
  }, [params]);

  useEffect(() => {
    if (!runId) return;
    const query = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (impact) query.set("impact", impact);
    if (principle) query.set("principle", principle);
    fetch(`/api/runs/${runId}/issues?${query}`)
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error?.message ?? "问题列表读取失败");
        return value;
      })
      .then((value) => {
        setItems(value.items ?? []);
        setPagination(value.pagination ?? { page, pageSize: 20, total: 0, totalPages: 0 });
        setError("");
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "问题列表读取失败"),
      );
  }, [runId, page, impact, principle]);

  if (error) return <p className="error">{error}</p>;
  return (
    <section>
      <div className="card">
        <h1>问题列表</h1>
        <p className="muted">仅列出自动化结果；人工复核结论需以正式 review freeze 为准。</p>
        <div className="filters" aria-label="问题筛选">
          <label>
            严重程度
            <select
              value={impact}
              onChange={(event) => {
                setImpact(event.target.value);
                setPage(1);
              }}
            >
              <option value="">全部</option>
              <option value="critical">critical</option>
              <option value="serious">serious</option>
              <option value="moderate">moderate</option>
              <option value="minor">minor</option>
            </select>
          </label>
          <label>
            原则
            <select
              value={principle}
              onChange={(event) => {
                setPrinciple(event.target.value);
                setPage(1);
              }}
            >
              <option value="">全部</option>
              <option value="perceivable">可感知</option>
              <option value="operable">可操作</option>
              <option value="understandable">易理解</option>
              <option value="robust">兼容性</option>
            </select>
          </label>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <p>当前筛选没有自动化问题。</p>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
          <table>
            <caption className="sr-only">自动化问题列表</caption>
            <thead>
              <tr>
                <th>规则</th>
                <th>严重程度</th>
                <th>页面</th>
                <th>节点数</th>
                <th>复核状态</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <a href={item.help_url} target="_blank" rel="noreferrer">
                      {item.rule_id}
                    </a>
                  </td>
                  <td>{item.impact ?? "N/A"}</td>
                  <td>
                    <code>{item.page_id}</code>
                  </td>
                  <td>{item.node_count}</td>
                  <td>{item.reviewVerdict}</td>
                  <td>
                    <strong>{item.localization?.zhName ?? "暂无人工校对中文说明"}</strong>
                    <br />
                    {item.localization?.zhFix ?? item.help ?? item.description}
                    <br />
                    <small>
                      {item.localization?.translationStatus === "human_reviewed"
                        ? "中文已人工校对"
                        : "中文草稿/待人工校对；以 axe 原文为准"}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pagination" aria-label="问题分页">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              上一页
            </button>
            <span>
              第 {pagination.page} / {Math.max(1, pagination.totalPages)} 页，共 {pagination.total}{" "}
              条
            </span>
            <button
              type="button"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
