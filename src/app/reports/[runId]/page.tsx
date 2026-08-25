"use client";

import { useEffect, useState } from "react";

export default function ReportPage({ params }: { params: Promise<{ runId: string }> }) {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  useEffect(() => {
    params.then((value) => setRunId(value.runId));
  }, [params]);
  useEffect(() => {
    if (!runId) return;
    const readJson = async (response: Response, fallback: string) => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error?.message ?? fallback);
      return value;
    };
    Promise.all([
      fetch(`/api/runs/${runId}`).then((response) => readJson(response, "读取报告失败")),
      fetch(`/api/runs/${runId}/issues?resultType=violation&pageSize=12&sort=impact_desc`).then(
        (response) => readJson(response, "读取主要问题失败"),
      ),
    ])
      .then(([run, issuePayload]) => {
        setData({ ...run, issues: issuePayload.items ?? [] });
        setError("");
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "读取报告失败"),
      );
  }, [runId]);
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!data) return <p role="status">正在读取报告…</p>;
  const score = data.score;
  return (
    <section>
      <div className="card">
        <h1>自动检查报告：{data.run.name}</h1>
        <p className="muted">
          {data.run.origin} · 扫描完成时间：
          {data.run.finished_at ?? data.run.started_at ?? data.run.created_at ?? "未记录"} ·{" "}
          {data.pages?.length ?? 0} 页
        </p>
        <p className="score">
          {score.overall === null ? "无可计算数据" : `${score.overall} / 100`}
        </p>
        <p>
          评分模型：{score.modelVersion}；覆盖受限页 {data.coverage?.limitedPages ?? 0}
          ；需要人工检查 {score.resultNodeCounts?.incomplete ?? 0}。
        </p>
        <p>
          <a href={`/api/reports/${runId}/html`}>下载/打开 HTML</a>
          {" · "}
          <a href={`/api/reports/${runId}/pdf`}>下载 PDF</a>
          {" · "}
          <a href={`/scans/${runId}/issues`}>查看全部问题</a>
        </p>
      </div>
      <div className="grid" style={{ marginTop: 16 }}>
        {[
          ["可感知", score.perceivable],
          ["可操作", score.operable],
          ["易理解", score.understandable],
          ["兼容性", score.robust],
        ].map(([name, value]) => (
          <div className="card" key={String(name)}>
            <h2>{name}</h2>
            <div className="score">{value === null ? "N/A" : value}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>主要问题与建议入口</h2>
        <table>
          <caption className="sr-only">主要自动化问题</caption>
          <thead>
            <tr>
              <th scope="col">规则</th>
              <th scope="col">影响</th>
              <th scope="col">类型</th>
              <th scope="col">节点数</th>
              <th scope="col">帮助</th>
            </tr>
          </thead>
          <tbody>
            {(data.issues ?? []).map((issue: any) => (
              <tr key={`${issue.id ?? issue.rule_id}-${issue.result_type}`}>
                <td>{issue.rule_id}</td>
                <td>{issue.impact ?? "N/A"}</td>
                <td>{issue.result_type === "incomplete" ? "需要人工检查" : "自动发现"}</td>
                <td>{issue.node_count}</td>
                <td>
                  <a href={issue.help_url} target="_blank" rel="noreferrer">
                    {issue.help}
                  </a>
                  <details style={{ marginTop: 8 }}>
                    <summary>代表性节点（{issue.nodes?.length ?? 0}）</summary>
                    {(issue.nodes ?? []).slice(0, 5).map((node: any) => (
                      <div key={node.id} style={{ marginTop: 8 }}>
                        <code>{JSON.stringify(node.target)}</code>
                        {node.failureSummary ? <p>{node.failureSummary}</p> : null}
                        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                          {node.html}
                        </pre>
                      </div>
                    ))}
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>报告边界</h2>
        <p className="muted">
          此报告只表示 axe-core 能够自动判断的检查结果，不等同于完整人工审计、官方 WCAG
          合规认证或“符合 WCAG 的百分比”。跨域/未执行
          frame、失败页面、当前渲染状态和人工判断都必须结合原始证据解释。
        </p>
      </div>
    </section>
  );
}
