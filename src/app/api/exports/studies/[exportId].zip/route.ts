import { NextResponse } from "next/server";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { zipDirectory } from "@/lib/zip";
import { scanPublicationDirectory } from "@/lib/privacy";
import { sha256 } from "@/lib/canonical";
import fs from "node:fs";
export async function GET(_request: Request, context: { params: Promise<{}> }) {
  try {
    migrate();
    const { exportId } = (await context.params) as { exportId: string };
    const row = getDb()
      .prepare(
        "SELECT se.*,sf.status freeze_status FROM study_exports se JOIN study_freezes sf ON sf.id=se.study_freeze_id WHERE se.id=? AND se.kind='study_final' AND se.status='verified' AND se.is_current=1 AND se.publication_status='published' AND sf.status='final_verified'",
      )
      .get(exportId) as any;
    if (
      !row ||
      !fs.existsSync(row.storage_relpath) ||
      !row.publication_gate_bundle_hash ||
      !row.publication_commit ||
      !row.publication_attestation_hash ||
      !row.publication_scope_hash
    )
      throw new AppError("NOT_FOUND", "公开导出不存在", 404);
    const manifestPath = `${row.storage_relpath}/manifest.json`;
    const digestPath = `${row.storage_relpath}/manifest.sha256`;
    if (!fs.existsSync(manifestPath) || !fs.existsSync(digestPath))
      throw new AppError("EXPORT_INVALID", "公开导出缺少 manifest", 409);
    const manifestHash = sha256(fs.readFileSync(manifestPath));
    if (
      manifestHash !== fs.readFileSync(digestPath, "utf8").trim() ||
      manifestHash !== row.manifest_hash
    )
      throw new AppError("EXPORT_HASH_MISMATCH", "公开导出 manifest hash 不匹配", 409);
    const privacy = scanPublicationDirectory(row.storage_relpath, exportId);
    if (!privacy.passed)
      throw new AppError("PRIVACY_GATE_FAILED", "公开导出未通过隐私门", 409, privacy.findings);
    if (
      privacy.privacyCheckHash !== row.privacy_check_hash ||
      privacy.fileAllowlistHash !== row.file_allowlist_hash
    )
      throw new AppError("PRIVACY_HASH_MISMATCH", "公开导出隐私报告 hash 不匹配", 409);
    const bytes = zipDirectory(row.storage_relpath);
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${exportId}.zip"`,
        "x-manifest-sha256": row.manifest_hash ?? "",
        "x-full-gate-bundle-sha256": row.publication_gate_bundle_hash,
        "x-publication-commit": row.publication_commit,
        "x-build-attestation-sha256": row.publication_attestation_hash,
        "x-privacy-check-sha256": row.privacy_check_hash,
      },
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 404,
    });
  }
}
