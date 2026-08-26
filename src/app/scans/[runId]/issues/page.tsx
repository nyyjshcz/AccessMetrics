"use client";

import { useEffect, useState } from "react";

type Issue = {
  id: string;
  page_id: string;
  page_url: string;
  page_title: string | null;
  rule_id: string;
  result_type: string;
  impact: string | null;
  description: string;
  help: string;
  help_url: string;
  node_count: number;
  principles: string[];
  reviewCoverage: {
    reviewedNodeCount: number;
    confirmedCount: number;
    notAnIssueCount: number;
    uncertainCount: number;
  };
  nodes: Array<{
    id: string;
    ordinal: number;
    target: unknown;
    html: string;
    failureSummary: string | null;
    framePath: unknown;
    frameUrl: string | null;
    frameOriginRelation: string | null;
    targetHash: string | null;
    effectiveImpact: string | null;
    severityWeight: number | null;
    severitySource: string | null;
    aiEvidence?: {
      complete?: boolean;
      facts?: Record<string, unknown>;
      warnings?: string[];
      target?: string[];
    } | null;
    aiReview?: {
      verdict: "problem" | "not_problem" | "uncertain";
      reason: string | null;
      impact: string | null;
      updatedAt: string;
    } | null;
  }>;
  localization?: { zhName: string; zhFix: string; translationStatus: string; fallback: boolean };
};

export default function IssuesPage({ params }: { params: Promise<{ runId: string }> }) {
  const [runId, setRunId] = useState("");
  const [items, setItems] = useState<Issue[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [impact, setImpact] = useState("");
  const [principle, setPrinciple] = useState("");
  const [resultType, setResultType] = useState("violation");
  const [ruleId, setRuleId] = useState("");
  const [pageId, setPageId] = useState("");
  const [reviewVerdict, setReviewVerdict] = useState("");
  const [sort, setSort] = useState("impact_desc");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [queryReady, setQueryReady] = useState(false);

  useEffect(() => {
    params.then((value) => setRunId(value.runId));
  }, [params]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      const query = new URLSearchParams(window.location.search);
      const requestedResultType = query.get("resultType");
      if (["violation", "incomplete", "pass", "inapplicable"].includes(requestedResultType ?? ""))
        setResultType(requestedResultType!);
      const requestedRule = query.get("ruleId");
      if (requestedRule) setRuleId(requestedRule);
      const requestedPage = query.get("pageId");
      if (requestedPage) setPageId(requestedPage);
      setQueryReady(true);
    });
  }, []);

  useEffect(() => {
    if (!runId || !queryReady) return;
    const query = new URLSearchParams({ page: String(page), pageSize: "20", resultType, sort });
    if (impact) query.set("impact", impact);
    if (principle) query.set("principle", principle);
    if (ruleId) query.set("ruleId", ruleId);
    if (pageId) query.set("pageId", pageId);
    if (reviewVerdict) query.set("reviewVerdict", reviewVerdict);
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
  }, [runId, page, impact, principle, resultType, ruleId, pageId, reviewVerdict, sort, queryReady]);

  if (error) return <p className="error">{error}</p>;
  return (
    <section>
      <div className="card">
        <h1>问题列表</h1>
        <p className="muted">
          这里保留全部自动化结果。violation 已由 axe 自动判定并直接参与自动评分；只有 incomplete
          需要人工或 AI 结合页面语境判断。pass 和 inapplicable
          可以浏览，但不是人工待办。一个问题组可能含多个节点；人工判断只记录到实际看过的节点。
        </p>
        <p>
          <a href={`/scans/${runId}/review`}>先进入人工审核工作台（按问题组与代表样本）</a>
        </p>
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
            结果类型
            <select
              value={resultType}
              onChange={(event) => {
                setResultType(event.target.value);
                setPage(1);
              }}
            >
              <option value="violation">violation</option>
              <option value="incomplete">incomplete（人工检查）</option>
              <option value="pass">pass</option>
              <option value="inapplicable">inapplicable（不适用）</option>
            </select>
          </label>
          <label>
            规则 ID
            <input
              value={ruleId}
              onChange={(event) => {
                setRuleId(event.target.value);
                setPage(1);
              }}
              placeholder="例如 image-alt"
            />
          </label>
          <label>
            人工覆盖
            <select
              value={reviewVerdict}
              onChange={(event) => {
                setReviewVerdict(event.target.value);
                setPage(1);
              }}
            >
              <option value="">全部</option>
              <option value="confirmed">至少有 1 个确认节点</option>
              <option value="not_an_issue">至少有 1 个“不成立”节点</option>
              <option value="uncertain">至少有 1 个不确定节点</option>
              <option value="unreviewed">还没有人工记录</option>
            </select>
          </label>
          <label>
            排序
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setPage(1);
              }}
            >
              <option value="impact_desc">影响排序</option>
              <option value="page_asc">页面</option>
              <option value="rule_asc">规则</option>
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
        {pageId ? (
          <p className="notice">
            当前只显示一个页面中的问题组。{" "}
            <button
              type="button"
              className="secondary"
              style={{ width: "auto", marginLeft: 8 }}
              onClick={() => setPageId("")}
            >
              查看全部页面
            </button>
          </p>
        ) : null}
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
                <th>人工覆盖</th>
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
                    <a href={item.page_url} target="_blank" rel="noreferrer">
                      {item.page_title || item.page_url}
                    </a>
                  </td>
                  <td>{item.node_count}</td>
                  <td>
                    {item.result_type === "incomplete" ? (
                      <>
                        已审 {item.reviewCoverage.reviewedNodeCount}/{item.node_count}
                        <br />
                        <small>
                          确认 {item.reviewCoverage.confirmedCount} · 不成立{" "}
                          {item.reviewCoverage.notAnIssueCount} · 不确定{" "}
                          {item.reviewCoverage.uncertainCount}
                        </small>
                      </>
                    ) : (
                      <span className="muted">自动判定，无需人工审核</span>
                    )}
                  </td>
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
                    <details style={{ marginTop: 8 }}>
                      <summary>查看节点定位与清理片段（{item.nodes.length}）</summary>
                      {item.nodes.length === 0 ? (
                        <p className="muted">此结果没有可展示的节点证据。</p>
                      ) : (
                        item.nodes.map((node) => (
                          <div key={node.id} style={{ marginTop: 8 }}>
                            <strong>节点 {node.ordinal + 1}</strong>
                            {item.result_type === "incomplete" ? (
                              <div>
                                <a
                                  href={`/scans/${runId}/review?nodeId=${encodeURIComponent(node.id)}`}
                                >
                                  审核这个节点
                                </a>
                              </div>
                            ) : null}
                            <div>
                              <code>{JSON.stringify(node.target)}</code>
                              {node.targetHash ? (
                                <small> · target hash {node.targetHash}</small>
                              ) : null}
                            </div>
                            {node.failureSummary ? <div>{node.failureSummary}</div> : null}
                            {node.aiReview ? (
                              <div className="notice" style={{ marginTop: 8 }}>
                                <strong>AI 复核：</strong> {node.aiReview.verdict}
                                {node.aiReview.impact ? ` · 动态影响：${node.aiReview.impact}` : ""}
                                {node.aiReview.reason ? ` · ${node.aiReview.reason}` : ""}
                              </div>
                            ) : null}
                            {node.aiEvidence ? (
                              <details style={{ marginTop: 8 }}>
                                <summary>查看 AI evidence（扫描时采集）</summary>
                                <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                                  {JSON.stringify(node.aiEvidence, null, 2)}
                                </pre>
                              </details>
                            ) : null}
                            {node.frameOriginRelation && node.frameOriginRelation !== "top" ? (
                              <div className="muted">
                                frame：{node.frameOriginRelation} {node.frameUrl ?? ""}
                              </div>
                            ) : null}
                            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                              {node.html}
                            </pre>
                          </div>
                        ))
                      )}
                    </details>
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
