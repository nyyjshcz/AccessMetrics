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
    <section className="access-gate">
      <div className="access-gate-intro">
        <p className="eyebrow">EVIDENCE-LED ACCESSIBILITY ASSESSMENT</p>
        <h2>
          让网页无障碍评估
          <br />
          <em>有结论，也有证据。</em>
        </h2>
        <p>
          AccessCheck 将浏览器渲染、axe 自动检查、人工复核和结构化报告连成一条可追溯的评估路径，
          便于查看每一项结论来自哪里、还需要怎样验证。
        </p>
        <ol className="access-flow">
          <li>
            <span>01</span>
            <div>
              <strong>发现并扫描</strong>
              <p>在同一站点范围内浏览页面，以真实浏览器状态运行检查。</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>保留规则与节点证据</strong>
              <p>把可复核的规则、定位和页面信息保留下来，而非只给一个分数。</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>输出只读报告</strong>
              <p>将结果按优先级、四项原则和处理状态组织给评审者阅读。</p>
            </div>
          </li>
        </ol>
      </div>
      <div className="access-login">
        <p className="eyebrow">受控访问</p>
        <h1>输入访问密钥</h1>
        <p className="muted">管理员可管理评估流程；报告访客仅可阅读已发布报告。</p>
        <LoginForm nextPath={nextPath} />
      </div>
    </section>
  );
}
