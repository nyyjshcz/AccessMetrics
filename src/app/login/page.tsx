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
  const guide = copy.projectGuide;

  return (
    <>
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
            {copy.flow.map((step, index) => (
              <li key={step[0]}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{step[0]}</strong>
                  <p>{step[1]}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="access-login">
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p className="muted">{copy.subtitle}</p>
          <LoginForm nextPath={nextPath} locale={locale} />
        </div>
      </section>

      <div className="login-guide">
        <section className="login-guide-section" aria-labelledby="login-process-title">
          <div className="login-guide-heading">
            <h2 id="login-process-title">{guide.processTitle}</h2>
            <p>{guide.processIntro}</p>
          </div>
          <ol className="login-process">
            {guide.processSteps.map((step, index) => (
              <li key={step[0]}>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{step[0]}</h3>
                  <p>{step[1]}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="login-guide-section" aria-labelledby="login-report-title">
          <div className="login-guide-heading">
            <h2 id="login-report-title">{guide.reportTitle}</h2>
            <p>{guide.reportIntro}</p>
          </div>
          <ul className="login-report-grid">
            {guide.reportItems.map((item) => (
              <li key={item[0]}>
                <h3>{item[0]}</h3>
                <p>{item[1]}</p>
              </li>
            ))}
          </ul>
          <div className="login-guide-caveats">
            <p>
              <strong>{guide.reviewNoteTitle}</strong>
              {guide.reviewNote}
            </p>
            <p>{guide.scoreNote}</p>
          </div>
        </section>

        <section className="login-guide-section" aria-labelledby="login-audience-title">
          <div className="login-guide-heading">
            <h2 id="login-audience-title">{guide.audienceTitle}</h2>
            <p>{guide.audienceIntro}</p>
          </div>
          <div className="login-audiences">
            <article className="login-audience-card">
              <h3>{guide.visitorTitle}</h3>
              <p>{guide.visitorBody}</p>
            </article>
            <article className="login-audience-card login-audience-card-admissions">
              <h3>{guide.admissionsTitle}</h3>
              <p>{guide.admissionsBody}</p>
            </article>
          </div>
        </section>
      </div>
    </>
  );
}
