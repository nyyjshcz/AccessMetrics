"use client";

import { useEffect, useState } from "react";

type Provider = {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  keyFingerprint: string;
  enabled: boolean;
};

function csrf() {
  return document.cookie.match(/(?:^|; )accesscheck_csrf=([^;]+)/)?.[1] ?? "";
}

export default function AiProviderSettingsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selected, setSelected] = useState<Provider | null>(null);
  const [label, setLabel] = useState("本地 Qwen");
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:1234/v1");
  const [model, setModel] = useState("qwen3.8-27b");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/admin/ai/providers");
    const value = await response.json();
    if (!response.ok) throw new Error(value.error?.message ?? "读取模型配置失败");
    setProviders(value.providers ?? []);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load().catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "读取模型配置失败"),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function choose(provider: Provider) {
    setSelected(provider);
    setLabel(provider.label);
    setBaseUrl(provider.baseUrl);
    setModel(provider.model);
    setApiKey("");
    setModels([]);
    setMessage("已载入配置；API Key 留空表示继续使用已保存的 Key。");
  }

  async function fetchModels() {
    if (!selected) {
      setError("请先保存配置，再获取模型列表。");
      return;
    }
    setError("");
    setModelsLoading(true);
    try {
      const response = await fetch(`/api/admin/ai/providers/${selected.id}/models`);
      const value = await response.json();
      if (!response.ok) throw new Error(value.error?.message ?? "获取模型列表失败");
      setModels(value.models ?? []);
      setMessage(`已获取 ${value.models?.length ?? 0} 个模型。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "获取模型列表失败");
    } finally {
      setModelsLoading(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    const response = await fetch("/api/admin/ai/providers", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({
        ...(selected ? { id: selected.id } : {}),
        label,
        baseUrl,
        model,
        ...(apiKey ? { apiKey } : {}),
        enabled: true,
      }),
    });
    const value = await response.json();
    if (!response.ok) {
      setError(value.error?.message ?? "保存失败");
      return;
    }
    setSelected(value.provider);
    setApiKey("");
    setMessage("已保存。API Key 不会回显。");
    await load();
  }

  async function test(provider: Provider) {
    setError("");
    setMessage("正在测试连接…");
    const response = await fetch(`/api/admin/ai/providers/${provider.id}/test`, {
      method: "POST",
      headers: { "x-csrf-token": csrf() },
    });
    const value = await response.json();
    if (!response.ok) setError(value.error?.message ?? "连接测试失败");
    else setMessage(`连接成功，可用模型 ${value.models?.length ?? 0} 个。`);
  }

  return (
    <section>
      <div className="card">
        <h1>AI 模型提供商</h1>
        <p className="muted">
          只兼容 OpenAI-compatible API。API Key 在服务端加密保存，页面不会再次显示明文。
        </p>
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
        <form onSubmit={save}>
          <label>
            配置名称
            <input value={label} onChange={(event) => setLabel(event.target.value)} required />
          </label>
          <label>
            OpenAI-compatible Base URL
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required />
          </label>
          <label>
            模型名称
            <input value={model} onChange={(event) => setModel(event.target.value)} required />
          </label>
          <label>
            API Key（新建时可留空；编辑时留空表示不更换）
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <button type="submit">{selected ? "保存修改" : "保存配置"}</button>
          {selected ? (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setSelected(null);
                setLabel("本地 Qwen");
                setBaseUrl("http://127.0.0.1:1234/v1");
                setModel("qwen3.8-27b");
                setApiKey("");
                setModels([]);
              }}
            >
              新建配置
            </button>
          ) : null}
        </form>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>已保存配置</h2>
        {providers.length === 0 ? (
          <p>还没有配置。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>Base URL</th>
                <th>模型</th>
                <th>Key 指纹</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id}>
                  <td>{provider.label}</td>
                  <td>
                    <code>{provider.baseUrl}</code>
                  </td>
                  <td>{provider.model}</td>
                  <td>
                    <code>
                      {provider.keyFingerprint ? provider.keyFingerprint.slice(0, 12) : "无 Key"}
                    </code>
                  </td>
                  <td>
                    <button type="button" className="secondary" onClick={() => choose(provider)}>
                      编辑
                    </button>{" "}
                    <button type="button" onClick={() => test(provider)}>
                      测试连接
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selected ? (
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="secondary"
              onClick={fetchModels}
              disabled={modelsLoading}
            >
              {modelsLoading ? "获取中…" : "获取模型列表"}
            </button>
            {models.length ? <p className="muted">服务端模型：{models.join("、")}</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
