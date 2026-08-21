import { NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { csrfMatches, requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { canonicalize, sha256 } from "@/lib/canonical";
import { config } from "@/lib/config";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function POST(request: Request, context: { params: Promise<{ exportId: string }> }) {
  try {
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF", "缺少或无效的 CSRF token", 403);
    migrate();
    const { exportId } = await context.params;
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "publication approval 请求必须是对象", 422);
    const allowed = new Set([
      "expectedPublicationRevision",
      "expectedManifestHash",
      "expectedBuildAttestationHash",
      "privacyCheckHash",
      "fileAllowlistHash",
      "licenseDecision",
      "decision",
      "statementVersion",
      "reauthAdminToken",
    ]);
    if (Object.keys(body).some((key) => !allowed.has(key)))
      throw new AppError("UNKNOWN_FIELD", "publication approval 请求包含未定义字段", 400);
    if (
      typeof body.reauthAdminToken !== "string" ||
      !config.ADMIN_REAUTH_TOKEN ||
      Buffer.byteLength(body.reauthAdminToken) !== Buffer.byteLength(config.ADMIN_REAUTH_TOKEN) ||
      !crypto.timingSafeEqual(
        Buffer.from(body.reauthAdminToken),
        Buffer.from(config.ADMIN_REAUTH_TOKEN),
      )
    )
      throw new AppError("REAUTH_REQUIRED", "需要有效的二次认证 token", 403);
    if (Object.keys(body).length !== 9)
      throw new AppError("INVALID_INPUT", "publication approval 字段不完整", 422);
    const row = getDb()
      .prepare(
        "SELECT * FROM study_exports WHERE id=? AND kind='study_final' AND status='verified' AND is_current=1",
      )
      .get(exportId) as any;
    if (!row) throw new AppError("NOT_FOUND", "final 不存在", 404);
    if (row.publication_status !== "release_ready")
      throw new AppError("RELEASE_NOT_READY", "只有 release_ready 可以批准公开", 409);
    if (
      body.expectedPublicationRevision !== row.publication_revision ||
      body.expectedManifestHash !== row.manifest_hash ||
      body.expectedBuildAttestationHash !==
        (row.build_attestation_hash ?? row.publication_attestation_hash) ||
      body.privacyCheckHash !== row.privacy_check_hash ||
      body.fileAllowlistHash !== row.file_allowlist_hash
    )
      throw new AppError("PUBLICATION_BINDING_MISMATCH", "隐私/构建/manifest 绑定值不匹配", 409);
    if (body.licenseDecision !== "authorized_public" || body.decision !== "approved")
      throw new AppError(
        "PUBLICATION_NOT_APPROVED",
        "只有 authorized_public + approved 可以公开",
        409,
      );
    const approval = {
      schemaVersion: "publication-approval-v1",
      exportId,
      manifestHash: row.manifest_hash,
      finalCandidate: row.publication_commit,
      buildAttestationHash: row.build_attestation_hash ?? row.publication_attestation_hash,
      validationAttestationHash: row.validation_attestation_hash,
      fileAllowlistHash: row.file_allowlist_hash,
      privacyCheckHash: row.privacy_check_hash,
      licenseDecision: body.licenseDecision,
      decision: body.decision,
      statementVersion: body.statementVersion ?? "publication-statement-v1",
      scope: [
        "study_final",
        exportId,
        row.manifest_hash,
        row.file_allowlist_hash,
        row.privacy_check_hash,
      ],
      approvedBy: session.user.username,
      approvedAt: new Date().toISOString(),
    };
    const scopeHash = sha256(canonicalize(approval));
    const approvalWithHash = { ...approval, approvalHash: scopeHash };
    const file = path.join(
      config.privateEvidenceRoot,
      "publication-approvals",
      exportId,
      `${scopeHash}.json`,
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, canonicalize(approvalWithHash) + "\n");
    getDb()
      .prepare("UPDATE study_exports SET publication_scope_hash=? WHERE id=? AND manifest_hash=?")
      .run(scopeHash, exportId, row.manifest_hash);
    return NextResponse.json({ publicationScopeHash: scopeHash });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
