"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
export default function LoginPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  async function submit(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ adminToken: token }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error?.message ?? "登录失败");
      return;
    }
    router.push("/admin/scans/new");
  }
  return (
    <section className="card" style={{ maxWidth: 480, margin: "32px auto" }}>
      <h1>管理登录</h1>
      <p className="muted">
        请输入由负责人通过生产密钥配置提供的管理口令；口令不会写入 URL、日志或浏览器存储。
      </p>
      <form onSubmit={submit}>
        <label htmlFor="admin-token">管理口令</label>
        <input
          id="admin-token"
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
