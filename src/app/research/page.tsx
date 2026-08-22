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
                <th scope="col">网站</th>
                <th scope="col">类别</th>
                <th scope="col">来源</th>
                <th scope="col">run</th>
              </tr>
            </thead>
            <tbody>
              {value.items.map((item: any) => (
                <tr key={item.runId}>
                  <td>{item.name}</td>
                  <td>{item.category ?? "未分类"}</td>
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
    </section>
  );
}
