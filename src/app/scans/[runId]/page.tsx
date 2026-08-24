"use client";
import { useEffect, useState } from "react";
import AiOverlayCard from "@/components/ai-overlay-card";
export default function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const [data, setData] = useState<any>();
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [reviewWorkbench, setReviewWorkbench] = useState<any>(null);
  const [formalStatus, setFormalStatus] = useState<any>(null);
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
  useEffect(() => {
    if (!id) return;
    fetch(`/api/runs/${id}/review-workbench`)
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then(setReviewWorkbench)
      .catch(() => setReviewWorkbench(null));
  }, [id]);
  useEffect(() => {
    if (!id) return;
    fetch(`/api/runs/${id}/formal-review-status`)
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then(setFormalStatus)
      .catch(() => setFormalStatus(null));
  }, [id]);
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
  const severityCounts = data.severityCounts ?? {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
  };
  const principleCounts = data.principleCounts ?? {
    perceivable: 0,
    operable: 0,
    understandable: 0,
    robust: 0,
  };
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
      <div className="card" style={{ marginTop: 16 }}>
        <h2>人工审核与数据核对</h2>
        <p>
          <strong>
            {s.resultNodeCounts?.incomplete ?? s.resultTypeCounts?.incomplete ?? 0}{" "}
            个待上下文判断的节点，不等于
            {s.resultNodeCounts?.incomplete ?? s.resultTypeCounts?.incomplete ?? 0}{" "}
            项必须逐条人工任务。
          </strong>
        </p>
        {reviewWorkbench ? (
          <>
            <div className="grid">
              <div>
                <strong>全部自动证据</strong>
                <br />
                {reviewWorkbench.summary.automaticNodeCount} 个节点，始终可逐条查看和导出。
              </div>
              <div>
                <strong>需要语境判断</strong>
                <br />
                {reviewWorkbench.summary.contextNodeCount} 个节点已归为{" "}
                {reviewWorkbench.summary.contextFindingCount} 个“页面 × 规则”问题组。
              </div>
              <div>
                <strong>日常核对建议（可选）</strong>
                <br />
                当前先看 {
                  reviewWorkbench.summary.prioritySampleCount
                } 个代表样本；已留下首条注记 {reviewWorkbench.summary.dailyReviewedFindingCount}/
                {reviewWorkbench.summary.findingCount} 个问题组。
              </div>
            </div>
            <p className="muted" style={{ marginTop: 16 }}>
              这不是必须完成的全部任务：处理完当前建议批次即可停止，剩余问题组和原始节点仍保留在完整证据目录中，需要时再核查。日常核对只更新“已查看覆盖率”和人工注记；不会覆盖原始扫描证据，也不会擅自改写自动分数。正式研究另有固定的最多{" "}
              {reviewWorkbench.summary.formalReview.maxSamplesPerReviewer} 条分层样本，由两位
              reviewer 独立审核。
            </p>
            <p>
              <a href={`/scans/${id}/review`}>进入人工审核工作台</a>
              {" · "}
              <a href={`/scans/${id}/issues?resultType=incomplete`}>浏览全部待上下文判断节点</a>
            </p>
            {formalStatus ? (
              <div className="card" style={{ marginTop: 16 }}>
                <p className="pill">正式研究审核状态</p>
                <h3>{formalStatus.title}</h3>
                <p>{formalStatus.message}</p>
                <p>
                  <strong>下一步：</strong> {formalStatus.nextStep}
                </p>
                {formalStatus.campaign ? (
                  <p className="muted">
                    R1 真实确认：{formalStatus.campaign.r1ApprovalCount}/2 · 研究状态：
                    {formalStatus.campaign.status}
                  </p>
                ) : null}
                {formalStatus.myProgress ? (
                  <p className="muted">
                    我的正式审核进度：{formalStatus.myProgress.completed}/
                    {formalStatus.myProgress.total}；这里故意不显示另一位 reviewer 的进度或答案。
                  </p>
                ) : null}
                {formalStatus.externalInputRequired ? (
                  <p className="notice">
                    此步骤需要真人或外部单位提供真实确认；系统会保持等待，不会伪造输入或假装正式审核已经开始。
                  </p>
                ) : null}
                {formalStatus.reviewPath ? (
                  <p>
                    <a href={formalStatus.reviewPath}>进入我的正式审核</a>
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <p>
              登录后，系统会把待上下文判断的节点按“页面 ×
              规则”归组，并给出少量代表样本；全部原始节点仍可随时展开核查。
            </p>
            <p>
              <a href={`/review/login?next=${encodeURIComponent(`/scans/${id}/review`)}`}>
                Reviewer 登录后开始核对
              </a>
              {" · "}
              <a href={`/scans/${id}/issues?resultType=incomplete`}>先浏览全部问题数据</a>
            </p>
          </>
        )}
      </div>
      {isAdmin ? <AiOverlayCard runId={id} pages={pages} /> : null}
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
      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>严重程度分布</h2>
          <table>
            <caption className="sr-only">自动失败节点严重程度分布</caption>
            <thead>
              <tr>
                <th scope="col">严重程度</th>
                <th scope="col">节点数</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(severityCounts).map(([name, count]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>{String(count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>WCAG 原则分布</h2>
          <table>
            <caption className="sr-only">问题节点按 WCAG 原则分布</caption>
            <thead>
              <tr>
                <th scope="col">原则</th>
                <th scope="col">节点数</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(principleCounts).map(([name, count]) => (
                <tr key={name}>
                  <th scope="row">
                    {{
                      perceivable: "可感知",
                      operable: "可操作",
                      understandable: "易理解",
                      robust: "兼容性",
                    }[name] ?? name}
                  </th>
                  <td>{String(count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
