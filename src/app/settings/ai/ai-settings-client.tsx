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
type Draft = {
  id?: string;
  label: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  maxConcurrentRequests: number;
  rateLimitRpm: number | null;
  enabled: boolean;
};
const emptyDraft = (): Draft => ({
  label: "",
  baseUrl: "https://api.openai.com/v1",
  model: "",
  apiKey: "",
  maxConcurrentRequests: 1,
  rateLimitRpm: null,
  enabled: true,
});

function messageFrom(data: any, fallback: string) {
  return typeof data?.error?.message === "string" ? data.error.message : fallback;
}

export default function AiSettingsClient() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/ai/providers")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(messageFrom(data, "无法读取模型配置"));
        if (active) setProviders(data.providers ?? []);
      })
      .catch((error) => {
        if (active)
          setNotice({
            kind: "error",
            text: error instanceof Error ? error.message : "无法读取模型配置",
          });
      });
    return () => {
      active = false;
    };
  }, []);

  function edit(provider?: Provider) {
    setNotice(null);
    setModels([]);
    setDraft(
      provider
        ? {
            id: provider.id,
            label: provider.label,
            baseUrl: provider.baseUrl,
            model: provider.model,
            apiKey: "",
            maxConcurrentRequests: provider.maxConcurrentRequests ?? 1,
            rateLimitRpm: provider.rateLimitRpm ?? null,
            enabled: provider.enabled,
          }
        : emptyDraft(),
    );
  }

  async function save(current: Draft, quiet = false) {
    const method = current.id ? "PATCH" : "POST";
    const url = current.id ? `/api/ai/providers/${current.id}` : "/api/ai/providers";
    const { id: _id, ...payload } = current;
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(messageFrom(data, "保存模型配置失败"));
    const saved = data.provider as Provider;
    setProviders((items) =>
      current.id ? items.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...items],
    );
    setDraft({ ...current, id: saved.id, apiKey: "" });
    if (!quiet) setNotice({ kind: "success", text: "模型配置已保存。API Key 不会在页面显示。" });
    return saved;
  }

  async function runAction(action: "models" | "test", current: Draft) {
    setBusy(action);
    setNotice(null);
    try {
      const saved = await save(current, true);
      const response = await fetch(`/api/ai/providers/${saved.id}/${action}`, {
        method: action === "test" ? "POST" : "GET",
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(messageFrom(data, action === "models" ? "读取模型失败" : "连接测试失败"));
      if (action === "models") {
        setModels(data.models ?? []);
        setNotice({
          kind: "success",
          text: `服务端返回 ${data.models?.length ?? 0} 个模型 ID；这不表示模型已下载或一定可调用。选择后请再运行连接测试。`,
        });
      } else setNotice({ kind: "success", text: "连接测试成功。" });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "操作失败" });
    } finally {
      setBusy(null);
    }
  }

  async function remove(provider: Provider) {
    if (!window.confirm(`确定删除“${provider.label}”吗？删除后配置不可恢复。`)) return;
    setBusy(`delete:${provider.id}`);
    setNotice(null);
    try {
      const response = await fetch(`/api/ai/providers/${provider.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(messageFrom(data, "删除失败"));
      setProviders((items) => items.filter((item) => item.id !== provider.id));
      if (draft?.id === provider.id) setDraft(null);
      setNotice({ kind: "success", text: "模型配置已删除。" });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "删除失败" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card ai-settings-card">
      <p className="eyebrow">MODEL SERVICES</p>
      <div className="section-heading">
        <div>
          <h1>AI 模型配置</h1>
          <p className="settings-lede">
            仅支持 OpenAI-compatible API。AI 只辅助处理需要进一步判断的项目，不会覆盖原始 axe
            结果或人工判断。
          </p>
        </div>
        <button type="button" onClick={() => edit()}>
          添加模型服务
        </button>
      </div>
      {notice && (
        <p className={notice.kind === "error" ? "error notice" : "success notice"} role="status">
          {notice.text}
        </p>
      )}
      {!providers.length && !draft && (
        <p className="notice">
          还没有模型配置。点击“添加模型服务”，填写 Base URL、模型名称和 API Key 后保存。
        </p>
      )}
      <div className="provider-list">
        {providers.map((provider) => (
          <article className="provider-row" key={provider.id}>
            <div>
              <h2>{provider.label || provider.id}</h2>
              <p className="muted">
                {provider.baseUrl} · {provider.model}
              </p>
              <p>
                <span className="pill">{provider.enabled ? "已启用" : "已停用"}</span>
                <span className="pill">最大并发 {provider.maxConcurrentRequests ?? 1}</span>
                <span className="pill">
                  {provider.rateLimitRpm === 20 ? "20 请求/分钟" : "不启用 RPM 限速"}
                </span>
                {provider.keyFingerprint && (
                  <span className="muted provider-key">
                    Key 已保存（指纹 {provider.keyFingerprint.slice(0, 10)}…）
                  </span>
                )}
              </p>
            </div>
            <div className="provider-actions">
              <button type="button" className="secondary" onClick={() => edit(provider)}>
                编辑
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const next: Draft = {
                    id: provider.id,
                    label: provider.label,
                    baseUrl: provider.baseUrl,
                    model: provider.model,
                    apiKey: "",
                    maxConcurrentRequests: provider.maxConcurrentRequests ?? 1,
                    rateLimitRpm: provider.rateLimitRpm ?? null,
                    enabled: !provider.enabled,
                  };
                  save(next).catch((error) => setNotice({ kind: "error", text: error.message }));
                }}
              >
                {provider.enabled ? "停用" : "启用"}
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={busy === `delete:${provider.id}`}
                onClick={() => remove(provider)}
              >
                删除
              </button>
            </div>
          </article>
        ))}
      </div>
      {draft && (
        <form
          className="provider-editor"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy("save");
            save(draft)
              .catch((error) => setNotice({ kind: "error", text: error.message }))
              .finally(() => setBusy(null));
          }}
        >
          <h2>{draft.id ? "编辑模型服务" : "添加模型服务"}</h2>
          <label htmlFor="provider-label">显示名称</label>
          <input
            id="provider-label"
            required
            value={draft.label}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            placeholder="例如：本地模型"
          />
          <label htmlFor="provider-base-url">Base URL</label>
          <input
            id="provider-base-url"
            required
            type="url"
            value={draft.baseUrl}
            onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
            placeholder="https://api.openai.com/v1"
          />
          <small className="muted">
            服务端会校验地址安全性；请求路径为 /models 和 /chat/completions。
          </small>
          <label htmlFor="provider-model">模型</label>
          <input
            id="provider-model"
            required
            value={draft.model}
            onChange={(event) => setDraft({ ...draft, model: event.target.value })}
            placeholder="例如：gpt-4o-mini"
            list="provider-model-options"
          />
          <datalist id="provider-model-options">
            {models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <label htmlFor="provider-max-concurrency">最大同时请求数</label>
          <input
            id="provider-max-concurrency"
            required
            type="number"
            min={1}
            max={16}
            step={1}
            value={draft.maxConcurrentRequests}
            onChange={(event) =>
              setDraft({ ...draft, maxConcurrentRequests: Number(event.target.value) })
            }
          />
          <small className="muted">
            同一模型服务的所有扫描共用此上限；本地 LM Studio 通常设为 1，OpenRouter
            免费模型建议先设为 1。
          </small>
          <label htmlFor="provider-rate-limit">请求速率策略</label>
          <select
            id="provider-rate-limit"
            value={draft.rateLimitRpm ?? ""}
            onChange={(event) =>
              setDraft({
                ...draft,
                rateLimitRpm: event.target.value === "" ? null : Number(event.target.value),
              })
            }
          >
            <option value="">不启用 20 请求/分钟（按最大并发持续处理）</option>
            <option value="20">启用 20 请求/分钟策略</option>
          </select>
          <small className="muted">
            只影响新建的 AI 批次；最大并发仍独立生效。启用后会按 20 请求/分钟节流，适合 OpenRouter
            免费模型。
          </small>
          <label htmlFor="provider-api-key">API Key</label>
          <input
            id="provider-api-key"
            type="password"
            autoComplete="new-password"
            value={draft.apiKey}
            onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
            placeholder={draft.id ? "留空以保留已保存的 Key" : "可选；仅服务端加密保存"}
          />
          <small className="muted">已保存的 Key 不会显示；编辑时留空会保留原值。</small>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            />{" "}
            启用此 provider
          </label>
          <div className="editor-actions">
            <button type="submit" disabled={busy !== null}>
              {busy === "save" ? "保存中…" : "保存"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy !== null}
              onClick={() => runAction("models", draft)}
            >
              {busy === "models" ? "读取中…" : "保存并读取模型"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy !== null}
              onClick={() => runAction("test", draft)}
            >
              {busy === "test" ? "测试中…" : "保存并测试连接"}
            </button>
            <button type="button" className="secondary" onClick={() => setDraft(null)}>
              取消
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
