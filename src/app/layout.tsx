import "./globals.css";
import Link from "next/link";
export const metadata = { title: "AccessCheck Lishui", description: "无障碍扫描、评分与研究导出" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="topbar">
          <div className="shell">
            <Link className="brand" href="/">
              AccessCheck Lishui
            </Link>
            <nav>
              <Link href="/admin/login" style={{ color: "#fff" }}>
                管理入口
              </Link>
            </nav>
          </div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
