import "./globals.css";
import Link from "next/link";
export const metadata = { title: "AccessCheck Lishui", description: "本地网页无障碍扫描工具" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="topbar">
          <div className="shell">
            <Link className="brand" href="/">
              AccessCheck Lishui
            </Link>
            <nav className="topnav" aria-label="主导航">
              <Link href="/scans/new">新建扫描</Link>
              <Link href="/scans">活动任务</Link>
              <Link href="/reports">已发布报告</Link>
              <a href="/settings/ai">AI 设置</a>
            </nav>
          </div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
