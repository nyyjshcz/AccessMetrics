import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function GET(_request: Request, context: { params: Promise<{ exportId: string }> }) {
  try {
    migrate();
    await requireRole("admin", "computer_reviewer", "math_reviewer");
    const { exportId } = await context.params;
    const value = getDb().prepare("SELECT * FROM study_exports WHERE id=?").get(exportId);
    if (!value) throw new AppError("NOT_FOUND", "导出不存在", 404);
    return NextResponse.json(value);
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
