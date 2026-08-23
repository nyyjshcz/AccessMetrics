"use client";
import { FormEvent, useState } from "react";
export default function ReviewLoginPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  const safeNextPath = () => {
    const candidate = new URLSearchParams(window.location.search).get("next") ?? "";
    return candidate.startsWith("/") && !candidate.startsWith("//") ? candidate : "";
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/reviewer/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewToken: token }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error?.message ?? "登录失败");
      return;
    }
    window.location.assign(safeNextPath() || "/research");
  }
  return (
    <section className="card" style={{ maxWidth: 480, margin: "32px auto" }}>
      <h1>Reviewer 登录</h1>
      <p className="muted">
        请输入本人持有的 reviewer token。服务端只从匹配 token 派生角色，不接受前端自报角色。
      </p>
      <form onSubmit={submit}>
        <label htmlFor="reviewer-token">Reviewer token</label>
        <input
          id="reviewer-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          required
        />
        {error && <p className="error">{error}</p>}
        <button type="submit">登录</button>
      </form>
    </section>
  );
}
