export default async function ReviewBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  return (
    <section className="card">
      <h1>正式人工抽查</h1>
      <p className="muted">
        batch {batchId} 的完整抽样、双 reviewer、裁决和 R2/R3 状态由 role-bound API 读取。没有真实
        freeze/source export 时，页面不会伪造待审核样本。
      </p>
    </section>
  );
}
