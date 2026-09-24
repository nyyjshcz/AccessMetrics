"use client";

import { useState } from "react";
import type { Locale } from "@/lib/i18n";

export default function ReportActions({
  runId,
  published,
  aiActive,
  locale,
}: {
  runId: string;
  published: boolean;
  aiActive: boolean;
  locale: Locale;
}) {
  const en = locale === "en";
  const [busy, setBusy] = useState(false);
  const [isPublished, setIsPublished] = useState(published);
  const [message, setMessage] = useState("");
  async function publish() {
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/runs/${runId}/publish`, { method: "POST" });
    const payload = await response.json().catch(() => null);
    if (response.ok) setIsPublished(true);
    setMessage(
      response.ok
        ? en
          ? "Report published."
          : "报告已发布。"
        : (payload?.error?.message ?? (en ? "Publishing failed." : "发布失败。")),
    );
    setBusy(false);
  }
  async function withdraw() {
    if (
      !window.confirm(
        en
          ? "Withdraw this report? Visitors will no longer see it, but the scan data will be kept."
          : "确定撤下报告吗？访客将无法继续查看，但扫描数据会保留。",
      )
    )
      return;
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/runs/${runId}/publish`, { method: "DELETE" });
    const payload = await response.json().catch(() => null);
    if (response.ok) setIsPublished(false);
    setMessage(
      response.ok
        ? en
          ? "Report withdrawn."
          : "报告已撤下。"
        : (payload?.error?.message ?? (en ? "Withdrawing failed." : "撤下失败。")),
    );
    setBusy(false);
  }
  return (
    <aside className="report-actions" aria-label={en ? "Report actions" : "报告操作"}>
      <div className="report-downloads">
        <a className="secondary-link" href={`/api/reports/${runId}/html?lang=${locale}`}>
          {en ? "Download HTML" : "下载 HTML"}
        </a>
        <a className="secondary-link" href={`/api/reports/${runId}/pdf?lang=${locale}`}>
          {en ? "Download PDF" : "下载 PDF"}
        </a>
        <a className="secondary-link" href={`/api/reports/${runId}/json`}>
          {en ? "Download JSON" : "下载 JSON"}
        </a>
      </div>
      {aiActive ? (
        <p className="muted" id="report-publish-disabled-reason">
          {en
            ? "AI review is still running; publishing is temporarily unavailable."
            : "AI 复核仍在进行，暂时不能发布。"}
        </p>
      ) : null}
      {isPublished ? (
        <button
          type="button"
          className="danger-button report-danger-action"
          aria-busy={busy}
          disabled={busy}
          onClick={() => void withdraw()}
        >
          {busy ? (en ? "Withdrawing…" : "撤下中…") : en ? "Withdraw report" : "撤下报告"}
        </button>
      ) : (
        <button
          type="button"
          className="report-primary-action"
          aria-busy={busy}
          aria-describedby={aiActive ? "report-publish-disabled-reason" : undefined}
          disabled={busy || aiActive}
          onClick={() => void publish()}
        >
          {busy ? (en ? "Publishing…" : "发布中…") : en ? "Publish report" : "发布报告"}
        </button>
      )}
      {busy ? (
        <p className="muted" role="status">
          {isPublished
            ? en
              ? "Withdrawing report…"
              : "正在撤下报告…"
            : en
              ? "Publishing report…"
              : "正在发布报告…"}
        </p>
      ) : message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
    </aside>
  );
}
