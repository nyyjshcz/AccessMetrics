import type { Route } from "next";
import { redirect } from "next/navigation";
import { getPageRole, loginRedirectPath } from "@/lib/access-control";
import LoginForm from "./login-form";

type LoginPageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const nextPath =
    typeof rawNext === "string" && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : undefined;
  const role = await getPageRole();
  if (role) redirect(loginRedirectPath(nextPath, role) as Route);

  return (
    <section className="access-login">
      <p className="eyebrow">AccessCheck Lishui</p>
      <h1>输入访问密钥</h1>
      <p className="muted">此部署仅向获授权的管理员与报告访客开放。</p>
      <LoginForm nextPath={nextPath} />
    </section>
  );
}
