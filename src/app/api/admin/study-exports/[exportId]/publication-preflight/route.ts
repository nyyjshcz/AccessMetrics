import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { scanPublicationDirectory } from "@/lib/privacy";
import { config } from "@/lib/config";
import { AppError, errorEnvelope } from "@/lib/errors";
import fs from "node:fs";
import path from "node:path";
export async function POST(request: Request, context: { params: Promise<{ exportId: string }> }) {
  try {
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF", "缺少或无效的 CSRF token", 403);
    migrate();
    const { exportId } = await context.params;
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "publication preflight 请求必须是对象", 422);
    const allowed = new Set([
      "expectedPublicationRevision",
      "expectedManifestHash",
      "expectedBuildAttestationHash",
    ]);
    if (Object.keys(body).some((key) => !allowed.has(key)))
      throw new AppError("UNKNOWN_FIELD", "publication preflight 请求包含未定义字段", 400);
    if (Object.keys(body).length !== 3)
      throw new AppError(
        "INVALID_INPUT",
        "publication preflight 需要 revision、manifest 和 build hash",
        422,
      );
    const row = getDb()
      .prepare(
        "SELECT * FROM study_exports WHERE id=? AND kind='study_final' AND status='verified' AND is_current=1",
      )
      .get(exportId) as any;
    if (!row) throw new AppError("NOT_FOUND", "当前 final 不存在", 404);
    if (row.publication_status !== "release_ready")
      throw new AppError(
        "RELEASE_NOT_READY",
        "只有 release_ready 的 current final 可以做公开前置检查",
        409,
      );
    if (
      !(row.build_attestation_hash ?? row.publication_attestation_hash) ||
      !row.validation_attestation_hash
    )
      throw new AppError("ATTESTATION_REQUIRED", "缺少通过的 validation/build attestation", 409);
    if (body.expectedPublicationRevision !== row.publication_revision)
      throw new AppError("PUBLICATION_REVISION_MISMATCH", "publication revision 不匹配", 409);
    if (body.expectedManifestHash && body.expectedManifestHash !== row.manifest_hash)
      throw new AppError("MANIFEST_MISMATCH", "manifest hash 不匹配", 409);
    if (
      body.expectedBuildAttestationHash !==
      (row.build_attestation_hash ?? row.publication_attestation_hash)
    )
      throw new AppError("BUILD_ATTESTATION_MISMATCH", "build attestation hash 不匹配", 409);
    const report = scanPublicationDirectory(row.storage_relpath, exportId);
    const reportPath = path.join(
      config.privateEvidenceRoot,
      "publication-reports",
      exportId,
      `${row.publication_revision}.json`,
    );
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
    if (!report.passed)
      throw new AppError(
        "PUBLICATION_PRIVACY_FAILED",
        "公开包隐私检查未通过",
        409,
        report.findings,
      );
    getDb()
      .prepare(
        "UPDATE study_exports SET privacy_check_hash=?,file_allowlist_hash=?,publication_statement_version=? WHERE id=? AND publication_revision=?",
      )
      .run(
        report.privacyCheckHash,
        report.fileAllowlistHash,
        "publication-statement-v1",
        exportId,
        row.publication_revision,
      );
    return NextResponse.json({
      privacyCheckHash: report.privacyCheckHash,
      fileAllowlistHash: report.fileAllowlistHash,
      passed: report.passed,
      findingsSummary: report.findings.map((finding) => ({
        ruleId: finding.ruleId,
        severity: finding.severity,
      })),
      statementVersion: "publication-statement-v1",
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
