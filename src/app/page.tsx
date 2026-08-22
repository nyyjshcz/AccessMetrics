import Link from "next/link";
import { getDb, migrate } from "@/lib/db";
export const dynamic = "force-dynamic";
export default function HomePage() {
  migrate();
  const publishedSites = Number(
    (
      getDb()
        .prepare("SELECT COUNT(DISTINCT site_id) count FROM scan_runs WHERE published=1")
        .get() as { count: number }
    ).count,
  );
  const successfulPages = Number(
    (
      getDb()
        .prepare(
          "SELECT COUNT(*) count FROM pages p JOIN scan_runs r ON r.id=p.run_id WHERE r.published=1 AND p.scan_status='completed'",
        )
        .get() as { count: number }
    ).count,
  );
  const latest = (
    getDb().prepare("SELECT MAX(published_at) value FROM scan_runs WHERE published=1").get() as {
      value: string | null;
    }
  ).value;
  return (
    <>
      <section className="card">
        <h1>网站无障碍扫描与研究平台</h1>
        <p className="muted">
          输入一个公开网站，系统会在同站范围内发现页面，使用 Playwright + axe-core
          扫描，将规则结果、节点证据和可复核评分保存到 SQLite，并生成结构化导出。
        </p>
        <p className="muted" role="note">
          本项目仅评价 axe-core 能够自动判断的网页无障碍检查项。分数不等同于完整人工审计、官方 WCAG
          合规认证或“符合 WCAG 的百分比”。需要人工判断的项目会单独列出。
        </p>
        <p>
          <span className="pill">评分模型 accesscheck-score-v1</span>{" "}
          <span className="pill">WCAG 2.2 映射</span> <span className="pill">可追溯导出</span>
        </p>
        <p>
          已发布站点：{publishedSites}；成功页面：{successfulPages}；最近更新时间：
          {latest ?? "暂无"}
        </p>
        <p>
          <Link href="/research">进入研究总览</Link>
        </p>
        <Link href="/admin/login">
          <button style={{ width: "auto", paddingInline: 24 }}>进入管理端</button>
        </Link>
      </section>
      <section className="grid" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>可感知</h2>
          <p>图片替代文本、颜色对比度、内容结构等。</p>
        </div>
        <div className="card">
          <h2>可操作</h2>
          <p>键盘操作、链接和按钮名称、焦点路径等。</p>
        </div>
        <div className="card">
          <h2>易理解</h2>
          <p>语言、标题、表单标签和错误提示等。</p>
        </div>
        <div className="card">
          <h2>兼容性</h2>
          <p>ARIA 角色、重复 ID 与辅助技术语义等。</p>
        </div>
      </section>
    </>
  );
}
