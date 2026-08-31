import "./globals.css";
import Link from "next/link";
import { getPageRole } from "@/lib/access-control";
export const metadata = { title: "AccessCheck Lishui", description: "本地网页无障碍扫描工具" };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const role = await getPageRole();
  return (
    <html lang="zh-CN">
      <body>
        <header className="topbar">
          <div className="shell topbar-inner">
            <Link className="brand" href={role === "visitor" ? "/reports" : "/"}>
              <span className="brand-mark" aria-hidden="true">
                AC
              </span>
              <span className="brand-copy">
                <span>AccessCheck Lishui</span>
                <small>网页无障碍评估</small>
              </span>
            </Link>
            <nav className="topnav" aria-label="主导航">
              {role === "admin" && (
                <>
                  <Link href="/scans/new">新建扫描</Link>
                  <Link href="/scans">活动任务</Link>
                  <Link href="/reports">已发布报告</Link>
                  <Link href="/settings/ai">AI 设置</Link>
                </>
              )}
              {role === "visitor" && <Link href="/reports">已发布报告</Link>}
              {role && (
                <form action="/api/auth/logout" method="post" className="logout-form">
                  <span className="access-role">{role === "admin" ? "管理员" : "访客"}</span>
                  <button type="submit" className="topbar-button">
                    退出
                  </button>
                </form>
              )}
            </nav>
          </div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
