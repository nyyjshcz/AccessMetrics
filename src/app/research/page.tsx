import { getDb, migrate } from "@/lib/db";
export const dynamic = "force-dynamic";
export default function ResearchPage() {
  migrate();
  const campaigns = getDb()
    .prepare(
      "SELECT id,status,target_site_count,created_at FROM study_campaigns ORDER BY created_at DESC",
    )
    .all() as any[];
  return (
    <section>
      <div className="card">
        <h1>研究总览</h1>
        <p className="muted">
          正式研究需要 R1–R5 真人确认。此页面只显示数据库中真实存在的
          campaign/freeze/export，不生成假样本、假排名或假结论。
        </p>
        <p className="muted" role="note">
          本项目仅评价 axe-core 能够自动判断的网页无障碍检查项。分数不等同于完整人工审计、官方 WCAG
          合规认证或“符合 WCAG 的百分比”。需要人工判断的项目会单独列出。
        </p>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Campaign</h2>
        {campaigns.length === 0 ? (
          <p>尚未登记正式 campaign。请先完成研究协议、样本框和 R1。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>状态</th>
                <th>目标站点</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.id}>
                  <td>{campaign.id}</td>
                  <td>{campaign.status}</td>
                  <td>{campaign.target_site_count}</td>
                  <td>{campaign.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
