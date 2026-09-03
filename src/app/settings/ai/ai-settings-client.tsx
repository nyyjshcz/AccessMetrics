"use client";

import { useEffect, useState } from "react";
import { getMessages, type Locale } from "@/lib/i18n";

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

export default function AiSettingsClient({ locale = "zh-CN" }: { locale?: Locale }) {
  const copy = getMessages(locale).ai;
  const loadFailed = copy.loadFailed;
  const ui = locale === "en"
    ? {
        modelsNotice: (count: number) => `The server returned ${count} model IDs; this does not mean the models are downloaded or callable. Run a connection test after selecting one.`,
        deleteConfirm: (label: string) => `Delete “${label}”? This configuration cannot be recovered.`,
        keySaved: (fingerprint: string) => `Key saved (fingerprint ${fingerprint}…)`,
        baseUrlHelp: "The server validates URL safety; request paths are /models and /chat/completions.",
        concurrencyHelp: "This limit is shared by all scans using the model service; LM Studio is usually set to 1, and free OpenRouter models should start at 1.",
        noRateLimit: "No 20-per-minute limit (use maximum simultaneous requests)",
        rateLimit: "Limit requests to 20 per minute",
        rateHelp: "This affects new AI reviews only; the maximum simultaneous requests setting remains independent. When enabled, requests are limited to 20 per minute, which suits free OpenRouter models.",
        keyPlaceholderSaved: "Leave blank to keep the saved key",
        keyPlaceholderNew: "Optional; encrypted server-side only",
        keyHelp: "Saved keys are never shown; leaving this blank while editing keeps the existing value.",
        modelPlaceholder: "e.g. gpt-4o-mini",
      }
    : {
        modelsNotice: (count: number) => `服务端返回 ${count} 个模型 ID；这不表示模型已下载或一定可调用。选择后请再运行连接测试。`,
        deleteConfirm: (label: string) => `确定删除“${label}”吗？删除后配置不可恢复。`,
        keySaved: (fingerprint: string) => `Key 已保存（指纹 ${fingerprint}…）`,
        baseUrlHelp: "服务端会校验地址安全性；请求路径为 /models 和 /chat/completions。",
        concurrencyHelp: "同一模型服务的所有扫描共用此上限；本地 LM Studio 通常设为 1，OpenRouter 免费模型建议先设为 1。",
        noRateLimit: "不设每分钟 20 个请求的上限（按最大同时请求数处理）",
        rateLimit: "限制为每分钟 20 个请求",
        rateHelp: "只影响新建的 AI 复核；最大同时请求数仍独立生效。启用后会限制为每分钟 20 个请求，适合 OpenRouter 免费模型。",
        keyPlaceholderSaved: "留空以保留已保存的 Key",
        keyPlaceholderNew: "可选；仅服务端加密保存",
        keyHelp: "已保存的 Key 不会显示；编辑时留空会保留原值。",
        modelPlaceholder: "例如：gpt-4o-mini",
      };
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
        if (!response.ok) throw new Error(messageFrom(data, loadFailed));
        if (active) setProviders(data.providers ?? []);
      })
      .catch((error) => {
        if (active)
          setNotice({
            kind: "error",
            text: error instanceof Error ? error.message : loadFailed,
          });
      });
    return () => {
      active = false;
    };
  }, [loadFailed]);

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
    if (!response.ok) throw new Error(messageFrom(data, copy.saveFailed));
    const saved = data.provider as Provider;
    setProviders((items) =>
      current.id ? items.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...items],
    );
    setDraft({ ...current, id: saved.id, apiKey: "" });
    if (!quiet) setNotice({ kind: "success", text: copy.saved });
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
        throw new Error(messageFrom(data, action === "models" ? copy.modelsFailed : copy.testFailed));
      if (action === "models") {
        setModels(data.models ?? []);
        setNotice({
          kind: "success",
          text: ui.modelsNotice(data.models?.length ?? 0),
        });
      } else setNotice({ kind: "success", text: copy.tested });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : copy.operationFailed });
    } finally {
      setBusy(null);
    }
  }

  async function remove(provider: Provider) {
    if (!window.confirm(ui.deleteConfirm(provider.label))) return;
    setBusy(`delete:${provider.id}`);
    setNotice(null);
    try {
      const response = await fetch(`/api/ai/providers/${provider.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(messageFrom(data, copy.delete));
      setProviders((items) => items.filter((item) => item.id !== provider.id));
      if (draft?.id === provider.id) setDraft(null);
      setNotice({ kind: "success", text: copy.deleted });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : copy.delete });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card ai-settings-card">
      <p className="eyebrow">{copy.eyebrow}</p>
      <div className="section-heading">
        <div>
          <h1>{copy.title}</h1>
          <p className="settings-lede">
            {copy.lede}
          </p>
        </div>
        <button type="button" onClick={() => edit()}>
          {copy.add}
        </button>
      </div>
      {notice && (
        <p className={notice.kind === "error" ? "error notice" : "success notice"} role="status">
          {notice.text}
        </p>
      )}
      {!providers.length && !draft && (
        <p className="notice">
          {copy.noProviders}
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
                <span className="pill">{provider.enabled ? copy.enabled : copy.disabled}</span>
                <span className="pill">{copy.concurrency.replace("{count}", String(provider.maxConcurrentRequests ?? 1))}</span>
                <span className="pill">
                  {provider.rateLimitRpm === 20 ? copy.rpm : copy.noRpm}
                </span>
                {provider.keyFingerprint && (
                  <span className="muted provider-key">
                    {ui.keySaved(provider.keyFingerprint.slice(0, 10))}
                  </span>
                )}
              </p>
            </div>
            <div className="provider-actions">
              <button type="button" className="secondary" onClick={() => edit(provider)}>
                {copy.edit}
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
                {provider.enabled ? copy.disable : copy.enable}
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={busy === `delete:${provider.id}`}
                onClick={() => remove(provider)}
              >
                {copy.delete}
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
          <h2>{draft.id ? copy.editorEdit : copy.editorAdd}</h2>
          <label htmlFor="provider-label">{copy.display}</label>
          <input
            id="provider-label"
            required
            value={draft.label}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            placeholder={copy.localPlaceholder}
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
            {ui.baseUrlHelp}
          </small>
          <label htmlFor="provider-model">{copy.model}</label>
          <input
            id="provider-model"
            required
            value={draft.model}
            onChange={(event) => setDraft({ ...draft, model: event.target.value })}
            placeholder={ui.modelPlaceholder}
            list="provider-model-options"
          />
          <datalist id="provider-model-options">
            {models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <label htmlFor="provider-max-concurrency">{copy.concurrencyLabel}</label>
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
            {ui.concurrencyHelp}
          </small>
          <label htmlFor="provider-rate-limit">{copy.rate}</label>
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
            <option value="">{ui.noRateLimit}</option>
            <option value="20">{ui.rateLimit}</option>
          </select>
          <small className="muted">
            {ui.rateHelp}
          </small>
          <label htmlFor="provider-api-key">{copy.apiKey}</label>
          <input
            id="provider-api-key"
            type="password"
            autoComplete="new-password"
            value={draft.apiKey}
            onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
            placeholder={draft.id ? ui.keyPlaceholderSaved : ui.keyPlaceholderNew}
          />
          <small className="muted">{ui.keyHelp}</small>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            />{" "}
            {copy.enableProvider}
          </label>
          <div className="editor-actions">
            <button type="submit" disabled={busy !== null}>
              {busy === "save" ? copy.saving : copy.save}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy !== null}
              onClick={() => runAction("models", draft)}
            >
              {busy === "models" ? copy.reading : copy.readModels}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy !== null}
              onClick={() => runAction("test", draft)}
            >
              {busy === "test" ? copy.testing : copy.test}
            </button>
            <button type="button" className="secondary" onClick={() => setDraft(null)}>
              {copy.cancel}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
