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

export function describeScanStatus(
  status: string | null | undefined,
  published = false,
): StatusPresentation {
  if (published) return { label: "已发布", tone: "success" };
  if (status && scanStatus[status]) return scanStatus[status];
  return { label: status || "状态未知", tone: "neutral" };
}

export default function StatusBadge({
  status,
  published = false,
}: {
  status: string | null | undefined;
  published?: boolean;
}) {
  const presentation = describeScanStatus(status, published);
  return (
    <span className={`status-badge status-badge-${presentation.tone}`}>{presentation.label}</span>
  );
}
