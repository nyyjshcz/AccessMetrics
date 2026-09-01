import type { Route } from "next";
import { redirect } from "next/navigation";
import { getPageRole, loginRedirectPath } from "@/lib/access-control";
import { getLocale } from "@/lib/i18n-server";
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
  const locale = await getLocale();
  const copy = (await import("@/lib/i18n")).getMessages(locale).login;

  return (
    <section className="access-gate">
      <div className="access-gate-intro">
        <p className="eyebrow">{copy.introEyebrow}</p>
        <h2>
          {copy.introTitle.split("\n")[0]}
          <br />
          <em>{copy.introTitle.split("\n")[1]}</em>
        </h2>
        <p>{copy.introBody}</p>
        <ol className="access-flow">
          <li>
            <span>01</span>
            <div>
              <strong>{copy.flow[0][0]}</strong>
              <p>{copy.flow[0][1]}</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>{copy.flow[1][0]}</strong>
              <p>{copy.flow[1][1]}</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>{copy.flow[2][0]}</strong>
              <p>{copy.flow[2][1]}</p>
            </div>
          </li>
        </ol>
      </div>
      <div className="access-login">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p className="muted">{copy.subtitle}</p>
        <LoginForm nextPath={nextPath} locale={locale} />
      </div>
    </section>
  );
}
