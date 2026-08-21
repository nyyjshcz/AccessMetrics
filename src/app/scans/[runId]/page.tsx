"use client";
import { useEffect, useState } from "react";
export default function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const [data, setData] = useState<any>();
  const [id, setId] = useState("");
  useEffect(() => {
    params.then((p) => setId(p.runId));
  }, [params]);
  useEffect(() => {
    if (id)
      fetch(`/api/runs/${id}`)
        .then((r) => r.json())
        .then(setData);
  }, [id]);
  if (!data) return <p>正在读取扫描结果…</p>;
  const s = data.score;
  return (
    <section>
      <div className="card">
        <h1>{data.run.name}</h1>
        <p className="muted">
          {data.run.origin} · {data.run.status}
        </p>
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
    </section>
  );
}
