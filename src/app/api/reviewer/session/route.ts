import { NextResponse } from "next/server";
import { currentCsrfToken, currentSession } from "@/lib/auth";

export async function GET() {
  const session = await currentSession();
  if (!session || !["computer_reviewer", "math_reviewer"].includes(session.user.role))
    return NextResponse.json({ authenticated: false });
  return NextResponse.json({
    authenticated: true,
    user: session.user,
    csrfToken: await currentCsrfToken(session),
    expiresAt: session.expiresAt,
  });
}
