import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function GET(_request: Request, context: { params: Promise<{ exportId: string }> }) {
  try {
    await requireRole("admin", "computer_reviewer", "math_reviewer");
    migrate();
    const { exportId } = await context.params;
    const row = getDb().prepare("SELECT * FROM study_exports WHERE id=?").get(exportId) as any;
    if (!row) throw new AppError("NOT_FOUND", "导出不存在", 404);
    const blockers: string[] = [];
    if (row.kind !== "study_final") blockers.push("只有 study_final 可以公开");
    if (row.status !== "verified" || row.is_current !== 1) blockers.push("导出未 verified/current");
    if (row.publication_status !== "release_ready" && row.publication_status !== "published")
      blockers.push("尚未完成 release validation/build attestation");
    if (!row.publication_gate_bundle_hash) blockers.push("缺少 fullGateBundleHash");
    if (!row.validation_attestation_hash) blockers.push("缺少 validation attestation");
    if (!row.build_attestation_hash && !row.publication_attestation_hash)
      blockers.push("缺少 build attestation");
    if (!row.privacy_check_hash || !row.file_allowlist_hash)
      blockers.push("缺少 publication preflight 隐私/文件清单 hash");
    return NextResponse.json({
      publicationStatus: row.publication_status,
      publicationRevision: row.publication_revision,
      embeddedBuildProvenance: null,
      fullGateBundleHash: row.publication_gate_bundle_hash,
      validationAttestationHash: row.validation_attestation_hash,
      buildAttestationHash: row.build_attestation_hash ?? row.publication_attestation_hash,
      privacyCheckHash: row.privacy_check_hash,
      publicationScopeHash: row.publication_scope_hash,
      ready: blockers.length === 0,
      blockers,
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
