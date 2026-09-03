"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useState } from "react";
import AiOverlayCard from "@/components/ai-overlay-card";
import IncompleteReview from "@/components/incomplete-review";
import type { Locale } from "@/lib/i18n";

export default function ReviewClient({ runId, locale }: { runId: string; locale: Locale }) {
  const en = locale === "en";
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const load = useCallback(async () => {
    const response = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(payload?.error?.message ?? (en ? "Failed to load scan" : "读取扫描失败"));
    setData(payload);
  }, [en, runId]);
  // The request synchronizes this client view with the server's scan state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    void load().catch((reason) =>
      setError(
        reason instanceof Error ? reason.message : en ? "Failed to load scan" : "读取扫描失败",
      ),
    );
  }, [en, load]);
  if (error)
    return (
      <p className="error notice" role="alert">
        {error}
      </p>
    );
  if (!data) return <p role="status">{en ? "Loading review items…" : "正在读取复核项目…"}</p>;
  const published = data.run?.published === 1;
  return (
    <section className="review-page">
      <header className="review-page-header">
        <div>
          <p className="eyebrow">{en ? "OPTIONAL REVIEW" : "可选复核"}</p>
          <h1>{en ? "Review items" : "复核项目"}</h1>
          <p className="lead">
            {en
              ? "Only cases the automatic check could not settle are shown here. You can leave them unresolved and still read, export, or publish the report."
              : "这里只有自动检查无法确定的项目。你可以不处理，仍然查看、导出或发布完整报告。"}
          </p>
        </div>
        <Link className="secondary-link" href={`/reports/${runId}` as Route}>
          {en ? "Skip to full report" : "跳过，查看完整报告"}
        </Link>
      </header>
      {published ? (
        <p className="notice">
          {en
            ? "This report is published. Conclusions are read-only."
            : "该报告已发布，复核结论为只读。"}
        </p>
      ) : null}
      <IncompleteReview
        runId={runId}
        locale={locale}
        refreshKey={refreshKey}
        onReviewChange={() => {
          setRefreshKey((value) => value + 1);
          void load();
        }}
      />
      <AiOverlayCard
        runId={runId}
        pages={data.pages ?? []}
        locale={locale}
        readOnly={published}
        onBatchChange={() => {
          setRefreshKey((value) => value + 1);
          void load();
        }}
      />
      <div className="review-page-footer">
        <Link className="secondary-link" href={`/reports/${runId}` as Route}>
          {en ? "Continue to full report" : "继续查看完整报告"}
        </Link>
      </div>
    </section>
  );
}
