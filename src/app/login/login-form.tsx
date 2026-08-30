"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm({ nextPath }: { nextPath?: string }) {
  const router = useRouter();
  const [accessKey, setAccessKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessKey, next: nextPath }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "登录失败");
      router.replace(data.redirectTo ?? "/");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="access-login-form" onSubmit={submit}>
      <label htmlFor="access-key">访问密钥</label>
      <input
        id="access-key"
        type="password"
        autoComplete="current-password"
        required
        value={accessKey}
        onChange={(event) => setAccessKey(event.target.value)}
        placeholder="输入管理员或访客密钥"
      />
      <p className="muted">
        管理员可以扫描、处理和发布；访客只能查看已发布报告。密钥不会保存在浏览器中。
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "正在验证…" : "进入系统"}
      </button>
    </form>
  );
}
