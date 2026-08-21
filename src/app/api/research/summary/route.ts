import { NextResponse } from "next/server";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";

export async function GET(request: Request) {
  try {
    migrate();
    const url = new URL(request.url);
    const category = url.searchParams.get("category");
    const scannerVersion = url.searchParams.get("scannerVersion");
    const axeVersion = url.searchParams.get("axeVersion");
    const modelVersion = url.searchParams.get("modelVersion");
    const supplied = [scannerVersion, axeVersion, modelVersion].filter(Boolean).length;
    if (supplied !== 0 && supplied !== 3)
      throw new AppError(
        "VERSION_SELECTION_REQUIRED",
        "scanner/axe/model 三个版本必须一起指定",
        409,
      );
    const versions = getDb()
      .prepare(
        "SELECT DISTINCT scanner_version scannerVersion,axe_version axeVersion,score_model_version modelVersion FROM scan_runs WHERE status='completed' AND published=1 ORDER BY scanner_version,axe_version,score_model_version",
      )
      .all() as Array<{ scannerVersion: string; axeVersion: string; modelVersion: string }>;
    const selected =
      supplied === 3
        ? { scannerVersion, axeVersion, modelVersion }
        : versions.length === 1
          ? versions[0]
          : null;
    if (!selected && versions.length > 1)
      throw new AppError("VERSION_SELECTION_REQUIRED", "存在多个版本三元组，请完整指定版本", 409, {
        options: versions,
      });
    if (!selected)
      return NextResponse.json({
        baseline: null,
        items: [],
        options: versions,
        note: "未发布或版本不完整的数据不会进入研究汇总",
      });
    const clauses = [
      "r.status='completed'",
      "r.published=1",
      "r.scanner_version=?",
      "r.axe_version=?",
      "r.score_model_version=?",
    ];
    const args: unknown[] = [selected.scannerVersion, selected.axeVersion, selected.modelVersion];
    if (category) {
      clauses.push("s.category=?");
      args.push(category);
    }
    const rows = getDb()
      .prepare(
        `SELECT s.id,s.name,s.origin,s.category,r.id runId,r.status,r.scanner_version scannerVersion,r.axe_version axeVersion,r.score_model_version modelVersion,r.published FROM scan_runs r JOIN sites s ON s.id=r.site_id WHERE ${clauses.join(" AND ")} ORDER BY s.name`,
      )
      .all(...args);
    return NextResponse.json({
      baseline: selected,
      items: rows,
      options: versions,
      note: "未发布或版本不完整的数据不会进入研究汇总",
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
