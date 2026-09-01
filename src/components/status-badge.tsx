type StatusTone = "active" | "danger" | "neutral" | "success" | "warning";

type StatusPresentation = {
  label: string;
  tone: StatusTone;
};

const scanStatus: Record<string, StatusPresentation> = {
  queued: { label: "等待处理", tone: "neutral" },
  running: { label: "正在扫描", tone: "active" },
  paused: { label: "已暂停", tone: "warning" },
  completed: { label: "扫描完成", tone: "success" },
  completed_with_errors: { label: "扫描完成（部分页面异常）", tone: "warning" },
  failed: { label: "扫描失败", tone: "danger" },
  cancelled: { label: "已取消", tone: "neutral" },
};
const scanStatusEn: Record<string, string> = {
  queued: "Queued", running: "Scanning", paused: "Paused", completed: "Scan complete",
  completed_with_errors: "Scan complete (some pages failed)", failed: "Scan failed", cancelled: "Cancelled",
};
const scanStatusZh: Record<string, string> = Object.fromEntries(
  Object.entries(scanStatus).map(([key, value]) => [key, value.label]),
);

export function describeScanStatus(
  status: string | null | undefined,
  published = false,
  locale?: Locale,
): StatusPresentation {
  const resolvedLocale = locale ?? (typeof document !== "undefined" ? normalizeLocale(document.documentElement.lang) : "zh-CN");
  const en = resolvedLocale === "en";
  if (published) return { label: en ? "Published" : "已发布", tone: "success" };
  if (status && scanStatus[status]) return { label: en ? scanStatusEn[status] : scanStatusZh[status], tone: scanStatus[status].tone };
  return { label: status || (en ? "Unknown status" : "状态未知"), tone: "neutral" };
}

export default function StatusBadge({
  status,
  published = false,
  locale,
}: {
  status: string | null | undefined;
  published?: boolean;
  locale?: Locale;
}) {
  const presentation = describeScanStatus(status, published, locale);
  return (
    <span className={`status-badge status-badge-${presentation.tone}`}>{presentation.label}</span>
  );
}
import { normalizeLocale, type Locale } from "@/lib/i18n";
