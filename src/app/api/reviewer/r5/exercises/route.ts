import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { AppError, errorEnvelope } from "@/lib/errors";
import {
  createExercise,
  createHandoff,
  createUnderstanding,
  finalizeExercise,
  finalizeUnderstanding,
  finalizeR5,
  runExerciseStep,
  submitExercise,
  submitHandoff,
  submitUnderstanding,
} from "@/lib/r5";
export async function POST(request: Request) {
  try {
    const session = await requireRole("computer_reviewer", "math_reviewer");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const body = await request.json();
    const pathname = new URL(request.url).pathname;
    const role = session.user.role;
    const parts = pathname.split("/").filter(Boolean);
    const exercisesIndex = parts.indexOf("exercises");
    if (exercisesIndex >= 0 && parts.length === exercisesIndex + 1)
      return NextResponse.json(createExercise(role, body), { status: 201 });
    if (
      exercisesIndex >= 0 &&
      parts.length === exercisesIndex + 5 &&
      parts[exercisesIndex + 2] === "steps" &&
      parts[exercisesIndex + 4] === "run"
    )
      return NextResponse.json(
        runExerciseStep(role, parts[exercisesIndex + 1], parts[exercisesIndex + 3], body),
        { status: 200 },
      );
    if (
      exercisesIndex >= 0 &&
      parts.length === exercisesIndex + 3 &&
      parts[exercisesIndex + 2] === "finalize"
    )
      return NextResponse.json(
        finalizeExercise(role, {
          ...(body as Record<string, unknown>),
          sessionId: parts[exercisesIndex + 1],
        }),
        { status: 201 },
      );
    const understandingIndex = parts.indexOf("understanding-checks");
    if (understandingIndex >= 0 && parts.length === understandingIndex + 1)
      return NextResponse.json(createUnderstanding(role, body), { status: 201 });
    if (
      understandingIndex >= 0 &&
      parts.length === understandingIndex + 3 &&
      parts[understandingIndex + 2] === "finalize"
    )
      return NextResponse.json(
        finalizeUnderstanding(role, {
          ...(body as Record<string, unknown>),
          sessionId: parts[understandingIndex + 1],
        }),
        { status: 201 },
      );
    const handoffsIndex = parts.indexOf("handoffs");
    if (handoffsIndex >= 0 && parts.length === handoffsIndex + 1)
      return NextResponse.json(createHandoff(role, body), { status: 201 });
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
