"use client";

import { useCallback, useEffect, useState } from "react";

type Version = { scannerVersion: string; axeVersion: string; modelVersion: string };

export default function ResearchPage() {
  const [value, setValue] = useState<any>();
  const [versions, setVersions] = useState<Version[]>([]);
  const [selected, setSelected] = useState<Version | null>(null);
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async (version: Version | null = null, nextCategory = "") => {
    const query = new URLSearchParams();
    if (version) {
      query.set("scannerVersion", version.scannerVersion);
      query.set("axeVersion", version.axeVersion);
      query.set("modelVersion", version.modelVersion);
    }
    if (nextCategory) query.set("category", nextCategory);
    const response = await fetch(`/api/research/summary?${query}`);
    const data = await response.json();
    if (!response.ok) {
      setError(data.error?.message ?? "研究汇总读取失败");
      const options = data.error?.details?.options;
      if (Array.isArray(options)) setVersions(options);
      return;
    }
    setValue(data);
    setVersions(data.options ?? []);
    setSelected(data.baseline ?? version);
    setError("");
  }, []);
  useEffect(() => {
    void Promise.resolve()
      .then(() => load(null))
      .catch(() => setError("研究汇总读取失败"));
  }, [load]);
  const categories = [
    ...new Set((value?.items ?? []).map((item: any) => item.category).filter(Boolean)),
  ] as string[];
  const summary = value?.summary;
  const severityLabels: Record<string, string> = {
    critical: "Critical",
    serious: "Serious",
    moderate: "Moderate",
    minor: "Minor",
  };
  const principleLabels: Record<string, string> = {
    perceivable: "可感知",
    operable: "可操作",
    understandable: "易理解",
    robust: "兼容性",
  };
  const renderBars = (entries: Array<[string, number]>, labels: Record<string, string>) => {
    const maximum = Math.max(1, ...entries.map(([, count]) => count));
    return (
      <ol aria-label="研究汇总柱状图" style={{ listStyle: "none", padding: 0 }}>
        {entries.map(([key, count]) => (
          <li key={key} style={{ margin: "8px 0" }}>
            <span>
              {labels[key] ?? key}：{count}
            </span>
            <div
              aria-hidden="true"
              style={{
                background: "#d8e6f3",
                height: 12,
                marginTop: 4,
                width: `${(count / maximum) * 100}%`,
              }}
            />
          </li>
        ))}
      </ol>
    );
  };
  return (
    <section>
      <div className="card">
        <h1>研究总览</h1>
        <p className="muted">
          只比较同一 scanner、axe
          和评分模型版本的已发布结果。没有真实发布数据时不生成假样本、假排名或假结论。
        </p>
        <p className="muted" role="note">
          本项目仅评价 axe-core 能够自动判断的网页无障碍检查项，不等同于完整人工审计或官方合规认证。
        </p>
        <label htmlFor="version">版本基线</label>
        <select
          id="version"
          value={selected ? JSON.stringify(selected) : ""}
          onChange={(event) => {
            const next =
              versions.find((item) => JSON.stringify(item) === event.target.value) ?? null;
            setSelected(next);
            load(next).catch(() => setError("研究汇总读取失败"));
          }}
        >
          <option value="">请选择版本（仅一个版本时自动选择）</option>
          {versions.map((version) => (
            <option key={JSON.stringify(version)} value={JSON.stringify(version)}>
              {version.scannerVersion} / axe {version.axeVersion} / {version.modelVersion}
            </option>
          ))}
        </select>
        <label htmlFor="category">网站类别</label>
        <select
          id="category"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            load(selected, event.target.value).catch(() => setError("研究汇总读取失败"));
          }}
        >
          <option value="">全部类别</option>
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>网站结果数据表</h2>
        {!value?.baseline ? (
          <p>请选择版本基线；未发布或版本不完整的数据不会进入研究汇总。</p>
        ) : (
          <table>
            <caption className="sr-only">已发布网站研究汇总</caption>
            <thead>
              <tr>
                <th scope="col">排名</th>
                <th scope="col">网站</th>
                <th scope="col">类别</th>
                <th scope="col">总分</th>
                <th scope="col">四原则</th>
                <th scope="col">需要人工检查</th>
                <th scope="col">来源</th>
                <th scope="col">run</th>
              </tr>
            </thead>
            <tbody>
              {value.items.map((item: any, index: number) => (
                <tr key={item.runId}>
                  <td>{item.overall === null ? "N/A" : index + 1}</td>
                  <td>{item.name}</td>
                  <td>{item.category ?? "未分类"}</td>
                  <td>{item.overall === null ? "N/A" : item.overall}</td>
                  <td>
                    {item.perceivable ?? "N/A"} / {item.operable ?? "N/A"} /{" "}
                    {item.understandable ?? "N/A"} / {item.robust ?? "N/A"}
                  </td>
                  <td>{item.incomplete}</td>
                  <td>
                    <code>{item.origin}</code>
                  </td>
                  <td>
                    <a href={`/scans/${item.runId}`}>{item.runId}</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {summary && value?.baseline && (
        <>
          <div className="grid" style={{ marginTop: 16 }}>
            <div className="card">
              <h2>总分分布</h2>
              <p>
                有效站点 {summary.distribution.count}；平均数 {summary.distribution.mean ?? "N/A"}
                ；中位数 {summary.distribution.median ?? "N/A"}；四分位数{" "}
                {summary.distribution.q1 ?? "N/A"}–{summary.distribution.q3 ?? "N/A"}；范围{" "}
                {summary.distribution.min ?? "N/A"}–{summary.distribution.max ?? "N/A"}。
              </p>
              {renderBars(
                summary.distribution.histogram.map((item: any) => [item.label, item.count]),
                {},
              )}
              <table>
                <caption className="sr-only">总分分布统计与直方图数据表</caption>
                <tbody>
                  {Object.entries(summary.distribution).map(([name, count]) =>
                    name === "histogram" ? null : (
                      <tr key={name}>
                        <th scope="row">{name}</th>
                        <td>{String(count ?? "N/A")}</td>
                      </tr>
                    ),
                  )}
                  {summary.distribution.histogram.map((item: any) => (
                    <tr key={item.label}>
                      <th scope="row">{item.label}</th>
                      <td>{item.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card">
              <h2>严重程度分布</h2>
              {renderBars(
                Object.entries(summary.severity) as Array<[string, number]>,
                severityLabels,
              )}
              <table>
                <caption className="sr-only">严重程度分布数据表</caption>
                <tbody>
                  {Object.entries(summary.severity).map(([name, count]) => (
                    <tr key={name}>
                      <th scope="row">{severityLabels[name] ?? name}</th>
                      <td>{String(count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="grid" style={{ marginTop: 16 }}>
            <div className="card">
              <h2>原则比较</h2>
              {renderBars(
                Object.entries(summary.principles) as Array<[string, number]>,
                principleLabels,
              )}
              <table>
                <caption className="sr-only">原则问题数量数据表</caption>
                <tbody>
                  {Object.entries(summary.principles).map(([name, count]) => (
                    <tr key={name}>
                      <th scope="row">{principleLabels[name] ?? name}</th>
                      <td>{String(count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card">
              <h2>类别比较</h2>
              <table>
                <caption className="sr-only">类别分数比较数据表</caption>
                <thead>
                  <tr>
                    <th scope="col">类别</th>
                    <th scope="col">站点数</th>
                    <th scope="col">平均数</th>
                    <th scope="col">中位数</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.categories.map((item: any) => (
                    <tr key={item.name}>
                      <th scope="row">{item.name}</th>
                      <td>{item.count}</td>
                      <td>{item.mean ?? "N/A"}</td>
                      <td>{item.median ?? "N/A"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <h2>最常见规则与人工检查边界</h2>
            <p>
              所有类别合计需要人工检查 {summary.incomplete}{" "}
              个节点。以下为站点内自动问题节点最多的规则：
            </p>
            <table>
              <caption className="sr-only">最常见规则数据表</caption>
              <thead>
                <tr>
                  <th scope="col">规则</th>
                  <th scope="col">节点数</th>
                </tr>
              </thead>
              <tbody>
                {summary.commonRules.map((item: any) => (
                  <tr key={item.ruleId}>
                    <th scope="row">{item.ruleId}</th>
                    <td>{item.nodeCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {value?.ordinary?.baseline && value.ordinary.summary && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>普通已发布结果（不计入正式研究总体）</h2>
          <p className="muted">
            这些是普通扫描的已发布结果，只用于日常查看，不会与正式 study campaign 混合统计。
          </p>
          <h2>总分分布</h2>
          <p>
            有效站点 {value.ordinary.summary.distribution.count}；平均数{" "}
            {value.ordinary.summary.distribution.mean ?? "N/A"}；中位数{" "}
            {value.ordinary.summary.distribution.median ?? "N/A"}；范围{" "}
            {value.ordinary.summary.distribution.min ?? "N/A"}–
            {value.ordinary.summary.distribution.max ?? "N/A"}。
          </p>
          {renderBars(
            value.ordinary.summary.distribution.histogram.map((item: any) => [
              item.label,
              item.count,
            ]),
            {},
          )}
          <table>
            <caption className="sr-only">普通已发布结果列表</caption>
            <thead>
              <tr>
                <th scope="col">排名</th>
                <th scope="col">网站</th>
                <th scope="col">总分</th>
                <th scope="col">需要进一步判断</th>
                <th scope="col">run</th>
              </tr>
            </thead>
            <tbody>
              {value.ordinary.items.map((item: any, index: number) => (
                <tr key={item.runId}>
                  <td>{item.overall === null ? "N/A" : index + 1}</td>
                  <td>{item.name}</td>
                  <td>{item.overall === null ? "N/A" : item.overall}</td>
                  <td>{item.incomplete}</td>
                  <td>
                    <a href={`/scans/${item.runId}`}>{item.runId}</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
