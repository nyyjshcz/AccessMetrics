import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function POST(request: Request, context: { params: Promise<{ exportId: string }> }) {
  try {
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    migrate();
    const { exportId } = await context.params;
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "发布请求必须是对象", 422);
    const allowed = new Set([
      "expectedPublicationRevision",
      "expectedFullGateBundleHash",
      "expectedFinalCandidateCommit",
      "expectedPublicationAttestationHash",
      "publicationScopeHash",
      "confirmSanitizedAndLicensed",
    ]);
    if (Object.keys(body).some((key) => !allowed.has(key)))
      throw new AppError("UNKNOWN_FIELD", "发布请求包含未定义字段", 400);
    if (Object.keys(body).length !== 6)
      throw new AppError("INVALID_INPUT", "发布请求字段不完整", 422);
    if (body.confirmSanitizedAndLicensed !== true)
      throw new AppError("PUBLICATION_CONFIRMATION_REQUIRED", "必须确认已完成脱敏和许可核对", 422);
    if (
      typeof body.expectedFinalCandidateCommit !== "string" ||
      !/^[0-9a-f]{40,64}$/i.test(body.expectedFinalCandidateCommit)
    )
      throw new AppError("PUBLICATION_BINDING_MISMATCH", "final candidate commit 无效", 409);
    const row = getDb()
      .prepare(
        "SELECT * FROM study_exports WHERE id=? AND kind='study_final' AND status='verified' AND is_current=1",
      )
      .get(exportId) as any;
    if (!row) throw new AppError("NOT_FOUND", "final 不存在", 404);
    if (row.publication_status !== "release_ready")
      throw new AppError("RELEASE_NOT_READY", "只有 release_ready 可以发布", 409);
    if (
      !row.publication_gate_bundle_hash ||
      !row.validation_attestation_hash ||
      !(row.build_attestation_hash ?? row.publication_attestation_hash) ||
      !row.privacy_check_hash ||
      !row.file_allowlist_hash
    )
      throw new AppError("PUBLICATION_EVIDENCE_MISSING", "发布证据链不完整", 409);
    if (
      body.expectedPublicationRevision !== row.publication_revision ||
      body.expectedFullGateBundleHash !== row.publication_gate_bundle_hash ||
      body.expectedPublicationAttestationHash !==
        (row.build_attestation_hash ?? row.publication_attestation_hash) ||
      body.expectedFinalCandidateCommit !== row.publication_commit ||
      body.publicationScopeHash !== row.publication_scope_hash
    )
      throw new AppError("PUBLICATION_BINDING_MISMATCH", "发布绑定值不匹配", 409);
    const changed = getDb()
      .prepare(
        "UPDATE study_exports SET publication_status='published',publication_revision=publication_revision+1,published_at=? WHERE id=? AND publication_status='release_ready' AND publication_revision=?",
      )
      .run(new Date().toISOString(), exportId, row.publication_revision);
    if (changed.changes !== 1) throw new AppError("PUBLICATION_CONFLICT", "发布状态并发冲突", 409);
    return NextResponse.json({ exportId, publicationStatus: "published" });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
