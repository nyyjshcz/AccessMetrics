import { NextResponse } from "next/server";
import { currentCsrfToken, currentSession } from "@/lib/auth";

export async function GET() {
  const session = await currentSession();
  if (!session || session.user.role !== "admin") return NextResponse.json({ authenticated: false });
  return NextResponse.json({
    authenticated: true,
    user: session.user,
    csrfToken: await currentCsrfToken(session),
    expiresAt: session.expiresAt,
  });
}
