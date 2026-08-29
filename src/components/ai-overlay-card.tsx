"use client";

import { useEffect, useState } from "react";

type Provider = {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  maxConcurrentRequests: number;
  rateLimitRpm: number | null;
  keyFingerprint: string;
  enabled: boolean;
};

function formatTimestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(date);
}

export default function AiOverlayCard({
  runId,
  pages,
  onBatchChange,
  readOnly = false,
}: {
  runId: string;
  pages: Array<{ id: string; canonical_url: string }>;
  onBatchChange?: () => void;
  readOnly?: boolean;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [data, setData] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const query = providerId ? `?providerConfigId=${encodeURIComponent(providerId)}` : "";

  async function load() {
    const [providerResponse, statusResponse] = await Promise.all([
      fetch("/api/ai/providers", { cache: "no-store" }),
      fetch(`/api/runs/${runId}/ai-review${query}`, { cache: "no-store" }),
    ]);
    const providerValue = await providerResponse.json();
    const statusValue = await statusResponse.json();
    if (!providerResponse.ok) throw new Error(providerValue.error?.message ?? "读取 AI 配置失败");
    if (!statusResponse.ok) throw new Error(statusValue.error?.message ?? "读取 AI 状态失败");
    const available = (providerValue.providers ?? []).filter((value: Provider) => value.enabled);
    setProviders(available);
    if (!providerId && available[0]) setProviderId(available[0].id);
    const previousStatus = data?.batch?.batch?.status ?? data?.batch?.status;
    const nextBatch = statusValue?.batch?.batch ?? statusValue?.batch ?? null;
    setData(statusValue);
    setError("");
    if (
      (previousStatus === "queued" || previousStatus === "running") &&
      nextBatch?.status !== "queued" &&
      nextBatch?.status !== "running"
    )
      onBatchChange?.();
  }

  const batch = data?.batch?.batch ?? data?.batch ?? null;
  const stats = data?.batch?.stats ?? data?.stats ?? null;
  const status = batch?.status;
  const hasBatch = Boolean(batch);
  const queued = Number(stats?.queued ?? 0);
  const running = Number(stats?.running ?? 0);
  const delayed = Number(stats?.delayed ?? 0);
  const failed = Number(stats?.failed ?? 0);
  const providerRateLimitRpm = Number(stats?.providerRateLimitRpm ?? 0);
  const failedBatchHasPending = status === "failed" && queued + running > 0;
  const nextRetryAt = formatTimestamp(stats?.nextRetryAt);
  const waitingError = typeof stats?.waitingError === "string" ? stats.waitingError : "";
  const statusText =
    status === "paused"
      ? "已暂停"
      : status === "completed"
        ? "已完成"
        : status === "failed"
          ? "需要处理"
          : delayed > 0
            ? waitingError.includes("限流") ? "等待 API 限额" : "自动重试等待"
            : running > 0
              ? "正在处理"
              : queued > 0
                ? providerRateLimitRpm > 0
                  ? `按 ${providerRateLimitRpm} RPM 排队`
                  : "等待 Worker 领取"
                : "等待状态更新";
  const workerStatus = (() => {
    if (status === "paused") return "已暂停，不会再发起模型请求";
    if (status === "completed") return "全部项目已处理完成";
    if (status === "failed")
      return failedBatchHasPending
        ? `旧批次已停止，仍有 ${queued + running} 项未处理`
        : "没有待处理项，但有需要人工重试的失败项";
    if (delayed > 0)
      return `${waitingError.includes("限流") ? "模型服务限流" : "模型服务暂时不可用"}${nextRetryAt ? `，预计 ${nextRetryAt} 后自动重试` : "，会自动重试"}${running ? `；仍有 ${running} 项正在返回` : ""}`;
    if (running > 0)
      return providerRateLimitRpm > 0
        ? `正在处理 ${running} 项；后续请求按 ${providerRateLimitRpm} 请求/分钟安排`
        : `正在处理 ${running} 项`;
    if (queued > 0 && providerRateLimitRpm > 0)
      return `按 ${providerRateLimitRpm} 请求/分钟策略处理，队列会自动继续，无需手动点击`;
    if (queued > 0) return `Worker 排队等待处理 ${queued} 项`;
    return "等待 Worker 状态更新";
  })();
  const isReadOnly = readOnly || Boolean(data?.readOnly);
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const batchSnapshot = (() => {
    if (!batch?.provider_snapshot_json) return null;
    try {
      return JSON.parse(batch.provider_snapshot_json) as {
        label?: string;
        baseUrl?: string;
        model?: string;
        keyFingerprint?: string;
        rateLimitRpm?: number | null;
      };
    } catch {
      return null;
    }
  })();
  const currentProviderMatchesBatch = Boolean(
    selectedProvider &&
      batchSnapshot &&
      batchSnapshot.label === selectedProvider.label &&
      batchSnapshot.baseUrl === selectedProvider.baseUrl &&
      batchSnapshot.model === selectedProvider.model &&
      batchSnapshot.keyFingerprint === selectedProvider.keyFingerprint &&
      batchSnapshot.rateLimitRpm === selectedProvider.rateLimitRpm,
  );
  const canCreateWithCurrentConfig =
    (status === "failed" || status === "paused") &&
    Boolean(selectedProvider) &&
    !currentProviderMatchesBatch;

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      load().catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "读取 AI 状态失败"),
      );
    }, 0);
    return () => {
      window.clearTimeout(initialLoad);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, query]);

  useEffect(() => {
    if (status !== "queued" && status !== "running") return;
    const timer = window.setInterval(() => load().catch(() => undefined), 2000);
    return () => window.clearInterval(timer);
    // The timer intentionally reads the latest state only when the card rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, query, status]);

  async function createBatch() {
    if (isReadOnly) return;
    if (!providerId) {
      setError("请先在 AI 设置页保存并启用一个模型配置。");
      return;
    }
    setError("");
    setMessage("正在创建 AI 批次…");
    const response = await fetch(`/api/runs/${runId}/ai-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerConfigId: providerId }),
    });
    const value = await response.json();
    if (!response.ok) {
      setError(value.error?.message ?? "创建 AI 批次失败");
      setMessage("");
      return;
    }
    const returnedStatus = value.batch?.status ?? value.batch?.batch?.status;
    const returnedProviderId = value.batch?.provider_config_id ?? value.batch?.batch?.provider_config_id;
    const returnedStats = value.stats ?? value.batch?.stats ?? null;
    const returnedPending = Number(returnedStats?.queued ?? 0) + Number(returnedStats?.running ?? 0);
    setMessage(
      returnedStatus === "failed"
        ? returnedPending > 0
          ? "当前配置已有停止的旧批次，仍有未处理项，请点击“继续处理未完成项”。"
          : "当前配置已有失败批次，请点击“重试失败项”。"
        : "批次已保存，worker 会逐条继续处理。",
    );
    if (typeof returnedProviderId === "string" && returnedProviderId) setProviderId(returnedProviderId);
    setData((current: any) => ({ ...current, ...value }));
    onBatchChange?.();
  }

  async function action(actionName: "pause" | "resume" | "retry") {
    if (isReadOnly) return;
    const batchId = batch?.id;
    if (!batchId) return;
    const response = await fetch(`/api/ai/batches/${batchId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: actionName }),
    });
    const value = await response.json();
    if (!response.ok) setError(value.error?.message ?? "AI 批次操作失败");
    else {
      setData((current: any) => ({ ...current, batch: value.batch, stats: value.stats }));
      onBatchChange?.();
    }
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
        <p className="muted">处理范围：当前扫描的全部 incomplete（一次只运行一个 run-wide 批次）。</p>
        <label>
          模型配置
          <select value={providerId} onChange={(event) => setProviderId(event.target.value)} disabled={isReadOnly}>
            <option value="">请选择</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label} · {provider.model}（最大并发 {provider.maxConcurrentRequests ?? 1}
                {provider.rateLimitRpm === 20 ? "，20 RPM" : ""}）
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>
        <a href="/settings/ai">管理 AI provider 配置</a>
      </p>
      {selectedProvider ? (
        <p className="muted">
          此 provider 的最大同时请求数：{selectedProvider.maxConcurrentRequests ?? 1}；
          {selectedProvider.rateLimitRpm === 20
            ? "已启用 20 请求/分钟策略"
            : "未启用 20 请求/分钟策略"}
        </p>
      ) : null}
      <p>
        incomplete 总数：<strong>{data?.totalIncomplete ?? 0}</strong>
      </p>
      {isReadOnly ? <p className="notice">该扫描已发布，AI 处理为只读。</p> : null}
      {stats ? (
        <>
          <div className="ai-monitor" aria-live="polite">
            <div className="ai-monitor-heading">
              <strong>AI Worker 监控</strong>
              <span className="pill">{statusText}</span>
            </div>
            <p>{workerStatus}</p>
            <div className="ai-monitor-grid">
              <div><span>总项目</span><strong>{stats.total}</strong></div>
              <div><span>已完成</span><strong>{stats.completed}</strong></div>
              <div><span>正在处理</span><strong>{running}</strong></div>
              <div><span>待处理</span><strong>{queued - delayed}</strong></div>
              <div><span>等待重试</span><strong>{delayed}</strong></div>
              <div><span>失败</span><strong>{failed}</strong></div>
            </div>
            {delayed > 0 ? (
              <p className="notice">
                {waitingError || "模型服务暂时不可用"}。{nextRetryAt ? `预计 ${nextRetryAt} 后自动重试。` : "Worker 会自动重试。"}
              </p>
            ) : null}
            {providerRateLimitRpm > 0 ? (
              <p className="muted">
                当前已启用 {providerRateLimitRpm} 请求/分钟策略；服务端返回 Retry-After 时会按其等待。
              </p>
            ) : null}
            {batch?.updated_at ? <p className="muted">每 2 秒自动刷新 · 最近状态更新：{formatTimestamp(batch.updated_at) ?? "未知"}</p> : null}
          </div>
          <p>
            已冻结模型：<strong>{batchSnapshot?.model ?? "未知"}</strong>
            {batchSnapshot?.label ? `（${batchSnapshot.label}）` : ""}
          </p>
          <p>处理覆盖率 {stats.processedCoverage}% · 已给出 problem {stats.problem} · not_problem {stats.notProblem} · uncertain {stats.uncertain}</p>
        </>
      ) : (
        <p className="muted">还没有该范围的 AI batch。</p>
      )}
      {canCreateWithCurrentConfig ? (
        <p className="notice">
          当前 provider 配置已变化；旧失败批次保持不变，可按当前配置新建批次。
        </p>
      ) : null}
      {!isReadOnly ? <div>
        {!hasBatch ? <button type="button" onClick={createBatch}>一键处理 incomplete</button> : null}{" "}
        {canCreateWithCurrentConfig ? (
          <button type="button" onClick={createBatch}>
            按当前配置重新处理 incomplete
          </button>
        ) : null}{" "}
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
            {failedBatchHasPending ? "继续处理未完成项" : "重试失败项"}
          </button>
        ) : null}
        {status === "completed" ? <span className="pill">completed</span> : null}
      </div> : null}
    </div>
  );
}
