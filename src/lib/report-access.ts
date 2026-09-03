import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requireRequestRole, type AccessRole } from "@/lib/access-control";

const EXPORTABLE_RUN_STATUSES = new Set(["completed", "completed_with_errors"]);

/**
 * Authorize a report export without revealing unpublished runs to visitors.
 * A report is exportable only after the scan has reached a terminal success
 * state. Administrators may export both published and unpublished reports;
 * visitors may export published reports only.
 */
export function requireReportExportAccess(request: Request, runId: string): AccessRole {
  const role = requireRequestRole(request, "visitor");
  const run = getDb()
    .prepare("SELECT status,published FROM scan_runs WHERE id=?")
    .get(runId) as { status: string; published: number } | undefined;

  if (
    !run ||
    !EXPORTABLE_RUN_STATUSES.has(run.status) ||
    (role === "visitor" && run.published !== 1)
  ) {
    throw new AppError("NOT_FOUND", "报告不存在", 404);
  }

  return role;
}

/** Page equivalent of the export guard; callers should turn a null result into a 404. */
export function getReportPageAccess(runId: string, role: AccessRole) {
  const run = getDb()
    .prepare("SELECT status,published FROM scan_runs WHERE id=?")
    .get(runId) as { status: string; published: number } | undefined;
  if (!run || !EXPORTABLE_RUN_STATUSES.has(run.status) || (role === "visitor" && run.published !== 1)) {
    return null;
  }
  return run;
}
