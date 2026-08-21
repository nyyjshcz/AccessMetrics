import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { AppError, errorEnvelope } from "@/lib/errors";
import { finalizeR5, submitExercise, submitHandoff, submitUnderstanding } from "@/lib/r5";
export async function POST(request: Request) {
  try {
    const session = await requireRole("computer_reviewer", "math_reviewer");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const body = await request.json();
    const pathname = new URL(request.url).pathname;
    const role = session.user.role;
    if (pathname.includes("understanding-checks"))
      return NextResponse.json(submitUnderstanding(role, body), { status: 201 });
    if (pathname.includes("handoffs"))
      return NextResponse.json(submitHandoff(role, body), { status: 201 });
    if (pathname.includes("/finalize"))
      return NextResponse.json(finalizeR5(role, body), { status: 201 });
    return NextResponse.json(submitExercise(role, body), { status: 201 });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
