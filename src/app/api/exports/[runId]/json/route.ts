import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { migrate } from "@/lib/db";
import { exportRun } from "@/lib/export";
import { AppError, errorEnvelope } from "@/lib/errors";
import fs from "node:fs";
export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    migrate();
    await requireRole("admin", "computer_reviewer", "math_reviewer");
    const { runId } = await context.params;
    const result = exportRun(runId);
    const bytes = fs.readFileSync(`${result.target}/scan.json`);
    return new NextResponse(bytes, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${result.exportId}.json"`,
      },
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
