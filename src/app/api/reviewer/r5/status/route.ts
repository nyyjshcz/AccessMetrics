import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { migrate } from "@/lib/db";
import { r5Status } from "@/lib/r5";
import { AppError, errorEnvelope } from "@/lib/errors";

export async function GET() {
  try {
    const session = await requireRole("computer_reviewer", "math_reviewer");
    migrate();
    return NextResponse.json(r5Status(session.user.role));
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
