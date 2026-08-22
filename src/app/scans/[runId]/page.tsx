"use client";
import { useEffect, useState } from "react";
export default function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const [data, setData] = useState<any>();
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  useEffect(() => {
    params.then((p) => setId(p.runId));
  }, [params]);
  useEffect(() => {
    if (id)
      fetch(`/api/runs/${id}`)
        .then(async (r) => {
          const value = await r.json();
          if (!r.ok) throw new Error(value.error?.message ?? "读取扫描结果失败");
          return value;
        })
        .then(setData)
        .catch((reason: unknown) =>
          setError(reason instanceof Error ? reason.message : "读取扫描结果失败"),
        );
  }, [id]);
  useEffect(() => {
    fetch("/api/admin/session")
      .then((response) => response.json())
      .then((value) => setIsAdmin(Boolean(value.authenticated)))
      .catch(() => setIsAdmin(false));
  }, []);
  async function publicationAction(action: "publish" | "unpublish") {
    const csrf = document.cookie.match(/(?:^|; )accesscheck_csrf=([^;]+)/)?.[1] ?? "";
    const response = await fetch(`/api/admin/runs/${id}/${action}`, {
      method: "POST",
      headers: { "x-csrf-token": csrf },
    });
    const value = await response.json();
    if (!response.ok) setActionMessage(value.error?.message ?? "操作失败");
    else {
      setActionMessage(action === "publish" ? "已发布" : "已撤下");
      setData((current: any) => ({
        ...current,
        run: { ...current.run, published: action === "publish" ? 1 : 0 },
      }));
    }
  }
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!data) return <p role="status">正在读取扫描结果…</p>;
  const s = data.score;
  const pages = data.pages ?? [];
  return (
    <section>
      <div className="card">
        <h1>{data.run.name}</h1>
        <p className="muted">
          {data.run.origin} · {data.run.status}
        </p>
        <p>发布状态：{data.run.published ? "已发布（访客可读）" : "未发布（仅登录用户可读）"}</p>
        <div className="score">{s.overall === null ? "无可计算数据" : `${s.overall} / 100`}</div>
        <p>
          评分模型：{s.modelVersion}；页面 {s.pageCount}；规则 {s.ruleCount}；通过节点{" "}
          {s.automaticPassNodes}；失败节点 {s.automaticFailNodes}
        </p>
        <p>
          自动通过 {s.resultNodeCounts?.pass ?? s.resultTypeCounts?.pass ?? 0}；自动失败{" "}
          {s.resultNodeCounts?.violation ?? s.resultTypeCounts?.violation ?? 0}；需要人工检查{" "}
          {s.resultNodeCounts?.incomplete ?? s.resultTypeCounts?.incomplete ?? 0}；不适用{" "}
          {s.resultNodeCounts?.inapplicable ?? s.resultTypeCounts?.inapplicable ?? 0}
        </p>
        <p>
          best-practice 问题 {s.bestPracticeIssueCount ?? 0}；AAA 问题 {s.aaaIssueCount ?? 0}；
          未能解析 WCAG 条款 {s.unmappedWcagIssueCount ?? 0}；加权失败值 {s.weightedDefects ?? 0}
        </p>
        <p className="muted" role="note">
          本项目仅评价 axe-core 能够自动判断的网页无障碍检查项。分数不等同于完整人工审计、官方 WCAG
          合规认证或“符合 WCAG 的百分比”。需要人工判断的项目会单独列出。
        </p>
        <p>
          <a href={`/scans/${id}/issues`}>查看问题详情与筛选</a>
          {" · "}
          <a href={`/reports/${id}`}>打开报告页</a>
          {" · "}
          <a href={`/api/reports/${id}/html`}>HTML 导出</a>
          {" · "}
          <a href={`/api/reports/${id}/pdf`}>PDF 导出</a>
        </p>
        {isAdmin && (
          <p>
            <button
              type="button"
              onClick={() => publicationAction(data.run.published ? "unpublish" : "publish")}
            >
              {data.run.published ? "撤下公开结果" : "发布结果"}
            </button>
            {actionMessage && <span role="status"> {actionMessage}</span>}
          </p>
        )}
      </div>
      <div className="grid" style={{ marginTop: 16 }}>
        {[
          ["可感知", s.perceivable],
          ["可操作", s.operable],
          ["易理解", s.understandable],
          ["兼容性", s.robust],
        ].map(([name, value]) => (
          <div className="card" key={name as string}>
            <h2>{name}</h2>
            <div className="score">{value === null ? "N/A" : `${value}`}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>页面状态与覆盖</h2>
        <p>
          页面总数 {pages.length}；状态分布：
          {Object.entries(data.pageStatus ?? {})
            .map(([status, count]) => `${status} ${count}`)
            .join("、") || "暂无"}
          ；覆盖受限页 {data.coverage?.limitedPages ?? 0}；frame 错误{" "}
          {data.coverage?.frameErrors ?? 0}。
        </p>
        <table>
          <caption className="sr-only">扫描页面状态</caption>
          <thead>
            <tr>
              <th scope="col">页面</th>
              <th scope="col">状态</th>
              <th scope="col">HTTP</th>
              <th scope="col">错误</th>
              <th scope="col">Frame 覆盖</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((page: any) => (
              <tr key={page.id}>
                <td>
                  <code>{page.canonical_url}</code>
                </td>
                <td>{page.scan_status}</td>
                <td>{page.http_status ?? "N/A"}</td>
                <td>{page.error_code ?? ""}</td>
                <td>{page.frame_coverage_status ?? "N/A"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
