"use client";

import { useEffect, useMemo, useState } from "react";

type Provider = { id: string; label: string; baseUrl: string; model: string; enabled: boolean };

function csrf() {
  return document.cookie.match(/(?:^|; )accesscheck_csrf=([^;]+)/)?.[1] ?? "";
}

export default function AiOverlayCard({
  runId,
  pages,
}: {
  runId: string;
  pages: Array<{ id: string; canonical_url: string }>;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [pageId, setPageId] = useState("");
  const [data, setData] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const query = useMemo(() => (pageId ? `?pageId=${encodeURIComponent(pageId)}` : ""), [pageId]);

  async function load() {
    const [providerResponse, statusResponse] = await Promise.all([
      fetch("/api/admin/ai/providers"),
      fetch(`/api/runs/${runId}/ai-review${query}`),
    ]);
    const providerValue = await providerResponse.json();
    const statusValue = await statusResponse.json();
    if (!providerResponse.ok) throw new Error(providerValue.error?.message ?? "读取 AI 配置失败");
    if (!statusResponse.ok) throw new Error(statusValue.error?.message ?? "读取 AI 状态失败");
    const available = (providerValue.providers ?? []).filter((value: Provider) => value.enabled);
    setProviders(available);
    if (!providerId && available[0]) setProviderId(available[0].id);
    setData(statusValue);
    setError("");
  }

  const batch = data?.batch?.batch ?? data?.batch ?? null;
  const stats = data?.batch?.stats ?? data?.stats ?? null;
  const status = batch?.status;
  const batchSnapshot = (() => {
    if (!batch?.provider_snapshot_json) return null;
    try {
      return JSON.parse(batch.provider_snapshot_json) as { label?: string; model?: string };
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      load().catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "读取 AI 状态失败"),
      );
    }, 0);
    const timer = window.setInterval(() => {
      if (status === "queued" || status === "running") load().catch(() => undefined);
    }, 2000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
    // The timer intentionally reads the latest state only when the card rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, query, status]);

  async function createBatch() {
    if (!providerId) {
      setError("请先在 AI 设置页保存并启用一个模型配置。");
      return;
    }
    setError("");
    setMessage("正在创建 AI 批次…");
    const response = await fetch(`/api/runs/${runId}/ai-review`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({ providerConfigId: providerId, ...(pageId ? { pageId } : {}) }),
    });
    const value = await response.json();
    if (!response.ok) {
      setError(value.error?.message ?? "创建 AI 批次失败");
      setMessage("");
      return;
    }
    setMessage("批次已保存，worker 会逐条继续处理。");
    setData(value);
    await load();
  }

  async function action(actionName: "pause" | "resume" | "retry") {
    const batchId = batch?.id;
    if (!batchId) return;
    const response = await fetch(`/api/ai/batches/${batchId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({ action: actionName }),
    });
    const value = await response.json();
    if (!response.ok) setError(value.error?.message ?? "AI 批次操作失败");
    else setData((current: any) => ({ ...current, batch: value.batch, stats: value.stats }));
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>AI Incomplete 解析</h2>
      <p className="muted">AI 只处理 incomplete；原始 axe 结果、原始分数和人工审核不会被覆盖。</p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      <div className="filters">
        <label>
          处理范围
          <select value={pageId} onChange={(event) => setPageId(event.target.value)}>
            <option value="">当前 run 全部页面</option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.canonical_url}
              </option>
            ))}
          </select>
        </label>
        <label>
          模型配置
          <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
            <option value="">请选择</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label} · {provider.model}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>
        <a href="/admin/settings/ai">管理 AI provider 配置</a>
      </p>
      <p>
        incomplete 总数：<strong>{data?.totalIncomplete ?? 0}</strong>
      </p>
      {stats ? (
        <>
          <p>
            已冻结模型：<strong>{batchSnapshot?.model ?? "未知"}</strong>
            {batchSnapshot?.label ? `（${batchSnapshot.label}）` : ""}
          </p>
          <p>
            已完成 {stats.completed}/{stats.total} · problem {stats.problem} · not_problem{" "}
            {stats.notProblem} · uncertain {stats.uncertain} · failed {stats.failed}
          </p>
          <p>
            处理覆盖率 {stats.processedCoverage}% · resolution coverage {stats.resolutionCoverage}%
            · 状态 {status}
          </p>
        </>
      ) : (
        <p className="muted">还没有该范围的 AI batch。</p>
      )}
      <div>
        <button
          type="button"
          onClick={createBatch}
          disabled={status === "queued" || status === "running"}
        >
          一键处理 incomplete
        </button>{" "}
        {status === "queued" || status === "running" ? (
          <button type="button" className="secondary" onClick={() => action("pause")}>
            暂停
          </button>
        ) : null}{" "}
        {status === "paused" ? (
          <button type="button" className="secondary" onClick={() => action("resume")}>
            继续
          </button>
        ) : null}{" "}
        {status === "failed" ? (
          <button type="button" className="secondary" onClick={() => action("retry")}>
            重试失败项
          </button>
        ) : null}
      </div>
    </div>
  );
}
